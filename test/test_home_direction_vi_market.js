'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/skin-main.js','utf8');
function fn(name){const at=src.indexOf('    function '+name+'(');assert(at>=0,name);return src.slice(at,src.indexOf('\n    }',at)+6);}
const ctx={Date,isFinite};vm.createContext(ctx);vm.runInContext(fn('resolveDomesticMarketDirection'),ctx);
const market={marketBreadth:{total:{up:508,down:1992,total:2625}},components:{riseRatio:{ratio:.1},avgChange:{avgChangeRate:-2}}};
function indices(a,b){return [a,b].map((change_rate,i)=>({symbol:i?'KOSDAQ':'KOSPI',change_rate,updated_at:new Date().toISOString()}));}
const resolve=(m,r)=>ctx.resolveDomesticMarketDirection(m,r).label;
assert.equal(resolve(market,indices(.93,-1.04)),'혼조','live mixed indices must override weak screened sample');
assert.equal(resolve(market,indices(1,1)),'지수 상승·종목 약세');
assert.equal(resolve(market,indices(-.2,-.3)),'강한 약세','full-market falling breadth stays visible without exaggerating plunge');
const panic={marketBreadth:{total:{up:100,down:900,total:1000}}};
assert.equal(resolve(panic,indices(-2,-3)),'급락');
assert.equal(resolve(panic,indices(-.5,-3)),'강한 약세');
assert.equal(resolve({components:market.components},indices(-2,-3)),'강한 약세','sample alone cannot prove market plunge');
assert.equal(resolve(market,indices(0,-1)),'혼조');
assert.equal(resolve(market,[]),'데이터 확인 중');
for(const bad of [null,'',NaN,Infinity]) {const r=indices(1,-1);r[0].change_rate=bad;assert.equal(resolve(market,r),'데이터 확인 중');}
for(const bad of [{stale:true},{updated_at:'invalid'},{updated_at:new Date(Date.now()-301000).toISOString()}]){const r=indices(1,-1);Object.assign(r[0],bad);assert.equal(resolve(market,r),'데이터 확인 중');}
const strong={marketBreadth:{total:{up:900,down:100,total:1000}}};assert.equal(resolve(strong,indices(2,3)),'급등');
// Exercise the complete volatility module, its market-change event and delayed response.
let selected='domestic',pending,requests=0;
const winEvents={},docEvents={};
const box={hidden:true,innerHTML:'',querySelector:()=>({})};
const history={hidden:true,setAttribute(){}};
const board={querySelector:s=>s==='[data-vol-monitor]'?box:s==='[data-vol-history]'?history:null};
const scope={window:{HomeMarketSelection:{get:()=>selected},addEventListener:(n,f)=>winEvents[n]=f},
 document:{hidden:false,getElementById:()=>board,addEventListener:(n,f)=>docEvents[n]=f},
 fetch:()=>{requests++;return new Promise(resolve=>pending=resolve);},setTimeout(){},setInterval(){},Date};
vm.createContext(scope);
const start=src.indexOf('  (function homeCircuitBreakerBadges()');const end=src.indexOf('\n  })();',start)+10;
vm.runInContext(src.slice(start,end),scope);
const data={vi_available:true,vi_active_count:2,vi_list:[],vi_today:[1,2].map(n=>({code:String(n),status:'active',market:'KOSPI',triggered_at:new Date().toISOString()}))};
(async()=>{
 winEvents['home-market-change']();assert.equal(requests,1);
 pending({ok:true,json:async()=>data});await new Promise(r=>setImmediate(r));
 assert.equal(box.hidden,false);assert.match(box.innerHTML,/VI 2건/);
 selected='us';winEvents['home-market-change']();assert.equal(box.hidden,true);assert.equal(box.innerHTML,'');assert.equal(history.hidden,true);
 // A stale cached render path must not resurrect the domestic badge in US view.
 docEvents.click({target:{closest:s=>s==='[data-vol-open]'?{getAttribute:()=> 'vi'}:null}});assert.equal(box.hidden,true);
 selected='domestic';winEvents['home-market-change']();const complete=pending;
 selected='us';winEvents['home-market-change']();complete({ok:true,json:async()=>data});await new Promise(r=>setImmediate(r));assert.equal(box.hidden,true);assert.equal(box.innerHTML,'');
 selected='closed';winEvents['home-market-change']();assert.equal(box.hidden,true);
 const count=requests;winEvents['home-market-change']();assert.equal(requests,count,'closed view never requests domestic VI');
 console.log('PASS domestic index/breadth classification and VI market switching, cached render, delayed response, closed view');
})().catch(e=>{console.error(e);process.exitCode=1;});
