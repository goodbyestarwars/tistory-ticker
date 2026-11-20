"""서버 간 HMAC 읽기 허용(main.py _has_research_scan_signature) 회귀 - 실행: python test/test_agent_signed_reads.py

main.py 전체를 import 하지 않고(FastAPI·외부 키 의존) 해당 블록만 떼어 실제 autotrader_control 서명으로 검증한다.
"""
import hashlib
import hmac
import os
import re
import sys
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import autotrader_control  # noqa: E402

KEY = 'k' * 40


def _load():
    src = open(os.path.join(ROOT, 'scripts', 'cloud-vm', 'main.py'), encoding='utf-8').read()
    block = re.search(r"^AGENT_SIGNED_READ_PATHS = .*?(?=^@app\.middleware)", src, re.S | re.M).group(0)
    scope = {'autotrader_control': autotrader_control}
    exec(block, scope)
    return scope


class _Url:
    def __init__(self, path):
        self.path = path


class _Req:
    def __init__(self, method, path, headers):
        self.method, self.url, self.headers = method, _Url(path), headers


def _headers(message, ts=None, key=KEY):
    ts = str(ts if ts is not None else int(time.time()))
    sig = hmac.new(key.encode(), (ts + '.').encode() + message, hashlib.sha256).hexdigest()
    return {'x-ts': ts, 'x-sig': sig}


class AgentSignedReads(unittest.TestCase):
    def setUp(self):
        os.environ['AUTOTRADER_CONTROL_SECRET'] = KEY
        self.ns = _load()
        self.check = self.ns['_has_research_scan_signature']

    def tearDown(self):
        os.environ.pop('AUTOTRADER_CONTROL_SECRET', None)

    def test_allowed_paths(self):
        self.assertEqual(self.ns['AGENT_SIGNED_READ_PATHS'], ('/pattern-scan', '/volume-surge-live'))

    def test_each_path_accepts_its_own_signature(self):
        for path in ('/pattern-scan', '/volume-surge-live'):
            self.assertTrue(self.check(_Req('GET', path, _headers(('GET ' + path).encode()))), path)

    def test_signature_not_reusable_across_paths(self):
        self.assertFalse(self.check(_Req('GET', '/volume-surge-live', _headers(b'GET /pattern-scan'))))
        self.assertFalse(self.check(_Req('GET', '/pattern-scan', _headers(b'GET /volume-surge-live'))))

    def test_other_paths_and_methods_rejected(self):
        self.assertFalse(self.check(_Req('GET', '/quote', _headers(b'GET /quote'))))
        self.assertFalse(self.check(_Req('POST', '/volume-surge-live', _headers(b'GET /volume-surge-live'))))

    def test_bad_key_and_stale_timestamp_rejected(self):
        self.assertFalse(self.check(_Req('GET', '/volume-surge-live', _headers(b'GET /volume-surge-live', key='x' * 40))))
        old = int(time.time()) - 600
        self.assertFalse(self.check(_Req('GET', '/volume-surge-live', _headers(b'GET /volume-surge-live', ts=old))))
        self.assertFalse(self.check(_Req('GET', '/volume-surge-live', {})))

    def test_unconfigured_secret_rejected(self):
        os.environ.pop('AUTOTRADER_CONTROL_SECRET', None)
        self.assertFalse(self.check(_Req('GET', '/volume-surge-live', _headers(b'GET /volume-surge-live'))))


if __name__ == '__main__':
    unittest.main()
