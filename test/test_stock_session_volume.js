const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const book = fs.readFileSync(path.join(__dirname, '../js/order-book.js'), 'utf8');
const workspace = fs.readFileSync(path.join(__dirname, '../js/stock-workspace.js'), 'utf8');
function extract(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
const state = {summary: {date:'2026-11-25', volume:364240, previousVolume:200000, liveVolume:417576}};
const build = new Function('state', extract(book,'  function numericOrNull','  function fmtPrice') +
  extract(book,'  function buildSummaryView','  function buildSummaryHtml') + ';return buildSummaryView;')(state);
const summary = build({volume:417576});
assert.equal(summary.volume,364240);
assert.equal(summary.liveVolume,417576);
assert.ok(Math.abs(summary.volumeChangePct - 82.12) < 1e-9);
assert.equal(build({volume:500000}).volume,364240);
assert.equal(build().volume,364240);
state.summary = {volume:null, previousVolume:200000, liveVolume:417576};
assert.equal(build({volume:417576}).volume,null);
assert.equal(build({volume:417576}).volumeChangePct,null);
state.summary = {};
assert.equal(build({volume:417576}).volume,null);
const box = {innerHTML:''};
const root = {querySelector: selector => selector === '#ssSessionCandle' ? {} : box};
const viewState = {code:'005930',session:summary,quote:{code:'005930',change:100}};
const render = new Function('root','state','doc','tone','signed',
  extract(workspace,'  function num(', '  function fmt(') +
  extract(workspace,'  function fmt(', '\n') +
  extract(workspace,'  function renderSessionExtra','  /* ───── 수급 탭') +
  ';return renderSessionExtra;')(root,viewState,{},()=>'',String);
render();
assert.ok(box.innerHTML.includes('364,240주'));
assert.ok(box.innerHTML.includes('11.25 일봉 거래량'));
assert.ok(!box.innerHTML.includes('417,576'));
viewState.session = {liveVolume:417576};
render();
assert.ok(!box.innerHTML.includes('417,576'));
assert.ok(box.innerHTML.includes('—'));
console.log('PASS same daily volume, same-series comparison, live isolation, missing daily and date label');
