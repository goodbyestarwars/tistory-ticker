/**
 * 전체 종합지수(코스피/코스닥, 미국 현물지수 3종·선물 3종, 필라델피아 반도체지수, VIX,
 * WTI 원유·금 선물, 원달러 환율, 국고채 3년물 금리, BTC) 카드 - 카테고리별로 묶어서 표시.
 *
 * 2026-07-15: TradingView 임베드 위젯을 완전히 걷어내고 자체 구현으로 교체.
 * TradingView 무료 위젯은 CME/NYMEX 연결선물·지수 심볼이 데이터 라이선스로 계속 막혀서
 * (KRX야간선물은 대체 심볼조차 없었음) 안정적으로 쓸 수 없었음 - 자세한 경위는 git log 참고.
 *
 * 2026-07-16: 사용자 요청으로 다우존스 선물(DOW) 추가 + 미니차트를 단색 영역차트에서
 * 베이스라인 차트(구간 시작가 기준 위/아래 자동 채색)로 변경 + 종합 보조지수 요약 문구 추가.
 *
 * 2026-07-16(2차): "간밤 시황"에서 "보조지수"로 개편(파일명은 유지 - URL이 티스토리 HTML에
 * 박제돼 있어 CLAUDE.md 규칙상 변경 불가). 코스피200 야간선물 카드는 별도 페이지
 * (js/kospi-futures.js)로 분리하며 여기서 제거하고, 대신 원/달러 환율 카드를 추가했다.
 * 규칙기반 요약(buildSummaryText)은 그대로 두고 그 아래에 GAS ?action=subIndexAnalysis(Groq)가
 * 만든 AI 해설 문단을 비동기로 붙였다. AI 해설은 30초 데이터 리프레시와 무관하게 페이지 진입 시
 * 1회만 불러온다(Groq 호출량 절약, GAS 쪽도 30분 캐시).
 *
 * 2026-07-16(3차): 사용자 요청으로 "선물만 있고 현물지수가 없다"는 지적을 반영해 미국
 * 현물지수 3종(나스닥종합/S&P500/다우존스)과 BTC를 추가 - 관심지수 리본(js/quick-indices.js)에
 * 있는 항목 중 코스피 계열을 뺀 전부가 이 페이지에도 나오도록 맞췄다. 이때 종합 요약
 * (buildSummaryText)이 VM 원본 응답(코스피200 주간/야간선물 등 이 페이지에 안 쓰는 심볼까지
 * 포함)을 그대로 세고 있던 버그도 같이 고쳤다 - "N개 중" 카운트가 화면 카드 수보다 많게
 * 나오던 원인. refresh()에서 SYMBOL_ORDER로 필터링한 배열만 renderAll에 넘기도록 수정.
 *
 * 2026-07-18(4차): "보조지수"->"전체 종합지수"로 개편(표시 텍스트만, 파일명/URL 유지).
 * - BTC를 GAS(?market=1, 이력 없음)에서 VM(/futures)로 전환 - scripts/cloud-vm/btc_futures.py가
 *   2026-07-17부터 업비트를 서버사이드로 수집해 SQLite에 이력까지 쌓고 있어서, 다른 심볼과
 *   동일하게 /futures 하나로 통일 가능해짐(BTC 카드만 미니차트가 안 뜨던 문제가 이걸로 해결됨).
 *   fetchBtc()/GAS 머지 로직은 전부 제거.
 * - 코스피/코스닥/금선물을 카드에 추가 - 셋 다 VM /futures 응답에는 이미 있었는데
 *   (domestic_futures.py/foreign_futures.py, 관심지수 리본이 이미 씀) 이 페이지의
 *   SYMBOL_ORDER/LABELS에서만 빠져 있었음.
 * - 국고채 3년물 금리를 신규 추가(scripts/cloud-vm/bond_yield.py, 네이버 marketindex 일별시세
 *   HTML 스크래핑 - JSON API가 없는 지표라 다른 심볼과 소스 형태가 다름).
 * - "11개 중 4개 상승"처럼 단순 상승/하락 개수만 세면 환율·VIX·채권처럼 "오르면 오히려
 *   나쁜" 지표가 섞여 오해를 줄 수 있어(사용자 지적), CATEGORIES에 각 지표의 direction
 *   (1=상승이 호재, -1=상승이 악재, 0=방향성 해석 없음)을 매겨 카테고리별로 나눠 보여주고,
 *   종합 톤도 방향을 반영해 계산하도록 buildSummaryText를 전면 재작성.
 *
 * 데이터 소스:
 * - 나스닥종합/S&P500/다우존스(현물), 나스닥100/S&P500/다우(선물), SOX, VIX, WTI, 금선물,
 *   코스피/코스닥, 원/달러 환율, BTC: 전부 VM(scripts/cloud-vm/foreign_futures.py,
 *   domestic_futures.py, btc_futures.py)이 상시 수집해 SQLite에 저장 - 이 위젯은 VM의
 *   /futures 엔드포인트 하나만 호출한다(방문자 브라우저가 각 소스를 직접 호출하지 않음 -
 *   CORS/레이트리밋 문제 회피).
 * - 국고채 3년물 금리: VM(scripts/cloud-vm/bond_yield.py)이 네이버 marketindex 일별시세
 *   페이지를 스크래핑(하루 1번 갱신되는 채권 종가라 갱신 주기가 다른 심볼보다 느림) - 마찬가지로
 *   /futures 하나로 합쳐져서 나온다.
 * AI 해설은 GAS(gas/ticker-proxy.gs의 getSubIndexAnalysis)가 같은 VM /futures 응답 + BTC를
 * 프롬프트에 그대로 넣어 생성 - 화면 숫자와 AI 문장이 어긋나지 않도록 소스를 통일.
 *
 * 미니차트는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드, js/foreign-flow.js와
 * 동일 라이브러리)로 직접 그린다 - 축/라벨/크로스헤어/줌 전부 끈 순수 스파크라인.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#overnight-market';
  var FUTURES_API = 'https://goodbyestar.cloud/futures';
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FETCH_TIMEOUT_MS = 10000;
  var REFRESH_INTERVAL_MS = 30000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var SPARKLINE_HEIGHT = 64;

  var LABELS = {
    KOSPI: '코스피',
    KOSDAQ: '코스닥',
    NASDAQ_INDEX: '나스닥 종합지수',
    SP500_INDEX: 'S&P500 지수',
    DOW_INDEX: '다우존스 지수',
    NASDAQ100: '나스닥 100 선물',
    SP500: 'S&P500 선물',
    DOW: '다우 선물',
    SOX: '필라델피아 반도체지수',
    VIX: 'VIX(변동성지수)',
    WTI: 'WTI 원유',
    GOLD: '금 선물',
    USDKRW: '원/달러 환율',
    KTB3Y: '국고채 3년물 금리',
    BTC: '비트코인(BTC)'
  };

  // direction: 1=오르면 시장에 호재, -1=오르면 시장에 부담(악재), 0=방향성 해석 없음(그대로 표시만).
  // 카테고리별로 카드를 묶어 보여주고, 종합 요약(buildSummaryText)도 이 방향을 반영해 계산한다 -
  // "환율/VIX/채권은 오른다고 무조건 좋은 게 아니다"라는 사용자 지적을 코드로 명시한 것.
  var CATEGORIES = [
    { key: 'index', label: '시장지수', direction: 1,
      symbols: ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'DOW_INDEX', 'NASDAQ100', 'SP500', 'DOW', 'SOX'] },
    { key: 'volatility', label: '변동성', direction: -1, symbols: ['VIX'] },
    { key: 'fx', label: '환율', direction: -1, symbols: ['USDKRW'] },
    { key: 'bond', label: '채권', direction: -1, symbols: ['KTB3Y'] },
    { key: 'energy', label: '에너지·원자재', direction: 0, symbols: ['WTI', 'GOLD'] },
    { key: 'crypto', label: '가상자산', direction: 1, symbols: ['BTC'] }
  ];
  var SYMBOL_ORDER = CATEGORIES.reduce(function (acc, cat) { return acc.concat(cat.symbols); }, []);

  // 카드 표시 단위/소수점 - 지정 없으면 digits:2, unit:''(가격 그대로).
  var SYMBOL_META = {
    BTC: { digits: 0 },
    KTB3Y: { digits: 2, unit: '%', changeUnit: '%p' }
  };
  function symbolMeta(symbol) {
    var m = SYMBOL_META[symbol] || {};
    return { digits: m.digits == null ? 2 : m.digits, unit: m.unit || '', changeUnit: m.changeUnit || m.unit || '' };
  }

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

  function fmtPrice(v, digits) {
    if (v == null || isNaN(v)) return '-';
    if (digits == null) digits = 2;
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
    var groups = CATEGORIES.map(function (cat) {
      var hint = cat.direction === -1
        ? '<div class="om-cat-hint">상승 = 시장에 부담 요인</div>'
        : cat.direction === 0 ? '<div class="om-cat-hint">방향성 해석 없음(수치만 참고)</div>' : '';
      var cards = cat.symbols.map(function (symbol) {
        return ''
          + '<div class="om-card" data-symbol="' + symbol + '">'
          + '<div class="om-title">' + escapeHtml(LABELS[symbol]) + '</div>'
          + '<div class="om-body om-loading">불러오는 중...</div>'
          + '</div>';
      }).join('');
      return '<div class="om-category">'
        + '<div class="om-cat-head"><span class="om-cat-label">' + escapeHtml(cat.label) + '</span>' + hint + '</div>'
        + '<div class="om-grid">' + cards + '</div>'
        + '</div>';
    }).join('');
    return '<div class="om-summary" id="omSummary" hidden></div>'
      + '<div class="om-ai" id="omAi" hidden></div>'
      + groups;
  }

  function buildCardBody(item) {
    var hasPrice = typeof item.price === 'number';
    var tone = item.change_rate > 0 ? 'om-pos' : item.change_rate < 0 ? 'om-neg' : 'om-zero';
    var arrow = item.change_rate > 0 ? '▲' : item.change_rate < 0 ? '▼' : '-';
    var meta = symbolMeta(item.symbol);

    return ''
      + '<div class="om-body">'
      + '<div class="om-price ' + tone + '">' + (hasPrice ? fmtPrice(item.price, meta.digits) + meta.unit : '데이터 없음') + '</div>'
      + (hasPrice
        ? '<div class="om-change ' + tone + '">' + arrow + ' ' + fmtSigned(item.change, meta.digits) + meta.changeUnit + ' (' + fmtSigned(item.change_rate, 2) + '%)</div>'
        : '')
      + '<div class="om-chart" data-symbol="' + escapeHtml(item.symbol) + '"></div>'
      + '<div class="om-hl">'
      + '<span>고가 ' + (item.high != null ? fmtPrice(item.high, meta.digits) + meta.unit : '-') + '</span>'
      + '<span>저가 ' + (item.low != null ? fmtPrice(item.low, meta.digits) + meta.unit : '-') + '</span>'
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

  // ---- 전체 종합지수 요약(규칙 기반 - AI 호출 없이 클라이언트에서 즉시 계산) ----
  //
  // 단순히 "N개 중 M개 상승"만 세면 환율/VIX/채권처럼 오르는 게 오히려 시장에 부담인 지표가
  // 섞여 오해를 준다(사용자 지적) - 카테고리별로 나눠 보여주고, 종합 톤은 CATEGORIES의
  // direction(1=상승 호재, -1=상승 악재, 0=해석 없음)을 반영한 가중 평균으로 계산한다.

  function buildSummaryText(items) {
    var bySymbol = {};
    items.forEach(function (it) { bySymbol[it.symbol] = it; });

    var parts = [];
    var riskScoreSum = 0, riskCatCount = 0;

    CATEGORIES.forEach(function (cat) {
      var catItems = cat.symbols
        .map(function (s) { return bySymbol[s]; })
        .filter(function (it) { return it && typeof it.change_rate === 'number'; });
      if (!catItems.length) return;

      if (cat.symbols.length > 1) {
        var up = catItems.filter(function (it) { return it.change_rate > 0; }).length;
        var down = catItems.filter(function (it) { return it.change_rate < 0; }).length;
        var avg = catItems.reduce(function (s, it) { return s + it.change_rate; }, 0) / catItems.length;
        parts.push(cat.label + ' ' + catItems.length + '개 중 ' + up + '개 상승·' + down + '개 하락(평균 '
          + (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%)');
        if (cat.direction !== 0) { riskScoreSum += avg * cat.direction; riskCatCount++; }
      } else {
        var it = catItems[0];
        var note = cat.direction === -1
          ? (it.change_rate > 0 ? '(부담)' : it.change_rate < 0 ? '(완화)' : '')
          : '';
        parts.push(cat.label + ' ' + LABELS[it.symbol] + ' ' + (it.change_rate >= 0 ? '+' : '') + it.change_rate.toFixed(2) + '%' + note);
        if (cat.direction !== 0) { riskScoreSum += it.change_rate * cat.direction; riskCatCount++; }
      }
    });

    if (!parts.length) return null;
    var overallAvg = riskCatCount ? riskScoreSum / riskCatCount : 0;
    var tone = overallAvg > 0.3 ? '우호적' : overallAvg < -0.3 ? '부담' : '혼조';
    var toneClass = overallAvg > 0.3 ? 'om-tone-good' : overallAvg < -0.3 ? 'om-tone-bad' : 'om-tone-neutral';
    return {
      text: parts.join(' · ') + ' — 방향성(환율·VIX·채권은 상승=부담)을 반영하면 전반적으로 ' + tone + ' 흐름입니다.',
      toneClass: toneClass
    };
  }

  function renderSummary(container, items) {
    var box = container.querySelector('#omSummary');
    if (!box) return;
    var summary = buildSummaryText(items);
    if (!summary) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<b>전체 종합지수 요약</b> <span class="' + summary.toneClass + '">' + escapeHtml(summary.text) + '</span>';
  }

  // ---- 종합 AI 해설(GAS ?action=subIndexAnalysis, Groq) - 페이지 진입 시 1회만 호출 ----

  function fetchAiSummary() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?action=subIndexAnalysis', hasAbort ? { signal: controller.signal } : {})
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

  function renderAiSummary(container) {
    var box = container.querySelector('#omAi');
    if (!box) return;
    OvernightMarket.fetchAiSummary()
      .then(function (text) {
        if (!text) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = '<b>🤖 AI 해설</b><p>' + escapeHtml(text) + '</p>';
      })
      .catch(function () { box.hidden = true; });
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

  // VM(/futures, BTC 포함)을 SYMBOL_ORDER로 필터링해 renderAll에 넘긴다. 이 필터링이 없으면
  // renderSummary가 VM 원본 응답의 심볼(코스피200 주간/야간선물 등 이 페이지에 안 쓰는
  // 것들까지)을 전부 세어버리는 문제가 생긴다 - 과거 실제 발생한 버그.
  function refresh(container) {
    OvernightMarket.fetchFutures()
      .then(function (futuresItems) {
        var bySymbol = {};
        futuresItems.forEach(function (it) { bySymbol[it.symbol] = it; });
        var items = SYMBOL_ORDER.map(function (s) { return bySymbol[s] || { symbol: s }; });
        renderAll(container, items);
      })
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
    renderAiSummary(container);

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
    fetchFutures: fetchFutures,
    fetchAiSummary: fetchAiSummary
  };
  global.OvernightMarket = OvernightMarket;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
