'use strict';
require('./helpers/common_runtime');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  let now = 0, respond, calls = [];
  const mount = {innerHTML:''};
  const window = {}, document = {body:{contains:()=>true}};
  const source = fs.readFileSync('js/home-weekly-report.js','utf8').replace(
    'global.HomeWeeklyReport = { init: init, syncContent: syncContent };',
    'global.HomeWeeklyReport = {cards:commodityCards,load:loadWeekendCommodities};');
  const context = {window,document,URL,AbortController,setTimeout,clearTimeout,
    Date:class extends Date {static now(){return now;}},
    fetch:url=>{calls.push(url);return new Promise(resolve=>{respond=data=>resolve({ok:true,json:async()=>data});});}};
  vm.runInNewContext(source,context);
  return {api:window.HomeWeeklyReport,mount,calls,root:{querySelector:()=>mount},
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
  assert.match(f.calls[0],/symbols=WTI,BRENT,GOLD&stored_only=true$/);
  f.resolve({data:[quote('BRENT',117.38)]});await flush();assert.match(f.mount.innerHTML,/\$117\.38/);
  f.time(59999);f.api.load(f.root);await flush();assert.equal(f.calls.length,1);
  f.time(60000);f.api.load(f.root);await flush();assert.equal(f.calls.length,2);
  f.resolve({error:'missing'});await flush();assert.match(f.mount.innerHTML,/갱신 지연/);
  f.api.load(f.root);await flush();assert.equal(f.calls.length,3);
  f.resolve({data:[quote('BRENT',118)]});await flush();assert.match(f.mount.innerHTML,/\$118\.00/);
});
