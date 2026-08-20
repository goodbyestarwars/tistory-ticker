# -*- coding: utf-8 -*-
"""홈 실시간 종목판용 국내·미국 공통 데이터 모델."""

import logging
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - supported Python versions include zoneinfo
    ZoneInfo = None

import kiwoom_client
import kis_client
import market_rank
import us_analysis
import us_stocks

logger = logging.getLogger('market_board')

_BASIC_TTL_SEC = 15 * 60
_basic_cache = {}
_KIS_QUOTE_TTL_SEC = 15 * 60
_kis_quote_cache = {}
_FX_TTL_SEC = 15 * 60
_fx_cache = {}
_WICS_MAP_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/wics-map.js'
_WICS_MAP_TTL_SEC = 6 * 60 * 60
_wics_map_cache = {'t': 0, 'data': {}}

# 순위 TR이 일시적으로 비어도 홈 보드를 비우지 않기 위한 유동성 높은 대표 종목 목록.
DOMESTIC_FALLBACK_CODES = (
    '005930', '000660', '373220', '207940', '005380', '000270', '035420',
    '035720', '068270', '105560', '005490', '012330', '051910', '006400',
    '055550', '086790', '003670', '009150', '034730', '028260',
)
US_FALLBACK_SYMBOLS = (
    'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA',
    'AMD', 'NFLX', 'MU', 'PLTR', 'TSM', 'SMCI', 'MSTR', 'COIN',
    'QCOM', 'INTC', 'CSCO', 'ORCL',
)

DOMESTIC_SESSION_LABEL = '국내시장 · 오전 08:00~오후 08:00'


def us_session_label(now=None):
    """Return the KST US regular-session label for the current US DST date."""
    if now is None:
        if ZoneInfo is not None:
            now = datetime.now(ZoneInfo('America/New_York'))
        else:  # pragma: no cover - only for Python versions without zoneinfo
            now = datetime.utcnow()
    daylight = bool(now.dst()) if getattr(now, 'dst', None) else False
    hours = '22:30~05:00' if daylight else '23:30~06:00'
    return '미국시장 · 정규장 ' + hours


def _number(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').replace('+', '').strip())
    except (TypeError, ValueError):
        return None


def _positive_number(value):
    parsed = _number(value)
    return abs(parsed) if parsed is not None else None


def _first(row, *names):
    if not isinstance(row, dict):
        return None
    for name in names:
        value = row.get(name)
        if value not in (None, ''):
            return value
    return None


def load_wics_map():
    """Load the shared WICS industry map used by the browser and strategy scan.

    This is a static GitHub Pages asset, not a per-stock quote request.  A
    failed refresh returns the last good map so the market board can still
    show price rankings without making up an industry label.
    """
    now = time.time()
    if _wics_map_cache['data'] and now - _wics_map_cache['t'] < _WICS_MAP_TTL_SEC:
        return _wics_map_cache['data']
    try:
        request = urllib.request.Request(_WICS_MAP_URL, headers={'User-Agent': 'tistory-ticker/1.0'})
        with urllib.request.urlopen(request, timeout=10) as response:
            text = response.read().decode('utf-8')
        import re
        result = {}
        for match in re.finditer(
                r'"([0-9A-Za-z]{6})":\{"name":"([^"]*)","sector":"([^"]*)","industry":"([^"]*)"\}',
                text):
            result[match.group(1)] = {
                'name': match.group(2),
                'sector': match.group(3),
                'industry': match.group(4),
            }
        if result:
            _wics_map_cache.update({'t': now, 'data': result})
    except Exception as exc:
        logger.info('WICS map lookup failed: %s', exc)
    return _wics_map_cache['data']


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
            # 250 거래일을 국내 화면의 52주 범위로 사용한다. 키움 응답은
            # 연중 고저(oyr_*)도 함께 주므로 구형 응답에는 이를 보조 사용한다.
            'week52_high': _positive_number(_first(raw, '250hgst', 'd250_hgpr', 'oyr_hgst')),
            'week52_low': _positive_number(_first(raw, '250lwst', 'd250_lwpr', 'oyr_lwst')),
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
        if info.get('week52_high') is not None:
            item['week52_high'] = info['week52_high']
        if info.get('week52_low') is not None:
            item['week52_low'] = info['week52_low']
        item['name_ko'] = item.get('name_ko') or item.get('name') or item.get('code')
        item['name_en'] = item.get('name_en') or ''
        item['display_name'] = item.get('display_name') or item['name_ko']
        item['volume'] = item.get('trade_volume')
        item['trading_value'] = item.get('trade_amount')
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


def _domestic_fallback_row(token, code):
    raw = kiwoom_client.call_tr(token, 'ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
    price = abs(_number(_first(raw, 'cur_prc', 'price')) or 0)
    volume = _number(_first(raw, 'trde_qty', 'trade_volume', 'acc_trde_qty')) or 0
    amount = _number(_first(raw, 'trde_prica', 'trade_amount'))
    return {
        'market': 'domestic',
        'code': code,
        'name': _first(raw, 'stk_nm', 'name') or code,
        'name_ko': _first(raw, 'stk_nm', 'name') or code,
        'name_en': '',
        'display_name': _first(raw, 'stk_nm', 'name') or code,
        'price': price,
        'change': _number(_first(raw, 'pred_pre', 'change', 'prdy_vrss')),
        'change_rate': _number(_first(raw, 'flu_rt', 'change_rate', 'prdy_ctrt')) or 0,
        'trade_volume': volume,
        'trade_amount': amount if amount is not None else price * volume,
        'market_cap': _number(_first(raw, 'mac', 'market_cap')),
        'week52_high': _positive_number(_first(raw, '250hgst', 'd250_hgpr', 'oyr_hgst')),
        'week52_low': _positive_number(_first(raw, '250lwst', 'd250_lwpr', 'oyr_lwst')),
        'industry': '기타',
        'currency': 'KRW',
        'volume': volume,
        'trading_value': amount if amount is not None else price * volume,
    }


def _fallback_domestic(token, limit):
    codes = DOMESTIC_FALLBACK_CODES[:max(12, min(int(limit), 20))]
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_domestic_fallback_row, token, code) for code in codes]
        for future in as_completed(futures):
            try:
                rows.append(future.result())
            except Exception as exc:
                logger.info('domestic fallback quote failed: %s', exc)
    return rows


