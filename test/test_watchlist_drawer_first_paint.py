"""관심종목 서랍 첫 페인트 여백(html.wl-open) 계약 검사 (2026-10-12).

휴장 홈에서 서랍이 '열림'으로 저장돼 있으면 본문이 전체 폭으로 그려진 뒤 서랍 스크립트가 여백을 넣어 좁아졌다가
홈 레이아웃이 만들어지며 다시 넓어지는 문제(실측 1019 -> 641 -> 951px)를 막는다. 해결은 세 곳이 한 이름(wl-open·wl_drawer_open_v1)을
공유하는 데 달려 있어, 한 곳만 바뀌어도 깨지도록 서로의 문자열을 맞춰 본다.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class WatchlistDrawerFirstPaintTest(unittest.TestCase):
    def test_skin_head_adds_the_class_before_any_stylesheet_or_widget_script(self):
        skin = read("skin.html")
        needle = "document.documentElement.classList.add('wl-open')"
        self.assertEqual(skin.count(needle), 1)
        at = skin.index(needle)
        self.assertLess(at, skin.index("initial-paint-guard"), "the class must be set before the first paint guard")
        self.assertLess(at, skin.index('<script defer src="https://goodbyestarwars.github.io/tistory-ticker/js/stock-search-panel.js'), "and before the drawer script that used to cause the jump")
        block = skin[skin.rindex("<script>", 0, at):skin.index("</script>", at)]
        self.assertIn("localStorage.getItem('wl_drawer_open_v1') === '1'", block)
        self.assertIn("watchlist", block, "the dedicated MY page has no global drawer, so it is excluded")
        self.assertIn("classList.remove('wl-open')", block, "a failsafe must drop the reserved margin if the drawer never appears")
        self.assertIn("try {", block)

    def test_state_key_is_the_same_in_skin_and_drawer_script(self):
        key = re.search(r"WATCHLIST_OPEN_KEY = '([^']+)'", read("js/stock-search-panel.js")).group(1)
        self.assertEqual(key, "wl_drawer_open_v1")
        self.assertIn("'" + key + "'", read("skin.html"))

    def test_drawer_script_keeps_the_class_in_sync_with_open_state(self):
        js = read("js/stock-search-panel.js")
        self.assertIn("document.documentElement.classList.toggle('wl-open', open)", js)
        self.assertIn("document.documentElement.classList.remove('wl-open')", js, "the MY page branch clears the reservation")

    def test_every_drawer_layout_rule_also_answers_to_the_early_class(self):
        css = read("style.css")
        lines = [l for l in css.splitlines() if ".global-watchlist-drawer.is-open)" in l and "html body" in l]
        self.assertGreaterEqual(len(lines), 11)
        for line in lines:
            selector = line.split(" {")[0]
            self.assertIn("html.wl-open.wl-open body", selector, selector[:90])
        # 예전 :has() 경로도 그대로 남아 있다(클래스 없이 서랍만 열린 경우).
        self.assertTrue(all(":has(.global-watchlist-drawer.is-open)" in l.split(" {")[0] for l in lines))

    def test_early_class_rules_have_the_same_specificity_as_the_has_rules(self):
        # html.wl-open.wl-open  = (0,2,1) 와 html ...:has(.a.b) 의 :has 인자 (0,2,0)+html (0,0,1) 이 같다.
        css = read("style.css")
        padding = [l for l in css.splitlines() if "padding-right:378px!important" in l]
        self.assertEqual(len(padding), 1)
        self.assertIn("html.wl-open.wl-open body:not(.iframe-mode):not(:has(:fullscreen))", padding[0])
        self.assertIn("min-width:1024px", css[:css.index(padding[0])][-400:], "the reservation stays PC-only")


if __name__ == "__main__":
    unittest.main()
