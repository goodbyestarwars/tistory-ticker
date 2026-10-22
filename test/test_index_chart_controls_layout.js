'use strict';
// Regression for index-chart controls (KOSPI/KOSDAQ/NASDAQ/S&P/DOW/SOX).
// Run: node test/test_index_chart_controls_layout.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('js/stock-search.js', 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync('css/stock-search.css', 'utf8');

function renderIndexControls() {
  // Evaluate the real index markup expression so changes to markup fail tests.
  const prefix = "panel.innerHTML = '<div class=\"ss-index-heading\"";
  const from = js.indexOf(prefix);
  const endMarker = ";\n          panel.querySelectorAll('[data-index-study]')";
  const to = js.indexOf(endMarker, from);
  assert(from !== -1 && to > from, 'index chart markup found');
  const expr = js.slice(from + "panel.innerHTML = ".length, to);
  const makeHtml = new Function('row', 'item', 'signClass', 'escapeHtml', 'fmtSignedPct',
    'indexStudies', 'indexWaveState', 'return ' + expr + ';');
  return makeHtml(
    { code: 'NASDAQ_INDEX', name: '나스닥' },
    { price: 26424.82, change_rate: -0.02, updated_at: '2026-10-21T06:30:53Z' },
    () => 'ss-down',
    s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    n => String(n) + '%',
    { maShort: true, maLong: true, cloud: false, bollinger: false, sr: false },
    { enabled: true, level: 'medium', trend: false }
  );
}

test('toolbar really has two contained rows, saved controls and no missing tools', () => {
  const html = renderIndexControls();
  assert(html.includes('class="ss-index-controls ss-stock-controls"'));
  assert(html.includes('class="ss-index-tools ss-chart-tabs"'));
  assert(html.includes('class="ss-chart-studies ss-index-studies"'));
  const a = html.indexOf('class="ss-index-tools ss-chart-tabs"');
  const b = html.indexOf('class="ss-chart-studies ss-index-studies"');
  const c = html.indexOf('class="ss-index-chart"');
  assert(a < b && b < c, 'timeframe/actions first; indicators second; chart below');
  for (const label of ['일봉', '주봉', '월봉', '분봉', '직선', '동그라미', '박스',
    '가로선', '측정', '연필', '지우기', '단기 이평선(3·5·20·60)', '장기 이평선(112·224·448)', '일목균형표(구름) 표시',
    '볼린저 밴드', '지지·저항 표시', '파동 분석', '추세선', '거래량 배수 표시', '매물대 표시', '거래량·가격 흔적']) {
    assert(html.includes(label), 'missing control: ' + label);
  }
  assert(html.includes('class="ss-index-wave-group"'), 'wave checkbox and level grouped');
  assert(html.includes('data-index-wave-level'), 'native select preserved');
  assert(html.includes('data-index-study="maShort" checked'));
  assert(html.includes('data-index-study="maLong" checked'));
  assert(html.includes('data-index-study="wave" checked'));
  assert(html.includes('<option value="medium">중파동</option>'));
  assert(html.includes('disabled title="이 지수의 실제 분봉 원본이 없습니다"'), 'no fabricated minute data');
  const divs = [...html.matchAll(/<\/?div\b[^>]*>/g)].map(x => x[0]);
  let depth = 0;
  for (const div of divs) {
    depth += div.startsWith('</') ? -1 : 1;
    assert(depth >= 0, 'balanced div nesting never underflows');
  }
  assert.equal(depth, 0, 'complete index panel markup balances divs');
});

test('compact style fits wave name, dark mode and narrow screens', () => {
  assert(css.includes('#stock-search .ss-index-controls'));
  assert(css.includes('#stock-search .ss-index-controls .ss-index-tools'));
  assert(css.includes('#stock-search .ss-index-controls .ss-index-studies'));
  assert.match(css, /#stock-search \.ss-index-wave-group \[data-index-wave-level\][\s\S]*?width: 124px;[\s\S]*?min-width: 124px;/);
  assert(css.includes('flex-wrap: wrap;'), 'responsive wrapping retained');
  assert(css.includes('@media (max-width: 900px)'));
  assert(css.includes('html.dark #stock-search .ss-index-controls'));
  assert(js.includes("indexWaveState.level = waveLevel.value"), 'wave selection callback kept');
  assert(js.includes("renderIndexChart(panel, row.code)"), 'chart update retained');
});
