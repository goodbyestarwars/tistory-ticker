const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/skin-main.js', 'utf8');
const body = {innerHTML: '', querySelector() {return this.innerHTML.includes('hmb-investor-row') ? {} : null;}, querySelectorAll() {return [];}};
const mode = {textContent: '막대'};
const buttons = [{setAttribute() {}}, {setAttribute() {}}];
let click, next, fail = false, calls = 0;
const host = {hidden: false, querySelector(s) {return s === '[data-investor-mode]' ? mode : body;},
  querySelectorAll() {return buttons;}, addEventListener(name, fn) {click = fn;}};
const context = {console, dashboardSection: {querySelector() {return host;}},
  fetchHomeJson() {calls++; return fail ? Promise.reject(new Error('offline')) : Promise.resolve(next);}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    function investorAmountText'), source.indexOf('    loadSummaryForSession(homeMarketSession());', source.indexOf('    function investorAmountText'))), context);
const sample = {data: {date: '2026-10-16', latest: -200, asOf: '2026-10-16T10:35:00+09:00', rows: [
  {slot: 0, frgn: 80, asOf: '2026-10-16T09:10:00+09:00'},
  {slot: 1, frgn: 0}, {slot: 3, frgn: -200}],
  extrema: {high: {slot: 0, value: 100}, low: {slot: 3, value: -250}}}};
context.sample = sample;
vm.runInContext('renderHomeInvestorTrend([sample,sample])', context);
assert.equal((body.innerHTML.match(/data-investor-slot=/g) || []).length, 6, 'only observed bars, independently for both markets');
assert.ok(body.innerHTML.includes('data-investor-slot="3"'));
assert.ok(!body.innerHTML.includes('data-investor-slot="2"'), 'missing intervals are not invented');
assert.ok(body.innerHTML.includes('고점 <b>+100억'), 'intraperiod high survives last-sample sampling');
assert.ok(body.innerHTML.includes('저점 <b>-250억'));
assert.ok(!body.innerHTML.includes('NaN'));
assert.equal(vm.runInContext('investorAmountText(null)', context), '-');
click({target: {closest() {return true;}}});
assert.equal(mode.textContent, '면적');
assert.equal((body.innerHTML.match(/<polygon/g) || []).length, 4, 'separate positive and negative areas');
assert.ok(body.innerHTML.includes('home-investor-kospi-buy'));
assert.ok(body.innerHTML.includes('home-investor-kosdaq-buy'), 'unique SVG clipping IDs per market');
// The isolated slot after a missing interval must not be joined to earlier data.
assert.equal((body.innerHTML.match(/<polyline/g) || []).length, 4);
next = structuredClone(sample);
next.data.latest = -400;
next.data.rows[2].frgn = -400;
next.data.extrema.low.value = -400;
async function run() {
  context.loadHomeInvestorTrend();
  context.loadHomeInvestorTrend();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2, 'overlapping refreshes share the active load');
  assert.ok(body.innerHTML.includes('저점 <b>-400억'));
  assert.ok(body.innerHTML.includes('<polygon'), 'area selection survives incoming data');
  const before = body.innerHTML;
  fail = true;
  context.loadHomeInvestorTrend();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.innerHTML, before, 'failed refresh retains valid chart data');
  click({target: {closest() {return true;}}});
  assert.equal(mode.textContent, '막대');
  context.empty = {data: {date: '2026-10-16', latest: null, rows: []}};
  vm.runInContext('renderHomeInvestorTrend([empty,empty])', context);
  assert.ok(body.innerHTML.includes('장중 기록 수집 전'));
  assert.ok(!body.innerHTML.includes('data-investor-slot='));
  console.log('Investor chart: bars/area, zero and missing data, extrema, refresh, failure retention passed');
}
run().catch(error => {console.error(error);process.exitCode = 1;});
