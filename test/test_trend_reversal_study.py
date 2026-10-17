# -*- coding: utf-8 -*-
"""12번 추세전환 연구 도구(scripts/research/trend_reversal_study.py)의 계약: 미래 봉을 쓰지 않는다, 쿨다운, 지지 확인은 실제 경과한 봉만 쓴다."""

import importlib.util
import os
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('trs', os.path.join(ROOT, 'scripts', 'research', 'trend_reversal_study.py'))
trs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trs)


def series(n, seed):
    """하락 → 바닥 횡보 → 상승을 섞은 가짜 일봉(o,h,l,c,v)."""
    rng = np.random.default_rng(seed)
    drift = np.concatenate([np.full(n // 2, -0.004), np.full(n // 4, 0.0), np.full(n - n // 2 - n // 4, 0.006)])
    c = 10000 * np.exp(np.cumsum(drift + rng.normal(0, 0.012, n)))
    o = c * (1 + rng.normal(0, 0.004, n))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.006, n)))
    l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.006, n)))
    v = rng.uniform(1e5, 3e5, n)
    return o, h, l, c, v


class ThinTest(unittest.TestCase):
    def test_cooldown_keeps_first_and_drops_repeats(self):
        flag = np.zeros(60, dtype=bool)
        flag[[5, 8, 25, 30, 50]] = True
        out = trs.thin(flag, cooldown=20)
        self.assertEqual(list(np.where(out)[0]), [5, 25, 50])


class AnyWithinTest(unittest.TestCase):
    def test_window_is_trailing_only(self):
        flag = np.zeros(10, dtype=bool)
        flag[3] = True
        out = trs.any_within(flag, 3)
        self.assertEqual(list(np.where(out)[0]), [3, 4, 5])


class WickBarTest(unittest.TestCase):
    def test_upper_wick_volume_bar(self):
        n = 40
        o = np.full(n, 10000.0)
        c = np.full(n, 10000.0)
        h = np.full(n, 10100.0)
        l = np.full(n, 9900.0)
        v = np.full(n, 400000.0)                       # 거래대금 40억
        h[30], v[30] = 11000.0, 1000000.0               # 긴 윗꼬리 + 2.5배 거래량
        c[30] = 10100.0
        flags = trs.wick_bars(o, h, l, c, v)
        self.assertTrue(flags[30])
        self.assertFalse(flags[29])

    def test_big_body_is_not_wick_type(self):
        n = 40
        o = np.full(n, 10000.0)
        c = np.full(n, 10000.0)
        h = np.full(n, 10100.0)
        l = np.full(n, 9900.0)
        v = np.full(n, 400000.0)
        o[30], c[30], h[30], l[30], v[30] = 10000.0, 10600.0, 10700.0, 9950.0, 1000000.0   # 몸통 6%
        self.assertFalse(trs.wick_bars(o, h, l, c, v)[30])


class NoLookaheadTest(unittest.TestCase):
    def test_flags_do_not_change_when_future_bars_are_removed(self):
        for seed in range(6):
            o, h, l, c, v = series(900, seed)
            full = trs.reversal_flags(o, h, l, c, v)
            for cut in (500, 640, 777):
                part = trs.reversal_flags(o[:cut], h[:cut], l[:cut], c[:cut], v[:cut])
                for name, arr in part.items():
                    self.assertTrue(np.array_equal(arr, full[name][:cut]), '%s seed=%d cut=%d' % (name, seed, cut))

    def test_confirmation_flag_lands_k_bars_after_breakout(self):
        o, h, l, c, v = series(900, 1)
        flags = trs.reversal_flags(o, h, l, c, v)
        for fam in ('T112', 'T224', 'TREC'):
            brk = np.where(flags[fam + '_E0'])[0]
            for k in (3, 5):
                conf = np.where(flags['%s_E%d' % (fam, k)])[0]
                for i in conf:
                    self.assertTrue(any(b + k == i for b in brk), '%s k=%d i=%d' % (fam, k, i))

    def test_confirmation_needs_all_k_bars_supported(self):
        # 112일선 상향 돌파 뒤 둘째 날 종가가 선 아래로 무너지면 3봉 확인이 생기지 않아야 한다
        n = 700
        c = np.concatenate([np.linspace(20000, 9000, 450), np.full(200, 9000.0), np.full(50, 9000.0)])
        o, h, l = c.copy(), c * 1.002, c * 0.998
        v = np.full(n, 3e5)
        c[600] = 12500.0
        o[600], h[600], l[600] = 9100.0, 12600.0, 9000.0
        for i in range(601, 606):
            c[i] = 12400.0
            o[i], h[i], l[i] = 12400.0, 12450.0, 12350.0
        base = trs.reversal_flags(o, h, l, c, v)
        broken_c = c.copy()
        broken_l = l.copy()
        broken_c[602] = 8500.0
        broken_l[602] = 8400.0
        broken = trs.reversal_flags(o, h, broken_l, broken_c, v)
        self.assertEqual(int(broken['T112_E3'][603:700].sum()), 0)
        self.assertGreaterEqual(int(base['T112_E0'].sum()), int(broken['T112_E0'].sum()) - 1)


if __name__ == '__main__':
    unittest.main()
