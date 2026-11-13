"""Regression tests for existing-cache Market Atlas RS snapshot. No external calls."""
import os
import sys
import sqlite3
import unittest
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
from market_atlas_rs import read_snapshot


def calendar_dates(n, start=date(2025, 1, 1)):
    days = []
    current = start
    while len(days) < n:
        if current.weekday() < 5:
            days.append(current.isoformat())
        current += timedelta(days=1)
    return days


class MarketAtlasRSTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.execute(
            'CREATE TABLE daily_prices (code TEXT, date TEXT, close REAL, PRIMARY KEY(code,date))'
        )
        self.days = calendar_dates(260)
        for i, day in enumerate(self.days):
            self.conn.execute('INSERT INTO daily_prices VALUES(?,?,?)', ('005930', day, 100 + i))
            if i >= 100:  # Insufficient year history must remain null on client.
                self.conn.execute('INSERT INTO daily_prices VALUES(?,?,?)', ('000660', day, 200 + i))
        self.conn.commit()
        self.kospi = {'rows': [
            {'date': day, 'close': 1000 + i, 'confirmed': True}
            for i, day in enumerate(self.days)
        ]}
        self.kosdaq = {'rows': [
            {'date': day, 'close': 800 + i, 'confirmed': True}
            for i, day in enumerate(self.days)
        ]}

    def tearDown(self):
        self.conn.close()

    def test_exact_alignment_and_windows(self):
        result = read_snapshot(
            self.conn, ['005930','000660','005930'],
            {'KOSPI': self.kospi, 'KOSDAQ': self.kosdaq}
        )
        bench = result['benchmarks']['KOSPI']
        self.assertEqual(result['basis'], 'confirmed_daily_close')
        self.assertEqual(result['windows'], {'1m':20, '1y':250})
        self.assertEqual(bench['asOf'], self.days[-1])
        self.assertEqual(bench['base1m'], self.days[-21])
        self.assertEqual(bench['base1y'], self.days[-251])
        self.assertEqual(result['prices']['005930'][self.days[-1]], 359)
        self.assertNotIn(self.days[-251], result['prices']['000660'])
        self.assertEqual(len(result['prices']), 2)
        self.assertEqual(set(result['prices']['005930']),
                         {self.days[-1],self.days[-21],self.days[-251]})

    def test_provisional_benchmark_and_missing_reference(self):
        bad = {'rows': self.kospi['rows'][:-1] + [
            dict(self.kospi['rows'][-1], confirmed=False)
        ]}
        result = read_snapshot(self.conn, ['005930'], {'KOSPI':bad, 'KOSDAQ':{'rows':[]}})
        self.assertEqual(result['benchmarks']['KOSPI']['asOf'], self.days[-2])
        self.assertIsNone(result['benchmarks']['KOSDAQ']['asOf'])

    def test_invalid_codes_and_no_prices(self):
        with self.assertRaises(ValueError):
            read_snapshot(self.conn, ['bad'], {'KOSPI':self.kospi})
        result = read_snapshot(self.conn, ['999999'], {'KOSPI':self.kospi})
        self.assertEqual(result['benchmarks'], {})
        self.assertEqual(result['prices'], {})

    def test_no_writes_to_daily_prices(self):
        before = self.conn.execute('SELECT COUNT(*) FROM daily_prices').fetchone()[0]
        read_snapshot(self.conn, ['005930'], {'KOSPI':self.kospi})
        after = self.conn.execute('SELECT COUNT(*) FROM daily_prices').fetchone()[0]
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
