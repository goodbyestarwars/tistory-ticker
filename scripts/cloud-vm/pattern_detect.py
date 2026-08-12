# -*- coding: utf-8 -*-
"""차트 패턴 판정(지시서 6종) - gas/ticker-proxy.gs의 detectRisingLows_/detectDoubleBottom_/
detectInvHeadShoulders_/detectBoxRangeLow_/detectPullback_ 및 공용 헬퍼를 그대로 포팅.
수치 조건/배점은 원본과 동일해야 두 구현의 판정 결과가 일치한다 - 상수를 바꾸지 말 것."""

import math

PATTERN_SWING = 2
PATTERN_MAX_MATCHES = 30
RISING_LOWS_DISPLAY_LIMIT = 15

RISING_LOWS_WINDOW = 20
MA_CLOUD_MIN_DAYS = 250
MA_CLOUD_NEAR_TOL = 0.03       # 현재가와 224일선 사이 최대 3%
MA_CLOUD_TOP_TOL = 0.03        # 구름 상단을 향한 현재 봉의 고가 근접도 최대 3%
MA_CLOUD_CROSS_LOOKBACK = 5    # 최근 5봉 안의 5일선-20일선 골든크로스
DOUBLE_BOTTOM_WINDOW = 90
IHS_WINDOW = 60
BOX_WINDOW = 40

WEDGE_MIN_SWINGS = 2
RECENCY_MAX_GAP = 3

DB_LOW_TOL = 0.02
DB_MIN_GAP_DAYS = 12
DB_MAX_GAP_DAYS = 35
DB_PEAK_MIN_RISE = 0.08
DB_NECK_PROXIMITY_MIN = -0.02
DB_SECOND_VOLUME_MAX_RATIO = 0.85

IHS_SHOULDER_TOL = 0.03
IHS_HEAD_MIN_DROP = 0.03
IHS_NECK_PROXIMITY_MIN = -0.01
IHS_NECK_MIN_RISE = 0.05
IHS_MIN_SHOULDER_GAP = 5
IHS_MAX_SHOULDER_GAP = 30

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
IHS_VOL_SURGE_RATIO = 1.5  # 역헤드앤숄더: 우어깨 이후 거래량이 20일 평균 대비 1.5배 이상

PULLBACK_WINDOW = 260
PULLBACK_LOOKBACK = 20
PULLBACK_MIN_RISE = 0.15
PULLBACK_MIN_DROP = 0.05
PULLBACK_MAX_DROP = 0.15
PULLBACK_MA_TOL = 0.03
PULLBACK_MIN_DAYS = 240  # 1년선(240거래일) 계산에 필요한 최소 보유 일수


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


def ichimoku_cloud_at(daily, index):
    """해당 봉에 표시되는 현재 구름(26봉 선행)의 상·하단을 반환한다."""
    source_index = index - ICHIMOKU_DISPLACEMENT
    if source_index < 0:
        return None
    span_a_base = ichimoku_period_mid(daily, source_index, ICHIMOKU_TENKAN_PERIOD)
    span_a_kijun = ichimoku_period_mid(daily, source_index, ICHIMOKU_KIJUN_PERIOD)
    span_b = ichimoku_period_mid(daily, source_index, ICHIMOKU_SENKOU_B_PERIOD)
    if span_a_base is None or span_a_kijun is None or span_b is None:
        return None
    span_a = (span_a_base + span_a_kijun) / 2
    return {
        'spanA': span_a,
        'spanB': span_b,
        'top': max(span_a, span_b),
        'bottom': min(span_a, span_b),
    }


# 오늘 거래대금(종가x거래량) / 최근 20일(오늘 제외) 평균 거래대금.
# js/foreign-flow.js의 computeVolumeMultiple과 동일 공식.
def compute_volume_multiple(daily):
    if not daily or len(daily) < 21:
        return None
    today = daily[-1]
    if not today.get('volume'):
        return None
    today_amt = today['close'] * today['volume']
    win = daily[-21:-1]
    avg_amt = (sum(d['close'] * d['volume'] for d in win) / len(win)) if win else 0
    if not avg_amt:
        return None
    return {'today': today_amt, 'avg20': avg_amt, 'multiple': today_amt / avg_amt}


