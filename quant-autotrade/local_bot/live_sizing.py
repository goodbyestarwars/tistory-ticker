# -*- coding: utf-8 -*-
"""실계좌 신규 매수 수량: 슬롯형 + 위험한도 (2026-11-07 사용자 선택 "슬롯형 + 위험한도").

research/allocation.py(모의 계좌 비율 한도)와 다른 모듈이다. 연구·모의 규칙을 실계좌에 섞지 않는다.

순수 계산만 한다. 주문·장부·승인 판정은 호출부(live_engine.trade_once, ninepay_trade)가 소유한다.
기본 설정(risk_pct=None, carry=False, slots=None)은 2026-10-22 규칙과 같은 수량을 낸다:
  종목 수 = 예산 100만 원 단위 올림, 종목당 상한 = (예산-유보)//종목 수,
  수량 = min(종목상한, 주문가능현금-유보, 예산-유보-기점유금) // 현재가.

위험한도를 켜면 "이 종목이 손절선까지 밀렸을 때 계좌가 잃는 금액"을 예산의 risk_pct%로 묶는다.
예상 불리 변동폭 = max(비상 손절폭, 최근 20봉 평균 일중 고저폭). 고저폭을 모르면 보수값(unknown_range_pct)을
쓴다(결측을 0이나 낙관값으로 바꾸지 않는다). 그래서 같은 슬롯이라도 흔들림이 큰 종목은 적게 산다.
"""

AUTO_SLOT_UNIT = 1_000_000          # 2026-10-22 사용자 규칙: 100만 원마다 1종목
DEFAULT_RISK_FLOOR_PCT = 5.0        # 비상 손절폭(live_engine.EMERGENCY_STOP_PCT)과 같은 값
DEFAULT_UNKNOWN_RANGE_PCT = 8.0     # 기존 후보 변동성 상한(8%) - 모르는 종목은 가장 거친 쪽으로 본다
MAX_SLOTS = 10
MAX_RISK_PCT = 10.0


def plan(budget, reserve, slots=None, risk_pct=None, carry=False,
         risk_floor_pct=DEFAULT_RISK_FLOOR_PCT, unknown_range_pct=DEFAULT_UNKNOWN_RANGE_PCT):
    """설정값을 검증해 배분 계획(dict)을 만든다. 잘못된 값은 ValueError - 호출부는 주문하지 않는다."""
    budget, reserve = int(budget), int(reserve)
    if budget <= 0 or reserve < 0 or reserve >= budget:
        raise ValueError('BAD_BUDGET')
    auto = slots is None
    slots = -(-budget // AUTO_SLOT_UNIT) if auto else int(slots)
    if not 1 <= slots <= MAX_SLOTS:
        raise ValueError('BAD_SLOTS')
    if risk_pct is not None:
        risk_pct = float(risk_pct)
        if not 0 < risk_pct <= MAX_RISK_PCT:
            raise ValueError('BAD_RISK_PCT')
    if not 0 < float(risk_floor_pct) <= float(unknown_range_pct) <= 50:
        raise ValueError('BAD_RANGE_PCT')
    return {
        'budget': budget, 'reserve': reserve, 'slots': slots, 'slots_auto': auto,
        'per_stock': (budget - reserve) // slots,
        'risk_pct': risk_pct, 'risk_won': int(budget * risk_pct / 100) if risk_pct else None,
        'carry': bool(carry), 'risk_floor_pct': float(risk_floor_pct), 'unknown_range_pct': float(unknown_range_pct),
    }


def from_policy(mod):
    """엔진 모듈(또는 같은 상수를 가진 객체)의 호출 시점 값으로 계획을 만든다.

    BUDGET·RESERVE·PER_STOCK·MAX_STOCKS는 기존 계약 그대로(MAX_STOCKS=None은 종목 수 무제한) 읽고,
    위험한도·이월 값이 없는 구버전 정책은 끈 것으로 본다.
    """
    risk = getattr(mod, 'RISK_PCT', None)
    return {
        'budget': int(mod.BUDGET), 'reserve': int(mod.RESERVE), 'per_stock': int(mod.PER_STOCK),
        'slots': None if mod.MAX_STOCKS is None else int(mod.MAX_STOCKS),
        'risk_pct': float(risk) if risk else None,
        'risk_won': int(int(mod.BUDGET) * float(risk) / 100) if risk else None,
        'carry': bool(getattr(mod, 'CARRY', False)),
        'risk_floor_pct': float(getattr(mod, 'EMERGENCY_STOP_PCT', DEFAULT_RISK_FLOOR_PCT)),
        'unknown_range_pct': DEFAULT_UNKNOWN_RANGE_PCT,
    }


def avg_range_pct(bars, n=20):
    """최근 n개 확정 일봉의 평균 (고가-저가)/종가 %. 봉이 모자라거나 값이 이상하면 None."""
    recent = list(bars or [])[-n:]
    if len(recent) < n:
        return None
    out = []
    for b in recent:
        try:
            high, low, close = float(b['high']), float(b['low']), float(b['close'])
        except (KeyError, TypeError, ValueError):
            return None
        if close <= 0 or high < low:
            return None
        out.append((high - low) / close * 100)
    return sum(out) / n


def size_entry(p, price, cash, committed, slots_used, range_pct=None):
    """신규 1종목 수량. 반환 dict: qty(0이면 매수 안 함), reason(qty=0일 때), limit(묶인 한도), 계산 근거."""
    price = int(price)
    remaining = p['budget'] - p['reserve'] - int(committed)
    # slots=None은 종목 수 제한 없음(기존 MAX_STOCKS=None 계약). 이월은 남은 슬롯이 정해질 때만 쓴다.
    left = None if p['slots'] is None else p['slots'] - int(slots_used)
    out = {'qty': 0, 'reason': None, 'limit': None, 'price': price, 'slot_cap': None, 'risk_cap': None,
           'move_pct': None, 'range_pct': range_pct, 'worst_loss': None}
    if left is not None and left <= 0:
        out['reason'] = 'SLOTS_FULL'
        return out
    if price <= 0:
        out['reason'] = 'BAD_PRICE'
        return out
    slot_cap = remaining // left if p['carry'] and left else p['per_stock']
    caps = {'slot': slot_cap, 'cash': int(cash) - p['reserve'], 'budget': remaining}
    out['slot_cap'] = slot_cap
    if p['risk_pct']:
        known = range_pct is not None and range_pct > 0
        move = max(p['risk_floor_pct'], float(range_pct) if known else p['unknown_range_pct'])
        caps['risk'] = int(p['risk_won'] * 100 / move)
        out['risk_cap'], out['move_pct'] = caps['risk'], move
    limit = min(caps, key=lambda k: caps[k])
    money = caps[limit]
    out['limit'] = limit
    qty = max(money, 0) // price
    if qty < 1:
        out['reason'] = 'ONE_SHARE_OVER_LIMIT'
        return out
    out['qty'] = qty
    out['worst_loss'] = int(qty * price * (out['move_pct'] or p['risk_floor_pct']) / 100)
    return out
