// Regression: mouse wheel zoom in 9Pay stock and index charts should animate like a continuous gesture.
// Run: node test/test_chart_smooth_wheel.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../js/chart-core.js');
const source = fs.readFileSync('js/stock-search.js', 'utf8');
assert(source.includes('stockWheelCleanup = core.installSmoothWheelZoom(chart, container, { bars: bars.length })'));
assert(source.includes('indexWheelCleanup = global.NineChartCore.installSmoothWheelZoom(indexChart, host, { bars: bars.length })'));
assert(source.includes('options.handleScale.mouseWheel = false;'));
assert(source.includes('options.handleScroll.mouseWheel = false;'));

const prevRaf = global.requestAnimationFrame, prevCancel = global.cancelAnimationFrame;
let nextId = 1;
const queue = new Map();
global.requestAnimationFrame = fn => { const id = nextId++; queue.set(id, fn); return id; };
global.cancelAnimationFrame = id => { queue.delete(id); };
function frame() {
  if (!queue.size) return false;
  const [id, cb] = queue.entries().next().value;
  queue.delete(id); cb(); return true;
}
function settle() {
  let n = 0;
  while (frame() && ++n < 100) {}
  assert(n < 100, 'wheel animation must settle');
}
const events = {};
const element = {
  clientWidth: 600, clientHeight: 400,
  getBoundingClientRect() { return { left: 10, top: 0 }; },
  addEventListener(type, callback, options) { events[type] = { callback, options }; },
  removeEventListener(type) { delete events[type]; }
};
let range = { from: 60, to: 160 };
let draws = 0;
const scale = {
  width() { return 600; },
  getVisibleLogicalRange() { return { ...range }; },
  setVisibleLogicalRange(value) { range = { ...value }; draws++; }
};
const chart = { timeScale() { return scale; } };
const cleanup = core.installSmoothWheelZoom(chart, element, { bars: 300 });
assert.equal(events.wheel.options.passive, false);
function wheel(dy, dx = 0, x = 310, extra = {}) {
  const e = { deltaX: dx, deltaY: dy, deltaMode: 0, clientX: x, cancelable: true,
    target: { closest() { return null; } }, preventDefault() { e.prevented = true; }, ...extra };
  events.wheel.callback(e);
  return e;
}
const first = wheel(-100);
assert.equal(first.prevented, true, 'chart consumes wheel instead of scrolling page');
assert.equal(draws, 0, 'do not set visible range synchronously on every event');
assert.equal(queue.size, 1, 'only one scheduled frame');
frame();
assert(range.to - range.from < 100 && range.to - range.from > 85, 'interpolated first frame, not abrupt jump');
settle();
assert(Math.abs((range.from + range.to) / 2 - 110) < .05, 'zoom anchored beneath pointer');
assert.equal(queue.size, 0);
// Two quick notches should accumulate toward a single target without scheduling two loops.
const spanBefore = range.to - range.from;
wheel(-100); wheel(-100);
assert.equal(queue.size, 1);
settle();
assert(range.to - range.from < spanBefore * 0.9);
const beforePan = { ...range };
wheel(1, 80); settle();
assert(range.from > beforePan.from, 'horizontal trackpad scroll pans to the right');
assert(Math.abs((range.to - range.from) - (beforePan.to - beforePan.from)) < .1);
// Button/controls, click-and-drag, and teardown must not be intercepted.
const before = draws;
wheel(-120, 0, 310, { target: { closest() { return {}; } }, preventDefault() { throw new Error('blocked control'); } });
assert.equal(draws, before);
wheel(-120);
assert.equal(queue.size, 1);
events.pointerdown.callback({});
assert.equal(queue.size, 0, 'manual drag cancels wheel animation');
cleanup();
assert.equal(events.wheel, undefined);
assert.equal(events.pointerdown, undefined);
assert.equal(events.touchstart, undefined);
global.requestAnimationFrame = prevRaf;
global.cancelAnimationFrame = prevCancel;
console.log('chart smooth wheel: ok');
