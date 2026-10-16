# -*- coding: utf-8 -*-
"""역매공파 112 백테스트 도구(scripts/research/yeokmaegongpa112_backtest.py)의 청산 모사·조건 판정 계약."""

import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('yh112', os.path.join(ROOT, 'scripts', 'research', 'yeokmaegongpa112_backtest.py'))
bt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt)


def bar(d, o, h, l, c, v=100000):
    return ('d%03d' % d, o, h, l, c, v)


def path(*rows):
    """신호일(인덱스 0) 뒤로 rows=(open, high, low, close) 일봉을 붙인다. 신호일은 100원 근처 평평한 봉."""
    bars = [bar(0, 100, 101, 99, 100)]
    for k, (o, h, l, c) in enumerate(rows, 1):
        bars.append(bar(k, o, h, l, c))
    return bars


class SimulateTest(unittest.TestCase):
    def sim(self, rule, *rows, mas=None):
        bars = path(*rows)
        return bt.simulate(bars, 0, rule, mas or {'p112': bt.prefix([b[4] for b in bars])})

    def test_fixed_stop_fills_at_stop_price(self):
        r = self.sim('R1', (100, 101, 99, 100), (100, 100, 96, 97))
        self.assertEqual(r['kind'], 'stop')
        self.assertAlmostEqual(r['ret'], -3.5)
        self.assertAlmostEqual(r['net'], -3.5 - bt.COST_PCT)

    def test_gap_below_stop_exits_at_open(self):
        r = self.sim('R1', (100, 101, 99, 100), (94, 95, 93, 94))
        self.assertAlmostEqual(r['ret'], -6.0)

    def test_target_and_gap_above_target(self):
        r = self.sim('R1', (100, 121, 99, 118))
        self.assertEqual(r['kind'], 'target')
        self.assertAlmostEqual(r['ret'], 20.0)
        r = self.sim('R1', (100, 101, 99, 100), (125, 126, 124, 125))
        self.assertAlmostEqual(r['ret'], 25.0)

    def test_same_day_stop_and_target_prefers_stop(self):
        r = self.sim('R1', (100, 125, 95, 110))
        self.assertEqual(r['kind'], 'stop')

    def test_no_stop_rule_holds_to_time_exit_with_mfe_mae(self):
        rows = [(100, 105, 90, 95)] + [(95, 96, 94, 95)] * (bt.HOLD + 5)
        r = self.sim('R0', *rows)
        self.assertEqual(r['kind'], 'time')
        self.assertEqual(r['held'], bt.HOLD)
        self.assertAlmostEqual(r['mae'], -10.0)
        self.assertAlmostEqual(r['mfe'], 5.0)

    def test_structural_stop_skips_when_too_far(self):
        bars = [bar(i, 100, 101, 80, 100) for i in range(30)]    # 공구리 저점 80
        bars[29] = bar(29, 100, 101, 99, 100)
        bars.append(bar(30, 100, 101, 99, 100))
        self.assertIsNone(bt.simulate(bars, 29, 'R2', {'p112': bt.prefix([b[4] for b in bars])}))   # 손절폭 20% > 8% -> 진입 포기
        bars2 = [bar(i, 100, 101, 97, 100) for i in range(31)]
        r = bt.simulate(bars2, 29, 'R2', {'p112': bt.prefix([b[4] for b in bars2])})
        self.assertAlmostEqual(r['risk'], (100 - 97 * 0.995) / 100 * 100)

    def test_ma112_break_exits_at_close(self):
        bars = [bar(i, 100, 101, 99, 100) for i in range(120)]
        bars.append(bar(120, 100, 100, 95, 96))      # 112일선(약 100)의 97%(97) 아래로 마감
        r = bt.simulate(bars, 118, 'R3', {'p112': bt.prefix([b[4] for b in bars])})
        self.assertEqual(r['kind'], 'break112')
        self.assertAlmostEqual(r['ret'], -4.0)       # 그날 종가 청산, 진입은 신호 다음 날 시가(100)


class ConditionTest(unittest.TestCase):
    def stock(self, with_acc):
        rows = []
        for i in range(520):
            price = 20000 - 12000 * i / 299 if i < 300 else 8000 + max(0, i - 440) * 0.5
            o, c = price, price * 1.001
            rows.append(['d%03d' % i, o, c * 1.004, o * 0.996, c, 100000])
        if with_acc:
            i = 500
            price = rows[i][1]
            rows[i] = ['d500', price, price * 1.05, price * 0.995, price * 1.04, 1_000_000]   # 거래량 10배·몸통 4%·거래대금 80억대
        return [tuple(r) for r in rows]

    def test_accumulation_bar_is_required_for_core_variants(self):
        names = {s[0] for s in bt.scan_stock('000001', self.stock(False), None)}
        self.assertIn('V0', names)
        self.assertNotIn('V2', names)
        sigs = bt.scan_stock('000001', self.stock(True), None)
        names = {s[0] for s in sigs}
        self.assertIn('V2', names)
        v2 = [s for s in sigs if s[0] == 'V2']
        self.assertTrue(all(s[1] >= 500 for s in v2))                     # 매집봉 이후 신호만
        self.assertTrue(all(s[1] - 500 <= bt.ACC_LOOKBACK for s in v2))   # 매집봉 lookback 안

    def test_flags_use_same_bar_rule_as_screener(self):
        rows = [bar(i, 10000, 10050, 9950, 10020) for i in range(40)]
        rows[30] = bar(30, 10000, 10600, 9990, 10500, 400000)
        flags = bt.accumulation_flags(rows, bt.prefix([float(r[5]) for r in rows]))
        self.assertEqual([i for i, f in enumerate(flags) if f], [30])

    def test_stats_arithmetic(self):
        trades = [{'net': -4.2, 'kind': 'stop', 'held': 2, 'mfe': 1.0, 'mae': -4.0, 'risk': 3.5}] * 3 + \
                 [{'net': 19.3, 'kind': 'target', 'held': 10, 'mfe': 20.0, 'mae': -1.0, 'risk': 3.5}]
        s = bt.stats(trades)
        self.assertEqual(s['n'], 4)
        self.assertAlmostEqual(s['expectancy'], round((19.3 - 12.6) / 4, 2))
        self.assertAlmostEqual(s['payoff'], round(19.3 / 4.2, 2))
        self.assertEqual(s['win'], 25.0)
        self.assertEqual(s['targetPct'], 25.0)


if __name__ == '__main__':
    unittest.main()
