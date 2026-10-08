import sys
import pathlib
import unittest
from datetime import datetime, timezone
from unittest import mock
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))
import option_flow
import domestic_quotes as quotes
from test_domestic_quotes import body

class RequestedFixes(unittest.TestCase):
    def test_expiry_closes_at_1520_kst_and_uses_timezone(self):
        for hour, minute, expected in [(15, 19, '202610'), (15, 20, '202611'), (22, 0, '202611')]:
            date = datetime(2026, 10, 8, hour, minute, tzinfo=quotes.KST)
            self.assertEqual(option_flow.nearest_option_maturity_yyyymm(date), expected)
            self.assertEqual(option_flow.nearest_option_maturity_yyyymm(date.astimezone(timezone.utc)), expected)
        self.assertEqual(option_flow.nearest_option_maturity_yyyymm(datetime(2026, 12, 10, 16)), '202701')

    def test_sector_downloads_are_bounded_and_share_quote_cache(self):
        quotes._cache.clear()
        codes = ['%06d' % i for i in range(238)]
        def get(url, **kwargs):
            return body(url.split('SERVICE_ITEM:')[1].split(','))
        with mock.patch.object(quotes.data, '_get_json', side_effect=get) as fetch:
            self.assertEqual(len(quotes.fetch_quotes(codes)), 238)
            self.assertEqual(fetch.call_count, 4)
            self.assertTrue(all(len(call.args[0].split('SERVICE_ITEM:')[1].split(',')) <= 60 for call in fetch.call_args_list))
            quotes.fetch_quotes(codes[:30])
            self.assertEqual(fetch.call_count, 4)
        self.assertEqual(len(quotes.normalize_codes(','.join(codes), max_codes=300)), 238)
        with self.assertRaises(ValueError):
            quotes.normalize_codes(','.join(codes))

    def test_sector_public_route_limit_and_response(self):
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        codes = ','.join('%06d' % i for i in range(238))
        with mock.patch.object(main.domestic_quotes, 'fetch_quotes', return_value=[{'code': '005930', 'price': 100}]):
            self.assertEqual(client.get('/sector-quotes', params={'codes': codes}).status_code, 200)
            self.assertEqual(client.get('/sector-quotes', params={'codes': 'badbad!'}).status_code, 400)
