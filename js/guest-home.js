/**
 * 비회원 전용 홈 (2026-11-12, 2026-11-11 회원 화면과 같은 컴포넌트로 통일).
 *
 * 관리자가 아닌 입장(비회원 입장·로그인했지만 관리자 아닌 계정)의 `/`는 전체 대시보드 대신
 * 마켓브리핑 + 이야기 시리즈 두 영역만 보여 준다. js/access-gate.js 가 NineAccess.run 으로 skin-main 의
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
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/guest-home.css?v=20261111-guest-timeline-v1';
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
     최근 24시간·발행시각이 확인된 기사만, 중복 없이 최대 4건. 국내·미국이 모두 있으면 2건씩 고르고 모자라면 다른 쪽으로 채운다.
     중요도는 만들지 않는다 - 각 시장의 최신순에서 고른 뒤 과거 → 최신으로 세운다. */
  var NEWS_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/main-news.js?v=20261112-guest-timeline';
  var NEWS_MAX = 4;
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
    var pools = {};
    Object.keys(lists).forEach(function (market) {
      pools[market] = lists[market].filter(function (item) {
        var at = M.dateValue(item.pubDate);
        var link = M.safeHref(item.link);
        var title = M.displayTitle(item);
        if (!at || at > now + 5 * 60000 || now - at > DAY_MS || !link || !title) return false; // 발행시각·원문이 확인된 최근 24시간 기사만
        var key = title.replace(/\s+/g, '').toLowerCase();
        if (seen[link] || seen[key]) return false;
        seen[link] = seen[key] = true;
        item._market = market;
        return true;
      });
    });
    var markets = Object.keys(pools).filter(function (market) { return pools[market].length; });
    var picked = [];
    var share = markets.length ? Math.ceil(NEWS_MAX / markets.length) : 0;
    markets.forEach(function (market) { picked = picked.concat(pools[market].splice(0, share)); });
    var rest = markets.reduce(function (all, market) { return all.concat(pools[market]); }, [])
      .sort(function (a, b) { return M.dateValue(b.pubDate) - M.dateValue(a.pubDate); });
    picked = picked.slice(0, NEWS_MAX).concat(rest).slice(0, NEWS_MAX);
    return picked.sort(function (a, b) { return M.dateValue(a.pubDate) - M.dateValue(b.pubDate); }); // 과거 → 최신
  }

  function newsItemHtml(M, item, now, latest) {
    var at = M.dateValue(item.pubDate);
    var press = M.sourceLabel(item);
    return '<li class="gnt-item' + (latest ? ' is-latest' : '') + '">' +
      '<a class="gnt-card" href="' + esc(M.safeHref(item.link)) + '" target="_blank" rel="noopener noreferrer">' +
      '<time class="gnt-time" datetime="' + esc(new Date(at).toISOString()) + '" title="' + esc(M.timeLabel(item.pubDate, item._market)) + '">' + esc(relativeLabel(at, now)) + '</time>' +
      '<h3 class="gnt-title ui-section-title">' + esc(M.displayTitle(item)) + '</h3>' +
      '<span class="gnt-meta">' + (press ? '<span class="gnt-press">' + esc(press) + '</span>' : '') +
      '<span class="gnt-market">' + MARKET_LABEL[item._market] + '</span></span></a>' +
      '<span class="gnt-marker" aria-hidden="true"></span></li>';
  }

  function newsShellHtml() {
    return '<section class="guest-news home-widget home-widget--full" aria-label="지금 주목할 뉴스">' +
      // 머리말·더보기 버튼은 마켓브리핑과 같은 공통 클래스(.briefing-intro, .home-briefing-more)를 그대로 쓴다.
      '<div class="home-section-heading briefing-intro"><div><span class="learn-eyebrow">시간 순으로 읽는 시장</span>' +
      '<strong>지금 주목할 뉴스</strong><p>최근 24시간 국내·미국 주요뉴스를 발행 순서대로 살펴보세요.</p></div>' +
      '<a class="home-briefing-more" href="/pages/main-news"><span>전체 뉴스 보기</span> <i aria-hidden="true">↗</i></a></div>' +
      '<div class="guest-news-body" data-guest-news><div class="home-card-state">뉴스를 불러오는 중입니다.</div></div></section>';
  }

  /* 홈 첫 그림을 막지 않도록 마운트 뒤에 따로 조회한다. 한쪽 시장이 실패해도 받은 쪽만으로 그린다. */
  function fillNews(body) {
    function state(message) { body.innerHTML = '<div class="home-card-state">' + message + '</div>'; }
    loadMainNews().then(function (M) {
      var lists = {};
      var failed = 0;
      var jobs = ['kr', 'us'].map(function (market) {
        return M.fetchJson(M.urls[market]).then(function (items) { lists[market] = items; }, function () { failed += 1; });
      });
      return Promise.all(jobs).then(function () {
        var now = Date.now();
        var items = pickNews(M, lists, now);
        if (!items.length) { state(failed === jobs.length ? '뉴스를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.' : '최근 24시간 안에 새로 올라온 주요뉴스가 없습니다.'); return; }
        body.innerHTML = '<ol class="gnt-list" data-count="' + items.length + '">' + items.map(function (item, index) {
          return newsItemHtml(M, item, now, index === items.length - 1);
        }).join('') + '</ol>';
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

  global.NineGuestHome = { mount: mount };
})(window);
