# -*- coding: utf-8 -*-
""""공파산" 전략 - 역매공파(역배열·매집봉·공구리·파란점선) + 오돌이 기법을 코드로 옮긴 것.
정의는 이 저장소의 `.claude/skills/synced/yeokmaegongpa` 스킬(채팅에서 "역매공파 스캔 돌려줘"
같은 요청에 이미 쓰이던 검증된 가이드, 12종목·600일 백테스트 기록 있음)을 그대로 따른다 -
"공파산"은 사용자가 그 스킬에 붙인 다른 이름일 뿐, 조건 자체는 동일하다.

2026-08-20: 처음 받은 작업지시서(다른 AI가 작성)는 파란점선을 볼린저밴드 상단(20,2)으로,
공구리를 "20·60일선이 112일선과 ±3% 이격"으로 정의했는데, 둘 다 이 프로젝트의 기존
역매공파 스킬과 어긋난다(스킬은 "파란점선은 볼린저밴드 아님 - 엔벨로프 상단"이라고 명시,
공구리도 이평선 수렴이 아니라 "가격 변동폭이 좁게 다져지는 구간"으로 정의). 사용자 확인 후
스킬 정의를 그대로 따르기로 했다 - 아래 상수/조건식은 스킬 문서(§4 필터, §2 오돌이, §3 타점)
숫자를 그대로 옮긴 것이고, 스킬에 명시적 숫자가 없는 항목(눌림목 유효기간, 지지 허용오차)만
주석에 "스킬에 명시 없음 - 임의 설정"이라고 밝혀뒀다.

주의: 이동평균은 pandas-ta 없이(이 환경 Python 3.11엔 설치 불가, accumulation_angle.py와
동일 사유) pandas `.rolling().mean()`(단순이동평균 SMA)으로 계산한다 - 스킬 문서의 "이평선"은
전부 SMA를 가리킨다(EMA 아님)."""

import numpy as np
import pandas as pd

import db_schema

MA_SHORT = 5
MA_MID = 20
MA_MID2 = 60
MA_LONG1 = 112
MA_LONG2 = 224
MA_ENVELOPE = 46          # 파란점선 기준선(엔벨로프 중심)
ENVELOPE_PCT = 0.12       # 일봉 근사치(스킬 §1: "일봉 +-10~15%" 중간값)

DECLINE_LOOKBACK = 160    # 낙폭 기준 고점 조회 기간(영업일)
DECLINE_MIN_PCT = 25.0    # 최근 160일 고점 대비 낙폭 최소치(%)

GONGGURI_LOOKBACK = 40    # 공구리(바닥 다지기) 조회 기간(영업일)
GONGGURI_MAX_RANGE_PCT = 25.0  # 그 기간 종가 변동폭 (max-min)/min 상한(%)
# 2026-08-22 신설(작업지시서 1단계): 공구리 구간 안에 20일선-60일선 이격도가 이 비율
# 이내로 수렴하는 시점이 하루라도 있어야 함 - "진짜 바닥 다지기"와 "계단식 하락 중
# 일시 횡보"를 구분하기 위함. 임시값, 추후 백테스트로 조정.
GONGGURI_MA_CONVERGE_TOL = 0.05

DAEJIP_LOOKBACK = 60      # 매집봉 존재 확인 기간(영업일)
DAEJIP_VOL_MULT = 2.5     # 매집봉 거래량 기준 - 20일 평균 대비 배수
DAEJIP_BODY_MIN_PCT = 4.0  # 매집봉 몸통 최소 크기((종가-시가)/시가, %)
# 2026-08-22 신설(작업지시서 2단계): 매집봉 당일 거래대금(종가x거래량)이 최소 이 금액
# (억원) 이상이어야 함 - 소형주/저유동성 종목에서 상대적 배수만으로 통과되는 착시 방지.
# 임시값, 추후 백테스트로 조정.
DAEJIP_MIN_TRADING_VALUE_EOK = 100

ODORI_LOOKBACK = 5        # "5봉 이기는 봉" - 직전 N봉 고가를 넘는지
# 2026-08-22 신설(작업지시서 3단계): 돌파(오돌이) 당일 거래대금이 최소 이 금액(억원)
# 이상이어야 함 - 거래대금 없는 가짜 돌파(개미 털기) 필터링. 임시값, 추후 백테스트로 조정.
ODORI_MIN_TRADING_VALUE_EOK = 300

