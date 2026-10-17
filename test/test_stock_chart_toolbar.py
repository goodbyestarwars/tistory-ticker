# -*- coding: utf-8 -*-
"""차트검색 차트 툴바 정리(2026-10-16): 그리기 도구를 탭 줄과 한 줄에, 분봉 간격 줄은 분봉에서만, 기간 버튼은 사이트 탭 스타일."""

import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


class StockChartToolbarTest(unittest.TestCase):
    def test_draw_tools_share_the_tab_row(self):
        js = read('js/dashboard-enhancements.js')
        self.assertIn("controlRow.classList.contains('ss-chart-tabs')", js)
        self.assertIn("bar.className = 'de-chart-toolbar'", js)
        css = read('css/dashboard-enhancements.css')
        self.assertIn('.de-chart-toolbar { display: flex; flex-wrap: wrap;', css)

    def test_minute_scope_row_is_hidden_unless_minute(self):
        css = read('css/stock-search.css')
        self.assertIn('#stock-search .ss-minute-scope-wrap[hidden] { display: none; }', css)

    def test_range_buttons_use_site_segment_style_not_inline_style(self):
        data = read('js/chart-data.js')
        self.assertNotIn("wrap.style.cssText", data)
        self.assertNotIn('style="padding:4px 7px', data)
        self.assertIn('nine-range-btn', data)
        style = read('style.css')
        self.assertEqual(style.count('.ibd-range-btn, .nine-range-btn,'), 2)       # 탭 버튼 기본·선택 규칙
        self.assertGreaterEqual(style.count('.ss-chart-tabs, .nine-chart-ranges,'), 3)   # 세그먼트 트랙 규칙


if __name__ == '__main__':
    unittest.main()
