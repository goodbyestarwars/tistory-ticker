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


// 2026-11-22: 11/13 chart-first-v2 이후 selectShapesOf의 단기 후보(liveFlow·trendBreakout 등)는
// 100봉 이상에서 확정 스윙 구조가 있을 때만 만들어진다. 예전 24봉 상승 데이터는 더 이상 후보가 될 수 없어
// 구조를 갖춘 두 데이터로 바꾼다(trendBreakout은 test_shape_selection.js와 같은 앵커).
function path(anchors) {
  const values = [];
  for (let j = 1; j < anchors.length; j++) {
    const span = anchors[j][0] - anchors[j-1][0];
    for (let i = 0; i < span; i++) values.push(anchors[j-1][1] + (anchors[j][1] - anchors[j-1][1]) * i / span);
  }
  return values;
}
function dailyBars(values) {
  return values.map((close, i) => ({date: new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),
    open: close-.1, high: close+.8, low: close-.8, close, volume: 1000}));
}
const resistanceValues = path([[0,150],[80,130],[100,100],[120,120],[145,102],[160,118],[175,108],[185,117]]);
resistanceValues.push(117);
const trendBars = dailyBars(resistanceValues);
Object.assign(trendBars.at(-1), {open: 117.8, close: 118, high: 118.8});
const rangeBox = [0, .3, -.2, .2, 0].map(x => 148.2 + x);
const flowBars = dailyBars(path([[0,100],[120,150],[126,144],[132,148.2]]).concat(rangeBox, [148.2]));
Object.assign(flowBars.at(-1), {open: 149.3, close: 151.7, high: 152.1, low: 149.1});
for (const [key, rising] of [['trendBreakout', trendBars], ['liveFlow', flowBars]]) {
  const groups = wave.selectShapesOf(rising);
  assert.ok(groups[key].length, key);
  const evidence = context.observedPatternLines([...rising, future], key, groups[key][0], wave);
  assert.ok(evidence[0].points.length >= 2, key);
  assert.equal(evidence[0].points.at(-1).date, rising.at(-1).date);
}
assert.doesNotMatch(src, /data-ps-draw|data-ps-memo|loadModule\('drawing'\)/);
for (const selector of ['data-ps-ma','psIchimokuToggle','psBollingerToggle','psSupportResistanceToggle','data-ps-volume']) {
  assert.ok(src.includes(selector), selector);
}
