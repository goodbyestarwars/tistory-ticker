# -*- coding: utf-8 -*-
"""VM 차트 패턴 판정(지시서 6종)과 공용 헬퍼.
일반 패턴은 GAS 상세 차트와 같은 기준을 사용하지만, 박스권 하단은 VM 일괄 스캔에서
시가총액까지 조회하는 A~G 전용 조건을 적용한다."""

import math
import re

import numpy as np
import pandas as pd

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
DOUBLE_BOTTOM_WINDOW = 120
IHS_WINDOW = 90
BOX_WINDOW = 21  # 20 bars for the range plus the 20-bars-ago reference bar

WEDGE_MIN_SWINGS = 2
# 2026-08-22: "저점이 조금이라도 높으면 통과"라 기업은행처럼 박스권 안에서 저점이 미세하게
# (1%도 안 되게) 올라간 것도 걸리는 문제가 리포트됨(미원에쓰씨 같은 뚜렷한 V자 반등만
# 잡히길 원함) - 최근 두 스윙 저점 간 최소 상승폭 하한을 추가. gas/ticker-proxy.gs의
# 동일 상수와 반드시 같이 유지할 것.
WEDGE_MIN_LOW_RISE = 0.05
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
# 2026-08-22 확인: BOX_LOWER_ZONE_RATIO는 절대가격 기준(box_low*(1+비율))이 아니라 박스
# 높이 비율 기준(lower_position=(종가-support)/box_height)이다 - 조건 A(20봉 종가
# 변동폭 10% 이내)와 단위가 다르므로 35%가 A의 10%보다 커도 논리적 모순이 아니다
# (작업지시서 "Zone 계산식 확인" 1단계 결론: 형태 B, 정상 설계).
BOX_LOWER_ZONE_RATIO = 0.35

# 2026-08-22 신설(작업지시서 2단계): 박스권 하단 Zone 진입 트리거 튜닝 상수 - 스킬/지시서에
# 정확한 숫자가 없어 임의 초기값으로 정했다. 추후 백테스트로 조정 필요.
BOX_ENTRY_VOLUME_MULT = 1.3       # 당일 거래량이 직전 5봉 평균 대비 이 배수 이상
BOX_ENTRY_HAMMER_WICK_MULT = 2.0  # 망치형 판정: 아래꼬리가 몸통의 이 배수 이상
BOX_ENTRY_MA5_NEAR_TOL = 0.01     # 5일선 근접 허용폭 1%

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

# 2026-08-22 신설(작업지시서: detect_pullback 보강)
# ① 최저점 탐색을 "오늘 기준"이 아니라 "고점 기준" 과거 N봉으로 제한 - 6개월 전 저점
# 대비 상승폭이 계산되는 착시를 막고 단기 강한 파동만 잡기 위함. 임의 초기값(20~30봉
# 범위 중간값), 추후 백테스트로 조정.
PULLBACK_LOW_SEARCH_WINDOW = 25
# ② 조정구간 최대거래량이 상승구간 최대거래량의 이 비율 이하여야 함(신설, 임시값).
PULLBACK_MAX_VOL_RATIO = 0.70
# ③ 20일선 방향 조건 두 버전 - 'ma5_above_ma20'(정배열 초입) / 'ma20_slope_tol'(완만한
# 하락까지 허용). 기본값은 B(ma20_slope_tol)로 둔다 - 조정구간엔 5일선이 20일선 아래로
# 잠깐 처지는 게 흔해서(단기가 장기보다 먼저 반응) A는 정상적인 눌림목까지 과도하게
# 걸러낼 위험이 있다고 판단했다(실제로 기존 회귀 테스트 데이터로도 A는 탈락, B는 통과).
# 백테스트로 비교 후 확정.
PULLBACK_TREND_FILTER_VERSION = 'ma20_slope_tol'
PULLBACK_MA20_SLOPE_TOL = -0.005  # 'ma20_slope_tol' 버전에서 허용하는 완만한 하락(-0.5%)
# ④ 진입 트리거(check_pullback_entry_trigger) 튜닝 상수
PULLBACK_ENTRY_WICK_MULT = 2.0    # 아래꼬리 캔들 판정: 아래꼬리가 몸통의 이 배수 이상
# ⑤ 거래대금 필터 - 근거 부족으로 지금은 비활성(0 = 미사용). 값을 넣으면(백만원 단위)
# 그 이상만 통과하도록 나중에 활성화할 수 있게 상수만 분리해둔다.
PULLBACK_MIN_TRADING_VALUE = 0

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
    """저점(is_low)/고점 스윙 인덱스 - PATTERN_SWING(2)봉씩 좌우로 겹치지 않는(weak)
    극값을 찾는다. 동점은 허용한다(원래 파이썬 루프의 엄격한 '<'/'>' 탈락 조건과 동일).
    2026-08-21: pandas rolling(center=True)로 벡터화(원래 이중 루프와 동일 결과 -
    test/test_pattern_detect.py + 회귀 스크립트로 확인)."""
    window = PATTERN_SWING * 2 + 1
    if len(win) < window:
        return []
    values = pd.Series([row[field] for row in win], dtype=float)
    rolled = values.rolling(window, center=True).min() if is_low else values.rolling(window, center=True).max()
    mask = rolled.notna() & (values == rolled)
    return [int(i) for i in values.index[mask]]


