/**
 * 차트 오버레이 층 + 수동 드로잉 공통 모듈(2026-10-14) - 차트검색·실시간 시세(stock-search.js)와 종목분석(foreign-flow.js)이 같이 쓴다.
 *
 * 한 화면의 차트마다 캔버스 층 하나를 만들고, 그 위에 (1) 다른 모듈이 등록한 아래층(자동 파동 등, addLayer)과
 * (2) 사용자가 그린 도형(직선·동그라미·박스·가로선·연필)을 같은 좌표 변환·같은 다시 그리기 일정으로 그린다.
 * 화면 차이는 옵션으로 둔다: 캔버스 범위(전체/가격 패널), 좌표 방식(logical 앵커/시간·가격), 저장 키·종류, 계정 저장 여부, 색.
 *
 *   var ctl = NineChartDrawing.attach({ core, container, chart, series, bars, key, timeframe, className, bounds, point, tools, buttons, store, style, sync });
 *   ctl.addLayer('wave', function (ctx, view) { ... view.coord({time, price}) ... });
 *   ctl.detach();   // 이벤트·옵저버·구독·캔버스·프리미티브를 모두 해제(저장된 도형 데이터는 지우지 않는다)
 */
(function (global) {
  'use strict';

  var DRAWING_API_URL = 'https://goodbyestar.cloud/chart-drawings';
  var DRAWING_AUTH_URL = 'https://goodbyestar.cloud/auth/google/me';
  var DRAWING_PUSH_DELAY_MS = 1500;
  var DRAWING_MAX_PATH_POINTS = 120;
  var ALL_KINDS = ['lines', 'paths', 'circles', 'hlines', 'boxes'];
  var MODES = ['line', 'pencil', 'circle', 'box', 'hline', 'measure'];

  // ---- 계정 저장(2026-10-10 "로그인 기반으로 저장") ----
  // 로그인(Google)하면 종목·봉 주기별로 서버(GET/PUT /chart-drawings)에도 저장하고, 아니면 브라우저에만 둔다. 브라우저 저장은 항상 먼저 쓰는 캐시다.
  // 차트를 열 때 서버에 값이 있으면 서버 값을 쓰고, 없고 이 브라우저에만 있으면 한 번 올린다. 저장은 1.5초 묶음 1회, 연필 선은 점을 솎아 올린다.
  var drawingSync = { authPromise: null, revisions: {}, timers: {}, pending: {} };

  function drawingAuth() {
    if (!drawingSync.authPromise && typeof fetch !== 'function') drawingSync.authPromise = Promise.resolve(false);
    if (!drawingSync.authPromise) {
      drawingSync.authPromise = fetch(DRAWING_AUTH_URL, { credentials: 'include', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (body) { var a = body && body.data ? body.data : {}; return !!(a.configured && a.authenticated); })
        .catch(function () { return false; });
    }
    return drawingSync.authPromise;
  }

  function drawingSyncKey(d) { return String(d.key || '') + '|' + String(d.timeframe || 'day'); }
  function drawingSyncable(d) { return !!d && d.sync !== false && d.timeframe !== 'minute' && /^[A-Za-z0-9._-]{1,20}$/.test(String(d.key || '')); }

  function thinDrawingPath(path) {
    if (!Array.isArray(path) || path.length <= DRAWING_MAX_PATH_POINTS) return path;
    var out = [], step = (path.length - 1) / (DRAWING_MAX_PATH_POINTS - 1);
    for (var i = 0; i < DRAWING_MAX_PATH_POINTS; i++) out.push(path[Math.round(i * step)]);
    return out;
  }

  function drawingsPayload(d) {
    return {
      lines: d.lines || [],
      paths: (d.paths || []).map(thinDrawingPath),
      circles: d.circles || [],
      hlines: (d.hlines || []).map(function (item) { return { price: item.price }; }),
      boxes: d.boxes || []
    };
  }

  function drawingsHaveShapes(payload) {
    return ALL_KINDS.some(function (kind) { return payload[kind] && payload[kind].length; });
  }

  function pushDrawings(d, keepalive, retried) {
    var key = drawingSyncKey(d);
    return fetch(DRAWING_API_URL, {
      method: 'PUT', credentials: 'include', keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: d.key, timeframe: d.timeframe, drawings: drawingsPayload(d), revision: drawingSync.revisions[key] || 0 })
    }).then(function (response) {
      if (response.status === 409 && !retried) {
        // 다른 기기가 먼저 바꿨다: 최신 revision만 받아 이 화면의 현재 상태로 한 번 더 덮어쓴다(마지막 저장 우선).
        return fetch(DRAWING_API_URL + '?code=' + encodeURIComponent(d.key) + '&timeframe=' + encodeURIComponent(d.timeframe), { credentials: 'include', cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (body) { var x = body && body.data ? body.data : body; drawingSync.revisions[key] = x.revision || 0; return pushDrawings(d, keepalive, true); });
      }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json().then(function (body) { var x = body && body.data ? body.data : body; drawingSync.revisions[key] = x.revision || 0; });
    }).catch(function () { /* 서버 저장 실패는 조용히 넘어간다 - 브라우저 저장본이 남아 있다 */ });
  }

  function scheduleDrawingPush(d) {
    if (!drawingSyncable(d) || typeof global.setTimeout !== 'function') return;
    var key = drawingSyncKey(d);
    drawingSync.pending[key] = d;
    if (drawingSync.timers[key]) global.clearTimeout(drawingSync.timers[key]);
    drawingSync.timers[key] = global.setTimeout(function () {
      delete drawingSync.timers[key];
      var target = drawingSync.pending[key];
      delete drawingSync.pending[key];
      if (target) drawingAuth().then(function (auth) { if (auth) pushDrawings(target, false); });
    }, DRAWING_PUSH_DELAY_MS);
  }

  function flushPendingDrawings() {
    Object.keys(drawingSync.pending).forEach(function (key) {
      var target = drawingSync.pending[key];
      delete drawingSync.pending[key];
      if (drawingSync.timers[key]) { global.clearTimeout(drawingSync.timers[key]); delete drawingSync.timers[key]; }
      if (target && drawingSync.authPromise) pushDrawings(target, true);
    });
  }
  if (typeof global.addEventListener === 'function') global.addEventListener('pagehide', flushPendingDrawings);

  // current: 이 도형 묶음이 아직 화면에 붙어 있는 컨트롤러인지 확인하는 함수(그 사이 종목·주기가 바뀌면 늦게 온 응답을 버린다)
  function pullDrawings(d, isCurrent, applied) {
    if (!drawingSyncable(d)) return;
    drawingAuth().then(function (auth) {
      if (!auth) return null;
      return fetch(DRAWING_API_URL + '?code=' + encodeURIComponent(d.key) + '&timeframe=' + encodeURIComponent(d.timeframe), { credentials: 'include', cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (body) {
          var x = body && body.data ? body.data : body;
          drawingSync.revisions[drawingSyncKey(d)] = x.revision || 0;
          if (isCurrent && !isCurrent()) return;
          if (x.drawings) {
            d.lines = x.drawings.lines || [];
            d.paths = x.drawings.paths || [];
            d.circles = x.drawings.circles || [];
            d.hlines = x.drawings.hlines || [];
            d.boxes = x.drawings.boxes || [];
            if (applied) applied();
          } else if (drawingsHaveShapes(drawingsPayload(d))) {
            pushDrawings(d, false);                          // 이 브라우저에만 있던 도형을 계정으로 한 번 옮긴다
          }
        });
    }).catch(function () { /* 서버를 못 불러와도 브라우저 저장본으로 계속 동작 */ });
  }

  // ---- 브라우저 저장 ----
  // store: { key(code, tf) -> 문자열, kinds: 저장할 종류, legacyArray: 예전 추세선 배열 형식도 읽는다 }
  function emptyShapes() { return { lines: [], paths: [], circles: [], hlines: [], boxes: [] }; }

  function loadShapes(store, key, timeframe) {
    var out = emptyShapes();
    try {
      var raw = global.localStorage.getItem(store.key(key, timeframe));
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) { if (store.legacyArray) out.lines = parsed; return out; }   // 기존 추세선 배열 저장값도 그대로 복원한다
      ALL_KINDS.forEach(function (kind) { out[kind] = Array.isArray(parsed && parsed[kind]) ? parsed[kind] : []; });
      return out;
    } catch (e) { return emptyShapes(); }
  }

  function writeShapesLocal(store, d) {
    try {
      var out = {};
      (store.kinds || ALL_KINDS).forEach(function (kind) {
        out[kind] = kind === 'hlines' ? (d.hlines || []).map(function (item) { return { price: item.price }; }) : (d[kind] || []);
      });
      global.localStorage.setItem(store.key(d.key, d.timeframe), JSON.stringify(out));
    } catch (e) { /* localStorage를 사용할 수 없는 환경에서도 차트는 계속 동작 */ }
  }

  // ---- 좌표 변환 ----
  // anchored(차트검색): 시간 + logical 위치 + 마지막 봉 기준 오프셋을 같이 저장해, 마지막 봉 오른쪽 빈 공간에도 도형을 둘 수 있고 확대·과거 이동을 따라간다.
  // timePrice(종목분석): 시간 + 가격만 저장한다(저장 형식이 예전과 같다).
  function anchoredFromXY(d, x, y) {
    var scale = d.chart.timeScale();
    var time = scale.coordinateToTime(x);
    var logical = scale.coordinateToLogical(x);
    var price = d.series.coordinateToPrice(y);
    if (price == null || !isFinite(Number(price)) || (time == null && logical == null)) return null;
    var point = { time: time, price: Number(price) };
    if (logical != null && isFinite(Number(logical))) {
      point.logical = Number(logical);
      var bars = d.bars || [];
      var anchorTime = bars.length ? bars[bars.length - 1].date : time;
      var anchorX = anchorTime == null ? null : scale.timeToCoordinate(anchorTime);
      var anchorLogical = anchorX == null ? null : scale.coordinateToLogical(anchorX);
      if (anchorLogical != null) {
        point.anchorTime = anchorTime;
        point.logicalOffset = point.logical - Number(anchorLogical);
      }
    }
    return point;
  }

  function anchoredToXY(d, point) {
    if (!point) return null;
    var scale = d.chart.timeScale();
    var logical = point.logical;
    if (point.anchorTime != null && point.logicalOffset != null) {
      var anchorX = scale.timeToCoordinate(point.anchorTime);
      var anchorLogical = anchorX == null ? null : scale.coordinateToLogical(anchorX);
      if (anchorLogical != null) logical = Number(anchorLogical) + Number(point.logicalOffset);
    }
    var x = logical != null ? scale.logicalToCoordinate(logical) : scale.timeToCoordinate(point.time);
    var y = d.series.priceToCoordinate(point.price);
    return x == null || y == null ? null : { x: Number(x), y: Number(y) };
  }

  function timePriceFromXY(d, x, y) {
    var time = d.chart.timeScale().coordinateToTime(x), price = d.series.coordinateToPrice(y);
    return time == null || price == null || !isFinite(price) ? null : { time: time, price: Number(price) };
  }

  function timePriceToXY(d, point) {
    if (!point) return null;
    var x = d.chart.timeScale().timeToCoordinate(point.time), y = d.series.priceToCoordinate(point.price);
    return x == null || y == null || !isFinite(x) || !isFinite(y) ? null : { x: x, y: y };
  }

  var DEFAULT_TITLES = {
    hline: '점선으로 위치를 미리 보고 클릭하면 가로선이 완성됩니다. 선을 끌면 이동하고 금액 표시를 누르면 직접 입력할 수 있습니다.',
    box: '끌어서 박스를 그리면 이름을 입력할 수 있습니다(구조·파동 구간 표시용).',
    line: '왼쪽 시작점에서 오른쪽 끝점까지 끌면 직선이 완성됩니다.',
    circle: '왼쪽 위에서 오른쪽 아래로 끌면 동그라미가 완성됩니다.',
    pencil: '누른 채로 움직여 자유롭게 그립니다.',
    measure: '고점에서 저점(또는 저점에서 고점)까지 끌면 가격 변화율(%)·가격 차이·봉 수를 보여 줍니다. 봉의 고가·저가 가까이에서 시작·끝내면 그 값에 붙습니다. 지우기를 누르면 사라집니다.'
  };

  // ---- 측정 도구(2026-10-19): 두 점 사이의 가격 변화율 ----
  // 변화율 = (끝 가격 / 시작 가격 - 1) x 100. 시작=고점, 끝=저점이면 음수(하락률)다. 저장하지 않는 임시 표시다.
  function measureMetrics(start, end) {
    if (!start || !end || !(start.price > 0) || !(end.price > 0)) return null;
    var bars = start.logical != null && end.logical != null ? Math.round(Math.abs(end.logical - start.logical)) : null;
    return { pct: (end.price / start.price - 1) * 100, diff: end.price - start.price, bars: bars };
  }

  function measurePriceText(price) {
    var abs = Math.abs(price);
    return abs >= 1000 ? global.NineUI.number(price, {round:true}) : String(Math.round(price * 100) / 100);
  }

  function measureLabelLines(m, start, end) {
    var sign = m.pct >= 0 ? '+' : '-';
    var lines = [sign + Math.abs(m.pct).toFixed(2) + '%', measurePriceText(start.price) + ' → ' + measurePriceText(end.price) + ' (' + (m.diff >= 0 ? '+' : '-') + measurePriceText(Math.abs(m.diff)) + ')'];
    if (m.bars != null) lines.push(m.bars + '봉');
    return lines;
  }

  // 포인터가 봉의 고가·저가 근처(px 이내)이면 그 가격으로 붙인다. 봉을 못 찾거나 멀면 그대로 둔다.
  function snapToBarExtreme(d, point, y, tolerancePx) {
    if (!point || !d.bars || !d.bars.length) return point;
    var bar = null;
    if (point.logical != null) bar = d.bars[Math.round(point.logical)];
    if (!bar && point.time != null) { for (var i = d.bars.length - 1; i >= 0; i--) { if (d.bars[i].date === point.time) { bar = d.bars[i]; break; } } }
    if (!bar) return point;
    var yh = d.series.priceToCoordinate(bar.high), yl = d.series.priceToCoordinate(bar.low);
    var tol = tolerancePx || 14, price = null;
    if (yh != null && Math.abs(yh - y) <= tol && (yl == null || Math.abs(yh - y) <= Math.abs(yl - y))) price = bar.high;
    else if (yl != null && Math.abs(yl - y) <= tol) price = bar.low;
    return price == null ? point : Object.assign({}, point, { price: Number(price) });
  }

  function attach(opts) {
    var core = opts.core || global.NineChartCore;
    var container = opts.container, chart = opts.chart, series = opts.series;
    var anchored = opts.point !== 'timePrice';
    var fromXY = anchored ? anchoredFromXY : timePriceFromXY;
    var toXY = anchored ? anchoredToXY : timePriceToXY;
    var tools = opts.tools || MODES;
    var style = Object.assign({ stroke: '#e11d48', dots: true, previewDash: true }, opts.style || {});
    var store = opts.store;
    var scope = core.createScope('drawing');
    var saved = loadShapes(store, opts.key, opts.timeframe);

    var d = {
      key: opts.key, timeframe: opts.timeframe, chart: chart, series: series, bars: opts.bars || [],
      sync: opts.sync === true,
      lines: saved.lines, paths: saved.paths, circles: saved.circles, hlines: saved.hlines, boxes: saved.boxes,
      pending: null, preview: null, activePath: null, mode: null, enabled: false, dragHline: null, hlinePreview: null, hlineDraft: null, measure: null
    };
    var detached = false, frame = 0, lastSig = '', layers = [], bounds = { w: 0, h: 0 };
    var buttons = opts.buttons || {};

    var overlay = document.createElement('canvas');
    overlay.className = opts.className || 'nc-drawing-layer';
    overlay.setAttribute('aria-label', opts.ariaLabel || '차트 그리기 영역');
    if (opts.title) overlay.title = opts.title;
    container.appendChild(overlay);

    // ---- 크기 ----
    function measure() {
      if (opts.bounds === 'pricePane') {
        var panes = chart.panes ? chart.panes() : [];
        var width = chart.timeScale().width();
        var height = panes[0] && panes[0].getHeight ? panes[0].getHeight() : 0;
        return { w: width, h: height };
      }
      return { w: overlay.clientWidth, h: overlay.clientHeight };
    }

    function fitCanvas() {
      var m = measure();
      if (!(m.w > 0 && m.h > 0)) return false;
      var ratio = global.devicePixelRatio || 1;
      if (opts.bounds === 'pricePane') { overlay.style.width = m.w + 'px'; overlay.style.height = m.h + 'px'; }
      var bw = Math.max(1, Math.round(m.w * ratio)), bh = Math.max(1, Math.round(m.h * ratio));
      if (overlay.width !== bw || overlay.height !== bh) { overlay.width = bw; overlay.height = bh; }
      var ctx = overlay.getContext('2d');
      if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      bounds = m;
      return true;
    }

    // ---- 좌표 ----
    function coord(point) { return toXY(d, point); }
    function pointFromEvent(event, strict) {
      var rect = overlay.getBoundingClientRect();
      var x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (strict && (x < 0 || y < 0 || x > rect.width || y > rect.height)) return null;
      return fromXY(d, x, y);
    }

    function persist() {
      writeShapesLocal(store, d);
      if (d.sync) scheduleDrawingPush(d);
    }

    // ---- 그리기 ----
    function viewSignature() {
      var scale = chart.timeScale();
      var range = scale.getVisibleLogicalRange ? scale.getVisibleLogicalRange() : null;
      var ref = d.bars.length ? Number(d.bars[d.bars.length - 1].close) || 0 : 0;
      var y0 = series.priceToCoordinate ? series.priceToCoordinate(ref) : null;
      var y1 = series.priceToCoordinate ? series.priceToCoordinate(ref * 1.1) : null;
      return [range ? range.from + ',' + range.to : '', y0, y1, bounds.w, bounds.h].join('|');
    }

    function redraw() {
      if (detached || !overlay) return;
      if (overlay.isConnected === false) return;
      if (!fitCanvas()) return;
      var ctx = overlay.getContext('2d');
      if (!ctx) return;
      var width = bounds.w, height = bounds.h;
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      var view = { width: width, height: height, plotWidth: chart.timeScale().width ? chart.timeScale().width() : width, bars: d.bars, coord: coord, overlay: overlay, series: series, chart: chart };
      layers.forEach(function (layer) {
        try { ctx.save(); layer.draw(ctx, view); } catch (e) { /* 한 층의 오류가 도형 그리기를 막지 않게 */ } finally { ctx.restore(); }
      });
      drawShapes(ctx, width);
      lastSig = viewSignature();
    }

    // 같은 시야면 다시 그리지 않는다(십자선 이동 같은 화면 갱신마다 오는 알림을 걸러 낸다)
    function schedule(force) {
      if (detached) return;
      if (!force && lastSig && viewSignature() === lastSig) return;
      if (frame) return;
      frame = global.requestAnimationFrame(function () { frame = 0; redraw(); });
    }

    function strokePath(ctx, points, color, width) {
      var started = false;
      ctx.beginPath();
      points.forEach(function (point) {
        var c = coord(point);
        if (!c) return;
        if (!started) { ctx.moveTo(c.x, c.y); started = true; } else ctx.lineTo(c.x, c.y);
      });
      if (!started) return false;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
      return true;
    }

    function drawShapes(ctx, width) {
      var stroke = style.stroke;
      d.paths.forEach(function (path) { if (Array.isArray(path) && path.length >= 2) strokePath(ctx, path, stroke, 2); });
      d.lines.forEach(function (line) {
        var start = coord(line.start), end = coord(line.end);
        if (!start || !end) return;
        ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
        if (!style.dots) return;
        [start, end].forEach(function (p) {
          ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.stroke();
        });
      });
      // 동그라미는 두 점으로 정한 사각 영역에 내접하는 타원을 화면 좌표로 그린다 - 시간축·가격축 축척이 달라도 항상 매끈한 원/타원으로 보인다.
      d.circles.forEach(function (circle) {
        var start = coord(circle.start), end = coord(circle.end);
        if (!start || !end) return;
        var rx = Math.abs(end.x - start.x) / 2, ry = Math.abs(end.y - start.y) / 2;
        if (rx < 0.5 || ry < 0.5) return;
        ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = 2;
        ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      d.boxes.forEach(function (box) {
        var a = coord(box.start), b = coord(box.end);
        if (!a || !b) return;
        var bx = Math.min(a.x, b.x), by = Math.min(a.y, b.y), bw = Math.abs(b.x - a.x), bh = Math.abs(b.y - a.y);
        ctx.fillStyle = 'rgba(99,102,241,.12)'; ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = 'rgba(99,102,241,.85)'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
        if (box.label) {
          ctx.font = '700 12px Pretendard Variable, Pretendard, sans-serif'; ctx.fillStyle = '#4f46e5'; ctx.textBaseline = 'top';
          var text = String(box.label);
          while (text.length > 1 && ctx.measureText(text).width > bw - 8) text = text.slice(0, -1);
          ctx.fillText(text, bx + 5, by + 4);
        }
      });
      // 가로선: 클릭한 가격에 차트 전체 폭으로 긋고 오른쪽 끝에 금액 표시.
      d.hlines.forEach(function (hl) {
        var y = series.priceToCoordinate(hl.price);
        if (y == null) return;
        ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        var txt = hl.price >= 1000 ? Math.round(hl.price).toLocaleString('ko-KR') : String(Math.round(hl.price * 100) / 100);
        ctx.font = '700 11px sans-serif';
        var tw = ctx.measureText(txt).width + 10;
        hl._y = y;
        hl._label = { x1: width - tw - 4, x2: width - 4, y1: y - 18, y2: y - 2 };
        ctx.fillStyle = stroke; ctx.fillRect(width - tw - 4, y - 18, tw, 16);
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, width - tw + 1, y - 10);
      });
      if (d.mode === 'hline' && d.hlinePreview != null && !d.dragHline) {
        var previewY = series.priceToCoordinate(d.hlinePreview);
        if (previewY != null) {
          ctx.save(); ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.65;
          ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
          ctx.moveTo(0, previewY); ctx.lineTo(width, previewY); ctx.stroke();
          ctx.setLineDash([]); ctx.font = '700 11px sans-serif'; ctx.fillStyle = stroke;
          ctx.textBaseline = 'bottom';
          ctx.fillText(d.hlinePreview >= 1000 ? Math.round(d.hlinePreview).toLocaleString('ko-KR') : String(Math.round(d.hlinePreview * 100) / 100), 8, previewY - 4);
          ctx.restore();
        }
      }
      // 측정: 끝난 측정과 끄는 중인 미리보기. 시작점에서 가로 점선, 끝점 x 에 세로 자(눈금 양끝 표시), 오른쪽(가장자리면 왼쪽)에 % 라벨.
      var measureShown = d.measure, measureLive = false;
      if (d.mode === 'measure' && d.pending && d.preview && d.previewPoint) { measureShown = { start: d.pending, end: d.previewPoint }; measureLive = true; }
      if (measureShown) {
        var ma = coord(measureShown.start), mb = coord(measureShown.end);
        var mm = measureMetrics(measureShown.start, measureShown.end);
        if (ma && mb && mm) {
          var down = mm.pct < 0, mcolor = down ? '#2563eb' : '#dc2626';
          ctx.save();
          ctx.strokeStyle = mcolor; ctx.fillStyle = mcolor; ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(ma.x, ma.y); ctx.lineTo(mb.x, ma.y); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(mb.x, ma.y); ctx.lineTo(mb.x, mb.y); ctx.stroke();
          var tick = down ? -6 : 6;
          ctx.beginPath(); ctx.moveTo(mb.x - 5, mb.y + tick); ctx.lineTo(mb.x, mb.y); ctx.lineTo(mb.x + 5, mb.y + tick); ctx.stroke();
          [ma, mb].forEach(function (pt) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2); ctx.fill(); });
          var lines = measureLabelLines(mm, measureShown.start, measureShown.end);
          var lw = 0;
          lines.forEach(function (t, i) { ctx.font = (i === 0 ? '800 14px' : '600 11px') + ' Pretendard Variable, Pretendard, sans-serif'; lw = Math.max(lw, ctx.measureText(t).width); });
          var bw2 = lw + 14, bh2 = 8 + 18 + (lines.length - 1) * 14;
          var bx2 = mb.x + 10 + bw2 > width ? mb.x - 10 - bw2 : mb.x + 10;
          var by2 = Math.max(4, Math.min((bounds.h || 400) - bh2 - 4, (ma.y + mb.y) / 2 - bh2 / 2));
          ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fillRect(bx2, by2, bw2, bh2);
          ctx.strokeStyle = mcolor; ctx.lineWidth = 1; ctx.strokeRect(bx2, by2, bw2, bh2);
          ctx.fillStyle = mcolor; ctx.textBaseline = 'top';
          lines.forEach(function (t, i) { ctx.font = (i === 0 ? '800 14px' : '600 11px') + ' Pretendard Variable, Pretendard, sans-serif'; ctx.fillText(t, bx2 + 7, i === 0 ? by2 + 5 : by2 + 24 + (i - 1) * 14 - 4); });
          ctx.restore();
        }
      }
      if (d.pending && style.dots && d.mode !== 'measure') {
        var pending = coord(d.pending);
        if (pending) { ctx.beginPath(); ctx.fillStyle = stroke; ctx.arc(pending.x, pending.y, 4, 0, Math.PI * 2); ctx.fill(); }
      }
      if (d.preview && d.pending) {
        var ps = coord(d.pending);
        if (ps) {
          ctx.beginPath();
          if (style.previewDash) { ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(225,29,72,.72)'; ctx.lineWidth = 1.5; }
          else { ctx.strokeStyle = stroke; ctx.lineWidth = 2; }
          if (d.mode === 'circle') {
            var prx = Math.abs(d.preview.x - ps.x) / 2, pry = Math.abs(d.preview.y - ps.y) / 2;
            if (prx >= 0.5 && pry >= 0.5) ctx.ellipse((ps.x + d.preview.x) / 2, (ps.y + d.preview.y) / 2, prx, pry, 0, 0, Math.PI * 2);
          } else if (d.mode === 'box') ctx.rect(ps.x, ps.y, d.preview.x - ps.x, d.preview.y - ps.y);
          else { ctx.moveTo(ps.x, ps.y); ctx.lineTo(d.preview.x, d.preview.y); }
          ctx.stroke();
          if (style.previewDash) ctx.setLineDash([]);
        }
      }
      if (d.activePath && d.activePath.length > 1) strokePath(ctx, d.activePath, stroke, 2);
    }

    // ---- 도구 상태·단추 ----
    function paintButtons(mode) {
      MODES.forEach(function (m) {
        var btn = buttons[m];
        if (!btn) return;
        if (btn.classList) btn.classList.toggle('is-active', mode === m);
        if (btn.setAttribute) btn.setAttribute('aria-pressed', mode === m ? 'true' : 'false');
      });
    }

    function setMode(mode) {
      mode = tools.indexOf(mode) > -1 ? mode : null;
      if (d.dragHline) d.dragHline.hl.price = d.dragHline.originalPrice;
      overlay.style.cursor = '';
      d.mode = mode; d.enabled = !!mode;
      d.pending = null; d.preview = null; d.previewPoint = null; d.activePath = null; d.dragHline = null; d.hlinePreview = null; d.hlineDraft = null;
      if (overlay.classList) { overlay.classList.toggle('is-active', !!mode); overlay.classList.toggle('is-pencil', mode === 'pencil'); }
      paintButtons(mode);
      var titles = opts.titles || DEFAULT_TITLES;
      overlay.title = mode ? (titles[mode] || '') : (opts.title || '');
      redraw();
      if (opts.onModeChange) opts.onModeChange(mode);
    }

    function clearAll() {
      d.lines = []; d.paths = []; d.circles = []; d.hlines = []; d.boxes = []; d.measure = null;
      d.pending = null; d.preview = null; d.activePath = null; d.hlinePreview = null; d.hlineDraft = null;
      persist();
      redraw();
    }

    // ---- 입력 ----
    var minLen = opts.minLengthPx || 0;
    var strict = !!opts.clampToCanvas;
    function onPointerDown(event) {
      if (!d.enabled) return;
      // 그리기(가로선·박스·직선·동그라미·연필)는 마우스 왼쪽 버튼으로만. 오른쪽·휠 클릭은 무시한다(2026-10-10 요청).
      if (event.button != null && event.button !== 0) return;
      var rect = overlay.getBoundingClientRect();
      var point = d.mode === 'hline' ? { price: Number(series.coordinateToPrice(event.clientY - rect.top)) } : pointFromEvent(event, strict);
      if (!point || !isFinite(point.price)) return;
      event.preventDefault();
      if (d.mode === 'pencil') d.activePath = [point];
      else if (d.mode === 'hline') {
        // 가로선 금액 수정(2026-10-10): 금액 라벨을 누르면 숫자를 직접 입력, 선을 끌면 가격이 따라 움직인다.
        var px = event.clientX - rect.left, py = event.clientY - rect.top;
        var hit = null, onLabel = false;
        d.hlines.forEach(function (hl) {
          if (hit || hl._y == null) return;
          var lb = hl._label;
          if (lb && px >= lb.x1 && px <= lb.x2 && py >= lb.y1 && py <= lb.y2) { hit = hl; onLabel = true; }
          else if (Math.abs(py - hl._y) <= 6) hit = hl;
        });
        if (hit) {
          d.hlinePreview = null;
          d.dragHline = { hl: hit, onLabel: onLabel, startY: py, moved: false, originalPrice: hit.price };
          overlay.style.cursor = 'ns-resize';
          if (overlay.setPointerCapture) overlay.setPointerCapture(event.pointerId);
          return;
        }
        if (!(point.price > 0)) return;   // 가격축 밖(0 이하)을 눌러 생긴 음수 가로선은 만들지 않는다
        d.hlineDraft = point.price;
        d.hlinePreview = point.price;
        if (overlay.setPointerCapture) overlay.setPointerCapture(event.pointerId);
        redraw();
        return;
      } else if (d.mode === 'measure') {
        d.measure = null;
        d.pending = snapToBarExtreme(d, point, event.clientY - rect.top);       // 시작점도 봉의 고가·저가에 붙는다
      } else if (d.mode === 'line' || d.mode === 'circle' || d.mode === 'box') d.pending = point;
      if (overlay.setPointerCapture) overlay.setPointerCapture(event.pointerId);
      redraw();
    }

    function onPointerMove(event) {
      var rect = overlay.getBoundingClientRect();
      if (d.dragHline) {
        var dy = event.clientY - rect.top;
        if (Math.abs(dy - d.dragHline.startY) > 3) d.dragHline.moved = true;
        if (d.dragHline.moved) {
          var moved = series.coordinateToPrice(dy);
          if (moved != null && isFinite(Number(moved)) && Number(moved) > 0) d.dragHline.hl.price = Number(moved);
          redraw();
        }
        return;
      }
      if (d.mode === 'hline') {
        var hoverY = event.clientY - rect.top;
        var hoverPrice = series.coordinateToPrice(hoverY);
        var inside = event.clientX >= rect.left && event.clientX <= rect.right && hoverY >= 0 && hoverY <= rect.height;
        var nearLine = d.hlines.some(function (hl) { var y = series.priceToCoordinate(hl.price); return y != null && Math.abs(y - hoverY) <= 6; });
        overlay.style.cursor = nearLine ? 'ns-resize' : 'crosshair';
        d.hlinePreview = inside && !nearLine && Number(hoverPrice) > 0 && isFinite(Number(hoverPrice)) ? Number(hoverPrice) : null;
        redraw();
        return;
      }
      if ((d.mode === 'line' || d.mode === 'circle' || d.mode === 'box' || d.mode === 'measure') && d.pending) {
        d.preview = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        if (d.mode === 'measure') d.previewPoint = snapToBarExtreme(d, pointFromEvent(event, strict), d.preview.y);
        redraw();
        return;
      }
      if (d.mode !== 'pencil' || !d.activePath) return;
      var point = pointFromEvent(event, strict);
      if (!point) return;
      var last = d.activePath[d.activePath.length - 1];
      if (last && last.time === point.time && last.logical === point.logical && Math.abs(last.price - point.price) < 0.000001) return;
      d.activePath.push(point);
      redraw();
    }

    function release(event) {
      if (event && overlay.hasPointerCapture && overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    }

    function onPointerUp(event, cancelled) {
      release(event);
      if (d.dragHline) {
        var dragged = d.dragHline;
        d.dragHline = null;
        overlay.style.cursor = '';
        if (cancelled) { dragged.hl.price = dragged.originalPrice; redraw(); return; }
        if (!dragged.moved && dragged.onLabel && !cancelled) {
          var current = dragged.hl.price, typed = null;
          try { typed = global.prompt('가로선 금액을 입력하세요(비우면 선을 삭제합니다)', current >= 1000 ? String(Math.round(current)) : String(Math.round(current * 100) / 100)); } catch (e) { typed = null; }
          if (typed !== null) {
            var cleaned = String(typed).replace(/[,\s원$]/g, '');
            if (cleaned === '') d.hlines = d.hlines.filter(function (item) { return item !== dragged.hl; });
            else if (isFinite(Number(cleaned)) && Number(cleaned) > 0) dragged.hl.price = Number(cleaned);
          }
        }
        persist();
        redraw();
        return;
      }
      if (d.mode === 'hline' && d.hlineDraft != null) {
        var hRect = overlay.getBoundingClientRect();
        var inPlot = event.clientX >= hRect.left && event.clientX <= hRect.right && event.clientY >= hRect.top && event.clientY <= hRect.bottom;
        var hPrice = series.coordinateToPrice(event.clientY - hRect.top);
        if (!cancelled && inPlot && Number(hPrice) > 0 && isFinite(Number(hPrice))) {
          d.hlines.push({ price: Number(hPrice) });
          persist();
        }
        d.hlineDraft = null; d.hlinePreview = null;
        redraw();
        return;
      }
      if (d.pending && d.mode === 'measure') {
        var mEnd = cancelled ? null : pointFromEvent(event, strict);
        var mRect = overlay.getBoundingClientRect();
        var mStart = d.pending;
        if (mEnd) {
          mEnd = snapToBarExtreme(d, mEnd, event.clientY - mRect.top);
          var ma0 = coord(mStart), mb0 = coord(mEnd);
          if (ma0 && mb0 && Math.hypot(mb0.x - ma0.x, mb0.y - ma0.y) >= 6) d.measure = { start: mStart, end: mEnd };   // 클릭만 한 경우는 만들지 않는다
        }
        d.pending = null; d.preview = null; d.previewPoint = null;
        redraw();
        return;                                                                     // 측정은 저장하지 않는다
      }
      if (d.pending && (d.mode === 'line' || d.mode === 'circle' || d.mode === 'box')) {
        var endPoint = cancelled ? null : pointFromEvent(event, strict);
        var startPoint = d.pending;
        if (endPoint) {
          var shape = { start: startPoint, end: endPoint };
          var a = coord(startPoint), b = coord(endPoint);
          var longEnough = !minLen || (a && b && Math.hypot(b.x - a.x, b.y - a.y) >= minLen);
          if (d.mode === 'circle') { if (longEnough) d.circles.push(shape); }
          else if (d.mode === 'box') {
            // 너무 작은 드래그(클릭)는 박스로 만들지 않는다.
            if (a && b && Math.abs(b.x - a.x) > 6 && Math.abs(b.y - a.y) > 6) {
              var label = '';
              try { label = String(global.prompt('박스 이름(예: 상승 파동, 조정, 응축)', '') || '').slice(0, 20); } catch (e) { /* 무시 */ }
              shape.label = label;
              d.boxes.push(shape);
            }
          } else if (longEnough) d.lines.push(shape);
        }
        d.pending = null; d.preview = null;
        persist();
        redraw();
      }
      if (!d.activePath) return;
      if (!cancelled && d.activePath.length > 1) d.paths.push(d.activePath);
      d.activePath = null;
      persist();
      redraw();
    }

    scope.on(overlay, 'mousemove', function (event) {
      if (!d.enabled || (d.mode !== 'line' && d.mode !== 'circle' && d.mode !== 'box' && d.mode !== 'measure') || !d.pending) return;
      var rect = overlay.getBoundingClientRect();
      d.preview = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (d.mode === 'measure') d.previewPoint = snapToBarExtreme(d, pointFromEvent(event, strict), d.preview.y);
      redraw();
    });
    scope.on(overlay, 'contextmenu', function (event) {
      if (!d.enabled) return;
      event.preventDefault();
      release(event);
      setMode(null);
    });
    scope.on(overlay, 'mouseleave', function () {
      if (d.mode === 'pencil' && d.activePath) return;
      d.preview = null; d.hlinePreview = null;
      redraw();
    });
    scope.on(overlay, 'pointerdown', onPointerDown);
    scope.on(overlay, 'pointermove', onPointerMove);
    scope.on(overlay, 'pointerup', function (event) { onPointerUp(event, false); });
    scope.on(overlay, 'pointercancel', function (event) { onPointerUp(event, true); });

    // 확대·이동·가격축 조정·패널 크기 변경에도 날짜/가격 좌표를 다시 투영한다.
    var onRange = function () { schedule(false); };
    if (chart.timeScale().subscribeVisibleLogicalRangeChange) {
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      scope.add(function () { if (chart.timeScale().unsubscribeVisibleLogicalRangeChange) chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); });
    }
    if (typeof series.attachPrimitive === 'function') {
      var primitive = { updateAllViews: function () { schedule(false); }, paneViews: function () { return []; } };
      try {
        series.attachPrimitive(primitive);
        scope.add(function () { try { series.detachPrimitive(primitive); } catch (e) { /* 이미 제거된 시리즈 */ } });
      } catch (e) { /* 프리미티브를 못 붙여도 구독으로 계속 동작 */ }
    }
    scope.resize(container, function () { schedule(true); });

    // 단추 연결(다시 붙일 때 이전 핸들러를 덮어쓴다)
    MODES.forEach(function (m) {
      var btn = buttons[m];
      if (!btn || tools.indexOf(m) < 0) return;
      if ('disabled' in btn) btn.disabled = false;
      btn.onclick = function () { setMode(d.mode === m ? null : m); };
    });
    if (buttons.clear) {
      if ('disabled' in buttons.clear) buttons.clear.disabled = false;
      buttons.clear.onclick = function () { clearAll(); setMode(null); };
    }

    function detach() {
      if (detached) return;
      detached = true;
      if (frame) { global.cancelAnimationFrame(frame); frame = 0; }
      scope.dispose();
      MODES.concat(['clear']).forEach(function (m) {
        var btn = buttons[m];
        if (!btn) return;
        btn.onclick = null;
        if (opts.disableButtonsOnDetach && 'disabled' in btn) btn.disabled = true;
        if (btn.classList) btn.classList.remove('is-active');
        if (btn.hasAttribute ? btn.hasAttribute('aria-pressed') : MODES.indexOf(m) > -1) btn.setAttribute('aria-pressed', 'false');
      });
      layers = [];
      if (overlay.remove) overlay.remove();
    }

    var ctl = {
      overlay: overlay, shapes: d, coord: coord,
      mode: function () { return d.mode; },
      setMode: setMode, clear: clearAll,
      redraw: redraw, schedule: schedule,
      resize: function () { redraw(); },
      addLayer: function (name, draw) {
        layers = layers.filter(function (l) { return l.name !== name; });
        layers.push({ name: name, draw: draw });
        schedule(true);
      },
      removeLayer: function (name) { layers = layers.filter(function (l) { return l.name !== name; }); schedule(true); },
      detach: detach,
      get detached() { return detached; }
    };

    redraw();
    if (d.sync) pullDrawings(d, function () { return !detached; }, function () { writeShapesLocal(store, d); redraw(); });
    return ctl;
  }

  global.NineChartDrawing = {
    attach: attach, loadShapes: loadShapes, writeShapesLocal: writeShapesLocal,
    anchoredFromXY: anchoredFromXY, anchoredToXY: anchoredToXY,
    measureMetrics: measureMetrics, measureLabelLines: measureLabelLines, snapToBarExtreme: snapToBarExtreme,   // 측정 도구(검증용으로도 내보낸다)
    // 계정 저장 부품(검증·점검용)
    _sync: { state: drawingSync, schedulePush: scheduleDrawingPush, pull: pullDrawings, push: pushDrawings, payload: drawingsPayload, thin: thinDrawingPath, flush: flushPendingDrawings }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartDrawing;
})(typeof window !== 'undefined' ? window : globalThis);
