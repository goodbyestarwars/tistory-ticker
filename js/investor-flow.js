/* 투자자별 순매수 추이 + 고객예탁금·신용잔고 흐름 (시장지표 > 국내 시장지표 02·03, 2026-10-12)
 *
 * InvestorFlow.mount(host)        - 02 투자자별 매매동향: 기간 누적 순매수 선(지수 겹쳐 보기 선택, 날짜별 툴팁에 당일·기간 누적), 하단 요약표,
 *                                   투자자별 규칙 기반 요약
 *                                   (2026-10-16: 일별·주간·월간 순매수 막대 그래프는 제거했다. 일별 수치는 누적 선 툴팁과 요약표에서 본다.)
 * InvestorFlow.mountBalance(host) - 03 증시자금: 고객예탁금·신용잔고 추이·5/20거래일 변화·20일 평균 대비·규칙 기반 해설
 * (처음엔 '04 국내 증시 자금 흐름'이라는 독립 구역이었으나, 02와 같은 순매수 데이터를 다뤄 02로 합쳤다.)
 *
 * 데이터
 *  - 투자자별: VM `GET /investor-trend/history?market=kospi|kosdaq&days=300` (KIS 시장별 투자자매매동향(일별) FHPTJ04040000이 SQLite에 쌓은 값,
 *    단위 억원, 거래일만, 날짜 오름차순). 외국인은 등록 외국인 순매수 기준이다. 이 원자료에는 **순매수만** 있어 총매수·총매도는 지원하지 않는다
 *    (순매수에서 거꾸로 계산하지 않는다).
 *  - 고객예탁금·신용잔고: 부모 모듈(js/domestic-market-indicators.js)이 이미 받은 `funds.series`를 그대로 넘겨 받는다(추가 요청 없음).
 * 표현 원칙: 투자자별 순매수는 시장 안에서 주체별 매매 우위를 보여 주는 자료이며 시장 전체의 신규 자금 유입액이 아니다. 요약은 정해진 계산 규칙의
 * 서술일 뿐 매수·매도 추천이나 점수·판정이 아니다.
 */
