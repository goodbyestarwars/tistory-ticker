import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class UiInformationArchitectureTest(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_primary_navigation_has_six_items(self):
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
        self.assertEqual(len(primary_labels), 6)

    def test_navigation_accessibility_contract(self):
        source = self.read("js/skin-menu.js")
        for token in ("aria-haspopup", "aria-expanded", "aria-current", "Escape"):
            self.assertIn(token, source)

    def test_home_compaction_contract(self):
        main = self.read("js/skin-main.js")
        rank = self.read("js/sidebar-rank.js")
        disclosures = self.read("js/quick-indices.js")
        self.assertIn("cards.slice(3)", main)
        self.assertIn("마켓브리핑 전체보기", main)
        self.assertIn("실시간 랭킹", rank)
        self.assertIn("itemHTMLs.slice(0, 5)", disclosures)
        self.assertIn("주요 공시", disclosures)

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
