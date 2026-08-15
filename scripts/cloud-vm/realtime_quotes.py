# -*- coding: utf-8 -*-
"""KIS/키움 실시간 체결 WebSocket을 브라우저 관심종목 화면으로 안전하게 중계한다.

브라우저에는 키움 Access Token을 절대 전달하지 않는다. 각 브라우저 연결은 자신이 요청한
최대 50종목만 하나의 키움 WebSocket 세션에서 구독하며, 연결 종료 시 upstream도 닫힌다.
"""

import asyncio
import json
import logging
import os
import re

import kiwoom_client
import kis_client

logger = logging.getLogger(__name__)

KIWOOM_WS_URL = 'wss://api.kiwoom.com:10000/api/dostk/websocket'
KIS_WS_URL = kis_client.WS_URL
_CODE_RE = re.compile(r'^[0-9A-Z]{6}$')
_MAX_CODES = 50


def normalize_codes(raw_codes):
    """중복을 제거하면서 입력 순서를 보존하고 유효한 종목코드만 반환한다."""
    result = []
    seen = set()
    for raw in raw_codes:
        code = str(raw or '').strip().upper()
        if code in seen or not _CODE_RE.match(code):
            continue
        seen.add(code)
        result.append(code)
        if len(result) >= _MAX_CODES:
            break
    return result


def _number(value):
    text = str(value if value is not None else '').replace(',', '').strip()
    if not text:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _quote_events(message):
    """키움 REAL 응답에서 0B 체결가를 표준 형태로 변환한다.

    NXT 프리마켓/메인마켓 체결도 0B로 오며, 이때 거래소(9081)와 장구분(290)이
    함께 전달될 수 있다. 키움 응답의 data/type/values가 버전별로 리스트·문자열
    형태가 조금씩 달라질 수 있어 두 형태를 모두 허용한다.
    """
    if message.get('trnm') != 'REAL':
        return []
    rows = message.get('data') or []
    if isinstance(rows, dict):
        rows = [rows]
    events = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_type = row.get('type')
        if isinstance(row_type, (list, tuple, set)):
            is_quote = '0B' in row_type
        else:
            is_quote = str(row_type or '').upper() == '0B'
        if not is_quote:
            continue
        values = row.get('values') or row.get('value') or {}
        if not isinstance(values, dict):
            continue

        def value(*keys):
            for key in keys:
                if key in values and values[key] not in (None, ''):
                    return values[key]
            return None

        code = str(row.get('item') or value('9001', 'code') or '').lstrip('A').upper()
        if not _CODE_RE.match(code):
            continue
        price = _number(value('10', 'price'))
        change = _number(value('11', 'change'))
        change_rate = _number(value('12', 'changeRate', 'change_rate'))
        cumulative_volume = _number(value('16', 'acc_trde_qty', 'acml_vol', 'volume'))
        if price is None:
            continue
        event = {
            'type': 'quote',
            'code': code,
            'price': abs(price),
            'change': change or 0,
            'changeRate': change_rate or 0,
        }
        if cumulative_volume is not None:
            event['volume'] = abs(cumulative_volume)
        exchange = value('9081', 'exchange', 'stex_tp')
        session = value('290', 'session', 'market_session')
        if exchange is not None:
            event['exchange'] = str(exchange).strip()
        if session is not None:
            event['marketSession'] = str(session).strip()
        events.append(event)
    return events


def _kis_number(value):
    text = str(value if value is not None else '').replace(',', '').strip()
    if not text:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _kis_quote_events(raw):
    """KIS 국내 H0STCNT0/미국 HDFSCNT0 체결을 공통 이벤트로 변환한다."""
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', 'ignore')
    if not isinstance(raw, str) or not raw.startswith('0|'):
        return []
    parts = raw.split('|', 3)
    if len(parts) != 4:
        return []
    tr_id, count_text, payload = parts[1], parts[2], parts[3]
    try:
        count = max(1, int(count_text))
    except (TypeError, ValueError):
        count = 1
    fields = payload.split('^')
    width = len(fields) // count if count and len(fields) % count == 0 else 0
    if width <= 0:
        return []
    events = []
    for index in range(count):
        row = fields[index * width:(index + 1) * width]
        if tr_id in ('H0STCNT0', 'H0NXCNT0'):
            if len(row) < 15:
                continue
            code = str(row[0]).strip().lstrip('A').upper()
            price = _kis_number(row[2])
            change = _kis_number(row[4])
            change_rate = _kis_number(row[5])
            volume = _kis_number(row[13])
            event = {
                'type': 'quote', 'code': code, 'price': abs(price or 0),
                'change': change or 0, 'changeRate': change_rate or 0,
                'source': 'KIS WebSocket',
            }
        elif tr_id == 'HDFSCNT0':
            if len(row) < 21:
                continue
            symbol = str(row[1] or '').strip().upper()
            if not symbol:
                continue
            price = _kis_number(row[11])
            change = _kis_number(row[13])
            change_rate = _kis_number(row[14])
            volume = _kis_number(row[20])
            event = {
                'type': 'quote', 'code': 'US:' + symbol, 'symbol': symbol,
                'price': abs(price or 0), 'change': change or 0,
                'changeRate': change_rate or 0, 'source': 'KIS WebSocket',
            }
        else:
            continue
        if volume is not None:
            event['volume'] = abs(volume)
        if event['price'] > 0:
            events.append(event)
    return events


