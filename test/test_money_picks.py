# -*- coding: utf-8 -*-
"""증시온도 돈이 몰린 섹터 대표 종목 선정·기록 계약(2026-10-02)."""

import os
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import db_schema  # noqa: E402
import money_picks  # noqa: E402

KST = timezone(timedelta(hours=9))


def stock(code, name, amount, price=1000.0, rate=1.0):
    return {'code': code, 'name': name, 'price': price, 'change_rate': rate, 'trade_amount': amount}


ROWS = [
    {'industry': '광통신', 'stocks': [stock('000001', '광A', 5e9), stock('000002', '광B', 9e9), stock('000003', '광C', 1e9),
                                      stock('000004', '광D', 8e8)]},
    {'industry': '2차전지', 'stocks': [stock('000002', '광B', 9e9), stock('000010', '전A', 7e9), stock('000011', '전B', 2e9, price=None)]},
]


class SelectionTests(unittest.TestCase):
    def test_top_by_trade_amount_three_per_theme_deduped_across_themes(self):
        picks = money_picks.select_picks(ROWS)
        self.assertEqual([p['code'] for p in picks if p['theme'] == '광통신'], ['000002', '000001', '000003'])
        # 광B는 순위 높은 광통신에만 둔다. 가격 없는 종목은 건너뛴다.
        self.assertEqual([p['code'] for p in picks if p['theme'] == '2차전지'], ['000010'])
        self.assertEqual(picks[0]['rank'], 1)


class RecordingTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_records_once_after_1535_on_trading_days_only(self):
        before = datetime(2026, 10, 2, 15, 30, tzinfo=KST)
        after = datetime(2026, 10, 2, 15, 40, tzinfo=KST)
        self.assertEqual(money_picks.record_today(self.conn, ROWS, before, True), 0)
        self.assertEqual(money_picks.record_today(self.conn, ROWS, after, False), 0)
        self.assertEqual(money_picks.record_today(self.conn, ROWS, after, True), 4)
        self.assertEqual(money_picks.record_today(self.conn, ROWS, after + timedelta(minutes=3), True), 0)

    def test_history_window_and_pruning(self):
        old_day = datetime(2026, 8, 1, 15, 40, tzinfo=KST)
        money_picks.record_today(self.conn, ROWS, old_day, True)
        recent = datetime(2026, 9, 25, 15, 40, tzinfo=KST)
        money_picks.record_today(self.conn, ROWS, recent, True)
        today = datetime(2026, 10, 2, 15, 40, tzinfo=KST)
        money_picks.record_today(self.conn, ROWS, today, True)
        dates = {h['date'] for h in money_picks.load_history(self.conn, today)}
        # 14일 창: 9/25는 포함(7일 전), 8/1은 60일 보존에서 지워졌다.
        self.assertEqual(dates, {'2026-09-25', '2026-10-02'})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM money_sector_picks WHERE rec_date='2026-08-01'").fetchone()[0], 0)

    def test_endpoint_and_hook_are_wired(self):
        main = open(os.path.join(ROOT, 'scripts', 'cloud-vm', 'main.py'), encoding='utf-8').read()
        self.assertIn("@app.get('/money-picks')", main)
        flow = open(os.path.join(ROOT, 'scripts', 'cloud-vm', 'theme_flow.py'), encoding='utf-8').read()
        self.assertIn('_record_money_picks(result[', flow)


if __name__ == '__main__':
    unittest.main()
