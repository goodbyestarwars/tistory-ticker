/**
 * 비회원 전용 홈 (2026-11-12).
 *
 * 관리자가 아닌 입장(비회원 입장·로그인했지만 관리자 아닌 계정)의 `/`는 전체 대시보드 대신
 * 마켓브리핑 + 이야기 시리즈 두 영역만 보여 준다. js/access-gate.js 가 NineAccess.run 으로 skin-main 의
 * 대시보드 코드를 막으므로 실시간 위젯·시세 요청은 시작되지 않는다(여기서도 시작하지 않는다).
 *
 * 재사용(복제 금지):
 *  - 마켓브리핑 카드: 티스토리 피드의 .post-card(data-cat='마켓 브리핑'). 홈 피드에 없으면 /category/마켓 브리핑 을 읽어온다.
 *  - 카드/캐러셀 마크업·클래스: skin-main 의 홈 브리핑 섹션과 같은 클래스(.home-briefing-section 등)를 써서 style.css 를 공유한다.
 *  - 이야기 시리즈: skin-shell 이 푸터에 만드는 nav.site-footer-learn 을 옮겨 온다(복제하지 않는다).
 *  - 캐러셀 동작: SiteInteractions.carousel.
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
    var track = section.querySelector('.briefing-carousel-track');
    var controls = section.querySelector('.briefing-carousel-controls');
    if (!cards.length) {
      track.insertAdjacentHTML('afterend', emptyState('최신 마켓브리핑을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'));
      track.remove();
      if (controls) controls.remove();
      return;
    }
    cards.slice(0, 8).forEach(function (card, index) {
      card.classList.add('home-briefing-card');
      card.setAttribute('data-briefing-number', String(index + 1).padStart(2, '0'));
      track.appendChild(card);
    });
    wireCardLinks(track);
    (global.SiteInteractionsReady || Promise.resolve(global.SiteInteractions)).then(function (module) {
      if (!module || !module.carousel) return;
      module.carousel(section, { track: '.briefing-carousel-track', previous: '[data-briefing-prev]', next: '[data-briefing-next]', progress: '.briefing-carousel-progress', card: '.home-briefing-card' });
    }).catch(function () { /* 캐러셀 없이도 가로 스크롤로 읽을 수 있다 */ });
  }

  function briefingHtml() {
    return '<section class="home-briefing-section guest-home-briefing" aria-label="마켓브리핑">' +
      '<div class="home-section-heading briefing-intro"><div><span class="learn-eyebrow">시장을 읽는 투자 노트</span><strong>마켓브리핑</strong>' +
      '<p>주가를 움직인 사건과 흐름, 핵심 해석을 살펴보세요.</p></div>' +
      '<a class="home-briefing-more" href="/category/' + encodeURIComponent(CATEGORY) + '"><span>브리핑 아카이브</span><strong>더보기</strong><i aria-hidden="true">→</i></a></div>' +
      '<div class="home-briefing-grid briefing-carousel-track" tabindex="0" role="region" aria-label="마켓브리핑 카드"></div>' +
      '<div class="briefing-carousel-controls"><input class="briefing-carousel-progress" type="range" min="0" max="1000" value="0" aria-label="브리핑 카드 이동 위치">' +
      '<div><button type="button" data-briefing-prev aria-label="이전 브리핑">←</button><button type="button" data-briefing-next aria-label="다음 브리핑">→</button></div></div>' +
      '</section>';
  }

  /* 이야기 시리즈: 푸터가 늦게 그려질 수 있어 잠시 기다린다. 끝내 없으면 안내 문구. */
  function attachStories(holder, tries) {
    var nav = doc.querySelector('.site-footer-learn');
    if (nav) { holder.innerHTML = ''; holder.appendChild(nav); return; }
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
    page.className = 'home-editorial-page guest-home';
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
