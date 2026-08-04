# -*- coding: utf-8 -*-
"""키움 조회 전용 REST API 서버.
실행: uvicorn main:app --host 0.0.0.0 --port 8080
필수 환경변수: KIWOOM_APPKEY, KIWOOM_SECRETKEY, API_TOKEN(이 서버 자체 인증용, 아무 문자열이나 직접 정해서 사용)
선택 환경변수: KIS_APPKEY, KIS_APPSECRET(코스피200 야간선물 - 없으면 /futures에서 이 항목만 빠짐,
서버 전체는 정상 동작). 야간선물 웹소켓 사용하려면 `pip install websockets` 필요.
"""

import asyncio
import hmac
import json
import logging
import os
import time
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Header, HTTPException, Path, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

import bond_yield
import btc_futures
import db_schema
import domestic_futures
import earnings_calendar
import foreign_flow_compute
import foreign_futures
import naver_news
import news_momentum
import investor_flow
import investor_trend
import kis_client
import kiwoom_client
import kiwoom_market
import market_rank
import option_flow
import order_book
import realtime_quotes

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

# 2026-07-31: 응답 gzip 압축. 이 서버의 응답은 전부 반복 구조의 JSON(일봉/분봉 배열)이라
# 압축률이 매우 높은데 그동안 무압축으로 내려가고 있었다 - 방문자 회선이 느릴 때 첫 로딩이
# 오래 걸리던 원인 중 하나(관심지수 리본이 /futures 전체를 받는 것까지 같이 개선된다).
# minimum_size 미만(작은 JSON·프리플라이트)은 그대로 두고, 웹소켓(/ws/quotes)은 대상이 아니다.
app.add_middleware(GZipMiddleware, minimum_size=500)

BATCH_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'investor_flow_cache.json')
FUNDAMENTALS_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fundamentals_cache.json')
DAILY_SCAN_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'daily_scan_cache.json')
WEEK52_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'week52_cache.json')
LATENCY_LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'latency_monitor.log')

# /ohlc, /investor-flow 온디맨드 조회용 메모리 캐시(종목코드 -> (기록시각, 결과)).
# GAS가 이 두 엔드포인트를 호출할 때만 유독 응답이 느려서(타임아웃) 실패하는 현상이 있어
# 재조회는 즉시 응답하도록 방어 - 최초 1회는 여전히 키움 실시간 호출이 필요하다.
# 2026-08-03: 예전엔 개수 상한을 넘으면 cache.clear()로 통째로 비웠는데(무제한 증가 방지),
# 상한에 걸리는 순간 그동안 캐시로 흡수되던 요청이 한꺼번에 콜드패스(키움/KIS 실호출)로
# 몰려 지연 스파이크(thundering herd)를 유발할 수 있었다. OrderedDict 기반 LRU로 바꿔
# 상한 초과 시 가장 오래 전에 쓰인 항목 하나씩만 제거한다 - 나머지 캐시는 그대로 유지되어
# 스파이크 없이 서서히 교체된다.
_LIVE_CACHE_TTL = 300  # 5분
_LIVE_CACHE_MAX_ENTRIES = 500
_ohlc_cache = OrderedDict()
_ohlc_minute_cache = OrderedDict()  # (code, tic_scope) -> (t, data)
_pbar_tratio_cache = OrderedDict()  # code -> (t, data)
_investor_flow_cache_mem = OrderedDict()
_foreign_flow_cache_mem = OrderedDict()
# fundamentals_cache.json 파싱 결과(파일 mtime/크기가 바뀔 때만 재파싱) - /fundamentals/{code}용.
_fundamentals_cache_mem = {}

# 사이드바 랭킹(거래대금/상한가/하한가) - 작업지시서 요구사항(30초~1분 갱신)에 맞춘 짧은
# TTL 캐시. 방문자가 여러 명이어도 30초에 한 번만 키움을 실제로 호출하면 되므로 단일
# 전역값으로 충분(위 _ohlc_cache 같은 종목별 캐시와 달리 키가 하나뿐).
_MARKET_RANK_TTL = 30
_MARKET_RANK_MAX_LIMIT = 20  # 사이드바 미리보기(5)보다 큰 값은 "더보기" 모달 전용
_market_rank_cache = {}  # limit -> {'t':.., 'data':..} - limit별로 따로 캐시(5는 30초마다 폴링, 20은 모달 열 때만)