def _kis_week52_quote(token, appkey, appsecret, code):
    """KIS 기본시세에서 국내 종목의 250거래일 고가·저가를 읽는다."""
    cached = _kis_quote_cache.get(code)
    if cached and time.time() - cached[0] < _KIS_QUOTE_TTL_SEC:
        return cached[1]
    try:
        raw = kis_client.fetch_domestic_quote(token, appkey, appsecret, code, market='J')
        data = {
            'week52_high': _positive_number(_kis_value(
                raw, 'd250_hgpr', 'w52_hgpr', 'week52_high')),
            'week52_low': _positive_number(_kis_value(
                raw, 'd250_lwpr', 'w52_lwpr', 'week52_low')),
        }
    except Exception as exc:
        logger.info('KIS 52주 기본시세 failed for %s: %s', code, exc)
        data = {}
    _kis_quote_cache[code] = (time.time(), data)
    return data


def _enrich_domestic_kis_week52(token, appkey, appsecret, rows, codes):
    selected = set(codes)
    targets = [row for row in rows if row.get('code') in selected
               and (row.get('week52_high') is None or row.get('week52_low') is None)]

    def enrich(row):
        item = dict(row)
        item.update({key: value for key, value in _kis_week52_quote(
            token, appkey, appsecret, item.get('code')).items() if value is not None})
        return item

    if not targets:
        return rows
    enriched = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(enrich, row) for row in targets]
        for future in as_completed(futures):
            try:
                item = future.result()
                enriched[item.get('code')] = item
            except Exception as exc:
                logger.info('KIS 52주 보강 failed: %s', exc)
    return [enriched.get(row.get('code'), row) for row in rows]


def _industry_top(rows):
    """Aggregate the collected stock candidates into industry TOP rows.

    The ranking is intentionally sector-level rather than a disguised stock
    ranking: average change rate first, then rising-stock ratio, then total
    traded value.  It is based on the same candidate universe already fetched
    for the board and does not make another quote request.
    """
    groups = {}
    for row in rows:
        industry = str(row.get('industry') or '').strip()
        if not industry or industry in ('미분류', '기타'):
            continue
        group = groups.setdefault(industry, {
            'rows': [], 'change_sum': 0.0, 'rising': 0, 'falling': 0,
            'trade_amount': 0.0, 'trade_volume': 0.0,
        })
        change_rate = row.get('change_rate') or 0
        group['rows'].append(row)
        group['change_sum'] += change_rate
        group['rising'] += 1 if change_rate > 0 else 0
        group['falling'] += 1 if change_rate < 0 else 0
        group['trade_amount'] += row.get('trade_amount') or 0
        group['trade_volume'] += row.get('trade_volume') or 0

    result = []
    for industry, group in groups.items():
        rows_in_group = group['rows']
        count = len(rows_in_group)
        leader = max(rows_in_group, key=lambda item: item.get('trade_amount') or 0)
        average_change = group['change_sum'] / count if count else 0
        result.append({
            'industry': industry,
            'stock_count': count,
            'rising_count': group['rising'],
            'falling_count': group['falling'],
            'avg_change_rate': average_change,
            'rise_ratio': group['rising'] / count if count else 0,
            'trade_amount': group['trade_amount'],
            'trade_volume': group['trade_volume'],
            'leader_name': leader.get('name') or leader.get('code') or '-',
            'leader_code': leader.get('code') or '',
            'leader_change_rate': leader.get('change_rate') or 0,
            'currency': 'KRW',
        })
    return sorted(
        result,
        key=lambda item: (
            item['avg_change_rate'], item['rise_ratio'], item['trade_amount'],
        ),
        reverse=True,
    )


