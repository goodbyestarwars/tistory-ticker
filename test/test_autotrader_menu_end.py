# -*- coding: utf-8 -*-
"""자동매매 메뉴(관리자 전용)는 PC에서 메뉴바 오른쪽 끝에 붙는다(2026-10-11 요청). 방문자에게는 여전히 보이지 않는다."""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


class AutoTraderMenuEndTests(unittest.TestCase):
    def test_item_is_admin_only_and_marked_end(self):
        menu = read('js/skin-menu.js')
        self.assertIn("if (isBlogAdmin()) {", menu)
        self.assertIn("NAV_ALL.push({ href: '/page/auto-trader', label: '자동매매', end: true });", menu)
        self.assertIn("(item.end ? ' nav-item-end' : '')", menu)
        self.assertNotIn("label: '자동매매' }", menu)                                     # 이전 형태(MY 옆 배치)가 남지 않았다

    def test_rule_is_pc_only_and_in_np_layer(self):
        css = read('style.css')
        tail = css[css.rindex('관리자 도구는 한 묶음'):]
        self.assertIn('@layer np', tail)
        self.assertIn('@media (min-width: 1100px)', tail)
        self.assertIn('.sidebar-left .nav-end-group', tail)
        self.assertIn('position: absolute;', tail)
        self.assertIn('right: 16px;', tail)

    def test_other_menu_items_unchanged(self):
        menu = read('js/skin-menu.js')
        for label in ("label: '홈'", "label: '시장'", "label: '종목'", "label: '캘린더'", "label: '대화방'", "label: 'MY'"):
            self.assertIn(label, menu)


if __name__ == '__main__':
    unittest.main()
