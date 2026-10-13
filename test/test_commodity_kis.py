import os
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import commodity_kis
import db_schema


class CommodityKisTest(unittest.TestCase):
    def test_price_requires_recent_observation_and_valid_quote(self):
        now = datetime.now(commodity_kis.KST)
        sample = {'proc_date': now.strftime('%Y%m%d'), 'proc_time': now.strftime('%H%M%S'),
                  'last_price': '105.88', 'prev_price': '106.12', 'prev_diff_rate': '-0.23',
                  'high_price': '108.00', 'low_price': '104.00', 'exch_cd': 'ICE'}
        with patch.object(commodity_kis, '_request', return_value={'output1': sample}):
            quote = commodity_kis.fetch_price('BRNZ26')
            self.assertAlmostEqual(quote['price'], 105.88)
            self.assertAlmostEqual(quote['change'], -0.24)
        old = now - timedelta(minutes=30)
        sample.update(proc_date=old.strftime('%Y%m%d'), proc_time=old.strftime('%H%M%S'))
        with patch.object(commodity_kis, '_request', return_value={'output1': sample}):
            self.assertIsNone(commodity_kis.fetch_price('BRNZ26'))

    def test_contract_roll_clears_old_chart(self):
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE future_chart (symbol TEXT, date TEXT)')
        db_schema.set_future_contract(conn, 'BRENT', 'BRNZ26')
        conn.execute('INSERT INTO future_chart VALUES (?, ?)', ('BRENT', '20261013'))
        db_schema.set_future_contract(conn, 'BRENT', 'BRNZ26')
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM future_chart').fetchone()[0], 1)
        db_schema.set_future_contract(conn, 'BRENT', 'BRNF27')
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM future_chart').fetchone()[0], 0)
        self.assertEqual(db_schema.load_future_contract(conn, 'BRENT'), 'BRNF27')
        conn.close()


if __name__ == '__main__':
    unittest.main()
