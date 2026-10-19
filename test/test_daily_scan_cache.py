# -*- coding: utf-8 -*-
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import daily_scan_cache as dsc


class DailyScanCacheUpdateTests(unittest.TestCase):
    """daily_scan.py/rescan_patterns.py/angle_momentum_scan.py/gongpasan_scan.py가
    잠금 없이 daily_scan_cache.json을 나눠 쓰다 서로의 결과를 덮어쓸 수 있던 문제(2026-08-21
    코드 감사)의 수정 대상 - 실제 OUTPUT_FILE/락파일을 건드리지 않도록 매 테스트마다
    임시 경로로 monkeypatch한다."""

    def setUp(self):
        self._orig_output = dsc.OUTPUT_FILE
        self._orig_lock = dsc._LOCK_FILE
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_tmp_daily_scan_cache_%s.json' % id(self))
        dsc.OUTPUT_FILE = base
        dsc._LOCK_FILE = base + '.lock'
        self._paths = [base, base + '.lock', base + '.tmp']

    def tearDown(self):
        dsc.OUTPUT_FILE = self._orig_output
        dsc._LOCK_FILE = self._orig_lock
        for p in self._paths:
            if os.path.exists(p):
                os.remove(p)

    def test_creates_file_when_missing(self):
        dsc.update(lambda existing: existing.update({'a': 1}))
        with open(dsc.OUTPUT_FILE, 'r', encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'a': 1})

    def test_second_update_preserves_keys_the_first_did_not_touch(self):
        """angle_momentum_scan.py가 먼저 patternScan.patterns.angleMomentum을 쓰고,
        그 뒤 daily_scan.py가 patternScan.patterns의 자기 소관 키만 갱신해도
        angleMomentum이 남아있어야 한다."""
        def _angle_momentum_write(existing):
            existing.setdefault('patternScan', {'scanned': 0, 'patterns': {}})
            existing['patternScan']['patterns']['angleMomentum'] = [{'code': '005930'}]

        def _daily_scan_write(existing):
            existing['patternScan']['scanned'] = 10
            existing['patternScan']['patterns'].update({'risingLows': [], 'maCloudBreakout': []})

        dsc.update(_angle_momentum_write)
        dsc.update(_daily_scan_write)

        with open(dsc.OUTPUT_FILE, 'r', encoding='utf-8') as f:
            saved = json.load(f)
        self.assertEqual(saved['patternScan']['patterns']['angleMomentum'], [{'code': '005930'}])
        self.assertEqual(saved['patternScan']['scanned'], 10)
        self.assertIn('risingLows', saved['patternScan']['patterns'])

    def test_write_is_atomic_no_leftover_tmp_file(self):
        dsc.update(lambda existing: existing.update({'a': 1}))
        self.assertFalse(os.path.exists(dsc.OUTPUT_FILE + '.tmp'))

    def test_mutate_receives_the_latest_content_each_call(self):
        dsc.update(lambda existing: existing.update({'x': 1}))
        seen = {}

        def _capture(existing):
            seen.update(existing)
            existing['y'] = 2

        dsc.update(_capture)
        self.assertEqual(seen, {'x': 1})
        with open(dsc.OUTPUT_FILE, 'r', encoding='utf-8') as f:
            saved = json.load(f)
        self.assertEqual(saved, {'x': 1, 'y': 2})



class LongTermRefreshTest(unittest.TestCase):
    def test_gate_refresh_preserves_every_original_bucket_and_history(self):
        import copy
        from unittest.mock import patch
        import rescan_patterns
        raw = {'code':'005930', 'name':'test', 'price':5000, 'patternDetail':{}}
        cache = {'patternScan': {'patterns': {'maCloudBreakout':[raw], 'risingLows':[raw], 'gongpasan':[raw]}}, 'gongpasanStages': {'status':'ok'}, 'investSignal': {'unchanged':True}}
        before = copy.deepcopy(cache)
        class Conn:
            def close(self): pass
        daily = [{'close':5000,'volume':1000000} for _ in range(20)]
        with patch.object(rescan_patterns.db_schema,'get_conn',return_value=Conn()), patch.object(rescan_patterns.db_schema,'load_daily_prices',return_value=daily), patch.object(rescan_patterns,'load_market_cap_cache',return_value={'005930':3000}), patch.object(rescan_patterns,'load_fundamentals_cache',return_value={}), patch.object(rescan_patterns.daily_scan_cache,'update',side_effect=lambda fn:fn(cache)):
            summary = rescan_patterns.refresh_long_term_only()
        self.assertEqual(summary['excluded'],1)
        self.assertEqual(cache['patternScan']['patterns']['maCloudBreakout'],before['patternScan']['patterns']['maCloudBreakout'])
        self.assertEqual(cache['patternScan']['patterns']['risingLows'],before['patternScan']['patterns']['risingLows'])
        self.assertEqual(cache['investSignal'],before['investSignal'])
        self.assertEqual(cache['gongpasanStages'],before['gongpasanStages'])

if __name__ == '__main__':
    unittest.main()
