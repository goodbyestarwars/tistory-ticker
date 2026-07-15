# -*- coding: utf-8 -*-
"""코스피200 옵션(콜/풋) 수급 요약 - KIS 옵션 시세판(display-board-callput, TR FHPIF05030100)을
5분마다 폴링해서 콜/풋 전체 거래량·미결제약정(OI)·OI증감을 집계·저장한다.

"신규 vs 청산" 을 투자자 유형별(외국인/기관/개인)로 쪼개서 보여달라는 원 요청은 KIS/키움
어디에도 그런 API가 없어 포기했다(gas 쪽 종목 선물수급 조사 때와 동일 결론). 대신 원 지시서의
대안 방침("API가 직접 안 주면 거래량+OI 변화로 추정")을 그대로 따라 콜 전체/풋 전체 단위로만
'신규 우세/청산 우세'를 추정한다(개별 투자자 매수/매도 방향까지는 추정 불가 - 그런 정밀도의
데이터 자체가 없음).

콜/풋 구분은 응답에 명시적 필드가 없어 위치(output1=콜, output2=풋)로 판단한다 - 요청
파라미터 순서(FID_MRKT_CLS_CODE=CO, FID_MRKT_CLS_CODE1=PO)와 실측 시 delta_val 부호
(콜은 양수, 풋은 음수인 금융공식상 항상 성립하는 사실)가 둘 다 이 순서를 가리켜서 채택함
(kis_client.fetch_option_board 참고)."""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import db_schema
import kis_client

logger = logging.getLogger('option_flow')

_POLL_INTERVAL_SEC = 5 * 60


def _second_thursday(year, month):
    d = datetime(year, month, 1)
    days_to_thu = (3 - d.weekday()) % 7  # weekday(): 월=0 ... 목=3
    first_thu = d + timedelta(days=days_to_thu)
    return first_thu + timedelta(days=7)


def nearest_option_maturity_yyyymm():
    """코스피200 옵션은 매월 둘째주 목요일 만기 - 이번 달 만기가 이미 지났으면 다음 달로."""
    now = datetime.now()
    maturity = _second_thursday(now.year, now.month)
    if now.date() > maturity.date():
        year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    else:
        year, month = now.year, now.month
    return '%04d%02d' % (year, month)


def _aggregate(rows):
    volume = oi = oi_change = 0
    for r in rows:
        try:
            volume += int(float(r.get('acml_vol') or 0))
            oi += int(float(r.get('hts_otst_stpl_qty') or 0))
            oi_change += int(float(r.get('otst_stpl_qty_icdc') or 0))
        except (TypeError, ValueError):
            continue
    return volume, oi, oi_change


def refresh_option_flow(appkey, appsecret):
    token = kis_client.get_token(appkey, appsecret)
    mtrt = nearest_option_maturity_yyyymm()
    calls, puts = kis_client.fetch_option_board(token, appkey, appsecret, mtrt)
    call_v, call_oi, call_oic = _aggregate(calls)
    put_v, put_oi, put_oic = _aggregate(puts)
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_option_flow(conn, 'CALL', call_v, call_oi, call_oic, now_iso)
        db_schema.upsert_option_flow(conn, 'PUT', put_v, put_oi, put_oic, now_iso)
    finally:
        conn.close()
    logger.info('option flow refreshed (mtrt=%s): call vol=%d oi=%d(%+d), put vol=%d oi=%d(%+d)',
                mtrt, call_v, call_oi, call_oic, put_v, put_oi, put_oic)


def _poll_loop(appkey, appsecret):
    while True:
        try:
            refresh_option_flow(appkey, appsecret)
        except Exception:
            logger.exception('refresh_option_flow failed')
        time.sleep(_POLL_INTERVAL_SEC)


def start_background(appkey, appsecret):
    t = threading.Thread(target=_poll_loop, args=(appkey, appsecret), name='option-flow-poll', daemon=True)
    t.start()
    return t