# 캘린더의 Google Calendar 이벤트와 병합하는 자동 실적발표 피드 캐시.
# 2026-08-03: 다른 메모리 캐시와 달리 상한/정리 로직이 아예 없었다 - year(2000~2100)x
# month(1~12) 조합이 최대 1,212개로 사실상 무한 증가는 아니지만, 나머지 캐시와 동일한
# 방어 수준으로 맞춘다.
_earnings_calendar_cache = OrderedDict()
_EARNINGS_CALENDAR_TTL = 10 * 60
_EARNINGS_CALENDAR_MAX_ENTRIES = 200

# 호가창(js/order-book.js) - 프론트가 2초 간격으로 폴링하므로 서버 캐시는 그보다 짧게 걸어
# 같은 종목을 여러 탭/방문자가 동시에 보고 있어도 키움 호출은 한 번으로 묶는다.
_ORDER_BOOK_TTL = 1.5
_order_book_cache = OrderedDict()  # code -> {'t':.., 'data':..}

# /futures는 홈의 관심지수 리본(js/quick-indices.js, 20초 폴링 - 2026-07-27부터 홈에서만
# 렌더)·코스피 선물 페이지(30초 폴링)·GAS AI 해설(gas/ticker-proxy.gs가 서버사이드로 또 호출)이
# 같은 데이터를 각자 조회한다 - 방문자가 여러 명이면 같은 쿼리가 계속 겹쳐 DB를 반복해서
# 읽고 있었다(2026-07-31 "첫 로딩 30초" 신고).
# 수집 주기(실시간 30초 폴링, 분봉 5분)보다 짧은 TTL이라 신선도 손실 없이 중복 조회만 없앤다
# (_market_rank_cache와 동일 패턴).
_FUTURES_TTL = 10
_futures_cache = OrderedDict()  # (interval, days, symbols) -> {'t':.., 'data':..}


def _evict_lru(cache, max_entries):
    """OrderedDict 캐시가 max_entries를 넘으면 가장 오래 전에 쓰인 항목부터 하나씩만
    제거한다(2026-08-03, cache.clear() 전량비움 대체 - thundering herd 방지)."""
    while len(cache) > max_entries:
        cache.popitem(last=False)


def _live_cache_get(cache, code):
    entry = cache.get(code)
    if entry and time.time() - entry[0] < _LIVE_CACHE_TTL:
        cache.move_to_end(code)
        return entry[1]
    return None


def _live_cache_put(cache, code, value):
    cache[code] = (time.time(), value)
    cache.move_to_end(code)
    _evict_lru(cache, _LIVE_CACHE_MAX_ENTRIES)


# 2026-08-03: /investor-flow, /foreign-flow, /order-book는 인증 없이 공개된 데다(CORS는
# 서버-서버 호출을 막지 못함) 종목코드(+옵션)별로 캐시가 나뉘어 있어, 코드를 기계적으로
# 순회하면 캐시를 우회해 매번 키움/KIS 실호출을 유도할 수 있다(외부 API 쿼터 소진 벡터).
# IP당 라우트별 분당 상한을 넉넉하게 둬서 정상적인 방문자 탐색(수동 클릭)은 막지 않으면서
# 기계적 순회만 걸러낸다. 단일 프로세스 메모리 상태라 재시작 시 초기화되며, 무제한 증가
# 방지로 추적 중인 (라우트,IP) 키 수가 상한을 넘으면 통째로 비운다(방문자 IP 다양성이
# 극단적으로 클 때만 발생하는 드문 경로라 단순하게 처리).
_RATE_LIMIT_WINDOW_SEC = 60
_RATE_LIMIT_MAX_PER_WINDOW = 30
_RATE_LIMIT_MAX_TRACKED_KEYS = 5000
_rate_limit_buckets = {}  # (route_name, ip) -> deque[timestamp]


