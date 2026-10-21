'use strict';
// Real DOM regression. PLAYWRIGHT_MODULE can point to the desktop bundled runtime.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<div id="stock-search"></div>');
    for (const f of ['style.css', 'css/order-book.css', 'css/stock-search.css']) await page.addStyleTag({ path: path.join(root, f) });
    let src = fs.readFileSync(path.join(root, 'js/stock-search.js'), 'utf8');
    src = src.replace('global.StockSearch = { init: init };', `
      global.__ui = { state, buildShell, renderResults, renderSessionCandle, applyRealtimeQuote };
      loadChart = function () { global.__chartLoads = (global.__chartLoads || 0) + 1; };
      loadDomesticNews = function () {};
      wirePanelResize = function () {};
      wireChartTabs = function () {};
      fetchJson = function () { return Promise.resolve({ reason: '실적 개선 기대와 거래량 증가로 상승했습니다.' }); };
      global.StockSearch = { init: init };`);
    const start = src.lastIndexOf("  if (document.readyState === 'loading')");
    src = src.slice(0, start) + '})(window);';
    await page.addScriptTag({ content: src });
    await page.evaluate(() => {
      const saved = new Set();
      window.Watchlist = { has: c => saved.has(c), add(c) { saved.add(c); return { ok: true }; }, remove(c) { saved.delete(c); } };
      window.OrderBook = { init(sel, opts) { window.__bookCallbacks = opts; document.querySelector(sel).innerHTML = __book.buildShell(opts); }, select() {} };
      document.querySelector('#stock-search').innerHTML = __ui.buildShell();
      window.__stock = { code: '247540', name: '에코프로비엠', price: 108100, changeRate: 2.76, volume: 160794, tradingValue: 17380000000, sectors: ['2차전지'] };
    });
    let book = fs.readFileSync(path.join(root, 'js/order-book.js'), 'utf8');
    book = book.replace('  global.OrderBook = OrderBook;', '  global.__book = { state, renderBoard, buildShell };');
    book = book.slice(0, book.lastIndexOf("  if (document.readyState === 'loading')")) + '})(window);';
    await page.addScriptTag({ content: book });
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => {
        const c = document.querySelector('#stock-search');
        __ui.renderResults(c, [__stock]);
        __bookCallbacks.onSummary({ current: 108100, changeRate: 2.76, open: 106000, high: 109000, low: 105000 }, __stock.code);
      });
      await page.waitForTimeout(30);
      assert.equal(await page.locator('.ss-card-primary').count(), 1);
      assert.equal(await page.locator('.ss-result-row').count(), 0);
      assert.equal(await page.locator('.ss-summary-name').count(), 1);
      assert.equal(await page.locator('.ss-summary-price').count(), 1);
      assert.equal(await page.locator('.ss-summary-change').count(), 1);
      assert.equal(await page.locator('.ss-results-toggle').count(), 0);
      assert.match(await page.locator('#ssSessionCandle').innerText(), /106,000.*109,000.*105,000/s);
      assert.match(await page.locator('#ssSummaryReason').innerText(), /실적 개선/);
      await page.locator('#ssSummary .ss-fav-btn').click();
      assert.equal(await page.evaluate(() => Watchlist.has(__stock.code)), true);
      await page.locator('#ssSummary .ss-fav-btn').click();
      assert.equal(await page.evaluate(() => Watchlist.has(__stock.code)), false);
      assert.match(await page.locator('.ss-analysis-link').getAttribute('href'), /foreign-flow\?code=247540/);
      await page.evaluate(() => __bookCallbacks.onQuote({ code: __stock.code, price: 107000, changeRate: -1.2, change: -1300 }));
      assert.match(await page.locator('.ss-summary-price').innerText(), /107,000/);
      assert.match(await page.locator('.ss-summary-change').innerText(), /-1.20/);
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('#ssSummary');
        const top = document.querySelector('.ss-card-primary');
        const bottom = document.querySelector('.ss-card-secondary');
        const fields = [...top.children].map(el => el.getBoundingClientRect());
        const overlaps = fields.some((a, i) => fields.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
        return { overflow: card.scrollWidth > card.clientWidth, overlaps, gap: bottom.getBoundingClientRect().top - top.getBoundingClientRect().bottom, pad: getComputedStyle(card).paddingLeft, border: getComputedStyle(card).borderWidth };
      });
      assert.equal(geometry.overflow, false, JSON.stringify({ width, geometry }));
      assert.equal(geometry.overlaps, false);
      assert.equal(geometry.gap, 8);
      assert.equal(geometry.pad, '16px');
      assert.equal(geometry.border, '0px');
      await page.evaluate(() => {
        const c = document.querySelector('#order-book');
        __book.state.code = __stock.code; __book.state.name = __stock.name; __book.state.onSummary = function () {};
        __book.renderBoard(c, { asks: Array.from({ length: 10 }, (_, i) => ({ price: 108200 + i * 100, qty: 100 + i })), bids: Array.from({ length: 10 }, (_, i) => ({ price: 108000 - i * 100, qty: 200 + i })) }, { price: 108100, changeRate: 2.76, change: 2900 });
      });
      assert.equal(await page.locator('.ob-table-pairs > .ob-row-ask').count(), 10);
      assert.equal(await page.locator('.ob-table-pairs > .ob-row-bid').count(), 10);
      if (process.env.UI_SCREENSHOT_DIR && [1440, 390].includes(width)) {
        await page.locator('#ssOverview').screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `stock-card-${width}.png`) });
      }
    }
    await page.evaluate(() => __ui.renderResults(document.querySelector('#stock-search'), [{ ...__stock, sectors: ['-'] }]));
    assert.equal(await page.locator('.ss-card-sector').count(), 0);
    await page.evaluate(() => __ui.renderResults(document.querySelector('#stock-search'), [__stock, { ...__stock, code: '005930', name: '삼성전자' }]));
    await page.locator('.ss-result-row').nth(1).click();
    assert.equal(await page.locator('.ss-result-row').count(), 2);
    assert.equal(await page.locator('#ssSummary .ss-summary-name').count(), 0);
    assert.equal(await page.locator('#ssSummary .ss-summary-price').count(), 0);
    assert.equal(await page.locator('#ssSummary .ss-analysis-link').count(), 1);
    await page.locator('.ss-result-row .ss-fav-btn').nth(1).click();
    assert.equal(await page.evaluate(() => Watchlist.has('005930')), true);
    await page.evaluate(() => __bookCallbacks.onQuote({ code: '005930', price: 72000, changeRate: 1.5, change: 1000 }));
    assert.match(await page.locator('.ss-result-row').nth(1).innerText(), /72,000/);
    assert((await page.evaluate(() => __chartLoads)) >= 6);
    assert.deepEqual(errors, []);
    console.log('PASS real DOM: 1440/1024/390/320px; single/multiple; live quote; OHLC/AI; favorites; analysis links; 10+10 order book; chart selection handoff');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
