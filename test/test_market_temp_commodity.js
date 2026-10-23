// 시장 한눈에 원자재·가상자산 블록: 값은 /futures 응답 그대로, 없거나 stale이면 '미수신'(대체 금지), 문구는 참고 어조.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={commodityStrip_,commodityPhrase_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const {commodityStrip_:f,commodityPhrase_:ph}=sb.window.t;
const now=Date.parse('2026-10-23T05:00:00Z');
const row=(symbol,price,rate,extra={})=>({symbol,price,change_rate:rate,updated_at:'2026-10-23T04:07:00Z',stale:false,...extra});
// 문구 규칙 표
const cases=[['oil',2.5],['oil',0.8],['oil',-0.8],['oil',-2.4],['oil',0.1],['gold',-0.9],['gold',2.1],['gold',0.2],['btc',0.4],['btc',-3],['btc',-0.1],['oil',null]];
cases.forEach(([k,r])=>console.log(k,r,'->',ph(k,r)));
assert.equal(ph('oil',2.5),'기름값이 많이 비싸졌어요');assert.equal(ph('oil',-0.8),'기름값이 조금 내렸어요');
assert(ph('gold',-0.9).includes('저가 구간인지 살펴보세요'));assert.equal(ph('btc',0.4),'비트코인이 조금 오르고 있어요');
assert.equal(ph('oil',0.1),'기름값은 큰 변화 없어요');assert.equal(ph('btc',null),'미수신');
cases.forEach(([k,r])=>assert(!/(사세요|파세요|매수하세요|매도하세요|검토해$)/.test(ph(k,r)),'지시형 금지'));
assert.equal(f([],now),'');
let html=f([row('WTI',99.99,0.52),row('BRENT',113.77,-0.75),row('GOLD',4030.9,-0.73),row('BTC',109358000,0.42)],now);
assert.equal((html.match(/mt-commodity-card/g)||[]).length,3,'원유·금·비트코인 3카드');
assert(html.includes('$99.99')&&html.includes('$113.77')&&html.includes('$4,030.9')&&html.includes('1억 936만원'));
assert(html.includes('10.23 13:07 기준')&&html.includes('<svg')&&html.includes('aria-hidden="true"'));
html=f([row('WTI',99.99,0.52),row('BRENT',113.77,0.7,{stale:true}),row('GOLD',4030.9,0.1,{updated_at:'2026-10-20T00:00:00Z'}),row('BTC',null,0.4)],now);
assert(!html.includes('113.77'),'stale 브렌트 값 비표시');
assert.equal((html.match(/미수신/g)||[]).length,5,'브렌트 줄·금 줄+문구·BTC 줄+문구');
console.log('commodity cards ok');
