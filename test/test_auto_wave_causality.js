/* 자동 파동(대·중·소) 엄격 인과성(미래 비참조·리페인트) 검증: node test/test_auto_wave_causality.js
 *
 * 원칙: 어느 봉 t 에서 낸 결과는 t 이하 자료만으로 만들어진다. 그래서
 *  (1) 봉 t 까지만 넣은 분석(prefix)의 확정 파동은 전체 자료 분석에서도 같은 모양(구간·가격·확정 시점·구조 태그)으로 남는다.
 *  (2) 파동은 극점 날짜(end)가 아니라 확정 시점(confirmedIndex)에 처음 나타난다: t = confirmedIndex-1 에는 없고 t = confirmedIndex 에는 있다.
 *  (3) 대파동 추세 상태(regime)는 그 봉까지의 값이며 전체 분석의 봉별 값과 prefix 분석의 마지막 값이 같다.
 *  (4) 박스가 앞선 파동을 감싸거나(absorbed) 박스가 승격되는 것은 파동 자체가 아니라 '표시 관계'의 변화이며 revisions 에 사유·시점이 남는다.
 *  (5) 같은 봉의 고가·저가 순서를 모르므로 신고가를 낸 봉은 반대 방향 되돌림 판정에 쓰지 않는다.
 *  (6) 과거 OHLC 가 정정되면 마지막 봉이 같아도 데이터 지문(hashBars)이 달라진다.
 * 실제 차트 27개(test/fixtures/wave)와 합성 자료 양쪽으로 검사한다. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AW = require('../js/auto-wave.js');

const FIX = path.join(__dirname, 'fixtures', 'wave', 'cases_bars.json');
const raw = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const real = Object.keys(raw).map((id) => ({ id: id, bars: raw[id].bars.map((r) => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })) }));

function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function synth(n, seed, noise) {
  const r = rng(seed); let price = 100; const bars = [];
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 25) * 0.9 + Math.sin(i / 90) * 0.7;
    const open = price, close = Math.max(5, price * (1 + drift / 100 + (r() - 0.5) * noise));
    bars.push({ date: 'd' + i, open: open, close: close, high: Math.max(open, close) * (1 + r() * noise * 0.4), low: Math.min(open, close) * (1 - r() * noise * 0.4), volume: 1000 + Math.floor(r() * 500) });
    price = close;
  }
  return bars;
}
const series = real.concat([{ id: 'synth-a', bars: synth(520, 7, 0.04) }, { id: 'synth-b', bars: synth(420, 21, 0.06) }]);

const LEVELS = ['major', 'medium', 'minor'];
function immutable(w) { return [w.id, w.level, w.kind, w.start, w.end, w.startPrice, w.endPrice, w.startConfirmedIndex, w.confirmedIndex, w.struct, w.retrace].join('|'); }
function confirmedLegs(res) { const out = {}; LEVELS.forEach((lv) => res.levels[lv].filter((w) => !w.isBox && w.confirmed).forEach((w) => { out[w.id] = w; })); return out; }

/* (1)+(2)+(3) prefix 대 전체 */
let legChecks = 0, birthChecks = 0, regimeChecks = 0;
series.forEach((c) => {
  const bars = c.bars, full = AW.analyze(bars, { withSeries: true }), fullLegs = confirmedLegs(full);
  const step = bars.length > 450 ? 31 : 23;
  for (let t = 130; t < bars.length; t += step) {
    const part = AW.analyze(bars.slice(0, t + 1));
    const legs = confirmedLegs(part);
    Object.keys(legs).forEach((id) => {
      assert(fullLegs[id], c.id + ' t=' + t + ': 확정 파동 ' + id + ' 이 전체 분석에서 사라졌다(미래 자료로 바뀜)');
      assert.strictEqual(immutable(legs[id]), immutable(fullLegs[id]), c.id + ' t=' + t + ': 확정 파동 ' + id + ' 의 불변 필드가 바뀌었다');
      assert(legs[id].confirmedIndex <= t, c.id + ' t=' + t + ': 확정 시점이 아직 모르는 봉(' + legs[id].confirmedIndex + ')을 가리킨다');
      assert(legs[id].end < legs[id].confirmedIndex, c.id + ': 극점 날짜(end)는 확정 시점(confirmedIndex)보다 앞서야 한다');
      legChecks++;
    });
    // 전체 분석의 확정 파동 중 confirmedIndex <= t 인 것은 prefix 에도 이미 있어야 한다(확정 시점에 정확히 나타남)
    Object.keys(fullLegs).forEach((id) => {
      const w = fullLegs[id];
      if (w.confirmedIndex <= t) { assert(legs[id], c.id + ' t=' + t + ': ' + id + ' 은 봉 ' + w.confirmedIndex + ' 에 확정됐는데 그 시점 분석에는 없다'); birthChecks++; }
      else assert(!legs[id], c.id + ' t=' + t + ': ' + id + ' 은 봉 ' + w.confirmedIndex + ' 에 확정되는데 ' + t + ' 시점 분석에 미리 나타났다(미래 참조)');
    });
    assert.strictEqual(part.state.regime, full.regimeSeries[t], c.id + ' t=' + t + ': regime 이 그 봉까지의 값과 다르다');
    regimeChecks++;
  }
});
assert(legChecks > 3000 && birthChecks > 3000 && regimeChecks > 300, 'checks ' + legChecks + '/' + birthChecks + '/' + regimeChecks);

