/**
 * 홈 대시보드 위젯 관리자.
 *
 * 기존 화면이 만든 투자자 수급/시장판/랭킹/패턴/일정/브리핑 DOM을 위젯 레지스트리로
 * 승격하고, MY·실시간 공시 위젯을 추가한다. 홈은 이 모듈에서 순서와 표시 상태만 관리하며
 * 데이터 계산/API 엔드포인트는 기존 구현을 그대로 재사용한다.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'home_dashboard_layout_v1';
  var WATCHLIST_KEY = 'wl_codes_v1';
  var WATCHLIST_QUOTES_CACHE_KEY = 'home_watchlist_quotes_v1';
  var DISCLOSURE_CACHE_KEY = 'home_disclosures_v1';
  var DISC_GAS_URL = 'https://script.google.com/macros/s/AKfycbxGl0gCeiQs4QFV1FmPZP_xJQSiVRa1-Dg8Mv23VpevpE9j4xdL9MFxud34teslWzL0wg/exec';
  // 2026-07-31: 홈 MY 카드도 /page/watchlist(js/watchlist.js)와 동일한 VM 실시간 체결가
  // WebSocket 중계에 연결한다 - 페이지 로드 시 1회 GAS 조회 후 갱신이 없던 것을 보완.
  var REALTIME_QUOTES_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var REALTIME_RECONNECT_MS = 5000;
  var myRealtimeSocket = null;
  var myRealtimeReconnectTimer = null;
  var myRealtimeKeepaliveTimer = null;
  var myRealtimeGeneration = 0;
  var DEFAULT_ORDER = [
    'investor-flow',
    'market-summary',
    'ranking',
    'pattern',
    'schedule',
    'disclosure',
    'briefing'
  ];
  var LABELS = {
    'investor-flow': '투자자별 매매동향',
    'market-summary': '오늘의 시장판',
    ranking: '실시간 랭킹',
    pattern: '오늘의 패턴',
    schedule: '주요 일정',
    disclosure: '실시간 공시',
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

  function disclosureCardHtml() {
    return '<article class="card home-mini-card home-disclosure-card">'
      + '<div class="home-card-heading"><div><strong>실시간 공시</strong><span>최신 5건</span></div></div>'
      + '<div class="home-disclosure-list" id="homeDisclosureList"><p class="home-card-state">공시를 확인하는 중...</p></div>'
      + '<a class="home-card-more" href="/page/stock-news">전체보기 →</a>'
      + '</article>';
  }

  function buildToolbar() {
    var toolbar = document.createElement('div');
    toolbar.className = 'home-dashboard-toolbar';
    toolbar.innerHTML = '<span>카드의 ⋮⋮ 핸들을 드래그해 홈을 재배치할 수 있습니다.</span>'
      + '<div class="home-dashboard-settings">'
      + '<button type="button" class="home-settings-button" aria-expanded="false">홈 설정</button>'
      + '<div class="home-settings-panel" hidden>'
      + '<strong>숨긴 카드</strong><div class="home-hidden-widgets"></div>'
      + '<button type="button" class="home-reset-button">홈 화면 초기화</button>'
      + '</div></div>';
    settingsPanel = toolbar.querySelector('.home-settings-panel');
    return toolbar;
  }

  function buildRegistry(options) {
    var dashboard = options.dashboard;
    var overview = dashboard.querySelector('.home-overview-grid');
    var cards = dashboard.querySelector('.home-card-grid');
    var investor = overview && overview.querySelector('.home-investor-slot');
    var market = overview && overview.querySelector('.home-market-board');
    var ranking = cards && cards.querySelector('.home-rank-slot');
    var pattern = cards && cards.querySelector('.home-pattern-card');
    var schedule = cards && cards.querySelector('.home-schedule-card');
    if (!investor || !market || !ranking || !pattern || !schedule || !options.briefing) return false;

    var disclosure = document.createElement('div');
    disclosure.innerHTML = disclosureCardHtml();

    grid = document.createElement('div');
    grid.className = 'home-widget-grid';
    [
      investor,
      market,
      ranking,
      pattern,
      schedule,
      disclosure.firstElementChild,
      options.briefing
    ].forEach(function (node) { grid.appendChild(node); });

    dashboard.innerHTML = '';
    dashboard.appendChild(buildToolbar());
    dashboard.appendChild(grid);

    decorate(investor, 'investor-flow', 'wide');
    decorate(market, 'market-summary', 'summary');
    decorate(ranking, 'ranking', 'compact');
    decorate(pattern, 'pattern', 'compact');
    decorate(schedule, 'schedule', 'compact');
    decorate(grid.querySelector('.home-disclosure-card'), 'disclosure', 'compact');
    decorate(options.briefing, 'briefing', 'full');
    return true;
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

    var settingsButton = toolbar.querySelector('.home-settings-button');
    settingsButton.addEventListener('click', function () {
      var open = settingsPanel.hidden;
      settingsPanel.hidden = !open;
      settingsButton.setAttribute('aria-expanded', String(open));
      refreshSettings();
    });
    settingsPanel.addEventListener('click', function (event) {
      var restore = event.target.closest ? event.target.closest('[data-restore-widget]') : null;
      if (restore) {
        var id = restore.getAttribute('data-restore-widget');
        if (registry[id]) registry[id].hidden = false;
        saveState();
        refreshSettings();
        return;
      }
      if (!event.target.closest('.home-reset-button')) return;
      layoutStorage.set(JSON.stringify({ order: DEFAULT_ORDER, hidden: [] }));
      applyState({ order: DEFAULT_ORDER, hidden: [] });
      settingsPanel.hidden = true;
      settingsButton.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.home-widget-actions')) closeWidgetMenus();
      if (!event.target.closest('.home-dashboard-settings')) {
        settingsPanel.hidden = true;
        settingsButton.setAttribute('aria-expanded', 'false');
      }
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

  function renderMyRows(list, quotes) {
    var mount = document.getElementById('homeMyList');
    if (!mount) return;
    if (!list.length) {
      mount.innerHTML = '<p class="home-card-state">등록한 관심종목이 없습니다.</p>';
      return;
    }
    mount.innerHTML = list.map(function (item) {
      var quote = quotes && quotes[item.code];
      var change = quote ? Number(quote.change) : null;
      var rate = quote ? Number(quote.changeRate) : null;
      var tone = change > 0 ? 'home-positive' : change < 0 ? 'home-negative' : 'home-neutral';
      var arrow = change > 0 ? '▲' : change < 0 ? '▼' : '';
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
    var change = Number(quote.change);
    var rate = Number(quote.changeRate);
    var tone = change > 0 ? 'home-positive' : change < 0 ? 'home-negative' : 'home-neutral';
    var arrow = change > 0 ? '▲' : change < 0 ? '▼' : '';
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
    myRealtimeReconnectTimer = null;
    myRealtimeKeepaliveTimer = null;
    if (myRealtimeSocket) {
      myRealtimeSocket.onclose = null;
      myRealtimeSocket.close();
      myRealtimeSocket = null;
    }
  }

  function startMyRealtime(list) {
    stopMyRealtime();
    if (!list.length || document.hidden || !('WebSocket' in global)) return;

    var generation = myRealtimeGeneration;
    var encodedCodes = list.map(function (item) { return encodeURIComponent(item.code); }).join(',');

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

    connect();
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

  function cleanCdata(value) {
    var text = String(value || '');
    var start = text.indexOf('<![CDATA[');
    var end = text.lastIndexOf(']]>');
    return start > -1 && end > -1 ? text.slice(start + 9, end).trim() : text.trim();
  }

  function extractTag(chunk, tag) {
    var open = '<' + tag + '>';
    var close = '</' + tag + '>';
    var start = chunk.indexOf(open);
    var end = chunk.indexOf(close, start);
    return start === -1 || end === -1 ? '' : cleanCdata(chunk.slice(start + open.length, end));
  }

  function parseDisclosureTitle(title) {
    var close = title.charAt(0) === '[' ? title.indexOf(']') : -1;
    var rest = close > -1 ? title.slice(close + 1).trim() : title.trim();
    var space = rest.indexOf(' ');
    return {
      corp: space > -1 ? rest.slice(0, space).trim() : rest,
      title: space > -1 ? rest.slice(space + 1).trim() : ''
    };
  }

  function parseDisclosureXml(xml) {
    var result = [];
    var parts = String(xml || '').split('<item>');
    for (var i = 1; i < parts.length && result.length < 5; i++) {
      var chunk = parts[i].split('</item>')[0];
      var title = extractTag(chunk, 'title');
      if (!title) continue;
      var parsed = parseDisclosureTitle(title);
      result.push({
        corp: parsed.corp,
        title: parsed.title || title,
        link: extractTag(chunk, 'link') || '#'
      });
    }
    return result;
  }

  function decodeDisclosureResponse(text) {
    var value = String(text || '').trim().replace(/^﻿/, '');
    if (!value) return '';
    if (value.charAt(0) === '<') return value;
    var binary = atob(value.replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
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

  function renderDisclosures(items) {
    var mount = document.getElementById('homeDisclosureList');
    if (!mount) return;
    if (!items.length) {
      mount.innerHTML = '<p class="home-card-state">현재 확인된 공시가 없습니다.</p>';
      return;
    }
    mount.innerHTML = items.map(function (item) {
      return '<a class="home-disclosure-row" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener">'
        + '<strong>' + escapeHtml(item.corp || '시장 공시') + '</strong>'
        + '<span>' + escapeHtml(shortDisclosure(item.title)) + '</span></a>';
    }).join('');
  }

  function loadDisclosures() {
    var cached = readTimedCache(DISCLOSURE_CACHE_KEY, 6 * 60 * 60 * 1000);
    if (cached) renderDisclosures(cached.data);
    var controller = 'AbortController' in global ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
    fetch(DISC_GAS_URL + '?market=0', controller ? { signal: controller.signal } : {})
      .then(function (response) {
        if (!response.ok) throw new Error('공시 응답 오류');
        return response.text();
      })
      .then(function (text) {
        if (timer) clearTimeout(timer);
        var items = parseDisclosureXml(decodeDisclosureResponse(text));
        writeTimedCache(DISCLOSURE_CACHE_KEY, items);
        renderDisclosures(items);
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        if (!cached) renderDisclosures([]);
      });
  }

  function init(options) {
    if (!options || !options.dashboard || options.dashboard.getAttribute('data-widgets-ready') === '1') return;
    context = options;
    if (options.layoutStorage && typeof options.layoutStorage.get === 'function'
      && typeof options.layoutStorage.set === 'function') {
      layoutStorage = options.layoutStorage;
    }
    if (!buildRegistry(options)) return;
    options.dashboard.setAttribute('data-widgets-ready', '1');
    applyState(loadState());
    var toolbar = options.dashboard.querySelector('.home-dashboard-toolbar');
    wireMenus(toolbar);
    wireDrag();
    loadDisclosures();
  }

  global.HomeDashboardWidgets = { init: init, storageKey: STORAGE_KEY };
})(window);
