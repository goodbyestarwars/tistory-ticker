"""미국 호가 자동 갱신·실패·종목 전환을 실제 JS와 가짜 시계로 검증한다."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require('fs'), vm = require('vm');
let source = fs.readFileSync('js/us-stocks.js', 'utf8').replace(
  'global.UsStocks = { init: init, select: select, pause: pause };',
  'global.UsStocks = { init, select, pause, state, loadOrderbook, startRefresh, stopRefresh, updateOrderbookCurrent };');
let now=0, nextId=0;
const timers=new Map(), intervals=new Map(), requests=[], events={};
const status={textContent:''}, price={textContent:''}, change={textContent:''};
const current={querySelector(s){return s==='strong'?price:change;}};
const mount={innerHTML:'',querySelector(){return this.innerHTML.includes('us-stocks-book-current')?current:null;}};
const container={hidden:false,innerHTML:''};
const document={hidden:false,querySelector(s){
  return s==='#usStocksOrderbook'?mount:s==='[data-us-book-status]'?status:
    s==='link[data-us-stocks-css]'?{sheet:true}:null;
},querySelectorAll(){return [];},addEventListener(k,cb){events[k]=cb;}};
const window={AbortController,StockSearchChart:{updateQuote(){}},setTimeout:timeout};
function timeout(cb,delay){const id=++nextId;timers.set(id,{cb,at:now+delay,delay});return id;}
function clear(id){timers.delete(id);}
function fetch(url,options){return new Promise((resolve,reject)=>{
  const req={url,resolve,reject,signal:options&&options.signal};requests.push(req);
  // abort가 반영되지 않는 응답도 남겨, 늦은 성공이 새 종목을 덮지 않는지 확인한다.
});}
vm.runInNewContext(source,{window,document,console,fetch,URLSearchParams,location:{search:''},
  setTimeout:timeout,clearTimeout:clear,setInterval(cb,delay){const id=++nextId;intervals.set(id,{cb,delay});return id;},
  clearInterval(id){intervals.delete(id);}});
const api=window.UsStocks, state=api.state;
function book(symbol='NVDA',p=101){return {symbol,updated_at:1790862571,
  asks:[{price:p,size:90}],bids:[{price:p-1,size:70}]};}
function respond(req,body){req.resolve({ok:true,json:()=>Promise.resolve({success:true,data:body})});}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
async function advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.cb();}await flush();}
function delays(){return [...timers.values()].map(x=>x.delay);}
function setup(symbol='NVDA'){state.symbol=symbol;state.container=container;state.embedded=true;
  state.lastQuote={symbol,price:100,change_rate:1,market_state:'regular'};state.paused=false;}
(async()=>{
  setup();
  const first=api.loadOrderbook(), duplicate=api.loadOrderbook();
  const dedup={requests:requests.length,samePromise:first===duplicate};
  respond(requests[0],book());await flush();
  const initial={html:mount.innerHTML,status:status.textContent,delays:delays()};
  await advance(3000);respond(requests[1],book('NVDA',102));await flush();
  const polled={requests:requests.length,html:mount.innerHTML,delays:delays()};
  state.lastQuote.price=103;state.lastQuote.change_rate=3;api.updateOrderbookCurrent();
  const currentPrice={price:price.textContent,change:change.textContent};
  // 실패 시 마지막 정상 값을 유지하고 15초 뒤 재시도한다.
  await advance(3000);requests[2].reject(Error('offline'));await flush();
  const failed={html:mount.innerHTML,status:status.textContent,delays:delays()};
  await advance(15000);respond(requests[3],book('NVDA',104));await flush();
  const recovered={html:mount.innerHTML,status:status.textContent,delays:delays()};
  // 응답 없는 요청도 10초 뒤 해제한다.
  await advance(3000);const hung=requests[4];await advance(10000);
  const timedOut={aborted:hung.signal.aborted,inFlight:!!state.orderbookRequest,delays:delays()};
  respond(hung,book('NVDA',999));await flush();
  const lateTimeoutIgnored=!mount.innerHTML.includes('$999.00');
  // 첫 요청이 실패해도 재시도를 계속한다.
  api.stopRefresh();state.lastOrderbook=null;mount.innerHTML='loading';api.loadOrderbook();
  requests[5].reject(Error('offline'));await flush();
  const initialFailure={html:mount.innerHTML,delays:delays()};
  await advance(15000);respond(requests[6],book());await flush();
  // 종목 전환 후 늦게 돌아온 이전 종목 응답을 버린다.
  await advance(3000);const old=requests[7];api.select('AAPL');setup('AAPL');api.loadOrderbook();
  respond(requests[8],book('AAPL',200));await flush();respond(old,book('NVDA',900));await flush();
  const switched={html:mount.innerHTML,symbol:state.lastOrderbook.symbol,oldAborted:old.signal.aborted};
  // 장 마감 상태에서는 조회 간격을 늘린다.
  api.stopRefresh();state.lastQuote.market_state='closed';api.loadOrderbook();
  respond(requests[9],book('AAPL',201));await flush();
  const closed={status:status.textContent,delays:delays()};
  // 숨긴 임베드 화면과 pause 상태에서는 요청하지 않는다.
  api.pause();const before=requests.length;api.startRefresh();await api.loadOrderbook();
  const paused={requests:requests.length-before,timers:timers.size,intervals:intervals.size};
  state.paused=false;container.hidden=true;api.startRefresh();await api.loadOrderbook();
  const hiddenModule={requests:requests.length-before,timers:timers.size};container.hidden=false;
  // 실제 visibilitychange 콜백으로 중지와 즉시 재개를 확인한다.
  api.init(container);setup();document.hidden=true;events.visibilitychange();
  const hiddenTab={timers:timers.size,intervals:intervals.size};
  document.hidden=false;const resumeBefore=requests.length;events.visibilitychange();await flush();
  const resumed={bookRequests:requests.slice(resumeBefore).filter(r=>r.url.includes('us-orderbook')).length,
    quoteRequests:requests.slice(resumeBefore).filter(r=>r.url.includes('us-quote')).length};
  api.pause();
  console.log(JSON.stringify({dedup,initial,polled,currentPrice,failed,recovered,timedOut,lateTimeoutIgnored,
    initialFailure,switched,closed,paused,hiddenModule,hiddenTab,resumed}));
})().catch(err=>{console.error(err);process.exit(1);});
"""


