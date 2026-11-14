"""Run the actual access routes in isolation from market collectors and brokers."""
import ast
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, Request, HTTPException
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import access_policy

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.paths=patch.multiple(access_policy, MEMBERS_PATH=self.tmp.name+'/members.json', STATE_PATH=self.tmp.name+'/policy.json')
        self.paths.start()
        app=FastAPI()
        users={'admin':dict(email='admin@example.com',provider='google'),
               'member':dict(email='user@example.com',provider='google',email_verified=True),
               'naver':dict(email='admin@example.com',provider='naver')}
        auth=SimpleNamespace(configured=True,SESSION_COOKIE='session',read_session=lambda c:users.get(c),
             is_admin=lambda s:bool(s and s.get('provider')=='google' and s['email']=='admin@example.com'))
        ns=dict(app=app,Request=Request,HTTPException=HTTPException,GOOGLE_AUTH=auth,
                NAVER_AUTH=SimpleNamespace(configured=False),access_policy=access_policy,json=json,
                ALLOWED_BROWSER_ORIGINS={'https://ghlee.tistory.com'},
                _check_rate_limit=lambda *a,**kw:None,envelope=lambda d:{'data':d},_site_admin=auth.is_admin)
        # naverConfigured requires the secret property but never exposes it.
        auth.session_secret='test-only'
        source=ast.parse((Path(__file__).resolve().parents[1]/'scripts/cloud-vm/main.py').read_text(encoding='utf-8'))
        names={'_autotrader_admin','access_policy_get','access_members_get','access_members_put','_access_denied'}
        module=ast.Module(body=[n for n in source.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names],type_ignores=[])
        exec(compile(module,'access_routes','exec'),ns)
        self.client=TestClient(app)
        self.ns=ns

    def tearDown(self):
        self.client.close();self.paths.stop();self.tmp.cleanup()

    def request(self,method,path,role=None,**kw):
        headers=kw.pop('headers',{})
        if role: headers['Cookie']='session='+role
        return self.client.request(method,path,headers=headers,**kw)

    def test_admin_only_origin_and_private_list(self):
        for role in (None,'member','naver'):
            self.assertEqual(self.request('GET','/access-policy/members',role).status_code,403)
            self.assertEqual(self.request('PUT','/access-policy/members',role,json={'email':'user@example.com','action':'add'}).status_code,403)
        self.assertEqual(self.request('PUT','/access-policy/members','admin',json={}).status_code,403)
        result=self.request('PUT','/access-policy/members','admin',headers={'Origin':'https://ghlee.tistory.com'},json={'email':'USER@example.com','action':'add'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['data']['emails'],['user@example.com'])
        response=self.request('GET','/access-policy/members','admin')
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(self.request('GET','/access-policy','member').json()['data']['isMember'],True)
        self.assertEqual(self.ns['_access_denied'](SimpleNamespace(cookies={'session':'member'})).status_code,403)

    def test_validation_and_revoke(self):
        h={'Origin':'https://ghlee.tistory.com'}
        for body in ({'email':'bad','action':'add'},[],{'email':'user@example.com','action':'promote'}):
            self.assertEqual(self.request('PUT','/access-policy/members','admin',headers=h,json=body).status_code,400)
        for action in ('add','remove'):
            self.assertEqual(self.request('PUT','/access-policy/members','admin',headers=h,json={'email':'user@example.com','action':action}).status_code,200)
        data=self.request('GET','/access-policy','member').json()['data']
        self.assertFalse(data['isMember']);self.assertFalse(data['screens']['stocks']['allowed'])
        self.assertNotIn('emails',data)

if __name__=='__main__':unittest.main()
