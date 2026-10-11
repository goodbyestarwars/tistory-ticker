/* 자동 파동(대·중·소) 기능 검증: node test/test_auto_wave.js
 * 구조(계층·부모 연결·규모별 입자도), 하위 호환(detectWaves), 시나리오 A~E(합성 자료), 횡보 판정을 확인한다.
 * 미래 비참조·리페인트의 엄격한 검사는 test/test_auto_wave_causality.js 가 맡는다. */
const assert = require('assert');
const AW = require('../js/auto-wave.js');
const { analyze, detectWaves } = AW;

function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
/* 구간별 목표 종가를 선형 보간하고 일정한 변동(noisePct)을 얹어 일봉을 만든다. points: [[봉 수, 목표가], ...] */
function build(start, points, noisePct, seed) {
  const r = rng(seed), closes = [start];
  points.forEach(([n, target]) => { const from = closes[closes.length - 1]; for (let k = 1; k <= n; k++) closes.push(from + (target - from) * k / n); });
  const bars = [];
  closes.forEach((c0, i) => {
    const c = c0 * (1 + (r() - 0.5) * 2 * noisePct), o = i ? bars[i - 1].close : c;
    bars.push({ date: 'd' + String(i).padStart(4, '0'), open: o, high: Math.max(o, c) * (1 + r() * noisePct * 0.8), low: Math.min(o, c) * (1 - r() * noisePct * 0.8), close: c, volume: 1000 + Math.floor(r() * 200) });
  });
  return bars;
}
const LEVELS = ['major', 'medium', 'minor'];
const legs = (res, lv) => res.levels[lv].filter((w) => !w.isBox);
const boxes = (res, lv) => res.levels[lv].filter((w) => w.isBox);

/* ── 1) 구조: 계층·id 유일·부모 연결·규모별 입자도 ── */
const walk = build(100, [[80, 140], [60, 105], [90, 160], [70, 118], [80, 175], [60, 130]], 0.02, 7);
const res = analyze(walk);
assert.strictEqual(res.version, AW.version);
assert.deepStrictEqual(Object.keys(res.levels).sort(), ['major', 'medium', 'minor']);
const all = res.waves, ids = {};
all.forEach((w) => { assert(!ids[w.id], 'id 중복 ' + w.id); ids[w.id] = w; assert(w.start >= 0 && w.end < walk.length && w.start <= w.end && w.high >= w.low); assert(LEVELS.indexOf(w.level) >= 0); });
assert(legs(res, 'minor').length >= legs(res, 'medium').length && legs(res, 'medium').length >= legs(res, 'major').length, '규모가 작을수록 파동이 더 잘게 나뉜다');
assert(legs(res, 'major').length >= 1 && legs(res, 'medium').length >= 4);
const order = { minor: 'medium', medium: 'major' };
Object.keys(order).forEach((lv) => res.levels[lv].forEach((w) => {
  if (w.parent == null) return;
  const p = ids[w.parent];
  assert(p && p.level === order[lv], '부모는 한 단계 위 규모여야 한다: ' + w.id + ' -> ' + w.parent);
  assert(p.childIds.indexOf(w.id) >= 0, '부모의 childIds 에 자식이 있어야 한다');
  assert(Math.min(w.end, p.end) - Math.max(w.start, p.start) >= 0, '부모와 시간이 겹쳐야 한다');
}));
// 확정되지 않은 파동은 규모마다 최대 하나(진행 중 파동) + 진행 중 박스
LEVELS.forEach((lv) => assert(legs(res, lv).filter((w) => !w.confirmed).length <= 1, lv + ' 진행 중 파동은 하나'));
// 확정 파동: 끝 극점은 확정 시점보다 앞, 파동은 고점-저점이 번갈아 이어진다
LEVELS.forEach((lv) => {
  const cl = legs(res, lv).filter((w) => w.confirmed).sort((a, b) => a.start - b.start);
  cl.forEach((w, i) => { assert(w.end < w.confirmedIndex && w.startConfirmedIndex <= w.confirmedIndex); if (i) { assert.strictEqual(w.start, cl[i - 1].end, lv + ' 파동은 끝점에서 이어진다'); assert.notStrictEqual(w.kind, cl[i - 1].kind, lv + ' 파동은 방향이 번갈아 바뀐다'); } });
});

