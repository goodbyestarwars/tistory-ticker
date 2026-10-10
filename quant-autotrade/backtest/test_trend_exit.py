# -*- coding: utf-8 -*-
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import trend_exit_study as te  # noqa: E402
import exit_study as ex  # noqa: E402


def bars(closes, opens=None, spread=0.004):
    out = []
    for k, c in enumerate(closes):
        o = opens[k] if opens else (closes[k - 1] if k else c)
        out.append({'date': '2026-01-%02d' % (k + 1) if k < 28 else '2026-02-%02d' % (k - 27), 'open': o, 'high': max(o, c) * (1 + spread), 'low': min(o, c) * (1 - spread), 'close': c})
    return out


def run(daily, strat, limit=None, i=15):
    closes = [d['close'] for d in daily]
    mas = {w: te.sma_list(closes, w) for w in (2, 3, 4, 5, 7, 10, 20)}
    return te.simulate_trend(daily, closes, mas, i, strat, limit)


class TrendExitTests(unittest.TestCase):
    def setUp(self):
        # 0..15 완만한 상승(신호일 i=15), 16~22 상승 지속, 23 종가가 3일선 아래로 이탈, 24 시가에 체결되어야 한다
        self.closes = [100 + k for k in range(16)] + [116, 118, 120, 123, 126, 128, 130] + [121, 119, 118, 117, 116]
        self.daily = bars(self.closes)

    def test_ma3_exits_next_open_not_same_close(self):
        r = run(self.daily, 'ma3')
        self.assertEqual(r['reason'], 'signal')
        sig_day = 23   # 종가 121 < MA3(130,128,121 -> 126.3)
        self.assertEqual(r['exit_k'], sig_day + 1)
        expected = self.daily[sig_day + 1]['open'] * (1 - ex.EXIT_SLIP)
        self.assertAlmostEqual(r['gross'], expected / (self.daily[16]['open'] * (1 + ex.ENTRY_SLIP)) - 1, places=6)
        self.assertNotAlmostEqual(r['gross'], self.daily[sig_day]['close'] / (self.daily[16]['open'] * (1 + ex.ENTRY_SLIP)) - 1, places=3)

    def test_no_fixed_take_profit_holds_big_trend(self):
        up = [100 + 2 * k for k in range(60)]
        r = run(bars(up), 'ma3')
        self.assertEqual(r['reason'], 'end')      # 신호 없이 데이터 끝까지 보유(고정 익절 없음)
        self.assertGreater(r['gross'], 0.5)

    def test_emergency_stop_gap_fills_at_open(self):
        closes = [100 + k for k in range(16)] + [116, 117, 118, 119]
        opens = list(closes)
        opens[18] = 100.0                              # 갭하락 시초가(진입가 ~116 대비 -14%)
        r = run(bars(closes, opens), 'ma5', limit=0.07)
        self.assertEqual(r['reason'], 'emergency')
        self.assertAlmostEqual(r['gross'], 100.0 * (1 - ex.EXIT_SLIP) / (self.daily[16]['open'] * (1 + ex.ENTRY_SLIP)) - 1, delta=0.01)

    def test_armed_variant_ignores_dip_before_first_close_above_ma(self):
        closes = [100 + k for k in range(16)] + [111, 110, 109, 112, 115, 118, 116, 112, 110]
        d = bars(closes)
        plain, armed = run(d, 'ma3'), run(d, 'ma3a')
        self.assertLess(plain['exit_k'], armed['exit_k'])

    def test_dead_cross_and_slope_signals(self):
        d = bars(self.closes)
        dead, slope = run(d, 'dead35'), run(d, 'ma3slope')
        self.assertEqual(dead['reason'], 'signal')
        self.assertEqual(slope['reason'], 'signal')
        self.assertGreaterEqual(slope['exit_k'], 24)

    def test_atr_close_executes_next_open(self):
        closes = [100 + k for k in range(16)] + [116, 118, 120, 123, 126, 128, 130, 110, 108, 107]
        r = run(bars(closes), 'atr_close')
        self.assertEqual(r['reason'], 'signal')

    def test_path_last_value_is_realized_net_return(self):
        r = run(self.daily, 'ma3')
        self.assertAlmostEqual(r['path'][-1], r['net'], places=3)
        self.assertEqual(len(r['path']), r['exit_k'] - 16 + 1)


if __name__ == '__main__':
    unittest.main()
