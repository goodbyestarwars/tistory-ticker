# -*- coding: utf-8 -*-
"""홈 실시간 종목판용 국내·미국 공통 데이터 모델."""

import logging
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import kiwoom_client
import market_rank
import us_analysis
import us_stocks

logger = logging.getLogger('market_board')

_BASIC_TTL_SEC = 15 * 60
_basic_cache = {}
_FX_TTL_SEC = 15 * 60
_fx_cache = {}


def _number(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').replace('+', '').strip())
    except (TypeError, ValueError):
        return None


def _first(row, *names):
    if not isinstance(row, dict):
        return None
    for name in names:
        value = row.get(name)
        if value not in (None, ''):
            return value
    return None


def _currency_units_per_usd(currency):
    """Return how many units of a profile currency equal one USD.

    Finnhub profile2 reports marketCapitalization in the profile currency's
    millions. TSM is returned as 2330.TW/TWD even though the board symbol is
    the US ADR, so the raw value must be converted before USD formatting.
    """
    currency = str(currency or 'USD').strip().upper()
    if currency in ('USD', 'US$', '$'):
        return 1.0
    cached = _fx_cache.get(currency)
    now = time.time()
    if cached and now - cached[0] < _FX_TTL_SEC:
        return cached[1]
    if len(currency) != 3 or not currency.isalpha():
        return None
    try:
        pair = currency + '=X'
        query = urllib.parse.urlencode({'range': '1d', 'interval': '1d'})
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + pair + '?' + query
        request = urllib.request.Request(url, headers={'User-Agent': 'tistory-ticker/1.0'})
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode('utf-8'))
        result = ((payload.get('chart') or {}).get('result') or [None])[0] or {}
        meta = result.get('meta') or {}
        rate = _number(meta.get('regularMarketPrice'))
        if rate is None or rate <= 0:
            return None
        _fx_cache[currency] = (now, rate)
        return rate
    except Exception as exc:
        logger.info('FX lookup failed for %s: %s', currency, exc)
        return None


def _profile_market_cap(profile):
    raw = _number(profile.get('marketCapitalization'))
    if raw is None:
        return None
    currency = profile.get('currency') or 'USD'
    units_per_usd = _currency_units_per_usd(currency)
    if units_per_usd is None:
        logger.info('market cap currency unavailable: %s', currency)
        return None
    return raw / units_per_usd


def _basic_info(token, code):
    cached = _basic_cache.get(code)
    if cached and time.time() - cached[0] < _BASIC_TTL_SEC:
        return cached[1]
    try:
        raw = kiwoom_client.call_tr(token, 'ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
        data = {
            # ka10001의 mac은 억원 단위 시가총액이다.
            'market_cap': _number(raw.get('mac')),
            'name': _first(raw, 'stk_nm', 'name'),
        }
    except Exception as exc:
        logger.info('ka10001 basic info failed for %s: %s', code, exc)
        data = {}
    _basic_cache[code] = (time.time(), data)
    return data


def _enrich_domestic(token, rows):
    def enrich(row):
        item = dict(row)
        if item.get('trade_amount'):
            # ka10030 거래금액은 백만원 단위다. 화면 공통 모델은 원 단위로 통일한다.
            item['trade_amount'] = item['trade_amount'] * 1000000
        else:
            item['trade_amount'] = (item.get('price') or 0) * (item.get('trade_volume') or 0)
        info = _basic_info(token, item.get('code'))
        # 기본정보 API가 일시적으로 실패해도 랭킹 API의 종목명은 보존한다.
        if info.get('name'):
            item['name'] = info['name']
        if info.get('market_cap') is not None:
            item['market_cap'] = info['market_cap']
        return item

    out = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(enrich, row) for row in rows]
        for future in as_completed(futures):
            try:
                out.append(future.result())
            except Exception as exc:
                logger.info('domestic board enrichment failed: %s', exc)
    return out


def _sections(rows):
    by_amount = lambda row: row.get('trade_amount') or 0
    by_volume = lambda row: row.get('trade_volume') or 0
    by_rate = lambda row: row.get('change_rate') or 0
    by_cap = lambda row: row.get('market_cap') or 0
    return {
        'tradeAmount': sorted(rows, key=by_amount, reverse=True),
        'tradeVolume': sorted(rows, key=by_volume, reverse=True),
        'rising': sorted([row for row in rows if by_rate(row) > 0], key=by_rate, reverse=True),
        'falling': sorted([row for row in rows if by_rate(row) < 0], key=by_rate),
        'marketCap': sorted(rows, key=by_cap, reverse=True),
        'industry': sorted(rows, key=lambda row: (str(row.get('industry') or '미분류'), -by_amount(row))),
    }


