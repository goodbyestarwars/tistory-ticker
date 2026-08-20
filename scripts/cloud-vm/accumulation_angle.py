# -*- coding: utf-8 -*-
"""세력매집각도 - 전형가(고가+저가+종가)/3 기준 EMA 단기5/장기20의 기울기(각도)로
매집 추세 전환 시점을 판정한다.

2026-08-20: 원래 pandas-ta의 slope(length, as_angle=True, to_degrees=True)를 쓰려고
했으나, 이 시점 PyPI의 pandas-ta는 정식(stable) 릴리즈가 없고 베타(0.4.67b0/0.4.71b0)만
있는데 둘 다 Python 3.12+ 전용이라 이 프로젝트가 실제로 쓰는 Python 3.11 환경에 설치가
안 된다(VM 파이썬 버전은 이 세션에서 직접 확인 못 함 - 3.12 미만이면 VM에서도 동일하게
막힘). 대신 pandas(EMA는 `.ewm` 내장) + numpy(arctan/degrees)만으로 pandas-ta의 slope
계산 방식(구간 length 동안의 1봉당 평균 변화량 -> arctan -> degrees 변환)을 직접
재현했다 - 외부 지표 라이브러리 의존 없이 벡터화 이점은 그대로 가져간다.

주의: 이 slope 재현은 pandas-ta 소스 구조를 참고해 작성했을 뿐 실제 pandas-ta 출력과
나란히 대조 검증하지는 못했다(환경 제약으로 pandas-ta 자체를 설치할 수 없었음) - 값이
pandas-ta 기준과 정확히 일치한다고 확정하지 않는다. 각도는 series 자체의 절대 가격
스케일에 좌우된다(고가주는 같은 등락률이어도 저가주보다 절대 변화량이 커서 각도가 더
가파르게 나옴) - 이것도 pandas-ta 원래 동작을 그대로 재현한 것이라 의도된 특성이다.

VM 배포 전 확인 필요: 이 모듈은 pandas/numpy가 설치돼 있어야 동작한다. 이 저장소엔
requirements.txt 등 의존성 관리 파일이 없고(기존 scripts/cloud-vm/*.py는 표준 라이브러리
+ 수동 설치한 websockets 정도만 씀), VM에도 별도로 `pip install pandas numpy`가 필요할
수 있다."""

import math

import numpy as np
import pandas as pd

import db_schema

EMA_SHORT_LEN = 5
EMA_LONG_LEN = 20

DAILY_PRICES_COLUMNS = [
    'date', 'open', 'high', 'low', 'close', 'volume', 'typical_price',
    'ema_short', 'ema_long', 'short_angle', 'mid_angle', 'long_angle', 'entry_signal',
]


def _slope_angle(series, length):
    """pandas-ta의 slope(length, as_angle=True, to_degrees=True)와 동일하게 의도한 계산:
    `length`구간 동안의 1봉당 평균 변화량 -> arctan(라디안) -> degrees(도) 순서로 변환한다."""
    delta = (series - series.shift(length)) / length
    radians = delta.apply(lambda v: math.atan(v) if pd.notna(v) else np.nan)
    return np.degrees(radians)


def compute_accumulation_angle(code, conn=None):
    """종목코드 하나로 세력매집각도 DataFrame을 만든다.

    - typical_price = (high + low + close) / 3
    - ema_short = typical_price의 EMA(5), ema_long = typical_price의 EMA(20)
    - short_angle = ema_short 기준 5구간 기울기(각도)
    - mid_angle   = ema_long  기준 5구간 기울기(각도)
    - long_angle  = ema_long  기준 20구간 기울기(각도)
    - entry_signal = short_angle > 0
                     AND mid_angle이 직전 봉 대비 음수(0 이하) -> 양수로 막 전환
                     AND long_angle이 직전 봉 대비 음수(0 이하) -> 양수로 막 전환
      ("전환"을 이렇게 이해했다 - 기준이 다르면 이 세 줄만 바꾸면 됨)

    conn을 안 주면 이 함수 안에서 db_schema.get_conn()으로 얻어서 쓰고 닫는다(단발성
    조회용). 여러 종목을 반복 조회할 때는 밖에서 연결을 하나 만들어 넘기는 게 낫다."""
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

    df['short_angle'] = _slope_angle(df['ema_short'], EMA_SHORT_LEN)
    df['mid_angle'] = _slope_angle(df['ema_long'], EMA_SHORT_LEN)
    df['long_angle'] = _slope_angle(df['ema_long'], EMA_LONG_LEN)

    mid_turned_positive = (df['mid_angle'] > 0) & (df['mid_angle'].shift(1) <= 0)
    long_turned_positive = (df['long_angle'] > 0) & (df['long_angle'].shift(1) <= 0)
    df['entry_signal'] = (df['short_angle'] > 0) & mid_turned_positive & long_turned_positive

    return df[DAILY_PRICES_COLUMNS]
