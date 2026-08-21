# -*- coding: utf-8 -*-
"""이평 상승 초입형(pattern_detect.detect_ma_cloud_breakout)을 전체 이력에 걸쳐
계산 + 백테스트할 수 있게 만든 버전. 원래 함수는 "오늘 스냅샷" 하나만 판정하는
pattern_detect.py 스타일이라(차트검색 일일 스캔용) 과거에 이 신호가 몇 번 떴고
승률이 얼마인지는 알 수 없었다 - accumulation_angle.py/ascending_triangle.py와
같은 방식(pandas로 전체 이력에 걸쳐 신호 계산 + 백테스트)으로 옮겼다.

신호 조건(4개, pattern_detect.detect_ma_cloud_breakout과 동일한 값을 그대로 재사용):
- 종가가 224일선과 MA_CLOUD_NEAR_TOL(3%) 이내
- 종가가 일목구름 안(상단 넘으면 이미 돌파 끝, 하단 밑이면 아직 시도 전 - 둘 다 제외)
- 고가가 구름 상단에서 MA_CLOUD_TOP_TOL(3%) 이내까지 닿음(상단 노크)
- 최근 MA_CLOUD_CROSS_LOOKBACK(5)거래일 안에 5일선이 20일선을 상향 돌파(골든크로스)

2026-08-21: "224선/구름은 기준선일 뿐 - 근처에 오는 것 자체가 이미 거래량 없인 어려운
일이라 거래량 필터는 따로 필요 없고, 구름 색(양운/음운) 구분도 안 씀, 반복 실패도
신호를 거를 이유가 아니라 청산 규칙 문제 - 구름 아래로 이탈하면 손절, 위에 있으면
계속 보유"라는 사용자 확인에 따라 진입 조건은 원본 그대로 두고 청산 규칙만
gongpasan_strategy.backtest_gongpasan과 같은 패턴(손절 + 타임컷)으로 새로 만들었다.
타임컷 20거래일은 스킬/사용자가 준 숫자가 없어 gongpasan_strategy.DEFAULT_TIMECUT_DAYS와
동일하게 임의로 맞췄다(코드 주석에 명시)."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # summarize_backtest 재사용
import db_schema

MA_SHORT = 5
MA_MID = 20
MA_LONG = 224

ICHIMOKU_TENKAN_PERIOD = 9
ICHIMOKU_KIJUN_PERIOD = 26
ICHIMOKU_SENKOU_B_PERIOD = 52
ICHIMOKU_DISPLACEMENT = 26

MA_CLOUD_NEAR_TOL = 0.03        # pattern_detect.MA_CLOUD_NEAR_TOL과 동일
MA_CLOUD_TOP_TOL = 0.03         # pattern_detect.MA_CLOUD_TOP_TOL과 동일
MA_CLOUD_CROSS_LOOKBACK = 5     # pattern_detect.MA_CLOUD_CROSS_LOOKBACK과 동일

DEFAULT_TIMECUT_DAYS = 20       # 스킬/사용자가 준 숫자 없음 - gongpasan_strategy.DEFAULT_TIMECUT_DAYS와 동일하게 임의 설정
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'ma5', 'ma20', 'ma224', 'cloud_top', 'cloud_bottom', 'entry_signal',
]


def compute_ma_cloud_breakout_signal(code, conn=None, rows=None):
    """종목코드 하나로 이평 상승 초입형 신호 DataFrame을 만든다. conn/rows 규칙은
    accumulation_angle.compute_accumulation_angle과 동일."""
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

    close, high, low = df['close'], df['high'], df['low']

    df['ma5'] = close.rolling(MA_SHORT).mean()
    df['ma20'] = close.rolling(MA_MID).mean()
    df['ma224'] = close.rolling(MA_LONG).mean()

    # 일목균형표: pattern_detect.ichimoku_cloud_at와 동일하게, "오늘 보이는 구름"은
    # ICHIMOKU_DISPLACEMENT(26)일 전 시점의 전환선·기준선·선행스팬B로 계산해 앞으로
    # 26일 옮겨 보여준다(shift로 그 이동을 그대로 구현).
    tenkan = (high.rolling(ICHIMOKU_TENKAN_PERIOD).max() + low.rolling(ICHIMOKU_TENKAN_PERIOD).min()) / 2
    kijun = (high.rolling(ICHIMOKU_KIJUN_PERIOD).max() + low.rolling(ICHIMOKU_KIJUN_PERIOD).min()) / 2
    senkou_b_raw = (high.rolling(ICHIMOKU_SENKOU_B_PERIOD).max() + low.rolling(ICHIMOKU_SENKOU_B_PERIOD).min()) / 2
    senkou_a_raw = (tenkan + kijun) / 2

    span_a = senkou_a_raw.shift(ICHIMOKU_DISPLACEMENT)
    span_b = senkou_b_raw.shift(ICHIMOKU_DISPLACEMENT)
    df['cloud_top'] = pd.concat([span_a, span_b], axis=1).max(axis=1)
    df['cloud_bottom'] = pd.concat([span_a, span_b], axis=1).min(axis=1)

    ma224_gap = (close - df['ma224']).abs() / df['ma224']
    cond_ma224 = ma224_gap <= MA_CLOUD_NEAR_TOL

    cond_cloud_body = (close >= df['cloud_bottom']) & (close <= df['cloud_top'])
    cond_cloud_top_touch = high >= df['cloud_top'] * (1 - MA_CLOUD_TOP_TOL)

    # 최근 MA_CLOUD_CROSS_LOOKBACK거래일(오늘 포함) 안에 5일선이 20일선을 상향 돌파했는지 -
    # pattern_detect.detect_ma_cloud_breakout의 for 루프(first_cross_index~last_index)와
    # 동일한 범위를 rolling(window).max()로 벡터화.
    cross_today = (df['ma5'].shift(1) <= df['ma20'].shift(1)) & (df['ma5'] > df['ma20'])
    cross_within_lookback = cross_today.rolling(MA_CLOUD_CROSS_LOOKBACK).sum().fillna(0) > 0

    df['entry_signal'] = (cond_ma224 & cond_cloud_body & cond_cloud_top_touch & cross_within_lookback).fillna(False)

    return df[DAILY_PRICES_COLUMNS]


def backtest_ma_cloud_breakout(df, timecut_days=DEFAULT_TIMECUT_DAYS, slippage_pct=DEFAULT_SLIPPAGE_PCT):
    """entry_signal이 뜬 날마다 다음날 시가 진입 후 다음 규칙으로 청산한 거래별
    net_return 리스트를 반환한다(사용자 확인 규칙 그대로):
    - 손절: 종가가 그날 보이는 구름 하단 아래로 마감
    - 그 전까진 계속 보유, timecut_days(기본 20영업일) 지나면 그날 종가로 강제 청산
    gongpasan_strategy.backtest_gongpasan과 동일한 구조(순차 스캔, 슬리피지 왕복 2회)."""
    if df is None or df.empty or 'entry_signal' not in df.columns:
        return []

    close = df['close'].to_numpy(dtype=float)
    open_ = df['open'].to_numpy(dtype=float)
    cloud_bottom = df['cloud_bottom'].to_numpy(dtype=float)
    entry_signal = df['entry_signal'].to_numpy(dtype=bool)
    n = len(df)

    net_returns = []
    for i in np.where(entry_signal)[0]:
        entry_idx = i + 1
        if entry_idx >= n:
            continue
        entry_price = open_[entry_idx]
        if not np.isfinite(entry_price) or entry_price <= 0:
            continue

        exit_price = None
        last_idx = min(entry_idx + timecut_days, n - 1)
        for j in range(entry_idx, last_idx + 1):
            if np.isfinite(cloud_bottom[j]) and close[j] < cloud_bottom[j]:
                exit_price = close[j]
                break
        if exit_price is None:
            exit_price = close[last_idx]

        gross_return = (exit_price - entry_price) / entry_price
        net_returns.append(gross_return - (slippage_pct * 2))

    return net_returns


# accumulation_angle.py와 동일한 요약 로직 - 새로 만들지 않고 재사용한다.
summarize_backtest = aa.summarize_backtest
