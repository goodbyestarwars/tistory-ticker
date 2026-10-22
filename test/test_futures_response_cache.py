# -*- coding: utf-8 -*-
"""/futures 응답을 미리 직렬화·압축해 재사용하는지 확인한다.

2026-09-04 실측(운영, GitHub 러너): `/futures?days=365`가 TTFB 2.56초,
`?interval=day&days=250`이 TTFB 3.71초. 비압축 본문은 1.36MB / 1.10MB다.
3초 간격으로 같은 URL을 두 번 불러도 두 번째가 빨라지지 않았다 - `_futures_cache`가
파이썬 리스트만 들고 있고 `envelope()` 직렬화는 매 요청 다시 했기 때문이다.

이게 화면에서 문제가 된 경로: js/kospi-futures.js와 js/overnight-market.js가 이 큰
요청을 10초 abort로 건다. 러너에서 2.5~3.7초면 휴대폰 4G에서는 두 배가 쉽게 나오고,
한 번 삐끗하면 10초를 넘겨 차트가 통째로 비고 "시세를 불러오지 못했어요"가 뜬다.
"""

import gzip
import json
import os
import sys
import unittest
from collections import OrderedDict
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))

import main  # noqa: E402


class FakeRequest:
    def __init__(self, accept_encoding=''):
        self.headers = {'accept-encoding': accept_encoding}
        self.client = None


class FuturesResponseCacheTests(unittest.TestCase):
    def setUp(self):
        self.rows = [{'symbol': 'KOSPI', 'price': 6687.21, 'chart': [{'date': '2026-09-04', 'close': 1.0}]}]

    def test_entry_carries_both_raw_and_gzip_bytes(self):
        entry = main._futures_entry(self.rows)
        self.assertIsInstance(entry['raw'], bytes)
        self.assertIsInstance(entry['gzip'], bytes)
        # 압축본을 풀면 원본과 같아야 한다(이중 압축·불일치 방지).
        self.assertEqual(gzip.decompress(entry['gzip']), entry['raw'])
        body = json.loads(entry['raw'].decode('utf-8'))
        self.assertTrue(body['success'])
        self.assertEqual(body['data'], self.rows)
        # 주간 리포트가 파이썬 값을 그대로 꺼내 쓴다 - 바이트를 다시 파싱하지 않게.
        self.assertIs(entry['data'], self.rows)

    def test_response_sets_content_encoding_only_when_client_accepts_gzip(self):
        entry = main._futures_entry(self.rows)

        gzipped = main._futures_response(FakeRequest('gzip, deflate'), entry)
        self.assertEqual(gzipped.headers['content-encoding'], 'gzip')
        self.assertEqual(gzipped.headers['vary'], 'Accept-Encoding')
        self.assertEqual(gzipped.body, entry['gzip'])

        plain = main._futures_response(FakeRequest(''), entry)
        self.assertNotIn('content-encoding', plain.headers)
        self.assertEqual(plain.body, entry['raw'])

    def test_response_survives_missing_request(self):
        # 내부 호출(주간 리포트 등)에서 request가 없을 수 있다.
        entry = main._futures_entry(self.rows)
        self.assertEqual(main._futures_response(None, entry).body, entry['raw'])


class FuturesCacheTtlTests(unittest.TestCase):
    """캐시 TTL은 수집 주기보다 짧을 이유가 없다.

    2026-09-04: 10초 -> 30초. 수집기 세 개가 전부 30초 주기라, 그보다 짧은 TTL은 같은
    숫자를 다시 만들기만 한다 - 신선도는 하나도 못 얻고 1.36MB 직렬화만 3배로 한다.
    캐시가 만료될 때마다 첫 요청이 TTFB 2.6초를 뒤집어썼고, 프론트가 이 요청에 10초
    abort를 걸고 있어 휴대폰 회선에서 종종 그 문턱을 넘겼다.
    """

    def test_ttl_is_at_least_the_collector_poll_interval(self):
        import btc_futures
        import domestic_futures
        import foreign_futures
        for module in (foreign_futures, domestic_futures, btc_futures):
            with self.subTest(collector=module.__name__):
                self.assertGreaterEqual(main._FUTURES_TTL, module._REALTIME_POLL_SEC)

    def test_ttl_stays_short_enough_to_look_live(self):
        # 너무 길면 "실시간"이라고 부르기 어려워진다 - 프론트 폴링(20~30초)과 같은 눈금.
        self.assertLessEqual(main._FUTURES_TTL, 60)


class StoredFuturesReadTests(unittest.TestCase):
    def setUp(self):
        self.quote = {'symbol': 'USDKRW', 'name': '원/달러', 'price': 1300,
                      'change': 1, 'change_rate': .1, 'high': None, 'low': None,
                      'updated_at': '2026-10-22T04:00:00+00:00'}
        self.chart = [{'date': '20261022', 'close': 1300, 'high': 1301, 'low': 1299}]
        self.conn = Mock()
        self.patches = [patch.object(main, '_futures_cache', OrderedDict()),
                        patch.object(main, '_check_rate_limit'),
                        patch.object(main.db_schema, 'get_conn', return_value=self.conn),
                        patch.object(main.db_schema, 'load_all_future_prices', return_value=[self.quote]),
                        patch.object(main.db_schema, 'load_future_chart', return_value=self.chart),
                        patch.object(main.domestic_futures, 'fetch_fx_realtime', return_value={'price': 1400})]
        self.mocks = [p.start() for p in self.patches]
        for p in self.patches:
            self.addCleanup(p.stop)

    def read(self, stored):
        response = main.futures(FakeRequest(), symbols='USDKRW', stored_only=stored)
        return response, json.loads(response.body)['data'][0]

    def test_stored_reads_skip_provider_and_reuse_cached_bytes(self):
        response, row = self.read(True)
        again, _ = self.read(True)
        self.mocks[-1].assert_not_called()
        self.assertEqual(row['price'], 1300)
        self.assertEqual(row['updated_at'], self.quote['updated_at'])
        self.assertEqual(row['chart'], self.chart)
        self.assertEqual(response.headers['x-market-read-mode'], 'stored')
        self.assertIs(response.body, again.body)
        self.mocks[2].assert_called_once()

    def test_live_and_stored_caches_do_not_contaminate_each_other(self):
        response, live = self.read(False)
        _, stored = self.read(True)
        self.assertEqual(live['price'], 1400)
        self.assertEqual(stored['price'], 1300)
        self.assertNotIn('x-market-read-mode', response.headers)
        self.mocks[-1].assert_called_once()

    def test_missing_stored_quote_does_not_fetch_or_invent_price(self):
        self.mocks[3].return_value = []
        self.mocks[4].return_value = []
        _, row = self.read(True)
        self.assertIsNone(row['price'])
        self.assertEqual(row['chart'], [])
        self.mocks[-1].assert_not_called()


if __name__ == '__main__':
    unittest.main()
