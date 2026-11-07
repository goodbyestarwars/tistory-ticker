/**
 * 9Pay 모바일(≤720px) 하단 탭바 · 얇은 헤더 · 홈 섹션 좌우 스와이프 (2026-11-08).
 *
 * - body에 .m-tabs를 붙이면 css/home-mobile-tabs.css가 켜지고, 떼면 기존 모바일 화면으로 돌아간다(롤백 스위치).
 *   끄는 법: localStorage nineMobileTabs='off' 또는 주소 ?mtabs=off, 라이브에서는 NineMobileTabs.disable().
 *   영구 비활성은 js/skin-main.js의 loadMobileTabs 한 줄을 지운다.
 * - 1·2차 가로 메뉴는 숨기고(CSS) 항목은 더보기 서랍으로 옮긴다. 서랍은 #nav-menu-mount가 그린 메뉴를 읽어 만들고,
 *   투자도구 항목은 원래 링크의 click을 그대로 넘겨 기존 핸들러(js/skin-menu.js openInvestmentTool)를 쓴다.
 * - 홈: 시장 / 종목판 / 공시·뉴스 / 브리핑 4그룹을 .home-widget-grid 직속 섹션의 표시 전환만으로 만든다.
 *   DOM은 옮기지 않으므로 ID·이벤트·전역 객체 계약은 그대로다(순서는 CSS order).
 * 규칙 문서: docs/UI_GUIDE.md '모바일 하단 탭바'.
 */
