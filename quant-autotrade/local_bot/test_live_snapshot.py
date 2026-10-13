import os
import sqlite3
import tempfile
import unittest

from server import live_snapshot


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


if __name__ == '__main__':
    unittest.main()
