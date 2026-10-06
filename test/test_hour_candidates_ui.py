"""Manual candidate UI: no implicit request, late response isolation and honest coverage."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const fixture = JSON.parse(process.argv[1]);
let nextTimer = 0;
const timers = new Map(), requests = [];
function node(attrs = {}) { return {hidden: false, innerHTML: '', disabled: false, value: '', events: {}, attrs,
  getAttribute(k) {return this.attrs[k];}, setAttribute(k,v) {this.attrs[k] = v;},
  addEventListener(k, fn) {this.events[k] = fn;}, querySelectorAll() {return [];}}; }
const panel = node(), result = node(), open = node(), jump = node();
const detail = node();
result.hidden = true; open.value = '5'; jump.value = '1.5';
const ranked = node({'data-hour-check':'ranked'}), selected = node({'data-hour-check':'selected'});
const container = {querySelector(s) {return s === '#ssHourCandidates' ? panel : s === '#ssHourResult' ? result
  : s === '[data-hour-open-rise]' ? open : s === '[data-hour-minute-jump]' ? jump : s === '#ssDetail' ? detail : null;},
  querySelectorAll(s) {return s === '[data-hour-check]' ? [ranked, selected]
    : s === '[data-hour-open-rise], [data-hour-minute-jump]' ? [open, jump] : [];}};
let source = fs.readFileSync('js/stock-search.js','utf8').replace('global.StockSearch = { init: init };',
  'global.hourTest = {wireHourCandidates, checkHourCandidates, clearHourCandidates, renderHourCandidates, setMarketMode, selectStock, state, hourCandidatesShell}; '
  + 'loadChart=function(){};loadPriceReason=function(){};loadDomesticNews=function(){};wireChartTabs=function(){};wirePanelResize=function(){};renderSummary=function(){};'
  + 'global.StockSearch = { init: init };');
const window = {addEventListener() {}, AbortController};
vm.runInNewContext(source, {window, console, URLSearchParams, location:{search:''},
  document:{readyState:'loading',addEventListener() {},querySelector(){return null;}},
  setTimeout(fn, delay) {const id=++nextTimer;timers.set(id,{fn,delay});return id;},
  clearTimeout(id) {timers.delete(id);},
  fetch(url,opts) {return new Promise((resolve,reject)=>requests.push({url,opts,resolve,reject}));}});
const api = window.hourTest;
api.wireHourCandidates(container);api.state.selectedCode='035420';
function response(req, body, status = 200) {req.resolve({ok:status===200,status,json:()=>Promise.resolve({data:body})});}
async function flush() {for(let i=0;i<12;i++)await Promise.resolve();}
function snapshot() {return {html:result.innerHTML,hidden:result.hidden,requests:requests.length,
  busy:panel.attrs['aria-busy'],rankedDisabled:ranked.disabled,selectedDisabled:selected.disabled,
  timers:[...timers.values()].map(t=>t.delay)};}
const payload = {state:'ready',checkedAt:'2026-10-06T09:05:20+09:00',scanStartedAt:'2026-10-06T09:05:00+09:00',
  coverage:{mode:'ranked',scope:'KIS 순위',evaluatedCount:3,poolCount:90,skippedCount:87,fullMarket:false},
  items:[],unknown:[{code:'035420',name:'NAVER',reasons:['체결강도 자료 없음']}],
  rejected:[{code:'005930',name:'삼성전자',reasons:['저점 상승 미충족']}],probability:null};
(async()=>{
  const initial=snapshot();
  if(fixture.kind==='no_selection'){api.state.selectedCode=null;selected.events.click();}
  else if(fixture.kind==='invalid'){open.value='999';ranked.events.click();}
  else {
    (fixture.kind==='selected'?selected:ranked).events.click();
    if(fixture.kind==='clear') {api.clearHourCandidates(container);response(requests[0],payload);}
    else if(fixture.kind==='switch_domestic') {api.selectStock(container,{code:'005930',name:'삼성전자'});response(requests[0],payload);}
    else if(fixture.kind==='switch_us') {api.setMarketMode(container,true);response(requests[0],payload);}
    else if(fixture.kind==='timeout') {
      for(const [id,t] of [...timers]) {timers.delete(id);t.fn();}
      response(requests[0],payload);
    }
    else if(fixture.kind==='superseded') {
      api.checkHourCandidates(container,'selected');
      response(requests[1],{...payload,note:'새 확인 결과'});await flush();
      response(requests[0],{...payload,note:'이전 확인 결과'});
    }
    else if(fixture.kind==='outside') response(requests[0],{state:'outside_window'});
    else if(fixture.kind==='busy') response(requests[0],null,409);
    else if(fixture.kind==='failure') requests[0].reject(new Error('network unavailable'));
    else if(fixture.kind==='candidate') response(requests[0],{...payload,items:[{code:'035420',name:'<img src=x onerror=1>',
      checkedAt:'2026-10-06T09:05:01+09:00',expiresAt:'2026-10-06T10:05:01+09:00',entryPrice:10000,
      targetPrice:10300,stopPrice:9700,targetPct:3,stopPct:-3,reasons:['저점 상승 <확인>'],
      metrics:{risingRecentLows:true,risingConfirmedPivotLows:true,volumeAcceleration:1.5,strength:120,
        maxOpenRisePct:2,visibleResistanceToRecentVolume:.4,strongestBidWall:{price:9950,qty:2000},
        strongestAskWall:{price:10010,qty:1000},breakoutConfirmed:true,barTypicalPriceVwap:9970}}]});
    else response(requests[0],payload);
  }
  await flush();
  console.log(JSON.stringify({initial,final:snapshot(),panelHidden:panel.hidden,
    requestDetails:requests.map(r=>({url:r.url,aborted:r.opts.signal.aborted,cache:r.opts.cache})),
    shell:api.hourCandidatesShell()}));
})().catch(error=>{console.error(error);process.exit(1);});
"""


