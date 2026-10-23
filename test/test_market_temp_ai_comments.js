// AI 시장 코멘트 화면 계약 (2026-10-23): 카드 옆 한 줄 해설은 서버가 생성·검증해 저장한 확정 코멘트(GET /ai-comments)를 그대로 보여 준다.
// 고정 문구 풀 없음 / 코멘트가 없으면 빈 칸(자리는 예약) / 실패해도 금융 데이터·카드는 그대로 / 지난 거래일 코멘트는 기준일 표시 / HTML 이스케이프.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const src = fs.readFileSync('js/market-temp.js', 'utf8').replace('global.MarketTemp = MarketTemp;',
  'global.MarketTemp = MarketTemp; global.t={setAiCards:function(v){AI_CARD_COMMENTS_=v;},renderIndicatorRows_,buildIndicatorModels_,buildBreadthVisual_,frontPageStory_,buildSummaryCard,extrasBlock_,commodityStrip_,AI_STATE_,loadAiComments_,aiSayHtml_,lanePeriod_,marketPhase_};');
let fetchImpl = async () => ({ ok: true, json: async () => ({}) });
const sb = { window: {}, document: { readyState: 'loading', addEventListener() {} }, console, setTimeout, clearTimeout, fetch: (...a) => fetchImpl(...a) };
vm.runInNewContext(src, sb); sb.window.t.setAiCards(true); // 표시 계약 시험: 카드 코멘트 표시를 켜고 확인(기본 화면은 꺼져 있다 - test_market_temp_card_summary.js)
const t = sb.window.t;

assert(!/COMMENT_POOLS_|commentHash_|marketComment_|marketCommentTier_|tmComment_|rateComment_|programComment_/.test(src), '미리 쓴 문장 풀·선택 함수가 남아 있지 않다');
assert(!/api\.groq|gsk_|GROQ_API_KEY|\/chat\/completions/i.test(src), '브라우저에 AI 호출·키가 없다');

const models = t.buildIndicatorModels_({}, []);
const empty = t.renderIndicatorRows_(models, 'kospi-volume');
for (const slot of ['kospi_volume', 'kosdaq_volume', 'foreign', 'institution', 'individual', 'credit', 'deposits', 'fx']) {
  assert(empty.includes('mt-glance-say is-empty" data-ai-slot="' + slot + '"'), slot + ' 자리 예약(빈 칸)');
}
assert(!/data-ai-slot="[a-z_]+"[^>]*>[^<]/.test(empty), '코멘트가 없으면 어떤 문장도 채우지 않는다');

t.AI_STATE_.comments = {
  foreign: { text: '외국인은 팔고 기관이 받아 주는 모양새네', generatedAt: '2026-10-23 11:05:00', dataAsOf: '2026-10-23', tradeDate: '2099-01-01', model: 'm' },
  fx: { text: '달러가 조금씩 비싸지는 흐름이네', generatedAt: '2026-10-23 11:05:00', dataAsOf: '2026-10-23', tradeDate: '2099-01-01', model: 'm' },
  credit: { text: '<img src=x onerror=alert(1)> 빚투', generatedAt: '2026-10-22 20:30:00', dataAsOf: '2026-10-21', tradeDate: '2026-10-22', model: 'm' },
  breadth: { text: '내린 종목이 훨씬 많아서 체감은 별로네', generatedAt: '2026-10-23 11:05:00', dataAsOf: '2026-10-23', tradeDate: '2099-01-01', model: 'm' },
  market_summary: { text: '내린 종목이 많은데 기관이 받쳐 주는 장이네', generatedAt: '2026-10-23 11:05:00', dataAsOf: '2026-10-23', tradeDate: '2099-01-01', model: 'm' },
  program: { text: '20일 중 20일 팔았네… 수급이 무거워 보이네', generatedAt: '2026-10-23 11:05:00', dataAsOf: '2026-10-23', tradeDate: '2099-01-01', model: 'm' },
};
const filled = t.renderIndicatorRows_(models, 'kospi-volume');
assert(filled.includes('외국인은 팔고 기관이 받아 주는 모양새네') && filled.includes('달러가 조금씩 비싸지는 흐름이네'), '해당 행에 코멘트 표시(환율 저울 행 포함)');
assert(!filled.includes('<img src=x') && filled.includes('&lt;img src=x onerror=alert(1)&gt; 빚투'), 'HTML 이스케이프');
assert(/mt-ai-asof">\s*· 10\.22 기준/.test(filled), '지난 거래일에 만든 코멘트는 원래 기준일 표시');
assert(!filled.includes('· 10.23 기준') && !/외국인은 팔고[^<]*<small class="mt-ai-asof"/.test(filled), '오늘(미래 거래일 값) 코멘트에는 기준일 꼬리표 없음');
assert(filled.includes('title="AI 코멘트 · 생성 2026-10-23 11:05:00 · 데이터 기준 2026-10-23 · m"'), '생성 시각·데이터 기준일 툴팁');
const story = t.frontPageStory_({ components: {}, marketBreadth: { total: { up: 400, down: 1100, flat: 50, total: 1550 } } });
assert(t.buildBreadthVisual_(story).includes('내린 종목이 훨씬 많아서 체감은 별로네'), '상승·하락 종목 비중 아래 코멘트');
assert(t.buildSummaryCard({ components: {}, marketBreadth: { total: { up: 400, down: 1100, flat: 50, total: 1550 } } }).includes('mt-ai-summary'), '시장 한눈에 요약 줄');
const extras = t.extrasBlock_({ programTrading: { available: true, date: '2026-10-22', arbitrage: 1, nonArbitrage: -1, history: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 21 - 29 + i)).toISOString().slice(0, 10), arbitrage: 0, nonArbitrage: -1000 })) } }, [], null, Date.parse('2026-10-23T09:00:00Z'));
assert(extras.includes('20일 중 20일 팔았네… 수급이 무거워 보이네'), '프로그램매매 카드에 서버 코멘트');
t.AI_STATE_.comments = {};

