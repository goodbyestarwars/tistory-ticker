/**
 * 간밤 시황(나스닥100·S&P500·다우·코스피200 야간선물·필라델피아 반도체지수·VIX·WTI 원유) 카드.
 *
 * 2026-07-15: TradingView 임베드 위젯을 완전히 걷어내고 자체 구현으로 교체.
 * TradingView 무료 위젯은 CME/NYMEX 연결선물·지수 심볼이 데이터 라이선스로 계속 막혀서
 * (KRX야간선물은 대체 심볼조차 없었음) 안정적으로 쓸 수 없었음 - 자세한 경위는 git log 참고.
 *
 * 2026-07-16: 사용자 요청으로 다우존스 선물(DOW) 추가 + 미니차트를 단색 영역차트에서
 * 베이스라인 차트(구간 시작가 기준 위/아래 자동 채색)로 변경 + 종합 보조지수 요약 문구 추가.
 * DOW는 scripts/cloud-vm/foreign_futures.py의 SYMBOLS에도 추가해뒀는데, 그 파일은 VM에서
 * 상시 도는 백그라운드 서비스라 이 git push만으로는 반영 안 됨 - VM에 SSH로 접속해 최신
 * 코드로 재배포(서비스 재시작)해야 DOW 카드에 실제 데이터가 뜬다(그 전까진 "데이터 없음").
 * "코스피 야간선물 전용 메뉴 + AI 브리핑"과 "간밤시황->보조지수 개편(야간선물 제외)"은
 * 아직 손 안 댔음 - 새 Tistory 페이지 생성(사용자 액션 필요)과 GAS AI 엔드포인트가 먼저
 * 필요해서 다음 세션 과제로 남겨둠.
 *
 * 데이터 소스:
 * - 나스닥100/S&P500/다우/SOX/VIX/WTI: 네이버 모바일 증권 API(GAS를 거치지 않고 VM이 직접 수집)
 * - 코스피200 야간선물: 한국투자증권(KIS) 공식 API - KRX야간선물 실시간종목체결(H0MFCNT0) 웹소켓 +
 *   선물옵션기간별시세(FID_COND_MRKT_DIV_CODE=CM) REST. 네이버·키움 둘 다 야간선물 자체를
 *   제공하지 않아서(실측 확인) KIS로 별도 확보한 유일한 소스.
 * 두 소스 다 VM(scripts/cloud-vm/night_futures_ws.py, foreign_futures.py)이 상시 수집해
 * SQLite에 저장하고, 이 위젯은 VM의 /futures 엔드포인트 하나만 호출한다(방문자 브라우저가
 * 네이버/KIS를 직접 호출하지 않음 - CORS/레이트리밋 문제 회피 + 과거 CDN 캐시 지연 경험 때문에
 * 서버 수집 방식을 선호).
 *
 * 미니차트는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드, js/foreign-flow.js와
 * 동일 라이브러리)로 직접 그린다 - 축/라벨/크로스헤어/줌 전부 끈 순수 스파크라인.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#overnight-market';
  var FUTURES_API = 'https://ghlee.duckdns.org/futures';
  var FETCH_TIMEOUT_MS = 10000;
  var REFRESH_INTERVAL_MS = 30000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var SPARKLINE_HEIGHT = 64;

  var LABELS = {
    NASDAQ100: '나스닥 100 선물',
    SP500: 'S&P500 선물',
    DOW: '다우 선물',
    KOSPI200_NIGHT: '코스피200 야간선물',
    SOX: '필라델피아 반도체지수',
    VIX: 'VIX(변동성지수)',
    WTI: 'WTI 원유'
  };
  var SYMBOL_ORDER = ['NASDAQ100', 'SP500', 'DOW', 'KOSPI200_NIGHT', 'SOX', 'VIX', 'WTI'];

  var lwcLoadPromise = null;
  var chartInstances = {}; // symbol -> { chart, series }
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

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    var abs = Math.abs(v);
    var digits = abs >= 1000 ? 2 : 2;
    return v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtSigned(v, digits) {
    if (v == null || isNaN(v)) return '-';
    var s = v.toFixed(digits == null ? 2 : digits);
    return (v > 0 ? '+' : '') + s;
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
    var cards = SYMBOL_ORDER.map(function (symbol) {
      return ''
        + '<div class="om-card" data-symbol="' + symbol + '">'
        + '<div class="om-title">' + escapeHtml(LABELS[symbol]) + '</div>'
        + '<div class="om-body om-loading">불러오는 중...</div>'
        + '</div>';
    }).join('');
    return '<div class="om-summary" id="omSummary" hidden></div><div class="om-grid">' + cards + '</div>';
  }

  function buildCardBody(item) {
    var hasPrice = typeof item.price === 'number';
    var tone = item.change_rate > 0 ? 'om-pos' : item.change_rate < 0 ? 'om-neg' : 'om-zero';
    var arrow = item.change_rate > 0 ? '▲' : item.change_rate < 0 ? '▼' : '-';

    return ''
      + '<div class="om-body">'
      + '<div class="om-price ' + tone + '">' + (hasPrice ? fmtPrice(item.price) : '데이터 없음') + '</div>'
      + (hasPrice
        ? '<div class="om-change ' + tone + '">' + arrow + ' ' + fmtSigned(item.change, 2) + ' (' + fmtSigned(item.change_rate, 2) + '%)</div>'
        : '')
      + '<div class="om-chart" data-symbol="' + escapeHtml(item.symbol) + '"></div>'
      + '<div class="om-hl">'
      + '<span>고가 ' + fmtPrice(item.high) + '</span>'
      + '<span>저가 ' + fmtPrice(item.low) + '</span>'
      + '</div>'
      + '<div class="om-updated">업데이트 ' + fmtTime(item.updated_at) + '</div>'
      + '</div>';
  }

  function chartThemeOptions() {
    var dark = isDark();
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(사용자가 나중에 문서 만들 예정, 아직 미작성).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } }
    };
  }

  function destroyChart(symbol) {
    var inst = chartInstances[symbol];
    if (!inst) return;
    try { inst.chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
    delete chartInstances[symbol];
  }

  // 2026-07-16: 단일 색 영역차트 -> 베이스라인 차트로 변경. 구간 시작가를 기준선 삼아
  // 위로 오르면 빨강, 아래로 내리면 파랑으로 자동 채색된다(js/quick-indices.js와 동일 방식).
  function renderSparkline(container, symbol, chartRows) {
    if (!chartRows || chartRows.length < 2) return;
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;

      destroyChart(symbol);

      var chart = LWC.createChart(container, Object.assign({
        autoSize: true,
        height: SPARKLINE_HEIGHT,
        handleScroll: false,
        handleScale: false,
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: { visible: false },
        crosshair: {
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false }
        }
      }, chartThemeOptions()));

      var series = chart.addBaselineSeries({
        baseValue: { type: 'price', price: chartRows[0].close },
        topLineColor: '#d24f45',
        topFillColor1: hexToRgba('#d24f45', 0.25),
        topFillColor2: hexToRgba('#d24f45', 0.02),
        bottomLineColor: '#1261c4',
        bottomFillColor1: hexToRgba('#1261c4', 0.02),
        bottomFillColor2: hexToRgba('#1261c4', 0.25),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(chartRows.map(function (r) { return { time: toLwcTime(r.date), value: r.close }; }));
      chart.timeScale().fitContent();

      chartInstances[symbol] = { chart: chart, series: series };
    }).catch(function () {
      container.innerHTML = '<div class="om-chart-error">차트를 불러오지 못했어요.</div>';
    });
  }

  // ---- 종합 보조지수 요약(규칙 기반 - AI 호출 없이 클라이언트에서 즉시 계산) ----

  function buildSummaryText(items) {
    var withData = items.filter(function (it) { return typeof it.change_rate === 'number'; });
    if (!withData.length) return null;
    var upCount = withData.filter(function (it) { return it.change_rate > 0; }).length;
    var downCount = withData.filter(function (it) { return it.change_rate < 0; }).length;
    var avg = withData.reduce(function (s, it) { return s + it.change_rate; }, 0) / withData.length;
    var tone = avg > 0.3 ? '상승' : avg < -0.3 ? '하락' : '혼조';
    var toneClass = avg > 0.3 ? 'om-pos' : avg < -0.3 ? 'om-neg' : 'om-zero';
    return {
      text: withData.length + '개 중 ' + upCount + '개 상승·' + downCount + '개 하락 - 평균 '
        + (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%로 전반적으로 ' + tone + ' 흐름입니다.',
      toneClass: toneClass
    };
  }

  function renderSummary(container, items) {
    var box = container.querySelector('#omSummary');
    if (!box) return;
    var summary = buildSummaryText(items);
    if (!summary) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<b>종합 보조지수 요약</b> <span class="' + summary.toneClass + '">' + escapeHtml(summary.text) + '</span>';
  }

  // 백엔드(KIS stck_bsop_date, 네이버 localDate)가 전부 'YYYYMMDD' 포맷을 주는데
  // Lightweight Charts는 business day 문자열로 'YYYY-MM-DD'(대시 포함)를 요구한다.
  function toLwcTime(yyyymmdd) {
    return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function renderAll(container, items) {
    var bySymbol = {};
    items.forEach(function (item) { bySymbol[item.symbol] = item; });

    renderSummary(container, items);

    SYMBOL_ORDER.forEach(function (symbol) {
      var card = container.querySelector('.om-card[data-symbol="' + symbol + '"]');
      if (!card) return;
      var item = bySymbol[symbol] || { symbol: symbol };
      card.querySelector('.om-body').outerHTML = buildCardBody(item);
      var chartContainer = card.querySelector('.om-chart');
      if (chartContainer) renderSparkline(chartContainer, symbol, item.chart);
    });
  }

  function refresh(container) {
    OvernightMarket.fetchFutures()
      .then(function (items) { renderAll(container, items); })
      .catch(function () {
        SYMBOL_ORDER.forEach(function (symbol) {
          var card = container.querySelector('.om-card[data-symbol="' + symbol + '"]');
          if (!card) return;
          var body = card.querySelector('.om-body');
          if (body && body.classList.contains('om-loading')) {
            body.outerHTML = '<div class="om-body om-error">시세를 불러오지 못했어요.</div>';
          }
        });
      });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    refresh(container);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { refresh(container); }, REFRESH_INTERVAL_MS);

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      Object.keys(chartInstances).forEach(function (symbol) {
        chartInstances[symbol].chart.applyOptions(chartThemeOptions());
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  var OvernightMarket = {
    init: init,
    fetchFutures: fetchFutures
  };
  global.OvernightMarket = OvernightMarket;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
