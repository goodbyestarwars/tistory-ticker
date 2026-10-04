import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

from google_auth import GoogleAuthService  # noqa: E402
from naver_auth import NaverAuthError, NaverAuthService  # noqa: E402


ENV = {
    'GOOGLE_OAUTH_CLIENT_ID': 'client-id',
    'GOOGLE_OAUTH_CLIENT_SECRET': 'client-secret',
    'AUTH_SESSION_SECRET': 'session-secret',
    'GOOGLE_ADMIN_EMAIL': 'owner@example.com',
}


class NaverAuthTests(unittest.TestCase):
    def test_profile_maps_to_namespaced_user(self):
        user = NaverAuthService.user_from_profile({
            'resultcode': '00',
            'response': {'id': 'abc123', 'email': 'Me@Naver.com', 'nickname': '별'},
        })
        self.assertEqual(user, {'sub': 'naver:abc123', 'email': 'me@naver.com', 'name': '별', 'provider': 'naver'})

    def test_rejected_profile_raises(self):
        with self.assertRaises(NaverAuthError):
            NaverAuthService.user_from_profile({'resultcode': '024', 'message': 'Authentication failed'})

    def test_naver_session_without_email_is_valid_user(self):
        with mock.patch.dict(os.environ, ENV, clear=False):
            auth = GoogleAuthService()
            cookie = auth.make_session({'sub': 'naver:abc', 'email': '', 'name': '별', 'provider': 'naver'})
            status = auth.status(cookie)
        self.assertTrue(status['authenticated'])
        self.assertEqual(status['provider'], 'naver')

    def test_naver_email_matching_admin_is_not_admin(self):
        # 네이버 email은 소유 검증이 보장되지 않는다 - 관리자 이메일과 같아도 관리자가 아니다.
        with mock.patch.dict(os.environ, ENV, clear=False):
            auth = GoogleAuthService()
            cookie = auth.make_session({'sub': 'naver:x', 'email': 'owner@example.com', 'provider': 'naver'})
            self.assertFalse(auth.status(cookie)['isAdmin'])
            google_cookie = auth.make_session({'sub': '123', 'email': 'owner@example.com'})
            self.assertTrue(auth.status(google_cookie)['isAdmin'])

    def test_google_session_still_requires_email(self):
        with mock.patch.dict(os.environ, ENV, clear=False):
            auth = GoogleAuthService()
            self.assertIsNone(auth.read_session(auth.make_session({'sub': '123', 'email': ''})))


if __name__ == '__main__':
    unittest.main()
