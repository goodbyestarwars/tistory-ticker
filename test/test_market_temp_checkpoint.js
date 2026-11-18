
require('./helpers/common_runtime');
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.checkTest={checkpointFacts_,buildStrategy};');
let requests=0,fail=false;
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>{requests++;if(fail)throw Error('offline');return {ok:true,json:async()=>({data:{temp:12}})};}};
require('./helpers/load_http_client')(sb);
vm.runInNewContext(src,sb);const t=sb.window.checkTest;
const base={updatedAt:'2026-10-23T04:00:00+09:00',marketBreadth:{total:{up:10,down:90,total:100}},score100:99};
// 2026-11 계약: 수급은 세 주체 합산이 아니라 코스피·코스닥 시장별(domestic.investor)로 나눠 보여준다.
const investor=(kospiF,kosdaqF)=>({investor:{
  KOSPI:{asOf:'2026-10-22',rows:[{date:'2026-10-21',foreign:1,institution:1,individual:-2},{date:'2026-10-22',foreign:kospiF,institution:-20,individual:30}]},
  KOSDAQ:{asOf:'2026-10-22',rows:[{date:'2026-10-22',foreign:kosdaqF,institution:3,individual:-8}]}}});
const volume={id:'kospi-volume',label:'코스피 거래량',value:75,valueText:'75.0%',date:'2026-10-22',statusText:'낮음',intraday:false};
const fx={id:'fx',value:1327,valueText:'1,327.0원',delta:-.5,changeText:'-0.50원',date:'2026-10-22'};
let facts=t.checkpointFacts_(base,[volume,fx]);
assert(facts.title.includes('하락이 넓게'));assert.equal(facts.items.length,2);assert(facts.mood.includes('90%'));
assert(facts.items[0].evidence.includes('코스피 거래량 낮음'));assert(facts.items[1].evidence.includes('원화 강세'));
assert.equal(facts.title,t.checkpointFacts_({...base,score100:0},[volume,fx]).title,'copy must depend on facts rather than hidden score');
const up={...base,marketBreadth:{total:{up:90,down:10,total:100}}};
assert(t.checkpointFacts_(up,[]).title.includes('오르는 종목이 많습니다'));
const split=t.checkpointFacts_(base,[volume,fx],null,investor(-10,5));
assert(split.title.includes('엇갈립니다'));assert.equal(split.items.length,3);
assert.equal(split.items[0].marketFlows.length,2);assert.equal(split.items[0].marketFlows[0].date,'2026-10-22');
assert.equal(JSON.stringify(split.items[0].marketFlows[0].actors.map(a=>a.value)),'[-10,-20,30]','latest KOSPI row, no cross-market sum');
assert(split.avoid.some(s=>s.includes('합산')));
assert(t.checkpointFacts_(base,[],null,investor(-10,-5)).title.includes('나눠 살펴보세요'));
const blank={investor:{KOSPI:{rows:[{date:'2026-10-22'}]},KOSDAQ:{rows:[]}}};
assert(!t.checkpointFacts_(base,[],null,blank).items.some(i=>i.marketFlows),'missing values never become a flow item');
assert(t.checkpointFacts_({},[]).mood.includes('확인'));assert.equal(t.checkpointFacts_({},[]).items.length,1);
const intraday=t.checkpointFacts_(base,[{...volume,intraday:true}]);assert(intraday.items[0].check.includes('장중 누적치'));
const html=t.buildStrategy(base,[volume,fx],null,null,investor(-10,5));assert(!/mt-cp-metric|AI 시장|\d+점/.test(html));assert(html.includes('지금 할 것'));
assert(html.includes('지금 하지 말아야 할 것')&&!html.includes('실제 집계로 읽는 오늘의 흐름')&&html.includes('mt-cp-market-flows'));
assert(facts.avoid.some(s=>s.includes('거래가 적은')||s.includes('하락 속 거래량이 낮은')));
assert(intraday.avoid.some(s=>s.includes('마감 전')));assert(t.checkpointFacts_({},[]).avoid.some(s=>s.includes('자료가 없는')));
assert(!src.includes('marketTempBriefing=1')&&!src.includes('loadAiBriefing('));
(async()=>{
 const [a,b]=await Promise.all([sb.window.MarketTemp.fetchMarketTemp(),sb.window.MarketTemp.fetchMarketTemp()]);
 assert.equal(requests,1);assert.equal(a.temp,12);assert.equal(b.temp,12);
 sb.window.__mtSnapshotFetch=null;fail=true;await assert.rejects(sb.window.MarketTemp.fetchMarketTemp());assert.equal(sb.window.__mtSnapshotFetch,null);
 fail=false;await sb.window.MarketTemp.fetchMarketTemp();assert.equal(requests,3);
 console.log('Checkpoint facts: breadth, per-market flows, scores ignored, missing dates, intraday, AI removed, shared fetch + failure retry ok');
})().catch(e=>{console.error(e);process.exit(1)});
