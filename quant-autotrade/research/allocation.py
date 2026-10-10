# -*- coding: utf-8 -*-
"""자금 배분·재투입 규칙 (2026-10-11, 연구용 순수 함수 - 주문 기능 없음).

모의 계좌·백테스트가 같은 규칙을 쓰도록 한곳에 둔다. 규칙(사용자 정정 지시):
 1. 매도 **체결이 확인된** 대금만 현금으로 본다. 미체결 매도(PENDING_EXIT 등)의 예상 대금은 현금이 아니다.
 2. OPEN·PENDING_EXIT 포지션은 매도 체결 전까지 동시 보유 수·투자 한도를 점유한다.
 3. 한도: 동시 최대 5종목, 종목당 10%, 전체 투자 30%(계좌 평가금액 기준, 투자액은 매입 금액 기준).
 4. 증권사가 알려 준 실제 주문가능금액(broker_cash)이 있으면 그것을 넘는 매수는 허용하지 않는다.
 5. 청산 뒤 다음 거래일까지 기다려야 한다는 의무 규칙은 없다. 당일 재투입이 가능한지는 '매도가 매수보다 먼저 체결됐다는 것을 알 수 있는가'로만 정한다(account_sim.py).
"""

LIMITS = {'per_pos': 0.10, 'total_cap': 0.30, 'max_pos': 5, 'min_order': 0.01}


def entry_size(equity, cash, invested, n_positions, held_codes, code, limits=None, broker_cash=None):
    """신규 매수 금액(계좌 평가금액 1.0 기준 비율)과 거절 사유. 반환 (size, reason) - 허용이면 reason=None.

    equity      직전 종가 기준 계좌 평가금액
    cash        체결이 확인된 현금(미체결 매도 대금 제외)
    invested    보유 포지션의 매입 금액 합(OPEN·PENDING_EXIT 포함)
    n_positions 보유 포지션 수(OPEN·PENDING_EXIT 포함)
    broker_cash 증권사 실제 주문가능금액(없으면 None = 모의 계산)
    """
    lim = limits or LIMITS
    if code in held_codes:
        return 0.0, 'DUP'
    if n_positions >= lim['max_pos']:
        return 0.0, 'MAX_POS'
    size = min(lim['per_pos'] * equity, cash, lim['total_cap'] * equity - invested)
    if broker_cash is not None and broker_cash < size:
        if broker_cash < lim['min_order'] * equity:
            return 0.0, 'BROKER_CASH'
        size = broker_cash
    if size < lim['min_order'] * equity:
        return 0.0, 'CASH_OR_CAP'
    return size, None
