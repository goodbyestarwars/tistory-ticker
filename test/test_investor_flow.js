// Run: node test/test_investor_flow.js
// 국내 증시 자금 흐름(js/investor-flow.js)의 계산 규칙과, 공용 차트(IndicatorBoard.createChart)의 막대·선·보조 축·범례 동작을 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { addEventListener() {}, removeEventListener() {} };
const sandbox = { window, document: {}, Math, Date, Number, String, isFinite, Object, Array, JSON, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync('js/indicator-board.js', 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync('js/investor-flow.js', 'utf8'), sandbox);
const IB = window.IndicatorBoard;
const C = window.InvestorFlow._calc;

function mk(date, f, o, i, idx) { return { date, foreign: f, institution: o, individual: i, indexClose: idx == null ? null : idx }; }

// ── 금액 서식(억원 입력) ──
assert.equal(IB.util.fmtEok(29972.2, true), '+3.00조');
assert.equal(IB.util.fmtEok(-2649.1), '-2,649억');
assert.equal(IB.util.fmtEok(332000), '33.2조');
assert.equal(IB.util.fmtEok(523), '523억');
assert.equal(IB.util.fmtEok(null), '-');
// 눈금 간격이 1조보다 작으면 소수 자릿수를 늘려 이웃 눈금 글자가 겹치지 않는다
assert.equal(IB.util.fmtEokAxis(332000, 2000), '33.2조');
assert.notEqual(IB.util.fmtEokAxis(332000, 2000), IB.util.fmtEokAxis(334000, 2000));
assert.equal(IB.util.fmtEokAxis(0), '0');
assert.equal(IB.util.fmtEokAxis(-20000), '-2.0조');
assert.equal(IB.util.fmtEokAxis(5000), '5,000억');

// ── 누적: 기간 시작 0, 기간을 바꾸면 그 기간 기준으로 다시 누적 ──
const rows = [
  mk('2026-10-01', 100, -40, -60, 2800), mk('2026-10-02', -30, 10, 20, 2810), mk('2026-10-05', 50, 50, -100, 2790),
  mk('2026-10-06', -10, 20, -10, 2805), mk('2026-10-07', 70, -90, 20, 2820)
];
let cum = C.cumulative(rows, 3);
assert.equal(cum.days, 3);
assert.equal(cum.hasBaselineDate, true);
assert.equal(JSON.stringify(cum.dates), JSON.stringify(['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']), '기간 직전 거래일이 시작점(0)');
assert.equal(JSON.stringify(cum.series.foreign), JSON.stringify([0, 50, 40, 110]));
assert.equal(JSON.stringify(cum.series.institution), JSON.stringify([0, 50, 70, -20]));
assert.equal(JSON.stringify(cum.series.individual), JSON.stringify([0, -100, -110, -90]));
assert.equal(JSON.stringify(cum.index), JSON.stringify([2810, 2790, 2805, 2820]));
cum = C.cumulative(rows, 5);
assert.equal(cum.hasBaselineDate, false, '자료가 기간과 같으면 직전 거래일이 없다');
assert.equal(cum.dates[0], '기간 시작');
assert.equal(JSON.stringify(cum.series.foreign), JSON.stringify([0, 100, 70, 120, 110, 180]));
assert.equal(cum.index[0], null, '시작점에는 지수가 없다');
// 합계 = 누적 마지막 값(막대 합과 선이 어긋나지 않는다)
assert.equal(cum.series.foreign[cum.series.foreign.length - 1], C.sumOf(rows, 'foreign'));
cum = C.cumulative([], 20);
assert.equal(cum.days, 0);
// 기간이 자료보다 길어도(자료 부족) 있는 만큼만
cum = C.cumulative(rows, 250);
assert.equal(cum.days, 5);

// ── 연속 순매수·순매도 ──
assert.equal(JSON.stringify(C.streak(rows, 'foreign')), JSON.stringify({ sign: 1, days: 1 }));
assert.equal(JSON.stringify(C.streak([mk('a', 1), mk('b', 2), mk('c', 3), mk('d', -1)], 'foreign')), JSON.stringify({ sign: -1, days: 1 }));
assert.equal(JSON.stringify(C.streak([mk('a', -1), mk('b', 2), mk('c', 3), mk('d', 4)], 'foreign')), JSON.stringify({ sign: 1, days: 3 }));
assert.equal(JSON.stringify(C.streak([mk('a', 5), mk('b', 0)], 'foreign')), JSON.stringify({ sign: 0, days: 0 }), '마지막이 0이면 연속 없음');
assert.equal(JSON.stringify(C.streak([], 'foreign')), JSON.stringify({ sign: 0, days: 0 }));

// ── 잔고 통계: 5·20거래일 변화, 20일 평균 대비, 추세 문턱(±1%) ──
function series(n, f) { const out = []; for (let i = 0; i < n; i++) out.push([new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10), f(i)]); return out; }
let st = C.balanceStats(series(30, (i) => 1000 + i * 10)); // 매일 +10
assert.equal(st.last, 1290);
assert.equal(st.change5, 50);
assert.equal(st.change20, 200);
assert.ok(Math.abs(st.pct20 - 200 / 1090 * 100) < 1e-9);
assert.equal(st.avg20, (1100 + 1290) / 2, '마지막 20개 평균');
assert.equal(st.trend, 'up');
st = C.balanceStats(series(30, () => 1000));
assert.equal(st.trend, 'flat');
assert.equal(st.change20, 0);
assert.equal(C.balanceStats(series(30, (i) => 1000 - i * 10)).trend, 'down');
// 문턱: +1.00% 이상 증가, 그 아래 보합
const base = series(21, (i) => (i === 20 ? 1010 : 1000));
assert.equal(C.balanceStats(base).trend, 'up', '정확히 +1.0% 는 증가');
assert.equal(C.balanceStats(series(21, (i) => (i === 20 ? 1009 : 1000))).trend, 'flat');
assert.equal(C.balanceStats(series(21, (i) => (i === 20 ? 990 : 1000))).trend, 'down');
// 자료가 짧으면 계산하지 않는다
st = C.balanceStats(series(10, (i) => 1000 + i));
assert.equal(st.pct20, null);
assert.equal(st.trend, null);
assert.equal(st.avg20, null);
assert.notEqual(st.change5, null);
st = C.balanceStats([]);
assert.equal(st.last, null);
assert.equal(st.count, 0);

