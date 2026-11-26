'use strict';
// 검색기 터미널(2026-11-27) 순수 로직·연결 검증. 브라우저 화면은 test/qa_scanner_terminal_browser.py 가 따로 본다.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = (p) => fs.readFileSync(p, 'utf8');
const sandbox = { console, Date, Math, JSON, URLSearchParams, setInterval: () => 0, clearInterval: () => {}, setTimeout, location: { search: '', pathname: '/page/pattern-scan' }, history: {} };
sandbox.window = sandbox;
sandbox.document = { readyState: 'complete', querySelector: () => null, addEventListener: () => {}, createElement: () => ({}), head: { appendChild() {} }, hidden: false };
sandbox.NineAsset = { base: 'https://example.test/' };
vm.createContext(sandbox);
vm.runInContext(read('data/scanner-validation.js'), sandbox);

function load(monitor, quotes) {
  const rows = [];
  sandbox.PatternScan = { terminal: { rows: () => rows, live: () => ({ ninepay: { running: true, active: true }, surge: { active: true } }),
    quote: (code) => (quotes && quotes[code]) || null, refreshQuotes() {}, state: () => ({ tab: 'liveFlow', scanData: { shapeSelection: { dataDate: '2026-11-26', monitor } }, scanSettled: true }) } };
  vm.runInContext(read('js/scanner-terminal.js'), sandbox);
  return sandbox.ScannerTerminal;
}

// 1) 검증 자료: 전략 6개, 채택은 주도주 조용한 눌림 하나, 승격 요건이 문서값과 같다.
const V = sandbox.SCANNER_VALIDATION;
assert.strictEqual(V.strategies.length, 6);
assert.strictEqual(JSON.stringify(V.strategies.filter((s) => s.adopted).map((s) => s.key)), '["leaderPullback"]');
assert.strictEqual(JSON.stringify(V.promotionRule), JSON.stringify({ minClosed: 100, minPf: 1.3, minAvgPct: 1.0, rule: 'exit-v2' }));
V.strategies.forEach((s) => {
  assert.ok(s.buy && s.sell && s.backtest && s.backtest.rows.length, s.key + ' 조건·백테스트');
  assert.ok(s.real && s.real.note, s.key + ' 실계좌 미집계 사유');
});
assert.strictEqual(V.strategies.filter((s) => s.intraday).length, 1);        // 장중 모의는 거래량·가격 회복 하나뿐

// 2) 승격 판단: 요건 충족이어도 "사용자 승인 필요"이고 자동 승격하지 않는다. 기록 없으면 보류.
const T = load({ scanners: {
  'pattern:shape-v2:bottomFormation': { all: { signals: 120, since: '2026-11-20', rules: { 'exit-v2': { closed: 130, pf: 1.5, avgPct: 1.4, open: 4 } } } },
  'pattern:shape-v2:pullbackRebreak': { all: { signals: 30, rules: { 'exit-v2': { closed: 20, pf: 0.8, avgPct: -1.1, open: 3 } } } }
} });
const by = (k) => V.strategies.filter((s) => s.key === k)[0];
assert.strictEqual(T.promotion(by('leaderPullback')).key, 'adopted');
assert.strictEqual(T.promotion(by('bottomFormation')).key, 'review');
assert.match(T.promotion(by('bottomFormation')).text, /사용자 승인/);
assert.strictEqual(T.promotion(by('pullbackRebreak')).key, 'pending');
assert.strictEqual(T.promotion(by('trendBreakout')).key, 'hold');                    // 추적 기록 없음 → 보류(미집계)
assert.match(T.promotion(by('trendBreakout')).text, /미집계/);

// 3) 장중 상태 분류: 실시간 판정은 거래량·가격 회복만, 나머지는 가격 점검일 뿐 실시간으로 표시하지 않는다.
const now = Date.now();
const row = (extra) => Object.assign({ code: '005930', members: [], invalidation: 100 }, extra);
const q = (price) => ({ '005930': { data: { price }, at: now } });
let t = load(null, q(120));
assert.strictEqual(t.classify(row({ members: [{ key: 'ninepayLive' }, { key: 'shape:x' }] }), 'liveFlow').key, 'met');
assert.strictEqual(t.classify(row({ members: [{ key: 'ninepayLive' }] }), 'liveFlow').key, 'new');
assert.strictEqual(t.classify(row({ members: [{ key: 'shape:x' }] }), 'liveFlow').key, 'wait');
assert.strictEqual(t.classify(row({ members: [{ key: 'ninepayLive', stale: true }, { key: 'shape:x' }] }), 'liveFlow').key, 'wait');   // 오래된 신호는 신규로 세지 않는다
t = load(null, q(90));
assert.strictEqual(t.classify(row({ members: [{ key: 'ninepayLive' }] }), 'liveFlow').key, 'broken');
assert.strictEqual(t.classify(row({ members: [{ key: 'shape:x' }] }), 'pullbackRebreak').key, 'broken');
assert.match(t.classify(row({ members: [{ key: 'shape:x' }] }), 'pullbackRebreak').detail, /엔진 재판정 아님/);
t = load(null, q(120));
assert.strictEqual(t.classify(row({ members: [{ key: 'shape:x' }] }), 'pullbackRebreak').key, 'hold');
t = load(null, { '005930': { data: { price: 90 }, at: now - 10 * 60000 } });         // 오래된 시세는 이탈 판정에 쓰지 않는다
assert.notStrictEqual(t.classify(row({ members: [{ key: 'shape:x' }] }), 'pullbackRebreak').key, 'broken');

// 4) 소스 계약: 로더·메뉴·접근 정책·CSS 규칙.
const main = read('js/skin-main.js'), menu = read('js/skin-menu.js'), css = read('css/scanner-terminal.css'), js = read('js/scanner-terminal.js');
assert.match(main, /loadScannerTerminal[\s\S]*scanner-terminal\.css[\s\S]*scanner-validation\.js[\s\S]*scanner-terminal\.js/);
assert.match(menu, /label: '검색기'/);
assert.ok(!/label: '자동매매 검색기'/.test(menu), '메뉴는 하나');
assert.match(menu, /view=auto/);
assert.ok(!/!important/.test(css), '새 !important 금지');
assert.match(css, /html\.dark #pattern-scan\.st-terminal/);
assert.match(css, /@media \(max-width: 860px\)/);
assert.match(css, /30fr 25fr 45fr/);
assert.ok(!/skin\.html/.test(js), 'skin.html 수정/의존 금지');
assert.ok(!/(placeOrder|\/orders?(?![-\w])|buy_stock|sell_stock|method:\s*['"]POST)/i.test(js), '읽기 전용: 주문·쓰기 호출 없음');
assert.ok(!/�/.test(js + css + read('data/scanner-validation.js')), 'U+FFFD 손상 문자 없음');
console.log('scanner terminal tests passed');
