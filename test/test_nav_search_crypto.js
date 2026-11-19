// Regression: 상단 전역 검색에서 비트코인·이더리움·테더를 찾아 종목 화면의 CRYPTO 차트로 이동한다(2026-11-20).
// Execute: node test/test_nav_search_crypto.js
'use strict';
require('./helpers/common_runtime');

const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const panelSrc = fs.readFileSync('js/stock-search-panel.js', 'utf8');
const exposed = panelSrc.replace(
  '  var StockSearchPanel = { init: init,',
  '  global.__cryptoTest = { resolveStock, indexSearchRows, buildRow, fetchRates };\n  var StockSearchPanel = { init: init,'
);
assert.notEqual(exposed, panelSrc, 'panel test hooks unavailable');
const quoteCalls = [];
const context = {
  window: { KRX_MAP: {}, NineAPI: { domesticQuotes(codes) { quoteCalls.push(codes); return Promise.resolve([]); } } },
  document: { readyState: 'loading', addEventListener() {} },
};
vm.runInNewContext(exposed, context);
const panel = context.window.__cryptoTest;

for (const [q, code] of [['비트코인', 'CRYPTO:BTC'], ['btc', 'CRYPTO:BTC'], ['BTC', 'CRYPTO:BTC'], ['KRW-BTC', 'CRYPTO:BTC'],
  ['이더리움', 'CRYPTO:ETH'], ['eth', 'CRYPTO:ETH'], ['테더', 'CRYPTO:USDT'], ['usdt', 'CRYPTO:USDT']]) {
  assert.equal(panel.resolveStock(q).code, code, 'resolve ' + q);
}
const rows = panel.indexSearchRows('비트');
assert.equal(rows[0].code, 'CRYPTO:BTC');
assert.equal(rows[0].market, 'crypto');
assert.equal(panel.indexSearchRows('코스피')[0].code, 'INDEX:KOSPI', 'index search unchanged');

const html = panel.buildRow('CRYPTO:BTC', '비트코인', 0, 'crypto');
assert(html.includes('data-code="CRYPTO:BTC"'));
assert(html.includes('>BTC</span>'), 'symbol shown');
assert(!html.includes('nav-search-fav-btn'), 'crypto must not offer watchlist favorite');

panel.fetchRates(['CRYPTO:BTC']);
assert.equal(quoteCalls.length, 0, 'crypto must not call domestic quote API');

// 이동 대상인 종목 화면이 같은 코드를 처리한다.
const stockSrc = fs.readFileSync('js/stock-search.js', 'utf8');
assert(stockSrc.includes("if (/^CRYPTO:/i.test(code)) { runSearch(container, code); return; }"), 'stock-search CRYPTO url route missing');
console.log('nav search crypto (BTC/ETH/USDT) resolve, rows, no favorite/quote: ok');