def max_high_between(win, i1, i2):
    if i2 <= i1 + 1:
        return None
    highs = np.array([win[k]['high'] for k in range(i1 + 1, i2)], dtype=float)
    local_idx = int(np.argmax(highs))  # 동점이면 최초(가장 이른) 인덱스를 취해 기존 루프의 '>' 판정과 동일
    idx = i1 + 1 + local_idx
    return {'date': win[idx]['date'], 'high': float(highs[local_idx])}


def min_low_between(win, i1, i2):
    """i1~i2 사이(양끝 포함)의 최저 저가. 쌍바닥 두 저점 사이에 그보다 더 낮은 저가가
    끼어있는지(무효 조합) 확인하는 용도 - max_high_between과 짝을 이루는 헬퍼."""
    if i2 < i1:
        return None
    lows = np.array([win[k]['low'] for k in range(i1, i2 + 1)], dtype=float)
    return float(np.min(lows))


def moving_average(win, field, period):
    """2026-08-21: pandas rolling().mean()으로 벡터화했다가 되돌렸다 - pandas의
    내부 합산 순서가 원래의 슬라이딩 합(누적 +=/-=)과 미세하게(마지막 자리수) 달라서,
    ma_cloud_breakout의 5일선-20일선 골든크로스처럼 두 이평선이 '정확히 같을 때'를
    기준으로 삼는 비교에서 부동소수점 오차만으로 크로스 유무가 뒤집히는 경우를
    회귀 테스트로 발견했다(diff_test_targeted.py). 그 경로가 있는 한 값 자체보다
    연산 순서를 원본과 동일하게 유지하는 게 더 중요해서 그대로 둔다."""
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
    """Return Wilder RSI for the latest bar, or None when history is short.
    2026-08-21: 등락폭 자체는 numpy(np.diff/np.clip)로 벡터화했지만, 초기 평균(시드)은
    moving_average와 같은 이유로 numpy .mean()이 아니라 원본과 동일한 좌→우 순서의
    sum()으로 계산한다(부동소수점 합산 순서 차이로 RSI 임계값 비교가 흔들리는 걸 방지)."""
    if len(win) <= period:
        return None
    closes = np.array([row[field] for row in win], dtype=float)
    changes = np.diff(closes)
    gains = np.clip(changes, 0.0, None)
    losses = np.clip(-changes, 0.0, None)
    avg_gain = float(sum(gains[:period]) / period)
    avg_loss = float(sum(losses[:period]) / period)
    for i in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[i]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + (avg_gain / avg_loss)))


def avg_volume(win, from_idx, to_idx):
    """2026-08-21: moving_average와 같은 이유로 numpy .mean()이 아니라 원본과 동일한
    sum()/len()을 쓴다 - is_volume_declining/increasing이 두 avg_volume 결과를
    '이르다/같다'로 엄격 비교하는데, 거래량이 일정한 구간(테스트 데이터에 흔함)에서
    합산 순서 차이만으로 그 비교가 뒤집히는 사례를 회귀 테스트로 발견했다."""
    if to_idx <= from_idx:
        return 0
    vals = [win[i]['volume'] for i in range(from_idx, to_idx)]
    return sum(vals) / len(vals)


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
    return bool(last['close'] > last['open'])


def has_bullish_after(win, from_idx):
    if from_idx + 1 >= len(win):
        return False
    tail = win[from_idx + 1:]
    closes = np.array([row['close'] for row in tail], dtype=float)
    opens = np.array([row['open'] for row in tail], dtype=float)
    return bool(np.any(closes > opens))


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
    window = np.array([[daily[k]['high'], daily[k]['low']] for k in range(start, i + 1)], dtype=float)
    return float((window[:, 0].max() + window[:, 1].min()) / 2)


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


