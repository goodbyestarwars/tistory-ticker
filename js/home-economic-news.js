/* 홈 상단 경제 종합뉴스: 국내 뉴스·공시 API의 최신 항목을 compact timeline으로 표시한다. */
(function (global) {
  'use strict';

  var DOMESTIC_API_URL = 'https://goodbyestar.cloud/domestic-news?kind=news&limit=50';
  var US_API_URL = 'https://goodbyestar.cloud/foreign-news?limit=50';
  var DOMESTIC_MARKET_API_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=20';
  var US_MARKET_API_URL = 'https://goodbyestar.cloud/market-board?market=us&limit=20';
  var ECONOMIC_NEWS_WS_URL = 'wss://goodbyestar.cloud/ws/economic-news';
  var REFRESH_MS = 5 * 60 * 1000;
  var SESSION_CHECK_MS = 60 * 1000;
  var WS_RECONNECT_MS = 10 * 1000;
  var WS_FALLBACK_MS = 6 * 1000;
  var WS_KEEPALIVE_MS = 25 * 1000;
  var state = {
    mount: null, timer: null, sessionTimer: null, socket: null, socketGeneration: 0,
    socketOpened: false, socketReconnectTimer: null, socketFallbackTimer: null, socketKeepaliveTimer: null,
    market: '', quoteMap: {}, items: [], flash: [], loading: false
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function parseDate(value) {
    var text = String(value || '').trim();
    if (/^\d{8}$/.test(text)) {
      text = text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6) + 'T00:00:00+09:00';
    }
    return new Date(text);
  }

  function dateValue(value) {
    var parsed = parseDate(value);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function currentMarket() {
    if (global.HomeMarketSelection && typeof global.HomeMarketSelection.get === 'function') {
      return global.HomeMarketSelection.get();
    }
    var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var hour = kst.getUTCHours();
    return hour >= 20 || hour < 8 ? 'us' : 'domestic';
  }

  function timeLabel(value) {
    var parsed = parseDate(value);
    if (isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function periodKey(value) {
    var parsed = parseDate(value);
    if (isNaN(parsed.getTime())) return 'pm';
    var hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false
    }).format(parsed));
    if (hour === 24) hour = 0;
    return hour < 12 ? 'am' : 'pm';
  }

  function kindLabel(item) {
    return item && item.category && item.category !== '일반' ? item.category : '뉴스';
  }

  function quoteMapFrom(payload) {
    var data = payload && (payload.data || payload);
    var map = {};
    Object.keys((data && data.sections) || {}).forEach(function (key) {
      (data.sections[key] || []).forEach(function (row) {
        if (!row) return;
        var rate = Number(row.change_rate);
        var entry = { rate: isFinite(rate) ? rate : 0, name: String(row.name || '').trim() };
        if (row.code) map[String(row.code).toUpperCase()] = entry;
        if (entry.name) map['name:' + entry.name.toLowerCase()] = entry;
      });
    });
    return map;
  }

  function quoteFor(item) {
    var code = String(item.stockCode || '').trim().toUpperCase();
    if (code && state.quoteMap[code]) return state.quoteMap[code];
    var stockName = String(item.stockName || '').trim().toLowerCase();
    if (stockName && state.quoteMap['name:' + stockName]) return state.quoteMap['name:' + stockName];
    var title = String(item.title || '').toLowerCase();
    var found = null;
    Object.keys(state.quoteMap).some(function (key) {
      if (key.indexOf('name:') !== 0) return false;
      var name = key.slice(5);
      if (name && title.indexOf(name) !== -1) { found = state.quoteMap[key]; return true; }
      return false;
    });
    return found;
  }

  function watchlistItems() {
    try {
      return global.Watchlist && typeof global.Watchlist.getList === 'function'
        ? (global.Watchlist.getList() || []) : [];
    } catch (err) {
      return [];
    }
  }

  function isWatchlistDisclosure(item) {
    var code = String(item && (item.stockCode || item.code) || '').trim().toUpperCase();
    var name = String(item && (item.stockName || item.name) || '').trim().toLowerCase();
    if (code === '005930' || code === '000660' || /삼성전자|하이닉스/.test(name)) return true;
    return watchlistItems().some(function (stock) {
      var stockCode = String(stock && (stock.code || stock.stockCode) || '').trim().toUpperCase();
      var stockName = String(stock && (stock.name || stock.stockName) || '').trim().toLowerCase();
      return (code && stockCode && code === stockCode) || (name && stockName && name === stockName);
    });
  }

  function flashTimeLabel(value) {
    var text = String(value || '').trim();
    if (/^\d{8}$/.test(text)) return text.slice(4, 6) + '/' + text.slice(6, 8);
    var parsed = parseDate(value);
    if (isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function renderFlash(items) {
    var list = state.mount && state.mount.querySelector('[data-hen-breaking-list]');
    if (!list) return;
    var rows = (items || []).filter(function (item) {
      if (!item || !item.title) return false;
      return item.kind !== 'disclosure' || isWatchlistDisclosure(item);
    }).slice().sort(function (a, b) {
      var importance = Number(b.importance || 0) - Number(a.importance || 0);
      return importance || dateValue(b.pubDate) - dateValue(a.pubDate);
    }).slice(0, 8);
    if (!rows.length) {
      list.innerHTML = '<p class="hen-breaking-empty">중요 속보가 없습니다.</p>';
      return;
    }
    list.innerHTML = rows.map(function (item) {
      var label = item.flashType || (item.kind === 'disclosure' ? '공시' : '속보');
      var href = item.link || '#';
      return '<a class="hen-breaking-row" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">'
        + '<time>' + escapeHtml(flashTimeLabel(item.pubDate)) + '</time>'
        + '<b class="hen-breaking-badge hen-breaking-badge--' + escapeHtml(String(label).toLowerCase()) + '">' + escapeHtml(label) + '</b>'
        + '<strong>' + escapeHtml(item.title) + '</strong>'
        + '</a>';
    }).join('');
  }

  function render(items, market, flash) {
    var list = state.mount.querySelector('[data-hen-list]');
    var updated = state.mount.querySelector('[data-hen-updated]');
    var session = state.mount.querySelector('[data-hen-session]');
    if (session) session.textContent = market === 'us' ? '미국 · 실시간 타임라인' : '국내 · 실시간 타임라인';
    renderFlash(flash || state.flash);
    var rows = (items || []).filter(function (item) { return item && item.kind !== 'disclosure'; }).slice().sort(function (a, b) {
      return dateValue(b.pubDate) - dateValue(a.pubDate);
    }).slice(0, 50);
    if (!rows.length) {
      list.innerHTML = '<p class="home-card-state">현재 표시할 경제 뉴스가 없습니다.</p>';
      return;
    }
    var groups = { am: [], pm: [] };
    rows.forEach(function (item, index) {
      groups[periodKey(item.pubDate)].push({ item: item, index: index });
    });
    function renderPeriod(key, label) {
      var group = groups[key];
      if (!group.length) return '';
      return '<section class="hen-period hen-period-' + key + '" aria-label="' + label + ' 경제 뉴스">'
        + '<div class="hen-period-head"><strong>' + label + '</strong><span>' + group.length + '건</span></div>'
        + '<div class="hen-period-list">'
        + group.map(function (entry) {
          var item = entry.item;
          var quote = quoteFor(item);
          var tone = quote && quote.rate > 0 ? ' is-up' : quote && quote.rate < 0 ? ' is-down' : '';
          return '<a class="hen-row' + tone + '" href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">'
            + '<span class="hen-rail"><i class="' + (entry.index === 0 ? 'is-latest' : '') + '"></i></span>'
            + '<time class="hen-time">' + escapeHtml(timeLabel(item.pubDate)) + '</time>'
            + '<span class="hen-main"><strong>' + escapeHtml(item.title || '') + '</strong>'
            + '<small><em>' + escapeHtml(kindLabel(item)) + '</em></small></span>'
            + '</a>';
        }).join('')
        + '</div></section>';
    }
    list.innerHTML = '<div class="hen-periods">' + renderPeriod('pm', '오후') + renderPeriod('am', '오전') + '</div>';
    if (updated) updated.textContent = '업데이트 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('economic-news ' + response.status);
      return response.json();
    });
  }

  function applyNewsPayload(payload) {
    var data = payload && (payload.data || payload);
    if (!data || !Array.isArray(data.items)) return false;
    var market = data.market === 'us' ? 'us' : 'domestic';
    state.market = market;
    state.items = data.items;
    state.flash = Array.isArray(data.flash) ? data.flash : [];
    render(state.items, market, state.flash);
    state.loading = false;
    return true;
  }

  function loadMarketBoard(market) {
    var marketUrl = market === 'us' ? US_MARKET_API_URL : DOMESTIC_MARKET_API_URL;
    state.market = market;
    return fetchJson(marketUrl).then(function (json) {
      state.quoteMap = quoteMapFrom(json);
      if (state.market === market) render(state.items, market, state.flash);
    }).catch(function () { return null; });
  }

  function clearNewsSocketTimers() {
    if (state.socketReconnectTimer) clearTimeout(state.socketReconnectTimer);
    if (state.socketFallbackTimer) clearTimeout(state.socketFallbackTimer);
    if (state.socketKeepaliveTimer) clearInterval(state.socketKeepaliveTimer);
    state.socketReconnectTimer = null;
    state.socketFallbackTimer = null;
    state.socketKeepaliveTimer = null;
  }

  function closeNewsSocket(reconnect) {
    clearNewsSocketTimers();
    state.socketGeneration += 1;
    var socket = state.socket;
    state.socket = null;
    state.socketOpened = false;
    if (socket) {
      try { socket.close(); } catch (err) { /* already closed */ }
    }
    if (reconnect) scheduleNewsSocketReconnect();
  }

  function scheduleNewsSocketReconnect() {
    if (state.socketReconnectTimer || document.hidden || !('WebSocket' in global)) return;
    state.socketReconnectTimer = setTimeout(function () {
      state.socketReconnectTimer = null;
      connectNewsSocket();
    }, WS_RECONNECT_MS);
  }

  function connectNewsSocket() {
    if (document.hidden || !('WebSocket' in global) || state.socket) return;
    clearNewsSocketTimers();
    var generation = ++state.socketGeneration;
    var socket;
    try {
      socket = new WebSocket(ECONOMIC_NEWS_WS_URL);
    } catch (err) {
      fetchNews();
      scheduleNewsSocketReconnect();
      return;
    }
    state.socket = socket;
    state.socketOpened = false;
    state.socketFallbackTimer = setTimeout(function () {
      if (state.socket === socket && !state.socketOpened) fetchNews();
    }, WS_FALLBACK_MS);
    socket.onopen = function () {
      if (state.socket !== socket || generation !== state.socketGeneration) return;
      state.socketOpened = true;
      if (state.socketFallbackTimer) clearTimeout(state.socketFallbackTimer);
      state.socketFallbackTimer = null;
      state.socketKeepaliveTimer = setInterval(function () {
        if (state.socket === socket && socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, WS_KEEPALIVE_MS);
      loadMarketBoard(currentMarket());
    };
    socket.onmessage = function (event) {
      if (state.socket !== socket || generation !== state.socketGeneration) return;
      var packet;
      try { packet = JSON.parse(event.data); } catch (err) { return; }
      if (packet && packet.type === 'economic-news') applyNewsPayload(packet.data || packet);
    };
    socket.onerror = function () {
      // onclose performs the reconnect and REST fallback so that one failure
      // cannot trigger duplicate requests.
    };
    socket.onclose = function () {
      if (state.socket !== socket || generation !== state.socketGeneration) return;
      state.socket = null;
      state.socketOpened = false;
      if (!state.mount.querySelector('.hen-row')) fetchNews();
      scheduleNewsSocketReconnect();
    };
  }

  function fetchNews() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    var market = currentMarket();
    state.market = market;
    var newsUrl = market === 'us' ? US_API_URL : DOMESTIC_API_URL;
    var marketUrl = market === 'us' ? US_MARKET_API_URL : DOMESTIC_MARKET_API_URL;
    var newsRequest = fetchJson(newsUrl).then(function (json) {
      var payload = json.data || json;
      state.items = payload.items || [];
      state.flash = Array.isArray(payload.flash) ? payload.flash : state.flash;
      render(state.items, market, state.flash);
    });
    var marketRequest = fetchJson(marketUrl).then(function (json) {
      state.quoteMap = quoteMapFrom(json);
      if (state.market === market) render(state.items, market, state.flash);
    }).catch(function () { return null; });
    return Promise.all([newsRequest, marketRequest]).catch(function () {
      var list = state.mount && state.mount.querySelector('[data-hen-list]');
      if (list && !list.querySelector('.hen-row')) list.innerHTML = '<p class="home-card-state">경제 뉴스를 잠시 불러오지 못했습니다.</p>';
    }).then(function () {
      state.loading = false;
    });
  }

  function init(options) {
    var mount = options && options.mount;
    if (!mount || mount.getAttribute('data-hen-ready') === '1') return;
    state.mount = mount;
    state.market = currentMarket();
    mount.setAttribute('data-hen-ready', '1');
    global.addEventListener('watchlist:changed', function () {
      render(state.items, state.market, state.flash);
    });
    global.addEventListener('home-market-change', function () {
      closeNewsSocket(false);
      state.market = currentMarket();
      loadMarketBoard(state.market);
      connectNewsSocket();
      if (!state.socketOpened) fetchNews();
    });
    loadMarketBoard(state.market);
    connectNewsSocket();
    state.timer = setInterval(function () {
      if (!document.hidden && !state.socketOpened) fetchNews();
    }, REFRESH_MS);
    state.sessionTimer = setInterval(function () {
      if (!document.hidden && currentMarket() !== state.market) {
        closeNewsSocket(true);
        loadMarketBoard(currentMarket());
        if (!state.socket) connectNewsSocket();
        if (!state.socketOpened) fetchNews();
      }
    }, SESSION_CHECK_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) closeNewsSocket(false);
      else {
        loadMarketBoard(currentMarket());
        connectNewsSocket();
      }
    });
  }

  global.HomeEconomicNews = { init: init };
})(window);
