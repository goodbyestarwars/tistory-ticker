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


class UsNameNormalizationTests(unittest.TestCase):
    """KIS 해외 순위 응답은 ETF에서 영문명/한글명 칸이 뒤집혀 온다.

    2026-09-04 운영 실측(/market-board?market=us 거래대금 상위):
        SOXX -> name_en "SOXX",  name_ko "ISHARES SEMICONDUCTOR"
        RDIV -> name_en "RDIV",  name_ko "INVESCO S&P ULTRA DIVIDEND REVENUE"
    프론트는 한글명을 가장 먼저 고르므로 그대로 두면 30자가 넘는 영문 대문자가
    종목판의 표시 이름이 된다(모바일에서 이름·티커가 통째로 잘려 사라졌다).
    """

    def test_english_name_in_korean_field_moves_to_english_field(self):
        name_en, name_ko = market_board._normalize_us_names('SOXX', 'ISHARES SEMICONDUCTOR', 'SOXX')
        self.assertEqual(name_en, 'ISHARES SEMICONDUCTOR')
        self.assertEqual(name_ko, '')

    def test_ampersand_name_is_handled_like_any_other(self):
        name_en, name_ko = market_board._normalize_us_names(
            'RDIV', 'INVESCO S&P ULTRA DIVIDEND REVENUE', 'RDIV')
        self.assertEqual(name_en, 'INVESCO S&P ULTRA DIVIDEND REVENUE')
        self.assertEqual(name_ko, '')

    def test_real_korean_name_is_kept(self):
        name_en, name_ko = market_board._normalize_us_names('Tesla Inc', '테슬라', 'TSLA')
        self.assertEqual(name_en, 'Tesla Inc')
        self.assertEqual(name_ko, '테슬라')

    def test_english_name_is_not_overwritten_when_it_is_a_real_name(self):
        # 한글명 칸이 영문이어도 이미 정식 영문명이 있으면 그쪽을 유지한다.
        name_en, name_ko = market_board._normalize_us_names(
            'Micron Technology Inc', 'MICRON', 'MU')
        self.assertEqual(name_en, 'Micron Technology Inc')
        self.assertEqual(name_ko, '')

    def test_empty_names_fall_back_to_symbol(self):
        self.assertEqual(market_board._normalize_us_names('', '', 'ABC'), ('ABC', ''))

    def test_kis_row_exposes_normalized_names(self):
        row = market_board._kis_us_row({
            'symb': 'SOXX', 'last': '511.03', 'enam': 'SOXX', 'knam': 'ISHARES SEMICONDUCTOR',
        })
        self.assertEqual(row['name_ko'], '')
        self.assertEqual(row['name_en'], 'ISHARES SEMICONDUCTOR')
        self.assertEqual(row['display_name'], 'ISHARES SEMICONDUCTOR')  # name_en과 동일


if __name__ == '__main__':
    unittest.main()
