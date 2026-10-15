// Run: node test/test_investor_flow_tooltip.js
// 국내시장지표 02 투자자별 순매수: 일별 막대 제거 후 누적 순매수 선 그래프의 날짜별 툴팁(당일|기간 누적|지수)을 검사한다.
// 기대값은 test/fixtures/investor/build_expected.py(pandas)가 운영 API 스냅샷(실제 수집 자료)에서 JS와 독립적으로 계산한 값이다.
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
const LABEL = { foreign: '외국인', institution: '기관', individual: '개인' };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.051, msg + ' (' + a + ' vs ' + b + ')');

// ── 1) 막대 그래프 코드가 남아 있지 않다 ──
const src = fs.readFileSync('js/investor-flow.js', 'utf8');
['data-if-bars', 'data-if-view', 'data-if-agg', 'barsSpec', 'ifl-viewctl', '분리형', '비교형', '일별 순매수·순매도', 'data-if-gross', '실제 매수·매도 금액', 'ifl-gross-table'].forEach((t) => assert.ok(src.indexOf(t) < 0, '제거된 막대 그래프 흔적: ' + t));
['aggregate', 'barsSpec', 'resolveAgg', 'periodSummary', 'outlierNote'].forEach((k) => assert.equal(C[k], undefined, '_calc.' + k + ' 제거'));
// 누적 선·지수 겹쳐 보기·기간 버튼·하단 표는 그대로 있다
['data-if-lines', 'data-if-index', 'data-if-cumtable', 'data-if-period', 'data-if-market', '지수 겹쳐 보기'].forEach((t) => assert.ok(src.indexOf(t) > 0, '유지: ' + t));
assert.equal(JSON.stringify(C.PERIODS.map((p) => p.key + ':' + p.n)), JSON.stringify(['w:5', 'm:20', 'q:60', 'y:250']));

// ── 2) 툴팁을 실제로 띄워 읽는 가짜 DOM ──
function makeHost(width) {
  const nodes = {};
  const node = (name) => (nodes[name] = nodes[name] || { hidden: true, style: {}, listeners: {}, innerHTML: '', offsetWidth: 262, offsetHeight: 118, addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, removeAttribute() {}, getBoundingClientRect() { return { left: 0, top: 0, width, height: 240 }; } });
  const chartEl = { style: {}, clientWidth: width, innerHTML: '', getBoundingClientRect() { return { left: 0, top: 0, width, height: 240 }; },
    querySelector(sel) { return sel === '[data-ic-tip]' ? node('tip') : sel === '.ibd-hit' ? node('hit') : sel === 'svg' ? node('svg') : sel === '[data-ic-cross]' ? node('cross') : node(sel); } };
  const legendEl = { hidden: false, innerHTML: '', addEventListener() {} };
  const root = { querySelector(sel) { return sel === '[data-ic-chart]' ? chartEl : sel === '[data-ic-legend]' ? legendEl : node(sel); } };
  return { host: { innerHTML: '', querySelector() { return root; } }, tip: node('tip'), hit: node('hit'), chartEl };
}
// 가짜 DOM은 클릭한 x 좌표를 날짜 칸으로 바꾸는 계산만 검증한다(선 그래프: 점 i 가 plotW*i/(n-1) 위치)
function hoverAt(h, spec, i, width) {
  const hasSec = !!(spec.secondary && spec.secondary.values.some((v) => v != null));
  const m = hasSec ? { l: 58, r: 62 } : { l: 6, r: 62 }, plotW = width - m.l - m.r;   // 차트 여백: 지수 겹침(보조 축)이 있으면 왼쪽 축 자리 58px
  const clientX = m.l + plotW * (i / (spec.dates.length - 1));
  h.hit.listeners.pointermove({ clientX, clientY: 60, pointerType: 'mouse' });
  return h.tip;
}
function parseTip(html) {
  const date = (/<b class="ibd-tip-date">([^<]*)<\/b>/.exec(html) || [])[1];
  const heads = [...html.matchAll(/<em>([^<]*)<\/em>/g)].map((m) => m[1]);
  const rows = [];
  const re = /<span class="ibd-tip-name"><i[^>]*><\/i>([^<]*)<\/span><b>([^<]*)<\/b><b>([^<]*)<\/b>/g;
  let m;
  while ((m = re.exec(html))) rows.push({ name: m[1], daily: m[2], cum: m[3] });
  const idx = /<i class="ibd-swatch ibd-swatch-line"><\/i><span>([^<]*)<\/span><b>([^<]*)<\/b>/.exec(html);
  return { date, heads, rows, index: idx ? { label: idx[1], value: idx[2] } : null };
}

