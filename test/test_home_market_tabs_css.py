"""Home market tabs must keep one layout/underline contract.

Regression coverage for the 2026-10-26 market-tab overlap incident.
No browser, trading service, or external network is needed.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "style.css").read_text(encoding="utf-8")
WIDGETS = (ROOT / "js" / "home-widgets.js").read_text(encoding="utf-8")
MAIN = (ROOT / "js" / "skin-main.js").read_text(encoding="utf-8")
HOME = "body#tt-body-index .home-editorial-page .home-market-switch"


def declarations(selector: str) -> str:
    match = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", CSS)
    if match is None:
        raise AssertionError(f"Missing CSS rule: {selector}")
    return match.group(1)


class HomeMarketTabStylesTest(unittest.TestCase):
    def test_tab_selectors_have_single_component_owner(self):
        # Prevent reintroduction into generic segmented/tab selectors and
        # the legacy pill styles (which used important cascade overrides).
        for line in CSS.splitlines():
            if ".home-market-switch" in line and not line.lstrip().startswith("*"):
                self.assertIn(HOME, line, msg=line)

    def test_one_spacing_contract_between_tabs_and_lead_cards(self):
        dashboard = declarations("body#tt-body-index .home-editorial-page")
        switch = declarations(HOME)
        self.assertIn("gap: var(--ui-section-gap)", dashboard)
        self.assertIn("margin: 0", switch)
        self.assertIn("padding: 0", switch)
        self.assertIn("align-self: flex-start", switch)
        self.assertIn("max-width: 100%", switch)
        self.assertIn("overflow-x: auto", switch)
        self.assertNotIn("!important", switch)
        # The widget manager moves the same tab into the dashboard, retaining
        # the gap to the grid regardless of the selected market.
        self.assertIn("dashboard.appendChild(marketSwitch)", WIDGETS)
        self.assertIn("dashboard.appendChild(grid)", WIDGETS)

    def test_shared_straight_hover_active_and_keyboard_underline(self):
        switch = declarations(HOME)
        button = declarations(HOME + " button")
        line = declarations(HOME + " button::after")
        visible = declarations(HOME + " button:is(:hover, .is-active, :focus-visible)::after")
        self.assertIn("align-items: stretch", switch)
        self.assertIn("min-height: 44px", switch)
        self.assertIn("min-height: 44px", button)
        self.assertIn("position: relative", button)
        self.assertIn("border: 0", button)
        self.assertIn("bottom: 0", line)
        self.assertIn("height: 2px", line)
        self.assertIn("opacity: 0", line)
        self.assertIn("opacity: 1", visible)
        self.assertIn('data-home-market-switch="domestic"', MAIN)
        self.assertIn('data-home-market-switch="us"', MAIN)
        self.assertIn('data-home-market-switch="closed"', MAIN)

    def test_dark_theme_stays_on_official_tokens(self):
        self.assertIn("color: var(--dk-text)",
                      declarations("html.dark " + HOME + " button:is(:hover, .is-active, :focus-visible)"))
        self.assertIn("background: var(--dk-text)",
                      declarations("html.dark " + HOME + " button::after"))


if __name__ == "__main__":
    unittest.main()
