/* 공용 파동 표시 모듈(js/chart-wave-overlay.js) 통합 검증(브라우저 없이): 가짜 오버레이 컨트롤러·캔버스로 실행한다.
 * 차트검색과 종목분석이 같은 분석 캐시·같은 그림을 쓰는지(같은 입력 → 같은 결과, 재계산 없음)를 확인한다. */
const assert = require('assert');
const AutoWave = require('../js/auto-wave.js');

let analyzeCalls = 0;
const moduleNew = { version: AutoWave.version, hashBars: AutoWave.hashBars, detectWaves: AutoWave.detectWaves, analyze: function (b) { analyzeCalls++; return AutoWave.analyze(b); } };
globalThis.AutoWave = moduleNew;
require('../js/chart-data.js');
const Wave = require('../js/chart-wave-overlay.js');
const core = { loadModule: () => Promise.resolve(globalThis.AutoWave) };

function makeCtl() {
  const ctl = { layers: {}, redraws: 0, addLayer(name, draw) { ctl.layers[name] = draw; ctl.redraws++; }, removeLayer(name) { delete ctl.layers[name]; ctl.redraws++; } };
  return ctl;
}

// 가짜 봉(충분히 길고 큰 스윙이 있는 자료)
let s = 3, price = 200; const bars = [];
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
for (let i = 0; i < 420; i++) { const o = price, c = Math.max(20, price * (1 + Math.sin(i / 22) * 0.012 + (rnd() - 0.5) * 0.03)); bars.push({ date: 'D' + String(i).padStart(4, '0'), open: o, close: c, high: Math.max(o, c) * 1.006, low: Math.min(o, c) * 0.994, volume: 100 + i }); price = c; }

const mk = (key, tf, state, b) => { const ctl = makeCtl(); return { ctl, state, h: Wave.attach({ core, ctl, key, timeframe: tf, bars: b || bars, state, font: 'serif' }) }; };

