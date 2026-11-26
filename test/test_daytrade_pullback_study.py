# -*- coding: utf-8 -*-
"""지지선 근처 진입 분봉 백테스트의 후보일·진입·청산·판정 규칙 검증 (합성 데이터, 외부 호출 없음)."""
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scripts', 'research'))
import daytrade_support_pullback_minute_study as P  # noqa: E402
import daytrade_support_breakout_study as D  # noqa: E402


def hhmm(i):
    m = 9 * 60 + i
    return '%02d%02d00' % (m // 60, m % 60)


def day(prices, start=100.0, vol=100.0):
    bars, last = [], start
    for i in range(390):
        if i in prices:
            o, h, l, c = prices[i]
        else:
            o = h = l = c = last
        bars.append((hhmm(i), float(o), float(h), float(l), float(c), vol))
        last = c
    return bars


def cand(S=100.0, bars=None):
    return {'code': '000001', 'd': '20260105', 'S': S, 'prev_close': 105.0, 'prev_high': 108.0,
            'day_high': max(b[2] for b in bars), 'day_low': min(b[3] for b in bars), 'day_open': bars[0][1]}


def random_px(seed, n=330):
    rng = np.random.default_rng(seed)
    c = 100.0
    px = []
    for i in range(n):
        r = rng.normal(0, 0.03) + (0.18 if rng.random() < 0.02 else 0)
        o = c * (1 + rng.normal(0, 0.01))
        c = max(5.0, c * (1 + r))
        h = max(o, c) * (1 + abs(rng.normal(0, 0.01)))
        l = min(o, c) * (1 - abs(rng.normal(0, 0.01)))
        px.append(['%08d' % (20240101 + i), o, h, l, c, float(rng.integers(2_000_000, 40_000_000))])
    return px


class ParityTest(unittest.TestCase):
    def test_candidates_match_daily_study_on_breakout_days(self):
        total = 0
        for seed in range(40):
            px = random_px(seed)
            ours = {c['d']: c for c in P.candidates('000001', px)}
            res = D.per_code('000001', px)
            theirs = set()
            if res:
                for row in res[0]:
                    if row[2] and row[3] and row[4] and row[5]:      # SUP HOLD SURGE VOLX
                        theirs.add(row[1])
            d = [r[0] for r in px]
            o = [r[1] for r in px]
            h = [r[2] for r in px]
            c = [r[4] for r in px]
            last = len(px) - 3
            mine = {dt for t, dt in enumerate(d)
                    if 240 <= t < last and dt in ours and h[t] > h[t - 1] and o[t] < c[t - 1] * 1.15}
            self.assertEqual(mine, theirs, 'seed %s' % seed)
            total += len(theirs)
        self.assertGreater(len(ours), -1)
        self.assertGreater(total, 0, '비교할 후보일이 한 건도 없다 - 합성 입력을 점검')


class SimulateTest(unittest.TestCase):
    def test_e1_limit_fill_after_pullback(self):
        # 시가 106 → 분 30 에서 저가 101(=S*1.01)로 내려옴 → 101 체결, 다음 봉부터 판정
        bars = day({0: (106, 106, 105, 106), 30: (104, 104, 100.5, 102), 31: (102, 108, 102, 107)}, start=106)
        r = P.simulate(bars, cand(100.0, bars))['E1']
        self.assertAlmostEqual(r['entry'], 101.0)
        self.assertEqual(r['entry_t'], hhmm(30))
        self.assertAlmostEqual(r['Y2_struct'], 0.05 - P.COST)   # 102→108: 진입가 101 의 +5%(106.05) 도달

    def test_e1_opens_inside_zone_fills_at_open(self):
        bars = day({0: (100.5, 101.0, 100.2, 100.8)}, start=100.8)
        r = P.simulate(bars, cand(100.0, bars))['E1']
        self.assertAlmostEqual(r['entry'], 100.5)
        self.assertEqual(r['entry_t'], hhmm(0))

    def test_e1_excluded_when_open_below_support(self):
        bars = day({0: (99, 99.5, 98.5, 99)}, start=99)
        self.assertNotIn('E1', P.simulate(bars, cand(100.0, bars)))

    def test_e1_not_filled_if_price_never_comes_down(self):
        bars = day({}, start=110)
        out = P.simulate(bars, cand(100.0, bars))
        self.assertNotIn('E1', out)
        self.assertIn('O', out)

    def test_e2_reclaim_enters_next_open_after_5min_close(self):
        # 분 20 에 저가 98(<S=100), 이후 5분봉(10~15분 뒤) 종가가 S 이상이 되는 첫 봉 완성 뒤 다음 시가에 진입
        prices = {0: (104, 104, 103, 103), 20: (101, 101, 98, 99), 21: (99, 99, 98.5, 99), 22: (99, 99, 98.5, 99),
                  23: (99, 99, 98.5, 99), 24: (99, 99, 98.5, 99),
                  25: (99, 101, 99, 101), 26: (101, 101, 100.5, 101), 27: (101, 101, 100.5, 101),
                  28: (101, 101, 100.5, 101), 29: (101.5, 102, 101, 102), 30: (102, 103, 102, 103)}
        bars = day(prices, start=103)
        r = P.simulate(bars, cand(100.0, bars))['E2']
        self.assertAlmostEqual(r['entry'], 102.0)           # 30번 봉이 아니라 29번 5분봉 마지막 다음 = 30번 봉 시가
        self.assertEqual(r['entry_t'], hhmm(30))

    def test_e2_skips_deep_break(self):
        prices = {0: (104, 104, 103, 103), 20: (101, 101, 90, 91)}   # S*0.97=97 보다 한참 아래
        prices.update({i: (101, 101, 100.5, 101) for i in range(25, 40)})
        bars = day(prices, start=103)
        self.assertNotIn('E2', P.simulate(bars, cand(100.0, bars)))

    def test_structural_stop_below_support(self):
        # 진입 101, 이후 구조 손절선 97(=S*0.97) 아래로 → (97/101-1) 손실
        bars = day({0: (106, 106, 105, 106), 30: (104, 104, 100.5, 102), 31: (102, 102, 96, 97)}, start=106)
        r = P.simulate(bars, cand(100.0, bars))['E1']
        self.assertAlmostEqual(r['Y2_struct'], 97 / 101 - 1 - P.COST)

    def test_baseline_open_entry_and_short_day_mismatch(self):
        bars = day({0: (106, 106, 105, 106)}, start=106)
        self.assertIn('O', P.simulate(bars, cand(100.0, bars)))
        self.assertEqual(P.simulate(bars[:100], cand(100.0, bars))['skip'], 'short_day')
        c = cand(100.0, bars)
        c['day_high'] = 200.0
        self.assertEqual(P.simulate(bars, c)['skip'], 'mismatch')


class StatsTest(unittest.TestCase):
    def test_cluster_ci_widens_when_days_are_correlated(self):
        vals = [0.02] * 20 + [-0.02] * 20
        spread_days = [str(i) for i in range(40)]            # 하루 1건씩
        clustered = ['a'] * 20 + ['b'] * 20                  # 이틀에 몰림
        a = P.cluster_ci(vals, spread_days)
        b = P.cluster_ci(vals, clustered)
        self.assertIsNotNone(a)
        self.assertIsNone(b)                                  # 날짜 5개 미만은 구간을 내지 않는다

    def test_verdict_requires_all_conditions(self):
        def exits(mean, lo, no5, n=150):
            return {'n': n, 'mean': mean, 'clusterCi95': [lo, lo + 2], 'meanNoTop5': no5}
        base = {'n': 500, 'mean': 0.1, 'clusterCi95': [-1, 1], 'meanNoTop5': 0.0}
        summ = {e: {'exits': {'Y1_close': exits(1.0, 0.5, 0.8), 'Y2_struct': exits(1.0, -0.1, 0.8)}}
                for e in ('E1', 'E2')}
        summ['O'] = {'exits': {'Y1_close': base, 'Y2_struct': base}}
        v = P.verdict(summ)
        self.assertEqual(v['E1×Y1_close'], '신호 있음')
        self.assertEqual(v['E1×Y2_struct'], '신호 없음')       # 구간 하한이 0 아래
        summ['E2']['exits']['Y1_close']['n'] = 50
        self.assertEqual(P.verdict(summ)['E2×Y1_close'], '판정 불가')
        summ['E1']['exits']['Y1_close']['mean'] = 0.05          # 기준선(0.1)보다 낮음
        self.assertEqual(P.verdict(summ)['E1×Y1_close'], '신호 없음')


if __name__ == '__main__':
    unittest.main()
