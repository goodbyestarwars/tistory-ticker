# -*- coding: utf-8 -*-
"""휴장 대시보드 주간 리포트의 목록 스타일 계약.

2026-09-12 사용자 리포트("휴장 대시보드 깨진다"): "지난 2주 스윙 추천 결과" 목록만
브라우저 기본 불릿 + 들여쓰기로 떨어졌다.

원인: 목록 리셋(list-style/margin/padding)과 행 레이아웃(display:flex, 구분선)이
`.hwr-columns`(또는 `.hwr-schedule`) **조상 선택자에만** 걸려 있었다. 다른 섹션은
전부 `<div class="hwr-columns">`로 감싸는데 `pastOutcomeList()`만 `<ul>`을 `<section>`
바로 밑에 둔다. 로컬 실측(headless chromium): list-style-type disc, padding-left 40px,
margin-top 16px - 대조군(.hwr-columns 안)은 none/0/0.

그래서 "이 목록을 .hwr-columns로 감싸라"가 아니라 "리셋을 컴포넌트 자신에 걸어라"로
고쳤다. 배치가 달라져도 다시 깨지지 않는다.
"""
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class HomeWeeklyReportListStyleTest(unittest.TestCase):
    def css(self):
        return (ROOT / 'css' / 'home-weekly-report.css').read_text(encoding='utf-8')

    def js(self):
        return (ROOT / 'js' / 'home-weekly-report.js').read_text(encoding='utf-8')

    def test_stock_list_resets_itself_not_via_an_ancestor(self):
        css = self.css()
        self.assertIn('.hwr-stock-list { list-style: none; margin: 0; padding: 0; }', css)
        self.assertIn('.hwr-stock-list > li {', css)
        self.assertIn('.hwr-stock-list > li:first-child { border-top: 0; }', css)

    def test_row_layout_does_not_depend_on_hwr_columns(self):
        """행이 좌우로 갈리는 건 .hwr-columns li에만 있던 display:flex였다."""
        css = self.css()
        rule = re.search(r'\.hwr-stock-list > li \{([^}]*)\}', css).group(1)
        for prop in ('display: flex', 'justify-content: space-between', 'border-top:'):
            self.assertIn(prop, rule)

    def test_dark_mode_border_covers_the_self_contained_list(self):
        """다크모드 테두리 색도 .hwr-columns li에만 걸려 있어 같이 넓혀야 한다 -
        빠지면 어두운 배경에 밝은 구분선이 남는다."""
        css = self.css()
        line = [l for l in css.splitlines() if 'html.dark .hwr-columns li,' in l]
        self.assertTrue(line, 'html.dark 구분선 규칙을 못 찾았다')
        self.assertIn('html.dark .hwr-stock-list > li', line[0])

    def test_outcome_list_is_still_the_one_rendered_outside_hwr_columns(self):
        """이 테스트가 지키려는 상황 자체가 사라지지 않았는지 확인한다.
        pastOutcomeList가 .hwr-columns로 감싸도록 바뀌면 위 규칙들의 근거가 달라진다."""
        js = self.js()
        block = js[js.index('function pastOutcomeList'):]
        block = block[:block.index('function indexSummary')]
        self.assertIn("<ul class=\"hwr-stock-list hwr-outcome-list\">", block)
        self.assertNotIn('hwr-columns', block)


if __name__ == '__main__':
    unittest.main()
