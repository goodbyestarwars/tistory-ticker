const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const anchor = shell.indexOf('  var KST_OFFSET_MS');
const source = shell.slice(shell.lastIndexOf('(function (global)', anchor), shell.indexOf('})(window);', anchor) + 11);
const context = {window: {}};
vm.runInNewContext(source, context);
const hours = context.window.MarketHours;
const cases = [
 ['2026-10-23T16:00:00+09:00', '2026-10-26T00:00:00.000Z'],
 ['2026-10-25T23:00:00+09:00', '2026-10-26T00:00:00.000Z'],
 ['2026-10-26T08:59:59+09:00', '2026-10-26T00:00:00.000Z'],
 ['2026-10-26T09:00:00+09:00', '2026-10-27T00:00:00.000Z'],
 ['2026-10-02T16:00:00+09:00', '2026-10-06T00:00:00.000Z'],
 ['2026-09-23T16:00:00+09:00', '2026-09-28T00:00:00.000Z'],
 ['2026-04-30T16:00:00+09:00', '2026-05-04T00:00:00.000Z'],
 ['2026-06-02T16:00:00+09:00', '2026-06-04T00:00:00.000Z'],
 ['2026-12-24T16:00:00+09:00', '2026-12-28T00:00:00.000Z'],
];
for (const [now, expected] of cases) assert.equal(hours.nextKrRegularOpen(new Date(now)).toISOString(), expected, now);
assert.equal(hours.nextKrRegularOpen(new Date('2026-12-30T16:00:00+09:00')), null);
assert.equal(hours.nextKrRegularOpen(new Date('2027-01-01T00:00:00Z')), null);
console.log('next regular open: 11 weekend/holiday/boundary/unknown-year cases passed');
