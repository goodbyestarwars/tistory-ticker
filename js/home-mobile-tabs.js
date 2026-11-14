/**
 * 9Pay 모바일(≤720px) 하단 탭바 · 얇은 헤더 · 홈 섹션 좌우 스와이프 (2026-11-08).
 *
 * - body에 .m-tabs를 붙이면 css/home-mobile-tabs.css가 켜지고, 떼면 기존 모바일 화면으로 돌아간다(롤백 스위치).
 *   끄는 법: localStorage nineMobileTabs='off' 또는 주소 ?mtabs=off, 라이브에서는 NineMobileTabs.disable().
 *   영구 비활성은 js/skin-main.js의 loadMobileTabs 한 줄을 지운다.
 * - 1·2차 가로 메뉴는 숨기고(CSS) 항목은 더보기 서랍으로 옮긴다. 서랍은 #nav-menu-mount가 그린 메뉴를 읽어 만들고,
 *   투자도구 항목은 원래 링크의 click을 그대로 넘겨 기존 핸들러(js/skin-menu.js openInvestmentTool)를 쓴다.
 * - 홈: 시장 / 종목판 / 공시·뉴스 / 브리핑 / 경제이야기 5그룹. 이야기 원본만 푸터에서 이동하고
 *   나머지 섹션은 표시만 전환한다. 이동용 마운트는 카드가 아닌 레이아웃 컨테이너다.
 * 규칙 문서: docs/UI_GUIDE.md '모바일 하단 탭바'.
 */