def enrich_pattern_detail(detail, daily):
    """Add display-only price structure fields to an existing pattern result.

    The detector remains the source of truth for inclusion and scoring. These
    fields only serialize the already-used window so the scanner can render a
    per-stock observation without another OHLC request.
    """
    enriched = dict(detail or {})
    closes_20d = [
        {'date': row.get('date'), 'close': row.get('close')}
        for row in (daily or [])[-20:]
        if row.get('date') and row.get('close') is not None
    ]
    enriched.setdefault('closes_20d', closes_20d)

    low_swings = enriched.get('low_swings') or []
    if low_swings:
        enriched.setdefault('pivot_lows', list(low_swings))
    if len(low_swings) >= 2:
        previous_low = low_swings[-2]
        latest_low = low_swings[-1]
        enriched.setdefault('previous_low', dict(previous_low))
        enriched.setdefault('latest_low', dict(latest_low))
        previous_price = previous_low.get('price')
        latest_price = latest_low.get('price')
        if previous_price and latest_price:
            enriched.setdefault('low_rise_pct', (latest_price - previous_price) / previous_price * 100)

    signal = enriched.get('signal') or enriched.get('current') or {}
    current_close = signal.get('price') if isinstance(signal, dict) else None
    if current_close is None and closes_20d:
        current_close = closes_20d[-1].get('close')
    if current_close is not None:
        enriched.setdefault('current_close', current_close)

    resistance = enriched.get('resistance')
    if resistance is not None:
        enriched.setdefault('recent_resistance', resistance)
        if current_close:
            enriched.setdefault('resistance_gap_pct', (resistance - current_close) / current_close * 100)

    latest_low = enriched.get('latest_low')
    if latest_low and latest_low.get('price'):
        enriched.setdefault(
            'from_latest_low_pct',
            (current_close - latest_low['price']) / latest_low['price'] * 100 if current_close is not None else None,
        )
    return enriched


def annotate_pattern_scan_details(pattern_results, scanned_at, pullback_matches=None):
    """Attach the batch scan timestamp to serialized pattern details."""
    groups = list((pattern_results or {}).values())
    if pullback_matches is not None:
        groups.append(pullback_matches)
    for matches in groups:
        for item in matches or []:
            detail = item.get('patternDetail')
            if detail is not None:
                detail['scanned_at'] = scanned_at
            item['scannedAt'] = scanned_at


