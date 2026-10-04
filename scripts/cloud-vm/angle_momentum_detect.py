# -*- coding: utf-8 -*-
"""각도기 타점 판정(2026-10-04 재설계) - 이동평균의 "기울기 변화와 곡률"이 먼저 위로 꺾이는 초기 상승 전환 구간.

거래량이 폭발한 뒤 따라가는 검색기가 아니다. 전형가(TP=(고+저+종)/3)의 5·10·20일 단순이동평균 기울기를 주가 수준과 무관한
"일평균 % 변화율"로 정규화하고, 기울기의 하루 변화(곡률/가속도)가 최근 20일 평소 수준보다 얼마나 튀는지(burstRatio)를 본다.
거래량 증가는 필수가 아니다(거래량 1.5배 미만에서 곡률이 먼저 꺾이면 오히려 "선행" 신호로 가산).

장 마감 후 확정 일봉 기준(daily_scan 계열 스캔 1회). 값은 상수라 결과 수를 보고 쉽게 조절한다.
"각도"는 화면 표현일 뿐, 내부 계산은 차트 픽셀 각도가 아니라 정규화된 % 기울기다.
"""

SHORT_PERIOD = 5
MID_PERIOD = 10
LONG_PERIOD = 20
SLOPE_COMPARE_DAYS = 3        # slope_n = (MA_today / MA_{3일전} - 1) / 3  (일평균 변화율)
BURST_LOOKBACK = 20           # 평소 수준 = 최근 20일 |가속도|의 median(하루 이상치에 평균이 왜곡되지 않게)
MIN_BURST_RATIO = 1.5
MIN_ABSOLUTE_ACCEL = 0.0003   # 평소 변화가 거의 0일 때 burstRatio가 비정상적으로 커지지 않게 하는 최소 가속도(일평균 0.03%p)
MAX_DAILY_RETURN = 0.10       # 당일 +10% 넘는 급등 이후의 곡률은 "선행"이 아니라 후행(EXPLOSION_LATE) - 제외
VOLUME_PREHEAT_RATIO = 1.5    # 거래량이 평균의 이 배수 미만이면 "거래량 과열 전" 가산
# 2026-10-04 수익률 백테스트(D+1 시가 진입): 점수 90 미만 신호는 시장 평균(BASELINE)과 차이가 없었고 90 이상만 전/후반 기간 모두 초과수익이 있었다
MIN_SCORE = 90
RECENT_TURN_DAYS = 3          # TURNING: 최근 3일 안에 MA5 기울기가 0 이하였던 적이 있어야 "양전환"
MIN_BARS = LONG_PERIOD + SLOPE_COMPARE_DAYS + BURST_LOOKBACK + 2


def typical_prices(rows):
    return [(r['high'] + r['low'] + r['close']) / 3.0 for r in rows]


def sma(values, period):
    out = [None] * len(values)
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            out[i] = total / period
    return out


def normalized_slope(ma, i, days=SLOPE_COMPARE_DAYS):
    """일평균 변화율. 절대 가격 기울기(원 단위)를 쓰지 않아 10만원 주식과 1만원 주식을 같은 기준으로 비교한다."""
    if i - days < 0 or ma[i] is None or ma[i - days] in (None, 0):
        return None
    return (ma[i] / ma[i - days] - 1.0) / days


def _median(values):
    vals = sorted(values)
    if not vals:
        return None
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2.0


