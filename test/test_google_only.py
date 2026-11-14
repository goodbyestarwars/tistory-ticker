import ast
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
from google_auth import GoogleAuthService

ENV={'GOOGLE_OAUTH_CLIENT_ID':'test-client','GOOGLE_OAUTH_CLIENT_SECRET':'test-secret',
     'AUTH_SESSION_SECRET':'test-session','GOOGLE_ADMIN_EMAIL':'owner@example.com'}


class GoogleOnlyTests(unittest.TestCase):
    def setUp(self):
        self.patch=patch.dict(os.environ,ENV);self.patch.start()
        self.auth=GoogleAuthService()
        self.app=FastAPI()
        scope=dict(app=self.app,Request=Request,HTTPException=HTTPException,RedirectResponse=RedirectResponse,
                   GOOGLE_AUTH=self.auth,NAVER_AUTH=SimpleNamespace(STATE_COOKIE='old_state',RETURN_COOKIE='old_return'),
                   secrets=secrets,urllib=urllib,envelope=lambda d:dict(data=d))
        source=ast.parse((Path(__file__).resolve().parents[1]/'scripts/cloud-vm/main.py').read_text(encoding='utf-8'))
        names={'require_google_user','_safe_google_return_url','google_auth_start','naver_auth_start',
               'naver_auth_callback','google_auth_me','_site_admin'}
        source.body=[n for n in source.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names]
        exec(compile(source,'main.py','exec'),scope)
        self.scope=scope;self.client=TestClient(self.app)
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


if __name__=='__main__':unittest.main()

