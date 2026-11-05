'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const stock = fs.readFileSync('js/stock-search.js','utf8');
const flow = fs.readFileSync('js/foreign-flow.js','utf8');
const enhancer = fs.readFileSync('js/dashboard-enhancements.js','utf8');
const css = fs.readFileSync('css/stock-search.css','utf8');
const shared = fs.readFileSync('css/dashboard-enhancements.css','utf8');
assert.equal((stock.match(/class="ss-drawing-tools"/g)||[]).length,3);
assert.equal((stock.match(/class="nine-chart-drawing-segment"/g)||[]).length,3);
assert.equal((stock.match(/class="nine-chart-action-stack"/g)||[]).length,3);
assert.equal((stock.match(/class="nine-chart-capture-actions"/g)||[]).length,3);
assert.equal((stock.match(/data-chart-capture="save"/g)||[]).length,3);
assert.equal((stock.match(/data-chart-capture="copy"/g)||[]).length,3);
assert.equal((flow.match(/class="nine-chart-drawing-segment"/g)||[]).length,1);
assert.equal((flow.match(/class="nine-chart-action-stack"/g)||[]).length,1);
assert.equal((flow.match(/class="nine-chart-capture-actions"/g)||[]).length,1);
for(const source of [stock,flow]){
  const a=source.indexOf('class="nine-chart-drawing-segment"');
  const clear=source.indexOf('>지우기</button>',a);
  const groupEnd=source.indexOf("'</div>",clear);
  const actions=source.indexOf('class="nine-chart-action-stack"',clear);
  const save=source.indexOf('data-chart-capture="save"',actions);
  const copy=source.indexOf('data-chart-capture="copy"',save);
  assert(clear>a&&groupEnd>clear&&actions>groupEnd&&save>actions&&copy>save);
}
assert(enhancer.includes("expandSegment.className = 'nine-chart-expand-segment'"));
assert(enhancer.includes("actionStack.insertBefore(expandSegment, actionStack.querySelector('.nine-chart-capture-actions'))"));
assert(enhancer.includes("controlRow.querySelector('.ss-drawing-tools')"));
assert(css.includes('.ss-stock-controls.ss-stock-controls .nine-chart-drawing-segment button.is-active'));
assert(css.includes('.ss-stock-controls.ss-stock-controls .nine-chart-drawing-segment button[aria-pressed="true"]'));
assert(shared.includes('.nine-chart-action-stack .de-expand-button.de-expand-inline'));
assert(shared.includes('.nine-chart-capture-actions > button'));
assert(shared.includes('.nine-chart-expand-segment {'));
assert(shared.includes('.nine-chart-expand-segment .de-expand-button.de-expand-inline'));

assert(shared.includes('html.dark :is(#stock-search, #foreign-flow, .de-chart-overlay) .nine-chart-drawing-segment'));
console.log('chart toolbar segments/capture: domestic US index foreign flow, fullscreen/copy bindings and CSS contract ok');
