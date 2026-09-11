# -*- coding: utf-8 -*-
"""KIS 액세스 토큰 캐시의 만료 계산과 만료 시 자동 회복.

2026-09-09 실측: `/health/overseas-quote`가 KIS의 `EGW00123`("기간이 만료된 token
입니다")를 반복 반환하는 동안, 같은 시각 같은 서버의 해외 순위 조회는 성공했다.
워커마다 토큰 캐시가 따로인데 만료를 `now + expires_in`으로만 잡아서, 이미 발급된
토큰을 돌려받은 워커가 실제 수명보다 늦게 만료된다고 믿고 죽은 토큰을 계속 내준
것으로 본다. 그 워커의 KIS 호출은 재발급 없이 전부 실패한다.
"""

import os
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))

import kis_client  # noqa: E402

KST = timezone(timedelta(hours=9))


def _kst_text(epoch):
    return datetime.fromtimestamp(epoch, tz=KST).strftime('%Y-%m-%d %H:%M:%S')


class TokenExpiryTests(unittest.TestCase):
    def setUp(self):
        self._post_json = kis_client._post_json
        kis_client.invalidate_token()

    def tearDown(self):
        kis_client._post_json = self._post_json
        kis_client.invalidate_token()

    def _issue(self, payload):
        kis_client._post_json = lambda path, body: dict(payload)
        return kis_client.get_token('k', 's')

    def test_absolute_expiry_shortens_the_cache(self):
        now = time.time()
        self._issue({'access_token': 'T', 'expires_in': 86400,
                     'access_token_token_expired': _kst_text(now + 3600)})
        self.assertAlmostEqual(kis_client._token_cache['expires_at'], now + 3600, delta=5)

    def test_absolute_expiry_never_lengthens_the_cache(self):
        # 절대 만료가 now+expires_in보다 뒤면 채택하지 않는다 - 캐시는 줄이는 쪽으로만 쓴다.
        now = time.time()
        self._issue({'access_token': 'T', 'expires_in': 600,
                     'access_token_token_expired': _kst_text(now + 86400)})
        self.assertAlmostEqual(kis_client._token_cache['expires_at'], now + 600, delta=5)

    def test_unreadable_absolute_expiry_falls_back(self):
        now = time.time()
        for value in ('', None, 'nonsense', '2026/09/09 15:00:00'):
            with self.subTest(value=value):
                kis_client.invalidate_token()
                self._issue({'access_token': 'T', 'expires_in': 86400,
                             'access_token_token_expired': value})
                self.assertAlmostEqual(kis_client._token_cache['expires_at'], now + 86400, delta=5)

    def test_cache_lifetime_has_a_floor(self):
        # 파싱이 어긋나도 매 호출 재발급으로 번지지 않게 한다(KIS 발급은 분당 1회 제한).
        now = time.time()
        self._issue({'access_token': 'T', 'expires_in': 5})
        self.assertGreaterEqual(kis_client._token_cache['expires_at'], now + 60)


class ExpiredTokenRecoveryTests(unittest.TestCase):
    def setUp(self):
        self._post_json = kis_client._post_json
        kis_client.invalidate_token()

    def tearDown(self):
        kis_client._post_json = self._post_json
        kis_client.invalidate_token()

    def test_detects_only_the_expired_token_rejection(self):
        self.assertTrue(kis_client.is_expired_token_error(
            RuntimeError('HHDFS76200200 HTTP 500: {"rt_cd":"1","msg_cd":"EGW00123"}')))
        self.assertFalse(kis_client.is_expired_token_error(RuntimeError('HHDFS76200200 HTTP 500: 서버 오류')))

    def test_retries_once_with_a_reissued_token(self):
        kis_client._post_json = lambda path, body: {'access_token': 'NEW', 'expires_in': 86400}
        seen = []

        def call(tok):
            seen.append(tok)
            if tok == 'OLD':
                raise RuntimeError('HHDFS76200200 HTTP 500: {"msg_cd":"EGW00123"}')
            return 'ok'

        self.assertEqual(kis_client._with_token_retry(call, 'OLD', 'k', 's'), 'ok')
        self.assertEqual(seen, ['OLD', 'NEW'])

    def test_other_failures_are_not_retried(self):
        calls = []

        def call(tok):
            calls.append(tok)
            raise RuntimeError('HHDFS76200200 HTTP 500: 서버 오류')

        with self.assertRaises(RuntimeError):
            kis_client._with_token_retry(call, 'OLD', 'k', 's')
        self.assertEqual(calls, ['OLD'])

    def test_invalidate_keeps_a_token_another_thread_already_reissued(self):
        kis_client._post_json = lambda path, body: {'access_token': 'FRESH', 'expires_in': 86400}
        kis_client.get_token('k', 's')
        self.assertFalse(kis_client.invalidate_token('STALE'))
        self.assertEqual(kis_client._token_cache['token'], 'FRESH')
        self.assertTrue(kis_client.invalidate_token('FRESH'))
        self.assertIsNone(kis_client._token_cache['token'])


class RequestHelpersUseRetryTests(unittest.TestCase):
    """공통 호출기가 실제로 재시도 경로를 타는지 소스로 고정한다.

    호출부는 get_token을 한 번 부르고 그 토큰을 여러 조회에 돌려쓰므로, 회복은 여기서만
    가능하다. 미국 순위는 _get_overseas_rank, 국내 시세는 _get_domestic_quote를 지난다.
    """

    def test_shared_helpers_wrap_calls(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            '..', 'scripts', 'cloud-vm', 'kis_client.py')
        with open(path, encoding='utf-8') as f:
            source = f.read()
        self.assertEqual(source.count('return _with_token_retry(call, token, appkey, appsecret)'), 3)
        for helper in ('def _get_overseas_rank(', 'def _get_domestic_quote(', 'def fetch_overseas_price('):
            with self.subTest(helper=helper):
                body = source.split(helper, 1)[1].split('\ndef ', 1)[0]
                self.assertIn('_with_token_retry(call', body)


if __name__ == '__main__':
    unittest.main()
