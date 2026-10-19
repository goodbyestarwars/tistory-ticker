# -*- coding: utf-8 -*-
"""급등 직전 패턴 탐색 도구(scripts/research/surge_precursor_study.py)의 계약: 미래 비참조, 레이블 정의, 날짜별 백분위, 기준선, AUC."""

import importlib.util
import os
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('sp', os.path.join(ROOT, 'scripts', 'research', 'surge_precursor_study.py'))
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)


def walk(n, seed=0):
    rng = np.random.default_rng(seed)
    c = 10000 * np.exp(np.cumsum(rng.normal(0, 0.015, n)))
    o = c * (1 + rng.normal(0, 0.004, n))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.006, n)))
    l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.006, n)))
    v = rng.uniform(1e5, 4e5, n)
    return o, h, l, c, v


class FeatureTests(unittest.TestCase):
    def test_features_at_t_do_not_change_when_future_bars_are_removed(self):
        o, h, l, c, v = walk(600)
        mkt = np.zeros(600)
        full, _, _ = sp.features(o, h, l, c, v, mkt)
        for cut in (300, 450):
            part, _, _ = sp.features(o[:cut], h[:cut], l[:cut], c[:cut], v[:cut], mkt[:cut])
            for name, arr in part.items():
                a, b = arr[:cut], full[name][:cut]
                same = np.array_equal(np.nan_to_num(a, nan=-9e9), np.nan_to_num(b, nan=-9e9))
                self.assertTrue(same, '%s cut=%d' % (name, cut))


class LabelTests(unittest.TestCase):
    def setUp(self):
        n = 40
        self.o = np.full(n, 100.0)
        self.h = np.full(n, 101.0)
        self.l = np.full(n, 99.0)
        self.c = np.full(n, 100.0)

    def lab(self, t=10):
        return sp.labels(self.o, self.h, self.l, self.c, np.array([t]))

    def test_surge_uses_next_open_and_next_five_days(self):
        self.h[12] = 116.0
        out = self.lab()
        self.assertEqual(out['S15_5'][0], 1.0)
        self.assertEqual(out['CLEAN15'][0], 1.0)

    def test_surge_on_day_t_itself_is_not_counted(self):
        self.h[10] = 130.0                      # 신호일 자신의 고가는 진입 전 정보
        self.assertEqual(self.lab()['S15_5'][0], 0.0)

    def test_clean_surge_fails_when_stop_comes_first_or_same_day(self):
        self.l[11], self.h[12] = 92.0, 117.0    # -7% 가 먼저
        self.assertEqual(self.lab()['CLEAN15'][0], 0.0)
        self.assertEqual(self.lab()['S15_5'][0], 1.0)
        self.l[11] = 99.0
        self.l[12], self.h[12] = 92.0, 117.0    # 같은 날 둘 다: 실패 처리
        self.assertEqual(self.lab()['CLEAN15'][0], 0.0)

    def test_crash_label_and_window_end(self):
        self.l[13] = 84.0
        self.assertEqual(self.lab()['D15_5'][0], 1.0)
        n = len(self.c)
        self.assertTrue(np.isnan(sp.labels(self.o, self.h, self.l, self.c, np.array([n - 4]))['S15_5'][0]))   # 5일 창이 모자라면 결측


class HelperTests(unittest.TestCase):
    def test_date_percentile_ranks_within_each_date_only(self):
        date = np.array([0] * 30 + [1] * 30)
        x = np.concatenate([np.arange(30), np.arange(30) * 1000.0])
        p = sp.date_percentile(date, x)
        self.assertAlmostEqual(p[0], p[30])                    # 값 크기가 달라도 날짜 안 순위가 같으면 같은 백분위
        self.assertGreater(p[29], 0.95)

    def test_baseline_probability_is_date_and_bucket_mean(self):
        date = np.array([0, 0, 0, 1, 1, 1])
        bucket = np.array([0, 0, 1, 0, 0, 0], dtype=np.int8)
        y = np.array([1.0, 0.0, 1.0, 0.0, 0.0, 1.0])
        base = sp.baseline_prob(date, bucket, y, np.ones(6, dtype=bool))
        self.assertEqual(list(base[:3]), [0.5, 0.5, 1.0])
        self.assertAlmostEqual(base[5], 1 / 3)

    def test_volatility_matched_baseline_splits_further(self):
        date = np.zeros(4, dtype=np.int64)
        bucket = np.zeros(4, dtype=np.int8)
        vb = np.array([0, 0, 1, 1])
        y = np.array([1.0, 1.0, 0.0, 0.0])
        self.assertEqual(list(sp.baseline_prob(date, bucket, y, np.ones(4, dtype=bool), vb)), [1.0, 1.0, 0.0, 0.0])

    def test_auc_perfect_and_random(self):
        y = np.array([0, 0, 0, 1, 1, 1], dtype=float)
        self.assertEqual(sp.auc(np.array([1, 2, 3, 4, 5, 6.0]), y), 1.0)
        self.assertEqual(sp.auc(np.array([6, 5, 4, 3, 2, 1.0]), y), 0.0)


if __name__ == '__main__':
    unittest.main()
