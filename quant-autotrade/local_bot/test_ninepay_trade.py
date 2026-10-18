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
        return {'return_code': 0, 'cur_prc': str(self.price)}

    def buy_limit(self, code, qty, price):
        self.orders.append((code, qty, price))
        return {'ok': True, 'ord_no': 'fake'}


def signal(**changes):
    item = {'code': '005930', 'signalId': '2026-10-19:005930', 'at': NOW.timestamp()-2,
            'price': 10_000, 'source': 'Kiwoom WebSocket'}
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
                                 NOW, FakePolicy)

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


if __name__ == '__main__':
    unittest.main()