async def _relay_once(browser_ws, codes):
    """한 번의 키움 실시간 세션을 연결한다."""
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError('websockets 패키지가 설치되지 않았습니다.') from exc

    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        raise RuntimeError('KIWOOM_APPKEY/KIWOOM_SECRETKEY가 설정되지 않았습니다.')

    token = await asyncio.to_thread(kiwoom_client.get_token, appkey, secretkey)
    async with websockets.connect(
        KIWOOM_WS_URL,
        open_timeout=10,
        close_timeout=5,
        ping_interval=20,
        ping_timeout=20,
        max_size=2 * 1024 * 1024,
    ) as upstream:
        await upstream.send(json.dumps({'trnm': 'LOGIN', 'token': token}))

        registered = False
        while True:
            raw = await upstream.recv()
            message = json.loads(raw)

            if message.get('trnm') == 'PING':
                await upstream.send(raw)
                continue

            if message.get('trnm') == 'LOGIN':
                if message.get('return_code') != 0:
                    raise RuntimeError('키움 실시간 로그인 실패')
                await upstream.send(json.dumps({
                    'trnm': 'REG',
                    'grp_no': '1',
                    'refresh': '1',
                    'data': [{'item': codes, 'type': ['0B']}],
                }))
                registered = True
                await browser_ws.send_json({'type': 'ready', 'codes': codes})
                continue

            if registered:
                for event in _quote_events(message):
                    await browser_ws.send_json(event)


def _kis_us_keys(symbols):
    """거래소를 모르는 브라우저 심볼을 KIS 미국 실시간 키로 확장한다."""
    keys = []
    for symbol in symbols:
        clean = str(symbol or '').strip().upper()
        if not clean:
            continue
        for prefix in ('DNAS', 'DNYS', 'DAMS'):
            keys.append((prefix + clean, 'HDFSCNT0'))
    return keys[:_MAX_CODES]


async def _relay_once_kis(browser_ws, domestic_codes, us_symbols):
    """한 번의 KIS 실시간 체결 세션을 연결한다."""
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError('websockets 패키지가 설치되지 않았습니다.') from exc

    appkey = os.environ.get('KIS_APPKEY')
    appsecret = os.environ.get('KIS_APPSECRET')
    if not appkey or not appsecret:
        raise RuntimeError('KIS_APPKEY/KIS_APPSECRET가 설정되지 않았습니다.')
    approval_key = await asyncio.to_thread(kis_client.get_approval_key, appkey, appsecret)
    registrations = []
    for code in domestic_codes:
        registrations.extend((tr_id, code) for tr_id in ('H0STCNT0', 'H0NXCNT0'))
    registrations.extend(_kis_us_keys(us_symbols)[:max(0, _MAX_CODES - len(registrations))])
    if not registrations:
        raise RuntimeError('KIS 실시간 구독 종목이 없습니다.')

    async with websockets.connect(
        KIS_WS_URL,
        open_timeout=10,
        close_timeout=5,
        ping_interval=None,
        max_size=2 * 1024 * 1024,
    ) as upstream:
        for tr_id, key in registrations:
            await upstream.send(json.dumps({
                'header': {
                    'approval_key': approval_key,
                    'custtype': 'P',
                    'tr_type': '1',
                    'content-type': 'utf-8',
                },
                'body': {'input': {'tr_id': tr_id, 'tr_key': key}},
            }))
            await asyncio.sleep(0.05)
        await browser_ws.send_json({
            'type': 'ready',
            'codes': domestic_codes + ['US:' + symbol for symbol in us_symbols],
        })

        while True:
            raw = await upstream.recv()
            if isinstance(raw, str) and raw.startswith('{'):
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    message = {}
                if (message.get('header') or {}).get('tr_id') == 'PINGPONG':
                    await upstream.send(raw)
                continue
            for event in _kis_quote_events(raw):
                await browser_ws.send_json(event)


async def relay_quotes(browser_ws, codes, us_symbols=None):
    """선택한 상류가 끊겨도 브라우저 WebSocket은 유지하고 자동 재접속한다."""
    us_symbols = us_symbols or []
    while True:
        try:
            use_kis = (
                os.environ.get('MARKET_BOARD_SOURCE', 'kis').strip().lower() == 'kis'
                and os.environ.get('KIS_APPKEY')
                and os.environ.get('KIS_APPSECRET')
            )
            if use_kis:
                await _relay_once_kis(browser_ws, codes, us_symbols)
            else:
                await _relay_once(browser_ws, codes)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning('실시간 상류 연결 종료, %ss 후 재접속: %s', 5, exc)
            await asyncio.sleep(5)
