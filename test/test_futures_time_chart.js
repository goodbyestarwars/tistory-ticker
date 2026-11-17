const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const window={NineUI:{escapeHtml:v=>String(v)}};
vm.runInNewContext(fs.readFileSync(process.argv[2]||path.join(__dirname,'../js/investor-flow.js'),'utf8'),{window});
const shared=window.InvestorFlow;
const ts=t=>Date.parse('2026-11-13T'+t+':00+09:00')/1000;
const rows=[{ts:ts('09:00'),foreign:1000,institution:-900,individual:0},{ts:ts('09:10'),foreign:1200,institution:-1100,individual:0},{ts:ts('09:40'),foreign:800,institution:null,individual:10},{ts:ts('10:40'),foreign:1600,institution:-1000,individual:20}];
const result=shared.futuresRows(rows,'2026-11-13');
assert.equal(result.length,3);assert.equal(result[0].foreignDelta,null);assert.equal(result[0].foreign,1200);
assert.equal(result[1].foreignDelta,-400);assert.equal(result[1].institutionDelta,null);assert.equal(result[1].individualDelta,10);
assert.equal(result[2].foreignDelta,null);assert.equal(shared.futuresRows(rows,'2026-11-14').length,0);
const chart=shared.futuresChart(rows,{date:'2026-11-13',actor:'foreign'});
assert(chart.includes('hff-combined-plot'));assert(chart.includes('hff-flow-line'));assert(!chart.includes('hff-interval-bar'));
assert(chart.includes('누적 순매수'));assert(chart.includes('선택 구간 증감'));
assert.equal((chart.match(/hff-axis-scale/g)||[]).length,1);
assert.equal((chart.match(/<path data-futures-slot=/g)||[]).length,3);
assert.equal((chart.match(/<polyline/g)||[]).length,1);
assert(!chart.includes('<rect'));assert(chart.includes('누적 +1,600계약'));
const all=shared.futuresChart(rows,{date:'2026-11-13',actor:'all'});
for(const key of ['foreign','institution','individual'])assert(all.includes('hff-actor-'+key));
assert.equal((all.match(/hff-interval-bar/g)||[]).length,0);
assert(shared.futuresChart([],{date:null}).includes('관측 이력 대기'));
console.log('PASS cumulative-only chart, retained interval values, gaps, shared x axis, and 3 actors');


// UI regression: direct click/touch replaces the long slider and wheel trap.
const main=fs.readFileSync(path.join(__dirname,'../js/skin-main.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../css/home-market-board.css'),'utf8');
assert(main.includes('hff-selection-bar') && main.includes('selectHomeFuturesAtPointer'));
assert(main.includes("dashboardSection.addEventListener('pointermove'") && main.includes("dashboardSection.addEventListener('click'"));
assert(main.includes("flowPlot.setAttribute('data-no-swipe'"));
assert(!main.includes('data-futures-time') && !main.includes('futuresWheel'));
assert(css.includes('hff-interval-bar { stroke:none; }'));
assert(css.includes('touch-action:pan-y'));
