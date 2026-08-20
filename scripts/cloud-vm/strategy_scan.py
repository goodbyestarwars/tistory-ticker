# -*- coding: utf-8 -*-
"""저평가 종목 스캔 - 전종목(data/krx_map.js, ~2,691개)에서 "우량한데 가격이 눌려있는"
종목을 찾아 WICS 대분류 섹터(data/wics-map.js)별로 묶어 캐시한다.

2026-08 전면 개편: 기존 kisyaml 프리셋 전략 10개(scripts/cloud-vm/strategies/*.kis.yaml)는
전부 entry.logic: AND라 "매칭된 종목은 조건을 전부 충족한 것"이 구조적으로 항상 참이 되어
confidence/matched·total이 종목마다 다르게 나올 수가 없었다(늘 100%) - 게다가 단일 지표
스크리너 10개를 그대로 쓰다 보니 "그냥 코스피 목록에서 아무거나 찍는 것과 다를 게 없다"는
피드백을 받았다. 프리셋을 전부 폐기(strategies/ 디렉터리 삭제)하고 완전히 다른 데이터
모델로 다시 만들었다 - kisyaml_strategy.py 엔진(OHLC 지표 조건 평가 전용)은 이번 "저평가"
정의(펀더멘탈 + 가격 조합)를 표현할 수 없어 이 스크립트는 더 이상 그 엔진을 쓰지 않는다.
엔진 코드 자체는 재사용 가능성 때문에 저장소에 남겨뒀다(다른 곳에서 안 씀).

"저평가" 정의(잠정 - 데이터로 재현 가능한 명시적 기준이지 백테스트로 검증된 공식이 아니다):
  1. 품질 게이트: invest_signal.compute_fundamental_score(DART 연간 ROE 60% + 부채비율 40%,
     daily_scan.py의 투자시그널 펀더멘탈 점수와 동일한 이미 검증·운영 중인 공식)가
     FUNDAMENTAL_SCORE_MIN 이상. "저평가"이려면 먼저 "우량"해야 한다는 뜻 - 실적이 나쁜데
     싼 건 저평가가 아니라 밸류트랩일 수 있어서, 새 품질 공식을 만드는 대신 이미 서비스
     중인 펀더멘탈 점수를 그대로 재사용한다.
  2. 가격 게이트: 120일 이동평균 대비 이격도(disparity)가 DISPARITY_MAX 이하. "제 가격
     흐름 대비 눌려있다"를 근사한다 - 이 스캔은 PER/PBR(주가 대비 밸류에이션)을 기준으로
     쓰지 않는다. (2026-08-20 정정: 여기 원래 "이 프로젝트엔 PER/PBR 데이터가 없다"고
     적혀 있었는데 부정확했다 - js/foreign-flow.js 종목분석 펀더멘탈 탭은 GAS
     getFundamentals_() → VM /quote로 실제 PER/PBR을 표시하고 있다. 그 화면의 "실시간
     밸류에이션은 시세 응답이 없어 표시하지 않습니다"는 온디맨드 호출이 실패했을 때만
     뜨는 폴백 문구였는데, 그걸 "데이터 자체가 구조적으로 없다"로 오인해 이 스캔은
     PER/PBR을 아예 시도조차 안 했었다. 배당주 전략은 2026-08-20에 같은 키움 ka10001로
     PER/PBR을 채우도록 보강했다 - fetch_dividend_valuation() 참고. 이 "저평가" 전략은
     그래도 disparity 근사치를 그대로 쓴다 - PER/PBR 전환은 이 전략의 판정 기준 자체를
     바꾸는 별도 결정이라 이번 수정 범위에 넣지 않았다.) 그래서 진짜 PER/PBR 기반 저평가가
     아니라 OHLC로 계산 가능한 "장기 추세 대비 가격 눌림" 근사치를 쓴다는 걸 화면에도
     그대로 명시해야 한다 - 미검증 지표를 확정값처럼 보여주면 안 되므로.

두 조건을 모두 만족하는 종목만 후보가 되고, WICS 대분류 섹터별로 묶어 섹터당 이격도가
가장 낮은(=가장 많이 눌린) 상위 SECTOR_TOP_N개만 남긴다 - "조건 통과자를 무제한으로 다
보여주면 변별력이 없다"는 피드백을 그대로 반영한 설계.

main.py의 /strategy-scan-batch가 이 캐시를 그대로 서빙한다(엔드포인트·파일명·systemd
타이머는 바꾸지 않았다 - VM에 이미 등록된 kiwoom-strategyscan.timer가 이 파일명을 그대로
가리키고 있어서 배포 경로를 유지해야 재등록 없이 그대로 돌아간다)."""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timezone

import db_schema
import invest_signal
import kiwoom_client
import pattern_detect
import public_data

FULL_UNIVERSE_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js'
WICS_MAP_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/wics-map.js'
SECTOR_MAP_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js'
FUNDAMENTALS_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strategy_scan_cache.json')

# 120일 이동평균 계산에 필요한 최소 거래일 수(가격 게이트) - 이보다 짧으면 판정 자체를
# 건너뛴다(상장 얼마 안 된 종목 등).
MIN_BARS = 120

# 최근 20거래일 평균 거래대금(원) 하한 - 이 미만이면 신호 조건과 무관하게 스캔에서 제외.
# 백테스트로 검증한 값이 아니라 "거래 자체가 사실상 어려운 초소형·품절주는 거른다"는
# 취지의 잠정 기준이다.
MIN_AVG_TURNOVER = 1_000_000_000  # 10억원

# 초저가주는 호가 한두 틱의 왜곡과 작전성 변동이 커 저평가 후보에서 제외한다.
MIN_PRICE = 1_000

# 우량주 전략: 펀더멘탈 점수와 주봉 엔벨로프 하단 터치를 함께 확인한다.
BLUECHIP_FUNDAMENTAL_SCORE_MIN = 70
BLUECHIP_TOP_N = 15
ENVELOPE_PERIOD = 15
ENVELOPE_PERCENT = 15.0
ENVELOPE_TOUCH_TOL = 0.005
ENVELOPE_CLOSE_TOL = 0.03

