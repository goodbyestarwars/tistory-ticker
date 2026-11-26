'use strict';
// US economic release calendar data: KST conversion, ordering and the 2026-11-09 expansion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('data/us-econ-calendar.js', 'utf8'), {window});
const events = window.US_ECON_CALENDAR.events;

test('events are sorted by KST start and unique per code/date', () => {
  const keys = new Set();
  events.forEach((event, i) => {
    assert.match(event.start, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\+09:00$/);
    if (i) assert.ok(events[i - 1].start <= event.start, event.code + ' ' + event.start);
    const key = event.code + ' ' + event.us_date;
    assert.ok(!keys.has(key), key);
    keys.add(key);
  });
});

test('November 2026 first week includes ISM, ADP, jobless claims and payrolls', () => {
  const week = events.filter(e => e.us_date >= '2026-11-02' && e.us_date <= '2026-11-06').map(e => e.code);
  ['ISM_MFG', 'JOLTS', 'ISM_SVC', 'ADP', 'CLAIMS', 'NFP'].forEach(code => assert.ok(week.includes(code), code));
});

test('Central-time FRED releases convert across the 2026-11-01 DST change', () => {
  const find = (code, date) => events.find(e => e.code === code && e.us_date === date).start;
  assert.equal(find('CLAIMS', '2026-10-29'), '2026-10-29T21:30:00+09:00');
  assert.equal(find('CLAIMS', '2026-11-05'), '2026-11-05T22:30:00+09:00');
  assert.equal(find('ISM_MFG', '2026-11-02'), '2026-11-03T00:00:00+09:00');
});

test('official Korean decision is unique and only marks a sourced result as reported', async () => {
  const global = {US_ECON_CALENDAR: {events: []}, NineHttp: {json: async () => ({items: [], data: []})}};
  const stores = new Map();
  global.localStorage = {getItem: key => stores.get(key), setItem: (key, value) => stores.set(key, value)};
  const context = {window: global, document: {addEventListener() {}}, Date, Promise, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync('data/official-economic-calendar.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('js/stock-calendar.js', 'utf8'), context);
  const events = (await global.StockCalendar.fetchEvents(2026, 10)).filter(row => row.code === 'BOK');
  assert.equal(events.length, 1);
  assert.equal(events[0].start, '2026-11-26T10:30:00+09:00');
  assert.equal(events[0].market, 'domestic');
  assert.ok(events[0].sources.length >= 2);
  assert.equal(events[0].status === 'reported', !!events[0].resultUrl);
});

test('release results read the period each release covers, never a newer or older value', () => {
  require('./helpers/common_runtime');
  const context = {window: {}, document: {readyState: 'loading', addEventListener() {}}, Date, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval};
  vm.runInNewContext(fs.readFileSync('js/us-macro-indicators.js', 'utf8'), context);
  const api = context.window.UsMacroIndicators;
  const monthly = (symbol, values) => ({symbol, chart: values.map(([date, close]) => ({date, close}))});
  const items = [
    monthly('US_NONFARM_PAYROLLS', [['20260801', 159068], ['20260901', 159128], ['20261001', 159293]]),
    monthly('US_UNEMPLOYMENT', [['20260901', 4.3], ['20261001', 4.4]]),
    monthly('US_CPI', [['20250901', 320], ['20260801', 328.4], ['20260901', 329.6]]),
    monthly('US_CORE_CPI', [['20250901', 326], ['20260901', 336.1]]),
    monthly('US_INITIAL_CLAIMS', [['20261024', 195000], ['20261031', 189000]]),
    monthly('US_TRADE_BALANCE', [['20260801', -105737], ['20260901', -105047]]),
    monthly('US_REAL_GDP_GROWTH', [['20260401', 2.2], ['20260701', 3.1]])
  ];
  const nfp = api.releaseResult('NFP', '2026-11-06', items);
  assert.equal(nfp.state, 'ok');
  assert.equal(nfp.text, '비농업 고용 +165천 명 · 실업률 4.4%');
  assert.equal(nfp.period, '2026년 10월');
  // October NFP release covers September even though October data now exists.
  assert.equal(api.releaseResult('NFP', '2026-10-02', items).text, '비농업 고용 +60천 명 · 실업률 4.3%');
  assert.equal(api.releaseResult('CPI', '2026-10-14', items).text, 'CPI 전월 +0.4% · 전년 +3.0% · 근원 전년 +3.1%');
  assert.equal(api.releaseResult('CLAIMS', '2026-11-05', items).text, '18.9만 건 (전주 −0.6만)');
  assert.equal(api.releaseResult('TRADE', '2026-11-04', items).text, '적자 1,050억 달러');
  assert.equal(api.releaseResult('GDP', '2026-10-29', items).text, '연율 +3.1%');
  const pending = api.releaseResult('CPI', '2026-11-10', items);
  assert.equal(pending.state, 'pending', 'missing October CPI must not reuse September');
  assert.match(pending.text, /2026년 10월 결과 FRED 반영 대기/);
  assert.equal(api.releaseResult('ISM_MFG', '2026-11-02', items).state, 'license');
  assert.equal(api.releaseResult('FOMC', '2026-10-28', items), null);
});
