'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const original=fs.readFileSync('js/investor-flow.js','utf8');
const home=fs.readFileSync('js/skin-main.js','utf8');
const css=fs.readFileSync('css/home-market-board.css','utf8');
const skin=fs.readFileSync('skin.html','utf8');
const hostWindow={};
new Function('window', original+';return window.InvestorFlow;')(hostWindow);
const InvestorFlow=hostWindow.InvestorFlow;
assert(InvestorFlow&&typeof InvestorFlow.miniChart==='function');
const rows=[];
let utc=Date.UTC(2026,9,6);
while(rows.length<21){
 const d=new Date(utc);
 if(d.getUTCDay()!==0&&d.getUTCDay()!==6){
   rows.push({date:d.toISOString().slice(0,10),
     foreign:-100, institution:50,individual:50,indexClose:2500+rows.length*3});
 }
 utc+=86400000;
}
const ref=InvestorFlow._calc.cumulative(rows,20);
assert.equal(ref.days,20);
assert.equal(ref.series.foreign[0],0);
assert.equal(ref.series.foreign.at(-1),-2000);
assert.equal(ref.series.institution.at(-1),1000);
assert.equal(ref.series.individual.at(-1),1000);
const svg=InvestorFlow.miniChart(rows,{days:20,market:'KOSPI',showIndex:true});
assert(svg.includes('viewBox="0 0 240 70"'));
assert(svg.includes('hmb-investor-mini-cumulative'));
assert(svg.includes('data-hover-points='));
assert(svg.includes('외국인 누적 -2,000억'));
assert(svg.includes('기관 누적 +1,000억'));
assert(svg.includes('개인 누적 +1,000억'));
assert(svg.includes('stroke-dasharray="3 3"'));
assert(svg.includes('지수(별도 축)'));
assert.equal((svg.match(/<polyline /g)||[]).length,4);
assert.equal((svg.match(/<circle /g)||[]).length,3);
assert(!svg.includes('NaN')&&!svg.includes('undefined'));
assert(!svg.includes('data-investor-mode-select'));
assert(InvestorFlow.miniChart([],{}).includes('자료 없음'));
const limited=InvestorFlow.miniChart(rows.map(r=>Object.assign({},r,{indexClose:null})),{market:'KOSDAQ'});
assert(!limited.includes('stroke-dasharray="3 3"')); // index is genuinely absent, no fake index
const sparse=InvestorFlow.miniChart(rows.map((r,i)=>i===10?Object.assign({},r,{individual:null}):r),{market:'KOSPI'});
assert(!sparse.includes('NaN'));

const frag=home.slice(home.indexOf('    function showHomeInvestorMiniMode('),
                      home.indexOf('    function renderHomeInvestorTrend('));
assert(frag.includes('renderHomeInvestorMiniHistory'));
const legend={hidden:false},fallback={hidden:true},body={innerHTML:''};
const wrapper={
 querySelector(selector){
  return selector==='[data-home-investor-mini-legend]'?legend:
   selector==='[data-home-investor-mini-fallback]'?fallback:
   selector==='.hmb-investor-trend-body'?body:null;
 }};
const render=new Function('dashboardSection','window','escapeHomeHtml',
  frag+';return {renderHomeInvestorMiniHistory,showHomeInvestorMiniMode};')(
    {querySelector:()=>wrapper},{InvestorFlow},x=>String(x).replace(/</g,'&lt;'));
const make=(rows,market)=>({success:true,data:{market,latestDate:rows.at(-1).date,rows,provisional:true}});
render.renderHomeInvestorMiniHistory([make(rows,'KOSPI'),make(rows,'KOSDAQ')],false);
assert(body.innerHTML.includes('KOSPI')&&body.innerHTML.includes('KOSDAQ'));
assert.equal((body.innerHTML.match(/hmb-investor-mini-cumulative/g)||[]).length,2);
assert(body.innerHTML.includes('잠정'));
render.renderHomeInvestorMiniHistory([make(rows,'KOSPI'),make(rows,'KOSDAQ')],true);
assert(body.innerHTML.includes('갱신 지연'));
render.showHomeInvestorMiniMode(true);
assert(legend.hidden&& !fallback.hidden);
render.showHomeInvestorMiniMode(false);
assert(!legend.hidden&&fallback.hidden);

assert(home.includes('loadHomeScript(HOME_INVESTOR_FLOW_SCRIPT_URL'));
assert(home.includes('homeInvestorMiniInterval = 5 * 60 * 1000'));
assert(home.includes('readHomeDataCache('));
assert(home.includes("writeHomeDataCache('home-investor-mini-history-v1'"));
assert(home.includes('loadHomeInvestorIntradayFallback'));
assert(home.includes('investor-trend?period=intraday&market=kospi'));
assert(home.includes('investor-trend/history?market=kospi&days=21'));
assert(!home.includes('data-investor-actor="foreign"'));
assert(!home.includes("homeModeSegment('data-investor-mode-select', 'area'"));
assert(css.includes('.hmb-investor-mini-row .hmb-investor-spark-wrap'));
assert(css.includes('height: 70px; margin-top: 3px'));
assert(skin.includes('skin-main.js?v=20261025-countdown-module6'));
console.log('PASS InvestorFlow common 20-day cumulative / three series / index separate scale / fallback / 70px / KOSPI+KOSDAQ');
