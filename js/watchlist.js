/**
 * 관심종목 카드 위젯
 * 로그인 없이 localStorage에 저장(코드+이름, 최대 50개, 순서 보존 배열).
 * 종목명 검색(KRX_MAP 자동완성, foreign-flow.js와 동일 패턴)으로 추가하고,
 * 기존 GAS 시세 프록시(?codes=)를 그대로 재사용해 카드에 현재가/등락률을 채운다.
 * 카드 클릭 시 네이버 금융 종목 페이지로 이동(ticker-tooltip-v5.js의 NAVER_ITEM_URL과 동일 목적지).
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * data-code 속성을 순서대로 유지해두어 향후 Drag & Drop으로 순서 변경을 붙이기 쉽게 해둔다.
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

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
    render(container);
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

  function addByQuery(container, query) {
    var stock = resolveStock(query);
    var input = container.querySelector('#wlInput');
    if (!stock) {
      showMsg(container, '종목을 찾을 수 없습니다: "' + query + '"');
      return;
    }

    var list = loadList();
    if (list.some(function (it) { return it.code === stock.code; })) {
      showMsg(container, stock.name + '은(는) 이미 관심종목에 있습니다.');
      input.value = '';
      return;
    }
    if (list.length >= MAX_ITEMS) {
      showMsg(container, '관심종목은 최대 ' + MAX_ITEMS + '개까지 담을 수 있습니다.');
      return;
    }

    list.push({ code: stock.code, name: stock.name });
    saveList(list);
    input.value = '';
    hideMsg(container);
    render(container);
  }

  function removeCode(container, code) {
    var list = loadList().filter(function (it) { return it.code !== code; });
    saveList(list);
    render(container);
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
        // 시세 조회 실패 - 카드는 이름/코드만 표시된 상태로 유지 (원문 유지 원칙과 동일)
      });
  }

  function buildCard(code, name) {
    return ''
      + '<div class="wl-card" data-code="' + escapeAttr(code) + '">'
      + '<button type="button" class="wl-remove" data-code="' + escapeAttr(code) + '" aria-label="관심종목 삭제">★</button>'
      + '<div class="wl-name">' + escapeHtml(name) + '</div>'
      + '<div class="wl-price" data-field="price">-</div>'
      + '<div class="wl-change" data-field="change">-</div>'
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
    changeEl.classList.remove('wl-up', 'wl-down');
    changeEl.classList.add(quote.change > 0 ? 'wl-up' : quote.change < 0 ? 'wl-down' : '');
  }

  function wireCardEvents(container) {
    container.querySelectorAll('.wl-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeCode(container, btn.getAttribute('data-code'));
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
    MAX_ITEMS: MAX_ITEMS
  };
  global.Watchlist = Watchlist;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
