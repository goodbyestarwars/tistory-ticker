# -*- coding: utf-8 -*-
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import angle_momentum_detect as amd  # noqa: E402


def make_rows(closes, volumes=None):
    rows, d = [], date(2025, 1, 1)
    for i, c in enumerate(closes):
        rows.append({'date': (d + timedelta(days=i)).isoformat(), 'open': c * 0.998, 'high': c * 1.004,
                     'low': c * 0.996, 'close': c, 'volume': (volumes[i] if volumes else 100_000)})
    return rows


def turning_closes(scale=1.0, start_up=1.012):
    """하락·횡보하다가 마지막 며칠 상승 가속 - 이평 기울기가 음수/평탄에서 양수로 꺾이는 모양."""
    closes = []
    price = 10000.0 * scale
    for i in range(40):                 # 완만한 하락
        price *= 0.9985
        closes.append(price)
    for i in range(10):                 # 횡보
        closes.append(price * (1 + 0.0004 * ((-1) ** i)))
    base = closes[-1]
    for k in range(1, 5):               # 마지막 4봉 상승 가속
        base *= (start_up ** k) if k < 3 else start_up ** 2
        closes.append(base)
    return closes


class AngleMomentumDetectTest(unittest.TestCase):
    def setUp(self):
        # 수익률 백테스트로 정한 점수 하한(MIN_SCORE=90)은 아래 별도 테스트에서만 켠다 - 나머지는 모양 판정 자체를 검증한다
        self._min = amd.MIN_SCORE
        amd.MIN_SCORE = 0

    def tearDown(self):
        amd.MIN_SCORE = self._min

    def test_score_floor_filters_low_scores(self):
        amd.MIN_SCORE = 101
        self.assertIsNone(amd.detect_angle_momentum(make_rows(turning_closes())))

    def test_turning_or_burst_when_slopes_bend_up(self):
        detail = amd.detect_angle_momentum(make_rows(turning_closes()))
        self.assertIsNotNone(detail)
        self.assertIn(detail['status'], ('TURNING', 'BURST'))
        self.assertGreater(detail['shortSlopePct'], 0)
        self.assertGreater(detail['shortAccelPct'], 0)
        self.assertGreaterEqual(detail['longAccelPct'], 0)

    def test_slope_is_normalized_so_price_level_does_not_matter(self):
        a = amd.detect_angle_momentum(make_rows(turning_closes(1.0)))
        b = amd.detect_angle_momentum(make_rows(turning_closes(10.0)))
        self.assertEqual(a['status'], b['status'])
        self.assertAlmostEqual(a['shortSlopePct'], b['shortSlopePct'], places=2)
        self.assertEqual(a['score'], b['score'])

    def test_volume_is_not_required(self):
        quiet = amd.detect_angle_momentum(make_rows(turning_closes(), volumes=[100_000] * 54))
        self.assertIsNotNone(quiet)
        loud = amd.detect_angle_momentum(make_rows(turning_closes(), volumes=[100_000] * 53 + [900_000]))
        self.assertIsNotNone(loud)             # 거래량이 늘어도 제외하지 않는다
        self.assertLessEqual(loud['score'], quiet['score'])   # "거래량 과열 전" 가산만 빠진다

    def test_late_explosion_is_excluded(self):
        closes = turning_closes()
        closes[-1] = closes[-2] * 1.15
        self.assertIsNone(amd.detect_angle_momentum(make_rows(closes)))

    def test_flat_series_has_no_signal_and_no_divide_by_zero(self):
        self.assertIsNone(amd.detect_angle_momentum(make_rows([10000.0] * 80)))

    def test_falling_ma_has_no_signal(self):
        self.assertIsNone(amd.detect_angle_momentum(make_rows([10000.0 * (0.997 ** i) for i in range(80)])))

    def test_too_few_bars_returns_none(self):
        self.assertIsNone(amd.detect_angle_momentum(make_rows(turning_closes())[-20:]))

    def test_burst_ratio_uses_median_and_minimum_accel_floor(self):
        detail = amd.detect_angle_momentum(make_rows(turning_closes(start_up=1.03)))
        self.assertIsNotNone(detail)
        self.assertGreaterEqual(detail['burstRatio'], 1.5)
        self.assertEqual(detail['status'], 'BURST')


if __name__ == '__main__':
    unittest.main()
