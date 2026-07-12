# -*- coding: utf-8 -*-
"""DART 재무제표로 5년 실적 추세 + 최근 분기 YoY를 계산.
투자자수급 파이프라인(investor_flow.py)과 동일하게: 순수 계산 함수 + fetch_stock() 오케스트레이터.
QoQ(직전 분기 대비)는 DART가 분기 누적치만 줘서 표준 단독분기 차감 로직이 더 필요해 이번 단계는 제외."""

import time
from datetime import datetime

import dart_client

THROTTLE_SEC = 0.25

# account_id는 회사마다 태그가 다를 수 있어(DART API의 알려진 특성) 화이트리스트를 우선
# 매칭하고, 못 찾으면 account_nm 정확 일치로 폴백한다.
REVENUE_IDS = ('ifrs-full_Revenue', 'ifrs-full_SalesRevenueNet')
OPERATING_INCOME_IDS = ('dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities')
NET_INCOME_IDS = ('ifrs-full_ProfitLoss',)
EQUITY_IDS = ('ifrs-full_Equity',)
LIABILITIES_IDS = ('ifrs-full_Liabilities',)
ASSETS_IDS = ('ifrs-full_Assets',)

QUARTER_LABEL = {'11013': '1분기', '11012': '반기', '11014': '3분기', '11011': '사업보고서(연간)'}


def to_num(v):
    if v is None or v == '':
        return None
    try:
        return float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return None


def pct_change(current, prior):
    if current is None or prior is None or prior == 0:
        return None
    return (current - prior) / abs(prior) * 100


def find_row(rows, account_ids, account_nm, sj_divs):
    for row in rows:
        if row.get('sj_div') in sj_divs and row.get('account_id') in account_ids:
            return row
    for row in rows:
        if row.get('sj_div') in sj_divs and row.get('account_nm') == account_nm:
            return row
    return None


def extract_amount(rows, account_ids, account_nm, sj_divs, amount_key):
    row = find_row(rows, account_ids, account_nm, sj_divs)
    if not row:
        return None
    return to_num(row.get(amount_key))


def call_fnltt_any(api_key, corp_code, year, reprt_code):
    """연결재무제표(CFS) 우선, 없으면 별도재무제표(OFS)로 재시도(자회사 없는 회사는 CFS 미제공)."""
    rows = dart_client.call_fnltt(api_key, corp_code, year, reprt_code, 'CFS')
    if rows:
        return rows
    time.sleep(THROTTLE_SEC)
    return dart_client.call_fnltt(api_key, corp_code, year, reprt_code, 'OFS')


