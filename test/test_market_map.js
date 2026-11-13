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
assert.ok(!src.includes('오른쪽 = 지난 1년 시장보다 강함'));
assert.ok(!src.includes('위쪽 = 최근 한 달 시장보다 강함'));
assert.ok(src.includes('data-mtm-dialog') && src.includes('dialog.showModal()'));
assert.ok(src.includes('data-mtm-category') && src.includes('사업분야'));
assert.ok(src.includes('최근 강해짐') && src.includes('꾸준히 강함') && src.includes('최근 주춤'));
assert.ok(src.includes('<details class="mtm-method">')); // raw methodology opt-in
assert.ok(src.includes('종목 수익률에서 해당 시장(KOSPI 또는 KOSDAQ) 지수 수익률을 뺀 값'));
assert.ok(src.includes('시장보다 강하다고 반드시 주가가 오른 것은 아닙니다'));
assert.ok(css.includes('.mtm-guide') && css.includes('.mtm-method[open]'));

assert.ok(src.includes('data/company-profiles.js')); // existing static business descriptions
assert.ok(src.includes('loadCompanyDescriptions(state)')); // async; does not block quotes or RS
assert.ok(src.includes('data-mtm-list-title') && src.includes('data-mtm-identify'));
assert.ok(src.includes('mtm-bubble-number')); // stock bubble ↔ list number
assert.ok(src.includes('mtm-business-panel')); // selected company's business
assert.ok(css.includes('.mtm-list-business') && css.includes('.mtm-business-panel'));
assert.ok(css.includes('.mtm-bubble-number') && css.includes('.mtm-list-number'));
const large=Object.fromEntries(Array.from({length:350},(_,i)=>[String(100000+i),{name:'회사'+i,sector:'IT',industry:'반도체'}]));
assert.equal(map.chooseCandidates(large).length,350,'entire classified universe is searchable, not 24 per sector');
const manyGroups={candidates:map.chooseCandidates(Object.fromEntries(Array.from({length:26},(_,i)=>[String(200000+i),{name:'회사'+i,sector:'산업'+i,industry:'업종'+i}]))),quotes:[],rs:null,market:'ALL',search:'',sector:'',industry:'',groupPage:0};
assert.equal(map.nodesOf(manyGroups,true).length,26);assert.equal(map.nodesOf(manyGroups).length,12);
const firstGroups=map.nodesOf(manyGroups).map(n=>n.key);manyGroups.groupPage=1;
assert.equal(map.nodesOf(manyGroups).length,12);assert(map.nodesOf(manyGroups).every(n=>!firstGroups.includes(n.key)));
const catalog=map.chooseCandidates({},null,null,{'새회사':'0012A0','상장ETF':'001234','예시ETN':'001235','예시스팩':'001236'},['상장ETF']);
assert.equal(catalog.length,1);assert.equal(catalog[0].code,'0012A0');assert.equal(catalog[0].sector,'업종 미등록');
assert.equal(map.chooseCandidates({'001236':{name:'예시스팩',sector:'금융',industry:'금융'}}).length,0);
const tagged=map.chooseCandidates({'005930':wics['005930']},{반도체:[{code:'005930'}]},
 {companies:{'005930':{summary:'반도체 장비를 제조하고 반도체 소재를 생산함.'}}});
assert(tagged[0].tags.includes('반도체 장비') && tagged[0].tags.includes('반도체 소재'));
assert(!map.businessTags({code:'x',industry:'의료'},{companies:{}},{}).includes('원자력'));
assert(!map.businessTags({code:'x',industry:'반도체'},{companies:{x:{summary:'시스템 반도체 후공정 테스트와 웨이퍼 테스트 사업을 영위함.'}}},{}).includes('반도체 소재'));
assert(!map.businessTags({code:'x',industry:'반도체'},{companies:{x:{summary:'가전용 부품 중심 시스템반도체 설계와 판매를 영위함.'}}},{}).includes('반도체 부품'));
const stock = {key:'000660',kind:'stock',code:'000660',name:'SK하이닉스',price:95000,
  rate:1.2,cap:100e12,industry:'반도체와반도체장비',rs1m:2.3};
const profileState={profiles:{asOf:'2026-10-07',source:'네이버 증권 · WISEreport',
  companies:{'000660':{summary:'DRAM과 NAND Flash 메모리 반도체를 생산함.'}}},
  profileStatus:'ready',selectedCode:''};
assert.equal(map.businessSummary(profileState,stock),'DRAM과 NAND Flash 메모리 반도체를 생산함.');
const businessHtml=map.nodeBusinessRow(profileState,stock,3);
assert.ok(businessHtml.includes('mtm-number-stock">04')); // same number as SVG bubble
assert.ok(businessHtml.includes('SK하이닉스'));
assert.ok(businessHtml.includes('메모리 반도체를 생산함'));
const missingBusiness=map.businessLine(profileState,{code:'999999',industry:'의료장비'});
assert.ok(missingBusiness.includes('사업 소개가 없습니다.'));
assert.ok(missingBusiness.includes('의료장비'));
assert.equal(map.businessLine({profiles:null,profileStatus:'loading'},stock),'회사 소개를 불러오는 중입니다.');
const maliciousState={profiles:{companies:{'000660':{summary:'<img src=x onerror="alert(1)">'}}},
  profileStatus:'ready',selectedCode:''};
const safeRow=map.nodeBusinessRow(maliciousState,stock,0);
assert.ok(!safeRow.includes('<img') && safeRow.includes('&lt;img')); // static data escaped



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
  console.log('market-map: RS, WICS, company descriptions, numbered bubbles, safe fallback, admin gate PASS');
}).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