/* 확정 시점 바로 직전 봉(t = confirmedIndex-1)과 그 봉(t = confirmedIndex)의 경계를 파동마다 직접 확인 */
let edge = 0;
series.slice(0, 12).forEach((c) => {
  const bars = c.bars, full = AW.analyze(bars);
  const medium = full.levels.medium.filter((w) => !w.isBox && w.confirmed && w.confirmedIndex > 140);
  for (let k = 0; k < medium.length; k += Math.max(1, Math.floor(medium.length / 4))) {
    const w = medium[k], before = confirmedLegs(AW.analyze(bars.slice(0, w.confirmedIndex))), at = confirmedLegs(AW.analyze(bars.slice(0, w.confirmedIndex + 1)));
    assert(!before[w.id], c.id + ': ' + w.id + ' 이 확정 직전 봉에 이미 나타났다');
    assert(at[w.id], c.id + ': ' + w.id + ' 이 확정 봉에 나타나지 않았다');
    edge++;
  }
});
assert(edge >= 30, 'edge checks ' + edge);

/* (3') 신호는 발생 봉 이하 자료만 쓴다: failed_rally·H1·H2·H3·base_breakout 은 prefix 에서도 같은 봉에 같은 종류로 나온다 */
let sigChecks = 0;
series.forEach((c) => {
  const bars = c.bars, full = AW.analyze(bars);
  const keys = {}; full.signals.forEach((s) => { keys[s.type + '@' + s.index] = 1; });
  for (let t = 200; t < bars.length; t += 47) {
    AW.analyze(bars.slice(0, t + 1)).signals.forEach((s) => {
      assert(s.index <= t, c.id + ': 신호가 미래 봉을 가리킨다');
      assert(keys[s.type + '@' + s.index], c.id + ' t=' + t + ': 신호 ' + s.type + '@' + s.index + ' 이 전체 분석에서 사라졌다');
      sigChecks++;
    });
  }
});
assert(sigChecks > 20, 'signal checks ' + sigChecks);

/* (4) 박스에 감싸인 파동은 revisions 에 기록되고, 기록 시점은 그 파동의 확정 시점 이후다 */
let absorbed = 0;
series.forEach((c) => {
  const res = AW.analyze(c.bars), byId = {};
  LEVELS.forEach((lv) => res.levels[lv].forEach((w) => { byId[w.id] = w; }));
  res.revisions.forEach((r) => {
    assert(r.at != null && r.type && r.reason, '리비전에는 시점·종류·사유가 있어야 한다');
    if (r.type === 'absorbed') (r.waveIds || []).forEach((id) => { assert(byId[id], '리비전이 가리키는 파동이 없다: ' + id); assert(r.at >= byId[id].confirmedIndex, c.id + ': 박스 흡수 시점이 파동 확정보다 이르다'); absorbed++; });
  });
  LEVELS.forEach((lv) => res.levels[lv].filter((w) => w.boxId && !w.isBox).forEach((w) => {
    assert(res.revisions.some((r) => r.type === 'absorbed' && (r.waveIds || []).indexOf(w.id) >= 0), c.id + ': 박스에 감싸인 파동 ' + w.id + ' 의 리비전 기록이 없다');
  }));
});
assert(absorbed > 5, 'absorbed ' + absorbed);

