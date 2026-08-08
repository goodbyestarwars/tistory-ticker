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

    def test_search_keeps_us_equities_and_etfs(self):
        payload = {
            'quotes': [
                {'symbol': 'AAPL', 'quoteType': 'EQUITY', 'exchange': 'NMS', 'longname': 'Apple Inc.', 'exchDisp': 'NASDAQ'},
                {'symbol': '7203.T', 'quoteType': 'EQUITY', 'exchange': 'TSE', 'longname': 'Toyota'},
                {'symbol': 'SPY', 'quoteType': 'ETF', 'exchange': 'PCX', 'shortname': 'SPDR S&P 500 ETF'},
            ]
        }
        with mock.patch.object(us_stocks, '_get_json', return_value=payload):
            rows = us_stocks.search('apple')
        self.assertEqual([row['symbol'] for row in rows], ['AAPL', 'SPY'])
        self.assertEqual(rows[0]['code'], 'US:AAPL')

    def test_quote_normalizes_chart_payload(self):
        payload = {
            'chart': {'result': [{
                'meta': {
                    'currency': 'USD', 'symbol': 'AAPL', 'exchangeName': 'NMS',
                    'fullExchangeName': 'NasdaqGS', 'longName': 'Apple Inc.',
                    'regularMarketPrice': 201.5, 'chartPreviousClose': 200.0,
                    'regularMarketDayHigh': 203.0, 'regularMarketDayLow': 198.0,
                    'regularMarketVolume': 123456, 'fiftyTwoWeekHigh': 220.0,
                    'fiftyTwoWeekLow': 150.0, 'currentTradingPeriod': {},
                },
                'timestamp': [100, 200],
                'indicators': {'quote': [{'close': [200.5, 201.5]}]},
            }]}
        }
        with mock.patch.object(us_stocks, '_get_json', return_value=payload):
            data = us_stocks.quote('US:AAPL')
        self.assertEqual(data['symbol'], 'AAPL')
        self.assertEqual(data['price'], 201.5)
        self.assertEqual(data['change'], 1.5)
        self.assertEqual(data['change_rate'], 0.75)
        self.assertEqual(data['code'], 'US:AAPL')

    def test_invalid_symbol_is_rejected(self):
        with self.assertRaises(ValueError):
            us_stocks.normalize_symbol('AAPL/../../etc')


if __name__ == '__main__':
    unittest.main()
