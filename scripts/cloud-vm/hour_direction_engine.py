# -*- coding: utf-8 -*-
"""Unfitted, symmetric direction hypotheses from a manually captured snapshot.

The labels describe a rule hypothesis for the following 60 minutes, not a fitted
probability or a promise of a 3% move. Candidate rejection is never a down label.
"""
from datetime import timedelta
import math
import hour_candidate_engine as candidate

MODEL_VERSION = 'hour-direction-rules-v4'
LOOKBACK_MINUTES = 30
LABELS = {'up': '상승가능', 'down': '하락가능', 'unclear': '판단 어려움'}


def movement_budget(bars, entry, target, stop):
    """Uncalibrated 60-minute sensitivity screen, NOT a forecast/probability.

    Fit log-price slope to the last <=10 CLOSED minutes. Combine its signed
    60-minute continuation with one sqrt-time-scaled return standard deviation.
    This assumes local pace/volatility persists; it is only a rejection screen.
    Targets include the gap from the last closed price to the executable basis.
    """
    window = bars[-10:]
    prices = [math.log(row['close']) for row in window]
    n = len(prices)
    center = (n - 1) / 2
    mean = sum(prices) / n
    slope = sum((i-center)*(price-mean) for i, price in enumerate(prices)) / sum((i-center)**2 for i in range(n))
    returns = [prices[i]-prices[i-1] for i in range(1, n)]
    average = sum(returns) / len(returns)
    variance = sum((r-average)**2 for r in returns) / (len(returns)-1)
    noise = math.sqrt(variance * 60)
    up_budget = max(0.0, slope * 60) + noise
    down_budget = max(0.0, -slope * 60) + noise
    up_need = math.log(target / window[-1]['close'])
    down_need = math.log(window[-1]['close'] / stop)
    return {'movementWindowBars': n, 'movementSlopeLogPerMinute': slope,
            'movementNoise60Log': noise, 'upMovementBudgetPct': math.expm1(up_budget)*100,
            'downMovementBudgetPct': (1-math.exp(-down_budget))*100,
            'upRequiredMovePct': math.expm1(up_need)*100,
            'downRequiredMovePct': (1-math.exp(-down_need))*100,
            'upMovementSupported': up_budget >= up_need,
            'downMovementSupported': down_budget >= down_need,
            'movementBudgetValidated': False}


def outside_reason(checked):
    if checked is None:
        return '확인 시각을 알 수 없어.'
    if checked.weekday() >= 5 or (checked.hour, checked.minute) >= (15, 30):
        return '지금은 정규장이 닫혀 있어.'
    if (checked.hour, checked.minute) >= (14, 30):
        return '장 마감까지 1시간이 남지 않았어.'
    return '거래일 09:05 이후에 다시 확인해줘.'


def brief_reason(reason):
    for text, short in [
        ('10초', '최신 호가·체결을 확인하지 못했어.'),
        ('최신 시각', '최신 시세를 확인하지 못했어.'),
        ('한 번에 크게', '한 번에 크게 움직여 판단을 보류해.'),
        ('이미 설정한 상승폭', '이미 크게 오른 종목이야.'),
        ('일시 정지', '거래가 멈췄거나 정지 여부를 확인하지 못했어.'),
        ('상한가', '상한가 때문에 목표 범위를 확인할 수 없어.'),
        ('호가 간격', '매수·매도 가격 차이가 너무 커.'),
        ('전일 거래량', '최근 거래량이 전일 대비 부족해.'),
        ('충분히 늘지', '최근 거래량이 충분히 늘지 않았어.'),
        ('1분봉', '최근 분봉 자료가 부족해.'),
        ('체결강도', '체결강도 자료가 부족해.'),
        ('자료', '판단에 필요한 최신 자료가 부족해.'),
    ]:
        if text in reason:
            return short
    return reason


def unclear(code, name, checked_at, reason):
    checked = candidate._iso(checked_at)
    return {
        'code': code, 'name': name or code, 'direction': 'unclear',
        'label': LABELS['unclear'], 'reason': reason,
        'checkedAt': checked.isoformat() if checked else None,
        'expiresAt': (checked + timedelta(minutes=60)).isoformat() if checked else None,
        'horizonMinutes': 60, 'targetPct': 3, 'stopPct': -3,
        'entryPrice': None, 'targetPrice': None, 'stopPrice': None,
        'probability': None, 'validated': False, 'rulesVersion': MODEL_VERSION,
        'metrics': {},
    }


