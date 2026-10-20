# -*- coding: utf-8 -*-
"""이동평균 배열 추세 상태(js/chart-core.js trendStates·trendMarkers·trendSummary·trendLegendHtml)의 정의 계약. 주가 예측이 아니라 추세 표시."""
import json
import os
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_cli(closes):
    bars = [{'date': 'd%04d' % i, 'open': c, 'high': c * 1.01, 'low': c * 0.99, 'close': c, 'volume': 1000} for i, c in enumerate(closes)]
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(bars, f)
        path = f.name
    try:
        out = subprocess.run(['node', os.path.join(ROOT, 'test', 'trend_cli.js'), path], capture_output=True, text=True, check=True, encoding='utf-8')
    finally:
        os.unlink(path)
    return json.loads(out.stdout)


class TrendStateTest(unittest.TestCase):
    def test_steady_decline_is_long_reverse_and_short_reverse(self):
        res = run_cli([1000 - i for i in range(300)])                # 계속 하락: MA20<MA60<MA120<MA224, MA5<MA10<MA20
        self.assertEqual(res['last'], {'long': 'reverse', 'short': 'reverse'})
        self.assertLess(res['summary']['drawdown'], -20)

    def test_steady_rise_is_long_forward_and_short_forward(self):
        res = run_cli([100 + i for i in range(300)])
        self.assertEqual(res['last'], {'long': 'forward', 'short': 'forward'})
        self.assertAlmostEqual(res['summary']['drawdown'], (399 / (399 * 1.01) - 1) * 100, places=4)

    def test_decline_then_bounce_is_long_reverse_short_forward(self):
        closes = [1000 - 2 * i for i in range(280)] + [440 + 3 * k for k in range(1, 21)]      # 긴 하락 뒤 20봉 반등
        res = run_cli(closes)
        self.assertEqual(res['last']['long'], 'reverse')
        self.assertEqual(res['last']['short'], 'forward')

    def test_not_enough_bars_gives_null_long_state(self):
        res = run_cli([100 + (i % 3) for i in range(100)])
        self.assertIsNone(res['last']['long'])
        self.assertIn('장기 데이터 부족', res['legend'])

    def test_transition_markers_fire_once_after_three_bars_and_use_requested_colors(self):
        closes = [1000 - 2 * i for i in range(280)] + [440 + 3 * k for k in range(1, 21)]
        res = run_cli(closes)
        by_text = {}
        for time, text, color, pos in res['markers']:
            by_text.setdefault(text, []).append((time, color, pos))
        self.assertEqual(len(by_text['장기 역배열']), 1)                      # 하락 내내 한 번만(상태 유지 중 반복 안 함)
        self.assertEqual(by_text['장기 역배열'][0][1:], ('#2563eb', 'aboveBar'))
        for _, color, pos in by_text['단기 정배열']:
            self.assertEqual((color, pos), ('#dc2626', 'belowBar'))
        self.assertGreaterEqual(len(by_text['단기 정배열']), 1)

    def test_markers_use_only_bars_through_the_marker_date(self):
        a = [1000 - 2 * i for i in range(280)] + [440 + 3 * k for k in range(1, 21)]
        b = a[:290] + [1] * 10                                             # 290번째 봉 뒤를 바꾼다
        ma = {t: tm for tm, t, c, p in run_cli(a)['markers'] if tm <= 'd0289'}
        mb = {t: tm for tm, t, c, p in run_cli(b)['markers'] if tm <= 'd0289'}
        self.assertEqual(ma, mb)

    def test_legend_text_and_colors(self):
        res = run_cli([1000 - 2 * i for i in range(280)] + [440 + 3 * k for k in range(1, 21)])
        for needle in ('장기 역배열', '단기 정배열', '#2563eb', '#dc2626', '250일 고점 대비', '신호 아님'):
            self.assertIn(needle, res['legend'])

    def test_both_screens_wire_the_same_option(self):
        stock = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        flow = open(os.path.join(ROOT, 'js', 'foreign-flow.js'), encoding='utf-8').read()
        self.assertIn('ssTrendToggle', stock)
        self.assertIn('ffTrendToggle', flow)
        self.assertIn('core.setTrendMarkers(', stock)
        self.assertIn('core.setTrendMarkers(', flow)
        self.assertNotIn('core.trendMarkers(', stock)
        self.assertNotIn('core.trendMarkers(', flow)
        sentence = '1개월/3개월/6개월/1년 전 대비 종가 변화'
        self.assertIn(sentence, stock)
        self.assertIn(sentence, flow)


if __name__ == '__main__':
    unittest.main()
