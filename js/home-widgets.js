/**
 * 홈 대시보드 위젯 관리자.
 *
 * 기존 화면이 만든 시장판/일정/브리핑 DOM을 위젯 레지스트리로 승격하고,
 * 실시간 공시 위젯을 추가한다. 홈은 이 모듈에서 순서와 표시 상태만 관리하며
 * 데이터 계산/API 엔드포인트는 기존 구현을 그대로 재사용한다.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'home_dashboard_layout_v2';
  var WATCHLIST_KEY = 'wl_codes_v1';
  var WATCHLIST_QUOTES_CACHE_KEY = 'home_watchlist_quotes_v1';
  var US_SCHEDULE_CACHE_KEY = 'home_us_schedule_v1';
  var WATCHLIST_DISCLOSURES_URL = 'https://goodbyestar.cloud/watchlist/disclosures';
  var GOOGLE_AUTH_START_URL = 'https://goodbyestar.cloud/auth/google/start';
  var EARNINGS_CALENDAR_URL = 'https://goodbyestar.cloud/earnings-calendar';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  // 2026-07-31: 홈 MY 카드도 /page/watchlist(js/watchlist.js)와 동일한 VM 실시간 체결가
  // WebSocket 중계에 연결한다 - 페이지 로드 시 1회 GAS 조회 후 갱신이 없던 것을 보완.
  var REALTIME_QUOTES_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var REALTIME_RECONNECT_MS = 5000;
  var REALTIME_FALLBACK_MS = 15000;
  var myRealtimeSocket = null;
  var myRealtimeReconnectTimer = null;
  var myRealtimeKeepaliveTimer = null;
  var myRealtimeFallbackTimer = null;
  var myRealtimeGeneration = 0;
  var disclosureMarket = null;
  var disclosureMarketTimer = null;
  var disclosureModal = null;
  var disclosureTickerTimer = null;
  var disclosureTickerItems = [];
  var disclosureTickerIndex = 0;
  var DEFAULT_ORDER = [
    'market-summary',
    'economic-news',
    'realtime-board',
    'briefing'
  ];
  var LABELS = {
    'economic-news': '경제 종합뉴스',
    'realtime-board': '실시간 종목판',
    'market-summary': '오늘의 시장판',
    briefing: '마켓브리핑'
  };

  var context = null;
  var grid = null;
  var settingsPanel = null;
  var registry = {};
  var draggingNode = null;
  var touchState = null;
  // 로그인 설정 저장소가 생기면 init({ layoutStorage: { get, set } })만 교체하면 된다.
  var layoutStorage = {
    get: function () { return safeStorageGet(STORAGE_KEY); },
    set: function (value) { safeStorageSet(STORAGE_KEY, value); }
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* 프라이빗 모드는 현재 세션 DOM만 유지 */ }
  }

  function readTimedCache(key, maxAgeMs) {
    try {
      var cached = JSON.parse(safeStorageGet(key) || 'null');
      if (!cached || !cached.data || Date.now() - Number(cached.savedAt) > maxAgeMs) return null;
      return cached;
    } catch (error) {
      return null;
    }
  }

  function writeTimedCache(key, data, extra) {
    var value = { savedAt: Date.now(), data: data };
    Object.keys(extra || {}).forEach(function (name) { value[name] = extra[name]; });
    safeStorageSet(key, JSON.stringify(value));
  }

  function loadState() {
    var parsed = {};
    try { parsed = JSON.parse(layoutStorage.get() || '{}') || {}; } catch (err) { parsed = {}; }
    var known = {};
    DEFAULT_ORDER.forEach(function (id) { known[id] = true; });
    var order = Array.isArray(parsed.order) ? parsed.order.filter(function (id) { return known[id]; }) : [];
    DEFAULT_ORDER.forEach(function (id) {
      if (order.indexOf(id) === -1) order.push(id);
    });
    var hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter(function (id) { return known[id]; }) : [];
    return { order: order, hidden: hidden };
  }

  function currentState() {
    return {
      order: Array.prototype.map.call(grid.querySelectorAll(':scope > .home-widget'), function (node) {
        return node.getAttribute('data-widget-id');
      }),
      hidden: Array.prototype.filter.call(grid.querySelectorAll(':scope > .home-widget'), function (node) {
        return node.hidden;
      }).map(function (node) {
        return node.getAttribute('data-widget-id');
      })
    };
  }

  function saveState() {
    layoutStorage.set(JSON.stringify(currentState()));
  }

  function actionHtml(id) {
    var label = LABELS[id];
    return '<div class="home-widget-actions">'
      + '<button type="button" class="home-widget-drag" draggable="true" aria-label="' + label + ' 카드 이동" title="드래그해서 이동">⋮⋮</button>'
      + '<button type="button" class="home-widget-menu-button" aria-label="' + label + ' 위젯 메뉴" aria-expanded="false">⋮</button>'
      + '<div class="home-widget-menu" hidden>'
      + '<button type="button" data-widget-action="top">맨 위로 이동</button>'
      + '<button type="button" data-widget-action="bottom">맨 아래로 이동</button>'
      + '<button type="button" data-widget-action="hide">숨기기</button>'
      + '</div></div>';
  }

  function decorate(node, id, size) {
    node.classList.add('home-widget', 'home-widget--' + size);
    node.setAttribute('data-widget-id', id);
    node.setAttribute('data-widget-label', LABELS[id]);
    node.insertAdjacentHTML('beforeend', actionHtml(id));
    registry[id] = node;
  }

  function myCardHtml() {
    return '<article class="card home-mini-card home-my-card">'
      + '<div class="home-card-heading"><div><strong>MY</strong><span>관심종목</span></div></div>'
      + '<div class="home-my-list" id="homeMyList"><p class="home-card-state">관심종목을 확인하는 중...</p></div>'
      + '<button type="button" class="home-card-more" data-open-global-watchlist>관심종목 열기 →</button>'
      + '</article>';
  }

  function buildToolbar() {
    return null;
  }

  function buildRegistry(options) {
    var dashboard = options.dashboard;
    var overview = dashboard.querySelector('.home-overview-grid');
    var market = overview && overview.querySelector('.home-market-board');
    var economic = overview && overview.querySelector('.home-economic-news');
    var realtime = dashboard.querySelector('.home-realtime-board');
    var marketSwitch = dashboard.querySelector('.home-market-switch');
    var closedPage = dashboard.querySelector('.home-closed-page');
    if (!market || !options.briefing) return false;

    grid = document.createElement('div');
    grid.className = 'home-widget-grid';
    [market, economic, realtime, options.briefing].forEach(function (node) {
      if (node) grid.appendChild(node);
    });

    dashboard.innerHTML = '';
    if (marketSwitch) dashboard.appendChild(marketSwitch);
    // 휴장 지면은 시장 위젯 그리드에 포함시키지 않는다. 그리드만 재구성하면
    // dashboard.innerHTML 초기화 때 이 섹션이 사라져 휴장 탭을 눌러도 화면이
    // 전환되지 않는 문제가 생긴다.
    if (closedPage) dashboard.appendChild(closedPage);
    dashboard.appendChild(grid);

    decorate(market, 'market-summary', 'summary');
    if (economic) decorate(economic, 'economic-news', 'summary');
    if (realtime) decorate(realtime, 'realtime-board', 'full');
    decorate(options.briefing, 'briefing', 'full');
    return true;
  }

  function syncEconomicHeight() {
    var market = registry['market-summary'];
    var economic = registry['economic-news'];
    if (!market || !economic) return;
    economic.style.height = '';
    // Editorial home sections keep their own natural height so a longer
    // disclosure list does not stretch the news column into an empty panel.
    if (market.closest('.home-editorial-page')) return;
    var marketRect = market.getBoundingClientRect();
    var economicRect = economic.getBoundingClientRect();
    // Browser zoom changes the CSS viewport width. Only equalize cards while
    // they are actually sharing the same grid row; stacked layouts stay fluid.
    if (Math.abs(marketRect.top - economicRect.top) > 2) return;
    economic.style.height = Math.ceil(marketRect.height) + 'px';
  }

  function applyState(state) {
    state.order.forEach(function (id) {
      if (registry[id]) grid.appendChild(registry[id]);
    });
    DEFAULT_ORDER.forEach(function (id) {
      if (registry[id]) registry[id].hidden = state.hidden.indexOf(id) !== -1;
    });
    refreshSettings();
  }

  function closeWidgetMenus(except) {
    grid.querySelectorAll('.home-widget-menu').forEach(function (menu) {
      if (menu === except) return;
      menu.hidden = true;
      var button = menu.parentNode.querySelector('.home-widget-menu-button');
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }

  function captureRects() {
    var rects = {};
    grid.querySelectorAll(':scope > .home-widget:not([hidden])').forEach(function (node) {
      var rect = node.getBoundingClientRect();
      rects[node.getAttribute('data-widget-id')] = { left: rect.left, top: rect.top };
    });
    return rects;
  }

  function animateFrom(rects) {
    grid.querySelectorAll(':scope > .home-widget:not([hidden])').forEach(function (node) {
      var id = node.getAttribute('data-widget-id');
      var before = rects[id];
      if (!before) return;
      var after = node.getBoundingClientRect();
      var x = before.left - after.left;
      var y = before.top - after.top;
      if (!x && !y) return;
      node.style.transition = 'none';
      node.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      requestAnimationFrame(function () {
        node.style.transition = 'transform .24s ease, box-shadow .2s ease, opacity .2s ease';
        node.style.transform = '';
        setTimeout(function () {
          node.style.transition = '';
          node.style.transform = '';
        }, 260);
      });
    });
  }

  function moveRelative(node, target, beforeTarget) {
    if (!node || !target || node === target) return;
    var rects = captureRects();
    grid.insertBefore(node, beforeTarget ? target : target.nextSibling);
    animateFrom(rects);
  }

  function moveToEdge(node, edge) {
    var rects = captureRects();
    if (edge === 'top') grid.insertBefore(node, grid.firstElementChild);
    else grid.appendChild(node);
    animateFrom(rects);
    saveState();
  }

  function refreshSettings() {
    if (!settingsPanel) return;
    var list = settingsPanel.querySelector('.home-hidden-widgets');
    var hidden = DEFAULT_ORDER.filter(function (id) { return registry[id] && registry[id].hidden; });
    list.innerHTML = hidden.length
      ? hidden.map(function (id) {
        return '<button type="button" data-restore-widget="' + id + '">' + LABELS[id] + ' 다시 표시</button>';
      }).join('')
      : '<span>숨긴 카드가 없습니다.</span>';
  }

  function hideWidget(node) {
    node.hidden = true;
    closeWidgetMenus();
    saveState();
    refreshSettings();
  }

  function wireMenus(toolbar) {
    grid.addEventListener('click', function (event) {
      var menuButton = event.target.closest ? event.target.closest('.home-widget-menu-button') : null;
      if (menuButton) {
        var menu = menuButton.parentNode.querySelector('.home-widget-menu');
        var open = menu.hidden;
        closeWidgetMenus(menu);
        menu.hidden = !open;
        menuButton.setAttribute('aria-expanded', String(open));
        return;
      }
      var action = event.target.closest ? event.target.closest('[data-widget-action]') : null;
      if (!action) return;
      var node = action.closest('.home-widget');
      var type = action.getAttribute('data-widget-action');
      if (type === 'hide') hideWidget(node);
      else moveToEdge(node, type);
      closeWidgetMenus();
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.home-widget-actions')) closeWidgetMenus();
    });
  }

  function targetFromPoint(x, y) {
    var element = document.elementFromPoint(x, y);
    return element && element.closest ? element.closest('.home-widget') : null;
  }

  function reorderAtPoint(node, target, x, y) {
    if (!target || target === node || target.parentNode !== grid) return;
    var rect = target.getBoundingClientRect();
    var sameRow = Math.abs(rect.top - node.getBoundingClientRect().top) < Math.min(rect.height, node.getBoundingClientRect().height) / 2;
    var before = sameRow ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2;
    moveRelative(node, target, before);
  }

  function wireDrag() {
    grid.querySelectorAll('.home-widget-drag').forEach(function (handle) {
      handle.addEventListener('dragstart', function (event) {
        draggingNode = handle.closest('.home-widget');
        draggingNode.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggingNode.getAttribute('data-widget-id'));
        closeWidgetMenus();
      });
      handle.addEventListener('dragend', function () {
        if (draggingNode) draggingNode.classList.remove('is-dragging');
        draggingNode = null;
        saveState();
      });
      handle.addEventListener('pointerdown', function (event) {
        if (typeof event.button === 'number' && event.button !== 0) return;
        var node = handle.closest('.home-widget');
        if (handle.setPointerCapture) {
          try { handle.setPointerCapture(event.pointerId); } catch (err) { /* 구형 브라우저는 캡처 없이 진행 */ }
        }
        touchState = {
          node: node,
          pointerId: event.pointerId,
          active: event.pointerType !== 'touch',
          timer: null
        };
        if (touchState.active) node.classList.add('is-dragging');
        else {
          touchState.timer = setTimeout(function () {
            if (!touchState || touchState.node !== node) return;
            touchState.active = true;
            node.classList.add('is-dragging', 'is-touch-dragging');
            if (navigator.vibrate) navigator.vibrate(20);
          }, 450);
        }
      });
      handle.addEventListener('pointermove', function (event) {
        if (!touchState || touchState.pointerId !== event.pointerId || !touchState.active) return;
        event.preventDefault();
        reorderAtPoint(touchState.node, targetFromPoint(event.clientX, event.clientY), event.clientX, event.clientY);
      }, { passive: false });
      function endTouch(event) {
        if (!touchState || touchState.pointerId !== event.pointerId) return;
        clearTimeout(touchState.timer);
        if (handle.releasePointerCapture) {
          try { handle.releasePointerCapture(event.pointerId); } catch (err) { /* 이미 해제된 경우 무시 */ }
        }
        touchState.node.classList.remove('is-dragging', 'is-touch-dragging');
        if (touchState.active) saveState();
        touchState = null;
      }
      handle.addEventListener('pointerup', endTouch);
      handle.addEventListener('pointercancel', endTouch);
    });

    grid.addEventListener('dragover', function (event) {
      if (!draggingNode) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      reorderAtPoint(draggingNode, targetFromPoint(event.clientX, event.clientY), event.clientX, event.clientY);
    });
    grid.addEventListener('drop', function (event) {
      if (!draggingNode) return;
      event.preventDefault();
      saveState();
    });
  }

  function readWatchlist() {
    if (global.Watchlist && typeof global.Watchlist.getList === 'function') {
      return global.Watchlist.getList();
    }
    return [];
    /* Legacy localStorage watchlists are no longer read. */
    //
    var list = [];
    try { list = JSON.parse(safeStorageGet(WATCHLIST_KEY) || '[]'); } catch (err) { list = []; }
    return Array.isArray(list) ? list.filter(function (item) {
      return item && item.code && item.name;
    }) : [];
    //
  }

  function formatPrice(value) {
    var number = Number(value);
    return isNaN(number) ? '-' : number.toLocaleString('ko-KR') + '원';
  }

  function quoteDirection(quote) {
    var rate = Number(quote && quote.changeRate);
    if (!isNaN(rate) && rate !== 0) return rate;
    var change = Number(quote && quote.change);
    return isNaN(change) ? 0 : change;
  }

  function renderMyRows(list, quotes) {
    var mount = document.getElementById('homeMyList');
    if (!mount) return;
    if (!list.length) {
      mount.innerHTML = '<p class="home-card-state">등록한 관심종목이 없습니다.</p>';
      return;
    }
    mount.innerHTML = list.map(function (item) {
      var quote = quotes && quotes[item.code];
      var rate = quote ? Number(quote.changeRate) : null;
      var direction = quote ? quoteDirection(quote) : 0;
      var tone = direction > 0 ? 'home-positive' : direction < 0 ? 'home-negative' : 'home-neutral';
      var arrow = direction > 0 ? '▲' : direction < 0 ? '▼' : '';
      var rateText = rate == null || isNaN(rate) ? '데이터 확인 중' : arrow + Math.abs(rate).toFixed(2) + '%';
      return '<a class="home-my-row" data-code="' + escapeHtml(item.code) + '" href="/page/stock-search?code=' + encodeURIComponent(item.code)
        + '&name=' + encodeURIComponent(item.name) + '">'
        + '<span class="home-my-name"><strong>' + escapeHtml(item.name) + '</strong></span>'
        + '<span class="home-my-quote"><small data-field="price">' + (quote ? formatPrice(quote.price) : '현재가 확인 중') + '</small>'
        + '<em class="' + tone + '" data-field="change">' + rateText + '</em></span></a>';
    }).join('');
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  // WebSocket 틱마다 목록 전체를 다시 그리지 않고 해당 종목 행의 가격/등락률 텍스트만 갱신한다.
  function updateMyRow(code, quote) {
    var mount = document.getElementById('homeMyList');
    if (!mount) return;
    var row = mount.querySelector('.home-my-row[data-code="' + cssEscape(code) + '"]');
    if (!row) return;
    var rate = Number(quote.changeRate);
    var direction = quoteDirection(quote);
    var tone = direction > 0 ? 'home-positive' : direction < 0 ? 'home-negative' : 'home-neutral';
    var arrow = direction > 0 ? '▲' : direction < 0 ? '▼' : '';
    var rateText = isNaN(rate) ? '데이터 확인 중' : arrow + Math.abs(rate).toFixed(2) + '%';
    var priceEl = row.querySelector('[data-field="price"]');
    var changeEl = row.querySelector('[data-field="change"]');
    if (priceEl) priceEl.textContent = formatPrice(quote.price);
    if (changeEl) { changeEl.textContent = rateText; changeEl.className = tone; }
  }

  // ---- 실시간 체결가(WebSocket, js/watchlist.js와 동일 패턴) ----

  function stopMyRealtime() {
    myRealtimeGeneration += 1;
    clearTimeout(myRealtimeReconnectTimer);
    clearInterval(myRealtimeKeepaliveTimer);
    clearInterval(myRealtimeFallbackTimer);
    myRealtimeReconnectTimer = null;
    myRealtimeKeepaliveTimer = null;
    myRealtimeFallbackTimer = null;
    if (myRealtimeSocket) {
      myRealtimeSocket.onclose = null;
      myRealtimeSocket.close();
      myRealtimeSocket = null;
    }
  }

  function startMyRealtime(list) {
    stopMyRealtime();
    if (!list.length || document.hidden) return;

    var generation = myRealtimeGeneration;
    var encodedCodes = list.map(function (item) { return encodeURIComponent(item.code); }).join(',');

    // NXT 장 전환 때 upstream websocket이 잠시 조용하거나 중계가 재접속 중이어도
    // 현재가를 계속 갱신한다. 목록 전체를 다시 그리지 않고 값이 있는 행만 수정한다.
    myRealtimeFallbackTimer = setInterval(function () {
      if (generation !== myRealtimeGeneration || document.hidden || !context || !context.fetchJson) return;
      context.fetchJson(context.gasUrl + '?codes=' + list.map(function (item) {
        return encodeURIComponent(item.code);
      }).join(','), 10000).then(function (data) {
        if (generation !== myRealtimeGeneration) return;
        (Array.isArray(data) ? data : []).forEach(function (quote) {
          if (quote && quote.code) updateMyRow(quote.code, quote);
        });
      }).catch(function () {});
    }, REALTIME_FALLBACK_MS);

    function connect() {
      if (generation !== myRealtimeGeneration || document.hidden) return;

      var socket = new WebSocket(REALTIME_QUOTES_URL + '?codes=' + encodedCodes);
      myRealtimeSocket = socket;

      socket.onmessage = function (event) {
        if (generation !== myRealtimeGeneration) return;
        try {
          var quote = JSON.parse(event.data);
          if (quote.type === 'quote' && quote.code) updateMyRow(quote.code, quote);
        } catch (err) {}
      };

      socket.onopen = function () {
        clearInterval(myRealtimeKeepaliveTimer);
        myRealtimeKeepaliveTimer = setInterval(function () {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, 20000);
      };

      socket.onerror = function () {
        socket.close();
      };

      socket.onclose = function () {
        clearInterval(myRealtimeKeepaliveTimer);
        myRealtimeKeepaliveTimer = null;
        if (generation !== myRealtimeGeneration || document.hidden) return;
        myRealtimeReconnectTimer = setTimeout(connect, REALTIME_RECONNECT_MS);
      };
    }

    if ('WebSocket' in global) connect();
  }

  function loadMyWidget() {
    var list = readWatchlist();
    var codeKey = list.map(function (item) { return item.code; }).join(',');
    var cached = readTimedCache(WATCHLIST_QUOTES_CACHE_KEY, 3 * 60 * 1000);
    var cachedQuotes = cached && cached.codes === codeKey ? cached.data : null;
    renderMyRows(list, cachedQuotes);
    if (!list.length) { stopMyRealtime(); return; }
    startMyRealtime(list);
    if (!context.fetchJson) return;
    context.fetchJson(context.gasUrl + '?codes=' + list.map(function (item) {
      return encodeURIComponent(item.code);
    }).join(','), 10000).then(function (data) {
      var byCode = {};
      (Array.isArray(data) ? data : []).forEach(function (quote) {
        if (quote && quote.code) byCode[quote.code] = quote;
      });
      writeTimedCache(WATCHLIST_QUOTES_CACHE_KEY, byCode, { codes: codeKey });
      renderMyRows(list, byCode);
    }).catch(function () {
      if (!cachedQuotes) renderMyRows(list, null);
    });
  }

  function shortDisclosure(title) {
    var rules = [
      { terms: ['잠정실적', '영업(잠정)실적'], label: '잠정실적' },
      { terms: ['자기주식', '자사주'], label: '자사주' },
      { terms: ['단일판매', '공급계약'], label: '공급계약' },
      { terms: ['유상증자'], label: '유상증자' },
      { terms: ['무상증자'], label: '무상증자' },
      { terms: ['배당'], label: '배당' }
    ];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].terms.some(function (term) { return title.indexOf(term) !== -1; })) return rules[i].label;
    }
    return title.length > 28 ? title.slice(0, 28) + '…' : title;
  }

  function disclosureTime(value) {
    var raw = String(value || '').trim();
    if (/^\d{8}$/.test(raw)) return raw.slice(4, 6) + '.' + raw.slice(6, 8);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(5, 7) + '.' + raw.slice(8, 10);
    var date = new Date(raw);
    if (isNaN(date.getTime())) return '';
    var parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true
    }).formatToParts(date).reduce(function (map, part) {
      map[part.type] = part.value;
      return map;
    }, {});
    var dateText = parts.month + '.' + parts.day;
    return parts.hour === '00' && parts.minute === '00'
      ? dateText
      : dateText + ' ' + parts.dayPeriod + ' ' + parts.hour + ':' + parts.minute;
  }

  function disclosureHref(item) {
    return String(item && item.link || '#');
  }

  function closeDisclosureModal() {
    if (!disclosureModal) return;
    disclosureModal.hidden = true;
    var frame = disclosureModal.querySelector('[data-disclosure-frame]');
    if (frame) frame.src = 'about:blank';
    document.body.classList.remove('home-disclosure-modal-open');
  }

  function openDisclosureModal(item) {
    var href = disclosureHref(item);
    if (!/^https:\/\//i.test(href)) return;
    if (!disclosureModal) {
      document.body.insertAdjacentHTML('beforeend', '<div class="home-disclosure-modal" data-disclosure-modal-root hidden>'
        + '<div class="home-disclosure-modal-backdrop" data-disclosure-close></div>'
        + '<section class="home-disclosure-modal-panel" role="dialog" aria-modal="true" aria-labelledby="homeDisclosureModalTitle">'
        + '<header class="home-disclosure-modal-head"><div><strong id="homeDisclosureModalTitle">DART 원문</strong><small data-disclosure-modal-meta></small></div>'
        + '<button type="button" class="home-disclosure-modal-close" data-disclosure-close aria-label="공시 원문 닫기">×</button></header>'
        + '<iframe data-disclosure-frame title="DART 공시 원문" referrerpolicy="no-referrer"></iframe>'
        + '<footer class="home-disclosure-modal-foot"><a data-disclosure-modal-link target="_blank" rel="noopener">원문을 새 창에서 열기 ↗</a></footer>'
        + '</section></div>');
      disclosureModal = document.querySelector('[data-disclosure-modal-root]');
      disclosureModal.querySelectorAll('[data-disclosure-close]').forEach(function (element) {
        element.addEventListener('click', closeDisclosureModal);
      });
    }
    var title = String(item && (item.stockName || item.corp || '') || '').trim();
    var meta = disclosureModal.querySelector('[data-disclosure-modal-meta]');
    var frame = disclosureModal.querySelector('[data-disclosure-frame]');
    var link = disclosureModal.querySelector('[data-disclosure-modal-link]');
    if (meta) meta.textContent = title ? title + ' · 최근 공시' : '최근 공시';
    if (link) link.href = href;
    if (frame) frame.src = href;
    disclosureModal.hidden = false;
    document.body.classList.add('home-disclosure-modal-open');
    var closeButton = disclosureModal.querySelector('.home-disclosure-modal-close');
    if (closeButton) closeButton.focus();
  }

  function wireDisclosureModal() {
    if (document.documentElement.getAttribute('data-disclosure-modal-wired') === '1') return;
    document.documentElement.setAttribute('data-disclosure-modal-wired', '1');
    document.addEventListener('click', function (event) {
      var row = event.target.closest ? event.target.closest('[data-disclosure-modal]') : null;
      if (!row) return;
      var href = row.getAttribute('href') || '';
      if (!/^https:\/\//i.test(href)) return;
      event.preventDefault();
      openDisclosureModal({
        link: href,
        stockName: row.getAttribute('data-disclosure-stock') || '',
        corp: row.getAttribute('data-disclosure-stock') || ''
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDisclosureModal();
    });

  }

  function setDisclosureVisible(visible) {
    var section = document.querySelector('[data-home-disclosure-section]');
    if (section) section.hidden = !visible;
  }

  function stopDisclosureTicker() {
    if (disclosureTickerTimer) clearInterval(disclosureTickerTimer);
    disclosureTickerTimer = null;
    disclosureTickerItems = [];
    disclosureTickerIndex = 0;
  }

  function startDisclosureTicker(items, renderItem) {
    stopDisclosureTicker();
    disclosureTickerItems = (items || []).slice();
    if (!disclosureTickerItems.length) return;
    setDisclosureVisible(true);
    renderItem(disclosureTickerItems[0]);
    if (disclosureTickerItems.length < 2) return;
    disclosureTickerTimer = setInterval(function () {
      if (document.hidden) return;
      disclosureTickerIndex = (disclosureTickerIndex + 1) % disclosureTickerItems.length;
      renderItem(disclosureTickerItems[disclosureTickerIndex]);
    }, 5000);
  }

  function renderDomesticDisclosureRow(item) {
    var time = disclosureTime(item.pubDate);
    var code = String(item && (item.stockCode || item.code) || '').trim();
    var internal = /^\d{6}$/.test(code);
    return '<a class="home-disclosure-row" href="' + escapeHtml(disclosureHref(item)) + '"'
      + ' data-disclosure-modal="1" data-disclosure-stock="' + escapeHtml(item.stockName || item.corp || '') + '"'
      + ' title="DART 원문 보기" draggable="false">'
      + '<strong>' + escapeHtml(item.stockName || item.corp || '관심종목 공시') + '</strong>'
      + '<span>' + escapeHtml(shortDisclosure(item.title)) + '</span>'
      + (time ? '<time>' + escapeHtml(time) + '</time>' : '') + '</a>';
  }

  function renderDisclosures(items, emptyMessage) {
    var mount = document.getElementById('homeDisclosureList');
    if (!mount) return;
    if (!items.length) {
      stopDisclosureTicker();
      setDisclosureVisible(false);
      mount.innerHTML = '<p class="home-card-state">' + escapeHtml(emptyMessage || '최근 한 주 관심종목 공시가 없습니다.') + '</p>';
      return;
    }
    setDisclosureVisible(true);
    mount.classList.add('home-scoreboard-list');
    startDisclosureTicker(items, function (item) {
      mount.innerHTML = renderDomesticDisclosureRow(item);
      mount.classList.remove('is-flipping');
      void mount.offsetWidth;
      mount.classList.add('is-flipping');
    });
  }

  function renderDisclosureLogin() {
    var mount = document.getElementById('homeDisclosureList');
    if (!mount) return;
    stopDisclosureTicker();
    setDisclosureVisible(false);
    mount.innerHTML = '';
  }

  function currentDisclosureMarket() {
    if (global.HomeMarketSelection && typeof global.HomeMarketSelection.get === 'function') {
      return global.HomeMarketSelection.get();
    }
    var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var hour = kst.getUTCHours();
    return hour >= 20 || hour < 8 ? 'us' : 'domestic';
  }

  function setDisclosureHeader(market, meta) {
    var title = document.querySelector('[data-home-disclosure-field="title"]');
    var label = document.querySelector('[data-home-disclosure-field="meta"]');
    var section = document.querySelector('[data-home-disclosure-section]');
    if (title) title.textContent = market === 'us' ? '주요일정' : '관심종목 주간 공시';
    if (label) label.textContent = meta != null ? meta : (market === 'us' ? '관심종목 일정' : '최근 7일');
    if (section) section.setAttribute('aria-label', market === 'us' ? '관심종목 주요일정' : '관심종목 주간 공시');
  }

  function scheduleDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return new Date(NaN);
    return new Date(raw.indexOf('T') === -1 ? raw.slice(0, 10) + 'T00:00:00+09:00' : raw);
  }

  function isUsScheduleEvent(event) {
    var market = String(event && event.market || '').toLowerCase();
    if (market === 'us' || market === 'usa' || market === 'foreign') return true;
    if (market === 'domestic' || market === 'kr' || market === 'korea') return false;
    var source = String(event && (event.source || event.provider || '') || '');
    var title = String(event && event.title || '');
    return /finnhub|미국|nasdaq|nyse|s\u0026p/i.test(source + ' ' + title)
      || /^\$[A-Za-z]/.test(title);
  }

  function scheduleTitle(value) {
    var title = String(value || '').split('|')[0].trim();
    title = title.replace(/^\$([A-Za-z][A-Za-z0-9.-]*)\s*/, '$1 ');
    return title || '미국 실적 일정';
  }

  function isFinnhubLink(link) {
    return /(?:^|:\/\/)(?:www\.)?finnhub\.io(?:\/|$)/i.test(String(link || ''));
  }

  function scheduleSymbol(item) {
    var explicit = String(item && (item.symbol || item.ticker || item.code) || '')
      .replace(/^US:/i, '').trim().toUpperCase();
    var match = String(item && item.title || '').match(/^\$([A-Za-z][A-Za-z0-9.-]*)\b/);
    return explicit || (match && match[1] ? match[1].toUpperCase() : '');
  }

  function scheduleWatchlistItems() {
    var list = readWatchlist();
    if (list.length) return list;
    try {
      var local = JSON.parse(safeStorageGet(WATCHLIST_KEY) || '[]');
      return Array.isArray(local) ? local : [];
    } catch (error) {
      return [];
    }
  }

  function isWatchlistScheduleEvent(event) {
    var list = scheduleWatchlistItems();
    if (!list.length) return false;
    var symbol = scheduleSymbol(event);
    var title = String(event && event.title || '').toLowerCase();
    return list.some(function (stock) {
      var code = String(stock && (stock.code || stock.stockCode || stock.symbol) || '')
        .replace(/^US:/i, '').trim().toUpperCase();
      var name = String(stock && (stock.name || stock.stockName) || '').trim().toLowerCase();
      return (symbol && code && symbol === code) || (name && title.indexOf(name) !== -1);
    });
  }

  function scheduleIconFallback(image) {
    if (image.getAttribute('data-icon-fallback') !== '1') {
      image.setAttribute('data-icon-fallback', '1');
      image.src = image.src.replace(/\.svg(\?.*)?$/, '.png');
      return;
    }
    image.style.display = 'none';
    var fallback = image.parentNode && image.parentNode.querySelector('[data-icon-initials]');
    if (fallback) fallback.hidden = false;
  }

  function scheduleIconHtml(item) {
    var symbol = scheduleSymbol(item);
    if (!symbol) return '';
    return '<span class="home-us-schedule-icon"><img src="' + STOCK_ICON_BASE + encodeURIComponent(symbol) + '.svg" alt="" loading="lazy" onerror="window.HomeUsScheduleIconFallback(this)">' +
      '<span data-icon-initials hidden>' + escapeHtml(symbol.slice(0, 2)) + '</span></span>';
  }

  function selectUsSchedule(events) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    var upcoming = (events || []).filter(function (event) {
      var date = scheduleDate(event && event.start);
      return isUsScheduleEvent(event) && isWatchlistScheduleEvent(event)
        && !isNaN(date.getTime()) && date >= today;
    }).sort(function (a, b) {
      var dateOrder = scheduleDate(a.start) - scheduleDate(b.start);
      return dateOrder || String(a.title || '').localeCompare(String(b.title || ''));
    });
    var todayItems = upcoming.filter(function (event) { return scheduleDate(event.start) < tomorrow; });
    if (todayItems.length) return { items: todayItems, today: true };
    if (!upcoming.length) return { items: [], today: false };
    var firstDate = scheduleDate(upcoming[0].start).toDateString();
    return {
      items: upcoming.filter(function (event) { return scheduleDate(event.start).toDateString() === firstDate; }),
      today: false
    };
  }

  function scheduleTime(value) {
    var date = scheduleDate(value);
    if (isNaN(date.getTime())) return '';
    var allDay = String(value || '').indexOf('T') === -1;
    var parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true
    }).formatToParts(date).reduce(function (map, part) {
      map[part.type] = part.value;
      return map;
    }, {});
    if (allDay) return parts.month + '.' + parts.day;
    return parts.month + '.' + parts.day + ' ' + parts.dayPeriod + ' ' + parts.hour + ':' + parts.minute;
  }

  function renderUsSchedule(selection) {
    var mount = document.getElementById('homeDisclosureList');
    if (!mount) return;
    setDisclosureHeader('us', '');
    if (!selection.items.length) {
      stopDisclosureTicker();
      setDisclosureVisible(false);
      mount.innerHTML = '<p class="home-card-state">미국 예정 일정이 없습니다.</p>';
      return;
    }
    setDisclosureVisible(true);
    mount.classList.add('home-scoreboard-list');
    function renderItem(item) {
      var link = isFinnhubLink(item.link) ? '' : String(item.link || '').trim();
      var rowStart = link
        ? '<a class="home-disclosure-row home-us-schedule-row" href="' + escapeHtml(link) + '" target="_blank" rel="noopener" draggable="false">'
        : '<div class="home-disclosure-row home-us-schedule-row home-us-schedule-row-disabled" aria-disabled="true" data-external-link-blocked="finnhub">';
      var rowEnd = link ? '</a>' : '</div>';
      return rowStart
        + '<strong>미국</strong>'
        + '<span class="home-us-schedule-title">' + scheduleIconHtml(item) + '<span>' + escapeHtml(scheduleTitle(item.title)) + '</span></span>'
        + '<time>' + escapeHtml(scheduleTime(item.start)) + '</time>' + rowEnd;
    }
    startDisclosureTicker(selection.items, function (item) {
      mount.innerHTML = renderItem(item);
      mount.classList.remove('is-flipping');
      void mount.offsetWidth;
      mount.classList.add('is-flipping');
    });
  }

  function enableScheduleDrag(list) {
    if (!list || list.getAttribute('data-drag-ready') === '1') return;
    list.setAttribute('data-drag-ready', '1');
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startScroll = 0;
    var suppressClick = false;

    list.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = list.scrollLeft;
      list.classList.add('is-dragging');
      if (list.setPointerCapture) list.setPointerCapture(event.pointerId);
    });
    // Prevent the browser's native link-drag gesture from taking over the
    // horizontal scroll gesture on schedule anchors.
    list.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });
    list.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var delta = event.clientX - startX;
      if (Math.abs(delta) > 4) moved = true;
      if (!moved) return;
      event.preventDefault();
      list.scrollLeft = startScroll - delta;
    }, { passive: false });
    function finishDrag(event) {
      if (!dragging) return;
      dragging = false;
      list.classList.remove('is-dragging');
      if (moved) suppressClick = true;
      if (event && list.releasePointerCapture) {
        try { list.releasePointerCapture(event.pointerId); } catch (error) {}
      }
    }
    list.addEventListener('pointerup', finishDrag);
    list.addEventListener('pointercancel', finishDrag);
    // 일부 모바일 WebView에서는 Pointer Events가 스크롤 컨테이너에서
    // 안정적으로 전달되지 않으므로 Touch Events도 함께 지원한다.
    list.addEventListener('touchstart', function (event) {
      if (!event.touches || !event.touches.length) return;
      var touch = event.touches[0];
      dragging = true;
      moved = false;
      startX = touch.clientX;
      startScroll = list.scrollLeft;
      list.classList.add('is-dragging');
    }, { passive: true });
    list.addEventListener('touchmove', function (event) {
      if (!dragging || !event.touches || !event.touches.length) return;
      var delta = event.touches[0].clientX - startX;
      if (Math.abs(delta) > 4) moved = true;
      if (!moved) return;
      event.preventDefault();
      list.scrollLeft = startScroll - delta;
    }, { passive: false });
    function finishTouch(event) {
      if (!dragging) return;
      finishDrag({ pointerId: null });
      if (event && moved) suppressClick = true;
    }
    list.addEventListener('touchend', finishTouch, { passive: true });
    list.addEventListener('touchcancel', finishTouch, { passive: true });
    list.addEventListener('click', function (event) {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }, true);
  }

  function loadUsSchedule() {
    var cached = readTimedCache(US_SCHEDULE_CACHE_KEY, 10 * 60 * 1000);
    if (cached) renderUsSchedule(selectUsSchedule(cached.data));
    var now = new Date();
    var nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var months = [
      { year: now.getFullYear(), month: now.getMonth() + 1 },
      { year: nextMonth.getFullYear(), month: nextMonth.getMonth() + 1 }
    ];
    Promise.all(months.map(function (period) {
      return fetch(EARNINGS_CALENDAR_URL + '?year=' + period.year + '&month=' + period.month)
        .then(function (response) { if (!response.ok) throw new Error('미국 일정 응답 오류'); return response.json(); })
        .then(function (payload) { return Array.isArray(payload) ? payload : (payload && payload.data) || []; })
        .catch(function () { return []; });
    })).then(function (groups) {
      var merged = [];
      groups.forEach(function (group) { merged = merged.concat(group); });
      writeTimedCache(US_SCHEDULE_CACHE_KEY, merged);
      renderUsSchedule(selectUsSchedule(merged));
    }).catch(function () {
      if (!cached) renderUsSchedule({ items: [], today: false });
    });
  }

  function loadDomesticDisclosures() {
    setDisclosureHeader('domestic', '최근 7일');
    var controller = 'AbortController' in global ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
    var requestOptions = { credentials: 'include', cache: 'no-store' };
    if (controller) requestOptions.signal = controller.signal;
    fetch(WATCHLIST_DISCLOSURES_URL, requestOptions)
      .then(function (response) {
        if (response.status === 401) {
          var loginError = new Error('Google login required');
          loginError.loginRequired = true;
          throw loginError;
        }
        if (!response.ok) throw new Error('공시 응답 오류');
        return response.json();
      })
      .then(function (payload) {
        if (timer) clearTimeout(timer);
        var data = payload && payload.data ? payload.data : {};
        var items = Array.isArray(data.items) ? data.items : [];
        var watchlistCount = Number(data.watchlistCount || 0);
        setDisclosureHeader('domestic', '최근 7일 · ' + items.length + '건');
        renderDisclosures(items, watchlistCount
          ? '최근 한 주 관심종목 공시가 없습니다.'
          : '국내 관심종목을 등록하면 최근 한 주 공시가 표시됩니다.');
      })
      .catch(function (error) {
        if (timer) clearTimeout(timer);
        if (error && error.loginRequired) {
          setDisclosureHeader('domestic', 'Google 로그인 필요');
          renderDisclosureLogin();
          return;
        }
        renderDisclosures([], '관심종목 공시를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.');
      });
  }

  function loadDisclosures() {
    var market = currentDisclosureMarket();
    if (disclosureMarket === market) return;
    disclosureMarket = market;
    if (market === 'us') loadUsSchedule();
    else loadDomesticDisclosures();
    if (!disclosureMarketTimer) {
      disclosureMarketTimer = setInterval(function () {
        if (!document.hidden && currentDisclosureMarket() !== disclosureMarket) loadDisclosures();
      }, 60 * 1000);
    }
  }

  function init(options) {
    if (!options || !options.dashboard || options.dashboard.getAttribute('data-widgets-ready') === '1') return;
    context = options;
    if (options.layoutStorage && typeof options.layoutStorage.get === 'function'
      && typeof options.layoutStorage.set === 'function') {
      layoutStorage = options.layoutStorage;
    }
    wireDisclosureModal();
    if (!buildRegistry(options)) return;
    options.dashboard.setAttribute('data-widgets-ready', '1');
    global.addEventListener('home-market-change', function () {
      loadDisclosures();
    });
    applyState(loadState());
    syncEconomicHeight();
    if (typeof ResizeObserver === 'function' && registry['market-summary']) {
      var observer = new ResizeObserver(syncEconomicHeight);
      observer.observe(registry['market-summary']);
    }
    window.addEventListener('resize', syncEconomicHeight);
    wireMenus(null);
    wireDrag();
    loadDisclosures();
  }

  global.HomeDashboardWidgets = { init: init, storageKey: STORAGE_KEY };
  global.HomeUsScheduleIconFallback = scheduleIconFallback;
})(window);
