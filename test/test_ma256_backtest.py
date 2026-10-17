# -*- coding: utf-8 -*-
"""256 기법(5·20·60일선) 백테스트 도구(scripts/research/ma256_backtest.py)의 신호·청산 계약."""

import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('ma256', os.path.join(ROOT, 'scripts', 'research', 'ma256_backtest.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
bt = m.bt


def make_rows(closes, vol=100_000):
    rows = []
    for i, c in enumerate([x * 1000 for x in closes]):   # 원 단위(동전주 1,000원 미만 제외 규칙을 피한다)
        o = closes[i - 1] if i else c
        rows.append(('d%03d' % i, float(o), max(o, c) * 1.002, min(o, c) * 0.998, float(c), float(vol)))
    return rows


def curve():
    """60일선은 높고(100 부근) 20일선은 내려오다 평평해지며, 마지막에 5일선이 20일선을 위로 뚫는 모양."""
    closes = [100.0] * 60
    closes += [100 - 0.8 * k for k in range(1, 26)]       # 하락 파동 -> 80
    closes += [80.0 + (0.3 if k % 2 else -0.3) for k in range(12)]   # 바닥 횡보
    closes += [81.0, 83.0, 85.0, 87.0]                     # 반등: 5일선이 20일선을 상향
    return closes


class SignalTest(unittest.TestCase):
    def test_golden_cross_below_60_is_detected_once(self):
        rows = make_rows(curve())
        sigs = m.signals_for(rows)
        m0 = [s for s in sigs if s[0] == 'M0']
        self.assertEqual(len(m0), 1)
        i = m0[0][1]
        pre = bt.prefix([r[4] for r in rows])
        self.assertLessEqual(bt.sma_at(pre, i - 1, 5), bt.sma_at(pre, i - 1, 20))
        self.assertGreater(bt.sma_at(pre, i, 5), bt.sma_at(pre, i, 20))
        self.assertLess(rows[i][4], bt.sma_at(pre, i, 60))
        self.assertAlmostEqual(m0[0][2]['stop'], bt.sma_at(pre, i, 20))

    def test_illiquid_or_penny_is_skipped(self):
        self.assertEqual([s for s in m.signals_for(make_rows(curve(), vol=10))], [])
        self.assertEqual([s for s in m.signals_for(make_rows([c / 200 for c in curve()]))], [])   # 종가 500원 미만(동전주)


class SimulateTest(unittest.TestCase):
    def rows(self, tail):
        base = [(f'b{i:03d}', 100.0, 101.0, 99.0, 100.0, 1_000_000.0) for i in range(80)]
        return base + [(f't{i:03d}', *r, 1_000_000.0) for i, r in enumerate(tail)]

    def test_stop_at_signal_day_ma20_and_gap(self):
        rows = self.rows([(100, 101, 99, 100), (100, 101, 94, 95)])
        info = {'stop': 97.0}
        pre = bt.prefix([r[4] for r in rows])
        r = m.simulate(rows, 79, info, 'X1', pre)
        self.assertEqual(r['kind'], 'stop')
        self.assertAlmostEqual(r['ret'], -3.0)
        rows = self.rows([(100, 101, 99, 100), (92, 93, 90, 91)])
        r = m.simulate(rows, 79, info, 'X1', bt.prefix([x[4] for x in rows]))
        self.assertAlmostEqual(r['ret'], -8.0)          # 시가가 손절을 넘어 시작 -> 시가 청산

    def test_target_at_60ma_and_risk_band(self):
        rows = self.rows([(100, 101, 99, 100), (100, 100.5, 99.5, 100)] + [(100, 100.5, 99.5, 100)] * 3)
        info = {'stop': 99.9}                            # 손절폭 0.1% < 0.5% -> 진입 포기
        self.assertIsNone(m.simulate(rows, 79, info, 'X1', bt.prefix([x[4] for x in rows])))
        info = {'stop': 150.0}                           # 시가가 손절 아래 -> 진입 포기
        self.assertIsNone(m.simulate(rows, 79, info, 'X1', bt.prefix([x[4] for x in rows])))

    def test_trail_exit_x2_closes_below_ma20(self):
        rows = self.rows([(100, 101, 99, 100), (100, 101, 99.2, 100)] + [(100, 101, 99.2, 99.0)] * 2)
        pre = bt.prefix([x[4] for x in rows])
        r = m.simulate(rows, 79, {'stop': 95.0}, 'X2', pre)
        self.assertIn(r['kind'], ('trail', 'time'))


if __name__ == '__main__':
    unittest.main()
