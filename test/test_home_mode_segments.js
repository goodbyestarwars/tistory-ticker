'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('js/skin-main.js','utf8');
const css=fs.readFileSync('css/home-market-board.css','utf8');
const skin=fs.readFileSync('skin.html','utf8');
const helperBegin=js.indexOf('    function homeModeSegment(attribute, selected, ariaLabel) {');
const helperEnd=js.indexOf('    function renderHomeSessionChart(element, key, reference) {',helperBegin);
assert(helperBegin>=0 && helperEnd>helperBegin,'shared segment factory and price control');
const controls=new Function('homeModeOf',js.slice(helperBegin,helperEnd)
  +'return {homeModeSegment,homePriceSwitchControls};')(
    key=>key==='NASDAQ_INDEX'?'bar':'area');
const segment=controls.homeModeSegment;
for(const context of [
  ['data-home-metric-mode','area'],
  ['data-investor-mode-select','area'],
  ['data-price-mode','bar']
]){
  const html=segment(context[0],context[1],'그래프 타입');
  assert(html.includes('class="hmb-mode-segment"'));
  assert(html.includes('role="group"'));
  assert.equal((html.match(/<button /g)||[]).length,2);
  assert(!html.includes('‹')&&!html.includes('›'));
  assert(html.includes(context[0]+'="area" aria-pressed="'+(context[1]==='area')+'"'));
  assert(html.includes(context[0]+'="bar" aria-pressed="'+(context[1]==='bar')+'"'));
}
const us=controls.homePriceSwitchControls('NASDAQ_INDEX','30분 · 뉴욕시간');
assert(us.includes('30분 · 뉴욕시간'));
assert(us.includes('data-price-mode="bar" aria-pressed="true"'));
const kr=controls.homePriceSwitchControls('KOSPI','30분 · KST');
assert(kr.includes('data-price-mode="area" aria-pressed="true"'));
assert(js.includes("homeModeSegment('data-home-metric-mode', 'area'"));
assert(js.includes("homeModeSegment('data-investor-mode-select', 'area'"));
assert(js.includes("homePriceModes[key] = selectedMode"));
assert(js.includes("homeInvestorMode = selectedMode"));
assert(js.includes("homePriceModes[symbol] = metricMode"));
assert(!js.includes('data-price-switch'));
assert(!js.includes('data-investor-switch'));
assert(!js.includes('data-investor-mode>면적'));
assert(css.includes('.hmb-mode-segment > button[aria-pressed="true"]'));
assert(css.includes('.hmb-mode-segment > button:focus-visible'));
assert(css.includes('@media (pointer: coarse)'));
assert(skin.includes('skin-main.js?v=20261025-countdown-module6'));
console.log('PASS: KR+US+night session / investor / metric area-bar selectors share one segment factory, states and accessibility');
