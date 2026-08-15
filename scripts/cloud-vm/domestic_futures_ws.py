# -*- coding: utf-8 -*-
"""KIS 국내 지수선물 실시간 체결가·호가 수집기.

KIS 실시간-010/011(H0IFCNT0/H0IFASP0)을 사용해 코스피200 주간선물의
현재가와 1단계 호가를 SQLite에 저장한다. 과거 일봉·분봉은 domestic_futures.py의
조회 API를 계속 사용하고, 장중 현재값만 이 모듈이 담당한다.
"""

import asyncio
import io
import json
import logging
import os
import threading
import time
import urllib.request
import zipfile
from datetime import datetime, timezone

import db_schema
import kis_client

logger = logging.getLogger('domestic_futures_ws')

SYMBOL_KEY = 'KOSPI200_DAY'
DISPLAY_NAME = '코스피200 주간선물'
TRADE_TR_ID = 'H0IFCNT0'
QUOTE_TR_ID = 'H0IFASP0'
MST_URL = 'https://new.real.download.dws.co.kr/common/master/fo_idx_code_mts.mst.zip'

TRADE_FIELDS = [
    'futs_shrn_iscd', 'bsop_hour', 'futs_prdy_vrss', 'prdy_vrss_sign', 'futs_prdy_ctrt',
    'futs_prpr', 'futs_oprc', 'futs_hgpr', 'futs_lwpr', 'last_cnqn', 'acml_vol',
    'acml_tr_pbmn', 'hts_thpr', 'mrkt_basis', 'dprt', 'nmsc_fctn_stpl_prc',
    'fmsc_fctn_stpl_prc', 'spead_prc', 'hts_otst_stpl_qty', 'otst_stpl_qty_icdc',
    'oprc_hour', 'oprc_vrss_prpr_sign', 'oprc_vrss_nmix_prpr', 'hgpr_hour',
    'hgpr_vrss_prpr_sign', 'hgpr_vrss_nmix_prpr', 'lwpr_hour', 'lwpr_vrss_prpr_sign',
    'lwpr_vrss_nmix_prpr', 'shnu_rate', 'cttr', 'esdg', 'otst_stpl_rgbf_qty_icdc',
    'thpr_basis', 'futs_askp1', 'futs_bidp1', 'askp_rsqn1', 'bidp_rsqn1',
    'seln_cntg_csnu', 'shnu_cntg_csnu', 'ntby_cntg_csnu', 'seln_cntg_smtn',
    'shnu_cntg_smtn', 'total_askp_rsqn', 'total_bidp_rsqn',
    'prdy_vol_vrss_acml_vol_rate', 'dscs_bltr_acml_qty', 'dynm_mxpr', 'dynm_llam',
    'dynm_prc_limt_yn',
]

QUOTE_FIELDS = [
    'futs_shrn_iscd', 'bsop_hour', 'futs_askp1', 'futs_askp2', 'futs_askp3',
    'futs_askp4', 'futs_askp5', 'futs_bidp1', 'futs_bidp2', 'futs_bidp3',
    'futs_bidp4', 'futs_bidp5', 'askp_csnu1', 'askp_csnu2', 'askp_csnu3',
    'askp_csnu4', 'askp_csnu5', 'bidp_csnu1', 'bidp_csnu2', 'bidp_csnu3',
    'bidp_csnu4', 'bidp_csnu5', 'askp_rsqn1', 'askp_rsqn2', 'askp_rsqn3',
    'askp_rsqn4', 'askp_rsqn5', 'bidp_rsqn1', 'bidp_rsqn2', 'bidp_rsqn3',
    'bidp_rsqn4', 'bidp_rsqn5', 'total_askp_csnu', 'total_bidp_csnu',
    'total_askp_rsqn', 'total_bidp_rsqn', 'total_askp_rsqn_icdc',
    'total_bidp_rsqn_icdc',
]


def _number(value):
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def _parse_rows(raw, fields):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', 'ignore')
    if not isinstance(raw, str) or not raw.startswith('0|'):
        return []
    parts = raw.split('|', 3)
    if len(parts) != 4 or parts[1] not in (TRADE_TR_ID, QUOTE_TR_ID):
        return []
    try:
        count = max(1, int(parts[2]))
    except (TypeError, ValueError):
        count = 1
    values = parts[3].split('^')
    width = len(values) // count if len(values) % count == 0 else 0
    if not width:
        return []
    return [dict(zip(fields, values[i * width:(i + 1) * width])) for i in range(count)]


