'use strict';
// Shared graph-fill palette: all selected red/blue chart shapes use CSS tokens,
// while numeric text, linework, and neutral/third-party series stay semantic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path,'utf8');
const ui=read('css/ui-system.css');
assert.match(ui,/--chart-fill-up:\s*#FAE8E7;/i);
assert.match(ui,/--chart-fill-down:\s*#E4EDF8;/i);
const shell=read('js/skin-shell.js');
assert.match(shell,/function chartFill\(up\)/);
assert.match(shell,/chartFill: chartFill/);
const core=read('js/chart-core.js');
assert.match(core,/upColor: graphFill\(true\), downColor: graphFill\(false\)/);
assert.match(core,/borderUpColor: CANDLE_UP, borderDownColor: CANDLE_DOWN/);
assert.match(core,/wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN/);
assert.match(core,/color: graphFill|color: color/);
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
assert.match(dmi,/chartFill\(p\.close >= p\.open\)/);
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
