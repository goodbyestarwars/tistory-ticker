/**
 * 추세선·채널·박스권 공용 모듈(2026-10-21). 차트검색(stock-search.js)과 종목분석(foreign-flow.js)이 같이 쓴다.
 * 사용: var r = NineChartStructure.analyze(bars, { timeframe });
 *       NineChartStructure.install(container, chart, series, r, formatPrice, opts) -> 정리 함수(.update(nextResult))
 *       (bars: [{date, open, high, low, close, volume}] 오름차순, date 가 시리즈 time 과 같다.)
 *
 * - 추세선·채널: 스윙 저점끼리(상승) 또는 스윙 고점끼리(하락) 이은 선과 그 평행선. 스윙은 좌우 k봉이 확인된 뒤에만
 *   쓰므로(미래 봉 비참조) 돌파·이탈 점은 선이 확정된 다음 봉부터만 찍는다.
 * - 박스권: 최근 횡보 구간(고저 폭 상한·상하단 각 2회 이상 터치·방향성 작음)의 상·하단 띠와 지속 봉 수,
 *   이탈 봉(종가가 띠 밖 1% 이상)의 거래량 배수.
 * 매수·매도 신호가 아니라 과거 가격이 만든 구조를 보여 주는 참고선이다.
 */
(function (global) {
  'use strict';
  var TREND_COLOR = '176,112,0';
  var BOX_COLOR = '110,92,170';
  var MIN_ANCHOR_GAP = 8;        // 선을 긋는 두 스윙 사이 최소 봉 수
  var BREAK_PCT = 0.01;          // 종가가 선·띠에서 1% 이상 벗어나야 돌파·이탈
  var MIN_SLOPE_PCT = 0.03;      // 두 스윙 가격 차이가 3% 미만이면 추세선으로 보지 않는다
  var MIN_CHANNEL_PCT = 0.03;    // 채널 폭이 현재가의 3% 미만이면 선만 보여 준다

  function profile(options) {
    var tf = options && options.timeframe;
    if (tf === 'week' || tf === 'month') return { k: 4, maxBars: 260, boxRange: 0.25, boxMin: 10, boxMax: 80, unit: tf === 'week' ? '주' : '개월' };
    if (tf === 'minute') return { k: 5, maxBars: 400, boxRange: 0.04, boxMin: 30, boxMax: 200, unit: '봉' };
    return { k: 6, maxBars: 300, boxRange: 0.15, boxMin: 15, boxMax: 160, unit: '일' };
  }

  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }

  // 좌우 k봉보다 높거나(낮은) 확정된 스윙. 마지막 k봉은 아직 확정되지 않아 제외한다.
  function swings(arr, k) {
    var highs = [], lows = [];
    for (var i = k; i < arr.length - k; i++) {
      var hi = num(arr[i].high), lo = num(arr[i].low);
      if (hi == null || lo == null) continue;
      var isHigh = true, isLow = true, strictHigh = false, strictLow = false;
      for (var j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        var jh = num(arr[j].high), jl = num(arr[j].low);
        if (jh == null || jl == null) { isHigh = false; isLow = false; break; }
        if (jh > hi) isHigh = false; else if (jh < hi) strictHigh = true;
        if (jl < lo) isLow = false; else if (jl > lo) strictLow = true;
      }
      if (isHigh && strictHigh) highs.push({ i: i, price: hi });
      if (isLow && strictLow) lows.push({ i: i, price: lo });
    }
    return { highs: highs, lows: lows };
  }

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

  // 가장 최근의 "오르는 저점 두 개" 또는 "내리는 고점 두 개"로 선을 만든다. 두 스윙 사이에서 종가가 선을 1% 넘게 깨면 버린다.
  function pickLine(points, rising, arr) {
    for (var b = points.length - 1; b >= 1; b--) {
      for (var a = b - 1; a >= 0 && b - a <= 3; a--) {
        var p1 = points[a], p2 = points[b];
        if (p2.i - p1.i < MIN_ANCHOR_GAP) continue;
        if (rising ? p2.price <= p1.price : p2.price >= p1.price) continue;
        if (Math.abs(p2.price - p1.price) / p1.price < MIN_SLOPE_PCT) continue;   // 거의 수평이면 추세선이 아니라 박스·지지저항
        var slope = (p2.price - p1.price) / (p2.i - p1.i);
        var ok = true;
        for (var j = p1.i; j <= p2.i; j++) {
          var line = p1.price + slope * (j - p1.i);
          var c = num(arr[j].close);
          if (c == null) continue;
          if (rising ? c < line * (1 - BREAK_PCT) : c > line * (1 + BREAK_PCT)) { ok = false; break; }
        }
        if (ok) return { i1: p1.i, p1: p1.price, i2: p2.i, p2: p2.price, slope: slope };
      }
    }
    return null;
  }

  function analyzeTrend(arr, cfg) {
    var sw = swings(arr, cfg.k);
    var up = pickLine(sw.lows, true, arr);
    var down = pickLine(sw.highs, false, arr);
    var base = null, kind = null;
    if (up && down) { if (up.i2 >= down.i2) { base = up; kind = 'up'; } else { base = down; kind = 'down'; } }
    else if (up) { base = up; kind = 'up'; }
    else if (down) { base = down; kind = 'down'; }
    if (!base) return null;
    var last = arr.length - 1;
    function lineAt(i) { return base.p1 + base.slope * (i - base.i1); }
    // 평행선: 상승 추세선은 구간 안 최고 고가까지, 하락 추세선은 최저 저가까지 같은 기울기로 옮긴다.
    var offset = 0;
    for (var j = base.i1; j <= last; j++) {
      var d = kind === 'up' ? num(arr[j].high) - lineAt(j) : num(arr[j].low) - lineAt(j);
      if (!Number.isFinite(d)) continue;
      if (kind === 'up' ? d > offset : d < offset) offset = d;
    }
    var lastClose = num(arr[last].close) || base.p2;
    var channel = Math.abs(offset) / lastClose >= MIN_CHANNEL_PCT;
    var events = [];
    var confirmed = base.i2 + cfg.k;      // 두 번째 스윙이 확인된 봉 - 이 뒤에만 돌파·이탈을 찍는다
    var lineBreak = false, topBreak = false;
    for (var i = confirmed + 1; i <= last; i++) {
      var c = num(arr[i].close);
      if (c == null) continue;
      var v = lineAt(i);
      if (!lineBreak) {
        if (kind === 'up' && c < v * (1 - BREAK_PCT)) { events.push({ i: i, dir: 'down', label: '추세선 이탈', price: c, vol: volMultiple(arr, i) }); lineBreak = true; }
        if (kind === 'down' && c > v * (1 + BREAK_PCT)) { events.push({ i: i, dir: 'up', label: '추세선 돌파', price: c, vol: volMultiple(arr, i) }); lineBreak = true; }
      }
      if (channel && !topBreak) {
        var edge = v + offset;
        if (kind === 'up' && c > edge * (1 + BREAK_PCT)) { events.push({ i: i, dir: 'up', label: '채널 상단 돌파', price: c, vol: volMultiple(arr, i) }); topBreak = true; }
        if (kind === 'down' && c < edge * (1 - BREAK_PCT)) { events.push({ i: i, dir: 'down', label: '채널 하단 이탈', price: c, vol: volMultiple(arr, i) }); topBreak = true; }
      }
    }
    return { kind: kind, base: base, offset: offset, channel: channel, events: events, last: last };
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
    var empty = { trend: null, box: null, unit: cfg.unit, offset: 0, count: 0 };
    if (!bars || bars.length < cfg.k * 2 + 12) return empty;
    var offset = Math.max(0, bars.length - cfg.maxBars);
    var arr = bars.slice(offset);
    var trend = analyzeTrend(arr, cfg);
    var box = analyzeBox(arr, cfg);
    return { trend: trend, box: box, unit: cfg.unit, offset: offset, count: bars.length, bars: bars };
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

      var trend = result.trend;
      if (trend) {
        var b = trend.base;
        function lineY(i, add) { return series.priceToCoordinate(b.p1 + b.slope * (i - b.i1) + (add || 0)); }
        var xs = xAt(b.i1), xe = rightIdx != null ? xAt(rightIdx) : null;
        var ys = lineY(b.i1), ye = lineY(rightIdx);
        if (xs != null && xe != null && Number.isFinite(ys) && Number.isFinite(ye)) {
          if (trend.channel) {
            var ys2 = lineY(b.i1, trend.offset), ye2 = lineY(rightIdx, trend.offset);
            if (Number.isFinite(ys2) && Number.isFinite(ye2)) {
              ctx.beginPath();
              ctx.moveTo(xs, ys); ctx.lineTo(xe, ye); ctx.lineTo(xe, ye2); ctx.lineTo(xs, ys2); ctx.closePath();
              ctx.fillStyle = 'rgba(' + TREND_COLOR + ',.07)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(' + TREND_COLOR + ',.6)';
              ctx.lineWidth = 1;
              ctx.setLineDash([6, 4]);
              ctx.beginPath(); ctx.moveTo(xs, ys2); ctx.lineTo(xe, ye2); ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          ctx.strokeStyle = 'rgba(' + TREND_COLOR + ',.95)';
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(xs, ys); ctx.lineTo(xe, ye); ctx.stroke();
          // 선을 정한 두 스윙에 작은 원
          [[b.i1, b.p1], [b.i2, b.p2]].forEach(function (pt) {
            var px = xAt(pt[0]), py = series.priceToCoordinate(pt[1]);
            if (px == null || !Number.isFinite(py)) return;
            ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = dark ? '#1a1a1a' : '#fff'; ctx.fill();
            ctx.strokeStyle = 'rgba(' + TREND_COLOR + ',1)'; ctx.lineWidth = 1.5; ctx.stroke();
          });
          var tx = Math.max(4, Math.min(right - 4, xe - 10));
          label((trend.kind === 'up' ? '상승 추세선' : '하락 추세선') + (trend.channel ? '·채널' : ''), tx, Math.max(12, Math.min(height - 12, ye + (trend.kind === 'up' ? 14 : -14))), TREND_COLOR, 'right');
        }
        trend.events.forEach(function (ev) {
          var px = xAt(ev.i), py = series.priceToCoordinate(ev.price);
          if (px == null || !Number.isFinite(py) || px < 0 || px > right) return;
          dot(px, py, ev.dir, ev.label + fmtVol(ev.vol));
        });
      }
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
    if (result.trend) parts.push((result.trend.kind === 'up' ? '상승' : '하락') + ' 추세선' + (result.trend.channel ? '·채널' : ''));
    if (result.box) parts.push('박스 ' + result.box.bars + result.unit + (result.box.ongoing ? ' 진행' : ' 이탈'));
    return parts.length ? parts.join(' / ') : '<b>해당 없음</b>';
  }

  global.NineChartStructure = { analyze: analyze, install: install, summary: summary, _swings: swings };
})(typeof window !== 'undefined' ? window : globalThis);
