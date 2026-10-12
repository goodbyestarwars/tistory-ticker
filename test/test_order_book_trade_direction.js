const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const window = { addEventListener() {} };
const context = { window, document: { readyState: 'loading', addEventListener() {} },
  setTimeout, clearTimeout, setInterval, clearInterval, Date, Number, Promise };
vm.createContext(context);
const source = fs.readFileSync('js/order-book.js', 'utf8').replace(
  'global.OrderBook = OrderBook;',
  'global.testTrades = { state: state, recordTrade: recordTrade, recordLiveTrade: recordLiveTrade, buildTradesHtml: buildTradesHtml }; global.OrderBook = OrderBook;'
);
vm.runInContext(source, context);
const t = window.testTrades;
const live = (direction, time = '093112', price = 70000, qty = 1250) =>
  t.recordLiveTrade({ direction, directionSource: 'provider', time, price, qty, market: 'H0UNCNT0' });

// 전일 대비 등락은 체결 방향과 별개다. 서버의 changeRate를 목록에 전달하지 않는다.
live('buy');
assert(t.buildTradesHtml().includes('▲ 매수주도'));
assert(t.buildTradesHtml().includes('ob-trade-price ob-up'));
live('sell', '093113', 70100, 830);
assert(t.buildTradesHtml().includes('▼ 매도주도'));
live('unknown', '093114', 70050, 420);
assert(t.buildTradesHtml().includes('— 판정불가'));
t.recordLiveTrade({ direction: 'buy', directionSource: 'estimate', time: '093114', price: 70100, qty: 20 });
assert(t.buildTradesHtml().includes('▲ 매수추정'));

// 원본 이벤트 ID가 없으므로 같은 시각·가격·수량의 별개 수신을 제거하지 않는다.
const before = t.state.liveTrades.length;
live('buy'); live('buy');
assert.strictEqual(t.state.liveTrades.length, before + 2);
for (let i = 0; i < 30; i++) live('sell', '093115');
assert.strictEqual(t.state.liveTrades.length, 20);
// 영업일자가 바뀌면 이전 장의 체결은 새 수신 목록에 남지 않는다.
t.recordLiveTrade({ direction: 'sell', directionSource: 'provider', time: '090001', date: '20261013', price: 70000, qty: 1 });
t.recordLiveTrade({ direction: 'buy', directionSource: 'provider', time: '090002', date: '20261014', price: 70100, qty: 2 });
assert.strictEqual(t.state.liveTrades.length, 1);
assert.strictEqual(t.state.liveTrades[0].date, '20261014');

// REST 표본은 방향을 추측하거나 실시간 목록과 합치지 않는다.
t.recordTrade({ trade: { time: '093116', price: 69900, qty: 50, up: true, down: false } });
assert.strictEqual(t.state.trades.length, 1);
assert(!t.buildTradesHtml().includes('69,900'));
t.state.liveTrades = [];
const sampled = t.buildTradesHtml();
assert(sampled.includes('REST 2초 표본'));
assert(sampled.includes('— 판정불가'));
assert(!sampled.includes('▲ 매수주도'));
console.log('order-book trade direction: ok');
