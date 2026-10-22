const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;', 'global.MarketTemp = MarketTemp; global.rawTest = {buildIndicatorModels_,indicatorDate_,renderIndicatorHistory_,buildSummaryCard};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout};vm.runInNewContext(src,sb);const t=sb.window.rawTest;
const domestic={indices:{KOSPI:{intervals:{day:{rows:[{date:'2026-10-19',volume:100},{date:'2026-10-20',volume:125},{date:'2026-10-21',volume:100}]}}},KOSDAQ:{intervals:{day:{rows:[{date:'20261020',volume:500},{date:'20261021',volume:1000}]}}}},funds:{available:true,credit_unit:'hundred_million_krw',market_funds_unit:'million_krw',series:[{date:'2026-10-20',credit:300000,market_funds:{investor_deposits:90000000}},{date:'2026-10-21',credit:{loan_total:305000},market_funds:{investor_deposits:91000000}}]},investor:{KOSPI:{asOf:'2027-01-02T12:00:00+09:00',rows:[{label:'12.30',foreign:100,institution:-50},{label:'12.31',foreign:500,institution:-200}]},KOSDAQ:{asOf:'2027-01-02T12:00:00+09:00',rows:[{label:'12.30',foreign:-25,institution:-15}]}}};
const macro=[{symbol:'US10Y',chart:[{date:'20261020',close:4.2},{date:'20261021',close:4.1}]},{symbol:'USDKRW',chart:[{date:'20261020',close:1300},{date:'20261021',close:1301}]}];
const models=t.buildIndicatorModels_(domestic,macro),m=id=>models.find(x=>x.id===id);
assert.equal(models.length,8);assert(Math.abs(m('kospi-volume').value+20)<1e-9);assert.equal(m('kosdaq-volume').value,100);
assert.equal(m('kospi-volume').changeText,'거래량 감소');
assert.equal(m('credit').value,30.5e12);assert.equal(m('deposits').value,91e12);
assert.equal(m('foreign').value,75e8);assert.equal(m('institution').value,-65e8);
assert.equal(m('foreign').date,'2026-12-30','never combine two different sessions');
assert.equal(m('us-rate').valueText,'4.10%');assert.equal(m('us-rate').changeText,'-0.10%p');
assert.equal(m('fx').valueText,'1,301.0원');
assert.equal(m('fx').changeText,'+1.00원');
assert.equal(t.indicatorDate_('12.31','2027-01-02'),'2026-12-31');assert.equal(t.indicatorDate_('20260230'),null);
for(const id of ['kospi-volume','credit','foreign','us-rate','fx']){
 const html=t.renderIndicatorHistory_(m(id),10);assert(!html.includes('/100')&&!html.includes('점'));
 const pts=JSON.parse(html.match(/data-pts="([^"]+)"/)[1].replace(/&quot;/g,'"'));
 assert(pts.every(x=>!x.t.includes('점')));assert(html.includes(m(id).valueText));
 if(pts.length>1)assert(new Set(pts.map(p=>p.y)).size>1,'raw values must not be clipped to score scale');
}
const unavailable=t.buildIndicatorModels_({funds:{...domestic.funds,credit_unit:'unknown',available:false}},[]);
assert(unavailable.every(m=>m.value===null&&m.valueText==='확인 중'));
const partial=t.buildIndicatorModels_(domestic,[]);assert(partial.find(x=>x.id==='credit').value>0);assert.equal(partial.find(x=>x.id==='fx').value,null);
const unknownUnit=t.buildIndicatorModels_({funds:{...domestic.funds,credit_unit:'unknown'}},[]);assert.equal(unknownUnit.find(x=>x.id==='credit').value,null);assert(unknownUnit.find(x=>x.id==='deposits').value>0);
assert(!t.buildSummaryCard({}).includes('mt-front-facts'));
console.log('Direct indicators: 8 metrics, units, percent points, year boundary, date alignment, partial/missing data, raw graphs ok');
