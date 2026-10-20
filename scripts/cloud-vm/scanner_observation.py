"""Bounded, passive scanner diagnostics. Never returns trading candidates.

Only already fetched rank rows are read. No broker, account, subscription,
credential, network or signal-state access is permitted in this module.
"""
import copy
from datetime import datetime, timezone, timedelta
from functools import wraps
import json
import math
import os
import threading
import time

ROOT = os.path.dirname(__file__)
PATH = os.path.join(ROOT, 'scanner_observation.json')
LOG = os.path.join(ROOT, 'scanner_observation.jsonl')
_lock = threading.RLock()
_started = time.time()
_calls = {}
_cache = {}
_pools = {}
_previous = {}
_write_error = False
KST = timezone(timedelta(hours=9))


def passive(fn):
    @wraps(fn)
    def safe(*args, **kwargs):
        global _write_error
        try:
            return fn(*args, **kwargs)
        except Exception:
            _write_error = True
            return None
    return safe


def count_cache(name, hit):
    with _lock:
        bucket = _cache.setdefault(name, {'hits': 0, 'misses': 0})
        bucket['hits' if hit else 'misses'] += 1


def measured(name):
    """Count public read invocations, not HTTP retry attempts or authentication."""
    def decorate(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            started, failed = time.perf_counter(), False
            try:
                return fn(*args, **kwargs)
            except Exception:
                failed = True
                raise
            finally:
                with _lock:
                    row = _calls.setdefault(name, {'calls': 0, 'errors': 0, 'totalSec': 0., 'maxSec': 0.})
                    elapsed = time.perf_counter()-started
                    row['calls'] += 1
                    row['errors'] += int(failed)
                    row['totalSec'] += elapsed
                    row['maxSec'] = max(row['maxSec'], elapsed)
        return wrapper
    return decorate


def _number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (ValueError, TypeError):
        return None


@passive
def observe(source, rows, errors=(), now=None):
    """Rank by amount proxy + same-source volume growth + newly seen entry.

    A score is research ordering only. Coverage is relative to this returned
    rank pool, NOT market-wide missed signals or profitable missed trades.
    """
    from kiwoom_9pay_observer import excluded_product, CODE
    now = time.time() if now is None else now
    day = datetime.fromtimestamp(now, KST).date().isoformat()
    valid = {}
    for row in rows:
        code = str(row.get('code', ''))
        volume, price = _number(row.get('trade_volume')), _number(row.get('price'))
        if CODE.fullmatch(code) and volume and price and not excluded_product(row.get('name')):
            valid[code] = row
    with _lock:
        if not _pools:
            try:
                with open(PATH,encoding='utf8') as f:
                    _pools.update(json.load(f).get('pools',{}))
            except (OSError,ValueError):
                pass
        prev = _previous.get(source, {})
        prior = _pools.get(source, {})
        same_day = prior.get('day') == day
        # No entry claims on cold start, after errors, long gaps or day rollover.
        comparable = (same_day and bool(prev) and not prior.get('errors') and not errors
                      and 0 < now - prior.get('observedAt', 0) <= 180)
        amount = sorted(valid, key=lambda c: valid[c]['price']*valid[c]['trade_volume'], reverse=True)
        amounts = {code: (len(amount)-i)/max(1,len(amount)) for i,code in enumerate(amount)}
        items = []
        for code, row in valid.items():
            old = prev.get(code)
            growth = None
            if comparable and old and row['trade_volume'] >= old['volume']:
                growth = (row['trade_volume']/old['volume']-1)*100
            entered = code not in prev if comparable else None
            items.append({'code':code, 'name':str(row.get('name') or code)[:80],
                          'amountProxy':row['price']*row['trade_volume'],
                          'volumeGrowthPct':growth, 'newEntry':entered,
                          'score':round(amounts[code] + (min(growth,100)/100 if growth is not None else 0)
                                        + (.25 if entered else 0), 6),
                          'observedAt':now, 'sourceAsOf':None})
        items.sort(key=lambda r:(-r['score'],r['code']))
        _previous[source] = {c:{'volume':r['trade_volume']} for c,r in valid.items()}
        _pools[source] = {'day':day, 'observedAt':now, 'sourceAsOf':None,
                          'lastSuccessAt':now if not errors and valid else prior.get('lastSuccessAt'),
                          'rawRows':len(rows), 'uniqueRows':len(valid),
                          'duplicateRows':len(rows)-len({str(r.get('code','')) for r in rows}),
                          'errors':list(errors), 'items':items[:240],
                          'candidateObservations':prior.get('candidateObservations',0) if same_day else 0,
                          'omittedObservations':prior.get('omittedObservations',0) if same_day else 0,
                          'cycles':prior.get('cycles',0)+1 if same_day else 1,
                          'cycleGapSec':now-prior['observedAt'] if same_day else None}
        if source!='kiwoom':
            _save(source)


@passive
def failure(source, error):
    with _lock:
        row = _pools.get(source)
        if row:
            row['errors'] = [str(error)[:80]]
            row['lastAttemptAt'] = time.time()
            _save(source)


@passive
def selection(codes):
    """Observe actual 20-slot subscription AFTER unchanged pinning logic."""
    with _lock:
        pool = _pools.get('kiwoom')
        if not pool:
            return
        universe = {r['code'] for r in pool['items']}
        actual = set(codes)
        omitted = universe-actual
        complete = not pool.get('errors')
        pool.update(selectedCount=len(actual), coveredCount=len(universe & actual),
                    omittedCount=len(omitted), omittedCodes=sorted(omitted),
                    omissionRate=len(omitted)/len(universe) if universe and complete else None,
                    candidateObservations=pool.get('candidateObservations',0)+(len(universe) if complete else 0),
                    omittedObservations=pool.get('omittedObservations',0)+(len(omitted) if complete else 0))
        _save('kiwoom')


def _save(source):
    global _write_error
    # Called only on existing rank refreshes (30/60s); bounded files, no thread.
    try:
        with open(PATH+'.tmp','w',encoding='utf8') as f:
            json.dump({'version':1,'pools':_pools},f,ensure_ascii=False,allow_nan=False)
        os.replace(PATH+'.tmp',PATH)
        if os.path.exists(LOG) and os.path.getsize(LOG)>4*1024*1024:
            os.replace(LOG,LOG+'.1')
        event = {k:v for k,v in _pools[source].items() if k not in ('items','omittedCodes')}
        event.update(source=source,version=1)
        with open(LOG,'a',encoding='utf8') as f:
            f.write(json.dumps(event,ensure_ascii=False,allow_nan=False)+'\n')
        _write_error = False
    except (OSError,ValueError):
        _write_error = True


def snapshot(now=None):
    now = time.time() if now is None else now
    with _lock:
        pools = copy.deepcopy(_pools)
        if not pools:
            try:
                with open(PATH,encoding='utf8') as f:
                    pools=json.load(f).get('pools',{})
            except (OSError,ValueError):
                pass
        for row in pools.values():
            row['ageSec']=max(0,now-row['observedAt'])
            row['stale']=now-row['observedAt']>90 or bool(row['errors'])
        return {'version':1,'mode':'observation-only','startedAt':_started,
                'calls':copy.deepcopy(_calls),'cache':copy.deepcopy(_cache),
                'pools':pools,'persistenceError':_write_error,
                'scope':'Returned ranking pool only; not market-wide signal omission. '
                        'Calls are read-function invocations since process start, excluding auth/retries. '
                        'Amount is close price × cumulative volume proxy; exchange as-of unavailable.'}
