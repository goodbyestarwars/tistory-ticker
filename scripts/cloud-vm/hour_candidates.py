# -*- coding: utf-8 -*-
"""Manual morning candidate checks, with one consistent KIS/KRX feed.

No automatic signals, historical order-book substitutes, fitted probabilities,
or broker orders. Every live input is fetched after this request starts. Only
previous-session volume is cached. The public route has a bounded work budget.
"""

import json
import logging
import math
import os
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from datetime import datetime, timedelta, timezone

import kis_client
import market_clock
import hour_candidate_engine as engine
import hour_direction_engine as direction_engine
import hour_validation

KST = timezone(timedelta(hours=9))
MAX_DETAILS = 24
WORKERS = 3
SCAN_BUDGET_SEC = 30
CALL_TIMEOUT_SEC = 4
REQUEST_INTERVAL_SEC = 0.1  # Bound this feature's dispatches to at most 10/s.
MODEL_VERSION = 'hour-rules-v1'
_scan_lock = threading.Lock()
_previous_lock = threading.Lock()
_previous_cache = OrderedDict()
_record_lock = threading.Lock()
_request_clock_lock = threading.Lock()
_next_request_at = 0.0
RECORD_FILE = os.path.join(os.path.dirname(__file__), 'hour_candidate_checks.jsonl')
MAX_RECORD_BYTES = 5 * 1024 * 1024
logger = logging.getLogger('hour_candidates')
NOTE = ('확인 시 매도 1호가를 1주 매수 기준값으로 쓴 실험 필터다. '
        '실제 매수 체결·+3% 도달 확률·수익 우위는 검증 전이다. '
        '순위 밖 종목과 미평가 종목은 판단하지 않는다. 수수료·세금·슬리피지는 별도다.')


class BusyError(Exception):
    pass


class MinuteBoundaryError(Exception):
    pass


def _num(value):
    try:
        result = float(str(value).replace(',', ''))
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def in_check_window(now):
    now = now.astimezone(KST)
    return (market_clock.is_kr_trading_day(now)
            and (9, 5) <= (now.hour, now.minute) < (9, 15))


def in_direction_window(now):
    now = now.astimezone(KST)
    return (market_clock.is_kr_trading_day(now)
            and (9, 5) <= (now.hour, now.minute) < (14, 30))


def _source_time(value, day):
    """Preserve upstream clock. A missing clock must never become receipt time."""
    text = str(value or '').strip()
    if not re.fullmatch(r'\d{6}', text):
        return None
    try:
        return datetime.strptime(day + text, '%Y%m%d%H%M%S').replace(tzinfo=KST).isoformat()
    except ValueError:
        return None


def _request(token, key, secret, path, tr_id, params, deadline):
    global _next_request_at
    with _request_clock_lock:
        now_t = time.monotonic()
        dispatch_at = max(now_t, _next_request_at)
        if dispatch_at >= deadline:
            raise TimeoutError('check budget exhausted')
        _next_request_at = dispatch_at + REQUEST_INTERVAL_SEC
    if dispatch_at > now_t:
        time.sleep(dispatch_at - now_t)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('check budget exhausted')
    return kis_client._get_domestic_quote(
        token, key, secret, path, tr_id, params,
        timeout=min(CALL_TIMEOUT_SEC, remaining))


def _previous_day(now):
    day = now - timedelta(days=1)
    for _ in range(15):
        if market_clock.is_kr_trading_day(day):
            return day.strftime('%Y%m%d')
        day -= timedelta(days=1)
    return None


