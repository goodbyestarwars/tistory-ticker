# -*- coding: utf-8 -*-
"""Domestic market dashboard data providers.

국내시장지표의 지수·수급·증시자금은 KIS Open API만 사용한다. 신용대주잔고와
예탁증권담보융자(fetch_leverage_detail)는 KIS에 동등한 시장 전체 필드가 없어 KOFIA
공공데이터를 쓰는 두 개의 독립 카드다.
"""

import concurrent.futures
import logging
import math
import re
from datetime import datetime, timedelta, timezone

import domestic_futures
import investor_trend
import kis_client
import kiwoom_client
import program_trading_history
import public_data

logger = logging.getLogger('domestic_market_indicators')
KST = timezone(timedelta(hours=9))

MARKETS = {
    'KOSPI': {'name': '코스피', 'kiwoom_code': '001', 'kis_code': '0001'},
    'KOSDAQ': {'name': '코스닥', 'kiwoom_code': '101', 'kis_code': '1001'},
}
INTERVALS = ('minute', 'day', 'week')
# 2026-08-25: 기본 페이지 로드에는 일봉만 담는다. 주봉·분봉은 사용자가 해당 탭을
# 눌렀을 때 /domestic-market-indicators/chart에서 가져온다. 현물 차트의 느린 첫 로딩은
# 키움/KIS의 4개 차트 요청이 페이지 응답을 함께 붙잡고 있던 것이 원인이었다.
EAGER_INTERVALS = ('day',)
# KIS 국내업종 기간별 시세는 페이지당 약 50개 일봉을 반환한다. 연속조회와 함께
# 약 1년(250영업일)을 확보하려면 달력 기준으로 1년보다 조금 넉넉해야 한다.
CHART_LOOKBACK_DAYS = 370
CHART_MINUTE_MAX_BARS = 1500


def _number(value):
    if value is None or value == '':
        return None
    try:
        text = str(value).replace(',', '').replace('+', '')
        # ka90007(프로그램매매누적추이) 실측(2026-08-14)에서 순매도 값이 "--239707"처럼
        # 부호가 두 번 겹쳐 내려왔다 - 다른 TR에서는 본 적 없는 이 응답만의 표기라 여기서
        # 흡수한다(선행 "-" 연속을 하나로 접기, 정상적인 단일 부호는 그대로 둠).
        text = re.sub(r'^-{2,}', '-', text)
        value = float(text)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _price_number(value):
    """Parse a Kiwoom chart price, whose sign marks direction rather than price."""
    number = _number(value)
    return abs(number) if number is not None else None


def _first(row, *keys):
    for key in keys:
        if row.get(key) not in (None, ''):
            return row.get(key)
    return None


def _date(value):
    text = str(value or '').strip().replace('-', '').replace('.', '')
    if len(text) >= 8 and text[:8].isdigit():
        return '%s-%s-%s' % (text[:4], text[4:6], text[6:8])
    return None


def _timestamp(value):
    text = str(value or '').strip().replace('-', '').replace(':', '').replace(' ', '')
    if len(text) < 12 or not text[:12].isdigit():
        return None
    try:
        return int(datetime.strptime(text[:14], '%Y%m%d%H%M%S').replace(tzinfo=KST).timestamp())
    except ValueError:
        return None


def _normalise_index_price(value, market):
    """키움 지수 OHLC의 100배 표기를 네이버/KIS 단위로 통일한다.

    ka20006/ka20007 실측 응답은 코스피·코스닥 지수 가격을 100배 정수처럼
    내려준다(예: 669696 -> 6696.96, 81333 -> 813.33). 반면 Naver와
    실시간 스냅샷은 정상 소수점 단위라 마지막 봉만 작아지는 꼬리가 생겼다.
    10,000을 넘는 국내 현물 지수값만 보정하므로 정상 단위 응답에는 손대지 않는다.
    """
    number = _price_number(value)
    if number is not None and market in MARKETS and number > 10000:
        return number / 100.0
    return number


