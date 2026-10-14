# -*- coding: utf-8 -*-
"""로컬 상태 API(127.0.0.1 전용). 블로그의 "자동매매" 화면이 이 주소를 읽는다.

- 127.0.0.1에만 바인딩한다(외부에서 접속 불가).
- 모든 요청에 X-AutoTrader-Token 헤더(.token 파일 값)가 있어야 한다. 토큰이 틀리면 401.
- CORS는 지정한 블로그 주소(Origin) 하나만 허용한다. Chrome의 사설망 접근 확인(Private Network Access) 사전 요청도 처리한다.
- GET /api/research: 연구 후보 생성기(research/research_job.py)가 남기는 상태 파일(research/status.json)과 후보·모의 집계, 장중 가상매매 상태(livePaper = research/livepaper.json)를 읽기 전용으로 돌려준다.
- POST는 /api/stop·/api/resume(정지 플래그 파일 생성·삭제), /api/watch·/api/unwatch(감시 종목 추가·해제),
  /api/watch-confirm(감시 종목의 손절·익절 규칙 확인 표시), /api/analysis·/api/analysis-remove(분석 전용 등록·해제)뿐이다.
  주문을 내거나 설정(손절·익절 값, LIVE_SELL)을 바꾸는 기능은 화면에 없다 - 그 값은 PC의 .env·config.json 에서만 바꾼다.
  감시 등록은 기본 '규칙 미확인'이라 확인하기 전에는 판단·주문에 쓰이지 않고, 분석 전용 종목에는 고정 손절·익절을 적용하지 않는다.
"""
import json
import os
import secrets
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from bot import CODE_RE, HERE, STOP_FLAG, live_sell_enabled

TOKEN_PATH = os.path.join(HERE, '.token')
RESEARCH_DIR = os.path.join(HERE, 'research')
ALLOWED_ORIGINS = ('https://ghlee.tistory.com',)
HOST, PORT = '127.0.0.1', int(os.environ.get('AUTOTRADER_PORT') or 8765)     # 환경변수는 테스트용(운영은 기본 8765)


def live_snapshot(path=None):
    """Read-only local order ledger; never exposes account identifiers or credentials."""
    path = path or os.path.join(HERE, 'live_orders.db')
    if not os.path.exists(path):
        return {}, []
    try:
        db = sqlite3.connect(path, timeout=1)
        db.row_factory = sqlite3.Row
        try:
            positions = {r['code']: dict(r) for r in db.execute(
                "SELECT code,qty,state,floor_reached FROM positions WHERE state IN ('OPEN','PENDING')")}
            intents = [dict(r) for r in db.execute(
                'SELECT ts,code,side,qty,state,order_no FROM intents ORDER BY id DESC LIMIT 100')]
        finally:
            db.close()
    except sqlite3.Error:
        return {}, []
    orders = [{'ts': r['ts'].replace('T', ' ')[:19], 'code': r['code'], 'qty': r['qty'],
               'reason': r['side'], 'status': r['state'], 'ord_no': r['order_no'],
               'detail': '실계좌 ' + ('매수' if r['side'] == 'BUY' else '매도') + ' 주문'} for r in intents]
    return positions, orders


