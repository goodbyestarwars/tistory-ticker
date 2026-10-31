# -*- coding: utf-8 -*-
"""2장 교육 이미지 삽입과 독자 접근성 회귀 검사."""
import pathlib
import unittest
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
class OrderbookImageTest(unittest.TestCase):
    def test_page_link_and_placement(self):
        content = (ROOT / "learn/order.html").read_text(encoding="utf-8")
        self.assertIn('src="../img/learn-orderbook-pattern.svg"', content)
        self.assertIn('loading="lazy"', content)
        self.assertIn('alt="호가창 상승 시도 사례.', content)
        self.assertIn('체결·거래량·시간에 따른 잔량 변화', content)
        self.assertLess(content.index('id="orderbook-rising-pattern"'), content.index("지정가와 시장가</h2>"))
        self.assertIn(".learn-fig--wide img", (ROOT / "css/legal.css").read_text(encoding="utf-8"))
    def test_svg_and_example_totals(self):
        root = ET.parse(ROOT / "img/learn-orderbook-pattern.svg").getroot()
        self.assertEqual(root.attrib.get("viewBox"), "0 0 920 1116")
        self.assertEqual(len(root.findall(".//*[@id='sell-rows']")), 1)
        self.assertEqual(len(root.findall(".//*[@id='buy-rows']")), 1)
        values = " ".join(x.text or "" for x in root.iter())
        self.assertIn("매도 1,687", values)
        self.assertIn("매수 6,002", values)
        self.assertIn("정적인 호가 스냅샷은 상승 신호가 아니다.", values)
if __name__ == "__main__":
    unittest.main()
