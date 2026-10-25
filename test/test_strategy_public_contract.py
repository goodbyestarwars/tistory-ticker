"""Execute the real route/projection/cache functions without starting API collectors."""
import ast
import gzip
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]


class Response:
    def __init__(self, content, media_type=None, headers=None):
        self.body, self.headers = content, headers or {}


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code


def functions(folder):
    source = ROOT / 'scripts/cloud-vm/main.py'
    parsed = ast.parse(source.read_text(encoding='utf-8'))
    names = {'_build_strategy_scan', 'strategy_scan_public', 'strategy_scan_batch', '_daily_scan_entry', '_daily_scan_json_response'}
    nodes = [n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    scope = dict(json=json, os=__import__('os'), datetime=datetime, timezone=timezone,
                 gzip_lib=gzip, Response=Response, Request=object, HTTPException=HttpError,
                 Header=lambda **kwargs: None, require_api_key=Mock(side_effect=HttpError(401, 'required')),
                 _check_rate_limit=Mock(), _daily_scan_response_cache={}, _daily_scan_response_lock=threading.Lock(),
                 DAILY_SCAN_CACHE_FILE=str(folder/'daily.json'), STRATEGY_SCAN_CACHE_FILE=str(folder/'strategy.json'))
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
    return scope


class StrategyContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.snapshot = {'scannedAt': '2026-10-23T12:00:00Z', 'scanned': 123, 'universe': 400,
                         'skippedNoData': 3, 'categories': {'value': {'sectors': {'sector': {'matches': [{'code': '005930'}]}}}},
                         'internal': 'must stay private'}
        (self.folder/'strategy.json').write_text(json.dumps(self.snapshot), encoding='utf-8')
        self.scope = functions(self.folder)

    def tearDown(self):
        self.temp.cleanup()

    def test_projection_is_identical_to_the_existing_gas_function(self):
        node = """const fs=require('fs'),vm=require('vm');const src=fs.readFileSync('gas/ticker-proxy.gs','utf8');const a=src.indexOf('function getStrategyScanResult()');const b=src.indexOf('\\n}',a)+2;const data=JSON.parse(fs.readFileSync(0,'utf8'));const ctx={getChunkedCache_:()=>null,kiwoomVmFetch_:()=>data,putChunkedCache_:()=>{},SCAN_RESULT_CACHE_TTL:1};vm.runInNewContext(src.slice(a,b),ctx);process.stdout.write(JSON.stringify(ctx.getStrategyScanResult()));"""
        result = subprocess.check_output(['node', '-e', node], input=json.dumps(self.snapshot).encode(), cwd=ROOT)
        self.assertEqual(self.scope['_build_strategy_scan'](), json.loads(result))

    def test_public_projection_is_cached_gzipped_and_limited(self):
        request = type('Request', (), {'headers': {'accept-encoding': 'gzip'}})()
        first = self.scope['strategy_scan_public'](request)
        second = self.scope['strategy_scan_public'](request)
        self.assertIs(first.body, second.body)
        body = json.loads(gzip.decompress(first.body))
        self.assertNotIn('internal', body['data'])
        self.assertEqual(body['data']['scannedAt'], self.snapshot['scannedAt'])
        self.scope['_check_rate_limit'].assert_called_with('strategy_scan', request, max_per_window=30)
        self.scope['require_api_key'].assert_not_called()

    def test_private_batch_remains_authenticated(self):
        with self.assertRaises(HttpError) as error:
            self.scope['strategy_scan_batch']()
        self.assertEqual(error.exception.status_code, 401)

    def test_missing_snapshot_is_not_a_successful_empty_scan(self):
        (self.folder/'strategy.json').unlink()
        with self.assertRaises(HttpError) as error:
            self.scope['strategy_scan_public'](type('Request', (), {'headers': {}})())
        self.assertEqual(error.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