# 스킬에 명시적 숫자가 없어 임의로 정한 값 - 필요시 조정.
PULLBACK_MAX_LOOKAHEAD = 40  # 돌파(오돌이) 후 이 기간 안의 눌림목만 유효한 타점으로 인정
SUPPORT_TOUCH_TOL_PCT = 2.0   # 저가가 지지선(20일선) ±이 % 이내로 닿았다고 볼 허용오차

DEFAULT_TIMECUT_DAYS = 20     # 사용자 원 지시서에 명시된 값 그대로 유지
DEFAULT_SLIPPAGE_PCT = 0.0015

# 2026-08-20: 실제 VM 백테스트 결과(863건) 승률이 25.03%로 낮게 나와 원인을 짚어봤다 -
# entry_signal 자체가 "20일선에 막 지지받은 첫 캔들"에서 진입하는데, 손절 기준이 "종가가
# 20일선 아래로 마감"이라 진입가와 손절가가 거의 붙어있는 구조였다. 진입 직후 하루만
# 살짝 흔들려도(휩쏘) 바로 손절되기 쉬워 승률이 구조적으로 낮아질 수밖에 없었던 것으로
# 보인다(스킬에 손절 버퍼 명시 없음 - 임의로 추가). 20일선 대비 몇 % 더 빠져야 진짜
# 이탈로 보도록 여유를 뒀다 - 실제 승률 개선 여부는 VM에서 재배포 후 백테스트를 다시
# 돌려봐야 확인 가능하다(로컬엔 실제 시세 DB가 없어 직접 검증 불가).
STOP_BUFFER_PCT = 3.0

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'sma5', 'sma20', 'sma46', 'sma60', 'sma112', 'sma224', 'blue_line',
    'retreat_pct', 'is_gongguri', 'has_daejip_bong', 'is_odori',
    'breakout_signal', 'entry_signal', 'entry_quality',
]


def _pct_range(series, window):
    roll_max = series.rolling(window).max()
    roll_min = series.rolling(window).min()
    return (roll_max - roll_min) / roll_min * 100


def _pullback_entry_flags(breakout, low, close, sma20):
    """돌파(오돌이) 이후 처음으로 20일선에 닿아 지지받는 캔들만 True로 표시한다(스킬 §3:
    "그 눌림이 뚫었던 20일선에 닿아 지지받는 첫 캔들 = 매수 타점"). 벡터화가 아니라
    한 번의 순차 스캔으로 처리한다(종목 1개분 - 수백 개 행이라 성능에 영향 없음, 상태를
    들고 다녀야 하는 로직이라 오히려 이쪽이 더 명확함).
    - 돌파 이후 PULLBACK_MAX_LOOKAHEAD봉 안에서만 유효하고, 그 안에 지지 캔들이 없으면
      해당 돌파는 소멸(다음 새 돌파를 다시 기다림).
    - 지지 캔들 하나를 찾으면 그 돌파는 소진되고(같은 돌파로 두 번 타점 안 남), 다음 새
      돌파가 나와야 다시 감시를 시작한다."""
    n = len(breakout)
    entry = np.zeros(n, dtype=bool)
    watching_since = None
    for i in range(n):
        if breakout[i]:
            watching_since = i
            continue
        if watching_since is None:
            continue
        bars_since = i - watching_since
        if bars_since > PULLBACK_MAX_LOOKAHEAD:
            watching_since = None
            continue
        ma = sma20[i]
        if bars_since >= 1 and np.isfinite(ma) and ma > 0:
            touched = low[i] <= ma * (1 + SUPPORT_TOUCH_TOL_PCT / 100.0)
            held = close[i] >= ma * (1 - SUPPORT_TOUCH_TOL_PCT / 100.0)
            if touched and held:
                entry[i] = True
                watching_since = None
    return entry


