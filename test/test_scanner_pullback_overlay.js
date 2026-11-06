const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const wave = require('../js/auto-wave.js');
const src = fs.readFileSync('js/pattern-scan.js', 'utf8');
const start = src.indexOf('  function observedPatternLines(');
const end = src.indexOf('  // ---- 유틸 ----', start);
const context = { SUPPORT_COLOR: '#d24f45' };
vm.runInNewContext(src.slice(start, end), context);
const closes = [100,102,104,106,108,110,112,114,116,118,116,114,113,112,111,114,116,117];
const bars = closes.map((close,i)=>({ date: '2026-10-' + String(i+1).padStart(2,'0'), close }));
const detail = { windowBars: bars.length, signal: { date: bars.at(-1).date, price: bars.at(-1).close }, shape: wave.shapeOf(bars) };
assert.equal(detail.shape.type, 'rebound');
const future = {date:'2026-10-30', close: 125};
const lines = context.observedPatternLines([...bars, future], 'pullbackRebreak', detail, wave);
const points = lines[0].points;
assert.deepEqual(Array.from(points, p=>p.price), [100,118,111,117]);
let rendered;
context.addPatternOverlay({LineSeries: 1, LineStyle: {Solid: 0}}, {addSeries() { return {setData(data) { rendered = data; }}; }},
  null, [...bars, future], 'shape:pullbackRebreak', {lines});
assert.deepEqual(Array.from(rendered, p=>p.time), ['2026-10-01','2026-10-10','2026-10-15','2026-10-18']);
assert.equal(context.observedPatternLines(bars, 'pullbackRebreak', {...detail, signal: {...detail.signal, price: 999}}, wave).length, 0);
assert.equal(context.observedPatternLines(bars.slice(1), 'pullbackRebreak', detail, wave).length, 0);


const rising = Array.from({length:24}, (_,i) => {
  const close = i===23 ? 151 : i>=21 ? 119+i : 100+2*i;
  return {date:'2026-10-'+String(i+1).padStart(2,'0'),open:close-1,high:close+1,low:close-2,close,volume:i===23?300:100};
});
const groups = wave.selectShapesOf(rising);
for (const key of ['trendBreakout','liveFlow']) {
  assert.ok(groups[key].length, key);
  const evidence = context.observedPatternLines([...rising, future], key, groups[key][0], wave);
  assert.ok(evidence[0].points.length >= 2, key);
  assert.equal(evidence[0].points.at(-1).date, rising.at(-1).date);
}
assert.doesNotMatch(src, /data-ps-draw|data-ps-memo|loadModule\('drawing'\)/);
for (const selector of ['data-ps-ma','psIchimokuToggle','psBollingerToggle','psSupportResistanceToggle','data-ps-volume']) {
  assert.ok(src.includes(selector), selector);
}