def _sections(rows):
    by_amount = lambda row: row.get('trade_amount') or 0
    by_volume = lambda row: row.get('trade_volume') or 0
    by_rate = lambda row: row.get('change_rate') or 0
    by_cap = lambda row: row.get('market_cap') or 0

    def descending_metric(key):
        return sorted(
            [row for row in rows if row.get(key) is not None],
            key=lambda row: row.get(key) or 0,
            reverse=True,
        )

    return {
        'tradeAmount': sorted(rows, key=by_amount, reverse=True),
        'tradeVolume': sorted(rows, key=by_volume, reverse=True),
        'volumeGrowth': descending_metric('volume_growth_rate'),
        'turnover': descending_metric('turnover_rate'),
        'amountTurnover': descending_metric('amount_turnover_rate'),
        'rising': sorted([row for row in rows if by_rate(row) > 0], key=by_rate, reverse=True),
        'falling': sorted([row for row in rows if by_rate(row) < 0], key=by_rate),
        'marketCap': sorted(rows, key=by_cap, reverse=True),
        'industry': _industry_top(rows),
    }


def fetch_domestic(token, limit=20, wics_map=None):
    try:
        rank = market_rank.fetch_sidebar_rank(token, limit=max(12, min(int(limit), 20)))
    except Exception as exc:
        logger.warning('domestic ranking unavailable; using fallback quotes: %s', exc)
        rank = {}
    merged = {}
    for section in ('tradeVolume', 'upperLimit', 'lowerLimit'):
        for row in rank.get(section) or []:
            if row.get('code'):
                merged.setdefault(row['code'], dict(row)).update(row)
    # 세 개의 랭킹 목록을 모두 보여주되, 기본정보 API는 거래량 상위 limit개에만
    # 호출한다. 그래야 홈 한 번의 갱신이 종목 기본정보 수십 건을 만들지 않는다.
    volume_codes = {row.get('code') for row in (rank.get('tradeVolume') or [])[:limit]}
    rows = []
    if not merged:
        rows = _fallback_domestic(token, limit)
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
        'session': DOMESTIC_SESSION_LABEL,
        'rows': sections['tradeAmount'][:limit],
        'sections': {key: value[:limit] for key, value in sections.items()},
        'updated_at': int(time.time()),
        'source': 'Kiwoom ka10030/ka10017/ka10001',
    }


def _kis_value(row, *names):
    """KIS 응답의 소문자/대문자 필드명을 안전하게 읽는다."""
    if not isinstance(row, dict):
        return None
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(str(name).lower())
        if value not in (None, ''):
            return value
    return None


def _kis_domestic_row(row):
    code = str(_kis_value(row, 'mksc_shrn_iscd', 'stck_shrn_iscd', 'sht_cd', 'code') or '').strip()
    if not code:
        return None
    price = abs(_number(_kis_value(row, 'stck_prpr', 'cur_prc', 'price')) or 0)
    volume = _number(_kis_value(row, 'acml_vol', 'cntg_vol', 'trde_qty', 'trade_volume')) or 0
    amount = _number(_kis_value(row, 'acml_tr_pbmn', 'trde_prica', 'trade_amount'))
    return {
        'market': 'domestic',
        'code': code,
        'name': _kis_value(row, 'hts_kor_isnm', 'stck_kor_isnm', 'stck_nm', 'name') or code,
        'price': price,
        'change': _number(_kis_value(row, 'prdy_vrss', 'pred_pre', 'change')),
        'change_rate': _number(_kis_value(row, 'prdy_ctrt', 'flu_rt', 'change_rate')) or 0,
        'trade_volume': volume,
        'trade_amount': amount if amount is not None else price * volume,
        'market_cap': _number(_kis_value(row, 'stck_avls', 'market_cap', 'mktcap')) or 0,
        # 거래량순위 응답 하나에 세 지표가 함께 포함된다. 전용 정렬 호출이
        # 휴장·장마감 직후 빈 배열이어도 이 값을 사용해 화면을 채운다.
        'volume_growth_rate': _number(_kis_value(row, 'vol_inrt', 'volume_growth_rate', 'volumeGrowth')),
        'turnover_rate': _number(_kis_value(row, 'vol_tnrt', 'nday_vol_tnrt', 'turnover_rate', 'turnover')),
        'amount_turnover_rate': _number(_kis_value(row, 'tr_pbmn_tnrt', 'nday_tr_pbmn_tnrt', 'amount_turnover_rate', 'amountTurnover')),
        'week52_high': _positive_number(_kis_value(row, 'w52_hgpr', 'd250_hgpr', '250hgst', 'week52_high')),
        'week52_low': _positive_number(_kis_value(row, 'w52_lwpr', 'd250_lwpr', '250lwst', 'week52_low')),
        'industry': '미분류',
        'currency': 'KRW',
    }