def calculate_gongpasan_signal(code, conn=None, rows=None):
    """종목코드 하나로 공파산(역매공파) 신호 DataFrame을 만든다.

    - breakout_signal: 낙폭과대(§4-1) + 공구리(§4-2, 2026-08-22부터 40일 변동폭 조건에
      "20일선-60일선 이격도 5% 이내 수렴 시점 존재" 조건 추가) + 매집봉(§4-3, 2026-08-22부터
      거래대금 100억 이상 조건 추가) + 오돌이 돌파(§4-4, 2026-08-22부터 거래대금 300억
      이상 조건 추가)를 전부 만족하는 "관심 등록" 시점(스킬 §5: 이 시점 자체는 매수
      자리가 아님).
    - entry_signal: breakout_signal 이후 처음으로 20일선에 지지받는 눌림목 캔들(스킬 §3의
      "진짜 타점"). 화면·백테스트 모두 이 컬럼을 매수 신호로 쓴다.
    - entry_quality(2026-08-22 신설): entry_signal이 뜬 날의 캔들 품질을 'high'(양봉 마감
      또는 아래꼬리>몸통)/'low'(단순 턱걸이 마감)로 별도 표기 - entry_signal 자체를
      걸러내는 필수조건은 아니고(신호는 넓게), 우선순위/가점 참고용으로만 쓴다.

    conn/rows 규칙은 accumulation_angle.compute_accumulation_angle과 동일(rows를 미리
    넘기면 DB 재조회 없이 그대로 씀)."""
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

    df['sma5'] = df['close'].rolling(MA_SHORT).mean()
    df['sma20'] = df['close'].rolling(MA_MID).mean()
    df['sma46'] = df['close'].rolling(MA_ENVELOPE).mean()
    df['sma60'] = df['close'].rolling(MA_MID2).mean()
    df['sma112'] = df['close'].rolling(MA_LONG1).mean()
    df['sma224'] = df['close'].rolling(MA_LONG2).mean()
    df['blue_line'] = df['sma46'] * (1 + ENVELOPE_PCT)

    # (1) 낙폭과대 - 최근 160일 고점 대비 현재가 하락률
    high160 = df['high'].rolling(DECLINE_LOOKBACK).max()
    df['retreat_pct'] = (df['close'] - high160) / high160 * 100
    is_deep_decline = df['retreat_pct'] <= -DECLINE_MIN_PCT

    # (2) 공구리 - 최근 40일 종가 변동폭
    range_ok = _pct_range(df['close'], GONGGURI_LOOKBACK) <= GONGGURI_MAX_RANGE_PCT
    # 2026-08-22 신설: 그 40일 구간 안에 20일선-60일선 이격도가 GONGGURI_MA_CONVERGE_TOL
    # (5%) 이내로 수렴하는 날이 하루라도 있어야 "진짜 바닥 다지기"로 인정 - 계단식
    # 하락 중 일시 횡보(이평선끼리 계속 벌어져 있음)와 구분.
    ma_gap_pct = (df['sma20'] - df['sma60']).abs() / df['sma60']
    ma_converge_point = ma_gap_pct <= GONGGURI_MA_CONVERGE_TOL
    has_ma_converge = ma_converge_point.rolling(GONGGURI_LOOKBACK).max().fillna(0).astype(bool)
    df['is_gongguri'] = range_ok & has_ma_converge

    # (3) 매집봉 - 최근 60일 내 (거래량 20일평균 2.5배+ & 양봉 몸통 4%+ & 거래대금 100억+)
    # 가 한 번이라도 있었는지. 2026-08-22: 거래대금 조건 신설(소형주 상대배수 착시 방지).
    vol_ma20 = df['volume'].rolling(MA_MID).mean()
    body_pct = (df['close'] - df['open']) / df['open'] * 100
    trading_value = df['close'] * df['volume']
    daejip_bar = (
        (df['volume'] >= vol_ma20 * DAEJIP_VOL_MULT)
        & (body_pct >= DAEJIP_BODY_MIN_PCT)
        & (trading_value >= DAEJIP_MIN_TRADING_VALUE_EOK * 1e8)
    )
    df['has_daejip_bong'] = daejip_bar.rolling(DAEJIP_LOOKBACK).max().fillna(0).astype(bool)

    # (4) 오돌이 - 직전 5봉 고가를 넘는 장대양봉 + 5일선 상향 돌파 + 돌파 당일 거래대금
    # 300억 이상(2026-08-22 신설 - 거래대금 없는 가짜 돌파/개미 털기 필터링).
    prior_high5 = df['high'].rolling(ODORI_LOOKBACK).max().shift(1)
    ma5_cross_up = (df['close'] > df['sma5']) & (df['close'].shift(1) <= df['sma5'].shift(1))
    odori_trading_value_ok = trading_value >= ODORI_MIN_TRADING_VALUE_EOK * 1e8
    df['is_odori'] = (df['close'] > prior_high5) & ma5_cross_up & odori_trading_value_ok

    df['breakout_signal'] = is_deep_decline & df['is_gongguri'] & df['has_daejip_bong'] & df['is_odori']

    entry_signal = _pullback_entry_flags(
        df['breakout_signal'].to_numpy(),
        df['low'].to_numpy(dtype=float),
        df['close'].to_numpy(dtype=float),
        df['sma20'].to_numpy(dtype=float),
    )
    df['entry_signal'] = entry_signal

    # 2026-08-22 신설(작업지시서 4단계): 지지 캔들(⑤) 자체는 여전히 필수조건 그대로 두고
    # (AND로 추가 안 함), 대신 캔들 품질을 별도 필드로 표기한다 - "신호는 넓게, 품질은
    # 별도 표기"(눌림목 check_pullback_entry_trigger/박스권 check_box_range_low_entry_trigger와
    # 같은 설계 원칙). 양봉 마감 또는 아래꼬리>몸통이면 'high', 단순 턱걸이 마감(도지형
    # 등)이면 'low' - entry_signal 자체는 이 값과 무관하게 그대로 True.
    body = (df['close'] - df['open']).abs()
    lower_wick = df[['open', 'close']].min(axis=1) - df['low']
    high_quality_candle = (df['close'] > df['open']) | (lower_wick > body)
    df['entry_quality'] = np.where(entry_signal, np.where(high_quality_candle, 'high', 'low'), None)

    return df[DAILY_PRICES_COLUMNS]


