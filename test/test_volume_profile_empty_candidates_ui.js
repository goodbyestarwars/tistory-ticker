'use strict';
require('./helpers/common_runtime');

// Regression: do not invent formal support/resistance when the histogram
// lacks separate qualifying zones. Surface distinctly labelled nearby
// reference bins and explain absent thin areas. Node: node test/test_volume_profile_empty_candidates_ui.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync('js/foreign-flow.js', 'utf8');
const css = fs.readFileSync('css/foreign-flow.css', 'utf8');
const vpCode = fs.readFileSync('js/volume-profile-analysis.js', 'utf8');

const moduleObj = { exports: {} };
new Function('module', 'window', vpCode)(moduleObj, undefined);
const VP = moduleObj.exports;
assert.equal(typeof VP.analyze, 'function');

const start = src.indexOf('  function vpAnalysisHtml(entry, estimate) {');
const end = src.indexOf('  function vpRender(entry) {', start);
assert(start > 0 && end > start, 'exact production renderer located');
const renderer = new Function(
  'global', 'normalizeDailyForVolumeProfile', 'vpPrice', 'compactChartVolume',
  'VP_PERIODS', 'APT_BIN_STEPS', 'buildApproxVolumeProfile', 'escapeHtml',
  src.slice(start, end) + '\nreturn vpAnalysisHtml;'
)(
  { NineVolumeProfile: VP },
  rows => rows,
  n => Math.round(Number(n)).toLocaleString('ko-KR') + '원',
  n => Math.round(Number(n)).toLocaleString('ko-KR'),
  [20, 60, 120], [24],
  (daily, step, days) => ({
    profile: { bins: activeBins },
    daysIncluded: days || 120
  }),
  s => String(s)
);
let activeBins;
function render(volumes, price) {
  activeBins = volumes.map((volume, i) => ({
    low: 9000 + i * 100, high: 9100 + i * 100, volume
  }));
  const estimate = { profile: { bins: activeBins }, daysIncluded: 120 };
  return renderer({ code: '441270', daily: [], price, lookback: 120, binIndex: 0 }, estimate);
}

test('cards have no left colored bracket in regular and dark theme', () => {
  assert.match(css, /\.ff-vp-an-card \{[^}]*border: 1px solid #e3e8ee/);
  assert.doesNotMatch(css, /\.ff-vp-an-card \{[^}]*border-left-width:\s*4px/);
  assert.doesNotMatch(css, /\.ff-vp-an-card\.(resist|support|poc|current)\s*\{[^}]*border-left-color:/);
});

test('missing independent zones display numeric references, not fabricated strong levels', () => {
  // A major zone encompasses the price. There are no separate support and
  // resistance zones, yet actual nearby bins exist on either side.
  const html = render([60, 60, 90, 100, 95, 80, 60, 50], 9550);
  assert(html.includes('가까운 저항 후보'));
  assert(html.includes('가까운 지지 후보'));
  assert(html.includes('참고 매물대'), 'prices visible without inventing support/resistance');
  assert(html.includes('독립된 지지·저항 후보 아님'), 'disclaimer on reference prices');
  assert(html.includes('9,600원~9,700원'), 'reference above');
  assert(html.includes('9,300원~9,400원'), 'reference below');
  assert(html.includes('거래량이 적은 가격대'));
  assert(html.includes('참고 가격대 9,700원~9,800원'), 'low-density bin shown');
  assert(html.includes('엄격한 얇은 구간 기준은 미충족'), 'thin reference clearly non-qualifying');
  assert(html.includes('data-vp-period="20"'));
  assert(html.includes('data-vp-period="60"'));
  assert(html.includes('data-vp-period="120"'));
  assert(html.includes('기간별 비교'));
});

test('real qualified candidates take precedence over reference bins', () => {
  const html = render([10, 10, 80, 100, 80, 10, 10], 9150);
  assert(html.includes('9,200원~9,500원'), 'real resistance zone from analyzer');
  const resist = html.match(/<div class="ff-vp-an-card resist[^"]*">([\s\S]*?)<\/div>/);
  assert(resist, 'resistance card');
  assert(!resist[1].includes('독립된 지지·저항 후보 아님'), 'real qualified zone not mislabeled');
});

test('far-away bins never masquerade as nearby candidates', () => {
  const html = render([60, 60, 90, 100, 95, 80, 60, 50], 13000);
  assert(html.includes('조건 충족 후보 없음'));
  assert(html.includes('5% 이내에 참고할 가격대도 없습니다'));
  assert(html.includes('평균보다 거래량 밀도가 낮은 참고 가격대도 확인되지 않았습니다'));
});
