# -*- coding: utf-8 -*-
"""DART 재무제표로 5년 실적 추세 + 최근 분기 YoY를 계산.
투자자수급 파이프라인(investor_flow.py)과 동일하게: 순수 계산 함수 + fetch_stock() 오케스트레이터.
검색기 검증은 공식 전체재무제표의 3개월 금액과 누적 금액을 구분하고 4분기는 연간-3분기누적으로 계산한다."""

import time
from datetime import datetime, timezone, date

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
        return [dict(r, fs_div='CFS') for r in rows]
    time.sleep(THROTTLE_SEC)
    return [dict(r, fs_div='OFS') for r in dart_client.call_fnltt(api_key, corp_code, year, reprt_code, 'OFS')]


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
                'rcept_no': (find_row(rows, OPERATING_INCOME_IDS, '영업이익', ('IS', 'CIS')) or {}).get('rcept_no') if offset == 0 else None,
                'fs_div': (rows[0].get('fs_div') if rows else None),
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
    분기 보고서는 frmtrm_q_amount(전년 동기 3개월)를, 사업보고서는 frmtrm_amount(전기)를 비교값으로 쓴다."""
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
            'rcept_no': row.get('rcept_no'),
            'fs_div': row.get('fs_div'),
            'amount_basis': 'annual' if reprt_code == '11011' else 'standalone_3m',
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


DIVIDEND_REPRT_CODE = '11011'


def find_dividend_row(rows, label):
    """Find a major dividend row while tolerating DART's label variants."""
    candidates = [row for row in rows if label in (row.get('se') or '')]
    if not candidates:
        return None
    common = [row for row in candidates if '보통주' in (row.get('stock_knd') or '')]
    return common[0] if common else candidates[0]


def dividend_series(row):
    if not row:
        return [None, None, None]
    return [to_num(row.get(key)) for key in ('thstrm', 'frmtrm', 'lwfr')]


def fetch_dividend_history(api_key, corp_code, current_year=None):
    """Fetch the latest DART annual report's three-year dividend indicators.

    DART's alotMatter response exposes the current, prior and two-years-prior
    values in one report, so one successful annual request is enough for the
    three-year continuity test.
    """
    latest_fy = (current_year or datetime.now().year) - 1
    for offset in range(3):
        year = latest_fy - offset
        rows = dart_client.call_alot_matter(api_key, corp_code, year, DIVIDEND_REPRT_CODE)
        if not rows:
            if offset < 2:
                time.sleep(THROTTLE_SEC)
            continue

        yield_row = find_dividend_row(rows, '현금배당수익률')
        payout_row = find_dividend_row(rows, '현금배당성향')
        dps_row = find_dividend_row(rows, '주당 현금배당금')
        if not (yield_row or payout_row or dps_row):
            if offset < 2:
                time.sleep(THROTTLE_SEC)
            continue

        years = [year, year - 1, year - 2]
        yield_values = dividend_series(yield_row)
        payout_values = dividend_series(payout_row)
        dps_values = dividend_series(dps_row)
        return {
            'source': 'DART alotMatter',
            'reportYear': year,
            'years': [
                {
                    'year': item_year,
                    'dividendYieldPct': yield_values[index],
                    'payoutRatioPct': payout_values[index],
                    'cashDividendPerShare': dps_values[index],
                }
                for index, item_year in enumerate(years)
            ],
        }
    return None


def fetch_stock(api_key, corp_code, include_screening=True):
    annual = fetch_annual_series(api_key, corp_code)
    time.sleep(THROTTLE_SEC)
    latest_quarter = fetch_latest_quarter(api_key, corp_code)
    time.sleep(THROTTLE_SEC)
    dividend = fetch_dividend_history(api_key, corp_code)
    if annual is None and latest_quarter is None:
        return None
    result = {'annual': annual, 'latest_quarter': latest_quarter, 'dividend': dividend}
    if not include_screening:
        return result
    try:
        result['screening'] = fetch_screening(api_key, corp_code, annual, latest_quarter)
    except Exception:
        # 기존 재무 표시/배치는 보존하되 검증 실패를 통과로 만들지 않는다.
        result['screening'] = {'version': 1, 'error': 'LATEST_DISCLOSURE_UNVERIFIED', 'checked_at': datetime.now(timezone.utc).isoformat()}
    return result


