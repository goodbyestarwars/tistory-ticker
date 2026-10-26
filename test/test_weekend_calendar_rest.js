'use strict';
require('./helpers/common_runtime');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/home-weekly-report.js','utf8');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
function home(now,events,fail=false){
  const title={textContent:''},list={outerHTML:''},box={querySelector:s=>s==='.hwr-card-title > span'?title:s==='.hwr-schedule-list'?list:null};
  const calls=[],root={querySelector:s=>s==='[data-hwr-schedule]'?box:null};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}
  const window={StockCalendar:{fetchEvents:async(y,m)=>{calls.push([y,m]);if(fail)throw Error('offline');return events;},describe:e=>({kind:e.market==='us'?'미국':'한국',text:e.title})}};
  vm.runInNewContext(source.replace('global.HomeWeeklyReport = { init: init, syncContent: syncContent };','global.HomeWeeklyReport = {range:scheduleWindow,day:calendarDay,load:loadNextWeekCalendar};'),{window,document:{body:{contains:()=>true}},Date:FixedDate,setTimeout,clearTimeout});
  return {api:window.HomeWeeklyReport,root,title,list,calls};
}
test('KST week is current Monday–Saturday on weekdays; weekends target next week across month/year boundaries',()=>{
  const f=home('2026-10-26T03:00:00Z',[]);
  for(const [now,start,end,title] of [
    ['2026-10-25T15:01:00Z','2026-10-26','2026-10-31','이번 주'],
    ['2026-10-30T14:59:00Z','2026-10-26','2026-10-31','이번 주'],
    ['2026-10-30T15:01:00Z','2026-11-02','2026-11-07','다음 주'],
    ['2026-11-01T14:00:00Z','2026-11-02','2026-11-07','다음 주'],
    ['2026-12-31T02:00:00Z','2026-12-28','2027-01-02','이번 주']]){
    const r=f.api.range(new Date(now));assert.equal(r.startIso,start);assert.equal(r.endIso,end);assert.ok(r.title.startsWith(title));
  }
});
test('calendar renders all confirmed KR/US events, keeps distinct same-symbol events and uses KST boundaries',async()=>{
  const events=Array.from({length:12},(_,i)=>({start:`2026-10-${26+i%5}`,title:`일정${i}`,symbol:'AAPL',market:i%2?'us':'kr'}));
  events.push({start:'2026-10-30T17:00:00-04:00',title:'토요일 KST 실적',market:'us'},
    {start:'2026-10-31T23:00:00-04:00',title:'일요일 제외',market:'us'},events[0]);
  const f=home('2026-10-26T02:00:00Z',events);f.api.load(f.root);await flush();
  assert.equal((f.list.outerHTML.match(/<li /g)||[]).length,13);assert.match(f.title.textContent,/확인된 13건/);
  assert.match(f.list.outerHTML,/10\/31 토/);assert.match(f.list.outerHTML,/한국/);assert.match(f.list.outerHTML,/미국/);
  assert.doesNotMatch(f.list.outerHTML,/일요일 제외|is-extra/);
});
test('cross-month week requests both months; failure keeps fallback explicitly partial',async()=>{
  const f=home('2026-12-29T02:00:00Z',[]);f.api.load(f.root);await flush();
  assert.deepEqual(f.calls,[[2026,11],[2027,0]]);assert.match(f.list.outerHTML,/확인된 일정이 없습니다/);
  const failed=home('2026-10-26T02:00:00Z',[],true);failed.list.outerHTML='previous';failed.api.load(failed.root);await flush();
  assert.equal(failed.list.outerHTML,'previous');assert.match(failed.title.textContent,/일부.*확인 필요/);
});
const shell=fs.readFileSync('js/skin-shell.js','utf8'),anchor=shell.indexOf('  var KST_OFFSET_MS');
const scope={window:{}};vm.runInNewContext(shell.slice(shell.lastIndexOf('(function (global)',anchor),shell.indexOf('})(window);',anchor)+11),scope);
const hours=scope.window.MarketHours;
test('rest banner hides on weekdays and active US holiday/Saturday sessions; next target is earliest extended opening',()=>{
  for(const now of ['2026-10-26T11:00:00+09:00','2026-10-26T23:00:00+09:00','2026-10-24T08:59:59+09:00','2026-11-07T09:59:59+09:00','2026-10-09T23:00:00+09:00','2026-09-07T12:00:00+09:00'])assert.equal(hours.restOverview(new Date(now)).closed,false,now);
  for(const [now,next,market] of [
    ['2026-10-24T09:00:00+09:00','2026-10-25T23:00:00.000Z','국내'],
    ['2026-11-07T10:00:00+09:00','2026-11-08T23:00:00.000Z','국내'],
    ['2026-10-09T12:00:00+09:00','2026-10-09T08:00:00.000Z','미국'],
    ['2026-12-25T12:00:00+09:00','2026-12-27T23:00:00.000Z','국내']]){
    const r=hours.restOverview(new Date(now));assert.equal(r.closed,true,now);assert.equal(r.next.toISOString(),next,now);assert.ok(r.market.startsWith(market));
  }
  assert.equal(hours.restOverview(new Date('2027-01-01T12:00:00+09:00')).closed,false);
});
test('Google month pagination uses common HTTP and preserves every page',async()=>{
  const calls=[],window={NineHttp:{json:async url=>{calls.push(url);return calls.length===1?{items:[{summary:'첫 일정',start:{date:'2026-10-26'}}],nextPageToken:'page 2'}:{items:[{summary:'다음 일정',start:{date:'2026-10-27'}}]};}}};
  vm.runInNewContext(fs.readFileSync('js/stock-calendar.js','utf8').replace('fetchEvents: fetchEvents,','google: fetchGoogleEvents, fetchEvents: fetchEvents,'),{window,document:{addEventListener(){}}});
  const events=await window.StockCalendar.google(2026,9);assert.equal(events.length,2);assert.equal(calls.length,2);assert.ok(calls[1].endsWith('&pageToken=page%202'));
});