def get_front_month_code():
    """KIS 지수선물 마스터에서 근월물(101W09 형식)을 계산한다."""
    override = os.environ.get('KIS_INDEX_FUTURES_CODE', '').strip().upper()
    if override:
        return override
    req = urllib.request.Request(MST_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as response:
        zip_bytes = response.read()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        name = archive.namelist()[0]
        text = archive.read(name).decode('cp949')
    this_month = int(datetime.now().strftime('%Y%m'))
    expiries = []
    for line in text.splitlines():
        parts = line.split('|')
        if len(parts) < 4 or parts[0] != '1' or not parts[1].startswith('A'):
            continue
        label = parts[3].strip()
        if not label.startswith('F '):
            continue
        try:
            expiry = int(label[-6:])
        except ValueError:
            continue
        if expiry >= this_month:
            expiries.append(expiry)
    if not expiries:
        raise RuntimeError('fo_idx_code_mts.mst에서 지수선물 근월물을 찾지 못함')
    expiry = min(expiries)
    return '101W' + str(expiry)[-2:]


def _upsert_trade(row):
    price = _number(row.get('futs_prpr'))
    if price is None:
        return
    change = _number(row.get('futs_prdy_vrss')) or 0
    change_rate = _number(row.get('futs_prdy_ctrt')) or 0
    if row.get('prdy_vrss_sign') in ('4', '5'):
        change = -abs(change)
        change_rate = -abs(change_rate)
    high = _number(row.get('futs_hgpr'))
    low = _number(row.get('futs_lwpr'))
    oi = _number(row.get('hts_otst_stpl_qty'))
    oi_change = _number(row.get('otst_stpl_qty_icdc'))
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_future_price(
            conn, SYMBOL_KEY, DISPLAY_NAME, price, change, change_rate, high, low,
            datetime.now(timezone.utc).isoformat(),
            oi=int(oi) if oi is not None else None,
            oi_change=int(oi_change) if oi_change is not None else None,
        )
    finally:
        conn.close()


def _upsert_quote(row):
    ask_price = _number(row.get('futs_askp1'))
    bid_price = _number(row.get('futs_bidp1'))
    ask_qty = _number(row.get('askp_rsqn1'))
    bid_qty = _number(row.get('bidp_rsqn1'))
    if ask_price is None and bid_price is None and ask_qty is None and bid_qty is None:
        return
    conn = db_schema.get_conn()
    try:
        db_schema.upsert_future_orderbook(
            conn, SYMBOL_KEY, ask_price, bid_price, ask_qty, bid_qty,
            datetime.now(timezone.utc).isoformat(),
        )
    finally:
        conn.close()


async def _run_once(appkey, appsecret, code):
    import websockets

    approval_key = await asyncio.to_thread(kis_client.get_approval_key, appkey, appsecret)
    async with websockets.connect(kis_client.WS_URL, ping_interval=None, open_timeout=10, close_timeout=5) as ws:
        for tr_id in (TRADE_TR_ID, QUOTE_TR_ID):
            await ws.send(json.dumps({
                'header': {
                    'approval_key': approval_key, 'custtype': 'P', 'tr_type': '1',
                    'content-type': 'utf-8',
                },
                'body': {'input': {'tr_id': tr_id, 'tr_key': code}},
            }))
            await asyncio.sleep(0.05)
        logger.info('KIS domestic futures WebSocket subscribed: code=%s', code)
        async for raw in ws:
            if isinstance(raw, str) and raw.startswith('0|'):
                if TRADE_TR_ID in raw.split('|', 3)[1:2]:
                    for row in _parse_rows(raw, TRADE_FIELDS):
                        await asyncio.to_thread(_upsert_trade, row)
                elif QUOTE_TR_ID in raw.split('|', 3)[1:2]:
                    for row in _parse_rows(raw, QUOTE_FIELDS):
                        await asyncio.to_thread(_upsert_quote, row)
                continue
            try:
                message = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if (message.get('header') or {}).get('tr_id') == 'PINGPONG':
                await ws.send(raw)


async def _reconnect_loop(appkey, appsecret):
    while True:
        try:
            code = await asyncio.to_thread(get_front_month_code)
            await _run_once(appkey, appsecret, code)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('KIS domestic futures WebSocket disconnected; retrying in 5s')
            await asyncio.sleep(5)


def start_background(appkey, appsecret):
    def runner():
        asyncio.run(_reconnect_loop(appkey, appsecret))

    thread = threading.Thread(target=runner, name='domestic-futures-kis-ws', daemon=True)
    thread.start()
    return thread
