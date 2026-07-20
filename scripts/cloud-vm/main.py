# -*- coding: utf-8 -*-
"""키움 조회 전용 REST API 서버.
실행: uvicorn main:app --host 0.0.0.0 --port 8080
필수 환경변수: KIWOOM_APPKEY, KIWOOM_SECRETKEY, API_TOKEN(이 서버 자체 인증용, 아무 문자열이나 직접 정해서 사용)
선택 환경변수: KIS_APPKEY, KIS_APPSECRET(코스피200 야간선물 - 없으면 /futures에서 이 항목만 빠짐,
서버 전체는 정상 동작). 야간선물 웹소켓 사용하려면 `pip install websockets` 필요.
"""

import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Header, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware

import bond_yield
import btc_futures
import db_schema
import domestic_futures
import foreign_flow_compute
import foreign_futures
import naver_news
import investor_flow
import investor_trend
import kiwoom_client
import kiwoom_market
import market_rank
import option_flow

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')

try:
    import night_futures_ws
except ImportError:
    # websockets 패키지가 VM에 아직 설치되지 않았을 수 있음(신규 의존성) - 이 기능만
    # 건너뛰고 나머지 API(키움 시세/수급 등, 이미 서비스 중인 것들)는 정상 동작해야 하므로
    # 임포트 실패로 서버 전체가 죽지 않도록 방어.
    night_futures_ws = None

app = FastAPI(title="kiwoom-readonly-api")


@app.on_event('startup')
def _start_futures_collectors():
    """야간선물(KIS)/해외선물(네이버) 백그라운드 수집기 - 프로세스 안에서 스레드로 상시 구동.
    KIS_APPKEY/APPSECRET이 없거나 websockets 미설치면 야간선물만 건너뛰고(나머지 API는
    정상 동작), 로그만 남긴다."""
    conn = db_schema.get_conn()
    db_schema.create_schema(conn)
    conn.close()

    foreign_futures.start_background()
    domestic_futures.start_background()
    btc_futures.start_background()
    bond_yield.start_background()

    kis_appkey = os.environ.get('KIS_APPKEY')
    kis_appsecret = os.environ.get('KIS_APPSECRET')
    kiwoom_appkey = os.environ.get('KIWOOM_APPKEY')
    kiwoom_secretkey = os.environ.get('KIWOOM_SECRETKEY')
    # investor_trend은 "오늘" 값을 키움(ka10051) 1순위, 과거 이력은 KIS 1순위로 쓰고
    # 둘 다 없으면 네이버로 자동 폴백한다(investor_trend.py 상단 독스트링 참고) - 그래서 위
    # 야간선물/옵션수급과 달리 "미설정 시 건너뜀"이 아니라 항상 시작한다.
    investor_trend.start_background(kis_appkey, kis_appsecret, kiwoom_appkey, kiwoom_secretkey)

    if night_futures_ws is None:
        logging.getLogger('main').warning('websockets 미설치 - 야간선물 수집 건너뜀(pip install websockets 필요)')
    elif kis_appkey and kis_appsecret:
        night_futures_ws.start_background(kis_appkey, kis_appsecret)
    else:
        logging.getLogger('main').warning('KIS_APPKEY/APPSECRET 미설정 - 야간선물 수집 건너뜀')

    # 옵션 수급(콜/풋)도 야간선물과 같은 KIS 앱키를 쓴다 - 웹소켓이 아니라 REST 폴링이라
    # websockets 패키지 유무와는 무관.
    if kis_appkey and kis_appsecret:
        option_flow.start_background(kis_appkey, kis_appsecret)
    else:
        logging.getLogger('main').warning('KIS_APPKEY/APPSECRET 미설정 - 옵션 수급 수집 건너뜀')

# 2026-07-13: GAS->VM 구간이 간헐적으로 통째로 막히는 원인 불명 현상 때문에, /investor-flow는
# GAS를 거치지 않고 방문자 브라우저(js/foreign-flow.js)가 이 VM을 직접 호출하도록 우회.
# 브라우저 직접 호출이라 X-API-Key를 넘길 수 없어 이 라우트만 인증 없이 열되(공개 시세
# 데이터라 민감정보 아님), CORS로 블로그 도메인에서만 정상 호출되게 제한한다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=['https://ghlee.tistory.com'],
    allow_methods=['GET'],
    allow_headers=['*'],
)

