# -*- coding: utf-8 -*-
"""차트 측정 도구(js/chart-drawing.js, 2026-10-19 사용자 요청): 고점에서 저점까지 끌면 가격 변화율(%)을 보여 준다. 저장하지 않는 임시 표시."""
import json
import os
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cases):
    out = subprocess.run(['node', os.path.join(ROOT, 'test', 'measure_cli.js'), json.dumps(cases)], capture_output=True, text=True, check=True, encoding='utf-8')
    return json.loads(out.stdout)


class MeasureMathTest(unittest.TestCase):
    def test_pct_from_high_to_low_is_negative_and_uses_start_as_base(self):
        m = run([{'fn': 'metrics', 'start': {'price': 8835, 'logical': 59}, 'end': {'price': 6480, 'logical': 110}}])[0]
        self.assertAlmostEqual(m['pct'], (6480 / 8835 - 1) * 100, places=9)
        self.assertEqual(m['diff'], -2355)
        self.assertEqual(m['bars'], 51)

    def test_rise_is_positive_and_bars_ignore_direction(self):
        m = run([{'fn': 'metrics', 'start': {'price': 100, 'logical': 30}, 'end': {'price': 150, 'logical': 10}}])[0]
        self.assertAlmostEqual(m['pct'], 50.0)
        self.assertEqual(m['bars'], 20)

    def test_invalid_prices_give_null(self):
        res = run([{'fn': 'metrics', 'start': {'price': 0}, 'end': {'price': 5}}, {'fn': 'metrics', 'start': {'price': 5}, 'end': {'price': -1}}])
        self.assertEqual(res, [None, None])

    def test_label_lines(self):
        down, up, nobars = run([
            {'fn': 'lines', 'start': {'price': 8835, 'logical': 1}, 'end': {'price': 6480, 'logical': 52}},
            {'fn': 'lines', 'start': {'price': 100.5, 'logical': 5}, 'end': {'price': 150.75, 'logical': 8}},
            {'fn': 'lines', 'start': {'price': 200}, 'end': {'price': 100}}])
        self.assertEqual(down, ['-26.66%', '8,835 → 6,480 (-2,355)', '51봉'])
        self.assertEqual(up[0], '+50.00%')
        self.assertEqual(up[1], '100.5 → 150.75 (+50.25)')
        self.assertEqual(nobars, ['-50.00%', '200 → 100 (-100)'])             # 봉 수를 모르면 줄을 뺀다


class SnapTest(unittest.TestCase):
    BARS = [{'date': 'd0', 'high': 120, 'low': 100}, {'date': 'd1', 'high': 220, 'low': 200}]

    def snap(self, point, y, tol=14):
        return run([{'fn': 'snap', 'bars': self.BARS, 'point': point, 'y': y, 'tol': tol}])[0]

    def test_snaps_to_nearest_high_or_low_within_tolerance(self):
        # 가짜 시리즈: y = 1000 - price. 봉1 고가 220 -> y 780, 저가 200 -> y 800.
        self.assertEqual(self.snap({'logical': 1, 'time': 'd1', 'price': 215}, 784)['price'], 220)      # 고가 4px
        self.assertEqual(self.snap({'logical': 1, 'time': 'd1', 'price': 205}, 795)['price'], 200)      # 저가 5px

    def test_far_from_extremes_or_missing_bar_is_unchanged(self):
        p = {'logical': 1, 'time': 'd1', 'price': 160}
        self.assertEqual(self.snap(p, 840)['price'], 160)                                              # 40px 떨어짐
        self.assertEqual(self.snap({'logical': 9, 'time': 'zz', 'price': 160}, 840)['price'], 160)     # 봉 없음

    def test_time_lookup_when_no_logical(self):
        self.assertEqual(self.snap({'time': 'd0', 'price': 118}, 882)['price'], 120)                   # 고가 120 -> y 880, 2px


class WiringTest(unittest.TestCase):
    def test_modes_buttons_and_tools_are_wired(self):
        dr = open(os.path.join(ROOT, 'js', 'chart-drawing.js'), encoding='utf-8').read()
        self.assertIn("var MODES = ['line', 'pencil', 'circle', 'box', 'hline', 'measure'];", dr)
        self.assertIn('d.measure = { start: mStart, end: mEnd }', dr)
        self.assertIn('측정은 저장하지 않는다', dr)
        self.assertNotIn("measure: d.measure", dr)                                                      # 저장 payload 에 넣지 않는다
        ss = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        self.assertEqual(ss.count('ss-measure-toggle'), 4)                                              # 버튼 3곳 + 버튼 맵
        self.assertEqual(ss.count("'hline', 'measure']"), 2)                                            # 지수 차트·종목 차트
        ff = open(os.path.join(ROOT, 'js', 'foreign-flow.js'), encoding='utf-8').read()
        self.assertIn('data-ff-draw="measure"', ff)
        self.assertIn("tools: ['line', 'circle', 'pencil', 'measure']", ff)
        css = open(os.path.join(ROOT, 'css', 'stock-search.css'), encoding='utf-8').read()
        self.assertGreaterEqual(css.count('ss-measure-toggle'), 4)                                      # 기본·활성·다크 2종


class VerticalLabelAndCompactToolbarTest(unittest.TestCase):
    """2026-10-19: 버튼 이름은 '측정'이 아니라 '세로'. 차트 위 도구 줄(탭+그리기 단추)은 한 단계 작게(공통 차트 포함)."""

    def test_button_label_is_vertical(self):
        for name in ('stock-search.js', 'foreign-flow.js'):
            src = open(os.path.join(ROOT, 'js', name), encoding='utf-8').read()
            self.assertNotIn('>측정</button>', src)
            self.assertIn('>세로</button>', src)

    def test_compact_rule_is_in_np_layer_and_covers_common_chart_toolbars(self):
        css = open(os.path.join(ROOT, 'style.css'), encoding='utf-8').read().replace(chr(13) + chr(10), chr(10))
        block = css[css.index('/* 2026-10-19 사용자 요청: 차트 위 도구 줄'):]
        self.assertIn('@layer np {', block)
        for cls in ('.ss-chart-tabs', '.ss-index-tools', '.ff-draw-tools', '.dmi-draw-buttons', '.kf-draw-buttons'):
            self.assertIn(cls, block)
        self.assertIn('min-height: 26px !important;', block)
        self.assertIn('padding: 0 9px !important;', block)
        self.assertIn('font-size: 12px !important;', block)
        self.assertIn('.ss-measure-toggle', css[:css.index('/* 2026-10-19 사용자 요청: 차트 위 도구 줄')])      # 세로 단추도 공통 단추 규칙에 들어간다
        self.assertIn('min-height: 26px !important; padding: 0 9px !important; font-size: 12px !important;', css)   # 차트검색 탭 줄 안의 그리기 단추 규칙(de-draw-controls)


if __name__ == '__main__':
    unittest.main()