# 거래량 점수(15점 만점) - 단순히 거래량이 많을수록 고득점이 아니라 가격 방향과 같이 본다
# (급증+상승=강한 확인 15점, 급증+하락=분산·투매 경고 0점). js/foreign-flow.js의
# computeVolumeScore와 동일 공식으로 유지할 것.
def compute_volume_score(daily):
    vm = compute_volume_multiple(daily)
    if not vm:
        return {'score': 0}
    last, prev = daily[-1], daily[-2]
    change_pct = ((last['close'] - prev['close']) / prev['close'] * 100) if prev.get('close') else 0
    mult = vm['multiple']
    if mult >= 2:
        if change_pct > 0.3:
            score = 15
        elif change_pct < -0.3:
            score = 0
        else:
            score = 8
    elif mult >= 1.3:
        if change_pct > 0.3:
            score = 11
        elif change_pct < -0.3:
            score = 4
        else:
            score = 7
    elif mult >= 0.7:
        score = 7
    else:
        score = 5
    return {'score': score}


def compute_tech_score(daily):
    """이동평균(25) + 지지선 근접도(15) + 저항선 근접도(15) + 일목균형표(30) + 거래량(15)
    = 0~100점. js/foreign-flow.js의 computeTechnicalScore와 동일 공식 - 종목분석/투자시그널
    등급이 어긋나지 않으려면 두 구현을 같이 고칠 것."""
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
            ma_score = 25
        elif ma20 > ma60:
            ma_score = 17
        elif ma5 > ma20:
            ma_score = 8

    levels = compute_support_resistance(daily)
    support = levels['support']
    sup_score = 0
    if support:
        nearest_sup = min(support, key=lambda b: abs(b - close))
        sup_gap = (close - nearest_sup) / nearest_sup * 100
        if sup_gap < 0:
            sup_score = 0
        elif sup_gap <= 2:
            sup_score = 15
        elif sup_gap <= 5:
            sup_score = 9
        elif sup_gap <= 8:
            sup_score = 4

    resistance = levels['resistance']
    res_score = 0
    if resistance:
        nearest_res = min(resistance, key=lambda b: abs(b - close))
        res_gap = (nearest_res - close) / close * 100
        if res_gap < 0:
            res_score = 15
        elif res_gap <= 3:
            res_score = 9
        elif res_gap <= 8:
            res_score = 4

    ichi_score = compute_ichimoku_score(daily)['score']
    vol_score = compute_volume_score(daily)['score']

    return {'score': ma_score + sup_score + res_score + ichi_score + vol_score}


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
        # 상세 클릭 시 장중 봉으로 재판정하지 않아도 전날 스캔 근거선을 그대로 그릴 수 있게
        # 패턴 좌표(저점/고점/넥라인/지지·저항)를 스냅샷에 함께 보관한다.
        'patternDetail': detail,
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
    if last_low <= prev_low:
        return None

    last_close = win[-1]['close']
    if last_close < last_low:
        return None
    low_swing_points = [{'date': win[i]['date'], 'price': win[i]['low']} for i in low_idxs]
    current = {'date': win[-1]['date'], 'price': last_close}

    # 저점상승형은 Higher Low 자체를 먼저 포착한다. Higher High와 20일선 상승은
    # 추세 전환 확인 신호이지, 아직 형성 중인 저점상승형을 제외할 필수 조건은 아니다.
    # 이 구분을 하지 않으면 가온칩스처럼 저점은 높아졌지만 고점/20일선은 아직 낮은
    # 초기 반등 종목이 검색 결과에서 누락된다.
    # 점수는 참고용이다. 검색 포함 여부는 위의 Higher Low 조건만으로 결정한다.
    higher_low_score = 40
    recent_low_score = 20

    ma5 = moving_average(win, 'close', 5)
    resistance = max((win[i]['high'] for i in high_idxs), default=None)
    resistance_idx = high_idxs[-1] if high_idxs else None
    ma5_at_resistance = ma5[resistance_idx] if resistance_idx is not None else None
    ma5_diff = abs(win[resistance_idx]['high'] - ma5_at_resistance) / ma5_at_resistance if ma5_at_resistance else 1
    ma5_score = 20 if ma5_diff <= 0.02 else 10 if ma5_diff <= 0.05 else 0

    vol_score = 10 if is_volume_declining(win, last_low_idx, len(win)) else 0
    bull_score = 10 if is_last_candle_bullish(win) else 0

    score = clamp_score(higher_low_score + recent_low_score + ma5_score + vol_score + bull_score)
    reasons = [
        '스윙 저점 순차 상승(%d/40점)' % higher_low_score,
        '최근 저점 상승 확인(%d/20점)' % recent_low_score,
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
        'interpretation': '최근 20거래일 안에서 최근 두 스윙 저점이 높아지고 현재가가 마지막 저점 위에 있는 상승 구간으로 추정됩니다(%d점).' % score,
    }


# ---------------------------------------------------------------------------
# ② 이평 상승 초입형(224일선 + 구름대 + 5일선 골든크로스)
# ---------------------------------------------------------------------------

