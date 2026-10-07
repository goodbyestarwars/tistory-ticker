# -*- coding: utf-8 -*-
"""VM 차트 패턴 판정(지시서 6종)과 공용 헬퍼.
일반 패턴은 GAS 상세 차트와 같은 기준을 사용하지만, 박스권 하단은 VM 일괄 스캔에서
시가총액까지 조회하는 A~G 전용 조건을 적용한다."""

import math
import re

import numpy as np
import pandas as pd

PATTERN_SWING = 2
# A pattern bucket may contain at most this many candidates after its
# chart-quality gates are applied. We do not slice by universe order.
PATTERN_MAX_MATCHES = 20
RISING_LOWS_DISPLAY_LIMIT = 20
PENNY_STOCK_MAX_PRICE = 1000  # 국내 주식 기준: 1,000원 미만은 동전주로 제외

ETF_NAME_PREFIXES = (
    '1Q ', 'ACE ', 'ARIRANG ', 'HANARO ', 'KBSTAR ', 'KODEX ', 'KOSEF ',
    'PLUS ', 'RISE ', 'SOL ', 'TIGER ', 'TIME ', 'TREX ', 'WON ', 'FOCUS ',
    'UNICORN ', 'TRUSTON ', '마이티 ', '파워 ', '에셋플러스 ',
)
ETF_NAME_TOKENS = re.compile(r'(?:ETF|레버리지|인버스|커버드콜|채권혼합|합성|선물)', re.IGNORECASE)
NON_COMMON_STOCK_NAME_TOKENS = re.compile(r'(?:ETN|스팩|SPAC|우선주|거래정지|정리매매|관리종목)', re.IGNORECASE)
PREFERRED_STOCK_SUFFIX = re.compile(r'(?:\d+)?우(?:[A-Z])?(?:\(전환\))?$')

OPENING_GAP_MIN_INTRADAY_PCT = 3.0
OPENING_GAP_MIN_OPEN = 1_000
OPENING_GAP_MAX_OPEN = 500_000
OPENING_GAP_MIN_TURNOVER_MILLION = 3_000
OPENING_GAP_MAX_TURNOVER_MILLION = 999_999

# 2026-10-04 저점상승형 정교화(사용자 지적: 로보티즈는 하락 추세 속 3봉짜리 반등일 뿐이고, 다른 종목은 이미 오른 뒤였다.
# "하방이 막혀 있고 저점이 계단식으로 오르는 바닥 다지기"만 남긴다). 예전엔 최근 20거래일 안의 스윙 저점 2개만 비교해서
# 하락 파동 속 흔한 반등도 전부 걸렸다.
RISING_LOWS_WINDOW = 60              # 구조(저점 계단)를 보는 창
RISING_LOWS_DECLINE_LOOKBACK = 60    # 계단 시작 전, "하락이 있었는가"를 보는 구간
RISING_LOWS_MIN_LOWS = 3             # 계단식으로 오른 스윙 저점 최소 개수
RISING_LOWS_MIN_SPAN_BARS = 15       # 첫 저점~마지막 저점 최소 간격(너무 짧은 반등 제외)
RISING_LOWS_MIN_STEP = 0.01          # 저점끼리 최소 1% 이상 올라야 계단으로 인정
RISING_LOWS_MIN_TOTAL_RISE = 0.04    # 첫 저점 -> 마지막 저점 최소 상승폭
RISING_LOWS_MAX_TOTAL_RISE = 0.20    # 이보다 많이 올랐으면 이미 상승이 진행된 것
RISING_LOWS_MIN_PRIOR_DECLINE = 0.12 # 계단 시작 전 고점이 첫 저점보다 이만큼은 높아야 "하락 뒤 바닥"
RISING_LOWS_MAX_FROM_LAST_LOW = 0.10 # 현재가가 마지막 스윙 저점보다 10% 넘게 올라 있으면 이미 오른 뒤
RISING_LOWS_MAX_RET_20D = 0.15       # 최근 20거래일 수익률 상한(급등 직후 제외)
RISING_LOWS_MAX_DAY_GAIN_10D = 0.10  # 최근 10거래일 중 하루 상승 상한(급등봉 제외)
# 2026-10-04 거래대금(유동성) 필터. 수렴 중 거래량 감소는 정상이라 "거래량이 많아야 한다"는 걸지 않고,
# 매매가 어려울 정도로 거래가 죽은 종목만 뺀다. 값은 상수라 20억/30억/50억원으로 쉽게 조정한다.
MIN_AVG_TRADING_VALUE_20D = 3_000_000_000      # 20일 평균 거래대금(종가x거래량) 하한 - 하드 필터
MIN_MEDIAN_TRADING_VALUE_20D = 1_500_000_000   # 20일 거래대금 중앙값 기준 - 미달 시 감점(하루 대량거래로 평균만 높은 종목)
MIN_RECENT_LIQUIDITY_RATIO = 0.60              # 최근 5일 평균 거래대금 / 20일 평균 하한 - 하드 필터(최근 거래가 죽은 종목)
MAX_ZERO_VOLUME_DAYS_20D = 1                   # 최근 20일 중 거래량 0인 날 허용 개수
# 2026-08-23 신설: "단기이평 돌파형" - 하락 추세선(최근 스윙 고점 2개를 잇는 저항선)을
# 종가와 5일선이 함께 뚫고 올라오는 순간을 잡는다(사용자 요청, 참고 그림: "추세선+5일이평선").
# 창(window)은 20일 - swing_model.classify_wave_structure()의 소파동(20일) 스케일과
# 맞추기로 사용자 확인(소파동이 5일선을 뚫는 그림과 개념이 일치). 60일(중파동)은 신호가
# 늦고 뜸해져서 채택 안 함.
# 2026-10-04 단기이평 돌파형 재설계: 5일선은 후행 지표라 "종가와 5일선이 같은 날 함께 추세선 돌파"는 거의 안 걸렸다.
# 이제 종가가 하락 추세선을 처음 돌파 + 종가가 상승 중인 5일선 위. 값은 상수라 결과 수를 보고 쉽게 조절한다.
SHORT_MA_BREAKOUT_WINDOW = 30         # LOOKBACK(스윙 고점을 찾는 최근 봉 수)
SHORT_MA_MIN_HIGH_DECLINE = 0.02      # H2 <= H1 x (1 - 이 값). 너무 적게 걸리면 0.015
SHORT_MA_MIN_SWING_HIGH_GAP = 4       # H1~H2 최소 간격(봉). 3~5 조절
SHORT_MA_TRENDLINE_TOL_PCT = 0.01     # 추세선 허용오차(추세선 대비 비율)
SHORT_MA_TRENDLINE_ATR_MULT = 0.3     # 허용오차 = max(추세선 x 위 비율, ATR14 x 이 값)
SHORT_MA_MAX_BREAKOUT_PCT = 0.05      # 오늘 종가가 추세선 위로 이 이상이면 이미 늦음
SHORT_MA_MIN_TRADING_VALUE_20D = 1_000_000_000   # 20일 평균 거래대금 하한(거래가 거의 없는 종목 제외)
SHORT_MA_VOLUME_BONUS_1 = 1.2
SHORT_MA_VOLUME_BONUS_2 = 1.5
ATR_PERIOD = 14
# 2026-10-04 장기이평 응축기 재설계: 224일선 + 일목 구름 + 가격이 한곳에 응축된 종목을 "돌파 준비"와 "신규 돌파" 두 상태로 잡는다.
# 예전엔 "종가가 구름 상단을 아직 넘지 않았다"가 필수라 구름 상단을 막 돌파한 종목이 오히려 제외됐다.
MA_CLOUD_MIN_DAYS = 250
MA_CLOUD_NEAR_TOL = 0.03                # 돌파 준비: 종가가 224일선 +-3% 이내(MAX_READY_MA_DISTANCE)
MA_CLOUD_TOP_TOL = 0.03                 # 구름 상단 접근: 고가가 구름 상단 3% 이내(CLOUD_TOP_APPROACH)
MA_CLOUD_BREAKOUT_MA_MIN = -0.01        # 신규 돌파: 종가/224일선-1 하한(-1%)
MA_CLOUD_BREAKOUT_MA_MAX = 0.05         # 신규 돌파: 종가/224일선-1 상한(+5%, MAX_BREAKOUT_MA_DISTANCE)
MA_CLOUD_MAX_MA_CLOUD_DISTANCE = 0.05   # 224일선과 구름 중심 거리 상한(응축 조건, MAX_MA_CLOUD_DISTANCE)
MA_CLOUD_BOTTOM_SUPPORT = 0.02          # 종가가 구름 하단 -2%보다 아래면 제외
MA_CLOUD_READY_OVER_TOP = 0.01          # 돌파 준비: 종가가 구름 상단 +1% 이내까지는 아직 준비로 인정
MA_CLOUD_MAX_BREAKOUT = 0.05            # 구름 상단 돌파폭 상한(MAX_CLOUD_BREAKOUT)
MA_CLOUD_MAX_MA224_EXTENSION = 0.07     # 종가가 224일선보다 이 이상 위면 이미 늦음
MA_CLOUD_BREAKOUT_MAX_AGE = 3           # 최초 돌파가 최근 3거래일(오늘 포함) 이내여야 신규 돌파
MA_CLOUD_MAX_MA224_DECLINE_20D = 0.03   # 20일 동안 224일선이 이 이상 내려가면 제외
MA_CLOUD_THIN_CLOUD = 0.05              # 구름 두께(/중심) 5% 이하면 응축도 가산
MA_CLOUD_VOLUME_BONUS_1 = 1.2
MA_CLOUD_VOLUME_BONUS_2 = 1.5
MA_CLOUD_MIN_TRADING_VALUE_20D = 1_000_000_000   # 20일 평균 거래대금 하한(거래가 거의 없는 종목 제외)
MA_CLOUD_BELOW_BOTTOM_DAYS = 5          # 최근 10봉 중 구름 하단 아래 종가가 이 횟수 이상이면 제외
DOUBLE_BOTTOM_WINDOW = 120
IHS_WINDOW = 90
BOX_WINDOW = 21  # 20 bars for the range plus the 20-bars-ago reference bar

WEDGE_MIN_SWINGS = 2
# 2026-08-22: "저점이 조금이라도 높으면 통과"라 기업은행처럼 박스권 안에서 저점이 미세하게
# (1%도 안 되게) 올라간 것도 걸리는 문제가 리포트됨(미원에쓰씨 같은 뚜렷한 V자 반등만
# 잡히길 원함) - 최근 두 스윙 저점 간 최소 상승폭 하한을 추가. gas/ticker-proxy.gs의
# 동일 상수와 반드시 같이 유지할 것.
WEDGE_MIN_LOW_RISE = 0.05
RECENCY_MAX_GAP = 3
# 2026-08-22(3차): ascending_triangle.py(고점 막힘/수렴까지 보는 별도 분석 전용 모듈)의
# "저점-고점 간격이 갈수록 좁혀져야 한다" 필수 조건을 라이브 저점상승형 탭에도 그대로
# 연결한다(사용자 확인: 가온칩스처럼 고점이 아직 안 좁혀진 초기 반등 케이스는 이제 제외돼도
# 됨 - 예전 설계를 의도적으로 뒤집는 것). RESISTANCE_MAX_DECLINE_PCT는 ascending_triangle.py와
# 동일값 재사용(그쪽에서 이미 임의로 정했다고 문서화된 값). gas/ticker-proxy.gs의
# 동일 상수와 반드시 같이 유지할 것.
RESISTANCE_MAX_DECLINE_PCT = 0.15

DB_LOW_TOL = 0.03
DB_MIN_GAP_DAYS = 10
DB_MAX_GAP_DAYS = 45
DB_PEAK_MIN_RISE = 0.08
DB_NECK_PROXIMITY_MIN = -0.02
DB_SECOND_VOLUME_MAX_RATIO = 1.00

IHS_SHOULDER_TOL = 0.04
IHS_HEAD_MIN_DROP = 0.02
IHS_NECK_PROXIMITY_MIN = -0.01
IHS_NECK_MIN_RISE = 0.03
IHS_MIN_SHOULDER_GAP = 4
IHS_MAX_SHOULDER_GAP = 40
DB_RECENCY_MAX_GAP = 5            # SECOND_BOTTOM_MAX_AGE: 두 번째 저점은 최근 5봉 안
# 2026-10-04 쌍바닥 개선(RECOVERY / NECKLINE_READY 두 상태, L2 이후 바닥 훼손 제외, 3봉 평균 거래량 비교)
DB_MAX_MIDDLE_BREAK = 0.02        # 두 저점 사이 더 낮은 저가 허용(2%)
DB_NECK_READY_DISTANCE = 0.02     # 넥라인 접근: 종가 >= 넥라인 x (1 - 이 값)
DB_MAX_NECK_EXTENSION = 0.05      # 넥라인을 이 이상 넘었으면 "준비"가 아니라 이미 돌파 - 제외
DB_L2_VOLUME_TOLERANCE = 1.10     # L2 주변 3봉 평균 거래량 <= L1 주변 3봉 평균 x 이 값
DB_BREAK_AFTER_L2 = 0.02          # L2 이후 저가가 min(L1,L2)보다 이 이상 내려가면 쌍바닥 실패
# 2026-10-04 수익률 백테스트(D+1 시가 진입, 전반/후반 기간 모두 개선): 회복(RECOVERY) 상태에서 넥라인이 11% 넘게 멀면 성과가 나빴다
DB_MAX_NECK_GAP = 0.11
IHS_RECENCY_MAX_GAP = 10          # RS_MAX_AGE: 오른쪽 어깨는 최근 10봉 안(2026-10-04, 예전 5봉)
# 2026-10-04 역헤드앤숄더 개선: 기울어진 넥라인(N1-N2), READY/BREAKOUT_NEW 두 상태, 거래량은 넥라인 접근·돌파 때 가산(필수 아님)
IHS_NECK_READY_TOLERANCE = 0.01   # 넥라인 접근: 종가가 넥라인 +-1%
IHS_MAX_BREAKOUT_EXTENSION = 0.05 # 신규 돌파: 넥라인 위 5% 이내
IHS_BREAKOUT_MAX_AGE = 3          # 최초 돌파가 최근 3거래일(오늘 포함) 이내
IHS_HEAD_BREAK_TOLERANCE = 0.01   # RS 이후 저가가 머리보다 1% 넘게 내려가면 실패
IHS_VOLUME_BONUS_1 = 1.20
IHS_VOLUME_BONUS_2 = 1.50
IHS_MAX_DURATION_RATIO = 2.0      # 좌/우 형성 기간 비율이 이 이하면 시간 대칭 정상

BOX_CLOSE_RANGE_MAX = 0.10
BOX_MA_NEAR_TOL = 0.03
BOX_MA_NEAR_COUNT = 3
BOX_RSI_PERIOD = 14
BOX_RSI_MIN = 35.0
BOX_RSI_MAX = 65.0
BOX_VOLUME_AVG_PERIOD = 5
BOX_VOLUME_REFERENCE_OFFSET = 20
BOX_VOLUME_RATIO_MIN = 0.50       # 2026-10-04: 최근 5봉 평균 거래량 / 최근 20봉 평균 거래량 하한(죽은 거래량 제외)
BOX_VOLUME_RATIO_MAX = 1.20       #   상한(박스 하단에서 거래량이 폭증한 구간 제외)
BOX_MAX_MA20_DECLINE_10D = 0.03   # 20일선이 10거래일 동안 이만큼 이상 내려가면 계단식 하락으로 보고 제외
BOX_SUPPORT_TEST_TOL = 0.02       # 하단 반등: 최근 3봉 저가가 박스 하단(최저 종가) +2% 이내를 테스트
BOX_PANIC_VOLUME_MULT = 2.0       # 음봉 + 20일 평균 2배 이상 거래량 = 하단 투매봉으로 제외
BOX_MARKET_CAP_MIN_EOK = 3000.0
BOX_OPEN_MA_ABOVE_COUNT = 3
BOX_RETURN_MAX = 0.10
# 2026-08-22 확인: BOX_LOWER_ZONE_RATIO는 절대가격 기준(box_low*(1+비율))이 아니라 박스
# 높이 비율 기준(lower_position=(종가-support)/box_height)이다 - 조건 A(20봉 종가
# 변동폭 10% 이내)와 단위가 다르므로 35%가 A의 10%보다 커도 논리적 모순이 아니다
# (작업지시서 "Zone 계산식 확인" 1단계 결론: 형태 B, 정상 설계).
BOX_LOWER_ZONE_RATIO = 0.35