def _check_rate_limit(route_name, request, max_per_window=None):
    ip = request.client.host if request.client else 'unknown'
    key = (route_name, ip)
    now = time.time()
    bucket = _rate_limit_buckets.setdefault(key, deque())
    while bucket and now - bucket[0] > _RATE_LIMIT_WINDOW_SEC:
        bucket.popleft()
    limit = max_per_window if max_per_window is not None else _RATE_LIMIT_MAX_PER_WINDOW
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail='요청이 너무 많습니다. 잠시 후 다시 시도해주세요.')
    bucket.append(now)
    if len(_rate_limit_buckets) > _RATE_LIMIT_MAX_TRACKED_KEYS:
        _rate_limit_buckets.clear()


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
    # 2026-08-03: 일반 문자열 비교(!=)는 단락 평가라 이론적으로 타이밍 사이드채널에 노출될 수
    # 있어 상수시간 비교로 교체. hmac.compare_digest는 두 인자 모두 str 또는 둘 다 bytes여야
    # 하므로 헤더 누락 시 빈 문자열로 맞춘다.
    if not hmac.compare_digest(x_api_key or '', expected):
        raise HTTPException(status_code=401, detail='invalid or missing X-API-Key header')


def get_kiwoom_token():
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        raise HTTPException(status_code=500, detail='서버에 KIWOOM_APPKEY/KIWOOM_SECRETKEY가 설정되지 않았습니다.')
    return kiwoom_client.get_token(appkey, secretkey)


@app.get('/health')
def health():
    return envelope({
        'status': 'ok',
        'deployGuardVersion': 2,
        'momentumSchedulerVersion': 'deploy-timer-flock-v1',
        'momentumAggregationVersion': 3,
    })


@app.get('/health/latency')
def latency_health(lines: int = Query(50, ge=1, le=500)):
    """latency_monitor.py(deploy_check.sh가 5분마다 백그라운드로 실행)가 남기는 로컬
    엔드포인트 응답시간 로그의 최근 N줄을 그대로 반환한다. 2026-08-03 VM 장애 진단 때
    "느려진 것 같다"를 확인하려면 매번 VM에 SSH 접속해 직접 curl -w로 재야 했던 걸,
    브라우저·curl로 바로 확인할 수 있게 하려는 목적이다. 인증 없음(민감정보 없는 응답시간
    수치뿐이라 /futures·/market-rank와 동일하게 공개) + CORS는 기본 미들웨어 설정을 그대로 따른다."""
    if not os.path.exists(LATENCY_LOG_FILE):
        return envelope({'lines': [], 'message': '아직 기록이 없습니다(다음 5분 배포 주기부터 쌓입니다).'})
    with open(LATENCY_LOG_FILE, 'r', encoding='utf-8') as f:
        all_lines = f.readlines()
    tail = [line.rstrip('\n') for line in all_lines[-lines:]]
    return envelope({'lines': tail})


_WS_MAX_CONNECTIONS = 200  # 2026-08-03: 동시 연결 수 상한 - Origin 헤더는 브라우저만 신뢰할
# 수 있는 값이라(비-브라우저 클라이언트가 임의로 설정 가능) 완전한 인증은 아니지만, 최소한
# 이 상한으로 키움 실시간 세션/서버 스레드 자원 고갈을 막는다.
_ws_active_connections = 0