def fetch_annual_series(api_key, corp_code, current_year=None):
    """최근 5개 회계연도 매출/영업이익/순이익/ROE/부채비율. bsns_year를 2번(latest_fy, latest_fy-2)
    호출하면 각 응답의 thstrm/frmtrm/bfefrmtrm(당기/전기/전전기)가 겹쳐서 5개 연도를 커버한다."""
    latest_fy = (current_year or datetime.now().year) - 1
    query_years = [latest_fy, latest_fy - 2]

    years = {}
    for i, y in enumerate(query_years):
        if i > 0:
            time.sleep(THROTTLE_SEC)
        rows = call_fnltt_any(api_key, corp_code, y, '11011')
        if not rows:
            continue
        for offset, amount_key in ((0, 'thstrm_amount'), (1, 'frmtrm_amount'), (2, 'bfefrmtrm_amount')):
            yr = y - offset
            if yr in years:
                continue  # 겹치는 연도는 먼저 얻은 값을 유지(두 호출 결과가 다를 이유는 없지만 방어적으로)
            revenue = extract_amount(rows, REVENUE_IDS, '매출액', ('IS', 'CIS'), amount_key)
            operating_income = extract_amount(rows, OPERATING_INCOME_IDS, '영업이익', ('IS', 'CIS'), amount_key)
            net_income = extract_amount(rows, NET_INCOME_IDS, '당기순이익', ('IS', 'CIS'), amount_key)
            equity = extract_amount(rows, EQUITY_IDS, '자본총계', ('BS',), amount_key)
            liabilities = extract_amount(rows, LIABILITIES_IDS, '부채총계', ('BS',), amount_key)
            assets = extract_amount(rows, ASSETS_IDS, '자산총계', ('BS',), amount_key)
            years[yr] = {
                'year': yr,
                'revenue': revenue,
                'operating_income': operating_income,
                'net_income': net_income,
                'roe_pct': (net_income / equity * 100) if (net_income is not None and equity) else None,
                'roa_pct': (net_income / assets * 100) if (net_income is not None and assets) else None,
                'debt_ratio_pct': (liabilities / equity * 100) if (liabilities is not None and equity) else None,
            }

    if not years:
        return None

    ordered = [years[y] for y in sorted(years.keys())]
    for i in range(1, len(ordered)):
        ordered[i]['revenue_yoy_pct'] = pct_change(ordered[i]['revenue'], ordered[i - 1]['revenue'])
        ordered[i]['operating_income_yoy_pct'] = pct_change(ordered[i]['operating_income'], ordered[i - 1]['operating_income'])
        ordered[i]['net_income_yoy_pct'] = pct_change(ordered[i]['net_income'], ordered[i - 1]['net_income'])

    first, last = ordered[0], ordered[-1]
    span_years = last['year'] - first['year']

    def cagr(first_v, last_v):
        if first_v is None or last_v is None or span_years <= 0 or first_v <= 0 or last_v <= 0:
            return None
        return ((last_v / first_v) ** (1.0 / span_years) - 1) * 100

    return {
        'years': ordered,
        'revenue_cagr_pct': cagr(first['revenue'], last['revenue']),
        'operating_income_cagr_pct': cagr(first['operating_income'], last['operating_income']),
        'net_income_cagr_pct': cagr(first['net_income'], last['net_income']),
        'latest_roe_pct': last['roe_pct'],
        'latest_roa_pct': last['roa_pct'],
        'latest_debt_ratio_pct': last['debt_ratio_pct'],
    }


def fetch_latest_quarter(api_key, corp_code, current_year=None):
    """가장 최근에 공시됐을 보고서를 최신 것부터 순서대로 시도해 매출/영업이익/순이익 + YoY를 뽑는다.
    분기 보고서는 frmtrm_q_amount(전년 동기 누적)를, 사업보고서는 frmtrm_amount(전기)를 비교값으로 쓴다."""
    y = current_year or datetime.now().year
    candidates = [
        (y, '11014'), (y, '11012'), (y, '11013'),
        (y - 1, '11011'), (y - 1, '11014'), (y - 1, '11012'), (y - 1, '11013'),
    ]
    for i, (yr, reprt_code) in enumerate(candidates):
        if i > 0:
            time.sleep(THROTTLE_SEC)
        rows = call_fnltt_any(api_key, corp_code, yr, reprt_code)
        if not rows:
            continue
        row = find_row(rows, REVENUE_IDS, '매출액', ('IS', 'CIS'))
        if not row:
            continue
        prior_key = 'frmtrm_q_amount' if reprt_code != '11011' else 'frmtrm_amount'

        def metric(ids, nm):
            r = find_row(rows, ids, nm, ('IS', 'CIS'))
            if not r:
                return None, None
            return to_num(r.get('thstrm_amount')), to_num(r.get(prior_key))

        revenue, revenue_prior = metric(REVENUE_IDS, '매출액')
        op, op_prior = metric(OPERATING_INCOME_IDS, '영업이익')
        net, net_prior = metric(NET_INCOME_IDS, '당기순이익')

        return {
            'year': yr,
            'reprt_code': reprt_code,
            'label': QUARTER_LABEL.get(reprt_code, reprt_code),
            'period_label': row.get('thstrm_nm'),
            'revenue': revenue,
            'operating_income': op,
            'net_income': net,
            'revenue_yoy_pct': pct_change(revenue, revenue_prior),
            'operating_income_yoy_pct': pct_change(op, op_prior),
            'net_income_yoy_pct': pct_change(net, net_prior),
        }
    return None


def fetch_stock(api_key, corp_code):
    annual = fetch_annual_series(api_key, corp_code)
    time.sleep(THROTTLE_SEC)
    latest_quarter = fetch_latest_quarter(api_key, corp_code)
    if annual is None and latest_quarter is None:
        return None
    return {'annual': annual, 'latest_quarter': latest_quarter}