/* (5) 같은 봉 고저 순서: 신고가를 만든 봉이 동시에 큰 하락 되돌림 조건을 만족해도 그 봉으로는 극점을 확정하지 않는다 */
(function () {
  const bars = [];
  for (let i = 0; i < 40; i++) bars.push({ date: 'p' + i, open: 100 + i * 0.5, high: 101 + i * 0.5, low: 99 + i * 0.5, close: 100.4 + i * 0.5, volume: 1 }); // ATR ≈ 2
  const z = AW.makeZigzag(bars.concat([{ date: 'x', open: 120, high: 130, low: 95, close: 100, volume: 1 }]), AW.atrSeries(bars.concat([{ date: 'x', open: 120, high: 130, low: 95, close: 100, volume: 1 }]), 14), 3);
  let pivots = 0; for (let i = 0; i < 41; i++) { if (z.feed(i)) pivots++; }
  assert.strictEqual(pivots, 1, '첫 방향이 한 번 정해질 뿐 (신고가 봉 안의 큰 하락으로 곧바로 반전 극점을 만들지 않는다)');
  assert.strictEqual(z.dir, 1, '신고가 봉에서는 상승 방향이 유지된다');
  // 첫 방향 구간: 한 봉에서 위·아래 조건이 함께 충족되면 방향을 정하지 않는다
  const flat = []; for (let i = 0; i < 20; i++) flat.push({ date: 'f' + i, open: 100, high: 101, low: 99, close: 100, volume: 1 });
  flat.push({ date: 'big', open: 100, high: 112, low: 88, close: 100, volume: 1 });
  const z2 = AW.makeZigzag(flat, AW.atrSeries(flat, 14), 3);
  for (let i = 0; i < flat.length; i++) z2.feed(i);
  assert.strictEqual(z2.dir, 0, '위아래 조건이 같은 봉에서 동시에 충족되면 방향을 정하지 않는다');
})();

/* (6) 캐시 지문: 마지막 봉이 같아도 과거 OHLC 가 정정되면 달라지고, 같은 자료는 같다 */
(function () {
  const bars = synth(300, 5, 0.03), copy = JSON.parse(JSON.stringify(bars));
  assert.strictEqual(AW.hashBars(bars), AW.hashBars(copy));
  copy[40].close += 0.01;
  assert.notStrictEqual(AW.hashBars(bars), AW.hashBars(copy), '과거 종가 정정을 지문이 알아채야 한다');
  const copy2 = JSON.parse(JSON.stringify(bars)); copy2[10].volume += 1;
  assert.notStrictEqual(AW.hashBars(bars), AW.hashBars(copy2), '과거 거래량 정정도 알아채야 한다');
  assert.strictEqual(AW.analyze(bars).dataHash, AW.hashBars(bars), '분석 결과에 데이터 지문이 들어 있다');
})();

/* 결정성·비파괴: 같은 입력은 같은 출력, 입력 배열은 바뀌지 않는다 */
(function () {
  const bars = synth(400, 9, 0.04), snapshot = JSON.stringify(bars);
  const a = JSON.stringify(AW.analyze(bars)), b = JSON.stringify(AW.analyze(bars));
  assert.strictEqual(a, b);
  assert.strictEqual(JSON.stringify(bars), snapshot, '입력 봉을 수정하면 안 된다');
})();

console.log('auto-wave causality ok:', legChecks, 'leg checks,', birthChecks, 'birth checks,', regimeChecks, 'regime checks,', edge, 'edge,', sigChecks, 'signal checks,', absorbed, 'absorbed');