def _candle(row, minute=False, market=None):
    date_value = _first(row, 'dt', 'stck_bsop_date', 'date', 'localDate')
    time_value = _first(row, 'cntr_tm', 'stck_cntg_hour', 'time', 'localDateTime')
    point = {
        'open': _normalise_index_price(_first(row, 'open_pric', 'stck_oprc', 'bstp_nmix_oprc', 'openPrice'), market),
        'high': _normalise_index_price(_first(row, 'high_pric', 'stck_hgpr', 'bstp_nmix_hgpr', 'highPrice'), market),
        'low': _normalise_index_price(_first(row, 'low_pric', 'stck_lwpr', 'bstp_nmix_lwpr', 'lowPrice'), market),
        'close': _normalise_index_price(_first(row, 'cur_prc', 'stck_clpr', 'bstp_nmix_prpr', 'closePrice', 'currentPrice'), market),
        'volume': _number(_first(row, 'trde_qty', 'acml_vol', 'acc_trde_qty', 'volume')) or 0,
    }
    if any(point[key] is None for key in ('open', 'high', 'low', 'close')):
        return None
    if minute:
        point['ts'] = _number(row.get('ts')) or _timestamp(time_value or date_value)
        if point['ts'] is None:
            return None
    else:
        point['date'] = _date(date_value or time_value)
        if not point['date']:
            return None
    return point


def _chart_cutoff_date():
    return (datetime.now(KST) - timedelta(days=CHART_LOOKBACK_DAYS)).strftime('%Y-%m-%d')


def _sort_rows(rows, minute=False, limit=600, since_date=None, market=None):
    unique = {}
    for row in rows or []:
        point = _candle(row, minute=minute, market=market)
        if not point:
            continue
        if not minute and since_date and point['date'] < since_date:
            continue
        key = point['ts'] if minute else point['date']
        unique[key] = point
    result = [unique[key] for key in sorted(unique)]
    return result[-limit:]


def _fetch_kiwoom(token, market, interval):
    cfg = MARKETS[market]
    if interval == 'minute':
        api_id = 'ka20005'
        body = {
            'inds_cd': cfg['kiwoom_code'],
            'tic_scope': '1',
            'base_dt': datetime.now(KST).strftime('%Y%m%d'),
        }
        rows_key = 'inds_min_pole_qry'
        minute = True
    elif interval == 'day':
        api_id = 'ka20006'
        body = {'inds_cd': cfg['kiwoom_code'], 'base_dt': datetime.now(KST).strftime('%Y%m%d')}
        rows_key = 'inds_dt_pole_qry'
        minute = False
    else:
        api_id = 'ka20007'
        body = {'inds_cd': cfg['kiwoom_code'], 'base_dt': datetime.now(KST).strftime('%Y%m%d')}
        rows_key = 'inds_stk_pole_qry'
        minute = False
    response = kiwoom_client.call_tr(token, api_id, '/api/dostk/chart', body)
    rows = response.get(rows_key) or []
    points = _sort_rows(
        rows,
        minute=minute,
        limit=CHART_MINUTE_MAX_BARS if minute else 600,
        since_date=None if minute else _chart_cutoff_date(),
        market=market,
    )
    if len(points) < 2:
        raise RuntimeError('%s returned too few %s candles' % (api_id, market))
    return points


def _fetch_kis(token, appkey, appsecret, market, interval):
    code = MARKETS[market]['kis_code']
    if interval == 'minute':
        _, rows = kis_client.fetch_index_time_chart(token, appkey, appsecret, code, '60')
        return _sort_rows(rows, minute=True, limit=CHART_MINUTE_MAX_BARS, market=market)
    start = (datetime.now(KST) - timedelta(days=CHART_LOOKBACK_DAYS)).strftime('%Y%m%d')
    end = datetime.now(KST).strftime('%Y%m%d')
    _, rows = kis_client.fetch_index_period_chart(
        token, appkey, appsecret, code, start, end, 'W' if interval == 'week' else 'D')
    return _sort_rows(rows, minute=False, limit=600, since_date=_chart_cutoff_date(), market=market)


