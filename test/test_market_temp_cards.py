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
let panelWrites = 0;
let gridWrites = 0;
const listeners = {};
const input = {value: '', selectionStart: 0, addEventListener(type, cb) {listeners[type] = cb;},
  focus() {focusCount++;}, setSelectionRange() {}};
const grid = {
  set innerHTML(value) {
    gridWrites++;
    html = html.replace(/(data-all-stock-grid>)[\s\S]*?(<\/div><div class="mt-all-stock-summary">)/,
      (_, before, after) => before + value + after);
  },
  querySelectorAll() {return [];}
};
function textNode(pattern) {
  return {set textContent(value) {html = html.replace(pattern, (_, before, after) => before + value + after);}};
}
const panel = {isConnected: true,
  set innerHTML(value) {html = value; panelWrites++;}, get innerHTML() {return html;},
  querySelector(selector) {
    if (selector === '[data-all-stock-grid]') return grid;
    if (selector === '[data-all-stock-search]') return input;
    if (selector === '[data-all-stock-count]') return textNode(/(data-all-stock-count>)[\s\S]*?(<\/span>)/);
    if (selector === '.mt-all-stock-summary') return textNode(/(class="mt-all-stock-summary">)[\s\S]*?(<\/div>)/);
    return {addEventListener(type, cb) {listeners[selector] = cb;}};
  }};
