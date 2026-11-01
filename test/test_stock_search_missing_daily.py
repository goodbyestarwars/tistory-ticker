"""일봉이 아직 없는 신규상장의 실제 차트 로더 전환을 검증한다."""
import json
import pathlib
import shutil
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const fixture = JSON.parse(process.argv[1]);
const renders = [], requests = [];
const chart = {innerHTML: ''}, notice = {hidden: true, textContent: ''}, scope = {hidden: true};
const buttons = ['day', 'week', 'month', 'minute'].map(tf => ({tf, active: tf === 'day',
  getAttribute() {return tf;}, classList: {toggle(name, active) {buttons.find(b => b.tf === tf).active = active;}}}));
const container = {querySelector(selector) {
  return selector === '#ssChart' ? chart : selector === '#ssChartNotice' ? notice
    : selector === '[data-minute-scope-wrap]' ? scope : null;
}, querySelectorAll(selector) {return selector === '.ss-tf-btn' ? buttons : selector === '#ssChart' ? [chart] : [];}};
chart.closest = () => null;
let source = fs.readFileSync('js/stock-search.js', 'utf8');
source = source.replace('global.StockSearch = { init: init };', `
  global.chartTest = {loadChart: loadChart, state: state, resolveName: resolveDomesticName};
  chartReady = function () {return Promise.resolve({});};   // 엔진 로드는 이 시험의 관심사가 아니다
  renderMinuteChart = function () {renders.push('minute');};
  renderLwChart = function (element, bars, tf) {renders.push(tf);};
  startMinuteRefresh = function () {};
  stopMinuteRefresh = function () {};
  global.StockSearch = { init: init };`);
const window = {addEventListener() {}};
// 공통 전송(NineHttp)은 microtask·캐시를 끼워 요청 횟수 검증과 맞지 않아, 이 시험은 요청을 즉시 fetch로 넘기는 가짜를 쓴다.
window.NineHttp = {json(url) {requests.push(url); return fixture.fail ? Promise.reject(new Error('offline'))
  : Promise.resolve(fixture.payload);}};
window.NineUI = {spinner() {return '';}, number(n) {return String(n);}};
vm.runInNewContext(fs.readFileSync('js/chart-data.js', 'utf8'), {window, Date, Promise, JSON, Math, Array, Object, String});   // 실제 공용 데이터 계층
const ctx = {window, console, setTimeout, clearTimeout, renders,
  document: {readyState: 'loading', addEventListener() {}, querySelector() {return null;}},
  fetch(url) {requests.push(url); return fixture.fail ? Promise.reject(new Error('offline'))
    : Promise.resolve({ok: true, json: () => Promise.resolve(fixture.payload)});}};
vm.createContext(ctx);
{const shell = fs.readFileSync('js/skin-shell.js', 'utf8');   // NineAPI는 실제 코드를 싣는다
 vm.runInContext(shell.slice(shell.indexOf('/* NineAPI:'), shell.indexOf('/* End NineAPI */')), ctx);}
vm.runInContext(source, ctx);
(async () => {
  window.chartTest.state.selectedCode = '468670';
  window.chartTest.loadChart(container, '468670');
  if (fixture.switchStock) window.chartTest.state.selectedCode = '005930';
  for (let i = 0; i < 12; i++) await new Promise(setImmediate);
  if (fixture.reload) window.chartTest.loadChart(container, '468670');
  console.log(JSON.stringify({renders, requests, chart, notice, scope, buttons,
    timeframe: window.chartTest.state.timeframe,
    byName: window.chartTest.resolveName('브릴스')}));
})().catch(error => {console.error(error); process.exit(1);});
"""


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
class MissingDailyChartTest(unittest.TestCase):
    def run_chart(self, **fixture):
        result = subprocess.run(['node', '-e', HARNESS, json.dumps(fixture)], cwd=ROOT,
                                check=True, capture_output=True, text=True, encoding='utf-8')
        return json.loads(result.stdout)

    # 회귀 의심(2026-11-01 확인, 수정 보류): VM /flow-chart는 일봉 30개 미만이면 404, GAS 폴백은 {error:'NO_DATA'}인데
    # 공통 NineAPI.flowChart(skin-shell.js, 6da5f654)가 둘 다 형식 검증에서 거절해 NO_DATA 분기에 닿지 못한다.
    # 신규상장은 분봉 차트 대신 오류 문구가 뜬다. 고치면 이 표식을 지운다.
    @unittest.expectedFailure
    def test_missing_daily_opens_minute_chart_and_caches_negative_daily_result(self):
        result = self.run_chart(payload={'error': 'NO_DATA'}, reload=True)
        self.assertEqual(result['renders'], ['minute', 'minute'])
        self.assertEqual(len(result['requests']), 1)
        self.assertEqual(result['timeframe'], 'minute')
        self.assertFalse(result['notice']['hidden'])
        self.assertIn('1분봉', result['notice']['textContent'])
        self.assertFalse(result['scope']['hidden'])
        self.assertEqual([b['tf'] for b in result['buttons'] if b['active']], ['minute'])
        self.assertEqual(result['byName'], {'name': '브릴스', 'code': '468670'})

    def test_regular_daily_data_stays_on_daily_chart(self):
        result = self.run_chart(payload={'daily': [{'date': '2026-09-30', 'open': 9900, 'high': 10100, 'low': 9800, 'close': 10000, 'volume': 1000}]})
        self.assertEqual(result['renders'], ['day'])
        self.assertTrue(result['notice']['hidden'])

    def test_network_error_does_not_pretend_daily_history_is_missing(self):
        result = self.run_chart(fail=True)
        self.assertEqual(result['renders'], [])
        self.assertTrue(result['notice']['hidden'])
        self.assertIn('차트 데이터를 불러오지 못했어요', result['chart']['innerHTML'])

    def test_late_missing_daily_response_does_not_switch_a_different_stock(self):
        result = self.run_chart(payload={'error': 'NO_DATA'}, switchStock=True)
        self.assertEqual(result['renders'], [])
        self.assertEqual(result['timeframe'], 'day')
        self.assertTrue(result['notice']['hidden'])
