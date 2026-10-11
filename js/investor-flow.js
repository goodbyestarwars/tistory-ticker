/* 투자자별 순매수 추이 + 고객예탁금·신용잔고 흐름 (시장지표 > 국내 시장지표 02·03, 2026-10-12)
 *
 * InvestorFlow.mount(host)        - 02 투자자별 매매동향: 외국인·기관·개인 순매수·순매도 막대(분리형 = 투자자별 3개 패널 / 비교형 = 날짜별 3막대,
 *                                   일별·주간 합계·월간 합계), 기간 누적 순매수 선(지수 겹쳐 보기 선택), 총매수·총매도 원자료 지원 여부, 투자자별 규칙 기반 요약
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
    var out = {};
    INVESTORS.forEach(function (inv) { out[inv.key] = [0]; });
    take.forEach(function (r) {
      dates.push(r.date);
      index.push(r.indexClose != null ? r.indexClose : null);
      INVESTORS.forEach(function (inv) {
        var arr = out[inv.key];
        arr.push(arr[arr.length - 1] + (Number(r[inv.key]) || 0));
      });
    });
    return { dates: dates, series: out, index: index, days: take.length, hasBaselineDate: !!before };
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

  /* ── 막대 그래프 보기(분리형·비교형)와 집계(일별·주간·월간) ──────────────────────────────────────────────────────────
     집계는 실제 거래일 데이터를 구간(주 = 월요일 시작, 월 = 달력 월)별로 모두 더한 '합계'이며 일별 평균이 아니다.
     선택한 기간(최근 N거래일) 안의 거래일만 더하므로 첫 구간은 기간 시작에 걸쳐 일부 거래일만 합산될 수 있다(partial). */
  var VIEWS = [{ key: 'split', label: '분리형' }, { key: 'compare', label: '비교형' }];
  var AGGS = [{ key: 'day', label: '일별' }, { key: 'week', label: '주간' }, { key: 'month', label: '월간' }];
  var DEFAULT_AGG = { w: 'day', m: 'day', q: 'week', y: 'month' };   // 기간별 기본 집계: 1주·1개월 일별, 3개월 주간, 1년 월간

  function bucketKeyOf(date, mode) {
    var U = global.IndicatorBoard.util;
    return mode === 'week' ? U.weekKeyOf(date) : mode === 'month' ? U.monthKeyOf(date) : date;
  }
  function round1(x) { return Math.round(x * 10) / 10; }
  function mmdd(iso) { return String(iso).slice(5).replace('-', '.'); }

  function aggregate(rows, mode, prevRow) {
    var out = [];
    rows.forEach(function (r) {
      var key = bucketKeyOf(r.date, mode), b = out.length ? out[out.length - 1] : null;
      if (!b || b.key !== key) {
        b = { key: key, start: r.date, end: r.date, days: 0, sums: {}, partial: false };
        INVESTORS.forEach(function (inv) { b.sums[inv.key] = 0; });
        out.push(b);
      }
      b.end = r.date; b.days++;
      INVESTORS.forEach(function (inv) { b.sums[inv.key] += Number(r[inv.key]) || 0; });
    });
    out.forEach(function (b) { INVESTORS.forEach(function (inv) { b.sums[inv.key] = round1(b.sums[inv.key]); }); });
    if (out.length && prevRow && mode !== 'day' && bucketKeyOf(prevRow.date, mode) === out[0].key) out[0].partial = true;
    return out;
  }

  function bucketMeta(b, mode) {
    if (mode === 'week') {
      return { start: b.start, label: mmdd(b.start), tip: (b.start === b.end ? mmdd(b.start) : mmdd(b.start) + ' ~ ' + mmdd(b.end)) + ' · 주간 합계 · ' + b.days + '거래일' + (b.partial ? ' (선택 기간 시작 구간, 일부 거래일만 합산)' : '') };
    }
    if (mode === 'month') {
      return { start: b.start, label: b.start.slice(2, 4) + '.' + b.start.slice(5, 7), tip: b.start.slice(0, 7) + ' · 월간 합계 · ' + b.days + '거래일' + (b.partial ? ' (선택 기간 시작 구간, 일부 거래일만 합산)' : '') };
    }
    return null;
  }

  function defaultAgg(periodKey) { return DEFAULT_AGG[periodKey] || 'day'; }

  /* 분리형 패널 머리의 요약 수치: 최근 순매수 / 5거래일 합계 / 선택 기간 합계(계산에 쓴 거래일 수를 함께 적는다) */
  function periodSummary(windowRows, key) {
    var n = windowRows.length;
    if (!n) return [];
    var last = windowRows[n - 1], v = Number(last[key]) || 0, k5 = Math.min(5, n);
    var s5 = round1(sumOf(windowRows.slice(n - k5), key)), sAll = round1(sumOf(windowRows, key));
    // 요약 수치는 +/- 부호로만 방향을 나타낸다(투자자 고유색과 상승·하락 의미색이 한 패널 안에서 섞이지 않게 중립 색)
    return [
      { label: '최근 순매수', text: fmtEok(v, true), sub: mmdd(last.date) },
      { label: k5 === 5 ? '5거래일 합계' : k5 + '거래일 합계(5일 미만)', text: fmtEok(s5, true) },
      { label: '선택 기간 합계', text: fmtEok(sAll, true), sub: n + '거래일' }
    ];
  }

  /* 극단값 점검: 한 막대가 나머지보다 훨씬 커서 다른 막대가 작게 보이는 경우를 알린다(축은 실제 금액 그대로, 자르지 않는다). */
  function outlierNote(items) {
    var mags = items.map(function (i) { return Math.abs(i.value); }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    if (mags.length < 8) return '';
    var med = mags[Math.floor(mags.length / 2)], top = items[0];
    items.forEach(function (i) { if (Math.abs(i.value) > Math.abs(top.value)) top = i; });
    var ratio = Math.abs(top.value) / med;
    if (!(ratio > 5)) return '';
    return '가장 큰 막대는 ' + top.tip + ' ' + top.label + ' ' + fmtEok(top.value, true) + '이며 막대 크기 중앙값(' + fmtEok(med) + ')의 약 ' + Math.round(ratio) + '배라 다른 막대가 작게 보입니다. 축은 실제 금액 그대로이며 잘라내지 않았습니다.';
  }

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

  /* 선택한 집계(없으면 기간 기본값). 선택한 기간이 구간 2개 미만으로 묶이면 그 집계는 의미가 없어 일별로 둔다. */
  function resolveAgg(rows, periodKey, agg) {
    var take = lastRows(rows, periodOf(periodKey).n), m = agg || defaultAgg(periodKey);
    return m !== 'day' && aggregate(take, m, null).length < 2 ? 'day' : m;
  }

  /* 막대 그래프 한 장의 명세(IndicatorBoard.createChart 입력)와 제목·설명. o = { period, agg, view, label, emptyText } */
  function barsSpec(rows, o) {
    var IBu = global.IndicatorBoard.util, take = lastRows(rows, periodOf(o.period).n);
    var prev = rows.length > take.length ? rows[rows.length - take.length - 1] : null;
    var mode = resolveAgg(rows, o.period, o.agg), buckets = aggregate(take, mode, prev), split = o.view !== 'compare';
    var unit = mode === 'week' ? '주간 합계' : mode === 'month' ? '월간 합계' : '일별';
    var cap = mode === 'day'
      ? '그날 시장에서 사고판 금액의 차이입니다. 순매수는 0선 위, 순매도는 0선 아래이며 거래일만 표시합니다.'
      : (mode === 'week' ? '같은 주(월~금)의 거래일 순매수를 모두 더한 ' : '같은 달의 거래일 순매수를 모두 더한 ') + unit + '입니다(일별 평균이 아님). 순매수는 0선 위, 순매도는 0선 아래이며, 첫 구간은 선택한 기간에 걸린 일부 거래일만 합산될 수 있어 막대를 누르면 거래일 수가 나옵니다.';
    var items = [];
    var series = !buckets.length ? [] : INVESTORS.map(function (inv) {
      var values = buckets.map(function (bk) { return bk.sums[inv.key]; });
      buckets.forEach(function (bk, i) { items.push({ label: inv.label, tip: mode === 'day' ? bk.start : bucketMeta(bk, mode).tip.split(' · ')[0], value: values[i] }); });
      return { key: inv.key, label: inv.label, color: inv.color, values: values, summary: split ? periodSummary(take, inv.key) : undefined };
    });
    return {
      mode: mode, buckets: buckets, split: split,
      title: mode === 'day' ? '일별 순매수·순매도' : unit + ' 순매수·순매도',
      caption: cap + (split ? ' 세 그래프는 같은 날짜 위치와 같은 금액 눈금을 씁니다.' : ''),
      spec: {
        type: 'bars', layout: split ? 'stacked' : 'grouped',
        dates: buckets.map(function (bk) { return bk.start; }),
        meta: mode === 'day' ? null : buckets.map(function (bk) { return bucketMeta(bk, mode); }),
        guides: mode === 'month' ? { weeks: false, months: false, years: true } : mode === 'week' ? { weeks: false, months: true } : undefined,
        series: series, fmt: IBu.fmtEok, axisFmt: IBu.fmtEokAxis, zero: true,
        ariaLabel: o.label + ' 투자자별 ' + unit + ' 순매수', emptyText: o.emptyText, note: outlierNote(items)
      }
    };
  }
  function investorOf(key) { return INVESTORS.filter(function (i) { return i.key === key; })[0]; }

  /* 02 투자자별 매매동향 - 투자자별 순매수 추이(일별 막대 · 누적 선 · 실제 매수·매도 · 요약). 시장 전환·기간은 이 안의 모든 그래프·표가 같이 따른다. */
  function mount(host, options) {
    var opts = options || {};
    var IB = global.IndicatorBoard;
    var state = { market: 'kospi', period: 'm', gross: 'foreign', showIndex: true, view: 'split', agg: null, data: {}, error: null, loading: false };
    var charts = {};
    var timer = null;
    var api = opts.apiBase || API;

    function seg(name, items, current, attr) {
      return '<div class="ifl-seg" role="group" aria-label="' + name + '">' + items.map(function (it) {
        return '<button type="button" class="ifl-seg-btn' + (it.key === current ? ' is-active' : '') + '" ' + attr + '="' + it.key + '" aria-pressed="' + (it.key === current) + '">' + esc(it.label) + '</button>';
      }).join('') + '</div>';
    }

    host.innerHTML = '<div class="ibd ifl">'
      + '<div class="mi-sub-title">투자자별 순매수 추이</div>'
      + '<div class="mi-sub-cap">외국인·기관·개인의 순매수·순매도를 그래프로 봅니다. 시장과 기간을 고르면 아래 그래프와 표가 모두 따라 바뀝니다.</div>'
      + '<div class="ifl-controls">' + seg('시장', MARKETS, 'kospi', 'data-if-market') + seg('기간', PERIODS, 'm', 'data-if-period')
      + '<span class="ifl-asof" data-if-asof></span></div>'
      + '<div class="ifl-state" data-if-state role="status" hidden></div>'
      + '<section class="ifl-sec"><div class="ifl-sechead"><div class="mi-sub2-title" data-if-barstitle>일별 순매수·순매도</div>'
      + '<div class="ifl-viewctl">' + seg('보기', VIEWS, 'split', 'data-if-view') + seg('집계', AGGS, 'day', 'data-if-agg') + '</div></div>'
      + '<div class="ifl-cap" data-if-barscap></div><div data-if-bars></div></section>'
      + '<section class="ifl-sec"><div class="ifl-sechead"><div class="mi-sub2-title">누적 순매수 추이</div>'
      + '<label class="ifl-check"><input type="checkbox" data-if-index checked /> 지수 겹쳐 보기(오른쪽 축)</label></div>'
      + '<div class="ifl-cap" data-if-linecap></div><div data-if-lines></div>'
      + '<table class="ifl-table" data-if-cumtable><caption class="ibd-sr">투자자별 기간 누적 순매수</caption><thead><tr><th>투자자</th><th class="num">기간 누적 순매수</th><th class="num">최근 1일</th><th class="num">연속 일수</th></tr></thead><tbody></tbody></table>'
      + '<div class="ifl-note">' + esc(NOTE_NET) + '</div></section>'
      + '<section class="ifl-sec"><div class="mi-sub2-title">실제 매수·매도 금액</div><div data-if-gross></div></section>'
      + '<section class="ifl-sec ifl-summary"><div class="mi-sub2-title">투자자별 순매수 요약</div><div data-if-summary></div></section>'
      + '</div>';
    var root = host.querySelector('.ifl');
    function q(sel) { return root.querySelector(sel); }
    charts.bars = IB.createChart(q('[data-if-bars]'), { height: 250, panelHeight: 118, emptyText: '선택한 기간의 자료가 없습니다.' });
    charts.lines = IB.createChart(q('[data-if-lines]'), { height: 240, emptyText: '선택한 기간의 자료가 없습니다.' });

    function rowsOf() { var d = state.data[state.market]; return d && d.rows ? d.rows : []; }

    function setButtons() {
      var rows = rowsOf();
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-market]'), function (b) {
        var on = b.getAttribute('data-if-market') === state.market;
        b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-period]'), function (b) {
        var p = periodOf(b.getAttribute('data-if-period'));
        var on = p.key === state.period, short = rows.length && rows.length < p.n;
        b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
        b.disabled = !!short;
        b.title = short ? '확보된 자료가 ' + rows.length + '거래일이라 선택할 수 없습니다' : (p.n + '거래일 기준');
      });
    }

    // 선택한 기간의 거래일을 집계 구간으로 묶었을 때 구간이 몇 개인가(2개 미만이면 그 집계는 의미가 없어 비활성)
    function bucketCount(mode) {
      return aggregate(lastRows(rowsOf(), periodOf(state.period).n), mode, null).length;
    }
    function aggMode() { return resolveAgg(rowsOf(), state.period, state.agg); }
    function setViewButtons() {
      var mode = aggMode();
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-view]'), function (b) {
        var on = b.getAttribute('data-if-view') === state.view;
        b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-agg]'), function (b) {
        var key = b.getAttribute('data-if-agg'), on = key === mode, few = key !== 'day' && rowsOf().length && bucketCount(key) < 2;
        b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
        b.disabled = !!few;
        b.title = few ? '선택한 기간이 짧아 ' + (key === 'week' ? '주간' : '월간') + ' 구간이 1개뿐입니다' : '';
      });
    }

    function renderAsOf() {
      var d = state.data[state.market], el = q('[data-if-asof]');
      if (!d) { el.textContent = ''; return; }
      el.textContent = '기준일 ' + (d.latestDate || '-') + ' · 갱신 ' + kstStamp(d.asOf) + ' · 자료 ' + d.count + '거래일(' + (d.from || '-') + ' ~ ' + (d.to || '-') + ')';
    }

    function renderState() {
      var el = q('[data-if-state]'), d = state.data[state.market], msgs = [];
      if (state.error && !d) msgs.push('투자자별 순매수 자료를 불러오지 못했습니다. 잠시 후 다시 시도합니다.');
      if (state.loading && !d) msgs.push('불러오는 중입니다.');
      if (d && d.provisional) msgs.push('오늘 값은 장중 누적 또는 마감 직후 잠정치이며 마감 후 일부 고쳐질 수 있습니다.');
      if (d && d.count < 20) msgs.push('확보된 자료가 ' + d.count + '거래일뿐이라 일부 기간은 선택할 수 없습니다.');
      el.hidden = !msgs.length; el.textContent = msgs.join(' ');
    }

    function renderBars() {
      var rows = rowsOf();
      var barsEmpty = rows.length ? '선택한 기간의 자료가 없습니다.' : state.data[state.market] ? '확보된 자료가 없습니다.' : state.error ? '자료를 불러오지 못했습니다.' : '불러오는 중입니다.';
      var out = barsSpec(rows, { period: state.period, agg: state.agg, view: state.view, label: marketOf(state.market).label, emptyText: barsEmpty });
      q('[data-if-barstitle]').textContent = out.title;
      q('[data-if-barscap]').textContent = out.caption;
      charts.bars.update(out.spec);
    }

    function renderLines() {
      var rows = rowsOf(), p = periodOf(state.period);
      var cum = cumulative(rows, p.n);
      var label = marketOf(state.market).label;
      q('[data-if-linecap]').textContent = '선택한 기간의 시작을 0으로 두고 거래일마다 순매수를 더한 값입니다. 기간을 바꾸면 그 기간 기준으로 다시 누적합니다.' + (state.showIndex ? ' 진회색 점선은 ' + label + ' 지수입니다(오른쪽 축).' : '');
      if (!cum.days) { charts.lines.update({ type: 'lines', dates: [], series: [], emptyText: '선택한 기간의 자료가 없습니다.' }); renderCumTable(rows, cum, p); return; }
      var hasIndex = state.showIndex && cum.index.some(function (v) { return v != null; });
      charts.lines.update({
        type: 'lines', dates: cum.dates,
        series: INVESTORS.map(function (inv) { return { key: inv.key, label: inv.label, color: inv.color, values: cum.series[inv.key] }; }),
        fmt: fmtEok, axisFmt: IB.util.fmtEokAxis, zero: true, ariaLabel: label + ' 투자자별 누적 순매수',
        axisTitles: hasIndex ? { left: '누적 순매수(원)', right: label + ' 지수(포인트)' } : { left: '누적 순매수(원)' },
        secondary: hasIndex ? { label: label + ' 지수', values: cum.index, fmt: function (v) { return IB.util.num(v, 2); }, axisFmt: function (v) { return IB.util.num(v, 0); } } : null
      });
      renderCumTable(rows, cum, p);
    }

    function renderCumTable(rows, cum, p) {
      var body = q('[data-if-cumtable] tbody'), take = lastRows(rows, p.n), last = take.length ? take[take.length - 1] : null;
      body.innerHTML = INVESTORS.map(function (inv) {
        var arr = cum.series[inv.key], total = take.length ? arr[arr.length - 1] : null, st = streak(rows, inv.key);
        function cell(v) { return '<td class="num ' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + (v == null ? '-' : esc(fmtEok(v, true))) + '</td>'; }
        return '<tr><th scope="row"><i class="ibd-swatch" style="background:' + inv.color + '"></i> ' + inv.label + '</th>' + cell(total) + cell(last ? Number(last[inv.key]) : null)
          + '<td class="num">' + (st.days ? st.days + '일 연속 ' + (st.sign > 0 ? '순매수' : '순매도') : '-') + '</td></tr>';
      }).join('');
    }

    function renderGross() {
      var d = state.data[state.market], rows = rowsOf(), p = periodOf(state.period);
      var inv = investorOf(state.gross), take = lastRows(rows, p.n), net = take.length ? sumOf(take, inv.key) : null;
      var reason = d && d.gross && d.gross.reason ? d.gross.reason : '이 데이터 소스는 순매수만 제공합니다.';
      var na = '<td class="ifl-na">매수·매도 총액 원자료 미지원</td>';
      q('[data-if-gross]').innerHTML = '<div class="ifl-seg ifl-seg-inv" role="group" aria-label="투자자">' + INVESTORS.map(function (i) {
        var on = i.key === state.gross;
        return '<button type="button" class="ifl-seg-btn' + (on ? ' is-active' : '') + '" data-if-gross-inv="' + i.key + '" aria-pressed="' + on + '" style="--ifl-inv:' + i.color + '">'
          + '<i class="ibd-swatch" style="background:' + i.color + '"></i>' + i.label + '</button>';
      }).join('') + '</div>'
        + '<table class="ifl-table ifl-gross-table"><tbody>'
        + '<tr><th scope="row">총매수금액</th>' + na + '</tr><tr><th scope="row">총매도금액</th>' + na + '</tr>'
        + '<tr><th scope="row">순매수금액 <small>(' + esc(p.label) + ' 합계)</small></th><td class="num ' + (net > 0 ? 'up' : net < 0 ? 'down' : '') + '">' + (net == null ? '-' : esc(fmtEok(net, true))) + '</td></tr>'
        + '<tr><th scope="row">매수·매도 차이</th>' + na + '</tr></tbody></table>'
        + '<div class="ifl-note">' + esc(reason) + (d && d.foreignBasis ? ' 외국인은 ' + esc(d.foreignBasis) + ' 기준입니다.' : '') + '</div>';
    }

    function renderSummary() {
      var label = marketOf(state.market).label, s = summarizeInvestors(rowsOf(), label);
      q('[data-if-summary]').innerHTML = '<ul class="ifl-lines">' + s.lines.map(function (l) {
        return '<li><span class="ifl-lk">' + esc(l.label) + '</span><span class="ifl-lv ' + (l.tone || '') + '">' + esc(l.text) + '</span></li>';
      }).join('') + '</ul>' + (s.sentences.length ? '<div class="ifl-sentence">' + s.sentences.map(esc).join(' ') + '</div>' : '')
        + '<div class="ifl-note">위 문장은 정해진 계산 규칙(최근 20거래일 순매수 합계의 부호)으로 만든 자료 요약이며 매수·매도 추천이 아닙니다. 요약은 선택한 시장(' + esc(label) + ') 기준입니다.</div>';
    }

    function renderAll() {
      setButtons(); renderBars(); setViewButtons(); renderAsOf(); renderState(); renderLines(); renderGross(); renderSummary();
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
      if (pk && !pk.disabled) { state.period = pk.getAttribute('data-if-period'); state.agg = null; renderAll(); return; }   // 기간을 바꾸면 집계는 그 기간의 기본값(1주·1개월 일별, 3개월 주간, 1년 월간)으로
      var vk = t.closest('[data-if-view]');
      if (vk) { state.view = vk.getAttribute('data-if-view'); renderBars(); setViewButtons(); return; }
      var ak = t.closest('[data-if-agg]');
      if (ak && !ak.disabled) { state.agg = ak.getAttribute('data-if-agg'); renderBars(); setViewButtons(); return; }
      var gk = t.closest('[data-if-gross-inv]');
      if (gk) { state.gross = gk.getAttribute('data-if-gross-inv'); renderGross(); }
    });
    q('[data-if-index]').addEventListener('change', function (e) { state.showIndex = !!e.target.checked; renderLines(); });

    renderAll();
    load('kospi', true).then(function () {
      // 기본 기간(1개월)이 확보된 자료보다 길면 가장 긴 선택 가능 기간으로 낮춘다.
      var rows = rowsOf(), cur = periodOf(state.period);
      if (rows.length && rows.length < cur.n) {
        var ok = PERIODS.filter(function (x) { return rows.length >= x.n; }).pop();
        if (ok) { state.period = ok.key; state.agg = null; renderAll(); }
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
      aggregate: aggregate, resolveAgg: resolveAgg, barsSpec: barsSpec, bucketMeta: bucketMeta, defaultAgg: defaultAgg, periodSummary: periodSummary, outlierNote: outlierNote, VIEWS: VIEWS, AGGS: AGGS }
  };
})(window);
