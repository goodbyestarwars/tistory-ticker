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
import asyncio
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import db_schema
import kis_client
import polling

logger = logging.getLogger('option_flow')

_POLL_INTERVAL_SEC = 5 * 60
_WS_PERSIST_INTERVAL_SEC = 5  # 콜/풋 요약 카드는 초당 갱신이 필요 없음 - 불필요한 SQLite
                              # 커밋/테이블 재구성 빈도를 줄임(2026-08-21 코드 감사, 기존 1초)

OPTION_TRADE_TR_ID = 'H0IOCNT0'
OPTION_QUOTE_TR_ID = 'H0IOASP0'

# H0IOCNT0의 앞부분은 옵션 시세판 집계에 필요한 필드가 모두 포함된다. WebSocket
# 구독은 종목당 1건으로 들어오므로 count가 1인 메시지는 아래 필드만으로 안전하게
# 해석할 수 있다. 뒤쪽 필드는 호환성을 위해 이름을 붙여 둔다.
OPTION_TRADE_FIELDS = [
    'optn_shrn_iscd', 'bsop_hour', 'optn_prpr', 'prdy_vrss_sign', 'optn_prdy_vrss',
    'prdy_ctrt', 'optn_oprc', 'optn_hgpr', 'optn_lwpr', 'last_cnqn', 'acml_vol',
    'acml_tr_pbmn', 'hts_thpr', 'hts_otst_stpl_qty', 'otst_stpl_qty_icdc',
    'oprc_hour', 'oprc_vrss_prpr_sign', 'oprc_vrss_nmix_prpr', 'hgpr_hour',
    'hgpr_vrss_prpr_sign', 'hgpr_vrss_nmix_prpr', 'lwpr_hour', 'lwpr_vrss_prpr_sign',
    'lwpr_vrss_nmix_prpr', 'shnu_rate', 'prmm_val', 'invl_val', 'tmvl_val', 'delta',
    'gama', 'vega', 'theta', 'rho', 'hts_ints_vltl', 'esdg', 'otst_stpl_rgbf_qty_icdc',
    'thpr_basis', 'unas_hist_vltl', 'cttr', 'dprt', 'mrkt_basis', 'optn_askp1',
    'optn_bidp1', 'askp_rsqn1', 'bidp_rsqn1', 'seln_cntg_csnu', 'shnu_cntg_csnu',
    'ntby_cntg_csnu', 'seln_cntg_smtn', 'shnu_cntg_smtn', 'total_askp_rsqn',
    'total_bidp_rsqn', 'prdy_vol_vrss_acml_vol_rate', 'avrg_vltl', 'dscs_lrqn_vol',
    'dynm_mxpr', 'dynm_llam', 'dynm_prc_limt_yn',
]

OPTION_QUOTE_FIELDS = [
    'optn_shrn_iscd', 'bsop_hour', 'optn_askp1', 'optn_askp2', 'optn_askp3',
    'optn_askp4', 'optn_askp5', 'optn_bidp1', 'optn_bidp2', 'optn_bidp3',
    'optn_bidp4', 'optn_bidp5', 'askp_csnu1', 'askp_csnu2', 'askp_csnu3',
    'askp_csnu4', 'askp_csnu5', 'bidp_csnu1', 'bidp_csnu2', 'bidp_csnu3',
    'bidp_csnu4', 'bidp_csnu5', 'askp_rsqn1', 'askp_rsqn2', 'askp_rsqn3',
    'askp_rsqn4', 'askp_rsqn5', 'bidp_rsqn1', 'bidp_rsqn2', 'bidp_rsqn3',
    'bidp_rsqn4', 'bidp_rsqn5', 'total_askp_csnu', 'total_bidp_csnu',
    'total_askp_rsqn', 'total_bidp_rsqn', 'total_askp_rsqn_icdc',
    'total_bidp_rsqn_icdc',
]


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


def _number(row, *keys):
    for key in keys:
        value = row.get(key)
        if value is None or value == '':
            continue
        try:
            return float(str(value).replace(',', ''))
        except (TypeError, ValueError):
            continue
    return None


