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
  var state = { container: null, symbol: null, refreshTimer: null, initialized: false };

  function init() {
    var container = document.querySelector('#stock-search');
    if (!container) return;
    if (state.initialized && state.container === container) return;
    state.container = container;
    state.initialized = true;
    injectStyles();
    document.title = document.title.replace(/증시검색|실시간 시세/g, '미국주식');
    document.querySelectorAll('.post-single-title').forEach(function (title) {
      if (/증시검색|실시간 시세/.test(title.textContent.trim())) title.textContent = '미국주식';
    });
    container.innerHTML = buildShell();
    wireSearch();
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
      + '<span class="us-stocks-note">검색 · 실시간 시세</span></div>'
      + '<div class="us-stocks-search">'
      + '<div class="us-stocks-input-wrap"><input id="usStocksInput" type="search" autocomplete="off" placeholder="애플, AAPL, MSFT, NVDA 검색" aria-label="미국주식 검색" />'
      + '<div id="usStocksSuggest" class="us-stocks-suggest"></div></div>'
      + '<button id="usStocksSearchBtn" type="button">검색</button></div>'
      + '<div id="usStocksResults" class="us-stocks-results"><div class="us-stocks-empty">미국 종목명이나 티커를 검색해보세요.</div></div>'
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
    if (!/^US:/i.test(code)) return;
    var symbol = code.slice(3).toUpperCase();
    var input = document.querySelector('#usStocksInput');
    if (input) input.value = params.get('name') || symbol;
    select(symbol);
  }

  function searchSuggestions(query) {
    if (!query) { hideSuggestions(); return; }
    fetchJson(API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=6')
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
    fetchJson(API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=8')
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

  function select(symbol) {
    stopRefresh();
    state.symbol = String(symbol || '').toUpperCase().replace(/^US:/, '');
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
      .then(renderQuote)
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
      + '</div>';
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

  global.UsStocks = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