def _fetch_naver(market, interval):
    symbol = market
    if interval == 'minute':
        rows = domestic_futures.fetch_domestic_index_chart_minute('index', symbol, days=3)
        return _sort_rows(rows, minute=True, limit=CHART_MINUTE_MAX_BARS, market=market)
    rows = domestic_futures.fetch_domestic_index_chart('index', symbol, days=CHART_LOOKBACK_DAYS)
    points = _sort_rows(rows, minute=False, limit=600, since_date=_chart_cutoff_date(), market=market)
    if interval == 'week':
        # Naver's index endpoint is daily; aggregate it into the same weekly
        # candle shape used by the provider APIs.
        buckets = {}
        for item in points:
            d = datetime.strptime(item['date'], '%Y-%m-%d')
            monday = (d - timedelta(days=d.weekday())).strftime('%Y-%m-%d')
            bucket = buckets.setdefault(monday, {'date': monday, 'open': item['open'], 'high': item['high'], 'low': item['low'], 'close': item['close'], 'volume': 0})
            bucket['high'] = max(bucket['high'], item['high'])
            bucket['low'] = min(bucket['low'], item['low'])
            bucket['close'] = item['close']
            bucket['volume'] += item.get('volume') or 0
        points = list(buckets.values())[-600:]
    return points


def fetch_chart(kis_appkey, kis_appsecret, market, interval):
    """코스피·코스닥 차트는 KIS 단일 소스로만 조회한다."""
    if not kis_appkey or not kis_appsecret:
        return {'source': 'kis', 'rows': [], 'errors': ['KIS credentials unavailable']}
    try:
        kis_token = kis_client.get_token(kis_appkey, kis_appsecret)
        rows = _fetch_kis(kis_token, kis_appkey, kis_appsecret, market, interval)
        if len(rows) < 2:
            raise RuntimeError('KIS returned too few %s %s candles' % (market, interval))
        return {'source': 'kis', 'rows': rows, 'errors': []}
    except Exception as exc:
        logger.warning('KIS %s %s chart unavailable: %s', market, interval, exc)
        return {'source': 'kis', 'rows': [], 'errors': ['kis: %s' % exc]}


def _normalise_investor(result):
    rows = []
    for row in (result or {}).get('rows') or []:
        rows.append({
            'label': row.get('label'),
            'individual': _number(row.get('ind')),
            'foreign': _number(row.get('frgn')),
            'institution': _number(row.get('orgn')),
        })
    return rows


def fetch_investor():
    data = {}
    for market in MARKETS:
        try:
            result = investor_trend.get_result('day', market.lower())
        except Exception as exc:
            logger.warning('investor trend unavailable for %s: %s', market, exc)
            result = {'asOf': None, 'rows': []}
        data[market] = {
            'asOf': result.get('asOf'),
            'rows': _normalise_investor(result),
        }
    return data


def _signed_kis_index_change(quote, key):
    """KIS 업종지수 전일대비 값에 공식 부호 코드를 반영한다."""
    value = _number(quote.get(key))
    if value is None:
        return None
    sign = str(quote.get('prdy_vrss_sign') or '').strip()
    if sign in ('1', '2'):  # 상한/상승
        return abs(value)
    if sign in ('4', '5'):  # 하한/하락
        return -abs(value)
    return value


def fetch_cash_quote(kis_appkey, kis_appsecret, market):
    """현물 숫자 BOX용 KIS 국내업종 현재지수 스냅샷."""
    if not kis_appkey or not kis_appsecret:
        return None
    try:
        token = kis_client.get_token(kis_appkey, kis_appsecret)
        quote = kis_client.fetch_index_price(token, kis_appkey, kis_appsecret, MARKETS[market]['kis_code'])
        if not quote:
            return None
        return {
            'price': _number(quote.get('bstp_nmix_prpr')),
            'change': _signed_kis_index_change(quote, 'bstp_nmix_prdy_vrss'),
            'change_rate': _signed_kis_index_change(quote, 'bstp_nmix_prdy_ctrt'),
            'high': _number(quote.get('bstp_nmix_hgpr')),
            'low': _number(quote.get('bstp_nmix_lwpr')),
            'updated_at': datetime.now(timezone.utc).isoformat(),
            'source': 'kis',
        }
    except Exception as exc:
        logger.warning('KIS cash quote unavailable for %s: %s', market, exc)
        return None


