# -*- coding: utf-8 -*-
"""미국주식 검색·시세 어댑터.

시세 우선순위는 키움 REST API -> 한국투자증권 Open API다.
두 증권사 모두 실패하면 공개 중계 시세를 섞지 않고 명확히 실패시킨다.
"""

import logging
import os
import re
import threading
import time
from datetime import datetime, time as datetime_time
from zoneinfo import ZoneInfo

import kiwoom_client
import kis_client


logger = logging.getLogger('us_stocks')

SYMBOL_RE = re.compile(r'^[A-Z][A-Z0-9.\-^=]{0,11}$')
SEARCH_TTL_SEC = 600
QUOTE_TTL_SEC = 10
MAX_CACHE_ENTRIES = 100
NY_TZ = ZoneInfo('America/New_York')

_cache_lock = threading.Lock()
_search_cache = {}
_quote_cache = {}
_symbol_cache = {'saved_at': 0, 'rows': []}
_symbol_exchange = {}


class UsStockUnavailable(RuntimeError):
    """증권사 API에서 미국주식 데이터를 받을 수 없는 경우."""


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


def _number(value):
    if value is None or value == '':
        return None
    try:
        return float(str(value).replace(',', '').replace('%', '').strip())
    except (TypeError, ValueError):
        return None


def _first(row, *names):
    if not isinstance(row, dict):
        return None
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value not in (None, ''):
            return value
    return None


