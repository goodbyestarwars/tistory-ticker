'use strict';
require('./helpers/common_runtime');

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/stock-search.js','utf8');
function fixture(){
  let now=100000,requests=[];
  const code=source.slice(source.indexOf('  function loadIndexVolume('),source.indexOf('  function renderIndexChart('));
  const context=vm.createContext({Promise,Date:{now:()=>now},isFinite,Object,Number,String,
    fetchJson:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))});
  vm.runInContext(code+';globalThis.api={ensureIndexVolume,applyIndexVolume,indexVolumeState};',context);
  return {api:context.api,requests,advance(ms){now+=ms;}};
}
const payload=(date,value,meta={})=>({data:{source:'kis',rows:[{date,volume:value}],cache:meta}});
test('KOSPI and KOSDAQ share only their own pending requests; switching back uses cache',async()=>{
  const f=fixture(),seen=[];
  const a=f.api.ensureIndexVolume('KOSPI',m=>seen.push(['A',m]));
  const a2=f.api.ensureIndexVolume('KOSPI',m=>seen.push(['A2',m]));
  const b=f.api.ensureIndexVolume('KOSDAQ',m=>seen.push(['B',m]));
  assert.equal(f.requests.length,2);
  f.requests[1].resolve(payload('2026-10-23',20));await b;
  f.requests[0].resolve(payload('2026-10-23',10));await Promise.all([a,a2]);
  assert.equal(f.api.indexVolumeState.KOSPI.map['2026-10-23'],10);
  assert.equal(f.api.indexVolumeState.KOSDAQ.map['2026-10-23'],20);
  let reused;await f.api.ensureIndexVolume('KOSPI',m=>reused=m['2026-10-23']);
  assert.equal(reused,10);assert.equal(f.requests.length,2);
  assert.equal(seen.find(r=>r[0]==='B')[1]['2026-10-23'],20);
});
test('failure retains cache and respects a one-minute retry interval',async()=>{
  const f=fixture();let p=f.api.ensureIndexVolume('KOSPI',()=>{});f.requests[0].resolve(payload('2026-10-23',10));await p;
  f.advance(60001);p=f.api.ensureIndexVolume('KOSPI',()=>{});f.requests[1].reject(Error('offline'));await p;
  assert.equal(f.api.indexVolumeState.KOSPI.map['2026-10-23'],10);
  assert.equal(f.api.indexVolumeState.KOSPI.meta.usingLastValid,true);
  await f.api.ensureIndexVolume('KOSPI',()=>{});assert.equal(f.requests.length,2);
  f.advance(60001);p=f.api.ensureIndexVolume('KOSPI',()=>{});f.requests[2].resolve(payload('2026-10-23',15));await p;
  assert.equal(f.api.indexVolumeState.KOSPI.map['2026-10-23'],15);
});
test('pending backfill polls after server retry hint; unsupported US indices make no volume request',async()=>{
  const f=fixture();let p=f.api.ensureIndexVolume('KOSPI',()=>{});f.requests[0].resolve({data:{source:'kis',rows:[],cache:{refreshing:true,retryAfterMs:2000}}});await p;
  f.advance(2001);p=f.api.ensureIndexVolume('KOSPI',()=>{});f.requests[1].resolve(payload('2026-10-23',0));await p;
  const rows=[{date:'2026-10-23',volume:99},{date:'2026-10-22',volume:1}];
  f.api.applyIndexVolume(rows,f.api.indexVolumeState.KOSPI.map);
  assert.equal(rows[0].volume,0);assert.equal(rows[1].volume,1);
  assert.equal(f.api.ensureIndexVolume('NASDAQ_INDEX',()=>{}),undefined);assert.equal(f.requests.length,2);
});
test('callbacks guard full opening generation, including A to B to A; volume response never recreates chart',()=>{
  const open=source.slice(source.indexOf('  function openIndex('),source.indexOf('  function runDomesticSearch('));
  const volume=open.slice(open.indexOf('    function refreshVolume()'),open.indexOf('    function refresh()'));
  assert.match(volume,/indexOpenId !== stockSearchRequestId/);assert.match(volume,/indexVolumeUpdate\(\)/);
  assert.doesNotMatch(volume,/renderIndexChart\(/);
});
