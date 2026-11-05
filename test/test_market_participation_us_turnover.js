'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('js/skin-main.js','utf8');
function extract(name) {
  const a=src.indexOf('    function '+name+'(');
  assert(a>=0,name+' is present');
  const b=src.indexOf('\n    }',a);
  assert(b>a,name+' closes');
  return src.slice(a,b+6);
}
const now=Date.now();
const shares={status:'ok',basis:'same-time-5m-volume-sum',lookbackDays:10,
  eligible:100,total:100,current:140,baseline:100,index100:140};
const licensed={status:'ok',basis:'same-time-cumulative-30m',market:'US',unit:'USD',
  lookbackDays:5,sampleDays:5,publicDisplayAuthorized:true,current:1100,baseline:1000,
  index100:110,retrievedAt:new Date(now).toISOString(),asOf:new Date(now-60000).toISOString()};
const sharesOnly={status:'ok',volumeIndex:shares};
const licensedEntry={...sharesOnly,turnoverIndex:licensed};
const target={innerHTML:'',hidden:false},basis={innerHTML:'',hidden:false};
const ctx={isFinite,
  escapeHomeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  latestHomeParticipation:{us:null},homeMarketSession:()=>({market:'us'}),
  usRegularSessionState:()=>({open:true}),dashboardSection:{querySelector:s=>
    s==='[data-home-participation]'?target:s==='[data-participation-basis]'?basis:null}};
vm.createContext(ctx);
vm.runInContext(['homeParticipationModel','homeVolumeScale','renderUsParticipation','renderMarketParticipation'].map(extract).join('\n'),ctx);
function model(e){return ctx.homeParticipationModel('us',{byIndex:{SP500:e,NASDAQ:e,SOX:e}})[0];}
function show(e){ctx.latestHomeParticipation.us={byIndex:{SP500:e,NASDAQ:e,SOX:e}};ctx.renderMarketParticipation();return {html:target.innerHTML,basis:basis.innerHTML};}
assert.equal(model(sharesOnly).volume,null,'share volume never becomes traded USD');
assert.equal(model(sharesOnly).secondaryVolume.index100,140,'previous verified share-volume is auxiliary');
const no=show(sharesOnly);
assert(no.html.includes('미연동'),'unlicensed USD turnover cannot show a number');
assert(no.html.includes('거래량 보조 140.0 / 100'),'legacy share volume is labelled auxiliary');
assert(!no.html.includes('거래대금<br><b class="home-positive">140'),'share-volume must not draw a turnover bar');
assert(no.basis.includes('미국 누적 거래대금 미연동'));
assert.equal(model(licensedEntry).volume.index100,110,'licensed five-day value is displayed');
const yes=show(licensedEntry);
assert(yes.html.includes('>110</b> / 100'),'actual licensed turnover uses the market bar');
assert(yes.html.includes('거래량 보조 140.0 / 100'),'independent share volume remains auxiliary');
assert(yes.basis.includes('5일 동시간대 누적 거래대금 평균 100'));
for(const patch of [{publicDisplayAuthorized:false},{publicDisplayAuthorized:'true'},
 {market:'KRX'},{unit:'KRW'},{basis:'same-time-5m-volume-sum'},{sampleDays:4},
 {lookbackDays:10},{current:null},{baseline:0},{index100:400},
 {retrievedAt:new Date(now-1800000).toISOString()},{asOf:new Date(now-7200000).toISOString()}]){
 const entry={...sharesOnly,turnoverIndex:{...licensed,...patch}};
 assert.equal(model(entry).volume,null,'reject bad USD turnover '+JSON.stringify(patch));
}
console.log('PASS: US licensed notional value 5 days, no Korean/share proxy, UI and source guards');
