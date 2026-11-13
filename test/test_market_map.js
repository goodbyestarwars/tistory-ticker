'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const src = fs.readFileSync('js/market-map.js','utf8');
const marketTemp = fs.readFileSync('js/market-temp.js','utf8');
const menu = fs.readFileSync('js/skin-menu.js','utf8');
const context = { window: {NineUI:{escapeHtml: s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}}, document: {} };
vm.runInNewContext(src,context,{filename:'market-map.js'});
const map = context.window.MarketMap;
assert.ok(map && typeof map.init === 'function');
const wics = {
  '005930':{name:'삼성전자',sector:'IT',industry:'반도체'},
  '000660':{name:'SK하이닉스',sector:'IT',industry:'반도체'},
  '035420':{name:'NAVER',sector:'커뮤니케이션서비스'},
  '000001':{name:'샘플',sector:'IT'},
  'BAD_ID':{name:'비상장',sector:'IT'}
};
const picks = map.chooseCandidates(wics,{테마:[{code:'000660',market:'KOSPI'},{code:'000660',market:'KOSPI'}]});
assert.equal(picks.length,4);
assert.equal(new Set(picks.map(x=>x.code)).size,4);
assert.equal(picks.find(x=>x.code==='000660').sector,'IT'); // 테마가 공식 업종을 바꾸면 안 됨
const state = {
  candidates:picks,
  quotes:[
    {code:'005930',market:'KOSPI',price:100000,changeRate:3,marketCap:100e12},
    {code:'000660',market:'KOSPI',price:200000,changeRate:-2,marketCap:50e12},
    {code:'035420',market:'KOSPI',price:300000,changeRate:1,marketCap:20e12},
    {code:'000001',market:'KOSDAQ',price:2000,changeRate:null,marketCap:null}
  ],
  market:'ALL',sort:'cap',search:'',focus:'',size:'cap'
};
let groups = map.grouped(state);
assert.equal(groups.reduce((sum,g)=>sum+g.rows.length,0),4);
assert.equal(groups.find(g=>g.sector==='IT').avg,0.5); // 결측은 0%로 산입하지 않음
state.market='KOSDAQ';
groups=map.grouped(state);
assert.equal(groups.reduce((n,g)=>n+g.rows.length,0),1);
state.market='ALL';state.search='하이닉스';
groups=map.grouped(state);
assert.equal(groups[0].rows[0].code,'000660');
assert.ok(marketTemp.includes("get('view') === 'map'"));
assert.ok(marketTemp.includes("waitMarketMapAccess_().then(function (access)"));
assert.ok(marketTemp.includes("access.isAdmin()"));
assert.ok(menu.includes("/page/market-temp?view=map"));
assert.ok(src.includes('{fallback:false}')); // GAS 공개 시세 폴백 금지

// Regression: market-temp.js may start before skin-shell's async access-gate.js is ready.
const start = marketTemp.indexOf('  function waitMarketMapAccess_() {');
const end = marketTemp.indexOf('  function bootMapView_(container) {', start);
assert.ok(start >= 0 && end > start, 'access loader should be present');
const accessSource = marketTemp.slice(start, end);
const factory = vm.runInNewContext('(function (global, document) {\n' + accessSource + '\nreturn waitMarketMapAccess_;\n})');
function tag() {
  return { handlers: {}, parentNode: null,
    addEventListener(name, fn) { this.handlers[name] = fn; },
    emit(name) { if (this.handlers[name]) this.handlers[name](); }
  };
}
function environment(win, existingTag) {
  const made = [];
  const doc = {
    getElementById() { return existingTag || null; },
    createElement() { const el = tag(); made.push(el); return el; },
    head: { appendChild(el) { el.parentNode = this; } }
  };
  return { run: factory(win, doc), made };
}
const allowed = { ready: Promise.resolve({}), isAdmin() { return true; } };
async function verifyGateLoading() {
  { const env = environment({ NineAccess: allowed, setTimeout() {} }, null);
    assert.equal(await env.run(), allowed); assert.equal(env.made.length, 0); }
  { const pending = tag(); pending.parentNode = {}; const win = { setTimeout() {} };
    const env = environment(win, pending); const result = env.run();
    win.NineAccess = allowed; pending.emit('load');
    assert.equal(await result, allowed); assert.equal(env.made.length, 0); }
  { const win = { setTimeout() {} }; const env = environment(win, null);
    const result = env.run(); assert.equal(env.made.length, 1);
    assert.equal(env.made[0].id, 'nine-access-gate-js');
    win.NineAccess = allowed; env.made[0].emit('load');
    assert.equal(await result, allowed); }
  { const win = { setTimeout() {} }; const env = environment(win, null);
    const result = env.run(); env.made[0].emit('error');
    await assert.rejects(result, /접근 제어/); }
  { let timeout; const win = { setTimeout(fn) { timeout = fn; } };
    const env = environment(win, null); const result = env.run(); timeout();
    await assert.rejects(result, /접근 제어/); }
}
verifyGateLoading().then(function () {
  console.log('market-map: grouping, selection, admin gate, async gate load, missing/error fail-closed PASS');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