(function (global) {
  'use strict';
  if (global.NineMobileTabs) return;

  var doc = document;
  var CLS = 'm-tabs';
  var MQ = '(max-width: 720px)';
  var EDGE_PX = 20; // 화면 왼쪽 끝 20px는 iOS 뒤로가기 제스처 몫이라 그룹 스와이프를 받지 않는다.

  var GROUPS = [
    { key: 'market', label: '시장', sel: '#homeMarketBoard' },
    { key: 'stocks', label: '종목판', sel: '#homeRealtimeBoard' },
    { key: 'news', label: '공시·뉴스', sel: '#homeEconomicNews' },
    { key: 'brief', label: '브리핑', sel: '.home-briefing-section' }
  ];

  // 자체 가로 제스처가 있는 요소. 'drag'는 JS가 직접 끄는 요소(차트), 빈 값은 가로 스크롤러.
  var NO_SWIPE = [
    ['.hrt-tabs', ''],
    ['.briefing-carousel-track', ''],
    ['#homeDisclosureList', ''],
    ['.hen-breaking-list', ''],
    ['.home-index-chart', 'drag'],
    ['.hmb-investor-spark-wrap', 'drag']
  ];

  var ICON = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    market: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    stocks: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 11h8"/><path d="M7 16h3"/><path d="M7 6h12"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };

  var mq = global.matchMedia ? global.matchMedia(MQ) : null;
  var bar = null;
  var drawer = null;
  var enabledOnce = false;
  var swipe = null;

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
  function buildBar() {
    if (bar) return;
    bar = doc.createElement('nav');
    bar.className = 'mtab-bar';
    bar.id = 'mtabBar';
    bar.setAttribute('aria-label', '하단 메뉴');
    bar.innerHTML =
      '<a class="mtab-bar-item" data-mtab="home" href="/">' + svg('home') + '<span>홈</span></a>' +
      '<a class="mtab-bar-item" data-mtab="market" href="/page/market-temp">' + svg('market') + '<span>시장</span></a>' +
      '<a class="mtab-bar-item" data-mtab="stocks" href="/page/market-temp?view=stocks">' + svg('stocks') + '<span>종목</span></a>' +
      '<button type="button" class="mtab-bar-item" data-mtab="more" aria-haspopup="dialog" aria-expanded="false">' + svg('more') + '<span>더보기</span></button>';
    doc.body.appendChild(bar);
    bar.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('.mtab-bar-item') : null;
      if (!item) return;
      var tab = item.getAttribute('data-mtab');
      if (tab === 'more') { event.preventDefault(); openDrawer(); return; }
      // 홈에서 다시 누르면 맨 위(시장 그룹)로.
      if (tab === 'home' && currentTab() === 'home') {
        event.preventDefault();
        if (swipe) swipe.show('market', true);
        global.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    syncBar();
  }
  function syncBar() {
    if (!bar) return;
    var current = currentTab();
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
    var admin = typeof global.__isBlogAdmin === 'function' && global.__isBlogAdmin();
    var defs = [
      ['.nav-manage-btn', '관리자 · 로그인', true],
      ['.nav-write-btn', '글쓰기', admin],
      ['.nav-logout-btn', '로그아웃', admin]
    ];
    defs.forEach(function (d) {
      if (!d[2] || !doc.querySelector(d[0])) return;
      items.push('<button type="button" class="mtab-link" data-mtab-proxy="' + esc(d[0]) + '">' + esc(d[1]) + '</button>');
    });
    return items.length
      ? '<section class="mtab-sec"><h3 class="mtab-sec-title">계정</h3><div class="mtab-sec-list">' + items.join('') + '</div></section>'
      : '';
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
  function mountSwipe(grid) {
    if (swipe || !grid) return;
    var dash = grid.parentNode;
    var panels = {};
    var chipsBox = doc.createElement('nav');
    chipsBox.className = 'mtab-chips';
    chipsBox.setAttribute('aria-label', '홈 섹션');
    chipsBox.innerHTML = '<div class="mtab-chip-row" role="tablist">' + GROUPS.map(function (g) {
      return '<button type="button" class="mtab-chip" role="tab" data-mtab-chip="' + g.key + '" aria-selected="false">' + esc(g.label) + '</button>';
    }).join('') + '</div><div class="mtab-dots" aria-hidden="true">' + GROUPS.map(function (g) {
      return '<span class="mtab-dot" data-mtab-dot="' + g.key + '"></span>';
    }).join('') + '</div>';
    dash.insertBefore(chipsBox, grid);

    var active = '';
    var programmatic = false;
    var settleTimer = 0;
    var heightObserver = global.ResizeObserver ? new ResizeObserver(function () { applyHeight(); }) : null;

    function collect() {
      GROUPS.forEach(function (g) {
        var node = grid.querySelector(':scope > ' + g.sel);
        if (node && panels[g.key] !== node) {
          panels[g.key] = node;
          node.setAttribute('data-mtab-group', g.key);
          if (heightObserver) heightObserver.observe(node);
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
    function paint() {
      var keys = visibleKeys();
      GROUPS.forEach(function (g) {
        var chip = chipsBox.querySelector('[data-mtab-chip="' + g.key + '"]');
        var dot = chipsBox.querySelector('[data-mtab-dot="' + g.key + '"]');
        var on = keys.indexOf(g.key) !== -1;
        if (chip) { chip.hidden = !on; chip.setAttribute('aria-selected', String(g.key === active)); }
        if (dot) { dot.hidden = !on; dot.classList.toggle('is-active', g.key === active); }
      });
    }
    function offsetOf(node) {
      return node.getBoundingClientRect().left - grid.getBoundingClientRect().left + grid.scrollLeft;
    }
    function writeHash(key) {
      try {
        var next = key === 'market' ? location.pathname + location.search : location.pathname + location.search + '#tab=' + key;
        if (next !== location.pathname + location.search + location.hash) global.history.replaceState(null, '', next);
      } catch (e) { /* 일부 WebView */ }
    }
    function setActive(key) {
      if (!panels[key] || key === active) return;
      active = key;
      paint();
      applyHeight();
      writeHash(key);
    }
    function show(key, smooth) {
      collect();
      if (!panels[key] || panels[key].hidden) key = visibleKeys()[0];
      if (!key) return;
      setActive(key);
      programmatic = true;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { programmatic = false; }, smooth && !reducedMotion() ? 700 : 150);
      grid.scrollTo({ left: offsetOf(panels[key]), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
    }
    function scrollPageToTop() {
      var chipsH = chipsBox.getBoundingClientRect().height;
      var top = grid.getBoundingClientRect().top;
      if (top < chipsH) global.scrollTo({ top: Math.max(0, global.scrollY + top - chipsH), behavior: 'auto' });
    }

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
        settleTimer = setTimeout(function () { programmatic = false; settleFromScroll(); }, 120);
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
    var refreshQueued = false;
    function refresh() {
      refreshQueued = false;
      collect();
      if (io) GROUPS.forEach(function (g) {
        var node = panels[g.key];
        if (node && observed.indexOf(node) === -1) { observed.push(node); io.observe(node); }
      });
      markNoSwipe();
      if (active && (!panels[active] || panels[active].hidden)) { active = ''; show(visibleKeys()[0], false); }
      paint();
      applyHeight();
    }
    function queueRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      (global.requestAnimationFrame || setTimeout)(refresh);
    }
    if (global.MutationObserver) {
      new MutationObserver(queueRefresh).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
    global.addEventListener('resize', function () {
      if (!active || !panels[active]) return;
      grid.scrollTo({ left: offsetOf(panels[active]), behavior: 'auto' });
      applyHeight();
    });
    global.addEventListener('hashchange', function () {
      var m = /tab=(market|stocks|news|brief)\b/.exec(location.hash);
      show(m ? m[1] : 'market', true);
    });

    grid.classList.add('mtab-swipe');
    collect();
    refresh();
    var m = /tab=(market|stocks|news|brief)\b/.exec(location.hash);
    var first = (m && panels[m[1]] && !panels[m[1]].hidden) ? m[1] : (visibleKeys()[0] || 'market');
    active = '';
    setActive(first);
    // 레이아웃이 잡힌 뒤 해시 위치로 즉시 이동.
    (global.requestAnimationFrame || setTimeout)(function () { show(first, false); });

    swipe = { show: show, refresh: refresh, active: function () { return active; }, grid: grid };
  }

  function waitForGrid() {
    if (!doc.querySelector('.home-dashboard')) return;
    function find() { return doc.querySelector('.home-dashboard > .home-widget-grid'); }
    var grid = find();
    if (grid) { mountSwipe(grid); return; }
    if (!global.MutationObserver) return;
    var stop = setTimeout(function () { mo.disconnect(); }, 60000);
    var mo = new MutationObserver(function () {
      var g = find();
      if (!g) return;
      mo.disconnect();
      clearTimeout(stop);
      mountSwipe(g);
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  /* ───────── 켜고 끄기 ───────── */
  function enable() {
    if (!eligible()) return false;
    doc.body.classList.add(CLS);
    if (!enabledOnce) {
      enabledOnce = true;
      buildBar();
      buildDrawer();
      watchOverlays();
      waitForGrid();
    }
    syncBar();
    queueHide();
    return true;
  }
  function disable() {
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
    show: function (key, smooth) { if (swipe) swipe.show(key, smooth); },
    state: function () { return { enabled: doc.body.classList.contains(CLS), tab: currentTab(), group: swipe ? swipe.active() : '' }; }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
