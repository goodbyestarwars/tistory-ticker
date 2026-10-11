# -*- coding: utf-8 -*-
"""테스트 전용 가짜 Telegram Bot API 서버(127.0.0.1). 실제 토큰 없이 롱 폴링·전송·장애 복구 경로를 HTTP 로 검증한다.

실제 텔레그램을 대신하지 않는다 - 요청/응답 모양(getUpdates offset 확인, sendMessage, 오류 코드, HTML 파싱 규칙)만 흉내 낸다.
HTML 규칙은 텔레그램의 것과 같게 엄격하게 검사한다(허용 태그 b/i/u/s/code/pre/a, 태그 짝, 특수문자 이스케이프).
이 파일은 운영에 복사하지 않는다.
"""
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALLOWED_TAGS = {'b', 'i', 'u', 's', 'code', 'pre', 'a', 'em', 'strong', 'tg-spoiler'}
TAG_RE = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-z-]+="[^"]*")?)\s*>')
ENTITY_RE = re.compile(r'&(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);')


def html_problem(text):
    """텔레그램 HTML parse_mode 가 거부할 문제를 설명하는 문자열, 문제없으면 None."""
    stack, pos = [], 0
    while True:
        lt = text.find('<', pos)
        chunk = text[pos:] if lt < 0 else text[pos:lt]
        for m in re.finditer(r'&', chunk):
            if not ENTITY_RE.match(chunk, m.start()):
                return "unescaped & near %r" % chunk[max(0, m.start() - 10):m.start() + 10]
        if '>' in chunk:
            return "unescaped > near %r" % chunk[max(0, chunk.index('>') - 10):chunk.index('>') + 10]
        if lt < 0:
            break
        m = TAG_RE.match(text, lt)
        if not m or m.group(2).lower() not in ALLOWED_TAGS:
            return "bad tag at %r" % text[lt:lt + 20]
        if m.group(1):
            if not stack or stack.pop() != m.group(2).lower():
                return "unbalanced </%s>" % m.group(2)
        else:
            stack.append(m.group(2).lower())
        pos = m.end()
    return "unclosed <%s>" % stack[-1] if stack else None


