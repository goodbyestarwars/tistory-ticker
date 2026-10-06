"""Single-stock direction UI: explicit intent, race isolation and local expiry."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require('fs'), vm = require('vm');
const kind = process.argv[1];
let nextTimer=0;
const timers=new Map(), requests=[], searches=[];
function node(attrs={}) {return {hidden:false,innerHTML:'',disabled:false,events:{},attrs,
 classList:{add(){},remove(){}}, getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},
 addEventListener(k,fn){this.events[k]=fn;}, querySelector(){return null;}, querySelectorAll(){return [];}};}
const panel=node(), result=node(), button=node({'data-hour-check':'selected'}), detail=node(), results=node(), row=node({'data-idx':'0'});
results.querySelectorAll=s=>s==='.ss-result-row'?[row]:[];
results.querySelector=s=>s==='.ss-result-row'?row:null;
const container={querySelector(s){return {'#ssHourCandidates':panel,'#ssHourResult':result,'#ssDetail':detail,'#ssResults':results}[s]||null;},
 querySelectorAll(s){return s==='[data-hour-check]'?[button]:[];}};
let source=fs.readFileSync('js/stock-search.js','utf8').replace('global.StockSearch = { init: init };',
 'global.hourTest={wireHourCandidates,checkHourCandidates,clearHourCandidates,renderHourCandidates,setMarketMode,selectStock,renderResults,runSearch,state,hourCandidatesShell};'
 +'loadChart=function(){};loadPriceReason=function(){};loadDomesticNews=function(){};wireChartTabs=function(){};wirePanelResize=function(){};renderSummary=function(){};'
 +'fetchJson=function(){return window.fixtureDelayedSearch ? window.fixtureDelayedSearch() : Promise.resolve([]);};global.StockSearch = { init: init };');
const window={addEventListener(){},AbortController,KRX_MAP:{NAVER:'035420',삼성전자:'005930'}};
if(kind==='search_race'||kind==='search_then_click')window.fixtureDelayedSearch=()=>new Promise(resolve=>searches.push(resolve));
class TestDate extends Date {static now(){return Date.parse('2026-10-06T09:05:08+09:00');}}
vm.runInNewContext(source,{window,console,URLSearchParams,Date:TestDate,location:{search:''},
 document:{readyState:'loading',addEventListener(){},querySelector(){return null;}},
 setTimeout(fn,delay){let id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
 fetch(url,opts){return new Promise((resolve,reject)=>requests.push({url,opts,resolve,reject}));}});
const api=window.hourTest;api.wireHourCandidates(container);api.state.selectedCode='035420';api.state.selectedName='NAVER';
const stock={code:'035420',name:'NAVER',price:10000,change:0,changeRate:0,volume:10,sectors:[]};
const payload={code:'035420',direction:'up',reason:'저점 상승',validated:false,probability:null,
 checkedAt:'2026-10-06T09:05:08+09:00',expiresAt:'2026-10-06T10:05:08+09:00'};
function response(req,body=payload,status=200){req.resolve({ok:status===200,status,json:()=>Promise.resolve({data:body})});}
async function flush(){for(let i=0;i<14;i++)await Promise.resolve();}
function snap(){return {html:result.innerHTML,hidden:panel.hidden,requests:requests.length,disabled:button.disabled,timers:[...timers.values()].map(t=>t.delay),title:result.title};}
(async()=>{
 api.clearHourCandidates(container);let initial=snap();
 if(kind==='search_race'){api.runSearch(container,'NAVER',true);api.runSearch(container,'삼성전자',true);searches[1]([]);await flush();searches[0]([]);await flush();}
 else if(kind==='search_then_click'){api.runSearch(container,'NAVER',true);api.selectStock(container,{...stock,code:'005930'},true);searches[0]([]);await flush();}
 else if(kind==='automatic')api.selectStock(container,stock,false);
 else if(kind==='single_auto')api.renderResults(container,[stock],false);
 else if(kind==='single_manual')api.renderResults(container,[stock],true);
 else if(kind==='search_manual'||kind==='search_auto'){api.runSearch(container,'NAVER',kind==='search_manual');await flush();}
 else if(kind==='row_click'){api.renderResults(container,[stock],false);row.events.click();}
 else if(kind==='no_selection'){panel.hidden=false;api.state.selectedCode=null;button.events.click();}
 else {api.selectStock(container,stock,true);}
 if(requests.length){
  if(kind==='clear'){api.clearHourCandidates(container);response(requests[0]);}
  else if(kind==='switch_us'){api.setMarketMode(container,true);response(requests[0]);}
  else if(kind==='switch_domestic'){api.selectStock(container,{...stock,code:'005930'},false);response(requests[0]);}
  else if(kind==='superseded'){button.events.click();response(requests[1],{...payload,direction:'down'});await flush();response(requests[0]);}
  else if(kind==='timeout'){for(const [id,t]of [...timers]){timers.delete(id);t.fn();}response(requests[0]);}
  else if(kind==='search_race'||kind==='search_then_click')response(requests[0],{...payload,code:'005930'});
  else if(kind==='busy')response(requests[0],null,409);
  else if(kind==='failure')requests[0].reject(new Error('network'));
  else if(kind==='unsafe')response(requests[0],{...payload,direction:'unclear',reason:'<img src=x onerror=1>'});
  else if(kind==='unknown')response(requests[0],{...payload,direction:'unclear',reason:'자료 부족'});
  else if(kind==='expired')response(requests[0],{...payload,expiresAt:'2026-10-06T09:00:00+09:00'});
  else if(kind==='wrong_code')response(requests[0],{...payload,code:'005930'});
  else response(requests[0]);
 }
 await flush();
 if(kind==='expiry'){for(const [id,t]of [...timers]){timers.delete(id);t.fn();}}
 console.log(JSON.stringify({initial,final:snap(),shell:api.hourCandidatesShell(),
 requestDetails:requests.map(r=>({url:r.url,aborted:r.opts.signal.aborted,cache:r.opts.cache}))}));
})().catch(error=>{console.error(error);process.exit(1);});
"""


