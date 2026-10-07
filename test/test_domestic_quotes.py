import concurrent.futures
import datetime
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))
import domestic_quotes as quotes


def body(codes=('083650',)):
    return {'result': {'areas': [{'name': 'SERVICE_ITEM', 'datas': [
        {'cd': code, 'nm': '종목', 'mt': '2', 'nv': '57200', 'cv': '1000',
         'cr': '1.72', 'rf': '5', 'aq': '246976'} for code in codes]}]}}


class DomesticQuotesTests(unittest.TestCase):
    def setUp(self):
        quotes._cache.clear()

    def test_codes_are_bounded_validated_and_deduplicated(self):
        self.assertEqual(quotes.normalize_codes('00680k,00680K'), ['00680K'])
        for raw in ('', '083650/../../', ' 083650', ','.join('%06d' % i for i in range(31))):
            with self.assertRaises(ValueError):
                quotes.normalize_codes(raw)

    def test_signed_regular_quote_and_nxt_compatibility(self):
        raw = body()
        raw['result']['areas'][0]['datas'][0]['nxtOverMarketPriceInfo'] = {
            'overPrice': '57,300', 'compareToPreviousClosePrice': '100',
            'fluctuationsRatio': '0.17', 'compareToPreviousPrice': {'code': '2'}}
        regular = datetime.datetime(2026, 10, 7, 10, 0, tzinfo=quotes.KST)
        row = quotes.parse(raw, regular)[0]
        self.assertEqual((row['price'], row['change'], row['changeRate']), (57200, -1000, -1.72))
        row = quotes.parse(raw, regular.replace(hour=17))[0]
        self.assertEqual((row['price'], row['change'], row['changeRate']), (57300, 100, .17))

    def test_overlapping_requests_only_fetch_missing_codes(self):
        with mock.patch.object(quotes.data, '_get_json', side_effect=[body(), body(('005930',))]) as fetch:
            quotes.fetch_quotes(['083650'])
            rows = quotes.fetch_quotes(['083650', '005930'])
            self.assertEqual(len(rows), 2)
            self.assertEqual(fetch.call_count, 2)
            self.assertTrue(fetch.call_args.args[0].endswith('SERVICE_ITEM:005930'))

    def test_concurrent_visitors_share_one_download(self):
        with mock.patch.object(quotes.data, '_get_json', return_value=body()) as fetch:
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                rows = list(pool.map(lambda _: quotes.fetch_quotes(['083650']), range(16)))
            self.assertTrue(all(row[0]['price'] == 57200 for row in rows))
            fetch.assert_called_once()

    def test_expiry_refetches_and_failure_does_not_return_stale_price(self):
        with mock.patch.object(quotes.data, '_get_json', return_value=body()) as fetch:
            quotes.fetch_quotes(['083650'])
            quotes._cache['083650']['t'] -= 6
            quotes.fetch_quotes(['083650'])
            self.assertEqual(fetch.call_count, 2)
            quotes._cache['083650']['t'] -= 6
            fetch.return_value = {}
            with self.assertRaises(RuntimeError):
                quotes.fetch_quotes(['083650'])

    def test_cache_has_fixed_upper_bound(self):
        with mock.patch.object(quotes.data, '_get_json') as fetch:
            for i in range(310):
                code = '%06d' % i
                fetch.return_value = body((code,))
                quotes.fetch_quotes([code])
        self.assertEqual(len(quotes._cache), 300)

    def test_public_route_uses_envelope_validation_and_keeps_private_quote_protected(self):
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        with mock.patch.object(main, '_check_rate_limit'), mock.patch.object(quotes.data, '_get_json', return_value=body()):
            response = client.get('/domestic-quotes?codes=083650', headers={'Origin': 'https://ghlee.tistory.com'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['data'][0]['price'], 57200)
            self.assertEqual(response.headers['access-control-allow-origin'], 'https://ghlee.tistory.com')
            self.assertEqual(client.get('/domestic-quotes?codes=badbad!').status_code, 400)
        with mock.patch.dict('os.environ', {'API_TOKEN': 'test-only-token'}):
            self.assertEqual(client.get('/quote?code=083650').status_code, 401)
