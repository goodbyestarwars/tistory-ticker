/**
 * 지지·저항 공용 모듈(2026-10-03). 실시간 검색(stock-search.js)에 내장된 것과 같은 알고리즘·그림이다 -
 * 종목분석(foreign-flow.js)에서 같은 종목이 다른 지지·저항으로 보이던 문제를 없애려고 같은 계산을 공유한다.
 * 사용: var r = NineChartSR.levels(bars); NineChartSR.install(container, chart, series, r, formatPrice) -> 정리 함수
 *       (bars: [{date, open, high, low, close}] 오름차순). 지지 = 붉은색, 저항 = 파란색.
 */
(function (global) {
  'use strict';
  // ---- 지지·저항 (2026-10-03 사용자 요청: "일목균형표 옆에 지지와 저항 옵션, 가로줄(지지 붉은색/저항 파란색)
  // 또는 음영, 목적은 타점") ----
  // 현재 차트의 봉(일/주/월/분)에서 스윙 고점·저점(좌우 4봉보다 높거나 낮은 봉)을 찾고, 가까운 가격끼리
  // 묶어(현재가의 1.2% 이내) 가격대로 만든다. 많이 닿을수록(터치 수)·최근일수록·거래량이 컸을수록 강하다.
  // 현재가 아래는 지지(붉은색), 위는 저항(파란색)이며 현재가에서 가까운 3개씩만 보여 준다.
  // 매수·매도 추천이 아니라 과거 가격이 반응했던 자리를 보여 주는 참고선이다.
  var SR_PIVOT_WINDOW = 4;
  var SR_CLUSTER_PCT = 0.015;
  var SR_MIN_GAP_PCT = 0.02;   // 같은 쪽에서 고른 선끼리 최소 간격(라벨·선이 붙어 읽기 어려운 것 방지)
  var SR_MAX_BARS = 260;
  var SR_MAX_PER_SIDE = 3;
  var SR_SUPPORT_COLOR = '210,79,69';
  var SR_RESISTANCE_COLOR = '18,97,196';

  function supportResistanceLevels(bars) {
    var empty = { support: [], resistance: [], price: null };
    if (!bars || bars.length < SR_PIVOT_WINDOW * 2 + 6) return empty;
    var arr = bars.slice(-SR_MAX_BARS);
    var len = arr.length;
    var price = Number(arr[len - 1].close);
    if (!Number.isFinite(price) || price <= 0) return empty;
    var volSum = 0;
    arr.forEach(function (bar) { volSum += Number(bar.volume) || 0; });
    var volAvg = volSum / len;
    var k = SR_PIVOT_WINDOW;
    var pivots = [];
    for (var i = k; i < len - k; i++) {
      var hi = Number(arr[i].high);
      var lo = Number(arr[i].low);
      var isHigh = Number.isFinite(hi);
      var isLow = Number.isFinite(lo);
      var strictHigh = false;
      var strictLow = false;
      for (var j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        if (Number(arr[j].high) > hi) isHigh = false;
        else if (Number(arr[j].high) < hi) strictHigh = true;
        if (Number(arr[j].low) < lo) isLow = false;
        else if (Number(arr[j].low) > lo) strictLow = true;
      }
      var recency = 0.6 + 0.4 * (i / len);
      var volume = volAvg > 0 ? Math.min(3, (Number(arr[i].volume) || 0) / volAvg) : 1;
      var weight = recency * (1 + 0.35 * volume);
      if (isHigh && strictHigh) pivots.push({ price: hi, weight: weight });
      if (isLow && strictLow) pivots.push({ price: lo, weight: weight });
    }
    pivots.sort(function (a, b) { return a.price - b.price; });
    var tol = price * SR_CLUSTER_PCT;
    var clusters = [];
    pivots.forEach(function (p) {
      var c = clusters[clusters.length - 1];
      if (c && p.price - c.mean <= tol) {
        c.sum += p.price * p.weight;
        c.weight += p.weight;
        c.mean = c.sum / c.weight;
        c.low = Math.min(c.low, p.price);
        c.high = Math.max(c.high, p.price);
        c.touches += 1;
      } else {
        clusters.push({ sum: p.price * p.weight, weight: p.weight, mean: p.price, low: p.price, high: p.price, touches: 1 });
      }
    });
    var minHalf = price * 0.002;
    var levels = clusters.filter(function (c) {
      return c.touches >= 2 && Math.abs(c.mean - price) / price <= 0.25;
    }).map(function (c) {
      return { price: c.mean, low: Math.min(c.low, c.mean - minHalf), high: Math.max(c.high, c.mean + minHalf), touches: c.touches, score: c.weight };
    });
    function nearest(list) {
      var sorted = list.sort(function (a, b) { return Math.abs(a.price - price) - Math.abs(b.price - price); });
      var picked = [];
      sorted.forEach(function (level) {
        if (picked.length >= SR_MAX_PER_SIDE) return;
        var tooClose = picked.some(function (other) { return Math.abs(other.price - level.price) / price < SR_MIN_GAP_PCT; });
        if (!tooClose) picked.push(level);
      });
      return picked;
    }
    return {
      price: price,
      support: nearest(levels.filter(function (l) { return l.price < price * 0.998; })),
      resistance: nearest(levels.filter(function (l) { return l.price > price * 1.002; }))
    };
  }

  function installSupportResistanceCanvas(container, chart, candleSeries, result, formatPrice) {
    var all = result ? result.support.map(function (l) { return { l: l, c: SR_SUPPORT_COLOR, name: '지지' }; })
      .concat(result.resistance.map(function (l) { return { l: l, c: SR_RESISTANCE_COLOR, name: '저항' }; })) : [];
    if (!all.length) return function () {};
    var chartRoot = container.firstElementChild;
    if (chartRoot) chartRoot.classList.add('ss-lw-chart-root');
    var canvas = document.createElement('canvas');
    canvas.className = 'ss-sr-zones';
    canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(canvas, chartRoot || container.firstChild);

    var frameId = 0;
    var resizeObserver = null;
    function axisWidth() {
      try { var w = chart.priceScale('right').width(); if (Number.isFinite(w) && w > 0) return w; } catch (e) { /* 버전에 따라 없다 */ }
      return 58;
    }
    function draw() {
      frameId = 0;
      if (!document.body.contains(container)) return;
      var width = container.clientWidth;
      var height = container.clientHeight;
      if (!width || !height) return;
      var ratio = Math.max(1, global.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      var right = width - axisWidth();
      ctx.font = '600 11px Pretendard, "Malgun Gothic", sans-serif';
      ctx.textBaseline = 'middle';
      // 라벨이 겹치면 위에서부터 18px 이상 벌린다(선 위치는 그대로, 라벨만 이동)
      var labelY = {};
      var placed = all.map(function (item) { return { item: item, y: candleSeries.priceToCoordinate(item.l.price) }; })
        .filter(function (p) { return Number.isFinite(p.y); })
        .sort(function (a, b) { return a.y - b.y; });
      var lastY = -Infinity;
      placed.forEach(function (p, idx) {
        var ly = Math.max(Math.min(Math.max(p.y, 10), height - 10), lastY + 19);
        labelY[p.item.name + p.item.l.price] = ly;
        lastY = ly;
      });
      all.forEach(function (item) {
        var y = candleSeries.priceToCoordinate(item.l.price);
        var yTop = candleSeries.priceToCoordinate(item.l.high);
        var yBottom = candleSeries.priceToCoordinate(item.l.low);
        if (![y, yTop, yBottom].every(Number.isFinite)) return;
        // 음영: 스윙 고·저점이 모인 가격 폭
        ctx.fillStyle = 'rgba(' + item.c + ',' + (0.07 + Math.min(item.l.touches, 6) * 0.012) + ')';
        ctx.fillRect(0, Math.min(yTop, yBottom), right, Math.max(2, Math.abs(yBottom - yTop)));
        // 가로줄: 점선
        ctx.strokeStyle = 'rgba(' + item.c + ',.85)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(right, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        // 라벨: 오른쪽 끝(가격축 바로 안쪽)에 이름·가격·터치 수
        var text = item.name + ' ' + formatPrice(item.l.price) + ' ·' + item.l.touches + '회';
        var tw = ctx.measureText(text).width + 12;
        var ly = labelY[item.name + item.l.price] != null ? labelY[item.name + item.l.price] : Math.min(Math.max(y, 9), height - 9);
        ctx.fillStyle = 'rgba(' + item.c + ',.92)';
        ctx.fillRect(right - tw - 4, ly - 9, tw, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, right - tw + 2, ly + 0.5);
      });
    }
    function scheduleDraw() {
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = global.requestAnimationFrame(draw);
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw);
    if ('ResizeObserver' in global) {
      resizeObserver = new ResizeObserver(scheduleDraw);
      resizeObserver.observe(container);
    } else {
      global.addEventListener('resize', scheduleDraw);
    }
    scheduleDraw();
    // 가격축 범위는 시간축 이동 없이도(확대·세로 드래그) 바뀌므로 짧게 한 번 더 그린다.
    var settle = global.setTimeout(scheduleDraw, 250);
    return function () {
      if (frameId) global.cancelAnimationFrame(frameId);
      global.clearTimeout(settle);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw);
      if (resizeObserver) resizeObserver.disconnect();
      else global.removeEventListener('resize', scheduleDraw);
      canvas.remove();
    };
  }

  function ensureStyles() {
    if (document.getElementById('chartSrCss')) return;
    var link = document.createElement('link');
    link.id = 'chartSrCss';
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/chart-sr.css';
    document.head.appendChild(link);
  }

  global.NineChartSR = {
    levels: supportResistanceLevels,
    install: function (container, chart, series, result, formatPrice) {
      ensureStyles();
      try { if (global.getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch (e) { /* 무시 */ }
      return installSupportResistanceCanvas(container, chart, series, result, formatPrice);
    }
  };
})(window);
