"""Read-only 9Pay intraday research. One lightweight thread, shared Kiwoom hub.

Activated only by NINEPAY_RESEARCH_ENABLED=1. No account or order imports.
"""

import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import threading
import time

import kiwoom_9pay_observer as logic
import scanner_observation as scan_observation

logger = logging.getLogger('kiwoom_9pay_live')
KST = timezone(timedelta(hours=9))
RANK_INTERVAL = 60  # at most two Kiwoom REST ranking calls per minute
KIS_INTERVAL = 30   # reads existing in-memory KIS samples; no API calls
MAX_CODES = 20      # reserve at least 80 of hub's default 100 slots for existing users
LOG_PATH = os.path.join(os.path.dirname(__file__), 'kiwoom_9pay_research.jsonl')
STATE_PATH = os.path.join(os.path.dirname(__file__), 'kiwoom_9pay_state.json')
_lock = threading.Lock()
_thread = None
_status = {'ruleVersion': logic.VERSION, 'productPolicy': 'no-leverage-cash-v2', 'running': False, 'active': False, 'candidates': [],
           'candidateDetails': [], 'observations': {}, 'rankAt': None,
           'rankError': None, 'amountFallback': False, 'wsVolumeEvents': 0,
           'kisFallbackSamples': 0, 'signalCount': 0, 'signals': [], 'lastEventAt': None,
           'persistenceError': None, 'orderStatus': '미연동', 'coverageLimit': MAX_CODES}


def market_open(now=None):
    now = now or datetime.now(KST)
    import volume_surge_live
    return volume_surge_live.in_poll_window(now)


def _set(**values):
    with _lock:
        _status.update(values)


def health_snapshot():
    with _lock:
        return dict(_status, signals=list(_status['signals']), candidates=list(_status['candidates']),
                    candidateDetails=[dict(row) for row in _status['candidateDetails']],
                    items=[dict(row, **_status['observations'].get(row['code'], {}))
                           for row in _status['candidateDetails']],
                    observations={code: dict(row) for code, row in _status['observations'].items()})


def _observe_status(result):
    if result is None:
        return
    item = dict(result)
    with _lock:
        _status['observations'][result['code']] = item