@app.websocket('/ws/quotes')
async def realtime_quote_socket(websocket: WebSocket):
    """관심종목용 실시간 체결가 중계. 키움 토큰은 서버 안에서만 사용한다."""
    global _ws_active_connections
    origin = websocket.headers.get('origin')
    if origin != 'https://ghlee.tistory.com':
        await websocket.close(code=1008)
        return

    codes = realtime_quotes.normalize_codes((websocket.query_params.get('codes') or '').split(','))
    if not codes:
        await websocket.close(code=1008)
        return

    if _ws_active_connections >= _WS_MAX_CONNECTIONS:
        await websocket.close(code=1013)  # Try Again Later
        return

    await websocket.accept()
    _ws_active_connections += 1
    relay_task = asyncio.create_task(realtime_quotes.relay_quotes(websocket, codes))
    receive_task = asyncio.create_task(websocket.receive_text())
    try:
        while True:
            done, _ = await asyncio.wait(
                {relay_task, receive_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if relay_task in done:
                await relay_task
                return
            receive_task = asyncio.create_task(websocket.receive_text())
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logging.getLogger('main').warning(
            '관심종목 WebSocket 종료: %s', type(exc).__name__
        )
        try:
            await websocket.send_json({'type': 'error', 'message': '실시간 시세 연결이 종료되었습니다.'})
        except Exception:
            pass
    finally:
        _ws_active_connections -= 1
        for task in (relay_task, receive_task):
            if not task.done():
                task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


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


@app.get('/ohlc-minute/{code}')
def ohlc_minute(request: Request, code: str = Path(..., min_length=6, max_length=6),
                 tic_scope: str = Query('1')):
    """분봉 OHLC(ka10080) 온디맨드 조회 - js/stock-search.js 분봉 탭이 브라우저에서 직접 호출.
    2026-08-03: /ohlc(ka10081, 일봉, GAS 경유)와 달리 이건 /order-book, /foreign-flow와
    동일하게 공개(인증 없음) + CORS(ghlee.tistory.com만) + rate limit 패턴을 쓴다 - VM 시크릿을
    프론트 JS에 박아넣지 않기 위함. 실호출로 필드명(stk_min_pole_chart_qry 등) 검증 완료."""
    _check_rate_limit('ohlc_minute', request)
    if tic_scope not in kiwoom_market.MINUTE_TIC_SCOPES:
        raise HTTPException(status_code=400, detail='tic_scope는 1/3/5/10/15/30/45/60 중 하나여야 합니다.')
    cache_key = (code, tic_scope)
    cached = _live_cache_get(_ohlc_minute_cache, cache_key)
    if cached is not None:
        return envelope(cached)
    try:
        token = get_kiwoom_token()
        minute = kiwoom_market.fetch_minute_ohlc(token, code, tic_scope=tic_scope)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not minute:
        raise HTTPException(status_code=404, detail='분봉 데이터를 찾을 수 없습니다.')
    _live_cache_put(_ohlc_minute_cache, cache_key, minute)
    return envelope(minute)


_VOLUME_PROFILE_PRUNE_INTERVAL_SEC = 3600
_VOLUME_PROFILE_RETENTION_DAYS = 200  # 120거래일 + 주말/휴장일 여유분
_last_volume_profile_prune = [0.0]  # 리스트에 담아 클로저 밖에서도 재할당 가능하게


def _maybe_prune_volume_profile():
    now = time.time()
    if now - _last_volume_profile_prune[0] < _VOLUME_PROFILE_PRUNE_INTERVAL_SEC:
        return
    _last_volume_profile_prune[0] = now
    try:
        cutoff = (datetime.now(timezone.utc) + timedelta(hours=9) - timedelta(days=_VOLUME_PROFILE_RETENTION_DAYS)).strftime('%Y-%m-%d')
        conn = db_schema.get_conn()
        db_schema.prune_volume_profile_daily(conn, cutoff)
        conn.close()
    except Exception:
        logging.getLogger('main').exception('volume_profile_daily 정리 실패')


@app.get('/pbar-tratio/{code}')
def pbar_tratio(request: Request, code: str = Path(..., min_length=6, max_length=6),
                 days: int = Query(1, ge=1, le=120)):
    """가격대별 매물대(KIS FHPST01130000, [국내주식-196]) 온디맨드 조회 - 종목분석 매물대
    카드의 "실제 체결가" 뷰가 브라우저에서 직접 호출(js/foreign-flow.js wireAptTabs).
    KIS pbar-tratio 자체는 "오늘"치만 주지만(days=1과 동일), days>1이면 이 엔드포인트가
    호출될 때마다(=사용자가 실제로 조회한 종목만, 배치 없음) volume_profile_daily에 그날
    최신 누적 스냅샷을 UPSERT해두고, 저장된 과거 거래일과 오늘 실시간 응답을 가격별로
    합산해 반환한다 - 그래서 "최근 N일"은 항상 정확히 최근 N거래일이 아니라 "조회된 적
    있는 날짜 중 최근 N개"다(db_schema.load_volume_profile_days 참고, 뜸하게 조회되는
    종목은 커버리지가 듬성듬성할 수 있음 - 응답의 daysIncluded로 실제 반영된 거래일 수를
    알 수 있다). 응답의 avgPrice는 이 bins(실제 체결가·체결거래량) 기준 거래량 가중평균가
    (VWAP)로, 사용자가 자기 평단과 비교해볼 수 있게 계산해 넣는다. KIS_APPKEY/APPSECRET
    미설정이면(선택 환경변수) 503. /ohlc-minute와 동일하게 공개(인증 없음) + CORS +
    rate limit 패턴."""
    _check_rate_limit('pbar_tratio', request)
    kis_appkey = os.environ.get('KIS_APPKEY')
    kis_appsecret = os.environ.get('KIS_APPSECRET')
    if not kis_appkey or not kis_appsecret:
        raise HTTPException(status_code=503, detail='서버에 KIS_APPKEY/KIS_APPSECRET가 설정되지 않았습니다.')
    cache_key = (code, days)
    cached = _live_cache_get(_pbar_tratio_cache, cache_key)
    if cached is not None:
        return envelope(cached)
    try:
        kis_token = kis_client.get_token(kis_appkey, kis_appsecret)
        summary, rows = kis_client.fetch_pbar_tratio(kis_token, kis_appkey, kis_appsecret, code)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    today_bins = {}
    for r in rows:
        price = kiwoom_market.to_num(r.get('stck_prpr'))
        volume = kiwoom_market.to_num(r.get('cntg_vol'))
        if price <= 0:
            continue
        today_bins[price] = today_bins.get(price, 0) + volume
    if not today_bins:
        raise HTTPException(status_code=404, detail='매물대 데이터를 찾을 수 없습니다.')

    today_kst = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime('%Y-%m-%d')
    days_included = 1
    try:
        conn = db_schema.get_conn()
        db_schema.upsert_volume_profile_daily(
            conn, code, today_kst,
            [{'price': p, 'volume': v} for p, v in today_bins.items()],
        )
        if days > 1:
            hist_bins, hist_days = db_schema.load_volume_profile_days(conn, code, days - 1, exclude_date=today_kst)
            for h in hist_bins:
                today_bins[h['price']] = today_bins.get(h['price'], 0) + h['volume']
            days_included += hist_days
        conn.close()
    except Exception:
        logging.getLogger('main').exception('volume_profile_daily 저장/조회 실패(%s) - 오늘 응답만으로 계속 진행', code)
    _maybe_prune_volume_profile()

    bins = sorted(({'price': p, 'volume': v} for p, v in today_bins.items()), key=lambda b: b['price'])
    total_volume = sum(today_bins.values())
    # 평균단가(VWAP) = Σ(가격×거래량) / Σ(거래량) - price/volume이 실제 체결가·체결거래량
    # 이라 그대로 계산 가능(비중%이 아님, kis_client.fetch_pbar_tratio 독스트링 참고).
    avg_price = (sum(p * v for p, v in today_bins.items()) / total_volume) if total_volume > 0 else None
    result = {
        'currentPrice': kiwoom_market.to_num(summary.get('stck_prpr')) or None,
        'avgPrice': avg_price,
        'daysIncluded': days_included,
        'bins': bins,
    }
    _live_cache_put(_pbar_tratio_cache, cache_key, result)
    return envelope(result)


@app.get('/investor-flow/{code}')
def investor_flow_endpoint(request: Request, code: str = Path(..., min_length=6, max_length=6), name: str = Query('')):
    """공매도/대차거래/연기금 수급 - scripts/fetch_investor_flow.py 로직 온디맨드 버전.
    2026-07-13: GAS를 거치지 않고 브라우저(js/foreign-flow.js)가 직접 호출하도록 전환됨
    (GAS->VM 구간 간헐적 장애 우회) - 그래서 X-API-Key 인증이 없다(CORS로만 제한, 위 주석
    참고). 2026-07-22: name은 원래 화면표시용 캐스메틱 필드라 안 받았는데, "위험" 승격
    게이트(investor_flow.apply_danger_override)가 KRX 공시 RSS에서 종목명으로 매칭해야 해서
    다시 필요해짐 - 프론트(js/foreign-flow.js)가 검색 시 이미 아는 한글명을 그대로 보내준다.
    캐시 키는 code만 쓰므로(동일 종목은 이름이 바뀌지 않음) name 누락 시(구버전 캐시 프론트 등)
    빈 문자열로 게이트만 조용히 꺼짐. 5분 메모리 캐시 적용."""
    _check_rate_limit('investor_flow', request)
    cached = _live_cache_get(_investor_flow_cache_mem, code)
    if cached is not None:
        return envelope(cached)
    try:
        token = get_kiwoom_token()
        result = investor_flow.fetch_stock(token, code, name)
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
def foreign_flow_endpoint(request: Request, code: str = Path(..., min_length=6, max_length=6),
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
    _check_rate_limit('foreign_flow', request)
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
    추세 + 최근 분기 YoY) 캐시를 즉시 반환. /investor-flow-batch와 동일한 서빙 패턴.
    단일 종목 조회는 /fundamentals/{code}를 쓴다 - 이 엔드포인트는 배치 소비자 전용."""
    require_api_key(x_api_key)
    if not os.path.exists(FUNDAMENTALS_CACHE_FILE):
        raise HTTPException(status_code=503, detail='펀더멘탈 캐시가 아직 생성되지 않았습니다(batch_scan.py 첫 실행 대기 중).')
    with open(FUNDAMENTALS_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return envelope(cached)


def load_fundamentals_cache_cached():
    """fundamentals_cache.json을 mtime이 바뀔 때만 다시 파싱해 메모리에 보관한다.
    전 종목 캐시라 파일이 크고, 단건 조회마다 재파싱하면 응답이 느려진다."""
    global _fundamentals_cache_mem
    if not os.path.exists(FUNDAMENTALS_CACHE_FILE):
        return None
    stat = os.stat(FUNDAMENTALS_CACHE_FILE)
    signature = (stat.st_mtime_ns, stat.st_size)
    if _fundamentals_cache_mem.get('signature') != signature:
        with open(FUNDAMENTALS_CACHE_FILE, 'r', encoding='utf-8') as f:
            cached = json.load(f)
        _fundamentals_cache_mem = {
            'signature': signature,
            'data': cached.get('data') or {},
            'fetchedAt': cached.get('fetchedAt') or {},
        }
    return _fundamentals_cache_mem


@app.get('/fundamentals/{code}')
def fundamentals_single(code: str = Path(..., min_length=6, max_length=6),
                        x_api_key: str = Header(default=None)):
    """종목분석 펀더멘탈 탭용 단건 조회. GAS가 종목 하나를 보여주려고 전 종목 배치
    캐시(/fundamentals-batch, 수 MB)를 통째로 받아 파싱하던 걸 대체한다.
    데이터 소스와 계산은 그대로이고 응답에서 해당 종목만 잘라 준다.
    캐시에 없는 종목(DART 미제출·최근 상장·아직 스캔 전)은 fundamentals: null."""
    require_api_key(x_api_key)
    cache = load_fundamentals_cache_cached()
    if cache is None:
        raise HTTPException(status_code=503, detail='펀더멘탈 캐시가 아직 생성되지 않았습니다(batch_scan.py 첫 실행 대기 중).')
    return envelope({
        'code': code,
        'fundamentals': cache['data'].get(code),
        'fetchedAt': cache['fetchedAt'].get(code),
    })


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
def futures(interval: str = 'day', days: int = 90, symbols: str = ''):
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
    미결제약정(oi/oi_change) 필드 노출(야간선물만 값이 있고 나머지 심볼은 null).
    2026-07-31: symbols(쉼표 구분) 파라미터 추가 - 응답에 실을 심볼을 아래 order 화이트리스트
    안에서만 좁힌다. 코스피 선물 페이지는 선물 2개만 쓰는데 21개 심볼 전체를 매번 받아
    분봉 요청이 브라우저 타임아웃(10초)에 걸리던 문제 대응. 미지정이면 기존과 완전히 동일하게
    전체를 반환하므로 관심지수 리본/보조지수 등 기존 호출부는 영향 없다.
    2026-07-31(2차): 같은 파라미터 조합에 대한 짧은 TTL 메모리 캐시(_FUTURES_TTL) 추가 -
    리본/페이지/GAS가 같은 쿼리를 겹쳐 호출하던 중복 DB 조회를 없앤다."""
    days = max(1, min(days, 500))
    started = time.time()
    cache_key = (interval, days, symbols)
    cached = _futures_cache.get(cache_key)
    if cached is not None and started - cached['t'] < _FUTURES_TTL:
        return envelope(cached['data'])
    conn = db_schema.get_conn()
    try:
        prices = {p['symbol']: p for p in db_schema.load_all_future_prices(conn)}
        # 주의: 새 심볼을 수집기(foreign_futures.SYMBOLS 등)에 추가하면 이 목록에도 같이
        # 넣어야 응답에 실린다(2026-07-17 GOLD 추가 때 빠뜨려서 한 번 헛배포함).
        order = ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'DOW_INDEX', 'NASDAQ100', 'SP500', 'DOW',
                 'KOSPI200_DAY', 'KOSPI200_NIGHT', 'SOX', 'VIX', 'WTI', 'GOLD', 'USDKRW',
                 'KTB3Y', 'US10Y', 'US2Y', 'US30Y', 'BTC', 'ETH']
        # 화이트리스트 교집합만 사용한다 - 모르는 심볼명으로 임의 조회가 되지 않게, 그리고
        # 매칭이 하나도 없으면(오타 등) 빈 응답 대신 기존 전체 동작으로 폴백한다.
        if symbols:
            wanted = set(s.strip().upper() for s in symbols.split(',') if s.strip())
            narrowed = [s for s in order if s in wanted]
            if narrowed:
                order = narrowed
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
    _futures_cache[cache_key] = {'t': started, 'data': result}
    _futures_cache.move_to_end(cache_key)
    _evict_lru(_futures_cache, 50)  # 2026-08-03: 전량비움 대신 LRU 1건씩 제거
    # 첫 로딩이 느릴 때 원인을 로그로 좁히기 위한 측정 - 정상 구간(수백 ms)에서는 조용하다.
    elapsed = time.time() - started
    if elapsed > 1.0:
        logging.getLogger('main').warning(
            '/futures 응답 %.1fs (interval=%s days=%d symbols=%s rows=%d)',
            elapsed, interval, days, symbols or '-', sum(len(r['chart']) for r in result))
    return envelope(result)


@app.get('/earnings-calendar')
def earnings_calendar_endpoint(year: int = Query(..., ge=2000, le=2100), month: int = Query(..., ge=1, le=12)):
    """DART에 실제 접수된 잠정실적/실적 공시를 캘린더 이벤트로 반환한다.

    미래 발표일을 추정하지 않고, DART 접수일만 사용한다. DART 키가 없거나
    외부 조회가 실패하면 빈 배열을 반환해 기존 Google Calendar 일정은 유지한다.
    """
    key = '%04d-%02d' % (year, month)
    cached = _earnings_calendar_cache.get(key)
    if cached and time.time() - cached['t'] < _EARNINGS_CALENDAR_TTL:
        return {'success': True, 'data': cached['data'], 'source': 'dart', 'cached': True}
    data = earnings_calendar.safe_fetch_month(year, month)
    _earnings_calendar_cache[key] = {'t': time.time(), 'data': data}
    _earnings_calendar_cache.move_to_end(key)
    _evict_lru(_earnings_calendar_cache, _EARNINGS_CALENDAR_MAX_ENTRIES)
    return {'success': True, 'data': data, 'source': 'dart', 'cached': False}


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


@app.get('/news-momentum/{code}')
def news_momentum_endpoint(code: str = Path(..., min_length=6, max_length=6)):
    """배치가 미리 계산한 뉴스 반복 이슈·DataLab 검색 관심도를 종목 단위로 반환한다.
    외부 API를 호출하지 않고 별도 news_momentum.db만 읽는다."""
    enabled = os.environ.get('NEWS_MOMENTUM_ENABLED', '1').strip().lower()
    if enabled not in ('1', 'true', 'yes', 'on'):
        status = None
        batch_status = None
        status_file = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   'news_momentum_status.json')
        batch_status_file = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         'news_momentum_batch_status.json')
        if os.path.exists(status_file):
            try:
                with open(status_file, 'r', encoding='utf-8') as source:
                    status = json.load(source)
            except (OSError, ValueError):
                status = None
        if os.path.exists(batch_status_file):
            try:
                with open(batch_status_file, 'r', encoding='utf-8') as source:
                    batch_status = json.load(source)
            except (OSError, ValueError):
                batch_status = None
        return envelope({
            'enabled': False,
            'stockCode': code,
            'stockName': None,
            'dataAsOf': None,
            'coverage': None,
            'deploymentStatus': status,
            'batchStatus': batch_status,
            'topics': [],
        })
    if not os.path.exists(news_momentum.DB_FILE):
        return envelope({
            'enabled': True,
            'stockCode': code,
            'stockName': None,
            'dataAsOf': None,
            'coverage': None,
            'topics': [],
        })
    conn = news_momentum.get_conn()
    try:
        result = news_momentum.load_stock_momentum(conn, code)
    finally:
        conn.close()
    result['enabled'] = True
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


