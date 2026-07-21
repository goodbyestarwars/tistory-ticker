# -*- coding: utf-8 -*-
"""차트 패턴 판정(지시서 5종) - gas/ticker-proxy.gs의 detectRisingLows_/detectDoubleBottom_/
detectInvHeadShoulders_/detectBoxRangeLow_/detectPullback_ 및 공용 헬퍼를 그대로 포팅.
수치 조건/배점은 원본과 동일해야 두 구현의 판정 결과가 일치한다 - 상수를 바꾸지 말 것."""

import math

PATTERN_SWING = 2
PATTERN_MAX_MATCHES = 30

RISING_LOWS_WINDOW = 60
DOUBLE_BOTTOM_WINDOW = 90
IHS_WINDOW = 60
BOX_WINDOW = 40

WEDGE_MIN_SWINGS = 2
WEDGE_MIN_LOW_RISE = 0.03
WEDGE_MIN_GAP_DAYS = 5
WEDGE_MAX_GAP_DAYS = 20
WEDGE_MAX_EXTENSION = 0.10
RECENCY_MAX_GAP = 3

DB_LOW_TOL = 0.03
DB_MIN_GAP_DAYS = 10
DB_MAX_GAP_DAYS = 40
DB_PEAK_MIN_RISE = 0.03
DB_NECK_PROXIMITY_MIN = -0.05

IHS_SHOULDER_TOL = 0.05
IHS_HEAD_MIN_DROP = 0.01
IHS_NECK_PROXIMITY_MIN = -0.03

BOX_TOL = 0.035
BOX_MAX_RANGE = 0.15
BOX_MIN_RANGE = 0.05
BOX_NEAR_LOW_TOL = 0.03
BOX_MIN_LOW_TOUCHES = 3   # 2026-07-22 개편: 지지선 터치 3회 이상
BOX_MIN_HIGH_TOUCHES = 2  # 2026-07-22 개편: 저항선 터치 2회 이상
BOX_MIN_DURATION = 25     # 2026-07-22 개편: 박스 기간(첫 스윙~오늘) 최소 25거래일

BREAKOUT_TOL = 1.02

# 2026-07-22 개편: 저점상승형 20일선 기울기 / 눌림목 20일선 상승 확인에 공용으로 쓰는
# "며칠 전과 비교할지" 값(gas/ticker-proxy.gs와 동일하게 5거래일).
MA_SLOPE_LOOKBACK = 5
IHS_VOL_SURGE_RATIO = 1.2  # 역헤드앤숄더: 우어깨 이후 거래량이 20일 평균 대비 1.2배 이상

PULLBACK_WINDOW = 90
PULLBACK_LOOKBACK = 20
PULLBACK_MIN_RISE = 0.15
PULLBACK_MIN_DROP = 0.05
PULLBACK_MAX_DROP = 0.15
PULLBACK_MA_TOL = 0.03
PULLBACK_MIN_DAYS = 65  # detect_pullback을 시도해볼 최소 보유 일수


# ---------------------------------------------------------------------------
# 공용 헬퍼
# ---------------------------------------------------------------------------

def find_swing_indices(win, field, is_low):
    idxs = []
    for i in range(PATTERN_SWING, len(win) - PATTERN_SWING):
        v = win[i][field]
        ok = True
        for k in range(i - PATTERN_SWING, i + PATTERN_SWING + 1):
            if k == i:
                continue
            if (win[k][field] < v) if is_low else (win[k][field] > v):
                ok = False
                break
        if ok:
            idxs.append(i)
    return idxs


def max_high_between(win, i1, i2):
    max_high, idx = -math.inf, -1
    for k in range(i1 + 1, i2):
        if win[k]['high'] > max_high:
            max_high, idx = win[k]['high'], k
    return None if idx == -1 else {'date': win[idx]['date'], 'high': max_high}


def moving_average(win, field, period):
    n = len(win)
    ma = [None] * n
    s = 0.0
    for i in range(n):
        s += win[i][field]
        if i >= period:
            s -= win[i - period][field]
        if i >= period - 1:
            ma[i] = s / period
    return ma


def avg_volume(win, from_idx, to_idx):
    vals = [win[i]['volume'] for i in range(from_idx, to_idx)]
    return (sum(vals) / len(vals)) if vals else 0


