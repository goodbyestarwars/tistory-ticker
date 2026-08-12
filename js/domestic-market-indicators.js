(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/domestic-market-indicators';
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var KST_OFFSET_SEC = 9 * 60 * 60;
  var CHART_HEIGHT = 330;
  var chartInstances = {};
  var drawingStates = {};
  var lwcPromise = null;

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
    state.overlay.title = enabled ? '두 지점을 차례로 클릭해 추세선을 그립니다.' : '';
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
      if (!state.pending) state.pending = point;
      else {
        state.lines.push({ start: state.pending, end: point });
        state.pending = null;
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
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/domestic-market-indicators.css?v=20260813-dmi-size-color';
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
    var points = (rows || []).map(function (row) { return pointFor(row, interval); }).filter(Boolean);
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
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      series.setData(points);
      chart.timeScale().fitContent();
      chartInstances[key] = { chart: chart, series: series, interval: interval };
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
      var chart = panel.querySelector('.dmi-chart');
      var source = item.intervals && item.intervals[active];
      makeChart(market, chart, source && source.rows, active);
      panel.querySelectorAll('.dmi-tab').forEach(function (button) {
        button.classList.toggle('is-active', button.getAttribute('data-interval') === active);
      });
    });
  }

  function chartPanel(market, item) {
    return '<section class="dmi-panel" data-dmi-panel="' + market + '" data-dmi-interval="day">'
      + '<div class="dmi-panel-title"><span>' + escapeHtml(item.name || market) + '</span><div class="dmi-chart-tools">'
      + '<button type="button" class="dmi-draw-toggle" aria-pressed="false" title="두 지점을 차례로 클릭해 추세선을 그립니다.">선 그리기</button>'
      + '<button type="button" class="dmi-draw-clear" title="그린 선을 모두 지웁니다.">지우기</button></div></div>'
      + '<div class="dmi-tabs" role="tablist">'
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

  function renderFunds(root, funds) {
    funds = funds || {};
    var credit = funds.credit || {};
    var deposits = funds.market_funds || {};
    root.querySelector('.dmi-fund-grid').innerHTML = [
      '<article class="dmi-fund-card"><span class="dmi-fund-label">신용잔고</span><strong class="dmi-fund-value">' + formatFunds(credit.loan_total, funds.credit_unit) + '</strong><span class="dmi-fund-date">' + escapeHtml(credit.date || funds.latest_date || '-') + '</span></article>',
      '<article class="dmi-fund-card"><span class="dmi-fund-label">고객예탁금</span><strong class="dmi-fund-value">' + formatFunds(deposits.investor_deposits, funds.market_funds_unit) + '</strong><span class="dmi-fund-date">' + escapeHtml(deposits.date || funds.latest_date || '-') + '</span></article>'
    ].join('');
  }

  function init() {
    var root = document.getElementById('domestic-market-indicators');
    if (!root || root.getAttribute('data-dmi-ready') === '1') return;
    root.setAttribute('data-dmi-ready', '1');
    installStyle();
    root.innerHTML = '<div class="dmi-shell">'
      + '<div class="dmi-heading"><h2>국내시장지표</h2></div>'
      + '<div class="dmi-subheading"><h3>코스피 · 코스닥 주간현물 (09:00~15:45)</h3></div>'
      + '<div class="dmi-chart-grid">' + chartPanel('KOSPI', { name: '코스피' }) + chartPanel('KOSDAQ', { name: '코스닥' }) + '</div>'
      + '<div class="dmi-subheading"><h3>투자자별 매매동향</h3><span class="dmi-muted">개인 · 외국인 · 기관</span></div>'
      + '<div class="dmi-flow-grid"><div class="dmi-flow-card">데이터 준비 중</div><div class="dmi-flow-card">데이터 준비 중</div></div>'
      + '<div class="dmi-subheading"><h3>증시자금</h3></div>'
      + '<div class="dmi-fund-grid"><div class="dmi-fund-card">데이터 준비 중</div><div class="dmi-fund-card">데이터 준비 중</div></div>'
      + '</div>';
    fetchJson().then(function (data) {
      root._dmiData = data;
      renderCharts(root, data.indices || {});
      renderInvestor(root, data.investor || {});
      renderFunds(root, data.funds || {});
    }).catch(function () {
      root.querySelector('.dmi-shell').insertAdjacentHTML('beforeend', '<div class="dmi-error">국내시장지표 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>');
    });
    root.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('.dmi-tab') : null;
      if (!button) return;
      var panel = button.closest('[data-dmi-panel]');
      if (!panel) return;
      panel.setAttribute('data-dmi-interval', button.getAttribute('data-interval'));
      // The response is kept on the root so changing tabs never triggers an
      // extra provider request or changes the chart's data source.
      var data = root._dmiData;
      if (data) renderCharts(root, data.indices || {});
    });
  }

  global.DomesticMarketIndicators = { init: init };
})(window);
