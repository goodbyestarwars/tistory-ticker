/**
 * 종목검색 - 왼쪽 사이드바(커뮤니티 메뉴 바로 아래) 검색창
 *
 * v1(플로팅 🔍 버튼 + 전체화면 오버레이)과 v2(플로팅 버튼 + 소형 드롭다운)는 라이브 확인 결과
 * 클릭이 먹통이 되거나 어색하게 뜨는 문제가 있었고, 사용자 피드백은 "왼쪽 사이드바 커뮤니티
 * 밑에 음각 스타일 검색창(플레이스홀더: 종목검색)으로 달라"였다. 그래서 이 v3는 플로팅
 * 엘리먼트를 만들지 않고, js/skin-menu.js가 사이드바에 미리 심어둔 #navSearchInput/
 * #navSearchSuggest에 자동완성 + 이동 로직만 붙인다(마크업은 skin-menu.js 담당, 동작은
 * 여기 담당 - 검색 로직을 한 곳에 모아두기 위한 분리).
 *
 * 종목을 고르면 이미 있는 종목분석 페이지(/page/foreign-flow?code=&name=, js/invest-signal.js가
 * 쓰는 것과 동일한 이동 방식)로 이동한다 - 새 Tistory 페이지를 만들 필요 없음.
 *
 * 즐겨찾기(★)·최근검색(최대 10개)·마지막 조회 종목은 이 브라우저의 localStorage에 저장된다:
 *   stock:lastSelected, stock:favorites, stock:recent
 * (현재 이 검색창 자체엔 즐겨찾기 추가 UI가 없음 - 검색해서 이동한 종목이 자동으로
 * 최근검색에 쌓이고, 입력창이 비어있을 때 그 최근검색을 드롭다운으로 보여준다)
 */
