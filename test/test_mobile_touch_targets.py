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


class RealtimeBoardChangeRateTests(unittest.TestCase):
    """실시간 종목판의 등락률 표시.

    2026-09-04 요청: "실시간 종목판에 몇 % 오르고 내렸는지 표시해줘".
    모바일은 컬럼이 종목/현재가/활성 탭 값 3개뿐이라, 거래대금·거래량·시가총액 탭에서는
    등락률이 아예 안 보였다(상승률·하락률 탭에서만 보였다). 현재가 칸 안에 등락률 줄을
    넣어 어느 탭에서든 보이게 했고, PC는 상승률·하락률 컬럼이 이미 있어 감춘다.
    """

    def test_render_and_live_update_share_one_builder(self):
        """가장 위험한 회귀: 렌더와 실시간 갱신이 서로 다른 결과를 내는 것.

        updateRow는 현재가 셀을 통째로 다시 쓴다. 예전처럼 textContent로 쓰면 안에 있는
        등락률 줄이 첫 체결에 지워져서, 처음엔 보이다가 시세가 움직이면 사라진다.
        """
        source = read('js/home-realtime-table.js')
        self.assertIn('function priceCellInner(price, currency, rate)', source)
        # 렌더 경로
        self.assertIn("priceCellInner(item.price, item.currency, rate)", source)
        # 실시간 갱신 경로 - 같은 함수를 써야 한다
        self.assertIn('priceCell.innerHTML = priceCellInner(price, item && item.currency,', source)
        # textContent 대입이 남아 있으면 등락률 줄이 지워진다
        self.assertNotIn("priceCell.textContent = fmtPrice(", source)

    def test_change_rate_keeps_the_semantic_colors(self):
        # CLAUDE.md: 상승은 빨강, 하락은 파랑. 기존 컬럼과 같은 클래스를 재사용한다.
        source = read('js/home-realtime-table.js')
        self.assertIn("var tone = parsed > 0 ? 'hrt-up' : parsed < 0 ? 'hrt-down' : 'hrt-flat';", source)
        self.assertIn("+ (parsed > 0 ? '+' : '') + parsed.toFixed(2) + '%</small>';", source)

    def test_hidden_on_pc_shown_on_mobile(self):
        style = read('style.css')
        # PC 기본값은 숨김 - 상승률·하락률 컬럼과 중복되면 안 된다.
        self.assertIn('.hrt-price-rate { display: none; }', style)
        # 모바일 구간에서만 켠다.
        block = mobile_blocks(style)
        self.assertIn('.home-realtime-board .hrt-table-wrap .hrt-price-rate {', block)
        self.assertIn('display: block;', block)
