// Run: node test/test_stock_downside_card.js
// 종목분석 카드형 02 '하방 압력 점검' 4단계 판정·결측 문구·카드 HTML 계약.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const core = require('../js/chart-core.js');
const win = { NineChartCore: core, addEventListener() {}, NineUI: { escapeHtml: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') } };
const source = fs.readFileSync('js/foreign-flow.js', 'utf8').replace('global.ForeignFlow =', 'global.__down={downsideCheck,buildDownsideCard,buildStockStoryHtml,buildTrendChartCard}; global.ForeignFlow =');
vm.runInNewContext(source, { window: win, document: { readyState: 'loading', addEventListener() {} }, console, setTimeout, clearTimeout });
const { downsideCheck, buildDownsideCard, buildStockStoryHtml, buildTrendChartCard } = win.__down;

function day(i) { return new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10); }
// 오래된→최신 일봉. 하락장: 지그재그로 고점·저점이 함께 낮아지고 하락일 거래량이 크다.
function falling(n) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100000 - i * 900 + (i % 6 < 3 ? 2500 : -2500);
    const down = i % 6 >= 3;
    return { date: day(i), open: c + (down ? 800 : -800), close: c, high: c + 1200, low: c - 1200, volume: down ? 1500 : 700 };
  });
}
function newestFirst(n, fn) { return Array.from({ length: n }, (_, k) => ({ date: day(n - 1 - k), ...fn(k) })); }

// ── 하락장 + 신용 그대로 + 대차 증가 + 외국인 매도·개인 매수 → 4개 위험 ──
const chart = { daily: falling(60) };
const entry = {
  credit: { signal: { flag: false } },
  series: {
    credit: newestFirst(40, k => ({ balance: 2_870_000 + k * 1000, ratio_pct: 2.11 })),
    loan: newestFirst(40, k => ({ balance: 22_000_000 - k * 120_000 })),
    short: newestFirst(40, () => ({ ratio_pct: 28 })),
    investor: newestFirst(40, () => ({ foreign_mil: -5000, ind_mil: 4000, inst_mil: 1000 }))
  }
};
const flow = { daily: newestFirst(40, k => ({ foreign_ratio: 17.7 + k * 0.1, foreign_shares: 24_000_000 })) };
let c = downsideCheck(entry, flow, chart);
assert.deepEqual(c.steps.map(s => s.state), ['risk', 'risk', 'risk', 'risk'], JSON.stringify(c.steps.map(s => [s.key, s.state, s.text])));
assert.equal(c.headline, '지하실 연료가 남아 있습니다');
assert(c.steps[1].metric.includes('상장주식의'), '외국인 보유주수/비중으로 상장주식 대비 대차잔고 비율');
assert(c.steps[2].text.includes('외국인 -1,000억') && c.steps[2].text.includes('개인 +800억'), c.steps[2].text);
assert.equal(c.flips.filter(f => f.on).length, 0);

// ── 반대매매 흔적·대차 감소·외국인 5일 순매수 → 완화 신호 ──
const relief = JSON.parse(JSON.stringify(entry));
relief.credit.signal = { flag: true, date: '2026-08-20', balance_change_pct: -7.2 };
relief.series.loan = newestFirst(40, k => ({ balance: 20_000_000 + k * 100_000 }));
relief.series.investor = newestFirst(40, k => ({ foreign_mil: k < 5 ? 3000 : -5000, ind_mil: -1000, inst_mil: 0 }));
c = downsideCheck(relief, flow, chart);
assert.equal(c.steps[0].state, 'ok');
assert.equal(c.steps[1].state, 'ok');
assert.equal(c.steps[2].state, 'ok');
assert(c.flips.filter(f => f.on).length >= 3);
assert.equal(c.headline, '하방 압력이 풀리는 신호가 보입니다');

// ── 결측: 시계열 없음(구 응답·시간 초과) → 0으로 바꾸지 않고 정보 없음 문구 ──
c = downsideCheck(null, null, chart);
assert.deepEqual(c.steps.map(s => s.state), ['none', 'none', 'none', 'risk']);
assert(c.steps[0].text.includes('신용융자 정보가 없습니다'));
assert(c.steps[1].text.includes('대차·공매도 정보가 없습니다'));
assert(c.steps[2].text.includes('투자자별 매매 정보가 없습니다'));
assert(c.flips.slice(0, 3).every(f => !f.known));
c = downsideCheck(null, null, { daily: falling(10) });
assert.equal(c.known, 0);
assert.equal(c.headline, '하방 압력 자료 없음');
let html = buildDownsideCard(null, null, { daily: [] });
assert(html.includes('자료를 받지 못했습니다') && html.includes('일봉이 25개 미만'));
assert(!/NaN|Infinity|undefined/.test(html), html);
// 신용만 비어 있는 종목(신용거래 불가)
const noCredit = JSON.parse(JSON.stringify(entry)); noCredit.series.credit = []; delete noCredit.credit;
c = downsideCheck(noCredit, flow, chart);
assert.equal(c.steps[0].state, 'none');
assert.equal(c.steps[1].state, 'risk');
// 결측 칸이 섞여도 NaN 없이 가장 가까운 유효값과 비교
const holes = JSON.parse(JSON.stringify(entry)); holes.series.loan[20].balance = null; holes.series.short.forEach(r => { r.ratio_pct = null; });
c = downsideCheck(holes, flow, chart);
assert(c.steps[1].metric && !/NaN/.test(c.steps[1].text), c.steps[1].text);

// ── 투매봉: 최근 10봉 안의 대량거래 + 긴 아래꼬리 ──
const climax = falling(60); climax[57] = { ...climax[57], open: 49000, close: 49500, high: 50000, low: 44000, volume: 6000 };
c = downsideCheck(entry, flow, { daily: climax });
assert.equal(c.steps[3].state, 'ok');
assert(c.flips[3].on);

// ── 카드 HTML·캐러셀 계약: 차트 카드 다음 02번, 점·넘김 버튼 생성 ──
html = buildDownsideCard(entry, flow, chart);
assert(html.includes('data-story-number="02"') && html.includes('ff-wide--downside'));
assert.equal((html.match(/class="ff-down-step /g) || []).length, 4);
assert.equal((html.match(/ff-down-spark/g) || []).length, 4);
assert(html.includes('매수·매도 신호가 아닙니다') && html.includes('반대매매 금액은 종목별로 공개되지 않습니다'));
assert(!/NaN|Infinity|undefined/.test(html));
const longDaily = Array.from({ length: 260 }, (_, i) => ({ date: day(i), open: 100 + i, close: 101 + i, high: 103 + i, low: 98 + i, volume: 1000 }));
const story = buildStockStoryHtml({ name: '테스트', baselineOnly: true, cards: [] }, buildTrendChartCard({ daily: longDaily }) + html, 2, '086520', true);
assert(story.indexOf('ff-wide--chart') < story.indexOf('ff-wide--downside'));
assert(story.includes('data-wide-prev') && story.includes('2번 카드'));
console.log('PASS downside card: 4-step risk/relief, missing data text, climax, card contract');
