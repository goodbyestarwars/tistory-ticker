# -*- coding: utf-8 -*-
"""동적 자금 배분(dynamic-v1) 가짜 증권사 테스트 - 실제 주문·네트워크 호출이 없다. (2026-10-15)

실행: 이 폴더에서  python -m unittest -v test_dynamic_allocation
"""
import hashlib
import json
import os
import random
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import allocation as al
import live_engine as base
import live_engine_dynamic as dyn

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 10, 15, 9, 10, tzinfo=KST)
ACCOUNT = 'FAKE-ACCOUNT'
TODAY_SCAN = '2026-10-14'


def bars(price=20000.0, value=1e10, vol_range=0.035, growth=0.012, last_multiple=2.2, end=TODAY_SCAN):
    """20일 이상의 가짜 일봉. 거래대금·변동폭·추세를 매개변수로 조절한다."""
    out = []
    n = 25
    close0 = price / ((1 + growth) ** (n - 1))
    d = datetime.strptime(end, '%Y-%m-%d')
    dates = []
    while len(dates) < n:
        if d.weekday() < 5:
            dates.append(d.strftime('%Y-%m-%d'))
        d -= timedelta(days=1)
    dates.reverse()
    for i, date in enumerate(dates):
        c = close0 * ((1 + growth) ** i)
        vol = value / c * (last_multiple if i == n - 1 else 1.0)
        out.append({'date': date, 'open': c, 'high': c * (1 + vol_range / 2), 'low': c * (1 - vol_range / 2), 'close': c, 'volume': vol})
    return out


def high_quality_bars(price=20000.0):
    return bars(price=price, value=1e10, vol_range=0.035, growth=0.012)


def mid_quality_bars(price=10000.0):
    return bars(price=price, value=4e9, vol_range=0.03, growth=0.0075, last_multiple=1.0)


class FakeBroker:
    """주문 함수는 호출 기록만 한다. 체결은 fill()로 흉내 낸다(키움에는 아무 요청도 가지 않는다)."""

    def __init__(self, prices, cash=None, holdings=None):
        self.prices = dict(prices)
        self.cash = cash if cash is not None else {'ord_alow': 2_000_000, 'ord_alow_100': 2_000_000, 'entr': 2_000_000}
        self.holdings = list(holdings or [])
        self.unfilled_rows = []
        self.buys, self.sells = [], []

    def account_ids(self): return [ACCOUNT]
    def balance(self): return [dict(h) for h in self.holdings]
    def unfilled(self): return list(self.unfilled_rows)
    def cash_snapshot(self): return dict(self.cash)

    def last_price(self, code):
        p = self.prices.get(code)
        return (p, NOW.strftime('%Y-%m-%d %H:%M')) if p else (None, None)

    def buy_limit(self, code, qty, price):
        self.buys.append((code, qty, price))
        return {'ok': True, 'ord_no': 'B%d' % len(self.buys), 'return_code': 0}

    def sell_market(self, code, qty):
        self.sells.append((code, qty))
        return {'ok': True, 'ord_no': 'S%d' % len(self.sells), 'return_code': 0}

    def fill_last_buy(self):
        code, qty, price = self.buys[-1]
        for h in self.holdings:
            if h['code'] == code:
                total = h['qty'] + qty
                h['avg'] = (h['avg'] * h['qty'] + price * qty) / total
                h['qty'] = h['sellable'] = total
                break
        else:
            self.holdings.append({'code': code, 'name': code, 'qty': qty, 'sellable': qty, 'avg': float(price), 'price': float(price)})
        # 가격을 그대로 두는 단순 체결