(function (global) {
  'use strict';
  if (global.NineMobileTabs) return;

  var doc = document;
  var CLS = 'm-tabs';
  var MQ = '(max-width: 720px)';
  var EDGE_PX = 20; // 화면 왼쪽 끝 20px는 iOS 뒤로가기 제스처 몫이라 그룹 스와이프를 받지 않는다.

  // 장중(한국·미국) 그룹. 이야기 시리즈는 푸터의 .site-footer-learn을 #homeStorySeries로 옮겨 쓴다(복제하지 않는다).
  var OPEN_GROUPS = [
    { key: 'market', label: '시장', sel: '#homeMarketBoard' },
    { key: 'stocks', label: '종목판', sel: '#homeRealtimeBoard' },
    { key: 'news', label: '공시·뉴스', sel: '#homeEconomicNews' },
    { key: 'brief', label: '브리핑', sel: '.home-briefing-section' },
    { key: 'story', label: '경제이야기', sel: '#homeStorySeries' }
  ];
  // 휴장 그룹(#homeWeeklyReport). 원래 부모를 바꾸지 않고, 둘 이상을 한 쪽으로 묶는 휴장 머리말+지수만 래퍼(.mtab-pack)에 담는다.
  var CLOSED_GROUPS = [
    { key: 'c-rest', label: '휴장', pack: ['.wd-header', '.wd-index-section'] },
    { key: 'c-oil', label: '원자재', sel: '.wd-commodities' },
    { key: 'c-cal', label: '일정', sel: '.wd-calendar' },
    { key: 'c-coin', label: '가상자산', sel: '.wd-live-panel' },
    { key: 'c-news', label: '뉴스', sel: '.wd-news-section' },
    { key: 'c-brief', label: '브리핑', sel: '[data-wd-briefing]' },
    { key: 'c-story', label: '경제이야기', sel: '[data-wd-stories]' }
  ];
  var MODES = {
    open: { groups: OPEN_GROUPS, label: '홈 섹션', hashRe: /tab=(market|stocks|news|brief|story)\b/ },
    closed: { groups: CLOSED_GROUPS, label: '휴장 섹션', hashRe: /tab=(c-rest|c-oil|c-cal|c-coin|c-news|c-brief|c-story)\b/ }
  };

  // 자체 가로 제스처가 있는 요소. 'drag'는 JS가 직접 끄는 요소(차트), 빈 값은 가로 스크롤러.
  var NO_SWIPE = [
    ['.hrt-tabs', ''],
    ['.briefing-carousel-track', ''],
    ['#homeDisclosureList', ''],
    ['.hen-breaking-list', ''],
    ['.wd-indices', ''],
    ['.wd-news-track', ''],
    ['.learn-card-grid', ''],
    ['.home-index-chart', 'drag'],
    ['.hmb-investor-spark-wrap', 'drag']
  ];

  // 목록 헤더 sticky 대상: head=옮길 헤더, box=그 헤더가 속한 목록 영역.
  var STICKY = [
    { head: '.hrt-table-wrap thead th', box: '.hrt-table-wrap table' },
    { head: '.hen-period > h4', box: '.hen-period' }
  ];

  var ICON = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    market: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    stocks: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 11h8"/><path d="M7 16h3"/><path d="M7 6h12"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    briefing: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5M9.5 12H16M9.5 16H14"/>'
  };

  var mq = global.matchMedia ? global.matchMedia(MQ) : null;
  var bar = null;
  var drawer = null;
  var enabledOnce = false;
  var swipes = {};
  // 지금 화면에 보이는 스와이프(장중 그리드 또는 휴장 보고서).
  function liveSwipe() {
    var s = swipes.open && !swipes.open.grid.hidden ? swipes.open : (swipes.closed && !swipes.closed.grid.hidden ? swipes.closed : null);
    return s || swipes.open || swipes.closed || null;
  }

  /* ───────── 롤백 스위치 ───────── */
  function switchedOff() {
    try {
      if (global.localStorage && global.localStorage.getItem('nineMobileTabs') === 'off') return true;
    } catch (e) { /* 저장소 차단 환경 */ }
    return /[?&]mtabs=off\b/.test(location.search);
  }
  function eligible() {
    return !!(mq && mq.matches) && !switchedOff() && !doc.body.classList.contains('iframe-mode');
  }

  /* ───────── 현재 위치 → 탭 ───────── */
  function pathInfo() {
    var p;
    try { p = decodeURIComponent(location.pathname); } catch (e) { p = location.pathname; }
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return { path: p || '/', query: new URLSearchParams(location.search) };
  }
  function currentTab() {
    var info = pathInfo();
    var p = info.path;
    if (p === '/') return 'home';
    if (p === '/page/market-temp' || p === '/pages/market-temp') {
      return info.query.get('view') === 'stocks' ? 'stocks' : 'market';
    }
    if (/^\/(?:category\/마켓 ?브리핑|pages?\/(?:main-news|kospi-futures|overnight-market))$/.test(p)) return 'market';
    if (/^\/pages?\/(?:foreign-flow|pattern-scan|strategy-search|stock-search|dcf)$/.test(p)) return 'stocks';
    return '';
  }

  /* ───────── 하단 탭바 ───────── */
  function svg(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';
  }
  // 2026-11-11 접근 정책: 서버가 확인한 관리자만 기존 홈/시장/종목 탭, 그 외(판정 전·장애 포함)는 공개 4개 화면 탭.
  function limitedViewer() { return !(global.NineAccess && ['home','stocks','analysis','stock-search','market-temp','market-map'].some(function(key){return global.NineAccess.allowsScreen(key);})); }
  function limitedTab() {
    var key = global.NineAccess ? global.NineAccess.screenOf(location.pathname, location.search) : '';
    if (key === 'briefing' || key === 'news' || key === 'indicators') return 'market';
    return key === 'guestbook' || key === 'calendar' || key === 'home' ? key : '';
  }
  function barHtml() {
    var more = '<button type="button" class="mtab-bar-item" data-mtab="more" aria-haspopup="dialog" aria-expanded="false">' + svg('more') + '<span>더보기</span></button>';
    var access=global.NineAccess;
    function allowed(key){return access?access.allowsScreen(key):['briefing','news','calendar','guestbook'].indexOf(key)>=0;}
    function first(rows){return rows.filter(function(row){return allowed(row[0]);})[0];}
    function item(key,label,href,icon){return '<a class="mtab-bar-item" data-mtab="'+key+'" href="'+href+'">'+svg(icon)+'<span>'+label+'</span></a>';}
    var html=item('home','홈','/','home');
    var market=first([['market-temp','/page/market-temp'],['market-map','/page/market-temp?view=map'],['indicators','/pages/kospi-futures'],['briefing','/category/마켓 브리핑'],['news','/pages/main-news']]);
    if(market)html+=item('market','시장',market[1],'market');
    if(limitedViewer()){
      if(allowed('calendar'))html+=item('calendar','캘린더','/page/stock-calendar','calendar');
      if(allowed('guestbook'))html+=item('guestbook','대화방','/guestbook','chat');
    }else{
      var stock=first([['stocks','/page/market-temp?view=stocks'],['analysis','/page/foreign-flow'],['stock-search','/page/stock-search']]);
      if(stock)html+=item('stocks','종목',stock[1],'stocks');
    }
    return html+more;
  }

  function buildBar() {
    if (bar) return;
    bar = doc.createElement('nav');
    bar.className = 'mtab-bar';
    bar.id = 'mtabBar';
    bar.setAttribute('aria-label', '하단 메뉴');
    bar.innerHTML = barHtml();
    doc.body.appendChild(bar);
    // 정책 판정이 끝나면 탭 구성을 다시 맞춘다(관리자 ↔ 공개 4개).
    var refreshBar = function () { bar.innerHTML = barHtml(); syncBar(); syncAccount(); };
    if (global.NineAccess) global.NineAccess.ready.then(refreshBar);
    else global.addEventListener('nineaccess:ready', refreshBar, { once: true });
    global.addEventListener('nineaccess:change', refreshBar);
    bar.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('.mtab-bar-item') : null;
      if (!item) return;
      var tab = item.getAttribute('data-mtab');
      if (tab === 'more') { event.preventDefault(); openDrawer(); return; }
      // 홈에서 다시 누르면 맨 위(시장 그룹)로.
      if (tab === 'home' && currentTab() === 'home') {
        event.preventDefault();
        var live = liveSwipe();
        if (live) live.show(live.first(), true);
        global.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    syncBar();
    syncAccount();
  }
  function syncBar() {
    if (!bar) return;
    var current = limitedViewer() ? limitedTab() : currentTab();
    var drawerOpen = !!(drawer && !drawer.hidden);
    Array.prototype.forEach.call(bar.querySelectorAll('.mtab-bar-item'), function (item) {
      var key = item.getAttribute('data-mtab');
      var active = drawerOpen ? key === 'more' : key === current;
      item.classList.toggle('is-active', active);
      if (active && key !== 'more') item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    var more = bar.querySelector('[data-mtab="more"]');
    if (more) more.setAttribute('aria-expanded', String(drawerOpen));
  }

  /* ───────── 더보기 서랍 ───────── */
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function labelOf(node) {
    var l = node.querySelector ? node.querySelector('.nav-item-label, .nav-dd-label') : null;
    return (l || node).textContent.replace(/\s+/g, ' ').trim();
  }
  function link(item) {
    var tool = item.tool ? ' data-mtab-tool="' + esc(item.tool) + '"' : '';
    return '<a class="mtab-link' + (item.active ? ' is-active' : '') + '" href="' + esc(item.href) + '"' + tool
      + (item.active ? ' aria-current="page"' : '') + '>' + esc(item.label) + '</a>';
  }
  function section(title, items) {
    if (!items.length) return '';
    return '<section class="mtab-sec"><h3 class="mtab-sec-title">' + esc(title) + '</h3><div class="mtab-sec-list">'
      + items.map(link).join('') + '</div></section>';
  }
  // 메뉴 항목은 skin-menu.js가 그린 #nav-menu-mount에서 읽는다(항목 목록을 여기서 복제하지 않는다 → 손실·불일치 0).
  function menuSections() {
    var mount = doc.getElementById('nav-menu-mount');
    var html = '';
    var singles = [];
    if (mount) {
      Array.prototype.forEach.call(mount.querySelectorAll('.nav-primary-row .nav-primary-item'), function (node) {
        var group = node.closest('.nav-group');
        if (group) {
          var kids = Array.prototype.map.call(group.querySelectorAll('.nav-dd-item'), function (a) {
            return {
              href: a.getAttribute('href'), label: labelOf(a), tool: a.getAttribute('data-invest-tool'),
              active: a.classList.contains('active')
            };
          });
          html += section(labelOf(node), kids);
        } else {
          singles.push({
            href: node.getAttribute('href'), label: labelOf(node), active: node.classList.contains('nav-item-active')
          });
        }
      });
    }
    return section('바로가기', singles) + html;
  }
  function accountSection() {
    var items = [];
    var access = global.NineAccess;
    var policy = access && access.policy && access.policy();
    var authenticated = !!(policy && policy.authenticated);
    var status = authenticated ? (policy.isAdmin ? '관리자로 로그인됨' : '로그인됨') : policy ? '비회원으로 이용 중' : access && access.failed && access.failed() ? '로그인 상태 확인 실패' : '로그인 상태 확인 중';
    var admin = typeof global.__isBlogAdmin === 'function' && global.__isBlogAdmin();
    var defs = [
      ['.nav-manage-btn', authenticated ? '계정 · 블로그 관리' : '로그인', true],
      ['.nav-write-btn', '글쓰기', admin],
      ['.nav-logout-btn', authenticated ? '로그아웃' : '비회원 이용 종료', true]
    ];
    defs.forEach(function (d) {
      if (!d[2] || !doc.querySelector(d[0])) return;
      items.push('<button type="button" class="mtab-link" data-mtab-proxy="' + esc(d[0]) + '">' + esc(d[1]) + '</button>');
    });
    return items.length
      ? '<section class="mtab-sec"><h3 class="mtab-sec-title">계정</h3><p class="mtab-account-status" role="status">' + esc(status) + '</p><div class="mtab-sec-list">' + items.join('') + '</div></section>'
      : '';
  }
  function syncAccount() {
    var access = global.NineAccess;
    var policy = access && access.policy && access.policy();
    var button = doc.querySelector('.nav-logout-btn');
    if (button) {
      var label = policy && policy.authenticated ? '로그아웃' : '이용 종료';
      button.setAttribute('data-account-label', label);
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
    if (drawer && !drawer.hidden) drawer.querySelector('.mtab-drawer-body').innerHTML = menuSections() + accountSection();
  }
  function buildDrawer() {
    if (drawer) return;
    drawer = doc.createElement('div');
    drawer.className = 'mtab-drawer';
    drawer.id = 'mtabDrawer';
    drawer.hidden = true;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', '더보기 메뉴');
    drawer.innerHTML =
      '<div class="mtab-drawer-backdrop" data-mtab-close></div>' +
      '<div class="mtab-drawer-sheet">' +
        '<div class="mtab-drawer-head"><strong>메뉴</strong>' +
        '<button type="button" class="mtab-drawer-close" data-mtab-close aria-label="메뉴 닫기">×</button></div>' +
        '<div class="mtab-drawer-body"></div></div>';
    doc.body.appendChild(drawer);
    drawer.addEventListener('click', function (event) {
      var t = event.target;
      if (!t.closest) return;
      if (t.closest('[data-mtab-close]')) { closeDrawer(); return; }
      var tool = t.closest('[data-mtab-tool]');
      if (tool) {
        // 기존 투자도구 핸들러를 그대로 쓴다: 원래 메뉴의 같은 링크에 click을 넘긴다.
        event.preventDefault();
        var original = doc.querySelector('#nav-menu-mount [data-invest-tool="' + tool.getAttribute('data-mtab-tool') + '"]');
        closeDrawer();
        if (original) original.click();
        return;
      }
      var proxy = t.closest('[data-mtab-proxy]');
      if (proxy) {
        var target = doc.querySelector(proxy.getAttribute('data-mtab-proxy'));
        closeDrawer();
        if (target) target.click();
        return;
      }
      if (t.closest('a.mtab-link')) closeDrawer();
    });
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && drawer && !drawer.hidden) closeDrawer();
    });
  }
  var savedOverflow = null;
  function openDrawer() {
    buildDrawer();
    drawer.querySelector('.mtab-drawer-body').innerHTML = menuSections() + accountSection();
    drawer.hidden = false;
    if (savedOverflow === null) savedOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    var closeBtn = drawer.querySelector('.mtab-drawer-close');
    if (closeBtn) closeBtn.focus();
    syncBar();
    syncHide();
  }
  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    if (savedOverflow !== null) { doc.body.style.overflow = savedOverflow; savedOverflow = null; }
    syncBar();
    syncHide();
  }

  /* ───────── 탭바 숨김: 서랍·패널·모달·검색·키보드가 열려 있으면 ───────── */
  var OPEN_SEL = [
    '.mtab-drawer', 'html.search-open', 'html.wl-open', '.mobile-overlay.open', '.mobile-search-overlay.open',
    '.global-watchlist-drawer.is-open', '.account-login-modal', '[aria-modal="true"]'
  ].join(',');
  var keyboardOpen = false;
  var hideQueued = false;
  var baseViewport = 0;
  function overlayOpen() {
    var nodes = doc.querySelectorAll(OPEN_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === doc.documentElement) return true;
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') continue;
      if (n.getClientRects().length) return true;
    }
    return false;
  }
  function textInputFocused() {
    var a = doc.activeElement;
    if (!a || a === doc.body) return false;
    if (a.isContentEditable) return true;
    if (a.tagName === 'TEXTAREA') return true;
    if (a.tagName === 'INPUT') return !/^(?:checkbox|radio|button|submit|range|color|file|reset|image)$/i.test(a.type);
    return false;
  }
  function syncHide() {
    hideQueued = false;
    if (!doc.body.classList.contains(CLS)) return;
    doc.body.classList.toggle('mtab-hide', keyboardOpen || textInputFocused() || overlayOpen());
  }
  function queueHide() {
    if (hideQueued) return;
    hideQueued = true;
    (global.requestAnimationFrame || setTimeout)(syncHide);
  }
  function watchOverlays() {
    var opts = { attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'], subtree: true, childList: true };
    if (global.MutationObserver) {
      new MutationObserver(queueHide).observe(doc.body, opts);
      new MutationObserver(queueHide).observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    doc.addEventListener('focusin', queueHide);
    doc.addEventListener('focusout', function () { setTimeout(queueHide, 60); });
    var vv = global.visualViewport;
    if (vv) {
      baseViewport = Math.max(global.innerHeight || 0, vv.height);
      vv.addEventListener('resize', function () {
        // 키보드: 시각 뷰포트가 기준 높이보다 크게 줄면. 회전 등으로 기준이 커지면 갱신.
        if (vv.height > baseViewport) baseViewport = vv.height;
        keyboardOpen = baseViewport - vv.height > 120;
        queueHide();
      });
      global.addEventListener('orientationchange', function () { baseViewport = 0; setTimeout(function () { baseViewport = vv.height; }, 400); });
    }
  }

  /* ───────── 홈 섹션 스와이프 ───────── */
  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // 같은 스와이프 엔진을 장중 그리드(open)와 휴장 보고서(closed)에 한 번씩 올린다. 칩·점·높이·idle 규칙은 같다.
  function mountSwipe(grid, modeKey) {
    if (swipes[modeKey] || !grid) return;
    var mode = MODES[modeKey];
    var GROUPS = mode.groups;
    var dash = grid.parentNode;
    var panels = {};
    var chipsBox = doc.createElement('nav');
    chipsBox.className = 'mtab-chips';
    chipsBox.setAttribute('data-mtab-for', modeKey);
    chipsBox.setAttribute('aria-label', mode.label);
    chipsBox.innerHTML = '<div class="mtab-chip-row" role="tablist">' + GROUPS.map(function (g) {
      return '<button type="button" class="mtab-chip" role="tab" data-mtab-chip="' + g.key + '" aria-selected="false">' + esc(g.label) + '</button>';
    }).join('') + '</div><div class="mtab-dots" aria-hidden="true">' + GROUPS.map(function (g) {
      return '<span class="mtab-dot" data-mtab-dot="' + g.key + '"></span>';
    }).join('') + '</div>';
    dash.insertBefore(chipsBox, grid);

    var active = '';
    var programmatic = false;
    var settleTimer = 0;
    // 높이는 활성 섹션 하나만 지켜본다(비활성 패널은 크기를 재지 않는다).
    var heightObserver = global.ResizeObserver ? new ResizeObserver(function () { applyHeight(); queueStick(); }) : null;
    var observedPanel = null;

    // 휴장 머리말+지수처럼 한 쪽에 묶을 노드를 래퍼 하나에 담는다(보고서가 다시 그려지면 새 노드로 다시 묶는다).
    function packOf(g) {
      var nodes = g.pack.map(function (sel) { return grid.querySelector(':scope > ' + sel); }).filter(Boolean);
      var wrap = grid.querySelector(':scope > .mtab-pack[data-mtab-pack="' + g.key + '"]');
      if (!nodes.length) return wrap;
      if (!wrap) {
        wrap = doc.createElement('div');
        wrap.className = 'mtab-pack';
        wrap.setAttribute('data-mtab-pack', g.key);
        grid.insertBefore(wrap, nodes[0]);
      }
      nodes.forEach(function (n) { wrap.appendChild(n); });
      return wrap;
    }
    function collect() {
      GROUPS.forEach(function (g) {
        var node = g.pack ? packOf(g) : (modeKey === 'open' ? grid.querySelector(':scope > ' + g.sel) : grid.querySelector(g.sel));
        if (node && panels[g.key] !== node) {
          panels[g.key] = node;
          node.setAttribute('data-mtab-group', g.key);
        } else if (!node && panels[g.key] && !panels[g.key].isConnected) {
          delete panels[g.key]; // 휴장 보고서가 다시 그려져 사라진 노드
        }
      });
    }
    function visibleKeys() {
      return GROUPS.filter(function (g) { return panels[g.key] && !panels[g.key].hidden; }).map(function (g) { return g.key; });
    }
    function applyHeight() {
      var node = panels[active];
      if (!node) return;
      var h = Math.ceil(node.getBoundingClientRect().height);
      // 휴장 탭처럼 그리드가 숨겨진 동안은 높이가 0으로 재어진다. 그 값을 쓰면 다시 나타날 때 그리드가 접히므로 자동 높이로 둔다.
      if (h > 0) grid.style.setProperty('--mtab-panel-h', h + 'px');
      else grid.style.removeProperty('--mtab-panel-h');
    }
    // 칩이 한 줄에 다 안 들어가면(휴장 7개) 줄이 가로로 스크롤된다. 활성 칩을 가운데로 둔다.
    function centerChip(chip) {
      var row = chip.parentNode;
      if (!row || row.scrollWidth <= row.clientWidth + 1) return;
      var left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
      if (Math.abs(row.scrollLeft - left) > 2) row.scrollLeft = Math.max(0, left);
    }
    function paint() {
      var keys = visibleKeys();
      var at = keys.indexOf(active);
      GROUPS.forEach(function (g) {
        var panel = panels[g.key];
        if (panel) {
          // 활성 섹션과 바로 옆 섹션(스와이프로 보이는 쪽)만 그린다. 나머지는 CSS content-visibility로 레이아웃 제외.
          var idx = keys.indexOf(g.key);
          panel.classList.toggle('mtab-active', g.key === active);
          panel.classList.toggle('mtab-near', idx !== -1 && at !== -1 && Math.abs(idx - at) === 1);
          if (g.key === active) panel.removeAttribute('data-mtab-idle');
          else panel.setAttribute('data-mtab-idle', '1'); // 목록 모듈이 이 값을 보고 화면 갱신을 건너뛴다
        }
        var chip = chipsBox.querySelector('[data-mtab-chip="' + g.key + '"]');
        var dot = chipsBox.querySelector('[data-mtab-dot="' + g.key + '"]');
        var on = keys.indexOf(g.key) !== -1;
        if (chip) {
          chip.hidden = !on;
          chip.setAttribute('aria-selected', String(g.key === active));
          if (g.key === active && on) centerChip(chip);
        }
        if (dot) { dot.hidden = !on; dot.classList.toggle('is-active', g.key === active); }
      });
    }
    function offsetOf(node) {
      return node.getBoundingClientRect().left - grid.getBoundingClientRect().left + grid.scrollLeft;
    }
    function writeHash(key) {
      if (grid.hidden) return; // 지금 보이지 않는 스와이프는 주소를 바꾸지 않는다
      try {
        var next = key === GROUPS[0].key ? location.pathname + location.search : location.pathname + location.search + '#tab=' + key;
        if (next !== location.pathname + location.search + location.hash) global.history.replaceState(null, '', next);
      } catch (e) { /* 일부 WebView */ }
    }
    function setActive(key) {
      if (!panels[key] || key === active) return;
      active = key;
      paint();
      if (heightObserver && observedPanel !== panels[key]) {
        if (observedPanel) heightObserver.unobserve(observedPanel);
        observedPanel = panels[key];
        heightObserver.observe(observedPanel);
      }
      applyHeight();
      writeHash(key);
      queueStick();
      // 목록 모듈(종목판 등)이 비활성 동안 쌓인 값을 한 번 반영하도록 알린다. 새 구독·폴링은 없다.
      try { global.dispatchEvent(new CustomEvent('home-mtab-activate', { detail: { group: key } })); } catch (e) { /* 구형 WebView */ }
    }
    function show(key, smooth) {
      collect();
      if (!panels[key] || panels[key].hidden) key = visibleKeys()[0];
      if (!key) return;
      setActive(key);
      programmatic = true;
      grid.classList.add('is-travel'); // 이동 중에는 건너가는 섹션도 그려 둔다
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { programmatic = false; grid.classList.remove('is-travel'); }, smooth && !reducedMotion() ? 700 : 150);
      grid.scrollTo({ left: offsetOf(panels[key]), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
    }
    function scrollPageToTop() {
      var chipsH = chipsBox.getBoundingClientRect().height;
      var top = grid.getBoundingClientRect().top;
      if (top < chipsH) global.scrollTo({ top: Math.max(0, global.scrollY + top - chipsH), behavior: 'auto' });
    }

    // 목록 헤더 sticky. 가로 트랙(grid)이 스크롤 컨테이너라 CSS position:sticky가 세로 스크롤을 따라가지 못하므로,
    // 활성 섹션의 헤더를 칩 바로 아래에 붙도록 translateY로 옮긴다(목록 영역 안에서만).
    var stickQueued = false;
    function stick() {
      stickQueued = false;
      var panel = panels[active];
      if (!panel) return;
      var pin = chipsBox.getBoundingClientRect().bottom;
      STICKY.forEach(function (spec) {
        Array.prototype.forEach.call(panel.querySelectorAll(spec.head), function (head) {
          var box = head.closest(spec.box);
          if (!box) return;
          var rect = box.getBoundingClientRect();
          var room = rect.height - head.offsetHeight - (spec.tail || 0);
          var offset = Math.max(0, Math.min(pin - rect.top, room));
          head.style.transform = offset > 0 ? 'translateY(' + Math.round(offset) + 'px)' : '';
        });
      });
    }
    function queueStick() {
      if (stickQueued) return;
      stickQueued = true;
      (global.requestAnimationFrame || setTimeout)(stick);
    }
    global.addEventListener('scroll', queueStick, { passive: true });

    chipsBox.addEventListener('click', function (event) {
      var chip = event.target.closest ? event.target.closest('[data-mtab-chip]') : null;
      if (!chip) return;
      show(chip.getAttribute('data-mtab-chip'), true);
      scrollPageToTop(); // 탭 전환 시 상단으로
    });

    // 스크롤이 멈춘 자리에서 활성 그룹을 정한다(IntersectionObserver가 없거나 놓친 경우의 보정 포함).
    function settleFromScroll() {
      var best = '', bestDist = Infinity;
      visibleKeys().forEach(function (key) {
        var d = Math.abs(offsetOf(panels[key]) - grid.scrollLeft);
        if (d < bestDist) { bestDist = d; best = key; }
      });
      if (best) setActive(best);
    }
    grid.addEventListener('scroll', function () {
      if (programmatic) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(function () { programmatic = false; grid.classList.remove('is-travel'); settleFromScroll(); }, 120);
        return;
      }
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settleFromScroll, 120);
    }, { passive: true });

    var io = null;
    var observed = [];
    if (global.IntersectionObserver) {
      // 아래쪽을 크게 넓혀, 그룹 높이가 서로 달라 grid가 아래를 자르더라도 가로로 얼마나 보이는지만 본다.
      io = new IntersectionObserver(function (entries) {
        if (programmatic) return;
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            setActive(entry.target.getAttribute('data-mtab-group'));
          }
        });
      }, { root: grid, rootMargin: '0px 0px 20000px 0px', threshold: [0.55] });
    }

    // 왼쪽 가장자리 20px는 뒤로가기 제스처에 양보한다.
    grid.addEventListener('touchstart', function (event) {
      var t = event.touches && event.touches[0];
      grid.classList.toggle('is-edge', !!t && t.clientX < EDGE_PX);
    }, { passive: true });
    var clearEdge = function () { grid.classList.remove('is-edge'); };
    grid.addEventListener('touchend', clearEdge, { passive: true });
    grid.addEventListener('touchcancel', clearEdge, { passive: true });

    function markNoSwipe() {
      NO_SWIPE.forEach(function (pair) {
        Array.prototype.forEach.call(grid.querySelectorAll(pair[0]), function (node) {
          if (!node.hasAttribute('data-no-swipe')) node.setAttribute('data-no-swipe', pair[1]);
        });
      });
    }
    // 이야기 시리즈(장중 전용): 푸터의 .site-footer-learn을 홈 그리드의 #homeStorySeries로 옮긴다(복제하지 않는다).
    // 휴장 보고서가 같은 노드를 휴장 쪽으로 옮겨 가는 동안(is-market-closed)에는 건드리지 않고, 복원되면 다시 가져온다.
    var storySlot = null;
    function adoptStory() {
      var mount = grid.querySelector(':scope > #homeStorySeries');
      if (!mount) {
        mount = doc.createElement('section');
        mount.id = 'homeStorySeries';
        mount.className = 'home-story-section'; // 원본 .site-footer-learn만 카드: 이중 테두리·상단 56px 패딩 방지
        mount.hidden = true;
        grid.appendChild(mount);
      }
      var node = doc.querySelector('.site-footer-learn');
      if (!node) return;
      if (mount.contains(node)) { mount.hidden = false; return; }
      var footer = node.closest ? node.closest('.site-footer') : null;
      if (!footer || dash.classList.contains('is-market-closed')) return;
      storySlot = doc.createComment('mtab-story-slot');
      node.parentNode.insertBefore(storySlot, node);
      footer.setAttribute('data-weekend-learn-slot', ''); // 푸터 레이아웃 규칙이 학습 카드 유무와 무관하게 유지되도록(휴장 보고서와 같은 방식)
      mount.appendChild(node);
      mount.hidden = false;
    }
    function releaseStory() {
      var mount = grid.querySelector(':scope > #homeStorySeries');
      var node = doc.querySelector('.site-footer-learn');
      if (!mount || !node || !mount.contains(node) || !storySlot || !storySlot.parentNode) return;
      var footer = storySlot.parentNode;
      footer.insertBefore(node, storySlot);
      storySlot.remove();
      storySlot = null;
      if (footer.removeAttribute) footer.removeAttribute('data-weekend-learn-slot');
      mount.hidden = true;
    }

    var lastShown = !grid.hidden;
    var refreshQueued = false;
    function refresh() {
      refreshQueued = false;
      if (modeKey === 'open') adoptStory();
      collect();
      if (io) GROUPS.forEach(function (g) {
        var node = panels[g.key];
        if (node && observed.indexOf(node) === -1) { observed.push(node); io.observe(node); }
      });
      markNoSwipe();
      chipsBox.hidden = !!grid.hidden;
      var nowShown = !grid.hidden;
      if (nowShown && !lastShown && active && panels[active]) {
        // 숨겨졌다 다시 나타나면 가로 위치가 0으로 돌아가 있다. 활성 그룹 자리로 되돌리고 주소도 맞춘다.
        grid.scrollTo({ left: offsetOf(panels[active]), behavior: 'auto' });
        writeHash(active);
      }
      lastShown = nowShown;
      if (!active && visibleKeys().length) {
        // 마운트 때는 내용이 없던 휴장 보고서가 나중에 그려진 경우: 해시 또는 첫 그룹을 활성으로 잡는다.
        var hm = mode.hashRe.exec(location.hash);
        show((hm && panels[hm[1]] && !panels[hm[1]].hidden) ? hm[1] : visibleKeys()[0], false);
      } else if (active && (!panels[active] || panels[active].hidden)) { active = ''; show(visibleKeys()[0], false); }
      paint();
      applyHeight();
    }
    function queueRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      // 렌더링 주기(rAF)가 멈춘 배경 탭에서도 높이를 맞추도록 타이머를 쓴다. ResizeObserver는 활성 섹션 보정용으로 따로 둔다.
      setTimeout(refresh, 60);
    }
    if (global.MutationObserver) {
      new MutationObserver(queueRefresh).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      if (modeKey === 'open') {
        // 장중↔휴장 전환: 휴장 보고서가 이야기 시리즈를 돌려놓는 시점(최대 1.5초 뒤 한 번 더 맞춘다)에 다시 가져온다.
        new MutationObserver(function () { queueRefresh(); setTimeout(queueRefresh, 1700); }).observe(dash, { attributes: true, attributeFilter: ['class'] });
      }
    }
    // 푸터의 이야기 시리즈는 스킨 스크립트가 늦게 그릴 수 있어 몇 번 더 확인한다.
    if (modeKey === 'open') [400, 1500, 3500, 8000].forEach(function (t) { setTimeout(queueRefresh, t); });
    global.addEventListener('resize', function () {
      if (!active || !panels[active]) return;
      grid.scrollTo({ left: offsetOf(panels[active]), behavior: 'auto' });
      applyHeight();
    });
    global.addEventListener('hashchange', function () {
      if (grid.hidden) return;
      var m = mode.hashRe.exec(location.hash);
      show(m ? m[1] : GROUPS[0].key, true);
    });

    grid.classList.add('mtab-swipe');
    collect();
    refresh();
    var m = mode.hashRe.exec(location.hash);
    var first = (m && panels[m[1]] && !panels[m[1]].hidden) ? m[1] : (visibleKeys()[0] || GROUPS[0].key);
    active = '';
    setActive(first);
    // 레이아웃이 잡힌 뒤 해시 위치로 즉시 이동.
    (global.requestAnimationFrame || setTimeout)(function () { show(first, false); });

    swipes[modeKey] = {
      show: show, refresh: refresh, grid: grid,
      active: function () { return active; },
      first: function () { return visibleKeys()[0] || GROUPS[0].key; },
      release: releaseStory
    };
  }

  function placeFuturesPair(inMarket) {
    var pair=doc.querySelector('[data-home-futures-pair]'),market=doc.getElementById('homeMarketBoard'),grid=doc.querySelector('.home-dashboard > .home-widget-grid');
    if(!pair||!market||!grid)return;
    if(inMarket){if(pair.parentNode!==market)market.appendChild(pair);}
    else if(pair.parentNode===market){grid.insertBefore(pair,doc.getElementById('homeRealtimeBoard'));}
  }

  function waitForGrid() {
    if (!doc.querySelector('.home-dashboard')) return;
    function tryMount() {
      placeFuturesPair(true);
      mountSwipe(doc.querySelector('.home-dashboard > .home-widget-grid'), 'open');
      mountSwipe(doc.getElementById('homeWeeklyReport'), 'closed');
      return !!(swipes.open && swipes.closed);
    }
    if (tryMount() || !global.MutationObserver) return;
    var stop = setTimeout(function () { mo.disconnect(); }, 60000);
    var mo = new MutationObserver(function () {
      if (!tryMount()) return;
      mo.disconnect();
      clearTimeout(stop);
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  /* ───────── 켜고 끄기 ───────── */
  function enable() {
    if (!eligible()) return false;
    doc.body.classList.add(CLS);
    placeFuturesPair(true);
    if (!enabledOnce) {
      enabledOnce = true;
      buildBar();
      buildDrawer();
      watchOverlays();
      waitForGrid();
    }
    Object.keys(swipes).forEach(function (k) { swipes[k].refresh(); }); // 다시 켜질 때 이야기 시리즈를 다시 가져온다
    syncBar();
    queueHide();
    return true;
  }
  function disable() {
    placeFuturesPair(false);
    Object.keys(swipes).forEach(function (k) { if (swipes[k].release) swipes[k].release(); }); // 푸터의 이야기 시리즈를 제자리로
    closeDrawer();
    doc.body.classList.remove(CLS, 'mtab-hide');
  }

  function init() {
    enable();
    var onChange = function () { if (mq.matches) enable(); else disable(); };
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
      // 일부 환경은 미디어쿼리 change를 늦게 주거나 빠뜨린다(회전·창 크기 변경). resize로 한 번 더 맞춘다 - 둘 다 멱등.
      global.addEventListener('resize', onChange);
    }
  }

  global.NineMobileTabs = {
    enable: enable,
    disable: disable,
    openMore: openDrawer,
    closeMore: closeDrawer,
    show: function (key, smooth) { var live = liveSwipe(); if (live) live.show(key, smooth); },
    state: function () { return { enabled: doc.body.classList.contains(CLS), tab: currentTab(), group: liveSwipe() ? liveSwipe().active() : '' }; }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
