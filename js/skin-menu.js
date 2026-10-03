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
        // 2026-09-05: 마켓브리핑(직접 쓴 해석) 바로 뒤에 둔다. 둘 다 "무슨 일이
        // 있었나"를 읽는 자리고, 지표 두 개는 그 다음에 숫자로 확인하는 순서다.
        // 실제 페이지는 /pages/(복수형)로 만들어져 있다. 티스토리는 둘 다 쓰이고 있고
        // (마켓·종목 메뉴에 /page/와 /pages/가 섞여 있다), skin-main.js의 로더는 두 형태를
        // 모두 잡지만 메뉴 링크는 하나뿐이라 실제 주소를 써야 404가 안 난다.
        { href: '/pages/main-news', label: '주요 뉴스' },
        { href: '/page/market-temp', label: '증시온도' },
        // 2026-09-06: '글로벌 시장지표'·'국내시장지표' 두 칸을 한 칸으로 합쳤다. 두 지면이
        // 코스피·코스닥을 각각 들고 있어 중복이었고, 이제 한 지면에서 버튼으로 오간다
        // (js/skin-main.js loadMarketIndicatorTabs). 옛 주소도 그대로 열린다.
        { href: '/pages/kospi-futures', label: '시장지표' }
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

  // 2026-10-03 사용자 요청(참고 이미지: 호버하면 아래로 둥근 카드가 펼쳐지고 항목마다 둥근 아이콘 타일):
  // PC(721px 이상)에서는 2차 메뉴 줄 대신 1차 메뉴 아래에 하위 메뉴 카드(.nav-dropdown)를 띄운다.
  // 모바일은 예전처럼 2차 메뉴 줄을 쓴다(카드는 CSS로 숨긴다).
  var NAV_ICON_PATHS = {
    briefing: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
    news: '<path d="M5 5h11v14H7a2 2 0 0 1-2-2z"/><path d="M16 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>',
    temp: '<path d="M12 4a2 2 0 0 0-2 2v7.5a4 4 0 1 0 4 0V6a2 2 0 0 0-2-2z"/><path d="M12 9v6"/>',
    indicators: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    stocks: '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>',
    analysis: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8.5 12.5l2-2 1.5 1.5 2-2.5"/>',
    pattern: '<path d="M8 4v16M16 6v14"/><rect x="6" y="8" width="4" height="7" rx="1"/><rect x="14" y="10" width="4" height="6" rx="1"/>',
    strategy: '<circle cx="12" cy="12" r="8"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };

  function navIconKey(item) {
    var href = String(item.href || '');
    if (href.indexOf('main-news') !== -1) return 'news';
    if (href.indexOf('view=stocks') !== -1) return 'stocks';
    if (href.indexOf('market-temp') !== -1) return 'temp';
    if (href.indexOf('kospi-futures') !== -1) return 'indicators';
    if (href.indexOf('foreign-flow') !== -1) return 'analysis';
    if (href.indexOf('pattern-scan') !== -1) return 'pattern';
    if (href.indexOf('strategy-search') !== -1) return 'strategy';
    if (item.label === '마켓브리핑') return 'briefing';
    return 'dot';
  }

  function dropdownHtml(item) {
    var links = item.children.map(function (child) {
      var active = isActive(child);
      return '<a class="nav-dd-item' + (active ? ' active' : '') + '" href="' + child.href + '" role="menuitem"'
        + (active ? ' aria-current="page"' : '') + '>'
        + '<span class="nav-dd-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        + NAV_ICON_PATHS[navIconKey(child)] + '</svg></span><span class="nav-dd-label">' + child.label + '</span></a>';
    }).join('');
    return '<div class="nav-dropdown"><div class="nav-dd-card" role="menu" aria-label="' + item.label + ' 하위 메뉴">' + links + '</div></div>';
  }

  var SEARCH_HTML = ''
    + '<div class="nav-search-wrap">'
    + '<div class="nav-search-input-wrap">'
    + '<button type="button" class="nav-search-icon" aria-label="검색"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 5 5"></path></svg></button>'
    + '<input type="text" id="navSearchInput" class="nav-search-input" placeholder="삼성전자 · NVDA 검색"'
    + ' aria-label="전체 종목 검색" autocomplete="off" />'
    + '</div>'
    // 2026-10-03 사용자 요청("검색창을 이렇게 혁신적으로 키워버리자"): 검색창을 누르면 화면 위쪽에 큰 검색 패널이
    // 펼쳐지고(입력 크게, 닫기 버튼, 바로가기 칩) 자동완성·즐겨찾기·최근 검색이 그 안에 나온다. 평소에는 칩·닫기가 숨는다.
    + '<button type="button" class="nav-search-close" aria-label="검색 닫기"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
    + '<div class="nav-search-chips" aria-label="바로가기">'
    + '<a href="/page/market-temp">증시온도</a><a href="/page/market-temp?view=stocks">국내 주요종목</a>'
    + '<a href="/page/foreign-flow">종목분석</a><a href="/page/pattern-scan">차트검색</a>'
    + '<a href="/page/strategy-search">전략검색</a><a href="/page/stock-calendar">캘린더</a>'
    + '<a href="/pages/main-news">주요 뉴스</a><a href="/page/watchlist">MY</a></div>'
    + '<div id="navSearchSuggest" class="nav-search-suggest"></div></div>';

  function wireBigSearch() {
    var input = document.getElementById('navSearchInput');
    var wrap = document.querySelector('.nav-search-wrap');
    if (!input || !wrap || wrap.getAttribute('data-big-wired') === '1') return;
    wrap.setAttribute('data-big-wired', '1');
    var root = document.documentElement;
    var backdrop = null;
    function open() {
      if (root.classList.contains('search-open')) return;
      root.classList.add('search-open');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'nav-search-backdrop';
        backdrop.addEventListener('click', close);
        document.body.appendChild(backdrop);
      }
    }
    function close() {
      root.classList.remove('search-open');
      if (backdrop) { backdrop.remove(); backdrop = null; }
      input.blur();
    }
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    var closeButton = wrap.querySelector('.nav-search-close');
    if (closeButton) closeButton.addEventListener('click', close);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
  }

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
    return '<div class="nav-group"><button type="button" class="' + cls + ' nav-group-trigger" data-group-index="' + index + '"'
      + ' aria-expanded="' + String(selected) + '" aria-controls="nav-secondary-row" aria-haspopup="true">'
      + '<span class="nav-item-label">' + item.label + '</span></button>' + dropdownHtml(item) + '</div>';
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

  function closeDropdowns(mount) {
    mount.querySelectorAll('.nav-group.is-open').forEach(function (group) {
      group.classList.remove('is-open');
      var button = group.querySelector('.nav-group-trigger');
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }

  function wireNavigation(mount) {
    document.addEventListener('click', function (event) {
      if (!event.target.closest || !event.target.closest('.nav-group')) closeDropdowns(mount);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDropdowns(mount);
    });
    mount.addEventListener('click', function (event) {
      var trigger = event.target.closest ? event.target.closest('.nav-group-trigger') : null;
      if (!trigger) return;
      // PC: 하위 메뉴는 호버·포커스로 열리는 카드다. 터치·클릭은 카드를 여닫기만 하고 줄을 다시 그리지 않는다.
      if (window.matchMedia && window.matchMedia('(min-width: 721px)').matches) {
        var group = trigger.closest('.nav-group');
        var willOpen = !group.classList.contains('is-open');
        closeDropdowns(mount);
        if (willOpen) group.classList.add('is-open');
        trigger.setAttribute('aria-expanded', String(willOpen));
        return;
      }
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

    // 2026-09-11: 운영 스킨을 저장소의 skin.html로 갱신해서(사용자 반영), 여기 있던
    // 런타임 우회 세 가지를 걷어냈다 - 옛 폰트 전환 버튼 제거, 옛 MY 아이콘 제거,
    // 로고 텍스트 덮어쓰기. 라이브 HTML 실측으로 셋 다 불필요함을 확인했다:
    // nav-icons에 #fontModeBtn·.nav-my-btn이 없고 .nav-logo-name이 이미 새 문구다.
    // 로고 이미지는 js/skin-shell.js의 refreshBrandIcon()이 맡는다(여기서 덮어쓰면
    // skin.html의 아이콘과 겹쳐 깜빡였다 - 2026-09-05).

    if (mount) {
      selectedGroupIndex = activeGroupIndex();
      renderMenu(mount);
      wireNavigation(mount);
    }
    if (window.StockSearchPanel) window.StockSearchPanel.wireSidebarSearch();
    wireBigSearch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
