/**
 * 추세 구간·박스권 공용 모듈(2026-10-21, 추세 구간 방식으로 재설계). 차트검색(stock-search.js)과 종목분석(foreign-flow.js)이 같이 쓴다.
 * 사용: var r = NineChartStructure.analyze(bars, { timeframe });
 *       NineChartStructure.install(container, chart, series, r, formatPrice, opts) -> 정리 함수(.update(nextResult))
 *       (bars: [{date, open, high, low, close, volume}] 오름차순, date 가 시리즈 time 과 같다.)
 *
 * - 추세 구간: 일정 비율(일봉 10%) 이상 되돌린 고점·저점(지그재그)을 찾아, 저점과 고점이 함께 높아지는 구간은 상승,
 *   함께 낮아지는 구간은 하락으로 묶는다. 구간마다 모든 저점 아래·고점 위를 지나는 평행 채널을 그 구간 안에서만 그린다
 *   (오른쪽 끝까지 늘리지 않는다). 지그재그 고점·저점은 되돌림이 확인된 뒤에만 쓰므로 미래 봉을 보지 않는다.
 * - 현재 구간의 이탈: 마지막 확정 고·저점 이후 종가가 채널 밖 1% 이상이면 그 봉에 점을 찍고 거래량 배수를 붙인다.
 * - 박스권: 최근 횡보 구간(고저 폭 상한·상하단 각 2회 이상 터치·방향성 작음)의 상·하단 띠와 지속 봉 수,
 *   이탈 봉(종가가 띠 밖 1% 이상)의 거래량 배수.
 * 매수·매도 신호가 아니라 과거 가격이 만든 구조를 보여 주는 참고선이다.
 */
