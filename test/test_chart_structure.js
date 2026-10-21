/* 추세선·채널·박스권(js/chart-structure.js)과 지지·저항 강도·전환(js/chart-sr.js enrichLevel) 검증(브라우저 없이).
 *  - 합성 시계열로 정의대로 나오는지, 미래 봉을 보지 않는지(잘라도 같은 선·같은 이벤트), 실제 일봉 픽스처가 깨지지 않는지. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
globalThis.window = globalThis;
globalThis.document = {};
require('../js/chart-sr.js');
require('../js/chart-structure.js');
const S = globalThis.NineChartStructure, SR = globalThis.NineChartSR;

function day(i) { const d = new Date(Date.UTC(2024, 0, 1 + i)); return d.toISOString().slice(0, 10); }
function bar(i, c, spread, vol) { return { date: day(i), open: c, high: c + spread, low: c - spread, close: c, volume: vol == null ? 1000 : vol }; }

// ---- 추세 구간: 저점·고점이 함께 높아지면 상승, 함께 낮아지면 하락 ----
function zigzag(n, base, drift, amp, period) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(bar(i, base + drift * i + amp * Math.sin((i / period) * 2 * Math.PI), 1));
  return out;
}
const up = zigzag(160, 100, 0.5, 14, 20);
const upResult = S.analyze(up, { timeframe: 'day' });
assert.ok(upResult.trends.length >= 1, '상승 구간이 잡혀야 한다');
const lastUp = upResult.trends[upResult.trends.length - 1];
assert.strictEqual(lastUp.kind, 'up');
assert.ok(lastUp.slope > 0 && lastUp.pct >= 0.2);
// 채널은 구간의 모든 저점 아래·모든 고점 위를 지난다
upResult.trends.forEach(function (ph) {
  ph.pivots.forEach(function (q) {
    const v = ph.slope * q.i + (q.type === 'L' ? ph.bLow : ph.bHigh);
    if (q.type === 'L') assert.ok(q.p >= v - 1e-9, '저점은 아래선 위');
    else assert.ok(q.p <= v + 1e-9, '고점은 위선 아래');
  });
});
// 미래 비참조: 마지막 봉 몇 개를 떼어 내도 이미 확정된 첫 구간은 같다.
const cut = S.analyze(up.slice(0, -5), { timeframe: 'day' });
assert.strictEqual(cut.trends[0].start, upResult.trends[0].start);
assert.strictEqual(cut.trends[0].bLow, upResult.trends[0].bLow);

// 하락 구간
const down = zigzag(160, 200, -0.5, 14, 20);
const downResult = S.analyze(down, { timeframe: 'day' });
assert.ok(downResult.trends.length >= 1);
assert.strictEqual(downResult.trends[downResult.trends.length - 1].kind, 'down');
assert.ok(downResult.trends[downResult.trends.length - 1].pct < 0);

// 현재 상승 구간 이탈: 추세선 아래로 종가가 1% 넘게 빠지면 점과 거래량 배수가 붙고, 그 봉은 구간 끝 확정점 뒤여야 한다.
const broken = up.concat([bar(160, 150, 1, 4000), bar(161, 120, 1, 4000), bar(162, 100, 1, 4000)]);
const brk = S.analyze(broken, { timeframe: 'day' });
const cur = brk.trends[brk.trends.length - 1];
const ev = cur.events[0];
assert.ok(ev && ev.dir === 'down', '상승 추세 이탈 이벤트');
assert.ok(ev.i > cur.pivots[cur.pivots.length - 1].i, '확정점 뒤에만 찍는다');
assert.ok(ev.vol > 1, '거래량 배수 기록');
assert.strictEqual(cur.active, false);

// 수평으로만 오르내리면 추세 구간이 아니다(횡보는 박스·지지저항으로 본다)
const flat = zigzag(160, 100, 0, 14, 20);
assert.strictEqual(S.analyze(flat, { timeframe: 'day' }).trends.length, 0);

// ---- 박스권: 오르내림이 없는 횡보 뒤 거래량 실린 돌파 ----
const boxBars = zigzag(60, 100, 0, 4, 10);
const boxResult = S.analyze(boxBars, { timeframe: 'day' });
assert.ok(boxResult.box, '박스');
assert.ok(boxResult.box.ongoing);
assert.ok(boxResult.box.bars >= 15);
const exitBars = boxBars.concat([bar(60, 112, 1, 5000), bar(61, 113, 1, 3000)]);
const exitResult = S.analyze(exitBars, { timeframe: 'day' });
assert.ok(exitResult.box && exitResult.box.exit && exitResult.box.exit.dir === 'up', '박스 상단 돌파');
assert.ok(exitResult.box.exit.vol >= 4);
// 박스 범위 안에 있던 봉들만 박스 구간이다(이탈 봉은 포함하지 않는다)
assert.ok(exitResult.box.end < exitResult.box.exit.i);

// 완만한 한 방향 추세는 박스가 아니다
assert.strictEqual(S.analyze(zigzag(80, 100, 0.6, 1, 10), { timeframe: 'day' }).box, null);

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
const rr = S.analyze(real, { timeframe: 'day' });
rr.trends.forEach(function (ph) { assert.ok(ph.start < ph.end && ph.pivots.length >= 4); });
if (rr.box) { assert.ok(rr.box.top > rr.box.bottom && (rr.box.top - rr.box.bottom) / rr.box.bottom <= 0.20 + 1e-9); }
const realSr = SR.levels(real, null, { timeframe: 'day' });
realSr.support.concat(realSr.resistance).forEach(function (l) { assert.ok(l.reactions >= 0 && l.volReactions <= l.reactions); });

// 짧은 배열·빈 입력은 조용히 비어 있다
assert.strictEqual(S.analyze([], { timeframe: 'day' }).trends.length, 0);
assert.strictEqual(S.analyze(null, { timeframe: 'day' }).box, null);
assert.ok(typeof S.summary(S.analyze([], {})) === 'string');
console.log('chart structure OK');

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
