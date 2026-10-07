const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const now=Date.UTC(2026,9,8),window={MARKET_HISTORY_ARCHIVES:{domestic:{series:{KOSPI:[
 ['20211007',9,10,8,9],['20211008',10,12,9,11],['20261006',20,23,19,21]
]}}}};
let requests=0,lastScript;
const document={head:{appendChild(script){requests++;lastScript=script;}},createElement(){return {};}};
vm.runInNewContext(fs.readFileSync('js/market-history.js','utf8'),{window,document,Date,Promise,setTimeout,clearTimeout});
const h=window.MarketChartHistory;
const rows=h.merge('KOSPI',[{date:'2026-10-06',open:21,high:24,low:20,close:23},{date:'20261007',open:23,high:25,low:22,close:24}],now);
assert.equal(rows.length,3,'old archive date removed, overlapping latest bars replace archive');
assert.equal(rows[0].date,'20211008');assert.equal(rows[1].close,23);
assert.equal(h.isoRows(rows)[0].date,'2021-10-08');
assert.equal(h.caption(rows,now),'최근 5년 · 2021.10 ~ 2026.10');
assert.match(h.caption(rows.slice(1),now),/^확보된 이력/);
const weeks=h.weekly(rows.slice(1));assert.equal(weeks.length,1);assert.equal(weeks[0].open,21);assert.equal(weeks[0].close,24);assert.equal(weeks[0].high,25);assert.equal(weeks[0].low,20);
assert.equal(h.cutoff(Date.UTC(2024,1,29)),'20190228','leap-day cutoff');
const a=h.load('global'),b=h.load('global');assert.equal(a,b);assert.equal(requests,1,'one archive request shared');lastScript.onload();
a.then(result=>{assert.equal(result,true);console.log('PASS five-year cutoff, merge precedence, OHLC weeks, range labels, shared static request');});
