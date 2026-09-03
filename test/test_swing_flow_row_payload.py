# -*- coding: utf-8 -*-
"""종목분석 첫 응답(investSignal)의 flowGroups 행 계약을 고정한다.

2026-09-03 실측: GAS `?investSignal=1` 응답 3,059,312B 중 swingScan.flowGroups가
2,194,387B(93.1%)였고, 3,094종목 × 행당 709B였다. 그중 transitions 272B는
js/foreign-flow.js가 한 번도 읽지 않고(normalizeFlowRow가 담기만 함), signal·shortSignal
146B는 객체를 통째로 보내면서 실제로 쓰는 건 .label 문자열 하나뿐이었다.
행을 다시 살찌우면 같은 문제가 재발하므로 여기서 막는다.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import daily_scan


DAILY = [{'date': '2026-09-0%d' % (i + 1), 'close': 1000 + i, 'volume': 10000 + i,
          'change_pct': 0.5} for i in range(9)]
STOCK = {'code': '000001', 'name': '테스트'}


def assessment(short_key='none', short_label='이벤트 없음', small_event=None):
    return {
        'chartRegime': {'currentRegime': {'label': '상승 추세'}},
        'recentEvent': {'label': '국면 이벤트'},
        'waves': {
            'big': {'label': '대'}, 'mid': {'label': '중'},
            'small': dict({'label': '소'}, **({'event': small_event} if small_event else {})),
            'shortSignal': {'key': short_key, 'label': short_label, 'stage': 'confirmed'},
            'transitions': {'short': {'active': True}, 'mid': {'active': False}},
        },
        'risk': {'state': '보통', 'flags': []},
    }


class SwingFlowRowPayloadTests(unittest.TestCase):

    def test_row_drops_fields_the_ui_never_reads(self):
        row = daily_scan.build_swing_flow_row(STOCK, DAILY, assessment())
        self.assertNotIn('transitions', row)
        self.assertNotIn('shortSignal', row)

    def test_signal_keeps_only_the_label_the_list_prints(self):
        row = daily_scan.build_swing_flow_row(STOCK, DAILY, assessment())
        self.assertEqual(row['signal'], {'label': '국면 이벤트'})

    def test_short_signal_wins_over_the_regime_event(self):
        row = daily_scan.build_swing_flow_row(
            STOCK, DAILY, assessment(short_key='ma5_recovery', short_label='5일선 회복'))
        # js/foreign-flow.js normalizeFlowRow와 같은 우선순위여야 화면이 그대로 유지된다.
        self.assertEqual(row['signal'], {'label': '5일선 회복'})

    def test_small_wave_event_is_used_before_the_regime_event(self):
        row = daily_scan.build_swing_flow_row(
            STOCK, DAILY, assessment(small_event={'label': '소파동 이벤트'}))
        self.assertEqual(row['signal'], {'label': '소파동 이벤트'})

    def test_volume_average_is_rounded(self):
        row = daily_scan.build_swing_flow_row(STOCK, DAILY, assessment())
        self.assertEqual(row['volumeAvg20'], round(sum(r['volume'] for r in DAILY) / len(DAILY)))

    def test_fields_the_list_renders_are_still_present(self):
        row = daily_scan.build_swing_flow_row(STOCK, DAILY, assessment())
        for key in ('code', 'name', 'price', 'changeRate', 'tradingValue', 'volume',
                    'volumeAvg20', 'bigWave', 'midWave', 'smallWave', 'signal',
                    'currentLocation', 'risk', 'asOf'):
            self.assertIn(key, row)


if __name__ == '__main__':
    unittest.main()
