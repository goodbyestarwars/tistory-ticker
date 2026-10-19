# -*- coding: utf-8 -*-
"""시초 거래량 돌파·흡수·분배 연구 도구(scripts/research/open_volume_study.py)의 계약: 감지 시각, 미래 비참조, 플래그, 후속 성과, 기준선."""

import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('ov', os.path.join(ROOT, 'scripts', 'research', 'open_volume_study.py'))
ov = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ov)

MINUTES = ['%02d%02d' % (h, m) for h in range(9, 16) for m in range(60) if '0900' <= '%02d%02d' % (h, m) <= '1530']


def bars_from(fn):
    """fn(i, hhmm) -> (o, h, l, c, v)"""
    return [[hhmm] + list(fn(i, hhmm)) for i, hhmm in enumerate(MINUTES)]


def flat(price=100.0, vol=1000.0):
    return lambda i, t: (price, price + 0.1, price - 0.1, price, vol)


class CrossTests(unittest.TestCase):
    def test_first_cross_confirms_at_end_of_the_crossing_minute(self):
        bars = bars_from(flat(vol=1000.0))
        c = ov.first_cross(bars, prev_vol=10000.0, level=1.0)           # 누적 1,000 x 10봉 = 10,000 -> 09:09 봉에서 충족
        self.assertEqual(c, (9, '0910'))
        self.assertEqual(ov.first_cross(bars, prev_vol=10000.0, level=0.5), (4, '0905'))

    def test_no_event_after_0930_and_levels_are_monotone(self):
        bars = bars_from(flat(vol=1000.0))
        self.assertIsNone(ov.first_cross(bars, prev_vol=40000.0, level=1.0))     # 09:30까지 30,000 < 40,000
        a, b = ov.first_cross(bars, 10000.0, 0.3), ov.first_cross(bars, 10000.0, 1.0)
        self.assertLess(a[0], b[0])

    def test_cross_ignores_bars_from_0930_on(self):
        def fn(i, t):
            return (100, 100.1, 99.9, 100, 100000.0 if t == '0930' else 100.0)
        self.assertIsNone(ov.first_cross(bars_from(fn), 50000.0, 1.0))


def ctx(**kw):
    base = {'lows_rising': False, 'prev_high': 105.0, 'high_zone': False}
    base.update(kw)
    return base


class FlagTests(unittest.TestCase):
    def morning(self, fn):
        return [b for b in bars_from(fn) if b[0] < '0930']

    def test_absorption_pattern_rising_lows_above_vwap_closing_near_high(self):
        def fn(i, t):
            p = 100 + i * 0.05                                         # 꾸준히 오르는 저점·종가
            return (p, p + 0.05, p - 0.05, p + 0.03, 1000.0)
        f = ov.flags(self.morning(fn), ctx())
        self.assertTrue(f['A2_intraday_higher_lows'])
        self.assertTrue(f['A3_above_open_vwap'])
        self.assertTrue(f['A4_close_near_high'])
        self.assertTrue(f['ABSORB'])
        self.assertFalse(f['DISTRIB'])

    def test_distribution_pattern_spike_then_giveback_with_long_upper_wick(self):
        def fn(i, t):
            if i < 8:
                p = 100 + i * 1.0                                      # 급등(고점 108 근처)
                return (p, p + 0.5, p - 0.2, p + 0.4, 5000.0)
            p = 108 - (i - 8) * 0.4                                    # 상승분 반납
            return (p, p + 0.1, p - 0.3, p - 0.2, 1500.0)
        f = ov.flags(self.morning(fn), ctx())
        self.assertTrue(f['D1_drop_from_high'])
        self.assertTrue(f['D3_giveback_half'])
        self.assertTrue(f['D4_below_vwap'])
        self.assertTrue(f['DISTRIB'])
        self.assertFalse(f['ABSORB'])

    def test_flags_use_only_bars_before_0930(self):
        def fn(i, t):
            p = 100 + i * 0.05
            return (p, p + 0.05, p - 0.05, p + 0.03, 1000.0)
        full = bars_from(fn)
        spoiled = [b[:] for b in full]
        for b in spoiled:
            if b[0] >= '0930':
                b[1:5] = [50.0, 50.0, 50.0, 50.0]                      # 09:30 이후를 무너뜨려도 판정은 같다
        self.assertEqual(ov.flags(full, ctx()), ov.flags(spoiled, ctx()))

    def test_too_few_early_bars_gives_no_flags(self):
        self.assertIsNone(ov.flags([b for b in bars_from(flat()) if b[0] < '0920'], ctx()))

    def test_daily_context_flags_are_kept_separate(self):
        f = ov.flags([b for b in bars_from(flat()) if b[0] < '0930'], ctx(lows_rising=True, high_zone=True))
        self.assertTrue(f['A1_prior_lows_rising'])
        self.assertTrue(f['P_high_zone'])                              # 위치 정보는 봉 모양 플래그와 따로 유지


