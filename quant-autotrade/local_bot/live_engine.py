# -*- coding: utf-8 -*-
"""Single-account real-order engine. Disabled until a separate, dated local approval.

This module never runs from the website. It is invoked only on the account owner's PC.
Order attempts are durably reserved before broker calls; uncertain responses stop trading.
"""
import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
BUDGET = 1_000_000
RESERVE = 100_000
PER_STOCK = 300_000
MAX_STOCKS = 3
# Conservative round-trip cost allowance until actual account fees/taxes are verified.
COST_PCT = 0.7
CODE_RE = re.compile(r'^\d{6}$')


def net_gain(price, avg, cost_pct=COST_PCT):
    if not price or not avg or price <= 0 or avg <= 0:
        return None
    return (price / avg - 1) * 100 - cost_pct


def exit_reason(gain, reached_floor):
    if gain is None:
        return None
    if gain <= -5:
        return 'STOP_NET_5'
    if gain >= 6:
        return 'PROFIT_NET_6'
    if reached_floor and gain < 3:
        return 'PROFIT_FLOOR_NET_3'
    return None


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def rank_candidates(rows, get_daily, today):
    """Use completed bars only; compare traded value, liquidity, volatility and trend."""
    best = {}
    for row in rows:
        code = str(row['code'])
        if not CODE_RE.fullmatch(code) or row['status'] != 'NEW' or row['scan_date'] >= today:
            continue
        bars = [b for b in get_daily(code) if b['date'] <= row['scan_date']]
        if len(bars) < 21 or bars[-1]['date'] != row['scan_date']:
            continue
        last = bars[-1]
        closes = [_number(b['close']) for b in bars[-20:]]
        values = [_number(b['close']) * _number(b['volume']) for b in bars[-20:]]
        ranges = [(_number(b['high']) - _number(b['low'])) / _number(b['close'])
                  for b in bars[-20:] if _number(b['close']) > 0]
        if len(ranges) < 20 or min(closes) <= 0 or min(values) <= 0:
            continue
        avg_value = sum(values) / 20
        volatility = sum(ranges) / 20
        trend = closes[-1] / (sum(closes) / 20) - 1
        if avg_value < 1_000_000_000 or not 0.01 <= volatility <= 0.08 or trend <= 0:
            continue
        # All four inputs affect ordering. Outliers in volatility are penalized.
        score = (values[-1] / 1e9, avg_value / 1e9, -abs(volatility - 0.035), trend)
        item = (score, code, last['close'], row['scan_date'])
        if code not in best or score > best[code][0]:
            best[code] = item
    return sorted(best.values(), reverse=True)