def holding(code, qty, avg, price=None):
    return {'code': code, 'name': code, 'qty': qty, 'sellable': qty, 'avg': float(avg), 'price': float(price or avg)}


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.environ['LIVE_TRADING'] = '1'
        os.environ.pop('KIWOOM_BASE_URL', None)
        with open(os.path.join(self.dir, 'LIVE_TRADING_APPROVAL'), 'w', encoding='utf-8') as f:
            json.dump({'date': '2026-10-14', 'account_sha256': hashlib.sha256(ACCOUNT.encode()).hexdigest()}, f)
        with open(os.path.join(self.dir, 'engine_excluded.json'), 'w', encoding='utf-8') as f:
            json.dump({'codes': ['032640']}, f)
        self.ledger = base.Ledger(os.path.join(self.dir, 'live_orders.db'))
        # 실제 장부와 같은 상태: LG유플러스 13주 OPEN(엔진 제외)
        with self.ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES('032640',13,'OPEN','2026-10-14',0)")
            db.execute("INSERT INTO intents(ts,code,side,qty,price,state,order_no) VALUES('2026-10-14T09:48:48+09:00','032640','BUY',13,14750,'ACK','B0')")
        self.lgu = holding('032640', 13, 14750, 14700)
        self.now = NOW

    def tearDown(self):
        os.environ.pop('LIVE_TRADING', None)
        shutil.rmtree(self.dir, ignore_errors=True)

    def cand(self, code, data):
        return [{'scan_date': TODAY_SCAN, 'scanner': 'x', 'code': code, 'base_price': data[-1]['close'], 'status': 'NEW'}], data

    def run_cycle(self, broker, rows, data_by_code, engine=dyn, now=None):
        return engine.trade_once(broker, self.ledger, rows, lambda c: data_by_code.get(c, []), self.dir, now or self.now)

    def allocation(self):
        with open(os.path.join(self.dir, dyn.ALLOCATION_FILE), encoding='utf-8') as f:
            return json.load(f)

    def committed_after(self, broker):
        return sum(h['avg'] * h['qty'] for h in broker.holdings)