/* ── 2) 하위 호환: detectWaves = 중파동(박스에 가려진 것 제외) ── */
const dw = detectWaves(walk);
assert(dw.length > 3 && dw.every((w) => w.level === 'medium' && !w.suppressed));
assert.strictEqual(dw.length, res.levels.medium.filter((w) => !w.suppressed).length);
assert.deepStrictEqual(AW.levels, ['major', 'medium', 'minor']);
assert.strictEqual(AW.defaults.levels.major.zigzagAtr, 8.0);
assert.strictEqual(AW.defaults.levels.medium.zigzagAtr, 3.0);
assert.strictEqual(AW.defaults.levels.minor.zigzagAtr, 1.5);
// 옛 평평한 옵션 이름은 중파동 설정으로 읽힌다
assert.strictEqual(analyze(walk, { zigzagAtr: 6 }).params.levels.medium.zigzagAtr, 6);
const noisy = build(100, [[60, 118], [60, 92], [60, 120], [60, 95], [60, 118], [60, 90]], 0.035, 5);
assert(legs(analyze(noisy, { zigzagAtr: 6 }), 'medium').length < legs(analyze(noisy), 'medium').length, '임계가 크면 파동이 줄어든다');

/* ── 3) 입력 방어: 짧은 자료·거래량 없음·빈 입력 ── */
assert.deepStrictEqual(analyze([]).waves, []);
assert.deepStrictEqual(analyze(null).waves, []);
assert.deepStrictEqual(analyze(walk.slice(0, 10)).waves, []);
const noVol = walk.map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close }));
assert(analyze(noVol).waves.length > 0, '거래량이 없어도 계산된다');

/* ── 4) 시나리오 A: 대 상승 중 소규모 눌림은 추세 종료가 아니다 ── */
(function () {
  const bars = build(100, [[120, 200], [12, 185], [60, 260]], 0.012, 11);
  let sawPullback = false;
  for (let t = 118; t <= 135; t++) {
    const r = analyze(bars.slice(0, t + 1)), s = r.state;
    assert.strictEqual(s.regime, 'up', 't=' + t + ' 눌림 중에도 대 구조는 상승이어야 한다(' + s.regime + ')');
    assert(!legs(r, 'major').some((w) => w.confirmed && w.kind === 'down'), '눌림으로 대 하락 파동이 확정되면 안 된다');
    if (s.scenario.A) { sawPullback = true; assert(/대 상승/.test(s.summaryText) && /조정/.test(s.summaryText), s.summaryText); assert(!/하락 전환|추세 종료/.test(s.summaryText)); }
  }
  assert(sawPullback, '눌림 구간에서 시나리오 A(대 상승 → 중 조정 → 소 하락)가 한 번은 켜진다');
  const end = analyze(bars);
  assert(legs(end, 'medium').some((w) => w.kind === 'down' && w.struct === 'HL' && w.label === '첫 눌림'), '중파동 눌림에 첫 눌림 라벨');
  assert.strictEqual(end.state.regime, 'up');
})();

/* ── 5) 시나리오 B: 눌림 후 저점이 높아지며 재상승 ── */
(function () {
  const bars = build(100, [[150, 220], [25, 182], [20, 215], [20, 192], [60, 270]], 0.012, 12);
  const r = analyze(bars);
  const med = legs(r, 'medium').filter((w) => w.confirmed);
  const hl = med.filter((w) => w.kind === 'down' && w.struct === 'HL');
  assert(hl.length >= 1, '저점이 높아지는 눌림(HL)이 있다');
  assert(r.state.scenario.B, '눌림 저점 지지 후 소파동 상승 전환(시나리오 B)');
  assert.strictEqual(r.state.regime, 'up');
  assert(r.signals.every((s) => s.index < bars.length), '신호는 실제 봉을 가리킨다');
  // H1·H2 신호는 매수 신호가 아니라 '상태 성립 시점'이다: 같은 종류는 20봉 안에 다시 나오지 않는다
  ['H1', 'H2', 'H3'].forEach((k) => { const ix = r.signals.filter((s) => s.type === k).map((s) => s.index); ix.forEach((v, i) => { if (i) assert(v - ix[i - 1] >= 20); }); });
})();

