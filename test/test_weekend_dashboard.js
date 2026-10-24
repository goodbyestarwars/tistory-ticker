'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const original = fs.readFileSync('js/home-weekly-report.js', 'utf8');
function fixture() {
  const mounts = new Map(), requests = [], intervals = [];
  const document = {hidden:false, body:{contains:()=>true}, querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){},removeEventListener(){}};
  const window = {MarketHours:{kst:()=>({dateKey:'20261024'}),isKrTradingDay:d=>d.getUTCDay()>0&&d.getUTCDay()<6}};
  let handler = async url => ({lastPrice:'100',priceChangePercent:'1',closeTime:1792800000000});
  const context = vm.createContext({window,document,console,URL,AbortController,localStorage:{getItem:()=>null},
    setTimeout:()=>1,clearTimeout(){},setInterval:f=>{intervals.push(f);return 1;},clearInterval(){},
    fetch:async url=>{requests.push(url);return {ok:true,json:()=>handler(url)};}});
  vm.runInContext(original.replace('global.HomeWeeklyReport = { init: init };', 'global.HomeWeeklyReport = {render:render,live:loadWeekendLive,scanner:loadCompactScanner,themes:loadWeekendThemes};'),context);
  const root={hidden:false,classList:{add(){}},innerHTML:'',querySelector:s=>mounts.get(s)||null};
  return {api:window.HomeWeeklyReport,root,mounts,requests,intervals,handler:f=>handler=f};
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('indices keep server weekly values and fixed order without graphs or repeated assets',()=>{
  const f=fixture();f.api.render(f.root,{data:{week:{end:'2026-10-23'},indices:[{symbol:'SP500_INDEX',name:'S&P500',end:123,changeRate:-2,changeAbs:-3,series:[{date:'2026-10-23'}]}]}});
  const html=f.root.innerHTML;
  assert.equal((html.match(/class="wd-index /g)||[]).length,4);
  assert.ok(html.indexOf('코스피')<html.indexOf('코스닥'));
  assert.ok(html.indexOf('나스닥')<html.indexOf('S&amp;P500'));
  assert.match(html,/▼ -2.00%/);assert.match(html,/-3.00pt/);
  assert.doesNotMatch(html,/<svg|hwr-spark|시장 흐름|지난 신호 성과/);
  assert.ok(html.lastIndexOf('data-wd-stories')>html.indexOf('data-wd-scanner'));
});
test('partial quote failure preserves only last valid prices and timestamps; hidden report does not poll',async()=>{
  const f=fixture(), mount={innerHTML:''};f.mounts.set('[data-hwr-live]',mount);
  f.api.live(f.root,'2026-10-23',true);await flush();
  assert.equal(f.requests.length,3);assert.ok(f.requests.every(u=>u.includes('ticker/24hr')));
  assert.match(mount.innerHTML,/SOL/);assert.match(mount.innerHTML,/USDT/);assert.doesNotMatch(mount.innerHTML,/\$/);
  f.handler(async()=>{throw new Error('offline');});
  f.api.live(f.root,'2026-10-23',true);await flush();
  assert.equal((mount.innerHTML.match(/갱신 지연 · 마지막 가격/g)||[]).length,3);
  assert.match(mount.innerHTML,/100/);f.root.hidden=true;
  const count=f.requests.length;f.intervals[0]();assert.equal(f.requests.length,count);
});
test('scanner deduplicates codes across groups and distinguishes unavailable from empty',async()=>{
  const f=fixture(), mount={innerHTML:''};f.mounts.set('[data-wd-scanner]',mount);
  f.handler(async()=>({data:{scannedAt:'2026-10-24',patterns:{volumeBreakout:[{code:'001',name:'같은 종목',date:'2026-10-23',price:100,financialScreen:{annual:{year:2025,net_income_yoy_pct:7.88}}}],shortTermMaBreakout:[{code:'001',name:'같은 종목',date:'2026-10-23',price:100,financialScreen:{annual:{year:2025,net_income_yoy_pct:7.88}}}]}}}));
  f.api.scanner(f.root);await flush();assert.equal((mount.innerHTML.match(/같은 종목/g)||[]).length,1);assert.match(mount.innerHTML,/신호일/);assert.match(mount.innerHTML,/2025 순익 YoY \+7.88%/);
  const empty=fixture(), box={innerHTML:''};empty.mounts.set('[data-wd-scanner]',box);empty.handler(async()=>({data:{patterns:{}}}));empty.api.scanner(empty.root);await flush();assert.match(box.innerHTML,/현재 확인된 후보 없음/);
  const failed=fixture(), error={innerHTML:''};failed.mounts.set('[data-wd-scanner]',error);failed.handler(async()=>{throw Error('offline');});failed.api.scanner(failed.root);await flush();assert.match(error.innerHTML,/불러오지 못했습니다/);assert.doesNotMatch(error.innerHTML,/현재 확인된 후보 없음/);
});
test('news uses attributed linked headlines only and deduplicates across themes',async()=>{
  const f=fixture(), mount={innerHTML:''};f.mounts.set('[data-hwr-themes]',mount);
  const headline={title:'실제 기사',source:'출처',pubDate:'2026-10-23',link:'https://example.com/article'};
  f.handler(async()=>({data:{themes:[{name:'테마1',headlines:[headline,{title:'근거 없음'}]},{name:'테마2',headlines:[headline]}]}}));
  f.api.themes(f.root);await flush();assert.equal((mount.innerHTML.match(/실제 기사<\/a>/g)||[]).length,1);assert.doesNotMatch(mount.innerHTML,/근거 없음|테마2/);assert.match(mount.innerHTML,/<details/);
});
