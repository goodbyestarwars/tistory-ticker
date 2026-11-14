/**
 * 비회원 전용 홈 (2026-11-12, 2026-11-11 회원 화면과 같은 컴포넌트로 통일).
 *
 * 관리자가 아닌 입장(비회원 입장·로그인했지만 관리자 아닌 계정)의 `/`는 전체 대시보드 대신
 * 이번 주 주요뉴스 + 마켓브리핑 + 이야기 시리즈를 보여 준다. js/access-gate.js 가 NineAccess.run 으로 skin-main 의
 * 대시보드 코드를 막으므로 실시간 위젯·시세 요청은 시작되지 않는다(여기서도 시작하지 않는다).
 *
 * 재사용(복제 금지) - 모양·글꼴·넘김 화살표는 회원 대시보드와 같은 컴포넌트가 그린다:
 *  - 마켓브리핑: skin-main 의 NineHomeBriefing(같은 마크업·SiteInteractions.carousel)과 대시보드 래퍼 클래스
 *    (.home-dashboard.home-editorial-page > .home-widget-grid)를 그대로 써서 style.css 규칙이 동일하게 적용된다.
 *    카드는 티스토리 피드의 .post-card(data-cat='마켓 브리핑'). 홈 피드에 부족하면 /category/마켓 브리핑 을 읽어온다.
 *  - 이야기 시리즈·법적 링크·회사 정보: skin-shell 이 그린 원본 푸터(.site-footer)를 손대지 않는다.
 *  - 이번 주 주요뉴스(공통 뉴스 카드): js/main-news.js 의 MainNews(조회·정렬·언론사명·제목·시각)를 재사용한다. 이미지·시세 요청 없음.
 *  - 이 파일과 css/guest-home.css 는 비회원 전용 차이(빈 사이드바 숨김·뉴스 카드 배치)만 가진다.
 */
(function (global) {
  'use strict';
  if (global.NineGuestHome) return;
  var doc = global.document;
  var CATEGORY = '마켓 브리핑';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/guest-home.css?v=20261112-paper-v1';
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

  /* ───── 이번 주 주요뉴스(공통 뉴스 카드) ─────
     한국시간 월~일·시장별 최대50건을 공통 MainNews.loadWeek로 중복 제거·최신순 정렬한다.
     회원 휴장 뉴스와 같은 renderWeeklyNews·기사·건수·캐러셀을 사용한다. */
  function relatedStocks(item) { return global.NineNewsStocks ? global.NineNewsStocks.relatedStocks(item) : []; }
  function loadNewsCards() {
    if (global.HomeWeeklyReport) { global.HomeWeeklyReport.ensureStyle(); return Promise.resolve(); }
    return new Promise(function (resolve,reject) {
      var tag=doc.createElement('script');
      tag.src='https://goodbyestarwars.github.io/tistory-ticker/js/home-weekly-report.js';
      tag.onload=function () { if (!global.HomeWeeklyReport) { reject(new Error('news-cards')); return; } global.HomeWeeklyReport.ensureStyle(); resolve(); };
      tag.onerror=reject; doc.head.appendChild(tag);
    });
  }

  function newsShellHtml() {
    return '<section class="guest-news home-weekly-report weekend-dashboard home-widget home-widget--full" aria-label="이번 주 주요뉴스">' +
      // 머리말은 공통 briefing-intro, 뉴스 CTA는 브리핑 아카이브 카드와 구분되는 텍스트 링크다.
      '<div class="home-section-heading briefing-intro"><div><span class="learn-eyebrow">시간 순으로 읽는 시장</span>' +
      '<strong>이번 주 주요뉴스</strong></div>' +
      '<a class="guest-news-more" href="/pages/main-news"><svg class="guest-news-more-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6"/></svg><span>전체 뉴스 보기</span></a></div>' +
      '<div class="guest-news-body" data-guest-news><div class="home-card-state">뉴스를 불러오는 중입니다.</div></div></section>';
  }

  /* 홈 첫 그림을 막지 않도록 마운트 뒤에 따로 조회한다. 한쪽 시장이 실패해도 받은 쪽만으로 그린다. */
  function fillNews(body) {
    loadNewsCards().then(function(){return global.HomeWeeklyReport.renderWeeklyNews(body);}).catch(function(){body.innerHTML='<p class="home-card-state">뉴스를 불러오지 못했습니다.</p>';});
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
