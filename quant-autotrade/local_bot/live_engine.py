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
MAX_STOCKS = None  # 2026-10-19 user removed the count cap; shared capital limits remain.
# Conservative round-trip cost allowance until actual account fees/taxes are verified.
COST_PCT = 0.7
CODE_RE = re.compile(r'^\d{6}$')
# 2026-10-15 사용자 승인: 제외 목록의 종목은 이 엔진이 자동매수·자동매도 주문을 절대 내지 않는다(장부 기록·실제 잔고는 건드리지 않음).
EXCLUSION_FILE = 'engine_excluded.json'


def load_exclusions(folder):
    """엔진 제외 종목 집합. 파일이 없거나 형식이 틀리면 None - 호출부는 확인될 때까지 아무 주문도 내지 않는다(fail closed)."""
    try:
        with open(os.path.join(folder, EXCLUSION_FILE), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    codes = data.get('codes') if isinstance(data, dict) else None
    if not isinstance(codes, list) or not all(isinstance(c, str) and CODE_RE.fullmatch(c) for c in codes):
        return None
    return set(codes)


def slots_full(count):
    return MAX_STOCKS is not None and count >= MAX_STOCKS


def net_gain(price, avg, cost_pct=COST_PCT):
    if not price or not avg or price <= 0 or avg <= 0:
        return None
    return (price / avg - 1) * 100 - cost_pct


# 2026-10-16 사용자 승인 청산 규칙(손절은 짧게, 익절은 길게). 모두 매입가·고점 대비 가격 변화율이며 비용(COST_PCT)은 넣지 않는다.
#  - 일반 손절: 매입가 대비 -STOP_PCT% 이하가 연속 CONFIRM_CHECKS회 사이클(약 30초 간격) 확인되면 매도(순간 흔들림 제외)
#  - 비상 손절: 매입가 대비 -EMERGENCY_STOP_PCT% 이하면 확인 없이 즉시 매도(급락 대응)
#  - 추적 청산: 고점이 매입가 +TRAIL_ARM_PCT% 이상이 된 뒤 고점 대비 -TRAIL_PCT% 이탈이 연속 CONFIRM_CHECKS회 확인되면 매도
#  - 고정 익절 상한(+6%)·수익보호 바닥(+3%)은 없앴다. 고점은 사이클마다 관측한 현재가(1분봉 종가)의 최댓값이다.
STOP_PCT = 3.0
EMERGENCY_STOP_PCT = 5.0
TRAIL_ARM_PCT = 3.0
TRAIL_PCT = 2.5
CONFIRM_CHECKS = 2


def exit_decision(price, avg, peak, hits):
    """한 사이클의 청산 판정. (reason 또는 None, 새 고점, 새 연속 확인 횟수)를 돌려준다. 입력이 이상하면 아무것도 바꾸지 않는다."""
    if not price or not avg or price <= 0 or avg <= 0:
        return None, peak, hits
    new_peak = max(peak or avg, price)
    gain = (price / avg - 1) * 100
    if gain <= -EMERGENCY_STOP_PCT:
        return 'STOP_EMERGENCY', new_peak, hits + 1
    breach = None
    if gain <= -STOP_PCT:
        breach = 'STOP_3'
    elif (new_peak / avg - 1) * 100 >= TRAIL_ARM_PCT and price <= new_peak * (1 - TRAIL_PCT / 100):
        breach = 'TRAIL_2_5'
    new_hits = hits + 1 if breach else 0
    if breach and new_hits >= CONFIRM_CHECKS:
        return breach, new_peak, new_hits
    return None, new_peak, new_hits


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def rank_candidates(rows, get_daily, today, rejected=None):
    """Use completed bars only; compare traded value, liquidity, volatility and trend.

    rejected: 리스트를 넘기면 탈락한 후보를 (code, 사유, 상세)로 채워 준다(순위 결과에는 영향 없음)."""
    best = {}

    def reject(code, reason, detail=''):
        if rejected is not None:
            rejected.append((code, reason, detail))

    for row in rows:
        code = str(row['code'])
        if not CODE_RE.fullmatch(code) or row['status'] != 'NEW' or row['scan_date'] >= today:
            continue
        bars = [b for b in get_daily(code) if b['date'] <= row['scan_date']]
        if len(bars) < 21 or bars[-1]['date'] != row['scan_date']:
            reject(code, 'BARS_UNAVAILABLE', 'bars=%d' % len(bars))
            continue
        last = bars[-1]
        closes = [_number(b['close']) for b in bars[-20:]]
        values = [_number(b['close']) * _number(b['volume']) for b in bars[-20:]]
        ranges = [(_number(b['high']) - _number(b['low'])) / _number(b['close'])
                  for b in bars[-20:] if _number(b['close']) > 0]
        if len(ranges) < 20 or min(closes) <= 0 or min(values) <= 0:
            reject(code, 'BAD_BARS')
            continue
        avg_value = sum(values) / 20
        volatility = sum(ranges) / 20
        trend = closes[-1] / (sum(closes) / 20) - 1
        if avg_value < 1_000_000_000:
            reject(code, 'LOW_TRADED_VALUE', 'avg_value_eok=%.1f' % (avg_value / 1e8))
            continue
        if not 0.01 <= volatility <= 0.08:
            reject(code, 'VOLATILITY_RANGE', 'volatility=%.4f' % volatility)
            continue
        if trend <= 0:
            reject(code, 'BELOW_20D_MEAN', 'trend=%.4f' % trend)
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
              CREATE TABLE IF NOT EXISTS skips(day TEXT NOT NULL, code TEXT NOT NULL, reason TEXT NOT NULL,
                detail TEXT, count INTEGER NOT NULL DEFAULT 1, first_ts TEXT NOT NULL, last_ts TEXT NOT NULL,
                PRIMARY KEY(day, code, reason));
            ''')
            # 2026-10-16: 기존 장부에 기록용 컬럼을 덧붙인다(기존 열·값은 그대로).
            self._add_columns(db, 'positions', (('peak_price', 'REAL'), ('exit_hits', 'INTEGER NOT NULL DEFAULT 0')))
            self._add_columns(db, 'intents', (('reason', 'TEXT'), ('note', 'TEXT')))

    @staticmethod
    def _add_columns(db, table, columns):
        have = {r[1] for r in db.execute('PRAGMA table_info(%s)' % table)}
        for name, decl in columns:
            if name not in have:
                db.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, name, decl))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def reserve(self, code, side, qty, price=None, reason=None, note=None):
        """주문 시도를 먼저 장부에 남긴다. reason/note는 기록용(매수 점수·진입 이유, 매도 사유·판정 근거)이며 매매 판단에는 쓰지 않는다."""
        with self.connect() as db:
            cur = db.execute('INSERT INTO intents(ts,code,side,qty,price,state,reason,note) VALUES(?,?,?,?,?,?,?,?)',
                             (datetime.now(KST).isoformat(), code, side, qty, price, 'UNKNOWN', reason,
                              json.dumps(note, ensure_ascii=False) if note is not None else None))
            return cur.lastrowid

    def skip(self, day, code, reason, detail='', once=False):
        """진입하지 않은 이유를 (날짜, 종목, 사유)별로 한 줄에 모아 남긴다. 기록 실패는 매매에 영향을 주지 않는다."""
        try:
            now = datetime.now(KST).isoformat()
            with self.connect() as db:
                if once:
                    db.execute('INSERT OR IGNORE INTO skips(day,code,reason,detail,count,first_ts,last_ts) VALUES(?,?,?,?,1,?,?)',
                               (day, code, reason, detail, now, now))
                else:
                    db.execute('INSERT INTO skips(day,code,reason,detail,count,first_ts,last_ts) VALUES(?,?,?,?,1,?,?) '
                               'ON CONFLICT(day,code,reason) DO UPDATE SET count=count+1,last_ts=excluded.last_ts,detail=excluded.detail',
                               (day, code, reason, detail, now, now))
        except Exception:
            pass

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
    return {'exclusions_loaded': load_exclusions(folder) is not None,
            'one_account': len(accounts) == 1, 'holdings_clear': len(holdings) == 0,
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


def trade_once(client, ledger, candidate_rows, get_daily, folder, now=None, *,
               manage_exits=True, allow_entries=True):
    """One bounded trading cycle. Caller provides verified prior-night candidates."""
    now = now or datetime.now(KST)
    minute = now.hour * 60 + now.minute
    if now.weekday() >= 5 or not (540 <= minute <= 920) or os.path.exists(os.path.join(folder, 'STOP')):
        return 'CLOSED_OR_STOPPED'
    accounts = client.account_ids()
    if not approval_ok(folder, accounts, now) or ledger.has_uncertain():
        return 'DISABLED_OR_UNCERTAIN'
    excluded = load_exclusions(folder)
    if excluded is None:
        return 'EXCLUSION_UNCONFIRMED'      # 제외 목록을 확인하지 못하면 어떤 주문도 내지 않는다
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
        if not manage_exits:
            break
        if code in excluded:
            continue                        # 제외 종목: 손절·익절·수익보호 어떤 매도도 하지 않는다(장부도 갱신하지 않음)
        h = held.get(code)
        if pos['state'] != 'OPEN' or code in sell_sent or not h or h['sellable'] <= 0:
            continue
        price = fresh_price(client, code, now)
        if price is None:
            return 'PRICE_UNAVAILABLE'
        old_peak, old_hits = pos.get('peak_price'), int(pos.get('exit_hits') or 0)
        reason, peak, hits = exit_decision(price, h['avg'], old_peak, old_hits)
        armed = 1 if peak and h['avg'] and (peak / h['avg'] - 1) * 100 >= TRAIL_ARM_PCT else int(pos['floor_reached'] or 0)
        if peak != old_peak or hits != old_hits or armed != int(pos['floor_reached'] or 0):
            with ledger.connect() as db:
                db.execute('UPDATE positions SET peak_price=?, exit_hits=?, floor_reached=? WHERE code=?', (peak, hits, armed, code))
        if reason:
            qty = min(pos['qty'], h['sellable'])
            note = {'gain_pct': round((price / h['avg'] - 1) * 100, 2), 'net_gain_pct': round(net_gain(price, h['avg']) or 0, 2),
                    'avg': h['avg'], 'peak': peak, 'peak_gain_pct': round((peak / h['avg'] - 1) * 100, 2), 'confirm_hits': hits}
            intent = ledger.reserve(code, 'SELL', qty, int(price), reason=reason, note=note)
            result = client.sell_market(code, qty)
            ledger.acknowledge(intent, result)
            return reason
    if any(code in held for code in sell_sent):
        return 'SELL_FILL_UNCONFIRMED'
    if any(code not in positions for code in held):
        return 'FOREIGN_HOLDINGS'
    if not allow_entries:
        return 'EXITS_CHECKED'
    slots_used = len(set(held) | {c for c, p in positions.items() if p['state'] != 'CLOSED'})
    today = now.strftime('%Y-%m-%d')
    if not (9 <= now.hour < 10):
        ledger.skip(today, '*', 'WINDOW_CLOSED', 'entry window 09:00-10:00', once=True)
        return 'NO_ENTRY'
    if cash <= RESERVE or slots_full(slots_used) or committed >= BUDGET - RESERVE:
        why = 'SLOTS_FULL' if slots_full(slots_used) else 'NO_CASH' if cash <= RESERVE else 'BUDGET_COMMITTED'
        ledger.skip(today, '*', why, 'slots=%d/%s cash=%d committed=%d' % (slots_used, MAX_STOCKS, cash, committed))
        return 'NO_ENTRY'
    # Existing holdings consume slots and capital even if manually acquired.
    rejected = []
    ranked = rank_candidates(candidate_rows, get_daily, today, rejected)
    for code_, reason_, detail_ in rejected:
        ledger.skip(today, code_, reason_, detail_)
    scanner_of = {(str(r.get('code')), str(r.get('scan_date'))): r.get('scanner') for r in candidate_rows}
    for rank, (score, code, base, scan_date) in enumerate(ranked, 1):
        if code in excluded:
            ledger.skip(today, code, 'EXCLUDED')
            continue                        # 제외 종목: 자동매수 금지
        pos = positions.get(code)
        if code in held or code in sent_today or (pos and pos['state'] != 'CLOSED') or slots_full(slots_used):
            ledger.skip(today, code, 'SLOTS_FULL' if slots_full(slots_used) else 'ALREADY_HELD_OR_SENT')
            continue
        price = fresh_price(client, code, now)
        if price is None:
            ledger.skip(today, code, 'PRICE_STALE')
            continue
        if price >= _number(base) * 1.02:
            ledger.skip(today, code, 'GAP_UP_OVER_2PCT', 'price=%s base=%s' % (price, base))
            continue
        qty = min(PER_STOCK, cash - RESERVE, BUDGET - RESERVE - committed) // int(price)
        if qty < 1 or qty * int(price) > PER_STOCK:
            ledger.skip(today, code, 'QTY_OR_PER_STOCK_LIMIT', 'price=%s qty=%s' % (price, qty))
            continue
        note = {'rank': rank, 'ranked_total': len(ranked), 'scanner': scanner_of.get((code, str(scan_date))), 'scan_date': scan_date,
                'base': base, 'entry_vs_base_pct': round((price / _number(base) - 1) * 100, 2) if _number(base) else None,
                'score': {'traded_value_eok': round(score[0] * 10, 2), 'avg_value_eok': round(score[1] * 10, 2),
                          'volatility_penalty': round(score[2], 4), 'trend_vs_20d': round(score[3], 4)},
                'slots_used': slots_used, 'candidates': len(candidate_rows)}
        intent = ledger.reserve(code, 'BUY', qty, int(price), reason='ENTRY', note=note)
        result = client.buy_limit(code, qty, int(price))
        ledger.acknowledge(intent, result)
        with ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES(?,?,?,?,0) "
                       "ON CONFLICT(code) DO UPDATE SET qty=excluded.qty,state='PENDING',"
                       "buy_day=excluded.buy_day,floor_reached=0",
                       (code, qty, 'PENDING', now.strftime('%Y-%m-%d')))
        return 'BUY_SENT'
    return 'NO_CANDIDATE'
