# -*- coding: utf-8 -*-
"""주식 이야기(learn/)는 평서체로 쓴다(2026-09-17 사용자 지시: "존댓말 금지").

이 테스트가 있는 이유: 1차 작업에서 '습니다/입니다/합니다'만 찾아 고쳤더니 **'봅니다·부릅니다·
나옵니다' 같은 ~ㅂ니다 형이 33곳 그대로 남았다.** 사용자가 화면에서 "부릅니다"를 보고 알았다.
낱말을 하나씩 찾는 방식은 또 샌다. 어미 패턴으로 통째로 막는다.
"""

import io
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEARN = os.path.join(ROOT, 'learn')

# 존댓말 어미. '~니다'가 ㅂ니다/습니다를 모두 덮는다.
POLITE = re.compile(r'[가-힣]*(?:니다|세요|십시오|어요|아요)')

# 존댓말이 아닌데 위 패턴에 걸리는 말들.
ALLOWED = {
    '아니다',      # 평서체 부정
    '팝니다',      # 중고거래 비유의 게시글 제목("팝니다 글")
    '삽니다',      # 같은 비유("삽니다 글")
}


def learn_pages():
    return sorted(name for name in os.listdir(LEARN) if name.endswith('.html'))


def strip_markup(text):
    """태그와 속성값은 검사 대상이 아니다(aria-label 등에도 한국어가 있다)."""
    text = re.sub(r'<script[\s\S]*?</script>', ' ', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    return text


class PlainStyleTest(unittest.TestCase):
    def test_no_polite_endings_in_body_text(self):
        for name in learn_pages():
            with self.subTest(page=name):
                with io.open(os.path.join(LEARN, name), encoding='utf-8') as handle:
                    body = strip_markup(handle.read())
                found = [word for word in POLITE.findall(body) if word and word not in ALLOWED]
                self.assertEqual(found, [], '%s에 존댓말이 남아 있다: %s' % (name, sorted(set(found))))

    def test_every_chapter_is_checked(self):
        """장이 늘거나 파일명이 바뀌어도 검사에서 빠지지 않게 개수를 확인한다."""
        pages = learn_pages()
        self.assertIn('index.html', pages)
        self.assertEqual(len(pages), 8, pages)  # 차례 + 7장(사용자 지시: 장 수를 늘리지 않는다)


if __name__ == '__main__':
    unittest.main()