(function (global) {
  'use strict';

  var KRX_MAP_JS = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
  var TARGET_PAGE = '/page/foreign-flow';

  var STORAGE_LAST = 'stock:lastSelected';
  var STORAGE_RECENT = 'stock:recent';
  var MAX_RECENT = 10;
  var MAX_SUGGEST = 8;
  var WIRE_RETRY_MS = 300;
  var WIRE_RETRY_MAX = 20; // 최대 6초까지 재시도(스크립트 로드 순서가 뒤바뀐 경우 대비)

  var krxMapPromise = null;
  var activeIndex = -1;
  var wired = false;

  // ---- KRX_MAP 지연 로드 ----

  function ensureKrxMap() {
    if (global.KRX_MAP) return Promise.resolve();
    if (krxMapPromise) return krxMapPromise;
    krxMapPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = KRX_MAP_JS;
      s.onload = function () { resolve(); };
      s.onerror = function () { krxMapPromise = null; reject(new Error('krx_map.js 로드 실패')); };
      document.head.appendChild(s);
    });
    return krxMapPromise;
  }

  // ---- localStorage ----

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      var v = raw ? JSON.parse(raw) : fallback;
      return v == null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* 프라이빗 모드 등 무시 */ }
  }
  function setLast(code) {
    try { localStorage.setItem(STORAGE_LAST, code); } catch (err) { /* 무시 */ }
  }
  function getRecent() { return readJson(STORAGE_RECENT, []); }
  function addRecent(code, name) {
    var list = getRecent().filter(function (it) { return it.code !== code; });
    list.unshift({ code: code, name: name });
    if (list.length > MAX_RECENT) list.length = MAX_RECENT;
    writeJson(STORAGE_RECENT, list);
  }

  // ---- 종목명/코드 검색 (KRX_MAP, 기존 위젯들과 동일 패턴) ----

  function resolveStock(query) {
    if (!query) return null;
    var map = global.KRX_MAP || {};
    if (/^[0-9A-Z]{6}$/i.test(query)) {
      for (var nm in map) {
        if (map.hasOwnProperty(nm) && map[nm].toUpperCase() === query.toUpperCase()) return { code: map[nm], name: nm };
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

  function suggestNames(query) {
    var map = global.KRX_MAP || {};
    var q = query.toLowerCase();
    var starts = [], contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) { if (starts.length < MAX_SUGGEST) starts.push(name); }
      else if (lower.indexOf(q) > -1) { if (contains.length < MAX_SUGGEST) contains.push(name); }
    }
    return starts.concat(contains).slice(0, MAX_SUGGEST);
  }

  // ---- 렌더링 ----

  function hideSuggest(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    activeIndex = -1;
  }

  function renderRecent(box) {
    var recent = getRecent();
    if (!recent.length) { hideSuggest(box); return; }
    box.innerHTML = '<div class="nav-search-suggest-title">최근 검색</div>'
      + recent.map(function (it, i) {
        return '<div class="nav-search-suggest-item' + (i === activeIndex ? ' active' : '') + '" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '">' + escapeHtml(it.name) + '</div>';
      }).join('');
    box.classList.add('active');
    wireSuggestClicks(box);
  }

  function renderMatches(box, query) {
    var matches = suggestNames(query);
    if (!matches.length) { hideSuggest(box); return; }
    box.innerHTML = matches.map(function (name, i) {
      var code = (global.KRX_MAP || {})[name];
      return '<div class="nav-search-suggest-item' + (i === activeIndex ? ' active' : '') + '" data-code="' + escapeAttr(code) + '" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');
    wireSuggestClicks(box);
  }

  function wireSuggestClicks(box) {
    box.querySelectorAll('.nav-search-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        goToStock(el.getAttribute('data-code'), el.getAttribute('data-name'));
      });
    });
  }

  function currentSuggestNames(query) {
    return query ? suggestNames(query) : getRecent().map(function (it) { return it.name; });
  }

  function moveActive(box, delta, query) {
    var names = currentSuggestNames(query);
    if (!names.length) return;
    activeIndex = (activeIndex + delta + names.length) % names.length;
    if (query) renderMatches(box, query); else renderRecent(box);
  }

  // ---- 종목 선택 -> 종목분석 페이지로 이동 ----

  function goToStock(code, name) {
    if (!code) return;
    setLast(code);
    addRecent(code, name || code);
    global.location.href = TARGET_PAGE + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name || code);
  }

  // ---- 사이드바 검색창에 이벤트 바인딩 ----

  function wireSidebarSearch() {
    var input = document.getElementById('navSearchInput');
    var box = document.getElementById('navSearchSuggest');
    if (!input || !box) return; // 아직 skin-menu.js가 안 그렸으면 init()의 재시도가 다시 호출함
    if (wired) return;
    wired = true;

    input.addEventListener('focus', function () {
      if (input.value.trim()) ensureKrxMap().then(function () { renderMatches(box, input.value.trim()); });
      else renderRecent(box);
    });
    input.addEventListener('input', function () {
      var q = input.value.trim();
      activeIndex = -1;
      if (!q) { renderRecent(box); return; }
      ensureKrxMap().then(function () { renderMatches(box, q); });
    });
    input.addEventListener('keydown', function (e) {
      var q = input.value.trim();
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(box, 1, q); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(box, -1, q); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var names = currentSuggestNames(q);
        var name = activeIndex > -1 && names[activeIndex] ? names[activeIndex] : q;
        var stock = q ? resolveStock(name) : (getRecent().filter(function (it) { return it.name === name; })[0]);
        if (stock) goToStock(stock.code, stock.name);
      } else if (e.key === 'Escape') {
        hideSuggest(box);
        input.blur();
      }
    });
    document.addEventListener('click', function (e) {
      var wrap = document.querySelector('.nav-search-wrap');
      if (wrap && !wrap.contains(e.target)) hideSuggest(box);
    });
  }

  // ---- 포맷 유틸 ----

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---- 초기화: skin-menu.js가 먼저 로드됐으면 바로, 아니면 짧게 재시도 ----

  function init() {
    var tries = 0;
    (function attempt() {
      wireSidebarSearch();
      if (wired) return;
      tries++;
      if (tries < WIRE_RETRY_MAX) setTimeout(attempt, WIRE_RETRY_MS);
    })();
  }

  var StockSearchPanel = { init: init, wireSidebarSearch: wireSidebarSearch, goToStock: goToStock };
  global.StockSearchPanel = StockSearchPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
