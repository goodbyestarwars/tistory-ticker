import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import market_board


class MarketBoardTests(unittest.TestCase):
    def test_sections_sort_by_requested_metrics(self):
        rows = [
            {'code': 'A', 'trade_amount': 10, 'trade_volume': 300, 'change_rate': 4, 'market_cap': 100},
            {'code': 'B', 'trade_amount': 30, 'trade_volume': 100, 'change_rate': -7, 'market_cap': 300},
            {'code': 'C', 'trade_amount': 20, 'trade_volume': 200, 'change_rate': 2, 'market_cap': 200},
        ]

        sections = market_board._sections(rows)

        self.assertEqual([row['code'] for row in sections['tradeAmount']], ['B', 'C', 'A'])
        self.assertEqual([row['code'] for row in sections['tradeVolume']], ['A', 'C', 'B'])
        self.assertEqual([row['code'] for row in sections['rising']], ['A', 'C'])
        self.assertEqual([row['code'] for row in sections['falling']], ['B'])
        self.assertEqual([row['code'] for row in sections['marketCap']], ['B', 'C', 'A'])

    def test_domestic_board_converts_trade_amount_and_preserves_name(self):
        rank = {
            'tradeVolume': [{
                'code': '005930', 'name': 'Samsung', 'price': 70000,
                'change_rate': 1.5, 'trade_volume': 1000, 'trade_amount': 7000,
            }],
            'upperLimit': [],
            'lowerLimit': [],
        }
        with mock.patch.object(market_board.market_rank, 'fetch_sidebar_rank', return_value=rank), \
                mock.patch.object(market_board, '_basic_info', return_value={}):
            result = market_board.fetch_domestic('token', limit=1)

        row = result['sections']['tradeAmount'][0]
        self.assertEqual(row['name'], 'Samsung')
        self.assertEqual(row['trade_amount'], 7_000_000_000)
        self.assertEqual(result['market'], 'domestic')

    def test_us_row_uses_quote_and_profile_units(self):
        quote = {'price': 100, 'change': 2, 'change_rate': 2, 'volume': 500}
        profile = {
            'name': 'Example Corp',
            'marketCapitalization': 123456,
            'finnhubIndustry': 'Technology',
        }
        with mock.patch.object(market_board.us_stocks, 'quote', return_value=quote), \
                mock.patch.object(market_board.us_analysis, 'get_profile', return_value=profile):
            row = market_board._us_row('AAPL', 'finnhub-key')

        self.assertEqual(row['name'], 'Example Corp')
        self.assertEqual(row['trade_amount'], 50_000)
        self.assertEqual(row['market_cap'], 123456)
        self.assertEqual(row['industry'], 'Technology')
        self.assertEqual(row['currency'], 'USD')

    def test_us_board_uses_kiwoom_trade_amount_rank(self):
        response = {
            'output': [
                {
                    'stk_cd': 'AAPL',
                    'stk_nm': 'Apple Inc.',
                    'cur_prc': '-201.50',
                    'pred_pre': '-2.50',
                    'flu_rt': '-1.22',
                    'acc_trde_qty': '1000',
                    'trde_prica': '250000',
                    'stex_tp': 'NAS',
                },
                {
                    'stk_cd': 'NVDA',
                    'stk_nm': 'NVIDIA Corporation',
                    'cur_prc': '120.00',
                    'pred_pre': '3.00',
                    'flu_rt': '2.56',
                    'acc_trde_qty': '2000',
                    'trde_prica': '180000',
                    'stex_tp': 'NAS',
                },
            ],
        }
        with mock.patch.object(market_board.kiwoom_client, 'call_tr', return_value=response) as call_tr, \
                mock.patch.object(market_board.us_analysis, 'get_profile', side_effect=[
                    {'name': 'Apple Inc.', 'finnhubIndustry': 'Technology'},
                    {'name': 'NVIDIA Corporation', 'finnhubIndustry': 'Technology'},
                ]):
            result = market_board.fetch_us('token', limit=2, finnhub_api_key='finnhub-key')

        call_tr.assert_called_once_with(
            'token',
            'usa20540',
            '/api/us/rkinfo',
            {
                'stex_tp': '0',
                'inds_cd': '000',
                'stk_tp': '1',
                'trde_qty_tp': '0',
                'stk_cnd': '0',
                'pric_cnd': '0',
                'trde_prica_cnd': '0',
            },
        )
        row = result['rows'][0]
        self.assertEqual(row['symbol'], 'AAPL')
        self.assertEqual(row['price'], 201.5)
        self.assertEqual(row['change'], -2.5)
        self.assertEqual(row['change_rate'], -1.22)
        self.assertEqual(row['trade_amount'], 250_000_000)
        self.assertEqual(row['currency'], 'USD')
        self.assertEqual(result['source'], 'Kiwoom usa20540 미국주식 거래대금 순위 + Finnhub profile2')

    def test_us_board_accepts_nested_rank_payload_and_skips_bad_rows(self):
        response = {
            'result': {
                'result_list': [
                    {'stk_cd': 'MSFT', 'cur_prc': '400', 'trde_prica': '100'},
                    {'cur_prc': '300', 'trde_prica': '90'},
                ],
            },
        }
        with mock.patch.object(market_board.kiwoom_client, 'call_tr', return_value=response), \
                mock.patch.object(market_board.us_analysis, 'get_profile', return_value={}):
            result = market_board.fetch_us('token', limit=2, finnhub_api_key='finnhub-key')

        self.assertEqual([row['symbol'] for row in result['rows']], ['MSFT'])


if __name__ == '__main__':
    unittest.main()
