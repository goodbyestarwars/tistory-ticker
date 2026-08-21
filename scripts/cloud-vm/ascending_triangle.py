# -*- coding: utf-8 -*-
"""저점 상승형(Rising Lows) - 저점은 계단식으로 높아지는데(파란 추세선이 우상향) 저항선
(고점을 이은 선)이 그보다 느리게 움직이거나 아예 안 올라서 둘 사이 간격이 갈수록 좁혀지는
수렴 구조. 이 압축이 끝나고 저항선을 위로 뚫는 순간을 "폭발"(explosive breakout) 신호로
본다 - 사용자가 그린 그림(계단식 저점 + 저항선 + 저점을 이은 우상향 추세선 + 돌파 후 폭등)을
그대로 코드로 옮긴 것.

pattern_detect.detect_rising_lows(저점상승형)와의 차이: 그쪽은 저점이 높아지는 것만 필수
조건으로 보고 고점은 점수에만 살짝 반영한다(고점이 뭘 하든 신호는 뜸). 이건 저점-고점 간격이
"갈수록 좁혀지는지"를 필수 조건으로 추가하고, 신호 시점도 "형성 중"이 아니라 "막 뚫은 순간"
(저항선 상향 돌파)으로 잡는다.

2026-08-21: 처음엔 저항선을 "고점들끼리 RESISTANCE_FLAT_TOL_PCT(2.5%) 이내로 몰려있어야
함"으로 딱딱하게 정의했는데, 사용자가 두 번째 그림(저항선이 완전히 평평하지 않고 살짝
우하향하면서 저점 추세선과 서로 좁혀 들어가는 모양)을 보여주며 "자로 잴 필요 없이 - 눈으로
봤을 때 흐름을 만들어 간다고 할까?"로 조건을 넓혀달라고 해서 "고점이 오르지 않고(평평하거나
완만하게 하락) + 간격이 좁혀지는지"로 한 차례 넓혔다. 같은 날 사용자가 "저점 상승형은
(1) 상단 막혀있고 저점 높아지는 거, (2) 둘 다 높아지는 거, (3) 상단 낮아지고 저점 높아지는
거 - 이 3개만 걸리면 된다"고 정확히 3가지 유형을 못박아서, 저항선이 "오르지 않아야 한다"는
제약 자체를 없애고 "저점이 계단식으로 오르고 + 간격이 갈수록 좁혀지는지"만 필수 조건으로
남겼다. 이러면 저항선이 오르든(단 저점보다 느리게 올라 간격이 좁혀질 때만) 평평하든 완만히
내리든(RESISTANCE_MAX_DECLINE_PCT 이내) 3가지 다 자연스럽게 걸리고, 저항선이 저점보다
더 빨리 올라 간격이 벌어지는 발산형 채널(막힘 없음)만 여전히 제외된다.

주의:
- 저점/고점 최소 개수, 저항 평탄 허용오차, 룩백 구간, 돌파 확인 폭은 스킬이나 사용자가 준
  정확한 숫자가 없어 임의로 정했다(아래 상수 주석에 명시) - "실제 확률"(백테스트) 결과를
  보고 조정이 필요할 수 있다.
- 스윙 저점/고점 판정(_swing_mask)은 좌우 SWING봉을 다 봐야 확정되는데(가운데 정렬
  rolling), 이 확정에 필요한 미래 봉이 아직 안 왔으면(오늘 기준 k+SWING > 오늘) 그 스윙을
  "안다"고 치지 않는다 - 그렇지 않으면 백테스트가 미래 정보를 미리 아는 셈이 돼(look-ahead
  편향) 승률이 실제보다 좋게 나올 수 있다."""

import numpy as np
import pandas as pd

import accumulation_angle as aa  # backtest_entry_signal/summarize_backtest 재사용
import db_schema

