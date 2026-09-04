# -*- coding: utf-8 -*-
"""모바일 터치 영역 계약.

2026-09-04 사용자 요청("모바일 앱수준으로 다시 해줄래?")에 따라 Chromium 360px로
전 페이지를 실측했다. 가로 스크롤도 글자 잘림도 없었지만, 조작부가 일관되게
22~38px여서 손가락으로 정확히 누르기 어려웠다(Apple HIG 44pt / Material 48dp 미달).
그게 "앱 같지 않다"의 실체였다.

규칙을 되돌리면 같은 문제가 재발하므로 여기서 막는다. PC는 마우스라 그대로 두는 것이
전제이므로, 720px 이하 구간 안에 있는지도 함께 본다.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def mobile_blocks(source):
    """max-width: 720px 미디어쿼리 본문만 모아 돌려준다."""
    blocks = []
    for match in re.finditer(r'@media \(max-width: 720px\) \{', source):
        i = match.end()
        depth = 1
        while i < len(source) and depth:
            if source[i] == '{':
                depth += 1
            elif source[i] == '}':
                depth -= 1
            i += 1
        blocks.append(source[match.end():i])
    return '\n'.join(blocks)


class MobileTouchTargetTests(unittest.TestCase):

    def assert_in_mobile_block(self, rel, needle):
        block = mobile_blocks(read(rel))
        self.assertIn(needle, block,
                      '%s의 720px 이하 구간에 없다: %s' % (rel, needle))

    def test_chart_search_tabs(self):
        # 실측 33px.
        self.assert_in_mobile_block('css/pattern-scan.css',
                                    '#pattern-scan .ps-tab { min-height: 44px; }')

    def test_stock_analysis_tabs_and_search(self):
        # 실측: 탐색 탭 38px, 조회 입력·버튼 36px.
        self.assert_in_mobile_block('css/foreign-flow.css',
                                    '#foreign-flow .ff-explore-tab { min-height: 44px; }')
        self.assert_in_mobile_block('css/foreign-flow.css', '#foreign-flow .ff-search-btn { min-height: 44px; }')

    def test_market_temperature_period_pills(self):
        # 실측 72x22 - 세로가 22px였다.
        self.assert_in_mobile_block('css/market-temp.css', 'min-height: 40px;')

    def test_order_book_input(self):
        # 실측 35px. 키보드를 띄우는 첫 조작이라 특히 중요하다.
        self.assert_in_mobile_block('css/order-book.css', '#order-book .ob-input { min-height: 44px; }')

    def test_watchlist_controls(self):
        # 실측: 그룹 메뉴 34x34, 입력·추가 37px, 로그인 38px.
        block = mobile_blocks(read('css/watchlist.css'))
        self.assertIn('#watchlist .wl-group-add { width: 44px; height: 44px; }', block)
        self.assertIn('#watchlist .wl-login-btn { min-height: 44px; }', block)

    def test_home_widget_handles_are_reachable_without_hover(self):
        """홈 위젯 손잡이·메뉴는 opacity:0에 :hover로만 나타났다.

        터치 기기에는 hover가 없어 폰에서는 위젯 순서 변경과 메뉴를 아예 쓸 수 없었다.
        크기(25x25)보다 이쪽이 더 큰 결함이다.
        """
        block = mobile_blocks(read('style.css'))
        self.assertIn('.home-widget-drag,', block)
        self.assertIn('.home-widget-menu-button {', block)
        self.assertIn('opacity: 1;', block)

    def test_pc_keeps_the_hover_reveal(self):
        # PC는 마우스라 기존 동작을 유지하는 게 이 변경의 전제다.
        source = read('style.css')
        self.assertIn('.home-widget:hover .home-widget-drag,', source)
        self.assertIn('opacity: 0;', source)


if __name__ == '__main__':
    unittest.main()
