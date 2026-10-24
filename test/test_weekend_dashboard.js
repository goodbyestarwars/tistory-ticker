'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const original = fs.readFileSync('js/home-weekly-report.js', 'utf8');
function fixture() {
  const mounts = new Map(), requests = [], intervals = [];
  const document = {hidden:false, body:{contains:()=>true}, querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){},removeEventListener(){}};
  const window = {MarketHours:{kst:()=>({dateKey:'20261024'}),isKrTradingDay:d=>d.getUTCDay()>0&&d.getUTCDay()<6},CryptoMarket:{coins:[['BTC','비트코인'],['ETH','이더리움'],['USDT','테더']],fetchCoinQuotes:()=>{requests.push('shared-coins');return handler('shared-coins');}}};
  let handler = async url => [{symbol:'BTC',price:100,change_rate:1,updated_at:'2026-10-24T12:00:00+09:00'}];
  const context = vm.createContext({window,document,console,URL,AbortController,localStorage:{getItem:()=>null},
    setTimeout:()=>1,clearTimeout(){},setInterval:f=>{intervals.push(f);return 1;},clearInterval(){},
    fetch:async url=>{requests.push(url);return {ok:true,json:()=>handler(url)};}});
  vm.runInContext(original.replace('global.HomeWeeklyReport = { init: init, syncContent: syncContent };', 'global.HomeWeeklyReport = {render:render,live:loadWeekendLive,scanner:loadCompactScanner,themes:loadWeekendThemes,weekly:storedWeeklyIndex,card:indexCard};'),context);
  const root={hidden:false,classList:{add(){}},innerHTML:'',querySelector:s=>mounts.get(s)||null};
  return {api:window.HomeWeeklyReport,root,mounts,requests,intervals,handler:f=>handler=f};
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('six indices keep weekly values, common SVG directions and only real series graphs',()=>{
  const f=fixture();f.api.render(f.root,{data:{week:{end:'2026-10-23'},indices:[{symbol:'SP500_INDEX',name:'S&P500',end:123,changeRate:-2,changeAbs:-3,series:[{date:'2026-10-22',close:126},{date:'2026-10-23',close:123}]}]}});
  const html=f.root.innerHTML;
  assert.equal((html.match(/class="wd-index /g)||[]).length,6);
  assert.ok(html.indexOf('KOSPI')<html.indexOf('KOSDAQ'));
  assert.ok(html.indexOf('나스닥')<html.indexOf('S&amp;P500'));
  assert.match(html,/-2.00%/);assert.match(html,/-3.00pt/);
  assert.equal((html.match(/class="wd-direction"/g)||[]).length,6);
  assert.equal((html.match(/<polygon/g)||[]).length,1);
  assert.doesNotMatch(html,/시장 흐름|지난 신호 성과/);
  assert.ok(html.lastIndexOf('data-wd-stories')>html.indexOf('data-wd-scanner'));
});
test('partial quote failure preserves only last valid prices and timestamps; hidden report does not poll',async()=>{
  const f=fixture(), mount={innerHTML:''};f.mounts.set('[data-hwr-live]',mount);
  f.api.live(f.root,'2026-10-23',true);await flush();
  assert.deepEqual(f.requests,['shared-coins']);
  assert.match(mount.innerHTML,/USDT/);assert.match(mount.innerHTML,/100원/);assert.doesNotMatch(mount.innerHTML,/Binance|\$/);
  assert.equal((mount.innerHTML.match(/<svg/g)||[]).length,3);
  f.handler(async()=>{throw new Error('offline');});
  f.api.live(f.root,'2026-10-23',true);await flush();
  assert.equal((mount.innerHTML.match(/갱신 지연 · 마지막 가격/g)||[]).length,1);
  assert.match(mount.innerHTML,/100/);f.root.hidden=true;
  const count=f.requests.length;f.intervals[0]();assert.equal(f.requests.length,count);
});
test('candidate panel reuses original server swing results without a new scanner request',async()=>{
  const f=fixture(), mount={innerHTML:''};f.mounts.set('[data-wd-scanner]',mount);
  f.api.scanner(f.root,{hotCandidates:{domestic:[{code:'001',name:'원래 후보',price:100,changeRate:2,waves:{mid:'상승 추세'}}],basis:'원래 선정 기준'}});
  assert.match(mount.innerHTML,/원래 후보/);assert.match(mount.innerHTML,/원래 선정 기준/);assert.match(mount.innerHTML,/stock-search\?code=001/);assert.equal(f.requests.length,0);
  f.api.scanner(f.root,{hotCandidates:{domestic:[]}});assert.match(mount.innerHTML,/현재 조건 충족 후보 없음/);
});
test('news uses attributed linked headlines only and deduplicates across themes',async()=>{
  const f=fixture(), mount={innerHTML:''};f.mounts.set('[data-hwr-themes]',mount);
  const headline={title:'실제 기사',source:'출처',pubDate:'2026-10-23',link:'https://example.com/article'};
  f.handler(async()=>({data:{themes:[{name:'테마1',krSectors:['반도체'],krStocks:[{code:'005930',name:'삼성전자'}],headlines:[headline,{title:'근거 없음'}]},{name:'테마2',headlines:[headline]}]}}));
  f.api.themes(f.root);await flush();assert.equal((mount.innerHTML.match(/실제 기사<\/a>/g)||[]).length,1);assert.doesNotMatch(mount.innerHTML,/근거 없음|테마2/);assert.match(mount.innerHTML,/class="wd-sector">반도체/);assert.match(mount.innerHTML,/삼성전자/);assert.doesNotMatch(mount.innerHTML,/>AI</);
});
test('additional stored indices normalize dates, exclude future days and match the original weekly base',()=>{
  const f=fixture(),row={symbol:'DOW_INDEX',name:'다우',chart:[{date:'20261023',close:120},{date:'20261016',close:100},{date:'20261019',close:110},{date:'20261024',close:900}]};
  const out=f.api.weekly(row,{start:'2026-10-19',end:'2026-10-23'});
  assert.equal(out.base,100);assert.equal(out.end,120);assert.ok(Math.abs(out.changeRate-20)<1e-8);assert.equal(out.series.length,2);assert.equal(out.series[1].date,'2026-10-23');
  assert.doesNotMatch(f.api.card(f.api.weekly({symbol:'SOX',name:'SOX',chart:[]},{start:'2026-10-19',end:'2026-10-23'})),/<polygon/);
});
