# -*- coding: utf-8 -*-
"""매집봉 MFE/MAE 연구 도구(scripts/research/accumulation_mfe_study.py)의 계약: 목표/손절 선후, 같은 날 손절 우선, 갭 체결, 미래 봉 비참조."""

import importlib.util
import os
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('mfe', os.path.join(ROOT, 'scripts', 'research', 'accumulation_mfe_study.py'))
mfe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mfe)


def window(rows):
    """rows = [(open, high, low)] -> (Hw, Lw, Ow) 한 사건짜리 배열."""
    o = np.array([[r[0] for r in rows]], dtype=float)
    h = np.array([[r[1] for r in rows]], dtype=float)
    l = np.array([[r[2] for r in rows]], dtype=float)
    return h, l, o


class FirstTouchTest(unittest.TestCase):
    e = 100.0

    def run_case(self, rows, ret_h=0.01, tp=0.10, sl=0.05):
        h, l, o = window(rows)
        code, gap, ideal = mfe.first_touch(h, l, o, np.array([self.e]), np.array([ret_h]), tp, sl)
        return int(code[0]), float(gap[0]), float(ideal[0])

    def test_target_first(self):
        code, gap, ideal = self.run_case([(100, 103, 99), (101, 111, 100), (100, 100, 90)])
        self.assertEqual(code, 1)
        self.assertAlmostEqual(gap, 0.10)

    def test_stop_first(self):
        code, gap, ideal = self.run_case([(100, 103, 99), (99, 100, 94), (100, 112, 100)])
        self.assertEqual(code, 2)
        self.assertAlmostEqual(ideal, -0.05)

    def test_same_day_both_counts_as_stop(self):
        code, gap, ideal = self.run_case([(100, 112, 94)])          # 같은 날 +12%·-6%: 선후 불명 -> 손절
        self.assertEqual(code, 2)

    def test_gap_down_fills_at_open_not_stop_price(self):
        code, gap, ideal = self.run_case([(100, 101, 99), (90, 91, 88)])
        self.assertEqual(code, 2)
        self.assertAlmostEqual(gap, -0.10)                           # 손절가 95 아래 시가 90에서 체결
        self.assertAlmostEqual(ideal, -0.05)

    def test_neither_exits_at_period_close(self):
        code, gap, ideal = self.run_case([(100, 104, 98), (100, 105, 97)], ret_h=0.02)
        self.assertEqual(code, 0)
        self.assertAlmostEqual(gap, 0.02)


class WickBarTest(unittest.TestCase):
    def test_boundaries(self):
        n = 40
        o = np.full(n, 100000.0)
        c = np.full(n, 100200.0)
        h = np.full(n, 100500.0)
        l = np.full(n, 99500.0)
        v = np.full(n, 40000.0)
        h[30], c[30], v[30] = 109000.0, 101000.0, 90000.0
        self.assertTrue(mfe.wick_bars(o, h, l, c, v)[30])
        v[30] = 70000.0                                              # 1.75배
        self.assertFalse(mfe.wick_bars(o, h, l, c, v)[30])


class FlowNoLookaheadTest(unittest.TestCase):
    def test_signal_flags_do_not_change_when_later_bars_are_removed(self):
        rng = np.random.default_rng(3)
        n = 300
        c = 10000 * np.exp(np.cumsum(rng.normal(0, 0.012, n)))
        o = c * (1 + rng.normal(0, 0.004, n))
        h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.006, n)))
        l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.006, n)))
        idx = np.array([80, 120, 170])
        full = mfe.flow_signals(o, h, l, c, idx)
        for cut in (150, 200, 250):
            part = mfe.flow_signals(o[:cut], h[:cut], l[:cut], c[:cut], idx[idx < cut - 25])
            for a, b in zip(part[:3], full[:3]):
                self.assertTrue(np.array_equal(a[:cut - 25], b[:cut - 25]))

    def test_rebreakout_after_pullback_is_signalled_on_confirmation_day_only(self):
        n = 120
        c = np.full(n, 10000.0)
        o, h, l = c.copy(), c * 1.002, c * 0.998
        s = 60
        o[s], h[s], l[s], c[s] = 10000.0, 10600.0, 9990.0, 10500.0   # 매집봉
        for k in range(61, 64):                                      # 3% 이상 눌림, 저가는 매집봉 저가 98% 이상 유지
            o[k], h[k], l[k], c[k] = 10200.0, 10250.0, 10150.0, 10150.0
        o[64], h[64], l[64], c[64] = 10200.0, 10800.0, 10180.0, 10700.0   # 매집봉 고점 10600 위 종가
        s2, s1, s3, cls = mfe.flow_signals(o, h, l, c, np.array([s]))
        self.assertEqual(list(np.where(s1)[0]), [64])
        self.assertEqual(list(np.where(s2)[0]), [64])


if __name__ == '__main__':
    unittest.main()
