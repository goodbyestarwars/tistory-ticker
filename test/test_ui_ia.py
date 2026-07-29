import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class UiInformationArchitectureTest(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_primary_navigation_has_seven_items(self):
        source = self.read("js/skin-menu.js")
        primary_labels = re.findall(
            r"^\s{4}(?:\{ href: '[^']+', label: '([^']+)' \}|\{\s*$)",
            source,
            re.MULTILINE,
        )
        self.assertEqual(source.count("      label: '시장',"), 1)
        self.assertEqual(source.count("      label: '종목',"), 1)
        self.assertEqual(source.count("      label: '패턴·발굴',"), 1)
        self.assertNotIn("label: '종목뉴스'", source)
        self.assertIn("label: '실시간 시세'", source)
        self.assertIn("{ href: '/page/watchlist', label: 'MY' }", source)
        self.assertEqual(len(primary_labels), 7)

    def test_navigation_accessibility_contract(self):
        source = self.read("js/skin-menu.js")
        for token in ("aria-expanded", "aria-current", "nav-secondary-row", "nav-secondary-separator"):
            self.assertIn(token, source)
        self.assertNotIn("nav-dropdown", source)
        self.assertNotIn("nav-chevron", source)

    def test_home_compaction_contract(self):
        main = self.read("js/skin-main.js")
        rank = self.read("js/sidebar-rank.js")
        indices = self.read("js/quick-indices.js")
        for token in ("오늘의 시장판", "오늘의 패턴", "주요 일정", "home-overview-grid", "home-card-grid"):
            self.assertIn(token, main)
        self.assertIn("slice(0, 3)", main)
        self.assertIn("마켓브리핑 전체보기", main)
        self.assertIn("실시간 랭킹", rank)
        self.assertIn("DEFAULT_SELECTED", indices)
        self.assertNotIn("id=\"qiNews\"", indices)
        self.assertNotIn("loadDisclosures(container);", indices)

    def test_existing_urls_are_preserved(self):
        source = self.read("js/skin-menu.js")
        for url in (
            "/page/foreign-flow",
            "/page/stock-search",
            "/page/pattern-scan",
            "/page/stock-calendar",
        ):
            self.assertIn(url, source)


if __name__ == "__main__":
    unittest.main()
