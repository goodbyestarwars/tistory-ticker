// Home US third index follows the official NYSE regular session calendar.
// Run: node test/test_home_us_third_index.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const main = fs.readFileSync('js/skin-main.js', 'utf8').replace(/\r\n/g, '\n');
const hoursAnchor = shell.indexOf('시장 시간 단일 기준');
const hoursStart = shell.indexOf('(function (global) {', hoursAnchor);
const hoursEnd = shell.indexOf('})(window);', hoursStart) + '})(window);'.length;
const selectorStart = main.indexOf('    function usThirdIndexState(now) {');
const selectorEnd = main.indexOf('\n    }\n', selectorStart) + '\n    }'.length;
assert.ok(hoursAnchor >= 0 && hoursStart >= 0 && hoursEnd > hoursStart, 'common MarketHours exists');
assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, 'third-card selector exists');

const context = { window: {}, Date, Intl };
vm.createContext(context);
vm.runInContext(shell.slice(hoursStart, hoursEnd), context);
vm.runInContext(main.slice(selectorStart, selectorEnd), context);
const selected = timestamp => vm.runInContext('usThirdIndexState(new Date(' + JSON.stringify(timestamp) + '))', context);

[
  ['EST before open', '2026-11-04T14:29:00Z', 'DOW'],
  ['EST at open', '2026-11-04T14:30:00Z', 'SOX'],
  ['EST before close', '2026-11-04T20:59:00Z', 'SOX'],
  ['EST at close', '2026-11-04T21:00:00Z', 'DOW'],
  ['EDT before open', '2026-07-06T13:29:00Z', 'DOW'],
  ['EDT at open', '2026-07-06T13:30:00Z', 'SOX'],
  ['NYSE holiday', '2026-11-26T15:00:00Z', 'DOW'],
  ['early close before', '2026-11-27T17:59:00Z', 'SOX'],
  ['early close at 13 ET', '2026-11-27T18:00:00Z', 'DOW'],
  ['weekend', '2026-11-07T15:00:00Z', 'DOW']
].forEach(([label, date, key]) => assert.equal(selected(date).key, key, label));

assert.equal(selected('2026-11-04T14:29:00Z').label, '다우존스30 선물(CME)');
assert.equal(selected('2026-11-04T14:30:00Z').label, '필라델피아 반도체');
assert.match(main, /thirdCard\.setAttribute\('data-home-index', third\.key\)/, 'slot identity updates with source');
assert.match(main, /thirdItem && thirdItem\.chart, third\.key/, 'chart switches to selected series');
assert.match(main, /SP500%2CDOW%2CKOSPI200_NIGHT/, 'fallback request includes DOW');
assert.match(main, /key === 'DOW' && homeSessionCharts\.DOW/, 'DOW 30-minute chart requires actual observed data');
console.log('home US third index: 10 session cases + UI contracts passed');
// Exercise the real chart router and renderer, including fallback -> session transitions.
const chartContext = {
  window: {}, document: {createElement() { return {className: '', textContent: ''}; }},
  Date, Intl, isFinite, WeakMap,
  dashboardSection: {addEventListener() {}},
};
vm.createContext(chartContext);
vm.runInContext(main.slice(main.indexOf('    var HOME_USE_SAMPLE_CHARTS'),
  main.indexOf('    function formatHomeTimestamp')), chartContext);
function chartElement(width) {
  const classes = new Set();
  return {innerHTML: '', attrs: {}, clientWidth: width, clientHeight: 90,
    classList: {add(k) { classes.add(k); }, remove(k) { classes.delete(k); }, contains(k) { return classes.has(k); }},
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    insertAdjacentElement(_, note) {
      this.nextElementSibling = note;
      note.classList = {contains: k => note.className === k};
      note.remove = () => { this.nextElementSibling = null; };
    }, querySelector() { return null; }};
}
const series = {
  reference: 100, basis: '시세 수집 관측값 · 공급자 지연 가능',
  session: {date: '2026-11-04', start: '2026-11-04T18:00:00-05:00',
    end: '2026-11-05T17:00:00-05:00', timeZone: 'America/New_York', slotCount: 47},
  rows: [{slot: 0, open: 100, high: 105, low: 99, close: 104, ts: Date.parse('2026-11-04T23:01:00Z') / 1000}]
};
for (const width of [240, 390]) {
  const element = chartElement(width);
  chartContext.element = element;
  for (const missing of [undefined, {rows: []}]) {
    chartContext.homeSessionCharts.DOW = missing;
    vm.runInContext("renderHomeIndexChart(element, [], 'DOW', null)", chartContext);
    assert.match(element.nextElementSibling.textContent, /최근 20거래일 자료 없음/);
    assert.ok(!element.classList.contains('has-session-chart'));
    assert.equal(element.attrs['data-session-symbol'], undefined);
  }
  const layouts = [];
  for (const symbol of ['NASDAQ100', 'SP500', 'DOW', 'SOX']) {
    chartContext.homeSessionCharts[symbol] = series;
    chartContext.key = symbol;
    vm.runInContext('renderHomeIndexChart(element, [], key, null)', chartContext);
    assert.equal(element.attrs['data-session-symbol'], symbol);
    assert.ok(element.classList.contains('has-session-chart'));
    assert.equal(element.nextElementSibling, null, 'daily fallback caption removed');
    assert.equal(element.attrs['data-history-range'], undefined);
    assert.match(element.innerHTML, /30분 · 뉴욕시간/);
    assert.match(element.innerHTML, /1\/47개/);
    assert.ok(!element.innerHTML.includes('최근 20거래일'));
    layouts.push(element.innerHTML.replaceAll(symbol, 'SYMBOL'));
  }
  assert.ok(layouts.every(html => html === layouts[0]), 'same shared information and chart structure');
  chartContext.homePriceModes.DOW = 'bar';
  vm.runInContext("renderHomeIndexChart(element, [], 'DOW', null)", chartContext);
  assert.match(element.innerHTML, /data-price-slot="0"/);
  delete chartContext.homeSessionCharts.DOW;
  vm.runInContext("renderHomeIndexChart(element, [], 'DOW', null)", chartContext);
  assert.equal(element.attrs['data-session-symbol'], undefined, 'fallback cannot retain session switch identity');
  delete chartContext.homePriceModes.DOW;
}
console.log('PASS DOW shared 30-minute layout, single observation, bars, missing data and fallback transitions');
