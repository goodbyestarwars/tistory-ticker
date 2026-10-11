/* stock-search.js의 자동 파동(대·중·소) 레이어 통합 검증(브라우저 없이): 함수 본문을 잘라 가짜 차트·캔버스로 실행한다. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(__dirname + '/../js/stock-search.js', 'utf8');
function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker), b = src.indexOf(endMarker, a);
  assert(a > 0 && b > a, startMarker);
  return src.slice(a, b);
}
const code = slice('  var autoWaveCache', '  function redrawStockDrawing(drawing) {');
const AutoWave = require('../js/auto-wave.js');

let analyzeCalls = 0;
const moduleNew = { version: AutoWave.version, hashBars: AutoWave.hashBars, detectWaves: AutoWave.detectWaves, analyze: function (b) { analyzeCalls++; return AutoWave.analyze(b); } };
const scriptsAdded = [];
const sandbox = {
  state: { autoWaveEnabled: false, autoWaveLevel: 'medium' },
  AUTO_WAVE_SCRIPT: 'x',
  global: { AutoWave: moduleNew },
  document: { querySelector: () => null, createElement: () => ({ setAttribute() {}, remove() {} }), body: { appendChild: (s) => scriptsAdded.push(s) } },
  stockDrawingState: null,
  redraws: 0,
  stockDrawingCoordinate: (d, pt) => ({ x: d.bars.findIndex((b) => b.date === pt.time) * 5 + 10, y: 400 - pt.price }),
  redrawStockDrawing: function () { sandbox.redraws++; }
};
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.applyAutoWave = applyAutoWave; this.drawAutoWaves = drawAutoWaves; this.pickAutoWaveLevel = pickAutoWaveLevel;', sandbox);

// 가짜 봉(충분히 길고 큰 스윙이 있는 자료)
let s = 3, price = 200; const bars = [];
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
for (let i = 0; i < 420; i++) { const o = price, c = Math.max(20, price * (1 + Math.sin(i / 22) * 0.012 + (rnd() - 0.5) * 0.03)); bars.push({ date: 'D' + String(i).padStart(4, '0'), open: o, close: c, high: Math.max(o, c) * 1.006, low: Math.min(o, c) * 0.994, volume: 100 + i }); price = c; }
const drawing = { key: 'T', timeframe: 'day', bars, overlay: { clientHeight: 400 }, autoWaves: null };
sandbox.stockDrawingState = drawing;

// OFF: 계산 없음, 레이어 비움
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, 0, 'OFF에서는 계산하지 않는다');
assert.strictEqual(drawing.autoWaves, null);
assert.strictEqual(drawing.autoWaveParents, null);

// ON(기본 중파동): 1회 계산, 같은 입력은 재사용, 중파동 + 부모(대파동) 윤곽
sandbox.state.autoWaveEnabled = true;
sandbox.applyAutoWave(drawing);
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, 1, '같은 종목·주기·데이터면 재계산하지 않는다');
assert(drawing.autoWaves.length > 0 && drawing.autoWaves.every((w) => w.level === 'medium' && !w.suppressed), '기본은 중파동');
assert.strictEqual(drawing.autoWaveLevel, 'medium');
assert(drawing.autoWaveParents.every((w) => w.level === 'major'), '부모 윤곽은 한 단계 위(대파동)');
assert(drawing.autoWaveSummary && /대|구조/.test(drawing.autoWaveSummary), '현재 구조 요약');

// 규모 전환: 재계산 없이 그리기만 바뀐다
sandbox.state.autoWaveLevel = 'minor';
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, 1, '규모만 바꾸면 분석을 다시 하지 않는다');
assert(drawing.autoWaves.every((w) => w.level === 'minor') && drawing.autoWaves.length >= 6);
assert(drawing.autoWaveParents.every((w) => w.level === 'medium'));
sandbox.state.autoWaveLevel = 'major';
sandbox.applyAutoWave(drawing);
assert(drawing.autoWaves.every((w) => w.level === 'major') && drawing.autoWaveParents.length === 0, '대파동에는 부모 윤곽이 없다');
assert.strictEqual(analyzeCalls, 1);
sandbox.state.autoWaveLevel = 'medium';
sandbox.applyAutoWave(drawing);

// 분봉은 건너뛴다
const minute = Object.assign({}, drawing, { timeframe: 'minute', autoWaves: [1] });
sandbox.applyAutoWave(minute);
assert.strictEqual(minute.autoWaves, null);
assert.strictEqual(analyzeCalls, 1);

// 새 봉이 들어오면 다시 계산
bars.push(Object.assign({}, bars[bars.length - 1], { date: 'D9999' }));
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, 2);

// 데이터 지문: 마지막 봉만이 아니라 과거 봉이 정정돼도(마지막 봉은 같아도) 다시 계산, 같은 값 재전달이면 재사용
let before = analyzeCalls;
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, before, '동일 데이터 재전달은 재계산하지 않는다');
drawing.bars[100] = Object.assign({}, drawing.bars[100], { close: drawing.bars[100].close + 0.5 });
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, before + 1, '마지막 봉이 같아도 과거 종가가 정정되면 다시 계산한다');
drawing.bars[drawing.bars.length - 1] = Object.assign({}, drawing.bars[drawing.bars.length - 1], { close: drawing.bars[drawing.bars.length - 1].close + 1 });
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, before + 2, '마지막 종가가 바뀌면 다시 계산');
drawing.bars[5] = Object.assign({}, drawing.bars[5], { volume: 999999 });
sandbox.applyAutoWave(drawing);
assert.strictEqual(analyzeCalls, before + 3, '과거 거래량 정정도 반영');

// 종목이 바뀌면 다시 계산(키에 종목 포함)
before = analyzeCalls;
const other = Object.assign({}, drawing, { key: 'OTHER' });
sandbox.stockDrawingState = other;
sandbox.applyAutoWave(other);
assert.strictEqual(analyzeCalls, before + 1);
sandbox.stockDrawingState = drawing;
sandbox.applyAutoWave(drawing);

// 그리기: 소유 파동마다 fillRect, 부모 윤곽은 채우지 않고 옅은 점선, 미확정은 점선, 저장 필드 없음
const calls = [];
let alpha = 1;
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : (...a) => calls.push([k, ...a])), set: (t, k, v) => { if (k === 'globalAlpha') alpha = v; calls.push(['set:' + k, v]); return true; } });
sandbox.drawAutoWaves(drawing, ctx);
const fills = calls.filter((c) => c[0] === 'fillRect').length;
assert.strictEqual(fills, drawing.autoWaves.length, '채움은 선택한 규모의 파동만');
const dashed = calls.filter((c) => c[0] === 'setLineDash' && c[1].length).length;
assert.strictEqual(dashed, drawing.autoWaveParents.length + drawing.autoWaves.filter((w) => !w.confirmed).length);
const faint = calls.filter((c) => c[0] === 'set:globalAlpha' && c[1] === 0.3).length;
assert.strictEqual(faint, drawing.autoWaveParents.length, '부모 윤곽은 옅게(0.3)');
const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
assert(texts.some((t) => /파동 분석\(중파동\)/.test(t)), '머리글에 선택한 규모가 보인다');
assert(texts.some((t) => /^파동 분석\(중파동\) · .*(대|구조|횡보)/.test(t)), '머리글 한 줄에 현재 구조 요약이 같이 보인다');
assert(texts.some((t) => /확정 \+\d+봉/.test(t)) || drawing.autoWaves.every((w) => !w.confirmed), '확정 지연(봉 수)을 라벨에 적는다');
assert(!texts.some((t) => /매수 추천|목표가/.test(t.replace('매매 추천 아님', ''))), '추천 문구가 없다');
assert(!('autoWaves' in JSON.parse(JSON.stringify({ lines: [], paths: [], circles: [], hlines: [], boxes: [] }))));

// 옛 모듈(analyze 없음)이 캐시돼 있어도 중파동만이라도 그린다
const legacy = { detectWaves: AutoWave.detectWaves };
sandbox.global.AutoWave = legacy;
sandbox.state.autoWaveLevel = 'minor';   // 옛 모듈에는 소파동이 없으므로 중파동으로 대체된다
const d2 = Object.assign({}, drawing, { key: 'LEGACY', autoWaves: null });
sandbox.stockDrawingState = d2;
sandbox.applyAutoWave(d2);
assert(d2.autoWaves.length > 0 && d2.autoWaves.every((w) => w.level === 'medium'));
sandbox.global.AutoWave = moduleNew;

// 규모 선택 UI: 두 곳의 토글이 같은 규모 선택을 붙이고, 기본은 중파동, 꺼져 있으면 숨김, 클릭은 상태만 바꾸고 다시 그린다
const levelCode = slice('  var AUTO_WAVE_LEVELS', '  function minuteScopeControlHtml() {');
const ui = { state: { autoWaveEnabled: false, autoWaveLevel: 'medium' } };
vm.createContext(ui);
vm.runInContext(levelCode + '\nthis.html = waveLevelHtml; this.LEVELS = AUTO_WAVE_LEVELS;', ui);
const off = ui.html();
assert(/hidden/.test(off.split('>')[0]), '파동 분석이 꺼져 있으면 규모 선택을 숨긴다');
assert.strictEqual(JSON.stringify(ui.LEVELS.map((l) => l.label)), JSON.stringify(['대파동', '중파동', '소파동']));
assert(/class="ss-wave-btn active" data-wave-level="medium" aria-pressed="true"/.test(off), '기본은 중파동');
ui.state.autoWaveEnabled = true; ui.state.autoWaveLevel = 'minor';
assert(!/hidden/.test(ui.html().split('>')[0]) && /class="ss-wave-btn active" data-wave-level="minor"/.test(ui.html()));
assert.strictEqual((src.match(/ 파동 분석<\/label>' \+ waveLevelHtml\(\)/g) || []).length, 2, '종목 분석·차트 검색 두 화면 모두에 규모 선택');
assert(/state\.autoWaveLevel = btn\.getAttribute\('data-wave-level'\);[\s\S]{0,200}applyAutoWave\(stockDrawingState\)/.test(src), '규모를 고르면 다시 그린다');
assert(/auto-wave\.js\?v=20261013-hier/.test(src), '새 모듈 버전');

console.log('auto-wave integration ok:', drawing.autoWaves.length, 'medium waves,', drawing.autoWaveParents.length, 'parent outlines,', dashed, 'dashed');
