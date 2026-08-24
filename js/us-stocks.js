/**
 * 미국주식 페이지 - 공통 검색에서 연결되는 미국 개별주식 1차 화면.
 * 현재는 시세·등락·거래량·고저가·장 상태를 15초마다 갱신한다.
 * 차트·재무·실적 데이터는 다음 단계에서 같은 ticker API에 붙인다.
 */
(function (global) {
  'use strict';

  var API_BASE = 'https://goodbyestar.cloud';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/us-stocks.css?v=20260817-news-columns-v1';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var REFRESH_MS = 15000;
  var REALTIME_QUOTES_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var REALTIME_RECONNECT_MS = 5000;
  var LAST_SYMBOL_KEY = 'us:lastSelected';
  var DEFAULT_SYMBOL = 'AAPL';
  var state = { container: null, symbol: null, refreshTimer: null, realtimeSocket: null, realtimeTimer: null, realtimeGeneration: 0, initialized: false, renderedSymbol: null, nativeChartPromise: null, lastQuote: null };
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: 'Apple Inc.', aliases: '애플 apple' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', aliases: '마이크로소프트 microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', aliases: '엔비디아 nvidia' },
    { symbol: 'AMZN', name: 'Amazon.com, Inc.', aliases: '아마존 amazon' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', aliases: '구글 알파벳 google alphabet' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', aliases: '테슬라 tesla' },
    { symbol: 'META', name: 'Meta Platforms, Inc.', aliases: '메타 meta 페이스북' },
    { symbol: 'INTC', name: 'Intel Corporation', aliases: '인텔 intel' },
    { symbol: 'SPCX', name: 'SpaceX', aliases: '스페이스X spacex' },
    { symbol: 'SKHY', name: 'SK하이닉스(ADR)', aliases: 'SK하이닉스 하이닉스 sk hynix' },
    { symbol: 'MRVL', name: 'Marvell Technology', aliases: '마벨 마벨테크놀로지 marvell' },
    { symbol: 'RGTI', name: 'Rigetti Computing', aliases: '리게티 rigetti' },
    { symbol: 'RKLB', name: 'Rocket Lab', aliases: '로켓랩 로켓 랩 rocket lab' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', aliases: '브로드컴 broadcom' },
    { symbol: 'ORCL', name: 'Oracle Corporation', aliases: '오라클 oracle' },
    { symbol: 'MU', name: 'Micron Technology', aliases: '마이크론 마이크론테크놀로지 micron' },
    { symbol: 'CBRS', name: 'Cerebras Systems', aliases: '세레브라스 cerebras' },
    { symbol: 'PLTR', name: 'Palantir Technologies', aliases: '팔란티어 palantir' },
    { symbol: 'SNDK', name: 'Sandisk', aliases: '샌디스크 sandisk' },
    { symbol: 'DELL', name: 'Dell Technologies', aliases: '델 델테크놀로지스 dell' },
    { symbol: 'IONQ', name: 'IonQ', aliases: '아이온큐 ionq' },
    { symbol: 'LLY', name: 'Eli Lilly and Company', aliases: '일라이릴리 일라이 릴리 eli lilly lilly' },
    { symbol: 'ASTS', name: 'AST SpaceMobile', aliases: 'ast asts 스페이스모바일 spacemobile' },
    { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', aliases: 'amd' },
    { symbol: 'NFLX', name: 'Netflix, Inc.', aliases: '넷플릭스 netflix' },
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', aliases: 'spy s&p500' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust', aliases: 'qqq 나스닥' }
  ];

  function init(targetContainer) {
    var container = targetContainer || document.querySelector('#stock-search');
    if (!container) return;
    if (state.initialized && state.container === container) return;
    state.container = container;
    state.initialized = true;
    injectStyles();
    if (!targetContainer) {
      document.title = document.title.replace(/증시검색|실시간 시세/g, '미국주식');
      document.querySelectorAll('.post-single-title').forEach(function (title) {
        if (/증시검색|실시간 시세/.test(title.textContent.trim())) title.textContent = '미국주식';
      });
    }
    container.innerHTML = buildShell();
    autoSelect();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopRefresh(); stopRealtime(); }
      else if (state.symbol) { startRefresh(); startRealtime(); }
    });
  }

  function injectStyles() {
    if (document.querySelector('link[data-us-stocks-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    link.setAttribute('data-us-stocks-css', '1');
    document.head.appendChild(link);
  }

  function buildShell() {
    return '<section class="us-stocks-shell">'
      + '<div class="us-stocks-heading"><div><span class="us-stocks-eyebrow">US MARKET</span><h2>미국주식</h2></div>'
      + '<span class="us-stocks-note">한국·미국 통합 시세</span></div>'
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
          + items.map(resultRowHtml).join('');
        results.querySelectorAll('[data-symbol]').forEach(function (row) {
          row.addEventListener('click', function () { select(row.getAttribute('data-symbol')); });
        });
      })
      .catch(function () {
        results.innerHTML = '<div class="us-stocks-empty us-stocks-error">해당 미국주식 데이터를 찾지 못했어요.</div>';
      });
  }

  function resultRowHtml(item) {
    var quote = item.quote || {};
    var cls = signClass(quote.change_rate);
    return '<button type="button" class="us-stocks-result-row" data-symbol="' + escapeAttr(item.row.symbol) + '">'
      + '<span class="us-stocks-result-name"><b>' + escapeHtml(item.row.symbol) + '</b><small>' + escapeHtml(item.row.name) + '</small></span>'
      + '<span class="' + cls + '">' + formatPrice(quote.price) + '</span>'
      + '<span class="' + cls + '">' + formatPercent(quote.change_rate) + '</span>'
      + '<span>' + formatVolume(quote.volume) + '</span>'
      + '</button>';
  }

  function searchRows(query, limit) {
    var localRows = localSearchRows(query, limit);
    if (localRows.length) return Promise.resolve(localRows);
    return fetchJson(API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=' + limit)
      .then(function (rows) {
        if (!rows || !rows.length) return localRows;
        var seen = {};
        return localRows.concat(rows).filter(function (row) {
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
    state.symbol = String(symbol || '').toUpperCase().replace(/^US:/, '');
    state.renderedSymbol = null;
    state.nativeChartPromise = null;
    state.lastQuote = null;
    try { localStorage.setItem(LAST_SYMBOL_KEY, state.symbol); } catch (err) { /* 저장소가 막힌 환경도 조회는 계속한다. */ }
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = '<div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>' + escapeHtml(state.symbol) + ' 시세를 불러오는 중...</div>';
    refreshQuote();
    startRefresh();
    startRealtime();
  }

  function startRefresh() {
    stopRefresh();
    if (!state.symbol || document.hidden) return;
    state.refreshTimer = setInterval(refreshQuote, REFRESH_MS);
  }

  function stopRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function stopRealtime() {
    state.realtimeGeneration += 1;
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
    if (!state.symbol || document.hidden || !global.WebSocket) return;
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
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      };
      socket.onerror = function () { try { socket.close(); } catch (err) {} };
      socket.onclose = function () {
        if (generation !== state.realtimeGeneration || document.hidden) return;
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
    if (!state.symbol) return;
    fetchJson(API_BASE + '/us-quote/' + encodeURIComponent(state.symbol))
      .then(function (quote) {
        var firstRender = state.renderedSymbol !== state.symbol;
        renderQuote(quote);
        state.renderedSymbol = state.symbol;
        loadOrderbook();
        if (firstRender) {
            loadNativeChart();
            loadAnalysis();
            renderCongressLinks();
            loadNews(quote.name || state.symbol);
        }
      })
      .catch(function () {
        var detail = document.querySelector('#usStocksDetail');
        if (detail && !detail.querySelector('.us-stocks-live-card')) detail.innerHTML = '<div class="us-stocks-empty us-stocks-error">시세를 불러오지 못했어요.</div>';
      });
  }

  function renderQuote(quote) {
    if (!quote || quote.symbol !== state.symbol) return;
    state.lastQuote = Object.assign({}, state.lastQuote || {}, quote);
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    var card = detail.querySelector('.us-stocks-live-card');
    if (!card || card.getAttribute('data-symbol') !== quote.symbol) {
      detail.innerHTML = '<div class="us-stocks-live-card" data-symbol="' + escapeAttr(quote.symbol) + '">'
        + '<div class="us-stocks-live-head"><div class="us-stocks-identity">' + stockIconHtml(quote.symbol) + '<div><span class="us-stocks-market-badge">미국주식</span><h3 data-us-name></h3><p data-us-symbol></p></div></div>'
        + '<span class="us-stocks-market-state" data-us-state></span></div>'
        + '<div class="us-stocks-live-price" data-us-price-wrap><span data-us-price></span><span data-us-change></span></div>'
        + '<div class="us-stocks-metrics">'
        + metric('전일 종가', '', 'previous')
        + metric('오늘 고가', '', 'high')
        + metric('오늘 저가', '', 'low')
        + metric('거래량', '', 'volume')
        + metric('52주 범위', '', 'week52')
        + '</div>'
        + '<div class="us-stocks-live-footer"><span>15초 자동 갱신</span><span data-us-updated></span></div>'
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
        + '<section class="us-stocks-panel us-stocks-orderbook-panel"><div class="us-stocks-panel-head"><h4>호가</h4><span>10단계 호가</span></div><div id="usStocksOrderbook" class="us-stocks-orderbook"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>호가를 불러오는 중...</div></div></section>'
        + '<section class="us-stocks-panel us-stocks-chart-panel"><div class="us-stocks-panel-head"><h4>차트</h4><span>국내 종목 차트와 동일</span></div>'
        + '<div id="usStocksChart" class="us-native-chart-mount"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>차트를 불러오는 중...</div></div></section>'
        + '</div>'
        + '<section class="us-stocks-panel us-stocks-news-panel"><div class="us-stocks-panel-head"><h4>관련 뉴스</h4><span>최근 24시간</span></div><div id="usStocksNews" class="us-stocks-news"><div class="us-stocks-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>뉴스를 불러오는 중...</div></div></section>';
    }
    updateQuoteFields(quote, detail);
  }

  function updateQuoteFields(quote, detail) {
    var card = detail.querySelector('.us-stocks-live-card');
    if (!card) return;
    var priceWrap = card.querySelector('[data-us-price-wrap]');
    priceWrap.classList.remove('us-up', 'us-down', 'us-flat');
    priceWrap.classList.add(signClass(quote.change_rate));
    card.querySelector('[data-us-name]').textContent = quote.name || quote.symbol;
    card.querySelector('[data-us-symbol]').textContent = quote.symbol + ' · ' + (quote.exchange || '');
    card.querySelector('[data-us-state]').textContent = marketStateLabel(quote.market_state);
    card.querySelector('[data-us-price]').textContent = formatPrice(quote.price);
    card.querySelector('[data-us-change]').textContent = formatPercent(quote.change_rate);
    var values = {
      previous: formatPrice(quote.previous_close),
      high: formatPrice(quote.day_high),
      low: formatPrice(quote.day_low),
      volume: formatVolume(quote.volume),
      week52: formatPrice(quote.week52_low) + ' ~ ' + formatPrice(quote.week52_high)
    };
    Object.keys(values).forEach(function (key) {
      var node = card.querySelector('[data-us-metric="' + key + '"]');
      if (node) node.textContent = values[key];
    });
    card.querySelector('[data-us-updated]').textContent = formatUpdated(quote.updated_at);
  }

  function loadOrderbook() {
    if (!state.symbol) return;
    fetchJson(API_BASE + '/us-orderbook/' + encodeURIComponent(state.symbol))
      .then(renderOrderbook)
      .catch(function () {
        var mount = document.querySelector('#usStocksOrderbook');
        if (mount) mount.innerHTML = '<div class="us-stocks-empty">호가 데이터를 확인할 수 없습니다.</div>';
      });
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
    var sumSize = function (levels) {
      return levels.reduce(function (sum, level) { return sum + levelSize(level); }, 0);
    };
    var askTotal = Number(book.totalAskQty);
    var bidTotal = Number(book.totalBidQty);
    if (!Number.isFinite(askTotal)) askTotal = sumSize(asks);
    if (!Number.isFinite(bidTotal)) bidTotal = sumSize(bids);
    var maxLevel = Math.max.apply(null, asks.concat(bids).map(levelSize).concat([1]));
    var balanceTotal = askTotal + bidTotal;
    var askShare = balanceTotal > 0 ? Math.round(askTotal / balanceTotal * 100) : 0;
    var bidShare = balanceTotal > 0 ? 100 - askShare : 0;
    var balanceLabel = askTotal === bidTotal ? '균형' : (askTotal > bidTotal ? '매도 우위' : '매수 우위');
    var current = state.lastQuote && Number(state.lastQuote.price);
    if (!rows && !Number.isFinite(current)) {
      mount.innerHTML = '<div class="us-stocks-empty">호가 데이터가 없습니다.</div>';
      return;
    }
    var html = '<div class="us-stocks-book-balance">'
      + '<div class="us-stocks-book-balance-head"><span>호가 잔량</span><b>' + balanceLabel + '</b></div>'
      + '<div class="us-stocks-book-balance-bar"><i class="us-book-ask-fill" style="width:' + askShare + '%"></i><i class="us-book-bid-fill" style="width:' + bidShare + '%"></i></div>'
      + '<div class="us-stocks-book-balance-values"><span class="us-book-ask-text">매도 ' + formatVolume(askTotal) + ' (' + askShare + '%)</span><span class="us-book-bid-text">매수 ' + formatVolume(bidTotal) + ' (' + bidShare + '%)</span></div>'
      + '</div>'
      + '<div class="us-stocks-book-head"><span>매도 잔량</span><span>가격</span><span>매수 잔량</span></div>';
    for (var i = 0; i < rows; i++) {
      var ask = asks[i] || {};
      var bid = bids[i] || {};
      var askWidth = Math.round(levelSize(ask) / maxLevel * 100);
      var bidWidth = Math.round(levelSize(bid) / maxLevel * 100);
      html += '<div class="us-stocks-book-row">'
        + '<span class="us-book-side us-book-ask"><b>' + formatVolume(levelSize(ask)) + '</b><i><em style="width:' + askWidth + '%"></em></i></span>'
        + '<b class="us-stocks-book-price ' + (ask.price ? 'us-book-ask-price' : 'us-book-bid-price') + '">' + formatPrice(ask.price || bid.price) + '</b>'
        + '<span class="us-book-side us-book-bid"><i><em style="width:' + bidWidth + '%"></em></i><b>' + formatVolume(levelSize(bid)) + '</b></span>'
        + '</div>';
    }
    if (Number.isFinite(current)) {
      html += '<div class="us-stocks-book-current"><span>현재가</span><strong>' + formatPrice(current) + '</strong><span>' + formatPercent(state.lastQuote.change_rate) + '</span></div>';
    }
    mount.innerHTML = html || '<div class="us-stocks-empty">호가 데이터가 없습니다.</div>';
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
        var query = '?timeframe=' + timeframe;
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
    mount.innerHTML = '<div class="app-news-timeline us-stocks-news-timeline" role="list">' + sortedItems.map(function (item, index) {
      var pubDate = item.pubDate || '';
      var date = new Date(String(pubDate));
      var dateText = isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
      return '<a class="app-news-event us-stocks-news-item" href="' + escapeAttr(item.link || '#') + '" target="_blank" rel="noopener" role="listitem">'
        + '<div class="app-news-date"><strong>' + escapeHtml(dateText) + '</strong><small>' + escapeHtml(formatNewsTime(pubDate)) + '</small></div>'
        + '<div class="app-news-rail" aria-hidden="true"><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></div>'
        + '<div class="app-news-body"><div class="app-news-meta"><b class="app-news-market app-news-market--미국">미국</b><b class="app-news-type app-news-type--뉴스">뉴스</b><small>' + escapeHtml(item.source || item.publisher || '') + '</small></div>'
        + '<strong>' + escapeHtml(item.title || '') + '</strong></div></a>';
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
    var suffix = divisor === 1e9 ? 'B' : divisor === 1e6 ? 'M' : divisor === 1e3 ? 'K' : '';
    return '$' + (number / divisor).toFixed(divisor === 1 ? 0 : 1) + suffix;
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
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
  function marketStateLabel(value) {
    return { pre: '장전', regular: '정규장', post: '장후', closed: '장 마감' }[value] || '시장 상태 확인 중';
  }
  function signClass(value) { return value > 0 ? 'us-up' : value < 0 ? 'us-down' : 'us-flat'; }
  function stockIconHtml(symbol) {
    var code = String(symbol || '').replace(/^US:/i, '').toUpperCase();
    if (!code) return '';
    return '<img class="us-stocks-icon" data-icon-code="' + escapeHtml(code) + '" data-icon-market="us" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.StockIconFallback ? window.StockIconFallback(this) : this.style.display=\'none\'">';
  }
  function hideSuggestions() { var box = document.querySelector('#usStocksSuggest'); if (box) { box.innerHTML = ''; box.classList.remove('active'); } }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function escapeAttr(value) { return escapeHtml(value); }

  global.UsStocks = { init: init, select: select };
})(window);
