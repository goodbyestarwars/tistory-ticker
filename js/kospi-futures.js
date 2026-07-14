/**
 * 코스피 선물(주간·야간) 페이지 - 코스피200 주간선물/야간선물을 큰 차트 2개로 보여준 뒤,
 * AI가 "선물 간 관계와 현물지수와의 연관성, 특히 야간선물이 다음 거래일 한국 증시에
 * 미치는 영향" 관점으로 해설한다.
 *
 * 2026-07-16 신설. js/overnight-market.js(구 간밤 시황)에서 코스피200 야간선물 카드를
 * 분리해 이 페이지로 옮기고, 코스피200 주간선물을 새로 추가했다.
 *
 * 2026-07-16(2차): 사용자 요청으로 코스피 현물지수 카드를 제거하고 선물(주간+야간)만
 * 남겼다 - 관심지수 리본(js/quick-indices.js)에 코스피 현물이 항상 떠 있어 이 페이지에서
 * 또 보여주는 게 중복이라는 판단. VM도 더는 코스피 현물지수를 수집하지 않는다
 * (scripts/cloud-vm/domestic_futures.py 상단 주석 참고).
 *
 * 데이터 소스:
 * - 코스피200 주간선물(KOSPI200_DAY): 네이버 API, VM이 현재가+최근 90일 일봉 수집
 *   (scripts/cloud-vm/domestic_futures.py).
 * - 코스피200 야간선물(KOSPI200_NIGHT): 한국투자증권(KIS) API, VM이 웹소켓으로 상시 수집
 *   (scripts/cloud-vm/night_futures_ws.py) - js/overnight-market.js와 동일 소스.
 * 둘 다 VM의 /futures 엔드포인트 하나로 묶여서 나온다(js/overnight-market.js와 동일 API,
 * 이 페이지가 쓰는 심볼만 다름).
 *
 * AI 해설은 GAS(gas/ticker-proxy.gs의 getKospiFuturesAnalysis, ?action=kospiFuturesAnalysis)가
 * 같은 /futures 응답을 프롬프트에 그대로 넣어 생성 - 화면 숫자와 AI 문장이 어긋나지 않도록 소스를
 * 통일했다(과거 코스피 100배 버그로 AI가 엉뚱한 숫자를 지어낸 전례 있음).
 *
 * 큰 차트는 js/foreign-flow.js의 renderLwChart 패턴(캔들스틱, 크로스헤어 활성화, 축 표시)을
 * 그대로 재사용한다 - js/overnight-market.js의 축 없는 스파크라인과 다르게 여기는 인터랙션을
 * 전부 열어둔 큰 차트가 필요해서다.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#kospi-futures';
  var FUTURES_API = 'https://ghlee.duckdns.org/futures';
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FETCH_TIMEOUT_MS = 10000;
  var REFRESH_INTERVAL_MS = 30000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var CHART_HEIGHT = 420;

  var PANEL_ORDER = ['KOSPI200_DAY', 'KOSPI200_NIGHT'];
  var PANEL_LABELS = {
    KOSPI200_DAY: '코스피200 주간선물',
    KOSPI200_NIGHT: '코스피200 야간선물'
  };
  var CHARTS = [
    { key: 'day', symbol: 'KOSPI200_DAY', elId: 'kfChartDay', title: '코스피200 주간선물 (최근 90일)' },
    { key: 'night', symbol: 'KOSPI200_NIGHT', elId: 'kfChartNight', title: '코스피200 야간선물 (최근 90일)' }
  ];

  var lwcLoadPromise = null;
  var chartInstances = {}; // key -> { chart, series }
  var themeObserver = null;
  var refreshTimer = null;

  function loadLightweightCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcLoadPromise) return lwcLoadPromise;
    lwcLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LWC_CDN;
      s.onload = function () { resolve(global.LightweightCharts); };
      s.onerror = function () { lwcLoadPromise = null; reject(new Error('차트 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return lwcLoadPromise;
  }

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function fetchFutures() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(FUTURES_API, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('futures API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || [];
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchAiSummary() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?action=kospiFuturesAnalysis', hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data && data.analysis;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    return v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtSigned(v, digits) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + v.toFixed(digits == null ? 2 : digits);
  }

  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { hour12: false });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildShell() {
    var panelCards = PANEL_ORDER.map(function (symbol) {
      return '<div class="kf-stat-card" data-symbol="' + symbol + '">'
        + '<div class="kf-stat-label">' + escapeHtml(PANEL_LABELS[symbol]) + '</div>'
        + '<div class="kf-stat-body kf-loading">불러오는 중...</div>'
        + '</div>';
    }).join('');

    var sections = CHARTS.map(function (c) {
      return '<div class="kf-section">'
        + '<div class="kf-section-title">' + escapeHtml(c.title) + '</div>'
        + '<div class="kf-chart" id="' + c.elId + '" style="height:' + CHART_HEIGHT + 'px"></div>'
        + '</div>';
    }).join('');

    return ''
      + '<div class="kf-ai" id="kfAi" hidden></div>'
      + '<div class="kf-panel" id="kfPanel">' + panelCards + '</div>'
      + sections;
  }

  function buildStatBody(item) {
    var hasPrice = item && typeof item.price === 'number';
    var tone = !hasPrice ? 'kf-zero' : item.change_rate > 0 ? 'kf-pos' : item.change_rate < 0 ? 'kf-neg' : 'kf-zero';
    var arrow = !hasPrice ? '' : item.change_rate > 0 ? '▲' : item.change_rate < 0 ? '▼' : '-';
    return ''
      + '<div class="kf-stat-body">'
      + '<div class="kf-stat-price ' + tone + '">' + (hasPrice ? fmtPrice(item.price) : '데이터 없음') + '</div>'
      + (hasPrice
        ? '<div class="kf-stat-change ' + tone + '">' + arrow + ' ' + fmtSigned(item.change, 2) + ' (' + fmtSigned(item.change_rate, 2) + '%)</div>'
        : '')
      + '<div class="kf-stat-updated">' + (hasPrice ? '업데이트 ' + fmtTime(item.updated_at) : '') + '</div>'
      + '</div>';
  }

  // js/foreign-flow.js의 lwcThemeOptions와 동일 패턴 - 9bolt 스킨 다크모드(html.dark 토글)를
  // MutationObserver로 감지해 차트에도 반영한다.
  function chartThemeOptions() {
    var dark = isDark();
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(js/overnight-market.js, js/foreign-flow.js와
      // 동일한 미해결 TODO - 사용자가 나중에 문서 만들 예정).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  function chartPriceFormatter(v) {
    return v == null || isNaN(v) ? '' : v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  function destroyChart(key) {
    var inst = chartInstances[key];
    if (!inst) return;
    try { inst.chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
    delete chartInstances[key];
  }

  // 백엔드(KIS stck_bsop_date, 네이버 localDate)가 전부 'YYYYMMDD' 포맷을 주는데
  // Lightweight Charts는 business day 문자열로 'YYYY-MM-DD'(대시 포함)를 요구한다.
  function toLwcTime(yyyymmdd) {
    return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
  }

  function renderBigChart(cfg, item) {
    var container = document.getElementById(cfg.elId);
    if (!container) return;
    var rows = item && item.chart;
    if (!rows || rows.length < 2) {
      container.innerHTML = '<div class="kf-chart-error">차트 데이터가 없습니다.</div>';
      return;
    }
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;
      destroyChart(cfg.key);

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: CHART_HEIGHT,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: false, secondsVisible: false },
        localization: { priceFormatter: chartPriceFormatter }
      }, chartThemeOptions()));

      var series = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      series.setData(rows.map(function (r) {
        return { time: toLwcTime(r.date), open: r.open, high: r.high, low: r.low, close: r.close };
      }));
      chart.timeScale().fitContent();

      chartInstances[cfg.key] = { chart: chart, series: series };
    }).catch(function () {
      container.innerHTML = '<div class="kf-chart-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  function renderAll(container, items) {
    var bySymbol = {};
    items.forEach(function (item) { bySymbol[item.symbol] = item; });

    PANEL_ORDER.forEach(function (symbol) {
      var card = container.querySelector('.kf-stat-card[data-symbol="' + symbol + '"]');
      if (!card) return;
      card.querySelector('.kf-stat-body').outerHTML = buildStatBody(bySymbol[symbol]);
    });

    CHARTS.forEach(function (cfg) {
      renderBigChart(cfg, bySymbol[cfg.symbol]);
    });
  }

  function refresh(container) {
    KospiFutures.fetchFutures()
      .then(function (items) { renderAll(container, items); })
      .catch(function () {
        PANEL_ORDER.forEach(function (symbol) {
          var card = container.querySelector('.kf-stat-card[data-symbol="' + symbol + '"]');
          if (!card) return;
          var body = card.querySelector('.kf-stat-body');
          if (body && body.classList.contains('kf-loading')) {
            body.outerHTML = '<div class="kf-stat-body kf-error">시세를 불러오지 못했어요.</div>';
          }
        });
      });
  }

  function renderAiSummary(container) {
    var box = container.querySelector('#kfAi');
    if (!box) return;
    KospiFutures.fetchAiSummary()
      .then(function (text) {
        if (!text) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = '<b>🤖 AI 해설</b><p>' + escapeHtml(text) + '</p>';
      })
      .catch(function () { box.hidden = true; });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    refresh(container);
    renderAiSummary(container);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { refresh(container); }, REFRESH_INTERVAL_MS);

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      Object.keys(chartInstances).forEach(function (key) {
        chartInstances[key].chart.applyOptions(chartThemeOptions());
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  var KospiFutures = {
    init: init,
    fetchFutures: fetchFutures,
    fetchAiSummary: fetchAiSummary
  };
  global.KospiFutures = KospiFutures;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
