"""Aggregate the existing Oracle close and scanner snapshots for the market briefing."""
import json
import math
import sqlite3
import time
from functools import lru_cache
from threading import Lock
from datetime import timedelta
from pathlib import Path
from statistics import median

import db_schema
import index_daily_history
import pattern_detect
from market_calendar import is_kr_trading_day

MARKETS = ('KOSPI', 'KOSDAQ')
WINDOWS = (5, 20, 60, 224)
MASTER_PREFIX = 'window.DCF_MARKETS='
_chart_cache = {'key': None, 'until': 0, 'data': None}
_history_lock = Lock()


class HistoryBusy(Exception):
    pass


def _previous_session(day):
    day -= timedelta(days=1)
    while not is_kr_trading_day(day):
        day -= timedelta(days=1)
    return day


def close_basis(now):
    day = now.date()
    # The existing daily scanner starts after 20:00 KST. Never use today's intraday bar.
    if now.hour < 20 or not is_kr_trading_day(day):
        day = _previous_session(day)
    return day


def _master_path():
    here = Path(__file__).resolve().parent
    root = here if (here / 'scripts' / 'cloud-vm').is_dir() else here.parent.parent
    return root / 'dcf-data' / 'markets.js'


def load_members(path):
    source = path.read_text(encoding='utf-8').strip()
    if not source.startswith(MASTER_PREFIX) or not source.endswith(';'):
        raise ValueError('invalid DCF market master')
    master = json.loads(source[len(MASTER_PREFIX):-1])
    markets, preferred = master['markets'], master.get('preferredFlags') or {}
    return {
        code: markets[code] for code, name in master['stocks'].items()
        if markets.get(code) in MARKETS and preferred.get(code) not in ('1', '2')
        and not pattern_detect.is_excluded_stock({'name': name}, None)
    }


def _ma_stats(windows):
    result = {}
    for window, values in windows.items():
        above, sample = sum(values), len(values)
        result[str(window)] = {
            'above': above, 'sample': sample,
            'pct': round(100 * above / sample, 1) if sample else None,
        }
    return result


def _market_result(returns, windows, index_change):
    count = len(returns)
    middle = median(returns) if count else None
    return {
        'indexChangePct': round(index_change, 4) if index_change is not None else None,
        'medianChangePct': round(middle, 4) if middle is not None else None,
        'gapPp': round(index_change - middle, 4) if index_change is not None and middle is not None else None,
        'sample': count,
        'up': sum(value > 0 for value in returns),
        'down': sum(value < 0 for value in returns),
        'flat': sum(value == 0 for value in returns),
        'aboveMA': _ma_stats(windows),
    }


def _positive(value):
    return isinstance(value, (float, int)) and math.isfinite(value) and value > 0


def _iso_day(day):
    return day[:4] + '-' + day[4:6] + '-' + day[6:]


def market_summary(conn, members, basis, previous=None):
    """Compare exact trading dates; every MA window has its own valid denominator."""
    returns = {market: [] for market in MARKETS}
    windows = {market: {window: [] for window in WINDOWS} for market in MARKETS}
    results = {}
    series, dates = {}, set()
    for market in MARKETS:
        chart = db_schema.load_future_chart(conn, market, limit_days=250)
        closes = {_iso_day(row['date']): row['close'] for row in chart if _positive(row['close'])}
        confirmed = {row['date']: row['close'] for row in index_daily_history.peek(market)['rows']
                     if row.get('confirmed') is True and _positive(row.get('close'))}
        series[market] = closes, confirmed
        dates.update(day for rows in series[market] for day in rows if day < basis)
    sessions = [basis] + sorted(dates, reverse=True)[:WINDOWS[-1] - 1]
    previous = previous or (sessions[1] if len(sessions) > 1 else None)
    start = min(previous or basis, sessions[-1])
    for market in MARKETS:
        index_change = next(((rows[basis] / rows[previous] - 1) * 100
                             for rows in series[market] if basis in rows and previous in rows), None)
        for code, exchange in members.items():
            if exchange != market:
                continue
            bars = {
                day: (close, volume) for day, close, volume in conn.execute(
                    'SELECT date, close, volume FROM daily_prices WHERE code=? AND date BETWEEN ? AND ?',
                    (code, start, basis))
                if _positive(close)
            }
            latest = bars.get(basis)
            if latest is None or not _positive(latest[1]):
                continue
            if previous in bars:
                returns[market].append((latest[0] / bars[previous][0] - 1) * 100)
            for window in WINDOWS:
                days = sessions[:window]
                if len(days) == window and all(day in bars for day in days):
                    windows[market][window].append(latest[0] * window > math.fsum(bars[day][0] for day in days))
        results[market] = _market_result(returns[market], windows[market], index_change)
    results['all'] = {'aboveMA': _ma_stats({
        window: windows['KOSPI'][window] + windows['KOSDAQ'][window] for window in WINDOWS
    })}
    return {'asOf': basis, 'previousDate': previous, 'markets': results}


