// Regression: a newly listed six-character alphanumeric Korean symbol is searchable
// in top/side, detail and analysis views even before quote/index feeds include it.
// Execute: node test/test_new_listing_0013y0.js
'use strict';
require('./helpers/common_runtime');

const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const mapSrc = fs.readFileSync('data/krx_map.js', 'utf8');
const context = {window: {}};
vm.runInNewContext(mapSrc, context);
assert.equal(context.window.KRX_MAP['엠에스바이오'], '0013Y0');
assert.equal(context.window.KRX_ETF_NAMES.includes('엠에스바이오'), false);
const files = ['js/stock-search.js', 'js/stock-search-panel.js', 'js/foreign-flow.js'];
for (const name of files) {
  const source = fs.readFileSync(name, 'utf8');
  new vm.Script(source, {filename: name});
  assert(source.includes("{ code: '0013Y0', name: '엠에스바이오' }") ||
    source.includes("{ code: '0013Y0', name: '엠에스바이오', aliases:"), name + ': no fallback');
  assert(source.includes('applyDomesticListingFallbacks()'), name + ': runtime map not applied');
}
const stockSrc = fs.readFileSync('js/stock-search.js', 'utf8');
assert(stockSrc.includes('/^[0-9A-Z]{6}$/i.test(String(state.selectedCode ||'), 'detail excludes alphanumeric code from chart ranges');
assert(stockSrc.includes('신규상장 종목의 시세가 아직 수신되지 않았습니다.'),'missing explicit pending quote state');
assert(stockSrc.includes('it.price = null; it.change = null; it.changeRate = null;'),'pending quote may be fabricated');
const chartSrc = fs.readFileSync('js/chart-data.js', 'utf8');
new vm.Script(chartSrc);
assert(chartSrc.includes('!/^[0-9A-Z]{6}$/i.test(code)'), 'chart date ranges still reject alphanumeric tickers');
assert(/^[0-9A-Z]{6}$/i.test('0013Y0'));
assert(!/^[0-9A-Z]{6}$/i.test('0013Y0&'));
console.log('new KOSDAQ listing 0013Y0 lookup and chart guards: ok');
