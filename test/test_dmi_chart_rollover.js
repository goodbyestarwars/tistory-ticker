'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/domestic-market-indicators.js', 'utf8');
const start = source.indexOf('  function refreshDayBars()');
const end = source.indexOf('  function connectSocket()', start);
const oldDay = { date: '2026-11-05', open: 5500, high: 5586, low: 5336, close: 5383 };
const newDay = { date: '2026-11-06', open: 5263, high: 5269, low: 4911, close: 4974 };
const minute = { ts: 1793860320, close: 5383 };
const index = { intervals: { day: { rows: [oldDay] }, minute: { rows: [minute] } } };
let requests = 0;
const context = {
  KST_OFFSET_SEC: 32400, nextDayRefresh: 0,
  dmiRoot: { _dmiData: { indices: { KOSPI: index } } },
  fetchJson: async () => {
    requests++;
    return { indices: { KOSPI: { intervals: { day: { rows: [oldDay, newDay] } } } } };
  },
  renderCharts() {}, renderSpotQuotes() {}
};
vm.runInNewContext(source.slice(start, end), context);
const snapshot = price => ({ data: [{ symbol: 'KOSPI', price, updated_at: '2026-11-06T00:50:00Z' }] });
(async () => {
  context.applyLiveSnapshot(snapshot(4950));
  context.applyLiveSnapshot(snapshot(4940));
  assert.equal(oldDay.close, 5383);
  assert.equal(minute.close, 5383);
  assert.equal(requests, 1);
  await Promise.resolve();
  assert.equal(index.intervals.day.rows[1].date, '2026-11-06');
  context.applyLiveSnapshot(snapshot(4900));
  assert.equal(newDay.close, 4900);
  assert.equal(newDay.low, 4900);
  assert.equal(minute.close, 5383);
})().catch(error => { console.error(error); process.exitCode = 1; });