class Ledger:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.executescript('''
              CREATE TABLE IF NOT EXISTS positions(code TEXT PRIMARY KEY, qty INTEGER NOT NULL,
                state TEXT NOT NULL, floor_reached INTEGER NOT NULL DEFAULT 0, buy_day TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS intents(id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
                code TEXT NOT NULL, side TEXT NOT NULL, qty INTEGER NOT NULL,
                price INTEGER, state TEXT NOT NULL, order_no TEXT, detail TEXT);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def reserve(self, code, side, qty, price=None):
        with self.connect() as db:
            cur = db.execute('INSERT INTO intents(ts,code,side,qty,price,state) VALUES(?,?,?,?,?,?)',
                             (datetime.now(KST).isoformat(), code, side, qty, price, 'UNKNOWN'))
            return cur.lastrowid

    def acknowledge(self, intent_id, response):
        # Rejected/unknown orders require manual inspection. Never retry automatically.
        state = 'ACK' if response.get('ok') and response.get('ord_no') else 'UNKNOWN'
        with self.connect() as db:
            db.execute('UPDATE intents SET state=?,order_no=?,detail=? WHERE id=?',
                       (state, response.get('ord_no'), str(response.get('return_code', '')), intent_id))
        return state

    def has_uncertain(self):
        with self.connect() as db:
            return db.execute("SELECT 1 FROM intents WHERE state='UNKNOWN' LIMIT 1").fetchone() is not None


def approval_ok(folder, account_ids, now):
    """Account-bound mandate effective from the user's approved start date."""
    if os.environ.get('LIVE_TRADING') != '1' or len(account_ids) != 1:
        return False
    if os.environ.get('KIWOOM_BASE_URL', 'https://api.kiwoom.com').rstrip('/') != 'https://api.kiwoom.com':
        return False
    try:
        with open(os.path.join(folder, 'LIVE_TRADING_APPROVAL'), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    fingerprint = hashlib.sha256(account_ids[0].encode()).hexdigest()
    if data.get('account_sha256') != fingerprint:
        return False
    try:
        approved_day = datetime.strptime(str(data.get('date')), '%Y-%m-%d').date()
    except ValueError:
        return False
    return approved_day <= now.date()


def readiness(client, folder, now):
    accounts = client.account_ids()
    holdings = client.balance()
    pending = client.unfilled()
    cash = client.cash_available()
    return {'one_account': len(accounts) == 1, 'holdings_clear': len(holdings) == 0,
            'orders_clear': len(pending) == 0, 'budget_funded': cash >= BUDGET,
            'approved': approval_ok(folder, accounts, now)}


def fresh_price(client, code, now):
    price, stamp = client.last_price(code)
    if not price or not stamp:
        return None
    try:
        age = (now - datetime.strptime(stamp, '%Y-%m-%d %H:%M').replace(tzinfo=KST)).total_seconds()
    except ValueError:
        return None
    return price if 0 <= age <= 180 else None


def trade_once(client, ledger, candidate_rows, get_daily, folder, now=None):
    """One bounded trading cycle. Caller provides verified prior-night candidates."""
    now = now or datetime.now(KST)
    minute = now.hour * 60 + now.minute
    if now.weekday() >= 5 or not (540 <= minute <= 920) or os.path.exists(os.path.join(folder, 'STOP')):
        return 'CLOSED_OR_STOPPED'
    accounts = client.account_ids()
    if not approval_ok(folder, accounts, now) or ledger.has_uncertain():
        return 'DISABLED_OR_UNCERTAIN'
    holdings = client.balance()
    pending = client.unfilled()
    cash = client.cash_available()
    if len(accounts) != 1 or pending:
        return 'PENDING_ORDERS'
    held = {h['code']: h for h in holdings}
    with ledger.connect() as db:
        positions = {r['code']: dict(r) for r in db.execute('SELECT * FROM positions')}
        sent_today = {r['code'] for r in db.execute(
            "SELECT code FROM intents WHERE side='BUY' AND substr(ts,1,10)=?", (now.strftime('%Y-%m-%d'),))}
        had_buy = db.execute("SELECT 1 FROM intents WHERE side='BUY' LIMIT 1").fetchone() is not None
        sell_sent = {r['code'] for r in db.execute(
            "SELECT DISTINCT s.code FROM intents s WHERE s.side='SELL' AND s.id > "
            "COALESCE((SELECT MAX(b.id) FROM intents b WHERE b.side='BUY' AND b.code=s.code),0)")}
        committed = sum(r[0] * r[1] if r[1] else PER_STOCK for r in db.execute(
            "SELECT p.qty, (SELECT b.price FROM intents b WHERE b.side='BUY' AND b.code=p.code "
            "ORDER BY b.id DESC LIMIT 1) FROM positions p WHERE p.state IN ('OPEN','PENDING')"))
    if not had_buy and cash < BUDGET:
        return 'INSUFFICIENT_STARTING_CASH'
    for code, pos in positions.items():
        h = held.get(code)
        if h is None and pos['state'] == 'OPEN':
            with ledger.connect() as db:
                db.execute("UPDATE positions SET state='CLOSED' WHERE code=?", (code,))
        elif h is not None and pos['state'] == 'PENDING':
            with ledger.connect() as db:
                db.execute("UPDATE positions SET state='OPEN',qty=? WHERE code=?", (h['qty'], code))
            pos['qty'] = h['qty']
            pos['state'] = 'OPEN'
    # Acknowledged orders with no confirmed fill must be inspected, not retried.
    if any(p['state'] == 'PENDING' and c not in held for c, p in positions.items()):
        return 'BUY_FILL_UNCONFIRMED'
    # Never sell holdings that this engine did not buy.
    for code, pos in positions.items():
        h = held.get(code)
        if pos['state'] != 'OPEN' or code in sell_sent or not h or h['sellable'] <= 0:
            continue
        price = fresh_price(client, code, now)
        if price is None:
            return 'PRICE_UNAVAILABLE'
        gain = net_gain(price, h['avg'])
        reached = bool(pos['floor_reached']) or (gain is not None and gain >= 3)
        if reached and not pos['floor_reached']:
            with ledger.connect() as db:
                db.execute('UPDATE positions SET floor_reached=1 WHERE code=?', (code,))
        reason = exit_reason(gain, reached)
        if reason:
            intent = ledger.reserve(code, 'SELL', min(pos['qty'], h['sellable']))
            result = client.sell_market(code, min(pos['qty'], h['sellable']))
            ledger.acknowledge(intent, result)
            return reason
    if any(code in held for code in sell_sent):
        return 'SELL_FILL_UNCONFIRMED'
    if any(code not in positions for code in held):
        return 'FOREIGN_HOLDINGS'
    slots_used = len(set(held) | {c for c, p in positions.items() if p['state'] != 'CLOSED'})
    if not (9 <= now.hour < 10) or cash <= RESERVE or slots_used >= MAX_STOCKS or committed >= BUDGET - RESERVE:
        return 'NO_ENTRY'
    # Existing holdings consume slots and capital even if manually acquired.
    ranked = rank_candidates(candidate_rows, get_daily, now.strftime('%Y-%m-%d'))
    for _, code, base, scan_date in ranked:
        pos = positions.get(code)
        if code in held or code in sent_today or (pos and pos['state'] != 'CLOSED') or slots_used >= MAX_STOCKS:
            continue
        price = fresh_price(client, code, now)
        if price is None:
            continue
        if price >= _number(base) * 1.02:
            continue
        qty = min(PER_STOCK, cash - RESERVE, BUDGET - RESERVE - committed) // int(price)
        if qty < 1 or qty * int(price) > PER_STOCK:
            continue
        intent = ledger.reserve(code, 'BUY', qty, int(price))
        result = client.buy_limit(code, qty, int(price))
        ledger.acknowledge(intent, result)
        with ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES(?,?,?,?,0) "
                       "ON CONFLICT(code) DO UPDATE SET qty=excluded.qty,state='PENDING',"
                       "buy_day=excluded.buy_day,floor_reached=0",
                       (code, qty, 'PENDING', now.strftime('%Y-%m-%d')))
        return 'BUY_SENT'
    return 'NO_CANDIDATE'