// ── 3) 실제 수집 자료: 모든 시장·기간·날짜의 툴팁 수치가 pandas 기대값과 같다 ──
let checkedTips = 0;
['kospi', 'kosdaq'].forEach((market) => {
  const rows = real[market];
  assert.equal(rows.length, expected[market].rows);
  Object.keys(PERIOD_N).forEach((pk) => {
    const e = expected[market].periods[pk], cum = C.cumulative(rows, PERIOD_N[pk]), tag = market + ' ' + pk;
    // 누적 계산 자체가 기대값과 같다(기존 계산 로직 재사용 확인)
    assert.equal(JSON.stringify(cum.dates), JSON.stringify(e.dates), tag + ' 날짜');
    assert.equal(cum.days, e.days, tag + ' 거래일 수');
    INV.forEach((k) => {
      assert.equal(cum.series[k].length, e.cum[k].length, tag + ' ' + k + ' 길이');
      cum.series[k].forEach((v, i) => near(v, e.cum[k][i], tag + ' ' + k + ' 누적 ' + i));
      assert.equal(cum.daily[k][0], null, tag + ' 기준점 당일 값 없음');
      cum.daily[k].slice(1).forEach((v, i) => near(v, e.daily[k][i + 1], tag + ' ' + k + ' 당일 ' + i));
      // 누적의 끝 = 기간 합계 = 하단 요약표의 기간 누적
      near(cum.series[k][cum.series[k].length - 1], e.period[k], tag + ' ' + k + ' 기간 합계');
    });
    // 하단 요약표(최근 1일·연속 일수)는 계산이 그대로다
    INV.forEach((k) => {
      const st = C.streak(rows, k);
      assert.equal(st.days, e.streak[k].days, tag + ' ' + k + ' 연속 일수');
      assert.equal(st.sign, e.streak[k].sign, tag + ' ' + k + ' 연속 방향');
      near(Number(rows[rows.length - 1][k]), e.last[k], tag + ' ' + k + ' 최근 1일');
    });
    // 툴팁: 모든 날짜
    [true, false].forEach((showIndex) => {
      const spec = C.lineSpec(cum, market === 'kospi' ? 'KOSPI' : 'KOSDAQ', showIndex);
      const h = makeHost(640);
      IB.createChart(h.host, { height: 240 }).update(spec);
      spec.dates.forEach((d, i) => {
        const tip = hoverAt(h, spec, i, 640), p = parseTip(tip.innerHTML);
        assert.equal(tip.hidden, false);
        assert.equal(JSON.stringify(p.heads), JSON.stringify(['당일 순매수', '기간 누적']), '머리글: 당일과 누적을 구분');
        assert.equal(JSON.stringify(p.rows.map((r) => r.name)), JSON.stringify(INV.map((k) => LABEL[k])));
        if (i === 0) {
          assert.match(p.date, /누적 시작점\(0\)/, tag + ' 기준점 제목');
          p.rows.forEach((r) => { assert.equal(r.daily, '-'); assert.equal(r.cum, '0억'); });
        } else {
          assert.equal(p.date.indexOf('누적 시작점'), -1);
          INV.forEach((k, j) => {
            // 화면에 찍힌 글자 = 표시 값의 포맷이고, 그 값은 위 2)에서 pandas 기대값과 0.05억 안에서 같음을 이미 확인했다
            // (소수 둘째 자리 부동소수 오차로 반올림 경계 -389.5가 갈릴 수 있어 글자는 JS 값으로 만들고 숫자는 기대값과 따로 비교한다).
            assert.equal(p.rows[j].daily, IB.util.fmtEok(cum.daily[k][i], true), [tag, d, k, '당일'].join(' '));
            assert.equal(p.rows[j].cum, IB.util.fmtEok(cum.series[k][i], true), [tag, d, k, '누적'].join(' '));
            near(cum.daily[k][i], e.daily[k][i], [tag, d, k, '툴팁 당일 숫자'].join(' '));
            near(cum.series[k][i], e.cum[k][i], [tag, d, k, '툴팁 누적 숫자'].join(' '));
          });
        }
        if (showIndex && e.index[i] != null) {
          assert.ok(p.index, tag + ' 지수 줄');
          assert.equal(p.index.label, (market === 'kospi' ? 'KOSPI' : 'KOSDAQ') + ' 지수');
          assert.equal(p.index.value, IB.util.num(e.index[i], 2));
        } else if (!showIndex) {
          assert.equal(p.index, null, '지수 겹침을 끄면 툴팁에도 지수가 없다');
        }
        checkedTips++;
      });
    });
  });
});

