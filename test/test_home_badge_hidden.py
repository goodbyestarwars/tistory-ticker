# -*- coding: utf-8 -*-
"""시장 변동성 모니터(CB·사이드카·VI) UI 계약 (2026-10-15). 헤더 배지(2026-09-17 빈 빨간 알약 사건)는 모니터로 통합되어 없어졌다.

`display`를 직접 거는 요소를 `hidden`으로 숨기려면 `[hidden]` 규칙을 같이 써야 한다는 교훈은 그대로 적용한다.
"""
import io
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with io.open(os.path.join(ROOT, *parts), encoding='utf-8') as handle:
        return handle.read()


class VolMonitorContractTest(unittest.TestCase):
    def setUp(self):
        self.css = read('css', 'home-market-board.css')
        self.js = read('js', 'skin-main.js')

    def test_markup_starts_hidden_and_hidden_rules_exist(self):
        self.assertIn('class="vol-monitor" data-vol-monitor hidden', self.js)
        self.assertIn('.vol-monitor[hidden] { display: none; }', self.css)
        self.assertIn('.vol-panel[hidden] { display: none; }', self.css)

    def test_old_header_badges_are_gone(self):
        for token in ('data-home-cb-sidecar', 'data-home-cb-vi', 'data-home-halt'):
            self.assertNotIn(token, self.js)

    def test_unavailable_is_shown_as_unknown_not_as_normal(self):
        self.assertIn('수신 확인 불가', self.js)
        self.assertIn("data.vi_available === false || data.vi_active_count == null", self.js)

    def test_panel_is_keyboard_accessible_and_closes_on_escape(self):
        self.assertIn("event.key === 'Escape'", self.js)
        self.assertIn('aria-expanded', self.js)
        self.assertIn('aria-controls="volPanel"', self.js)
        self.assertIn(':focus-visible', self.css)

    def test_alert_cards_colors_unified_size_dark_mode_and_mobile(self):
        self.assertIn('.vol-alert.is-cb { border-color: #f3b4ae; background: #fdecea; color: #b42318; }', self.css)       # 연한 빨강
        self.assertIn('.vol-alert.is-side { border-color: #f5c98a; background: #fff4e5; color: #b45309; }', self.css)     # 연한 주황
        self.assertIn('.vol-alert.is-vi { border-color: #d7dbe0; background: #f1f3f5; color: #374151; }', self.css)        # 연한 회색
        self.assertIn('min-height: 88px', self.css)                                                                       # 카드 높이 통일
        self.assertIn('padding: 10px 12px', self.css[self.css.index('.vol-alert {'):self.css.index('.vol-alert strong')])
        self.assertIn('800 22px', self.css)                                                                               # VI 건수 20~24px 강조
        for sel in ('html.dark .vol-alert.is-cb', 'html.dark .vol-alert.is-side', 'html.dark .vol-alert.is-vi', 'html.dark .vol-panel'):
            self.assertIn(sel, self.css)
        mobile = self.css[self.css.index('@media (max-width: 720px) { .vol-monitor'):]
        self.assertIn('flex-direction: column', mobile[:mobile.index('\n')])                                              # 모바일 세로 배치

    def test_history_link_only_when_no_cards_and_keeps_history_reachable(self):
        self.assertIn('data-vol-history hidden', self.js)
        self.assertIn("link.hidden = !!cards || !(haltHistory || viHistory);", self.js)
        self.assertIn("viView.mode = 'today'", self.js)

    def test_no_pills_no_serif_and_no_always_on_none_text(self):
        self.assertNotIn('vol-chip', self.css + self.js)
        self.assertNotIn('vol-col', self.css + self.js)
        card = self.css[self.css.index('.vol-alert strong'):]
        card = card[:card.index('}')]
        self.assertNotIn('MaruBuri', card)
        self.assertIn('Pretendard', card)

    def test_vi_panel_has_filters_and_stock_links(self):
        for token in ("['active', '발동 중']", "['today', '오늘 이력']", "['KOSPI', '코스피']", "['STATIC', '정적']", "['DYNAMIC', '동적']", '/page/stock-search?code='):
            self.assertIn(token, self.js)


if __name__ == '__main__':
    unittest.main()