# 시초 갭상승 전략 - 사용자가 지정한 B/K/G/L 조건.
OPENING_GAP_MIN_INTRADAY_PCT = 3.0
OPENING_GAP_MIN_OPEN = 1_000
OPENING_GAP_MAX_OPEN = 500_000
OPENING_GAP_MIN_TURNOVER_MILLION = 3_000
OPENING_GAP_MAX_TURNOVER_MILLION = 999_999
OPENING_GAP_TOP_N = 15

# 서비스에서 업종이 아니라 테마로 명시해 쓰는 수작업 분류. 이 중 하나에 포함된 종목은
# 펀더멘탈 저평가 검색에서 제외해 테마 모멘텀이 가격 눌림으로 오인되지 않게 한다.
THEME_SECTORS = {
    'IT/스테이블코인', '2차전지', '신재생/원자력', '로봇',
    '우주항공', '방위산업', 'K뷰티',
}

# 품질 게이트 - invest_signal.compute_fundamental_score()는 0~100점(ROE 60%+부채비율
# 40%). 60점은 "ROE 5%대 이상 + 부채비율 150% 이하" 근방의 조합에서 나오는 수준 -
# 백테스트로 정한 컷오프가 아니라 "썩 나쁘지 않다" 수준의 잠정 기준이다.
FUNDAMENTAL_SCORE_MIN = 60

# 가격 게이트 - 120일 이동평균 대비 종가가 90% 이하(=10% 이상 아래로 눌려있음). 역시
# 백테스트 없이 잡은 잠정 기준.
DISPARITY_MAX = 90

# 섹터당 후보를 몇 개까지 보여줄지 - "조건 통과자를 무제한으로 다 보여주면 코스피 목록
# 찍는 것과 다를 바 없다"는 피드백을 그대로 반영해 결과가 20개를 넘을 때만
# 우량성 점수와 이격도 조건을 단계적으로 강화한다.
SECTOR_TOP_N = 5
STRATEGY_MAX_RESULTS = 20

# Dividend ranking follows the broad Naver-style screen: keep common stocks
# with a positive DART-disclosed cash dividend, then rank by yield or DPS.
# Do not impose a high-yield/payout/profit-growth quality gate here; those
# filters made the result set empty and are not part of a simple ranking view.
DIVIDEND_YIELD_MIN = 0.0
DIVIDEND_PAYOUT_MIN = 0.0
DIVIDEND_STREAK_MIN = 1
DIVIDEND_PROFIT_GROWTH_STREAK_MIN = 0
DIVIDEND_TOP_N = None

# 2026-08-20: 배당주 상세 모달의 PER/PBR이 항상 "—"라는 리포트로 확인 - 이 스캔은 원래
# PER/PBR을 아예 안 갖고 있었다(위 모듈 docstring의 "이 프로젝트엔 PER/PBR 데이터가
# 없다"는 설명은 js/foreign-flow.js 종목분석 펀더멘탈 탭이 이미 GAS getFundamentals_() →
# VM /quote(js/foreign-flow.js:1830 valuation, gas/ticker-proxy.gs:3525 quote.per/quote.pbr)로
# 실제 값을 표시하고 있어 그 시점 기준으로도 부정확했던 것으로 보인다 - "시세 응답이 없을
# 때"의 폴백 안내문을 "데이터 자체가 없다"로 오인한 것). 같은 키움 ka10001을 daily_scan.py
# market_cap_getter()와 동일한 패턴(토큰 1회 발급 + 종목당 THROTTLE_SEC 대기 + 종목 단위
# try/except)으로 배당 후보에만 호출해 per/pbr을 채운다 - 저평가/우량주 전략의 이격도
# 기반 판정 자체는 그대로 두고(그건 여전히 유효한 근사치), 배당주 모달 표시 필드만 보강.
THROTTLE_SEC = 0.25

# ETF return ranking uses the same trading-day convention as the local daily
# price cache.  Keeping the calculation local also gives the 12-month screen
# a consistent source even though the referenced Naver screen exposes shorter
# return filters only.
ETF_RETURN_PERIODS = (
    ('1m', '1개월', 21),
    ('3m', '3개월', 63),
    ('6m', '6개월', 126),
    ('12m', '12개월', 252),
)
# Keep every eligible ETF in the cache.  The browser re-ranks this complete
# set when the user selects 1m/3m/6m/12m.
ETF_RETURN_TOP_N = None
ETF_RETURN_CATEGORY_NAME = 'ETF 수익률 상위'

BLUECHIP_METHODOLOGY_NOTE = (
    '펀더멘탈 점수 {min_score}점 이상인 우량주 중 주봉 엔벨로프({period}, ±{percent:.0f}%) 하단을 최근 주봉이 터치하고, '
    '주봉 종가가 하단선 ±{close_tol:.0f}% 안에 있는 종목입니다. 저점 이탈 후 계속 하락하는 종목을 줄이기 위해 '
    '하단선 아래 {close_tol:.0f}% 초과 종가는 제외하며, 전체 후보는 하단선에 가까운 순서로 최대 {top_n}개만 보여줍니다.'
).format(
    min_score=BLUECHIP_FUNDAMENTAL_SCORE_MIN,
    period=ENVELOPE_PERIOD,
    percent=ENVELOPE_PERCENT,
    close_tol=ENVELOPE_CLOSE_TOL * 100,
    top_n=BLUECHIP_TOP_N,
)

OPENING_GAP_METHODOLOGY_NOTE = (
    'B 전일 종가보다 현재 시가가 높고, K 현재 종가가 시가 대비 {intraday:.0f}% 이상 상승한 종목 중 '
    'G 시가 {min_open:,}~{max_open:,}원, L 당일 거래대금 {min_turnover:,}~{max_turnover:,}백만원 조건을 '
    '모두 만족하는 시초 갭상승 후보입니다. 종가의 시가 대비 상승률이 높은 순으로 최대 {top_n}개만 보여줍니다.'
).format(
    intraday=OPENING_GAP_MIN_INTRADAY_PCT,
    min_open=OPENING_GAP_MIN_OPEN,
    max_open=OPENING_GAP_MAX_OPEN,
    min_turnover=OPENING_GAP_MIN_TURNOVER_MILLION,
    max_turnover=OPENING_GAP_MAX_TURNOVER_MILLION,
    top_n=OPENING_GAP_TOP_N,
)

