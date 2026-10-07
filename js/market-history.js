/* Five-year chart history is served by Pages. No VM history backfill is requested. */
(function (global) {
  'use strict';
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/data/chart-history/';
  var jobs = {};
  function load(group) {
    if (!/^(domestic|global|crypto|macro)$/.test(group)) return Promise.resolve(false);
    if (jobs[group]) return jobs[group];
    if (global.MARKET_HISTORY_ARCHIVES && global.MARKET_HISTORY_ARCHIVES[group]) return Promise.resolve(true);
    jobs[group] = new Promise(function (resolve) {
      var script = document.createElement('script'), done = false;
      function finish(ok) { if (done) return; done = true; clearTimeout(timer); resolve(ok); }
      var timer = setTimeout(function () { finish(false); }, 10000);
      script.src = base + group + '.js?v=20261008-5y';
      script.onload = function () { finish(true); };
      script.onerror = function () { finish(false); };
      document.head.appendChild(script);
    });
    return jobs[group];
  }
  function cutoff(now) {
    var date = new Date((now == null ? Date.now() : now) + 9 * 3600000);
    var month = date.getUTCMonth(), day = date.getUTCDate();
    date.setUTCFullYear(date.getUTCFullYear() - 5);
    if (date.getUTCMonth() !== month) date.setUTCDate(0); // February 29.
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }
  function merge(symbol, recent, now) {
    var archives = global.MARKET_HISTORY_ARCHIVES || {}, stored = [], byDate = {}, from = cutoff(now);
    Object.keys(archives).some(function (key) {
      stored = archives[key].series && archives[key].series[symbol] || [];
      return stored.length > 0;
    });
    stored.forEach(function (r) {
      byDate[r[0]] = r.length === 5 ? {date:r[0],open:r[1],high:r[2],low:r[3],close:r[4]}
        : {date:r[0],close:r[1]};
    });
    (recent || []).forEach(function (r) {
      var date = String(r.date || '').replace(/-/g, '');
      if (/^\d{8}$/.test(date) && isFinite(Number(r.close))) byDate[date] = Object.assign({}, r, {date:date});
    });
    return Object.keys(byDate).filter(function (date) { return date >= from; }).sort().map(function (date) { return byDate[date]; });
  }
  function isoRows(rows) {
    return rows.map(function (r) { return Object.assign({},r,{date:r.date.slice(0,4)+'-'+r.date.slice(4,6)+'-'+r.date.slice(6,8)}); });
  }
  function weekly(rows) {
    var byWeek = {};
    isoRows(rows).forEach(function (r) {
      var d = new Date(r.date+'T00:00:00Z');
      d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
      var key = d.toISOString().slice(0,10), bar = byWeek[key];
      if (!bar) byWeek[key] = Object.assign({},r,{date:key});
      else { bar.high=Math.max(bar.high,r.high); bar.low=Math.min(bar.low,r.low); bar.close=r.close; }
    });
    return Object.keys(byWeek).sort().map(function (key) { return byWeek[key]; });
  }
  function caption(rows, now) {
    if (!rows || !rows.length) return '이력 확인 불가';
    var first = String(rows[0].date).replace(/-/g,''), last = String(rows[rows.length-1].date).replace(/-/g,'');
    var full = Date.parse(first.slice(0,4)+'-'+first.slice(4,6)+'-'+first.slice(6,8))
      - Date.parse(cutoff(now).slice(0,4)+'-'+cutoff(now).slice(4,6)+'-'+cutoff(now).slice(6,8)) <= 31*86400000;
    return (full ? '최근 5년' : '확보된 이력')+' · '+first.slice(0,4)+'.'+first.slice(4,6)+' ~ '+last.slice(0,4)+'.'+last.slice(4,6);
  }
  global.MarketChartHistory = {load:load,merge:merge,isoRows:isoRows,weekly:weekly,caption:caption,cutoff:cutoff};
})(window);