class SizingTests(Base):
    def test_single_excellent_candidate_is_concentrated_within_every_cap(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close']}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'BUY_SENT')
        code, qty, price = broker.buys[0]
        notional = qty * price
        a = self.allocation()
        plan = a['considered'][0]
        self.assertGreaterEqual(plan['quality'], al.HIGH_QUALITY)
        self.assertEqual(plan['tranche'], 'full')
        self.assertGreater(notional, 500_000)                                    # 예전 30만원 제한보다 크게 집중
        self.assertLessEqual(notional, a['budget_room'])                          # LG유플러스 원가를 뺀 예산 안
        self.assertLessEqual(plan['cost_with_fee'], a['cash_usable'])
        self.assertLessEqual(notional + 13 * 14750, al.TOTAL_BUDGET)              # 총 운용금 100만원 초과 금지
        self.assertEqual(plan['binding'], 'portfolio_risk')                       # 이 경우 전체 위험 상한이 구속
        self.assertEqual(a['chosen'], '111111')

    def test_two_good_candidates_are_diversified_by_quality_share(self):
        d1, d2 = high_quality_bars(20000.0), high_quality_bars(30000.0)
        rows = self.cand('111111', d1)[0] + self.cand('222222', d2)[0]
        data = {'111111': d1, '222222': d2}
        broker = FakeBroker({'111111': d1[-1]['close'], '222222': d2[-1]['close']}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, rows, data), 'BUY_SENT')
        first_notional = broker.buys[0][1] * broker.buys[0][2]
        plans = self.allocation()['considered']
        self.assertAlmostEqual(plans[0]['share'], 0.5, places=2)                  # 두 후보의 품질이 같아 몫이 절반
        single = FakeBroker({'111111': d1[-1]['close']}, holdings=[self.lgu])
        single_notional = self._single_notional(d1)
        self.assertLess(first_notional, single_notional)                           # 단독일 때보다 작게 배분
        broker.fill_last_buy()
        self.run_cycle(broker, rows, data)                                         # 다음 사이클: 두 번째 종목
        self.assertEqual(sorted({b[0] for b in broker.buys}), ['111111', '222222'])
        self.assertLessEqual(self.committed_after(broker) + sum(b[1] * b[2] for b in broker.buys[1:]), al.TOTAL_BUDGET)

    def _single_notional(self, data):
        other = tempfile.mkdtemp()
        try:
            led = base.Ledger(os.path.join(other, 'live_orders.db'))
            with led.connect() as db:
                db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES('032640',13,'OPEN','2026-10-14',0)")
                db.execute("INSERT INTO intents(ts,code,side,qty,price,state,order_no) VALUES('2026-10-14T09:48:48+09:00','032640','BUY',13,14750,'ACK','B0')")
            for name in ('LIVE_TRADING_APPROVAL', 'engine_excluded.json'):
                shutil.copy(os.path.join(self.dir, name), other)
            broker = FakeBroker({'111111': data[-1]['close']}, holdings=[self.lgu])
            rows, _ = self.cand('111111', data)
            dyn.trade_once(broker, led, rows, lambda c: data, other, NOW)
            return broker.buys[0][1] * broker.buys[0][2]
        finally:
            shutil.rmtree(other, ignore_errors=True)

    def test_mid_quality_enters_in_two_tranches_and_never_beyond_target(self):
        data = mid_quality_bars()
        rows, _ = self.cand('333333', data)
        price = data[-1]['close']
        broker = FakeBroker({'333333': price}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, rows, {'333333': data}), 'BUY_SENT')
        plan1 = self.allocation()['considered'][0]
        self.assertTrue(al.MIN_QUALITY <= plan1['quality'] < al.HIGH_QUALITY, plan1['quality'])
        self.assertEqual(plan1['tranche'], 'first')
        first = broker.buys[0][1] * broker.buys[0][2]
        self.assertAlmostEqual(first / plan1['target'], al.FIRST_TRANCHE, delta=0.1)   # 목표의 절반만 먼저
        broker.fill_last_buy()
        self.assertEqual(self.run_cycle(broker, rows, {'333333': data}), 'BUY_SENT')   # 정상 체결 뒤 같은 종목 추가 매수
        plan2 = self.allocation()['considered'][0]
        self.assertEqual(plan2['tranche'], 'add')
        total = first + broker.buys[1][1] * broker.buys[1][2]
        self.assertLessEqual(total, plan2['target'] + price)                             # 목표 초과 금지
        broker.fill_last_buy()
        self.assertEqual(self.run_cycle(broker, rows, {'333333': data}), 'NO_CANDIDATE')   # 같은 종목 하루 최대 2회
        self.assertEqual(len(broker.buys), 2)

    def test_add_on_blocked_when_price_chased_or_falling(self):
        data = mid_quality_bars()
        rows, _ = self.cand('333333', data)
        price = data[-1]['close']
        for moved in (price * 1.02, price * 0.97):                                       # +2% 추격, -3% 하락 중
            self.setUp()
            broker = FakeBroker({'333333': price}, holdings=[self.lgu])
            self.run_cycle(broker, rows, {'333333': data})
            broker.fill_last_buy()
            broker.prices['333333'] = moved
            if moved > data[-1]['close'] * 1.019:
                self.assertEqual(self.run_cycle(broker, rows, {'333333': data}), 'NO_CANDIDATE')   # 기준가 +2% 이상은 후보 자체 제외
            else:
                self.assertEqual(self.run_cycle(broker, rows, {'333333': data}), 'NO_CANDIDATE')
            self.assertEqual(len(broker.buys), 1)
            self.tearDown()

    def test_low_quality_candidate_is_not_bought(self):
        data = bars(value=1.2e9, vol_range=0.012, growth=0.0006, last_multiple=1.0)      # 유동성·변동성·추세 모두 약함(하드 필터는 통과)
        rows, _ = self.cand('444444', data)
        broker = FakeBroker({'444444': data[-1]['close']}, holdings=[self.lgu])
        result = self.run_cycle(broker, rows, {'444444': data})
        self.assertEqual((result, broker.buys), ('NO_CANDIDATE', []))
        self.assertEqual(self.allocation()['considered'][0]['reject'], 'LOW_QUALITY')

    def test_no_candidates_means_no_buy(self):
        broker = FakeBroker({}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, [], {}), 'NO_CANDIDATE')
        self.assertEqual(broker.buys, [])