// ---- 읽기: 성공 / 실패(금융 데이터 영향 없음) / 변화 없음 ----
(async () => {
  const body = { success: true, data: { comments: { oil: { text: '기름값은 잠잠하네', generatedAt: '2026-10-23 11:00:00', dataAsOf: '2026-10-23', tradeDate: '2099-01-01', model: 'm' } } } };
  let calls = 0;
  fetchImpl = async (url) => { calls++; assert.equal(url, 'https://goodbyestar.cloud/ai-comments', 'DB 읽기 전용 엔드포인트만 부른다'); return { ok: true, json: async () => body }; };
  const container = { __mtLivePage: null };
  sb.window.__mtAiFetch = null;
  await t.loadAiComments_(container);
  assert.equal(t.AI_STATE_.comments.oil.text, '기름값은 잠잠하네');
  assert.equal(calls, 1);
  // 공용 fetch 재사용: TTL 안에서는 다시 부르지 않는다
  await t.loadAiComments_(container);
  assert.equal(calls, 1);
  // 실패: 예외를 던지지 않고 이전 코멘트를 그대로 둔다(카드·금융 데이터는 영향 없음)
  sb.window.__mtAiFetch = null;
  fetchImpl = async () => { throw new Error('network'); };
  await assert.doesNotReject(() => t.loadAiComments_(container));
  assert.equal(t.AI_STATE_.comments.oil.text, '기름값은 잠잠하네');
  // 잘못된 응답 형식도 무시
  sb.window.__mtAiFetch = null;
  fetchImpl = async () => ({ ok: true, json: async () => ({ success: true, data: { oops: 1 } }) });
  await t.loadAiComments_(container);
  assert.equal(Object.keys(t.AI_STATE_.comments).length, 1);
  // 서버가 코멘트를 숨기면(상태 변화·오래됨) 화면에서도 사라진다
  sb.window.__mtAiFetch = null;
  fetchImpl = async () => ({ ok: true, json: async () => ({ success: true, data: { comments: {}, hidden: { oil: 'state-changed' } } }) });
  await t.loadAiComments_(container);
  assert.equal(Object.keys(t.AI_STATE_.comments).length, 0);
  assert(t.aiSayHtml_('oil', 'mt-xsay').includes('is-empty'));
  // 레인 주기: 장중 2분, 개장 전·마감 후 5분, 휴장·마감 뒤 15분 이상(서버 DB 읽기만)
  const P = (ms) => t.marketPhase_(ms, null), at = (h, m) => Date.UTC(2026, 9, 26, h - 9, m);
  assert.equal(t.lanePeriod_('ai', {}, P(at(10, 0)), at(10, 0)), 120000);
  assert.equal(t.lanePeriod_('ai', {}, P(at(8, 0)), at(8, 0)), 300000);
  assert.equal(t.lanePeriod_('ai', {}, P(at(15, 45)), at(15, 45)), 300000);
  assert(t.lanePeriod_('ai', {}, P(at(20, 0)), at(20, 0)) >= 900000);
  console.log('AI market comments: slots, escaping, as-of label, failure isolation, lane cadence ok');
})().catch((e) => { console.error(e); process.exit(1); });
