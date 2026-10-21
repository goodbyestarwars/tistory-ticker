// Regression test: footer guide must describe the chart UI currently rendered by stock-search.js.
// Run: node test/test_site_guide_chart.js
'use strict';
const fs = require('fs');
const assert = require('assert');
const guide = fs.readFileSync('legal/guide.html', 'utf8');
const ui = fs.readFileSync('js/stock-search.js', 'utf8');
const wave = fs.readFileSync('js/chart-wave-overlay.js', 'utf8');
const footer = fs.readFileSync('skin.html', 'utf8');
const core = fs.readFileSync('js/chart-core.js', 'utf8');
const expect = text => assert(guide.includes(text), 'guide missing: ' + text);
assert(footer.includes('legal/guide.html'), 'footer still links to guide');
assert(guide.includes('id="chart"'));
expect('2026년 10월 22일 업데이트');
[['3·5·20·60','data-chart-ma-short-toggle'],['112·224·448','data-chart-ma-long-toggle'],['RSI 다이버전스','data-chart-rsidiv-toggle'],['거래량 배수 표시','data-chart-volmult-toggle'],['거래량·가격 흔적','ssAccumulationToggle'],['측정','ss-measure-toggle']].forEach(([text,selector]) => {
  expect(text);
  assert(ui.includes(selector), 'ui missing: ' + selector);
});
assert(ui.includes('rsiEnabled: false'), 'RSI default changed: update guide');
assert(ui.includes('movingAverageShortEnabled: true') && ui.includes('movingAverageLongEnabled: true'), 'MA default changed');
expect('기본은 꺼짐');
expect('Shift + 휠');
assert(core.includes('installSmoothWheelZoom'));
assert(wave.includes("data-wave-trend"));
expect('중파동');
expect('파동 분석');
expect('확정된 뒤');
expect('REST 표본');
assert(!guide.includes('<tr><td>이동평균선 표시</td>'), 'obsolete MA guide row');
const anchors = [...guide.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
anchors.forEach(id => assert(guide.includes('id="' + id + '"'), 'broken fragment: ' + id));
console.log('site footer guide chart features: ok');
