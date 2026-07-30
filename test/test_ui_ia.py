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

    def test_home_dashboard_contract(self):
        main = self.read("js/skin-main.js")
        widgets = self.read("js/home-widgets.js")
        rank = self.read("js/sidebar-rank.js")
        indices = self.read("js/quick-indices.js")
        for token in ("오늘의 시장판", "오늘의 패턴", "주요 일정", "home-overview-grid", "home-card-grid"):
            self.assertIn(token, main)
        self.assertIn("slice(0, 6)", main)
        self.assertIn("마켓브리핑 전체보기", main)
        self.assertIn("home-briefing-left-more", main)
        self.assertIn("selectedCards.slice(4, 6)", main)
        for token in (
            "data-pattern-key",
            "renderPatternPreview",
            "home-pattern-preview-back",
            "종목 · 스크롤",
            "stock.changeRate",
        ):
            self.assertIn(token, main)
        for token in (
            "investor-flow",
            "market-summary",
            "my-watchlist",
            "disclosure",
            "home_dashboard_layout_v1",
            "dragstart",
            "pointerdown",
            "홈 화면 초기화",
            "data-widget-action=\"hide\"",
        ):
            self.assertIn(token, widgets)
        self.assertIn("실시간 랭킹", rank)
        self.assertIn("DEFAULT_SELECTED", indices)
        self.assertNotIn("id=\"qiNews\"", indices)
        self.assertNotIn("loadDisclosures(container);", indices)

    def test_home_market_direction_uses_index_and_breadth_strength(self):
        source = self.read("js/skin-main.js")
        for token in (
            "resolveMarketDirection",
            "?market=1",
            "kospi.changeRate",
            "kospiRate <= -4",
            "kospiRate >= 0.5",
            "label: '급락'",
            "label: '강한 약세'",
            "label: '상승 우위'",
            "riseRatio <= 0.15",
            "averageRate <= -1",
        ):
            self.assertIn(token, source)

    def test_pattern_schedule_and_rank_compact_layout(self):
        main = self.read("js/skin-main.js")
        style = self.read("style.css")
        self.assertNotIn("}).slice(0, 4);", main)
        self.assertIn("home-pattern-stock-list", main)
        self.assertIn("overflow-y: auto", style)
        self.assertIn("scrollbar-color: transparent transparent", style)
        self.assertIn("scrollbar-width: none", style)
        self.assertIn("home-schedule-content", main)
        schedule = re.search(
            r"function renderSchedule\(result\)(?P<body>.*?)loadHomeScript\(CALENDAR_SCRIPT_URL",
            main,
            re.DOTALL,
        )
        self.assertIsNotNone(schedule)
        self.assertLess(
            schedule.group("body").find("home-schedule-category"),
            schedule.group("body").find("home-schedule-title"),
        )
        self.assertIn("text-overflow: ellipsis", style)
        self.assertIn("white-space: nowrap", style)

    def test_investor_table_fills_card_height(self):
        source = self.read("css/investor-trend-widget.css")
        card_rule = re.search(
            r"#investor-trend-widget \.itw-card \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        table_wrap_rule = re.search(
            r"#investor-trend-widget \.itw-table-wrap \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        body_rule = re.search(
            r"#investor-trend-widget \.itw-body \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        table_rule = re.search(
            r"#investor-trend-widget \.itw-table \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(card_rule)
        self.assertIn("display: flex", card_rule.group("body"))
        self.assertIn("flex-direction: column", card_rule.group("body"))
        self.assertIsNotNone(body_rule)
        self.assertIn("flex: 1 1 auto", body_rule.group("body"))
        self.assertIsNotNone(table_wrap_rule)
        self.assertIn("flex: 1 1 auto", table_wrap_rule.group("body"))
        self.assertIsNotNone(table_rule)
        self.assertIn("height: 100%", table_rule.group("body"))

    def test_pattern_buttons_reset_native_border(self):
        source = self.read("style.css")
        row_rule = re.search(
            r"\.home-pattern-row \{(?P<body>.*?)\}",
            source,
            re.DOTALL,
        )
        self.assertIsNotNone(row_rule)
        self.assertIn("appearance: none", row_rule.group("body"))
        self.assertIn("border: 0", row_rule.group("body"))
        self.assertIn("border-bottom: 1px solid #f0f1f2", row_rule.group("body"))
        self.assertIn("box-shadow: none", row_rule.group("body"))

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
