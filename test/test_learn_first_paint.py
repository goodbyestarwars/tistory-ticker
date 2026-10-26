"""Static regression checks for the stock story pages and their first paint.

Run: python -m unittest test.test_learn_first_paint
This covers markup/CSS contracts, not a browser network timing measurement.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
LEARN = ROOT / "learn"
CSS = ROOT / "css" / "legal.css"
STYLE_LINK = '../css/legal.css?v=20261026-story-stable-1'
PRELOAD = (
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/'
    'dist/web/variable/pretendardvariable-dynamic-subset.css'
)


class LearnFirstPaintContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = sorted(LEARN.glob("*.html"))
        cls.css = CSS.read_text(encoding="utf-8")

    def test_every_story_loads_common_css_with_stable_initial_layout(self):
        self.assertGreaterEqual(len(self.pages), 25)
        for page in self.pages:
            html = page.read_text(encoding="utf-8")
            with self.subTest(page=page.name):
                self.assertIn('<body class="learn-page">', html)
                self.assertIn(f'href="{STYLE_LINK}"', html)
                self.assertIn(f'rel="preload" as="style" href="{PRELOAD}"', html)
                self.assertIn('body.learn-page .legal-wrap { max-width: 920px', html)
                self.assertIn('@media (prefers-color-scheme: dark)', html)
                self.assertLess(html.index('body.learn-page .legal-wrap { max-width: 920px'), html.index(STYLE_LINK))
                self.assertIn('href="../css/legal.css?', html)

    def test_common_css_keeps_learning_styles_isolated(self):
        self.assertIn('body.learn-page .legal-wrap {', self.css)
        self.assertIn('max-width: 920px;', self.css)
        self.assertIn('--learn-box: #edf3f8;', self.css)
        self.assertIn('background: #e3edf6;', self.css)
        self.assertIn('.fig-on-strong { fill: #fff;', self.css)
        self.assertIn('.fig-on-accent { fill: #263445;', self.css)
        self.assertIn('.gd-toc { display: grid;', self.css)
        self.assertNotIn('.legal-wrap:has(.learn-nav)', self.css)

    def test_bitcoin_halving_label_is_readable_on_light_svg_box(self):
        html = (LEARN / "crypto-market.html").read_text(encoding="utf-8")
        self.assertRegex(html, r'<text class="fig-ink" x="30" y="90"[^>]*>50개</text>')
        self.assertNotRegex(html, r'<text class="fig-on-accent"[^>]*>50개</text>')

    def test_interaction_script_does_not_gate_page_render(self):
        script = (ROOT / "js" / "site-interactions.js").read_text(encoding="utf-8")
        self.assertIn("pointer.style.cssText", script)
        self.assertIn("visibility:hidden", script)
        for page in self.pages:
            html = page.read_text(encoding="utf-8")
            with self.subTest(page=page.name):
                self.assertIn('defer src="../js/site-interactions.js"', html)


if __name__ == "__main__":
    unittest.main()
