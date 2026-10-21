// 차트검색 매물대(2026-10-22): 구간 크기는 확대·축소가 아니라 가격대로 고정(18만원대 500원). stock-search.js 안의 순수 함수만 떼어 검증한다.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('js/stock-search.js', 'utf8');
const from = src.indexOf('  var VP_CORE_RATIO');
const to = src.indexOf('  function publishVolumeProfile');
assert(from > 0 && to > from, 'profile helpers found');
const api = new Function(src.slice(from, to).replace(/^\s*function publishVolumeProfile[\s\S]*$/, '') + '\nreturn { vpFixedStep: vpFixedStep, computeVolumeProfile: computeVolumeProfile, VP_MAX_BINS: VP_MAX_BINS };')();

// 가격대별 단위
assert.equal(api.vpFixedStep(179300, false), 500, '18만원대는 500원');
assert.equal(api.vpFixedStep(72000, false), 100);
assert.equal(api.vpFixedStep(5200, false), 10);
assert.equal(api.vpFixedStep(1500, false), 5);
assert.equal(api.vpFixedStep(650000, false), 1000);
assert.equal(api.vpFixedStep(180, true), 0.5, '미국 180달러는 0.5달러');
assert.equal(api.vpFixedStep(25, true), 0.1);

// 구간이 단위의 배수에 정렬되고 확대·축소(구간 수 인자)와 무관하다
function mkBars(n, base, spread) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const mid = base + Math.sin(i / 5) * spread;
    out.push({ low: mid - spread / 4, high: mid + spread / 4, close: mid, volume: 1000 + (i % 7) * 100 });
  }
  return out;
}
const bars = mkBars(120, 180000, 20000);
const a = api.computeVolumeProfile(bars, 10, false), b = api.computeVolumeProfile(bars, 160, false);
assert.equal(a.binSize, 500);
assert.deepEqual(a.bins.map((x) => [x.low, x.high]), b.bins.map((x) => [x.low, x.high]), 'bin count argument no longer changes the bins');
a.bins.forEach((x) => { assert.equal(x.low % 500, 0); assert.equal(x.high - x.low, 500); });
assert(a.bins.some((x) => x.volume > 0));
// 거래량 합은 보존된다(구간으로 나눠도 총량이 같다)
const total = bars.reduce((s, d) => s + d.volume, 0);
assert(Math.abs(a.bins.reduce((s, x) => s + x.volume, 0) - total) < 1e-6 * total);
// 너무 긴 기간은 정수배로 키워 구간 수가 300 이하
const wide = mkBars(300, 100000, 90000);
const w = api.computeVolumeProfile(wide, 0, false);
assert(w.bins.length <= api.VP_MAX_BINS + 1, 'bins capped');
assert(w.binSize % 500 === 0 && w.binSize >= 500);
console.log('volume profile fixed step: ok');
