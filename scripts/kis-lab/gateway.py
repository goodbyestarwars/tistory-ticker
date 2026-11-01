"""Private KIS gateway: delegate session validation to the existing site auth API."""
from pathlib import Path
from urllib.parse import unquote
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

PREFIX = '/kis-tool'
SITE_ORIGIN = 'https://goodbyestar.cloud'
AUTH_URL = 'http://127.0.0.1:8080/auth/google/me'
UPSTREAMS = {'builder': 'http://127.0.0.1:18300', 'backtest': 'http://127.0.0.1:18301'}
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=['https://ghlee.tistory.com'],
                   allow_credentials=True, allow_methods=['GET'], allow_headers=[])


async def authorized(cookie):
    if not cookie:
        return False
    try:
        async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
            result = await client.get(AUTH_URL, headers={'Cookie': cookie})
            result.raise_for_status()
            data = result.json()['data']
        return (data.get('authenticated') is True and data.get('isAdmin') is True
                and data.get('provider') == 'google')
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return False


@app.middleware('http')
async def private_cache(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'private, no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['Content-Security-Policy'] = "frame-ancestors 'self' https://ghlee.tistory.com"
    return response


@app.get(PREFIX + '/access')
async def access(request: Request):
    return {'success': True, 'data': {'allowed': await authorized(request.headers.get('cookie'))}}


@app.api_route(PREFIX + '/{path:path}', methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
async def gateway(request: Request, path: str):
    if not await authorized(request.headers.get('cookie')):
        if not path and request.method == 'GET':
            return HTMLResponse(Path(__file__).with_name('login.html').read_text(encoding='utf-8'), status_code=401)
        return JSONResponse({'detail': '사이트 관리자 Google 로그인이 필요합니다.'}, status_code=403)
    if request.method not in ('GET', 'HEAD') and request.headers.get('origin') != SITE_ORIGIN:
        return JSONResponse({'detail': '허용되지 않은 요청 출처입니다.'}, status_code=403)
    decoded = unquote(unquote(path))
    if any(c in decoded for c in ('\\', '\x00', '#', '?')) or any(p in ('.', '..') for p in decoded.split('/')):
        return JSONResponse({'detail': '잘못된 경로입니다.'}, status_code=400)
    if not path:
        return HTMLResponse(Path(__file__).with_name('portal.html').read_text(encoding='utf-8'))
    part = path.split('/', 1)[0]
    if part not in UPSTREAMS:
        return Response(status_code=404)
    tail = path[len(part):] or '/'
    if tail.startswith(('/api/orders', '/api/account', '/api/auth/login', '/api/auth/switch-mode', '/api/auth/logout')):
        return JSONResponse({'detail': '백데이터 전용: 주문·계좌·브로커 설정 차단'}, status_code=403)
    if request.headers.get('content-length', '').isdigit() and int(request.headers['content-length']) > 20 * 1024 * 1024:
        return Response(status_code=413)
    body = await request.body()
    if len(body) > 20 * 1024 * 1024:
        return Response(status_code=413)
    if tail.startswith('/api/'):
        target = 'http://127.0.0.1:' + ('18800' if part == 'builder' else '18802') + tail
    else:
        target = UPSTREAMS[part] + PREFIX + '/' + path
    if request.url.query:
        target += '?' + request.url.query
    # Never pass session cookies, authorization headers or client-selected hosts to KIS.
    headers = {k: v for k, v in request.headers.items() if k.lower() in
               ('content-type', 'accept', 'range', 'if-range', 'next-router-state-tree', 'rsc', 'next-url')}
    try:
        async with httpx.AsyncClient(timeout=600, trust_env=False, follow_redirects=False) as client:
            result = await client.request(request.method, target, headers=headers, content=body)
        safe = {k: v for k, v in result.headers.items() if k.lower() in
                ('content-type', 'content-disposition', 'content-range', 'accept-ranges')}
        location = result.headers.get('location')
        if location and location.startswith(PREFIX + '/' + part + '/'):
            safe['Location'] = location
        return Response(result.content, status_code=result.status_code, headers=safe)
    except httpx.HTTPError:
        return JSONResponse({'detail': 'KIS 분석 도구 연결을 확인해 주세요.'}, status_code=502)


@app.get(PREFIX)
async def root():
    return RedirectResponse(PREFIX + '/', status_code=307)