// ── 증시자금 원자료에서 시계열 뽑기: 빈 값은 0원이 아니라 제외, 날짜 오름차순 ──
const funds = {
  series: [
    { date: '2026-10-02', credit: 330000, market_funds: { investor_deposits: 1000000 } },
    { date: '2026-10-01', credit: 329000, market_funds: { investor_deposits: null } },
    { date: '2026-10-03', credit: null, market_funds: { investor_deposits: 1010000 } },
    { date: '', credit: 1, market_funds: { investor_deposits: 1 } },
    { date: '2026-10-04', credit: { loan_total: 331000 }, market_funds: null }
  ]
};
assert.equal(JSON.stringify(C.balanceSeries(funds, 'credit')), JSON.stringify([['2026-10-01', 329000], ['2026-10-02', 330000], ['2026-10-04', 331000]]));
assert.equal(JSON.stringify(C.balanceSeries(funds, 'deposits')), JSON.stringify([['2026-10-02', 1000000], ['2026-10-03', 1010000]]));
assert.equal(JSON.stringify(C.balanceSeries(null, 'credit')), '[]');

// ── 요약: 규칙대로만, 추천·점수 문구 없음 ──
const twenty = [];
for (let i = 0; i < 25; i++) twenty.push(mk('2026-09-' + String(i + 1).padStart(2, '0'), i < 20 ? 50 : 100, -30, -20 + (i < 20 ? 0 : -80), 3000));
let sm = C.summarize(twenty, C.balanceStats(series(30, (i) => 1000 + i * 10)), C.balanceStats(series(30, () => 500)), 'KOSPI');
const text = sm.lines.map((l) => l.label + l.text).join(' ') + ' ' + sm.sentences.join(' ');
assert.match(sm.lines[0].text, /최근 20거래일 순매수/);
assert.equal(sm.lines[0].label, '외국인');
assert.equal(sm.lines[1].label, '기관');
assert.match(sm.lines[1].text, /순매도/);
assert.ok(sm.sentences[0].includes('KOSPI 최근 20거래일 합계는 외국인 순매수, 기관·개인 순매도입니다.'), sm.sentences[0]);
assert.ok(sm.sentences[0].includes('외국인 25거래일 연속 순매수'), '5거래일 이상 연속은 문장에 언급');
assert.ok(sm.sentences[1].includes('고객예탁금은 늘고 있고 신용잔고는 보합권'), sm.sentences[1]);
for (const bad of ['추천', '유망', '급등 예상', '매수하세요', '점', '긍정', '부정', '전망']) assert.ok(text.indexOf(bad) < 0, '금지 표현: ' + bad);
// 20거래일 미만이면 투자자 요약을 하지 않는다
sm = C.summarize(twenty.slice(0, 10), null, null, 'KOSDAQ');
assert.match(sm.lines[0].text, /20일 미만/);
assert.equal(sm.sentences.length, 0);

