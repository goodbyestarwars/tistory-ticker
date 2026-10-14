# -*- coding: utf-8 -*-
"""자동 손절·익절 봇. 매수는 하지 않는다(매수 기능 자체가 없다).

흐름: 블로그 차트검색에서 종목을 "감시"에 올림 -> 사용자가 직접 매수 -> 이 봇이 잔고에서 감시 종목의 보유분을 찾아
손절(-3%)·익절(+3~5%) 조건이 되면 시장가로 매도한다. 감시 목록에 없는 보유 종목은 절대 건드리지 않는다.

익절 규칙(수익률 = 현재가/매입단가-1):
  - +5% 이상이면 즉시 매도(TP_CAP)
  - 한 번이라도 +3% 이상이었다가 +3% 아래로 내려오면 매도(TP_FLOOR)  -> 3~5% 구간에서 수익을 지킨다
  - -3% 이하면 매도(STOP)
실제 주문은 .env 의 LIVE_SELL=true 일 때만 나간다. 기본값(꺼짐)에서는 "이 주문을 냈을 것"이라고 기록만 한다(DRY_SELL).
"""
import json
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, 'autotrader.db')
STOP_FLAG = os.path.join(HERE, 'STOP')
CODE_RE = re.compile(r'^\d{6}$')
DEFAULT_CONFIG = {
    'stop_loss_pct': 3.0,
    'take_profit_floor_pct': 3.0,
    'take_profit_cap_pct': 5.0,
    'poll_seconds': 30,
    'max_sells_per_day': 10,
    'sell_cooldown_sec': 300,
    'max_attempts_per_code_per_day': 3,
    'off_hours_balance_sec': 300,     # 장외 잔고 조회(읽기 전용) 간격. 주문은 장 시간에만 나간다.
}
# 2026-10-15 사용자 지시: 기존 보유 LG유플러스는 고정 손절·익절을 적용하지 않고 분석 상태만 본다(자동 매도 없음, 사용자 확인 후 직접 진행).
SEED_ANALYSIS_ONLY = {'032640': 'LG유플러스'}
BALANCE_STALE_OPEN_SEC = 120         # 장 중 잔고·현재가가 이보다 오래되면 '오래됨'
BALANCE_STALE_CLOSED_SEC = 900
# 주문 오류 이벤트 문구의 머리말. 텔레그램 알림(tg_data/tg_monitor)이 '증권사 거부'와 '전송 실패'를 가르는 데 같은 값을 쓴다.
MSG_ORDER_REJECTED = '매도 주문 거부'
MSG_ORDER_FAILED = '매도 주문 실패'


def now_kst():
    return datetime.now(KST)


def load_config():
    path = os.path.join(HERE, 'config.json')
    config = dict(DEFAULT_CONFIG)
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            config.update(json.load(f))
    return config


def live_sell_enabled():
    # Deployment approval is not approval to send orders. A separate reviewed
    # activation change is required even if an older PC .env contains LIVE_SELL.
    return False


