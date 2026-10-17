# -*- coding: utf-8 -*-
"""홈 대시보드·휴장 리포트 미니 차트 마우스 오버(js/home-chart-hover.js) 연결 계약."""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    return open(os.path.join(ROOT, path), encoding='utf-8').read()


class HomeChartHoverTest(unittest.TestCase):
    def test_helper_is_delegated_and_uses_text_content(self):
        src = read('js/home-chart-hover.js')
        self.assertIn("[data-hover-points]", src)
        self.assertIn("document.addEventListener('pointermove'", src)
        self.assertIn('parts.tip.textContent', src)          # 문구는 HTML로 넣지 않는다
        self.assertNotIn('.innerHTML', src)

    def test_dashboard_charts_carry_hover_points_and_load_helper(self):
        src = read('js/skin-main.js')
        self.assertIn("home-chart-hover.js", src)
        self.assertIn("loadHomeScript(HOME_CHART_HOVER_SCRIPT_URL, 'HomeChartHover')", src)
        # 지수(KOSPI·KOSDAQ·미국)와 투자자 동향 두 차트 모두
        self.assertEqual(len(re.findall(r'hmb-investor-spark-wrap" data-hover-points', src)), 2)
        self.assertIn("' KST 구간 · 외국인 누적 '", src)
        self.assertIn("' 구간 · 지수 '", src)
        # 모듈 순서(weekly=0, widgets=1, table=2, news=3)를 바꾸지 않았다
        self.assertIn('var weekly = modules[0];', src)
        self.assertIn('var news = modules[3];', src)

    def test_weekly_report_index_cards_have_hover(self):
        src = read('js/home-weekly-report.js')
        self.assertIn('function indexHoverAttr(item)', src)
        self.assertIn("'<div class=\"hwr-spark\"' + indexHoverAttr(item)", src)
        self.assertIn("' 종가 '", src)


if __name__ == '__main__':
    unittest.main()
