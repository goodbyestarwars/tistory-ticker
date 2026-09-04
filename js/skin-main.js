/**
 * 9bolt 스킨 공통 스크립트 (git 관리)
 * 원래 skin.html 하단 인라인 <script> 블록에 있던 코드를 그대로 이전한 것.
 * 수정 후 push하면 GitHub Pages 캐시(최대 10분) 지나 블로그에 반영된다.
 *
 * skin.html에는 다음만 남아 있어야 함:
 *  - head의 다크모드/폰트 조기 적용 스크립트 (FOUC 방지 - 외부화 금지)
 *  - head의 full-width-page 경로 감지 스크립트
 *  - 피드의 pinnedNotice 스크립트 (피드 마크업과 한 몸)
 *  - 이 파일과 skin-menu.js를 불러오는 <script src> 두 줄
 *
 * 포함 기능: iframe 모드 / 다크모드 / 카테고리 파싱·필터 탭 /
 * 아티클 모달 / 공유·더보기 / 표 스크롤 래핑 / 요약 줄바꿈 / 모바일 드로어·검색
 *
 * 2026-07-17(9차): KRX 공시 티커 fetch/파싱/렌더 로직을 js/quick-indices.js로 옮겼다
 * (관심지수 바의 "긴급속보" 패널로 흡수) - 이 파일에서는 제거됨.
 *
 * 2026-07-22: 증시캘린더(구글 캘린더 위젯)를 이 파일의 중앙 모달(openCalendarModal)
 * 방식에서 독립 페이지(js/stock-calendar.js, #stock-calendar 마운트)로 옮겼다 - 여기
 * 있던 openCalendarModal/initCalendarWidget은 삭제됨.
 */
/* 2026-08-30: skin-ready는 더 이상 화면을 가리지 않는다(근거는 skin.html의
   #initial-paint-guard 주석). style.css가 배경 토큰을 확정하는 데 이 클래스를 쓰고,
   skin.html이 아직 옛 버전인 티스토리 스킨에서도 클래스가 붙도록 여기서도 붙인다.
   가릴 게 없으니 기다리지 않고 즉시 붙인다. */
