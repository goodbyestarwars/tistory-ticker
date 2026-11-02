/* Stock story data only. No transport, DOM, timers or per-symbol files. */
(function (global) {
  'use strict';
  function number(v) { return v == null || String(v).trim() === '' || (typeof v !== 'number' && typeof v !== 'string') ? null : (Number.isFinite(Number(v)) ? Number(v) : null); }
  function date(v) {
    var s = String(v || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : null;
  }
  function sorted(rows) {
    if (!Array.isArray(rows)) return [];
    var seen = Object.create(null);
    return rows.filter(function (r) { var d = r && date(r.date); if (!d || seen[d]) return false; seen[d] = true; return true; })
      .slice().sort(function (a, b) { return date(a.date).localeCompare(date(b.date)); });
  }
  function pct(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function value(v) { return Math.round(v).toLocaleString('ko-KR'); }
  function pair(k, v, tone) { return { k: k, v: v, t: tone || 'n' }; }
  function card(topic, title, sub, pairs, asOf, source) {
    return { topic: topic, title: title, sub: sub, pair: pairs, asOf: asOf, src: source + ' · ' + asOf + ' 기준', tier: 2 };
  }
  function growth(p) {
    // pct_change on the server uses abs(prior). Over 100% can also mean a loss-to-profit transition.
    return p > 100 ? '영업이익 변화가 공시에 나타났다' : '영업이익이 ' + (p === 100 ? '두 배로 늘었다' : '늘었다');
  }
  function build(input) {
    input = input || {};
    var cards = [], f = input.fundamentals && input.fundamentals.fundamentals;
    var q = f && f.latest_quarter, p, basis, pairs;
    if (q && q.amount_basis === 'standalone_3m' && (basis = date(q.rcept_dt))) {
      pairs = [];
      p = number(q.operating_income_yoy_pct);
      // A positive profit and positive comparison base are required for growth wording.
      if (number(q.operating_income) > 0 && p !== null && p >= 20) pairs.push(pair('분기 영업이익 YoY', pct(p), 'up'));
      var qo = number(q.operating_income_qoq_pct);
      if (number(q.operating_income) > 0 && qo !== null && qo >= 20) pairs.push(pair('분기 영업이익 QoQ', pct(qo), 'up'));
      var y = q.ytd, yp = y && number(y.operating_income_yoy_pct);
      if (y && y.amount_basis === 'dart_ytd_reported' && number(y.operating_income) > 0 && yp !== null && yp >= 20) pairs.push(pair('누적 영업이익 YoY', pct(yp), 'up'));
      if (pairs.length) cards.push(card('earnings', growth(p !== null && p >= 20 ? p : (qo !== null && qo >= 20 ? qo : yp)),
        (q.period_label || (q.year && q.label ? q.year + '년 ' + q.label : '최근 분기')) + ' 공시 실적이다. 분기와 누적을 구분해 읽는다.', pairs, basis, 'DART · 공시 접수일'));
    }
    // /investor-flow currently contains pension only; foreign/institution histories live in /foreign-flow.
    var flow = input.foreignFlow, daily = sorted(flow && !flow.flowUnavailable && flow.daily);
    if (daily.length >= 20) {
      var recent = daily.slice(-20), totals = [], valid = true;
      ['foreign_net', 'inst_net'].forEach(function (key, i) {
        var vals = recent.map(function (r) { return number(r[key]); });
        if (vals.some(function (v) { return v === null; })) { valid = false; return; }
        var sum = vals.reduce(function (a, b) { return a + b; }, 0), streak = 0, last = vals[19];
        for (var j = daily.length - 1; j >= 0; j--) {
          var n = number(daily[j][key]);
          if (n === null || !last || Math.sign(n) !== Math.sign(last)) break;
          streak++;
        }
        totals.push({ sum: sum, name: i ? '기관' : '외국인', streak: streak, last: last });
      });
      if (valid && totals.some(function (t) { return t.sum > 0; })) {
        cards.push(card('flow', '최근 20거래일 순매수 흐름', totals.map(function (t) {
          return t.last === 0 ? t.name + '의 마지막 거래일 수급은 보합이다.' : t.name + '은 최근 ' + t.streak + '거래일 연속 ' + (t.last > 0 ? '순매수' : '순매도') + '다.';
        }).join(' '), totals.map(function (t) { return pair(t.name + ' 20일 순매수', (t.sum > 0 ? '+' : '') + value(t.sum) + '주', t.sum > 0 ? 'up' : t.sum < 0 ? 'dn' : 'n'); }),
        date(recent[19].date), '외국인·기관 일별 수급'));
      }
    }
    var investor = input.investorFlow;
    pairs = []; var ratioDates = [];
    ['short', 'credit'].forEach(function (key) {
      // These optional histories must carry ratios, never balance quantities or volume averages.
      var history = sorted(investor && investor[key] && investor[key].daily);
      if (history.length < 25) return;
      var window = history.slice(-25), ratios = window.map(function (r) { return number(r.ratio_pct); });
      if (ratios.some(function (v) { return v === null || v < 0 || v > 100; })) return;
      var before = ratios.slice(0, 20).reduce(function (a, b) { return a + b; }, 0) / 20;
      var after = ratios.slice(20).reduce(function (a, b) { return a + b; }, 0) / 5;
      if (before <= 0 || after / before < 1.2) return;
      var name = key === 'short' ? '공매도 거래비중' : '신용 비중';
      pairs.push(pair(name, before.toFixed(2) + '% → ' + after.toFixed(2) + '%', 'dn'));
      ratioDates.push(name + ' ' + date(window[24].date));
    });
    if (pairs.length) cards.push(card('short-credit', '공매도·신용 비중이 늘었다', '최근 5거래일 평균을 겹치지 않는 직전 20거래일 평균과 비교했다. 잔고 증감률과는 다르다.', pairs, ratioDates.join(' / '), '일별 비중'));
    var opinion = input.opinion, asOf = date(opinion && (opinion.asOf || opinion._updatedAt || opinion.latestDate));
    if (opinion && opinion.available && asOf) {
      var end = Date.parse(asOf), startDate = new Date(end); startDate.setUTCMonth(startDate.getUTCMonth() - 1);
      var reports = (opinion.reports || []).filter(function (r) { var t = Date.parse(date(r.date)); return t >= startDate.getTime() && t <= end && number(r.targetPrice) > 0; });
      if (reports.length) {
        var avg = reports.reduce(function (a, r) { return a + number(r.targetPrice); }, 0) / reports.length;
        pairs = [pair('최근 1개월 평균 목표가', value(avg) + '원')];
        // Count revisions only when actual revision metadata exists. Daily observations are not broker reports.
        var revisions = reports.filter(function (r) { return r.broker && r.reportId && number(r.previousTargetPrice) > 0; });
        var unique = Object.create(null), up = 0, down = 0;
        revisions.forEach(function (r) { var id = r.broker + ':' + r.reportId; if (unique[id]) return; unique[id] = true; if (number(r.targetPrice) > number(r.previousTargetPrice)) up++; if (number(r.targetPrice) < number(r.previousTargetPrice)) down++; });
        if (revisions.length) pairs.push(pair('확인된 목표가 상향 / 하향', up + '건 / ' + down + '건'));
        cards.push(card('target', '최근 한 달의 목표가', 'KIS 날짜별 목표가 관측치 ' + reports.length + '개의 산술평균이다. 증권사별 보고서 평균과 다르다.' + (revisions.length ? '' : ' 상향·하향 건수는 원자료가 없어 표시하지 않는다.'), pairs, asOf, 'KIS 투자의견'));
      }
    }
    var chart = input.chartData, prices = sorted(chart && chart.source !== 'flow-fallback' && chart.daily);
    if (prices.length >= 224) {
      var tail = prices.slice(-224), lastRow = prices[prices.length - 1], close = number(lastRow.close);
      if (close > 0 && tail.every(function (r) { return number(r.close) > 0; })) {
        var ma = tail.reduce(function (a, r) { return a + Number(r.close); }, 0) / 224;
        pairs = [pair('224일선 대비', pct((close / ma - 1) * 100), close >= ma ? 'up' : 'dn')];
        var cutoff = Date.parse(date(lastRow.date)) - 364 * 86400000;
        var year = prices.filter(function (r) { return Date.parse(date(r.date)) >= cutoff; });
        if (Date.parse(date(prices[0].date)) <= cutoff && year.every(function (r) { return number(r.high) > 0 && number(r.low) > 0 && Number(r.high) >= Number(r.low); })) {
          var high = Math.max.apply(null, year.map(function (r) { return Number(r.high); }));
          var low = Math.min.apply(null, year.map(function (r) { return Number(r.low); }));
          pairs.push(pair('52주 고가 대비', pct((close / high - 1) * 100), 'dn'));
          pairs.push(pair('52주 저가 대비', pct((close / low - 1) * 100), 'up'));
        }
        cards.push(card('position', '주가가 서 있는 자리', '마지막 일봉 종가 ' + value(close) + '원을 기준으로 비교했다. 이동평균선은 지지나 상승을 보장하지 않는다.', pairs, date(lastRow.date), '수정주가 일봉'));
      }
    }
    return cards.slice(0, 5);
  }
  function merge(primary, generated) {
    var topics = Object.create(null);
    (primary || []).forEach(function (c) { (c.topics || [c.topic]).forEach(function (t) { if (t) topics[t] = true; }); });
    return (primary || []).concat((generated || []).filter(function (c) { return !topics[c.topic]; }));
  }
  global.StockStoryTemplate = { build: build, merge: merge };
})(window);
