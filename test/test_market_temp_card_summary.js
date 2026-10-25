
require('./helpers/common_runtime');
// 카드는 summary만(2026-10-24 사용자 지시): 제목·상태·수치·기준 시각만 보이고 문장형·대화형 코멘트와 하단 설명 박스는 없다.
// 서버 AI 코멘트 엔진은 그대로이고 화면 표시(AI_CARD_COMMENTS_)만 꺼져 있다. 꺼진 동안 /ai-comments도 읽지 않는다.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const src = fs.readFileSync('js/market-temp.js', 'utf8').replace('global.MarketTemp = MarketTemp;',
  'global.MarketTemp = MarketTemp; global.t={renderIndicatorRows_,buildIndicatorModels_,extrasBlock_,commodityStrip_,aiSayHtml_,loadAiComments_,XMODELS_};');
let fetched = 0;
const sb = { window: {}, document: { readyState: 'loading', addEventListener() {} }, console, setTimeout, clearTimeout, fetch: async () => { fetched++; return { ok: true, json: async () => ({}) }; } };
vm.runInNewContext(src, sb);
const t = sb.window.t;

assert.equal(t.aiSayHtml_('oil', 'mt-xsay'), '', '코멘트 자리도 그리지 않는다');
(async () => {
  await t.loadAiComments_({});
  assert.equal(fetched, 0, '표시가 꺼져 있으면 /ai-comments를 부르지 않는다');
})();

const glance = t.renderIndicatorRows_(t.buildIndicatorModels_({}, []), 'kospi-volume');
assert(!/data-ai-slot|mt-glance-say|mt-ai-line/.test(glance), '시장 한눈에에 코멘트 없음');

const now = Date.parse('2026-10-23T09:00:00Z');
const iso = '2026-10-23T08:50:00Z';
const hist = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 22 + i)).toISOString().slice(0, 10), arbitrage: -50, nonArbitrage: -300000 }));
const dom = { programTrading: { available: true, date: '2026-10-22', arbitrage: -125, nonArbitrage: -723200, history: hist } };
const opt = { CALL: { volume: 2646, updated_at: iso }, PUT: { volume: 3531, updated_at: iso } };
const ser = (s, v) => ({ symbol: s, stale: false, chart: v.map((x, i) => ({ date: new Date(Date.UTC(2026, 8, 12 + i)).toISOString().slice(0, 10).replace(/-/g, ''), close: x })) });
const rise = Array.from({ length: 40 }, (_, i) => 4.5 + i * 0.016);
const html = t.extrasBlock_(dom, [ser('US10Y', rise), ser('US30Y', rise.map(x => x + 0.3)), ser('US2Y', rise.map(x => x - 0.3))], opt, now);
assert(!/mt-xsay|data-ai-slot/.test(html), '수급·심리·금리 카드에 코멘트 없음');
assert(html.includes('20일 누적') && html.includes('순매도') && html.includes('풋/콜') && html.includes('미국 10년') && html.includes('미국 30년'), '핵심 수치는 그대로');
assert(!/매도 우세 지속|이력이 없어|오늘은 평화/.test(html), '문장형 설명 없음');
assert(!/이력이 없어|날짜별 그래프는 없습니다/.test(t.XMODELS_['x-putcall'].pcHtml), '옵션 풋/콜 상세에 어정쩡한 이력 없음 설명 없음');
assert(t.XMODELS_['x-putcall'].pcHtml.includes('mt-pc-bar'), '풋·콜 비중 막대는 유지');
const strip = t.commodityStrip_([{ symbol: 'WTI', price: 100.28, change_rate: 0.81, updated_at: iso, stale: false }, { symbol: 'GOLD', price: 4030.8, change_rate: -0.73, updated_at: iso, stale: false }, { symbol: 'BTC', price: 199330000, change_rate: 0.39, updated_at: iso, stale: false }], now);
assert(!/mt-xsay|data-ai-slot/.test(strip) && strip.includes('$100.28') && strip.includes('-0.73%'), '원자재·가상자산도 코멘트 없이 현재가·등락률·기준 시각만');
console.log('card summary ok');
