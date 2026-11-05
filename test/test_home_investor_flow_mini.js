'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const home=fs.readFileSync('js/skin-main.js','utf8'), shared=fs.readFileSync('js/investor-flow.js','utf8');
const window={};new Function('window',shared)(window);const flow=window.InvestorFlow;
const row=(slot,extra={})=>({slot,frgn:-100*(slot+1),orgn:50*(slot+1),ind:50*(slot+1),asOf:`2026-11-05T${String(9+Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'59':'29'}:00+09:00`,...extra});
const date='2026-11-05', rows=[row(0),row(1),row(3),row(4,{ind:null})];
const svg=flow.miniChart(rows,{period:'intraday',date,market:'KOSPI'});
assert(svg.includes('viewBox="0 0 240 70"'));
assert(svg.includes('외국인 누적 -200억'));assert(!svg.includes('외국인 누적 -300억'),'already cumulative; never summed again');
assert.equal((svg.match(/<polyline /g)||[]).length,5,'3 series across 0/1 and 2 series across 3/4');
assert.equal((svg.match(/<circle /g)||[]).length,11,'isolated individual slot remains visible');
assert(svg.includes('개인 누적 미관측'));assert(svg.includes('實際')===false);
assert(svg.includes('실제 관측 2026-11-05T09:29'));
assert(!svg.includes('stroke-dasharray'));assert(!svg.includes('NaN'));
assert(svg.includes('09:00')&&svg.includes('15:30'));
assert.equal(flow.intradayRows([row(0),row(0,{asOf:'2026-11-05T09:28:00+09:00'}),row(2,{asOf:'2026-11-04T10:29:00+09:00'}),row(14),row(3,{asOf:null})],date).length,1);
assert.equal(flow.intradayRows([row(13,{asOf:'2026-11-05T15:30:44+09:00'})],date).length,1);
assert(flow.miniChart([],{period:'intraday',date}).includes('관측값 없음'));
const daily=Array.from({length:21},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,foreign:-100,institution:50,individual:50,indexClose:2500+i}));
assert.equal(flow._calc.cumulative(daily,20).series.foreign.at(-1),-2000);
assert(flow.miniChart(daily,{days:20}).includes('stroke-dasharray'),'original daily index chart preserved');

const body={innerHTML:''},host={hidden:false,querySelector:()=>body,addEventListener(){}};
let clock=Date.parse('2026-11-06T01:00:00+09:00'), cache=null,fail=false, empty=false,calls=[];
class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const sample=market=>({success:true,updatedAt:'2099-01-01',data:{period:'intraday',market,date,rows:rows.slice().reverse()}});
const context={window,Date:Clock,console,dashboardSection:{querySelector:()=>host},homeMarketSession:()=>({market:'domestic',closed:false}),
 escapeHomeHtml:x=>String(x).replace(/</g,'&lt;'),loadHomeScript:()=>Promise.resolve(),HOME_INVESTOR_FLOW_SCRIPT_URL:'shared',
 readHomeDataCache:()=>cache,writeHomeDataCache:(key,value)=>{assert.equal(key,'home-investor-mini-intraday-v2');cache=value;},
 fetchHomeJson:url=>{calls.push(url);const market=url.split('=').at(-1);return fail&&market==='kospi'?Promise.reject(Error('offline')):Promise.resolve(empty?{success:true,data:{period:'intraday',market,date:'2026-11-06',rows:[]}}:sample(market));}};
vm.createContext(context);
const start=home.indexOf('    function investorAmountText'),end=home.indexOf('    loadSummaryForSession(homeMarketSession());',start);
vm.runInContext(home.slice(start,end),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 context.loadHomeInvestorTrend();context.loadHomeInvestorTrend();await flush();
 assert.equal(calls.length,2,'overlapping requests deduplicated');assert(calls.every(u=>u.includes('period=intraday')));
 assert(body.innerHTML.includes('2026-11-05 · 관측 11:29 KST'),'actual latest slot timestamp, not envelope updatedAt');
 assert(body.innerHTML.includes('마지막 저장 관측값'));assert(!body.innerHTML.includes('20거래일'));
 assert.equal((body.innerHTML.match(/viewBox="0 0 240 70"/g)||[]).length,2);
 clock+=301000;fail=true;context.loadHomeInvestorTrend();await flush();
 assert(body.innerHTML.includes('조회 지연 · 저장값'));assert.equal(calls.length,4);
 clock=Date.parse('2026-11-06T10:00:00+09:00');empty=true;context.loadHomeInvestorTrend();await flush();
 assert(body.innerHTML.includes('2026-11-05'),'empty new trading day retains explicitly dated last observations');
 assert(body.innerHTML.includes('조회 지연 · 저장값'));
 vm.runInContext('renderHomeInvestorMiniHistory([{data:{rows:[]}},{data:{rows:[]}}],false)',context);
 assert(body.innerHTML.includes('관측값 없음'));assert(!body.innerHTML.includes('0억'));
 assert(!home.includes('investor-trend/history?market=kospi&days=21'));
 assert(!home.includes('home-investor-mini-history-v1'));
 console.log('PASS daily preservation; intraday values/colors/gaps/singletons/date/slot validation; home cache/partial failure/rollover/empty/concurrency');
})().catch(e=>{console.error(e);process.exitCode=1;});