def classify_holdings(holdings, positions, orders, watch_rows, analysis_codes, config, today):
    """보유 종목에 화면용 구분을 붙인다(읽기 전용 계산).

    kind: engine(실계좌 엔진이 산 종목) / mixed(엔진 + 기존 수동 보유 수량이 섞임) / manual(기존 수동 보유)
    qty = 잔고 수량, sellable = 주문 가능, locked_qty = 잔고 - 주문 가능(미체결 등으로 묶인 수량)
    sell_watch: analysis(분석 전용) / rule_confirmed / rule_unconfirmed / none  - 규칙 확인과 실주문 활성은 별개다.
    rule_beyond: 규칙을 적용하면 등록 즉시 기준을 넘는 상태(미확인 등록이 즉시 매도로 이어지지 않도록 화면이 경고한다).
    pending_order: 오늘 이 종목에 전송 후 접수·체결 확인이 끝나지 않은 주문이 있음.
    """
    pending_codes = {o['code'] for o in orders
                     if str(o.get('ts', ''))[:10] == today and o.get('status') in ('UNKNOWN', 'ACK', 'SENT')}
    out = []
    for h in holdings:
        row = dict(h)
        code = row['code']
        pos = positions.get(code)
        qty = int(row.get('qty') or 0)
        engine_qty = int(pos.get('qty') or 0) if pos else 0
        if pos and engine_qty > 0:
            row['kind'] = 'engine' if engine_qty >= qty else 'mixed'
            row['engine_qty'] = min(engine_qty, qty)
            row['manual_qty'] = max(0, qty - engine_qty)
            row['qty_mismatch'] = engine_qty > qty
        else:
            row['kind'] = 'manual'
            row['engine_qty'] = 0
            row['manual_qty'] = qty
            row['qty_mismatch'] = False
        row['live_managed'] = bool(pos)
        row['live_floor_reached'] = bool(pos and pos.get('floor_reached'))
        row['locked_qty'] = max(0, qty - int(row.get('sellable') or 0))
        watch = watch_rows.get(code)
        if code in analysis_codes:
            row['sell_watch'] = 'analysis'
        elif watch:
            row['sell_watch'] = 'rule_confirmed' if watch.get('confirmed') else 'rule_unconfirmed'
        else:
            row['sell_watch'] = 'none'
        gain = row.get('gain')
        row['rule_beyond'] = bool(row['sell_watch'] in ('rule_confirmed', 'rule_unconfirmed') and gain is not None and
                                  (gain <= -config['stop_loss_pct'] or gain >= config['take_profit_cap_pct']))
        row['pending_order'] = code in pending_codes
        out.append(row)
    return out


def load_or_create_token():
    if not os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, 'w', encoding='utf-8') as f:
            f.write(secrets.token_hex(24))
    with open(TOKEN_PATH, encoding='utf-8') as f:
        return f.read().strip()


