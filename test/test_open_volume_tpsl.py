# -*- coding: utf-8 -*-
"""익절/손절 비교 도구(scripts/research/open_volume_tpsl.py)의 계약: 판정, 미래 비참조, 순위 기반 AUC."""
import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'research'))
spec = importlib.util.spec_from_file_location('tp', os.path.join(ROOT, 'scripts', 'research', 'open_volume_tpsl.py'))
tp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tp)

MINUTES = ['%02d%02d' % (h, m) for h in range(9, 16) for m in range(60) if '0900' <= '%02d%02d' % (h, m) <= '1530']


def bars_from(fn):
    return [[t] + list(fn(i, t)) for i, t in enumerate(MINUTES)]


def flat(i, t):
    return (100.0, 100.1, 99.9, 100.0, 1000.0)


CTX = {'prev_close': 100.0, 'prev_vol': 5000.0, 'pos250': 0.5, 'ret20': 0.0, 'high_zone': False, 'lows_rising': False}


class TouchTests(unittest.TestCase):
    def test_take_profit_and_stop_loss_and_same_bar_is_stop(self):
        up = bars_from(lambda i, t: (100, 105, 99.9, 104, 1000) if i == 12 else flat(i, t))
        self.assertEqual(tp.touch_info(up, 10), ('tp', 2))
        dn = bars_from(lambda i, t: (100, 100.1, 96.5, 97, 1000) if i == 13 else flat(i, t))
        self.assertEqual(tp.touch_info(dn, 10), ('sl', 3))
        both = bars_from(lambda i, t: (100, 105, 96.0, 100, 1000) if i == 11 else flat(i, t))
        self.assertEqual(tp.touch_info(both, 10)[0], 'sl')
        self.assertEqual(tp.touch_info(bars_from(flat), 10), ('none', None))


class FeatureTests(unittest.TestCase):
    def test_pre_features_ignore_bars_after_detection(self):
        a = bars_from(flat)
        b = bars_from(lambda i, t: (50, 500, 1, 400, 9e9) if i > 10 else flat(i, t))
        self.assertEqual(tp.pre_features(a, 10, CTX), tp.pre_features(b, 10, CTX))

    def test_post_features_start_at_entry_bar(self):
        bars = bars_from(lambda i, t: (100, 103, 98, 102, 2000) if i == 11 else flat(i, t))
        f = tp.post_features(bars, 11, 1)
        e = 100 * 1.001
        self.assertAlmostEqual(f['post1_low_vs_entry'], (98 / e - 1) * 100)
        self.assertAlmostEqual(f['post1_close_vs_entry'], (102 / e - 1) * 100)
        self.assertAlmostEqual(f['post1_vol_vs_pre5'], 2.0)

    def test_auc_rank_based(self):
        self.assertEqual(tp.auc([3, 4], [1, 2]), 1.0)
        self.assertEqual(tp.auc([1, 2], [3, 4]), 0.0)
        self.assertEqual(tp.auc([1, 1], [1, 1]), 0.5)
        self.assertIsNone(tp.auc([], [1]))


if __name__ == '__main__':
    unittest.main()
