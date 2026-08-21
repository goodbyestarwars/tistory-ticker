# -*- coding: utf-8 -*-
"""쌍바닥(pattern_detect.detect_double_bottom)을 전체 이력에 걸쳐 계산 + 백테스트할 수
있게 만든 버전. 사용자가 확인해준 정의 그대로(낙폭 이어지다 비슷한 구간에 저점 2개 형성,
첫 저점을 깨지 않고 재반등, 그 사이 넥라인을 "뚫어야 진짜 W") - 원본 스냅샷 함수의 구조
조건(저점 간격 10~45일, 두 저점 가격차 3% 이내, 2번째 저점 거래량 <= 1번째, 넥라인까지
반등폭 8%+)은 그대로 재사용하고, 신호 시점을 "넥라인 돌파 확정 순간"으로 잡는다(ascending_
triangle.py와 동일한 접근 - 원본의 "최근 캔들 양봉" 등 스냅샷 전용 확인 조건은 돌파일
자체가 이미 그 확인을 내포하므로 생략했다 - 자세한 사유는 아래 함수 docstring 참고).

원본과 마찬가지로 가장 최근 저점부터 조합을 거꾸로 탐색해 첫 매치를 쓴다(pattern_detect.
detect_double_bottom의 for b/for a 이중 루프와 동일한 우선순위)."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # backtest_entry_signal/summarize_backtest 재사용
import db_schema

SWING = 2                   # pattern_detect.PATTERN_SWING과 동일
LOOKBACK_WINDOW = 120         # pattern_detect.DOUBLE_BOTTOM_WINDOW와 동일
MIN_GAP_DAYS = 10             # pattern_detect.DB_MIN_GAP_DAYS와 동일
MAX_GAP_DAYS = 45             # pattern_detect.DB_MAX_GAP_DAYS와 동일
LOW_TOL_PCT = 3.0             # pattern_detect.DB_LOW_TOL(0.03)과 동일
SECOND_VOLUME_MAX_RATIO = 1.0  # pattern_detect.DB_SECOND_VOLUME_MAX_RATIO와 동일
PEAK_MIN_RISE_PCT = 8.0        # pattern_detect.DB_PEAK_MIN_RISE(0.08)와 동일
BREAKOUT_TOL_PCT = 2.0         # pattern_detect.BREAKOUT_TOL(1.02)과 동일
BREAKOUT_MAX_LOOKAHEAD = 10    # 패턴 완성 후 이 거래일 안에 돌파해야 유효 - ascending_triangle.py와 동일하게 임의 설정

DEFAULT_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'is_low_swing', 'neckline', 'entry_signal',
]


def _swing_mask(series, window, is_low):
    """pattern_detect.find_swing_indices와 동일한 정의(좌우 window봉과 비교, 동률 허용)를
    시리즈 전체에 대해 한 번에 boolean mask로 계산한다."""
    full_window = window * 2 + 1
    rolled = series.rolling(full_window, center=True).min() if is_low else series.rolling(full_window, center=True).max()
    return rolled.notna() & (series == rolled)


def compute_double_bottom_signal(code, conn=None, rows=None):
    """종목코드 하나로 쌍바닥 신호 DataFrame을 만든다.

    각 날짜 i마다, i 기준으로 이미 확정된(미래 봉 필요 없는) 스윙 저점만 최근
    LOOKBACK_WINDOW 거래일 안에서 모아, 가장 최근 저점(low2)부터 거꾸로 low1 후보를
    찾는다(원본과 동일한 우선순위) - gap_days(10~45일)·가격차(3% 이내)·2번째 저점 거래량
    감소·넥라인(두 저점 사이 최고가)까지 반등폭 8%+ 를 만족하는 첫 조합을 "패턴 완성"으로
    본다. entry_signal은 그 뒤 BREAKOUT_MAX_LOOKAHEAD거래일 안에 종가가 넥라인을
    BREAKOUT_TOL_PCT% 넘게 뚫는 첫 날에만 뜬다(레퍼런스: "여기를 뚫어야지 진짜 W인거예요").

    2026-08-21 원본과의 의도적 차이: pattern_detect.detect_double_bottom은 스냅샷
    판정이라 "오늘 종가가 넥라인 근처(-2%)에 왔다"만 되면 신호를 내고(has_bullish_after/
    is_last_candle_bullish로 최근 캔들 흐름을 추가 확인), 실제 돌파 여부는 scan_stock의
    표시 필터(breakout)로 별도 구분한다. 여기서는 애초에 "돌파 확정 순간"만 entry_signal로
    잡으므로(ascending_triangle.py와 동일한 접근), 그 순간의 종가 상승 자체가 이미 양봉
    조건을 사실상 내포해 원본의 캔들 확인 조건은 별도로 옮기지 않았다 - 완전히 동일한
    조건은 아니라는 점을 밝혀둔다."""
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

    n = len(df)
    lows = df['low'].to_numpy(dtype=float)
    highs = df['high'].to_numpy(dtype=float)
    closes = df['close'].to_numpy(dtype=float)
    volumes = df['volume'].to_numpy(dtype=float)
    is_low_swing = df['is_low_swing'].to_numpy()

    entry = np.zeros(n, dtype=bool)
    neckline_arr = np.full(n, np.nan)

    watching_since = None
    watching_neckline = None
    min_swing_start = -1  # ascending_triangle.py와 동일한 이유(돌파 후 스윙점 재사용 방지)

    for i in range(n):
        start = max(0, i - LOOKBACK_WINDOW + 1, min_swing_start + 1)
        confirmed_end = i - SWING  # look-ahead 방지

        pattern_ok = False
        neckline = None
        if confirmed_end >= start:
            low_idx = [k for k in range(start, confirmed_end + 1) if is_low_swing[k]]
            for b in range(len(low_idx) - 1, 0, -1):
                i2 = low_idx[b]
                if i - i2 > 5:  # pattern_detect.DB_RECENCY_MAX_GAP과 동일 - 2번째 저점이 최근이어야 함
                    continue
                for a in range(b - 1, -1, -1):
                    i1 = low_idx[a]
                    gap_days = i2 - i1
                    if gap_days < MIN_GAP_DAYS or gap_days > MAX_GAP_DAYS:
                        continue
                    low1, low2 = lows[i1], lows[i2]
                    diff_pct = abs(low1 - low2) / min(low1, low2) * 100
                    if diff_pct > LOW_TOL_PCT:
                        continue
                    if volumes[i2] > volumes[i1] * SECOND_VOLUME_MAX_RATIO:
                        continue
                    between = highs[i1 + 1:i2]
                    if len(between) == 0:
                        continue
                    neck_high = float(between.max())
                    rise_pct = (neck_high - low1) / low1 * 100
                    if rise_pct < PEAK_MIN_RISE_PCT:
                        continue
                    pattern_ok = True
                    neckline = neck_high
                    break
                if pattern_ok:
                    break

        if pattern_ok:
            watching_since = i
            watching_neckline = neckline
        elif watching_since is not None and (i - watching_since) > BREAKOUT_MAX_LOOKAHEAD:
            watching_since = None
            watching_neckline = None

        if watching_since is not None and watching_neckline:
            neckline_arr[i] = watching_neckline
            if closes[i] > watching_neckline * (1 + BREAKOUT_TOL_PCT / 100.0):
                entry[i] = True
                min_swing_start = i
                watching_since = None
                watching_neckline = None

    df['neckline'] = neckline_arr
    df['entry_signal'] = entry

    return df[DAILY_PRICES_COLUMNS]


# accumulation_angle.py와 동일한 진입/청산 가정 + 요약 로직을 재사용한다.
backtest_entry_signal = aa.backtest_entry_signal
summarize_backtest = aa.summarize_backtest
