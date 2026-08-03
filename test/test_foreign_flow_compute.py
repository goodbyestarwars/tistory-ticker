# -*- coding: utf-8 -*-
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import foreign_flow_compute as ffc  # noqa: E402


def _row(date, close, foreign_net, inst_net, ind_net, change_pct=0.0):
    return {'date': date, 'close': close, 'change_pct': change_pct,
            'foreign_net': foreign_net, 'inst_net': inst_net, 'ind_net': ind_net}


class NullTolerantAggregationTests(unittest.TestCase):
    """2026-08-03(3차): '당일' 개인 순매매(ind_net)가 신뢰할 수 없어 None으로 넘어올 수
    있다(kiwoom_market._live_investor_row_from 참고) - 집계 함수들이 이를 크래시 없이
    처리하고, 실제 0으로 오인해 잘못된 연속매매를 만들지 않는지 검증한다."""

    def test_rolling_sum_treats_none_as_zero_contribution(self):
        daily = [_row('2026-08-03', 100, 10, 20, None), _row('2026-08-02', 100, 10, 20, -5)]
        self.assertEqual(ffc.rolling_sum(daily, 'ind_net', 2), -5)

    def test_amount_sum_treats_none_as_zero_contribution(self):
        daily = [_row('2026-08-03', 100, 10, 20, None), _row('2026-08-02', 100, 10, 20, -5)]
        self.assertEqual(ffc.amount_sum(daily, 'ind_net', 2), -500)

    def test_streak_returns_flat_when_latest_day_is_none(self):
        daily = [_row('2026-08-03', 100, 10, 20, None), _row('2026-08-02', 100, 10, 20, -5),
                  _row('2026-08-01', 100, 10, 20, -3)]
        self.assertEqual(ffc.streak(daily, 'ind_net'), {'days': 0, 'direction': 'flat'})

    def test_streak_stops_counting_at_none(self):
        daily = [_row('2026-08-03', 100, 10, 20, -1), _row('2026-08-02', 100, 10, 20, None),
                  _row('2026-08-01', 100, 10, 20, -3)]
        self.assertEqual(ffc.streak(daily, 'ind_net'), {'days': 1, 'direction': 'sell'})

    def test_signal_does_not_crash_when_today_is_none(self):
        daily = [_row('2026-08-03', 100, 10, 20, None)] + [
            _row('2026-08-%02d' % d, 100, 10, 20, -1000) for d in range(2, 22)
        ]
        rolling = {'5d': {'ind': ffc.rolling_sum(daily, 'ind_net', 5)},
                   '20d': {'ind': ffc.rolling_sum(daily, 'ind_net', 20)}}
        result = ffc.signal(daily, rolling, 'ind')
        self.assertIn('trend_shift', result)


if __name__ == '__main__':
    unittest.main()
