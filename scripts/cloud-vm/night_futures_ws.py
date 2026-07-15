# -*- coding: utf-8 -*-
"""코스피200 야간선물 실시간 웹소켓(KRX야간선물 실시간종목체결, TR H0MFCNT0) 상시 리스너.
FastAPI 앱 시작 시 백그라운드 스레드로 구동 - kiwoom-api.service 프로세스 안에서 함께 돈다
(VM에 새 systemd 유닛을 따로 만들지 않아도 되도록, deploy_check.sh의 기존 재시작 흐름에 편승).

프레임 포맷은 실측으로 확인함(2026-07-15):
  구독 확인: {"header":{...},"body":{"rt_cd":"0","msg_cd":"OPSP0000","msg1":"SUBSCRIBE SUCCESS",...}}
  체결 틱  : "0|H0MFCNT0|001|A01609^011442^48.50^2^4.39^1153.50^1110.00^1157.20^1103.25^..."
  (0 또는 1로 시작하면 데이터, 그 외는 JSON 제어 메시지 - PINGPONG 포함)
필드 순서는 KIS 공식 문서(실시간-064)와 examples_user/domestic_futureoption 샘플의 컬럼 순서를 그대로 사용.
"""

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import websockets

import db_schema
import kis_client
import night_futures_code

logger = logging.getLogger('night_futures_ws')

SYMBOL_KEY = 'KOSPI200_NIGHT'   # DB에 저장할 안정적인 심볼명 - 실제 KIS 계약코드(A01609 등)는 분기마다 바뀜
DISPLAY_NAME = '코스피200 야간선물'
TR_ID = 'H0MFCNT0'

FIELDS = [
    'futs_shrn_iscd', 'bsop_hour', 'futs_prdy_vrss', 'prdy_vrss_sign', 'futs_prdy_ctrt',
    'futs_prpr', 'futs_oprc', 'futs_hgpr', 'futs_lwpr', 'last_cnqn', 'acml_vol', 'acml_tr_pbmn',
    'hts_thpr', 'mrkt_basis', 'dprt', 'nmsc_fctn_stpl_prc', 'fmsc_fctn_stpl_prc', 'spead_prc',
    'hts_otst_stpl_qty', 'otst_stpl_qty_icdc', 'oprc_hour', 'oprc_vrss_prpr_sign',
    'oprc_vrss_nmix_prpr', 'hgpr_hour', 'hgpr_vrss_prpr_sign', 'hgpr_vrss_nmix_prpr',
    'lwpr_hour', 'lwpr_vrss_prpr_sign', 'lwpr_vrss_nmix_prpr', 'shnu_rate', 'cttr', 'esdg',
    'otst_stpl_rgbf_qty_icdc', 'thpr_basis', 'futs_askp1', 'futs_bidp1', 'askp_rsqn1',
    'bidp_rsqn1', 'seln_cntg_csnu', 'shnu_cntg_csnu', 'ntby_cntg_csnu', 'seln_cntg_smtn',
    'shnu_cntg_smtn', 'total_askp_rsqn', 'total_bidp_rsqn', 'prdy_vol_vrss_acml_vol_rate',
    'dynm_mxpr', 'dynm_llam', 'dynm_prc_limt_yn',
]

_HISTORY_REFRESH_INTERVAL = 6 * 3600  # 6시간마다 과거 일봉(미니차트용) 갱신
_MINUTE_REFRESH_INTERVAL = 5 * 60     # 5분마다 분봉 갱신(domestic_futures.py 주간선물과 동일 주기)
KST = timezone(timedelta(hours=9))


def _parse_tick(raw):
    parts = raw.split('|')
    if len(parts) < 4:
        return None
    data_str = parts[3]
    values = data_str.split('^')
    row = dict(zip(FIELDS, values))
    return row


def _upsert_tick(conn, row):
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        price = float(row['futs_prpr'])
        change = float(row['futs_prdy_vrss'])
        change_rate = float(row['futs_prdy_ctrt'])
        high = float(row['futs_hgpr'])
        low = float(row['futs_lwpr'])
    except (KeyError, ValueError):
        return
    sign = row.get('prdy_vrss_sign')
    if sign in ('4', '5'):  # 4:하한 5:하락
        change = -abs(change)
        change_rate = -abs(change_rate)
    # 미결제약정(OI)/증감 - 실시간 틱에 이미 들어있던 필드인데 그동안 안 쓰고 버리고 있었음
    # (2026-07-16 발견, "선물 수급" 섹션에 노출하려고 추가).
    oi = oi_change = None
    try:
        oi = int(float(row['hts_otst_stpl_qty']))
        oi_change = int(float(row['otst_stpl_qty_icdc']))
    except (KeyError, ValueError):
        pass
    db_schema.upsert_future_price(conn, SYMBOL_KEY, DISPLAY_NAME, price, change, change_rate, high, low, now_iso,
                                   oi=oi, oi_change=oi_change)


