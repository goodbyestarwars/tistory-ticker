/* 차트 도형 계정 저장 로직 검증(브라우저 없이): stock-search.js의 동기화 함수 구간을 가짜 fetch로 실행한다. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(__dirname + '/../js/stock-search.js', 'utf8');
const a = src.indexOf('  var DRAWING_API_URL'), b = src.indexOf('  function stockDrawingStorageKey(key, timeframe) {');
assert(a > 0 && b > a);
const code = src.slice(a, b);

const server = { authed: true, rows: {}, puts: [], gets: 0, authCalls: 0, conflictOnce: false };
function resp(status, body) { return Promise.resolve({ status, ok: status < 300, json: () => Promise.resolve(body) }); }
function fakeFetch(url, opt) {
  if (url.indexOf('/auth/google/me') > 0) { server.authCalls++; return resp(200, { data: { configured: true, authenticated: server.authed } }); }
  if (!opt || !opt.method) {
    server.gets++;
    const q = new URL(url); const key = q.searchParams.get('code') + '|' + q.searchParams.get('timeframe');
    const row = server.rows[key];
    return resp(200, { data: row ? { drawings: row.drawings, revision: row.revision } : { drawings: null, revision: 0 } });
  }
  const body = JSON.parse(opt.body); const key = body.code + '|' + body.timeframe;
  server.puts.push(body);
  if (server.conflictOnce) { server.conflictOnce = false; server.rows[key] = { drawings: {}, revision: 7 }; return resp(409, {}); }
  const cur = server.rows[key] ? server.rows[key].revision : 0;
  if (body.revision !== cur) return resp(409, {});
  server.rows[key] = { drawings: body.drawings, revision: cur + 1 };
  return resp(200, { data: { revision: cur + 1 } });
}
let timers = [];
const sandbox = {
  fetch: fakeFetch, encodeURIComponent, URL, JSON, Math, Object, Array, String, Promise,
  global: { clearTimeout: (t) => { timers = timers.filter((x) => x !== t); }, setTimeout: (fn) => { const t = { fn }; timers.push(t); return t; }, addEventListener() {} },
  stockDrawingState: null, redrawStockDrawing() {}, writeStockDrawingsLocal() { sandbox.localWrites++; }, localWrites: 0
};
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.scheduleDrawingPush=scheduleDrawingPush;this.pullDrawings=pullDrawings;this.drawingSync=drawingSync;this.drawingsPayload=drawingsPayload;this.thin=thinDrawingPath;', sandbox);
const tick = () => new Promise((r) => setImmediate(r));
const fire = async () => { const t = timers.slice(); timers = []; t.forEach((x) => x.fn()); for (let i = 0; i < 8; i++) await tick(); };
const pt = (n) => ({ time: 't' + n, price: n, logical: n });

(async () => {
  const drawing = { key: '005930', timeframe: 'day', lines: [], paths: [], circles: [], hlines: [{ price: 1500000, _y: 3, _label: {} }], boxes: [] };
  sandbox.stockDrawingState = drawing;
  // 1) 서버에 없고 로컬에 있으면 한 번 올린다(이전)
  sandbox.pullDrawings(drawing); for (let i = 0; i < 10; i++) await tick();
  assert.strictEqual(server.puts.length, 1, '로컬 도형을 첫 이전으로 올린다');
  assert.deepStrictEqual(server.puts[0].drawings.hlines, [{ price: 1500000 }], '내부 필드(_y 등)는 올리지 않는다');
  assert.strictEqual(server.rows['005930|day'].revision, 1);
  // 2) 같은 변경 연타 -> 1.5초 묶음 1회만 전송
  drawing.hlines.push({ price: 1400000 });
  sandbox.scheduleDrawingPush(drawing); sandbox.scheduleDrawingPush(drawing); sandbox.scheduleDrawingPush(drawing);
  assert.strictEqual(timers.length, 1, '타이머는 하나로 합쳐진다');
  await fire();
  assert.strictEqual(server.puts.length, 2);
  assert.strictEqual(server.rows['005930|day'].revision, 2);
  // 3) 서버에 값이 있으면 서버 값을 쓴다
  server.rows['000660|day'] = { drawings: { lines: [{ start: pt(1), end: pt(2) }], hlines: [{ price: 5 }] }, revision: 3 };
  const other = { key: '000660', timeframe: 'day', lines: [], paths: [], circles: [], hlines: [], boxes: [] };
  sandbox.stockDrawingState = other;
  const putsBefore = server.puts.length;
  sandbox.pullDrawings(other); for (let i = 0; i < 10; i++) await tick();
  assert.strictEqual(other.lines.length, 1); assert.strictEqual(other.hlines[0].price, 5);
  assert.strictEqual(server.puts.length, putsBefore, '서버 값을 받을 때는 다시 올리지 않는다');
  // 4) 그 사이 종목이 바뀌면 늦게 온 응답을 적용하지 않는다
  const stale = { key: '035420', timeframe: 'day', lines: [], paths: [], circles: [], hlines: [], boxes: [] };
  server.rows['035420|day'] = { drawings: { hlines: [{ price: 9 }] }, revision: 1 };
  sandbox.stockDrawingState = stale; sandbox.pullDrawings(stale); sandbox.stockDrawingState = other;
  for (let i = 0; i < 10; i++) await tick();
  assert.strictEqual(stale.hlines.length, 0, '오래된 응답은 버린다');
  // 5) 409 충돌: 최신 revision을 받아 한 번 더 저장
  const d2 = { key: '035720', timeframe: 'week', lines: [], paths: [], circles: [], hlines: [{ price: 2 }], boxes: [] };
  sandbox.stockDrawingState = d2; server.conflictOnce = true; const n0 = server.puts.length;
  sandbox.scheduleDrawingPush(d2); await fire();
  assert.strictEqual(server.puts.length, n0 + 2, '충돌 시 재시도 1회');
  assert.strictEqual(server.rows['035720|week'].revision, 8);
  // 6) 분봉·비정상 코드는 서버에 보내지 않는다
  const n1 = server.puts.length;
  sandbox.scheduleDrawingPush({ key: '005930', timeframe: 'minute', hlines: [] });
  sandbox.scheduleDrawingPush({ key: 'a b', timeframe: 'day', hlines: [] });
  assert.strictEqual(timers.length, 0); await fire(); assert.strictEqual(server.puts.length, n1);
  // 7) 로그아웃 상태면 서버 호출이 없다
  const out = { authCalls: 0 };
  sandbox.drawingSync.authPromise = Promise.resolve(false);
  const d3 = { key: '111111', timeframe: 'day', lines: [], paths: [], circles: [], hlines: [{ price: 1 }], boxes: [] };
  sandbox.stockDrawingState = d3; const n2 = server.puts.length, g2 = server.gets;
  sandbox.scheduleDrawingPush(d3); await fire(); sandbox.pullDrawings(d3); for (let i = 0; i < 6; i++) await tick();
  assert.strictEqual(server.puts.length, n2); assert.strictEqual(server.gets, g2);
  // 8) 연필 점 솎기
  const long = Array.from({ length: 1000 }, (_, i) => pt(i));
  const thinned = sandbox.thin(long);
  assert.strictEqual(thinned.length, 120); assert.strictEqual(thinned[0].time, 't0'); assert.strictEqual(thinned[119].time, 't999');
  console.log('chart drawings sync ok');
})().catch((e) => { console.error(e); process.exit(1); });
