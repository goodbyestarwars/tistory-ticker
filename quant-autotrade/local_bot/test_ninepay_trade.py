from datetime import datetime, timedelta, timezone
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
from ninepay_trade import trade_signal_once

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 10, 19, 9, 30, tzinfo=KST)


class FakePolicy:
    BUDGET = 1_000_000
    RESERVE = 100_000
    PER_STOCK = 300_000
    MAX_STOCKS = 3

    @staticmethod
    def approval_ok(folder, accounts, now):
        return accounts == ['account']

    @staticmethod
    def load_exclusions(folder):
        return set()


class FakeLedger:
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('CREATE TABLE positions(code TEXT PRIMARY KEY,qty INTEGER,state TEXT,buy_day TEXT,floor_reached INTEGER);'
                              'CREATE TABLE intents(id INTEGER PRIMARY KEY,ts TEXT,code TEXT,side TEXT,qty INTEGER,price INTEGER);')
        self.reserved = []

    def connect(self):
        class Connection:
            def __enter__(inner):
                return self.db
            def __exit__(inner, *args):
                self.db.commit()
        return Connection()

    def has_uncertain(self):
        return False

    def reserve(self, code, side, qty, price, reason, note):
        self.reserved.append((code, side, qty, price, reason, note))
        self.db.execute('INSERT INTO intents(ts,code,side,qty,price) VALUES(?,?,?,?,?)',
                        (NOW.isoformat(), code, side, qty, price))
        return 1

    def acknowledge(self, intent, result):
        return 'ACK'


class FakeClient:
    def __init__(self):
        self.orders = []
        self.cash = 1_000_000
        self.price = 10_000

    def account_ids(self):
        return ['account']

    def balance(self):
        return []

    def unfilled(self):
        return []

    def cash_available(self):
        return self.cash

    def call(self, api_id, path, body):
        return {'return_code': 0, 'cur_prc': str(self.price), 'stk_nm': '삼성전자'}

    def buy_limit(self, code, qty, price):
        self.orders.append((code, qty, price))
        return {'ok': True, 'ord_no': 'fake'}


def signal(**changes):
    item = {'code': '005930', 'signalId': '2026-10-19:005930', 'at': NOW.timestamp()-2,
            'price': 10_000, 'source': 'Kiwoom WebSocket', 'ruleVersion': 'ab70-v1',
            'volumeMissing': False, 'excluded': False, 'branches': ['A', 'B'],
            'first70At': NOW.timestamp()-60, 'volumeRatio': .8}
    item.update(changes)
    return item


class TradeTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.ledger = FakeLedger()
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)

    def run_trade(self, sig=None):
        return trade_signal_once(self.client, self.ledger, sig or signal(), self.folder.name,
                                 NOW, FakePolicy, clock=lambda: NOW)

    def test_no_intraday_buy_at_or_after_1400_even_with_fresh_signal(self):
        after = NOW.replace(hour=14, minute=0)
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            result = trade_signal_once(self.client, self.ledger,
                signal(at=after.timestamp()-1, first70At=NOW.timestamp()-60),
                self.folder.name, after, FakePolicy, clock=lambda: after)
        self.assertEqual(result, 'CLOSED_OR_STOPPED')
        self.assertEqual(self.client.orders, [])
        self.assertEqual(self.ledger.reserved, [])

    def test_signal_expiring_at_order_boundary_does_not_buy(self):
        before = NOW.replace(hour=13, minute=59, second=59)
        after = before + timedelta(seconds=1)
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            result = trade_signal_once(self.client, self.ledger,
                signal(at=before.timestamp()-1, first70At=NOW.timestamp()-60),
                self.folder.name, before, FakePolicy, clock=lambda: after)
        self.assertEqual(result, 'STALE_BEFORE_ORDER')
        self.assertEqual(self.client.orders, [])

    def test_disabled_does_not_touch_broker(self):
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '0'}):
            self.assertEqual(self.run_trade(), '9PAY_DISABLED')
        self.assertEqual(self.client.orders, [])

    def test_stale_and_unfunded_rejected(self):
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            self.assertEqual(self.run_trade(signal(at=NOW.timestamp()-11)), 'STALE_SIGNAL')
            self.client.cash = 900_000
            self.assertEqual(self.run_trade(), 'INSUFFICIENT_STARTING_CASH')
        self.assertEqual(self.client.orders, [])

    def test_chase_and_duplicate_rejected(self):
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            self.client.price = 10_040
            self.assertEqual(self.run_trade(), 'PRICE_MOVED')
            self.client.price = 10_000
            self.assertEqual(self.run_trade(), '9PAY_BUY_SENT')
            self.assertEqual(self.run_trade(), 'BUY_FILL_UNCONFIRMED')
        self.assertEqual(self.client.orders, [('005930', 30, 10_000)])
        self.assertEqual(self.ledger.reserved[0][4], 'NINEPAY_ENTRY')

    def test_signal_expiring_during_checks_cannot_order(self):
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            result = trade_signal_once(self.client, self.ledger, signal(), self.folder.name,
                                       NOW, FakePolicy, clock=lambda: NOW + timedelta(seconds=12))
        self.assertEqual(result, 'STALE_BEFORE_ORDER')
        self.assertEqual(self.client.orders, [])

    def test_stop_created_during_price_check_blocks_order(self):
        def price_check(*args):
            with open(os.path.join(self.folder.name, 'STOP'), 'w'):
                pass
            return {'return_code': 0, 'cur_prc': '10000', 'stk_nm': '삼성전자'}
        self.client.call = price_check
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            self.assertEqual(self.run_trade(), 'DISABLED_OR_UNCERTAIN')
        self.assertEqual(self.client.orders, [])

    def test_excluded_products_and_unknown_name_never_order(self):
        for name in ('KODEX 200선물인버스2X', 'TIGER 레버리지', 'ETN Inverse',
                     'ETF LEVERAGED', 'ETN 2X', 'ETF 3배', '레 버 리 지',
                     'KODEX CD금리액티브(합성)', 'TIGER CD1년금리액티브(합성)',
                     'KODEX KOFR금리액티브', '미국달러SOFR금리', 'TIGER 머니마켓액티브',
                     'ETF 단기채권', 'ETF Money Market', ''):
            self.client.call = lambda *args, n=name: {'return_code': 0, 'cur_prc': '10000', 'stk_nm': n}
            with self.subTest(name=name), patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
                self.assertIn(self.run_trade(), ('PRODUCT_EXCLUDED', 'PRODUCT_NAME_UNCONFIRMED'))
        self.assertEqual(self.client.orders, [])


if __name__ == '__main__':
    unittest.main()
