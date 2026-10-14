# -*- coding: utf-8 -*-
"""동적 자금 배분(dynamic-v1) 실계좌 엔진 후보 - 2026-10-15 작성, **실계좌 미적용**(별도 승인 전까지 live_runner가 import하지 않는다).

live_engine.py(현재 운영 엔진)와 같은 공개 함수(Ledger·readiness·trade_once)를 가진 대체본이다. 매도(손절 -5%·익절 +6%·+3% 도달 후 이탈), 승인 확인,
제외 종목(engine_excluded.json), 미체결·불확실 주문 시 중단, 장부 예약 후 주문 같은 안전장치는 live_engine의 것을 그대로 가져다 쓰고
**매수 수량·금액을 정하는 부분만** allocation.py의 동적 배분으로 바꿨다(최대 3종목·종목당 30만원·현금 10만원 유지 제한 제거).

판단 근거는 live_allocation.json(원자적 쓰기)에 남겨 운영센터가 읽는다. 이 파일이 있다는 것은 이 엔진이 실제로 돌았다는 뜻이다.
"""
import json
import os
from datetime import datetime

import allocation as al
from live_engine import (CODE_RE, KST, Ledger, _number, approval_ok, exit_reason, fresh_price,  # noqa: F401  (Ledger는 runner가 가져다 쓴다)
                         load_exclusions, net_gain, readiness)

ALLOCATION_FILE = 'live_allocation.json'
MAX_CANDIDATES_PRICED = 8        # 현재가를 조회해 비교하는 후보 수 상한(API 호출 절약)


def _amount(value):
    """키움 금액 문자열('000000000295800', '-00000000171985')을 정수로. 못 읽으면 None."""
    try:
        return int(float(str(value).replace(',', '').strip()))
    except (TypeError, ValueError):
        return None


def read_cash(client):
    """(스냅샷 dict, 사용 가능 현금). 스냅샷 값 중 가장 작은 값을 쓴다(신용·미수·미결제 대금 제외 목적). 조회 실패 시 (None, None)."""
    try:
        if hasattr(client, 'cash_snapshot'):
            snap = client.cash_snapshot()
        elif hasattr(client, 'call'):
            res = client.call('kt00001', '/api/dostk/acnt', {'qry_tp': '2'})
            if str(res.get('return_code', '')) != '0':
                return None, None
            snap = {'ord_alow': _amount(res.get('ord_alow_amt')), 'ord_alow_100': _amount(res.get('100stk_ord_alow_amt')),
                    'entr': _amount(res.get('entr'))}
        else:
            snap = {'ord_alow': int(client.cash_available())}
    except Exception:
        return None, None
    snap = {k: v for k, v in (snap or {}).items() if v is not None}
    return snap, al.usable_cash(snap)


def pending_buy_amount(unfilled):
    """미체결 매수 금액(표시·예산 반영용, 필드명 미검증이라 못 읽는 행은 0으로 둔다 - 미체결이 있으면 어차피 신규 매수를 하지 않는다)."""
    total = 0
    for row in unfilled or []:
        if '매수' not in str(row.get('io_tp_nm', '')) and str(row.get('trde_tp', '')) != '2':
            continue
        qty, price = _amount(row.get('oso_qty')), _amount(row.get('ord_pric'))
        if qty and price:
            total += qty * price
    return total