@app.get('/order-book/{code}')
def order_book_endpoint(request: Request, code: str = Path(..., min_length=6, max_length=6)):
    """호가창(매도/매수 각 10단계) + 최근 체결(ka10003) - 독립 페이지(js/order-book.js,
    2026-07-27)가 2초 간격 폴링. 방문자 브라우저가 직접 호출(인증 없음, CORS로 블로그
    도메인만 제한) - /futures, /market-rank와 동일한 패턴. order_book.py 필드명 미검증
    안내 참고. 2초 폴링(분당 30회)이 정상 트래픽이라 rate limit은 여유를 둬서 분당 60회로
    맞춘다(정상 사용은 절반만 소비, 종목코드 기계적 순회만 걸러냄)."""
    _check_rate_limit('order_book', request, max_per_window=60)
    now = time.time()
    cached = _order_book_cache.get(code)
    if cached is not None and now - cached['t'] < _ORDER_BOOK_TTL:
        return envelope(cached['data'])
    try:
        token = get_kiwoom_token()
        data = order_book.fetch_order_book_full(token, code)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    _order_book_cache[code] = {'t': now, 'data': data}
    _order_book_cache.move_to_end(code)
    _evict_lru(_order_book_cache, 200)  # 2026-08-03: 전량비움 대신 LRU 1건씩 제거
    return envelope(data)


