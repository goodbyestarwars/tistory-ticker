"""Shared spacing contracts across Tistory, standalone documents and carousels."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class CommonSpacingTest(unittest.TestCase):
    def test_main_and_documents_use_one_responsive_token_source(self):
        tokens = (ROOT / 'css/ui-spacing.css').read_text(encoding='utf-8')
        for name, desktop, mobile in [('card-padding', 18, 14), ('section-gap', 20, 16), ('paragraph-gap', 14, 12)]:
            self.assertRegex(tokens, rf'--ui-{name}: {desktop}px;')
            self.assertRegex(tokens, rf'--ui-{name}: {mobile}px;')
        self.assertIn('(max-width: 760px)', tokens)
        for entry in ['style.css', 'css/legal.css']:
            css = (ROOT / entry).read_text(encoding='utf-8')
            self.assertIn('ui-spacing.css', css)
            self.assertNotRegex(css, r'--ui-(?:card-padding|section-gap|paragraph-gap):\s*\d+px')

    def test_carousel_card_width_and_gaps_share_the_same_measure(self):
        css = (ROOT / 'style.css').read_text(encoding='utf-8')
        formulas = []
        for match in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
            if '.learn-card-grid' not in match[1]:
                continue
            for value in re.findall(r'grid-auto-columns:\s*([^;]+)', match[2]):
                if 'calc(' in value:
                    formulas.append(value)
                    self.assertIn('var(--ui-section-gap)', value)
            for value in re.findall(r'(?<![\w-])(?:column-gap|row-gap):\s*([^;]+)', match[2]):
                self.assertNotRegex(value, r'^\d+px')
        self.assertGreaterEqual(len(formulas), 3)

    def test_dense_table_and_chart_geometry_is_outside_spacing_module(self):
        tokens = (ROOT / 'css/ui-spacing.css').read_text(encoding='utf-8')
        self.assertNotRegex(tokens, r'(?:\btd\b|\bth\b|canvas|svg)\s*\{')
        self.assertNotIn('!important', tokens)


if __name__ == '__main__':
    unittest.main()
