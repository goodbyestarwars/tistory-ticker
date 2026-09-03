# -*- coding: utf-8 -*-
"""/flow-chart 라우트 - gas ?action=flowChart 이관분.

응답 형태({code, daily, ma, levels})가 gas getFlowChart와 같아야 프론트가 두 경로를
같은 렌더 함수로 그릴 수 있다.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))

import pattern_detect  # noqa: E402

# main.py는 fastapi/anyio가 깔린 환경(VM·CI)에서만 임포트된다. 개발 컨테이너에는 없어서
# 상수 검증만 건너뛰고 계산부 테스트는 그대로 돈다 - 임포트 실패를 통과로 위장하지 않고
# skip으로 드러낸다.
try:
    from main import FLOW_CHART_DISPLAY_DAYS
except Exception:  # pragma: no cover - 의존성 없는 환경
    FLOW_CHART_DISPLAY_DAYS = None


def _bars(n):
    """MA224까지 채워지도록 넉넉한 일봉을 만든다. 값은 재현 가능하게 결정적으로."""
    out = []
    for i in range(n):
        close = 10000 + (i % 37) * 55 - (i % 11) * 30
        out.append({
            'date': '2025%04d' % (i + 1),
            'open': close - 20, 'high': close + 80, 'low': close - 90,
            'close': close, 'volume': 100000 + i,
        })
    return out


class FlowChartComputationTests(unittest.TestCase):
    """라우트가 쓰는 계산부(pattern_detect)가 gas와 같은 규약을 지키는지."""

    def test_moving_average_leaves_none_before_period(self):
        daily = _bars(300)
        ma = pattern_detect.moving_average(daily, 'close', 224)
        # gas movingAverage_와 동일: period-1 이전 구간은 null
        self.assertTrue(all(v is None for v in ma[:223]))
        self.assertIsNotNone(ma[223])
        self.assertAlmostEqual(
            ma[223], sum(b['close'] for b in daily[:224]) / 224.0, places=9)

    def test_support_is_below_and_resistance_above_last_close(self):
        daily = _bars(300)
        levels = pattern_detect.compute_support_resistance(daily)
        last_close = daily[-1]['close']
        for v in levels['support']:
            self.assertLess(v, last_close)
        for v in levels['resistance']:
            self.assertGreater(v, last_close)
        # gas와 동일하게 각 최대 2개
        self.assertLessEqual(len(levels['support']), 2)
        self.assertLessEqual(len(levels['resistance']), 2)

    @unittest.skipIf(FLOW_CHART_DISPLAY_DAYS is None, 'main.py 임포트 불가(fastapi 미설치)')
    def test_display_window_trims_to_last_500_and_keeps_ma_aligned(self):
        """라우트의 tail 슬라이싱 규약: daily와 ma가 같은 길이로 잘려야 선이 어긋나지 않는다."""
        daily = _bars(620)
        ma224 = pattern_detect.moving_average(daily, 'close', 224)
        start = max(0, len(daily) - FLOW_CHART_DISPLAY_DAYS)
        self.assertEqual(FLOW_CHART_DISPLAY_DAYS, 500)  # gas FLOW_CHART_DISPLAY_DAYS와 동일해야 한다
        self.assertEqual(len(daily[start:]), FLOW_CHART_DISPLAY_DAYS)
        self.assertEqual(len(ma224[start:]), len(daily[start:]))
        # 620봉을 500봉 창으로 자르면 MA224는 창 앞부분이 비어 있다(224봉을 모으기
        # 전 구간). gas가 이관 전부터 감수하기로 한 트레이드오프와 같다 - getFlowChart
        # 주석: "MA224는 데이터가 있는 구간에서만 그려지고 그 이전은 비어 보일 수 있음".
        shown = ma224[start:]
        self.assertIsNone(shown[0])
        self.assertIsNotNone(shown[-1])
        self.assertEqual(sum(1 for v in shown if v is not None), len(daily) - 223)

    @unittest.skipIf(FLOW_CHART_DISPLAY_DAYS is None, 'main.py 임포트 불가(fastapi 미설치)')
    def test_short_history_still_aligns_but_ma224_is_sparse(self):
        """daily_prices 폴백(260봉)일 때도 길이는 맞고 MA224만 앞부분이 빈다."""
        daily = _bars(260)
        ma224 = pattern_detect.moving_average(daily, 'close', 224)
        start = max(0, len(daily) - FLOW_CHART_DISPLAY_DAYS)
        self.assertEqual(start, 0)
        self.assertEqual(len(ma224[start:]), len(daily))
        self.assertIsNone(ma224[0])
        self.assertIsNotNone(ma224[-1])


if __name__ == '__main__':
    unittest.main()
