# -*- coding: utf-8 -*-
"""메인 카드 헤더 배지의 숨김 계약(2026-09-17 사용자 지적: "빨간색은 뭐야").

국내 시장 카드 헤더에 **글자 없는 빈 빨간 알약**이 계속 떠 있었다. JS는 `el.hidden = true`로
숨기는데, `[hidden] { display: none }`은 브라우저 기본 스타일이라 작성자 CSS의
`display: inline-flex`에 진다. 사이드카는 검증된 증권사 필드가 없어 늘 숨김 상태인데
(CLAUDE.md) 그 숨김이 2026-09-15부터 먹지 않았다.

`display`를 직접 거는 요소를 `hidden`으로 숨기려면 `[hidden]` 규칙을 같이 써야 한다.
"""

import io
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, 'style.css')
JS = os.path.join(ROOT, 'js', 'skin-main.js')


def read(path):
    with io.open(path, encoding='utf-8') as handle:
        return handle.read()


class BadgeHiddenTest(unittest.TestCase):
    def setUp(self):
        self.css = read(CSS)
        self.js = read(JS)

    def test_js_still_hides_with_the_hidden_property(self):
        """구현이 바뀌어 hidden을 안 쓰게 되면 이 계약 자체를 다시 봐야 한다."""
        self.assertIn('el.hidden = true;', self.js)

    def test_sidecar_sets_display_so_it_needs_a_hidden_rule(self):
        block = self.css[self.css.index('.home-card-heading .home-cb-sidecar {'):]
        block = block[:block.index('}')]
        self.assertIn('display:', block, '사이드카가 display를 안 걸면 이 테스트는 필요 없다')
        self.assertIn('.home-card-heading .home-cb-sidecar[hidden]', self.css)

    def test_hidden_rule_actually_hides(self):
        start = self.css.index('.home-card-heading .home-cb-sidecar[hidden]')
        rule = self.css[start:self.css.index('}', start)]
        self.assertIn('display: none', rule)

    def test_vi_badge_is_covered_too(self):
        """VI 배지도 같은 방식으로 숨기므로 함께 막아 둔다."""
        self.assertIn('.home-card-heading .home-cb-vi[hidden]', self.css)

    def test_markup_starts_hidden(self):
        """처음 그릴 때부터 숨어 있어야 데이터가 오기 전에 빈 배지가 안 보인다."""
        self.assertIn('class="home-cb-sidecar" data-home-cb-sidecar hidden', self.js)
        self.assertIn('data-home-cb-vi hidden', self.js)


if __name__ == '__main__':
    unittest.main()
