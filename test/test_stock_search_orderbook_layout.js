
require('./helpers/common_runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('playwright');

// Deterministic layout check: no production APIs or trading services are called.
function load(file, hook, exports) {
  const window = { addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8').replace(hook, exports + hook), {
    window, document: { readyState: 'loading', addEventListener() {} },
    location: { search: '' }, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval
  });
  return window.test;
}
const search = load('js/stock-search.js', 'global.StockSearch = { init: init };',
  'global.test = { buildShell, renderSummary, renderSessionCandle };');
const book = load('js/order-book.js', 'global.OrderBook = OrderBook;',
  'drawSilhouette = function () {}; global.test = { state, renderBoard };');
const summary = { innerHTML: '' }, session = { innerHTML: '', title: '' };
const host = { querySelector: s => s === '#ssSummary' ? summary : s === '#ssSessionCandle' ? session : null };
search.renderSummary(host, { code: '005930', name: '삼성전자', price: 1234567, changeRate: 1 });
search.renderSessionCandle(host, { open: 1234567, high: 1299999, low: 1200000, current: 1234567 });
assert(!summary.innerHTML.includes('ssSessionCandle'));
const attrs = {};
const board = { innerHTML: '', querySelector: () => null, setAttribute(k,v) { attrs[k]=v; },
  getAttribute(k) { return attrs[k]; }, removeAttribute(k) { delete attrs[k]; } };
book.state.onSummary = () => {};
book.state.liveTradeProvider = 'KIS';
book.state.liveTrades = Array.from({length: 20}, (_, i) => ({time: '093015', price: 1234567, qty: 123456, direction: i % 2 ? 'buy' : 'sell'}));
book.renderBoard({querySelector: () => board}, {
  asks: Array.from({length:10}, (_,i) => ({price:1235000+i*1000,qty:123456})),
  bids: Array.from({length:10}, (_,i) => ({price:1234000-i*1000,qty:123456}))
}, {price:1234567,change:12345,changeRate:1});
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="stock-search">' + search.buildShell() + '</div><style>' +
      fs.readFileSync('css/order-book.css','utf8') + fs.readFileSync('css/stock-search.css','utf8') + '</style>');
    await page.evaluate(({summary,session,board}) => {
      document.querySelector('#ssDetail').hidden = false;
      document.querySelector('#ssSummary').hidden = false;
      document.querySelector('#ssSummary').innerHTML = summary;
      document.querySelector('#ssSessionCandle').innerHTML = session;
      document.querySelector('#order-book').innerHTML = board;
    }, {summary:summary.innerHTML,session:session.innerHTML,board:board.innerHTML});
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width,height:900});
      for (const dark of [false,true]) {
        await page.evaluate(d => document.documentElement.classList.toggle('dark',d),dark);
        const result = await page.evaluate(() => {
          const session = document.querySelector('#ssSessionCandle');
          const list = document.querySelector('.ob-trades-list');
          return {
            insidePanel: session.parentElement.classList.contains('ss-panel-left'),
            aboveLadder: session.getBoundingClientRect().bottom <= document.querySelector('.ob-table').getBoundingClientRect().top,
            summaryOHLC: !!document.querySelector('#ssSummary #ssSessionCandle'),
            rows: list.querySelectorAll('.ob-trade-row').length,
            verticalOverflow: list.scrollHeight > list.clientHeight + 1,
            horizontalOverflow: list.scrollWidth > list.clientWidth + 1,
            overflowY: getComputedStyle(list).overflowY,
            pricesFit: [...session.querySelectorAll('b')].every(el => el.scrollWidth <= el.clientWidth + 1)
          };
        });
        assert(result.insidePanel && result.aboveLadder && !result.summaryOHLC, JSON.stringify(result));
        assert.equal(result.rows,20);
        assert(!result.verticalOverflow && !result.horizontalOverflow && result.pricesFit, JSON.stringify({width,dark,...result}));
        assert.equal(result.overflowY,'visible');
      }
    }
    search.renderSessionCandle(host, {});
    assert.equal((session.innerHTML.match(/—/g)||[]).length,3, 'selection reset clears previous stock prices');
    console.log('PASS OHLC above ladder and all 20 trades without inner scrolling: desktop/mobile/narrow, light/dark');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode=1; });
