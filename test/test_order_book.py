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
            'code': '005930', 'asks': [{'price':70100,'qty':10}], 'bids': [{'price':70000,'qty':20}],
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
            'code': '005930', 'asks': [{'price':70100,'qty':10}], 'bids': [{'price':70000,'qty':20}],
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

    def test_empty_kis_during_open_uses_secondary(self):
        empty = {'asks':[{'price':0,'qty':0}], 'bids':[]}
        valid = {'asks':[{'price':100,'qty':20}], 'bids':[], 'source':'secondary'}
        with mock.patch.object(order_book, '_market_phase', return_value='open'), \
             mock.patch.object(order_book, 'fetch_kis_order_book', return_value=empty), \
             mock.patch.object(order_book, 'fetch_order_book', return_value=valid) as secondary, \
             mock.patch.object(order_book, 'fetch_kis_trade', return_value=None), \
             mock.patch.object(order_book, 'fetch_execution_strength', return_value=None):
            data=order_book.fetch_order_book_full('005930','key','secret','token')
        self.assertTrue(data['available']); self.assertEqual(data['source'],'secondary')
        secondary.assert_called_once()

    def test_empty_before_open_is_explicit_without_extra_query(self):
        empty = {'asks':[{'price':0,'qty':0}], 'bids':[]}
        with mock.patch.object(order_book, '_market_phase', return_value='preopen'), \
             mock.patch.object(order_book, 'fetch_kis_order_book', return_value=empty), \
             mock.patch.object(order_book, 'fetch_order_book') as secondary, \
             mock.patch.object(order_book, 'fetch_kis_trade', return_value=None), \
             mock.patch.object(order_book, 'fetch_execution_strength', return_value=None):
            data=order_book.fetch_order_book_full('005930','key','secret','token')
        self.assertFalse(data['available']);self.assertEqual(data['status'],'preopen')
        self.assertIn('08:00',data['note']);secondary.assert_not_called()

    def test_both_empty_is_not_available(self):
        empty = {'asks':[{'price':0,'qty':0}], 'bids':[]}
        with mock.patch.object(order_book, '_market_phase', return_value='open'), \
             mock.patch.object(order_book, 'fetch_kis_order_book', return_value=empty), \
             mock.patch.object(order_book, 'fetch_order_book', return_value=empty), \
             mock.patch.object(order_book, 'fetch_kis_trade', return_value=None), \
             mock.patch.object(order_book, 'fetch_execution_strength', return_value=None):
            data=order_book.fetch_order_book_full('005930','key','secret','token')
        self.assertFalse(data['available']);self.assertEqual(data['status'],'unavailable')

    def test_one_sided_depth_is_valid_and_never_invents_other_side(self):
        book={'asks':[], 'bids':[{'price':100,'qty':5}]}
        data=order_book._annotate_availability(book,'open')
        self.assertTrue(data['available']);self.assertEqual(data['asks'],[])


if __name__ == '__main__':
    unittest.main()