def is_volume_declining(win, from_idx, to_idx):
    mid = from_idx + (to_idx - from_idx) // 2
    if mid <= from_idx or to_idx <= mid:
        return False
    early = avg_volume(win, from_idx, mid)
    late = avg_volume(win, mid, to_idx)
    return early > 0 and late < early


def is_volume_increasing(win, from_idx, to_idx):
    """is_volume_declining의 반대(눌림목 상승구간 거래량 증가 조건용)."""
    mid = from_idx + (to_idx - from_idx) // 2
    if mid <= from_idx or to_idx <= mid:
        return False
    early = avg_volume(win, from_idx, mid)
    late = avg_volume(win, mid, to_idx)
    return early > 0 and late > early


def is_last_candle_bullish(win):
    last = win[-1]
    return last['close'] > last['open']


def has_bullish_after(win, from_idx):
    for i in range(from_idx + 1, len(win)):
        if win[i]['close'] > win[i]['open']:
            return True
    return False


def score_tier(value, tiers):
    for t in tiers:
        if value >= t['min']:
            return t['score']
    return 0


def clamp_score(n):
    return max(0, min(100, round(n)))


def pattern_grade(score):
    return score >= 70


def dedupe_levels(levels):
    sorted_levels = sorted(levels)
    out = []
    for v in sorted_levels:
        last = out[-1] if out else None
        if last is not None and abs(v - last) / last < 0.01:
            continue
        out.append(v)
    return out


def compute_support_resistance(daily):
    win = daily[max(0, len(daily) - 120):]
    low_idx = find_swing_indices(win, 'low', True)
    high_idx = find_swing_indices(win, 'high', False)
    last_close = daily[-1]['close']

    low_levels = dedupe_levels([win[i]['low'] for i in low_idx])
    high_levels = dedupe_levels([win[i]['high'] for i in high_idx])

    support = sorted([v for v in low_levels if v < last_close], reverse=True)[:2]
    resistance = sorted([v for v in high_levels if v > last_close])[:2]

    if not support:
        min_low = min(w['low'] for w in win)
        if min_low < last_close:
            support = [min_low]
    if not resistance:
        max_high = max(w['high'] for w in win)
        if max_high > last_close:
            resistance = [max_high]

    return {'support': support, 'resistance': resistance}


def ichimoku_period_mid(daily, i, period):
    start = i - period + 1
    if start < 0:
        return None
    hi = max(daily[k]['high'] for k in range(start, i + 1))
    lo = min(daily[k]['low'] for k in range(start, i + 1))
    return (hi + lo) / 2


ICHIMOKU_TENKAN_PERIOD = 9
ICHIMOKU_KIJUN_PERIOD = 26
ICHIMOKU_SENKOU_B_PERIOD = 52
ICHIMOKU_DISPLACEMENT = 26


# 구름 위/아래(10) + 전환선-기준선 골든/데드(10) + 구름 색 양운/음운(10) = 0~30점.
# js/foreign-flow.js의 computeIchimokuScore와 동일 공식(선/구름 렌더링은 프론트에서만 하고
# 여기서는 점수만 계산 - 그림은 필요 없음).
def compute_ichimoku_score(daily):
    n = len(daily)
    tenkan = [ichimoku_period_mid(daily, i, ICHIMOKU_TENKAN_PERIOD) for i in range(n)]
    kijun = [ichimoku_period_mid(daily, i, ICHIMOKU_KIJUN_PERIOD) for i in range(n)]

    cloud_idx = n - 1 - ICHIMOKU_DISPLACEMENT
    today_senkou_a = None
    today_senkou_b = None
    if cloud_idx >= 0:
        if tenkan[cloud_idx] is not None and kijun[cloud_idx] is not None:
            today_senkou_a = (tenkan[cloud_idx] + kijun[cloud_idx]) / 2
        today_senkou_b = ichimoku_period_mid(daily, cloud_idx, ICHIMOKU_SENKOU_B_PERIOD)

    close = daily[-1]['close']
    cloud_score = 0
    if today_senkou_a is not None and today_senkou_b is not None:
        top = max(today_senkou_a, today_senkou_b)
        bottom = min(today_senkou_a, today_senkou_b)
        if close > top:
            cloud_score = 10
        elif close >= bottom:
            cloud_score = 5

    cross_score = 0
    last_tenkan, last_kijun = tenkan[-1], kijun[-1]
    if last_tenkan is not None and last_kijun is not None:
        if last_tenkan > last_kijun:
            cross_score = 10
        elif last_tenkan == last_kijun:
            cross_score = 5

    color_score = 0
    if today_senkou_a is not None and today_senkou_b is not None:
        if today_senkou_a > today_senkou_b:
            color_score = 10
        elif today_senkou_a == today_senkou_b:
            color_score = 5

    return {'score': cloud_score + cross_score + color_score}


