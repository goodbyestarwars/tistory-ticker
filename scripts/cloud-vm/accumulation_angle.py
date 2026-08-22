# -*- coding: utf-8 -*-
"""세력매집각도(정규화판) - 전형가(고가+저가+종가)/3 기준 EMA 단기5/장기20의 기울기(각도)를
주가 절대 스케일과 무관한 %(정규화) 변동률로 계산하고, 각도가 "가속(상승 전환)"되는 구간과
"분출"(단기 각도가 최근 변동성 대비 튀는 순간)을 함께 판정한다.

2026-08-20 히스토리:
1) 처음엔 pandas-ta의 slope(length, as_angle=True, to_degrees=True)를 그대로 쓰려 했으나,
   이 시점 PyPI의 pandas-ta는 정식(stable) 릴리즈가 없고 베타(0.4.67b0/0.4.71b0)만 있는데
   둘 다 Python 3.12+ 전용이라 이 프로젝트가 쓰는 Python 3.11 환경(VM도 3.12 미만이면 동일하게
   막힘 - 이 세션에서 VM 파이썬 버전은 직접 확인 못 함)엔 설치가 안 된다. 그래서 pandas(EMA는
   `.ewm` 내장) + numpy(arctan/degrees)만으로 slope 계산 방식을 직접 재현했다(1차 버전 - 원값
   각도, 커밋 이력 참고).
2) 이후 "가격 단위(동전주 vs 고가주)에 따라 같은 상승률이어도 각도가 다르게 나온다"는 문제를
   해결하기 위해, slope에 넣는 시리즈 자체를 절대 EMA값이 아니라 "N봉 전 대비 % 변동률"로
   바꾸는 정규화(사용자 검토·승인 스펙)로 교체했다 - 이 파일 1차 버전의 compute_accumulation_angle
   출력 컬럼/조건식을 이 버전이 대체한다(기존 호출부가 있다면 함께 갱신 필요).

주의: 이 slope/정규화 재현은 논의된 스펙을 그대로 코드로 옮긴 것이고, pandas-ta 자체를 이
환경에 설치할 수 없어 pandas-ta 실제 출력과 나란히 대조 검증은 못했다 - 값이 pandas-ta 기준과
정확히 일치한다고 확정하지 않는다.

VM 배포 전 확인 필요: 이 모듈은 pandas/numpy가 설치돼 있어야 동작한다. 이 저장소엔
requirements.txt 등 의존성 관리 파일이 없고(기존 scripts/cloud-vm/*.py는 표준 라이브러리
+ 수동 설치한 websockets 정도만 씀), VM에도 별도로 `pip install pandas numpy`가 필요할 수 있다."""

import math

import numpy as np
import pandas as pd

import db_schema

EMA_SHORT_LEN = 5
EMA_LONG_LEN = 20

# 분출 필터: 단기 각도의 하루 변화량이 최근 20일 변화량 표준편차의 이 배수를 넘으면
# "각도가 튀었다"고 본다(사용자 검토 스펙의 "분출1.5 필터").
ERUPT_STD_MULTIPLIER = 1.5
ERUPT_STD_WINDOW = 20

# 2026-08-22 신설(작업지시서 1단계): 거래량도 동시에 "분출" 상태여야 진입 신호로 인정 -
# 가격 각도만 튀고 거래량이 안 붙는 가짜 파동을 걸러내기 위함. 가격과 같은 방식(당일
# 변화량이 최근 20일 변화량 표준편차의 배수 초과)을 거래량(원시 변화량)에 그대로 적용한다.
# 배수는 "가격과 동일하게 1.5배 적용해서 시작"이라는 지시대로 ERUPT_STD_MULTIPLIER를
# 그대로 재사용하되, 나중에 거래량만 따로 조정할 수 있게 별도 상수로 뒀다(현재는 별칭).
VOLUME_ERUPT_STD_MULTIPLIER = ERUPT_STD_MULTIPLIER

# 2026-08-22 신설(작업지시서 3단계): 과열 구간(20일 엔벨로프 상단 이탈) 필터 - 이
# 파일에는 없던 개념이라(gongpasan_strategy.py의 46일 엔벨로프와는 기간·용도가 다름)
# 신규 상수로 분리했다. 임시값, 추후 백테스트로 조정 필요.
ENVELOPE_MA_PERIOD = 20
ENVELOPE_UPPER_PCT = 0.10