def detect_ma_cloud_breakout(daily):
    """장기 추세선 근처에서 구름 상단을 시도하는 초기 골든크로스를 찾는다.

    모든 조건은 최신 봉을 기준으로 한다. 현재 종가가 이미 구름 상단을 넘은
    종목은 '뚫으려고 하는 중'이 아니라 돌파가 끝난 것으로 보고 제외한다.
    """
    if len(daily) < MA_CLOUD_MIN_DAYS:
        return None

    ma5 = moving_average(daily, 'close', 5)
    ma20 = moving_average(daily, 'close', 20)
    ma224 = moving_average(daily, 'close', 224)
    last_index = len(daily) - 1
    close = daily[last_index]['close']
    ma224_now = ma224[last_index]
    if ma224_now is None or not ma224_now:
        return None

    ma224_gap = abs(close - ma224_now) / ma224_now
    if ma224_gap > MA_CLOUD_NEAR_TOL:
        return None

    cloud = ichimoku_cloud_at(daily, last_index)
    if not cloud or cloud['top'] <= 0:
        return None
    # 종가는 아직 구름 안에 있어야 하며, 고가는 상단에 닿거나 상단 3% 이내여야 한다.
    if close < cloud['bottom'] or close > cloud['top']:
        return None
    if daily[last_index]['high'] < cloud['top'] * (1 - MA_CLOUD_TOP_TOL):
        return None

    cross_index = None
    first_cross_index = max(1, last_index - MA_CLOUD_CROSS_LOOKBACK + 1)
    for i in range(first_cross_index, last_index + 1):
        if ma5[i - 1] is None or ma20[i - 1] is None or ma5[i] is None or ma20[i] is None:
            continue
        if ma5[i - 1] <= ma20[i - 1] and ma5[i] > ma20[i]:
            cross_index = i
    if cross_index is None:
        return None

    ma5_now, ma20_now = ma5[last_index], ma20[last_index]
    if ma5_now is None or ma20_now is None:
        return None

    cloud_gap = (cloud['top'] - close) / cloud['top']
    score = clamp_score(
        (35 if ma224_gap <= 0.015 else 25)
        + (35 if cloud_gap <= 0.01 else 25)
        + 30
    )
    signal = {'date': daily[last_index]['date'], 'price': close}
    reasons = [
        '224일선 근접도 %.1f%%(%d/35점)' % (ma224_gap * 100, 35 if ma224_gap <= 0.015 else 25),
        '현재가 구름 안·상단 시도(%d/35점)' % (35 if cloud_gap <= 0.01 else 25),
        '최근 %d봉 안 5일선이 20일선 상향돌파(30/30점)' % MA_CLOUD_CROSS_LOOKBACK,
    ]
    return {
        'ma5': ma5_now,
        'ma20': ma20_now,
        'ma224': ma224_now,
        'cloud': cloud,
        'cross': {'date': daily[cross_index]['date'], 'price': daily[cross_index]['close']},
        'signal': signal,
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '주가가 224일선 근처에서 일목 구름 안에 머물며 상단 돌파를 시도하고, 최근 %d봉 안에 5일선이 20일선을 상향돌파한 상승 초입으로 추정됩니다(%d점).' % (MA_CLOUD_CROSS_LOOKBACK, score),
    }


# ---------------------------------------------------------------------------
# ③ 쌍바닥(Double Bottom)
# ---------------------------------------------------------------------------

