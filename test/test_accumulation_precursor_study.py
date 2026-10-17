# -*- coding: utf-8 -*-
"""매집 선행 징후 연구 도구(scripts/research/accumulation_precursor_study.py)의 신호 정의·미래 비참조 계약."""

import importlib.util
import os
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('apre', os.path.join(ROOT, 'scripts', 'research', 'accumulation_precursor_study.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def flat_series(n=120, price=10000.0, vol=100000.0):
    c = np.full(n, price)
    return c.copy(), c * 1.01, c * 0.99, c.copy(), np.full(n, vol)


class SignalTest(unittest.TestCase):
    def test_volume_compression_s2(self):
        o, h, l, c, v = flat_series()
        v[-5:] = 50000.0                                        # 최근 5일 평균 5만 <= 20일 평균(약 8.75만)의 70%(6.1만)
        flags, _ = m.signals(o, h, l, c, v, np.zeros(len(c)))
        self.assertTrue(flags[1][-1])
        v[-5:] = 90000.0
        flags, _ = m.signals(o, h, l, c, v, np.zeros(len(c)))
        self.assertFalse(flags[1][-1])

    def test_price_stability_s1_needs_narrow_range_and_no_new_low(self):
        o, h, l, c, v = flat_series()
        flags, _ = m.signals(o, h, l, c, v, np.zeros(len(c)))
        self.assertTrue(flags[0][-1])
        l2 = l.copy()
        l2[-3] = 9000.0                                         # 최근 10봉에서 저점 이탈(앞 구간 최저 9,900 아래)
        h2 = h.copy()
        flags, _ = m.signals(o, h2, l2, c, v, np.zeros(len(c)))
        self.assertFalse(flags[0][-1])
        h3 = h.copy()
        h3[-4] = 12500.0                                        # 15봉 범위 > 15%
        flags, _ = m.signals(o, h3, l, c, v, np.zeros(len(c)))
        self.assertFalse(flags[0][-1])

    def test_obv_divergence_s3_flat_price_rising_obv(self):
        n = 120
        c = np.full(n, 10000.0)
        c[-15:] = 10000.0 + np.where(np.arange(15) % 2 == 0, 20.0, -10.0)   # 횡보(변화 +-5% 이내), 오르는 날 위주
        o, h, l = c.copy(), c * 1.005, c * 0.995
        v = np.full(n, 100000.0)
        flags, _ = m.signals(o, h, l, c, v, np.zeros(n))
        self.assertTrue(flags[2][-1])
        c2 = c.copy()
        c2[-15:] = 10000.0 + np.where(np.arange(15) % 2 == 0, -20.0, 10.0)  # 내리는 날 위주면 OBV 하락
        flags, _ = m.signals(o, c2 * 1.005, c2 * 0.995, c2, v, np.zeros(n))
        self.assertFalse(flags[2][-1])

    def test_cmf_s4_needs_nonnegative_and_improving(self):
        n = 120
        c = np.full(n, 10000.0)
        h, l, o = c * 1.01, c * 0.99, c.copy()
        v = np.full(n, 100000.0)
        close_pos = np.linspace(0.40, 0.90, n)                   # 종가가 점점 범위 위쪽 -> CMF 개선·양수
        c = l + (h - l) * close_pos
        flags, aux = m.signals(o, h, l, c, v, np.zeros(n))
        self.assertGreaterEqual(aux['cmf'][-1], 0)
        self.assertTrue(flags[3][-1])
        c2 = l + (h - l) * np.linspace(0.90, 0.40, n)            # 점점 악화
        flags, _ = m.signals(o, h, l, c2, v, np.zeros(n))
        self.assertFalse(flags[3][-1])

    def test_relative_strength_s5_vs_market(self):
        n = 120
        c = np.linspace(10000, 11000, n)
        o, h, l = c.copy(), c * 1.005, c * 0.995
        v = np.full(n, 100000.0)
        flags, _ = m.signals(o, h, l, c, v, np.full(n, 0.01))   # 종목 20일 수익률 약 1.7% > 시장 1%
        self.assertTrue(flags[4][-1])
        flags, _ = m.signals(o, h, l, c, v, np.full(n, 0.05))
        self.assertFalse(flags[4][-1])

    def test_signals_never_use_future_bars(self):
        rng = np.random.default_rng(7)
        n = 200
        c = 10000 * np.cumprod(1 + rng.normal(0, 0.01, n))
        o, h, l = c * (1 + rng.normal(0, 0.003, n)), c * 1.01, c * 0.99
        v = rng.integers(50000, 150000, n).astype(float)
        mk = rng.normal(0, 0.02, n)
        full, _ = m.signals(o, h, l, c, v, mk)
        for cut in (150, 170, 199):
            part, _ = m.signals(o[:cut], h[:cut], l[:cut], c[:cut], v[:cut], mk[:cut])
            self.assertTrue(np.array_equal(full[:, :cut - 1], part[:, :cut - 1]) or np.array_equal(full[:, :cut], part), cut)


class AccumulationBarTest(unittest.TestCase):
    def test_matches_screener_single_bar_rule(self):
        o, h, l, c, v = flat_series(60, 10000.0, 100000.0)
        o[40], h[40], l[40], c[40], v[40] = 10000, 10600, 9990, 10500, 400000
        flags = m.accumulation_bars(o, h, l, c, v)
        self.assertEqual(list(np.where(flags)[0]), [40])
        v2 = v.copy()
        v2[40] = 200000                                          # 2배 < 2.5배
        self.assertFalse(m.accumulation_bars(o, h, l, c, v2).any())


if __name__ == '__main__':
    unittest.main()
