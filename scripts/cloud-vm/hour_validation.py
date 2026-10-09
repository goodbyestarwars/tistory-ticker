"""Append-only forward evaluation of manual direction hypotheses; no model edits.

Tick policy v1: exact second, else last preceding <=10s, else first following
<=60s. Different prices at the chosen second are ambiguous and excluded.
Finalize after 90s so the whole permitted interval can be observed. Never use
minute OHLC, NXT, receipt-time prices, or today's price to backfill a missed day.
"""
import hashlib
import json
import logging
import math
import os
import re
import shutil
import sqlite3
import threading
import time
import zlib
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
POLICY = 'krx-tick-60m-v1'
DB_FILE = os.path.join(os.path.dirname(__file__), 'hour_validation.db')
MAX_DB_BYTES = 512 * 1024 * 1024
MAX_CODES_PER_TICK = 2
FINALIZE_DELAY = 90
_worker_lock = threading.Lock()
logger = logging.getLogger('hour_validation')


def _path():
    return os.environ.get('HOUR_VALIDATION_DB', DB_FILE)


def _connect():
    conn = sqlite3.connect(_path(), timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=FULL')
    conn.execute('PRAGMA cache_size=-1024')
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS predictions(
            id TEXT PRIMARY KEY, code TEXT NOT NULL, model TEXT NOT NULL,
            checked_at TEXT NOT NULL, target_at TEXT NOT NULL, target_ts REAL NOT NULL,
            direction TEXT NOT NULL, reference REAL, reason TEXT NOT NULL,
            bucket TEXT NOT NULL, policy TEXT NOT NULL, verdict_json TEXT NOT NULL,
            metrics_json TEXT NOT NULL, snapshot BLOB, created_at TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'in-session');
        CREATE INDEX IF NOT EXISTS prediction_target ON predictions(target_ts);
        CREATE TABLE IF NOT EXISTS outcomes(
            prediction_id TEXT PRIMARY KEY REFERENCES predictions(id),
            state TEXT NOT NULL, exclusion TEXT, evaluated_at TEXT NOT NULL,
            price REAL, price_at TEXT, offset_sec REAL, selection TEXT,
            actual_direction TEXT, change_pct REAL, signed_return_pct REAL,
            hit INTEGER, evidence_json TEXT);
        CREATE TABLE IF NOT EXISTS observations(
            code TEXT NOT NULL, stamp TEXT NOT NULL, stamp_ts REAL NOT NULL,
            price REAL NOT NULL, received_at TEXT NOT NULL, origin TEXT NOT NULL,
            raw_json TEXT NOT NULL, PRIMARY KEY(code,stamp,price));
        CREATE INDEX IF NOT EXISTS observation_lookup ON observations(code,stamp_ts);
        CREATE TABLE IF NOT EXISTS attempts(code TEXT PRIMARY KEY, last_ts REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS prediction_no_update BEFORE UPDATE ON predictions
            BEGIN SELECT RAISE(ABORT,'immutable prediction'); END;
        CREATE TRIGGER IF NOT EXISTS prediction_no_delete BEFORE DELETE ON predictions
            BEGIN SELECT RAISE(ABORT,'immutable prediction'); END;
        CREATE TRIGGER IF NOT EXISTS outcome_no_update BEFORE UPDATE ON outcomes
            BEGIN SELECT RAISE(ABORT,'immutable outcome'); END;
        CREATE TRIGGER IF NOT EXISTS outcome_no_delete BEFORE DELETE ON outcomes
            BEGIN SELECT RAISE(ABORT,'immutable outcome'); END;
    ''')
    if 'scope' not in {row[1] for row in conn.execute('PRAGMA table_info(predictions)')}:
        conn.execute("ALTER TABLE predictions ADD COLUMN scope TEXT NOT NULL DEFAULT 'in-session'")
    conn.execute('CREATE INDEX IF NOT EXISTS prediction_segment ON predictions(scope,model,code,checked_at)')
    return conn


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 and not isinstance(value, bool) else None
    except (ValueError, TypeError):
        return None


def analysis_metrics(snapshot, verdict):
    """Observational covariates only: never feed these into v6's verdict."""
    metrics = dict(verdict.get('metrics') or {})
    if not snapshot:
        return metrics
    import hour_candidate_engine as engine
    checked = engine._iso(snapshot.get('checkedAt'))
    bars, error = engine._closed_bars(snapshot.get('bars'), checked, 30) if checked else (None, 'no clock')
    trade = snapshot.get('trade') or {}
    metrics.update(strengthRaw=trade.get('strength'), referenceTradeAt=trade.get('time'))
    if not error and len(bars) >= 5:
        closing = bars[-1]['close']
        tolerance = max(closing * .002, float(engine.tick_size(closing)))
        metrics.update(fiveMinuteChangePct=(closing / bars[-5]['open'] - 1) * 100,
                       tradePriceToleranceRaw=tolerance,
                       tradePriceTolerancePct=tolerance / closing * 100,
                       tradeVsClosedPct=(trade['price'] / closing - 1) * 100 if _number(trade.get('price')) else None,
                       recentLows=[row['low'] for row in bars[-3:]],
                       recentHighs=[row['high'] for row in bars[-3:]])
        baseline = sum(row['volume'] for row in bars[-4:-2])
        metrics['volumeAccelerationRaw'] = sum(row['volume'] for row in bars[-2:]) / baseline if baseline else None
        rising, pivot_rise, pivots = engine._pattern(bars)
        metrics.update(risingRecentLowsRaw=rising, risingConfirmedPivotLowsRaw=pivot_rise,
                       confirmedPivotLowsRaw=pivots)
    return metrics


def record_prediction(verdict, snapshot=None, scope='in-session'):
    """Content-addressed insert. Existing predictions/snapshots are never rewritten."""
    checked = datetime.fromisoformat(verdict['checkedAt']).astimezone(KST)
    target = checked + timedelta(minutes=60)
    original = {'verdict': verdict, 'snapshot': snapshot, 'scope': scope}
    serialized = _json(original)
    identity = hashlib.sha256(serialized.encode()).hexdigest()
    path = _path()
    if sum(os.path.getsize(p) for p in (path, path + '-wal') if os.path.exists(p)) >= MAX_DB_BYTES:
        raise OSError('validation store capacity reached; archive required')
    conn = _connect()
    try:
        with conn:
            conn.execute('INSERT OR IGNORE INTO predictions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                         (identity, verdict['code'], verdict['rulesVersion'], checked.isoformat(),
                          target.isoformat(), target.timestamp(), verdict['direction'], verdict.get('referencePrice'),
                          verdict['reason'], checked.strftime('%H:00'), POLICY, _json(verdict),
                          _json(analysis_metrics(snapshot, verdict)),
                          zlib.compress(_json(snapshot).encode()) if snapshot else None,
                          datetime.now(KST).isoformat(), scope))
    finally:
        conn.close()
    return identity


def observe_trades(code, rows, received_at=None, origin='existing-kis-request'):
    """Reuse timestamped KIS J trades only for predictions near maturity."""
    if not os.path.exists(_path()):
        return 0
    received = (received_at or datetime.now(KST)).astimezone(KST)
    if not re.fullmatch(r'[0-9A-Z]{6}', str(code)):
        return 0
    conn = _connect()
    stored = 0
    try:
        pending = conn.execute('''SELECT target_ts FROM predictions p WHERE code=?
            AND target_ts BETWEEN ? AND ? AND NOT EXISTS
            (SELECT 1 FROM outcomes o WHERE o.prediction_id=p.id)''',
            (code, received.timestamp() - FINALIZE_DELAY, received.timestamp() + 10)).fetchall()
        if not pending:
            return 0
        targets = [row['target_ts'] for row in pending]
        if isinstance(rows, dict):
            rows = [rows]
        with conn:
            for row in (rows or [])[:100]:
                raw_time = str(row.get('stck_cntg_hour') or '')
                if not re.fullmatch(r'\d{6}', raw_time):
                    continue
                try:
                    stamp = datetime.strptime(received.strftime('%Y%m%d') + raw_time, '%Y%m%d%H%M%S').replace(tzinfo=KST)
                except ValueError:
                    continue
                price = _number(row.get('stck_prpr'))
                quantity = _number(row.get('cntg_vol'))
                # An explicit provider date, if present, must match; never relabel an old row.
                day = row.get('stck_bsop_date')
                if day and str(day) != received.strftime('%Y%m%d'):
                    continue
                if price is None or quantity is None or stamp > received:
                    continue
                import hour_candidate_engine as engine
                if not engine._on_tick(price):
                    continue
                if not any(-10 <= stamp.timestamp() - target <= 60 for target in targets):
                    continue
                cursor = conn.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?)',
                                      (code, stamp.isoformat(), stamp.timestamp(), price, received.isoformat(), origin,
                                       _json({key: row.get(key) for key in ('stck_bsop_date', 'stck_cntg_hour',
                                                                         'stck_prpr', 'cntg_vol', 'tday_rltv')})))
                stored += cursor.rowcount
    finally:
        conn.close()
    return stored


def select_price(rows, target_ts):
    valid = [row for row in rows if -10 <= row['stamp_ts'] - target_ts <= 60]
    exact = [row for row in valid if int(row['stamp_ts']) == int(target_ts)]
    before = [row for row in valid if row['stamp_ts'] < target_ts]
    after = [row for row in valid if row['stamp_ts'] > target_ts]
    if exact:
        chosen, method = exact, 'exact'
    elif before:
        stamp = max(row['stamp_ts'] for row in before)
        chosen, method = [row for row in before if row['stamp_ts'] == stamp], 'last-before-10s'
    elif after:
        stamp = min(row['stamp_ts'] for row in after)
        chosen, method = [row for row in after if row['stamp_ts'] == stamp], 'first-after-60s'
    else:
        return None, 'no_eligible_trade'
    if len({row['price'] for row in chosen}) != 1:
        return None, 'ambiguous_trade_second'
    return chosen[0], method


def finalize_due(now=None, limit=200):
    now = (now or datetime.now(KST)).astimezone(KST)
    conn = _connect()
    count = 0
    try:
        pending = conn.execute('''SELECT * FROM predictions p WHERE target_ts<=?
            AND NOT EXISTS(SELECT 1 FROM outcomes o WHERE o.prediction_id=p.id)
            ORDER BY target_ts LIMIT ?''', (now.timestamp() - FINALIZE_DELAY, limit)).fetchall()
        with conn:
            for prediction in pending:
                rows = conn.execute('SELECT * FROM observations WHERE code=? AND stamp_ts BETWEEN ? AND ?',
                                    (prediction['code'], prediction['target_ts'] - 10, prediction['target_ts'] + 60)).fetchall()
                selected, method = select_price(rows, prediction['target_ts'])
                reference = _number(prediction['reference'])
                state, exclusion = ('evaluated', None) if selected and reference else ('excluded',
                                      'missing_reference' if not reference else method)
                change = (selected['price'] / reference - 1) * 100 if state == 'evaluated' else None
                actual = ('up' if change > 0 else 'down' if change < 0 else 'flat') if change is not None else None
                direction = prediction['direction']
                signed = change * (1 if direction == 'up' else -1) if change is not None and direction != 'unclear' else None
                hit = int(direction == actual) if change is not None and direction != 'unclear' else None
                cursor = conn.execute('INSERT OR IGNORE INTO outcomes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (prediction['id'], state, exclusion, now.isoformat(), selected['price'] if selected else None,
                     selected['stamp'] if selected else None,
                     selected['stamp_ts'] - prediction['target_ts'] if selected else None,
                     method if selected else None, actual, change, signed, hit,
                     _json(dict(selected)) if selected else None))
                count += cursor.rowcount
    finally:
        conn.close()
    return count


def run_due(appkey='', appsecret='', now=None, fetch=None):
    """Called by the existing VI loop. At most two bounded REST reads, no new worker."""
    if not os.path.exists(_path()) or not _worker_lock.acquire(blocking=False):
        return {'fetchedCodes': 0}
    try:
        now = (now or datetime.now(KST)).astimezone(KST)
        finalized = finalize_due(now)
        import market_clock
        if not market_clock.is_kr_trading_day(now) or not (9, 5) <= (now.hour, now.minute) < (15, 31):
            return {'fetchedCodes': 0, 'finalized': finalized}
        conn = _connect()
        try:
            due = conn.execute('''SELECT p.code,MIN(p.target_ts) AS due FROM predictions p
                LEFT JOIN attempts a ON a.code=p.code WHERE p.target_ts BETWEEN ? AND ?
                AND (a.last_ts IS NULL OR a.last_ts<=?)
                AND NOT EXISTS(SELECT 1 FROM outcomes o WHERE o.prediction_id=p.id)
                GROUP BY p.code ORDER BY due LIMIT ?''',
                (now.timestamp() - FINALIZE_DELAY + .001, now.timestamp(), now.timestamp() - 20,
                 MAX_CODES_PER_TICK)).fetchall()
        finally:
            conn.close()
        fetched = 0
        for item in due:
            # Any saved eligible observation already covers this code; no duplicate REST fetch.
            conn = _connect()
            try:
                uncovered = conn.execute('''SELECT 1 FROM predictions p WHERE p.code=?
                    AND p.target_ts BETWEEN ? AND ?
                    AND NOT EXISTS(SELECT 1 FROM outcomes o WHERE o.prediction_id=p.id)
                    AND NOT EXISTS(SELECT 1 FROM observations v WHERE v.code=p.code
                        AND v.stamp_ts BETWEEN p.target_ts-10 AND p.target_ts+60
                        AND (julianday(v.received_at)-2440587.5)*86400>=p.target_ts+60
                        AND v.received_at>=?) LIMIT 1''',
                    (item['code'], now.timestamp() - FINALIZE_DELAY + .001, now.timestamp(),
                     (now - timedelta(seconds=20)).isoformat())).fetchone()
                if not uncovered:
                    continue
                with conn:
                    conn.execute('INSERT OR REPLACE INTO attempts VALUES(?,?)', (item['code'], now.timestamp()))
            finally:
                conn.close()
            if fetch is None and (not appkey or not appsecret):
                continue
            try:
                if fetch:
                    rows = fetch(item['code'])
                else:
                    import kis_client
                    import hour_candidates
                    token = kis_client.get_token(appkey, appsecret)
                    response = hour_candidates._request(token, appkey, appsecret,
                        '/uapi/domestic-stock/v1/quotations/inquire-ccnl', 'FHKST01010300',
                        {'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': item['code']}, time.monotonic() + 4)
                    rows = response.get('output') or []
                received = now if fetch else datetime.now(KST)
                observe_trades(item['code'], rows, received, 'due-kis-request')
            except Exception:
                logger.warning('hour validation price unavailable (code=%s)', item['code'])
            fetched += 1
        return {'fetchedCodes': fetched, 'finalized': finalized}
    finally:
        _worker_lock.release()


def summary(model=None, code=None, group_by='model', start=None, end=None, scope='in-session'):
    columns = {'model': 'p.model', 'hour': 'p.bucket', 'code': 'p.code', 'direction': 'p.direction'}
    if group_by not in columns:
        raise ValueError('invalid grouping')
    filters, params = ['p.scope=?'], [scope]
    for field, value in (('p.model', model), ('p.code', code), ('p.checked_at', start)):
        if value:
            filters.append(field + ('>=?' if field == 'p.checked_at' else '=?'))
            params.append(value)
    if end:
        filters.append('p.checked_at<?')
        params.append(end)
    where = ' WHERE ' + ' AND '.join(filters) if filters else ''
    key = columns[group_by]
    conn = _connect()
    try:
        rows = conn.execute('''SELECT p.model AS model, ''' + key + ''' AS segment,
            p.direction AS direction, COUNT(*) AS predictions,
            SUM(o.state='evaluated') AS evaluated, SUM(o.state='excluded') AS excluded,
            SUM(o.prediction_id IS NULL) AS pending, SUM(o.hit) AS hits,
            SUM(o.actual_direction='flat') AS ties, AVG(o.change_pct) AS meanChangePct,
            AVG(o.signed_return_pct) AS meanSignedReturnPct,
            AVG(CASE WHEN o.signed_return_pct>0 THEN o.signed_return_pct END) AS meanWinPct,
            AVG(CASE WHEN o.signed_return_pct<0 THEN -o.signed_return_pct END) AS meanLossPct,
            SUM(CASE WHEN o.signed_return_pct>0 THEN o.signed_return_pct ELSE 0 END) AS winSum,
            SUM(CASE WHEN o.signed_return_pct<0 THEN -o.signed_return_pct ELSE 0 END) AS lossSum
            FROM predictions p LEFT JOIN outcomes o ON p.id=o.prediction_id''' + where +
            ' GROUP BY p.model,' + key + ',p.direction ORDER BY p.model,' + key + ',p.direction LIMIT 1001', params).fetchall()
        result = []
        for row in rows[:1000]:
            item = dict(row)
            for field in ('evaluated', 'excluded', 'pending', 'hits', 'ties'):
                item[field] = item[field] or 0
            item['hitRatePct'] = item['hits'] / item['evaluated'] * 100 if item['evaluated'] and item['direction'] != 'unclear' else None
            item['payoffRatio'] = item['meanWinPct'] / item['meanLossPct'] if item['meanLossPct'] and item['meanWinPct'] is not None else None
            item['profitFactor'] = item['winSum'] / item['lossSum'] if item['lossSum'] else None
            result.append(item)
        totals = conn.execute('''SELECT COUNT(*) AS predictions,
            SUM(p.direction='unclear') AS unclear, SUM(p.direction='up') AS up,
            SUM(p.direction='down') AS down, SUM(o.state='evaluated') AS evaluated,
            SUM(o.state='excluded') AS excluded, SUM(o.prediction_id IS NULL) AS pending,
            SUM(CASE WHEN p.direction!='unclear' AND o.state='evaluated' THEN 1 ELSE 0 END) AS directionalEvaluated,
            SUM(o.hit) AS hits FROM predictions p LEFT JOIN outcomes o ON p.id=o.prediction_id''' + where, params).fetchone()
        totals = {key: value or 0 for key, value in dict(totals).items()}
        totals['holdRatePct'] = totals['unclear'] / totals['predictions'] * 100 if totals['predictions'] else None
        totals['hitRatePct'] = totals['hits'] / totals['directionalEvaluated'] * 100 if totals['directionalEvaluated'] else None
        reasons = conn.execute('''SELECT o.exclusion AS reason,COUNT(*) AS count
            FROM predictions p JOIN outcomes o ON p.id=o.prediction_id''' + where +
            " AND o.state='excluded' GROUP BY o.exclusion", params).fetchall()
        selections = conn.execute('''SELECT o.selection AS method,COUNT(*) AS count,
            AVG(ABS(o.offset_sec)) AS meanAbsOffsetSec FROM predictions p
            JOIN outcomes o ON p.id=o.prediction_id''' + where +
            " AND o.state='evaluated' GROUP BY o.selection", params).fetchall()
        return {'policy': POLICY, 'validated': False, 'totals': totals, 'groups': result,
                'scope': scope,
                'exclusions': [dict(row) for row in reasons],
                'priceSelections': [dict(row) for row in selections],
                'truncated': len(rows) > 1000,
                'returnBasis': 'Gross hypothetical directional return; down=-price change, no fees/borrow/slippage',
                'dbBytes': os.path.getsize(_path()), 'maxDbBytes': MAX_DB_BYTES}
    finally:
        conn.close()


def prepare_store(legacy_file=None):
    """One-time bounded migration. Archive old logs byte-for-byte, do not rewrite them."""
    legacy_file = legacy_file or os.path.join(os.path.dirname(__file__), 'hour_candidate_checks.jsonl')
    conn = _connect()
    try:
        if conn.execute("SELECT 1 FROM metadata WHERE key='legacy_imported'").fetchone():
            return
    finally:
        conn.close()
    archive = os.path.join(os.path.dirname(_path()), 'hour_validation_archive')
    imported = 0
    for source in (legacy_file + '.1', legacy_file):
        if not os.path.exists(source):
            continue
        os.makedirs(archive, exist_ok=True)
        destination = os.path.join(archive, os.path.basename(source))
        if not os.path.exists(destination):
            shutil.copyfile(source, destination + '.tmp')
            os.replace(destination + '.tmp', destination)
        with open(destination, encoding='utf-8') as handle:
            for line in handle:
                try:
                    payload = json.loads(line)
                    for row in payload.get('rows', []):
                        verdict = row.get('directionVerdict')
                        if verdict and verdict.get('rulesVersion') == 'hour-direction-rules-v6':
                            record_prediction(verdict, payload.get('inputs', {}).get(row['code']))
                            imported += 1
                except (ValueError, KeyError, TypeError):
                    logger.warning('hour validation legacy malformed row skipped')
    conn = _connect()
    try:
        with conn:
            conn.execute("INSERT OR IGNORE INTO metadata VALUES('legacy_imported',?)", (str(imported),))
    finally:
        conn.close()


def backup_store():
    if not os.path.exists(_path()):
        return {'skipped': True}
    import backup_sqlite
    return backup_sqlite.backup_database(_path(), os.path.join(os.path.dirname(_path()), 'backups'), keep=7)


def records(after='', limit=100):
    if after:
        created, identity = after.split('|', 1)
        datetime.fromisoformat(created)
        if not re.fullmatch(r'[a-f0-9]{64}', identity):
            raise ValueError('invalid cursor')
    else:
        created, identity = '', ''
    conn = _connect()
    try:
        rows = conn.execute('''SELECT p.*,o.state,o.exclusion,o.price,o.price_at,o.offset_sec,
            o.selection,o.actual_direction,o.change_pct,o.signed_return_pct,o.hit,o.evidence_json
            FROM predictions p LEFT JOIN outcomes o ON p.id=o.prediction_id
            WHERE p.created_at>? OR (p.created_at=? AND p.id>?)
            ORDER BY p.created_at,p.id LIMIT ?''', (created, created, identity, min(limit, 100))).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item['snapshot'] = json.loads(zlib.decompress(item['snapshot'])) if item['snapshot'] else None
            for field in ('verdict_json', 'metrics_json', 'evidence_json'):
                value = item.pop(field)
                item[field[:-5]] = json.loads(value) if value else None
            result.append(item)
        return {'records': result, 'nextCursor': result[-1]['created_at'] + '|' + result[-1]['id'] if result else None}
    finally:
        conn.close()
