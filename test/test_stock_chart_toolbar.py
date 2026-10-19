# -*- coding: utf-8 -*-
"""차트 주기와 그리기 도구의 양끝 배치 및 기존 버튼 유지."""

import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


class StockChartToolbarTest(unittest.TestCase):
    def test_chart_tool_groups_keep_order_and_fullscreen_controls(self):
        js = read('js/stock-search.js')
        self.assertEqual(3, js.count('class="ss-timeframe-tools"'))
        self.assertEqual(3, js.count('class="ss-drawing-tools"'))
        stock = js[js.index("+ '<div class=\"ss-chart-tabs\">'"):]
        labels = ('>일봉</button>', '>주봉</button>', '>월봉</button>', '>분봉</button>',
                  '>메모</button>', '>직선</button>', '>동그라미</button>', '>박스</button>',
                  '>가로선</button>', '>측정</button>', '>연필</button>', '>지우기</button>')
        positions = [stock.index(label) for label in labels]
        self.assertEqual(sorted(positions), positions)
        self.assertLess(stock.index('class="ss-timeframe-tools"'), stock.index('class="ss-drawing-tools"'))
        self.assertIn("controlRow.querySelector('.ss-drawing-tools')", read('js/dashboard-enhancements.js'))
        css = read('css/stock-search.css')
        self.assertIn('justify-content: space-between;', css)
        self.assertIn('flex-wrap: wrap;', css)
        self.assertIn('#stock-search .ss-panels { grid-template-columns: minmax(0, 1fr);', css)
        skin_css = read('style.css')
        self.assertIn('html body .ss-chart-tabs.ss-chart-tabs {', skin_css)
        self.assertIn('width: 100% !important;', skin_css)
        self.assertIn('width: calc(100vw - 48px) !important;', skin_css)

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