def backtest_gongpasan(df, timecut_days=DEFAULT_TIMECUT_DAYS, slippage_pct=DEFAULT_SLIPPAGE_PCT):
    """calculate_gongpasan_signal()이 만든 DataFrame(종목 1개분)을 받아, entry_signal(눌림목
    매수 타점)이 뜬 날마다 다음날 시가 진입 후 다음 규칙으로 청산한 거래별 net_return
    리스트를 반환한다(스킬 §3):
    - 손절: 종가가 20일선(지지선) 아래로 마감
    - 목표: 종가가 파란점선(엔벨로프 상단) 이상 도달
    - 타임컷: 위 둘 다 없이 timecut_days(기본 20영업일) 경과
    슬리피지는 매수·매도 각각 차감(왕복 2회)."""
    if df is None or df.empty or 'entry_signal' not in df.columns:
        return []

    close = df['close'].to_numpy(dtype=float)
    open_ = df['open'].to_numpy(dtype=float)
    sma20 = df['sma20'].to_numpy(dtype=float)
    blue_line = df['blue_line'].to_numpy(dtype=float)
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
            if np.isfinite(sma20[j]) and close[j] < sma20[j] * (1 - STOP_BUFFER_PCT / 100.0):
                exit_price = close[j]
                break
            if np.isfinite(blue_line[j]) and close[j] >= blue_line[j]:
                exit_price = close[j]
                break
        if exit_price is None:
            exit_price = close[last_idx]

        gross_return = (exit_price - entry_price) / entry_price
        net_returns.append(gross_return - (slippage_pct * 2))

    return net_returns


def summarize_backtest(net_returns):
    """accumulation_angle.summarize_backtest와 동일한 요약 로직(코드 중복이지만, 두 전략
    모듈이 서로 몰라도 되게 독립적으로 유지하기로 함 - 지시서 요구사항)."""
    if not net_returns:
        return None
    arr = np.array(net_returns, dtype=float)
    wins = arr[arr > 0]
    losses = arr[arr <= 0]
    profit_factor = None
    if len(losses) and losses.sum() != 0:
        profit_factor = round(float(wins.sum() / abs(losses.sum())), 2)
    return {
        'totalTrades': int(len(arr)),
        'winRatePct': round(float(len(wins) / len(arr) * 100), 2),
        'avgReturnPct': round(float(arr.mean() * 100), 2),
        'medianReturnPct': round(float(np.median(arr) * 100), 2),
        'profitFactor': profit_factor,
        'avgWinPct': round(float(wins.mean() * 100), 2) if len(wins) else None,
        'avgLossPct': round(float(abs(losses.mean()) * 100), 2) if len(losses) else None,
    }
