# -*- coding: utf-8 -*-
"""매물대 실제 체결가 일별 수집기(2026-09-15).

사용자 결정("응 그렇게 진행해"): 종목분석·MY 매물대는 지금 최근 120거래일 일봉 추정치를 쓴다. 더 정확한
실제 체결가 매물대로 옮기려면 여러 거래일의 체결가별 거래량이 쌓여 있어야 하는데, KIS 당일가격대별
매물대(FHPST01130000, HTS [0113])는 오늘치만 주고, 지금까지는 누군가 `/pbar-tratio`를 조회한 날만
`volume_profile_daily`에 저장됐다(라이브 실측 삼성전자 17일·SK하이닉스 7일, 날짜 띄엄띄엄).

이 수집기는 FastAPI 프로세스 안의 스레드 하나로(별도 프로세스·타이머 없음), KRX 거래일
18:10~20:00 KST(시간외 단일가 18:00 종료 뒤, 저녁 스캔 20:10 전)에 하루 한 번 대상 종목의 당일
매물대를 받아 같은 테이블에 저장한다. 저장 형식은 `/pbar-tratio`와 같다(같은 날은 덮어쓰기).

대상: 종목판 캐시의 국내 순위 종목(거래대금·거래량·시가총액 등 상위) + 최근 30일 안에 저장된 종목,
합쳐 최대 MAX_CODES. 요청 사이에 REQUEST_GAP_SEC를 둬 KIS REST 한도를 다른 수집기와 나눠 쓴다.
연속 실패가 MAX_CONSECUTIVE_FAILURES에 닿으면 멈추고 10분 뒤 다시 시도한다.

DB 크기 가늠: 종목·날짜당 가격 수십~수백 행이라 120종목 × 보존 200일이면 수백만 행 수준이다.
상태는 `/health/volume-profile`로 본다. 앱키는 상태·로그에 담지 않는다.
"""

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import db_schema
import kis_client
import market_clock

logger = logging.getLogger('volume_profile_collector')

KST = timezone(timedelta(hours=9))
RUN_START_MIN = 18 * 60 + 10
RUN_END_MIN = 20 * 60
MAX_CODES = 120
RECENT_DAYS = 30
REQUEST_GAP_SEC = 0.3
CHECK_SEC = 60
RETRY_AFTER_FAILURE_SEC = 10 * 60
MAX_CONSECUTIVE_FAILURES = 10
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'volume_profile_collector_state.json')
_CODE_RE = re.compile(r'^[0-9][0-9A-Z]{5}$')

_lock = threading.Lock()
_state = {
    'lastRunDate': None,
    'lastRun': None,
    'running': False,
    'retryAfter': 0.0,
    'lastError': None,
}
_thread = None


def _num(value):
    try:
        return float(str(value).replace(',', '').replace('+', ''))
    except (TypeError, ValueError):
        return 0.0


def aggregate_rows(rows):
    """KIS pbar-tratio output2 → [{price, volume}] 가격 오름차순. `/pbar-tratio`와 같은 필드·같은 규칙
    (stck_prpr 체결가, cntg_vol 그 가격 체결거래량, 가격 0 이하는 버림)."""
    bins = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        price = _num(row.get('stck_prpr'))
        volume = _num(row.get('cntg_vol'))
        if price <= 0:
            continue
        bins[price] = bins.get(price, 0.0) + volume
    return [{'price': price, 'volume': volume} for price, volume in sorted(bins.items())]


def select_codes(board_codes, recent_codes, limit=MAX_CODES):
    """순위 종목을 먼저, 최근 저장 종목을 뒤에 - 중복·잘못된 코드를 빼고 limit개까지."""
    result = []
    seen = set()
    for raw in list(board_codes or []) + list(recent_codes or []):
        code = str(raw or '').strip().upper()
        if code in seen or not _CODE_RE.match(code):
            continue
        seen.add(code)
        result.append(code)
        if len(result) >= limit:
            break
    return result


def should_run(now_kst, last_run_date):
    if not market_clock.is_kr_trading_day(now_kst):
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    if not (RUN_START_MIN <= minutes < RUN_END_MIN):
        return False
    return last_run_date != now_kst.strftime('%Y-%m-%d')


