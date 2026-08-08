import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import us_stocks


class UsStockTests(unittest.TestCase):
    def setUp(self):
        us_stocks._search_cache.clear()
        us_stocks._quote_cache.clear()
        us_stocks._symbol_cache.update(saved_at=0, rows=[])
        us_stocks._symbol_exchange.clear()

    def test_search_uses_kiwoom_symbol_list(self):
        rows = [
            {'symbol': 'AAPL', 'code': 'US:AAPL', 'name': 'Apple Inc.', 'exchange': 'ND'},
            {'symbol': 'MSFT', 'code': 'US:MSFT', 'name': 'Microsoft Corporation', 'exchange': 'ND'},
            {'symbol': '7203.T', 'code': 'US:7203.T', 'name': 'Toyota', 'exchange': 'TSE'},
        ]
        with mock.patch.object(us_stocks, '_records_from_kiwoom_symbol_list', return_value=rows):
            rows = us_stocks.search('apple')
        self.assertEqual([row['symbol'] for row in rows], ['AAPL'])
        self.assertEqual(rows[0]['code'], 'US:AAPL')

    def test_quote_prefers_kiwoom(self):
        with mock.patch.object(us_stocks, '_kiwoom_quote', return_value={
            'symbol': 'AAPL', 'price': 201.5, 'change': 1.5,
            'change_rate': 0.75, 'provider': 'kiwoom',
        }) as kiwoom, mock.patch.object(us_stocks, '_kis_quote') as kis:
            data = us_stocks.quote('US:AAPL')
        self.assertEqual(data['symbol'], 'AAPL')
        self.assertEqual(data['price'], 201.5)
        self.assertEqual(data['change'], 1.5)
        self.assertEqual(data['change_rate'], 0.75)
        kiwoom.assert_called_once_with('AAPL')
        kis.assert_not_called()

    def test_quote_falls_back_to_kis(self):
        with (
            mock.patch.object(us_stocks, '_kiwoom_quote', side_effect=RuntimeError('kiwoom down')),
            mock.patch.object(us_stocks, '_kis_quote', return_value={
                'symbol': 'MSFT', 'price': 500.0, 'provider': 'kis',
            }) as kis,
        ):
            data = us_stocks.quote('MSFT')
        self.assertEqual(data['provider'], 'kis')
        kis.assert_called_once_with('MSFT')

    def test_broker_quote_normalizes_fields(self):
        data = us_stocks._normalize_quote({
            'stk_nm': 'Apple Inc.', 'cur_prc': '+201.5000',
            'base_close_pric': '200.0000', 'high_pric': '203.0000',
            'low_pric': '198.0000', 'acc_trde_qty': '123456',
        }, 'AAPL', '키움증권 REST API', 'ND')
        self.assertEqual(data['price'], 201.5)
        self.assertEqual(data['change'], 1.5)
        self.assertEqual(data['change_rate'], 0.75)
        self.assertEqual(data['source'], '키움증권 REST API')

    def test_orderbook_maps_kiwoom_levels(self):
        response = {
            'stk_cd': 'AAPL',
            'sel_1bid': '202.10', 'sel_1bid_req': '100',
            'buy_1bid': '202.00', 'buy_1bid_req': '120',
        }
        with mock.patch.dict(os.environ, {'KIWOOM_APPKEY': 'key', 'KIWOOM_SECRETKEY': 'secret'}), \
             mock.patch.object(us_stocks.kiwoom_client, 'get_token', return_value='token'), \
             mock.patch.object(us_stocks.kiwoom_client, 'call_tr', return_value=response):
            data = us_stocks._kiwoom_orderbook('AAPL')
        self.assertEqual(data['asks'][0]['price'], 202.1)
        self.assertEqual(data['bids'][0]['size'], 120.0)

    def test_chart_maps_kiwoom_result_list(self):
        response = {'result_list': [
            {'bus_dt': '20260808', 'cntr_tm': '20260808143000', 'cur_prc': '201.5', 'trde_qty': '10'},
            {'bus_dt': '20260808', 'cntr_tm': '20260808143100', 'cur_prc': '202.7', 'trde_qty': '12'},
        ]}
        with mock.patch.dict(os.environ, {'KIWOOM_APPKEY': 'key', 'KIWOOM_SECRETKEY': 'secret'}), \
             mock.patch.object(us_stocks.kiwoom_client, 'get_token', return_value='token'), \
             mock.patch.object(us_stocks.kiwoom_client, 'call_tr', return_value=response):
            data = us_stocks.chart('AAPL', 'minute')
        self.assertEqual(len(data['points']), 2)
        self.assertEqual(data['points'][0]['price'], 201.5)

    def test_invalid_symbol_is_rejected(self):
        with self.assertRaises(ValueError):
            us_stocks.normalize_symbol('AAPL/../../etc')


if __name__ == '__main__':
    unittest.main()