class Store:
    def __init__(self, path=DB_PATH):
        self.path = path
        with self._conn() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
                code TEXT, price REAL, detail TEXT);
            CREATE TABLE IF NOT EXISTS watch (code TEXT PRIMARY KEY, name TEXT, added_ts TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS analysis_only (code TEXT PRIMARY KEY, name TEXT, added_ts TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS peaks (code TEXT PRIMARY KEY, peak_gain REAL NOT NULL, updated_ts TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL, code TEXT NOT NULL,
                qty INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, ord_no TEXT, detail TEXT);
            ''')
            # 2026-10-15: 감시 등록은 "매도 규칙 확인"(confirmed=1) 전에는 판단·주문에 쓰지 않는다(기존 열 보존, 기본 0).
            if 'confirmed' not in {r[1] for r in c.execute('PRAGMA table_info(watch)')}:
                c.execute('ALTER TABLE watch ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0')
            for code, name in SEED_ANALYSIS_ONLY.items():
                cur = c.execute('INSERT OR IGNORE INTO analysis_only (code, name, added_ts) VALUES (?,?,?)',
                                (code, name, now_kst().strftime('%Y-%m-%d %H:%M:%S')))
                if cur.rowcount:
                    c.execute('DELETE FROM watch WHERE code=?', (code,))     # 고정 손절·익절 대상에서 뺀다
                    c.execute('DELETE FROM peaks WHERE code=?', (code,))

    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def event(self, type_, code=None, price=None, detail=''):
        ts = now_kst().strftime('%Y-%m-%d %H:%M:%S')
        with self._conn() as c:
            c.execute('INSERT INTO events (ts, type, code, price, detail) VALUES (?,?,?,?,?)', (ts, type_, code, price, detail))
        logging.getLogger('autotrader').info('%s %s %s %s', type_, code or '-', price if price is not None else '-', detail)

    def events(self, limit=300, type_=None):
        with self._conn() as c:
            if type_:
                rows = c.execute('SELECT * FROM events WHERE type=? ORDER BY id DESC LIMIT ?', (type_, limit)).fetchall()
            else:
                rows = c.execute('SELECT * FROM events ORDER BY id DESC LIMIT ?', (limit,)).fetchall()
        return [dict(r) for r in rows]

    # ---- 감시 목록 ----
    def watch_add(self, code, name='', confirmed=False):
        """감시 종목 등록. 새로 등록하면 confirmed=0(미확인)이고, 이미 있는 종목을 다시 등록해도 확인 상태를 바꾸지 않는다."""
        ts = now_kst().strftime('%Y-%m-%d %H:%M:%S')
        with self._conn() as c:
            c.execute('INSERT INTO watch (code, name, added_ts, confirmed) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name',
                      (code, name, ts, 1 if confirmed else 0))

    def watch_confirm(self, code, confirmed=True):
        with self._conn() as c:
            cur = c.execute('UPDATE watch SET confirmed=? WHERE code=?', (1 if confirmed else 0, code))
        return cur.rowcount > 0

    def analysis_list(self):
        with self._conn() as c:
            return [dict(r) for r in c.execute('SELECT * FROM analysis_only ORDER BY added_ts')]

    def analysis_add(self, code, name=''):
        """분석 전용 등록: 고정 손절·익절 감시에서는 빠지고(있으면 제거) 분석 상태만 본다."""
        ts = now_kst().strftime('%Y-%m-%d %H:%M:%S')
        with self._conn() as c:
            c.execute('INSERT INTO analysis_only (code, name, added_ts) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name', (code, name, ts))
            c.execute('DELETE FROM watch WHERE code=?', (code,))
            c.execute('DELETE FROM peaks WHERE code=?', (code,))

    def analysis_remove(self, code):
        with self._conn() as c:
            c.execute('DELETE FROM analysis_only WHERE code=?', (code,))

    def watch_remove(self, code):
        with self._conn() as c:
            c.execute('DELETE FROM watch WHERE code=?', (code,))
            c.execute('DELETE FROM peaks WHERE code=?', (code,))

    def watch_list(self):
        with self._conn() as c:
            return [dict(r) for r in c.execute('SELECT * FROM watch ORDER BY added_ts DESC')]

    # ---- 고점 수익률 ----
    def peak_get(self, code):
        with self._conn() as c:
            row = c.execute('SELECT peak_gain FROM peaks WHERE code=?', (code,)).fetchone()
        return row['peak_gain'] if row else None

    def peak_set(self, code, value):
        ts = now_kst().strftime('%Y-%m-%d %H:%M:%S')
        with self._conn() as c:
            c.execute('INSERT INTO peaks (code, peak_gain, updated_ts) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET peak_gain=excluded.peak_gain, updated_ts=excluded.updated_ts',
                      (code, value, ts))

    def peak_clear(self, code):
        with self._conn() as c:
            c.execute('DELETE FROM peaks WHERE code=?', (code,))

    # ---- 주문 기록 ----
    def order_add(self, code, qty, reason, status, ord_no=None, detail=''):
        now = now_kst()
        with self._conn() as c:
            c.execute('INSERT INTO orders (ts, day, code, qty, reason, status, ord_no, detail) VALUES (?,?,?,?,?,?,?,?)',
                      (now.strftime('%Y-%m-%d %H:%M:%S'), now.strftime('%Y-%m-%d'), code, qty, reason, status, ord_no, detail))

    def orders(self, limit=100):
        with self._conn() as c:
            return [dict(r) for r in c.execute('SELECT * FROM orders ORDER BY id DESC LIMIT ?', (limit,))]

    def orders_today(self, status_in=('SENT',)):
        day = now_kst().strftime('%Y-%m-%d')
        marks = ','.join('?' * len(status_in))
        with self._conn() as c:
            return c.execute('SELECT COUNT(*) FROM orders WHERE day=? AND status IN (%s)' % marks, (day,) + tuple(status_in)).fetchone()[0]

    def attempts_today(self, code):
        day = now_kst().strftime('%Y-%m-%d')
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM orders WHERE day=? AND code=? AND status IN ('SENT','ERROR')", (day, code)).fetchone()[0]

    def last_order_ts(self, code):
        with self._conn() as c:
            row = c.execute('SELECT ts FROM orders WHERE code=? ORDER BY id DESC LIMIT 1', (code,)).fetchone()
        if not row:
            return None
        return datetime.strptime(row['ts'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=KST)


def market_open(dt):
    if dt.weekday() >= 5:
        return False
    minutes = dt.hour * 60 + dt.minute
    return 9 * 60 <= minutes <= 15 * 60 + 20      # 정규장 + 종가 단일가 직전까지(시장가 주문 가능 구간)


def decide_exit(gain, peak, config):
    """gain/peak: 수익률(%). 매도 사유 문자열 또는 None."""
    if gain <= -config['stop_loss_pct']:
        return 'STOP'
    if gain >= config['take_profit_cap_pct']:
        return 'TP_CAP'
    if peak is not None and peak >= config['take_profit_floor_pct'] and gain < config['take_profit_floor_pct']:
        return 'TP_FLOOR'
    return None


def live_policy(folder=HERE):
    """PC 실계좌 엔진(live_engine.py)의 실제 상수를 읽어 화면에 보여 준다. 엔진 파일이 없거나 값이 안 맞으면 None(화면은 '조회 불가'로 표시).

    이 모듈을 import하는 것은 상수 조회뿐이며 주문 함수를 호출하지 않는다. 손절·익절 값은 상수가 아니라 exit_reason() 안에 있어
    경계값을 대입해 확인하고, 기대와 다르면 값을 보여 주지 않는다.
    """
    path = os.path.join(folder, 'live_engine.py')
    if not os.path.exists(path):
        return None
    mtime = os.path.getmtime(path)
    cached = _POLICY_CACHE.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    policy = _read_live_policy(path)
    _POLICY_CACHE[path] = (mtime, policy)
    return policy


_POLICY_CACHE = {}


def _read_live_policy(path):
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location('_live_engine_policy', path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        policy = {'budget': int(mod.BUDGET), 'reserve': int(mod.RESERVE), 'per_stock': int(mod.PER_STOCK),
                  'max_stocks': int(mod.MAX_STOCKS), 'cost_pct': float(mod.COST_PCT), 'source': 'live_engine.py'}
        exit_ok = (mod.exit_reason(-5.0, False) == 'STOP_NET_5' and mod.exit_reason(-4.9, False) is None
                   and mod.exit_reason(6.0, False) == 'PROFIT_NET_6' and mod.exit_reason(5.9, False) is None
                   and mod.exit_reason(2.9, True) == 'PROFIT_FLOOR_NET_3' and mod.exit_reason(3.0, True) is None)
        policy['exit'] = {'stop_net_pct': -5.0, 'take_profit_net_pct': 6.0, 'floor_net_pct': 3.0} if exit_ok else None
        return policy
    except Exception:
        return None


class Bot:
    def __init__(self, client, store, config):
        self.client, self.store, self.config = client, store, config
        self.stop_event = threading.Event()
        self.last_poll = None
        self.last_error = None
        self.holdings = []          # 최근 잔고(감시 여부 포함)
        self._held_before = set()
        self._balance_failures = 0
        self.balance_ok_at = None       # 마지막 정상 잔고 조회 시각(KST 문자열)
        self._balance_ok_epoch = None
        self.balance_error = None       # 마지막 조회 실패 메시지(성공하면 None)
        self._last_balance_try = None

    def stopped(self):
        return os.path.exists(STOP_FLAG)

    def status(self):
        dt = now_kst()
        live_scheduled = False
        try:
            with open(os.path.join(HERE, 'LIVE_TRADING_APPROVAL'), encoding='utf-8') as f:
                approval = json.load(f)
            approved_date = datetime.strptime(str(approval.get('date', '')), '%Y-%m-%d').date()
            live_scheduled = (os.environ.get('LIVE_TRADING') == '1' and
                              approved_date <= dt.date() and
                              bool(re.fullmatch(r'[0-9a-f]{64}', str(approval.get('account_sha256', '')))))
        except (OSError, ValueError):
            pass
        live_engine = None
        try:
            with open(os.path.join(HERE, 'live_status.json'), encoding='utf-8') as f:
                item = json.load(f)
            checked = datetime.fromisoformat(str(item.get('checked_at', '')))
            if checked.tzinfo and 0 <= (dt - checked).total_seconds() <= 90:
                live_engine = item
        except (OSError, ValueError):
            pass
        live_active = bool(live_engine and live_engine.get('state') in
                           ('NO_ENTRY', 'NO_CANDIDATE', 'PENDING_ORDERS', 'BUY_SENT',
                            'STOP_NET_5', 'PROFIT_NET_6', 'PROFIT_FLOOR_NET_3'))
        mode = ('실계좌 엔진 가동' if live_active else
                '오늘 실주문 시작 설정됨' if live_scheduled and dt.hour < 9 else
                '실계좌 엔진 상태 확인 필요' if live_scheduled and market_open(dt) else
                '실주문 비활성(준비 중)')
        return {'mode': mode, 'live_sell': live_sell_enabled(), 'live_active': live_active,
                'balance': self.balance_info(), 'live_policy': live_policy(),
                'live_env': os.environ.get('LIVE_TRADING') == '1', 'order_gate': 'LOCAL_BOT_RECORD_ONLY',
                'live_scheduled': live_scheduled,
                'live_engine': live_engine,
                'stopped': self.stopped(), 'market_open': market_open(dt), 'now': dt.strftime('%Y-%m-%d %H:%M:%S'),
                'last_poll': self.last_poll, 'last_error': self.last_error, 'watch_count': len(self.store.watch_list()),
                'stop_loss_pct': self.config['stop_loss_pct'], 'take_profit_floor_pct': self.config['take_profit_floor_pct'],
                'take_profit_cap_pct': self.config['take_profit_cap_pct'], 'sells_today': self.store.orders_today(),
                'max_sells_per_day': self.config['max_sells_per_day']}

    def balance_info(self):
        """잔고 조회 상태. NOT_YET(아직 조회 전) / OK / STALE(오래됨) / FAILED(마지막 시도 실패). 보유 0개와 조회 실패를 구분하는 데 쓴다."""
        age = None if self._balance_ok_epoch is None else max(0, int(time.time() - self._balance_ok_epoch))
        limit = BALANCE_STALE_OPEN_SEC if market_open(now_kst()) else BALANCE_STALE_CLOSED_SEC
        if self._balance_ok_epoch is None:
            state = 'FAILED' if self.balance_error else 'NOT_YET'
        elif self.balance_error:
            state = 'FAILED'
        elif age > limit:
            state = 'STALE'
        else:
            state = 'OK'
        return {'state': state, 'last_ok': self.balance_ok_at, 'age_sec': age, 'error': self.balance_error,
                'count': len(self.holdings) if self._balance_ok_epoch is not None else None,
                'stale_after_sec': limit}

    def health(self):
        """감시용 읽기 전용 상태(텔레그램 관제가 읽는다). 판단 로직에는 쓰이지 않는다."""
        return {'balance_failures': self._balance_failures, 'last_poll': self.last_poll, 'last_error': self.last_error,
                'poll_seconds': self.config['poll_seconds']}

    # ---- 한 번의 폴링 ----
    def _balance_due(self, is_open):
        if is_open:
            return True
        gap = self.config.get('off_hours_balance_sec', 300)
        return self._last_balance_try is None or time.time() - self._last_balance_try >= gap

    def poll_once(self):
        dt = now_kst()
        self.last_poll = dt.strftime('%Y-%m-%d %H:%M:%S')
        is_open = market_open(dt)
        # 2026-10-15: 잔고 조회(읽기 전용)와 주문 판단을 분리한다. 장전·장후에도 보유 종목을 보여 주되 주문 판단은 장 시간에만 한다.
        if not self._balance_due(is_open):
            return
        self._last_balance_try = time.time()
        try:
            holdings = self.client.balance()
            self._balance_failures = 0
        except Exception as exc:
            self._balance_failures += 1
            self.balance_error = '잔고 조회 실패: %s' % exc
            self.last_error = self.balance_error
            if is_open and not self.stopped():
                level = 'CRITICAL' if self._balance_failures >= 3 else 'ERROR'
                self.store.event(level, None, None, '잔고 조회 실패(%d회 연속) - 손절·익절 판단을 못 합니다: %s' % (self._balance_failures, exc))
            return
        self.balance_error = None
        if self.last_error and self.last_error.startswith('잔고 조회 실패'):
            self.last_error = None
        self.balance_ok_at = dt.strftime('%Y-%m-%d %H:%M:%S')
        self._balance_ok_epoch = time.time()
        watch_rows = {w['code']: w for w in self.store.watch_list()}
        analysis = {a['code'] for a in self.store.analysis_list()}
        for h in holdings:
            row = watch_rows.get(h['code'])
            h['analysis_only'] = h['code'] in analysis
            h['watched'] = row is not None and not h['analysis_only']
            h['watch_confirmed'] = bool(row and row.get('confirmed')) and h['watched']
            h['gain'] = (h['price'] / h['avg'] - 1) * 100 if h['avg'] > 0 and h['price'] > 0 else None
            h['peak'] = self.store.peak_get(h['code'])
        self.holdings = holdings
        if self.stopped() or not is_open:
            return
        held_now = {h['code'] for h in holdings}
        for gone in self._held_before - held_now:
            self.store.peak_clear(gone)
            self.store.event('POSITION_CLOSED', gone, None, '보유 종료(전량 매도 또는 외부 매도)')
        self._held_before = {h['code'] for h in holdings if h['watched']}
        for h in holdings:
            # 확인하지 않은 감시 등록은 판단·주문에 쓰지 않는다(이미 기준을 넘은 기존 보유가 등록 즉시 매도되는 사고 방지).
            if h['watched'] and h['watch_confirmed']:
                self.evaluate(h)

    def evaluate(self, h):
        gain = h['gain']
        if gain is None:
            self.store.event('SKIP', h['code'], h['price'], '매입단가 또는 현재가가 0이라 판단 보류')
            return
        peak = h['peak'] if h['peak'] is not None else gain
        if gain > peak:
            peak = gain
        if h['peak'] is None or peak > h['peak']:
            self.store.peak_set(h['code'], peak)
        h['peak'] = peak
        reason = decide_exit(gain, peak, self.config)
        if reason:
            self.sell(h, reason, gain)

    def sell(self, h, reason, gain):
        code, qty = h['code'], h['sellable']
        cfg = self.config
        label = '%s 수익률 %.2f%% (매입 %.0f / 현재 %.0f, %d주)' % (reason, gain, h['avg'], h['price'], qty)
        if qty <= 0:
            self.store.event('SKIP', code, h['price'], '매도 가능 수량 0: ' + label)
            return
        last = self.store.last_order_ts(code)
        if last and (now_kst() - last).total_seconds() < cfg['sell_cooldown_sec']:
            return                      # 같은 종목 재주문 대기 중(체결 확인을 기다린다)
        if self.store.attempts_today(code) >= cfg['max_attempts_per_code_per_day']:
            self.store.event('CRITICAL', code, h['price'], '오늘 이 종목 주문 시도 한도(%d) 도달 - 직접 확인하세요: %s' % (cfg['max_attempts_per_code_per_day'], label))
            return
        if self.store.orders_today() >= cfg['max_sells_per_day']:
            self.store.event('CRITICAL', code, h['price'], '오늘 매도 주문 한도(%d) 도달 - 직접 확인하세요: %s' % (cfg['max_sells_per_day'], label))
            return
        if not live_sell_enabled():
            self.store.order_add(code, qty, reason, 'DRY', None, label)
            self.store.event('DRY_SELL', code, h['price'], '주문 안 보냄(LIVE_SELL 꺼짐): ' + label)
            return
        try:
            result = self.client.sell_market(code, qty)
        except Exception as exc:
            self.store.order_add(code, qty, reason, 'ERROR', None, str(exc))
            self.store.event('ERROR', code, h['price'], '%s: %s | %s' % (MSG_ORDER_FAILED, exc, label))
            self.last_error = '매도 주문 실패: %s' % exc
            return
        if result.get('ok'):
            self.store.order_add(code, qty, reason, 'SENT', str(result.get('ord_no') or ''), label)
            self.store.event('SELL_SENT', code, h['price'], '시장가 매도 주문 전송 주문번호 %s: %s' % (result.get('ord_no'), label))
        else:
            self.store.order_add(code, qty, reason, 'ERROR', None, '%s %s' % (result.get('return_code'), result.get('return_msg')))
            self.store.event('ERROR', code, h['price'], '%s: %s %s | %s' % (MSG_ORDER_REJECTED, result.get('return_code'), result.get('return_msg'), label))

    # ---- 루프 ----
    def run_forever(self):
        self.store.event('START', None, None, '시작: %s' % ('실주문 ON(매도 전용)' if live_sell_enabled() else '기록 전용'))
        while not self.stop_event.is_set():
            try:
                self.poll_once()
            except Exception as exc:
                self.last_error = str(exc)
                self.store.event('ERROR', None, None, '폴링 오류: %s' % exc)
            self.stop_event.wait(self.config['poll_seconds'])
