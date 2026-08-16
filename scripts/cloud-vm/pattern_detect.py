# -*- coding: utf-8 -*-
"""VM 차트 패턴 판정(지시서 6종)과 공용 헬퍼.
일반 패턴은 GAS 상세 차트와 같은 기준을 사용하지만, 박스권 하단은 VM 일괄 스캔에서
시가총액까지 조회하는 A/B/C/D/E/G/J 전용 조건을 적용한다."""

import math
import re

PATTERN_SWING = 2
# A pattern bucket may contain at most this many candidates after its
# chart-quality gates are applied. We do not slice by universe order.
PATTERN_MAX_MATCHES = 20
RISING_LOWS_DISPLAY_LIMIT = 20
PENNY_STOCK_MAX_PRICE = 1000  # 국내 주식 기준: 1,000원 미만은 동전주로 제외

ETF_NAME_PREFIXES = (
    '1Q ', 'ACE ', 'ARIRANG ', 'HANARO ', 'KBSTAR ', 'KODEX ', 'KOSEF ',
    'PLUS ', 'RISE ', 'SOL ', 'TIGER ', 'TIME ', 'TREX ', 'WON ', 'FOCUS ',
    'UNICORN ', 'TRUSTON ', '마이티 ', '파워 ', '에셋플러스 ',
)
ETF_NAME_TOKENS = re.compile(r'(?:ETF|레버리지|인버스|커버드콜|채권혼합|합성|선물)', re.IGNORECASE)
NON_COMMON_STOCK_NAME_TOKENS = re.compile(r'(?:ETN|스팩|SPAC|우선주|거래정지|정리매매|관리종목)', re.IGNORECASE)
PREFERRED_STOCK_SUFFIX = re.compile(r'(?:\d+)?우(?:[A-Z])?(?:\(전환\))?$')

OPENING_GAP_MIN_INTRADAY_PCT = 3.0
OPENING_GAP_MIN_OPEN = 1_000
OPENING_GAP_MAX_OPEN = 500_000
OPENING_GAP_MIN_TURNOVER_MILLION = 3_000
OPENING_GAP_MAX_TURNOVER_MILLION = 999_999

RISING_LOWS_WINDOW = 20
MA_CLOUD_MIN_DAYS = 250
MA_CLOUD_NEAR_TOL = 0.03       # 현재가와 224일선 사이 최대 3%
MA_CLOUD_TOP_TOL = 0.03        # 구름 상단을 향한 현재 봉의 고가 근접도 최대 3%
MA_CLOUD_CROSS_LOOKBACK = 5    # 최근 5봉 안의 5일선-20일선 골든크로스
DOUBLE_BOTTOM_WINDOW = 120
IHS_WINDOW = 90
BOX_WINDOW = 21  # 20 bars for the range plus the 20-bars-ago reference bar

WEDGE_MIN_SWINGS = 2
RECENCY_MAX_GAP = 3

DB_LOW_TOL = 0.03
DB_MIN_GAP_DAYS = 10
DB_MAX_GAP_DAYS = 45
DB_PEAK_MIN_RISE = 0.08
DB_NECK_PROXIMITY_MIN = -0.02
DB_SECOND_VOLUME_MAX_RATIO = 1.00

IHS_SHOULDER_TOL = 0.04
IHS_HEAD_MIN_DROP = 0.02
IHS_NECK_PROXIMITY_MIN = -0.01
IHS_NECK_MIN_RISE = 0.03
IHS_MIN_SHOULDER_GAP = 4
IHS_MAX_SHOULDER_GAP = 40
DB_RECENCY_MAX_GAP = 5
IHS_RECENCY_MAX_GAP = 5

BOX_CLOSE_RANGE_MAX = 0.10
BOX_MA_NEAR_TOL = 0.03
BOX_MA_NEAR_COUNT = 3
BOX_RSI_PERIOD = 14
BOX_RSI_MIN = 35.0
BOX_RSI_MAX = 65.0
BOX_VOLUME_AVG_PERIOD = 5
BOX_VOLUME_REFERENCE_OFFSET = 20
BOX_VOLUME_RATIO_MIN = 0.50
BOX_VOLUME_RATIO_MAX = 1.20
BOX_MARKET_CAP_MIN_EOK = 3000.0
BOX_OPEN_MA_ABOVE_COUNT = 3
BOX_RETURN_MAX = 0.10
BOX_LOWER_ZONE_RATIO = 0.35

