/**
 * 9Pay 공통 내비게이션.
 * 1차 메뉴는 의사결정 흐름에 맞춘 6개만 노출하고 기존 페이지 URL은 그대로 유지한다.
 */
(function () {
  'use strict';

  var NAV_ITEMS = [
    { href: '/', label: '홈' },
    {
      label: '시장',
      children: [
        { href: '/category/마켓 브리핑', label: '마켓 브리핑' },
        { href: '/page/market-temp', label: '증시온도' },
        { href: '/pages/overnight-market', label: '글로벌 시장지표' },
        { href: '/pages/kospi-futures', label: '코스피 선물' }
      ]
    },
    {
      label: '종목',
      children: [
        { href: '/page/foreign-flow', label: '종목분석' },
        { href: '/page/stock-search', label: '실시간 시세' }
      ]
    },
    {
      label: '패턴·발굴',
      children: [
        { href: '/page/pattern-scan', label: '차트패턴 스캐너' }
      ]
    },
    { href: '/page/stock-calendar', label: '캘린더' },
    { href: '/guestbook', label: '커뮤니티' }
  ];

  var SEARCH_HTML = ''
    + '<div class="nav-search-wrap">'
    + '<div class="nav-search-input-wrap">'
    + '<span class="nav-search-icon" aria-hidden="true">🔍</span>'
    + '<input type="text" id="navSearchInput" class="nav-search-input" placeholder="종목검색"'
    + ' aria-label="전체 종목 검색" autocomplete="off" />'
    + '</div><div id="navSearchSuggest" class="nav-search-suggest"></div></div>';

  function currentPath() {
    var path;
    try { path = decodeURIComponent(location.pathname); } catch (err) { path = location.pathname; }
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return path || '/';
  }

  function isActive(item) {
    return Boolean(item.href && currentPath() === item.href);
  }

  function groupIsActive(item) {
    return Boolean(item.children && item.children.some(isActive));
  }

  function directHtml(item) {
    var active = isActive(item);
    return '<a class="nav-item nav-primary-item' + (active ? ' nav-item-home' : '') + '"'
      + ' href="' + item.href + '"' + (active ? ' aria-current="page"' : '') + '>'
      + '<span class="nav-item-label">' + item.label + '</span></a>';
  }

  function groupHtml(item, index) {
    var active = groupIsActive(item);
    var menuId = 'navDropdown-' + index;
    var children = item.children.map(function (child) {
      var childActive = isActive(child);
      return '<a class="nav-dropdown-item' + (childActive ? ' active' : '') + '" href="' + child.href + '"'
        + (childActive ? ' aria-current="page"' : '') + ' role="menuitem">'
        + child.label + '</a>';
    }).join('');
    return '<div class="nav-group' + (active ? ' nav-group-active' : '') + '">'
      + '<button type="button" class="nav-item nav-primary-item nav-group-trigger'
      + (active ? ' nav-item-home' : '') + '" aria-haspopup="true" aria-expanded="false"'
      + ' aria-controls="' + menuId + '"><span class="nav-item-label">' + item.label + '</span>'
      + '<span class="nav-chevron" aria-hidden="true">⌄</span></button>'
      + '<div class="nav-dropdown" id="' + menuId + '" role="menu" aria-label="' + item.label + ' 하위 메뉴">'
      + children + '</div></div>';
  }

  function closeGroups(mount, except) {
    mount.querySelectorAll('.nav-group-open').forEach(function (group) {
      if (group === except) return;
      group.classList.remove('nav-group-open');
      var trigger = group.querySelector('.nav-group-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
    syncMobileHeight(mount);
  }

  function syncMobileHeight(mount) {
    var open = mount.querySelector('.nav-group-open, .nav-group-active');
    document.documentElement.classList.toggle('nav-mobile-submenu-open', Boolean(open));
  }

  function wireNavigation(mount) {
    mount.addEventListener('click', function (event) {
      var trigger = event.target.closest ? event.target.closest('.nav-group-trigger') : null;
      if (!trigger) return;
      var group = trigger.closest('.nav-group');
      var willOpen = !group.classList.contains('nav-group-open');
      closeGroups(mount, group);
      group.classList.toggle('nav-group-open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
      syncMobileHeight(mount);
      if (willOpen) group.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });

    document.addEventListener('click', function (event) {
      if (!mount.contains(event.target)) closeGroups(mount);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var openTrigger = mount.querySelector('.nav-group-open .nav-group-trigger');
      closeGroups(mount);
      if (openTrigger) openTrigger.focus();
    });
    syncMobileHeight(mount);
  }

  function render() {
    var searchMount = document.getElementById('navSearchMount');
    var mount = document.getElementById('nav-menu-mount');
    if (searchMount) searchMount.innerHTML = SEARCH_HTML;

    if (mount) {
      mount.innerHTML = (searchMount ? '' : SEARCH_HTML) + NAV_ITEMS.map(function (item, index) {
        return item.children ? groupHtml(item, index) : directHtml(item);
      }).join('');
      wireNavigation(mount);
    }
    if (window.StockSearchPanel) window.StockSearchPanel.wireSidebarSearch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
