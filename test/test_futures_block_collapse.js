const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/kospi-futures.js', 'utf8');
const start = source.indexOf('  function wireCollapseToggles(container) {');
const end = source.indexOf('\n  function init()', start);
assert.ok(start > 0 && end > start);
function classes() {
  const values = new Set();
  return { contains: name => values.has(name), toggle(name, on) { if (on) values.add(name); else values.delete(name); } };
}
const states = { day: false, night: true };
const body = { hidden: false };
const block = { classList: classes(), querySelector: () => body };
const daySection = { classList: classes() };
function button(key) {
  return { textContent: '', attrs: { 'data-chart-key': key },
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
    closest() { return block; },
    addEventListener(type, handler) { this.click = handler; } };
}
const all = button('futures'), day = button('day');
const redraws = [], destroys = [];
const context = { CHARTS: [{ key: 'day' }, { key: 'night' }],
  loadCollapsed: key => !!states[key], saveCollapsed: (key, value) => { states[key] = value; },
  renderChartPanel: chart => redraws.push(chart.key), destroyChart: key => destroys.push(key) };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.wireCollapseToggles({ querySelectorAll: () => [all, day], querySelector: () => daySection });

all.click();
assert.equal(body.hidden, true);
assert.equal(states.futures, true);
assert.equal(all.attrs['aria-expanded'], 'false');
assert.deepEqual(redraws, []);
assert.deepEqual([states.day, states.night], [false, true]);
all.click();
assert.equal(body.hidden, false);
assert.equal(all.attrs['aria-expanded'], 'true');
assert.equal(all.textContent, '숨기기');
assert.deepEqual(redraws, ['day']); // A separately hidden night chart stays hidden.
assert.deepEqual(destroys, ['day']);
assert.deepEqual([states.day, states.night], [false, true]);
day.click();
assert.equal(states.day, true);
all.click(); all.click();
assert.equal(redraws.length, 1); // Neither hidden child is recreated.
assert.equal(states.day, true);
assert.equal(states.night, true);
console.log('PASS: futures group collapse/reopen, saved state, aria, individual states and visible-chart redraw');
