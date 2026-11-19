# -*- coding: utf-8 -*-
"""exit_rule_study 매도 규칙 검사(2026-11-19 7단계)."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import exit_rule_study as E  # noqa: E402


def flat(n=300, p=100.0):
    a = np.full(n, p)
    return a.copy(), a * 1.001, a * 0.999, a.copy()


class ExitRules(unittest.TestCase):
    def args(self, o, h, l, c):
        return o, h, l, c, np.full(len(c), 2.0), np.full(len(c), 90.0), np.full(len(c), 80.0)

    def test_gap_down_sells_at_open(self):
        o, h, l, c = flat()
        o[12], h[12], l[12], c[12] = 80, 81, 79, 80
        r, d, cs = E.simulate(*self.args(o, h, l, c), 10, ('S10', 'MA20', 60, 'NO'))
        self.assertAlmostEqual(r, 80 / 100 - 1 - E.P.COST)
        self.assertEqual(d, 2)

    def test_half_take_profit_then_protect(self):
        o, h, l, c = flat()
        h[13] = 121
        c[15], o[16] = 85, 84  # 20일선 90 아래 -> 다음 시가 84
        r, d, cs = E.simulate(*self.args(o, h, l, c), 10, ('S10', 'MA20', 60, 'HALF'))
        self.assertAlmostEqual(r, 0.5 * 0.2 + 0.5 * (84 / 100 - 1) - E.P.COST)

    def test_future_bars_beyond_exit_do_not_matter(self):
        o, h, l, c = flat()
        a = E.simulate(*self.args(o, h, l, c), 10, ('S7', 'TR15', 60, 'NO'))
        o2, h2, l2, c2 = o.copy(), h.copy(), l.copy(), c.copy()
        c2[100:] = 500  # 보유 60일 뒤 봉 변경
        b = E.simulate(*self.args(o2, h2, l2, c2), 10, ('S7', 'TR15', 60, 'NO'))
        self.assertEqual(a, b)

    def test_censored_when_data_ends(self):
        o, h, l, c = flat(100)
        r, d, cs = E.simulate(*self.args(o, h, l, c), 10, ('S10', 'MA20', 250, 'NO'))
        self.assertTrue(cs)

    def test_mdd(self):
        self.assertAlmostEqual(E.mdd([0.1, -0.05, -0.1, 0.2]), 15.0)


if __name__ == '__main__':
    unittest.main()