def _number_from_candidates(row, keys):
    for key in keys:
        value = _number(row.get(key))
        if value is not None:
            return value
    return None


def _normalise_kis_funds(rows):
    result = []
    for row in rows or []:
        # FHKST649100C0 is a KOFIA aggregate response. Its documented fields
        # are bsop_date, crdt_loan_rmnd (credit balance), and cust_dpmn_amt
        # (customer deposits), all expressed in 100m KRW. Keep the previous
        # aliases as a compatibility guard for older test fixtures/proxies.
        date_value = _date(_first(row, 'bsop_date', 'stck_bsop_date', 'bas_dt', 'date', 'data_dt'))
        credit = _number_from_candidates(row, ('crdt_loan_rmnd', 'crd_tr_fing_whl', 'crdtr_fing_whl', 'crd_tr_fing', 'loan_total', 'crdt_fing_amt'))
        deposits = _number_from_candidates(row, ('cust_dpmn_amt', 'invr_dpsg_amt', 'invr_dpsg', 'customer_deposit', 'cus_dpsg_amt'))
        if date_value and (credit is not None or deposits is not None):
            result.append({'date': date_value, 'credit': credit, 'market_funds': {'date': date_value, 'investor_deposits': deposits}})
    # KIS commonly returns market-funds rows newest-first. Keep the public
    # series chronological so the last row is always the latest observation.
    return sorted(result, key=lambda item: item['date'])


def _fetch_kis_funds(kis_appkey, kis_appsecret):
    if not kis_appkey or not kis_appsecret:
        return None
    token = kis_client.get_token(kis_appkey, kis_appsecret)
    # KIS marks FID_INPUT_DATE_1 as required for this endpoint. Use the
    # server's KST business date instead of sending an empty query value.
    query_date = datetime.now(KST).strftime('%Y%m%d')
    rows = kis_client.fetch_market_funds(token, kis_appkey, kis_appsecret, date=query_date)
    normalised = _normalise_kis_funds(rows)
    if not normalised:
        return None
    latest = normalised[-1]
    return {
        'available': True,
        'source': 'kis',
        'credit_unit': 'hundred_million_krw',
        'market_funds_unit': 'hundred_million_krw',
        'latest_date': latest['date'],
        'credit': {'date': latest['date'], 'loan_total': latest.get('credit')},
        'market_funds': latest.get('market_funds'),
        # 2026-08-14 요청: "1년 평균"도 보여달라고 해서 상한을 90 -> 400으로 올린다.
        # mktfunds(FHKST649100C0)가 한 번 호출로 실제 며칠치를 주는지는 검증 안 됐지만
        # (기존 90은 그때그때 응답 길이보다 넉넉했을 수도, 부족했을 수도 있음), 상한만
        # 늘리는 거라 실제 응답이 90개보다 적으면 그대로 적은 만큼만 온다 - 안전한 변경.
        'series': normalised[-400:],
    }


def fetch_funds(kis_appkey, kis_appsecret, days=60):
    try:
        data = _fetch_kis_funds(kis_appkey, kis_appsecret)
        if data:
            return data
    except Exception:
        logger.exception('KIS market funds failed')
    return {
        'available': False,
        'source': 'KIS',
        'message': 'KIS 증시자금 데이터를 잠시 불러오지 못했습니다.',
        'series': [],
    }


_PROGRAM_TRADING_LOOKBACK_DAYS = 7  # 최근 영업일을 못 찾을 리 없는 넉넉한 여유


