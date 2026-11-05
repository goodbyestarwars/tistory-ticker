'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('js/skin-main.js','utf8');
const css=fs.readFileSync('css/home-market-board.css','utf8');
const skin=fs.readFileSync('skin.html','utf8');
function part(a,b) {
 const i=src.indexOf('    function '+a+'('),j=src.indexOf('    function '+b+'(',i);
 assert(i>=0&&j>i,'function '+a); return src.slice(i,j);
}
assert(skin.includes('skin-main.js?v=20261025-countdown-module6')); // no skin HTML change
assert(src.includes('data-home-day-field="status"'));
assert(src.includes('data-investor-actor="foreign"')&&src.includes('data-investor-actor="institution"'));
assert(src.includes('data-investor-actor="compare" aria-pressed="true"'));
assert(src.includes("homeInvestorActor = nextActor"));
assert(src.includes("renderHomeMetricCharts(homeMetricQuotes)"));
assert(css.includes('hmb2-day-heading'));
assert(css.includes('.home-index-chart.hmb2-metric-chart'));
assert(css.includes('grid-template-rows: 18px 24px 56px 15px'));
assert(css.includes('.hmb-investor-actor-filter'));
assert(css.includes('.hmb-investor-spark-wrap { height: 70px;'));

const spark=new Function('investorAmountText','investorTimeText','homeHoverAttr',
 part('investorSparkline','renderHomeInvestorTrend')+'return investorSparkline;')(
 n=>n==null?'-':n+'억',t=>t||'--',x=>JSON.stringify(x).replace(/"/g,'&quot;'));
const rows=[{slot:0,frgn:5,orgn:-4},{slot:1,frgn:7,orgn:-2},{slot:3,frgn:2,orgn:6}];
const together=spark({rows},'area','kospi','compare');
const foreigners=spark({rows},'area','kospi','foreign');
const institutions=spark({rows},'area','kospi','institution');
assert(together.includes('hmb-investor-institution')&&together.includes('외국인 고점'));
assert(!foreigners.includes('hmb-investor-institution'));
assert(foreigners.includes('외국인 고점'));
assert(!institutions.includes('외국인 고점') && institutions.includes('기관 고점'));
assert(institutions.includes('hmb-investor-area'));
assert(!institutions.includes('hmb-investor-institution'));
assert.equal((spark({rows},'bar','kospi','foreign').match(/<rect /g)||[]).length,3);
assert.equal((spark({rows},'bar','kospi','institution').match(/<rect /g)||[]).length,3);
assert.equal((spark({rows},'bar','kospi','compare').match(/<rect /g)||[]).length,6);
assert(spark({rows:[{slot:0,frgn:1}]},'bar','kospi','institution').includes('선택한 투자자 관측값 없음'));

const fakeDocument={createElement(){return {className:'',classList:{contains(){return false}},textContent:''}}};
const mockMotion={get(){return null},delete(){}};
let mode='area';
const plot=new Function('renderHomeSessionChart','homeChartRows','stopHomeChartMotion',
 'homeChartMotion','homePriceSwitchControls','homeModeOf','document','homeChartReducedMotion',
 part('renderHomeIndexChart','formatHomeTimestamp')+'return renderHomeIndexChart;')(
 ()=>{throw Error('must not draw session chart')},rows=>rows,()=>{},mockMotion,
 (key)=>'<button data-price-switch>'+mode+'</button>',()=>mode,fakeDocument,true
);
const chart={
 clientWidth:205,clientHeight:56,innerHTML:'',nextElementSibling:null,
 attrs:{},classList:{add(){},remove(){}},setAttribute(k,v){this.attrs[k]=v},
 removeAttribute(k){delete this.attrs[k]},querySelector(){return null},
 insertAdjacentElement(where,el){this.nextElementSibling=el}
};
const prices=[1400,1402,1398,1405].map((close,i)=>({date:'2026110'+(i+1),close}));
plot(chart,prices,'USDKRW',1400);
assert(!chart.innerHTML.includes('data-price-switch'));
assert(chart.attrs.title && chart.attrs.title.includes('거래일'));
assert(!chart.nextElementSibling, 'no per-card duplicate date footer');
assert(chart.innerHTML.includes('hmb-investor-area'));
assert(chart.innerHTML.includes('hmb2-metric-plot'));
assert(!chart.innerHTML.includes('home-chart-pen'));
assert(!chart.innerHTML.includes('home-chart-axis'), 'compact metrics must not repeat axis numbers/dates in the SVG');
assert(src.indexOf('data-home-metric-mode="area"') < src.indexOf('class="hmb-list hmb2-core"'));
assert(css.includes('.hmb2-core > :is(.hmb2-fx, .hmb2-day-futures)'));
assert(css.includes('grid-template-rows: 18px 24px 56px 15px'));
assert(chart.attrs['data-metric-symbol']==='USDKRW');
mode='bar';
plot(chart,prices,'USDKRW',1400);
assert(!chart.innerHTML.includes('hmb-investor-area'));
assert((chart.innerHTML.match(/<rect class="hmb-investor-/g)||[]).length===4);
mode='area';plot(chart,[], 'KOSPI200_DAY',null);
assert(chart.innerHTML.includes('추이 데이터 없음'));
assert(!chart.innerHTML.includes('data-price-switch'));
assert(src.includes('data-home-metric-mode="area"') && src.includes('data-home-metric-mode="bar"'));
assert(src.includes('homePriceModes[symbol] = metricMode'));
console.log('PASS: futures status, actor selector 3 modes, FX/future daily area/bar, empty & unchanged skin');