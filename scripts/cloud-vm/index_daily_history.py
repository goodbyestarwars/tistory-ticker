"""Persistent KIS index OHLCV. HTTP readers never wait for KIS backfill.

Two small atomic JSON snapshots, one serial worker, no new process or timer.
Only provisional/latest and newly missing dates are requested after backfill.
"""
import concurrent.futures
import json
import logging
import os
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='index-history')
_guard = threading.Lock()
_jobs = {}
logger = logging.getLogger(__name__)


def _path(market):
    if market not in ('KOSPI', 'KOSDAQ'):
        raise ValueError('unsupported index')
    return os.path.join(DIRECTORY, 'index_daily_history_%s.json' % market)


def _load(market):
    try:
        with open(_path(market), encoding='utf-8') as fh:
            data = json.load(fh)
        if data.get('version') == 1 and data.get('source') == 'kis':
            return data
    except (OSError, ValueError, AttributeError):
        pass
    return {'version': 1, 'source': 'kis', 'rows': [], 'lastAttempt': 0}


def _save(market, data):
    # Never truncate the last valid snapshot, including on a crash/disk error.
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=DIRECTORY,
                                         prefix='index_history_', suffix='.tmp', delete=False) as fh:
            name = fh.name
            json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(name, _path(market))
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def _stamp(now):
    return now.isoformat()


def _refresh(market, fetch_range):
    data = _load(market)
    now = datetime.now(KST)
    today = now.strftime('%Y-%m-%d')
    rows = data.get('rows') or []
    if rows:
        provisional = [r['date'] for r in rows if not r.get('confirmed')]
        start = min(provisional) if provisional else (
            datetime.strptime(rows[-1]['date'], '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    else:
        start = (now - timedelta(days=1100)).strftime('%Y-%m-%d')
    data['lastAttempt'] = time.time()
    data['lastAttemptAt'] = _stamp(now)
    try:
        fresh = fetch_range(market, start, today) if start <= today else []
        if not rows and len(fresh) < 2:
            raise RuntimeError('KIS backfill returned no usable history')
        # An empty intraday response is a failure; an empty holiday range is valid.
        if not fresh and rows and start <= today:
            if start <= rows[-1]['date']:
                raise RuntimeError('KIS provisional candle refresh unavailable')
            import market_clock
            if market_clock.is_kr_trading_day(now):
                raise RuntimeError('KIS incremental history unavailable')
        collected = datetime.now(KST)
        merged = {r['date']: r for r in rows}
        for row in fresh:
            if not start <= row['date'] <= today:
                continue
            point = dict(row, source='kis', collectedAt=_stamp(collected), confirmed=row['date'] < today)
            merged[row['date']] = point
        data['rows'] = [merged[key] for key in sorted(merged)][-900:]
        data.update(lastSuccessAt=_stamp(collected), lastSuccess=time.time(), lastError=None,
                    backfillComplete=True)
    except Exception as exc:
        logger.warning('KIS %s history refresh failed: %s', market, exc)
        data['lastError'] = str(exc)
        data['lastErrorAt'] = _stamp(now)
    _save(market, data)


def get(market, fetch_range):
    """Return disk data immediately; share one background request per market.

    Freshness is 60s during the domestic active window, 6h while idle. Failure
    backoff remains 60s. Persistence also retains error/success timestamps.
    """
    import market_clock
    with _guard:
        data = _load(market)
        now = time.time()
        ttl = 60 if market_clock.kr_market_active() else 21600
        job = _jobs.get(market)
        refreshing = bool(job and not job.done())
        retry_at = data.get('lastAttempt', 0) + 60
        due = now - data.get('lastSuccess', 0) >= ttl
        if not refreshing and due and now >= retry_at:
            _jobs[market] = _pool.submit(_refresh, market, fetch_range)
            refreshing = True
        rows = data.get('rows') or []
        stale = due or bool(data.get('lastError'))
        metadata = {key: data.get(key) for key in
                    ('lastSuccessAt', 'lastAttemptAt', 'lastError', 'lastErrorAt', 'backfillComplete')}
        metadata.update(refreshing=refreshing, stale=stale, usingLastValid=bool(rows and stale),
                        asOf=rows[-1]['date'] if rows else None, volumeUnit='unverified',
                        retryAfterMs=2000 if refreshing else max(1000, int((retry_at-now)*1000)) if data.get('lastError') else 60000,
                        state='refreshing' if refreshing else 'stale' if stale else 'ready')
        return {'source': 'kis', 'rows': rows, 'errors': [data['lastError']] if data.get('lastError') else [], 'cache': metadata}
