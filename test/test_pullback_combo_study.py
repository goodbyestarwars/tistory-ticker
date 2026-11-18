# -*- coding: utf-8 -*-
"""pullback_combo_study 미래 비참조 검사(2026-11-19 v1 버그 재발 방지: 과거 수익률을 미래 수익률이 덮어씀)."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import pullback_combo_study as P  # noqa: E402

COLS = ['ma60_slope', 'mom60', 'dip_atr', 'dry10', 'amt20', 'ivol60', 'upvol20', 'upday']


def bars(n=400, seed=3):
    rng = np.random.default_rng(seed)
    c, out = 10000.0, []
    for i in range(n):
        o = c
        c = max(1000.0, c * (1 + rng.normal(0, .02)))
        h, l = max(o, c) * 1.01, min(o, c) * .99
        out.append(['2025%04d' % i, o, h, l, c, float(rng.integers(1e5, 1e6))])
    return out


class LookAhead(unittest.TestCase):
    def test_signal_columns_ignore_future_bars(self):
        px = bars()
        full, cut = P.frame('x', px, {}), P.frame('x', px[:300], {})
        a, b = full.loc[:299, COLS], cut.loc[:299, COLS]
        self.assertTrue(((a == b) | (a.isna() & b.isna())).all().all())

    def test_past_momentum_not_overwritten_by_forward_return(self):
        f = P.frame('x', bars(), {})
        c = np.array([r[4] for r in bars()])
        self.assertAlmostEqual(f.mom60.iat[200], c[200] / c[140] - 1, places=9)
        self.assertNotAlmostEqual(f.mom60.iat[200], f.ret60.iat[200], places=6)


if __name__ == '__main__':
    unittest.main()