METHODOLOGY_NOTE = (
    '펀더멘탈 점수(DART ROE·부채비율 기준) {min_score}점 이상 + 120일 이동평균 대비 '
    '{max_disp}% 이하로 가격이 눌린 종목만 후보로 삼고, 섹터별로 가장 많이 눌린 상위 '
    '{top_n}개만 보여줍니다. PER·PBR 같은 실제 밸류에이션 데이터가 없어 "장기 추세 대비 '
    '가격 눌림"으로 근사한 것이라 진짜 저평가(이익·자산 대비 싼 가격)와는 다를 수 있습니다.'
).format(min_score=FUNDAMENTAL_SCORE_MIN, max_disp=DISPARITY_MAX, top_n=SECTOR_TOP_N)

METHODOLOGY_NOTE += (
    ' 또한 최근 20일 평균 거래대금 10억원 미만, 주가 1,000원 미만, '
    '서비스 테마 분류 종목은 후보에서 제외합니다.'
)

DIVIDEND_METHODOLOGY_NOTE = (
    '네이버식 배당 랭킹에 맞춰 DART 사업보고서에 현금배당금이 공개된 국내 보통주를 넓게 표시합니다. '
    '배당수익률과 주당 현금배당금 기준으로 정렬할 수 있으며, 3년 순이익 증가·고배당률·최소 배당성향 조건은 적용하지 않습니다. '
    'ETF·ETN·스팩·우선주·거래정지·정리매매·동전주와 평균 거래대금 {turnover:,}원 미만 종목은 제외합니다. '
    '배당 데이터가 아직 DART 캐시에 없는 종목은 임의 추정하지 않고 다음 배치 수집 후 반영합니다.'
).format(
    turnover=MIN_AVG_TURNOVER,
)

# 2026-08-20: "국민연금이 가진 종목 조회" 요청 - public_data.py에 이미 만들어져 있었지만
# 어디서도 안 쓰이던 fetch_nps_holding()/data.go.kr "국민연금공단 국내주식 투자정보"
# 연동을 전략검색의 새 카테고리로 노출한다. 이 데이터셋은 연 1회 스냅샷(공공데이터 URL
# 자체가 특정 연도로 고정)이라 매일 갱신되는 다른 카테고리와 성격이 다르므로 화면에도
# 기준일을 그대로 노출해야 한다(as_of, public_data._NPS_AS_OF). 종목명 매칭 실패(표기
# 차이·상장폐지 등)로 유니버스에 없는 종목은 조용히 빠진다 - 임의 보정하지 않는다.
NPS_TOP_N = None
NPS_METHODOLOGY_NOTE = (
    '국민연금공단이 공공데이터포털(data.go.kr)에 공개한 국내주식 투자정보 기준, 국민연금이 보유한 종목을 '
    '보유 지분율(%) 높은 순으로 표시합니다. 이 데이터는 매일 갱신되지 않고 국민연금공단이 공시하는 시점의 '
    '스냅샷입니다(화면의 기준일 참고) - 그 이후 실제 보유 현황과 다를 수 있습니다. 종목명 표기가 달라 '
    '매칭되지 않는 종목은 목록에서 빠질 수 있습니다.'
)


