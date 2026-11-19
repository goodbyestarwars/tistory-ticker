# -*- coding: utf-8 -*-
"""최근 분기 실적 개선(EARN) 판정 - 관찰 전용, 주문·화면과 무관 (2026-11-20).

연구(scripts/research/pullback_combo_study.py earn_cols, 상승 구간 해부 3·6단계)의 EARN과 같은 정의:
  e_op_sym = 단독 3개월 영업이익의 전년 같은 분기 대비 대칭 변화 (a-b)/((|a|+|b|)/2), 범위 -2~2
  EARN     = 그날 e_op_sym이 있는 전 종목 중 백분위 0.7 이상(상위 30%)
입력은 기존 fundamentals_cache.json의 latest_quarter만 읽는다(새 DART 호출 없음).
- 단독 3개월(amount_basis=standalone_3m) 보고서만 쓴다. 연간(사업보고서)은 비교 기준이 달라 제외한다.
- 기준일 이전에 접수된(rcept_dt < 기준일) 보고서만, 접수 후 EARN_STALE_DAYS(달력일, 연구의 200거래일 근사) 안의 것만 쓴다.
- 전년 같은 분기 영업이익 b는 저장된 operating_income_prior를 우선 쓰고, 없으면 증감률
  y=(a-b)/|b|*100 에서 부호가 하나로 정해지는 경우만 되돌린다. 두 해가 모두 가능하면(적자 기간이 낀 일부) 미확인으로 둔다.
"""
from datetime import date

EARN_STALE_DAYS = 290
EARN_PCT = 0.7


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None


def prior_operating_income(q):
    """(b, method). method='stored'|'derived'|None."""
    b = _num(q.get('operating_income_prior'))
    if b is not None:
        return b, 'stored'
    a, y = _num(q.get('operating_income')), _num(q.get('operating_income_yoy_pct'))
    if a is None or y is None:
        return None, None
    cands = []
    if 1 + y / 100 != 0:
        b1 = a / (1 + y / 100)          # b > 0 가정
        if b1 > 0:
            cands.append(b1)
    if 1 - y / 100 != 0:
        b2 = a / (1 - y / 100)          # b < 0 가정
        if b2 < 0:
            cands.append(b2)
    return (cands[0], 'derived') if len(cands) == 1 else (None, None)


def op_sym(q, basis):
    """(e_op_sym, 정보 dict) 또는 (None, 사유)."""
    if not isinstance(q, dict) or q.get('amount_basis') != 'standalone_3m':
        return None, 'not_quarterly'
    rcept = str(q.get('rcept_dt') or '')
    if len(rcept) != 8:
        return None, 'no_rcept'
    try:
        rd = date(int(rcept[:4]), int(rcept[4:6]), int(rcept[6:]))
        bd = date.fromisoformat(basis)
    except ValueError:
        return None, 'bad_date'
    if not rd < bd or (bd - rd).days > EARN_STALE_DAYS:
        return None, 'stale_or_future'
    a = _num(q.get('operating_income'))
    b, method = prior_operating_income(q)
    if a is None or b is None or abs(a) + abs(b) <= 0:
        return None, 'prior_unknown'
    return (a - b) / ((abs(a) + abs(b)) / 2), {'rceptDt': rcept, 'year': q.get('year'), 'reprtCode': q.get('reprt_code'),
                                               'priorMethod': method}


def earn_table(funds, basis):
    """{code: {'opSym', 'pct', 'improved', ...}} - 값이 있는 전 종목 백분위(같은 값은 같은 순위)."""
    vals = {}
    for code, entry in (funds or {}).items():
        v, info = op_sym((entry or {}).get('latest_quarter'), basis)
        if v is not None:
            vals[code] = (v, info)
    ordered = sorted(v for v, _ in vals.values())
    n = len(ordered)
    out = {}
    if not n:
        return out
    import bisect
    for code, (v, info) in vals.items():
        pct = bisect.bisect_right(ordered, v) / n
        out[code] = dict(info, opSym=round(v, 4), pct=round(pct, 4), improved=pct >= EARN_PCT)
    return out
