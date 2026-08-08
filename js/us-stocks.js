/**
 * 미국주식 페이지 - 공통 검색에서 연결되는 미국 개별주식 1차 화면.
 * 현재는 시세·등락·거래량·고저가·장 상태를 15초마다 갱신한다.
 * 차트·재무·실적 데이터는 다음 단계에서 같은 ticker API에 붙인다.
 */
(function (global) {
  'use strict';

  var API_BASE = 'https://goodbyestar.cloud';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/us-stocks.css';
  var REFRESH_MS = 15000;
  var LAST_SYMBOL_KEY = 'us:lastSelected';
  var DEFAULT_SYMBOL = 'AAPL';
  var state = { container: null, symbol: null, refreshTimer: null, initialized: false };
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: 'Apple Inc.', aliases: '애플 apple' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', aliases: '마이크로소프트 microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', aliases: '엔비디아 nvidia' },
    { symbol: 'AMZN', name: 'Amazon.com, Inc.', aliases: '아마존 amazon' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', aliases: '구글 알파벳 google alphabet' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', aliases: '테슬라 tesla' },
    { symbol: 'META', name: 'Meta Platforms, Inc.', aliases: '메타 meta 페이스북' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', aliases: '브로드컴 broadcom' },
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
      if (document.hidden) stopRefresh();
      else if (state.symbol) startRefresh();
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
      + '<p class="us-stocks-disclaimer">키움증권 1차 · 한국투자증권 2차 · 증권사 API 상태와 거래소 시간대에 따라 지연될 수 있습니다.</p>'
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
    results.innerHTML = '<div class="us-stocks-loading">미국주식 시세를 불러오는 중...</div>';
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
    return fetchJson(API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=' + limit)
      .then(function (rows) {
        if (rows && rows.length) return rows;
        return localSearchRows(query, limit);
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
    state.symbol = String(symbol || '').toUpperCase().replace(/^US:/, '');
    try { localStorage.setItem(LAST_SYMBOL_KEY, state.symbol); } catch (err) { /* 저장소가 막힌 환경도 조회는 계속한다. */ }
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = '<div class="us-stocks-loading">' + escapeHtml(state.symbol) + ' 시세를 불러오는 중...</div>';
    refreshQuote();
    startRefresh();
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

  function refreshQuote() {
    if (!state.symbol) return;
    fetchJson(API_BASE + '/us-quote/' + encodeURIComponent(state.symbol))
      .then(function (quote) {
        renderQuote(quote);
        loadOrderbook();
        loadChart();
        loadNews(quote.name || state.symbol);
      })
      .catch(function () {
        var detail = document.querySelector('#usStocksDetail');
        if (detail && !detail.querySelector('.us-stocks-live-card')) detail.innerHTML = '<div class="us-stocks-empty us-stocks-error">시세를 불러오지 못했어요.</div>';
      });
  }

  function renderQuote(quote) {
    if (!quote || quote.symbol !== state.symbol) return;
    var detail = document.querySelector('#usStocksDetail');
    if (!detail) return;
    var cls = signClass(quote.change_rate);
    detail.innerHTML = '<div class="us-stocks-live-card">'
      + '<div class="us-stocks-live-head"><div><span class="us-stocks-market-badge">미국주식</span><h3>' + escapeHtml(quote.name || quote.symbol) + '</h3><p>' + escapeHtml(quote.symbol) + ' · ' + escapeHtml(quote.exchange || '') + '</p></div>'
      + '<span class="us-stocks-market-state">' + marketStateLabel(quote.market_state) + '</span></div>'
      + '<div class="us-stocks-live-price ' + cls + '">' + formatPrice(quote.price) + '<span>' + formatPercent(quote.change_rate) + '</span></div>'
      + '<div class="us-stocks-metrics">'
      + metric('전일 종가', formatPrice(quote.previous_close))
      + metric('오늘 고가', formatPrice(quote.day_high))
      + metric('오늘 저가', formatPrice(quote.day_low))
      + metric('거래량', formatVolume(quote.volume))
      + metric('52주 범위', formatPrice(quote.week52_low) + ' ~ ' + formatPrice(quote.week52_high))
      + '</div>'
      + '<div class="us-stocks-live-footer"><span>15초 자동 갱신</span><span>' + escapeHtml(formatUpdated(quote.updated_at)) + '</span><span>' + escapeHtml(quote.source || '') + '</span></div>'
      + '</div>'
      + '<div class="us-stocks-market-grid">'
      + '<section class="us-stocks-panel"><div class="us-stocks-panel-head"><h4>호가</h4><span>키움 10호가</span></div><div id="usStocksOrderbook" class="us-stocks-orderbook"><div class="us-stocks-loading">호가를 불러오는 중...</div></div></section>'
      + '<section class="us-stocks-panel"><div class="us-stocks-panel-head"><h4>차트</h4><span>오늘 1분봉</span></div><div id="usStocksChart" class="us-stocks-chart"><div class="us-stocks-loading">차트를 불러오는 중...</div></div></section>'
      + '</div>'
      + '<section class="us-stocks-panel us-stocks-news-panel"><div class="us-stocks-panel-head"><h4>관련 뉴스</h4><span>최근 헤드라인</span></div><div id="usStocksNews" class="us-stocks-news"><div class="us-stocks-loading">뉴스를 불러오는 중...</div></div></section>';
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
    var html = '<div class="us-stocks-book-head"><span>매도 잔량</span><span>가격</span><span>매수 잔량</span></div>';
    for (var i = 0; i < rows; i++) {
      var ask = asks[i] || {};
      var bid = bids[i] || {};
      html += '<div class="us-stocks-book-row"><span class="us-down">' + formatVolume(ask.size) + '</span><b>' + formatPrice(ask.price || bid.price) + '</b><span class="us-up">' + formatVolume(bid.size) + '</span></div>';
    }
    mount.innerHTML = html || '<div class="us-stocks-empty">호가 데이터가 없습니다.</div>';
  }

  function loadChart() {
    if (!state.symbol) return;
    fetchJson(API_BASE + '/us-chart/' + encodeURIComponent(state.symbol) + '?timeframe=minute')
      .then(function (chart) {
        if (chart && chart.points && chart.points.length >= 2) {
          renderChart(chart);
          return null;
        }
        return fetchJson(API_BASE + '/us-chart/' + encodeURIComponent(state.symbol) + '?timeframe=daily');
      })
      .then(function (chart) { if (chart) renderChart(chart); })
      .catch(function () {
        var mount = document.querySelector('#usStocksChart');
        if (mount) mount.innerHTML = '<div class="us-stocks-empty">차트 데이터를 확인할 수 없습니다.</div>';
      });
  }

  function renderChart(chart) {
    var mount = document.querySelector('#usStocksChart');
    var points = chart && chart.points ? chart.points : [];
    if (!mount || points.length < 2) {
      if (mount) mount.innerHTML = '<div class="us-stocks-empty">차트 데이터가 없습니다.</div>';
      return;
    }
    var width = 720, height = 190, pad = 14;
    var prices = points.map(function (point) { return Number(point.price); });
    var min = Math.min.apply(Math, prices), max = Math.max.apply(Math, prices);
    var range = max - min || 1;
    var coords = points.map(function (point, index) {
      var x = pad + (width - pad * 2) * index / (points.length - 1);
      var y = height - pad - (height - pad * 2) * (Number(point.price) - min) / range;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var tone = prices[prices.length - 1] >= prices[0] ? 'up' : 'down';
    mount.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="미국주식 가격 차트">'
      + '<line class="us-chart-grid" x1="' + pad + '" y1="' + (height / 2) + '" x2="' + (width - pad) + '" y2="' + (height / 2) + '"></line>'
      + '<polyline class="us-chart-line ' + tone + '" points="' + coords + '"></polyline>'
      + '</svg><div class="us-chart-range"><span>' + formatPrice(min) + '</span><span>' + formatPrice(max) + '</span></div>';
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

  function renderNews(items) {
    var mount = document.querySelector('#usStocksNews');
    if (!mount) return;
    if (!items.length) {
      mount.innerHTML = '<div class="us-stocks-empty">관련 최신 뉴스가 없습니다.</div>';
      return;
    }
    mount.innerHTML = items.map(function (item) {
      return '<a class="us-stocks-news-item" href="' + escapeAttr(item.link || '#') + '" target="_blank" rel="noopener">'
        + '<b>' + escapeHtml(item.title || '') + '</b><small>' + escapeHtml(item.pubDate || '') + '</small></a>';
    }).join('');
  }

  function metric(label, value) {
    return '<div class="us-stocks-metric"><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(value) + '</b></div>';
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
  function hideSuggestions() { var box = document.querySelector('#usStocksSuggest'); if (box) { box.innerHTML = ''; box.classList.remove('active'); } }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function escapeAttr(value) { return escapeHtml(value); }

  global.UsStocks = { init: init, select: select };
})(window);
