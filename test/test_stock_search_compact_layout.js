'use strict';
// Regression: selecting one search result must show one detail header, while
// the user can still reopen the search table to access the favorite action.
// Run: node test/test_stock_search_compact_layout.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/stock-search.js', 'utf8');
const css = fs.readFileSync('css/stock-search.css', 'utf8');
const hook = 'global.StockSearch = { init: init };';
assert(source.includes(hook));
const testable = source.replace(hook,
  'selectStock = function (_container, item) { state.selectedCode = item.code; state.selectedName = item.name; };'
  + ' global.__test = { renderResults: renderResults, state: state }; ' + hook);
const window = { addEventListener() {} };
const document = { readyState: 'loading', currentScript: null, addEventListener() {} };
vm.runInNewContext(testable, {
  window, document, location: { search: '' }, URLSearchParams
});
let html = '';
let handlers = {};
const button = { addEventListener(type, listener) { handlers[type] = listener; } };
const selected = { classList: { add() {} } };
const results = {
  get innerHTML() { return html; },
  set innerHTML(value) { html = value; handlers = {}; },
  querySelector(selector) {
    if (selector === '.ss-results-toggle' && html.includes('ss-results-toggle')) return button;
    if (selector === '.ss-result-row' && html.includes('ss-result-row')) return selected;
    return null;
  },
  querySelectorAll() { return []; }
};
const container = { querySelector(selector) { return selector === '#ssResults' ? results : null; } };
const stock = {
  code: '101490', name: '에스앤에스텍', price: 43350,
  changeRate: 1.76, volume: 83834, tradingValue: 3650000000, sectors: []
};
window.__test.renderResults(container, [stock]);
assert.equal(window.__test.state.resultsCollapsed, true);
assert(!html.includes('ss-results-table'));
assert(!html.includes(stock.name));
assert(html.includes('목록 다시 보기'));
assert.equal(typeof handlers.click, 'function');
// Explicit user expansion must not immediately trigger auto-collapse again.
handlers.click();
assert.equal(window.__test.state.resultsCollapsed, false);
assert(html.includes('ss-results-table'));
assert(html.includes(stock.name));
assert.equal(typeof handlers.click, 'function');
handlers.click();
assert.equal(window.__test.state.resultsCollapsed, true);
assert(!html.includes('ss-results-table'));
// No loss of the desktop split layout or of mobile one-column behavior.
assert(css.includes('clamp(308px, 25%, 396px)'));
assert(css.includes('.ss-panel-head { padding-inline: 14px; }'));
assert(css.includes('@media (max-width: 860px)'));
assert(css.includes('width: auto;'));
console.log('stock-search compact header/layout: ok');
