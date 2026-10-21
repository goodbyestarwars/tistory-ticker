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

// 키움 전용 목록에서는 공급자 판정을 그대로 표시한다.
t.state.liveTradeProvider = 'Kiwoom';
t.state.liveTrades = [];
t.recordLiveTrade({ direction: 'sell', directionSource: 'provider', time: '093456', price: 176100, qty: 3, market: '1' });
const kiwoomHtml = t.buildTradesHtml();
const visibleNote = html => {
  const fragment = html.split('class="ob-trades-note"')[1];
  assert(fragment, 'short trade note exists');
  return fragment.split('>')[1].split('<')[0];
};
assert(visibleNote(kiwoomHtml).includes('키움 0B 실시간 · FID 15 방향'));
assert(visibleNote(kiwoomHtml).includes('중복·누락 가능'));
assert(!visibleNote(kiwoomHtml).includes('거래소 원본값 수신'));
assert(visibleNote(kiwoomHtml).length <= 35, 'note is compact enough for one or two lines');
assert(kiwoomHtml.includes('title="키움 0B 개별 수신 체결'));
assert(kiwoomHtml.includes('▼ 매도주도'));
t.state.liveTradeProvider = 'KIS';
assert(visibleNote(t.buildTradesHtml()).includes('호가 기준 방향 추정'));
t.state.tradeFeedStatus = '실시간 재연결 중 · 누락 가능';
assert(visibleNote(t.buildTradesHtml()).includes('재연결 중'));
t.state.tradeFeedStatus = 'REST 시세 폴백 · 개별 체결 없음';
assert(visibleNote(t.buildTradesHtml()).includes('새 개별 체결 없음'));
t.state.tradeFeedStatus = '실시간 연결 중단';
assert(visibleNote(t.buildTradesHtml()).includes('연결 중단'));
t.state.tradeFeedStatus = '실시간 체결 대기 중';
t.state.liveTradeProvider = 'Kiwoom';
const styles = fs.readFileSync('css/order-book.css', 'utf8');
const noteStyles = styles.split('#order-book .ob-trades-note {')[1].split('}')[0];
assert(noteStyles.includes('word-break: keep-all'));
assert(noteStyles.includes('white-space: normal'));
assert(!noteStyles.includes('line-clamp'));


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
