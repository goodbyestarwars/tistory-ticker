"""Conservative annual DART normalization. Missing is never zero.

Amounts from fnlttSinglAcntAll are monetary API amounts, not the scaled
printed report table. Keep raw rows and currency; display KRW in 억원.
Non-standard name matches are candidates requiring human confirmation.
"""
import math
import re
from decimal import Decimal, InvalidOperation

# Exact IDs and statement boundaries: never match disposal or profit before tax
# to an acquisition or operating-profit field.
RULES = {
    'revenue': (('IS', 'CIS'), ('ifrs-full_Revenue', 'ifrs-full_SalesRevenueNet'), ('매출액', '수익(매출액)')),
    'ebit': (('IS', 'CIS'), ('dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'), ('영업이익', '영업이익(손실)')),
    'pretax': (('IS', 'CIS'), ('ifrs-full_ProfitLossBeforeTax',), ('법인세비용차감전순이익',)),
    'taxExpense': (('IS', 'CIS'), ('ifrs-full_IncomeTaxExpenseContinuingOperations',), ('법인세비용',)),
    'taxPaid': (('CF',), ('ifrs-full_IncomeTaxesPaidClassifiedAsOperatingActivities', 'ifrs-full_IncomeTaxesPaidRefundClassifiedAsOperatingActivities'), ('법인세납부', '법인세 납부액')),
    'daCombined': (('CF',), ('ifrs-full_AdjustmentsForDepreciationAndAmortisationExpense',), ('감가상각 및 무형자산상각비',)),
    'depreciation': (('CF',), ('ifrs-full_AdjustmentsForDepreciationExpense',), ('감가상각비',)),
    'amortisation': (('CF',), ('ifrs-full_AdjustmentsForAmortisationExpense',), ('무형자산상각비',)),
    'ppeCapex': (('CF',), ('ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',), ('유형자산의 취득',)),
    'intangibleCapex': (('CF',), ('ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities',), ('무형자산의 취득',)),
    'ocf': (('CF',), ('ifrs-full_CashFlowsFromUsedInOperatingActivities',), ('영업활동현금흐름', '영업활동으로 인한 현금흐름')),
    'cash': (('BS',), ('ifrs-full_CashAndCashEquivalents',), ('현금및현금성자산',)),
    'receivables': (('BS',), ('ifrs-full_TradeAndOtherCurrentReceivables', 'ifrs-full_CurrentTradeReceivables'), ('매출채권',)),
    'inventory': (('BS',), ('ifrs-full_Inventories',), ('재고자산',)),
    'payables': (('BS',), ('ifrs-full_TradeAndOtherCurrentPayables', 'ifrs-full_CurrentTradePayables'), ('매입채무',)),
    'shortDebt': (('BS',), ('ifrs-full_ShorttermBorrowings',), ('단기차입금',)),
    'longDebt': (('BS',), ('ifrs-full_LongtermBorrowings',), ('장기차입금',)),
    'currentLongDebt': (('BS',), (), ('유동성장기차입금',)),
    'bonds': (('BS',), (), ('사채',)),
    'currentBonds': (('BS',), (), ('유동성사채',)),
    'leaseDebt': (('BS',), (), ('리스부채',)),
    'currentLeaseDebt': (('BS',), (), ('유동리스부채',)),
}


def number(raw):
    if raw is None or str(raw).strip() in ('', '-', '—'):
        return None
    value = str(raw).replace(',', '').strip()
    if re.fullmatch(r'\([\d.]+\)', value):
        value = '-' + value[1:-1]
    try:
        result = Decimal(value)
        return int(result) if result.is_finite() and result == result.to_integral() else (float(result) if result.is_finite() else None)
    except (InvalidOperation, ValueError):
        return None


def missing(reason='공시 계정 미확보'):
    return {'value': None, 'status': 'missing', 'reason': reason, 'sources': []}


