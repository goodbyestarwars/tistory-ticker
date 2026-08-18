# -*- coding: utf-8 -*-
"""국내 4주 스윙 추천의 단일 판정 모델.

별점/합산점수는 과거 결과와의 비교를 위해 계산할 수 있지만 최종 행동을
결정하지 않는다. 차트 국면이 먼저 진입 가능성을 걸러내고, 모멘텀과
펀더멘털은 같은 국면 안에서 우선순위를 조정하며, 위험은 평균 점수가 아닌
주의/진입차단 필터로 처리한다.

입력 daily는 오래된 날짜부터 최신 날짜 순서의 OHLC 행이다.
"4주"는 신호일의 종가를 기준으로 T+5/T+10/T+20을 추적하는 운영 기간이다.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional


MODEL_VERSION = 'swing-4w-v5'
REGIME_LABELS = {
    'uptrend': '상승 지속',
    'upturn': '상방 변곡',
    'neutral': '횡보·판단 보류',
    'downturn': '하방 변곡',
    'downtrend': '하락 지속',
}
CURRENT_REGIME_LABELS = {
    'uptrend': '상승 추세',
    'neutral': '횡보·수렴',
    'downtrend': '하락 추세',
}
EVENT_LABELS = {
    'none': '이벤트 없음',
    'upturn_detected': '상방 변곡 감지',
    'upturn_confirmed': '상방 변곡 확정',
    'uptrend_resume': '상승 추세 재개',
    'downturn_detected': '하방 변곡 감지',
    'downturn_confirmed': '하방 변곡 확정',
    'downtrend_resume': '하락 추세 재개',
    'breakout': '상단 돌파',
    'breakdown': '하단 이탈',
    'compression': '수렴·압축',
    'overheated': '과열·소진',
    'fake_breakout': '페이크 돌파',
    'fake_breakdown': '페이크 이탈',
    'exhaustion': '하락 소진 감지',
    'ma5_recovery': '5일선 회복',
    'ma20_breakout': '20일선 돌파',
}
WAVE_LABELS = {
    'uptrend': '상승 추세',
    'downtrend': '하락 추세',
    'neutral': '횡보·수렴',
    'insufficient': '데이터 부족',
}


def _number(value: Any) -> Optional[float]:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if value == value else None


def _close(row: Dict[str, Any]) -> Optional[float]:
    return _number(row.get('close'))


def _moving_average(values: List[Optional[float]], period: int) -> List[Optional[float]]:
    result: List[Optional[float]] = []
    for index in range(len(values)):
        window = [v for v in values[max(0, index - period + 1):index + 1] if v is not None]
        result.append(sum(window) / period if len(window) == period else None)
    return result


def _slope(values: List[Optional[float]], lookback: int) -> Optional[float]:
    if len(values) <= lookback:
        return None
    now = values[-1]
    before = values[-1 - lookback]
    if now is None or before in (None, 0):
        return None
    return (now - before) / abs(before)


def _slope_at(values: List[Optional[float]], end: int, lookback: int) -> Optional[float]:
    """Return a moving-average slope ending at an earlier index."""
    if end < lookback or end >= len(values):
        return None
    now = values[end]
    before = values[end - lookback]
    if now is None or before in (None, 0):
        return None
    return (now - before) / abs(before)


def _crossed_above_ma(closes: List[float], ma_values: List[Optional[float]]) -> bool:
    """Return whether the latest daily close crossed above its moving average."""
    if len(closes) < 2 or len(ma_values) < 2:
        return False
    previous_ma, current_ma = ma_values[-2], ma_values[-1]
    return bool(
        previous_ma is not None and current_ma is not None
        and closes[-2] < previous_ma and closes[-1] >= current_ma
    )


def _has_higher_low(closes: List[float]) -> bool:
    if len(closes) < 12:
        return False
    previous = min(closes[-12:-5])
    latest = min(closes[-5:])
    return latest > previous * 1.005


def _has_lower_high(closes: List[float]) -> bool:
    if len(closes) < 12:
        return False
    previous = max(closes[-12:-5])
    latest = max(closes[-5:])
    return latest < previous * 0.995


def _relative_strength(closes: List[float], benchmark: Optional[Iterable[Any]]) -> Optional[float]:
    if not benchmark:
        return None
    benchmark_values = []
    for item in benchmark:
        value = _number(item.get('close') if isinstance(item, dict) else item)
        if value is not None:
            benchmark_values.append(value)
    if len(closes) < 21 or len(benchmark_values) < 21:
        return None
    asset_return = closes[-1] / closes[-21] - 1 if closes[-21] else None
    market_return = benchmark_values[-1] / benchmark_values[-21] - 1 if benchmark_values[-21] else None
    if asset_return is None or market_return is None:
        return None
    return (asset_return - market_return) * 100


def _event(key: str, stage: str = 'none') -> Dict[str, str]:
    return {'key': key, 'label': EVENT_LABELS[key], 'stage': stage}


def _ma_recovery_event(closes: List[float], period: int = 5) -> Dict[str, str]:
    """Return a confirmed signal when the latest close recovers its MA.

    This is deliberately a daily-close signal.  It does not claim that the
    whole trend has turned; it only records the short-term recovery that can
    be checked consistently in the batch scan and the detail page.
    """
    if len(closes) < period + 1:
        return _event('none')
    previous_ma = sum(closes[-period - 1:-1]) / period
    current_ma = sum(closes[-period:]) / period
    if closes[-2] < previous_ma and closes[-1] >= current_ma:
        return _event('ma5_recovery' if period == 5 else 'none', 'confirmed')
    return _event('none')


def _range_break_state(closes: List[float]) -> Optional[str]:
    """최근 1~2개 봉이 기준 범위에 다시 들어왔는지 확인한다.

    한 봉의 고가/저가만으로 페이크를 만들지 않도록, 기준 범위를 벗어난
    봉 뒤에 최소 한 봉이 다시 범위 안으로 복귀한 경우만 판정한다.
    """
    if len(closes) < 24:
        return None
    reference = closes[-23:-3]
    if not reference:
        return None
    high, low = max(reference), min(reference)
    probe = closes[-3]
    latest = closes[-1]
    if probe > high * 1.01 and latest <= high * 1.01:
        return 'fake_breakout'
    if probe < low * 0.99 and latest >= low * 0.99:
        return 'fake_breakdown'
    return None


def _breakout_state(closes: List[float]) -> Optional[str]:
    if len(closes) < 22:
        return None
    reference = closes[-21:-1]
    high, low = max(reference), min(reference)
    previous = closes[-2]
    latest = closes[-1]
    if latest > high * 1.01 and previous <= high * 1.01:
        return 'breakout'
    if latest < low * 0.99 and previous >= low * 0.99:
        return 'breakdown'
    return None


def _compression_state(closes: List[float]) -> bool:
    if len(closes) < 30:
        return False
    recent = closes[-10:]
    prior = closes[-30:-10]
    recent_range = (max(recent) - min(recent)) / max(min(recent), 1e-9)
    prior_range = (max(prior) - min(prior)) / max(min(prior), 1e-9)
    return prior_range > 0 and recent_range / prior_range < 0.6


def classify_chart_regime(daily: List[Dict[str, Any]], benchmark: Optional[Iterable[Any]] = None) -> Dict[str, Any]:
    """Return an action-compatible regime plus separate current/event states.

    ``key`` and ``turningPoint`` remain for old callers. New consumers should
    use ``currentRegime`` and ``recentEvent``. The 224-day average is retained
    as context and never participates in the four-week action gate.
    """
    closes = [_close(row) for row in daily or []]
    closes = [value for value in closes if value is not None and value > 0]
    if len(closes) < 60:
        current = {'key': 'neutral', 'label': CURRENT_REGIME_LABELS['neutral']}
        return {
            'key': 'neutral', 'label': REGIME_LABELS['neutral'], 'confidence': 'low',
            'turningPoint': 'unknown', 'reasons': ['5·20·60일선 계산에 필요한 일봉이 부족합니다.'],
            'invalidation': '일봉 데이터 60개 이상 확보 후 재판정', 'ma': {},
            'relativeStrength': None, 'currentRegime': current,
            'recentEvent': _event('none'), 'mainEvent': _event('none'),
            'auxiliaryStates': [],
        }

    ma5 = _moving_average(closes, 5)
    ma20 = _moving_average(closes, 20)
    ma60 = _moving_average(closes, 60)
    ma224 = _moving_average(closes, 224)
    now = closes[-1]
    m5, m20, m60, m224 = ma5[-1], ma20[-1], ma60[-1], ma224[-1]
    slope20 = _slope(ma20, 5) or 0
    slope60 = _slope(ma60, 10) or 0
    short_slope = _slope(ma5, 3) or 0
    higher_low = _has_higher_low(closes)
    lower_high = _has_lower_high(closes)
    prior_high = max(closes[-15:-5]) if len(closes) >= 15 else max(closes[:-5])
    prior_low = min(closes[-15:-5]) if len(closes) >= 15 else min(closes[:-5])
    rebound = now / prior_low - 1 if prior_low else 0
    retreat = now / prior_high - 1 if prior_high else 0
    rs = _relative_strength(closes, benchmark)

    up_confirmed = bool(m5 and m20 and m60 and now >= m20 and m5 >= m20 and m20 >= m60
                        and slope20 >= 0.002 and slope60 >= -0.001)
    down_confirmed = bool(m5 and m20 and m60 and now <= m20 and m5 <= m20 and m20 <= m60
                          and slope20 <= -0.002 and slope60 <= 0.001)

    up_signals = [rebound >= 0.03, short_slope > 0.002, higher_low, bool(m20 and now >= m20)]
    down_signals = [retreat <= -0.03, short_slope < -0.002, lower_high, bool(m20 and now <= m20)]
    up_detected = sum(up_signals) >= 2
    down_detected = sum(down_signals) >= 2

    if up_confirmed:
        key, turn = 'uptrend', 'confirmed'
        confidence = 'high'
    elif down_confirmed:
        key, turn = 'downtrend', 'confirmed'
        confidence = 'high'
    elif up_detected and not down_detected:
        key, turn = 'upturn', 'confirmed' if sum(up_signals) >= 3 and bool(m20 and now >= m20) else 'detected'
        confidence = 'medium' if turn == 'confirmed' else 'low'
    elif down_detected and not up_detected:
        key, turn = 'downturn', 'confirmed' if sum(down_signals) >= 3 and bool(m20 and now <= m20) else 'detected'
        confidence = 'medium' if turn == 'confirmed' else 'low'
    else:
        key, turn, confidence = 'neutral', 'none', 'low'

    current_key = 'uptrend' if up_confirmed else 'downtrend' if down_confirmed else 'neutral'
    current_regime = {'key': current_key, 'label': CURRENT_REGIME_LABELS[current_key]}
    fake_event = _range_break_state(closes)
    break_event = _breakout_state(closes)
    if fake_event:
        recent_event = _event(fake_event, 'confirmed')
    elif break_event:
        recent_event = _event(break_event, 'confirmed')
    elif key == 'upturn':
        recent_event = _event('upturn_confirmed' if turn == 'confirmed' else 'upturn_detected', turn)
    elif key == 'downturn':
        recent_event = _event('downturn_confirmed' if turn == 'confirmed' else 'downturn_detected', turn)
    elif current_key == 'uptrend':
        prior_below = any(value < ma20[-1] for value in closes[-10:-1]) if m20 else False
        recent_event = _event('uptrend_resume', 'confirmed') if prior_below and now >= m20 and short_slope > 0 else _event('none')
    elif current_key == 'downtrend':
        recent_event = _event('downtrend_resume', 'confirmed')
    elif _compression_state(closes):
        recent_event = _event('compression', 'confirmed')
    else:
        recent_event = _event('none')

    auxiliary = []
    if current_key == 'uptrend' and m20 and (now / m20 - 1 >= 0.08 or (len(closes) >= 21 and closes[-1] / closes[-21] - 1 >= 0.15)):
        auxiliary.append(_event('overheated', 'confirmed'))
    if current_key == 'downtrend' and len(closes) >= 11:
        exhaustion_start = closes[-21] if len(closes) >= 21 else closes[-11]
        exhaustion_end = closes[-11] if len(closes) >= 21 else closes[-1]
        recent_loss = exhaustion_end / exhaustion_start - 1 if exhaustion_start else 0
        last_five = closes[-1] / closes[-6] - 1
        if recent_loss <= -0.08 and last_five >= -0.03:
            auxiliary.append(_event('exhaustion', 'detected'))
    if _compression_state(closes) and recent_event['key'] != 'compression':
        auxiliary.append(_event('compression', 'confirmed'))
    if fake_event:
        auxiliary = []
    auxiliary = auxiliary[:2]

    reasons = []
    if m5 and m20 and m60:
        reasons.append('5·20·60일선 %.1f / %.1f / %.1f' % (m5, m20, m60))
    if slope20:
        reasons.append('20일선 5거래일 변화 %.2f%%' % (slope20 * 100))
    if higher_low:
        reasons.append('최근 저점이 이전 저점보다 높음')
    if lower_high:
        reasons.append('최근 고점이 이전 고점보다 낮음')
    if rebound >= 0.03:
        reasons.append('최근 저점 대비 %.1f%% 반등' % (rebound * 100))
    if rs is not None:
        reasons.append('시장 대비 상대강도 %+0.1f%%p' % rs)
    if m224 is not None:
        reasons.append('224일선은 장기 추세 참고값으로만 사용')

    invalidation = {
        'uptrend': '20일선 이탈 후 회복 실패',
        'upturn': '반등 저점 이탈 또는 20일선 회복 실패',
        'neutral': '20일선 위 안착 또는 하향 이탈로 국면 재판정',
        'downturn': '최근 반등 고점 돌파 및 20일선 회복',
        'downtrend': '20일선 회복 후 안착',
    }[key]
    return {
        'key': key, 'label': REGIME_LABELS[key], 'confidence': confidence,
        'turningPoint': turn, 'reasons': reasons, 'invalidation': invalidation,
        'ma': {'ma5': m5, 'ma20': m20, 'ma60': m60, 'ma224': m224,
               'slope20': slope20, 'slope60': slope60},
        'relativeStrength': rs,
        'signals': {'up': sum(up_signals), 'down': sum(down_signals)},
        'currentRegime': current_regime,
        'recentEvent': recent_event,
        'mainEvent': recent_event,
        'auxiliaryStates': auxiliary,
    }


def _classify_wave_key(closes: List[float], fast_period: int, slow_period: int,
                       *, long_period: Optional[int] = None) -> str:
    """Classify one timeframe from moving-average structure, not Elliott counts."""
    minimum = max(slow_period, long_period or 0)
    if len(closes) < minimum:
        return 'insufficient'
    fast = _moving_average(closes, fast_period)[-1]
    slow = _moving_average(closes, slow_period)[-1]
    slope_fast = _slope(_moving_average(closes, fast_period), 5 if fast_period <= 20 else 10) or 0
    slope_slow = _slope(_moving_average(closes, slow_period), 10 if slow_period <= 60 else 20) or 0
    current = closes[-1]
    if long_period:
        long = _moving_average(closes, long_period)[-1]
        if fast is None or slow is None or long is None:
            return 'insufficient'
        if current >= long and fast >= slow and slow >= long and slope_slow >= -0.002:
            return 'uptrend'
        if current <= long and fast <= slow and slow <= long and slope_slow <= 0.002:
            return 'downtrend'
        return 'neutral'
    if fast is None or slow is None:
        return 'insufficient'
    if fast_period == 20 and slow_period == 60:
        if fast >= slow and slope_slow >= -0.005:
            return 'uptrend'
        if fast <= slow and slope_slow <= 0.005:
            return 'downtrend'
        return 'neutral'
    if fast >= slow and slope_fast >= 0.001 and slope_slow >= -0.003:
        return 'uptrend'
    if fast <= slow and slope_fast <= -0.001 and slope_slow <= 0.003:
        return 'downtrend'
    return 'neutral'


def _layer_event(layer: str, event: Dict[str, Any]) -> Dict[str, Any]:
    key = event.get('key') or 'none'
    label = event.get('label') or EVENT_LABELS.get(key, '이벤트 없음')
    return {
        'layer': layer,
        'key': key,
        'label': '[%s] %s' % ({'big': '대', 'mid': '중', 'small': '소'}.get(layer, layer), label),
        'stage': event.get('stage') or 'none',
    }


def classify_wave_structure(daily: List[Dict[str, Any]],
                            chart: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return big/mid/small trend context for the domestic four-week system.

    Big wave deliberately requires 224 persisted trading bars.  A short API
    response is never treated as a long-term downtrend or uptrend.
    """
    closes = [_close(row) for row in daily or []]
    closes = [value for value in closes if value is not None and value > 0]
    chart = chart or classify_chart_regime(daily)
    big_key = _classify_wave_key(closes, 60, 120, long_period=224)
    mid_key = _classify_wave_key(closes, 20, 60)
    small_key = _classify_wave_key(closes, 5, 20)

    def wave(layer: str, key: str, minimum: int, basis: str) -> Dict[str, Any]:
        return {
            'layer': layer, 'key': key,
            'label': WAVE_LABELS[key] if key != 'insufficient' else ('장기 데이터 부족' if layer == 'big' else '데이터 부족'),
            'available': key != 'insufficient', 'sampleDays': len(closes),
            'minRequired': minimum, 'basis': basis,
        }

    big = wave('big', big_key, 224, '60·120·224일선과 장기 고점·저점')
    mid = wave('mid', mid_key, 60, '20·60일선과 4~12주 흐름')
    small = wave('small', small_key, 20, '5·20일선과 최근 1~4주 흐름')

    mid_event = _event('none')
    if mid_key != 'insufficient' and len(closes) >= 65:
        prior_mid = _classify_wave_key(closes[:-5], 20, 60)
        if mid_key == 'uptrend' and prior_mid != 'uptrend':
            mid_event = _event('uptrend_resume', 'confirmed')
        elif mid_key == 'downtrend' and prior_mid != 'downtrend':
            mid_event = _event('downturn_confirmed', 'confirmed')
    short_signal = _ma_recovery_event(closes, 5)
    ma5_values = _moving_average(closes, 5)
    ma20_values = _moving_average(closes, 20)
    ma60_values = _moving_average(closes, 60)
    if short_signal['key'] == 'none' and _crossed_above_ma(closes, ma20_values):
        short_signal = _event('ma20_breakout', 'confirmed')

    ma5_slope = _slope(ma5_values, 3) or 0
    ma20_slope = _slope(ma20_values, 5) or 0
    prior_ma20_slope = _slope_at(ma20_values, len(closes) - 6, 5) or 0
    ma60_slope = _slope(ma60_values, 10) or 0
    prior_ma60_slope = _slope_at(ma60_values, len(closes) - 11, 10) or 0
    short_trigger = short_signal['key'] in ('ma5_recovery', 'ma20_breakout')
    short_transition = bool(short_trigger and ma5_slope > 0)
    current = closes[-1]
    current_ma20 = ma20_values[-1] if ma20_values else None
    mid_transition = bool(
        current_ma20 is not None and current >= current_ma20
        and (ma20_slope >= 0 or ma20_slope > prior_ma20_slope)
        and (ma60_slope >= 0 or ma60_slope > prior_ma60_slope)
    )
    ma224_values = _moving_average(closes, 224)
    long_transition = bool(
        len(closes) >= 224 and ma224_values[-1] is not None
        and current >= ma224_values[-1] and big_key == 'uptrend'
    )
    transitions = {
        'short': {
            'active': short_transition,
            'label': '단기 전환 후보' if short_transition else '단기 전환 없음',
            'basis': '5일선 회복 또는 20일선 돌파 AND 5일선 상승',
        },
        'mid': {
            'active': mid_transition,
            'label': '중기 전환 후보' if mid_transition else '중기 전환 없음',
            'basis': '종가 20일선 위 AND 20일선 방향 개선 AND 60일선 하락 둔화 또는 상승',
        },
        'long': {
            'active': long_transition,
            'label': '장기 추세 확정' if long_transition else '장기 정배열 미확인',
            'basis': '60일선·120일선·224일선 정배열 AND 종가 224일선 위',
        },
    }
    small_event = chart.get('recentEvent') or _event('none')
    if small_event.get('key') == 'none' and small_key != 'insufficient' and len(closes) >= 25:
        prior_small = _classify_wave_key(closes[:-3], 5, 20)
        if small_key == 'uptrend' and prior_small != 'uptrend':
            small_event = _event('uptrend_resume', 'confirmed')
        elif small_key == 'downtrend' and prior_small != 'downtrend':
            small_event = _event('downturn_confirmed', 'confirmed')

    recent_events = []
    if mid_event['key'] != 'none':
        recent_events.append(_layer_event('mid', mid_event))
    if small_event.get('key') != 'none':
        recent_events.append(_layer_event('small', small_event))

    small_upturn = small_event.get('key') in ('upturn_detected', 'upturn_confirmed')
    if big_key == 'insufficient':
        diagnosis = '장기 데이터 부족'
        action_key = 'insufficient'
    elif big_key == 'uptrend' and mid_key == 'uptrend' and small_key == 'uptrend' and small_upturn:
        diagnosis, action_key = '상승 추세 내 단기 상방 변곡 · 확인 대기', 'observe'
    elif big_key == 'uptrend' and mid_key == 'uptrend' and small_key == 'uptrend':
        diagnosis, action_key = '장기·중기·단기 추세 정렬', 'pullback_candidate'
    elif big_key == 'uptrend' and mid_key == 'uptrend' and small_key == 'downtrend':
        diagnosis, action_key = '상승 추세 내 정상 조정', 'observe'
    elif big_key == 'uptrend' and mid_key == 'downtrend' and small_key == 'uptrend':
        diagnosis, action_key = '중기 조정 중 반등 · 중기 확인 대기', 'wait_mid_confirmation'
    elif short_transition:
        diagnosis, action_key = '단기 전환 후보 · 중기 확인 대기', 'short_transition_candidate'
    elif mid_transition:
        diagnosis, action_key = '중기 전환 후보 · 장기 확인 대기', 'mid_transition_candidate'
    elif big_key == 'downtrend' and mid_key == 'downtrend' and small_key == 'uptrend':
        diagnosis, action_key = '하락 추세 안의 기술적 반등', 'prohibited_rebound'
    elif big_key == 'downtrend' and mid_key == 'uptrend' and small_key == 'uptrend':
        diagnosis, action_key = '역추세 반등 · 고위험 관찰', 'high_risk_observe'
    elif big_key == 'neutral' and mid_key == 'neutral' and small_key == 'uptrend':
        diagnosis, action_key = '돌파 확인 대기', 'wait_breakout'
    elif big_key == 'neutral' and mid_key == 'neutral' and small_key == 'downtrend':
        diagnosis, action_key = '하단 이탈 · 신규 진입 금지', 'prohibited_breakdown'
    elif mid_key == 'downtrend':
        diagnosis, action_key = '중기 하락 · 신규 진입 금지', 'prohibited'
    elif mid_key == 'neutral':
        diagnosis, action_key = '중기 방향 확인 대기', 'observe'
    else:
        diagnosis, action_key = '추세 방향 확인 대기', 'observe'

    small['event'] = _layer_event('small', small_event)
    mid['event'] = _layer_event('mid', mid_event)
    return {
        'big': big, 'mid': mid, 'small': small,
        'shortSignal': short_signal, 'transitions': transitions,
        'diagnosis': diagnosis, 'actionKey': action_key,
        'recentEvents': recent_events[-6:],
    }


