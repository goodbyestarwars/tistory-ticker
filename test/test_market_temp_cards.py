"""카드 로더를 실행해 시세 포맷 오류와 빈 목록 폴백을 회귀 검증한다."""
import json
import pathlib
import shutil
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require('fs');
const vm = require('vm');
const fixture = JSON.parse(process.argv[1]);
const requests = [];
let source = fs.readFileSync('js/market-temp.js', 'utf8');
// 테스트에서만 내부 로더를 공개한다. 운영 전역 객체 계약은 바꾸지 않는다.
source = source.replace('global.MarketTemp = MarketTemp;',
  'global.MarketTemp = MarketTemp; global.loadCards = loadAllStocksPanel;');
const window = {KRX_MAP: {정상주: '000001'}, KRX_ETF_NAMES: ['테스트상품'],
  WICS_MAP: fixture.wics, location: {href: ''}};
const context = {window, console, setTimeout, clearTimeout,
  document: {readyState: 'loading', addEventListener() {}},
  fetch(url) {
    requests.push(url);
    if (fixture.failBoard && url.includes('/market-board')) return Promise.reject(new Error('offline'));
    if (fixture.failAll) return Promise.reject(new Error('offline'));
    return Promise.resolve({ok: true, json: () => Promise.resolve(url.includes('/market-board') ? fixture.board : fixture.scan)});
  }};
vm.runInNewContext(source, context);
let html = '';
let focusCount = 0;
const listeners = {};
const input = {value: '', selectionStart: 0, addEventListener(type, cb) {listeners.search = cb;},
  focus() {focusCount++;}, setSelectionRange() {}};
const grid = {querySelectorAll() {return [];}};
const panel = {isConnected: true,
  set innerHTML(value) {html = value;}, get innerHTML() {return html;},
  querySelector(selector) {
    if (selector === '[data-all-stock-grid]') return grid;
    if (selector === '[data-all-stock-search]') return input;
    return {addEventListener(type, cb) {listeners[selector] = cb;}};
  }};
