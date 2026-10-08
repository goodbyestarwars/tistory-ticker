// Run: node test/test_sector_card_loading.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const timers = [];
const window = { console: { error() {} }, AbortController };
const context = {
  window, console, AbortController,
  document: { readyState: 'loading', addEventListener() {} },
  setTimeout(fn, ms) { timers.push(ms); return timers.length; }, clearTimeout() {},
  fetch: async () => ({ ok: true, json: async () => [quote('005930')] })
};
function quote(code) { return { code, price: 100, change: 1, changeRate: 1 }; }
vm.runInNewContext(fs.readFileSync('js/sector-dashboard-v4.js', 'utf8'), context);
const SD = window.SectorDashboard;
const realFetchBatch = SD.fetchBatch;

(async () => {
  await realFetchBatch(['005930']);
  assert.ok(timers[0] > 9200, 'normal 9.2s GAS response must fit the request deadline');

  context.fetch = async url => {
    assert.ok(url.includes('/sector-quotes?codes='));
    return { ok: true, json: async () => ({ data: ['005930', '000660'].map(quote) }) };
  };
  assert.equal((await SD.fetchTickerData(['005930', '000660'])).length, 2);
  context.fetch = async () => { throw new Error('VM offline'); };
  const calls = [];
  SD.fetchBatch = async codes => {
    calls.push([...codes]);
    if (calls.length === 1) throw new Error('transient failure');
    return codes.map(quote);
  };
  assert.equal((await SD.fetchTickerData(['005930', '000660'])).length, 2);
  assert.equal(calls.length, 2);

  calls.length = 0;
  SD.fetchBatch = async codes => {
    calls.push([...codes]);
    return calls.length === 1 ? [quote('005930')] : codes.map(quote);
  };
  assert.equal((await SD.fetchTickerData(['005930', '000660'])).length, 2);
  assert.deepEqual(calls, [['005930', '000660'], ['000660']]);

  calls.length = 0;
  SD.fetchBatch = async codes => { calls.push([...codes]); return calls.length === 1 ? [quote('005930')] : []; };
  assert.equal((await SD.fetchTickerData(['005930', '000660'])).length, 1);
  assert.equal(calls.length, 2, 'permanent omissions must not cause an unbounded retry');
  const html = SD.renderCardsHtml({ 반도체: [{ name: '삼성전자', code: '005930' }], 다른카드: [{ name: '대기종목', code: '000660' }] }, {}, { '005930': quote('005930') }, true);
  assert.ok(html.includes('삼성전자') && html.includes('대기종목') && html.includes('다른카드'));
  assert.ok(html.includes('시세 대기') && html.includes('data-code="000660"'));

  let attempts = 0;
  SD.fetchBatch = async () => { attempts++; throw new Error('offline'); };
  await assert.rejects(SD.fetchTickerData(['005930']));
  assert.equal(attempts, 2);

  // A total failure must leave the panel retryable; one click succeeds without page reload.
  let source = fs.readFileSync('js/market-temp.js', 'utf8');
  source = source.replace('global.MarketTemp = MarketTemp;', 'global.MarketTemp = MarketTemp; global.loadSectorCards = loadSectorCardsPanel_;');
  window.location = { search: '?view=stocks' };
  window.KRX_MAP = {};
  let loadAttempts = 0;
  window.SectorDashboard = {
    fetchTickerData: async () => { if (++loadAttempts === 1) throw new Error('offline'); return [quote('005930')]; },
    renderCardsHtml: () => '<div>삼성전자</div>'
  };
  context.localStorage = { getItem() { return null; } };
  context.fetch = async url => ({ ok: true, json: async () => ({ data: url.includes('/auth/')
    ? { configured: false, authenticated: false }
    : { sectors: { 반도체: [{ name: '삼성전자', code: '005930' }] } } }) });
  vm.runInNewContext(source, context);
  let retry;
  const panel = { innerHTML: '', querySelector(selector) { return selector === '[data-sector-cards-retry]'
    ? { addEventListener(type, fn) { retry = fn; } } : null; }, querySelectorAll() { return []; } };
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  window.loadSectorCards(panel);
  await flush();
  assert.equal(panel.__mtLoaded, false);
  assert.ok(panel.innerHTML.includes('다시 불러오기'));
  retry();
  await flush();
  assert.equal(loadAttempts, 2);
  assert.ok(panel.innerHTML.includes('삼성전자'));
  console.log('PASS: timeout budget, transient failure, partial recovery, persistent omission, card preservation, failure retry');
})().catch(err => { console.error(err); process.exitCode = 1; });
