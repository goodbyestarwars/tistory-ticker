# -*- coding: utf-8 -*-
"""동적 자금 배분(dynamic-v1) - 순수 함수. 주문·네트워크·파일 접근 없음. (2026-10-15 설계, 실계좌 미적용)

기존 고정 정책(최대 3종목 · 종목당 30만원 · 현금 10만원 유지)을 후보 품질·변동성·유동성·손실 위험에 따른 금액 산정으로 바꾼다.
손절·익절(순손익 -5% / +6% / +3% 도달 후 이탈)은 바꾸지 않는다 - 여기서는 '얼마나 살지'만 정한다.

원칙
- 총 운용금(TOTAL_BUDGET)과 실제 주문 가능 현금을 넘지 않는다. 수수료 여유를 먼저 뺀다. 신용·미수는 쓰지 않는다(현금 조회값 중 가장 작은 값을 쓴다).
- 종목 수는 고정하지 않는다. 거래당 위험(손절까지 갔을 때 손실)과 전체 위험 상한, 종목당 비중 상한, 유동성 상한이 금액을 정한다.
- 후보 품질이 기준(MIN_QUALITY) 미만이면 사지 않는다. 품질이 높을수록 위험 허용치와 비중이 커진다(최고 품질 단독 후보만 100% 집중 가능).
- 품질이 HIGH_QUALITY 미만인 신규 진입은 목표 금액의 절반만 먼저 사고(분할), 정상 체결 뒤 가격 조건이 맞으면 나머지를 추가 매수한다.
"""
import math

POLICY_VERSION = 'dynamic-v1'

TOTAL_BUDGET = 1_000_000          # 총 운용금 한도(원)
FEE_BUFFER_PCT = 0.15             # 매수 수수료 여유 - 실제 수수료 확인 전까지의 보수적 가정
STOP_PCT = 5.0                    # 기존 손절 기준(순손익 -5%)
STOP_VOL_MULT = 1.5               # 변동성이 크면 손절 전에 갭으로 더 잃을 수 있어 위험 단가를 키운다

MIN_QUALITY = 50.0                # 이 미만이면 매수하지 않음
HIGH_QUALITY = 80.0               # 이 이상이면 한 번에 매수·단독 후보 100% 집중 가능
RISK_PCT_AT_MIN = 1.5             # 품질 MIN일 때 거래당 허용 손실(총 운용금 대비 %, 손절 도달 시)
RISK_PCT_AT_MAX = 5.0             # 품질 100일 때
MAX_PORTFOLIO_RISK_PCT = 5.0      # 전체 보유가 모두 손절될 때 허용 손실(총 운용금 대비 %)
MAX_POSITION_PCT = 60.0           # 종목당 비중 상한(총 운용금 대비 %)
MAX_POSITION_PCT_TOP = 100.0      # 품질 HIGH 이상의 '단독' 후보에만 허용되는 상한
MIN_ORDER_KRW = 50_000            # 너무 작은 주문은 내지 않음
LIQUIDITY_PCT = 0.5               # 20일 평균 거래대금 대비 한 종목 보유 상한(%)
FIRST_TRANCHE = 0.5               # 분할 진입 첫 비율
MAX_BUYS_PER_CODE_PER_DAY = 2     # 같은 종목 하루 최대 매수 주문 횟수(첫 진입 + 추가 1회)
ADD_MAX_PREMIUM_PCT = 1.0         # 추가 매수는 직전 매수가 +1% 이내에서만(추격 금지)
ADD_MAX_DISCOUNT_PCT = 2.0        # 직전 매수가 -2%보다 아래면 추가하지 않음(손절 접근 중)
MAX_CONSIDER = 4                  # 비중 배분에서 함께 비교하는 신규 후보 수


def clamp(value, low, high):
    return max(low, min(high, value))


def quality_score(avg_value, last_value, volatility, trend):
    """0~100 품질 점수. 하드 필터(거래대금 10억·변동성 1~8%·추세 양수)는 엔진의 기존 rank_candidates와 같고, 그 안에서 점수로 가른다.

    유동성 25(20일 평균 거래대금 10억 → 0, 100억 이상 → 100) · 거래대금 증가 15(당일 거래대금/평균 0.5배 → 0, 2배 이상 → 100)
    변동성 30(일중 변동폭 3.5% 근처가 최고, 벗어날수록 감점) · 추세 30(20일 평균 대비 0% → 0, +10% 이상 → 100)
    """
    liquidity = clamp(math.log10(max(avg_value, 1.0) / 1e9) * 100.0, 0.0, 100.0)
    surge = clamp((last_value / avg_value - 0.5) / 1.5 * 100.0, 0.0, 100.0) if avg_value > 0 else 0.0
    vol = clamp((1.0 - abs(volatility - 0.035) / 0.035) * 100.0, 0.0, 100.0)
    trend_score = clamp(trend / 0.10 * 100.0, 0.0, 100.0)
    score = 0.25 * liquidity + 0.15 * surge + 0.30 * vol + 0.30 * trend_score
    return round(score, 1), {'liquidity': round(liquidity, 1), 'surge': round(surge, 1), 'volatility': round(vol, 1), 'trend': round(trend_score, 1)}


def effective_stop(volatility):
    """손절선까지 갔을 때의 예상 손실률. 변동성이 크면 5%보다 크게 본다."""
    return max(STOP_PCT / 100.0, STOP_VOL_MULT * volatility)


def risk_pct(quality):
    """품질에 따른 거래당 허용 손실(%): 50점 1.5% → 100점 5.0% 선형."""
    t = clamp((quality - MIN_QUALITY) / (100.0 - MIN_QUALITY), 0.0, 1.0)
    return RISK_PCT_AT_MIN + (RISK_PCT_AT_MAX - RISK_PCT_AT_MIN) * t


