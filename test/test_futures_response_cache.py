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


if __name__ == '__main__':
    unittest.main()