/* ── 6) 시나리오 C: 긴 바닥 횡보(저점 상승) 후 224일선·구름대·박스 위로 돌파 ── */
(function () {
  const bars = build(200, [[150, 100], [30, 98], [40, 118], [30, 104], [40, 122], [30, 110], [40, 128], [120, 160], [100, 190]], 0.025, 21);
  const r = analyze(bars);
  const bases = r.levels.major.concat(r.levels.medium).filter((b) => b.isBox && b.tags.indexOf('base') >= 0);
  assert(bases.length >= 1, '바닥 횡보 박스가 잡힌다');
  bases.forEach((b) => { assert(b.end - b.start + 1 >= AW.defaults.baseMinBars); assert(b.base.higherLows >= AW.defaults.baseMinHigherLows); assert(!/매집|세력/.test(b.label), '횡보를 세력 매집으로 단정하지 않는다'); });
  const brk = r.signals.filter((s) => s.type === 'base_breakout');
  assert.strictEqual(brk.length, new Set(brk.map((s) => s.index)).size, '같은 돌파 신호가 중복되면 안 된다');
  assert(brk.length >= 1, '돌파 신호');
  const sg = brk[0], ma224 = AW.smaSeries(bars, 224), cloud = AW.cloudSeries(bars);
  assert(bars[sg.index].close > ma224[sg.index] && bars[sg.index].close > cloud.top[sg.index], '224일선·구름대 위에서만 돌파로 본다');
  assert(sg.index > Math.min.apply(null, bases.map((b) => b.start)) + AW.defaults.baseMinBars, '박스가 충분히 이어진 뒤에만 나온다');
  assert(sg.evidence.boxBars >= AW.defaults.baseMinBars && sg.evidence.above224 === true);
  // 돌파 직전 봉까지의 분석에서는 신호가 없다
  assert(!analyze(bars.slice(0, sg.index)).signals.some((s) => s.type === 'base_breakout'), '돌파 봉 이전에는 신호가 없다');
})();

/* ── 7) 시나리오 D: 하락 구조 안의 급등이 시작 저점을 이탈하면 가짜 반등 ── */
(function () {
  const bars = build(200, [[100, 140], [10, 165], [40, 125], [60, 100]], 0.012, 14);
  const r = analyze(bars), fr = r.signals.filter((s) => s.type === 'failed_rally');
  assert(fr.length >= 1, '실패한 반등 신호');
  fr.forEach((s) => { assert(bars[s.index].close < s.startPrice, '시작 저점을 종가로 이탈한 봉에서만 낸다'); assert(s.highPrice > s.startPrice); });
  assert(!analyze(bars.slice(0, fr[0].index)).signals.some((s) => s.type === 'failed_rally'), '이탈 봉 이전에는 없다');
  assert(['down', 'range', 'expansion'].indexOf(r.state.regime) >= 0);
})();

/* ── 8) 시나리오 E: 큰 박스권 안에 파동이 여럿 있으면 박스가 감싸고 소파동은 그대로 보인다 ── */
(function () {
  const bars = build(100, [[60, 160], [60, 110], [50, 160], [50, 110], [50, 160], [50, 110], [50, 160], [50, 110]], 0.025, 22);
  const r = analyze(bars);
  const bx = r.levels.major.concat(r.levels.medium).filter((b) => b.isBox && b.childIds.length >= 3);
  assert(bx.length >= 1, '안에 파동이 3개 이상인 큰 박스');
  const b = bx[0];
  assert(b.kind === 'wide' || b.kind === 'side');
  const same = legs(r, b.level).filter((w) => w.boxId === b.id);
  assert(same.length >= 3 && same.every((w) => w.suppressed), '박스에 감싸인 같은 규모의 파동은 그 규모 화면에서 가려진다(suppressed)');
  assert(legs(r, 'minor').some((w) => w.start >= b.start && w.end <= b.end && !w.suppressed), '더 작은 규모에서는 박스 안의 파동이 그대로 보인다');
  assert(r.revisions.some((v) => v.type === 'absorbed' && v.boxId === b.id), '박스가 파동을 감싼 사실이 리비전에 남는다');
})();

/* ── 9) 변동성 큰 박스권은 응축이 아니라 wide 로 구분 ── */
(function () {
  const wideBars = [];
  for (let i = 0; i < 160; i++) { const mid = 100 + Math.sin(i / 3.2) * 25; wideBars.push({ date: 'w' + i, open: mid, close: mid + 1, high: mid + 3, low: mid - 3, volume: 1 }); }
  const r = analyze(wideBars);
  assert(!r.waves.some((w) => w.isBox && w.kind === 'side' && /응축/.test(w.label || '')), '변동성 큰 구간을 응축이라 부르지 않는다');
  // 횡보 판정: 한 방향 추세는 박스가 아니다
  const trend = build(100, [[200, 200]], 0.01, 3), ctx = { bars: trend, opt: analyze(trend).params, atr: AW.atrSeries(trend, 14), ma20: AW.smaSeries(trend, 20), ma60: AW.smaSeries(trend, 60) };
  assert.strictEqual(AW.isSideways(ctx, 20, 180), false);
})();

/* ── 10) 라벨은 사실 서술이며 추천·예측 표현이 없다 ── */
(function () {
  const r = analyze(walk), text = JSON.stringify(r.waves.map((w) => w.label)) + r.state.summaryText;
  assert(!/매수|매도|추천|목표가|상승 예상|하락 예상|급등 임박/.test(text), '라벨에 추천·예측 표현이 없다: ' + text.slice(0, 120));
})();

console.log('auto-wave ok:', all.length, 'waves,', LEVELS.map((lv) => lv + ' ' + res.levels[lv].length).join(' / '));
