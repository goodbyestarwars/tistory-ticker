// Regression: newest eight KOSDAQ stocks resolve by official name and six-character code.
// Run: node test/test_recent_kosdaq_listings.js
'use strict';
require('./helpers/common_runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listings = [
  ['영광', '359410', '영광공작소'],
  ['인텔리빅스', '420610', 'intellivix'],
  ['크리에이츠', '439270', 'creates'],
  ['한화플러스제6호스팩', '0127E0', '한화플러스제6호기업인수목적'],
  ['티앤이코리아', '0053F0', 'TNE코리아'],
  ['에스케이증권제14호기업인수목적', '0205H0', 'SK증권제14호스팩'],
  ['디티에스', '0015M0', 'dts'],
  ['엘리스', '0158S0', '엘리스그룹'],
];

const mapSource = fs.readFileSync('data/krx_map.js', 'utf8');
const mainContext = {window: {}};
vm.runInNewContext(mapSource, mainContext);
const map = mainContext.window.KRX_MAP;
const allCodes = Object.entries(map);
for (const [name, code] of listings) {
  assert.equal(map[name], code, name + ' code mapping missing');
  assert.equal(allCodes.filter(([_, mapped]) => mapped === code).length, 1, code + ' collision');
  assert.equal(mainContext.window.KRX_ETF_NAMES.includes(name), false, name + ' must not be ETF');
}
assert.equal(map['래블업'], '0147B0', 'existing new-listing mapping damaged');
assert.equal(map['삼성전자'], '005930', 'ordinary listing mapping damaged');

function expose(file, marker, exportSpec) {
  const source = fs.readFileSync(file, 'utf8');
  new vm.Script(source, {filename: file}); // Check whole source syntax.
  const exposed = source.replace(marker, '  global.__listingTest = ' + exportSpec + ';\n' + marker);
  assert.notEqual(exposed, source, file + ' test hook missing');
  const context = {
    window: {KRX_MAP: Object.assign({}, map), KRX_ETF_NAMES: [], addEventListener() {}, removeEventListener() {}},
    document: {readyState: 'loading', addEventListener() {}},
  };
  context.window.document = context.document; // Shared NineUI.persistPrefs binds to window.document.
  vm.runInNewContext(exposed, context, {filename: file});
  assert(context.window.__listingTest, file + ' resolver unavailable');
  for (const [name, code] of listings) {
    const fallback = "{ code: '" + code + "', name: '" + name + "', aliases:";
    assert(source.includes(fallback), file + ' fallback missing ' + code);
  }
  return context.window.__listingTest;
}

const panel = expose(
  'js/stock-search-panel.js',
  '  var StockSearchPanel = { init: init,',
  '{ resolveStock, suggestNames, applyDomesticListingFallbacks }'
);
const detail = expose(
  'js/stock-search.js',
  '  global.StockSearchChart = { mount: mountExternalChart, updateQuote: updateLiveChartQuote };',
  '{ resolveDomesticName, applyDomesticListingFallbacks }'
);
const analysis = expose(
  'js/foreign-flow.js',
  '  global.ForeignFlow = ForeignFlow;',
  '{ resolveStock, applyDomesticListingFallbacks }'
);

for (const [name, code, alias] of listings) {
  for (const query of [name, code, code.toLowerCase(), alias]) {
    for (const [label, lookup] of [
      ['side', panel.resolveStock],
      ['detail', detail.resolveDomesticName],
      ['analysis', analysis.resolveStock],
    ]) {
      const item = lookup(query);
      assert(item, label + ' lookup empty for ' + query);
      assert.equal(item.code, code, label + ' code mismatch: ' + query);
      assert.equal(item.name, name, label + ' name mismatch: ' + query);
    }
    assert(panel.suggestNames(query).includes(name), 'side suggestion missing: ' + query);
  }
}
assert.equal(panel.resolveStock('삼성전자').code, '005930');
assert.equal(detail.resolveDomesticName('삼성전자').code, '005930');
assert.equal(analysis.resolveStock('삼성전자').code, '005930');
const stockSource = fs.readFileSync('js/stock-search.js', 'utf8');
assert(stockSource.includes('it.price = null; it.change = null; it.changeRate = null;'), 'no-quote state changed');
console.log('PASS eight new KOSDAQ listings: 8 map rows, 3 lookup screens, name/code/alias suggestions, prior stocks');