class CashTests(Base):
    def test_never_exceeds_real_cash_including_fee_and_uses_the_smallest_measure(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        # 2026-10-15 실제 조회값: 주문가능 295,800 / 100% 증거금 주문가능 828,015 / 예수금 1,000,000
        broker = FakeBroker({'111111': data[-1]['close']}, cash={'ord_alow': 295_800, 'ord_alow_100': 828_015, 'entr': 1_000_000}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'BUY_SENT')
        qty, price = broker.buys[0][1], broker.buys[0][2]
        self.assertLessEqual(qty * price * (1 + al.FEE_BUFFER_PCT / 100), 295_800)
        self.assertEqual(self.allocation()['cash_usable'], 295_800)

    def test_credit_style_large_order_limit_is_ignored_when_cash_only_limit_is_small(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close']}, cash={'ord_alow': 3_000_000, 'ord_alow_100': 120_000, 'entr': 3_000_000}, holdings=[self.lgu])
        self.run_cycle(broker, rows, {'111111': data})
        self.assertLessEqual(broker.buys[0][1] * broker.buys[0][2] * 1.0015, 120_000)

    def test_cash_exactly_equal_to_notional_leaves_room_for_the_fee(self):
        plan = al.plan_buy({'code': '1', 'quality': 90.0, 'volatility': 0.035, 'avg_value': 1e10}, 10_000,
                           budget_room=1_000_000, cash_usable=500_000, portfolio_risk_used=0.0, unique_top=True)
        self.assertEqual(plan['binding'], 'cash')
        self.assertLessEqual(plan['cost_with_fee'], 500_000)
        self.assertEqual(plan['qty'], 49)                                                # 50주면 수수료 포함 500,750원이라 49주

    def test_too_little_cash_or_unknown_cash_places_no_order(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        for cash in ({'ord_alow': 30_000, 'ord_alow_100': 30_000, 'entr': 30_000}, {}):
            self.setUp()
            broker = FakeBroker({'111111': data[-1]['close']}, cash=cash, holdings=[self.lgu])
            self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'NO_ENTRY')
            self.assertEqual(broker.buys, [])
            self.tearDown()

    def test_budget_is_total_100만_minus_engine_holdings_not_cash_only(self):
        # 총 운용금 100만원 중 90만원어치가 이미 엔진 보유 -> 현금이 많아도 남은 예산(약 8만원 이하)만 사용
        with self.ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES('555555',50,'OPEN','2026-10-14',0)")
            db.execute("INSERT INTO intents(ts,code,side,qty,price,state,order_no) VALUES('2026-10-14T09:20:00+09:00','555555','BUY',50,15000,'ACK','B9')")
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close'], '555555': 15000}, holdings=[self.lgu, holding('555555', 50, 15000)])
        result = self.run_cycle(broker, rows, {'111111': data})
        committed = 13 * 14750 + 50 * 15000
        if broker.buys:
            self.assertLessEqual(committed + broker.buys[0][1] * broker.buys[0][2], al.TOTAL_BUDGET)
        else:
            self.assertIn(result, ('NO_ENTRY', 'NO_CANDIDATE'))                          # 남은 예산이 최소 주문 금액 근처라 사지 않는다

    def test_property_random_inputs_never_break_cash_budget_or_position_caps(self):
        rng = random.Random(7)
        for _ in range(2000):
            cash = rng.choice([None, 0, 40_000, 295_800, 828_015, 1_000_000, 5_000_000])
            room = rng.uniform(-50_000, 1_000_000)
            held = rng.choice([0.0, 0.0, rng.uniform(50_000, 600_000)])
            cand = {'code': '1', 'quality': rng.uniform(30, 100), 'volatility': rng.uniform(0.01, 0.08), 'avg_value': rng.uniform(1e9, 5e10)}
            price = rng.choice([500, 3_000, 15_000, 80_000, 400_000])
            plan = al.plan_buy(cand, price, budget_room=room, cash_usable=cash, portfolio_risk_used=rng.uniform(0, 80_000), held_notional=held,
                               buys_today=1 if held else 0, peers_quality_sum=rng.choice([None, cand['quality'] * rng.uniform(1, 4)]),
                               unique_top=rng.random() < 0.4, first_buy_price=price * rng.uniform(0.97, 1.02))
            if plan['qty'] > 0:
                self.assertIsNotNone(cash)
                self.assertLessEqual(plan['cost_with_fee'], cash)
                self.assertLessEqual(plan['notional'], max(0.0, room))
                self.assertLessEqual(plan['notional'] + held, al.TOTAL_BUDGET * al.MAX_POSITION_PCT_TOP / 100 + price)
                self.assertGreaterEqual(plan['notional'], al.MIN_ORDER_KRW)
                if not (plan['quality'] >= al.HIGH_QUALITY):
                    self.assertLessEqual(plan['notional'] + held, al.TOTAL_BUDGET * al.MAX_POSITION_PCT / 100 + price)


class OrderSafetyTests(Base):
    def test_unfilled_order_blocks_every_new_order_and_no_duplicate_is_sent(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close']}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'BUY_SENT')
        broker.unfilled_rows = [{'stk_cd': '111111', 'oso_qty': '30', 'ord_pric': '20000', 'io_tp_nm': '+매수'}]
        for _ in range(3):
            self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'PENDING_ORDERS')
        self.assertEqual(len(broker.buys), 1)                                            # 같은 종목 중복 미체결 주문 없음
        self.assertEqual(dyn.pending_buy_amount(broker.unfilled_rows), 600_000)

    def test_unconfirmed_fill_is_not_retried(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close']}, holdings=[self.lgu])
        self.run_cycle(broker, rows, {'111111': data})                                    # 주문 접수, 체결 확인 못 함(잔고에 없음)
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'BUY_FILL_UNCONFIRMED')
        self.assertEqual(len(broker.buys), 1)

    def test_restart_keeps_daily_buy_count_and_does_not_duplicate(self):
        data = mid_quality_bars()
        rows, _ = self.cand('333333', data)
        broker = FakeBroker({'333333': data[-1]['close']}, holdings=[self.lgu])
        self.run_cycle(broker, rows, {'333333': data})
        broker.fill_last_buy()
        self.run_cycle(broker, rows, {'333333': data})
        broker.fill_last_buy()
        self.ledger = base.Ledger(os.path.join(self.dir, 'live_orders.db'))              # 엔진 재시작(새 프로세스)
        self.assertEqual(self.run_cycle(broker, rows, {'333333': data}), 'NO_CANDIDATE')
        self.assertEqual(len(broker.buys), 2)

    def test_same_day_reentry_after_stop_out_is_blocked_but_next_day_is_allowed(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        price = data[-1]['close']
        broker = FakeBroker({'111111': price}, holdings=[self.lgu])
        self.run_cycle(broker, rows, {'111111': data})
        broker.fill_last_buy()
        broker.prices['111111'] = price * 0.93                                           # -7% 손절 구간
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'STOP_NET_5')
        self.assertEqual(broker.sells[0][0], '111111')
        broker.holdings = [h for h in broker.holdings if h['code'] != '111111']           # 매도 체결
        broker.prices['111111'] = price
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'NO_CANDIDATE')  # 당일 재진입 금지
        self.assertEqual(len(broker.buys), 1)
        tomorrow = datetime(2026, 10, 16, 9, 10, tzinfo=KST)
        data2 = bars(end='2026-10-15')
        rows2 = [{'scan_date': '2026-10-15', 'scanner': 'x', 'code': '111111', 'base_price': data2[-1]['close'], 'status': 'NEW'}]
        broker.prices['111111'] = data2[-1]['close']
        broker.now_hint = tomorrow
        NOW_BACKUP = globals()['NOW']
        try:
            def last_price(code, _p=broker.prices):
                return (_p.get(code), tomorrow.strftime('%Y-%m-%d %H:%M'))
            broker.last_price = last_price
            self.assertEqual(dyn.trade_once(broker, self.ledger, rows2, lambda c: data2, self.dir, tomorrow), 'BUY_SENT')
        finally:
            globals()['NOW'] = NOW_BACKUP

    def test_stop_loss_and_profit_protection_still_work_for_dynamic_positions(self):
        for price_move, expected in ((0.93, 'STOP_NET_5'), (1.08, 'PROFIT_NET_6')):
            self.setUp()
            data = high_quality_bars()
            rows, _ = self.cand('111111', data)
            price = data[-1]['close']
            broker = FakeBroker({'111111': price}, holdings=[self.lgu])
            self.run_cycle(broker, rows, {'111111': data})
            broker.fill_last_buy()
            broker.prices['111111'] = price * price_move
            self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), expected)
            self.assertEqual(len(broker.sells), 1)
            self.tearDown()

    def test_excluded_code_is_never_bought_or_sold_by_the_new_engine(self):
        data = high_quality_bars(14700.0)
        rows, _ = self.cand('032640', data)                                               # LG유플러스가 최상위 후보로 올라와도
        for price in (11800, 16400, 14700):                                               # 갭하락·갭상승·보합
            broker = FakeBroker({'032640': price}, holdings=[holding('032640', 13, 14750, price)])
            self.run_cycle(broker, rows, {'032640': data})
            self.assertEqual((broker.buys, broker.sells), ([], []))
        with self.ledger.connect() as db:
            row = tuple(db.execute("SELECT code,qty,state,floor_reached FROM positions WHERE code='032640'").fetchone())
        self.assertEqual(row, ('032640', 13, 'OPEN', 0))                                  # 장부 그대로

    def test_exclusion_file_missing_fails_closed(self):
        os.remove(os.path.join(self.dir, 'engine_excluded.json'))
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close']}, holdings=[self.lgu])
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'EXCLUSION_UNCONFIRMED')
        self.assertEqual((broker.buys, broker.sells), ([], []))

    def test_foreign_holding_still_stops_buying(self):
        data = high_quality_bars()
        rows, _ = self.cand('111111', data)
        broker = FakeBroker({'111111': data[-1]['close']}, holdings=[self.lgu, holding('999999', 5, 10000)])
        self.assertEqual(self.run_cycle(broker, rows, {'111111': data}), 'FOREIGN_HOLDINGS')
        self.assertEqual(broker.buys, [])