def _strike_rows(side, rows, updated_at):
    """KIS 옵션 전광판 응답을 화면용 최소 필드로 정규화한다.

    2026-08-23: 행사가별 프로파일이 항상 빈 상태였던 버그를 발견·수정 - 이 함수가
    시도하던 키 목록(stnd_prc/optn_stnd_prc/optn_prc/strike_prc/xprc)에 실제 필드명이
    없어 모든 행이 "행사가 없음"으로 걸러졌었다(합계 카드는 다른 필드를 써서 정상으로
    보였음). kis-code-assistant-mcp로 이 TR(FHPIF05030100, display_board_callput)의
    공식 예제(chk_display_board_callput.py COLUMN_MAPPING)를 확인해 정확한 필드명이
    'acpr'(행사가)임을 확인 - 첫 번째로 시도하도록 추가하고, 혹시 모를 응답 버전
    차이에 대비해 기존 추정 명칭들은 폴백으로 남겨둔다.
    """
    result = []
    for row in rows:
        strike = _number(row, 'acpr', 'stnd_prc', 'optn_stnd_prc', 'optn_prc', 'strike_prc', 'xprc')
        if strike is None:
            continue
        volume = _number(row, 'acml_vol', 'acc_trde_qty', 'trde_qty', 'volume') or 0
        oi = _number(row, 'hts_otst_stpl_qty', 'oi', 'open_interest') or 0
        oi_change = _number(row, 'otst_stpl_qty_icdc', 'oi_change') or 0
        result.append((side, strike, int(volume), int(oi), int(oi_change), updated_at))
    return result


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
        db_schema.replace_option_flow_strikes(
            conn,
            _strike_rows('CALL', calls, now_iso) + _strike_rows('PUT', puts, now_iso),
        )
    finally:
        conn.close()
    logger.info('option flow refreshed (mtrt=%s): call vol=%d oi=%d(%+d), put vol=%d oi=%d(%+d)',
                mtrt, call_v, call_oi, call_oic, put_v, put_oi, put_oic)


def _parse_ws_rows(raw, fields):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', 'ignore')
    if not isinstance(raw, str) or not raw.startswith('0|'):
        return []
    parts = raw.split('|', 3)
    if len(parts) != 4:
        return []
    try:
        count = max(1, int(parts[2]))
    except (TypeError, ValueError):
        count = 1
    values = parts[3].split('^')
    if count == 1:
        return [dict(zip(fields, values))]
    if len(values) % count:
        return []
    width = len(values) // count
    return [dict(zip(fields, values[i * width:(i + 1) * width])) for i in range(count)]


def _option_code(row):
    return str(row.get('optn_shrn_iscd') or row.get('option_code') or '').strip().upper()


def _merge_ws_row(base, update):
    merged = dict(base)
    for key, value in update.items():
        if value not in (None, ''):
            merged[key] = value
    return merged


def _persist_rows(calls, puts, mtrt):
    now_iso = datetime.now(timezone.utc).isoformat()
    call_v, call_oi, call_oic = _aggregate(calls)
    put_v, put_oi, put_oic = _aggregate(puts)
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_option_flow(conn, 'CALL', call_v, call_oi, call_oic, now_iso)
        db_schema.upsert_option_flow(conn, 'PUT', put_v, put_oi, put_oic, now_iso)
        db_schema.replace_option_flow_strikes(
            conn,
            _strike_rows('CALL', calls, now_iso) + _strike_rows('PUT', puts, now_iso),
        )
    finally:
        conn.close()
    logger.info('option flow WebSocket snapshot refreshed (mtrt=%s): call=%d put=%d',
                mtrt, call_v, put_v)


def _realtime_rows(calls, puts, limit=10):
    """KIS WebSocket 구독 한도 안에서 거래량이 많은 옵션을 선택한다."""
    def rank(row):
        return _number(row, 'acml_vol', 'volume') or 0
    return sorted(calls, key=rank, reverse=True)[:limit] + sorted(puts, key=rank, reverse=True)[:limit]


