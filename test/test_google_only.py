import ast
import hashlib
import hmac
import json
import os
import secrets
import sys
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/cloud-vm'))
from google_auth import BrowserLoginBridge, GoogleAuthError, GoogleAuthService

ENV={'GOOGLE_OAUTH_CLIENT_ID':'test-client','GOOGLE_OAUTH_CLIENT_SECRET':'test-secret',
     'AUTH_SESSION_SECRET':'test-session','GOOGLE_ADMIN_EMAIL':'owner@example.com'}


class GoogleOnlyTests(unittest.TestCase):
    def setUp(self):
        self.patch=patch.dict(os.environ,ENV);self.patch.start()
        self.auth=GoogleAuthService()
        self.app=FastAPI()
        scope=dict(app=self.app,Request=Request,HTTPException=HTTPException,RedirectResponse=RedirectResponse,
                   GOOGLE_AUTH=self.auth,NAVER_AUTH=SimpleNamespace(STATE_COOKIE='old_state',RETURN_COOKIE='old_return'),
                   GOOGLE_BROWSER_LOGIN=BrowserLoginBridge(),GoogleAuthError=GoogleAuthError,
                   log_setup=SimpleNamespace(event=lambda *a,**k:None,user_ref=lambda *a:'-'),
                   secrets=secrets,urllib=urllib,hmac=hmac,json=json,envelope=lambda d:dict(data=d))
        source=ast.parse((Path(__file__).resolve().parents[1]/'scripts/cloud-vm/main.py').read_text(encoding='utf-8'))
        names={'require_google_user','_safe_google_return_url','google_auth_start','naver_auth_start',
               'naver_auth_callback','google_auth_me','_site_admin','google_auth_callback',
               '_google_auth_error_redirect','google_site_session','google_site_logout','_google_site_cookie'}
        source.body=[n for n in source.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names]
        exec(compile(source,'main.py','exec'),scope)
        self.scope=scope;self.client=TestClient(self.app, base_url='https://goodbyestar.cloud')
    def tearDown(self):self.patch.stop()
    def cookie(self,**kw):
        return self.auth.make_session(dict(sub='google-user',email='user@example.com',provider='google',**kw))
    def test_signed_non_google_sessions_are_rejected_everywhere(self):
        for user in [dict(sub='naver:1',email='owner@example.com',provider='naver'),
                     dict(sub='naver:1',email='owner@example.com',provider='google'),
                     dict(sub='1',email='owner@example.com',provider='kakao')]:
            cookie=self.auth.make_session(user)
            self.assertFalse(self.auth.status(cookie)['authenticated'])
            with self.assertRaises(HTTPException):
                self.scope['require_google_user'](SimpleNamespace(cookies={self.auth.SESSION_COOKIE:cookie}))
        self.assertFalse(self.scope['_site_admin'](dict(sub='naver:1',email='owner@example.com',provider='naver')))
    def test_google_and_legacy_google_still_work(self):
        for provider in ('google',None):
            user=dict(sub='g',email='owner@example.com')
            if provider:user['provider']=provider
            status=self.auth.status(self.auth.make_session(user))
            self.assertTrue(status['authenticated']);self.assertTrue(status['isAdmin'])
        cookie=self.auth.make_session(dict(sub='g',email='user@example.com'))
        self.assertTrue(self.auth.read_session(cookie))
        self.assertIsNone(self.auth.read_session(cookie+'bad'))
    def test_old_naver_routes_start_only_google_and_never_issue_session(self):
        for url in ['/auth/naver/start?return_to=https%3A%2F%2Fghlee.tistory.com%2Fguestbook',
                    '/auth/naver/callback?code=old-code&state=old-state']:
            response=self.client.get(url,follow_redirects=False)
            self.assertEqual(response.status_code,302)
            self.assertTrue(response.headers['location'].startswith('https://accounts.google.com/'))
            cookies=response.headers.get_list('set-cookie')
            self.assertFalse(any(c.startswith(self.auth.SESSION_COOKIE+'=') for c in cookies))
    def test_status_never_offers_naver_even_when_configured(self):
        response=self.client.get('/auth/google/me')
        self.assertFalse(response.json()['data']['naverConfigured'])

    def test_invalid_oauth_callback_returns_a_303_instead_of_a_server_error(self):
        response = self.client.get('/auth/google/callback', follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        parsed = urllib.parse.urlsplit(response.headers['location'])
        self.assertEqual(parsed.netloc, 'ghlee.tistory.com')
        self.assertEqual(urllib.parse.parse_qs(parsed.query), {'google_auth_error': ['invalid_state']})

    def test_successful_login_uses_a_single_use_site_partition(self):
        verifier = secrets.token_urlsafe(32)
        challenge = hashlib.sha256(verifier.encode('ascii')).hexdigest()
        target = 'https://ghlee.tistory.com/page/stock-search?code=376900#ssChart'
        origin = 'https://ghlee.tistory.com'
        start = self.client.get('/auth/google/start', params={'return_to': target, 'site_challenge': challenge}, follow_redirects=False)
        state = start.cookies[self.auth.STATE_COOKIE]
        with patch.object(self.auth, 'authenticate_code', return_value={'sub': 'g', 'email': 'owner@example.com'}):
            callback = self.client.get('/auth/google/callback', params={'state': state, 'code': 'test'}, follow_redirects=False)
        self.assertEqual(callback.status_code, 303)
        url, ticket = callback.headers['location'].split('&__nine_login=')
        self.assertEqual(url, target)
        self.assertNotIn('owner', ticket)
        # A first-party cookie is unavailable when Safari is on the Tistory origin.
        self.client.cookies.clear()
        body = {'ticket': ticket, 'verifier': verifier}
        self.assertEqual(self.client.post('/auth/google/site-session', json=body, headers={'Origin': 'https://other.test'}).status_code, 403)
        wrong = {**body, 'verifier': secrets.token_urlsafe(32)}
        self.assertEqual(self.client.post('/auth/google/site-session', json=wrong, headers={'Origin': origin}).status_code, 401)
        exchange = self.client.post('/auth/google/site-session', json=body, headers={'Origin': origin})
        self.assertEqual(exchange.status_code, 204)
        cookie = exchange.headers['set-cookie']
        self.assertTrue(cookie.startswith(self.auth.SITE_SESSION_COOKIE + '='))
        for attribute in ('Secure', 'HttpOnly', 'SameSite=none', 'Path=/', 'Partitioned'):
            self.assertIn(attribute, cookie)
        self.assertTrue(self.client.get('/auth/google/me').json()['data']['isAdmin'])
        self.assertEqual(self.client.post('/auth/google/site-session', json=body, headers={'Origin': origin}).status_code, 401)
        self.assertEqual(self.client.post('/auth/google/site-logout', headers={'Origin': 'https://other.test'}).status_code, 403)
        logout = self.client.post('/auth/google/site-logout', headers={'Origin': origin})
        self.assertEqual(logout.status_code, 204)
        self.assertIn('Max-Age=0', logout.headers['set-cookie'])
        self.assertIn('Partitioned', logout.headers['set-cookie'])
        self.assertFalse(self.client.get('/auth/google/me').json()['data']['authenticated'])

    def test_expired_handoff_is_rejected(self):
        bridge = BrowserLoginBridge()
        verifier = secrets.token_urlsafe(32)
        challenge = hashlib.sha256(verifier.encode('ascii')).hexdigest()
        with patch('google_auth.time.monotonic', return_value=100):
            ticket = bridge.issue(challenge, 'session')
        with patch('google_auth.time.monotonic', return_value=100 + bridge.TTL):
            self.assertIsNone(bridge.redeem(ticket, verifier))


if __name__=='__main__':unittest.main()