(function (global) {
  'use strict';

  var API = global.INVESTOR_FLOW_API_BASE || 'https://goodbyestar.cloud';
  var HISTORY_DAYS = 300;
  var TTL_MS = 5 * 60 * 1000;
  var PERIODS = [{ key: 'w', label: '1주', n: 5 }, { key: 'm', label: '1개월', n: 20 }, { key: 'q', label: '3개월', n: 60 }, { key: 'y', label: '1년', n: 250 }];
  var INVESTORS = [
    { key: 'foreign', label: '외국인', color: 'var(--mi-inv-foreign, #D94F45)' },
    { key: 'institution', label: '기관', color: 'var(--mi-inv-inst, #3273C8)' },
    { key: 'individual', label: '개인', color: 'var(--mi-inv-indiv, #168B70)' }
  ];
  var MARKETS = [{ key: 'kospi', label: 'KOSPI' }, { key: 'kosdaq', label: 'KOSDAQ' }];
  var TREND_PCT = 1.0;      // 20거래일 변화율이 이 값(%) 이상이면 증가 추세, 이하(음수)면 감소 추세, 안쪽이면 보합권
  var STREAK_MIN = 5;       // 문장에서 '연속'을 언급하는 최소 거래일 수

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ───────────── 계산(순수 함수, 테스트 대상) ───────────── */
  function fmtEok(v, signed) { return global.IndicatorBoard ? global.IndicatorBoard.util.fmtEok(v, signed) : String(v); }

  function lastRows(rows, n) { return rows.slice(Math.max(0, rows.length - n)); }

  function sumOf(rows, key) {
    var total = 0;
    rows.forEach(function (r) { total += Number(r[key]) || 0; });
    return total;
  }

  /* 기간 누적: 기간 직전 거래일을 시작점(0)으로 두고 그날부터 순매수를 더해 간다. 직전 거래일 자료가 없으면 '기간 시작'(0)을 앞에 둔다.
     같은 길이의 지수 종가(보조 축용)를 함께 만든다. */
  function cumulative(rows, n) {
    var take = lastRows(rows, n);
    var before = rows.length > take.length ? rows[rows.length - take.length - 1] : null;
    var dates = [before ? before.date : '기간 시작'];
    var index = [before && before.indexClose != null ? before.indexClose : null];
    var out = {}, daily = {};
    INVESTORS.forEach(function (inv) { out[inv.key] = [0]; daily[inv.key] = [null]; });   // 기준점(0)에는 '당일' 값이 없다
    take.forEach(function (r) {
      dates.push(r.date);
      index.push(r.indexClose != null ? r.indexClose : null);
      INVESTORS.forEach(function (inv) {
        var arr = out[inv.key], v = Number(r[inv.key]) || 0;
        arr.push(arr[arr.length - 1] + v);
        daily[inv.key].push(v);
      });
    });
    return { dates: dates, series: out, daily: daily, index: index, days: take.length, hasBaselineDate: !!before };
  }

  /* 끝에서부터 같은 부호가 이어진 거래일 수. sign: 1 순매수, -1 순매도, 0 값 없음 */
  function streak(rows, key) {
    var sign = 0, days = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      var v = Number(rows[i][key]) || 0;
      var s = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (i === rows.length - 1) { if (!s) break; sign = s; days = 1; continue; }
      if (s === sign) days++; else break;
    }
    return { sign: sign, days: days };
  }

  function pctChange(now, before) { return before ? (now - before) / Math.abs(before) * 100 : null; }

  /* 잔고형 시계열([[날짜, 값], ...] 오름차순)의 최근 5·20거래일 변화와 20거래일 평균 대비 */
  function balanceStats(points) {
    var n = points.length, out = { count: n, last: n ? points[n - 1][1] : null, lastDate: n ? points[n - 1][0] : null };
    function back(k) { return n > k ? points[n - 1 - k][1] : null; }
    var v5 = back(5), v20 = back(20);
    out.change5 = v5 != null ? out.last - v5 : null;
    out.pct5 = v5 != null ? pctChange(out.last, v5) : null;
    out.change20 = v20 != null ? out.last - v20 : null;
    out.pct20 = v20 != null ? pctChange(out.last, v20) : null;
    if (n >= 20) {
      var sum = 0; for (var i = n - 20; i < n; i++) sum += points[i][1];
      out.avg20 = sum / 20;
      out.vsAvg20Pct = pctChange(out.last, out.avg20);
    } else { out.avg20 = null; out.vsAvg20Pct = null; }
    out.trend = out.pct20 == null ? null : out.pct20 >= TREND_PCT ? 'up' : out.pct20 <= -TREND_PCT ? 'down' : 'flat';
    return out;
  }

  var TREND_TEXT = { up: '증가 추세', down: '감소 추세', flat: '보합권' };

  function balanceSeries(funds, field) {
    var out = [];
    ((funds && funds.series) || []).forEach(function (row) {
      var raw = field === 'credit' ? row.credit : row.market_funds;
      var picked = field === 'credit'
        ? (raw != null && typeof raw === 'object' ? raw.loan_total : raw)
        : (raw && raw.investor_deposits);
      var date = String(row.date || '').slice(0, 10);
      // null·빈 값은 0원이 아니라 '값 없음'이므로 건너뛴다(Number(null) === 0 이라 isFinite 만으로는 걸러지지 않는다).
      if (!date || picked == null || picked === '') return;
      var value = Number(picked);
      if (isFinite(value)) out.push([date, value]);
    });
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    return out;
  }

  function round1(x) { return Math.round(x * 10) / 10; }
  function mmdd(iso) { return String(iso).slice(5).replace('-', '.'); }

  /* 요약: 정해진 규칙으로만 만든다(추천·점수·판정 없음). 투자자 요약(02)과 잔고 요약(03)을 따로 만들고, summarize 는 둘을 이어 붙인 래퍼다. */
  function summarizeInvestors(rows, marketLabel) {
    var lines = [], sentences = [];
    var n20 = lastRows(rows, 20);
    if (n20.length >= 20) {
      var buyers = [], sellers = [];
      INVESTORS.forEach(function (inv) {
        var sum = sumOf(n20, inv.key);
        lines.push({ label: inv.label, text: '최근 20거래일 ' + (sum >= 0 ? '순매수 ' : '순매도 ') + fmtEok(Math.abs(sum)), tone: sum > 0 ? 'up' : sum < 0 ? 'down' : '', sum: sum });
        (sum >= 0 ? buyers : sellers).push(inv.label);
      });
      var parts = [];
      if (buyers.length) parts.push(buyers.join('·') + ' 순매수');
      if (sellers.length) parts.push(sellers.join('·') + ' 순매도');
      var s1 = marketLabel + ' 최근 20거래일 합계는 ' + parts.join(', ') + '입니다.';
      var best = null;
      INVESTORS.forEach(function (inv) { var st = streak(rows, inv.key); if (st.days >= STREAK_MIN && (!best || st.days > best.days)) best = { label: inv.label, days: st.days, sign: st.sign }; });
      if (best) s1 += ' ' + best.label + ' ' + best.days + '거래일 연속 ' + (best.sign > 0 ? '순매수' : '순매도') + ' 중입니다.';
      sentences.push(s1);
    } else {
      lines.push({ label: '투자자별', text: n20.length ? '확보된 거래일 ' + n20.length + '일(20일 미만)이라 요약하지 않습니다.' : '투자자별 자료가 없어 요약하지 않습니다.', tone: '' });
    }
    return { lines: lines, sentences: sentences };
  }

  function summarizeBalances(deposits, credit) {
    var lines = [], sentences = [];
    function balanceLine(label, st) {
      if (!st || st.pct20 == null) { lines.push({ label: label, text: '자료 부족(21거래일 미만)', tone: '' }); return; }
      lines.push({ label: label, text: TREND_TEXT[st.trend] + ' (20거래일 ' + (st.pct20 > 0 ? '+' : '') + st.pct20.toFixed(1) + '%)', tone: st.trend === 'up' ? 'up' : st.trend === 'down' ? 'down' : '' });
    }
    balanceLine('고객예탁금', deposits);
    balanceLine('신용잔고', credit);
    if (deposits && credit && deposits.trend && credit.trend) {
      var d = deposits.trend, c = credit.trend, s2;
      if (d === 'up' && c === 'up') s2 = '고객예탁금이 늘어 대기자금이 커지고 있고, 신용잔고도 함께 늘고 있어 레버리지 확대 여부를 살펴볼 필요가 있습니다.';
      else if (d === 'up' && c === 'flat') s2 = '고객예탁금은 늘고 있고 신용잔고는 보합권이라 대기자금은 커지지만 차입 투자 확대는 뚜렷하지 않습니다.';
      else if (d === 'up' && c === 'down') s2 = '고객예탁금은 늘고 신용잔고는 줄어 대기자금이 커지는 동안 차입 투자는 줄고 있습니다.';
      else if (d === 'flat' && c === 'up') s2 = '고객예탁금은 보합권인데 신용잔고는 늘어 차입 투자 비중이 커지는지 살펴볼 필요가 있습니다.';
      else if (d === 'flat' && c === 'flat') s2 = '고객예탁금과 신용잔고 모두 보합권입니다.';
      else if (d === 'flat' && c === 'down') s2 = '고객예탁금은 보합권이고 신용잔고는 줄어 차입 투자가 줄고 있습니다.';
      else if (d === 'down' && c === 'up') s2 = '고객예탁금은 줄었는데 신용잔고는 늘어, 대기자금은 줄고 차입 투자 비중은 커지는 모습입니다.';
      else if (d === 'down' && c === 'flat') s2 = '고객예탁금은 줄었고 신용잔고는 보합권이라 대기자금이 줄어드는 흐름입니다.';
      else s2 = '고객예탁금과 신용잔고가 모두 줄어 대기자금과 차입 투자가 함께 줄어드는 흐름입니다.';
      sentences.push(s2);
    }
    return { lines: lines, sentences: sentences };
  }

  function summarize(rows, deposits, credit, marketLabel) {
    var a = summarizeInvestors(rows, marketLabel), b = summarizeBalances(deposits, credit);
    return { lines: a.lines.concat(b.lines), sentences: a.sentences.concat(b.sentences) };
  }

  /* ───────────── 화면 ───────────── */
  var NOTE_NET = '투자자별 순매수는 시장 안에서 투자 주체별 매매 우위를 보여 주는 자료입니다. 한 주체가 순매수한 만큼 다른 주체가 순매도(상대방)하므로, 순매수 금액을 시장 전체의 신규 자금 유입액으로 읽으면 안 됩니다. 개인·외국인·기관 세 주체의 합이 0이 아닌 것은 기타법인 등 나머지 주체가 있기 때문입니다.';

  function kstStamp(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '-';
    return new Date(t + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
  }

  function periodOf(key) { return PERIODS.filter(function (x) { return x.key === key; })[0]; }
  function marketOf(key) { return MARKETS.filter(function (m) { return m.key === key; })[0]; }


  /* 누적 순매수 선 그래프 명세(IndicatorBoard.createChart 입력). 툴팁은 투자자마다 [당일 순매수 | 기간 누적]을 나란히 보이고,
     기준점(누적 0)에는 당일 값이 없어 '-'로 두며 제목에 '누적 시작점'이라고 밝힌다. 지수 겹쳐 보기를 켜면 지수가 오른쪽 축 점선과 툴팁 한 줄로 나온다. */
  function lineSpec(cum, label, showIndex) {
    var IB = global.IndicatorBoard;
    var hasIndex = showIndex && cum.index.some(function (v) { return v != null; });
    return {
      type: 'lines', dates: cum.dates,
      tipHeads: ['당일 순매수', '기간 누적'],
      meta: cum.dates.map(function (d, i) { return i === 0 ? { tip: (cum.hasBaselineDate ? mmdd(d) + ' · ' : '') + '누적 시작점(0)' } : null; }),
      series: INVESTORS.map(function (inv) { return { key: inv.key, label: inv.label, color: inv.color, values: cum.series[inv.key], tipExtra: { label: '당일 순매수', values: cum.daily[inv.key] } }; }),
      fmt: fmtEok, axisFmt: IB.util.fmtEokAxis, zero: true, ariaLabel: label + ' 투자자별 누적 순매수',
      axisTitles: hasIndex ? { left: '누적 순매수(원)', right: label + ' 지수(포인트)' } : { left: '누적 순매수(원)' },
      secondary: hasIndex ? { label: label + ' 지수', values: cum.index, fmt: function (v) { return IB.util.num(v, 2); }, axisFmt: function (v) { return IB.util.num(v, 0); } } : null
    };
  }

  /* 02 투자자별 매매동향 - 투자자별 순매수 추이(일별 막대 · 누적 선 · 실제 매수·매도 · 요약). 시장 전환·기간은 이 안의 모든 그래프·표가 같이 따른다. */
  function mount(host, options) {
    var opts = options || {};
    var IB = global.IndicatorBoard;
    var state = { market: 'kospi', period: 'm', showIndex: true, data: {}, error: null, loading: false };
    var charts = {};
    var timer = null;
    var api = opts.apiBase || API;

    function seg(name, items, current, attr) {
      return '<div class="ifl-seg" role="group" aria-label="' + name + '">' + items.map(function (it) {
        return '<button type="button" class="ui-btn ui-btn-tab ifl-seg-btn' + (it.key === current ? ' is-active active' : '') + '" ' + attr + '="' + it.key + '" aria-pressed="' + (it.key === current) + '">' + esc(it.label) + '</button>';
      }).join('') + '</div>';
    }

    host.innerHTML = '<div class="ibd ifl">'
      + '<div class="mi-sub-title">투자자별 순매수 추이</div>'
      + '<div class="mi-sub-cap">외국인·기관·개인의 순매수를 기간 누적 선으로 봅니다. 시장과 기간을 고르면 아래 그래프와 표가 모두 따라 바뀝니다. 그래프에 마우스를 올리면 그날의 당일 순매수와 기간 누적 순매수가 함께 나옵니다.</div>'
      + '<div class="ifl-controls">' + seg('시장', MARKETS, 'kospi', 'data-if-market') + seg('기간', PERIODS, 'm', 'data-if-period')
      + '<span class="ifl-asof nt-stamp" data-if-asof></span></div>'
      + '<div class="ifl-state" data-if-state role="status" hidden></div>'
      + '<section class="ifl-sec"><div class="ifl-sechead"><div class="mi-sub2-title">누적 순매수 추이</div>'
      + '<label class="ifl-check"><input type="checkbox" data-if-index checked /> 지수 겹쳐 보기(오른쪽 축)</label></div>'
      + '<div class="ifl-cap" data-if-linecap></div><div data-if-lines></div>'
      + '<table class="ifl-table" data-if-cumtable><caption class="ibd-sr">투자자별 기간 누적 순매수</caption><thead><tr><th>투자자</th><th class="num">기간 누적 순매수</th><th class="num">최근 1일</th><th class="num">연속 일수</th></tr></thead><tbody></tbody></table>'
      + '<div class="ifl-note">' + esc(NOTE_NET) + '</div><div class="ifl-note" data-if-basis></div></section>'
      + '<section class="ifl-sec ifl-summary"><div class="mi-sub2-title">투자자별 순매수 요약</div><div data-if-summary></div></section>'
      + '</div>';
    var root = host.querySelector('.ifl');
    function q(sel) { return root.querySelector(sel); }
    charts.lines = IB.createChart(q('[data-if-lines]'), { height: 240, emptyText: '선택한 기간의 자료가 없습니다.' });

    function rowsOf() { var d = state.data[state.market]; return d && d.rows ? d.rows : []; }

    function setButtons() {
      var rows = rowsOf();
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-market]'), function (b) {
        var on = b.getAttribute('data-if-market') === state.market;
        b.classList.toggle('is-active', on); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-period]'), function (b) {
        var p = periodOf(b.getAttribute('data-if-period'));
        var on = p.key === state.period, short = rows.length && rows.length < p.n;
        b.classList.toggle('is-active', on); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
        b.disabled = !!short;
        b.title = short ? '확보된 자료가 ' + rows.length + '거래일이라 선택할 수 없습니다' : (p.n + '거래일 기준');
      });
    }

    function renderAsOf() {
      var d = state.data[state.market], el = q('[data-if-asof]');
      if (!d) { el.textContent = ''; return; }
      el.textContent = ((window.NineTime && window.NineTime.asOf(d.latestDate)) || ('기준일 ' + (d.latestDate || '-'))) + ' · ' + ((window.NineTime && window.NineTime.updated(d.asOf)) || ('갱신 ' + kstStamp(d.asOf))) + ' · 자료 ' + d.count + '거래일(' + (d.from || '-') + ' ~ ' + (d.to || '-') + ')';
    }

    function renderState() {
      var el = q('[data-if-state]'), d = state.data[state.market], msgs = [];
      if (state.error && !d) msgs.push('투자자별 순매수 자료를 불러오지 못했습니다. 잠시 후 다시 시도합니다.');
      if (state.loading && !d) msgs.push('불러오는 중입니다.');
      if (d && d.provisional) msgs.push('오늘 값은 장중 누적 또는 마감 직후 잠정치이며 마감 후 일부 고쳐질 수 있습니다.');
      if (d && d.count < 20) msgs.push('확보된 자료가 ' + d.count + '거래일뿐이라 일부 기간은 선택할 수 없습니다.');
      el.hidden = !msgs.length; el.textContent = msgs.join(' ');
    }

    function renderLines() {
      var rows = rowsOf(), p = periodOf(state.period);
      var cum = cumulative(rows, p.n);
      var label = marketOf(state.market).label;
      q('[data-if-linecap]').textContent = '선택한 기간의 시작을 0으로 두고 거래일마다 순매수를 더한 값입니다. 기간을 바꾸면 그 기간 기준으로 다시 누적합니다. 마우스를 올리면 그날의 당일 순매수와 기간 누적 순매수를 함께 봅니다.' + (state.showIndex ? ' 진회색 점선은 ' + label + ' 지수입니다(오른쪽 축).' : '');
      if (!cum.days) { charts.lines.update({ type: 'lines', dates: [], series: [], emptyText: '선택한 기간의 자료가 없습니다.' }); renderCumTable(rows, cum, p); return; }
      charts.lines.update(lineSpec(cum, label, state.showIndex));
      renderCumTable(rows, cum, p);
    }

    function renderCumTable(rows, cum, p) {
      var body = q('[data-if-cumtable] tbody'), take = lastRows(rows, p.n), last = take.length ? take[take.length - 1] : null;
      body.innerHTML = INVESTORS.map(function (inv) {
        var arr = cum.series[inv.key], total = take.length ? arr[arr.length - 1] : null, st = streak(rows, inv.key);
        function cell(v, label) { return '<td class="num ' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '" data-label="' + label + '">' + (v == null ? '-' : esc(fmtEok(v, true))) + '</td>'; }
        return '<tr><th scope="row"><i class="ibd-swatch" style="background:' + inv.color + '"></i> ' + inv.label + '</th>' + cell(total, '기간 누적 순매수') + cell(last ? Number(last[inv.key]) : null, '최근 1일')
          + '<td class="num" data-label="연속 일수">' + (st.days ? st.days + '일 연속 ' + (st.sign > 0 ? '순매수' : '순매도') : '-') + '</td></tr>';
      }).join('');
    }

    function renderBasis() {
      var d = state.data[state.market];
      q('[data-if-basis]').textContent = d && d.foreignBasis ? '외국인은 ' + d.foreignBasis + ' 기준입니다. 이 자료에는 순매수만 있고 매수·매도 총액은 없습니다.' : '';
    }

    function renderSummary() {
      var label = marketOf(state.market).label, s = summarizeInvestors(rowsOf(), label);
      q('[data-if-summary]').innerHTML = '<ul class="ifl-lines">' + s.lines.map(function (l) {
        return '<li><span class="ifl-lk">' + esc(l.label) + '</span><span class="ifl-lv ' + (l.tone || '') + '">' + esc(l.text) + '</span></li>';
      }).join('') + '</ul>' + (s.sentences.length ? '<div class="ifl-sentence">' + s.sentences.map(esc).join(' ') + '</div>' : '')
        + '<div class="ifl-note">위 문장은 정해진 계산 규칙(최근 20거래일 순매수 합계의 부호)으로 만든 자료 요약이며 매수·매도 추천이 아닙니다. 요약은 선택한 시장(' + esc(label) + ') 기준입니다.</div>';
    }

    function renderAll() {
      setButtons(); renderAsOf(); renderState(); renderLines(); renderBasis(); renderSummary();
    }

    function load(market, force) {
      var hit = state.data[market];
      if (!force && hit && Date.now() - hit._at < TTL_MS) return Promise.resolve();
      state.loading = true; renderState();
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      return fetch(api + '/investor-trend/history?market=' + market + '&days=' + HISTORY_DAYS, controller ? { signal: controller.signal } : {})
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (json) {
          if (!json || json.success !== true || !json.data || !Array.isArray(json.data.rows)) throw new Error('bad payload');
          json.data._at = Date.now();
          state.data[market] = json.data; state.error = null;
        })
        .catch(function (e) { state.error = e; })
        .then(function () { if (timeout) clearTimeout(timeout); state.loading = false; renderAll(); });
    }

    root.addEventListener('click', function (event) {
      var t = event.target.closest ? event.target : null;
      if (!t) return;
      var mk = t.closest('[data-if-market]');
      if (mk) { state.market = mk.getAttribute('data-if-market'); renderAll(); load(state.market, false); return; }
      var pk = t.closest('[data-if-period]');
      if (pk && !pk.disabled) { state.period = pk.getAttribute('data-if-period'); renderAll(); return; }
    });
    q('[data-if-index]').addEventListener('change', function (e) { state.showIndex = !!e.target.checked; renderLines(); });

    renderAll();
    load('kospi', true).then(function () {
      // 기본 기간(1개월)이 확보된 자료보다 길면 가장 긴 선택 가능 기간으로 낮춘다.
      var rows = rowsOf(), cur = periodOf(state.period);
      if (rows.length && rows.length < cur.n) {
        var ok = PERIODS.filter(function (x) { return rows.length >= x.n; }).pop();
        if (ok) { state.period = ok.key; renderAll(); }
      }
    });
    timer = setInterval(function () { if (!document.hidden && document.body.contains(root) && root.offsetParent !== null) load(state.market, true); }, TTL_MS);

    return {
      update: function () { /* 투자자별 자료는 자체 API 를 쓰므로 부모가 넘기는 funds 는 쓰지 않는다 */ },
      redraw: function () { Object.keys(charts).forEach(function (k) { charts[k].redraw(); }); },
      destroy: function () { clearInterval(timer); Object.keys(charts).forEach(function (k) { charts[k].destroy(); }); }
    };
  }

  /* 03 증시자금 - 고객예탁금·신용잔고 흐름(최근 값 · 5·20거래일 변화 · 20일 평균 대비 · 규칙 기반 해설). 부모가 넘기는 funds.series 만 쓴다. */
  var BALANCE_CHART_DAYS = 60;

  function mountBalance(host, options) {
    var opts = options || {};
    var IB = global.IndicatorBoard;
    var state = { funds: opts.funds || null };
    host.innerHTML = '<div class="ibd ifl ifl-bal">'
      + '<div class="mi-sub-title">고객예탁금·신용잔고 흐름</div>'
      + '<div class="mi-sub-cap">두 값은 개념이 달라 합치지 않습니다. 고객예탁금 증가는 대기자금 확대, 신용잔고 증가는 차입 투자 확대를 보는 참고 지표입니다. 그래프는 최근 ' + BALANCE_CHART_DAYS + '거래일이며 점선은 20거래일 평균입니다.</div>'
      + '<div class="ifl-pair"><div><div class="ifl-minih">고객예탁금</div><div data-if-deposit></div></div><div><div class="ifl-minih">신용잔고</div><div data-if-credit></div></div></div>'
      + '<table class="ifl-table" data-if-baltable><caption class="ibd-sr">고객예탁금·신용잔고 변화</caption><thead><tr><th>지표</th><th class="num">최근 값</th><th class="num">5거래일 변화</th><th class="num">20거래일 변화</th><th class="num">20일 평균 대비</th></tr></thead><tbody></tbody></table>'
      + '<div class="ifl-note" data-if-balnote></div>'
      + '<div class="ifl-sec ifl-summary"><div class="mi-sub2-title">흐름 해설 (계산 규칙 기반)</div><div data-if-balsum></div></div>'
      + '</div>';
    var root = host.querySelector('.ifl');
    function q(sel) { return root.querySelector(sel); }
    var charts = {
      deposit: IB.createChart(q('[data-if-deposit]'), { height: 170, emptyText: '고객예탁금 자료가 없습니다.' }),
      credit: IB.createChart(q('[data-if-credit]'), { height: 170, emptyText: '신용잔고 자료가 없습니다.' })
    };

    function render() {
      var depositPts = balanceSeries(state.funds, 'deposits'), creditPts = balanceSeries(state.funds, 'credit');
      var deposits = balanceStats(depositPts), credit = balanceStats(creditPts);
      function chartSpec(points, label) {
        var take = points.slice(Math.max(0, points.length - BALANCE_CHART_DAYS));
        var st = balanceStats(points), ref = st.avg20 != null ? [{ value: st.avg20, label: '20일 평균' }] : [];
        return { type: 'lines', dates: take.map(function (x) { return x[0]; }), series: [{ key: label, label: label, color: 'var(--ibd-num)', values: take.map(function (x) { return x[1]; }) }],
          fmt: fmtEok, axisFmt: IB.util.fmtEokAxis, zero: false, refLines: ref, ariaLabel: label + ' 추이', emptyText: label + ' 자료가 없습니다.' };
      }
      charts.deposit.update(chartSpec(depositPts, '고객예탁금'));
      charts.credit.update(chartSpec(creditPts, '신용잔고'));
      function pctText(v) { return v == null ? '-' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
      function chg(change, pct) {
        if (change == null) return '<td class="num">-</td>';
        return '<td class="num ' + (change > 0 ? 'up' : change < 0 ? 'down' : '') + '">' + esc(fmtEok(change, true)) + '<small> (' + pctText(pct) + ')</small></td>';
      }
      function rowHtml(label, st) {
        return '<tr><th scope="row">' + label + '</th><td class="num">' + (st.last == null ? '-' : esc(fmtEok(st.last))) + '</td>' + chg(st.change5, st.pct5) + chg(st.change20, st.pct20)
          + '<td class="num ' + (st.vsAvg20Pct > 0 ? 'up' : st.vsAvg20Pct < 0 ? 'down' : '') + '">' + pctText(st.vsAvg20Pct) + '</td></tr>';
      }
      q('[data-if-baltable] tbody').innerHTML = rowHtml('고객예탁금', deposits) + rowHtml('신용잔고', credit);
      q('[data-if-balnote]').textContent = '변화율 ±' + TREND_PCT + '% 이내는 보합권으로 봅니다. 기준일 ' + (deposits.lastDate || '-') + ' · 자료 ' + deposits.count + '거래일(확보된 만큼만 계산).';
      var s = summarizeBalances(deposits, credit);
      q('[data-if-balsum]').innerHTML = '<ul class="ifl-lines">' + s.lines.map(function (l) {
        return '<li><span class="ifl-lk">' + esc(l.label) + '</span><span class="ifl-lv ' + (l.tone || '') + '">' + esc(l.text) + '</span></li>';
      }).join('') + '</ul>' + (s.sentences.length ? '<div class="ifl-sentence">' + s.sentences.map(esc).join(' ') + '</div>' : '')
        + '<div class="ifl-note">위 문장은 정해진 계산 규칙(고객예탁금·신용잔고 20거래일 변화율 ±' + TREND_PCT + '%)으로 만든 자료 요약이며 매수·매도 추천이 아닙니다.</div>';
    }
    render();

    return {
      update: function (funds) { state.funds = funds; render(); },
      redraw: function () { Object.keys(charts).forEach(function (k) { charts[k].redraw(); }); },
      destroy: function () { Object.keys(charts).forEach(function (k) { charts[k].destroy(); }); }
    };
  }

  global.InvestorFlow = {
    mount: mount,
    mountBalance: mountBalance,
    _calc: { cumulative: cumulative, streak: streak, balanceStats: balanceStats, balanceSeries: balanceSeries, summarize: summarize, summarizeInvestors: summarizeInvestors, summarizeBalances: summarizeBalances, lastRows: lastRows, sumOf: sumOf, PERIODS: PERIODS, TREND_PCT: TREND_PCT, INVESTORS: INVESTORS,
      mmdd: mmdd, lineSpec: lineSpec }
  };
})(window);
