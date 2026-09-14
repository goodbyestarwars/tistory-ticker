# -*- coding: utf-8 -*-
"""바이낸스 국내주식 토큰(SAMSUNGUSDT·SKHYNIXUSDT) 참고 시세 수집.

2026-09-15 작업지시서 "바이낸스 주식추종 토큰 API 연동". 국내 증시가 닫힌 시간(주말·야간)에
바이낸스 무기한선물 가격을 월요일 개장 전 참고 지표로 보여준다. 실주문·자동매매는 범위 밖이다.

설계 결정(작업지시서 제안과 다른 점):
- 별도 스캔 프로세스·잠금 파일(.binance_lock)을 두지 않고 FastAPI 프로세스 안의 스레드 하나로 돈다.
  VM이 e2-micro(메모리 1GB)라 파이썬 프로세스를 하나 더 띄우는 것 자체가 부담이다(2026-09-14 스캔 몰림 장애).
- 모듈은 scripts/cloud-vm/ 평면 파일이다. 배포 스크립트가 scripts/cloud-vm/*.py만 복사한다.
- 저장은 기존 DB와 잠금이 겹치지 않게 별도 SQLite(binance_quotes.db)에 (symbol, ts, price, source)만.

주기(국내 장 기준 - market_clock):
- 장이 닫힌 시간: 5분마다 24시간 시세 + 마크가격·펀딩비(심볼당 2회 호출)
- 장중: 30분마다(국내 시세가 있으니 참고 지표 갱신은 느려도 된다)
- 1시간 캔들: 1시간마다 48개, 심볼 상장 여부(exchangeInfo): 하루 1번
- HTTP 451(서버 위치 제한)이면 6시간마다만 다시 시도하고 화면에 사유를 보여준다.
"""

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

import binance_client

logger = logging.getLogger('binance_flow')

SYMBOLS = (
    ('SAMSUNGUSDT', '삼성전자'),
    ('SKHYNIXUSDT', 'SK하이닉스'),
)
CLOSED_POLL_SEC = 5 * 60
OPEN_POLL_SEC = 30 * 60
KLINES_REFRESH_SEC = 60 * 60
SYMBOL_CHECK_SEC = 24 * 3600
RESTRICTED_RETRY_SEC = 6 * 3600
RETENTION_DAYS = 14
KLINE_LIMIT = 48
NOTE = '바이낸스 무기한선물(파생상품) 가격입니다. 실제 주식 수급이 아닌 참고 지표입니다.'
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'binance_quotes.db')

_lock = threading.Lock()
_state = {
    'markets': {},          # symbol -> 'futures' | 'spot' | None
    'items': {},            # symbol -> 화면용 dict
    'klines': {},           # symbol -> [[openTimeMs, close], ...]
    'restricted': False,
    'error': None,
    'checkedAt': 0.0,
    'quotedAt': 0.0,
    'klinesAt': 0.0,
}
_thread = None


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def resolve_markets(client=binance_client, symbols=SYMBOLS):
    """선물에 TRADING으로 있으면 선물, 없으면 현물 확인, 둘 다 없으면 None(조용히 건너뜀)."""
    names = [symbol for symbol, _label in symbols]
    futures = client.futures_symbol_info(names)
    markets = {}
    for symbol in names:
        info = futures.get(symbol)
        if info and info.get('status') == 'TRADING':
            markets[symbol] = 'futures'
            continue
        try:
            spot = client.spot_symbol_status(symbol)
        except binance_client.BinanceRestricted:
            raise
        except binance_client.BinanceError as exc:
            logger.info('바이낸스 현물 심볼 확인 실패(%s): %s', symbol, exc)
            spot = None
        markets[symbol] = 'spot' if spot == 'TRADING' else None
        if markets[symbol] is None:
            logger.info('바이낸스 심볼 미상장 - 건너뜀: %s', symbol)
    return markets