// ── 02(투자자)·03(잔고) 요약이 따로 만들어지고, 합친 summarize 와 같은 결과를 낸다 ──
const invOnly = C.summarizeInvestors(twenty, 'KOSPI');
assert.equal(invOnly.lines.length, 3, '02 요약은 투자자 3줄만');
assert.equal(JSON.stringify(invOnly.lines.map((l) => l.label)), JSON.stringify(['외국인', '기관', '개인']));
const balOnly = C.summarizeBalances(C.balanceStats(series(30, (i) => 1000 + i * 10)), C.balanceStats(series(30, () => 500)));
assert.equal(JSON.stringify(balOnly.lines.map((l) => l.label)), JSON.stringify(['고객예탁금', '신용잔고']), '03 요약은 잔고 2줄만');
assert.equal(balOnly.sentences.length, 1);
assert.equal(typeof window.InvestorFlow.mount, 'function');
assert.equal(typeof window.InvestorFlow.mountBalance, 'function');
// 투자자 색은 외국인 빨강·기관 파랑·개인 초록으로 고정된 토큰만 쓴다(방향에 따라 바꾸지 않는다)
assert.equal(JSON.stringify(C.INVESTORS.map((i) => i.key + ':' + /--mi-inv-(\w+)/.exec(i.color)[1])), JSON.stringify(['foreign:foreign', 'institution:inst', 'individual:indiv']));

// ── 공용 차트 ──
function fakeNode() { return { hidden: false, clientWidth: 640, style: {}, listeners: {}, innerHTML: '', addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, removeAttribute() {}, getBoundingClientRect() { return { left: 0, width: 640 }; }, querySelector() { return fakeNode(); } }; }
function makeChartHost() {
  const chartEl = fakeNode(), legendEl = fakeNode();
  const root = { querySelector(sel) { return sel === '[data-ic-chart]' ? chartEl : sel === '[data-ic-legend]' ? legendEl : fakeNode(); } };
  const host = { innerHTML: '', querySelector() { return root; } };
  return { host, chartEl, legendEl };
}
const count = (s, re) => (s.match(re) || []).length;

