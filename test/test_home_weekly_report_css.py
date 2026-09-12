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

2026-09-12(2차) 사용자 지적("일관성이 부족해"): 결국 형제 섹션과 맞추려고
.hwr-columns > article 카드 안으로 옮겼다. 리셋을 컴포넌트에 걸어둔 덕에 옮기는 것만으로
깨지지 않았다 - 위 판단이 실제로 값을 한 셈. 이 파일의 리셋 테스트는 그대로 유효하다.
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

    def test_component_reset_survives_being_moved_into_a_card(self):
        """2026-09-12(2차)에 pastOutcomeList를 .hwr-columns > article 안으로 옮겼다.
        위 리셋 규칙들의 원래 근거("이 목록만 .hwr-columns 밖에 있다")는 사라졌지만,
        리셋을 조상이 아니라 컴포넌트 자신에 걸어둔 덕에 옮겨도 안 깨졌다 - 그게 #422의
        의도였으므로 규칙은 그대로 둔다. 다시 조상 의존으로 되돌리지 않기 위한 가드."""
        js = self.js()
        block = js[js.index('function pastOutcomeList'):]
        block = block[:block.index('function indexSummary')]
        self.assertIn('hwr-columns', block)
        self.assertIn('hwr-outcome-list', block)
        css = self.css()
        self.assertIn('.hwr-stock-list { list-style: none; margin: 0; padding: 0; }', css)

    def test_outcome_list_matches_its_sibling_sections(self):
        """2026-09-12(2차) "일관성이 부족해": 이 섹션만 <article> 카드 없이 맨 <ul>이었고
        값도 혼자 오른쪽 끝으로 밀려 다음 칸 종목명에 붙어 읽혔다. 바로 위 형제인
        "2주 스윙 상승 후보"와 같은 성격이라 구조를 동일하게 맞췄다."""
        js = self.js()
        block = js[js.index('function pastOutcomeList'):]
        block = block[:block.index('function indexSummary')]
        self.assertIn('<div class="hwr-columns"><article>', block)
        self.assertIn('hwr-stock-list hwr-stock-list--four hwr-outcome-list', block)

    def test_outcome_values_are_not_restacked_against_the_four_column_layout(self):
        """--four는 값을 이름 아래 가로로 놓는다(.hwr-stock-list--four .hwr-stock-values).
        .hwr-outcome-values가 flex-direction:column으로 다시 덮으면 형제와 어긋난다."""
        css = self.css()
        match = re.search(r'^\.hwr-outcome-values \{([^}]*)\}', css, re.M)
        if match:
            self.assertNotIn('flex-direction: column', match.group(1))

    def test_outcome_list_does_not_define_its_own_grid(self):
        """자체 그리드를 다시 두면 --four와 칸 폭이 갈려 일관성이 깨진다."""
        css = self.css()
        self.assertNotIn('.hwr-outcome-list { display: grid;', css)
        self.assertNotIn('.hwr-outcome-list { grid-template-columns:', css)

    def test_outcome_stats_sit_inside_the_card(self):
        """요약카드가 카드 밖에 있으면 폭이 전체(1452px)로 벌어져 목록 카드(723px)와
        어긋난다 - 로컬 실측으로 확인하고 카드 안으로 옮겼다."""
        js = self.js()
        block = js[js.index('function pastOutcomeList'):]
        block = block[:block.index('function indexSummary')]
        self.assertLess(block.index('<div class="hwr-columns"><article>'),
                        block.index('pastOutcomeStatsCard(stats)'))


if __name__ == '__main__':
    unittest.main()
