'use strict';
require('./helpers/common_runtime');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  let now = 0, respond, calls = [];
  const mount = {innerHTML:''},fxMount={innerHTML:''};
  const window = {}, document = {body:{contains:()=>true}};
  const source = fs.readFileSync('js/home-weekly-report.js','utf8').replace(
    'global.HomeWeeklyReport = { init: init, syncContent: syncContent };',
    'global.HomeWeeklyReport = {cards:commodityCards,load:loadWeekendCommodities,fx:loadOfficialFx};');
  const context = {window,document,URL,AbortController,setTimeout,clearTimeout,
    Date:class extends Date {static now(){return now;}},
    fetch:url=>{calls.push(url);return new Promise(resolve=>{respond=data=>resolve({ok:true,json:async()=>data});});}};
  vm.runInNewContext(source,context);
  return {api:window.HomeWeeklyReport,mount,calls,root:{querySelector:s=>s==='[data-hwr-commodities]'?mount:null},fxMount,fxRoot:{querySelector:s=>s==='[data-hwr-fx]'?fxMount:null},
    resolve:data=>respond(data),time:value=>{now=value;}};
}
function quote(symbol, price) {
  return {symbol,price,change_rate:symbol==='GOLD'?-1.29:3.95,updated_at:'2026-10-23T21:59:58Z',
    market_closed:true,stale:false,chart:[{close:100},{close:105}]};
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
test('three contracts retain units, order, actual daily change and source time',()=>{
  const f=fixture(),html=f.api.cards([quote('GOLD',4007.9),quote('BRENT',117.38),quote('WTI',103.27)],false);
  assert.ok(html.indexOf('WTI 원유')<html.indexOf('브렌트유'));
  assert.ok(html.indexOf('브렌트유')<html.indexOf('금 선물'));
  assert.match(html,/\$4,007\.90/);assert.match(html,/배럴/);assert.match(html,/트로이온스/);
  assert.match(html,/-1\.29%/);assert.match(html,/10\.24 06:59 KST/);
  assert.match(html,/주말 수익률이 아닙니다/);assert.match(html,/최근 2개 일봉/);
});
test('failed, stale or missing rows retain last valid price with delay, never a fabricated zero',()=>{
  const f=fixture();assert.match(f.api.cards([],true),/미수신/);
  f.api.cards([quote('BRENT',117.38)],false);
  const stale=f.api.cards([{...quote('BRENT',900),stale:true}],false);
  assert.match(stale,/\$117\.38/);assert.doesNotMatch(stale,/\$900/);assert.match(stale,/갱신 지연/);
  const failed=f.api.cards([],true);assert.match(failed,/\$117\.38/);assert.match(failed,/10\.24 06:59 KST/);
  assert.doesNotMatch(failed,/\$0\.00/);
});
test('one shared stored-only request, pending dedupe, 60s reuse and malformed-payload recovery',async()=>{
  const f=fixture();f.api.load(f.root);f.api.load(f.root);await flush();assert.equal(f.calls.length,1);
  assert.match(f.calls[0],/symbols=WTI,BRENT,GOLD,US2Y,US10Y,US30Y&stored_only=true$/);
  f.resolve({data:[quote('BRENT',117.38)]});await flush();assert.match(f.mount.innerHTML,/\$117\.38/);
  f.time(59999);f.api.load(f.root);await flush();assert.equal(f.calls.length,1);
  f.time(60000);f.api.load(f.root);await flush();assert.equal(f.calls.length,2);
  f.resolve({error:'missing'});await flush();assert.match(f.mount.innerHTML,/갱신 지연/);
  f.api.load(f.root);await flush();assert.equal(f.calls.length,3);
  f.resolve({data:[quote('BRENT',118)]});await flush();assert.match(f.mount.innerHTML,/\$118\.00/);
});

function treasury(symbol,price,previous=5.13,date='20261022') {
  return {symbol,price,change_rate:-3.31,change:999,updated_at:'2026-10-26T12:17:17+09:00',stale:false,
    chart:[{date,close:price},{date:'20261021',close:previous}]};
}
test('Treasuries use observed yields and percentage-point changes, not relative percent or retrieval dates',()=>{
  const f=fixture(),html=f.api.cards([treasury('US30Y',5.29,5.42),treasury('US10Y',4.96),treasury('US2Y',4.65,4.81)],false);
  assert.ok(html.indexOf('data-rate-symbol="US2Y"')<html.indexOf('data-rate-symbol="US10Y"'));
  assert.ok(html.indexOf('data-rate-symbol="US10Y"')<html.indexOf('data-rate-symbol="US30Y"'));
  assert.match(html,/4\.96<small>%/);assert.match(html,/-0\.17%p/);assert.match(html,/-0\.16%p/);assert.match(html,/-0\.13%p/);
  assert.match(html,/2026\.10\.22 관측/);assert.doesNotMatch(html,/2026\.10\.26 관측|-3\.31%|999%p/);
  assert.match(html,/연준 기준금리와 다른 국채 수익률/);
});
test('Treasuries preserve the last verified observation on stale, missing, malformed and mismatched updates; zero is valid',()=>{
  const f=fixture();f.api.cards([treasury('US10Y',4.96)],false);
  for(const row of [{...treasury('US10Y',9),stale:true}, {...treasury('US10Y',9),price:8}, {...treasury('US10Y',9),chart:[]}, treasury('US10Y',9,8,'20260230')]){
    const html=f.api.cards([row],false);assert.match(html,/4\.96<small>%/);assert.match(html,/2026\.10\.22 관측 · 갱신 지연/);
  }
  assert.match(f.api.cards([],true),/4\.96<small>%/);
  const zero=f.api.cards([treasury('US2Y',0,.1)],false);assert.match(zero,/0\.00<small>%/);assert.match(zero,/-0\.10%p/);
  const one=f.api.cards([{...treasury('US30Y',5.29),chart:[{date:'20261022',close:5.29}]}],false);
  assert.match(one,/5\.29<small>%/);assert.match(one,/변화 미제공/);
});

function fxPayload(overrides={}) {
  return {success:true,data:{official:true,realtime:false,baseDate:'2026-10-26',prevDate:'2026-10-23',state:'ok',pendingToday:false,
    currencies:[{code:'USD',curUnit:'USD',unit:1,dealBasR:1324.3,prev:1324.6,change:999,changeRate:20}],...overrides}};
}
test('official USD/KRW uses one-dollar units, won difference and actual fixing date with 5-minute shared cache',async()=>{
  const f=fixture();f.api.fx(f.fxRoot);f.api.fx(f.fxRoot);await flush();assert.equal(f.calls.length,1);assert.ok(f.calls[0].endsWith('/fx-rates'));
  f.resolve(fxPayload());await flush();assert.match(f.fxMount.innerHTML,/1,324\.30<small>원/);assert.match(f.fxMount.innerHTML,/-0\.30원/);
  assert.match(f.fxMount.innerHTML,/2026\.10\.26 고시/);assert.doesNotMatch(f.fxMount.innerHTML,/999|20%|갱신 지연/);
  f.time(299999);f.api.fx(f.fxRoot);await flush();assert.equal(f.calls.length,1);
  assert.match(f.api.cards([],false),/data-hwr-fx/);
});
test('official FX rejects mixed markets, wrong units and backwards dates while preserving the last fixing',async()=>{
  const f=fixture();f.api.fx(f.fxRoot);await flush();f.resolve(fxPayload());await flush();
  let at=300000;
  for(const overrides of [{realtime:true},{currencies:[{code:'USD',curUnit:'USD',unit:100,dealBasR:9999}]},{baseDate:'2026-10-23'},{baseDate:'2026-02-30'},{currencies:[]}]){
    f.time(at);at+=300000;f.api.fx(f.fxRoot);await flush();f.resolve(fxPayload(overrides));await flush();
    assert.match(f.fxMount.innerHTML,/1,324\.30<small>원/);assert.match(f.fxMount.innerHTML,/2026\.10\.26 고시 · 갱신 지연/);
  }
  f.time(at);f.api.fx(f.fxRoot);await flush();f.resolve({success:false});await flush();assert.match(f.fxMount.innerHTML,/갱신 지연/);
  f.api.fx(f.fxRoot);await flush();f.resolve(fxPayload({pendingToday:true}));await flush();assert.match(f.fxMount.innerHTML,/갱신 지연/);
  f.time(at+300000);f.api.fx(f.fxRoot);await flush();f.resolve(fxPayload({baseDate:'2026-10-27',prevDate:null}));await flush();
  assert.match(f.fxMount.innerHTML,/2026\.10\.27 고시/);assert.match(f.fxMount.innerHTML,/변화 미제공/);assert.doesNotMatch(f.fxMount.innerHTML,/갱신 지연/);
});
