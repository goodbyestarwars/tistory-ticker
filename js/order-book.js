/**
 * 실시간 호가창(증권사 HTS 스타일) - 독립 Tistory Page(/page/order-book 예정,
 * <div id="order-book"> 임베드) 위젯. 2026-07-27 신설.
 *
 * 매도/매수 각 10단계 잔량 사다리는 VM(goodbyestar.cloud/order-book/{code}, 키움 REST
 * ka10004 주식호가요청)을 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만 허용) -
 * js/kospi-futures.js의 /futures와 동일 패턴. 현재가/등락률은 이미 검증된 기존 GAS 시세
 * 프록시(?codes=)를 그대로 재사용한다(호가 사다리와 별도 소스지만 같은 2초 주기로 갱신).
 *
 * 종목 검색은 watchlist.js/foreign-flow.js와 동일한 KRX_MAP 자동완성 패턴.
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var VM_ORDER_BOOK_URL = 'https://goodbyestar.cloud/order-book/';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var CONTAINER_SELECTOR = '#order-book';
  var POLL_MS = 2000;
  var MAX_SUGGESTIONS = 8;
  var FETCH_TIMEOUT_MS = 8000;

  var state = {
    code: null,
    name: null,
    timer: null
  };

  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙)
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    return '<img class="ob-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireSearch(container);
  }

  function buildShell() {
    return ''
      + '<div class="ob-search">'
      + '<div class="ob-input-wrap">'
      + '<input type="text" id="obInput" class="ob-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="obSuggest" class="ob-suggest"></div>'
      + '</div>'
      + '<button type="button" id="obGoBtn" class="ob-go-btn">조회</button>'
      + '</div>'
      + '<div id="obBoard" class="ob-board"><div class="ob-hint">종목을 검색해서 호가창을 확인해보세요.</div></div>';
  }

  // ---- 검색/자동완성 (watchlist.js와 동일 패턴) ----

  function wireSearch(container) {
    var input = container.querySelector('#obInput');
    var suggestBox = container.querySelector('#obSuggest');
    var goBtn = container.querySelector('#obGoBtn');

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions(suggestBox);
        selectByQuery(container, input.value.trim());
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    goBtn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      selectByQuery(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
  }

  function renderSuggestions(container, box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    var starts = [], contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) { if (starts.length < MAX_SUGGESTIONS) starts.push(name); }
      else if (lower.indexOf(q) > -1) { if (contains.length < MAX_SUGGESTIONS) contains.push(name); }
    }
    var matches = starts.concat(contains).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="ob-suggest-item" data-name="' + escapeAttr(name) + '">' + stockIconHtml(map[name]) + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.ob-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#obInput').value = name;
        hideSuggestions(box);
        selectByQuery(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만(watchlist.js와 동일 로직).
  function resolveStock(query) {
    if (!query) return null;
    var map = global.KRX_MAP || {};
    if (/^[0-9A-Z]{6}$/i.test(query)) {
      for (var nm in map) {
        if (map.hasOwnProperty(nm) && map[nm].toUpperCase() === query.toUpperCase()) {
          return { code: map[nm], name: nm };
        }
      }
      return null;
    }
    if (map.hasOwnProperty(query)) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var matches = [];
    for (var name in map) {
      if (map.hasOwnProperty(name) && name.toLowerCase().indexOf(q) > -1) matches.push(name);
    }
    if (matches.length === 1) return { code: map[matches[0]], name: matches[0] };
    return null;
  }

  function selectByQuery(container, query) {
    var stock = resolveStock(query);
    var board = container.querySelector('#obBoard');
    if (!stock) {
      board.innerHTML = '<div class="ob-hint ob-error">종목을 찾을 수 없습니다: "' + escapeHtml(query) + '"</div>';
      return;
    }
    selectStock(container, stock.code, stock.name);
  }

  // ---- 폴링 ----

  function selectStock(container, code, name) {
    state.code = code;
    state.name = name;
    if (state.timer) clearInterval(state.timer);

    var board = container.querySelector('#obBoard');
    board.innerHTML = '<div class="ob-hint"><div class="ob-spinner"></div>' + escapeHtml(name) + ' 호가 불러오는 중...</div>';

    tick(container);
    state.timer = setInterval(function () { tick(container); }, POLL_MS);
  }

  function tick(container) {
    var code = state.code;
    if (!code) return;
    Promise.all([OrderBook.fetchOrderBook(code), OrderBook.fetchQuote(code)])
      .then(function (results) {
        if (state.code !== code) return; // 응답 오는 사이 다른 종목을 골랐으면 무시(레이스 방지)
        renderBoard(container, results[0], results[1]);
      })
      .catch(function () {
        if (state.code !== code) return;
        var board = container.querySelector('#obBoard');
        if (board && !board.querySelector('.ob-table')) {
          board.innerHTML = '<div class="ob-hint ob-error">호가 데이터를 불러오지 못했어요. 다음 갱신에 자동으로 재시도합니다.</div>';
        }
      });
  }

  function fetchOrderBook(code) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(VM_ORDER_BOOK_URL + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('order-book API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchQuote(code) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?codes=' + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return (data && data[0]) || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ---- 렌더링 ----

  function renderBoard(container, book, quote) {
    var board = container.querySelector('#obBoard');
    if (!book || (!book.asks.length && !book.bids.length)) {
      board.innerHTML = '<div class="ob-hint">호가 정보가 없는 종목이거나 장 운영시간이 아니에요.</div>';
      return;
    }

    var maxQty = 0;
    book.asks.forEach(function (r) { if (r.qty > maxQty) maxQty = r.qty; });
    book.bids.forEach(function (r) { if (r.qty > maxQty) maxQty = r.qty; });
    if (!maxQty) maxQty = 1;

    var priceCls = quote ? signClass(quote.changeRate) : '';
    var priceNum = quote ? Number(quote.price).toLocaleString('ko-KR') + '원' : '-';
    var changeText = quote
      ? (quote.changeRate >= 0 ? '+' : '') + quote.changeRate.toFixed(2) + '% (' + (quote.change >= 0 ? '+' : '') + Number(quote.change).toLocaleString('ko-KR') + '원)'
      : '';

    var headerHtml = '<div class="ob-header">'
      + stockIconHtml(state.code)
      + '<span class="ob-header-name">' + escapeHtml(state.name) + '</span>'
      + '<span class="ob-header-code">(' + escapeHtml(state.code) + ')</span>'
      + '<span class="ob-header-price ' + priceCls + '">' + priceNum + '</span>'
      + (changeText ? '<span class="ob-header-change ' + priceCls + '">' + changeText + '</span>' : '')
      + '</div>';

    var askRows = book.asks.map(function (r) { return rowHtml(r, maxQty, 'ask'); }).join('');
    var bidRows = book.bids.map(function (r) { return rowHtml(r, maxQty, 'bid'); }).join('');

    var totalAsk = book.totalAskQty || 0;
    var totalBid = book.totalBidQty || 0;
    var totalSum = totalAsk + totalBid || 1;
    var askPct = (totalAsk / totalSum * 100).toFixed(1);
    var bidPct = (totalBid / totalSum * 100).toFixed(1);

    var footerHtml = '<div class="ob-footer">'
      + '<div class="ob-footer-label">총잔량 <span class="ob-ask-text">매도 ' + fmtQty(totalAsk) + '</span> · <span class="ob-bid-text">매수 ' + fmtQty(totalBid) + '</span></div>'
      + '<div class="ob-footer-bar"><span class="ob-footer-bar-ask" style="width:' + askPct + '%"></span><span class="ob-footer-bar-bid" style="width:' + bidPct + '%"></span></div>'
      + '</div>';

    board.innerHTML = headerHtml
      + '<div class="ob-table">' + askRows + '<div class="ob-current-row ' + priceCls + '">' + priceNum + (changeText ? ' <span class="ob-current-change">' + changeText + '</span>' : '') + '</div>' + bidRows + '</div>'
      + footerHtml;
  }

  function rowHtml(row, maxQty, side) {
    var pct = Math.max(2, Math.round(row.qty / maxQty * 100));
    var barCls = side === 'ask' ? 'ob-bar-ask' : 'ob-bar-bid';
    var textCls = side === 'ask' ? 'ob-ask-text' : 'ob-bid-text';
    return '<div class="ob-row ob-row-' + side + '">'
      + '<span class="ob-qty ' + textCls + '">' + fmtQty(row.qty) + '</span>'
      + '<span class="ob-bar-wrap"><span class="' + barCls + '" style="width:' + pct + '%"></span></span>'
      + '<span class="ob-price ' + textCls + '">' + Math.round(row.price).toLocaleString('ko-KR') + '</span>'
      + '</div>';
  }

  function fmtQty(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v).toLocaleString('ko-KR');
  }

  function signClass(rate) {
    if (rate > 0) return 'ob-up';
    if (rate < 0) return 'ob-down';
    return 'ob-flat';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  var OrderBook = { init: init, fetchOrderBook: fetchOrderBook, fetchQuote: fetchQuote };
  global.OrderBook = OrderBook;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
