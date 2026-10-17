# -*- coding: utf-8 -*-
"""휴장 화면에도 마켓 브리핑이 보이도록 하는 배치(js/skin-main.js syncBriefingPlacement) 계약."""

import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ClosedBriefingTest(unittest.TestCase):
    def setUp(self):
        self.src = open(os.path.join(ROOT, 'js', 'skin-main.js'), encoding='utf-8').read()

    def test_briefing_moves_below_weekly_report_when_closed_and_back_when_open(self):
        self.assertIn('function syncBriefingPlacement()', self.src)
        self.assertIn("dashboardSection.classList.contains('is-market-closed')", self.src)
        self.assertIn('report.parentNode.insertBefore(section, report.nextSibling)', self.src)
        self.assertIn("document.createComment('home-briefing-slot')", self.src)    # 장이 열리면 원래 자리로
        self.assertIn('section.__homeSlot.parentNode.insertBefore(section, section.__homeSlot)', self.src)

    def test_resyncs_after_widgets_init_and_on_tab_class_change(self):
        self.assertIn('syncBriefingPlacement();\n        setTimeout(syncBriefingPlacement, 1500);', self.src)
        self.assertIn("attributeFilter: ['class']", self.src)

    def test_closed_dashboard_still_hides_the_widget_grid(self):
        # 위젯 그리드(실시간 표 등)는 휴장 때 계속 숨긴다 - 브리핑만 꺼내 온다
        self.assertIn('if (widgetGrid) widgetGrid.hidden = isClosed;', self.src)


if __name__ == '__main__':
    unittest.main()
