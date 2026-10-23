// 시장 한눈에 원자재·가상자산 한 줄: 값은 /futures 응답 그대로, 없거나 stale이면 '미수신'(대체 금지).
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={commodityStrip_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const f=sb.window.t.commodityStrip_;
const now=Date.parse('2026-10-23T05:00:00Z');
const row=(symbol,price,rate,extra={})=>({symbol,price,change_rate:rate,updated_at:'2026-10-23T04:07:00Z',stale:false,...extra});
assert.equal(f([],now),'');
let html=f([row('WTI',99.99,0.52),row('BRENT',113.77,-0.75),row('GOLD',4030.9,0),row('BTC',109358000,0.42)],now);
assert(html.includes('$99.99')&&html.includes('+0.52%')&&html.includes('-0.75%')&&html.includes('109,358,000원')&&html.includes('$4,030.9'));
assert(html.includes('is-positive')&&html.includes('is-negative')&&html.includes('is-neutral'));
assert(html.includes('10.23 13:07 기준'),'KST 시각');
html=f([row('WTI',99.99,0.52),row('BRENT',113.77,0.7,{stale:true}),row('GOLD',4030.9,0.1,{updated_at:'2026-10-20T00:00:00Z'}),row('BTC',null,0.4)],now);
assert.equal((html.match(/미수신/g)||[]).length,3,'브렌트 stale·금 36시간 초과·BTC 값 없음');
assert(!html.includes('113.77'),'stale 값은 표시하지 않음');
console.log('commodity strip ok');
