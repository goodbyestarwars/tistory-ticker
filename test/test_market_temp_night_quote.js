// 증시온도 '다음 거래일 전망' 코스피200 야간선물 칸: 값은 /futures의 KOSPI200_NIGHT 행 그대로, 상태는 시각으로 정하고,
// 값이 없거나 묵었으면 '시세 없음'(주간 선물·현물로 대체하지 않는다).
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const src = fs.readFileSync('js/market-temp.js', 'utf8').replace('global.MarketTemp = MarketTemp;', 'global.MarketTemp = MarketTemp; global.t={nightQuote_,loadTomorrow_};');
const sb = { window: {}, document: { readyState: 'loading', addEventListener() {} }, console, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({}) }) };
vm.runInNewContext(src, sb);
const t = sb.window.t;
const row = (over = {}) => ({ symbol: 'KOSPI200_NIGHT', price: 1052.3, change: -8.45, change_rate: -0.8, stale: false, updated_at: '2026-10-23T09:58:00Z', ...over });
const at = (iso) => Date.parse(iso);

// 세션 중(19:00 KST) 2분 전 갱신 = 실시간, 20분 전 = 지연
let q = t.nightQuote_(row(), at('2026-10-23T10:00:00Z'));
assert.equal(q.status, '실시간'); assert.equal(q.price, 1052.3); assert.equal(q.change, -8.45); assert.equal(q.time, '10.23 18:58 KST');
assert.equal(t.nightQuote_(row({ updated_at: '2026-10-23T09:40:00Z' }), at('2026-10-23T10:00:00Z')).status, '지연 20분');
// 세션 밖(낮 12:00 KST)이면 마지막 값은 최종 마감
q = t.nightQuote_(row({ updated_at: '2026-10-22T20:00:00Z' }), at('2026-10-23T03:00:00Z'));
assert.equal(q.status, '최종 마감'); assert.equal(q.time, '10.23 05:00 KST');
// 값 없음·stale·72시간 넘게 묵음 = null(시세 없음)
assert.equal(t.nightQuote_(null, at('2026-10-23T10:00:00Z')), null);
assert.equal(t.nightQuote_(row({ stale: true }), at('2026-10-23T10:00:00Z')), null);
assert.equal(t.nightQuote_(row({ price: null }), at('2026-10-23T10:00:00Z')), null);
assert.equal(t.nightQuote_(row({ updated_at: '2026-10-19T00:00:00Z' }), at('2026-10-23T10:00:00Z')), null);

// 카드 렌더: 야간선물 칸은 항상 있고, 데이터가 없으면 '시세 없음'
const us = (p) => [['SP500_INDEX', p[0]], ['NASDAQ_INDEX', p[1]], ['DOW_INDEX', p[2]], ['SOX', p[3]], ['VIX', p[4]], ['USDKRW', p[5]]]
  .map(([s, v]) => ({ symbol: s, stale: false, chart: [{ date: '20200101', close: 100 }, { date: '20200102', close: 100 }, { date: '20200103', close: 100 * (1 + v / 100) }] }));
async function render(rows) {
  const mount = { innerHTML: '', firstChild: { outerHTML: '<div class="mt-tm-head"></div>' } };
  await t.loadTomorrow_({ querySelector: (q) => (q.includes('heading') ? null : mount) }, rows);
  return mount.innerHTML;
}
(async () => {
  const live = row({ updated_at: new Date(Date.now() - 60000).toISOString() });
  let html = await render(us([-1.21, -2.6, 0.02, -3.2, 14.09, 0.8]).concat([live]));
  assert(html.includes('코스피200 야간선물') && html.includes('-0.80%') && html.includes('1,052.30') && html.includes('(-8.45)') && html.includes('출처 KIS'), '야간선물 칸에 가격·등락·출처');
  assert(html.includes('mt-tm-brief') && html.includes('야간선물 -0.80%'), '한국장 영향 브리핑에 야간선물');
  assert(html.includes('다음 거래일 전망') || html.includes('내일 전망') || html.includes('오늘 전망'), '소제목');
  html = await render(us([-1.21, -2.6, 0.02, -3.2, 14.09, 0.8]));
  assert(html.includes('시세 없음') && html.includes('데이터 확인 중') && !html.includes('출처 KIS'), '값이 없으면 시세 없음, 다른 값으로 대체하지 않음');
  console.log('night quote ok');
})();