let h = makeChartHost();
let chart = IB.createChart(h.host, { height: 200 });
const bars = {
  type: 'bars', dates: ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'],
  series: [
    { key: 'foreign', label: '외국인', color: '#7a4fb5', values: [100, -50, 0, null] },
    { key: 'individual', label: '개인', color: '#1f8f80', values: [-80, 30, 20, 10] }
  ],
  fmt: IB.util.fmtEok, axisFmt: IB.util.fmtEokAxis, zero: true
};
chart.update(bars);
let html = h.chartEl.innerHTML;
assert.equal(count(html, /class="ibd-bar"/g), 6, '0·null 은 막대를 그리지 않는다');
assert.equal(count(html, /class="ibd-zero"/g), 1, '양수·음수가 함께 있으면 0선');
const zeroY = Number(/class="ibd-zero" x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)"/.exec(html)[1]);
const rects = [...html.matchAll(/<rect class="ibd-bar" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" style="fill:([^;"]+)/g)].map((m) => ({ y: Number(m[1]), h: Number(m[2]), fill: m[3] }));
const fRects = rects.filter((r) => r.fill === '#7a4fb5');
assert.equal(fRects.length, 2);
assert.ok(Math.abs(fRects[0].y + fRects[0].h - zeroY) < 0.2, '양수 막대의 아래 끝은 0선');
assert.ok(Math.abs(fRects[1].y - zeroY) < 0.2, '음수 막대의 위 끝은 0선');
assert.equal(count(h.legendEl.innerHTML, /data-ic-key=/g), 2, '범례 버튼');
// 범례로 계열 숨기기
const click = h.legendEl.listeners.click;
click({ target: { closest: () => ({ getAttribute: () => 'foreign' }) } });
assert.equal(count(h.chartEl.innerHTML, /class="ibd-bar"/g), 4, '외국인을 끄면 개인 막대만');
assert.match(h.legendEl.innerHTML, /is-off/);
click({ target: { closest: () => ({ getAttribute: () => 'individual' }) } });
assert.match(h.chartEl.innerHTML, /하나 이상 켜 주세요/);

// 선 + 결측 구간 끊기 + 보조 축 + 기준선
h = makeChartHost();
chart = IB.createChart(h.host, { height: 200 });
chart.update({
  type: 'lines', dates: ['a', 'b', 'c', 'd', 'e'],
  series: [{ key: 'x', label: 'X', color: '#111', values: [0, 10, null, 30, 40] }],
  fmt: IB.util.fmtEok, zero: false, refLines: [{ value: 20, label: '20일 평균' }],
  secondary: { label: '지수', values: [100, 101, 102, 103, 104], fmt: (v) => String(v), axisFmt: (v) => String(v) }
});
html = h.chartEl.innerHTML;
const pathD = /class="ibd-mline" d="([^"]+)"/.exec(html)[1];
assert.equal(count(pathD, /M/g), 2, 'null 에서 선이 끊겨 두 구간');
assert.equal(count(html, /class="ibd-secline"/g), 1);
assert.ok(count(html, /ibd-axis-sec/g) >= 2, '오른쪽 보조 축 눈금');
assert.equal(count(html, /class="ibd-ref"/g), 1);
assert.match(html, /20일 평균/);
assert.equal(count(html, /class="ibd-zero"/g), 0, 'zero:false 면 0선 없음');
assert.match(h.legendEl.innerHTML, /오른쪽 축/);

// 빈 자료·한 점짜리 선
h = makeChartHost();
chart = IB.createChart(h.host, {});
chart.update({ type: 'bars', dates: [], series: [], emptyText: '자료 없음' });
assert.match(h.chartEl.innerHTML, /자료 없음/);
chart.update({ type: 'lines', dates: ['a'], series: [{ key: 'x', label: 'x', color: '#000', values: [1] }] });
assert.match(h.chartEl.innerHTML, /1개뿐/);

// 이 화면의 기본값은 서버에서 받은 자료만 쓴다 - 소스에 총매수·총매도를 순매수에서 계산하는 코드가 없다
const src = fs.readFileSync('js/investor-flow.js', 'utf8');
assert.ok(src.indexOf('data-if-gross') < 0 && src.indexOf('실제 매수·매도 금액') < 0 && src.indexOf('renderGross') < 0, '실제 매수·매도 금액 구역 제거');
assert.ok(src.indexOf('data-if-basis') > 0, '외국인 기준 안내는 누적 표 아래에 남긴다');
assert.ok(!/grossBuy|totalBuy|총매수\s*=|buy\s*=\s*\(?\s*net/.test(src), '총매수를 순매수에서 거꾸로 계산하지 않는다');
assert.ok(src.indexOf('/investor-trend/history') > 0);

console.log('PASS: investor flow (cumulative, streak, balance stats, summary rules, multi-series chart)');
