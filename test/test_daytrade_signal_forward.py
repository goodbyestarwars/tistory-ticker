# -*- coding: utf-8 -*-
"""실시간 신호 전진 검증의 시각 변환·진입 분·청산 순서 규칙 검증 (합성 데이터, 외부 호출 없음)."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scripts', 'research'))
import daytrade_signal_forward_study as S  # noqa: E402


def hhmm(i):
    m = 9 * 60 + i
    return '%02d%02d00' % (m // 60, m % 60)


def day(prices, start=100.0, n=390):
    bars, last = [], start
    for i in range(n):
        o, h, lo, c = prices.get(i, (last, last, last, last))
        bars.append((hhmm(i), float(o), float(h), float(lo), float(c), 100.0))
        last = c
    return bars


class SignalForwardTest(unittest.TestCase):
    def test_utc_to_kst(self):
        self.assertEqual(S.to_kst_hms('2026-10-19T00:05:25.338382+00:00'), '090525')
        self.assertEqual(S.to_kst_hms('2026-10-16T05:18:15+00:00'), '141815')

    def test_entry_is_next_full_minute(self):
        bars = day({})
        self.assertEqual(bars[S.entry_index(bars, '090525')][0], '090600')
        self.assertEqual(bars[S.entry_index(bars, '090500')][0], '090600')

    def test_stop_wins_same_bar_and_gap_fills_at_open(self):
        bars = day({10: (100, 103, 98, 99)})          # 같은 봉에서 익절·손절 모두 닿음 → 손절
        i = 5
        self.assertLess(S.simulate_exit(bars, i, 'X2'), 0)
        gap = day({10: (95, 96, 94, 95)})              # 시가가 손절선 아래로 갭 → 시가에 청산
        self.assertAlmostEqual(S.simulate_exit(gap, 5, 'X1'), 95 / 100 - 1)

    def test_support_stop_uses_only_data_before_entry(self):
        bars = day({3: (100, 100, 97, 98), 12: (101, 101, 99.5, 100)})   # 진입 전 저가 97 → 손절 min(97, 99)=97
        i = 5
        self.assertGreater(S.simulate_exit(bars, i, 'X2'), -0.001)      # 이후 저가 99.5 는 97 위 → 손절 아님
        later = day({3: (100, 100, 97, 98), 12: (101, 101, 96, 96.5)})
        self.assertAlmostEqual(S.simulate_exit(later, i, 'X2'), 97 / 98 - 1)

    def test_takeprofit_and_shape(self):
        bars = day({3: (100, 100, 99, 99.5), 20: (100, 103, 100, 102.6)})
        entry = bars[5][1]                                # 99.5 (분 3 의 종가가 이어짐)
        self.assertAlmostEqual(S.simulate_exit(bars, 5, 'X2'), 0.025)
        self.assertTrue(entry > 0)
        self.assertTrue(S.shape_flag(day({3: (100, 100, 99, 99.5), 4: (99.5, 101, 99.5, 100.5)}), 5))   # 눌렸다가 시가 위 복귀
        self.assertFalse(S.shape_flag(day({3: (100, 100, 99, 99.5)}), 5))                              # 복귀 못 함
        self.assertFalse(S.shape_flag(day({}), 5))


if __name__ == '__main__':
    unittest.main()