def compute_tech_score(daily):
    """이동평균 배열(30) + 지지선 근접도(20) + 저항선 근접도(20) + 일목균형표(30) = 0~100점.
    js/foreign-flow.js의 computeTechnicalScore와 동일 공식 - 종목분석/투자시그널 등급이
    어긋나지 않으려면 두 구현을 같이 고칠 것."""
    if not daily or len(daily) < 60:
        return None
    close = daily[-1]['close']

    def last_val(arr):
        return arr[-1] if arr else None

    ma5 = last_val(moving_average(daily, 'close', 5))
    ma20 = last_val(moving_average(daily, 'close', 20))
    ma60 = last_val(moving_average(daily, 'close', 60))

    ma_score = 0
    if ma5 is not None and ma20 is not None and ma60 is not None:
        if ma5 > ma20 > ma60:
            ma_score = 30
        elif ma20 > ma60:
            ma_score = 20
        elif ma5 > ma20:
            ma_score = 10

    levels = compute_support_resistance(daily)
    support = levels['support']
    sup_score = 0
    if support:
        nearest_sup = min(support, key=lambda b: abs(b - close))
        sup_gap = (close - nearest_sup) / nearest_sup * 100
        if sup_gap < 0:
            sup_score = 0
        elif sup_gap <= 2:
            sup_score = 20
        elif sup_gap <= 5:
            sup_score = 12
        elif sup_gap <= 8:
            sup_score = 6

    resistance = levels['resistance']
    res_score = 0
    if resistance:
        nearest_res = min(resistance, key=lambda b: abs(b - close))
        res_gap = (nearest_res - close) / close * 100
        if res_gap < 0:
            res_score = 20
        elif res_gap <= 3:
            res_score = 12
        elif res_gap <= 8:
            res_score = 6

    ichi_score = compute_ichimoku_score(daily)['score']

    return {'score': ma_score + sup_score + res_score + ichi_score}


def build_pattern_match(stock, daily, detail):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    change_rate = ((last['close'] - prev['close']) / prev['close'] * 100) if (prev and prev['close']) else None
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last['date'],
        'score': detail['score'],
        'reasons': detail['reasons'],
        'interpretation': detail['interpretation'],
    }


# ---------------------------------------------------------------------------
# ① 저점상승형(Higher Low)
# ---------------------------------------------------------------------------