def build_item(symbol, label, market, ticker, premium=None):
    price = _num(ticker.get('lastPrice'))
    if price is None:
        return None
    return {
        'symbol': symbol,
        'label': label,
        'market': market,
        'price': price,
        'changeRate': _num(ticker.get('priceChangePercent')),
        'high24h': _num(ticker.get('highPrice')),
        'low24h': _num(ticker.get('lowPrice')),
        'quoteVolume': _num(ticker.get('quoteVolume')),
        'markPrice': _num((premium or {}).get('markPrice')),
        'fundingRate': _num((premium or {}).get('lastFundingRate')),
        'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }


def closes_from_klines(rows):
    out = []
    for row in rows or []:
        try:
            out.append([int(row[0]), float(row[4])])
        except (IndexError, TypeError, ValueError):
            continue
    return out


def ensure_schema(conn):
    conn.execute(
        'CREATE TABLE IF NOT EXISTS binance_prices ('
        ' symbol TEXT NOT NULL, ts INTEGER NOT NULL, price REAL NOT NULL, source TEXT NOT NULL,'
        ' PRIMARY KEY (symbol, ts))')
    conn.commit()


def store_prices(conn, items, now_ts=None, retention_days=RETENTION_DAYS):
    now_ts = int(now_ts if now_ts is not None else time.time())
    rows = [(item['symbol'], now_ts, item['price'], 'binance-' + item['market'])
            for item in items if item and item.get('price') is not None]
    if rows:
        conn.executemany('INSERT OR REPLACE INTO binance_prices (symbol, ts, price, source) VALUES (?, ?, ?, ?)', rows)
    conn.execute('DELETE FROM binance_prices WHERE ts < ?', (now_ts - int(retention_days) * 86400,))
    conn.commit()
    return len(rows)


def refresh_once(client=binance_client, symbols=SYMBOLS, now=None, db_file=None):
    """필요한 호출만 하고 상태를 갱신한다. 451이면 restricted로 표시하고 예외를 삼킨다."""
    now = now if now is not None else time.time()
    try:
        with _lock:
            need_check = not _state['markets'] or now - _state['checkedAt'] >= SYMBOL_CHECK_SEC
        if need_check:
            markets = resolve_markets(client, symbols)
            with _lock:
                _state['markets'] = markets
                _state['checkedAt'] = now
        with _lock:
            markets = dict(_state['markets'])
            need_klines = now - _state['klinesAt'] >= KLINES_REFRESH_SEC

        items = []
        new_klines = {}
        for symbol, label in symbols:
            market = markets.get(symbol)
            if not market:
                continue
            try:
                ticker = client.ticker_24hr(symbol, market)
                premium = client.premium_index(symbol) if market == 'futures' else None
                item = build_item(symbol, label, market, ticker, premium)
                if item:
                    items.append(item)
                if need_klines:
                    new_klines[symbol] = closes_from_klines(client.klines(symbol, market, '1h', KLINE_LIMIT))
            except binance_client.BinanceRestricted:
                raise
            except binance_client.BinanceError as exc:
                logger.info('바이낸스 시세 조회 실패(%s): %s', symbol, exc)

        if items:
            conn = sqlite3.connect(db_file or DB_FILE, timeout=5)
            try:
                ensure_schema(conn)
                store_prices(conn, items, now)
            finally:
                conn.close()
        with _lock:
            for item in items:
                _state['items'][item['symbol']] = item
            if need_klines:
                _state['klines'].update(new_klines)
                _state['klinesAt'] = now
            _state['quotedAt'] = now
            _state['restricted'] = False
            _state['error'] = None if items else '표시할 바이낸스 시세가 없습니다.'
        return items
    except binance_client.BinanceRestricted as exc:
        with _lock:
            _state['restricted'] = True
            _state['error'] = str(exc)
            _state['quotedAt'] = now
        logger.warning('바이낸스 조회가 서버 위치 제한으로 막힘(%s) - %d시간 뒤 재시도', exc, RESTRICTED_RETRY_SEC // 3600)
        return []
    except Exception as exc:
        with _lock:
            _state['error'] = str(exc)[:200]
        logger.warning('바이낸스 참고 시세 갱신 실패: %s', exc)
        return []


def next_sleep_seconds():
    import market_clock
    with _lock:
        restricted = _state['restricted']
    if restricted:
        return RESTRICTED_RETRY_SEC
    return OPEN_POLL_SEC if market_clock.kr_market_active() else CLOSED_POLL_SEC


def _loop():
    while True:
        refresh_once()
        time.sleep(next_sleep_seconds())


def start_background():
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return _thread
        _thread = threading.Thread(target=_loop, name='binance-flow', daemon=True)
        _thread.start()
    return _thread


def get_payload():
    with _lock:
        items = []
        for symbol, _label in SYMBOLS:
            item = _state['items'].get(symbol)
            if item:
                row = dict(item)
                row['klines'] = list(_state['klines'].get(symbol) or [])
                items.append(row)
        return {
            'available': bool(items),
            'restricted': _state['restricted'],
            'error': _state['error'],
            'note': NOTE,
            'updatedAt': (datetime.fromtimestamp(_state['quotedAt'], timezone.utc).isoformat(timespec='seconds')
                          if _state['quotedAt'] else None),
            'items': items,
        }
