/**
 * 미국주식 페이지 - 공통 검색에서 연결되는 미국 개별주식 1차 화면.
 * 시세·등락·거래량·고저가·장 상태는 KIS WebSocket 실시간 체결로 갱신하고(연결 중), 연결이 없을 때만 15초마다 다시 조회한다.
 * 차트·재무·실적 데이터는 다음 단계에서 같은 ticker API에 붙인다.
 */
(function (global) {
  'use strict';

  var API_BASE = 'https://goodbyestar.cloud';
  var ORDER_BOOK_CSS_URL = ((typeof NineAsset !== 'undefined' && NineAsset.base) || 'https://goodbyestarwars.github.io/tistory-ticker/') + 'css/order-book.css';
  var CSS_URL = ((typeof NineAsset !== 'undefined' && NineAsset.base) || 'https://goodbyestarwars.github.io/tistory-ticker/') + 'css/us-stocks.css?v=20261124-alpaca-options';
  var STOCK_ICON_BASE = ((typeof NineAsset !== 'undefined' && NineAsset.base) || 'https://goodbyestarwars.github.io/tistory-ticker/') + 'img/stock-icons/';
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
    // 호가 사다리는 국내 호가창과 같은 css/order-book.css를 쓴다(증시검색 화면엔 이미 있다).
    if (!document.querySelector('link[href*="order-book.css"]')) {
      var obLink = document.createElement('link');
      obLink.rel = 'stylesheet';
      obLink.href = ORDER_BOOK_CSS_URL;
      document.head.appendChild(obLink);
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
    results.innerHTML = '<div class="us-stocks-loading">' + global.NineUI.spinner() + '미국주식 시세를 불러오는 중...</div>';
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
    var cls = signClass(quoteSessionRate(quote));
    var symbol = String(item.row.symbol || '').toUpperCase();
    var code = 'US:' + symbol;
    var isFav = !!(global.Watchlist && global.Watchlist.has(code));
    var exchange = exchangeLabel(quote.exchange || item.row.exchange || '-');
    var displayName = localizedUsName(symbol, item.row.name);
    return '<div role="button" tabindex="0" class="us-stocks-result-row" data-symbol="' + escapeAttr(symbol) + '">'
      + '<span class="us-stocks-result-name"><b>' + escapeHtml(item.row.symbol) + '</b><small>' + escapeHtml(displayName) + '</small></span>'
      + '<span class="' + cls + '">' + formatPrice(quote.price) + '</span>'
      + '<span class="' + cls + '">' + formatPercent(quoteSessionRate(quote)) + '</span>'
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
    state.prevDailyVolume = null;
    state.lastOrderbook = null;
    state.paused = false;
    try { localStorage.setItem(LAST_SYMBOL_KEY, state.symbol); } catch (err) { /* 저장소가 막힌 환경도 조회는 계속한다. */ }
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = '<div class="us-stocks-loading">' + global.NineUI.spinner() + '' + escapeHtml(state.symbol) + ' 시세를 불러오는 중...</div>';
    // 스타일이 붙기 전에 값을 그리면 라벨과 값이 붙어 나오는 화면이 된다(2026-09-02
    // 리포트). 로딩 표시는 그대로 두고, 실제 내용만 스타일시트를 기다렸다 그린다.
    whenStyleReady(function () {
      if (state.symbol !== String(symbol || '').toUpperCase().replace(/^US:/, '')) return;
      refreshQuote();
      startRefresh();
      startRealtime();
    });
  }

  // 전체화면에서는 차트 mount를 이동해 둔 상태다. 상세 패널 전체를 다시 그리면
  // 복귀용 placeholder가 사라지므로 차트 데이터만 교체하고 종료 시 상세를 동기화한다.
  var fullscreenChartChanged = false;
  function selectChartInFullscreen(symbol) {
    var next = String(symbol || '').toUpperCase().replace(/^US:/, '');
    if (!/^[A-Z][A-Z0-9.\-^=]{0,11}$/.test(next)) return false;
    stopRefresh();
    stopRealtime();
    state.symbol = next;
    fullscreenChartChanged = true;
    loadNativeChart();
    return true;
  }

  function commitFullscreenChart() {
    if (!fullscreenChartChanged || !state.symbol) return;
    fullscreenChartChanged = false;
    select(state.symbol);
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

  // Broker day changes use the previous day's close. After hours use today's regular close.
  function quoteSessionRate(quote) {
    if (quote.market_state === 'post') {
      var ref = quote.regular_session;
      if (!ref || ref.session_date !== quote.session_date || !(ref.price > 0)) return null;
      return (Number(quote.price) / ref.price - 1) * 100;
    }
    return quote.change_rate;
  }

  function applyRealtimeQuote(quote) {
    if (!quote || quote.code !== 'US:' + state.symbol || !Number.isFinite(Number(quote.price))) return;
    var merged = Object.assign({}, state.lastQuote || {}, quote);
    if (quote.changeRate != null) merged.change_rate = quote.changeRate;
    merged.delayed = false;
    merged.extended_unverified = false;
    merged.quote_time = null;
    merged.updated_at = Math.floor(Date.now() / 1000);
    state.lastQuote = merged;
    var detail = document.querySelector('#usStocksDetail');
    if (detail) updateQuoteFields(state.lastQuote, detail);
    if (global.StockSearchChart && typeof global.StockSearchChart.updateQuote === 'function') {
      global.StockSearchChart.updateQuote('US:' + state.symbol, quote);
    }
  }

  function refreshQuote() {
    if (!canRefresh()) return;
    refreshOptions();
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
    refreshOptions();
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
        + '<div class="us-stocks-quote-line" data-us-session-comparison hidden></div>'
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
        + '<section class="us-stocks-panel us-stocks-orderbook-panel"><div class="us-stocks-panel-head"><h4>호가</h4><span data-us-book-status>10단계 호가 · 연결 중</span></div><div id="usStocksOrderbook" class="us-stocks-orderbook"><div class="us-stocks-loading">' + global.NineUI.spinner() + '호가를 불러오는 중...</div></div></section>'
        + '<section class="us-stocks-panel us-stocks-chart-panel"><div class="us-stocks-panel-head"><h4>차트</h4><span>국내 종목 차트와 동일</span></div>'
        + '<div id="usStocksChart" class="us-native-chart-mount"><div class="us-stocks-loading">' + global.NineUI.spinner() + '차트를 불러오는 중...</div></div></section>'
        + '</div>'
        + optionsPanelHtml(quote.symbol, false)
        + '<section class="us-stocks-panel us-stocks-news-panel"><div class="us-stocks-panel-head"><h4>관련 뉴스</h4><span>최근 24시간</span></div><div id="usStocksNews" class="us-stocks-news"><div class="us-stocks-loading">' + global.NineUI.spinner() + '뉴스를 불러오는 중...</div></div></section>';
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
      + '<span class="us-stocks-market-state" data-us-state aria-live="polite"></span>'
      + '</div>'
      + '<div class="us-stocks-quote-line" data-us-session-comparison hidden></div>'
      + '<div class="ss-summary-reason"><span class="ss-reason-badge">US</span><span class="ss-reason-text">미국주식<span data-us-basis></span></span></div>'
      // 위쪽 카드는 한 줄 요약(전일 종가·거래량·전일 거래량 대비·52주 범위·상장주식 수). 시가·고가·저가는 국내처럼 호가 칸 맨 위에(2026-11-03 사용자 요청: 세부 시세 칸 삭제)
      + '<div class="us-stocks-quote-line" aria-label="전일 종가·거래량·52주 범위·상장주식 수">'
      + '<span>전일 종가 <b data-us-metric="previous">-</b></span>'
      + '<span>거래량 <b data-us-metric="volume">-</b> <small data-us-volume-basis></small></span>'
      + '<span>전일 거래량 대비 <b data-us-metric="volchange">-</b></span>'
      + '<span>52주 범위 <b data-us-metric="week52">-</b></span>'
      + '<span>상장주식 수 <b data-us-metric="shares">-</b></span>'
      + '</div>'
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
      + '<section class="ss-panel-left us-stocks-panel us-stocks-orderbook-panel"><div class="us-stocks-panel-head"><h4>호가</h4><span data-us-book-status>10단계 호가 · 연결 중</span></div>'
      + '<div class="ss-session"><div class="ss-session-values">'
      + '<div><span>시가</span><b data-us-metric="open">-</b></div>'
      + '<div><span>고가</span><b class="ss-session-high" data-us-metric="high">-</b></div>'
      + '<div><span>저가</span><b class="ss-session-low" data-us-metric="low">-</b></div>'
      + '</div></div>'
      + '<div id="usStocksOrderbook" class="us-stocks-orderbook"><div class="us-stocks-loading">' + global.NineUI.spinner() + '호가를 불러오는 중...</div></div></section>'
      + '<div class="ss-resize-handle" role="separator" aria-orientation="vertical" aria-label="호가창과 차트 폭 조절" tabindex="0"></div>'
      + '<section class="ss-panel-right us-stocks-panel us-stocks-chart-panel"><div class="us-stocks-panel-head"><h4>차트</h4><span>국내 종목 차트와 동일</span></div>'
      + '<div id="usStocksChart" class="us-native-chart-mount"><div class="us-stocks-loading">' + global.NineUI.spinner() + '차트를 불러오는 중...</div></div></section>'
      + optionsPanelHtml(quote.symbol, true)
      + '<section class="ss-news-panel us-stocks-panel us-stocks-news-panel"><div class="us-stocks-panel-head ss-news-panel-head"><h3>관련 뉴스</h3><span>최근 24시간</span></div><div id="usStocksNews" class="us-stocks-news"><div class="us-stocks-loading">' + global.NineUI.spinner() + '뉴스를 불러오는 중...</div></div></section>'
      + '</div>';
  }

  function updateQuoteFields(quote, detail) {
    document.dispatchEvent(new CustomEvent('nine-stock-quote', { detail: {
      code: 'US:' + quote.symbol, price: quote.price, changeRate: quoteSessionRate(quote)
    } }));
    var card = detail.querySelector('.us-stocks-live-card');
    if (!card) return;
    var rate = quoteSessionRate(quote);
    var priceWrap = card.querySelector('[data-us-price-wrap]');
    applyTone(priceWrap, rate);
    card.querySelector('[data-us-name]').textContent = localizedUsName(quote.symbol, quote.name);
    card.querySelector('[data-us-symbol]').textContent = quote.symbol + ' · ' + exchangeLabel(quote.exchange);
    card.querySelector('[data-us-state]').textContent = marketStateLabel(quote.market_state);
    var basisNode = card.querySelector('[data-us-basis]');
    if (basisNode) basisNode.textContent = basisLabel(quote);
    card.querySelector('[data-us-price]').textContent = formatPrice(quote.price);
    var changeNode = card.querySelector('[data-us-change]');
    changeNode.textContent = formatPercent(rate);
    applyTone(changeNode, rate);
    var sessionNode = card.querySelector('[data-us-session-comparison]');
    if (sessionNode) {
      sessionNode.hidden = quote.market_state !== 'post';
      var ref = quote.regular_session;
      sessionNode.textContent = quote.market_state === 'post' && ref && ref.session_date === quote.session_date
        ? '정규장 종가 ' + formatPrice(ref.price) + ' (' + formatPercent(ref.change_rate) + ') · 시간외 등락은 정규장 종가 대비'
        : '시간외 등락 기준 확인 중';
    }
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
      var node = card.querySelector('[data-us-metric="' + key + '"]') || detail.querySelector('[data-us-metric="' + key + '"]');
      if (node) node.textContent = values[key];
    });
    // 거래량은 정규장 누적이다(2026-11-04 SPCX 마감 비교: 한투 71,164,835 = Yahoo 정규장 거래량). 장중에는 마감 전 값이라 일봉 확정값보다 작다.
    var volBasis = detail.querySelector('[data-us-volume-basis]');
    if (volBasis) {
      var vs = quote.market_state;
      volBasis.textContent = vs === 'regular' ? '(마감 전 누적)' : vs === 'pre' ? '' : '(정규장 누적)';
    }
    updateVolumeChange(detail, quote);
    var updatedNode = card.querySelector('[data-us-updated]');
    if (updatedNode) updatedNode.textContent = updatedLabel(quote);
    updateOrderbookCurrent();
  }

  // 전일 거래량 대비: 오늘 누적 거래량 ÷ 직전 거래일 하루 거래량 - 1. 직전 거래일 거래량은 차트(일봉) 응답에서 얻고,
  // 아직 없으면 '-'로 둔다(국내 카드와 같은 계산).
  function updateVolumeChange(card, quote) {
    var node = (card || document).querySelector('[data-us-metric="volchange"]');
    if (!node) return;
    var prev = state.prevDailyVolume;
    var vol = Number(quote && quote.volume);
    if (!(prev > 0) || !Number.isFinite(vol) || vol < 0) { node.textContent = '-'; return; }
    var pct = (vol - prev) / prev * 100;
    node.textContent = formatPercent(pct);
    applyTone(node, pct);
  }

  function capturePrevDailyVolume(bars, symbol) {
    if (state.symbol !== symbol || !bars || !bars.length) return;
    var quote = state.lastQuote || {};
    var last = bars[bars.length - 1];
    // 마지막 일봉이 오늘(세션) 것이면 그 앞 봉이 직전 거래일, 아니면 마지막 봉이 직전 거래일
    var useIndex = last && quote.session_date && last.date === quote.session_date ? bars.length - 2 : bars.length - 1;
    var prev = bars[useIndex];
    state.prevDailyVolume = prev && prev.volume > 0 ? prev.volume : null;
    updateVolumeChange(null, state.lastQuote);
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
    var row = mount && mount.querySelector('[data-field="current-row"]');
    if (!row || !state.lastQuote) return;
    var rate = quoteSessionRate(state.lastQuote);
    row.querySelector('[data-field="current-price"]').textContent = formatPrice(state.lastQuote.price);
    row.querySelector('[data-field="current-change"]').textContent = formatPercent(rate);
    row.className = 'ob-current-row ' + usObTone(rate);
  }

  function usObTone(rate) { return rate > 0 ? 'ob-up' : rate < 0 ? 'ob-down' : 'ob-flat'; }

  // 키움 usa20101 호가 가격은 부호(+/-)가 붙어 오는 경우가 있어(실측: AAPL 호가가 -331.98로 옴) 절댓값을 가격으로 쓴다.
  function absLevels(levels) {
    return (levels || []).map(function (l) {
      var price = Number(l && l.price);
      return Object.assign({}, l, { price: Number.isFinite(price) ? Math.abs(price) : l && l.price });
    });
  }

  function renderOrderbook(book) {
    var mount = document.querySelector('#usStocksOrderbook');
    if (!mount) return;
    var levelSize = function (level) {
      var value = level && level.size != null ? level.size : level && level.qty;
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    };
    // 국내 호가창(js/order-book.js)과 같은 세로 사다리: 위가 매도(높은 가격부터), 가운데 현재가, 아래가 매수.
    var toRows = function (levels) {
      return absLevels(levels).map(function (l) { return { price: Number(l.price), qty: levelSize(l) }; })
        .filter(function (r) { return Number.isFinite(r.price) && r.price > 0; })
        .sort(function (a, b) { return b.price - a.price; });
    };
    var asks = toRows(book && book.asks).slice(-10);
    var bids = toRows(book && book.bids).slice(0, 10);
    var maxAsk = Math.max.apply(null, asks.map(function (r) { return r.qty; }).concat([0]));
    var maxBid = Math.max.apply(null, bids.map(function (r) { return r.qty; }).concat([0]));
    var maxLevel = Math.max(maxAsk, maxBid, 1);
    // 호가강도는 최대 한 칸이 아니라 10단계 총잔량 비율이다(최대 한 칸은 주문 한두 건에 초 단위로 요동친다).
    var sumAsk = asks.reduce(function (sum, r) { return sum + r.qty; }, 0);
    var sumBid = bids.reduce(function (sum, r) { return sum + r.qty; }, 0);
    var strength = sumAsk > 0 ? sumBid / sumAsk * 100 : null;
    var strengthWidth = strength == null ? 0 : Math.max(0, Math.min(100, strength / 2));
    var balanceLabel = sumAsk === sumBid ? '균형' : (sumAsk > sumBid ? '매도 우위' : '매수 우위');
    var current = state.lastQuote && Number(state.lastQuote.price);
    if (!asks.length && !bids.length && !Number.isFinite(current)) {
      mount.innerHTML = '<div class="us-stocks-empty">호가 데이터가 없습니다.</div>';
      return;
    }
    var html = '<div class="us-stocks-level-summary">'
      + '<div class="us-stocks-level-row"><span class="us-level-label us-book-ask-text">저항(매도벽)</span><i><em class="us-book-ask-fill" style="width:' + Math.round(maxAsk / maxLevel * 100) + '%"></em></i><b>' + formatVolume(maxAsk) + '</b></div>'
      + '<div class="us-stocks-level-row"><span class="us-level-label us-book-bid-text">지지(매수벽)</span><i><em class="us-book-bid-fill" style="width:' + Math.round(maxBid / maxLevel * 100) + '%"></em></i><b>' + formatVolume(maxBid) + '</b></div>'
      + '<div class="us-stocks-level-row"><span class="us-level-label">호가강도</span><i><em class="us-book-strength-fill" style="width:' + strengthWidth + '%"></em></i><b>' + (strength == null ? '-' : strength.toFixed(1) + '%') + '</b></div>'
      + '<p>미국 10단계 호가 총잔량(매수÷매도) 기준 · 실제 체결강도와는 다를 수 있습니다. <strong>' + balanceLabel + '</strong></p>'
      + '</div>';
    var prev = state.usDepth && state.usDepth.symbol === state.symbol ? state.usDepth : null;
    var rate = state.lastQuote ? quoteSessionRate(state.lastQuote) : 0;
    html += '<div class="ob-table ob-table-pairs" aria-label="매도 최대 10호가와 매수 최대 10호가">'
      + '<div class="ob-pair-head"><span class="ob-bid-text">매수 잔량 · 증감</span><span>가격</span><span class="ob-ask-text">매도 잔량 · 증감</span></div>'
      + asks.map(function (r, i) { return usLadderRow(r, maxLevel, 'ask', i + 1, prev); }).join('');
    if (Number.isFinite(current)) {
      html += '<div class="ob-current-row ' + usObTone(rate) + '" data-field="current-row" data-dominance="'
        + (maxBid > maxAsk ? 'bid' : maxAsk > maxBid ? 'ask' : 'balanced') + '">'
        + '<span data-field="current-price">' + formatPrice(current) + '</span>'
        + ' <span class="ob-current-change" data-field="current-change">' + formatPercent(rate) + '</span></div>';
    }
    html += bids.map(function (r, i) { return usLadderRow(r, maxLevel, 'bid', i + 1, prev); }).join('') + '</div>';
    var totalAsk = asks.reduce(function (sum, r) { return sum + r.qty; }, 0);
    var totalBid = bids.reduce(function (sum, r) { return sum + r.qty; }, 0);
    var totalAll = totalAsk + totalBid || 1;
    html += '<div class="ob-footer"><div class="ob-footer-label">표시 호가 잔량 합계 <span class="ob-ask-text">매도 <b>' + formatVolume(totalAsk) + '</b></span> · <span class="ob-bid-text">매수 <b>' + formatVolume(totalBid) + '</b></span></div>'
      + '<div class="ob-footer-bar"><span class="ob-footer-bar-ask" style="width:' + (totalAsk / totalAll * 100).toFixed(1) + '%"></span><span class="ob-footer-bar-bid" style="width:' + (totalBid / totalAll * 100).toFixed(1) + '%"></span></div></div>';
    mount.innerHTML = html;
    state.usDepth = { symbol: state.symbol, ask: usDepthMap(asks), bid: usDepthMap(bids) };
    state.lastSil = { mount: mount, asks: asks, bids: bids };
    drawUsSilhouette(mount, asks, bids);
  }

  function usDepthMap(rows) {
    var map = Object.create(null);
    rows.forEach(function (r) { map[String(r.price)] = r.qty; });
    return map;
  }

  // 증감은 직전 조회와 같은 가격의 잔량 차이다(국내 호가창과 같은 방식). 처음 보는 가격은 '—'.
  function usLadderRow(row, maxQty, side, level, prev) {
    var pct = Math.max(2, Math.round(row.qty / maxQty * 100));
    var textCls = side === 'ask' ? 'ob-ask-text' : 'ob-bid-text';
    var before = prev && prev[side][String(row.price)];
    var delta = before == null ? null : row.qty - before;
    var deltaCls = delta == null ? '' : delta > 0 ? ' ob-delta-up' : delta < 0 ? ' ob-delta-down' : '';
    var deltaText = delta == null ? '—' : (delta > 0 ? '+' : '') + formatVolume(delta);
    var depth = '<span class="ob-depth"><span class="ob-qty ' + textCls + '">' + formatVolume(row.qty) + '</span>'
      + '<span class="ob-delta' + deltaCls + '">' + deltaText + '</span>'
      + '<span class="ob-bar-wrap"><span class="' + (side === 'ask' ? 'ob-bar-ask' : 'ob-bar-bid') + '" style="width:' + pct + '%"></span></span></span>';
    return '<div class="ob-row ob-row-' + side + '" data-level="' + level + '">'
      + (side === 'ask' ? '<span class="ob-depth-empty"></span>' : depth)
      + '<span class="ob-price ' + textCls + '">' + formatPrice(row.price) + '</span>'
      + (side === 'ask' ? depth : '<span class="ob-depth-empty"></span>')
      + '</div>';
  }

  // 핵심 매물대(stock-search.js가 내보내는 window.__ssVolumeProfile의 core 구간)에 놓인 호가를 주황으로.
  // 매물대가 아직 없으면 같은 편 평균의 1.8배 이상인 잔량 벽을 주황으로 둔다.
  function usWallLevels(rows) {
    var set = {};
    var vp = global.__ssVolumeProfile;
    var inProfile = !!(vp && vp.bins && vp.code === 'US:' + state.symbol);
    if (inProfile) {
      rows.forEach(function (r, i) {
        for (var k = 0; k < vp.bins.length; k++) {
          var b = vp.bins[k];
          if (r.price >= b.low && r.price < b.high) { if (b.core) set[i + 1] = true; break; }
        }
      });
    }
    // 핵심 매물대가 호가 범위 밖이어도 주황이 하나는 보이게, 같은 편 평균의 1.8배 이상인 가장 두꺼운 벽을 함께 표시
    if (rows.length < 3) return set;
    var best = -1;
    rows.forEach(function (r, i) {
      var others = rows.filter(function (o, j) { return j !== i; });
      var avg = others.reduce(function (sum, o) { return sum + o.qty; }, 0) / others.length;
      if (avg > 0 && r.qty >= avg * 1.8 && (best < 0 || r.qty > rows[best].qty)) best = i;
    });
    if (best >= 0) set[best + 1] = true;
    return set;
  }

  // 막대 끝점을 이은 실루엣 선은 국내 호가창과 같은 그림(js/order-book.js)을 쓰고, 벽 판정만 미국 쪽 기준(usWallLevels)을 넘긴다.
  function drawUsSilhouette(mount, asks, bids) {
    if (!global.OrderBook || !global.OrderBook.drawSilhouette) return;
    global.OrderBook.drawSilhouette(mount, asks, bids, { ask: usWallLevels(asks), bid: usWallLevels(bids) });
  }

  global.addEventListener('ss-volume-profile', function () {
    var last = state.lastSil;
    if (last && last.mount && document.body.contains(last.mount)) drawUsSilhouette(last.mount, last.asks, last.bids);
  });

  function optionsPanelHtml(symbol, embedded) {
    if (symbol !== 'NVDA' || !global.NineAccess || !global.NineAccess.isAdmin()) return '';
    return '<section id="usStocksOptions" class="us-stocks-panel us-alpaca-options'
      + (embedded ? ' ss-options-panel' : '') + '">'
      + '<h4>NVDA 당일 만기 옵션</h4><div data-us-alpaca-options>수집 내역을 확인하는 중입니다.</div></section>';
  }

  function refreshOptions() {
    var mount = document.querySelector('[data-us-alpaca-options]');
    if (!mount || state.symbol !== 'NVDA' || Date.now() < (mount.optionsCheckedUntil || 0)) return;
    mount.optionsCheckedUntil = Date.now() + 300000;
    fetchJson(API_BASE + '/us-options/NVDA', {credentials:'include', cache:'no-store'}).then(function (data) {
      if (!mount.isConnected) return;
      if (!data || !data.available) {
        mount.textContent = data && data.status === 'no_expiry'
          ? data.expiry + ' 미국 거래일 당일 만기 계약이 없습니다.'
          : '저장된 당일 만기 옵션이 없습니다.';
        return;
      }
      var time = new Date(data.collected_at * 1000).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'});
      var quoteTime = data.quote_at && new Date(data.quote_at * 1000).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'});
      var summary = data.gex
        ? '추정 순감마 ' + data.gex.net.toFixed(1) + '백만 달러/주가 1% · 최대 콜 행사가 ' + formatPrice(data.gex.call_wall)
          + ' · 최대 풋 행사가 ' + formatPrice(data.gex.put_wall)
        : '감마 노출 미집계 · 감마 또는 미결제약정 누락';
      var oiCount = data.contracts.filter(function (row) { return row.open_interest != null; }).length;
      var cells = data.contracts.map(function (row) {
        return '<tr><td>' + (row.side === 'C' ? '콜' : '풋') + '</td><td>' + formatPrice(row.strike)
          + '</td><td>' + formatPrice(row.bid) + '</td><td>' + formatPrice(row.ask)
          + '</td><td>' + (row.gamma == null ? '—' : row.gamma.toFixed(4))
          + '</td><td>' + (row.open_interest == null ? '—' : row.open_interest.toLocaleString('en-US'))
          + '</td><td>' + escapeHtml(row.open_interest_date || '—') + '</td></tr>';
      }).join('');
      mount.innerHTML = '<p>Alpaca 참고 호가 · 만기 ' + escapeHtml(data.expiry) + ' (미국 동부) · 수집 '
        + escapeHtml(time) + ' KST' + (data.stale ? ' · 직전 저장 자료' : '')
        + (quoteTime ? ' · 최근 옵션 호가 ' + escapeHtml(quoteTime) + ' KST' : '') + '</p>'
        + '<p>스냅샷 ' + data.snapshot_count + '/' + data.contracts.length + '계약 · 미결제약정 수신 ' + oiCount
        + '/' + data.contracts.length + '계약</p><p>' + summary
        + '</p><div class="us-alpaca-options-table" tabindex="0" role="region" aria-label="행사가별 옵션">'
        + '<table><thead><tr><th>구분</th><th>행사가</th><th>매수호가</th><th>매도호가</th>'
        + '<th>감마</th><th>미결제약정</th><th>OI 기준일</th></tr></thead><tbody>' + cells + '</tbody></table></div>';
    }).catch(function () {
      if (mount.isConnected) mount.textContent = '저장된 옵션 자료를 불러오지 못했습니다.';
    });
  }

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
          .then(function (payload) {
            var bars = normalizeChartBars(payload && payload.points, timeframe);
            if (timeframe !== 'minute') capturePrevDailyVolume(bars, symbol);
            return bars;
          });
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
    var symbol = state.symbol;
    fetchJson(API_BASE + '/us-analysis/' + encodeURIComponent(symbol))
      .then(function (payload) { if (state.symbol === symbol) renderAnalysis(payload); })
      .catch(function () {
        if (state.symbol !== symbol) return;
        var mount = document.querySelector('#usStocksAnalysis');
        if (mount) mount.innerHTML = '<div class="us-stocks-analysis-empty">재무·실적 데이터를 확인할 수 없습니다.</div>';
      });
  }

  function renderAnalysis(payload) {
    var mount = document.querySelector('#usStocksAnalysis');
    if (!mount) return;
    mount.querySelectorAll('.us-analysis-source').forEach(function (node) { node.remove(); });
    var summary = payload && payload.summary || {};
    var recommendation = summary.recommendation || {};
    setAnalysisCard(mount, 'financials', formatMetric(summary.pe, 1, ' PER'), 'PBR ' + formatMetric(summary.pb, 1, ' · ') + 'ROE ' + formatMetric(summary.roe, 1, '%'));
    var revenue = formatCompactUsd(summary.latest_revenue);
    var netIncome = formatCompactUsd(summary.latest_net_income);
    setAnalysisCard(mount, 'statements', revenue === '-' ? '매출성장 ' + formatMetric(summary.revenue_growth, 1, '%') : '매출 ' + revenue, netIncome === '-' ? '순이익률 ' + formatMetric(summary.net_margin, 1, '%') : '순이익 ' + netIncome + ' · 성장 ' + formatMetric(summary.revenue_growth, 1, '%'));
    setAnalysisCard(mount, 'earnings', summary.next_earnings || '예정일 없음', '최근 EPS 서프라이즈 ' + formatMetric(summary.eps_surprise_percent, 1, '%'));
    setAnalysisCard(mount, 'recommendation', consensusHtml(recommendation), '');
    var recCard = mount.querySelector('[data-analysis-card="recommendation"]');
    if (recCard) {
      if (recommendation.available === false) setAnalysisCard(mount, 'recommendation', '집계 자료 없음', '');
      recCard.insertAdjacentHTML('beforeend', '<p class="us-analysis-source">Finnhub · 기준월 '
        + escapeHtml(recommendation.period ? String(recommendation.period).slice(0, 7) : '미제공')
        + ' · <a href="https://widget.finnhub.io/widgets/recommendation?symbol=' + encodeURIComponent(payload.symbol || state.symbol || '') + '" target="_blank" rel="noopener noreferrer">종목별 원본 ↗</a><br>매수·매도에 강력 의견 포함</p>');
      recCard.insertAdjacentHTML('beforeend', analystRatingsHtml(summary.analyst_ratings));
    }
    var period = summary.statement_period || {};
    var financialCard = mount.querySelector('[data-analysis-card="financials"]');
    if (financialCard) {
      var fields = summary.metric_basis || {};
      financialCard.insertAdjacentHTML('beforeend', '<details class="us-analysis-source"><summary>재무 기준·출처</summary>'
        + ['pe', 'pb', 'roe'].map(function (key) {
          return '<p>' + escapeHtml(key.toUpperCase() + ': Finnhub ' + ((fields[key] || {}).field || '자료 없음')) + '</p>';
        }).join('') + '<p>비율 기준일: 제공처 미제공 · 조회 ' + escapeHtml(payload.fetched_at || '미확보') + '</p></details>');
    }
    var statementCard = mount.querySelector('[data-analysis-card="statements"]');
    if (statementCard) statementCard.insertAdjacentHTML('beforeend', '<p class="us-analysis-source">Finnhub 공시 · '
      + escapeHtml(period.start && period.end ? String(period.start).slice(0, 10) + ' ~ ' + String(period.end).slice(0, 10) + ' 기간 합계 (누적 포함)' : '실적 기준기간 미확보')
      + ' · 공시 ' + escapeHtml(period.filed ? String(period.filed).slice(0, 10) : '미확보') + '</p>');
    renderEtfHoldings(mount, payload.etf_holdings, payload.instrument);
    var insider = summary.insider && summary.insider.available !== false ? summary.insider : null;
    setAnalysisCard(mount, 'insider', insider ? '매수 ' + formatVolume(insider.buy_shares) + '주' : '공시 자료 미확보', insider ? '매도 ' + formatVolume(insider.sell_shares) + '주 · 기타 ' + insider.other_count + '건' : '');
    var insiderCard = mount.querySelector('[data-analysis-card="insider"]');
    if (insiderCard && insider) insiderCard.insertAdjacentHTML('beforeend', insiderHtml(insider));
    var insiderOpen = insiderCard && insiderCard.querySelector('[data-insider-open]');
    if (insiderOpen) insiderOpen.addEventListener('click', function () { openInsiderModal(insider); });
  }

  function consensusHtml(rec) {
    var values = [Number(rec.strongBuy || 0) + Number(rec.buy || 0), Number(rec.hold || 0), Number(rec.sell || 0) + Number(rec.strongSell || 0)];
    if (rec.available !== true || values.some(function (n) { return !isFinite(n) || n < 0; })) return '집계 자료 없음';
    var total = values.reduce(function (sum, n) { return sum + n; }, 0);
    var labels = ['매수', '보유', '매도'], colors = ['#d24f45', '#94a3b8', '#1261c4'];
    var circumference = 2 * Math.PI * 36, offset = 0;
    var circles = values.map(function (n, i) {
      var length = total ? n / total * circumference : 0;
      var html = length ? '<circle cx="48" cy="48" r="36" fill="none" stroke="' + colors[i] + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + Math.max(0, length - 7) + ' ' + circumference + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 48 48)" />' : '';
      offset += length; return html;
    }).join('');
    var accessible = labels.map(function (label, i) { return label + ' ' + values[i]; }).join(' · ');
    return '<span class="us-consensus"><svg viewBox="0 0 96 96" role="img" aria-label="' + escapeAttr(accessible) + '"><circle cx="48" cy="48" r="36" fill="none" stroke="#e5eaf2" stroke-width="6" />' + circles
      + '<text x="48" y="48" text-anchor="middle" dominant-baseline="middle">' + total + '</text><text x="48" y="65" text-anchor="middle" class="us-consensus-caption">의견</text></svg>'
      + '<span class="us-consensus-legend">' + labels.map(function (label, i) { return '<span><i style="background:' + colors[i] + '"></i>' + label + '<strong>' + values[i] + '</strong></span>'; }).join('') + '</span></span>';
  }

  function analystRatingsHtml(data) {
    data = data || {};
    var rows = Array.isArray(data.items) ? data.items : [];
    var body = data.status === 'access_denied' ? '현재 연결 권한으로 기관별 평가를 조회할 수 없습니다.' : '기관별 평가 자료 미확보';
    function grade(value) {
      var labels = {buy:'매수', sell:'매도', hold:'보유', neutral:'중립', overweight:'비중 확대', underweight:'비중 축소', outperform:'시장수익률 상회', underperform:'시장수익률 하회'};
      var raw = String(value || '');
      return labels[raw.toLowerCase()] ? labels[raw.toLowerCase()] + ' (' + raw + ')' : raw;
    }
    if (data.available && rows.length) body = '<ul>' + rows.map(function (row) {
      var date = Number(row.gradeTime) > 0 ? new Date(Number(row.gradeTime) * 1000).toISOString().slice(0, 10) : '일자 미제공';
      return '<li><strong>' + escapeHtml(row.company || '기관명 미제공') + '</strong> · ' + escapeHtml(date) + '<br>' + escapeHtml(grade(row.fromGrade) || '이전 의견 없음') + ' → ' + escapeHtml(grade(row.toGrade) || '미제공') + ' · ' + escapeHtml(({up:'상향',down:'하향',main:'유지',init:'신규',reit:'재확인'})[row.action] || row.action || '') + '</li>';
    }).join('') + '</ul>';
    var heading = data.available && rows.length ? '기관별 최근 투자의견 (' + rows.length + '건)' : data.status === 'access_denied' ? '기관별 투자의견 · 제공하지 않음' : '기관별 투자의견 · 자료 미확보';
    return '<details class="us-analysis-source us-analysis-records"><summary>' + heading + '</summary><p>최근 90일 · 최대 50건. 월별 집계와 기준일이 다릅니다. 투자의견이며 기관의 실제 매매 내역이 아닙니다.</p>' + body + '</details>';
  }

  function insiderHtml(data) {
    var rows = Array.isArray(data.items) ? data.items : [];
    return '<div class="us-analysis-source us-analysis-records"><p>Finnhub · 거래일 ' + escapeHtml(data.from || '') + ' ~ ' + escapeHtml(data.to || '') + '</p><p>매수 ' + Number(data.buy_count || 0) + '건 · 매도 ' + Number(data.sell_count || 0) + '건 · 반환자료 최신 공시 ' + escapeHtml(data.latest_filing || '없음') + '</p><p>비파생 P/S만 매수·매도 집계. 보상·행사·세금·증여는 기타 변동입니다.</p>'
      + '<button type="button" class="us-modal-open" data-insider-open>내부자 공시 내역 (' + rows.length + '건) 보기</button></div>';
  }

  function insiderRowsHtml(data) {
    var rows = Array.isArray(data.items) ? data.items : [];
    return '<ul class="us-modal-list">' + rows.map(function (row) {
      var source = /^https:\/\/www\.sec\.gov\//.test(row.source_url || '') ? ' · <a href="' + escapeAttr(row.source_url) + '" target="_blank" rel="noopener noreferrer">SEC 원문 ↗</a>' : '';
      return '<li><strong>' + escapeHtml(row.name || '이름 미제공') + '</strong> · ' + escapeHtml(row.label || '기타 변동') + ' (' + escapeHtml(row.code) + ')<br>거래 ' + escapeHtml(row.transaction_date) + ' · 공시 ' + escapeHtml(row.filing_date) + '<br>' + escapeHtml(formatVolume(row.shares)) + '주 · 단가 ' + escapeHtml(row.price == null ? '미제공' : String(row.price)) + ' ' + escapeHtml(row.currency || '(통화 미제공)') + (row.is_derivative === true ? ' · 파생상품' : '') + source + '</li>';
    }).join('') + '</ul><p class="us-modal-note">제공처가 반환한 공시 범위이며 전체 공시의 완전성을 보장하지 않습니다. 거래일 미확인 ' + Number(data.missing_dates || 0) + '건은 집계 제외.</p>';
  }

  // 내부자 공시 내역은 카드 안 접이식 목록 대신 모달로 보여 준다(176건처럼 길어 카드 높이를 밀어내던 문제).
  function openInsiderModal(data) {
    closeInsiderModal();
    var count = Array.isArray(data.items) ? data.items.length : 0;
    var overlay = document.createElement('div');
    overlay.className = 'us-modal-overlay';
    overlay.setAttribute('data-insider-modal', '');
    overlay.innerHTML = '<div class="us-modal" role="dialog" aria-modal="true" aria-label="내부자 공시 내역">'
      + '<div class="us-modal-head"><strong>내부자 공시 내역 (' + count + '건)</strong>'
      + '<button type="button" class="us-modal-close" aria-label="닫기">✕</button></div>'
      + '<div class="us-modal-body">' + insiderRowsHtml(data) + '</div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeInsiderModal(); });
    overlay.querySelector('.us-modal-close').addEventListener('click', closeInsiderModal);
    document.addEventListener('keydown', onInsiderModalKey);
    overlay.querySelector('.us-modal-close').focus();
  }

  function closeInsiderModal() {
    var old = document.querySelector('[data-insider-modal]');
    if (old) old.remove();
    document.removeEventListener('keydown', onInsiderModalKey);
  }

  function onInsiderModalKey(event) { if (event.key === 'Escape') closeInsiderModal(); }

  function renderEtfHoldings(mount, data, instrument) {
    var old = mount.querySelector('[data-etf-holdings]');
    if (old) old.remove();
    if (!instrument || instrument.quote_type !== 'ETF') return;
    data = data || {};
    var section = document.createElement('section');
    section.className = 'us-stocks-analysis-card us-etf-holdings';
    section.setAttribute('data-etf-holdings', '');
    var official = /^https:\/\//i.test(data.issuer_url || '') ? '<a href="' + escapeAttr(data.issuer_url) + '" target="_blank" rel="noopener noreferrer">운용사 공식 사이트 ↗</a>' : '운용사 링크 미확보';
    var html = '<h3>ETF 구성종목</h3>';
    if (data.status !== 'ready' || !Array.isArray(data.holdings) || !data.holdings.length) {
      html += '<p>구성종목 데이터 준비 중</p><p>' + official + '</p>';
    } else {
      html += '<p>전체 ' + escapeHtml(data.total_count) + '개 · 명세 기준일 ' + escapeHtml(data.as_of) + '</p>';
      if (/^https:\/\//i.test(data.source_url || '')) html += '<p><a href="' + escapeAttr(data.source_url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(data.source || '자료 출처') + ' ↗</a></p>';
      function rows(items) {
        return '<ul>' + items.map(function (row) {
          var kind = { equity: '현물', cash: '현금', derivative: '파생상품', other: '기타' }[row.kind] || '미분류';
          return '<li>' + escapeHtml(row.name) + ' · ' + escapeHtml(row.ticker || '티커 없음') + ' · '
            + escapeHtml(Number(row.weight_percent).toFixed(2)) + '% · ' + kind + ' · '
            + escapeHtml(row.basis === 'economic_exposure' ? '실질 노출' : '보유 평가액')
            + (row.country ? ' · ' + escapeHtml(row.country) : '') + '</li>';
        }).join('') + '</ul>';
      }
      html += rows(data.holdings.slice(0, 20));
      if (data.holdings.length > 20) html += '<details><summary>전체 보기 (' + data.holdings.length + '개)</summary>' + rows(data.holdings.slice(20)) + '</details>';
      html += '<p>' + official + '</p>';
    }
    html += '<p class="us-analysis-source">현물 보유와 스왑·파생상품의 실질 기업 노출은 다를 수 있습니다. 비중 합계는 100%와 다를 수 있습니다.</p>';
    section.innerHTML = html;
    mount.appendChild(section);
  }

  function renderCongressLinks() {
    var mount = document.querySelector('#usStocksCongress');
    if (!mount) return;
    var symbol = encodeURIComponent(state.symbol || '');
    var quiverUrl = 'https://www.quiverquant.com/congresstrading/stock/' + symbol;
    // Capitol Trades는 종목 주소가 내부 번호라 티커로 바로 갈 수 없어, 티커 검색 결과 페이지로 연결한다.
    var capitolUrl = 'https://www.capitoltrades.com/issuers?search=' + symbol;
    mount.innerHTML = '<div class="us-stocks-congress-links">'
      + '<a class="us-stocks-congress-link" href="' + escapeAttr(quiverUrl) + '" target="_blank" rel="noopener">'
      + '<strong>Quiver에서 ' + escapeHtml(state.symbol) + ' 거래 확인</strong><span>의원별 매수·매도·거래일·신고일 보기 ↗</span></a>'
      + '<a class="us-stocks-congress-link" href="' + escapeAttr(capitolUrl) + '" target="_blank" rel="noopener">'
      + '<strong>Capitol Trades에서 ' + escapeHtml(state.symbol) + ' 검색</strong><span>의원·정당별 거래 내역과 규모 보기 ↗</span></a>'
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
      var dateText = isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' });
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
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).formatToParts(date);
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
    return timestamp > 0 && timestamp <= now
      && now - timestamp <= 24 * 60 * 60 * 1000;
  }

  function formatNewsTime(value) {
    var date = new Date(String(value || ''));
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString('en-GB', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false
      }) + ' ET';
    }
    var match = String(value || '').match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
    return match ? ('0' + match[1]).slice(-2) + ':' + match[2] : '--:--';
  }

  function metric(label, value) {
    var key = arguments[2] || '';
    var cls = arguments[3] ? ' class="' + escapeAttr(arguments[3]) + '"' : '';
    // 사이트 다크 모드 규칙이 !important로 글자색을 덮으므로, 등락색은 CSS 변수를 인라인 !important로 건다.
    if (arguments[3] === 'us-up') cls += ' style="color: var(--us-tone-up) !important"';
    if (arguments[3] === 'us-down') cls += ' style="color: var(--us-tone-down) !important"';
    return '<div class="us-stocks-metric"><span>' + escapeHtml(label) + '</span><b' + cls + ' data-us-metric="' + escapeAttr(key) + '">' + escapeHtml(value) + '</b></div>';
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
    return global.NineHttp.json(url, { fetchOptions: options }).then(function (body) {
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
    return isNaN(date.getTime()) ? '업데이트 시각 확인 중' : ((window.NineTime && window.NineTime.updated(date)) || date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }));
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
    if (quote && quote.extended_unverified) return ' · 시간외 체결 미확인 · 15초 재조회';
    if (quote && quote.delayed) return ' · 지연 시세 · 15초 자동 갱신';
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
    return marketStateLabel(quote && quote.market_state) + ' · ' + formatUpdated(quote && (quote.quote_time || quote.updated_at));
  }
  function marketStateLabel(value) {
    return global.NineUI.marketSessionLabel(value);
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
  function escapeHtml(value) { return global.NineUI.escapeHtml(value); }
  function escapeAttr(value) { return escapeHtml(value); }

  global.UsStocks = { init: init, select: select, pause: pause,
    currentQuote: function () { return state.lastQuote && state.lastQuote.symbol === state.symbol ? state.lastQuote : null; },
    selectChartInFullscreen: selectChartInFullscreen, commitFullscreenChart: commitFullscreenChart };
})(window);

