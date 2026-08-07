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

    def test_rejects_unknown_group(self):
        with self.assertRaises(watchlist.WatchlistConfigError):
            watchlist.normalize_config({
                'items': [{'code': '005930', 'name': '삼성전자', 'groupId': 'missing'}],
                'groups': [],
            })


if __name__ == '__main__':
    unittest.main()
