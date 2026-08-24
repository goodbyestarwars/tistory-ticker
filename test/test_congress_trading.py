import os
import tempfile
import unittest
from unittest import mock

import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import congress_trading


class CongressTradingTests(unittest.TestCase):
    def test_normalise_trade_preserves_dates_and_calculates_disclosure_delay(self):
        trade = congress_trading._normalise_trade({
            'Ticker': 'AAPL',
            'Name': 'Test Member',
            'Transaction': 'Purchase',
            'Trade_Size_USD': '$15,001 - $50,000',
            'Traded': '07/24/2026',
            'Filed': '08/21/2026',
            'Party': 'D',
            'Chamber': 'House',
        }, 'AAPL')
        self.assertEqual(trade['traded_date'], '2026-07-24')
        self.assertEqual(trade['filed_date'], '2026-08-21')
        self.assertEqual(trade['delay_days'], 28)
        self.assertEqual(trade['amount'], '$15,001 - $50,000')

    def test_missing_key_is_explicitly_unavailable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(congress_trading, 'CACHE_DB_FILE', os.path.join(temp_dir, 'trades.db')):
                result = congress_trading.get_trades('AAPL', quiver_api_key='')
        self.assertFalse(result['available'])
        self.assertIn('QUIVER_API_KEY', result['errors'][0])
        self.assertIn('복사매매', result['disclaimer'])

    def test_fetches_and_normalises_quiver_rows(self):
        raw = {'data': [
            {
                'Ticker': 'AAPL', 'Name': 'Test Member', 'Transaction': 'Sale',
                'Trade_Size_USD': '$1,001 - $15,000', 'Traded': '2026-08-01',
                'Filed': '2026-08-10', 'Party': 'R', 'Chamber': 'Senate',
            },
        ]}
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(congress_trading, 'CACHE_DB_FILE', os.path.join(temp_dir, 'trades.db')):
                with mock.patch.object(congress_trading, '_get_json', return_value=raw) as fetch:
                    result = congress_trading.get_trades('AAPL', quiver_api_key='test-key')
                    cached = congress_trading.get_trades('AAPL', quiver_api_key='test-key')
        self.assertTrue(result['available'])
        self.assertEqual(result['trades'][0]['member'], 'Test Member')
        self.assertEqual(result['trades'][0]['delay_days'], 9)
        self.assertEqual(cached['trades'], result['trades'])
        fetch.assert_called_once_with('AAPL', 'test-key')


if __name__ == '__main__':
    unittest.main()
