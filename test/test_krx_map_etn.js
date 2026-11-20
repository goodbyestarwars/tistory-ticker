// Regression: data/krx_map.js merges the separate ETN pair array into KRX_MAP / KRX_ETF_NAMES for the
// browser only (search, tooltips, news matcher), while keeping every code unique. The VM universe
// regex cannot see ETN pairs; that half is asserted in test/test_sync_listings.py.
// Execute: node test/test_krx_map_etn.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('data/krx_map.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const { KRX_MAP: map, KRX_ETF_NAMES: etfNames, KRX_ETN: etn } = context.window;

assert(Array.isArray(etn) && etn.length > 0, 'KRX_ETN missing');
const etfSet = new Set(etfNames);
for (const [name, code] of etn) {
  assert.equal(map[name], code, 'ETN not merged into KRX_MAP: ' + name);
  assert(etfSet.has(name), 'ETN not ranked as ETF-like: ' + name);
  assert(/^[0-9A-Z]{6}$/.test(code), 'bad ETN code: ' + code);
}

const codes = Object.values(map);
assert.equal(new Set(codes).size, codes.length, 'duplicate codes in merged KRX_MAP');

// Ordinary stocks and ETFs registered by the sync stay searchable and are not ETN.
for (const [name, code] of [['삼성전자', '005930'], ['래블업', '0147B0'], ['동원파츠', '0162D0']]) {
  assert.equal(map[name], code, name);
  assert.equal(etn.some((row) => row[0] === name), false, name + ' must not be ETN');
}
assert.equal(source.includes('�'), false, 'krx_map.js contains replacement characters');
console.log('krx_map ETN merge: ' + etn.length + ' ETN, ' + codes.length + ' unique codes, ok');
