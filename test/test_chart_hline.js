const assert = require('assert');
const Drawing = require('../js/chart-drawing.js');
const listeners = {}, captured = {}, writes = [];
const ctx = new Proxy({ measureText: t => ({ width: t.length * 6 }) }, { get: (o, k) => k in o ? o[k] : () => {} });
const canvas = {
  style: {}, classList: { toggle() {} }, clientWidth: 600, clientHeight: 400,
  setAttribute() {}, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400 }),
  setPointerCapture() {}, hasPointerCapture: () => false
};
global.document = { createElement: () => canvas };
global.localStorage = { getItem: () => null, setItem: (k, v) => writes.push(JSON.parse(v)) };
const scale = {
  width: () => 600, coordinateToTime: x => x >= 0 && x <= 600 ? x : null,
  timeToCoordinate: t => t, coordinateToLogical: () => null
};
const container = { appendChild() {}, style: {}, setPointerCapture() {}, hasPointerCapture: () => false };
const controller = Drawing.attach({
  core: { createScope: () => ({ on: (el, name, fn) => { (el === container ? captured : listeners)[name] = fn; }, add() {}, resize() {} }) },
  container, chart: { timeScale: () => scale },
  series: { priceToCoordinate: p => 400 - p, coordinateToPrice: y => 400 - y },
  point: 'timePrice', key: 'TEST', timeframe: 'day', store: { key: () => 'test' }
});
const event = (y, extra = {}) => ({ clientX: 100, clientY: y + 20, button: 0, pointerId: 1, preventDefault() {}, ...extra });
const fire = (name, y, extra) => {
  let stopped = false;
  const e = event(y, { stopPropagation() { stopped = true; }, ...extra });
  if (captured[name]) captured[name](e);
  if (!stopped && listeners[name]) listeners[name](e);
};
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
assert.equal(canvas.ncDrawingHit(600, 210), true, 'label on the price axis is claimed by the drawing layer');
assert.equal(canvas.ncDrawingHit(600, 120), false, 'empty axis space stays with price-axis drag');
global.prompt = () => '325';
fire('pointerdown', 190, { clientX: 590 }); fire('pointerup', 190, { clientX: 590 });
assert.equal(controller.shapes.hlines[0].price, 325, 'price-label editing remains available');
controller.setMode(null);
assert.equal(controller.shapes.hlinePreview, null);
assert.equal(canvas.ncDrawingHit(600, 210), false, 'outside hline mode the axis keeps its drag');
const right = { button: 2 };
let n = writes.length;
fire('pointerdown', 75, right);
let earlyMenu = false;
fire('contextmenu', 75, { ...right, preventDefault() { earlyMenu = true; } });
assert(earlyMenu, 'context menu before release does not delete a possible drag');
fire('pointermove', 95, right);
assert.equal(controller.shapes.hlines[0].price, 325, 'preview never changes the saved model');
assert.equal(writes.length, n, 'preview does not persist');
fire('pointerup', 105, right);
fire('contextmenu', 105, right);
assert.equal(controller.shapes.hlines[0].price, 295);
assert.equal(writes.length, ++n, 'drop persists once');
fire('pointerdown', 105, right); fire('pointermove', 130, right); fire('pointercancel', 130, right);
assert.equal(controller.shapes.hlines[0].price, 295);
assert.equal(writes.length, n);

controller.setMode('line');
fire('pointerdown', 200);
fire('pointerup', 235, { clientX: 170 });
assert.equal(writes.length, ++n);
fire('pointerdown', 200, right); fire('pointermove', 215, { ...right, clientX: 120 });
fire('pointerup', 215, { ...right, clientX: 120 });
assert.deepEqual(controller.shapes.lines[0], {start:{time:110,price:185},end:{time:180,price:150}});
assert.equal(controller.mode(), 'line', 'drag preserves the active drawing tool');
assert.equal(writes.length, ++n);

controller.shapes.boxes.push({start:{time:240,price:200},end:{time:300,price:140},label:'keep'});
fire('pointerdown', 200, { ...right, clientX: 270 });
fire('pointerup', 220, { ...right, clientX: 280 });
assert.deepEqual(controller.shapes.boxes[0], {start:{time:250,price:180},end:{time:310,price:120},label:'keep'});
assert.equal(writes.length, ++n);
fire('pointerdown', 105, right); fire('pointerup', 105, right);
assert.equal(controller.shapes.hlines.length, 0, 'short right click still erases one drawing');
assert.equal(controller.shapes.lines.length, 1);
assert.equal(writes.length, ++n);
controller.setMode(null);
let prevented = false;
fire('pointerdown', 75, right);
fire('contextmenu', 75, { ...right, preventDefault() { prevented = true; } });
assert.equal(prevented, false, 'default cursor keeps the normal context menu');
console.log('horizontal-line editing, right-button move, cancellation and single-click deletion ok');

