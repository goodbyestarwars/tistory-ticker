/**
 * 종목 검색 패널 - 사이트 전역 플로팅 위젯 (v2: 소형 드롭다운 + 페이지 이동 방식)
 *
 * v1(전체화면 슬라이드 패널 + ForeignFlow.search() 인라인 임베드)은 실사용 확인 결과
 * 라이브에서 오버레이가 어색하게 뜨고 클릭이 먹통이 되는 문제가 있었고, 사용자 피드백은
 * "검색을 누르면 보통 이렇게 안 뜬다 - 별도 페이지/HTML에서 정보를 보여줘야 한다"였다.
 * 그래서 이 버전은 훨씬 단순하게: 우측 하단 🔍 버튼 -> 작은 드롭다운(검색창 + 자동완성 +
 * 즐겨찾기·최근검색)만 뜨고, 종목을 고르면 이미 있는 종목분석 페이지
 * (/page/foreign-flow?code=&name=, js/invest-signal.js가 쓰는 것과 동일한 이동 방식)로
 * 이동한다. 차트/종합점수/투자시그널/수급/펀더멘탈은 그 페이지가 이미 다 보여주므로
 * 여기서 다시 그리지 않는다 - 새 Tistory 페이지를 만들 필요 없음.
 *
 * 즐겨찾기(★)·최근검색(최대 10개)·마지막 조회 종목은 이 브라우저의 localStorage에
 * 저장된다(로그인 불필요, 기기별로 다를 수 있음):
 *   stock:lastSelected - 마지막으로 연 종목 코드
 *   stock:favorites     - [{code,name}, ...]
 *   stock:recent        - [{code,name}, ...] 최신순, 최대 10개
 */
