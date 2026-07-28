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
      var items = suggestBox.querySelectorAll('.sn-suggest-item');
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
        var picked = idx > -1 && items[idx] ? items[idx].getAttribute('data-name') : input.value.trim();
        if (idx > -1 && items[idx]) input.value = picked;
        hideSuggestions(suggestBox);
        addAndSelect(container, picked);
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
    box.__activeIndex = -1;
  }

  // 키보드(위/아래 화살표)로 자동완성 항목 탐색 - box.__activeIndex에 현재 위치 저장
  function getActiveSuggestion(box) {
    return typeof box.__activeIndex === 'number' ? box.__activeIndex : -1;
  }
  function setActiveSuggestion(box, items, idx) {
    items.forEach(function (el) { el.classList.remove('active'); });
    box.__activeIndex = idx;
    var el = items[idx];
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
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

  function renderSuggestions(box, query) {
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
      return '<div class="sn-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');
    box.__activeIndex = -1;

    box.querySelectorAll('.sn-suggest-item').forEach(function (el, i) {
      el.addEventListener('mouseenter', function () {
        setActiveSuggestion(box, box.querySelectorAll('.sn-suggest-item'), i);
      });
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

  // 2026-07-27: "9Pay 증권" 개편 작업지시서 #10 - 텍스트 위주 나열형을 네이버 증권
  // 뉴스·리서치 탭처럼 "큰 사진 1개 + 헤드라인 리스트" 상단 + 카드형 그리드 하단으로
  // 재구성. 데이터(title/body/press/datetime/image/link)는 그대로라 GAS 변경은 불필요 -
  // 이미 모든 뉴스 항목에 image 필드가 내려오고 있어(renderNews 원본 코드) 프론트
  // 레이아웃만 바꾸면 된다.
  var FEATURED_COUNT = 1;
  var HEADLINE_COUNT = 4;

  // item.datetime 형식 "YYYYMMDDHHmm" 기준 오늘 날짜(YYYYMMDD) - 로컬 타임존 사용(국내
  // 종목 뉴스라 KST 사용자 기준으로 충분, 사이트 다른 날짜 로직도 별도 KST 변환 없음).
  function todayYyyymmdd() {
    var d = new Date();
    return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function renderNews(box, stock, data) {
    // GAS 캐시 갱신 전환기에는 옛날 응답 형태(배열)가 아직 캐시에 남아있을 수 있어
    // 신/구 형태를 둘 다 받아준다.
    var list = Array.isArray(data) ? data : ((data && data.items) || []);

    // 2026-07-28 사용자 요청: 오늘 뉴스만 출력(예전 뉴스가 계속 섞여 나와 최신성이 떨어짐).
    var today = todayYyyymmdd();
    list = list.filter(function (item) { return item.datetime && item.datetime.slice(0, 8) === today; });

    if (!list.length) {
      box.innerHTML = '<div class="sn-error">' + escapeHtml(stock.name) + '에 대한 오늘 뉴스가 아직 없어요.</div>';
      return;
    }

    var html = '<div class="sn-result-header">' + escapeHtml(stock.name)
      + ' <span class="sn-result-code">(' + escapeHtml(stock.code) + ')</span> 관련 뉴스</div>';

    html += buildSectorTags(stock.code);

    // AI 요약(Groq) - null이면(키 없음/레이트리밋/네트워크 오류) 박스 없이 뉴스만 표시
    var aiSummary = !Array.isArray(data) && data && data.aiSummary;
    if (aiSummary) {
      html += '<div class="sn-ai-summary">'
        + '<span class="sn-ai-badge">요약</span>'
        + '<p class="sn-ai-text">' + escapeHtml(aiSummary) + '</p>'
        + '</div>';
    }

    var featured = list.slice(0, FEATURED_COUNT);
    var headlines = list.slice(FEATURED_COUNT, FEATURED_COUNT + HEADLINE_COUNT);
    var rest = list.slice(FEATURED_COUNT + HEADLINE_COUNT);

    if (featured.length) {
      html += '<div class="sn-news-top">';
      html += featured.map(function (item, idx) { return buildFeaturedCard(item, idx); }).join('');
      if (headlines.length) {
        html += '<div class="sn-news-headlines">' + headlines.map(function (item, idx) {
          return buildHeadlineItem(item, idx + FEATURED_COUNT);
        }).join('') + '</div>';
      }
      html += '</div>';
    }

    if (rest.length) {
      html += '<div class="sn-news-grid">' + rest.map(function (item, idx) {
        return buildGridCard(item, idx + FEATURED_COUNT + HEADLINE_COUNT);
      }).join('') + '</div>';
    }

    box.innerHTML = html;

    box.querySelectorAll('[data-idx]').forEach(function (el) {
      el.addEventListener('click', function () {
        openNewsModal(list[Number(el.getAttribute('data-idx'))]);
      });
    });
  }

  // 2026-07-28 사용자 요청: "작은 미리보기(사진)+제목만 있어도 충분하다" - 큰 카드에만
  // 있던 본문 스니펫(sn-news-snippet)을 빼서 헤드라인/그리드 카드와 동일하게 사진+제목+
  // 출처/시각만 보여주도록 통일.
  function buildFeaturedCard(item, idx) {
    // 미리보기 이미지가 없으면 빈 회색 박스를 그리지 않고 제목만 보여준다
    // (사용자 피드백 "미리보기 없으면 그냥 글만 보여줘" - 위젯 전체 개편 전 임시 조치).
    return '<div class="sn-news-featured' + (item.image ? '' : ' sn-news-no-thumb') + '" data-idx="' + idx + '">'
      + (item.image
        ? '<img class="sn-news-featured-img" src="' + escapeAttr(item.image) + '" alt="" loading="lazy" />'
        : '')
      + '<div class="sn-news-featured-body">'
      + '<div class="sn-news-featured-title">' + escapeHtml(item.title) + '</div>'
      + '<div class="sn-news-meta"><span class="sn-news-press">' + escapeHtml(item.press) + '</span>'
      + '<span class="sn-news-time">' + formatDatetime(item.datetime) + '</span></div>'
      + '</div>'
      + '</div>';
  }

  function buildHeadlineItem(item, idx) {
    return '<div class="sn-news-headline-item' + (item.image ? '' : ' sn-news-no-thumb') + '" data-idx="' + idx + '">'
      + (item.image
        ? '<img class="sn-news-headline-thumb" src="' + escapeAttr(item.image) + '" alt="" loading="lazy" />'
        : '')
      + '<div class="sn-news-headline-body">'
      + '<div class="sn-news-headline-title">' + escapeHtml(item.title) + '</div>'
      + '<div class="sn-news-meta"><span class="sn-news-press">' + escapeHtml(item.press) + '</span>'
      + '<span class="sn-news-time">' + formatDatetime(item.datetime) + '</span></div>'
      + '</div>'
      + '</div>';
  }

  function buildGridCard(item, idx) {
    return '<div class="sn-news-grid-item' + (item.image ? '' : ' sn-news-no-thumb') + '" data-idx="' + idx + '">'
      + (item.image
        ? '<img class="sn-news-grid-thumb" src="' + escapeAttr(item.image) + '" alt="" loading="lazy" />'
        : '')
      + '<div class="sn-news-grid-title">' + escapeHtml(item.title) + '</div>'
      + '<div class="sn-news-meta"><span class="sn-news-press">' + escapeHtml(item.press) + '</span>'
      + '<span class="sn-news-time">' + formatDatetime(item.datetime) + '</span></div>'
      + '</div>';
  }

  // 작업지시서는 "반도체/AI/바이오/자동차/금융" 같은 고정 5개 카테고리를 예시로 들었지만
  // 종목뉴스는 종목 하나를 고르는 화면이라 뉴스 자체를 카테고리로 나눌 대상이 없다 -
  // 대신 이미 있는 실제 섹터 분류(data/sectors-v3.js, 37개 섹터)에서 이 종목이 속한
  // 섹터를 찾아 태그로 보여준다(고정 5개보다 정확함). 그 파일이 이 페이지에 없으면
  // (기본 test/stock-news.html·기존 운영 페이지엔 krx_map.js만 로드) 조용히 생략 -
  // 실제 반영하려면 티스토리 /page/stock-news 편집 화면에 아래 한 줄을 추가해야 한다:
  // <script src="https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js"></script>
  function buildSectorTags(code) {
    var map = global.SECTOR_MAP;
    if (!map || !code) return '';
    var sectors = [];
    for (var sector in map) {
      if (!map.hasOwnProperty(sector)) continue;
      var found = map[sector].some(function (s) { return s.code === code; });
      if (found) sectors.push(sector);
    }
    if (!sectors.length) return '';
    return '<div class="sn-sector-tags">' + sectors.map(function (s) {
      return '<span class="sn-sector-tag">' + escapeHtml(s) + '</span>';
    }).join('') + '</div>';
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
