# -*- coding: utf-8 -*-
"""최근 분기 실적 개선(EARN) 판정·추적 회귀 (2026-11-20). 실행: python -m pytest -q test/test_earn_signal.py"""
import os
import sqlite3
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import earn_signal as E  # noqa: E402


def q(a, y=None, prior=None, rcept='20260814', basis='standalone_3m'):
    d = {'amount_basis': basis, 'rcept_dt': rcept, 'operating_income': a, 'operating_income_yoy_pct': y, 'year': 2026, 'reprt_code': '11012'}
    if prior is not None:
        d['operating_income_prior'] = prior
    return d


class Prior(unittest.TestCase):
    def test_stored_prior_wins(self):
        self.assertEqual(E.prior_operating_income(q(10, 999, prior=-20)), (-20, 'stored'))

    def test_derived_only_when_unambiguous(self):
        self.assertEqual(E.prior_operating_income(q(10, 25.0))[1], 'derived')      # b=8
        self.assertAlmostEqual(E.prior_operating_income(q(10, 25.0))[0], 8)
        self.assertEqual(E.prior_operating_income(q(10, 150.0)), (None, None))      # b=4 또는 b=-20 둘 다 가능
        self.assertAlmostEqual(E.prior_operating_income(q(-10, 50.0))[0], -20)       # a<0, y<100: b=-20만 가능
        self.assertEqual(E.prior_operating_income(q(10, None)), (None, None))


class OpSym(unittest.TestCase):
    def test_symmetric_change_and_turnaround(self):
        v, info = E.op_sym(q(10, prior=-10), '2026-11-19')
        self.assertAlmostEqual(v, 2.0)
        self.assertEqual(info['priorMethod'], 'stored')

    def test_only_quarterly_known_before_basis_and_fresh(self):
        self.assertEqual(E.op_sym(q(10, prior=5, basis='annual'), '2026-11-19')[1], 'not_quarterly')
        self.assertEqual(E.op_sym(q(10, prior=5, rcept='20261119'), '2026-11-19')[1], 'stale_or_future', '접수 당일은 쓰지 않음')
        self.assertEqual(E.op_sym(q(10, prior=5, rcept='20250101'), '2026-11-19')[1], 'stale_or_future')


class Table(unittest.TestCase):
    def test_top_30_percent_is_improved(self):
        funds = {'%06d' % i: {'latest_quarter': q(100 + i, prior=100)} for i in range(10)}
        funds['999999'] = {'latest_quarter': q(10, 150.0)}       # 미확인은 순위에서 빠짐
        t = E.earn_table(funds, '2026-11-19')
        self.assertEqual(len(t), 10)
        self.assertEqual(sorted(c for c, v in t.items() if v['improved']), ['000006', '000007', '000008', '000009'])


class Tracking(unittest.TestCase):
    def test_tag_and_record_earn_rows_separately(self):
        try:
            import shape_scan as S
            import pattern_tracker
        except Exception as error:
            self.skipTest('import failed: %s' % error)
        row = lambda code: {'code': code, 'name': code, 'price': 1000.0, 'patternDetail': {'edgeSignals': [{'key': 'quietLeaderPullback'}]}}
        research = {k: [] for k in S.GROUPS}
        research['leaderPullback'] = [row('000001'), row('000002')]
        funds = {'000001': {'latest_quarter': q(300, prior=100)}, '000002': {'latest_quarter': q(90, prior=100)},
                 '000003': {'latest_quarter': q(100, prior=100)}}
        info = S.tag_earn(({k: [] for k in S.GROUPS}, research), funds, '2026-11-19')
        self.assertEqual((info['status'], info['tagged']), ('ok', 2))
        self.assertTrue(research['leaderPullback'][0]['patternDetail']['earn']['improved'])
        self.assertFalse(research['leaderPullback'][1]['patternDetail']['earn']['improved'])
        conn = sqlite3.connect(':memory:')
        pattern_tracker.ensure_schema(conn)
        conn.execute('CREATE TABLE IF NOT EXISTS daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)')
        snap = {'dataDate': '2026-11-19', 'strategyVersion': 'chart-first-v2', 'groups': {k: [] for k in S.GROUPS}, 'research': research}
        out = S.record_tracks(snap, conn=conn)
        self.assertEqual(out['pattern:edge:quietLeaderPullback'], 2)
        self.assertEqual(out['pattern:edge:' + S.EARN_TRACK], 1)


if __name__ == '__main__':
    unittest.main()
