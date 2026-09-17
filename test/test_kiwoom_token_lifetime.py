# -*- coding: utf-8 -*-
"""키움 토큰 수명 계산과 거부 시 회복(2026-09-17 장애).

증상: 미국 종목 화면의 호가가 "호가 데이터를 확인할 수 없습니다."로만 떴다.
파고 보니 미국 호가만의 문제가 아니라 **그 프로세스의 키움 토큰이 통째로 죽어 있었다** -
실시간 WebSocket 로그인, 국내 10호가(ka10046), 미국 시세·검색까지 전부 8005였다.
시세·차트·검색은 야후로 조용히 넘어가서 안 보였고, 폴백이 없는 미국 호가만 502로 드러났다.

원인 두 가지:
1. 키움은 `expires_in`(남은 초)이 아니라 `expires_dt`(KST 절대 시각)를 준다. 코드는
   expires_in만 찾다가 못 찾으면 '지금부터 12시간'으로 캐시했다. 키움은 같은 토큰을
   모든 호출자에게 그대로 돌려주므로(실측: 연속 발급해도 문자열 동일) 받는 순간
   이미 수명이 얼마 안 남았을 수 있다. 그날 실제 만료는 받은 지 4시간 22분 뒤였다.
2. 거부당해도(8005) 캐시를 그대로 뒀다. 그래서 죽은 토큰으로 반나절을 계속 두드렸다.
"""

import os
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts', 'cloud-vm'))

import kiwoom_client  # noqa: E402

KST = timezone(timedelta(hours=9))


class ExpiryParsingTest(unittest.TestCase):
    def test_expires_dt_is_read_as_an_absolute_kst_time(self):
        """장애 당일 실제 응답 형태. 20260918 20:10:08 KST = 2026-09-18 11:10:08 UTC."""
        now = 1789600000.0
        got = kiwoom_client._expires_at_from({'expires_dt': '20260918201008'}, now)
        expected = datetime(2026, 9, 18, 20, 10, 8, tzinfo=KST).timestamp()
        self.assertAlmostEqual(got, expected, places=3)

    def test_short_remaining_life_is_not_inflated_to_twelve_hours(self):
        """이게 장애의 핵심이다. 받은 토큰이 4시간 남았으면 4시간으로 봐야 한다."""
        now = datetime(2026, 9, 17, 6, 48, 0, tzinfo=timezone.utc).timestamp()
        got = kiwoom_client._expires_at_from({'expires_dt': '20260917201008'}, now)
        self.assertLess(got - now, 5 * 3600, '실제보다 길게 잡으면 죽은 토큰을 계속 쓴다')
        self.assertGreater(got - now, 4 * 3600)

    def test_expires_in_is_still_honoured_when_present(self):
        now = 1000.0
        self.assertEqual(kiwoom_client._expires_at_from({'expires_in': 7200}, now), now + 7200)

    def test_unknown_shape_falls_back_conservatively(self):
        """만료를 못 읽으면 길게가 아니라 짧게 잡는다 - 재발급은 싸고 죽은 토큰은 비싸다."""
        now = 1000.0
        got = kiwoom_client._expires_at_from({'return_code': 0}, now)
        self.assertEqual(got, now + kiwoom_client.TOKEN_FALLBACK_TTL_SEC)
        self.assertLessEqual(kiwoom_client.TOKEN_FALLBACK_TTL_SEC, 3600)

    def test_malformed_expires_dt_does_not_raise(self):
        now = 1000.0
        for text in ('', '2026', '20261345999999', 'abcdefghijklmn', None):
            got = kiwoom_client._expires_at_from({'expires_dt': text}, now)
            self.assertEqual(got, now + kiwoom_client.TOKEN_FALLBACK_TTL_SEC, text)


