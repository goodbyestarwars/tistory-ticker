
require('./helpers/common_runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/home-weekly-report.js'), 'utf8');
const chunk = source.slice(source.indexOf('  var extraIndicesMemo;'), source.indexOf('  // Own the two original sections'));
const week = { start: '2026-10-19', end: '2026-10-23' };
let calls = 0, fail = false, attached = true;
const cards = {};
const rows = ['DOW_INDEX', 'SOX'].map(symbol => ({ symbol, chart: [
  { date: '20261016', close: 100 }, { date: '20261019', close: 102 },
  { date: '20261023', close: 105 }, { date: '20261026', close: 999 }
]}));
const context = vm.createContext({
  Date, document: { body: { contains: () => attached } },
  num: value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value),
  INDEX_SPECS: [['DOW_INDEX', '다우존스'], ['SOX', '필라델피아 반도체']],
  indexCard: row => JSON.stringify(row),
  fetchJsonTimeout: () => { calls++; return fail ? Promise.reject(new Error('timeout')) : Promise.resolve({ data: rows }); }
});
vm.runInContext(chunk, context);
const root = { querySelector: selector => cards[selector] ||= { outerHTML: '미수신' } };
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const data = { week, indices: [{ symbol: 'DOW_INDEX', end: 105 }, { symbol: 'SOX', end: 105 }] };
  context.loadExtraIndices(root, data);
  assert.equal(calls, 0, 'complete weekly data needs no extra request');
  context.loadExtraIndices(root, { week, indices: [data.indices[0]] });
  await flush();
  assert.equal(calls, 1);
  assert.equal(Object.keys(cards).length, 1, 'fallback must not overwrite a valid Dow card');
  const summary = JSON.parse(cards['[data-index-symbol="SOX"]'].outerHTML);
  assert.equal(summary.end, 105);
  assert.equal(summary.base, 100);
  assert.ok(Math.abs(summary.changeRate - 5) < 1e-10);
  assert.equal(summary.series.length, 2, 'next-week data excluded');
  cards['[data-index-symbol="SOX"]'].outerHTML = 'valid';
  rows[1].chart = [];
  context.loadExtraIndices(root, { week, indices: [] });
  await flush();
  assert.equal(cards['[data-index-symbol="SOX"]'].outerHTML, 'valid', 'empty fallback cannot erase a card');
  context.extraIndicesMemo = null;
  fail = true;
  context.loadExtraIndices(root, { week, indices: [] });
  await flush();
  fail = false;
  attached = false;
  const before = JSON.stringify(cards);
  context.loadExtraIndices(root, { week, indices: [] });
  await flush();
  assert.equal(calls, 3, 'failed memo is retried on the next render');
  assert.equal(JSON.stringify(cards), before, 'detached roots are untouched');
  console.log('weekly index fallback: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