class ParityTests(Base):
    """매도 쪽은 기존 엔진과 같은 결과를 내야 한다."""

    def test_sell_decisions_match_the_current_engine(self):
        scenarios = []
        for code_price in (11800, 14000, 14700, 15700, 16400):
            for other_price in (88000, 94000, 100000, 103500, 107000):
                scenarios.append((code_price, other_price))
        for lgu_price, other_price in scenarios:
            results = []
            for engine in (base, dyn):
                self.setUp()
                with self.ledger.connect() as db:
                    db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES('000660',5,'OPEN','2026-10-14',0)")
                broker = FakeBroker({'032640': lgu_price, '000660': other_price},
                                    holdings=[holding('032640', 13, 14750, lgu_price), holding('000660', 5, 100000, other_price)])
                broker.cash_available = lambda: 2_000_000
                state = engine.trade_once(broker, self.ledger, [], lambda c: [], self.dir, NOW) if engine is dyn \
                    else base.trade_once(_BaseAdapter(broker), self.ledger, [], lambda c: [], self.dir, NOW)
                results.append((state if state in ('STOP_NET_5', 'PROFIT_NET_6', 'PROFIT_FLOOR_NET_3') else 'NO_SELL', list(broker.sells)))
                self.tearDown()
            self.assertEqual(results[0], results[1], (lgu_price, other_price))

    def test_candidate_filters_match_the_current_ranker(self):
        pool = {'111111': high_quality_bars(), '222222': mid_quality_bars(), '333333': bars(value=5e8),      # 거래대금 미달
                '444444': bars(vol_range=0.2), '555555': bars(growth=-0.01), '666666': bars(end='2026-10-10')}
        rows = [{'scan_date': TODAY_SCAN, 'scanner': 'x', 'code': c, 'base_price': 1, 'status': 'NEW'} for c in pool]
        old = {item[1] for item in base.rank_candidates(rows, lambda c: pool[c], '2026-10-15')}
        new = {c['code'] for c in dyn.evaluate_candidates(rows, lambda c: pool[c], '2026-10-15')}
        self.assertEqual(old, new)
        self.assertEqual(old, {'111111', '222222'})