BATCH_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')
FUNDAMENTALS_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
DAILY_SCAN_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')
WEEK52_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'week52_cache.json')

# /ohlc, /investor-flow 온디맨드 조회용 메모리 캐시(종목코드 -> (기록시각, 결과)).
# GAS가 이 두 엔드포인트를 호출할 때만 유독 응답이 느려서(타임아웃) 실패하는 현상이 있어
# 재조회는 즉시 응답하도록 방어 - 최초 1회는 여전히 키움 실시간 호출이 필요하다.
# 무제한 증가 방지로 개수 상한을 넘으면 통째로 비운다(정교한 LRU 대신 단순하게).
_LIVE_CACHE_TTL = 300  # 5분
_LIVE_CACHE_MAX_ENTRIES = 500
_ohlc_cache = {}
_investor_flow_cache_mem = {}
_foreign_flow_cache_mem = {}

# 사이드바 랭킹(거래대금/상한가/하한가) - 작업지시서 요구사항(30초~1분 갱신)에 맞춘 짧은
# TTL 캐시. 방문자가 여러 명이어도 30초에 한 번만 키움을 실제로 호출하면 되므로 단일
# 전역값으로 충분(위 _ohlc_cache 같은 종목별 캐시와 달리 키가 하나뿐).
_MARKET_RANK_TTL = 30
_MARKET_RANK_MAX_LIMIT = 20  # 사이드바 미리보기(5)보다 큰 값은 "더보기" 모달 전용
_market_rank_cache = {}  # limit -> {'t':.., 'data':..} - limit별로 따로 캐시(5는 30초마다 폴링, 20은 모달 열 때만)


def _live_cache_get(cache, code):
    entry = cache.get(code)
    if entry and time.time() - entry[0] < _LIVE_CACHE_TTL:
        return entry[1]
    return None


def _live_cache_put(cache, code, value):
    if len(cache) >= _LIVE_CACHE_MAX_ENTRIES:
        cache.clear()
    cache[code] = (time.time(), value)


def load_dotenv():
    """스크립트 옆의 .env(있으면)를 os.environ에 채운다. 이미 설정된 실제 환경변수는 덮어쓰지 않음."""
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


load_dotenv()


def envelope(data):
    return {
        'success': True,
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'data': data,
    }


def require_api_key(x_api_key: str = Header(default=None)):
    expected = os.environ.get('API_TOKEN')
    if not expected:
        raise HTTPException(status_code=500, detail='서버에 API_TOKEN이 설정되지 않았습니다.')
    if x_api_key != expected:
        raise HTTPException(status_code=401, detail='invalid or missing X-API-Key header')


def get_kiwoom_token():
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        raise HTTPException(status_code=500, detail='서버에 KIWOOM_APPKEY/KIWOOM_SECRETKEY가 설정되지 않았습니다.')
    return kiwoom_client.get_token(appkey, secretkey)


@app.get('/health')
def health():
    return envelope({'status': 'ok'})


