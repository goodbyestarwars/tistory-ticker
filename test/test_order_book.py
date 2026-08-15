import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import order_book


class OrderBookTests(unittest.TestCase):
    def test_parses_kis_order_book_levels(self):
        row = {
            'askp1': '70100', 'askp_rsqn1': '10',
            'askp2': '70200', 'askp_rsqn2': '20',
            'bidp1': '70000', 'bidp_rsqn1': '30',
        }
        data = order_book._parse_kis_order_book(row, '005930')
        self.assertEqual(data['source'], '한국투자증권 Open API')
        self.assertEqual(data['asks'][0], {'price': 70200.0, 'qty': 20.0})
        self.assertEqual(data['bids'][0], {'price': 70000.0, 'qty': 30.0})

    def test_kis_is_primary_and_kiwoom_is_not_called_when_kis_succeeds(self):
        kis_book = {
            'code': '005930', 'asks': [], 'bids': [],
            'totalAskQty': 0, 'totalBidQty': 0,
            'source': '한국투자증권 Open API',
        }
        with mock.patch.object(order_book, 'fetch_kis_order_book', return_value=kis_book), \
             mock.patch.object(order_book, 'fetch_kis_trade', return_value={'price': 70000}), \
             mock.patch.object(order_book, 'fetch_execution_strength', return_value=None), \
             mock.patch.object(order_book, 'fetch_order_book') as kiwoom_book, \
             mock.patch.object(order_book, 'fetch_trade') as kiwoom_trade:
            data = order_book.fetch_order_book_full(
                '005930', kis_appkey='kis-key', kis_appsecret='kis-secret',
                kiwoom_token='kiwoom-token',
            )

        self.assertEqual(data['source'], '한국투자증권 Open API')
        self.assertEqual(data['trade']['price'], 70000)
        kiwoom_book.assert_not_called()
        kiwoom_trade.assert_not_called()

    def test_kiwoom_is_used_only_when_kis_fails(self):
        kiwoom_book = {
            'code': '005930', 'asks': [], 'bids': [],
            'totalAskQty': 0, 'totalBidQty': 0,
            'source': '키움증권 REST API',
        }
        kiwoom_trade = {'price': 69900}
        with mock.patch.object(order_book, 'fetch_kis_order_book', side_effect=RuntimeError('kis down')), \
             mock.patch.object(order_book, 'fetch_kis_trade', side_effect=RuntimeError('kis down')), \
             mock.patch.object(order_book, 'fetch_execution_strength', return_value=None), \
             mock.patch.object(order_book, 'fetch_order_book', return_value=kiwoom_book) as fetch_book, \
             mock.patch.object(order_book, 'fetch_trade', return_value=kiwoom_trade) as fetch_trade:
            data = order_book.fetch_order_book_full(
                '005930', kis_appkey='kis-key', kis_appsecret='kis-secret',
                kiwoom_token='kiwoom-token',
            )

        self.assertEqual(data['source'], '키움증권 REST API')
        self.assertEqual(data['trade']['price'], 69900)
        fetch_book.assert_called_once_with('kiwoom-token', '005930')
        fetch_trade.assert_called_once_with('kiwoom-token', '005930')


if __name__ == '__main__':
    unittest.main()
