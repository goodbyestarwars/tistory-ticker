# -*- coding: utf-8 -*-
"""시초 갭상승(pattern_detect.detect_opening_gap)을 전체 이력에 걸쳐 계산 + 백테스트할 수
있게 만든 버전. 원본은 하루짜리 스냅샷 조건(전일 종가 대비 시가 갭 + 시가 대비 종가
추가상승 + 시가·거래대금 범위)이라 스윙점이나 여러 날에 걸친 구조가 전혀 없다 - 그래서
다른 패턴들과 달리 벡터화가 단순하다(원본의 B/K/G/L 4개 조건을 그대로 pandas 비교식으로
옮기기만 하면 됨, 상태를 들고 다니는 로직이 필요 없음).

주의: 원본 자체가 "그날 갭상승·상승 마감"을 스냅샷으로 재는 조건이라, entry_signal이 뜬
당일 이미 시가 대비 크게 오른 뒤라는 점을 백테스트 해석 시 감안해야 한다(accumulation_angle.py
와 동일하게 신호일 다음날 시가에 진입하는 걸로 가정 - 신호일 당일 종가로 즉시 매수하는
게 아니다)."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # backtest_entry_signal/summarize_backtest 재사용
import db_schema

MIN_INTRADAY_PCT = 3.0        # pattern_detect.OPENING_GAP_MIN_INTRADAY_PCT와 동일
MIN_OPEN = 1_000               # pattern_detect.OPENING_GAP_MIN_OPEN과 동일
MAX_OPEN = 500_000             # pattern_detect.OPENING_GAP_MAX_OPEN과 동일
MIN_TURNOVER_MILLION = 3_000   # pattern_detect.OPENING_GAP_MIN_TURNOVER_MILLION과 동일
MAX_TURNOVER_MILLION = 999_999  # pattern_detect.OPENING_GAP_MAX_TURNOVER_MILLION과 동일

DEFAULT_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'gap_rate_pct', 'intraday_rate_pct', 'turnover_million', 'entry_signal',
]


def compute_opening_gap_signal(code, conn=None, rows=None):
    """종목코드 하나로 시초 갭상승 신호 DataFrame을 만든다. conn/rows 규칙은
    accumulation_angle.compute_accumulation_angle과 동일.

    pattern_detect.detect_opening_gap의 B/K/G/L 조건을 그대로 전체 이력에 대해
    벡터로 계산한다:
    - B: 시가가 전일 종가보다 높음
    - K: 종가가 시가 대비 MIN_INTRADAY_PCT% 이상 상승
    - G: 시가가 [MIN_OPEN, MAX_OPEN] 범위(동전주·초고가주 제외)
    - L: 거래대금(종가x거래량)이 [MIN_TURNOVER_MILLION, MAX_TURNOVER_MILLION] 범위"""
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

    open_, close, volume = df['open'], df['close'], df['volume']
    prev_close = close.shift(1)

    gap_rate_pct = (open_ / prev_close - 1) * 100
    intraday_rate_pct = (close / open_ - 1) * 100
    turnover_million = close * volume / 1_000_000

    cond_b = open_ > prev_close
    cond_k = intraday_rate_pct >= MIN_INTRADAY_PCT
    cond_g = (open_ >= MIN_OPEN) & (open_ <= MAX_OPEN)
    cond_l = (turnover_million >= MIN_TURNOVER_MILLION) & (turnover_million <= MAX_TURNOVER_MILLION)
    cond_data = prev_close.notna() & (open_ > 0) & (close > 0) & (volume > 0)

    df['gap_rate_pct'] = gap_rate_pct
    df['intraday_rate_pct'] = intraday_rate_pct
    df['turnover_million'] = turnover_million
    df['entry_signal'] = (cond_data & cond_b & cond_k & cond_g & cond_l).fillna(False)

    return df[DAILY_PRICES_COLUMNS]


# accumulation_angle.py와 동일한 진입/청산 가정 + 요약 로직을 재사용한다.
backtest_entry_signal = aa.backtest_entry_signal
summarize_backtest = aa.summarize_backtest