document.documentElement.classList.add('skin-ready');

  /* ── 월별 /earnings-calendar 공유 로더 ──
     홈의 일정 카드(stock-calendar.js)·미국 실적(home-widgets.js)·주간 리포트
     (home-weekly-report.js)가 같은 year-month 조회를 제각각 fetch 하던 것을 한 번으로
     합친다. 응답이 크고(월 단위 전체, 수백 KB) VM이 1코어라, 첫 화면에서 이 호출이
     4번씩 겹치던 게 메인 지연의 큰 원인이었다. 60초 TTL 단일 요청을 공유하며, 실패는
     빈 배열로 흡수한다(세 소비자 모두 .catch(()=>[]) 규약). */
  (function () {
    if (window.EarningsCalendarFeed) return;
    var BASE = 'https://goodbyestar.cloud/earnings-calendar';
    var TTL_MS = 60 * 1000;
    var cache = {};
    function month(year, monthNum) {
      var key = year + '-' + monthNum;
      var hit = cache[key];
      if (hit && (hit.inflight || Date.now() - hit.at < TTL_MS)) return hit.promise;
      var hasAbort = 'AbortController' in window;
      var controller = hasAbort ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      var promise = fetch(BASE + '?year=' + year + '&month=' + monthNum, controller ? { signal: controller.signal } : {})
        .then(function (response) {
          if (!response.ok) throw new Error('earnings-calendar ' + response.status);
          return response.json();
        })
        .then(function (data) {
          if (timer) clearTimeout(timer);
          var rows = Array.isArray(data) ? data : (data && data.data) || [];
          cache[key] = { promise: Promise.resolve(rows), at: Date.now(), inflight: false };
          return rows;
        })
        .catch(function () {
          if (timer) clearTimeout(timer);
          delete cache[key];
          return [];
        });
      cache[key] = { promise: promise, at: Date.now(), inflight: true };
      return promise;
    }
    window.EarningsCalendarFeed = { month: month };
  }());

  /* ── /market-board 공유 로더 ──
     홈 시장 요약(아래 loadHomeUsSummary)과 실시간 종목판(home-realtime-table.js)이 같은
     market=us|domestic 데이터를 limit=20 / limit=40으로 따로 부르던 것을 합친다. 두 모듈이
     같은 요청 풀(__homeMarketBoardRequests)·같은 limit·같은 30초 창을 공유하게 해 서버
     캐시 키 분리와 콜드 미스 중복을 없앤다. home-realtime-table.js가 나중에 같은 이름으로
     자기 구현을 올려도 풀·limit이 동일해 호환된다. */
  (function () {
    if (window.HomeMarketBoard) return;
    var BASE = 'https://goodbyestar.cloud/market-board';
    var LIMIT = 40;
    var REFRESH_MS = 30 * 1000;
    var pool = window.__homeMarketBoardRequests || (window.__homeMarketBoardRequests = {});
    function fetchBoard(market, force) {
      var key = market === 'us' ? 'us' : 'domestic';
      var entry = pool[key] || (pool[key] = {});
      if (!force && entry.data && Date.now() - entry.updatedAt < REFRESH_MS) return Promise.resolve(entry.data);
      if (entry.promise) return entry.promise;
      entry.promise = fetch(BASE + '?market=' + key + '&limit=' + LIMIT + (force ? '&fresh=1' : ''))
        .then(function (response) { if (!response.ok) throw new Error('market-board ' + response.status); return response.json(); })
        .then(function (json) { entry.data = json; entry.updatedAt = Date.now(); return json; });
      entry.promise.then(function () { entry.promise = null; }, function () { entry.promise = null; });
      return entry.promise;
    }
    window.HomeMarketBoard = { fetch: fetchBoard };
  }());

  /* ── iframe 모드 감지 (모달 안에서 열릴 때 껍데기 숨김) ── */
  if (window !== window.top) {
    document.body.classList.add('iframe-mode');
  }

  /* ── 다크모드 토글 (조기 적용 스크립트는 head에 있음) ── */
  (function() {
    var btn = document.getElementById('darkModeBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var on = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('bolt-dark', on ? '1' : '0'); } catch (e) {}
    });
  })();

  /* 시세·증시온도 페이지의 공통 시각 개선은 페이지별 위젯이 비동기로 DOM을
     만든 뒤에도 연결되어야 하므로 별도 모듈로 지연 로드한다. */
  (function loadDashboardEnhancements() {
    // 홈·글 목록·법적 페이지에는 차트 확장 기능이 없어 이 추가 JS/CSS를
    // 내려받지 않는다. 차트/분석 화면에서만 로드해 첫 화면 요청 수를 줄인다.
    if (!/\/(?:page|pages)\/(?:market-temp|stock-search|foreign-flow|overnight-market|strategy-search|pattern-scan)(?:\/|$)/i.test(location.pathname)) return;
    if (document.querySelector('script[data-dashboard-enhancements]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/dashboard-enhancements.js?v=20260826-dmi-layout-v1';
    script.defer = true;
    script.setAttribute('data-dashboard-enhancements', '1');
    document.body.appendChild(script);
  })();

  /* Dedicated MY screen: reuse the existing /page/watchlist Tistory page and
     append portfolio/holding analysis without changing other pages. */
  (function loadMyDashboard() {
    if (!/^\/(?:page|pages)\/watchlist\/?$/.test(location.pathname)) return;
    var cssHref = 'https://goodbyestarwars.github.io/tistory-ticker/css/my-dashboard.css?v=20260829-my-quotes-layout-v1';
    if (!document.querySelector('link[data-my-dashboard-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.setAttribute('data-my-dashboard-css', '1');
      document.head.appendChild(link);
    }
    if (document.querySelector('script[data-my-dashboard]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/my-dashboard.js?v=20260829-my-quotes-layout-v1';
    script.defer = true;
    script.setAttribute('data-my-dashboard', '1');
    document.body.appendChild(script);
  })();

  /* 홈은 기존 위젯/API를 시장 상황판 구조로 재배치한다. 백엔드 계산과 URL은 그대로 두고,
     여기서는 카드 배치·요약 집계·수급 부호 기반 규칙문만 담당한다. */
  (function buildHomeDashboard() {
    if (location.pathname !== '/' && location.pathname !== '') return;
    var feed = document.querySelector('.feed');
    var investorMount = document.getElementById('investor-trend-widget');
    var rankMount = document.getElementById('sidebar-rank');
    if (!feed) return;

    window.HomeMarketSelection = window.HomeMarketSelection || (function () {
      var selected = null;
      // 홈은 미국 프리마켓(뉴욕 04:00)부터 미국 시세·뉴스를 우선한다. 서머타임에는
      // KST 17:00~익일 09:00이며, KOSPI 현물이 시작하는 09:00에 국내 시장으로 넘긴다.
      function isClosedWindowKst() {
        var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
        var day = kst.getUTCDay(); // 0=일 ... 6=토
        var minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
        if (day === 6) return minutes >= 9 * 60; // 금요일 미국 장후 종료 뒤 토요일 09:00부터
        if (day === 0) return true;         // 일요일 종일
        if (day === 1) return minutes < 9 * 60; // 월요일 KOSPI 개장 전까지
        return false;
      }
      function autoMarket() {
        if (isClosedWindowKst()) return 'closed';
        var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
        var minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
        var isUsHour = minutes >= 17 * 60 || minutes < 9 * 60;
        return isUsHour ? 'us' : 'domestic';
      }
      return {
        get: function () { return selected || autoMarket(); },
        set: function (market) {
          market = market === 'us' || market === 'closed' ? market : 'domestic';
          if (selected === market) return;
          selected = market;
          window.dispatchEvent(new CustomEvent('home-market-change', { detail: { market: market } }));
        }
      };
    })();

    var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
    var CALENDAR_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/stock-calendar.js?v=20260828-home-cache-v1';
    var HOME_WIDGETS_SCRIPT_URL = document.currentScript && document.currentScript.src
      ? document.currentScript.src.replace(/skin-main(?:\.min)?\.js(?:\?.*)?$/, 'home-widgets.js?v=20260825-ws-fallback-v1')
      : 'https://goodbyestarwars.github.io/tistory-ticker/js/home-widgets.js?v=20260825-ws-fallback-v1';
    var HOME_REALTIME_TABLE_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-realtime-table.js?v=20260904-solari-flap-v2';
    var HOME_ECONOMIC_NEWS_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-economic-news.js?v=20260828-free-translation-fallback-v3';
  var HOME_WEEKLY_REPORT_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-weekly-report.js?v=20260831-mobile-legibility-v1';

    function isWeekendReportWindow() {
      // 2026-08-22: HomeMarketSelection의 휴장 판정(토요일 07:00~월요일 06:00)과
      // 동일한 경계로 통일 - 예전엔 06:00/07:00으로 살짝 어긋나 있었다.
      var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      var day = kst.getUTCDay();
      var hour = kst.getUTCHours();
      return (day === 6 && hour >= 7) || day === 0 || (day === 1 && hour < 6);
    }

    function escapeHomeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fetchHomeJson(url, timeoutMs) {
      var hasAbort = 'AbortController' in window;
      var controller = hasAbort ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 15000) : null;
      return fetch(url, controller ? { signal: controller.signal } : {})
        .then(function (response) {
          if (!response.ok) throw new Error('홈 데이터 응답 오류: ' + response.status);
          return response.json();
        })
        .then(function (data) {
          if (timer) clearTimeout(timer);
          return data;
        })
        .catch(function (error) {
          if (timer) clearTimeout(timer);
          throw error;
        });
    }

    function readHomeDataCache(key, maxAgeMs) {
      try {
        var cached = JSON.parse(localStorage.getItem(key) || 'null');
        if (!cached || !cached.data || !cached.savedAt) return null;
        if (Date.now() - Number(cached.savedAt) > maxAgeMs) return null;
        return cached.data;
      } catch (error) {
        return null;
      }
    }

    function writeHomeDataCache(key, data) {
      try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: data }));
      } catch (error) {
        /* 저장 공간이 없으면 이번 응답만 표시한다. */
      }
    }

    function loadHomeScript(src, globalName) {
      if (window[globalName]) return Promise.resolve(window[globalName]);
      return new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[data-home-source="' + src + '"]');
        var settled = false;
        var timeout = setTimeout(function () {
          finish(new Error(globalName + ' 스크립트 로드 시간 초과'));
        }, 10000);

        function finish(error) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(window[globalName]);
        }

        function bind(script) {
          script.addEventListener('load', function () {
            script.setAttribute('data-home-state', 'loaded');
            finish(window[globalName] ? null : new Error(globalName + ' 모듈 없음'));
          }, { once: true });
          script.addEventListener('error', function () {
            script.setAttribute('data-home-state', 'error');
            finish(new Error(globalName + ' 스크립트 로드 실패'));
          }, { once: true });
        }

        if (existing) {
          if (existing.getAttribute('data-home-state') === 'loaded') {
            finish(window[globalName] ? null : new Error(globalName + ' 모듈 없음'));
            return;
          }
          if (existing.getAttribute('data-home-state') === 'error') existing.remove();
          else {
            bind(existing);
            return;
          }
        }
        if (window[globalName]) {
          finish();
          return;
        }
        var script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.setAttribute('data-home-source', src);
        script.setAttribute('data-home-state', 'loading');
        bind(script);
        document.head.appendChild(script);
      });
    }

    function dashboardHtml() {
        return '<section class="home-dashboard home-editorial-page" aria-label="오늘의 시장 상황판">'
        + '<div class="home-market-switch" role="tablist" aria-label="메인 시장 전환">'
        + '<button type="button" data-home-market-switch="domestic" role="tab">한국증시</button><button type="button" data-home-market-switch="us" role="tab">미국증시</button><button type="button" data-home-market-switch="closed" role="tab">휴장</button>'
        + '</div>'
        + '<section class="home-closed-page" data-home-closed-page aria-label="시장 휴장" hidden>'
        + '<div class="home-closed-lead"><div class="home-closed-kicker"><span>WEEKEND MARKET NOTE</span><div class="home-closed-title-row">'
        + '<svg class="home-closed-lock" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        + '<path d="M28 68 V45a22 22 0 0 1 44 0v23" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
        + '<rect x="14" y="64" width="72" height="60" rx="15" fill="none" stroke="currentColor" stroke-width="6"/>'
        + '<path d="M45 90a6 6 0 1 1 10 4l3 13h-16l3-13a6 6 0 0 1 0-4z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>'
        + '<path d="M61 83a7 7 0 0 1-10 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
        + '</svg>'
        + '<h1>Markets Closed</h1></div><p>토요일·일요일은 국내·미국 증시가 쉽니다.</p></div><div class="home-closed-status"><strong>다음 주 시장을 준비하는 시간입니다.</strong><span>다음 거래일부터 시장 데이터가 업데이트됩니다.</span><small>관심종목 일정과 이전 시장 화면은 위 탭에서 확인할 수 있습니다.</small></div></div>'
        + '</section>'
        + '<div class="home-overview-grid home-editorial-lead">'
        + '<section class="home-market-board editorial-section" id="homeMarketBoard">'
        + '<div class="home-card-heading"><div><strong data-home-market-field="title">국내 시장</strong><span id="hmbUpdated">오늘의 시장판 · 시세 확인 중</span></div><span class="home-market-live" data-home-market-field="live">실시간</span></div>'
        + '<div class="home-index-strip" aria-label="대표 시장 지수">'
        + '<article class="home-index-card" data-home-index-slot="primary">'
        + '<div class="home-index-top"><strong data-index-field="label">KOSPI</strong><span data-index-field="status">· 확인 중</span></div>'
        + '<div class="home-index-price-row"><strong data-index-field="price">-</strong><em data-index-field="change">-</em></div>'
        + '<div class="home-index-chart" data-index-field="chart" aria-hidden="true"></div>'
        + '</article>'
        + '<article class="home-index-card" data-home-index-slot="secondary">'
        + '<div class="home-index-top"><strong data-index-field="label">KOSDAQ</strong><span data-index-field="status">· 확인 중</span></div>'
        + '<div class="home-index-price-row"><strong data-index-field="price">-</strong><em data-index-field="change">-</em></div>'
        + '<div class="home-index-chart" data-index-field="chart" aria-hidden="true"></div>'
        + '</article>'
        + '</div>'
        + '<div class="hmb-summary-head"><strong data-home-summary-field="title">국내 시장 요약</strong><span data-home-summary-field="meta">최신 데이터</span></div>'
        + '<dl class="hmb-list">'
        + '<div><dt>증시온도</dt><dd data-market-field="temperature">데이터 확인 중</dd></div>'
        + '<div><dt>시장 방향</dt><dd data-market-field="direction">데이터 확인 중</dd></div>'
        + '<div><dt>원/달러</dt><dd data-market-field="exchange">데이터 확인 중</dd></div>'
        + '<div><dt>주도 업종</dt><dd data-market-field="leaders">데이터 확인 중</dd></div>'
        + '<div><dt>주의 업종</dt><dd data-market-field="cautions">데이터 확인 중</dd></div>'
        + '<div data-home-night-futures hidden><dt>KOSPI200 야간선물</dt><dd data-market-field="nightFutures">데이터 확인 중</dd>'
        + '<div class="home-index-chart home-night-futures-chart" data-night-futures-chart aria-hidden="true"></div></div>'
        + '<div class="hmb-investor-trend" data-home-investor-trend aria-label="KOSPI KOSDAQ 외국인 순매수 추이">'
        + '<div class="hmb-investor-trend-head"><dt>투자자 동향</dt><span>외국인 순매수</span></div>'
        + '<div class="hmb-investor-trend-body"><span class="hmb-investor-loading">데이터 확인 중</span></div>'
        + '</div>'
        + '</dl>'
        + '<section class="home-top-disclosures" aria-label="관심종목 주간 공시" data-home-disclosure-section hidden>'
        + '<div class="home-top-disclosures-head"><strong data-home-disclosure-field="title">관심종목 주간 공시</strong><span data-home-disclosure-field="meta">최근 7일</span></div>'
        + '<div class="home-disclosure-list" id="homeDisclosureList"><p class="home-card-state">공시를 확인하는 중...</p></div>'
        + '</section>'
        + '</section>'
        + '<section class="home-economic-news editorial-section" id="homeEconomicNews" aria-label="실시간 경제 종합뉴스">'
        + '<div class="hen-head"><div><strong>경제 종합뉴스</strong><span data-hen-session>국내 · 실시간 타임라인</span></div><small data-hen-updated>최신 뉴스 확인 중</small></div>'
        + '<div class="hen-breaking" data-hen-breaking aria-label="중요 경제 속보" hidden>'
        + '<div class="hen-breaking-head"><strong>속보</strong><span>실적 · 거시경제 · 금리</span></div>'
        + '<div class="hen-breaking-list" data-hen-breaking-list></div>'
        + '</div>'
        + '<div class="hen-list" data-hen-list><p class="home-card-state"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>경제 뉴스를 불러오는 중입니다.</p></div>'
        + '</section></div>'
        + '<section class="home-realtime-board editorial-section" id="homeRealtimeBoard" aria-label="실시간 종목판"></section>'
        + '</section>';
    }

    var dashboard = document.createElement('div');
    dashboard.innerHTML = dashboardHtml();
    var dashboardSection = dashboard.firstElementChild;
    // 첫 화면의 편집 순서를 시장 제목 → 요약 → 일정/공시 → 지수 차트로 고정한다.
    // 기존 데이터 로더와 DOM 선택자는 유지하고, 표시 순서만 여기서 정리한다.
    var homeMarketBoard = dashboardSection.querySelector('#homeMarketBoard');
    var homeIndexStrip = homeMarketBoard && homeMarketBoard.querySelector('.home-index-strip');
    var homeDisclosureSection = homeMarketBoard && homeMarketBoard.querySelector('[data-home-disclosure-section]');
    if (homeMarketBoard && homeIndexStrip && homeDisclosureSection) {
      homeMarketBoard.insertBefore(homeDisclosureSection, homeIndexStrip);
    }
    var latestHomeIndices = [];
    var latestUsBoardData = null;
    var weeklyReportModule = null;
    var weekendReportWindow = isWeekendReportWindow();
    function syncMarketSwitch() {
      var selected = window.HomeMarketSelection.get();
      dashboardSection.querySelectorAll('[data-home-market-switch]').forEach(function (button) {
        var active = button.getAttribute('data-home-market-switch') === selected;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    dashboardSection.querySelectorAll('[data-home-market-switch]').forEach(function (button) {
      button.addEventListener('click', function () {
        var market = button.getAttribute('data-home-market-switch');
        try {
          window.HomeMarketSelection.set(market);
        } catch (error) {
          // 일부 구형 WebView에서 CustomEvent가 실패해도 set()은 선택값을
          // 먼저 저장하므로, 아래에서 화면을 직접 동기화할 수 있다.
        }
        syncMarketSwitch();
        applyHomeMarketSession(homeMarketSession());
      });
    });
    syncMarketSwitch();
    window.addEventListener('home-market-change', function () {
      syncMarketSwitch();
      // 휴장 탭은 시세 API 응답을 기다리지 않고 준비된 휴장 지면을 즉시 연다.
      // 이후 아래의 공통 시장 변경 핸들러가 데이터 로더를 갱신한다.
      applyHomeMarketSession(homeMarketSession());
      if (weeklyReportModule && weeklyReportModule.init) weeklyReportModule.init();
    });
    // 대시보드는 피드 최상단(첫 공지/글 카드 바로 앞)에 넣는다. 예전엔 이제 제거된
    // #investor-trend-widget mount를 기준점으로 썼는데, 그 mount가 없어도 위치가
    // 유지되도록 첫 카드를 기준점으로 폴백한다.
    var dashboardAnchor = investorMount || feed.querySelector('.notice-card, .post-card');
    if (dashboardAnchor) feed.insertBefore(dashboardSection, dashboardAnchor);
    else feed.appendChild(dashboardSection);
    if (investorMount) investorMount.remove();
    if (rankMount) rankMount.remove();
    var oldSidebar = document.querySelector('.sidebar-right');
    if (oldSidebar) oldSidebar.hidden = true;

    function field(name) {
      return dashboardSection.querySelector('[data-market-field="' + name + '"]');
    }

    function setField(name, text, tone) {
      var element = field(name);
      if (!element) return;
      var fullText = text == null ? '' : String(text);
      // 요약 API가 일시적으로 '?'를 반환해도 사용자가 의미 없는 물음표를
      // 지표 값으로 오해하지 않도록 상태 문구로 바꿔 표시한다.
      if (/^\?+$/.test(fullText.trim())) fullText = '데이터 확인 중';
      element.textContent = fullText;
      // 업종명은 카드 폭에 맞춰 말줄임표로 보이지만, hover/focus 시 전체 문구를
      // 확인할 수 있도록 native tooltip과 접근성 레이블을 함께 유지한다.
      element.title = fullText;
      element.setAttribute('aria-label', fullText);
      element.classList.remove('home-positive', 'home-negative', 'home-neutral');
      if (tone) element.classList.add(tone);
    }

    function applyHomeSummarySession(session) {
      var isUs = !!session && session.market === 'us';
      var usSession = isUs ? usRegularSessionState() : null;
      var title = dashboardSection.querySelector('[data-home-summary-field="title"]');
      var meta = dashboardSection.querySelector('[data-home-summary-field="meta"]');
      var labels = dashboardSection.querySelectorAll('.hmb-list dt');
      var investorTrend = dashboardSection.querySelector('[data-home-investor-trend]');
      // 미국 시장 요약 카드는 항목이 5개뿐이라 3열 그리드 마지막 칸이 빈 채로 남는다 -
      // 국내 장이 열려 있을 시간대라 다음날 코스피 방향을 가늠할 수 있는 코스피 야간선물을
      // 그 빈 칸에 채운다(국내 시장 요약에서는 이미 투자자 동향이 있어 굳이 안 보여줌).
      var nightFutures = dashboardSection.querySelector('[data-home-night-futures]');
      if (title) title.textContent = isUs ? '미국 시장 요약' : '국내 시장 요약';
      if (meta) meta.textContent = isUs ? '거래대금 상위 종목 기준' : '증시온도·업종 기준';
      if (labels[0]) labels[0].textContent = isUs && usSession && !usSession.open ? '시장 상태' : isUs ? '상승 종목 비율' : '증시온도';
      if (investorTrend) investorTrend.hidden = isUs;
      if (nightFutures) nightFutures.hidden = !isUs;
    }

    function sectorSummary(data) {
      var groups = {};
      var payload = data && data.data && typeof data.data === 'object' ? data.data : (data || {});
      var all = [];
      ['KOSPI', 'KOSDAQ'].forEach(function (market) {
        if (Array.isArray(payload[market])) all = all.concat(payload[market]);
      });
      // GAS bubble 응답은 KOSPI/KOSDAQ 배열을 사용하고, market-board 응답은
      // rows/sections를 사용한다. 홈에서는 어느 응답이 캐시되었는지와 관계없이
      // 같은 업종 요약으로 정규화한다.
      if (!all.length && Array.isArray(payload.rows)) all = payload.rows.slice();
      if (!all.length && payload.sections && typeof payload.sections === 'object') {
        var seen = {};
        Object.keys(payload.sections).forEach(function (key) {
          (Array.isArray(payload.sections[key]) ? payload.sections[key] : []).forEach(function (item) {
            var code = String(item && (item.code || item.symbol || item.name) || '');
            if (code && seen[code]) return;
            if (code) seen[code] = true;
            all.push(item);
          });
        });
      }
      all.forEach(function (item) {
        var changeRate = Number(item && (item.changeRate != null ? item.changeRate : item.change_rate));
        if (!isFinite(changeRate)) return;
        var sectors = Array.isArray(item && item.sectors) ? item.sectors : [];
        if (!sectors.length && item && (item.sector || item.industry)) sectors = [item.sector || item.industry];
        sectors.forEach(function (sector) {
          sector = String(sector || '').trim();
          if (!sector || /^(미분류|unknown|n\/a|na|-|기타)$/i.test(sector)) return;
          if (!groups[sector]) groups[sector] = { total: 0, count: 0 };
          groups[sector].total += changeRate;
          groups[sector].count += 1;
        });
      });
      var rows = Object.keys(groups).map(function (sector) {
        return { sector: sector, average: groups[sector].total / groups[sector].count };
      }).sort(function (a, b) { return b.average - a.average; });
      return {
        leaders: rows.filter(function (item) { return item.average > 0; }).slice(0, 3),
        cautions: rows.filter(function (item) { return item.average < 0; }).slice(-3).reverse()
      };
    }

    function sectorSummaryText(items, emptyText) {
      var names = (items || []).map(function (item) { return String(item && (item.sector || item.industry) || '').trim(); })
        .filter(function (name) { return name && !/^(미분류|unknown|n\/a|na|-|기타)$/i.test(name); });
      return names.length ? names.join(' · ') : (emptyText || '업종 데이터 없음');
    }

    function resolveMarketDirection(marketTemp, indexRates) {
      var components = marketTemp && marketTemp.components;
      var rise = components && components.riseRatio;
      var avgChange = components && components.avgChange;
      var riseRatio = rise && typeof rise.ratio === 'number' ? rise.ratio : null;
      var averageRate = avgChange && typeof avgChange.avgChangeRate === 'number'
        ? avgChange.avgChangeRate
        : null;

      // 미국 요약은 거래대금 상위 종목의 상승 비율만 보면, 지수 하락일에도
      // 일부 종목의 상승으로 "강한 강세"가 나올 수 있다. 나스닥·S&P500이
      // 모두 같은 방향이면 대표 지수 방향을 우선하고, 서로 엇갈리면 혼조로 둔다.
      var validIndexRates = Array.isArray(indexRates) ? indexRates.filter(function (rate) { return typeof rate === 'number' && isFinite(rate); }) : [];
      if (validIndexRates.length >= 2) {
        var indexUp = validIndexRates.every(function (rate) { return rate > 0; });
        var indexDown = validIndexRates.every(function (rate) { return rate < 0; });
        var indexAverage = validIndexRates.reduce(function (sum, rate) { return sum + rate; }, 0) / validIndexRates.length;
        if (indexDown) {
          if ((riseRatio != null && riseRatio <= 0.3) || (averageRate != null && averageRate <= -1) || indexAverage <= -1) {
            return { label: '강한 약세', tone: 'home-negative' };
          }
          return { label: '약세 우위', tone: 'home-negative' };
        }
        if (!indexUp) return { label: '혼조', tone: 'home-neutral' };
        if (riseRatio != null && averageRate != null && riseRatio >= 0.85 && averageRate >= 1 && indexAverage >= 1) {
          return { label: '급등', tone: 'home-positive' };
        }
        if ((riseRatio != null && riseRatio >= 0.7) && (averageRate == null || averageRate >= 0) && indexAverage >= 0) {
          return { label: '강한 강세', tone: 'home-positive' };
        }
        if (riseRatio != null && riseRatio >= 0.55) return { label: '상승 우위', tone: 'home-positive' };
        return { label: '혼조', tone: 'home-neutral' };
      }

      // 증시온도 계산에 이미 포함된 전체 시장 상승 비율과 평균등락률을 함께 본다.
      // 숫자가 없는 경우에는 임의 상태를 만들지 않는다.
      if (riseRatio != null && averageRate != null && riseRatio <= 0.15 && averageRate <= -1) {
        return { label: '급락', tone: 'home-negative' };
      }
      if ((riseRatio != null && riseRatio <= 0.3) || (averageRate != null && averageRate <= -1)) {
        return { label: '강한 약세', tone: 'home-negative' };
      }
      if (riseRatio != null && averageRate != null && riseRatio >= 0.85 && averageRate >= 1) {
        return { label: '급등', tone: 'home-positive' };
      }
      if ((riseRatio != null && riseRatio >= 0.7) || (averageRate != null && averageRate >= 1)) {
        return { label: '강한 강세', tone: 'home-positive' };
      }
      if (riseRatio != null && riseRatio <= 0.45) return { label: '약세 우위', tone: 'home-negative' };
      if (riseRatio != null && riseRatio >= 0.55) return { label: '상승 우위', tone: 'home-positive' };
      if (riseRatio != null || averageRate != null) {
        return { label: '혼조', tone: 'home-neutral' };
      }
      return { label: '데이터 확인 중', tone: 'home-neutral' };
    }

    function renderMarketExchange(market) {
      var exchange = market && market.components && market.components.exchange;
      if (!exchange || typeof exchange.price !== 'number') return;
      var exchangeRate = Number(exchange.changeRate);
      var arrow = exchangeRate > 0 ? ' ▲' : exchangeRate < 0 ? ' ▼' : '';
      setField('exchange', exchange.price.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '원' + arrow,
        exchangeRate > 0 ? 'home-positive' : exchangeRate < 0 ? 'home-negative' : 'home-neutral');
    }

    function renderMarketTemperature(market) {
      if (market && typeof market.temp === 'number') {
        var grade = market.grade && market.grade.label ? ' ' + market.grade.label : '';
        setField('temperature', market.temp.toFixed(market.temp % 1 ? 1 : 0) + '℃' + grade, 'home-neutral');
        var direction = resolveMarketDirection(market);
        setField('direction', direction.label, direction.tone);
        var exchange = market.components && market.components.exchange;
        if (exchange && typeof exchange.price === 'number') {
          var exchangeRate = Number(exchange.changeRate);
          var arrow = exchangeRate > 0 ? ' ▲' : exchangeRate < 0 ? ' ▼' : '';
          setField('exchange', exchange.price.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '원' + arrow,
            exchangeRate > 0 ? 'home-positive' : exchangeRate < 0 ? 'home-negative' : 'home-neutral');
        }
        var updated = document.getElementById('hmbUpdated');
        if (updated && market.updatedAt) updated.textContent = formatHomeTimestamp(market.updatedAt) + ' 기준';
      }
    }

    function nyClockParts(now) {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).formatToParts(now || new Date()).reduce(function (result, part) {
        result[part.type] = part.value;
        return result;
      }, {});
      var hour = Number(parts.hour);
      if (hour === 24) hour = 0;
      return { weekday: parts.weekday, minutes: hour * 60 + Number(parts.minute) };
    }

    function usRegularSessionState(now) {
      var clock;
      try {
        clock = nyClockParts(now);
      } catch (error) {
        return { open: false, label: '본장 상태 확인 중', subtitle: '미국 현물 · 본장 상태 확인 중' };
      }
      var minute = clock.minutes;
      var weekend = clock.weekday === 'Sat' || clock.weekday === 'Sun';
      if (weekend) return { open: false, label: '미국장 휴장', subtitle: '미국 현물 · 휴장' };
      if (minute < 9 * 60 + 30) return { open: false, label: '본장 개장 전', subtitle: '미국 현물 · 본장 개장 전' };
      if (minute >= 16 * 60) return { open: false, label: '본장 마감', subtitle: '미국 현물 · 본장 마감' };
      return { open: true, label: '장중', subtitle: '미국 현물 · 장중' };
    }

    // CME 주가지수 선물 거래시간(ET) 근사. 일요일 18:00에 열려 금요일 17:00에 닫히고,
    // 매일 17:00~18:00 한 시간을 쉰다. 공휴일 단축거래는 반영하지 않는다.
    function usFuturesSessionOpen(now) {
      var clock;
      try {
        clock = nyClockParts(now);
      } catch (error) {
        return false;
      }
      if (clock.weekday === 'Sat') return false;
      if (clock.weekday === 'Sun') return clock.minutes >= 18 * 60;
      if (clock.weekday === 'Fri') return clock.minutes < 17 * 60;
      return clock.minutes < 17 * 60 || clock.minutes >= 18 * 60;
    }

    // 2026-09-04: 미국 화면의 상단 지수 스트립이 항상 나스닥·S&P500 "현물"을 그리고 있었다.
    // 현물은 한국시간 22:30~05:00(서머타임 기준)에만 움직여서, 낮에 미국증시 탭을 열면
    // 전날 종가가 그대로 굳어 있는 카드를 계속 보게 된다(사용자 지적: "미국 실시간 티커에
    // 표현만 되는게 있어"). 본장이 닫혀 있고 지수선물이 열려 있는 시간대에는 이미 수집 중인
    // 나스닥100·S&P500 선물로 바꿔 실제로 움직이는 값을 보여준다.
    function usIndexSessionState(now) {
      var spot = usRegularSessionState(now);
      if (spot.open) {
        return {
          source: 'spot',
          keys: ['NASDAQ_INDEX', 'SP500_INDEX'],
          labels: ['나스닥', 'S&P500'],
          live: '나스닥 · S&P500',
          statusLabel: spot.label,
          subtitle: spot.subtitle
        };
      }
      if (usFuturesSessionOpen(now)) {
        return {
          source: 'futures',
          keys: ['NASDAQ100', 'SP500'],
          labels: ['나스닥100 선물', 'S&P500 선물'],
          live: '나스닥100 · S&P500 선물',
          statusLabel: '선물 거래중',
          subtitle: '미국 지수선물 · 거래중(현물 ' + spot.label + ')'
        };
      }
      return {
        source: 'spot',
        keys: ['NASDAQ_INDEX', 'SP500_INDEX'],
        labels: ['나스닥', 'S&P500'],
        live: '나스닥 · S&P500',
        statusLabel: spot.label,
        subtitle: spot.subtitle
      };
    }

    // 코스피 야간선물은 국내 거래소 휴장일에는 최신 가격이 남아 있어도
    // 거래 중인 것처럼 표시하지 않는다. 기존 코스피 선물 화면과 같은
    // KST 기준 공휴일 목록을 사용해 주말·대체공휴일까지 공통 처리한다.
    var KRX_HOLIDAYS = {
      '2026': {
        '20260101': true, '20260216': true, '20260217': true, '20260218': true,
        '20260301': true, '20260302': true, '20260501': true, '20260505': true,
        '20260525': true, '20260603': true, '20260606': true, '20260717': true,
        '20260815': true, '20260817': true, '20260924': true, '20260925': true,
        '20260926': true, '20261003': true, '20261005': true, '20261009': true,
        '20261225': true, '20261231': true
      }
    };

    function kstDateParts() {
      var kst = new Date(Date.now() + 9 * 60 * 60000);
      return {
        year: kst.getUTCFullYear(),
        month: kst.getUTCMonth() + 1,
        date: kst.getUTCDate(),
        day: kst.getUTCDay(),
        mins: kst.getUTCHours() * 60 + kst.getUTCMinutes()
      };
    }

    function kstDateKey(parts) {
      return String(parts.year) + String(parts.month).padStart(2, '0') + String(parts.date).padStart(2, '0');
    }

    function previousKstDate(parts) {
      var previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.date - 1));
      return {
        year: previous.getUTCFullYear(),
        month: previous.getUTCMonth() + 1,
        date: previous.getUTCDate(),
        day: previous.getUTCDay(),
        mins: parts.mins
      };
    }

    function isNightFuturesHoliday() {
      var parts = kstDateParts();
      // 00:00~06:00은 전날 저녁 세션의 연장 시간이므로 전날을 판정한다.
      if (parts.mins < 6 * 60) parts = previousKstDate(parts);
      if (parts.day === 0 || parts.day === 6) return true;
      var holidays = KRX_HOLIDAYS[String(parts.year)];
      return !!(holidays && holidays[kstDateKey(parts)]);
    }

    function summarizeUsMarket(data, indexItems) {
      var payload = data && data.data ? data.data : data;
      var rows = payload && payload.rows ? payload.rows : [];
      var valid = rows.map(function (row) {
        return { rate: Number(row && row.change_rate), industry: String(row && row.industry || '').trim() };
      }).filter(function (row) { return isFinite(row.rate); });
      if (!valid.length) return null;
      var rising = valid.filter(function (row) { return row.rate > 0; }).length;
      var riseRatio = rising / valid.length;
      var averageRate = valid.reduce(function (sum, row) { return sum + row.rate; }, 0) / valid.length;
      var groups = {};
      valid.forEach(function (row) {
        if (!row.industry) return;
        if (!groups[row.industry]) groups[row.industry] = { total: 0, count: 0 };
        groups[row.industry].total += row.rate;
        groups[row.industry].count += 1;
      });
      var industries = Object.keys(groups).map(function (industry) {
        return { industry: industry, average: groups[industry].total / groups[industry].count };
      }).sort(function (a, b) { return b.average - a.average; });
      var eligibleIndustries = industries.filter(function (item) {
        return item.industry && !/^(미분류|unknown|n\/a|na|-|기타)$/i.test(item.industry);
      });
      // 지수 하락일에는 모든 업종의 평균이 음수가 될 수 있다. 양수 업종만
      // 주도 업종으로 고르면 이 경우 빈 칸이 되므로, 상승 업종이 없을 때는
      // 상대적으로 덜 하락한 상위 업종을 주도 업종으로 표시한다.
      var leaders = eligibleIndustries.filter(function (item) { return item.average > 0; }).slice(0, 3);
      if (!leaders.length) leaders = eligibleIndustries.slice(0, 3);
      var cautions = eligibleIndustries.filter(function (item) { return item.average < 0; }).slice(-3).reverse();
      if (!cautions.length) cautions = eligibleIndustries.slice(-3).reverse();
      var indexRates = (indexItems || [])
        .filter(function (item) { return item && (item.symbol === 'NASDAQ_INDEX' || item.symbol === 'SP500_INDEX'); })
        .map(function (item) { return Number(item.change_rate); })
        .filter(function (rate) { return isFinite(rate); });
      var usSession = usRegularSessionState();
      return {
        riseRatio: riseRatio,
        averageRate: averageRate,
        direction: usSession.open ? resolveMarketDirection({ components: {
          riseRatio: { ratio: riseRatio },
          avgChange: { avgChangeRate: averageRate }
        } }, indexRates) : { label: usSession.label, tone: 'home-neutral' },
        sessionState: usSession,
        leaders: leaders,
        cautions: cautions,
        updatedAt: payload && payload.updatedAt
      };
    }

    function renderUsMarketSummary(data) {
      latestUsBoardData = data;
      var summary = summarizeUsMarket(data, latestHomeIndices);
      if (!summary) {
        setField('temperature', '데이터 확인 중', 'home-neutral');
        setField('direction', '데이터 확인 중', 'home-neutral');
        setField('leaders', '데이터 확인 중', 'home-neutral');
        setField('cautions', '데이터 확인 중', 'home-neutral');
        return;
      }
      var ratio = (summary.riseRatio * 100).toFixed(1) + '%';
      var sessionOpen = !summary.sessionState || summary.sessionState.open;
      setField('temperature', sessionOpen ? ratio : summary.sessionState.label,
        sessionOpen ? summary.riseRatio >= 0.55 ? 'home-positive' : summary.riseRatio <= 0.45 ? 'home-negative' : 'home-neutral' : 'home-neutral');
      setField('direction', summary.direction.label, summary.direction.tone);
      setField('leaders', sectorSummaryText(summary.leaders, '업종 데이터 없음'), 'home-positive');
      setField('cautions', sectorSummaryText(summary.cautions, '업종 데이터 없음'), 'home-negative');
      var updated = document.getElementById('hmbUpdated');
      if (updated && summary.updatedAt) updated.textContent = formatHomeTimestamp(summary.updatedAt) + ' 기준';
    }

    function renderMarketSectors(bubble) {
      var summary = sectorSummary(bubble);
      setField('leaders', sectorSummaryText(summary.leaders, '업종 데이터 없음'), 'home-positive');
      setField('cautions', sectorSummaryText(summary.cautions, '업종 데이터 없음'), 'home-negative');
    }

    function homeIndexCard(slot) {
      return dashboardSection.querySelector('[data-home-index-slot="' + slot + '"]');
    }

    // 2026-08-29: 운영 데이터로 전환. /futures 응답의 chart 배열(일봉 90개, 마지막 종가가
    // 현재가와 일치함을 라이브로 확인)을 그대로 스파크라인에 쓴다. 레이아웃 작업 때
    // 다시 고정 샘플이 필요하면 이 값을 true로만 바꾸면 된다(아래 기구는 유지).
    var HOME_USE_SAMPLE_CHARTS = false;
    var HOME_SAMPLE_CHARTS = {
      KOSPI: [2642.31, 2648.2, 2655.4, 2651.8, 2663.7, 2670.1, 2665.3, 2678.6, 2684.2, 2691.5, 2687.4, 2698.2, 2705.6, 2712.1, 2708.9, 2720.4],
      KOSDAQ: [756.88, 758.4, 761.2, 759.6, 763.8, 766.1, 764.2, 768.7, 771.5, 770.2, 774.9, 777.1, 775.4, 779.8, 782.6, 785.3],
      NASDAQ_INDEX: [18342.2, 18358.4, 18351.1, 18376.8, 18392.5, 18384.7, 18410.2, 18428.6, 18419.3, 18445.7, 18462.1, 18451.8, 18479.4, 18496.2, 18488.5, 18512.7],
      SP500_INDEX: [5440.1, 5447.8, 5444.2, 5453.9, 5461.7, 5458.4, 5468.2, 5475.6, 5471.9, 5482.3, 5490.1, 5487.6, 5498.4, 5505.2, 5501.8, 5512.6],
      NASDAQ100: [19842.5, 19860.2, 19851.4, 19878.6, 19895.1, 19886.3, 19912.8, 19931.4, 19922.0, 19949.6, 19966.2, 19955.8, 19983.7, 20001.5, 19993.2, 20018.4],
      SP500: [5452.3, 5460.1, 5456.4, 5466.2, 5474.1, 5470.8, 5480.7, 5488.2, 5484.4, 5495.0, 5502.9, 5500.3, 5511.2, 5518.1, 5514.6, 5525.5],
      kospiNight: [360.4, 361.1, 360.8, 361.7, 362.2, 361.9, 362.8, 363.4, 363.1, 364.0, 364.6, 364.2, 365.0, 365.5, 365.2, 366.1]
    };

    function homeChartRows(rows, key) {
      if (HOME_USE_SAMPLE_CHARTS && HOME_SAMPLE_CHARTS[key]) {
        return HOME_SAMPLE_CHARTS[key].map(function (close, index) {
          return { close: close, timestamp: index };
        });
      }
      return rows;
    }

    function renderHomeIndexChart(element, rows, positive, key) {
      if (!element) return;
      var values = (homeChartRows(rows, key) || []).map(function (row) { return Number(row && row.close); })
        .filter(function (value) { return isFinite(value); }).slice(-48);
      if (values.length < 2) {
        element.innerHTML = '<span class="home-index-chart-empty">추이 데이터 없음</span>';
        return;
      }
      var width = 240;
      var height = 48;
      var pad = 2;
      var min = Math.min.apply(Math, values);
      var max = Math.max.apply(Math, values);
      var range = max - min || 1;
      var points = values.map(function (value, index) {
        var x = pad + index * (width - pad * 2) / (values.length - 1);
        var y = height - pad - ((value - min) / range) * (height - pad * 2);
        return x.toFixed(2) + ',' + y.toFixed(2);
      }).join(' ');
      var color = positive ? '#d24f45' : '#1261c4';
      var gradientId = 'homeIndexFill' + String(key || 'index').replace(/[^A-Za-z0-9_-]/g, '') + (positive ? 'Up' : 'Down');
      element.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">'
        + '<defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="' + color + '" stop-opacity=".22"></stop>'
        + '<stop offset="1" stop-color="' + color + '" stop-opacity=".01"></stop></linearGradient></defs>'
        + '<polygon points="' + pad + ',' + height + ' ' + points + ' ' + (width - pad) + ',' + height + '" fill="url(#' + gradientId + ')"></polygon>'
        + '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>'
        + '</svg>';
    }

    function formatHomeTimestamp(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) return String(value || '');
      var parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      }).formatToParts(date).reduce(function (map, part) {
        map[part.type] = part.value;
        return map;
      }, {});
      return parts.year + '-' + parts.month + '-' + parts.day + ' '
        + parts.dayPeriod + ' ' + parts.hour + ':' + parts.minute + ':' + parts.second;
    }

    function homeMarketSession() {
      var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      var selected = window.HomeMarketSelection && window.HomeMarketSelection.get
        ? window.HomeMarketSelection.get() : null;
      if (selected === 'closed') return {
        closed: true,
        market: 'closed',
        title: '휴장',
        live: '토요일 · 일요일',
        subtitle: '국내·미국 증시 · 휴장',
        keys: [],
        labels: []
      };
      var minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
      var isUsSession = selected === 'us'
        || (!selected && (minutes >= 17 * 60 || minutes < 9 * 60));
      var usSession = usIndexSessionState();
      return isUsSession ? {
        market: 'us',
        title: '미국 시장',
        live: usSession.live,
        subtitle: usSession.subtitle,
        statusLabel: usSession.statusLabel,
        keys: usSession.keys,
        labels: usSession.labels
      } : {
        market: 'domestic',
        title: '국내 시장',
        live: '실시간',
        subtitle: '오늘의 시장판 · 시세 확인 중',
        statusLabel: '장중',
        keys: ['KOSPI', 'KOSDAQ'],
        labels: ['KOSPI', 'KOSDAQ']
      };
    }

    function applyHomeMarketSession(session) {
      var closedPage = dashboardSection.querySelector('[data-home-closed-page]');
      var isClosed = !!(session && session.closed);
      var overviewGrid = dashboardSection.querySelector('.home-overview-grid');
      var widgetGrid = dashboardSection.querySelector('.home-widget-grid');
      var realtimeBoard = dashboardSection.querySelector('.home-realtime-board');
      dashboardSection.classList.toggle('is-market-closed', isClosed);
      if (closedPage) closedPage.hidden = !isClosed;
      // CSS 선택자가 스킨의 body id에 의존하지 않도록 DOM 자체에서도 숨긴다.
      // Tistory 스킨·WebView별 body id 차이로 휴장 지면 아래에 이전 시장 화면이
      // 남는 것을 방지한다.
      if (overviewGrid) overviewGrid.hidden = isClosed;
      if (widgetGrid) widgetGrid.hidden = isClosed;
      if (realtimeBoard) realtimeBoard.hidden = isClosed;
      // 2026-08-22: "한 주 마감 리포트"(js/home-weekly-report.js가 만드는 #homeWeeklyReport)는
      // 이 함수가 관리하는 컨테이너들과 별개로 .feed에 직접 붙는 요소라, 주말엔 탭을
      // 한국증시/미국증시로 바꿔도 계속 화면 중간에 끼어 보이는 문제가 있었다(사용자가
      // "휴장 탭만 건들면 매번 하는 실수"라고 재차 지적). 휴장 탭일 때만 보이도록 여기서도
      // 같은 isClosed 기준으로 동기화한다.
      var weeklyReport = document.getElementById('homeWeeklyReport');
      if (weeklyReport) weeklyReport.hidden = !isClosed;
      if (isClosed) return;
      var title = dashboardSection.querySelector('[data-home-market-field="title"]');
      var live = dashboardSection.querySelector('[data-home-market-field="live"]');
      var updated = document.getElementById('hmbUpdated');
      if (title) title.textContent = session.title;
      if (live) live.textContent = session.live;
      var sessionSignature = session.keys.join('|') + '·' + (session.subtitle || '');
      if (updated && (!updated.dataset || updated.dataset.homeSession !== sessionSignature)) {
        updated.textContent = session.subtitle;
        if (updated.dataset) updated.dataset.homeSession = sessionSignature;
      }
      ['primary', 'secondary'].forEach(function (slot, index) {
        var card = homeIndexCard(slot);
        if (!card) return;
        var key = session.keys[index];
        var previousKey = card.getAttribute('data-home-index');
        card.setAttribute('data-home-index', key);
        var label = card.querySelector('[data-index-field="label"]');
        var price = card.querySelector('[data-index-field="price"]');
        var change = card.querySelector('[data-index-field="change"]');
        var status = card.querySelector('[data-index-field="status"]');
        var chart = card.querySelector('[data-index-field="chart"]');
        if (label) label.textContent = session.labels[index];
        if (previousKey && previousKey !== key) {
          if (price) price.textContent = '-';
          if (change) change.textContent = '-';
          if (status) status.textContent = '· 확인 중';
          if (chart) chart.innerHTML = '<span class="home-index-chart-empty">시세 전환 중</span>';
        }
      });
    }

    function renderHomeIndices(items) {
      var session = homeMarketSession();
      applyHomeMarketSession(session);
      var bySymbol = {};
      (items || []).forEach(function (item) { if (item && item.symbol) bySymbol[item.symbol] = item; });
      latestHomeIndices = items || [];
      if (session.market === 'us' && latestUsBoardData) renderUsMarketSummary(latestUsBoardData);
      // 미국 시장 요약 카드의 "코스피 야간선물" 칸 - hidden 상태여도 값은 항상 채워둬서
      // 세션이 전환되는 순간(applyHomeSummarySession) 바로 최신값이 보이게 한다.
      var nightItem = bySymbol.KOSPI200_NIGHT;
      var nightChartEl = dashboardSection.querySelector('[data-night-futures-chart]');
      if (isNightFuturesHoliday()) {
        setField('nightFutures', '휴장', 'home-neutral');
        // 휴장 문구는 값 칸에만 표시한다. 차트 빈 상태까지 "휴장"을
        // 반복하면 한 칸이 두 줄처럼 보인다.
        if (nightChartEl) { nightChartEl.hidden = true; nightChartEl.innerHTML = ''; }
      } else if (nightItem) {
        var nPrice = Number(nightItem.price);
        var nChange = Number(nightItem.change);
        var nRate = Number(nightItem.change_rate);
        var nTone = !isFinite(nChange) || nChange === 0 ? 'home-neutral' : nChange > 0 ? 'home-positive' : 'home-negative';
        var nText = (isFinite(nPrice) ? nPrice.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-')
          + (isFinite(nRate) ? ' ' + (nChange > 0 ? '▲' : nChange < 0 ? '▼' : '') + Math.abs(nRate).toFixed(2) + '%' : '');
        setField('nightFutures', nText, nTone);
        // 주간(국내 시장) 쪽 코스피/코스닥 카드처럼 추이 그래프도 같이 보여준다(2026-08-13
        // 사용자 리포트 - 텍스트만 있고 그래프가 빠져 있었음). renderHomeIndexChart는 SVG를
        // preserveAspectRatio="none"으로 채우므로 컨테이너 CSS 크기만 다르면(style.css의
        // .home-night-futures-chart) 그대로 재사용된다.
        if (nightChartEl) { nightChartEl.hidden = false; renderHomeIndexChart(nightChartEl, nightItem.chart, nChange >= 0, 'kospiNight'); }
      } else {
        setField('nightFutures', '데이터 확인 중', 'home-neutral');
        if (nightChartEl) { nightChartEl.hidden = true; nightChartEl.innerHTML = ''; }
      }
      session.keys.forEach(function (key, index) {
        var card = homeIndexCard(index === 0 ? 'primary' : 'secondary');
        var item = bySymbol[key];
        if (!card) return;
        var price = item && Number(item.price);
        var change = item && Number(item.change);
        var rate = item && Number(item.change_rate);
        var tone = !isFinite(change) || change === 0 ? 'home-neutral' : change > 0 ? 'home-positive' : 'home-negative';
        var priceEl = card.querySelector('[data-index-field="price"]');
        var changeEl = card.querySelector('[data-index-field="change"]');
        var statusEl = card.querySelector('[data-index-field="status"]');
        var chartEl = card.querySelector('[data-index-field="chart"]');
        if (priceEl) { priceEl.textContent = isFinite(price) ? price.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '-'; priceEl.className = tone; }
        if (changeEl) { changeEl.textContent = isFinite(rate) ? (change > 0 ? '▲' : change < 0 ? '▼' : '') + Math.abs(rate).toFixed(2) + '%' : '-'; changeEl.className = tone; }
        if (statusEl) statusEl.textContent = item ? '· ' + (item.status || session.statusLabel || '장중') : '· 데이터 지연';
        renderHomeIndexChart(chartEl, item && item.chart, change >= 0, key);
      });
    }

    function loadHomeIndices() {
      var session = homeMarketSession();
      applyHomeMarketSession(session);
      if (session.closed) return;
      var request = window.QuickIndices && typeof window.QuickIndices.fetchFutures === 'function'
        ? window.QuickIndices.fetchFutures()
        : fetchHomeJson('https://goodbyestar.cloud/futures?symbols=KOSPI%2CKOSDAQ%2CNASDAQ_INDEX%2CSP500_INDEX%2CNASDAQ100%2CSP500%2CKOSPI200_NIGHT', 12000)
          .then(function (data) { return data && data.data ? data.data : []; });
      request.then(renderHomeIndices).catch(function () {
        ['primary', 'secondary'].forEach(function (slot) {
          var card = homeIndexCard(slot);
          if (!card) return;
          var status = card.querySelector('[data-index-field="status"]');
          if (status) status.textContent = '· 시세 지연';
        });
      });
    }

    loadHomeIndices();
    setInterval(function () { if (!document.hidden) loadHomeIndices(); }, 60 * 1000);

    // ---- 코스피↔나스닥 전환 카운트다운 (2026-08-13 요청) ----
    // homeMarketSession()이 국내/미국 장을 나누는 기준(09:00·17:00 KST)과 정확히 같은
    // 시각 3분 전부터만 뜨는 라인아트 링 배지. 위치를 정확히 어디에 둬야 할지 몰라
    // 화면 좌하단 고정으로 두었다(style.css .home-switch-countdown 주석 참고).
    (function setupHomeSwitchCountdown() {
      var SWITCH_HOURS = [9, 17]; // KST, homeMarketSession()과 동일 기준
      var WARN_SECONDS = 180; // 3분 전부터 노출
      var RING_R = 16;
      var RING_C = 2 * Math.PI * RING_R;
      var el = null, ringProgress = null, labelEl = null, timeEl = null;
      var wasVisible = false;

      function mount() {
        if (el) return;
        el = document.createElement('div');
        el.className = 'home-switch-countdown';
        el.hidden = true;
        el.innerHTML = '<svg class="hsc-ring" viewBox="0 0 36 36" aria-hidden="true">'
          + '<circle class="hsc-ring-track" cx="18" cy="18" r="' + RING_R + '"></circle>'
          + '<circle class="hsc-ring-progress" cx="18" cy="18" r="' + RING_R + '" style="stroke-dasharray:' + RING_C.toFixed(2) + '"></circle>'
          + '</svg>'
          + '<div class="hsc-body"><span class="hsc-label"></span><strong class="hsc-time"></strong></div>';
        document.body.appendChild(el);
        ringProgress = el.querySelector('.hsc-ring-progress');
        labelEl = el.querySelector('.hsc-label');
        timeEl = el.querySelector('.hsc-time');
      }

      // 다음 전환(09:00 또는 17:00)까지 남은 초와, 그 전환이 미국장으로 가는 건지 반환.
      function nextSwitch(kstNowSec) {
        var best = null;
        SWITCH_HOURS.forEach(function (hour) {
          var targetSec = hour * 3600;
          var diff = targetSec - kstNowSec;
          if (diff <= 0) diff += 86400;
          if (!best || diff < best.secondsLeft) best = { hour: hour, secondsLeft: diff };
        });
        return best;
      }

      function tick() {
        var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
        var nowSec = kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds();
        var next = nextSwitch(nowSec);
        var visible = next.secondsLeft <= WARN_SECONDS;
        if (!visible) {
          if (el) el.hidden = true;
          wasVisible = false;
          return;
        }
        mount();
        var toUs = next.hour === 17;
        if (!wasVisible) {
          // 새로 나타날 때만 innerHTML을 건드려 애니메이션(hscFadeIn)이 다시 재생되게 한다.
          el.hidden = false;
          el.classList.toggle('hsc-to-us', toUs);
          el.classList.toggle('hsc-to-kr', !toUs);
          labelEl.textContent = toUs ? '미국장 프리마켓까지' : 'KOSPI 개장까지';
          wasVisible = true;
        }
        var minutes = Math.floor(next.secondsLeft / 60);
        var seconds = next.secondsLeft % 60;
        timeEl.textContent = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
        var ratio = next.secondsLeft / WARN_SECONDS; // 1(방금 시작) -> 0(전환 직전)
        ringProgress.style.strokeDashoffset = (RING_C * (1 - ratio)).toFixed(2);
      }

      tick();
      // 2026-08-21 코드 감사: 다른 60초 타이머(loadHomeIndices)는 이미 document.hidden을
      // 체크하는데 이 1초 카운트다운만 빠져 있었다 - 백그라운드 탭에서도 계속 돌던 걸
      // 통일. 탭이 다시 보이면 그 즉시 최신 상태로 갱신되도록 visibilitychange에서도
      // 한 번 더 tick()을 호출한다.
      setInterval(function () { if (!document.hidden) tick(); }, 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) tick();
      });
    })();

    var marketTempCacheKey = 'home_market_temp_v1';
    var marketSectorCacheKey = 'home_market_sectors_v1';
    var cachedMarketTemp = readHomeDataCache(marketTempCacheKey, 10 * 60 * 1000);
    var cachedMarketSectors = readHomeDataCache(marketSectorCacheKey, 5 * 60 * 1000);
    var summarySessionKey = '';
    var loadHomeUsSummary;
    var loadHomeDomesticSummary;
    var loadHomeInvestorTrend;

    function loadSummaryForSession(session) {
      if (session && session.closed) {
        applyHomeMarketSession(session);
        summarySessionKey = '';
        return;
      }
      var isUs = !!session && session.market === 'us';
      var nextKey = (session.keys || []).join('|');
      summarySessionKey = nextKey;
      applyHomeSummarySession(session);
      if (isUs) {
        loadHomeUsSummary();
      } else {
        loadHomeDomesticSummary();
      }
    }

    // 2026-08-05: 8000 -> 20000(js/market-temp.js와 동일 값으로 맞춤). GAS getMarketTemp()는
    // 캐시(30분 TTL)가 만료되면 VIX/수급/거래대금/평균등락률/섹터강도/52주신고저/환율/미국선물
    // 9개 지표를 순차로 외부 조회해 8~12초를 넘기기 일쑤였다(js/market-temp.js 상단 주석 참고,
    // 그 파일은 이미 20000으로 올려둔 상태였는데 이 홈 대시보드 쪽만 12000으로 남아있었다) -
    // 홈에 "일시 지연"/"데이터 확인 중"이 가끔 뜨던 원인이라 여기도 같은 값으로 맞춘다.
    fetchHomeJson(GAS_TICKER_URL + '?marketTemp=1', 20000)
      .then(function (market) {
        writeHomeDataCache(marketTempCacheKey, market);
        if (homeMarketSession().market === 'us') renderMarketExchange(market);
        else renderMarketTemperature(market);
      })
      .catch(function () {
        if (!cachedMarketTemp && homeMarketSession().market !== 'us') {
          setField('temperature', '일시 지연', 'home-neutral');
          setField('direction', '데이터 확인 중', 'home-neutral');
          setField('exchange', '일시 지연', 'home-neutral');
        }
      });

    // 시총 버블은 전 종목·업종을 여러 배치로 묶어 만드는 느린 응답이다.
    // 첫 페인트와 수급/패턴/랭킹 렌더를 막지 않고, 브라우저가 유휴 상태가 된 뒤
    // 업종 요약만 채운다. 이전 정상 응답은 위에서 즉시 재사용한다.
    var loadHomeSectors = function () {
      // 2026-08-05: 12000 -> 20000(위 marketTemp 호출과 동일한 이유 - 유휴시간에 실행돼
      // 첫 페인트를 막지는 않지만, 너무 짧으면 "주도 업종"/"주의 업종"도 같이 일시 지연으로 뜬다).
      fetchHomeJson(GAS_TICKER_URL + '?bubble=1', 20000)
        .then(function (bubble) {
          writeHomeDataCache(marketSectorCacheKey, bubble);
          renderMarketSectors(bubble);
        })
        .catch(function () {
          if (!cachedMarketSectors) {
            setField('leaders', '일시 지연', 'home-neutral');
            setField('cautions', '일시 지연', 'home-neutral');
          }
      });
    };

    loadHomeUsSummary = function () {
      (window.HomeMarketBoard
        ? window.HomeMarketBoard.fetch('us')
        : fetchHomeJson('https://goodbyestar.cloud/market-board?market=us&limit=40', 12000))
        .then(renderUsMarketSummary)
        .catch(function () {
          setField('temperature', '데이터 확인 중', 'home-neutral');
          setField('direction', '데이터 확인 중', 'home-neutral');
          setField('leaders', '데이터 확인 중', 'home-neutral');
          setField('cautions', '데이터 확인 중', 'home-neutral');
        });
    };

    loadHomeDomesticSummary = function () {
      if (cachedMarketTemp) renderMarketTemperature(cachedMarketTemp);
      if (cachedMarketSectors) renderMarketSectors(cachedMarketSectors);
      // 지연 콜백에만 의존하면 모바일 WebView가 계속 미루면서 주도/주의 업종이
      // 비어 보일 수 있다. fetch 자체는 비동기이므로 즉시 시작해 첫 화면을 막지 않는다.
      // 업종 응답은 느릴 수 있지만, 지연 콜백에 넣으면 모바일 WebView에서
      // 조회가 뒤로 밀려 "주도/주의 업종"이 계속 비어 보인다. 캐시를 먼저
      // 그린 뒤 최신 응답 요청을 즉시 병행한다.
      loadHomeSectors();
      loadHomeInvestorTrend();
    };

    function investorAmountText(value) {
      var n = Number(value);
      if (!isFinite(n)) return '-';
      if (n === 0) return '0억';
      var sign = n < 0 ? '-' : '+';
      var abs = Math.abs(n);
      if (abs >= 10000) return sign + (abs / 10000).toFixed(1).replace(/\.0$/, '') + '조';
      return sign + Math.round(abs).toLocaleString('ko-KR') + '억';
    }

    function investorSparkline(values, positive) {
      var nums = (values || []).map(Number).filter(function (v) { return isFinite(v); });
      if (nums.length < 2) return '<span class="hmb-investor-spark-empty">-</span>';
      var min = Math.min.apply(Math, nums.concat([0]));
      var max = Math.max.apply(Math, nums.concat([0]));
      var range = max - min || 1;
      var points = nums.map(function (value, index) {
        var x = 2 + index * 96 / Math.max(1, nums.length - 1);
        var y = 26 - (value - min) / range * 22;
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      var zeroY = (26 - (0 - min) / range * 22).toFixed(1);
      var color = positive ? '#d24f45' : '#1261c4';
      return '<svg class="hmb-investor-spark" viewBox="0 0 100 28" role="img" aria-label="외국인 순매수 추이">'
        + '<line x1="2" y1="' + zeroY + '" x2="98" y2="' + zeroY + '" class="hmb-investor-zero"></line>'
        + '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>'
        + '</svg>';
    }

    function renderHomeInvestorTrend(results) {
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      if (!host) return;
      var body = host.querySelector('.hmb-investor-trend-body');
      if (!body) return;
      var markets = [
        { key: 'kospi', label: 'KOSPI' },
        { key: 'kosdaq', label: 'KOSDAQ' }
      ];
      var html = markets.map(function (market, index) {
        var result = results[index] && results[index].data ? results[index].data : (results[index] || {});
        var rows = Array.isArray(result.rows) ? result.rows : [];
        var values = rows.map(function (row) { return Number(row.frgn); }).filter(function (value) { return isFinite(value); });
        var latest = values.length ? values[values.length - 1] : null;
        var tone = latest > 0 ? 'home-positive' : latest < 0 ? 'home-negative' : 'home-neutral';
        return '<div class="hmb-investor-row">'
          + '<div class="hmb-investor-row-top"><strong>' + market.label + '</strong><b class="' + tone + '">' + investorAmountText(latest) + '</b></div>'
          + investorSparkline(values.slice(-10), latest != null && latest >= 0)
          + '</div>';
      }).join('');
      body.innerHTML = html || '<span class="hmb-investor-loading">데이터 확인 중</span>';
    }

    loadHomeInvestorTrend = function () {
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      if (!host || host.hidden) return;
      var body = host.querySelector('.hmb-investor-trend-body');
      if (body && !body.querySelector('.hmb-investor-row')) body.innerHTML = '<span class="hmb-investor-loading">데이터 확인 중</span>';
      Promise.all([
        fetchHomeJson('https://goodbyestar.cloud/investor-trend?period=day&market=kospi', 12000),
        fetchHomeJson('https://goodbyestar.cloud/investor-trend?period=day&market=kosdaq', 12000)
      ]).then(renderHomeInvestorTrend).catch(function () {
        if (body) body.innerHTML = '<span class="hmb-investor-loading">데이터 확인 중</span>';
      });
    };

    loadSummaryForSession(homeMarketSession());
    window.addEventListener('home-market-change', function () {
      // 탭 상태만 바꾸면 직전 시장의 지수 카드가 화면에 남는다. 시장을
      // 전환하는 순간 카드의 라벨·값·차트를 함께 초기화하고 다시 조회한다.
      loadHomeIndices();
      loadSummaryForSession(homeMarketSession());
    });
    setInterval(function () {
      if (document.hidden) return;
      var session = homeMarketSession();
      var wasClosed = dashboardSection.classList.contains('is-market-closed');
      // 금요일에 홈을 열어 둔 채 토요일로 넘어가도 주말 휴장 지면으로 전환한다.
      // 반대로 월요일이 되면 자동 시장 선택을 다시 적용한다.
      if (session.closed || wasClosed) {
        if (session.closed !== wasClosed) {
          syncMarketSwitch();
          loadHomeIndices();
          loadSummaryForSession(session);
        }
        return;
      }
      var nextKey = (session.keys || []).join('|');
      if (nextKey !== summarySessionKey) loadSummaryForSession(session);
      else if (session.market !== 'us') loadHomeInvestorTrend();
    }, 60 * 1000);

    function calendarMeta(rawTitle) {
      var segments = String(rawTitle || '').split('|').map(function (item) { return item.trim(); });
      var head = segments[0] || '(제목 없음)';
      var category = segments[1] || '';
      var stock = head.match(/^\$(\S+)\s*(.*)$/);
      var flag = !stock && head.match(/^(\p{Regional_Indicator}{2})\s*(.*)$/u);
      return {
        title: stock ? ((stock[1] ? stock[1] + ' ' : '') + stock[2]).trim() : flag ? flag[2].trim() : head,
        category: category || (stock ? '종목' : flag ? flag[1] : '증시')
      };
    }

    function eventDate(event) {
      var value = event.start.indexOf('T') === -1 ? event.start + 'T00:00:00+09:00' : event.start;
      return new Date(value);
    }

    function homeKstParts(value) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
      }).formatToParts(value || new Date()).reduce(function (result, part) {
        result[part.type] = part.value;
        return result;
      }, {});
    }

    function homeKstDayStart(value) {
      var parts = homeKstParts(value);
      return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 9 * 60 * 60 * 1000);
    }

    function scheduleTime(event, includeDate) {
      var allDay = event.start.indexOf('T') === -1;
      var date = eventDate(event);
      var parts = homeKstParts(date);
      var dateLabel = Number(parts.month) + '.' + Number(parts.day) + '.';
      var usDate = String(event.us_date || '').slice(0, 10);
      var timeLabel = usDate
        ? '미국 ' + Number(usDate.slice(5, 7)) + '/' + Number(usDate.slice(8, 10))
          + (event.us_session ? ' · ' + event.us_session : '')
        : allDay ? '종일' : parts.hour + ':' + parts.minute;
      return includeDate ? dateLabel + ' ' + timeLabel : timeLabel;
    }

    function calendarMarketPriority(event) {
      var market = String(event && event.market || '').toLowerCase();
      if (market === 'domestic' || market === 'kr' || market === 'korea') return 0;
      if (market === 'us' || market === 'usa' || market === 'foreign') return 1;
      var source = String(event && (event.source || event.provider || '') || '');
      var title = String(event && event.title || '').trim();
      if (/dart|국내|한국|kospi|kosdaq/i.test(source + ' ' + title)) return 0;
      if (/finnhub|미국|nasdaq|nyse|s&p/i.test(source + ' ' + title)) return 1;
      if (/^\$/.test(title) || /^\p{Regional_Indicator}{2}/u.test(title)) return 1;
      return 0;
    }

    function compareCalendarEvents(a, b) {
      var dayOrder = String(a && a.start || '').slice(0, 10).localeCompare(String(b && b.start || '').slice(0, 10));
      if (dayOrder) return dayOrder;
      var marketOrder = calendarMarketPriority(a) - calendarMarketPriority(b);
      if (marketOrder) return marketOrder;
      return eventDate(a) - eventDate(b);
    }

    function nearestEvents(events) {
      var todayStart = homeKstDayStart(new Date());
      var tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      var upcoming = (events || []).filter(function (event) { return eventDate(event) >= todayStart; })
        .sort(compareCalendarEvents);
      var todayItems = upcoming.filter(function (event) { return eventDate(event) < tomorrow; });
      if (todayItems.length) return { items: todayItems.slice(0, 4), includeDate: false, label: '오늘 일정' };
      if (!upcoming.length) return { items: [], includeDate: true, label: '오늘 또는 가장 가까운 일정' };
      var nearest = eventDate(upcoming[0]).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      return {
        items: upcoming.filter(function (event) {
          return eventDate(event).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) === nearest;
        }).slice(0, 4),
        includeDate: true,
        label: '가장 가까운 일정'
      };
    }

    function renderSchedule(result) {
      var list = document.getElementById('homeScheduleList');
      var label = document.getElementById('homeScheduleLabel');
      if (!list) return;
      if (label) label.textContent = result.label;
      if (!result.items.length) {
        list.innerHTML = '<p class="home-card-state">오늘 예정된 주요 일정이 없습니다.</p>';
        return;
      }
      list.innerHTML = result.items.map(function (event) {
        var meta = calendarMeta(event.title);
        return '<a class="home-schedule-row" href="' + escapeHomeHtml(event.link || '/page/stock-calendar') + '" target="_blank" rel="noopener">'
          + '<time>' + scheduleTime(event, result.includeDate) + '</time>'
          + '<span class="home-schedule-content">'
          + '<span class="home-schedule-category">' + escapeHomeHtml(meta.category) + '</span>'
          + '<span class="home-schedule-title">' + escapeHomeHtml(meta.title) + '</span></span></a>';
      }).join('');
    }

    // 일정은 즉시 의사결정에 필요한 시세보다 우선순위가 낮다. 홈의 API·WebSocket
    // 연결이 자리 잡은 뒤 불러와 첫 화면에서 15초짜리 캘린더 요청이 경쟁하지 않게 한다.
    window.setTimeout(function () {
      loadHomeScript(CALENDAR_SCRIPT_URL, 'StockCalendar')
        .then(function (calendar) {
          if (!calendar || !calendar.fetchEvents) throw new Error('캘린더 모듈 없음');
          var today = homeKstParts(new Date());
          return calendar.fetchEvents(Number(today.year), Number(today.month) - 1)
            .then(function (events) {
              var current = nearestEvents(events);
              if (current.items.length) return current;
              return calendar.fetchEvents(Number(today.year), Number(today.month)).then(nearestEvents);
            });
        })
        .then(renderSchedule)
        .catch(function () {
          var list = document.getElementById('homeScheduleList');
          if (list) list.innerHTML = '<p class="home-card-state">일정을 불러오지 못했습니다.</p>';
        });
    }, 2000);

    /* 최신 마켓브리핑 8건: 대표 1건 + 오른쪽 3건 + 왼쪽 아래 4건으로 재구성한다. */
    var allCards = Array.prototype.slice.call(feed.querySelectorAll(':scope > .post-card:not(.notice-card)'));
    var marketCards = allCards.filter(function (card) { return card.getAttribute('data-cat') === '마켓 브리핑'; });
    var selectedCards = (marketCards.length ? marketCards : allCards).slice(0, 8);
    allCards.forEach(function (card) {
      if (selectedCards.indexOf(card) === -1) card.remove();
    });
    feed.querySelectorAll(':scope > .notice-card').forEach(function (card) { card.remove(); });

    var briefing = null;
    if (selectedCards.length) {
      briefing = document.createElement('section');
      briefing.className = 'home-briefing-section';
      briefing.innerHTML = '<div class="home-section-heading"><div><strong>마켓브리핑</strong>'
        + '<span>투자 판단에 필요한 핵심 해석</span></div></div>'
        + '<div class="home-briefing-grid"><div class="home-briefing-left-column">'
        + '<div class="home-briefing-featured-slot"></div><div class="home-briefing-left-more"></div></div>'
        + '<div class="home-briefing-small-stack"></div></div>'
        + '<a class="home-briefing-more" href="/category/마켓 브리핑">마켓브리핑 전체보기 →</a>';
      feed.appendChild(briefing);
      selectedCards[0].classList.add('home-briefing-featured');
      briefing.querySelector('.home-briefing-featured-slot').appendChild(selectedCards[0]);
      selectedCards.slice(1, 4).forEach(function (card) {
        card.classList.add('home-briefing-small');
        briefing.querySelector('.home-briefing-small-stack').appendChild(card);
      });
      selectedCards.slice(4, 8).forEach(function (card) {
        card.classList.add('home-briefing-small', 'home-briefing-left-small');
        briefing.querySelector('.home-briefing-left-more').appendChild(card);
      });
    } else {
      briefing = document.createElement('section');
      briefing.className = 'home-briefing-section';
      briefing.innerHTML = '<div class="home-section-heading"><div><strong>마켓브리핑</strong>'
        + '<span>투자 판단에 필요한 핵심 해석</span></div></div>'
        + '<div class="home-card-state">최신 마켓브리핑을 확인하는 중입니다.</div>'
        + '<a class="home-briefing-more" href="/category/마켓 브리핑">마켓브리핑 전체보기 →</a>';
      feed.appendChild(briefing);
    }

    var pagination = feed.querySelector(':scope > .pagination');
    if (pagination) pagination.remove();

    // 네 모듈은 서로의 코드에 의존하지 않는다. 기존 직렬 로딩을 병렬로
    // 바꿔 첫 화면에서 네트워크 왕복 한 번 이상을 줄인다.
    Promise.all([
      loadHomeScript(HOME_WEEKLY_REPORT_SCRIPT_URL, 'HomeWeeklyReport').catch(function () { return null; }),
      loadHomeScript(HOME_WIDGETS_SCRIPT_URL, 'HomeDashboardWidgets').catch(function () { return null; }),
      loadHomeScript(HOME_REALTIME_TABLE_SCRIPT_URL, 'HomeRealtimeTable').catch(function () { return null; }),
      loadHomeScript(HOME_ECONOMIC_NEWS_SCRIPT_URL, 'HomeEconomicNews').catch(function () { return null; })
    ]).then(function (modules) {
        var weekly = modules[0];
        var widgets = modules[1];
        var table = modules[2];
        var news = modules[3];
        weeklyReportModule = weekly;
        if (weekly && weekly.init) weekly.init();
        if (widgets && widgets.init) widgets.init({
          dashboard: dashboardSection,
          briefing: briefing,
          gasUrl: GAS_TICKER_URL,
          fetchJson: fetchHomeJson
        });
        if (table && table.init) table.init({ mount: dashboardSection.querySelector('#homeRealtimeBoard') });
        if (news && news.init) news.init({ mount: dashboardSection.querySelector('#homeEconomicNews') });
      })
      .catch(function () {
        /* 위젯 관리 모듈이 막혀도 기존 고정형 대시보드는 그대로 사용할 수 있게 둔다. */
      });
  })();

  /* ── 카테고리 글목록: 신문 지면형 고정 편집(2026-08-26) ──
     일반 카테고리는 대표 1개 + 헤드라인 최대 4개 뒤에 작은 카드·2열을 반복한다. 다만
     마켓브리핑은 최신 1개 + 오른쪽 목록 3개를 먼저 두고, 이후 글은 3열 카드로 이어 붙인다.
     글은 언제나 최신순 그대로 소비하며 재정렬하지 않는다. */
  (function buildCategoryFeedBlocks() {
    if (location.pathname.indexOf('/category/') !== 0) return;
    var feed = document.querySelector('.feed');
    if (!feed) return;
    if (!feed.querySelector('.category-masthead')) {
      var masthead = document.createElement('header');
      masthead.className = 'category-masthead';
      masthead.innerHTML = '<div><p>MARKET BRIEFING</p><h1>마켓 브리핑</h1><span>지난 시장과 종목의 흐름을 돌아보며, 다음 거래를 생각해봅니다.</span></div>'
        + '<small>최신순 · 전체 글</small>';
      feed.insertBefore(masthead, feed.firstChild);
    }
    var cards = Array.prototype.slice.call(feed.querySelectorAll(':scope > .post-card:not(.notice-card)'));
    if (cards.length < 2) return; /* 카드가 1개뿐이면 다양화할 의미가 없음 */
    var isMarketBriefing = decodeURIComponent(location.pathname) === '/category/마켓 브리핑';

    var BLOCK_SEQUENCE = [
      { key: 'hero', min: 2, max: 5 },   // 최신 대표 1 + 헤드라인 최대 4
      { key: 'cards', min: 3, max: 3 },  // 작은 카드형 3개 그리드
      { key: 'duo', min: 2, max: 2 }     // 가로로 나란한 2개
    ];
    var tailAnchor = cards[cards.length - 1].nextSibling; /* 마지막 카드 뒤 요소(페이지네이션 등) 앞에 삽입 */

    function renderBlock(type, slice, beforeNode) {
      if (type === 'single') {
        slice[0].classList.add('feed-featured'); // 이미 제자리에 있으므로 이동 없이 클래스만
        return;
      }
      if (type === 'hero' || type === 'briefingHero') {
        var hero = document.createElement('div');
        hero.className = 'feed-block feed-block-hero' + (type === 'briefingHero' ? ' feed-block-briefing-hero' : '');
        feed.insertBefore(hero, beforeNode);
        var featuredSlot = document.createElement('div');
        featuredSlot.className = 'feed-hero-featured-slot';
        hero.appendChild(featuredSlot);
        slice[0].classList.add('feed-featured');
        featuredSlot.appendChild(slice[0]);
        if (slice.length > 1) {
          var headlineList = document.createElement('div');
          headlineList.className = 'feed-block-headline';
          hero.appendChild(headlineList);
          slice.slice(1).forEach(function (card) {
            card.classList.add('feed-headline-item');
            headlineList.appendChild(card);
          });
        }
        return;
      }
      var wrap = document.createElement('div');
      var cardType = type === 'briefingCards' ? 'cards' : type;
      wrap.className = 'feed-block feed-block-' + cardType + (type === 'briefingCards' ? ' feed-block-briefing-cards' : '');
      feed.insertBefore(wrap, beforeNode);
      slice.forEach(function (card) {
        card.classList.add('feed-' + cardType + '-item');
        if (type === 'briefingCards') card.classList.add('feed-briefing-cards-item');
        wrap.appendChild(card);
      });
    }

    // 마켓브리핑만은 상단의 최신 1 + 목록 3개 뒤로 남은 모든 글을 3열 카드로 유지한다.
    // hero/cards/duo 순서가 반복되며 다시 큰 미리보기가 생기지 않게 별도 처리한다.
    if (isMarketBriefing) {
      var heroTake = Math.min(4, cards.length);
      renderBlock('briefingHero', cards.slice(0, heroTake), heroTake < cards.length ? cards[heroTake] : tailAnchor);
      for (var briefingIndex = heroTake; briefingIndex < cards.length; briefingIndex += 3) {
        var briefingSlice = cards.slice(briefingIndex, briefingIndex + 3);
        var briefingBefore = briefingIndex + briefingSlice.length < cards.length
          ? cards[briefingIndex + briefingSlice.length] : tailAnchor;
        renderBlock('briefingCards', briefingSlice, briefingBefore);
      }
      return;
    }

    var idx = 0;
    var sequenceIndex = 0;
    while (idx < cards.length) {
      var remaining = cards.length - idx;
      var block = BLOCK_SEQUENCE[sequenceIndex % BLOCK_SEQUENCE.length];
      // 마지막에 1개만 남으면 단독 카드로 마무리한다.
      if (remaining < block.min) block = { key: 'single', min: 1, max: 1 };
      var take = Math.min(block.max, remaining);
      var slice = cards.slice(idx, idx + take);
      var beforeNode = idx + take < cards.length ? cards[idx + take] : tailAnchor;
      renderBlock(block.key, slice, beforeNode);
      idx += take;
      sequenceIndex += 1;
    }
  })();

  /* ── 데스크톱 사이드바 토글 (완전 숨김 ↔ 복원, 2026-07-21 사이드바 리디자인 #3)
     조기 적용 스크립트(head)가 이미 html.sidebar-collapsed를 붙여놨을 수 있으므로
     버튼 아이콘(햄버거 ⇄ X) 상태만 여기서 동기화. 모바일 드로어(#mobileMenuBtn)와는
     완전히 별개 기능 - CSS가 min-width:721px 안에서만 .sidebar-collapsed를 해석하므로
     모바일에서는 이 클래스가 있어도 레이아웃에 영향 없음. ── */
  (function() {
    var btn = document.getElementById('sidebarToggleBtn');
    if (!btn) return;
    if (document.documentElement.classList.contains('sidebar-collapsed')) btn.classList.add('open');
    btn.addEventListener('click', function() {
      var collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
      btn.classList.toggle('open', collapsed);
      try { localStorage.setItem('bolt-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
    });
  })();

  /* ── 카테고리 동적 파싱 ([##_category_list_##] 기반) ── */
  var catColors = ['#2563eb','#16a34a','#d97706','#7c3aed','#e11d48','#0891b2','#b45309','#0f766e'];
  /* 2026-07-12: 마켓 브리핑은 왼쪽 페이지 메뉴(skin-menu.js)로 승격돼서
     사이드바 "카테고리" 목록에는 중복 노출 안 함 */
  var sidebarCatExclude = ['마켓 브리핑'];
  /* 카테고리명 → 아이콘 수동 매핑. 카테고리 이름을 바꾸면 이 키도 같이 고쳐야 함(안 그러면 기본 아이콘으로 대체됨) */
  var catIconPaths = {
    '종목 분석': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    '일상다반사': '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    '일기장': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'Insight Archive': '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'
  };
  var catIconDefault = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  var subCatMap = {};
  var catDataEl = document.getElementById('categoryData');
  var catCustomList = document.getElementById('catCustomList');

  if (catDataEl) {
    var allLinks = Array.from(catDataEl.querySelectorAll('a'));

    /* depth-1 = /category/NAME (슬래시 딱 1개) */
    var depth1Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* depth-2 = /category/NAME/SUBNAME */
    var depth2Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* ── 좌측 사이드바: depth-1 만 표시 ── */
    if (catCustomList) {
      depth1Links.forEach(function(a, idx) {
        var href = a.getAttribute('href');
        var countEl = a.querySelector('span');
        var name = '', count = '';
        if (countEl) {
          count = countEl.textContent.replace(/[()]/g, '').trim();
          name  = a.childNodes[0] ? a.childNodes[0].textContent.trim() : '';
        } else {
          var m = a.textContent.trim().match(/^(.*?)\s*\((\d+)\)\s*$/);
          name  = m ? m[1].trim() : a.textContent.trim();
          count = m ? m[2] : '';
        }
        if (!name) return;
        var bareName = name.replace(/\s*\(비공개\)\s*$/, '').trim();
        if (sidebarCatExclude.indexOf(bareName) > -1) return;
        var color = catColors[idx % catColors.length];
        var iconPath = catIconPaths[bareName] || catIconDefault;
        var li = document.createElement('li');
        li.innerHTML = '<a href="' + href + '" data-parent="' + name + '">'
          + '<svg class="cat-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPath + '</svg>'
          + name
          + (count ? '<span class="cat-cnt">' + count + '</span>' : '')
          + '</a>';
        catCustomList.appendChild(li);
      });
    }

    /* ── 상단 필터 탭: 2026-07-11 UI에서 제거(디자인상 불필요 판단) ──
       skin.html의 #filterBar 자체는 스킨 편집 없이 유지하고, 여기서 DOM에서 떼어낸다. */
    var filterBar = document.getElementById('filterBar');
    if (filterBar) { filterBar.remove(); filterBar = null; }
    var topBarExclude = ['일기장', 'Insight Archive'];

    /* ── subCatMap: depth-2를 부모 기준으로 그루핑 ── */
    depth2Links.forEach(function(a) {
      var href = a.getAttribute('href') || '';
      var parentSlug = (href.match(/\/category\/([^/]+)\//) || [])[1] || '';
      var parentA = depth1Links.filter(function(p) {
        return (p.getAttribute('href') || '').indexOf('/category/' + parentSlug) > -1;
      })[0];
      var parentName = '';
      if (parentA) {
        var pCountEl = parentA.querySelector('span');
        parentName = pCountEl
          ? (parentA.childNodes[0] ? parentA.childNodes[0].textContent.trim() : '')
          : parentA.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      } else {
        parentName = decodeURIComponent(parentSlug.replace(/\+/g, ' '));
      }
      var cntEl = a.querySelector('span');
      var subName = cntEl
        ? (a.childNodes[0] ? a.childNodes[0].textContent.trim() : '')
        : a.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      if (!parentName || !subName) return;
      if (!subCatMap[parentName]) subCatMap[parentName] = [];
      subCatMap[parentName].push({ name: subName, url: href });
    });
  }

  /* ── 카테고리 필터 탭 active ── */
  var path = decodeURIComponent(location.pathname).toLowerCase();
  var activeCat = '';
  document.querySelectorAll('.filter-tab').forEach(function(tab) {
    var tabCat = (tab.dataset.cat || '').toLowerCase();
    if (tabCat === 'all') {
      if (path === '/' || path === '') { tab.classList.add('active'); activeCat = 'all'; }
    } else {
      var slug = tabCat.replace(/ /g, '+');
      if (path.indexOf(slug) > -1 || path.indexOf(tabCat.replace(/ /g, '%20')) > -1 || path.indexOf(tabCat) > -1) {
        tab.classList.add('active');
        activeCat = tab.dataset.cat;
      }
    }
  });
  /* 상단 탭에 없는 카테고리(일기장/Insight Archive 등 topBarExclude 대상)도
     카테고리 페이지에 들어가면 서브 카테고리 바는 뜨도록 URL에서 직접 감지 */
  if (!activeCat) {
    Object.keys(subCatMap).forEach(function(parentName) {
      var p = parentName.toLowerCase();
      if (path.indexOf('/category/' + p.replace(/ /g, '+')) === 0 ||
          path.indexOf('/category/' + p.replace(/ /g, '%20')) === 0 ||
          path.indexOf('/category/' + p) === 0) {
        activeCat = parentName;
      }
    });
  }

  if (!activeCat) {
    var allTab = document.querySelector('.filter-tab[data-cat="all"]');
    if (allTab) { allTab.classList.add('active'); activeCat = 'all'; }
  }

  /* ── 세부 카테고리 서브 필터 렌더링 ──
     상단 탭에서 제외된 카테고리(일기장/Insight Archive)는 서브 바 대신
     상단 필터 바 자체를 하위 카테고리 탭으로 교체한다(전체글/마켓 브리핑 자리에 표시). */
  var subBar = document.getElementById('subFilterBar');
  if (subCatMap[activeCat]) {
    var subs = subCatMap[activeCat];
    var isExcludedCat = topBarExclude.indexOf(activeCat.replace(/\s*\(비공개\)\s*$/, '').trim()) > -1;
    var tabClass = isExcludedCat ? 'filter-tab' : 'sub-filter-tab';
    var html = '';
    subs.forEach(function(s) {
      var isActive = path.indexOf(decodeURIComponent(s.url).toLowerCase().split('/').pop()) > -1;
      html += '<a href="' + s.url + '" class="' + tabClass + (isActive ? ' active' : '') + '">' + s.name + '</a>';
    });
    if (isExcludedCat && filterBar) {
      filterBar.innerHTML = html;
    } else if (subBar) {
      subBar.innerHTML = html;
      subBar.style.display = 'flex';
    }
  }

  /* ── 좌측 카테고리 active 표시 ── */
  document.querySelectorAll('.cat-custom-list a').forEach(function(a) {
    var p = (a.dataset.parent || '').toLowerCase();
    if (p && path.indexOf(p.replace(/ /g, '+')) > -1) {
      a.classList.add('active');
    }
  });


  /* ── 아티클 모달 ── */
  function openArticleModal(url, title, wide, zoom) {
    var old = document.getElementById('bolt-modal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'bolt-modal';
    var iframeHTML = wide
      ? '<div class="nm-scale-wrap"><div class="nm-scale-inner"><iframe src="' + url + '" class="nm-iframe nm-iframe-fixed"></iframe></div></div>'
      : '<iframe src="' + url + '" class="nm-iframe"></iframe>';
    m.innerHTML =
      '<div class="nm-overlay"></div>' +
      '<div class="nm-card' + (wide ? ' nm-wide' : '') + '">' +
        '<div class="nm-header">' +
          '<span class="nm-title">' + (title || '') + '</span>' +
          '<div class="nm-actions">' +
            '<a href="' + url + '" target="_blank" class="nm-ext">새창 열기 ↗</a>' +
            '<button class="nm-close" id="nmClose">✕</button>' +
          '</div>' +
        '</div>' +
        iframeHTML +
      '</div>';
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    document.getElementById('nmClose').onclick = closeArticleModal;
    m.querySelector('.nm-overlay').onclick = closeArticleModal;

    if (wide) {
      var wrap = m.querySelector('.nm-scale-wrap');
      var inner = m.querySelector('.nm-scale-inner');
      var ifr = m.querySelector('.nm-iframe-fixed');
      if (wrap && inner && ifr) {
        var rescale = function() {
          var w = wrap.clientWidth;
          if (!w) return;
          var virtualWidth = zoom ? (w / zoom) : 1200;
          var scale = w / virtualWidth;
          ifr.style.width = virtualWidth + 'px';
          ifr.style.transform = 'scale(' + scale + ')';
          inner.style.width = w + 'px';
          inner.style.height = (1300 * scale) + 'px';
        };
        rescale();
        window.addEventListener('resize', rescale);
        m._rescale = rescale;
      }
    }
  }
  function closeArticleModal() {
    var m = document.getElementById('bolt-modal');
    if (m) {
      if (m._rescale) window.removeEventListener('resize', m._rescale);
      m.classList.add('nm-closing'); setTimeout(function(){ m.remove(); }, 200);
    }
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeArticleModal();
  });

  /* ── 전역 노출 ── */
  window.readPost = function(btn) {
    var card = btn.closest('.post-card');
    if (!card) return;
    var postUrl = card.dataset.url;
    var titleEl = card.querySelector('.post-title');
    var title = titleEl ? titleEl.textContent.trim() : '';
    openArticleModal(postUrl, title, true, 1.0);
  };

  window.sharePost = function(btn) {
    var card = btn.closest('.post-card');
    if (!card) return;
    var url = card.dataset.url || location.href;
    var titleEl = card.querySelector('.post-title');
    var title = titleEl ? titleEl.textContent.trim() : '';
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        var orig = btn.textContent;
        btn.textContent = '✓ 복사됨';
        btn.style.background = '#dcfce7'; btn.style.borderColor = '#86efac'; btn.style.color = '#15803d';
        setTimeout(function() {
          btn.textContent = orig; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = '';
        }, 2000);
      });
    } else { window.open(url, '_blank'); }
  };

  /* ── 카테고리 없는 글/페이지(예: /page/market-temp 등 개별 Page)의
     "카테고리 없음" 뱃지 숨김 ── */
  document.querySelectorAll('.post-cat-badge').forEach(function(el) {
    if (el.textContent.trim() === '카테고리 없음') el.style.display = 'none';
  });

  /* ── 표 가로 스크롤 래핑: table에 overflow-x:auto만 주면 auto 테이블 레이아웃이
     칸 너비를 억지로 욱여넣어 찌그러지길래, div로 감싸서 그 div가 스크롤되게 함 ── */
  document.querySelectorAll('.post-single-body table, .post-expand-body table').forEach(function(table) {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* ── 인덱스 요약 텍스트 줄바꿈 개선 ── */
  document.querySelectorAll('.post-excerpt').forEach(function(el) {
    /* innerHTML 기반 처리: 티스토리가 삽입한 <br> 보존 */
    var raw = el.innerHTML;
    /* ① <br> → \n */
    raw = raw.replace(/<br\s*\/?>/gi, '\n');
    /* ② 나머지 태그 제거 */
    raw = raw.replace(/<[^>]+>/g, '');
    /* ③ HTML 엔티티 디코딩 */
    var tmp = document.createElement('div');
    tmp.innerHTML = raw;
    raw = tmp.textContent.replace(/\r\n|\r/g, '\n').trim();
    /* ④ 중복 텍스트 제거 */
    if (raw.length > 20) {
      var check = raw.slice(0, 30);
      var dupIdx = raw.indexOf(check, 5);
      if (dupIdx > 0 && dupIdx <= 60) { raw = raw.slice(dupIdx); }
    }
    /* ⑤ "숫자.\n내용" → "숫자. 내용" (번호 혼자 떠있는 현상 방지) */
    raw = raw.replace(/(\d+)\.\n+/g, '$1. ');
    /* ⑥ 숫자 목록 앞 줄바꿈 (공백 유무 무관) */
    /* "?1. " "할인).2. " 처럼 구두점/괄호 뒤 숫자가 바로 붙는 경우 포함 */
    raw = raw.replace(/([.!?)\]][\s]*(\d+)\.\s+)/g, function(m) {
      var parts = m.match(/^([.!?)\]])\s*(\d+)\.\s+$/);
      if (!parts) return m;
      return parts[1] + '\n' + parts[2] + '. ';
    });
    raw = raw.replace(/([^\n])\s+(\d+)\.\s+/g, function(m, before, num) {
      return before + '\n' + num + '. ';
    });
    /* ⑦ 대시·불릿 앞 줄바꿈 */
    raw = raw.replace(/([^\n])\s*[-•·✦▸]\s+/g, '$1\n- ');
    /* ⑧ 마침표/느낌표/물음표 뒤 새 한글 문장 단락 구분 */
    /* 앞 글자가 숫자면 제외: "1. 일단..." 같은 번호목록 점을 건드리지 않음 */
    raw = raw.replace(/([^\d\n][.!?])\s+([가-힣A-Z])/g, '$1\n$2');
    /* ⑨ 연속 줄바꿈 정리 */
    raw = raw.replace(/\n{3,}/g, '\n\n');
    /* ⑩ 최종 출력 (3줄 클램프는 style.css .post-excerpt 규칙이 담당) */
    el.innerHTML = raw.replace(/\n/g, '<br>');
  });

  /* ── 모바일 드로어 & 검색 오버레이 ── */
  (function() {
    var menuBtn    = document.getElementById('mobileMenuBtn');
    var overlay    = document.getElementById('mobileOverlay');
    var sidebar    = document.querySelector('.sidebar-left');
    var searchBtn  = document.getElementById('mobileSearchBtn');
    var searchOv   = document.getElementById('mobileSearchOverlay');
    var msoClose   = document.getElementById('msoCloseBtn');
    var msoInput   = document.getElementById('msoInput');
    var scrollBtn  = document.getElementById('scrollTopBtn');
    var drawerHdr  = document.querySelector('.drawer-header');

    /* 드로어 열기/닫기 */
    function openDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.add('open');
      menuBtn.setAttribute('aria-label', '메뉴 닫기');
      sidebar.classList.add('drawer-open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      if (drawerHdr) drawerHdr.style.display = 'flex';
    }
    function closeDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-label', '메뉴 열기');
      sidebar.classList.remove('drawer-open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (menuBtn) menuBtn.addEventListener('click', function() {
      sidebar && sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
    });
    if (overlay) overlay.addEventListener('click', closeDrawer);

    /* 드로어 내부 링크 클릭 시 자동 닫힘 */
    if (sidebar) sidebar.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' && window.innerWidth <= 720) {
        setTimeout(closeDrawer, 120);
      }
    });

    /* 검색 오버레이 */
    if (searchBtn) searchBtn.addEventListener('click', function() {
      if (!searchOv) return;
      searchOv.classList.add('open');
      setTimeout(function() { msoInput && msoInput.focus(); }, 150);
    });
    if (msoClose) msoClose.addEventListener('click', function() {
      searchOv && searchOv.classList.remove('open');
    });
    if (searchOv) searchOv.addEventListener('click', function(e) {
      if (e.target === searchOv) searchOv.classList.remove('open');
    });

    /* ESC 키 닫힘 */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDrawer();
        searchOv && searchOv.classList.remove('open');
      }
    });

    /* 스크롤 탑 버튼 */
    if (scrollBtn) {
      window.addEventListener('scroll', function() {
        if (window.scrollY > 300) scrollBtn.classList.add('visible');
        else scrollBtn.classList.remove('visible');
      }, { passive: true });
      scrollBtn.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    /* 리사이즈 시 드로어 정리 */
    window.addEventListener('resize', function() {
      if (window.innerWidth > 720) {
        closeDrawer();
        /* 데스크탑 전환 시 sidebar top 복원 */
        var sl2 = document.querySelector('.sidebar-left');
        if (sl2) sl2.style.top = '';
      }
    });
  })();