(async () => {
  // OFF: 계산 없음, 층 없음
  const a = mk('T', 'day', { enabled: false, level: 'medium' });
  await a.h.apply();
  assert.strictEqual(analyzeCalls, 0, 'OFF에서는 계산하지 않는다');
  assert.strictEqual(a.h.picked(), null);
  assert.strictEqual(a.ctl.layers.wave, undefined);

  // ON(기본 중파동): 1회 계산, 같은 입력은 재사용, 중파동 + 부모(대파동) 윤곽
  a.state.enabled = true;
  await a.h.apply(); await a.h.apply();
  assert.strictEqual(analyzeCalls, 1, '같은 종목·주기·데이터면 재계산하지 않는다');
  let p = a.h.picked();
  assert(p.waves.length > 0 && p.waves.every((w) => w.level === 'medium' && !w.suppressed), '기본은 중파동');
  assert.strictEqual(p.level, 'medium');
  assert(p.parents.every((w) => w.level === 'major'), '부모 윤곽은 한 단계 위(대파동)');
  assert(p.summary && /대|구조/.test(p.summary), '현재 구조 요약');
  assert(typeof a.ctl.layers.wave === 'function', '오버레이 층이 등록된다');

  // 규모 전환: 재계산 없이 그리기만 바뀐다
  a.state.level = 'minor'; await a.h.apply();
  assert.strictEqual(analyzeCalls, 1, '규모만 바꾸면 분석을 다시 하지 않는다');
  p = a.h.picked();
  assert(p.waves.every((w) => w.level === 'minor') && p.waves.length >= 6);
  assert(p.parents.every((w) => w.level === 'medium'));
  a.state.level = 'major'; await a.h.apply();
  p = a.h.picked();
  assert(p.waves.every((w) => w.level === 'major') && p.parents.length === 0, '대파동에는 부모 윤곽이 없다');
  assert.strictEqual(analyzeCalls, 1);
  a.state.level = 'medium'; await a.h.apply();

  // 분봉은 건너뛴다
  const m = mk('T', 'minute', { enabled: true, level: 'medium' });
  await m.h.apply();
  assert.strictEqual(m.h.picked(), null);
  assert.strictEqual(analyzeCalls, 1);

  // 다른 화면(핸들)이 같은 종목·주기·데이터면 같은 분석 결과를 재사용하고 결과가 같다(차트검색 ↔ 종목분석)
  const other = mk('T', 'day', { enabled: true, level: 'medium' });
  await other.h.apply();
  assert.strictEqual(analyzeCalls, 1, '다른 화면도 계산 결과를 공유한다');
  assert.strictEqual(JSON.stringify(other.h.picked().waves.map((w) => [w.start, w.end, w.kind])), JSON.stringify(a.h.picked().waves.map((w) => [w.start, w.end, w.kind])), '같은 입력 → 같은 파동');

  // 새 봉이 들어오면 다시 계산
  bars.push(Object.assign({}, bars[bars.length - 1], { date: 'D9999' }));
  await a.h.apply();
  assert.strictEqual(analyzeCalls, 2);

  // 데이터 지문: 마지막 봉만이 아니라 과거 봉이 정정돼도(마지막 봉은 같아도) 다시 계산, 같은 값 재전달이면 재사용
  let before = analyzeCalls;
  await a.h.apply();
  assert.strictEqual(analyzeCalls, before, '동일 데이터 재전달은 재계산하지 않는다');
  bars[100] = Object.assign({}, bars[100], { close: bars[100].close + 0.5 });
  await a.h.apply();
  assert.strictEqual(analyzeCalls, before + 1, '마지막 봉이 같아도 과거 종가가 정정되면 다시 계산한다');
  bars[bars.length - 1] = Object.assign({}, bars[bars.length - 1], { close: bars[bars.length - 1].close + 1 });
  await a.h.apply();
  assert.strictEqual(analyzeCalls, before + 2, '마지막 종가가 바뀌면 다시 계산');
  bars[5] = Object.assign({}, bars[5], { volume: 999999 });
  await a.h.apply();
  assert.strictEqual(analyzeCalls, before + 3, '과거 거래량 정정도 반영');

  // 종목이 바뀌면 다시 계산(키에 종목 포함)
  before = analyzeCalls;
  const otherCode = mk('OTHER', 'day', { enabled: true, level: 'medium' });
  await otherCode.h.apply();
  assert.strictEqual(analyzeCalls, before + 1);

  // 그리기: 선택 규모 파동마다 fillRect, 부모 윤곽은 채우지 않고 옅은 점선, 미확정은 점선
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : (...x) => calls.push([k, ...x])), set: (t, k, v) => { calls.push(['set:' + k, v]); return true; } });
  const idx = {}; bars.forEach((b, i) => { idx[b.date] = i; });
  const view = { width: 5000, height: 400, bars, coord: (pt) => ({ x: idx[pt.time] * 5 + 10, y: 400 - pt.price }) };
  const pick = a.h.picked();
  a.ctl.layers.wave(ctx, view);
  const fills = calls.filter((c) => c[0] === 'fillRect').length;
  assert.strictEqual(fills, pick.waves.length, '채움은 선택한 규모의 파동만');
  const dashed = calls.filter((c) => c[0] === 'setLineDash' && c[1].length).length;
  assert.strictEqual(dashed, pick.parents.length + pick.waves.filter((w) => !w.confirmed).length);
  const faint = calls.filter((c) => c[0] === 'set:globalAlpha' && c[1] === 0.3).length;
  assert.strictEqual(faint, pick.parents.length, '부모 윤곽은 옅게(0.3)');
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert(texts.some((t) => /파동 분석\(중파동\)/.test(t)), '머리글에 선택한 규모가 보인다');
  assert(texts.some((t) => /^파동 분석\(중파동\) · .*(대|구조|횡보)/.test(t)), '머리글 한 줄에 현재 구조 요약이 같이 보인다');
  assert(texts.some((t) => /확정 \+\d+봉/.test(t)) || pick.waves.every((w) => !w.confirmed), '확정 지연(봉 수)을 라벨에 적는다');
  assert(!texts.some((t) => /매수 추천|목표가/.test(t.replace('매매 추천 아님', ''))), '추천 문구가 없다');
  // 화면 밖 파동은 그리지 않는다(확대·이동 때 그리기 작업 축소)
  calls.length = 0;
  a.ctl.layers.wave(ctx, Object.assign({}, view, { width: 200 }));
  assert(calls.filter((c) => c[0] === 'fillRect').length < fills, '보이지 않는 구간은 그리지 않는다');

  // 옛 모듈(analyze 없음)이 올라와 있어도 중파동만이라도 그린다
  globalThis.AutoWave = { detectWaves: AutoWave.detectWaves, version: 'legacy' };
  const legacy = mk('LEGACY', 'day', { enabled: true, level: 'minor' });   // 옛 모듈에는 소파동이 없으므로 중파동으로 대체된다
  await legacy.h.apply();
  assert(legacy.h.picked().waves.length > 0 && legacy.h.picked().waves.every((w) => w.level === 'medium'));
  globalThis.AutoWave = moduleNew;

  // detach: 층이 사라지고 이후 apply 는 아무것도 하지 않는다
  a.h.detach();
  assert.strictEqual(a.ctl.layers.wave, undefined);
  await a.h.apply();
  assert.strictEqual(a.ctl.layers.wave, undefined);

  // 규모 선택 마크업·연결: 기본은 중파동, 꺼져 있으면 숨김, 클릭은 상태만 바꾸고 다시 그리게 한다
  assert.strictEqual(JSON.stringify(Wave.LEVELS.map((l) => l.label)), JSON.stringify(['대파동', '중파동', '소파동']));
  const off = Wave.levelHtml('ss', false, 'medium');
  assert(/hidden/.test(off.split('>')[0]), '파동 분석이 꺼져 있으면 규모 선택을 숨긴다');
  assert(/class="ss-wave-btn active" data-wave-level="medium" aria-pressed="true"/.test(off), '기본은 중파동');
  const on = Wave.levelHtml('ff', true, 'minor');
  assert(!/hidden/.test(on.split('>')[0]) && /class="ff-wave-btn active" data-wave-level="minor"/.test(on), '화면별 CSS 접두어');
  const btn = (level) => { const attrs = { 'data-wave-level': level }; return { classList: { toggle() {} }, getAttribute: (k) => attrs[k], setAttribute() {} }; };
  const box = { hidden: true, innerHTML: '', className: 'ff-wave-level', querySelector: () => null, querySelectorAll: () => [btn('major'), btn('medium'), btn('minor')], onclick: null };
  const toggle = { checked: false, onchange: null };
  const root = { querySelector: (sel) => (sel === '[data-chart-wave-toggle]' ? toggle : box) };
  const st = { enabled: false, level: 'medium' }; const seen = [];
  Wave.wireControls(root, st, (kind) => seen.push(kind), 'ff');
  assert(/data-wave-level="major"/.test(box.innerHTML) && /ff-wave-btn/.test(box.innerHTML), '빈 규모 묶음을 이 모듈이 채운다');
  toggle.checked = true; toggle.onchange();
  assert.strictEqual(st.enabled, true); assert.strictEqual(box.hidden, false);
  box.onclick({ target: { closest: () => btn('minor') } });
  assert.strictEqual(st.level, 'minor'); assert.deepStrictEqual(seen, ['toggle', 'level']);
  console.log('auto wave integration ok');
})().catch((e) => { console.error(e); process.exit(1); });