def _fetch_kiwoom_program_trading(token):
    """ka90007(프로그램매매누적추이요청)의 코스피 전체 시장 차익/비차익거래 순매수(최근 영업일).

    2026-08-14 VM 실측(probe_program_trading.py)으로 확인한 내용:
    - 필수 파라미터에 date(YYYYMMDD, 스킬 레퍼런스 문서에는 없던 값)가 빠지면
      return_code=2 오류가 난다.
    - 응답 컨테이너 키는 prm_trde_acc_trnsn(배열, date 지정 시 1행만 옴).
    - 부호가 "--239707"처럼 두 번 겹쳐 내려온다(_number()에서 흡수).
    - 금액 단위는 공식 문서가 없다 - all_tdy가 dfrt_trde_tdy+ndiffpro_trde_tdy와
      정확히 일치해 파싱 자체는 맞고, 코스피 전체 시장 하루 프로그램매매 규모로 볼 때
      백만원 단위로 추정된다(investor_flow.py가 같은 amt_qty_tp='1' 관례로 확인한
      것과 동일한 추정치 - 다른 TR들처럼 100% 공식 확정은 아님).

    2026-08-14 밤 실사용 중 발견: date에 "오늘"(KST) 날짜를 그대로 넣다 보니, 자정을
    넘긴 새벽이나 주말에는 그날 거래가 없어 빈 배열이 오고 카드 자체가 안 떴다
    (mktfunds와 달리 이 TR은 지정한 하루치만 주는 구조라 대체할 다른 날짜 데이터가
    같이 안 온다). 토·일요일은 API를 부르지 않고 건너뛰고(backfill_program_trading_history.py와
    동일 판단), 그 외 날짜에 빈 배열이 오면(공휴일 등) 하루씩 과거로 물러나며 값이
    나올 때까지 재시도한다.
    """
    if not token:
        return None
    now = datetime.now(KST)
    for offset in range(_PROGRAM_TRADING_LOOKBACK_DAYS):
        day = now - timedelta(days=offset)
        if day.weekday() >= 5:  # 5=토, 6=일
            continue
        date_str = day.strftime('%Y%m%d')
        try:
            res = kiwoom_client.call_tr(token, 'ka90007', '/api/dostk/mrkcond', {
                'amt_qty_tp': '1', 'mrkt_tp': '0', 'stex_tp': '3', 'date': date_str,
            })
        except Exception:
            logger.warning('Kiwoom program trading %s failed', date_str, exc_info=True)
            continue
        rows = res.get('prm_trde_acc_trnsn') or []
        if not rows:
            continue
        latest = rows[-1]
        arbitrage = _number(latest.get('dfrt_trde_tdy'))
        non_arbitrage = _number(latest.get('ndiffpro_trde_tdy'))
        total = _number(latest.get('all_tdy'))
        if arbitrage is None and non_arbitrage is None:
            continue
        # 장 시작 전 ka90007은 당일 날짜의 행을 정상 응답으로 내려주면서 차익·비차익·합계를
        # 모두 0으로 채운다. 이를 최신 실데이터로 받아들이면 화면에 0원이 노출되고 그 0이
        # 이력에도 저장된다. 세 값이 모두 정확히 0인 행은 미완성 당일 스냅샷으로 보고 직전
        # 영업일까지 계속 조회한다. 두 프로그램매매 항목이 동시에 정확히 0인 정상 장 마감은
        # 사실상 발생 가능성이 매우 낮고, 합계까지 함께 확인해 오탐을 줄인다.
        if arbitrage == 0 and non_arbitrage == 0 and total == 0:
            continue
        return {
            'date': _date(latest.get('dt')) or date_str,
            'arbitrage': arbitrage,
            'nonArbitrage': non_arbitrage,
            'total': total,
            'unit': 'million_krw',
        }
    return None


_PROGRAM_TRADING_RECENT_DAYS = 20   # "최근 평균" - 대략 한 달 영업일
_PROGRAM_TRADING_YEAR_DAYS = 252    # "1년 평균" - 연간 영업일 근사치
_PROGRAM_TRADING_CHART_DAYS = 260   # 화면에 넘겨줄 추이(스파크라인) 최대 길이
_PROGRAM_TRADING_KIS_LOOKBACK_DAYS = 400  # 252 영업일과 휴장일에 여유를 둔 달력일 범위