def detect_double_bottom(daily):
    win = daily[max(0, len(daily) - DOUBLE_BOTTOM_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    if len(low_idxs) < 2:
        return None

    # 오래된 조합을 억지로 찾지 않고 가장 최근 두 저점만 쌍바닥 후보로 본다.
    for a in [len(low_idxs) - 2]:
        for b in [len(low_idxs) - 1]:
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
            if win[i2]['volume'] > win[i1]['volume'] * DB_SECOND_VOLUME_MAX_RATIO:
                continue

            neck = max_high_between(win, i1, i2)
            if not neck:
                continue
            rise_from_low1 = (neck['high'] - low1) / low1
            if rise_from_low1 < DB_PEAK_MIN_RISE:
                continue

            if not has_bullish_after(win, i2) or not is_last_candle_bullish(win):
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

    # 오래된 조합을 억지로 찾지 않고 가장 최근 세 저점만 역헤드앤숄더 후보로 본다.
    for a in [len(low_idxs) - 3]:
        for b in [len(low_idxs) - 2]:
            for c in [len(low_idxs) - 1]:
                i_l, i_h, i_r = low_idxs[a], low_idxs[b], low_idxs[c]
                if (len(win) - 1) - i_r > RECENCY_MAX_GAP:
                    continue
                left_gap = i_h - i_l
                right_gap = i_r - i_h
                if left_gap < IHS_MIN_SHOULDER_GAP or right_gap < IHS_MIN_SHOULDER_GAP:
                    continue
                if left_gap > IHS_MAX_SHOULDER_GAP or right_gap > IHS_MAX_SHOULDER_GAP:
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
                if (peak1['high'] - head) / head < IHS_NECK_MIN_RISE:
                    continue
                if (peak2['high'] - head) / head < IHS_NECK_MIN_RISE:
                    continue
                neckline_price = min(peak1['high'], peak2['high'])
                neckline_point = peak1 if peak1['high'] <= peak2['high'] else peak2

                last_close = win[-1]['close']
                proximity = (last_close - neckline_price) / neckline_price
                if proximity < IHS_NECK_PROXIMITY_MIN:
                    continue
                if not is_last_candle_bullish(win):
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
    if n < 240:
        return None

    ma20 = moving_average(win, 'close', 20)
    ma240 = moving_average(win, 'close', 240)

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
    ma240_now = ma240[n - 1]
    diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now else math.inf
    diff240 = abs(last_close - ma240_now) / ma240_now if ma240_now else math.inf
    if diff20 > PULLBACK_MA_TOL and diff240 > PULLBACK_MA_TOL:
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
    ma_score = 20 if (diff20 <= PULLBACK_MA_TOL and diff240 <= PULLBACK_MA_TOL) \
        else 12 if min(diff20, diff240) <= PULLBACK_MA_TOL else 0
    vol_score = 15
    bull_score = 10 if is_last_candle_bullish(win) else 0

    score = clamp_score(rise_score + drop_score + ma_score + vol_score + bull_score)
    ma_label = '20일선' if diff20 <= diff240 else '1년선(240일선)'
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
        'ma240': ma240_now,
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '%.1f%% 상승 후 %.1f%% 눌림목 조정을 받아 %s 부근에서 지지를 시도하는 구간으로 추정됩니다(%d점).'
                           % (rise_ratio * 100, drop_ratio * 100, ma_label, score),
    }


def scan_stock(stock, daily, pattern_results, pullback_matches):
    """단일 종목의 daily(OHLC)로 6종 패턴을 판정해 pattern_results/pullback_matches에
    append(둘 다 호출부가 미리 만들어서 넘긴 딕셔너리/리스트를 in-place로 채움).
    daily_scan.py(키움 API 기반)와 rescan_patterns.py(SQLite 기반)가 이 함수를 공유해서
    판정 로직이 두 곳에서 따로 관리되다 어긋나는 걸 방지한다.
    반환값: (패턴 스캔 대상이었는지, 눌림목 스캔 대상이었는지)."""
    pattern_scanned = False
    pullback_scanned = False
    pattern_results.setdefault('maCloudBreakout', [])

    if len(daily) >= RISING_LOWS_WINDOW:
        pattern_scanned = True
        rl = detect_rising_lows(daily)
        if rl and not rl['breakout']:
            pattern_results['risingLows'].append(build_pattern_match(stock, daily, rl))

    if len(daily) >= MA_CLOUD_MIN_DAYS:
        pattern_scanned = True
        ma_cloud = detect_ma_cloud_breakout(daily)
        if ma_cloud and len(pattern_results['maCloudBreakout']) < PATTERN_MAX_MATCHES:
            pattern_results['maCloudBreakout'].append(build_pattern_match(stock, daily, ma_cloud))

    if len(daily) >= BOX_WINDOW:
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


def finalize_pattern_results(pattern_results):
    """Keep the strongest and most recent rising-lows candidates for the UI.

    Candidates are collected for the full scan before this function runs so a
    stock cannot be hidden merely because it appears late in universe order.
    """
    rising_lows = pattern_results.get('risingLows') or []
    rising_lows.sort(key=lambda item: item.get('code') or '')
    rising_lows.sort(key=lambda item: item.get('date') or '', reverse=True)
    rising_lows.sort(key=lambda item: item.get('score') or 0, reverse=True)
    pattern_results['risingLows'] = rising_lows[:RISING_LOWS_DISPLAY_LIMIT]
    ma_cloud = pattern_results.get('maCloudBreakout') or []
    ma_cloud.sort(key=lambda item: item.get('date') or '', reverse=True)
    ma_cloud.sort(key=lambda item: item.get('score') or 0, reverse=True)
    pattern_results['maCloudBreakout'] = ma_cloud[:RISING_LOWS_DISPLAY_LIMIT]
    return pattern_results
