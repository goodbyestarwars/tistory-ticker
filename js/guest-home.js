/**
 * 비회원 전용 홈 (2026-11-12).
 *
 * 관리자가 아닌 입장(비회원 입장·로그인했지만 관리자 아닌 계정)의 `/`는 전체 대시보드 대신
 * 마켓브리핑 + 이야기 시리즈 두 영역만 보여 준다. js/access-gate.js 가 NineAccess.run 으로 skin-main 의
 * 대시보드 코드를 막으므로 실시간 위젯·시세 요청은 시작되지 않는다(여기서도 시작하지 않는다).
 *
 * 재사용(복제 금지):
 *  - 마켓브리핑 카드: 티스토리 피드의 .post-card(data-cat='마켓 브리핑'). 홈 피드에 없으면 /category/마켓 브리핑 을 읽어온다.
 *  - 카드 콘텐츠: 기존 티스토리 .post-card 를 이동해 링크/내용을 그대로 유지한다.
 *  - 이야기 시리즈: skin-shell 의 원본 nav 를 옮기되 푸터 캐러셀 전용 클래스는 분리한다.
 *  - 비회원 홈은 마켓브리핑·이야기 모두 반응형 줄바꿈 그리드(가로 캐러셀 없음).
 */
(function (global) {
  'use strict';
  if (global.NineGuestHome) return;
  var doc = global.document;
  var CATEGORY = '마켓 브리핑';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/guest-home.css';
  var mounted = false;

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

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

  function emptyState(message) { return '<div class="home-card-state guest-home-state">' + esc(message) + '</div>'; }

  function wireCardLinks(track) {
    // 카드 어디를 눌러도 글로 이동(기존 홈 카드와 같은 동작). 안쪽 링크는 그대로 둔다.
    track.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) return;
      var card = e.target.closest ? e.target.closest('.post-card') : null;
      var url = card && card.getAttribute('data-url');
      if (url) global.location.assign(url);
    });
  }

  function fillBriefing(section, cards) {
    var grid = section.querySelector('.guest-home-briefing-grid');
    if (!cards.length) {
      grid.insertAdjacentHTML('afterend', emptyState('최신 마켓브리핑을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'));
      grid.remove();
      return;
    }
    cards.slice(0, 8).forEach(function (card, index) {
      card.classList.add('guest-home-briefing-card');
      card.setAttribute('data-briefing-number', String(index + 1).padStart(2, '0'));
      grid.appendChild(card);
    });
    wireCardLinks(grid);
  }

  function briefingHtml() {
    return '<section class="guest-home-section guest-home-briefing" aria-label="마켓브리핑">' +
      '<div class="guest-home-heading"><div><span class="learn-eyebrow">시장을 읽는 투자 노트</span><h2>마켓브리핑</h2>' +
      '<p>주가를 움직인 사건과 흐름, 핵심 해석을 살펴보세요.</p></div>' +
      '<a class="guest-home-more" href="/category/' + encodeURIComponent(CATEGORY) + '">브리핑 아카이브 · 더보기 →</a></div>' +
      '<div class="guest-home-briefing-grid" aria-label="마켓브리핑 카드"></div></section>';
  }

  /* 이야기 시리즈: 푸터가 늦게 그려질 수 있어 잠시 기다린다. 끝내 없으면 안내 문구. */
  function attachStories(holder, tries) {
    var nav = doc.querySelector('.site-footer-learn');
    if (nav) {
      // 원본 카드와 링크를 그대로 이동하되, 푸터의 가로 캐러셀 규칙은 가져오지 않는다.
      // 독립 비회원 홈 클래스만 사용해 다른 화면의 디자인·이동 기능을 보존한다.
      nav.classList.remove('site-footer-learn', 'site-footer-links');
      nav.classList.add('guest-home-story-nav');
      var intro = nav.querySelector('.learn-intro');
      if (intro) {
        intro.classList.remove('learn-intro');
        intro.classList.add('guest-home-story-intro');
      }
      var area = nav.querySelector('.learn-card-area');
      if (area) {
        area.classList.remove('learn-card-area');
        area.classList.add('guest-home-story-area');
      }
      var grid = nav.querySelector('.learn-card-grid');
      if (grid) {
        grid.classList.remove('learn-card-grid');
        grid.classList.add('guest-home-story-grid');
        grid.removeAttribute('tabindex'); // 정적인 목록: 좌우 스크롤·캐러셀 키보드 조작 없음
        grid.removeAttribute('role');
      }
      Array.prototype.forEach.call(nav.querySelectorAll('.learn-card'), function (card) {
        card.classList.remove('learn-card');
        card.classList.add('guest-home-story-card');
      });
      var controls = nav.querySelector('.learn-mobile-controls');
      if (controls) controls.remove();
      holder.innerHTML = '';
      holder.appendChild(nav);
      return;
    }
    if (tries <= 0) {
      holder.innerHTML = emptyState('이야기 시리즈를 불러오지 못했습니다. 새로고침해 주세요.');
      return;
    }
    global.setTimeout(function () { attachStories(holder, tries - 1); }, 250);
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

    var homeCards = cardsOf(feed);
    var briefingCards = homeCards.filter(isBriefing);
    // 피드의 나머지(다른 카테고리 글·공지·페이지네이션)는 비회원 홈에 표시하지 않는다.
    Array.prototype.slice.call(feed.children).forEach(function (child) { child.remove(); });

    var page = doc.createElement('div');
    page.className = 'guest-home';
    page.setAttribute('aria-label', '비회원 홈');
    page.innerHTML = briefingHtml() +
      '<section class="guest-home-stories" aria-label="이야기 시리즈"><div class="guest-home-stories-body">' + emptyState('이야기 시리즈를 불러오는 중입니다.') + '</div></section>';
    feed.appendChild(page);

    var section = page.querySelector('.guest-home-briefing');
    if (briefingCards.length >= 3) fillBriefing(section, briefingCards);
    else {
      fetchCategoryCards().then(function (cards) { fillBriefing(section, cards.length ? cards : briefingCards); })
        .catch(function () { fillBriefing(section, briefingCards); });
    }
    attachStories(page.querySelector('.guest-home-stories-body'), 40);
    return true;
  }

  global.NineGuestHome = { mount: mount };
})(window);