def _records(payload):
    """키움 응답의 output/data/list 포장 차이를 흡수한다."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ('output', 'output1', 'data', 'items', 'rows', 'result'):
        if key in payload:
            rows = _records(payload[key])
            if rows:
                return rows
    if any(key in payload for key in ('stk_cd', 'stk_nm', 'cur_prc', 'last', 'symbol')):
        return [payload]
    return []


def _has_kiwoom():
    return bool(os.environ.get('KIWOOM_APPKEY') and os.environ.get('KIWOOM_SECRETKEY'))


def _has_kis():
    return bool(os.environ.get('KIS_APPKEY') and os.environ.get('KIS_APPSECRET'))


def _exchange_code(exchange, broker):
    text = str(exchange or '').upper()
    if broker == 'kiwoom':
        return {'NASDAQ': 'ND', 'NMS': 'ND', 'NYSE': 'NY', 'NYQ': 'NY', 'AMEX': 'NA', 'ASE': 'NA'}.get(text)
    return {'NASDAQ': 'NAS', 'NMS': 'NAS', 'NYSE': 'NYS', 'NYQ': 'NYS', 'AMEX': 'AMS', 'ASE': 'AMS'}.get(text)


def _records_from_kiwoom_symbol_list():
    now = time.time()
    if _symbol_cache['rows'] and now - _symbol_cache['saved_at'] < SEARCH_TTL_SEC:
        return _symbol_cache['rows']
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    response = kiwoom_client.call_tr(token, 'usa10099', '/api/us/mrkcond', {'stex_tp': '%'})
    rows = _records(response)
    if not rows:
        raise UsStockUnavailable('키움 미국주식 종목 목록이 비어 있습니다.')
    normalized = []
    for row in rows:
        symbol = str(_first(row, 'stk_cd', 'symbol', 'code') or '').upper()
        if not SYMBOL_RE.fullmatch(symbol):
            continue
        name = _first(row, 'stk_nm', 'stk_enm', 'name', 'short_name') or symbol
        exchange = _first(row, 'stex_tp', 'exchange') or ''
        normalized.append({
            'market': 'us',
            'symbol': symbol,
            'code': 'US:' + symbol,
            'name': name,
            'exchange': exchange,
            'quote_type': 'EQUITY',
        })
        broker_exchange = _exchange_code(exchange, 'kiwoom') or exchange
        if broker_exchange in ('ND', 'NY', 'NA'):
            _symbol_exchange[symbol] = broker_exchange
    _symbol_cache.update(saved_at=now, rows=normalized)
    return normalized


def search(query, limit=8):
    text = str(query or '').strip()
    if not text:
        return []
    limit = max(1, min(int(limit or 8), 20))
    key = text.lower() + ':' + str(limit)
    cached = _cache_get(_search_cache, key, SEARCH_TTL_SEC)
    if cached is not None:
        return cached
    try:
        rows = _records_from_kiwoom_symbol_list()
        needle = text.casefold()
        ranked = sorted(
            rows,
            key=lambda row: (
                0 if row['symbol'].casefold() == needle else 1,
                0 if row['symbol'].casefold().startswith(needle) else 1,
                0 if needle in row['name'].casefold() else 1,
                row['symbol'],
            ),
        )
        result = [row for row in ranked if needle in row['symbol'].casefold() or needle in row['name'].casefold()][:limit]
    except Exception as exc:
        logger.warning('Kiwoom 미국주식 검색 실패: %s', exc)
        # 인증 전에도 티커 직접 입력은 페이지에서 조회할 수 있도록 최소 행을 만든다.
        symbol = text.upper()
        result = ([{
            'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
            'name': symbol, 'exchange': '', 'quote_type': 'EQUITY',
        }] if SYMBOL_RE.fullmatch(symbol) else [])
    _cache_put(_search_cache, key, result)
    return result


def _market_state():
    now = datetime.now(NY_TZ)
    if now.weekday() >= 5:
        return 'closed'
    current = now.time()
    if datetime_time(4, 0) <= current < datetime_time(9, 30):
        return 'pre'
    if datetime_time(9, 30) <= current < datetime_time(16, 0):
        return 'regular'
    if datetime_time(16, 0) <= current < datetime_time(20, 0):
        return 'post'
    return 'closed'


def _normalize_quote(row, symbol, provider, exchange):
    price = _number(_first(row, 'cur_prc', 'last', 'last_pric', 'last_price', 'price'))
    if price is None:
        raise UsStockUnavailable(provider + ' 미국주식 현재가가 비어 있습니다.')
    previous_close = _number(_first(row, 'base_close_pric', 'base', 'base_pric', 'previous_close', 'prev_close'))
    change = _number(_first(row, 'diff', 'change', 'prdy_vrss'))
    change_rate = _number(_first(row, 'rate', 'change_rate', 'prdy_ctrt'))
    if change is None and previous_close is not None:
        change = price - previous_close
    if change_rate is None and previous_close:
        change_rate = change / previous_close * 100 if change is not None else None
    return {
        'market': 'us',
        'symbol': symbol,
        'code': 'US:' + symbol,
        'name': _first(row, 'stk_nm', 'stk_enm', 'name', 'prdt_name', 'ovrs_item_name') or symbol,
        'exchange': exchange or _first(row, 'stex_tp', 'excd', 'exchange') or '',
        'currency': 'USD',
        'price': price,
        'previous_close': previous_close,
        'change': change,
        'change_rate': change_rate,
        'day_high': _number(_first(row, 'high_pric', 'high', 'day_high')),
        'day_low': _number(_first(row, 'low_pric', 'low', 'day_low')),
        'volume': _number(_first(row, 'acc_trde_qty', 'tvol', 'volume', 'acml_vol')),
        'week52_high': _number(_first(row, '52wk_hgst_pric', 'fifty_two_week_high')),
        'week52_low': _number(_first(row, '52wk_lwst_pric', 'fifty_two_week_low')),
        'market_state': _market_state(),
        'updated_at': int(time.time()),
        'source': provider,
        'provider': 'kiwoom' if provider.startswith('키움') else 'kis',
    }


def _kiwoom_quote(symbol):
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    candidates = [_symbol_exchange.get(symbol)] if _symbol_exchange.get(symbol) else []
    candidates.extend(code for code in ('ND', 'NY', 'NA') if code not in candidates)
    last_error = None
    for exchange in candidates:
        try:
            response = kiwoom_client.call_tr(token, 'usa20100', '/api/us/mrkcond', {
                'stex_tp': exchange,
                'stk_cd': symbol,
            })
            rows = _records(response)
            if rows:
                return _normalize_quote(rows[0], symbol, '키움증권 REST API', exchange)
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('키움 미국주식 현재가 조회 실패') from last_error


def _kis_quote(symbol):
    if not _has_kis():
        raise UsStockUnavailable('한국투자증권 인증정보가 없습니다.')
    token = kis_client.get_token(os.environ['KIS_APPKEY'], os.environ['KIS_APPSECRET'])
    candidates = [_symbol_exchange.get(symbol)] if _symbol_exchange.get(symbol) else []
    candidates.extend(code for code in ('NAS', 'NYS', 'AMS') if code not in candidates)
    last_error = None
    for exchange in candidates:
        try:
            row = kis_client.fetch_overseas_price(token, os.environ['KIS_APPKEY'], os.environ['KIS_APPSECRET'], exchange, symbol)
            if isinstance(row, list):
                row = row[0] if row else {}
            if row:
                return _normalize_quote(row, symbol, '한국투자증권 Open API', exchange)
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('한국투자증권 미국주식 현재가 조회 실패') from last_error


def quote(symbol):
    symbol = normalize_symbol(symbol)
    cached = _cache_get(_quote_cache, symbol, QUOTE_TTL_SEC)
    if cached is not None:
        return cached
    errors = []
    for fetcher in (_kiwoom_quote, _kis_quote):
        try:
            data = fetcher(symbol)
            _cache_put(_quote_cache, symbol, data)
            return data
        except Exception as exc:
            errors.append(str(exc))
            logger.warning('%s quote failed for %s: %s', getattr(fetcher, '__name__', 'broker'), symbol, exc)
    raise UsStockUnavailable('키움·한국투자증권 미국주식 시세를 모두 조회하지 못했습니다.')
