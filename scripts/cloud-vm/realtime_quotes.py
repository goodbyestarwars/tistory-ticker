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
    """키움 REAL 응답에서 0B 체결가(10), 전일대비(11), 등락률(12)을 표준 형태로 변환."""
    if message.get('trnm') != 'REAL':
        return []
    events = []
    for row in message.get('data') or []:
        if row.get('type') != '0B':
            continue
        values = row.get('values') or {}
        code = str(row.get('item') or values.get('9001') or '').lstrip('A').upper()
        if not _CODE_RE.match(code):
            continue
        price = _number(values.get('10'))
        change = _number(values.get('11'))
        change_rate = _number(values.get('12'))
        if price is None:
            continue
        events.append({
            'type': 'quote',
            'code': code,
            'price': abs(price),
            'change': change or 0,
            'changeRate': change_rate or 0,
        })
    return events


async def relay_quotes(browser_ws, codes):
    """한 브라우저 연결과 한 키움 실시간 세션을 연결한다."""
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
