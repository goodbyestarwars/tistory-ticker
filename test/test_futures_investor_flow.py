import ast
import math
import threading
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

class FuturesFlow(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/investor_trend.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        names = ('parse_futures_investors', 'get_futures_result')
        self.clock = 1000
        self.calls = 0
        self.failure = False
        self.payload = {'output': [{prefix + '_' + suffix: str(value)
            for prefix in ('frgn', 'orgn', 'prsn')
            for suffix, value in [('shnu_vol', 12), ('seln_vol', 10), ('ntby_qty', 2)]}]}
        def fetch(*args):
            self.calls += 1
            if self.failure:
                raise RuntimeError('upstream unavailable')
            return self.payload
        self.env = dict(math=math, time=types.SimpleNamespace(monotonic=lambda: self.clock),
            datetime=datetime, KST=timezone(timedelta(hours=9)), _futures_flow_cache=None,
            _futures_flow_retry_at=0, _futures_flow_lock=threading.Lock(),
            kis_client=types.SimpleNamespace(get_token=lambda *a: 'fixture', fetch_futures_investors=fetch))
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[]), str(path), 'exec'), self.env)

    def test_quantities_and_missing_or_inconsistent_values(self):
        parse = self.env['parse_futures_investors']
        self.assertEqual(parse(self.payload)['foreign']['net'], 2)
        row = self.payload['output'][0]
        for value in ('', 'bad', 'nan', '1.5', '3'):
            row['frgn_ntby_qty'] = value
            with self.assertRaises(ValueError):
                parse(self.payload)
        row.update(frgn_shnu_vol='0', frgn_seln_vol='0', frgn_ntby_qty='0')
        self.assertEqual(parse(self.payload)['foreign']['net'], 0)

    def test_cache_throttle_and_stale_failure(self):
        get = self.env['get_futures_result']
        self.assertTrue(get('fixture', 'fixture')['available'])
        get('fixture', 'fixture')
        self.assertEqual(self.calls, 1)
        self.clock += 301
        self.failure = True
        stale = get('fixture', 'fixture')
        self.assertTrue(stale['stale'])
        self.assertEqual(stale['participants']['foreign']['net'], 2)
        get('fixture', 'fixture')
        self.assertEqual(self.calls, 2)

if __name__ == '__main__':
    unittest.main()
