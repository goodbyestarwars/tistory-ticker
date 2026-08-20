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
KOFIA_CREDIT_URL = (
    'https://apis.data.go.kr/1160100/service/'
    'GetKofiaStatisticsInfoService/getGrantingOfCreditBalanceInfo'
)
KOFIA_MARKET_FUNDS_URL = (
    'https://apis.data.go.kr/1160100/service/'
    'GetKofiaStatisticsInfoService/getSecuritiesMarketTotalCapitalInfo'
)
NPS_HOLDING_URL = (
    'https://api.odcloud.kr/api/3070507/v1/'
    'uddi:cc757223-fdc0-45b2-a617-dcbecec3fe1f'
)
# 2026-08-20: 원래 URL 끝에 '_20241231'가 잘못 붙어있어 실제 존재하지 않는 리소스라 항상
# 404였다(국민연금 카테고리가 계속 비어있던 실제 원인) - infuser.odcloud.kr 스웨거
# 문서(namespace=3070507/v1) API 목록에서 "국민연금공단_국내주식 투자정보_20241231"의
# 실제 경로가 접미사 없는 이 uddi임을 직접 확인 후 수정. 이전 연도(2016~2023년 말 기준)
# 리소스는 접미사가 붙은 게 맞고, 이 2024년 말 기준 리소스만 접미사가 없다 - 스웨거
# 문서에서 직접 확인한 값이므로 다음 연도로 데이터셋이 갱신되면(매년 말 기준 신규 발행)
# 이 상수도 같은 방식으로(스웨거 문서에서 최신 uddi 확인) 다시 갱신해야 한다.

# 2026-08-20: 위 NPS_HOLDING_URL(연 1회, 연말 보유 전체 랭킹 - 국내주식 투자정보,
# namespace=3070507)과는 완전히 다른 별도 데이터셋(namespace=15106890, "대량보유주식
# 보고내역")이다 - 자본시장법상 5% 이상 보유·1%p 이상 변동 시 5영업일 이내 신고하는
# 수시공시(대량보유상황보고)를 data.go.kr이 분기 단위로 묶어 재배포한 것. 사용자가
# infuser.odcloud.kr 스웨거 문서(namespace=15106890/v1)에서 실제 응답을 직접 확인한
# 결과: 발행기관명(종목명)/보고서 작성기준일(행마다 실제 날짜, 위 _NPS_AS_OF 같은 고정값
# 아님)/지분율(퍼센트)만 있고 평가액·자산군 비중 필드는 없음, 전체 종목 수도 142개뿐(5%
# 이상 신고 대상만 - 국민연금 전체 포트폴리오가 아니다). 그래서 전략검색 "국민연금
# 보유종목" 카테고리(위 NPS_HOLDING_URL, 전체 랭킹)는 그대로 두고, 이건 종목분석 페이지
# 연기금 카드에 "최근 5% 이상 신고 여부"라는 별도 보조 정보로만 추가한다(사용자 확인:
# "기존건 유지하고 이건 별도로 추가"). 분기마다 새 리소스가 발행되므로(스웨거 문서에
# 20220701~20260331까지 나열돼 있었음) 아래 uddi도 다음 분기 발행되면 같은 방식(스웨거
# 문서에서 최신 uddi 확인)으로 갱신해야 한다.
NPS_LARGE_HOLDING_URL = (
    'https://api.odcloud.kr/api/15106890/v1/'
    'uddi:5536983c-fa78-46c7-bef1-b602ec951fcf'  # _20260331(2026-08-20 기준 최신 분기)
)

_CACHE = {}
_STOCK_CACHE_TTL = 15 * 60
_NPS_CACHE_TTL = 24 * 60 * 60
_KOFIA_CACHE_TTL = 30 * 60


class PublicDataUnavailable(RuntimeError):
    """서비스키가 없거나 공공데이터 호출에 실패한 경우."""