class _BaseAdapter:
    """현재 엔진은 cash_available()을 쓴다."""

    def __init__(self, broker):
        self.b = broker

    def __getattr__(self, name):
        return getattr(self.b, name)

    def cash_available(self):
        return 2_000_000


class PolicyUnitTests(unittest.TestCase):
    def test_usable_cash_is_the_smallest_known_measure(self):
        self.assertEqual(al.usable_cash({'ord_alow': 295_800, 'ord_alow_100': 828_015, 'entr': 1_000_000}), 295_800)
        self.assertIsNone(al.usable_cash({}))
        self.assertIsNone(al.usable_cash(None))

    def test_quality_score_bounds_and_ordering(self):
        top, _ = al.quality_score(1e10, 2.2e10, 0.035, 0.12)
        weak, _ = al.quality_score(1.2e9, 1.2e9, 0.012, 0.001)
        self.assertEqual(top, 100.0)
        self.assertLess(weak, al.MIN_QUALITY)

    def test_higher_volatility_means_smaller_size(self):
        calm = al.plan_buy({'code': '1', 'quality': 90.0, 'volatility': 0.03, 'avg_value': 2e10}, 10_000, budget_room=1_000_000,
                           cash_usable=2_000_000, portfolio_risk_used=0.0, unique_top=True)
        wild = al.plan_buy({'code': '1', 'quality': 90.0, 'volatility': 0.075, 'avg_value': 2e10}, 10_000, budget_room=1_000_000,
                           cash_usable=2_000_000, portfolio_risk_used=0.0, unique_top=True)
        self.assertGreater(calm['notional'], wild['notional'])

    def test_concentration_above_60_percent_needs_top_quality_and_a_single_candidate(self):
        args = dict(budget_room=1_000_000, cash_usable=2_000_000, portfolio_risk_used=0.0)
        cand = {'code': '1', 'quality': 95.0, 'volatility': 0.035, 'avg_value': 5e10}
        single = al.plan_buy(cand, 10_000, unique_top=True, **args)
        shared = al.plan_buy(cand, 10_000, unique_top=False, peers_quality_sum=190.0, **args)
        self.assertGreater(single['notional'], 600_000)
        self.assertLessEqual(shared['notional'], 600_000)

    def test_liquidity_cap_limits_thinly_traded_names(self):
        plan = al.plan_buy({'code': '1', 'quality': 95.0, 'volatility': 0.035, 'avg_value': 2e9}, 10_000, budget_room=1_000_000,
                           cash_usable=2_000_000, portfolio_risk_used=0.0, unique_top=True)
        self.assertLessEqual(plan['notional'], 0.005 * 2e9 + 10_000)                       # 20일 평균 거래대금의 0.5%


if __name__ == '__main__':
    unittest.main()
