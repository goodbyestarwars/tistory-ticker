# -*- coding: utf-8 -*-
"""차트검색 매물대 분석 패널(js/stock-search.js renderVpPanel): 다시 그려도 사용자가 펼친 '거래량이 적은 가격대'가 접히지 않는 계약.
2026-10-19 사용자 리포트: '거래량이 적은 가격대 1곳' 이 펼쳐지지 않는다. 패널은 보이는 구간이 바뀔 때마다 innerHTML 이 통째로 바뀌어 펼침이 바로 접혔다.
동작 자체(같은 내용이면 노드 유지, 다른 내용이면 펼침 상태 이어받기)는 브라우저에서 확인했고 여기서는 코드 구조를 고정한다."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class VpPanelOpenStateTest(unittest.TestCase):
    def setUp(self):
        src = open(os.path.join(ROOT, 'js', 'stock-search.js'), encoding='utf-8').read()
        a = src.index('function renderVpPanel')
        self.body = src[a:src.index('function createVolumeProfilePrimitive')]

    def test_open_state_is_read_before_rewrite_and_reapplied(self):
        self.assertIn("panel.querySelector('.ss-vp-thin')", self.body)
        self.assertIn('prevThin.open', self.body)
        self.assertIn('thinOpen ? html.replace', self.body)
        self.assertIn('ss-vp-thin" open>', self.body)

    def test_identical_content_does_not_touch_the_dom(self):
        self.assertIn('panel.__vpHtml !== html', self.body)
        self.assertEqual(len(re.findall(r'panel\.innerHTML = thinOpen', self.body)), 1)
        self.assertNotIn("panel.innerHTML = '<div class=\"ss-vp-head\">", self.body)      # 무조건 덮어쓰던 옛 방식이 남지 않았다

    def test_null_analysis_clears_cache(self):
        self.assertIn('panel.__vpHtml = null', self.body)


if __name__ == '__main__':
    unittest.main()