def evaluate_direction(snapshot, candidate_result=None):
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    base = candidate_result if candidate_result is not None else candidate.evaluate(snapshot, lookback_minutes=LOOKBACK_MINUTES)
    result = unclear(snapshot.get('code'), snapshot.get('name'), snapshot.get('checkedAt'),
                     '가격·체결·거래량의 방향이 서로 맞지 않아.')
    checked = candidate._iso(snapshot.get('checkedAt'))
    if checked is None or not (9, 5) <= (checked.hour, checked.minute) < (14, 30):
        result['reason'] = outside_reason(checked)
        return result
    # Missing evidence may coexist with a known rejection. Never infer direction
    # from status or hide a data issue behind the candidate's exclusion priority.
    issues = base.get('inputIssues')
    blockers = base.get('commonBlockers')
    if issues is None or blockers is None:
        result['reason'] = '방향 판단에 필요한 자료 검증 결과가 없습니다.'
        return result
    # Volume participation is context, not a prerequisite for either direction.
    # In particular, falling prices do not require increasing traded volume.
    blockers = [reason for reason in blockers if '최근 2분 거래량' not in reason]
    if issues or blockers:
        result['reason'] = brief_reason((issues or blockers)[0])
        return result
    bars, error = candidate._closed_bars(snapshot.get('bars'), checked, LOOKBACK_MINUTES)
    if error:
        result['reason'] = error
        return result
    metrics = base['metrics']
    high_pivots = [i for i in range(1, len(bars) - 1)
                   if bars[i]['high'] > bars[i - 1]['high']
                   and bars[i]['high'] > bars[i + 1]['high']]
    falling = bars[-3]['high'] > bars[-2]['high'] > bars[-1]['high']
    falling_pivots = (len(high_pivots) >= 2
                      and bars[high_pivots[-2]]['high'] > bars[high_pivots[-1]]['high'])
    rising = metrics['risingRecentLows'] or metrics['risingConfirmedPivotLows']
    bearish_pattern = falling or falling_pivots
    # A large downward jump is also unsuitable for a conservative direction
    # hypothesis; do not label an already completed crash as a new forecast.
    drops = [(1 - row['low'] / row['open']) * 100 for row in bars]
    drops += [(1 - bars[i]['open'] / bars[i - 1]['close']) * 100 for i in range(1, len(bars))]
    result['metrics'] = dict(metrics, fallingRecentHighs=falling,
                             fallingConfirmedPivotHighs=falling_pivots,
                             maxMinuteDropPct=max(drops))
    if max(drops) >= candidate.DEFAULT_SETTINGS['maxMinuteJumpPct'] - 1e-9:
        result['reason'] = '한 번에 크게 하락한 구간이 있어 판단을 보류합니다.'
        return result
    if rising and bearish_pattern:
        result['reason'] = '저점 상승과 고점 하락이 함께 나타나 방향이 불명확해.'
        return result
    opening = bars[-5]['open']
    result['metrics']['directionPriceBasis'] = '최근 5개 완결 분봉 시작 가격'
    trade_price = candidate._num(snapshot['trade'].get('price'), strict=True)
    closing, vwap, strength = bars[-1]['close'], metrics['barTypicalPriceVwap'], metrics['strength']
    bids = candidate._book_levels(snapshot['book']['bids'])
    recent_volume = metrics['recent2MinuteVolume']
    entry, stop = base['entryPrice'], base['stopPrice']
    sell_burden = metrics['visibleResistanceToRecentVolume']
    buy_burden = sum(row['qty'] for row in bids if stop <= row['price'] <= entry) / recent_volume
    result['metrics']['visibleSupportToRecentVolume'] = buy_burden
    # Price direction + VWAP agreement remain required. Pattern OR executed
    # buying/selling pressure confirms it; visible walls only annotate context.
    up = (closing > opening and closing >= vwap and trade_price >= closing * 0.998
          and (rising or strength >= 105))
    down = (closing < opening and closing <= vwap and trade_price <= closing * 1.002
            and (bearish_pattern or strength <= 95))
    movement = movement_budget(bars, entry, base['targetPrice'], stop)
    result['metrics'].update(movement)
    if up and not movement['upMovementSupported']:
        result['reason'] = '작은 반등은 있지만 1시간 +3% 움직임 근거가 부족해.'
        return result
    if down and not movement['downMovementSupported']:
        result['reason'] = '약한 하락이지만 1시간 −3% 움직임 근거가 부족해.'
        return result
    if up:
        result.update(direction='up', label=LABELS['up'])
    elif down:
        result.update(direction='down', label=LABELS['down'])
    if result['direction'] != 'unclear':
        wall = sell_burden if up else buy_burden
        weak_volume = metrics['volumeAcceleration'] < 1.3 or metrics['recentPrevVolumePct'] < 1
        pattern = rising if up else bearish_pattern
        result['reason'] = ('최근 가격 상승과 ' if up else '최근 가격 하락과 ') + (
            ('저점 상승' if up else '고점 하락') if pattern else ('매수 체결 우위' if up else '매도 체결 우위')) + ' 흐름이 맞아.'
        if weak_volume:
            result['reason'] += ' 거래량은 약해.'
        elif wall > 1:
            result['reason'] += ' 앞쪽 잔량은 부담돼.'
        result.update(entryPrice=entry, targetPrice=base['targetPrice'], stopPrice=stop)
    return result
