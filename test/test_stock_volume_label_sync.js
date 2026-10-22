'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const frames = new Map();
let id = 0;
const window = { addEventListener() {},
  requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
  cancelAnimationFrame(key) { frames.delete(key); } };
const source = fs.readFileSync('js/stock-search.js', 'utf8').replace(
  'global.StockSearch = { init: init };',
  'global.testLabels = { installPaneLabelSync };');
vm.runInNewContext(source, { window, document: { readyState: 'loading', addEventListener() {} } });
const legend = { style: {}, dataset: {}, offsetHeight: 16,
  classList: { add() {}, remove() {} } };
const container = { querySelector(selector) { return selector === '.ss-volume-study-label' ? legend : null; } };
const panes = [420, 80].map(height => ({ height, handlers: new Set(),
  getHeight() { return this.height; },
  subscribeSizeChange(fn) { this.handlers.add(fn); },
  unsubscribeSizeChange(fn) { this.handlers.delete(fn); } }));
function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); }
// RSI is disabled. The chart has not applied the new stretch factors yet.
const off = window.testLabels.installPaneLabelSync(container, panes, { mainHeight: 600, subHeight: 70 });
panes[0].height = 610;
flush();
assert.equal(legend.style.top, '616px');
for (const height of [740, 260, 540]) { // fullscreen, mobile, divider drag
  panes[0].height = height;
  for (let i = 0; i < 3; i++) panes.forEach(pane => pane.handlers.forEach(fn => fn()));
  assert.equal(frames.size, 1);
  flush();
  assert.equal(legend.style.top, (height + 6) + 'px');
}
panes[0].handlers.forEach(fn => fn());
off();
assert.equal(frames.size, 0);
panes.forEach(pane => assert.equal(pane.handlers.size, 0));
console.log('volume label layout sync: passed');
