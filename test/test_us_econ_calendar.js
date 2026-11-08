'use strict';
// US economic release calendar data: KST conversion, ordering and the 2026-11-09 expansion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('data/us-econ-calendar.js', 'utf8'), {window});
const events = window.US_ECON_CALENDAR.events;

test('events are sorted by KST start and unique per code/date', () => {
  const keys = new Set();
  events.forEach((event, i) => {
    assert.match(event.start, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\+09:00$/);
    if (i) assert.ok(events[i - 1].start <= event.start, event.code + ' ' + event.start);
    const key = event.code + ' ' + event.us_date;
    assert.ok(!keys.has(key), key);
    keys.add(key);
  });
});

test('November 2026 first week includes ISM, ADP, jobless claims and payrolls', () => {
  const week = events.filter(e => e.us_date >= '2026-11-02' && e.us_date <= '2026-11-06').map(e => e.code);
  ['ISM_MFG', 'JOLTS', 'ISM_SVC', 'ADP', 'CLAIMS', 'NFP'].forEach(code => assert.ok(week.includes(code), code));
});

test('Central-time FRED releases convert across the 2026-11-01 DST change', () => {
  const find = (code, date) => events.find(e => e.code === code && e.us_date === date).start;
  assert.equal(find('CLAIMS', '2026-10-29'), '2026-10-29T21:30:00+09:00');
  assert.equal(find('CLAIMS', '2026-11-05'), '2026-11-05T22:30:00+09:00');
  assert.equal(find('ISM_MFG', '2026-11-02'), '2026-11-03T00:00:00+09:00');
});

test('calendar marks econ releases past their official time as reported', () => {
  const src = fs.readFileSync('js/stock-calendar.js', 'utf8');
  assert.match(src, /status: Date\.parse\(item\.start\) <= Date\.now\(\) \? 'reported' : 'scheduled'/);
});