# 모든 차트검색/눌림목 검색에 적용하는 공통 조건. 패턴별 점수와 섞지 않고
# 후보 자체를 만들기 전에 거르는 하드필터다.
COMMON_MARKET_CAP_MIN_EOK = 3000.0

BREAKOUT_TOL = 1.02

# 2026-07-22 개편: 저점상승형 20일선 기울기 / 눌림목 20일선 상승 확인에 공용으로 쓰는
# "며칠 전과 비교할지" 값(gas/ticker-proxy.gs와 동일하게 5거래일).
MA_SLOPE_LOOKBACK = 5
IHS_VOL_SURGE_RATIO = 1.20  # 역헤드앤숄더: 우어깨 이후 거래량이 20일 평균 대비 1.2배 이상

PULLBACK_WINDOW = 260
PULLBACK_LOOKBACK = 20
PULLBACK_MIN_RISE = 0.15
PULLBACK_MIN_DROP = 0.05
PULLBACK_MAX_DROP = 0.15
PULLBACK_MA_TOL = 0.03
PULLBACK_MIN_DAYS = 240  # 1년선(240거래일) 계산에 필요한 최소 보유 일수

# Conservative score floors filter weak structures before the display cap.
# Scores combine shape, support, volume, and recent-candle evidence, so the
# result does not depend on the order in which symbols are scanned.
IHS_MIN_SCORE = 70
PULLBACK_MIN_SCORE = 80


# ---------------------------------------------------------------------------
# 공용 헬퍼
# ---------------------------------------------------------------------------

def is_etf_name(name):
    """Return whether a KRX display name looks like an ETF/security product."""
    value = str(name or '').strip()
    if not value:
        return False
    if any(value.startswith(prefix) for prefix in ETF_NAME_PREFIXES):
        return True
    return bool(ETF_NAME_TOKENS.search(value))


def is_excluded_stock(stock, daily):
    """Exclude the non-common-stock/status categories from chart scans."""
    stock = stock or {}
    name = str(stock.get('name') or '').strip()
    if bool(stock.get('is_etf')) or is_etf_name(name):
        return True
    if NON_COMMON_STOCK_NAME_TOKENS.search(name) or PREFERRED_STOCK_SUFFIX.search(name):
        return True
    if stock.get('is_trading_halted') or stock.get('is_under_liquidation') or stock.get('is_loan_available'):
        return True
    if not daily:
        return False
    latest_close = daily[-1].get('close')
    latest_volume = daily[-1].get('volume')
    try:
        # No volume on the latest bar is the reliable local-data proxy for a
        # trading halt; status flags above are used when the upstream provides them.
        return float(latest_close) < PENNY_STOCK_MAX_PRICE or float(latest_volume or 0) <= 0
    except (TypeError, ValueError):
        return False


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


def rsi_last(win, period=14, field='close'):
    """Return Wilder RSI for the latest bar, or None when history is short."""
    if len(win) <= period:
        return None
    gains = []
    losses = []
    for i in range(1, len(win)):
        change = win[i][field] - win[i - 1][field]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[i]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + (avg_gain / avg_loss)))


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


def pattern_grade(score, minimum=70):
    return score >= minimum


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


