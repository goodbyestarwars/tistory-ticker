/**
 * 종목 뉴스
 * 좌측 "관심종목" 고정 리스트(+검색으로 추가한 종목) + 우측 선택 종목 뉴스.
 * 관심종목 리스트: /notice/1257 "7월 관심종목" 공지 기준 11종목.
 * 검색으로 추가한 종목은 이 브라우저의 localStorage에만 저장됨(기기별로 다를 수 있음).
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * 시세는 GAS 프록시의 기존 ?codes= 엔드포인트, 뉴스는 신규 ?news=1&code= 엔드포인트를 사용.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#stock-news';
  var FETCH_TIMEOUT_MS = 15000; // 뉴스 조회 + Groq AI 요약까지 순차로 도는 GAS 응답이라 여유 있게
  var MAX_SUGGESTIONS = 8;
  var STORAGE_KEY = 'stock-news-extra-v1';
  var REMOVED_STORAGE_KEY = 'stock-news-removed-v1';
  var RANK_OPEN_KEY = 'stock-news-rank-open-v1';
  var RANK_REFRESH_MS = 30 * 60 * 1000; // 30분

  var WATCHLIST_NAMES = [
    '비에이치아이', '에코프로비엠', 'NAVER', '현대차', '한화오션',
    'LG전자', 'HD현대일렉트릭', '삼성전자', 'KB금융', '키움증권', '에이비엘바이오'
  ];

  // 렌더링 중 현재 리스트/선택 상태 (재검색·재클릭 시 재사용)
  var stocksState = [];
  var selectedCode = null;
  var rankLoaded = false;

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
    wireRankBox(container);

    stocksState = buildWatchlist();
    renderWatchlist(container);
    loadPrices(container);

    if (stocksState.length) selectStock(container, stocksState[0]);

    setInterval(function () {
      var box = container.querySelector('#snRank');
      if (box && box.open) loadRankNews(container, true);
    }, RANK_REFRESH_MS);
  }

  function buildShell() {
    return ''
      + '<details class="sn-rank" id="snRank">'
      + '<summary class="sn-rank-summary">랭킹뉴스 · 증시·코스피·코스닥 헤드라인 TOP 10'
      + '<span class="sn-rank-hint"><span class="sn-rank-closed">펼치기 ▾</span><span class="sn-rank-open-t">접기 ▴</span></span>'
      + '</summary>'
      + '<div class="sn-rank-grid" id="snRankGrid"><div class="sn-hint">펼치면 불러와요.</div></div>'
      + '</details>'
      + '<div class="stock-news-search">'
      + '<div class="sn-input-wrap">'
      + '<input type="text" id="snInput" class="sn-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="snSuggest" class="sn-suggest"></div>'
      + '</div>'
      + '<button type="button" id="snSearchBtn" class="sn-search-btn">검색</button>'
      + '</div>'
      + '<div class="sn-layout">'
      + '<div class="sn-watchlist" id="snWatchlist"></div>'
      + '<div class="sn-main"><div id="snResult"><div class="sn-hint">관심종목을 클릭하거나, 종목명을 검색해보세요.</div></div></div>'
      + '</div>';
  }

  // ---- 관심종목 리스트 ----

  function loadExtra() {
    try { return JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveExtra(names) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(names)); } catch (e) { /* localStorage 불가 환경은 무시 */ }
  }

  // 디폴트 관심종목은 코드에 하드코딩돼 있어 직접 지울 수 없으니, "뺀 종목 이름"만 따로 저장해 걸러낸다.
  function loadRemoved() {
    try { return JSON.parse(global.localStorage.getItem(REMOVED_STORAGE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveRemoved(names) {
    try { global.localStorage.setItem(REMOVED_STORAGE_KEY, JSON.stringify(names)); } catch (e) { /* localStorage 불가 환경은 무시 */ }
  }

  function buildWatchlist() {
    var map = global.KRX_MAP || {};
    var removed = loadRemoved();
    var defaults = WATCHLIST_NAMES.filter(function (n) { return removed.indexOf(n) === -1; });
    var extra = loadExtra().filter(function (n) { return WATCHLIST_NAMES.indexOf(n) === -1; });
    var names = defaults.concat(extra);
    return names
      .map(function (name) { return { name: name, code: map[name] || null, price: null, change: null, changeRate: null }; })
      .filter(function (s) { return s.code; });
  }

  function renderWatchlist(container) {
    var box = container.querySelector('#snWatchlist');
    if (!box) return;
    box.innerHTML = stocksState.map(function (s) {
      var dir = directionClass(s.change);
      var priceHtml = s.price == null
        ? '<span class="sn-wl-loading">…</span>'
        : '<span class="sn-wl-price">' + Number(s.price).toLocaleString() + '</span>'
          + '<span class="sn-wl-rate ' + dir + '">' + formatRate(s.changeRate) + '</span>';
      return '<div class="sn-wl-item' + (s.code === selectedCode ? ' active' : '') + '" data-code="' + s.code + '">'
        + '<span class="sn-wl-name">' + escapeHtml(s.name) + '</span>'
        + '<span class="sn-wl-quote">' + priceHtml + '</span>'
        + '<button type="button" class="sn-wl-remove" data-code="' + s.code + '" title="목록에서 빼기">×</button>'
        + '</div>';
    }).join('');

    box.querySelectorAll('.sn-wl-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var code = el.getAttribute('data-code');
        var stock = stocksState.filter(function (s) { return s.code === code; })[0];
        if (stock) selectStock(container, stock);
      });
    });

    box.querySelectorAll('.sn-wl-remove').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var code = el.getAttribute('data-code');
        var stock = stocksState.filter(function (s) { return s.code === code; })[0];
        if (stock) removeStock(container, stock);
      });
    });
  }

  function removeStock(container, stock) {
    stocksState = stocksState.filter(function (s) { return s.code !== stock.code; });

    if (WATCHLIST_NAMES.indexOf(stock.name) > -1) {
      var removed = loadRemoved();
      if (removed.indexOf(stock.name) === -1) {
        removed.push(stock.name);
        saveRemoved(removed);
      }
    } else {
      var extra = loadExtra().filter(function (n) { return n !== stock.name; });
      saveExtra(extra);
    }

    if (selectedCode === stock.code) {
      selectedCode = null;
      var resultBox = container.querySelector('#snResult');
      if (stocksState.length) {
        selectStock(container, stocksState[0]);
      } else if (resultBox) {
        resultBox.innerHTML = '<div class="sn-hint">관심종목을 클릭하거나, 종목명을 검색해보세요.</div>';
      }
    }

    renderWatchlist(container);
  }

  function directionClass(change) {
    if (change > 0) return 'sn-up';
    if (change < 0) return 'sn-down';
    return 'sn-flat';
  }

  function formatRate(rate) {
    if (rate == null) return '';
    var sign = rate > 0 ? '+' : '';
    return sign + Number(rate).toFixed(2) + '%';
  }

  function loadPrices(container) {
    var codes = stocksState.map(function (s) { return s.code; });
    if (!codes.length) return;

    fetchJson(GAS_TICKER_URL + '?codes=' + codes.join(','))
      .then(function (list) {
        var byCode = {};
        (list || []).forEach(function (d) { byCode[d.code] = d; });
        stocksState.forEach(function (s) {
          var d = byCode[s.code];
          if (d) { s.price = d.price; s.change = d.change; s.changeRate = d.changeRate; }
        });
        renderWatchlist(container);
      })
      .catch(function () { /* 시세 실패해도 리스트/뉴스 기능은 그대로 동작 */ });
  }

  // ---- 랭킹뉴스 (접이식, 펼칠 때 로드 + 30분 자동 갱신) ----

  function wireRankBox(container) {
    var box = container.querySelector('#snRank');
    if (!box) return;

    try { if (global.localStorage.getItem(RANK_OPEN_KEY) === '1') box.open = true; } catch (e) { /* ignore */ }
    if (box.open) loadRankNews(container, false);

    box.addEventListener('toggle', function () {
      if (box.open) loadRankNews(container, false);
      try { global.localStorage.setItem(RANK_OPEN_KEY, box.open ? '1' : '0'); } catch (e) { /* ignore */ }
    });
  }

  function loadRankNews(container, force) {
    if (rankLoaded && !force) return;
    var grid = container.querySelector('#snRankGrid');
    if (!grid) return;
    if (!force) grid.innerHTML = '<div class="sn-hint">헤드라인을 불러오는 중...</div>';

    fetchJson(GAS_TICKER_URL + '?rankNews=1')
      .then(function (data) {
        renderRankNews(grid, data);
        rankLoaded = true;
      })
      .catch(function () {
        if (!rankLoaded) grid.innerHTML = '<div class="sn-error">헤드라인을 불러오지 못했어요.</div>';
      });
  }

  function renderRankNews(grid, data) {
    var items = (data && data.items) || [];
    if (!items.length) {
      grid.innerHTML = '<div class="sn-error">헤드라인이 없어요.</div>';
      return;
    }
    grid.innerHTML = items.map(function (it, idx) {
      return '<a class="sn-rank-item" href="' + escapeAttr(it.link) + '" target="_blank" rel="noopener">'
        + '<span class="sn-rank-num">' + (idx + 1) + '</span>'
        + '<span class="sn-rank-body">'
        + '<span class="sn-rank-title">' + escapeHtml(it.title) + '</span>'
        + '<span class="sn-rank-date">' + formatPubDate(it.pubDate) + '</span>'
        + '</span>'
        + '</a>';
    }).join('');
  }

  function formatPubDate(raw) {
    if (!raw) return '';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return mm + '.' + dd + ' ' + hh + ':' + mi;
  }

  // ---- 검색/자동완성 ----

  function wireEvents(container) {
    var input = container.querySelector('#snInput');
    var suggestBox = container.querySelector('#snSuggest');
    var btn = container.querySelector('#snSearchBtn');

    input.addEventListener('input', function () {
      renderSuggestions(suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions(suggestBox);
        addAndSelect(container, input.value.trim());
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    btn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      addAndSelect(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
  }

  function renderSuggestions(box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    var starts = [];
    var contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) {
        if (starts.length < MAX_SUGGESTIONS) starts.push(name);
      } else if (lower.indexOf(q) > -1) {
        if (contains.length < MAX_SUGGESTIONS) contains.push(name);
      }
    }
    var matches = starts.concat(contains).slice(0, MAX_SUGGESTIONS);

    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="sn-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.sn-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var container = document.querySelector(CONTAINER_SELECTOR);
        var input = container.querySelector('#snInput');
        var name = el.getAttribute('data-name');
        input.value = name;
        hideSuggestions(box);
        addAndSelect(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name } 변환. 정확일치 우선, 없으면 부분일치가 1개일 때만 사용.
  function resolveStock(query) {
    if (!query) return null;
    if (/^\d{6}$/.test(query)) return { code: query, name: query };

    var map = global.KRX_MAP || {};
    if (map[query]) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var found = null;
    var count = 0;
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      if (name.toLowerCase().indexOf(q) > -1) {
        found = name;
        count++;
        if (count > 1) break;
      }
    }
    return count === 1 ? { code: map[found], name: found } : null;
  }

  function addAndSelect(container, query) {
    var resolved = resolveStock(query);
    if (!resolved) {
      var resultBox = container.querySelector('#snResult');
      resultBox.innerHTML = '<div class="sn-error">'
        + (query ? '"' + escapeHtml(query) + '" 종목을 찾을 수 없어요. 정확한 종목명을 입력해보세요.' : '종목명을 입력해주세요.')
        + '</div>';
      return;
    }

    var input = container.querySelector('#snInput');
    input.value = '';

    var existing = stocksState.filter(function (s) { return s.code === resolved.code; })[0];
    if (existing) {
      selectStock(container, existing);
      return;
    }

    var stock = { name: resolved.name, code: resolved.code, price: null, change: null, changeRate: null };
    stocksState.push(stock);

    // 기본 11종목이 아닌 항목만 localStorage에 저장 (원래 관심종목은 항상 코드에서 다시 만들어짐)
    if (WATCHLIST_NAMES.indexOf(resolved.name) === -1) {
      var extra = loadExtra();
      if (extra.indexOf(resolved.name) === -1) {
        extra.push(resolved.name);
        saveExtra(extra);
      }
    } else {
      // 기본 종목을 ×로 뺐다가 검색으로 다시 추가한 경우, "제거됨" 표시를 풀어줘야
      // 새로고침 후에도 유지된다. 안 그러면 이번 화면에서만 보이고 다시 사라진다.
      var removed = loadRemoved();
      var removedIdx = removed.indexOf(resolved.name);
      if (removedIdx > -1) {
        removed.splice(removedIdx, 1);
        saveRemoved(removed);
      }
    }

    renderWatchlist(container);
    loadPrices(container);
    selectStock(container, stock);
  }

  // ---- 선택된 종목 뉴스 ----

  function selectStock(container, stock) {
    selectedCode = stock.code;
    renderWatchlist(container);

    var resultBox = container.querySelector('#snResult');
    resultBox.innerHTML = '<div class="sn-loading">' + escapeHtml(stock.name) + ' 관련 뉴스를 불러오는 중...</div>';

    fetchJson(GAS_TICKER_URL + '?news=1&code=' + encodeURIComponent(stock.code) + '&name=' + encodeURIComponent(stock.name))
      .then(function (data) { renderNews(resultBox, stock, data); })
      .catch(function () {
        resultBox.innerHTML = '<div class="sn-error">뉴스를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function renderNews(box, stock, data) {
    // GAS 캐시 갱신 전환기에는 옛날 응답 형태(배열)가 아직 캐시에 남아있을 수 있어
    // 신/구 형태를 둘 다 받아준다.
    var list = Array.isArray(data) ? data : ((data && data.items) || []);

    if (!list.length) {
      box.innerHTML = '<div class="sn-error">' + escapeHtml(stock.name) + '에 대한 최근 뉴스가 없어요.</div>';
      return;
    }

    var html = '<div class="sn-result-header">' + escapeHtml(stock.name)
      + ' <span class="sn-result-code">(' + escapeHtml(stock.code) + ')</span> 관련 뉴스</div>';

    // AI 요약(Groq) - null이면(키 없음/레이트리밋/네트워크 오류) 박스 없이 뉴스만 표시
    var aiSummary = !Array.isArray(data) && data && data.aiSummary;
    if (aiSummary) {
      html += '<div class="sn-ai-summary">'
        + '<span class="sn-ai-badge">AI요약 (Groq)</span>'
        + '<p class="sn-ai-text">' + escapeHtml(aiSummary) + '</p>'
        + '</div>';
    }

    html += '<div class="sn-news-list">';

    list.forEach(function (item, idx) {
      html += '<div class="sn-news-item" data-idx="' + idx + '">'
        + (item.image
          ? '<img class="sn-news-thumb" src="' + escapeAttr(item.image) + '" alt="" loading="lazy" />'
          : '<div class="sn-news-thumb sn-news-thumb-empty"></div>')
        + '<div class="sn-news-body">'
        + '<div class="sn-news-title">' + escapeHtml(item.title) + '</div>'
        + '<div class="sn-news-snippet">' + escapeHtml(item.body) + '</div>'
        + '<div class="sn-news-meta"><span class="sn-news-press">' + escapeHtml(item.press) + '</span>'
        + '<span class="sn-news-time">' + formatDatetime(item.datetime) + '</span></div>'
        + '</div>'
        + '</div>';
    });

    html += '</div>';
    box.innerHTML = html;

    box.querySelectorAll('.sn-news-item').forEach(function (el) {
      el.addEventListener('click', function () {
        openNewsModal(list[Number(el.getAttribute('data-idx'))]);
      });
    });
  }

  function formatDatetime(raw) {
    // "202607051309" -> "07/05 13:09"
    if (!raw || raw.length < 12) return '';
    return raw.slice(4, 6) + '/' + raw.slice(6, 8) + ' ' + raw.slice(8, 10) + ':' + raw.slice(10, 12);
  }

  function openNewsModal(item) {
    if (!item) return;
    closeNewsModal();

    var m = document.createElement('div');
    m.id = 'sn-modal';
    m.innerHTML = '<div class="sn-modal-overlay"></div>'
      + '<div class="sn-modal-card">'
      + '<div class="sn-modal-header">'
      + '<span class="sn-modal-title">' + escapeHtml(item.title) + '</span>'
      + '<button type="button" class="sn-modal-close" id="snModalClose">✕</button>'
      + '</div>'
      + '<div class="sn-modal-meta">' + escapeHtml(item.press) + ' · ' + formatDatetime(item.datetime) + '</div>'
      + (item.image ? '<img class="sn-modal-img" src="' + escapeAttr(item.image) + '" alt="" />' : '')
      + '<div class="sn-modal-body">' + escapeHtml(item.body) + '</div>'
      + '<a class="sn-modal-link" href="' + escapeAttr(item.link) + '" target="_blank" rel="noopener">네이버 뉴스에서 원문 보기 ↗</a>'
      + '</div>';

    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    m.querySelector('.sn-modal-overlay').onclick = closeNewsModal;
    document.getElementById('snModalClose').onclick = closeNewsModal;
  }

  function closeNewsModal() {
    var m = document.getElementById('sn-modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeNewsModal();
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.StockNews = { init: init };
})(window);
