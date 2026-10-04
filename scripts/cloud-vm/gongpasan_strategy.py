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
# 2026-10-04: 바닥 횡보 폭을 꼬리 포함 (최고 고가 - 최저 저가)/최저 저가 <= 20%로 명확히 정의(예전: 종가 변동폭 25%).
GONGGURI_MAX_RANGE_PCT = 20.0
# 2026-08-22 신설(작업지시서 1단계): 공구리 구간 안에 20일선-60일선 이격도가 이 비율
# 이내로 수렴하는 시점이 하루라도 있어야 함 - "진짜 바닥 다지기"와 "계단식 하락 중
# 일시 횡보"를 구분하기 위함. 임시값, 추후 백테스트로 조정.
GONGGURI_MA_CONVERGE_TOL = 0.05

DAEJIP_LOOKBACK = 60      # 매집봉 존재 확인 기간(영업일)
# 2026-10-04 매집봉 재정의: 양봉 몸통 4%를 필수로 두지 않고 "대량거래 + 종가가 봉 상단 + 장대음봉 아님 + 이후 저점 유지"로 본다.
DAEJIP_VOL_MULT = 2.0     # 매집봉 거래량 기준 - 20일 평균 대비 배수(예전 2.5)
DAEJIP_MIN_CLOSE_POSITION = 0.5   # (종가-저가)/(고가-저가) 하한 - 종가가 봉의 상단
DAEJIP_BEARISH_BODY_MAX_PCT = 4.0 # 이 이상 큰 음봉(몸통)은 매집이 아니라 투매로 보고 제외
DAEJIP_LOW_HOLD = 0.95            # 매집봉 이후 저가가 매집봉 저가의 이 비율 아래로 내려가면 매집 실패
# 2026-08-22 신설(작업지시서 2단계): 매집봉 당일 거래대금(종가x거래량)이 최소 이 금액
# (억원) 이상이어야 함 - 소형주/저유동성 종목에서 상대적 배수만으로 통과되는 착시 방지.
# 임시값, 추후 백테스트로 조정.
DAEJIP_MIN_TRADING_VALUE_EOK = 100

ODORI_LOOKBACK = 5        # "5봉 이기는 봉" - 직전 N봉 고가를 넘는지
# 2026-10-04 돌파봉: 직전 5봉 고가 돌파 + 종가 > 5일선 + 양봉 + 장대(몸통 3% 이상 또는 ATR14 x 0.8 이상).
# 예전엔 "전일 종가는 5일선 아래, 오늘 위"의 5일선 상향 교차를 요구했다.
ODORI_MIN_BODY_PCT = 3.0
ODORI_MIN_BODY_ATR = 0.8
ATR_PERIOD = 14
# 2026-08-22 신설(작업지시서 3단계): 돌파(오돌이) 당일 거래대금이 최소 이 금액(억원)
# 이상이어야 함 - 거래대금 없는 가짜 돌파(개미 털기) 필터링. 임시값, 추후 백테스트로 조정.
ODORI_MIN_TRADING_VALUE_EOK = 300

# 스킬에 명시적 숫자가 없어 임의로 정한 값 - 필요시 조정.
# 2026-10-04 첫 눌림만: 돌파 뒤 20거래일 안에 20일선에 "처음" 접근한 봉만 판정한다(접근한 봉이 지지가 아니면 그 돌파는 소진).
PULLBACK_MAX_LOOKAHEAD = 20  # BREAKOUT_TO_PULLBACK_MAX_DAYS: 돌파(오돌이) 후 이 기간 안의 첫 눌림만 유효
SUPPORT_TOUCH_TOL_PCT = 3.0   # MA20_TOUCH: 저가가 20일선 +3% 이내로 내려오면 "접근"
SUPPORT_CLOSE_FLOOR_PCT = 1.0 # 지지 확인: 종가 >= 20일선 x (1 - 1%)
LEGACY_PULLBACK_MAX_LOOKAHEAD = 40  # 호환용(변형 스캐너가 쓰는 예전 규칙)
LEGACY_SUPPORT_TOUCH_TOL_PCT = 2.0
MA20_BREAK_PCT = 3.0          # 종가가 20일선 아래 3% 넘게 마감하면 20일선 이탈(제외)

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
    'breakout_signal', 'entry_signal', 'entry_quality', 'entry_status', 'entry_breakout_idx',
    'daejip_bar', 'daejip_vol_ratio', 'ma_converge', 'atr14',
]