# 시초 갭상승 조건검색(B/K/G/L).
def detect_opening_gap(daily):
    if len(daily) < 2:
        return None
    previous = daily[-2]
    current = daily[-1]
    previous_close = previous.get('close')
    open_price = current.get('open')
    close_price = current.get('close')
    volume = current.get('volume')
    if not previous_close or not open_price or not close_price or not volume:
        return None

    gap_rate_pct = (open_price / previous_close - 1) * 100
    intraday_rate_pct = (close_price / open_price - 1) * 100
    turnover_million = close_price * volume / 1_000_000
    if not open_price > previous_close:  # B
        return None
    if intraday_rate_pct < OPENING_GAP_MIN_INTRADAY_PCT:  # K
        return None
    if not OPENING_GAP_MIN_OPEN <= open_price <= OPENING_GAP_MAX_OPEN:  # G
        return None
    if not OPENING_GAP_MIN_TURNOVER_MILLION <= turnover_million <= OPENING_GAP_MAX_TURNOVER_MILLION:  # L
        return None

    score = clamp_score(round(70 + min(20, intraday_rate_pct * 2) + min(10, gap_rate_pct)))
    return {
        'signal': {'date': current.get('date'), 'price': close_price},
        'breakout': False,
        'score': score,
        'reasons': [
            'B 시가가 전일 종가보다 %.1f%% 높음' % gap_rate_pct,
            'K 종가가 시가 대비 %.1f%% 상승' % intraday_rate_pct,
            'G 시가 %s원' % format(open_price, ','),
            'L 거래대금 %.1f백만원' % turnover_million,
        ],
        'interpretation': '전일 종가보다 높게 시작한 뒤 시가 대비 %.1f%% 추가 상승한 갭상승 후보입니다(%d점).'
                           % (intraday_rate_pct, score),
        'previousClose': previous_close,
        'open': open_price,
        'gapRatePct': gap_rate_pct,
        'intradayRatePct': intraday_rate_pct,
        'turnoverMillion': turnover_million,
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
    # 결과 리스트의 스캐너 미니차트 전용 스냅샷. 판정·점수 계산은 건드리지 않고,
    # 목록에서 종목마다 별도 OHLC 요청을 만들지 않도록 최근 종가 20개만 함께 보관한다.
    mini_chart = [
        {'date': row.get('date'), 'close': row.get('close')}
        for row in daily[-20:]
        if row.get('date') and row.get('close') is not None
    ]
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last['date'],
        'miniChart': mini_chart,
        'score': detail['score'],
        'reasons': detail['reasons'],
        'interpretation': detail['interpretation'],
        # 상세 클릭 시 장중 봉으로 재판정하지 않아도 전날 스캔 근거선을 그대로 그릴 수 있게
        # 패턴 좌표(저점/고점/넥라인/지지·저항)를 스냅샷에 함께 보관한다.
        'patternDetail': detail,
    }