(function (global) {
  'use strict';

  var KRX_MAP_JS = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
  var TARGET_PAGE = '/page/foreign-flow';

  var STORAGE_LAST = 'stock:lastSelected';
  var STORAGE_FAVORITES = 'stock:favorites';
  var STORAGE_RECENT = 'stock:recent';
  var MAX_RECENT = 10;
  var MAX_SUGGEST = 8;

  var krxMapPromise = null;
  var activeIndex = -1;
  var dropdownOpen = false;

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

  function getLast() {
    try { return localStorage.getItem(STORAGE_LAST) || null; } catch (err) { return null; }
  }
  function setLast(code) {
    try { localStorage.setItem(STORAGE_LAST, code); } catch (err) { /* 무시 */ }
  }

  function getFavorites() { return readJson(STORAGE_FAVORITES, []); }
  function isFavorite(code) { return getFavorites().some(function (it) { return it.code === code; }); }
  function toggleFavorite(code, name) {
    var list = getFavorites();
    var idx = list.findIndex(function (it) { return it.code === code; });
    if (idx > -1) list.splice(idx, 1);
    else list.unshift({ code: code, name: name });
    writeJson(STORAGE_FAVORITES, list);
    return idx === -1; // true면 방금 추가됨
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

  // ---- DOM 뼈대: 작은 앵커 드롭다운(전체화면 오버레이 아님) ----

  function buildDom() {
    var wrap = document.createElement('div');
    wrap.id = 'sspWrap';
    wrap.className = 'ssp-wrap';
    wrap.innerHTML = ''
      + '<button type="button" id="sspTrigger" class="ssp-trigger" aria-label="종목검색 열기">'
      + '<span class="ssp-trigger-icon">🔍</span><span class="ssp-trigger-label" id="sspTriggerLabel">종목검색</span>'
      + '</button>'
      + '<div id="sspDropdown" class="ssp-dropdown" hidden>'
      + '<div class="ssp-dropdown-inner">'
      + '<div class="ssp-input-wrap">'
      + '<input type="text" id="sspInput" class="ssp-input" placeholder="종목명 또는 코드 (예: 삼성전자, 005930)" autocomplete="off" />'
      + '<div id="sspSuggest" class="ssp-suggest"></div>'
      + '</div>'
      + '<div class="ssp-chip-section" id="sspChipSection"></div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function buildChipsHtml(list, emptyText) {
    if (!list.length) return '<div class="ssp-chip-empty">' + emptyText + '</div>';
    return list.map(function (it) {
      return '<button type="button" class="ssp-chip" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '">' + escapeHtml(it.name) + '</button>';
    }).join('');
  }

  function renderChipSection() {
    var el = document.getElementById('sspChipSection');
    if (!el) return;
    var favorites = getFavorites();
    var recent = getRecent();
    el.innerHTML = ''
      + '<div class="ssp-chip-group"><div class="ssp-chip-title">★ 즐겨찾기</div><div class="ssp-chip-row">' + buildChipsHtml(favorites, '즐겨찾기한 종목이 없어요.') + '</div></div>'
      + '<div class="ssp-chip-group"><div class="ssp-chip-title">최근 검색</div><div class="ssp-chip-row">' + buildChipsHtml(recent, '최근 검색한 종목이 없어요.') + '</div></div>';

    el.querySelectorAll('.ssp-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        goToStock(btn.getAttribute('data-code'), btn.getAttribute('data-name'));
      });
    });
  }

  // ---- 자동완성 ----

  function hideSuggest(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    activeIndex = -1;
  }

  function renderSuggest(box, query) {
    if (!query || !global.KRX_MAP) { hideSuggest(box); return; }
    var matches = suggestNames(query);
    if (!matches.length) { hideSuggest(box); return; }

    box.innerHTML = matches.map(function (name, i) {
      return '<div class="ssp-suggest-item' + (i === activeIndex ? ' active' : '') + '" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.ssp-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var stock = resolveStock(el.getAttribute('data-name'));
        if (stock) goToStock(stock.code, stock.name);
      });
    });
  }

  function moveActive(box, delta, query) {
    var matches = suggestNames(query);
    if (!matches.length) return;
    activeIndex = (activeIndex + delta + matches.length) % matches.length;
    renderSuggest(box, query);
  }

  // ---- 종목 선택 -> 종목분석 페이지로 이동 ----

  function goToStock(code, name) {
    if (!code) return;
    setLast(code);
    addRecent(code, name || code);
    global.location.href = TARGET_PAGE + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name || code);
  }

  // ---- 드롭다운 열기/닫기 ----

  function openDropdown() {
    var dropdown = document.getElementById('sspDropdown');
    if (!dropdown) return;
    dropdown.hidden = false;
    dropdownOpen = true;
    renderChipSection();
    ensureKrxMap().catch(function () { /* 자동완성만 늦게 뜰 뿐, 조용히 무시 */ });
    var input = document.getElementById('sspInput');
    if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 0); }
  }

  function closeDropdown() {
    var dropdown = document.getElementById('sspDropdown');
    if (!dropdown) return;
    dropdown.hidden = true;
    dropdownOpen = false;
    var suggestBox = document.getElementById('sspSuggest');
    if (suggestBox) hideSuggest(suggestBox);
  }

  // ---- 이벤트 바인딩 ----

  function wireEvents(wrap) {
    var trigger = document.getElementById('sspTrigger');
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (dropdownOpen) closeDropdown(); else openDropdown();
    });

    document.addEventListener('click', function (e) {
      if (dropdownOpen && !wrap.contains(e.target)) closeDropdown();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dropdownOpen) closeDropdown();
    });

    var input = document.getElementById('sspInput');
    var suggestBox = document.getElementById('sspSuggest');

    input.addEventListener('input', function () {
      ensureKrxMap().then(function () { renderSuggest(suggestBox, input.value.trim()); });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(suggestBox, 1, input.value.trim()); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(suggestBox, -1, input.value.trim()); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var q = input.value.trim();
        var matches = suggestNames(q);
        var name = activeIndex > -1 && matches[activeIndex] ? matches[activeIndex] : q;
        var stock = resolveStock(name);
        if (stock) goToStock(stock.code, stock.name);
      } else if (e.key === 'Escape') {
        hideSuggest(suggestBox);
      }
    });
  }

  // ---- 트리거 라벨(마지막 조회 종목 복원) ----

  function restoreLastSelectionLabel() {
    var lastCode = getLast();
    if (!lastCode) return;
    var hit = getRecent().filter(function (it) { return it.code === lastCode; })[0]
      || getFavorites().filter(function (it) { return it.code === lastCode; })[0];
    var label = document.getElementById('sspTriggerLabel');
    if (label && hit) label.textContent = hit.name;
  }

  // ---- 포맷 유틸 ----

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---- 초기화 ----

  function init() {
    var wrap = buildDom();
    wireEvents(wrap);
    restoreLastSelectionLabel();
  }

  var StockSearchPanel = { init: init, openDropdown: openDropdown, closeDropdown: closeDropdown, goToStock: goToStock };
  global.StockSearchPanel = StockSearchPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