def _service_key(kind):
    names = {
        'stock': ('DATA_GO_KR_STOCK_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'krx': ('DATA_GO_KR_KRX_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'product': ('DATA_GO_KR_PRODUCT_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'nps': ('DATA_GO_KR_NPS_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
        'kofia': ('DATA_GO_KR_KOFIA_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'),
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


def _clean_number(value):
    number = _number(value)
    return int(number) if number.is_integer() else number


def _kofia_date(value):
    date_value = str(value or '').replace('-', '').strip()
    if len(date_value) != 8 or not date_value.isdigit():
        return None
    return '%s-%s-%s' % (date_value[:4], date_value[4:6], date_value[6:8])


def _fetch_kofia_rows(url, begin_date, end_date):
    payload = _request_json(url, {
        'beginBasDt': begin_date,
        # KOFIA's endBasDt is exclusive, so tomorrow includes today's row.
        'endBasDt': end_date,
        'numOfRows': 1000,
        'pageNo': 1,
    }, 'kofia')
    _, rows = _body_items(payload)
    return rows


def fetch_kofia_market(days=30):
    """Return KOFIA credit-balance and market-funds history for dashboard context.

    The KOFIA fields use different source units, and this isn't even uniform
    within `credit`: loan_total/loan_securities/loan_kosdaq (신용융자) are in
    million KRW (verified via js/market-temp.js's /1,000,000 -> 조원 display,
    which produces sane values), but lending_total(신용대주)/collateral_loan
    (예탁증권담보융자) turned out to already be plain KRW - treating them as
    million KRW produced physically impossible figures (2026-08-14, caught by
    a user screenshot: "24,715,600.8조원"). market-funds amounts are plain KRW.
    No official docs confirm any of this - it's inferred from what produces
    plausible magnitudes, same as other undocumented TRs in this codebase.
    """
    # 2026-08-14: 증시자금 신용대주잔고/예탁증권담보융자 카드가 "1년 평균"(252영업일)을
    # 계산하려면 90일 상한으로는 부족해서 400으로 올린다 - /kofia-market 엔드포인트는
    # main.py의 Query(le=90)로 여전히 90일까지만 받으므로 기존 호출자에는 영향이 없다.
    # numOfRows=1000(_fetch_kofia_rows)이라 하루 1행 기준 400일도 한 번의 호출로 충분.
    window = max(7, min(int(days or 30), 400))
    cache_key = 'kofia-market:%s' % window
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _KOFIA_CACHE_TTL:
        return cached[1]

    begin_date = (datetime.now() - timedelta(days=window * 2)).strftime('%Y%m%d')
    end_date = (datetime.now() + timedelta(days=1)).strftime('%Y%m%d')
    credit_rows = _fetch_kofia_rows(KOFIA_CREDIT_URL, begin_date, end_date)
    funds_rows = _fetch_kofia_rows(KOFIA_MARKET_FUNDS_URL, begin_date, end_date)

    credit_by_date = {}
    for row in credit_rows:
        date_value = _kofia_date(row.get('basDt'))
        if not date_value:
            continue
        credit_by_date[date_value] = {
            'date': date_value,
            'loan_total': _clean_number(row.get('crdTrFingWhl')),
            'loan_securities': _clean_number(row.get('crdTrFingScrs')),
            'loan_kosdaq': _clean_number(row.get('crdTrFingKosdaq')),
            'lending_total': _clean_number(row.get('crdTrLndrWhl')),
            'collateral_loan': _clean_number(row.get('dpsgScrtMogFing')),
        }

    funds_by_date = {}
    for row in funds_rows:
        date_value = _kofia_date(row.get('basDt'))
        if not date_value:
            continue
        funds_by_date[date_value] = {
            'date': date_value,
            'investor_deposits': _clean_number(row.get('invrDpsgAmt')),
            'derivative_deposits': _clean_number(row.get('onbdDrvPrdTrRcAdvAmt')),
            'rp_balance': _clean_number(row.get('toCstRpchCndBndSlgBal')),
            'unsettled': _clean_number(row.get('brkTrdUcolMny')),
            'forced_sale_amount': _clean_number(row.get('brkTrdUcolMnyVsOppsTrdAmt')),
            'forced_sale_ratio_pct': _clean_number(row.get('ucolMnyVsOppsTrdRlImpt')),
        }

    dates = sorted(set(credit_by_date) | set(funds_by_date))[-window:]
    series = [{
        'date': date_value,
        'credit': credit_by_date.get(date_value),
        'market_funds': funds_by_date.get(date_value),
    } for date_value in dates]
    if not series:
        raise PublicDataUnavailable('KOFIA 시장자금 통계가 비어 있습니다.')

    latest_credit = next((item['credit'] for item in reversed(series) if item['credit']), None)
    latest_funds = next((item['market_funds'] for item in reversed(series) if item['market_funds']), None)
    result = {
        'available': True,
        'source': 'data.go.kr: 금융위원회 금융투자협회 종합통계정보',
        'credit_unit': 'million_krw',
        'market_funds_unit': 'krw',
        'latest_date': series[-1]['date'],
        'credit': latest_credit,
        'market_funds': latest_funds,
        'series': series,
    }
    _CACHE[cache_key] = (time.time(), result)
    return result


def _nps_name(value):
    normalized = re.sub(r'[^0-9A-Za-z가-힣]', '', str(value or '')).lower()
    normalized = normalized.replace('주식회사', '')
    if normalized.endswith('주') and len(normalized) > 2:
        normalized = normalized[:-1]
    return normalized


# 2026-08-20: data.go.kr(namespace 3070507, NPS_HOLDING_URL)은 아직 2024-12-31 스냅샷이
# 최신이라 2025년 말 데이터가 없었다(infuser.odcloud.kr 스웨거 문서로 직접 확인 - 20차
# 참고). 사용자가 국민연금기금운용본부 자체 사이트(fund.nps.or.kr, 운용현황 > 자산군별
# 현황 > 국내 주식 > 투자종목 > "2025" 다운로드)에서 2025년 말 데이터(2026년 3분기 공시,
# data.go.kr보다 원본이 더 빠름 - 파일 안내문: "전년도 말 기준 자산군별 세부내역은 금년도
# 3분기에 공시")를 직접 받아와 이 정적 스냅샷으로 반영했다. fund.nps.or.kr을 매번 직접
# 호출하는 자동화는 아직 안 함(다운로드 URL이 세션/버튼 클릭 기반이라 안정적인 직접 호출
# 경로인지 검증 전) - 별도 작업으로 남겨둠. 이 파일이 있으면 data.go.kr API보다 우선한다;
# 다음 해 데이터로 갱신하려면 같은 방식으로 새 스냅샷을 받아 이 파일을 교체하고 아래
# _NPS_AS_OF/_NPS_SOURCE도 같이 갱신해야 한다(자동 갱신 아님).
_NPS_STATIC_SNAPSHOT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nps_holdings_2025.json')


def _fetch_nps_rows():
    cached = _CACHE.get('nps-holdings')
    if cached and time.time() - cached[0] < _NPS_CACHE_TTL:
        return cached[1]
    if os.path.exists(_NPS_STATIC_SNAPSHOT_FILE):
        with open(_NPS_STATIC_SNAPSHOT_FILE, 'r', encoding='utf-8') as f:
            rows = json.load(f)
        _CACHE['nps-holdings'] = (time.time(), rows)
        return rows
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


_NPS_AS_OF = '2025-12-31'  # nps_holdings_2025.json 스냅샷 기준일(fund.nps.or.kr 원본 파일의 "2025년 말 기준" 표기 그대로)
_NPS_SOURCE = '국민연금기금운용본부(fund.nps.or.kr) 국내주식 투자종목'


def _nps_row_info(row):
    return {
        'as_of': _NPS_AS_OF,
        'evaluation_amount_eok': _number(row.get('Amount') or row.get('평가액(억 원)')),
        'weight_pct': _number(row.get('Weight') or row.get('자산군 내 비중(퍼센트)')),
        'holding_pct': _number(row.get('Holding') or row.get('지분율(퍼센트)')),
        'source': _NPS_SOURCE,
    }


def fetch_nps_holding(name):
    """국민연금 연말 보유정보를 종목분석 보조 정보로 반환."""
    target = _nps_name(name)
    if not target:
        return None
    for row in _fetch_nps_rows():
        company = row.get('Company') or row.get('company') or row.get('종목명')
        if _nps_name(company) != target:
            continue
        return _nps_row_info(row)
    return None


def fetch_nps_holdings_by_code(universe):
    """국민연금 보유종목 전체를 유니버스([{code,name},...])의 종목명과 매칭해
    {code: {evaluation_amount_eok, weight_pct, holding_pct, as_of, source}}로 반환.
    2026-08-20: 전략검색 "국민연금 보유종목" 카테고리용 - fetch_nps_holding()과 동일한
    _nps_name() 정규화(주식회사/우선주 '주' 접미사 등 표기 차이 흡수)를 재사용하되,
    이쪽은 종목 하나가 아니라 전체를 한 번의 HTTP 호출(_fetch_nps_rows(), 24시간 캐시)로
    매칭한다. 서비스키 미설정 등으로 조회 자체가 안 되면 빈 dict를 돌려줘 호출부가
    "국민연금 보유 정보를 아직 확인할 수 없습니다"로 처리하게 한다(임의로 채우지 않음)."""
    try:
        rows = _fetch_nps_rows()
    except PublicDataUnavailable:
        return {}
    by_name = {}
    for row in rows:
        company = row.get('Company') or row.get('company') or row.get('종목명')
        key = _nps_name(company)
        if not key or key in by_name:
            continue  # 동일 정규화 이름이 두 번 나오면(드묾) 먼저 나온 행을 유지
        by_name[key] = _nps_row_info(row)
    result = {}
    for stock in universe:
        key = _nps_name(stock.get('name'))
        info = by_name.get(key)
        if info:
            result[stock['code']] = info
    return result


def _fetch_nps_large_holding_rows():
    """대량보유주식 보고내역(위 NPS_LARGE_HOLDING_URL) 원본 행. _fetch_nps_rows()와 같은
    캐시·재시도 패턴이지만 캐시 키·에러 메시지를 분리해 둘이 서로 영향을 주지 않는다."""
    cached = _CACHE.get('nps-large-holdings')
    if cached and time.time() - cached[0] < _NPS_CACHE_TTL:
        return cached[1]
    params = {'page': 1, 'perPage': 500, 'returnType': 'JSON'}
    try:
        payload = _request_json(NPS_LARGE_HOLDING_URL, params, 'nps')
    except PublicDataUnavailable:
        query = dict(params)
        query['serviceKey'] = _service_key('nps')
        request = urllib.request.Request(
            NPS_LARGE_HOLDING_URL + '?' + urllib.parse.urlencode(query),
            headers={'User-Agent': 'tistory-ticker/1.0'},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception as exc:
            raise PublicDataUnavailable('국민연금 대량보유주식 보고내역 호출 실패: %s' % exc)
    rows = _odcloud_rows(payload)
    _CACHE['nps-large-holdings'] = (time.time(), rows)
    return rows


_NPS_LARGE_HOLDING_SOURCE = '국민연금공단 대량보유주식 보고내역(5% 이상 보유·1%p 이상 변동 신고)'


def fetch_nps_large_holding(name):
    """국민연금이 최근 분기에 5% 이상 보유(또는 1%p 이상 변동)로 신고한 종목이면 그
    보고서 작성기준일·지분율을 반환하고, 대상이 아니면 None(전체 포트폴리오가 아니라
    5%룰 신고 종목만 있는 데이터셋이라 대부분 종목은 None이 정상이다).
    fetch_nps_holding()(연 1회 전체 랭킹)과는 별개 - 종목분석 연기금 카드의 보조
    정보로만 쓴다."""
    target = _nps_name(name)
    if not target:
        return None
    for row in _fetch_nps_large_holding_rows():
        company = row.get('발행기관명')
        if _nps_name(company) != target:
            continue
        return {
            'as_of': row.get('보고서 작성기준일'),
            'holding_pct': _number(row.get('지분율(퍼센트)')),
            'source': _NPS_LARGE_HOLDING_SOURCE,
        }
    return None
