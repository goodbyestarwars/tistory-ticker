const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/home-switch-countdown.js'), 'utf8');
function boot(bodyId) {
  const intervals = [], events = [];
  let placeholder = null;
  const forbidden = () => { throw new Error('Unexpected floating widget creation'); };
  const document = {
    body: bodyId ? { id: bodyId, appendChild: forbidden } : null,
    hidden: false,
    createElement: forbidden,
    querySelector(selector) {
      assert.equal(selector, '.home-dashboard .home-market-toolbar > .home-switch-countdown');
      return placeholder;
    },
    addEventListener: (event, callback) => events.push({ event, callback })
  };
  vm.runInNewContext(source, {
    document,
    window: { addEventListener: (event, callback) => events.push({ event, callback }) },
    setInterval: (callback, ms) => { assert.equal(ms, 1000); intervals.push(callback); }
  });
  return { intervals, events, show: node => { placeholder = node; } };
}
function clock() {
  return {
    isConnected: true, hidden: false, innerHTML: '',
    setAttribute() {},
    querySelector: () => ({ textContent: '' }),
    querySelectorAll: () => []
  };
}

for (const id of ['tt-body-page', 'tt-body-entry', 'tt-body-category', null]) {
  const page = boot(id);
  assert.equal(page.intervals.length, 0, `${id}: no background countdown timer`);
  assert.equal(page.events.length, 0, `${id}: no countdown listeners`);
}
const home = boot('tt-body-index');
assert.equal(home.intervals.length, 1);
assert.equal(home.events.length, 2);
home.intervals[0](); // Async dashboard is still absent: never append to body.
const first = clock();
home.show(first);
home.intervals[0]();
assert.match(first.innerHTML, /hsc-clock/);
assert.equal(first.hidden, true, 'Missing calendar stays hidden');
first.isConnected = false;
home.show(null);
home.intervals[0]();
const replacement = clock();
home.show(replacement);
home.intervals[0]();
assert.match(replacement.innerHTML, /hsc-clock/, 'Rebind after dashboard replacement');
console.log('PASS: non-home exclusion, async placeholder, remount, no floating fallback');
