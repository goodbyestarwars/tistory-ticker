/* 운영센터 '주문 기록' 표·월간 합계·CSV(js/auto-trader.js) - 실행: node test/test_auto_trader_orders.js */
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
  grab('  function esc('), grab('  function fmtPrice'), grab('  function fmtWon'), grab('  function signed'), grab('  function pct'), grab('  function tone'),
  grab('  var REASON_LABEL'), grab('  var ORDER_STATUS'),
  'var lastRendered = null, krxByCode = null, krxLoading = false; var loads = 0;',
  'function loadKrxMap() { loads++; }',
  grab('  function krxName'), grab('  function orderNames'),
  grab('  var PRICE_KIND'), grab('  function priceCell'),
  grab('  function orderMetric'), grab('  function realOrders'), 'var selMonth = null, selDay = null;', grab('  var WEEK'),
  grab('  function daysInMonth'), grab('  function shiftMonth'), grab('  function pad2'), grab('  function monthAggregate'), grab('  function monthSummaryHtml'),
  grab('  function csvCell'), grab('  function ordersCsv'), grab('  function ordersHtml')
].join('\n');
const sb = { global: {}, document: {}, Object, Number, String, Array, Date, RegExp };
vm.runInNewContext(code + '\nthis.f = { ordersHtml, monthAggregate, monthSummaryHtml, ordersCsv, shiftMonth, daysInMonth, orderMetric, setDay: function (d) { selDay = d; }, setMonth: function (m) { selMonth = m; }, getLoads: function () { return loads; } };', sb);
sb.global.KRX_MAP = { '삼성전자': '005930' };
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const orders = [
  { ts: '2026-10-16 09:12:29', code: '352820', qty: 1, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', name: '하이브', buy_price: 165900, price: 171000, price_kind: 'estimate' },   // +3.07% 익절
  { ts: '2026-10-16 09:00:56', code: '352820', qty: 1, reason: 'BUY', status: 'ACK', detail: '실계좌 매수 주문', name: '하이브', price: 165900, price_kind: 'order' },
  { ts: '2026-10-16 09:57:25', code: '089590', qty: 52, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', buy_price: 5760, price: 5500, price_kind: 'estimate' },              // -4.51% 손절
  { ts: '2026-10-16 09:04:48', code: '089590', qty: 52, reason: 'BUY', status: 'ACK', detail: '실계좌 매수 주문', price: 5760, price_kind: 'order' },
  { ts: '2026-10-19 09:05:10', code: '011200', qty: 12, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', buy_price: 23650, price: 22900, price_kind: 'decision' },
  { ts: '2026-10-14 09:15:51', code: '005930', qty: 3, reason: 'SELL', status: 'ACK', detail: '실계좌 매도 주문', buy_price: null, price: null },
  { ts: '2026-09-30 09:00:00', code: '111111', qty: 1, reason: 'BUY', status: 'ACK', detail: '실계좌 매수 주문', price: 1000 },
  { ts: '2026-10-14 09:00:00', code: '999999', qty: 1, reason: 'BUY', status: 'DRY', detail: '기록', price: 1 },
];
const D = { holdings: [{ code: '011200', name: 'HMM' }], watch: [], status: { now: '2026-10-19 10:00:00' } };

// 1) 지표·음영
const m = sb.f.orderMetric(orders[0]);
assert.ok(Math.abs(m.ret - 3.0741) < 0.001 && m.pnl === 5100 && m.amount === 171000);
const h = sb.f.ordersHtml(orders, '2026-10-19', D);
const t = strip(h);
['매수 가격', '매도 가격', '등락률', '평가금액', '평가손익', '하이브', '+3.07%', '-4.51%', '5,100', '-13,520', '판정가', '추정', 'HMM', 'CSV 내려받기(전체)', '익절', '손절'].forEach((k) => assert.ok(t.includes(k), k));
const rows = h.split('<tr').slice(2);
const byCode = (c, side) => rows.find((r) => r.includes('>' + c + '<') && r.includes('<td>' + side + '</td>'));
assert.ok(byCode('352820', '매도').startsWith(' class="at-row-win"'), '익절 = 붉은 음영 클래스');
assert.ok(byCode('089590', '매도').startsWith(' class="at-row-loss"'), '손절 = 파란 음영 클래스');
assert.ok(byCode('352820', '매수').startsWith('>'), '매수 행은 음영 없음');
assert.ok(byCode('005930', '매도').startsWith('>'), '가격 없는 매도는 음영 없음');
assert.ok(t.includes('삼성전자'), 'KRX_MAP 이름 보충');
assert.ok(!t.includes('999999'), 'DRY 제외');
assert.ok(/title="[^"]*추정할 분봉도 없음/.test(h));

// 2) 월간 일자별 합계 (1일~말일 전부, 합계)
const days = sb.f.monthAggregate(orders, '2026-10');
assert.strictEqual(days.length, 31);
const d16 = days[15];
assert.deepStrictEqual([d16.buy, d16.sell, d16.pnl, d16.count], [165900 + 5760 * 52, 171000 + 5500 * 52, 5100 + (5500 - 5760) * 52, 4]);
assert.strictEqual(days[18].sell, 22900 * 12);                 // 10/19 매도금액
assert.strictEqual(days[13].unpriced, 1);                      // 10/14 가격 없는 매도
assert.strictEqual(sb.f.monthAggregate(orders, '2026-09')[29].buy, 1000);
assert.strictEqual(sb.f.monthAggregate(orders, '2026-02').length, 28);
assert.strictEqual(sb.f.shiftMonth('2026-12', 1), '2027-01');
assert.strictEqual(sb.f.shiftMonth('2026-01', -1), '2025-12');
sb.f.setMonth(null);
const ms = sb.f.monthSummaryHtml(orders, '2026-10-19');
const mt = strip(ms);
['월간 일자별 합계', '1일', '31일', '합계', '월 평가손익', '월 매도금액(평가금액)', '이번 달'].forEach((k) => assert.ok(mt.includes(k), k));
assert.strictEqual((ms.match(/class="at-day/g) || []).length, 31, '1일부터 31일까지 31줄');
assert.ok(/data-day="2026-10-16"/.test(ms) && !/data-day="2026-10-15"/.test(ms), '주문 있는 날만 선택 가능');
assert.ok(/type="month"[^>]*value="2026-10"/.test(ms));

// 3) 날짜 지정: 그날 주문만, 없는 날은 안내
sb.f.setDay('2026-10-16');
const hd = strip(sb.f.ordersHtml(orders, '2026-10-19', D));
assert.ok(hd.includes('하이브') && !hd.includes('HMM') && !hd.includes('22,900'), '선택한 날(10/16)만');
assert.ok(strip(sb.f.monthSummaryHtml(orders, '2026-10-19')).includes('주문만 보는 중'));
sb.f.setDay('2026-10-01');
assert.ok(strip(sb.f.ordersHtml(orders, '2026-10-19', D)).includes('2026-10-01에는 주문이 없습니다'));
sb.f.setDay(null);

// 4) CSV: BOM, 헤더, 오름차순, 가격 구분
const csv = sb.f.ordersCsv(orders, D);
assert.ok(csv.startsWith('﻿시각,종목명,종목코드,구분,수량,매수 가격,매도 가격,가격 구분,등락률(%),평가금액,평가손익,상태,매도 사유,내용'));
const lines = csv.trim().split('\r\n');
assert.strictEqual(lines.length, 1 + 7, 'DRY 제외 7건 + 헤더');
assert.ok(lines[1].startsWith('2026-09-30 09:00:00'), '시간 오름차순');
const hive = lines.find((l) => l.includes('2026-10-16 09:12:29'));
assert.ok(hive.includes(',하이브,352820,매도,1,165900,171000,추정,3.07,171000,5100,'), hive);
assert.strictEqual(sb.f.ordersCsv([], D).trim().split('\r\n').length, 1);

// 5) 이름 없으면 사전 로드 요청
sb.global.KRX_MAP = null;
const before = sb.f.getLoads();
sb.f.ordersHtml([{ ts: '2026-10-16 09:00:00', code: '123456', qty: 1, reason: 'BUY', status: 'ACK', detail: '', price: 100 }], 't', {});
assert.strictEqual(sb.f.getLoads() - before, 1);
console.log('auto-trader 주문 기록·월간 합계·CSV 검증 통과');