@app.get('/quote')
def quote(code: str = Query(..., min_length=6, max_length=6), x_api_key: str = Header(default=None)):
    require_api_key(x_api_key)
    try:
        token = get_kiwoom_token()
        res = kiwoom_client.call_tr(token, 'ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return envelope(res)


@app.get('/ohlc/{code}')
def ohlc(code: str = Path(..., min_length=6, max_length=6), x_api_key: str = Header(default=None)):
    """일봉 OHLC(ka10081) 온디맨드 조회 - 종목분석 가격차트(gas의 getFlowChart)용.
    네이버 sise_day.naver 크롤링(FLOW_CHART_PAGES=74) 대체.
    2026-07-13: 쿼리스트링(?code=)이 붙은 요청만 GAS UrlFetchApp에서 도달 자체가 안 되는
    현상이 확인돼(nginx 액세스 로그에 구글 쪽 요청이 아예 안 찍힘) code를 경로 파라미터로
    옮김 - 원인 불명이지만 쿼리스트링 자체를 피하는 쪽으로 우회. 그래도 여전히 느린(키움
    실시간 호출) 첫 조회는 GAS에서 실패할 수 있어, 5분 메모리 캐시를 추가해 재조회는
    즉시 응답하도록 방어(_live_cache_get/_live_cache_put)."""
    require_api_key(x_api_key)
    cached = _live_cache_get(_ohlc_cache, code)
    if cached is not None:
        return envelope(cached)
    try:
        token = get_kiwoom_token()
        daily = kiwoom_market.fetch_daily_ohlc(token, code, max_days=None)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not daily:
        raise HTTPException(status_code=404, detail='일봉 데이터를 찾을 수 없습니다.')
    _live_cache_put(_ohlc_cache, code, daily)
    return envelope(daily)


@app.get('/investor-flow/{code}')
def investor_flow_endpoint(code: str = Path(..., min_length=6, max_length=6)):
    """공매도/대차거래/연기금 수급 - scripts/fetch_investor_flow.py 로직 온디맨드 버전.
    2026-07-13: GAS를 거치지 않고 브라우저(js/foreign-flow.js)가 직접 호출하도록 전환됨
    (GAS->VM 구간 간헐적 장애 우회) - 그래서 X-API-Key 인증이 없다(CORS로만 제한, 위 주석
    참고). name은 화면표시용 캐스메틱 필드라 없애고 프론트가 이미 아는 값을 붙여 쓴다.
    5분 메모리 캐시 적용."""
    cached = _live_cache_get(_investor_flow_cache_mem, code)
    if cached is not None:
        return envelope(cached)
    try:
        token = get_kiwoom_token()
        result = investor_flow.fetch_stock(token, code, code)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail='해당 종목의 공매도/대차/수급 데이터를 찾을 수 없습니다.')
    _live_cache_put(_investor_flow_cache_mem, code, result)
    return envelope(result)


FOREIGN_FLOW_DAY_OPTIONS = {5, 10, 20, 42, 63}  # 5일/10일/20일/2개월/3개월(영업일 근사) - 프론트 기간 선택 버튼과 1:1 대응


