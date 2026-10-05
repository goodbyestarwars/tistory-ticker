/**
 * 미국주식 페이지 - 공통 검색에서 연결되는 미국 개별주식 1차 화면.
 * 시세·등락·거래량·고저가·장 상태는 KIS WebSocket 실시간 체결로 갱신하고(연결 중), 연결이 없을 때만 15초마다 다시 조회한다.
 * 차트·재무·실적 데이터는 다음 단계에서 같은 ticker API에 붙인다.
 */
(function (global) {
  'use strict';

  var API_BASE = 'https://goodbyestar.cloud';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/us-stocks.css?v=20260828-domestic-layout-parity-v2';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var REFRESH_MS = 15000;
  // 공개 호가 API의 분당 30회 제한 아래에서, 완료된 요청 다음에만 재조회한다.
  var ORDERBOOK_REFRESH_MS = 3000;
  var ORDERBOOK_TIMEOUT_MS = 10000;
  var REALTIME_QUOTES_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var REALTIME_RECONNECT_MS = 5000;
  var LAST_SYMBOL_KEY = 'us:lastSelected';
  var DEFAULT_SYMBOL = 'AAPL';
  var state = { container: null, symbol: null, refreshTimer: null, realtimeSocket: null, realtimeTimer: null, realtimeGeneration: 0, initialized: false, embedded: false, renderedSymbol: null, detailLoadedSymbol: null, quoteRetryTimer: null, nativeChartPromise: null, lastQuote: null, realtimeLive: false };
  state.orderbookTimer = null;
  state.orderbookRequest = null;
  state.orderbookGeneration = 0;
  state.lastOrderbook = null;
  state.paused = false;
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: '애플', aliases: '애플 apple apple inc' },
    { symbol: 'MSFT', name: '마이크로소프트', aliases: '마이크로소프트 microsoft microsoft corporation' },
    { symbol: 'NVDA', name: '엔비디아', aliases: '엔비디아 nvidia nvidia corporation' },
    { symbol: 'AMZN', name: '아마존', aliases: '아마존 amazon amazon.com' },
    { symbol: 'GOOGL', name: '구글', aliases: '구글 알파벳 google alphabet alphabet inc' },
    { symbol: 'TSLA', name: '테슬라', aliases: '테슬라 tesla' },
    { symbol: 'META', name: '메타', aliases: '메타 meta 페이스북 facebook' },
    { symbol: 'INTC', name: '인텔', aliases: '인텔 intel intel corporation' },
    { symbol: 'SPCX', name: '스페이스X', aliases: '스페이스X spacex' },
    { symbol: 'SKHY', name: 'SK하이닉스(ADR)', aliases: 'SK하이닉스 하이닉스 sk hynix' },
    { symbol: 'MRVL', name: '마벨 테크놀로지', aliases: '마벨 마벨테크놀로지 marvell marvell technology' },
    { symbol: 'RGTI', name: '리게티 컴퓨팅', aliases: '리게티 rigetti rigetti computing' },
    { symbol: 'RKLB', name: '로켓 랩', aliases: '로켓랩 로켓 랩 rocket lab' },
    { symbol: 'AVGO', name: '브로드컴', aliases: '브로드컴 broadcom broadcom inc' },
    { symbol: 'ORCL', name: '오라클', aliases: '오라클 oracle oracle corporation' },
    { symbol: 'MU', name: '마이크론 테크놀로지', aliases: '마이크론 마이크론테크놀로지 micron micron technology' },
    { symbol: 'CBRS', name: '세레브라스 시스템즈', aliases: '세레브라스 cerebras cerebras systems' },
    { symbol: 'PLTR', name: '팔란티어', aliases: '팔란티어 palantir palantir technologies' },
    { symbol: 'SNDK', name: '샌디스크', aliases: '샌디스크 sandisk' },
    { symbol: 'DELL', name: '델 테크놀로지스', aliases: '델 델테크놀로지스 dell dell technologies' },
    { symbol: 'IONQ', name: '아이온큐', aliases: '아이온큐 ionq' },
    { symbol: 'LLY', name: '일라이 릴리', aliases: '일라이릴리 일라이 릴리 eli lilly lilly' },
    { symbol: 'ASTS', name: 'AST 스페이스모바일', aliases: 'ast asts 스페이스모바일 spacemobile ast spacemobile' },
    { symbol: 'AMD', name: 'AMD', aliases: 'amd advanced micro devices' },
    { symbol: 'NFLX', name: '넷플릭스', aliases: '넷플릭스 netflix' },
    { symbol: 'SPY', name: 'S&P 500 ETF', aliases: 'spy s&p500 spdr' },
    { symbol: 'QQQ', name: '인베스코 QQQ ETF', aliases: 'qqq 나스닥 invesco' }
  ];

  function localizedUsName(symbol, fallback) {
    var code = String(symbol || '').replace(/^US:/i, '').toUpperCase();
    var local = LOCAL_US_SYMBOLS.find(function (row) { return row.symbol === code; });
    var safeFallback = String(fallback || '').trim();
    return local ? local.name : (/[가-힣]/.test(safeFallback) ? safeFallback : '미국 종목');
  }

  function exchangeLabel(value) {
    var code = String(value || '').toUpperCase();
    return {
      US: '미국', NAS: '나스닥', NMS: '나스닥', NASDAQ: '나스닥', ND: '나스닥',
      NYS: '뉴욕증권거래소', NY: '뉴욕증권거래소', NYSE: '뉴욕증권거래소', NYQ: '뉴욕증권거래소',
      AMS: '아멕스', NA: '아멕스', AMEX: '아멕스', ASE: '아멕스'
    }[code] || (value ? '미국 거래소' : '-');
  }

  function init(targetContainer) {
    var container = targetContainer || document.querySelector('#stock-search');
    if (!container) return;
    if (state.initialized && state.container === container) return;
    state.container = container;
    state.embedded = !!targetContainer;
    state.initialized = true;
    injectStyles();
    if (!targetContainer) {
      document.title = document.title.replace(/증시검색|실시간 시세/g, '미국주식');
      document.querySelectorAll('.post-single-title').forEach(function (title) {
        if (/증시검색|실시간 시세/.test(title.textContent.trim())) title.textContent = '미국주식';
      });
    }
    container.innerHTML = buildShell(state.embedded);
    wireSearch();
    autoSelect();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopRefresh(); stopRealtime(); }
      else if (canRefresh()) { refreshQuote(); startRefresh(); startRealtime(); }
    });
  }

  // 2026-09-02 사용자 리포트("UI가 왜 그래?" - 라벨과 값이 붙고 호가표가 무너진 화면).
  // 이 스타일시트는 skin.html의 <link>가 아니라 여기서 런타임에 꽂는데, 예전에는 로드
  // 완료를 기다리지 않고 곧바로 내용을 그렸다. 데이터는 우리 VM에서 빨리 오는 반면
  // CSS는 GitHub Pages로 가는 별도 연결(DNS+TLS)이라, 모바일 셀룰러에서 그 사이가
  // 벌어지면 "값은 다 찼는데 스타일만 없는" 화면이 그대로 보인다. 요청이 실패하면
  // 영구히 그 상태로 남는다.
  //
  // js/home-weekly-report.js가 같은 문제에 쓴 방식(ensureStyle/whenStyleReady)을 따른다.
  // 다만 여기서는 스타일을 못 받아도 화면을 영영 숨기지 않는다 - 스타일 없는 값이라도
  // 아무것도 없는 것보다는 낫기 때문에, 짧은 타임아웃 뒤에는 그냥 그린다.
  var STYLE_WAIT_MS = 2500;
  var styleReady = false;
  var stylePending = [];

  function flushStylePending() {
    if (styleReady) return;
    styleReady = true;
    var queued = stylePending.slice();
    stylePending.length = 0;
    // 대기 중인 콜백 하나가 실패해도 나머지는 실행되게 한다.
    queued.forEach(function (fn) {
      try { fn(); } catch (e) { if (global.console && console.error) console.error(e); }
    });
  }

  function injectStyles() {
    var existing = document.querySelector('link[data-us-stocks-css]');
    if (existing) {
      // 이미 꽂혀 있으면 로드가 끝났는지 확인한다(다른 진입점이 먼저 넣었을 수 있다).
      if (existing.sheet) flushStylePending();
      else {
        existing.addEventListener('load', flushStylePending);
        existing.addEventListener('error', flushStylePending);
        setTimeout(flushStylePending, STYLE_WAIT_MS);
      }
      return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    link.setAttribute('data-us-stocks-css', '1');
    link.addEventListener('load', flushStylePending);
    link.addEventListener('error', flushStylePending);   // 실패해도 화면은 그린다
    document.head.appendChild(link);
    setTimeout(flushStylePending, STYLE_WAIT_MS);
  }

  function whenStyleReady(fn) {
    if (styleReady) { fn(); return; }
    stylePending.push(fn);
  }

  function buildShell(isEmbedded) {
    if (isEmbedded) {
      // 국내 화면의 공통 검색창(ss-search)은 stock-search.js가 이미 렌더링한다.
      // 미국 모듈이 자체 헤더·검색창을 다시 만들면 화면이 중복되므로 상세 영역만 임베드한다.
      return '<section class="us-stocks-shell us-stocks-embedded">'
        + '<div id="usStocksDetail" class="us-stocks-detail ss-detail" hidden></div>'
        + '</section>';
    }
    return '<section class="us-stocks-shell">'
      + '<div class="us-stocks-heading"><div><span class="us-stocks-eyebrow">미국 시장</span><h2>미국주식</h2></div>'
      + '<span class="us-stocks-note">한국·미국 통합 시세</span></div>'
      + '<div class="us-stocks-search">'
      + '<div class="us-stocks-input-wrap">'
      + '<input id="usStocksInput" type="search" placeholder="미국 티커 또는 종목명 (예: AAPL, 엔비디아)" autocomplete="off" aria-label="미국주식 검색">'
      + '<div id="usStocksSuggest" class="us-stocks-suggest"></div>'
      + '</div>'
      + '<button type="button" id="usStocksSearchBtn">검색</button>'
      + '</div>'
      + '<div id="usStocksResults" class="us-stocks-results" hidden></div>'
      + '<div id="usStocksDetail" class="us-stocks-detail" hidden></div>'
      + '<p class="us-stocks-disclaimer">증권사 API 상태와 거래소 시간대에 따라 지연될 수 있습니다.</p>'
      + '</section>';
  }

  function wireSearch() {
    var input = document.querySelector('#usStocksInput');
    var button = document.querySelector('#usStocksSearchBtn');
    if (!input || !button) return;
    input.addEventListener('input', function () { searchSuggestions(input.value.trim()); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); search(input.value.trim()); }
      if (event.key === 'Escape') hideSuggestions();
    });
    button.addEventListener('click', function () { search(input.value.trim()); });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.us-stocks-input-wrap')) hideSuggestions();
    });
  }

  function autoSelect() {
    var params = new URLSearchParams(location.search);
    var code = (params.get('code') || '').trim();
    var symbol = /^US:/i.test(code) ? code.slice(3).toUpperCase() : readLastSymbol();
    select(symbol || DEFAULT_SYMBOL);
  }

  function readLastSymbol() {
    try {
      var value = String(localStorage.getItem(LAST_SYMBOL_KEY) || '').toUpperCase();
      return /^[A-Z][A-Z0-9.\-^=]{0,11}$/.test(value) ? value : '';
    } catch (err) { return ''; }
  }

  function searchSuggestions(query) {
    if (!query) { hideSuggestions(); return; }
    searchRows(query, 6)
      .then(function (rows) {
        var box = document.querySelector('#usStocksSuggest');
        if (!box || !rows.length) { hideSuggestions(); return; }
        box.innerHTML = rows.map(function (row) {
          return '<button type="button" class="us-stocks-suggest-item" data-symbol="' + escapeAttr(row.symbol) + '">'
            + '<b>' + escapeHtml(row.symbol) + '</b><span>' + escapeHtml(row.name) + '</span><small>' + escapeHtml(row.exchange || '') + '</small></button>';
        }).join('');
        box.classList.add('active');
        box.querySelectorAll('[data-symbol]').forEach(function (button) {
          button.addEventListener('click', function () {
            var input = document.querySelector('#usStocksInput');
            if (input) input.value = button.getAttribute('data-symbol');
            hideSuggestions();
            select(button.getAttribute('data-symbol'));
          });
        });
      })
      .catch(function () { hideSuggestions(); });
  }

  function search(query) {
    if (!query) return;
    hideSuggestions();
    var results = document.querySelector('#usStocksResults');
    if (!results) return;
    results.hidden = false;
    results.innerHTML = '<div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>미국주식 시세를 불러오는 중...</div>';
    searchRows(query, 8)
      .then(function (rows) {
        if (!rows.length) throw new Error('NO_RESULTS');
        return Promise.all(rows.map(function (row) {
          return fetchJson(API_BASE + '/us-quote/' + encodeURIComponent(row.symbol))
            .then(function (quote) { return { row: row, quote: quote }; })
            .catch(function () { return { row: row, quote: null }; });
        }));
      })
      .then(function (items) {
        results.innerHTML = '<div class="us-stocks-result-count">검색 결과 ' + items.length + '건</div>'
          + '<div class="us-stocks-results-head" aria-hidden="true">'
          + '<span>종목</span><span>현재가</span><span>등락률</span><span>거래량</span><span>시장</span><span>관심</span>'
          + '</div>'
          + items.map(resultRowHtml).join('');
        results.querySelectorAll('[data-symbol]').forEach(function (row) {
          row.addEventListener('click', function (event) {
            if (event.target.closest('.us-stocks-fav-btn')) return;
            select(row.getAttribute('data-symbol'));
          });
          row.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              select(row.getAttribute('data-symbol'));
            }
          });
        });
        results.querySelectorAll('.us-stocks-fav-btn').forEach(function (button) {
          button.addEventListener('click', function (event) {
            event.stopPropagation();
            toggleFavorite(button);
          });
        });
      })
      .catch(function () {
        results.innerHTML = '<div class="us-stocks-empty us-stocks-error">해당 미국주식 데이터를 찾지 못했어요.</div>';
      });
  }

  function resultRowHtml(item) {
    var quote = item.quote || {};
    var cls = signClass(quote.change_rate);
    var symbol = String(item.row.symbol || '').toUpperCase();
    var code = 'US:' + symbol;
    var isFav = !!(global.Watchlist && global.Watchlist.has(code));
    var exchange = exchangeLabel(quote.exchange || item.row.exchange || '-');
    var displayName = localizedUsName(symbol, item.row.name);
    return '<div role="button" tabindex="0" class="us-stocks-result-row" data-symbol="' + escapeAttr(symbol) + '">'
      + '<span class="us-stocks-result-name"><b>' + escapeHtml(item.row.symbol) + '</b><small>' + escapeHtml(displayName) + '</small></span>'
      + '<span class="' + cls + '">' + formatPrice(quote.price) + '</span>'
      + '<span class="' + cls + '">' + formatPercent(quote.change_rate) + '</span>'
      + '<span>' + formatVolume(quote.volume) + '</span>'
      + '<span class="us-stocks-result-market">' + escapeHtml(exchange) + '</span>'
      + '<span class="us-stocks-result-favorite"><button type="button" class="us-stocks-fav-btn' + (isFav ? ' active' : '') + '" data-code="' + escapeAttr(code) + '" data-name="' + escapeAttr(displayName) + '" title="관심종목에 추가/제거" aria-label="관심종목 토글">★</button></span>'
      + '</div>';
  }

  function toggleFavorite(button) {
    if (!global.Watchlist) return;
    var code = button.getAttribute('data-code');
    var name = button.getAttribute('data-name') || code;
    if (global.Watchlist.has(code)) {
      global.Watchlist.remove(code);
      button.classList.remove('active');
      return;
    }
    var result = global.Watchlist.add(code, name);
    if (result.ok) button.classList.add('active');
    else if (result.reason === 'login') alert('Google 로그인 후 관심종목을 저장할 수 있습니다.');
    else if (result.reason === 'full') alert('관심종목은 최대 ' + global.Watchlist.MAX_ITEMS + '개까지 담을 수 있습니다.');
  }

  function searchRows(query, limit) {
    var localRows = localSearchRows(query, limit);
    if (localRows.length) return Promise.resolve(localRows);
    return fetchJson(API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=' + limit)
      .then(function (rows) {
        if (!rows || !rows.length) return localRows;
        var seen = {};
        return localRows.concat(rows).map(function (row) {
          return Object.assign({}, row, {
            name: localizedUsName(row.symbol, row.name),
            exchange: exchangeLabel(row.exchange)
          });
        }).filter(function (row) {
          var key = String(row.symbol || '').toUpperCase();
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }).slice(0, limit);
      })
      .catch(function () { return localSearchRows(query, limit); });
  }

  function localSearchRows(query, limit) {
    var needle = String(query || '').toLowerCase();
    var rows = LOCAL_US_SYMBOLS.filter(function (row) {
      return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(needle) !== -1;
    }).slice(0, limit).map(function (row) {
      return { symbol: row.symbol, name: row.name, exchange: 'US', market: 'us' };
    });
    if (!rows.length && /^[a-z][a-z0-9.\-^=]{0,11}$/i.test(query)) {
      rows.push({ symbol: String(query).toUpperCase(), name: String(query).toUpperCase(), exchange: 'US', market: 'us' });
    }
    return rows;
  }

  function select(symbol) {
    stopRefresh();
    stopRealtime();
    if (state.quoteRetryTimer) clearTimeout(state.quoteRetryTimer);
    state.quoteRetryTimer = null;
    state.symbol = String(symbol || '').toUpperCase().replace(/^US:/, '');
    state.renderedSymbol = null;
    state.detailLoadedSymbol = null;
    state.nativeChartPromise = null;
    state.lastQuote = null;
    state.lastOrderbook = null;
    state.paused = false;
    try { localStorage.setItem(LAST_SYMBOL_KEY, state.symbol); } catch (err) { /* 저장소가 막힌 환경도 조회는 계속한다. */ }
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = '<div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>' + escapeHtml(state.symbol) + ' 시세를 불러오는 중...</div>';
    // 스타일이 붙기 전에 값을 그리면 라벨과 값이 붙어 나오는 화면이 된다(2026-09-02
    // 리포트). 로딩 표시는 그대로 두고, 실제 내용만 스타일시트를 기다렸다 그린다.
    whenStyleReady(function () {
      if (state.symbol !== String(symbol || '').toUpperCase().replace(/^US:/, '')) return;
      refreshQuote();
      startRefresh();
      startRealtime();
    });
  }

  function startRefresh() {
    stopRefresh();
    if (!canRefresh()) return;
    state.refreshTimer = setInterval(refreshQuote, REFRESH_MS);
    // 처음에는 시세가 상세 DOM을 만든 뒤 loadDetailData가 시작한다. 복귀 시에는 즉시 조회.
    if (document.querySelector('#usStocksOrderbook')) loadOrderbook();
  }

  function stopRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    state.orderbookGeneration += 1;
    if (state.orderbookTimer) clearTimeout(state.orderbookTimer);
    state.orderbookTimer = null;
    var request = state.orderbookRequest;
    state.orderbookRequest = null;
    if (request) {
      clearTimeout(request.timeout);
      if (request.controller) request.controller.abort();
    }
  }

  function canRefresh() {
    return !!state.symbol && !state.paused && !document.hidden
      && (!state.embedded || (state.container && !state.container.hidden));
  }

  function pause() {
    state.paused = true;
    stopRefresh();
    stopRealtime();
    if (state.quoteRetryTimer) clearTimeout(state.quoteRetryTimer);
    state.quoteRetryTimer = null;
  }

  function stopRealtime() {
    state.realtimeGeneration += 1;
    state.realtimeLive = false;
    if (state.realtimeTimer) clearTimeout(state.realtimeTimer);
    state.realtimeTimer = null;
    if (state.realtimeSocket) {
      state.realtimeSocket.onclose = null;
      try { state.realtimeSocket.close(); } catch (err) {}
      state.realtimeSocket = null;
    }
  }

  function startRealtime() {
    stopRealtime();
    if (!canRefresh() || !global.WebSocket) return;
    var generation = state.realtimeGeneration;
    function connect() {
      if (generation !== state.realtimeGeneration || document.hidden || !state.symbol) return;
      var socket;
      try {
        socket = new WebSocket(REALTIME_QUOTES_URL + '?codes=' + encodeURIComponent('US:' + state.symbol));
      } catch (err) {
        state.realtimeTimer = setTimeout(connect, REALTIME_RECONNECT_MS);
        return;
      }
      state.realtimeSocket = socket;
      socket.onmessage = function (event) {
        if (generation !== state.realtimeGeneration) return;
        try {
          var quote = JSON.parse(event.data);
          if (quote.type === 'quote' && quote.code === 'US:' + state.symbol) applyRealtimeQuote(quote);
        } catch (err) {}
      };
      socket.onopen = function () {
        if (generation !== state.realtimeGeneration) return;
        state.realtimeLive = true;
        updateRefreshLabels();
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      };
      socket.onerror = function () { try { socket.close(); } catch (err) {} };
      socket.onclose = function () {
        if (generation !== state.realtimeGeneration || document.hidden) return;
        state.realtimeLive = false;
        updateRefreshLabels();
        state.realtimeSocket = null;
        state.realtimeTimer = setTimeout(connect, REALTIME_RECONNECT_MS);
      };
    }
    connect();
  }

  function applyRealtimeQuote(quote) {
    if (!quote || quote.code !== 'US:' + state.symbol || !Number.isFinite(Number(quote.price))) return;
    var merged = Object.assign({}, state.lastQuote || {}, quote);
    if (quote.changeRate != null) merged.change_rate = quote.changeRate;
    state.lastQuote = merged;
    var detail = document.querySelector('#usStocksDetail');
    if (detail) updateQuoteFields(state.lastQuote, detail);
    if (global.StockSearchChart && typeof global.StockSearchChart.updateQuote === 'function') {
      global.StockSearchChart.updateQuote('US:' + state.symbol, quote);
    }
  }

  function refreshQuote() {
    if (!canRefresh()) return;
    var symbol = state.symbol;
    fetchQuoteWithRetry(symbol, 0)
      .then(function (quote) {
        if (state.symbol !== symbol || !canRefresh()) return;
        renderQuote(quote);
        state.renderedSymbol = symbol;
        loadDetailData(quote, symbol);
      })
      .catch(function () {
        if (state.symbol !== symbol) return;
        var detail = document.querySelector('#usStocksDetail');
        if (detail && !detail.querySelector('.us-stocks-live-card')) detail.innerHTML = '<div class="us-stocks-empty us-stocks-error">시세를 불러오지 못했어요.</div>';
      });
  }

  // 관심종목판은 페이지 진입 때 여러 미국 종목을 동시에 조회한다. 그때
  // 상세 종목의 첫 요청이 VM의 공개 rate limit(429)에 걸려도, 한 번 실패한
  // 채로 후속 데이터가 영원히 로딩 상태에 남지 않도록 짧게 재시도한다.
  function fetchQuoteWithRetry(symbol, attempt) {
    return fetchJson(API_BASE + '/us-quote/' + encodeURIComponent(symbol)).catch(function (error) {
      if (state.symbol !== symbol || error.status !== 429 || attempt >= 3) throw error;
      var delay = 1200 * Math.pow(2, attempt);
      return new Promise(function (resolve) {
        state.quoteRetryTimer = setTimeout(function () {
          state.quoteRetryTimer = null;
          resolve();
        }, delay);
      }).then(function () { return fetchQuoteWithRetry(symbol, attempt + 1); });
    });
  }

  function loadDetailData(quote, symbol) {
    if (!quote || state.symbol !== symbol || state.detailLoadedSymbol === symbol) return;
    state.detailLoadedSymbol = symbol;
    loadOrderbook();
    loadNativeChart();
    // 시세·호가·현재 보이는 일봉이 먼저 연결되게 하고, 화면 아래의 분석·뉴스는
    // 잠시 뒤 시작한다. 외부 뉴스와 차트가 동시에 느릴 때 VM 스레드풀이 포화되어
    // 현재가까지 늦어지던 경쟁을 피한다.
    global.setTimeout(function () {
      if (state.symbol !== symbol || state.detailLoadedSymbol !== symbol) return;
      loadAnalysis();
      renderCongressLinks();
      loadNews(localizedUsName(quote.symbol, quote.name));
    }, 750);
  }

  function renderQuote(quote) {
    if (!quote || quote.symbol !== state.symbol) return;
    state.lastQuote = Object.assign({}, state.lastQuote || {}, quote);
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    var card = detail.querySelector('.us-stocks-live-card');
    if (!card || card.getAttribute('data-symbol') !== quote.symbol) {
      detail.innerHTML = state.embedded ? embeddedDetailHtml(quote) : '<div class="us-stocks-live-card" data-symbol="' + escapeAttr(quote.symbol) + '">'
        + '<div class="us-stocks-live-head"><div class="us-stocks-identity">' + stockIconHtml(quote.symbol) + '<div><span class="us-stocks-market-badge">미국주식</span><h3 data-us-name></h3><p data-us-symbol></p></div></div>'
        + '<span class="us-stocks-market-state" data-us-state></span></div>'
        + '<div class="us-stocks-live-price" data-us-price-wrap><span data-us-price></span><span data-us-change></span></div>'
        + '<div class="us-stocks-metrics">'
        + metric('시가', '', 'open')
        + metric('전일 종가', '', 'previous')
        + metric('오늘 고가', '', 'high')
        + metric('오늘 저가', '', 'low')
        + metric('거래량', '', 'volume')
        + metric('52주 범위', '', 'week52')
        + metric('상장주식 수', '', 'shares')
        + '</div>'
        + '<div class="us-stocks-live-footer"><span data-us-refresh-note>15초 자동 갱신</span><span data-us-updated></span></div>'
        + '</div>'
        + '<div id="usStocksAnalysis" class="us-stocks-analysis-grid">'
        + analysisCard('기본 재무', '재무지표를 불러오는 중...', 'financials')
        + analysisCard('재무 흐름', '매출·순이익 지표를 불러오는 중...', 'statements')
        + analysisCard('실적 일정', '실적 일정을 불러오는 중...', 'earnings')
        + analysisCard('애널리스트', '전망 데이터를 불러오는 중...', 'recommendation')
        + analysisCard('내부자 거래', '내부자 거래를 불러오는 중...', 'insider')
        + '</div>'
        + '<section class="us-stocks-panel us-stocks-congress-panel"><div class="us-stocks-panel-head"><h4>미국 의회 거래 공시</h4><span>참고용 시그널</span></div><div id="usStocksCongress" class="us-stocks-congress"><div class="us-stocks-loading">의회 거래 공시를 불러오는 중...</div></div></section>'
        + '<div class="us-stocks-market-grid">'
        + '<section class="us-stocks-panel us-stocks-orderbook-panel"><div class="us-stocks-panel-head"><h4>호가</h4><span data-us-book-status>10단계 호가 · 연결 중</span></div><div id="usStocksOrderbook" class="us-stocks-orderbook"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>호가를 불러오는 중...</div></div></section>'
        + '<section class="us-stocks-panel us-stocks-chart-panel"><div class="us-stocks-panel-head"><h4>차트</h4><span>국내 종목 차트와 동일</span></div>'
        + '<div id="usStocksChart" class="us-native-chart-mount"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>차트를 불러오는 중...</div></div></section>'
        + '</div>'
        + '<section class="us-stocks-panel us-stocks-news-panel"><div class="us-stocks-panel-head"><h4>관련 뉴스</h4><span>최근 24시간</span></div><div id="usStocksNews" class="us-stocks-news"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>뉴스를 불러오는 중...</div></div></section>';
    }
    updateQuoteFields(quote, detail);
  }

  function embeddedDetailHtml(quote) {
    return '<div class="us-stocks-live-card ss-summary" data-symbol="' + escapeAttr(quote.symbol) + '">'
      + '<div class="ss-summary-head us-stocks-live-head">'
      + stockIconHtml(quote.symbol)
      + '<span class="ss-summary-name" data-us-name></span>'
      + '<span class="ss-summary-code" data-us-symbol></span>'
      + '<span class="ss-summary-price" data-us-price-wrap><span data-us-price></span></span>'
      + '<span class="ss-summary-change" data-us-change></span>'
      + '</div>'
      + '<div class="ss-summary-reason"><span class="ss-reason-badge">US</span><span class="ss-reason-text">미국주식 · <span data-us-state></span><span data-us-basis></span></span></div>'
      + '<details class="us-stocks-metrics-more"><summary>세부 시세</summary><div class="us-stocks-metrics">'
      + metric('시가', '', 'open')
      + metric('전일 종가', '', 'previous')
      + metric('오늘 고가', '', 'high')
      + metric('오늘 저가', '', 'low')
      + metric('거래량', '', 'volume')
      + metric('52주 범위', '', 'week52')
      + metric('상장주식 수', '', 'shares')
      + '</div></details>'
      + '</div>'
      + '<div id="usStocksAnalysis" class="us-stocks-analysis-grid">'
      + analysisCard('기본 재무', '재무지표를 불러오는 중...', 'financials')
      + analysisCard('재무 흐름', '매출·순이익 지표를 불러오는 중...', 'statements')
      + analysisCard('실적 일정', '실적 일정을 불러오는 중...', 'earnings')
      + analysisCard('애널리스트', '전망 데이터를 불러오는 중...', 'recommendation')
      + analysisCard('내부자 거래', '내부자 거래를 불러오는 중...', 'insider')
      + '</div>'
      + '<section class="us-stocks-panel us-stocks-congress-panel"><div class="us-stocks-panel-head"><h4>미국 의회 거래 공시</h4><span>참고용 시그널</span></div><div id="usStocksCongress" class="us-stocks-congress"><div class="us-stocks-loading">의회 거래 공시를 불러오는 중...</div></div></section>'
      + '<div class="ss-panels us-stocks-market-grid">'
      + '<section class="ss-panel-left us-stocks-panel us-stocks-orderbook-panel"><div class="us-stocks-panel-head"><h4>호가</h4><span data-us-book-status>10단계 호가 · 연결 중</span></div><div id="usStocksOrderbook" class="us-stocks-orderbook"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>호가를 불러오는 중...</div></div></section>'
      + '<div class="ss-resize-handle" role="separator" aria-orientation="vertical" aria-label="호가창과 차트 폭 조절" tabindex="0"></div>'
      + '<section class="ss-panel-right us-stocks-panel us-stocks-chart-panel"><div class="us-stocks-panel-head"><h4>차트</h4><span>국내 종목 차트와 동일</span></div>'
      + '<div id="usStocksChart" class="us-native-chart-mount"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>차트를 불러오는 중...</div></div></section>'
      + '<section class="ss-news-panel us-stocks-panel us-stocks-news-panel"><div class="us-stocks-panel-head ss-news-panel-head"><h3>관련 뉴스</h3><span>최근 24시간</span></div><div id="usStocksNews" class="us-stocks-news"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>뉴스를 불러오는 중...</div></div></section>'
      + '</div>';
  }

  function updateQuoteFields(quote, detail) {
    var card = detail.querySelector('.us-stocks-live-card');
    if (!card) return;
    var priceWrap = card.querySelector('[data-us-price-wrap]');
    applyTone(priceWrap, quote.change_rate);
    card.querySelector('[data-us-name]').textContent = localizedUsName(quote.symbol, quote.name);
    card.querySelector('[data-us-symbol]').textContent = quote.symbol + ' · ' + exchangeLabel(quote.exchange);
    card.querySelector('[data-us-state]').textContent = marketStateLabel(quote.market_state);
    var basisNode = card.querySelector('[data-us-basis]');
    if (basisNode) basisNode.textContent = basisLabel(quote);
    card.querySelector('[data-us-price]').textContent = formatPrice(quote.price);
    var changeNode = card.querySelector('[data-us-change]');
    changeNode.textContent = formatPercent(quote.change_rate);
    applyTone(changeNode, quote.change_rate);
    var values = {
      open: formatPrice(quote.open),
      previous: formatPrice(quote.previous_close),
      high: formatPrice(quote.day_high),
      low: formatPrice(quote.day_low),
      volume: formatVolume(quote.volume),
      week52: formatPrice(quote.week52_low) + ' ~ ' + formatPrice(quote.week52_high),
      // 상장주식 수는 가격이 아니라 수량이라 통화기호 없이 축약해 보여준다.
      shares: formatVolume(quote.shares_outstanding)
    };
    Object.keys(values).forEach(function (key) {
      var node = card.querySelector('[data-us-metric="' + key + '"]');
      if (node) node.textContent = values[key];
    });
    var updatedNode = card.querySelector('[data-us-updated]');
    if (updatedNode) updatedNode.textContent = updatedLabel(quote);
    updateOrderbookCurrent();
  }

  function loadOrderbook() {
    if (!canRefresh() || !document.querySelector('#usStocksOrderbook')) return Promise.resolve();
    if (state.orderbookRequest) return state.orderbookRequest.promise;
    if (state.orderbookTimer) clearTimeout(state.orderbookTimer);
    state.orderbookTimer = null;
    var symbol = state.symbol;
    var generation = state.orderbookGeneration;
    var request = { controller: global.AbortController ? new global.AbortController() : null, timeout: null, delay: null };
    state.orderbookRequest = request;
    function isCurrent() { return state.symbol === symbol && state.orderbookGeneration === generation && canRefresh(); }
    request.promise = new Promise(function (resolve, reject) {
      request.timeout = setTimeout(function () {
        if (request.controller) request.controller.abort();
        reject(new Error('ORDERBOOK_TIMEOUT'));
      }, ORDERBOOK_TIMEOUT_MS);
      fetchJson(API_BASE + '/us-orderbook/' + encodeURIComponent(symbol), request.controller ? { signal: request.controller.signal } : undefined)
        .then(resolve, reject);
    }).then(function (book) {
      if (!isCurrent() || (book.symbol && book.symbol !== symbol)) return;
      state.lastOrderbook = book;
      renderOrderbook(book);
      var closed = state.lastQuote && state.lastQuote.market_state === 'closed';
      var stamp = new Date((Number(book.updated_at) || Date.now() / 1000) * 1000)
        .toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
      setOrderbookStatus('조회 ' + stamp + (closed ? ' · 장 마감 · 15초 조회' : ' · 3초 갱신'));
    }).catch(function () {
      if (!isCurrent()) return;
      request.delay = REFRESH_MS;
      setOrderbookStatus(state.lastOrderbook ? '갱신 지연 · 직전 호가 · 재시도 중' : '호가 연결 재시도 중');
      if (!state.lastOrderbook) {
        var mount = document.querySelector('#usStocksOrderbook');
        if (mount) mount.innerHTML = '<div class="us-stocks-empty">호가를 불러오지 못했습니다. 자동으로 다시 조회합니다.</div>';
      }
    }).then(function () {
      clearTimeout(request.timeout);
      if (state.orderbookRequest !== request) return;
      state.orderbookRequest = null;
      if (!isCurrent()) return;
      var closed = state.lastQuote && state.lastQuote.market_state === 'closed';
      state.orderbookTimer = setTimeout(loadOrderbook, request.delay || (closed ? REFRESH_MS : ORDERBOOK_REFRESH_MS));
    });
    return request.promise;
  }

  function setOrderbookStatus(text) {
    var node = document.querySelector('[data-us-book-status]');
    if (node) node.textContent = text;
  }

  function updateOrderbookCurrent() {
    var mount = document.querySelector('#usStocksOrderbook');
    var row = mount && mount.querySelector('.us-stocks-book-current');
    if (!row || !state.lastQuote) return;
    row.querySelector('strong').textContent = formatPrice(state.lastQuote.price);
    row.querySelector('span:last-child').textContent = formatPercent(state.lastQuote.change_rate);
  }

  function renderOrderbook(book) {
    var mount = document.querySelector('#usStocksOrderbook');
    if (!mount) return;
    var asks = (book.asks || []).slice().reverse();
    var bids = book.bids || [];
    var rows = Math.max(asks.length, bids.length);
    var levelSize = function (level) {
      var value = level && level.size != null ? level.size : level && level.qty;
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    };
    var maxAsk = Math.max.apply(null, asks.map(levelSize).concat([0]));
    var maxBid = Math.max.apply(null, bids.map(levelSize).concat([0]));
    var maxLevel = Math.max(maxAsk, maxBid, 1);
    var strength = maxAsk > 0 ? maxBid / maxAsk * 100 : null;
    var strengthWidth = strength == null ? 0 : Math.max(0, Math.min(100, strength / 2));
    var balanceLabel = maxAsk === maxBid ? '균형' : (maxAsk > maxBid ? '매도 우위' : '매수 우위');
    var current = state.lastQuote && Number(state.lastQuote.price);
    if (!rows && !Number.isFinite(current)) {
      mount.innerHTML = '<div class="us-stocks-empty">호가 데이터가 없습니다.</div>';
      return;
    }
    var html = '<div class="us-stocks-level-summary">'
      + '<div class="us-stocks-level-row"><span class="us-level-label us-book-ask-text">저항(매도벽)</span><i><em class="us-book-ask-fill" style="width:' + Math.round(maxAsk / maxLevel * 100) + '%"></em></i><b>' + formatVolume(maxAsk) + '</b></div>'
      + '<div class="us-stocks-level-row"><span class="us-level-label us-book-bid-text">지지(매수벽)</span><i><em class="us-book-bid-fill" style="width:' + Math.round(maxBid / maxLevel * 100) + '%"></em></i><b>' + formatVolume(maxBid) + '</b></div>'
      + '<div class="us-stocks-level-row"><span class="us-level-label">호가강도</span><i><em class="us-book-strength-fill" style="width:' + strengthWidth + '%"></em></i><b>' + (strength == null ? '-' : strength.toFixed(1) + '%') + '</b></div>'
      + '<p>미국 10단계 호가 잔량 기준 · 실제 체결강도와는 다를 수 있습니다. <strong>' + balanceLabel + '</strong></p>'
      + '</div>'
      + '<div class="us-ob-head"><span class="us-book-bid-text">매수 가격 · 잔량</span><span class="us-book-ask-text">잔량 · 매도 가격</span></div>';
    if (Number.isFinite(current)) {
      html += '<div class="us-stocks-book-current"><span>현재가</span><strong>' + formatPrice(current) + '</strong><span>' + formatPercent(state.lastQuote.change_rate) + '</span></div>';
    }
    // 국내 호가창과 같은 좌우 배치(2026-10-05 사용자 요청): 왼쪽 매수(빨강)·오른쪽 매도(파랑), 막대는 가운데에서
    // 바깥으로, 가격은 바깥쪽·잔량은 가운데 쪽. 매도는 API가 낮은 호가부터 주므로 같은 줄에 가장 가까운 호가끼리 놓는다.
    var askRows = (book.asks || []);
    html += '<div class="us-ob-table">';
    for (var i = 0; i < rows; i++) {
      var ask = askRows[i];
      var bid = bids[i];
      html += '<div class="us-ob-pair">'
        + usBookRow(bid, 'bid', maxLevel, i + 1, levelSize)
        + usBookRow(ask, 'ask', maxLevel, i + 1, levelSize)
        + '</div>';
    }
    html += '</div>';
    mount.innerHTML = html || '<div class="us-stocks-empty">호가 데이터가 없습니다.</div>';
    drawUsSilhouette(mount, askRows.map(function (l) { return { price: Number(l.price), qty: levelSize(l) }; }),
      bids.map(function (l) { return { price: Number(l.price), qty: levelSize(l) }; }));
  }

  function usBookRow(level, side, maxLevel, levelNo, levelSize) {
    if (!level) return '<div class="us-ob-row us-ob-row-empty"></div>';
    var qty = levelSize(level);
    var pct = Math.max(2, Math.round(qty / maxLevel * 100));
    return '<div class="us-ob-row us-ob-row-' + side + '" data-level="' + levelNo + '">'
      + '<span class="us-ob-qty">' + formatVolume(qty) + '</span>'
      + '<span class="us-ob-bar-wrap"><span class="us-ob-bar" style="width:' + pct + '%"></span></span>'
      + '<span class="us-ob-price us-book-' + side + '-text">' + formatPrice(level.price) + '</span>'
      + '</div>';
  }

  // 핵심 매물대(stock-search.js가 내보내는 window.__ssVolumeProfile의 core 구간)에 놓인 호가를 주황으로.
  // 매물대가 아직 없으면 같은 편 평균의 1.8배 이상인 잔량 벽을 주황으로 둔다.
  function usWallLevels(rows) {
    var set = {};
    var vp = global.__ssVolumeProfile;
    if (vp && vp.bins && vp.code === 'US:' + state.symbol) {
      rows.forEach(function (r, i) {
        for (var k = 0; k < vp.bins.length; k++) {
          var b = vp.bins[k];
          if (r.price >= b.low && r.price < b.high) { if (b.core) set[i + 1] = true; break; }
        }
      });
      return set;
    }
    if (rows.length < 3) return set;
    rows.forEach(function (r, i) {
      var others = rows.filter(function (o, j) { return j !== i; });
      var avg = others.reduce(function (sum, o) { return sum + o.qty; }, 0) / others.length;
      if (avg > 0 && r.qty >= avg * 1.8) set[i + 1] = true;
    });
    return set;
  }

  // 막대 끝점을 직선으로 이은 빛나는 실루엣 선. 막대 DOM 위치를 읽어 그리고, 선은 막대·글자 뒤에 둔다.
  function drawUsSilhouette(mount, asks, bids) {
    var table = mount.querySelector('.us-ob-table');
    if (!table) return;
    state.lastSil = { mount: mount, asks: asks, bids: bids };
    var NS = 'http://www.w3.org/2000/svg';
    var layers = {};
    ['under', 'over'].forEach(function (name) {
      var svg = table.querySelector('.us-ob-sil-' + name);
      if (!svg) {
        svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'us-ob-sil us-ob-sil-' + name);
        svg.setAttribute('aria-hidden', 'true');
        table.appendChild(svg);
      }
      layers[name] = svg;
    });
    var tr = table.getBoundingClientRect();
    ['under', 'over'].forEach(function (name) {
      layers[name].setAttribute('width', tr.width);
      layers[name].setAttribute('height', tr.height);
    });
    var walls = { ask: usWallLevels(asks), bid: usWallLevels(bids) };
    var lines = '', dots = '';
    ['bid', 'ask'].forEach(function (side) {
      var pts = [];
      table.querySelectorAll('.us-ob-row-' + side).forEach(function (row) {
        var odd = !!walls[side][Number(row.getAttribute('data-level'))];
        row.classList.toggle('us-ob-row-odd', odd);
        var bar = row.querySelector('.us-ob-bar');
        if (!bar) return;
        var br = bar.getBoundingClientRect();
        var rr = row.getBoundingClientRect();
        var x = (side === 'bid' ? br.left - 2 : br.right + 2) - tr.left;
        var y = rr.top + rr.height / 2 - tr.top;
        pts.push([x, y]);
        if (odd) dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" class="us-ob-sil-dot"/>';
      });
      if (pts.length > 1) {
        lines += '<polyline class="us-ob-sil-line us-ob-sil-' + side + '" points="'
          + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
      }
    });
    layers.under.innerHTML = lines;
    layers.over.innerHTML = dots;
  }

  global.addEventListener('ss-volume-profile', function () {
    var last = state.lastSil;
    if (last && last.mount && document.body.contains(last.mount)) drawUsSilhouette(last.mount, last.asks, last.bids);
  });

  function loadNativeChart() {
    if (!state.symbol) return;
    var mount = document.querySelector('#usStocksChart');
    if (!mount) return;
    if (!global.StockSearchChart || typeof global.StockSearchChart.mount !== 'function') {
      mount.innerHTML = '<div class="us-stocks-empty">국내 차트 모듈을 불러오지 못했습니다.</div>';
      return;
    }
    var symbol = state.symbol;
    state.nativeChartPromise = global.StockSearchChart.mount({
      container: mount,
      key: 'US:' + symbol,
      load: function (timeframe, minuteScope) {
        // 공통 차트 모듈은 day/week/month를 UI 상태로 사용하지만 미국 API는
        // minute/daily만 받는다. 일봉 요청을 그대로 day로 보내면 422가 난다.
        var apiTimeframe = timeframe === 'minute' ? 'minute' : 'daily';
        var query = '?timeframe=' + apiTimeframe;
        if (timeframe === 'minute') query += '&tic_scope=' + encodeURIComponent(minuteScope || '1');
        return fetchJson(API_BASE + '/us-chart/' + encodeURIComponent(symbol) + query)
          .then(function (payload) { return normalizeChartBars(payload && payload.points, timeframe); });
      }
    }).catch(function () {
      if (state.symbol !== symbol) return;
      mount.innerHTML = '<div class="us-stocks-empty">차트 데이터를 불러오지 못했습니다.</div>';
    });
  }

  function normalizeChartBars(points, timeframe) {
    var bars = (points || []).map(function (point) {
      var close = Number(point.close != null ? point.close : point.price);
      var open = Number(point.open != null ? point.open : close);
      var high = Number(point.high != null ? point.high : Math.max(open, close));
      var low = Number(point.low != null ? point.low : Math.min(open, close));
      var date = timeframe === 'minute' ? Number(point.time) : String(point.time || '').slice(0, 10);
      if (!Number.isFinite(close) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low)) return null;
      if (timeframe === 'minute' ? !Number.isFinite(date) : !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return { date: date, open: open, high: high, low: low, close: close, volume: Number(point.volume) || 0 };
    }).filter(Boolean);
    return bars.sort(function (a, b) {
      return timeframe === 'minute' ? a.date - b.date : String(a.date).localeCompare(String(b.date));
    });
  }

  function loadNews(name) {
    if (!state.symbol) return;
    fetchJson(API_BASE + '/us-news/' + encodeURIComponent(state.symbol) + '?name=' + encodeURIComponent(name || state.symbol))
      .then(function (payload) { renderNews(payload && payload.items ? payload.items : []); })
      .catch(function () {
        var mount = document.querySelector('#usStocksNews');
        if (mount) mount.innerHTML = '<div class="us-stocks-empty">뉴스를 확인할 수 없습니다.</div>';
      });
  }

  function loadAnalysis() {
    if (!state.symbol) return;
    fetchJson(API_BASE + '/us-analysis/' + encodeURIComponent(state.symbol))
      .then(renderAnalysis)
      .catch(function () {
        var mount = document.querySelector('#usStocksAnalysis');
        if (mount) mount.innerHTML = '<div class="us-stocks-analysis-empty">재무·실적 데이터를 확인할 수 없습니다.</div>';
      });
  }

  function renderAnalysis(payload) {
    var mount = document.querySelector('#usStocksAnalysis');
    if (!mount) return;
    var summary = payload && payload.summary || {};
    var recommendation = summary.recommendation || {};
    setAnalysisCard(mount, 'financials', formatMetric(summary.pe, 1, ' PER'), 'PBR ' + formatMetric(summary.pb, 1, ' · ') + 'ROE ' + formatMetric(summary.roe, 1, '%'));
    var revenue = formatCompactUsd(summary.latest_revenue);
    var netIncome = formatCompactUsd(summary.latest_net_income);
    setAnalysisCard(mount, 'statements', revenue === '-' ? '매출성장 ' + formatMetric(summary.revenue_growth, 1, '%') : '매출 ' + revenue, netIncome === '-' ? '순이익률 ' + formatMetric(summary.net_margin, 1, '%') : '순이익 ' + netIncome + ' · 성장 ' + formatMetric(summary.revenue_growth, 1, '%'));
    setAnalysisCard(mount, 'earnings', summary.next_earnings || '예정일 없음', '최근 EPS 서프라이즈 ' + formatMetric(summary.eps_surprise_percent, 1, '%'));
    setAnalysisCard(mount, 'recommendation', '매수 ' + (Number(recommendation.strongBuy || 0) + Number(recommendation.buy || 0)), '보유 ' + Number(recommendation.hold || 0) + ' · 매도 ' + (Number(recommendation.sell || 0) + Number(recommendation.strongSell || 0)));
    var insiderTone = Number(summary.insider_net_change) > 0 ? 'us-up' : Number(summary.insider_net_change) < 0 ? 'us-down' : '';
    setAnalysisCard(mount, 'insider', '<span class="' + insiderTone + '">' + formatVolume(summary.insider_net_change) + '주</span>', '거래 ' + Number(summary.insider_transaction_count || 0) + '건');
  }

  function renderCongressLinks() {
    var mount = document.querySelector('#usStocksCongress');
    if (!mount) return;
    var symbol = encodeURIComponent(state.symbol || '');
    var quiverUrl = 'https://www.quiverquant.com/congresstrading/stock/' + symbol;
    var officialUrl = 'https://disclosures-clerk.house.gov/FinancialDisclosure/ViewReport';
    mount.innerHTML = '<div class="us-stocks-congress-links">'
      + '<a class="us-stocks-congress-link" href="' + escapeAttr(quiverUrl) + '" target="_blank" rel="noopener">'
      + '<strong>Quiver에서 ' + escapeHtml(state.symbol) + ' 거래 확인</strong><span>의원별 매수·매도·거래일·신고일 보기 ↗</span></a>'
      + '<a class="us-stocks-congress-link" href="' + escapeAttr(officialUrl) + '" target="_blank" rel="noopener">'
      + '<strong>미 하원 공식 신고자료</strong><span>공개된 재무·거래 신고 원문 확인 ↗</span></a>'
      + '</div>'
      + '<p class="us-stocks-congress-note">외부 공개자료 · 거래일과 신고일이 다를 수 있음 · 최대 45일 지연 가능 · 복사매매 신호 아님</p>';
  }

  function setAnalysisCard(mount, key, value, detail) {
    var card = mount.querySelector('[data-analysis-card="' + key + '"]');
    if (!card) return;
    var valueNode = card.querySelector('[data-analysis-value]');
    var detailNode = card.querySelector('[data-analysis-detail]');
    if (valueNode) valueNode.innerHTML = value == null || value === '' ? '-' : value;
    if (detailNode) detailNode.textContent = detail || '';
  }

  function renderNews(items) {
    var mount = document.querySelector('#usStocksNews');
    if (!mount) return;
    var recentItems = items.filter(isRecentNews);
    if (!recentItems.length) {
      mount.innerHTML = '<div class="us-stocks-empty">최근 24시간 관련 뉴스가 없습니다.</div>';
      return;
    }
    var sortedItems = recentItems.slice().sort(function (a, b) {
      return newsTimestamp(b) - newsTimestamp(a);
    });
    mount.innerHTML = '<div class="app-news-timeline ss-news-timeline us-stocks-news-timeline" role="list">' + sortedItems.map(function (item, index) {
      var pubDate = item.pubDate || '';
      var date = new Date(String(pubDate));
      var dateText = isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
      return '<a class="app-news-event ss-news-item us-stocks-news-item" href="' + escapeAttr(item.link || '#') + '" target="_blank" rel="noopener" role="listitem">'
        + '<div class="app-news-date"><strong>' + escapeHtml(dateText) + '</strong><small>' + escapeHtml(formatNewsTime(pubDate)) + '</small></div>'
        // 2026-09-12: 레일에 us-stocks-news-rail을 빠뜨려 css/us-stocks.css의 레일 디자인이
        // 한 번도 적용된 적이 없었다. #stock-search 안에 임베드될 때만 .ss-news-rail 규칙이
        // 닿고, 독립 미국주식 페이지에서는 공통 .app-news-rail로 폴백해 선이 열 왼쪽 끝에
        // 붙어 날짜/시간 바로 옆에 그려졌다(사용자 리포트).
        + '<div class="app-news-rail ss-news-rail us-stocks-news-rail" aria-hidden="true"><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></div>'
        + '<div class="app-news-body ss-news-body us-stocks-news-body"><div class="app-news-meta"><b class="app-news-market app-news-market--미국">미국</b><b class="app-news-type app-news-type--뉴스">뉴스</b><small>' + escapeHtml(item.source || item.publisher || '') + '</small></div>'
        + '<strong>' + escapeHtml(item.title_ko || item.title || '') + '</strong></div></a>';
    }).join('') + '</div>';
  }

  function newsBucket(value) {
    var date = new Date(String(value || ''));
    if (isNaN(date.getTime())) return 'night';
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).formatToParts(date);
    var hour = Number((parts.find(function (part) { return part.type === 'hour'; }) || {}).value || 0);
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    return 'night';
  }

  function newsTimestamp(item) {
    var stamp = Date.parse(String(item && item.pubDate || ''));
    return isNaN(stamp) ? 0 : stamp;
  }

  function isRecentNews(item) {
    var timestamp = newsTimestamp(item);
    var now = Date.now();
    return timestamp > 0 && timestamp <= now + 5 * 60 * 1000
      && now - timestamp <= 24 * 60 * 60 * 1000;
  }

  function formatNewsTime(value) {
    var date = new Date(String(value || ''));
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
      });
    }
    var match = String(value || '').match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
    return match ? ('0' + match[1]).slice(-2) + ':' + match[2] : '--:--';
  }

  function metric(label, value) {
    var key = arguments[2] || '';
    return '<div class="us-stocks-metric"><span>' + escapeHtml(label) + '</span><b data-us-metric="' + escapeAttr(key) + '">' + escapeHtml(value) + '</b></div>';
  }

  function analysisCard(label, value, key) {
    return '<section class="us-stocks-analysis-card" data-analysis-card="' + escapeAttr(key) + '">'
      + '<span>' + escapeHtml(label) + '</span><b data-analysis-value>' + escapeHtml(value) + '</b><small data-analysis-detail></small></section>';
  }

  function formatMetric(value, digits, suffix) {
    return value == null || isNaN(value) ? '-' : Number(value).toFixed(digits == null ? 1 : digits) + (suffix || '');
  }

  function formatCompactUsd(value) {
    if (value == null || isNaN(value)) return '-';
    var number = Number(value);
    var absolute = Math.abs(number);
    var divisor = absolute >= 1e9 ? 1e9 : absolute >= 1e6 ? 1e6 : absolute >= 1e3 ? 1e3 : 1;
    var suffix = divisor === 1e9 ? '십억 달러' : divisor === 1e6 ? '백만 달러' : divisor === 1e3 ? '천 달러' : '';
    return '$' + (number / divisor).toFixed(divisor === 1 ? 0 : 1) + suffix;
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (response) {
      if (!response.ok) {
        var error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }).then(function (body) {
      if (body && body.success === false) throw new Error('API_ERROR');
      return body && body.data !== undefined ? body.data : body;
    });
  }

  function formatPrice(value) {
    return value == null || isNaN(value) ? '-' : '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatPercent(value) {
    return value == null || isNaN(value) ? '-' : (Number(value) >= 0 ? '+' : '') + Number(value).toFixed(2) + '%';
  }
  function formatVolume(value) {
    return value == null || isNaN(value) ? '-' : Number(value).toLocaleString('en-US');
  }
  function formatUpdated(value) {
    if (value == null) return '업데이트 시각 확인 중';
    var date = new Date(Number(value) * 1000);
    return isNaN(date.getTime()) ? '업데이트 시각 확인 중' : date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  }
  // 2026-09-17 사용자 지적: "미국장 인텔 기준으로 아직도 4%대 상승인데? 이거 어제 기준 같은데?"
  // 맞는 지적이었다. 한국 낮 12:40은 뉴욕 수요일 밤 23:40이라 정규장이 7시간 전에 끝나 있다.
  // 그런데 화면은 조회 시각(updated_at)을 한국시간으로 찍고 "15초 자동 갱신"이라고 적어서,
  // 수요일 종가를 방금 시세처럼 읽게 만들었다. 장이 닫혀 있으면 조회 시각 대신 기준 장을 쓴다.
  function sessionDateLabel(value) {
    var raw = String(value || '');
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number(m[2]) + '/' + Number(m[3]) + '(' + days[date.getDay()] + ')';
  }
  function refreshNote() {
    return state.realtimeLive ? ' · 실시간' : ' · 15초 자동 갱신';
  }
  function updateRefreshLabels() {
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    var footer = detail.querySelector('[data-us-refresh-note]');
    if (footer) footer.textContent = state.realtimeLive ? '실시간 체결 수신' : '15초 자동 갱신';
    var quote = state.lastQuote;
    var basisNode = detail.querySelector('[data-us-basis]');
    if (basisNode && quote) basisNode.textContent = basisLabel(quote);
  }
  function basisLabel(quote) {
    if (!quote || quote.market_state === 'regular' || quote.market_state === 'pre'
        || quote.market_state === 'post') {
      // 2026-10-02 사용자 지적: 실제로는 KIS WebSocket 체결이 0.1~0.3초 간격으로 들어오는데 화면은 옛 REST
      // 조회 주기("15초")만 적고 있었다. 소켓이 열려 있을 때만 실시간이라고 말하고, 아니면 조회 주기를 적는다.
      return refreshNote();
    }
    var when = sessionDateLabel(quote && quote.session_date);
    // 날짜를 못 만들면 없는 말을 지어내지 않는다.
    return when ? ' · ' + when + ' 미국장 마지막 체결가 기준' : ' · 마지막 체결가 기준';
  }
  function updatedLabel(quote) {
    if (quote && quote.market_state && quote.market_state !== 'regular'
        && quote.market_state !== 'pre' && quote.market_state !== 'post') {
      var when = sessionDateLabel(quote.session_date);
      return when ? when + ' 장 마감' : '장 마감';
    }
    return formatUpdated(quote && quote.updated_at);
  }
  function marketStateLabel(value) {
    return { pre: '장전', regular: '정규장', post: '장후', closed: '장 마감' }[value] || '시장 상태 확인 중';
  }
  function signClass(value) { return value > 0 ? 'us-up' : value < 0 ? 'us-down' : 'us-flat'; }
  function applyTone(node, value) {
    if (!node) return;
    var tone = signClass(value);
    node.classList.remove('us-up', 'us-down', 'us-flat', 'ss-up', 'ss-down', 'ss-flat');
    node.classList.add(tone, tone.replace(/^us-/, 'ss-'));
  }
  function stockIconHtml(symbol) {
    var code = String(symbol || '').replace(/^US:/i, '').toUpperCase();
    if (!code) return '';
    return '<img class="us-stocks-icon" data-icon-code="' + escapeHtml(code) + '" data-icon-market="us" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.StockIconFallback ? window.StockIconFallback(this) : this.style.display=\'none\'">';
  }
  function hideSuggestions() { var box = document.querySelector('#usStocksSuggest'); if (box) { box.innerHTML = ''; box.classList.remove('active'); } }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function escapeAttr(value) { return escapeHtml(value); }

  global.UsStocks = { init: init, select: select, pause: pause };
})(window);