def conviction(quality):
    """품질에 따른 투입 비율(0.4~1.0): 최소 품질이면 몫의 40%만, 최고 품질이면 몫 전부."""
    return clamp(0.4 + 0.6 * (quality - MIN_QUALITY) / (100.0 - MIN_QUALITY), 0.4, 1.0)


def usable_cash(snapshot):
    """실제 현금 범위(신용·미수 제외)로 쓸 금액: 조회된 값 중 가장 작은 값. 없으면 None(= 주문하지 않음).

    snapshot 예: {'ord_alow': 주문가능금액, 'ord_alow_100': 증거금 100% 주문가능금액, 'entr': 예수금}
    예수금(entr)에는 아직 결제되지 않은 매도대금이 섞일 수 있고 주문가능금액은 증거금률에 따라 신용·미수 한도를 포함할 수 있어,
    셋 중 가장 작은 값을 보수적으로 쓴다.
    """
    values = [int(v) for v in (snapshot or {}).values() if isinstance(v, (int, float)) and v >= 0]
    return min(values) if values else None


def plan_buy(cand, price, *, budget_room, cash_usable, portfolio_risk_used, held_notional=0.0, buys_today=0,
             peers_quality_sum=None, unique_top=False, first_buy_price=None):
    """한 후보에 대한 매수 수량·금액과 산정 근거. 매수하지 않으면 qty=0과 사유(reject)를 돌려준다.

    cand: {'code','quality','volatility','avg_value'}
    budget_room: 총 운용금 - (엔진 보유 원가 + 미체결 매수 금액)
    cash_usable: usable_cash() 결과(원). portfolio_risk_used: 현재 보유 전체의 손절 시 예상 손실(원).
    held_notional: 이 종목의 현재 보유 원가(추가 매수일 때 > 0). peers_quality_sum: 신규 후보 비교군(자기 포함)의 품질 합.
    """
    q = float(cand['quality'])
    out = {'code': cand['code'], 'quality': q, 'price': price, 'qty': 0, 'notional': 0.0, 'cost_with_fee': 0.0, 'reject': None,
           'binding': None, 'tranche': None, 'limits': {}, 'share': None, 'conviction': None, 'policy': POLICY_VERSION}
    if q < MIN_QUALITY:
        out['reject'] = 'LOW_QUALITY'
        return out
    if buys_today >= MAX_BUYS_PER_CODE_PER_DAY:
        out['reject'] = 'MAX_BUYS_PER_CODE'
        return out
    if held_notional > 0:
        if not first_buy_price or first_buy_price <= 0:
            out['reject'] = 'ADD_NO_REFERENCE_PRICE'
            return out
        move = (price / first_buy_price - 1.0) * 100.0
        if move > ADD_MAX_PREMIUM_PCT or move < -ADD_MAX_DISCOUNT_PCT:
            out['reject'] = 'ADD_PRICE_OUT_OF_RANGE'
            out['limits']['add_move_pct'] = round(move, 2)
            return out
    if cash_usable is None:
        out['reject'] = 'CASH_UNKNOWN'
        return out

    stop = effective_stop(float(cand['volatility']))
    pool = max(0.0, budget_room) + held_notional                  # 이 종목에 처음부터 배분한다면 쓸 수 있는 예산
    share = (q / peers_quality_sum) if peers_quality_sum else 1.0        # 추가 매수도 아직 사지 못한 다른 후보와 몫을 나눈다(한 종목만 계속 키우지 않음)
    conv = conviction(q)
    pos_pct = MAX_POSITION_PCT_TOP if (unique_top and q >= HIGH_QUALITY) else MAX_POSITION_PCT
    limits = {
        'allocation': pool * share * conv,                           # 품질 비례 몫 × 투입 비율
        'risk': risk_pct(q) / 100.0 * TOTAL_BUDGET / stop,           # 거래당 허용 손실 / 손절 시 손실률
        'position_cap': TOTAL_BUDGET * pos_pct / 100.0,
        'liquidity': LIQUIDITY_PCT / 100.0 * float(cand['avg_value']),
        'portfolio_risk': held_notional + max(0.0, MAX_PORTFOLIO_RISK_PCT / 100.0 * TOTAL_BUDGET - portfolio_risk_used) / stop,
    }
    binding = min(limits, key=limits.get)
    target = limits[binding]
    order = target - held_notional
    tranche = 'full'
    if held_notional > 0:
        tranche = 'add'
    elif q < HIGH_QUALITY:
        order = min(order, target * FIRST_TRANCHE)
        tranche = 'first'
    caps = {'budget_room': max(0.0, budget_room), 'cash': cash_usable / (1.0 + FEE_BUFFER_PCT / 100.0)}
    for name, value in caps.items():
        if value < order:
            order, binding = value, name
    qty = int(max(0.0, order) // price) if price > 0 else 0
    while qty > 0 and qty * price * (1.0 + FEE_BUFFER_PCT / 100.0) > cash_usable:       # 수수료 포함해도 현금을 넘지 않게
        qty -= 1
    out.update({'limits': {k: round(v) for k, v in {**limits, **caps}.items()}, 'share': round(share, 3), 'conviction': round(conv, 3),
                'binding': binding, 'tranche': tranche, 'eff_stop_pct': round(stop * 100, 2), 'target': round(target)})
    if qty * price < MIN_ORDER_KRW:
        out['reject'] = 'BELOW_MIN_ORDER'
        return out
    out.update({'qty': qty, 'notional': float(qty * price), 'cost_with_fee': round(qty * price * (1.0 + FEE_BUFFER_PCT / 100.0), 2)})
    return out
