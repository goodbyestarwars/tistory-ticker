// Regression: current-price highlight must not replace or hide an order-book level.
// Run: node test/test_order_book_depth_visibility.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/order-book.js', 'utf8').replace(
  'global.OrderBook = OrderBook;',
  // The SVG line overlay needs browser geometry. It is unrelated to depth/quantity rendering.
  'drawSilhouette = function () {}; global.__obTest = { state, renderBoard, applyRealtimeOrderbook, setBookHint }; global.OrderBook = OrderBook;'
);
const window = { addEventListener() {} };
vm.runInNewContext(source, {
  window, document: { readyState: 'loading', addEventListener() {} },
  setTimeout, clearTimeout, setInterval, clearInterval, Date, Number, Promise
});
const t = window.__obTest;
t.state.code = '123456';
t.state.name = '가상 종목';
t.state.onSummary = function () {};

const askTotal = { textContent: '' };
const bidTotal = { textContent: '' };
const askBar = { style: {} };
const bidBar = { style: {} };
let dominance = '';

function makeRow(side, level) {
  const qty = { textContent: '' }, price = { textContent: '' };
  const delta = { textContent: '', className: '' }, bar = { style: {} };
  return {
    side, level, hidden: false,
    getAttribute(k) { return k === 'data-level' ? String(level) : null; },
    querySelector(s) {
      return s === '.ob-qty' ? qty : s === '.ob-price' ? price :
        s === '.ob-delta' ? delta : s === '.ob-bar-wrap > span' ? bar : null;
    },
    qty, price
  };
}
const board = {
  attrs: {}, rows: [], markup: '', hidden: false,
  set innerHTML(markup) {
    this.markup = markup;
    this.rows = [...markup.matchAll(/<div class="ob-row ob-row-(ask|bid)" data-level="(\d+)"/g)]
      .map(m => makeRow(m[1], Number(m[2])));
  },
  get innerHTML() { return this.markup; },
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
  setAttribute(k, v) { this.attrs[k] = v; },
  removeAttribute(k) { delete this.attrs[k]; },
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
  querySelector(s) {
    if (s === '[data-field="current-row"]') return { setAttribute(k, v) { dominance = v; } };
    if (s === '[data-field="ask-total"]') return askTotal;
    if (s === '[data-field="bid-total"]') return bidTotal;
    if (s === '.ob-footer-bar-ask') return askBar;
    if (s === '.ob-footer-bar-bid') return bidBar;
    const m = /^\.ob-row-(ask|bid)\[data-level="(\d+)"\]$/.exec(s);
    return m ? this.rows.find(row => row.side === m[1] && row.level === Number(m[2])) || null : null;
  },
  querySelectorAll(s) {
    const m = /^\.ob-row-(ask|bid)$/.exec(s);
    return m ? this.rows.filter(row => row.side === m[1]) : [];
  }
};
const container = { querySelector(s) { return s === '#obBoard' ? board : null; } };
const rows = side => board.querySelectorAll('.ob-row-' + side);
const sum = a => a.reduce((n, r) => n + r.qty, 0);

// Reproduces the screenshot: 9 rows were visible but the footer counted 10.
const asks = [
  [17730, 369], [17720, 1093], [17710, 686], [17700, 3326], [17690, 275],
  [17680, 220], [17670, 54], [17660, 219], [17650, 21], [17640, 23]
].map(([price, qty]) => ({ price, qty }));
const bids = [
  [17610, 6], [17600, 123], [17590, 137], [17580, 134], [17570, 88],
  [17560, 288], [17550, 228], [17540, 1115], [17530, 254], [17520, 332]
].map(([price, qty]) => ({ price, qty }));
assert.strictEqual(sum(asks), 6286);
assert.strictEqual(sum(bids), 2705);
const quote = { price: 17620, change: -90, changeRate: -0.51 };

