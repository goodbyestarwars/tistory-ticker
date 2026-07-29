/**
 * 관심종목 카드 위젯 - "9Pay 증권" 개편 작업지시서 #11(MY 메뉴).
 * 로그인 없이 localStorage에 저장(코드+이름, 최대 50개, 순서 보존 배열).
 * 종목명 검색(KRX_MAP 자동완성, foreign-flow.js와 동일 패턴)으로 추가하고,
 * 기존 GAS 시세 프록시(?codes=)를 그대로 재사용해 카드에 현재가/등락률을 채운다.
 * 카드 클릭 시 네이버 금융 종목 페이지로 이동(ticker-tooltip-v5.js의 NAVER_ITEM_URL과 동일 목적지),
 * "차트 이동" 버튼은 우리 사이트 증시검색 페이지로 이동(js/stock-search.js).
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * data-code 속성을 순서대로 유지해두어 향후 Drag & Drop으로 순서 변경을 붙이기 쉽게 해둔다.
 *
 * 2026-07-27: add/has/remove를 공개 API로 노출 - js/stock-search.js의 검색 결과 ⭐
 * 버튼이 이 모듈의 localStorage를 직접 건드리지 않고 이 함수들을 통해서만 접근한다
 * (저장 형식이 바뀌어도 호출부는 안 바뀌게).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#watchlist';
  var STORAGE_KEY = 'wl_codes_v1';
  var MAX_ITEMS = 50;
  var MAX_SUGGESTIONS = 8;
  var FETCH_TIMEOUT_MS = 8000;
  var NAVER_ITEM_URL = 'https://finance.naver.com/item/main.naver?code=';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  // TODO: /page/stock-search는 실제 페이지 생성 전 placeholder(js/skin-menu.js와 동일 사유) -
  // 실제 URL이 정해지면 이 상수만 바꾸면 됨(watchlist.js 전체에서 이 한 곳만 참조).
  var STOCK_SEARCH_PAGE_URL = '/page/stock-search';
  var REALTIME_QUOTES_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var REALTIME_FALLBACK_MS = 30000;
  var REALTIME_RECONNECT_MS = 5000;
  var realtimeSocket = null;
  var realtimeReconnectTimer = null;
  var realtimeFallbackTimer = null;
  var realtimeKeepaliveTimer = null;
  var realtimeGeneration = 0;

  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙)
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    return '<img class="wl-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
    render(container);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopRealtimeQuotes();
      else render(container);
    });
  }

  function buildShell() {
    return ''
      + '<div class="wl-header">'
      + '<div class="wl-title">⭐ 관심종목 <span id="wlCount" class="wl-count"></span></div>'
      + '<div class="wl-add">'
      + '<div class="wl-input-wrap">'
      + '<input type="text" id="wlInput" class="wl-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="wlSuggest" class="wl-suggest"></div>'
      + '</div>'
      + '<button type="button" id="wlAddBtn" class="wl-add-btn">추가</button>'
      + '</div>'
      + '</div>'
      + '<div id="wlMsg" class="wl-msg" hidden></div>'
      + '<div id="wlGrid" class="wl-grid"></div>'
      + '<div id="wlEmpty" class="wl-empty" hidden>관심종목이 없습니다. 종목을 검색해서 추가해보세요.</div>';
  }

  // ---- localStorage ----

  function loadList() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function saveList(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (err) {
      // localStorage 불가 환경(프라이빗 모드 등) - 조용히 무시, 이번 세션 내 메모리에는 반영됨
    }
  }

  // ---- 검색/자동완성 (foreign-flow.js와 동일 패턴) ----

  function wireEvents(container) {
    var input = container.querySelector('#wlInput');
    var suggestBox = container.querySelector('#wlSuggest');
    var addBtn = container.querySelector('#wlAddBtn');

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions(suggestBox);
        addByQuery(container, input.value.trim());
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    addBtn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      addByQuery(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
  }

  // 2026-07-20: data/krx_map.js가 window.KRX_ETF_NAMES(ETF 이름 목록)도 같이 내려준다 -
  // Set으로 한 번만 변환해 자동완성 정렬에서 "이 이름이 ETF인지" O(1)로 판별한다.
  var etfNameSet = null;
  function isEtfName(name) {
    if (!etfNameSet) {
      etfNameSet = {};
      (global.KRX_ETF_NAMES || []).forEach(function (n) { etfNameSet[n] = true; });
    }
    return !!etfNameSet[name];
  }

  function renderSuggestions(container, box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    // ETF 병합 이후 검색어가 포함된 ETF가 진짜 종목보다 먼저 뜨는 문제가 있었음 - 시작/포함
    // 일치 2단계는 유지하고, 각 단계 안에서 일반 종목을 ETF보다 먼저 보여주도록 4단계로 세분화.
    var startsStock = [], startsEtf = [], containsStock = [], containsEtf = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      var etf = isEtfName(name);
      if (lower.indexOf(q) === 0) {
        if (etf) { if (startsEtf.length < MAX_SUGGESTIONS) startsEtf.push(name); }
        else if (startsStock.length < MAX_SUGGESTIONS) startsStock.push(name);
      } else if (lower.indexOf(q) > -1) {
        if (etf) { if (containsEtf.length < MAX_SUGGESTIONS) containsEtf.push(name); }
        else if (containsStock.length < MAX_SUGGESTIONS) containsStock.push(name);
      }
    }
    var matches = startsStock.concat(startsEtf, containsStock, containsEtf).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="wl-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.wl-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#wlInput').value = name;
        hideSuggestions(box);
        addByQuery(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만.
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

  // 코드/이름을 이미 아는 호출자(증시검색 ⭐ 버튼 등)를 위한 공개 API - 결과 코드로
  // 호출부가 버튼 상태(담김/실패 사유)를 갱신할 수 있게 한다. 위젯이 이 페이지에 없어도
  // (컨테이너 없이 localStorage만 조작) 동작해야 하므로 render(container) 호출은 컨테이너가
  // 있을 때만 한다.
  function addStock(code, name) {
    if (!code) return { ok: false, reason: 'invalid' };
    var list = loadList();
    if (list.some(function (it) { return it.code === code; })) return { ok: false, reason: 'exists' };
    if (list.length >= MAX_ITEMS) return { ok: false, reason: 'full' };

    list.push({ code: code, name: name || code });
    saveList(list);
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (container) render(container);
    return { ok: true };
  }

  function removeStock(code) {
    var list = loadList().filter(function (it) { return it.code !== code; });
    saveList(list);
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (container) render(container);
  }

  function hasStock(code) {
    return loadList().some(function (it) { return it.code === code; });
  }

  function addByQuery(container, query) {
    var stock = resolveStock(query);
    var input = container.querySelector('#wlInput');
    if (!stock) {
      showMsg(container, '종목을 찾을 수 없습니다: "' + query + '"');
      return;
    }

    var result = addStock(stock.code, stock.name);
    if (!result.ok) {
      if (result.reason === 'exists') showMsg(container, stock.name + '은(는) 이미 관심종목에 있습니다.');
      else if (result.reason === 'full') showMsg(container, '관심종목은 최대 ' + MAX_ITEMS + '개까지 담을 수 있습니다.');
      input.value = '';
      return;
    }

    input.value = '';
    hideMsg(container);
  }

  function removeCode(container, code) {
    removeStock(code); // container가 있으니 removeStock 내부에서 다시 렌더링됨
  }

  function showMsg(container, text) {
    var el = container.querySelector('#wlMsg');
    el.textContent = text;
    el.hidden = false;
  }
  function hideMsg(container) {
    var el = container.querySelector('#wlMsg');
    el.hidden = true;
  }

  // ---- 렌더링 ----

  function render(container) {
    var list = loadList();
    var grid = container.querySelector('#wlGrid');
    var empty = container.querySelector('#wlEmpty');
    var count = container.querySelector('#wlCount');

    count.textContent = '(' + list.length + '/' + MAX_ITEMS + ')';

    if (!list.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    grid.innerHTML = list.map(function (it) {
      return buildCard(it.code, it.name, null);
    }).join('');

    wireCardEvents(container);
    Watchlist.fetchQuotes(list.map(function (it) { return it.code; }))
      .then(function (quoteByCode) {
        list.forEach(function (it) {
          updateCard(container, it.code, quoteByCode[it.code] || null);
        });
      })
      .catch(function () {
        // 최초 시세 조회 실패 시에도 WebSocket 연결과 저빈도 폴백이 이어서 갱신한다.
      });
    startRealtimeQuotes(container, list.map(function (it) { return it.code; }));
  }

  function buildCard(code, name) {
    return ''
      + '<div class="wl-card" data-code="' + escapeAttr(code) + '">'
      + '<button type="button" class="wl-remove" data-code="' + escapeAttr(code) + '" aria-label="관심종목 삭제">★</button>'
      + '<div class="wl-name">' + stockIconHtml(code) + '<span class="wl-name-text">' + escapeHtml(name) + '</span></div>'
      + '<div class="wl-price" data-field="price">-</div>'
      + '<div class="wl-change" data-field="change">-</div>'
      + '<button type="button" class="wl-chart-btn" data-code="' + escapeAttr(code) + '" data-name="' + escapeAttr(name) + '">차트 보기 →</button>'
      + '</div>';
  }

  function updateCard(container, code, quote) {
    var card = container.querySelector('.wl-card[data-code="' + cssEscape(code) + '"]');
    if (!card) return;
    var priceEl = card.querySelector('[data-field="price"]');
    var changeEl = card.querySelector('[data-field="change"]');

    if (!quote) {
      priceEl.textContent = '조회 실패';
      changeEl.textContent = '';
      return;
    }

    priceEl.textContent = formatNumber(quote.price) + '원';
    changeEl.textContent = arrowSymbol(quote.change) + Math.abs(quote.changeRate).toFixed(2) + '%';
    changeEl.classList.remove('wl-up', 'wl-down', 'wl-flat');
    changeEl.classList.add(quote.change > 0 ? 'wl-up' : quote.change < 0 ? 'wl-down' : 'wl-flat');
  }

  // ---- 실시간 시세(WebSocket) ----

  function stopRealtimeQuotes() {
    realtimeGeneration += 1;
    clearTimeout(realtimeReconnectTimer);
    clearInterval(realtimeFallbackTimer);
    clearInterval(realtimeKeepaliveTimer);
    realtimeReconnectTimer = null;
    realtimeFallbackTimer = null;
    realtimeKeepaliveTimer = null;
    if (realtimeSocket) {
      realtimeSocket.onclose = null;
      realtimeSocket.close();
      realtimeSocket = null;
    }
  }

  function refreshQuotesOnce(container, codes) {
    Watchlist.fetchQuotes(codes)
      .then(function (quoteByCode) {
        codes.forEach(function (code) {
          updateCard(container, code, quoteByCode[code] || null);
        });
      })
      .catch(function () {});
  }

  function startRealtimeQuotes(container, codes) {
    stopRealtimeQuotes();
    if (!codes.length || document.hidden || !('WebSocket' in global)) return;

    var generation = realtimeGeneration;
    var encodedCodes = codes.map(encodeURIComponent).join(',');

    function connect() {
      if (generation !== realtimeGeneration || document.hidden) return;

      var socket = new WebSocket(REALTIME_QUOTES_URL + '?codes=' + encodedCodes);
      realtimeSocket = socket;

      socket.onmessage = function (event) {
        if (generation !== realtimeGeneration) return;
        try {
          var quote = JSON.parse(event.data);
          if (quote.type === 'quote' && quote.code) updateCard(container, quote.code, quote);
        } catch (err) {}
      };

      socket.onopen = function () {
        clearInterval(realtimeKeepaliveTimer);
        realtimeKeepaliveTimer = setInterval(function () {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, 20000);
      };

      socket.onerror = function () {
        socket.close();
      };

      socket.onclose = function () {
        clearInterval(realtimeKeepaliveTimer);
        realtimeKeepaliveTimer = null;
        if (generation !== realtimeGeneration || document.hidden) return;
        realtimeReconnectTimer = setTimeout(connect, REALTIME_RECONNECT_MS);
      };
    }

    // WebSocket 연결이 막히거나 장 종료로 체결 이벤트가 없을 때만 30초 묶음 조회로 보완한다.
    realtimeFallbackTimer = setInterval(function () {
      if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
        refreshQuotesOnce(container, codes);
      }
    }, REALTIME_FALLBACK_MS);

    connect();
  }

  function wireCardEvents(container) {
    container.querySelectorAll('.wl-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeCode(container, btn.getAttribute('data-code'));
      });
    });
    container.querySelectorAll('.wl-chart-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var code = btn.getAttribute('data-code');
        var name = btn.getAttribute('data-name');
        location.href = STOCK_SEARCH_PAGE_URL + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name);
      });
    });
    container.querySelectorAll('.wl-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var code = card.getAttribute('data-code');
        global.open(NAVER_ITEM_URL + encodeURIComponent(code), '_blank', 'noopener');
      });
    });
  }

  // ---- 시세 조회 (기존 티커 프록시 재사용, 신규 GAS 엔드포인트 불필요) ----

  function fetchQuotes(codes) {
    if (!codes.length) return Promise.resolve({});
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(GAS_TICKER_URL + '?codes=' + codes.join(','), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        var byCode = {};
        (data || []).forEach(function (q) { byCode[q.code] = q; });
        return byCode;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ---- 유틸 ----

  function arrowSymbol(change) {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '';
  }

  function formatNumber(n) {
    var num = Number(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString('ko-KR');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  var Watchlist = {
    init: init,
    fetchQuotes: fetchQuotes,
    add: addStock,
    remove: removeStock,
    has: hasStock,
    MAX_ITEMS: MAX_ITEMS
  };
  global.Watchlist = Watchlist;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
