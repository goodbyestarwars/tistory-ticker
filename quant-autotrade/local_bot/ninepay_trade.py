"""9Pay real-account entry adapter for the existing local ledger and exits.

Only the PC runner calls this. Requires its own environment switch and the
existing account-bound approval; it never creates a second budget or account.
"""

from datetime import datetime, timedelta, timezone
import os
import re
import math
import unicodedata
from ninepay_signal_client import valid_evidence

KST = timezone(timedelta(hours=9))
CODE = re.compile(r'^\d{6}$')
MAX_CHASE_PCT = 0.3
MAX_SIGNAL_AGE_SEC = 10


class ProductNotAllowed(ValueError):
    pass


def _current_price(client, code):
    response = client.call('ka10001', '/api/dostk/stkinfo', {'stk_cd': code})
    if str(response.get('return_code', '')) != '0':
        return None
    name = re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(response.get('stk_nm') or '')).casefold())
    if not name:
        raise ProductNotAllowed('PRODUCT_NAME_UNCONFIRMED')
    if any(word in name for word in (
            '인버스', '레버리지', 'inverse', 'leverag', '2x', '3x', '2배', '3배', '-1x',
            'cd금리', 'cd91', 'cd1년', 'kofr', 'sofr', '머니마켓', 'moneymarket',
            '단기채', '단기통안', '초단기', '파킹', 'mmf', '양도성예금', '금리액티브')):
        raise ProductNotAllowed('PRODUCT_EXCLUDED')
    try:
        price = abs(int(str(response.get('cur_prc', '')).replace(',', '')))
    except (TypeError, ValueError):
        return None
    return price or None