def detect_rising_lows(daily):
    win = daily[max(0, len(daily) - RISING_LOWS_WINDOW):]
    if len(win) < RISING_LOWS_WINDOW:
        return None

    low_idxs = find_swing_indices(win, 'low', True)
    high_idxs = find_swing_indices(win, 'high', False)
    if len(low_idxs) < WEDGE_MIN_SWINGS:
        return None

    prev_low_idx = low_idxs[-2]
    last_low_idx = low_idxs[-1]
    prev_low = win[prev_low_idx]['low']
    last_low = win[last_low_idx]['low']
    rise_ratio = (last_low - prev_low) / prev_low
    if rise_ratio < WEDGE_MIN_LOW_RISE:
        return None

    low_span = last_low_idx - prev_low_idx
    if low_span < WEDGE_MIN_GAP_DAYS or low_span > WEDGE_MAX_GAP_DAYS:
        return None

    # 2026-07-22 개편: Higher High - 고점도 직전 스윙고점보다 높아야 함
    if len(high_idxs) < 2:
        return None
    prev_high = win[high_idxs[-2]]['high']
    last_high = win[high_idxs[-1]]['high']
    if last_high <= prev_high:
        return None

    # 2026-07-22 개편: 20일선 기울기 0 이상(상승 또는 횡보)
    ma20_series = moving_average(win, 'close', 20)
    ma20_now = ma20_series[-1]
    ma20_prev = ma20_series[-1 - MA_SLOPE_LOOKBACK]
    if ma20_now is None or ma20_prev is None or ma20_now < ma20_prev:
        return None

    if (len(win) - 1) - last_low_idx > RECENCY_MAX_GAP:
        return None

    last_close = win[-1]['close']
    if last_close < last_low * 0.98:
        return None
    if (last_close - last_low) / last_low > WEDGE_MAX_EXTENSION:
        return None

    low_swing_points = [{'date': win[i]['date'], 'price': win[i]['low']} for i in low_idxs]
    current = {'date': win[-1]['date'], 'price': last_close}

    # ---- 점수(100점, 2026-07-22 개편): 저점상승폭35 + 고점상승(HH)15(고정) + 저점간격15(고정)
    # + 20일선기울기10(고정) + 5일선저항15 + 거래량감소5 + 최근양봉5 ----
    rise_score = score_tier(rise_ratio, [
        {'min': 0.08, 'score': 35}, {'min': 0.05, 'score': 26}, {'min': WEDGE_MIN_LOW_RISE, 'score': 18}
    ])
    hh_score = 15
    span_score = 15
    slope_score = 10

    ma5 = moving_average(win, 'close', 5)
    resistance = max((win[i]['high'] for i in high_idxs), default=None)
    resistance_idx = high_idxs[-1] if high_idxs else None
    ma5_at_resistance = ma5[resistance_idx] if resistance_idx is not None else None
    ma5_diff = abs(win[resistance_idx]['high'] - ma5_at_resistance) / ma5_at_resistance if ma5_at_resistance else 1
    ma5_score = 15 if ma5_diff <= 0.02 else 8 if ma5_diff <= 0.05 else 0

    vol_score = 5 if is_volume_declining(win, prev_low_idx, len(win)) else 0
    bull_score = 5 if is_last_candle_bullish(win) else 0

    score = clamp_score(rise_score + hh_score + span_score + slope_score + ma5_score + vol_score + bull_score)
    reasons = [
        '저점 %.1f%% 상승(%d/35점)' % (rise_ratio * 100, rise_score),
        '고점도 직전 고점 대비 상승, Higher High 확인(%d/15점)' % hh_score,
        '저점 간격 %d거래일(%d/15점)' % (low_span, span_score),
        '20일선 기울기 상승/횡보(%d/10점)' % slope_score,
        '5일선 저항 근접도(%d/15점)' % ma5_score,
        '거래량 %s(%d/5점)' % ('감소' if vol_score else '유지/증가', vol_score),
        '최근 캔들 %s(%d/5점)' % ('양봉' if bull_score else '음봉', bull_score),
    ]

    return {
        'low_swings': low_swing_points,
        'low_swings_display': low_swing_points + [current],
        'high_swings': [{'date': win[i]['date'], 'price': win[i]['high']} for i in high_idxs],
        'resistance': resistance,
        'signal': current,
        'breakout': resistance is not None and last_close > resistance * BREAKOUT_TOL,
        'score': score,
        'reasons': reasons,
        'interpretation': '저점과 고점이 함께 높아지고(Higher Low+High) 20일선도 상승/횡보 중인 구간으로 추정됩니다(%d점).' % score,
    }


# ---------------------------------------------------------------------------
# ② 쌍바닥(Double Bottom)
# ---------------------------------------------------------------------------

