/* test_trend_state.py 가 호출하는 도우미: 일봉 JSON -> 추세 상태·전환 마커·현재 요약·범례 HTML. */
const fs = require('fs');
const core = require('../js/chart-core.js');
const bars = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const states = core.trendStates(bars);
process.stdout.write(JSON.stringify({
  last: states[states.length - 1], summary: core.trendSummary(bars), markers: core.trendMarkers(bars).map((m) => [m.time, m.text, m.color, m.position]),
  legend: core.trendLegendHtml(core.trendSummary(bars)), firstLongIndex: states.findIndex((s) => s.long !== null), n: states.length,
}));