def trade_signal_once(client, ledger, signal, folder, now=None, policy=None, clock=None):
    """Send at most one limit buy; existing trade_once manages later exits.

    The caller must pass signals from ninepay_signal_client. Checks are repeated
    here because this is the last boundary before a real order request.
    """
    if policy is None:
        import live_engine as policy
    now = now or datetime.now(KST)
    minute = now.hour * 60 + now.minute
    if os.environ.get('NINEPAY_LIVE_TRADING') != '1':
        return '9PAY_DISABLED'
    if now.weekday() >= 5 or not 540 <= minute <= 920 or os.path.exists(os.path.join(folder, 'STOP')):
        return 'CLOSED_OR_STOPPED'
    code, sid = str(signal.get('code') or ''), str(signal.get('signalId') or '')
    if not CODE.fullmatch(code) or sid != now.strftime('%Y-%m-%d') + ':' + code:
        return 'BAD_SIGNAL'
    try:
        age = now.timestamp() - float(signal['at'])
        signal_price = float(signal['price'])
    except (KeyError, TypeError, ValueError):
        return 'BAD_SIGNAL'
    if not math.isfinite(age) or not math.isfinite(signal_price) or not 0 <= age <= MAX_SIGNAL_AGE_SEC or signal_price <= 0:
        return 'STALE_SIGNAL'
    if signal.get('source') not in ('Kiwoom WebSocket', 'KIS rank polling'):
        return 'BAD_SIGNAL'
    if not valid_evidence(signal, now.timestamp()):
        return 'BAD_RULE_EVIDENCE'
    accounts = client.account_ids()
    if not policy.approval_ok(folder, accounts, now) or ledger.has_uncertain():
        return 'DISABLED_OR_UNCERTAIN'
    excluded = policy.load_exclusions(folder)
    if excluded is None or code in excluded:
        return 'EXCLUDED_OR_UNCONFIRMED'
    holdings = client.balance()
    pending = client.unfilled()
    cash = client.cash_available()
    if len(accounts) != 1 or pending:
        return 'PENDING_ORDERS'
    held = {h['code']: h for h in holdings}
    with ledger.connect() as db:
        positions = {r['code']: dict(r) for r in db.execute('SELECT * FROM positions')}
        had_buy = db.execute("SELECT 1 FROM intents WHERE side='BUY' LIMIT 1").fetchone() is not None
        sent_today = {r['code'] for r in db.execute(
            "SELECT code FROM intents WHERE side='BUY' AND substr(ts,1,10)=?", (now.strftime('%Y-%m-%d'),))}
        sell_sent = {r['code'] for r in db.execute(
            "SELECT DISTINCT s.code FROM intents s WHERE s.side='SELL' AND s.id > "
            "COALESCE((SELECT MAX(b.id) FROM intents b WHERE b.side='BUY' AND b.code=s.code),0)")}
        committed = sum(r[0] * r[1] if r[1] else policy.PER_STOCK for r in db.execute(
            "SELECT p.qty, (SELECT b.price FROM intents b WHERE b.side='BUY' AND b.code=p.code "
            "ORDER BY b.id DESC LIMIT 1) FROM positions p WHERE p.state IN ('OPEN','PENDING')"))
    if not had_buy and cash < policy.BUDGET:
        return 'INSUFFICIENT_STARTING_CASH'
    if any(p['state'] == 'PENDING' and c not in held for c, p in positions.items()):
        return 'BUY_FILL_UNCONFIRMED'
    if any(c in held for c in sell_sent):
        return 'SELL_FILL_UNCONFIRMED'
    if any(c not in positions for c in held):
        return 'FOREIGN_HOLDINGS'
    if code in held or code in sent_today or (code in positions and positions[code]['state'] != 'CLOSED'):
        return 'ALREADY_HELD_OR_SENT'
    slots = len(set(held) | {c for c, p in positions.items() if p['state'] != 'CLOSED'})
    if ((policy.MAX_STOCKS is not None and slots >= policy.MAX_STOCKS)
            or cash <= policy.RESERVE or committed >= policy.BUDGET - policy.RESERVE):
        return 'BUDGET_OR_SLOTS_FULL'
    try:
        price = _current_price(client, code)
    except ProductNotAllowed as exc:
        return str(exc)
    if price is None:
        return 'PRICE_UNAVAILABLE'
    if price > signal_price * (1 + MAX_CHASE_PCT / 100):
        return 'PRICE_MOVED'
    qty = min(policy.PER_STOCK, cash - policy.RESERVE,
              policy.BUDGET - policy.RESERVE - committed) // price
    if qty < 1 or qty * price > policy.PER_STOCK:
        return 'QTY_OR_LIMIT'
    order_time = clock() if clock else datetime.now(KST)
    order_minute = order_time.hour * 60 + order_time.minute
    if (order_time.date() != now.date() or not 540 <= order_minute <= 920
            or not 0 <= order_time.timestamp() - float(signal['at']) <= MAX_SIGNAL_AGE_SEC):
        return 'STALE_BEFORE_ORDER'
    if (os.environ.get('NINEPAY_LIVE_TRADING') != '1'
            or os.path.exists(os.path.join(folder, 'STOP'))
            or not policy.approval_ok(folder, accounts, order_time)
            or ledger.has_uncertain()):
        return 'DISABLED_OR_UNCERTAIN'
    note = {'scanner': '9Pay intraday', 'signal_id': sid, 'source': signal['source'],
            'signal_at': signal['at'], 'signal_price': signal_price,
            'checked_price': price, 'slots_used': slots}
    intent = ledger.reserve(code, 'BUY', qty, price, reason='NINEPAY_ENTRY', note=note)
    result = client.buy_limit(code, qty, price)
    ledger.acknowledge(intent, result)
    with ledger.connect() as db:
        db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES(?,?,?,?,0) "
                   "ON CONFLICT(code) DO UPDATE SET qty=excluded.qty,state='PENDING',"
                   "buy_day=excluded.buy_day,floor_reached=0",
                   (code, qty, 'PENDING', now.strftime('%Y-%m-%d')))
    return '9PAY_BUY_SENT'