SWING = 2                       # 좌우 몇 봉과 비교해 스윙점으로 볼지 - pattern_detect.PATTERN_SWING과 동일
LOOKBACK_WINDOW = 60             # 삼각형 전체를 찾아볼 구간(거래일) - 임의 설정
MIN_LOW_SWINGS = 3                # "계단식 저점"이라 부르려면 최소 몇 개 필요한지 - 임의 설정(사용자 그림은 5개)
MIN_HIGH_SWINGS = 3                # 저항선이 "테스트됐다"고 보려면 고점이 최소 몇 개 필요한지 - 임의 설정.
                                    # 2026-08-21: 처음엔 2로 뒀는데, 고점도 완만하게 계속 오르는
                                    # 평행채널(막힘 없음)에서 인접한 2개 고점만 우연히 허용오차
                                    # 안에 들어와 "막혀있다"고 오판하는 걸 합성 데이터로 발견해 3으로
                                    # 올렸다(저항 테스트 최소 3회는 있어야 "막혔다"고 볼 근거가 됨).
RESISTANCE_MAX_DECLINE_PCT = 15.0  # 저항선이 완만하게 하락하는 것까진 허용하되, 이 %보다
                                    # 더 무너지면 "수렴"이 아니라 그냥 하락 추세로 본다 - 느슨한
                                    # 안전판일 뿐 주 판정 기준은 아니다(임의 설정).
BREAKOUT_TOL_PCT = 2.0             # 저항선 대비 이 % 넘게 종가가 올라야 "돌파" 확정 - pattern_detect.BREAKOUT_TOL(1.02)과 동일 기준
BREAKOUT_MAX_LOOKAHEAD = 10        # 삼각형 완성 후 이 거래일 안에 돌파해야 유효 - 임의 설정

DEFAULT_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
DEFAULT_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume',
    'is_low_swing', 'is_high_swing', 'resistance', 'entry_signal',
]


def _swing_mask(series, window, is_low):
    """pattern_detect.find_swing_indices와 동일한 정의(좌우 window봉과 비교, 동률 허용)를
    시리즈 전체에 대해 한 번에 boolean mask로 계산한다."""
    full_window = window * 2 + 1
    rolled = series.rolling(full_window, center=True).min() if is_low else series.rolling(full_window, center=True).max()
    return rolled.notna() & (series == rolled)


