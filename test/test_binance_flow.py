# -*- coding: utf-8 -*-
"""바이낸스 국내주식 토큰 참고 시세 계약(2026-09-15 작업지시서).

실제 네트워크를 쓰지 않는다. 응답 모양은 2026-09-15 로컬 실측값(fapi ticker/24hr·premiumIndex·klines)을 쓴다.
"""

import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import binance_client  # noqa: E402
import binance_flow  # noqa: E402

TICKER = {'symbol': 'SAMSUNGUSDT', 'lastPrice': '182.12000', 'priceChangePercent': '-4.719',
          'highPrice': '191.76000', 'lowPrice': '177.88000', 'quoteVolume': '183823785.34490'}
PREMIUM = {'symbol': 'SAMSUNGUSDT', 'markPrice': '182.04938754', 'lastFundingRate': '0.00020962'}
KLINES = [[1789398000000, '178.57', '181.38', '178.25', '180.87', '84430.23', 1789401599999],
          [1789401600000, '180.87', '182.32', '180.29', '181.81', '25913.97', 1789405199999]]


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(code, body=b'', headers=None):
    return urllib.error.HTTPError('https://x', code, 'err', headers or {}, io.BytesIO(body))


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.original = binance_client._urlopen
        self.addCleanup(setattr, binance_client, '_urlopen', self.original)

    def test_451_is_reported_as_restricted(self):
        def opener(request, timeout):
            raise http_error(451, b'{"code":0,"msg":"Service unavailable from a restricted location"}')
        binance_client._urlopen = opener
        with self.assertRaises(binance_client.BinanceRestricted):
            binance_client.get_json(binance_client.FAPI_BASE, '/fapi/v1/ticker/24hr', {'symbol': 'X'})

    def test_429_waits_retry_after_then_succeeds(self):
        calls = []
        waits = []

        def opener(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise http_error(429, headers={'Retry-After': '3'})
            return FakeResponse(json.dumps({'ok': 1}).encode('utf-8'))
        binance_client._urlopen = opener
        result = binance_client.get_json(binance_client.FAPI_BASE, '/fapi/v1/ping', sleep=waits.append)
        self.assertEqual(result, {'ok': 1})
        self.assertEqual(waits, [3.0])
        self.assertEqual(len(calls), 2)

    def test_invalid_symbol_is_distinguished(self):
        def opener(request, timeout):
            raise http_error(400, b'{"code":-1121,"msg":"Invalid symbol."}')
        binance_client._urlopen = opener
        with self.assertRaises(binance_client.BinanceInvalidSymbol):
            binance_client.get_json(binance_client.SPOT_BASE, '/api/v3/exchangeInfo', {'symbol': 'NOPE'})


class FakeClient:
    BinanceError = binance_client.BinanceError

    def __init__(self, futures=None, spot=None, restricted=False):
        self.futures = futures if futures is not None else {
            'SAMSUNGUSDT': {'status': 'TRADING', 'contractType': 'TRADIFI_PERPETUAL'},
            'SKHYNIXUSDT': {'status': 'TRADING', 'contractType': 'TRADIFI_PERPETUAL'},
        }
        self.spot = spot or {}
        self.restricted = restricted
        self.calls = []

    def _guard(self, name):
        self.calls.append(name)
        if self.restricted:
            raise binance_client.BinanceRestricted('HTTP 451 restricted location')

    def futures_symbol_info(self, symbols):
        self._guard('exchangeInfo')
        return {s: self.futures[s] for s in symbols if s in self.futures}

    def spot_symbol_status(self, symbol):
        self._guard('spotInfo')
        return self.spot.get(symbol)

    def ticker_24hr(self, symbol, market='futures'):
        self._guard('ticker:' + market)
        row = dict(TICKER)
        row['symbol'] = symbol
        return row

    def premium_index(self, symbol):
        self._guard('premium')
        return dict(PREMIUM)

    def klines(self, symbol, market='futures', interval='1h', limit=48):
        self._guard('klines')
        return KLINES


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.db = os.path.join(self.tmp, 'binance.db')
        with binance_flow._lock:
            binance_flow._state.update({'markets': {}, 'items': {}, 'klines': {}, 'restricted': False,
                                        'error': None, 'checkedAt': 0.0, 'quotedAt': 0.0, 'klinesAt': 0.0})

    def test_futures_listing_is_used_and_prices_are_stored(self):
        client = FakeClient()
        items = binance_flow.refresh_once(client, now=1_000_000.0, db_file=self.db)
        self.assertEqual([i['symbol'] for i in items], ['SAMSUNGUSDT', 'SKHYNIXUSDT'])
        samsung = items[0]
        self.assertEqual(samsung['label'], '삼성전자')
        self.assertEqual(samsung['market'], 'futures')
        self.assertEqual(samsung['price'], 182.12)
        self.assertEqual(samsung['changeRate'], -4.719)
        self.assertAlmostEqual(samsung['fundingRate'], 0.00020962)
        payload = binance_flow.get_payload()
        self.assertTrue(payload['available'])
        self.assertIn('참고 지표', payload['note'])
        self.assertEqual(payload['items'][0]['klines'], [[1789398000000, 180.87], [1789401600000, 181.81]])
        conn = sqlite3.connect(self.db)
        try:
            rows = conn.execute('SELECT symbol, ts, price, source FROM binance_prices ORDER BY symbol').fetchall()
        finally:
            conn.close()
        self.assertEqual(rows, [('SAMSUNGUSDT', 1000000, 182.12, 'binance-futures'),
                                ('SKHYNIXUSDT', 1000000, 182.12, 'binance-futures')])

    def test_missing_futures_falls_back_to_spot_or_skips_quietly(self):
        client = FakeClient(futures={'SAMSUNGUSDT': {'status': 'TRADING'}}, spot={'SKHYNIXUSDT': 'TRADING'})
        items = binance_flow.refresh_once(client, now=1_000_000.0, db_file=self.db)
        self.assertEqual({i['symbol']: i['market'] for i in items}, {'SAMSUNGUSDT': 'futures', 'SKHYNIXUSDT': 'spot'})
        # premiumIndex(선물 전용)는 선물로 확인된 SAMSUNGUSDT에만 한 번 부르고, 현물 폴백 종목에는 부르지 않는다.
        self.assertEqual(client.calls.count('premium'), 1)
        self.assertIn('ticker:spot', client.calls)
        client2 = FakeClient(futures={}, spot={})
        with binance_flow._lock:
            binance_flow._state.update({'markets': {}, 'items': {}, 'checkedAt': 0.0})
        self.assertEqual(binance_flow.refresh_once(client2, now=2_000_000.0, db_file=self.db), [])
        self.assertFalse(binance_flow.get_payload()['available'])

    def test_symbol_check_and_klines_are_not_repeated_every_poll(self):
        client = FakeClient()
        binance_flow.refresh_once(client, now=1_000_000.0, db_file=self.db)
        client.calls.clear()
        binance_flow.refresh_once(client, now=1_000_300.0, db_file=self.db)   # 5분 뒤
        self.assertNotIn('exchangeInfo', client.calls)
        self.assertNotIn('klines', client.calls)
        self.assertEqual(client.calls.count('ticker:futures'), 2)

    def test_restricted_location_is_reported_and_polling_backs_off(self):
        client = FakeClient(restricted=True)
        self.assertEqual(binance_flow.refresh_once(client, now=1_000_000.0, db_file=self.db), [])
        payload = binance_flow.get_payload()
        self.assertTrue(payload['restricted'])
        self.assertIn('451', payload['error'])
        self.assertEqual(binance_flow.next_sleep_seconds(), binance_flow.RESTRICTED_RETRY_SEC)

    def test_old_rows_are_pruned(self):
        conn = sqlite3.connect(self.db)
        try:
            binance_flow.ensure_schema(conn)
            binance_flow.store_prices(conn, [{'symbol': 'A', 'price': 1.0, 'market': 'futures'}], now_ts=100)
            binance_flow.store_prices(conn, [{'symbol': 'A', 'price': 2.0, 'market': 'futures'}],
                                      now_ts=100 + (binance_flow.RETENTION_DAYS + 1) * 86400)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM binance_prices').fetchone()[0], 1)
        finally:
            conn.close()


class WiringTests(unittest.TestCase):
    def read(self, *parts):
        with open(os.path.join(ROOT, *parts), encoding='utf-8') as handle:
            return handle.read()

    def test_backend_and_frontend_are_wired(self):
        main = self.read('scripts', 'cloud-vm', 'main.py')
        self.assertIn("@app.get('/binance-kr-equity')", main)
        self.assertIn('binance_flow.get_payload()', main)
        self.assertIn('binance_flow.start_background()', main)
        js = self.read('js', 'overnight-market.js')
        self.assertIn("var BINANCE_API = 'https://goodbyestar.cloud/binance-kr-equity';", js)
        self.assertIn('참고 지표 · 무기한선물 가격(실제 주식 수급 아님)', js)
        self.assertIn('loadBinance(container);', js)

    def test_no_separate_process_or_timer_is_added(self):
        # VM 메모리 여유가 없어 별도 스캔 프로세스·systemd 타이머를 두지 않는다.
        cloud_vm = os.path.join(ROOT, 'scripts', 'cloud-vm')
        self.assertFalse(any('binance' in name for name in os.listdir(cloud_vm) if name.endswith('.sh')))
        self.assertNotIn('binance', self.read('scripts', 'cloud-vm', 'deploy_check.sh'))


if __name__ == '__main__':
    unittest.main()