// ── 4) 툴팁 위치: 좌우 가장자리·좁은 화면에서도 차트 밖으로 나가지 않는다 ──
[640, 340].forEach((width) => {
  const cum = C.cumulative(real.kospi, 20), spec = C.lineSpec(cum, 'KOSPI', true);
  const h = makeHost(width);
  IB.createChart(h.host, { height: 240 }).update(spec);
  [0, 1, 10, spec.dates.length - 2, spec.dates.length - 1].forEach((i) => {
    const tip = hoverAt(h, spec, i, width), left = parseFloat(tip.style.left), top = parseFloat(tip.style.top);
    assert.ok(left >= 2 && left + tip.offsetWidth <= width - 2 + 0.01, width + 'px 폭, 점 ' + i + ': 툴팁이 가로로 잘리지 않음 (left ' + left + ')');
    assert.ok(top >= 2, '툴팁이 위로 잘리지 않음');
  });
});

// ── 5) 범례로 투자자를 끄면 툴팁에서도 빠진다(보이지 않는 선의 수치를 보이지 않는다) ──
{
  const cum = C.cumulative(real.kospi, 20), spec = C.lineSpec(cum, 'KOSPI', false);
  const h = makeHost(640);
  const legendClicks = { handler: null };
  h.host.querySelector = () => ({ querySelector(sel) { return sel === '[data-ic-chart]' ? h.chartEl : sel === '[data-ic-legend]' ? { hidden: false, innerHTML: '', addEventListener(t, f) { legendClicks.handler = f; } } : h.chartEl.querySelector(sel); } });
  const chart = IB.createChart(h.host, { height: 240 });
  chart.update(spec);
  legendClicks.handler({ target: { closest: () => ({ getAttribute: () => 'individual' }) } });
  const p = parseTip(hoverAt(h, spec, 5, 640).innerHTML);
  assert.equal(JSON.stringify(p.rows.map((r) => r.name)), JSON.stringify(['외국인', '기관']));
}

// ── 6) 막대 차트 등 다른 화면의 기존 툴팁 형식은 그대로다(tipExtra 가 없으면 예전 한 열 형식) ──
{
  const h = makeHost(640);
  const spec = { type: 'lines', dates: ['2026-10-01', '2026-10-02', '2026-10-05'], series: [{ key: 'x', label: 'X', color: '#111', values: [1, 2, 3] }], fmt: IB.util.fmtEok, zero: false };
  IB.createChart(h.host, { height: 240 }).update(spec);
  const html = hoverAt(h, spec, 1, 640).innerHTML;
  assert.ok(html.indexOf('ibd-tip-grid') < 0);
  assert.match(html, /<div class="ibd-tip-row">.*X.*<b>\+2억<\/b>/);
}

console.log('PASS: investor flow tooltip (' + checkedTips + ' tooltips checked against pandas expectations, bars removed, position clamped)');
