/* The active VM control page must resolve unnamed orders and positions via
 * the existing shared KRX dictionary, then re-render without server writes.
 * Run: node test/test_autotrader_activity_names.cjs
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync('js/auto-trader.js', 'utf8');

function grab(marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'missing ' + marker);
  let depth = 0;
  const brace = src.indexOf('{', start);
  let end = brace;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    if (src[end] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(end < src.length, 'unclosed ' + marker);
  return src.slice(start, end + 1);
}

const scripts = [];
const ctx = {
  global: { KRX_MAP: null },
  document: {
    createElement: () => ({}),
    head: { appendChild: (sc) => { scripts.push(sc); } }
  },
  Date, Number, String, Array, Object, Math
};
const functions = [
  '  function esc(',
  '  function fmtPrice(',
  '  function loadKrxMap(',
  '  function krxName(',
  '  function actName(',
  '  function orderRows(',
  '  function orderTable(',
  '  function activityHtml(',
  '  function csvCell(',
  '  function inRange(',
  '  function downloadActivity('
];
const setup = [
  'var krxByCode=null, krxLoading=false, krxRetryAt=0, busy=false, root={};',
  'var ORDERS_FIRST=30, activityOpen={orders:false,candidates:false};',
  'var activityRange={from:"",to:""}, lastActivity=null, lastControl=null;',
  'var ACT_REASON={ENTRY:"신규 진입"}, ACT_STATE={ACK:"접수됨 · 체결 확인 전"};',
  'var SCANNER_LABEL={doubleBottom:"쌍바닥"};',
  'var reRenders=0, lastHtml="", csvSaved=null;',
  'function renderControl(c){reRenders++;lastHtml=activityHtml(c.activity);}',
  'function saveCsv(name,header,lines){csvSaved={name,header,lines};}'
].join('\n');
vm.runInNewContext(
  setup + '\n' + functions.map(grab).join('\n') +
  '\nthis.f={activityHtml, actName, downloadActivity, setControl:(c)=>{lastControl=c;lastActivity=c.activity;}, getHtml:()=>lastHtml, getRenders:()=>reRenders, csv:()=>csvSaved};',
  ctx
);

const activity = {
  orders: [{ no: 1, ts: '2026-11-06T09:01:00+09:00', code: '021240', name: '', side: 'BUY', qty: 8, price: 108200, reason: 'ENTRY', state: 'ACK' }],
  positions: [{ code: '012330', name: '', qty: 2, avg: 369000, state: 'OPEN', buyDay: '2026-11-05' }],
  candidates: { scanDate: '2026-11-05', rows: [{ code: '000080', name: '', scanner: 'doubleBottom', score: 80, basePrice: 16000, reasons: ['검증'] }] }
};
ctx.f.setControl({ activity });
const initial = ctx.f.activityHtml(activity);
assert.ok(initial.includes('<b>021240</b>'));
assert.equal(scripts.length, 1, 'static map loaded only once');
ctx.f.activityHtml(activity);
assert.equal(scripts.length, 1, 'no duplicate script while loading');

ctx.global.KRX_MAP = { '코웨이': '021240', '현대모비스': '012330', '하이트진로': '000080' };
scripts[0].onload();
assert.equal(ctx.f.getRenders(), 1, 're-render existing control data on map load');
const named = ctx.f.getHtml();
for (const n of ['코웨이', '현대모비스', '하이트진로']) {
  assert.ok(named.includes('<b>' + n + '</b>'), n);
}
assert.ok(named.includes('<small class="at-sub">021240</small>'));
assert.ok(named.includes('<small class="at-sub">012330</small>'));
assert.ok(named.includes('<small class="at-sub">000080</small>'));

ctx.f.downloadActivity('orders');
assert.ok(ctx.f.csv().lines[0].includes(',021240,코웨이,매수,'), 'CSV order name');
ctx.f.downloadActivity('cands');
assert.ok(ctx.f.csv().lines[0].includes(',000080,하이트진로,'), 'CSV candidate name');
assert.ok(ctx.f.actName({code:'999999',name:''}).includes('<b>999999</b>'), 'unknown code unchanged');
assert.ok(ctx.f.actName({code:'021240',name:'서버 제공 이름'}).includes('서버 제공 이름'), 'server name wins');
console.log('자동매매 주문·보유·추천 종목명/CSV 공통 사전 폴백 검증 통과');
