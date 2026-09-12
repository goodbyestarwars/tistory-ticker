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

    def test_outcome_list_is_a_multi_column_grid(self):
        """2026-09-12 사용자 지적("이 짧은 정보를 한 줄에?"): 이 목록만 전체 폭 1열이라
        데스크탑에서 종목명과 T+5/T+10 사이가 1,000px 넘게 벌어졌다. 같은 파일의
        .hwr-stock-list--four와 같이 데스크탑 4열 / 720px 이하 2열로 나눈다."""
        css = self.css()
        self.assertIn('.hwr-outcome-list { display: grid; grid-template-columns: repeat(4', css)
        self.assertIn('.hwr-outcome-list { grid-template-columns: repeat(2', css)

    def test_outcome_list_mobile_rule_comes_after_the_desktop_rule(self):
        """특이도가 같아 소스 순서로 이긴다. 모바일 규칙을 파일 앞쪽(82행대) 미디어쿼리에
        두면 데스크탑 규칙이 뒤에 와서 375px에서도 4열(칸당 70px)로 남는다 - 실제로
        그렇게 났던 버그라 순서를 테스트로 고정한다."""
        css = self.css()
        desktop = css.index('.hwr-outcome-list { display: grid;')
        mobile = css.index('.hwr-outcome-list { grid-template-columns: repeat(2')
        self.assertLess(desktop, mobile,
                        '모바일 2열 규칙이 데스크탑 4열 규칙보다 앞서면 적용되지 않는다')

    def test_outcome_list_row_separators_follow_the_grid(self):
        """1열일 땐 :first-child만 구분선을 지우면 됐지만, 그리드에선 각 행의 첫 칸들이
        대상이다(--four와 동일한 nth-child 방식)."""
        css = self.css()
        self.assertIn('.hwr-outcome-list > li:nth-child(-n+4) { border-top: 0; }', css)
        self.assertIn('.hwr-outcome-list > li:nth-child(-n+2) { border-top: 0; }', css)

if __name__ == '__main__':
    unittest.main()
