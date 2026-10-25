# -*- coding: utf-8 -*-
"""2026년 이야기 시리즈 3부·11장 연결·기존 URL 호환 회귀 검증."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
LEARN = ROOT / "learn"

CHAPTERS = (
    "market.html", "us-market.html", "etf-market.html",
    "chart-patterns.html", "bond-market.html", "fx-market.html",
    "crypto-market.html", "company-analysis.html", "economy-story.html",
    "tax-story.html", "my-rules.html",
)
SUBCHAPTERS = (
    "chart-trends.html", "chart-formations.html", "chart-volume.html",
    "company-financials.html", "company-valuation.html",
)
ECONOMICS = (
    "econ-choice.html", "econ-invisible-hand.html", "econ-inflation.html",
    "econ-business-cycle.html", "econ-money.html", "econ-exchange-rate.html",
)


class StorySeries2026Test(unittest.TestCase):
    def test_table_of_contents_has_all_eleven_chapters_in_order(self):
        text = (LEARN / "index.html").read_text(encoding="utf-8")
        links = re.findall(r'<li><a href="([^"]+\.html)">', text)
        self.assertEqual(links[:11], list(CHAPTERS))
        for name in CHAPTERS + SUBCHAPTERS + ECONOMICS:
            self.assertTrue((LEARN / name).is_file(), name)

    def test_home_cards_match_chapter_order(self):
        text = (ROOT / "js" / "skin-shell.js").read_text(encoding="utf-8")
        footer = text.split('aria-label="이야기 시리즈"', 1)[1]
        cards = re.findall(r'<a class="learn-card"[^>]*href="[^"]*/learn/([^"]+\.html)"', footer)
        self.assertEqual(cards, list(CHAPTERS))
        self.assertEqual(len(cards), 11)
        self.assertNotIn("glossary.html", cards)
        self.assertTrue((LEARN / "glossary.html").is_file())

    def test_chapter_crosslinks_and_svg_markup(self):
        for name in CHAPTERS + SUBCHAPTERS + ECONOMICS:
            with self.subTest(page=name):
                text = (LEARN / name).read_text(encoding="utf-8")
                self.assertEqual(text.count("<svg"), text.count("</svg>"))
                self.assertEqual(text.count("<figure"), text.count("</figure>"))
                self.assertIn('class="learn-crossrefs"', text)
                near = text.split('class="learn-crossrefs"', 1)[1].split("</div>", 1)[0]
                self.assertEqual(len(re.findall(r'href="[^"]+\.html"', near)), 2)

    def test_disclaimer_references_and_workbook(self):
        for name in ("preface.html", "disclaimer.html", "references.html",
                     "investment-workbook.html"):
            self.assertTrue((LEARN / name).is_file(), name)
        workbook = (LEARN / "investment-workbook.html").read_text(encoding="utf-8")
        self.assertIn("window.print()", workbook)
        self.assertIn("실현손익", workbook)
        self.assertIn("미실현", workbook)
        css = (ROOT / "css" / "legal.css").read_text(encoding="utf-8")
        self.assertIn('가상 예시', css)
        self.assertIn('.learn-fig:not(.learn-source-chart)', css)


if __name__ == "__main__":
    unittest.main()