def detect_angle_momentum(rows):
    """TURNING(각도 전환) / BURST(각도 분출) 또는 None."""
    n = len(rows)
    if n < MIN_BARS:
        return None
    i = n - 1
    tp = typical_prices(rows)
    ma5, ma10, ma20 = sma(tp, SHORT_PERIOD), sma(tp, MID_PERIOD), sma(tp, LONG_PERIOD)

    s5, s10, s20 = (normalized_slope(m, i) for m in (ma5, ma10, ma20))
    p5, p10, p20 = (normalized_slope(m, i - 1) for m in (ma5, ma10, ma20))
    if None in (s5, s10, s20, p5, p10, p20):
        return None
    a5, a10, a20 = s5 - p5, s10 - p10, s20 - p20     # 곡률(가속도)

    # 필수: 단기 기울기 양수 + 단기·중기 곡률 위로 + 장기 곡률 최소 0 이상(MA20은 느려서 평탄 전환도 인정)
    if not (s5 > 0 and a5 > 0 and a10 > 0 and a20 >= 0):
        return None

    last = rows[i]
    prev_close = rows[i - 1]['close']
    daily_return = (last['close'] / prev_close - 1.0) if prev_close else 0.0
    if daily_return > MAX_DAILY_RETURN:
        return None       # EXPLOSION_LATE - 이미 급등한 뒤 곡률만 튄 종목은 이 검색기의 목적(선행)이 아니다

    # 분출: 오늘 가속도가 최근 20일 |가속도| median의 1.5배 이상(저변동이면 최소 절대 가속도 기준 사용)
    hist = []
    for k in range(i - BURST_LOOKBACK, i):
        sk, sk1 = normalized_slope(ma5, k), normalized_slope(ma5, k - 1)
        if sk is not None and sk1 is not None:
            hist.append(abs(sk - sk1))
    baseline = max(_median(hist) or 0.0, MIN_ABSOLUTE_ACCEL)
    burst_ratio = a5 / baseline
    burst = burst_ratio >= MIN_BURST_RATIO and a5 >= MIN_ABSOLUTE_ACCEL
    # 각도 전환(TURNING)은 "양전환" 자체가 핵심이라 최근 3일 안에 MA5 기울기가 0 이하였던 종목만 인정한다. 이미 한참 오르던
    # 이평선은 곡률이 조금 커져도 초기 전환이 아니므로, 그런 경우는 분출(BURST)일 때만 남긴다.
    recently_turned = any((normalized_slope(ma5, i - k) or 0.0) <= 0 for k in range(1, RECENT_TURN_DAYS + 1))
    if not burst and not recently_turned:
        return None
    status = 'BURST' if burst else 'TURNING'

    vols = [r['volume'] for r in rows[i - 20:i] if r['volume'] is not None]
    avg_vol = (sum(vols) / len(vols)) if vols else 0
    volume_ratio = (last['volume'] / avg_vol) if avg_vol else None

    # ---- 점수(100): MA5 양전환 20 · MA10 개선 15 · MA20 개선 15 · MA5 가속 15 · burstRatio 20 · 가격의 MA 회복 10 · 거래량 과열 전 5
    turned_up = p5 <= 0 < s5                                   # 음수/평탄 -> 양수 전환이면 최고점
    ma5_score = 20 if turned_up else 14
    ma10_score = 15 if s10 > 0 else 10
    ma20_score = 15 if s20 > 0 else 9 if a20 > 0 else 6
    accel_score = 15 if a5 >= 2 * MIN_ABSOLUTE_ACCEL else 10
    burst_score = 20 if burst_ratio >= 2.5 else 16 if burst_ratio >= MIN_BURST_RATIO else 10 if burst_ratio >= 1.0 else 5
    c = last['close']
    recover_score = (4 if c > ma5[i] else 0) + (3 if c > ma10[i] else 0) + (3 if c > ma20[i] else 0)
    preheat_score = 5 if (volume_ratio is None or volume_ratio < VOLUME_PREHEAT_RATIO) else 2
    score = ma5_score + ma10_score + ma20_score + accel_score + burst_score + recover_score + preheat_score
    # 정배열이 이미 완성되고 가격이 MA20에서 한참 멀어졌으면 초기 전환이 아니라 후행 - 감점
    if ma5[i] > ma10[i] > ma20[i] and ma20[i] and c > ma20[i] * 1.10:
        score -= 10
    score = max(0, min(100, int(round(score))))
    if score < MIN_SCORE:
        return None

    pct = lambda v: round(v * 100, 3)   # 일평균 %
    reasons = [
        'MA5 기울기 %+.2f%%/일%s(%d/20점) · MA10 %+.2f%%/일(%d/15점) · MA20 %+.2f%%/일(%d/15점)' % (
            s5 * 100, ' (양전환)' if turned_up else '', ma5_score, s10 * 100, ma10_score, s20 * 100, ma20_score),
        '곡률(기울기 변화) MA5 %+.3f · MA10 %+.3f · MA20 %+.3f(%d/15점)' % (a5 * 100, a10 * 100, a20 * 100, accel_score),
        '분출 비율 %.1f배(최근 20일 median 대비, %d/20점) · 종가의 이평 회복(%d/10점)' % (burst_ratio, burst_score, recover_score),
        '거래량 %s(%d/5점, 필수 조건 아님)' % (('%.1f배' % volume_ratio) if volume_ratio is not None else '-', preheat_score),
    ]
    return {
        'status': status,
        'signal': {'date': last['date'], 'price': c},
        'breakout': False,
        'shortSlopePct': pct(s5), 'midSlopePct': pct(s10), 'longSlopePct': pct(s20),
        'shortAccelPct': pct(a5), 'midAccelPct': pct(a10), 'longAccelPct': pct(a20),
        'burstRatio': round(burst_ratio, 2),
        'volumeRatio': round(volume_ratio, 2) if volume_ratio is not None else None,
        'dailyReturnPct': round(daily_return * 100, 2),
        'tpMa5': ma5[i], 'tpMa10': ma10[i], 'tpMa20': ma20[i],
        'score': score,
        'reasons': reasons,
        'interpretation': '전형가 이평선의 기울기가 먼저 위로 꺾이는 %s 상태입니다(%d점, 거래량 증가 전 선행 신호).' % (
            '각도 분출' if burst else '각도 전환', score),
    }
