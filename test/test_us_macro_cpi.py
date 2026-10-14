# -*- coding: utf-8 -*-
"""미국 CPI·근원 CPI 표시·갱신 회귀 테스트 (2026-10-15, 9월 CPI 반영 지연 사고)."""
import json
import os
import subprocess
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

RUNNER = r'''
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('js/us-macro-indicators.js', 'utf8');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const FIXED = Date.parse(input.now);
class FixedDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
const fetched = [];
const ctx = {
  window: {}, document: {readyState: 'loading', addEventListener() {}, getElementById() { return null; }}, console, Date: FixedDate,
  AbortController, setTimeout, clearTimeout, Promise, encodeURIComponent, URL,
  fetch(url) { fetched.push(String(url)); return Promise.resolve({ok: true, json: () => Promise.resolve({data: []})}); },
};
ctx.window.IndicatorBoard = {util: {series: () => []}};
ctx.window.fetch = ctx.fetch;
vm.runInNewContext(src, ctx);
const api = ctx.window.UsMacroIndicators;
const t = api._test;
(async () => {
  const out = {};
  out.expected = t.expectedCpiMonth();
  out.rows = {};
  for (const [sym, item] of Object.entries(input.items)) {
    const row = t.boardRow(sym, item);
    out.rows[sym] = {cells: row.cells.map(c => c.t), note: row.note, stale: t.releaseStale(sym, item)};
  }
  await api.fetchResults(false); await api.fetchResults(false); await api.fetchResults(true);
  out.fetched = fetched;
  console.log(JSON.stringify(out));
})();
'''


def chart(prices):
    return [{'date': d, 'close': c} for d, c in prices]


def cpi_item(last_month='20260901', price=336.298, rate=0.6485, change=2.167):
    prices = [('20250901', 324.245), ('20260701', 332.813), ('20260801', 334.131)]
    if last_month == '20260901':
        prices.append(('20260901', price))
    else:
        price, rate, change = 334.131, 0.39, 1.318
    return {'symbol': 'US_CPI', 'price': price, 'change': change, 'change_rate': rate, 'chart': chart(prices), 'updated_at': '2026-10-14T20:55:53+00:00'}


def core_item():
    return {'symbol': 'US_CORE_CPI', 'price': 338.896, 'change': 1.131, 'change_rate': 0.3348,
            'chart': chart([('20250901', 330.418), ('20260801', 337.765), ('20260901', 338.896)]), 'updated_at': '2026-10-14T20:55:53+00:00'}


def run(now, items):
    out = subprocess.run(['node', '-e', RUNNER], cwd=ROOT, input=json.dumps({'now': now, 'items': items}), capture_output=True, text=True, encoding='utf-8')
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


class CpiDisplayTests(unittest.TestCase):
    def test_september_release_matches_bls_one_decimal(self):
        r = run('2026-10-15T03:00:00+09:00', {'US_CPI': cpi_item(), 'US_CORE_CPI': core_item()})
        cpi, core = r['rows']['US_CPI']['cells'], r['rows']['US_CORE_CPI']['cells']
        self.assertEqual(cpi[0], '336.3 pt (지수)')                       # 지수값
        self.assertEqual(cpi[2], '+0.6% (전월)')                          # BLS 전월 대비 0.6%
        self.assertEqual(cpi[3], '+3.7% (전년)')                          # BLS 전년 대비 3.7%
        self.assertEqual(core[2], '+0.3% (전월)')                         # 근원 0.3%
        self.assertEqual(core[3], '+2.6% (전년)')                         # 근원 2.6%
        self.assertEqual(cpi[4], '2026년 9월 · 계절조정')
        self.assertIsNone(r['rows']['US_CPI']['stale'])
        self.assertIn('계절조정', r['rows']['US_CPI']['note'])
        self.assertIn('CPIAUCSL', r['rows']['US_CPI']['note'])
        self.assertIn('CPILFESL', r['rows']['US_CORE_CPI']['note'])

    def test_previous_release_warning_after_release_with_last_data_month(self):
        r = run('2026-10-15T03:00:00+09:00', {'US_CPI': cpi_item(last_month='20260801')})
        row = r['rows']['US_CPI']
        self.assertEqual(row['stale'], {'last': '202608', 'expected': '202609'})
        self.assertIn('이전 발표 기준', row['cells'][4])
        self.assertIn('2026년 8월', row['cells'][4] + row['note'])         # 마지막 데이터 기준월 표시
        self.assertIn('마지막 데이터 기준월은 2026년 8월', row['note'])

    def test_no_warning_before_the_release_plus_three_hours(self):
        # 발표(2026-10-14 08:30 ET = 12:30Z) 직후 3시간 안에는 FRED 반영을 기다리는 중이라 경고하지 않는다
        r = run('2026-10-14T14:00:00Z', {'US_CPI': cpi_item(last_month='20260801')})
        self.assertIsNone(r['rows']['US_CPI']['stale'])
        r = run('2026-10-14T16:00:00Z', {'US_CPI': cpi_item(last_month='20260801')})
        self.assertIsNotNone(r['rows']['US_CPI']['stale'])

    def test_expected_month_rule_without_known_release(self):
        self.assertEqual(run('2026-11-16T12:00:00+09:00', {})['expected'], '202609')   # 17일 전: 두 달 전
        self.assertEqual(run('2026-11-18T12:00:00+09:00', {})['expected'], '202610')   # 17일 이후: 직전 달

    def test_other_series_keep_two_decimals_and_have_no_cpi_warning(self):
        item = {'symbol': 'US_PPI', 'price': 260.0, 'change': 1.0, 'change_rate': 0.386, 'chart': chart([('20250901', 250.0), ('20260801', 259.0)]), 'updated_at': 'x'}
        r = run('2026-10-15T03:00:00+09:00', {'US_PPI': item})
        cells = r['rows']['US_PPI']['cells']
        self.assertEqual(cells[2], '+0.39%')
        self.assertNotIn('(전월)', cells[2])
        self.assertIsNone(r['rows']['US_PPI']['stale'])

    def test_refresh_button_force_bypasses_cache_and_browser_cache(self):
        r = run('2026-10-15T03:00:00+09:00', {})
        self.assertEqual(len(r['fetched']), 2)                              # 첫 조회 1회 + 캐시된 두 번째는 요청 없음 + 강제 갱신 1회
        self.assertNotIn('&_=', r['fetched'][0])
        self.assertIn('&_=', r['fetched'][1])


if __name__ == '__main__':
    unittest.main()
