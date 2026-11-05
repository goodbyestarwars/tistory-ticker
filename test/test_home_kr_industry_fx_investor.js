'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('js/skin-main.js','utf8');
const css=fs.readFileSync('css/home-market-board.css','utf8');
const skin=fs.readFileSync('skin.html','utf8');
assert(src.includes('data-home-kr-rotation hidden'));
assert(src.includes('domesticRotation.hidden = isUs'));
assert(src.includes('data-home-metric-chart="USDKRW"'));
assert(src.includes('data-home-metric-chart="KOSPI200_DAY"'));
assert(src.includes('USDKRW%2CKOSPI200_DAY&days=30&stored_only=true'));
assert(src.includes('renderHomeIndexChart(chart, item && item.chart, symbol'));
assert(src.includes('homeMetricQuotes = Object.assign({}, homeMetricQuotes, by)'));
assert(!src.includes('<div class="hmb2-leaders"><dt>주도 업종'));
assert(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
assert(css.includes('.hmb-investor-spark-wrap { height: 70px'));
assert(css.includes('.hmb-investor-line.hmb-investor-institution'));
assert(skin.includes('skin-main.js?v=20261025-countdown-module6'));
function piece(a,b) {
  const i=src.indexOf('    function '+a+'('),j=src.indexOf('    function '+b+'(',i);
  assert(i>=0&&j>i); return src.slice(i,j);
}
const spark=new Function('investorAmountText','investorTimeText','homeHoverAttr',
  piece('investorSparkline','renderHomeInvestorTrend')+'return investorSparkline;')(
  n=>n==null?'-':String(n),n=>String(n||'-'),n=>JSON.stringify(n).replace(/"/g,'&quot;'));
const rows=[{slot:0,frgn:-5,orgn:8},{slot:1,frgn:3,orgn:4},
  {slot:3,frgn:6,orgn:-4},{slot:4,frgn:7,orgn:-1}];
const area=spark({rows},'area','kospi');
assert(area.includes('hmb-investor-institution')&&area.includes('외국인 고점'));
assert(area.includes('기관 누적')&&area.includes('hmb-investor-point is-high'));
assert(!area.includes('NaN'));
const bar=spark({rows},'bar','kosdaq');
assert.equal((bar.match(/<rect /g)||[]).length,8);
const gaps=spark({rows:[{slot:0,frgn:5},{slot:2,orgn:6}]},'bar','kospi');
assert.equal((gaps.match(/<rect /g)||[]).length,2);
assert(spark({rows:[]},'area','kospi').includes('수집 전'));
const traces=[];
const graph=new Function('dashboardSection','homeNum','renderHomeIndexChart',
  piece('renderHomeMetricCharts','loadHomeDayFutures')+'return renderHomeMetricCharts;')(
  {querySelector:()=>({})},v=>v==null?null:Number(v),
  (el,chart,symbol,ref)=>traces.push([symbol,ref]));
graph({USDKRW:{price:1405,change:5,chart:[{close:1405}]},
  KOSPI200_DAY:{price:352,change:2,chart:[{close:352}]}});
assert.deepEqual(traces,[['USDKRW',1400],['KOSPI200_DAY',350]]);
const lists={leaders:{innerHTML:''},cautions:{innerHTML:''}};
const sectors=new Function('dashboardSection','sectorSummary','escapeHomeHtml','homeTone',
  piece('renderMarketSectors','homeIndexCard')+'return renderMarketSectors;')(
  {querySelector:q=>q==='[data-home-kr-rotation]'?{
    querySelector:s=>lists[s.includes('leaders')?'leaders':'cautions']}:null},
  ()=>({leaders:[{sector:'반도체',average:2.5,count:9}],
    cautions:[{sector:'화학',average:-1.8,count:6}]}),
  x=>x,n=>n>0?'home-positive':'home-negative');
sectors({});
assert(lists.leaders.innerHTML.includes('9종목')&&lists.leaders.innerHTML.includes('+2.50%'));
assert(lists.cautions.innerHTML.includes('6종목')&&lists.cautions.innerHTML.includes('-1.80%'));
console.log('KR sector relocation, two metric charts, investor dual-series/height/gaps: PASS');