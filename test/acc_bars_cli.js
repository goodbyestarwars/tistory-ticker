/* test_accumulation_bars.py 가 호출하는 도우미: JSON 일봉 배열을 받아 chart-core 대량 거래 표시(바닥권·횡보)의 인덱스·구간·마커·요약을 출력한다. */
const fs = require('fs');
const core = require('../js/chart-core.js');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const hits = core.accumulationBars(bars);
process.stdout.write(JSON.stringify({
  indices: hits.map((hit) => hit.index),
  zones: hits.map((hit) => [hit.index, hit.zone]),
  markers: core.accumulationMarkers(bars).map((m) => [m.time, m.text, m.color]),
  summary: core.accumulationSummary(bars),
  legend: core.accumulationLegendHtml(core.accumulationSummary(bars)),
  hits: hits,
}));
