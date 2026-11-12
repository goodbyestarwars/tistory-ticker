/**
 * 비회원 전용 홈 (2026-11-12, 2026-11-11 회원 화면과 같은 컴포넌트로 통일).
 *
 * 관리자가 아닌 입장(비회원 입장·로그인했지만 관리자 아닌 계정)의 `/`는 전체 대시보드 대신
 * 지금 주목할 뉴스 + 마켓브리핑 + 이야기 시리즈를 보여 준다. js/access-gate.js 가 NineAccess.run 으로 skin-main 의
 * 대시보드 코드를 막으므로 실시간 위젯·시세 요청은 시작되지 않는다(여기서도 시작하지 않는다).
 *
 * 재사용(복제 금지) - 모양·글꼴·넘김 화살표는 회원 대시보드와 같은 컴포넌트가 그린다:
 *  - 마켓브리핑: skin-main 의 NineHomeBriefing(같은 마크업·SiteInteractions.carousel)과 대시보드 래퍼 클래스
 *    (.home-dashboard.home-editorial-page > .home-widget-grid)를 그대로 써서 style.css 규칙이 동일하게 적용된다.
 *    카드는 티스토리 피드의 .post-card(data-cat='마켓 브리핑'). 홈 피드에 부족하면 /category/마켓 브리핑 을 읽어온다.
 *  - 이야기 시리즈·법적 링크·회사 정보: skin-shell 이 그린 원본 푸터(.site-footer)를 손대지 않는다.
 *  - 지금 주목할 뉴스(타임라인): js/main-news.js 의 MainNews(조회·정렬·언론사명·제목·시각)를 재사용한다. 이미지·시세 요청 없음.
 *  - 이 파일과 css/guest-home.css 는 비회원 전용 차이(빈 사이드바 숨김·뉴스 타임라인 배치)만 가진다.
 */