def detect_double_bottom(daily):
    win = daily[max(0, len(daily) - DOUBLE_BOTTOM_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    if len(low_idxs) < 2:
        return None

    for a in range(len(low_idxs) - 1):
        for b in range(a + 1, len(low_idxs)):
            i1, i2 = low_idxs[a], low_idxs[b]
            gap_days = i2 - i1
            if gap_days < DB_MIN_GAP_DAYS or gap_days > DB_MAX_GAP_DAYS:
                continue
            if (len(win) - 1) - i2 > RECENCY_MAX_GAP:
                continue

            low1, low2 = win[i1]['low'], win[i2]['low']
            diff = abs(low1 - low2) / min(low1, low2)
            if diff > DB_LOW_TOL:
                continue

            # 2026-07-22 개편: 두 번째 저점 거래량이 첫 번째 저점 이하
            if win[i2]['volume'] > win[i1]['volume']:
                continue

            neck = max_high_between(win, i1, i2)
            if not neck:
                continue
            rise_from_low1 = (neck['high'] - low1) / low1
            if rise_from_low1 < DB_PEAK_MIN_RISE:
                continue

            if not has_bullish_after(win, i2):
                continue

            last_close = win[-1]['close']
            proximity = (last_close - neck['high']) / neck['high']
            if proximity < DB_NECK_PROXIMITY_MIN:
                continue

            current = {'date': win[-1]['date'], 'price': last_close}
            left_peak = max_high_between(win, max(-1, i1 - 31), i1)

            # ---- 점수(100점, 2026-07-22 개편): 저점유사도35 + 넥라인형성20(고정)
            # + 거래량감소15 + 반등강도15 + 넥라인근접10 + 최근양봉5 ----
            sim_score = 35 if diff <= 0.01 else 22
            neck_form_score = 20
            vol_score = 15 if is_volume_declining(win, i1, i2) else 0
            bounce_score = 15 if rise_from_low1 >= 0.08 else 9
            neck_score = 10 if proximity >= -0.02 else 5
            bull_score = 5 if is_last_candle_bullish(win) else 0

            score = clamp_score(sim_score + neck_form_score + vol_score + bounce_score + neck_score + bull_score)
            reasons = [
                '저점 가격차 %.1f%%(%d/35점)' % (diff * 100, sim_score),
                '넥라인(중간 반등 고점) 형성 확인(%d/20점)' % neck_form_score,
                '거래량 감소(2번째 저점 거래량도 1번째 이하)(%d/15점)' % vol_score,
                '넥라인 반등폭 %.1f%%(%d/15점)' % (rise_from_low1 * 100, bounce_score),
                '현재가-넥라인 근접도(%d/10점)' % neck_score,
                '최근 캔들 %s(%d/5점)' % ('양봉' if bull_score else '음봉', bull_score),
            ]

            return {
                'leftPeak': {'date': left_peak['date'], 'price': left_peak['high']} if left_peak else None,
                'low1': {'date': win[i1]['date'], 'price': low1},
                'low2': {'date': win[i2]['date'], 'price': low2},
                'neckline': {'date': neck['date'], 'price': neck['high']},
                'current': current,
                'signal': current,
                'breakout': last_close > neck['high'] * BREAKOUT_TOL,
                'score': score,
                'reasons': reasons,
                'interpretation': '두 저점이 %.1f%% 차이로 비슷하고 2번째 저점 거래량도 줄어든 쌍바닥 구조로 추정됩니다(%d점).' % (diff * 100, score),
            }
    return None


# ---------------------------------------------------------------------------
# ③ 역헤드앤숄더(Inverse Head & Shoulders)
# ---------------------------------------------------------------------------

def detect_inv_head_shoulders(daily):
    win = daily[max(0, len(daily) - IHS_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    if len(low_idxs) < 3:
        return None

    # 2026-07-22 개편: 우어깨 형성 이후 거래량 급증(20일 평균 대비 1.2배 이상) 조건 기준선
    avg_vol20 = avg_volume(win, max(0, len(win) - 20), len(win))

    for a in range(len(low_idxs) - 2):
        for b in range(a + 1, len(low_idxs) - 1):
            for c in range(b + 1, len(low_idxs)):
                i_l, i_h, i_r = low_idxs[a], low_idxs[b], low_idxs[c]
                if (len(win) - 1) - i_r > RECENCY_MAX_GAP:
                    continue
                left, head, right = win[i_l]['low'], win[i_h]['low'], win[i_r]['low']

                if not (head < left and head < right):
                    continue
                if (left - head) / left < IHS_HEAD_MIN_DROP:
                    continue
                if (right - head) / right < IHS_HEAD_MIN_DROP:
                    continue

                shoulder_diff = abs(left - right) / min(left, right)
                if shoulder_diff > IHS_SHOULDER_TOL:
                    continue

                peak1 = max_high_between(win, i_l, i_h)
                peak2 = max_high_between(win, i_h, i_r)
                if not peak1 or not peak2:
                    continue
                neckline_price = min(peak1['high'], peak2['high'])
                neckline_point = peak1 if peak1['high'] <= peak2['high'] else peak2

                last_close = win[-1]['close']
                proximity = (last_close - neckline_price) / neckline_price
                if proximity < IHS_NECK_PROXIMITY_MIN:
                    continue

                # 2026-07-22 개편: 우어깨 형성 이후 거래량이 20일 평균 대비 1.2배 이상
                right_vol = avg_volume(win, i_r, len(win))
                if avg_vol20 <= 0 or right_vol < avg_vol20 * IHS_VOL_SURGE_RATIO:
                    continue

                current = {'date': win[-1]['date'], 'price': last_close}

                # ---- 점수(100점, 2026-07-22 개편): 형태유사도45 + 넥라인근접15 + 대칭성20
                # + 거래량15(고정) + 최근양봉5 ----
                head_drop_avg = ((left - head) / left + (right - head) / right) / 2
                shape_score = 45 if head_drop_avg >= 0.05 else 32 if head_drop_avg >= 0.03 else 18
                neck_score_ihs = 15 if proximity >= -0.01 else 8
                sym_score = 20 if shoulder_diff <= 0.02 else 12
                vol_score_ihs = 15
                bull_score = 5 if is_last_candle_bullish(win) else 0

                score = clamp_score(shape_score + neck_score_ihs + sym_score + vol_score_ihs + bull_score)
                reasons = [
                    '헤드 하락폭 평균 %.1f%%(%d/45점)' % (head_drop_avg * 100, shape_score),
                    '현재가-넥라인 근접도(%d/15점)' % neck_score_ihs,
                    '양 어깨 가격차 %.1f%%(%d/20점)' % (shoulder_diff * 100, sym_score),
                    '우어깨 이후 거래량 20일 평균 대비 급증(%d/15점)' % vol_score_ihs,
                    '최근 캔들 %s(%d/5점)' % ('양봉' if bull_score else '음봉', bull_score),
                ]

                return {
                    'left_shoulder': {'date': win[i_l]['date'], 'price': left},
                    'left_peak': {'date': peak1['date'], 'price': peak1['high']},
                    'head': {'date': win[i_h]['date'], 'price': head},
                    'right_peak': {'date': peak2['date'], 'price': peak2['high']},
                    'right_shoulder': {'date': win[i_r]['date'], 'price': right},
                    'neckline': {'date': neckline_point['date'], 'price': neckline_price},
                    'current': current,
                    'signal': current,
                    'breakout': last_close > neckline_price * BREAKOUT_TOL,
                    'score': score,
                    'reasons': reasons,
                    'interpretation': '좌우 어깨가 비슷한 높이(차이 %.1f%%)이고 거래량도 급증한 역헤드앤숄더 구조로 추정됩니다(%d점).' % (shoulder_diff * 100, score),
                }
    return None


# ---------------------------------------------------------------------------
# ④ 박스권 하단(Box Range Low)
# ---------------------------------------------------------------------------

def detect_box_range_low(daily):
    win = daily[max(0, len(daily) - BOX_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    high_idxs = find_swing_indices(win, 'high', False)
    # 2026-07-22 개편: 지지선 터치 3회 이상 + 저항선 터치 2회 이상
    if len(low_idxs) < BOX_MIN_LOW_TOUCHES or len(high_idxs) < BOX_MIN_HIGH_TOUCHES:
        return None

    # 2026-07-22 개편: 박스 기간(첫 스윙~오늘)이 최소 25거래일
    first_swing_idx = min(low_idxs[0], high_idxs[0])
    if (len(win) - 1) - first_swing_idx < BOX_MIN_DURATION:
        return None

    low_prices = [win[i]['low'] for i in low_idxs]
    high_prices = [win[i]['high'] for i in high_idxs]

    low_min, low_max = min(low_prices), max(low_prices)
    high_min, high_max = min(high_prices), max(high_prices)

    if (low_max - low_min) / low_min > BOX_TOL:
        return None
    if (high_max - high_min) / high_min > BOX_TOL:
        return None

    support = sum(low_prices) / len(low_prices)
    resistance = sum(high_prices) / len(high_prices)
    if resistance <= support:
        return None
    if (resistance - support) / support < BOX_MIN_RANGE:
        return None
    if (resistance - support) / support > BOX_MAX_RANGE:
        return None

    last_close = win[-1]['close']
    if last_close < support * (1 - 0.01):
        return None
    if (last_close - support) / support > BOX_NEAR_LOW_TOL:
        return None

    # ---- 점수(100점, 2026-07-22 개편): 박스유지25 + 지지선근접35 + 터치횟수20
    # + 거래량감소15 + 최근양봉5 ----
    flatness = max((low_max - low_min) / low_min, (high_max - high_min) / high_min)
    box_score = 25 if flatness <= 0.015 else 15
    near_ratio = (last_close - support) / support
    support_score = 35 if near_ratio <= 0.01 else 22
    extra_touches = (len(low_idxs) - BOX_MIN_LOW_TOUCHES) + (len(high_idxs) - BOX_MIN_HIGH_TOUCHES)
    touch_score = 20 if extra_touches >= 3 else 14 if extra_touches >= 1 else 8
    vol_score = 15 if is_volume_declining(win, low_idxs[0], len(win)) else 0
    bull_score = 5 if is_last_candle_bullish(win) else 0

    score = clamp_score(box_score + support_score + touch_score + vol_score + bull_score)
    reasons = [
        '박스 상/하단 평평도(%d/25점)' % box_score,
        '지지선 근접도 %.1f%%(%d/35점)' % (near_ratio * 100, support_score),
        '지지선 %d회·저항선 %d회 터치(%d/20점)' % (len(low_idxs), len(high_idxs), touch_score),
        '거래량 %s(%d/15점)' % ('감소' if vol_score else '유지/증가', vol_score),
        '최근 캔들 %s(%d/5점)' % ('양봉' if bull_score else '음봉', bull_score),
    ]

    return {
        'support': support,
        'resistance': resistance,
        'low_swings': [{'date': win[i]['date'], 'price': win[i]['low']} for i in low_idxs],
        'high_swings': [{'date': win[i]['date'], 'price': win[i]['high']} for i in high_idxs],
        'signal': {'date': win[-1]['date'], 'price': last_close},
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '박스권 하단 지지선 부근(지지선 대비 +%.1f%%)에서 반등을 시도하는 구간으로 추정됩니다(%d점).' % (near_ratio * 100, score),
    }


# ---------------------------------------------------------------------------
# ⑤ 눌림목(Pullback)
# ---------------------------------------------------------------------------

def detect_pullback(daily):
    win = daily[max(0, len(daily) - PULLBACK_WINDOW):]
    n = len(win)
    if n < 65:
        return None

    ma20 = moving_average(win, 'close', 20)
    ma60 = moving_average(win, 'close', 60)

    recent_start = max(0, n - PULLBACK_LOOKBACK - 5)
    peak_idx = recent_start
    for i in range(recent_start, n):
        if win[i]['close'] > win[peak_idx]['close']:
            peak_idx = i
    if (n - 1) - peak_idx > PULLBACK_LOOKBACK:
        return None

    low_idx = recent_start
    for j in range(recent_start, peak_idx + 1):
        if win[j]['close'] < win[low_idx]['close']:
            low_idx = j
    if low_idx >= peak_idx:
        return None

    low_close = win[low_idx]['close']
    peak_close = win[peak_idx]['close']
    rise_ratio = (peak_close - low_close) / low_close
    if rise_ratio < PULLBACK_MIN_RISE:
        return None

    last_close = win[n - 1]['close']
    drop_ratio = (peak_close - last_close) / peak_close
    if drop_ratio < PULLBACK_MIN_DROP or drop_ratio > PULLBACK_MAX_DROP:
        return None

    ma20_now = ma20[n - 1]
    ma60_now = ma60[n - 1]
    diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now else math.inf
    diff60 = abs(last_close - ma60_now) / ma60_now if ma60_now else math.inf
    if diff20 > PULLBACK_MA_TOL and diff60 > PULLBACK_MA_TOL:
        return None

    # 2026-07-22 개편: 20일선이 상승 중이어야 함
    ma20_slope_from = ma20[n - 1 - MA_SLOPE_LOOKBACK]
    if ma20_now is None or ma20_slope_from is None or ma20_now < ma20_slope_from:
        return None

    # 2026-07-22 개편: 상승구간 거래량 증가 + 조정구간 거래량 감소
    rise_vol_up = is_volume_increasing(win, low_idx, peak_idx)
    drop_vol_down = is_volume_declining(win, peak_idx, n)
    if not rise_vol_up or not drop_vol_down:
        return None

    # ---- 점수(100점, 2026-07-22 개편): 상승추세30 + 조정폭25 + 이평선위치20
    # + 거래량패턴15(고정) + 최근양봉10 ----
    rise_score = 30 if rise_ratio >= 0.25 else 22 if rise_ratio >= 0.20 else 15
    drop_score = 25 if (0.07 <= drop_ratio <= 0.12) else 15
    ma_score = 20 if (diff20 <= PULLBACK_MA_TOL and diff60 <= PULLBACK_MA_TOL) \
        else 12 if min(diff20, diff60) <= PULLBACK_MA_TOL else 0
    vol_score = 15
    bull_score = 10 if is_last_candle_bullish(win) else 0

    score = clamp_score(rise_score + drop_score + ma_score + vol_score + bull_score)
    ma_label = '20일선' if diff20 <= diff60 else '60일선'
    reasons = [
        '상승폭 %.1f%%(%d/30점)' % (rise_ratio * 100, rise_score),
        '조정폭 %.1f%%(%d/25점)' % (drop_ratio * 100, drop_score),
        '%s 근접도, 20일선 상승 중(%d/20점)' % (ma_label, ma_score),
        '상승구간 거래량 증가 + 조정구간 거래량 감소(%d/15점)' % vol_score,
        '최근 캔들 %s(%d/10점)' % ('양봉' if bull_score else '음봉', bull_score),
    ]

    return {
        'rise_start': {'date': win[low_idx]['date'], 'price': low_close},
        'peak': {'date': win[peak_idx]['date'], 'price': peak_close},
        'current': {'date': win[n - 1]['date'], 'price': last_close},
        'signal': {'date': win[n - 1]['date'], 'price': last_close},
        'ma20': ma20_now,
        'ma60': ma60_now,
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '%.1f%% 상승 후 %.1f%% 눌림목 조정을 받아 %s 부근에서 지지를 시도하는 구간으로 추정됩니다(%d점).'
                           % (rise_ratio * 100, drop_ratio * 100, ma_label, score),
    }


def scan_stock(stock, daily, pattern_results, pullback_matches):
    """단일 종목의 daily(OHLC)로 5종 패턴을 판정해 pattern_results/pullback_matches에
    append(둘 다 호출부가 미리 만들어서 넘긴 딕셔너리/리스트를 in-place로 채움).
    daily_scan.py(키움 API 기반)와 rescan_patterns.py(SQLite 기반)가 이 함수를 공유해서
    판정 로직이 두 곳에서 따로 관리되다 어긋나는 걸 방지한다.
    반환값: (패턴 스캔 대상이었는지, 눌림목 스캔 대상이었는지)."""
    pattern_scanned = False
    pullback_scanned = False

    if len(daily) >= BOX_WINDOW:
        pattern_scanned = True
        rl = detect_rising_lows(daily)
        if rl and not rl['breakout'] and pattern_grade(rl['score']) and len(pattern_results['risingLows']) < PATTERN_MAX_MATCHES:
            pattern_results['risingLows'].append(build_pattern_match(stock, daily, rl))

        db = detect_double_bottom(daily)
        if db and not db['breakout'] and pattern_grade(db['score']) and len(pattern_results['doubleBottom']) < PATTERN_MAX_MATCHES:
            pattern_results['doubleBottom'].append(build_pattern_match(stock, daily, db))

        ihs = detect_inv_head_shoulders(daily)
        if ihs and not ihs['breakout'] and pattern_grade(ihs['score']) and len(pattern_results['invHeadShoulders']) < PATTERN_MAX_MATCHES:
            pattern_results['invHeadShoulders'].append(build_pattern_match(stock, daily, ihs))

        box = detect_box_range_low(daily)
        if box and pattern_grade(box['score']) and len(pattern_results['boxRangeLow']) < PATTERN_MAX_MATCHES:
            pattern_results['boxRangeLow'].append(build_pattern_match(stock, daily, box))

    if len(daily) >= PULLBACK_MIN_DAYS:
        pullback_scanned = True
        pullback = detect_pullback(daily)
        if pullback and pattern_grade(pullback['score']) and len(pullback_matches) < PATTERN_MAX_MATCHES:
            pullback_matches.append(build_pattern_match(stock, daily, pullback))

    return pattern_scanned, pullback_scanned
