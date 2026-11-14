import json
import ast
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI, Request, HTTPException
from fastapi.testclient import TestClient
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import discussion_intro
from test_discussion_intro import CONTENT


class Auth:
    configured = True
    SESSION_COOKIE = 'session'
    def read_session(self, token):
        return {'email':'admin@example.com', 'provider':'google' if token != 'naver' else 'naver', 'token':token} if token else None
    def is_admin(self, session):
        return session.get('token') == 'admin' and session.get('provider') == 'google'


class Routes(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(discussion_intro,'STATE_PATH',self.temp.name+'/intro.json')
        self.patch.start()
        app = FastAPI()
        scope = dict(app=app,Request=Request,HTTPException=HTTPException,json=json,discussion_intro=discussion_intro,
                     GOOGLE_AUTH=Auth(), ALLOWED_BROWSER_ORIGINS={'https://ghlee.tistory.com'},
                     _check_rate_limit=lambda *a,**k:None,
                     envelope=lambda d:dict(success=True,data=d))
        tree=ast.parse((Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/main.py').read_text(encoding='utf-8'))
        tree.body=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in
                   ('_autotrader_admin','discussion_intro_get','discussion_intro_put')]
        exec(compile(tree,'main.py','exec'),scope)
        self.client = TestClient(app)
    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()
    def test_public_read_and_admin_only_write(self):
        self.assertEqual(self.client.get('/discussion-intro').status_code,200)
        for token in ('','member','naver'):
            r=self.client.put('/discussion-intro',json={'content':CONTENT,'revision':0},
                              headers={'origin':'https://ghlee.tistory.com','cookie':'session='+token})
            self.assertEqual(r.status_code,403)
        headers={'origin':'https://ghlee.tistory.com','cookie':'session=admin'}
        self.assertEqual(self.client.put('/discussion-intro',json={'content':CONTENT,'revision':0},headers=headers).status_code,200)
        self.assertEqual(self.client.put('/discussion-intro',json={'content':CONTENT,'revision':0},headers=headers).status_code,409)
        self.assertNotIn('admin@example.com',self.client.get('/discussion-intro').text)
    def test_origin_size_json_and_shape(self):
        for origin in ('','https://evil.example'):
            self.assertEqual(self.client.put('/discussion-intro',json={'content':CONTENT,'revision':0},
                headers={'origin':origin,'cookie':'session=admin'}).status_code,403)
        headers={'origin':'https://ghlee.tistory.com','cookie':'session=admin'}
        self.assertEqual(self.client.put('/discussion-intro',content='x'*33000,headers=headers).status_code,413)
        for body in ('{bad','[]','{}'):
            self.assertEqual(self.client.put('/discussion-intro',content=body,headers=headers).status_code,400)


if __name__ == '__main__': unittest.main()

