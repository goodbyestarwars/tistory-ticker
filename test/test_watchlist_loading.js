'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const test = require('node:test');
const loadCommon = require('./helpers/load_http_client');
const source = fs.readFileSync('js/watchlist.js', 'utf8');
const data = {items:[{code:'005930',name:'Fixture',groupId:'default'}],groups:[{id:'default',name:'기본'}],revision:7};
function fixture() {
  let mounted = false;
  const nodes = new Map(), calls = [], requests = [];
  function node() { return {innerHTML:'',textContent:'',hidden:false,disabled:false,addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}}; }
  for (const key of ['#wlInput','#wlAddBtn','#wlGroupAddBtn','#wlGrid','#wlEmpty','#wlCount','#wlMsg','.wl-auth']) nodes.set(key,node());
  const header=node(); header.querySelector=selector=>nodes.get(selector)||null; nodes.set('.wl-header',header);
  const mount=node(); mount.querySelector=selector=>nodes.get(selector)||null;
  const storage=new Map();
  const window={location:{href:'https://ghlee.tistory.com/page/watchlist'},console,addEventListener(){},dispatchEvent(){}};
  const state={auth:{configured:true,authenticated:true,email:'fixture@example.test'},reply:{data},status:200,pending:false,pendingOnce:false,authPendingOnce:false};
  const document={readyState:'interactive',hidden:false,querySelector:()=>mounted?mount:null,addEventListener(){},querySelectorAll(){return [];}};
  const scope=vm.createContext({window,document,console,Promise,Map,Set,Date,Event,CustomEvent,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout:(fn,ms)=>ms===8000?setTimeout(fn,15):ms===750?setTimeout(fn,1):0,clearTimeout,setInterval:()=>0,clearInterval(){},
    fetch:async (url,options)=>{
      calls.push(url);
      requests.push({url,options});
      if(url.endsWith('/auth/google/me')&&state.authPendingOnce){state.authPendingOnce=false;return new Promise(()=>{});}
      if(url.endsWith('/auth/google/me'))return {ok:true,json:async()=>({data:state.auth})};
      if(url.endsWith('/watchlist')){
        if(state.pending)return new Promise(()=>{});
        if(state.pendingOnce){state.pendingOnce=false;return new Promise(()=>{});}
        return {ok:state.status===200,status:state.status,json:async()=>state.reply};
      }
      return {ok:true,json:async()=>({data:[]})};
    }});
  loadCommon(scope); vm.runInContext(source,scope); mounted=true;
  window.Watchlist.fetchQuotes=async()=>({});
  return {window,state,nodes,calls,requests,scope,mount};
}
test('authenticated saved list renders and private GETs include session cookies',async()=>{
  const f=fixture();await f.window.Watchlist.refresh();
  assert.equal(f.window.Watchlist.getStatus().phase,'ready');
  assert.equal(f.window.Watchlist.isReady(),true);
  assert.equal(f.window.Watchlist.getList()[0].code,'005930');
  assert.match(f.nodes.get('#wlGrid').innerHTML,/005930/);
  for(const request of f.requests.filter(r=>/\/(watchlist|auth\/google\/me)$/.test(r.url))){
    assert.equal(request.options.credentials,'include');
    assert.equal(request.options.cache,'no-store');
  }
});
test('a stalled list is bounded, shown as a load error and can recover without login',async()=>{
  const f=fixture();f.state.pending=true;await f.window.Watchlist.refresh();
  assert.equal(f.window.Watchlist.getStatus().phase,'error');
  assert.match(f.window.Watchlist.getStatus().message,/지연/);
  assert.match(f.nodes.get('#wlGrid').innerHTML,/다시 불러오기/);
  assert.doesNotMatch(f.nodes.get('#wlGrid').innerHTML,/wl-login-btn/);
  f.state.pending=false;await f.window.Watchlist.refresh();
  assert.equal(f.window.Watchlist.getList().length,1);
  assert.equal(f.window.Watchlist.getStatus().phase,'ready');
});
test('failed or malformed refresh preserves an already loaded list',async()=>{
  const f=fixture();await f.window.Watchlist.refresh();
  f.state.status=503;await f.window.Watchlist.refresh();
  assert.equal(f.window.Watchlist.getList().length,1);
  assert.equal(f.window.Watchlist.getStatus().phase,'error');
  f.state.status=200;f.state.reply={data:{}};await f.window.Watchlist.refresh();
  assert.equal(f.window.Watchlist.getList().length,1);
});
test('signed-out and expired sessions clear account data; simultaneous retries share one load',async()=>{
  const f=fixture();const a=f.window.Watchlist.refresh(),b=f.window.Watchlist.refresh();
  assert.equal(a,b);await a;
  assert.equal(f.calls.filter(u=>u.endsWith('/watchlist')).length,1);
  f.state.status=401;await f.window.Watchlist.refresh();
  assert.equal(f.calls.filter(u=>u.endsWith('/watchlist')).length,2,'401 is not automatically retried');
  assert.equal(f.window.Watchlist.getStatus().phase,'signed-out');
  assert.equal(f.window.Watchlist.getList().length,0);
  assert.equal(f.window.Watchlist.isReady(),false);
});
test('MY distinguishes loading/error/signed-out from a successfully loaded empty list',()=>{
  const f=fixture();
  let dashboard=fs.readFileSync('js/my-dashboard.js','utf8');
  dashboard=dashboard.replace('})(window);','window.renderEmptyForTest=function(target){mount=target;buildWatchlistTable([]);};\n})(window);');
  f.scope.document.getElementById=()=>null;
  vm.runInContext(dashboard,f.scope);
  const table={innerHTML:''},count={textContent:''};
  const mount={querySelector:s=>s==='[data-my-watchlist-table]'?table:s==='[data-my-watchlist-count]'?count:null};
  for(const phase of ['loading','error','signed-out','ready']){
    f.window.Watchlist.getStatus=()=>({phase,message:'목록 조회 실패'});
    f.window.renderEmptyForTest(mount);
    if(phase==='ready'){assert.match(table.innerHTML,/관심종목이 없습니다/);assert.equal(count.textContent,'0종목');}
    else {assert.doesNotMatch(table.innerHTML,/관심종목이 없습니다/);assert.notEqual(count.textContent,'0종목');}
    if(phase==='signed-out')assert.match(table.innerHTML,/data-my-login/);
    if(phase==='error')assert.match(table.innerHTML,/data-my-watchlist-retry/);
  }
});

test('one timed out private list or auth read recovers automatically',async()=>{
  for(const key of ['pendingOnce','authPendingOnce']) {
    const f=fixture();f.state[key]=true;await f.window.Watchlist.refresh();
    assert.equal(f.window.Watchlist.getStatus().phase,'ready');
    assert.equal(f.window.Watchlist.getList()[0].code,'005930');
    assert.equal(f.calls.filter(u=>u.endsWith(key==='pendingOnce'?'/watchlist':'/auth/google/me')).length,2);
  }
});
test('permanent timeout has two attempts only, no duplicated error and no save',async()=>{
  const f=fixture();f.state.pending=true;await f.window.Watchlist.refresh();
  assert.equal(f.calls.filter(u=>u.endsWith('/watchlist')).length,2);
  assert.equal(f.window.Watchlist.getStatus().phase,'error');
  assert.equal(f.nodes.get('#wlMsg').hidden,true);
  assert.match(f.nodes.get('#wlGrid').innerHTML,/ui-btn ui-btn-secondary/);
  assert(f.requests.every(r=>!r.options.method||r.options.method==='GET'));
});
