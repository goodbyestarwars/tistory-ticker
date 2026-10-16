# -*- coding: utf-8 -*-
"""아침 라이브 갭상승 그림자 검색기(2026-10-16, Issue #697): 신호 규칙·가상 진입·경로·사후 성과·요약 계약."""

import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import gap_shadow as gs  # noqa: E402

KST = timezone(timedelta(hours=9))


def at(h, m, s=0, day=19):
    return datetime(2026, 10, day, h, m, s, tzinfo=KST)


def feed(ob, h, m, s, price, volume):
    now = at(h, m, s)
    return gs.step(ob, gs.sod(now), now.timestamp(), price, volume)


def opened(prev_close=10000, prev_volume=1000000, open_price=10200):
    """09:00:30에 시초 관측 -> 09:04 범위 -> 신호 직전 상태."""
    ob = gs.new_obs(prev_close, prev_volume)
    feed(ob, 9, 0, 30, open_price, 20000)
    feed(ob, 9, 2, 0, open_price - 50, 40000)   # OR 저가
    feed(ob, 9, 4, 30, open_price + 80, 60000)  # OR 고가
    return ob


class StepTest(unittest.TestCase):
    def test_signal_needs_break_above_opening_range_and_volume(self):
        ob = opened()
        self.assertEqual(ob['status'], 'WATCH')
        self.assertEqual((ob['or_low'], ob['or_high']), (10150, 10280))
        self.assertIsNone(feed(ob, 9, 6, 0, 10280, 80000))        # 고가와 같으면 돌파 아님
        self.assertIsNone(feed(ob, 9, 6, 30, 10300, 30000))       # 누적 거래량 3% < 5%
        self.assertEqual(feed(ob, 9, 7, 0, 10300, 60000), 'SIGNAL')
        self.assertEqual(ob['signal']['price'], 10300)
        self.assertAlmostEqual(ob['signal']['ratio'], 0.06)

    def test_entry_is_next_observation_with_stop_at_or_low(self):
        ob = opened()
        feed(ob, 9, 7, 0, 10300, 60000)
        self.assertEqual(feed(ob, 9, 7, 30, 10320, 70000), 'ENTRY')
        e = ob['entry']
        self.assertEqual(e['price'], 10320)               # 신호가가 아니라 다음 관측가
        self.assertEqual(e['stop_price'], 10150)
        self.assertAlmostEqual(e['stop_pct'], (10320 - 10150) / 10320 * 100)
        self.assertEqual(e['risk_ok'], 1)
        self.assertIsNone(feed(ob, 9, 8, 0, 10500, 80000))
        self.assertIsNone(feed(ob, 9, 9, 0, 10100, 90000))
        self.assertEqual((e['max'], e['min'], e['last'], e['stop_hit']), (10500, 10100, 10100, 1))

    def test_far_stop_is_recorded_but_not_risk_ok(self):
        ob = gs.new_obs(10000, 1000000)
        feed(ob, 9, 0, 30, 10200, 20000)
        feed(ob, 9, 3, 0, 9800, 40000)    # OR 저가가 멀다(약 4%+)
        feed(ob, 9, 4, 0, 10220, 50000)
        feed(ob, 9, 6, 0, 10300, 60000)
        feed(ob, 9, 6, 30, 10300, 61000)
        self.assertEqual(ob['status'], 'ENTERED')
        self.assertGreater(ob['entry']['stop_pct'], gs.MAX_STOP_PCT)
        self.assertEqual(ob['entry']['risk_ok'], 0)

    def test_no_open_observation_means_no_signal_that_day(self):
        ob = gs.new_obs(10000, 1000000)
        self.assertIsNone(feed(ob, 9, 0, 10, 10200, 0))           # 체결 전(거래량 0)은 시초 관측이 아님
        self.assertEqual(ob['status'], 'WATCH')
        feed(ob, 9, 4, 0, 10200, 20000)                           # 09:03 이후 첫 관측
        self.assertEqual(ob['status'], 'NO_OPEN')
        self.assertIsNone(feed(ob, 9, 7, 0, 10500, 90000))

    def test_gap_outside_range_is_dropped(self):
        for open_price in (10050, 10900):                         # +0.5%, +9%
            ob = gs.new_obs(10000, 1000000)
            feed(ob, 9, 0, 30, open_price, 20000)
            self.assertEqual(ob['status'], 'GAP_OUT')

    def test_no_new_signal_after_two_pm_or_without_prev_data(self):
        ob = opened()
        self.assertIsNone(feed(ob, 14, 0, 30, 10500, 90000))
        self.assertEqual(ob['status'], 'WATCH')
        ob2 = gs.new_obs(None, None)
        feed(ob2, 9, 0, 30, 10200, 20000)
        self.assertEqual(ob2['status'], 'NO_OPEN')

    def test_must_hold_open_price(self):
        ob = gs.new_obs(10000, 1000000)
        feed(ob, 9, 0, 30, 10300, 20000)
        feed(ob, 9, 4, 0, 10100, 40000)
        feed(ob, 9, 4, 30, 10450, 50000)         # OR 고가 10450
        self.assertIsNone(feed(ob, 9, 6, 0, 10440, 90000))


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, 'gap_shadow.db')
        self.prices = sqlite3.connect(':memory:')
        self.prices.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER)')
        self.prices.execute("INSERT INTO daily_prices VALUES ('005930','2026-10-16',9900,10100,9800,10000,1000000)")
        self.prices.execute("INSERT INTO daily_prices VALUES ('005930','2026-10-15',9500,9900,9400,9800,900000)")
        gs._day.update({'date': None, 'obs': {}, 'prev': {}})
        self._orig = gs.in_signal_session
        gs.in_signal_session = lambda now: True

    def tearDown(self):
        gs.in_signal_session = self._orig
        self.tmp.cleanup()
        self.prices.close()

    def obs(self, h, m, s, price, volume, code='005930'):
        return gs.observe([{'code': code, 'name': '삼성전자', 'price': price, 'trade_volume': volume}],
                          at(h, m, s), self.prices, self.db)

    def run_morning(self):
        self.obs(9, 0, 30, 10200, 20000)
        self.obs(9, 2, 0, 10150, 40000)
        self.obs(9, 4, 30, 10280, 60000)
        self.assertEqual(self.obs(9, 7, 0, 10300, 60000), [('005930', 'SIGNAL')])
        self.assertEqual(self.obs(9, 7, 30, 10320, 70000), [('005930', 'ENTRY')])
        self.obs(9, 8, 0, 10500, 80000)
        self.obs(9, 8, 30, 10400, 90000)

    def row(self):
        with closing(sqlite3.connect(self.db)) as conn:
            conn.row_factory = sqlite3.Row
            return conn.execute('SELECT * FROM gap_shadow_signal').fetchall()

    def test_signal_entry_and_path_are_stored_with_both_times_and_prices(self):
        self.run_morning()
        rows = self.row()
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r['signal_price'], r['entry_price'], r['stop_price']), (10300, 10320, 10150))
        self.assertNotEqual(r['signal_at'], r['entry_at'])
        self.assertEqual((r['open_obs_price'], r['or_high'], r['or_low'], r['prev_close']), (10200, 10280, 10150, 10000))
        self.assertEqual((r['intraday_max'], r['intraday_min'], r['intraday_last']), (10500, 10320, 10400))
        self.assertAlmostEqual(r['gap_pct'], 2.0)
        self.assertEqual(r['risk_ok'], 1)

    def test_restart_keeps_state_and_never_duplicates(self):
        self.run_morning()
        gs._day.update({'date': None, 'obs': {}, 'prev': {}})   # 프로세스 재시작
        self.assertEqual(self.obs(9, 9, 0, 10900, 99000), [])
        rows = self.row()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['intraday_max'], 10900)         # 경로는 이어서 갱신
        self.assertEqual(rows[0]['entry_price'], 10320)

    def test_unknown_code_without_history_is_ignored(self):
        self.assertEqual(gs.observe([{'code': '999999', 'price': 10200, 'trade_volume': 5000}], at(9, 0, 30), self.prices, self.db), [])
        self.assertEqual(self.row(), [])

    def test_observe_swallows_errors(self):
        self.assertIsNone(gs.observe([{'code': '005930', 'price': 'x', 'trade_volume': None}], at(9, 0, 30), None, self.db))

    def test_outcomes_fill_from_daily_bars_and_are_idempotent(self):
        self.run_morning()
        for d, o, h, l, c in (('2026-10-19', 10200, 10600, 10150, 10450), ('2026-10-20', 10450, 10800, 10300, 10700)):
            self.prices.execute("INSERT INTO daily_prices VALUES ('005930',?,?,?,?,?,1000)", (d, o, h, l, c))
        self.assertEqual(gs.update_outcomes(self.prices, self.db, today='2026-10-20'), 1)
        r = self.row()[0]
        self.assertEqual(r['outcome_days'], 2)
        self.assertEqual(gs.update_outcomes(self.prices, self.db, today='2026-10-20'), 1)   # 같은 값으로 다시 써도 동일
        self.assertEqual(self.row()[0]['outcome_days'], 2)

    def test_summary_uses_cost_stop_and_marks_small_sample(self):
        self.run_morning()
        for d, o, h, l, c in (('2026-10-19', 10200, 10600, 10150, 10450), ('2026-10-20', 10450, 10800, 10300, 10700)):
            self.prices.execute("INSERT INTO daily_prices VALUES ('005930',?,?,?,?,?,1000)", (d, o, h, l, c))
        gs.update_outcomes(self.prices, self.db, today='2026-10-20')
        s = gs.summarize(self.db)
        self.assertEqual((s['signals'], s['entered']), (1, 1))
        d1 = s['byHorizon']['D1']['all_withStop']
        self.assertEqual(d1['n'], 1)
        self.assertFalse(d1['enough'])
        self.assertAlmostEqual(d1['expectancyNetPct'], round((10700 / 10320 - 1) * 100 - gs.COST_PCT, 3))
        self.assertEqual(s['byHorizon']['D5']['all_withStop']['n'], 0)   # 일봉 부족 -> 표본에서 제외


