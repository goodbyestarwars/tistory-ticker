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
import secrets
import time
import urllib.parse
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Header, HTTPException, Path, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse

import bond_yield
import btc_futures
import dart_client
import db_schema
import domestic_futures
import domestic_market_indicators
import domestic_news
import earnings_calendar
import finnhub_realtime
import foreign_flow_compute
import foreign_futures
import naver_news
import news_aggregator
import news_momentum
import investor_flow
import investor_trend
import kis_client
import kiwoom_client
import kiwoom_market
import market_rank
import market_board
import option_flow
import order_book
import public_data
import realtime_quotes
import sector_cards
import us_analysis
import us_stocks
import watchlist
from google_auth import GoogleAuthError, GoogleAuthService

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
    if db_schema.load_sector_cards_config(conn) is None:
        seeded = sector_cards.load_static_sector_map()
        db_schema.save_sector_cards_config(
            conn,
            seeded,
            datetime.now(timezone.utc).isoformat(),
        )
        logging.getLogger('main').info('seeded sector card configuration from data/sectors-v3.js')
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

    # 2026-08-05: 사이드바 실시간 랭킹도 다른 실시간 수집기와 동일하게 백그라운드 폴링으로
    # 전환 - /market-rank 요청 경로에서 키움을 직접 호출하지 않게 한다(아래 market_rank_endpoint
    # 주석 참고). KIWOOM_APPKEY/SECRETKEY는 이 서버의 필수 환경변수(모듈 상단 독스트링)라
    # 보통 항상 있지만, 다른 수집기들과 동일한 방어 수준으로 미설정 시에는 건너뛴다.
    if kiwoom_appkey and kiwoom_secretkey:
        market_rank.start_background(kiwoom_appkey, kiwoom_secretkey)
    else:
        logging.getLogger('main').warning('KIWOOM_APPKEY/KIWOOM_SECRETKEY 미설정 - 실시간 랭킹 백그라운드 수집 건너뜀')