def trading_value_series(df):
    return df['close'] * df['volume']


def _pct_range(series, window):
    roll_max = series.rolling(window).max()
    roll_min = series.rolling(window).min()
    return (roll_max - roll_min) / roll_min * 100


def _pullback_entry_flags(breakout, low, close, sma20):
    """[호환용 - angle_momentum_pullback_variant_scan.py가 그대로 재사용하므로 2026-10-04 이전 규칙(20일선 +-2%, 40봉, 지지 실패 시 재감시) 유지]
    돌파(오돌이) 이후 처음으로 20일선에 닿아 지지받는 캔들만 True로 표시한다(스킬 §3:
    "그 눌림이 뚫었던 20일선에 닿아 지지받는 첫 캔들 = 매수 타점"). 벡터화가 아니라
    한 번의 순차 스캔으로 처리한다(종목 1개분 - 수백 개 행이라 성능에 영향 없음, 상태를
    들고 다녀야 하는 로직이라 오히려 이쪽이 더 명확함).
    - 돌파 이후 LEGACY_PULLBACK_MAX_LOOKAHEAD봉 안에서만 유효하고, 그 안에 지지 캔들이 없으면
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
        if bars_since > LEGACY_PULLBACK_MAX_LOOKAHEAD:
            watching_since = None
            continue
        ma = sma20[i]
        if bars_since >= 1 and np.isfinite(ma) and ma > 0:
            touched = low[i] <= ma * (1 + LEGACY_SUPPORT_TOUCH_TOL_PCT / 100.0)
            held = close[i] >= ma * (1 - LEGACY_SUPPORT_TOUCH_TOL_PCT / 100.0)
            if touched and held:
                entry[i] = True
                watching_since = None
    return entry


def _first_pullback_entry_flags(breakout, low, close, sma20):
    """돌파(오돌이) 이후 "처음으로" 20일선에 접근한 캔들만 평가한다(스킬 §3 + 2026-10-04 첫 눌림만).
    - 돌파 후 1봉째부터 PULLBACK_MAX_LOOKAHEAD(20)봉 안에서만 유효, 그 안에 접근이 없으면 돌파는 소멸.
    - 접근(저가 <= 20일선 x 1.03)한 첫 봉에서 감시를 끝낸다. 그 봉의 종가가 20일선 x 0.99 이상이면 entry(지지 확인),
      아니면(20일선 이탈 또는 불안한 마감) 그 돌파는 소진돼 이후 두 번째 눌림은 타점이 아니다.
    반환: (entry 불리언 배열, 각 entry의 돌파 봉 인덱스 배열(없으면 -1))."""
    n = len(breakout)
    entry = np.zeros(n, dtype=bool)
    breakout_idx = np.full(n, -1, dtype=int)
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
            if touched:
                if close[i] >= ma * (1 - SUPPORT_CLOSE_FLOOR_PCT / 100.0):
                    entry[i] = True
                    breakout_idx[i] = watching_since
                watching_since = None      # 첫 접근에서 소진(지지든 이탈이든)
    return entry, breakout_idx


def _accumulation_bars(df):
    """매집봉 후보(대량거래 + 종가가 봉 상단 + 장대음봉 아님 + 거래대금 하한) 중, 이후 저점을 크게 깨지 않고 유지되는
    구간을 각 날짜에서 볼 수 있게 (candidate 불리언, 유지 만료 인덱스) 배열로 돌려준다."""
    vol_ma20 = df['volume'].rolling(MA_MID).mean()
    vol_ratio = df['volume'] / vol_ma20
    span = (df['high'] - df['low']).replace(0, np.nan)
    close_position = (df['close'] - df['low']) / span
    body_pct = (df['close'] - df['open']) / df['open'] * 100
    trading_value = df['close'] * df['volume']
    candidate = (
        (vol_ratio >= DAEJIP_VOL_MULT)
        & (close_position >= DAEJIP_MIN_CLOSE_POSITION)
        & (body_pct > -DAEJIP_BEARISH_BODY_MAX_PCT)
        & (trading_value >= DAEJIP_MIN_TRADING_VALUE_EOK * 1e8)
    ).fillna(False).to_numpy(dtype=bool)
    low = df['low'].to_numpy(dtype=float)
    n = len(df)
    expires = np.full(n, n + 1, dtype=int)        # 매집이 깨지는 첫 인덱스(깨지지 않으면 n+1)
    for j in np.where(candidate)[0]:
        floor = low[j] * DAEJIP_LOW_HOLD
        broken = np.where(low[j + 1:] < floor)[0]
        if len(broken):
            expires[j] = j + 1 + int(broken[0])
    return candidate, expires, vol_ratio.to_numpy(dtype=float)


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

    # (2) 공구리 - 최근 40일 꼬리 포함 변동폭 (최고 고가 - 최저 저가)/최저 저가 <= 20%.
    # 20일선-60일선 수렴(ma_converge)은 2026-10-04부터 필수가 아니라 점수 가산 요소다.
    box_high = df['high'].rolling(GONGGURI_LOOKBACK).max()
    box_low = df['low'].rolling(GONGGURI_LOOKBACK).min()
    range_ok = ((box_high - box_low) / box_low * 100) <= GONGGURI_MAX_RANGE_PCT
    ma_gap_pct = (df['sma20'] - df['sma60']).abs() / df['sma60']
    ma_converge_point = ma_gap_pct <= GONGGURI_MA_CONVERGE_TOL
    df['ma_converge'] = ma_converge_point.rolling(GONGGURI_LOOKBACK).max().fillna(0).astype(bool)
    df['is_gongguri'] = range_ok.fillna(False)

    # (3) 매집봉 - 최근 60일 내 (거래량 20일평균 2배+, 종가가 봉 상단, 장대음봉 아님, 거래대금 100억+)이면서
    # 그 뒤 저점이 매집봉 저가의 95% 아래로 무너지지 않은 봉이 있는지.
    candidate, expires, vol_ratio_arr = _accumulation_bars(df)
    df['daejip_bar'] = candidate
    df['daejip_vol_ratio'] = vol_ratio_arr
    n_rows = len(df)
    has_daejip = np.zeros(n_rows, dtype=bool)
    for j in np.where(candidate)[0]:
        end = min(n_rows, j + DAEJIP_LOOKBACK + 1, expires[j])
        has_daejip[j:end] = True
    df['has_daejip_bong'] = has_daejip

    # (4) 돌파봉 - 직전 5봉 고가 돌파 + 종가 > 5일선 + 양봉 + 장대(몸통 3% 이상 또는 ATR14 x 0.8 이상) + 거래대금 300억+
    prev_close = df['close'].shift(1)
    true_range = pd.concat([df['high'] - df['low'], (df['high'] - prev_close).abs(), (df['low'] - prev_close).abs()], axis=1).max(axis=1)
    df['atr14'] = true_range.rolling(ATR_PERIOD).mean()
    prior_high5 = df['high'].rolling(ODORI_LOOKBACK).max().shift(1)
    body = df['close'] - df['open']
    body_pct_o = body / df['open'] * 100
    big_body = (body_pct_o >= ODORI_MIN_BODY_PCT) | (body >= df['atr14'] * ODORI_MIN_BODY_ATR)
    odori_trading_value_ok = trading_value_series(df) >= ODORI_MIN_TRADING_VALUE_EOK * 1e8
    df['is_odori'] = ((df['close'] > prior_high5) & (df['close'] > df['sma5']) & (df['close'] > df['open'])
                      & big_body & odori_trading_value_ok)

    df['breakout_signal'] = is_deep_decline & df['is_gongguri'] & df['has_daejip_bong'] & df['is_odori']

    entry_signal, entry_breakout_idx = _first_pullback_entry_flags(
        df['breakout_signal'].to_numpy(),
        df['low'].to_numpy(dtype=float),
        df['close'].to_numpy(dtype=float),
        df['sma20'].to_numpy(dtype=float),
    )
    df['entry_signal'] = entry_signal
    df['entry_breakout_idx'] = entry_breakout_idx
    # 상태: 지지 확인(양봉 마감 또는 전일 종가 상회) / 첫 눌림(접근은 했지만 뚜렷한 반등 전)
    confirmed = (df['close'] > df['open']) | (df['close'] > df['close'].shift(1))
    df['entry_status'] = np.where(entry_signal, np.where(confirmed, 'SUPPORT_CONFIRMED', 'FIRST_PULLBACK'), None)

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


def score_entry(df, i):
    """entry_signal이 뜬 행 i의 점수(100)와 근거. 160일 낙폭 10 · 40일 바닥 횡보 15 · 매집봉 품질 15 · 돌파봉 품질 15 ·
    돌파 거래량 10 · 첫 20일선 눌림 정확도 15 · 20일선 지지 확인 15 · 눌림 거래량 감소 5. 핵심은 첫 눌림 + MA20 지지 + 눌림 거래량 감소."""
    row = df.iloc[i]
    b = int(row['entry_breakout_idx'])
    if b < 0:
        return None
    brk = df.iloc[b]
    retreat = abs(float(brk['retreat_pct'])) if brk['retreat_pct'] == brk['retreat_pct'] else 0.0
    dd_score = 10 if retreat >= 40 else 8 if retreat >= 30 else 6

    base = df.iloc[max(0, b - GONGGURI_LOOKBACK):b]
    base_range = (base['high'].max() - base['low'].min()) / base['low'].min() * 100 if len(base) else GONGGURI_MAX_RANGE_PCT
    base_score = 15 if base_range <= 10 else 12 if base_range <= 15 else 9
    if bool(brk['ma_converge']):
        base_score = min(15, base_score + 2)

    acc_window = df.iloc[max(0, b - DAEJIP_LOOKBACK):b + 1]
    acc_ratio = float(acc_window.loc[acc_window['daejip_bar'], 'daejip_vol_ratio'].max()) if acc_window['daejip_bar'].any() else 0.0
    acc_score = 15 if acc_ratio >= 3.0 else 12 if acc_ratio >= 2.5 else 9

    body = float(brk['close'] - brk['open'])
    atr = float(brk['atr14']) if brk['atr14'] == brk['atr14'] else 0.0
    body_atr = body / atr if atr else 0.0
    brk_score = 15 if body_atr >= 1.2 else 11
    prior_vol = df['volume'].iloc[max(0, b - 20):b].mean()
    brk_vol_ratio = float(brk['volume'] / prior_vol) if prior_vol else 0.0
    brk_vol_score = 10 if brk_vol_ratio >= 2.0 else 7 if brk_vol_ratio >= 1.5 else 3

    ma20 = float(row['sma20'])
    touch_gap = abs(float(row['low']) - ma20) / ma20 * 100
    touch_score = 15 if touch_gap <= 1.0 else 12 if touch_gap <= 2.0 else 9
    support_score = 15 if (row['close'] > row['open'] and row['close'] >= ma20) else 10 if row['close'] >= ma20 else 7
    pull_vols = df['volume'].iloc[b + 1:i + 1]
    pull_ratio = float(pull_vols.mean() / brk['volume']) if len(pull_vols) and brk['volume'] else 1.0
    pull_score = 5 if pull_ratio <= 0.70 else 2
    score = dd_score + base_score + acc_score + brk_score + brk_vol_score + touch_score + support_score + pull_score
    reasons = [
        '160일 고점 대비 -%.1f%%(%d/10점) · 40일 바닥 횡보폭 %.1f%%(%d/15점)' % (retreat, dd_score, base_range, base_score),
        '매집봉 거래량 %.1f배(%d/15점) · 돌파봉 몸통 ATR의 %.1f배(%d/15점) · 돌파 거래량 %.1f배(%d/10점)' % (
            acc_ratio, acc_score, body_atr, brk_score, brk_vol_ratio, brk_vol_score),
        '돌파 후 %d거래일째 첫 20일선 눌림: 저가-MA20 %.1f%%(%d/15점) · 지지 확인(%d/15점)' % (i - b, touch_gap, touch_score, support_score),
        '눌림 구간 평균 거래량 돌파봉의 %.0f%%(%d/5점)' % (pull_ratio * 100, pull_score),
    ]
    detail = {
        'status': row['entry_status'],
        'breakoutIdx': b,
        'breakoutDate': brk['date'].strftime('%Y-%m-%d'),
        'breakoutLevel': float(df['high'].iloc[max(0, b - ODORI_LOOKBACK):b].max()),
        'baseHigh': float(base['high'].max()) if len(base) else None,
        'baseLow': float(base['low'].min()) if len(base) else None,
        'accumulationDate': (acc_window.index[acc_window['daejip_bar']].tolist() and
                             df.loc[acc_window.index[acc_window['daejip_bar']][-1], 'date'].strftime('%Y-%m-%d')) or None,
        'daysSinceBreakout': i - b,
        'ma20Distance': round(touch_gap, 2),
        'pullbackVolumeRatio': round(pull_ratio, 2),
    }
    return min(100, score), reasons, detail


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
