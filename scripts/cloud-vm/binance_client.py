# -*- coding: utf-8 -*-
"""바이낸스 공개 시세 API 래퍼(인증 불필요, 주문 기능 없음).

2026-09-15 작업지시서 "바이낸스 주식추종 토큰 API 연동". 국내 증시가 닫힌 시간(주말·야간)에
SAMSUNGUSDT·SKHYNIXUSDT 등 바이낸스 무기한선물 가격을 참고 지표로 보여주기 위한 조회 전용 모듈이다.

엔드포인트(2026-09-15 로컬 실측, 모두 200):
- 선물 `GET /fapi/v1/exchangeInfo` - SAMSUNGUSDT·SKHYNIXUSDT: contractType=TRADIFI_PERPETUAL,
  underlyingType=KR_EQUITY, status=TRADING
- 선물 `GET /fapi/v1/ticker/24hr?symbol=` - lastPrice, priceChangePercent, highPrice, lowPrice, quoteVolume
- 선물 `GET /fapi/v1/premiumIndex?symbol=` - markPrice, indexPrice, lastFundingRate
- 선물 `GET /fapi/v1/klines?symbol=&interval=1h&limit=` - [openTime, open, high, low, close, volume, closeTime, ...]
- 현물(폴백) `GET /api/v3/exchangeInfo?symbol=`, `/api/v3/ticker/24hr`, `/api/v3/klines`
요청 가중치는 호출당 1~2(응답 헤더 x-mbx-used-weight-1m으로 확인).

바이낸스는 일부 지역(미국 등) IP를 HTTP 451로 막는다. 운영 VM이 us-central1이라 막힐 수 있어,
451은 BinanceRestricted로 따로 알려 호출하는 쪽이 오래 쉬도록 한다.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

FAPI_BASE = 'https://fapi.binance.com'
SPOT_BASE = 'https://api.binance.com'
UA = 'tistory-ticker/1.0 (+https://ghlee.tistory.com)'
MAX_RETRY_AFTER_SEC = 60

_urlopen = urllib.request.urlopen


class BinanceError(Exception):
    pass


class BinanceRestricted(BinanceError):
    """서버 위치 제한(HTTP 451) - 이 IP에서는 조회할 수 없다."""


class BinanceInvalidSymbol(BinanceError):
    pass


def get_json(base, path, params=None, timeout=10, retries=2, sleep=time.sleep):
    url = base + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    attempt = 0
    while True:
        request = urllib.request.Request(url, headers={'User-Agent': UA})
        try:
            with _urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            code = exc.code
            body = ''
            try:
                body = exc.read().decode('utf-8', 'ignore')
            except Exception:
                pass
            if code == 451:
                raise BinanceRestricted('HTTP 451 restricted location')
            if code == 400 and '-1121' in body:
                raise BinanceInvalidSymbol('invalid symbol')
            if code in (418, 429) and attempt < retries:
                retry_after = exc.headers.get('Retry-After') if exc.headers else None
                try:
                    wait = min(MAX_RETRY_AFTER_SEC, max(1.0, float(retry_after)))
                except (TypeError, ValueError):
                    wait = 5.0 * (attempt + 1)
                sleep(wait)
                attempt += 1
                continue
            if 500 <= code < 600 and attempt < retries:
                sleep(1.0 * (attempt + 1))
                attempt += 1
                continue
            raise BinanceError('HTTP %s' % code)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if attempt < retries:
                sleep(1.0 * (attempt + 1))
                attempt += 1
                continue
            raise BinanceError('network: %s' % exc)


def futures_symbol_info(symbols):
    """선물 exchangeInfo에서 원하는 심볼만 골라 {symbol: {status, contractType, underlyingType}}."""
    wanted = set(symbols)
    data = get_json(FAPI_BASE, '/fapi/v1/exchangeInfo', timeout=20)
    out = {}
    for row in data.get('symbols') or []:
        symbol = row.get('symbol')
        if symbol in wanted:
            out[symbol] = {
                'status': row.get('status'),
                'contractType': row.get('contractType'),
                'underlyingType': row.get('underlyingType'),
            }
    return out


def spot_symbol_status(symbol):
    try:
        data = get_json(SPOT_BASE, '/api/v3/exchangeInfo', {'symbol': symbol})
    except BinanceInvalidSymbol:
        return None
    rows = data.get('symbols') or []
    return rows[0].get('status') if rows else None


def ticker_24hr(symbol, market='futures'):
    if market == 'futures':
        return get_json(FAPI_BASE, '/fapi/v1/ticker/24hr', {'symbol': symbol})
    return get_json(SPOT_BASE, '/api/v3/ticker/24hr', {'symbol': symbol})


def premium_index(symbol):
    return get_json(FAPI_BASE, '/fapi/v1/premiumIndex', {'symbol': symbol})


def klines(symbol, market='futures', interval='1h', limit=48):
    params = {'symbol': symbol, 'interval': interval, 'limit': int(limit)}
    if market == 'futures':
        return get_json(FAPI_BASE, '/fapi/v1/klines', params)
    return get_json(SPOT_BASE, '/api/v3/klines', params)