# 백테스트 기본 보유일수/슬리피지(매수·매도 각각 차감) - 사용자 검토 스펙 기본값을 그대로 썼다.
# 주의: 이 두 상수(와 backtest_entry_signal/summarize_backtest 함수)는 ascending_triangle.py/
# box_range.py/double_bottom.py/inv_head_shoulders_v2.py/opening_gap.py/pullback_patterns.py/
# angle_momentum_indicator_scan.py/angle_momentum_pullback_variant_scan.py가 그대로 재사용
# 중이라 여기서 바꾸면 그 모듈들 백테스트도 전부 같이 바뀐다 - 그래서 4단계(각도기 테스트
# 탭 전용 청산 로직)는 이 값을 안 건드리고 ANGLE_BACKTEST_* 상수 + 새 함수로 분리했다.
DEFAULT_HOLD_DAYS = 5
DEFAULT_SLIPPAGE_PCT = 0.0015

# 2026-08-22 신설(작업지시서 4단계, "각도기 테스트" 탭 전용 백테스트 - 위 DEFAULT_*와
# 완전히 분리): 슬리피지를 지시대로 1~2% 범위(중간값 1.5%)로 올렸다.
ANGLE_BACKTEST_SLIPPAGE_PCT = 0.015
# 익절(각도 꺾임)도 손절(저가 이탈)도 안 뜨면 이 기간 안에서 강제 청산(무한 보유 방지 -
# 지시서에 명시 없어 임의로 뒀다).
ANGLE_BACKTEST_MAX_HOLD_DAYS = 40

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume', 'typical_price',
    'ema_short', 'ema_long',
    'angle_short', 'angle_mid', 'angle_long',
    'angle_mid_turn', 'angle_long_turn', 'erupt_filter',
    'volume_erupt_filter', 'ema_aligned', 'envelope_upper', 'overheated',
    'entry_signal',
]


def _slope_angle(series, length):
    """pandas-ta의 slope(length, as_angle=True, to_degrees=True)와 동일하게 의도한 계산:
    `length`구간 동안의 1봉당 평균 변화량 -> arctan(라디안) -> degrees(도) 순서로 변환한다.
    입력 series가 원값(가격)이 아니라 %(정규화) 변동률이어도 그대로 적용 가능한 범용 함수다."""
    delta = (series - series.shift(length)) / length
    radians = delta.apply(lambda v: math.atan(v) if pd.notna(v) else np.nan)
    return np.degrees(radians)


