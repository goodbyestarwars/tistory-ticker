'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const src = fs.readFileSync('js/market-map.js','utf8');
const marketTemp = fs.readFileSync('js/market-temp.js','utf8');
const menu = fs.readFileSync('js/skin-menu.js','utf8');
const css = fs.readFileSync('css/market-map.css','utf8');
const accessPolicy = fs.readFileSync('scripts/cloud-vm/access_policy.py','utf8');
const main = fs.readFileSync('scripts/cloud-vm/main.py','utf8');
const context = {window:{NineUI:{escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}},document:{}};
vm.runInNewContext(src,context,{filename:'market-map.js'});
const map=context.window.MarketMap;
assert.equal(typeof map.init,'function');
const wics={
 '005930':{name:'삼성전자',sector:'IT',industry:'반도체와반도체장비'},
 '000660':{name:'SK하이닉스',sector:'IT',industry:'반도체와반도체장비'},
 '035420':{name:'NAVER',sector:'커뮤니케이션서비스',industry:'미디어'},
 '000001':{name:'가상 예시',sector:'IT',industry:'기술'},
 'BAD_ID':{name:'Invalid',sector:'IT',industry:'기술'}
};
const choices=map.chooseCandidates(wics);
assert.equal(choices.length,4);
assert.equal(new Set(choices.map(r=>r.code)).size,4);
const fakeCategory=map.chooseCandidates(wics,{'내 카테고리':[{code:'005930',market:'KOSDAQ'}]});
assert.equal(choices.map(x=>x.code).join(','),fakeCategory.map(x=>x.code).join(','));
const benchmarks={KOSPI:{asOf:'2026-11-12',base1m:'2026-10-12',base1y:'2025-11-12',index1m:4,index1y:10},
KOSDAQ:{asOf:'2026-11-12',base1m:'2026-10-12',base1y:'2025-11-12',index1m:1,index1y:5}};
const prices={'005930':{'2026-11-12':150,'2026-10-12':100,'2025-11-12':100},
'000660':{'2026-11-12':95,'2026-10-12':100}, // No 1Y, must not invent it
'035420':{'2026-11-12':120,'2026-10-12':100,'2025-11-12':100},
'000001':{'2026-11-12':80,'2026-10-12':100,'2025-11-12':100}};
const quotes=[
 {code:'005930',market:'KOSPI',price:155000,changeRate:3,marketCap:900e12,volume:1000},
 {code:'000660',market:'KOSPI',price:95000,changeRate:-2,marketCap:150e12},
 {code:'035420',market:'KOSPI',price:121000,changeRate:1,marketCap:40e12},
 {code:'000001',market:'KOSDAQ',price:80000,changeRate:null,marketCap:0}
];
const s={candidates:choices,quotes:quotes,rs:{benchmarks:benchmarks,prices:prices},
 market:'ALL',sector:'',industry:'',search:'',size:'cap',zoom:1,selectedCode:''};
let list=map.nodesOf(s);
assert.equal(list.length,2);
assert.equal(list[0].kind,'group');
assert.ok(list.every(n=>n.total>=1&&n.coverage>=1));
let rs=map.getRS({code:'005930',market:'KOSPI'},s.rs);
assert.equal(rs.rs1m,46);
assert.equal(rs.rs1y,40);
assert.equal(map.getRS({code:'000660',market:'KOSPI'},s.rs).rs1y,null);
assert.equal(map.getRS({code:'005930',market:'미분류'},s.rs).rs1m,null);
s.sector='IT';list=map.nodesOf(s);assert.equal(list.length,2);
s.industry='반도체와반도체장비';list=map.nodesOf(s);
assert.equal(list.length,2);
assert.equal(list.filter(n=>n.rs1y===null).length,1);
s.market='KOSDAQ';assert.equal(map.nodesOf(s).length,0);
s.market='ALL';s.search='삼성전자';assert.equal(map.nodesOf(s).length,1);
const graph=map.layout(map.nodesOf(s));
assert.equal(graph.points.length,1);
assert.ok(graph.points[0].x>0&&graph.points[0].y>0);
assert.ok(css.includes('.mtm-tether'));
assert.ok(!css.includes('.mtm-stocks'));
assert.ok(marketTemp.includes("get('view') === 'map'"));
assert.ok(marketTemp.includes('access.isAdmin()'));
assert.ok(menu.includes('/page/market-temp?view=map'));
assert.ok(accessPolicy.includes("'/market-atlas-rs'"));
assert.ok(main.includes("require_google_admin(request)"));
assert.ok(main.includes("market_atlas_rs.read_snapshot"));
assert.ok(src.includes('{fallback:false}'));
assert.ok(src.includes("credentials:'include'"));
assert.ok(!src.includes('Math.random'));
assert.ok(!src.includes('curated'));
assert.ok(!src.includes('X축: 250거래일, Y축: 20거래일')); // default view is jargon-free
assert.ok(src.includes('오른쪽 = 지난 1년 시장보다 강함'));
assert.ok(src.includes('위쪽 = 최근 한 달 시장보다 강함'));
assert.ok(src.includes('최근 강해짐') && src.includes('꾸준히 강함') && src.includes('최근 주춤'));
assert.ok(src.includes('<details class="mtm-method">')); // raw methodology opt-in
assert.ok(src.includes('종목 수익률에서 해당 시장(KOSPI 또는 KOSDAQ) 지수 수익률을 뺀 값'));
assert.ok(src.includes('시장보다 강하다고 반드시 주가가 오른 것은 아닙니다'));
assert.ok(css.includes('.mtm-guide') && css.includes('.mtm-method[open]'));


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
  console.log('market-map: RS source, axis math, 3-level drilldown, missing data, duplicate-free WICS, secure API, gate race PASS');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
