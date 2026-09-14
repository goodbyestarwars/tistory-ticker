# -*- coding: utf-8 -*-
"""KIS/키움 실시간 체결 WebSocket을 브라우저 관심종목 화면으로 안전하게 중계한다.

브라우저에는 키움 Access Token을 절대 전달하지 않는다. 각 브라우저 연결은 자신이 요청한
최대 50종목만 구독한다. KIS 경로는 2026-09-14부터 브라우저 연결마다 KIS 세션을 새로 열지
않고 프로세스 공용 허브(kis_ws_hub.py)에 구독만 한다 - 연결마다 세션을 열던 구조에서 같은
앱키의 다른 세션과 충돌해 체결이 0건 들어왔다. 키움 폴백 경로는 예전 그대로다.
"""

import asyncio
import json
import logging
import os
import re

import kiwoom_client
import kis_client
import kis_ws_hub
import rest_quote_fallback
import us_stocks

logger = logging.getLogger(__name__)

KIWOOM_WS_URL = 'wss://api.kiwoom.com:10000/api/dostk/websocket'
KIS_WS_URL = kis_client.WS_URL
_CODE_RE = re.compile(r'^[0-9A-Z]{6}$')
_MAX_CODES = 50
# 허브 쪽 상태를 브라우저에 알리는 주기. 틱이 없는 동안에만 보낸다(화면이 "지연"을 판단할 근거).
_RELAY_STATUS_INTERVAL_SEC = 15
# 등록 여부(coverage)를 다시 보는 주기와, 구독 직후 허브가 KIS에 등록할 틈.
_RELAY_TICK_SEC = 1.0
_COVERAGE_GRACE_SEC = 3.0


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


def _signed_change(change, change_rate):
    """Align an absolute broker change amount with the signed rate."""
    if change is None or change_rate in (None, 0):
        return change
    return abs(change) if change_rate > 0 else -abs(change)


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
            'change': _signed_change(change, change_rate) or 0,
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
    """KIS 국내 체결·통합호가/미국 체결을 공통 이벤트로 변환한다.

    국내주식은 KRX/NXT를 따로 합치는 대신 KIS 통합 TR(H0UNCNT0/H0UNASP0)을
    사용한다. 통합 호가는 10단계 가격·잔량을 브라우저가 바로 사용할 수 있는
    asks/bids 배열로 내보낸다.
    """
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
        if tr_id in ('H0STCNT0', 'H0NXCNT0', 'H0UNCNT0'):
            if len(row) < 15:
                continue
            code = str(row[0]).strip().lstrip('A').upper()
            price = _kis_number(row[2])
            change = _kis_number(row[4])
            change_rate = _kis_number(row[5])
            volume = _kis_number(row[13])
            event = {
                'type': 'quote', 'code': code, 'price': abs(price or 0),
                'change': _signed_change(change, change_rate) or 0,
                'changeRate': change_rate or 0,
                'source': 'KIS WebSocket',
            }
        elif tr_id == 'H0UNASP0':
            if len(row) < 43:
                continue
            code = str(row[0]).strip().lstrip('A').upper()
            if not _CODE_RE.match(code):
                continue

            def levels(start):
                result = []
                for offset in range(10):
                    price = _kis_number(row[start + offset])
                    qty = _kis_number(row[start + 20 + offset])
                    if price is not None or qty is not None:
                        result.append({'price': price, 'qty': qty})
                return result

            events.append({
                'type': 'orderbook',
                'code': code,
                'asks': levels(3),
                'bids': levels(13),
                'source': 'KIS WebSocket',
            })
            continue
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
                'price': abs(price or 0),
                'change': _signed_change(change, change_rate) or 0,
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
    """미국 종목을 KIS 실시간 키로 바꾼다.

    REST 시세에서 확인한 거래소가 있으면 종목당 한 키만 등록한다. 예전처럼 모든
    종목을 NAS/NYS/AMS 세 거래소에 중복 등록하면 국내 13 + 미국 24 관심종목에서
    KIS 50개 등록 상한을 넘어 뒤쪽 미국 종목이 WebSocket에서 빠진다.
    """
    keys = []
    prefixes = {
        'NAS': 'DNAS', 'ND': 'DNAS', 'NMS': 'DNAS', 'NASDAQ': 'DNAS',
        'NYS': 'DNYS', 'NY': 'DNYS', 'NYSE': 'DNYS',
        'AMS': 'DAMS', 'NA': 'DAMS', 'AMEX': 'DAMS',
    }
    for symbol in symbols:
        clean = str(symbol or '').strip().upper()
        if not clean:
            continue
        known = str(us_stocks._symbol_exchange.get(clean) or '').strip().upper()
        candidates = (prefixes[known],) if known in prefixes else ('DNAS', 'DNYS', 'DAMS')
        for prefix in candidates:
            keys.append((prefix + clean, 'HDFSCNT0'))
    return keys[:_MAX_CODES]


