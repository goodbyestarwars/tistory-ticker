# -*- coding: utf-8 -*-
"""전략검색 조건 설명이 "라벨 + 한 줄" 구조를 유지하는지 확인한다.

2026-09-04 사용자 지적("위 설명 글 너무 길지??"): 목표주가 괴리 설명이 714자 8문장짜리
한 덩어리였다(다른 전략의 약 3배). 길이보다 문제는 계산식·제외조건·보정·성격이 한 문단에
섞여 있어 "왜 이 종목이 여기 있지"를 확인하려면 처음부터 다 읽어야 했다는 점이다.

라벨과 내용은 탭으로 나눈다 - 산문에 안 나오는 문자라 프론트가 안전하게 쪼갤 수 있고,
탭이 없는 줄은 라벨 없는 문단으로 그려서 옛 형식도 깨지지 않는다.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))

import strategy_scan  # noqa: E402


NOTES = {
    'targetPriceGap': strategy_scan.TARGET_PRICE_METHODOLOGY_NOTE,
    'undervalued': strategy_scan.METHODOLOGY_NOTE,
    'dividend': strategy_scan.DIVIDEND_METHODOLOGY_NOTE,
    'nationalPension': strategy_scan.NPS_METHODOLOGY_NOTE,
}
# 라벨은 몇 개 안 되는 고정 어휘여야 화면에서 세로로 훑을 수 있다.
ALLOWED_LABELS = {'계산', '정렬', '제외', '보정', '표시', '출처', '성격'}


class MethodologyFormatTests(unittest.TestCase):
    def test_helper_joins_rows_with_tab_and_newline(self):
        self.assertEqual(
            strategy_scan.methodology(('계산', '가'), ('제외', '나')),
            '계산\t가\n제외\t나')

    def test_every_line_is_a_known_label_plus_text(self):
        for key, note in NOTES.items():
            for line in note.split('\n'):
                with self.subTest(category=key, line=line[:24]):
                    self.assertIn('\t', line)
                    label, _, text = line.partition('\t')
                    self.assertIn(label, ALLOWED_LABELS)
                    self.assertTrue(text.strip())

    def test_no_note_is_a_wall_of_text_again(self):
        """한 줄이 너무 길면 라벨을 붙여도 결국 문단으로 되돌아간다."""
        for key, note in NOTES.items():
            for line in note.split('\n'):
                _, _, text = line.partition('\t')
                with self.subTest(category=key, label=line.split('\t')[0]):
                    self.assertLessEqual(len(text), 160)

    def test_format_placeholders_are_all_filled(self):
        # methodology()가 .format()보다 먼저 실행되므로 치환이 빠지면 중괄호가 남는다.
        for key, note in NOTES.items():
            with self.subTest(category=key):
                self.assertNotIn('{', note)
                self.assertNotIn('}', note)


if __name__ == '__main__':
    unittest.main()
