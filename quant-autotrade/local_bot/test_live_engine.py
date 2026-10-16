import os
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from live_engine import Ledger, approval_ok, exit_reason, net_gain, rank_candidates, trade_once
from kiwoom import KiwoomClient

KST = timezone(timedelta(hours=9))


class FakeBroker:
    def __init__(self):
        self.calls = []
        self.cash = 1_000_000
        self.holdings = []
        self.pending = []
        self.market_price = 10_000

    def account_ids(self): return ['test-account']
    def balance(self): return self.holdings
    def unfilled(self): return self.pending
    def cash_available(self): return self.cash
    def last_price(self, code): return self.market_price, '2026-10-14 09:15'
    def buy_limit(self, code, qty, price):
        self.calls.append(('BUY', code, qty, price))
        return {'ok': True, 'ord_no': 'test-order'}
    def sell_market(self, code, qty):
        self.calls.append(('SELL', code, qty))
        return {'ok': True, 'ord_no': 'test-order'}


def bars(code):
    return [{'date': (datetime(2026, 9, 23) + timedelta(days=i)).strftime('%Y-%m-%d'),
             'close': 10_000 + i * 10, 'high': 10_300 + i * 10,
             'low': 9_800 + i * 10, 'volume': 200_000} for i in range(21)]


class LiveEngineTests(unittest.TestCase):
    def test_broker_order_requires_explicit_success_code(self):
        client = KiwoomClient('test-key', 'test-secret')
        with patch.object(client, 'call', return_value={'ord_no': '123'}) as call:
            self.assertFalse(client.sell_market('005930', 1)['ok'])
            self.assertFalse(client.buy_limit('005930', 1, 10000)['ok'])
        self.assertEqual(call.call_count, 2)

    def test_exit_policy(self):
        self.assertEqual(exit_reason(-5, False), 'STOP_NET_5')
        self.assertEqual(exit_reason(6, False), 'PROFIT_NET_6')
        self.assertEqual(exit_reason(2.99, True), 'PROFIT_FLOOR_NET_3')
        self.assertIsNone(exit_reason(2.99, False))
        self.assertAlmostEqual(net_gain(10500, 10000), 4.3)

    def test_candidate_requires_fresh_complete_metrics(self):
        rows = [{'code': '005930', 'scan_date': '2026-10-13', 'status': 'NEW'}]
        ranked = rank_candidates(rows, bars, '2026-10-14')
        self.assertEqual([r[1] for r in ranked], ['005930'])
        self.assertEqual(rank_candidates(rows, lambda _: bars('x')[:-1], '2026-10-14'), [])

    def test_no_approval_never_calls_order(self):
        with tempfile.TemporaryDirectory() as folder:
            broker = FakeBroker()
            ledger = Ledger(os.path.join(folder, 'orders.db'))
            with patch.dict(os.environ, {'LIVE_TRADING': '1', 'KIWOOM_BASE_URL': 'https://api.kiwoom.com'}):
                self.assertFalse(approval_ok(folder, broker.account_ids(), datetime(2026, 10, 14, 9, tzinfo=KST)))
                result = trade_once(broker, ledger, [], lambda _: [], folder, datetime(2026, 10, 14, 9, 15, tzinfo=KST))
            self.assertEqual(result, 'DISABLED_OR_UNCERTAIN')
            self.assertEqual(broker.calls, [])

    def test_approval_is_bound_to_date_account_and_production(self):
        with tempfile.TemporaryDirectory() as folder:
            now = datetime(2026, 10, 14, 9, tzinfo=KST)
            path = os.path.join(folder, 'LIVE_TRADING_APPROVAL')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'date': '2026-10-14',
                           'account_sha256': hashlib.sha256(b'test-account').hexdigest()}, f)
            with patch.dict(os.environ, {'LIVE_TRADING': '1', 'KIWOOM_BASE_URL': 'https://api.kiwoom.com'}):
                self.assertTrue(approval_ok(folder, ['test-account'], now))
                self.assertFalse(approval_ok(folder, ['other-account'], now))
                self.assertFalse(approval_ok(folder, ['test-account', 'other-account'], now))
                self.assertTrue(approval_ok(folder, ['test-account'], now + timedelta(days=1)))
            with patch.dict(os.environ, {'LIVE_TRADING': '0', 'KIWOOM_BASE_URL': 'https://api.kiwoom.com'}):
                self.assertFalse(approval_ok(folder, ['test-account'], now))
            with patch.dict(os.environ, {'LIVE_TRADING': '1', 'KIWOOM_BASE_URL': 'https://mockapi.kiwoom.com'}):
                self.assertFalse(approval_ok(folder, ['test-account'], now))

    def test_budget_and_duplicate_safeguards(self):
        with tempfile.TemporaryDirectory() as folder:
            broker = FakeBroker()
            ledger = Ledger(os.path.join(folder, 'orders.db'))
            # Only in this unit test: override approval without creating an activation file.
            rows = [{'code': '005930', 'scan_date': '2026-10-13', 'status': 'NEW', 'base_price': 10_000}]
            with patch('live_engine.approval_ok', return_value=True), patch('live_engine.rank_candidates', return_value=[((2, 2, 0, 0), '005930', 10_000, '2026-10-13')]):
                now = datetime(2026, 10, 14, 9, 15, tzinfo=KST)
                self.assertEqual(trade_once(broker, ledger, rows, bars, folder, now), 'BUY_SENT')
                self.assertEqual(broker.calls[0], ('BUY', '005930', 30, 10_000))
                self.assertEqual(trade_once(broker, ledger, rows, bars, folder, now), 'BUY_FILL_UNCONFIRMED')
                self.assertEqual(len(broker.calls), 1)

    def test_confirmed_holding_exit_and_no_repeat(self):
        with tempfile.TemporaryDirectory() as folder:
            broker = FakeBroker()
            ledger = Ledger(os.path.join(folder, 'orders.db'))
            with ledger.connect() as db:
                db.execute("INSERT INTO positions(code,qty,state,buy_day) VALUES('005930',3,'OPEN','2026-10-13')")
            broker.holdings = [{'code': '005930', 'qty': 3, 'sellable': 3, 'avg': 10_000, 'price': 10_700}]
            broker.market_price = 10_700
            now = datetime(2026, 10, 14, 9, 15, tzinfo=KST)
            with patch('live_engine.approval_ok', return_value=True):
                self.assertEqual(trade_once(broker, ledger, [], bars, folder, now), 'PROFIT_NET_6')
                self.assertEqual(trade_once(broker, ledger, [], bars, folder, now), 'SELL_FILL_UNCONFIRMED')
            self.assertEqual(broker.calls, [('SELL', '005930', 3)])

    def test_next_day_reentry_after_closed_position(self):
        with tempfile.TemporaryDirectory() as folder:
            broker = FakeBroker()
            ledger = Ledger(os.path.join(folder, 'orders.db'))
            with ledger.connect() as db:
                db.execute("INSERT INTO positions(code,qty,state,buy_day) VALUES('005930',3,'CLOSED','2026-10-13')")
                db.execute("INSERT INTO intents(ts,code,side,qty,price,state) VALUES('2026-10-13T09:01','005930','BUY',3,10000,'ACK')")
                db.execute("INSERT INTO intents(ts,code,side,qty,state) VALUES('2026-10-13T09:10','005930','SELL',3,'ACK')")
            rows = [{'code': '005930', 'scan_date': '2026-10-13', 'status': 'NEW', 'base_price': 10_000}]
            with patch('live_engine.approval_ok', return_value=True), patch('live_engine.rank_candidates', return_value=[((2, 2, 0, 0), '005930', 10_000, '2026-10-13')]):
                now = datetime(2026, 10, 14, 9, 15, tzinfo=KST)
                self.assertEqual(trade_once(broker, ledger, rows, bars, folder, now), 'BUY_SENT')
            self.assertEqual(len(broker.calls), 1)


if __name__ == '__main__':
    unittest.main()
