# -*- coding: utf-8 -*-
import os
import sqlite3
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

import pattern_tracker as pt  # noqa: E402

START = date(2026, 1, 5)


def day(i):
    return (START + timedelta(days=i)).isoformat()


def make_conn(code, closes, volumes=None):
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)')
    for i, c in enumerate(closes):
        v = volumes[i] if volumes else 1000
        conn.execute('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)', (code, day(i), c, c + 1, c - 1, c, v))
    conn.commit()
    return conn


def flat_history(n=30, price=100.0):
    return [price] * n


ITEM = {
    'code': '000001', 'name': '테스트', 'price': 100.0, 'score': 80,
    'patternDetail': {
        'low_swings': [{'date': day(10), 'price': 90.0}, {'date': day(29), 'price': 95.0}],
        'resistance': 110.0,
    },
}


def run(after_closes):
    """30봉 평탄 이력(포착일 = 29번째 날) 뒤에 after_closes를 붙여 추적을 돌린다."""
    conn = make_conn('000001', flat_history() + after_closes)
    created = pt.record_new(conn, day(29), 'pattern:risingLows', [ITEM])
    pt.update_tracks(conn)
    row = conn.execute('SELECT * FROM pattern_tracks').fetchone()
    cols = [r[1] for r in conn.execute('PRAGMA table_info(pattern_tracks)')]
    return conn, created, dict(zip(cols, row))


class PatternTrackerTest(unittest.TestCase):
    def test_record_new_stores_immutable_snapshot(self):
        conn, created, row = run([100.0])
        self.assertEqual(created, 1)
        self.assertEqual(row['initial_support'], 95.0)
        self.assertEqual(row['initial_resistance'], 110.0)
        self.assertEqual(row['detected_close'], 100.0)
        self.assertIsNotNone(row['atr'])
        self.assertIn('low_swings', row['snapshot_json'])

    def test_duplicate_open_track_is_not_recreated(self):
        conn, _, _ = run([100.0])
        self.assertEqual(pt.record_new(conn, day(30), 'pattern:risingLows', [ITEM]), 0)
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM pattern_tracks').fetchone()[0], 1)

    def test_open_while_inside_band(self):
        _, _, row = run([100.5, 100.5, 100.5])
        self.assertEqual(row['status'], 'TRACKING')
        self.assertIsNone(row['closed_date'])

    def test_success_on_intraday_high_touch(self):
        # 고가 = 종가+1 이므로 종가 102.5 -> 고가 103.5 >= 포착가 x 1.03
        _, _, row = run([100.0, 100.0, 102.5])
        self.assertEqual(row['status'], 'SUCCESS')
        self.assertEqual(row['breakout_date'], day(32))
        self.assertGreaterEqual(row['breakout_quality'], 60)

    def test_failure_on_close_minus_3pct(self):
        _, _, row = run([100.0, 96.9])
        self.assertEqual(row['status'], 'FAILED')
        self.assertEqual(row['fail_reason'], 'LOSS_3PCT')

    def test_failure_on_ma5_break(self):
        _, _, row = run([101.0, 101.0, 99.0])
        self.assertEqual(row['status'], 'FAILED')
        self.assertEqual(row['fail_reason'], 'MA5_BREAK')

    def test_failure_on_sideways_week(self):
        _, _, row = run([100.5] * (pt.SIDEWAYS_DAYS + 2))
        self.assertEqual(row['status'], 'FAILED')
        self.assertEqual(row['fail_reason'], 'SIDEWAYS')
        self.assertEqual(row['closed_date'], day(29 + pt.SIDEWAYS_DAYS))

    def test_returns_and_excursions_use_detected_close(self):
        _, _, row = run([100.0, 104.0, 102.0, 101.0, 105.0, 108.0])
        self.assertEqual(row['ret5_pct'], 5.0)
        self.assertEqual(row['max_return_pct'], 9.0)   # 고가 = 종가+1 기준 최대
        self.assertEqual(row['max_drawdown_pct'], -1.0)  # 저가 = 종가-1 기준 최소

    def test_snapshot_survives_update(self):
        conn, _, before = run([100.0, 104.0, 105.0, 106.0])
        pt.update_tracks(conn)
        row = conn.execute('SELECT initial_support, initial_resistance, detected_close, snapshot_json FROM pattern_tracks').fetchone()
        self.assertEqual(tuple(row), (before['initial_support'], before['initial_resistance'],
                                      before['detected_close'], before['snapshot_json']))

    def test_stats_and_listing_keep_failed_rows(self):
        conn, _, _ = run([100.0, 96.0])
        stats = pt.tracker_stats(conn, 'pattern:risingLows', days=36500)
        self.assertEqual(stats['total'], 1)
        self.assertEqual(stats['failed'], 1)
        tracks = pt.list_tracks(conn, 'pattern:risingLows', view='closed', days=36500)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]['status'], 'FAILED')
        self.assertEqual(pt.list_tracks(conn, 'pattern:risingLows', view='active', days=36500), [])

    def test_stats_empty_scanner_has_no_rates(self):
        conn = make_conn('000001', flat_history())
        stats = pt.tracker_stats(conn, 'pattern:none')
        self.assertEqual(stats['total'], 0)
        self.assertIsNone(stats['breakoutRatePct'])


if __name__ == '__main__':
    unittest.main()
