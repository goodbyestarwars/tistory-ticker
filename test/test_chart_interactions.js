const assert = require('assert');
const core = require('../js/chart-core.js');

const bars = Array.from({ length: 25 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, close: i + 1 }));
const bands = core.bollingerPoints(bars, 20, 2);
assert.equal(bands.length, 6);
assert.equal(bands[0].middle, 10.5);
assert.ok(Math.abs(bands[0].upper - (10.5 + 2 * Math.sqrt(33.25))) < 1e-9);
assert.ok(Math.abs(bands[0].lower - (10.5 - 2 * Math.sqrt(33.25))) < 1e-9);
assert.equal(bands[5].middle, 15.5);
const withGap = bars.map(bar => ({ ...bar }));
withGap[2].close = null;
assert.equal(core.bollingerPoints(withGap, 20, 2).length, 3); // 결측일이 창 밖으로 나가면 다시 계산

const listeners = {};
const frames = [];
global.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
global.cancelAnimationFrame = () => {};
global.addEventListener = (name, fn) => { listeners[`window:${name}`] = fn; };
global.removeEventListener = name => { delete listeners[`window:${name}`]; };
const container = {
  clientHeight: 400,
  style: {},
  addEventListener(name, fn) { listeners[name] = fn; },
  removeEventListener(name) { delete listeners[name]; }
};
let scaleReset = false;
const chart = {
  addSeries(type, options) {
    return { options, applyOptions(next) { this.options = { ...this.options, ...next }; }, coordinateToPrice(y) { return 200 - y; } };
  },
  removeSeries() {},
  priceScale() { return { applyOptions(options) { if (options.autoScale) scaleReset = true; } }; }
};
let drawing = false;
const detach = core.installVerticalPan(chart, container, { priceSeries: () => candle, isDrawing: () => drawing });
const candle = chart.addSeries('candle', {});
assert.equal(container.style.touchAction, 'pan-y', 'chart must allow mobile vertical page scroll');
const origin = () => candle.options.autoscaleInfoProvider(() => ({ priceRange: { minValue: 0, maxValue: 100 } })).priceRange;
assert.deepEqual(origin(), { minValue: 0, maxValue: 100 });
listeners.pointerdown({ button: 0, pointerId: 1, clientY: 100, target: {} });
listeners.pointermove({ pointerId: 1, clientY: 120 });
frames.shift()();
assert.deepEqual(origin(), { minValue: 20, maxValue: 120 });
// Touch must not trigger the desktop vertical price-pan override.
listeners['window:pointerup']({ pointerId: 1 });
listeners.pointerdown({ button: 0, pointerType: 'touch', pointerId: 2, clientY: 100, target: {} });
listeners.pointermove({ pointerId: 2, clientY: 160 });
assert.deepEqual(origin(), { minValue: 20, maxValue: 120 }, 'touch does not shift price axis');
drawing = true;
listeners.pointermove({ pointerId: 1, clientY: 140 });
assert.deepEqual(origin(), { minValue: 20, maxValue: 120 });
drawing = false;
listeners.dblclick({});
frames.shift()();
assert.deepEqual(origin(), { minValue: 0, maxValue: 100 });
assert.equal(scaleReset, true);
detach();
assert.equal(container.style.touchAction, undefined, 'touch action restored on teardown');
assert.equal(listeners.pointermove, undefined);
console.log('chart interactions ok');