# 2026-07-13: GAS->VM 구간이 간헐적으로 통째로 막히는 원인 불명 현상 때문에, /investor-flow는
# GAS를 거치지 않고 방문자 브라우저(js/foreign-flow.js)가 이 VM을 직접 호출하도록 우회.
# 브라우저 직접 호출이라 X-API-Key를 넘길 수 없어 이 라우트만 인증 없이 열되(공개 시세
# 데이터라 민감정보 아님), CORS로 블로그 도메인에서만 정상 호출되게 제한한다.
ALLOWED_BROWSER_ORIGINS = [
    'https://ghlee.tistory.com',
    'https://goodbyestarwars.tistory.com',
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_BROWSER_ORIGINS,
    allow_methods=['GET', 'PUT', 'OPTIONS'],
    allow_headers=['*'],
    allow_credentials=True,
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
STRATEGY_SCAN_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strategy_scan_cache.json')
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
# 2026-08-05 사용자 리포트: 실시간 시세 분봉 탭이 60초마다 재조회하도록 프론트를 고쳤는데도
# 화면이 최대 5분(_LIVE_CACHE_TTL)까지 그대로였다 - 이 캐시가 프론트 폴링 주기보다 훨씬
# 길어서 대부분의 재요청이 그냥 5분 전 캐시를 그대로 돌려받고 있었다. 분봉만 프론트 폴링
# 주기(60초)에 맞춰 짧게 둔다(다른 엔드포인트의 _LIVE_CACHE_TTL은 그대로 - 분봉만의 문제였음).
_OHLC_MINUTE_CACHE_TTL = 60
_ohlc_cache = OrderedDict()
_ohlc_minute_cache = OrderedDict()  # (code, tic_scope) -> (t, data)
_pbar_tratio_cache = OrderedDict()  # code -> (t, data)
_investor_flow_cache_mem = OrderedDict()
_foreign_flow_cache_mem = OrderedDict()
# fundamentals_cache.json 파싱 결과(파일 mtime/크기가 바뀔 때만 재파싱) - /fundamentals/{code}용.
_fundamentals_cache_mem = {}

# 사이드바 랭킹(거래대금/상한가/하한가). 2026-08-05부터 정상 상태에서는 market_rank.py의
# 백그라운드 폴러(market_rank.get_cached())가 요청을 전부 처리하고, 이 캐시는 서버 기동
# 직후(백그라운드가 아직 한 번도 못 채운 순간)에만 쓰는 온디맨드 폴백이다 - 그 좁은 창에서도
# 방문자가 몰리면 키움을 매번 호출하지 않도록 짧은 TTL을 그대로 유지한다.
_MARKET_RANK_TTL = 30
_MARKET_RANK_MAX_LIMIT = 20  # 사이드바 미리보기(5)보다 큰 값은 "더보기" 모달 전용
_market_rank_cache = {}  # limit -> {'t':.., 'data':..} - limit별로 따로 캐시(기동 직후 폴백 전용)
_MARKET_BOARD_TTL = 30
# WebSocket quote ticks use this opt-in path to refresh rankings quickly while
# keeping ordinary home summary requests on the 30-second shared cache.
_MARKET_BOARD_LIVE_TTL = 5
_market_board_cache = {}
_KOFIA_MARKET_TTL = 30 * 60
_kofia_market_cache = {}
_DOMESTIC_MARKET_INDICATORS_TTL = 60
_domestic_market_indicators_cache = None

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
_sector_cards_cache = None


def _evict_lru(cache, max_entries):
    """OrderedDict 캐시가 max_entries를 넘으면 가장 오래 전에 쓰인 항목부터 하나씩만
    제거한다(2026-08-03, cache.clear() 전량비움 대체 - thundering herd 방지)."""
    while len(cache) > max_entries:
        cache.popitem(last=False)


def _live_cache_get(cache, code, ttl=_LIVE_CACHE_TTL):
    entry = cache.get(code)
    if entry and time.time() - entry[0] < ttl:
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

GOOGLE_AUTH = GoogleAuthService()


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


def require_google_admin(request: Request):
    if not GOOGLE_AUTH.configured:
        raise HTTPException(status_code=503, detail='Google login is not configured on the server')
    session = GOOGLE_AUTH.read_session(request.cookies.get(GOOGLE_AUTH.SESSION_COOKIE))
    if not session or session.get('email') != GOOGLE_AUTH.admin_email:
        raise HTTPException(status_code=401, detail='Google admin login is required')
    return session


def require_google_user(request: Request):
    if not GOOGLE_AUTH.configured:
        raise HTTPException(status_code=503, detail='Google login is not configured on the server')
    session = GOOGLE_AUTH.read_session(request.cookies.get(GOOGLE_AUTH.SESSION_COOKIE))
    if not session or not session.get('sub') or not session.get('email'):
        raise HTTPException(status_code=401, detail='Google login is required')
    return session


def require_sector_cards_editor(request: Request, x_api_key: str):
    # Keep the legacy token only until Google OAuth is configured. Once the
    # OAuth client is configured, browser writes must use the owner session.
    if GOOGLE_AUTH.configured:
        return require_google_admin(request)
    require_api_key(x_api_key)
    return None


def _google_auth_error_redirect(reason):
    separator = '&' if '?' in GOOGLE_AUTH.success_redirect else '?'
    location = GOOGLE_AUTH.success_redirect + separator + 'google_auth_error=' + urllib.parse.quote(reason, safe='')
    return RedirectResponse(location=location, status_code=303)


def _safe_google_return_url(value):
    fallback = GOOGLE_AUTH.success_redirect
    parsed = urllib.parse.urlparse(str(value or ''))
    if parsed.scheme != 'https' or parsed.netloc != 'ghlee.tistory.com':
        return fallback
    return str(value)


def _load_sector_cards_cached():
    global _sector_cards_cache
    if _sector_cards_cache is not None:
        return _sector_cards_cache
    conn = db_schema.get_conn()
    try:
        config = db_schema.load_sector_cards_config(conn)
        if config is None:
            config = db_schema.save_sector_cards_config(
                conn,
                sector_cards.load_static_sector_map(),
                datetime.now(timezone.utc).isoformat(),
            )
        config['sectors'] = sector_cards.normalize_sector_map(config['sectors'])
        _sector_cards_cache = config
        return config
    finally:
        conn.close()


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


@app.get('/auth/google/start')
def google_auth_start(return_to: str = None):
    if not GOOGLE_AUTH.configured:
        raise HTTPException(status_code=503, detail='Google login is not configured on the server')
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    response = RedirectResponse(GOOGLE_AUTH.authorization_url(state, nonce), status_code=302)
    response.set_cookie(
        GOOGLE_AUTH.STATE_COOKIE, state, max_age=600, httponly=True,
        secure=True, samesite='lax', path='/',
    )
    response.set_cookie(
        GOOGLE_AUTH.NONCE_COOKIE, nonce, max_age=600, httponly=True,
        secure=True, samesite='lax', path='/',
    )
    response.set_cookie(
        GOOGLE_AUTH.RETURN_COOKIE, _safe_google_return_url(return_to), max_age=600,
        httponly=True, secure=True, samesite='lax', path='/',
    )
    return response


@app.get('/auth/google/callback')
def google_auth_callback(request: Request, code: str = None, state: str = None, error: str = None):
    if error:
        return _google_auth_error_redirect('google_' + error)
    saved_state = request.cookies.get(GOOGLE_AUTH.STATE_COOKIE)
    saved_nonce = request.cookies.get(GOOGLE_AUTH.NONCE_COOKIE)
    if not state or not saved_state or not hmac.compare_digest(state, saved_state):
        return _google_auth_error_redirect('invalid_state')
    if not code or not saved_nonce:
        return _google_auth_error_redirect('missing_code')
    try:
        user = GOOGLE_AUTH.authenticate_code(code, saved_nonce)
    except GoogleAuthError:
        logging.getLogger('main').warning('Google OAuth callback verification failed')
        return _google_auth_error_redirect('login_failed')
    return_to = _safe_google_return_url(request.cookies.get(GOOGLE_AUTH.RETURN_COOKIE))
    response = RedirectResponse(return_to, status_code=303)
    response.set_cookie(
        GOOGLE_AUTH.SESSION_COOKIE, GOOGLE_AUTH.make_session(user),
        max_age=7 * 24 * 60 * 60, httponly=True, secure=True,
        # The Tistory page and goodbyestar.cloud are different sites, so the
        # authenticated fetch from the editor requires SameSite=None+Secure.
        samesite='none', path='/',
    )
    response.delete_cookie(GOOGLE_AUTH.STATE_COOKIE, path='/')
    response.delete_cookie(GOOGLE_AUTH.NONCE_COOKIE, path='/')
    response.delete_cookie(GOOGLE_AUTH.RETURN_COOKIE, path='/')
    return response


@app.get('/auth/google/me')
def google_auth_me(request: Request):
    return envelope(GOOGLE_AUTH.status(request.cookies.get(GOOGLE_AUTH.SESSION_COOKIE)))


@app.get('/auth/google/logout')
def google_auth_logout(return_to: str = None):
    response = RedirectResponse(_safe_google_return_url(return_to), status_code=303)
    response.delete_cookie(GOOGLE_AUTH.SESSION_COOKIE, path='/')
    return response


def _load_user_watchlist(request: Request):
    session = require_google_user(request)
    now = datetime.now(timezone.utc).isoformat()
    conn = db_schema.get_conn()
    try:
        user_id = db_schema.upsert_google_user(conn, session, now)
        config = db_schema.load_watchlist_config(conn, user_id)
        if config is None:
            config = watchlist.empty_config()
            config.update({'revision': 0, 'updatedAt': None})
        return config
    finally:
        conn.close()


@app.get('/watchlist')
def watchlist_endpoint(request: Request):
    return envelope(_load_user_watchlist(request))


@app.put('/watchlist')
async def update_watchlist(request: Request):
    session = require_google_user(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail='request body must be valid JSON') from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail='request body must be an object')
    try:
        config = watchlist.normalize_config(body)
    except watchlist.WatchlistConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    now = datetime.now(timezone.utc).isoformat()
    conn = db_schema.get_conn()
    try:
        user_id = db_schema.upsert_google_user(conn, session, now)
        try:
            saved = db_schema.save_watchlist_config(
                conn, user_id, config, now, expected_revision=body.get('revision'),
            )
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail='revision must be an integer') from exc
        except RuntimeError as exc:
            if str(exc) == 'WATCHLIST_REVISION_CONFLICT':
                raise HTTPException(status_code=409, detail='watchlist changed; reload and try again') from exc
            raise
    finally:
        conn.close()
    return envelope(saved)