# 2026-08-22 신설(작업지시서 2단계): 박스권 하단 Zone 진입 트리거 튜닝 상수 - 스킬/지시서에
# 정확한 숫자가 없어 임의 초기값으로 정했다. 추후 백테스트로 조정 필요.
BOX_ENTRY_VOLUME_MULT = 1.3       # 당일 거래량이 직전 5봉 평균 대비 이 배수 이상
BOX_ENTRY_HAMMER_WICK_MULT = 2.0  # 망치형 판정: 아래꼬리가 몸통의 이 배수 이상
BOX_ENTRY_MA5_NEAR_TOL = 0.01     # 5일선 근접 허용폭 1%

# 모든 차트검색/눌림목 검색에 적용하는 공통 조건. 패턴별 점수와 섞지 않고
# 후보 자체를 만들기 전에 거르는 하드필터다.
COMMON_MARKET_CAP_MIN_EOK = 3000.0

BREAKOUT_TOL = 1.02

# 2026-07-22 개편: 저점상승형 20일선 기울기 / 눌림목 20일선 상승 확인에 공용으로 쓰는
# "며칠 전과 비교할지" 값(gas/ticker-proxy.gs와 동일하게 5거래일).
MA_SLOPE_LOOKBACK = 5
IHS_VOL_SURGE_RATIO = 1.20  # 역헤드앤숄더: 우어깨 이후 거래량이 20일 평균 대비 1.2배 이상

PULLBACK_WINDOW = 260
PULLBACK_LOOKBACK = 20
PULLBACK_MIN_RISE = 0.15
PULLBACK_MIN_DROP = 0.05
PULLBACK_MAX_DROP = 0.15
PULLBACK_MA_TOL = 0.03
PULLBACK_MIN_DAYS = 240  # 1년선(240거래일) 계산에 필요한 최소 보유 일수

# 2026-08-22 신설(작업지시서: detect_pullback 보강)
# ① 최저점 탐색을 "오늘 기준"이 아니라 "고점 기준" 과거 N봉으로 제한 - 6개월 전 저점
# 대비 상승폭이 계산되는 착시를 막고 단기 강한 파동만 잡기 위함. 임의 초기값(20~30봉
# 범위 중간값), 추후 백테스트로 조정.
PULLBACK_LOW_SEARCH_WINDOW = 25
# ② 조정구간 최대거래량이 상승구간 최대거래량의 이 비율 이하여야 함(신설, 임시값).
PULLBACK_MAX_VOL_RATIO = 0.70
# 2026-10-04 눌림목 개선: 조정 거래량은 "평균 비교"가 주 조건, 최고 거래량 70%는 보조(가산) 조건. 선행 상승 구간 최소 3봉,
# 저점 L 이탈 제외, 고점 98% 이상 회복(너무 늦음) 제외, 어느 이평에 눌렸는지·반등 확인을 상태로 표시한다.
# 2026-10-04 수익률 백테스트: 선행 상승이 30%를 넘은 뒤의 눌림목은 전/후반 기간 모두 성과가 나빴다(15~30%가 양호)
PULLBACK_MAX_RISE = 0.30
PULLBACK_MIN_RISE_BARS = 3          # L -> H 상승 기간(봉) 최소
PULLBACK_RISE_VOLUME_GAIN = 1.10    # 상승구간 평균 거래량 >= 상승 직전 평균 x 이 값이면 가산
PULLBACK_MA_CLUSTER = 0.03          # |MA20-MA240|/MA240 이하면 두 이평 응축 눌림(가산)
PULLBACK_LATE_RECOVERY = 0.98       # 종가가 고점의 이 비율 이상이면 눌림이 끝난 상태 - 제외
PULLBACK_SUPPORT_TEST_TOL = 0.01    # 지지 확인: 최근 3봉 저가가 지지 이평 +1% 이내를 테스트
# ③ 20일선 방향 조건 두 버전 - 'ma5_above_ma20'(정배열 초입) / 'ma20_slope_tol'(완만한
# 하락까지 허용). 기본값은 B(ma20_slope_tol)로 둔다 - 조정구간엔 5일선이 20일선 아래로
# 잠깐 처지는 게 흔해서(단기가 장기보다 먼저 반응) A는 정상적인 눌림목까지 과도하게
# 걸러낼 위험이 있다고 판단했다(실제로 기존 회귀 테스트 데이터로도 A는 탈락, B는 통과).
# 백테스트로 비교 후 확정.
PULLBACK_TREND_FILTER_VERSION = 'ma20_slope_tol'
PULLBACK_MA20_SLOPE_TOL = -0.005  # 'ma20_slope_tol' 버전에서 허용하는 완만한 하락(-0.5%)
# ④ 진입 트리거(check_pullback_entry_trigger) 튜닝 상수
PULLBACK_ENTRY_WICK_MULT = 2.0    # 아래꼬리 캔들 판정: 아래꼬리가 몸통의 이 배수 이상
# ⑤ 거래대금 필터 - 근거 부족으로 지금은 비활성(0 = 미사용). 값을 넣으면(백만원 단위)
# 그 이상만 통과하도록 나중에 활성화할 수 있게 상수만 분리해둔다.
PULLBACK_MIN_TRADING_VALUE = 0

# Conservative score floors filter weak structures before the display cap.
# Scores combine shape, support, volume, and recent-candle evidence, so the
# result does not depend on the order in which symbols are scanned.
IHS_MIN_SCORE = 70
PULLBACK_MIN_SCORE = 80


# ---------------------------------------------------------------------------
# 공용 헬퍼
# ---------------------------------------------------------------------------

def is_etf_name(name):
    """Return whether a KRX display name looks like an ETF/security product."""
    value = str(name or '').strip()
    if not value:
        return False
    if any(value.startswith(prefix) for prefix in ETF_NAME_PREFIXES):
        return True
    return bool(ETF_NAME_TOKENS.search(value))


def is_excluded_stock(stock, daily):
    """Exclude the non-common-stock/status categories from chart scans."""
    stock = stock or {}
    name = str(stock.get('name') or '').strip()
    if bool(stock.get('is_etf')) or is_etf_name(name):
        return True
    if NON_COMMON_STOCK_NAME_TOKENS.search(name) or PREFERRED_STOCK_SUFFIX.search(name):
        return True
    if stock.get('is_trading_halted') or stock.get('is_under_liquidation') or stock.get('is_loan_available'):
        return True
    if not daily:
        return False
    latest_close = daily[-1].get('close')
    latest_volume = daily[-1].get('volume')
    try:
        # No volume on the latest bar is the reliable local-data proxy for a
        # trading halt; status flags above are used when the upstream provides them.
        return float(latest_close) < PENNY_STOCK_MAX_PRICE or float(latest_volume or 0) <= 0
    except (TypeError, ValueError):
        return False


def find_swing_indices(win, field, is_low):
    """저점(is_low)/고점 스윙 인덱스 - PATTERN_SWING(2)봉씩 좌우로 겹치지 않는(weak)
    극값을 찾는다. 동점은 허용한다(원래 파이썬 루프의 엄격한 '<'/'>' 탈락 조건과 동일).
    2026-08-21: pandas rolling(center=True)로 벡터화(원래 이중 루프와 동일 결과 -
    test/test_pattern_detect.py + 회귀 스크립트로 확인)."""
    window = PATTERN_SWING * 2 + 1
    if len(win) < window:
        return []
    values = pd.Series([row[field] for row in win], dtype=float)
    rolled = values.rolling(window, center=True).min() if is_low else values.rolling(window, center=True).max()
    mask = rolled.notna() & (values == rolled)
    return [int(i) for i in values.index[mask]]


def max_high_between(win, i1, i2):
    if i2 <= i1 + 1:
        return None
    highs = np.array([win[k]['high'] for k in range(i1 + 1, i2)], dtype=float)
    local_idx = int(np.argmax(highs))  # 동점이면 최초(가장 이른) 인덱스를 취해 기존 루프의 '>' 판정과 동일
    idx = i1 + 1 + local_idx
    return {'date': win[idx]['date'], 'high': float(highs[local_idx])}


def min_low_between(win, i1, i2):
    """i1~i2 사이(양끝 포함)의 최저 저가. 쌍바닥 두 저점 사이에 그보다 더 낮은 저가가
    끼어있는지(무효 조합) 확인하는 용도 - max_high_between과 짝을 이루는 헬퍼."""
    if i2 < i1:
        return None
    lows = np.array([win[k]['low'] for k in range(i1, i2 + 1)], dtype=float)
    return float(np.min(lows))


def moving_average(win, field, period):
    """2026-08-21: pandas rolling().mean()으로 벡터화했다가 되돌렸다 - pandas의
    내부 합산 순서가 원래의 슬라이딩 합(누적 +=/-=)과 미세하게(마지막 자리수) 달라서,
    ma_cloud_breakout의 5일선-20일선 골든크로스처럼 두 이평선이 '정확히 같을 때'를
    기준으로 삼는 비교에서 부동소수점 오차만으로 크로스 유무가 뒤집히는 경우를
    회귀 테스트로 발견했다(diff_test_targeted.py). 그 경로가 있는 한 값 자체보다
    연산 순서를 원본과 동일하게 유지하는 게 더 중요해서 그대로 둔다."""
    n = len(win)
    ma = [None] * n
    s = 0.0
    for i in range(n):
        s += win[i][field]
        if i >= period:
            s -= win[i - period][field]
        if i >= period - 1:
            ma[i] = s / period
    return ma


def compute_atr(win, period=ATR_PERIOD):
    """마지막 period개 진폭(TR)의 단순 평균. 봉이 모자라면 None. 여러 검색기가 같이 쓰는 공통 헬퍼."""
    if len(win) < 2:
        return None
    trs = []
    for i in range(1, len(win)):
        prev_close = win[i - 1]['close']
        trs.append(max(win[i]['high'] - win[i]['low'], abs(win[i]['high'] - prev_close), abs(win[i]['low'] - prev_close)))
    trs = trs[-period:]
    return sum(trs) / len(trs) if trs else None


def volume_ratio_last(win, period=20):
    """오늘 거래량 / 직전 period봉 평균 거래량(오늘 제외). 기준이 없으면 None."""
    if len(win) < period + 1:
        return None
    base = sum(row['volume'] for row in win[-period - 1:-1]) / period
    return (win[-1]['volume'] / base) if base else None


def trading_value_stats(win, period=20):
    """(20일 평균 거래대금(오늘 제외), 오늘 거래대금). 거래대금 = 종가 x 거래량."""
    if len(win) < period + 1:
        return None, None
    base = sum(row['close'] * row['volume'] for row in win[-period - 1:-1]) / period
    return base, win[-1]['close'] * win[-1]['volume']


def rsi_last(win, period=14, field='close'):
    """Return Wilder RSI for the latest bar, or None when history is short.
    2026-08-21: 등락폭 자체는 numpy(np.diff/np.clip)로 벡터화했지만, 초기 평균(시드)은
    moving_average와 같은 이유로 numpy .mean()이 아니라 원본과 동일한 좌→우 순서의
    sum()으로 계산한다(부동소수점 합산 순서 차이로 RSI 임계값 비교가 흔들리는 걸 방지)."""
    if len(win) <= period:
        return None
    closes = np.array([row[field] for row in win], dtype=float)
    changes = np.diff(closes)
    gains = np.clip(changes, 0.0, None)
    losses = np.clip(-changes, 0.0, None)
    avg_gain = float(sum(gains[:period]) / period)
    avg_loss = float(sum(losses[:period]) / period)
    for i in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[i]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + (avg_gain / avg_loss)))


def avg_volume(win, from_idx, to_idx):
    """2026-08-21: moving_average와 같은 이유로 numpy .mean()이 아니라 원본과 동일한
    sum()/len()을 쓴다 - is_volume_declining/increasing이 두 avg_volume 결과를
    '이르다/같다'로 엄격 비교하는데, 거래량이 일정한 구간(테스트 데이터에 흔함)에서
    합산 순서 차이만으로 그 비교가 뒤집히는 사례를 회귀 테스트로 발견했다."""
    if to_idx <= from_idx:
        return 0
    vals = [win[i]['volume'] for i in range(from_idx, to_idx)]
    return sum(vals) / len(vals)


def is_volume_declining(win, from_idx, to_idx):
    mid = from_idx + (to_idx - from_idx) // 2
    if mid <= from_idx or to_idx <= mid:
        return False
    early = avg_volume(win, from_idx, mid)
    late = avg_volume(win, mid, to_idx)
    return early > 0 and late < early


def is_volume_increasing(win, from_idx, to_idx):
    """is_volume_declining의 반대(눌림목 상승구간 거래량 증가 조건용)."""
    mid = from_idx + (to_idx - from_idx) // 2
    if mid <= from_idx or to_idx <= mid:
        return False
    early = avg_volume(win, from_idx, mid)
    late = avg_volume(win, mid, to_idx)
    return early > 0 and late > early


def is_last_candle_bullish(win):
    last = win[-1]
    return bool(last['close'] > last['open'])


def has_bullish_after(win, from_idx):
    if from_idx + 1 >= len(win):
        return False
    tail = win[from_idx + 1:]
    closes = np.array([row['close'] for row in tail], dtype=float)
    opens = np.array([row['open'] for row in tail], dtype=float)
    return bool(np.any(closes > opens))


def score_tier(value, tiers):
    for t in tiers:
        if value >= t['min']:
            return t['score']
    return 0


def clamp_score(n):
    return max(0, min(100, round(n)))


def pattern_grade(score, minimum=70):
    return score >= minimum


def dedupe_levels(levels):
    sorted_levels = sorted(levels)
    out = []
    for v in sorted_levels:
        last = out[-1] if out else None
        if last is not None and abs(v - last) / last < 0.01:
            continue
        out.append(v)
    return out


def compute_support_resistance(daily):
    win = daily[max(0, len(daily) - 120):]
    low_idx = find_swing_indices(win, 'low', True)
    high_idx = find_swing_indices(win, 'high', False)
    last_close = daily[-1]['close']

    low_levels = dedupe_levels([win[i]['low'] for i in low_idx])
    high_levels = dedupe_levels([win[i]['high'] for i in high_idx])

    support = sorted([v for v in low_levels if v < last_close], reverse=True)[:2]
    resistance = sorted([v for v in high_levels if v > last_close])[:2]

    if not support:
        min_low = min(w['low'] for w in win)
        if min_low < last_close:
            support = [min_low]
    if not resistance:
        max_high = max(w['high'] for w in win)
        if max_high > last_close:
            resistance = [max_high]

    return {'support': support, 'resistance': resistance}


def ichimoku_period_mid(daily, i, period):
    start = i - period + 1
    if start < 0:
        return None
    window = np.array([[daily[k]['high'], daily[k]['low']] for k in range(start, i + 1)], dtype=float)
    return float((window[:, 0].max() + window[:, 1].min()) / 2)


ICHIMOKU_TENKAN_PERIOD = 9
ICHIMOKU_KIJUN_PERIOD = 26
ICHIMOKU_SENKOU_B_PERIOD = 52
ICHIMOKU_DISPLACEMENT = 26


