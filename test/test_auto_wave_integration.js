/* stock-search.js의 자동 파동 레이어 통합 검증(브라우저 없이): 함수 본문을 잘라 가짜 차트·캔버스로 실행한다. */
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
let detectCalls = 0;
const sandboxAW = { detectWaves: function (b) { detectCalls++; return AutoWave.detectWaves(b); } };
const scriptsAdded = [];
const sandbox = {
  state: { autoWaveEnabled: false },
  AUTO_WAVE_SCRIPT: 'x',
  global: { AutoWave: sandboxAW },
  document: { querySelector: () => null, createElement: () => ({ setAttribute() {}, remove() {} }), body: { appendChild: (s) => scriptsAdded.push(s) } },
  stockDrawingState: null,
  redraws: 0,
  stockDrawingCoordinate: (d, pt) => ({ x: d.bars.findIndex((b) => b.date === pt.time) * 5 + 10, y: 400 - pt.price }),
  redrawStockDrawing: function () { sandbox.redraws++; }
};
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.applyAutoWave = applyAutoWave; this.drawAutoWaves = drawAutoWaves;', sandbox);

// 가짜 봉 400개
let s = 3, price = 200; const bars = [];
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
for (let i = 0; i < 300; i++) { const o = price, c = Math.max(20, price + Math.sin(i / 20) * 2 + (rnd() - 0.5) * 6); bars.push({ date: '2026-01-' + i, open: o, close: c, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, volume: 1 }); price = c; }
const drawing = { key: 'T', timeframe: 'day', bars, overlay: { clientHeight: 400 }, autoWaves: null };
sandbox.stockDrawingState = drawing;

// OFF: 계산 없음, 레이어 비움
sandbox.applyAutoWave(drawing);
assert.strictEqual(detectCalls, 0, 'OFF에서는 계산하지 않는다');
assert.strictEqual(drawing.autoWaves, null);

// ON: 1회 계산, 같은 입력은 재사용
sandbox.state.autoWaveEnabled = true;
sandbox.applyAutoWave(drawing);
sandbox.applyAutoWave(drawing);
assert.strictEqual(detectCalls, 1, '같은 종목·주기·마지막 봉이면 재계산하지 않는다');
assert(drawing.autoWaves.length > 0);

// 분봉은 건너뛴다
const minute = Object.assign({}, drawing, { timeframe: 'minute', autoWaves: [1] });
sandbox.applyAutoWave(minute);
assert.strictEqual(minute.autoWaves, null);

// 새 봉이 들어오면 다시 계산
bars.push(Object.assign({}, bars[bars.length - 1], { date: 'new' }));
sandbox.applyAutoWave(drawing);
assert.strictEqual(detectCalls, 2);

// 마지막 봉 날짜가 같아도 OHLC가 바뀌면 재계산, 같은 값 재전달이면 재사용
const before = detectCalls;
sandbox.applyAutoWave(drawing);
assert.strictEqual(detectCalls, before, '동일 데이터 재전달은 재계산하지 않는다');
drawing.bars[drawing.bars.length - 1] = Object.assign({}, drawing.bars[drawing.bars.length - 1], { close: drawing.bars[drawing.bars.length - 1].close + 1 });
sandbox.applyAutoWave(drawing);
assert.strictEqual(detectCalls, before + 1, '같은 날짜라도 종가가 바뀌면 재계산한다');
drawing.bars[drawing.bars.length - 1] = Object.assign({}, drawing.bars[drawing.bars.length - 1], { volume: 999 });
sandbox.applyAutoWave(drawing);
assert.strictEqual(detectCalls, before + 2, '거래량 변경도 반영');

// 그리기: 박스마다 fillRect·strokeRect, 미확정은 점선, 저장 필드 없음
const calls = [];
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : (...a) => calls.push([k, ...a])), set: (t, k, v) => { calls.push(['set:' + k, v]); return true; } });
sandbox.drawAutoWaves(drawing, ctx);
const fills = calls.filter((c) => c[0] === 'fillRect').length;
assert.strictEqual(fills, drawing.autoWaves.length);
const dashed = calls.filter((c) => c[0] === 'setLineDash' && c[1].length).length;
assert.strictEqual(dashed, drawing.autoWaves.filter((w) => !w.confirmed).length);
assert(!('autoWaves' in JSON.parse(JSON.stringify({ lines: [], paths: [], circles: [], hlines: [], boxes: [] }))));
console.log('auto-wave integration ok:', drawing.autoWaves.length, 'waves,', dashed, 'dashed');
