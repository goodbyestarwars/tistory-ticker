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
  var DAY_RANGE = 250; // 기존 90일 -> 약 1년으로 확대(VM domestic_futures.py 기본 수집 범위와 일치)
  var INTERVAL_LABELS = { minute: '분봉', day: '일봉', week: '주봉' };
  // 분봉은 네이버 소스가 있는 주간선물(KOSPI200_DAY)만 지원 - 야간선물(KIS 소스)은 분봉
  // 데이터가 없어 일봉/주봉만 제공한다(scripts/cloud-vm/domestic_futures.py MINUTE_SYMBOLS 참고).
  var CHARTS = [
    { key: 'day', symbol: 'KOSPI200_DAY', elId: 'kfChartDay', label: '코스피200 주간선물', intervals: ['minute', 'day', 'week'] },
    { key: 'night', symbol: 'KOSPI200_NIGHT', elId: 'kfChartNight', label: '코스피200 야간선물', intervals: ['day', 'week'] }
  ];

  var CHART_EL_BY_KEY = {};
  CHARTS.forEach(function (c) { CHART_EL_BY_KEY[c.key] = c.elId; });

  // 섹션별 펼침/접힘 - localStorage에 저장해 다음 방문에도 유지(예: 야간에는 주간선물을
  // 접어두면 다음에 들어와도 접힌 채로 시작). 기본은 둘 다 펼침.
  function collapseKey(chartKey) { return 'kf_collapsed_' + chartKey + '_v1'; }
  function loadCollapsed(chartKey) {
    try { return localStorage.getItem(collapseKey(chartKey)) === '1'; } catch (err) { return false; }
  }
  function saveCollapsed(chartKey, collapsed) {
    try { localStorage.setItem(collapseKey(chartKey), collapsed ? '1' : '0'); } catch (err) { /* 무시 */ }
  }

  var lwcLoadPromise = null;
  var chartInstances = {}; // key -> { chart, series }
  var themeObserver = null;
  var refreshTimer = null;
  // key -> { interval, dayItem(마지막 일봉 fetch 결과), minuteRows(마지막 분봉 fetch 결과) }
  var panelState = {};
  CHARTS.forEach(function (c) { panelState[c.key] = { interval: c.intervals[0] === 'minute' ? 'day' : c.intervals[0], dayItem: null, minuteRows: null }; });

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

  function fetchFutures(interval, days) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    var url = FUTURES_API + '?interval=' + (interval || 'day') + '&days=' + (days || DAY_RANGE);
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
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
      var toggleHtml = '<div class="kf-interval-toggle" data-chart-key="' + c.key + '">' + c.intervals.map(function (iv) {
        return '<button type="button" class="kf-interval-btn' + (iv === panelState[c.key].interval ? ' active' : '') + '" data-interval="' + iv + '">' + INTERVAL_LABELS[iv] + '</button>';
      }).join('') + '</div>';
      var collapsed = loadCollapsed(c.key);
      return '<div class="kf-section' + (collapsed ? ' kf-collapsed' : '') + '" data-section-key="' + c.key + '">'
        + '<div class="kf-section-head">'
        + '<div class="kf-section-title">' + escapeHtml(c.label) + '</div>'
        + '<button type="button" class="kf-collapse-btn" data-chart-key="' + c.key + '" aria-label="펼치기/접기">' + (collapsed ? '▸' : '▾') + '</button>'
        + '</div>'
        + '<div class="kf-section-body">'
        + toggleHtml
        + '<div class="kf-chart" id="' + c.elId + '" style="height:' + CHART_HEIGHT + 'px"></div>'
        + '</div>'
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

  // 일봉 배열을 ISO 주(월요일 시작) 단위로 묶어 주봉을 만든다 - 서버에 새 엔드포인트를
  // 만들지 않고 이미 받아온 일봉으로 클라이언트에서 처리(주봉 소스가 Naver에 없는 것도 실측
  // 확인됨 - domestic_futures.py 상단 주석 참고).
  function resampleWeekly(dailyRows) {
    var weeks = [];
    var byWeekKey = {};
    dailyRows.forEach(function (r) {
      var d = new Date(r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8) + 'T00:00:00');
      var dow = d.getDay() || 7; // 일요일(0) -> 7로 바꿔 월요일(1) 시작 주 계산
      var monday = new Date(d);
      monday.setDate(d.getDate() - dow + 1);
      var weekKey = monday.toISOString().slice(0, 10);
      var bucket = byWeekKey[weekKey];
      if (!bucket) {
        bucket = { time: weekKey, open: r.open, high: r.high, low: r.low, close: r.close };
        byWeekKey[weekKey] = bucket;
        weeks.push(bucket);
      } else {
        bucket.high = Math.max(bucket.high, r.high);
        bucket.low = Math.min(bucket.low, r.low);
        bucket.close = r.close;
      }
    });
    return weeks;
  }

  function renderBigChart(key, points, timeVisible) {
    var container = document.getElementById(CHART_EL_BY_KEY[key]);
    if (!container) return;
    if (!points || points.length < 2) {
      container.innerHTML = '<div class="kf-chart-error">차트 데이터가 없습니다.</div>';
      return;
    }
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;
      destroyChart(key);
      container.innerHTML = '';

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: CHART_HEIGHT,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: !!timeVisible, secondsVisible: false },
        localization: { priceFormatter: chartPriceFormatter }
      }, chartThemeOptions()));

      var series = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      series.setData(points);
      chart.timeScale().fitContent();

      chartInstances[key] = { chart: chart, series: series };
    }).catch(function () {
      container.innerHTML = '<div class="kf-chart-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // panelState[cfg.key].interval에 맞춰 캐시된 데이터로 다시 그린다(재요청 없음 - 일봉/주봉은
  // 이미 받아온 dayItem을, 분봉은 이미 받아온 minuteRows를 그대로 씀).
  function renderChartPanel(cfg) {
    var st = panelState[cfg.key];
    if (st.interval === 'minute') {
      var rows = (st.minuteRows || []).filter(function (r) { return r.ts != null; });
      var points = rows.map(function (r) { return { time: r.ts, open: r.open, high: r.high, low: r.low, close: r.close }; });
      renderBigChart(cfg.key, points, true);
      return;
    }
    var dayRows = (st.dayItem && st.dayItem.chart) || [];
    if (st.interval === 'week') {
      var weekPts = resampleWeekly(dayRows);
      renderBigChart(cfg.key, weekPts, false);
      return;
    }
    var dayPts = dayRows.map(function (r) { return { time: toLwcTime(r.date), open: r.open, high: r.high, low: r.low, close: r.close }; });
    renderBigChart(cfg.key, dayPts, false);
  }

  function loadMinuteAndRender(cfg) {
    var container = document.getElementById(CHART_EL_BY_KEY[cfg.key]);
    if (container) container.innerHTML = '<div class="kf-chart-error">분봉 불러오는 중...</div>';
    KospiFutures.fetchFutures('minute').then(function (items) {
      var item = items.filter(function (it) { return it.symbol === cfg.symbol; })[0];
      panelState[cfg.key].minuteRows = (item && item.chart) || [];
      if (panelState[cfg.key].interval === 'minute') renderChartPanel(cfg);
    }).catch(function () {
      if (container) container.innerHTML = '<div class="kf-chart-error">분봉을 불러오지 못했어요.</div>';
    });
  }

  function wireIntervalToggles(container) {
    container.querySelectorAll('.kf-interval-toggle').forEach(function (toggle) {
      var key = toggle.getAttribute('data-chart-key');
      var cfg = CHARTS.filter(function (c) { return c.key === key; })[0];
      if (!cfg) return;
      toggle.querySelectorAll('.kf-interval-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var interval = btn.getAttribute('data-interval');
          if (panelState[key].interval === interval) return;
          panelState[key].interval = interval;
          toggle.querySelectorAll('.kf-interval-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
          if (interval === 'minute' && !panelState[key].minuteRows) {
            loadMinuteAndRender(cfg);
          } else {
            renderChartPanel(cfg);
          }
        });
      });
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
      panelState[cfg.key].dayItem = bySymbol[cfg.symbol];
      if (panelState[cfg.key].interval === 'minute') {
        loadMinuteAndRender(cfg);
      } else {
        renderChartPanel(cfg);
      }
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

  // 접힌 상태에서는 차트 컨테이너가 display:none이라 LWC의 autoSize(ResizeObserver)가
  // 정상적으로 크기를 못 잡을 수 있어, 펼칠 때마다 안전하게 다시 그린다(이미 받아온 데이터를
  // 그대로 쓰므로 재요청 없음 - renderChartPanel 참고).
  function wireCollapseToggles(container) {
    container.querySelectorAll('.kf-collapse-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-chart-key');
        var section = container.querySelector('.kf-section[data-section-key="' + key + '"]');
        var cfg = CHARTS.filter(function (c) { return c.key === key; })[0];
        if (!section || !cfg) return;
        var collapsed = !section.classList.contains('kf-collapsed');
        section.classList.toggle('kf-collapsed', collapsed);
        btn.textContent = collapsed ? '▸' : '▾';
        saveCollapsed(key, collapsed);
        if (!collapsed) renderChartPanel(cfg);
      });
    });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    wireIntervalToggles(container);
    wireCollapseToggles(container);
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
