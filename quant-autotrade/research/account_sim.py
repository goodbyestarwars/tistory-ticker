# -*- coding: utf-8 -*-
"""날짜순 모의 계좌 시뮬레이터 (2026-10-11, 연구용). 모의매매 계좌(candidate_gen.paper_portfolios)와 백테스트가 함께 쓴다.

계좌 평가금액 = 현금 + 보유 포지션 평가액(종가 기준, 미실현 손익 포함). 누적수익률·MDD는 이 날짜순 자산곡선으로 계산한다.
거래비용은 청산 시점에 순수익률(net)로 한꺼번에 반영된다(청산 전 평가는 총 가격 기준).

두 가지 체결 시점 가정을 구분한다 - 일봉만으로는 장중 매도·매수의 선후를 알 수 없으므로 유리한 순서를 임의로 만들지 않는다.
 · conservative : 그날 청산된 대금은 **다음 거래일**부터 쓸 수 있다(시가 매수 시점에 이미 청산 중인 포지션도 자리를 차지). 의무 대기 규칙이 아니라
                  '선후를 알 수 없을 때의 보수적 가정'이다.
 · sameDay      : 시가에 자금·자리가 모자라 못 산 후보를, 그날 **장 마감(종가 +0.2%)** 에 산다. 매도가 확실히 종가보다 앞선 경우만 대금을 쓴다:
                    - 신호 청산(다음 거래일 시가 체결)과 장중 추적선 이탈은 종가 이전 → 대금 사용 가능
                    - 최대 보유일 종가 청산은 종가와 동시 → 사용 불가(다음 거래일부터)
                  시가 매수는 어느 시나리오에서도 같은 날 매도 대금을 쓰지 않는다(시가 시점 선후 불명).
미체결(OPEN, PENDING_EXIT) 포지션은 체결 전까지 한도와 보유 수를 점유하고, 예상 대금은 현금이 아니다.
"""
from allocation import LIMITS, entry_size


def _stats(rets):
    wins = [x for x in rets if x > 0]
    losses = [x for x in rets if x <= 0]
    return {'closed': len(rets), 'avg': (sum(rets) / len(rets)) if rets else None, 'win': (len(wins) / len(rets)) if rets else None,
            'pf': (sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None}


def simulate_account(cands, calendar, close_at, make_alt=None, scenario='conservative', limits=None, broker_cash=None, keep_curve=False):
    """cands: dict 목록 {key, code, score, entry_date, entry_price, exit_date, net, exit_class, status(OPEN|PENDING_EXIT|CLOSED)}
    calendar: 오름차순 거래일, close_at(code, date)->종가|None, make_alt(cand)->같은 형식의 '종가 진입' 후보|None (sameDay 전용)."""
    lim = limits or LIMITS
    by_entry = {}
    for c in cands:
        if c.get('entry_date'):
            by_entry.setdefault(c['entry_date'], []).append(c)
    cash = equity = 1.0
    peak = 1.0
    mdd = 0.0
    positions, realized = [], []
    rej = {'MAX_POS': 0, 'DUP': 0, 'CASH_OR_CAP': 0, 'BROKER_CASH': 0}
    reuse_buys = taken = 0
    missing = 0
    curve = []

    def invested():
        return sum(p['size'] for p in positions)

    def try_buy(c, entry_px, today_close, equity_base, deferred_ok, alt=False):
        nonlocal cash, taken
        size, reason = entry_size(equity_base, cash, invested(), len(positions), {p['c']['code'] for p in positions}, c['code'], lim, broker_cash)
        if reason:
            rej[reason] = rej.get(reason, 0) + 1
            return reason
        cash -= size
        positions.append({'c': c, 'size': size, 'px': entry_px, 'ratio': (today_close / entry_px) if today_close else 1.0, 'alt': alt})
        taken += 1
        return None

    def sell(pred):
        nonlocal cash
        for p in [p for p in positions if pred(p)]:
            cash += p['size'] * (1 + p['c']['net'])        # 체결이 확정된 청산만 현금이 된다
            realized.append(p['c']['net'])
            positions.remove(p)

    for d in calendar:
        base_equity = equity                                # 직전 종가 평가금액으로 크기를 정한다
        deferred = []
        # 1) 시가 진입 (두 시나리오 모두 같은 날 매도 대금은 쓰지 않는다)
        for c in sorted(by_entry.get(d, []), key=lambda c: (-(c.get('score') or 0), c.get('tie', c['code']))):
            reason = try_buy(c, c['entry_price'], close_at(c['code'], d), base_equity, False)
            if reason in ('MAX_POS', 'CASH_OR_CAP', 'BROKER_CASH'):
                deferred.append(c)
        due = lambda p: p['c'].get('exit_date') == d and p['c'].get('status') == 'CLOSED'
        if scenario == 'sameDay':
            sell(lambda p: due(p) and p['c'].get('exit_class') in ('open', 'intraday'))     # 종가보다 앞선 것이 확실한 매도만
            for c in deferred:                                                             # 2) 같은 날 장 마감 재투입
                alt = make_alt(c) if make_alt else None
                if not alt or alt.get('entry_date') != d:
                    continue
                if try_buy(alt, alt['entry_price'], close_at(alt['code'], d), base_equity, True, alt=True) is None:
                    reuse_buys += 1
            sell(lambda p: due(p))                                                         # 종가 청산은 재투입 이후 현금이 된다
        else:
            sell(due)
        # 3) 종가 평가
        value = cash
        for p in positions:
            cl = close_at(p['c']['code'], d)
            if cl:
                p['ratio'] = cl / p['px']
            else:
                missing += 1
            value += p['size'] * p['ratio']
        equity = value
        peak = max(peak, equity)
        mdd = min(mdd, equity / peak - 1)
        if keep_curve:
            curve.append((d, equity))
    open_n = sum(1 for p in positions if p['c'].get('status') == 'OPEN')
    pend_n = sum(1 for p in positions if p['c'].get('status') == 'PENDING_EXIT')
    out = dict(_stats(realized), cumRet=(equity - 1) if taken else None, mddExact=(missing == 0), missingMarks=missing, rejected=rej, taken=taken,
               reuseBuys=reuse_buys, openPositions=open_n, pendingExit=pend_n, equityLast=equity, days=len(calendar))
    out['mdd'] = mdd if (taken and missing == 0) else None
    out['mddApprox'] = mdd if taken else None
    if keep_curve:
        out['curve'] = curve
    return out
