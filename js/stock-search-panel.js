/**
 * 종목 검색 패널 - 사이트 전역 플로팅 위젯
 *
 * 우측 하단 🔍 버튼(스크롤탑 버튼 바로 위) -> 클릭 시 검색 패널이 열린다.
 * 어느 페이지에서든 종목명/코드를 검색해 가격·차트·종합점수·투자시그널·수급·
 * 펀더멘탈·차트패턴·뉴스를 한 번에 볼 수 있다.
 *
 * 최근검색(최대 10개)·즐겨찾기(★)·마지막 조회 종목은 이 브라우저의 localStorage에
 * 저장된다(로그인 불필요, 기기별로 다를 수 있음):
 *   stock:lastSelected - 마지막으로 연 종목 코드
 *   stock:favorites     - [{code,name}, ...]
 *   stock:recent        - [{code,name}, ...] 최신순, 최대 10개
 *
 * 차트/종합점수/투자시그널/수급/펀더멘탈 렌더링은 이 패널에서 새로 만들지 않고
 * js/foreign-flow.js의 ForeignFlow.search(container, code)를 그대로 재사용한다.
 * 이유: 그 파일이 이미 "종목분석" 페이지에서 검증된 채점 로직(수급×0.40 + 외국인기관×0.25
 * + 기술적×0.20 + 공매도×0.10 + 연기금×0.05)과 렌더링을 갖고 있고, 이 프로젝트는 같은
 * 점수가 페이지마다 다르게 나오는 걸 특히 경계한다(js/invest-signal.js가 서버에 포팅된
 * 동일 공식을 쓰는 것과 같은 이유). 여기서 점수 계산을 다시 베껴 쓰면 나중에 한쪽만
 * 고치고 다른 쪽을 안 고치는 사고가 나기 쉽다 - 그래서 이 패널은 "새 통합 UI 껍데기 +
 * 검증된 내부 로직 재사용" 구조로 설계했다. foreign-flow.js/css/Lightweight Charts는
 * 스킨 전역이 아니라 종목분석 페이지 전용 임베드라 기본적으로 로드돼있지 않으므로,
 * 이 패널이 처음 열릴 때 필요한 JS/CSS를 늦게 불러온다(아래 ensureDeps).
 *
 * 차트패턴/뉴스는 foreign-flow.js에 없는 섹션이라 이 파일이 직접 GAS를 호출해 붙인다.
 * 호가창(매도/매수 5단계)은 이번 범위에서 제외(사용자 확정).
 *
 * 실시간 갱신: 별도 WebSocket 서버를 새로 두지 않고(개인 계좌 API 키라 공개 서버에
 * 못 둠 - CLAUDE.md 참고), js/overnight-market.js와 동일한 방식으로 현재 열려있는
 * 종목의 가격만 짧은 주기로 폴링해 갱신한다(방문자 입장에선 실시간처럼 보임).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var SITE_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var FF_JS = SITE_BASE + 'js/foreign-flow.js';
  var FF_CSS = SITE_BASE + 'css/foreign-flow.css';
  var KRX_MAP_JS = SITE_BASE + 'data/krx_map.js';

  var STORAGE_LAST = 'stock:lastSelected';
  var STORAGE_FAVORITES = 'stock:favorites';
  var STORAGE_RECENT = 'stock:recent';
  var MAX_RECENT = 10;
  var MAX_SUGGEST = 8;
  var PRICE_POLL_MS = 15000;
  var FETCH_TIMEOUT_MS = 15000;
  var PATTERN_CACHE_MS = 10 * 60 * 1000;

  var PATTERN_LABELS = {
    risingLows: '저점상승형',
    doubleBottom: '쌍바닥',
    invHeadShoulders: '역헤드앤숄더',
    boxRangeLow: '박스권하단',
    pullback: '눌림목'
  };

  var depsPromise = null;
  var patternCache = null; // { t, data }
  var activeIndex = -1;
  var currentCode = null;
  var currentName = null;
  var priceTimer = null;
  var panelOpen = false;

  // ---- 의존 리소스 지연 로드 ----

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('스크립트 로드 실패: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadCss(href) {
    return new Promise(function (resolve) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = function () { resolve(); };
      l.onerror = function () { resolve(); }; // CSS 실패해도 기능은 동작해야 하므로 막지 않음
      document.head.appendChild(l);
    });
  }

  function ensureDeps() {
    if (depsPromise) return depsPromise;
    var tasks = [];
    if (!global.KRX_MAP) tasks.push(loadScript(KRX_MAP_JS));
    if (!global.ForeignFlow) tasks.push(loadCss(FF_CSS).then(function () { return loadScript(FF_JS); }));
    depsPromise = Promise.all(tasks);
    return depsPromise;
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

  // ---- 종목명/코드 검색 (KRX_MAP 재사용, 기존 위젯들과 동일 패턴) ----

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

  // ---- fetch 유틸 ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error('응답 오류: ' + r.status); return r.json(); })
      .then(function (data) { if (timer) clearTimeout(timer); return data; })
      .catch(function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  // ---- DOM 뼈대 ----

  function buildDom() {
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'sspTrigger';
    trigger.className = 'ssp-trigger';
    trigger.setAttribute('aria-label', '종목검색 열기');
    trigger.innerHTML = '<span class="ssp-trigger-icon">🔍</span><span class="ssp-trigger-label" id="sspTriggerLabel"></span>';
    document.body.appendChild(trigger);

    var overlay = document.createElement('div');
    overlay.id = 'sspOverlay';
    overlay.className = 'ssp-overlay';
    overlay.hidden = true;
    overlay.innerHTML = ''
      + '<div class="ssp-panel" id="sspPanelBox" role="dialog" aria-modal="true" aria-label="종목검색">'
      + '<div class="ssp-panel-header">'
      + '<div class="ssp-input-wrap">'
      + '<input type="text" id="sspInput" class="ssp-input" placeholder="종목명 또는 코드 (예: 삼성전자, 005930)" autocomplete="off" />'
      + '<div id="sspSuggest" class="ssp-suggest"></div>'
      + '</div>'
      + '<button type="button" class="ssp-close-btn" id="sspCloseBtn" aria-label="닫기">✕</button>'
      + '</div>'
      + '<div class="ssp-panel-body" id="sspBody"></div>'
      + '</div>';
    document.body.appendChild(overlay);

    return { trigger: trigger, overlay: overlay };
  }

  // ---- 즐겨찾기/최근검색 칩(초기 화면) ----

  function buildChipsHtml(title, list, emptyText) {
    if (!list.length) return '<div class="ssp-chip-empty">' + emptyText + '</div>';
    return list.map(function (it) {
      return '<button type="button" class="ssp-chip" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '">' + escapeHtml(it.name) + '</button>';
    }).join('');
  }

  function renderHome(body) {
    var favorites = getFavorites();
    var recent = getRecent();
    body.innerHTML = ''
      + '<div class="ssp-home">'
      + '<div class="ssp-home-section"><div class="ssp-home-title">★ 즐겨찾기</div><div class="ssp-chip-row">' + buildChipsHtml('즐겨찾기', favorites, '즐겨찾기한 종목이 없어요. 검색 후 ☆를 눌러 추가해보세요.') + '</div></div>'
      + '<div class="ssp-home-section"><div class="ssp-home-title">최근 검색</div><div class="ssp-chip-row">' + buildChipsHtml('최근검색', recent, '최근 검색한 종목이 없어요.') + '</div></div>'
      + '<div class="ssp-home-hint">종목명이나 코드를 입력해 검색해보세요.</div>'
      + '</div>';

    body.querySelectorAll('.ssp-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectStock(btn.getAttribute('data-code'), btn.getAttribute('data-name'));
      });
    });
  }

  // ---- 자동완성 ----

  function hideSuggest(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    activeIndex = -1;
  }

  function renderSuggest(container, box, query) {
    if (!query || !global.KRX_MAP) { hideSuggest(box); return; }
    var matches = suggestNames(query);
    if (!matches.length) { hideSuggest(box); return; }

    box.innerHTML = matches.map(function (name, i) {
      return '<div class="ssp-suggest-item' + (i === activeIndex ? ' active' : '') + '" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.ssp-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        var stock = resolveStock(name);
        hideSuggest(box);
        if (stock) selectStock(stock.code, stock.name);
      });
    });
  }

  function moveActive(box, delta, query) {
    var matches = suggestNames(query);
    if (!matches.length) return;
    activeIndex = (activeIndex + delta + matches.length) % matches.length;
    renderSuggest(null, box, query);
  }

  // ---- 종목 선택 ----

  function selectStock(code, name) {
    if (!code) return;
    currentCode = code;
    currentName = name || code;
    setLast(code);
    addRecent(code, currentName);
    stopPricePoll();

    var input = document.getElementById('sspInput');
    if (input) input.value = currentName;
    var suggestBox = document.getElementById('sspSuggest');
    if (suggestBox) hideSuggest(suggestBox);

    renderStockView(currentCode, currentName);
    updateTriggerLabel();
  }

  function renderStockView(code, name) {
    var body = document.getElementById('sspBody');
    if (!body) return;
    body.innerHTML = ''
      + '<div class="ssp-stat-header" id="sspStatHeader">'
      + '<div class="ssp-stat-name-row">'
      + '<span class="ssp-stat-name">' + escapeHtml(name) + '</span>'
      + '<span class="ssp-stat-code">(' + escapeHtml(code) + ')</span>'
      + '<button type="button" class="ssp-fav-btn" id="sspFavBtn">' + (isFavorite(code) ? '★' : '☆') + '</button>'
      + '</div>'
      + '<div class="ssp-stat-price-row" id="sspPriceRow"><span class="ssp-stat-price">-</span></div>'
      + '<div class="ssp-stat-grid" id="sspStatGrid">'
      + '<div class="ssp-stat-cell"><span class="ssp-stat-cell-label">시가총액</span><span class="ssp-stat-cell-val" id="sspMarketCap">불러오는 중</span></div>'
      + '<div class="ssp-stat-cell"><span class="ssp-stat-cell-label">거래량</span><span class="ssp-stat-cell-val" id="sspVolume">-</span></div>'
      + '<div class="ssp-stat-cell"><span class="ssp-stat-cell-label">거래대금(추정)</span><span class="ssp-stat-cell-val" id="sspTradeValue">-</span></div>'
      + '</div>'
      + '</div>'
      + '<div class="ssp-ff-mount" id="foreign-flow"><div id="ffResult" class="ff-result"><div class="ff-hint">수급·차트·종합점수를 불러오는 중...</div></div></div>'
      + '<details class="ssp-extra" id="sspPatternBox"><summary>📐 차트 패턴</summary><div class="ssp-extra-body">불러오는 중...</div></details>'
      + '<details class="ssp-extra" id="sspNewsBox" open><summary>📰 종목 뉴스</summary><div class="ssp-extra-body">불러오는 중...</div></details>';

    wireFavBtn(code, name);
    loadPrice(code, true);
    startPricePoll(code);
    loadPatterns(code);
    loadNews(code, name);

    ensureDeps().then(function () {
      var mount = document.getElementById('foreign-flow');
      if (mount && global.ForeignFlow) global.ForeignFlow.search(mount, code);
    }).catch(function () {
      var mount = document.getElementById('foreign-flow');
      if (mount) mount.innerHTML = '<div class="ff-error">수급·차트 위젯을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    });
  }

  function wireFavBtn(code, name) {
    var btn = document.getElementById('sspFavBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var added = toggleFavorite(code, name);
      btn.textContent = added ? '★' : '☆';
    });
  }

  // ---- 기본정보(가격/시총/거래량) ----

  function loadPrice(code, includeFundamentals) {
    fetchJson(GAS_TICKER_URL + '?codes=' + encodeURIComponent(code))
      .then(function (list) {
        var q = (list || [])[0];
        if (q) applyPrice(q);
      })
      .catch(function () { /* 다음 폴링에서 재시도 */ });

    if (includeFundamentals) {
      fetchJson(GAS_TICKER_URL + '?action=fundamentals&code=' + encodeURIComponent(code))
        .then(function (res) {
          var el = document.getElementById('sspMarketCap');
          if (!el) return;
          var cap = res && res.valuation && res.valuation.market_cap_eok;
          el.textContent = cap == null ? '데이터 없음' : fmtEok(cap);
        })
        .catch(function () {
          var el = document.getElementById('sspMarketCap');
          if (el) el.textContent = '데이터 없음';
        });
    }
  }

  function applyPrice(q) {
    var row = document.getElementById('sspPriceRow');
    if (row) {
      var tone = q.change > 0 ? 'ssp-up' : q.change < 0 ? 'ssp-down' : 'ssp-flat';
      var arrow = q.change > 0 ? '▲' : q.change < 0 ? '▼' : '';
      row.innerHTML = '<span class="ssp-stat-price">' + Number(q.price).toLocaleString('ko-KR') + '원</span>'
        + '<span class="ssp-stat-change ' + tone + '">' + arrow + Math.abs(q.changeRate).toFixed(2) + '%</span>';
    }
    var volEl = document.getElementById('sspVolume');
    if (volEl) volEl.textContent = Number(q.volume).toLocaleString('ko-KR');
    var tradeEl = document.getElementById('sspTradeValue');
    if (tradeEl) tradeEl.textContent = fmtWon(Number(q.price) * Number(q.volume));
  }

  function startPricePoll(code) {
    stopPricePoll();
    priceTimer = setInterval(function () {
      if (document.hidden || !panelOpen || currentCode !== code) return;
      loadPrice(code, false);
    }, PRICE_POLL_MS);
  }
  function stopPricePoll() {
    if (priceTimer) { clearInterval(priceTimer); priceTimer = null; }
  }

  // ---- 차트 패턴 (전체 스캔 결과에서 이 종목만 필터) ----

  function fetchPatternScan() {
    if (patternCache && Date.now() - patternCache.t < PATTERN_CACHE_MS) return Promise.resolve(patternCache.data);
    return fetchJson(GAS_TICKER_URL + '?patternScan=1').then(function (data) {
      patternCache = { t: Date.now(), data: data };
      return data;
    });
  }

  function loadPatterns(code) {
    var box = document.getElementById('sspPatternBox');
    if (!box) return;
    var body = box.querySelector('.ssp-extra-body');
    fetchPatternScan()
      .then(function (data) {
        if (currentCode !== code) return; // 그 사이 다른 종목으로 재검색됨
        var patterns = (data && data.patterns) || {};
        var hits = [];
        Object.keys(patterns).forEach(function (key) {
          (patterns[key] || []).forEach(function (it) {
            if (it.code === code) hits.push({ key: key, score: it.score });
          });
        });
        if (!hits.length) {
          body.innerHTML = '<div class="ssp-empty">현재 발견된 차트 패턴이 없어요(70점 이상만 노출).</div>';
          return;
        }
        body.innerHTML = hits.map(function (h) {
          return '<div class="ssp-pattern-row">'
            + '<span class="ssp-pattern-name">✔ ' + (PATTERN_LABELS[h.key] || h.key) + '</span>'
            + '<span class="ssp-pattern-score">' + (h.score != null ? h.score + '점' : '-') + '</span>'
            + '</div>';
        }).join('');
      })
      .catch(function () {
        if (currentCode !== code) return;
        body.innerHTML = '<div class="ssp-empty">패턴 스캔 결과를 불러오지 못했어요.</div>';
      });
  }

  // ---- 뉴스 ----

  function loadNews(code, name) {
    var box = document.getElementById('sspNewsBox');
    if (!box) return;
    var body = box.querySelector('.ssp-extra-body');
    fetchJson(GAS_TICKER_URL + '?news=1&code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name))
      .then(function (res) {
        if (currentCode !== code) return;
        var items = (res && res.items) || [];
        if (!items.length) {
          body.innerHTML = '<div class="ssp-empty">최근 뉴스를 찾지 못했어요.</div>';
          return;
        }
        var aiHtml = res.aiSummary ? '<div class="ssp-news-ai"><b>AI 요약</b> ' + escapeHtml(res.aiSummary) + '</div>' : '';
        var listHtml = items.slice(0, 8).map(function (it) {
          return '<a class="ssp-news-item" href="' + escapeAttr(it.link || '#') + '" target="_blank" rel="noopener">'
            + '<span class="ssp-news-title">' + escapeHtml(it.title || '') + '</span>'
            + '</a>';
        }).join('');
        body.innerHTML = aiHtml + listHtml;
      })
      .catch(function () {
        if (currentCode !== code) return;
        body.innerHTML = '<div class="ssp-empty">뉴스를 불러오지 못했어요.</div>';
      });
  }

  // ---- 트리거 라벨(마지막 조회 종목 복원) ----

  function updateTriggerLabel() {
    var label = document.getElementById('sspTriggerLabel');
    if (!label) return;
    label.textContent = currentName || '';
  }

  function restoreLastSelection() {
    var lastCode = getLast();
    if (!lastCode) return;
    var recent = getRecent();
    var hit = recent.filter(function (it) { return it.code === lastCode; })[0];
    var favorites = getFavorites();
    var favHit = !hit ? favorites.filter(function (it) { return it.code === lastCode; })[0] : null;
    var name = (hit && hit.name) || (favHit && favHit.name) || lastCode;
    currentCode = lastCode;
    currentName = name;
    updateTriggerLabel();
  }

  // ---- 패널 열기/닫기 ----

  function openPanel() {
    var overlay = document.getElementById('sspOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    panelOpen = true;
    document.body.classList.add('ssp-lock-scroll');

    ensureDeps().catch(function () { /* 자동완성/전체기능이 늦게 뜰 뿐, 조용히 무시 */ });

    var body = document.getElementById('sspBody');
    if (currentCode) {
      renderStockView(currentCode, currentName);
    } else {
      renderHome(body);
    }

    var input = document.getElementById('sspInput');
    if (input) { input.value = currentCode ? currentName : ''; setTimeout(function () { input.focus(); }, 0); }
  }

  function closePanel() {
    var overlay = document.getElementById('sspOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    panelOpen = false;
    document.body.classList.remove('ssp-lock-scroll');
    stopPricePoll();
  }

  // ---- 이벤트 바인딩 ----

  function wireEvents(dom) {
    dom.trigger.addEventListener('click', function () {
      if (panelOpen) closePanel(); else openPanel();
    });

    document.getElementById('sspCloseBtn').addEventListener('click', closePanel);
    dom.overlay.addEventListener('click', function (e) {
      if (e.target === dom.overlay) closePanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) closePanel();
    });

    var input = document.getElementById('sspInput');
    var suggestBox = document.getElementById('sspSuggest');

    input.addEventListener('input', function () {
      ensureDeps().then(function () { renderSuggest(null, suggestBox, input.value.trim()); });
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
        if (stock) selectStock(stock.code, stock.name);
      } else if (e.key === 'Escape') {
        hideSuggest(suggestBox);
      }
    });
  }

  // ---- 포맷 유틸 ----

  function fmtEok(eok) {
    if (eok == null || isNaN(eok)) return '데이터 없음';
    if (Math.abs(eok) >= 10000) return (eok / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '조원';
    return Math.round(eok).toLocaleString('ko-KR') + '억원';
  }
  function fmtWon(v) {
    if (v == null || isNaN(v)) return '-';
    var abs = Math.abs(v);
    if (abs >= 1e12) return (v / 1e12).toFixed(2) + '조원';
    if (abs >= 1e8) return Math.round(v / 1e8).toLocaleString('ko-KR') + '억원';
    if (abs >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만원';
    return Math.round(v).toLocaleString('ko-KR') + '원';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---- 초기화 ----

  function init() {
    var dom = buildDom();
    wireEvents(dom);
    restoreLastSelection();
  }

  var StockSearchPanel = { init: init, openPanel: openPanel, closePanel: closePanel, selectStock: selectStock };
  global.StockSearchPanel = StockSearchPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