(function (global) {
  'use strict';
  var UP_COLOR = '210,79,69';      // 상승 빨강
  var DOWN_COLOR = '18,97,196';    // 하락 파랑
  var BOX_COLOR = '110,92,170';
  var BREAK_PCT = 0.01;            // 종가가 선·띠에서 1% 이상 벗어나야 돌파·이탈
  var MAX_PHASES = 6;              // 화면에는 최근 구간 6개까지

  function profile(options) {
    var tf = options && options.timeframe;
    if (tf === 'week') return { zig: 0.15, maxBars: 260, boxRange: 0.30, boxMin: 10, boxMax: 80, unit: '주' };
    if (tf === 'month') return { zig: 0.20, maxBars: 260, boxRange: 0.30, boxMin: 10, boxMax: 80, unit: '개월' };
    if (tf === 'minute') return { zig: 0.012, maxBars: 400, boxRange: 0.04, boxMin: 30, boxMax: 200, unit: '봉' };
    return { zig: 0.10, maxBars: 1300, boxRange: 0.20, boxMin: 15, boxMax: 160, unit: '일' };
  }

  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }

  function volMultiple(arr, i) {
    var sum = 0, n = 0;
    for (var j = Math.max(0, i - 20); j < i; j++) {
      var v = num(arr[j].volume);
      if (v != null) { sum += v; n++; }
    }
    var vol = num(arr[i].volume);
    if (!n || sum <= 0 || vol == null) return null;
    return vol / (sum / n);
  }

  // 지그재그: 반대 방향으로 th(비율) 이상 되돌린 뒤에야 직전 극점을 고점·저점으로 확정한다. 마지막 미확정 다리는 포함하지 않는다.
  function zigzag(arr, th) {
    var piv = [], dir = 0, hi = -Infinity, hiI = -1, lo = Infinity, loI = -1;
    for (var i = 0; i < arr.length; i++) {
      var h = num(arr[i].high), l = num(arr[i].low);
      if (h == null || l == null) continue;
      if (dir === 0) {
        if (h > hi) { hi = h; hiI = i; }
        if (l < lo) { lo = l; loI = i; }
        if (hiI > loI && (hi - lo) / lo >= th) { piv.push({ i: loI, p: lo, type: 'L' }); dir = 1; }
        else if (loI > hiI && (hi - lo) / hi >= th) { piv.push({ i: hiI, p: hi, type: 'H' }); dir = -1; }
      } else if (dir === 1) {
        if (h > hi) { hi = h; hiI = i; }
        else if ((hi - l) / hi >= th) { piv.push({ i: hiI, p: hi, type: 'H' }); dir = -1; lo = l; loI = i; }
      } else {
        if (l < lo) { lo = l; loI = i; }
        else if ((h - lo) / lo >= th) { piv.push({ i: loI, p: lo, type: 'L' }); dir = 1; hi = h; hiI = i; }
      }
    }
    return piv;
  }

  function regressionSlope(points) {
    var n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    points.forEach(function (q) { sx += q.i; sy += q.p; sxx += q.i * q.i; sxy += q.i * q.p; });
    var d = n * sxx - sx * sx;
    return d === 0 ? 0 : (n * sxy - sx * sy) / d;
  }

  // 구간 하나의 평행 채널: 두 회귀 기울기의 평균을 공통 기울기로 하고, 아래선은 모든 저점 아래·위선은 모든 고점 위를 지난다.
  function buildPhase(pivots, up) {
    var lows = pivots.filter(function (q) { return q.type === 'L'; });
    var highs = pivots.filter(function (q) { return q.type === 'H'; });
    var slope = (regressionSlope(lows) + regressionSlope(highs)) / 2;
    var bLow = Infinity, bHigh = -Infinity;
    lows.forEach(function (q) { bLow = Math.min(bLow, q.p - slope * q.i); });
    highs.forEach(function (q) { bHigh = Math.max(bHigh, q.p - slope * q.i); });
    var first = pivots[0], last = pivots[pivots.length - 1];
    var pct = up
      ? (Math.max.apply(null, highs.map(function (q) { return q.p; })) / lows[0].p - 1)
      : (Math.min.apply(null, lows.map(function (q) { return q.p; })) / highs[0].p - 1);
    return { kind: up ? 'up' : 'down', start: first.i, end: last.i, slope: slope, bLow: bLow, bHigh: bHigh, pct: pct, bars: last.i - first.i + 1, pivots: pivots, events: [], active: false };
  }

  function analyzeTrend(arr, cfg) {
    var piv = zigzag(arr, cfg.zig), phases = [], i = 0;
    while (i + 3 < piv.length) {
      var win = piv.slice(i, i + 4);
      var lo = win.filter(function (q) { return q.type === 'L'; }), hi = win.filter(function (q) { return q.type === 'H'; });
      var up = lo[1].p > lo[0].p && hi[1].p > hi[0].p, down = lo[1].p < lo[0].p && hi[1].p < hi[0].p;
      if (!up && !down) { i++; continue; }
      var e = i + 3;
      while (e + 1 < piv.length) {
        var prevSame = piv[e - 1], nxt = piv[e + 1];
        if (up ? nxt.p > prevSame.p : nxt.p < prevSame.p) e++; else break;
      }
      phases.push(buildPhase(piv.slice(i, e + 1), up));
      i = e;    // 다음 구간은 이 구간의 마지막 확정점에서 이어서 찾는다
    }
    if (!phases.length) return [];
    // 마지막 구간: 끝 확정점 이후 종가가 채널을 1% 넘게 벗어났으면 처음 한 번만 점을 찍고, 아니면 마지막 봉까지 이어서 그린다.
    var cur = phases[phases.length - 1], last = arr.length - 1;
    function lowAt(x) { return cur.slope * x + cur.bLow; }
    function highAt(x) { return cur.slope * x + cur.bHigh; }
    for (var j = cur.end + 1; j <= last; j++) {
      var c = num(arr[j].close);
      if (c == null) continue;
      if (cur.kind === 'up' && c < lowAt(j) * (1 - BREAK_PCT)) { cur.events.push({ i: j, dir: 'down', label: '상승 추세 이탈', price: c, vol: volMultiple(arr, j) }); break; }
      if (cur.kind === 'down' && c > highAt(j) * (1 + BREAK_PCT)) { cur.events.push({ i: j, dir: 'up', label: '하락 추세 돌파', price: c, vol: volMultiple(arr, j) }); break; }
    }
    if (!cur.events.length) { cur.active = true; cur.end = Math.max(cur.end, last); }
    else cur.end = Math.max(cur.end, cur.events[0].i);
    // 작은 흔들림은 구간으로 보지 않는다: 오르내림 폭이 되돌림 기준의 2배(일봉 20%) 이상인 구간만 남긴다.
    return phases.filter(function (q) { return Math.abs(q.pct) >= cfg.zig * 2; }).slice(-MAX_PHASES);
  }

  function boxEndingAt(arr, end, cfg) {
    var top = -Infinity, bottom = Infinity, start = end;
    for (var s = end; s >= 0 && end - s < cfg.boxMax; s--) {
      var hi = num(arr[s].high), lo = num(arr[s].low);
      if (hi == null || lo == null) break;
      var nt = Math.max(top, hi), nb = Math.min(bottom, lo);
      if (nb <= 0 || (nt - nb) / nb > cfg.boxRange) break;
      top = nt; bottom = nb; start = s;
    }
    var n = end - start + 1;
    if (n < cfg.boxMin) return null;
    // 방향성이 큰 완만한 추세는 박스가 아니다: 처음·끝 종가 차이가 폭의 60% 이내여야 한다.
    var c0 = num(arr[start].close), c1 = num(arr[end].close);
    if (c0 == null || c1 == null || Math.abs(c1 - c0) > (top - bottom) * 0.6) return null;
    // 상단·하단 각각 서로 3봉 이상 떨어진 터치가 2회 이상(띠 위·아래 15% 안)
    var band = (top - bottom) * 0.15;
    function touches(isTop) {
      var count = 0, lastIdx = -10;
      for (var j = start; j <= end; j++) {
        var hit = isTop ? num(arr[j].high) >= top - band : num(arr[j].low) <= bottom + band;
        if (hit && j - lastIdx >= 3) { count++; lastIdx = j; }
      }
      return count;
    }
    if (touches(true) < 2 || touches(false) < 2) return null;
    return { start: start, end: end, top: top, bottom: bottom, bars: n };
  }

  function analyzeBox(arr, cfg) {
    var last = arr.length - 1;
    for (var back = 0; back <= 12 && last - back > 0; back++) {
      var end = last - back;
      var box = boxEndingAt(arr, end, cfg);
      if (!box) continue;
      var exit = null;
      for (var i = end + 1; i <= last; i++) {
        var c = num(arr[i].close);
        if (c == null) continue;
        if (c > box.top * (1 + BREAK_PCT)) { exit = { i: i, dir: 'up', price: c, vol: volMultiple(arr, i) }; break; }
        if (c < box.bottom * (1 - BREAK_PCT)) { exit = { i: i, dir: 'down', price: c, vol: volMultiple(arr, i) }; break; }
      }
      if (back > 0 && !exit) continue;   // 띠를 고저로만 벗어나고 종가는 안 벗어난 경우는 박스가 이어진 것으로 보지 않는다
      box.exit = exit;
      box.ongoing = !exit;
      return box;
    }
    return null;
  }

  function analyze(bars, options) {
    var cfg = profile(options);
    var empty = { trends: [], box: null, unit: cfg.unit, offset: 0, count: 0 };
    if (!bars || bars.length < 30) return empty;
    var offset = Math.max(0, bars.length - cfg.maxBars);
    var arr = bars.slice(offset);
    var trends = analyzeTrend(arr, cfg);
    var box = analyzeBox(arr, cfg);
    return { trends: trends, box: box, unit: cfg.unit, offset: offset, count: bars.length, bars: bars };
  }

  function fmtVol(v) { return v == null ? '' : ' · 거래량 ' + (Math.round(v * 10) / 10) + '배'; }

  function install(container, chart, series, result, formatPrice, options) {
    options = options || {};
    try { if (global.getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch (e) { /* 무시 */ }
    var canvas = document.createElement('canvas');
    canvas.className = 'ss-sr-zones ss-structure-zones';
    canvas.setAttribute('aria-hidden', 'true');
    var chartRoot = container.firstElementChild;
    if (chartRoot) chartRoot.classList.add('ss-lw-chart-root');
    container.insertBefore(canvas, chartRoot || container.firstChild);
    var frameId = 0, resizeObserver = null, settle = 0;

    function axisWidth() {
      try { var w = chart.priceScale('right').width(); if (Number.isFinite(w) && w > 0) return w; } catch (e) { /* 버전에 따라 없다 */ }
      return 58;
    }
    function draw() {
      frameId = 0;
      if (!document.body.contains(container)) return;
      var width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      var ratio = Math.max(1, global.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!result || !result.bars) return;
      var right = Math.max(0, width - axisWidth());
      var bars = result.bars, off = result.offset;
      var ts = chart.timeScale();
      function barX(i) { var b = bars[i + off]; if (!b) return null; var x = ts.timeToCoordinate(b.time != null ? b.time : b.date); return Number.isFinite(x) ? x : null; }
      var lastIdx = bars.length - 1 - off;
      var xl = barX(lastIdx), xp = barX(lastIdx - 1);
      var spacing = xl != null && xp != null && xl > xp ? xl - xp : null;
      // 마지막 봉 오른쪽(빈 영역)까지 선을 늘리기 위한 인덱스 -> x 변환
      function xAt(i) {
        var x = barX(i);
        if (x != null) return x;
        if (i > lastIdx && xl != null && spacing) return xl + (i - lastIdx) * spacing;
        return null;
      }
      var rightIdx = xl != null && spacing ? lastIdx + Math.max(0, (right - xl) / spacing) : lastIdx;
      ctx.font = '600 11px Pretendard, "Malgun Gothic", sans-serif';
      ctx.textBaseline = 'middle';
      var dark = document.documentElement.classList.contains('dark');

      function label(text, x, y, rgb, align) {
        var w = ctx.measureText(text).width + 12;
        var left = align === 'right' ? x - w : x;
        left = Math.max(2, Math.min(right - w - 2, left));
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(left, y - 9, w, 18, 9); else ctx.rect(left, y - 9, w, 18);
        ctx.fillStyle = dark ? 'rgba(26,26,26,.94)' : 'rgba(255,254,252,.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(' + rgb + ',.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(' + rgb + ',1)';
        ctx.fillText(text, left + 6, y + 0.5);
      }
      function dot(x, y, dir, text) {
        var rgb = dir === 'up' ? '210,79,69' : '18,97,196';   // 상승(돌파) 빨강, 하락(이탈) 파랑
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + rgb + ',1)';
        ctx.fill();
        ctx.strokeStyle = dark ? '#111' : '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        label(text, x + 8, y + (dir === 'up' ? -16 : 16), rgb, 'left');
      }

      var box = result.box;
      if (box) {
        var x1 = xAt(box.start), x2 = box.exit ? xAt(box.exit.i) : rightIdx != null ? xAt(rightIdx) : null;
        if (x2 == null) x2 = right;
        var yTop = series.priceToCoordinate(box.top), yBottom = series.priceToCoordinate(box.bottom);
        if (x1 != null && Number.isFinite(yTop) && Number.isFinite(yBottom)) {
          var bl = Math.max(0, x1), br = Math.min(right, x2);
          if (br > bl) {
            ctx.fillStyle = 'rgba(' + BOX_COLOR + ',.09)';
            ctx.fillRect(bl, Math.min(yTop, yBottom), br - bl, Math.abs(yBottom - yTop));
            ctx.strokeStyle = 'rgba(' + BOX_COLOR + ',.75)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(bl + 0.5, Math.min(yTop, yBottom) + 0.5, br - bl, Math.abs(yBottom - yTop));
            ctx.setLineDash([]);
            var text = '박스 ' + box.bars + result.unit + (box.ongoing ? ' 진행' : '') + ' ' + formatPrice(box.bottom) + '~' + formatPrice(box.top);
            label(text, bl + 6, Math.max(26, Math.min(yTop, yBottom) + 14), BOX_COLOR, 'left');   // 상단 범례와 겹치지 않게 박스 안쪽 위
          }
          if (box.exit) {
            var ex = xAt(box.exit.i), ey = series.priceToCoordinate(box.exit.price);
            if (ex != null && Number.isFinite(ey) && ex >= 0 && ex <= right) dot(ex, ey, box.exit.dir, (box.exit.dir === 'up' ? '박스 상단 돌파' : '박스 하단 이탈') + fmtVol(box.exit.vol));
          }
        }
      }

      // 추세 구간별 평행 채널: 구간의 첫 확정점부터 끝 확정점(현재 구간이 이어지면 마지막 봉)까지만 그린다.
      (result.trends || []).forEach(function (ph) {
        var rgb = ph.kind === 'up' ? UP_COLOR : DOWN_COLOR;
        var x1 = xAt(ph.start), x2 = xAt(ph.end);
        if (x1 == null || x2 == null || x2 < 0 || x1 > right) return;
        function yAt(i, base) { return series.priceToCoordinate(ph.slope * i + base); }
        var lo1 = yAt(ph.start, ph.bLow), lo2 = yAt(ph.end, ph.bLow), up1 = yAt(ph.start, ph.bHigh), up2 = yAt(ph.end, ph.bHigh);
        if (![lo1, lo2, up1, up2].every(Number.isFinite)) return;
        ctx.beginPath();
        ctx.moveTo(x1, up1); ctx.lineTo(x2, up2); ctx.lineTo(x2, lo2); ctx.lineTo(x1, lo1); ctx.closePath();
        ctx.fillStyle = 'rgba(' + rgb + ',' + (ph.active ? '.10' : '.06') + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(' + rgb + ',.9)';
        ctx.lineWidth = ph.active ? 1.8 : 1.4;
        ctx.beginPath(); ctx.moveTo(x1, up1); ctx.lineTo(x2, up2); ctx.moveTo(x1, lo1); ctx.lineTo(x2, lo2); ctx.stroke();
        // 선 끝점 표시(구간의 시작·끝)
        [[x1, up1], [x2, up2], [x1, lo1], [x2, lo2]].forEach(function (pt) {
          ctx.beginPath(); ctx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
          ctx.fillStyle = dark ? '#1a1a1a' : '#fff'; ctx.fill();
          ctx.strokeStyle = 'rgba(' + rgb + ',1)'; ctx.lineWidth = 1.5; ctx.stroke();
        });
        var pctText = (ph.pct >= 0 ? '+' : '') + Math.round(ph.pct * 100) + '%';
        var text = (ph.kind === 'up' ? '상승 추세 ' : '하락 추세 ') + pctText + ' · ' + ph.bars + result.unit + (ph.active ? ' 진행' : '');
        var ly = Math.max(12, Math.min(height - 12, (ph.kind === 'up' ? up1 : up1) - 14));
        label(text, Math.max(4, Math.min(right - 4, x1)), ly, rgb, 'left');
        ph.events.forEach(function (ev) {
          var px = xAt(ev.i), py = series.priceToCoordinate(ev.price);
          if (px == null || !Number.isFinite(py) || px < 0 || px > right) return;
          dot(px, py, ev.dir, ev.label + fmtVol(ev.vol));
        });
      });
    }
    function schedule() {
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = global.requestAnimationFrame(draw);
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    if ('ResizeObserver' in global) { resizeObserver = new ResizeObserver(schedule); resizeObserver.observe(container); }
    else global.addEventListener('resize', schedule);
    schedule();
    settle = global.setTimeout(schedule, 250);   // 가격축 범위는 시간축 이동 없이 바뀌므로 한 번 더 그린다
    function cleanup() {
      if (frameId) global.cancelAnimationFrame(frameId);
      global.clearTimeout(settle);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule); } catch (e) { /* 차트가 이미 제거됨 */ }
      if (resizeObserver) resizeObserver.disconnect(); else global.removeEventListener('resize', schedule);
      canvas.remove();
    }
    cleanup.update = function (next) { result = next; schedule(); };
    return cleanup;
  }

  // 범례용 한 줄 요약(없으면 빈 문자열)
  function summary(result) {
    if (!result) return '';
    var parts = [];
    var ph = result.trends && result.trends.length ? result.trends[result.trends.length - 1] : null;
    if (ph) parts.push((ph.kind === 'up' ? '상승' : '하락') + ' 추세 ' + (ph.pct >= 0 ? '+' : '') + Math.round(ph.pct * 100) + '%' + (ph.active ? ' 진행' : ' 종료'));
    if (result.box) parts.push('박스 ' + result.box.bars + result.unit + (result.box.ongoing ? ' 진행' : ' 이탈'));
    return parts.length ? parts.join(' / ') : '<b>해당 없음</b>';
  }

  global.NineChartStructure = { analyze: analyze, install: install, summary: summary };
})(typeof window !== 'undefined' ? window : globalThis);
