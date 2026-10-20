# -*- coding: utf-8 -*-
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'research'))
import exit_sr_study as sr  # noqa: E402
import exit_strategy_study as xs  # noqa: E402

DAY = '2026-10-19'


def hhmm(i):
    m = 9 * 60 + i
    return '%02d%02d' % (m // 60, m % 60)


def make_path(closes, start=100.0):
    path, prev = [], start
    for i, c in enumerate(closes):
        path.append((DAY, hhmm(i), prev, max(prev, c) * 1.0005, min(prev, c) * 0.9995, c, 1000))
        prev = c
    return path


def entry_for(closes, **extra):
    path = make_path(closes)
    e = {'code': '000000', 'entry_day': DAY, 'days': [DAY], 'path': path, 'prev_lows': {DAY: None}, 'scan_date': '2026-10-16'}
    e.update(extra)
    return e


def run_rule(closes, factory, **ctx):
    c = {'atr_pct': ctx.get('atr_pct'), 'daily_lows': ctx.get('daily_lows', []), 'daily_highs': ctx.get('daily_highs', [])}
    return xs.simulate(entry_for(closes), factory, c)


def drift(start, end, n):
    return [start + (end - start) * (i + 1) / n for i in range(n)]


class FractalTest(unittest.TestCase):
    def test_last_two_bars_never_pivot_and_future_ignored(self):
        daily = [{'date': '2026-10-%02d' % d, 'open': 10, 'high': h, 'low': l, 'close': 10} for d, h, l in
                 [(1, 11, 9), (2, 11, 9), (5, 12, 7), (6, 11, 9), (7, 11, 9), (8, 11, 6), (9, 11, 9)]]
        lows, highs = sr.fractal_levels(daily, '2026-10-09')
        self.assertEqual(lows, [7])                     # 10-08(6)은 우측 2봉이 없어 후보가 아니다
        self.assertEqual(highs, [12])
        self.assertEqual(sr.fractal_levels(daily, '2026-10-07')[0], [7])  # scan_date 이후 자료는 쓰지 않는다


class SupportBreakTest(unittest.TestCase):
    def closes_down(self):
        return [100.0] * 12 + drift(100, 95.5, 10) + [95.5] * 30

    def test_daily_support_break_exits_before_a_stop_and_confirm_matters(self):
        ctx = {'daily_lows': [98.0]}
        a = run_rule(self.closes_down(), lambda p, c: xs.RuleA(p, c))
        b1 = run_rule(self.closes_down(), lambda p, c: sr.SRRule(p, c, 'daily', 'bar1'), **ctx)
        b2 = run_rule(self.closes_down(), lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'), **ctx)
        self.assertEqual(b1['reason'], 'SR_BREAK')
        self.assertGreater(b1['net_pct'], a['net_pct'])          # -3% 전에 지지에서 나감
        self.assertGreaterEqual((b2['exit_day'], b2['exit_hhmm']), (b1['exit_day'], b1['exit_hhmm']))

    def test_hybrid_never_wider_than_minus_three(self):
        ctx = {'daily_lows': [94.0]}                              # 구조선이 -6% (손실 한도보다 아래)
        closes = [100.0] * 12 + drift(100, 94.8, 12) + [94.8] * 30
        b = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'daily', 'bar1'), **ctx)
        c = run_rule(closes, lambda p, c_: sr.SRRule(p, c_, 'daily', 'bar1', hybrid=True), **ctx)
        self.assertGreater(c['net_pct'], b['net_pct'])
        self.assertGreaterEqual(c['gross_pct'], -3.9)            # 슬리피지 포함해도 -3% 근처에서 끝난다

    def test_emergency_stop_kept(self):
        closes = [100.0] * 12 + [93.0] * 20
        r = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'), daily_lows=[80.0])
        self.assertEqual(r['reason'], 'STOP_EMERGENCY')

    def test_no_structure_falls_back_to_a(self):
        closes = [100.0] * 12 + drift(100, 96.0, 10) + [96.0] * 20
        a = run_rule(closes, lambda p, c: xs.RuleA(p, c))
        b = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'))   # 일봉 지지 없음
        self.assertEqual((a['reason'], a['exit_hhmm']), (b['reason'], b['exit_hhmm']))


class RatchetFlipTest(unittest.TestCase):
    def test_rising_swing_low_raises_stop_and_exits_above_minus_three(self):
        # 100 -> 104 눌림 102 -> 107 -> 눌림 105 -> 108 : 5분봉 상승 저점이 확정된 뒤 붕괴
        closes = (drift(100, 104, 20) + drift(104, 102, 20) + drift(102, 107, 20) + drift(107, 105, 20) + drift(105, 108, 20)
                  + [108] * 10 + drift(108, 101, 25) + [101] * 20)
        r = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'swing', 'c5', buf=0.1))
        self.assertEqual(r['reason'], 'SR_BREAK')
        self.assertGreater(r['gross_pct'], -1.0)                 # 고정 -3%였다면 더 늦게 나갔다

    def test_breakout_flips_resistance_to_support(self):
        closes = [100.0] * 5 + drift(100, 104, 15) + [104] * 15 + drift(104, 101, 10) + [101] * 20
        ctx = {'daily_highs': [102.0]}
        r = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'), **ctx)
        self.assertEqual(r['reason'], 'SR_BREAK')                # 102 위에서 돌파 확정 뒤 102 아래로 내려오면 청산
        self.assertGreater(r['gross_pct'], 0.0)

    def test_resistance_alone_never_sells(self):
        closes = [100.0] * 5 + drift(100, 103.5, 15) + [103.5] * 40
        r = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'), daily_highs=[103.0])
        self.assertEqual(r['reason'], 'HORIZON')


class NoLookaheadTest(unittest.TestCase):
    def test_decision_independent_of_future_bars(self):
        closes = [100.0] * 12 + drift(100, 97.5, 10) + [97.5] * 20
        ctx = {'daily_lows': [98.0]}
        full = run_rule(closes, lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'), **ctx)
        cut = run_rule(closes[:full_idx(full) + 3], lambda p, c: sr.SRRule(p, c, 'daily', 'c5x2'), **ctx)
        self.assertEqual((full['reason'], full['exit_hhmm']), (cut['reason'], cut['exit_hhmm']))


def full_idx(trade):
    h = trade['exit_hhmm']
    return int(h[:2]) * 60 + int(h[2:]) - 9 * 60


class ReportTest(unittest.TestCase):
    def test_small_group_is_not_judged_and_unknown_source_is_kept(self):
        sel = [{'scanner': 'pullback'}] * 3 + [{}] * 2
        tr = {'A': [{'net_pct': 1.0}] * 5}
        rep = sr.group_report(tr, sel)
        self.assertIn('표본 부족', rep['pullback']['status'])
        self.assertIn('출처 미확인', rep)

    def test_entry_override_reproduces_actual_fill(self):
        closes = [100.0] * 5 + [101.0] * 30
        e = entry_for(closes, entry_hhmm=hhmm(3), entry_fill_price=100.2)
        r = xs.simulate(e, lambda p, c: xs.RuleA(p, c), {})
        self.assertAlmostEqual(r['entry'], 100.2)


if __name__ == '__main__':
    unittest.main()
