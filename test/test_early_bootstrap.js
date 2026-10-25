'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const loadCommon=require('./helpers/load_http_client');
function fixture(){
 const events={},calls=[];let queries=0;
 const location={pathname:'/fixture'},window={location,console};
 const document={readyState:'interactive',
  querySelector(selector){queries++;return selector==='.global-watchlist-drawer'?{}:null;},
  getElementById(){queries++;return null;},
  addEventListener(name,callback){(events[name]||=[]).push(callback);}};
 const scope=vm.createContext({window,document,location,console,Promise,
  setTimeout(){return 1;},clearTimeout(){},
  fetch:async url=>{calls.push(url);return {ok:true,json:async()=>({data:[{code:'005930',price:100}]})};}});
 return {scope,window,document,events,calls,get queries(){return queries;}};
}
(async()=>{
 for(const name of ['stock-search-panel','watchlist']){
  const src=fs.readFileSync('js/'+name+'.js','utf8'),test=fixture();
  vm.runInContext(src,test.scope);
  assert.equal(test.window.NineAPI,undefined,'early script must not assume the later defer runtime already exists');
  assert.equal(test.queries,0,'early init waits for the common runtime');
  assert.equal(test.events.DOMContentLoaded.length,1);
  loadCommon(test.scope);
  test.events.DOMContentLoaded.forEach(callback=>callback());
  assert(test.queries>0,'initialization resumes after all defer scripts load');
  if(name==='watchlist'){
   const quotes=await test.window.Watchlist.fetchQuotes(['005930']);
   assert.equal(quotes['005930'].price,100);
   assert.match(test.calls[0],/\/domestic-quotes\?codes=005930$/);
  }
  const dynamic=fixture();loadCommon(dynamic.scope);vm.runInContext(src,dynamic.scope);
  assert(dynamic.queries>0,'dynamic load after runtime initializes without waiting for another DOMContentLoaded');
  assert.equal(dynamic.events.DOMContentLoaded,undefined);
 }
 console.log('PASS early defer order, dynamic load and shared watchlist quote route');
})().catch(error=>{console.error(error);process.exitCode=1;});
