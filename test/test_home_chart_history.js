const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const now=Date.UTC(2026,9,8);
class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
const window={},document={createElement(){return {className:'',textContent:'',classList:{contains(){return true;}}};}};
const context={window,document,Date:Clock,Promise,setTimeout,clearTimeout,isFinite};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/market-history.js','utf8'),context);
vm.runInContext(fs.readFileSync('data/chart-history/domestic.js','utf8'),context);
vm.runInContext(fs.readFileSync('data/chart-history/global.js','utf8'),context);
const source=fs.readFileSync('js/skin-main.js','utf8');
vm.runInContext(source.slice(source.indexOf('    var HOME_USE_SAMPLE_CHARTS'),source.indexOf('    function formatHomeTimestamp')),context);
const element={attrs:{},setAttribute(k,v){this.attrs[k]=v;},insertAdjacentElement(where,node){this.nextElementSibling=node;}};
context.element=element;
context.recent=[{date:'20261007',close:9999}];
vm.runInContext("renderHomeIndexChart(element,recent,true,'KOSPI')",context);
assert.ok(Number(element.attrs['data-history-count'])>200 && Number(element.attrs['data-history-count'])<280,'home KOSPI chart uses one year of trading days');
assert.match(element.attrs['data-history-range'],/최근 1년 · 2025\.10\.\d\d ~ 2026\.10\.08/);
assert.equal(element.nextElementSibling.textContent,element.attrs['data-history-range']);
const expected=window.MarketChartHistory.merge('KOSPI',context.recent);
assert.equal(expected.find(row=>row.date==='20261007').close,9999,'fresh quote history overrides archived date');
assert.ok(expected.length>1200,'shared five-year archive remains intact');
vm.runInContext("renderHomeIndexChart(element,recent,false,'KOSPI')",context);
assert.equal(element.nextElementSibling.textContent,element.attrs['data-history-range']);
assert.ok(!element.innerHTML.includes('stroke-width="9"'),'domestic mini-chart has no glow line');
assert.ok(!element.innerHTML.includes('<polygon'),'domestic mini-chart has no filled shadow');
for (const symbol of ['NASDAQ_INDEX','SP500_INDEX']) {
  vm.runInContext(`renderHomeIndexChart(element,recent,false,'${symbol}')`,context);
  assert.ok(Number(element.attrs['data-history-count'])>200 && Number(element.attrs['data-history-count'])<280,`${symbol} chart uses one year of trading days`);
  assert.match(element.attrs['data-history-range'],/최근 1년 · 2025\.10\.\d\d ~ 2026\.10\.\d\d/);
  assert.ok(element.innerHTML.includes('<polygon'),'US mini-chart styling remains intact');
}
window.MARKET_HISTORY_ARCHIVES={};
context.recent=[{date:'20260901',close:100},{date:'20261007',close:110}];
vm.runInContext("renderHomeIndexChart(element,recent,true,'KOSPI')",context);
assert.equal(element.attrs['data-history-range'],'확보된 이력 · 2026.09.01 ~ 2026.10.07');
console.log('PASS domestic and US home one-year charts, retained five-year archive, fresh-date precedence, visible range caption');