def _state_from_score(score: Optional[float], positive: str, negative: str) -> str:
    if score is None:
        return '데이터 부족'
    if score >= 65:
        return positive
    if score < 40:
        return negative
    return '중립'


def build_swing_assessment(daily: List[Dict[str, Any]], *, flow_score: Optional[float] = None,
                           foreign_inst_score: Optional[float] = None,
                           fundamental_score: Optional[float] = None,
                           short_score: Optional[float] = None,
                           entry: Optional[Dict[str, Any]] = None,
                           benchmark: Optional[Iterable[Any]] = None,
                           legacy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    chart = classify_chart_regime(daily, benchmark)
    waves = classify_wave_structure(daily, chart)
    momentum_score = None
    if flow_score is not None or foreign_inst_score is not None:
        values = [v for v in (flow_score, foreign_inst_score) if v is not None]
        momentum_score = sum(values) / len(values) if values else None
    momentum = _state_from_score(momentum_score, '강화', '약화')
    fundamental = _state_from_score(fundamental_score, '지지', '부담')

    risk_flags = []
    short_entry = (entry or {}).get('short') or {}
    pressure = short_entry.get('pressure') or {}
    danger_gate = pressure.get('danger_gate') or {}
    if danger_gate.get('triggered'):
        risk_flags.append('공매도 과열·가격하락·대차증가 동시 확인')
    elif short_score is not None and short_score < 35:
        risk_flags.append('공매도 압박 높음')
    credit = (entry or {}).get('credit') or {}
    credit_signal = credit.get('signal') or {}
    if credit_signal.get('flag'):
        risk_flags.append(credit_signal.get('label') or '신용·반대매매 주의')
    risk = '경고' if danger_gate.get('triggered') or len(risk_flags) >= 2 else '주의' if risk_flags else '없음'
    blocks_entry = risk in ('주의', '경고')

    event_key = (chart.get('recentEvent') or {}).get('key')
    aux_keys = {(item or {}).get('key') for item in chart.get('auxiliaryStates') or []}
    if event_key in ('fake_breakout', 'fake_breakdown'):
        holder_action = '보유 / 신호 취소 후 관찰'
        entry_opinion = '관찰'
        priority_base = 35
    elif waves['actionKey'] == 'insufficient':
        holder_action = '보유 / 장기 데이터 부족 관찰'
        entry_opinion = '장기 데이터 부족 · 관찰'
        priority_base = 25
    elif waves['actionKey'] == 'pullback_candidate':
        holder_action = '보유 / 추가매수 검토'
        entry_opinion = '눌림목 매수 후보' if not blocks_entry else '신규 진입 금지'
        priority_base = 100
    elif waves['actionKey'] == 'short_transition_candidate':
        holder_action = '보유 / 단기 전환 확인'
        entry_opinion = '단기 전환 후보'
        priority_base = 72
    elif waves['actionKey'] == 'mid_transition_candidate':
        holder_action = '보유 / 중기 전환 확인'
        entry_opinion = '중기 전환 후보'
        priority_base = 82
    elif waves['actionKey'] == 'wait_mid_confirmation':
        holder_action = '보유 / 중기 조정 확인'
        entry_opinion = '중기 확인 대기'
        priority_base = 58
    elif waves['actionKey'] == 'prohibited_rebound':
        holder_action = '보유 / 반등 구간 위험 관리'
        entry_opinion = '신규 진입 금지'
        priority_base = 20
    elif waves['actionKey'] == 'high_risk_observe':
        holder_action = '보유 / 역추세 반등 위험 관리'
        entry_opinion = '고위험 관찰'
        priority_base = 30
    elif waves['actionKey'] == 'wait_breakout':
        holder_action = '보유 / 돌파 확인'
        entry_opinion = '돌파 확인 대기'
        priority_base = 45
    elif waves['actionKey'] in ('prohibited_breakdown', 'prohibited'):
        holder_action = '보유 주의 / 하락 위험 관리'
        entry_opinion = '신규 진입 금지'
        priority_base = 10
    elif waves['actionKey'] == 'observe':
        holder_action = '보유 / 정상 조정 관찰'
        entry_opinion = '관찰'
        priority_base = 65
    elif chart['key'] == 'downturn':
        holder_action = '보유 주의 / 비중축소 검토'
        entry_opinion = '신규 진입 금지'
        priority_base = 18
    else:
        if 'exhaustion' in aux_keys:
            holder_action = '보유 주의 / 바닥 확인'
            entry_opinion = '바닥 확인 관찰'
            priority_base = 12
        else:
            holder_action = '비중축소 / 매도 검토'
            entry_opinion = '후보 제외'
            priority_base = 5

    if blocks_entry and waves['actionKey'] in ('pullback_candidate', 'short_transition_candidate', 'mid_transition_candidate') and event_key not in ('fake_breakout', 'fake_breakdown'):
        entry_opinion = '신규 진입 금지'
    score_parts = [value for value in (momentum_score, fundamental_score) if value is not None]
    internal_priority = priority_base + (sum(score_parts) / len(score_parts) - 50) * 0.25 if score_parts else priority_base
    return {
        'modelVersion': MODEL_VERSION,
        'chartRegime': chart,
        'currentRegime': chart.get('currentRegime'),
        'recentEvent': chart.get('recentEvent'),
        'auxiliaryStates': chart.get('auxiliaryStates') or [],
        'waves': waves,
        'shortSignal': waves.get('shortSignal') or _event('none'),
        'transitions': waves.get('transitions') or {},
        'diagnosis': waves['diagnosis'],
        'momentum': {'state': momentum, 'score': momentum_score},
        'fundamental': {'state': fundamental, 'score': fundamental_score},
        'risk': {'state': risk, 'flags': risk_flags, 'blocksEntry': blocks_entry},
        'holderAction': holder_action,
        'entryOpinion': entry_opinion,
        'internalPriorityScore': round(max(0, min(100, internal_priority)), 2),
        'legacy': legacy or {},
    }


def is_four_week_candidate(assessment: Dict[str, Any]) -> bool:
    """Use the same hard gate in daily scan, weekly report and tests."""
    waves = assessment.get('waves') or {}
    big = waves.get('big') or {}
    mid = waves.get('mid') or {}
    small = waves.get('small') or {}
    risk = assessment.get('risk') or {}
    entry = assessment.get('entryOpinion')
    return bool(
        big.get('available') and mid.get('key') == 'uptrend' and small.get('key') == 'uptrend'
        and not risk.get('blocksEntry')
        and entry in ('눌림목 매수 후보', '초기 매수 후보', '돌파 매수 후보')
        and (assessment.get('recentEvent') or {}).get('key') not in (
            'fake_breakout', 'fake_breakdown', 'exhaustion', 'upturn_detected', 'upturn_confirmed'
        )
    )
