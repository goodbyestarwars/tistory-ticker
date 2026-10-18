# -*- coding: utf-8 -*-
"""엔진 제외 종목(032640) 회귀 테스트 - 가짜 증권사 응답만 쓰며 실제 주문·네트워크 호출이 없다. (2026-10-15)

실행: python -m unittest -v test_live_exclusion   (이 폴더에서)
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_engine as le

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))
NOW = datetime(2026, 10, 15, 9, 10, tzinfo=KST)     # 목요일 장 시작 직후
ACCOUNT = 'FAKE-ACCOUNT'


class FakeBroker:
    """주문 함수는 호출을 기록만 한다. 키움에는 아무 요청도 가지 않는다."""

    def __init__(self, holdings, prices, cash=2_000_000):
        self.holdings, self.prices, self.cash = holdings, prices, cash
        self.sells, self.buys = [], []

    def account_ids(self):
        return [ACCOUNT]

    def balance(self):
        return [dict(h) for h in self.holdings]

    def unfilled(self):
        return []

    def cash_available(self):
        return self.cash

    def last_price(self, code):
        price = self.prices.get(code)
        return (price, NOW.strftime('%Y-%m-%d %H:%M')) if price else (None, None)

    def sell_market(self, code, qty):
        self.sells.append((code, qty))
        return {'ok': True, 'ord_no': 'T1', 'return_code': 0}

    def buy_limit(self, code, qty, price):
        self.buys.append((code, qty, price))
        return {'ok': True, 'ord_no': 'T2', 'return_code': 0}


def holding(code, qty, avg, price):
    return {'code': code, 'name': code, 'qty': qty, 'sellable': qty, 'avg': float(avg), 'price': float(price)}


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.environ['LIVE_TRADING'] = '1'
        os.environ.pop('KIWOOM_BASE_URL', None)
        with open(os.path.join(self.dir, 'LIVE_TRADING_APPROVAL'), 'w', encoding='utf-8') as f:
            json.dump({'date': '2026-10-14', 'account_sha256': hashlib.sha256(ACCOUNT.encode()).hexdigest()}, f)
        self.write_exclusions(['032640'])
        self.ledger = le.Ledger(os.path.join(self.dir, 'live_orders.db'))
        with self.ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day,floor_reached) VALUES('032640',13,'OPEN','2026-10-14',0)")
            db.execute("INSERT INTO intents(ts,code,side,qty,price,state,order_no) VALUES('2026-10-14T09:48:48+09:00','032640','BUY',13,14750,'ACK','B1')")

    def tearDown(self):
        os.environ.pop('LIVE_TRADING', None)
        shutil.rmtree(self.dir, ignore_errors=True)

    def write_exclusions(self, codes, raw=None):
        with open(os.path.join(self.dir, 'engine_excluded.json'), 'w', encoding='utf-8') as f:
            f.write(raw if raw is not None else json.dumps({'codes': codes}))

    def snapshot(self):
        with self.ledger.connect() as db:
            return ([tuple(r) for r in db.execute('SELECT code,qty,state,floor_reached,buy_day FROM positions ORDER BY code')],
                    [tuple(r) for r in db.execute('SELECT ts,code,side,qty,price,state,order_no FROM intents ORDER BY id')])

    def cycle(self, broker, candidates=(), get_daily=lambda c: []):
        return le.trade_once(broker, self.ledger, list(candidates), get_daily, self.dir, NOW)


class ExcludedHoldingTests(Base):
    def test_gap_down_beyond_stop_places_no_order_and_keeps_ledger(self):
        before = self.snapshot()
        b = FakeBroker([holding('032640', 13, 14750, 11800)], {'032640': 11800})     # 갭하락 -20%
        for _ in range(3):
            self.cycle(b)
        self.assertEqual((b.sells, b.buys), ([], []))
        self.assertEqual(self.snapshot(), before)             # OPEN 기록·매수 이력 그대로(허위 CLOSED·삭제 없음)

    def test_gap_up_past_profit_and_floor_places_no_order_and_does_not_touch_floor_flag(self):
        before = self.snapshot()
        b = FakeBroker([holding('032640', 13, 14750, 16400)], {'032640': 16400})     # +11% (익절·수익보호 구간 모두 지남)
        self.cycle(b)
        b.prices['032640'] = 15200                                                     # +3% 아래로 되돌림
        b.holdings = [holding('032640', 13, 14750, 15200)]
        self.cycle(b)
        self.assertEqual((b.sells, b.buys), ([], []))
        self.assertEqual(self.snapshot(), before)

    def test_engine_restart_new_ledger_object_still_no_order(self):
        b = FakeBroker([holding('032640', 13, 14750, 11800)], {'032640': 11800})
        self.cycle(b)
        self.ledger = le.Ledger(os.path.join(self.dir, 'live_orders.db'))              # 재시작: 새 프로세스처럼 장부를 다시 연다
        self.cycle(b)
        self.assertEqual((b.sells, b.buys), ([], []))

    def test_control_without_exclusion_the_same_gap_down_would_sell(self):
        self.write_exclusions([])                                                      # 제외 해제 - 테스트가 실제로 민감한지 확인
        b = FakeBroker([holding('032640', 13, 14750, 11800)], {'032640': 11800})
        self.assertEqual(self.cycle(b), 'STOP_EMERGENCY')                              # 2026-10-16: 비상 손절(-5% 이하) 즉시
        self.assertEqual(b.sells, [('032640', 13)])

    def test_other_positions_keep_stop_loss_protection(self):
        with self.ledger.connect() as db:
            db.execute("INSERT OR IGNORE INTO positions(code,qty,state,buy_day,floor_reached) VALUES('000660',5,'OPEN','2026-10-14',0)")
        b = FakeBroker([holding('032640', 13, 14750, 11800), holding('000660', 5, 100000, 90000)], {'032640': 11800, '000660': 90000})
        result = self.cycle(b)
        self.assertEqual(result, 'STOP_EMERGENCY')
        self.assertEqual(b.sells, [('000660', 5)])                                     # 000660만 손절, 032640은 없음

    def test_other_positions_keep_profit_protection(self):
        # 2026-10-16: 고정 +6% 익절 대신 추적 청산. 000660은 고점(+7%) 뒤 고점 대비 -2.5% 이탈이 2회 확인되면 팔리고, 032640은 건드리지 않는다.
        with self.ledger.connect() as db:
            db.execute("INSERT OR IGNORE INTO positions(code,qty,state,buy_day,floor_reached) VALUES('000660',5,'OPEN','2026-10-14',0)")
        b = FakeBroker([holding('032640', 13, 14750, 16400), holding('000660', 5, 100000, 107000)], {'032640': 16400, '000660': 107000})
        self.cycle(b)                                                                  # 고점 +7% 기록, 매도 없음
        self.assertEqual(b.sells, [])
        b.prices['000660'] = 104000
        b.holdings = [holding('032640', 13, 14750, 16400), holding('000660', 5, 100000, 104000)]
        self.cycle(b)                                                                  # 이탈 첫 확인
        self.assertEqual(b.sells, [])
        self.assertEqual(self.cycle(b), 'TRAIL_2_5')                                   # 이탈 둘째 확인 -> 매도
        self.assertEqual(b.sells, [('000660', 5)])


class ExcludedBuyTests(Base):
    def bars(self):
        out, close = [], 14000.0
        for i in range(25):
            d = (datetime(2026, 10, 14, tzinfo=KST) - timedelta(days=24 - i)).strftime('%Y-%m-%d')
            close += 30
            out.append({'date': d, 'open': close, 'high': close * 1.015, 'low': close * 0.985, 'close': close, 'volume': 300000})
        return out

    def candidate(self, code):
        return {'scan_date': '2026-10-14', 'scanner': 'x', 'code': code, 'base_price': 14750, 'status': 'NEW'}

    def test_excluded_code_is_never_bought_even_as_top_candidate(self):
        with self.ledger.connect() as db:
            db.execute("DELETE FROM positions")                                         # 보유 없음 상태에서 매수 후보로 올라온 경우
        bars = self.bars()
        b = FakeBroker([], {'032640': 14750, '000660': 14750})
        result = self.cycle(b, [self.candidate('032640'), self.candidate('000660')], lambda c: bars)
        self.assertEqual(result, 'BUY_SENT')
        self.assertEqual([x[0] for x in b.buys], ['000660'])                           # 다른 종목 매수는 유지, 032640만 건너뜀

    def test_control_without_exclusion_it_would_buy_032640(self):
        with self.ledger.connect() as db:
            db.execute("DELETE FROM positions")
        self.write_exclusions([])
        bars = self.bars()
        b = FakeBroker([], {'032640': 14750})
        self.cycle(b, [self.candidate('032640')], lambda c: bars)
        self.assertEqual([x[0] for x in b.buys], ['032640'])


class FailClosedTests(Base):
    def stop_loss_broker(self):
        with self.ledger.connect() as db:
            db.execute("INSERT OR IGNORE INTO positions(code,qty,state,buy_day,floor_reached) VALUES('000660',5,'OPEN','2026-10-14',0)")
        return FakeBroker([holding('032640', 13, 14750, 11800), holding('000660', 5, 100000, 90000)], {'032640': 11800, '000660': 90000})

    def assert_no_orders(self, b):
        self.assertEqual(self.cycle(b), 'EXCLUSION_UNCONFIRMED')
        self.assertEqual((b.sells, b.buys), ([], []))

    def test_missing_file_trades_nothing(self):
        os.remove(os.path.join(self.dir, 'engine_excluded.json'))
        self.assert_no_orders(self.stop_loss_broker())

    def test_corrupt_file_trades_nothing(self):
        self.write_exclusions([], raw='{not json')
        self.assert_no_orders(self.stop_loss_broker())

    def test_bom_or_wrong_shape_trades_nothing(self):
        self.write_exclusions([], raw='﻿{"codes": ["032640"]}')
        self.assert_no_orders(self.stop_loss_broker())
        self.write_exclusions([], raw='{"codes": "032640"}')
        self.assert_no_orders(self.stop_loss_broker())
        self.write_exclusions([], raw='{"codes": ["32640"]}')
        self.assert_no_orders(self.stop_loss_broker())

    def test_readiness_reports_exclusion_state(self):
        b = FakeBroker([], {})
        self.assertTrue(le.readiness(b, self.dir, NOW)['exclusions_loaded'])
        os.remove(os.path.join(self.dir, 'engine_excluded.json'))
        self.assertFalse(le.readiness(b, self.dir, NOW)['exclusions_loaded'])


if __name__ == '__main__':
    unittest.main()

