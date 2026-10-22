'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const frames = new Map();
let id = 0, observer;
const events = new Map();
const window = { addEventListener(name, fn) { events.set(name, fn); },
  removeEventListener(name) { events.delete(name); },
  ResizeObserver: class { constructor(fn) { this.callback = fn; this.observed = []; observer = this; }
    observe(el) { this.observed.push(el); } disconnect() { this.observed = []; } },
  requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
  cancelAnimationFrame(key) { frames.delete(key); } };
const source = fs.readFileSync('js/stock-search.js', 'utf8').replace(
  'global.StockSearch = { init: init };',
  'global.testLabels = { installPaneLabelSync };');
vm.runInNewContext(source, { window, document: { readyState: 'loading', addEventListener() {} } });
const legend = { style: {}, dataset: {}, offsetHeight: 16,
  classList: { add() {}, remove() {} } };
const container = { querySelector(selector) { return selector === '.ss-volume-study-label' ? legend : null; } };
// Match actual LWC 5.2 PaneApi: no subscribeSizeChange method.
const panes = [420, 80].map(height => ({ height, element: {},
  getHeight() { return this.height; }, getHTMLElement() { return this.element; } }));
function flush() { let count = 0; while (frames.size) {
  assert.ok(++count < 8, 'layout must settle');
  const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
} }
// RSI is disabled. The chart has not applied the new stretch factors yet.
const off = window.testLabels.installPaneLabelSync(container, panes, { mainHeight: 600, subHeight: 70 });
panes[0].height = 610;
flush();
assert.equal(legend.style.top, '616px');
for (const height of [740, 260, 540]) { // fullscreen, mobile, divider drag
  panes[0].height = height;
  for (let i = 0; i < 3; i++) observer.callback();
  assert.equal(frames.size, 1);
  flush();
  assert.equal(legend.style.top, (height + 6) + 'px');
}
assert.equal(observer.observed.length, 3);
observer.callback();
off();
assert.equal(frames.size, 0);
assert.equal(observer.observed.length, 0);
assert.equal(events.size, 0);
observer.callback();
assert.equal(frames.size, 0, 'disposed observer cannot schedule stale updates');
console.log('volume label layout sync: passed');
