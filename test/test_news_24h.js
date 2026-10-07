const fs=require('fs'),vm=require('vm'),assert=require('assert');
const now=Date.parse('2026-10-08T00:00:00Z');
class FixedDate extends Date { constructor(...a){super(...(a.length?a:[now]));} static now(){return now;} }
let src=fs.readFileSync('js/main-news.js','utf8').replace('global.MainNews = MainNews;','global.MainNews = MainNews; global.qa={timeLabel,limitMarketRows};');
const window={addEventListener(){}},document={readyState:'loading',addEventListener(){}};
vm.runInNewContext(src,{window,document,Date:FixedDate,Intl});
const rows=[0,23,24,25].map(h=>({pubDate:new Date(now-h*3600000).toISOString()}));
rows.push({pubDate:'invalid'},{pubDate:new Date(now+1000).toISOString()});
assert.equal(window.qa.limitMarketRows(rows).length,3);
assert.equal(window.qa.limitMarketRows([{pubDate:'2020-01-01T00:00:00Z'}]).length,0);
assert.match(window.qa.timeLabel('2026-10-07T23:00:00Z','us'),/19:00 ET$/);
assert.match(window.qa.timeLabel('2026-10-07T23:00:00Z','domestic'),/08:00 KST$/);
assert.match(window.qa.timeLabel('2026-01-01T17:00:00Z','us'),/12:00 ET$/);
let home=fs.readFileSync('js/home-economic-news.js','utf8').replace('global.HomeEconomicNews = { init: init };','global.HomeEconomicNews = { init: init }; global.homeQa={timeLabel,dateLabel,periodKey};');
vm.runInNewContext(home,{window,document,Date:FixedDate,Intl});
assert.equal(window.homeQa.dateLabel('2026-10-08T00:00:00Z','us'),'10/07');
assert.equal(window.homeQa.dateLabel('2026-10-08T00:00:00Z','domestic'),'10/08');
assert.equal(window.homeQa.periodKey('2026-10-08T00:00:00Z','us'),'pm');
assert.equal(window.homeQa.periodKey('2026-10-08T00:00:00Z','domestic'),'am');
console.log('PASS: strict 24h bounds, no stale fallback, ET/KST dates and DST labels');

let us=fs.readFileSync('js/us-stocks.js','utf8').replace('global.UsStocks = { init: init, select: select, pause: pause };','global.UsStocks = { init: init, select: select, pause: pause }; global.usQa={isRecentNews,formatNewsTime};');
vm.runInNewContext(us,{window,document,Date:FixedDate,Intl});
assert.equal(window.usQa.formatNewsTime('2026-10-08T00:00:00Z'),'20:00 ET');
assert.equal(window.usQa.isRecentNews({pubDate:'2026-10-08T00:00:01Z'}),false);
let stock=fs.readFileSync('js/stock-news.js','utf8').replace('global.StockNews = { init: init };','global.StockNews = { init: init }; global.stockQa={renderNews};');
vm.runInNewContext(stock,{window,document,Date:FixedDate,Intl});
const box={innerHTML:'',querySelectorAll(){return [];}};
window.stockQa.renderNews(box,{name:'테스트',code:'000000'},[{title:'전날 밤 기사',datetime:'202610072300'},{title:'오래된 기사',datetime:'202610070800'}]);
assert.ok(box.innerHTML.includes('전날 밤 기사'));
assert.ok(!box.innerHTML.includes('오래된 기사'));
console.log('PASS: US stock ET and domestic stock previous-night 24h news');