def fetch_domestic_kis(appkey, appsecret, limit=20, wics_map=None):
    """KIS 기반 국내 실시간 종목판.

    거래금액·거래량·거래증가율·거래회전율·거래대금회전율·등락률·시가총액
    순위를 각각 KIS REST로 조회하고,
    동일한 공통 행 모델로 합친다. 기존 fetch_domestic()는 키움 롤백 경로로
    유지한다.
    """
    if not appkey or not appsecret:
        raise RuntimeError('KIS_APPKEY/KIS_APPSECRET가 없습니다.')
    kis_token = kis_client.get_token(appkey, appsecret)
    query_limit = max(12, min(int(limit), 20))
    tasks = {
        'amount': lambda: kis_client.fetch_domestic_volume_rank(
            kis_token, appkey, appsecret, sort_code='3', limit=query_limit),
        'volume': lambda: kis_client.fetch_domestic_volume_rank(
            kis_token, appkey, appsecret, sort_code='0', limit=query_limit),
        'volumeGrowth': lambda: kis_client.fetch_domestic_volume_rank(
            kis_token, appkey, appsecret, sort_code='1', limit=query_limit),
        'turnover': lambda: kis_client.fetch_domestic_volume_rank(
            kis_token, appkey, appsecret, sort_code='2', limit=query_limit),
        'amountTurnover': lambda: kis_client.fetch_domestic_volume_rank(
            kis_token, appkey, appsecret, sort_code='4', limit=query_limit),
        'rate': lambda: kis_client.fetch_domestic_fluctuation_rank(
            kis_token, appkey, appsecret, limit=query_limit),
        'cap': lambda: kis_client.fetch_domestic_market_cap_rank(
            kis_token, appkey, appsecret, limit=query_limit),
    }
    rank_rows = {}
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {name: pool.submit(fn) for name, fn in tasks.items()}
        for name, future in futures.items():
            try:
                rank_rows[name] = future.result()
            except Exception as exc:
                errors.append('%s: %s' % (name, exc))
                rank_rows[name] = []
    if not any(rank_rows.values()):
        raise RuntimeError('KIS 국내 순위 응답이 모두 비어 있습니다: ' + '; '.join(errors))

    merged = {}
    for rows in rank_rows.values():
        for raw in rows:
            item = _kis_domestic_row(raw)
            if item:
                current = merged.setdefault(item['code'], {})
                for key, value in item.items():
                    # 시가총액·등락률 순위 응답에는 거래량/가격 필드가 없을 수
                    # 있어, 기본값 0이 먼저 수집한 실데이터를 덮지 않게 한다.
                    if value is None:
                        continue
                    if key in ('price', 'trade_volume', 'trade_amount', 'market_cap',
                               'change_rate', 'volume_growth_rate', 'turnover_rate',
                               'amount_turnover_rate', 'week52_high', 'week52_low') \
                            and value == 0 and current.get(key) not in (None, 0):
                        continue
                    current[key] = value
    wics_map = wics_map or {}
    for row in merged.values():
        info = wics_map.get(row['code']) or {}
        row['industry'] = info.get('industry') or info.get('sector') or '미분류'
    # 기본 화면(거래대금 상위)에서 바로 사용할 20개를 우선 보강한다.
    # 순위 API가 52주 필드를 함께 주는 경우에는 추가 호출하지 않는다.
    quote_codes = []
    seen_quote_codes = set()
    for rank_name in ('amount', 'volume', 'volumeGrowth', 'turnover', 'amountTurnover', 'rate', 'cap'):
        for raw in rank_rows.get(rank_name) or []:
            item = _kis_domestic_row(raw)
            code = item.get('code') if item else None
            if code and code not in seen_quote_codes:
                quote_codes.append(code)
                seen_quote_codes.add(code)
    quote_codes = quote_codes[:query_limit]
    rows_with_week52 = _enrich_domestic_kis_week52(
        kis_token, appkey, appsecret, list(merged.values()), quote_codes,
    )
    merged = {row['code']: row for row in rows_with_week52 if row.get('code')}
    sections = _sections(list(merged.values()))

    # KIS 순위 API는 응답 자체가 해당 정렬 순서이므로, 거래증가율·회전율은
    # 공통 행 모델로 합친 뒤 API가 반환한 순서를 유지한다.
    def ordered_section(rank_name):
        result = []
        seen = set()
        for raw in rank_rows.get(rank_name) or []:
            item = _kis_domestic_row(raw)
            code = item.get('code') if item else None
            if code and code in merged and code not in seen:
                result.append(merged[code])
                seen.add(code)
        return result

    metric_keys = {
        'volumeGrowth': 'volume_growth_rate',
        'turnover': 'turnover_rate',
        'amountTurnover': 'amount_turnover_rate',
    }
    for section_name, rank_name in (
        ('tradeAmount', 'amount'),
        ('tradeVolume', 'volume'),
        ('volumeGrowth', 'volumeGrowth'),
        ('turnover', 'turnover'),
        ('amountTurnover', 'amountTurnover'),
        ('marketCap', 'cap'),
    ):
        ordered = ordered_section(rank_name)
        if section_name in metric_keys:
            ordered = [row for row in ordered if row.get(metric_keys[section_name]) is not None]
        if ordered:
            sections[section_name] = ordered

    # 전용 순위 TR이 빈 경우에도 거래량순위(0)가 제공한 지표 필드로
    # 정렬한다. 값이 있는 행만 반환해 빈 화면 대신 실제 순위를 보여준다.
    for section_name, metric_key in (
        ('volumeGrowth', 'volume_growth_rate'),
        ('turnover', 'turnover_rate'),
        ('amountTurnover', 'amount_turnover_rate'),
    ):
        if not sections.get(section_name):
            sections[section_name] = sorted(
                [row for row in merged.values() if row.get(metric_key) is not None],
                key=lambda row: row.get(metric_key) or 0,
                reverse=True,
            )
    return {
        'market': 'domestic',
        'session': DOMESTIC_SESSION_LABEL,
        'rows': sections['tradeAmount'][:limit],
        'sections': {key: value[:limit] for key, value in sections.items()},
        'updated_at': int(time.time()),
        'source': 'KIS 국내 순위(거래금액·거래량·거래증가율·거래회전율·거래대금회전율·등락률·시가총액)',
    }