def _persist(observer, day):
    try:
        payload = observer.export_state(day)
        snapshot = health_snapshot()
        payload.update({key: snapshot[key] for key in ('candidateDetails', 'observations', 'signals')})
        with open(STATE_PATH + '.tmp', 'w', encoding='utf-8') as out:
            json.dump(payload, out, ensure_ascii=False, allow_nan=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(STATE_PATH + '.tmp', STATE_PATH)
        _set(persistenceError=None)
        return True
    except (OSError, ValueError):
        _set(persistenceError='충족 시각 저장 실패 · 신규 신호 보류')
        logger.exception('9Pay evidence save failed')
        return False


def _restore(observer, day):
    try:
        with open(STATE_PATH, encoding='utf-8') as inp:
            data = json.load(inp)
        if not observer.restore_state(data, day):
            return
        blocked = {row['code'] for row in data.get('candidateDetails', [])
                   if logic.excluded_product(row.get('name'))}
        for code in blocked:
            observer.tracks.pop(code, None)
        signals = [row for row in data.get('signals', []) if row['code'] not in blocked
                   and not logic.excluded_product(row.get('name'))]
        recorded = {row['code'] for row in signals}
        for code, track in observer.tracks.items():
            if track.signal_at and code not in recorded:
                item = dict(data.get('observations', {}).get(code, {}))
                item.update(code=code, at=track.signal_at, price=track.signal_price,
                            signalId=day + ':' + code, branches=track.branches, restored=True)
                item.pop('signal', None)
                signals.append(item)
        _set(candidateDetails=[row for row in data.get('candidateDetails', []) if row['code'] not in blocked],
             observations={code: row for code, row in data.get('observations', {}).items() if code not in blocked}, signals=signals[-MAX_CODES:],
             signalCount=sum(bool(t.signal_at) for t in observer.tracks.values()))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        # Missing/corrupt evidence is never reconstructed from a later ratio.
        logger.info('9Pay current-day evidence not restored')


def _daily_context(conn, now, code):
    import market_clock
    expected = now - timedelta(days=1)
    while not market_clock.is_kr_trading_day(expected):
        expected -= timedelta(days=1)
    previous_day = expected.strftime('%Y-%m-%d')
    before = expected - timedelta(days=1)
    while not market_clock.is_kr_trading_day(before):
        before -= timedelta(days=1)
    rows = conn.execute('SELECT date,low,close,volume FROM daily_prices WHERE code=? AND date<=? '
                        'ORDER BY date DESC LIMIT 2', (code, previous_day)).fetchall()
    if not rows or rows[0][0] != previous_day:
        return {}
    ctx = {'previousDay': previous_day, 'prevClose': rows[0][2], 'prevVolume': rows[0][3]}
    if len(rows) == 2 and rows[1][0] == before.strftime('%Y-%m-%d'):
        ctx.update(lows=[rows[1][1], rows[0][1]], lowDates=[rows[1][0], rows[0][0]])
    return ctx


def _record(record):
    """Bound research log to ~1 MiB; no tokens, accounts, or raw frames."""
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 1024 * 1024:
            os.replace(LOG_PATH, LOG_PATH + '.1')
        with open(LOG_PATH, 'a', encoding='utf-8') as file:
            file.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')
    except OSError:
        logger.exception('9Pay research log write failed')


@scan_observation.measured('kiwoom.amount_rank')
def _amount_rank(client, token):
    return logic.fetch_amount_top(client, token, limit=60)


def _rank(appkey, secretkey):
    import db_schema
    import kiwoom_client
    import market_rank
    import volume_surge_live

    token = kiwoom_client.get_token(appkey, secretkey)
    volume = market_rank.fetch_volume_top(token, limit=60)
    if not volume:
        raise ValueError('empty volume ranking')
    fallback = False
    try:
        amount = _amount_rank(kiwoom_client.call_tr, token)
        if not amount:
            raise ValueError('empty amount ranking')
    except Exception as exc:
        logger.info('9Pay amount rank unavailable: %s', type(exc).__name__)
        amount, fallback = None, True
    rows = logic.candidates(volume, amount, limit=MAX_CODES)
    # Passive union BEFORE the unchanged 20-slot trading-compatible selection.
    scan_observation.observe('kiwoom', volume + (amount or []),
                             errors=['amount_unavailable'] if fallback else [])
    now = datetime.now(KST)
    previous, contexts = {}, {}
    conn = db_schema.get_conn()
    try:
        for row in rows:
            context = _daily_context(conn, now, row['code'])
            contexts[row['code']] = context
            if logic.positive(context.get('prevVolume')):
                previous[row['code']] = context['prevVolume']
    finally:
        conn.close()
    details = [{'code': row['code'], 'name': row.get('name'), 'rankPrice': row.get('price'),
                'tradeVolume': row.get('trade_volume'), 'tradeAmountRaw': row.get('trade_amount')}
               for row in rows]
    return [row['code'] for row in rows], previous, fallback, details, contexts


async def _run(appkey, secretkey):
    import kiwoom_ws_hub
    import volume_surge_live

    hub = kiwoom_ws_hub.start(appkey, secretkey)
    if hub is None:
        _set(rankError='키움 공유 허브 시작 불가')
        return
    sub = hub.subscribe([], loop=asyncio.get_running_loop(), maxsize=500, include_volume=True)
    ws = logic.Observer([], {})
    kis = ws  # One A OR B state across WS and polling; per-source volume baselines.
    last_ws_volume = {}
    signaled = set()
    candidates = []
    next_rank = next_kis = next_outcome = 0.0
    day = None
    try:
        while True:
            now = time.time()
            today = datetime.now(KST).strftime('%Y-%m-%d')
            if today != day:
                ws = logic.Observer([], {})
                kis = ws
                last_ws_volume.clear()
                signaled.clear()
                _set(candidates=[], candidateDetails=[], observations={}, signals=[],
                     signalCount=0, rankAt=None, rankError=None, amountFallback=False,
                     lastEventAt=None)
                day = today
                _restore(ws, day)
                signaled.update(code for code, track in ws.tracks.items() if track.signal_at)
                candidates = [code for code, track in ws.tracks.items() if track.first70_at][:MAX_CODES]
                sub.update(candidates)
                _set(candidates=candidates)
                next_rank = 0
            active = market_open()
            _set(active=active, queueDropped=sub.dropped_events)
            if not active:
                if candidates:
                    candidates = []
                    sub.update([])
                await asyncio.sleep(30)
                continue
            if now >= next_rank:
                next_rank = now + RANK_INTERVAL
                try:
                    codes, previous, fallback, details, contexts = await asyncio.to_thread(_rank, appkey, secretkey)
                    ranked_codes = list(codes)
                    pinned = sorted((code for code, track in ws.tracks.items() if track.first70_at),
                                    key=lambda code: (not bool(ws.tracks[code].first80_at), ws.tracks[code].first70_at))
                    codes = list(dict.fromkeys(pinned + codes))[:MAX_CODES]
                    scan_observation.selection(codes)
                    omitted = [code for code in ranked_codes if code not in codes]
                    metadata = {row['code']: row for row in health_snapshot()['candidateDetails']}
                    metadata.update({row['code']: row for row in details})
                    details = [metadata.get(code, {'code': code, 'name': None}) for code in codes]
                    candidates = codes
                    sub.update(codes)
                    for observer in (ws,):
                        observer.prev_volumes.update(previous)
                        observer.contexts.update(contexts)
                        for code in codes:
                            observer.tracks.setdefault(code, logic.Track())
                        for code in list(observer.tracks):
                            if code not in codes:
                                del observer.tracks[code]
                        observer.prev_volumes = {code: observer.prev_volumes[code] for code in codes if code in observer.prev_volumes}
                        observer.contexts = {code: observer.contexts[code] for code in codes if code in observer.contexts}
                    stamp = datetime.now(timezone.utc).isoformat()
                    with _lock:
                        _status.update(candidates=codes, candidateDetails=details,
                                       observations={code: _status['observations'][code]
                                                     for code in codes if code in _status['observations']},
                                       rankAt=stamp, rankError=None, amountFallback=fallback, capacityOmitted=omitted)
                    _record({'type': 'rank', 'at': stamp, 'codes': codes,
                             'rankedCodes': ranked_codes, 'capacityOmitted': omitted,
                             'amountFallback': fallback, 'prevVolumeKnown': len(previous)})
                except Exception as exc:
                    logger.exception('9Pay rank refresh failed')
                    scan_observation.failure('kiwoom', type(exc).__name__)
                    _set(rankError=type(exc).__name__)
            if now >= next_kis:
                next_kis = now + KIS_INTERVAL
                for code, sample in volume_surge_live.sample_snapshot(candidates).items():
                    at, volume, price = sample
                    received = time.time()
                    if received - at > 90 or received - last_ws_volume.get(code, 0) < 60:
                        continue
                    result = kis.observe(code, at, price, volume, source='KIS rank polling', received_at=received)
                    if result:
                        with _lock:
                            _status['kisFallbackSamples'] += 1
                        _consume(result, ws, day, signaled)
            if now >= next_outcome:
                next_outcome = now + 300
                for code in signaled:
                    track = ws.tracks.get(code)
                    if not track or track.signal_at is None:
                        track = kis.tracks.get(code)
                    if track and track.signal_at is not None:
                        _record({'type': 'outcome', 'code': code, 'at': now,
                                 'signalAt': track.signal_at, 'mfePct': track.mfe_pct,
                                 'maePct': track.mae_pct,
                                 'gapCount': track.gap_count, 'maxGapSec': track.max_gap_sec,
                                 'lastSampleAt': track.last_at})
                _persist(ws, day)
            try:
                event = await asyncio.wait_for(sub.queue.get(), timeout=1)
            except asyncio.TimeoutError:
                continue
            code = event.get('code')
            if code not in candidates:
                continue
            at = time.time()
            volume = event.get('volume')
            if volume is not None:
                last_ws_volume[code] = at
                with _lock:
                    _status['wsVolumeEvents'] += 1
            result = ws.observe(code, at, event.get('price'), volume,
                                open_price=event.get('openPrice'), received_at=time.time())
            _set(lastEventAt=datetime.now(timezone.utc).isoformat())
            if result:
                _consume(result, ws, day, signaled)
    finally:
        sub.close()


def _consume(result, observer, day, signaled):
    with _lock:
        old = dict(_status['observations'].get(result['code'], {}))
    _observe_status(result)
    _set(lastEventAt=datetime.now(timezone.utc).isoformat())
    milestones = ('first70At', 'first80At', 'stage', 'bSupportBroken', 'signalAt')
    changed = any(old.get(key) != result.get(key) for key in milestones)
    saved = _persist(observer, day) if changed else True
    if changed:
        _record({'type': 'stage', 'evidenceSaved': saved, **result})
    if result.get('signal') and saved:
        _handle_signal(result, signaled)
        _persist(observer, day)


def _handle_signal(result, signaled):
    code = result['code']
    if not result['signal'] or code in signaled:
        return
    signaled.add(code)
    item = dict(result)
    item.pop('signal', None)
    with _lock:
        item['name'] = next((row.get('name') for row in _status['candidateDetails']
                             if row['code'] == code), None)
    if logic.excluded_product(item['name']):
        return
    item['signalId'] = '%s:%s' % (datetime.fromtimestamp(result['at'], KST).strftime('%Y-%m-%d'), code)
    with _lock:
        _status['signalCount'] += 1
        _status['signals'] = (_status['signals'] + [item])[-20:]
    _record({'type': 'signal', **item})


def _thread_main(appkey, secretkey):
    _set(running=True)
    try:
        asyncio.run(_run(appkey, secretkey))
    except Exception:
        logger.exception('9Pay research observer stopped')
        _set(rankError='관찰기 중단')
    finally:
        _set(running=False)


def start_background(appkey, secretkey):
    global _thread
    if os.environ.get('NINEPAY_RESEARCH_ENABLED') != '1' or not appkey or not secretkey:
        return None
    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_thread_main, args=(appkey, secretkey),
                                   name='kiwoom-9pay-research', daemon=True)
        _thread.start()
    return _thread
