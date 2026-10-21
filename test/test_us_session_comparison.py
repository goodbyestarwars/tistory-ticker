import os
import sys
import unittest
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))
import us_stocks as us

NOW = 1792621078
META = {'symbol': 'TSLA', 'regularMarketPrice': 386.47, 'previousClose': 373.71,
        'regularMarketTime': 1792612800, 'currentTradingPeriod': {'regular': {'end': 1792612800}}}
QUOTE = {'symbol': 'TSLA', 'price': 378.49, 'previous_close': 373.71,
         'change_rate': 1.28, 'market_state': 'post', 'session_date': '2026-10-21'}

class SessionComparisonTests(unittest.TestCase):
    def setUp(self):
        us._regular_close_cache.clear()
        us._quote_cache.clear()

    def test_post_market_baseline_and_cache(self):
        payload = {'chart': {'result': [{'meta': META}]}}
        with mock.patch.object(us.time, 'time', return_value=NOW), mock.patch.object(us, '_get_yahoo_json', return_value=payload) as fetch:
            a = us._with_session_comparison(QUOTE)
            b = us._with_session_comparison(dict(QUOTE, price=378.24))
        self.assertAlmostEqual(a['session_change'], -7.98)
        self.assertAlmostEqual(a['session_change_rate'], -2.0648433, places=6)
        self.assertAlmostEqual(a['regular_session']['change_rate'], 3.41441225, places=6)
        self.assertLess(b['session_change_rate'], a['session_change_rate'])
        self.assertEqual(a['change_rate'], 1.28)  # preserve legacy day-change contract
        fetch.assert_called_once()

    def test_rejects_stale_mismatched_and_unfinished_reference(self):
        for patch in [{'regularMarketTime': 1792526400}, {'symbol': 'AAPL'},
                      {'regularMarketTime': 1792612000},
                      {'currentTradingPeriod': {'regular': {'end': NOW + 3600}}}]:
            us._regular_close_cache.clear()
            with mock.patch.object(us.time, 'time', return_value=NOW):
                result = us._with_session_comparison(QUOTE, dict(META, **patch))
            self.assertIsNone(result['regular_session'])
            self.assertIsNone(result['session_change_rate'])

    def test_regular_does_not_fetch_and_failure_is_cached(self):
        with mock.patch.object(us, '_get_yahoo_json', side_effect=RuntimeError('offline')) as fetch:
            regular = dict(QUOTE, market_state='regular')
            self.assertEqual(us._with_session_comparison(regular), regular)
            for _ in range(2):
                self.assertIsNone(us._with_session_comparison(QUOTE)['session_change_rate'])
        fetch.assert_called_once()

    def test_yahoo_post_bars_when_meta_has_no_post_price(self):
        payload = {'chart': {'result': [{'meta': META, 'timestamp': [1792612500, NOW - 300],
                   'indicators': {'quote': [{'close': [386.4, 378.49]}]}}]}}
        with mock.patch.object(us.time, 'time', return_value=NOW), mock.patch.object(us, '_market_state', return_value='post'), mock.patch.object(us, '_session_date', return_value='2026-10-21'), mock.patch.object(us, '_get_yahoo_json', return_value=payload) as fetch:
            result = us._yahoo_quote('TSLA')
        self.assertEqual(result['price'], 378.49)
        self.assertAlmostEqual(result['session_change'], -7.98)
        fetch.assert_called_once()

if __name__ == '__main__':
    unittest.main()
