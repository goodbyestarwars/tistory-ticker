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
  var SR_FLIP_COLOR = '124,77,255';   // 지지↔저항 전환 가격대(2026-10-21)

  // 2026-10-18 사용자 요청("지지·저항이 너무 촘촘하다. 단타 관점엔 좋지만 추세 관점엔 너무 짧다"): 일봉·주봉·월봉은 추세 설정을 쓴다.
  // 스윙 판정 폭을 넓히고(일봉 좌우 10봉), 묶는 폭·선 사이 최소 간격을 키우고(일봉 3%·6%), 더 긴 기간(일봉 500봉)을 보며,
  // 현재가에서 가까운 순이 아니라 많이 닿고 최근·거래량이 컸던 강한 가격대부터 골라 서로 떨어진 선만 남긴다.
  // 분봉 등 timeframe 을 알려 주지 않은 호출은 예전(단타) 설정 그대로다.
  function srProfile(options) {
    var tf = options && options.timeframe;
    if (tf === 'day') return { window: 10, cluster: 0.03, gap: 0.06, maxBars: 500, near: 0.35, byStrength: true };
    if (tf === 'week' || tf === 'month') return { window: 5, cluster: 0.04, gap: 0.08, maxBars: 260, near: 0.35, byStrength: true };
    return { window: SR_PIVOT_WINDOW, cluster: SR_CLUSTER_PCT, gap: SR_MIN_GAP_PCT, maxBars: SR_MAX_BARS, near: 0.25, byStrength: false };
  }

  function supportResistanceLevels(bars, referencePrice, options) {
    var empty = { support: [], resistance: [], price: null };
    var cfg = srProfile(options);
    if (!bars || bars.length < cfg.window * 2 + 6) return empty;
    var arr = bars.slice(-cfg.maxBars);
    var len = arr.length;
    var calculationPrice = Number(arr[len - 1].close);
    if (!Number.isFinite(calculationPrice) || calculationPrice <= 0) return empty;
    var price = Number(referencePrice);
    if (!Number.isFinite(price) || price <= 0) price = calculationPrice;
    var volSum = 0;
    arr.forEach(function (bar) { volSum += Number(bar.volume) || 0; });
    var volAvg = volSum / len;
    var k = cfg.window;
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
    // 군집 계산 폭은 기존 마지막 종가 기준을 유지하고, 아래 분류만 화면 현재가를 쓴다.
    var tol = calculationPrice * cfg.cluster;
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
    var minHalf = calculationPrice * 0.002;
    function toLevel(c) {
      return { price: c.mean, low: Math.min(c.low, c.mean - minHalf), high: Math.max(c.high, c.mean + minHalf), touches: c.touches, score: c.weight };
    }
    var near = clusters.filter(function (c) { return Math.abs(c.mean - calculationPrice) / calculationPrice <= cfg.near; });
    var levels = near.filter(function (c) { return c.touches >= 2; }).map(toLevel);
    // 2026-10-04: 52주 저점 부근처럼 한쪽에 2회 이상 닿은 가격대가 없으면 "지지/저항이 없다"로 보였다(사용자 지적).
    // 그런 쪽에는 한 번만 닿은 스윙 고·저점(1회)을 가까운 순서로 보충해 최소 2개까지 보여 준다.
    var weakLevels = near.filter(function (c) { return c.touches < 2; }).map(toLevel);
    function nearest(list) {
      var sorted = list.sort(cfg.byStrength
        ? function (a, b) { return b.score - a.score; }                                  // 추세: 강한 가격대 먼저
        : function (a, b) { return Math.abs(a.price - price) - Math.abs(b.price - price); });   // 단타: 현재가에서 가까운 순
      var picked = [];
      sorted.forEach(function (level) {
        if (picked.length >= SR_MAX_PER_SIDE) return;
        var tooClose = picked.some(function (other) { return Math.abs(other.price - level.price) / calculationPrice < cfg.gap; });
        if (!tooClose) picked.push(level);
      });
      return picked;
    }
    function fillWeak(picked, side) {
      if (picked.length >= 2) return picked;
      // 추세 설정은 약한 가격대(1회 터치)도 현재가에 붙은 것이 아니라 더 강한 것부터 보충한다.
      var pool = weakLevels.filter(side).sort(cfg.byStrength ? function (a, b) { return b.score - a.score; }
        : function (a, b) { return Math.abs(a.price - price) - Math.abs(b.price - price); });
      pool.forEach(function (level) {
        if (picked.length >= 2) return;
        var tooClose = picked.some(function (other) { return Math.abs(other.price - level.price) / calculationPrice < cfg.gap; });
        if (!tooClose) picked.push(level);
      });
      return picked;
    }
    // 현재가가 밴드 안에 있어도 중심값으로 한쪽에 분류한다. 돌파된 저항은 지지로,
    // 이탈한 지지는 저항으로 바뀌며 각 방향 번호는 현재가와 가까운 순서다.
    var isSupport = function (l) { return l.price <= price; };
    var isResistance = function (l) { return l.price > price; };
    function finish(list) {
      return list.sort(function (a, b) { return Math.abs(a.price - price) - Math.abs(b.price - price); }).slice(0, SR_MAX_PER_SIDE);
    }
    var out = {
      price: price,
      calculationPrice: calculationPrice,
      support: finish(fillWeak(nearest(levels.filter(isSupport)), isSupport)),
      resistance: finish(fillWeak(nearest(levels.filter(isResistance)), isResistance))
    };
    out.support.forEach(function (l) { enrichLevel(l, arr); });
    out.resistance.forEach(function (l) { enrichLevel(l, arr); });
    return out;
  }

  // 2026-10-21 강도·전환 표시. 모두 이미 정해진 가격대(low~high)를 과거 봉에 대어 보기만 하며 위치는 바꾸지 않는다.
  //  - 반응: 봉이 가격대에 닿은 뒤 종가가 가격대 밖으로 되돌아간 경우(위로 = 지지 반응, 아래로 = 저항 반응).
  //    그중 거래량이 직전 20봉 평균의 1.5배 이상이면 거래량 동반.
  //  - 전환: 종가가 가격대 위(아래)에 머물다 반대편으로 넘어간 뒤 다시 가격대를 건드리고 새 쪽에 남아 있으면
  //    '저항→지지'(위로 돌파 후 되돌림 지지) 또는 '지지→저항'. 되돌림(재시험)이 없으면 전환으로 보지 않는다.
  var SR_REACT_VOL = 1.5;
  var SR_FLIP_MIN_PRIOR = 5;
  var SR_FLIP_PCT = 0.005;
  var SR_FLIP_MAX_AGE = 160;
  function enrichLevel(level, arr) {
    var lo = level.low, hi = level.high, pad = level.price * 0.004;
    var reactions = 0, volReactions = 0, lastIdx = -1;
    var state = [];
    for (var j = 0; j < arr.length; j++) {
      var bar = arr[j];
      var h = Number(bar.high), l = Number(bar.low), c = Number(bar.close);
      if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) { state.push(0); continue; }
      state.push(c > hi * (1 + SR_FLIP_PCT) ? 1 : (c < lo * (1 - SR_FLIP_PCT) ? -1 : 0));
      if (l > hi + pad || h < lo - pad) continue;                      // 가격대에 닿지 않음
      var bounced = l <= hi + pad && c > hi;                           // 아래에서 닿고 위로 마감
      var rejected = h >= lo - pad && c < lo;                          // 위에서 닿고 아래로 마감
      if (!bounced && !rejected) continue;
      if (lastIdx >= 0 && j - lastIdx < 3) { lastIdx = j; continue; }   // 며칠 이어 닿은 것은 한 번의 반응으로 센다
      reactions++;
      lastIdx = j;
      var vsum = 0, vn = 0;
      for (var m = Math.max(0, j - 20); m < j; m++) { var v = Number(arr[m].volume); if (Number.isFinite(v)) { vsum += v; vn++; } }
      var vol = Number(bar.volume);
      if (vn && vsum > 0 && Number.isFinite(vol) && vol / (vsum / vn) >= SR_REACT_VOL) volReactions++;
    }
    level.reactions = reactions;
    level.volReactions = volReactions;
    level.lastReaction = lastIdx >= 0 ? arr[lastIdx].date : null;
    var score = reactions + (volReactions ? 1 : 0);
    level.strength = score >= 5 ? 2 : (score >= 3 ? 1 : 0);
    // 전환: 0 이 아닌 상태가 바뀐 마지막 지점
    var prev = 0, prevRun = 0, flipAt = -1, flipTo = 0;
    for (var k = 0; k < state.length; k++) {
      var st = state[k];
      if (st === 0) continue;
      if (prev !== 0 && st !== prev && prevRun >= SR_FLIP_MIN_PRIOR) { flipAt = k; flipTo = st; }
      if (st === prev) prevRun++; else { prev = st; prevRun = 1; }
    }
    level.flip = null;
    if (flipAt >= 0 && flipAt >= arr.length - SR_FLIP_MAX_AGE) {   // 너무 오래된 전환은 지금 자리의 근거로 보지 않는다
      var retests = 0;
      for (var q = flipAt + 1; q < arr.length; q++) {
        var qh = Number(arr[q].high), ql = Number(arr[q].low), qc = Number(arr[q].close);
        if (![qh, ql, qc].every(Number.isFinite)) continue;
        var touched = flipTo > 0 ? (ql <= hi + pad && qc >= lo) : (qh >= lo - pad && qc <= hi);
        if (touched) retests++;
      }
      if (retests > 0 && state[state.length - 1] !== -flipTo) {
        level.flip = flipTo > 0 ? 'r2s' : 's2r';
        level.flipDate = arr[flipAt].date;
        level.retests = retests;
      }
    }
  }

  function installSupportResistanceCanvas(container, chart, candleSeries, result, formatPrice, options) {
    options = options || {};
    // 강도 차이는 신뢰도가 아니라 각 방향에서 현재가와의 거리 순위를 뜻한다.
    var SR_BAND_ALPHA = [0.14, 0.085, 0.045];
    var SR_LINE_ALPHA = [0.72, 0.50, 0.32];
    var SR_LABEL_ALPHA = [1.0, 0.78, 0.58];
    function itemsFor(current) {
      if (!current) return [];
      function make(list, color, base) {
        return list.slice(0, SR_MAX_PER_SIDE).map(function (l, i) {
          var flipped = !!l.flip;
          return { l: l, c: flipped ? SR_FLIP_COLOR : color, name: base + ' ' + (i + 1) + (flipped ? ' · 전환' : ''), rank: i, detail: detailText(l) };
        });
      }
      return make(current.support, SR_SUPPORT_COLOR, '지지').concat(make(current.resistance, SR_RESISTANCE_COLOR, '저항'));
    }
    function shortDate(d) {
      var m = typeof d === 'string' ? d.match(/^\d{4}-(\d{2})-(\d{2})/) : null;
      return m ? m[1] + '/' + m[2] : '';
    }
    // 우측 라벨 왼쪽에 붙는 보조 문구: 반응 횟수·마지막 반응일·거래량 동반·전환 시점. 근거가 없으면 비운다.
    function detailText(l) {
      var parts = [];
      if (l.reactions != null) {
        parts.push('반응 ' + l.reactions + '회');
        var d = shortDate(l.lastReaction);
        if (d) parts.push('최근 ' + d);
        if (l.volReactions) parts.push('거래량↑');
      }
      if (l.flip) parts.push((l.flip === 'r2s' ? '저항→지지' : '지지→저항') + (shortDate(l.flipDate) ? ' ' + shortDate(l.flipDate) : ''));
      return parts.join(' · ');
    }
    var all = itemsFor(result);
    if (!all.length) return function () {};
    var chartRoot = container.firstElementChild;
    if (chartRoot) chartRoot.classList.add('ss-lw-chart-root');
    var canvas = document.createElement('canvas');
    canvas.className = 'ss-sr-zones';
    canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(canvas, chartRoot || container.firstChild);

    var frameId = 0;
    var resizeObserver = null;
    function roundedBox(ctx, x, y, width, height, radius) {
      radius = Math.min(radius, width / 2, height / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
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
      var right = Math.max(0, width - axisWidth());
      ctx.font = '600 11px Pretendard, "Malgun Gothic", sans-serif';
      ctx.textBaseline = 'middle';
      // 라벨은 가격축 안쪽에 두고, 서로 겹치면 위치만 조정한다.
      var placed = all.map(function (item) { return { item: item, y: candleSeries.priceToCoordinate(item.l.price) }; })
        .filter(function (p) { return Number.isFinite(p.y) && p.y >= 0 && p.y <= height; })
        .sort(function (a, b) { return a.y - b.y; });
      var labelY = new Map();
      var lastY = -Infinity;
      placed.forEach(function (p) {
        var ly = Math.max(10, Math.min(height - 10, p.y), lastY + 20);
        labelY.set(p.item, ly);
        lastY = ly;
      });
      if (placed.length && lastY > height - 10) {
        var shift = lastY - (height - 10);
        placed.forEach(function (p) { labelY.set(p.item, labelY.get(p.item) - shift); });
      }
      all.forEach(function (item) {
        var y = candleSeries.priceToCoordinate(item.l.price);
        var yTop = candleSeries.priceToCoordinate(item.l.high);
        var yBottom = candleSeries.priceToCoordinate(item.l.low);
        if (![y, yTop, yBottom].every(Number.isFinite)) return;
        // 음영: 스윙 고·저점이 모인 가격 폭
        ctx.fillStyle = 'rgba(' + item.c + ',' + SR_BAND_ALPHA[item.rank] + ')';
        ctx.fillRect(0, Math.max(0, Math.min(yTop, yBottom)), right, Math.max(2, Math.abs(yBottom - yTop)));
        // 가로줄: 점선
        ctx.strokeStyle = 'rgba(' + item.c + ',' + SR_LINE_ALPHA[item.rank] + ')';
        ctx.lineWidth = [1, 1.6, 2.4][item.l.strength || 0];   // 반응이 많고 거래량이 실렸던 선일수록 굵게
        ctx.setLineDash(item.l.flip ? [6, 3] : [2, 2]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(right, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        var priceText = displayPrice(item.l.low) + '~' + displayPrice(item.l.high);
        var nameWidth = ctx.measureText(item.name).width + 14;
        var priceWidth = ctx.measureText(priceText).width + 14;
        var tw = nameWidth + priceWidth + 4;
        var ly = labelY.get(item);
        if (ly == null || right < 80) return;
        var left = Math.max(2, right - tw - 4);
        // 보조 문구는 화면이 넉넉할 때만 이름표 왼쪽에 둔다(좁은 모바일은 생략).
        if (item.detail && right > 420) {
          // 선 위에 글씨만 얹으면 점선·음영에 묻혀 읽기 어려워(2026-10-21 사용자 지적) 가격 배지와 같은 불투명 배지로 그린다.
          ctx.font = '600 11px Pretendard, "Malgun Gothic", sans-serif';
          var dw = ctx.measureText(item.detail).width + 14;
          var dl = Math.max(2, left - dw - 4);
          roundedBox(ctx, dl, ly - 10, dw, 20, 10);
          ctx.fillStyle = global.document.documentElement.classList.contains('dark') ? 'rgba(26,26,26,.96)' : 'rgba(255,254,252,.96)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(' + item.c + ',.55)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = 'rgba(' + item.c + ',1)';
          ctx.fillText(item.detail, dl + 7, ly + 0.5);
        }
        // 종류·순위와 가격 범위를 서로 다른 둥근 배지로 나눠 가격축 숫자와 혼동되지 않게 한다.
        roundedBox(ctx, left, ly - 10, nameWidth, 20, 10);
        ctx.fillStyle = 'rgba(' + item.c + ',' + SR_LABEL_ALPHA[item.rank] + ')';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(item.name, left + 7, ly + 0.5);
        var priceLeft = left + nameWidth + 4;
        roundedBox(ctx, priceLeft, ly - 10, Math.min(priceWidth, right - priceLeft - 2), 20, 10);
        ctx.fillStyle = global.document.documentElement.classList.contains('dark') ? 'rgba(26,26,26,.94)' : 'rgba(255,254,252,.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(' + item.c + ',' + SR_LABEL_ALPHA[item.rank] + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(' + item.c + ',' + SR_LABEL_ALPHA[item.rank] + ')';
        ctx.fillText(priceText, priceLeft + 7, ly + 0.5, Math.max(0, right - priceLeft - 11));
      });
    }
    function krxTickSize(value) {
      if (value < 2000) return 1;
      if (value < 5000) return 5;
      if (value < 20000) return 10;
      if (value < 50000) return 50;
      if (value < 200000) return 100;
      if (value < 500000) return 500;
      return 1000;
    }
    function displayPrice(value) {
      var number = Number(value);
      if (!Number.isFinite(number)) return formatPrice(value);
      var rounded = options.isUs ? Math.round(number * 100) / 100 : Math.round(number / krxTickSize(number)) * krxTickSize(number);
      return formatPrice(rounded);
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
    function cleanup() {
      if (frameId) global.cancelAnimationFrame(frameId);
      global.clearTimeout(settle);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw);
      if (resizeObserver) resizeObserver.disconnect();
      else global.removeEventListener('resize', scheduleDraw);
      canvas.remove();
    }
    cleanup.update = function (nextResult) {
      result = nextResult;
      all = itemsFor(result);
      scheduleDraw();
    };
    return cleanup;
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
    install: function (container, chart, series, result, formatPrice, options) {
      ensureStyles();
      try { if (global.getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch (e) { /* 무시 */ }
      return installSupportResistanceCanvas(container, chart, series, result, formatPrice, options);
    }
  };
})(window);
