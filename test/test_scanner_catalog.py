# -*- coding: utf-8 -*-
"""차트검색기 11개의 API 키·메뉴명·설명 구조 회귀 테스트(2026-10-15).

shortTermMaBreakout이 판정·저장은 되는데 /pattern-scan 응답에서 빠져 탭이 항상 비던 문제를 막는다.
결과 0건 / 정상 결과 / 데이터 누락(캐시 없음) 세 경우에서 모든 탭 키가 리스트로 내려가야 하고,
화면 탭 키는 전부 API 키에 있어야 하며, 모든 탭에 설명 6항목이 있어야 한다(0건이어도 보인다)."""
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import main  # noqa: E402

MENU = {
    'risingLows': '저점상승 패턴', 'shortTermMaBreakout': '하락추세선 돌파', 'maCloudBreakout': '장기이평 응축·돌파',
    'doubleBottom': '쌍바닥 패턴', 'invHeadShoulders': '역헤드앤숄더 패턴', 'boxRangeLow': '박스권 하단 반등',
    'pullback': '이동평균 눌림목', 'firstPullbackBreakout': '첫 눌림목 재돌파', 'angleMomentum': '이평선 기울기 전환',
    'gongpasan': '급락 후 첫 눌림목', 'volumeBreakout': '장중 거래량 급증',
}


class ScannerCatalogTest(unittest.TestCase):
    def build(self, cache):
        with patch.object(main, 'load_daily_scan_cache_cached', return_value=cache):
            return main._build_pattern_scan()

    def test_every_menu_key_is_in_the_api_even_with_missing_data(self):
        for cache in ({}, None, {'patternScan': {'patterns': {}}}):
            patterns = self.build(cache)['patterns']
            for key in MENU:
                self.assertIn(key, patterns)
                self.assertEqual(patterns[key], [])

    def test_short_term_ma_breakout_reaches_the_client(self):
        item = {'code': '005930', 'name': '삼성전자', 'score': 80, 'patternDetail': {'status': 'BREAKOUT_NEW'}}
        data = self.build({'patternScan': {'patterns': {'shortTermMaBreakout': [item], 'risingLows': []}}})
        self.assertEqual(data['patterns']['shortTermMaBreakout'], [item])
        self.assertEqual(data['patterns']['risingLows'], [])

    def test_scan_times_are_separated_per_scan(self):
        data = self.build({'generatedAt': 'A', 'volumeBreakoutScannedAt': 'V', 'angleMomentumScannedAt': 'G',
                           'gongpasanScannedAt': 'P'})
        self.assertEqual((data['scannedAt'], data['volumeBreakoutScannedAt'], data['angleMomentumScannedAt'],
                          data['gongpasanScannedAt']), ('A', 'V', 'G', 'P'))

    def test_front_menu_names_and_info_rows(self):
        script = r'''
const fs = require('fs'), vm = require('vm');
let source = fs.readFileSync('js/pattern-scan.js', 'utf8');
source = source.replace('global.PatternScan =', 'global.__t = {tabs: TABS, info: TAB_INFO, rows: INFO_ROWS}; global.PatternScan =');
const ctx = {window: {}, document: {readyState: 'loading', addEventListener() {}}, console};
vm.runInNewContext(source, ctx);
const t = ctx.window.__t;
console.log(JSON.stringify({tabs: t.tabs.map(x => [x.key, x.label, !!x.desc]), info: t.info, rows: t.rows.map(r => r[0])}));
'''
        out = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(out.returncode, 0, out.stderr)
        data = json.loads(out.stdout)
        labels = {k: label for k, label, _ in data['tabs']}
        for key, name in MENU.items():
            self.assertEqual(labels.get(key), name)
            self.assertIn(key, data['info'])
            for row in data['rows']:
                if row == 'cond':
                    continue
                self.assertTrue(data['info'][key].get(row), '%s/%s 설명 누락' % (key, row))
        # 화면의 모든 탭 키는 API가 내려주는 키여야 한다.
        api_keys = set(self.build({})['patterns'])
        self.assertTrue({k for k, _, _ in data['tabs']} <= api_keys)


if __name__ == '__main__':
    unittest.main()
