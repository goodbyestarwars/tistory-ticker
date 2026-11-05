'use strict';
// Shared graph-fill palette: all selected red/blue chart shapes use CSS tokens,
// while numeric text, linework, and neutral/third-party series stay semantic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path,'utf8');
const ui=read('css/ui-system.css');
assert.match(ui,/--chart-fill-up:\s*#FAE8E7;/i);
assert.match(ui,/--chart-fill-down:\s*#E4EDF8;/i);
const shell=read('js/skin-shell.js');
const palette = Object.fromEntries([...ui.matchAll(/(--chart-(?:ohlc-)?fill-(?:up|down)):\s*(#[0-9a-f]{6});/gi)]
  .map(([, name, value]) => [name, value]));
assert.equal(palette['--chart-ohlc-fill-up'], '#E88D86');
assert.equal(palette['--chart-ohlc-fill-down'], '#79A7DE');
const core=read('js/chart-core.js');
const lwc = { LineStyle: { Solid: 0 }, CandlestickSeries: 'candle', HistogramSeries: 'volume', LineSeries: 'line' };
const window = { LightweightCharts: lwc, document: { documentElement: {} } };
window.getComputedStyle = () => ({ getPropertyValue: name => palette[name] || '' });
const context = vm.createContext({ window, global: window });
vm.runInContext(shell.match(/\/\* NineUI:[\s\S]+?\/\* End NineUI \*\//)[0], context);
vm.runInContext(core, context);
const uiApi = window.NineUI;
const engine = window.NineChartCore;
assert.equal(uiApi.chartFill(true), '#FAE8E7');
assert.equal(uiApi.chartFill('down'), '#E4EDF8');
assert.equal(uiApi.chartOhlcFill('down'), '#79A7DE');
assert.equal(engine.candleOptions().upColor, '#E88D86');
assert.equal(engine.candleOptions().downColor, '#79A7DE');
assert.equal(engine.candleOptions().borderUpColor, '#d24f45');
assert.equal(engine.candleOptions().wickDownColor, '#1261c4');
const bars = [
  {date: '2026-11-04', open: 9, high: 12, low: 8, close: 11, volume: 50},
  {date: '2026-11-05', open: 11, high: 12, low: 9, close: 10, volume: 60}
];
const chart = {
  addSeries(type, options) {
    return { type, options, setData(data) { this.data = data; } };
  },
  timeScale() { return { getVisibleLogicalRange: () => null }; }
};
assert.equal(engine.addCandles(chart, lwc, bars, {}).options.priceLineColor, '#E4EDF8');
const pane = engine.addVolumePane(chart, lwc, bars);
assert.equal(pane.volume.data[0].color, '#E88D86');
assert.equal(pane.volume.data[1].color, '#79A7DE');
assert.equal(pane.volume.data[1].value, 60);
pane.updateData(bars.slice(1));
assert.equal(pane.volume.data[0].color, '#79A7DE');
window.getComputedStyle = () => ({ getPropertyValue: () => 'invalid' });
assert.equal(uiApi.chartOhlcFill(false), '#79A7DE');
delete window.NineUI;
assert.equal(engine.candleOptions().upColor, '#E88D86');
const indicator=read('js/indicator-board.js');
assert.match(indicator,/var\(--chart-fill-/);
assert.match(indicator,/s\.fillColor \|\| s\.color/);
assert.match(indicator,/stroke="' \+ color/);
const investor=read('js/investor-flow.js');
assert.match(investor,/--investor-color:/);
assert.match(investor,/--investor-fill:/);
assert.match(investor,/fillColor: inv\.key === 'foreign'/);
const home=read('css/home-market-board.css');
for(const sel of ['.hmp-column.is-up', '.hmp-column.is-down','.hus-bar i.is-up',
  '.hus-bar i.is-down','.hmb2-upbar .is-up','.hmb2-upbar .is-down']){
  const ln=home.split(/\r?\n/).find(x=>x.includes(sel));
  assert(ln && ln.includes('--chart-fill-'),sel);
}
assert.match(home,/hmb-investor-bar-value \{[^\n]*color: var\(--investor-color\)/);
for(const path of ['css/domestic-market-indicators.css','css/market-temp.css',
  'css/foreign-flow.css','css/home-weekly-report.css']){
  const css=read(path);
  assert(css.includes('var(--chart-fill-up)') && css.includes('var(--chart-fill-down)'),path);
}
const dmi=read('js/domestic-market-indicators.js');
const fast=read('js/quick-indices.js');
const overnight=read('js/overnight-market.js');
const dmiColors = vm.runInContext(dmi.slice(dmi.indexOf('  function ohlcFill('), dmi.indexOf('  function makeChart('))
  + '\n({ volumeData, volumeAxisColor })', context);
window.NineUI = uiApi;
const points = bars.map(bar => ({ ...bar, time: bar.date }));
points.push({ open: 1, close: 2, volume: 0 });
assert.equal(dmiColors.volumeData(points).length, 2);
assert.equal(dmiColors.volumeData(points)[0].color, '#E88D86');
assert.equal(dmiColors.volumeData(points)[1].color, '#79A7DE');
assert.equal(dmiColors.volumeAxisColor(points), '#E4EDF8');
assert.match(dmi,/upColor: ohlcFill\(true\),\s+downColor: ohlcFill\(false\)/);
assert.match(dmi,/current\.series\.applyOptions\(\{ priceLineColor: axisColor/);
assert.match(dmi,/current\.volSeries\.applyOptions\(\{ priceLineColor: volumeAxisColor/);
assert.match(fast,/topColor: fillColor/);
assert.match(overnight,/topColor: fillColor/);
assert.match(fast,/lineColor: color/);
assert.match(overnight,/lineColor: color/);
const style=read('style.css');
assert.match(style,/\.home-positive \{ color: var\(--num-up\) !important;/);
assert.match(style,/\.home-negative \{ color: var\(--num-down\) !important;/);
for(const script of ['js/skin-shell.js','js/chart-core.js','js/indicator-board.js',
 'js/domestic-market-indicators.js','js/quick-indices.js','js/overnight-market.js','js/investor-flow.js']){
  new Function(read(script));
}
console.log('PASS: shared red/blue graph fills, semantic numeric/line preservation, syntax');
