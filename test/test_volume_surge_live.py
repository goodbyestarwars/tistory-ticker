# -*- coding: utf-8 -*-
"""거래량 돌파 사전포착(2026-10-06): 초기 구간 감지·감지 후 이미 오른 종목 제외 계약."""

import os
import sys
import time
import unittest
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import volume_surge_live as vs  # noqa: E402


def row(code, volume, price, change, name=None):
    return {'code': code, 'name': name or code, 'trade_volume': volume, 'price': price, 'change_rate': change}


class PaceTest(unittest.TestCase):
    def test_pace_uses_three_minute_window(self):
        dq = deque([(0, 100000, 1000), (180, 160000, 1010)])
        pace3, cum, base_price, span = vs.pace_from_samples(dq, 180, 1000000)
        self.assertAlmostEqual(pace3, 0.06)       # 3분에 6만주 = 전일 100만주의 6%
        self.assertAlmostEqual(cum, 0.16)
        self.assertEqual(base_price, 1000)
        self.assertEqual(span, 180)

    def test_too_recent_baseline_gives_no_pace(self):
        dq = deque([(100, 100000, 1000), (180, 160000, 1010)])
        self.assertIsNone(vs.pace_from_samples(dq, 180, 1000000))

    def test_no_new_volume_gives_no_pace(self):
        dq = deque([(0, 100000, 1000), (180, 100000, 1000)])
        self.assertIsNone(vs.pace_from_samples(dq, 180, 1000000))


class QualifyTest(unittest.TestCase):
    def pace(self, p=0.05, cum=0.2, base=1000):
        return (p, cum, base, 180)

    def test_early_surge_qualifies(self):
        self.assertTrue(vs.qualifies(self.pace(), 1.5, 1010))

    def test_already_ran_does_not_qualify(self):
        self.assertFalse(vs.qualifies(self.pace(), 9.0, 1090))

    def test_slow_pace_does_not_qualify(self):
        self.assertFalse(vs.qualifies(self.pace(p=0.01), 1.0, 1000))

    def test_falling_does_not_qualify(self):
        self.assertFalse(vs.qualifies(self.pace(), -3.0, 970))
        self.assertFalse(vs.qualifies(self.pace(base=1000), 1.0, 990))

    def test_cum_already_large_does_not_qualify(self):
        self.assertFalse(vs.qualifies(self.pace(cum=0.9), 1.0, 1000))


class ProcessTest(unittest.TestCase):
    def setUp(self):
        vs._samples.clear()
        vs._prev_cache.clear()
        vs._state.update({'date': '2026-10-06', 'detections': {}, 'updatedAt': None, 'error': None, 'polls': 0})

    def test_detects_then_hides_after_run(self):
        prev = lambda code: (1000000.0, '2026-10-02')
        # 0초: 기준 표본, 180초: 3분에 6만주 늘고 가격은 +1%
        vs.process_rows([row('111111', 100000, 1000, 0.5, '가')], 1000.0, '2026-10-06', prev)
        vs.process_rows([row('111111', 160000, 1010, 1.5, '가')], 1180.0, '2026-10-06', prev)
        payload = vs.get_payload(1181.0)
        self.assertEqual([i['code'] for i in payload['items']], ['111111'])
        item = payload['items'][0]
        self.assertEqual(item['price'], 1010)  # 감지가 = 감지 시점 가격
        self.assertEqual(item['patternDetail']['status'], 'early')
        self.assertTrue(item['patternDetail']['live'])
        # 이후 감지가 대비 +7%까지 오르면 목록에서 빠지고 ranCount로만 센다
        vs.process_rows([row('111111', 200000, 1081, 8.1, '가')], 1210.0, '2026-10-06', prev)
        payload = vs.get_payload(1211.0)
        self.assertEqual(payload['items'], [])
        self.assertEqual(payload['ranCount'], 1)

    def test_expires_after_lifetime(self):
        prev = lambda code: (1000000.0, '2026-10-02')
        vs.process_rows([row('222222', 100000, 1000, 0.5)], 1000.0, '2026-10-06', prev)
        vs.process_rows([row('222222', 160000, 1005, 1.0)], 1180.0, '2026-10-06', prev)
        payload = vs.get_payload(1180.0 + vs.LIFETIME_SEC + 5)
        self.assertEqual(payload['items'], [])
        self.assertEqual(payload['expiredCount'], 1)

    def test_small_prev_volume_is_ignored(self):
        prev = lambda code: (5000.0, '2026-10-02')
        vs.process_rows([row('333333', 100000, 1000, 0.5)], 1000.0, '2026-10-06', prev)
        vs.process_rows([row('333333', 160000, 1010, 1.0)], 1180.0, '2026-10-06', prev)
        self.assertEqual(vs.get_payload(1181.0)['items'], [])


if __name__ == '__main__':
    unittest.main()