class TokenInvalidDetectionTest(unittest.TestCase):
    def test_detects_the_real_8005_message(self):
        """실제로 로그에 찍혔던 응답."""
        self.assertTrue(kiwoom_client.is_token_invalid({
            'return_code': 3,
            'return_msg': '인증에 실패했습니다[8005:Token이 유효하지 않습니다]',
        }))

    def test_websocket_login_reply_has_the_same_shape(self):
        self.assertTrue(kiwoom_client.is_token_invalid({
            'trnm': 'LOGIN', 'return_code': '3',
            'return_msg': '토큰 인증에 실패했습니다. 접속을 종료합니다 [CODE=8005, MESSAGE=Token이 유효하지 않습니다]',
        }))

    def test_other_failures_are_not_treated_as_token_problems(self):
        """1903(종목 없음)은 흔하다. 이걸로 토큰을 버리면 멀쩡한 토큰을 계속 버린다."""
        self.assertFalse(kiwoom_client.is_token_invalid({
            'return_code': 7,
            'return_msg': '서비스를 처리하는 중에 오류가 발생했습니다[1903:종목 정보가 없습니다...]',
        }))

    def test_success_is_never_a_token_problem(self):
        self.assertFalse(kiwoom_client.is_token_invalid({'return_code': 0, 'return_msg': '정상적으로 처리되었습니다'}))
        self.assertFalse(kiwoom_client.is_token_invalid({'stk_cd': 'NVDA'}))
        self.assertFalse(kiwoom_client.is_token_invalid(None))


class InvalidateTokenTest(unittest.TestCase):
    def setUp(self):
        self._saved = dict(kiwoom_client._token_cache)
        self.addCleanup(lambda: kiwoom_client._token_cache.update(self._saved))

    def test_invalidate_clears_the_cache_so_the_next_call_reissues(self):
        kiwoom_client._token_cache.update(token='dead', expires_at=time.time() + 40000)
        self.assertTrue(kiwoom_client.invalidate_token('dead'))
        self.assertIsNone(kiwoom_client._token_cache['token'])
        self.assertEqual(kiwoom_client._token_cache['expires_at'], 0)

    def test_invalidate_does_not_throw_away_a_token_someone_else_just_got(self):
        """느린 스레드가 뒤늦게 옛 토큰의 실패를 보고해도 새 토큰을 지우면 안 된다."""
        kiwoom_client._token_cache.update(token='fresh', expires_at=time.time() + 40000)
        self.assertFalse(kiwoom_client.invalidate_token('dead'))
        self.assertEqual(kiwoom_client._token_cache['token'], 'fresh')

    def test_get_token_reissues_after_invalidation(self):
        calls = []

        def fake_issue(appkey, secretkey):
            calls.append(1)
            return 'token-%d' % len(calls), time.time() + 40000

        original = kiwoom_client._issue_token
        kiwoom_client._issue_token = fake_issue
        self.addCleanup(lambda: setattr(kiwoom_client, '_issue_token', original))

        kiwoom_client._token_cache.update(token=None, expires_at=0)
        self.assertEqual(kiwoom_client.get_token('k', 's'), 'token-1')
        self.assertEqual(kiwoom_client.get_token('k', 's'), 'token-1', '캐시가 살아 있으면 재발급하지 않는다')
        kiwoom_client.invalidate_token('token-1')
        self.assertEqual(kiwoom_client.get_token('k', 's'), 'token-2')

    def test_get_token_refreshes_before_the_reported_expiry(self):
        """만료 5분 전이면 미리 받는다 - 진행 중인 요청이 만료를 밟지 않게."""
        original = kiwoom_client._issue_token
        kiwoom_client._issue_token = lambda a, s: ('new', time.time() + 40000)
        self.addCleanup(lambda: setattr(kiwoom_client, '_issue_token', original))
        kiwoom_client._token_cache.update(token='almost-dead',
                                          expires_at=time.time() + kiwoom_client.TOKEN_REFRESH_MARGIN_SEC - 10)
        self.assertEqual(kiwoom_client.get_token('k', 's'), 'new')


