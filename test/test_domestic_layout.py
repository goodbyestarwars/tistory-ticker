"""국내 시장지표 탭의 구조·색상 규격 검사(2026-10-12 UI 개선): 01~05 번호 블록, 04 자금 흐름 구역 통합, 투자자 색 고정, 지수 점선, 섹션 간격·구분선."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as handle:
        return handle.read()


class DomesticLayoutTests(unittest.TestCase):
    def test_blocks_are_numbered_01_to_04_with_separate_investor_tab(self):
        domestic = read('js/domestic-market-indicators.js')
        futures = read('js/kospi-futures.js')
        for number, name in (('01', '국내 주요 지수'), ('02', '증시자금')):
            self.assertIn("blockHead('%s', '%s'" % (number, name), domestic)
        self.assertIn("buildBlockHead('03', 'KOSPI200 선물지표')", futures)
        self.assertIn("buildBlockHead('04', '옵션 수급'", futures)
        # 번호는 .mi-block-no, 제목은 .mi-block-title, 한 줄 설명은 .mi-block-desc 로 모든 블록이 같다
        self.assertEqual(domestic.split('function init()')[1].count('mi-block-no'), 1)
        self.assertEqual(futures.count('mi-block-no'), 1)
        self.assertGreaterEqual(domestic.count('mi-block-desc'), 3)
        self.assertGreaterEqual(futures.count('mi-block-desc'), 2)
        # 01 만 첫 블록(위 구분선 없음)
        self.assertEqual(domestic.split('function init()')[1].count('mi-block--first'), 1)

    def test_duplicate_money_flow_section_is_merged_into_02_and_03(self):
        domestic = read('js/domestic-market-indicators.js')
        self.assertNotIn('국내 증시 자금 흐름', domestic.split('function init()')[1], '독립 04 구역은 없다')
        self.assertNotIn('dmi-invflow-section', domestic)
        self.assertIn('dmi-invflow-host', domestic, '02 안에 투자자 추이 자리')
        self.assertIn('dmi-balance-host', domestic, '03 안에 예탁금·신용잔고 흐름 자리')
        self.assertIn('mountBalance', domestic)
        flow = read('js/investor-flow.js')
        self.assertIn('function mountBalance', flow)
        self.assertNotIn('data-if-balnote', flow.split('function mount(host')[1].split('function mountBalance')[0], '02 화면에 잔고 표가 남아 있지 않다')

    def test_investor_colors_are_fixed_and_used_everywhere(self):
        css = read('css/market-indicators.css')
        self.assertIn('--mi-inv-foreign: #D94F45', css)   # 외국인 빨강
        self.assertIn('--mi-inv-inst: #3273C8', css)      # 기관 파랑
        self.assertIn('--mi-inv-indiv: #168B70', css)     # 개인 초록
        self.assertIn('--mi-idx-kospi: #D94F45', css)
        self.assertIn('--mi-idx-kosdaq: #3273C8', css)
        self.assertIn('--mi-idx-kospi200: #168B70', css)
        flow = read('js/investor-flow.js')
        for token in ('--mi-inv-foreign', '--mi-inv-inst', '--mi-inv-indiv'):
            self.assertIn(token, flow)
        # 예전 보라·황토·청록 토큰이 남아 있지 않다
        self.assertNotIn('--ibd-s1', flow + read('css/indicator-board.css') + read('css/investor-flow.css'))
        self.assertNotIn('#7a4fb5', read('css/indicator-board.css'))
        # 막대는 계열(투자자) 색 하나로만 칠한다 - 순매수·순매도 방향은 0선 위아래로만 구분
        board = read('js/indicator-board.js')
        self.assertIn("style=\"fill:' + s.color", board)

    def test_index_overlay_on_investor_chart_is_dark_gray_dotted(self):
        css = read('css/indicator-board.css')
        self.assertRegex(css, r'\.ibd \.ibd-secline \{[^}]*stroke:var\(--ibd-secline\)[^}]*stroke-dasharray:1\.5 3\.5')
        self.assertIn('--ibd-secline:var(--mi-idx-ref', css)
        market = read('css/market-indicators.css')
        self.assertIn('--mi-idx-ref: #4b5563', market)
        self.assertIn('--mi-idx-ref: var(--dk-sub)', market)  # 다크모드에서도 읽히는 중립 회색(공식 다크 팔레트 --dk-sub, 2026-10-23)

    def test_section_spacing_divider_and_dark_overrides(self):
        css = read('css/market-indicators.css')
        self.assertRegex(css, r'\.mi-wrap \.mi-block \{[^}]*margin: var\(--ui-section-gap\) 0 0;[^}]*border-top: 1px solid var\(--mi-rule\)')
        self.assertRegex(css, r'\.mi-wrap \.mi-block\.mi-block--first \{[^}]*border-top: 0')
        self.assertRegex(css, r'@media \(max-width: 760px\) \{\s*\.mi-wrap \.mi-block \{ margin-top: var\(--ui-section-gap\); \}')
        self.assertNotRegex(css, r'\.mi-block \{[^}]*(box-shadow:(?!\s*none)|gradient|border-radius:\s*[1-9])', '블록은 카드·그림자·그라데이션·둥근 테두리가 없다')
        self.assertIn('html.dark .mi-wrap .mi-block-no', css)
        # 사이트 공통 제목 규칙(@layer np)이 번호 블록 제목을 명조로 바꾸지 않도록 같은 레이어에서 되돌린다
        self.assertIn('@layer np', css)
        self.assertIn('.mi-block-title', css.split('@layer np')[-1])
        # 다크모드에서 투자자 표·상승하락 색을 되돌리는 규칙
        self.assertIn('html.dark .ifl .ifl-table td.up', read('css/investor-flow.css'))
        self.assertIn('html.dark .dmi-shell .dmi-flow-table th', read('css/domestic-market-indicators.css'))
        board = read('css/indicator-board.css')
        self.assertIn('html.dark .ibd .up', board)   # 증시자금 표의 상승·하락 색과 선택된 기간 버튼 글자를 다크모드에서 되돌린다
        self.assertIn('html.dark .ibd .ibd-range-btn.is-active', board)

    def test_chart_controls_no_longer_hide_interval_tabs(self):
        for path, needle in (('css/domestic-market-indicators.css', '.dmi-panel > .dmi-tabs:has(+ .de-draw-controls) { padding-right: 190px; }'),
                             ('css/kospi-futures.css', '.kf-interval-toggle:has(+ .de-draw-controls) { padding-right: 190px; }')):
            css = read(path)
            self.assertIn(needle, css)
            self.assertNotRegex(css, r'(?m)^\s*\.dmi-panel > \.dmi-tabs \{ padding-right: 190px; \}')
        self.assertIn('flex-wrap: wrap', read('css/kospi-futures.css'))

    def test_futures_and_options_use_flat_sections(self):
        css = read('css/kospi-futures.css')
        self.assertRegex(css, r'#kospi-futures \.kf-opt-card \{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent')
        self.assertRegex(css, r'#kospi-futures \.kf-option-profile \{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent')
        js = read('js/kospi-futures.js')
        self.assertIn("label: '주간선물 (09:00~15:45)'", js)   # 04 제목에 KOSPI200 이 있어 소제목에서는 뺀다
        self.assertIn('kf-option-title-meta', js)               # 만기·REST 스냅샷 문구 갱신 훅 유지


if __name__ == '__main__':
    unittest.main()