def refresh_history(appkey, appsecret, code):
    """FID_COND_MRKT_DIV_CODE=CM 과거 일봉(최근 90일)을 future_chart에 저장.
    자체 커넥션을 열고 닫는다 - 스레드풀에서 호출될 수 있어(sqlite3 커넥션은 생성한
    스레드에서만 재사용 가능) 웹소켓 수신 루프의 conn과 공유하지 않기 위함."""
    token = kis_client.get_token(appkey, appsecret)
    date2 = datetime.now().strftime('%Y%m%d')
    date1 = (datetime.now() - timedelta(days=90)).strftime('%Y%m%d')
    _output1, output2 = kis_client.fetch_period_chart(token, appkey, appsecret, 'CM', code, date1, date2, 'D')
    rows = []
    for r in output2:
        try:
            rows.append({
                'date': r['stck_bsop_date'],
                'open': float(r['futs_oprc']),
                'high': float(r['futs_hgpr']),
                'low': float(r['futs_lwpr']),
                'close': float(r['futs_prpr']),
            })
        except (KeyError, ValueError):
            continue
    if rows:
        conn = db_schema.get_conn()
        try:
            db_schema.upsert_future_chart_rows(conn, SYMBOL_KEY, rows)
        finally:
            conn.close()
    logger.info('night futures history refreshed: %d rows (code=%s)', len(rows), code)


# 야간선물은 자정을 넘어가면 stck_cntg_hour가 24~29시로 표기되고(30시간제),
# stck_bsop_date는 세션이 시작한 날짜 그대로 유지된다(2026-07-16 실측 확인) - 그래서
# 실제 달력 날짜로 환산하려면 시(hour)가 24 이상이면 날짜를 하루 미뤄야 한다.
def _parse_night_minute_ts(bsop_date, cntg_hour):
    hh = int(cntg_hour[0:2])
    mm = int(cntg_hour[2:4])
    ss = int(cntg_hour[4:6])
    base = datetime.strptime(bsop_date, '%Y%m%d')
    if hh >= 24:
        base = base + timedelta(days=1)
        hh -= 24
    dt = base.replace(hour=hh, minute=mm, second=ss, tzinfo=KST)
    return int(dt.timestamp())


def refresh_minute(appkey, appsecret, code):
    """FID_COND_MRKT_DIV_CODE=CM 분봉(60초봉)을 future_chart_minute에 저장.
    refresh_history와 동일하게 자체 커넥션을 열고 닫는다(스레드풀에서 호출됨)."""
    token = kis_client.get_token(appkey, appsecret)
    now = datetime.now(KST)
    _output1, output2 = kis_client.fetch_time_chart(
        token, appkey, appsecret, 'CM', code, now.strftime('%Y%m%d'), now.strftime('%H%M%S'))
    rows = []
    for r in output2:
        try:
            rows.append({
                'ts': _parse_night_minute_ts(r['stck_bsop_date'], r['stck_cntg_hour']),
                'open': float(r['futs_oprc']),
                'high': float(r['futs_hgpr']),
                'low': float(r['futs_lwpr']),
                'close': float(r['futs_prpr']),
            })
        except (KeyError, ValueError):
            continue
    if rows:
        conn = db_schema.get_conn()
        try:
            db_schema.upsert_future_chart_minute_rows(conn, SYMBOL_KEY, rows)
        finally:
            conn.close()
    logger.info('night futures minute chart refreshed: %d rows (code=%s)', len(rows), code)


async def _run_once(appkey, appsecret, code, last_history_refresh=0, last_minute_refresh=0):
    approval_key = kis_client.get_approval_key(appkey, appsecret)
    url = kis_client.WS_URL
    conn = db_schema.get_conn()
    loop = asyncio.get_running_loop()
    try:
        async with websockets.connect(url, ping_interval=None) as ws:
            req = {
                'header': {
                    'approval_key': approval_key,
                    'custtype': 'P',
                    'tr_type': '1',
                    'content-type': 'utf-8',
                },
                'body': {'input': {'tr_id': TR_ID, 'tr_key': code}},
            }
            await ws.send(json.dumps(req))
            logger.info('night futures ws subscribed: code=%s', code)

            async for raw in ws:
                if raw and raw[0] in ('0', '1'):
                    row = _parse_tick(raw)
                    if row:
                        _upsert_tick(conn, row)
                else:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    tr_id = msg.get('header', {}).get('tr_id')
                    if tr_id == 'PINGPONG':
                        await ws.pong(raw)

                now = time.time()
                if now - last_history_refresh > _HISTORY_REFRESH_INTERVAL:
                    last_history_refresh = now
                    # urllib은 동기 호출이라 그대로 부르면 이벤트루프가 막혀 PINGPONG 응답이
                    # 늦어질 수 있음 - 스레드풀로 넘겨서 웹소켓 수신 루프와 겹치게 실행
                    async def _refresh():
                        try:
                            await loop.run_in_executor(None, refresh_history, appkey, appsecret, code)
                        except Exception:
                            logger.exception('night futures history refresh failed')
                    asyncio.ensure_future(_refresh())
                if now - last_minute_refresh > _MINUTE_REFRESH_INTERVAL:
                    last_minute_refresh = now
                    async def _refresh_minute():
                        try:
                            await loop.run_in_executor(None, refresh_minute, appkey, appsecret, code)
                        except Exception:
                            logger.exception('night futures minute refresh failed')
                    asyncio.ensure_future(_refresh_minute())
    finally:
        conn.close()


async def _reconnect_loop(appkey, appsecret):
    while True:
        try:
            code = night_futures_code.get_front_month_code()
        except Exception:
            logger.exception('night futures front-month code lookup failed, retry in 60s')
            await asyncio.sleep(60)
            continue
        try:
            await _run_once(appkey, appsecret, code)
        except Exception:
            logger.exception('night futures ws disconnected, reconnecting in 5s')
            await asyncio.sleep(5)


def start_background(appkey, appsecret):
    """FastAPI startup에서 호출 - 별도 스레드에서 asyncio 이벤트루프를 돌린다."""
    def _runner():
        asyncio.run(_reconnect_loop(appkey, appsecret))

    t = threading.Thread(target=_runner, name='night-futures-ws', daemon=True)
    t.start()
    return t
