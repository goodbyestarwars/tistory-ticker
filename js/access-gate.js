/**
 * 9Pay 화면 접근 게이트 (2026-11-11).
 *
 * 인증 상태·화면 허용 여부의 단일 출처는 Oracle `/access-policy`(서버가 /auth/google/me 와 같은
 * 세션 쿠키로 판정)다. 이 파일은 그 결과를 한 번만 조회해 공유하고(NineAccess.ready), 메뉴·직접 URL·
 * 전역 도구(검색/관심종목/메모)가 같은 판정을 쓰게 한다. 브라우저 값(티스토리 ROLE 등)은 판정에 쓰지 않는다.
 *
 * - 조회 실패/장애: 비로그인(공개 3개 화면만)으로 취급한다 - 보호 화면을 임시로 열지 않는다.
 * - 데이터 보호는 서버(REST 401/403, WebSocket 거절)가 한다. 이 파일은 화면 껍데기 정책이다.
 * - 롤백: 이 파일 로드를 끊으면 기존 화면이 그대로 나온다. 단 서버 API 제한은 유지된다(공개로 되돌리지 않는다).
 */
(function (global) {
  'use strict';
  if (global.NineAccess) return;

  var API = 'https://goodbyestar.cloud';
  var POLICY_URL = API + '/access-policy';
  var FALLBACK = '/guestbook';
  var FROM_KEY = 'nine_access_from';
  var doc = global.document;
  var PUBLIC = ['guestbook', 'calendar', 'briefing']; // 시장지표(indicators)는 로그인 후(서버 level=member)

  /* ───── 경로 → 화면 키. 알 수 없는 경로(일반 글·기타 페이지)는 '' = 정책 대상 아님 ───── */
  function norm(path) {
    var p;
    try { p = decodeURIComponent(path || '/'); } catch (e) { p = path || '/'; }
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p || '/';
  }
  function screenOf(path, search) {
    var p = norm(path);
    var q = new URLSearchParams(search || '');
    if (p === '/') return 'home';
    if (/^\/guestbook(?:\/|$)/.test(p)) return 'guestbook';
    if (/^\/pages?\/stock-calendar$/.test(p)) return 'calendar';
    if (/^\/category\/마켓 ?브리핑(?:\/|$)/.test(p)) return 'briefing';
    if (/^\/pages?\/(?:kospi-futures|overnight-market)$/.test(p)) return 'indicators';
    if (/^\/pages?\/main-news$/.test(p)) return 'market-temp';
    if (/^\/pages?\/market-temp$/.test(p)) return q.get('view') === 'stocks' ? 'stocks' : 'market-temp';
    if (/^\/pages?\/stock-search$/.test(p)) return q.get('tool') === 'independent-chart' ? 'tools' : 'stocks';
    if (/^\/pages?\/(?:foreign-flow|pattern-scan|strategy-search|dcf)(?:\/|$)/.test(p)) return 'stocks';
    if (/^\/pages?\/watchlist$/.test(p)) return 'my';
    if (/^\/pages?\/auto-trader$/.test(p)) return 'autotrader';
    return '';
  }
  function screenOfHref(href) {
    href = String(href || '');
    if (href === '#averaging-calculator' || href === '#nasdaq-fx-calculator' || href === '#access-settings') {
      return href === '#access-settings' ? '@admin' : 'tools';
    }
    if (/^https?:\/\/goodbyestar\.cloud\/kis-tool/.test(href)) return 'kis';
    if (href === '#story-series') return ''; // 이야기 시리즈(푸터 카드 영역): 공개
    // 같은 사이트의 상대 경로는 직접 분해한다(origin이 'null'인 문서·파싱 실패에도 같은 판정).
    if (href.charAt(0) === '/') {
      var hashAt = href.indexOf('#');
      if (hashAt >= 0) href = href.slice(0, hashAt);
      var qAt = href.indexOf('?');
      return screenOf(qAt >= 0 ? href.slice(0, qAt) : href, qAt >= 0 ? href.slice(qAt) : '');
    }
    try {
      var u = new URL(href);
      if (!/(^|\.)ghlee\.tistory\.com$/.test(u.hostname)) return '';
      return screenOf(u.pathname, u.search);
    } catch (e) { return ''; }
  }

  /* ───── 상태 ───── */
  var current = null; // 서버 응답(data). 조회 전/실패는 null
  var failed = false;
  function allowsScreen(key) {
    if (!key) return true;
    if (key === '@admin') return !!(current && current.isAdmin);
    if (current && current.screens && current.screens[key]) return !!current.screens[key].allowed;
    return PUBLIC.indexOf(key) >= 0; // 조회 전·실패: 공개 4개만
  }
  function isAdmin() { return !!(current && current.isAdmin); }

  /* 메뉴 첫 그림용 임시 판정: 직전 방문에서 서버가 확인한 허용 화면을 기억해 둔다(깜빡임·탭 늦게 붙는 현상 방지).
     화면 접근 판정(allowsScreen·run·리다이렉트)에는 쓰지 않는다 - 서버 응답이 오면 곧바로 확정값으로 다시 그린다. */
  var CACHE_KEY = 'nine_policy_cache';
  var cached = null;
  try { cached = JSON.parse(global.localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { cached = null; }
  function cacheWrite(data) {
    try {
      var map = {};
      Object.keys(data.screens).forEach(function (k) { map[k] = !!data.screens[k].allowed; });
      global.localStorage.setItem(CACHE_KEY, JSON.stringify({ a: map }));
    } catch (e) { /* 저장소 차단 */ }
  }
  function menuAllowsScreen(key) {
    if (!key) return true;
    if (current) return allowsScreen(key);
    if (key === '@admin') return false;
    if (cached && cached.a && Object.prototype.hasOwnProperty.call(cached.a, key)) return !!cached.a[key];
    return PUBLIC.indexOf(key) >= 0;
  }

  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  var SCREEN_KEYS = ['guestbook', 'calendar', 'briefing', 'indicators', 'home', 'stocks', 'tools', 'my', 'market-temp', 'autotrader', 'kis'];
  function legacyPolicy() {
    return global.fetch(API + '/auth/google/me', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('me ' + r.status); return r.json(); })
      .then(function (b) {
        var me = (b && b.data) || {};
        var screens = {};
        SCREEN_KEYS.forEach(function (k) {
          var open = PUBLIC.indexOf(k) >= 0 || (k === 'indicators' && !!me.authenticated) || !!me.isAdmin;
          screens[k] = { label: k, public: PUBLIC.indexOf(k) >= 0, enabled: true, allowed: open };
        });
        return { data: { authenticated: !!me.authenticated, isAdmin: !!me.isAdmin, naverConfigured: !!me.naverConfigured, screens: screens, revision: 0, legacy: true } };
      });
  }

  function fetchPolicy() {
    var controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 6000);
    return global.fetch(POLICY_URL, { credentials: 'include', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (r) {
        // 서버에 /access-policy가 아직 배포되지 않은 동안(404)만 기존 로그인 상태(/auth/google/me)로 판정한다.
        // 이때는 서버 제한도 아직 없으므로 화면 껍데기만 로그인 상태를 따른다. 그 외 오류는 fail-closed.
        if (r.status === 404) return legacyPolicy();
        if (!r.ok) throw new Error('policy ' + r.status);
        return r.json();
      })
      .then(function (body) {
        var data = body && body.data;
        if (!data || !data.screens) throw new Error('policy shape');
        return data;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function remember(target) {
    try { global.sessionStorage.setItem(FROM_KEY, target); } catch (e) { /* 저장소 차단 */ }
  }
  function takeRemembered() {
    try {
      var v = global.sessionStorage.getItem(FROM_KEY);
      global.sessionStorage.removeItem(FROM_KEY);
      return v;
    } catch (e) { return null; }
  }

  function redirectFallback() {
    var here = norm(global.location.pathname);
    if (/^\/guestbook(?:\/|$)/.test(here)) return; // 반복 이동 방지
    remember(global.location.pathname + global.location.search);
    global.location.replace(FALLBACK);
  }

  function applyClasses() {
    var root = doc.documentElement;
    root.classList.remove('access-pending');
    root.classList.toggle('access-limited', !isAdmin());
    // 관심종목 서랍은 관리자 전용이다. 저장된 '열림' 상태가 본문 오른쪽 378px 여백만 남기지 않게 비관리자는 해제한다.
    if (!isAdmin()) root.classList.remove('wl-open');
    root.classList.toggle('access-admin', isAdmin());
  }

  var STYLE =
    // 판정 전 보호 화면 깜빡임 방지(본문 숨김). 6초 안에 판정이 끝나지 않으면 fail-closed 이동한다.
    'html.access-pending body{visibility:hidden}' +
    // 비로그인·일반 회원: 종목 검색·관심종목 서랍·메모 진입점 숨김(기능 자체도 초기화하지 않는다).
    'html.access-limited .nav-search-wrap,html.access-limited #navSearchMount,html.access-limited .nav-search-backdrop,' +
    'html.access-limited .global-watchlist-drawer,html.access-limited .wl-toggle,html.access-limited .memo-fab,' +
    'html.access-limited [data-memo-widget-root],html.access-limited .mobile-search-overlay,' +
    'html.access-limited .nav-write-btn{display:none!important}';
  function injectStyle() {
    if (doc.getElementById('nine-access-style')) return;
    var s = doc.createElement('style');
    s.id = 'nine-access-style';
    s.textContent = STYLE;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* goodbyestar.cloud 요청은 세션 쿠키를 함께 보낸다(제한 API가 관리자 세션을 확인). 명시한 credentials는 건드리지 않는다. */
  function patchFetch() {
    if (!global.fetch || global.fetch.__nineAccess) return;
    var original = global.fetch;
    var wrapped = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf(API + '/') === 0 && !(init && init.credentials) && typeof input === 'string') {
          init = Object.assign({}, init || {}, { credentials: 'include' });
        }
      } catch (e) { /* 원 요청 그대로 */ }
      return original.call(this, input, init);
    };
    wrapped.__nineAccess = true;
    global.fetch = wrapped;
  }

  var startScreen = screenOf(global.location.pathname, global.location.search);
  var startRestricted = !!startScreen && PUBLIC.indexOf(startScreen) < 0;

  patchFetch();
  injectStyle();
  try { if (global.localStorage.getItem('nine_authed') !== '1') doc.documentElement.classList.remove('wl-open'); } catch (e) { /* 저장소 차단 */ }
  if (startRestricted) doc.documentElement.classList.add('access-pending');

  /* 비로그인 첫 화면(로그인 랜딩): 한 브라우저 세션에서 처음 보는 홈·공개 4개 화면·이동돼 온 보호 화면 위에 덮는다.
     로그인 이력 힌트(nine_authed)가 없을 때만 판정 전에 먼저 띄우고, 판정 후 로그인 상태면 바로 닫는다. */
  var HINT_KEY = 'nine_authed';
  function hint() { try { return global.localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; } }
  function setHint(on) { try { if (on) global.localStorage.setItem(HINT_KEY, '1'); else global.localStorage.removeItem(HINT_KEY); } catch (e) { /* 차단 */ } }
  var landingApplies = !!startScreen && global.self === global.top;
  var landingTag = null;
  function withLanding(fn) {
    if (global.NineLanding) { fn(global.NineLanding); return; }
    if (!landingTag) {
      landingTag = doc.createElement('script');
      landingTag.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/access-landing.js';
      (doc.head || doc.documentElement).appendChild(landingTag);
    }
    landingTag.addEventListener('load', function () { if (global.NineLanding) fn(global.NineLanding); });
  }
  if (landingApplies && !hint()) {
    withLanding(function (L) { if (!L.seen() && !(current && current.authenticated)) L.show(false); });
  }

  /* 네이버 버튼 표시 여부: 정책 응답에 없으면(서버 배포 전) 기존 /auth/google/me 로 확인한다. */
  function probeNaver(L) {
    global.fetch(API + '/auth/google/me', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (b) { var d = (b && b.data) || b || {}; if (d.naverConfigured) L.settle({ authenticated: false, naverConfigured: true }); })
      .catch(function () { /* 버튼 없이 유지 */ });
  }

  /* 비로그인이 홈·로고(송골매)·배너를 누르면 마켓브리핑(+푸터 이야기 시리즈)으로 보낸다. 로그인은 랜딩 왼쪽 하단 버튼. */
  if (global.self === global.top) {
    doc.addEventListener('click', function (e) {
      if (current && current.authenticated) return;
      var t = e.target && e.target.closest ? e.target.closest('.nav-logo, [data-mtab="home"], a[href="/"], a[href="https://ghlee.tistory.com/"]') : null;
      if (!t || (t.closest && t.closest('#nineLanding'))) return;
      e.preventDefault();
      global.location.assign('/category/마켓 브리핑'); // 마켓브리핑 + (푸터) 이야기 시리즈
    }, true);
  }

  fetchPolicy().then(function (data) { current = data; failed = false; }, function () { current = null; failed = true; })
    .then(function () {
      applyClasses();
      if (current) cacheWrite(current); else { try { global.localStorage.removeItem(CACHE_KEY); } catch (e) { /* 차단 */ } }
      setHint(!!(current && current.authenticated));
      if (landingApplies) {
        if (current && current.authenticated) { if (global.NineLanding) global.NineLanding.close(); }
        else withLanding(function (L) { if (L.seen()) return; if (L.isOpen()) L.settle(current || {}); else L.show(!!(current && current.naverConfigured)); if (!(current && current.naverConfigured)) probeNaver(L); });
      }
      if (!allowsScreen(startScreen)) { redirectFallback(); return; }
      // 로그인 후 원래 가려던 화면으로 복귀(한 번만). 대화방에서 시작한 경우에만.
      var target = takeRemembered();
      if (target && /^\/guestbook(?:\/|$)/.test(norm(global.location.pathname))) {
        var u = new URL(target, global.location.origin);
        if (u.origin === global.location.origin && allowsScreen(screenOf(u.pathname, u.search))
            && screenOf(u.pathname, u.search) !== 'guestbook') {
          global.location.replace(u.pathname + u.search);
          return;
        }
      }
      try { global.dispatchEvent(new CustomEvent('nineaccess:ready', { detail: { admin: isAdmin() } })); } catch (e) { /* 구형 */ }
    })
    .then(function () { readyResolve(current); });

  global.NineAccess = {
    ready: ready,
    screenOf: screenOf,
    screenOfHref: screenOfHref,
    allowsScreen: allowsScreen,
    allowsHref: function (href) { return allowsScreen(screenOfHref(href)); },
    menuAllowsHref: function (href) { return menuAllowsScreen(screenOfHref(href)); },
    isAdmin: isAdmin,
    isLimited: function () { return !isAdmin(); },
    failed: function () { return failed; },
    policy: function () { return current; },
    refresh: function () {
      return fetchPolicy().then(function (d) { current = d; failed = false; applyClasses(); return d; });
    },
    /* 현재 화면이 보호 대상이면 판정 뒤에 fn, 공개 화면·일반 글은 기다리지 않고 바로 fn. 거부되면 fn을 실행하지 않는다. */
    run: function (fn) {
      if (!startRestricted) { fn(); return; }
      ready.then(function () { if (allowsScreen(startScreen)) fn(); });
    },
    /* 관리자 전용 전역 도구(검색·관심종목·메모). 판정 전에는 시작하지 않는다. */
    whenAdmin: function (fn) {
      ready.then(function () { if (isAdmin()) fn(); });
    }
  };
})(window);