# 구름 위/아래(10) + 전환선-기준선 골든/데드(10) + 구름 색 양운/음운(10) = 0~30점.
# js/foreign-flow.js의 computeIchimokuScore와 동일 공식(선/구름 렌더링은 프론트에서만 하고
# 여기서는 점수만 계산 - 그림은 필요 없음).
def compute_ichimoku_score(daily):
    n = len(daily)
    tenkan = [ichimoku_period_mid(daily, i, ICHIMOKU_TENKAN_PERIOD) for i in range(n)]
    kijun = [ichimoku_period_mid(daily, i, ICHIMOKU_KIJUN_PERIOD) for i in range(n)]

    cloud_idx = n - 1 - ICHIMOKU_DISPLACEMENT
    today_senkou_a = None
    today_senkou_b = None
    if cloud_idx >= 0:
        if tenkan[cloud_idx] is not None and kijun[cloud_idx] is not None:
            today_senkou_a = (tenkan[cloud_idx] + kijun[cloud_idx]) / 2
        today_senkou_b = ichimoku_period_mid(daily, cloud_idx, ICHIMOKU_SENKOU_B_PERIOD)

    close = daily[-1]['close']
    cloud_score = 0
    if today_senkou_a is not None and today_senkou_b is not None:
        top = max(today_senkou_a, today_senkou_b)
        bottom = min(today_senkou_a, today_senkou_b)
        if close > top:
            cloud_score = 10
        elif close >= bottom:
            cloud_score = 5

    cross_score = 0
    last_tenkan, last_kijun = tenkan[-1], kijun[-1]
    if last_tenkan is not None and last_kijun is not None:
        if last_tenkan > last_kijun:
            cross_score = 10
        elif last_tenkan == last_kijun:
            cross_score = 5

    color_score = 0
    if today_senkou_a is not None and today_senkou_b is not None:
        if today_senkou_a > today_senkou_b:
            color_score = 10
        elif today_senkou_a == today_senkou_b:
            color_score = 5

    return {'score': cloud_score + cross_score + color_score}


def ichimoku_cloud_at(daily, index):
    """해당 봉에 표시되는 현재 구름(26봉 선행)의 상·하단을 반환한다."""
    source_index = index - ICHIMOKU_DISPLACEMENT
    if source_index < 0:
        return None
    span_a_base = ichimoku_period_mid(daily, source_index, ICHIMOKU_TENKAN_PERIOD)
    span_a_kijun = ichimoku_period_mid(daily, source_index, ICHIMOKU_KIJUN_PERIOD)
    span_b = ichimoku_period_mid(daily, source_index, ICHIMOKU_SENKOU_B_PERIOD)
    if span_a_base is None or span_a_kijun is None or span_b is None:
        return None
    span_a = (span_a_base + span_a_kijun) / 2
    return {
        'spanA': span_a,
        'spanB': span_b,
        'top': max(span_a, span_b),
        'bottom': min(span_a, span_b),
    }


# 시초 갭상승 조건검색(B/K/G/L).
def detect_opening_gap(daily):
    if len(daily) < 2:
        return None
    previous = daily[-2]
    current = daily[-1]
    previous_close = previous.get('close')
    open_price = current.get('open')
    close_price = current.get('close')
    volume = current.get('volume')
    if not previous_close or not open_price or not close_price or not volume:
        return None

    gap_rate_pct = (open_price / previous_close - 1) * 100
    intraday_rate_pct = (close_price / open_price - 1) * 100
    turnover_million = close_price * volume / 1_000_000
    if not open_price > previous_close:  # B
        return None
    if intraday_rate_pct < OPENING_GAP_MIN_INTRADAY_PCT:  # K
        return None
    if not OPENING_GAP_MIN_OPEN <= open_price <= OPENING_GAP_MAX_OPEN:  # G
        return None
    if not OPENING_GAP_MIN_TURNOVER_MILLION <= turnover_million <= OPENING_GAP_MAX_TURNOVER_MILLION:  # L
        return None

    score = clamp_score(round(70 + min(20, intraday_rate_pct * 2) + min(10, gap_rate_pct)))
    return {
        'signal': {'date': current.get('date'), 'price': close_price},
        'breakout': False,
        'score': score,
        'reasons': [
            'B 시가가 전일 종가보다 %.1f%% 높음' % gap_rate_pct,
            'K 종가가 시가 대비 %.1f%% 상승' % intraday_rate_pct,
            'G 시가 %s원' % format(open_price, ','),
            'L 거래대금 %.1f백만원' % turnover_million,
        ],
        'interpretation': '전일 종가보다 높게 시작한 뒤 시가 대비 %.1f%% 추가 상승한 갭상승 후보입니다(%d점).'
                           % (intraday_rate_pct, score),
        'previousClose': previous_close,
        'open': open_price,
        'gapRatePct': gap_rate_pct,
        'intradayRatePct': intraday_rate_pct,
        'turnoverMillion': turnover_million,
    }


# 오늘 거래대금(종가x거래량) / 최근 20일(오늘 제외) 평균 거래대금.
# js/foreign-flow.js의 computeVolumeMultiple과 동일 공식.
def compute_volume_multiple(daily):
    if not daily or len(daily) < 21:
        return None
    today = daily[-1]
    if not today.get('volume'):
        return None
    today_amt = today['close'] * today['volume']
    win = daily[-21:-1]
    avg_amt = (sum(d['close'] * d['volume'] for d in win) / len(win)) if win else 0
    if not avg_amt:
        return None
    return {'today': today_amt, 'avg20': avg_amt, 'multiple': today_amt / avg_amt}


# 거래량 점수(15점 만점) - 단순히 거래량이 많을수록 고득점이 아니라 가격 방향과 같이 본다
# (급증+상승=강한 확인 15점, 급증+하락=분산·투매 경고 0점). js/foreign-flow.js의
# computeVolumeScore와 동일 공식으로 유지할 것.
def compute_volume_score(daily):
    vm = compute_volume_multiple(daily)
    if not vm:
        return {'score': 0}
    last, prev = daily[-1], daily[-2]
    change_pct = ((last['close'] - prev['close']) / prev['close'] * 100) if prev.get('close') else 0
    mult = vm['multiple']
    if mult >= 2:
        if change_pct > 0.3:
            score = 15
        elif change_pct < -0.3:
            score = 0
        else:
            score = 8
    elif mult >= 1.3:
        if change_pct > 0.3:
            score = 11
        elif change_pct < -0.3:
            score = 4
        else:
            score = 7
    elif mult >= 0.7:
        score = 7
    else:
        score = 5
    return {'score': score}


def compute_tech_score(daily):
    """이동평균(25) + 지지선 근접도(15) + 저항선 근접도(15) + 일목균형표(30) + 거래량(15)
    = 0~100점. js/foreign-flow.js의 computeTechnicalScore와 동일 공식 - 종목분석/투자시그널
    등급이 어긋나지 않으려면 두 구현을 같이 고칠 것."""
    if not daily or len(daily) < 60:
        return None
    close = daily[-1]['close']

    def last_val(arr):
        return arr[-1] if arr else None

    ma5 = last_val(moving_average(daily, 'close', 5))
    ma20 = last_val(moving_average(daily, 'close', 20))
    ma60 = last_val(moving_average(daily, 'close', 60))

    ma_score = 0
    if ma5 is not None and ma20 is not None and ma60 is not None:
        if ma5 > ma20 > ma60:
            ma_score = 25
        elif ma20 > ma60:
            ma_score = 17
        elif ma5 > ma20:
            ma_score = 8

    levels = compute_support_resistance(daily)
    support = levels['support']
    sup_score = 0
    if support:
        nearest_sup = min(support, key=lambda b: abs(b - close))
        sup_gap = (close - nearest_sup) / nearest_sup * 100
        if sup_gap < 0:
            sup_score = 0
        elif sup_gap <= 2:
            sup_score = 15
        elif sup_gap <= 5:
            sup_score = 9
        elif sup_gap <= 8:
            sup_score = 4

    resistance = levels['resistance']
    res_score = 0
    if resistance:
        nearest_res = min(resistance, key=lambda b: abs(b - close))
        res_gap = (nearest_res - close) / close * 100
        if res_gap < 0:
            res_score = 15
        elif res_gap <= 3:
            res_score = 9
        elif res_gap <= 8:
            res_score = 4

    ichi_score = compute_ichimoku_score(daily)['score']
    vol_score = compute_volume_score(daily)['score']

    return {'score': ma_score + sup_score + res_score + ichi_score + vol_score}


def enrich_pattern_detail(detail, daily):
    """Add display-only price structure fields to an existing pattern result.

    The detector remains the source of truth for inclusion and scoring. These
    fields only serialize the already-used window so the scanner can render a
    per-stock observation without another OHLC request.
    """
    enriched = dict(detail or {})
    closes_20d = [
        {'date': row.get('date'), 'close': row.get('close')}
        for row in (daily or [])[-20:]
        if row.get('date') and row.get('close') is not None
    ]
    enriched.setdefault('closes_20d', closes_20d)

    low_swings = enriched.get('low_swings') or []
    if low_swings:
        enriched.setdefault('pivot_lows', list(low_swings))
    if len(low_swings) >= 2:
        previous_low = low_swings[-2]
        latest_low = low_swings[-1]
        enriched.setdefault('previous_low', dict(previous_low))
        enriched.setdefault('latest_low', dict(latest_low))
        previous_price = previous_low.get('price')
        latest_price = latest_low.get('price')
        if previous_price and latest_price:
            enriched.setdefault('low_rise_pct', (latest_price - previous_price) / previous_price * 100)

    signal = enriched.get('signal') or enriched.get('current') or {}
    current_close = signal.get('price') if isinstance(signal, dict) else None
    if current_close is None and closes_20d:
        current_close = closes_20d[-1].get('close')
    if current_close is not None:
        enriched.setdefault('current_close', current_close)

    resistance = enriched.get('resistance')
    if resistance is not None:
        enriched.setdefault('recent_resistance', resistance)
        if current_close:
            enriched.setdefault('resistance_gap_pct', (resistance - current_close) / current_close * 100)

    latest_low = enriched.get('latest_low')
    if latest_low and latest_low.get('price'):
        enriched.setdefault(
            'from_latest_low_pct',
            (current_close - latest_low['price']) / latest_low['price'] * 100 if current_close is not None else None,
        )
    return enriched


def annotate_pattern_scan_details(pattern_results, scanned_at, pullback_matches=None):
    """Attach the batch scan timestamp to serialized pattern details."""
    groups = list((pattern_results or {}).values())
    if pullback_matches is not None:
        groups.append(pullback_matches)
    for matches in groups:
        for item in matches or []:
            detail = item.get('patternDetail')
            if detail is not None:
                detail['scanned_at'] = scanned_at
            item['scannedAt'] = scanned_at


def build_pattern_match(stock, daily, detail):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    change_rate = ((last['close'] - prev['close']) / prev['close'] * 100) if (prev and prev['close']) else None
    pattern_detail = enrich_pattern_detail(detail, daily)
    # 2026-09-03: 목록 응답 198KB 중 종목당 miniChart 738B가 patternDetail.closes_20d와
    # 완전히 같은 배열이었다(여기서 그대로 대입하므로). 20일 종가는 miniChart 한 곳에만
    # 싣는다 - angleMomentum/gongpasan 스캐너도 closes_20d 없이 miniChart만 넣고 있어
    # 세 경로의 모양이 같아지고, 프론트는 이미 miniChart로 폴백한다
    # (js/pattern-scan.js miniChartRows). patternDetail은 패턴 좌표만 남는다.
    mini_chart = pattern_detail.pop('closes_20d', None) or []
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last['date'],
        'miniChart': mini_chart,
        'score': detail['score'],
        'reasons': detail['reasons'],
        'interpretation': detail['interpretation'],
        # 상세 클릭 시 장중 봉으로 재판정하지 않아도 전날 스캔 근거선을 그대로 그릴 수 있게
        # 패턴 좌표(저점/고점/넥라인/지지·저항)를 스냅샷에 함께 보관한다.
        'patternDetail': pattern_detail,
    }


def _quality_gate_matches(matches, pattern_key):
    """Tighten chart conditions only when a bucket is larger than 20.

    The gates are deliberately score/structure based. A candidate is never
    removed just because it appeared later in the universe scan.
    """
    matches = list(matches or [])
    if len(matches) <= PATTERN_MAX_MATCHES:
        return matches

    def score_at_least(item, threshold):
        try:
            return float(item.get('score') or 0) >= threshold
        except (TypeError, ValueError):
            return False

    def passes_gate(item, stage):
        detail = item.get('patternDetail') or {}
        criteria = detail.get('criteria') or {}
        if pattern_key == 'risingLows':
            # First remove weak resistance/volume/current-candle confirmations,
            # then keep only the strongest higher-low structures.
            return score_at_least(item, 80 if stage == 1 else 90)
        if pattern_key == 'maCloudBreakout':
            return score_at_least(item, 90 if stage == 1 else 95)
        if pattern_key == 'doubleBottom':
            return score_at_least(item, 80 if stage == 1 else 90)
        if pattern_key == 'invHeadShoulders':
            return score_at_least(item, 90 if stage == 1 else 95)
        if pattern_key == 'boxRangeLow':
            if stage == 1:
                return score_at_least(item, 80)
            if criteria:
                lower_position = criteria.get('lowerPositionPct')
                close_range = criteria.get('closeRangePct')
                if lower_position is not None and close_range is not None:
                    return lower_position <= 25 and close_range <= 8
            return score_at_least(item, 90 if stage == 2 else 95)
        if pattern_key == 'openingGap':
            if stage == 1:
                return score_at_least(item, 80)
            intraday = detail.get('intradayRatePct')
            gap = detail.get('gapRatePct')
            if intraday is not None and gap is not None:
                return intraday >= 4.5 and gap >= 1.0
            return score_at_least(item, 90 if stage == 2 else 95)
        if pattern_key == 'pullback':
            return score_at_least(item, 85 if stage == 1 else 90)
        return score_at_least(item, 90 if stage == 1 else 95)

    # Each stage is stricter than the previous one. If a stage brings the
    # bucket to 20 or fewer, retain every survivor and stop.
    candidates = matches
    for stage in (1, 2, 3):
        filtered = [item for item in candidates if passes_gate(item, stage)]
        if len(filtered) <= PATTERN_MAX_MATCHES:
            return filtered
        candidates = filtered
    return candidates


# ---------------------------------------------------------------------------
# ① 저점상승형(Higher Low)
# ---------------------------------------------------------------------------

