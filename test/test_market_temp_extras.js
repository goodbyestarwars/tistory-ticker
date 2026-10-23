// 수급·심리·금리 카드(표시 전용): 값은 응답 그대로, 강도는 응답 이력 분포(백분위)로, 값이 없으면 '미수신'.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={programTradingCard_,optionCard_,rateCard_,extrasBlock_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const t=sb.window.t;
const hist=Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),arbitrage:0,nonArbitrage:(i%2?1:-1)*(i+1)*10000}));// 절댓값 10000..1000000
const pt=(v,date='2026-10-22')=>({available:true,source:'kis',date,arbitrage:5000,nonArbitrage:v,history:hist});
const now=Date.parse('2026-10-23T09:00:00Z'); // 18:00 KST
assert.equal(t.programTradingCard_(pt(-950000),now).tier,'sellBig');
assert.equal(t.programTradingCard_(pt(700000),now).tier,'buyMild');
assert.equal(t.programTradingCard_(pt(-100000),now).tier,'flat');
assert.equal(t.programTradingCard_({available:false},now),null);
assert.equal(t.programTradingCard_({...pt(-1),history:hist.slice(0,10)},now).tier,null,'이력 60건 미만이면 강도 안 정함');
assert(t.programTradingCard_(pt(-5e5,'2026-10-23'),Date.parse('2026-10-23T05:00:00Z')).time.includes('장중 집계'));
assert(t.programTradingCard_(pt(-672263,'2026-10-22'),now).lines[0][1]==='-6,723억');
assert.equal(t.optionCard_({CALL:{volume:2386,updated_at:'2026-10-23T06:13:00Z'},PUT:{volume:3402,updated_at:'2026-10-23T06:13:00Z'}}).tier,'putHigh');
assert.equal(t.optionCard_({CALL:{volume:3000,updated_at:'2026-10-23T06:13:00Z'},PUT:{volume:1000,updated_at:'2026-10-23T06:13:00Z'}}).tier,'callHigh');
assert.equal(t.optionCard_({CALL:{volume:0},PUT:{volume:5}}),null);
const series=(sym,vals)=>({symbol:sym,stale:false,price:vals[vals.length-1],chart:vals.map((v,i)=>({date:'202610'+String(10+i),close:v}))});
const wide=[...Array(30)].map((_,i)=>0.1*Math.sin(i)+0.3);
let by={US10Y:series('US10Y',wide.map((s,i)=>2+s)),US2Y:series('US2Y',wide.map(()=>2)),KTB3Y:series('KTB3Y',[3.8,3.84])};
let rc=t.rateCard_(by);assert(rc&&['flat','widenMild','widenBig','narrowMild','narrowBig'].includes(rc.tier)&&rc.lines.length===2);
by.US10Y=series('US10Y',wide.map(()=>1.5));assert.equal(t.rateCard_(by).tier,'inverted','10년<2년이면 역전');
assert.equal(t.rateCard_({}),null);
const html=t.extrasBlock_({programTrading:pt(-950000)},[],{CALL:{volume:1,updated_at:'2026-10-23T06:13:00Z'},PUT:{volume:2,updated_at:'2026-10-23T06:13:00Z'}},now);
assert(html.includes('수급·심리·금리')&&html.includes('data-market-metric="x-prog"')&&html.includes('data-market-metric="x-rate"')&&html.includes('미수신'),'금리 카드는 응답 없으면 미수신');
const sel=t.extrasBlock_({programTrading:pt(-950000)},[],null,now,'x-prog');assert(sel.includes('mt-xcard is-selected')&&sel.includes('data-market-metric="x-prog"'),'프로그램매매 카드는 누르면 최근 시장 흐름으로');
console.log('extras ok');
