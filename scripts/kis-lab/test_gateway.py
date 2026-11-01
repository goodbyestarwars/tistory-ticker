import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
RealClient = httpx.AsyncClient


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.auth = {'authenticated': True, 'isAdmin': True, 'provider': 'google'}
        self.fail_auth = False
        def handle(request):
            self.calls.append(request)
            if str(request.url) == gateway.AUTH_URL:
                if self.fail_auth:
                    raise httpx.ConnectError('offline')
                if request.headers.get('cookie') != 'google_admin_session=test':
                    return httpx.Response(200, json={'data': {'authenticated': False}})
                return httpx.Response(200, json={'data': self.auth})
            return httpx.Response(200, content=b'upstream-ok', headers={'content-type':'text/plain', 'set-cookie':'must-not-forward=1'})
        self.mock = patch.object(gateway.httpx, 'AsyncClient', side_effect=lambda **kw: RealClient(transport=httpx.MockTransport(handle), **kw))
        self.mock.start()
        self.client = TestClient(gateway.app)
        self.headers = {'Cookie':'google_admin_session=test'}

    def tearDown(self):
        self.client.close()
        self.mock.stop()

    def test_anonymous_cannot_read_ui_assets_or_api(self):
        for path in ('backtest/backtest', 'builder/_next/static/app.js', 'backtest/api/strategies'):
            with self.subTest(path=path):
                self.assertEqual(self.client.get('/kis-tool/' + path).status_code, 403)
        self.assertFalse(self.calls)

    def test_status_is_private_and_cors_allows_only_site(self):
        r = self.client.get('/kis-tool/access', headers={**self.headers, 'Origin':'https://ghlee.tistory.com'})
        self.assertTrue(r.json()['data']['allowed'])
        self.assertIn('no-store', r.headers['cache-control'])
        self.assertEqual(r.headers['access-control-allow-origin'], 'https://ghlee.tistory.com')
        r = self.client.get('/kis-tool/access', headers={'Origin':'https://attacker.example'})
        self.assertNotIn('access-control-allow-origin', r.headers)

    def test_only_verified_google_admin_allowed(self):
        for auth in ({'authenticated':True,'isAdmin':False,'provider':'google'},
                     {'authenticated':True,'isAdmin':True,'provider':'naver'},
                     {'authenticated':False,'isAdmin':True,'provider':'google'}, {}):
            with self.subTest(auth=auth):
                self.auth = auth
                self.assertEqual(self.client.get('/kis-tool/builder/builder', headers=self.headers).status_code,403)

    def test_auth_failure_closed(self):
        self.fail_auth = True
        self.assertEqual(self.client.get('/kis-tool/builder/builder', headers=self.headers).status_code,403)

    def test_portal_and_login(self):
        self.assertEqual(self.client.get('/kis-tool/').status_code,401)
        r = self.client.get('/kis-tool/', headers=self.headers)
        self.assertEqual(r.status_code,200)
        self.assertIn('KIS Trading Tool',r.text)

    def test_proxy_cookie_isolation_and_base_path(self):
        r = self.client.get('/kis-tool/builder/builder?x=1', headers={**self.headers,'Authorization':'secret'})
        self.assertEqual(r.text,'upstream-ok')
        self.assertEqual(str(self.calls[-1].url),'http://127.0.0.1:18300/kis-tool/builder/builder?x=1')
        self.assertNotIn('cookie',self.calls[-1].headers)
        self.assertNotIn('authorization',self.calls[-1].headers)
        self.assertNotIn('set-cookie',r.headers)
        self.client.get('/kis-tool/backtest/api/strategies', headers=self.headers)
        self.assertEqual(str(self.calls[-1].url),'http://127.0.0.1:18802/api/strategies')

    def test_orders_and_broker_mutations_blocked(self):
        for path in ('builder/api/orders/execute','builder/api/orders/cancel','backtest/api/account/info','builder/api/auth/login'):
            with self.subTest(path=path):
                r = self.client.post('/kis-tool/'+path, headers={**self.headers,'Origin':gateway.SITE_ORIGIN},json={})
                self.assertEqual(r.status_code,403)
        self.assertTrue(all(str(r.url)==gateway.AUTH_URL for r in self.calls))

    def test_mutation_csrf(self):
        for origin in ('https://attacker.example',None):
            headers = dict(self.headers)
            if origin: headers['Origin']=origin
            self.assertEqual(self.client.post('/kis-tool/backtest/api/backtest/run',headers=headers,json={}).status_code,403)
        self.assertEqual(self.client.post('/kis-tool/backtest/api/backtest/run',headers={**self.headers,'Origin':gateway.SITE_ORIGIN},json={}).status_code,200)

    def test_traversal_and_unknown_upstream(self):
        for path in ('builder/%252e%252e/auth','builder/a%255cb','https://external.example'):
            self.assertIn(self.client.get('/kis-tool/'+path,headers=self.headers).status_code,(400,404))


if __name__ == '__main__': unittest.main()