async def _relay_once_kis(browser_ws, domestic_codes, us_symbols):
    """KIS 공용 허브에 구독해 이 브라우저 연결이 원한 종목의 체결·호가만 넘긴다."""
    appkey = os.environ.get('KIS_APPKEY')
    appsecret = os.environ.get('KIS_APPSECRET')
    if not appkey or not appsecret:
        raise RuntimeError('KIS_APPKEY/KIS_APPSECRET가 설정되지 않았습니다.')
    hub = kis_ws_hub.start(appkey, appsecret)
    if hub is None:
        raise RuntimeError('KIS 공유 WebSocket 허브를 시작하지 못했습니다.')

    registrations = []
    # 호가(orderbook) 메시지를 쓰는 화면은 한 종목짜리 호가창(js/order-book.js)뿐이다. 종목판·
    # 카드·관심종목처럼 여러 종목을 여는 연결까지 호가를 등록하면 KIS 세션 등록 자리(40)를
    # 두 배로 먹어, 2026-09-14 라이브에서 국내 주요종목 한 페이지만으로 103건이 밀려났다.
    include_orderbook = len(domestic_codes) == 1
    for code in domestic_codes:
        # KIS 통합 TR 하나로 KRX와 NXT를 함께 받는다. 호가는 REST 폴링도 있으므로 등록 자리가
        # 모자라면 체결보다 먼저 빠지게 우선순위를 낮춘다.
        registrations.append(('H0UNCNT0', code, kis_ws_hub.PRIORITY_QUOTES))
        if include_orderbook:
            registrations.append(('H0UNASP0', code, kis_ws_hub.PRIORITY_ORDERBOOK))
    for key, tr_id in _kis_us_keys(us_symbols):
        registrations.append((tr_id, key, kis_ws_hub.PRIORITY_QUOTES))
    if not registrations:
        raise RuntimeError('KIS 실시간 구독 종목이 없습니다.')

    wanted = set(domestic_codes) | {'US:' + symbol for symbol in us_symbols}
    subscription = hub.subscribe(registrations)
    loop = asyncio.get_running_loop()
    started = loop.time()
    last_message_at = started
    next_coverage_check = started + _COVERAGE_GRACE_SEC
    # 2026-09-14: 허브 등록 자리(40)에 못 들어간 종목은 체결이 오지 않는데 화면은 그걸 몰라
    # 멈춘 가격을 실시간처럼 보여줬다. 등록 여부를 `coverage`로 알려주고, 빠진 종목은 REST
    # 통합 시세를 `delayed: true` quote로 대신 보낸다(rest_quote_fallback.py).
    fallback = None
    fallback_codes = set()
    delayed_sent = None
    last_fallback_at = {}
    try:
        await browser_ws.send_json({
            'type': 'ready',
            'codes': domestic_codes + ['US:' + symbol for symbol in us_symbols],
        })
        while True:
            try:
                raw = await asyncio.wait_for(subscription.queue.get(), timeout=_RELAY_TICK_SEC)
            except asyncio.TimeoutError:
                raw = None
            now = loop.time()
            if raw is not None:
                for event in _kis_quote_events(raw):
                    if event.get('code') in wanted:
                        await browser_ws.send_json(event)
                        last_message_at = now
            if domestic_codes and now >= next_coverage_check:
                next_coverage_check = now + _RELAY_TICK_SEC
                live_keys = hub.registered_keys()
                delayed = [code for code in domestic_codes if ('H0UNCNT0', code) not in live_keys]
                if delayed != delayed_sent:
                    if delayed and fallback is None:
                        fallback = rest_quote_fallback.start(appkey, appsecret)
                    if fallback is not None:
                        delayed_set = set(delayed)
                        if fallback_codes - delayed_set:
                            fallback.release(fallback_codes - delayed_set)
                        if delayed_set - fallback_codes:
                            fallback.want(delayed_set - fallback_codes)
                        fallback_codes = delayed_set
                    await browser_ws.send_json({
                        'type': 'coverage',
                        'live': [code for code in domestic_codes if code not in set(delayed)],
                        'delayed': delayed,
                    })
                    delayed_sent = delayed
                    last_message_at = now
                if fallback is not None:
                    for code in delayed:
                        event = fallback.latest(code)
                        if event and event.get('fetchedAt') != last_fallback_at.get(code):
                            last_fallback_at[code] = event.get('fetchedAt')
                            await browser_ws.send_json(event)
                            last_message_at = now
            if now - last_message_at >= _RELAY_STATUS_INTERVAL_SEC:
                status = hub.health()
                await browser_ws.send_json({
                    'type': 'status',
                    'upstream': 'connected' if status.get('connected') else 'retrying',
                    'lastTickAgeSec': status.get('lastTickAgeSec'),
                })
                last_message_at = now
    finally:
        subscription.close()
        if fallback is not None and fallback_codes:
            fallback.release(fallback_codes)


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