t.renderBoard(container, { asks, bids }, quote);
assert.strictEqual(rows('ask').length, 10);
assert.strictEqual(rows('bid').length, 10);
assert(rows('ask').every(row => !row.hidden));
assert(rows('bid').every(row => !row.hidden));
assert(board.innerHTML.includes('17,730')); // outermost sell level
assert(board.innerHTML.includes('17,520')); // outermost buy level
assert.strictEqual((board.innerHTML.match(/data-field="current-row"/g) || []).length, 1);
assert(board.innerHTML.includes('data-field="ask-total">6,286'));
assert(board.innerHTML.includes('data-field="bid-total">2,705'));
assert.strictEqual(dominance, 'ask');

// KIS websocket sends the sell prices in reverse order; every level must remain visible.
t.state.lastWsAnalysisAt = Date.now();
const wsAsks = asks.slice().reverse().map(r => ({ price: r.price, qty: r.qty }));
const wsBids = bids.slice().reverse().map(r => ({ price: r.price, qty: r.qty }));
wsAsks[wsAsks.length - 1].qty = 400;
wsBids[0].qty = 360;
t.applyRealtimeOrderbook(container, { asks: wsAsks, bids: wsBids });
assert.strictEqual(rows('ask').length, 10);
assert.strictEqual(rows('bid').length, 10);
assert(rows('ask').every(row => !row.hidden));
assert(rows('bid').every(row => !row.hidden));
assert.strictEqual(askTotal.textContent, '6,317');
assert.strictEqual(bidTotal.textContent, '2,733');
assert.strictEqual(rows('ask')[0].qty.textContent, '400');
assert.strictEqual(rows('bid')[9].qty.textContent, '360');

// An oversized API response must show the ten closest asks, not ten farthest asks.
t.renderBoard(container, { asks: [{ price: 17740, qty: 100 }, ...asks], bids }, quote);
assert(!board.innerHTML.includes('17,740'));
assert(board.innerHTML.includes('17,640'));
assert.strictEqual(rows('ask').length, 10);

// If the feed really has fewer levels, render only those; never invent quantities.
t.renderBoard(container, { asks: asks.slice(-3), bids: bids.slice(0, 2) }, quote);
assert.strictEqual(rows('ask').length, 3);
assert.strictEqual(rows('bid').length, 2);
assert(board.innerHTML.includes('data-field="ask-total">263'));
assert(board.innerHTML.includes('data-field="bid-total">129'));

// When no book data exists, keep ten empty slots on each side without fake prices.
t.setBookHint(board, '호가 미수신');
assert.strictEqual((board.innerHTML.match(/ob-row-ask ob-row-unavailable/g) || []).length, 10);
assert.strictEqual((board.innerHTML.match(/ob-row-bid ob-row-unavailable/g) || []).length, 10);


// 호가 매수/가격/매도 3열은 PC·모바일 모두 1 : 1.5 : 1 비율.
// 과거 px 고정폭이 뒤쪽 CSS에서 우선 적용되면 스크린샷처럼 현재가 칸이 다시 좁아진다.
const orderBookCss = fs.readFileSync('css/order-book.css', 'utf8');
const stockSearchCss = fs.readFileSync('css/stock-search.css', 'utf8');
const centerRatio = /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.5fr\)\s+minmax\(0,\s*1fr\)/g;
const checkRatio = (css, expected, name) => {
  const matches = css.match(centerRatio) || [];
  assert.strictEqual(matches.length, expected, name + ' PC/mobile column ratio');
};
checkRatio(orderBookCss, 4, 'order-book');
checkRatio(stockSearchCss, 1, 'stock-search');
assert(!/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\d+px\s+minmax\(0,\s*1fr\)/.test(orderBookCss),
  'order-book fixed center width override must not remain');
assert(!/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\d+px\s+minmax\(0,\s*1fr\)/.test(stockSearchCss),
  'stock-search fixed center width override must not remain');

console.log('order-book 10+10 visible depth: ok');
