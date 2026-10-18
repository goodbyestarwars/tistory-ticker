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

logger = logging.getLogger('kiwoom_9pay_live')
KST = timezone(timedelta(hours=9))
RANK_INTERVAL = 60  # at most two Kiwoom REST ranking calls per minute
KIS_INTERVAL = 30   # reads existing in-memory KIS samples; no API calls
MAX_CODES = 20      # reserve at least 80 of hub's default 100 slots for existing users
LOG_PATH = os.path.join(os.path.dirname(__file__), 'kiwoom_9pay_research.jsonl')
_lock = threading.Lock()
_thread = None
_status = {'running': False, 'active': False, 'candidates': [], 'rankAt': None,
           'rankError': None, 'amountFallback': False, 'wsVolumeEvents': 0,
           'kisFallbackSamples': 0, 'signalCount': 0, 'signals': [], 'lastEventAt': None}


def market_open(now=None):
    now = now or datetime.now(KST)
    import volume_surge_live
    return volume_surge_live.in_poll_window(now)


def _set(**values):
    with _lock:
        _status.update(values)


def health_snapshot():
    with _lock:
        return dict(_status, signals=list(_status['signals']), candidates=list(_status['candidates']))


def _record(record):
    """Bound research log to ~1 MiB; no tokens, accounts, or raw frames."""
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 1024 * 1024:
            os.replace(LOG_PATH, LOG_PATH + '.1')
        with open(LOG_PATH, 'a', encoding='utf-8') as file:
            file.write(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n')
    except OSError:
        logger.exception('9Pay research log write failed')


def _rank(appkey, secretkey):
    import db_schema
    import kiwoom_client
    import market_rank
    import volume_surge_live

    token = kiwoom_client.get_token(appkey, secretkey)
    volume = market_rank.fetch_volume_top(token, limit=MAX_CODES)
    if not volume:
        raise ValueError('empty volume ranking')
    fallback = False
    try:
        amount = logic.fetch_amount_top(kiwoom_client.call_tr, token, limit=MAX_CODES)
        if not amount:
            raise ValueError('empty amount ranking')
    except Exception as exc:
        logger.info('9Pay amount rank unavailable: %s', type(exc).__name__)
        amount, fallback = None, True
    rows = logic.candidates(volume, amount, limit=MAX_CODES)
    date_str = datetime.now(KST).strftime('%Y-%m-%d')
    previous = {}
    conn = db_schema.get_conn()
    try:
        for row in rows:
            prior = volume_surge_live._prev_volume(conn, date_str, row['code'])
            if prior and prior[0] > 0:
                previous[row['code']] = prior[0]
    finally:
        conn.close()
    return [row['code'] for row in rows], previous, fallback


async def _run(appkey, secretkey):
    import kiwoom_ws_hub
    import volume_surge_live

    hub = kiwoom_ws_hub.start(appkey, secretkey)
    if hub is None:
        _set(rankError='키움 공유 허브 시작 불가')
        return
    sub = hub.subscribe([], loop=asyncio.get_running_loop(), maxsize=500, include_volume=True)
    ws = logic.Observer([], {})
    kis = logic.Observer([], {})
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
                ws, kis = logic.Observer([], {}), logic.Observer([], {})
                last_ws_volume.clear()
                signaled.clear()
                day = today
                next_rank = 0
            active = market_open()
            _set(active=active)
            if not active:
                if candidates:
                    candidates = []
                    sub.update([])
                    _set(candidates=[])
                await asyncio.sleep(30)
                continue
            if now >= next_rank:
                next_rank = now + RANK_INTERVAL
                try:
                    codes, previous, fallback = await asyncio.to_thread(_rank, appkey, secretkey)
                    candidates = codes
                    sub.update(codes)
                    for observer in (ws, kis):
                        observer.prev_volumes.update(previous)
                        for code in codes:
                            observer.tracks.setdefault(code, logic.Track())
                        for code in list(observer.tracks):
                            if code not in codes:
                                del observer.tracks[code]
                    stamp = datetime.now(timezone.utc).isoformat()
                    _set(candidates=codes, rankAt=stamp, rankError=None, amountFallback=fallback)
                    _record({'type': 'rank', 'at': stamp, 'codes': codes,
                             'amountFallback': fallback, 'prevVolumeKnown': len(previous)})
                except Exception as exc:
                    logger.exception('9Pay rank refresh failed')
                    _set(rankError=type(exc).__name__)
            if now >= next_kis:
                next_kis = now + KIS_INTERVAL
                for code, sample in volume_surge_live.sample_snapshot(candidates).items():
                    at, volume, price = sample
                    if now - at > 90 or now - last_ws_volume.get(code, 0) < 60:
                        continue
                    result = kis.observe(code, at, price, volume, source='KIS rank polling')
                    if result:
                        with _lock:
                            _status['kisFallbackSamples'] += 1
                        _handle_signal(result, signaled)
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
                                 'lastSampleAt': track.samples[-1][0] if track.samples else None})
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
            result = ws.observe(code, at, event.get('price'), volume)
            _set(lastEventAt=datetime.now(timezone.utc).isoformat())
            if result:
                _handle_signal(result, signaled)
    finally:
        sub.close()


def _handle_signal(result, signaled):
    code = result['code']
    if not result['signal'] or code in signaled:
        return
    signaled.add(code)
    item = {key: result[key] for key in ('code', 'at', 'source', 'volumeMissing', 'mfePct', 'maePct')}
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
