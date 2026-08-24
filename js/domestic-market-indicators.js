(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/domestic-market-indicators';
  // 2026-08-23: 분봉(1,500봉x2종목)을 기본 응답에서 빼고 이 엔드포인트로 온디맨드
  // 조회한다(사용자 리포트: "코스피·코스닥 주간현물 차트가 유독 느려" - 응답 256KB의
  // 절반 가까이가 기본 탭(일봉)에서 안 쓰이는 분봉이었음). js/domestic-market-indicators.js
  // 안 이 파일에서만 쓰인다.
  var CHART_API_URL = 'https://goodbyestar.cloud/domestic-market-indicators/chart';
  var WS_URL = 'wss://goodbyestar.cloud/ws/market-indicators?symbols=KOSPI,KOSDAQ';
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  // 2026-08-14 요청: 사이트 곳곳의 Groq AI 요약 상자 제목·아이콘이 "참고의견"/"종합 요약"/
  // "요약" 등으로 제각각이라는 지적 - js/kospi-futures.js·js/overnight-market.js가 이미 쓰는
  // "참고의견" + 이 말풍선 아이콘으로 통일한다(둘과 완전히 동일한 SVG).
  var DMI_AI_ICON = '<svg class="dmi-ai-icon" width="15" height="15" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var KST_OFFSET_SEC = 9 * 60 * 60;
  var CHART_HEIGHT = 330;
  var chartInstances = {};
  var drawingStates = {};
  var lwcPromise = null;
  var socket = null;
  var reconnectTimer = null;
  var reconnectDelay = 1500;
  var socketGeneration = 0;
  var staleTimer = null;
  var dmiRoot = null;

  function resizeDmiCharts() {
    global.requestAnimationFrame(function () {
      Object.keys(chartInstances).forEach(function (key) {
        var inst = chartInstances[key];
        if (!inst || !inst.chart || !inst.element || !inst.chart.resize) return;
        var width = inst.element.clientWidth;
        var height = inst.element.clientHeight;
        if (width > 0 && height > 0) {
          try { inst.chart.resize(width, height); } catch (e) { /* 레이아웃 정리 후 다음 요청에서 재시도 */ }
        }
      });
    });
  }
  global.addEventListener('tistory-chart-resize', resizeDmiCharts);

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fetchJson() {
    return fetch(API_URL, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.success === false) throw new Error('invalid response');
      return payload.data || payload;
    });
  }

  // 2026-08-23: 분봉 온디맨드 조회 - /domestic-market-indicators/chart?market=&interval=
  function fetchChartInterval(market, interval) {
    var url = CHART_API_URL + '?market=' + encodeURIComponent(market) + '&interval=' + encodeURIComponent(interval);
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.success === false) throw new Error('invalid response');
      return payload.data || payload;
    });
  }

  // 2026-08-22 요청: "코스피·코스닥 주간현물" 헤더가 주말에도 "(09:00~15:45)"만 보여서
  // 장중인 것처럼 보인다는 지적 - js/kospi-futures.js의 isMarketOpen/isKrxHoliday와 같은
  // 방식(KST 기준 요일+시각, 주말·공휴일은 별도 목록)으로 "(휴장)"/"(장 마감)" 배지를
  // 추가한다. 이 위젯은 코스피·코스닥 현물(09:00~15:45, 야간 세션 없음)만 다루므로
  // kospi-futures.js보다 단순한 단일 세션 판정이면 충분하다.
  var KRX_HOLIDAYS_2026 = {
    '20260101': true, '20260216': true, '20260217': true, '20260218': true,
    '20260301': true, '20260302': true, '20260501': true, '20260505': true,
    '20260525': true, '20260603': true, '20260606': true, '20260717': true,
    '20260815': true, '20260817': true, '20260924': true, '20260925': true,
    '20260926': true, '20261003': true, '20261005': true, '20261009': true,
    '20261225': true, '20261231': true
  };
  function domesticCashMarketStatusLabel() {
    var kst = new Date(Date.now() + 9 * 60 * 60000);
    var day = kst.getUTCDay(); // 0=일 ... 6=토
    var mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var dateKey = String(kst.getUTCFullYear()) + String(kst.getUTCMonth() + 1).padStart(2, '0') + String(kst.getUTCDate()).padStart(2, '0');
    var isHoliday = day === 0 || day === 6 || !!KRX_HOLIDAYS_2026[dateKey];
    var isWeekdayOpenHours = !isHoliday && mins >= 9 * 60 && mins < 15 * 60 + 45;
    if (isWeekdayOpenHours) return '';
    return isHoliday ? '(휴장)' : '(장 마감)';
  }

  var LIVE_STATUS_STATE = { '실시간': 'live', '지연': 'stale', '연결 재시도': 'retry' };

  function setLiveStatus(text) {
    var node = dmiRoot && dmiRoot.querySelector('[data-dmi-connection]');
    if (!node) return;
    node.textContent = text;
    node.setAttribute('data-state', LIVE_STATUS_STATE[text] || 'init');
  }

  function scheduleReconnect() {
    if (document.hidden || reconnectTimer) return;
    var delay = reconnectDelay;
    reconnectDelay = Math.min(30000, Math.round(reconnectDelay * 1.8));
    reconnectTimer = setTimeout(function () { reconnectTimer = null; connectSocket(); }, delay);
  }

  function closeSocket(reconnect) {
    socketGeneration += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (staleTimer) clearTimeout(staleTimer);
    reconnectTimer = null;
    staleTimer = null;
    var current = socket;
    socket = null;
    if (current) { try { current.close(); } catch (error) {} }
    if (reconnect) scheduleReconnect();
  }

  function applyLiveSnapshot(packet) {
    if (!dmiRoot || !dmiRoot._dmiData || !Array.isArray(packet.data)) return;
    var data = dmiRoot._dmiData;
    packet.data.forEach(function (quote) {
      if (!quote || !quote.symbol || typeof quote.price !== 'number') return;
      var index = data.indices && data.indices[quote.symbol];
      if (!index || !index.intervals) return;
      index.quote = index.quote || {};
      index.quote.price = quote.price;
      index.quote.change = quote.change;
      index.quote.change_rate = quote.change_rate;
      index.quote.updated_at = quote.updated_at;
      Object.keys(index.intervals).forEach(function (interval) {
        var rows = index.intervals[interval].rows || [];
        if (!rows.length) return;
        var last = rows[rows.length - 1];
        last.close = quote.price;
        last.high = Math.max(Number(last.high) || quote.price, quote.price);
        last.low = Math.min(Number(last.low) || quote.price, quote.price);
      });
    });
    renderCharts(dmiRoot, data.indices || {});
    renderSpotQuotes(dmiRoot, data.indices || {});
  }

  function connectSocket() {
    if (document.hidden || socket || !global.WebSocket || !dmiRoot) return;
    var generation = socketGeneration;
    setLiveStatus('연결 재시도');
    try { socket = new WebSocket(WS_URL); } catch (error) { socket = null; scheduleReconnect(); return; }
    socket.onopen = function () {
      if (generation !== socketGeneration) return;
      reconnectDelay = 1500;
      setLiveStatus('실시간');
    };
    socket.onmessage = function (event) {
      if (generation !== socketGeneration) return;
      var packet;
      try { packet = JSON.parse(event.data); } catch (error) { return; }
      if (!packet || packet.type !== 'market-indicators') return;
      applyLiveSnapshot(packet);
      setLiveStatus('실시간');
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(function () { setLiveStatus('지연'); }, 20000);
    };
    socket.onerror = function () { setLiveStatus('연결 재시도'); };
    socket.onclose = function () {
      if (generation !== socketGeneration) return;
      socket = null;
      setLiveStatus('연결 재시도');
      scheduleReconnect();
    };
  }

  // 2026-08-14 요청: 증시자금 카드 위 "종합 요약" - js/kospi-futures.js의 참고의견(AI 해설)과
  // 동일한 패턴으로 GAS(gas/ticker-proxy.gs의 getDomesticFundsAnalysis, ?action=
  // domesticFundsAnalysis)가 Groq로 생성한 문장을 그대로 받아온다. GAS가 이 화면과 같은
  // VM 응답을 유일한 소스로 프롬프트를 만들어서 화면 숫자와 AI 문장이 어긋나지 않는다.
  function fetchFundsAnalysis() {
    return fetch(GAS_TICKER_URL + '?action=domesticFundsAnalysis').then(function (r) {
      if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
      return r.json();
    }).then(function (data) {
      return data && data.analysis;
    });
  }

  function loadCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcPromise) return lwcPromise;
    lwcPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = LWC_CDN;
      script.onload = function () { resolve(global.LightweightCharts); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return lwcPromise;
  }

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function chartThemeOptions() {
    var dark = isDark();
    return {
      // Keep the attribution/logo behavior identical to the KOSPI200 futures chart.
      // 코스피·코스닥 주간현물 차트 축/시간축 폰트도 검은색으로 고정한다.
      layout: { background: { color: 'transparent' }, textColor: '#000', attributionLogo: false },
      // 코스피·코스닥도 선물 차트와 같은 일반적인 캔들 차트로 표시한다.
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  function chartPriceFormatter(value) {
    return value == null || isNaN(value) ? '' : value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function spotPrice(value) {
    if (value == null || isNaN(Number(value))) return '-';
    return Number(value).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function spotChange(value, digits) {
    if (value == null || isNaN(Number(value))) return '-';
    var number = Number(value);
    return (number > 0 ? '+' : '') + number.toFixed(digits == null ? 2 : digits);
  }

  function renderSpotQuotes(root, indices) {
    var mount = root && root.querySelector('.dmi-spot-quotes');
    if (!mount) return;
    mount.innerHTML = ['KOSPI', 'KOSDAQ'].map(function (market) {
      var item = indices && indices[market] || {};
      var quote = item.quote || {};
      var rows = item.intervals && item.intervals.day && item.intervals.day.rows || [];
      var last = rows.length ? rows[rows.length - 1] : {};
      var price = quote.price != null ? quote.price : last.close;
      var change = quote.change;
      var rate = quote.change_rate;
      var cls = Number(change) > 0 ? 'dmi-positive' : Number(change) < 0 ? 'dmi-negative' : '';
      return '<article class="dmi-spot-card">'
        + '<span class="dmi-spot-label">' + escapeHtml(item.name || market) + '</span>'
        + '<strong class="dmi-spot-price">' + spotPrice(price) + '</strong>'
        + '<span class="dmi-spot-change ' + cls + '">' + spotChange(change) + ' (' + spotChange(rate) + '%)</span>'
        + '</article>';
    }).join('');
  }

  function mergeOptions(base, extra) {
    var merged = {};
    Object.keys(base).forEach(function (key) { merged[key] = base[key]; });
    Object.keys(extra).forEach(function (key) { merged[key] = extra[key]; });
    return merged;
  }

  function drawingStorageKey(key, interval) {
    return 'tistory-ticker:dmi-drawings:' + key + ':' + interval;
  }

  function loadDrawingLines(key, interval) {
    try {
      var raw = global.localStorage.getItem(drawingStorageKey(key, interval));
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveDrawingLines(state) {
    try {
      global.localStorage.setItem(drawingStorageKey(state.key, state.interval), JSON.stringify(state.lines));
    } catch (e) { /* 저장소를 사용할 수 없는 환경에서도 차트는 계속 동작 */ }
  }

  function collapseStorageKey(market) {
    return 'tistory-ticker:dmi-collapsed:' + market;
  }

  function loadCollapsed(market) {
    try { return global.localStorage.getItem(collapseStorageKey(market)) === '1'; } catch (e) { return false; }
  }

  function saveCollapsed(market, collapsed) {
    try { global.localStorage.setItem(collapseStorageKey(market), collapsed ? '1' : '0'); } catch (e) { /* 무시 */ }
  }

  function drawingPointFromCoordinate(state, x, y) {
    var time = state.chart.timeScale().coordinateToTime(x);
    var price = state.series.coordinateToPrice(y);
    if (time == null || price == null || !isFinite(Number(price))) return null;
    return { time: time, price: Number(price) };
  }

  function drawingCoordinate(state, point) {
    if (!point) return null;
    var x = state.chart.timeScale().timeToCoordinate(point.time);
    var y = state.series.priceToCoordinate(point.price);
    return x == null || y == null ? null : { x: Number(x), y: Number(y) };
  }

  function redrawDrawing(state) {
    if (!state || !state.overlay) return;
    var width = state.overlay.clientWidth;
    var height = state.overlay.clientHeight;
    var ctx = state.overlay.getContext('2d');
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.lines.forEach(function (line) {
      var start = drawingCoordinate(state, line.start);
      var end = drawingCoordinate(state, line.end);
      if (!start || !end) return;
      ctx.beginPath();
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 2;
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      [start, end].forEach(function (point) {
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 2;
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      });
    });
    if (state.pending) {
      var pending = drawingCoordinate(state, state.pending);
      if (pending) {
        ctx.beginPath();
        ctx.fillStyle = '#e11d48';
        ctx.arc(pending.x, pending.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (state.preview && state.pending) {
      var previewStart = drawingCoordinate(state, state.pending);
      if (previewStart) {
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(225,29,72,.72)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(previewStart.x, previewStart.y);
        ctx.lineTo(state.preview.x, state.preview.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function resizeDrawingCanvas(state) {
    if (!state || !state.overlay) return;
    var ratio = global.devicePixelRatio || 1;
    var width = state.overlay.clientWidth;
    var height = state.overlay.clientHeight;
    state.overlay.width = Math.max(1, Math.round(width * ratio));
    state.overlay.height = Math.max(1, Math.round(height * ratio));
    var ctx = state.overlay.getContext('2d');
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redrawDrawing(state);
  }

  function destroyDrawing(key) {
    var state = drawingStates[key];
    if (!state) return;
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.resizeHandler) global.removeEventListener('resize', state.resizeHandler);
    if (state.timeRangeHandler && state.chart.timeScale().unsubscribeVisibleTimeRangeChange) {
      state.chart.timeScale().unsubscribeVisibleTimeRangeChange(state.timeRangeHandler);
    }
    if (state.overlay) state.overlay.remove();
    drawingStates[key] = null;
  }

  function setDrawingMode(key, enabled) {
    var state = drawingStates[key];
    if (!state) return;
    state.enabled = enabled;
    state.pending = null;
    state.preview = null;
    state.overlay.classList.toggle('is-active', enabled);
    state.button.classList.toggle('is-active', enabled);
    state.button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    state.button.textContent = enabled ? '그리기 종료' : '선 그리기';
    state.overlay.title = enabled ? '시작점을 한 번 클릭한 뒤 끝점을 한 번 클릭하면 추세선이 완성됩니다.' : '';
    redrawDrawing(state);
  }

  function bindDrawingControls(key, element) {
    var panel = element.closest ? element.closest('.dmi-panel') : null;
    if (!panel) return;
    var button = panel.querySelector('.dmi-draw-toggle');
    var clear = panel.querySelector('.dmi-draw-clear');
    if (!button || button.getAttribute('data-dmi-draw-wired') === '1') return;
    button.setAttribute('data-dmi-draw-wired', '1');
    button.addEventListener('click', function () {
      var state = drawingStates[key];
      setDrawingMode(key, !(state && state.enabled));
    });
    if (clear) {
      clear.addEventListener('click', function () {
        var state = drawingStates[key];
        if (!state) return;
        state.lines = [];
        state.pending = null;
        state.preview = null;
        saveDrawingLines(state);
        redrawDrawing(state);
      });
    }
  }

  function setupDrawing(key, element, chart, series, interval) {
    destroyDrawing(key);
    var state = {
      key: key,
      interval: interval,
      chart: chart,
      series: series,
      lines: loadDrawingLines(key, interval),
      pending: null,
      preview: null,
      enabled: false
    };
    var overlay = document.createElement('canvas');
    overlay.className = 'dmi-drawing-layer';
    overlay.setAttribute('aria-label', '차트 추세선 그리기 영역');
    element.appendChild(overlay);
    state.overlay = overlay;
    state.button = element.closest('.dmi-panel').querySelector('.dmi-draw-toggle');
    overlay.addEventListener('click', function (event) {
      if (!state.enabled) return;
      var rect = overlay.getBoundingClientRect();
      var point = drawingPointFromCoordinate(state, event.clientX - rect.left, event.clientY - rect.top);
      if (!point) return;
      if (!state.pending) {
        state.pending = point;
        overlay.setAttribute('aria-label', '추세선 시작점이 지정되었습니다. 끝점을 한 번 클릭하세요.');
      } else {
        state.lines.push({ start: state.pending, end: point });
        state.pending = null;
        overlay.setAttribute('aria-label', '차트 추세선 그리기 영역');
        saveDrawingLines(state);
      }
      redrawDrawing(state);
    });
    overlay.addEventListener('mousemove', function (event) {
      if (!state.enabled || !state.pending) return;
      var rect = overlay.getBoundingClientRect();
      state.preview = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      redrawDrawing(state);
    });
    overlay.addEventListener('mouseleave', function () {
      state.preview = null;
      redrawDrawing(state);
    });
    state.timeRangeHandler = function () { redrawDrawing(state); };
    if (chart.timeScale().subscribeVisibleTimeRangeChange) chart.timeScale().subscribeVisibleTimeRangeChange(state.timeRangeHandler);
    if (global.ResizeObserver) {
      state.resizeObserver = new global.ResizeObserver(function () { resizeDrawingCanvas(state); });
      state.resizeObserver.observe(element);
    } else {
      state.resizeHandler = function () { resizeDrawingCanvas(state); };
      global.addEventListener('resize', state.resizeHandler);
    }
    drawingStates[key] = state;
    bindDrawingControls(key, element);
    resizeDrawingCanvas(state);
  }

  function installStyle() {
    if (document.getElementById('dmi-style')) return;
    var link = document.createElement('link');
    link.id = 'dmi-style';
    link.rel = 'stylesheet';
      link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/domestic-market-indicators.css?v=20260825-cash-box-v1';
    document.head.appendChild(link);
  }

  function formatNumber(value) {
    if (value == null || isNaN(Number(value))) return '-';
    return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  }

  function formatFunds(value, unit) {
    if (value == null || isNaN(Number(value))) return '-';
    var amount = Number(value);
    if (unit === 'million_krw') amount *= 1000000;
    if (unit === 'hundred_million_krw') amount *= 100000000;
    if (amount >= 1000000000000) return (amount / 1000000000000).toFixed(1) + '조원';
    if (amount >= 100000000) return (amount / 100000000).toFixed(1) + '억원';
    return formatNumber(amount) + '원';
  }

  // formatFunds()는 항상 양수라고 가정하고 만/억/조 단위 분기를 ">=" 비교로 판단해서,
  // 순매수/순매도처럼 음수가 나올 수 있는 값을 그대로 넘기면 억/조 단위로 못 줄이고
  // "-239,707,000,000원"처럼 원 단위 그대로 나온다 - 기존 신용잔고/고객예탁금은 항상
  // 양수라 이 문제가 안 드러났을 뿐이라 formatFunds() 자체는 그대로 두고, 부호를 떼어
  // 절대값으로 단위를 맞춘 뒤 부호를 다시 붙인다.
  function formatSignedFunds(value, unit) {
    if (value == null || isNaN(Number(value))) return '-';
    var amount = Number(value);
    var sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
    return sign + formatFunds(Math.abs(amount), unit);
  }

  // 2026-08-14 요청: "최근 평균"(대략 한 달 영업일) 옆에 "1년 평균"(연간 영업일 근사치)도
  // 같이 보여주고, 평균선을 그은 미니 그래프에서 지금 값이 평균보다 위/아래인지 색으로
  // 구분한다. RECENT/YEAR 상수는 scripts/cloud-vm/domestic_market_indicators.py의
  // _PROGRAM_TRADING_RECENT_DAYS/_PROGRAM_TRADING_YEAR_DAYS와 맞춘다.
  var RECENT_AVERAGE_DAYS = 20;
  var YEAR_AVERAGE_DAYS = 252;

  function fundSeriesValues(funds, field) {
    return (funds.series || []).map(function (row) {
      var source = field === 'credit' ? row.credit : row.market_funds;
      if (field === 'credit' && source != null && typeof source !== 'object') return Number(source);
      return source && Number(source[field === 'credit' ? 'loan_total' : 'investor_deposits']);
    }).filter(function (value) { return isFinite(value); });
  }

  // 신용대주잔고/예탁증권담보융자(KOFIA) - fundSeriesValues와 같은 역할이지만 series
  // 모양이 { date, lending, collateral }로 더 단순해서 별도 헬퍼로 뺐다.
  function leverageSeriesValues(detail, field) {
    return (detail.series || []).map(function (row) { return row[field]; })
      .filter(function (value) { return typeof value === 'number' && isFinite(value); });
  }

  function averageOf(values, limit) {
    var slice = limit ? values.slice(-limit) : values;
    if (!slice.length) return null;
    return slice.reduce(function (sum, value) { return sum + value; }, 0) / slice.length;
  }

  function averageText(values, unit, limit) {
    var avg = averageOf(values, limit);
    if (avg == null) return '-';
    var count = limit ? Math.min(limit, values.length) : values.length;
    return formatFunds(avg, unit) + ' (' + count + '개 평균)';
  }

  // 값 배열 + 평균선을 그리는 미니 그래프. 외부 차트 라이브러리 없이 SVG를 직접 그리는
  // js/foreign-flow.js와 같은 방식이다. 지금 값(마지막 값)이 평균보다 높으면 빨강,
  // 낮으면 파랑으로 선 색을 바꾼다(사이트 공통 상승=빨강/하락=파랑 규칙을 "평균 대비"
  // 기준으로 적용 - 전일 대비 등락과는 다른 규칙이라 별도 클래스명을 쓴다).
  function miniAverageChart(values, average) {
    if (!values || values.length < 2 || average == null) return '';
    var w = 260, h = 46, pad = 3;
    var withAvg = values.concat([average]);
    var min = Math.min.apply(null, withAvg);
    var max = Math.max.apply(null, withAvg);
    var range = (max - min) || 1;
    function x(i) { return pad + (i / (values.length - 1)) * (w - pad * 2); }
    function y(v) { return h - pad - ((v - min) / range) * (h - pad * 2); }
    var path = values.map(function (v, i) { return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var last = values[values.length - 1];
    var cls = last > average ? 'dmi-positive' : (last < average ? 'dmi-negative' : 'dmi-flat');
    var avgY = y(average).toFixed(1);
    return '<svg class="dmi-mini-chart ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<line x1="0" y1="' + avgY + '" x2="' + w + '" y2="' + avgY + '" class="dmi-mini-chart-avg"></line>'
      + '<path d="' + path + '" class="dmi-mini-chart-line"></path>'
      + '</svg>';
  }

  function signed(value) {
    if (value == null || isNaN(Number(value))) return '-';
    var number = Number(value);
    return (number > 0 ? '+' : '') + formatNumber(number);
  }

  function pointFor(row, interval) {
    if (!row || row.open == null || row.high == null || row.low == null || row.close == null) return null;
    return {
      time: interval === 'minute' ? Number(row.ts) + KST_OFFSET_SEC : row.date,
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close)
    };
  }

  function makeChart(key, element, rows, interval) {
    var points = (rows || []).map(function (row) {
      var point = pointFor(row, interval);
      return point ? point : null;
    }).filter(Boolean);
    if (points.length < 2) {
      if (chartInstances[key]) {
        destroyDrawing(key);
        chartInstances[key].chart.remove();
        chartInstances[key] = null;
      }
      element.innerHTML = '<div class="dmi-chart-message">추이 데이터 없음</div>';
      return;
    }
    loadCharts().then(function (LWC) {
      if (!document.body.contains(element)) return;
      var current = chartInstances[key];
      if (current && current.interval === interval) {
        current.series.setData(points);
        redrawDrawing(drawingStates[key]);
        return;
      }
      if (current) {
        destroyDrawing(key);
        current.chart.remove();
      }
      element.innerHTML = '';
      var chart = LWC.createChart(element, mergeOptions({
        autoSize: true,
        height: CHART_HEIGHT,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: interval === 'minute', secondsVisible: false },
        localization: { priceFormatter: chartPriceFormatter }
      }, chartThemeOptions()));
      var series = chart.addSeries(LWC.CandlestickSeries, {
        upColor: '#d24f45',
        downColor: '#1261c4',
        borderUpColor: '#d24f45',
        borderDownColor: '#1261c4',
        wickUpColor: '#d24f45',
        wickDownColor: '#1261c4',
        priceLineVisible: true,
        lastValueVisible: true
      });
      series.setData(points);
      chart.timeScale().fitContent();
      chartInstances[key] = { chart: chart, series: series, interval: interval, element: element };
      setupDrawing(key, element, chart, series, interval);
    }).catch(function () {
      element.innerHTML = '<div class="dmi-chart-message">차트 라이브러리를 불러오지 못했습니다.</div>';
    });
  }

  function renderCharts(root, indices) {
    var intervals = ['minute', 'day', 'week'];
    Object.keys(indices || {}).forEach(function (market) {
      var item = indices[market] || {};
      var panel = root.querySelector('[data-dmi-panel="' + market + '"]');
      if (!panel) return;
      var active = panel.getAttribute('data-dmi-interval') || 'day';
      panel.querySelectorAll('.dmi-tab').forEach(function (button) {
        button.classList.toggle('is-active', button.getAttribute('data-interval') === active);
      });
      // 2026-08-14: 접힌 패널은 .dmi-chart가 display:none(0×0)이라 이 상태에서 차트를
      // 만들면 autoSize가 0으로 굳어버려서 나중에 펼쳐도 완전히 안 보이는 버그였다
      // (리포트: "숨기기 버튼 안된다" -> 실제로는 접기는 되는데 다시 펼치면 빈 화면).
      // 접혀 있는 동안은 만들지 않고, 펼칠 때(아래 collapse-btn 클릭 핸들러)가 그
      // 시점에 새로 만든다.
      if (panel.classList.contains('dmi-collapsed')) return;
      var chart = panel.querySelector('.dmi-chart');
      var source = item.intervals && item.intervals[active];
      makeChart(market, chart, source && source.rows, active);
    });
  }

  function chartPanel(market, item) {
    var collapsed = loadCollapsed(market);
    return '<section class="dmi-panel' + (collapsed ? ' dmi-collapsed' : '') + '" data-dmi-panel="' + market + '" data-dmi-interval="day">'
      + '<div class="dmi-panel-title"><span>' + escapeHtml(item.name || market) + '</span><div class="dmi-chart-tools">'
      + '<button type="button" class="dmi-collapse-btn" data-dmi-panel="' + market + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '" aria-label="펼치기/접기">' + (collapsed ? '▸' : '▾') + '</button></div></div>'
      + '<div class="dmi-tabs" role="tablist">'
      + '<button type="button" class="dmi-draw-toggle" aria-pressed="false" title="시작점을 한 번 클릭한 뒤 끝점을 한 번 클릭하면 추세선이 완성됩니다.">선 그리기</button>'
      + '<button type="button" class="dmi-draw-clear" title="그린 선을 모두 지웁니다.">지우기</button>'
      + ['minute', 'day', 'week'].map(function (interval) {
        var label = { minute: '분봉', day: '일봉', week: '주봉' }[interval];
        return '<button type="button" class="dmi-tab' + (interval === 'day' ? ' is-active' : '') + '" data-interval="' + interval + '">' + label + '</button>';
      }).join('')
      + '</div><div class="dmi-chart" aria-label="' + escapeHtml(item.name || market) + ' 표준 차트"></div></section>';
  }

  function renderInvestor(root, investor) {
    var html = Object.keys(investor || {}).map(function (market) {
      var item = investor[market] || {};
      var rows = (item.rows || []).slice(-10);
      return '<section class="dmi-flow-card"><div class="dmi-flow-title">' + market + '</div>'
        + '<table class="dmi-flow-table"><thead><tr><th>일자</th><th>개인</th><th>외국인</th><th>기관</th></tr></thead><tbody>'
        + (rows.length ? rows.map(function (row) {
          function cell(value) {
            var cls = Number(value) > 0 ? 'dmi-positive' : Number(value) < 0 ? 'dmi-negative' : '';
            return '<td class="' + cls + '">' + signed(value) + '</td>';
          }
          return '<tr><td>' + escapeHtml(row.label || '-') + '</td>' + cell(row.individual) + cell(row.foreign) + cell(row.institution) + '</tr>';
        }).join('') : '<tr><td colspan="4">데이터 준비 중</td></tr>')
        + '</tbody></table></section>';
    }).join('');
    root.querySelector('.dmi-flow-grid').innerHTML = html;
  }

  // 프로그램매매 순매수는 부호에 따라 사이트 공통 규칙(상승=빨강/하락=파랑)으로 색을
  // 입힌다. 값은 코스피 시장 전체 기준이고 단위(백만원 추정)는 미검증 - 2026-08-14
  // VM 실측(ka90007)에 근거한 최선의 추정치라는 점을 카드 설명에도 남긴다.
  // 1년 평균·그래프는 scripts/cloud-vm/program_trading_history.py가 매일 하루치씩
  // 쌓은 로컬 이력(programTrading.history)을 그대로 쓴다 - 배포 직후에는 며칠 치밖에
  // 없어 그래프가 짧게 시작해서 매일 자동으로 길어진다(백필 스크립트로 미리 채울 수도
  // 있음).
  // 2026-08-14 요청: 값 자체 글자색도 미니 그래프 선 색과 같은 기준(1년 평균 대비 높으면
  // 빨강/낮으면 파랑)으로 맞춘다. 차익/비차익거래처럼 부호가 있는 값도 "순매수/순매도"
  // 자체 부호가 아니라 "평소보다 많이 샀는지/팔았는지"(평균 대비)로 통일 - 신용잔고 같은
  // 잔고형 값은 항상 양수라 부호 기준으로는 색이 전혀 안 갈렸던 문제도 같이 해결된다.
  function avgCompareClass(value, avg) {
    if (value == null || avg == null) return '';
    return value > avg ? 'dmi-positive' : value < avg ? 'dmi-negative' : '';
  }

  function programTradingCard(label, desc, field, programTrading) {
    var value = programTrading[field];
    var unit = programTrading.unit;
    var history = (programTrading.history || []).map(function (row) { return row[field]; })
      .filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var yearAvg = programTrading.yearAverage && programTrading.yearAverage[field];
    var recentAvg = programTrading.recentAverage && programTrading.recentAverage[field];
    var recentCount = Math.min(RECENT_AVERAGE_DAYS, history.length);
    var yearCount = Math.min(YEAR_AVERAGE_DAYS, history.length);
    return '<article class="dmi-fund-card"><span class="dmi-fund-label">' + escapeHtml(label) + '</span>'
      + '<span class="dmi-fund-desc">' + escapeHtml(desc) + '</span>'
      + '<strong class="dmi-fund-value ' + avgCompareClass(value, yearAvg) + '">' + formatSignedFunds(value, unit) + '</strong>'
      + (recentAvg != null ? '<span class="dmi-fund-average">최근 평균 ' + formatSignedFunds(recentAvg, unit) + ' (' + recentCount + '일 평균)</span>' : '')
      + (yearAvg != null ? '<span class="dmi-fund-average">1년 평균 ' + formatSignedFunds(yearAvg, unit) + ' (' + yearCount + '일 평균)</span>' : '')
      + miniAverageChart(history, yearAvg)
      + '<span class="dmi-fund-average">코스피 전체, 순매수(+)/순매도(-)</span>'
      + '<span class="dmi-fund-date">' + escapeHtml(programTrading.date || '-') + '</span></article>';
  }

  function fundCard(label, desc, value, unit, dateText, seriesValues) {
    var recentAvg = averageOf(seriesValues, RECENT_AVERAGE_DAYS);
    var yearAvg = averageOf(seriesValues, YEAR_AVERAGE_DAYS);
    return '<article class="dmi-fund-card"><span class="dmi-fund-label">' + escapeHtml(label) + '</span>'
      + '<span class="dmi-fund-desc">' + escapeHtml(desc) + '</span>'
      + '<strong class="dmi-fund-value ' + avgCompareClass(value, yearAvg) + '">' + formatFunds(value, unit) + '</strong>'
      + (recentAvg != null ? '<span class="dmi-fund-average">최근 평균 ' + averageText(seriesValues, unit, RECENT_AVERAGE_DAYS) + '</span>' : '')
      + (yearAvg != null ? '<span class="dmi-fund-average">1년 평균 ' + averageText(seriesValues, unit, YEAR_AVERAGE_DAYS) + '</span>' : '')
      + miniAverageChart(seriesValues.slice(-YEAR_AVERAGE_DAYS), yearAvg)
      + '<span class="dmi-fund-date">' + escapeHtml(dateText || '-') + '</span></article>';
  }

  function renderFunds(root, funds, programTrading, leverageDetail) {
    funds = funds || {};
    programTrading = programTrading || {};
    leverageDetail = leverageDetail || {};
    var credit = funds.credit || {};
    var deposits = funds.market_funds || {};
    var cards = [
      fundCard('신용잔고 (빚투)', '투자자가 증권사에서 돈을 빌려 주식을 산 금액이에요. 늘어날수록 빚내서 투자하는 사람이 많다는 뜻입니다.',
        credit.loan_total, funds.credit_unit, credit.date || funds.latest_date, fundSeriesValues(funds, 'credit')),
      fundCard('고객예탁금', '투자자가 주식을 사려고 증권사 계좌에 미리 넣어둔 대기 자금이에요. 늘어나면 살 준비가 된 돈이 많다는 뜻입니다.',
        deposits.investor_deposits, funds.market_funds_unit, deposits.date || funds.latest_date, fundSeriesValues(funds, 'market_funds'))
    ];
    if (programTrading.available) {
      cards.push(programTradingCard('차익거래', '선물 가격과 현재 주가의 차이를 이용해 컴퓨터가 자동으로 사고파는 금액이에요.', 'arbitrage', programTrading));
      cards.push(programTradingCard('비차익거래', '여러 종목을 한 번에 묶어서 컴퓨터가 자동으로 사고파는 금액이에요. 인덱스펀드·ETF의 비중 조정 때 주로 생겨요.', 'nonArbitrage', programTrading));
    }
    if (leverageDetail.available) {
      var lending = leverageDetail.lending || {};
      var collateral = leverageDetail.collateral || {};
      cards.push(fundCard('신용대주잔고', '투자자가 공매도를 하려고 증권사에서 주식 자체를 빌린 잔액이에요. 위 "신용잔고(빚투)"는 돈을 빌린 것이고, 이건 반대로 주식을 빌린 거예요.',
        lending.balance, leverageDetail.unit, lending.date || leverageDetail.latest_date, leverageSeriesValues(leverageDetail, 'lending')));
      cards.push(fundCard('예탁증권담보융자', '갖고 있는 주식을 담보로 맡기고 증권사에서 받은 대출금이에요.',
        collateral.balance, leverageDetail.unit, collateral.date || leverageDetail.latest_date, leverageSeriesValues(leverageDetail, 'collateral')));
    }
    root.querySelector('.dmi-fund-grid').innerHTML = cards.join('');
  }

  function init() {
    var root = document.getElementById('domestic-market-indicators');
    if (!root || root.getAttribute('data-dmi-ready') === '1') return;
    root.setAttribute('data-dmi-ready', '1');
    dmiRoot = root;
    installStyle();
    root.innerHTML = '<div class="dmi-shell">'
      + '<div class="dmi-heading"><h2>국내시장지표</h2><span class="dmi-live-status" data-dmi-connection>REST 확인 중</span></div>'
      + '<div class="dmi-spot-quotes"><article class="dmi-spot-card">불러오는 중...</article><article class="dmi-spot-card">불러오는 중...</article></div>'
      + '<section class="dmi-chart-section"><div class="dmi-subheading"><h3>코스피 · 코스닥 주간현물 (09:00~15:45) <span class="dmi-market-status" data-dmi-market-status></span></h3></div>'
      + '<div class="dmi-chart-grid">' + chartPanel('KOSPI', { name: '코스피' }) + chartPanel('KOSDAQ', { name: '코스닥' }) + '</div></section>'
      + '<div class="dmi-subheading"><h3>투자자별 매매동향</h3></div>'
      + '<div class="dmi-flow-grid"><div class="dmi-flow-card">데이터 준비 중</div><div class="dmi-flow-card">데이터 준비 중</div></div>'
      + '<div class="dmi-subheading"><h3>증시자금</h3></div>'
      + '<div class="dmi-ai" id="dmiFundsAi" hidden></div>'
      + '<div class="dmi-fund-grid"><div class="dmi-fund-card">데이터 준비 중</div><div class="dmi-fund-card">데이터 준비 중</div></div>'
      + '</div>';
    var marketStatusNode = root.querySelector('[data-dmi-market-status]');
    if (marketStatusNode) marketStatusNode.textContent = domesticCashMarketStatusLabel();
    fetchJson().then(function (data) {
      root._dmiData = data;
      renderCharts(root, data.indices || {});
      renderSpotQuotes(root, data.indices || {});
      renderInvestor(root, data.investor || {});
      renderFunds(root, data.funds || {}, data.programTrading || {}, data.leverageDetail || {});
      connectSocket();
    }).catch(function () {
      root.querySelector('.dmi-shell').insertAdjacentHTML('beforeend', '<div class="dmi-error">국내시장지표 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) closeSocket(false);
      else {
        if (marketStatusNode) marketStatusNode.textContent = domesticCashMarketStatusLabel();
        connectSocket(); fetchJson().then(function (data) { root._dmiData = data; renderCharts(root, data.indices || {}); renderSpotQuotes(root, data.indices || {}); }).catch(function () {});
      }
    });
    global.addEventListener('beforeunload', function () { closeSocket(false); });
    var fundsAiBox = root.querySelector('#dmiFundsAi');
    fetchFundsAnalysis().then(function (text) {
      if (!text || !fundsAiBox) return;
      fundsAiBox.hidden = false;
      fundsAiBox.innerHTML = '<div class="dmi-ai-title">' + DMI_AI_ICON + '참고의견</div><p>' + escapeHtml(text) + '</p>';
    }).catch(function () { /* AI 요약 실패는 조용히 무시 - 카드 자체는 정상 표시 */ });
    root.addEventListener('click', function (event) {
      var collapseButton = event.target.closest ? event.target.closest('.dmi-collapse-btn') : null;
      if (collapseButton) {
        // 2026-08-14 발견: 버튼 자신도 data-dmi-panel 속성을 갖고 있어서
        // closest('[data-dmi-panel]')가 (자기 자신부터 검사하는 특성상) 바깥 패널이
        // 아니라 버튼 자기 자신에게 걸려버렸다 - 그래서 dmi-collapsed 클래스가 CSS가
        // 보는 <section class="dmi-panel">이 아니라 버튼에 붙어 아무 효과가 없었다
        // (리포트: "접기 버튼 동작 안 함"). 버튼엔 없고 패널에만 있는 .dmi-panel 클래스로
        // 찾도록 고친다.
        var collapsePanel = collapseButton.closest('.dmi-panel');
        if (!collapsePanel) return;
        var isCollapsed = !collapsePanel.classList.contains('dmi-collapsed');
        var collapseMarket = collapsePanel.getAttribute('data-dmi-panel');
        collapsePanel.classList.toggle('dmi-collapsed', isCollapsed);
        collapseButton.textContent = isCollapsed ? '▸' : '▾';
        collapseButton.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        saveCollapsed(collapseMarket, isCollapsed);
        if (!isCollapsed) {
          // 접혀 있던 동안(또는 접힌 채로 처음 로드됐던 동안) 만들어진 차트가 있으면
          // 0×0 상태로 굳어있을 수 있어 resize만으론 안 살아난다 - 버리고 다시 만든다
          // (kospi-futures.js의 wireCollapseToggles와 동일한 대응).
          var collapseChart = collapsePanel.querySelector('.dmi-chart');
          var dmiData = root._dmiData;
          setTimeout(function () {
            if (!collapseChart) return;
            var existing = chartInstances[collapseMarket];
            if (existing) {
              destroyDrawing(collapseMarket);
              existing.chart.remove();
              chartInstances[collapseMarket] = null;
            }
            if (!dmiData) return;
            var activeInterval = collapsePanel.getAttribute('data-dmi-interval') || 'day';
            var source = dmiData.indices && dmiData.indices[collapseMarket]
              && dmiData.indices[collapseMarket].intervals && dmiData.indices[collapseMarket].intervals[activeInterval];
            makeChart(collapseMarket, collapseChart, source && source.rows, activeInterval);
          }, 0);
        }
        return;
      }
      var button = event.target.closest ? event.target.closest('.dmi-tab') : null;
      if (!button) return;
      var panel = button.closest('[data-dmi-panel]');
      if (!panel) return;
      var interval = button.getAttribute('data-interval');
      var market = panel.getAttribute('data-dmi-panel');
      panel.setAttribute('data-dmi-interval', interval);
      // 일봉만 초기 응답에 담고 주봉·분봉은 탭을 눌렀을 때 가져온다. 두 시장의
      // 주봉까지 첫 화면에서 조회하던 것이 현물 차트 로딩을 늦추고 있었다.
      var data = root._dmiData;
      if (!data) return;
      var existing = data.indices && data.indices[market] && data.indices[market].intervals
        && data.indices[market].intervals[interval];
      if (existing) {
        renderCharts(root, data.indices || {});
        return;
      }
      if (interval !== 'minute' && interval !== 'week') {
        renderCharts(root, data.indices || {});
        return;
      }
      var chartEl = panel.querySelector('.dmi-chart');
      if (chartEl) chartEl.innerHTML = '<div class="dmi-chart-message">' + (interval === 'week' ? '주봉' : '분봉') + ' 불러오는 중...</div>';
      fetchChartInterval(market, interval).then(function (source) {
        if (panel.getAttribute('data-dmi-interval') !== interval) return; // 그 사이 다른 탭으로 이동
        data.indices[market].intervals[interval] = source;
        renderCharts(root, data.indices || {});
      }).catch(function () {
        if (chartEl) chartEl.innerHTML = '<div class="dmi-chart-message">분봉 데이터를 불러오지 못했습니다.</div>';
      });
    });
  }

  global.DomesticMarketIndicators = { init: init };
})(window);
