// 9Pay 호가창 매물벽·동시호가 표시 회귀 테스트 (Node.js 내장 모듈 전용)
// Run: node --test test/orderbook-wall-evidence.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/order-book.js'), 'utf8');
const instrumentation = '\n  window.__testOrderBook = { state, isAuctionWindow, normalizeExpected, wallTrend, wallEvidenceReady, checkWallBreakthrough, renderBookProvenance };';
assert.ok(source.includes('  global.OrderBook = OrderBook;'), 'test injection anchor');

function makeHarness(iso = '2026-10-22T01:05:00Z') {
  const clock = Date.parse(iso);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const window = { addEventListener() {} };
  const document = { readyState: 'loading', addEventListener() {}, createElement() { return { textContent: '', className: '' }; } };
  const script = source.replace('  global.OrderBook = OrderBook;', '  global.OrderBook = OrderBook;' + instrumentation);
  const context = vm.createContext({ window, document, Date: Clock, console, setTimeout: () => 0, clearTimeout() {} });
  new vm.Script(script, { filename: 'order-book.js' }).runInContext(context);
  return { ...window.__testOrderBook, clock };
}

test('시장 전환 및 동시호가 시간대에 잔량 판정 보류', () => {
  assert.equal(makeHarness('2026-10-22T06:30:00Z').isAuctionWindow(), true);  // 15:30 KST
  assert.equal(makeHarness('2026-10-22T23:40:00Z').isAuctionWindow(), true); // 08:40 KST on 23rd
  assert.equal(makeHarness('2026-10-22T01:05:00Z').isAuctionWindow(), false);
});

test('예상체결 필드는 실제 양수 가격만 사용', () => {
  const h = makeHarness();
  assert.equal(h.normalizeExpected({ antc_cnpr: '123000', antc_vol: '1000' }).volume, 1000);
  assert.equal(h.normalizeExpected({ antc_cnpr: '0', antc_vol: '1000' }), null);
  assert.equal(h.normalizeExpected({}), null);
});

test('관측 근거 없는 잔량 감소와 사다리 이탈은 돌파가 아니다', () => {
  const h = makeHarness();
  const quote = { source: 'KIS WebSocket', price: 123000, delayed: false };
  h.state.lastWsBook = { asks: [], bids: [] };
  h.state.lastWsBookAt = h.clock;
  h.state.lastRealtimeQuote = quote;
  h.state.lastRealtimeAt = h.clock;
  assert.equal(h.wallEvidenceReady(quote), true);
  const fake = { querySelector(selector) {
    if (selector === '#obMilestones') return { innerHTML: '' };
    if (selector === '#obToast') return { textContent: '', className: '' };
    return null;
  } };
  const start = { asks: [{ price: 124000, qty: 100 }, { price: 123000, qty: 1000 }, { price: 122500, qty: 100 }] };
  h.checkWallBreakthrough(fake, start, quote);
  assert.equal(h.state.trackedWall.price, 123000);
  h.checkWallBreakthrough(fake, { asks: [{ price: 124000, qty: 100 }, { price: 122500, qty: 100 }, { price: 122000, qty: 100 }] }, quote);
  assert.equal(h.state.milestones.length, 0);
  h.checkWallBreakthrough(fake, start, quote);
  h.checkWallBreakthrough(fake, { asks: [{ price: 124000, qty: 100 }, { price: 123000, qty: 50 }, { price: 122500, qty: 100 }] }, quote);
  assert.equal(h.state.milestones.length, 0);
});

test('매수벽 추적이 독립적이고 5분할 잔량의 변화를 통계로 표현', () => {
  const h = makeHarness();
  assert.equal(h.wallTrend({ price: 123000, qty: 100 }, 100, 0, 'bid'), '');
  assert.equal(h.state.bidWallTrack.peakQty, 100);
  assert.equal(h.state.wallTrack, null);
});

test('실시간 통합 호가의 수신 시각과 출처가 노출된다', () => {
  const h = makeHarness();
  const el = { textContent: '' };
  h.renderBookProvenance({ querySelector: (selector) => selector === '#obBookProvenance' ? el : null },
    { ws: true, at: h.clock, market: 'KRX+NXT 통합' }, null);
  assert.match(el.textContent, /KRX\+NXT 통합/);
  assert.match(el.textContent, /실시간 수신/);
});
