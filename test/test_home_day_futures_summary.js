'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('js/skin-main.js','utf8');
const css=fs.readFileSync('css/home-market-board.css','utf8');
const enh=fs.readFileSync('js/dashboard-enhancements.js','utf8');
const ec=fs.readFileSync('css/dashboard-enhancements.css','utf8');
assert(src.includes('data-home-day-futures aria-label="코스피200 주간선물 시세"'));
assert(src.includes("USDKRW%2CKOSPI200_DAY&days=30&stored_only=true"));
assert(src.includes("if (session.market === 'domestic') loadHomeDayFutures()"));
assert(src.includes("homeDayFutureLoading || Date.now() - homeDayFutureRequestedAt < 50000"));
assert(src.includes("homeFresh(item, 5)"));
assert(src.includes("'시세 지연'") && src.includes("'장 마감'") && src.includes("'미수신'"));
assert(css.includes('repeat(2, minmax(0, 1fr))'));
assert(css.includes('.hmb-investor-spark-wrap { height: 70px;'));
assert(enh.includes("expandSegment.className = 'nine-chart-expand-segment'"));
assert(enh.includes("actionStack.insertBefore(expandSegment, actionStack.querySelector('.nine-chart-capture-actions'))"));
assert(ec.includes('.nine-chart-expand-segment {'));
assert(ec.includes('.nine-chart-expand-segment .de-expand-button.de-expand-inline'));
assert(ec.includes('.nine-chart-capture-actions > button'));

// 실제 주간선물 상태와 등락값. 임의 현재가·오래된 시세를 정상 거래로 표시하지 않는다.
const start=src.indexOf('    function renderHomeDayFutures(item, failed) {');
const end=src.indexOf('    function loadHomeDayFutures() {',start);
assert(start>=0&&end>start,'day future renderer found');
const state={market:'regular',holiday:false,fresh:true};
const displayed={},mockCard={};
const render=new Function('dashboardSection','window','homeNum','homeKstTime','homeFresh','homeFill','homeFmt','homeTone',
  src.slice(start,end)+'\nreturn renderHomeDayFutures;')(
  {querySelector(){return mockCard}},
  {MarketHours:{krFutures(){return {phase:state.market}},isKrHoliday(){return state.holiday}}},
  value=>value==null||value===''||!isFinite(Number(value))?null:Number(value),
  value=>value?'11.05 14:30 KST':null,
  item=>state.fresh,
  (root,attr,key,value)=>{displayed[key]=value},
  (v,d)=>Number(v).toLocaleString('ko-KR',{minimumFractionDigits:d||0,maximumFractionDigits:d==null?2:d}),
  value=>value>0?'home-positive':value<0?'home-negative':'home-neutral'
);
render({price:400.5,change:2.5,change_rate:0.63,updated_at:'2026-11-05T05:30:00Z'});
assert.equal(displayed.price,'400.50');
assert.equal(displayed.change,'▲+0.63%');
assert(displayed.time.includes('거래중')&&displayed.time.includes('KST'));
state.fresh=false;
render({price:400.5,change:-1.2,change_rate:-0.30,updated_at:'2026-11-05T05:30:00Z'});
assert.equal(displayed.change,'▼-0.30%');
assert(displayed.time.includes('시세 지연'));
state.market='closed';
render({price:400.5,change:-1.2,change_rate:-0.30,updated_at:'2026-11-05T05:30:00Z'});
assert(displayed.time.includes('장 마감'));
state.holiday=true;
render({price:400.5,change:0,change_rate:0,updated_at:'2026-11-05T05:30:00Z'});
assert(displayed.time.includes('휴장'));
state.holiday=false;
render(null,false);
assert.equal(displayed.price,'-');
assert(displayed.time.includes('미수신'));
render(null,true);
assert(displayed.time.includes('수신 지연'));

console.log('KOSPI200 day futures / responsive compact metrics / independent chart segment: passed');
