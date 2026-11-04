const fs=require('fs'),vm=require('vm'),assert=require('assert');
const core=require('../js/chart-core.js');
const win={NineChartCore:core,addEventListener(){},NineUI:{escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}};
let source=fs.readFileSync('js/foreign-flow.js','utf8').replace('global.ForeignFlow =','global.__cards={buildTrendChartCard,buildStockStoryHtml}; global.ForeignFlow =');
vm.runInNewContext(source,{window:win,document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout});
const card=win.__cards.buildTrendChartCard;
const daily=Array.from({length:300},(_,i)=>{let date=new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),c=100+i*.3+Math.sin(i/7)*12;return {date,open:c-1,close:c,high:c+5,low:c-6,volume:1000};});
const h=card({daily});assert(h.includes('ff-wide-cloud'));assert(!/NaN|Infinity/.test(h));assert(!h.includes('대비'));assert(!h.includes('ff-wide-lead'));
for (const key of ['ma20','ma60','ma224','close']) assert(h.includes('is-'+key));
const clouds=core.ichimokuCloudPoints(daily,'day');
const midpoint=(i,p)=>(Math.max(...daily.slice(i-p+1,i+1).map(x=>x.high))+Math.min(...daily.slice(i-p+1,i+1).map(x=>x.low)))/2;
assert.equal(clouds[0].spanA,(midpoint(51,9)+midpoint(51,26))/2);assert.equal(clouds[0].spanB,midpoint(51,52));assert.equal(clouds[0].time,daily[77].date);
assert.equal(clouds.at(-1).sourceTime,daily.at(-1).date);
assert(h.match(/class="ff-wide-cloud"[^>]+d="([^"]+)"/)[1].includes('640.00 '),'last span reaches +26 edge');
for(const n of [0,1,29,51,52,77,224]) {const s=card({daily:daily.slice(0,n)});assert(!/NaN|Infinity/.test(s));if(n<52)assert(!s.includes('class="ff-wide-cloud"'));}
const bad=daily.map(x=>({...x}));bad[150].high=null;bad[151].close=null;const bh=card({daily:bad});assert(!/NaN|Infinity/.test(bh));assert.equal((bh.match(/class="ff-wide-cloud"/g)||[]).length,2);
const flat=daily.map(x=>({...x,open:100,high:100,low:100,close:100}));assert(!/NaN|Infinity/.test(card({daily:flat})));
delete win.NineChartCore;assert(card({daily}).includes('로드 실패'));win.NineChartCore=core;
if(process.env.CARD_QA_HTML){const real=JSON.parse(fs.readFileSync('test/fixtures/chart_core/flow_chart_005930.json','utf8'));const body=win.__cards.buildStockStoryHtml({name:'삼성전자',baselineOnly:true,cards:[]},card(real),1,'005930');fs.writeFileSync('card-qa.html','<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="css/foreign-flow.css"><style>body{padding:24px 0} #foreign-flow{max-width:1180px;margin:0 auto} .qa-title{font-family:var(--font-serif);font-weight:700;font-size:24px;margin:24px} .qa-regular{font-family:var(--font-serif);font-weight:400;margin:24px}</style><h1 class="qa-title">종목분석 — 흐름을 읽는 투자</h1><p class="qa-regular">Noto Serif KR 기본 글꼴과 굵은 제목의 시각적 위계</p><main id="foreign-flow">'+body+'</main>');}
console.log('PASS card: OHLC 9/26/52, +26 bars, MA, gaps, empty/flat/short/failure, real data');
