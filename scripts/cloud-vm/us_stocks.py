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
from datetime import datetime, timedelta, time as datetime_time
from zoneinfo import ZoneInfo

import kiwoom_client
import kis_client


logger = logging.getLogger('us_stocks')

SYMBOL_RE = re.compile(r'^[A-Z][A-Z0-9.\-^=]{0,11}$')
SEARCH_TTL_SEC = 600
QUOTE_TTL_SEC = 10
MAX_CACHE_ENTRIES = 100
NY_TZ = ZoneInfo('America/New_York')
US_DAILY_LOOKBACK_CALENDAR_DAYS = 730

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
    for key in ('output', 'output1', 'result_list', 'data', 'items', 'rows', 'result'):
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
    change = _number(_first(row, 'diff', 'change', 'pred_pre', 'prdy_vrss'))
    change_rate = _number(_first(row, 'rate', 'flu_rt', 'change_rate', 'prdy_ctrt'))
    if previous_close is None and change is not None:
        previous_close = price - change
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


def _kiwoom_exchange_candidates(symbol):
    known = _symbol_exchange.get(symbol)
    candidates = [known] if known else []
    candidates.extend(code for code in ('ND', 'NY', 'NA') if code not in candidates)
    return candidates


def _kiwoom_orderbook(symbol):
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    last_error = None
    for exchange in _kiwoom_exchange_candidates(symbol):
        try:
            response = kiwoom_client.call_tr(token, 'usa20101', '/api/us/mrkcond', {
                'stex_tp': exchange,
                'stk_cd': symbol,
            })
            rows = _records(response)
            if not rows:
                continue
            row = rows[0]
            asks = []
            bids = []
            for level in range(1, 11):
                ask_price = _number(_first(row, 'sel_%dbid' % level))
                ask_size = _number(_first(row, 'sel_%dbid_req' % level))
                bid_price = _number(_first(row, 'buy_%dbid' % level))
                bid_size = _number(_first(row, 'buy_%dbid_req' % level))
                if ask_price is not None:
                    asks.append({'level': level, 'price': ask_price, 'size': ask_size})
                if bid_price is not None:
                    bids.append({'level': level, 'price': bid_price, 'size': bid_size})
            return {
                'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
                'exchange': exchange, 'asks': asks, 'bids': bids,
                'updated_at': int(time.time()), 'source': '키움증권 REST API',
            }
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('키움 미국주식 호가 조회 실패') from last_error


def _chart_time(row, daily):
    date_text = str(_first(row, 'bus_dt', 'dt', 'date') or '')
    time_text = str(_first(row, 'cntr_tm', 'time') or '')
    if daily:
        return date_text[:4] + '-' + date_text[4:6] + '-' + date_text[6:8] if len(date_text) == 8 else date_text
    if len(time_text) == 14:
        date_text, time_text = time_text[:8], time_text[8:]
    if len(date_text) != 8 or len(time_text) < 4:
        return None
    try:
        local = datetime.strptime(date_text + time_text[:6], '%Y%m%d%H%M%S').replace(tzinfo=NY_TZ)
        return int(local.timestamp())
    except ValueError:
        return None


def chart(symbol, timeframe='minute'):
    """키움 미국주식 분봉 또는 일봉을 공통 포맷으로 반환한다."""
    symbol = normalize_symbol(symbol)
    if timeframe not in ('minute', 'daily'):
        raise ValueError('timeframe은 minute 또는 daily여야 합니다.')
    if not _has_kiwoom():
        raise UsStockUnavailable('키움증권 인증정보가 없습니다.')
    token = kiwoom_client.get_token(os.environ['KIWOOM_APPKEY'], os.environ['KIWOOM_SECRETKEY'])
    api_id = 'usa06011' if timeframe == 'minute' else 'usa06012'
    today = datetime.now(NY_TZ).date()
    # 미국 분봉 API는 장기간을 한 번에 요청하면 정상 코드(0)여도
    # result_list가 비어 올 수 있습니다. 분봉은 오늘 데이터만, 일봉은 2년 범위를 요청합니다.
    start_date = today.strftime('%Y%m%d') if timeframe == 'minute' else (
        today - timedelta(days=US_DAILY_LOOKBACK_CALENDAR_DAYS)
    ).strftime('%Y%m%d')
    last_error = None
    for exchange in _kiwoom_exchange_candidates(symbol):
        body = {
            'stex_tp': exchange, 'stk_cd': symbol, 'strt_dt': start_date,
            'upd_stkpc_tp': '1', 'exrt_appl_tp': '0',
        }
        if timeframe == 'minute':
            body['tic_scope'] = '1'
        try:
            response = kiwoom_client.call_tr(token, api_id, '/api/us/chart', body)
            rows = _records(response)
            points = []
            for row in rows:
                stamp = _chart_time(row, timeframe == 'daily')
                price = _number(_first(row, 'cur_prc', 'price'))
                if stamp is None or price is None:
                    continue
                open_price = _number(_first(row, 'open_pric', 'open', 'open_price')) or price
                high_price = _number(_first(row, 'high_pric', 'high', 'high_price')) or max(open_price, price)
                low_price = _number(_first(row, 'low_pric', 'low', 'low_price')) or min(open_price, price)
                points.append({
                    'time': stamp,
                    'open': open_price,
                    'high': high_price,
                    'low': low_price,
                    'close': price,
                    'price': price,
                    'volume': _number(_first(row, 'trde_qty', 'acc_trde_qty')) or 0,
                })
            if points:
                points.sort(key=lambda point: point['time'])
                return {
                    'market': 'us', 'symbol': symbol, 'code': 'US:' + symbol,
                    'timeframe': timeframe, 'exchange': exchange,
                    'points': points, 'updated_at': int(time.time()),
                    'source': '키움증권 REST API',
                }
        except Exception as exc:
            last_error = exc
    raise UsStockUnavailable('키움 미국주식 차트 조회 실패') from last_error


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