def compute_accumulation_angle(code, conn=None, rows=None):
    """종목코드 하나로 정규화 세력매집각도 DataFrame을 만든다.

    - typical_price = (high + low + close) / 3
    - ema_short = typical_price의 EMA(5), ema_long = typical_price의 EMA(20)
    - Y축 정규화: ema_short/ema_long을 절대값이 아니라 N봉 전 대비 %(변동률)로 바꾼 뒤
      그 %(변동률) 시리즈에 slope를 적용한다 - 동전주와 고가주가 같은 상승률이어도 절대
      가격차 때문에 각도가 달라지는 문제를 없앤다.
      - angle_short = pct(ema_short, 5봉전 대비)의 5구간 기울기(각도)
      - angle_mid   = pct(ema_long,  5봉전 대비)의 5구간 기울기(각도)
      - angle_long  = pct(ema_long, 20봉전 대비)의 20구간 기울기(각도)
    - angle_mid_turn/angle_long_turn = 해당 각도가 "지금 상승 중인지"(직전 봉 대비 증가 방향,
      np.sign(각도.diff())) - 각도가 0을 넘었는지가 아니라 각도 자체의 가속 방향을 본다.
    - erupt_filter = 단기 각도의 하루 변화량이 최근 20일 변화량 표준편차의 1.5배를 초과 =
      "각도가 튀는" 순간
    - volume_erupt_filter = 거래량 하루 변화량이 최근 20일 변화량 표준편차의
      VOLUME_ERUPT_STD_MULTIPLIER(1.5, erupt_filter와 동일 배수로 시작)배를 초과(2026-08-22
      신설) - 수급 동반 없는 가격 각도 가속(가짜 파동)을 걸러내기 위함.
    - ema_aligned = ema_short > ema_long(2026-08-22 신설) - 정배열 초입 상태만 인정,
      역배열(단기 반등 후 재하락 위험)을 배제.
    - overheated = 시가 또는 종가가 20일 엔벨로프 상단(typical_price 20일 평균의
      ENVELOPE_UPPER_PCT=10% 위)을 벗어남(2026-08-22 신설) - 분출 조건 발동 시 흔한
      추격매수/고점 상투 방지, entry_signal은 이 조건이 False일 때만(~overheated) 성립.
    - entry_signal = angle_short>0 AND angle_mid_turn>0 AND angle_long_turn>0 AND
      erupt_filter AND volume_erupt_filter AND ema_aligned AND NOT overheated

    2026-08-22 0단계 확인(작업지시서 선행 조사): angle_short/angle_mid/angle_long을 서로
    직접 비교(예: angle_short > angle_long)하는 로직은 없다 - angle_mid_turn/angle_long_turn은
    각 각도가 "자기 자신의 직전 봉 대비" 가속 방향만 보므로, 단기(5)/장기(20) 기간(N값)
    차이로 인한 교차비교 착시 문제는 이 코드에는 해당하지 않는다(그래서 아래 1~3단계만
    반영했다).

    conn을 안 주면 이 함수 안에서 db_schema.get_conn()으로 얻어서 쓰고 닫는다(단발성
    조회용). 여러 종목을 반복 조회할 때는 밖에서 연결을 하나 만들어 넘기는 게 낫다.
    rows를 미리 넘기면(예: 호출부가 제외 필터링 등으로 이미 db_schema.load_daily_prices를
    한 번 불러둔 경우) DB 재조회 없이 그 값을 그대로 쓴다 - conn/get_conn 로직은 안 건드린다."""
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

    df['typical_price'] = (df['high'] + df['low'] + df['close']) / 3
    # adjust=False: pandas-ta의 ema()가 기본으로 쓰는 방식(재귀적 지수가중, 최근 값
    # 영향이 안정적으로 수렴 - adjust=True는 초반 구간에서 가중치가 달라짐)을 맞췄다.
    df['ema_short'] = df['typical_price'].ewm(span=EMA_SHORT_LEN, adjust=False).mean()
    df['ema_long'] = df['typical_price'].ewm(span=EMA_LONG_LEN, adjust=False).mean()

    pct_ema_short_5 = (df['ema_short'] - df['ema_short'].shift(5)) / df['ema_short'].shift(5) * 100
    pct_ema_long_5 = (df['ema_long'] - df['ema_long'].shift(5)) / df['ema_long'].shift(5) * 100
    pct_ema_long_20 = (df['ema_long'] - df['ema_long'].shift(20)) / df['ema_long'].shift(20) * 100

    df['angle_short'] = _slope_angle(pct_ema_short_5, EMA_SHORT_LEN)
    df['angle_mid'] = _slope_angle(pct_ema_long_5, EMA_SHORT_LEN)
    df['angle_long'] = _slope_angle(pct_ema_long_20, EMA_LONG_LEN)

    df['angle_mid_turn'] = np.sign(df['angle_mid'].diff()).fillna(0)
    df['angle_long_turn'] = np.sign(df['angle_long'].diff()).fillna(0)

    angle_short_diff = df['angle_short'].diff()
    short_std = angle_short_diff.rolling(ERUPT_STD_WINDOW).std()
    df['erupt_filter'] = angle_short_diff > (ERUPT_STD_MULTIPLIER * short_std)

    # 2026-08-22 신설(1단계): 거래량도 동시에 분출 상태여야 함 - 가격 각도의 erupt_filter와
    # 같은 방식을 거래량 원시 변화량에 적용한다(각도로 정규화하지 않음 - 거래량은 가격과
    # 달리 절대적인 "튀는 정도"를 그대로 보는 게 더 직관적이라고 판단).
    volume_diff = df['volume'].diff()
    volume_std = volume_diff.rolling(ERUPT_STD_WINDOW).std()
    df['volume_erupt_filter'] = volume_diff > (VOLUME_ERUPT_STD_MULTIPLIER * volume_std)

    # 2026-08-22 신설(2단계): 정배열 초입 상태(EMA5 > EMA20) - 역배열 상태에서의 가속
    # 신호(단기 반등 후 재하락 위험)를 배제한다.
    df['ema_aligned'] = df['ema_short'] > df['ema_long']

    # 2026-08-22 신설(3단계): 과열 구간 필터 - 시가 또는 종가가 20일 엔벨로프 상단을
    # 벗어나면 제외(1.5σ 분출 조건 발동 시 흔한 추격매수/고점 상투 방지).
    envelope_ma = df['typical_price'].rolling(ENVELOPE_MA_PERIOD).mean()
    df['envelope_upper'] = envelope_ma * (1 + ENVELOPE_UPPER_PCT)
    df['overheated'] = (df['open'] > df['envelope_upper']) | (df['close'] > df['envelope_upper'])

    df['entry_signal'] = (
        (df['angle_short'] > 0)
        & (df['angle_mid_turn'] > 0)
        & (df['angle_long_turn'] > 0)
        & df['erupt_filter']
        & df['volume_erupt_filter']
        & df['ema_aligned']
        & ~df['overheated']
    )

    return df[DAILY_PRICES_COLUMNS]


