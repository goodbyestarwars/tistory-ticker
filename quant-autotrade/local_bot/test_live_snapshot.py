import os
import sqlite3
import tempfile
import unittest

import json

import server
from server import live_snapshot, enrich_orders, known_names


class LiveSnapshotTests(unittest.TestCase):
    def test_missing_database_is_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(live_snapshot(os.path.join(folder, 'missing.db')), ({}, []))

    def test_shows_owned_position_and_order_without_account_data(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'orders.db')
            db = sqlite3.connect(path)
            try:
                db.executescript('''
                    CREATE TABLE positions(code TEXT,qty INTEGER,state TEXT,floor_reached INTEGER);
                    CREATE TABLE intents(id INTEGER,ts TEXT,code TEXT,side TEXT,qty INTEGER,state TEXT,order_no TEXT);
                    INSERT INTO positions VALUES('005930',3,'OPEN',1);
                    INSERT INTO intents VALUES(1,'2026-10-14T09:01:00+09:00','005930','BUY',3,'ACK','123');
                ''')
                db.commit()
            finally:
                db.close()
            positions, orders = live_snapshot(path)
            self.assertEqual(positions['005930']['floor_reached'], 1)
            self.assertEqual(orders[0]['reason'], 'BUY')
            self.assertEqual(orders[0]['status'], 'ACK')
            self.assertNotIn('account', str(orders).lower())


def make_ledger(folder, with_price=True):
    path = os.path.join(folder, 'orders.db')
    db = sqlite3.connect(path)
    cols = ',price INTEGER,reason TEXT' if with_price else ''
    db.execute('CREATE TABLE positions(code TEXT,qty INTEGER,state TEXT,floor_reached INTEGER)')
    db.execute('CREATE TABLE intents(id INTEGER PRIMARY KEY,ts TEXT,code TEXT,side TEXT,qty INTEGER,state TEXT,order_no TEXT%s)' % cols)
    rows = [
        (1, '2026-10-14T09:00:27+09:00', '086520', 'BUY', 3, 'ACK', 'A', 85300, None),
        (2, '2026-10-14T09:15:51+09:00', '086520', 'SELL', 3, 'ACK', 'B', None, None),                 # 예전 매도: 가격 기록 없음
        (3, '2026-10-16T09:00:56+09:00', '352820', 'BUY', 1, 'ACK', 'C', 165900, None),
        (4, '2026-10-16T09:13:35+09:00', '011200', 'BUY', 12, 'ACK', 'D', 23650, None),
        (5, '2026-10-19T09:05:10+09:00', '011200', 'SELL', 12, 'ACK', 'E', 22900, 'STOP_3'),           # 새 엔진: 판정가·사유 기록
        (6, '2026-10-16T09:12:29+09:00', '352820', 'SELL', 1, 'ACK', 'F', None, None),
    ]
    for r in rows:
        if with_price:
            db.execute('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?)', r)
        else:
            db.execute('INSERT INTO intents VALUES(?,?,?,?,?,?,?)', r[:7])
    db.commit()
    db.close()
    return path


class OrderPriceTests(unittest.TestCase):
    def test_buy_price_is_order_price_and_sell_carries_matching_buy_price(self):
        with tempfile.TemporaryDirectory() as folder:
            _, orders = live_snapshot(make_ledger(folder))
            by = {(o['code'], o['reason'], o['ts'][:10]): o for o in orders}
            buy = by[('352820', 'BUY', '2026-10-16')]
            self.assertEqual((buy['price'], buy['price_kind']), (165900, 'order'))
            sell = by[('352820', 'SELL', '2026-10-16')]
            self.assertEqual((sell['buy_price'], sell['price'], sell['price_kind']), (165900, None, None))
            new_sell = by[('011200', 'SELL', '2026-10-19')]
            self.assertEqual((new_sell['buy_price'], new_sell['price'], new_sell['price_kind'], new_sell['exit_reason']), (23650, 22900, 'decision', 'STOP_3'))
            old_sell = by[('086520', 'SELL', '2026-10-14')]
            self.assertEqual(old_sell['buy_price'], 85300)           # 같은 종목의 직전 매수가 짝지어진다

    def test_old_ledger_without_price_columns_still_works(self):
        with tempfile.TemporaryDirectory() as folder:
            _, orders = live_snapshot(make_ledger(folder, with_price=False))
            self.assertEqual(len(orders), 6)
            self.assertTrue(all(o['price'] is None and o.get('buy_price') is None for o in orders))

    def test_estimate_uses_minute_bar_close_and_is_labeled_estimate(self):
        class FakeClient:
            calls = 0

            def call(self, api_id, path, body):
                FakeClient.calls += 1
                assert api_id == 'ka10080' and body['tic_scope'] == '1'
                return {'stk_min_pole_chart_qry': [
                    {'cntr_tm': '20261016091200', 'cur_prc': '+172000'},      # 봉 시작 분 라벨(09:12 봉)
                    {'cntr_tm': '20261016091300', 'cur_prc': '171900'}]}
        server._EST_CACHE.clear(); server._MIN_CACHE.clear()
        with tempfile.TemporaryDirectory() as folder:
            _, orders = live_snapshot(make_ledger(folder))
            now = 1792100000
            enrich_orders(orders, FakeClient(), {'352820': '하이브'}, now)
            enrich_orders(orders, FakeClient(), {}, now)                     # 두 번째 요청: 캐시 사용
            sell = [o for o in orders if o['code'] == '352820' and o['reason'] == 'SELL'][0]
            self.assertEqual((sell['price'], sell['price_kind'], sell['name']), (172000, 'estimate', '하이브'))
            self.assertEqual(FakeClient.calls, 2)                             # 종목 2개(352820·086520) 각 1회, 재요청은 호출 없음
            decision = [o for o in orders if o['code'] == '011200' and o['reason'] == 'SELL'][0]
            self.assertEqual(decision['price_kind'], 'decision')              # 기록된 판정가는 덮어쓰지 않는다
            missing = [o for o in orders if o['code'] == '086520' and o['reason'] == 'SELL'][0]
            self.assertIsNone(missing['price'])                              # 해당 분 봉이 없으면 추정하지 않는다

    def test_estimate_failure_leaves_row_unchanged(self):
        class Broken:
            def call(self, *a, **k):
                raise RuntimeError('boom')
        server._EST_CACHE.clear(); server._MIN_CACHE.clear()
        with tempfile.TemporaryDirectory() as folder:
            _, orders = live_snapshot(make_ledger(folder))
            enrich_orders(orders, Broken(), {}, 1792100000)
            self.assertTrue(all(o['price_kind'] in (None, 'order', 'decision') for o in orders))

    def test_known_names_persist_after_position_leaves_the_balance(self):
        class Bot:
            holdings = [{'code': '010950', 'name': 'S-Oil'}]

        class Store:
            def watch_list(self):
                return []

            def analysis_list(self):
                return [{'code': '032640', 'name': 'LG유플러스'}]
        with tempfile.TemporaryDirectory() as folder:
            old = server._NAMES_FILE
            server._NAMES_FILE = os.path.join(folder, 'order_names.json')
            try:
                names = known_names(Bot(), Store())
                self.assertEqual(names['010950'], 'S-Oil')
                Bot.holdings = []                                             # 매도 후 잔고에서 빠짐
                self.assertEqual(known_names(Bot(), Store())['010950'], 'S-Oil')
                with open(server._NAMES_FILE, encoding='utf-8') as f:
                    self.assertEqual(json.load(f)['032640'], 'LG유플러스')
            finally:
                server._NAMES_FILE = old


if __name__ == '__main__':
    unittest.main()
