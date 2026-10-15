const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{},document:{},Date,Intl,Promise,isFinite,dashboardSection:{addEventListener(){}}};
vm.createContext(context);
for (const file of ['js/market-history.js','data/chart-history/domestic.js','data/chart-history/global.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
const recent=[{date:'20261007',close:9999}];
const expected=context.window.MarketChartHistory.merge('KOSPI',recent);
assert.equal(expected.find(row=>row.date==='20261007').close,9999,'fresh daily data still overrides archive');
assert.ok(expected.length>1200,'shared five-year archive remains available to other charts');
const source=fs.readFileSync('js/skin-main.js','utf8');
vm.runInContext(source.slice(source.indexOf('    var HOME_USE_SAMPLE_CHARTS'),source.indexOf('    function formatHomeTimestamp')),context);
context.element={innerHTML:'',classList:{add(){},remove(){}},setAttribute(){},nextElementSibling:null};
for (const symbol of ['KOSPI','KOSDAQ','NASDAQ_INDEX','SP500_INDEX']) {
 context.homeSessionCharts[symbol]={basis:'observed',session:{date:'2026-10-16',start:'2026-10-16T09:00:00+09:00',end:'2026-10-16T15:30:00+09:00',timeZone:'Asia/Seoul',slotCount:14},rows:[{slot:0,open:100,high:101,low:99,close:100,ts:1792108800}]};
 vm.runInContext("renderHomeIndexChart(element,[], '"+symbol+"',null)",context);
 assert.ok(context.element.innerHTML.includes('data-price-switch'),symbol+' uses the same bar/area renderer');
 assert.ok(context.element.innerHTML.includes('data-price-slot="0"'));
 assert.ok(!context.element.innerHTML.includes('home-chart-pen'));
}
console.log('PASS KR/US shared home renderer and preserved five-year archive');