import os
import sys
import tempfile
import unittest
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import us_options


def option(symbol_part, strike, volume, interest, gamma=0.01, iv=0.4, bid=1.0, ask=1.2):
    return {'option': 'NVDA261102%s%08d' % (symbol_part, int(strike * 1000)), 'volume': volume,
            'open_interest': interest, 'gamma': gamma, 'iv': iv, 'bid': bid, 'ask': ask}


class UsOptionsOverviewTests(unittest.TestCase):
    def setUp(self):
        handle, self.path = tempfile.mkstemp(suffix='.json')
        os.close(handle)
        os.unlink(self.path)
        self.original = us_options.VOLUME_HISTORY_FILE
        us_options.VOLUME_HISTORY_FILE = self.path

    def tearDown(self):
        us_options.VOLUME_HISTORY_FILE = self.original
        if os.path.exists(self.path):
            os.unlink(self.path)

    def chain(self):
        return {'timestamp': '2026-11-02 18:00:00', 'data': {'current_price': 100.0, 'options': [
            option('C', 95, 10, 100), option('C', 100, 30, 300), option('C', 105, 60, 100),
            option('P', 95, 40, 100), option('P', 100, 20, 300), option('P', 105, 20, 100),
        ]}}

    def test_expired_expiry_left_in_premarket_chain_is_ignored(self):
        chain = self.chain()
        chain['data']['options'].append({'option': 'NVDA261104C00100000', 'volume': 5, 'open_interest': 50,
                                         'gamma': 0.01, 'iv': 0.4, 'bid': 1.0, 'ask': 1.2})
        summary = us_options.summarize(chain, date(2026, 11, 3), 'NVDA')
        self.assertEqual(summary['expiry'], '2026-11-04')
        self.assertFalse(summary['is_0dte'])

    def test_overview_ratios_and_max_pain(self):
        summary = us_options.summarize(self.chain(), date(2026, 11, 2), 'NVDA')
        overview = summary['overview']
        self.assertEqual(overview['max_pain'], 100.0)
        self.assertEqual(overview['pc_volume'], 0.8)
        self.assertEqual(overview['pc_oi'], 1.0)
        self.assertEqual(overview['call_share']['volume'], 55.6)
        self.assertEqual(overview['total_volume'], 180)

    def test_walls_split_above_and_below_price(self):
        overview = us_options.summarize(self.chain(), date(2026, 11, 2), 'NVDA')['overview']
        self.assertGreaterEqual(overview['call_wall'], 100.0)
        self.assertLessEqual(overview['put_wall'], 100.0)

    def test_volume_baseline_needs_full_window(self):
        us_options._volume_baseline('NVDA', date(2026, 10, 29), 100)
        us_options._volume_baseline('NVDA', date(2026, 10, 30), 200)
        us_options._volume_baseline('NVDA', date(2026, 11, 2), 300)
        baseline, days = us_options._volume_baseline('NVDA', date(2026, 11, 3), 300)
        self.assertEqual(days, 3)
        self.assertEqual(baseline, {'3': 150.0})


class CboeFailureLogTests(unittest.TestCase):
    def setUp(self):
        us_options._fail_logged.clear()

    def _fail_with(self, exc):
        import urllib.request
        from unittest import mock
        with mock.patch.object(urllib.request, 'urlopen', side_effect=exc):
            with self.assertRaises(Exception):
                us_options._fetch_chain('NVDA')

    def test_failure_logged_once_per_interval(self):
        import urllib.error
        err = urllib.error.HTTPError('u', 503, 'x', {}, None)
        with self.assertLogs('us_options', level='WARNING') as cm:
            self._fail_with(err)
            self._fail_with(err)
        self.assertEqual(len(cm.output), 1)
        self.assertIn('symbol=NVDA reason=http_503', cm.output[0])

    def test_timeout_logged(self):
        with self.assertLogs('us_options', level='WARNING') as cm:
            self._fail_with(TimeoutError())
        self.assertIn('reason=TimeoutError', cm.output[0])


if __name__ == '__main__':
    unittest.main()
