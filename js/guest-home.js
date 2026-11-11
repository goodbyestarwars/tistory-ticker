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
 *  - 이 파일과 css/guest-home.css 는 비회원 전용 차이(빈 사이드바 숨김·흰색 박스)만 가진다.
 */
(function (global) {
  'use strict';
  if (global.NineGuestHome) return;
  var doc = global.document;
  var CATEGORY = '마켓 브리핑';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/guest-home.css?v=20261111-guest-carousel-v1';
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
    page.innerHTML = '<div class="home-widget-grid"><div class="home-card-state">마켓브리핑을 불러오는 중입니다.</div></div>';
    feed.appendChild(page);

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