def live_paper_status(research_dir=RESEARCH_DIR):
    """장중 실시간 페이퍼 트레이딩(live_paper_job)이 남기는 livepaper.json. 없거나 깨졌으면 None. 가상 체결 기록이며 주문 정보가 아니다."""
    try:
        with open(os.path.join(research_dir, 'livepaper.json'), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def research_status(research_dir=RESEARCH_DIR):
    out = _research_status(research_dir)
    live = live_paper_status(research_dir)
    if live is not None:
        out['livePaper'] = live
    return out


def _research_status(research_dir=RESEARCH_DIR):
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
                have = {r[1] for r in conn.execute('PRAGMA table_info(paper_trades)')}
                if 'exit_reason' in have:
                    # 전략(variant)별로 따로 집계한다 - 세 청산 전략의 거래를 하나의 성과로 합치지 않는다.
                    paper = {}
                    for variant, scanner, n, avg, win in conn.execute(
                            "SELECT variant, scanner, COUNT(*), AVG(ret), AVG(ret>0) FROM paper_trades WHERE status='CLOSED' GROUP BY variant, scanner"):
                        paper.setdefault(variant, {})[scanner] = {'closed': n, 'avg': avg, 'win': win}
                    out['paper'] = paper
                    out['openPaper'] = {r[0]: {'open': r[1], 'pendingExit': r[2]} for r in conn.execute(
                        "SELECT variant, SUM(status='OPEN'), SUM(status='PENDING_EXIT') FROM paper_trades GROUP BY variant")}
                cols = ('scanDate', 'scanner', 'code', 'name', 'score', 'basePrice', 'status', 'reason')
                out['recentCandidates'] = [dict(zip(cols, r)) for r in conn.execute(
                    "SELECT scan_date, scanner, code, name, score, base_price, status, reason FROM candidates ORDER BY scan_date DESC, score DESC LIMIT 40")]
                out['dataDate'] = (conn.execute("SELECT MAX(scan_date) FROM candidates").fetchone() or [None])[0]
                if 'exit_reason' in have:
                    tcols = ('scanDate', 'scanner', 'code', 'name', 'variant', 'entryDate', 'entryPrice', 'stopPrice', 'trailPrice', 'signalDate', 'exitDate',
                             'exitPrice', 'ret', 'grossRet', 'exitReason', 'holdDays', 'status', 'note')
                    out['paperTrades'] = [dict(zip(tcols, r)) for r in conn.execute(
                        "SELECT t.scan_date, t.scanner, t.code, c.name, t.variant, t.entry_date, t.entry_price, t.stop_price, t.trail_price, t.signal_date, "
                        "t.exit_date, t.exit_price, t.ret, t.gross_ret, t.exit_reason, t.hold_days, t.status, t.note "
                        "FROM paper_trades t LEFT JOIN candidates c ON c.scan_date=t.scan_date AND c.scanner=t.scanner AND c.code=t.code "
                        "ORDER BY t.scan_date DESC, t.code, t.variant LIMIT 90")]
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
                positions, live_orders = live_snapshot()
                holdings = classify_holdings(
                    bot.holdings, positions, live_orders + store.orders(50),
                    {w['code']: w for w in store.watch_list()}, {a['code'] for a in store.analysis_list()},
                    bot.config, bot.status()['now'][:10])
                return self._send(200, {'holdings': holdings, 'updated': bot.last_poll, 'balance': bot.balance_info()})
            if url.path == '/api/analysis':
                return self._send(200, {'analysis': store.analysis_list()})
            if url.path == '/api/orders':
                _, live_orders = live_snapshot()
                orders = store.orders(limit) + live_orders
                orders.sort(key=lambda r: r['ts'], reverse=True)
                return self._send(200, {'orders': orders[:limit]})
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
            if self.path in ('/api/watch', '/api/unwatch', '/api/watch-confirm', '/api/analysis', '/api/analysis-remove'):
                body = self._body()
                code = str(body.get('code') or '').strip()
                if not CODE_RE.match(code):
                    return self._send(400, {'error': '종목코드 6자리가 필요합니다'})
                name = str(body.get('name') or '').strip()[:40]
                if self.path == '/api/analysis':
                    store.analysis_add(code, name)
                    store.event('ANALYSIS_ADD', code, None, '분석 전용 등록(고정 손절·익절 미적용, 자동 매도 없음) %s' % name)
                    return self._send(200, {'analysis': store.analysis_list(), 'watch': store.watch_list()})
                if self.path == '/api/analysis-remove':
                    store.analysis_remove(code)
                    store.event('ANALYSIS_REMOVE', code, None, '분석 전용 해제')
                    return self._send(200, {'analysis': store.analysis_list()})
                if self.path == '/api/watch-confirm':
                    confirmed = bool(body.get('confirmed', True))
                    if not store.watch_confirm(code, confirmed):
                        return self._send(404, {'error': '감시 종목이 아닙니다'})
                    store.event('WATCH_CONFIRM', code, None, ('손절·익절 규칙 확인' if confirmed else '규칙 확인 취소')
                                + (' - 로컬 봇의 실주문은 비활성이라 주문은 나가지 않음' if not live_sell_enabled() else ''))
                    return self._send(200, {'watch': store.watch_list()})
                if self.path == '/api/watch':
                    if code in {a['code'] for a in store.analysis_list()}:
                        return self._send(409, {'error': '분석 전용 종목입니다. 분석 전용을 해제한 뒤 감시 등록하세요'})
                    store.watch_add(code, name)
                    store.event('WATCH_ADD', code, None, '감시 추가(규칙 미확인 - 확인 전에는 판단·주문에 쓰지 않음) %s' % name)
                else:
                    store.watch_remove(code)
                    store.event('WATCH_REMOVE', code, None, '감시 해제')
                return self._send(200, {'watch': store.watch_list()})
            self._send(404, {'error': 'not found'})

    return Handler


def start_server(bot, store, token, host=HOST, port=PORT):
    server = ThreadingHTTPServer((host, port), make_handler(bot, store, token))
    return server
