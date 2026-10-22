const assert = require('assert');
const Drawing = require('../js/chart-drawing.js');
const listeners = {}, writes = [];
const ctx = new Proxy({ measureText: t => ({ width: t.length * 6 }) }, { get: (o, k) => k in o ? o[k] : () => {} });
const canvas = {
  style: {}, classList: { toggle() {} }, clientWidth: 600, clientHeight: 400,
  setAttribute() {}, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400 }),
  setPointerCapture() {}, hasPointerCapture: () => false
};
global.document = { createElement: () => canvas };
global.localStorage = { getItem: () => null, setItem: (k, v) => writes.push(JSON.parse(v)) };
const scale = { width: () => 600, coordinateToTime: () => null, coordinateToLogical: () => null };
const controller = Drawing.attach({
  core: { createScope: () => ({ on: (el, name, fn) => { listeners[name] = fn; }, add() {}, resize() {} }) },
  container: { appendChild() {} }, chart: { timeScale: () => scale },
  series: { priceToCoordinate: p => 400 - p, coordinateToPrice: y => 400 - y },
  point: 'timePrice', key: 'TEST', timeframe: 'day', store: { key: () => 'test' }
});
const event = (y, extra = {}) => ({ clientX: 100, clientY: y + 20, button: 0, pointerId: 1, preventDefault() {}, ...extra });
const fire = (name, y, extra) => listeners[name](event(y, extra));
controller.setMode('hline');
fire('pointermove', 150);
assert.equal(controller.shapes.hlinePreview, 250);
assert.equal(controller.shapes.hlines.length, 0);
assert.equal(writes.length, 0, 'preview never persists');
fire('pointerdown', 150);
assert.equal(controller.shapes.hlines.length, 0, 'press alone is not a completed click');
fire('pointerup', 150);
assert.equal(controller.shapes.hlines[0].price, 250, 'blank future chart space accepts horizontal lines');
assert.equal(writes.length, 1);
fire('pointerdown', 150); fire('pointermove', 200); fire('pointerup', 200);
assert.equal(controller.shapes.hlines.length, 1, 'drag moves rather than duplicates');
assert.equal(controller.shapes.hlines[0].price, 200);
assert.equal(writes.at(-1).hlines[0].price, 200);
fire('pointerdown', 200); fire('pointermove', 220); fire('pointercancel', 220);
assert.equal(controller.shapes.hlines[0].price, 200, 'cancel restores the original price');
fire('pointerdown', 100); fire('pointercancel', 100);
assert.equal(controller.shapes.hlines.length, 1, 'cancel creates no line');
fire('pointermove', 100); listeners.mouseleave();
assert.equal(controller.shapes.hlinePreview, null);
fire('pointerdown', 80, { button: 2 }); fire('pointerup', 80);
assert.equal(controller.shapes.hlines.length, 1, 'right click does not create');
fire('pointerdown', 80); fire('pointerup', 500);
assert.equal(controller.shapes.hlines.length, 1, 'outside release does not create');
global.prompt = () => '325';
fire('pointerdown', 190, { clientX: 590 }); fire('pointerup', 190, { clientX: 590 });
assert.equal(controller.shapes.hlines[0].price, 325, 'price-label editing remains available');
controller.setMode(null);
assert.equal(controller.shapes.hlinePreview, null);
console.log('horizontal-line preview, commit, drag, cancel and label editing ok');