def build_pattern_match(stock, daily, detail):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    change_rate = ((last['close'] - prev['close']) / prev['close'] * 100) if (prev and prev['close']) else None
    pattern_detail = enrich_pattern_detail(detail, daily)
    mini_chart = pattern_detail.get('closes_20d') or []
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
        'patternDetail': pattern_detail,
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
    # 2026-08-22: 저점이 오르긴 했어도 그 폭이 WEDGE_MIN_LOW_RISE 미만이면 박스권 안 노이즈로
    # 보고 제외(미원에쓰씨처럼 뚜렷한 V자 반등만 남기기 위함).
    rise_ratio = (last_low - prev_low) / prev_low
    if rise_ratio < WEDGE_MIN_LOW_RISE:
        return None

    last_close = win[-1]['close']
    if last_close < last_low:
        return None
    # 2026-08-22: low_idxs(20봉 창 안의 모든 스윙 저점, 3개 이상일 수 있음)를 전부 선으로
    # 이으면 실제 판정에 쓰이지 않은 더 이전의(더 낮을 수도 있는) 저점까지 같이 그려져
    # "저점 상승형"인데 중간에 더 낮은 저점이 끼어 저-저-고로 보이는 문제가 있었다
    # (사용자 리포트: 차트 하단 선이 저저고로 꺾여 보임). 패턴 판정 자체가 마지막 두
    # 스윙 저점(prev_low_idx, last_low_idx)만 비교하므로, 차트에도 이 두 점만 그려
    # 항상 단조 상승(low1 < low2)으로 보이게 한다.
    low_swing_points = [
        {'date': win[prev_low_idx]['date'], 'price': prev_low},
        {'date': win[last_low_idx]['date'], 'price': last_low},
    ]
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
        '스윙 저점 순차 상승 %.1f%%(%d/40점)' % (rise_ratio * 100, higher_low_score),
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
# ② 224 장기이평 응축기(구 "이평 상승 초입형", 224일선 + 구름대)
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
    # 2026-08-22: 구름 하단을 뚫고 내려간 것도 통과시켜 달라는 요청 - 상단만 아직 안
    # 뚫었으면(=돌파 완료가 아니면) 포함한다. 구름 아래에서 다시 올라오는 중인 케이스도
    # "상승 초입"으로 볼 수 있다는 판단.
    if close > cloud['top']:
        return None
    # 2026-08-22(4차): 위 완화로 구름 하단을 한참 벗어난 역배열 약세 종목까지 잡히던 문제를
    # 막기 위해 최소 위치 조건을 다시 넣었다 - 종가는 구름 하단 -2% 안에서는 지지받고
    # 마감해야 한다(장중 밀렸어도 종가 기준 최소 지지력 확인).
    if close < cloud['bottom'] * 0.98:
        return None
    # 2026-08-22(2차): "하단 시도도 or로 넣어달라" - 고가가 구름 상단에 근접하거나(위에서
    # 저항 테스트), 저가가 구름 하단에 근접(아래에서 지지 테스트)하면 둘 중 하나만
    # 만족해도 통과한다(원래는 상단 시도만 필수였음). 위 -2% 지지 조건을 통과한 구간
    # 안에서의 시도만 인정되므로 역배열 약세 종목의 하단 터치는 여기 도달하지 못한다.
    top_attempt = daily[last_index]['high'] >= cloud['top'] * (1 - MA_CLOUD_TOP_TOL)
    bottom_attempt = daily[last_index]['low'] <= cloud['bottom'] * (1 + MA_CLOUD_TOP_TOL)
    if not (top_attempt or bottom_attempt):
        return None

    # 2026-08-22: 5일선-20일선 골든크로스 요건 완전 제거(사용자 요청) - 이제 224일선 근접+
    # 구름 상단/하단 시도 2가지만 필수 조건이다.
    ma5_now, ma20_now = ma5[last_index], ma20[last_index]

    # 2026-08-22(4차): 상단 시도(저항 돌파 임박)를 하단 시도(지지 테스트)보다 우대한다 -
    # 상단 시도는 근접도에 따라 35~50점 차등, 하단 시도는 근접도와 무관하게 25점 고정.
    # 둘 다 만족하면 더 가치 높은 상단 기준으로 채점한다.
    top_gap = abs(cloud['top'] - daily[last_index]['high']) / cloud['top'] if top_attempt else None
    if top_attempt:
        cloud_side = '상단'
        cloud_score = 50 if top_gap <= 0.01 else 35
    else:
        cloud_side = '하단'
        cloud_score = 25

    score = clamp_score(
        (50 if ma224_gap <= 0.015 else 35)
        + cloud_score
    )
    signal = {'date': daily[last_index]['date'], 'price': close}
    reasons = [
        '224일선 근접도 %.1f%%(%d/50점)' % (ma224_gap * 100, 50 if ma224_gap <= 0.015 else 35),
        '현재가 구름 %s 시도(%d/%d점)' % (cloud_side, cloud_score, 50 if top_attempt else 25),
    ]
    return {
        'ma5': ma5_now,
        'ma20': ma20_now,
        'ma224': ma224_now,
        'cloud': cloud,
        'signal': signal,
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '주가가 224일선 근처에서 일목 구름 %s 돌파를 시도하는 상승 초입으로 추정됩니다(%d점).' % (cloud_side, score),
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

            # 2026-08-22 추가: 두 저점 사이에 그보다 더 낮은 저가가 있으면(허용오차 2%
            # 넘게) 진짜 W자 바닥이 아니라 그 중간 저점이 더 낮은 삼중바닥/하락 추세로
            # 봐야 하므로 이 조합은 무효 처리한다.
            between_min = min_low_between(win, i1, i2)
            if between_min is not None and between_min < min(low1, low2) * 0.98:
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

                # 2026-08-22 추가: 우어깨 이후 저가가 헤드 저점보다 1% 넘게 더 빠지면
                # (새로운 저점을 다시 만든 셈이라) 진짜 역헤드앤숄더가 아니므로 무효 처리.
                post_right_min = min_low_between(win, i_r, len(win) - 1)
                if post_right_min is not None and post_right_min < head * 0.99:
                    continue

                peak1 = max_high_between(win, i_l, i_h)
                peak2 = max_high_between(win, i_h, i_r)
                if not peak1 or not peak2:
                    continue
                if (peak1['high'] - head) / head < IHS_NECK_MIN_RISE:
                    continue
                if (peak2['high'] - head) / head < IHS_NECK_MIN_RISE:
                    continue
                # 2026-08-22: 넥라인을 두 구간(좌어깨~헤드/헤드~우어깨) 고가 중 낮은 쪽이
                # 아니라 높은 쪽으로 변경(사용자 요청).
                neckline_price = max(peak1['high'], peak2['high'])
                neckline_point = peak1 if peak1['high'] >= peak2['high'] else peak2

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

def _ma_near_count(fast_vals, slow_vals, tol):
    """두 이평선 리스트(moving_average 결과 - 앞쪽에 None이 섞여 있을 수 있음)에서
    둘 다 값이 있고 slow가 0이 아니며 상대 오차가 tol 이내인 봉 수를 센다(B 조건)."""
    fast = np.array([np.nan if v is None else v for v in fast_vals], dtype=float)
    slow = np.array([np.nan if v is None else v for v in slow_vals], dtype=float)
    valid = ~np.isnan(fast) & ~np.isnan(slow) & (slow != 0)
    with np.errstate(divide='ignore', invalid='ignore'):
        ratio = np.abs(np.where(valid, fast / slow, np.nan) - 1)
    return int(np.sum(valid & (ratio <= tol)))


def _ma_above_count(fast_vals, slow_vals):
    """두 이평선 리스트에서 둘 다 값이 있고 fast >= slow인 봉 수를 센다(G 조건)."""
    fast = np.array([np.nan if v is None else v for v in fast_vals], dtype=float)
    slow = np.array([np.nan if v is None else v for v in slow_vals], dtype=float)
    valid = ~np.isnan(fast) & ~np.isnan(slow)
    return int(np.sum(valid & (fast >= slow)))


def detect_box_range_low(daily, market_cap_eok=None, require_market_cap=False):
    """Detect the A~G box-range lower-zone formula.

    Market cap is fetched lazily by the live scanner only after the technical
    A~F pre-filter passes. ``require_market_cap=False`` is used for
    that pre-filter and by unit tests; production results always require G.

    2026-08-22: 라벨을 실제 코드 실행 순서에 맞춰 연속 알파벳(A~G)으로 재정렬했다
    (예전엔 A,B,C,D,E,G,J였고 순서도 실행 순서와 어긋나 있었음 - 로직·기준값은 안 바꿈,
    라벨과 reasons 배열 순서만 정리). grep으로 확인한 결과 옛 라벨 문자열을 다른 곳(JS/GAS/
    테스트)에서 참조하는 코드는 없었다.
    """
    win = daily[-BOX_WINDOW:]
    if len(win) < BOX_WINDOW:
        return None

    range_win = win[-20:]
    closes = np.array([row['close'] for row in range_win], dtype=float)
    lows = np.array([row['low'] for row in range_win], dtype=float)
    highs = np.array([row['high'] for row in range_win], dtype=float)
    last_close = float(closes[-1])
    close_min = float(closes.min())
    close_max = float(closes.max())
    close_range = (close_max - close_min) / close_min if close_min else math.inf
    if close_range > BOX_CLOSE_RANGE_MAX:
        return None

    close_ma5 = moving_average(daily, 'close', 5)[-20:]
    close_ma20 = moving_average(daily, 'close', 20)[-20:]
    close_near_count = _ma_near_count(close_ma5, close_ma20, BOX_MA_NEAR_TOL)
    if close_near_count < BOX_MA_NEAR_COUNT:
        return None

    rsi = rsi_last(daily, BOX_RSI_PERIOD)
    if rsi is None or not (BOX_RSI_MIN <= rsi <= BOX_RSI_MAX):
        return None

    avg_volume_before = avg_volume(win, len(win) - 6, len(win) - 1)
    volume_20_ago = win[0]['volume']
    volume_ratio = volume_20_ago / avg_volume_before if avg_volume_before else math.inf
    if not (BOX_VOLUME_RATIO_MIN <= volume_ratio <= BOX_VOLUME_RATIO_MAX):
        return None

    open_ma5 = moving_average(daily, 'open', 5)[-20:]
    open_ma20 = moving_average(daily, 'open', 20)[-20:]
    open_ma_above_count = _ma_above_count(open_ma5, open_ma20)
    if open_ma_above_count < BOX_OPEN_MA_ABOVE_COUNT:
        return None

    return_20 = last_close / win[0]['close'] - 1
    if abs(return_20) > BOX_RETURN_MAX:
        return None

    support = float(lows.min())
    resistance = float(highs.max())
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

    # A~F gates are always-hard filters; G(시가총액)은 require_market_cap=False일 때만
    # 선택적(조회 전 프리필터 통과 여부만 확인, 실서비스 결과는 항상 G까지 통과해야 함).
    # The score only ranks survivors.
    range_score = max(0, 20 - round(close_range / BOX_CLOSE_RANGE_MAX * 20))
    ma_score = min(20, close_near_count * 4)
    rsi_score = 15 - round(abs(rsi - 50) / 15 * 15)
    volume_score = 15 - round(abs(volume_ratio - 0.85) / 0.35 * 15)
    cap_score = 10 if market_cap_eok is not None else 0
    open_ma_score = min(10, open_ma_above_count * 2)
    return_score = max(0, 10 - round(abs(return_20) / BOX_RETURN_MAX * 10))
    score = clamp_score(range_score + ma_score + rsi_score + volume_score + cap_score + open_ma_score + return_score)
    # 2026-08-22: 라벨(A~G)과 배열 순서를 실제 코드 실행 순서(변동폭->이평근접->RSI->
    # 거래량->시가이평->수익률->시가총액)에 맞춰 재정렬(예전엔 E/G/J가 섞여 있었고
    # 배열 순서도 실행 순서와 달랐음). 기준값·통과 조건은 전혀 안 바꿈.
    reasons = [
        'A 최근 20봉 종가 변동폭 %.1f%% (10%% 이하)' % (close_range * 100),
        'B 종가 5·20일선 3%% 이내 근접 %d회' % close_near_count,
        'C RSI(14) %.1f (35~65)' % rsi,
        'D 20봉전 거래량/직전 5봉 평균 %.1f%% (50~120%%)' % (volume_ratio * 100),
        'E 시가 5·20일선 관계 충족 %d회' % open_ma_above_count,
        'F 20봉 수익률 %.1f%% (±10%% 이내)' % (return_20 * 100),
        'G 시가총액 %.0f억원 (3000억원 이상)' % market_cap_eok if market_cap_eok is not None else 'G 시가총액 확인 대기',
    ]
    result = {
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
    # 2026-08-22 신설(작업지시서 3단계): 박스 하단 Zone 안에서도 지금이 실제 진입 타점인지는
    # 별개 판단이라 check_box_range_low_entry_trigger()로 분리 계산 후 결과를 붙인다.
    entry_trigger = check_box_range_low_entry_trigger(daily, result)
    result['entryTrigger'] = entry_trigger
    result['entrySignal'] = bool(entry_trigger and entry_trigger.get('entry_signal'))
    return result


def check_box_range_low_entry_trigger(daily, box_result):
    """박스권 하단 Zone 안에서 실제로 반등을 시도하는 "진입 타점"인지 확인한다(작업지시서
    2단계). detect_box_range_low()가 이미 통과시킨 종목이라도 지금 이 순간이 진짜 매수
    시점인지는 별개 판단이라 분리했다 - 캔들/거래량/이평선 3개 신호 중 2개 이상 충족해야
    entry_signal=True.

    box_result는 detect_box_range_low()의 리턴값(support/resistance 필요)이거나
    그와 동일한 키를 가진 dict.
    """
    if not box_result or not daily:
        return None

    support = box_result.get('support')
    resistance = box_result.get('resistance')
    if support is None or resistance is None:
        return None
    box_height = resistance - support
    if box_height <= 0:
        return None

    last = daily[-1]
    last_close = last['close']
    # 1) 영역 확인: 박스 하단 Zone(박스 높이 비율 기준, detect_box_range_low와 동일 공식) 안인지.
    zone_position = (last_close - support) / box_height
    if zone_position < -0.02 or zone_position > BOX_LOWER_ZONE_RATIO:
        return None

    # 2) 반등 신호 3종
    # ① 캔들: 양봉(종가>시가) 또는 망치형(아래꼬리 >= 몸통 x 2)
    body = abs(last['close'] - last['open'])
    lower_wick = min(last['open'], last['close']) - last['low']
    is_bullish = last['close'] > last['open']
    is_hammer = body > 0 and lower_wick >= body * BOX_ENTRY_HAMMER_WICK_MULT
    candle_signal = bool(is_bullish or is_hammer)

    # ② 거래량: 당일 거래량이 직전 5봉 평균 대비 BOX_ENTRY_VOLUME_MULT(1.3)배 이상
    n = len(daily)
    volume_signal = False
    if n >= 6:
        avg5_volume = avg_volume(daily, n - 6, n - 1)
        volume_signal = bool(avg5_volume and last['volume'] >= avg5_volume * BOX_ENTRY_VOLUME_MULT)

    # ③ 이평선: 5일선 상향 돌파(전일 종가<5일선 -> 당일 종가>=5일선) 또는 당일 고가가
    # 5일선 BOX_ENTRY_MA5_NEAR_TOL(1%) 이내 근접
    ma5 = moving_average(daily, 'close', 5)
    ma5_now = ma5[-1] if ma5 else None
    ma5_prev = ma5[-2] if n >= 2 and len(ma5) >= 2 else None
    prev_close = daily[-2]['close'] if n >= 2 else None
    cross_up = bool(
        ma5_prev is not None and prev_close is not None and ma5_now is not None
        and prev_close < ma5_prev and last_close >= ma5_now
    )
    near_ma5 = bool(ma5_now and abs(last['high'] - ma5_now) / ma5_now <= BOX_ENTRY_MA5_NEAR_TOL)
    ma5_signal = bool(cross_up or near_ma5)

    signals_met = sum(1 for s in (candle_signal, volume_signal, ma5_signal) if s)
    entry_signal = signals_met >= 2

    reasons = []
    if candle_signal:
        reasons.append('당일 양봉 또는 망치형 캔들 확인')
    if volume_signal:
        reasons.append('거래량이 직전 5봉 평균 대비 %.0f%% 이상' % (BOX_ENTRY_VOLUME_MULT * 100))
    if ma5_signal:
        reasons.append('5일선 상향 돌파 또는 1% 이내 근접')

    return {
        'in_zone': True,
        'zone_position_pct': zone_position * 100,
        'candle_signal': candle_signal,
        'volume_signal': volume_signal,
        'ma5_signal': ma5_signal,
        'signals_met': signals_met,
        'entry_signal': entry_signal,
        'reasons': reasons,
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
    # 2026-08-21: 최고가/직전 최저가를 찾는 두 루프를 numpy argmax/argmin으로 벡터화.
    # 동점일 때 가장 이른 인덱스를 취하는 것까지 argmax/argmin의 기본 동작과 동일하다
    # (원래 '>'/'<' 엄격 비교 루프와 같은 결과 - test/test_pattern_detect.py +
    # 회귀 스크립트로 확인).
    recent_closes = np.array([row['close'] for row in win[recent_start:n]], dtype=float)
    peak_local = int(np.argmax(recent_closes))
    peak_idx = recent_start + peak_local
    if (n - 1) - peak_idx > PULLBACK_LOOKBACK:
        return None

    # 2026-08-22 개편: 저점 탐색을 "오늘 기준" 창(recent_start)이 아니라 "고점 기준"
    # 과거 PULLBACK_LOW_SEARCH_WINDOW(25)봉으로 제한 - 고점이 탐색창 이른 쪽에 있을 때
    # 저점 탐색 구간이 뜻하지 않게 좁아지거나(반대로 넓어지거나) 하는 것을 막고, 항상
    # "고점 직전 일정 기간"의 저점만 상승폭 계산에 쓰이게 한다.
    low_search_start = max(0, peak_idx - PULLBACK_LOW_SEARCH_WINDOW)
    low_search_closes = np.array([row['close'] for row in win[low_search_start:peak_idx + 1]], dtype=float)
    low_local = int(np.argmin(low_search_closes))
    low_idx = low_search_start + low_local
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

    ma5 = moving_average(win, 'close', 5)
    ma20_now = ma20[n - 1]
    ma240_now = ma240[n - 1]
    diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now else math.inf
    diff240 = abs(last_close - ma240_now) / ma240_now if ma240_now else math.inf
    if diff20 > PULLBACK_MA_TOL and diff240 > PULLBACK_MA_TOL:
        return None

    # 2026-08-22 개편: "20일선 상승 중" 단일 조건을 두 버전 중 선택 가능하게 바꿈(사용자
    # 요청, 백테스트로 비교 후 확정 예정) - PULLBACK_TREND_FILTER_VERSION으로 전환.
    # A) ma5_above_ma20: 5일선이 20일선 위(정배열 초입) - 역배열 상태의 단기 반등을 배제.
    # B) ma20_slope_tol: 20일선 기울기가 PULLBACK_MA20_SLOPE_TOL(-0.5%) 이내(완만한
    #    하락까지 허용) - 예전 "무조건 상승"보다 느슨함.
    ma5_now = ma5[n - 1]
    ma20_slope_from = ma20[n - 1 - MA_SLOPE_LOOKBACK]
    if PULLBACK_TREND_FILTER_VERSION == 'ma5_above_ma20':
        if ma5_now is None or ma20_now is None or ma5_now < ma20_now:
            return None
    else:
        if ma20_now is None or ma20_slope_from is None:
            return None
        ma20_slope = (ma20_now - ma20_slope_from) / ma20_slope_from if ma20_slope_from else -math.inf
        if ma20_slope < PULLBACK_MA20_SLOPE_TOL:
            return None

    # 2026-07-22 개편: 상승구간 거래량 증가 + 조정구간 거래량 감소
    rise_vol_up = is_volume_increasing(win, low_idx, peak_idx)
    drop_vol_down = is_volume_declining(win, peak_idx, n)
    if not rise_vol_up or not drop_vol_down:
        return None

    # 2026-08-22 신설: 조정구간 최대거래량이 상승구간 최대거래량의 PULLBACK_MAX_VOL_RATIO
    # (0.70) 이하여야 함 - "거래량 감소" 방향만 보던 것보다 더 엄격하게, 조정구간에서
    # 거래량이 튀는(분산/투매) 순간이 상승구간 최고치에 근접하지 않는지 확인. 고점 당일은
    # 상승 클라이맥스(보통 상승구간 전체에서 거래량이 가장 큰 날)라 조정구간에 포함시키면
    # 이 조건이 사실상 항상 실패해버린다(고점 거래량이 그 자체로 상승구간 최고치이거나
    # 그에 준하므로) - 그래서 조정구간은 고점 다음 날부터로 본다(is_volume_declining의
    # 평균 비교 방식과는 달리 max 하나로 판정해서 특히 민감함).
    rise_vols = [row['volume'] for row in win[low_idx:peak_idx]]
    drop_vols = [row['volume'] for row in win[peak_idx + 1:n]]
    max_rise_vol = max(rise_vols) if rise_vols else 0
    max_drop_vol = max(drop_vols) if drop_vols else 0
    if max_rise_vol > 0 and max_drop_vol > max_rise_vol * PULLBACK_MAX_VOL_RATIO:
        return None

    # 2026-08-22 신설(현재 비활성, PULLBACK_MIN_TRADING_VALUE=0): 거래대금 필터 - 근거
    # 부족으로 지금은 값을 안 넣었다. 나중에 상수를 채우면 자동으로 활성화된다.
    if PULLBACK_MIN_TRADING_VALUE > 0:
        last_trading_value_eok = (win[n - 1]['close'] * win[n - 1]['volume']) / 1e8
        if last_trading_value_eok < PULLBACK_MIN_TRADING_VALUE:
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
    trend_label = '5일선 20일선 위(정배열)' if PULLBACK_TREND_FILTER_VERSION == 'ma5_above_ma20' \
        else '20일선 완만한 하락 이내'
    reasons = [
        '상승폭 %.1f%%(%d/30점)' % (rise_ratio * 100, rise_score),
        '조정폭 %.1f%%(%d/25점)' % (drop_ratio * 100, drop_score),
        '%s 근접도, %s(%d/20점)' % (ma_label, trend_label, ma_score),
        '상승구간 거래량 증가 + 조정구간 거래량 감소(%d/15점)' % vol_score,
        '최근 캔들 %s(%d/10점)' % ('양봉' if bull_score else '음봉', bull_score),
    ]

    result = {
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
    # 2026-08-22 신설(작업지시서 4단계): 눌림목 지지선 근접 상태에서도 지금이 실제 진입
    # 타점인지는 별개 판단이라 check_pullback_entry_trigger()로 분리(박스권의
    # check_box_range_low_entry_trigger와 동일한 구조로 통일).
    entry_trigger = check_pullback_entry_trigger(daily, result)
    result['entryTrigger'] = entry_trigger
    result['entrySignal'] = bool(entry_trigger and entry_trigger.get('entry_signal'))
    return result


def check_pullback_entry_trigger(daily, pullback_result):
    """눌림목 지지선(20일선 또는 240일선) 근처에서 실제로 반등을 시도하는 "진입 타점"인지
    확인한다(작업지시서 4단계). detect_pullback()이 이미 통과시킨 종목이라도 지금 이
    순간이 진짜 매수 시점인지는 별개 판단이라 분리했다 - 지지선 근접 상태(Zone)를 먼저
    확인하고, 그 안에서 아래꼬리 캔들 또는 양봉 전환 중 하나만 있어도 entry_signal=True
    (박스권과 달리 "2개 중 1개"만 있으면 됨 - 지시서 문구 그대로).

    pullback_result는 detect_pullback()의 리턴값(ma20/ma240 필요)이거나 동일한 키를
    가진 dict."""
    if not pullback_result or not daily:
        return None

    ma20_now = pullback_result.get('ma20')
    ma240_now = pullback_result.get('ma240')
    last = daily[-1]
    last_close = last['close']

    diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now else math.inf
    diff240 = abs(last_close - ma240_now) / ma240_now if ma240_now else math.inf
    if diff20 > PULLBACK_MA_TOL and diff240 > PULLBACK_MA_TOL:
        return None
    if diff20 <= diff240:
        support_label, support_price = '20일선', ma20_now
    else:
        support_label, support_price = '1년선(240일선)', ma240_now

    # ① 아래꼬리 캔들: 아래꼬리가 몸통의 PULLBACK_ENTRY_WICK_MULT(2.0)배 이상
    body = abs(last['close'] - last['open'])
    lower_wick = min(last['open'], last['close']) - last['low']
    wick_signal = bool(body > 0 and lower_wick >= body * PULLBACK_ENTRY_WICK_MULT)

    # ② 양봉 전환: 당일 종가 > 시가
    bullish_signal = bool(last['close'] > last['open'])

    entry_signal = bool(wick_signal or bullish_signal)

    reasons = []
    if wick_signal:
        reasons.append('아래꼬리가 몸통의 %.1f배 이상(지지 확인)' % PULLBACK_ENTRY_WICK_MULT)
    if bullish_signal:
        reasons.append('당일 양봉 전환')

    return {
        'in_zone': True,
        'support_label': support_label,
        'support_price': support_price,
        'wick_signal': wick_signal,
        'bullish_signal': bullish_signal,
        'entry_signal': entry_signal,
        'reasons': reasons,
    }


def check_market_regime(index_daily, ma_period=20):
    """2026-08-22 신설(작업지시서 6단계, 아직 호출부 없음) - "KOSPI/KOSDAQ 20일선 위에서만
    매매"를 개별 종목 판정(detect_pullback 등)과 분리해 시장 국면만 독립적으로 판단하는
    함수. 스캐너 실행 파이프라인 상위 단계(daily_scan.py 등)에서 KOSPI/KOSDAQ 지수
    일봉을 받아 호출하도록 설계했지만, 지수 데이터를 어디서 받아올지(키움 지수 TR 등)는
    이번 작업 범위 밖이라 실제 연결은 아직 안 했다 - 함수만 준비."""
    if not index_daily or len(index_daily) < ma_period:
        return None
    ma = moving_average(index_daily, 'close', ma_period)
    ma_now = ma[-1]
    last_close = index_daily[-1]['close']
    if ma_now is None:
        return None
    return {
        'above_ma': bool(last_close >= ma_now),
        'ma_period': ma_period,
        'ma_value': ma_now,
        'last_close': last_close,
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
