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

    def test_us_row_converts_foreign_profile_market_cap_to_usd(self):
        quote = {'price': 422, 'change': 2, 'change_rate': 0.5, 'volume': 500}
        profile = {
            'name': 'Taiwan Semiconductor Manufacturing Co Ltd',
            'currency': 'TWD',
            'marketCapitalization': 61_330_053,
            'finnhubIndustry': 'Semiconductors',
        }
        with mock.patch.object(market_board.us_stocks, 'quote', return_value=quote), \
                mock.patch.object(market_board.us_analysis, 'get_profile', return_value=profile), \
                mock.patch.object(market_board, '_currency_units_per_usd', return_value=32.257):
            row = market_board._us_row('TSM', 'finnhub-key')

        self.assertAlmostEqual(row['market_cap'], 1_901_294.4, places=1)

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

    def test_us_board_uses_fallback_quotes_when_rank_tr_fails(self):
        def fallback_row(symbol, _api_key):
            return {
                'market': 'us', 'code': 'US:' + symbol, 'symbol': symbol,
                'name': symbol, 'price': 100, 'change_rate': 1,
                'trade_volume': 1000, 'trade_amount': 100000,
                'market_cap': 1000, 'industry': 'Technology', 'currency': 'USD',
            }

        with mock.patch.object(market_board, '_fetch_us_trade_amount_rank', side_effect=RuntimeError('rank down')), \
                mock.patch.object(market_board, '_us_row', side_effect=fallback_row):
            result = market_board.fetch_us('token', limit=2, finnhub_api_key='finnhub-key')

        self.assertEqual(len(result['rows']), 2)
        self.assertIn('fallback', result['source'])

    def test_domestic_board_uses_fallback_quotes_when_rank_is_empty(self):
        fallback = [{
            'market': 'domestic', 'code': '005930', 'name': 'Samsung',
            'price': 70000, 'change_rate': 1, 'trade_volume': 1000,
            'trade_amount': 70000000, 'market_cap': 4000000,
            'industry': 'Technology', 'currency': 'KRW',
        }]
        with mock.patch.object(market_board.market_rank, 'fetch_sidebar_rank', side_effect=RuntimeError('rank down')), \
                mock.patch.object(market_board, '_fallback_domestic', return_value=fallback):
            result = market_board.fetch_domestic('token', limit=1)

        self.assertEqual([row['code'] for row in result['rows']], ['005930'])

    def test_domestic_kis_board_normalizes_rank_sources(self):
        def volume_rank(_token, _appkey, _secret, sort_code='3', limit=20):
            if sort_code == '3':
                return [{'mksc_shrn_iscd': '005930', 'hts_kor_isnm': '삼성전자',
                         'stck_prpr': '70000', 'acml_vol': '1000',
                         'acml_tr_pbmn': '9000000000'}]
            return [{'mksc_shrn_iscd': '000660', 'hts_kor_isnm': 'SK하이닉스',
                     'stck_prpr': '100000', 'acml_vol': '5000',
                     'acml_tr_pbmn': '5000000000'}]

        with mock.patch.object(market_board.kis_client, 'get_token', return_value='kis-token'), \
                mock.patch.object(market_board.kis_client, 'fetch_domestic_volume_rank', side_effect=volume_rank), \
                mock.patch.object(market_board.kis_client, 'fetch_domestic_fluctuation_rank', return_value=[
                    {'mksc_shrn_iscd': '005930', 'stck_prpr': '70000', 'prdy_vrss': '700', 'prdy_ctrt': '1.0'},
                ]), \
                mock.patch.object(market_board.kis_client, 'fetch_domestic_market_cap_rank', return_value=[
                    {'mksc_shrn_iscd': '005930', 'stck_avls': '5000000'},
                ]):
            result = market_board.fetch_domestic_kis('appkey', 'secret', limit=1)

        self.assertEqual(result['source'], 'KIS 국내 순위(거래금액·거래량·등락률·시가총액)')
        self.assertEqual(result['rows'][0]['code'], '005930')
        self.assertEqual(result['rows'][0]['trade_amount'], 9_000_000_000)
        self.assertEqual(result['rows'][0]['market_cap'], 5_000_000)

    def test_us_kis_board_merges_exchange_rankings(self):
        def trade_amount(_token, _appkey, _secret, exchange, limit=20):
            return [{
                'symb': 'AAPL' if exchange == 'NAS' else 'IBM',
                'hts_kor_isnm': '애플' if exchange == 'NAS' else 'IBM',
                'last': '200', 'diff': '2', 'rate': '1.0',
                'tvol': '1000', 'tamt': '300000' if exchange == 'NAS' else '100000',
                'excd': exchange,
            }]

        with mock.patch.object(market_board.kis_client, 'get_token', return_value='kis-token'), \
                mock.patch.object(market_board.kis_client, 'fetch_us_trade_amount_rank', side_effect=trade_amount), \
                mock.patch.object(market_board.kis_client, 'fetch_us_trade_volume_rank', return_value=[]), \
                mock.patch.object(market_board.kis_client, 'fetch_us_market_cap_rank', return_value=[]), \
                mock.patch.object(market_board.kis_client, 'fetch_us_updown_rank', return_value=[]), \
                mock.patch.object(market_board.kis_client, 'fetch_us_volume_surge_rank', return_value=[]), \
                mock.patch.object(market_board.kis_client, 'fetch_us_volume_power_rank', return_value=[]), \
                mock.patch.object(market_board.kis_client, 'fetch_us_new_highlow_rank', return_value=[]):
            result = market_board.fetch_us_kis('appkey', 'secret', limit=2)

        self.assertIn('KIS 미국 순위', result['source'])
        self.assertEqual([row['symbol'] for row in result['rows']], ['AAPL', 'IBM'])
        self.assertEqual(result['rows'][0]['trade_amount'], 300000)
        self.assertIn('marketCap', result['sections'])
        self.assertIn('volumeSurge', result['sections'])


if __name__ == '__main__':
    unittest.main()
