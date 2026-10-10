# -*- coding: utf-8 -*-
"""로컬 상태 API(127.0.0.1 전용). 블로그의 "자동매매" 화면이 이 주소를 읽는다.

- 127.0.0.1에만 바인딩한다(외부에서 접속 불가).
- 모든 요청에 X-AutoTrader-Token 헤더(.token 파일 값)가 있어야 한다. 토큰이 틀리면 401.
- CORS는 지정한 블로그 주소(Origin) 하나만 허용한다. Chrome의 사설망 접근 확인(Private Network Access) 사전 요청도 처리한다.
- GET /api/research: 연구 후보 생성기(research/research_job.py)가 남기는 상태 파일(research/status.json)과 후보·모의 집계를 읽기 전용으로 돌려준다.
- POST는 /api/stop·/api/resume(정지 플래그 파일 생성·삭제)과 /api/watch·/api/unwatch(감시 종목 추가·해제)뿐이다.
  주문을 내거나 설정(손절·익절 값, LIVE_SELL)을 바꾸는 기능은 화면에 없다 - 그 값은 PC의 .env·config.json 에서만 바꾼다.
"""
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from bot import CODE_RE, HERE, STOP_FLAG

TOKEN_PATH = os.path.join(HERE, '.token')
RESEARCH_DIR = os.path.join(HERE, 'research')
ALLOWED_ORIGINS = ('https://ghlee.tistory.com',)
HOST, PORT = '127.0.0.1', 8765


def load_or_create_token():
    if not os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, 'w', encoding='utf-8') as f:
            f.write(secrets.token_hex(24))
    with open(TOKEN_PATH, encoding='utf-8') as f:
        return f.read().strip()


def research_status(research_dir=RESEARCH_DIR):
    """연구 후보 생성기 상태(읽기 전용). 파일·DB가 없으면 available=False. 인증정보·계좌 정보는 포함하지 않는다."""
    path = os.path.join(research_dir, 'status.json')
    if not os.path.exists(path):
        return {'available': False}
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {'available': False, 'error': 'status.json 을 읽지 못했습니다'}
    out = {'available': True}
    out.update(data)
    db = os.path.join(research_dir, 'research.db')
    if os.path.exists(db):
        import sqlite3
        try:
            conn = sqlite3.connect('file:%s?mode=ro' % db.replace(os.sep, '/'), uri=True, timeout=3)
            try:
                out['paper'] = {r[0]: {'closed': r[1], 'avg': r[2], 'win': r[3]} for r in conn.execute(
                    "SELECT scanner, COUNT(*), AVG(ret), AVG(ret>0) FROM paper_trades WHERE status='CLOSED' GROUP BY scanner")}
                out['openPaper'] = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status='OPEN'").fetchone()[0]
                out['recentCandidates'] = [dict(zip(('scanDate', 'scanner', 'code', 'name', 'score', 'status', 'reason'), r)) for r in conn.execute(
                    "SELECT scan_date, scanner, code, name, score, status, reason FROM candidates ORDER BY scan_date DESC, score DESC LIMIT 30")]
            finally:
                conn.close()
        except sqlite3.Error:
            out['dbError'] = True
    return out


def make_handler(bot, store, token):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'AutoTrader/1'

        def log_message(self, *args):  # 접근 로그는 남기지 않는다
            pass

        def _cors(self):
            origin = self.headers.get('Origin', '')
            if origin in ALLOWED_ORIGINS:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Headers', 'X-AutoTrader-Token, Content-Type')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Private-Network', 'true')

        def _send(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self._cors()
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self):
            return secrets.compare_digest(self.headers.get('X-AutoTrader-Token', ''), token)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_GET(self):
            if not self._authorized():
                return self._send(401, {'error': 'token'})
            url = urlparse(self.path)
            query = parse_qs(url.query)
            limit = max(1, min(int((query.get('limit') or ['200'])[0]), 1000))
            if url.path == '/api/status':
                return self._send(200, bot.status())
            if url.path == '/api/watch':
                return self._send(200, {'watch': store.watch_list()})
            if url.path == '/api/holdings':
                return self._send(200, {'holdings': bot.holdings, 'updated': bot.last_poll})
            if url.path == '/api/orders':
                return self._send(200, {'orders': store.orders(limit)})
            if url.path == '/api/research':
                return self._send(200, research_status())
            if url.path == '/api/events':
                return self._send(200, {'events': store.events(limit, (query.get('type') or [None])[0])})
            self._send(404, {'error': 'not found'})

        def _body(self):
            try:
                length = min(int(self.headers.get('Content-Length') or 0), 4096)
                return json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
            except (ValueError, UnicodeDecodeError):
                return {}

        def do_POST(self):
            if not self._authorized():
                return self._send(401, {'error': 'token'})
            if self.path == '/api/stop':
                with open(STOP_FLAG, 'w', encoding='utf-8') as f:
                    f.write('stopped from web')
                store.event('STOP', None, None, '화면에서 정지 요청')
                return self._send(200, {'stopped': True})
            if self.path == '/api/resume':
                if os.path.exists(STOP_FLAG):
                    os.remove(STOP_FLAG)
                store.event('RESUME', None, None, '화면에서 재개 요청')
                return self._send(200, {'stopped': False})
            if self.path in ('/api/watch', '/api/unwatch'):
                body = self._body()
                code = str(body.get('code') or '').strip()
                if not CODE_RE.match(code):
                    return self._send(400, {'error': '종목코드 6자리가 필요합니다'})
                if self.path == '/api/watch':
                    name = str(body.get('name') or '').strip()[:40]
                    store.watch_add(code, name)
                    store.event('WATCH_ADD', code, None, '감시 추가 %s' % name)
                else:
                    store.watch_remove(code)
                    store.event('WATCH_REMOVE', code, None, '감시 해제')
                return self._send(200, {'watch': store.watch_list()})
            self._send(404, {'error': 'not found'})

    return Handler


def start_server(bot, store, token, host=HOST, port=PORT):
    server = ThreadingHTTPServer((host, port), make_handler(bot, store, token))
    return server
