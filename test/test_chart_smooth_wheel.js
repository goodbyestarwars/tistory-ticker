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
function frame(timestamp) {
  if (!queue.size) return false;
  const [id, cb] = queue.entries().next().value;
  queue.delete(id); cb(timestamp); return true;
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
// A direction reversal must respond on the very next frame, not finish the old zoom.
range = { from: 60, to: 160 };
wheel(-200); frame();
const reversingSpan = range.to - range.from;
wheel(40); frame();
assert(range.to - range.from > reversingSpan, 'reverse input responds immediately');
settle();
// Switching from zoom to pan keeps the current scale instead of finishing the zoom.
wheel(-200); frame();
const panSpan = range.to - range.from;
wheel(0, 40); settle();
assert(Math.abs(range.to - range.from - panSpan) < .001);
// Moving the cursor during an active animation anchors the next gesture to the visible candle.
range = { from: 60, to: 160 };
wheel(-100, 0, 160); frame();
const anchor = range.from + .75 * (range.to - range.from);
wheel(-100, 0, 460); settle();
assert(Math.abs(range.from + .75 * (range.to - range.from) - anchor) < .001);
// Equal elapsed time gives equal response on displays with different refresh rates.
function responseAt(hz) {
  events.pointerdown.callback({}); range = { from: 60, to: 160 };
  wheel(-100); frame(0);
  for (let i = 1; i <= hz / 10; i++) frame(i * 1000 / hz);
  return range.to - range.from;
}
const at60 = responseAt(60), at120 = responseAt(120);
assert(Math.abs(at60 - at120) < 1e-8, 'time based response at 60/120Hz');
settle();
// Repeated input remains inside the loaded history and min zoom limits.
for (let i=0;i<100;i++) wheel(-240);
settle(); assert(range.to - range.from >= 12 - .001);
for (let i=0;i<100;i++) wheel(240);
settle(); assert(range.from >= -12 && range.to <= 311);
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

// ---- 네이버·토스식 보강(2026-10-22): 가속, 최신 봉 고정, 드래그 관성 ----
{
  const ev2 = {};
  const el2 = { clientWidth: 600, clientHeight: 400, getBoundingClientRect() { return { left: 10, top: 0 }; },
    addEventListener(type, cb, o) { ev2[type] = { cb, o }; }, removeEventListener(type) { delete ev2[type]; } };
  let r2 = { from: 100, to: 200 };
  const listeners = [];
  const sc2 = { width() { return 600; }, getVisibleLogicalRange() { return { ...r2 }; }, setVisibleLogicalRange(v) { r2 = { ...v }; },
    subscribeVisibleLogicalRangeChange(fn) { listeners.push(fn); }, unsubscribeVisibleLogicalRangeChange(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
  const cl2 = core.installSmoothWheelZoom({ timeScale() { return sc2; } }, el2, { bars: 300 });
  function w2(dy, x, ts) { ev2.wheel.cb({ deltaX: 0, deltaY: dy, deltaMode: 0, clientX: x, timeStamp: ts, cancelable: true, target: { closest() { return null; } }, preventDefault() {} }); }
  // 가속: 같은 노치 수라도 빠르게 이어 돌리면 더 많이 확대된다.
  r2 = { from: 100, to: 200 }; ev2.pointerdown.cb({});
  w2(-100, 310, 1000); settle(); const slowSpan = r2.to - r2.from;
  r2 = { from: 100, to: 200 }; ev2.pointerdown.cb({});
  w2(-100, 310, 5000); w2(-100, 310, 5040); w2(-100, 310, 5080); settle(); const fastSpan = r2.to - r2.from;
  assert(fastSpan < slowSpan * slowSpan / 100 * 0.999, 'three quick notches zoom more than three separate ones would');
  // 최신 봉 고정: 최신 봉이 보이고 커서가 오른쪽 끝 쪽이면 오른쪽 끝이 움직이지 않는다.
  r2 = { from: 200, to: 300 }; ev2.pointerdown.cb({});
  w2(-200, 560, 9000); settle();
  assert(Math.abs(r2.to - 300) < 0.05, 'right edge stays pinned near the latest bar');
  // 관성: 드래그로 오른쪽(과거 방향)으로 밀다 놓으면 속도가 있으면 더 미끄러지고 감속해 멈춘다.
  r2 = { from: 100, to: 200 }; ev2.pointerdown.cb({});
  const perf = global.performance; let clock = 0;
  Object.defineProperty(global, 'performance', { value: { now: () => clock }, configurable: true });
  clock = 0; r2 = { from: 100, to: 200 }; listeners.forEach((fn) => fn());
  clock = 40; r2 = { from: 96, to: 196 }; listeners.forEach((fn) => fn());
  clock = 80; r2 = { from: 92, to: 192 }; listeners.forEach((fn) => fn());
  ev2.pointerup.cb({});
  const releasedAt = r2.from;
  let n = 0; while (frame(n * 16)) { n++; if (n > 400) break; }
  assert(r2.from < releasedAt - 1, 'continues sliding after release');
  assert(n < 400, 'inertia decays and stops');
  // 확대·축소 드래그(폭이 바뀜)와 속도가 없는 드래그는 관성이 없다.
  ev2.pointerdown.cb({}); clock = 0; r2 = { from: 100, to: 200 }; listeners.forEach((fn) => fn());
  clock = 40; r2 = { from: 90, to: 210 }; listeners.forEach((fn) => fn());
  ev2.pointerup.cb({});
  assert.equal(queue.size, 0, 'zoom drag has no inertia');
  ev2.pointerdown.cb({}); clock = 0; r2 = { from: 100, to: 200 }; listeners.forEach((fn) => fn());
  clock = 80; r2 = { from: 100, to: 200 }; listeners.forEach((fn) => fn());
  ev2.pointerup.cb({});
  assert.equal(queue.size, 0, 'still drag has no inertia');
  // 새 입력은 관성을 즉시 끊는다.
  ev2.pointerdown.cb({}); clock = 0; r2 = { from: 100, to: 200 }; listeners.forEach((fn) => fn());
  clock = 40; r2 = { from: 96, to: 196 }; listeners.forEach((fn) => fn()); ev2.pointerup.cb({});
  assert.equal(queue.size, 1);
  ev2.pointerdown.cb({});
  assert.equal(queue.size, 0, 'pointerdown stops inertia');
  cl2();
  assert.equal(listeners.length, 0, 'range subscription released');
  assert.equal(ev2.pointerup, undefined);
  if (perf) Object.defineProperty(global, 'performance', { value: perf, configurable: true });
}

// ---- 마지막 봉 뒤 빈 공간(2026-10-22) ----
{
  const ev3 = {};
  const el3 = { clientWidth: 600, clientHeight: 400, getBoundingClientRect() { return { left: 10, top: 0 }; },
    addEventListener(type, cb, o) { ev3[type] = { cb, o }; }, removeEventListener(type) { delete ev3[type]; } };
  let r3 = { from: 200, to: 300 };
  const subs3 = [];
  const sc3 = { width() { return 600; }, getVisibleLogicalRange() { return { ...r3 }; }, setVisibleLogicalRange(v) { r3 = { ...v }; },
    subscribeVisibleLogicalRangeChange(fn) { subs3.push(fn); }, unsubscribeVisibleLogicalRangeChange() {} };
  const cl3 = core.installSmoothWheelZoom({ timeScale() { return sc3; } }, el3, { bars: 300 });
  function w3(dx) { ev3.wheel.cb({ deltaX: dx, deltaY: 0, deltaMode: 0, clientX: 310, timeStamp: 1, cancelable: true, target: { closest() { return null; } }, preventDefault() {} }); }
  for (let i = 0; i < 40; i++) w3(200);
  settle();
  assert(r3.to > 299 + 12, 'can pan further than 12 bars past the last bar');
  assert(r3.to <= 299 + 100 * 0.75 + 0.05, 'but no further than 75% of the visible span');
  // 이미 한도보다 더 끌어 둔 위치에서 드래그를 놓아도 관성이 되돌려 놓지 않는다.
  const perf2 = global.performance; let clk = 0;
  Object.defineProperty(global, 'performance', { value: { now: () => clk }, configurable: true });
  ev3.pointerdown.cb({});
  r3 = { from: 300, to: 400 }; clk = 0; subs3.forEach((fn) => fn());
  r3 = { from: 306, to: 406 }; clk = 40; subs3.forEach((fn) => fn());
  r3 = { from: 312, to: 412 }; clk = 80; subs3.forEach((fn) => fn());
  ev3.pointerup.cb({});
  const placed = { ...r3 };
  settle();
  assert.deepEqual(r3, placed, 'inertia does not pull a far blank-space position back');
  cl3();
  if (perf2) Object.defineProperty(global, 'performance', { value: perf2, configurable: true });
}
global.requestAnimationFrame = prevRaf;
global.cancelAnimationFrame = prevCancel;
console.log('chart smooth wheel: ok');
