/* 홈 상단 경제 종합뉴스: 국내 뉴스·공시 API의 최신 항목을 compact timeline으로 표시한다. */
(function (global) {
  'use strict';

  var DOMESTIC_API_URL = 'https://goodbyestar.cloud/domestic-news?kind=news&limit=20';
  var US_API_URL = 'https://goodbyestar.cloud/foreign-news?limit=20';
  var DOMESTIC_MARKET_API_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=20';
  var US_MARKET_API_URL = 'https://goodbyestar.cloud/market-board?market=us&limit=20';
  var REFRESH_MS = 5 * 60 * 1000;
  var SESSION_CHECK_MS = 60 * 1000;
  var state = { mount: null, timer: null, sessionTimer: null, market: '', quoteMap: {}, items: [], loading: false };

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
    var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var hour = kst.getUTCHours();
    return hour >= 20 || hour < 8 ? 'us' : 'domestic';
  }

  function timeLabel(value) {
    var parsed = parseDate(value);
    if (isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
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

  function render(items, market) {
    var list = state.mount.querySelector('[data-hen-list]');
    var updated = state.mount.querySelector('[data-hen-updated]');
    var session = state.mount.querySelector('[data-hen-session]');
    if (session) session.textContent = market === 'us' ? '미국 · 실시간 타임라인' : '국내 · 실시간 타임라인';
    var rows = (items || []).filter(function (item) { return item && item.kind !== 'disclosure'; }).slice().sort(function (a, b) {
      return dateValue(b.pubDate) - dateValue(a.pubDate);
    }).slice(0, 8);
    if (!rows.length) {
      list.innerHTML = '<p class="home-card-state">현재 표시할 경제 뉴스가 없습니다.</p>';
      return;
    }
    list.innerHTML = rows.map(function (item, index) {
      var quote = quoteFor(item);
      var tone = quote && quote.rate > 0 ? ' is-up' : quote && quote.rate < 0 ? ' is-down' : '';
      return '<a class="hen-row' + tone + '" href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">'
        + '<span class="hen-rail"><svg class="hen-zigzag" viewBox="0 0 17 36" preserveAspectRatio="none" aria-hidden="true"><path d="M8.5 0 L2 9 L15 18 L2 27 L8.5 36"></path></svg><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></span>'
        + '<time>' + escapeHtml(timeLabel(item.pubDate)) + '</time>'
        + '<span class="hen-main"><strong>' + escapeHtml(item.title || '') + '</strong>'
        + '<small><em>' + escapeHtml(kindLabel(item)) + '</em>' + escapeHtml(item.source || item.provider || '') + '</small></span>'
        + '</a>';
    }).join('');
    if (updated) updated.textContent = '업데이트 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('economic-news ' + response.status);
      return response.json();
    });
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
      render(state.items, market);
    });
    var marketRequest = fetchJson(marketUrl).then(function (json) {
      state.quoteMap = quoteMapFrom(json);
      if (state.market === market) render(state.items, market);
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
    fetchNews();
    state.timer = setInterval(function () { if (!document.hidden) fetchNews(); }, REFRESH_MS);
    state.sessionTimer = setInterval(function () {
      if (!document.hidden && currentMarket() !== state.market) fetchNews();
    }, SESSION_CHECK_MS);
  }

  global.HomeEconomicNews = { init: init };
})(window);
