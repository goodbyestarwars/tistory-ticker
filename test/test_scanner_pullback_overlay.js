const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const wave = require('../js/auto-wave.js');
const src = fs.readFileSync('js/pattern-scan.js', 'utf8');
const start = src.indexOf('  function observedPullbackPoints(');
const end = src.indexOf('  // ---- 유틸 ----', start);
const context = { SUPPORT_COLOR: '#d24f45' };
vm.runInNewContext(src.slice(start, end), context);
const closes = [100,102,104,106,108,110,112,114,116,118,116,114,113,112,111,114,116,117];
const bars = closes.map((close,i)=>({ date: '2026-10-' + String(i+1).padStart(2,'0'), close }));
const detail = { windowBars: bars.length, signal: { date: bars.at(-1).date, price: bars.at(-1).close }, shape: wave.shapeOf(bars) };
assert.equal(detail.shape.type, 'rebound');
const future = {date:'2026-10-30', close: 125};
const points = context.observedPullbackPoints([...bars, future], detail, wave);
assert.deepEqual(Array.from(points, p=>p.price), [100,118,111,117]);
let rendered;
context.addPatternOverlay({LineSeries: 1, LineStyle: {Solid: 0}}, {addSeries() { return {setData(data) { rendered = data; }}; }},
  null, [...bars, future], 'shape:pullbackRebreak', {points});
assert.deepEqual(Array.from(rendered, p=>p.time), ['2026-10-01','2026-10-10','2026-10-15','2026-10-18']);
assert.equal(context.observedPullbackPoints(bars, {...detail, signal: {...detail.signal, price: 999}}, wave).length, 0);
assert.equal(context.observedPullbackPoints(bars.slice(1), detail, wave).length, 0);

