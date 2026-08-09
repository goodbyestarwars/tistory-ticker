/**
 * 관심종목 카드 위젯 - "9Pay 증권" 개편 작업지시서 #11(MY 메뉴).
 * 로그인 없이 localStorage에 저장(코드+이름, 최대 50개, 순서 보존 배열).
 * 종목명 검색(KRX_MAP 자동완성, foreign-flow.js와 동일 패턴)으로 추가하고,
 * 기존 GAS 시세 프록시(?codes=)를 그대로 재사용해 카드에 현재가/등락률을 채운다.
 * 종목 행 클릭 시 우리 사이트 실시간 시세 페이지로 이동(js/stock-search.js).
 * 관심종목은 사용자가 만든 그룹으로 분류하고 블록 드래그앤드롭으로 순서와 그룹을 바꿀 수 있다.
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
  var API_BASE_URL = 'https://goodbyestar.cloud';
  var WATCHLIST_API_URL = API_BASE_URL + '/watchlist';
  var GOOGLE_AUTH_ME_URL = API_BASE_URL + '/auth/google/me';
  var GOOGLE_AUTH_START_URL = API_BASE_URL + '/auth/google/start';
  var GOOGLE_AUTH_LOGOUT_URL = API_BASE_URL + '/auth/google/logout';
  var CONTAINER_SELECTOR = '#watchlist';
  var STORAGE_KEY = 'wl_codes_v1';
  var GROUP_STORAGE_KEY = 'wl_groups_v1';
  var DEFAULT_GROUP_ID = 'default';
  var MAX_ITEMS = 50;
  var MAX_SUGGESTIONS = 8;
  var FETCH_TIMEOUT_MS = 8000;
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var US_SEARCH_URL = API_BASE_URL + '/us-search';
  var US_WATCHLIST_GROUP_NAME = '미국주식';
  var US_WATCHLIST_ETF_SYMBOLS = ['SOXL', 'SOXS', 'KORU'];
  var US_WATCHLIST_STOCKS = [
    { symbol: 'SKHY', name: 'SK하이닉스(ADR)', aliases: 'sk하이닉스 하이닉스 sk hynix' },
    { symbol: 'SPCX', name: '스페이스X', aliases: '스페이스x spacex' },
    { symbol: 'MRVL', name: '마벨 테크놀로지', aliases: '마벨 마벨테크놀로지 marvell' },
    { symbol: 'RGTI', name: '리게티 컴퓨팅', aliases: '리게티 rigetti' },
    { symbol: 'NVDA', name: '엔비디아', aliases: '엔비디아 nvidia' },
    { symbol: 'MSFT', name: '마이크로소프트', aliases: '마이크로소프트 microsoft' },
    { symbol: 'GOOGL', name: '알파벳 A', aliases: '구글 알파벳 alphabet google' },
    { symbol: 'AMZN', name: '아마존', aliases: '아마존 amazon' },
    { symbol: 'RKLB', name: '로켓 랩', aliases: '로켓랩 로켓 랩 rocket lab' },
    { symbol: 'TSLA', name: '테슬라', aliases: '테슬라 tesla' },
    { symbol: 'AVGO', name: '브로드컴', aliases: '브로드컴 broadcom' },
    { symbol: 'ORCL', name: '오라클', aliases: '오라클 oracle' },
    { symbol: 'MU', name: '마이크론 테크놀로지', aliases: '마이크론 마이크론테크놀로지 micron' },
    { symbol: 'AAPL', name: '애플', aliases: '애플 apple' },
    { symbol: 'INTC', name: '인텔', aliases: '인텔 intel' },
    { symbol: 'CBRS', name: '세레브라스 시스템즈', aliases: '세레브라스 cerebras' },
    { symbol: 'PLTR', name: '팔란티어', aliases: '팔란티어 palantir' },
    { symbol: 'SNDK', name: '샌디스크', aliases: '샌디스크 sandisk' },
    { symbol: 'DELL', name: '델 테크놀로지스', aliases: '델 델테크놀로지스 dell' },
    { symbol: 'IONQ', name: '아이온큐', aliases: '아이온큐 ionq' },
    { symbol: 'META', name: '메타', aliases: '메타 페이스북 meta facebook' },
    { symbol: 'LLY', name: '일라이 릴리', aliases: '일라이릴리 일라이 릴리 eli lilly lilly' },
    { symbol: 'AMD', name: 'AMD', aliases: 'amd' },
    { symbol: 'ASTS', name: 'AST 스페이스모바일', aliases: 'ast asts 스페이스모바일 spacemobile' }
  ];
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: 'Apple Inc.', aliases: '애플 apple' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', aliases: '마이크로소프트 microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', aliases: '엔비디아 nvidia' },
    { symbol: 'AMZN', name: 'Amazon.com, Inc.', aliases: '아마존 amazon' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', aliases: '구글 알파벳 google alphabet' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', aliases: '테슬라 tesla' },
    { symbol: 'META', name: 'Meta Platforms, Inc.', aliases: '메타 meta 페이스북' },
    { symbol: 'INTC', name: 'Intel Corporation', aliases: '인텔 intel' }
  ].concat(US_WATCHLIST_STOCKS).filter(function (row, index, rows) {
    return rows.findIndex(function (candidate) { return candidate.symbol === row.symbol; }) === index;
  });
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
  var draggedCode = null;
  var didDrag = false;
  var remoteState = { items: [], groups: [], revision: 0 };
  var remoteReady = false;
  var authState = { configured: false, authenticated: false, isAdmin: false, email: null };
  var saveQueue = Promise.resolve();
  var changeListeners = [];

  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙)
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    var iconCode = String(code).replace(/^US:/i, '').toUpperCase();
    return '<img class="wl-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(iconCode) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    if (container.getAttribute('data-watchlist-ready') === '1') return;
    container.setAttribute('data-watchlist-ready', '1');
    container.innerHTML = buildShell();
    wireEvents(container);
    loadRemoteState(container);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopRealtimeQuotes();
      else if (remoteReady && authState.authenticated) render(container);
      else loadRemoteState(container);
    });
  }

  function buildShell() {
    return ''
      + '<div class="wl-header">'
      + '<div class="wl-title">관심종목 <span id="wlCount" class="wl-count"></span></div>'
      + '<button type="button" id="wlGroupAddBtn" class="wl-group-add">+ 그룹 만들기</button>'
      + '<div class="wl-add">'
      + '<div class="wl-input-wrap">'
      + '<input type="text" id="wlInput" class="wl-input" placeholder="종목명을 입력하세요 (예: 삼성전자)"'
      + ' autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="wlSuggest"'
      + ' aria-expanded="false" aria-activedescendant="" />'
      + '<div id="wlSuggest" class="wl-suggest" role="listbox"></div>'
      + '</div>'
      + '<button type="button" id="wlAddBtn" class="wl-add-btn">추가</button>'
      + '</div>'
      + '</div>'
      + '<div id="wlMsg" class="wl-msg" hidden></div>'
      + '<div id="wlGrid" class="wl-grid"></div>'
      + '<div id="wlEmpty" class="wl-empty" hidden>관심종목이 없습니다. 종목을 검색해서 추가해보세요.</div>';
  }

  // ---- localStorage ----

  function loadLocalList() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function saveLocalList(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (err) {
      // localStorage 불가 환경(프라이빗 모드 등) - 조용히 무시, 이번 세션 내 메모리에는 반영됨
    }
  }

  function loadLocalGroups() {
    try {
      var raw = localStorage.getItem(GROUP_STORAGE_KEY);
      var groups = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(groups)) groups = [];
      if (!groups.some(function (group) { return group.id === DEFAULT_GROUP_ID; })) {
        groups.unshift({ id: DEFAULT_GROUP_ID, name: '기본', collapsed: false });
      }
      return groups;
    } catch (err) {
      return [{ id: DEFAULT_GROUP_ID, name: '기본', collapsed: false }];
    }
  }

  function saveLocalGroups(groups) {
    try { localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groups)); } catch (err) {}
  }

  function cloneState() {
    return JSON.parse(JSON.stringify({ items: remoteState.items, groups: remoteState.groups }));
  }

  function loadList() {
    return remoteState.items.slice();
  }

  function saveList(list, container) {
    remoteState.items = list.slice();
    persistRemoteState(container);
  }

  function loadGroups() {
    return remoteState.groups.slice();
  }

  function saveGroups(groups, container) {
    remoteState.groups = groups.slice();
    persistRemoteState(container);
  }

  function fetchAuthState() {
    return fetch(GOOGLE_AUTH_ME_URL, { credentials: 'include', cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('auth status HTTP ' + response.status); return response.json(); })
      .then(function (body) { return body && body.data ? body.data : { configured: false, authenticated: false }; })
      .catch(function () { return { configured: false, authenticated: false, isAdmin: false, email: null }; });
  }

  function renderLoginRequired(container, message) {
    var input = container.querySelector('#wlInput');
    var add = container.querySelector('#wlAddBtn');
    var groupAdd = container.querySelector('#wlGroupAddBtn');
    if (input) input.disabled = true;
    if (add) add.disabled = true;
    if (groupAdd) groupAdd.disabled = true;
    var grid = container.querySelector('#wlGrid');
    if (grid) {
      grid.innerHTML = '<div class="wl-login-gate"><strong>Google 로그인이 필요합니다.</strong><p>' +
        escapeHtml(message || '관심종목은 Google 계정별로 안전하게 저장됩니다.') +
        '</p><button type="button" class="wl-login-btn">Google로 로그인</button></div>';
      var button = grid.querySelector('.wl-login-btn');
      if (button) button.addEventListener('click', function () {
        var returnTo = encodeURIComponent(global.location.href);
        global.location.href = GOOGLE_AUTH_START_URL + '?return_to=' + returnTo;
      });
    }
    var empty = container.querySelector('#wlEmpty');
    if (empty) empty.hidden = true;
  }

  function renderAuthStatus(container) {
    var input = container.querySelector('#wlInput');
    var add = container.querySelector('#wlAddBtn');
    var groupAdd = container.querySelector('#wlGroupAddBtn');
    var authenticated = !!(authState.authenticated && authState.email);
    if (input) input.disabled = !authenticated;
    if (add) add.disabled = !authenticated;
    if (groupAdd) groupAdd.disabled = !authenticated;
    var header = container.querySelector('.wl-header');
    if (!header) return;
    var status = header.querySelector('.wl-auth');
    if (!status) {
      status = document.createElement('div');
      status.className = 'wl-auth';
      header.insertBefore(status, header.firstChild);
    }
    status.innerHTML = authenticated
      ? '<span>Google: ' + escapeHtml(authState.email) + '</span><button type="button" class="wl-logout-btn">로그아웃</button>'
      : '<span>로그인 필요</span>';
    var logout = status.querySelector('.wl-logout-btn');
    if (logout) logout.addEventListener('click', function () {
      global.location.href = GOOGLE_AUTH_LOGOUT_URL + '?return_to=' + encodeURIComponent(global.location.href);
    });
  }

  // 2026-08-10: 미국주식 기본 목록을 개별주 중심으로 정리한다.
  // 기존 계정의 "미국주식" 그룹에도 한 번만 적용되도록 현재 저장값과 비교한 뒤 변경 시에만 저장한다.
  function migrateUsWatchlist(container) {
    var usGroup = remoteState.groups.filter(function (group) {
      return group && group.name === US_WATCHLIST_GROUP_NAME;
    })[0];
    if (!usGroup) return false;

    var bannedByCode = {};
    US_WATCHLIST_ETF_SYMBOLS.forEach(function (symbol) { bannedByCode['US:' + symbol] = true; });

    var before = JSON.stringify(remoteState.items);
    var usedCodes = {};
    var nextUsItems = [];
    US_WATCHLIST_STOCKS.forEach(function (stock) {
      var code = 'US:' + stock.symbol;
      // 기존 종목이 있으면 이름만 최신 한국어 표시명으로 맞추고, 없으면 새로 넣는다.
      nextUsItems.push({ code: code, name: stock.name, groupId: usGroup.id });
      usedCodes[code] = true;
    });

    var otherItems = [];
    var extraUsItems = [];
    remoteState.items.forEach(function (item) {
      if (!item || !item.code) return;
      var code = String(item.code).toUpperCase();
      var groupId = item.groupId || DEFAULT_GROUP_ID;
      if (usedCodes[code]) return;
      if (groupId === usGroup.id) {
        if (!bannedByCode[code]) extraUsItems.push(item);
        return;
      }
      otherItems.push(item);
    });

    // 미국주식 그룹 안의 기존 사용자 추가 종목은 유지하되, ETF 3종은 제거한다.
    var capacity = Math.max(0, MAX_ITEMS - otherItems.length - extraUsItems.length);
    if (nextUsItems.length > capacity) nextUsItems = nextUsItems.slice(0, capacity);
    remoteState.items = otherItems.concat(nextUsItems, extraUsItems);
    if (JSON.stringify(remoteState.items) !== before) {
      persistRemoteState(container);
      return true;
    }
    return false;
  }

  function notifyChanged() {
    changeListeners.slice().forEach(function (listener) { try { listener(remoteState.items.slice()); } catch (err) {} });
    try { global.dispatchEvent(new Event('watchlist:changed')); } catch (err) {}
  }

  function persistRemoteState(container) {
    if (!remoteReady || !authState.authenticated) return;
    saveQueue = saveQueue.catch(function () {}).then(function () {
      var payload = cloneState();
      payload.revision = remoteState.revision;
      return fetch(WATCHLIST_API_URL, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.detail || '관심종목 저장에 실패했습니다.');
          return body;
        });
      }).then(function (body) {
        var saved = body.data || {};
        remoteState.revision = Number(saved.revision || remoteState.revision);
        notifyChanged();
      }).catch(function (error) {
        var msg = container && container.querySelector('#wlMsg');
        if (msg) { msg.textContent = error.message; msg.hidden = false; }
      });
    });
  }

  function loadRemoteState(container) {
    fetchAuthState().then(function (nextAuth) {
      authState = nextAuth;
      renderAuthStatus(container);
      if (!authState.configured || !authState.authenticated) {
        renderLoginRequired(container, authState.configured ? '관심종목을 저장하려면 Google 계정으로 로그인하세요.' : 'Google 로그인 서버 설정을 확인 중입니다.');
        return null;
      }
      return fetch(WATCHLIST_API_URL, { credentials: 'include', cache: 'no-store' })
        .then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) throw new Error(body.detail || '관심종목을 불러오지 못했습니다.');
            return body.data || {};
          });
        });
    }).then(function (data) {
      if (!data) return;
      var localItems = loadLocalList();
      var localGroups = loadLocalGroups();
      remoteState.items = Array.isArray(data.items) ? data.items : [];
      remoteState.groups = Array.isArray(data.groups) && data.groups.length ? data.groups : localGroups;
      remoteState.revision = Number(data.revision || 0);
      remoteReady = true;
      var migratedLegacy = false;
      if (!remoteState.items.length && localItems.length) {
        remoteState.items = localItems;
        remoteState.groups = localGroups;
        migratedLegacy = true;
        try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(GROUP_STORAGE_KEY); } catch (err) {}
      }
      if (!migrateUsWatchlist(container) && migratedLegacy) persistRemoteState(container);
      renderAuthStatus(container);
      render(container);
      notifyChanged();
    }).catch(function (error) {
      renderLoginRequired(container, error.message || '관심종목을 불러오지 못했습니다.');
    });
  }

  // ---- 검색/자동완성 (foreign-flow.js와 동일 패턴) ----

  function wireEvents(container) {
    var input = container.querySelector('#wlInput');
    var suggestBox = container.querySelector('#wlSuggest');
    var addBtn = container.querySelector('#wlAddBtn');
    var groupAddBtn = container.querySelector('#wlGroupAddBtn');
    suggestBox.__input = input;

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      var items = suggestBox.querySelectorAll('.wl-suggest-item');
      if (e.key === 'ArrowDown') {
        if (!items.length) return;
        e.preventDefault();
        setActiveSuggestion(suggestBox, items, (getActiveSuggestion(suggestBox) + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        setActiveSuggestion(suggestBox, items, (getActiveSuggestion(suggestBox) - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var idx = getActiveSuggestion(suggestBox);
        var pickedItem = idx > -1 && items[idx] ? items[idx] : null;
        var fallbackRow = !pickedItem && suggestBox.__suggestRows ? suggestBox.__suggestRows.filter(function (row) { return row.market === 'us'; })[0] : null;
        var picked = pickedItem ? (pickedItem.getAttribute('data-code') || pickedItem.getAttribute('data-name')) : (fallbackRow ? fallbackRow.code : input.value.trim());
        var pickedName = pickedItem ? pickedItem.getAttribute('data-name') : (fallbackRow ? fallbackRow.name : '');
        if (pickedItem) input.value = pickedName;
        hideSuggestions(suggestBox);
        addByQuery(container, picked, pickedName);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideSuggestions(suggestBox);
      }
    });
    addBtn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      addByQuery(container, input.value.trim());
    });
    groupAddBtn.addEventListener('click', function () {
      var name = global.prompt('새 그룹 이름을 입력하세요.');
      if (!name || !name.trim()) return;
      var groups = loadGroups();
      groups.push({ id: 'group-' + Date.now(), name: name.trim().slice(0, 20), collapsed: false });
      saveGroups(groups, container);
      render(container);
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    box.__activeIndex = -1;
    box.__suggestRows = [];
    if (box.__input) {
      box.__input.setAttribute('aria-expanded', 'false');
      box.__input.setAttribute('aria-activedescendant', '');
    }
  }

  function getActiveSuggestion(box) {
    return typeof box.__activeIndex === 'number' ? box.__activeIndex : -1;
  }

  function setActiveSuggestion(box, items, idx) {
    items.forEach(function (el) {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
    });
    box.__activeIndex = idx;
    var active = items[idx];
    if (!active) return;
    active.classList.add('active');
    active.setAttribute('aria-selected', 'true');
    if (box.__input) box.__input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
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
    var map = global.KRX_MAP || {};
    if (!query) { hideSuggestions(box); return; }

    var requestId = (box.__suggestRequestId || 0) + 1;
    box.__suggestRequestId = requestId;

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
    var domesticRows = startsStock.concat(startsEtf, containsStock, containsEtf).map(function (name) {
      return { code: map[name], name: name, market: 'kr' };
    });

    renderSuggestionRows(container, box, domesticRows, [], requestId);
    fetchUsSuggestions(query).then(function (usRows) {
      if (box.__suggestRequestId !== requestId) return;
      renderSuggestionRows(container, box, domesticRows, usRows, requestId);
    });
  }

  function fetchUsSuggestions(query) {
    var localRows = LOCAL_US_SYMBOLS.filter(function (row) {
      return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(String(query || '').toLowerCase()) !== -1;
    }).slice(0, 8).map(function (row) {
      return { code: 'US:' + row.symbol, name: row.name, market: 'us' };
    });
    if (localRows.length) return Promise.resolve(localRows);
    var request = typeof global.fetch === 'function'
      ? global.fetch(US_SEARCH_URL + '?q=' + encodeURIComponent(query) + '&limit=8')
      : Promise.reject(new Error('fetch unavailable'));
    return request
      .then(function (response) {
        if (!response.ok) throw new Error('미국주식 검색 오류: ' + response.status);
        return response.json();
      })
      .then(function (body) {
        var rows = (body && body.data ? body.data : []).map(function (row) {
          return { code: row.code || ('US:' + row.symbol), name: row.name || row.symbol, market: 'us' };
        });
        if (!rows.length) throw new Error('미국주식 검색 결과 없음');
        return rows;
      })
      .catch(function () {
        return localRows;
      });
  }

  function renderSuggestionRows(container, box, domesticRows, usRows, requestId) {
    if (box.__suggestRequestId !== requestId) return;
    var domesticLimit = usRows.length ? Math.max(0, MAX_SUGGESTIONS - Math.min(usRows.length, 2)) : MAX_SUGGESTIONS;
    var rows = domesticRows.slice(0, domesticLimit).concat(usRows).slice(0, MAX_SUGGESTIONS);
    box.__suggestRows = rows;
    if (!rows.length) { hideSuggestions(box); return; }

    box.innerHTML = rows.map(function (row, index) {
      var label = row.market === 'us' ? '<span class="wl-suggest-market">US</span> ' + escapeHtml(row.name) + ' <small>(' + escapeHtml(String(row.code).replace(/^US:/i, '')) + ')</small>' : escapeHtml(row.name);
      return '<div class="wl-suggest-item" id="wlSuggestOption' + index + '" role="option" aria-selected="false"'
        + ' data-code="' + escapeAttr(row.code) + '" data-name="' + escapeAttr(row.name) + '">' + label + '</div>';
    }).join('');
    box.classList.add('active');
    box.__activeIndex = -1;
    if (box.__input) {
      box.__input.setAttribute('aria-expanded', 'true');
      box.__input.setAttribute('aria-activedescendant', '');
    }

    box.querySelectorAll('.wl-suggest-item').forEach(function (el, index) {
      el.addEventListener('mouseenter', function () {
        setActiveSuggestion(box, box.querySelectorAll('.wl-suggest-item'), index);
      });
      el.addEventListener('click', function () {
        var code = el.getAttribute('data-code') || el.getAttribute('data-name');
        var name = el.getAttribute('data-name');
        container.querySelector('#wlInput').value = name;
        hideSuggestions(box);
        addByQuery(container, code, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만.
  function resolveStock(query) {
    if (!query) return null;
    if (/^US:/i.test(query)) {
      var usSymbol = query.slice(3).trim().toUpperCase();
      return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(usSymbol) ? { code: 'US:' + usSymbol, name: usSymbol } : null;
    }
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

    var localQuery = query.toLowerCase();
    var localMatches = LOCAL_US_SYMBOLS.filter(function (row) {
      return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(localQuery) !== -1;
    });
    if (localMatches.length === 1) {
      return { code: 'US:' + localMatches[0].symbol, name: localMatches[0].name };
    }

    if (/^[A-Z][A-Z0-9.\-]{0,9}$/i.test(query)) {
      var directSymbol = query.toUpperCase();
      var localUs = LOCAL_US_SYMBOLS.filter(function (row) { return row.symbol === directSymbol; })[0];
      return { code: 'US:' + directSymbol, name: localUs ? localUs.name : directSymbol };
    }

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
    if (!remoteReady || !authState.authenticated) return { ok: false, reason: 'login' };
    var list = loadList();
    if (list.some(function (it) { return it.code === code; })) return { ok: false, reason: 'exists' };
    if (list.length >= MAX_ITEMS) return { ok: false, reason: 'full' };

    list.push({ code: code, name: name || code, groupId: DEFAULT_GROUP_ID });
    var container = document.querySelector(CONTAINER_SELECTOR);
    saveList(list, container);
    if (container) render(container);
    return { ok: true };
  }

  function removeStock(code) {
    var list = loadList().filter(function (it) { return it.code !== code; });
    var container = document.querySelector(CONTAINER_SELECTOR);
    saveList(list, container);
    if (container) render(container);
  }

  function hasStock(code) {
    return loadList().some(function (it) { return it.code === code; });
  }

  function addByQuery(container, query, explicitName) {
    var stock = resolveStock(query);
    if (stock && /^US:/i.test(stock.code) && explicitName) stock.name = explicitName;
    var input = container.querySelector('#wlInput');
    if (!stock) {
      showMsg(container, '종목을 찾을 수 없습니다: "' + query + '"');
      return;
    }

    var result = addStock(stock.code, stock.name);
    if (!result.ok) {
      if (result.reason === 'login') showMsg(container, 'Google 로그인 후 관심종목을 저장할 수 있습니다.');
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
    var groups = loadGroups();
    var grid = container.querySelector('#wlGrid');
    var empty = container.querySelector('#wlEmpty');
    var count = container.querySelector('#wlCount');

    count.textContent = '(' + list.length + '/' + MAX_ITEMS + ')';

    if (!list.length) {
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }

    grid.innerHTML = groups.map(function (group) {
      var items = list.filter(function (it) { return (it.groupId || DEFAULT_GROUP_ID) === group.id; });
      return buildGroup(group, items);
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

  function buildGroup(group, items) {
    return '<section class="wl-group' + (group.collapsed ? ' is-collapsed' : '') + '" data-group-id="' + escapeAttr(group.id) + '">'
      + '<div class="wl-group-head">'
      + '<button type="button" class="wl-group-toggle" aria-expanded="' + (!group.collapsed) + '">'
      + '<span>' + escapeHtml(group.name) + '</span><span class="wl-group-count">' + items.length + '</span><span class="wl-chevron">⌃</span>'
      + '</button>'
      + (group.id === DEFAULT_GROUP_ID ? '' : '<button type="button" class="wl-group-delete" aria-label="그룹 삭제">삭제</button>')
      + '</div><div class="wl-group-items" data-group-id="' + escapeAttr(group.id) + '">'
      + (items.length ? items.map(function (it) { return buildCard(it.code, it.name); }).join('') : '<p class="wl-group-empty">이 그룹에 종목이 없습니다.</p>')
      + '</div></section>';
  }

  function buildCard(code, name) {
    return ''
      + '<div class="wl-card" data-code="' + escapeAttr(code) + '" data-name="' + escapeAttr(name) + '" tabindex="0" role="link" draggable="true">'
      + '<span class="wl-drag-handle" aria-hidden="true">⋮⋮</span>'
      + '<button type="button" class="wl-remove" data-code="' + escapeAttr(code) + '" aria-label="관심종목 삭제">★</button>'
      + '<div class="wl-name">' + stockIconHtml(code) + '<span class="wl-name-text">' + escapeHtml(name) + '</span></div>'
      + '<div class="wl-quote"><div class="wl-change" data-field="change">-</div><div class="wl-price" data-field="price">-</div></div>'
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

    var signature = [quote.price, quote.change, quote.changeRate].join('|');
    if (card.getAttribute('data-quote-signature') === signature) return;
    card.setAttribute('data-quote-signature', signature);

    var isUs = /^US:/i.test(code);
    var price = Number(quote.price);
    priceEl.textContent = isUs && !isNaN(price)
      ? '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : formatNumber(quote.price) + '원';
    var changeRate = Number(quote.changeRate);
    changeEl.textContent = isNaN(changeRate)
      ? ''
      : arrowSymbol(quote.change) + Math.abs(changeRate).toFixed(2) + '%';
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
          // 일시적인 429/브로커 오류가 와도 기존 숫자를 지우지 않는다.
          if (quoteByCode[code]) updateCard(container, code, quoteByCode[code]);
        });
      })
      .catch(function () {});
  }

  function startRealtimeQuotes(container, codes) {
    stopRealtimeQuotes();
    if (!codes.length || document.hidden) return;

    // 국내 코드는 키움, 미국 코드는 Finnhub 스트림으로 서버가 분리 중계한다.
    var domesticCodes = codes.filter(function (code) { return !/^US:/i.test(code); });
    var usCodes = codes.filter(function (code) { return /^US:/i.test(code); });
    var canUseSocket = domesticCodes.length && ('WebSocket' in global);

    var generation = realtimeGeneration;
    var encodedCodes = domesticCodes.map(encodeURIComponent).join(',');

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

    // WebSocket이 일시적으로 끊긴 경우를 위한 안전망이다. 정상 상태에서는
    // 미국주식도 Finnhub WebSocket 이벤트가 변경된 행만 바로 갱신한다.
    realtimeFallbackTimer = setInterval(function () {
      var fallbackCodes = usCodes.slice();
      if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
        fallbackCodes = domesticCodes.concat(fallbackCodes);
      }
      if (fallbackCodes.length) refreshQuotesOnce(container, fallbackCodes);
    }, REALTIME_FALLBACK_MS);

    if (canUseSocket) connect();
  }

  function wireCardEvents(container) {
    container.querySelectorAll('.wl-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeCode(container, btn.getAttribute('data-code'));
      });
    });
    container.querySelectorAll('.wl-card').forEach(function (card) {
      function goToRealtime() {
        location.href = STOCK_SEARCH_PAGE_URL + '?code=' + encodeURIComponent(card.getAttribute('data-code'))
          + '&name=' + encodeURIComponent(card.getAttribute('data-name'));
      }
      card.addEventListener('click', function (e) {
        if (didDrag) { didDrag = false; return; }
        if (!e.target.closest('button, select')) goToRealtime();
      });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter') goToRealtime(); });
      card.addEventListener('dragstart', function (e) {
        draggedCode = card.getAttribute('data-code');
        didDrag = true;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedCode);
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('is-dragging');
        container.querySelectorAll('.wl-group-items').forEach(function (items) { items.classList.remove('is-drag-over'); });
        persistDraggedOrder(container);
        draggedCode = null;
        setTimeout(function () { didDrag = false; }, 0);
      });
    });
    container.querySelectorAll('.wl-group-items').forEach(function (items) {
      items.addEventListener('dragover', function (e) {
        if (!draggedCode) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        items.classList.add('is-drag-over');
        var dragging = container.querySelector('.wl-card[data-code="' + cssEscape(draggedCode) + '"]');
        var before = getDragBeforeElement(items, e.clientY);
        if (dragging) items.insertBefore(dragging, before);
      });
      items.addEventListener('dragleave', function (e) {
        if (!items.contains(e.relatedTarget)) items.classList.remove('is-drag-over');
      });
      items.addEventListener('drop', function (e) { e.preventDefault(); items.classList.remove('is-drag-over'); });
    });
    container.querySelectorAll('.wl-group-toggle').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.closest('.wl-group').getAttribute('data-group-id');
        var groups = loadGroups();
        groups.forEach(function (group) { if (group.id === id) group.collapsed = !group.collapsed; });
        saveGroups(groups, container);
        render(container);
      });
    });
    container.querySelectorAll('.wl-group-delete').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.closest('.wl-group').getAttribute('data-group-id');
        var groups = loadGroups().filter(function (group) { return group.id !== id; });
        var list = loadList();
        list.forEach(function (item) { if ((item.groupId || DEFAULT_GROUP_ID) === id) item.groupId = DEFAULT_GROUP_ID; });
        saveGroups(groups, container);
        saveList(list, container);
        render(container);
      });
    });
  }

  function getDragBeforeElement(items, pointerY) {
    var cards = Array.prototype.slice.call(items.querySelectorAll('.wl-card:not(.is-dragging)'));
    var closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    cards.forEach(function (card) {
      var rect = card.getBoundingClientRect();
      var offset = pointerY - rect.top - rect.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, element: card };
    });
    return closest.element;
  }

  function persistDraggedOrder(container) {
    if (!draggedCode) return;
    var current = loadList();
    var byCode = {};
    current.forEach(function (item) { byCode[item.code] = item; });
    var next = [];
    container.querySelectorAll('.wl-group-items').forEach(function (items) {
      var groupId = items.getAttribute('data-group-id') || DEFAULT_GROUP_ID;
      items.querySelectorAll('.wl-card').forEach(function (card) {
        var item = byCode[card.getAttribute('data-code')];
        if (!item) return;
        item.groupId = groupId;
        next.push(item);
      });
    });
    if (next.length === current.length) {
      saveList(next, container);
      render(container);
    }
  }

  // ---- 시세 조회 (기존 티커 프록시 재사용, 신규 GAS 엔드포인트 불필요) ----

  function fetchQuotes(codes) {
    if (!codes.length) return Promise.resolve({});
    var domesticCodes = codes.filter(function (code) { return !/^US:/i.test(code); });
    var usCodes = codes.filter(function (code) { return /^US:/i.test(code); });

    return Promise.all([
      fetchDomesticQuotes(domesticCodes).catch(function () { return {}; }),
      fetchUsQuotes(usCodes)
    ]).then(function (parts) {
      return Object.assign({}, parts[0], parts[1]);
    });
  }

  function fetchDomesticQuotes(codes) {
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

  function fetchUsQuotes(codes) {
    if (!codes.length) return Promise.resolve({});
    return Promise.all(codes.map(function (code) {
      var symbol = String(code).replace(/^US:/i, '').toUpperCase();
      return fetch(API_BASE_URL + '/us-quote/' + encodeURIComponent(symbol))
        .then(function (response) {
          if (!response.ok) throw new Error('미국주식 시세 오류: ' + response.status);
          return response.json();
        })
        .then(function (body) {
          var data = body && body.data ? body.data : body;
          return {
            code: 'US:' + symbol,
            price: data && data.price,
            change: data && data.change,
            changeRate: data && (data.change_rate != null ? data.change_rate : data.changeRate)
          };
        })
        .catch(function () { return null; });
    })).then(function (rows) {
      var byCode = {};
      rows.forEach(function (row) { if (row && row.price != null) byCode[row.code] = row; });
      return byCode;
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
    getList: function () { return loadList(); },
    getGroups: function () { return loadGroups(); },
    onChange: function (listener) { if (typeof listener === 'function') changeListeners.push(listener); },
    isReady: function () { return remoteReady && authState.authenticated; },
    MAX_ITEMS: MAX_ITEMS
  };
  global.Watchlist = Watchlist;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
