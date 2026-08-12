# -*- coding: utf-8 -*-
"""키움 0B(주식체결) WebSocket을 브라우저 관심종목 화면으로 안전하게 중계한다.

브라우저에는 키움 Access Token을 절대 전달하지 않는다. 각 브라우저 연결은 자신이 요청한
최대 50종목만 하나의 키움 WebSocket 세션에서 구독하며, 연결 종료 시 upstream도 닫힌다.
"""

import asyncio
import json
import logging
import os
import re

import kiwoom_client

logger = logging.getLogger(__name__)

KIWOOM_WS_URL = 'wss://api.kiwoom.com:10000/api/dostk/websocket'
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


async def relay_quotes(browser_ws, codes):
    """키움 상류가 끊겨도 브라우저 WebSocket은 유지하고 자동 재접속한다."""
    while True:
        try:
            await _relay_once(browser_ws, codes)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning('키움 실시간 상류 연결 종료, %ss 후 재접속: %s', 5, exc)
            await asyncio.sleep(5)
