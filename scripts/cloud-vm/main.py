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
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware

import db_schema
import domestic_futures
import foreign_flow_compute
import foreign_futures
import investor_flow
import kiwoom_client
import kiwoom_market
import option_flow

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

    kis_appkey = os.environ.get('KIS_APPKEY')
    kis_appsecret = os.environ.get('KIS_APPSECRET')
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


@app.get('/debug-ka10059/{code}')
def debug_ka10059(code: str = Path(..., min_length=6, max_length=6)):
    """임시 진단용 - ka10059 원본 응답/예외를 그대로 노출한다(kiwoom_market._fetch_live_investor_row가
    None을 리턴할 때 원인을 밝히기 위함, 확인 끝나면 삭제할 것)."""
    end_dt = datetime.now().strftime('%Y%m%d')
    try:
        token = get_kiwoom_token()
        res = kiwoom_client.call_tr(token, 'ka10059', '/api/dostk/stkinfo', {
            'stk_cd': code, 'dt': end_dt, 'amt_qty_tp': '1', 'trde_tp': '0', 'unit_tp': '1',
        })
        return envelope({'end_dt': end_dt, 'raw': res})
    except Exception as e:
        return envelope({'end_dt': end_dt, 'error': str(e)})


@app.get('/foreign-flow/{code}')
def foreign_flow_endpoint(code: str = Path(..., min_length=6, max_length=6)):
    """종목분석 메인 수급 표(외국인·기관 순매매) - 2026-07-13: 네이버 frgn.naver 크롤링을
    1차로 대체하는 키움 API 버전(ka10045+ka10008). 네이버 크롤링은 이제 백업 전용 -
    프론트(js/foreign-flow.js)가 이 엔드포인트를 먼저 시도하고 실패할 때만 GAS의
    ?action=foreignFlow(네이버 경로)로 폴백한다. /investor-flow와 동일하게 공개(인증 없음)
    + CORS 제한 + 5분 메모리 캐시."""
    cached = _live_cache_get(_foreign_flow_cache_mem, code)
    if cached is not None:
        return envelope(cached)
    try:
        token = get_kiwoom_token()
        daily = kiwoom_market.fetch_foreign_inst_daily(token, code)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    result = foreign_flow_compute.build_result(code, daily)
    if result is None:
        raise HTTPException(status_code=404, detail='수급 데이터를 찾을 수 없습니다.')
    _live_cache_put(_foreign_flow_cache_mem, code, result)
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
        order = ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'DOW_INDEX', 'NASDAQ100', 'SP500', 'DOW',
                 'KOSPI200_DAY', 'KOSPI200_NIGHT', 'SOX', 'VIX', 'WTI', 'USDKRW']
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