def _normalise_kis_program_trading(rows):
    """KIS 일별 프로그램매매 응답을 UI 공통 형식으로 정규화한다.

    KIS ``comp-program-trade-daily``는 날짜별 차익/비차익 합계 순매수
    거래대금(``*_smtn_ntby_tr_pbmn``)을 한 번에 돌려준다. 키움 ka90007처럼
    하루치만 누적할 필요가 없으므로, 중복 날짜는 마지막 응답으로 교체한 뒤 날짜순으로
    반환한다.
    """
    by_date = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        date = _date(_first(row, 'stck_bsop_date', 'bsop_date', 'date'))
        arbitrage = _number(_first(row, 'arbt_smtn_ntby_tr_pbmn'))
        non_arbitrage = _number(_first(row, 'nabt_smtn_ntby_tr_pbmn'))
        if not date or arbitrage is None or non_arbitrage is None:
            continue
        by_date[date] = {
            'date': date,
            'arbitrage': arbitrage,
            'nonArbitrage': non_arbitrage,
            'total': arbitrage + non_arbitrage,
        }
    return [by_date[date] for date in sorted(by_date)]


def _program_trading_payload(rows, source):
    """일별 행으로 현재값·평균·차트 이력을 같은 계약으로 만든다."""
    rows = list(rows or [])
    if not rows:
        return None
    latest = rows[-1]

    def average(field, limit):
        values = [row[field] for row in rows[-limit:] if row.get(field) is not None]
        return (sum(values) / len(values)) if values else None

    return {
        'available': True,
        'source': source,
        'date': latest['date'],
        'arbitrage': latest['arbitrage'],
        'nonArbitrage': latest['nonArbitrage'],
        'total': latest['total'],
        'unit': 'million_krw',
        'recentAverage': {
            'arbitrage': average('arbitrage', _PROGRAM_TRADING_RECENT_DAYS),
            'nonArbitrage': average('nonArbitrage', _PROGRAM_TRADING_RECENT_DAYS),
        },
        'yearAverage': {
            'arbitrage': average('arbitrage', _PROGRAM_TRADING_YEAR_DAYS),
            'nonArbitrage': average('nonArbitrage', _PROGRAM_TRADING_YEAR_DAYS),
        },
        'history': [{
            'date': row['date'],
            'arbitrage': row['arbitrage'],
            'nonArbitrage': row['nonArbitrage'],
        } for row in rows[-_PROGRAM_TRADING_CHART_DAYS:]],
    }


def _fetch_kis_program_trading(kis_appkey, kis_appsecret):
    """KIS 일별 API로 코스피 프로그램매매 1년 추이를 바로 가져온다."""
    if not kis_appkey or not kis_appsecret:
        return []
    end = datetime.now(KST).date()
    start = end - timedelta(days=_PROGRAM_TRADING_KIS_LOOKBACK_DAYS)
    token = kis_client.get_token(kis_appkey, kis_appsecret)
    rows = kis_client.fetch_program_trading_daily(
        token, kis_appkey, kis_appsecret,
        start.strftime('%Y%m%d'), end.strftime('%Y%m%d'),
        market='K',
    )
    return _normalise_kis_program_trading(rows)


def _fetch_kiwoom_program_trading_with_history(kiwoom_token):
    """KIS를 사용할 수 없을 때만 기존 키움 하루치 누적 이력을 사용한다."""
    try:
        data = _fetch_kiwoom_program_trading(kiwoom_token)
        if data:
            data.update({'available': True, 'source': 'kiwoom'})
            # ka90007은 "오늘" 하루 값만 주고 과거 여러 날을 한 번에 안 줘서(위 함수 설명
            # 참고), 조회할 때마다 로컬에 하루치씩 쌓아 1년 평균·추이 차트를 만든다
            # (2026-08-14 요청 - program_trading_history.py 참고).
            try:
                program_trading_history.record(data['date'], data['arbitrage'], data['nonArbitrage'], data['total'])
            except Exception:
                logger.exception('Program trading history record failed')
            history = program_trading_history.load()
            # 수정 배포 전에 저장된 장 시작 전 0원 스냅샷도 평균과 차트에서 제외한다.
            history = {
                date: entry for date, entry in history.items()
                if not (
                    entry.get('arbitrage') == 0
                    and entry.get('nonArbitrage') == 0
                    and entry.get('total') == 0
                )
            }
            data['recentAverage'] = {
                'arbitrage': program_trading_history.average(history, 'arbitrage', _PROGRAM_TRADING_RECENT_DAYS),
                'nonArbitrage': program_trading_history.average(history, 'nonArbitrage', _PROGRAM_TRADING_RECENT_DAYS),
            }
            data['yearAverage'] = {
                'arbitrage': program_trading_history.average(history, 'arbitrage', _PROGRAM_TRADING_YEAR_DAYS),
                'nonArbitrage': program_trading_history.average(history, 'nonArbitrage', _PROGRAM_TRADING_YEAR_DAYS),
            }
            arbitrage_series = program_trading_history.series(history, 'arbitrage', _PROGRAM_TRADING_CHART_DAYS)
            non_arbitrage_series = program_trading_history.series(history, 'nonArbitrage', _PROGRAM_TRADING_CHART_DAYS)
            non_arbitrage_by_date = dict(non_arbitrage_series)
            data['history'] = [
                {'date': date, 'arbitrage': value, 'nonArbitrage': non_arbitrage_by_date.get(date)}
                for date, value in arbitrage_series
            ]
            return data
    except Exception:
        logger.exception('Kiwoom program trading failed')
    return {
        'available': False,
        'source': 'kiwoom',
        'message': '프로그램매매(차익/비차익) 데이터를 잠시 불러오지 못했습니다.',
    }


