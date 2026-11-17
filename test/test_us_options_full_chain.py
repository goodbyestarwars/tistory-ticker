import gzip
import io
import json
import os
import sys
import tempfile
import types
import unittest
from datetime import date, datetime
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))
# Summary/parser tests do not need broker clients or credentials.
sys.modules.setdefault('kiwoom_client', types.ModuleType('kiwoom_client'))
sys.modules.setdefault('kis_client', types.ModuleType('kis_client'))
import us_options as options


def contract(side, strike, oi=100):
    return {'option': 'SPY261117%s%08d' % (side, strike * 1000), 'gamma': .01,
            'open_interest': oi, 'volume': 30, 'iv': .4, 'bid': 1, 'ask': 2}


class FullChainTests(unittest.TestCase):
    def test_stream_large_gzip_and_strip_unused_fields(self):
        chain = {'timestamp': '2026-11-17 14:30:00', 'data': {'options': [
            dict(contract('C', 100), unused='x' * 2000) for _ in range(2500)], 'current_price': 100.5}}
        raw = json.dumps(chain).encode()
        self.assertGreater(len(raw), 4 * 1024 * 1024)
        response = io.BytesIO(gzip.compress(raw))
        response.headers = {'Content-Encoding': 'gzip'}
        with mock.patch.object(options.urllib.request, 'urlopen', return_value=response):
            result = options._fetch_chain('SPY')
        self.assertEqual(result['data']['current_price'], 100.5)
        self.assertEqual(len(result['data']['options']), 2500)
        self.assertNotIn('unused', result['data']['options'][0])

    def test_chunk_boundaries_unicode_and_number(self):
        raw = json.dumps({'data': {'current_price': 123.456e10, 'options': [contract('P', 100)]},
                          'timestamp': '2026-11-17 14:30:00', 'unused': '한글'}, ensure_ascii=False).encode()
        class Tiny(io.BytesIO):
            def read(self, size=-1):
                return super().read(min(size, 1))
        reader = options._ChainJSON(Tiny(raw))
        self.assertEqual(reader.object()['data']['current_price'], 123.456e10)
        self.assertEqual(reader.peek(), '')

    def test_corrupt_json_and_contract_limit_fail_closed(self):
        for raw in (b'{"data":{"options":[', b'{"data":{"options":[null]}}'):
            response = io.BytesIO(raw); response.headers = {}
            with mock.patch.object(options.urllib.request, 'urlopen', return_value=response):
                with self.assertRaises(options.us_stocks.UsStockUnavailable):
                    options._fetch_chain('SPY')
        raw = json.dumps({'data': {'options': [contract('P', 100)] * 2}}).encode()
        response = io.BytesIO(raw); response.headers = {}
        with mock.patch.object(options, 'MAX_CONTRACTS', 1), mock.patch.object(options.urllib.request, 'urlopen', return_value=response):
            self.assertIsNone(options._fetch_chain('SPY'))

    def test_byte_limit_after_gzip_is_not_silent_partial(self):
        raw = json.dumps({'data': {'options': [dict(contract('C', 100), unused='x'*5000)]}}).encode()
        response = io.BytesIO(gzip.compress(raw)); response.headers = {'Content-Encoding': 'gzip'}
        with mock.patch.object(options, 'MAX_BODY_BYTES', 1000), mock.patch.object(options.urllib.request, 'urlopen', return_value=response):
            self.assertIsNone(options._fetch_chain('SPY'))

    def test_all_strikes_and_maximum_beyond_former_band(self):
        chain = {'data': {'current_price': 100, 'options': [contract('C', 50, 1000),
                 contract('P', 150, 2000), contract('C', 100), contract('P', 100)]}}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(options, 'VOLUME_HISTORY_FILE', os.path.join(tmp, 'history.json')):
            result = options.summarize(chain, date(2026, 11, 17), 'SPY')
        self.assertEqual([r['strike'] for r in result['strikes']], [50, 100, 150])
        self.assertEqual(result['call_wall'], 50)
        self.assertEqual(result['put_wall'], 150)
        self.assertEqual(result['max_call_gex'], .1)
        self.assertEqual(result['max_put_gex'], .2)
        self.assertEqual(result['coverage']['strike_count'], 3)
        self.assertEqual(result['coverage']['contract_count'], 4)


if __name__ == '__main__':
    unittest.main()
