# -*- coding: utf-8 -*-
"""홈 실시간 종목판용 국내·미국 공통 데이터 모델."""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import kiwoom_client
import market_rank
import us_analysis
import us_stocks

logger = logging.getLogger('market_board')

US_BOARD_SYMBOLS = (
    'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD',
    'AVGO', 'PLTR', 'ORCL', 'MU', 'INTC', 'LLY', 'NFLX', 'RKLB',
)
_BASIC_TTL_SEC = 15 * 60
_basic_cache = {}


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
        # Finnhub profile2 marketCapitalization은 USD million 단위다.
        'market_cap': profile.get('marketCapitalization'),
        'industry': profile.get('finnhubIndustry') or profile.get('gsector') or '미분류',
        'currency': 'USD',
    }


def fetch_us(limit=12, finnhub_api_key=''):
    rows = []
    symbols = US_BOARD_SYMBOLS[:max(1, min(int(limit), len(US_BOARD_SYMBOLS)))]
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(_us_row, symbol, finnhub_api_key) for symbol in symbols]
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
        'source': 'Kiwoom US quote + Finnhub profile2',
    }