class EvaluateTest(unittest.TestCase):
    def days(self, *rows):
        return [{'date': 'd%d' % i, 'open': o, 'high': h, 'low': l, 'close': c} for i, (o, h, l, c) in enumerate(rows)]

    def test_intraday_stop_exits_at_stop_price(self):
        days = self.days((100, 110, 90, 105), (105, 120, 100, 118))
        r = gs.evaluate_trade(100, 97, {'max': 102, 'min': 96, 'last': 99}, days, 1)
        self.assertTrue(r['stopped'])
        self.assertEqual(r['exit_k'], 0)
        self.assertAlmostEqual(r['ret_pct'], -3.0)
        self.assertAlmostEqual(r['net_pct'], -3.0 - gs.COST_PCT)
        self.assertAlmostEqual(r['r'], (-3.0 - gs.COST_PCT) / 3.0)

    def test_gap_through_stop_exits_at_open_next_day(self):
        days = self.days((100, 104, 98, 103), (94, 100, 92, 99))
        r = gs.evaluate_trade(100, 97, {'max': 104, 'min': 98, 'last': 103}, days, 1)
        self.assertTrue(r['stopped'])
        self.assertEqual(r['exit_k'], 1)
        self.assertAlmostEqual(r['ret_pct'], -6.0)          # 손절가가 아니라 시가에 청산

    def test_d0_daily_low_is_not_used_for_stop(self):
        days = self.days((100, 110, 80, 108))               # 일봉 저가는 진입 전 구간일 수 있다
        r = gs.evaluate_trade(100, 97, {'max': 109, 'min': 99, 'last': 108}, days, 0)
        self.assertFalse(r['stopped'])
        self.assertAlmostEqual(r['ret_pct'], 8.0)

    def test_no_stop_variant_and_mfe(self):
        days = self.days((100, 104, 98, 103), (94, 125, 92, 99))
        r = gs.evaluate_trade(100, 97, {'max': 104, 'min': 98, 'last': 103}, days, 1, use_stop=False)
        self.assertFalse(r['stopped'])
        self.assertAlmostEqual(r['ret_pct'], -1.0)
        self.assertAlmostEqual(r['mfe_pct'], 25.0)

    def test_missing_days_returns_none(self):
        self.assertIsNone(gs.evaluate_trade(100, 97, {'max': 100, 'min': 100, 'last': 100}, self.days((100, 101, 99, 100)), 3))

    def test_stats_payoff_expectancy_and_top_exclusion(self):
        results = [{'net_pct': x, 'r': x / 3, 'stopped': x < 0, 'mfe_pct': 16 if x > 10 else 1}
                   for x in (-3.7, -3.7, -3.7, -3.7, 2.0, 20.0)]
        st = gs._stats(results, gs.COST_PCT)
        self.assertEqual(st['n'], 6)
        self.assertFalse(st['enough'])
        self.assertAlmostEqual(st['winRatePct'], 33.3, places=1)
        self.assertAlmostEqual(st['avgWinPct'], 11.0)
        self.assertAlmostEqual(st['avgLossPct'], -3.7)
        self.assertAlmostEqual(st['payoffRatio'], 2.97, places=2)
        self.assertAlmostEqual(st['expectancyNetPct'], round((-14.8 + 22.0) / 6, 3))
        self.assertAlmostEqual(st['expectancyNetExTopPct'], round((-14.8 + 2.0) / 5, 3))
        self.assertAlmostEqual(st['reach15Pct'], 16.7, places=1)


if __name__ == '__main__':
    unittest.main()
