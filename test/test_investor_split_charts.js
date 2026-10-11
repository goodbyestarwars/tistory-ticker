// Run: node test/test_investor_split_charts.js
// 국내시장지표 02 투자자별 순매수 그래프: 분리형·비교형, 일별·주간·월간 집계, 요약 수치, 공용 차트(stacked) 구조를 검사한다.
// 집계 기대값은 test/fixtures/investor/build_expected.py(pandas)가 운영 API 스냅샷(실제 수집 자료)에서 JS와 독립적으로 계산한 값이다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = { addEventListener() {}, removeEventListener() {} };
const sandbox = { window, document: {}, Math, Date, Number, String, isFinite, Object, Array, JSON, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync('js/indicator-board.js', 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync('js/investor-flow.js', 'utf8'), sandbox);
const IB = window.IndicatorBoard;
const C = window.InvestorFlow._calc;
const FX = 'test/fixtures/investor/';
const real = {
  kospi: JSON.parse(fs.readFileSync(FX + 'kospi_history.json', 'utf8')).data.rows,
  kosdaq: JSON.parse(fs.readFileSync(FX + 'kosdaq_history.json', 'utf8')).data.rows
};
const expected = JSON.parse(fs.readFileSync(FX + 'expected.json', 'utf8'));
const INV = ['foreign', 'institution', 'individual'];
const PERIOD_N = { w: 5, m: 20, q: 60, y: 250 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.051, msg + ' (' + a + ' vs ' + b + ')');
const count = (s, re) => (s.match(re) || []).length;

// ── 1) 기본값 규칙 ──
assert.equal(JSON.stringify(C.VIEWS.map((v) => v.key)), JSON.stringify(['split', 'compare']));
assert.equal(JSON.stringify(C.AGGS.map((v) => v.key)), JSON.stringify(['day', 'week', 'month']));
assert.equal(C.defaultAgg('w'), 'day');
assert.equal(C.defaultAgg('m'), 'day');
assert.equal(C.defaultAgg('q'), 'week');
assert.equal(C.defaultAgg('y'), 'month');

// ── 2) 실제 수집 자료: 구간 합계가 pandas 기대값과 같다(시장·기간·집계 전부) ──
let checkedBuckets = 0;
['kospi', 'kosdaq'].forEach((market) => {
  const rows = real[market];
  assert.equal(rows.length, expected[market].rows);
  Object.keys(PERIOD_N).forEach((pk) => {
    const n = PERIOD_N[pk], take = C.lastRows(rows, n), prev = rows.length > n ? rows[rows.length - n - 1] : null;
    const e = expected[market].periods[pk];
    assert.equal(take.length, e.days, market + ' ' + pk + ' 거래일 수');
    assert.equal(take[0].date, e.from);
    assert.equal(take[take.length - 1].date, e.to);
    ['day', 'week', 'month'].forEach((mode) => {
      const got = C.aggregate(take, mode, prev), want = e.agg[mode];
      assert.equal(got.length, want.length, [market, pk, mode, '구간 수'].join(' '));
      got.forEach((b, i) => {
        const w = want[i], tag = [market, pk, mode, i].join(' ');
        assert.equal(b.start, w.start, tag + ' 시작일');
        assert.equal(b.end, w.end, tag + ' 종료일');
        assert.equal(b.days, w.days, tag + ' 거래일 수');
        assert.equal(!!b.partial, !!w.partial, tag + ' 일부 구간 표시');
        INV.forEach((k) => near(b.sums[k], w[k], tag + ' ' + k));
        checkedBuckets++;
      });
      // 합계 보존: 모든 구간 합계의 합 = 선택 기간의 일별 합계(평균이 아니라 합계)
      INV.forEach((k) => near(got.reduce((a, b) => a + b.sums[k], 0), C.sumOf(take, k), [market, pk, mode, k, '구간 합의 합'].join(' ')));
      assert.equal(got.reduce((a, b) => a + b.days, 0), take.length, '구간별 거래일 합 = 선택 기간 거래일');
    });
    // 요약: 최근 순매수·5거래일 합계·선택 기간 합계가 기대값과 같다
    INV.forEach((k) => {
      const s = C.periodSummary(take, k), w = e.summary[k];
      assert.equal(s.length, 3);
      assert.equal(s[0].text, IB.util.fmtEok(w.last, true), [market, pk, k, '최근 순매수'].join(' '));
      assert.equal(s[0].sub, take[take.length - 1].date.slice(5).replace('-', '.'));
      assert.equal(s[1].text, IB.util.fmtEok(w.last5, true), [market, pk, k, '5거래일 합계'].join(' '));
      assert.equal(s[1].label, '5거래일 합계');
      assert.equal(s[2].text, IB.util.fmtEok(w.period, true), [market, pk, k, '선택 기간 합계'].join(' '));
      assert.equal(s[2].sub, e.days + '거래일', '계산에 쓴 거래일 수를 함께 적는다');
    });
  });
});
assert.ok(checkedBuckets > 800, '실제 자료 구간 비교 건수 ' + checkedBuckets);

// ── 3) 합성 자료: 주(월요일 시작)·월 경계, 공휴일 주, 선택 기간 시작에 걸친 일부 구간 ──
const mk = (date, f, o, i) => ({ date, foreign: f, institution: o, individual: i, indexClose: 1000 });
const syn = [
  mk('2026-09-28', 10, 1, -11), mk('2026-09-29', 20, 2, -22), mk('2026-09-30', 30, 3, -33),   // 9월 마지막 주(월~수)
  mk('2026-10-01', 40, 4, -44), mk('2026-10-02', -50, 5, 45),                                    // 같은 주, 10월 시작
  mk('2026-10-06', 60, 6, -66), mk('2026-10-07', -70, 7, 63), mk('2026-10-08', 80, 8, -88)       // 10/5 대체공휴일: 월요일 휴장 주
];
let wk = C.aggregate(syn, 'week', null);
assert.equal(wk.length, 2);
assert.equal(wk[0].start, '2026-09-28'); assert.equal(wk[0].end, '2026-10-02'); assert.equal(wk[0].days, 5);
assert.equal(wk[0].sums.foreign, 10 + 20 + 30 + 40 - 50, '주간은 거래일 합계(월말이 끼어도 같은 주면 한 구간)');
assert.equal(wk[0].sums.foreign === (10 + 20 + 30 + 40 - 50) / 5, false, '평균이 아니다');
assert.equal(wk[1].start, '2026-10-06'); assert.equal(wk[1].days, 3);
assert.equal(wk[1].sums.foreign, 60 - 70 + 80);
assert.equal(wk[1].sums.individual, -66 + 63 - 88);
let mo = C.aggregate(syn, 'month', null);
assert.equal(mo.length, 2);
assert.equal(mo[0].days, 3); assert.equal(mo[0].sums.foreign, 60);
assert.equal(mo[1].days, 5); assert.equal(mo[1].sums.foreign, 40 - 50 + 60 - 70 + 80);
const dl = C.aggregate(syn, 'day', null);
assert.equal(dl.length, 8); assert.equal(dl[4].sums.foreign, -50);
// 부동소수점 누적 오차가 막대에 새지 않는다(0.1+0.2 같은 값)
const fl = C.aggregate([mk('2026-10-06', 0.1, 0, 0), mk('2026-10-07', 0.2, 0, 0)], 'week', null);
assert.equal(fl[0].sums.foreign, 0.3);
// 선택 기간 시작이 주 중간이면 첫 구간은 일부 거래일만 합산되며 표시된다
const withPrev = C.aggregate(syn.slice(1), 'week', syn[0]);
assert.equal(withPrev[0].partial, true); assert.equal(withPrev[0].days, 4);
assert.equal(C.aggregate(syn.slice(5), 'week', syn[4])[0].partial, false, '직전 거래일이 지난주면 일부 구간이 아니다');
assert.match(C.bucketMeta(withPrev[0], 'week').tip, /일부 거래일만 합산/);
assert.match(C.bucketMeta(wk[1], 'week').tip, /주간 합계 · 3거래일/);
assert.match(C.bucketMeta(mo[0], 'month').tip, /2026-09 · 월간 합계 · 3거래일/);
assert.equal(C.aggregate([], 'week', null).length, 0);
// 5거래일보다 짧은 자료의 요약은 쓴 일수를 밝힌다
const short = C.periodSummary(syn.slice(0, 3), 'foreign');
assert.match(short[1].label, /3거래일 합계\(5일 미만\)/);
assert.equal(short[1].text, IB.util.fmtEok(60, true));
assert.equal(JSON.stringify(C.periodSummary([], 'foreign')), '[]');

// ── 4) 집계 선택 규칙: 기본값, 구간 1개뿐이면 일별로 ──
const rows = real.kospi;
assert.equal(C.resolveAgg(rows, 'm', null), 'day');
assert.equal(C.resolveAgg(rows, 'q', null), 'week');
assert.equal(C.resolveAgg(rows, 'y', null), 'month');
assert.equal(C.resolveAgg(rows, 'q', 'day'), 'day', '사용자가 고른 집계가 우선');
assert.equal(C.resolveAgg(rows, 'y', 'week'), 'week');
assert.equal(C.resolveAgg(rows, 'w', 'month'), 'day', '1주는 같은 달이라 월간 구간이 1개뿐 → 일별');
assert.equal(C.resolveAgg(rows.slice(-3), 'w', 'week'), 'day', '자료가 한 주 안이면 주간 구간이 1개뿐 → 일별');

// ── 5) 막대 명세: 기본은 분리형, 비교형은 기존 묶음 막대 ──
const base = { period: 'm', agg: null, view: 'split', label: 'KOSPI', emptyText: '없음' };
let out = C.barsSpec(rows, base);
assert.equal(out.spec.layout, 'stacked', '기본 보기는 분리형');
assert.equal(out.spec.series.length, 3);
assert.equal(JSON.stringify(out.spec.series.map((s) => s.key)), JSON.stringify(INV));
assert.equal(out.spec.dates.length, 20);
out.spec.series.forEach((s) => assert.equal(s.summary.length, 3, '분리형 패널마다 요약 3개'));
assert.equal(out.spec.meta, null, '일별은 구간 정보 없음');
out = C.barsSpec(rows, Object.assign({}, base, { view: 'compare' }));
assert.equal(out.spec.layout, 'grouped', '비교형은 기존 묶음 막대');
assert.equal(out.spec.series.length, 3);
out.spec.series.forEach((s) => assert.equal(s.summary, undefined));
assert.equal(out.spec.series[0].values.length, 20);
// 기간별 기본 집계가 명세에 반영된다(막대 수 = 구간 수)
[['w', 5], ['m', 20], ['q', 14], ['y', 14]].forEach(([pk, nb]) => {
  const o = C.barsSpec(rows, Object.assign({}, base, { period: pk }));
  assert.equal(o.spec.dates.length, nb, pk + ' 기본 집계 구간 수');
});
out = C.barsSpec(rows, Object.assign({}, base, { period: 'q' }));
assert.match(out.title, /주간 합계/);
assert.match(out.caption, /일별 평균이 아님/);
assert.equal(out.spec.meta.length, out.spec.dates.length);
assert.match(out.spec.meta[out.spec.meta.length - 1].tip, /주간 합계/);
// 비교형도 같은 집계·색을 쓴다
const cmpQ = C.barsSpec(rows, Object.assign({}, base, { period: 'q', view: 'compare' }));
assert.equal(JSON.stringify(cmpQ.spec.series.map((s) => s.values)), JSON.stringify(out.spec.series.map((s) => s.values)));
assert.equal(JSON.stringify(cmpQ.spec.series.map((s) => s.color)), JSON.stringify(out.spec.series.map((s) => s.color)));
// 시장을 바꿔도(KOSDAQ) 같은 규칙
const kd = C.barsSpec(real.kosdaq, Object.assign({}, base, { period: 'y', label: 'KOSDAQ' }));
assert.equal(kd.spec.dates.length, 14);
assert.match(kd.spec.ariaLabel, /KOSDAQ/);
// 투자자 색은 고정(방향에 따라 바뀌지 않는다)
assert.equal(JSON.stringify(out.spec.series.map((s) => s.color)), JSON.stringify(C.INVESTORS.map((i) => i.color)));

// ── 6) 극단값 안내: 축은 자르지 않고, 한 막대가 크게 튈 때만 알린다 ──
const flat = Array.from({ length: 12 }, (_, i) => ({ label: '외국인', tip: 'd' + i, value: 100 + i }));
assert.equal(C.outlierNote(flat), '');
const spike = flat.concat([{ label: '외국인', tip: 'x', value: -9000 }]);
assert.match(C.outlierNote(spike), /잘라내지 않았습니다/);
assert.match(C.outlierNote(spike), /-9,000억|-9,000/);
assert.equal(C.outlierNote(flat.slice(0, 5)), '', '표본이 적으면 안내하지 않는다');

// ── 7) 공용 차트(stacked): 같은 날짜 위치·0선·Y축 범위, 패널별 요약, 날짜 라벨 ──
function fakeNode(width) {
  const memo = {};
  return {
    hidden: false, clientWidth: width, offsetWidth: 190, offsetHeight: 80, style: {}, listeners: {}, innerHTML: '',
    addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, removeAttribute() {},
    getBoundingClientRect() { return { left: 0, top: 0, width, height: 400 }; },
    querySelector(sel) { return memo[sel] || (memo[sel] = fakeNode(width)); },
    querySelectorAll(sel) { return [0, 1, 2].map((k) => memo[sel + k] || (memo[sel + k] = fakeNode(width))); }
  };
}
function makeHost(width) {
  const chartEl = fakeNode(width), legendEl = fakeNode(width);
  const root = { querySelector(sel) { return sel === '[data-ic-chart]' ? chartEl : sel === '[data-ic-legend]' ? legendEl : fakeNode(width); } };
  return { host: { innerHTML: '', querySelector() { return root; } }, chartEl, legendEl };
}
function panelsOf(html) { return html.split('<div class="ibd-panel"').slice(1); }
function barsIn(h) { return [...h.matchAll(/<rect class="ibd-bar" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" style="fill:([^;"]+)/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] })); }

function stackedCase(width, period, agg, tag) {
  const hh = makeHost(width), ch = IB.createChart(hh.host, { height: 250, panelHeight: 118 });
  const o = C.barsSpec(real.kospi, { period, agg, view: 'split', label: 'KOSPI', emptyText: '' });
  ch.update(o.spec);
  const html = hh.chartEl.innerHTML, panels = panelsOf(html);
  assert.equal(panels.length, 3, tag + ' 패널 3개');
  const zero = panels.map((p) => /class="ibd-zero" x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)"/.exec(p)[1]);
  assert.equal(new Set(zero).size, 1, tag + ' 세 패널의 0선 위치가 같다');
  const ticks = panels.map((p) => [...p.matchAll(/<text class="ibd-axis" text-anchor="start" x="[\d.]+" y="([\d.]+)">([^<]+)<\/text>/g)].map((m) => m[1] + ':' + m[2]).join('|'));
  assert.equal(new Set(ticks).size, 1, tag + ' 세 패널의 Y축 눈금(위치·글자)이 같다');
  assert.ok(ticks[0].split('|').length >= 3);
  const bars = panels.map(barsIn), z = Number(zero[0]);
  const n = o.spec.dates.length, slot = (width - 6 - 62) / n;
  let ratio = null;
  bars.forEach((list, pi) => {
    const vals = o.spec.series[pi].values.filter((v) => v !== 0 && v != null);
    assert.equal(list.length, vals.length, tag + ' ' + INV[pi] + ' 막대 수');
    assert.ok(list.every((b) => b.fill === C.INVESTORS[pi].color), tag + ' 투자자 고정색');
    // 날짜 위치: 막대 중심은 날짜 칸의 중앙(세 패널 모두 같은 식)
    const col = [];
    o.spec.series[pi].values.forEach((v, i) => { if (v) col.push(6 + slot * (i + 0.5)); });
    list.forEach((b, k) => assert.ok(Math.abs(b.x + b.w / 2 - col[k]) < 0.3, tag + ' 막대 중심이 날짜 칸 중앙 ' + (b.x + b.w / 2) + ' vs ' + col[k]));
    // 양수는 0선 위, 음수는 0선 아래
    let k = 0;
    o.spec.series[pi].values.forEach((v) => {
      if (!v) return;
      const b = list[k++];
      if (v > 0) assert.ok(Math.abs(b.y + b.h - z) < 0.2, tag + ' 순매수는 0선 위에서 시작');
      else assert.ok(Math.abs(b.y - z) < 0.2, tag + ' 순매도는 0선 아래로');
      // 같은 Y축 범위: 금액 1당 픽셀 높이가 세 패널에서 모두 같다
      if (b.h > 6) { const r = b.h / Math.abs(v); if (ratio == null) ratio = r; assert.ok(Math.abs(r - ratio) / ratio < 0.02, tag + ' 금액당 높이 동일 ' + r + ' vs ' + ratio); }
    });
  });
  assert.ok(ratio != null, tag + ' 비율 비교가 실제로 수행됨');
  // 날짜 라벨은 맨 아래 패널에만, 요약은 모든 패널 머리에
  const dateTxt = (p) => [...p.matchAll(/<text class="ibd-axis" text-anchor="middle" x="([\d.]+)" y="[\d.]+">([^<]+)<\/text>/g)].map((m) => ({ x: +m[1], t: m[2] }));
  assert.equal(dateTxt(panels[0]).length, 0); assert.equal(dateTxt(panels[1]).length, 0);
  const labs = dateTxt(panels[2]);
  assert.ok(labs.length >= 2, tag + ' 날짜 라벨');
  for (let i = 1; i < labs.length; i++) assert.ok(labs[i].x - labs[i - 1].x >= 28, tag + ' 라벨이 겹치지 않는다 ' + (labs[i].x - labs[i - 1].x));
  const lastCenter = 6 + slot * (n - 0.5);
  assert.ok(Math.abs(labs[labs.length - 1].x - lastCenter) < 0.2, tag + ' 가장 최근 날짜 라벨 포함');
  panels.forEach((p, pi) => {
    assert.match(p, /최근 순매수/); assert.match(p, /선택 기간 합계/); assert.match(p, new RegExp(C.INVESTORS[pi].label));
  });
  return { html, panels, o, labs, ch, hh };
}

let sc = stackedCase(640, 'm', null, 'PC 1개월 일별');
assert.match(sc.panels[0], /5거래일 합계/);
assert.match(sc.panels[0], /20거래일/);
assert.ok(count(sc.html, /ibd-guide-week/g) >= 3 * 3, '1개월 일별은 주 구분선');
assert.ok(count(sc.html, /ibd-guide-month/g) >= 3, '월이 바뀌는 위치 표시');
assert.match(sc.panels[2], /ibd-axis-month"[^>]*>9월/);
assert.match(sc.panels[2], /ibd-axis-month"[^>]*>10월/);
const mobile = stackedCase(343, 'm', null, '모바일 1개월 일별');
assert.ok(mobile.labs.length < sc.labs.length, '모바일은 날짜 라벨이 더 적다');
stackedCase(640, 'q', null, 'PC 3개월 주간');
stackedCase(343, 'q', null, '모바일 3개월 주간');
const yr = stackedCase(640, 'y', null, 'PC 1년 월간');
assert.equal(count(yr.html, /ibd-guide-week/g), 0, '월간 막대에는 주 구분선이 없다');
stackedCase(640, 'y', 'week', 'PC 1년 주간(사용자 선택)');
stackedCase(640, 'w', null, 'PC 1주 일별');
{
  const hh = makeHost(640), ch = IB.createChart(hh.host, { height: 250, panelHeight: 118 });
  ch.update(C.barsSpec(real.kosdaq, { period: 'q', agg: null, view: 'split', label: 'KOSDAQ', emptyText: '' }).spec);
  assert.equal(panelsOf(hh.chartEl.innerHTML).length, 3, '코스닥도 같은 구조');
}

// 막대 위에 올리면 날짜·투자자·금액이 나온다(집계 구간은 기간·거래일 수까지)
function hover(hh, o, idx, width) {
  const slot = (width - 6 - 62) / o.spec.dates.length;
  const hitNode = hh.chartEl.querySelectorAll('.ibd-hit')[1], tipNode = hh.chartEl.querySelector('[data-ic-tip]');
  hitNode.listeners.pointermove({ clientX: 6 + slot * (idx + 0.5), clientY: 120 });
  return tipNode.innerHTML;
}
{
  const hh = makeHost(640), ch = IB.createChart(hh.host, { height: 250, panelHeight: 118 });
  const o = C.barsSpec(real.kospi, { period: 'q', agg: null, view: 'split', label: 'KOSPI', emptyText: '' });
  ch.update(o.spec);
  const w = expected.kospi.periods.q.agg.week, last = w.length - 1;
  const tip = hover(hh, o, last, 640);
  assert.match(tip, new RegExp('주간 합계 · ' + w[last].days + '거래일'));
  INV.forEach((k) => assert.ok(tip.indexOf(IB.util.fmtEok(w[last][k], true)) > 0, '툴팁 금액 ' + k));
  assert.match(tip, /외국인/); assert.match(tip, /기관/); assert.match(tip, /개인/);
  const tip0 = hover(hh, o, 0, 640);
  assert.match(tip0, /일부 거래일만 합산/, '첫 구간(기간 시작에 걸림)은 일부 합산임을 밝힌다');
  const hd = makeHost(640), cd = IB.createChart(hd.host, { height: 250, panelHeight: 118 });
  const od = C.barsSpec(real.kospi, { period: 'm', agg: null, view: 'split', label: 'KOSPI', emptyText: '' });
  cd.update(od.spec);
  const d = expected.kospi.periods.m.agg.day, lt = hover(hd, od, 19, 640);
  assert.match(lt, new RegExp(d[19].start));
  INV.forEach((k) => assert.ok(lt.indexOf(IB.util.fmtEok(d[19][k], true)) > 0, '일별 툴팁 금액 ' + k));
}

// ── 8) 비교형(기존 묶음 막대)은 그대로: 한 장에 날짜마다 막대 3개, 0선·고정색 ──
{
  const hh = makeHost(640), ch = IB.createChart(hh.host, { height: 250, panelHeight: 118 });
  const o = C.barsSpec(real.kospi, { period: 'm', agg: null, view: 'compare', label: 'KOSPI', emptyText: '' });
  ch.update(o.spec);
  const html = hh.chartEl.innerHTML;
  assert.equal(count(html, /class="ibd-panel"/g), 0, '비교형은 패널로 나누지 않는다');
  assert.equal(count(html, /<svg /g), 1);
  const nz = o.spec.series.reduce((a, s) => a + s.values.filter((v) => v).length, 0);
  assert.equal(count(html, /class="ibd-bar"/g), nz);
  assert.equal(count(html, /class="ibd-zero"/g), 1);
  const colors = new Set(barsIn(html).map((b) => b.fill));
  assert.equal(JSON.stringify([...colors].sort()), JSON.stringify(C.INVESTORS.map((i) => i.color).sort()));
  assert.match(hh.legendEl.innerHTML, /data-ic-key="foreign"/);
  // 범례로 끄고 켜기는 분리형에서도 동작: 외국인을 끄면 패널도 2개
  const hs = makeHost(640), cs = IB.createChart(hs.host, { height: 250, panelHeight: 118 });
  cs.update(C.barsSpec(real.kospi, { period: 'm', agg: null, view: 'split', label: 'KOSPI', emptyText: '' }).spec);
  hs.legendEl.listeners.click({ target: { closest: () => ({ getAttribute: () => 'foreign' }) } });
  assert.equal(count(hs.chartEl.innerHTML, /class="ibd-panel"/g), 2);
}

// ── 9) 누적 선 + 지수 보조 축: 축 제목으로 단위를 구분, 시작점 0, 툴팁이 잘리지 않음 ──
{
  const hh = makeHost(640), ch = IB.createChart(hh.host, { height: 240 });
  const cum = C.cumulative(real.kospi, 20);
  assert.equal(cum.series.foreign[0], 0, '누적은 기간 시작 0');
  ch.update({
    type: 'lines', dates: cum.dates, series: C.INVESTORS.map((i) => ({ key: i.key, label: i.label, color: i.color, values: cum.series[i.key] })),
    fmt: IB.util.fmtEok, axisFmt: IB.util.fmtEokAxis, zero: true, axisTitles: { left: '누적 순매수(원)', right: 'KOSPI 지수(포인트)' },
    secondary: { label: 'KOSPI 지수', values: cum.index, fmt: (v) => String(v), axisFmt: (v) => String(v) }
  });
  const html = hh.chartEl.innerHTML;
  assert.match(html, /ibd-axis-title"[^>]*>누적 순매수\(원\)/);
  assert.match(html, /ibd-axis-title ibd-axis-sec" text-anchor="end" x="638"[^>]*>KOSPI 지수\(포인트\)/, '오른쪽 축 제목은 차트 안쪽 끝 정렬(잘리지 않음)');
  assert.equal(count(html, /class="ibd-secline"/g), 1);
  assert.match(hh.legendEl.innerHTML, /KOSPI 지수 \(오른쪽 축\)/);
  const t = hh.chartEl.querySelector('[data-ic-tip]'), hit = hh.chartEl.querySelectorAll('.ibd-hit')[0];
  hit.listeners.pointermove({ clientX: 636, clientY: 50 });
  assert.ok(parseFloat(t.style.left) + t.offsetWidth <= 640, '툴팁이 오른쪽 끝에서 잘리지 않는다');
  hit.listeners.pointermove({ clientX: 8, clientY: 50 });
  assert.ok(parseFloat(t.style.left) >= 2, '왼쪽 끝에서도 잘리지 않는다');
  hh.legendEl.listeners.click({ target: { closest: () => ({ getAttribute: () => 'foreign' }) } });
  assert.equal(count(hh.chartEl.innerHTML, /class="ibd-mline"/g), 2, '범례 클릭으로 선 숨김');
}

console.log('PASS: investor split charts - aggregation vs pandas (' + checkedBuckets + ' buckets), summaries, bar spec');