def evaluate_candidates(rows, get_daily, today):
    """엔진의 기존 rank_candidates와 같은 하드 필터를 통과한 후보에 품질 점수를 붙여 품질 내림차순으로 돌려준다."""
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
        ranges = [(_number(b['high']) - _number(b['low'])) / _number(b['close']) for b in bars[-20:] if _number(b['close']) > 0]
        if len(ranges) < 20 or min(closes) <= 0 or min(values) <= 0:
            continue
        avg_value = sum(values) / 20
        volatility = sum(ranges) / 20
        trend = closes[-1] / (sum(closes) / 20) - 1
        if avg_value < 1_000_000_000 or not 0.01 <= volatility <= 0.08 or trend <= 0:
            continue
        quality, parts = al.quality_score(avg_value, values[-1], volatility, trend)
        item = {'code': code, 'base': _number(last['close']), 'scan_date': row['scan_date'], 'quality': quality, 'parts': parts,
                'volatility': volatility, 'avg_value': avg_value, 'trend': trend, 'last_value': values[-1]}
        if code not in best or (quality, avg_value) > (best[code]['quality'], best[code]['avg_value']):
            best[code] = item
    return sorted(best.values(), key=lambda c: (c['quality'], c['avg_value']), reverse=True)


def _write_allocation(folder, payload):
    """운영센터용 배분 근거. 실패해도 매매에는 영향이 없다."""
    try:
        path = os.path.join(folder, ALLOCATION_FILE)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