def compute_ascending_triangle_signal(code, conn=None, rows=None):
    """종목코드 하나로 상승삼각형 신호 DataFrame을 만든다.

    각 날짜 i마다, i 기준으로 "이미 확정된"(미래 봉 필요 없이 오늘까지 데이터로 알 수 있는)
    스윙 저점/고점만 모아 최근 LOOKBACK_WINDOW 거래일 안에서:
    - 스윙 저점이 MIN_LOW_SWINGS개 이상이고 전부 순차적으로 높아지는 계단식이며
    - 스윙 고점이 MIN_HIGH_SWINGS개 이상이고, 너무 무너지지만 않고(하락한다면
      RESISTANCE_MAX_DECLINE_PCT 이내), 저점-고점 간격이 갈수록 좁혀지고 있으면
    "삼각형 완성"으로 보고 가장 최근 저항 터치를 저항선으로 기록한다. 저항선이 평평하든,
    저점보다 느리게 올라가든, 완만히 내려가든 셋 다 이 조건을 통과한다 - 저항선이 저점보다
    더 빨리 올라 간격이 벌어지는 발산형 채널만 제외된다. entry_signal은 삼각형 완성 후
    BREAKOUT_MAX_LOOKAHEAD거래일 안에 종가가 그 저항선을 BREAKOUT_TOL_PCT% 넘게 뚫는 첫
    날에만 뜬다. 상태(삼각형 완성 후 돌파 대기 중인지)를 들고 다녀야 하는 순차 스캔이라
    gongpasan_strategy.py의 _pullback_entry_flags와 같은 방식(파이썬 루프)으로 처리한다 -
    종목 1개분(수백~수천 행)이라 성능에 영향 없다."""
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

    watching_since = None       # 삼각형이 완성된 날짜 인덱스(돌파를 기다리는 중)
    watching_resistance = None
    # 2026-08-21: 돌파 이후에도 돌파 전 스윙점들이 여전히 룩백 구간 안에 남아있으면, 그
    # 오래된 저점·고점 조합으로 "새 삼각형"이 곧바로 다시 완성된 걸로 잘못 인식돼 같은
    # 돌파가 다음 며칠 동안 반복 신호를 내는 문제를 합성 데이터 테스트로 발견했다. 한 번
    # 돌파한 뒤에는 그 돌파일 이후에 새로 생긴 스윙점만으로 다음 삼각형을 다시 찾도록
    # 제한한다(같은 저항선을 재사용한 연속 신호 방지).
    min_swing_start = -1

    for i in range(n):
        start = max(0, i - LOOKBACK_WINDOW + 1, min_swing_start + 1)
        confirmed_end = i - SWING  # look-ahead 방지: k+SWING <= i (오늘까지 데이터로 확정된 스윙만)

        triangle_ok = False
        resistance = None
        if confirmed_end >= start:
            low_idx = [k for k in range(start, confirmed_end + 1) if is_low_swing[k]]
            high_idx = [k for k in range(start, confirmed_end + 1) if is_high_swing[k]]
            if len(low_idx) >= MIN_LOW_SWINGS and len(high_idx) >= MIN_HIGH_SWINGS:
                low_vals = [lows[k] for k in low_idx]
                rising = all(low_vals[j] > low_vals[j - 1] for j in range(1, len(low_vals)))
                high_vals = [highs[k] for k in high_idx]
                # 저항선이 "오르지 않아야" 한다는 제약은 없앴다 - (1) 평평, (2) 저점보다
                # 느리게 올라감, (3) 완만히 하락(RESISTANCE_MAX_DECLINE_PCT 이내) 셋 다
                # 허용하고, decline_ok는 하락하는 경우에만 너무 무너지지 않게 막는 안전판이다
                # (오르는 경우엔 분자가 음수라 항상 통과).
                decline_ok = high_vals[0] > 0 and (high_vals[0] - high_vals[-1]) / high_vals[0] * 100 <= RESISTANCE_MAX_DECLINE_PCT
                # 저점-고점 간격이 갈수록 좁혀지는지("눈으로 봤을 때 흐름을 만들어 간다") -
                # 초반 첫 저점/고점 간격보다 최근 마지막 저점/고점 간격이 확실히 좁아야 한다.
                # 저항선이 저점보다 더 빨리 올라 간격이 벌어지는 발산형 채널은 이 조건에서
                # 자연스럽게 걸러진다(막힘 없는 평행/발산 채널은 삼각형이 아니다).
                converging = (high_vals[-1] - low_vals[-1]) < (high_vals[0] - low_vals[0])
                if rising and decline_ok and converging:
                    triangle_ok = True
                    resistance = high_vals[-1]  # 가장 최근 저항 터치를 기준선으로(하락형이면 평균보다 이게 더 정확)

        if triangle_ok:
            watching_since = i
            watching_resistance = resistance
        elif watching_since is not None and (i - watching_since) > BREAKOUT_MAX_LOOKAHEAD:
            watching_since = None
            watching_resistance = None

        if watching_since is not None and watching_resistance:
            resistance_arr[i] = watching_resistance
            if closes[i] > watching_resistance * (1 + BREAKOUT_TOL_PCT / 100.0):
                entry[i] = True
                min_swing_start = i
                watching_since = None
                watching_resistance = None

    df['resistance'] = resistance_arr
    df['entry_signal'] = entry

    return df[DAILY_PRICES_COLUMNS]


# 진입/청산 가정과 요약 통계는 accumulation_angle.py와 완전히 동일해서(다음날 시가 진입,
# hold_days일 뒤 종가 청산, 왕복 슬리피지 차감 / 승률·평균수익률·손익비 요약) 새로 만들지
# 않고 그대로 재사용한다 - 둘 다 df에 open/close/entry_signal 컬럼만 있으면 되는 동일 계약.
backtest_entry_signal = aa.backtest_entry_signal
summarize_backtest = aa.summarize_backtest
