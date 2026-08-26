# -*- coding: utf-8 -*-
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))

import db_schema  # noqa: E402


class FutureChartDateTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_load_normalizes_legacy_dates_and_prefers_canonical_duplicate(self):
        self.conn.executemany(
            'INSERT INTO future_chart (symbol, date, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?)',
            [
                ('BTC', '2026-08-01', 1, 1, 1, 10),
                ('BTC', '20260801', 2, 2, 2, 20),
                ('BTC', '20260802', 3, 3, 3, 30),
                ('BTC', '20260803', 4, 4, 4, 40),
            ],
        )
        rows = db_schema.load_future_chart(self.conn, 'BTC', limit_days=10)
        self.assertEqual([row['date'] for row in rows], ['20260801', '20260802', '20260803'])
        self.assertEqual(rows[0]['close'], 20)

    def test_upsert_writes_canonical_date_and_since_filter_uses_it(self):
        db_schema.upsert_future_chart_rows(
            self.conn,
            'BTC',
            [{'date': '2026-08-04', 'open': 4, 'high': 4, 'low': 4, 'close': 40}],
        )
        rows = db_schema.load_future_chart_since(self.conn, 'BTC', '20260804')
        self.assertEqual(rows[0]['date'], '20260804')


if __name__ == '__main__':
    unittest.main()
