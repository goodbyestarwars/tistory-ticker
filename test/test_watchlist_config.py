import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))

import watchlist  # noqa: E402


class WatchlistConfigTests(unittest.TestCase):
    def test_normalize_adds_default_group(self):
        result = watchlist.normalize_config({
            'items': [{'code': '005930', 'name': '삼성전자'}],
            'groups': [],
        })
        self.assertEqual(result['items'][0]['groupId'], 'default')
        self.assertEqual(result['groups'][0]['id'], 'default')

    def test_rejects_duplicate_codes(self):
        with self.assertRaises(watchlist.WatchlistConfigError):
            watchlist.normalize_config({
                'items': [
                    {'code': '005930', 'name': '삼성전자'},
                    {'code': '005930', 'name': '삼성전자'},
                ],
                'groups': [],
            })

    def test_accepts_us_ticker_codes(self):
        result = watchlist.normalize_config({
            'items': [{'code': 'US:TSLA', 'name': 'Tesla, Inc.'}],
            'groups': [],
        })
        self.assertEqual(result['items'][0]['code'], 'US:TSLA')

    def test_accepts_small_holding_metadata_without_market_data(self):
        result = watchlist.normalize_config({
            'items': [{'code': '005930', 'name': '?쇱꽦?꾩옄', 'holding': {'quantity': 12, 'averagePrice': 70000}}],
            'groups': [],
        })
        self.assertEqual(result['items'][0]['holding'], {'quantity': 12.0, 'averagePrice': 70000.0})

    def test_rejects_invalid_holding_metadata(self):
        with self.assertRaises(watchlist.WatchlistConfigError):
            watchlist.normalize_config({
                'items': [{'code': '005930', 'name': '?쇱꽦?꾩옄', 'holding': {'quantity': -1, 'averagePrice': 70000}}],
                'groups': [],
            })

    def test_rejects_malformed_us_ticker_codes(self):
        with self.assertRaises(watchlist.WatchlistConfigError):
            watchlist.normalize_config({
                'items': [{'code': 'US:TSLA!', 'name': 'Tesla, Inc.'}],
                'groups': [],
            })

    def test_rejects_unknown_group(self):
        with self.assertRaises(watchlist.WatchlistConfigError):
            watchlist.normalize_config({
                'items': [{'code': '005930', 'name': '삼성전자', 'groupId': 'missing'}],
                'groups': [],
            })


if __name__ == '__main__':
    unittest.main()
