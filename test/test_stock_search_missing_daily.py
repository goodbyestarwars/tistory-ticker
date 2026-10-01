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
}, querySelectorAll(selector) {return selector === '.ss-tf-btn' ? buttons : [];}};
let source = fs.readFileSync('js/stock-search.js', 'utf8');
source = source.replace('global.StockSearch = { init: init };', `
  global.chartTest = {loadChart: loadChart, state: state, resolveName: resolveDomesticName};
  renderMinuteChart = function () {renders.push('minute');};
  renderLwChart = function (element, bars, tf) {renders.push(tf);};
  startMinuteRefresh = function () {};
  stopMinuteRefresh = function () {};
  global.StockSearch = { init: init };`);
const window = {addEventListener() {}};
vm.runInNewContext(source, {window, console, setTimeout, clearTimeout, renders,
  document: {readyState: 'loading', addEventListener() {}, querySelector() {return null;}},
  fetch(url) {requests.push(url); return fixture.fail ? Promise.reject(new Error('offline'))
    : Promise.resolve({ok: true, json: () => Promise.resolve(fixture.payload)});}});
(async () => {
  window.chartTest.state.selectedCode = '468670';
  window.chartTest.loadChart(container, '468670');
  if (fixture.switchStock) window.chartTest.state.selectedCode = '005930';
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
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
        result = self.run_chart(payload={'daily': [{'date': '2026-09-30', 'close': 10000}]})
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
