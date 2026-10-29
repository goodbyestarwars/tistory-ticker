'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const home=fs.readFileSync('js/skin-main.js','utf8'),quick=fs.readFileSync('js/quick-indices.js','utf8');
function fn(source,name,indent){const a=source.indexOf(indent+'function '+name+'(');assert(a>=0);return source.slice(a,source.indexOf('\n'+indent+'}',a)+indent.length+2);}
(async()=>{
 let mode='domestic',calls=0,complete;
 const ctx={homeMarketSession:()=>({market:mode}),document:{hidden:false},homeSessionLoading:false,
 homeSessionCharts:{},latestHomeIndices:[],renderHomeIndices(){},fetchHomeJson(){calls++;return new Promise(r=>complete=r);}};
 vm.createContext(ctx);vm.runInContext(fn(home,'loadHomeSessionCharts','    '),ctx);
 ctx.loadHomeSessionCharts();assert.equal(calls,0,'domestic does not request hidden US/night chart');
 mode='closed';ctx.loadHomeSessionCharts();assert.equal(calls,0);
 mode='us';ctx.document.hidden=true;ctx.loadHomeSessionCharts();assert.equal(calls,0);
 ctx.document.hidden=false;ctx.loadHomeSessionCharts();ctx.loadHomeSessionCharts();assert.equal(calls,1,'US chart remains available and concurrent calls share existing loading guard');
 complete({data:[{symbol:'NASDAQ_INDEX',rows:[{close:100}],reference:99}]});await new Promise(r=>setImmediate(r));
 assert.equal(ctx.homeSessionCharts.NASDAQ_INDEX.reference,99);assert.equal(ctx.homeSessionLoading,false);
 const changes=home.slice(home.indexOf('    loadSummaryForSession(homeMarketSession());'));
 assert.match(changes,/home-market-change[\s\S]*?loadHomeIndices\(\);\s*loadHomeSessionCharts\(\);/,'switch to US immediately loads the required charts');
 let url,stored,cache=null,reject=false;
 const payload=[{symbol:'USDKRW',price:1336.2,updated_at:'2026-10-29T02:22:00Z',stale:true,source_delay:30}];
 const q={FUTURES_API:'https://example.test/futures',FUTURES_SYMBOLS:'KOSPI,USDKRW',encodeURIComponent,
 readFuturesCache:()=>cache,writeFuturesCache:data=>stored=data,fetchJson:u=>{url=u;return reject?Promise.reject(new Error('offline')):Promise.resolve({data:payload});}};
 vm.createContext(q);vm.runInContext(fn(quick,'fetchFutures','  '),q);
 assert.equal(await q.fetchFutures(),payload);assert.match(url,/stored_only=true$/);assert.match(url,/symbols=KOSPI%2CUSDKRW/);
 assert.equal(stored,payload);assert.equal(stored[0].stale,true,'stored metadata must not become a fabricated live quote');
 cache=payload;reject=true;assert.equal(await q.fetchFutures(),payload,'bounded existing cache survives failed background refresh');
 cache=null;await assert.rejects(q.fetchFutures(),/offline/);
 console.log('PASS hidden-market chart request elimination; US switch/loading preserved; stored-only common quotes; cache/failure/staleness metadata preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