(function (global) {
  'use strict';
  if (global.NineGuestHome) return;
  var doc = global.document;
  var CATEGORY = '마켓 브리핑';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/guest-home.css?v=20261112-guest-timeline-v2';
  var mounted = false;

  function injectCss() {
    if (doc.querySelector('link[data-guest-home-css]')) return;
    var link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    link.setAttribute('data-guest-home-css', '1');
    (doc.head || doc.documentElement).appendChild(link);
  }

  function cardsOf(root) {
    return Array.prototype.slice.call(root.querySelectorAll('.post-card:not(.notice-card)'));
  }
  function isBriefing(card) { return card.getAttribute('data-cat') === CATEGORY; }

  /* 홈 피드에 마켓브리핑 글이 부족하면 카테고리 목록 페이지에서 같은 카드를 읽어 온다. */
  function fetchCategoryCards() {
    var url = '/category/' + encodeURIComponent(CATEGORY);
    return global.fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('category ' + r.status); return r.text(); })
      .then(function (html) {
        var parsed = new global.DOMParser().parseFromString(html, 'text/html');
        return cardsOf(parsed).map(function (card) { return doc.importNode(card, true); });
      });
  }

  /* skin-main 이 아직 실행 전이면(드묾) 공용 빌더를 잠시 기다린다. 끝내 없으면 안내 문구. */
  function fillBriefing(grid, cards, tries) {
    var shared = global.NineHomeBriefing;
    if (!shared) {
      if (tries > 0) { global.setTimeout(function () { fillBriefing(grid, cards, tries - 1); }, 250); return; }
      cards = [];
    }
    if (!cards.length) {
      grid.innerHTML = '<div class="home-card-state">최신 마켓브리핑을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</div>';
      return;
    }
    var section = shared.build(cards.slice(0, 8));
    section.classList.add('home-widget', 'home-widget--full');
    grid.innerHTML = '';
    grid.appendChild(section);
    shared.initCarousel(section);
  }

  /* ───── 지금 주목할 뉴스(텍스트 타임라인) ─────
     최근 24시간·발행시각이 확인된 기사 전부(기존 API 시장별 최대 25건)를 중복 없이 최신순으로 정렬한다.
     첫 화면은 6건이지만 페이지 버튼으로 나머지도 열람한다. 중요도·시장별 인위적인 쿼터는 만들지 않는다. */
  var NEWS_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/main-news.js?v=20261112-guest-timeline';
  var NEWS_PAGE_SIZE = 6;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var MARKET_LABEL = { kr: '국내', us: '미국' };

  function esc(value) { return global.NineUI.escapeHtml(value); }

  function loadMainNews() {
    if (global.MainNews && global.MainNews.urls) return Promise.resolve(global.MainNews);
    return new Promise(function (resolve, reject) {
      var tag = doc.createElement('script');
      tag.src = NEWS_SCRIPT_URL;
      tag.onload = function () { if (global.MainNews && global.MainNews.urls) resolve(global.MainNews); else reject(new Error('main-news')); };
      tag.onerror = function () { reject(new Error('main-news')); };
      (doc.head || doc.documentElement).appendChild(tag);
    });
  }

  function relativeLabel(ms, now) {
    var minutes = Math.max(0, Math.round((now - ms) / 60000));
    if (minutes < 1) return '방금';
    if (minutes < 60) return minutes + '분 전';
    return Math.floor(minutes / 60) + '시간 전';
  }

  function pickNews(M, lists, now) {
    var seen = {};
    var collected = [];
    Object.keys(lists).forEach(function (market) {
      (lists[market] || []).forEach(function (item) {
        item._market = market;
        collected.push(item);
      });
    });
    // 시장별 2건 같은 선할당 없이 두 시장을 실제 발행시각 기준으로 합친다.
    collected.sort(function (a, b) { return M.dateValue(b.pubDate) - M.dateValue(a.pubDate); });
    return collected.filter(function (item) {
      var at = M.dateValue(item.pubDate);
      var link = M.safeHref(item.link);
      var title = M.displayTitle(item);
      if (!at || at > now + 5 * 60000 || now - at > DAY_MS || !link || !title) return false;
      var key = title.replace(/\s+/g, '').toLowerCase();
      if (seen[link] || seen[key]) return false;
      seen[link] = seen[key] = true;
      return true;
    });
  }


  /* 뉴스 제목에 직접 등장한 상장사만 표시한다. '테마 연관주' 추측이나 시세 조회는 하지 않는다. */
  var stockCatalog = null, stockCatalogMap = null, stockCatalogPanel = null;
  var STOCK_MAP_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';

  function loadStockCatalog() {
    if (global.KRX_MAP) return Promise.resolve();
    return new Promise(function (resolve) {
      var tag = doc.querySelector('script[src*="/data/krx_map.js"]');
      var timer, finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        global.clearTimeout(timer);
        resolve();
      }
      if (!tag) {
        tag = doc.createElement('script');
        tag.src = STOCK_MAP_URL;
        tag.setAttribute('data-guest-news-stock-map', '1');
      }
      tag.addEventListener('load', finish, { once: true });
      tag.addEventListener('error', finish, { once: true });
      // 종목 사전 실패·지연도 뉴스 자체를 막지 않는다.
      timer = global.setTimeout(finish, 5000);
      if (!tag.parentNode) (doc.head || doc.documentElement).appendChild(tag);
    });
  }

  function stockCandidates() {
    if (stockCatalog && stockCatalogMap === global.KRX_MAP && stockCatalogPanel === global.StockSearchPanel) return stockCatalog;
    var map = global.KRX_MAP || {};
    var etfs = new Set(global.KRX_ETF_NAMES || []);
    var rows = [];
    Object.keys(map).forEach(function (name) {
      var code = String(map[name] || '');
      // ETF·스팩·우선주·짧은 일반 단어는 기업 매칭 후보에서 제외.
      if (name.length < 3 || !/^[0-9A-Z]{6}$/.test(code) || etfs.has(name) ||
          /(?:우[A-Z0-9]?|스팩|기업인수목적)$/.test(name)) return;
      rows.push({ name: name, code: code, terms: [name], market: 'kr' });
    });
    var us = global.StockSearchPanel && global.StockSearchPanel.knownUsStocks
      ? global.StockSearchPanel.knownUsStocks() : [];
    var ignore = { SPCX: 1, SKHY: 1, CBRS: 1, SPY: 1, QQQ: 1 };
    us.forEach(function (row) {
      if (!row || !/^[A-Z]{2,5}$/.test(row.symbol) || ignore[row.symbol]) return;
      var terms = [row.name, row.symbol].concat(String(row.aliases || '').split(/\s+/).filter(function (word) {
        return word.length >= 5 && !/^(?:inc|corporation|technology|technologies|advanced|systems|company|group|global|spacemobile)$/i.test(word);
      }));
      rows.push({ name: row.name, code: row.symbol, terms: terms, market: 'us' });
    });
    stockCatalogMap = global.KRX_MAP;
    stockCatalogPanel = global.StockSearchPanel;
    stockCatalog = rows;
    return rows;
  }

  /* 부분문자열 오인식 방지: 독립된 회사명 또는 조사로 끝나는 명시적 언급만 허용한다. */
  function mentionAt(title, term) {
    if (!title || !term) return -1;
    var text = String(title), needle = String(term);
    var low = text.toLowerCase(), target = needle.toLowerCase(), at = 0;
    while ((at = low.indexOf(target, at)) >= 0) {
      var before = at ? text.charAt(at - 1) : '';
      var end = at + needle.length;
      var after = text.slice(end);
      at += 1;
      if (/[a-z0-9가-힣]/i.test(before)) continue;
      if (/^[a-z0-9]/i.test(after)) continue;
      if (/^우(?:[A-Z0-9]|$)/.test(after)) continue;
      if (/^[가-힣]/.test(after) && !/^(?:은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게|측|발|주가|주식|실적)(?=$|[^a-z0-9]|[가-힣])/i.test(after)) continue;
      // 짧은 영문 약어는 대문자 티커로 명시됐을 때만 종목으로 해석.
      if (/^[a-z]{2,5}$/i.test(needle) && needle === needle.toUpperCase() && text.slice(at - 1, end) !== needle) continue;
      return at - 1;
    }
    return -1;
  }

  function relatedStocks(item) {
    if (!item) return [];
    var titles = [item.title, item.title_ko].filter(Boolean);
    var seen = {}, found = [];
    stockCandidates().forEach(function (row) {
      var best = Infinity;
      row.terms.forEach(function (term) {
        if (!term || term.length < 2) return;
        titles.forEach(function (title) {
          var at = mentionAt(title, term);
          if (at >= 0 && at < best) best = at;
        });
      });
      if (best === Infinity || seen[row.market + ':' + row.code]) return;
      seen[row.market + ':' + row.code] = true;
      found.push({ name: row.name, code: row.code, market: row.market, at: best });
    });
    found.sort(function (a, b) { return a.at - b.at || b.name.length - a.name.length; });
    return found.slice(0, 3);
  }

  function newsItemHtml(M, item, now, latest) {
    var at = M.dateValue(item.pubDate);
    var press = M.sourceLabel(item);
    var related = relatedStocks(item);
    var stockFooter = related.length ? '<span class="gnt-related"><span class="gnt-related-label">관련 종목</span>' +
      related.map(function (stock) { return '<span class="gnt-stock-name">' + esc(stock.name) + '</span>'; }).join('') + '</span>' : '';
    return '<li class="gnt-item' + (latest ? ' is-latest' : '') + '">' +
      '<a class="gnt-card" href="' + esc(M.safeHref(item.link)) + '" target="_blank" rel="noopener noreferrer">' +
      '<time class="gnt-time" datetime="' + esc(new Date(at).toISOString()) + '" title="' + esc(M.timeLabel(item.pubDate, item._market)) + '">' + esc(relativeLabel(at, now)) + '</time>' +
      '<h3 class="gnt-title ui-section-title">' + esc(M.displayTitle(item)) + '</h3>' +
      '<span class="gnt-meta">' + (press ? '<span class="gnt-press">' + esc(press) + '</span>' : '') +
      '<span class="gnt-market">' + MARKET_LABEL[item._market] + '</span></span>' + stockFooter + '</a>' +
      '<span class="gnt-marker" aria-hidden="true"></span></li>';
  }

  function newsShellHtml() {
    return '<section class="guest-news home-widget home-widget--full" aria-label="지금 주목할 뉴스">' +
      // 머리말·더보기 버튼은 마켓브리핑과 같은 공통 클래스(.briefing-intro, .home-briefing-more)를 그대로 쓴다.
      '<div class="home-section-heading briefing-intro"><div><span class="learn-eyebrow">시간 순으로 읽는 시장</span>' +
      '<strong>지금 주목할 뉴스</strong><p>최근 24시간 국내·미국 주요뉴스를 최신순으로 살펴보세요.</p></div>' +
      '<a class="home-briefing-more" href="/pages/main-news"><span>전체 뉴스 보기</span> <i aria-hidden="true">↗</i></a></div>' +
      '<div class="guest-news-body" data-guest-news><div class="home-card-state">뉴스를 불러오는 중입니다.</div></div></section>';
  }

  /* 홈 첫 그림을 막지 않도록 마운트 뒤에 따로 조회한다. 한쪽 시장이 실패해도 받은 쪽만으로 그린다. */
  function fillNews(body) {
    var M = null;
    var items = [];
    var page = 0;
    var failed = 0;
    function state(message) { body.innerHTML = '<div class="home-card-state">' + message + '</div>'; }
    function render() {
      var start = page * NEWS_PAGE_SIZE;
      var visible = items.slice(start, start + NEWS_PAGE_SIZE);
      var pageCount = Math.ceil(items.length / NEWS_PAGE_SIZE);
      var now = Date.now();
      body.innerHTML = '<ol class="gnt-list" data-count="' + visible.length + '">' + visible.map(function (item, index) {
        return newsItemHtml(M, item, now, page === 0 && index === 0);
      }).join('') + '</ol>' +
        '<div class="gnt-pager"><span class="gnt-count">최근 24시간 수집 기사 ' + items.length +
        '건 · ' + (start + 1) + '–' + (start + visible.length) + '건 표시</span>' +
        (pageCount > 1 ? '<div class="gnt-controls" aria-label="뉴스 페이지 이동">' +
          '<button type="button" data-gnt-page="newer"' + (page === 0 ? ' disabled' : '') + '>← 최신 뉴스</button>' +
          '<span class="gnt-page" aria-live="polite">' + (page + 1) + ' / ' + pageCount + '</span>' +
          '<button type="button" data-gnt-page="older"' + (page + 1 >= pageCount ? ' disabled' : '') + '>지난 뉴스 →</button>' +
          '</div>' : '') + '</div>' +
        (failed ? '<p class="gnt-note">일부 시장 뉴스 응답에 실패하여 수집된 기사만 표시합니다.</p>' : '');
    }
    body.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-gnt-page]');
      if (!button || !body.contains(button) || button.disabled || !M) return;
      var next = page + (button.getAttribute('data-gnt-page') === 'older' ? 1 : -1);
      if (next < 0 || next >= Math.ceil(items.length / NEWS_PAGE_SIZE)) return;
      page = next;
      render();
    });
    // 뉴스 조회와 병렬로 공개 종목 사전만 로드한다. 시세·새 API 요청은 없다.
    loadStockCatalog().then(function () { if (items.length && M) render(); });
    loadMainNews().then(function (loaded) {
      M = loaded;
      var lists = {};
      var jobs = ['kr', 'us'].map(function (market) {
        return M.fetchJson(M.urls[market]).then(function (rows) { lists[market] = rows; }, function () { failed += 1; });
      });
      return Promise.all(jobs).then(function () {
        items = pickNews(M, lists, Date.now());
        if (!items.length) {
          state(failed ? '뉴스를 불러오지 못했거나 최근 24시간 기사를 확인할 수 없습니다.' : '최근 24시간 안에 새로 올라온 주요뉴스가 없습니다.');
          return;
        }
        render();
      });
    }).catch(function () { state('뉴스를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.'); });
  }

  function mount() {
    if (mounted) return true;
    var feed = doc.querySelector('.feed');
    if (!feed) return false;
    mounted = true;
    injectCss();
    var root = doc.documentElement;
    root.classList.add('guest-home-mode');
    root.classList.remove('home-render-pending', 'access-pending');
    // 모바일 하단 탭바: skin-main의 공통 로더가 이 신호(또는 위 클래스)로 시작한다. 대시보드 초기화는 계속 막힌다.
    try { doc.dispatchEvent(new global.CustomEvent('nine:guest-home')); } catch (e) { /* 구형 브라우저: 탭바 없이 유지 */ }

    var briefingCards = cardsOf(feed).filter(isBriefing);
    // 피드의 나머지(다른 카테고리 글·공지·페이지네이션)는 비회원 홈에 표시하지 않는다.
    Array.prototype.slice.call(feed.children).forEach(function (child) { child.remove(); });

    var page = doc.createElement('section');
    page.className = 'home-dashboard home-editorial-page guest-home';
    page.setAttribute('aria-label', '비회원 홈');
    // 뉴스는 그리드 밖(위)에 둔다: 모바일 브리핑/이야기 스와이프(.home-widget-grid 직속 섹션 전환)에 끼어들지 않는다.
    page.innerHTML = newsShellHtml() + '<div class="home-widget-grid"><div class="home-card-state">마켓브리핑을 불러오는 중입니다.</div></div>';
    feed.appendChild(page);
    fillNews(page.querySelector('[data-guest-news]'));

    var grid = page.querySelector('.home-widget-grid');
    if (briefingCards.length >= 3) fillBriefing(grid, briefingCards, 40);
    else {
      fetchCategoryCards().then(function (cards) { fillBriefing(grid, cards.length ? cards : briefingCards, 40); })
        .catch(function () { fillBriefing(grid, briefingCards, 40); });
    }
    return true;
  }

  global.NineGuestHome = { mount: mount, relatedStocks: relatedStocks };
})(window);
