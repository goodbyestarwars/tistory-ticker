import os
import sys
import sqlite3
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm')))
import stage_integrated_daily as m


def row(day, volume=417576):
    return dict(date=day, open=100, high=110, low=90, close=105, volume=volume)


class StageIntegratedTests(unittest.TestCase):
    def test_missing_date_and_future_filter(self):
        basis = '2026-11-25'
        rows, missing = m.checked_rows([row('2026-11-23'), row(basis), row('2026-11-26')],
                                       basis, {'2026-11-23', '2026-11-24'})
        self.assertEqual(missing, {'2026-11-24'})
        self.assertEqual(len(rows), 2)
        with self.assertRaises(ValueError):
            m.checked_rows([row(basis, -1)], basis, {basis})

    def test_production_path_and_staging_atomicity(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / 'production.db'
            stage = Path(td) / 'staging.db'
            with sqlite3.connect(source) as conn:
                conn.execute('CREATE TABLE daily_prices(code TEXT)')
            with self.assertRaises(ValueError):
                m.open_stage(source, source, '2026-11-25')
            conn = m.open_stage(source, stage, '2026-11-25')
            try:
                m.save_result(conn, '376900', '2026-11-25', [row('2026-11-25')], set(), 'coverage-ok')
                m.save_result(conn, '376900', '2026-11-25', [], {'2026-11-25'}, 'failed')
                self.assertEqual(conn.execute('SELECT volume FROM integrated_daily').fetchone()[0], 417576)
                self.assertEqual(conn.execute('SELECT state FROM integrated_status').fetchone()[0], 'failed')
            finally:
                conn.close()
            with self.assertRaises(ValueError):
                m.open_stage(source, stage, '2026-11-26')


if __name__ == '__main__':
    unittest.main()
