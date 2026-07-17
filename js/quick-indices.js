/**
 * 관심 지수 카드 - 공시 티커 바로 아래 고정 바 (모든 페이지 공통)
 *
 * 이전 버전은 <s_notice_rep>/<s_article_rep> 글 목록의 `.post-card`를 앵커로 삼아 그 위에
 * 끼워 넣었는데, 종목분석 같은 "페이지"(글 목록이 없는 커스텀 Tistory 페이지)에서는
 * `.post-card`가 아예 없어 body 맨 앞에 끼워지면서 레이아웃이 깨졌다(2026-07-16 실사 확인).
 * 그래서 페이지 종류와 무관하게 항상 같은 자리에 뜨도록 공시 티커 바로 아래 position:fixed
 * 바로 바꿨다 - style.css의 콘텐츠 시작 좌표(.page-wrap padding-top, .sidebar-left/
 * .sidebar-right top)는 이 바의 실제 높이(--qi-height CSS 변수)를 그대로 참조하게 해뒀다.
 *
 * 폭/위치: 처음엔 뷰포트 전체 폭을 썼는데 "화면을 너무 full로 쓴다"는 피드백을 받아
 * .main-layout과 동일한 max-width로 맞췄다(css의 .qi-wrap 참고).
 *
 * 접기/펼치기: qi_collapsed_v1(localStorage)에 저장하고, --qi-height를 40px/74px로
 * 바꿔서 그 값을 그대로 아래 콘텐츠 좌표 계산에 재사용한다(style.css :root 주석 참고).
 * 페이지 로드 시 깜빡임 없이 바로 반영되도록 DOMContentLoaded를 기다리지 않고
 * 스크립트가 평가되는 즉시(동기) documentElement에 세팅한다.
 *
 * "+" 버튼: 처음엔 가로 스크롤되는 카드 줄(.qi-grid) 안에 같이 있어서 스크롤 위치에 따라
 * 팝오버가 화면 오른쪽 끝 이상한 곳에 뜨는 문제가 있었다(2026-07-16 피드백) - 스크롤 영역
 * 밖의 별도 .qi-controls로 빼서 항상 버튼 바로 아래에 뜨게 고쳤다.
 *
 * 데이터 소스 2곳:
 * - 원달러/BTC: GAS ?market=1 (과거 시세 이력이 없어 미니차트 불가 - 카드에 차트 생략)
 * - 코스피/코스닥/코스피200 야간선물/나스닥100/S&P500/필라델피아(SOX)/VIX/WTI:
 *   VM(https://goodbyestar.cloud/futures) (js/overnight-market.js와 같은 응답을 쓰는데, 그
 *   응답엔 최근 시세 배열(chart)이 이미 들어있어서 그걸 그대로 미니 스파크라인으로 그린다 -
 *   렌더링 방식도 overnight-market.js와 동일)
 *
 * 2026-07-16: 코스피/코스닥을 'market'(GAS, 이력 없음)에서 'futures'(VM, 이력 있음)로 전환해
 * 미니차트가 뜨게 했다 - VM의 chart/domestic/index/{KOSPI|KOSDAQ}/day 데이터를 "변동폭이
 * 튀어 신뢰 불가"로 오판해서 한동안 코스피 현물지수 수집 자체를 뺐었는데, 실시간 시세와
 * 대조해보니 실제로 정확한 데이터였음이 밝혀져 정정함(scripts/cloud-vm/domestic_futures.py
 * 상단 주석 참고). 원달러/BTC는 그대로 market 소스 유지(원달러는 VM에도 USDKRW로 있지만
 * 이 리본까지 굳이 바꿀 필요는 없어서 손대지 않음, BTC는 VM이 아예 안 다룸).
 *
 * 60초마다 갱신하되, 매번 카드를 통째로 비웠다가 다시 그리면 깜빡임이 생겨서(2026-07-16
 * 피드백) 최초 1회만 "불러오는 중" 틀을 그리고, 이후 갱신은 기존 DOM 노드의 텍스트/톤만 바꾼다.
 *
 * 2026-07-17: 가로 드래그 스크롤을 없애고 좌우 화살표 페이징으로 교체(사용자 요청 - 참고
 * 이미지 스타일, 미니차트는 유지). 선택된 지수 전체 데이터는 그대로 fetch해서 dataCache에
 * 담아두고, 화면(#qiScroll)에는 현재 페이지 분량만 그린다 - 페이지를 넘겨도 새로 fetch하지
 * 않고 캐시에서 바로 채운다. 한 페이지에 몇 장이 들어가는지(perPage)는 #qiScroll의 실제
 * 렌더링 폭을 재서 카드 폭(208px)+gap(8px)으로 나눈 값이라 화면 폭에 따라 자동으로
 * 달라진다(리사이즈 시 재계산).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FUTURES_API = 'https://goodbyestar.cloud/futures';
  var CONTAINER_ID = 'quick-indices';
  var STORAGE_KEY = 'qi_selected_v1';
  var COLLAPSE_KEY = 'qi_collapsed_v1';
  var HEIGHT_EXPANDED = '74px';
  var HEIGHT_COLLAPSED = '40px';
  var REFRESH_MS = 60 * 1000;
  var FETCH_TIMEOUT_MS = 8000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var SPARKLINE_HEIGHT = 30;
  var CARD_WIDTH = 208;
  var CARD_GAP = 8;

  // 페이지 파싱 도중이라도(DOMContentLoaded 전) 즉시 반영해 접힘 상태 깜빡임을 없앤다.
  (function applyCollapsedHeightEarly() {
    var collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (err) { /* 무시 */ }
    document.documentElement.style.setProperty('--qi-height', collapsed ? HEIGHT_COLLAPSED : HEIGHT_EXPANDED);
  })();

  var OPTIONS = [
    { key: 'kospi', label: '코스피', source: 'futures', sourceKey: 'KOSPI' },
    { key: 'kosdaq', label: '코스닥', source: 'futures', sourceKey: 'KOSDAQ' },
    { key: 'usdkrw', label: '원/달러', source: 'market', sourceKey: 'usdkrw' },
    { key: 'btc', label: 'BTC', source: 'market', sourceKey: 'btc' },
    { key: 'kospi_night', label: '코스피 야간선물', source: 'futures', sourceKey: 'KOSPI200_NIGHT' },
    { key: 'nasdaq', label: '나스닥 선물', source: 'futures', sourceKey: 'NASDAQ100' },
    { key: 'sp500', label: 'S&P500 선물', source: 'futures', sourceKey: 'SP500' },
    { key: 'dow', label: '다우 선물', source: 'futures', sourceKey: 'DOW' },
    { key: 'sox', label: '필라델피아', source: 'futures', sourceKey: 'SOX' },
    { key: 'wti', label: '원유', source: 'futures', sourceKey: 'WTI' },
    { key: 'vix', label: 'VIX', source: 'futures', sourceKey: 'VIX' }
  ];
  var OPTION_BY_KEY = {};
  OPTIONS.forEach(function (o) { OPTION_BY_KEY[o.key] = o; });
  var DEFAULT_SELECTED = ['kospi', 'kosdaq', 'usdkrw', 'btc'];

  var refreshTimer = null;
  var resizeTimer = null;
  var lwcLoadPromise = null;
  var chartInstances = {}; // key -> { chart, series }
  var themeObserver = null;
  var moduleContainer = null;
  var currentPage = 0;
  var dataCache = {}; // key -> {price, change, changeRate, chart} - 마지막으로 받은 값(페이지 전환 시 재사용)
  var measuredCardWidth = null; // 640px 이하에서 .qi-card 폭이 168px로 바뀌므로 CARD_WIDTH 상수 대신 실측(리사이즈 시 무효화)

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  // ---- localStorage: 선택 목록 ----

  function loadSelected() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return DEFAULT_SELECTED.slice();
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return DEFAULT_SELECTED.slice();
      return list.filter(function (k) { return OPTION_BY_KEY.hasOwnProperty(k); });
    } catch (err) {
      return DEFAULT_SELECTED.slice();
    }
  }

  function saveSelected(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (err) { /* 프라이빗 모드 등 무시 */ }
  }

  function toggleSelected(key) {
    var list = loadSelected();
    var idx = list.indexOf(key);
    if (idx > -1) list.splice(idx, 1);
    else list.push(key);
    saveSelected(list);
    return list;
  }

  // ---- localStorage: 접힘 상태 ----

  function isCollapsed() {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (err) { return false; }
  }
  function saveCollapsed(collapsed) {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (err) { /* 무시 */ }
  }

  // ---- 데이터 조회 ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error('응답 오류: ' + r.status); return r.json(); })
      .then(function (data) { if (timer) clearTimeout(timer); return data; })
      .catch(function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  function fetchMarket() { return fetchJson(GAS_TICKER_URL + '?market=1'); }
  function fetchFutures() { return fetchJson(FUTURES_API).then(function (json) { return json.data || []; }); }

  function fetchSelectedData(selected) {
    var needMarket = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'market'; });
    var needFutures = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'futures'; });

    return Promise.all([
      needMarket ? QuickIndices.fetchMarket().catch(function () { return null; }) : Promise.resolve(null),
      needFutures ? QuickIndices.fetchFutures().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (results) {
      var marketData = results[0] || {};
      var futuresBySymbol = {};
      (results[1] || []).forEach(function (it) { futuresBySymbol[it.symbol] = it; });

      var out = {};
      selected.forEach(function (key) {
        var opt = OPTION_BY_KEY[key];
        if (opt.source === 'market') {
          var m = marketData[opt.sourceKey];
          if (m) out[key] = { price: m.price, change: m.change, changeRate: m.changeRate, chart: null };
        } else {
          var f = futuresBySymbol[opt.sourceKey];
          if (f && typeof f.price === 'number') out[key] = { price: f.price, change: f.change, changeRate: f.change_rate, chart: f.chart || null };
        }
      });
      return out;
    });
  }

  // ---- 포맷/톤 ----

  function toneClass(change) {
    if (change > 0) return 'qi-pos';
    if (change < 0) return 'qi-neg';
    return 'qi-zero';
  }
  function arrowSymbol(change) {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '';
  }
  function formatNumber(n) {
    var num = Number(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString('ko-KR', { maximumFractionDigits: num >= 1000 ? 0 : 2 });
  }

  // ---- 마운트: 페이지 종류와 무관하게 항상 공시 티커 아래 고정 ----

  function ensureContainer() {
    var existing = document.getElementById(CONTAINER_ID);
    if (existing) return existing;

    var el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.className = 'qi-wrap';
    document.body.appendChild(el); // position:fixed라 DOM 위치는 스타일에 영향 없음
    return el;
  }

  // ---- 최초 렌더(틀 생성) ----

  function buildCardShell(opt) {
    return '<div class="qi-card" data-key="' + opt.key + '" draggable="true">'
      + '<div class="qi-card-label">' + opt.label + '</div>'
      + '<div class="qi-card-price" data-field="price">-</div>'
      + '<div class="qi-card-change" data-field="change"></div>'
      + '<div class="qi-card-chart" data-field="chart"></div>'
      + '</div>';
  }

  // ---- 카드 순서 드래그 (2026-07-16 추가: 바 위치 자체는 고정, 카드 순서만 바꿀 수 있게) ----

  var dragKey = null;

  function wireCardDrag(scroll) {
    scroll.addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.qi-card') : null;
      if (!card) return;
      dragKey = card.getAttribute('data-key');
      card.classList.add('qi-dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    scroll.addEventListener('dragend', function (e) {
      var card = e.target.closest ? e.target.closest('.qi-card') : null;
      if (card) card.classList.remove('qi-dragging');
      dragKey = null;
    });
    scroll.addEventListener('dragover', function (e) {
      if (!dragKey) return;
      e.preventDefault(); // 드롭 허용
      var card = e.target.closest ? e.target.closest('.qi-card') : null;
      if (!card) return;
      var targetKey = card.getAttribute('data-key');
      if (targetKey === dragKey) return;
      var dragging = scroll.querySelector('.qi-card[data-key="' + dragKey + '"]');
      if (!dragging) return;
      var rect = card.getBoundingClientRect();
      var before = (e.clientX - rect.left) < rect.width / 2;
      scroll.insertBefore(dragging, before ? card : card.nextSibling);
    });
    scroll.addEventListener('drop', function (e) {
      e.preventDefault();
      persistCardOrder(scroll);
    });
  }

  // 페이징 도입 이후 #qiScroll에는 현재 페이지 분량만 들어있어서, 그 순서를 그대로
  // 저장하면 다른 페이지의 항목이 사라진다 - 전체 목록 중 현재 페이지 구간만 새 순서로
  // 갈아끼운다.
  function persistCardOrder(scroll) {
    var pageOrder = Array.prototype.map.call(scroll.querySelectorAll('.qi-card'), function (c) {
      return c.getAttribute('data-key');
    });
    var full = loadSelected();
    var perPage = moduleContainer ? getPerPage(moduleContainer) : pageOrder.length;
    var start = currentPage * perPage;
    var newFull = full.slice(0, start).concat(pageOrder).concat(full.slice(start + pageOrder.length));
    saveSelected(newFull);
  }

  // 카드는 여기서 채우지 않는다 - renderPage()가 현재 페이지 분량만 그린다.
  function renderShell(container) {
    container.classList.toggle('qi-collapsed', isCollapsed());
    container.innerHTML = ''
      + '<button type="button" class="qi-page-btn qi-page-prev" id="qiPrevBtn" aria-label="이전 지수">‹</button>'
      + '<div class="qi-scroll" id="qiScroll"></div>'
      + '<button type="button" class="qi-page-btn qi-page-next" id="qiNextBtn" aria-label="다음 지수">›</button>'
      + '<div class="qi-controls">'
      + '<button type="button" class="qi-collapse-btn" id="qiCollapseBtn" aria-label="관심지수 접기/펼치기">' + (isCollapsed() ? '▸' : '▾') + '</button>'
      + '<div class="qi-add-wrap">'
      + '<button type="button" class="qi-add-btn" id="qiAddBtn" aria-label="지수 추가">+</button>'
      + '<div class="qi-popover" id="qiPopover"></div>'
      + '</div>'
      + '</div>';

    container.querySelector('#qiAddBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      togglePopover(container);
    });
    container.querySelector('#qiCollapseBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      setCollapsed(container, !isCollapsed());
    });
    container.querySelector('#qiPrevBtn').addEventListener('click', function () {
      currentPage -= 1;
      renderPage(container);
    });
    container.querySelector('#qiNextBtn').addEventListener('click', function () {
      currentPage += 1;
      renderPage(container);
    });
    wireCardDrag(container.querySelector('#qiScroll'));
  }

  function setCollapsed(container, collapsed) {
    saveCollapsed(collapsed);
    document.documentElement.style.setProperty('--qi-height', collapsed ? HEIGHT_COLLAPSED : HEIGHT_EXPANDED);
    container.classList.toggle('qi-collapsed', collapsed);
    var btn = container.querySelector('#qiCollapseBtn');
    if (btn) btn.textContent = collapsed ? '▸' : '▾';
    // 접혀있는 동안(#qiScroll이 display:none) clientWidth가 0이라 perPage가 1로 잘못
    // 계산돼 있을 수 있다 - 펼칠 때 실제 폭 기준으로 다시 계산한다.
    if (!collapsed) renderPage(container);
  }

  // ---- 갱신(기존 카드 값만 업데이트 - 깜빡임 방지) ----

  function applyCardData(scroll, key, data) {
    var card = scroll.querySelector('.qi-card[data-key="' + key + '"]');
    if (!card) return;
    var priceEl = card.querySelector('[data-field="price"]');
    var changeEl = card.querySelector('[data-field="change"]');
    var chartEl = card.querySelector('[data-field="chart"]');

    if (!data) {
      priceEl.textContent = '-';
      changeEl.textContent = '';
      return;
    }
    var tone = toneClass(data.change);
    priceEl.textContent = formatNumber(data.price);
    priceEl.className = 'qi-card-price ' + tone;
    changeEl.textContent = arrowSymbol(data.change) + Math.abs(data.changeRate).toFixed(2) + '%';
    changeEl.className = 'qi-card-change ' + tone;

    if (data.chart && data.chart.length > 1) renderSparkline(chartEl, key, data.chart);
  }

  // ---- 페이징: #qiScroll의 실제 렌더링 폭 / (카드 폭 + gap)으로 한 페이지에 들어갈
  // 카드 수를 구한다. 접힌 상태(width 0)일 때는 최소 1을 보장한다. ----

  // 카드 실제 폭을 잰다(640px 이하 미디어쿼리에서 168px로 줄어들기 때문에 CARD_WIDTH
  // 상수를 그대로 쓰면 모바일에서 perPage가 틀어진다) - 화면에 카드가 하나도 없으면
  // 숨겨진 probe 엘리먼트를 하나 잠깐 넣어서 재고 지운다.
  function getCardWidth(scroll) {
    if (measuredCardWidth) return measuredCardWidth;
    var existing = scroll.querySelector('.qi-card');
    if (existing) {
      measuredCardWidth = existing.getBoundingClientRect().width;
      return measuredCardWidth || CARD_WIDTH;
    }
    var probe = document.createElement('div');
    probe.className = 'qi-card';
    probe.style.visibility = 'hidden';
    probe.style.position = 'absolute';
    scroll.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    scroll.removeChild(probe);
    if (w) measuredCardWidth = w;
    return measuredCardWidth || CARD_WIDTH;
  }

  function getPerPage(container) {
    var scroll = container.querySelector('#qiScroll');
    if (!scroll) return 1;
    var w = scroll.clientWidth;
    if (!w) return 1;
    var cardWidth = getCardWidth(scroll);
    var n = Math.floor((w + CARD_GAP) / (cardWidth + CARD_GAP));
    return Math.max(1, n);
  }

  function updatePagerUI(container, page, totalPages) {
    var prev = container.querySelector('#qiPrevBtn');
    var next = container.querySelector('#qiNextBtn');
    if (prev) prev.disabled = page <= 0;
    if (next) next.disabled = page >= totalPages - 1;
  }

  // 현재 페이지 분량만 새로 그리고, dataCache에 있는 값으로 즉시 채운다(재조회 없음).
  function renderPage(container) {
    var scroll = container.querySelector('#qiScroll');
    if (!scroll) return;
    var selected = loadSelected();
    var perPage = getPerPage(container);
    var totalPages = Math.max(1, Math.ceil(selected.length / perPage));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;
    var start = currentPage * perPage;
    var pageKeys = selected.slice(start, start + perPage);

    Object.keys(chartInstances).forEach(function (key) {
      if (pageKeys.indexOf(key) === -1) destroyChart(key);
    });

    scroll.innerHTML = pageKeys.map(function (key) {
      var opt = OPTION_BY_KEY[key];
      return opt ? buildCardShell(opt) : '';
    }).join('');

    pageKeys.forEach(function (key) {
      if (dataCache.hasOwnProperty(key)) applyCardData(scroll, key, dataCache[key]);
    });

    updatePagerUI(container, currentPage, totalPages);
  }

  // 체크박스로 선택이 바뀌었을 때: 아직 캐시에 없는(새로 추가된) 항목만 조회하고,
  // 화면은 바로 현재 페이지 기준으로 다시 그린다.
  function onSelectionChanged(container, selected) {
    renderPage(container);
    var missing = selected.filter(function (k) { return !dataCache.hasOwnProperty(k); });
    if (!missing.length) return;
    fetchSelectedData(missing)
      .then(function (dataByKey) {
        Object.keys(dataByKey).forEach(function (k) { dataCache[k] = dataByKey[k]; });
        renderPage(container);
      })
      .catch(function (err) { logError('[quick-indices] 조회 실패', err); });
  }

  // ---- 미니 스파크라인 (js/overnight-market.js와 동일한 Lightweight Charts 지연 로드 패턴) ----

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

  function chartThemeOptions() {
    return {
      layout: { background: { color: 'transparent' }, textColor: '#888', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } }
    };
  }

  function toLwcTime(yyyymmdd) {
    var s = String(yyyymmdd);
    if (s.indexOf('-') > -1) return s; // 이미 YYYY-MM-DD
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function destroyChart(key) {
    var inst = chartInstances[key];
    if (!inst) return;
    try { inst.chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
    delete chartInstances[key];
  }

  // 2026-07-16: 단일 색 영역차트 -> 베이스라인 차트로 변경. 시작가(구간 첫 종가)를
  // 기준선으로 두고 그 위는 빨강, 아래는 파랑으로 자동으로 나뉘어 칠해진다(사용자 요청:
  // "시초가 0이면 +면 빨간색 -면 파란색"). change 파라미터는 더 이상 필요 없어 제거.
  function renderSparkline(container, key, rows) {
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;
      if (chartInstances[key]) return; // 같은 카드에 이미 그려져 있으면 재사용(갱신 시 setData만)

      var chart = LWC.createChart(container, Object.assign({
        autoSize: true,
        height: SPARKLINE_HEIGHT,
        handleScroll: false,
        handleScale: false,
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: { visible: false },
        crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } }
      }, chartThemeOptions()));

      var series = chart.addBaselineSeries({
        baseValue: { type: 'price', price: rows[0].close },
        topLineColor: '#d24f45',
        topFillColor1: hexToRgba('#d24f45', 0.25),
        topFillColor2: hexToRgba('#d24f45', 0.02),
        bottomLineColor: '#1261c4',
        bottomFillColor1: hexToRgba('#1261c4', 0.02),
        bottomFillColor2: hexToRgba('#1261c4', 0.25),
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(rows.map(function (r) { return { time: toLwcTime(r.date), value: r.close }; }));
      chart.timeScale().fitContent();
      chartInstances[key] = { chart: chart, series: series };
    }).catch(function () { /* 차트 없이도 가격/등락률은 이미 보이므로 조용히 무시 */ });
  }

  // ---- "+ 지수 추가" 팝오버 (스크롤 영역 밖 .qi-controls에 있어 버튼 바로 아래에 뜬다) ----

  function renderPopover(container, selected) {
    var pop = container.querySelector('#qiPopover');
    if (!pop) return;
    pop.innerHTML = OPTIONS.map(function (opt) {
      var checked = selected.indexOf(opt.key) > -1;
      return '<label class="qi-pop-item">'
        + '<input type="checkbox" data-key="' + opt.key + '"' + (checked ? ' checked' : '') + ' />'
        + '<span>' + opt.label + '</span>'
        + '</label>';
    }).join('');
  }

  function togglePopover(container) {
    var pop = container.querySelector('#qiPopover');
    if (!pop) return;
    var willOpen = !pop.classList.contains('open');
    if (willOpen) renderPopover(container, loadSelected());
    pop.classList.toggle('open', willOpen);
  }

  function closePopover(container) {
    var pop = container.querySelector('#qiPopover');
    if (pop) pop.classList.remove('open');
  }

  function wireEvents(container) {
    container.addEventListener('click', function (e) {
      var input = e.target.closest ? e.target.closest('input[type="checkbox"]') : null;
      if (!input) return;
      var key = input.getAttribute('data-key');
      var list = toggleSelected(key);
      // 2026-07-16 버그 수정: 예전엔 여기서 rebuild()(전체 다시 그리기)를 불러서 팝오버
      // 자체가 통째로 새로 그려지며 열림 상태(class="open")가 사라졌다 - 체크할 때마다
      // 팝오버가 닫혀버려 하나씩만 추가/제거할 수 있었던 원인. 이제 팝오버는 그대로 두고
      // 카드 목록(현재 페이지)만 다시 그려 여러 개를 연달아 체크/해제해도 열려있는 채로 있다.
      onSelectionChanged(container, list);
    });

    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) closePopover(container);
    });
  }

  // 선택 목록 자체가 바뀔 때만(최초 로드) 틀을 다시 그린다.
  function rebuild(container, selected) {
    Object.keys(chartInstances).forEach(destroyChart);
    currentPage = 0;
    renderShell(container);
    if (!selected.length) { renderPage(container); return; }
    renderPage(container); // 캐시가 있으면(재초기화 등) 바로 채우고, 없으면 '-' 상태로 우선 표시
    fetchSelectedData(selected)
      .then(function (dataByKey) {
        dataCache = dataByKey;
        renderPage(container);
      })
      .catch(function (err) { logError('[quick-indices] 조회 실패', err); });
  }

  // 주기적 갱신은 틀을 다시 그리지 않고 값만 바꿔서 깜빡임을 없앤다(2026-07-16 피드백).
  // 페이지 전환과 무관하게 선택된 전체 종목을 계속 조회해 dataCache를 채워둔다.
  function refresh(container) {
    var selected = loadSelected();
    if (!selected.length) return;
    fetchSelectedData(selected)
      .then(function (dataByKey) {
        dataCache = dataByKey;
        var scroll = container.querySelector('#qiScroll');
        if (!scroll) return;
        Array.prototype.forEach.call(scroll.querySelectorAll('.qi-card'), function (card) {
          var key = card.getAttribute('data-key');
          applyCardData(scroll, key, dataByKey[key]);
        });
      })
      .catch(function (err) { logError('[quick-indices] 갱신 실패', err); });
  }

  function init() {
    var container = ensureContainer();
    moduleContainer = container;
    wireEvents(container);
    rebuild(container, loadSelected());

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.hidden) return;
      refresh(container);
    }, REFRESH_MS);

    // 창 크기가 바뀌면 한 페이지에 들어가는 카드 수(perPage)도 바뀌므로 다시 계산해서
    // 그린다 - 리사이즈 중 매 프레임 다시 그리지 않도록 짧게 디바운스한다.
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        measuredCardWidth = null; // 640px 브레이크포인트를 넘나들면 카드 폭이 바뀌므로 다시 잰다
        renderPage(container);
      }, 150);
    });

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      Object.keys(chartInstances).forEach(function (key) {
        chartInstances[key].chart.applyOptions(chartThemeOptions());
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  var QuickIndices = { init: init, fetchMarket: fetchMarket, fetchFutures: fetchFutures };
  global.QuickIndices = QuickIndices;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
