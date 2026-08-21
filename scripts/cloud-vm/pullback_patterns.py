# -*- coding: utf-8 -*-
"""눌림목 3가지(우량주/추세/급등주) 중 사용자가 고른 2가지(우량주·급등주)를 전체 이력에
걸쳐 계산 + 백테스트할 수 있게 만든 모듈.

- 우량주 눌림목(compute_bluechip_pullback_signal): pattern_detect.detect_pullback을
  그대로 전체 이력에 걸쳐 계산하는 버전. 원본은 "오늘 스냅샷"만 보는 함수라 과거에 이
  조건을 며칠이나 만족했는지, 승률이 얼마인지는 알 수 없었다 - 조건식/상수는 원본과
  전부 동일(20/240일선 근접·20일선 상승·상승구간 거래량 증가+조정구간 감소 등), 매일
  독립적으로 재판정하는 스냅샷 성격도 그대로 유지한다(원본처럼 조건을 만족하는 며칠이
  연속으로 있으면 그 며칠 전부 각자 신호로 취급 - accumulation_angle.entry_signal과
  동일한 방식).

- 급등주 눌림목(compute_surge_pullback_signal): "짧은 기간에 크게 튀어오른 뒤 눌림목"이라는
  다른 성격의 패턴이라 우량주 눌림목과 상수를 다르게 잡았다 - 훨씬 짧은 구간(SURGE_LOOKBACK)
  안에 훨씬 큰 상승폭(SURGE_MIN_RISE)이 나야 "급등"으로 보고, 장기 이평선(20/240일선) 근접
  조건은 요구하지 않는다(급등주는 모멘텀 플레이라 평균회귀보다 최근 가격 구조가 중요하다고
  보고 뺐다). 스킬/사용자가 준 정확한 숫자가 없어 임의로 정했다(코드 주석에 명시)."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # summarize_backtest 재사용
import db_schema

# ---- 우량주 눌림목: pattern_detect.PULLBACK_* 상수와 전부 동일 ----
BLUECHIP_WINDOW = 260
BLUECHIP_LOOKBACK = 20
BLUECHIP_MIN_RISE = 0.15
BLUECHIP_MIN_DROP = 0.05
BLUECHIP_MAX_DROP = 0.15
BLUECHIP_MA_TOL = 0.03
BLUECHIP_MIN_DAYS = 240
BLUECHIP_MA_SLOPE_LOOKBACK = 5

# ---- 급등주 눌림목: 짧고 강한 상승 + 눌림 - 스킬/사용자가 준 숫자 없어 임의 설정 ----
SURGE_LOOKBACK = 10          # 이 안에서 급등 고점을 찾음(우량주의 20일보다 훨씬 짧게)
SURGE_MIN_RISE = 0.30         # 이 구간 상승폭 최소 30%(우량주 15%의 2배 - "급등"이라 부를 크기)
SURGE_MIN_DROP = 0.05
SURGE_MAX_DROP = 0.20         # 급등한 만큼 조정폭도 조금 더 넓게 허용
SURGE_MIN_DAYS = 30           # 급등 고점 탐색에 필요한 최소 보유 일수(장기 이평 조건 없음)

DEFAULT_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

BLUECHIP_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume', 'ma20', 'ma240', 'entry_signal']
SURGE_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume', 'entry_signal']


def _load(code, conn, rows):
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
        return None
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'])
    return df.sort_values('date').reset_index(drop=True)


def _volume_increasing(vol, from_idx, to_idx):
    """pattern_detect.is_volume_increasing과 동일한 정의(절반 구간 평균 비교)."""
    mid = from_idx + (to_idx - from_idx) // 2
    if mid <= from_idx or to_idx <= mid:
        return False
    early = vol[from_idx:mid].mean()
    late = vol[mid:to_idx].mean()
    return early > 0 and late > early


def _volume_declining(vol, from_idx, to_idx):
    """pattern_detect.is_volume_declining과 동일한 정의."""
    mid = from_idx + (to_idx - from_idx) // 2
    if mid <= from_idx or to_idx <= mid:
        return False
    early = vol[from_idx:mid].mean()
    late = vol[mid:to_idx].mean()
    return early > 0 and late < early


def compute_bluechip_pullback_signal(code, conn=None, rows=None):
    """pattern_detect.detect_pullback과 동일한 조건을 전체 이력에 걸쳐 매일 재판정한다.
    최근 25거래일(BLUECHIP_LOOKBACK+5) 안에서 고점→그 이전 최저점을 찾는 부분은 원본의
    recent_start 계산이 실제로는 260일 전체 창과 무관하게 항상 "최근 25일"만 본다는 걸
    확인하고(원본 코드 재검토 결과) 매일 고정폭 25일 윈도우로 단순화했다."""
    df = _load(code, conn, rows)
    if df is None:
        return pd.DataFrame(columns=BLUECHIP_COLUMNS)

    close = df['close'].to_numpy(dtype=float)
    volume = df['volume'].to_numpy(dtype=float)
    ma20 = df['close'].rolling(20).mean()
    ma240 = df['close'].rolling(240).mean()
    ma20_arr = ma20.to_numpy(dtype=float)
    n = len(df)

    entry = np.zeros(n, dtype=bool)
    recent_span = BLUECHIP_LOOKBACK + 5

    for i in range(n):
        if i + 1 < BLUECHIP_MIN_DAYS:
            continue
        recent_start = max(0, i - recent_span + 1)
        window_closes = close[recent_start:i + 1]
        peak_local = int(np.argmax(window_closes))
        peak_idx = recent_start + peak_local
        if i - peak_idx > BLUECHIP_LOOKBACK:
            continue
        low_local = int(np.argmin(window_closes[:peak_local + 1]))
        low_idx = recent_start + low_local
        if low_idx >= peak_idx:
            continue

        low_close, peak_close = close[low_idx], close[peak_idx]
        rise_ratio = (peak_close - low_close) / low_close
        if rise_ratio < BLUECHIP_MIN_RISE:
            continue

        last_close = close[i]
        drop_ratio = (peak_close - last_close) / peak_close
        if drop_ratio < BLUECHIP_MIN_DROP or drop_ratio > BLUECHIP_MAX_DROP:
            continue

        ma20_now = ma20_arr[i]
        ma240_now = ma240.iloc[i]
        diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now and np.isfinite(ma20_now) else np.inf
        diff240 = abs(last_close - ma240_now) / ma240_now if ma240_now and np.isfinite(ma240_now) else np.inf
        if diff20 > BLUECHIP_MA_TOL and diff240 > BLUECHIP_MA_TOL:
            continue

        slope_from_idx = i - BLUECHIP_MA_SLOPE_LOOKBACK
        if slope_from_idx < 0 or not np.isfinite(ma20_now):
            continue
        ma20_slope_from = ma20_arr[slope_from_idx]
        if not np.isfinite(ma20_slope_from) or ma20_now < ma20_slope_from:
            continue

        if not _volume_increasing(volume, low_idx, peak_idx) or not _volume_declining(volume, peak_idx, i + 1):
            continue

        entry[i] = True

    df['ma20'] = ma20
    df['ma240'] = ma240
    df['entry_signal'] = entry
    return df[BLUECHIP_COLUMNS]


def compute_surge_pullback_signal(code, conn=None, rows=None):
    """급등(SURGE_LOOKBACK일 안에 SURGE_MIN_RISE% 이상 상승) 후 눌림목을 매일 재판정한다.
    우량주 눌림목과 달리 장기 이평선 근접·이평선 상승 조건은 요구하지 않는다(급등주는
    모멘텀 성격이라 평균회귀 기준이 덜 맞다고 보고 뺐다 - 대신 상승구간 거래량 증가는
    "진짜 매수세가 들어온 급등"인지 구분하는 최소한의 확인으로 유지)."""
    df = _load(code, conn, rows)
    if df is None:
        return pd.DataFrame(columns=SURGE_COLUMNS)

    close = df['close'].to_numpy(dtype=float)
    volume = df['volume'].to_numpy(dtype=float)
    n = len(df)

    entry = np.zeros(n, dtype=bool)
    recent_span = SURGE_LOOKBACK + 5

    for i in range(n):
        if i + 1 < SURGE_MIN_DAYS:
            continue
        recent_start = max(0, i - recent_span + 1)
        window_closes = close[recent_start:i + 1]
        peak_local = int(np.argmax(window_closes))
        peak_idx = recent_start + peak_local
        if i - peak_idx > SURGE_LOOKBACK:
            continue
        low_local = int(np.argmin(window_closes[:peak_local + 1]))
        low_idx = recent_start + low_local
        if low_idx >= peak_idx:
            continue

        low_close, peak_close = close[low_idx], close[peak_idx]
        rise_ratio = (peak_close - low_close) / low_close
        if rise_ratio < SURGE_MIN_RISE:
            continue

        last_close = close[i]
        drop_ratio = (peak_close - last_close) / peak_close
        if drop_ratio < SURGE_MIN_DROP or drop_ratio > SURGE_MAX_DROP:
            continue

        if not _volume_increasing(volume, low_idx, peak_idx):
            continue

        entry[i] = True

    df['entry_signal'] = entry
    return df[SURGE_COLUMNS]


# accumulation_angle.py와 동일한 진입/청산 가정 + 요약 로직을 재사용한다.
backtest_entry_signal = aa.backtest_entry_signal
summarize_backtest = aa.summarize_backtest