async function flush() {for (let i = 0; i < 5; i++) await new Promise(setImmediate);}
(async function () {
  window.loadCards(panel);
  await flush();
  const initial = html;
  if (fixture.query && listeners.search) {
    input.value = fixture.query;
    input.selectionStart = fixture.query.length;
    listeners.search();
  }
  if (fixture.refresh && listeners['[data-all-stock-refresh]']) {
    listeners['[data-all-stock-refresh]']();
    await flush();
  }
  console.log(JSON.stringify({initial, html, focusCount, requests}));
})().catch(error => {console.error(error); process.exit(1);});
"""


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
class MarketTempCardsTest(unittest.TestCase):
    def row(self, code, name, amount=30000000000, volume=100000, price=15000, rate=1):
        return dict(code=code, name=name, price=price, change_rate=rate,
                    trade_amount=amount, trade_volume=volume, industry='반도체와반도체장비')

    def run_cards(self, rows=None, **options):
        rows = rows if rows is not None else [self.row('000001', '정상주'), self.row('000002', '보합주', rate=0)]
        fixture = dict(board={'data': {'rows': rows, 'updated_at': 1790774899,
                                      'sections': {'tradeVolume': rows}}},
                       wics={row['code']: {'sector': 'IT'} for row in rows}, **options)
        result = subprocess.run(['node', '-e', HARNESS, json.dumps(fixture)],
                                cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8')
        return json.loads(result.stdout)

    def test_quote_response_renders_price_and_direction_instead_of_retry_screen(self):
        result = self.run_cards()
        self.assertIn('15,000원', result['html'])
        self.assertIn('▲1.00%', result['html'])
        self.assertIn('보합주', result['html'])
        self.assertEqual(result['html'].count('data-all-stock-code='), 2)
        self.assertNotIn('data-all-stock-retry', result['html'])
        self.assertEqual(len(result['requests']), 1)

    def test_low_activity_funds_and_invalid_prices_are_excluded_and_deduplicated(self):
        rows = [self.row('000001', '정상주'), self.row('000002', '하락주', rate=-2),
                self.row('000003', '저거래대금', amount=4000000000),
                self.row('000004', '저거래량', volume=9999),
                self.row('000005', '테스트상품'), self.row('000006', '가나다스팩'),
                self.row('000007', '시세없음', price=0), self.row('000008', '테스트 ETN')]
        html = self.run_cards(rows)['html']
        self.assertEqual(html.count('data-all-stock-code='), 2)
        self.assertIn('▼2.00%', html)
        for name in ['저거래대금', '저거래량', '테스트상품', '가나다스팩', '시세없음', '테스트 ETN']:
            self.assertNotIn(name, html)

    def test_small_sector_shows_empty_state_without_unfiltered_static_list(self):
        result = self.run_cards([self.row('000001', '거래적은섹터', amount=6000000000)])
        self.assertIn('현재 기준에 맞는 주요 섹터가 없습니다', result['html'])
        self.assertNotIn('data-all-stock-code=', result['html'])

    def test_search_keeps_focus_and_refresh_requests_new_quotes(self):
        result = self.run_cards(query='정상')
        self.assertEqual(result['focusCount'], 1)
        self.assertIn('정상주', result['html'])
        self.assertNotIn('보합주', result['html'])
        refreshed = self.run_cards(refresh=True)
        self.assertEqual(len(refreshed['requests']), 2)

    def test_board_failure_uses_scan_quotes_and_total_failure_has_retry(self):
        scan = {'data': {'scannedAt': '2026-09-30T00:00:00Z', 'buckets': {'hold': [
            ['000001', '정상주', 15000, 1, 3, 50, 30000000000],
            ['000002', '보합주', 15000, 0, 3, 50, 30000000000]]}}}
        result = self.run_cards(failBoard=True, scan=scan)
        self.assertIn('15,000원', result['html'])
        self.assertIn('일일 스캔', result['html'])
        self.assertEqual(len(result['requests']), 2)
        failure = self.run_cards(failAll=True)
        self.assertIn('주요 섹터 시세를 불러오지 못했습니다', failure['html'])
        self.assertIn('data-all-stock-retry', failure['html'])

    def test_premarket_success_with_zero_trades_uses_previous_active_sectors(self):
        rows = [self.row('000001', '정상주', amount=0, volume=0, rate=0),
                self.row('000002', '하락주', amount=0, volume=0, rate=0)]
        scan = {'data': {'scannedAt': '2026-09-30T23:58:47+09:00', 'buckets': {'hold': [
            ['000001', '정상주', 15000, 1, 3, 50, 30000000000],
            ['000002', '하락주', 22000, -2, 3, 50, 30000000000]]}}}
        result = self.run_cards(rows, scan=scan, refresh=True)
        self.assertIn('최근 거래일에 활발했던 주요 섹터', result['initial'])
        self.assertIn('2026-09-30', result['html'])
        self.assertIn('22,000원', result['html'])
        self.assertIn('▼2.00%', result['html'])
        self.assertNotIn('data-all-stock-retry', result['html'])
        # 명시적 새로고침은 시장판을 다시 확인한 뒤 스캔으로 대체한다.
        self.assertEqual(len(result['requests']), 4)

    def test_empty_filtered_board_uses_scan_but_does_not_loosen_activity_thresholds(self):
        rows = [self.row('000001', '저거래대금', amount=4000000000),
                self.row('000002', '저거래량', volume=9999)]
        scan = {'data': {'scannedAt': '2026-09-30T23:58:47+09:00', 'buckets': {'hold': [
            ['000001', '스캔저거래대금', 15000, 1, 3, 50, 4000000000],
            ['000002', '스캔저거래대금2', 22000, -2, 3, 50, 4000000000]]}}}
        result = self.run_cards(rows, scan=scan)
        self.assertEqual(len(result['requests']), 2)
        self.assertIn('현재 기준에 맞는 주요 섹터가 없습니다', result['html'])
        self.assertNotIn('data-all-stock-code=', result['html'])