async def _ws_loop(appkey, appsecret):
    import websockets

    last_board = 0
    last_persist = 0
    mtrt = None
    calls = []
    puts = []
    by_code = {}
    while True:
        try:
            now = time.time()
            if now - last_board >= _POLL_INTERVAL_SEC or not by_code:
                token = await asyncio.to_thread(kis_client.get_token, appkey, appsecret)
                mtrt = nearest_option_maturity_yyyymm()
                calls, puts = await asyncio.to_thread(
                    lambda: kis_client.fetch_option_board(token, appkey, appsecret, mtrt)
                )
                by_code = {}
                for side, rows in (('CALL', calls), ('PUT', puts)):
                    for row in rows:
                        code = _option_code(row)
                        if code:
                            row['_side'] = side
                            by_code[code] = row
                _persist_rows(calls, puts, mtrt)
                last_board = now

            selected = _realtime_rows(calls, puts)
            selected_codes = [_option_code(row) for row in selected if _option_code(row)]
            if not selected_codes:
                await asyncio.sleep(30)
                continue

            approval_key = await asyncio.to_thread(kis_client.get_approval_key, appkey, appsecret)
            async with websockets.connect(kis_client.WS_URL, ping_interval=None, open_timeout=10, close_timeout=5) as ws:
                for tr_id in (OPTION_TRADE_TR_ID, OPTION_QUOTE_TR_ID):
                    for code in selected_codes:
                        await ws.send(json.dumps({
                            'header': {
                                'approval_key': approval_key, 'custtype': 'P', 'tr_type': '1',
                                'content-type': 'utf-8',
                            },
                            'body': {'input': {'tr_id': tr_id, 'tr_key': code}},
                        }))
                        await asyncio.sleep(0.05)
                logger.info('KIS option WebSocket subscribed: maturity=%s contracts=%d', mtrt, len(selected_codes))
                async for raw in ws:
                    # 최근월물·거래량 상위 계약이 바뀔 수 있으므로 5분마다
                    # 전광판 REST 스냅샷을 다시 읽고 구독 목록을 재구성한다.
                    if time.time() - last_board >= _POLL_INTERVAL_SEC:
                        await ws.close()
                        break
                    if isinstance(raw, str) and raw.startswith('0|'):
                        parts = raw.split('|', 3)
                        tr_id = parts[1] if len(parts) > 1 else ''
                        fields = OPTION_TRADE_FIELDS if tr_id == OPTION_TRADE_TR_ID else OPTION_QUOTE_FIELDS
                        for update in _parse_ws_rows(raw, fields):
                            code = _option_code(update)
                            if code in by_code:
                                by_code[code] = _merge_ws_row(by_code[code], update)
                        if time.time() - last_persist >= _WS_PERSIST_INTERVAL_SEC:
                            calls = [row for row in by_code.values() if row.get('_side') == 'CALL']
                            puts = [row for row in by_code.values() if row.get('_side') == 'PUT']
                            _persist_rows(calls, puts, mtrt)
                            last_persist = time.time()
                        continue
                    try:
                        message = json.loads(raw)
                    except (TypeError, json.JSONDecodeError):
                        continue
                    if (message.get('header') or {}).get('tr_id') == 'PINGPONG':
                        await ws.send(raw)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('KIS option WebSocket disconnected; retrying in 5s')
            await asyncio.sleep(5)


def _poll_loop(appkey, appsecret):
    polling.run_forever(
        lambda: refresh_option_flow(appkey, appsecret),
        _POLL_INTERVAL_SEC,
        logger,
        'refresh_option_flow failed',
    )


def start_background(appkey, appsecret):
    try:
        import websockets  # noqa: F401
    except ImportError:
        logger.warning('websockets 미설치 - 옵션 수급은 기존 REST polling으로 동작합니다')
        target = _poll_loop
        name = 'option-flow-poll'
    else:
        target = lambda: asyncio.run(_ws_loop(appkey, appsecret))
        name = 'option-flow-ws'
    t = threading.Thread(target=target, args=() if target is not _poll_loop else (appkey, appsecret), name=name, daemon=True)
    t.start()
    return t