def _previous_volume(token, key, secret, code, now, deadline, rank_volume=None):
    previous_day = _previous_day(now)
    if not previous_day:
        return None
    volume = _num(rank_volume)
    if volume and volume > 0:
        return {'value': volume, 'date': datetime.strptime(previous_day, '%Y%m%d').date().isoformat(),
                'market': 'KRX', 'source': 'KIS'}
    cache_key = (now.date().isoformat(), code)
    with _previous_lock:
        cached = _previous_cache.get(cache_key)
        if cached:
            _previous_cache.move_to_end(cache_key)
            return dict(cached)
    data = _request(token, key, secret, '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
                    'FHKST03010100', {
                        'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code,
                        'FID_INPUT_DATE_1': (now - timedelta(days=14)).strftime('%Y%m%d'),
                        'FID_INPUT_DATE_2': previous_day, 'FID_PERIOD_DIV_CODE': 'D',
                        'FID_ORG_ADJ_PRC': '1',
                    }, deadline)
    rows = [row for row in (data.get('output2') or [])
            if row.get('stck_bsop_date') == previous_day]
    volume = _num(rows[0].get('acml_vol')) if rows else None
    if not volume or volume <= 0:
        return None
    result = {'value': volume, 'date': datetime.strptime(previous_day, '%Y%m%d').date().isoformat(),
              'market': 'KRX', 'source': 'KIS'}
    with _previous_lock:
        _previous_cache[cache_key] = result
        while len(_previous_cache) > 128:
            _previous_cache.popitem(last=False)
    return dict(result)


def _ranking_pool(token, key, secret, deadline):
    """Read fresh ranks; do not reuse the automatic surge detections."""
    merged, errors = {}, []
    for sort_code in ('0', '1', '3'):
        try:
            data = _request(token, key, secret, '/uapi/domestic-stock/v1/quotations/volume-rank',
                            'FHPST01710000', {
                                'FID_COND_MRKT_DIV_CODE': 'J', 'FID_COND_SCR_DIV_CODE': '20171',
                                'FID_INPUT_ISCD': '0000', 'FID_DIV_CLS_CODE': '0',
                                'FID_BLNG_CLS_CODE': sort_code, 'FID_TRGT_CLS_CODE': '111111111',
                                # Official 10-position mask: exclude risk/administrative,
                                # preferred shares, halts, ETF/ETN, SPAC from this stock pool.
                                'FID_TRGT_EXLS_CLS_CODE': '1111111101',
                                'FID_INPUT_PRICE_1': '', 'FID_INPUT_PRICE_2': '',
                                'FID_VOL_CNT': '', 'FID_INPUT_DATE_1': '',
                            }, deadline)
            for raw in (data.get('output') or [])[:30]:
                code = str(raw.get('mksc_shrn_iscd') or '').strip()
                if not re.fullmatch(r'[0-9A-Z]{6}', code):
                    continue
                row = {'code': code, 'name': raw.get('hts_kor_isnm') or code,
                       'previousVolume': raw.get('prdy_vol'),
                       'amount': _num(raw.get('acml_tr_pbmn')) or 0}
                if code in merged and not row['previousVolume']:
                    row['previousVolume'] = merged[code]['previousVolume']
                merged[code] = row
        except Exception:
            errors.append(sort_code)
            logger.info('manual hour rank unavailable (section=%s)', sort_code)
    return sorted(merged.values(), key=lambda row: (-row['amount'], row['code'])), errors


