// Home US third index follows the official NYSE regular session calendar.
// Run: node test/test_home_us_third_index.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const shell = fs.readFileSync('js/skin-shell.js', 'utf8');
const main = fs.readFileSync('js/skin-main.js', 'utf8');
const hoursAnchor = shell.indexOf('시장 시간 단일 기준');
const hoursStart = shell.indexOf('(function (global) {', hoursAnchor);
const hoursEnd = shell.indexOf('})(window);', hoursStart) + '})(window);'.length;
const selectorStart = main.indexOf('    function usThirdIndexState(now) {');
const selectorEnd = main.indexOf('\n    }\n', selectorStart) + '\n    }'.length;
assert.ok(hoursAnchor >= 0 && hoursStart >= 0 && hoursEnd > hoursStart, 'common MarketHours exists');
assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, 'third-card selector exists');

const context = { window: {}, Date, Intl };
vm.createContext(context);
vm.runInContext(shell.slice(hoursStart, hoursEnd), context);
vm.runInContext(main.slice(selectorStart, selectorEnd), context);
const selected = timestamp => vm.runInContext('usThirdIndexState(new Date(' + JSON.stringify(timestamp) + '))', context);

[
  ['EST before open', '2026-11-04T14:29:00Z', 'DOW'],
  ['EST at open', '2026-11-04T14:30:00Z', 'SOX'],
  ['EST before close', '2026-11-04T20:59:00Z', 'SOX'],
  ['EST at close', '2026-11-04T21:00:00Z', 'DOW'],
  ['EDT before open', '2026-07-06T13:29:00Z', 'DOW'],
  ['EDT at open', '2026-07-06T13:30:00Z', 'SOX'],
  ['NYSE holiday', '2026-11-26T15:00:00Z', 'DOW'],
  ['early close before', '2026-11-27T17:59:00Z', 'SOX'],
  ['early close at 13 ET', '2026-11-27T18:00:00Z', 'DOW'],
  ['weekend', '2026-11-07T15:00:00Z', 'DOW']
].forEach(([label, date, key]) => assert.equal(selected(date).key, key, label));

assert.equal(selected('2026-11-04T14:29:00Z').label, '다우존스30 선물(CME)');
assert.equal(selected('2026-11-04T14:30:00Z').label, '필라델피아 반도체');
assert.match(main, /thirdCard\.setAttribute\('data-home-index', third\.key\)/, 'slot identity updates with source');
assert.match(main, /thirdItem && thirdItem\.chart, third\.key/, 'chart switches to selected series');
assert.match(main, /SP500%2CDOW%2CKOSPI200_NIGHT/, 'fallback request includes DOW');
assert.match(main, /key === 'DOW' && homeSessionCharts\.DOW/, 'DOW 30-minute chart requires actual observed data');
console.log('home US third index: 10 session cases + UI contracts passed');