@app.get('/foreign-flow/{code}')
def foreign_flow_endpoint(code: str = Path(..., min_length=6, max_length=6),
                           days: int = Query(kiwoom_market.FLOW_DEFAULT_DAYS)):
    """종목분석 메인 수급 표(개인·외국인·기관 순매매) - 2026-07-13: 네이버 frgn.naver 크롤링을
    1차로 대체하는 API 버전. 네이버 크롤링은 이제 백업 전용 - 프론트(js/foreign-flow.js)가
    이 엔드포인트를 먼저 시도하고 실패할 때만 GAS의 ?action=foreignFlow(네이버 경로)로
    폴백한다. /investor-flow와 동일하게 공개(인증 없음) + CORS 제한 + 5분 메모리 캐시.
    2026-07-19: 종가/거래량/개인/외국인/기관은 KIS(한국투자증권) API로 소스 교체(NXT 포함
    통합 집계라 Toss/키움HTS와 완전히 일치, kiwoom_market.fetch_foreign_inst_daily 독스트링
    참고) - KIS_APPKEY/APPSECRET 미설정이면 예전 키움 ka10045 경로로 자동 폴백.
    2026-07-19(2차): ?days= 로 기간 선택 지원(FOREIGN_FLOW_DAY_OPTIONS 외 값은 기본치로
    보정) - 캐시 키에 days를 같이 넣어야 1개월 조회 캐시가 1년 조회에 잘못 재사용되지
    않는다(코드만으로 캐시하면 서로 다른 기간 요청이 뒤섞임)."""
    if days not in FOREIGN_FLOW_DAY_OPTIONS:
        days = kiwoom_market.FLOW_DEFAULT_DAYS
    cache_key = '%s:%d' % (code, days)
    cached = _live_cache_get(_foreign_flow_cache_mem, cache_key)
    if cached is not None:
        return envelope(cached)
    try:
        token = get_kiwoom_token()
        daily = kiwoom_market.fetch_foreign_inst_daily(
            token, code,
            kis_appkey=os.environ.get('KIS_APPKEY'), kis_appsecret=os.environ.get('KIS_APPSECRET'),
            target_days=days,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    result = foreign_flow_compute.build_result(code, daily)
    if result is None:
        raise HTTPException(status_code=404, detail='수급 데이터를 찾을 수 없습니다.')
    _live_cache_put(_foreign_flow_cache_mem, cache_key, result)
    return envelope(result)


@app.get('/investor-flow-batch')
def investor_flow_batch(x_api_key: str = Header(default=None)):
    """batch_scan.py(하루 1회 크론)가 미리 계산해둔 섹터 풀 전체 캐시를 즉시 반환.
    실시간 키움 호출 없음 - GAS의 scanInvestSignal이 237종목을 한 번에 받아가는 용도."""
    require_api_key(x_api_key)
    if not os.path.exists(BATCH_CACHE_FILE):
        raise HTTPException(status_code=503, detail='배치 캐시가 아직 생성되지 않았습니다(batch_scan.py 첫 실행 대기 중).')
    with open(BATCH_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return envelope(cached)


@app.get('/fundamentals-batch')
def fundamentals_batch(x_api_key: str = Header(default=None)):
    """batch_scan.py(scan_fundamentals)가 하루 1회 미리 계산해둔 DART 재무제표(5년 실적
    추세 + 최근 분기 YoY) 캐시를 즉시 반환. /investor-flow-batch와 동일한 서빙 패턴."""
    require_api_key(x_api_key)
    if not os.path.exists(FUNDAMENTALS_CACHE_FILE):
        raise HTTPException(status_code=503, detail='펀더멘탈 캐시가 아직 생성되지 않았습니다(batch_scan.py 첫 실행 대기 중).')
    with open(FUNDAMENTALS_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return envelope(cached)


@app.get('/daily-scan-batch')
def daily_scan_batch(x_api_key: str = Header(default=None)):
    """daily_scan.py(하루 1회 크론)가 미리 계산해둔 차트패턴(4종)+눌림목+투자시그널
    전종목 스캔 결과를 즉시 반환. gas/ticker-proxy.gs의 getPatternScanResult()/
    getInvestSignalResult()가 이 엔드포인트를 호출해 원래 형태로 재포장한다."""
    require_api_key(x_api_key)
    if not os.path.exists(DAILY_SCAN_CACHE_FILE):
        raise HTTPException(status_code=503, detail='일일 스캔 캐시가 아직 생성되지 않았습니다(daily_scan.py 첫 실행 대기 중).')
    with open(DAILY_SCAN_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return envelope(cached)


@app.get('/futures')
def futures(interval: str = 'day', days: int = 90):
    """보조지수/코스피 선물 페이지 전용 - 미국 현물지수 3종+선물 3종/SOX/VIX/WTI(네이버) +
    코스피200 주간/야간선물(네이버+KIS) + 원/달러 환율(네이버) 현재가+최근 일봉을 하나로 묶어
    반환. 방문자 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만 제한) - /investor-flow와
    동일한 패턴.
    2026-07-16: order에 'DOW'가 빠져 있던 버그 수정(foreign_futures.py의 SYMBOLS에는 있었지만
    이 목록에 반영이 안 돼 DOW 카드가 계속 '데이터 없음'이었을 것) + domestic_futures.py의
    KOSPI200_DAY/USDKRW 추가.
    2026-07-16(2차): 나스닥종합지수/S&P500지수/다우존스지수(현물) 추가, 코스피 현물지수
    (KOSPI_CASH)는 어느 페이지에서도 안 쓰게 돼 제거.
    2026-07-16(3차): KOSPI_CASH 제거가 "과거 일봉 데이터가 신뢰 불가"라는 잘못된 판단
    때문이었음이 밝혀져 정정 - 코스피/코스닥(KOSPI/KOSDAQ)을 정식으로 다시 추가했다
    (관심지수 리본 미니차트용, domestic_futures.py 상단 주석 참고).
    2026-07-16(4차): 코스피 선물 페이지의 분봉/일봉/주봉 전환 + 일봉 범위 확대 지원.
    days는 기존 호출부(관심지수 리본/보조지수)의 기본 동작을 안 건드리려고 기본값을 90으로
    유지하고, 코스피 선물 페이지만 명시적으로 더 큰 값을 요청한다. interval='minute'는
    domestic_futures.MINUTE_SYMBOLS에 있는 심볼(현재 KOSPI200_DAY만)만 분봉으로 바뀌고
    나머지는 그 심볼에 분봉 소스가 없어 평소처럼 일봉을 반환한다(부분 적용 - 에러 아님).
    2026-07-16(5차): 야간선물도 분봉 지원 추가(MINUTE_SYMBOLS에 KOSPI200_NIGHT 포함) +
    미결제약정(oi/oi_change) 필드 노출(야간선물만 값이 있고 나머지 심볼은 null)."""
    days = max(1, min(days, 500))
    conn = db_schema.get_conn()
    try:
        prices = {p['symbol']: p for p in db_schema.load_all_future_prices(conn)}
        # 주의: 새 심볼을 수집기(foreign_futures.SYMBOLS 등)에 추가하면 이 목록에도 같이
        # 넣어야 응답에 실린다(2026-07-17 GOLD 추가 때 빠뜨려서 한 번 헛배포함).
        order = ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'DOW_INDEX', 'NASDAQ100', 'SP500', 'DOW',
                 'KOSPI200_DAY', 'KOSPI200_NIGHT', 'SOX', 'VIX', 'WTI', 'GOLD', 'USDKRW',
                 'KTB3Y', 'US10Y', 'US2Y', 'US30Y', 'BTC', 'ETH']
        result = []
        for symbol in order:
            p = prices.get(symbol)
            if interval == 'minute' and symbol in domestic_futures.MINUTE_SYMBOLS:
                chart = db_schema.load_future_chart_minute(conn, symbol)
            else:
                chart = db_schema.load_future_chart(conn, symbol, limit_days=days)
            result.append({
                'symbol': symbol,
                'name': p['name'] if p else None,
                'price': p['price'] if p else None,
                'change': p['change'] if p else None,
                'change_rate': p['change_rate'] if p else None,
                'high': p['high'] if p else None,
                'low': p['low'] if p else None,
                'updated_at': p['updated_at'] if p else None,
                'oi': p['oi'] if p else None,
                'oi_change': p['oi_change'] if p else None,
                'chart': chart,
            })
    finally:
        conn.close()
    return envelope(result)


@app.get('/futures/avg')
def futures_avg(symbol: str, days: int = 365):
    """지정 심볼의 최근 N일 종가 평균/최저/최고 - "적정 유가가 있을 텐데 전쟁 나면 오르지
    않냐, 그 기준을 보여달라"는 요청으로 추가(2026-07-18). 객관적으로 확정된 "적정가"라는
    개념 자체가 없어서(OPEC+ 정책·정제마진 등에 따라 계속 바뀜), 대신 우리가 실제로 수집한
    가격의 장기 평균을 참고선으로 제공한다 - 평균을 크게 웃도는 구간이 지정학적 리스크
    프리미엄(전쟁 등)이 낀 구간일 가능성이 높다는 서술적 참고용이지 투자 조언이 아님.
    WTI 전용이 아니라 심볼을 파라미터로 받는 범용 엔드포인트 - foreign_futures.py가
    2026-07-18부터 400일치를 저장해두므로 웬만한 심볼은 1년 평균을 낼 수 있다.
    2026-07-18(2차): row 개수 기준(LIMIT) 대신 실제 달력 날짜(date>=cutoff)로 필터링하도록
    변경 - 채권처럼 주5일만 거래되는 심볼과 BTC처럼 주7일 거래되는 심볼을 같은 row 개수로
    비교하면 실제 기간이 서로 달라짐(사용자 지적: 국고채 채권 4종의 참고 기간이 13~20개월로
    제각각이었음 - 전부 정확히 12개월로 통일하기 위함)."""
    days = max(1, min(days, 1000))
    since_date = (datetime.now() - timedelta(days=days)).strftime('%Y%m%d')
    conn = db_schema.get_conn()
    try:
        rows = db_schema.load_future_chart_since(conn, symbol, since_date)
    finally:
        conn.close()
    closes = [r['close'] for r in rows if r.get('close') is not None]
    if not closes:
        raise HTTPException(status_code=404, detail='해당 심볼의 차트 데이터가 없습니다.')
    return envelope({
        'symbol': symbol,
        'days': len(closes),
        'from': rows[0]['date'],
        'to': rows[-1]['date'],
        'avg': sum(closes) / len(closes),
        'min': min(closes),
        'max': max(closes),
    })


@app.get('/naver-news')
def naver_news_endpoint(query: str = Query(..., min_length=1, max_length=100), x_api_key: str = Header(default=None)):
    """네이버 뉴스 검색 프록시(naver_news.py 참고) - GAS(gas/ticker-proxy.gs getRankingNews)가
    직접 네이버를 부르는 대신 이 VM을 거치게 해서, NCP API HUB의 IP 화이트리스트를 이
    VM의 고정 IP 하나로만 등록할 수 있게 한다. GAS->VM 구간은 X-API-Key로 보호(무제한
    공개 프록시로 남 API 할당량을 소진당하지 않도록 - /futures 같은 공개 엔드포인트와
    달리 호출마다 실제 네이버 API 쿼터를 쓰기 때문)."""
    require_api_key(x_api_key)
    client_id = os.environ.get('NAVER_APIHUB_CLIENT_ID')
    client_secret = os.environ.get('NAVER_APIHUB_CLIENT_SECRET')
    items = naver_news.search_news(query, client_id, client_secret)
    return envelope(items)


@app.get('/option-flow')
def option_flow_endpoint():
    """코스피200 옵션(콜/풋) 수급 요약 - option_flow.py가 5분마다 미리 집계해둔 걸 그대로
    반환. 방문자 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만 제한) - /futures와
    동일한 패턴. KIS_APPKEY/APPSECRET 미설정이면 데이터가 비어 있을 수 있음(정상)."""
    conn = db_schema.get_conn()
    try:
        rows = db_schema.load_option_flow(conn)
    finally:
        conn.close()
    return envelope({r['side']: r for r in rows})


@app.get('/market-rank')
def market_rank_endpoint(limit: int = Query(5, ge=1, le=_MARKET_RANK_MAX_LIMIT)):
    """사이드바 실시간 랭킹(거래대금 TOP/상한가/하한가) - 9bolt 우측 사이드바 리디자인
    (작업지시서 2026-07-20). 방문자 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만
    제한) - /futures, /option-flow와 동일한 패턴. 30초 서버 캐시로 실제 키움 호출 빈도를
    낮춘다(market_rank.py 참고). limit: 기본 5(사이드바 미리보기), "더보기" 모달은
    limit=20으로 같은 엔드포인트를 재사용(js/sidebar-rank.js)."""
    now = time.time()
    cached = _market_rank_cache.get(limit)
    if cached is not None and now - cached['t'] < _MARKET_RANK_TTL:
        return envelope(cached['data'])
    try:
        token = get_kiwoom_token()
        data = market_rank.fetch_sidebar_rank(token, limit=limit)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    _market_rank_cache[limit] = {'t': now, 'data': data}
    return envelope(data)


@app.get('/investor-trend')
def investor_trend_endpoint(period: str = Query('week')):
    """메인 페이지 "투자자별 매매 동향" 위젯(작업지시서 #4) - 코스피 시장 전체 개인/외국인/
    기관계 순매수(억원)를 일/주/월 단위로 반환. 방문자 브라우저가 직접 호출(인증 없음, CORS로
    블로그 도메인만 제한) - /futures, /market-rank와 동일한 패턴. investor_trend.py의
    백그라운드 폴러(1분)가 미리 채워둔 SQLite만 읽으므로 요청마다 네이버를 다시 부르지 않는다."""
    if period not in ('day', 'week', 'month'):
        period = 'week'
    try:
        result = investor_trend.get_result(period)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return envelope(result)


@app.get('/week52-batch')
def week52_batch(x_api_key: str = Header(default=None)):
    """week52_scan.py(하루 1회 크론)가 섹터 풀(238종목) 대상으로 미리 계산해둔 52주 신고가/
    신저가 캐시를 즉시 반환. js/market-temp.js(오늘의 증시온도)가 이 집계(newHighCount/
    newLowCount)를 사용한다."""
    require_api_key(x_api_key)
    if not os.path.exists(WEEK52_CACHE_FILE):
        raise HTTPException(status_code=503, detail='52주 신고가/신저가 캐시가 아직 생성되지 않았습니다(week52_scan.py 첫 실행 대기 중).')
    with open(WEEK52_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return envelope(cached)
