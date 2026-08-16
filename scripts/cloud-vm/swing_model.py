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


MODEL_VERSION = 'swing-4w-v1'
REGIME_LABELS = {
    'uptrend': '상승 지속',
    'upturn': '상방 변곡',
    'neutral': '횡보·판단 보류',
    'downturn': '하방 변곡',
    'downtrend': '하락 지속',
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


def classify_chart_regime(daily: List[Dict[str, Any]], benchmark: Optional[Iterable[Any]] = None) -> Dict[str, Any]:
    """Return a five-state chart regime without using a one-day candle alone."""
    closes = [_close(row) for row in daily or []]
    closes = [value for value in closes if value is not None and value > 0]
    if len(closes) < 60:
        return {
            'key': 'neutral', 'label': REGIME_LABELS['neutral'], 'confidence': 'low',
            'turningPoint': 'unknown', 'reasons': ['5·20·60일선 계산에 필요한 일봉이 부족합니다.'],
            'invalidation': '일봉 데이터 60개 이상 확보 후 재판정', 'ma': {},
            'relativeStrength': None,
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

    if chart['key'] == 'uptrend':
        holder_action = '보유 / 추가매수 검토'
        entry_opinion = '눌림목 매수 후보' if not blocks_entry else '신규 진입 주의'
        priority_base = 100
    elif chart['key'] == 'upturn':
        holder_action = '보유 / 강제 비중축소 금지'
        entry_opinion = '초기 매수 후보' if chart['turningPoint'] == 'confirmed' and not blocks_entry else '신규 진입 관찰'
        priority_base = 82 if chart['turningPoint'] == 'confirmed' else 68
    elif chart['key'] == 'neutral':
        holder_action = '보유 / 관찰'
        entry_opinion = '관찰'
        priority_base = 42
    elif chart['key'] == 'downturn':
        holder_action = '비중축소 검토'
        entry_opinion = '신규 진입 금지'
        priority_base = 18
    else:
        holder_action = '비중축소 / 매도 검토'
        entry_opinion = '후보 제외'
        priority_base = 5

    if blocks_entry and chart['key'] in ('uptrend', 'upturn'):
        entry_opinion = '신규 진입 금지'
    score_parts = [value for value in (momentum_score, fundamental_score) if value is not None]
    internal_priority = priority_base + (sum(score_parts) / len(score_parts) - 50) * 0.25 if score_parts else priority_base
    return {
        'modelVersion': MODEL_VERSION,
        'chartRegime': chart,
        'momentum': {'state': momentum, 'score': momentum_score},
        'fundamental': {'state': fundamental, 'score': fundamental_score},
        'risk': {'state': risk, 'flags': risk_flags, 'blocksEntry': blocks_entry},
        'holderAction': holder_action,
        'entryOpinion': entry_opinion,
        'internalPriorityScore': round(max(0, min(100, internal_priority)), 2),
        'legacy': legacy or {},
    }
