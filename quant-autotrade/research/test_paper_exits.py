# -*- coding: utf-8 -*-
"""paper_exits 테스트: 백테스트 엔진과의 동일성, 미확정 처리, 절단 일관성(미래 참조·조기 확정 없음)."""
import os
import random
import sys
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paper_exits as pe  # noqa: E402
import trend_exit_study as te  # noqa: E402
import exit_study as ex  # noqa: E402
import krx_calendar  # noqa: E402,F401  (sys.path 에 cloud-vm 추가)
import market_temp  # noqa: E402

_HOLIDAYS = market_temp.KRX_HOLIDAYS_2026


def walk(seed, n=420, drift=0.0004, vol=0.02):
    rnd = random.Random(seed)
    px = 10000.0
    out = []
    day = datetime(2026, 1, 2)   # 거래일에만 봉이 있다(주말·2026 공휴일 건너뜀). 2026 말을 넘기면 평일만 건너뛴다.
    for k in range(n):
        while day.weekday() >= 5 or day.strftime('%Y-%m-%d') in _HOLIDAYS:
            day += timedelta(days=1)
        gap = rnd.gauss(0, 0.004)
        o = px * (1 + gap)
        c = o * (1 + rnd.gauss(drift, vol))
        out.append({'date': day.strftime('%Y-%m-%d'), 'open': o, 'high': max(o, c) * (1 + abs(rnd.gauss(0, 0.006))),
                    'low': min(o, c) * (1 - abs(rnd.gauss(0, 0.006))), 'close': c})
        px = c
        day += timedelta(days=1)
    return out


def backtest(daily, i, variant):
    """백테스트 엔진 결과(net, exit_idx) 또는 None(갭 제외)."""
    if variant == 'trail_atr':
        res = ex.simulate(daily, i, 'trail_atr', 'open')
        return None if res is None else (res[0], res[1])
    closes = [d['close'] for d in daily]
    mas = {w: te.sma_list(closes, w) for w in (2, 3, 4, 5, 7, 10, 20)}
    r = te.simulate_trend(daily, closes, mas, i, variant, None)
    return None if r is None else (r['net'], r['exit_k'])


class EquivalenceTests(unittest.TestCase):
    def test_same_result_as_backtest_engines_on_random_walks(self):
        checked = 0
        for seed in range(25):
            daily = walk(seed)
            for i in (40, 90, 150, 220):
                for variant in pe.VARIANTS:
                    bt = backtest(daily, i, variant)
                    if bt is None:
                        continue
                    r = pe.evaluate(daily, i, variant)
                    if bt[1] >= len(daily) - 1:        # 데이터 끝에서 평가된 백테스트 결과는 미확정과 비교하지 않는다
                        continue
                    self.assertEqual(r['status'], 'CLOSED', (seed, i, variant))
                    self.assertAlmostEqual(r['net_ret'], bt[0], places=9, msg=(seed, i, variant))
                    self.assertEqual(r['exit_date'], daily[bt[1]]['date'], (seed, i, variant))
                    checked += 1
        self.assertGreater(checked, 150)


class NoLookaheadTests(unittest.TestCase):
    def test_truncation_consistency(self):
        """어떤 시점까지의 데이터로 계산하든: 이미 확정(CLOSED)된 결과는 이후 데이터가 늘어도 같고, 확정 전에는 값이 확정으로 나오지 않는다."""
        for seed in range(6):
            daily = walk(100 + seed, n=260, vol=0.025)
            i = 60
            for variant in pe.VARIANTS:
                full = pe.evaluate(daily, i, variant)
                for t in range(i + 1, len(daily) + 1):
                    part = pe.evaluate(daily[:t], i, variant)
                    if part['status'] == 'CLOSED':
                        for key in ('exit_date', 'exit_price', 'net_ret', 'exit_reason', 'entry_price'):
                            self.assertEqual(part[key], full[key], (seed, variant, t, key))
                    elif full['status'] == 'CLOSED':
                        # 부분 데이터에서 미확정이면, 전체 데이터의 청산 봉은 부분 데이터 마지막 봉보다 뒤여야 한다
                        self.assertGreater(full['exit_date'], daily[t - 1]['date'], (seed, variant, t))
                    self.assertIn(part['status'], ('PENDING_ENTRY', 'OPEN', 'PENDING_EXIT', 'CLOSED'))

    def test_signal_on_last_bar_is_pending_until_next_open_exists(self):
        closes = [100 + k for k in range(20)] + [119, 121, 124, 126, 128, 130, 111]   # 마지막 봉에서 급락 종가
        daily = [{'date': '2026-01-%02d' % (k + 1) if k < 31 else '2026-02-%02d' % (k - 30), 'open': closes[k - 1] if k else closes[0], 'close': c,
                  'high': max(closes[k - 1] if k else c, c) * 1.004, 'low': min(closes[k - 1] if k else c, c) * 0.996} for k, c in enumerate(closes)]
        r = pe.evaluate(daily, 17, 'atr_close')
        self.assertEqual(r['status'], 'PENDING_EXIT')
        self.assertIsNone(r['exit_price'])
        self.assertIsNone(r['net_ret'])
        self.assertEqual(r['signal_date'], daily[-1]['date'])
        # 다음 거래일 봉(시가)이 생기면 그 시가에 확정
        daily.append({'date': '2026-02-10', 'open': 108.0, 'high': 110.0, 'low': 105.0, 'close': 107.0})
        r2 = pe.evaluate(daily, 17, 'atr_close')
        self.assertEqual(r2['status'], 'CLOSED')
        self.assertEqual(r2['exit_date'], '2026-02-10')
        self.assertAlmostEqual(r2['exit_price'], 108.0 * (1 - ex.EXIT_SLIP))
        self.assertEqual(r2['exit_reason'], 'SIGNAL_ATR_CLOSE')

    def test_missing_next_bar_means_pending_entry(self):
        daily = walk(7, n=80)
        self.assertEqual(pe.evaluate(daily, len(daily) - 1, 'trail_atr')['status'], 'PENDING_ENTRY')

    def test_dead_cross_never_uses_the_same_close_as_fill(self):
        for seed in range(15):
            daily = walk(300 + seed, n=300)
            r = pe.evaluate(daily, 50, 'dead35')
            if r['status'] == 'CLOSED' and r['exit_reason'] == 'SIGNAL_DEAD35':
                k = next(j for j, b in enumerate(daily) if b['date'] == r['exit_date'])
                self.assertEqual(r['signal_date'], daily[k - 1]['date'])
                self.assertAlmostEqual(r['exit_price'], daily[k]['open'] * (1 - ex.EXIT_SLIP))

    def test_stop_and_trail_lines_are_recorded(self):
        daily = walk(11, n=200)
        r = pe.evaluate(daily, 60, 'atr_close')
        self.assertLess(r['stop_price'], r['entry_price'])
        self.assertGreaterEqual(r['trail_price'], r['stop_price'])
        self.assertIsNone(pe.evaluate(daily, 60, 'dead35')['stop_price'])   # 데드크로스는 가격 손절선이 없다


if __name__ == '__main__':
    unittest.main()