def backtest_entry_signal(df, hold_days=DEFAULT_HOLD_DAYS, slippage_pct=DEFAULT_SLIPPAGE_PCT):
    """compute_accumulation_angle()이 만든 DataFrame 하나(종목 1개분)를 받아, entry_signal이
    뜬 날마다 "다음날 시가에 진입, hold_days일 뒤 종가에 청산"했다고 가정한 거래별 순수익률
    (net_return, 비율값 - 0.05=5%) 리스트를 반환한다. 신호가 하나도 없으면 빈 리스트.

    미래참조 편향 방지: entry_price는 open.shift(-1)(신호 당일 종가가 아니라 다음날 시가),
    exit_price는 close.shift(-(hold_days+1))(신호 당일 기준 hold_days+1봉 뒤 = 진입일 기준
    hold_days봉 뒤 종가) - 둘 다 미래 값을 shift로 "앞당겨 붙이는" 것뿐, 신호 판정 시점에는
    없는 값이라 미래를 미리 아는 것과는 다르다(신호 발생 자체는 그 날 종가까지의 데이터로만
    판정됨 - compute_accumulation_angle 참고).
    slippage_pct는 매수·매도 각각 차감(왕복 2회)한다."""
    if df is None or df.empty or 'entry_signal' not in df.columns:
        return []
    d = df[['open', 'close', 'entry_signal']].copy()
    d['entry_price'] = d['open'].shift(-1)
    d['exit_price'] = d['close'].shift(-(hold_days + 1))
    trades = d[d['entry_signal']].dropna(subset=['entry_price', 'exit_price'])
    if trades.empty:
        return []
    gross_return = (trades['exit_price'] - trades['entry_price']) / trades['entry_price']
    net_return = gross_return - (slippage_pct * 2)
    return net_return.tolist()


def summarize_backtest(net_returns):
    """backtest_entry_signal()이 여러 종목에 걸쳐 모은 net_return 리스트(비율값)를 승률/평균
    수익률/손익비 등으로 요약한다. 거래가 하나도 없으면 None."""
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


def backtest_angle_entry_with_dynamic_exit(df, slippage_pct=ANGLE_BACKTEST_SLIPPAGE_PCT,
                                            max_hold_days=ANGLE_BACKTEST_MAX_HOLD_DAYS):
    """2026-08-22 신설(작업지시서 4단계) - "각도기 테스트" 탭 백테스트 요약 전용 청산
    로직. 위 backtest_entry_signal()(고정 hold_days 청산)은 ascending_triangle.py/
    box_range.py/double_bottom.py/inv_head_shoulders_v2.py/opening_gap.py/
    pullback_patterns.py/angle_momentum_indicator_scan.py/
    angle_momentum_pullback_variant_scan.py가 그대로 재사용 중이라 손대지 않았다 -
    이 함수는 완전히 별개이고, 운영 스캔 6개 탭이나 다른 패턴의 백테스트에는 전혀
    영향을 주지 않는다.

    진입: entry_signal이 뜬 날 다음날 시가(다른 백테스트 함수와 동일 규칙).
    청산(둘 중 먼저 오는 조건, 진입일 다음날부터 순차 확인):
    - 손절: 그날 저가가 "진입 기준 봉"(entry_signal이 뜬 신호 당일)의 저가 이하로
      이탈하면 그날 종가에 청산.
    - 익절: angle_short가 직전 봉 대비 꺾이는 첫 시점(음의 가속 전환)에 그날 종가에 청산.
    - 타임컷: 위 둘 다 max_hold_days(40) 안에 안 뜨면 그 마지막 날 종가로 강제 청산
      (지시서에 시간 제한 언급이 없어 무한 보유를 막기 위해 임의로 추가).
    slippage_pct는 매수·매도 각각 차감(왕복 2회, 지시대로 1.5%로 상향)."""
    if df is None or df.empty or 'entry_signal' not in df.columns:
        return []

    opens = df['open'].to_numpy(dtype=float)
    closes = df['close'].to_numpy(dtype=float)
    lows = df['low'].to_numpy(dtype=float)
    angle_short = df['angle_short'].to_numpy(dtype=float)
    entry_signal = df['entry_signal'].to_numpy(dtype=bool)
    n = len(df)

    net_returns = []
    for i in range(n):
        if not entry_signal[i]:
            continue
        entry_idx = i + 1
        if entry_idx >= n:
            continue
        entry_price = opens[entry_idx]
        if not np.isfinite(entry_price):
            continue
        stop_low = lows[i]  # 진입 기준 봉(신호 당일)의 저가

        exit_price = None
        last_checkable = min(n - 1, entry_idx + max_hold_days - 1)
        for j in range(entry_idx, last_checkable + 1):
            if np.isfinite(lows[j]) and lows[j] <= stop_low:
                exit_price = closes[j]
                break
            if j > entry_idx and np.isfinite(angle_short[j]) and np.isfinite(angle_short[j - 1]) \
                    and angle_short[j] < angle_short[j - 1]:
                exit_price = closes[j]
                break
        if exit_price is None:
            exit_price = closes[last_checkable]

        if not np.isfinite(exit_price):
            continue
        gross_return = (exit_price - entry_price) / entry_price
        net_returns.append(gross_return - (slippage_pct * 2))

    return net_returns
