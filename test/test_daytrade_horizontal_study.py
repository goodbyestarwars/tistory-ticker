# -*- coding: utf-8 -*-
"""수평 지지선 v2 백테스트의 지지선 판정·후보일·E2 복귀 시간 규칙 검증 (합성 데이터, 외부 호출 없음)."""
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scripts', 'research'))
import daytrade_support_horizontal_minute_study as H  # noqa: E402
import daytrade_support_pullback_minute_study as P  # noqa: E402

T = 62   # 후보일 인덱스. t-1 = 61 까지의 일봉만 쓴다.


def series(touch_days, touch_low=100.0, base_low=110.0, last_close=105.0, n=70):
    l = np.full(n, base_low)
    c = np.full(n, base_low + 3.0)
    for d in touch_days:
        l[d] = touch_low
    c[T - 1] = last_close
    return l, c


class SupportTest(unittest.TestCase):
    def test_three_touches_make_a_flat_support(self):
        l, c = series([15, 30, 48])
        hs = H.horizontal_support(l, c, T)
        self.assertIsNotNone(hs)
        self.assertAlmostEqual(hs['S'], 100.0)
        self.assertEqual(hs['touches'], 3)

    def test_two_touches_are_enough_one_is_not(self):
        self.assertIsNotNone(H.horizontal_support(*series([20, 45]), T))
        self.assertIsNone(H.horizontal_support(*series([45]), T))

    def test_touches_closer_than_five_days_count_once(self):
        # 45, 47 은 간격 2일 → 한 번으로 센다(pivot 이 서로 이웃이라 어차피 하나만 남기도 함)
        self.assertIsNone(H.horizontal_support(*series([45, 48]), T))

    def test_falling_lows_are_not_horizontal(self):
        l, c = series([])
        for day, low in ((15, 100.0), (30, 95.0), (48, 90.0)):
            l[day] = low
        c[T - 1] = 95.0
        self.assertIsNone(H.horizontal_support(l, c, T))

    def test_broken_support_is_rejected(self):
        l, c = series([15, 48])
        l[35] = 96.0                      # 60일 안에 S(100) × 0.97 = 97 아래 저점이 있다 → 바닥이 아니다
        self.assertIsNone(H.horizontal_support(l, c, T))
        l[35] = 98.5                      # 꼬리 정도는 허용
        self.assertIsNotNone(H.horizontal_support(l, c, T))

    def test_rising_lows_are_not_a_flat_floor(self):
        l, c = series([15, 48])
        l[30] = 92.0                      # 지지선보다 낮은 저점이 먼저 있었다(상승 채널·계단) → 제외
        self.assertIsNone(H.horizontal_support(l, c, T))

    def test_stale_support_is_rejected(self):
        self.assertIsNone(H.horizontal_support(*series([12, 25]), T))    # 마지막 터치가 20거래일 넘게 전

    def test_price_must_be_near_support(self):
        self.assertIsNone(H.horizontal_support(*series([15, 48], last_close=125.0), T))
        self.assertIsNone(H.horizontal_support(*series([15, 48], last_close=95.0), T))
        self.assertIsNotNone(H.horizontal_support(*series([15, 48], last_close=99.0), T))

    def test_only_data_before_t_is_used(self):
        l, c = series([15, 48])
        base = H.horizontal_support(l, c, T)
        l2, c2 = l.copy(), c.copy()
        l2[T:] = 1.0                      # 후보일 이후를 망가뜨려도 판정은 같다
        c2[T:] = 1.0
        self.assertEqual(base, H.horizontal_support(l2, c2, T))
        l3 = l.copy()
        l3[T - 1] = 1.0                   # t-1 의 저가는 pivot 확정에 못 쓰이지만 무너짐 검사에는 쓰인다
        self.assertIsNone(H.horizontal_support(l3, c, T))


def hhmm(i):
    m = 9 * 60 + i
    return '%02d%02d00' % (m // 60, m % 60)


def day(prices, start=103.0):
    bars, last = [], start
    for i in range(390):
        o, h, lo, c = prices.get(i, (last, last, last, last))
        bars.append((hhmm(i), float(o), float(h), float(lo), float(c), 100.0))
        last = c
    return bars


class ReclaimWindowTest(unittest.TestCase):
    def cand(self, bars):
        return {'code': '000001', 'd': '20260105', 'S': 100.0, 'prev_close': 105.0, 'prev_high': 108.0,
                'day_high': max(b[2] for b in bars), 'day_low': min(b[3] for b in bars), 'day_open': bars[0][1]}

    def test_quick_reclaim_enters_and_slow_one_does_not(self):
        quick = {20: (101, 101, 98, 99), 21: (99, 99, 98.5, 99)}
        quick.update({i: (99, 99, 98.5, 99) for i in range(22, 25)})
        quick.update({25: (99, 101, 99, 101)})
        quick.update({i: (101, 101, 100.5, 101) for i in range(26, 35)})
        bars = day(quick)
        out = P.simulate(bars, self.cand(bars), reclaim_minutes=H.RECLAIM_MIN)
        self.assertIn('E2', out)
        slow = {20: (101, 101, 98, 99)}
        slow.update({i: (99, 99, 98.5, 99) for i in range(21, 60)})
        slow.update({i: (101, 101, 100.5, 101) for i in range(60, 75)})
        bars = day(slow)
        self.assertNotIn('E2', P.simulate(bars, self.cand(bars), reclaim_minutes=H.RECLAIM_MIN))
        self.assertIn('E2', P.simulate(bars, self.cand(bars)))          # 시간 제한이 없으면(v1) 진입한다


class CandidateTest(unittest.TestCase):
    def test_candidate_requires_surge_volume_and_liquidity(self):
        n = 130
        px = []
        for i in range(n):
            px.append(['%08d' % (20240101 + i), 110.0, 113.0, 110.0, 111.0, 30_000_000.0])
        for d in (75, 105):                # 수평 지지: 저가 100, 이웃보다 낮은 pivot
            px[d][3] = 100.0
        px[70][4] = px[69][4] * 1.20      # SURGE: +20% 하루
        px[70][2] = px[70][4] * 1.01
        px[119][5] = 100_000_000.0         # VOLX: 어제(t-1=119) 거래량이 직전 5일 평균의 2배 이상
        for i in range(n):
            if px[i][1] < px[i][3]:
                px[i][1] = px[i][3]
        t = 120
        px[t - 1][4] = 105.0
        got = H.candidates('000001', px)
        self.assertTrue(any(r['d'] == px[t][0] for r in got), got[:2])
        weak = [r[:] for r in px]
        weak[119][5] = 30_000_000.0        # 거래량 조건이 빠지면 후보가 아니다
        self.assertFalse(any(r['d'] == weak[t][0] for r in H.candidates('000001', weak)))


if __name__ == '__main__':
    unittest.main()