class ForwardTests(unittest.TestCase):
    D = {'idx': 5}

    def daily(self):
        return [['d%d' % i, 100, 101, 99, 100.0 + i, 1000] for i in range(30)]

    def test_entry_is_next_bar_open_with_slippage_and_horizons(self):
        def fn(i, t):
            return (100.0 + i * 0.01, 100.2 + i * 0.01, 99.9 + i * 0.01, 100.0 + i * 0.01, 1000.0)
        bars = bars_from(fn)
        out = ov.forward(bars, 30, self.daily(), self.D)
        self.assertAlmostEqual(out['entry'], bars[30][1] * 1.001, places=6)
        expected_30 = (bars[59][4] * (1 - 0.0015) / out['entry'] - 1) * 100
        self.assertAlmostEqual(out['m30'], expected_30, places=6)
        self.assertIn('d5', out)

    def test_first_touch_same_bar_counts_as_stop(self):
        bars = bars_from(flat())
        bars[40][2], bars[40][3] = 110.0, 90.0                          # 같은 봉에 +10%·-10%
        self.assertEqual(ov.forward(bars, 30, self.daily(), self.D)['first'], 'sl')
        bars2 = bars_from(flat())
        bars2[40][2] = 105.0
        self.assertEqual(ov.forward(bars2, 30, self.daily(), self.D)['first'], 'tp')

    def test_rule_a_same_day_exits_on_two_stop_checks_at_next_open(self):
        def fn(i, t):
            return (97.0, 97.1, 96.9, 97.0, 1000.0) if t >= '1000' else (100.0, 100.1, 99.9, 100.0, 1000.0)
        bars = bars_from(fn)
        entry_i = 30
        r = ov.a_same_day(bars, entry_i)
        self.assertAlmostEqual(r, (97.0 * (1 - 0.0015) / (100.0 * 1.001) - 1) * 100, places=4)


class ExcessTests(unittest.TestCase):
    def test_excess_is_event_minus_same_day_baseline(self):
        rows = [{'day': 'd%d' % i, 'm60': 3.0 + 0.7} for i in range(8)]          # net 3.0
        base = {'d%d' % i: {'m60': 1.0} for i in range(8)}
        e = ov.excess(rows, base, 'm60')
        self.assertAlmostEqual(e['mean'], 2.0, places=6)
        self.assertEqual(e['days'], 8)

    def test_net_subtracts_round_trip_cost(self):
        self.assertAlmostEqual(ov.net(2.0), 2.0 - ov.COST_PCT)
        self.assertIsNone(ov.net(None))