@unittest.skipUnless(shutil.which("node"), "node is required")
class HourCandidatesUiTest(unittest.TestCase):
    def run_ui(self, kind="ranked"):
        result = subprocess.run(["node", "-e", HARNESS, json.dumps({"kind": kind})],
                                cwd=ROOT, capture_output=True, check=True, text=True, encoding="utf-8")
        return json.loads(result.stdout)

    def test_explicit_click_only_with_no_storage_or_followup_poll(self):
        data = self.run_ui()
        self.assertEqual(data["initial"]["requests"], 0)
        self.assertTrue(data["initial"]["hidden"])
        self.assertEqual(data["final"]["requests"], 1)
        self.assertEqual(data["final"]["timers"], [])
        self.assertEqual(data["requestDetails"][0]["cache"], "no-store")

    def test_selected_stock_parameter_and_no_selection_guard(self):
        self.assertIn("mode=selected", self.run_ui("selected")["requestDetails"][0]["url"])
        self.assertIn("code=035420", self.run_ui("selected")["requestDetails"][0]["url"])
        self.assertEqual(self.run_ui("no_selection")["final"]["requests"], 0)

    def test_invalid_threshold_cannot_request(self):
        data = self.run_ui("invalid")
        self.assertEqual(data["final"]["requests"], 0)
        self.assertIn("1~10%", data["final"]["html"])

    def test_clear_aborts_and_ignores_late_result(self):
        data = self.run_ui("clear")
        self.assertTrue(data["requestDetails"][0]["aborted"])
        self.assertTrue(data["final"]["hidden"])
        self.assertEqual(data["final"]["html"], "")

    def test_us_mode_cancels_and_hides_domestic_result(self):
        data = self.run_ui("switch_us")
        self.assertTrue(data["panelHidden"])
        self.assertTrue(data["requestDetails"][0]["aborted"])
        self.assertEqual(data["final"]["html"], "")

    def test_domestic_stock_selection_clears_previous_check(self):
        data = self.run_ui("switch_domestic")
        self.assertTrue(data["requestDetails"][0]["aborted"])
        self.assertTrue(data["final"]["hidden"])
        self.assertEqual(data["final"]["html"], "")

    def test_old_response_cannot_overwrite_new_manual_check(self):
        data = self.run_ui("superseded")
        self.assertTrue(data["requestDetails"][0]["aborted"])
        self.assertIn("새 확인 결과", data["final"]["html"])
        self.assertNotIn("이전 확인 결과", data["final"]["html"])

    def test_timeout_unlocks_controls_and_ignores_late_success(self):
        data = self.run_ui("timeout")
        self.assertTrue(data["requestDetails"][0]["aborted"])
        self.assertFalse(data["final"]["rankedDisabled"])
        self.assertIn("조회 시간이 길어져", data["final"]["html"])
        self.assertNotIn("조건 통과", data["final"]["html"])

    def test_unknown_and_partial_pool_are_not_full_market_no_candidates_claim(self):
        html = self.run_ui()["final"]["html"]
        self.assertIn("조건 통과 0개 · 자료 부족 1개", html)
        self.assertIn("평가 3개 / 모음 90개", html)
        self.assertIn("건너뜀 87개", html)
        self.assertIn("전체 시장 미검사", html)
        self.assertIn("판정하지 않았다", html)

    def test_outside_window_never_displays_candidate(self):
        html = self.run_ui("outside")["final"]["html"]
        self.assertIn("09:15 전까지", html)
        self.assertNotIn("목표가", html)

    def test_busy_and_network_failure_have_explicit_manual_retry(self):
        self.assertIn("다른 확인 작업", self.run_ui("busy")["final"]["html"])
        data = self.run_ui("failure")
        self.assertIn("확인 버튼으로 다시", data["final"]["html"])
        self.assertFalse(data["final"]["rankedDisabled"])
        self.assertEqual(data["final"]["requests"], 1)

    def test_candidate_has_snapshot_prices_time_and_escaped_sources(self):
        html = self.run_ui("candidate")["final"]["html"]
        self.assertIn("10,000", html)
        self.assertIn("10,300", html)
        self.assertIn("9,700", html)
        self.assertIn("+3.00%", html)
        self.assertIn("-3.00%", html)
        self.assertIn("09:05:01", html)
        self.assertIn("10:05:01", html)
        self.assertIn("&lt;img", html)
        self.assertNotIn("<img", html)
        self.assertIn("확정 저점 상승", html)
        self.assertIn("완결봉 돌파 확인", html)
        self.assertIn("0.40배", html)
        self.assertIn("9,950원 · 2,000주", html)
        self.assertIn("10,010원 · 1,000주", html)
        self.assertIn("승률 검증 전", self.run_ui("candidate")["shell"])
