# -*- coding: utf-8 -*-
"""증시온도 일별 구성값 스냅샷·야간선물 마감 보관(2026-10-04) 계약."""
import json
import os
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import market_temp  # noqa: E402

KST = timezone(timedelta(hours=9))


def make_conn():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE future_chart_minute (symbol TEXT NOT NULL, ts INTEGER NOT NULL, open REAL, '
                 'high REAL, low REAL, close REAL, PRIMARY KEY (symbol, ts))')
    market_temp.ensure_schema(conn)
    return conn


class SnapshotTests(unittest.TestCase):
    def test_component_snapshot_is_one_row_per_day_and_overwritten(self):
        conn = make_conn()
        summary = {'score100': 52.0, 'axes': {'money': {'value': 18.0}}}
        comps = {'vix': {'score': 16, 'value': 15.3}}
        self.assertTrue(market_temp.record_component_snapshot(conn, '2026-10-02', True, summary, comps, {'total': {'up': 1}}))
        summary2 = {'score100': 55.0, 'axes': {'money': {'value': 20.0}}}
        self.assertTrue(market_temp.record_component_snapshot(conn, '2026-10-02', True, summary2, comps, None))
        rows = conn.execute('SELECT date, score100, components_json, breadth_json FROM market_temp_snapshot').fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][1], 55.0)
        self.assertEqual(json.loads(rows[0][2])['vix']['value'], 15.3)
        self.assertIsNone(rows[0][3])

    def test_holiday_or_missing_score_is_not_recorded(self):
        conn = make_conn()
        self.assertFalse(market_temp.record_component_snapshot(conn, '2026-10-03', False, {'score100': 50.0}, {}, None))
        self.assertFalse(market_temp.record_component_snapshot(conn, '2026-10-02', True, {'score100': None}, {}, None))
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM market_temp_snapshot').fetchone()[0], 0)

    def test_night_close_recorded_only_in_morning_window_with_last_bar(self):
        conn = make_conn()
        now = datetime(2026, 10, 6, 7, 30, tzinfo=KST)          # 화요일 아침
        boundary = int(now.replace(hour=6, minute=0, second=0, microsecond=0).timestamp())
        rows = [('KOSPI200_NIGHT', boundary - 3600, 1, 1, 1, 1120.0),
                ('KOSPI200_NIGHT', boundary - 60, 1, 1, 1, 1127.45),
                ('KOSPI200_NIGHT', boundary + 600, 1, 1, 1, 1999.0),     # 6시 이후 봉은 제외
                ('KOSPI200_DAY', boundary - 14 * 3600, 1, 1, 1, 1108.3)]
        conn.executemany('INSERT INTO future_chart_minute VALUES (?,?,?,?,?,?)', rows)
        self.assertTrue(market_temp.record_night_futures_close(conn, now))
        row = conn.execute('SELECT date, night_close, bars, day_close FROM night_futures_close').fetchone()
        self.assertEqual(row[0], '2026-10-06')
        self.assertEqual(row[1], 1127.45)
        self.assertEqual(row[2], 2)
        self.assertEqual(row[3], 1108.3)
        # 창 밖(월요일·낮)에서는 기록하지 않는다
        self.assertFalse(market_temp.record_night_futures_close(conn, datetime(2026, 10, 5, 7, 30, tzinfo=KST)))
        self.assertFalse(market_temp.record_night_futures_close(conn, datetime(2026, 10, 6, 13, 0, tzinfo=KST)))


if __name__ == '__main__':
    unittest.main()