def _has_market_data(summary):
    return any(row['indexChangePct'] is not None or row['sample']
               or any(window['sample'] for window in row['aboveMA'].values())
               for market, row in summary['markets'].items() if market in MARKETS)


def cached_market_summary(conn, day):
    path = _master_path()
    key = (day, path.stat().st_mtime_ns)
    now = time.monotonic()
    if _chart_cache['key'] != key or now >= _chart_cache['until']:
        members = load_members(path)
        # Keep every denominator on the same SQLite snapshot while the nightly batch writes.
        with conn:
            conn.execute('BEGIN')
            summary = market_summary(conn, members, day.isoformat(), _previous_session(day).isoformat())
        _chart_cache.update(key=key, until=now + 15 * 60, data=summary if _has_market_data(summary) else None)
    return _chart_cache['data']


def scanner_summary(conn, scan_cache, basis, now):
    from shape_scan import public_snapshot

    current = (scan_cache or {}).get('shapeSelection')
    if (not isinstance(current, dict) or current.get('status') != 'ok'
            or current.get('strategyVersion') != 'chart-first-v2'
            or scan_cache.get('dataDate') != basis):
        return None
    snapshot = public_snapshot(current, now=now, basis=basis)
    if not snapshot:
        return None

    return _scanner_counts(conn, basis, snapshot, current)


def _scanner_counts(conn, basis, snapshot=None, current=None):
    from shape_scan import GROUPS

    # Tracks count newly registered observations before the final menu filters. Compare
    # tracks with tracks, and only use dates on which the DB actually has track rows.
    prefix = 'pattern:shape-v2:'
    try:
        rows = conn.execute(
            'SELECT scanner, detected_date, COUNT(DISTINCT code) FROM pattern_tracks '
            "WHERE scanner IN (%s) AND detected_date BETWEEN date(?, '-30 days') AND ? "
            'GROUP BY scanner, detected_date' % ','.join('?' for _ in GROUPS),
            (*(prefix + key for key in GROUPS), basis, basis))
        counts = {(name[len(prefix):], date): count for name, date, count in rows}
    except sqlite3.OperationalError as error:
        if 'no such table: pattern_tracks' not in str(error):
            raise
        counts = {}

    if snapshot is None and not any(date == basis for _, date in counts):
        return None
    prior_date = max((date for key, date in counts if date < basis), default=None)
    return {
        'asOf': basis,
        'previousTrackDate': prior_date,
        'groups': {
            key: {
                'candidates': (len({row['code'] for row in snapshot['groups'][key] if row.get('code')})
                               if current and key in current['groups'] else None),
                'tracked': counts.get((key, basis)),
                'trackDelta': (counts[key, basis] - counts[key, prior_date]
                               if (key, basis) in counts and (key, prior_date) in counts else None),
            } for key in GROUPS
        },
    }


def ensure_history_schema(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS market_temp_close_history ('
                 'date TEXT NOT NULL PRIMARY KEY, overview_json TEXT NOT NULL)')


def save_history(conn, day, overview):
    if not any(overview.values()):
        return
    saved = _saved_overview(conn, day)
    saved.update({key: value for key, value in overview.items() if value is not None})
    row = (day, json.dumps(saved, ensure_ascii=False, separators=(',', ':')))
    with conn:
        conn.execute(
            'INSERT INTO market_temp_close_history(date, overview_json) VALUES (?, ?) '
            'ON CONFLICT(date) DO UPDATE SET overview_json=excluded.overview_json '
            'WHERE overview_json != excluded.overview_json', row)


def _saved_overview(conn, day):
    try:
        row = conn.execute('SELECT overview_json FROM market_temp_close_history WHERE date=?', (day,)).fetchone()
    except sqlite3.OperationalError as error:
        if 'no such table: market_temp_close_history' not in str(error):
            raise
        return {}
    return json.loads(row[0]) if row else {}


@lru_cache(maxsize=32)
def _reconstruct_market(day, master_path, master_mtime, cache_window):
    members = load_members(master_path)
    conn = db_schema.get_conn(read_only=True)
    try:
        conn.execute('BEGIN')
        summary = market_summary(conn, members, day)
    finally:
        conn.close()
    return summary if _has_market_data(summary) else None


def historical_overview(day):
    basis = day.isoformat()
    if not is_kr_trading_day(day):
        return {'market': None, 'scanners': None}
    conn = db_schema.get_conn(read_only=True)
    try:
        saved = _saved_overview(conn, basis)
        scanners = saved.get('scanners') or _scanner_counts(conn, basis)
    finally:
        conn.close()
    market = saved.get('market')
    if market is None:
        if not _history_lock.acquire(blocking=False):
            raise HistoryBusy
        try:
            path = _master_path()
            market = _reconstruct_market(basis, path, path.stat().st_mtime_ns, int(time.monotonic() // 900))
        finally:
            _history_lock.release()
    return {'market': market, 'scanners': scanners}
