const assert = require('node:assert/strict');
const core = require('../js/chart-core.js');

const container = {};
let range = { from: 100, to: 200 };
let fits = 0;
const chart = { timeScale() { return {
  getVisibleLogicalRange() { return range; },
  setVisibleLogicalRange(next) { range = next; },
  fitContent() { fits++; }
}; } };
assert.equal(core.zoomBars(container, 0.8), false, 'unregistered chart is ignored');
const unregister = core.registerChart(container, chart);
assert.equal(core.zoomBars(container, 0.8), true);
assert.deepEqual(range, { from: 110, to: 190 }, 'larger bars preserve viewport center');
assert.equal(core.zoomBars(container, 1.25), true);
assert.deepEqual(range, { from: 100, to: 200 }, 'smaller bars restore prior span');
assert.equal(core.fitBars(container), true);
assert.equal(fits, 1);
unregister();
assert.equal(core.zoomBars(container, 0.8), false, 'disposed chart cannot receive zoom');
console.log('PASS shared candle width controls and chart cleanup');
