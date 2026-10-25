// 매물대 분석 패널(2026-10-22 줄임): 머리글은 짧게(긴 설명은 title), 상태는 첫 문장만(전체는 title), 안내 문구 한 줄.
'use strict';
require('./helpers/common_runtime');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const VP = require('../js/volume-profile-analysis.js');
global.NineVolumeProfile = VP;
assert(VP && typeof VP.analyze === 'function', 'analysis module loaded');
const src = fs.readFileSync('js/stock-search.js', 'utf8');
const from = src.indexOf('  function vpEsc(text)');
const to = src.indexOf('  function createVolumeProfilePrimitive');
assert(from > 0 && to > from);
const api = new Function('chartPriceText', 'global', src.slice(from, to) + '\nreturn { renderVpPanel: renderVpPanel };')(
  (v) => Number(v).toLocaleString('ko-KR'), global);
// 합성 매물대: 9,050~11,350에 거래량이 몰려 있고 현재가 9,500은 그 안
const bins = [];
for (let i = 0; i < 80; i++) {
  const low = 6000 + i * 100;
  const inZone = low >= 9050 && low < 11350;
  bins.push({ low, high: low + 100, volume: inZone ? 3000 + (i % 5) * 200 : 300 + (i % 3) * 50 });
}
const closes = bins.map((b) => b.low + 50);
const analysis = VP.analyze(bins, 9500, closes, { format: (v) => Number(v).toLocaleString('ko-KR') });
assert(analysis && analysis.state, 'state present');
const panel = { hidden: true, style: {}, innerHTML: '', querySelector() { return null; } };
api.renderVpPanel(panel, analysis, { isUs: false, barCount: 357, unit: '일봉', step: 50 });
const html = panel.innerHTML;
assert(/매물대 분석/.test(html));
assert(/일봉 357개 · 구간 50원 · 추정치/.test(html), 'short head');
assert(!/고가~저가에 거래량을 나눈 추정치\(체결가 기준 아님\)<\/span>/.test(html), 'long explanation is not visible text');
assert(/title="화면에 보이는 357개 일봉 기준 · 가격 구간 50원 단위/.test(html), 'long explanation kept as tooltip');
assert(/class="ss-vp-state" title="[^"]+"><b>/.test(html), 'state has a full-text tooltip');
const visible = html.match(/<p class="ss-vp-state"[^>]*><b>[^<]*<\/b>([^<]*)<\/p>/)[1];
assert(visible.length < analysis.state.text.length || analysis.state.text.split(/습니다\./).length <= 2, 'visible state is the first sentence');
assert(/막대에 마우스를 올리면 구간별 추정 거래량이 보입니다\./.test(html), 'short hover hint');
assert(/저항 후보/.test(html) && /지지 후보/.test(html) && /최대 매물대/.test(html) && /위·아래/.test(html), 'four items kept');
assert(/ss-vp-dot-res/.test(html) && /ss-vp-dot-sup/.test(html) && /ss-vp-dot-poc/.test(html), 'color dots match the chart bar colors');
assert.equal(panel.style.visibility, '', 'visible');
console.log('volume profile panel compact: ok');
