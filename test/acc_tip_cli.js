/* test_accumulation_bars.py 가 호출하는 도우미: 일봉 JSON 을 받아 대량거래 툴팁 HTML·범례 HTML·마커 색을 출력한다(브라우저 없이 가짜 DOM 사용). */
const fs = require('fs');
const created = [];
global.document = {
  documentElement: { classList: { contains: () => false } },
  createElement: () => { const el = { style: {}, hidden: true, innerHTML: '', remove() {} }; created.push(el); return el; },
};
const core = require('../js/chart-core.js');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const date = process.argv[3];
let handler = null;
const chart = { subscribeCrosshairMove: (fn) => { handler = fn; }, unsubscribeCrosshairMove() {} };
const container = { clientWidth: 800, querySelectorAll: () => [], appendChild() {} };
core.attachAccumulationTooltip(chart, container, bars);
handler({ point: { x: 100, y: 100 }, time: date });
const tip = created[0];
const counts = core.accumulationSummary(bars);
process.stdout.write(JSON.stringify({
  tip: tip.innerHTML, tipHidden: tip.hidden, legend: core.accumulationLegendHtml(counts), counts,
  markers: core.accumulationMarkers(bars).map((m) => [m.time, m.text, m.color]),
}));
