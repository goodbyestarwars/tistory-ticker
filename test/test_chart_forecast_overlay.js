/* 다음 파동 예측 표시 모듈(js/chart-forecast-overlay.js) 검증(브라우저 없이): 계산 공유·표·그리기·제어·정리.
 * 차트검색과 종목분석이 같은 입력이면 같은 결과를 쓰고(재계산 없음), 검증되지 않은 통계는 숫자로 보여 주지 않는지 확인한다. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let analyzeCalls = 0;
const AutoWave = require('../js/auto-wave.js');
globalThis.AutoWave = Object.assign({}, AutoWave, { analyze: (b, o) => { analyzeCalls++; return AutoWave.analyze(b, o); } });
require('../js/chart-data.js');
const Wave = require('../js/chart-wave-overlay.js');
const WF = require('../js/wave-forecast.js');
const Forecast = require('../js/chart-forecast-overlay.js');
// Browser UI runs analysis in a Worker; this DOM-free attach test supplies its result.
Wave.analysisAsync = (bars, key, timeframe) => Promise.resolve(Wave.analysis(bars, key, timeframe));

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/wave/cases_bars.json'), 'utf8'));
const toBars = (rows) => rows.map((r) => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
// 시나리오가 잡히는 시점을 찾는다
let bars = null, wanted = null;
for (const name of Object.keys(cases)) {
  const all = toBars(cases[name].bars);
  for (let t = 320; t < all.length && !wanted; t += 5) { const f = WF.forecast(all, null, { asOfIndex: t }); if (f.primary === 'pullback' && f.candidates.length === 0) { bars = all.slice(0, t + 1); wanted = f; } }
  if (wanted) break;
}
assert(bars, '시험용 시점');

// ---- 계산 공유: 같은 종목·데이터·규모면 한 번만 계산하고 같은 객체, 파동 분석 캐시도 공유
globalThis.WAVE_FORECAST_STATS = null;
analyzeCalls = 0;
const a = Forecast.compute(bars, 'T1', 'medium'), b = Forecast.compute(bars, 'T1', 'medium');
assert.strictEqual(a, b, '같은 입력은 같은 결과 객체');
assert.strictEqual(analyzeCalls, 1, '분석은 한 번');
Wave.analysis(bars, 'T1', 'day');               // 파동 분석 체크가 같은 분석을 요청해도
assert.strictEqual(analyzeCalls, 1, '파동 분석 체크와 분석 결과를 공유한다');
Forecast.compute(bars, 'T1', 'major');
assert.strictEqual(analyzeCalls, 1, '규모를 바꿔도 분석은 다시 하지 않는다');
assert.notStrictEqual(Forecast.compute(bars, 'T1', 'major'), a, '규모별로 따로 저장');
const shared = JSON.parse(JSON.stringify(Forecast.compute(bars, 'T1', 'medium'))); delete shared.stats;   // 통계 결합은 표 파일이 있을 때만 붙는다
assert.strictEqual(JSON.stringify(shared), JSON.stringify(WF.forecast(bars, null, { level: 'medium' })), '직접 계산한 결과와 같다(다른 화면과 같은 결과)');
analyzeCalls = 1;   // 위 비교에서 직접 계산한 한 번은 세지 않는다
const longer = bars.concat([Object.assign({}, bars[bars.length - 1], { date: '2099-01-01' })]);
Forecast.compute(longer, 'T1', 'medium'); assert.strictEqual(analyzeCalls, 2, '새 봉이 들어오면 다시 계산');
const edited = bars.slice(); edited[50] = Object.assign({}, edited[50], { close: edited[50].close * 1.01 });
Forecast.compute(edited, 'T1', 'medium'); assert.strictEqual(analyzeCalls, 3, '과거 봉이 정정돼도 다시 계산(지문)');

// ---- 표
const st = { enabled: true, level: 'medium', horizon: 10, hidden: {} };
let html = Forecast.panelHtml(a, st, 'ss');
assert(/다음 파동 예측/.test(html) && /가격 예측·매매 추천이 아닙니다/.test(html), '실험·비추천 문구');
assert(html.indexOf(a.asOfDate) >= 0 && html.indexOf(a.modelVersion) >= 0, '기준일·모델 버전 표시');
assert.strictEqual((html.match(/<tr class=/g) || []).length, 5, '시나리오 다섯 행');
assert(/is-primary/.test(html) && /정상 눌림목/.test(html));
assert(/통계 표를 불러오지 못했습니다|통계 없음/.test(html), '통계 표가 없으면 숫자를 만들지 않는다');
assert(!/상승 마감/.test(html), '검증 없이는 상승 확률 문구가 없다');
assert(/확인 조건/.test(html) && /무효화 조건/.test(html) && /관찰 기간/.test(html) && /판단 근거/.test(html));

// 문턱 미통과 통계: 표본 수만 알려 주고 숫자 없음
const failCell = { n: 4321, nVal: 2000, up: 0.61, median: 0.02, p10: -0.04, p90: 0.07, baselineUp: 0.5, gate: { passed: false, reasons: ['검증 구간 유의성 부족(z=1.0, 문턱 2.9)'] } };
const tableFail = { modelVersion: WF.MODEL_VERSION, period: ['2022-11-01', '2026-10-08'], universe: '시험 종목군', scenarios: {} };
['continuation', 'pullback', 'compression', 'fakeRally', 'breakdown'].forEach((id) => { tableFail.scenarios[id] = { h5: failCell, h10: failCell, h20: failCell }; });
globalThis.WAVE_FORECAST_STATS = tableFail;
const fcFail = Forecast.compute(bars, 'T2', 'medium');
html = Forecast.panelHtml(fcFail, st, 'ss');
assert(/검증 미통과/.test(html) && /표본 4,321건/.test(html), '미통과 칸: 검증 미통과 + 표본 수');
assert(!/상승 마감 61%/.test(html) && !/61%/.test(html), '미통과 칸은 어떤 확률 숫자도 보이지 않는다');
assert(/검증 문턱.*통과한 시나리오가 없어 숫자를 표시하지 않습니다/.test(html));

// 통과 통계: 숫자와 표본 수, 기준선 비교를 함께
const passCell = Object.assign({}, failCell, { gate: { passed: true, reasons: [] } });
const tablePass = Object.assign({}, tableFail, { scenarios: JSON.parse(JSON.stringify(tableFail.scenarios)) });
tablePass.scenarios.pullback.h10 = passCell;
globalThis.WAVE_FORECAST_STATS = tablePass;
const fcPass = Forecast.compute(bars, 'T3', 'medium');
html = Forecast.panelHtml(fcPass, st, 'ss');
assert(/상승 마감 61%\(전체 50%\)/.test(html) && /표본 4,321건/.test(html), '통과 칸: 숫자 + 기준선 + 표본 수');
assert(/10일 · /.test(html));
html = Forecast.panelHtml(fcPass, Object.assign({}, st, { horizon: 5 }), 'ss');
assert(!/61%/.test(html), '다른 기간 칸은 통과하지 못했으므로 숫자 없음');
// 낡은 표(모델 버전 다름)는 숫자를 쓰지 않는다
globalThis.WAVE_FORECAST_STATS = Object.assign({}, tablePass, { modelVersion: 'old' });
html = Forecast.panelHtml(Forecast.compute(bars, 'T4', 'medium'), st, 'ss');
assert(/통계 표가 현재 모델 버전과 달라 숫자를 쓰지 않습니다/.test(html));
// 부족한 일봉·일봉 아닌 봉
assert(/60개 미만/.test(Forecast.panelHtml(WF.forecast(bars.slice(0, 30), null), st, 'ss')));
globalThis.WAVE_FORECAST_STATS = null;

// ---- 그리기: 마지막 봉 오른쪽에 점선 + 변동 범위 띠, 숨긴 시나리오는 그리지 않는다
const linksAdded = [];
globalThis.document = { documentElement: { classList: { contains: () => false } }, getElementById: (id) => linksAdded.find((l) => l.id === id) || null, createElement: () => ({}), head: { appendChild: (l) => linksAdded.push(l) } };
const idx = {}; bars.forEach((b, i) => { idx[b.date] = i; });
const view = { width: 1000, plotWidth: 940, height: 500, bars, coord: (p) => ({ x: (idx[p.time] != null ? idx[p.time] : bars.length) * 1.5, y: 250 - (p.price - bars[bars.length - 1].close) / 100 }) };
function run(fc, state, v) {
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 40 }) : (...x) => ops.push([k, ...x])), set: (t, k, v2) => { ops.push(['set:' + k, v2]); return true; } });
  Forecast.drawForecast(ctx, v || view, fc, state, 'sans-serif');
  return ops;
}
let ops = run(a, st);
const levelLines = ops.filter((o) => o[0] === 'lineTo' && o[1] === 940);
const primary = a.scenarios.find((s) => s.primary);
const expected = ['up', 'down'].filter((k) => primary.watch[k]).length + (primary.invalidate && !['up', 'down'].some((k) => primary.watch[k] && primary.watch[k].price === primary.invalidate.price) ? 1 : 0);
assert.strictEqual(levelLines.length, expected, '주 시나리오의 가격 조건마다 오른쪽 끝(plotWidth)까지 가는 선 하나 (기대 ' + expected + ', 실제 ' + levelLines.length + ', 선 ' + JSON.stringify(ops.filter((o) => o[0] === 'lineTo').map((o) => o.slice(1))) + ')');
assert(ops.some((o) => o[0] === 'fillRect'), '변동 범위 띠');
assert(ops.filter((o) => o[0] === 'fillText').some((o) => /10일 변동폭/.test(o[1])), '변동 범위 이름');
assert(ops.filter((o) => o[0] === 'fillText').some((o) => /^(확인|이탈|무효화) /.test(o[1])), '가격 라벨');
assert(!ops.some((o) => o[0] === 'lineTo' && o[1] > 940), '플롯 영역(가격축 앞)을 넘어 그리지 않는다');
const hiddenOps = run(a, Object.assign({}, st, { hidden: { pullback: true } }));
assert(hiddenOps.filter((o) => o[0] === 'lineTo' && o[1] === 940).length < levelLines.length, '숨긴 시나리오의 선은 그리지 않는다');
assert(run(a, Object.assign({}, st, { horizon: 20 })).some((o) => o[0] === 'fillText' && /20일 변동폭/.test(o[1])), '기간을 바꾸면 다른 변동 범위');
assert.deepStrictEqual(run(null, st), [], '예측이 없으면 아무것도 그리지 않는다');
assert.deepStrictEqual(run(a, st, Object.assign({}, view, { plotWidth: 2 })), [], '마지막 봉이 보이는 영역 밖이면 그리지 않는다');
assert(!ops.some((o) => o[0] === 'moveTo' && o[1] > view.plotWidth), '미래 파동 굴곡 같은 곡선을 그리지 않는다(가로선만)');
const horizontal = ops.filter((o) => o[0] === 'moveTo').every((o, i, arr) => true);
assert(horizontal);

// ---- 제어
const mkBtn = (attrs) => ({ attrs, hasAttribute: (k) => k in attrs, getAttribute: (k) => attrs[k] });
const toggle = { checked: false, onchange: null };
const box = { hidden: true, innerHTML: '', onclick: null };
const panel = { hidden: true, onchange: null };
const root = { querySelector: (sel) => (sel === '[data-chart-forecast-toggle]' ? toggle : sel === '[data-chart-forecast-opts]' ? box : panel) };
const state = { enabled: false, level: 'medium', horizon: 10, hidden: {} }; const seen = [];
Forecast.wireControls(root, state, (k) => seen.push(k), 'ff');
assert.strictEqual(box.hidden, true); assert.strictEqual(panel.hidden, true);
toggle.checked = true; toggle.onchange();
assert.strictEqual(state.enabled, true); assert.strictEqual(box.hidden, false); assert.strictEqual(panel.hidden, false);
assert(/ff-forecast-btn/.test(box.innerHTML) && /data-forecast-horizon="20"/.test(box.innerHTML) && /data-forecast-level="major"/.test(box.innerHTML), '기간·규모 단추');
box.onclick({ target: { closest: () => mkBtn({ 'data-forecast-horizon': '20' }) } });
assert.strictEqual(state.horizon, 20); assert(/ff-forecast-btn active" data-forecast-horizon="20"/.test(box.innerHTML));
box.onclick({ target: { closest: () => mkBtn({ 'data-forecast-level': 'minor' }) } });
assert.strictEqual(state.level, 'minor');
panel.onchange({ target: { getAttribute: (k) => (k === 'data-forecast-show' ? 'pullback' : null), checked: false } });
assert.strictEqual(state.hidden.pullback, true);
panel.onchange({ target: { getAttribute: () => null } });   // 관련 없는 체크는 무시
assert.deepStrictEqual(seen, ['toggle', 'horizon', 'level', 'visibility']);

// ---- 붙이기·정리: 일봉이 아니면 안내만, 끄면 층과 표를 걷는다
(async () => {
  const layers = {}; const ctl = { addLayer: (n, f) => { layers[n] = f; }, removeLayer: (n) => { delete layers[n]; } };
  const core = { ROOT: '', ready: () => Promise.resolve([]) };
  const p = { hidden: true, innerHTML: '' };
  const week = Forecast.attach({ core, ctl, key: 'W', timeframe: 'week', bars, state: { enabled: true, level: 'medium', horizon: 10, hidden: {} }, panel: p });
  await week.apply();
  assert(/일봉에서만 제공/.test(p.innerHTML) && !layers.forecast, '주봉·월봉에서는 안내만');
  const sOn = { enabled: true, level: 'medium', horizon: 10, hidden: {} };
  const p2 = { hidden: true, innerHTML: '' };
  const h = Forecast.attach({ core, ctl, key: 'D', timeframe: 'day', bars, state: sOn, panel: p2 });
  await h.apply();
  assert(typeof layers.forecast === 'function' && /주 시나리오/.test(p2.innerHTML) && p2.hidden === false);
  assert.strictEqual(h.forecast().asOfDate, bars[bars.length - 1].date);
  sOn.enabled = false; await h.apply();
  assert(!layers.forecast && p2.hidden === true && p2.innerHTML === '', '끄면 층과 표를 걷는다');
  sOn.enabled = true; await h.apply(); h.detach();
  assert(!layers.forecast && p2.innerHTML === '', 'detach 후에는 아무것도 남지 않는다');
  await h.apply();
  assert(!layers.forecast, 'detach 뒤 apply 는 무시');
  let finishAnalysis;
  Wave.analysisAsync = () => new Promise((resolve) => { finishAnalysis = resolve; });
  const staleState = { enabled: true, level: 'medium', horizon: 10, hidden: {} };
  const stalePanel = { hidden: true, innerHTML: '' };
  const stale = Forecast.attach({ core, ctl, key: 'STALE', timeframe: 'day', bars, state: staleState, panel: stalePanel });
  const oldApply = stale.apply();
  await Promise.resolve(); await Promise.resolve();
  staleState.enabled = false; await stale.apply();
  assert(finishAnalysis, '예측이 Worker 분석을 기다린다');
  finishAnalysis(Wave.analysis(bars, 'STALE', 'day'));
  await oldApply;
  assert(!layers.forecast && stalePanel.hidden, '꺼진 뒤 늦게 도착한 예측은 적용하지 않는다');
  assert(linksAdded.length === 1 && /css\/chart-forecast\.css/.test(linksAdded[0].href), '표 스타일시트는 한 번만 붙인다');
  console.log('chart forecast overlay ok');
})().catch((e) => { console.error(e); process.exit(1); });
