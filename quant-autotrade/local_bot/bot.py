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
}


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
    return os.environ.get('LIVE_SELL', '').strip().lower() in ('1', 'true', 'yes', 'on')


class Store:
    def __init__(self, path=DB_PATH):
        self.path = path
        with self._conn() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
                code TEXT, price REAL, detail TEXT);
            CREATE TABLE IF NOT EXISTS watch (code TEXT PRIMARY KEY, name TEXT, added_ts TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS peaks (code TEXT PRIMARY KEY, peak_gain REAL NOT NULL, updated_ts TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL, code TEXT NOT NULL,
                qty INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, ord_no TEXT, detail TEXT);
            ''')

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
    def watch_add(self, code, name=''):
        ts = now_kst().strftime('%Y-%m-%d %H:%M:%S')
        with self._conn() as c:
            c.execute('INSERT INTO watch (code, name, added_ts) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name', (code, name, ts))

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


class Bot:
    def __init__(self, client, store, config):
        self.client, self.store, self.config = client, store, config
        self.stop_event = threading.Event()
        self.last_poll = None
        self.last_error = None
        self.holdings = []          # 최근 잔고(감시 여부 포함)
        self._held_before = set()
        self._balance_failures = 0

    def stopped(self):
        return os.path.exists(STOP_FLAG)

    def status(self):
        dt = now_kst()
        return {'mode': '실주문 ON(매도 전용)' if live_sell_enabled() else '기록 전용(매도 주문 안 나감)', 'live_sell': live_sell_enabled(),
                'stopped': self.stopped(), 'market_open': market_open(dt), 'now': dt.strftime('%Y-%m-%d %H:%M:%S'),
                'last_poll': self.last_poll, 'last_error': self.last_error, 'watch_count': len(self.store.watch_list()),
                'stop_loss_pct': self.config['stop_loss_pct'], 'take_profit_floor_pct': self.config['take_profit_floor_pct'],
                'take_profit_cap_pct': self.config['take_profit_cap_pct'], 'sells_today': self.store.orders_today(),
                'max_sells_per_day': self.config['max_sells_per_day']}

    # ---- 한 번의 폴링 ----
    def poll_once(self):
        dt = now_kst()
        self.last_poll = dt.strftime('%Y-%m-%d %H:%M:%S')
        if self.stopped() or not market_open(dt):
            return
        try:
            holdings = self.client.balance()
            self._balance_failures = 0
        except Exception as exc:
            self._balance_failures += 1
            self.last_error = '잔고 조회 실패: %s' % exc
            level = 'CRITICAL' if self._balance_failures >= 3 else 'ERROR'
            self.store.event(level, None, None, '잔고 조회 실패(%d회 연속) - 손절·익절 판단을 못 합니다: %s' % (self._balance_failures, exc))
            return
        watched = {w['code'] for w in self.store.watch_list()}
        for h in holdings:
            h['watched'] = h['code'] in watched
            h['gain'] = (h['price'] / h['avg'] - 1) * 100 if h['avg'] > 0 and h['price'] > 0 else None
            h['peak'] = self.store.peak_get(h['code'])
        self.holdings = holdings
        held_now = {h['code'] for h in holdings}
        for gone in self._held_before - held_now:
            self.store.peak_clear(gone)
            self.store.event('POSITION_CLOSED', gone, None, '보유 종료(전량 매도 또는 외부 매도)')
        self._held_before = held_now & watched
        for h in holdings:
            if h['watched']:
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
            self.store.event('ERROR', code, h['price'], '매도 주문 실패: %s | %s' % (exc, label))
            self.last_error = '매도 주문 실패: %s' % exc
            return
        if result.get('ok'):
            self.store.order_add(code, qty, reason, 'SENT', str(result.get('ord_no') or ''), label)
            self.store.event('SELL_SENT', code, h['price'], '시장가 매도 주문 전송 주문번호 %s: %s' % (result.get('ord_no'), label))
        else:
            self.store.order_add(code, qty, reason, 'ERROR', None, '%s %s' % (result.get('return_code'), result.get('return_msg')))
            self.store.event('ERROR', code, h['price'], '매도 주문 거부: %s %s | %s' % (result.get('return_code'), result.get('return_msg'), label))

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
