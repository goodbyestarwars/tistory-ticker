
require('./helpers/common_runtime');
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;', 'global.MarketTemp = MarketTemp; global.frontTest = {frontPageStory_,buildSummaryCard};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout};
vm.runInNewContext(src,sb);
const {frontPageStory_:story,buildSummaryCard:summary}=sb.window.frontTest;
function data(up,down,total=up+down){return {score100:25,scoreDelta:-29,scoreDeltaFrom:'2026-10-21',marketBreadth:{total:{up,down,total}},components:{flow:{foreign:{ratio:.2},inst:{ratio:-.1}}},axes:{}};}
let d=data(454,2100,2652),s=story(d);
assert(s.headline.includes('2,100')&&s.lead.includes('79%'));
assert.equal(s.flow,'최근 5일 외국인 순매수 · 기관 순매도');
assert(story(data(2000,300)).headline.includes('오름세 우세'));
assert(story(data(50,50)).headline.includes('엇갈린'));
assert(story(data(0,0,100)).headline.includes('보합'));
const sampled=story({components:{riseRatio:{up:2,down:8,total:10}}});
assert(!sampled.wholeMarket&&sampled.lead.startsWith('분석 대상'));
assert(!sampled.lead.includes('코스피'));
for(const bad of [{up:null,down:null,total:5},{up:3,down:8,total:10},{up:NaN,down:4,total:5}]){
 const r=story({marketBreadth:{total:bad}});assert(!r.breadth);assert(r.lead.includes('확인'));
}
let html=summary(d);
assert(!html.includes('/100')&&!html.includes('mt-front-facts'));
assert(html.includes('data-market-indicators'));
assert(html.includes('코스피 거래량')&&html.includes('신용융자')&&html.includes('국채 10년물'));
assert(html.includes('<details class="mt-front-details"><summary>'));
assert(!html.includes('5일선')&&!html.includes('역발상'));
console.log('Market front page: fact headlines, scope, missing data and score-free summary ok');
