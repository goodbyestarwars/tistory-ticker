# -*- coding: utf-8 -*-
"""박스권(Box Range / Rectangle) - 저항선과 지지선이 둘 다 평평한 밴드 안에 몰려있고
(오르지도 내리지도 않음) 그 사이에서 여러 번 왕복하다가 저항선을 위로 뚫는 구조. 사용자
그림(노란 박스 안에서 고점 3번·저점 3번 왕복 후 우상단으로 돌파)을 그대로 옮겼다.

ascending_triangle.py와의 차이: 그쪽은 저점이 계단식으로 "높아져야" 하고 저항선도 좁혀
들어가는 수렴형인데, 박스권은 저항선·지지선 둘 다 그냥 평평(밴드 안)하면 되고 폭이
좁아질 필요가 없다 - 가장 단순한 형태라 사용자 확인: "박스권은 뭐 평범해... 너의 생각이
더 중요해"로 설계를 맡겨 아래처럼 만들었다.

주의: 저점/고점 최소 개수, 밴드 허용오차, 룩백 구간, 돌파 확인 폭은 스킬이나 사용자가 준
정확한 숫자가 없어 임의로 정했다(아래 상수 주석에 명시)."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # backtest_entry_signal/summarize_backtest 재사용
import db_schema

SWING = 2                   # 좌우 몇 봉과 비교해 스윙점으로 볼지 - pattern_detect.PATTERN_SWING과 동일
LOOKBACK_WINDOW = 60          # 박스 전체를 찾아볼 구간(거래일) - ascending_triangle.py와 동일하게 임의 설정
MIN_LOW_SWINGS = 3             # 지지선이 "테스트됐다"고 보려면 저점이 최소 몇 개 필요한지 - 임의 설정
MIN_HIGH_SWINGS = 3            # 저항선이 "테스트됐다"고 보려면 고점이 최소 몇 개 필요한지 - 임의 설정
BAND_TOL_PCT = 3.0             # 저항선·지지선 각각 고점/저점끼리 이 % 이내로 몰려있어야 "평평하다"고 봄 - 임의 설정
BREAKOUT_TOL_PCT = 2.0         # 저항선 대비 이 % 넘게 종가가 올라야 "돌파" 확정 - pattern_detect.BREAKOUT_TOL(1.02)과 동일 기준
BREAKOUT_MAX_LOOKAHEAD = 10    # 박스 완성 후 이 거래일 안에 돌파해야 유효 - ascending_triangle.py와 동일하게 임의 설정

DEFAULT_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'is_low_swing', 'is_high_swing', 'resistance', 'support', 'entry_signal',
]


def _swing_mask(series, window, is_low):
    """ascending_triangle._swing_mask/pattern_detect.find_swing_indices와 동일한 정의
    (좌우 window봉과 비교, 동률 허용)를 시리즈 전체에 대해 한 번에 boolean mask로 계산한다."""
    full_window = window * 2 + 1
    rolled = series.rolling(full_window, center=True).min() if is_low else series.rolling(full_window, center=True).max()
    return rolled.notna() & (series == rolled)


def compute_box_range_signal(code, conn=None, rows=None):
    """종목코드 하나로 박스권 신호 DataFrame을 만든다.

    각 날짜 i마다, i 기준으로 이미 확정된(미래 봉 필요 없는) 스윙 저점/고점만 최근
    LOOKBACK_WINDOW 거래일 안에서 모아, 저점이 MIN_LOW_SWINGS개 이상이고 서로
    BAND_TOL_PCT% 이내(지지선 평평), 고점도 MIN_HIGH_SWINGS개 이상이고 서로 BAND_TOL_PCT%
    이내(저항선 평평)면 "박스 완성"으로 본다. entry_signal은 그 뒤
    BREAKOUT_MAX_LOOKAHEAD거래일 안에 종가가 저항선을 BREAKOUT_TOL_PCT% 넘게 뚫는 첫
    날에만 뜬다. ascending_triangle.compute_ascending_triangle_signal과 동일한 구조(look-
    ahead 방지, 돌파 후 스윙점 재사용 방지)를 그대로 따른다."""
    if rows is None:
        own_conn = conn is None
        if own_conn:
            conn = db_schema.get_conn()
        try:
            rows = db_schema.load_daily_prices(conn, code)
        finally:
            if own_conn:
                conn.close()

    if not rows:
        return pd.DataFrame(columns=DAILY_PRICES_COLUMNS)

    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date').reset_index(drop=True)

    df['is_low_swing'] = _swing_mask(df['low'], SWING, is_low=True)
    df['is_high_swing'] = _swing_mask(df['high'], SWING, is_low=False)

    n = len(df)
    lows = df['low'].to_numpy(dtype=float)
    highs = df['high'].to_numpy(dtype=float)
    closes = df['close'].to_numpy(dtype=float)
    is_low_swing = df['is_low_swing'].to_numpy()
    is_high_swing = df['is_high_swing'].to_numpy()

    entry = np.zeros(n, dtype=bool)
    resistance_arr = np.full(n, np.nan)
    support_arr = np.full(n, np.nan)

    watching_since = None
    watching_resistance = None
    watching_support = None
    min_swing_start = -1  # ascending_triangle.py와 동일한 이유(돌파 후 스윙점 재사용 방지)

    for i in range(n):
        start = max(0, i - LOOKBACK_WINDOW + 1, min_swing_start + 1)
        confirmed_end = i - SWING  # look-ahead 방지

        box_ok = False
        resistance = None
        support = None
        if confirmed_end >= start:
            low_idx = [k for k in range(start, confirmed_end + 1) if is_low_swing[k]]
            high_idx = [k for k in range(start, confirmed_end + 1) if is_high_swing[k]]
            if len(low_idx) >= MIN_LOW_SWINGS and len(high_idx) >= MIN_HIGH_SWINGS:
                low_vals = [lows[k] for k in low_idx]
                high_vals = [highs[k] for k in high_idx]
                low_flat = (max(low_vals) - min(low_vals)) / min(low_vals) * 100 <= BAND_TOL_PCT if min(low_vals) else False
                high_flat = (max(high_vals) - min(high_vals)) / min(high_vals) * 100 <= BAND_TOL_PCT if min(high_vals) else False
                # 지지선이 저항선보다 확실히 아래에 있어야 진짜 박스(두 밴드가 겹치면 박스가 아님)
                separated = min(high_vals) > max(low_vals)
                if low_flat and high_flat and separated:
                    box_ok = True
                    resistance = high_vals[-1]
                    support = low_vals[-1]

        if box_ok:
            watching_since = i
            watching_resistance = resistance
            watching_support = support
        elif watching_since is not None and (i - watching_since) > BREAKOUT_MAX_LOOKAHEAD:
            watching_since = None
            watching_resistance = None
            watching_support = None

        if watching_since is not None and watching_resistance:
            resistance_arr[i] = watching_resistance
            support_arr[i] = watching_support
            if closes[i] > watching_resistance * (1 + BREAKOUT_TOL_PCT / 100.0):
                entry[i] = True
                min_swing_start = i
                watching_since = None
                watching_resistance = None
                watching_support = None

    df['resistance'] = resistance_arr
    df['support'] = support_arr
    df['entry_signal'] = entry

    return df[DAILY_PRICES_COLUMNS]


# accumulation_angle.py와 동일한 진입/청산 가정 + 요약 로직을 재사용한다.
backtest_entry_signal = aa.backtest_entry_signal
summarize_backtest = aa.summarize_backtest
