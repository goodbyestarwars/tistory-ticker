"""Small Google OpenID Connect helper for site user sessions.

The VM keeps the OAuth client secret and signs the short-lived session cookie.
No Google access or refresh token is stored in the browser or in SQLite.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request


class GoogleAuthError(RuntimeError):
    """Raised when the Google OAuth/OIDC response cannot be trusted."""


def _b64url_decode(value):
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode('ascii'))


def _b64url_encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


class GoogleAuthService:
    AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
    TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
    DISCOVERY_ENDPOINT = 'https://accounts.google.com/.well-known/openid-configuration'
    SESSION_COOKIE = 'google_admin_session'
    STATE_COOKIE = 'google_oauth_state'
    NONCE_COOKIE = 'google_oauth_nonce'
    RETURN_COOKIE = 'google_oauth_return'

    def __init__(self):
        self._jwks = None
        self._jwks_expires_at = 0

    @property
    def client_id(self):
        return os.environ.get('GOOGLE_OAUTH_CLIENT_ID', '').strip()

    @property
    def client_secret(self):
        return os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET', '').strip()

    @property
    def redirect_uri(self):
        return os.environ.get(
            'GOOGLE_OAUTH_REDIRECT_URI',
            'https://goodbyestar.cloud/auth/google/callback',
        ).strip()

    @property
    def success_redirect(self):
        return os.environ.get(
            'GOOGLE_AUTH_SUCCESS_REDIRECT',
            'https://ghlee.tistory.com/page/market-temp',
        ).strip()

    @property
    def admin_email(self):
        return os.environ.get('GOOGLE_ADMIN_EMAIL', 'goodbyestarwars@gmail.com').strip().lower()

    @property
    def session_secret(self):
        # A separate AUTH_SESSION_SECRET is preferred. API_TOKEN is a backwards-
        # compatible fallback so the first rollout does not require two secrets.
        return (os.environ.get('AUTH_SESSION_SECRET') or os.environ.get('API_TOKEN') or '').strip()

    @property
    def configured(self):
        return bool(self.client_id and self.client_secret and self.session_secret)

    def status(self, session_cookie):
        user = self.read_session(session_cookie)
        return {
            'configured': self.configured,
            'authenticated': bool(user),
            'isAdmin': bool(user and user.get('email') == self.admin_email),
            'email': user.get('email') if user else None,
            'name': user.get('name') if user else None,
        }

    def authorization_url(self, state, nonce):
        if not self.configured:
            raise GoogleAuthError('Google OAuth is not configured')
        query = urllib.parse.urlencode({
            'client_id': self.client_id,
            'redirect_uri': self.redirect_uri,
            'response_type': 'code',
            'scope': 'openid email profile',
            'state': state,
            'nonce': nonce,
            'prompt': 'select_account',
        })
        return self.AUTH_ENDPOINT + '?' + query

    def authenticate_code(self, code, nonce):
        token = self._post_form(self.TOKEN_ENDPOINT, {
            'code': code,
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'redirect_uri': self.redirect_uri,
            'grant_type': 'authorization_code',
        })
        id_token = token.get('id_token')
        if not id_token:
            raise GoogleAuthError('Google did not return an ID token')
        return self._verify_id_token(id_token, nonce)

    def make_session(self, user):
        now = int(time.time())
        payload = {
            'sub': user['sub'],
            'email': user['email'],
            'name': user.get('name', ''),
            'iat': now,
            'exp': now + 7 * 24 * 60 * 60,
        }
        encoded = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
        signature = hmac.new(
            self.session_secret.encode('utf-8'),
            encoded.encode('ascii'),
            hashlib.sha256,
        ).digest()
        return encoded + '.' + _b64url_encode(signature)

    def read_session(self, value):
        if not value or not self.session_secret:
            return None
        try:
            encoded, supplied_signature = value.split('.', 1)
            expected_signature = hmac.new(
                self.session_secret.encode('utf-8'),
                encoded.encode('ascii'),
                hashlib.sha256,
            ).digest()
            if not hmac.compare_digest(_b64url_decode(supplied_signature), expected_signature):
                return None
            payload = json.loads(_b64url_decode(encoded).decode('utf-8'))
            if int(payload.get('exp', 0)) <= int(time.time()):
                return None
            if not payload.get('sub') or not payload.get('email'):
                return None
            return payload
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeError):
            return None

    def _verify_id_token(self, token, nonce):
        try:
            header_b64, payload_b64, signature_b64 = token.split('.')
            header = json.loads(_b64url_decode(header_b64).decode('utf-8'))
            payload = json.loads(_b64url_decode(payload_b64).decode('utf-8'))
            signature = _b64url_decode(signature_b64)
        except (ValueError, TypeError, json.JSONDecodeError, UnicodeError) as exc:
            raise GoogleAuthError('malformed Google ID token') from exc

        if header.get('alg') != 'RS256' or not header.get('kid'):
            raise GoogleAuthError('unsupported Google ID token')
        key = next((item for item in self._get_jwks() if item.get('kid') == header['kid']), None)
        if not key or not self._verify_rs256(
            (header_b64 + '.' + payload_b64).encode('ascii'), signature, key
        ):
            raise GoogleAuthError('invalid Google ID token signature')

        issuer = payload.get('iss')
        audience = payload.get('aud')
        if issuer not in ('https://accounts.google.com', 'accounts.google.com'):
            raise GoogleAuthError('invalid Google ID token issuer')
        if self.client_id not in (audience if isinstance(audience, list) else [audience]):
            raise GoogleAuthError('invalid Google ID token audience')
        if payload.get('nonce') != nonce:
            raise GoogleAuthError('invalid Google ID token nonce')
        if int(payload.get('exp', 0)) <= int(time.time()):
            raise GoogleAuthError('expired Google ID token')
        if not payload.get('sub') or not payload.get('email') or payload.get('email_verified') is not True:
            raise GoogleAuthError('Google account email is not verified')

        return {
            'sub': str(payload['sub']),
            'email': str(payload['email']).strip().lower(),
            'name': str(payload.get('name') or ''),
        }

    def _get_jwks(self):
        now = time.time()
        if self._jwks and now < self._jwks_expires_at:
            return self._jwks
        discovery = self._get_json(self.DISCOVERY_ENDPOINT)
        body, headers = self._get_json_with_headers(discovery['jwks_uri'])
        cache_control = headers.get('Cache-Control', '')
        max_age = 3600
        for part in cache_control.split(','):
            part = part.strip()
            if part.startswith('max-age='):
                try:
                    max_age = max(300, min(int(part[8:]), 86400))
                except ValueError:
                    pass
        self._jwks = body.get('keys', [])
        self._jwks_expires_at = now + max_age
        return self._jwks

    @staticmethod
    def _verify_rs256(message, signature, key):
        try:
            modulus = int.from_bytes(_b64url_decode(key['n']), 'big')
            exponent = int.from_bytes(_b64url_decode(key['e']), 'big')
            size = (modulus.bit_length() + 7) // 8
            encoded = pow(int.from_bytes(signature, 'big'), exponent, modulus).to_bytes(size, 'big')
            digest_info = bytes.fromhex(
                '3031300d060960864801650304020105000420'
            ) + hashlib.sha256(message).digest()
            expected = b'\x00\x01' + b'\xff' * (size - len(digest_info) - 3) + b'\x00' + digest_info
            return hmac.compare_digest(encoded, expected)
        except (KeyError, ValueError, TypeError, OverflowError):
            return False

    @staticmethod
    def _get_json(url):
        body, _ = GoogleAuthService._get_json_with_headers(url)
        return body

    @staticmethod
    def _get_json_with_headers(url):
        request = urllib.request.Request(url, headers={'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode('utf-8')), dict(response.headers)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            raise GoogleAuthError('Google metadata request failed') from exc

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
            raise GoogleAuthError('Google token exchange failed') from exc
        if body.get('error'):
            raise GoogleAuthError('Google token exchange was rejected')
        return body