def account(rows, key, receipt):
    divs, ids, names = RULES[key]
    eligible = [r for r in rows if r.get('sj_div') in divs and r.get('account_detail', '-') in ('', '-', None)]
    matches = [r for r in eligible if r.get('account_id') in ids]
    standard = bool(matches)
    if not matches:
        matches = [r for r in eligible if r.get('account_nm', '').strip() in names]
    if not matches:
        return missing()
    # Multiple valid-looking rows are ambiguous, even if their amounts match.
    if len(matches) != 1:
        return missing('중복 또는 상위·하위 계정: 수동 확인 필요')
    row = matches[0]
    currency = row.get('currency')
    value = number(row.get('thstrm_amount'))
    source = {k: row.get(k) for k in ('rcept_no', 'account_id', 'account_nm', 'sj_div', 'currency', 'thstrm_nm', 'thstrm_amount')}
    source['originalUnit'] = 'DART API 통화금액 (인쇄 보고서 배율과 구별)'
    if currency != 'KRW':
        return {**missing('KRW 통화 확인 실패: 환산하지 않음'), 'sources': [source]}
    if value is None:
        return {**missing('공시 금액 없음'), 'sources': [source]}
    verified = standard and bool(receipt) and row.get('rcept_no') == receipt
    return {'value': value, 'status': 'auto' if verified else 'review',
            'reason': '' if verified else '비표준 계정 또는 최신 접수번호 대조 필요', 'sources': [source]}


def derived(fields, keys, formula, review=False, reason=''):
    parts = [fields.get(k, missing()) for k in keys]
    if any(p['value'] is None for p in parts):
        return missing('구성 항목 누락: ' + ', '.join(k for k, p in zip(keys, parts) if p['value'] is None))
    value = formula(*[p['value'] for p in parts])
    if value is None or not math.isfinite(value):
        return missing('계산 범위 확인 필요')
    return {'value': value, 'status': 'review' if review or any(p['status'] != 'auto' for p in parts) else 'auto',
            'reason': reason, 'formula': keys, 'sources': [s for p in parts for s in p['sources']]}


def annual(rows, year, basis, report):
    receipt = (report or {}).get('rcept_no')
    # Ignore comparative amounts. One annual request provides one year only.
    rows = [r for r in rows if str(r.get('bsns_year')) == str(year) and r.get('reprt_code') == '11011'
            and r.get('fs_div', basis) == basis]
    fields = {k: account(rows, k, receipt) for k in RULES}
    fields['da'] = fields['daCombined'] if fields['daCombined']['value'] is not None else derived(fields, ['depreciation', 'amortisation'], lambda a, b: a + b)
    fields['capex'] = derived(fields, ['ppeCapex', 'intangibleCapex'], lambda a, b: abs(a) + abs(b),
                              reason='유형·무형자산 취득 지출의 양수 합계; 처분액 제외')
    fields['taxRate'] = derived(fields, ['taxExpense', 'pretax'], lambda t, p: t / p if p > 0 and 0 <= t / p <= 1 else None,
                                review=True, reason='법인세비용/세전이익 후보. 현금납부세율 아님; 정상 세율 수동 확인')
    fields['nwc'] = derived(fields, ['receivables', 'inventory', 'payables'], lambda a, b, c: a + b - c,
                            review=True, reason='매출채권+재고-매입채무 후보. 기타채권·기타채무 및 영업항목 범위 확인')
    fields['debt'] = derived(fields, ['shortDebt', 'longDebt', 'currentLongDebt', 'bonds', 'currentBonds', 'leaseDebt', 'currentLeaseDebt'], lambda *v: sum(v),
                             review=True, reason='차입금·사채·리스 후보. 중복·누락 및 영업/금융부채 범위 확인')
    fields['simpleFcf'] = derived(fields, ['ocf', 'capex'], lambda o, c: o - c, reason='영업현금흐름−CAPEX; FCFF와 다름')
    return {'year': year, 'basis': basis, 'report': report, 'fields': fields, 'rawRows': rows}


def normalize_series(records):
    ordered = sorted(records, key=lambda r: r['year'])
    for i, current in enumerate(ordered):
        fields = current['fields']
        previous = ordered[i - 1] if i else None
        if previous and previous['year'] == current['year'] - 1 and previous['basis'] == current['basis']:
            fields['deltaNwc'] = derived({'now': fields['nwc'], 'before': previous['fields']['nwc']}, ['now', 'before'], lambda a, b: a - b,
                                         review=True, reason='동일 기준의 당기 순영업운전자본−전기 순영업운전자본')
        else:
            fields['deltaNwc'] = missing('전년 동일 기준 자료 미확보')
        fields['fcff'] = derived(fields, ['ebit', 'taxRate', 'da', 'capex', 'deltaNwc'], lambda e, t, d, c, n: e * (1 - t) + d - c - n)
    return ordered
