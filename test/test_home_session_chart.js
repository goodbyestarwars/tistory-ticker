const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/skin-main.js','utf8');
let click, refresh=0;
const context={window:{},document:{},Date,Intl,Promise,isFinite,
 dashboardSection:{addEventListener(type,fn){click=fn;}},latestHomeIndices:[],renderHomeIndices(){refresh++;}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    var HOME_USE_SAMPLE_CHARTS'),source.indexOf('    var homeChartMotion')),context);
const stamp=Date.parse('2026-10-15T09:30:00-04:00')/1000;
const element={innerHTML:'',attrs:{},classList:{add(){}},setAttribute(k,v){this.attrs[k]=v;}};
context.element=element;
context.homeSessionCharts.NASDAQ_INDEX={reference:100,basis:'시세 수집 관측값 · 공급자 지연 가능',
 session:{date:'2026-10-15',start:'2026-10-15T09:30:00-04:00',end:'2026-10-15T16:00:00-04:00',timeZone:'America/New_York',slotCount:14},
 rows:[{slot:0,open:100,high:110,low:99,close:105,ts:stamp+60},
 {slot:1,open:105,high:106,low:90,close:95,ts:stamp+1860},
 {slot:4,open:96,high:99,low:95,close:98,ts:stamp+7260}]};
vm.runInContext("renderHomeSessionChart(element,'NASDAQ_INDEX',100)",context);
assert.equal((element.innerHTML.match(/data-price-slot=/g)||[]).length,3,'only actual observations become bars');
assert.match(element.innerHTML,/觀測|관측 고점/);
assert.match(element.innerHTML,/110/);
assert.match(element.innerHTML,/저점 <b>90/);
assert.match(element.innerHTML,/뉴욕시간/);
assert.match(element.innerHTML,/3\/14개/);
assert.match(element.innerHTML,/09:30/);
assert.match(element.innerHTML,/hmb-investor-buy/);
assert.match(element.innerHTML,/hmb-investor-sell/);
click({target:{closest:()=>true}});
assert.equal(context.homePriceMode,'area');
assert.equal(refresh,1,'arrow uses same refresh/render path');
vm.runInContext("renderHomeSessionChart(element,'NASDAQ_INDEX',100)",context);
assert.ok(element.innerHTML.includes('<polygon'));
assert.equal((element.innerHTML.match(/<polyline/g)||[]).length,2,'one contiguous run, duplicated only for color clips');
assert.equal((element.innerHTML.match(/<circle/g)||[]).length,3);
assert.ok(element.innerHTML.includes('home-price-NASDAQ_INDEX-buy'));
context.homeSessionCharts.NASDAQ_INDEX.rows[1].low=80;
vm.runInContext("renderHomeSessionChart(element,'NASDAQ_INDEX',100)",context);
assert.match(element.innerHTML,/저점 <b>80/,'refreshed extrema replace old values');
assert.equal(context.homePriceMode,'area','data refresh preserves mode');
context.homeSessionCharts.KOSPI200_NIGHT={basis:'기존 실제 분봉 집계',
 session:{date:'2026-10-15',start:'2026-10-15T18:00:00+09:00',end:'2026-10-16T06:00:00+09:00',timeZone:'Asia/Seoul',slotCount:25},
 rows:[{slot:14,open:100,high:100,low:100,close:100,ts:stamp}]};
vm.runInContext("renderHomeSessionChart(element,'KOSPI200_NIGHT',null)",context);
assert.match(element.innerHTML,/KST/);
assert.match(element.innerHTML,/18:00/);
assert.match(element.innerHTML,/06:00/);
assert.ok(!element.innerHTML.includes('NaN'));
assert.ok(!element.innerHTML.includes('<polygon'),'single sample has a point, not invented area');
vm.runInContext("renderHomeSessionChart(element,'SP500_INDEX',100)",context);
assert.match(element.innerHTML,/장중 기록 수집 전/);
assert.ok(!element.innerHTML.includes('data-price-slot'));
console.log('PASS US/night bars-area switch, sparse gaps, extrema refresh, DST labels, single/empty samples');
context.homeSessionCharts.KOSPI={basis:'시세 수집 관측값',session:{date:'2026-10-16',start:'2026-10-16T09:00:00+09:00',end:'2026-10-16T15:30:00+09:00',timeZone:'Asia/Seoul',slotCount:14},rows:[{slot:0,open:100,high:110,low:90,close:105,ts:stamp}]};
vm.runInContext("renderHomeSessionChart(element,'KOSPI',null)",context);
assert.match(element.innerHTML,/30분 · KST/);
assert.match(element.innerHTML,/09:00/);
assert.match(element.innerHTML,/15:30/);
assert.match(element.innerHTML,/1\/14개/);
