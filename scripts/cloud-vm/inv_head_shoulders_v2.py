# -*- coding: utf-8 -*-
"""역헤드앤숄더(레퍼런스 기반 재설계) - 어깨-머리-어깨의 가격 대칭성이 아니라, 고점들이
이어가는 하락 추세선을 얼마나 강하게 뚫는지를 본다. 레퍼런스: "하락 추세를 뚫은 고점이
이전 고점보다 높아지는 형태가 나오면 역헤드앤숄더가 나올 확률이 높다" + "하락 추세를 뚫은
어깨의 눌림목에서 거래량이 많이 죽었을 때 들어가는 게 포인트".

pattern_detect.detect_inv_head_shoulders(기존)와의 차이: 기존은 어깨-머리-어깨 3개 저점의
가격 대칭성(IHS_SHOULDER_TOL 4% 이내)과 넥라인 돌파 + "우어깨 이후 거래량 급증"을 조건으로
쓴다. 이건 그 반대 방향이다 - 어깨 대칭성은 요구하지 않고(사용자에게 유지 여부를 물었으나
레퍼런스가 강조하는 핵심이 대칭성이 아니라 "추세선 돌파"라 뺐다), 진입 시점도 거래량
급증이 아니라 돌파 이후 첫 "거래량이 죽은 눌림목"으로 잡는다 - 기존 코드의 거래량 조건과
정반대 방향이라는 점을 분명히 밝혀둔다.

주의: 고점 최소 개수, 추세선 돌파 허용폭, 룩백 구간, 거래량 감소 기준, 눌림목 확인 폭은
스킬이나 사용자가 준 정확한 숫자가 없어 임의로 정했다(아래 상수 주석에 명시)."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # backtest_entry_signal/summarize_backtest 재사용
import db_schema

SWING = 2                        # 좌우 몇 봉과 비교해 스윙점으로 볼지 - pattern_detect.PATTERN_SWING과 동일
LOOKBACK_WINDOW = 60               # 하락 추세선을 찾아볼 구간(거래일) - ascending_triangle.py와 동일하게 임의 설정
MIN_HIGH_SWINGS = 3                 # "하락 추세선"이라 부르려면 고점이 최소 몇 개(순차 하락) 필요한지 - 임의 설정
TREND_BREAK_TOL_PCT = 2.0            # 직전 고점 대비 이 % 넘게 올라야 "추세선을 뚫었다"고 봄 - pattern_detect.BREAKOUT_TOL(1.02)과 동일 기준
PULLBACK_MAX_LOOKAHEAD = 10          # 추세선 돌파 후 이 거래일 안에 눌림목이 와야 유효 - 임의 설정
VOLUME_DECLINE_RATIO = 0.6            # 눌림목 거래량이 돌파일 거래량의 이 배수 미만이어야 "거래량이 죽었다"고 봄 - 임의 설정

DEFAULT_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'is_high_swing', 'trend_break_level', 'entry_signal',
]


def _swing_mask(series, window, is_low):
    """ascending_triangle._swing_mask와 동일한 정의(좌우 window봉과 비교, 동률 허용)."""
    full_window = window * 2 + 1
    rolled = series.rolling(full_window, center=True).min() if is_low else series.rolling(full_window, center=True).max()
    return rolled.notna() & (series == rolled)


def compute_inv_head_shoulders_signal(code, conn=None, rows=None):
    """종목코드 하나로 (재설계) 역헤드앤숄더 신호 DataFrame을 만든다.

    각 날짜 i마다, i 기준으로 이미 확정된(미래 봉 필요 없는) 스윙 고점만 최근
    LOOKBACK_WINDOW 거래일 안에서 모아, MIN_HIGH_SWINGS개 이상이 순차적으로 낮아지는
    하락 추세선을 이루면 그 마지막(가장 낮은) 고점을 "추세선 돌파 기준선"으로 삼는다.
    그 뒤 오늘 고가가 이 기준선을 TREND_BREAK_TOL_PCT% 넘게 뚫으면 "관심 등록"(돌파
    확인)하고, entry_signal은 그 뒤 PULLBACK_MAX_LOOKAHEAD거래일 안에 처음으로
    (전일 대비 하락 + 거래량이 돌파일의 VOLUME_DECLINE_RATIO 미만으로 죽은) 날에만 뜬다."""
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

    df['is_high_swing'] = _swing_mask(df['high'], SWING, is_low=False)

    n = len(df)
    highs = df['high'].to_numpy(dtype=float)
    closes = df['close'].to_numpy(dtype=float)
    volumes = df['volume'].to_numpy(dtype=float)
    is_high_swing = df['is_high_swing'].to_numpy()

    entry = np.zeros(n, dtype=bool)
    trend_break_arr = np.full(n, np.nan)

    # 상태: 아직 추세선만 확인된 단계(watching_break) vs 돌파까지 확인돼 눌림목을 기다리는
    # 단계(watching_pullback) - ascending_triangle.py의 watching_since와 달리 2단계라
    # 상태 변수를 좀 더 명시적으로 나눴다.
    watching_break_level = None   # 추세선의 마지막(가장 낮은) 고점 값
    watching_pullback_since = None
    breakout_volume = None
    min_swing_start = -1          # 진입 후 스윙점 재사용 방지(ascending_triangle.py와 동일한 이유)

    for i in range(n):
        start = max(0, i - LOOKBACK_WINDOW + 1, min_swing_start + 1)
        confirmed_end = i - SWING  # look-ahead 방지

        # 1단계: 하락 추세선(순차적으로 낮아지는 고점 MIN_HIGH_SWINGS개 이상) 갱신.
        # 돌파를 기다리는 중이 아닐 때만 새로 계산한다(돌파 확인 후에는 그 기준선을 유지).
        if watching_pullback_since is None and confirmed_end >= start:
            high_idx = [k for k in range(start, confirmed_end + 1) if is_high_swing[k]]
            if len(high_idx) >= MIN_HIGH_SWINGS:
                recent = high_idx[-MIN_HIGH_SWINGS:]
                vals = [highs[k] for k in recent]
                declining = all(vals[j] < vals[j - 1] for j in range(1, len(vals)))
                if declining:
                    watching_break_level = vals[-1]

        # 2단계: 오늘 고가가 추세선 기준선을 TREND_BREAK_TOL_PCT% 넘게 뚫었는지.
        if watching_pullback_since is None and watching_break_level is not None:
            if highs[i] > watching_break_level * (1 + TREND_BREAK_TOL_PCT / 100.0):
                watching_pullback_since = i
                breakout_volume = volumes[i]

        # 3단계: 돌파 후 첫 "거래량이 죽은 눌림목"을 기다린다.
        if watching_pullback_since is not None:
            trend_break_arr[i] = watching_break_level
            if i - watching_pullback_since > PULLBACK_MAX_LOOKAHEAD:
                watching_pullback_since = None
                watching_break_level = None
                breakout_volume = None
            elif i > watching_pullback_since:
                is_down_day = closes[i] < closes[i - 1]
                is_low_volume = breakout_volume and volumes[i] < breakout_volume * VOLUME_DECLINE_RATIO
                if is_down_day and is_low_volume:
                    entry[i] = True
                    min_swing_start = i
                    watching_pullback_since = None
                    watching_break_level = None
                    breakout_volume = None

    df['trend_break_level'] = trend_break_arr
    df['entry_signal'] = entry

    return df[DAILY_PRICES_COLUMNS]


# accumulation_angle.py와 동일한 진입/청산 가정 + 요약 로직을 재사용한다.
backtest_entry_signal = aa.backtest_entry_signal
summarize_backtest = aa.summarize_backtest
