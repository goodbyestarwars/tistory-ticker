
require('./helpers/common_runtime');
/* 지지·저항 강도·전환(js/chart-sr.js enrichLevel), 거래량 체감 배수(chart-core), 이동평균선 그룹(chart-core),
 * 추세선·이탈 판정(chart-wave-overlay trendLinesOf) 검증(브라우저 없이). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
globalThis.window = globalThis;
globalThis.document = {};
require('../js/chart-sr.js');
const SR = globalThis.NineChartSR;

function day(i) { const d = new Date(Date.UTC(2024, 0, 1 + i)); return d.toISOString().slice(0, 10); }
function bar(i, c, spread, vol) { return { date: day(i), open: c, high: c + spread, low: c - spread, close: c, volume: vol == null ? 1000 : vol }; }

// ---- 지지·저항 강도·전환 ----
// 저항 100 부근에서 여러 번 막히다가 돌파하고, 되돌려 100을 건드리고 지지받는다.
const flipBars = [];
let t = 0;
function push(c, spread, vol) { flipBars.push(bar(t++, c, spread, vol)); }
for (let k = 0; k < 4; k++) { for (let i = 0; i < 12; i++) push(90 + i * 0.7, 0.6, 1000); push(99.5, 1.6, 1000); for (let i = 0; i < 6; i++) push(95 - i * 0.4, 0.6, 1000); }
for (let i = 0; i < 12; i++) push(100 + i * 1.5, 0.6, 3000);   // 돌파(종가 100 위 유지)
push(101, 2.5, 3500);                                          // 되돌림: 100 부근을 건드리고 위로 마감
for (let i = 0; i < 20; i++) push(110 + i * 0.3, 0.6, 1500);
const flipResult = SR.levels(flipBars, null, { timeframe: 'day' });
const levels = flipResult.support.concat(flipResult.resistance);
assert.ok(levels.length > 0, '지지·저항이 계산된다');
levels.forEach(function (l) {
  assert.ok(Number.isInteger(l.reactions) && l.reactions >= 0);
  assert.ok([0, 1, 2].includes(l.strength));
  assert.ok(l.flip === null || l.flip === 'r2s' || l.flip === 's2r');
});
const near100 = levels.find(function (l) { return Math.abs(l.price - 100) / 100 < 0.04; });
assert.ok(near100, '100 부근 가격대');
assert.strictEqual(near100.flip, 'r2s', '저항이 뚫린 뒤 되돌려 지지가 된 가격대는 전환 표시');
assert.ok(near100.retests >= 1);

// ---- 실제 일봉 픽스처: 예외 없이, 값은 범위 안 ----
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chart_core/flow_chart_005930.json'), 'utf8')).daily;
const realSr = SR.levels(real, null, { timeframe: 'day' });
realSr.support.concat(realSr.resistance).forEach(function (l) { assert.ok(l.reactions >= 0 && l.volReactions <= l.reactions); });

// 짧은 배열·빈 입력은 조용히 비어 있다
console.log('support/resistance strength OK');

// ---- 거래량 체감 배수(js/chart-core.js volumeSpikeMultiples) ----
globalThis.document = { currentScript: null, documentElement: { classList: { contains: () => false } }, head: { appendChild() {} }, querySelector: () => null, createElement: () => ({ setAttribute() {}, remove() {}, addEventListener() {} }) };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
require('../js/chart-core.js');
const Core = globalThis.NineChartCore;
const vb = [];
for (let i = 0; i < 30; i++) vb.push({ date: day(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 });
vb[25].volume = 3200;
vb[3].volume = null;
const mult = Core.volumeSpikeMultiples(vb);
assert.strictEqual(mult[0], null, '직전 봉이 10개 미만이면 null');
assert.strictEqual(mult[3], null, '빈 거래량은 null');
assert.ok(Math.abs(mult[25] - 3.2) < 0.01, '3.2배');
assert.ok(Math.abs(mult[26] - 1000 / ((3200 + 19 * 1000) / 20)) < 0.01 || mult[26] < 1, '오늘 봉은 평균에서 뺀다');
// 막대·라벨: 가짜 차트로 addVolumePane 호출
function runVolume(bars, timeScale) {
  const state = { last: null, subs: [] };
  const fakeLWC = { HistogramSeries: 'hist', LineSeries: 'line', createSeriesMarkers: () => ({ setMarkers: (m) => { state.last = m; } }) };
  const hist = [];
  const chart = { addSeries: (kind) => ({ kind, setData: (d) => { if (kind === 'hist') hist.push(...d); }, priceScale: () => ({ applyOptions() {} }) }), priceScale: () => ({ applyOptions() {} }) };
  if (timeScale) chart.timeScale = () => timeScale(state);
  Core.addVolumePane(chart, fakeLWC, bars, { pane: 1, multiples: true });
  state.hist = hist;
  return state;
}
const one = runVolume(vb, null);
assert.strictEqual(one.last.length, 1);
assert.strictEqual(one.last[0].text, '3.2배');
assert.ok(/,1\)$/.test(one.hist[25].color), '3배↑ 막대는 가장 진하게');
assert.ok(/,0\.5\)$/.test(one.hist[10].color), '보통 막대는 그대로');

// 겹침 방지: 가까운 급증 봉이 많으면 폭을 넓게 본 화면에서 큰 배수만 남는다.
const dense = [];
for (let i = 0; i < 200; i++) dense.push({ date: day(i), open: 100, high: 101, low: 99, close: 101, volume: 1000 });
[100, 102, 104, 150].forEach((i, k) => { dense[i].volume = 4000 + k * 500; });
let visible = { from: 0, to: 199 };
const wide = runVolume(dense, (st) => ({ getVisibleLogicalRange: () => visible, width: () => 400, subscribeVisibleLogicalRangeChange: (fn) => st.subs.push(fn) }));
// 400px / 200봉 = 2px/봉 -> 라벨 44px = 22봉 간격 -> 100·102·104 중 배수가 가장 큰(100) 하나와 150
assert.deepStrictEqual(wide.last.map((m) => m.time), [dense[100].date, dense[150].date]);
// 확대하면(봉이 넓어지면) 가까운 것도 다시 나온다
visible = { from: 95, to: 110 };
const wideState = wide;
wideState.subs.forEach((fn) => fn());
assert.deepStrictEqual(wideState.last.map((m) => m.time), [dense[100].date, dense[102].date, dense[104].date]);
// 켜고 끄기: 끄면 막대는 보통 진하기, 라벨은 비움 / 다시 켜면 복원
const toggled = (function () {
  const st = { last: null, hist: null };
  const fakeLWC = { HistogramSeries: 'hist', LineSeries: 'line', createSeriesMarkers: () => ({ setMarkers: (m) => { st.last = m; } }) };
  const chart = { addSeries: (kind) => ({ setData: (d) => { if (kind === 'hist') st.hist = d; }, priceScale: () => ({ applyOptions() {} }) }), priceScale: () => ({ applyOptions() {} }) };
  st.pane = Core.addVolumePane(chart, fakeLWC, vb, { pane: 1, multiples: true });
  return st;
})();
assert.ok(toggled.last.length === 1 && /,1\)$/.test(toggled.hist[25].color));
toggled.pane.setMultiples(false);
assert.strictEqual(toggled.last.length, 0);
assert.ok(/,0\.5\)$/.test(toggled.hist[25].color), '끄면 급증 봉도 보통 진하기');
toggled.pane.setMultiples(true);
assert.strictEqual(toggled.last.length, 1);
console.log('volume multiple OK');
// 기본은 끔: multiples 를 주지 않으면 막대는 보통 진하기이고 라벨이 없다
const offState = { last: [], hist: null };
Core.addVolumePane({ addSeries: (kind) => ({ setData: (d) => { if (kind === 'hist') offState.hist = d; }, priceScale: () => ({ applyOptions() {} }) }), priceScale: () => ({ applyOptions() {} }) },
  { HistogramSeries: 'hist', LineSeries: 'line', createSeriesMarkers: () => ({ setMarkers: (m) => { offState.last = m; } }) }, vb, { pane: 1 });
assert.ok(/,0\.5\)$/.test(offState.hist[25].color) && offState.last.length === 0, '기본은 끔');
console.log('volume multiple default off OK');

// ---- 이동평균선: 단기(3·5·20·60)·장기(112·224·448) 그룹, 그룹을 안 주면 예전 4개 ----
const keys = (arr) => arr.map((x) => x.key).join(',');
assert.strictEqual(keys(Core.maStudies(false, ['short'])), 'ma3,ma5,ma20,ma60');
assert.strictEqual(keys(Core.maStudies(false, ['long'])), 'ma112,ma224,ma448');
assert.strictEqual(keys(Core.maStudies(false)), 'ma5,ma20,ma60,ma224', '그룹을 안 주면 예전 4개');
const m224 = Core.maStudies(false, ['long']).find((x) => x.key === 'ma224');
assert.strictEqual(m224.width, 3);
assert.strictEqual(m224.color, '#000000', '224일선은 검정 굵게');
assert.strictEqual(Core.maStudies(true, ['long']).find((x) => x.key === 'ma224').color, '#f1f3f5', '다크모드는 밝은 회색');
assert.deepStrictEqual(Core.maStudies(false, []).length, 0);
console.log('moving average groups OK');

// ---- 추세선 + 이탈 판정(chart-wave-overlay trendLinesOf) ----
require('../js/chart-wave-overlay.js');
const Wave = globalThis.NineChartWave;
// 상승 추세: 저점 100→(i=10)110→(i=20)120→(i=30)130 (기울기 1/봉), 고점은 저점 +15. 저점 허용 오차 안에서 어긋난 점 포함.
function mkBars(n, lowAt, closeAt) {
  const out = [];
  for (let i = 0; i < n; i++) { const lo = lowAt(i), c = closeAt(i); out.push({ date: 'd' + i, open: c, high: c + 3, low: lo, close: c, volume: 1 }); }
  return out;
}
const lowOf = (i) => 100 + i;                       // 추세선 y = 100 + i
const upBars = mkBars(60, (i) => lowOf(i) - 0.5, (i) => lowOf(i) + 8);
const lowPivots = [{ kind: 'down', start: 0, end: 10, high: 118, low: 110.4 }, { kind: 'up', start: 10, end: 15, low: 110.4, high: 124 },
  { kind: 'down', start: 15, end: 20, high: 124, low: 120.3 }, { kind: 'up', start: 20, end: 25, low: 120.3, high: 134 },
  { kind: 'down', start: 25, end: 30, high: 134, low: 129.2 }, { kind: 'up', start: 30, end: 45, low: 129.2, high: 150 }];
let r = Wave.trendLinesOf(upBars, [], lowPivots);
assert.ok(r.up && r.up.m > 0, '상승 추세선이 만들어진다');
assert.ok(r.up.touches.length >= 3 && r.up.solid, '허용 오차 안의 저점 3개 이상 → 실선');
assert.strictEqual(r.up.breakIndex, -1, '이탈 없음');
// 기울기가 같은 선이 아니라 각 저점에 붙는지: 지나는 선과 저점 차이가 1.5% 이내
r.up.touches.forEach((q) => assert.ok(Math.abs(q.p - (r.up.m * q.i + r.up.b)) <= Math.max(1.5, 0.015 * q.p) + 1e-9));
// 이탈: 45봉 뒤 종가가 선 아래로 2봉 연속 크게 벗어난다
const brokenBars = mkBars(60, (i) => i < 46 ? lowOf(i) - 0.5 : lowOf(i) - 12, (i) => i < 46 ? lowOf(i) + 8 : lowOf(i) - 10);
r = Wave.trendLinesOf(brokenBars, [], lowPivots);
assert.ok(r.up && r.up.breakIndex >= 46, '2봉 연속 종가 이탈 → 추세 이탈');
// 하루만 뚫고 복귀하면 이탈이 아니다
const oneDay = mkBars(60, (i) => lowOf(i) - 0.5, (i) => i === 50 ? lowOf(i) - 10 : lowOf(i) + 8);
r = Wave.trendLinesOf(oneDay, [], lowPivots);
assert.ok(r.up && r.up.breakIndex === -1, '하루 이탈은 무시');
// 하락 추세: 고점 끼리 내려오는 선은 down(파란색 쪽)
const downBars = mkBars(60, (i) => 200 - i - 8, (i) => 200 - i - 5);
const highPivots = [{ kind: 'up', start: 0, end: 10, low: 195, high: 190 }, { kind: 'down', start: 10, end: 15, high: 190, low: 180 },
  { kind: 'up', start: 15, end: 20, low: 180, high: 180.2 }, { kind: 'down', start: 20, end: 25, high: 180.2, low: 170 },
  { kind: 'up', start: 25, end: 30, low: 170, high: 170.4 }, { kind: 'down', start: 30, end: 45, high: 170.4, low: 150 }];
r = Wave.trendLinesOf(downBars, [], highPivots);
assert.ok(r.down && r.down.m < 0 && r.down.touches.length >= 3, '하락 추세선(고점끼리)');
assert.strictEqual(Wave.trendLinesOf(upBars.slice(0, 10), [], lowPivots).up, null, '봉이 너무 적으면 긋지 않는다');
assert.strictEqual(Wave.trendLinesOf(upBars, [], []).up, null, '극점이 없으면 긋지 않는다');
console.log('wave trendline OK');

// ---- RSI 다이버전스(js/chart-divergence.js) ----
require('../js/chart-divergence.js');
const Div = globalThis.NineChartDivergence;
const rsiv = new Array(120).fill(50);
const wres = { levels: { medium: [
  { kind: 'up', start: 0, end: 20, low: 100, high: 120, confirmed: true, confirmedIndex: 24 },
  { kind: 'down', start: 20, end: 35, high: 120, low: 108, confirmed: true, confirmedIndex: 38 },
  { kind: 'up', start: 35, end: 60, low: 108, high: 130, confirmed: true, confirmedIndex: 64 },   // 가격 고점 120 -> 130
  { kind: 'down', start: 60, end: 80, high: 130, low: 98, confirmed: true, confirmedIndex: 84 },   // 가격 저점 108 -> 98
  { kind: 'up', start: 80, end: 95, low: 98, high: 115, confirmed: false },                        // 진행 중은 제외
] } };
rsiv[20] = 74; rsiv[60] = 66;   // 고점: 가격↑ RSI↓ -> 약세
rsiv[35] = 38; rsiv[80] = 44;   // 저점: 가격↓ RSI↑ -> 강세
const dl = Div.find(new Array(120).fill({}), rsiv, wres, 'medium');
assert.strictEqual(dl.length, 2);
const bear = dl.find((d) => d.kind === 'bear'), bull = dl.find((d) => d.kind === 'bull');
assert.ok(bear && bear.a.i === 20 && bear.b.i === 60 && bear.ra === 74 && bear.rb === 66);
assert.strictEqual(bear.confirmedIndex, 64, '선은 두 번째 극점이 확정된 뒤');
assert.ok(bull && bull.a.i === 35 && bull.b.i === 80);
// RSI 차이가 2 이하이거나 극점 간격이 8봉 미만이면 만들지 않는다
rsiv[60] = 73;
assert.strictEqual(Div.find(new Array(120).fill({}), rsiv, wres, 'medium').filter((d) => d.kind === 'bear').length, 0);
assert.deepStrictEqual(Div.find([], null, wres, 'medium'), []);
assert.deepStrictEqual(Div.find(new Array(5).fill({}), rsiv, null, 'medium'), []);
console.log('rsi divergence OK');