def _quality_gate_matches(matches, pattern_key):
    """Tighten chart conditions only when a bucket is larger than 20.

    The gates are deliberately score/structure based. A candidate is never
    removed just because it appeared later in the universe scan.
    """
    matches = list(matches or [])
    if len(matches) <= PATTERN_MAX_MATCHES:
        return matches

    def score_at_least(item, threshold):
        try:
            return float(item.get('score') or 0) >= threshold
        except (TypeError, ValueError):
            return False

    def passes_gate(item, stage):
        detail = item.get('patternDetail') or {}
        criteria = detail.get('criteria') or {}
        if pattern_key == 'risingLows':
            # First remove weak resistance/volume/current-candle confirmations,
            # then keep only the strongest higher-low structures.
            return score_at_least(item, 80 if stage == 1 else 90)
        if pattern_key == 'maCloudBreakout':
            return score_at_least(item, 90 if stage == 1 else 95)
        if pattern_key == 'doubleBottom':
            return score_at_least(item, 80 if stage == 1 else 90)
        if pattern_key == 'invHeadShoulders':
            return score_at_least(item, 90 if stage == 1 else 95)
        if pattern_key == 'boxRangeLow':
            if stage == 1:
                return score_at_least(item, 80)
            if criteria:
                lower_position = criteria.get('lowerPositionPct')
                close_range = criteria.get('closeRangePct')
                if lower_position is not None and close_range is not None:
                    return lower_position <= 25 and close_range <= 8
            return score_at_least(item, 90 if stage == 2 else 95)
        if pattern_key == 'openingGap':
            if stage == 1:
                return score_at_least(item, 80)
            intraday = detail.get('intradayRatePct')
            gap = detail.get('gapRatePct')
            if intraday is not None and gap is not None:
                return intraday >= 4.5 and gap >= 1.0
            return score_at_least(item, 90 if stage == 2 else 95)
        if pattern_key == 'pullback':
            return score_at_least(item, 85 if stage == 1 else 90)
        return score_at_least(item, 90 if stage == 1 else 95)

    # Each stage is stricter than the previous one. If a stage brings the
    # bucket to 20 or fewer, retain every survivor and stop.
    candidates = matches
    for stage in (1, 2, 3):
        filtered = [item for item in candidates if passes_gate(item, stage)]
        if len(filtered) <= PATTERN_MAX_MATCHES:
            return filtered
        candidates = filtered
    return candidates


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

    # 가장 최근 저점부터 여러 조합을 확인해 중간 잡음 저점 때문에 패턴을 놓치지 않는다.
    for b in range(len(low_idxs) - 1, 0, -1):
        for a in range(b - 1, -1, -1):
            i1, i2 = low_idxs[a], low_idxs[b]
            gap_days = i2 - i1
            if gap_days < DB_MIN_GAP_DAYS or gap_days > DB_MAX_GAP_DAYS:
                continue
            if (len(win) - 1) - i2 > DB_RECENCY_MAX_GAP:
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

    # 가장 최근 저점부터 여러 조합을 확인해 중간 잡음 저점 때문에 패턴을 놓치지 않는다.
    for c in range(len(low_idxs) - 1, 1, -1):
        for b in range(c - 1, 0, -1):
            for a in range(b - 1, -1, -1):
                i_l, i_h, i_r = low_idxs[a], low_idxs[b], low_idxs[c]
                if (len(win) - 1) - i_r > IHS_RECENCY_MAX_GAP:
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

