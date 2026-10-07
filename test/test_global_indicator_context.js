// Run: node test/test_global_indicator_context.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const charts = [];
const window = { fetch() {}, LightweightCharts: {
  AreaSeries: {}, LineStyle: { Dashed: 2, Solid: 0 },
  createChart(element, options) {
    const record = { options, lines: [] }; charts.push(record);
    return { remove() {}, timeScale: () => ({ fitContent() {} }), addSeries(type, seriesOptions) {
      record.seriesOptions = seriesOptions;
      return { setData(rows) { record.rows = rows; }, createPriceLine(line) { record.lines.push(line); return {}; } };
    } }; }
} };
const document = { readyState: 'loading', addEventListener() {}, body: { contains: () => true },
  documentElement: { classList: { contains: () => false } } };
const context = { window, document, console, setTimeout, clearTimeout };
let source = fs.readFileSync('js/overnight-market.js', 'utf8');
source = source.replace('global.OvernightMarket = OvernightMarket;', `global.OvernightMarket = OvernightMarket;
  global.testIndicators = { renderSparkline, benchmarkCaption, binanceCardHtml, loadBinanceDirect, loadBinance,
    symbols: BINANCE_SYMBOLS, setAverages(symbol, year, half) { benchmarks[symbol] = year; benchmarks6m[symbol] = half; } };`);
vm.runInNewContext(source, context);
const api = window.testIndicators;
const home = fs.readFileSync('js/home-weekly-report.js', 'utf8');
api.symbols.forEach(pair => assert.ok(home.includes("symbol: '" + pair[0] + "'"), pair[0]));
assert.equal(api.symbols.length, 8);

(async () => {
  api.setAverages('BTC', { avg: 140 }, { avg: 80 });
  api.renderSparkline({}, 'BTC', [{ date: '20261005', close: 100 }, { date: '20261006', close: 110 }], false, 105, -5);
  await new Promise(setImmediate);
  const crypto = charts[0];
  assert.equal(crypto.options.height, 230);
  assert.equal(crypto.options.rightPriceScale.visible, true);
  const range = crypto.seriesOptions.autoscaleInfoProvider(() => ({ priceRange: { minValue: 100, maxValue: 110 } }));
  assert.equal(range.priceRange.minValue, 80);
  assert.equal(range.priceRange.maxValue, 140);
  assert.deepEqual(crypto.lines.filter(x => x.axisLabelVisible).map(x => x.title), ['52주 평균', '6개월 평균']);
  const caption = api.benchmarkCaption('BTC', 105);
  assert.ok(caption.includes('-25.00%') && caption.includes('+31.25%'));
  api.setAverages('ETH', null, null);
  assert.ok(api.benchmarkCaption('ETH', 100).includes('평균 자료 확인 중'));
  api.renderSparkline({}, 'VIX', [{ date: '20261005', close: 20 }, { date: '20261006', close: 21 }], true, 22, 1);
  await new Promise(setImmediate);
  assert.equal(charts[1].options.height, 230);
  assert.equal(charts[1].options.rightPriceScale.visible, true);

  const requests = [];
  context.fetch = async url => {
    requests.push(url);
    if (url.includes('/premiumIndex')) return { ok: true, json: async () => ({ markPrice: '100', lastFundingRate: '.0001' }) };
    if (url.includes('/klines')) return { ok: true, json: async () => [[1, 0, 0, 0, 100], [2, 0, 0, 0, 101]] };
    return { ok: true, json: async () => ({ lastPrice: '101', priceChangePercent: '1' }) };
  };
  assert.equal((await api.loadBinanceDirect()).items.length, 8);
  const candles = requests.filter(x => x.includes('/klines')).length;
  await api.loadBinanceDirect();
  assert.equal(requests.filter(x => x.includes('/klines')).length, candles, '48h candles must remain cached');
  const before = requests.length;
  document.hidden = true;
  api.loadBinance({ querySelector: () => null, closest: () => null }, false);
  document.hidden = false;
  api.loadBinance({ querySelector: () => null, closest: () => ({ hidden: true }) }, false);
  assert.equal(requests.length, before, 'hidden page and hidden panel must not refresh');

  let macro = fs.readFileSync('js/us-macro-indicators.js', 'utf8');
  macro = macro.replace('global.UsMacroIndicators = { init: init, fetchResults: fetchResults_, resultCards: resultCards_ };', 'global.UsMacroIndicators = { init: init }; global.testMacro = { card_, SYMBOLS };');
  vm.runInNewContext(macro, context);
  window.testMacro.SYMBOLS.forEach(symbol => {
    const html = window.testMacro.card_(symbol, {});
    ['높으면', '낮으면', '좋은 흐름'].forEach(label => assert.ok(html.includes(label), symbol + label));
  });
  console.log('PASS: 8 shared tokens, cached candles, hidden refresh, crypto average visibility/gaps, consistent market charts, 10 macro guides');
})().catch(err => { console.error(err); process.exitCode = 1; });