def run_once(appkey, appsecret, codes, now_kst=None, fetch=None, get_conn=None, sleep=time.sleep):
    now_kst = now_kst or datetime.now(KST)
    trade_date = now_kst.strftime('%Y-%m-%d')
    get_conn = get_conn or db_schema.get_conn
    if fetch is None:
        def fetch(code):
            token = kis_client.get_token(appkey, appsecret)
            return kis_client.fetch_pbar_tratio(token, appkey, appsecret, code)[1]
    started = time.time()
    stored = failed = rows_written = consecutive = 0
    stopped_early = False
    last_error = None
    conn = get_conn()
    try:
        for index, code in enumerate(codes):
            if index:
                sleep(REQUEST_GAP_SEC)
            try:
                bins = aggregate_rows(fetch(code))
            except Exception as exc:
                failed += 1
                consecutive += 1
                last_error = '%s: %s' % (type(exc).__name__, str(exc)[:160])
                if consecutive >= MAX_CONSECUTIVE_FAILURES:
                    stopped_early = True
                    break
                continue
            consecutive = 0
            if not bins:
                continue
            db_schema.upsert_volume_profile_daily(conn, code, trade_date, bins)
            stored += 1
            rows_written += len(bins)
    finally:
        conn.close()
    return {
        'date': trade_date,
        'requested': len(codes),
        'stored': stored,
        'failed': failed,
        'rows': rows_written,
        'stoppedEarly': stopped_early,
        'lastError': last_error,
        'durationSec': round(time.time() - started, 1),
    }


def _load_state_file():
    try:
        with open(STATE_FILE, encoding='utf-8') as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_state_file(payload):
    tmp = STATE_FILE + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
    except OSError:
        logger.warning('매물대 수집 상태 파일 저장 실패')


def _run_scheduled(appkey, appsecret, board_codes_fn, now_kst):
    try:
        board_codes = board_codes_fn() or []
    except Exception as exc:
        board_codes = []
        logger.info('매물대 수집 대상 순위 조회 실패: %s', exc)
    since = (now_kst - timedelta(days=RECENT_DAYS)).strftime('%Y-%m-%d')
    conn = db_schema.get_conn()
    try:
        recent_codes = db_schema.list_volume_profile_codes(conn, since)
    finally:
        conn.close()
    codes = select_codes(board_codes, recent_codes)
    if not codes:
        with _lock:
            _state['retryAfter'] = time.time() + RETRY_AFTER_FAILURE_SEC
            _state['lastError'] = '수집 대상 종목이 없음'
        return None
    with _lock:
        _state['running'] = True
    try:
        result = run_once(appkey, appsecret, codes, now_kst)
    finally:
        with _lock:
            _state['running'] = False
    logger.info('매물대 실제 체결가 수집: %s', result)
    with _lock:
        _state['lastRun'] = result
        _state['lastError'] = result.get('lastError')
        if result['stoppedEarly'] and result['stored'] == 0:
            _state['retryAfter'] = time.time() + RETRY_AFTER_FAILURE_SEC
        else:
            _state['lastRunDate'] = result['date']
            _save_state_file({'lastRunDate': result['date'], 'lastRun': result})
    return result


def _loop(appkey, appsecret, board_codes_fn):
    while True:
        try:
            now_kst = datetime.now(KST)
            with _lock:
                last_run_date = _state['lastRunDate']
                retry_after = _state['retryAfter']
            if time.time() >= retry_after and should_run(now_kst, last_run_date):
                _run_scheduled(appkey, appsecret, board_codes_fn, now_kst)
        except Exception:
            logger.exception('매물대 실제 체결가 수집 루프 오류')
        time.sleep(CHECK_SEC)


def start_background(appkey, appsecret, board_codes_fn):
    global _thread
    if not appkey or not appsecret:
        logger.warning('KIS_APPKEY/KIS_APPSECRET 미설정 - 매물대 실제 체결가 수집 건너뜀')
        return None
    with _lock:
        saved = _load_state_file()
        if saved.get('lastRunDate') and not _state['lastRunDate']:
            _state['lastRunDate'] = saved.get('lastRunDate')
            _state['lastRun'] = saved.get('lastRun')
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, args=(appkey, appsecret, board_codes_fn),
                                   name='volume-profile-collector', daemon=True)
        _thread.start()
    return _thread


def get_status():
    with _lock:
        state = dict(_state)
    return {
        'running': state['running'],
        'threadAlive': bool(_thread is not None and _thread.is_alive()),
        'lastRunDate': state['lastRunDate'],
        'lastRun': state['lastRun'],
        'lastError': state['lastError'],
        'schedule': 'KRX 거래일 18:10~20:00 KST 하루 1회',
        'maxCodes': MAX_CODES,
        'recentDays': RECENT_DAYS,
    }
