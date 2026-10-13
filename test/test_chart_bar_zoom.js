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
const unregister = core.registerChart(container, chart, { bars: 700, timeframe: 'day' });
assert.equal(core.zoomBars(container, 0.8), true);
assert.deepEqual(range, { from: 110, to: 190 }, 'larger bars preserve viewport center');
assert.equal(core.zoomBars(container, 1.25), true);
assert.deepEqual(range, { from: 100, to: 200 }, 'smaller bars restore prior span');
assert.equal(core.fitBars(container, 2), true);
assert.deepEqual(range, { from: 196, to: 702 }, 'two-year view shows 504 daily bars plus right offset');
assert.equal(fits, 0);

const weeklyContainer = {};
let weeklyRange = null;
const weeklyChart = { timeScale() { return { getVisibleLogicalRange() { return { from: 0, to: 140 }; }, setVisibleLogicalRange(next) { weeklyRange = next; }, fitContent() {} }; } };
const unregisterWeekly = core.registerChart(weeklyContainer, weeklyChart, { bars: 140, timeframe: 'week' });
assert.equal(core.fitBars(weeklyContainer, 2), true);
assert.deepEqual(weeklyRange, { from: 36, to: 142 }, 'two-year view maps to 104 weekly bars');
unregisterWeekly();
unregister();
assert.equal(core.zoomBars(container, 0.8), false, 'disposed chart cannot receive zoom');
console.log('PASS shared candle width controls and chart cleanup');
