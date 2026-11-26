# -*- coding: utf-8 -*-
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import closing_bet_formula_study as S  # noqa: E402


class ClosingBetFormulaTest(unittest.TestCase):
    def test_sma_and_dedupe(self):
        self.assertAlmostEqual(S.sma(np.arange(1.0, 11.0), 5)[4], 3.0)
        mask = np.zeros(20, bool)
        mask[[3, 5, 12, 13, 18]] = True
        # 직전 5거래일 안에 원신호가 있으면 건너뛴다(13은 12, 18은 13 때문에 제외)
        self.assertEqual(list(np.flatnonzero(S.dedupe(mask))), [3, 12])

    def test_exit_returns_open_close_and_swing(self):
        n = 30
        c = np.full(n, 100.0)
        o, h, l = c.copy(), c.copy(), c.copy()
        o[1] = 102.0
        c[5] = 107.0
        h[3], l[3] = 111.0, 100.0          # 3일째 +10% 터치, 손절 미터치
        r = S.exit_returns(o, h, l, c)
        self.assertAlmostEqual(r['P1'][0], 0.02)
        self.assertAlmostEqual(r['P2'][0], 0.07)
        self.assertAlmostEqual(r['S'][0], 0.10)

    def test_swing_stop_first_and_gap(self):
        n = 30
        c = np.full(n, 100.0)
        o, h, l = c.copy(), c.copy(), c.copy()
        h[2], l[2] = 111.0, 94.0            # 같은 봉에 둘 다 -> 손절 우선
        self.assertAlmostEqual(S.exit_returns(o, h, l, c)['S'][0], -0.05)
        o2 = c.copy()
        o2[2] = 90.0                        # 갭하락은 시가 체결
        l2 = c.copy()
        l2[2] = 90.0
        self.assertAlmostEqual(S.exit_returns(o2, c.copy(), l2, c)['S'][0], -0.10)

    def test_conditions_formula(self):
        n = 700
        rng = np.random.default_rng(1)
        c = 1000 + np.cumsum(rng.normal(0, 3, n))
        o = c.copy()
        h, l = c * 1.01, c * 0.99
        v = np.full(n, 1e6)
        v[::7] = 5e6                         # 거래량 3배 급증 반복
        cond = S.conditions(o, h, l, c, v)
        self.assertTrue(cond['gate'].sum() > 0)
        self.assertFalse(cond['full'][:S.MIN_BARS].any())
        self.assertTrue((cond['full'] <= cond['gate']).all())
        self.assertTrue((cond['dropA'] >= cond['full']).all())


if __name__ == '__main__':
    unittest.main()