def fetch_sidebar_rank_kis(appkey, appsecret, limit=5):
    """KIS 기반 사이드바 거래량·상승·하락 순위.

    홈 종목판과 동일한 KIS 병합 결과를 사용해 사이드바만 키움 데이터로
    바뀌는 것을 막는다. 특히 KIS 거래량 순위 API는 시장/장 상태에 따라
    정렬 코드별 응답이 비어 있을 수 있으므로, 개별 호출을 별도로 처리하지
    않고 이미 검증된 공통 종목판 경로를 재사용한다.
    """
    board = fetch_domestic_kis(appkey, appsecret, limit=max(12, min(int(limit), 20)))
    sections = board.get('sections') or {}
    return {
        'tradeVolume': (sections.get('tradeVolume') or [])[:limit],
        'upperLimit': (sections.get('rising') or [])[:limit],
        'lowerLimit': (sections.get('falling') or [])[:limit],
        'source': 'KIS 국내 순위(거래량·등락률)',
    }


def _us_row(symbol, finnhub_api_key):
    try:
        quote = us_stocks.quote(symbol)
    except Exception as exc:
        logger.info('US broker quote failed for %s; using Yahoo daily fallback: %s', symbol, exc)
        quote = _yahoo_quote(symbol)
    profile = us_analysis.get_profile(symbol, finnhub_api_key) if finnhub_api_key else {}
    price = quote.get('price') or 0
    volume = quote.get('volume') or 0
    name_en = profile.get('name') or quote.get('name') or symbol
    return {
        'market': 'us',
        'code': 'US:' + symbol,
        'symbol': symbol,
        'name': name_en,
        'name_ko': '',
        'name_en': name_en,
        'display_name': name_en,
        'price': price,
        'change': quote.get('change'),
        'change_rate': quote.get('change_rate') or 0,
        'trade_volume': volume,
        'trade_amount': price * volume,
        # Finnhub profile2 may report a foreign primary-listing currency.
        'market_cap': _profile_market_cap(profile),
        'industry': profile.get('finnhubIndustry') or profile.get('gsector') or '미분류',
        'currency': 'USD',
        'volume': volume,
        'trading_value': price * volume,
    }


