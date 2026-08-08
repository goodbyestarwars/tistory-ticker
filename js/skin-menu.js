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
        { href: '/pages/kospi-futures', label: '코스피 선물' }
      ]
    },
    { href: '/page/stock-search', label: '종목' },
    {
      label: '종목검색',
      children: [
        { href: '/page/pattern-scan', label: '차트검색' },
        { href: '/page/strategy-search', label: '전략검색' }
      ]
    },
    { href: '/page/stock-calendar', label: '캘린더' },
    { href: '/guestbook', label: '커뮤니티' }
  ];

  // 기존 직접 링크는 유지한다. 상단 메뉴에서는 숨기지만 북마크·검색 결과가
  // 사용하는 페이지 주소를 바꾸지 않아 기존 진입 경로가 끊기지 않게 한다.
  var LEGACY_PAGE_URLS = ['/page/foreign-flow', '/page/stock-search'];

  var SEARCH_HTML = ''
    + '<div class="nav-search-wrap">'
    + '<div class="nav-search-input-wrap">'
    + '<span class="nav-search-icon" aria-hidden="true">🔍</span>'
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
    if (!parts[1]) return true;
    return new URLSearchParams(location.search).get('market') === 'us';
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

  function render() {
    var searchMount = document.getElementById('navSearchMount');
    var mount = document.getElementById('nav-menu-mount');
    if (searchMount) searchMount.innerHTML = SEARCH_HTML;

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
