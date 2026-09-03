# -*- coding: utf-8 -*-
"""_kis_us_row의 미국 티커 파싱.

2026-09-03 회귀: symb가 이미 깨끗한 티커인데도 "앞글자가 D면 뗀다" 규칙이 적용돼
DELL이 ELL로 깨졌다. 화면 티커는 물론 code('US:ELL')까지 어긋나 종목 링크가 깨졌다.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))

import market_board  # noqa: E402


class KisUsSymbolTests(unittest.TestCase):
    def _symbol(self, row):
        item = market_board._kis_us_row(row)
        return item and item['symbol'], item and item['code']

    def test_plain_ticker_starting_with_d_is_kept(self):
        for ticker in ('DELL', 'DIS', 'DAL', 'DASH', 'DKNG'):
            with self.subTest(ticker=ticker):
                symbol, code = self._symbol({'symb': ticker, 'last': '10'})
                self.assertEqual(symbol, ticker)
                self.assertEqual(code, 'US:' + ticker)

    def test_ordinary_ticker_unchanged(self):
        symbol, code = self._symbol({'symb': 'KORU', 'last': '19.79'})
        self.assertEqual(symbol, 'KORU')
        self.assertEqual(code, 'US:KORU')

    def test_rsym_prefix_is_stripped_when_symb_missing(self):
        # rsym은 D + 거래소코드 3자 + 티커 형식이다.
        symbol, _ = self._symbol({'rsym': 'DNASAAPL', 'last': '100'})
        self.assertEqual(symbol, 'AAPL')

    def test_rsym_for_ticker_starting_with_d(self):
        symbol, _ = self._symbol({'rsym': 'DNYSDELL', 'last': '100'})
        self.assertEqual(symbol, 'DELL')

    def test_unrecognized_rsym_is_used_as_is(self):
        symbol, _ = self._symbol({'rsym': 'WEIRD', 'last': '1'})
        self.assertEqual(symbol, 'WEIRD')

    def test_symb_wins_over_rsym(self):
        symbol, _ = self._symbol({'symb': 'DELL', 'rsym': 'DNYSDELL', 'last': '1'})
        self.assertEqual(symbol, 'DELL')

    def test_row_without_symbol_is_dropped(self):
        self.assertIsNone(market_board._kis_us_row({'last': '10'}))


if __name__ == '__main__':
    unittest.main()
