/* test_accumulation_bars.py 가 호출하는 도우미: JSON 일봉 배열을 받아 chart-core 매집봉 후보의 인덱스·상태와 마커 문구를 출력한다. */
const fs = require('fs');
const core = require('../js/chart-core.js');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const hits = core.accumulationBars(bars);
process.stdout.write(JSON.stringify({
  indices: hits.map((hit) => hit.index),
  statuses: hits.map((hit) => [hit.index, hit.status]),
  markers: core.accumulationMarkers(bars).map((m) => [m.time, m.text]),
  summary: core.accumulationSummary(bars),
  hits: hits,
}));
