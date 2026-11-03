// Regression: KOSDAQ new listing 래블업 (0147B0) is searchable by code,
// official name and commonly typed alternate spelling in the existing UI.
// Execute: node test/test_new_listing_0147b0.js
'use strict';
require('./helpers/common_runtime');

const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const mapSrc = fs.readFileSync('data/krx_map.js', 'utf8');
const mapContext = {window: {}};
vm.runInNewContext(mapSrc, mapContext);
assert.equal(mapContext.window.KRX_MAP['래블업'], '0147B0');
assert.equal(mapContext.window.KRX_ETF_NAMES.includes('래블업'), false);

const listing = "{ code: '0147B0', name: '래블업', aliases: '레블업 lablup' }";
for (const file of ['js/stock-search-panel.js', 'js/stock-search.js', 'js/foreign-flow.js']) {
  const source = fs.readFileSync(file, 'utf8');
  new vm.Script(source, {filename: file});
  assert(source.includes(listing), file + ': missing new-listing fallback');
  assert(source.includes('applyDomesticListingFallbacks()'), file + ': does not apply fallback');
}

const panelSrc = fs.readFileSync('js/stock-search-panel.js', 'utf8');
const panelContext = {
  window: {KRX_MAP: {}},
  document: {readyState: 'loading', addEventListener() {}},
};
const exposedPanel = panelSrc.replace(
  '  var StockSearchPanel = { init: init,',
  '  global.__listingTest = { resolveStock, suggestNames, applyDomesticListingFallbacks };\n  var StockSearchPanel = { init: init,'
);
assert.notEqual(exposedPanel, panelSrc, 'panel test hooks unavailable');
vm.runInNewContext(exposedPanel, panelContext);
const panel = panelContext.window.__listingTest;
for (const q of ['0147B0', '0147b0', '래블업', '레블업', 'lablup']) {
  const resolved = panel.resolveStock(q);
  assert.equal(resolved.code, '0147B0', 'panel code lookup ' + q);
  assert.equal(resolved.name, '래블업', 'panel name lookup ' + q);
  assert(panel.suggestNames(q).includes('래블업'), 'panel suggestion ' + q);
}

const stockSrc = fs.readFileSync('js/stock-search.js', 'utf8');
assert(stockSrc.includes('var listing = DOMESTIC_LISTING_FALLBACKS.find'), 'detail alias route missing');
assert(stockSrc.includes('신규상장 종목의 시세가 아직 수신되지 않았습니다.'), 'pending quote hint missing');
assert(stockSrc.includes('it.price = null; it.change = null; it.changeRate = null;'), 'missing price must remain null');

const analysisSrc = fs.readFileSync('js/foreign-flow.js', 'utf8');
assert(analysisSrc.includes('String(row.aliases ||'), 'analysis alias route missing');
assert(/^[0-9A-Z]{6}$/i.test('0147B0'));
console.log('Lablup 0147B0 search, aliases, analysis fallback and syntax: ok');