@app.get('/sector-cards')
def sector_cards_endpoint():
    """증시온도 카드/히트맵/분석에서 공통으로 사용하는 사용자 설정."""
    return envelope(_load_sector_cards_cached())


@app.put('/sector-cards')
async def update_sector_cards(request: Request, x_api_key: str = Header(default=None)):
    """관리자 전용 카드 구성 전체 교체 API."""
    require_sector_cards_editor(request, x_api_key)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail='request body must be valid JSON') from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail='request body must be an object')

    raw_sectors = body.get('sectors', body)
    try:
        sectors = sector_cards.normalize_sector_map(raw_sectors)
    except sector_cards.SectorConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    expected_revision = body.get('revision')
    conn = db_schema.get_conn()
    try:
        try:
            saved = db_schema.save_sector_cards_config(
                conn,
                sectors,
                datetime.now(timezone.utc).isoformat(),
                expected_revision=expected_revision,
            )
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail='revision must be an integer') from exc
        except RuntimeError as exc:
            if str(exc) == 'SECTOR_CONFIG_REVISION_CONFLICT':
                raise HTTPException(status_code=409, detail='sector card configuration was changed by another editor') from exc
            raise
    finally:
        conn.close()

    global _sector_cards_cache
    _sector_cards_cache = saved
    return envelope(saved)


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

# 경제 종합뉴스는 브라우저마다 5분 REST 요청을 반복하지 않고, 한 번 수집한
# 결과를 연결된 브라우저에 fan-out한다. 뉴스 원천의 캐시 TTL과 맞춰 저빈도로
# 갱신하므로 WebSocket 연결 수가 늘어도 뉴스 제공자 호출 수는 늘지 않는다.
_ECONOMIC_NEWS_WS_INTERVAL_SEC = 5 * 60
_ECONOMIC_NEWS_WS_CACHE_TTL_SEC = 4 * 60
_economic_news_ws_clients = set()
_economic_news_ws_task = None
_economic_news_ws_cache = {}

_FLASH_MACRO_RULES = (
    ('CPI', ('cpi', '소비자물가', '물가 지표', '물가지표'), 100),
    ('FOMC', ('fomc', '연방공개시장위원회', '연준 회의', '연준회의'), 100),
    ('미국 금리', ('미국 금리', '기준금리', '금리 결정', '금리결정', '파월', '연준', 'fed rate'), 95),
    ('고용 지표', ('비농업', '고용보고서', '고용 지표', '고용지표', '실업률', 'nonfarm payrolls'), 90),
    ('물가·성장', ('pce', 'gdp', '소매판매', '생산자물가'), 85),
)
_FLASH_INDEX_TERMS = ('코스피', '코스닥', '나스닥', 's&p 500', 's&p500', '다우지수', '다우존스', '지수 급등', '지수 급락')


def _economic_news_market():
    now = datetime.now(timezone(timedelta(hours=9)))
    return 'us' if now.hour >= 20 or now.hour < 8 else 'domestic'


def _fetch_economic_news_snapshot(market):
    if market == 'us':
        items = news_aggregator.get_general_news(
            alpha_api_key=os.environ.get('ALPHA_VANTAGE_API_KEY', '').strip(),
            finnhub_api_key=os.environ.get('FINNHUB_API_KEY', '').strip(),
            limit=50,
        )
    else:
        result = domestic_news.get_news(limit=50, item_kind='news')
        items = result.get('items', []) if isinstance(result, dict) else []
    flash_news = list(items or [])
    if market != 'us':
        # 국내 장중에도 CPI·FOMC·미국 금리 일정은 속보로 놓치지 않도록
        # 미국 뉴스 원천을 속보 분류용으로만 함께 확인한다.
        flash_news.extend(news_aggregator.get_general_news(
            alpha_api_key=os.environ.get('ALPHA_VANTAGE_API_KEY', '').strip(),
            finnhub_api_key=os.environ.get('FINNHUB_API_KEY', '').strip(),
            limit=30,
        ))
    disclosures = domestic_news.get_disclosures(limit=100)
    return {'market': market, 'items': items, 'flash': _build_flash_items(flash_news, disclosures)}