@app.get('/_diag/execution-strength/{code}')
def execution_strength_diag(request: Request, code: str = Path(..., min_length=6, max_length=6)):
    """임시 진단용(2026-08-05) - ka10046(체결강도추이시간별) 원본 응답을 그대로 노출해
    실제 리스트 감싸는 키를 확인한다. 필드명이 확정되면 order-book HUD의 근사치 체결강도를
    실제 값으로 교체하고 이 엔드포인트는 지운다."""
    _check_rate_limit('execution_strength_diag', request, max_per_window=10)
    try:
        token = get_kiwoom_token()
        raw = order_book.fetch_execution_strength_raw(token, code)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return envelope(raw)


@app.get('/investor-trend')
def investor_trend_endpoint(period: str = Query('week'), market: str = Query('kospi')):
    """메인 페이지 "투자자별 매매 동향" 위젯(작업지시서 #4 + UI개선 지시서 2026-07-21) - 시장별
    (코스피/코스닥) 개인/외국인/기관계 순매수(억원)를 일/주/월 단위로 반환. 방문자 브라우저가
    직접 호출(인증 없음, CORS로 블로그 도메인만 제한) - /futures, /market-rank와 동일한 패턴.
    investor_trend.py의 백그라운드 폴러(1분)가 시장별로 미리 채워둔 SQLite만 읽으므로
    요청마다 실시간 호출을 다시 하지 않는다. market이 모르는 값이면 investor_trend.get_result가
    코스피로 처리한다(선물은 데이터 소스가 없어 미지원 - investor_trend.py 모듈 독스트링 참고)."""
    if period not in ('day', 'week', 'month'):
        period = 'week'
    try:
        result = investor_trend.get_result(period, market)
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
