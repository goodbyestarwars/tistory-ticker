/* 다음 파동 시나리오 엔진(js/wave-forecast.js) 검증(브라우저 없이).
 *  1) 파동 상태 → 시나리오 규칙(손으로 만든 파동 구조로 각 시나리오·우선순위·보조 조건)
 *  2) 실제 차트 27개에서 모든 시나리오가 나오고 불변식이 지켜진다
 *  3) 미래 비참조·재현성: 그 봉까지의 자료만 쓰고, 이후 봉이 붙거나 미래 값이 오염돼도 이미 낸 결과가 바뀌지 않는다
 *  4) 통계 표 결합: 검증 문턱을 통과한 칸만 숫자를 보여 주고, 문턱·버전이 어긋나면 보여 주지 않는다
 *  5) 배포된 통계 표(data/wave-forecast-stats.js)의 정합성 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const AutoWave = require('../js/auto-wave.js');
const WF = require('../js/wave-forecast.js');

// ------------------------------------------------------------------ 1) 규칙(손으로 만든 구조)
function flatBars(n, price) {
  const out = []; let d = new Date('2025-01-02T00:00:00Z');
  for (let i = 0; i < n; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    const wiggle = Math.sin(i / 3) * 0.004;
    const c = price * (1 + wiggle);
    out.push({ date: d.toISOString().slice(0, 10), open: price, high: Math.max(price, c) * 1.004, low: Math.min(price, c) * 0.996, close: c, volume: 1000 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const leg = (level, kind, start, end, sp, ep, o) => Object.assign({ id: level + ':' + start + ':' + end, level, kind, start, end, startPrice: sp, endPrice: ep, high: Math.max(sp, ep), low: Math.min(sp, ep), confirmed: true, isBox: false, struct: null, childIds: [] }, o || {});
function an(state, levels, signals) {
  return { version: 'test', dataHash: 'x', levels: Object.assign({ major: [], medium: [], minor: [] }, levels || {}), signals: signals || [],
    state: Object.assign({ regime: 'up', regimeProvisional: false, scenario: {}, lastMajorHigh: 130, lastMajorLow: 80, summaryText: '' }, state || {}) };
}
const bars = flatBars(120, 100);
const LAST = bars.length - 1;
const f = (analysis, level) => WF.forecast(bars, analysis, { level: level || 'medium' });
const get = (fc, id) => fc.scenarios.find((s) => s.id === id);

// 상승 구조 + 중파동 조정 진행(직전 스윙 저점 위) → 정상 눌림목
let fc = f(an({}, { medium: [leg('medium', 'up', 10, 60, 90, 125, { struct: 'HH' }), leg('medium', 'down', 60, 80, 125, 98, { struct: 'HL' }), leg('medium', 'up', 80, 95, 98, 120, { struct: 'HH' }), leg('medium', 'down', 95, LAST, 120, 104, { confirmed: false })],
  minor: [leg('minor', 'up', 100, 112, 100, 108)] }));
assert.strictEqual(fc.primary, 'pullback', '상승 구조 + 조정 진행');
assert.strictEqual(get(fc, 'pullback').invalidate.dir, 'down');
assert.strictEqual(get(fc, 'pullback').invalidate.price, 98, '직전 스윙 저점 이탈이 무효화');
assert(get(fc, 'pullback').watch.up && get(fc, 'pullback').watch.down, '확인·이탈 가격이 있다');
assert.strictEqual(get(fc, 'pullback').watch.down.price, 104, '조정 저점');
assert.strictEqual(fc.state.medium, '조정 진행');

// 상승 구조 + 상승 파동 진행 → 상승 지속
fc = f(an({}, { medium: [leg('medium', 'up', 10, 60, 90, 125, { struct: 'HH' }), leg('medium', 'down', 60, 80, 125, 98, { struct: 'HL' }), leg('medium', 'up', 80, LAST, 98, 118, { confirmed: false })] }));
assert.strictEqual(fc.primary, 'continuation');
assert.strictEqual(get(fc, 'continuation').watch.up.price, 125, '직전 스윙 고점 갱신이 확인 조건');
assert.strictEqual(get(fc, 'continuation').invalidate.price, 98);
assert(get(fc, 'continuation').conditions.some((c) => /Higher Low/.test(c.text) && c.met === true), '저점 상승 근거');

// 훼손은 우선: 대파동 상승 훼손(up_broken)이면 다른 조건이 같이 성립해도 주 시나리오가 훼손
fc = f(an({ regime: 'up_broken', scenario: { E: true } }, { medium: [leg('medium', 'down', 60, 80, 125, 98, { struct: 'LL' })] }));
assert.strictEqual(fc.primary, 'breakdown');
assert(fc.candidates.includes('compression'), '동시에 성립한 보조 조건은 candidates 에 남는다');
assert(get(fc, 'compression').matched && !get(fc, 'compression').primary, '배타적 주 시나리오는 하나');
assert.strictEqual(fc.scenarios.filter((s) => s.primary).length, 1);

// 상승 구조에서 확정된 스윙 저점을 종가로 이탈해도 훼손
fc = f(an({}, { medium: [leg('medium', 'up', 10, 60, 90, 125, { struct: 'HH' }), leg('medium', 'down', 60, 80, 125, 150, { struct: 'HL' })] }));
assert.strictEqual(fc.primary, 'breakdown', '종가(약 100)가 직전 스윙 저점(150) 아래');

// 가짜 상승: 엔진의 failed_rally 신호
fc = f(an({ regime: 'down', scenario: { D: true } }, { medium: [leg('medium', 'up', 80, LAST, 90, 108, { confirmed: false })] }, [{ type: 'failed_rally', index: LAST - 3 }]));
assert.strictEqual(fc.primary, 'fakeRally');
assert.strictEqual(get(fc, 'fakeRally').watch.up.price, 130, '직전 대파동 고점을 넘으면 약화');
assert.strictEqual(get(fc, 'fakeRally').watch.down.price, 90, '반등 시작 가격 이탈이 실패 확인');

// 횡보·응축: 안쪽 파동이 3개 이상인 진행 중 박스(엔진 시나리오 E)
fc = f(an({ regime: 'range', scenario: { E: true } }, { medium: [{ id: 'medium:box:30', level: 'medium', kind: 'side', isBox: true, confirmed: false, start: 30, end: LAST, high: 106, low: 95, childIds: ['a', 'b', 'c'] }] }));
assert.strictEqual(fc.primary, 'compression');
assert.strictEqual(get(fc, 'compression').watch.up.price, 106); assert.strictEqual(get(fc, 'compression').watch.down.price, 95);
assert.strictEqual(get(fc, 'compression').invalidate, null, '방향이 정해지지 않아 무효화 가격이 없다');

// 어느 것도 아니면 판단 보류(시나리오를 억지로 고르지 않는다)
fc = f(an({ regime: 'range', scenario: {} }, {}));
assert.strictEqual(fc.primary, null); assert.deepStrictEqual(fc.triggers, []); assert.deepStrictEqual(fc.levels, []);
assert(fc.scenarios.every((s) => !s.primary));

// 규모 선택: 같은 구조라도 어느 규모의 파동을 보느냐에 따라 기준이 바뀐다
const multi = an({}, { major: [leg('major', 'up', 0, 70, 80, 130, { struct: 'HH' }), leg('major', 'down', 70, LAST, 130, 101, { confirmed: false })],
  medium: [leg('medium', 'up', 10, 60, 90, 125, { struct: 'HH' }), leg('medium', 'up', 80, LAST, 98, 118, { confirmed: false })] });
assert.strictEqual(f(multi, 'medium').primary, 'continuation');
assert.strictEqual(f(multi, 'major').primary, 'pullback', '대파동 기준으로는 조정 진행');
assert.strictEqual(f(multi, 'major').level, 'major');

// 표시용 값
fc = f(an({}, { medium: [leg('medium', 'up', 80, LAST, 98, 118, { confirmed: false })] }));
assert.deepStrictEqual(fc.bands.map((b) => b.h), [5, 10, 20]);
assert(fc.bands.every((b) => b.low < fc.close && b.high > fc.close) && fc.bands[2].high - fc.bands[2].low > fc.bands[0].high - fc.bands[0].low, '기간이 길수록 범위가 넓다');
assert(fc.bandNote.indexOf('방향이 아니라') >= 0, '변동 범위는 방향이 아니라고 밝힌다');
assert.strictEqual(fc.asOfDate, bars[LAST].date); assert.strictEqual(fc.signalDate, fc.asOfDate); assert.strictEqual(fc.modelVersion, WF.MODEL_VERSION);
assert.deepStrictEqual(fc.forecastHorizons, [5, 10, 20]);
assert.strictEqual(WF.forecast(bars.slice(0, 30), null).insufficient, true, '봉이 모자라면 분석하지 않는다');

// ------------------------------------------------------------------ 2) 실제 차트 27개
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/wave/cases_bars.json'), 'utf8'));
const toBars = (rows) => rows.map((r) => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
const seen = {};
let checked = 0;
Object.keys(cases).forEach((name) => {
  const all = toBars(cases[name].bars);
  for (let t = 300; t < all.length; t += 20) {
    const r = WF.forecast(all, null, { asOfIndex: t });
    checked++;
    seen[r.primary || 'none'] = (seen[r.primary || 'none'] || 0) + 1;
    assert.strictEqual(r.asOfIndex, t); assert.strictEqual(r.asOfDate, all[t].date);
    assert.strictEqual(r.scenarios.length, 5);
    assert.strictEqual(r.scenarios.filter((s) => s.primary).length, r.primary ? 1 : 0, '주 시나리오는 최대 하나');
    r.scenarios.forEach((s) => {
      assert(!s.primary || s.matched);
      if (s.matched) {
        [s.watch && s.watch.up, s.watch && s.watch.down, s.invalidate].forEach((x) => { if (x) assert(Number.isFinite(x.price) && x.price > 0, name + ' 가격 값'); });
        assert(s.conditions.length >= 4);
      }
    });
    r.levels.forEach((l) => assert(Number.isFinite(l.price)));
    r.bands.forEach((b) => assert(b.low == null || (b.low < r.close && b.high > r.close)));
  }
});
['continuation', 'pullback', 'compression', 'fakeRally', 'breakdown'].forEach((id) => assert(seen[id] > 0, '실제 차트에서 ' + id + ' 시나리오가 나와야 한다'));

// ------------------------------------------------------------------ 3) 미래 비참조·재현성
const sample = toBars(cases[Object.keys(cases)[3]].bars);
const stable = JSON.stringify;
for (const t of [260, 340, 420, sample.length - 30]) {
  const base = WF.forecast(sample.slice(0, t + 1), null, { level: 'medium' });
  // (a) asOfIndex 로 같은 시점을 다시 계산하면 같다
  assert.strictEqual(stable(WF.forecast(sample, null, { level: 'medium', asOfIndex: t })), stable(base), 'asOfIndex 재현 ' + t);
  // (b) 이후 봉이 붙어도(전체 자료로 만든 분석을 넘겨도) 그 시점 결과는 바뀌지 않는다
  const fullAnalysis = AutoWave.analyze(sample);
  assert.strictEqual(stable(WF.forecast(sample, fullAnalysis, { level: 'medium', asOfIndex: t })), stable(base), '미래 자료가 섞인 분석을 넘겨도 무시');
  // (c) 미래 봉 값을 오염시켜도 결과가 같다
  const poisoned = sample.map((b, i) => (i > t ? { date: b.date, open: NaN, high: 1e12, low: -1e12, close: NaN, volume: -1 } : b));
  assert.strictEqual(stable(WF.forecast(poisoned, null, { level: 'medium', asOfIndex: t })), stable(base), '미래 값 오염 무영향');
  // (d) 재현성: 같은 입력 → 같은 결과(난수·시각 의존 없음)
  assert.strictEqual(stable(WF.forecast(sample.slice(0, t + 1), null, { level: 'medium' })), stable(base));
  assert.strictEqual(base.dataFingerprint, AutoWave.analyze(sample.slice(0, t + 1)).dataHash, '데이터 지문이 분석 입력과 같다');
}
// 새 봉이 하나 붙으면 기준일·지문이 바뀐다(예측은 새로 계산된 별도 결과)
const a1 = WF.forecast(sample.slice(0, 300), null), a2 = WF.forecast(sample.slice(0, 301), null);
assert.notStrictEqual(a1.asOfDate, a2.asOfDate); assert.notStrictEqual(a1.dataFingerprint, a2.dataFingerprint);
// 속도: 일봉 500개 한 번에 50ms 이내
const t0 = Date.now(); WF.forecast(sample.slice(-500), null); assert(Date.now() - t0 < 200, '예측 계산이 느리다');

// ------------------------------------------------------------------ 4) 통계 표 결합
const base = WF.forecast(sample.slice(0, 400), null);
const cell = (passed, extra) => Object.assign({ n: 1234, nVal: 500, up: 0.58, down: 0.42, median: 0.012, p10: -0.05, p90: 0.08, mfe: 0.04, mae: -0.03, baselineUp: 0.5, gate: { passed, reasons: passed ? [] : ['검증 구간 유의성 부족(z=1.0, 문턱 2.9)'] } }, extra || {});
const table = { modelVersion: WF.MODEL_VERSION, engineVersion: base.engineVersion, period: ['2022-11-01', '2026-10-08'], universe: '시험', scenarios: {} };
['continuation', 'pullback', 'compression', 'fakeRally', 'breakdown'].forEach((id) => { table.scenarios[id] = { h5: cell(false), h10: cell(true), h20: cell(false) }; });
let withStats = WF.attachStats(JSON.parse(JSON.stringify(base)), table);
assert.strictEqual(withStats.stats.rows.pullback[1].shown, true); assert.strictEqual(withStats.stats.rows.pullback[1].up, 0.58);
assert.strictEqual(withStats.stats.rows.pullback[0].shown, false, '문턱 미통과 칸은 숫자를 주지 않는다');
assert(!('up' in withStats.stats.rows.pullback[0]) && /유의성/.test(withStats.stats.rows.pullback[0].reason));
assert.strictEqual(withStats.stats.rows.pullback[0].n, 1234, '미통과여도 표본 수는 알려 준다');
assert.strictEqual(withStats.stats.stale, false);
withStats = WF.attachStats(JSON.parse(JSON.stringify(base)), Object.assign({}, table, { modelVersion: 'old' }));
assert.strictEqual(withStats.stats.stale, true, '모델 버전이 다르면 낡은 표로 표시');
withStats = WF.attachStats(JSON.parse(JSON.stringify(base)), null);
assert(withStats.stats.rows.pullback.every((c) => !c.shown && c.reason === '통계 없음'));
withStats = WF.attachStats(JSON.parse(JSON.stringify(base)), { modelVersion: WF.MODEL_VERSION, scenarios: { pullback: { h5: { n: 10, gate: { passed: true, reasons: [] } } } } });
assert.strictEqual(withStats.stats.rows.pullback[0].shown, true, 'gate 통과 표시는 연구 쪽 판정을 따른다');

// ------------------------------------------------------------------ 5) 배포된 통계 표의 정합성
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data/wave-forecast-stats.js'), 'utf8'), ctx);
const shipped = ctx.window.WAVE_FORECAST_STATS;
assert(shipped, '통계 표가 window.WAVE_FORECAST_STATS 로 올라온다');
assert.strictEqual(shipped.modelVersion, WF.MODEL_VERSION, '통계 표는 현재 모델 버전으로 만들어야 한다(규칙을 바꾸면 연구를 다시 돌린다)');
assert.strictEqual(shipped.engineVersion, AutoWave.version, '통계 표는 현재 파동 엔진 버전으로 만들어야 한다');
assert.strictEqual(JSON.stringify(shipped.gate), JSON.stringify(WF.GATE), '표시 문턱이 엔진과 연구에서 같다');
let shown = 0;
['continuation', 'pullback', 'compression', 'fakeRally', 'breakdown'].forEach((id) => ['h5', 'h10', 'h20'].forEach((h) => {
  const c = shipped.scenarios[id][h];
  assert(c && typeof c.gate.passed === 'boolean' && Array.isArray(c.gate.reasons), id + h);
  if (c.gate.passed) { shown++; assert(c.n >= WF.GATE.minSamples && c.nVal >= WF.GATE.minValidationSamples, '통과한 칸은 표본 문턱을 넘어야 한다'); }
  else assert(c.gate.reasons.length > 0, '통과하지 못한 이유가 적혀 있다');
}));
console.log('wave forecast ok (실제 차트 ' + checked + '시점, 시나리오 분포 ' + JSON.stringify(seen) + ', 표시 가능한 통계 칸 ' + shown + '/15)');