def detect_box_range_low(daily, market_cap_eok=None, require_market_cap=False):
    """Detect the A/B/C/D/E/G/J box-range lower-zone formula.

    Market cap is fetched lazily by the live scanner only after the technical
    A/B/C/D/G/J pre-filter passes. ``require_market_cap=False`` is used for
    that pre-filter and by unit tests; production results always require E.
    """
    win = daily[-BOX_WINDOW:]
    if len(win) < BOX_WINDOW:
        return None

    range_win = win[-20:]
    closes = [row['close'] for row in range_win]
    lows = [row['low'] for row in range_win]
    highs = [row['high'] for row in range_win]
    last_close = closes[-1]
    close_min = min(closes)
    close_max = max(closes)
    close_range = (close_max - close_min) / close_min if close_min else math.inf
    if close_range > BOX_CLOSE_RANGE_MAX:
        return None

    close_ma5 = moving_average(daily, 'close', 5)[-20:]
    close_ma20 = moving_average(daily, 'close', 20)[-20:]
    close_near_count = sum(
        1 for fast, slow in zip(close_ma5, close_ma20)
        if fast is not None and slow and abs(fast / slow - 1) <= BOX_MA_NEAR_TOL
    )
    if close_near_count < BOX_MA_NEAR_COUNT:
        return None

    rsi = rsi_last(daily, BOX_RSI_PERIOD)
    if rsi is None or not (BOX_RSI_MIN <= rsi <= BOX_RSI_MAX):
        return None

    avg_volume_before = sum(row['volume'] for row in win[-6:-1]) / BOX_VOLUME_AVG_PERIOD
    volume_20_ago = win[0]['volume']
    volume_ratio = volume_20_ago / avg_volume_before if avg_volume_before else math.inf
    if not (BOX_VOLUME_RATIO_MIN <= volume_ratio <= BOX_VOLUME_RATIO_MAX):
        return None

    open_ma5 = moving_average(daily, 'open', 5)[-20:]
    open_ma20 = moving_average(daily, 'open', 20)[-20:]
    open_ma_above_count = sum(
        1 for fast, slow in zip(open_ma5, open_ma20)
        if fast is not None and slow is not None and fast >= slow
    )
    if open_ma_above_count < BOX_OPEN_MA_ABOVE_COUNT:
        return None

    return_20 = last_close / win[0]['close'] - 1
    if abs(return_20) > BOX_RETURN_MAX:
        return None

    support = min(lows)
    resistance = max(highs)
    box_range = resistance - support
    if box_range <= 0:
        return None
    lower_position = (last_close - support) / box_range
    if lower_position < -0.02 or lower_position > BOX_LOWER_ZONE_RATIO:
        return None

    if market_cap_eok is None:
        if require_market_cap:
            return None
    elif market_cap_eok < BOX_MARKET_CAP_MIN_EOK:
        return None

    # All A/B/C/D/G/J gates are hard filters. The score only ranks survivors.
    range_score = max(0, 20 - round(close_range / BOX_CLOSE_RANGE_MAX * 20))
    ma_score = min(20, close_near_count * 4)
    rsi_score = 15 - round(abs(rsi - 50) / 15 * 15)
    volume_score = 15 - round(abs(volume_ratio - 0.85) / 0.35 * 15)
    cap_score = 10 if market_cap_eok is not None else 0
    open_ma_score = min(10, open_ma_above_count * 2)
    return_score = max(0, 10 - round(abs(return_20) / BOX_RETURN_MAX * 10))
    score = clamp_score(range_score + ma_score + rsi_score + volume_score + cap_score + open_ma_score + return_score)
    reasons = [
        'A 최근 20봉 종가 변동폭 %.1f%% (10%% 이하)' % (close_range * 100),
        'B 종가 5·20일선 3%% 이내 근접 %d회' % close_near_count,
        'C RSI(14) %.1f (35~65)' % rsi,
        'D 20봉전 거래량/직전 5봉 평균 %.1f%% (50~120%%)' % (volume_ratio * 100),
        'E 시가총액 %.0f억원 (3000억원 이상)' % market_cap_eok if market_cap_eok is not None else 'E 시가총액 확인 대기',
        'G 시가 5·20일선 관계 충족 %d회' % open_ma_above_count,
        'J 20봉 수익률 %.1f%% (±10%% 이내)' % (return_20 * 100),
    ]
    return {
        'support': support,
        'resistance': resistance,
        'signal': {'date': win[-1]['date'], 'price': last_close},
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '최근 20봉 변동폭·이평선 근접·RSI·거래량·시가 관계·수익률 조건을 모두 만족하고 박스 하단 %.1f%% 구간에 있는 후보입니다(%d점).' % (lower_position * 100, score),
        'criteria': {
            'closeRangePct': close_range * 100,
            'closeMaNearCount': close_near_count,
            'rsi14': rsi,
            'volumeRatioPct': volume_ratio * 100,
            'marketCapEok': market_cap_eok,
            'openMaAboveCount': open_ma_above_count,
            'return20Pct': return_20 * 100,
            'lowerPositionPct': lower_position * 100,
        },
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


def scan_stock(stock, daily, pattern_results, pullback_matches, market_cap_getter=None,
               require_common_market_cap=False):
    """단일 종목의 daily(OHLC)로 6종 패턴을 판정해 pattern_results/pullback_matches에
    append(둘 다 호출부가 미리 만들어서 넘긴 딕셔너리/리스트를 in-place로 채움).
    daily_scan.py(키움 API 기반)와 rescan_patterns.py(SQLite 기반)가 이 함수를 공유해서
    판정 로직이 두 곳에서 따로 관리되다 어긋나는 걸 방지한다.
    ``require_common_market_cap``은 운영 스캔에서만 True로 켠다. 테스트처럼
    시가총액 데이터가 없는 호출은 기존처럼 기술식만 검증할 수 있고, 운영 경로는
    시가총액을 확인하지 못한 종목도 후보로 내보내지 않는다.
    반환값: (패턴 스캔 대상이었는지, 눌림목 스캔 대상이었는지)."""
    pattern_scanned = False
    pullback_scanned = False
    pattern_results.setdefault('maCloudBreakout', [])
    pattern_results.setdefault('openingGap', [])
    if is_excluded_stock(stock, daily):
        return pattern_scanned, pullback_scanned

    market_cap_eok = stock.get('market_cap_eok')

    def common_search_ok():
        """패턴이 실제로 잡힌 종목에 한해 시총을 확인하는 공통 하드필터."""
        nonlocal market_cap_eok
        if not require_common_market_cap:
            return True
        if market_cap_eok is None and market_cap_getter:
            market_cap_eok = market_cap_getter(stock['code'])
            stock['market_cap_eok'] = market_cap_eok
        try:
            return market_cap_eok is not None and float(market_cap_eok) >= COMMON_MARKET_CAP_MIN_EOK
        except (TypeError, ValueError):
            return False

    if len(daily) >= 2:
        pattern_scanned = True
        opening_gap = detect_opening_gap(daily)
        if opening_gap and common_search_ok():
            pattern_results['openingGap'].append(build_pattern_match(stock, daily, opening_gap))

    if len(daily) >= RISING_LOWS_WINDOW:
        pattern_scanned = True
        rl = detect_rising_lows(daily)
        if rl and not rl['breakout'] and common_search_ok():
            pattern_results['risingLows'].append(build_pattern_match(stock, daily, rl))

    if len(daily) >= MA_CLOUD_MIN_DAYS:
        pattern_scanned = True
        ma_cloud = detect_ma_cloud_breakout(daily)
        if ma_cloud and common_search_ok():
            pattern_results['maCloudBreakout'].append(build_pattern_match(stock, daily, ma_cloud))

    if len(daily) >= BOX_WINDOW:
        db = detect_double_bottom(daily)
        if db and not db['breakout'] and pattern_grade(db['score']) and common_search_ok():
            pattern_results['doubleBottom'].append(build_pattern_match(stock, daily, db))

        ihs = detect_inv_head_shoulders(daily)
        if ihs and not ihs['breakout'] and pattern_grade(ihs['score'], IHS_MIN_SCORE) and common_search_ok():
            pattern_results['invHeadShoulders'].append(build_pattern_match(stock, daily, ihs))

        box = detect_box_range_low(
            daily,
            market_cap_eok=market_cap_eok,
            require_market_cap=market_cap_getter is None,
        )
        if box and box.get('criteria', {}).get('marketCapEok') is None and market_cap_getter:
            market_cap_eok = market_cap_getter(stock['code'])
            stock['market_cap_eok'] = market_cap_eok
            box = detect_box_range_low(daily, market_cap_eok=market_cap_eok, require_market_cap=True)
        if box and common_search_ok():
            pattern_results['boxRangeLow'].append(build_pattern_match(stock, daily, box))

    if len(daily) >= PULLBACK_MIN_DAYS:
        pullback_scanned = True
        pullback = detect_pullback(daily)
        if pullback and pattern_grade(pullback['score'], PULLBACK_MIN_SCORE) and common_search_ok():
            pullback_matches.append(build_pattern_match(stock, daily, pullback))

    return pattern_scanned, pullback_scanned


def _rank_matches(matches):
    """Sort survivors for readability without removing any by scan order."""
    matches = matches or []
    matches.sort(key=lambda item: item.get('code') or '')
    matches.sort(key=lambda item: item.get('date') or '', reverse=True)
    matches.sort(key=lambda item: item.get('score') or 0, reverse=True)
    return matches


def finalize_pattern_results(pattern_results, pullback_matches=None):
    """Apply staged chart-quality gates after the full universe scan.

    Buckets with 20 or fewer candidates are kept intact. Larger buckets are
    tightened using pattern-specific chart evidence until they fit; no bucket
    is truncated by universe order.
    """
    for key in ('risingLows', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'boxRangeLow', 'openingGap'):
        if key in pattern_results:
            filtered = _quality_gate_matches(pattern_results.get(key), key)
            pattern_results[key] = _rank_matches(filtered)
    if pullback_matches is not None:
        pullback_matches[:] = _rank_matches(_quality_gate_matches(pullback_matches, 'pullback'))
    return pattern_results
