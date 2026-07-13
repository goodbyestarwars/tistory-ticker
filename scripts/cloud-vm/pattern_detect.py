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

BREAKOUT_TOL = 1.02

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


def compute_tech_score(daily):
    """이동평균 배열(40) + 지지선 근접도(30) + 저항선 근접도(30) = 0~100점.
    gas의 computeTechScoreServer_와 동일 공식."""
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
            ma_score = 40
        elif ma20 > ma60:
            ma_score = 30
        elif ma5 > ma20:
            ma_score = 20

    levels = compute_support_resistance(daily)
    support = levels['support']
    sup_score = 0
    if support:
        nearest_sup = min(support, key=lambda b: abs(b - close))
        sup_gap = (close - nearest_sup) / nearest_sup * 100
        if sup_gap < 0:
            sup_score = 0
        elif sup_gap <= 2:
            sup_score = 30
        elif sup_gap <= 5:
            sup_score = 20
        elif sup_gap <= 8:
            sup_score = 10

    resistance = levels['resistance']
    res_score = 0
    if resistance:
        nearest_res = min(resistance, key=lambda b: abs(b - close))
        res_gap = (nearest_res - close) / close * 100
        if res_gap < 0:
            res_score = 30
        elif res_gap <= 3:
            res_score = 20
        elif res_gap <= 8:
            res_score = 10

    return {'score': ma_score + sup_score + res_score}


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

    if (len(win) - 1) - last_low_idx > RECENCY_MAX_GAP:
        return None

    last_close = win[-1]['close']
    if last_close < last_low * 0.98:
        return None
    if (last_close - last_low) / last_low > WEDGE_MAX_EXTENSION:
        return None

    low_swing_points = [{'date': win[i]['date'], 'price': win[i]['low']} for i in low_idxs]
    current = {'date': win[-1]['date'], 'price': last_close}

    rise_score = score_tier(rise_ratio, [
        {'min': 0.08, 'score': 40}, {'min': 0.05, 'score': 30}, {'min': WEDGE_MIN_LOW_RISE, 'score': 20}
    ])
    span_score = 20

    ma5 = moving_average(win, 'close', 5)
    resistance = max((win[i]['high'] for i in high_idxs), default=None)
    resistance_idx = high_idxs[-1] if high_idxs else None
    ma5_at_resistance = ma5[resistance_idx] if resistance_idx is not None else None
    ma5_diff = abs(win[resistance_idx]['high'] - ma5_at_resistance) / ma5_at_resistance if ma5_at_resistance else 1
    ma5_score = 20 if ma5_diff <= 0.02 else 10 if ma5_diff <= 0.05 else 0

    vol_score = 10 if is_volume_declining(win, prev_low_idx, len(win)) else 0
    bull_score = 10 if is_last_candle_bullish(win) else 0

    score = clamp_score(rise_score + span_score + ma5_score + vol_score + bull_score)
    reasons = [
        '저점 %.1f%% 상승(%d/40점)' % (rise_ratio * 100, rise_score),
        '저점 간격 %d거래일(%d/20점)' % (low_span, span_score),
        '5일선 저항 근접도(%d/20점)' % ma5_score,
        '거래량 %s(%d/10점)' % ('감소' if vol_score else '유지/증가', vol_score),
        '최근 캔들 %s(%d/10점)' % ('양봉' if bull_score else '음봉', bull_score),
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
        'interpretation': '저점이 %.1f%% 높아지며 하락 압력이 약해지는 구간으로 추정됩니다(%d점).' % (rise_ratio * 100, score),
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

            sim_score = 40 if diff <= 0.01 else 25 if diff <= DB_LOW_TOL else 0
            gap_score = 20
            bounce_score = 20 if rise_from_low1 >= 0.08 else 12 if rise_from_low1 >= DB_PEAK_MIN_RISE else 0
            vol_score = 10 if is_volume_declining(win, i1, i2) else 0
            neck_score = 10 if proximity >= -0.02 else 5

            score = clamp_score(sim_score + gap_score + bounce_score + vol_score + neck_score)
            reasons = [
                '저점 가격차 %.1f%%(%d/40점)' % (diff * 100, sim_score),
                '저점 간격 %d거래일(%d/20점)' % (gap_days, gap_score),
                '넥라인 반등폭 %.1f%%(%d/20점)' % (rise_from_low1 * 100, bounce_score),
                '거래량 %s(%d/10점)' % ('감소' if vol_score else '유지/증가', vol_score),
                '현재가-넥라인 근접도(%d/10점)' % neck_score,
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
                'interpretation': '두 저점이 %.1f%% 차이로 비슷한 쌍바닥 구조로 추정됩니다(%d점).' % (diff * 100, score),
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

                current = {'date': win[-1]['date'], 'price': last_close}

                head_drop_avg = ((left - head) / left + (right - head) / right) / 2
                shape_score = 50 if head_drop_avg >= 0.05 else 35 if head_drop_avg >= 0.03 else 20
                neck_score_ihs = 20 if proximity >= -0.01 else 10
                sym_score = 20 if shoulder_diff <= 0.02 else 12 if shoulder_diff <= IHS_SHOULDER_TOL else 0
                vol_score_ihs = 10 if is_volume_declining(win, i_l, i_r) else 0

                score = clamp_score(shape_score + neck_score_ihs + sym_score + vol_score_ihs)
                reasons = [
                    '헤드 하락폭 평균 %.1f%%(%d/50점)' % (head_drop_avg * 100, shape_score),
                    '현재가-넥라인 근접도(%d/20점)' % neck_score_ihs,
                    '양 어깨 가격차 %.1f%%(%d/20점)' % (shoulder_diff * 100, sym_score),
                    '거래량 %s(%d/10점)' % ('감소' if vol_score_ihs else '유지/증가', vol_score_ihs),
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
                    'interpretation': '좌우 어깨가 비슷한 높이(차이 %.1f%%)의 역헤드앤숄더 구조로 추정됩니다(%d점).' % (shoulder_diff * 100, score),
                }
    return None


# ---------------------------------------------------------------------------
# ④ 박스권 하단(Box Range Low)
# ---------------------------------------------------------------------------

def detect_box_range_low(daily):
    win = daily[max(0, len(daily) - BOX_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    high_idxs = find_swing_indices(win, 'high', False)
    if len(low_idxs) < 2 or len(high_idxs) < 2:
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

    flatness = max((low_max - low_min) / low_min, (high_max - high_min) / high_min)
    box_score = 30 if flatness <= 0.015 else 18 if flatness <= BOX_TOL else 0
    near_ratio = (last_close - support) / support
    support_score = 40 if near_ratio <= 0.01 else 25 if near_ratio <= BOX_NEAR_LOW_TOL else 0
    vol_score = 20 if is_volume_declining(win, low_idxs[0], len(win)) else 0
    bull_score = 10 if is_last_candle_bullish(win) else 0

    score = clamp_score(box_score + support_score + vol_score + bull_score)
    reasons = [
        '박스 상/하단 평평도(%d/30점)' % box_score,
        '지지선 근접도 %.1f%%(%d/40점)' % (near_ratio * 100, support_score),
        '거래량 %s(%d/20점)' % ('감소' if vol_score else '유지/증가', vol_score),
        '최근 캔들 %s(%d/10점)' % ('양봉' if bull_score else '음봉', bull_score),
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

    rise_score = 30 if rise_ratio >= 0.25 else 22 if rise_ratio >= 0.20 else 15
    drop_score = 30 if (0.07 <= drop_ratio <= 0.12) else 18
    ma_score = 20 if (diff20 <= PULLBACK_MA_TOL and diff60 <= PULLBACK_MA_TOL) \
        else 12 if min(diff20, diff60) <= PULLBACK_MA_TOL else 0
    vol_score = 10 if is_volume_declining(win, peak_idx, n) else 0
    bull_score = 10 if is_last_candle_bullish(win) else 0

    score = clamp_score(rise_score + drop_score + ma_score + vol_score + bull_score)
    ma_label = '20일선' if diff20 <= diff60 else '60일선'
    reasons = [
        '상승폭 %.1f%%(%d/30점)' % (rise_ratio * 100, rise_score),
        '조정폭 %.1f%%(%d/30점)' % (drop_ratio * 100, drop_score),
        '%s 근접도(%d/20점)' % (ma_label, ma_score),
        '거래량 %s(%d/10점)' % ('감소' if vol_score else '유지/증가', vol_score),
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