def _collect(row, token, key, secret, deadline, clock):
    now = clock().astimezone(KST)
    code, day = row['code'], now.strftime('%Y%m%d')
    previous = (None if row.get('_directionCheck') else
                _previous_volume(token, key, secret, code, now, deadline, row.get('previousVolume')))
    minute = _request(token, key, secret, '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
                      'FHKST03010230', {
                          'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code,
                          'FID_INPUT_HOUR_1': now.strftime('%H%M%S'), 'FID_INPUT_DATE_1': day,
                          'FID_PW_DATA_INCU_YN': 'N', 'FID_FAKE_TICK_INCU_YN': 'N',
                      }, deadline)
    raw_quote = _request(token, key, secret, '/uapi/domestic-stock/v1/quotations/inquire-price',
                         'FHKST01010100', {'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code}, deadline)
    raw_book = _request(token, key, secret, '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
                        'FHKST01010200', {'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code}, deadline)
    raw_trade = _request(token, key, secret, '/uapi/domestic-stock/v1/quotations/inquire-ccnl',
                         'FHKST01010300', {'FID_COND_MRKT_DIV_CODE': 'J', 'FID_INPUT_ISCD': code}, deadline)
    checked = clock().astimezone(KST)
    if now.replace(second=0, microsecond=0) != checked.replace(second=0, microsecond=0):
        raise MinuteBoundaryError('분봉을 받는 동안 분이 바뀌었다. 다시 눌러 완결 봉을 확인한다.')
    check_window = in_direction_window if row.get('_directionCheck') else in_check_window
    if not check_window(checked):
        raise MinuteBoundaryError('확인 가능 시간이 끝나 현재 자료를 판단할 수 없어.')
    quote, book = raw_quote.get('output') or {}, raw_book.get('output1') or {}
    trades = raw_trade.get('output') or []
    if isinstance(trades, dict):
        trades = [trades]
    trade = max(trades, key=lambda item: str(item.get('stck_cntg_hour') or ''), default={})
    bars = []
    for raw in minute.get('output2') or []:
        bars.append({'date': raw.get('stck_bsop_date'), 'time': raw.get('stck_cntg_hour'),
                     'open': _num(raw.get('stck_oprc')), 'high': _num(raw.get('stck_hgpr')),
                     'low': _num(raw.get('stck_lwpr')), 'close': _num(raw.get('stck_prpr')),
                     'volume': _num(raw.get('cntg_vol'))})
    book_time = _source_time(book.get('aspr_acpt_hour'), day)
    trade_time = _source_time(trade.get('stck_cntg_hour'), day)
    snapshot = {
        'code': code, 'name': quote.get('hts_kor_isnm') or row.get('name') or code,
        'checkedAt': checked.isoformat(), 'market': 'KRX', 'source': 'KIS',
        'minuteRequestedAt': now.isoformat(),
        'dataAsOf': max([t for t in (book_time, trade_time) if t], default=None),
        'bars': bars, 'previousVolume': previous,
        'quote': {'open': _num(quote.get('stck_oprc')), 'high': _num(quote.get('stck_hgpr')),
                  'base': _num(quote.get('stck_sdpr')), 'upperLimit': _num(quote.get('stck_mxpr')),
                  'tempStop': quote.get('temp_stop_yn')},
        'book': {'time': book_time,
                 'asks': [{'price': _num(book.get('askp%d' % i)), 'qty': _num(book.get('askp_rsqn%d' % i))}
                          for i in range(1, 11)],
                 'bids': [{'price': _num(book.get('bidp%d' % i)), 'qty': _num(book.get('bidp_rsqn%d' % i))}
                          for i in range(1, 11)]},
        'trade': {'time': trade_time, 'price': _num(trade.get('stck_prpr')),
                  'qty': _num(trade.get('cntg_vol')), 'strength': _num(trade.get('tday_rltv'))},
    }
    # Keep provider dates visible in the record; the engine independently enforces
    # today's contiguous closed bars rather than trusting response updatedAt.
    return snapshot


def _unknown(row, now, reason):
    return {'code': row['code'], 'name': row.get('name') or row['code'],
            'status': 'insufficient_data', 'reasons': [reason], 'metrics': {},
            'checkedAt': now.isoformat(), 'expiresAt': (now + timedelta(minutes=60)).isoformat(),
            'entryPrice': None, 'targetPrice': None, 'stopPrice': None, 'targetPct': None,
            'stopPct': None, 'probability': None}


def _record(payload, snapshots):
    """Bounded local audit trail for later forward validation; no IP or credentials."""
    if payload.get('directionModelVersion'):
        payload['validationRecords'] = {}
        for row in payload['items'] + payload['rejected'] + payload['unknown']:
            verdict = row.get('directionVerdict')
            if verdict:
                try:
                    payload['validationRecords'][row['code']] = hour_validation.record_prediction(verdict, snapshots.get(row['code']))
                except Exception:
                    logger.warning('hour validation prediction record unavailable')
    record = {'checkedAt': payload['checkedAt'], 'modelVersion': MODEL_VERSION,
              'criteria': payload['criteria'], 'coverage': payload['coverage'],
              'rows': payload['items'] + payload['rejected'] + payload['unknown'],
              'inputs': snapshots,
              'directionModelVersion': payload.get('directionModelVersion')}
    try:
        with _record_lock:
            if os.path.exists(RECORD_FILE) and os.path.getsize(RECORD_FILE) >= MAX_RECORD_BYTES:
                os.replace(RECORD_FILE, RECORD_FILE + '.1')
            with open(RECORD_FILE, 'a', encoding='utf-8') as handle:
                handle.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + '\n')
        payload['recorded'] = True
    except (OSError, ValueError):
        payload['recorded'] = False
        logger.warning('manual hour check record unavailable')


def scan(mode, code='', name='', settings=None, key='', secret='', clock=None, pool_fetcher=None, collector=None, include_direction=False):
    clock = clock or (lambda: datetime.now(KST))
    started = clock().astimezone(KST)
    if mode not in ('ranked', 'selected'):
        raise ValueError('unsupported manual check mode')
    if mode == 'selected' and not re.fullmatch(r'[0-9A-Z]{6}', code):
        raise ValueError('invalid domestic stock code')
    criteria = engine.validate_settings(settings)
    payload = {'state': 'ready', 'checkedAt': started.isoformat(), 'scanStartedAt': started.isoformat(),
               'expiresAt': (started + timedelta(minutes=60)).isoformat(), 'modelVersion': MODEL_VERSION,
               'probability': None, 'criteria': dict(criteria, targetPct=3, stopPct=-3, horizonMinutes=60),
               'items': [], 'rejected': [], 'unknown': [], 'note': NOTE,
               'coverage': {'mode': mode, 'scope': 'KIS 거래량·거래증가율·거래대금 순위' if mode == 'ranked' else '선택 종목',
                            'universeCount': None, 'poolCount': 0, 'evaluatedCount': 0,
                            'skippedCount': 0, 'fullMarket': False, 'failedRankSections': []}}
    if include_direction:
        payload['directionModelVersion'] = direction_engine.MODEL_VERSION
        payload['criteria'].update(objective='direction', targetPct=None, stopPct=None)
    check_window = in_direction_window if include_direction else in_check_window
    if not check_window(started):
        note = ((direction_engine.outside_reason(started) if market_clock.is_kr_trading_day(started) else '오늘은 국내장이 쉬는 날이야.') if include_direction else
                '국내 거래일 09:05~09:15에 직접 확인하는 오전 실험 필터다. 현재 호가로 과거 시각을 대체하지 않는다.')
        payload.update(state='outside_window', note=note)
        return payload
    if not key or not secret:
        raise RuntimeError('KIS manual check unavailable')
    if not _scan_lock.acquire(blocking=False):
        raise BusyError('manual check already running')
    futures, pool, release_guard = {}, None, threading.Lock()
    released = [False]

    def release_when_finished(_future=None):
        with release_guard:
            if not released[0] and all(future.done() for future in futures):
                released[0] = True
                _scan_lock.release()

    try:
        deadline = time.monotonic() + SCAN_BUDGET_SEC
        token = kis_client.get_token(key, secret)
        if mode == 'selected':
            rows, rank_errors = [{'code': code, 'name': name or code}], []
        else:
            rows, rank_errors = (pool_fetcher or _ranking_pool)(token, key, secret, deadline)
        payload['coverage'].update(poolCount=len(rows), skippedCount=max(0, len(rows) - MAX_DETAILS),
                                   failedRankSections=rank_errors)
        if rank_errors:
            payload['note'] += ' 순위 %d개 항목을 받지 못해 확인 범위가 더 좁아졌다.' % len(rank_errors)
        if not rows and rank_errors:
            raise RuntimeError('KIS ranks unavailable')
        pool = ThreadPoolExecutor(max_workers=1 if include_direction else WORKERS, thread_name_prefix='hour-check')
        snapshots, results = {}, {}
        for row in rows[:MAX_DETAILS]:
            if include_direction:
                row['_directionCheck'] = True
            future = pool.submit(collector or _collect, row, token, key, secret, deadline, clock)
            futures[future] = row
        try:
            for future in as_completed(futures, timeout=max(0, deadline - time.monotonic())):
                row = futures[future]
                try:
                    snapshot = future.result()
                    result = engine.evaluate(snapshot, criteria, lookback_minutes=direction_engine.LOOKBACK_MINUTES if include_direction else None)
                    if include_direction:
                        result['directionVerdict'] = direction_engine.evaluate_direction(snapshot, result)
                    snapshots[row['code']] = snapshot
                except MinuteBoundaryError as exc:
                    result = _unknown(row, clock().astimezone(KST), str(exc))
                except Exception:
                    result = _unknown(row, clock().astimezone(KST), '현재 자료를 받지 못해 판단할 수 없다.')
                    logger.info('manual hour detail unavailable (code=%s)', row['code'])
                results[row['code']] = result
        except TimeoutError:
            pass
        for future, row in futures.items():
            if row['code'] not in results:
                future.cancel()
                results[row['code']] = _unknown(row, clock().astimezone(KST), '확인 제한 시간을 넘겨 판단할 수 없다. 다시 눌러 확인한다.')
        completed = clock().astimezone(KST)
        for row in rows[:MAX_DETAILS]:
            result = results[row['code']]
            snapshot = snapshots.get(row['code'])
            if include_direction and 'directionVerdict' not in result:
                result['directionVerdict'] = direction_engine.unclear(row['code'], row.get('name'), result['checkedAt'], result['reasons'][0])
            verdict = result.get('directionVerdict')
            if snapshot and (result['status'] == 'candidate' or (verdict and verdict['direction'] in ('up', 'down'))):
                live_times = [snapshot.get(section, {}).get('time') for section in ('book', 'trade')]
                try:
                    ages = [(completed - datetime.fromisoformat(value)).total_seconds() for value in live_times]
                except (ValueError, TypeError):
                    ages = [float('inf')]
                if not check_window(completed) or any(age < 0 or age > engine.MAX_LIVE_AGE_SEC for age in ages):
                    reason = ('확인 가능 시간이 끝났어. 다음 거래일에 다시 확인해줘.' if not check_window(completed) else
                              '결과를 받는 동안 호가·체결 자료가 10초를 넘게 오래됐습니다. 다시 확인해줘.')
                    if result['status'] == 'candidate':
                        result['status'] = 'insufficient_data'
                        result['reasons'] = [reason]
                    if verdict:
                        result['directionVerdict'] = direction_engine.unclear(row['code'], row.get('name'), result['checkedAt'], reason)
                else:
                    result['metrics']['deliveryMaxAgeSec'] = max(ages)
            payload[{'candidate': 'items', 'rejected': 'rejected', 'insufficient_data': 'unknown'}[result['status']]].append(result)
        payload['coverage']['evaluatedCount'] = len(results)
        payload['checkedAt'] = completed.isoformat()
        payload['scanCompletedAt'] = completed.isoformat()
        payload['expiresAt'] = (datetime.fromisoformat(payload['checkedAt']) + timedelta(minutes=60)).isoformat()
        _record(payload, snapshots)
        return payload
    finally:
        if pool:
            pool.shutdown(wait=False, cancel_futures=True)
        # Keep the global work bound until timed-out running HTTP reads finish.
        for future in futures:
            future.add_done_callback(release_when_finished)
        release_when_finished()


def check_direction(code, name='', **kwargs):
    """One manually chosen stock, fixed criteria, no ranking or signal cache."""
    payload = scan('selected', code=code, name=name, include_direction=True, **kwargs)
    rows = payload['items'] + payload['rejected'] + payload['unknown']
    row = rows[0] if rows else None
    verdict = row.get('directionVerdict') if row else None
    if verdict is None:
        reason = (row['reasons'][0] if row else
                  payload['note'])
        verdict = direction_engine.unclear(code, name, row['checkedAt'] if row else payload['checkedAt'], reason)
    # Internal evidence stays in the local record. The public selected-stock
    # view needs only one verdict and a short reason, never candidate buckets.
    result = {key: value for key, value in verdict.items() if key != 'metrics'}
    result['reason'] = direction_engine.brief_reason(result['reason'])
    result.update(sourceStatus=payload['state'], recorded=payload.get('recorded', False))
    identity = payload.get('validationRecords', {}).get(code)
    if payload['state'] == 'outside_window':
        try:
            identity = hour_validation.record_prediction(verdict, scope='outside-window')
        except Exception:
            logger.warning('hour validation outside-window record unavailable')
    result.update(predictionId=identity, validationRecorded=bool(identity))
    return result