def _yahoo_quote(symbol):
    chart = us_stocks._yahoo_chart(symbol, 'daily')
    points = chart.get('points') or []
    if not points:
        raise RuntimeError('Yahoo quote points are empty')
    latest = points[-1]
    previous = points[-2] if len(points) > 1 else None
    price = latest.get('price') or latest.get('close') or 0
    change = price - previous.get('close') if previous and previous.get('close') else None
    change_rate = change / previous['close'] * 100 if change is not None and previous.get('close') else None
    return {
        'market': 'us',
        'symbol': symbol,
        'code': 'US:' + symbol,
        'name': symbol,
        'price': price,
        'change': change,
        'change_rate': change_rate,
        'volume': latest.get('volume') or 0,
        'source': 'Yahoo Finance chart fallback',
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
    name_en = profile.get('name') or _first(rank_row, 'stk_enm', 'en_name', 'name') or symbol
    name_ko = _first(rank_row, 'stk_nm', 'hts_kor_isnm', 'knam') or ''
    return {
        'market': 'us',
        'code': 'US:' + symbol,
        'symbol': symbol,
        'name': name_en,
        'name_ko': name_ko,
        'name_en': name_en,
        'display_name': name_en,
        'price': price,
        'change': _number(_first(rank_row, 'pred_pre', 'change')),
        'change_rate': _number(_first(rank_row, 'flu_rt', 'change_rate')) or 0,
        'trade_volume': volume,
        'trade_amount': trade_amount_thousand_usd * 1000,
        'market_cap': _profile_market_cap(profile),
        'industry': profile.get('finnhubIndustry') or profile.get('gsector') or '미분류',
        'currency': 'USD',
        'exchange': _first(rank_row, 'stex_tp', 'exchange') or '',
        'volume': volume,
        'trading_value': trade_amount_thousand_usd * 1000,
    }


def fetch_us(token, limit=20, finnhub_api_key=''):
    rows = []
    source = 'Kiwoom usa20540 미국주식 거래대금 순위 + Finnhub profile2'
    try:
        rank_rows = _fetch_us_trade_amount_rank(token, limit)
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(_us_rank_row, rank_row, finnhub_api_key) for rank_row in rank_rows]
            for future in as_completed(futures):
                try:
                    rows.append(future.result())
                except Exception as exc:
                    logger.info('US board quote failed: %s', exc)
        if not rows:
            raise RuntimeError('US ranking rows could not be enriched')
    except Exception as exc:
        logger.warning('US ranking unavailable; using fallback quotes: %s', exc)
        source = 'Kiwoom/KIS 개별 시세 + Yahoo Finance fallback'
        symbols = US_FALLBACK_SYMBOLS[:max(12, min(int(limit), 20))]
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(_us_row, symbol, finnhub_api_key) for symbol in symbols]
            for future in as_completed(futures):
                try:
                    rows.append(future.result())
                except Exception as quote_error:
                    logger.info('US fallback quote failed: %s', quote_error)
    sections = _sections(rows)
    return {
        'market': 'us',
        'session': us_session_label(),
        'rows': sections['tradeAmount'][:limit],
        'sections': {key: value[:limit] for key, value in sections.items()},
        'updated_at': int(time.time()),
        'source': source,
    }


def _kis_us_row(row):
    symbol = str(_kis_value(row, 'symb', 'symbol', 'rsym', 'code') or '').strip().upper()
    if symbol.startswith('D') and len(symbol) > 1 and symbol[1:].isalpha():
        symbol = symbol[1:]
    if not symbol:
        return None
    price = abs(_number(_kis_value(row, 'last', 'cur_prc', 'price')) or 0)
    volume = _number(_kis_value(row, 'tvol', 'acml_vol', 'volume')) or 0
    amount = _number(_kis_value(row, 'tamt', 'trde_prica', 'trade_amount'))
    name_en = _kis_value(row, 'en_name', 'enam', 'natn_name', 'eng_name', 'english_name') or symbol
    name_ko = _kis_value(row, 'hts_kor_isnm', 'knam', 'name', 'korean_name') or ''
    return {
        'market': 'us',
        'code': 'US:' + symbol,
        'symbol': symbol,
        'name': name_en,
        'name_ko': name_ko,
        'name_en': name_en,
        'display_name': name_en,
        'price': price,
        'change': _number(_kis_value(row, 'diff', 'pred_pre', 'change')),
        'change_rate': _number(_kis_value(row, 'rate', 'flu_rt', 'change_rate')) or 0,
        'trade_volume': volume,
        'trade_amount': amount if amount is not None else price * volume,
        # HHDFS76350100의 tomv는 백만 USD 단위 시가총액이다.
        'market_cap': _number(_kis_value(row, 'tomv', 'mktcap', 'market_cap', 'stck_avls')),
        # KIS 해외 순위 응답에는 업종 필드가 없는 경우가 많다. 호출부에서
        # Finnhub profile2 업종으로 보강하며, 원본에 값이 있으면 우선 보존한다.
        'industry': _first(
            row,
            'finnhubIndustry', 'gsector', 'industry', 'sector',
            'bstp_kor_isnm', 'industry_name',
        ) or '미분류',
        'currency': 'USD',
        'exchange': _kis_value(row, 'excd', 'exchange') or '',
        'volume': volume,
        'trading_value': amount if amount is not None else price * volume,
    }


