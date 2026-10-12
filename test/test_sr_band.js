const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let frames = new Map(), nextFrame = 0, observers = 0, subscriptions = 0;
const calls = [];
const ctx = {
  setTransform() {}, clearRect() {}, fillRect(...a) { calls.push(['band', ...a]); },
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push(['stroke', this.strokeStyle, this.lineWidth]); },
  setLineDash(a) { if (a.length) calls.push(['dash', a.slice()]); },
  measureText(s) { return { width: s.length * 6 }; },
  fillText(s) { calls.push(['label', s, this.fillStyle]); }
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

const referenceBars = barsFor(500);
const baseline = window.NineChartSR.levels(referenceBars);
const shifted = window.NineChartSR.levels(referenceBars, 130);
assert.strictEqual(shifted.price, 130);
assert(shifted.support.every(level => level.price <= 130), 'all levels below the displayed price are support');
assert(shifted.resistance.every(level => level.price > 130), 'all levels above the displayed price are resistance');
assert(baseline.resistance.length && baseline.resistance.some(old => shifted.support.some(level => level.price === old.price)), 'a broken historical resistance is reclassified as support');

const displayResult = {
  support: [
    { price: 163000, low: 162041, high: 164244 },
    { price: 159300, low: 159059, high: 159559 },
    { price: 148000, low: 147441, high: 149159 }
  ],
  resistance: [
    { price: 176300, low: 175659, high: 176941 },
    { price: 181600, low: 180741, high: 182659 }
  ]
};
const displaySeries = { priceToCoordinate: p => 360 - (p - 140000) / 200 };
const displayOff = window.NineChartSR.install(container, chart, displaySeries, displayResult, p => Math.round(p).toLocaleString('en-US'), { isUs: false });
for (const fn of frames.values()) fn();
frames.clear();
const displayLabels = calls.filter(c => c[0] === 'label');
assert(displayLabels.some(c => c[1] === '지지 1 162,000~164,200'), displayLabels.map(c => c[1]).join(', '));
assert(displayLabels.some(c => c[1] === '지지 2 159,100~159,600'), displayLabels.map(c => c[1]).join(', '));
assert.strictEqual(calls.find(c => c[0] === 'dash')[1].join(','), '2,2');
assert(calls.some(c => c[0] === 'stroke' && c[1].endsWith(',0.72)') && c[2] === 1));
assert(displayLabels.some(c => c[2].endsWith(',0.58)')), 'far label uses the lowest distance alpha');
const observerCount = observers, subscriptionCount = subscriptions;
displayOff.update({ support: displayResult.resistance, resistance: displayResult.support });
for (const fn of frames.values()) fn();
frames.clear();
assert.strictEqual(observers, observerCount, 'live price reclassification reuses the ResizeObserver');
assert.strictEqual(subscriptions, subscriptionCount, 'live price reclassification reuses the chart subscription');
displayOff();
console.log('SR bands: 500/1000/2000 bars, labels, axis bounds, cleanup ok');
