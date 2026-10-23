// 증시온도 '다음 거래일 전망' 코스피200 야간선물 칸: 값은 /futures의 KOSPI200_NIGHT 행 그대로, 상태는 시각으로 정하고,
// 값이 없거나 묵었으면 '시세 없음'(주간 선물·현물로 대체하지 않는다).
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const src = fs.readFileSync('js/market-temp.js', 'utf8').replace('global.MarketTemp = MarketTemp;', 'global.MarketTemp = MarketTemp; global.t={nightQuote_,loadTomorrow_,tmComment_};');
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

// 지표별 한 줄 해설(부호·크기만으로 결정)
assert.equal(t.tmComment_('dji',0.02),'다우는 가까스로 버텼네');assert.equal(t.tmComment_('nas',-2.6),'기술주 매도세가 강했네');
assert.equal(t.tmComment_('sox',-6.72),'반도체 급락… 국내도 부담');assert.equal(t.tmComment_('vix',3.47),'시장 불안이 커지고 있네');
assert.equal(t.tmComment_('night',-0.67),'야간선물 하락… 시초 주의');assert.equal(t.tmComment_('spx',-1.21),'대형주 전반이 크게 밀렸네');
assert.equal(t.tmComment_('spx',null),'미수신');
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
  assert(html.includes('코스피200 야간선물') && html.includes('-0.80%') && html.includes('야간선물 하락… 시초 주의'), '기본 카드: 이름·등락률·한 줄 해설');
  assert(html.includes('mt-tm-nd') && html.includes('1,052.30') && html.includes('-8.45') && html.includes('KIS 야간선물') && html.includes('실시간'), '상세에 현재가·등락폭·상태·출처');
  assert(html.includes('mt-tm-brief') && html.includes('야간선물 -0.80%'), '한국장 영향 브리핑에 야간선물');
  assert(html.includes('다음 거래일 전망') || html.includes('내일 전망') || html.includes('오늘 전망'), '소제목');
  html = await render(us([-1.21, -2.6, 0.02, -3.2, 14.09, 0.8]));
  assert(html.includes('시세 없음') && html.includes('데이터 확인 중') && !html.includes('KIS 야간선물'), '값이 없으면 시세 없음, 다른 값으로 대체하지 않음');
  assert.equal((html.match(/mt-tm-item/g) || []).length, 6, '6칸(S&P·나스닥·다우·SOX·VIX·야간선물)');
  console.log('night quote ok');
})();