def fetch_program_trading(kis_appkey=None, kis_appsecret=None):
    """프로그램매매는 KIS 일별 이력만 사용한다."""
    try:
        kis_rows = _fetch_kis_program_trading(kis_appkey, kis_appsecret)
        payload = _program_trading_payload(kis_rows, 'kis')
        if payload:
            return payload
    except Exception:
        logger.exception('KIS program trading history failed')
    return {
        'available': False,
        'source': 'kis',
        'message': 'KIS 프로그램매매(차익/비차익) 데이터를 잠시 불러오지 못했습니다.',
    }


_LEVERAGE_DETAIL_LOOKBACK_DAYS = 400  # 1년 평균(252영업일)에 여유를 더한 상한


def fetch_leverage_detail():
    """신용대주잔고(공매도용으로 주식 자체를 빌린 잔고)·예탁증권담보융자.

    2026-08-14 요청: "신용잔고(빚투)"는 돈을 빌려 산 잔고인데, 반대로 주식 자체를
    빌린 잔고(신용대주)와 보유 주식을 담보로 받은 대출(예탁증권담보융자)도 보고 싶다는
    요청. KIS mktfunds(FHKST649100C0)에는 이 두 필드가 없어서, 증시온도 위젯이 이미
    쓰고 있는 KOFIA 공공데이터(public_data.fetch_kofia_market)의 신용공여잔고추이에서
    lending_total(신용대주 전체)·collateral_loan(예탁증권담보융자)만 뽑아 쓴다.

    2026-08-12에 "증시자금은 KIS 전용으로 고정하고 KOFIA fallback을 제거"한 것과는
    성격이 다르다 - 그건 신용잔고/고객예탁금(_fetch_kis_funds)의 대체 공급자였고
    (같은 값을 어디서 받아오느냐의 문제), 이건 KIS가 애초에 안 주는 새 필드를
    보충하는 것이라 _fetch_kis_funds/신용잔고·고객예탁금 카드는 그대로 KIS 전용이다.
    KOFIA가 실패해도 이 카드만 안 뜰 뿐 나머지 증시자금 카드에는 영향이 없다.

    2026-08-14 단위 버그 수정: public_data.py 모듈 주석은 "credit-balance amounts
    are in million KRW"라고 credit_by_date 전체를 뭉뚱그려 설명하는데, 실측해보니
    같은 딕셔너리 안에서도 필드마다 단위가 달랐다 - loan_total(신용융자, 이미
    js/market-temp.js가 /1,000,000로 조원 환산해서 쓰고 있음. 예: 17,400,000 ->
    17.4조원)은 실제로 백만원 단위가 맞지만, lending_total(신용대주)·collateral_loan
    (예탁증권담보융자)을 똑같이 백만원으로 놓고 계산하니 "24,715,600.8조원"처럼
    현실적으로 불가능한 값이 나왔다(사용자 스크린샷 제보로 발견) - 두 필드는 이미
    원(KRW) 단위로 보는 게 맞다(원 단위로 보면 각각 273억원·24.7조원 수준으로 예탁
    증권담보융자·신용융자와 규모가 비슷해 타당함). 공식 문서가 없어 이 결론도
    100% 확정은 아니지만, 그 반대(백만원)는 물리적으로 불가능한 값이 나와 배제했다.
    """
    try:
        result = public_data.fetch_kofia_market(days=_LEVERAGE_DETAIL_LOOKBACK_DAYS)
    except Exception:
        logger.exception('KOFIA leverage detail failed')
        return {
            'available': False,
            'source': 'kofia',
            'message': '신용대주잔고·예탁증권담보융자 데이터를 잠시 불러오지 못했습니다.',
        }
    rows = [(row['date'], row['credit']) for row in (result.get('series') or []) if row.get('credit')]
    if not rows:
        return {
            'available': False,
            'source': 'kofia',
            'message': '신용대주잔고·예탁증권담보융자 데이터가 비어 있습니다.',
        }
    latest_date, latest = rows[-1]
    return {
        'available': True,
        'source': 'kofia',
        'unit': 'krw',
        'latest_date': latest_date,
        'lending': {'date': latest_date, 'balance': latest.get('lending_total')},
        'collateral': {'date': latest_date, 'balance': latest.get('collateral_loan')},
        'series': [
            {'date': date, 'lending': credit.get('lending_total'), 'collateral': credit.get('collateral_loan')}
            for date, credit in rows[-_LEVERAGE_DETAIL_LOOKBACK_DAYS:]
        ],
    }