@unittest.skipUnless(shutil.which('node'), 'node required')
class DirectionUiTests(unittest.TestCase):
    def run_ui(self, kind='manual'):
        result=subprocess.run(['node','-e',HARNESS,kind],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
        return json.loads(result.stdout)

    def test_simple_shell_has_no_rankings_or_settings(self):
        data=self.run_ui()
        self.assertIn('1시간 방향',data['shell'])
        self.assertIn('실험 판단',data['shell'])
        for old in ['순위 종목','급등 제외','type="number"','후보']:
            self.assertNotIn(old,data['shell'])
        self.assertTrue(data['initial']['hidden'])
        self.assertEqual(data['initial']['requests'],0)

    def test_explicit_stock_click_search_and_single_result_each_request_once(self):
        for kind in ['manual','row_click','single_manual','search_manual']:
            data=self.run_ui(kind)
            self.assertEqual(data['final']['requests'],1,kind)
            self.assertIn('/hour-direction?code=035420&name=NAVER',data['requestDetails'][0]['url'])
            self.assertEqual(data['requestDetails'][0]['cache'],'no-store')
            self.assertIn('상승 우세',data['final']['html'])
            self.assertNotIn('저점 상승',data['final']['html'])

    def test_url_automatic_selection_and_no_selection_never_request(self):
        for kind in ['automatic','single_auto','search_auto','no_selection']:
            self.assertEqual(self.run_ui(kind)['final']['requests'],0,kind)

    def test_changing_stock_market_or_clear_aborts_and_cannot_show_old_signal(self):
        for kind in ['clear','switch_us','switch_domestic']:
            data=self.run_ui(kind)
            self.assertTrue(data['requestDetails'][0]['aborted'],kind)
            self.assertNotIn('상승 우세',data['final']['html'])
            self.assertEqual(data['final']['requests'],1)

    def test_late_old_response_cannot_overwrite_new_direction(self):
        data=self.run_ui('superseded')
        self.assertTrue(data['requestDetails'][0]['aborted'])
        self.assertIn('하락 우세',data['final']['html'])
        self.assertNotIn('상승 우세',data['final']['html'])

    def test_timeout_failure_busy_wrong_stock_do_not_infer_falling(self):
        for kind in ['timeout','busy','failure','wrong_code']:
            data=self.run_ui(kind)
            self.assertIn('판단 어려움',data['final']['html'],kind)
            self.assertNotIn('하락 우세',data['final']['html'])
            self.assertFalse(data['final']['disabled'])

    def test_unknown_reason_is_inline_and_escaped(self):
        self.assertIn('자료 부족',self.run_ui('unknown')['final']['html'])
        html=self.run_ui('unsafe')['final']['html']
        self.assertIn('&lt;img',html)
        self.assertNotIn('<img',html)

    def test_expired_and_local_expiry_clear_signal_without_request(self):
        for kind in ['expired','expiry']:
            data=self.run_ui(kind)
            self.assertIn('만료',data['final']['html'])
            self.assertNotIn('상승 우세',data['final']['html'])
            self.assertEqual(data['final']['requests'],1)


    def test_late_search_response_cannot_reselect_old_stock_or_make_new_signal(self):
        for kind in ['search_race', 'search_then_click']:
            data=self.run_ui(kind)
            self.assertEqual(data['final']['requests'],1,kind)
            self.assertIn('code=005930',data['requestDetails'][0]['url'])
            self.assertFalse(data['requestDetails'][0]['aborted'])