class CallTrInvalidationTest(unittest.TestCase):
    """HTTP 200 + return_code=3으로 오는 거부를 call_tr이 잡아내는지."""

    def setUp(self):
        self._saved = dict(kiwoom_client._token_cache)
        self.addCleanup(lambda: kiwoom_client._token_cache.update(self._saved))
        self._urlopen = kiwoom_client.urllib.request.urlopen
        self.addCleanup(lambda: setattr(kiwoom_client.urllib.request, 'urlopen', self._urlopen))

    def _respond(self, payload):
        import json as _json

        class FakeResponse(object):
            def read(self_inner):
                return _json.dumps(payload, ensure_ascii=False).encode('utf-8')

            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *args):
                return False

        kiwoom_client.urllib.request.urlopen = lambda req, timeout=None: FakeResponse()

    def test_token_rejection_clears_the_cache(self):
        kiwoom_client._token_cache.update(token='dead', expires_at=time.time() + 40000)
        self._respond({'return_code': 3, 'return_msg': '인증에 실패했습니다[8005:Token이 유효하지 않습니다]'})
        kiwoom_client.call_tr('dead', 'ka10046', '/api/dostk/mrkcond', {})
        self.assertIsNone(kiwoom_client._token_cache['token'])

    def test_normal_failures_leave_the_token_alone(self):
        kiwoom_client._token_cache.update(token='live', expires_at=time.time() + 40000)
        self._respond({'return_code': 7, 'return_msg': '[1903:종목 정보가 없습니다...]'})
        kiwoom_client.call_tr('live', 'usa20101', '/api/us/mrkcond', {})
        self.assertEqual(kiwoom_client._token_cache['token'], 'live')

    def test_success_payload_is_returned_unchanged(self):
        kiwoom_client._token_cache.update(token='live', expires_at=time.time() + 40000)
        self._respond({'return_code': 0, 'stk_cd': 'NVDA', 'sel_1bid': '+219.1400'})
        got = kiwoom_client.call_tr('live', 'usa20101', '/api/us/mrkcond', {})
        self.assertEqual(got['sel_1bid'], '+219.1400')
        self.assertEqual(kiwoom_client._token_cache['token'], 'live')


class WsHubLoginRejectionTest(unittest.TestCase):
    """실시간 허브가 죽은 토큰으로 무한 재시도하지 않는지.

    장애 당일 로그: 6초마다 "키움 공유 WebSocket 끊김, 재접속 예정: ... [CODE=8005]"가
    몇 시간 동안 반복됐다. 재접속은 같은 캐시 토큰을 다시 꺼내 쓰니 영원히 같은 자리였다.
    """

    def setUp(self):
        import asyncio
        sys.path.insert(0, os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts', 'cloud-vm'))
        import kiwoom_ws_hub
        self.asyncio = asyncio
        self.hub_module = kiwoom_ws_hub
        self.hub = kiwoom_ws_hub.KiwoomWsHub('k', 's', token_fn=lambda: 'dead')
        self._saved = dict(kiwoom_client._token_cache)
        self.addCleanup(lambda: kiwoom_client._token_cache.update(self._saved))

    def _feed(self, payload):
        import json as _json
        loop = self.asyncio.new_event_loop()
        try:
            return loop.run_until_complete(self.hub._handle_frame(None, _json.dumps(payload, ensure_ascii=False)))
        finally:
            loop.close()

    def test_rejected_login_drops_the_cached_token(self):
        kiwoom_client._token_cache.update(token='dead', expires_at=time.time() + 40000)
        self.hub._login_token = 'dead'
        with self.assertRaises(RuntimeError):
            self._feed({'trnm': 'LOGIN', 'return_code': 3,
                        'return_msg': '토큰 인증에 실패했습니다. 접속을 종료합니다 [CODE=8005, MESSAGE=Token이 유효하지 않습니다]'})
        self.assertIsNone(kiwoom_client._token_cache['token'],
                          '토큰을 안 지우면 재접속이 같은 죽은 토큰을 또 쓴다')

    def test_other_login_failures_keep_the_token(self):
        kiwoom_client._token_cache.update(token='live', expires_at=time.time() + 40000)
        self.hub._login_token = 'live'
        with self.assertRaises(RuntimeError):
            self._feed({'trnm': 'LOGIN', 'return_code': 9, 'return_msg': '접속 제한'})
        self.assertEqual(kiwoom_client._token_cache['token'], 'live')

    def test_successful_login_touches_nothing(self):
        kiwoom_client._token_cache.update(token='live', expires_at=time.time() + 40000)
        self.assertTrue(self._feed({'trnm': 'LOGIN', 'return_code': 0, 'return_msg': 'ok'}))
        self.assertEqual(kiwoom_client._token_cache['token'], 'live')


if __name__ == '__main__':
    unittest.main()