def build_dashboard(kis_appkey=None, kis_appsecret=None):
    """코스피/코스닥 현물 일봉 + 최신 숫자 + 투자자 수급 + 증시자금을 모은다.
    주봉·분봉은 /domestic-market-indicators/chart 온디맨드 엔드포인트에서
    fetch_chart()를 재사용해 필요할 때만 조회한다(EAGER_INTERVALS 주석 참고).

    각 fetch_*는 서로 다른 종목/엔드포인트를 조회하는 독립적인 I/O라 순서를 지킬
    이유가 없는데, 예전에는 전부 한 요청 안에서 순차 호출해서(2026-08-14 사용자
    리포트: 같은 페이지의 코스피200 선물 위젯보다 훨씬 느리게 뜬다) 느린 API 하나가
    전체 응답 시간을 그대로 늘렸다. kis_client의 토큰 캐시가 이미 threading.Lock으로
    동시 호출에 안전해서, 스레드풀로 병렬 실행해 전체 응답
    시간을 가장 느린 호출 1개 수준으로 줄인다(각 fetch_*는 실패해도 내부에서
    예외를 잡아 안내 문구가 담긴 결과를 돌려주므로 여기서 추가로 try/except할
    필요는 없다).
    """
    chart_keys = [(market, interval) for market in MARKETS for interval in EAGER_INTERVALS]
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(chart_keys) + 6) as pool:
        chart_futures = {
            key: pool.submit(fetch_chart, kis_appkey, kis_appsecret, key[0], key[1])
            for key in chart_keys
        }
        investor_future = pool.submit(fetch_investor)
        funds_future = pool.submit(fetch_funds, kis_appkey, kis_appsecret)
        program_trading_future = pool.submit(fetch_program_trading, kis_appkey, kis_appsecret)
        leverage_detail_future = pool.submit(fetch_leverage_detail)
        quote_futures = {
            market: pool.submit(fetch_cash_quote, kis_appkey, kis_appsecret, market)
            for market in MARKETS
        }

        indices = {}
        for market, cfg in MARKETS.items():
            intervals = {}
            for interval in EAGER_INTERVALS:
                intervals[interval] = chart_futures[(market, interval)].result()
            indices[market] = {
                'name': cfg['name'],
                'quote': quote_futures[market].result(),
                'intervals': intervals,
            }

        return {
            'sourcePriority': ['kis', 'kofia'],
            'indices': indices,
            'investor': investor_future.result(),
            'funds': funds_future.result(),
            'programTrading': program_trading_future.result(),
            'leverageDetail': leverage_detail_future.result(),
        }