def detect_rising_lows(daily):
    """하락 뒤 바닥을 다지며 저점이 계단식으로 오르는 구간(저점상승형).

    통과 조건(모두):
    1) 최근 60거래일에서 스윙 저점이 3개 이상 이어서 오른다(저점마다 +1% 이상, 첫 저점 대비 +4%~+20%).
    2) 첫 저점과 마지막 저점 사이가 15거래일 이상(짧은 반등 제외).
    3) 하방이 막혀 있다 - 계단 시작 이후 첫 저점 아래로 내려간 봉(저가·종가)이 없다.
    4) 계단 시작 전 60거래일 안에 첫 저점보다 12% 이상 높은 고점이 있다(하락 뒤의 바닥).
    5) 아직 안 올랐다 - 현재가가 마지막 저점의 +10% 이내, 최근 20거래일 수익률 +15% 이하, 최근 10거래일에 +10% 넘는 하루 급등이 없다.
    """
    need = RISING_LOWS_WINDOW + RISING_LOWS_DECLINE_LOOKBACK
    if len(daily) < need:
        return None
    full = daily[-need:]
    win = full[RISING_LOWS_DECLINE_LOOKBACK:]
    offset = RISING_LOWS_DECLINE_LOOKBACK

    low_idxs = find_swing_indices(win, 'low', True)
    high_idxs = find_swing_indices(win, 'high', False)
    if len(low_idxs) < RISING_LOWS_MIN_LOWS:
        return None

    # 마지막 저점에서 거꾸로 훑어 "직전 저점이 더 낮은 동안"만 계단으로 묶는다.
    run_start = len(low_idxs) - 1
    while run_start > 0 and win[low_idxs[run_start - 1]]['low'] < win[low_idxs[run_start]]['low']:
        run_start -= 1
    run = low_idxs[run_start:]
    if len(run) < RISING_LOWS_MIN_LOWS:
        return None
    lows = [win[i]['low'] for i in run]
    if any(b < a * (1 + RISING_LOWS_MIN_STEP) for a, b in zip(lows, lows[1:])):
        return None
    first_low, last_low = lows[0], lows[-1]
    total_rise = (last_low - first_low) / first_low if first_low else 0
    if not (RISING_LOWS_MIN_TOTAL_RISE <= total_rise <= RISING_LOWS_MAX_TOTAL_RISE):
        return None
    if run[-1] - run[0] < RISING_LOWS_MIN_SPAN_BARS:
        return None

    # 3) 하방이 막혀 있는가
    for row in win[run[0]:]:
        if row['low'] < first_low * 0.995 or row['close'] < first_low:
            return None

    # 4) 하락 뒤의 바닥인가: 계단 시작 전(앞선 60봉 + 창 안 첫 저점 이전)에 충분히 높은 고점이 있었다
    before_high = max([row['high'] for row in full[:offset + run[0] + 1]] or [0])
    if before_high < first_low * (1 + RISING_LOWS_MIN_PRIOR_DECLINE):
        return None

    # 6) 유동성: 거래가 죽어 있지 않은가(거래량 증가가 아니라 거래대금 수준을 본다)
    tv20 = [(row['close'] or 0) * (row.get('volume') or 0) for row in win[-20:]]
    tv5 = tv20[-5:]
    avg20 = sum(tv20) / len(tv20)
    avg5 = sum(tv5) / len(tv5)
    median20 = sorted(tv20)[len(tv20) // 2]
    if avg20 < MIN_AVG_TRADING_VALUE_20D:
        return None
    if avg5 < avg20 * MIN_RECENT_LIQUIDITY_RATIO:
        return None
    if sum(1 for row in win[-20:] if not (row.get('volume') or 0)) > MAX_ZERO_VOLUME_DAYS_20D:
        return None

    # 5) 아직 안 올랐는가
    last_close = win[-1]['close']
    if last_close < last_low:
        return None
    if last_close > last_low * (1 + RISING_LOWS_MAX_FROM_LAST_LOW):
        return None
    if len(win) > 20 and win[-21]['close'] and last_close / win[-21]['close'] - 1 > RISING_LOWS_MAX_RET_20D:
        return None
    for k in range(len(win) - 10, len(win)):
        if k > 0 and win[k - 1]['close'] and win[k]['close'] / win[k - 1]['close'] - 1 > RISING_LOWS_MAX_DAY_GAIN_10D:
            return None

    low_swing_points = [{'date': win[i]['date'], 'price': win[i]['low']} for i in run]
    current = {'date': win[-1]['date'], 'price': last_close}
    highs_in_run = [i for i in high_idxs if i >= run[0]]
    resistance = max(win[i]['high'] for i in range(run[0], len(win)))

    # 점수(참고용): 저점 개수·간격 규칙성·기간·저점 회귀선 적합도·거래대금·수급·저점 반응·현재 캔들
    count_score = 40 if len(run) >= 4 else 35
    gaps = [b - a for a, b in zip(run, run[1:])]
    regular = (max(gaps) <= min(gaps) * 3) if gaps and min(gaps) > 0 else False
    regular_score = 10 if regular else 5
    span_score = 15 if (run[-1] - run[0]) >= 30 else 10
    bull_score = 10 if is_last_candle_bullish(win) else 5

    # 저점 상승 회귀선 R^2 (저점들이 한 줄 위에 가지런히 놓일수록 높다)
    n_lows = len(run)
    mx = sum(run) / n_lows
    my = sum(lows) / n_lows
    sxx = sum((x - mx) ** 2 for x in run)
    sxy = sum((x - mx) * (y - my) for x, y in zip(run, lows))
    syy = sum((y - my) ** 2 for y in lows)
    r2 = (sxy * sxy) / (sxx * syy) if sxx and syy else 0.0
    r2_score = 5 if r2 >= 0.85 else 0

    # 거래대금·수급 가산점(필수 조건 아님)
    liquid_score = 5                                   # 20일 평균 거래대금 기준 통과(위에서 이미 확인)
    recent_score = 3 if avg5 >= avg20 else 0           # 최근 거래대금이 20일 평균 이상으로 유지
    up_vol = sum((row.get('volume') or 0) for row in win[-20:] if row['close'] >= row['open'])
    down_vol = sum((row.get('volume') or 0) for row in win[-20:] if row['close'] < row['open'])
    flow_score = 2 if down_vol == 0 or up_vol / down_vol > 1.0 else 0
    median_penalty = -5 if median20 < MIN_MEDIAN_TRADING_VALUE_20D else 0

    # 각 스윙 저점 뒤 1~3봉의 평균 거래량이 20일 평균 이상이면 "저점에서 매수세 반응"으로 본다
    avg_vol20 = sum((row.get('volume') or 0) for row in win[-20:]) / 20
    reacted = 0
    for i in run:
        after = [(row.get('volume') or 0) for row in win[i + 1:i + 4]]
        if after and avg_vol20 and sum(after) / len(after) >= avg_vol20:
            reacted += 1
    reaction_score = 5 if reacted >= max(2, (len(run) + 1) // 2) else 0

    score = clamp_score(count_score + regular_score + span_score + bull_score + r2_score
                        + liquid_score + recent_score + flow_score + reaction_score + median_penalty)
    reasons = [
        '하락 뒤 바닥: 계단 시작 전 고점이 첫 저점보다 %.0f%% 높았음' % ((before_high / first_low - 1) * 100),
        '스윙 저점 %d개가 계단식 상승(첫 저점 대비 +%.1f%%, %d거래일)' % (len(run), total_rise * 100, run[-1] - run[0]),
        '하방 막힘: 계단 시작 뒤 첫 저점 아래로 내려간 봉 없음',
        '아직 안 오름: 현재가가 마지막 저점 대비 +%.1f%%' % ((last_close / last_low - 1) * 100),
        '유동성: 20일 평균 거래대금 %.0f억 · 최근 5일은 평균의 %.0f%%%s' % (avg20 / 1e8, avg5 / avg20 * 100, ' · 중앙값 부족(-5점)' if median_penalty else ''),
        '저점 회귀선 적합도 R² %.2f · 상승봉/하락봉 거래량 %s · 저점 반응 %d/%d회 · 최근 캔들 %s'
        % (r2, '우세' if flow_score else '열세', reacted, len(run), '양봉' if bull_score >= 10 else '음봉'),
    ]
    return {
        'low_swings': low_swing_points,
        'low_swings_display': low_swing_points + [current],
        'high_swings': [{'date': win[i]['date'], 'price': win[i]['high']} for i in highs_in_run],
        'resistance': resistance,
        'signal': current,
        'breakout': resistance is not None and last_close > resistance * BREAKOUT_TOL,
        'score': score,
        'reasons': reasons,
        'interpretation': '하락 뒤 바닥을 다지며 스윙 저점이 %d번 연속 높아졌고, 현재가는 마지막 저점 근처(+%.1f%%)에 있어 아직 크게 오르지 않은 구간입니다(%d점).'
                          % (len(run), (last_close / last_low - 1) * 100, score),
    }


# ---------------------------------------------------------------------------
# 단기이평 돌파형 - 하락 추세선(스윙 고점 2개를 잇는 저항선)을 종가와 5일선이
# 함께 뚫고 올라오는 순간(위 SHORT_MA_BREAKOUT_WINDOW 주석 참고)
# ---------------------------------------------------------------------------

def detect_short_ma_breakout(daily):
    """최근 30봉의 의미 있는 두 스윙 고점(H1>H2)을 이은 하락 추세선을 오늘 종가가 "처음" 돌파한 종목.

    장 마감 후 확정 일봉 기준(장중 고가만 넘은 경우는 제외). 5일선의 역할은 후행 확인이다 - 종가가 5일선 위에
    있고 5일선이 어제보다 올랐으면 된다(5일선 자체가 추세선을 넘을 필요는 없다).
    H2 이후 어제까지 종가가 추세선 + 허용오차를 명확히 넘은 적이 있으면 첫 돌파가 아니라서 제외한다.
    허용오차 = max(추세선 x 1%, ATR14 x 0.3). 어제 종가도 같은 허용오차까지는 "거의 붙어 있었다"로 인정한다.
    """
    win = daily[max(0, len(daily) - SHORT_MA_BREAKOUT_WINDOW):]
    if len(win) < SHORT_MA_BREAKOUT_WINDOW:
        return None
    last_index = len(win) - 1

    high_idxs = find_swing_indices(win, 'high', False)
    if len(high_idxs) < 2:
        return None
    # H2 = 가장 최근 스윙 고점, H1 = 그 앞쪽에서 간격·하락폭 조건을 만족하는 가장 가까운 스윙 고점
    h2_idx = high_idxs[-1]
    if last_index <= h2_idx:
        return None   # 스윙 고점 자체가 오늘이면 돌파를 판정할 여지가 없다
    h2 = win[h2_idx]['high']
    h1_idx = None
    for idx in reversed(high_idxs[:-1]):
        if h2_idx - idx < SHORT_MA_MIN_SWING_HIGH_GAP:
            continue
        if h2 <= win[idx]['high'] * (1 - SHORT_MA_MIN_HIGH_DECLINE):
            h1_idx = idx
            break
    if h1_idx is None:
        return None
    h1 = win[h1_idx]['high']
    slope = (h2 - h1) / (h2_idx - h1_idx)
    if slope >= 0:
        return None

    def trend_at(i):
        return h1 + slope * (i - h1_idx)

    atr = compute_atr(win)
    if atr is None:
        return None

    def tolerance(i):
        return max(trend_at(i) * SHORT_MA_TRENDLINE_TOL_PCT, atr * SHORT_MA_TRENDLINE_ATR_MULT)

    trend_today = trend_at(last_index)
    close_today = win[last_index]['close']
    if trend_today <= 0:
        return None

    # H2 이후 어제까지 이미 추세선을 허용오차 이상 돌파한 적이 있으면 첫 돌파가 아니다
    for i in range(h2_idx + 1, last_index):
        if win[i]['close'] > trend_at(i) + tolerance(i):
            return None
    # 어제 종가는 추세선 아래 또는 허용오차 이내에서 붙어 있어야 한다
    prev_index = last_index - 1
    if win[prev_index]['close'] > trend_at(prev_index) + tolerance(prev_index):
        return None

    # 오늘 종가 기준 돌파 + 돌파폭 상한(이미 많이 오른 종목 제외)
    if close_today <= trend_today:
        return None
    breakout_pct = (close_today - trend_today) / trend_today
    if breakout_pct > SHORT_MA_MAX_BREAKOUT_PCT:
        return None

    # 5일선: 종가가 5일선 위, 5일선은 어제보다 상승
    ma5 = moving_average(win, 'close', 5)
    ma5_today, ma5_prev = ma5[last_index], ma5[prev_index]
    if ma5_today is None or ma5_prev is None:
        return None
    if not (close_today > ma5_today and ma5_today > ma5_prev):
        return None

    # 유동성: 20일 평균 거래대금(필수), 거래량·거래대금 증가(점수)
    avg_tv, today_tv = trading_value_stats(win)
    if avg_tv is None or avg_tv < SHORT_MA_MIN_TRADING_VALUE_20D:
        return None
    vol_ratio = volume_ratio_last(win)
    tv_ratio = (today_tv / avg_tv) if avg_tv else None

    # ---- 점수(100): 추세선 품질 20 · 첫 돌파 신선도 20 · 돌파폭 15 · 5일선 15 · 거래량 15 · 거래대금 10 · 종가 위치 5
    gap_bars = h2_idx - h1_idx
    decline = (h1 - h2) / h1
    quality_score = (10 if gap_bars >= 8 else 6) + (10 if decline >= 0.04 else 6)
    fresh_score = 20 if win[prev_index]['close'] <= trend_at(prev_index) else 12
    if breakout_pct <= 0.005:
        margin_score = 8
    elif breakout_pct <= 0.03:
        margin_score = 15
    else:
        margin_score = 10
    ma5_3ago = ma5[last_index - 3]
    ma5_slope_pct = ((ma5_today - ma5_3ago) / ma5_3ago) if ma5_3ago else 0.0
    ma5_score = 15 if ma5_slope_pct > 0 else 10
    if vol_ratio is None:
        vol_score = 2
    elif vol_ratio >= 2.0:
        vol_score = 15
    elif vol_ratio >= SHORT_MA_VOLUME_BONUS_2:
        vol_score = 12
    elif vol_ratio >= SHORT_MA_VOLUME_BONUS_1:
        vol_score = 9
    elif vol_ratio >= 1.0:
        vol_score = 5
    else:
        vol_score = 2     # 거래량이 적다고 제외하지 않는다(점수만 낮게)
    tv_score = 10 if (tv_ratio or 0) >= 1.5 else 7 if (tv_ratio or 0) >= 1.2 else 4 if (tv_ratio or 0) >= 1.0 else 0
    day = win[last_index]
    close_position = ((day['close'] - day['low']) / (day['high'] - day['low'])) if day['high'] > day['low'] else 0.0
    pos_score = 5 if close_position >= 0.7 else 0
    score = clamp_score(quality_score + fresh_score + margin_score + ma5_score + vol_score + tv_score + pos_score)

    first = {'date': win[h1_idx]['date'], 'price': h1}
    second = {'date': win[h2_idx]['date'], 'price': h2}
    trendline_end = {'date': win[last_index]['date'], 'price': trend_today}
    signal = {'date': win[last_index]['date'], 'price': close_today}
    vol_text = '%.1f배' % vol_ratio if vol_ratio is not None else '-'
    reasons = [
        '하락 추세선 돌파폭 +%.1f%%(%d/15점) · 추세선 품질 %d/20점' % (breakout_pct * 100, margin_score, quality_score),
        '첫 돌파 신선도 %d/20점(전일 종가 %s)' % (fresh_score, '추세선 아래' if fresh_score == 20 else '추세선 근접'),
        '5일선 상승 %+.1f%%/3일(%d/15점)' % (ma5_slope_pct * 100, ma5_score),
        '거래량 20일 평균 대비 %s(%d/15점) · 거래대금 %s(%d/10점)' % (
            vol_text, vol_score, ('%.1f배' % tv_ratio) if tv_ratio is not None else '-', tv_score),
    ]
    return {
        'status': 'BREAKOUT_NEW',
        'trendline': [first, trendline_end],
        'high_swings': [first, second],
        'ma5': ma5_today,
        'resistance': trend_today,
        'signal': signal,
        'breakout': False,
        'breakoutPct': round(breakout_pct * 100, 2),
        'ma5Rising': True,
        'ma5SlopePct3d': round(ma5_slope_pct * 100, 2),
        'volumeRatio': round(vol_ratio, 2) if vol_ratio is not None else None,
        'tradingValueRatio': round(tv_ratio, 2) if tv_ratio is not None else None,
        'closePosition': round(close_position, 2),
        'score': score,
        'reasons': reasons,
        'interpretation': '최근 30봉 하락 추세선을 오늘 종가가 처음 돌파했고 상승 중인 5일선 위에 있습니다(%d점).' % score,
    }


# ---------------------------------------------------------------------------
# ② 224 장기이평 응축기(구 "이평 상승 초입형", 224일선 + 구름대)
# ---------------------------------------------------------------------------

def detect_ma_cloud_breakout(daily):
    """224일선 + 일목 구름 + 가격이 한곳에 응축된 종목을 COMPRESSION_READY(돌파 준비) / BREAKOUT_NEW(신규 돌파)로 잡는다.

    장 마감 후 확정 일봉 기준. 일목 구름은 ichimoku_cloud_at이 (index-26) 시점 값으로 계산하므로 미래 참조가 없다.
    - 공통: 224일선 20일 기울기 >= -3%, 224일선과 구름 중심 거리 <= 5%, 종가 >= 구름 하단 -2%,
      최근 10봉 중 구름 하단 아래 종가 5회 미만, 20일 평균 거래대금 하한, 종가가 구름 상단 +5%/224일선 +7% 이내.
    - 신규 돌파: 최초 돌파(전일 종가 <= 전일 구름 상단 x 1.01, 당일 종가 > 당일 구름 상단)가 최근 3거래일(오늘 포함) 안이고
      지금도 구름 상단 위 0~5%, 종가가 224일선 -1%~+5%.
    - 돌파 준비: 아직 구름 상단 +1% 이내, 종가가 224일선 +-3%, 최근 3봉 고가가 구름 상단 3% 이내(상단 접근)
      또는 최근 3봉 저가가 구름 하단 3% 이내(하단 지지 확인). 상단 접근을 더 높게 평가한다.
    """
    if len(daily) < MA_CLOUD_MIN_DAYS:
        return None

    ma5 = moving_average(daily, 'close', 5)
    ma20 = moving_average(daily, 'close', 20)
    ma224 = moving_average(daily, 'close', 224)
    last = len(daily) - 1
    today = daily[last]
    close = today['close']
    ma224_now = ma224[last]
    if not ma224_now:
        return None

    # 224일선 방향: 20거래일 동안 급락 중이면 제외, 평탄/상승이면 가산
    ma224_prev = ma224[last - 20]
    if not ma224_prev:
        return None
    ma224_slope20 = (ma224_now - ma224_prev) / ma224_prev
    if ma224_slope20 < -MA_CLOUD_MAX_MA224_DECLINE_20D:
        return None

    cloud = ichimoku_cloud_at(daily, last)
    if not cloud or cloud['top'] <= 0 or cloud['bottom'] <= 0:
        return None
    cloud_mid = (cloud['top'] + cloud['bottom']) / 2
    ma_cloud_distance = abs(ma224_now - cloud_mid) / ma224_now
    if ma_cloud_distance > MA_CLOUD_MAX_MA_CLOUD_DISTANCE:
        return None   # 224일선과 구름대가 너무 멀면 "응축"이 아니다

    ma224_distance = (close - ma224_now) / ma224_now
    if ma224_distance > MA_CLOUD_MAX_MA224_EXTENSION:
        return None
    if close < cloud['bottom'] * (1 - MA_CLOUD_BOTTOM_SUPPORT):
        return None
    below_days = 0
    for k in range(max(0, last - 9), last + 1):
        ck = ichimoku_cloud_at(daily, k)
        if ck and daily[k]['close'] < ck['bottom']:
            below_days += 1
    if below_days >= MA_CLOUD_BELOW_BOTTOM_DAYS:
        return None   # 구름 하단 아래에서 계속 마감 - 지지 실패

    avg_tv, _today_tv = trading_value_stats(daily)
    if avg_tv is None or avg_tv < MA_CLOUD_MIN_TRADING_VALUE_20D:
        return None
    vol_ratio = volume_ratio_last(daily)
    cloud_thickness = (cloud['top'] - cloud['bottom']) / cloud_mid
    cloud_breakout_pct = (close - cloud['top']) / cloud['top']

    # 최근 20봉 가격 범위가 직전 20봉보다 줄었는지(가격 응축)
    def price_range(lo, hi):
        rows = daily[max(0, lo):hi + 1]
        return (max(r['high'] for r in rows) - min(r['low'] for r in rows)) / close if rows else None
    range_now, range_before = price_range(last - 19, last), price_range(last - 39, last - 20)
    price_compressed = range_now is not None and range_before is not None and range_now < range_before

    # ---- 상태 판정 ----
    status = None
    breakout_idx = None
    if close > cloud['top']:
        # 신규 돌파: 최근 3거래일(오늘 포함) 안에 "최초 돌파"가 있고 그 뒤로 구름 상단 위(-1% 허용)를 유지
        if cloud_breakout_pct > MA_CLOUD_MAX_BREAKOUT:
            return None
        if not (MA_CLOUD_BREAKOUT_MA_MIN <= ma224_distance <= MA_CLOUD_BREAKOUT_MA_MAX):
            return None
        for age in range(0, MA_CLOUD_BREAKOUT_MAX_AGE):
            j = last - age
            cj, cprev = ichimoku_cloud_at(daily, j), ichimoku_cloud_at(daily, j - 1)
            if not cj or not cprev:
                continue
            if daily[j]['close'] > cj['top'] and daily[j - 1]['close'] <= cprev['top'] * (1 + MA_CLOUD_READY_OVER_TOP):
                held = all(daily[k]['close'] > ichimoku_cloud_at(daily, k)['top'] * 0.99 for k in range(j, last + 1)
                           if ichimoku_cloud_at(daily, k))
                if held:
                    breakout_idx = j
                    break
        if breakout_idx is None:
            return None   # 구름 상단 위에 이미 오래 머문 종목 - 응축 후 출발이 아니다
        status = 'BREAKOUT_NEW'
    else:
        if close > cloud['top'] * (1 + MA_CLOUD_READY_OVER_TOP) or abs(ma224_distance) > MA_CLOUD_NEAR_TOL:
            return None
        recent = daily[max(0, last - 2):last + 1]
        recent_high = max(r['high'] for r in recent)
        recent_low = min(r['low'] for r in recent)
        top_attempt = recent_high >= cloud['top'] * (1 - MA_CLOUD_TOP_TOL)
        bottom_attempt = recent_low <= cloud['bottom'] * (1 + MA_CLOUD_TOP_TOL)
        if not (top_attempt or bottom_attempt):
            return None
        # 어제 이미 구름 하단 아래로 뚫고 내려가 있다가 오늘 상단까지 튀어오른 급락 후 되돌림(휩쏘)은 제외
        if top_attempt and last > 0:
            prev_cloud = ichimoku_cloud_at(daily, last - 1)
            if prev_cloud and prev_cloud['bottom'] > 0 and daily[last - 1]['close'] < prev_cloud['bottom'] * (1 - MA_CLOUD_BOTTOM_SUPPORT):
                return None
        status = 'COMPRESSION_READY'

    # ---- 점수(100): 224일선 근접 20 · 224-구름 응축 20 · 구름 상단 접근/돌파 20 · 하단 지지/224 돌파 10 · 224 방향 10 · 두께/가격 응축 10 · 거래 10
    near_score = 20 if abs(ma224_distance) <= 0.015 else 14 if abs(ma224_distance) <= 0.03 else 8
    compress_score = 20 if ma_cloud_distance <= 0.03 else 14
    if status == 'COMPRESSION_READY':
        gap_top = (cloud['top'] - recent_high) / cloud['top'] if top_attempt else None
        if top_attempt:
            event_score = 20 if gap_top <= 0.01 else 16 if gap_top <= 0.02 else 10
        else:
            event_score = 0
        support_score = 10 if (bottom_attempt and close >= cloud['bottom']) else 4
        event_label = '구름 상단 접근 %.1f%%' % (gap_top * 100) if top_attempt else '구름 하단 지지 확인'
    else:
        event_score = 16 if cloud_breakout_pct < 0.01 else 20 if cloud_breakout_pct <= 0.03 else 12
        both = close > ma224_now
        support_score = 10 if both else 6
        # 224일선도 최근 3거래일 안에 종가로 처음 넘었으면 가산
        if both and breakout_idx is not None and daily[max(0, breakout_idx - 1)]['close'] < ma224[max(0, breakout_idx - 1)]:
            support_score = 10
            event_score = min(20, event_score + 4)
        event_label = '구름 상단 +%.1f%% 돌파(%d일차)' % (cloud_breakout_pct * 100, last - breakout_idx + 1)
    dir_score = 10 if ma224_slope20 >= 0 else 6 if ma224_slope20 >= -0.015 else 3
    shape_score = (5 if cloud_thickness <= MA_CLOUD_THIN_CLOUD else 2) + (5 if price_compressed else 2)
    if status == 'BREAKOUT_NEW':
        vr = vol_ratio or 0
        trade_score = 10 if vr >= 2.0 else 8 if vr >= MA_CLOUD_VOLUME_BONUS_2 else 6 if vr >= MA_CLOUD_VOLUME_BONUS_1 else 3
    else:
        # 응축 구간의 거래량 감소는 정상 - 거래량이 평균 이상이면 소폭 가산만 한다
        trade_score = 7 if (vol_ratio or 0) >= MA_CLOUD_VOLUME_BONUS_1 else 5
    score = clamp_score(near_score + compress_score + event_score + support_score + dir_score + shape_score + trade_score)

    signal = {'date': today['date'], 'price': close}
    reasons = [
        '224일선 거리 %+.1f%%(%d/20점) · 224일선-구름 중심 거리 %.1f%%(%d/20점)' % (
            ma224_distance * 100, near_score, ma_cloud_distance * 100, compress_score),
        '%s(%d/20점) · 224일선 20일 기울기 %+.1f%%(%d/10점)' % (event_label, event_score, ma224_slope20 * 100, dir_score),
        '구름 두께 %.1f%%·가격 응축 %s(%d/10점) · 거래량 %s(%d/10점)' % (
            cloud_thickness * 100, '진행' if price_compressed else '미확인', shape_score,
            ('%.1f배' % vol_ratio) if vol_ratio is not None else '-', trade_score),
    ]
    label = '돌파 준비' if status == 'COMPRESSION_READY' else '신규 돌파'
    return {
        'status': status,
        'ma5': ma5[last],
        'ma20': ma20[last],
        'ma224': ma224_now,
        'cloud': cloud,
        'signal': signal,
        'breakout': False,
        'breakoutDate': daily[breakout_idx]['date'] if breakout_idx is not None else None,
        'ma224Distance': round(ma224_distance * 100, 2),
        'cloudTopDistance': round(cloud_breakout_pct * 100, 2),     # 구름 상단 대비 종가(+면 돌파)
        'maCloudDistance': round(ma_cloud_distance * 100, 2),
        'cloudThickness': round(cloud_thickness * 100, 2),
        'ma224Slope20': round(ma224_slope20 * 100, 2),
        'volumeRatio': round(vol_ratio, 2) if vol_ratio is not None else None,
        'score': score,
        'reasons': reasons,
        'interpretation': '224일선과 일목 구름대가 가까이 응축된 구간에서 %s 상태입니다(%d점).' % (label, score),
    }


# ---------------------------------------------------------------------------
# ③ 쌍바닥(Double Bottom)
# ---------------------------------------------------------------------------

def _avg_volume_around(win, idx, half=1):
    """idx 주변(앞뒤 half봉 포함) 평균 거래량. 하루 거래량 노이즈를 줄이려고 3봉 평균을 쓴다."""
    lo, hi = max(0, idx - half), min(len(win), idx + half + 1)
    rows = win[lo:hi]
    return sum(r['volume'] for r in rows) / len(rows) if rows else 0


def detect_double_bottom(daily):
    """완성도 높은 쌍바닥: L1 -> 의미 있는 반등(넥라인) -> L2에서 지지 확인 -> 넥라인 방향 회복/접근.

    장 마감 후 확정 일봉 기준. 상태는 두 가지다 - RECOVERY(L2 이후 상승 회복 중), NECKLINE_READY(넥라인 2% 이내 ~ +5%).
    넥라인은 L1~L2 사이 최고 고가(max high). 이미 넥라인을 5% 넘게 돌파한 종목은 제외한다.
    """
    win = daily[max(0, len(daily) - DOUBLE_BOTTOM_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    if len(low_idxs) < 2:
        return None
    last_index = len(win) - 1
    last_close = win[last_index]['close']
    ma5 = moving_average(win, 'close', 5)

    # 가장 최근 저점부터 여러 조합을 확인해 중간 잡음 저점 때문에 패턴을 놓치지 않는다.
    for b in range(len(low_idxs) - 1, 0, -1):
        for a in range(b - 1, -1, -1):
            i1, i2 = low_idxs[a], low_idxs[b]
            gap_days = i2 - i1
            if gap_days < DB_MIN_GAP_DAYS or gap_days > DB_MAX_GAP_DAYS:
                continue
            if last_index - i2 > DB_RECENCY_MAX_GAP:
                continue

            low1, low2 = win[i1]['low'], win[i2]['low']
            diff = abs(low1 - low2) / min(low1, low2)
            if diff > DB_LOW_TOL:
                continue

            # 두 저점 사이에 그보다 2% 넘게 더 낮은 저가가 있으면 진짜 W자가 아니다
            between_min = min_low_between(win, i1, i2)
            if between_min is not None and between_min < min(low1, low2) * (1 - DB_MAX_MIDDLE_BREAK):
                continue
            # L2 이후 저점을 다시 의미 있게 깨면 쌍바닥 실패
            post_min = min_low_between(win, i2, last_index)
            if post_min is not None and post_min < min(low1, low2) * (1 - DB_BREAK_AFTER_L2):
                continue

            # 거래량: L2 주변 3봉 평균이 L1 주변 3봉 평균의 110% 이하(하루 노이즈로 탈락시키지 않는다)
            vol1, vol2 = _avg_volume_around(win, i1), _avg_volume_around(win, i2)
            if vol1 <= 0 or vol2 > vol1 * DB_L2_VOLUME_TOLERANCE:
                continue

            neck = max_high_between(win, i1, i2)
            if not neck:
                continue
            rebound = (neck['high'] - low1) / low1
            if rebound < DB_PEAK_MIN_RISE:
                continue

            proximity = (last_close - neck['high']) / neck['high']
            if proximity > DB_MAX_NECK_EXTENSION:
                continue   # 이미 넥라인을 크게 넘었다 - 쌍바닥 "준비"가 아니다
            ma5_now, ma5_prev = ma5[last_index], ma5[last_index - 1]
            if proximity >= -DB_NECK_READY_DISTANCE:
                status = 'NECKLINE_READY'
            elif (proximity >= -DB_MAX_NECK_GAP and last_close > low2 and ma5_now is not None and last_close > ma5_now
                  and last_index >= 2 and last_close > win[last_index - 2]['close']):
                status = 'RECOVERY'   # L2 위, 5일선 위, 최근 2~3봉 회복
            else:
                continue

            current = {'date': win[last_index]['date'], 'price': last_close}
            left_peak = max_high_between(win, max(-1, i1 - 31), i1)

            # ---- 점수(100): 두 저점 유사도 20 · 저점 간격/구조 10 · 중간 반등폭 15 · L2 거래량 15 · L2 이후 저점 유지 15 · 넥라인 접근 15 · MA5/거래량 10
            sim_score = 20 if diff <= 0.01 else 15 if diff <= 0.02 else 10
            struct_score = 10 if 15 <= gap_days <= 35 else 7
            bounce_score = 15 if rebound >= 0.15 else 12 if rebound >= 0.10 else 9
            vol_score = 15 if vol2 <= vol1 else 10
            hold_score = 15 if (post_min is None or post_min >= min(low1, low2)) else 8
            if status == 'NECKLINE_READY':
                approach_score = 15 if proximity >= -0.01 else 12
            else:
                progress = max(0.0, min(1.0, (last_close - low2) / (neck['high'] - low2))) if neck['high'] > low2 else 0.0
                approach_score = int(round(4 + progress * 8))
            vol_ratio = volume_ratio_last(win)
            ma_vol_score = ((4 if (ma5_now is not None and last_close > ma5_now) else 0)
                            + (3 if (ma5_now is not None and ma5_prev is not None and ma5_now > ma5_prev) else 0)
                            + (3 if (vol_ratio is not None and vol_ratio >= 1.2) else 0))
            score = clamp_score(sim_score + struct_score + bounce_score + vol_score + hold_score + approach_score + ma_vol_score)
            reasons = [
                '두 저점 가격차 %.1f%%(%d/20점) · 저점 간격 %d봉(%d/10점)' % (diff * 100, sim_score, gap_days, struct_score),
                '넥라인 반등폭 %.1f%%(%d/15점)' % (rebound * 100, bounce_score),
                'L2 주변 거래량 L1의 %.0f%%(%d/15점) · L2 이후 저점 %s(%d/15점)' % (
                    vol2 / vol1 * 100, vol_score, '유지' if hold_score == 15 else '소폭 이탈', hold_score),
                '%s: 넥라인 대비 %+.1f%%(%d/15점) · MA5/거래량 확인(%d/10점)' % (
                    '넥라인 접근' if status == 'NECKLINE_READY' else '바닥 확인 후 회복', proximity * 100, approach_score, ma_vol_score),
            ]
            return {
                'status': status,
                'leftPeak': {'date': left_peak['date'], 'price': left_peak['high']} if left_peak else None,
                'low1': {'date': win[i1]['date'], 'price': low1},
                'low2': {'date': win[i2]['date'], 'price': low2},
                'neckline': {'date': neck['date'], 'price': neck['high']},
                'current': current,
                'signal': current,
                'breakout': False,
                'bottomDiffPct': round(diff * 100, 2),
                'reboundPct': round(rebound * 100, 2),
                'necklineDistancePct': round(proximity * 100, 2),
                'volumeRatioL2L1': round(vol2 / vol1, 2),
                'score': score,
                'reasons': reasons,
                'interpretation': '두 저점이 %.1f%% 차이의 쌍바닥이며 %s 상태입니다(%d점).' % (
                    diff * 100, '넥라인에 접근한' if status == 'NECKLINE_READY' else '두 번째 바닥 확인 뒤 회복 중인', score),
            }
    return None


# ---------------------------------------------------------------------------
# ③ 역헤드앤숄더(Inverse Head & Shoulders)
# ---------------------------------------------------------------------------

def detect_inv_head_shoulders(daily):
    """역헤드앤숄더: 왼쪽 어깨 -> 더 깊은 머리 -> 비슷한 높이의 오른쪽 어깨 -> 넥라인 접근/신규 돌파.

    장 마감 후 확정 일봉 기준. 넥라인은 N1(LS~HEAD 사이 최고점)과 N2(HEAD~RS 사이 최고점)를 잇는 기울어진 선을
    오늘까지 연장한 값이다(수평 max(N1,N2)는 neckline 필드에 호환용으로 남긴다).
    상태: BREAKOUT_NEW(최근 3거래일 내 첫 종가 돌파, 넥라인 +5% 이내) / NECKLINE_READY(종가가 넥라인 +-1%).
    """
    win = daily[max(0, len(daily) - IHS_WINDOW):]
    low_idxs = find_swing_indices(win, 'low', True)
    if len(low_idxs) < 3:
        return None
    last_index = len(win) - 1
    last_close = win[last_index]['close']
    avg_vol20 = avg_volume(win, max(0, len(win) - 21), len(win) - 1)   # 오늘 제외 직전 20봉 평균
    ma5 = moving_average(win, 'close', 5)

    # 가장 최근 저점부터 여러 조합을 확인해 중간 잡음 저점 때문에 패턴을 놓치지 않는다.
    for c in range(len(low_idxs) - 1, 1, -1):
        for b in range(c - 1, 0, -1):
            for a in range(b - 1, -1, -1):
                i_l, i_h, i_r = low_idxs[a], low_idxs[b], low_idxs[c]
                if last_index - i_r > IHS_RECENCY_MAX_GAP:
                    continue
                left_gap = i_h - i_l
                right_gap = i_r - i_h
                if left_gap < IHS_MIN_SHOULDER_GAP or right_gap < IHS_MIN_SHOULDER_GAP:
                    continue
                if left_gap > IHS_MAX_SHOULDER_GAP or right_gap > IHS_MAX_SHOULDER_GAP:
                    continue
                left, head, right = win[i_l]['low'], win[i_h]['low'], win[i_r]['low']
                if not (head < left and head < right):
                    continue
                if (left - head) / left < IHS_HEAD_MIN_DROP or (right - head) / right < IHS_HEAD_MIN_DROP:
                    continue
                shoulder_diff = abs(left - right) / min(left, right)
                if shoulder_diff > IHS_SHOULDER_TOL:
                    continue

                # RS 이후 저가가 머리보다 1% 넘게 내려가면 실패(새 저점 재형성)
                post_right_min = min_low_between(win, i_r, last_index)
                if post_right_min is not None and post_right_min < head * (1 - IHS_HEAD_BREAK_TOLERANCE):
                    continue

                n1 = max_high_between(win, i_l, i_h)
                n2 = max_high_between(win, i_h, i_r)
                if not n1 or not n2:
                    continue
                if (n1['high'] - head) / head < IHS_NECK_MIN_RISE or (n2['high'] - head) / head < IHS_NECK_MIN_RISE:
                    continue
                n1_idx = next(k for k in range(i_l + 1, i_h) if win[k]['date'] == n1['date'])
                n2_idx = next(k for k in range(i_h + 1, i_r) if win[k]['date'] == n2['date'])
                neck_slope = (n2['high'] - n1['high']) / (n2_idx - n1_idx)

                def neck_at(i):
                    return n1['high'] + neck_slope * (i - n1_idx)

                neck_today = neck_at(last_index)
                if neck_today <= 0:
                    continue
                proximity = (last_close - neck_today) / neck_today

                # 최근 회복 확인: 최근 2봉 중 양봉이 하나라도 있거나 오늘 종가가 어제보다 높다
                recent_ok = (any(win[k]['close'] > win[k]['open'] for k in (last_index - 1, last_index))
                             or last_close > win[last_index - 1]['close'])
                if not recent_ok:
                    continue

                # 상태 판정
                status = None
                breakout_idx = None
                if last_close > neck_today:
                    if proximity > IHS_MAX_BREAKOUT_EXTENSION:
                        continue   # 이미 넥라인 위로 크게 올라간 종목
                    for age in range(0, IHS_BREAKOUT_MAX_AGE):
                        j = last_index - age
                        if j - 1 < 0:
                            break
                        if win[j]['close'] > neck_at(j) and win[j - 1]['close'] <= neck_at(j - 1) and \
                                all(win[k]['close'] > neck_at(k) * 0.99 for k in range(j, last_index + 1)):
                            breakout_idx = j
                            break
                    if breakout_idx is not None:
                        status = 'BREAKOUT_NEW'
                if status is None:
                    if abs(proximity) <= IHS_NECK_READY_TOLERANCE:
                        status = 'NECKLINE_READY'
                    else:
                        continue

                vol_ratio = volume_ratio_last(win)
                current = {'date': win[last_index]['date'], 'price': last_close}
                neck_hi = n1 if n1['high'] >= n2['high'] else n2

                # ---- 점수(100): 머리 깊이 15 · 양 어깨 가격 대칭 20 · 시간 대칭 10 · 머리 저점 유지 15 · 넥라인 접근/돌파 20 · 가격 회복 10 · 거래량 10
                head_drop_avg = ((left - head) / left + (right - head) / right) / 2
                depth_score = 15 if head_drop_avg >= 0.05 else 11 if head_drop_avg >= 0.03 else 7   # 더 깊다고 계속 가산하지 않는다
                sym_score = 20 if shoulder_diff <= 0.02 else 12
                duration_ratio = max(left_gap, right_gap) / min(left_gap, right_gap)
                time_score = 10 if duration_ratio <= IHS_MAX_DURATION_RATIO else 5 if duration_ratio <= 3 else 2
                hold_score = 15 if (post_right_min is None or post_right_min >= head) else 8
                if status == 'BREAKOUT_NEW':
                    neck_score = 20 if proximity <= 0.03 else 14
                else:
                    neck_score = 20 if abs(proximity) <= 0.005 else 16
                ma5_now, ma5_prev = ma5[last_index], ma5[last_index - 1]
                recover_score = (5 if (ma5_now is not None and last_close > ma5_now) else 0) + \
                                (5 if (ma5_now is not None and ma5_prev is not None and ma5_now > ma5_prev) else 0)
                if vol_ratio is None:
                    vol_score = 2
                elif vol_ratio >= IHS_VOLUME_BONUS_2:
                    vol_score = 10
                elif vol_ratio >= IHS_VOLUME_BONUS_1:
                    vol_score = 7
                elif vol_ratio >= 1.0:
                    vol_score = 4
                else:
                    vol_score = 2
                score = clamp_score(depth_score + sym_score + time_score + hold_score + neck_score + recover_score + vol_score)
                reasons = [
                    '머리 하락폭 평균 %.1f%%(%d/15점) · 양 어깨 가격차 %.1f%%(%d/20점)' % (head_drop_avg * 100, depth_score, shoulder_diff * 100, sym_score),
                    '좌 %d봉·우 %d봉 시간 대칭(%d/10점) · RS 이후 머리 저점 %s(%d/15점)' % (
                        left_gap, right_gap, time_score, '유지' if hold_score == 15 else '소폭 이탈', hold_score),
                    '%s: 넥라인 대비 %+.1f%%(%d/20점) · 가격 회복 MA5(%d/10점)' % (
                        '신규 돌파' if status == 'BREAKOUT_NEW' else '넥라인 접근', proximity * 100, neck_score, recover_score),
                    '넥라인 접근·돌파 거래량 20일 평균 대비 %s(%d/10점)' % (('%.1f배' % vol_ratio) if vol_ratio is not None else '-', vol_score),
                ]
                return {
                    'status': status,
                    'left_shoulder': {'date': win[i_l]['date'], 'price': left},
                    'left_peak': {'date': n1['date'], 'price': n1['high']},
                    'head': {'date': win[i_h]['date'], 'price': head},
                    'right_peak': {'date': n2['date'], 'price': n2['high']},
                    'right_shoulder': {'date': win[i_r]['date'], 'price': right},
                    'neckline': {'date': neck_hi['date'], 'price': neck_hi['high']},       # 수평 fallback = max(N1, N2)
                    'neckline_line': [{'date': n1['date'], 'price': n1['high']},
                                      {'date': win[last_index]['date'], 'price': neck_today}],   # 기울어진 실제 넥라인(N1 -> 오늘)
                    'neckline_today': neck_today,
                    'current': current,
                    'signal': current,
                    'breakout': False,
                    'breakoutDate': win[breakout_idx]['date'] if breakout_idx is not None else None,
                    'necklineDistancePct': round(proximity * 100, 2),
                    'shoulderDiffPct': round(shoulder_diff * 100, 2),
                    'volumeRatio': round(vol_ratio, 2) if vol_ratio is not None else None,
                    'score': score,
                    'reasons': reasons,
                    'interpretation': '양 어깨 차이 %.1f%%의 역헤드앤숄더가 %s 상태입니다(%d점).' % (
                        shoulder_diff * 100, '넥라인을 새로 돌파한' if status == 'BREAKOUT_NEW' else '넥라인에 접근한', score),
                }
    return None


# ---------------------------------------------------------------------------
# ④ 박스권 하단(Box Range Low)
# ---------------------------------------------------------------------------

def _ma_near_count(fast_vals, slow_vals, tol):
    """두 이평선 리스트(moving_average 결과 - 앞쪽에 None이 섞여 있을 수 있음)에서
    둘 다 값이 있고 slow가 0이 아니며 상대 오차가 tol 이내인 봉 수를 센다(B 조건)."""
    fast = np.array([np.nan if v is None else v for v in fast_vals], dtype=float)
    slow = np.array([np.nan if v is None else v for v in slow_vals], dtype=float)
    valid = ~np.isnan(fast) & ~np.isnan(slow) & (slow != 0)
    with np.errstate(divide='ignore', invalid='ignore'):
        ratio = np.abs(np.where(valid, fast / slow, np.nan) - 1)
    return int(np.sum(valid & (ratio <= tol)))


def _ma_above_count(fast_vals, slow_vals):
    """두 이평선 리스트에서 둘 다 값이 있고 fast >= slow인 봉 수를 센다(G 조건)."""
    fast = np.array([np.nan if v is None else v for v in fast_vals], dtype=float)
    slow = np.array([np.nan if v is None else v for v in slow_vals], dtype=float)
    valid = ~np.isnan(fast) & ~np.isnan(slow)
    return int(np.sum(valid & (fast >= slow)))


def detect_box_range_low(daily, market_cap_eok=None, require_market_cap=False):
    """Detect the A~G box-range lower-zone formula.

    Market cap is fetched lazily by the live scanner only after the technical
    A~F pre-filter passes. ``require_market_cap=False`` is used for
    that pre-filter and by unit tests; production results always require G.

    2026-08-22: 라벨을 실제 코드 실행 순서에 맞춰 연속 알파벳(A~G)으로 재정렬했다
    (예전엔 A,B,C,D,E,G,J였고 순서도 실행 순서와 어긋나 있었음 - 로직·기준값은 안 바꿈,
    라벨과 reasons 배열 순서만 정리). grep으로 확인한 결과 옛 라벨 문자열을 다른 곳(JS/GAS/
    테스트)에서 참조하는 코드는 없었다.
    """
    win = daily[-BOX_WINDOW:]
    if len(win) < BOX_WINDOW:
        return None

    range_win = win[-20:]
    closes = np.array([row['close'] for row in range_win], dtype=float)
    lows = np.array([row['low'] for row in range_win], dtype=float)
    highs = np.array([row['high'] for row in range_win], dtype=float)
    last_close = float(closes[-1])
    close_min = float(closes.min())
    close_max = float(closes.max())
    close_range = (close_max - close_min) / close_min if close_min else math.inf
    if close_range > BOX_CLOSE_RANGE_MAX:
        return None
    wick_low, wick_high = float(lows.min()), float(highs.max())
    wick_range = (wick_high - wick_low) / wick_low if wick_low else math.inf   # 윗·아랫꼬리가 지나치게 크면 감점

    # 이평 응축: 5일선과 20일선이 서로 3% 이내인 봉이 3회 이상(횡보하며 이평이 얽힌 "압축된 박스")
    ma5_all = moving_average(daily, 'close', 5)
    ma20_all = moving_average(daily, 'close', 20)
    close_near_count = _ma_near_count(ma5_all[-20:], ma20_all[-20:], BOX_MA_NEAR_TOL)
    if close_near_count < BOX_MA_NEAR_COUNT:
        return None

    rsi = rsi_last(daily, BOX_RSI_PERIOD)
    if rsi is None or not (BOX_RSI_MIN <= rsi <= BOX_RSI_MAX):
        return None

    # 거래량: 최근 5봉 평균이 최근 20봉 평균의 50~120%(죽지도 폭증하지도 않은 횡보 거래량).
    # 예전 조건은 "20봉 전 하루 거래량 / 직전 5봉 평균"이라 박스 안의 거래량 흐름과 무관한 하루 값을 비교했다.
    vol20 = sum(r['volume'] for r in range_win) / 20
    vol5 = sum(r['volume'] for r in range_win[-5:]) / 5
    volume_ratio = (vol5 / vol20) if vol20 else math.inf
    if not (BOX_VOLUME_RATIO_MIN <= volume_ratio <= BOX_VOLUME_RATIO_MAX):
        return None
    last_bar = win[-1]
    if last_bar['close'] < last_bar['open'] and vol20 and last_bar['volume'] >= vol20 * BOX_PANIC_VOLUME_MULT:
        return None   # 박스 하단에서 거래량이 터진 하락봉은 지지가 아니라 투매

    # 계단식 하락 제외: 20일선이 10거래일 동안 3% 넘게 내려가는 종목
    ma20_now, ma20_prev = ma20_all[-1], ma20_all[-11]
    if not ma20_now or not ma20_prev:
        return None
    ma20_slope10 = (ma20_now - ma20_prev) / ma20_prev
    if ma20_slope10 < -BOX_MAX_MA20_DECLINE_10D:
        return None

    return_20 = last_close / win[0]['close'] - 1
    if abs(return_20) > BOX_RETURN_MAX:
        return None

    # 박스 = 최근 20봉 종가 범위. 위치 = (종가 - 최저 종가) / (최고 종가 - 최저 종가), 하단 35% 이내.
    support, resistance = close_min, close_max
    box_range = resistance - support
    if box_range <= 0:
        return None
    lower_position = (last_close - support) / box_range
    if lower_position < -0.02 or lower_position > BOX_LOWER_ZONE_RATIO:
        return None

    if market_cap_eok is None:
        if require_market_cap:
            return None
    elif market_cap_eok < BOX_MARKET_CAP_MIN_EOK:
        return None

    # ---- 하단 반등 판정: 최근 3봉 저가가 박스 하단(+2%)을 테스트한 뒤 종가가 회복(저가 +1% 이상) + 양봉 또는 전일 종가 상회
    prev_close = win[-2]['close']
    bullish = last_bar['close'] > last_bar['open']
    up_vs_prev = last_close > prev_close
    tested = any(win[k]['low'] <= close_min * (1 + BOX_SUPPORT_TEST_TOL) and win[k]['close'] > win[k]['low'] * 1.01
                 for k in range(len(win) - 3, len(win)))
    status = 'REBOUND' if (tested and (bullish or up_vs_prev)) else 'APPROACH'
    ma5_now, ma5_prev = ma5_all[-1], ma5_all[-2]

    # ---- 점수(100): 박스폭 안정성 20 · 박스 하단 위치 20 · 이평 응축 15 · RSI 10 · 거래량 안정 10 · MA20 추세 10 · 하단 지지/반등 15
    range_score = (14 - round(close_range / BOX_CLOSE_RANGE_MAX * 14)) + (6 if wick_range <= 0.15 else 3 if wick_range <= 0.20 else 0)
    position_score = 20 if lower_position <= 0.20 else 14
    ma_score = round(close_near_count / 20 * 15)
    rsi_score = 10 if rsi <= 50 else 7          # 35~50 하단 성격이 강함, 50~65 정상
    volume_score = 10 if 0.7 <= volume_ratio <= 1.0 else 7
    ma20_score = 10 if ma20_slope10 >= 0 else 7 if ma20_slope10 >= -0.015 else 4
    rebound_score = min(15, (5 if tested else 0) + (4 if bullish else 0) + (2 if up_vs_prev else 0)
                        + (2 if (ma5_now is not None and last_close > ma5_now) else 0)
                        + (2 if (ma5_now is not None and ma5_prev is not None and ma5_now >= ma5_prev) else 0))
    score = clamp_score(range_score + position_score + ma_score + rsi_score + volume_score + ma20_score + rebound_score)
    reasons = [
        'A 최근 20봉 종가 변동폭 %.1f%% (10%% 이하)·꼬리 포함 %.1f%%(%d/20점)' % (close_range * 100, wick_range * 100, range_score),
        'B 5·20일선 3%% 이내 응축 %d회(%d/15점) · 박스 하단 %.0f%%(%d/20점)' % (close_near_count, ma_score, lower_position * 100, position_score),
        'C RSI(14) %.1f (35~65)(%d/10점)' % (rsi, rsi_score),
        'D 최근 5봉/20봉 평균 거래량 %.0f%% (50~120%%)(%d/10점)' % (volume_ratio * 100, volume_score),
        'E 20일선 10일 기울기 %+.1f%% (-3%% 이상)(%d/10점)' % (ma20_slope10 * 100, ma20_score),
        'F 20봉 수익률 %.1f%% (±10%% 이내) · 하단 %s(%d/15점)' % (return_20 * 100, '반등 확인' if status == 'REBOUND' else '접근', rebound_score),
        'G 시가총액 %.0f억원 (3000억원 이상)' % market_cap_eok if market_cap_eok is not None else 'G 시가총액 확인 대기',
    ]
    result = {
        'status': status,
        'support': support,
        'resistance': resistance,
        'wickLow': wick_low,
        'wickHigh': wick_high,
        'signal': {'date': win[-1]['date'], 'price': last_close},
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '최근 20봉 횡보 박스의 하단 %.1f%% 구간에서 %s 상태입니다(%d점).' % (
            lower_position * 100, '하단을 테스트한 뒤 반등하는' if status == 'REBOUND' else '하단에 접근한', score),
        'criteria': {
            'closeRangePct': close_range * 100,
            'wickRangePct': wick_range * 100,
            'closeMaNearCount': close_near_count,
            'rsi14': rsi,
            'volumeRatioPct': volume_ratio * 100,
            'marketCapEok': market_cap_eok,
            'ma20Slope10Pct': ma20_slope10 * 100,
            'return20Pct': return_20 * 100,
            'lowerPositionPct': lower_position * 100,
        },
    }
    # 2026-08-22 신설(작업지시서 3단계): 박스 하단 Zone 안에서도 지금이 실제 진입 타점인지는
    # 별개 판단이라 check_box_range_low_entry_trigger()로 분리 계산 후 결과를 붙인다.
    entry_trigger = check_box_range_low_entry_trigger(daily, result)
    result['entryTrigger'] = entry_trigger
    result['entrySignal'] = bool(entry_trigger and entry_trigger.get('entry_signal'))
    return result


def check_box_range_low_entry_trigger(daily, box_result):
    """박스권 하단 Zone 안에서 실제로 반등을 시도하는 "진입 타점"인지 확인한다(작업지시서
    2단계). detect_box_range_low()가 이미 통과시킨 종목이라도 지금 이 순간이 진짜 매수
    시점인지는 별개 판단이라 분리했다 - 캔들/거래량/이평선 3개 신호 중 2개 이상 충족해야
    entry_signal=True.

    box_result는 detect_box_range_low()의 리턴값(support/resistance 필요)이거나
    그와 동일한 키를 가진 dict.
    """
    if not box_result or not daily:
        return None

    support = box_result.get('support')
    resistance = box_result.get('resistance')
    if support is None or resistance is None:
        return None
    box_height = resistance - support
    if box_height <= 0:
        return None

    last = daily[-1]
    last_close = last['close']
    # 1) 영역 확인: 박스 하단 Zone(박스 높이 비율 기준, detect_box_range_low와 동일 공식) 안인지.
    zone_position = (last_close - support) / box_height
    if zone_position < -0.02 or zone_position > BOX_LOWER_ZONE_RATIO:
        return None

    # 2) 반등 신호 3종
    # ① 캔들: 양봉(종가>시가) 또는 망치형(아래꼬리 >= 몸통 x 2)
    body = abs(last['close'] - last['open'])
    lower_wick = min(last['open'], last['close']) - last['low']
    is_bullish = last['close'] > last['open']
    is_hammer = body > 0 and lower_wick >= body * BOX_ENTRY_HAMMER_WICK_MULT
    candle_signal = bool(is_bullish or is_hammer)

    # ② 거래량: 당일 거래량이 직전 5봉 평균 대비 BOX_ENTRY_VOLUME_MULT(1.3)배 이상
    n = len(daily)
    volume_signal = False
    if n >= 6:
        avg5_volume = avg_volume(daily, n - 6, n - 1)
        volume_signal = bool(avg5_volume and last['volume'] >= avg5_volume * BOX_ENTRY_VOLUME_MULT)

    # ③ 이평선: 5일선 상향 돌파(전일 종가<5일선 -> 당일 종가>=5일선) 또는 당일 고가가
    # 5일선 BOX_ENTRY_MA5_NEAR_TOL(1%) 이내 근접
    ma5 = moving_average(daily, 'close', 5)
    ma5_now = ma5[-1] if ma5 else None
    ma5_prev = ma5[-2] if n >= 2 and len(ma5) >= 2 else None
    prev_close = daily[-2]['close'] if n >= 2 else None
    cross_up = bool(
        ma5_prev is not None and prev_close is not None and ma5_now is not None
        and prev_close < ma5_prev and last_close >= ma5_now
    )
    near_ma5 = bool(ma5_now and abs(last['high'] - ma5_now) / ma5_now <= BOX_ENTRY_MA5_NEAR_TOL)
    ma5_signal = bool(cross_up or near_ma5)

    signals_met = sum(1 for s in (candle_signal, volume_signal, ma5_signal) if s)
    entry_signal = signals_met >= 2

    reasons = []
    if candle_signal:
        reasons.append('당일 양봉 또는 망치형 캔들 확인')
    if volume_signal:
        reasons.append('거래량이 직전 5봉 평균 대비 %.0f%% 이상' % (BOX_ENTRY_VOLUME_MULT * 100))
    if ma5_signal:
        reasons.append('5일선 상향 돌파 또는 1% 이내 근접')

    return {
        'in_zone': True,
        'zone_position_pct': zone_position * 100,
        'candle_signal': candle_signal,
        'volume_signal': volume_signal,
        'ma5_signal': ma5_signal,
        'signals_met': signals_met,
        'entry_signal': entry_signal,
        'reasons': reasons,
    }


# ---------------------------------------------------------------------------
# ⑤ 눌림목(Pullback)
# ---------------------------------------------------------------------------

def detect_first_pullback_breakout(daily):
    """Daily close confirmation of the first quiet pullback after a volume breakout.

    Uses only the supplied bars. These are screening rules, not an estimated
    win rate. Repeated breakouts after an earlier pullback are deliberately excluded.
    """
    if len(daily) < 65:
        return None
    # Only a small recent window is inspected; reuse the existing daily batch.
    win = daily[-85:]
    last = win[-1]
    if any(not row.get(k) or row[k] <= 0 for row in win
           for k in ('open', 'high', 'low', 'close')):
        return None
    ma20 = moving_average(win, 'close', 20)
    ma60 = moving_average(win, 'close', 60)
    if not (last['close'] > ma20[-1] > ma60[-1] and ma20[-1] > ma20[-6]):
        return None
    for anchor in range(max(20, len(win) - 16), len(win) - 3):
        base = win[anchor - 20:anchor]
        base_volume = sum(row.get('volume', 0) for row in base) / 20
        if base_volume <= 0:
            continue
        impulse = win[anchor]
        if not (impulse['close'] > max(row['high'] for row in base)
                and impulse.get('volume', 0) >= base_volume * 1.5
                and impulse['close'] > impulse['open']):
            continue
        peak_index = max(range(anchor, len(win) - 1), key=lambda i: win[i]['high'])
        correction = win[peak_index + 1:-1]
        if not (2 <= len(correction) <= 8 and peak_index - anchor <= 5):
            continue
        # The ascent must not already contain a meaningful correction.
        running_high = impulse['high']
        earlier_pullback = False
        for row in win[anchor + 1:peak_index + 1]:
            if row['close'] < running_high * 0.98:
                earlier_pullback = True
                break
            running_high = max(running_high, row['high'])
        if earlier_pullback:
            continue
        # A prior rebreak within the correction makes today's move a later entry.
        if any(win[i]['close'] > max(row['high'] for row in win[i - 3:i])
               for i in range(peak_index + 4, len(win) - 1)):
            continue
        low_row = min(correction, key=lambda row: row['low'])
        support = low_row['low']
        peak = win[peak_index]
        drop_pct = (peak['high'] - support) / peak['high'] * 100
        impulse_volume = sum(row.get('volume', 0) for row in win[anchor:peak_index + 1]) / (peak_index - anchor + 1)
        quiet_volume = sum(row.get('volume', 0) for row in correction) / len(correction)
        if not (2 <= drop_pct <= 12 and support > min(row['low'] for row in base)
                and quiet_volume > 0 and quiet_volume <= impulse_volume * 0.8):
            continue
        resistance = max(row['high'] for row in correction[-3:])
        volume_ratio = last.get('volume', 0) / base_volume
        if not (last['close'] > resistance and last['close'] > last['open']
                and last['low'] >= support and win[-2]['close'] <= resistance
                and volume_ratio >= 1.2 and last.get('volume', 0) >= quiet_volume * 1.5
                and (last['close'] / resistance - 1) <= 0.03):
            continue
        quiet_ratio = quiet_volume / impulse_volume
        score = min(100, 75 + (10 if quiet_ratio <= 0.5 else 5)
                    + (10 if volume_ratio >= 2 else 5)
                    + (5 if last['close'] >= peak['high'] else 0))
        point = lambda row, field: {'date': row['date'], 'price': row[field]}
        return {
            'score': score, 'status': 'BREAKOUT_CONFIRMED', 'breakout': True,
            'rise_start': point(win[anchor - 1], 'close'),
            'peak': point(peak, 'high'), 'pullback_low': point(low_row, 'low'),
            'signal': point(last, 'close'), 'current': point(last, 'close'),
            'resistance': resistance, 'support': support,
            'pullbackDays': len(correction), 'pullbackPct': round(drop_pct, 2),
            'pullbackVolumeRatio': round(quiet_ratio, 3),
            'volumeRatio': round(volume_ratio, 3),
            'supportDistancePct': round((last['close'] - support) / last['close'] * 100, 2),
            'reasons': ['20일 고가 돌파와 거래량 1.5배 이상',
                        '첫 조정 %d봉 · 상승 구간 대비 거래량 %.0f%%' % (len(correction), quiet_ratio * 100),
                        '최근 3봉 고가를 종가로 재돌파 · 거래량 %.1f배' % volume_ratio],
            'interpretation': '일봉 기준 첫 눌림 뒤 거래량을 동반한 재돌파가 확인됐습니다. 눌림 저점 %.0f원 이탈 여부를 확인하세요.' % support,
        }
    return None


def detect_pullback(daily):
    win = daily[max(0, len(daily) - PULLBACK_WINDOW):]
    n = len(win)
    if n < 240:
        return None

    ma20 = moving_average(win, 'close', 20)
    ma240 = moving_average(win, 'close', 240)

    recent_start = max(0, n - PULLBACK_LOOKBACK - 5)
    # 2026-08-21: 최고가/직전 최저가를 찾는 두 루프를 numpy argmax/argmin으로 벡터화.
    # 동점일 때 가장 이른 인덱스를 취하는 것까지 argmax/argmin의 기본 동작과 동일하다
    # (원래 '>'/'<' 엄격 비교 루프와 같은 결과 - test/test_pattern_detect.py +
    # 회귀 스크립트로 확인).
    recent_closes = np.array([row['close'] for row in win[recent_start:n]], dtype=float)
    peak_local = int(np.argmax(recent_closes))
    peak_idx = recent_start + peak_local
    if (n - 1) - peak_idx > PULLBACK_LOOKBACK:
        return None

    # 2026-08-22 개편: 저점 탐색을 "오늘 기준" 창(recent_start)이 아니라 "고점 기준"
    # 과거 PULLBACK_LOW_SEARCH_WINDOW(25)봉으로 제한 - 고점이 탐색창 이른 쪽에 있을 때
    # 저점 탐색 구간이 뜻하지 않게 좁아지거나(반대로 넓어지거나) 하는 것을 막고, 항상
    # "고점 직전 일정 기간"의 저점만 상승폭 계산에 쓰이게 한다.
    low_search_start = max(0, peak_idx - PULLBACK_LOW_SEARCH_WINDOW)
    low_search_closes = np.array([row['close'] for row in win[low_search_start:peak_idx + 1]], dtype=float)
    low_local = int(np.argmin(low_search_closes))
    low_idx = low_search_start + low_local
    if low_idx >= peak_idx:
        return None

    low_close = win[low_idx]['close']
    peak_close = win[peak_idx]['close']
    rise_ratio = (peak_close - low_close) / low_close
    if rise_ratio < PULLBACK_MIN_RISE:
        return None

    last_close = win[n - 1]['close']
    drop_ratio = (peak_close - last_close) / peak_close
    if drop_ratio < PULLBACK_MIN_DROP or drop_ratio > PULLBACK_MAX_DROP:
        return None

    ma5 = moving_average(win, 'close', 5)
    ma20_now = ma20[n - 1]
    ma240_now = ma240[n - 1]
    diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now else math.inf
    diff240 = abs(last_close - ma240_now) / ma240_now if ma240_now else math.inf
    if diff20 > PULLBACK_MA_TOL and diff240 > PULLBACK_MA_TOL:
        return None

    # 2026-08-22 개편: "20일선 상승 중" 단일 조건을 두 버전 중 선택 가능하게 바꿈(사용자
    # 요청, 백테스트로 비교 후 확정 예정) - PULLBACK_TREND_FILTER_VERSION으로 전환.
    # A) ma5_above_ma20: 5일선이 20일선 위(정배열 초입) - 역배열 상태의 단기 반등을 배제.
    # B) ma20_slope_tol: 20일선 기울기가 PULLBACK_MA20_SLOPE_TOL(-0.5%) 이내(완만한
    #    하락까지 허용) - 예전 "무조건 상승"보다 느슨함.
    ma5_now = ma5[n - 1]
    ma20_slope_from = ma20[n - 1 - MA_SLOPE_LOOKBACK]
    if PULLBACK_TREND_FILTER_VERSION == 'ma5_above_ma20':
        if ma5_now is None or ma20_now is None or ma5_now < ma20_now:
            return None
    else:
        if ma20_now is None or ma20_slope_from is None:
            return None
        ma20_slope = (ma20_now - ma20_slope_from) / ma20_slope_from if ma20_slope_from else -math.inf
        if ma20_slope < PULLBACK_MA20_SLOPE_TOL:
            return None

    # ---- 2026-10-04 개편 ----
    # 선행 상승이 하루이틀 급등만으로 만들어졌다면(3봉 미만) 신뢰도가 낮아 제외한다.
    if peak_idx - low_idx < PULLBACK_MIN_RISE_BARS:
        return None
    if rise_ratio > PULLBACK_MAX_RISE:
        return None
    # 눌림 과정에서 선행 저점 L을 종가로 깨면 눌림이 아니라 상승 추세 훼손
    if min(row['close'] for row in win[peak_idx + 1:n]) < low_close:
        return None
    # 이미 고점 근처(98%)까지 되올라온 종목은 눌림 타점이 아니다(조정폭 5% 하한과 같은 의미지만 명시적으로 확인)
    if last_close >= peak_close * PULLBACK_LATE_RECOVERY:
        return None

    # 거래량: 상승구간 평균과 조정구간 평균을 비교(조정 평균 < 상승 평균이 주 조건). 상승구간 거래량 증가·조정구간 최고
    # 거래량 70% 이하는 가산 요소로만 쓴다.
    rise_vols = [row['volume'] for row in win[low_idx:peak_idx + 1]]
    drop_vols = [row['volume'] for row in win[peak_idx + 1:n]]
    before_vols = [row['volume'] for row in win[max(0, low_idx - (peak_idx - low_idx)):low_idx]]
    avg_rise_vol = sum(rise_vols) / len(rise_vols) if rise_vols else 0
    avg_drop_vol = sum(drop_vols) / len(drop_vols) if drop_vols else 0
    avg_before_vol = sum(before_vols) / len(before_vols) if before_vols else 0
    if not avg_rise_vol or avg_drop_vol >= avg_rise_vol:
        return None
    rise_vol_gain = (avg_rise_vol / avg_before_vol) if avg_before_vol else None
    max_rise_vol = max(rise_vols) if rise_vols else 0
    max_drop_vol = max(drop_vols) if drop_vols else 0
    max_vol_ok = (max_rise_vol <= 0) or (max_drop_vol <= max_rise_vol * PULLBACK_MAX_VOL_RATIO)

    # 2026-08-22 신설(현재 비활성, PULLBACK_MIN_TRADING_VALUE=0): 거래대금 필터 - 근거
    # 부족으로 지금은 값을 안 넣었다. 나중에 상수를 채우면 자동으로 활성화된다.
    if PULLBACK_MIN_TRADING_VALUE > 0:
        last_trading_value_eok = (win[n - 1]['close'] * win[n - 1]['volume']) / 1e8
        if last_trading_value_eok < PULLBACK_MIN_TRADING_VALUE:
            return None

    # 어느 이평에 눌렸는가: 20일선 / 240일선 / 두 이평이 서로 가까운 응축 눌림
    near20, near240 = diff20 <= PULLBACK_MA_TOL, diff240 <= PULLBACK_MA_TOL
    ma_cluster = bool(ma20_now and ma240_now and abs(ma20_now - ma240_now) / ma240_now <= PULLBACK_MA_CLUSTER)
    if near20 and near240 and ma_cluster:
        support_kind = 'MA20+MA240'
    elif near20 and (not near240 or diff20 <= diff240):
        support_kind = 'MA20'
    else:
        support_kind = 'MA240'
    support_price = ma20_now if support_kind != 'MA240' else ma240_now

    # 상태: 지지 확인(최근 3봉 저가가 지지 이평 +1% 이내를 테스트한 뒤 종가가 이평 위/근처로 회복 + 양봉 또는 전일 대비 상승) / 눌림 진행
    prev_close = win[n - 2]['close']
    last_bar = win[n - 1]
    bullish = last_bar['close'] > last_bar['open']
    tested = any(win[k]['low'] <= support_price * (1 + PULLBACK_SUPPORT_TEST_TOL) for k in range(n - 3, n))
    confirmed = bool(tested and last_close >= support_price * 0.99 and (bullish or last_close > prev_close))
    status = 'SUPPORT_CONFIRMED' if confirmed else 'PULLING_BACK'
    ma5_prev = ma5[n - 2]

    # ---- 점수(100): 선행 상승 강도 20 · 조정폭 적정 15 · MA20/MA240 근접 20 · MA 방향 10 · 상승구간 거래량 증가 10 · 조정구간 거래량 감소 15 · 지지/반등 확인 10
    rise_score = 20 if rise_ratio >= 0.25 else 15 if rise_ratio >= 0.20 else 10
    drop_score = 15 if (0.07 <= drop_ratio <= 0.12) else 10
    ma_score = 20 if (near20 and near240) else 14
    if ma_cluster and ma_score < 20:
        ma_score += 3
    ma20_slope_pct = ((ma20_now - ma20_slope_from) / ma20_slope_from) if ma20_slope_from else 0.0
    dir_score = 10 if ma20_slope_pct >= 0 else 6
    rise_vol_score = 10 if (rise_vol_gain is not None and rise_vol_gain >= PULLBACK_RISE_VOLUME_GAIN) else 5
    drop_vol_score = (10 if avg_drop_vol <= avg_rise_vol * 0.7 else 7) + (5 if max_vol_ok else 0)
    rebound_score = min(10, (4 if bullish else 0) + (2 if last_close > prev_close else 0) + (2 if tested else 0)
                        + (2 if (ma5_now is not None and ma5_prev is not None and ma5_now > ma5_prev) else 0))
    score = clamp_score(rise_score + drop_score + ma_score + dir_score + rise_vol_score + drop_vol_score + rebound_score)
    ma_label = '20일선' if support_kind == 'MA20' else '1년선(240일선)' if support_kind == 'MA240' else '20일선·240일선 응축'
    reasons = [
        '선행 상승 %.1f%%(%d봉, %d/20점) · 고점 대비 조정 %.1f%%(%d/15점)' % (
            rise_ratio * 100, peak_idx - low_idx, rise_score, drop_ratio * 100, drop_score),
        '%s 근접(MA20 %.1f%%·MA240 %.1f%%, %d/20점) · 20일선 5일 기울기 %+.1f%%(%d/10점)' % (
            ma_label, (diff20 if diff20 != math.inf else 0) * 100, (diff240 if diff240 != math.inf else 0) * 100,
            ma_score, ma20_slope_pct * 100, dir_score),
        '상승구간 거래량 %s(%d/10점) · 조정구간 평균 거래량 상승구간의 %.0f%%(%d/15점)' % (
            ('직전의 %.1f배' % rise_vol_gain) if rise_vol_gain is not None else '비교 불가', rise_vol_score,
            avg_drop_vol / avg_rise_vol * 100, drop_vol_score),
        '%s(%d/10점)' % ('지지 확인(이평 테스트 후 회복)' if confirmed else '눌림 진행 중(뚜렷한 반등 전)', rebound_score),
    ]

    result = {
        'rise_start': {'date': win[low_idx]['date'], 'price': low_close},
        'peak': {'date': win[peak_idx]['date'], 'price': peak_close},
        'current': {'date': win[n - 1]['date'], 'price': last_close},
        'signal': {'date': win[n - 1]['date'], 'price': last_close},
        'ma20': ma20_now,
        'ma240': ma240_now,
        'status': status,
        'supportKind': support_kind,
        'risePct': round(rise_ratio * 100, 2),
        'pullbackPct': round(drop_ratio * 100, 2),
        'ma20Slope5Pct': round(ma20_slope_pct * 100, 2),
        'breakout': False,
        'score': score,
        'reasons': reasons,
        'interpretation': '%.1f%% 상승 후 %.1f%% 눌림목 조정을 받아 %s 부근에서 %s 구간입니다(%d점).'
                           % (rise_ratio * 100, drop_ratio * 100, ma_label, '지지가 확인된' if confirmed else '지지를 시도하는', score),
    }
    # 2026-08-22 신설(작업지시서 4단계): 눌림목 지지선 근접 상태에서도 지금이 실제 진입
    # 타점인지는 별개 판단이라 check_pullback_entry_trigger()로 분리(박스권의
    # check_box_range_low_entry_trigger와 동일한 구조로 통일).
    entry_trigger = check_pullback_entry_trigger(daily, result)
    result['entryTrigger'] = entry_trigger
    result['entrySignal'] = bool(entry_trigger and entry_trigger.get('entry_signal'))
    return result


def check_pullback_entry_trigger(daily, pullback_result):
    """눌림목 지지선(20일선 또는 240일선) 근처에서 실제로 반등을 시도하는 "진입 타점"인지
    확인한다(작업지시서 4단계). detect_pullback()이 이미 통과시킨 종목이라도 지금 이
    순간이 진짜 매수 시점인지는 별개 판단이라 분리했다 - 지지선 근접 상태(Zone)를 먼저
    확인하고, 그 안에서 아래꼬리 캔들 또는 양봉 전환 중 하나만 있어도 entry_signal=True
    (박스권과 달리 "2개 중 1개"만 있으면 됨 - 지시서 문구 그대로).

    pullback_result는 detect_pullback()의 리턴값(ma20/ma240 필요)이거나 동일한 키를
    가진 dict."""
    if not pullback_result or not daily:
        return None

    ma20_now = pullback_result.get('ma20')
    ma240_now = pullback_result.get('ma240')
    last = daily[-1]
    last_close = last['close']

    diff20 = abs(last_close - ma20_now) / ma20_now if ma20_now else math.inf
    diff240 = abs(last_close - ma240_now) / ma240_now if ma240_now else math.inf
    if diff20 > PULLBACK_MA_TOL and diff240 > PULLBACK_MA_TOL:
        return None
    if diff20 <= diff240:
        support_label, support_price = '20일선', ma20_now
    else:
        support_label, support_price = '1년선(240일선)', ma240_now

    # ① 아래꼬리 캔들: 아래꼬리가 몸통의 PULLBACK_ENTRY_WICK_MULT(2.0)배 이상
    body = abs(last['close'] - last['open'])
    lower_wick = min(last['open'], last['close']) - last['low']
    wick_signal = bool(body > 0 and lower_wick >= body * PULLBACK_ENTRY_WICK_MULT)

    # ② 양봉 전환: 당일 종가 > 시가
    bullish_signal = bool(last['close'] > last['open'])

    entry_signal = bool(wick_signal or bullish_signal)

    reasons = []
    if wick_signal:
        reasons.append('아래꼬리가 몸통의 %.1f배 이상(지지 확인)' % PULLBACK_ENTRY_WICK_MULT)
    if bullish_signal:
        reasons.append('당일 양봉 전환')

    return {
        'in_zone': True,
        'support_label': support_label,
        'support_price': support_price,
        'wick_signal': wick_signal,
        'bullish_signal': bullish_signal,
        'entry_signal': entry_signal,
        'reasons': reasons,
    }


def check_market_regime(index_daily, ma_period=20):
    """2026-08-22 신설(작업지시서 6단계, 아직 호출부 없음) - "KOSPI/KOSDAQ 20일선 위에서만
    매매"를 개별 종목 판정(detect_pullback 등)과 분리해 시장 국면만 독립적으로 판단하는
    함수. 스캐너 실행 파이프라인 상위 단계(daily_scan.py 등)에서 KOSPI/KOSDAQ 지수
    일봉을 받아 호출하도록 설계했지만, 지수 데이터를 어디서 받아올지(키움 지수 TR 등)는
    이번 작업 범위 밖이라 실제 연결은 아직 안 했다 - 함수만 준비."""
    if not index_daily or len(index_daily) < ma_period:
        return None
    ma = moving_average(index_daily, 'close', ma_period)
    ma_now = ma[-1]
    last_close = index_daily[-1]['close']
    if ma_now is None:
        return None
    return {
        'above_ma': bool(last_close >= ma_now),
        'ma_period': ma_period,
        'ma_value': ma_now,
        'last_close': last_close,
    }


def scan_stock(stock, daily, pattern_results, pullback_matches, market_cap_getter=None,
               require_common_market_cap=False):
    """단일 종목의 daily(OHLC)로 6종 패턴을 판정해 pattern_results/pullback_matches에
    append(둘 다 호출부가 미리 만들어서 넘긴 딕셔너리/리스트를 in-place로 채움).
    daily_scan.py(키움 API 기반)와 rescan_patterns.py(SQLite 기반)가 이 함수를 공유해서
    판정 로직이 두 곳에서 따로 관리되다 어긋나는 걸 방지한다.
    ``require_common_market_cap``은 운영 스캔에서만 True로 켠다. 테스트처럼
    시가총액 데이터가 없는 호출은 기존처럼 기술식만 검증할 수 있고, 운영 경로는
    시가총액을 확인하지 못한 종목도 후보로 내보내지 않는다.
    반환값: (패턴 스캔 대상이었는지, 눌림목 스캔 대상이었는지)."""
    pattern_scanned = False
    pullback_scanned = False
    pattern_results.setdefault('maCloudBreakout', [])
    pattern_results.setdefault('openingGap', [])
    pattern_results.setdefault('shortTermMaBreakout', [])
    pattern_results.setdefault('firstPullbackBreakout', [])
    if is_excluded_stock(stock, daily):
        return pattern_scanned, pullback_scanned

    market_cap_eok = stock.get('market_cap_eok')

    def common_search_ok():
        """패턴이 실제로 잡힌 종목에 한해 시총을 확인하는 공통 하드필터."""
        nonlocal market_cap_eok
        if not require_common_market_cap:
            return True
        if market_cap_eok is None and market_cap_getter:
            market_cap_eok = market_cap_getter(stock['code'])
            stock['market_cap_eok'] = market_cap_eok
        try:
            return market_cap_eok is not None and float(market_cap_eok) >= COMMON_MARKET_CAP_MIN_EOK
        except (TypeError, ValueError):
            return False

    if len(daily) >= 2:
        pattern_scanned = True
        opening_gap = detect_opening_gap(daily)
        if opening_gap and common_search_ok():
            pattern_results['openingGap'].append(build_pattern_match(stock, daily, opening_gap))

    if len(daily) >= RISING_LOWS_WINDOW + RISING_LOWS_DECLINE_LOOKBACK:
        pattern_scanned = True
        rl = detect_rising_lows(daily)
        if rl and not rl['breakout'] and common_search_ok():
            pattern_results['risingLows'].append(build_pattern_match(stock, daily, rl))

    if len(daily) >= SHORT_MA_BREAKOUT_WINDOW:
        pattern_scanned = True
        short_ma = detect_short_ma_breakout(daily)
        if short_ma and not short_ma['breakout'] and common_search_ok():
            pattern_results['shortTermMaBreakout'].append(build_pattern_match(stock, daily, short_ma))

    if len(daily) >= MA_CLOUD_MIN_DAYS:
        pattern_scanned = True
        ma_cloud = detect_ma_cloud_breakout(daily)
        if ma_cloud and common_search_ok():
            pattern_results['maCloudBreakout'].append(build_pattern_match(stock, daily, ma_cloud))

    if len(daily) >= BOX_WINDOW:
        db = detect_double_bottom(daily)
        if db and not db['breakout'] and pattern_grade(db['score']) and common_search_ok():
            pattern_results['doubleBottom'].append(build_pattern_match(stock, daily, db))

        ihs = detect_inv_head_shoulders(daily)
        if ihs and not ihs['breakout'] and pattern_grade(ihs['score'], IHS_MIN_SCORE) and common_search_ok():
            pattern_results['invHeadShoulders'].append(build_pattern_match(stock, daily, ihs))

        box = detect_box_range_low(
            daily,
            market_cap_eok=market_cap_eok,
            require_market_cap=market_cap_getter is None,
        )
        if box and box.get('criteria', {}).get('marketCapEok') is None and market_cap_getter:
            market_cap_eok = market_cap_getter(stock['code'])
            stock['market_cap_eok'] = market_cap_eok
            box = detect_box_range_low(daily, market_cap_eok=market_cap_eok, require_market_cap=True)
        if box and common_search_ok():
            pattern_results['boxRangeLow'].append(build_pattern_match(stock, daily, box))

    if len(daily) >= 65:
        pattern_scanned = True
        first_pullback = detect_first_pullback_breakout(daily)
        if first_pullback and common_search_ok():
            pattern_results['firstPullbackBreakout'].append(build_pattern_match(stock, daily, first_pullback))

    if len(daily) >= PULLBACK_MIN_DAYS:
        pullback_scanned = True
        pullback = detect_pullback(daily)
        if pullback and pattern_grade(pullback['score'], PULLBACK_MIN_SCORE) and common_search_ok():
            pullback_matches.append(build_pattern_match(stock, daily, pullback))

    return pattern_scanned, pullback_scanned


def _rank_matches(matches):
    """Sort survivors for readability without removing any by scan order."""
    matches = matches or []
    matches.sort(key=lambda item: item.get('code') or '')
    matches.sort(key=lambda item: item.get('date') or '', reverse=True)
    matches.sort(key=lambda item: item.get('score') or 0, reverse=True)
    return matches


def finalize_pattern_results(pattern_results, pullback_matches=None):
    """Apply staged chart-quality gates after the full universe scan.

    Buckets with 20 or fewer candidates are kept intact. Larger buckets are
    tightened using pattern-specific chart evidence until they fit; no bucket
    is truncated by universe order.
    """
    for key in ('risingLows', 'shortTermMaBreakout', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'boxRangeLow', 'openingGap', 'firstPullbackBreakout'):
        if key in pattern_results:
            filtered = _quality_gate_matches(pattern_results.get(key), key)
            pattern_results[key] = _rank_matches(filtered)
    if pullback_matches is not None:
        pullback_matches[:] = _rank_matches(_quality_gate_matches(pullback_matches, 'pullback'))
    return pattern_results