SCREENING_VERSION = 1


def expected_period(as_of):
    """12월 결산 정기보고서의 보수적 제출기한 기준. 비12월 결산은 검증 제외."""
    y = as_of.year
    if as_of >= date(y, 11, 15): return (y, '11014')
    if as_of >= date(y, 8, 15): return (y, '11012')
    if as_of >= date(y, 5, 16): return (y, '11013')
    if as_of >= date(y, 4, 1): return (y-1, '11011')
    return (y-1, '11014')


def latest_periodic_filing(reports):
    import re
    found = []
    for r in reports:
        name = r.get('report_nm') or ''
        match = re.search(r'\((20\d{2})\.(\d{2})\)', name)
        if not match or not any(k in name for k in ('사업보고서', '반기보고서', '분기보고서')):
            continue
        year, month = map(int, match.groups())
        code = {12: '11011', 3: '11013', 6: '11012', 9: '11014'}.get(month)
        found.append({'year': year, 'month': month, 'reprt_code': code,
                      'rcept_no': r.get('rcept_no'), 'rcept_dt': r.get('rcept_dt')})
    return max(found, key=lambda r: (r['year'], r['month'], r.get('rcept_dt') or '', r.get('rcept_no') or '')) if found else None


def fetch_screening(api_key, corp_code, annual, quarter, as_of=None):
    as_of = as_of or datetime.now(timezone.utc).date()
    filing = latest_periodic_filing(dart_client.call_periodic_reports(api_key, corp_code, as_of))
    result = {'version': SCREENING_VERSION, 'checked_at': datetime.now(timezone.utc).isoformat(), 'filing': filing}
    if not filing or not filing['reprt_code']:
        return dict(result, error='LATEST_DISCLOSURE_UNVERIFIED')
    if not quarter or (quarter['year'], quarter['reprt_code']) != (filing['year'], filing['reprt_code']) or quarter.get('rcept_no') != filing.get('rcept_no'):
        return dict(result, error='LATEST_DISCLOSURE_PENDING')
    if filing['reprt_code'] != '11011':
        # fnlttSinglAcntAll IS/CIS thstrm_amount is explicitly 3 months; add_amount is cumulative.
        standalone = {'operating_income': quarter.get('operating_income'), 'net_income': quarter.get('net_income'),
                      'basis': 'dart_thstrm_amount_3m', 'year': quarter['year'], 'reprt_code': quarter['reprt_code']}
    else:
        fs = quarter.get('fs_div')
        if fs not in ('CFS', 'OFS'):
            return dict(result, error='STATEMENT_BASIS_MISSING')
        rows = dart_client.call_fnltt(api_key, corp_code, filing['year'], '11014', fs)
        standalone = {'basis': 'annual_minus_q3_ytd_same_fs', 'year': filing['year'], 'reprt_code': '11011', 'fs_div': fs}
        for key, ids, name in [('operating_income', OPERATING_INCOME_IDS, '영업이익'), ('net_income', NET_INCOME_IDS, '당기순이익')]:
            ytd = extract_amount(rows, ids, name, ('IS', 'CIS'), 'thstrm_add_amount')
            value = quarter.get(key)
            standalone[key] = value-ytd if value is not None and ytd is not None else None
    result['standalone'] = standalone
    return result


def screening_cache_fresh(entry, checked_at=None, now=None, max_days=7):
    now = now or datetime.now(timezone.utc)
    proof = (entry or {}).get('screening') or {}
    try:
        stamp = datetime.fromisoformat(proof.get('checked_at') or checked_at or '')
        if stamp.tzinfo is None: return False
        age = (now-stamp).total_seconds()/86400
        filing = proof.get('filing') or {}
        order = {'11013': 1, '11012': 2, '11014': 3, '11011': 4}
        expected = expected_period(now.date())
        return (proof.get('version') == SCREENING_VERSION and not proof.get('error') and 0 <= age <= max_days
                and (int(filing.get('year',0)), order.get(filing.get('reprt_code'),0)) >= (expected[0], order[expected[1]]))
    except (TypeError, ValueError):
        return False
