/* test_index_ws.py 가 호출하는 시뮬레이션: stock-search.js 의 connectIndexSocket·closeIndexSocket 을 가짜 WebSocket·가짜 패널로 실행한다. */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'stock-search.js'), 'utf8');
function grab(name) {
  const a = src.indexOf('function ' + name);
  const m = /\r?\n  \}\r?\n/.exec(src.slice(a));
  return src.slice(a, a + m.index + m[0].length);
}
const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); }
  close() { this.closed = true; this.readyState = 3; }
}
const timers = [];
const quoteEl = { innerHTML: '', className: '' }, noteEl = { textContent: '' };
const panel = { hidden: false, querySelector: (sel) => sel === '.ss-index-quote' ? quoteEl : (sel === '.ss-index-note' ? noteEl : null) };
const updates = [];
const code = `
  var state = { selectedCode: 'INDEX:KOSPI' };
  var INDEX_WS_URL = 'wss://goodbyestar.cloud/ws/market-indicators';
  var INDEX_WS_SYMBOLS = { KOSPI: 1, KOSDAQ: 1, NASDAQ_INDEX: 1, SP500_INDEX: 1, DOW_INDEX: 1 };
  var indexSocket = null, indexSocketTimer = null, indexSocketDelay = 1500, indexSocketGen = 0, indexSocketTarget = null;
  var indexBars = [{ date: TODAY, open: 100, high: 105, low: 98, close: 102 }];
  var indexSeries = { update: function (b) { updates.push(b); } };
  var indexTimeframe = 'day';
  var WebSocket = FakeWS;
  var global = { WebSocket: FakeWS };
  var document = DOC;
  function fmtSignedPct(v) { return (v >= 0 ? '+' : '') + v + '%'; }
  function signClass(v) { return v >= 0 ? 'up' : 'down'; }
  var setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
  var clearTimeout = function () {};
  ${grab('kstToday')}
  ${grab('indexLiveBar')}
  ${grab('closeIndexSocket')}
  ${grab('connectIndexSocket')}
  return { connect: connectIndexSocket, close: closeIndexSocket, get bars() { return indexBars; }, get socket() { return indexSocket; }, get target() { return indexSocketTarget; }, state: state };
`;
const kstDay = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const DOC = { hidden: false };
const api = new Function('FakeWS', 'panel', 'updates', 'timers', 'TODAY', 'DOC', code)(FakeWS, panel, updates, timers, kstDay, DOC);
const out = {};
api.connect(panel, { code: 'KOSPI' });
out.url = sockets[0].url;
sockets[0].onmessage({ data: JSON.stringify({ type: 'market-indicators', data: [{ symbol: 'KOSPI', price: 108.5, change_rate: 2.05, updated_at: 'T1' }] }) });
out.quote = quoteEl.innerHTML; out.note = noteEl.textContent; out.cls = quoteEl.className;
out.bar = api.bars[0]; out.updates = updates.length;
sockets[0].onmessage({ data: 'not json' });                                                    // 깨진 패킷은 무시
sockets[0].onmessage({ data: JSON.stringify({ type: 'other', data: [] }) });
sockets[0].onmessage({ data: JSON.stringify({ type: 'market-indicators', data: [{ symbol: 'KOSDAQ', price: 1, change_rate: 0 }] }) });
out.unchangedAfterIgnored = quoteEl.innerHTML === out.quote;
sockets[0].onclose();                                                                           // 연결이 끊기면 지연 뒤 재연결을 예약한다
out.reconnectScheduled = timers.length === 1 && timers[0].ms === 1500;
timers[0].fn();
out.reconnected = sockets.length === 2;
api.state.selectedCode = 'INDEX:KOSDAQ';                                                        // 다른 지수로 바뀌면 옛 소켓 메시지는 무시한다
const before = quoteEl.innerHTML;
sockets[1].onmessage({ data: JSON.stringify({ type: 'market-indicators', data: [{ symbol: 'KOSPI', price: 999, change_rate: 9 }] }) });
out.ignoredAfterSwitch = quoteEl.innerHTML === before;
api.close();
out.closed = sockets[1].closed === true;
sockets[1].onclose();                                                                           // 닫은 소켓의 onclose 는 재연결하지 않는다
out.noReconnectAfterClose = timers.length === 1;
const n = sockets.length;
api.connect(panel, { code: 'SOX' });
out.soxSkipped = sockets.length === n;
DOC.hidden = true;                                                                              // 숨겨진 탭에서 열면 소켓은 만들지 않되 대상은 기억한다
const m = sockets.length;
api.state.selectedCode = 'INDEX:KOSPI';
api.connect(panel, { code: 'KOSPI' });
out.hiddenNoSocket = sockets.length === m;
out.hiddenRemembersTarget = !!(api.target && api.target.row.code === 'KOSPI');
DOC.hidden = false;
api.connect(panel, { code: 'KOSPI' });                                                          // 다시 보이면 연결된다
out.visibleConnects = sockets.length === m + 1;
process.stdout.write(JSON.stringify(out));