def _build_flash_items(news_items, disclosures):
    """속보 레일에 필요한 실적·공시·지수·미국 거시 이벤트를 정규화한다."""
    candidates = []
    for item in disclosures or []:
        title = str(item.get('title') or '').strip()
        text = title.lower()
        if not title:
            continue
        category = '실적' if item.get('category') == '실적' or any(token in text for token in ('실적', '영업이익', '순이익', '매출액', '잠정')) else '공시'
        candidates.append(dict(item, flashType=category, importance=100 if category == '실적' else 80))

    for item in news_items or []:
        if not item or item.get('kind') == 'disclosure':
            continue
        title = str(item.get('title') or '').strip()
        text = title.lower()
        if not title:
            continue
        macro = next(((label, weight) for label, terms, weight in _FLASH_MACRO_RULES if any(term in text for term in terms)), None)
        if macro:
            candidates.append(dict(item, flashType=macro[0], importance=macro[1]))
        elif any(term in text for term in _FLASH_INDEX_TERMS):
            candidates.append(dict(item, flashType='지수', importance=75))

    unique = {}
    for item in candidates:
        key = item.get('id') or item.get('link') or item.get('title')
        if key not in unique or item.get('importance', 0) > unique[key].get('importance', 0):
            unique[key] = item
    result = list(unique.values())
    result.sort(key=lambda item: item.get('pubDate') or '', reverse=True)
    result.sort(key=lambda item: int(item.get('importance') or 0), reverse=True)
    return result[:30]


async def _economic_news_snapshot(market):
    cached = _economic_news_ws_cache.get(market)
    if cached and time.time() - cached['t'] < _ECONOMIC_NEWS_WS_CACHE_TTL_SEC:
        return cached['data']
    data = await asyncio.to_thread(_fetch_economic_news_snapshot, market)
    _economic_news_ws_cache[market] = {'t': time.time(), 'data': data}
    return data


async def _economic_news_broadcast_loop():
    global _economic_news_ws_task
    try:
        while _economic_news_ws_clients:
            await asyncio.sleep(_ECONOMIC_NEWS_WS_INTERVAL_SEC)
            if not _economic_news_ws_clients:
                break
            try:
                payload = await _economic_news_snapshot(_economic_news_market())
            except Exception as exc:
                logging.getLogger('main').warning('경제 종합뉴스 WebSocket 수집 실패: %s', type(exc).__name__)
                continue
            stale = []
            for client in tuple(_economic_news_ws_clients):
                try:
                    await client.send_json({'type': 'economic-news', 'data': payload})
                except Exception:
                    stale.append(client)
            for client in stale:
                _economic_news_ws_clients.discard(client)
    except asyncio.CancelledError:
        raise
    finally:
        _economic_news_ws_task = None


@app.websocket('/ws/economic-news')
async def economic_news_socket(websocket: WebSocket):
    """경제 종합뉴스를 공용 캐시에서 브라우저로 push한다."""
    global _economic_news_ws_task
    origin = websocket.headers.get('origin')
    if origin not in ALLOWED_BROWSER_ORIGINS:
        await websocket.close(code=1008)
        return
    if len(_economic_news_ws_clients) >= _WS_MAX_CONNECTIONS:
        await websocket.close(code=1013)
        return

    await websocket.accept()
    _economic_news_ws_clients.add(websocket)
    try:
        payload = await _economic_news_snapshot(_economic_news_market())
        await websocket.send_json({'type': 'economic-news', 'data': payload})
        if _economic_news_ws_task is None or _economic_news_ws_task.done():
            _economic_news_ws_task = asyncio.create_task(_economic_news_broadcast_loop())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logging.getLogger('main').warning('경제 종합뉴스 WebSocket 종료: %s', type(exc).__name__)
    finally:
        _economic_news_ws_clients.discard(websocket)


