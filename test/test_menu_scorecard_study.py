# -*- coding: utf-8 -*-
"""검색기 메뉴 성적표 연구 도구 회귀 (2026-11-20). 실행: python -m pytest -q test/test_menu_scorecard_study.py"""
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'research'))


def synth(n, seed):
    rnd, px, out = random.Random(seed), 10000.0, []
    from datetime import date, timedelta
    d = date(2020, 10, 5)
    while len(out) < n:
        if d.weekday() < 5:
            op = px * (1 + rnd.gauss(0, .01))
            cl = op * (1 + rnd.gauss(.001, .025))
            hi, lo = max(op, cl) * (1 + abs(rnd.gauss(0, .01))), min(op, cl) * (1 - abs(rnd.gauss(0, .01)))
            out.append([d.strftime('%Y%m%d'), round(op), round(hi), round(lo), round(cl), rnd.randint(100000, 1000000), 1.0])
            px = cl
        d += timedelta(days=1)
    return out


class ReplayNoFuture(unittest.TestCase):
    def test_signals_up_to_a_date_do_not_change_with_more_future_bars(self):
        tmp = tempfile.mkdtemp()
        try:
            px = synth(420, 3)
            for name, rows in (('full', px), ('cut', px[:330])):
                os.makedirs(os.path.join(tmp, name, 'cache'))
                json.dump({'px': rows}, open(os.path.join(tmp, name, 'cache', '000010.json'), 'w'))
                subprocess.run(['node', os.path.join(ROOT, 'scripts', 'research', 'menu_replay_batch.js'),
                                os.path.join(tmp, name), os.path.join(tmp, name + '.tsv')], check=True, capture_output=True)
            cut_day = px[329][0]
            full = [l for l in open(os.path.join(tmp, 'full.tsv')).read().splitlines()[1:] if l.split('\t')[1] <= cut_day]
            cut = open(os.path.join(tmp, 'cut.tsv')).read().splitlines()[1:]
            self.assertEqual(full, cut)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Scorecard(unittest.TestCase):
    def setUp(self):
        try:
            import menu_scorecard_study as M
        except Exception as error:
            self.skipTest('research deps missing: %s' % error)
        self.M = M

    def test_e20_and_no_reentry(self):
        c = np.linspace(100, 130, 80)
        o = c.copy()
        trades, skipped = self.M.sequential([10, 15, 30, 31, 70], o, c, c, c, c, c, 'E20')
        self.assertEqual([t[0] for t in trades], [10, 31])
        self.assertAlmostEqual(trades[0][1], c[30] / o[11] - 1 - self.M.COST)
        self.assertEqual(skipped, 1, '70은 20일 뒤 자료가 없어 미완료')

    def test_verdict_rules(self):
        cell = lambda ex, pf=1.5, n=200: {'excess': ex, 'pf': pf, 'trades': n}
        V = self.M.verdict
        self.assertEqual(V({'train': cell(.1), 'valid': cell(1.0), 'test': cell(2)}), '살림')
        self.assertEqual(V({'train': cell(-.1), 'valid': cell(1.5), 'test': cell(2)}), '고침')
        self.assertEqual(V({'train': cell(.5), 'valid': cell(1.5, pf=1.1), 'test': cell(2)}), '고침')
        self.assertEqual(V({'train': cell(.5), 'valid': cell(1.5, n=99), 'test': cell(2)}), '고침')
        self.assertEqual(V({'train': cell(-1), 'valid': cell(0), 'test': cell(2)}), '숨김 후보')

    def test_periods(self):
        self.assertEqual([self.M.period_of(d) for d in ('20201231', '20210104', '20240102', '20250701', '20260901')],
                         [None, 'train', 'valid', 'test', None])


if __name__ == '__main__':
    unittest.main()