def log(msg):
    print('[strategy_scan] ' + msg, flush=True)


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_full_universe():
    """gas의 fetchFullUniverse_()/daily_scan.py와 동일한 정규식으로
    window.KRX_MAP={"종목명":"코드",...}를 [{name, code}] 목록으로 파싱."""
    req = urllib.request.Request(FULL_UNIVERSE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    etf_names = set()
    if 'window.KRX_ETF_NAMES=' in text:
        etf_text = text.split('window.KRX_ETF_NAMES=', 1)[1]
        etf_names = set(re.findall(r'"([^"]+)"', etf_text))

    out = []
    for m in re.finditer(r'"([^"]+)":"([0-9A-Za-z]{6})"', text):
        out.append({
            'name': m.group(1),
            'code': m.group(2),
            'is_etf': m.group(1) in etf_names,
        })
    return out


def load_wics_map():
    """data/wics-map.js(window.WICS_MAP={"코드":{"name":..,"sector":..,"industry":..},...},
    scripts/fetch_wics_map.py가 생성, js/foreign-flow.js가 프론트에서 쓰는 것과 동일 소스)를
    fetch해서 {code: {name, sector, industry}}로 파싱한다."""
    req = urllib.request.Request(WICS_MAP_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    out = {}
    for m in re.finditer(
        r'"([0-9A-Za-z]{6})":\{"name":"([^"]*)","sector":"([^"]*)","industry":"([^"]*)"\}', text
    ):
        out[m.group(1)] = {'name': m.group(2), 'sector': m.group(3), 'industry': m.group(4)}
    return out


def load_theme_codes():
    """sectors-v3.js에서 명시적 테마 카테고리에 속한 종목 코드를 읽는다."""
    req = urllib.request.Request(SECTOR_MAP_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode('utf-8')
    codes = set()
    sector_re = re.compile(r'"([^"]+)"\s*:\s*\[([\s\S]*?)\]')
    code_re = re.compile(r'code:\s*"([0-9A-Za-z]{6})"')
    for sector_name, block in sector_re.findall(text):
        if sector_name in THEME_SECTORS:
            codes.update(code_re.findall(block))
    return codes


def load_fundamentals_cache():
    """batch_scan.py(DART 재무, 전종목 2,691~2,766개, 하루 시간예산 내에서 이어달리기 순회)가
    미리 만들어둔 캐시 - daily_scan.py의 load_fundamentals_cache()와 동일 패턴(같은 VM 로컬
    파일이라 HTTP 호출 없이 그대로 읽는다)."""
    if not os.path.exists(FUNDAMENTALS_CACHE_FILE):
        return {}
    with open(FUNDAMENTALS_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return cached.get('data') or {}


def sma_last(daily, period, field='close'):
    """daily(오름차순) 마지막 period개 평균 - kisyaml_strategy.py의 _sma와 같은 계산이지만
    시리즈 전체가 아니라 최신 값 하나만 필요해 직접 계산한다."""
    window = daily[-period:]
    if len(window) < period:
        return None
    return sum(row[field] for row in window) / period


def weekly_bars(daily):
    """Aggregate ascending daily OHLC rows into ISO-week OHLC rows."""
    buckets = {}
    for row in daily:
        try:
            raw_date = str(row.get('date') or '')[:10]
            day = date.fromisoformat(raw_date)
        except (TypeError, ValueError):
            continue
        key = day.isocalendar()[:2]
        buckets.setdefault(key, []).append(row)

    bars = []
    for rows in buckets.values():
        bars.append({
            'date': rows[-1].get('date'),
            'open': rows[0]['open'],
            'high': max(row['high'] for row in rows),
            'low': min(row['low'] for row in rows),
            'close': rows[-1]['close'],
            'volume': sum(row.get('volume') or 0 for row in rows),
        })
    return bars


def envelope_signal(daily, period=ENVELOPE_PERIOD, percent=ENVELOPE_PERCENT):
    """Return a weekly Envelope lower-band touch, or None when it is not active."""
    weekly = weekly_bars(daily)
    if len(weekly) < period:
        return None
    recent = weekly[-period:]
    middle = sum(row['close'] for row in recent) / period
    multiplier = percent / 100.0
    upper = middle * (1 + multiplier)
    lower = middle * (1 - multiplier)
    current = weekly[-1]
    close_distance = current['close'] / lower - 1 if lower else None
    touched = current['low'] <= lower * (1 + ENVELOPE_TOUCH_TOL)
    close_near = close_distance is not None and abs(close_distance) <= ENVELOPE_CLOSE_TOL
    if not touched or not close_near:
        return None
    return {
        'date': current['date'],
        'period': period,
        'percent': percent,
        'middle': middle,
        'upper': upper,
        'lower': lower,
        'closeDistancePct': close_distance * 100,
        'touched': True,
    }


def opening_gap_signal(daily):
    """Return the latest B/K/G/L opening-gap signal, or None."""
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

    # B: 현재 시가가 전일 종가보다 높음. K: 현재 종가가 현재 시가 대비 3% 이상 상승.
    gap_rate_pct = (open_price / previous_close - 1) * 100
    intraday_rate_pct = (close_price / open_price - 1) * 100
    turnover_million = close_price * volume / 1_000_000
    if not open_price > previous_close:
        return None
    if intraday_rate_pct < OPENING_GAP_MIN_INTRADAY_PCT:
        return None
    if not OPENING_GAP_MIN_OPEN <= open_price <= OPENING_GAP_MAX_OPEN:
        return None
    if not OPENING_GAP_MIN_TURNOVER_MILLION <= turnover_million <= OPENING_GAP_MAX_TURNOVER_MILLION:
        return None

    return {
        'date': current.get('date'),
        'price': close_price,
        'previousClose': previous_close,
        'open': open_price,
        'gapRatePct': gap_rate_pct,
        'intradayRatePct': intraday_rate_pct,
        'turnoverMillion': turnover_million,
    }


def build_opening_gap_match(stock, daily, signal, sector):
    previous_close = signal['previousClose']
    price = signal['price']
    change_rate = ((price - previous_close) / previous_close * 100) if previous_close else None
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': price,
        'changeRate': change_rate,
        'date': signal['date'],
        'sector': sector,
        'open': signal['open'],
        'previousClose': previous_close,
        'gapRatePct': round(signal['gapRatePct'], 2),
        'intradayRatePct': round(signal['intradayRatePct'], 2),
        'turnoverMillion': round(signal['turnoverMillion'], 1),
    }


def build_match(stock, daily, disparity, fundamental_score, annual):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    change_rate = ((last['close'] - prev['close']) / prev['close'] * 100) if (prev and prev['close']) else None
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last.get('date'),
        # 종목마다 실제로 달라지는 값 - "다 100%"였던 이전 배지 문제의 재발 방지.
        'disparity': round(disparity, 1),
        'fundamentalScore': fundamental_score,
        'roe': annual.get('latest_roe_pct'),
        'debtRatio': annual.get('latest_debt_ratio_pct'),
    }


def apply_strategy_quality_gates(matches):
    """Tighten fundamental/price quality only when strategy results exceed 20."""
    matches = list(matches or [])
    if len(matches) <= STRATEGY_MAX_RESULTS:
        return matches

    gates = (
        lambda item: (item.get('fundamentalScore') or 0) >= 70,
        lambda item: (item.get('fundamentalScore') or 0) >= 80 and (item.get('disparity') or 999) <= 85,
        lambda item: (item.get('fundamentalScore') or 0) >= 90 and (item.get('disparity') or 999) <= 80,
        lambda item: (item.get('fundamentalScore') or 0) >= 90 and (item.get('disparity') or 999) <= 75,
        lambda item: (item.get('fundamentalScore') or 0) >= 100 and (item.get('disparity') or 999) <= 75,
    )
    candidates = matches
    for gate in gates:
        filtered = [item for item in candidates if gate(item)]
        if len(filtered) <= STRATEGY_MAX_RESULTS:
            return filtered
        candidates = filtered
    return candidates


def scan(universe, wics_map, fundamentals_cache, conn, theme_codes=None):
    theme_codes = theme_codes or set()
    sectors = {}  # sector_name -> [match, ...] (필터 통과자 전부, 정렬/컷은 이후 일괄)
    scanned = 0
    skipped_no_data = 0
    skipped_illiquid = 0
    skipped_no_sector = 0
    skipped_no_fundamentals = 0

    for stock in universe:
        code = stock['code']
        daily = db_schema.load_daily_prices(conn, code)
        if len(daily) < MIN_BARS:
            skipped_no_data += 1
            continue

        if pattern_detect.is_excluded_stock(stock, daily):
            skipped_illiquid += 1
            continue
        if daily[-1]['close'] < MIN_PRICE or code in theme_codes:
            skipped_illiquid += 1
            continue

        vol_multiple = pattern_detect.compute_volume_multiple(daily)
        if not vol_multiple or vol_multiple['avg20'] < MIN_AVG_TURNOVER:
            skipped_illiquid += 1
            continue

        wics = wics_map.get(code)
        if not wics or not wics.get('sector'):
            skipped_no_sector += 1
            continue

        fund_entry = fundamentals_cache.get(code)
        annual = (fund_entry or {}).get('annual')
        fundamental_score = invest_signal.compute_fundamental_score(annual)
        if fundamental_score is None:
            skipped_no_fundamentals += 1
            continue
        scanned += 1
        if fundamental_score < FUNDAMENTAL_SCORE_MIN:
            continue

        sma120 = sma_last(daily, 120)
        if not sma120:
            continue
        disparity = daily[-1]['close'] / sma120 * 100
        if disparity > DISPARITY_MAX:
            continue

        sector = wics['sector']
        sectors.setdefault(sector, []).append(build_match(stock, daily, disparity, fundamental_score, annual))

    for sector in sectors:
        sectors[sector].sort(key=lambda m: m['disparity'])  # 가장 많이 눌린(이격도 낮은) 순
        # Keep every sector candidate until the global quality gates run.

    all_matches = [match for sector_matches in sectors.values() for match in sector_matches]
    selected_codes = {match['code'] for match in apply_strategy_quality_gates(all_matches)}
    for sector in list(sectors):
        sectors[sector] = [match for match in sectors[sector] if match['code'] in selected_codes]
        sectors[sector].sort(key=lambda m: (-m['fundamentalScore'], m['disparity'], m['code']))
        if not sectors[sector]:
            del sectors[sector]

    return sectors, scanned, skipped_no_data, skipped_illiquid, skipped_no_sector, skipped_no_fundamentals


def scan_bluechip(universe, wics_map, fundamentals_cache, conn, theme_codes=None):
    """Scan quality stocks whose current weekly Envelope lower band was touched."""
    theme_codes = theme_codes or set()
    matches = []
    scanned = 0
    for stock in universe:
        code = stock['code']
        daily = db_schema.load_daily_prices(conn, code)
        if len(daily) < MIN_BARS:
            continue
        if pattern_detect.is_excluded_stock(stock, daily):
            continue
        if daily[-1]['close'] < MIN_PRICE or code in theme_codes:
            continue
        if pattern_detect.is_etf_name(stock.get('name')):
            continue
        vol_multiple = pattern_detect.compute_volume_multiple(daily)
        if not vol_multiple or vol_multiple['avg20'] < MIN_AVG_TURNOVER:
            continue
        wics = wics_map.get(code)
        if not wics or not wics.get('sector'):
            continue
        annual = ((fundamentals_cache.get(code) or {}).get('annual'))
        fundamental_score = invest_signal.compute_fundamental_score(annual)
        if fundamental_score is None or fundamental_score < BLUECHIP_FUNDAMENTAL_SCORE_MIN:
            continue
        scanned += 1
        signal = envelope_signal(daily)
        if not signal:
            continue
        match = build_match(
            stock,
            daily,
            disparity=signal['closeDistancePct'],
            fundamental_score=fundamental_score,
            annual=annual,
        )
        match['strategy'] = 'weeklyEnvelope'
        match['envelope'] = signal
        match['sector'] = wics['sector']
        matches.append(match)

    matches.sort(key=lambda item: (
        abs(item.get('envelope', {}).get('closeDistancePct') or 0),
        -(item.get('fundamentalScore') or 0),
    ))
    sectors = {}
    for match in matches[:BLUECHIP_TOP_N]:
        sector = match['sector']
        sectors.setdefault(sector, []).append(match)
    return sectors, scanned


def scan_opening_gap(universe, wics_map, conn):
    """Scan the latest daily bar for the B/K/G/L opening-gap strategy."""
    matches = []
    scanned = 0
    for stock in universe:
        daily = db_schema.load_daily_prices(conn, stock['code'])
        if len(daily) < 2:
            continue
        if pattern_detect.is_excluded_stock(stock, daily):
            continue
        scanned += 1
        signal = opening_gap_signal(daily)
        if not signal:
            continue
        wics = wics_map.get(stock['code']) or {}
        sector = wics.get('sector') or '기타'
        matches.append(build_opening_gap_match(stock, daily, signal, sector))

    # 조건 통과 종목이 많아도 결과가 무작위로 잘리지 않도록 우선순위를 명시한다.
    matches.sort(key=lambda item: (
        -(item.get('intradayRatePct') or 0),
        -(item.get('turnoverMillion') or 0),
        item.get('code') or '',
    ))
    sectors = {}
    for match in matches[:OPENING_GAP_TOP_N]:
        sectors.setdefault(match['sector'], []).append(match)
    return sectors, scanned


def _positive_streak(values):
    """Count consecutive positive values from the newest value backwards."""
    streak = 0
    for value in reversed(values):
        if value is None or value <= 0:
            break
        streak += 1
    return streak


def _growth_streak(annual):
    """Count consecutive year-over-year net-income increases at the end."""
    rows = sorted((annual or {}).get('years') or [], key=lambda row: row.get('year') or 0)
    values = [row.get('net_income') for row in rows]
    streak = 0
    for index in range(len(values) - 1, 0, -1):
        current = values[index]
        prior = values[index - 1]
        if current is None or prior is None or current <= prior:
            break
        streak += 1
    return streak


def dividend_signal(daily, annual, dividend):
    """Return a strict dividend signal or None.

    Current yield is calculated from the latest disclosed cash DPS and today's
    close, avoiding a stale report-date yield. Payout ratio remains the latest
    DART-disclosed value because it is not derivable from price data alone.
    """
    if not daily or not dividend:
        return None
    years = sorted(dividend.get('years') or [], key=lambda row: row.get('year') or 0)
    if len(years) < DIVIDEND_STREAK_MIN:
        return None
    dps_values = [row.get('cashDividendPerShare') for row in years]
    dividend_streak = _positive_streak(dps_values)
    profit_growth_streak = _growth_streak(annual)
    latest = years[-1]
    price = daily[-1].get('close')
    dps = latest.get('cashDividendPerShare')
    reported_yield = latest.get('dividendYieldPct')
    current_yield = (dps / price * 100) if dps and price else reported_yield
    payout_ratio = latest.get('payoutRatioPct')
    if dps is None or dps <= 0 or current_yield is None or current_yield < DIVIDEND_YIELD_MIN:
        return None
    if dividend_streak < DIVIDEND_STREAK_MIN:
        return None
    return {
        'reportYear': dividend.get('reportYear'),
        'dividendYieldPct': current_yield,
        'reportedDividendYieldPct': reported_yield,
        'payoutRatioPct': payout_ratio,
        'cashDividendPerShare': dps,
        'dividendStreak': dividend_streak,
        'profitGrowthStreak': profit_growth_streak,
    }


def fetch_dividend_valuation(token, code):
    """배당주 상세 모달의 PER/PBR용 - 키움 ka10001(주식기본정보요청)에서 시세 스냅샷을
    1건 받는다. main.py `/quote`가 이미 같은 TR로 per/pbr을 내려주고 있고
    (gas/ticker-proxy.gs getFundamentals_()가 그대로 읽어 종목분석 펀더멘탈 탭에 표시 중 -
    검증된 필드명), daily_scan.py market_cap_getter()와 동일한 방식으로 재사용한다.
    실패는 그 종목만 PER/PBR 없이 넘어가고 전체 스캔은 계속되게 None을 돌려준다."""
    if not token:
        return None
    try:
        raw = kiwoom_client.call_tr(token, 'ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
    except (RuntimeError, OSError):
        return None

    def to_num(value):
        if isinstance(value, str):
            value = value.replace(',', '').strip()
        try:
            return float(value) if value not in (None, '') else None
        except (TypeError, ValueError):
            return None

    return {'per': to_num(raw.get('per')), 'pbr': to_num(raw.get('pbr'))}


def build_dividend_match(stock, daily, sector, signal, annual, valuation=None):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    previous_close = prev.get('close') if prev else None
    change_rate = ((last['close'] - previous_close) / previous_close * 100) if previous_close else None
    match = {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last.get('date'),
        'sector': sector,
        'strategy': 'dividend',
        'reportYear': signal.get('reportYear'),
        'dividendYieldPct': round(signal['dividendYieldPct'], 2),
        'reportedDividendYieldPct': signal.get('reportedDividendYieldPct'),
        'payoutRatioPct': round(signal['payoutRatioPct'], 2) if signal.get('payoutRatioPct') is not None else None,
        'cashDividendPerShare': signal.get('cashDividendPerShare'),
        'dividendStreak': signal['dividendStreak'],
        'profitGrowthStreak': signal['profitGrowthStreak'],
        # 2026-08-20: build_match()(재무건전 전략)는 이미 annual['latest_roe_pct']를
        # roe로 실어 보내는데 이 배당주 전략만 빠져 있어 배당 정보 모달의 ROE가 항상
        # "—"였다(사용자 리포트). annual은 이미 인자로 들어와 있어 계산 비용 없이 채운다.
        'roe': annual.get('latest_roe_pct') if annual else None,
        # 2026-08-20: PER/PBR도 같은 리포트에서 "—"로 확인됨 - fetch_dividend_valuation() 참고.
        'per': valuation.get('per') if valuation else None,
        'pbr': valuation.get('pbr') if valuation else None,
    }
    fundamental_score = invest_signal.compute_fundamental_score(annual)
    if fundamental_score is not None:
        match['fundamentalScore'] = fundamental_score
    return match


def etf_return_signal(daily, lookback_bars):
    """Return a close-to-close ETF return for a trading-day lookback."""
    if not daily or len(daily) <= lookback_bars:
        return None
    current = daily[-1].get('close')
    baseline = daily[-1 - lookback_bars].get('close')
    try:
        current = float(current)
        baseline = float(baseline)
    except (TypeError, ValueError):
        return None
    if baseline <= 0 or current <= 0:
        return None
    return {
        'returnRatePct': (current / baseline - 1) * 100,
        'lookbackBars': lookback_bars,
        'date': daily[-1].get('date'),
        'price': current,
    }


def is_eligible_etf(stock, daily):
    """Keep listed ETFs while applying the common product/data hygiene gates."""
    stock = stock or {}
    name = str(stock.get('name') or '').strip()
    if not (bool(stock.get('is_etf')) or pattern_detect.is_etf_name(name)):
        return False

    # ETN/SPAC/preferred/status products do not belong in the ETF return tab.
    if pattern_detect.NON_COMMON_STOCK_NAME_TOKENS.search(name):
        return False
    if pattern_detect.PREFERRED_STOCK_SUFFIX.search(name):
        return False
    if stock.get('is_trading_halted') or stock.get('is_under_liquidation'):
        return False
    if not daily:
        return False
    try:
        return float(daily[-1].get('close') or 0) >= MIN_PRICE and float(daily[-1].get('volume') or 0) > 0
    except (TypeError, ValueError):
        return False


def build_etf_return_match(stock, daily, signals):
    previous = daily[-2] if len(daily) > 1 else None
    previous_close = previous.get('close') if previous else None
    price = signals[next(iter(signals))]['price']
    change_rate = ((price - previous_close) / previous_close * 100) if previous_close else None
    match = {
        'code': stock['code'],
        'name': stock['name'],
        'price': price,
        'changeRate': change_rate,
        'date': daily[-1].get('date'),
        'sector': 'ETF',
        'strategy': 'etfReturn',
    }
    for period_key, period_label, _ in ETF_RETURN_PERIODS:
        signal = signals.get(period_key)
        match['returnRate' + period_key + 'Pct'] = (
            round(signal['returnRatePct'], 2) if signal else None
        )
        match['return' + period_key.upper() + 'Label'] = period_label
    return match


def scan_etf_returns(universe, conn):
    """Rank one ETF list while exposing all four cumulative return periods."""
    candidates = []
    scanned = 0
    for stock in universe:
        daily = db_schema.load_daily_prices(conn, stock['code'])
        if not is_eligible_etf(stock, daily):
            continue
        scanned += 1
        signals = {}
        for period_key, _, lookback_bars in ETF_RETURN_PERIODS:
            signal = etf_return_signal(daily, lookback_bars)
            if signal:
                signals[period_key] = signal
        if signals:
            candidates.append(build_etf_return_match(stock, daily, signals))

    # The combined tab is ranked by 1-month cumulative return. When an ETF
    # has a shorter history, the first available period is used as fallback;
    # the other columns remain visible as '-' instead of silently dropping it.
    def ranking_key(item):
        for period_key, _, _ in ETF_RETURN_PERIODS:
            value = item.get('returnRate' + period_key + 'Pct')
            if value is not None:
                return float(value)
        return float('-inf')

    candidates.sort(key=lambda item: (
        -ranking_key(item),
        -(item.get('price') or 0),
        item.get('code') or '',
    ))
    return {'ETF': candidates if ETF_RETURN_TOP_N is None else candidates[:ETF_RETURN_TOP_N]}, scanned


def scan_dividend(universe, wics_map, fundamentals_cache, conn, theme_codes=None, kiwoom_token=None):
    """Scan domestic common stocks for the conservative dividend strategy."""
    theme_codes = theme_codes or set()
    matches = []
    scanned = 0
    for stock in universe:
        code = stock['code']
        daily = db_schema.load_daily_prices(conn, code)
        if len(daily) < MIN_BARS:
            continue
        if pattern_detect.is_excluded_stock(stock, daily):
            continue
        if daily[-1]['close'] < MIN_PRICE or code in theme_codes:
            continue
        if pattern_detect.is_etf_name(stock.get('name')):
            continue
        vol_multiple = pattern_detect.compute_volume_multiple(daily)
        if not vol_multiple or vol_multiple['avg20'] < MIN_AVG_TURNOVER:
            continue
        wics = wics_map.get(code)
        if not wics or not wics.get('sector'):
            continue
        entry = fundamentals_cache.get(code) or {}
        annual = entry.get('annual')
        signal = dividend_signal(daily, annual, entry.get('dividend'))
        scanned += 1
        if not signal:
            continue
        # PER/PBR은 배당 신호를 통과한 후보에만 호출한다(전종목이 아니라 실제 결과에
        # 표시될 종목만) - THROTTLE_SEC로 daily_scan.py market_cap_getter()와 동일하게 쉰다.
        valuation = fetch_dividend_valuation(kiwoom_token, code)
        if kiwoom_token:
            time.sleep(THROTTLE_SEC)
        matches.append(build_dividend_match(stock, daily, wics['sector'], signal, annual, valuation))

    matches.sort(key=lambda item: (
        -(item.get('dividendYieldPct') or 0),
        -(item.get('payoutRatioPct') or 0),
        -(item.get('dividendStreak') or 0),
        -(item.get('profitGrowthStreak') or 0),
        item.get('code') or '',
    ))
    sectors = {}
    dividend_matches = matches if DIVIDEND_TOP_N is None else matches[:DIVIDEND_TOP_N]
    for match in dividend_matches:
        sectors.setdefault(match['sector'], []).append(match)
    return sectors, scanned


def build_nps_match(stock, daily, sector, info):
    last = daily[-1]
    prev = daily[-2] if len(daily) > 1 else None
    previous_close = prev.get('close') if prev else None
    change_rate = ((last['close'] - previous_close) / previous_close * 100) if previous_close else None
    return {
        'code': stock['code'],
        'name': stock['name'],
        'price': last['close'],
        'changeRate': change_rate,
        'date': last.get('date'),
        'sector': sector,
        'strategy': 'nationalPension',
        'holdingPct': info.get('holding_pct'),
        'weightPct': info.get('weight_pct'),
        'evaluationAmountEok': info.get('evaluation_amount_eok'),
        'asOf': info.get('as_of'),
        'source': info.get('source'),
    }


def scan_nps_holdings(universe, wics_map, conn, theme_codes=None):
    """국민연금 보유종목 - public_data.fetch_nps_holdings_by_code()가 이름 매칭까지 끝낸
    {code: info}를 한 번만 받아, 그 종목들에만 가격·섹터를 붙인다. 다른 전략과 달리 별도
    시그널 판정이 없다(국민연금이 갖고 있다는 사실 자체가 표시 대상) - 전종목을 순회하며
    daily_prices를 다시 계산하지 않고 holdings에 있는 종목만 본다."""
    theme_codes = theme_codes or set()
    holdings = public_data.fetch_nps_holdings_by_code(universe)
    matches = []
    for stock in universe:
        code = stock['code']
        info = holdings.get(code)
        if not info:
            continue
        if code in theme_codes:
            continue
        if pattern_detect.is_etf_name(stock.get('name')):
            continue
        wics = wics_map.get(code)
        if not wics or not wics.get('sector'):
            continue
        daily = db_schema.load_daily_prices(conn, code)
        if not daily:
            continue
        matches.append(build_nps_match(stock, daily, wics['sector'], info))

    matches.sort(key=lambda item: -(item.get('holdingPct') or 0))
    sectors = {}
    nps_matches = matches if NPS_TOP_N is None else matches[:NPS_TOP_N]
    for match in nps_matches:
        sectors.setdefault(match['sector'], []).append(match)
    return sectors, len(holdings)


def main():
    load_dotenv()

    universe = load_full_universe()
    if not universe:
        log('전종목 유니버스를 못 불러왔습니다.')
        sys.exit(1)
    if '--test' in sys.argv:
        universe = universe[:50]
        log('--test 모드: %d종목만 스모크 테스트' % len(universe))
    log('대상 종목 수: %d' % len(universe))

    wics_map = load_wics_map()
    if not wics_map:
        log('WICS 섹터 맵을 못 불러왔습니다.')
        sys.exit(1)
    log('WICS 섹터 맵 종목 수: %d' % len(wics_map))

    theme_codes = load_theme_codes()
    log('제외 테마 종목 수: %d' % len(theme_codes))

    fundamentals_cache = load_fundamentals_cache()
    log('펀더멘탈 캐시 종목 수: %d' % len(fundamentals_cache))

    # 2026-08-20: 배당주 PER/PBR 보강(fetch_dividend_valuation) 용 - daily_scan.py와 동일하게
    # 키움 토큰을 1회만 발급해 재사용한다. 미설정이면 PER/PBR 없이(기존과 동일하게 "—")
    # 계속 진행한다 - 이 스캔의 다른 카테고리(저평가/우량주/ETF)는 원래 키움 인증이 필요
    # 없었으므로 필수 요건으로 승격하지 않는다.
    kiwoom_appkey = os.environ.get('KIWOOM_APPKEY')
    kiwoom_secretkey = os.environ.get('KIWOOM_SECRETKEY')
    kiwoom_token = None
    if kiwoom_appkey and kiwoom_secretkey:
        try:
            kiwoom_token = kiwoom_client.get_token(kiwoom_appkey, kiwoom_secretkey)
        except Exception as e:
            log('키움 토큰 발급 실패 - 배당주 PER/PBR 없이 진행합니다: %s' % e)
    else:
        log('KIWOOM_APPKEY / KIWOOM_SECRETKEY 미설정 - 배당주 PER/PBR이 채워지지 않습니다.')

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    (sectors, scanned, skipped_no_data, skipped_illiquid,
     skipped_no_sector, skipped_no_fundamentals) = scan(
        universe, wics_map, fundamentals_cache, conn, theme_codes=theme_codes)
    dividend_sectors, dividend_scanned = scan_dividend(
        universe, wics_map, fundamentals_cache, conn, theme_codes=theme_codes, kiwoom_token=kiwoom_token)
    etf_return_sectors, etf_scanned = scan_etf_returns(universe, conn)
    nps_sectors, nps_scanned = scan_nps_holdings(universe, wics_map, conn, theme_codes=theme_codes)

    undervalued_category = {
        'name': '저평가 종목',
        'methodology': METHODOLOGY_NOTE,
        'sectors': {
            sector: {'name': sector, 'matches': matches}
            for sector, matches in sectors.items()
            if matches
        },
    }

    output = {
        'scannedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'scanned': scanned,
        'universe': len(universe),
        'skippedNoData': skipped_no_data,
        'skippedIlliquid': skipped_illiquid,
        'skippedNoSector': skipped_no_sector,
        'skippedNoFundamentals': skipped_no_fundamentals,
        # 전략검색은 카테고리 여러 개를 탭으로 보여주는 틀이고, "저평가 종목"은 그 중 첫
        # 카테고리일 뿐이다(2026-08 사용자 피드백 - "전략검색은 냅두고 10개를 1개로
        # 줄이는 거였지, 페이지 자체를 저평가 종목으로 박아버리라는 게 아니었다. 계속
        # 추가할 것"). 그래서 sectors를 최상위에 바로 두지 않고 categories.undervalued
        # 밑에 넣는다 - 다음 카테고리를 추가할 때 이 딕셔너리에 키 하나만 더 넣으면 된다.
        'categories': {
            'undervalued': undervalued_category,
            'dividend': {
                'name': '배당주',
                'methodology': DIVIDEND_METHODOLOGY_NOTE,
                'sectors': {
                    sector: {'name': sector, 'matches': matches}
                    for sector, matches in dividend_sectors.items()
                    if matches
                },
            },
        },
    }

    output['categories']['etfReturn'] = {
        'name': ETF_RETURN_CATEGORY_NAME,
        'methodology': (
            '국내 ETF 중 ETN·스팩·우선주·거래정지·정리매매·동전주를 제외하고, '
            '유효한 가격 데이터가 있는 전체 ETF를 표시합니다. 기본 정렬은 1개월 누적수익률이며, '
            '화면에서 1개월·3개월·6개월·12개월을 선택해 해당 기간 순으로 다시 정렬할 수 있습니다. '
            '각 종목의 1개월·3개월·6개월·12개월 누적수익률을 함께 제공합니다.'
        ),
        'sectors': {
            sector: {'name': sector, 'matches': matches}
            for sector, matches in etf_return_sectors.items()
            if matches
        },
    }
    output['etfScanned'] = etf_scanned

    output['categories']['nationalPension'] = {
        'name': '국민연금 보유종목',
        'methodology': NPS_METHODOLOGY_NOTE,
        'sectors': {
            sector: {'name': sector, 'matches': matches}
            for sector, matches in nps_sectors.items()
            if matches
        },
    }
    output['npsScanned'] = nps_scanned

    tmp_path = OUTPUT_FILE + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)
    os.replace(tmp_path, OUTPUT_FILE)  # 원자적 교체 - 쓰는 도중 /strategy-scan-batch가 읽어도 반쪽 파일을 못 봄

    total_matches = sum(len(s['matches']) for s in undervalued_category['sectors'].values())
    log('완료: 판정 %d / 유니버스 %d, 데이터부족 %d, 유동성부족 %d, 섹터미분류 %d, 펀더멘탈없음 %d'
        % (scanned, len(universe), skipped_no_data, skipped_illiquid, skipped_no_sector, skipped_no_fundamentals))
    log('  섹터 %d개, 저평가 후보 총 %d종목' % (len(undervalued_category['sectors']), total_matches))
    for sector in sorted(undervalued_category['sectors']):
        log('  %s: %d종목' % (sector, len(undervalued_category['sectors'][sector]['matches'])))


if __name__ == '__main__':
    main()