class FakeTelegram:
    def __init__(self, token='111222333:TESTTOKEN_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'):
        self.token = token
        self.lock = threading.Lock()
        self.updates = []           # [{'update_id':..., ...}]
        self.next_id = 1000
        self.sent = []              # sendMessage 호출 기록
        self.commands = None
        self.menu_button = None
        self.callbacks = []
        self.webhook_active = False
        self.fail_mode = None       # None | 'drop' (응답 없이 연결 끊기) | '500' | '429' | 'refuse_send_only'
        self.conflict = False       # getUpdates 409
        self.requests = []          # (method, 시각)
        self.message_id = 0
        class QuietServer(ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request, client_address):      # 연결 끊김 시뮬레이션에서 나는 예외 출력을 막는다
                pass

        self.server = QuietServer(('127.0.0.1', 0), self._handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self):
        return 'http://127.0.0.1:%d' % self.server.server_address[1]

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    # ---- 테스트가 쓰는 도우미 ----
    def push_message(self, user_id, text, chat_id=None, chat_type='private', date=None, is_bot=False):
        with self.lock:
            self.next_id += 1
            self.updates.append({'update_id': self.next_id, 'message': {
                'message_id': self.next_id, 'date': int(date or time.time()), 'text': text,
                'from': {'id': user_id, 'is_bot': is_bot, 'first_name': 'T'}, 'chat': {'id': chat_id if chat_id is not None else user_id, 'type': chat_type}}})
            return self.next_id

    def push_callback(self, user_id, data, chat_id=None):
        with self.lock:
            self.next_id += 1
            self.updates.append({'update_id': self.next_id, 'callback_query': {
                'id': 'cb%d' % self.next_id, 'from': {'id': user_id, 'is_bot': False}, 'data': data,
                'message': {'message_id': 1, 'date': int(time.time()), 'chat': {'id': chat_id if chat_id is not None else user_id, 'type': 'private'}}}})

    def texts(self, chat_id=None):
        with self.lock:
            return [s['text'] for s in self.sent if chat_id is None or s['chat_id'] == chat_id]

    def wait_for(self, predicate, timeout=8.0):
        end = time.time() + timeout
        while time.time() < end:
            if predicate():
                return True
            time.sleep(0.05)
        return predicate()

    # ---- HTTP ----
    def _handler(self):
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _json(self, code, body):
                data = json.dumps(body).encode('utf-8')
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                length = int(self.headers.get('Content-Length') or 0)
                params = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                m = re.match(r'^/bot([^/]+)/(\w+)$', self.path)
                if not m:
                    return self._json(404, {'ok': False, 'error_code': 404, 'description': 'Not Found'})
                token, method = m.group(1), m.group(2)
                with outer.lock:
                    outer.requests.append((method, time.time()))
                if token != outer.token:
                    return self._json(401, {'ok': False, 'error_code': 401, 'description': 'Unauthorized'})
                if outer.fail_mode == 'drop':
                    self.connection.close()
                    return
                if outer.fail_mode == '500':
                    return self._json(500, {'ok': False, 'error_code': 500, 'description': 'Internal Server Error'})
                if outer.fail_mode == '429' and method == 'sendMessage':
                    return self._json(429, {'ok': False, 'error_code': 429, 'description': 'Too Many Requests', 'parameters': {'retry_after': 1}})
                handler = getattr(outer, 'api_' + method, None)
                if handler is None:
                    return self._json(404, {'ok': False, 'error_code': 404, 'description': 'method not found'})
                code, body = handler(params)
                self._json(code, body)

        return H

    def api_getMe(self, p):
        return 200, {'ok': True, 'result': {'id': 111222333, 'is_bot': True, 'username': 'ninepay_test_bot'}}

    def api_getUpdates(self, p):
        if self.conflict:
            return 409, {'ok': False, 'error_code': 409, 'description': 'Conflict: terminated by other getUpdates request'}
        if self.webhook_active:
            return 409, {'ok': False, 'error_code': 409, 'description': "Conflict: can't use getUpdates method while webhook is active"}
        offset = p.get('offset')
        end = time.time() + min(float(p.get('timeout') or 0), 1.0)
        while True:
            with self.lock:
                if offset is not None and offset < 0:
                    out = self.updates[-1:]
                    self.updates = []
                    return 200, {'ok': True, 'result': out}
                if offset is not None:
                    self.updates = [u for u in self.updates if u['update_id'] >= offset]
                if self.updates:
                    return 200, {'ok': True, 'result': list(self.updates)}
            if time.time() >= end:
                return 200, {'ok': True, 'result': []}
            time.sleep(0.05)

    def api_sendMessage(self, p):
        if p.get('parse_mode') == 'HTML':
            problem = html_problem(p.get('text', ''))
            if problem:
                return 400, {'ok': False, 'error_code': 400, 'description': "Bad Request: can't parse entities: " + problem}
        if len(p.get('text', '')) > 4096:
            return 400, {'ok': False, 'error_code': 400, 'description': 'Bad Request: message is too long'}
        with self.lock:
            self.message_id += 1
            self.sent.append({'chat_id': p.get('chat_id'), 'text': p.get('text'), 'parse_mode': p.get('parse_mode'), 'reply_markup': p.get('reply_markup')})
            return 200, {'ok': True, 'result': {'message_id': self.message_id}}

    def api_answerCallbackQuery(self, p):
        self.callbacks.append(p)
        return 200, {'ok': True, 'result': True}

    def api_setMyCommands(self, p):
        self.commands = p.get('commands')
        return 200, {'ok': True, 'result': True}

    def api_setChatMenuButton(self, p):
        self.menu_button = p.get('menu_button')
        return 200, {'ok': True, 'result': True}

    def api_deleteWebhook(self, p):
        self.webhook_active = False
        return 200, {'ok': True, 'result': True}