@unittest.skipUnless(shutil.which("node"), "node가 없으면 건너뛴다")
class UsOrderbookRefreshTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(["node", "-e", HARNESS], cwd=ROOT, capture_output=True,
                                text=True, encoding="utf-8", check=True)
        cls.result = json.loads(result.stdout)

    def test_refreshes_every_three_seconds_without_overlapping_requests(self):
        self.assertEqual(self.result["dedup"], {"requests": 1, "samePromise": True})
        self.assertEqual(self.result["initial"]["delays"], [3000])
        self.assertEqual(self.result["polled"]["requests"], 2)
        self.assertIn("$102.00", self.result["polled"]["html"])
        self.assertIn("3초 갱신", self.result["initial"]["status"])

    def test_keeps_current_price_synced_independently_of_book_poll(self):
        self.assertEqual(self.result["currentPrice"], {"price": "$103.00", "change": "+3.00%"})

    def test_preserves_last_book_and_recovers_after_failure(self):
        self.assertIn("$102.00", self.result["failed"]["html"])
        self.assertIn("갱신 지연", self.result["failed"]["status"])
        self.assertEqual(self.result["failed"]["delays"], [15000])
        self.assertIn("$104.00", self.result["recovered"]["html"])
        self.assertEqual(self.result["recovered"]["delays"], [3000])

    def test_timeout_releases_request_and_ignores_late_response(self):
        self.assertEqual(self.result["timedOut"], {"aborted": True, "inFlight": False, "delays": [15000]})
        self.assertTrue(self.result["lateTimeoutIgnored"])

    def test_retries_even_when_first_request_fails(self):
        self.assertIn("자동으로 다시 조회", self.result["initialFailure"]["html"])
        self.assertEqual(self.result["initialFailure"]["delays"], [15000])

    def test_symbol_switch_aborts_and_discards_old_book(self):
        self.assertEqual(self.result["switched"]["symbol"], "AAPL")
        self.assertTrue(self.result["switched"]["oldAborted"])
        self.assertIn("$200.00", self.result["switched"]["html"])
        self.assertNotIn("$900.00", self.result["switched"]["html"])

    def test_closed_market_slows_down(self):
        self.assertEqual(self.result["closed"]["delays"], [15000])
        self.assertIn("장 마감", self.result["closed"]["status"])

    def test_hidden_or_paused_views_stop_and_visible_tab_resumes_immediately(self):
        self.assertEqual(self.result["paused"], {"requests": 0, "timers": 0, "intervals": 0})
        self.assertEqual(self.result["hiddenModule"], {"requests": 0, "timers": 0})
        self.assertEqual(self.result["hiddenTab"], {"timers": 0, "intervals": 0})
        self.assertEqual(self.result["resumed"], {"bookRequests": 1, "quoteRequests": 1})

    def test_domestic_selection_pauses_us_module(self):
        source = (ROOT / "js/stock-search.js").read_text(encoding="utf-8")
        self.assertIn("!isUs && global.UsStocks", source)
        self.assertIn("global.UsStocks.pause();", source)