def _fetch_us_kis_metric(token, appkey, appsecret, fetcher, limit, **kwargs):
    """KIS 미국 순위 API를 거래소별로 병렬 조회하고 원본 순서를 보존한다."""
    rows = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            exchange: pool.submit(
                fetcher, token, appkey, appsecret, exchange, limit=limit, **kwargs,
            )
            for exchange in ('NYS', 'NAS', 'AMS')
        }
        for exchange, future in futures.items():
            try:
                rows.extend(future.result())
            except Exception as exc:
                logger.info('KIS 미국 순위 %s 조회 실패: %s', exchange, exc)
    return rows


def _normalize_kis_us_rows(rows):
    normalized = {}
    for raw in rows:
        item = _kis_us_row(raw)
        if item:
            normalized.setdefault(item['symbol'], item)
    return list(normalized.values())


def _sort_kis_us_rows(rows, metric):
    """KIS 순위 응답의 지표별 정렬. 신고/신저는 API 순위를 유지한다."""
    if metric in ('newHigh', 'newLow'):
        return rows
    keys = {
        'tradeAmount': lambda row: row.get('trade_amount') or 0,
        'tradeVolume': lambda row: row.get('trade_volume') or 0,
        'marketCap': lambda row: row.get('market_cap') or 0,
        'rising': lambda row: row.get('change_rate') or 0,
        'falling': lambda row: row.get('change_rate') or 0,
        'volumeSurge': lambda row: row.get('_rank_value') or 0,
        'volumePower': lambda row: row.get('_rank_value') or 0,
    }
    key = keys.get(metric, keys['tradeAmount'])
    return sorted(rows, key=key, reverse=metric != 'falling')


def _normalize_kis_us_metric(raw_rows, metric):
    rows = []
    for raw in raw_rows:
        item = _kis_us_row(raw)
        if not item:
            continue
        if metric == 'volumeSurge':
            item['_rank_value'] = _number(_kis_value(raw, 'n_rate', 'n_diff')) or 0
        elif metric == 'volumePower':
            item['_rank_value'] = _number(_kis_value(raw, 'powx', 'tpow')) or 0
        rows.append(item)
    normalized = {}
    for item in rows:
        normalized.setdefault(item['symbol'], item)
    ordered = _sort_kis_us_rows(list(normalized.values()), metric)
    for item in ordered:
        item.pop('_rank_value', None)
    return ordered


def _enrich_us_kis_industries(rows, finnhub_api_key=''):
    """Fill missing KIS US industries from the existing cached profile source.

    KIS rank TRs provide prices and ranking values but commonly omit sector data.
    Use Finnhub only for the final trade-amount universe so the home summary can
    calculate leaders/cautions without multiplying quote requests for every tab.
    """
    if not finnhub_api_key or not rows:
        return
    targets = [row for row in rows if row.get('industry') in (None, '', '미분류') and row.get('symbol')]
    if not targets:
        return
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {
            pool.submit(us_analysis.get_profile, row['symbol'], finnhub_api_key): row
            for row in targets
        }
        for future in as_completed(futures):
            row = futures[future]
            try:
                profile = future.result() or {}
            except Exception as exc:
                logger.info('US industry profile failed for %s: %s', row.get('symbol'), exc)
                continue
            industry = _first(profile, 'finnhubIndustry', 'gsector', 'industry', 'sector')
            if industry:
                row['industry'] = industry