@app.websocket('/ws/quotes')
async def realtime_quote_socket(websocket: WebSocket):
    """관심종목용 실시간 체결가 중계(국내=키움, 미국=Finnhub). 인증키는 서버 안에서만 사용한다."""
    global _ws_active_connections
    origin = websocket.headers.get('origin')
    if origin != 'https://ghlee.tistory.com':
        await websocket.close(code=1008)
        return

    raw_codes = (websocket.query_params.get('codes') or '').split(',')
    domestic_codes = realtime_quotes.normalize_codes(raw_codes)
    us_codes = []
    seen_us = set()
    for raw_code in raw_codes:
        if not str(raw_code or '').strip().upper().startswith('US:'):
            continue
        try:
            symbol = us_stocks.normalize_symbol(raw_code)
        except ValueError:
            continue
        if symbol not in seen_us:
            seen_us.add(symbol)
            us_codes.append(symbol)
    total_codes = domestic_codes + us_codes
    if not total_codes:
        await websocket.close(code=1008)
        return

    if _ws_active_connections >= _WS_MAX_CONNECTIONS:
        await websocket.close(code=1013)  # Try Again Later
        return

    await websocket.accept()
    _ws_active_connections += 1
    relay_task = asyncio.create_task(
        realtime_quotes.relay_quotes(websocket, domestic_codes)
    ) if domestic_codes else None
    finnhub_task = asyncio.create_task(
        finnhub_realtime.stream_quotes(websocket, us_codes)
    ) if us_codes else None
    receive_task = asyncio.create_task(websocket.receive_text())
    try:
        while True:
            tasks = {task for task in (relay_task, finnhub_task, receive_task) if task}
            done, _ = await asyncio.wait(
                tasks,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if relay_task and relay_task in done:
                await relay_task
                return
            if finnhub_task and finnhub_task in done:
                await finnhub_task
                return
            # 반드시 완료된 수신 태스크를 await해서 WebSocketDisconnect를 회수한다.
            # 회수하지 않으면 클라이언트가 닫힌 뒤에도 예외 태스크가 누적되어
            # "Cannot call receive once a disconnect message has been received"가 반복된다.
            if receive_task in done:
                await receive_task
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
        for task in (relay_task, finnhub_task, receive_task):
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
    except Exception as primary_error:
        # 키움 장애/일시 제한 시 data.go.kr 일별 주식시세를 2차 경로로 사용한다.
        try:
            fallback = public_data.fetch_stock_quote(code)
            if fallback:
                return envelope(fallback)
        except Exception as fallback_error:
            logging.getLogger('main').warning(
                'quote 공공데이터 fallback 실패(%s): %s', code, fallback_error,
            )
        # ETF/ETN/ELW는 일반 주식시세에 없을 수 있어 증권상품시세도 시도한다.
        try:
            fallback = public_data.fetch_product_quote(code)
            if fallback:
                return envelope(fallback)
        except Exception as fallback_error:
            logging.getLogger('main').warning(
                'quote 증권상품 fallback 실패(%s): %s', code, fallback_error,
            )
        raise HTTPException(status_code=502, detail=str(primary_error))
    return envelope(res)


@app.get('/us-search')
def us_search(request: Request, q: str = Query(..., min_length=1, max_length=40),
              limit: int = Query(8, ge=1, le=20)):
    """미국주식 티커·회사명 검색 - 공통 종목검색에서 국내 검색과 함께 사용한다."""
    _check_rate_limit('us_search', request, max_per_window=30)
    try:
        return envelope(us_stocks.search(q, limit=limit))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except us_stocks.UsStockUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get('/us-quote/{symbol}')
def us_quote(request: Request, symbol: str = Path(..., min_length=1, max_length=12)):
    """미국 개별주식 현재가·등락·거래량·장 상태 조회."""
    _check_rate_limit('us_quote', request, max_per_window=60)
    try:
        return envelope(us_stocks.quote(symbol))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except us_stocks.UsStockUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get('/us-orderbook/{symbol}')
def us_orderbook(request: Request, symbol: str = Path(..., min_length=1, max_length=12)):
    """미국주식 매도·매수 10호가 조회."""
    _check_rate_limit('us_orderbook', request, max_per_window=30)
    try:
        return envelope(us_stocks._kiwoom_orderbook(symbol))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except us_stocks.UsStockUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get('/us-chart/{symbol}')
def us_chart(request: Request, symbol: str = Path(..., min_length=1, max_length=12),
             timeframe: str = Query('minute', pattern='^(minute|daily)$')):
    """미국주식 분봉·일봉 차트 조회."""
    _check_rate_limit('us_chart', request, max_per_window=30)
    try:
        return envelope(us_stocks.chart(symbol, timeframe=timeframe))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except us_stocks.UsStockUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get('/us-news/{symbol}')
def us_news(request: Request, symbol: str = Path(..., min_length=1, max_length=12),
            name: str = Query('', max_length=100)):
    """미국주식 종목 관련 최신 뉴스."""
    _check_rate_limit('us_news', request, max_per_window=20)
    try:
        ticker = us_stocks.normalize_symbol(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    query = ((name or '').strip() + ' ' + ticker).strip()
    items = news_aggregator.get_or_refresh_news(
        ticker,
        naver_fetcher=lambda: naver_news.search_news(
            query,
            os.environ.get('NAVER_APIHUB_CLIENT_ID'),
            os.environ.get('NAVER_APIHUB_CLIENT_SECRET'),
            display=10,
        ),
        alpha_api_key=os.environ.get('ALPHA_VANTAGE_API_KEY', '').strip(),
        finnhub_api_key=os.environ.get('FINNHUB_API_KEY', '').strip(),
        limit=10,
    )
    providers = sorted(set(item.get('provider') for item in items if item.get('provider')))
    return envelope({
        'symbol': ticker,
        'query': query,
        'items': items,
        'providers': providers,
        'source': ' + '.join(providers) if providers else '뉴스 공급자 없음',
    })


@app.get('/us-analysis/{symbol}')
def us_analysis_endpoint(request: Request, symbol: str = Path(..., min_length=1, max_length=12)):
    """미국주식 재무·실적·전망·내부자 데이터를 캐시에서 조회한다."""
    _check_rate_limit('us_analysis', request, max_per_window=10)
    try:
        ticker = us_stocks.normalize_symbol(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return envelope(us_analysis.get_analysis(
        ticker,
        finnhub_api_key=os.environ.get('FINNHUB_API_KEY', '').strip(),
    ))


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
    except Exception as primary_error:
        # 주식시세정보는 일별 OHLC를 제공하므로 실시간/분봉 대체가 아니라
        # 일봉 차트가 비어 버리는 상황을 막는 보조 경로로만 사용한다.
        try:
            daily = public_data.fetch_stock_ohlc(code, max_days=None)
        except Exception as fallback_error:
            logging.getLogger('main').warning(
                'ohlc 공공데이터 fallback 실패(%s): %s', code, fallback_error,
            )
            raise HTTPException(status_code=502, detail=str(primary_error))
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
    cached = _live_cache_get(_ohlc_minute_cache, cache_key, ttl=_OHLC_MINUTE_CACHE_TTL)
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
        conn = db_schema.get_conn()
        try:
            db_schema.upsert_investor_flow_daily(conn, code, daily)
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as e:
        # KIS가 장중 제한되거나 일시 실패해도 직전에 저장한 확정 개인 수급을 우선 사용한다.
        conn = db_schema.get_conn()
        try:
            daily = db_schema.load_investor_flow_daily(conn, code)
        finally:
            conn.close()
        if not daily:
            raise HTTPException(status_code=502, detail=str(e))
        logging.getLogger('main').warning('foreign-flow DB 확정 데이터 폴백(%s): %s', code, e)
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


@app.get('/_diag/stock-totqy/{code}')
def stock_totqy_diag(request: Request, code: str = Path(..., min_length=6, max_length=6)):
    """임시 진단용(2026-08) - DART stockTotqySttus(주식의 총수 현황) 원본 응답을 그대로
    노출해 발행주식총수에 해당하는 실제 필드명을 확인한다(공식 문서 사이트가 이 환경에서
    접속 차단돼 필드명 미검증 - scripts/cloud-vm/dart_client.py의 call_stock_totqy 참고).
    필드명이 확정되면 fundamentals.py에 파싱을 붙이고(상장주식수 + 자본총계로 PER/PBR
    계산) 이 엔드포인트는 지운다 - ka10046 체결강도 붙일 때와 동일한 순서
    (docs/WORK_HISTORY.md 참고)."""
    _check_rate_limit('stock_totqy_diag', request, max_per_window=10)
    api_key = os.environ.get('DART_API_KEY', '').strip()
    if not api_key:
        raise HTTPException(status_code=503, detail='DART_API_KEY 환경변수가 설정되지 않았습니다.')
    try:
        corp_map = dart_client.get_corp_code_map(api_key)
        corp_code = corp_map.get(code)
        if not corp_code:
            raise HTTPException(status_code=404, detail='DART corp_code 매핑에 없는 종목코드입니다: %s' % code)
        # 사업보고서(11011)와 반기보고서(11012)를 둘 다 확인 - 최신 정기보고서가 어느 쪽에
        # 실제로 값이 채워지는지도 이 진단에서 같이 확인한다.
        year = datetime.now().year - 1
        annual = dart_client.call_stock_totqy(api_key, corp_code, year, '11011')
        half = dart_client.call_stock_totqy(api_key, corp_code, year, '11012')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return envelope({'code': code, 'corp_code': corp_code, 'year': year, 'business_report': annual, 'half_report': half})


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


@app.get('/strategy-scan-batch')
def strategy_scan_batch(x_api_key: str = Header(default=None)):
    """strategy_scan.py(하루 1회 크론, daily_scan.py 20분 뒤)가 전종목을 미리 판정해둔
    결과를 즉시 반환. /daily-scan-batch와 동일한 서빙 패턴(캐시 파일을 그대로 읽어 반환) -
    전략검색 화면(js/strategy-search.js)이 이 엔드포인트를 호출한다. 응답은
    categories(카테고리id -> {name, methodology, sectors}) 구조 - 전략검색은 카테고리
    여러 개를 탭으로 보여주는 틀이고, 지금은 "저평가 종목"(펀더멘탈 점수 + 120일 이평 대비
    이격도 기준, WICS 섹터별 그룹) 1개뿐이지만 계속 추가될 예정이다. 2026-08 전까지는
    kisyaml 프리셋 전략 10개를 서빙했으나(strategy_scan.py docstring 참고) 변별력 부족
    피드백으로 전면 개편됐다."""
    require_api_key(x_api_key)
    if not os.path.exists(STRATEGY_SCAN_CACHE_FILE):
        raise HTTPException(status_code=503, detail='전략 스캔 캐시가 아직 생성되지 않았습니다(strategy_scan.py 첫 실행 대기 중).')
    with open(STRATEGY_SCAN_CACHE_FILE, 'r', encoding='utf-8') as f:
        cached = json.load(f)
    return envelope(cached)


# 분봉을 "읽을 수 있는" 심볼 집합 - domestic_futures.MINUTE_SYMBOLS(주간선물만, 도메스틱
# 수집기 자신이 갱신하는 범위)와 night_futures_ws.py가 별도 소스(KIS 웹소켓)로 채우는
# KOSPI200_NIGHT을 합친 것. 아래 futures() 독스트링 2026-08-05 항목 참고.
_MINUTE_CHART_READ_SYMBOLS = domestic_futures.MINUTE_SYMBOLS | {'KOSPI200_NIGHT'}


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
    _MINUTE_CHART_READ_SYMBOLS에 있는 심볼만 분봉으로 바뀌고 나머지는 그 심볼에 분봉 소스가
    없어 평소처럼 일봉을 반환한다(부분 적용 - 에러 아님).
    2026-07-16(5차): 야간선물도 분봉 지원 추가(MINUTE_SYMBOLS에 KOSPI200_NIGHT 포함) +
    미결제약정(oi/oi_change) 필드 노출(야간선물만 값이 있고 나머지 심볼은 null).
    2026-07-31: symbols(쉼표 구분) 파라미터 추가 - 응답에 실을 심볼을 아래 order 화이트리스트
    안에서만 좁힌다. 코스피 선물 페이지는 선물 2개만 쓰는데 21개 심볼 전체를 매번 받아
    분봉 요청이 브라우저 타임아웃(10초)에 걸리던 문제 대응. 미지정이면 기존과 완전히 동일하게
    전체를 반환하므로 관심지수 리본/보조지수 등 기존 호출부는 영향 없다.
    2026-07-31(2차): 같은 파라미터 조합에 대한 짧은 TTL 메모리 캐시(_FUTURES_TTL) 추가 -
    리본/페이지/GAS가 같은 쿼리를 겹쳐 호출하던 중복 DB 조회를 없앤다.
    2026-08-05: 야간선물 분봉이 아예 응답에 안 실리는 회귀 수정 - 2026-08-03에
    domestic_futures.MINUTE_SYMBOLS에서 KOSPI200_NIGHT을 뺀 건 "도메스틱 수집기 자신이 갱신할
    심볼"(쓰기 범위, night_futures_ws.py가 이미 별도로 채우고 있어 도메스틱 수집기까지 손대면
    서로 덮어쓰는 버그가 있었음)만 좁힌 것이었는데, 아래 분봉 판정이 같은 집합을 "분봉이
    존재할 수 있는 심볼"(읽기 범위) 게이트로도 재사용하고 있어 KOSPI200_NIGHT 분봉까지 통째로
    빠지는 부작용이 있었다. 이제 _MINUTE_CHART_READ_SYMBOLS(아래)로 분리한다."""
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
            if interval == 'minute' and symbol in _MINUTE_CHART_READ_SYMBOLS:
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
def earnings_calendar_endpoint(year: int = Query(..., ge=2000, le=2100), month: int = Query(default=None, ge=1, le=12)):
    """국내 DART 실적공시와 미국 Finnhub 예정 실적을 캘린더 이벤트로 반환한다.

    month가 없으면 해당 연도 1월~12월 전체를 반환해 연간 검색에 사용한다.

    각 공급자는 10분 캐시를 사용하며, 키가 없거나 외부 조회가 실패해도 다른
    일정과 기존 Google Calendar 일정은 유지한다.
    """
    key = '%04d-%02d' % (year, month) if month is not None else '%04d-year' % year
    cached = _earnings_calendar_cache.get(key)
    if cached and time.time() - cached['t'] < _EARNINGS_CALENDAR_TTL:
        return {'success': True, 'data': cached['data'], 'source': 'dart+finnhub', 'cached': True}
    data = earnings_calendar.merge_month(year, month) if month is not None else earnings_calendar.merge_year(year)
    _earnings_calendar_cache[key] = {'t': time.time(), 'data': data}
    _earnings_calendar_cache.move_to_end(key)
    _evict_lru(_earnings_calendar_cache, _EARNINGS_CALENDAR_MAX_ENTRIES)
    return {'success': True, 'data': data, 'source': 'dart+finnhub', 'cached': False}


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


@app.get('/domestic-news')
def domestic_news_endpoint(
    request: Request,
    code: str = Query('', min_length=0, max_length=6),
    name: str = Query('', max_length=100),
    query: str = Query('', max_length=100),
    kind: str = Query('all', max_length=10),
    limit: int = Query(10, ge=1, le=50),
):
    """국내 전체/종목별 뉴스와 DART 공시를 시간순으로 반환한다.

    브라우저가 네이버·DART 키를 알 필요 없도록 서버에서 수집하고,
    캐시된 결과를 우선 반환한다. 종목 코드는 국내 6자리 숫자만 허용한다.
    """
    _check_rate_limit('domestic_news', request, max_per_window=20)
    normalized_code = (code or '').strip()
    if normalized_code and (len(normalized_code) != 6 or not normalized_code.isdigit()):
        raise HTTPException(status_code=400, detail='domestic stock code must be 6 digits')
    item_kind = 'news' if kind.strip().lower() == 'news' else 'all'
    result = domestic_news.get_news(normalized_code, name.strip(), query.strip(), limit, item_kind)
    return envelope(result)


@app.get('/foreign-news')
def foreign_news_endpoint(request: Request, limit: int = Query(20, ge=1, le=50)):
    """미국 세션용 일반 시장·거시경제 뉴스를 Finnhub와 Alpha Vantage에서 합친다."""
    _check_rate_limit('foreign_news', request, max_per_window=20)
    items = news_aggregator.get_general_news(
        alpha_api_key=os.environ.get('ALPHA_VANTAGE_API_KEY', '').strip(),
        finnhub_api_key=os.environ.get('FINNHUB_API_KEY', '').strip(),
        limit=limit,
    )
    return envelope({
        'market': 'us',
        'items': items,
        'source': 'Finnhub general + Alpha Vantage NEWS_SENTIMENT',
    })


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


@app.get('/kofia-market')
def kofia_market_endpoint(days: int = Query(30, ge=7, le=90)):
    """KOFIA 공공데이터 보조지표(신용융자·증시자금) - 30분 캐시.

    키움/KIS의 실시간 시세를 대체하지 않고, 시장 브리핑의 중기 자금 맥락만
    보완한다. 키가 아직 VM에 없으면 빈 보조지표를 정상 응답해 기존 화면을
    막지 않는다.
    """
    global _kofia_market_cache
    now = time.time()
    cached = _kofia_market_cache.get(days)
    if cached is not None and now - cached['t'] < _KOFIA_MARKET_TTL:
        return envelope(cached['data'])
    try:
        result = public_data.fetch_kofia_market(days)
    except public_data.PublicDataUnavailable as exc:
        result = {
            'available': False,
            'source': 'data.go.kr: 금융위원회 금융투자협회 종합통계정보',
            'message': str(exc),
            'series': [],
        }
    except Exception as exc:
        logging.getLogger('main').warning('KOFIA public-data fallback failed: %s', exc)
        result = {
            'available': False,
            'source': 'data.go.kr: 금융위원회 금융투자협회 종합통계정보',
            'message': 'KOFIA 통계를 잠시 불러오지 못했습니다.',
            'series': [],
        }
    _kofia_market_cache[days] = {'t': now, 'data': result}
    return envelope(result)


@app.get('/domestic-market-indicators')
def domestic_market_indicators_endpoint(fresh: bool = Query(False)):
    """국내시장지표: 현물 코스피/코스닥 차트, 투자자별 수급, 증시자금.

    The provider order is kept in domestic_market_indicators.py so the page
    never accidentally falls back to futures when the cash index API is down.
    """
    global _domestic_market_indicators_cache
    now = time.time()
    if (not fresh and _domestic_market_indicators_cache and
            now - _domestic_market_indicators_cache['t'] < _DOMESTIC_MARKET_INDICATORS_TTL):
        return envelope(_domestic_market_indicators_cache['data'])
    kiwoom_token = None
    kiwoom_appkey = os.environ.get('KIWOOM_APPKEY')
    kiwoom_secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if kiwoom_appkey and kiwoom_secretkey:
        try:
            kiwoom_token = kiwoom_client.get_token(kiwoom_appkey, kiwoom_secretkey)
        except Exception:
            logging.getLogger('main').warning('domestic market indicators: Kiwoom token unavailable', exc_info=True)
    try:
        data = domestic_market_indicators.build_dashboard(
            kiwoom_token=kiwoom_token,
            kis_appkey=os.environ.get('KIS_APPKEY'),
            kis_appsecret=os.environ.get('KIS_APPSECRET'),
        )
    except Exception as exc:
        logging.getLogger('main').warning('domestic market indicators failed: %s', exc, exc_info=True)
        raise HTTPException(status_code=502, detail='국내시장지표 데이터를 불러오지 못했습니다.')
    _domestic_market_indicators_cache = {'t': now, 'data': data}
    return envelope(data)


@app.get('/market-rank')
def market_rank_endpoint(limit: int = Query(5, ge=1, le=_MARKET_RANK_MAX_LIMIT)):
    """사이드바 실시간 랭킹(거래대금 TOP/상한가/하한가) - 9bolt 우측 사이드바 리디자인
    (작업지시서 2026-07-20). 방문자 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만
    제한) - /futures, /option-flow와 동일한 패턴. limit: 기본 5(사이드바 미리보기), "더보기"
    모달은 limit=20으로 같은 엔드포인트를 재사용(js/sidebar-rank.js).

    2026-08-05: market_rank.start_background()가 30초마다 미리 채워둔 캐시(get_cached())를
    우선 읽는다 - 예전엔 이 요청 핸들러 안에서(캐시 만료 순간마다) 키움을 직접 호출했는데,
    그 순간 키움이 느리면 방문자의 8초 fetch 타임아웃에 걸려 "데이터를 불러오지 못했습니다"가
    간헐적으로 떴다(원인 조사·수정 이력은 market_rank.py 상단 주석 참고). 백그라운드가 아직
    한 번도 못 채운 서버 기동 직후에만 기존 온디맨드 경로(_market_rank_cache 30초 TTL +
    키움 직접 호출)로 폴백해 빈 위젯이 뜨지 않게 한다."""
    cached = market_rank.get_cached(limit)
    if cached is not None:
        return envelope(cached)

    now = time.time()
    fallback = _market_rank_cache.get(limit)
    if fallback is not None and now - fallback['t'] < _MARKET_RANK_TTL:
        return envelope(fallback['data'])
    try:
        token = get_kiwoom_token()
        data = market_rank.fetch_sidebar_rank(token, limit=limit)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    _market_rank_cache[limit] = {'t': now, 'data': data}
    return envelope(data)


@app.get('/market-board')
def market_board_endpoint(request: Request,
                          market: str = Query('domestic'),
                          limit: int = Query(12, ge=6, le=20),
                          fresh: bool = Query(False)):
    """홈 증권사형 실시간 종목판. 국내·미국 세션별 같은 행 모델을 반환한다."""
    _check_rate_limit('market_board', request, max_per_window=30)
    market = 'us' if str(market).lower() == 'us' else 'domestic'
    key = (market, limit)
    now = time.time()
    cached = _market_board_cache.get(key)
    cache_ttl = _MARKET_BOARD_LIVE_TTL if fresh else _MARKET_BOARD_TTL
    if cached is not None and now - cached['t'] < cache_ttl:
        return envelope(cached['data'])
    try:
        if market == 'us':
            data = market_board.fetch_us(
                token=get_kiwoom_token(),
                limit=limit,
                finnhub_api_key=os.environ.get('FINNHUB_API_KEY', '').strip(),
            )
        else:
            data = market_board.fetch_domestic(get_kiwoom_token(), limit=limit)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    _market_board_cache[key] = {'t': now, 'data': data}
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