class StrataAndSelectionTests(unittest.TestCase):
    def setUp(self):
        import json
        import tempfile
        self.json = json
        self.tmp = tempfile.mkdtemp()
        self.bars_dir = os.path.join(self.tmp, 'bars')
        self.cache = os.path.join(self.tmp, 'cache')
        os.makedirs(self.bars_dir)
        os.makedirs(self.cache)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def daily_rows(self, last_day_volume, n=300):
        rows = [['2025-%03d' % i, 100, 101, 99, 100.0, 100000] for i in range(n)]
        rows.append(['2026-10-12', 100, 101, 99, 100.0, last_day_volume])
        rows.append(['2026-10-13', 100, 101, 99, 100.0, last_day_volume])
        return rows

    def put(self, code, day, early_vol, late_vol, day_volume_in_daily):
        """분봉: 09:00~09:29 에 early_vol 씩, 이후 late_vol 씩. 일봉 거래량은 따로 줄 수 있다."""
        bars = bars_from(lambda i, t: (100.0, 100.1, 99.9, 100.0, early_vol if t < '0930' else late_vol))
        self.json.dump({'code': code, 'day': day, 'bars': bars}, open(os.path.join(self.bars_dir, '%s_%s.json' % (code, day)), 'w'))
        rows = self.daily_rows(100000)
        rows[-1][5] = day_volume_in_daily
        rows[-1][0] = day
        rows[-2][0] = '2026-10-09'
        self.json.dump(rows, open(os.path.join(self.cache, code + '.json'), 'w'))
        return sum(b[5] for b in bars)

    def test_stratum_bounds(self):
        self.assertEqual([ov.stratum(x) for x in (0.1, 0.3, 0.49, 0.5, 0.99, 1.0, 1.49, 1.5, 1.99, 2.0)], ['S0', 'S1', 'S1', 'S2', 'S2', 'S3', 'S3', 'S4', 'S4', 'S5'])

    def test_signal_and_flags_do_not_depend_on_the_final_volume_used_for_sampling(self):
        # 같은 09:00~09:29 분봉에 최종 거래량(일봉)만 다르게 - 층은 달라도 감지·플래그는 같다
        total_a = self.put('000001', '2026-10-13', 4000.0, 100.0, 1)
        total_b = self.put('000002', '2026-10-13', 4000.0, 100.0, 1)
        rows = self.json.load(open(os.path.join(self.cache, '000001.json')))
        rows[-1][5] = int(total_a)                       # 최종 거래량 = 분봉 합계(품질 통과)
        self.json.dump(rows, open(os.path.join(self.cache, '000001.json'), 'w'))
        rows = self.json.load(open(os.path.join(self.cache, '000002.json')))
        rows[-1][5] = int(total_b)
        rows[-2][5] = 100000
        self.json.dump(rows, open(os.path.join(self.cache, '000002.json'), 'w'))
        recs, n_cell, dropped = ov.load_records(self.bars_dir, self.cache, {})
        a = next(r for r in recs if r['code'] == '000001')
        b = next(r for r in recs if r['code'] == '000002')
        self.assertEqual(a['cross'].keys(), b['cross'].keys())
        self.assertEqual(a['fl'], b['fl'])

    def test_quality_filter_drops_days_whose_minute_volume_disagrees_with_daily(self):
        self.put('000003', '2026-10-13', 1000.0, 100.0, 5)       # 일봉 거래량이 분봉 합계와 크게 어긋남
        recs, n_cell, dropped = ov.load_records(self.bars_dir, self.cache, {})
        self.assertEqual((len(recs), dropped), (0, 1))

    def test_weights_are_population_over_collected_per_day_and_stratum(self):
        total = self.put('000004', '2026-10-13', 1000.0, 100.0, 1)
        rows = self.json.load(open(os.path.join(self.cache, '000004.json')))
        rows[-1][5] = int(total)
        self.json.dump(rows, open(os.path.join(self.cache, '000004.json'), 'w'))
        ratio = total / 100000
        st = ov.stratum(ratio)
        recs, n_cell, dropped = ov.load_records(self.bars_dir, self.cache, {'2026-10-13': {st: 50}})
        self.assertEqual(len(recs), 1)
        self.assertAlmostEqual(recs[0]['w'], 50.0)               # 모집단 50칸 중 1개를 받음 -> 가중치 50

    def test_weighted_mean_ignores_missing_values(self):
        self.assertAlmostEqual(ov.wmean([(1.0, 1.0), (3.0, 3.0), (None, 10.0)]), 2.5)
        self.assertIsNone(ov.wmean([(None, 1.0)]))


if __name__ == '__main__':
    unittest.main()