def merge_us_kis_metadata(metric_rows):
    """Share stable metadata from the market-cap ranking with every tab.

    KIS's US ranking TRs are metric-specific.  The trade-value and volume
    responses commonly contain a ticker and quote fields, but omit both the
    English company name and ``tomv`` (market capitalization).  The market-cap
    response does contain those fields, so leaving each normalized section
    independent makes the same stock display as ``MRNA`` with a ``-`` cap on
    one tab and ``Moderna Inc`` with a cap on another.  Join by ticker, never
    by the localized/company name, because the latter varies by TR and vendor.

    Public (no leading underscore) because main.py's /market-board endpoint
    calls this a second time after backfilling a metric from Kiwoom when KIS's
    own marketCap section came back empty - the first call inside fetch_us_kis()
    has nothing to merge from in that case (2026-08-20: found via a user report
    that tradeAmount kept showing tickers-only names and a dash market cap even
    though a different tab on the same page showed full names/caps - the
    Kiwoom-sourced backfill has real metadata but arrived too late for the
    first merge pass to use it).
    """
    cap_rows = metric_rows.get('marketCap') or []
    by_symbol = {
        str(row.get('symbol') or '').strip().upper(): row
        for row in cap_rows
        if row.get('symbol')
    }
    if not by_symbol:
        return
    for metric, rows in metric_rows.items():
        if metric == 'marketCap':
            continue
        for row in rows:
            metadata = by_symbol.get(str(row.get('symbol') or '').strip().upper())
            if not metadata:
                continue
            for key in ('market_cap', 'name', 'name_en', 'display_name', 'industry'):
                current = row.get(key)
                symbol = str(row.get('symbol') or '').strip().upper()
                missing_name = key in ('name', 'name_en', 'display_name') and str(current or '').strip().upper() in (symbol, 'US:' + symbol)
                if (current in (None, '', '미분류') or missing_name) and metadata.get(key) not in (None, '', '미분류'):
                    row[key] = metadata[key]


def fetch_us_kis(appkey, appsecret, limit=20, finnhub_api_key=''):
    """KIS 기반 미국 실시간 종목판.

    KIS 해외 순위 API는 거래소별 조회이므로 NYSE/NASDAQ/AMEX를 병렬 조회한 뒤
    거래대금·거래량·시가총액·등락률·거래량급증·체결강도·신고/신저가 순위를 합친다.
    기존 fetch_us()는 키움/Finnhub 롤백 경로로 유지한다.
    """
    if not appkey or not appsecret:
        raise RuntimeError('KIS_APPKEY/KIS_APPSECRET가 없습니다.')
    kis_token = kis_client.get_token(appkey, appsecret)
    query_limit = max(12, min(int(limit), 20))
    metric_fetchers = {
        'tradeAmount': (kis_client.fetch_us_trade_amount_rank, {}),
        'tradeVolume': (kis_client.fetch_us_trade_volume_rank, {}),
        'marketCap': (kis_client.fetch_us_market_cap_rank, {}),
        'rising': (kis_client.fetch_us_updown_rank, {'gubn': '1'}),
        'falling': (kis_client.fetch_us_updown_rank, {'gubn': '0'}),
        'volumeSurge': (kis_client.fetch_us_volume_surge_rank, {}),
        'volumePower': (kis_client.fetch_us_volume_power_rank, {}),
        'newHigh': (kis_client.fetch_us_new_highlow_rank, {'gubn': '1'}),
        'newLow': (kis_client.fetch_us_new_highlow_rank, {'gubn': '0'}),
    }
    metric_rows = {}
    # 지표별 3개 거래소 조회를 동시에 하되, KIS 호출 폭주를 피하기 위해
    # 바깥 지표 작업은 3개씩만 실행한다(총 9개 HTTP 요청 동시 실행).
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            metric: pool.submit(
                _fetch_us_kis_metric, kis_token, appkey, appsecret, fetcher,
                query_limit, **kwargs,
            )
            for metric, (fetcher, kwargs) in metric_fetchers.items()
        }
        for metric, future in futures.items():
            try:
                raw_rows = future.result()
                metric_rows[metric] = _normalize_kis_us_metric(raw_rows, metric)
            except Exception as exc:
                logger.warning('KIS 미국 %s 순위 실패: %s', metric, exc)
                metric_rows[metric] = []
    if not metric_rows.get('tradeAmount'):
        raise RuntimeError('KIS 미국 거래대금 순위 응답이 비어 있습니다.')
    merge_us_kis_metadata(metric_rows)
    ordered = metric_rows['tradeAmount']
    _enrich_us_kis_industries(ordered, finnhub_api_key)
    sections = {
        metric: rows[:limit]
        for metric, rows in metric_rows.items()
    }
    return {
        'market': 'us',
        'session': us_session_label(),
        'rows': ordered[:limit],
        'sections': sections,
        'updated_at': int(time.time()),
        'source': 'KIS 미국 순위(거래대금·거래량·시가총액·등락률·급증·체결강도·신고/신저)',
    }
