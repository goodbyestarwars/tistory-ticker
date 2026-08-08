# -*- coding: utf-8 -*-
"""data.go.kr 공공데이터 fallback 클라이언트.

주 데이터(Kiwoom/KIS)가 실패했을 때만 호출한다. 서비스키가 없거나
공공데이터 응답이 지연되어도 주 데이터 경로에는 영향을 주지 않는다.
"""

import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

logger = logging.getLogger('public_data')

KRX_LIST_URL = 'https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo'
STOCK_PRICE_URL = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo'
PRODUCT_PRICE_URL = 'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo'
NPS_HOLDING_URL = (
    'https://api.odcloud.kr/api/3070507/v1/'
    'uddi:cc757223-fdc0-45b2-a617-dcbecec3fe1f_20241231'
)

_CACHE = {}
_STOCK_CACHE_TTL = 15 * 60
_NPS_CACHE_TTL = 24 * 60 * 60


class PublicDataUnavailable(RuntimeError):
    """서비스키가 없거나 공공데이터 호출에 실패한 경우."""


def _service_key(kind):
    names = {
        'stock': ('DATA_GO_KR_STOCK_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'krx': ('DATA_GO_KR_KRX_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'product': ('DATA_GO_KR_PRODUCT_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'nps': ('DATA_GO_KR_NPS_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
    }
    for name in names[kind]:
        value = os.environ.get(name)
        if value:
            return value
    raise PublicDataUnavailable('DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.')


def _request_json(url, params, kind):
    query = dict(params)
    query['serviceKey'] = _service_key(kind)
    query.setdefault('resultType', 'json')
    request_url = url + '?' + urllib.parse.urlencode(query)
    request = urllib.request.Request(request_url, headers={'User-Agent': 'tistory-ticker/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except Exception as exc:
        raise PublicDataUnavailable('data.go.kr 호출 실패: %s' % exc)

    header = payload.get('response', {}).get('header', {})
    result_code = str(header.get('resultCode', '00'))
    if result_code not in ('00', '0'):
        message = header.get('resultMsg') or '응답 오류'
        raise PublicDataUnavailable('data.go.kr 응답 오류(%s): %s' % (result_code, message))
    return payload


def _body_items(payload):
    body = payload.get('response', {}).get('body', {})
    items = body.get('items', {})
    if isinstance(items, dict):
        rows = items.get('item') or []
    elif isinstance(items, list):
        rows = items
    else:
        rows = []
    if isinstance(rows, dict):
        rows = [rows]
    return body, rows


def _odcloud_rows(payload):
    rows = payload.get('data') or payload.get('items') or []
    if isinstance(rows, dict):
        rows = [rows]
    return rows


def _number(value):
    try:
        return float(str(value).replace(',', '').replace('+', '').strip())
    except (TypeError, ValueError):
        return 0.0


def _date_days_ago(days):
    return (datetime.now() - timedelta(days=days)).strftime('%Y%m%d')


def _latest_business_rows(url, kind, extra=None, lookback=10, rows_per_page=1000):
    extra = extra or {}
    last_error = None
    for offset in range(lookback):
        params = dict(extra)
        params.update({'basDt': _date_days_ago(offset), 'numOfRows': rows_per_page, 'pageNo': 1})
        try:
            payload = _request_json(url, params, kind)
            body, rows = _body_items(payload)
            if rows:
                return body, rows
        except PublicDataUnavailable as exc:
            last_error = exc
            break
    if last_error:
        raise last_error
    return {}, []


def fetch_krx_universe():
    """KRX 상장종목 기본정보를 [{name, code, market}] 형태로 반환."""
    body, rows = _latest_business_rows(KRX_LIST_URL, 'krx', rows_per_page=1000)
    total_count = int(body.get('totalCount') or len(rows))
    if total_count > len(rows):
        bas_dt = rows[0].get('basDt') if rows else None
        for page in range(2, (total_count + 999) // 1000 + 1):
            _, page_rows = _body_items(_request_json(KRX_LIST_URL, {
                'basDt': bas_dt,
                'numOfRows': 1000,
                'pageNo': page,
            }, 'krx'))
            rows.extend(page_rows)
    result = []
    seen = set()
    for row in rows:
        code = str(row.get('srtnCd') or '').strip()
        name = str(row.get('itmsNm') or '').strip()
        if not re.fullmatch(r'[0-9A-Za-z]{6}', code) or not name or code in seen:
            continue
        seen.add(code)
        result.append({
            'name': name,
            'code': code,
            'market': row.get('mrktCtg') or '',
            'isin': row.get('isinCd') or '',
        })
    if not result:
        raise PublicDataUnavailable('KRX 상장종목 정보가 비어 있습니다.')
    return result


def _normalize_ohlc(row):
    date_value = str(row.get('basDt') or row.get('baseDate') or '').replace('-', '')
    if len(date_value) != 8:
        return None
    close = _number(row.get('clpr') or row.get('close'))
    if close <= 0:
        return None
    return {
        'date': '%s-%s-%s' % (date_value[:4], date_value[4:6], date_value[6:8]),
        'open': _number(row.get('mkp') or row.get('open')),
        'high': _number(row.get('hipr') or row.get('high')),
        'low': _number(row.get('lopr') or row.get('low')),
        'close': close,
        'volume': _number(row.get('trqu') or row.get('volume')),
        'source': 'data.go.kr',
    }


def fetch_stock_ohlc(code, max_days=500):
    """금융위원회 주식시세정보(15094808)에서 종목별 일봉을 조회."""
    cache_key = 'stock-ohlc:%s' % code
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _STOCK_CACHE_TTL:
        return cached[1]

    begin_days = max(30, int(max_days or 500) * 2)
    payload = _request_json(STOCK_PRICE_URL, {
        'beginBasDt': _date_days_ago(begin_days),
        'endBasDt': datetime.now().strftime('%Y%m%d'),
        'likeSrtnCd': code,
        'numOfRows': min(max(int(max_days or 500) * 2, 100), 1000),
        'pageNo': 1,
    }, 'stock')
    _, rows = _body_items(payload)
    result = [item for item in (_normalize_ohlc(row) for row in rows) if item]
    result.sort(key=lambda item: item['date'])
    if max_days and len(result) > max_days:
        result = result[-max_days:]
    if not result:
        raise PublicDataUnavailable('%s 주식시세정보가 비어 있습니다.' % code)
    _CACHE[cache_key] = (time.time(), result)
    return result


def _quote_from_row(row, source):
    normalized = _normalize_ohlc(row)
    if not normalized:
        return None
    return {
        'stk_cd': row.get('srtnCd') or row.get('shortCode'),
        'stk_nm': row.get('itmsNm') or row.get('name'),
        'cur_prc': normalized['close'],
        'pred_pre': _number(row.get('vs') or row.get('diff')),
        'flu_rt': _number(row.get('fltRt') or row.get('changePct')),
        'open_pric': normalized['open'],
        'high_pric': normalized['high'],
        'low_pric': normalized['low'],
        'trde_qty': normalized['volume'],
        'trde_prica': _number(row.get('trPrc') or row.get('tradeValue')),
        'lstg_st_cnt': _number(row.get('lstgStCnt') or row.get('listedShares')),
        'mrkt_tot_amt': _number(row.get('mrktTotAmt') or row.get('marketCap')),
        'bas_dt': normalized['date'],
        'source': source,
    }


def fetch_stock_quote(code):
    """주식시세 fallback을 키움 quote 응답과 호환되는 필드로 반환."""
    daily = fetch_stock_ohlc(code, max_days=3)
    latest_date = daily[-1]['date']
    payload = _request_json(STOCK_PRICE_URL, {
        'basDt': latest_date.replace('-', ''),
        'likeSrtnCd': code,
        'numOfRows': 10,
        'pageNo': 1,
    }, 'stock')
    _, rows = _body_items(payload)
    if rows:
        result = _quote_from_row(rows[0], 'data.go.kr:stock-price')
        if result:
            return result
    row = daily[-1]
    return {
        'stk_cd': code,
        'cur_prc': row['close'],
        'open_pric': row['open'],
        'high_pric': row['high'],
        'low_pric': row['low'],
        'trde_qty': row['volume'],
        'bas_dt': row['date'],
        'source': 'data.go.kr:stock-price',
    }


def fetch_product_quote(code):
    """ETF/ETN/ELW용 증권상품시세 fallback."""
    payload = _request_json(PRODUCT_PRICE_URL, {
        'beginBasDt': _date_days_ago(30),
        'endBasDt': datetime.now().strftime('%Y%m%d'),
        'likeSrtnCd': code,
        'numOfRows': 100,
        'pageNo': 1,
    }, 'product')
    _, rows = _body_items(payload)
    rows.sort(key=lambda row: str(row.get('basDt') or ''), reverse=True)
    for row in rows:
        if str(row.get('srtnCd') or '').strip() == code:
            return _quote_from_row(row, 'data.go.kr:security-product')
    return None


def _nps_name(value):
    normalized = re.sub(r'[^0-9A-Za-z가-힣]', '', str(value or '')).lower()
    normalized = normalized.replace('주식회사', '')
    if normalized.endswith('주') and len(normalized) > 2:
        normalized = normalized[:-1]
    return normalized


def _fetch_nps_rows():
    cached = _CACHE.get('nps-holdings')
    if cached and time.time() - cached[0] < _NPS_CACHE_TTL:
        return cached[1]
    params = {'page': 1, 'perPage': 2000, 'returnType': 'JSON'}
    try:
        payload = _request_json(NPS_HOLDING_URL, params, 'nps')
    except PublicDataUnavailable:
        # odcloud 자동변환 API는 response envelope가 없을 수 있어 한 번 더 직접 호출한다.
        query = dict(params)
        query['serviceKey'] = _service_key('nps')
        request = urllib.request.Request(
            NPS_HOLDING_URL + '?' + urllib.parse.urlencode(query),
            headers={'User-Agent': 'tistory-ticker/1.0'},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception as exc:
            raise PublicDataUnavailable('국민연금 국내주식 투자정보 호출 실패: %s' % exc)
    rows = _odcloud_rows(payload)
    _CACHE['nps-holdings'] = (time.time(), rows)
    return rows


def fetch_nps_holding(name):
    """국민연금 연말 보유정보를 종목분석 보조 정보로 반환."""
    target = _nps_name(name)
    if not target:
        return None
    for row in _fetch_nps_rows():
        company = row.get('Company') or row.get('company') or row.get('종목명')
        if _nps_name(company) != target:
            continue
        return {
            'as_of': '2024-12-31',
            'evaluation_amount_eok': _number(row.get('Amount') or row.get('평가액(억 원)')),
            'weight_pct': _number(row.get('Weight') or row.get('자산군 내 비중(퍼센트)')),
            'holding_pct': _number(row.get('Holding') or row.get('지분율(퍼센트)')),
            'source': '국민연금공단 국내주식 투자정보',
        }
    return None
