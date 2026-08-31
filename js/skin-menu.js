/**
 * 9Pay 공통 내비게이션.
 * 1차 메뉴와 고정형 2차 메뉴를 분리하고, 현재 페이지의 두 단계 메뉴를 함께 활성화한다.
 */
(function () {
  'use strict';

  var NAV_ITEMS = [
    { href: '/', label: '홈' },
    {
      label: '시장',
      children: [
        { href: '/category/마켓 브리핑', label: '마켓브리핑' },
        { href: '/page/market-temp', label: '증시온도' },
        { href: '/pages/overnight-market', label: '글로벌 시장지표' },
        { href: '/pages/kospi-futures', label: '국내시장지표' }
      ]
    },
    {
      label: '종목',
      children: [
        { href: '/page/foreign-flow', label: '종목분석' },
        { href: '/page/market-temp?view=stocks', label: '국내 주요종목' },
        { href: '/page/stock-search', label: '실시간 시세 (US. Include)' }
      ]
    },
    {
      label: '종목검색',
      children: [
        { href: '/page/pattern-scan', label: '차트검색' },
        { href: '/page/strategy-search', label: '전략검색' }
      ]
    },
    { href: '/page/stock-calendar', label: '캘린더' },
    { href: '/guestbook', label: '커뮤니티' },
    { href: '/page/watchlist', label: 'MY' },
  ];

  // 기존 직접 링크는 유지한다. 상단 메뉴에서는 숨기지만 북마크·검색 결과가
  // 사용하는 페이지 주소를 바꾸지 않아 기존 진입 경로가 끊기지 않게 한다.
  var LEGACY_PAGE_URLS = ['/page/foreign-flow', '/page/stock-search'];

  var SEARCH_HTML = ''
    + '<div class="nav-search-wrap">'
    + '<div class="nav-search-input-wrap">'
    + '<span class="nav-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 5 5"></path></svg></span>'
    + '<input type="text" id="navSearchInput" class="nav-search-input" placeholder="종목검색"'
    + ' aria-label="전체 종목 검색" autocomplete="off" />'
    + '</div><div id="navSearchSuggest" class="nav-search-suggest"></div></div>';

  var selectedGroupIndex = -1;

  function currentPath() {
    var path;
    try { path = decodeURIComponent(location.pathname); } catch (err) { path = location.pathname; }
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return path || '/';
  }

  function isActive(item) {
    if (!item.href) return false;
    var parts = item.href.split('?');
    if (currentPath() !== parts[0]) return false;
    var query = new URLSearchParams(location.search);
    if (!parts[1]) return query.get('view') !== 'stocks';
    if (parts[1].indexOf('view=stocks') === 0) {
      return query.get('view') === 'stocks' && (parts[1].indexOf('panel=heatmap') === -1 || query.get('panel') === 'heatmap');
    }
    return query.get('market') === 'us';
  }

  function groupIsActive(item) {
    return Boolean(item.children && item.children.some(isActive));
  }

  function activeGroupIndex() {
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      if (groupIsActive(NAV_ITEMS[i])) return i;
    }
    return -1;
  }

  function primaryHtml(item, index) {
    var current = item.children ? groupIsActive(item) : isActive(item);
    var selected = item.children && index === selectedGroupIndex;
    var cls = 'nav-item nav-primary-item' + (current || selected ? ' nav-item-active' : '');
    if (!item.children) {
      return '<a class="' + cls + '" href="' + item.href + '"'
        + (current ? ' aria-current="page"' : '') + '>'
        + '<span class="nav-item-label">' + item.label + '</span></a>';
    }
    return '<button type="button" class="' + cls + ' nav-group-trigger" data-group-index="' + index + '"'
      + ' aria-expanded="' + String(selected) + '" aria-controls="nav-secondary-row">'
      + '<span class="nav-item-label">' + item.label + '</span></button>';
  }

  function secondaryHtml() {
    var group = NAV_ITEMS[selectedGroupIndex];
    if (!group || !group.children) return '';
    var items = group.children.map(function (child, index) {
      var active = isActive(child);
      return (index ? '<span class="nav-secondary-separator" aria-hidden="true">|</span>' : '')
        + '<a class="nav-secondary-item' + (active ? ' active' : '') + '" href="' + child.href + '"'
        + (active ? ' aria-current="page"' : '') + '>' + child.label + '</a>';
    }).join('');
    return '<div class="nav-secondary-row" id="nav-secondary-row" aria-label="' + group.label + ' 2차 메뉴">'
      + '<div class="nav-secondary-inner">' + items + '</div></div>';
  }

  function syncSecondaryHeight(open) {
    document.documentElement.classList.toggle('nav-secondary-open', open);
  }

  function renderMenu(mount) {
    var primary = NAV_ITEMS.map(primaryHtml).join('');
    var secondary = secondaryHtml();
    mount.innerHTML = '<div class="nav-primary-row">' + primary + '</div>' + secondary;
    syncSecondaryHeight(Boolean(secondary));
  }

  function mobileBottomIcon(type) {
    var paths = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>',
      market: '<path d="M4 19V9"/><path d="M9 19V5"/><path d="M14 19v-8"/><path d="M19 19V3"/><path d="M3 21h18"/>',
      stock: '<path d="M4 19V5h16v14z"/><path d="M8 9h8M8 13h5M8 17h3"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/><path d="M8.5 11h5M11 8.5v5"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths[type] + '</svg>';
  }

  function mobileBottomActiveKey() {
    var path = currentPath();
    if (path === '/') return 'home';
    if (path === '/page/watchlist') return 'my';
    if (path === '/page/market-temp') return new URLSearchParams(location.search).get('view') === 'stocks' ? 'stock' : 'market';
    if (['/pages/overnight-market', '/pages/kospi-futures', '/category/마켓 브리핑'].indexOf(path) !== -1) return 'market';
    if (['/page/foreign-flow', '/page/stock-search'].indexOf(path) !== -1) return 'stock';
    if (['/page/pattern-scan', '/page/strategy-search'].indexOf(path) !== -1) return 'search';
    return 'more';
  }

  function renderMobileBottomNav() {
    var nav = document.getElementById('mobileAppBottomNav');
    if (!nav) {
      document.body.insertAdjacentHTML('beforeend',
        '<nav class="mobile-app-bottom-nav" id="mobileAppBottomNav" aria-label="모바일 주요 메뉴">'
        + '<a class="mobile-app-bottom-item" data-bottom-key="home" href="/">' + mobileBottomIcon('home') + '<span>홈</span></a>'
        + '<a class="mobile-app-bottom-item" data-bottom-key="market" href="/page/market-temp">' + mobileBottomIcon('market') + '<span>시장</span></a>'
        + '<a class="mobile-app-bottom-item" data-bottom-key="stock" href="/page/stock-search">' + mobileBottomIcon('stock') + '<span>종목</span></a>'
        + '<a class="mobile-app-bottom-item" data-bottom-key="my" href="/page/watchlist">' + mobileBottomIcon('more') + '<span>MY</span></a>'
        + '<button type="button" class="mobile-app-bottom-item" data-bottom-action="more" aria-expanded="false">' + mobileBottomIcon('more') + '<span>더보기</span></button>'
        + '</nav>'
        + '<div class="mobile-app-sheet" id="mobileAppSheet" hidden>'
        + '<div class="mobile-app-sheet-backdrop" data-bottom-action="close"></div>'
        + '<section class="mobile-app-sheet-panel" role="dialog" aria-modal="true" aria-label="더보기 메뉴">'
        + '<div class="mobile-app-sheet-head"><strong>더보기</strong><button type="button" data-bottom-action="close" aria-label="더보기 닫기">×</button></div>'
        + '<div class="mobile-app-sheet-links">'
        + '<a href="/page/stock-calendar">캘린더<span>실적·경제 일정</span></a>'
        + '<a href="/pages/overnight-market">글로벌 시장지표<span>미국·해외 시장</span></a>'
        + '<a href="/pages/kospi-futures">국내시장지표<span>KOSPI·KOSDAQ·선물</span></a>'
        + '<a href="/page/strategy-search">검색<span>차트·전략 검색</span></a>'
        + '<a href="/guestbook">커뮤니티<span>의견과 문의</span></a>'
        + '</div></section></div>');
      nav = document.getElementById('mobileAppBottomNav');
    }

    var activeKey = mobileBottomActiveKey();
    nav.querySelectorAll('[data-bottom-key]').forEach(function (item) {
      var active = item.getAttribute('data-bottom-key') === activeKey;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    if (nav.getAttribute('data-bottom-wired') === '1') return;
    nav.setAttribute('data-bottom-wired', '1');
    var sheet = document.getElementById('mobileAppSheet');
    var moreButton = nav.querySelector('[data-bottom-action="more"]');
    function closeSheet() {
      if (!sheet) return;
      sheet.hidden = true;
      moreButton.setAttribute('aria-expanded', 'false');
      document.documentElement.classList.remove('mobile-app-sheet-open');
    }
    function openSheet() {
      if (!sheet) return;
      sheet.hidden = false;
      moreButton.setAttribute('aria-expanded', 'true');
      document.documentElement.classList.add('mobile-app-sheet-open');
    }
    moreButton.addEventListener('click', function () {
      if (sheet.hidden) openSheet(); else closeSheet();
    });
    // 2026-08-31: 모바일에서 "맨 위로" 떠 있는 버튼(.scroll-top-btn)이 본문 글자를 덮어
    // style.css의 max-width:720px 구간에서 숨겼다. 그 기능을 여기로 옮긴다 - 지금 보고
    // 있는 탭을 다시 누르면 페이지 맨 위로 올라간다(흔한 모바일 앱 패턴). 다른 탭을
    // 누르면 기존대로 그 페이지로 이동한다.
    nav.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('[data-bottom-key]') : null;
      if (!item || !item.classList.contains('active')) return;
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    sheet.addEventListener('click', function (event) {
      var action = event.target.closest ? event.target.closest('[data-bottom-action]') : null;
      if (action && action.getAttribute('data-bottom-action') === 'close') closeSheet();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !sheet.hidden) closeSheet();
    });
  }

  function wireNavigation(mount) {
    mount.addEventListener('click', function (event) {
      var trigger = event.target.closest ? event.target.closest('.nav-group-trigger') : null;
      if (!trigger) return;
      var nextIndex = Number(trigger.getAttribute('data-group-index'));
      selectedGroupIndex = selectedGroupIndex === nextIndex && !groupIsActive(NAV_ITEMS[nextIndex])
        ? -1
        : nextIndex;
      renderMenu(mount);
      var currentTrigger = mount.querySelector('.nav-group-trigger[data-group-index="' + nextIndex + '"]');
      if (currentTrigger) currentTrigger.focus();
    });
  }

  /*
   * 운영 티스토리 스킨은 관리자가 마지막으로 붙여넣은 HTML이 저장되므로,
   * 저장소에서 폰트 전환 UI를 삭제해도 예전 버튼(#fontModeBtn)이 남을 수 있다.
   * 신문사형 타이포그래피는 이제 CSS에서 고정하므로 이 버튼과 이전 선택값을
   * 런타임에 정리한다. 정적 스킨을 다시 붙여넣기 전에도 같은 화면을 보장한다.
   */
  function removeLegacyFontToggle() {
    document.querySelectorAll('#fontModeBtn, .nav-font-btn').forEach(function (item) {
      item.remove();
    });
    document.documentElement.classList.remove('font-gothic');
    try { localStorage.removeItem('bolt-font'); } catch (err) {}
  }

  function render() {
    var searchMount = document.getElementById('navSearchMount');
    var mount = document.getElementById('nav-menu-mount');
    if (searchMount) searchMount.innerHTML = SEARCH_HTML;

    removeLegacyFontToggle();

    // 관심종목은 모든 페이지의 우측 고정 드로어로 제공한다. 운영 스킨에 남아 있는
    // 이전 MY 아이콘도 정적 자산 배포만으로 즉시 제거되도록 런타임에서 함께 정리한다.
    document.querySelectorAll('.nav-my-btn').forEach(function (item) { item.remove(); });

    // 2026-07-31: 로고 텍스트 변경(사용자 요청) - skin.html은 티스토리 관리자 수동 반영
    // 대상이라 git push만으로는 운영 화면에 안 뜬다. 이 스크립트는 정적 자산이라 master
    // push 즉시 배포되므로, 운영 스킨에 남아있는 이전 텍스트를 런타임에 덮어써 수동 반영
    // 없이도 바로 보이게 한다(위 MY 아이콘 정리와 동일한 패턴).
    document.querySelectorAll('.nav-logo-name').forEach(function (item) {
      item.textContent = 'ㄱㅖ조 ㅏ심폐소생술';
    });
    // skin.html을 티스토리 관리자에서 아직 갱신하지 않은 경우에도 새 로고를 즉시 반영한다.
    document.querySelectorAll('.nav-logo-emblem img').forEach(function (item) {
      item.className = 'nav-logo-image';
      item.src = 'https://goodbyestarwars.github.io/tistory-ticker/img/account-cpr-logo.png';
      item.alt = '계좌 심폐소생술 로고';
      item.width = 34;
      item.height = 34;
    });

    if (mount) {
      selectedGroupIndex = activeGroupIndex();
      renderMenu(mount);
      wireNavigation(mount);
    }
    renderMobileBottomNav();
    if (window.StockSearchPanel) window.StockSearchPanel.wireSidebarSearch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
