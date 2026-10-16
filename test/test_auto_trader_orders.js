/* 운영센터 '주문 기록' 표(js/auto-trader.js ordersHtml): 종목명·매수 가격·매도 가격 - 실행: node test/test_auto_trader_orders.js */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync('js/auto-trader.js', 'utf8');
function grab(marker) {
  const i = src.indexOf(marker); assert.ok(i >= 0, marker);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; if (src[j] === '}') { d--; if (d === 0) break; } }
  let e = j + 1; if (src[e] === ';') e++;
  return src.slice(i, e);
}
const code = [
  grab('  function esc('), grab('  function fmtPrice'),
  grab('  var REASON_LABEL'), grab('  var ORDER_STATUS'),
  'var lastRendered = null, krxByCode = null, krxLoading = false; var loads = 0;',
  'function loadKrxMap() { loads++; }',
  grab('  function krxName'), grab('  function orderNames'),
  grab('  var PRICE_KIND'), grab('  function priceCell'), grab('  function ordersHtml')
].join('\n');
const sb = { global: {}, document: {}, Object, Number, String, Array };
vm.runInNewContext(code + '\nthis.f = { ordersHtml, krxName, getLoads: function () { return loads; } };', sb);
sb.global.KRX_MAP = { '삼성전자': '005930' };
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const orders = [
  { ts: '2026-10-16 09:12:29', code: '352820', qty: 1, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', name: '하이브', buy_price: 165900, price: 171000, price_kind: 'estimate' },
  { ts: '2026-10-16 09:00:56', code: '352820', qty: 1, reason: 'BUY', status: 'ACK', detail: '실계좌 매수 주문', name: '하이브', price: 165900, price_kind: 'order' },
  { ts: '2026-10-19 09:05:10', code: '011200', qty: 12, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', buy_price: 23650, price: 22900, price_kind: 'decision' },
  { ts: '2026-10-14 09:15:51', code: '005930', qty: 3, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', buy_price: null, price: null },
  { ts: '2026-10-14 09:00:00', code: '999999', qty: 1, reason: 'BUY', status: 'DRY', detail: '기록', price: 1 },
];
const h = sb.f.ordersHtml(orders, '2026-10-16', { holdings: [{ code: '011200', name: 'HMM' }], watch: [] });
const t = strip(h);
['매수 가격', '매도 가격', '하이브', '165,900', '171,000', '추정', '주문가', 'HMM', '23,650', '22,900', '판정가'].forEach((k) => assert.ok(t.includes(k), k));
assert.ok(t.includes('삼성전자'), 'KRX_MAP에서 종목명 보충');
assert.ok(!t.includes('999999'), 'DRY 기록은 표에서 제외');
// 매수 행은 매도 가격 칸이 '-', 가격 없는 매도는 '-' + 설명 title
const rows = h.split('<tr>').slice(2);
assert.ok(/<td class="n at-mute">-<\/td>/.test(rows[1]), '매수 행의 매도 가격은 -');
assert.ok(/title="[^"]*추정할 분봉도 없음/.test(rows[3]) && /title="이 매도의 매수 기록을 찾지 못함"/.test(rows[3]), '가격이 없을 때 이유 표시');
assert.ok(h.includes('실제 체결가가 아니니'), '체결가 아님 안내');
// 이름 없으면 사전을 불러오도록 요청
sb.global.KRX_MAP = null;
sb.f.ordersHtml([{ ts: 'x', code: '123456', qty: 1, reason: 'BUY', status: 'ACK', detail: '', price: 100 }], 't', {});
assert.strictEqual(sb.f.getLoads(), 1);
console.log('auto-trader 주문 기록 표 검증 통과');
