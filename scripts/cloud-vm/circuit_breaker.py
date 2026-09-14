# -*- coding: utf-8 -*-
"""메인페이지 VI·사이드카 배지 데이터(서버 1곳 폴링 + 메모리 캐시).

2026-09-15 작업지시서 "VI·사이드카 발동 배지(메인페이지)". 방문자 브라우저가 증권사 API를 각자 부르지
않도록 FastAPI 프로세스 안의 스레드 하나가 20초마다 조회하고, `/api/circuit-breaker`는 캐시만 돌려준다.

VI(개별종목 변동성완화장치): KIS "변동성완화장치(VI) 현황" [v1_국내주식-055]
  GET /uapi/domestic-stock/v1/quotations/inquire-vi-status, tr_id FHPST01390000
  요청: FID_DIV_CLS_CODE=0(전체), FID_COND_SCR_DIV_CODE=20139, FID_MRKT_CLS_CODE=0(전체),
        FID_RANK_SORT_CLS_CODE=0(정적+동적 전체), FID_INPUT_DATE_1=영업일(YYYYMMDD)
  응답 output(목록): hts_kor_isnm(종목명), mksc_shrn_iscd(종목코드), vi_cls_code(VI발동상태),
        bsop_date(영업일), cntg_vi_hour(VI발동시간), vi_cncl_hour(VI해제시간), vi_kind_code(VI종류),
        vi_prc(발동가격), vi_count(발동횟수) - KIS 공식 예제 open-trading-api inquire_vi_status 컬럼 기준.
  vi_cls_code 값의 뜻은 문서로 확인하지 못해, 발동/해제 판정은 해제시간(vi_cncl_hour) 유무로 한다.

사이드카(프로그램매매 호가 일시효력정지): KIS·키움 문서에서 이를 알려주는 필드를 찾지 못했다
(국내업종 현재지수·국내지수 실시간프로그램매매·장운영정보 컬럼 확인). 미검증 필드를 쓰지 않고
KRX 크롤링도 새로 추가하지 않는 원칙에 따라, 확인된 출처가 생길 때까지 sidecar.available=False로 두고
화면 배지는 숨긴다.

조회 시간: KRX 거래일 08:55~15:35(정규장) + 15:55~20:05(애프터마켓). 그 밖에는 조회하지 않는다.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import kis_client

logger = logging.getLogger('circuit_breaker')

KST = timezone(timedelta(hours=9))
POLL_SEC = 20
IDLE_CHECK_SEC = 60
RELEASED_KEEP_SEC = 5 * 60
MAX_LIST = 10
VI_PATH = '/uapi/domestic-stock/v1/quotations/inquire-vi-status'
VI_TR_ID = 'FHPST01390000'
SIDECAR_NOTE = '사이드카 발동 여부를 알려주는 확인된 증권사 API 필드가 없어 아직 표시하지 않습니다.'

_lock = threading.Lock()
_state = {
    'date': None,
    'rows': [],
    'fetchedAt': None,
    'error': None,
}
_thread = None


def in_poll_window(now_kst):
    import market_clock
    if not market_clock.is_kr_trading_day(now_kst):
        return False
    minutes = now_kst.hour * 60 + now_kst.minute
    return (8 * 60 + 55 <= minutes <= 15 * 60 + 35) or (15 * 60 + 55 <= minutes <= 20 * 60 + 5)


def _hhmmss_to_dt(date_str, hhmmss):
    text = str(hhmmss or '').strip()
    if not text or not text.isdigit() or int(text) == 0:
        return None
    text = text.zfill(6)
    try:
        return datetime.strptime(str(date_str) + text, '%Y%m%d%H%M%S').replace(tzinfo=KST)
    except ValueError:
        return None


def parse_rows(output, date_str):
    """KIS 응답 목록 → [{code, name, triggered_at(datetime), released_at(datetime|None), ...}]."""
    rows = []
    for item in output or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get('mksc_shrn_iscd') or '').strip()
        name = str(item.get('hts_kor_isnm') or '').strip()
        row_date = str(item.get('bsop_date') or date_str).strip() or date_str
        triggered = _hhmmss_to_dt(row_date, item.get('cntg_vi_hour'))
        if not code or triggered is None:
            continue
        rows.append({
            'code': code,
            'name': name or code,
            'triggered_at': triggered,
            'released_at': _hhmmss_to_dt(row_date, item.get('vi_cncl_hour')),
            'vi_kind_code': str(item.get('vi_kind_code') or '').strip() or None,
            'vi_cls_code': str(item.get('vi_cls_code') or '').strip() or None,
            'count': _int(item.get('vi_count')),
        })
    return rows


def _int(value):
    try:
        return int(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def build_payload(rows, now_kst, fetched_at=None, error=None):
    """배지·드롭다운용 응답. 발동 중 전부 + 해제 후 5분 이내만, 최근 발동 순 최대 10건."""
    visible = []
    active_count = 0
    for row in rows or []:
        released = row.get('released_at')
        if released is not None and released <= now_kst:
            if (now_kst - released).total_seconds() > RELEASED_KEEP_SEC:
                continue
            status = 'released'
        else:
            status = 'active'
            active_count += 1
        visible.append({
            'code': row['code'],
            'name': row['name'],
            'status': status,
            'triggered_at': row['triggered_at'].isoformat(),
            'released_at': released.isoformat() if released is not None and status == 'released' else None,
        })
    visible.sort(key=lambda r: r['triggered_at'], reverse=True)
    return {
        'sidecar': {
            'available': False,
            'active': False,
            'market': None,
            'triggered_at': None,
            'note': SIDECAR_NOTE,
        },
        'vi_active_count': active_count,
        'vi_list': visible[:MAX_LIST],
        'fetchedAt': fetched_at,
        'error': error,
    }


def fetch_vi_output(appkey, appsecret, date_str, getter=None):
    if getter is None:
        def getter(path, tr_id, params):
            token = kis_client.get_token(appkey, appsecret)
            return kis_client._get_domestic_quote(token, appkey, appsecret, path, tr_id, params)
    data = getter(VI_PATH, VI_TR_ID, {
        'FID_DIV_CLS_CODE': '0',
        'FID_COND_SCR_DIV_CODE': '20139',
        'FID_MRKT_CLS_CODE': '0',
        'FID_INPUT_ISCD': '',
        'FID_RANK_SORT_CLS_CODE': '0',
        'FID_INPUT_DATE_1': date_str,
        'FID_TRGT_CLS_CODE': '',
        'FID_TRGT_EXLS_CLS_CODE': '',
    })
    output = (data or {}).get('output')
    if isinstance(output, dict):
        output = [output]
    return output or []


def refresh_once(appkey, appsecret, now_kst=None, getter=None):
    now_kst = now_kst or datetime.now(KST)
    date_str = now_kst.strftime('%Y%m%d')
    with _lock:
        if _state['date'] != date_str:
            _state.update({'date': date_str, 'rows': [], 'fetchedAt': None, 'error': None})
    try:
        rows = parse_rows(fetch_vi_output(appkey, appsecret, date_str, getter), date_str)
    except Exception as exc:
        with _lock:
            _state['error'] = str(exc)[:200]
        logger.info('VI 현황 조회 실패: %s', exc)
        return None
    with _lock:
        _state['rows'] = rows
        _state['fetchedAt'] = now_kst.isoformat(timespec='seconds')
        _state['error'] = None
    return rows


def get_payload(now_kst=None):
    now_kst = now_kst or datetime.now(KST)
    with _lock:
        rows = list(_state['rows']) if _state['date'] == now_kst.strftime('%Y%m%d') else []
        fetched = _state['fetchedAt']
        error = _state['error']
    return build_payload(rows, now_kst, fetched, error)


def _loop(appkey, appsecret):
    while True:
        now_kst = datetime.now(KST)
        if in_poll_window(now_kst):
            refresh_once(appkey, appsecret, now_kst)
            time.sleep(POLL_SEC)
        else:
            time.sleep(IDLE_CHECK_SEC)


def start_background(appkey, appsecret):
    global _thread
    if not appkey or not appsecret:
        logger.warning('KIS_APPKEY/KIS_APPSECRET 미설정 - VI 배지 조회 건너뜀')
        return None
    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, args=(appkey, appsecret), name='circuit-breaker', daemon=True)
        _thread.start()
    return _thread