def trade_once(client, ledger, candidate_rows, get_daily, folder, now=None):
    """한 번의 거래 사이클. 매도·안전장치는 live_engine.trade_once와 같고 매수 금액 산정만 동적 배분이다."""
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
    if len(accounts) != 1 or pending:
        return 'PENDING_ORDERS'             # 미체결이 하나라도 있으면 신규·중복 주문을 내지 않는다(기존 엔진과 같은 동작)
    held = {h['code']: h for h in holdings}
    today = now.strftime('%Y-%m-%d')
    with ledger.connect() as db:
        positions = {r['code']: dict(r) for r in db.execute('SELECT * FROM positions')}
        buys_today = {}
        first_buy_price = {}
        for r in db.execute("SELECT code, price FROM intents WHERE side='BUY' AND substr(ts,1,10)=? ORDER BY id", (today,)):
            buys_today[r['code']] = buys_today.get(r['code'], 0) + 1
            first_buy_price.setdefault(r['code'], r['price'])
        sold_today = {r['code'] for r in db.execute("SELECT DISTINCT code FROM intents WHERE side='SELL' AND substr(ts,1,10)=?", (today,))}
        sell_sent = {r['code'] for r in db.execute(
            "SELECT DISTINCT s.code FROM intents s WHERE s.side='SELL' AND s.id > "
            "COALESCE((SELECT MAX(b.id) FROM intents b WHERE b.side='BUY' AND b.code=s.code),0)")}
        last_buy_price = {r[0]: r[1] for r in db.execute(
            "SELECT p.code, (SELECT b.price FROM intents b WHERE b.side='BUY' AND b.code=p.code ORDER BY b.id DESC LIMIT 1) "
            "FROM positions p WHERE p.state IN ('OPEN','PENDING')")}
    for code, pos in positions.items():
        h = held.get(code)
        if h is None and pos['state'] == 'OPEN':
            with ledger.connect() as db:
                db.execute("UPDATE positions SET state='CLOSED' WHERE code=?", (code,))
            pos['state'] = 'CLOSED'
        elif h is not None and pos['state'] == 'PENDING':
            with ledger.connect() as db:
                db.execute("UPDATE positions SET state='OPEN',qty=? WHERE code=?", (h['qty'], code))
            pos['qty'] = h['qty']
            pos['state'] = 'OPEN'
    # Acknowledged orders with no confirmed fill must be inspected, not retried.
    if any(p['state'] == 'PENDING' and c not in held for c, p in positions.items()):
        return 'BUY_FILL_UNCONFIRMED'
    # Never sell holdings that this engine did not buy. (손절·익절 보호: live_engine과 동일)
    for code, pos in positions.items():
        if code in excluded:
            continue                        # 제외 종목: 손절·익절·수익보호 어떤 매도도 하지 않는다(장부도 갱신하지 않음)
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

    # ---------------- 매수: 동적 자금 배분 ----------------
    if not (9 <= now.hour < 10):
        return 'NO_ENTRY'
    snapshot, cash_usable = read_cash(client)
    record = {'policy': al.POLICY_VERSION, 'checked_at': now.isoformat(), 'cash_snapshot': snapshot, 'cash_usable': cash_usable,
              'budget_total': al.TOTAL_BUDGET, 'considered': [], 'chosen': None, 'state': None}

    def finish(state):
        record['state'] = state
        _write_allocation(folder, record)
        return state

    if cash_usable is None:
        return finish('NO_ENTRY')
    committed = 0.0
    risk_used = 0.0
    cost_of = {}
    for code, pos in positions.items():
        if pos['state'] not in ('OPEN', 'PENDING'):
            continue
        unit = _number(held[code]['avg']) if code in held and _number(held[code]['avg']) > 0 else _number(last_buy_price.get(code))
        if unit <= 0:
            return finish('NO_ENTRY')       # 보유 원가를 알 수 없으면 한도를 계산할 수 없다 - 사지 않는다
        cost_of[code] = unit * pos['qty']
        committed += cost_of[code]
        risk_used += cost_of[code] * al.STOP_PCT / 100.0      # 제외 종목도 실제 노출이므로 같은 손절폭으로 위험에 합산
    budget_room = al.TOTAL_BUDGET - committed
    record.update({'committed': round(committed), 'budget_room': round(budget_room), 'portfolio_risk_used': round(risk_used)})
    if budget_room < al.MIN_ORDER_KRW or cash_usable < al.MIN_ORDER_KRW * (1 + al.FEE_BUFFER_PCT / 100.0):
        return finish('NO_ENTRY')

    live = []
    for cand in evaluate_candidates(candidate_rows, get_daily, today)[:MAX_CANDIDATES_PRICED]:
        code = cand['code']
        if code in excluded:
            continue                        # 제외 종목: 자동매수 금지
        pos = positions.get(code)
        is_add = bool(pos and pos['state'] == 'OPEN' and code in held and buys_today.get(code, 0) >= 1)
        if (pos and pos['state'] != 'CLOSED' or code in held) and not is_add:
            continue
        if buys_today.get(code, 0) >= al.MAX_BUYS_PER_CODE_PER_DAY or code in sold_today:
            continue                        # 하루 매수 횟수 상한, 오늘 이미 매도(손절·익절)한 종목은 당일 재진입하지 않는다
        price = fresh_price(client, code, now)
        if price is None or price >= cand['base'] * 1.02:
            continue
        live.append((cand, price, is_add))
    peers = [c for c, _, add in live if c['quality'] >= al.MIN_QUALITY][:al.MAX_CONSIDER]      # 신규 후보 + 추가 매수 후보가 몫을 나눈다
    peer_sum = sum(c['quality'] for c in peers)
    for cand, price, is_add in live:
        plan = al.plan_buy(
            cand, price, budget_room=budget_room, cash_usable=cash_usable, portfolio_risk_used=risk_used,
            held_notional=cost_of.get(cand['code'], 0.0) if is_add else 0.0, buys_today=buys_today.get(cand['code'], 0),
            peers_quality_sum=peer_sum or None, unique_top=len(peers) == 1,
            first_buy_price=first_buy_price.get(cand['code']))
        plan['parts'], plan['scan_date'] = cand['parts'], cand['scan_date']
        record['considered'].append(plan)
        if plan['qty'] < 1:
            continue
        intent = ledger.reserve(cand['code'], 'BUY', plan['qty'], int(price))
        result = client.buy_limit(cand['code'], plan['qty'], int(price))
        ledger.acknowledge(intent, result)
        total_qty = plan['qty'] + (held[cand['code']]['qty'] if is_add else 0)
        with ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES(?,?,?,?,0) "
                       "ON CONFLICT(code) DO UPDATE SET qty=excluded.qty,state='PENDING',"
                       "buy_day=excluded.buy_day,floor_reached=0",
                       (cand['code'], total_qty, 'PENDING', today))
        record['chosen'] = cand['code']
        return finish('BUY_SENT')
    return finish('NO_CANDIDATE')
