/**
 * RSI 다이버전스 표시(2026-10-22). 차트검색의 가격·RSI 패널 위에 선을 긋는다.
 *   약세: 가격 고점은 높아졌는데 RSI 고점은 낮아진 연속한 두 고점
 *   강세: 가격 저점은 낮아졌는데 RSI 저점은 높아진 연속한 두 저점
 * 극점은 자동 파동(js/auto-wave.js)이 확정한 고점·저점만 쓴다(진행 중 파동은 제외) - 선은 두 번째 극점이 확정된 뒤에만 생긴다.
 * 과거 가격 구조를 보여 주는 표시이며 매수·매도 신호나 방향 예측이 아니다.
 *
 * 사용: var list = NineChartDivergence.find(bars, rsiValues, waveResult, level);
 *       var cleanup = NineChartDivergence.install({ container, chart, candleSeries, rsiSeries, panes, bars, list, paneHeight });
 */
(function (global) {
  'use strict';
  var BEAR = '#d9480f', BULL = '#0b7285';
  var MIN_GAP = 8;      // 두 극점 사이 최소 봉 수
  var MIN_RSI_DIFF = 2; // RSI 차이가 이보다 작으면 같은 높이로 본다

  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }

  // 파동 결과(levels[level])에서 확정된 방향 파동의 양 끝을 고점/저점 극점으로 모은다.
  function pivotsOf(waveResult, level) {
    var waves = waveResult && waveResult.levels && waveResult.levels[level] ? waveResult.levels[level] : [];
    var seen = {}, out = [];
    function add(i, p, type, confirmedIndex) {
      var k = type + i;
      if (seen[k] || p == null) return;
      seen[k] = true;
      out.push({ i: i, p: p, type: type, confirmedIndex: confirmedIndex });
    }
    waves.forEach(function (w) {
      if (!w || w.isBox || !w.confirmed || (w.kind !== 'up' && w.kind !== 'down')) return;
      var ci = w.confirmedIndex != null ? w.confirmedIndex : w.end;
      if (w.kind === 'up') { add(w.start, num(w.low), 'L', ci); add(w.end, num(w.high), 'H', ci); }
      else { add(w.start, num(w.high), 'H', ci); add(w.end, num(w.low), 'L', ci); }
    });
    out.sort(function (a, b) { return a.i - b.i; });
    return out;
  }

  function find(bars, rsiValues, waveResult, level) {
    if (!bars || !rsiValues || !waveResult) return [];
    var pivots = pivotsOf(waveResult, level || 'medium');
    var list = [];
    ['H', 'L'].forEach(function (type) {
      var arr = pivots.filter(function (q) { return q.type === type && rsiValues[q.i] != null; });
      for (var k = 1; k < arr.length; k++) {
        var a = arr[k - 1], b = arr[k];
        if (b.i - a.i < MIN_GAP) continue;
        var ra = rsiValues[a.i], rb = rsiValues[b.i];
        if (type === 'H' && b.p > a.p && rb < ra - MIN_RSI_DIFF) list.push({ kind: 'bear', a: a, b: b, ra: ra, rb: rb, confirmedIndex: Math.max(a.confirmedIndex, b.confirmedIndex) });
        if (type === 'L' && b.p < a.p && rb > ra + MIN_RSI_DIFF) list.push({ kind: 'bull', a: a, b: b, ra: ra, rb: rb, confirmedIndex: Math.max(a.confirmedIndex, b.confirmedIndex) });
      }
    });
    return list;
  }

  function install(opts) {
    var container = opts.container, chart = opts.chart, list = opts.list || [], bars = opts.bars;
    var priceSeries = opts.candleSeries, rsiSeries = opts.rsiSeries, panes = opts.panes || [];
    if (!list.length || !rsiSeries || !priceSeries) return function () {};
    try { if (global.getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch (e) { /* 무시 */ }
    var canvas = document.createElement('canvas');
    canvas.className = 'ss-sr-zones ss-divergence-zones';
    canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(canvas, container.firstElementChild || container.firstChild);
    var frameId = 0, resizeObserver = null, subs = [];
    function paneHeight(pane, fallback) {
      var v = pane && pane.getHeight ? pane.getHeight() : fallback;
      return Number.isFinite(v) && v > 0 ? v : fallback;
    }
    function draw() {
      frameId = 0;
      if (!document.body.contains(container)) return;
      var width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      var ratio = Math.max(1, global.devicePixelRatio || 1);
      var pw = Math.round(width * ratio), ph = Math.round(height * ratio);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      var rsiTop = paneHeight(panes[0], height * 0.68) + paneHeight(panes[1], height * 0.14);
      var dark = document.documentElement.classList.contains('dark');
      var ts = chart.timeScale();
      ctx.font = '600 11px Pretendard Variable, Pretendard, "Malgun Gothic", sans-serif';
      ctx.textBaseline = 'middle';
      function xOf(i) { var b = bars[i]; if (!b) return null; var x = ts.timeToCoordinate(b.time != null ? b.time : b.date); return Number.isFinite(x) ? x : null; }
      function pill(text, x, y, color) {
        var w = ctx.measureText(text).width + 14;
        var left = Math.max(2, Math.min(width - w - 60, x - w / 2));
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(left, y - 9, w, 18, 9); else ctx.rect(left, y - 9, w, 18);
        ctx.fillStyle = dark ? 'rgba(32,39,49,.95)' : 'rgba(255,254,252,.95)';
        ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(text, left + 7, y + 0.5);
      }
      list.forEach(function (d) {
        var color = d.kind === 'bear' ? BEAR : BULL;
        var xa = xOf(d.a.i), xb = xOf(d.b.i);
        if (xa == null || xb == null || Math.max(xa, xb) < 0 || Math.min(xa, xb) > width) return;
        var pa = priceSeries.priceToCoordinate(d.a.p), pb = priceSeries.priceToCoordinate(d.b.p);
        var ya = rsiSeries.priceToCoordinate(d.ra), yb = rsiSeries.priceToCoordinate(d.rb);
        if (![pa, pb, ya, yb].every(Number.isFinite)) return;
        ya += rsiTop; yb += rsiTop;
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4;
        [[xa, pa, xb, pb], [xa, ya, xb, yb]].forEach(function (s) {
          ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
        });
        [[xa, pa], [xb, pb], [xa, ya], [xb, yb]].forEach(function (pt) {
          ctx.beginPath(); ctx.arc(pt[0], pt[1], 3.6, 0, Math.PI * 2);
          ctx.fillStyle = dark ? '#202731' : '#fff'; ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        });
        // 두 극점의 가격·RSI 짝을 알아보도록 점선으로 가격 패널과 RSI 패널을 잇는다.
        ctx.save();
        ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.strokeStyle = color;
        [[xa, pa, ya], [xb, pb, yb]].forEach(function (c) { ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0], c[2]); ctx.stroke(); });
        ctx.restore();
        var title = d.kind === 'bear' ? '약세 다이버전스' : '강세 다이버전스';
        pill(title, (xa + xb) / 2, d.kind === 'bear' ? Math.min(pa, pb) - 16 : Math.max(pa, pb) + 18, color);
        pill('RSI ' + Math.round(d.ra) + ' → ' + Math.round(d.rb), (xa + xb) / 2, d.kind === 'bear' ? Math.min(ya, yb) - 14 : Math.max(ya, yb) + 14, color);
      });
    }
    function schedule() { if (!frameId) frameId = global.requestAnimationFrame(draw); }
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    panes.forEach(function (pane) { if (pane && typeof pane.subscribeSizeChange === 'function') { pane.subscribeSizeChange(schedule); subs.push(pane); } });
    if ('ResizeObserver' in global) { resizeObserver = new ResizeObserver(schedule); resizeObserver.observe(container); }
    else global.addEventListener('resize', schedule);
    schedule();
    var settle = global.setTimeout(schedule, 300);   // 패널 높이가 자리 잡은 뒤 한 번 더 그린다
    return function () {
      if (frameId) global.cancelAnimationFrame(frameId);
      global.clearTimeout(settle);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule); } catch (e) { /* 이미 제거됨 */ }
      subs.forEach(function (pane) { if (typeof pane.unsubscribeSizeChange === 'function') pane.unsubscribeSizeChange(schedule); });
      if (resizeObserver) resizeObserver.disconnect(); else global.removeEventListener('resize', schedule);
      canvas.remove();
    };
  }

  global.NineChartDivergence = { find: find, install: install, _pivotsOf: pivotsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartDivergence;
})(typeof window !== 'undefined' ? window : globalThis);
