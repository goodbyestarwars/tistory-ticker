const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let frames = new Map(), nextFrame = 0, observers = 0, subscriptions = 0;
const calls = [];
const ctx = {
  setTransform() {}, clearRect() {}, fillRect(...a) { calls.push(['band', ...a]); },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
  measureText(s) { return { width: s.length * 6 }; },
  fillText(s) { calls.push(['label', s]); }
};
const doc = {
  body: { contains: () => true }, documentElement: { classList: { contains: () => false } },
  head: { appendChild() {} }, getElementById: () => ({}),
  createElement: () => ({ className: '', setAttribute() {}, getContext: () => ctx, remove() {} })
};
const window = {
  document: doc, devicePixelRatio: 1, getComputedStyle: () => ({ position: 'relative' }),
  requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
  cancelAnimationFrame(id) { frames.delete(id); }, setTimeout: () => 1, clearTimeout() {},
  ResizeObserver: class { constructor() { observers++; } observe() {} disconnect() { observers--; } }
};
const scope = { window, document: doc, ResizeObserver: window.ResizeObserver, Map, Number };
vm.runInNewContext(fs.readFileSync('js/chart-sr.js', 'utf8'), scope);
const chart = {
  priceScale: () => ({ width: () => 65 }),
  timeScale: () => ({ subscribeVisibleLogicalRangeChange() { subscriptions++; }, unsubscribeVisibleLogicalRangeChange() { subscriptions--; } })
};
const container = {
  clientWidth: 390, clientHeight: 420, style: {}, firstElementChild: { classList: { add() {} } },
  insertBefore() {}
};
const series = { priceToCoordinate: p => 420 - p * 3 };
const barsFor = n => Array.from({ length: n }, (_, i) => ({
  high: 112 + 12 * Math.sin(i / 9), low: 108 + 12 * Math.sin(i / 9),
  close: 110 + 12 * Math.sin(i / 9), volume: 1000
}));
for (const n of [500, 1000, 2000]) {
  const levels = window.NineChartSR.levels(barsFor(n));
  assert(levels.support.length <= 3 && levels.resistance.length <= 3);
  const off = window.NineChartSR.install(container, chart, series, levels, p => Math.round(p).toLocaleString('en-US'));
  for (const fn of frames.values()) fn();
  frames.clear();
  const labels = calls.filter(c => c[0] === 'label').map(c => c[1]);
  assert(labels.every(s => /^(지지|저항) [1-3] [\d,]+~[\d,]+$/.test(s)), labels.join(', '));
  assert(calls.filter(c => c[0] === 'band').every(c => c[3] <= 325));
  off();
  assert.strictEqual(observers, 0);
  assert.strictEqual(subscriptions, 0);
  calls.length = 0;
}
console.log('SR bands: 500/1000/2000 bars, labels, axis bounds, cleanup ok');
