# -*- coding: utf-8 -*-
"""exit_plan(운영 매도 기준 계산)과 연구 exit_rule_study.simulate의 결과 대조 + 추적 집계 회귀 (2026-11-20)."""
import os
import random
import sqlite3
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import exit_plan as E  # noqa: E402


def bars_from(o, h, l, c):
    return [dict(date='2026-%03d' % k, open=o[k], high=h[k], low=l[k], close=c[k]) for k in range(len(c))]


def walk(n, seed, drift=0.002):
    rnd = random.Random(seed)
    c, o, h, l = [], [], [], []
    px = 100.0
    for _ in range(n):
        op = px * (1 + rnd.gauss(0, .01))
        cl = op * (1 + rnd.gauss(drift, .03))
        o.append(op); c.append(cl)
        h.append(max(op, cl) * (1 + abs(rnd.gauss(0, .01))))
        l.append(min(op, cl) * (1 - abs(rnd.gauss(0, .01))))
        px = cl
    return o, h, l, c


class MatchesResearch(unittest.TestCase):
    def test_same_result_as_research_simulate(self):
        try:
            import numpy as np
            import pandas as pd
            sys.path.insert(0, os.path.join(ROOT, 'scripts', 'research'))
            import exit_rule_study as R
        except Exception as error:  # 연구 의존성이 없는 환경
            self.skipTest('research deps missing: %s' % error)
        pairs = {'exit-v1': ('S10', 'MA20', 60, 'NO'), 'exit-v2': ('S10', 'MA60', 250, 'NO')}
        checked = 0
        for seed in range(30):
            o, h, l, c = walk(400, seed, drift=.004 if seed % 2 else -.001)
            cs = pd.Series(c)
            m20, m60 = cs.rolling(20).mean().values, cs.rolling(60).mean().values
            arr = [np.array(x) for x in (o, h, l, c)]
            bars = bars_from(o, h, l, c)
            for i in (60, 90, 200):
                for key, rule in pairs.items():
                    ret, days, cens = R.simulate(*arr, np.zeros(len(c)), m20, m60, i, rule)
                    got = E.simulate(bars, i, E.RULES[key])
                    if cens:
                        self.assertEqual(got['status'], 'open')
                        continue
                    self.assertEqual(got['status'], 'closed', (seed, i, key))
                    self.assertAlmostEqual(got['ret'], ret, places=9)
                    self.assertEqual(got['days'], days)
                    checked += 1
        self.assertGreater(checked, 50)


class Rules(unittest.TestCase):
    def test_gap_down_stop_uses_open(self):
        o, h, l, c = [100] * 70, [101] * 70, [99] * 70, [100] * 70
        o[62], h[62], l[62], c[62] = 80, 82, 79, 81
        r = E.simulate(bars_from(o, h, l, c), 60, E.RULES['exit-v2'])
        self.assertEqual(r['reason'], 'stopLoss')
        self.assertAlmostEqual(r['ret'], 80 / 100 - 1 - E.COST)

    def test_ma60_protect_only_after_plus10(self):
        n = 130
        c = [100.0] * 61 + [100 + k for k in range(1, 30)] + [95.0] * (n - 90)
        o = [x for x in c]; h = [x * 1.01 for x in c]; l = [x * .995 for x in c]
        r = E.simulate(bars_from(o, h, l, c), 60, E.RULES['exit-v2'])
        self.assertEqual(r['status'], 'closed')
        self.assertEqual(r['reason'], 'protect')
        v1 = E.simulate(bars_from(o, h, l, c), 60, E.RULES['exit-v1'])
        self.assertLessEqual(v1['days'], r['days'], '20일선 보호가 60일선보다 먼저 판다')

    def test_open_and_no_entry(self):
        o, h, l, c = walk(80, 3)
        b = bars_from(o, h, l, c)
        self.assertEqual(E.simulate(b, 79, E.RULES['exit-v2'])['status'], 'no_entry')
        r = E.simulate(b, 70, dict(E.RULES['exit-v2'], stopLossPct=-99))
        self.assertEqual(r['status'], 'open')

    def test_summarize_skips_reentry_while_holding(self):
        res = [('A', 10, dict(status='closed', ret=.1, days=20)), ('A', 15, dict(status='closed', ret=-.1, days=5)),
               ('A', 40, dict(status='closed', ret=-.05, days=5)), ('B', 12, dict(status='open', ret=.02, days=3)),
               ('B', 30, dict(status='closed', ret=.5, days=3))]
        s = E.summarize(res)
        self.assertEqual((s['closed'], s['open']), (2, 1))
        self.assertEqual(s['pf'], 2.0)
        self.assertEqual(s['openAvgPct'], 2.0)


class TrackSummary(unittest.TestCase):
    def test_reads_tracks_only_and_separates_rules(self):
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE pattern_tracks (scanner TEXT, code TEXT, detected_date TEXT)')
        o, h, l, c = walk(300, 7, drift=.004)
        bars = bars_from(o, h, l, c)
        conn.executemany('INSERT INTO pattern_tracks VALUES (?,?,?)',
                         [('pattern:edge:quietLeaderPullback', '000010', bars[70]['date']),
                          ('pattern:edge:quietLeaderPullback', '000020', '2099-01-01'),
                          ('pattern:shape-v2:pullbackRebreak', '000010', bars[71]['date'])])
        out = E.track_summary(conn, 'pattern:edge:quietLeaderPullback', load_bars=lambda _c, code: bars if code == '000010' else [])
        self.assertEqual(out['signals'], 2)
        self.assertEqual(out['missingBars'], 1)
        self.assertFalse(out['orderAuthorized'])
        self.assertEqual(set(out['rules']), {'exit-v1', 'exit-v2'})
        self.assertEqual(out['current'], 'exit-v2')
        self.assertEqual(sum(out['rules']['exit-v2'][k] for k in ('closed', 'open')), 1)


if __name__ == '__main__':
    unittest.main()