async function flush() {for (let i = 0; i < 5; i++) await new Promise(setImmediate);}
(async function () {
  window.loadCards(panel);
  await flush();
  const initial = html;
  const initialPanelWrites = panelWrites;
  const stages = [];
  for (const event of fixture.events || []) {
    if (event.value != null) input.value = event.value;
    if (listeners[event.type]) listeners[event.type](event);
    stages.push({html, panelWrites, gridWrites, value: input.value});
  }
  if (fixture.query && listeners.input) {
    input.value = fixture.query;
    input.selectionStart = fixture.query.length;
    listeners.input({isComposing: false});
  }
  if (fixture.refresh && listeners['[data-all-stock-refresh]']) {
    listeners['[data-all-stock-refresh]']();
    await flush();
  }
  console.log(JSON.stringify({initial, html, focusCount, requests, stages, panelWrites, initialPanelWrites}));
})().catch(error => {console.error(error); process.exit(1);});
"""


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
class MarketTempCardsTest(unittest.TestCase):
    def row(self, code, name, amount=30000000000, volume=100000, price=15000, rate=1):
        return dict(code=code, name=name, price=price, change_rate=rate,
                    trade_amount=amount, trade_volume=volume, industry='반도체와반도체장비')

    def run_cards(self, rows=None, **options):
        rows = rows if rows is not None else [self.row('000001', '정상주'), self.row('000002', '보합주', rate=0)]
        wics = options.pop('wics', {row['code']: {'sector': 'IT'} for row in rows})
        fixture = dict(board={'data': {'rows': rows, 'updated_at': 1790774899,
                                      'sections': {'tradeVolume': rows}}},
                       wics=wics, **options)
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
        self.assertEqual(len(result['requests']), 2)

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
        self.assertEqual(result['focusCount'], 0)  # 원래 입력칸의 포커스를 유지한다.
        self.assertEqual(result['panelWrites'], result['initialPanelWrites'])
        self.assertIn('정상주', result['html'])
        self.assertNotIn('보합주', result['html'])
        refreshed = self.run_cards(refresh=True)
        self.assertEqual(len(refreshed['requests']), 4)

    def test_korean_composition_preserves_input_and_filters_only_after_commit(self):
        result = self.run_cards(events=[
            {'type': 'compositionstart'},
            {'type': 'input', 'value': 'ㅈ', 'isComposing': True},
            {'type': 'input', 'value': '저', 'isComposing': True},
            {'type': 'input', 'value': '정', 'isComposing': False},
            {'type': 'compositionend', 'value': '정'},
            {'type': 'input', 'value': '정', 'isComposing': False},
        ])
        for stage in result['stages'][:4]:
            self.assertEqual(stage['html'], result['initial'])
            self.assertEqual(stage['gridWrites'], 0)
        self.assertIn('정상주', result['html'])
        self.assertNotIn('보합주', result['html'])
        self.assertIn('1개 섹터 · 1종목 표시', result['html'])
        self.assertEqual(result['stages'][-1]['gridWrites'], 1)
        self.assertEqual(result['panelWrites'], result['initialPanelWrites'])
        self.assertEqual(result['focusCount'], 0)
        self.assertEqual(len(result['requests']), 2)

    def test_input_composing_flag_delete_paste_code_and_clear(self):
        result = self.run_cards(events=[
            {'type': 'input', 'value': 'ㅂ', 'isComposing': True},
            {'type': 'input', 'value': '보합주', 'isComposing': False},
            {'type': 'input', 'value': '보합', 'isComposing': False},
            {'type': 'input', 'value': '000001', 'isComposing': False},
            {'type': 'input', 'value': '없는종목', 'isComposing': False},
            {'type': 'input', 'value': '', 'isComposing': False},
        ])
        self.assertEqual(result['stages'][0]['gridWrites'], 0)
        self.assertNotIn('정상주', result['stages'][1]['html'])
        self.assertIn('보합주', result['stages'][2]['html'])
        self.assertNotIn('보합주', result['stages'][3]['html'])
        self.assertIn('주요 섹터 내에 찾는 종목이 없습니다', result['stages'][4]['html'])
        self.assertEqual(result['html'], result['initial'])
        self.assertEqual(result['panelWrites'], result['initialPanelWrites'])
        self.assertEqual(len(result['requests']), 2)

    def test_all_qualified_stocks_and_sectors_are_shown_without_arbitrary_caps(self):
        rows = [self.row(f'{i:06d}', f'활성종목{i}') for i in range(1, 39)]
        wics = {row['code']: {'sector': 'IT' if i < 16 else f'업종{(i - 16) // 2}'}
                for i, row in enumerate(rows)}
        result = self.run_cards(rows, wics=wics)
        self.assertEqual(result['html'].count('data-all-stock-code='), 38)
        self.assertIn('12개 섹터 · 38종목 표시', result['html'])
        self.assertNotIn('data-all-stock-next', result['html'])
        self.assertEqual(len(result['requests']), 2)
        searched = self.run_cards(rows, wics=wics, query='활성종목38')
        self.assertEqual(searched['html'].count('data-all-stock-code='), 1)
        self.assertIn('활성종목38', searched['html'])

    def test_full_scan_universe_is_not_replaced_by_short_live_ranking(self):
        rows = [self.row('000001', '정상주', price=16000, rate=2),
                self.row('000002', '보합주', amount=0, volume=0, rate=0)]
        scan = {'data': {'scannedAt': '2026-09-30T14:58:47Z', 'buckets': {'hold': [
            ['000001', '정상주', 15000, 1, 3, 50, 30000000000],
            ['000002', '보합주', 22000, -2, 3, 50, 30000000000],
            ['000003', '순위밖종목', 18000, 3, 3, 50, 30000000000]]}}}
        wics = {f'{i:06d}': {'sector': 'IT'} for i in range(1, 4)}
        result = self.run_cards(rows, scan=scan, wics=wics)
        self.assertEqual(result['html'].count('data-all-stock-code='), 3)
        self.assertIn('순위밖종목', result['html'])
        self.assertIn('16,000원', result['html'])
        self.assertIn('▲2.00%', result['html'])
        self.assertIn('22,000원', result['html'])
        self.assertIn('▼2.00%', result['html'])
        self.assertIn('시세: 시장판 조회값', result['html'])
        self.assertIn('스캔', result['html'])
        self.assertEqual(len(result['requests']), 2)

    def test_new_active_listing_is_added_without_waiting_for_tonights_scan(self):
        rows = [self.row('468670', '브릴스', amount=290000000000, price=43750, rate=124.36),
                self.row('000004', '저거래신규', amount=4000000000)]
        scan = {'data': {'scannedAt': '2026-09-30T14:58:47Z', 'buckets': {'hold': [
            ['000001', '기존종목1', 15000, 1, 3, 50, 30000000000],
            ['000002', '기존종목2', 22000, -2, 3, 50, 30000000000]]}}}
        wics = {code: {'sector': '산업재'} for code in ['000001', '000002', '000004']}
        result = self.run_cards(rows, scan=scan, wics=wics)
        self.assertEqual(result['html'].count('data-all-stock-code='), 3)
        self.assertEqual(result['html'].count('data-all-stock-code="468670"'), 1)
        self.assertIn('브릴스', result['html'])
        self.assertIn('43,750원', result['html'])
        self.assertIn('▲124.36%', result['html'])
        self.assertIn('KOSDAQ', result['html'])
        self.assertIn('장중 조건을 충족한 1종목 추가', result['html'])
        self.assertIn('600억', result['html'])  # 전일 합계에 당일 거래대금을 섞지 않는다.
        self.assertNotIn('저거래신규', result['html'])
        self.assertEqual(len(result['requests']), 2)

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
        scan = {'data': {'scannedAt': '2026-09-30T14:58:47+00:00', 'buckets': {'hold': [
            ['000001', '정상주', 15000, 1, 3, 50, 30000000000],
            ['000002', '하락주', 22000, -2, 3, 50, 30000000000]]}}}
        result = self.run_cards(rows, scan=scan, refresh=True)
        self.assertIn('최근 거래일에 활발했던 주요 섹터', result['initial'])
        self.assertIn('2026-09-30 23:58 KST', result['html'])
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