def fetch_domestic(token, limit=12, wics_map=None):
    rank = market_rank.fetch_sidebar_rank(token, limit=max(12, min(int(limit), 20)))
    merged = {}
    for section in ('tradeVolume', 'upperLimit', 'lowerLimit'):
        for row in rank.get(section) or []:
            if row.get('code'):
                merged.setdefault(row['code'], dict(row)).update(row)
    # 세 개의 랭킹 목록을 모두 보여주되, 기본정보 API는 거래량 상위 limit개에만
    # 호출한다. 그래야 홈 한 번의 갱신이 종목 기본정보 수십 건을 만들지 않는다.
    volume_codes = {row.get('code') for row in (rank.get('tradeVolume') or [])[:limit]}
    rows = []
    for row in merged.values():
        if row.get('code') not in volume_codes:
            item = dict(row)
            item['trade_amount'] = (item.get('price') or 0) * (item.get('trade_volume') or 0)
            rows.append(item)
    rows.extend(_enrich_domestic(token, [row for row in merged.values() if row.get('code') in volume_codes]))
    wics_map = wics_map or {}
    for row in rows:
        info = wics_map.get(row.get('code')) or {}
        row['industry'] = info.get('industry') or info.get('sector') or '미분류'
        row['market'] = 'domestic'
        row['currency'] = 'KRW'
    sections = _sections(rows)
    return {
        'market': 'domestic',
        'session': '국내 · 오전 08:00~오후 08:00',
        'rows': sections['tradeAmount'][:limit],
        'sections': {key: value[:limit] for key, value in sections.items()},
        'updated_at': int(time.time()),
        'source': 'Kiwoom ka10030/ka10017/ka10001',
    }


def _us_row(symbol, finnhub_api_key):
    quote = us_stocks.quote(symbol)
    profile = us_analysis.get_profile(symbol, finnhub_api_key) if finnhub_api_key else {}
    price = quote.get('price') or 0
    volume = quote.get('volume') or 0
    return {
        'market': 'us',
        'code': 'US:' + symbol,
        'symbol': symbol,
        'name': profile.get('name') or quote.get('name') or symbol,
        'price': price,
        'change': quote.get('change'),
        'change_rate': quote.get('change_rate') or 0,
        'trade_volume': volume,
        'trade_amount': price * volume,
        # Finnhub profile2 may report a foreign primary-listing currency.
        'market_cap': _profile_market_cap(profile),
        'industry': profile.get('finnhubIndustry') or profile.get('gsector') or '미분류',
        'currency': 'USD',
    }


def _records(payload):
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ('result_list', 'output', 'output1', 'data', 'items', 'rows', 'result'):
        rows = _records(payload.get(key))
        if rows:
            return rows
    return []


def _fetch_us_trade_amount_rank(token, limit):
    """키움 미국주식 전체 거래대금 순위(주식만)를 조회한다."""
    response = kiwoom_client.call_tr(token, 'usa20540', '/api/us/rkinfo', {
        'stex_tp': '0',
        'inds_cd': '000',
        'stk_tp': '1',
        'trde_qty_tp': '0',
        'stk_cnd': '0',
        'pric_cnd': '0',
        'trde_prica_cnd': '0',
    })
    rows = _records(response)
    if not rows:
        raise RuntimeError('usa20540 미국주식 거래대금 순위 응답이 비어 있습니다.')
    return rows[:max(1, min(int(limit), 20))]


def _us_rank_row(rank_row, finnhub_api_key):
    symbol = str(_first(rank_row, 'stk_cd', 'symbol', 'code') or '').upper()
    if not symbol:
        raise ValueError('미국주식 순위 응답에 종목코드가 없습니다.')
    profile = us_analysis.get_profile(symbol, finnhub_api_key) if finnhub_api_key else {}
    price = abs(_number(_first(rank_row, 'cur_prc', 'price')) or 0)
    volume = _number(_first(rank_row, 'acc_trde_qty', 'volume')) or 0
    trade_amount_thousand_usd = _number(_first(rank_row, 'trde_prica', 'trade_amount')) or 0
    return {
        'market': 'us',
        'code': 'US:' + symbol,
        'symbol': symbol,
        'name': profile.get('name') or _first(rank_row, 'stk_enm', 'stk_nm', 'name') or symbol,
        'price': price,
        'change': _number(_first(rank_row, 'pred_pre', 'change')),
        'change_rate': _number(_first(rank_row, 'flu_rt', 'change_rate')) or 0,
        'trade_volume': volume,
        'trade_amount': trade_amount_thousand_usd * 1000,
        'market_cap': _profile_market_cap(profile),
        'industry': profile.get('finnhubIndustry') or profile.get('gsector') or '미분류',
        'currency': 'USD',
        'exchange': _first(rank_row, 'stex_tp', 'exchange') or '',
    }


def fetch_us(token, limit=12, finnhub_api_key=''):
    rows = []
    rank_rows = _fetch_us_trade_amount_rank(token, limit)
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(_us_rank_row, rank_row, finnhub_api_key) for rank_row in rank_rows]
        for future in as_completed(futures):
            try:
                rows.append(future.result())
            except Exception as exc:
                logger.info('US board quote failed: %s', exc)
    sections = _sections(rows)
    return {
        'market': 'us',
        'session': '미국 · 오후 08:00~오전 08:00',
        'rows': sections['tradeAmount'][:limit],
        'sections': {key: value[:limit] for key, value in sections.items()},
        'updated_at': int(time.time()),
        'source': 'Kiwoom usa20540 미국주식 거래대금 순위 + Finnhub profile2',
    }
