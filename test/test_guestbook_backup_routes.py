import ast
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import guestbook_backup
from test_guestbook_backup import PAGES, fetch_factory


class Auth:
    configured = True
    SESSION_COOKIE = 'session'

    def read_session(self, token):
        return {'email': 'admin@example.com', 'token': token} if token else None

    def is_admin(self, session):
        return session.get('token') == 'admin'


HEADERS = {'Origin': 'https://ghlee.tistory.com'}


class Routes(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [
            patch.object(guestbook_backup, 'DATA_DIR', Path(self.temp.name)),
            patch.object(guestbook_backup, 'fetch_page', fetch_factory(PAGES)),
            patch.object(guestbook_backup, 'PAGE_DELAY_SEC', 0),
        ]
        for p in self.patches:
            p.start()
        # run()/fetch_all() bind their defaults at definition time, so patch the defaults too.
        self.defaults = guestbook_backup.run.__defaults__
        guestbook_backup.run.__defaults__ = (None, fetch_factory(PAGES), 0, None, False)
        app = FastAPI()
        scope = dict(app=app, Request=Request, HTTPException=HTTPException, json=json, time=time, threading=threading,
                     guestbook_backup=guestbook_backup, GOOGLE_AUTH=Auth(),
                     ALLOWED_BROWSER_ORIGINS={'https://ghlee.tistory.com'},
                     _check_rate_limit=lambda *a, **k: None, envelope=lambda d: dict(success=True, data=d))
        source = (Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/main.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        keep = []
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in (
                    '_autotrader_admin', 'guestbook_backup_status', 'guestbook_backup_run'):
                keep.append(node)
            elif isinstance(node, ast.Assign) and any(getattr(t, 'id', '') in ('_GUESTBOOK_BACKUP_LOCK', '_GUESTBOOK_BACKUP_LAST') for t in node.targets):
                keep.append(node)
        tree.body = keep
        exec(compile(tree, 'main.py', 'exec'), scope)
        self.client = TestClient(app)

    def tearDown(self):
        guestbook_backup.run.__defaults__ = self.defaults
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def test_requires_admin_and_origin(self):
        self.assertEqual(self.client.get('/guestbook-backup/status').status_code, 403)
        self.assertEqual(self.client.post('/guestbook-backup/run', headers=HEADERS).status_code, 403)
        self.client.cookies.set('session', 'admin')
        self.assertEqual(self.client.post('/guestbook-backup/run').status_code, 403)  # missing Origin

    def test_run_then_status_without_content_and_cooldown(self):
        self.client.cookies.set('session', 'admin')
        self.assertFalse(self.client.get('/guestbook-backup/status').json()['data']['exists'])
        result = self.client.post('/guestbook-backup/run', headers=HEADERS)
        self.assertEqual(result.status_code, 200)
        data = result.json()['data']
        self.assertEqual((data['summary']['fetched'], data['summary']['new']), (4, 4))
        self.assertEqual(data['status']['entries'], 4)
        self.assertNotIn('삼성전자', json.dumps(data, ensure_ascii=False))
        self.assertEqual(self.client.post('/guestbook-backup/run', headers=HEADERS).status_code, 429)
        self.assertEqual(self.client.get('/guestbook-backup/status').json()['data']['entries'], 4)


if __name__ == '__main__':
    unittest.main()
