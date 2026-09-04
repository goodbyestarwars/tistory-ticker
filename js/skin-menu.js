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
    // 2026-09-04: '종목검색'(차트검색·전략검색 2개)을 '종목'으로 합치고, 1차 메뉴를
    // 7개에서 6개로 줄였다. 이름만으로 '종목'과 '종목검색'이 구분되지 않았고
    // (차트검색이 왜 '종목'이 아닌지 설명하기 어렵다) 하위 2개짜리가 1차 한 칸을
    // 쓰고 있었다. 1차 메뉴는 모바일에서 가로 스크롤이라 칸 수가 곧 사용성이다.
    //
    // '실시간 시세'(/page/stock-search)는 메뉴에서 뺐다. 상단 검색창이 이미 그
    // 페이지로 보내고(js/stock-search-panel.js TARGET_PAGE), PC·모바일 둘 다 항상
    // 떠 있어서 메뉴 항목이 하는 일이 겹쳤다. 주소는 그대로라 북마크·기존 링크는
    // 살아 있고(LEGACY_PAGE_URLS), 홈 실시간 종목판의 각 행도 이 페이지로 간다.
    //
    // 앞 둘은 종목을 '보는' 화면, 뒤 둘은 조건으로 '거르는' 화면이다. 그 순서를
    // 지켜야 4개가 한 줄에 있어도 안 헷갈린다.
    {
      label: '종목',
      children: [
        { href: '/page/market-temp?view=stocks', label: '국내 주요종목' },
        { href: '/page/foreign-flow', label: '종목분석' },
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
    + '<input type="text" id="navSearchInput" class="nav-search-input" placeholder="삼성전자 · NVDA 검색"'
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

  /* 2026-09-04: 모바일 하단 탭바(홈·시장·종목·MY·더보기)를 걷어냈다.
     2026-09-03에 상단 메뉴와 중복이라 상단을 감췄더니 "모바일인데 메뉴가 사라졌다"는
     판단을 받았다. 이 사이트는 1차 7개·2차까지 12개 목적지라 5칸 탭바에 안 들어가고,
     못 담은 항목이 더보기 시트로 밀려 오히려 길찾기가 어려워졌다. 가로 스크롤되는
     상단 2단 메뉴 하나로 되돌린다(style.css의 720px 구간에서 상단을 다시 켠다).
     탭바와 함께 있던 "현재 탭 다시 탭 = 맨 위로"도 사라졌다 - 되살리려면 본문을
     가리지 않는 형태로 따로 설계한다(style.css .scroll-top-btn 주석 참고). */

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
    if (window.StockSearchPanel) window.StockSearchPanel.wireSidebarSearch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
