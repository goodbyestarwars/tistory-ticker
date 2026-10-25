
require('./helpers/common_runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/home-realtime-table.js', 'utf8');
const updateSource = source.slice(source.indexOf('  function updateRow('), source.indexOf('  function fetchBoard(', source.indexOf('  function updateRow(')));
let nextTimer = 0;
const timers = new Map();
const classSet = new Set();
const target = {
  classList: {
    contains: name => classSet.has(name),
    add: name => classSet.add(name),
    remove: (...names) => names.forEach(name => classSet.delete(name))
  }
};
const cell = { querySelector: () => target };
let visible = true;
let item = { code: '005930', change_rate: -3, price: 100 };
const row = { querySelector: () => cell };
const state = {
  mount: { querySelector: () => visible ? row : null },
  data: { sections: { market: [item] }, rows: [] }
};
const context = {
  state, cssEscape: value => value, number: value => value == null ? null : Number(value),
  splitFlapCell() {}, priceCellInner() { return ''; }, rateCell() { return ''; },
  global: {
    getComputedStyle: () => ({ display: 'inline' }),
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  }
};
vm.createContext(context);
vm.runInContext(updateSource, context);
function tick(rate) {
  context.updateRow('005930', { price: 100, changeRate: rate });
  assert.equal(classSet.has('hrt-pill-up'), rate > 0);
  assert.equal(classSet.has('hrt-pill-down'), rate < 0);
}
for (const rate of [-2, -5, 3, 2, 5, -1, 1, -1, 0]) tick(rate);
item.change_rate = null;
tick(-1);
tick(1);
const stale = [...timers.values()][0];
for (let i = 0; i < 12; i++) tick(i % 2 ? -1 : 1);
assert.equal(timers.size, 1, 'rapid ticks leave only the latest timer');
stale();
assert.equal(classSet.has('hrt-pill-down'), true, 'stale timer cannot clear latest tone');
const latest = [...timers.values()][0];
visible = false;
context.updateRow('005930', { price: 100, changeRate: 3 });
assert.equal(classSet.has('hrt-pill-down'), true, 'offscreen row is untouched');
latest();
assert.equal(classSet.has('hrt-pill-down'), false, 'latest timer clears the highlight');
console.log('PASS realtime rate sign, 12 rapid updates, hidden row and timer cleanup');
