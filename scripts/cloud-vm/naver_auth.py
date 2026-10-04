"""Naver Login (네아로) helper for general site user sessions.

2026-10-04: 일반 사용자 로그인에 네이버를 추가한다. 세션 쿠키는 GoogleAuthService가
서명하는 것을 그대로 쓰고(관심종목·메모 등 기존 require_google_user 경로가 바뀌지 않게),
sub에 'naver:' 접두어와 provider='naver'를 넣어 구글 계정과 섞이지 않게 한다.

네이버가 주는 email은 사용자가 동의를 끌 수 있고, 연락처 이메일이라 소유 검증이
보장되지 않는다. 그래서 email은 표시용으로만 쓰고 관리자 판정에는 절대 쓰지 않는다.
네이버 access token은 프로필 조회 직후 버리고 저장하지 않는다.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request


class NaverAuthError(RuntimeError):
    """Raised when the Naver OAuth response cannot be trusted."""


class NaverAuthService:
    AUTH_ENDPOINT = 'https://nid.naver.com/oauth2.0/authorize'
    TOKEN_ENDPOINT = 'https://nid.naver.com/oauth2.0/token'
    PROFILE_ENDPOINT = 'https://openapi.naver.com/v1/nid/me'
    STATE_COOKIE = 'naver_oauth_state'
    RETURN_COOKIE = 'naver_oauth_return'

    @property
    def client_id(self):
        return os.environ.get('NAVER_OAUTH_CLIENT_ID', '').strip()

    @property
    def client_secret(self):
        return os.environ.get('NAVER_OAUTH_CLIENT_SECRET', '').strip()

    @property
    def redirect_uri(self):
        return os.environ.get(
            'NAVER_OAUTH_REDIRECT_URI',
            'https://goodbyestar.cloud/auth/naver/callback',
        ).strip()

    @property
    def configured(self):
        return bool(self.client_id and self.client_secret)

    def authorization_url(self, state):
        if not self.configured:
            raise NaverAuthError('Naver OAuth is not configured')
        query = urllib.parse.urlencode({
            'response_type': 'code',
            'client_id': self.client_id,
            'redirect_uri': self.redirect_uri,
            'state': state,
        })
        return self.AUTH_ENDPOINT + '?' + query

    def authenticate_code(self, code, state):
        token = self._post_form(self.TOKEN_ENDPOINT, {
            'grant_type': 'authorization_code',
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'code': code,
            'state': state,
        })
        access_token = token.get('access_token')
        if not access_token:
            raise NaverAuthError('Naver did not return an access token')
        profile = self._get_profile(access_token)
        return self.user_from_profile(profile)

    @staticmethod
    def user_from_profile(profile):
        if not isinstance(profile, dict) or profile.get('resultcode') != '00':
            raise NaverAuthError('Naver profile request was rejected')
        body = profile.get('response') or {}
        naver_id = str(body.get('id') or '').strip()
        if not naver_id:
            raise NaverAuthError('Naver profile has no id')
        return {
            'sub': 'naver:' + naver_id,
            'email': str(body.get('email') or '').strip().lower(),
            'name': str(body.get('name') or body.get('nickname') or '').strip(),
            'provider': 'naver',
        }

    def _get_profile(self, access_token):
        request = urllib.request.Request(
            self.PROFILE_ENDPOINT,
            headers={'Authorization': 'Bearer ' + access_token, 'Accept': 'application/json'},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode('utf-8'))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            raise NaverAuthError('Naver profile request failed') from exc

    @staticmethod
    def _post_form(url, values):
        request = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(values).encode('utf-8'),
            headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = json.loads(response.read().decode('utf-8'))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            raise NaverAuthError('Naver token exchange failed') from exc
        if body.get('error'):
            raise NaverAuthError('Naver token exchange was rejected')
        return body
