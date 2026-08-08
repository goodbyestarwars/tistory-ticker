# -*- coding: utf-8 -*-
"""미국 개별주식 검색·시세 조회.

Yahoo Finance의 공개 chart/search 응답을 서버에서 받아 브라우저에 전달한다.
프론트에 외부 호출을 직접 노출하지 않고, 짧은 메모리 캐시로 같은 종목을 여러
방문자가 동시에 조회할 때 외부 요청을 중복하지 않는다. 공개 시세는 거래소·상품에
따라 지연될 수 있으므로 응답에 source와 updated_at을 함께 넣는다.
"""

import json
import logging
import re
import threading
import time
import urllib.parse
import urllib.request


logger = logging.getLogger('us_stocks')

BASE_URL = 'https://query1.finance.yahoo.com'
USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
SYMBOL_RE = re.compile(r'^[A-Z][A-Z0-9.\-^=]{0,11}$')
US_EXCHANGES = {'NMS', 'NYQ', 'ASE', 'BTS', 'NGM', 'NCM', 'PCX'}
SEARCH_TTL_SEC = 60
QUOTE_TTL_SEC = 10
MAX_CACHE_ENTRIES = 100

_cache_lock = threading.Lock()
_search_cache = {}
_quote_cache = {}


class UsStockUnavailable(RuntimeError):
    """Yahoo 공개 API에서 미국주식 데이터를 받을 수 없을 때 사용한다."""


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as exc:
        raise UsStockUnavailable('미국주식 데이터 조회 실패') from exc


def _cache_get(cache, key, ttl):
    with _cache_lock:
        entry = cache.get(key)
        if entry and time.time() - entry[0] < ttl:
            return entry[1]
        if entry:
            cache.pop(key, None)
    return None


def _cache_put(cache, key, value):
    with _cache_lock:
        cache[key] = (time.time(), value)
        while len(cache) > MAX_CACHE_ENTRIES:
            cache.pop(next(iter(cache)))


def normalize_symbol(symbol):
    value = str(symbol or '').strip().upper()
    if value.startswith('US:'):
        value = value[3:]
    if not SYMBOL_RE.fullmatch(value):
        raise ValueError('유효하지 않은 미국주식 티커입니다.')
    return value


def search(query, limit=8):
    text = str(query or '').strip()
    if not text:
        return []
    limit = max(1, min(int(limit or 8), 20))
    key = text.lower() + ':' + str(limit)
    cached = _cache_get(_search_cache, key, SEARCH_TTL_SEC)
    if cached is not None:
        return cached

    url = BASE_URL + '/v1/finance/search?' + urllib.parse.urlencode({
        'q': text,
        'quotesCount': limit * 2,
        'newsCount': 0,
    })
    payload = _get_json(url)
    rows = []
    for item in (payload.get('quotes') or []):
        symbol = str(item.get('symbol') or '').upper()
        if item.get('quoteType') not in ('EQUITY', 'ETF'):
            continue
        if item.get('exchange') not in US_EXCHANGES or not SYMBOL_RE.fullmatch(symbol):
            continue
        rows.append({
            'market': 'us',
            'symbol': symbol,
            'code': 'US:' + symbol,
            'name': item.get('longname') or item.get('shortname') or symbol,
            'exchange': item.get('exchDisp') or item.get('exchange') or '',
            'quote_type': item.get('quoteType'),
        })
        if len(rows) >= limit:
            break
    _cache_put(_search_cache, key, rows)
    return rows


def _market_state(meta):
    now = int(time.time())
    periods = meta.get('currentTradingPeriod') or {}
    for name in ('pre', 'regular', 'post'):
        period = periods.get(name) or {}
        if period.get('start') and period.get('end') and period['start'] <= now < period['end']:
            return name
    return 'closed'


def _latest_close(result):
    timestamps = result.get('timestamp') or []
    quote_rows = (result.get('indicators') or {}).get('quote') or []
    closes = quote_rows[0].get('close') if quote_rows else []
    for index in range(min(len(timestamps), len(closes or [])) - 1, -1, -1):
        if closes[index] is not None:
            return float(closes[index]), int(timestamps[index])
    return None, None


def quote(symbol):
    symbol = normalize_symbol(symbol)
    cached = _cache_get(_quote_cache, symbol, QUOTE_TTL_SEC)
    if cached is not None:
        return cached

    url = BASE_URL + '/v8/finance/chart/' + urllib.parse.quote(symbol, safe='') + '?' + urllib.parse.urlencode({
        'range': '1d',
        'interval': '1m',
        'includePrePost': 'true',
    })
    payload = _get_json(url)
    results = (payload.get('chart') or {}).get('result') or []
    if not results:
        raise UsStockUnavailable('미국주식 티커를 찾을 수 없습니다.')
    result = results[0]
    meta = result.get('meta') or {}
    price, latest_timestamp = _latest_close(result)
    if price is None:
        price = meta.get('regularMarketPrice')
    if price is None:
        raise UsStockUnavailable('현재가 데이터가 없습니다.')
    previous_close = meta.get('chartPreviousClose') or meta.get('previousClose')
    try:
        previous_close = float(previous_close) if previous_close is not None else None
    except (TypeError, ValueError):
        previous_close = None
    change = price - previous_close if previous_close is not None else None
    change_rate = (change / previous_close * 100) if previous_close else None
    data = {
        'market': 'us',
        'symbol': symbol,
        'code': 'US:' + symbol,
        'name': meta.get('longName') or meta.get('shortName') or symbol,
        'exchange': meta.get('fullExchangeName') or meta.get('exchangeName') or '',
        'currency': meta.get('currency') or 'USD',
        'price': price,
        'previous_close': previous_close,
        'change': change,
        'change_rate': change_rate,
        'day_high': meta.get('regularMarketDayHigh'),
        'day_low': meta.get('regularMarketDayLow'),
        'volume': meta.get('regularMarketVolume'),
        'week52_high': meta.get('fiftyTwoWeekHigh'),
        'week52_low': meta.get('fiftyTwoWeekLow'),
        'market_state': _market_state(meta),
        'updated_at': (latest_timestamp or meta.get('regularMarketTime')),
        'source': 'Yahoo Finance 공개 시세(지연 가능)',
    }
    _cache_put(_quote_cache, symbol, data)
    return data
