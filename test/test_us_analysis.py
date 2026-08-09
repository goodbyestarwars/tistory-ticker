import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import us_analysis


class UsAnalysisTests(unittest.TestCase):
    def test_missing_key_returns_explicit_unavailable_payload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(us_analysis, 'CACHE_DB_FILE', os.path.join(temp_dir, 'analysis.db')):
                result = us_analysis.get_analysis('AAPL', finnhub_api_key='')
        self.assertFalse(result['available'])
        self.assertIn('FINNHUB_API_KEY', result['errors'][0])

    def test_fetches_and_caches_finnhub_analysis_payload(self):
        def fake_get_json(path, params, api_key):
            if path == '/stock/profile2':
                return {'name': 'Apple Inc.', 'ticker': 'AAPL'}
            if path == '/stock/metric':
                return {'metric': {'peTTM': 32, 'roeTTM': 25, 'revenueGrowthTTMYoy': 8.5, 'netMarginTTM': 24}}
            if path == '/stock/financials-reported':
                return {'data': [{'filedDate': '2026-07-31', 'report': {'ic': {'revenue': 100, 'netIncome': 25}}}]}
            if path == '/stock/earnings':
                return [{'actual': 1.2, 'estimate': 1.0, 'surprisePercent': 20}]
            if path == '/calendar/earnings':
                return {'earningsCalendar': [{'date': '2026-08-15', 'hour': 'amc'}]}
            if path == '/stock/recommendation':
                return [{'strongBuy': 5, 'buy': 10, 'hold': 3, 'sell': 1, 'strongSell': 0}]
            if path == '/stock/insider-transactions':
                return {'data': [{'change': 100}, {'change': -20}]}
            raise AssertionError(path)

        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(us_analysis, 'CACHE_DB_FILE', os.path.join(temp_dir, 'analysis.db')):
                with mock.patch.object(us_analysis, '_get_json', side_effect=fake_get_json) as fetch:
                    result = us_analysis.get_analysis('AAPL', finnhub_api_key='test-key')
                    cached = us_analysis.get_analysis('AAPL', finnhub_api_key='test-key')
        self.assertEqual(result['summary']['pe'], 32)
        self.assertEqual(result['summary']['latest_revenue'], 100)
        self.assertEqual(result['summary']['latest_net_income'], 25)
        self.assertEqual(result['summary']['next_earnings'], '2026-08-15')
        self.assertEqual(result['summary']['insider_net_change'], 80)
        self.assertEqual(cached['summary'], result['summary'])
        self.assertEqual(fetch.call_count, 7)

    def test_reads_finnhub_list_based_income_statement(self):
        financials = {'data': [{'report': {'ic': [
            {'concept': 'CostOfRevenue', 'value': 40},
            {'concept': 'RevenueFromContractWithCustomer', 'value': 100},
            {'concept': 'NetIncomeLoss', 'value': 25},
        ]}}]}
        self.assertEqual(us_analysis._financial_value(financials, 'revenue'), 100)
        self.assertEqual(us_analysis._financial_value(financials, 'netIncome'), 25)


if __name__ == '__main__':
    unittest.main()
