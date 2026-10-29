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

/* DCF uses the existing page-body mount pattern. Create /page/dcf in Tistory;
   code, styles and per-company disclosures are maintained on GitHub Pages. */
(function loadDcfPage() {
  if (!/^\/(?:page|pages)\/dcf\/?$/.test(location.pathname)) return;
  if (document.querySelector('script[data-dcf-page]')) return;
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var mount = document.getElementById('dcf');
  if (!mount) {
    mount = document.createElement('div'); mount.id = 'dcf';
    var host = document.querySelector('.contents_style') || document.querySelector('.post-single-body') || document.querySelector('.entry-content');
    if (!host) return;
    host.appendChild(mount);
  }
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'css/dcf.css'; document.head.appendChild(css);
  var core = document.createElement('script'); core.src = base + 'js/dcf-core.js'; core.setAttribute('data-dcf-page', '1');
  core.onload = function () {
    var script = document.createElement('script'); script.src = base + 'js/dcf.js';
    script.onerror = function () { mount.textContent = 'DCF 화면 조회 실패. 페이지를 새로고침하세요.'; };
    document.body.appendChild(script);
  };
  core.onerror = function () { mount.textContent = 'DCF 계산 모듈 조회 실패. 페이지를 새로고침하세요.'; };
  document.body.appendChild(core);
}());

/* 자동매매(소유자 전용) 화면: Tistory에 /page/auto-trader 페이지를 만들면 이 로더가 화면을 붙인다(DCF와 같은 방식).
   데이터는 이 PC의 로컬 봇(127.0.0.1:8765)에서만 읽는다 - 계좌·주문 정보는 사이트·VM을 거치지 않는다. */
(function loadAutoTraderPage() {
  if (!/^\/(?:page|pages)\/auto-trader\/?$/.test(location.pathname)) return;
  if (document.querySelector('script[data-auto-trader-page]')) return;
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var mount = document.getElementById('auto-trader');
  if (!mount) {
    mount = document.createElement('div'); mount.id = 'auto-trader';
    var host = document.querySelector('.contents_style') || document.querySelector('.post-single-body') || document.querySelector('.entry-content');
    if (!host) return;
    host.appendChild(mount);
  }
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'css/auto-trader.css?v=20261016-order-wide'; document.head.appendChild(css);
  var script = document.createElement('script'); script.src = base + 'js/auto-trader.js?v=20261016-order-wide'; script.setAttribute('data-auto-trader-page', '1');
  script.onerror = function () { mount.textContent = '자동매매 화면을 불러오지 못했습니다. 새로고침하세요.'; };
  document.body.appendChild(script);
}());

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
    var calendarStatus = {};
    function month(year, monthNum) {
      var key = year + '-' + monthNum;
      var hit = cache[key];
      if (hit && (hit.inflight || Date.now() - hit.at < TTL_MS)) return hit.promise;
      var promise = window.NineHttp.json(BASE + '?year=' + year + '&month=' + monthNum, {timeoutMs:15000})
        .then(function (data) {
          calendarStatus[key] = {state:'ok', health:data && data.calendarHealth};
          var rows = Array.isArray(data) ? data : (data && data.data) || [];
          cache[key] = { promise: Promise.resolve(rows), at: Date.now(), inflight: false };
          return rows;
        })
        .catch(function () {
          calendarStatus[key] = {state:'error'};
          delete cache[key];
          return [];
        });
      cache[key] = { promise: promise, at: Date.now(), inflight: true };
      return promise;
    }
    window.EarningsCalendarFeed = { month: month, status: function (year, monthNum) { return calendarStatus[year + '-' + monthNum] || {state:'pending'}; } };
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
    var REQUEST_TIMEOUT_MS = 12000;
    var pool = window.__homeMarketBoardRequests || (window.__homeMarketBoardRequests = {});
    function fetchBoard(market, force) {
      var key = market === 'us' ? 'us' : 'domestic';
      var entry = pool[key] || (pool[key] = {});
      if (!force && entry.data && Date.now() - entry.updatedAt < REFRESH_MS) return Promise.resolve(entry.data);
      if (entry.promise) return entry.promise;
      entry.promise = window.NineHttp.json(BASE + '?market=' + key + '&limit=' + LIMIT + (force ? '&fresh=1' : ''), {timeoutMs:REQUEST_TIMEOUT_MS})
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
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/dashboard-enhancements.js?v=20261013-hts-wheel1';
    script.defer = true;
    script.setAttribute('data-dashboard-enhancements', '1');
    document.body.appendChild(script);
  })();

  /* 2026-09-23 사용자 요청("메모 기능") - 전체 페이지에서 뜨는 플로팅 메모 버튼.
     dashboard-enhancements와 달리 경로 제한 없이 항상 로드한다(어느 페이지에서든
     메모를 남길 수 있어야 하는 기능이라). */
  (function loadMemoWidget() {
    if (document.querySelector('link[data-memo-widget-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/memo-widget.css?v=20260923-memo-widget-v3';
    link.setAttribute('data-memo-widget-css', '1');
    document.head.appendChild(link);
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/memo-widget.js?v=20260923-memo-widget-v3';
    script.defer = true;
    script.setAttribute('data-memo-widget', '1');
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
    // 2026-09-15: MY 매물대가 종목분석과 같은 그래프(foreign-flow.css의 .ff-apt-simple, 범위
    // :is(#foreign-flow, .ff-vp-host))를 쓴다. 이 스타일시트는 종목분석 페이지 본문에서만 불러왔었다.
    if (!document.querySelector('link[data-foreign-flow-css]')) {
      var ffLink = document.createElement('link');
      ffLink.rel = 'stylesheet';
      ffLink.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/foreign-flow.css?v=20261019-vp-an1';
      ffLink.setAttribute('data-foreign-flow-css', '1');
      document.head.appendChild(ffLink);
    }
    if (document.querySelector('script[data-my-dashboard]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/my-dashboard.js?v=20261026-watchlist-state-v1';
    script.defer = true;
    script.setAttribute('data-my-dashboard', '1');
    document.body.appendChild(script);
  })();

  /* 주요 뉴스(/pages/main-news): 한국·미국 뉴스를 한 줄기로 보여주는 전용 지면.
     티스토리 페이지 본문에 아무것도 없어도 되도록 mount까지 여기서 만든다 - 사용자는
     주소만 맞춰 빈 페이지를 하나 만들면 되고, 본문 HTML을 관리할 필요가 없다
     (loadMyDashboard와 같은 패턴).

     2026-09-05: 붙이는 자리를 고쳤다. 예전엔 `.feed`를 잡아 append 해서 **글 전체 뒤**,
     그러니까 광고와 공감·구독 버튼 아래 화면 맨 밑에 붙었다(사용자: "위치도 이상해").
     라이브 HTML 구조는 이렇다.
       section.feed > article.post-single > div.post-single-body
         > 광고(adsbygoogle) > div.contents_style(본문) > div.container_postbtn(공감·구독)
     본문은 `.contents_style`이므로 거기에 넣어야 광고 뒤·버튼 앞이라는 제자리에 온다.
     사용자가 페이지 본문에 <div id="main-news"></div>를 직접 넣으면 그것도 이 안에
     들어가므로 결과가 같다. */
  (function loadMainNews() {
    if (!/^\/(?:page|pages)\/main-news\/?$/.test(location.pathname)) return;
    if (!document.querySelector('link[data-main-news-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/main-news.css?v=20260930-news-toolbar-v2';
      link.setAttribute('data-main-news-css', '1');
      document.head.appendChild(link);
    }
    if (!document.querySelector('#main-news')) {
      var mount = document.createElement('div');
      mount.id = 'main-news';
      // querySelector에 셀렉터를 쉼표로 나열하면 "목록 순서"가 아니라 "문서 순서"로
      // 첫 요소를 돌려준다 - .post-single-body가 .contents_style의 부모라 그게 먼저
      // 잡혀서 다시 글 맨 뒤에 붙었다. 우선순위를 지키려면 하나씩 찾아야 한다.
      var hostSelectors = ['.contents_style', '.post-single-body', '.entry-content', '.article-view', '.feed'];
      var host = null;
      for (var i = 0; i < hostSelectors.length && !host; i++) {
        host = document.querySelector(hostSelectors[i]);
      }
      (host || document.body).appendChild(mount);
    }
    if (document.querySelector('script[data-main-news]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/main-news.js?v=20261008-24h-et';
    script.defer = true;
    script.setAttribute('data-main-news', '1');
    document.body.appendChild(script);
  })();

  /* 시장 페이지(시장지표 탭들·증시온도)의 모바일 전용 카드 UI(2026-10-16). 767px 이하에서만 불러온다 - PC·태블릿은
     파일 자체를 받지 않으므로 화면이 달라지지 않는다. 기존 요소·데이터는 그대로 두고 카드·스와이프를 얹는다.
     js/mobile-market.js, css/mobile-market.css, docs/UI_GUIDE.md '시장 모바일 카드 UI' */
  (function loadMobileMarket() {
    if (!/^\/(?:page|pages)\/(?:market-temp|kospi-futures|overnight-market)\/?$/i.test(location.pathname)) return;
    if (!window.matchMedia || !window.matchMedia('(max-width: 767px)').matches) return;
    if (document.querySelector('script[data-mobile-market]')) return;
    var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
    var version = '20261016-mobile-cards';
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ASSET_BASE + 'css/mobile-market.css?v=' + version;
    link.setAttribute('data-mobile-market-css', '1');
    document.head.appendChild(link);
    var script = document.createElement('script');
    script.src = ASSET_BASE + 'js/mobile-market.js?v=' + version;
    script.defer = true;
    script.setAttribute('data-mobile-market', '1');
    document.body.appendChild(script);
  })();

  /* 증시온도(/page/market-temp): 티스토리 본문에 오래된 <script>/<link>가 남아 있어도
     최신 팔레트·순위 시각화·단기흐름 그래프가 적용되도록 스킨에서 한 번 더 보장한다. */
  (function loadMarketTempPage() {
    if (!/^\/(?:page|pages)\/market-temp\/?$/.test(location.pathname)) return;
    var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
    var version = '20261005-kpi-gauge-v3';
    if (!document.querySelector('link[data-market-temp-css]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ASSET_BASE + 'css/market-temp.css?v=' + version;
      link.setAttribute('data-market-temp-css', '1');
      document.head.appendChild(link);
    }
    if (!document.querySelector('#market-temp')) {
      var mount = document.createElement('div');
      mount.id = 'market-temp';
      var hostSelectors = ['.contents_style', '.post-single-body', '.entry-content', '.article-view', '.feed'];
      var host = null;
      for (var i = 0; i < hostSelectors.length && !host; i++) {
        host = document.querySelector(hostSelectors[i]);
      }
      (host || document.body).appendChild(mount);
    }
    if (document.querySelector('script[data-market-temp-dynamic]')) return;
    var script = document.createElement('script');
    script.src = ASSET_BASE + 'js/market-temp.js?v=' + version;
    script.defer = true;
    script.setAttribute('data-market-temp-dynamic', '1');
    script.addEventListener('load', function () {
      if (window.MarketTemp && typeof window.MarketTemp.init === 'function') window.MarketTemp.init();
    });
    document.body.appendChild(script);
  })();

  /* 시장지표 통합 지면(/pages/kospi-futures = 국내, /pages/overnight-market = 글로벌).

     2026-09-06 요청: 두 페이지가 코스피·코스닥을 각각 들고 있어 중복이라는 지적. 한 지면에서
     버튼으로 오가게 하고, 글로벌 쪽 코스피·코스닥 카드는 뺐다(js/overnight-market.js CATEGORIES).

     주소는 둘 다 살려 둔다 - 기존 링크·북마크·티스토리 페이지가 그대로 동작하고, 들어온
     주소가 첫 탭을 정한다. 티스토리 페이지 본문에 이미 들어 있는 mount는 그대로 재사용해
     옮겨 담고, 없는 쪽은 여기서 만든다.

     탭을 열 때마다 그 모듈의 init()을 다시 부른다. 접힌·숨겨진 컨테이너에서 만든
     lightweight-charts는 0x0으로 굳는 문제가 이 저장소에서 여러 번 재발했는데(작업이력
     2026-08-14), 보이는 상태에서 다시 그리면 그 경로를 아예 피할 수 있다. 두 모듈 모두
     init()이 자기 타이머를 clearInterval하고 WebSocket도 중복 연결을 막으므로 재호출이
     안전하다. */
  (function loadMarketIndicatorTabs() {
    // 세 시장 탭의 차트 공통 표시 규칙. 봉/분봉·그리기 기능은 각 모듈이 유지한다.
    window.MarketChartStyle = {
      height: 230,
      theme: function (dark) {
        return {
          layout: { background: { color: 'transparent' }, textColor: dark ? '#a6b5c5' : '#64748b',
            fontFamily: 'Pretendard Variable, Pretendard, Malgun Gothic, sans-serif', fontSize: 12, attributionLogo: false },
          grid: { vertLines: { visible: false }, horzLines: { visible: false } },
          rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: .15, bottom: .15 } },
          timeScale: { visible: true, borderVisible: false }
        };
      }
    };
    var ASSET_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
    var CSS_URL = ASSET_BASE + 'css/market-indicators.css?v=20261025-plain-explainer-notes';
    var TABS = [
      {
        key: 'domestic', label: '국내 시장지표', slug: 'kospi-futures',
        mountIds: ['domestic-market-indicators', 'kospi-futures'],
        globalName: 'KospiFutures',
        script: ASSET_BASE + 'js/kospi-futures.js?v=20261025-tab-explainers',
        // kospi-futures.js·domestic-market-indicators.js는 자기 CSS를 스스로 넣는다. 증시자금 표(indicator-board)만 여기서 미리 넣는다.
        styles: [ASSET_BASE + 'css/indicator-board.css?v=20261016-no-gross']
      },
      {
        key: 'investor', label: '국내 투자자 수급', slug: 'domestic-market-indicators',
        mountIds: ['domestic-investor-flow'], globalName: 'DomesticMarketIndicators', method: 'initInvestor',
        script: ASSET_BASE + 'js/domestic-market-indicators.js?v=20261025-tab-explainers',
        styles: [ASSET_BASE + 'css/indicator-board.css?v=20261016-no-gross']
      },
      {
        key: 'global', label: '글로벌 시장지표', slug: 'overnight-market',
        mountIds: ['overnight-market'],
        globalName: 'OvernightMarket',
        script: ASSET_BASE + 'js/overnight-market.js?v=20261008-five-year-charts',
        // 2026-09-06 리포트("글로벌 시장지표 CSS 형태가 예전과 달라"): overnight-market.js는
        // 자기 CSS를 안 넣는다 - 원래 티스토리 페이지 본문의 <link>에 기대고 있었다.
        // 그래서 국내 주소에서 글로벌 탭을 열면 스타일 없이 그려졌다. 여기서 넣어준다.
        styles: [ASSET_BASE + 'css/overnight-market.css?v=20261008-five-year-charts', ASSET_BASE + 'css/indicator-board.css?v=20261012-board']
      },
      {
        key: 'us-macro', label: '주요 미국 발표', slug: 'us-macro-indicators',
        mountIds: ['us-macro-indicators'],
        globalName: 'UsMacroIndicators',
        script: ASSET_BASE + 'js/us-macro-indicators.js?v=20261025-tab-explainers',
        styles: [ASSET_BASE + 'css/us-macro-indicators.css?v=20261025-tab-explainers', ASSET_BASE + 'css/indicator-board.css?v=20261012-board']
      },
      {
        key: 'crypto', label: '가상자산', slug: 'crypto-market',
        mountIds: ['crypto-market'], globalName: 'CryptoMarket',
        script: ASSET_BASE + 'js/crypto-market.js?v=20261025-tab-explainers',
        styles: [ASSET_BASE + 'css/overnight-market.css?v=20261008-five-year-charts',
          ASSET_BASE + 'css/crypto-market.css?v=20261025-tab-explainers', ASSET_BASE + 'css/indicator-board.css?v=20261012-board']
      },
      {
        // 2026-10-11: 한국수출입은행 일별 공식 고시환율. 마운트(#fx-rates)는 아래 build()가 만든다 - skin.html 변경 없음.
        // ?tab=fx 로 이 탭을 바로 열 수 있다. 실시간 원/달러는 글로벌 시장지표 탭이 그대로 담당한다.
        key: 'fx', label: '환율', slug: 'fx-rates',
        mountIds: ['fx-rates'], globalName: 'FxRates',
        script: ASSET_BASE + 'js/fx-rates.js?v=20261025-tab-explainers',
        styles: [ASSET_BASE + 'css/fx-rates.css?v=20261025-plain-explainer-notes']
      }
    ];
    var matched = /^\/(?:page|pages)\/(kospi-futures|overnight-market)\/?$/i.exec(location.pathname);
    if (!matched) return;
    var slug = matched[1].toLowerCase();
    var initialKey = TABS.filter(function (tab) { return tab.slug === slug; })[0].key;
    var wantedTab = /[?&]tab=([a-z-]+)/i.exec(location.search);
    if (wantedTab && TABS.some(function (tab) { return tab.key === wantedTab[1].toLowerCase(); })) initialKey = wantedTab[1].toLowerCase();

    /* 이미 같은 파일을 가리키는 <link>가 있으면(티스토리 페이지 본문에 박혀 있는 경우)
       중복으로 넣지 않는다. 파일명만 보고 판단한다 - ?v= 값은 서로 다를 수 있다. */
    function ensureStyle(href, key) {
      var file = href.split('?')[0].split('/').pop();
      if (document.querySelector('link[data-mi-css="' + key + '"]')) return;
      if (document.querySelector('link[href*="/css/' + file + '"]')) return;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-mi-css', key);
      document.head.appendChild(link);
    }

    function tabByKey(key) {
      return TABS.filter(function (tab) { return tab.key === key; })[0] || null;
    }

    /* 이미 페이지 본문에 있는 <script>도 세어야 한다. 티스토리 페이지 HTML이 자기 모듈을
       불러오는 중일 수 있는데, 여기서 같은 파일을 또 넣으면 모듈 IIFE가 두 번 돈다. */
    function ensureScript(tab) {
      if (tab.key === 'investor' && window.DomesticMarketIndicators) return false;
      if (tab.key === 'investor') {
        var pending = document.querySelector('script[data-mi-script="investor"], script[src*="/js/domestic-market-indicators.js"]');
        if (pending) {
          pending.addEventListener('load', function () { activate('investor', true); }, { once: true });
          return true;
        }
      }
      if (document.querySelector('script[data-mi-script="' + tab.key + '"]')) return;
      var expectedSrc = tab.script;
      var existing = Array.prototype.slice.call(document.querySelectorAll('script[src*="/js/' + tab.slug + '.js"]'));
      var sameVersion = existing.some(function (node) { return node.src === expectedSrc; });
      if (sameVersion) return;
      var script = document.createElement('script');
      script.src = tab.script;
      script.defer = true;
      script.setAttribute('data-mi-script', tab.key);
      if (tab.key === 'investor') script.onload = function () { activate('investor', true); };
      document.body.appendChild(script);
      return true;
    }

    var historyModuleJob = null;
    function historyReady(key) {
      if (!historyModuleJob) historyModuleJob = new Promise(function (resolve) {
        if (window.MarketChartHistory) { resolve(); return; }
        var script = document.createElement('script');
        script.src = ASSET_BASE + 'js/market-history.js?v=20261008-5y';
        script.onload = script.onerror = resolve;
        document.head.appendChild(script);
      });
      return historyModuleJob.then(function () {
        var archive = window.MarketChartHistory ? window.MarketChartHistory.load(key === 'us-macro' ? 'macro' : key) : Promise.resolve(false);
        if (key !== 'us-macro' || (window.OvernightMarket && window.OvernightMarket.cryptoTools)) return archive;
        return Promise.all([archive, new Promise(function (resolve) {
          var script = document.createElement('script');
          script.src = ASSET_BASE + 'js/overnight-market.js?v=20261008-five-year-charts';
          script.onload = script.onerror = resolve; document.head.appendChild(script);
        })]);
      });
    }
    function activate(key, ready) {
      if (!ready) { historyReady(key).then(function () {
        var panel = document.querySelector('.mi-panel[data-mi-panel="' + key + '"]');
        if (panel && !panel.hidden) activate(key, true);
      }); return; }
      var tab = tabByKey(key);
      if (!tab) return;
      if (ensureScript(tab)) return; // 최신 스크립트가 붙으면 모듈이 스스로 init한다.
      var module = window[tab.globalName];
      var method = tab.method || 'init';
      if (module && typeof module[method] === 'function') {
        module[method]();
      }
    }

    function select(key) {
      TABS.forEach(function (tab) {
        var on = tab.key === key;
        var panel = document.querySelector('.mi-panel[data-mi-panel="' + tab.key + '"]');
        if (panel) panel.hidden = !on;
        var button = document.querySelector('.mi-tab[data-mi-tab="' + tab.key + '"]');
        if (button) {
          button.classList.toggle('active', on);
          button.setAttribute('aria-selected', on ? 'true' : 'false');
        }
      });
      activate(key);
    }

    // Summarize the rows already rendered by each tab. No extra data or AI
    // request: keep labels, values and dates exactly as displayed in the source.
    function installTabSummary(panel, tab) {
      if (tab.key === 'global') return; // Its module already renders a rule-based summary first.
      var selectors = {
        domestic: '.dmi-spot-table tbody tr, .dmi-fund-board .ibd-row',
        investor: '.ifl-lines li, .ibd-row',
        'us-macro': '.ibd-row', crypto: '.ibd-row', fx: '.fxr-table tbody tr'
      };
      var summary = document.createElement('section');
      summary.className = 'mi-tab-summary';
      var status = document.createElement('div');
      status.className = 'om-live-status';
      status.setAttribute('role', 'status');
      status.textContent = {domestic: 'REST 확인 중', investor: '수급 집계', 'us-macro': '발표 자료', crypto: '30초 갱신', fx: '일별 고시'}[tab.key];
      summary.appendChild(status);
      var box = document.createElement('div');
      box.className = 'om-summary';
      var head = document.createElement('div');
      head.className = 'om-summary-head';
      head.innerHTML = '<svg class="om-summary-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/></svg>';
      var heading = document.createElement('h2');
      heading.textContent = tab.label + ' 요약';
      head.appendChild(heading);
      box.appendChild(head);
      var body = document.createElement('div');
      body.className = 'om-summary-body';
      box.appendChild(body);
      var note = document.createElement('div');
      note.className = 'mi-summary-note om-summary-tone';
      note.textContent = '현재 탭에 표시된 자료 요약 · 각 항목의 기준일과 단위는 원본 표를 함께 확인하세요.';
      box.appendChild(note);
      summary.appendChild(box);
      panel.insertBefore(summary, panel.firstChild);
      function update() {
        var connection = panel.querySelector('[data-dmi-connection]');
        if (connection) {
          if (status.textContent !== connection.textContent) status.textContent = connection.textContent;
          var state = connection.getAttribute('data-state') || '';
          if (status.getAttribute('data-state') !== state) status.setAttribute('data-state', state);
        }
        var basis = panel.querySelector(tab.key === 'fx' ? '[data-fx-meta]' : '[data-if-asof]');
        var noteText = '현재 탭에 표시된 자료 요약 · 각 항목의 기준일과 단위는 원본 표를 함께 확인하세요.'
          + (basis ? ' ' + basis.textContent.replace(/\s+/g, ' ').trim() : '');
        if (note.textContent !== noteText) note.textContent = noteText;
        var lines = Array.prototype.slice.call(panel.querySelectorAll(selectors[tab.key]));
        lines = lines.map(function (row) {
          // IndicatorBoard repeats values in hidden mobile-only copies. Use
          // table cells once, rather than concatenating responsive duplicates.
          var cells = row.querySelectorAll(':scope > th, :scope > td');
          if (cells.length && !Array.prototype.some.call(row.querySelectorAll(':scope > td'), function (cell) {
            return /\d/.test(cell.textContent);
          })) return '';
          var headers = row.closest('table') && row.closest('table').querySelectorAll('thead tr:last-child th');
          return (cells.length ? Array.prototype.map.call(cells, function (cell, index) {
            var label = cell.getAttribute('data-label') || (index > 0 && headers && headers[index] ? headers[index].textContent.trim() : '');
            return (label ? label + ': ' : '') + cell.textContent.replace(/\s+/g, ' ').trim();
          }).join(' · ') : row.textContent.replace(/\s+/g, ' ').trim());
        }).filter(function (line) { return /\d/.test(line) && !/불러오는 중|불러오지 못|자료 없음|미수신|확인 중|요약하지 않습니다/.test(line); });
        lines = lines.filter(function (line, i) { return lines.indexOf(line) === i; }).slice(0, 4);
        var signature = lines.join('\n');
        if (body.dataset.signature === signature) return;
        body.dataset.signature = signature;
        body.textContent = '';
        if (!lines.length) {
          var empty = document.createElement('p');
          empty.textContent = '요약할 수 있는 수치가 없습니다. 아래 자료의 수신 상태를 확인하세요.';
          body.appendChild(empty);
          return;
        }
        lines.forEach(function (line) {
          var row = document.createElement('div');
          row.className = 'om-summary-line';
          var split = line.indexOf(' · ');
          if (split > 0) {
            var label = document.createElement('b');
            label.textContent = line.slice(0, split);
            row.appendChild(label);
            row.appendChild(document.createTextNode(' ' + line.slice(split + 3)));
          } else row.textContent = line;
          body.appendChild(row);
        });
      }
      var queued = false;
      new MutationObserver(function (records) {
        if (records.every(function (record) { return summary.contains(record.target); }) || queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; update(); });
      }).observe(panel, { childList: true, characterData: true, attributes: true, attributeFilter: ['data-state'], subtree: true });
      update();
    }

    function build() {
      if (document.querySelector('[data-mi-tabs]')) return;
      // 본문에 들어 있는 mount를 기준점으로 삼는다. 둘 다 없으면 이 지면이 아니다.
      var anchor = null;
      for (var i = 0; i < TABS.length && !anchor; i++) {
        for (var j = 0; j < TABS[i].mountIds.length && !anchor; j++) {
          anchor = document.getElementById(TABS[i].mountIds[j]);
        }
      }
      if (!anchor || !anchor.parentNode) return;

      ensureStyle(CSS_URL, 'tabs');
      // 두 탭의 CSS를 처음부터 같이 넣는다. 탭을 여는 순간 받으면 스타일 없는 화면이
      // 한 번 스쳐 지나간다(FOUC).
      TABS.forEach(function (tab) {
        (tab.styles || []).forEach(function (href) { ensureStyle(href, tab.key); });
      });

      var wrap = document.createElement('div');
      wrap.className = 'mi-wrap';
      anchor.parentNode.insertBefore(wrap, anchor);

      var bar = document.createElement('div');
      bar.className = 'mi-tabs';
      bar.setAttribute('data-mi-tabs', '1');
      bar.setAttribute('role', 'tablist');
      wrap.appendChild(bar);

      TABS.forEach(function (tab) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'mi-tab';
        button.textContent = tab.label;
        button.setAttribute('data-mi-tab', tab.key);
        button.setAttribute('role', 'tab');
        bar.appendChild(button);

        var panel = document.createElement('div');
        panel.className = 'mi-panel';
        panel.setAttribute('data-mi-panel', tab.key);
        wrap.appendChild(panel);
        tab.mountIds.forEach(function (id) {
          var mount = document.getElementById(id);
          if (!mount) {
            mount = document.createElement('div');
            mount.id = id;
          }
          panel.appendChild(mount);
        });
        installTabSummary(panel, tab);
      });

      bar.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-mi-tab]') : null;
        if (button) select(button.getAttribute('data-mi-tab'));
      });

      select(initialKey);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
  })();

  /* 홈은 기존 위젯/API를 시장 상황판 구조로 재배치한다. 백엔드 계산과 URL은 그대로 두고,
     여기서는 카드 배치·요약 집계·수급 부호 기반 규칙문만 담당한다. */
  (function buildHomeDashboard() {
    if (location.pathname !== '/' && location.pathname !== '') return;
    function initBriefingCarousel(section) {
      (window.SiteInteractionsReady || Promise.resolve(window.SiteInteractions)).then(function (module) {
        if (!module) return;
        module.carousel(section, {track:'.briefing-carousel-track',previous:'[data-briefing-prev]',next:'[data-briefing-next]',progress:'.briefing-carousel-progress',card:'.home-briefing-card'});
      }).catch(function () {});
    }

    var feed = document.querySelector('.feed');
    var investorMount = document.getElementById('investor-trend-widget');
    var rankMount = document.getElementById('sidebar-rank');
    if (!feed) return;

    window.HomeMarketSelection = window.HomeMarketSelection || (function () {
      var selected = null;
      // 2026-09-05: 시장 경계는 js/skin-shell.js의 MarketHours 하나만 쓴다. 예전엔 이
      // 안에 직접 박아뒀는데 같은 판정이 파일마다 다른 경계로 복제돼 있었고(미국 전환
      // 17:00/20:30, 휴장 창 토09:00/토07:00), 어긋나는 구간에서 실제로 화면이 깨졌다.
      // skin.html이 skin-shell.js를 이 파일보다 먼저 defer로 부르므로 항상 존재한다.
      function autoMarket() {
        var hours = window.MarketHours;
        return hours ? hours.homeMarket() : 'domestic';
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
    var CALENDAR_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/stock-calendar.js?v=20261004-econ-sp100-v1';
    var HOME_WIDGETS_SCRIPT_URL = document.currentScript && document.currentScript.src
      ? document.currentScript.src.replace(/skin-main(?:\.min)?\.js(?:\?.*)?$/, 'home-widgets.js?v=20261005-rotation-moved')
      : 'https://goodbyestarwars.github.io/tistory-ticker/js/home-widgets.js?v=20261005-rotation-moved';
    var HOME_CHART_HOVER_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-chart-hover.js?v=20261018-hover';
    var HOME_REALTIME_TABLE_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-realtime-table.js?v=20261020-board-metrics';
    var HOME_ECONOMIC_NEWS_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-economic-news.js?v=20261008-24h-et';
  var HOME_WEEKLY_REPORT_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-weekly-report.js?v=20261027-block-subtitles';

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
      return window.NineHttp.json(url, { timeoutMs: timeoutMs || 15000 });
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
        + '<div class="home-market-toolbar">'
        + '<div class="home-market-switch" role="tablist" aria-label="메인 시장 전환">'
        + '<button type="button" data-home-market-switch="domestic" role="tab"><span class="home-market-switch-icon" aria-hidden="true">🇰🇷</span><span>한국증시</span></button><button type="button" data-home-market-switch="us" role="tab"><span class="home-market-switch-icon" aria-hidden="true">🇺🇸</span><span>미국증시</span></button><button type="button" data-home-market-switch="closed" role="tab"><span class="home-market-switch-icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg></span><span>휴장</span></button>'
        + '</div><div class="home-switch-countdown" hidden role="timer" aria-live="off"></div></div>'
        + '<section class="home-closed-page" data-home-closed-page aria-label="시장 휴장" hidden>'
        + '<div class="home-closed-lead"><div class="home-closed-kicker"><span>MARKET CLOSED NOTE</span><div class="home-closed-title-row">'
        + '<svg class="home-closed-lock" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        + '<path d="M28 68 V45a22 22 0 0 1 44 0v23" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'
        + '<rect x="14" y="64" width="72" height="60" rx="15" fill="none" stroke="currentColor" stroke-width="6"/>'
        + '<path d="M45 90a6 6 0 1 1 10 4l3 13h-16l3-13a6 6 0 0 1 0-4z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>'
        + '<path d="M61 83a7 7 0 0 1-10 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
        + '</svg>'
        + '<h1>Markets Closed</h1></div><p>주말·한국 공휴일에는 국내 증시가 쉽니다. 미국 증시는 현지 거래일에 운영됩니다.</p></div><a class="home-closed-status" href="/page/stock-calendar" aria-label="캘린더"><strong>다음 거래일을 준비하는 시간입니다.</strong><span>다음 거래일부터 시장 데이터가 업데이트됩니다.</span><small>관심종목 일정과 이전 시장 화면은 위 탭에서 확인할 수 있습니다.</small><span class="home-closed-link">캘린더 →</span></a></div>'
        + '</section>'
        + '<div class="home-overview-grid home-editorial-lead">'
        + '<section class="home-market-board editorial-section hmb2 home-block-column" id="homeMarketBoard">'
        + '<section class="home-market-overview ui-content-block"><div class="home-card-heading"><div><strong class="ui-section-title" data-home-market-field="title">국내 시장</strong><span id="hmbUpdated">오늘의 시장판 · 시세 확인 중</span></div>'
        + '<div class="home-cb-wrap"><button type="button" class="vol-history-link" data-vol-open="all" data-vol-history hidden aria-expanded="false" aria-controls="volPanel">오늘 변동성 이력</button><span class="home-market-live" data-home-market-field="live">실시간</span></div></div>'
        + '<div class="hmb2-status" data-hmb-status>'
        + '<dl class="hmb-list hmb2-verdict">'
        + '<div class="hmb2-temp"><dt>증시온도</dt><dd data-market-field="temperature">데이터 확인 중</dd></div>'
        + '<div class="hmb2-direction"><dt>시장 방향</dt><dd data-market-field="direction">데이터 확인 중</dd></div>'
        + '<div class="hmb2-participation" data-home-participation aria-label="평균 100 대비 거래량"></div>'
        + '<div class="hmb2-market-ratios" data-domestic-ratios>'
        + '<div class="hmb2-temp" data-domestic-ratio="KOSPI"><dt>코스피</dt><dd>데이터 확인 중</dd></div>'
        + '<div class="hmb2-temp" data-domestic-ratio="KOSDAQ"><dt>코스닥</dt><dd>데이터 확인 중</dd></div></div>'
        + '<div class="hmb2-market-ratios" data-us-ratios hidden><div data-us-ratio="SP500"><dt>S&amp;P 500</dt><dd>데이터 확인 중</dd></div><div data-us-ratio="NASDAQ"><dt>나스닥 종합</dt><dd>데이터 확인 중</dd></div><span class="hmb2-breadth-total" data-us-breadth-meta>지수 구성종목 · 지연시세</span></div>'
        + '<div class="hmp-basis hmp-note" data-participation-basis></div>'
        + '</dl>'
        // 2026-10-15 시장 변동성 모니터: CB·사이드카·VI를 한 곳에 압축 표시하고 눌러서 상세를 연다(homeCircuitBreakerBadges가 채운다).
        + '<div class="vol-monitor" data-vol-monitor hidden></div>'
        + '</div>'
        + '</section><div class="home-index-strip" aria-label="대표 시장 지수">'
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
        + '<section class="home-market-summary ui-content-block"><div class="hmb-summary-head"><strong class="ui-section-title" data-home-summary-field="title">시장 핵심 지표</strong><span data-home-summary-field="meta">최신 데이터</span></div>'
        + '<dl class="hmb-list hmb2-core">'
        + '<div class="hmb2-fx"><dt>원/달러</dt><dd data-market-field="exchange">데이터 확인 중</dd></div>'
        + '<div class="hmb2-leaders"><dt>주도 업종</dt><dd data-market-field="leaders">데이터 확인 중</dd></div>'
        + '<div class="hmb2-cautions"><dt>주의 업종</dt><dd data-market-field="cautions">데이터 확인 중</dd></div>'
        + '<div data-home-night-futures hidden><dt>KOSPI200 야간선물</dt><dd data-market-field="nightFutures">데이터 확인 중</dd>'
        + '<div class="home-index-chart home-night-futures-chart" data-night-futures-chart aria-hidden="true"></div></div>'
        + '<div class="hmb-investor-trend" data-home-investor-trend aria-label="KOSPI KOSDAQ 외국인 순매수 추이">'
        + '<div class="hmb-investor-trend-head"><dt>투자자 동향</dt><div class="hmb-investor-controls"><span>외국인 · 30분 누적</span>'
        + '<button type="button" class="ui-btn ui-btn-text hmb-investor-switch" data-investor-switch aria-label="막대 차트로 전환">‹</button>'
        + '<span data-investor-mode>면적</span><button type="button" class="ui-btn ui-btn-text hmb-investor-switch" data-investor-switch aria-label="막대 차트로 전환">›</button></div></div>'
        + '<div class="hmb-investor-trend-body"><span class="hmb-investor-loading">데이터 확인 중</span></div>'
        + '</div>'
        + '</dl></section>'
        // 2026-10-05 사용자 요청("미국시장 밑에 S&P ETF 등 주요 ETF 수익률, 칸에 맞춰서 미니멀하게"): 미국 모드에서만.
        // 시장 요약과 같은 머리말·칸(.hmb-summary-head/.hmb-list)을 그대로 써서 칸 모양을 맞춘다. 값은 /us-etf-returns.
        + '<div class="hmb-etf ui-content-block" data-home-us-etfs hidden><div class="hmb-summary-head"><strong class="ui-section-title">주요 ETF 수익률</strong><span data-home-us-etfs-meta>1일 · 1개월 · 연초 이후</span></div>'
        + '<div class="hmb-etf-cards" data-home-us-etfs-list></div></div>'
        + '<section class="home-top-disclosures ui-content-block" aria-label="관심종목 주간 공시" data-home-disclosure-section hidden>'
        + '<div class="home-top-disclosures-head"><strong class="ui-section-title" data-home-disclosure-field="title">관심종목 주간 공시</strong><span data-home-disclosure-field="meta">최근 7일</span></div>'
        + '<div class="home-disclosure-list" id="homeDisclosureList"><p class="home-card-state">공시를 확인하는 중...</p></div>'
        + '</section>'
        + '</section>'
        + '<section class="home-economic-news editorial-section home-block-column" id="homeEconomicNews" aria-label="실시간 경제 종합뉴스">'
        + '<div class="home-economic-disclosures-slot" data-home-disclosure-slot></div>'
        + '<section class="home-economic-content ui-content-block"><div class="hen-head"><div><strong class="ui-section-title">경제 종합뉴스</strong><span data-hen-session>국내 · 실시간 타임라인</span></div><small class="nt-stamp" data-hen-updated>최신 뉴스 확인 중</small></div>'
        + '<div class="hen-breaking" data-hen-breaking aria-label="중요 경제 속보" hidden>'
        + '<div class="hen-breaking-head"><strong>속보</strong><span>실적 · 거시경제 · 금리</span></div>'
        + '<div class="hen-breaking-list" data-hen-breaking-list></div>'
        + '</div>'
        + '<div class="hen-list" data-hen-list><p class="home-card-state"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>경제 뉴스를 불러오는 중입니다.</p></div>'
        + '</section></section></div>'
        + '<section class="home-realtime-board editorial-section" id="homeRealtimeBoard" aria-label="실시간 종목판"></section>'
        + '</section>';
    }

    // 2026-10-10 국내 시장 위젯 개편 스타일. 마크업을 만들기 전에 붙여 첫 그림부터 새 모양으로 나온다.
    if (!document.querySelector('link[data-home-market-board-css]')) {
      var hmbCss = document.createElement('link');
      hmbCss.rel = 'stylesheet';
      hmbCss.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-market-board.css?v=20261027-open-block-columns';
      hmbCss.setAttribute('data-home-market-board-css', '1');
      document.head.appendChild(hmbCss);
    }
    var dashboard = document.createElement('div');
    dashboard.innerHTML = dashboardHtml();
    var dashboardSection = dashboard.firstElementChild;
    // Own the dependency at the asynchronous dashboard mount as well as in the skin.
    // The shared module guards duplicate loads and rebinds its existing timer.
    loadHomeScript('https://goodbyestarwars.github.io/tistory-ticker/js/home-switch-countdown.js?v=20261026-restore', 'HomeSwitchCountdown')
      .then(function (countdown) { countdown.refresh(); })
      .catch(function (error) { console.warn('시장 카운트다운 초기화 실패', error); });

    function field(name) {
      return dashboardSection.querySelector('[data-market-field="' + name + '"]');
    }

    function setField(name, text, tone) {
      var element = field(name);
      if (!element) return;
      var fullText = text == null ? '' : String(text);
      // 요약 API가 일시적으로 '?'를 반환해도 사용자가 의미 없는 물음표를
      // 지표 값으로 오해하지 않도록 상태 문구로 바꿔 표시한다.
      var placeholderOnly = /^\?+$/.test(fullText.trim());
      if (placeholderOnly) fullText = '';
      element.textContent = fullText;
      element.hidden = placeholderOnly;
      // 2026-10-23 사용자 요청: hover 설명(native tooltip, '?' 커서)은 없애고 접근성 레이블만 유지한다.
      element.setAttribute('aria-label', fullText);
      element.classList.remove('home-positive', 'home-negative', 'home-neutral');
      if (tone) element.classList.add(tone);
    }

    var homeUsEtfsAt = 0;
    var homeShowsUs = false;
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
      if (title) title.textContent = isUs ? '미국 시장 요약' : '시장 핵심 지표';
      if (meta) meta.textContent = isUs ? '거래대금 상위 종목 기준' : '증시온도·업종 기준';
      if (labels[0]) labels[0].textContent = isUs && usSession && !usSession.open ? '시장 상태' : '상승 종목 비율';
      // Outside the US cash session, the large "시장 방향" headline already
      // shows the same "본장 개장 전 / 본장 마감 / 미국장 휴장" label.
      // Hide only the duplicate small row, not the headline or live futures.
      // Restore it for the US regular session (breadth) and domestic market (temperature).
      var secondaryMarketStatus = dashboardSection.querySelector('.hmb2-verdict > .hmb2-temp');
      // 국내·미국이 같은 상승 비율 행과 막대를 공유한다.
      if (secondaryMarketStatus) secondaryMarketStatus.hidden = true;
      var domesticRatios = dashboardSection.querySelector('[data-domestic-ratios]');
      if (domesticRatios) domesticRatios.hidden = isUs;
      var usRatios = dashboardSection.querySelector('[data-us-ratios]');
      if (usRatios) usRatios.hidden = !isUs || !!(usSession && !usSession.open);
      if (investorTrend) investorTrend.hidden = isUs;
      if (nightFutures) nightFutures.hidden = !isUs;
      var verdict = dashboardSection.querySelector('.hmb2-verdict');
      if (verdict) verdict.classList.toggle('has-market-breadth', !isUs || !!(usSession && usSession.open));
      homeShowsUs = isUs;
      renderMarketParticipation();
      var usEtfs = dashboardSection.querySelector('[data-home-us-etfs]');
      if (usEtfs) {
        if (!isUs) usEtfs.hidden = true;
        else loadHomeUsEtfs(usEtfs);
      }
    }

    // 주요 ETF 수익률(미국 모드). 일봉 기준이라 10분 안에는 다시 부르지 않는다. 실패하면 칸을 숨긴 채 둔다.
    function loadHomeUsEtfs(box) {
      if (Date.now() - homeUsEtfsAt < 600000 && box.getAttribute('data-loaded') === '1') { box.hidden = false; return; }
      homeUsEtfsAt = Date.now();
      fetch('https://goodbyestar.cloud/us-etf-returns').then(function (r) { return r.json(); }).then(function (env) {
        var d = env && env.data ? env.data : env;
        var items = d && d.items || [];
        var list = box.querySelector('[data-home-us-etfs-list]');
        if (!items.length || !list) return;
        function pct(v) { return v == null ? '-' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; }
        function tone(v) { return v > 0 ? 'home-positive' : v < 0 ? 'home-negative' : 'home-neutral'; }
        list.innerHTML = items.map(function (it) {
          var title = it.symbol + ' ' + it.name + ' · 1주 ' + pct(it.return1w) + ' · 1개월 ' + pct(it.return1m) + ' · 연초 이후 ' + pct(it.returnYtd);
          // 2026-10-05 사용자 요청("미니멀한 카드형으로"): 칸 목록 대신 작은 카드. 티커·이름 / 1일 / 1M·YTD 세 줄.
          return '<article class="hmb-etf-card" title="' + title.replace(/"/g, '&quot;') + '">'
            + '<div class="hmb-etf-name"><b>' + it.symbol + '</b><span>' + it.name + '</span></div>'
            + '<strong class="' + tone(it.return1d) + '">' + pct(it.return1d) + '</strong>'
            + '<p><span>1M <em class="' + tone(it.return1m) + '">' + pct(it.return1m) + '</em></span>'
            + '<span>YTD <em class="' + tone(it.returnYtd) + '">' + pct(it.returnYtd) + '</em></span></p></article>';
        }).join('');
        var meta = box.querySelector('[data-home-us-etfs-meta]');
        if (meta && d.date) meta.textContent = d.date.slice(5).replace('-', '.') + ' 미국 종가' + (d.final === false ? '(잠정)' : '') + ' · 1일 · 1개월 · 연초 이후';
        box.setAttribute('data-loaded', '1');
        box.hidden = !homeShowsUs; // 응답이 오는 사이 국내 탭으로 바뀌었으면 숨긴 채 둔다
      }).catch(function () { box.hidden = true; });
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

    // 2026-10-02 사용자 지적("대시보드는 21.2도 중립인데 증시온도 페이지에는 온도가 없어"): 페이지는
    // 2026-09-07 개편부터 3축 종합점수(score100)를 보여 주는데 대시보드만 GAS 레거시 온도(℃)를 읽고 있었다.
    // VM /market-temp의 종합점수·3단계 등급만 쓴다. 실패 시 같은 계약의 최근 캐시/지연을 표시한다.
    var homeVmScoreText = '';

    function setHomeVmScore(data) {
      if (!data || data.score100 == null || data.score100 === '') return;
      var score = Number(data.score100);
      if (!isFinite(score) || score < 0 || score > 100) return;
      var label = data.grade3 && data.grade3.label ? ' ' + data.grade3.label : '';
      homeVmScoreText = Math.round(score) + '점' + label;
      renderDomesticBreadth(data);
    }

    // Domestic headline uses the same two indices and full-market counts shown
    // below it. The temperature's screened sample is not a market-wide breadth.
    var homeDomesticMarketTemp = null;
    function resolveDomesticMarketDirection(market, items) {
      var rates = ['KOSPI', 'KOSDAQ'].map(function (symbol) {
        var item = (items || []).find(function (row) { return row && row.symbol === symbol; });
        if (!item || item.stale || item.change_rate == null || item.change_rate === '') return null;
        var at = Date.parse(item.updated_at || '');
        if (!isFinite(at) || Date.now() - at < -60000 || (!item.market_closed && Date.now() - at > 300000)) return null;
        var rate = Number(item.change_rate);
        return isFinite(rate) ? rate : null;
      });
      if (rates.some(function (rate) { return rate === null; })) return { label: '데이터 확인 중', tone: 'home-neutral' };
      var total = market && market.marketBreadth && market.marketBreadth.total;
      var ratio = total && typeof total.up === 'number' && typeof total.down === 'number'
        && typeof total.total === 'number' && total.total > 0 && total.up >= 0 && total.down >= 0
        && total.up + total.down <= total.total ? total.up / total.total : null;
      var down = rates.every(function (rate) { return rate < 0; });
      var up = rates.every(function (rate) { return rate > 0; });
      if (!down && !up) return { label: '혼조', tone: 'home-neutral' };
      if (down) {
        if (ratio != null && ratio <= 0.15 && rates.every(function (rate) { return rate <= -1; })) return { label: '급락', tone: 'home-negative' };
        return { label: (ratio != null && ratio <= 0.3) || rates.every(function (rate) { return rate <= -1; }) ? '강한 약세' : '약세 우위', tone: 'home-negative' };
      }
      if (ratio != null && ratio >= 0.85 && rates.every(function (rate) { return rate >= 1; })) return { label: '급등', tone: 'home-positive' };
      if (ratio != null && ratio <= 0.45) return { label: '지수 상승·종목 약세', tone: 'home-neutral' };
      return { label: ratio != null && ratio >= 0.7 ? '강한 강세' : '상승 우위', tone: 'home-positive' };
    }

    function renderDomesticDirection(market) {
      if (homeMarketSession().market !== 'domestic') return;
      var direction = resolveDomesticMarketDirection(market, latestHomeIndices);
      setField('direction', direction.label, direction.tone);
    }

    function renderMarketTemperature(market) {
      if (market && typeof market.score100 === 'number' && isFinite(market.score100)) {
        setHomeVmScore(market);
        homeDomesticMarketTemp = market;
        renderDomesticDirection(market);
        var exchange = market.components && market.components.exchange;
        if (exchange && typeof exchange.price === 'number') {
          var exchangeRate = Number(exchange.changeRate);
          var arrow = exchangeRate > 0 ? ' ▲' : exchangeRate < 0 ? ' ▼' : '';
          setField('exchange', exchange.price.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '원' + arrow,
            exchangeRate > 0 ? 'home-positive' : exchangeRate < 0 ? 'home-negative' : 'home-neutral');
        }
        var updated = document.getElementById('hmbUpdated');
        if (updated && market.updatedAt) updated.textContent = window.NineTime.updated(market.updatedAt) || ('시황 ' + formatHomeTimestamp(market.updatedAt) + ' 기준');
      }
    }

    var MARKET_TEMP_VM_URL = 'https://goodbyestar.cloud/market-temp';

    // 공통 요약 막대. 보합·미분류는 배경으로 남겨 하락으로 합치지 않는다.
    function renderHomeRiseRatio(upRatio, downRatio, targetRow) {
      var valid = typeof upRatio === 'number' && isFinite(upRatio) && upRatio >= 0 && upRatio <= 1;
      var row = targetRow || dashboardSection.querySelector('.hmb2-verdict > .hmb2-temp');
      var value = row && row.querySelector('dd');
      if (value) {
        value.textContent = valid ? (targetRow ? '상승 ' : '') + (upRatio * 100).toFixed(1) + '%' : '데이터 확인 중';
        value.className = valid ? upRatio >= 0.55 ? 'home-positive' : upRatio <= 0.45 ? 'home-negative' : 'home-neutral' : 'home-neutral';
      }
      var bar = row && row.querySelector('[data-hmb-upbar]');
      if (!valid) { if (bar) bar.hidden = true; return; }
      if (!row) return;
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'hmb2-upbar';
        bar.setAttribute('data-hmb-upbar', '');
        bar.innerHTML = '<i class="is-up"></i><i class="is-flat"></i><i class="is-down"></i>';
        row.appendChild(bar);
      }
      var down = typeof downRatio === 'number' && isFinite(downRatio) ? Math.max(0, Math.min(1 - upRatio, downRatio)) : 0;
      bar.querySelector('.is-up').style.width = (upRatio * 100).toFixed(2) + '%';
      bar.querySelector('.is-down').style.width = (down * 100).toFixed(2) + '%';
      var flatBar = bar.querySelector('.is-flat');
      if (flatBar) flatBar.style.width = ((1 - upRatio - down) * 100).toFixed(2) + '%';
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', '상승 ' + (upRatio * 100).toFixed(1) + '% · 하락 ' + (down * 100).toFixed(1) + '% · 나머지 보합·미분류');
      bar.title = bar.getAttribute('aria-label');
      bar.hidden = false;
    }

    // 국내 전종목 집계와 미국 조회 표본은 같은 표시기를 쓰되 집계 범위를 구분한다.
    function renderHomeBreadthEntry(row, label, entry, isSample) {
      if (!row) return;
      if (entry && typeof entry.up === 'number' && typeof entry.down === 'number') {
        var count = typeof entry.total === 'number' ? entry.total : entry.up + entry.down + (entry.flat || 0);
        if (count > 0 && entry.up >= 0 && entry.down >= 0 && entry.up + entry.down <= count) {
          var flat = typeof entry.flat === 'number' ? entry.flat : null;
          row.classList.remove('hmb2-temp');
          row.innerHTML = '<dt>' + label + '</dt>'
            + '<span class="hmb2-breadth-total">' + (isSample ? '집계 ' : '전체 ') + count.toLocaleString('ko-KR') + '종목</span><dd></dd>'
            + '<span class="hmb2-upbar" data-hmb-upbar><i class="is-up"></i><i class="is-flat"></i><i class="is-down"></i></span>'
            + '<span class="hmb2-breadth-counts"><span>상승 <b class="home-positive">' + entry.up.toLocaleString('ko-KR') + '</b></span>'
            + '<span>' + (flat === null ? '미분류' : '보합') + ' <b>' + (flat === null ? count - entry.up - entry.down : flat).toLocaleString('ko-KR') + '</b></span>'
            + '<span>하락 <b class="home-negative">' + entry.down.toLocaleString('ko-KR') + '</b></span></span>';
          renderHomeRiseRatio(entry.up / count, entry.down / count, row);
          return;
        }
      }
      row.classList.add('hmb2-temp');
      row.innerHTML = '<dt>' + label + '</dt><dd></dd>';
      renderHomeRiseRatio(null, null, row);
    }

    function renderDomesticBreadth(data) {
      if (homeMarketSession().market !== 'domestic') return;
      var byMarket = data && data.marketBreadth && data.marketBreadth.byMarket;
      ['KOSPI', 'KOSDAQ'].forEach(function (key) {
        var row = dashboardSection.querySelector('[data-domestic-ratio="' + key + '"]');
        renderHomeBreadthEntry(row, key === 'KOSPI' ? '코스피' : '코스닥', byMarket && byMarket[key], false);
      });
    }

    function loadHomeIndexBreadth() {
      if (homeMarketSession().market !== 'domestic') return;
      loadDomesticParticipation();
      fetchHomeJson(MARKET_TEMP_VM_URL, 12000).then(function (body) {
        if (homeMarketSession().market !== 'domestic') return;
        var data = body && body.data ? body.data : body;
        renderMarketTemperature(data);
        renderDomesticBreadth(data);
      }).catch(function () { /* 기존 정상 표시를 유지한다. */ });
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
      // 2026-09-07 리포트("미국장 노동절인데 휴장 아닌 걸로 나와"): 여기 판정이 주말만
      // 보고 있었다. 휴장일 표는 js/skin-shell.js의 MarketHours 한 곳에만 둔다 - 같은
      // 판정을 여러 파일에 복제했다가 화면이 갈렸던 전례(2026-09-05 MarketHours 도입)를
      // 반복하지 않는다.
      // skin-main.js에는 global 별칭이 없다 - window로 읽어야 ReferenceError가 안 난다
      // (2026-09-06 시장지표 탭에서 같은 실수를 했다).
      if (window.MarketHours && window.MarketHours.isUsHoliday
          && window.MarketHours.isUsHoliday(now)) {
        return { open: false, label: '미국장 휴장', subtitle: '미국 현물 · 휴장' };
      }
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
          labels: ['나스닥 종합 현물', 'S&P500 현물'],
          live: '나스닥 종합 · S&P500 현물',
          statusLabel: spot.label,
          subtitle: spot.subtitle
        };
      }
      if (usFuturesSessionOpen(now)) {
        return {
          source: 'futures',
          keys: ['NASDAQ100', 'SP500'],
          labels: ['나스닥100 선물(CME)', 'S&P500 선물(CME)'],
          live: '나스닥100 · S&P500 선물(CME)',
          statusLabel: '선물 거래중',
          // 2026-10-15 "선물이야 현물이야" 문의: 선물 값은 현물 지수와 다르다는 점을 부제에 못 박는다.
          subtitle: '미국 지수선물(CME) 거래중 · 현물 지수와 값이 다름(현물 ' + spot.label + ')'
        };
      }
      return {
        source: 'spot',
        keys: ['NASDAQ_INDEX', 'SP500_INDEX'],
        labels: ['나스닥 종합 현물', 'S&P500 현물'],
        live: '나스닥 종합 · S&P500 현물',
        statusLabel: spot.label,
        subtitle: spot.subtitle
      };
    }

    // 2026-09-05: 코스피 야간선물 휴장 판정을 js/skin-shell.js의 MarketHours로 옮겼다.
    // 휴장일 표가 이 파일·kospi-futures.js·domestic-market-indicators.js 세 곳에
    // 복제돼 있어서, 해가 바뀌면 세 군데를 다 고쳐야 했다. 이제 한 곳만 고친다.
    function isNightFuturesHoliday() {
      var hours = window.MarketHours;
      return hours ? hours.isNightSessionHoliday() : false;
    }

    function summarizeUsMarket(data, indexItems) {
      var payload = data && data.data ? data.data : data;
      var rows = payload && payload.rows ? payload.rows : [];
      var valid = rows.map(function (row) {
        return { rate: row && row.change_rate != null && row.change_rate !== '' ? Number(row.change_rate) : NaN, industry: String(row && row.industry || '').trim() };
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
        breadth: { up: rising, down: valid.filter(function (row) { return row.rate < 0; }).length, flat: valid.filter(function (row) { return row.rate === 0; }).length, total: valid.length },
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
        setField('leaders', '데이터 확인 중', 'home-neutral');
        setField('cautions', '데이터 확인 중', 'home-neutral');
        return;
      }
      var sessionOpen = !summary.sessionState || summary.sessionState.open;
      if (!sessionOpen) setField('direction', summary.direction.label, summary.direction.tone);
      setField('leaders', sectorSummaryText(summary.leaders, '업종 데이터 없음'), 'home-positive');
      setField('cautions', sectorSummaryText(summary.cautions, '업종 데이터 없음'), 'home-negative');
      var updated = document.getElementById('hmbUpdated');
      if (updated && summary.updatedAt) updated.textContent = window.NineTime.updated(summary.updatedAt) || (formatHomeTimestamp(summary.updatedAt) + ' 기준');
    }

    function renderUsIndexBreadth(body) {
      latestHomeParticipation.us = body;
      if (homeMarketSession().market !== 'us') return;
      renderMarketParticipation();
      var notes = [];
      var ratios = [];
      ['SP500', 'NASDAQ'].forEach(function (key) {
        var entry = body && body.byIndex && body.byIndex[key];
        var label = key === 'SP500' ? 'S&P 500' : '나스닥 종합';
        var row = dashboardSection.querySelector('[data-us-ratio="' + key + '"]');
        var valid = entry && entry.status !== 'unavailable' && typeof entry.total === 'number' && entry.total > 0;
        renderHomeBreadthEntry(row, escapeHomeHtml(label), valid ? entry : null, false);
        if (valid) {
          if (entry.missing) notes.push(label + ' 결측 ' + entry.missing + '종목');
          if (entry.status === 'stale') notes.push(label + ' 갱신 지연');
          if (entry.status === 'ok') ratios.push(entry.up / entry.total);
          if (row) row.title = 'TradingView 지수 구성종목 · 지연시세 · 수집 ' + (entry.retrievedAt || '확인 중');
        }
      });
      var meta = dashboardSection.querySelector('[data-us-breadth-meta]');
      if (meta) meta.textContent = 'TradingView · 지연시세(최대 15분) · 2분 캐시' + (notes.length ? ' · ' + notes.join(' · ') : '');
      if (usRegularSessionState().open) {
        // Two index breadth ratios are averaged; overlapping constituents are not presented as a combined stock count.
        if (ratios.length === 2) {
          var indexRates = (latestHomeIndices || []).filter(function (item) { return item.symbol === 'NASDAQ_INDEX' || item.symbol === 'SP500_INDEX'; }).map(function (item) { return Number(item.change_rate); }).filter(isFinite);
          var direction = resolveMarketDirection({components: {riseRatio: {ratio: (ratios[0] + ratios[1]) / 2}, avgChange: {avgChangeRate: indexRates.length ? indexRates.reduce(function (a, b) { return a + b; }, 0) / indexRates.length : 0}}}, indexRates);
          setField('direction', direction.label, direction.tone);
        } else setField('direction', '데이터 확인 중', 'home-neutral');
      }
    }

    function loadHomeUsIndexBreadth() {
      var request = window.NineAPI.usMarketBreadth ? window.NineAPI.usMarketBreadth() : window.NineAPI.data(window.NineAPI.vmUrl + '/us-market-breadth', {timeoutMs: 25000});
      request.then(renderUsIndexBreadth).catch(function () { renderUsIndexBreadth(null); });
    }

    var latestHomeParticipation = {domestic: null, us: null};

    function homeParticipationModel(market, body) {
      var definitions = market === 'us' ? [['SP500', 'S&P 500'], ['NASDAQ', '나스닥 종합']]
        : [['KOSPI', '코스피'], ['KOSDAQ', '코스닥']];
      return definitions.map(function (definition) {
        var entry = body && body.byIndex && body.byIndex[definition[0]];
        var volume = entry && (market === 'domestic' ? entry.turnoverIndex : entry.volumeIndex);
        var valid = entry && entry.status === 'ok' && volume && volume.status === 'ok'
          && volume.basis === 'same-time-5m-volume-sum' && volume.baseline > 0 && volume.eligible > 0
          && typeof volume.index100 === 'number' && isFinite(volume.index100) && volume.index100 >= 0;
        if (market === 'domestic') {
          var participation = entry && entry.volumeParticipation;
          var number = function (value) { return typeof value === 'number' && isFinite(value); };
          var integer = function (value) { return number(value) && Math.floor(value) === value; };
          var sample = participation && integer(participation.total) && participation.total > 0
            && participation.total === entry.total && integer(participation.eligible)
            && participation.eligible > 0 && participation.eligible <= participation.total
            && participation.eligible / participation.total >= .95;
          var collected = entry ? Date.parse(entry.retrievedAt) : NaN;
          var age = (Date.now() - collected) / 1000;
          // Match the server's longest cache TTL; never relabel retrieval as a quote timestamp.
          var clock = new Date(Date.now() + 9 * 3600000);
          var minutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();
          var active = clock.getUTCDay() > 0 && clock.getUTCDay() < 6 && minutes >= 540 && minutes < 940;
          var fresh = isFinite(collected) && age >= -60 && age <= (active ? 300 : 3600);
          var ready = entry && entry.status === 'ok' && fresh && sample
            && participation.status === 'ok' && participation.basis === 'same-time-5m' && participation.lookbackDays === 10
            && number(participation.ratio) && participation.ratio >= 0 && participation.ratio <= 1
            && number(participation.median) && participation.median >= 0
            && integer(participation.increased) && participation.increased >= 0 && participation.increased <= participation.eligible
            && Math.abs(participation.ratio - participation.increased / participation.eligible) < .000001;
          var turnoverStamp = volume ? Date.parse(volume.retrievedAt) : NaN;
          var turnoverAge = (Date.now() - turnoverStamp) / 1000;
          var asOf = volume ? Date.parse(volume.asOf) : NaN;
          var observationAge = (Date.now() - asOf) / 1000;
          valid = volume && volume.status === 'ok' && volume.basis === 'same-time-cumulative-30m'
            && volume.unit === 'KRW' && volume.source === 'KIS' && volume.market === 'KRX'
            && volume.lookbackDays === 5 && volume.sampleDays === 5
            && number(volume.current) && volume.current >= 0 && number(volume.baseline) && volume.baseline > 0
            && number(volume.index100) && volume.index100 >= 0
            && Math.abs(volume.index100 - volume.current / volume.baseline * 100) < .000001
            && isFinite(turnoverStamp) && turnoverAge >= -60 && turnoverAge <= (active ? 300 : 3600)
            && isFinite(asOf) && observationAge >= 0 && (!active || observationAge <= 2100);
          return {label: definition[1], volume: valid ? volume : null, participation: ready ? participation : null,
            entry: entry, status: volume ? ((volume.status === 'stale' || (isFinite(turnoverStamp) && (turnoverAge > (active ? 300 : 3600) || (active && observationAge > 2100)))) ? 'stale' : volume.status) : 'unavailable',
            participationStatus: entry && (entry.status === 'stale' || !fresh ? 'stale' : entry.status)};
        }
        return {label: definition[1], volume: valid ? volume : null, status: entry && entry.status};
      });
    }

    function homeVolumeScale(models) {
      // Equal deviations above/below 100 always have equal heights across both indexes.
      var deviation = models.reduce(function (maximum, model) {
        return model.volume ? Math.max(maximum, Math.abs(Math.round(model.volume.index100 * 10) / 10 - 100)) : maximum;
      }, 0);
      return Math.max(20, Math.ceil(deviation / 10) * 10);
    }

    function renderMarketParticipation() {
      var target = dashboardSection.querySelector('[data-home-participation]');
      if (!target) return;
      var market = homeMarketSession().market === 'us' ? 'us' : 'domestic';
      target.hidden = market === 'us' && !usRegularSessionState().open;
      var models = homeParticipationModel(market, (latestHomeParticipation || {})[market]);
      var scale = homeVolumeScale(models);
      target.innerHTML = models.map(function (model) {
        var volume = model.volume;
        var normalized = volume ? Math.round(volume.index100 * 10) / 10 : null;
        var value = volume ? normalized.toFixed(1).replace(/\.0$/, '') : model.status === 'stale' ? '갱신 지연' : '확인 중';
        var delta = volume ? normalized - 100 : null;
        var tone = delta === null || Math.abs(delta) < .000001 ? 'home-neutral' : delta > 0 ? 'home-positive' : 'home-negative';
        var volumeLabel = market === 'domestic' ? '동시간대 누적 거래대금' : '거래량';
        var label = model.label + ' ' + volumeLabel + ' ' + value + (volume ? ' / 평균 100' : '');
        var tooltip = volume ? (market === 'domestic' ? '최근 5거래일 동시간대 누적 거래대금 평균 100 · 30분 구간 완료 기준 · ' + volume.asOf : '평균 100 · 동일 눈금 ±' + scale + ' · 분석 ' + volume.eligible + '/' + volume.total + '종목') : label;
        return '<div class="hmp-item"><div class="hmp-heading">' + escapeHomeHtml(model.label) + '</div>'
          + '<div class="hmp-column-chart" role="img" aria-label="' + escapeHomeHtml(label) + '" title="' + escapeHomeHtml(tooltip) + '">'
          + '<div class="hmp-column-track"><span class="hmp-baseline-label">100</span><span class="hmp-baseline"></span>'
          + (delta !== null && Math.abs(delta) >= .000001 ? '<i class="hmp-column ' + (delta > 0 ? 'is-up' : 'is-down') + '" style="height:' + (Math.abs(delta) / scale * 50).toFixed(2) + '%"></i>' : '')
          + '</div></div><div class="hmp-volume-value">' + (market === 'domestic' ? '누적<br>거래대금' : '거래량') + '<br><b class="' + tone + '">' + value + '</b>' + (volume ? ' / 100' : '') + '</div></div>';
      }).join('');
      var basis = dashboardSection.querySelector('[data-participation-basis]');
      if (basis) {
        basis.hidden = target.hidden;
        basis.textContent = '거래량: 지수 구성종목 합산 · 동시각 5분봉/최근 10거래일 평균=100 · ' + (market === 'us' ? '15분' : '20분') + ' 지연';
        if (market === 'domestic') basis.innerHTML = renderDomesticParticipation(models);
      }
    }

    function renderDomesticParticipation(models) {
      // Supplementary text stays outside the original chart grid and its 100-based scale.
      var closing = models.some(function (model) { return model.volume && model.volume.sessionClosed; });
      return '<details class="hmp-details"><summary>5일 동시간대 평균 100 · '
        + (closing ? '정규장 마감 기준' : '30분 구간 기준') + ' · 자세히</summary>' + models.map(function (model) {
        var p = model.participation, entry = model.entry;
        var state = model.participationStatus === 'stale' ? '갱신 지연' : '확인 중';
        var percent = p ? (p.ratio * 100).toFixed(1).replace(/\.0$/, '') : null;
        var sample = entry && entry.volumeParticipation;
        var counts = sample && Number.isInteger(sample.eligible) && Number.isInteger(sample.total)
          && sample.eligible >= 0 && sample.eligible <= sample.total ? '유효 ' + sample.eligible + ' / 구성 ' + sample.total + '종목' : '표본 확인 중';
        var delay = entry && typeof entry.delaySeconds === 'number' && isFinite(entry.delaySeconds) && entry.delaySeconds >= 0
          ? (entry.delaySeconds > 0 ? '거래량 공급자 ' + (entry.delaySeconds / 60) + '분 지연' : '거래량 공급자 실시간 모드') : '거래량 공급자 지연 확인 중';
        var stamp = entry ? Date.parse(entry.retrievedAt) : NaN;
        var time = isFinite(stamp) ? new Date(stamp).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul', hour12: false}) + ' KST' : '확인 중';
        var turnover = model.volume;
        var amount = turnover ? (turnover.current / 1000000000000).toLocaleString('ko-KR', {maximumFractionDigits: 2}) + '조원' : model.status === 'stale' ? '갱신 지연' : '확인 중';
        var cutoff = turnover ? new Date(turnover.asOf).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul', hour12: false}) + ' KST' + (turnover.sessionClosed ? ' · 정규장 마감 기준' : '') : '확인 중';
        return '<div data-volume-participation="' + (model.label === '코스피' ? 'KOSPI' : 'KOSDAQ') + '">'
          + escapeHomeHtml(model.label) + ' · 누적 거래대금 ' + escapeHomeHtml(amount) + ' · 기준 ' + escapeHomeHtml(cutoff) + ' (KIS·KRX)'
          + '<br>거래량 증가 종목 ' + (p ? percent + '%' : state)
          + ' · 상대 거래량 중앙값 ' + (p ? p.median.toFixed(2) + '배' : state)
          + '<br>' + (p ? '기준 대비 증가 ' + p.increased + ' / ' + p.eligible + '종목 · ' : '') + escapeHomeHtml(counts)
          + ' · ' + escapeHomeHtml(delay + ' · 수집 ' + time) + '</div>';
      }).join('') + '<div>막대: 최근 5거래일 동시간대 누적 거래대금 평균=100 · 완료된 30분 구간 기준(장중 최대 약 32분 전). '
        + '거래량 보조 수치: TradingView 최근 10일 동시간대 5분봉·종목별 동일 가중·유효 표본 95% 이상. 상승·매수 우위를 뜻하지 않음. 거래량 공급자 실제 관측 시각 미제공.</div></details>';
    }

    function loadDomesticParticipation() {
      var request = window.NineAPI.marketParticipation ? window.NineAPI.marketParticipation('domestic')
        : window.NineAPI.data(window.NineAPI.vmUrl + '/market-participation?market=domestic', {timeoutMs: 25000});
      request.then(function (body) { latestHomeParticipation.domestic = body; renderMarketParticipation(); })
        .catch(function () { latestHomeParticipation.domestic = null; renderMarketParticipation(); });
    }

    function renderMarketSectors(bubble) {
      var summary = sectorSummary(bubble);
      setField('leaders', sectorSummaryText(summary.leaders, '업종 데이터 없음'), 'home-positive');
      setField('cautions', sectorSummaryText(summary.cautions, '업종 데이터 없음'), 'home-negative');
    }

    function homeIndexCard(slot) {
      return dashboardSection.querySelector('[data-home-index-slot="' + slot + '"]');
    }

    // 2026-08-29: 운영 데이터로 전환. /futures 응답의 일봉과 별도 야간 분봉을 쓴다. 레이아웃 작업 때
    // 다시 고정 샘플이 필요하면 이 값을 true로만 바꾸면 된다(아래 기구는 유지).
    var HOME_USE_SAMPLE_CHARTS = false;
    var homeSessionCharts = {}, homePriceMode = 'area', homeSessionLoading = false;
    // 마우스 오버용 점 목록(js/home-chart-hover.js가 읽는다). [x%, y%, 문구] - 문구는 textContent 로만 쓰이지만 속성 이스케이프는 여기서 한다.
    function homeHoverAttr(points) {
      return JSON.stringify(points.map(function (p) { return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, p[2]]; }))
        .replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function homePercentText(value, base) {
      if (!isFinite(value) || !isFinite(base) || !base) return '';
      var pct = (value / base - 1) * 100;
      return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
    }
    function renderHomeSessionChart(element, key, reference) {
      var result = homeSessionCharts[key] || {}, meta = result.session;
      var rows = (result.rows || []).filter(function (r) {
        return r.close != null && isFinite(Number(r.close)) && Number.isInteger(r.slot);
      });
      element.classList.add('has-session-chart');
      element.setAttribute('data-session-symbol', key);
      var controls = '<div class="hmb-price-controls"><span>30분 · '
        + (['KOSPI', 'KOSDAQ', 'KOSPI200_NIGHT'].indexOf(key) >= 0 ? 'KST' : '뉴욕시간') + '</span>'
        + '<button type="button" class="ui-btn ui-btn-text hmb-investor-switch" data-price-switch aria-label="'
        + (homePriceMode === 'bar' ? '면적' : '막대') + ' 차트로 전환">‹</button><span>'
        + (homePriceMode === 'bar' ? '막대' : '면적') + '</span>'
        + '<button type="button" class="ui-btn ui-btn-text hmb-investor-switch" data-price-switch aria-label="'
        + (homePriceMode === 'bar' ? '면적' : '막대') + ' 차트로 전환">›</button></div>';
      if (!meta || !rows.length) {
        element.innerHTML = controls + '<div class="hmb-investor-spark-empty">장중 기록 수집 전</div>';
        return;
      }
      function amount(v) { return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
      function time(ts) { return new Intl.DateTimeFormat('en-GB', { timeZone: meta.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000)); }
      // A quote may belong to a newer session than the saved chart: only a
      // reference carried by that same series can label the baseline "previous".
      reference = result.reference;
      var hasReference = reference != null && isFinite(Number(reference)) && Number(reference) > 0;
      var base = hasReference ? Number(reference) : Number(rows[0].open);
      var high = rows.reduce(function (a, r) { return r.high > a.high ? r : a; }, rows[0]);
      var low = rows.reduce(function (a, r) { return r.low < a.low ? r : a; }, rows[0]);
      var min = Math.min(base, low.low), max = Math.max(base, high.high), range = max - min || 1;
      function x(slot) { return 4 + slot * 92 / (meta.slotCount - 1); }
      function y(v) { return 78 - (v - min) / range * 66; }
      var zero = y(base), marks = '', id = 'home-price-' + key;
      var groups = [];
      rows.forEach(function (r) {
        var group = groups[groups.length - 1];
        if (!group || r.slot !== group[group.length - 1].slot + 1) { group = []; groups.push(group); }
        group.push(r);
      });
      if (homePriceMode === 'area') {
        marks = '<defs><clipPath id="' + id + '-buy"><rect width="100" height="' + zero + '"/></clipPath>'
          + '<clipPath id="' + id + '-sell"><rect y="' + zero + '" width="100" height="' + (90 - zero) + '"/></clipPath></defs>';
        groups.forEach(function (group) {
          if (group.length < 2) return;
          var points = group.map(function (r) { return x(r.slot) + ',' + y(r.close); }).join(' ');
          ['buy', 'sell'].forEach(function (side) {
            marks += '<g class="hmb-investor-' + (hasReference ? side : 'flat') + '" clip-path="url(#' + id + '-' + side + ')"><polygon class="hmb-investor-area" points="'
              + x(group[0].slot) + ',' + zero + ' ' + points + ' ' + x(group[group.length - 1].slot) + ',' + zero
              + '"/><polyline class="hmb-investor-line" vector-effect="non-scaling-stroke" points="' + points + '"/></g>';
          });
        });
      }
      rows.forEach(function (r) {
        var tone = !hasReference ? 'flat' : r.close > base ? 'buy' : r.close < base ? 'sell' : 'flat';
        var title = '<title>' + time(Date.parse(meta.start) / 1000 + r.slot * 1800) + ' 구간 · ' + amount(r.close) + ' · 관측 ' + time(r.ts) + '</title>';
        marks += homePriceMode === 'bar'
          ? '<rect data-price-slot="' + r.slot + '" class="hmb-investor-' + tone + '" x="' + (x(r.slot) - 28 / meta.slotCount) + '" y="' + Math.min(zero, y(r.close)) + '" width="' + 56 / meta.slotCount + '" height="' + Math.max(.6, Math.abs(zero - y(r.close))) + '">' + title + '</rect>'
          : '<circle class="hmb-investor-' + tone + '" cx="' + x(r.slot) + '" cy="' + y(r.close) + '" r=".7">' + title + '</circle>';
      });
      function dot(r, value, name) { return '<span class="hmb-investor-point is-' + name + '" style="left:' + x(r.slot) + '%;top:' + y(value) / 90 * 100 + '%"></span>'; }
      var zoneName = ['KOSPI', 'KOSDAQ', 'KOSPI200_NIGHT'].indexOf(key) >= 0 ? 'KST' : '뉴욕시간';
      var hoverPoints = rows.map(function (r) {
        var change = hasReference ? homePercentText(Number(r.close), base) : '';
        return [x(r.slot), y(Number(r.close)) / 90 * 100,
          time(Date.parse(meta.start) / 1000 + r.slot * 1800) + ' ' + zoneName + ' 구간 · 지수 ' + amount(r.close)
            + (change ? ' (기준 대비 ' + change + ')' : '') + '\n관측 ' + time(r.ts)];
      });
      element.innerHTML = controls + '<div class="hmb-investor-spark-wrap" data-hover-points="' + homeHoverAttr(hoverPoints) + '"><svg class="hmb-investor-spark" viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label="30분 가격 추이, 관측 고점 ' + amount(high.high) + ', 저점 ' + amount(low.low) + '">'
        + '<line class="hmb-investor-zero" x1="1" x2="99" y1="' + zero + '" y2="' + zero + '" vector-effect="non-scaling-stroke"/>' + marks + '</svg>' + dot(high, high.high, 'high') + dot(low, low.low, 'low') + '</div>'
        + '<div class="hmb-investor-axis"><span>' + time(Date.parse(meta.start) / 1000) + '</span><span>' + time(Date.parse(meta.end) / 1000) + '</span></div>'
        + '<div class="hmb-investor-extrema"><span>관측 고점 <b>' + amount(high.high) + '</b></span><span>저점 <b>' + amount(low.low) + '</b></span></div>'
        + '<div class="hmb-investor-asof">' + meta.date + ' · 관측 ' + time(rows[rows.length - 1].ts) + ' · ' + rows.length + '/' + meta.slotCount + '개</div>'
        + '<div class="hmb-investor-asof">' + result.basis + (hasReference ? ' · 전일 종가 ' + amount(base) : ' · 전일 종가 미확인(중립색)') + '</div>';
    }
    dashboardSection.addEventListener('click', function (event) {
      if (!event.target.closest('[data-price-switch]')) return;
      homePriceMode = homePriceMode === 'bar' ? 'area' : 'bar';
      if (latestHomeIndices) renderHomeIndices(latestHomeIndices);
    });
    var homeChartMotion = new WeakMap();
    var homeChartReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function stopHomeChartMotion(element) {
      var state = homeChartMotion.get(element);
      if (state && state.frame) cancelAnimationFrame(state.frame);
    }
    if (document.addEventListener) document.addEventListener('visibilitychange', function () {
      if (document.hidden) dashboardSection.querySelectorAll('.home-index-chart').forEach(function (element) {
        var state = homeChartMotion.get(element);
        if (state && state.finish) state.finish();
      });
    });
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
      if (key === 'kospiNight') return rows;
      if (window.MarketChartHistory) return window.MarketChartHistory.merge(key, rows);
      return rows;
    }

    function nightSessionKey(ts) {
      var kst = new Date(Number(ts) * 1000 + 9 * 3600000);
      if (!isFinite(kst.getTime())) return '';
      var hour = kst.getUTCHours();
      if (hour >= 6 && hour < 18) return '';
      if (hour < 6) kst.setUTCDate(kst.getUTCDate() - 1);
      return kst.toISOString().slice(0, 10);
    }

    function nightSessionRows(rows) {
      var valid = (rows || []).filter(function (row) {
        return row && Number(row.ts) > 0 && row.close != null && isFinite(Number(row.close)) && nightSessionKey(row.ts);
      }).sort(function (a, b) { return Number(a.ts) - Number(b.ts); });
      if (!valid.length) return [];
      var latestKey = nightSessionKey(valid[valid.length - 1].ts);
      return valid.filter(function (row) { return nightSessionKey(row.ts) === latestKey; });
    }

    function nightMinuteLabel(ts) {
      var date = new Date(Number(ts) * 1000 + 9 * 3600000);
      return date.toISOString().slice(0, 16).replace('T', ' ');
    }

    function renderHomeIndexChart(element, rows, key, reference) {
      if (!element) return;
      if (['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'NASDAQ100', 'SP500', 'kospiNight'].indexOf(key) >= 0) {
        stopHomeChartMotion(element);
        var oldCaption = element.nextElementSibling;
        if (oldCaption && oldCaption.classList.contains('home-index-history-caption')) oldCaption.remove();
        renderHomeSessionChart(element, key === 'kospiNight' ? 'KOSPI200_NIGHT' : key, reference);
        return;
      }
      element.classList.remove('has-session-chart');
      var chartRows = homeChartRows(rows, key) || [];
      var monthlyMini = key !== 'kospiNight';
      if (monthlyMini) chartRows = chartRows.filter(function (row) {
        return row && /^\d{8}$/.test(String(row.date || '').replace(/-/g, '')) && isFinite(Number(row.close));
      }).slice(-20);
      else chartRows = nightSessionRows(chartRows);
      var values = chartRows.map(function (row) { return Number(row && row.close); })
        .filter(function (value) { return isFinite(value); });
      var caption = key === 'kospiNight' ? '야간 세션 분봉 없음' : '최근 20거래일 자료 없음';
      if (monthlyMini && chartRows.length) {
        var first = String(chartRows[0].date || '').replace(/-/g, '');
        var last = String(chartRows[chartRows.length - 1].date || '').replace(/-/g, '');
        if (/^\d{8}$/.test(first) && /^\d{8}$/.test(last)) {
          caption = (chartRows.length >= 20 ? '최근 20거래일' : '확보된 ' + chartRows.length + '거래일') + ' · '
            + first.slice(0, 4) + '.' + first.slice(4, 6) + '.' + first.slice(6, 8)
            + ' ~ ' + last.slice(0, 4) + '.' + last.slice(4, 6) + '.' + last.slice(6, 8);
        }
      } else if (chartRows.length) {
        caption = '야간 1회 · ' + nightMinuteLabel(chartRows[0].ts) + ' ~ '
          + nightMinuteLabel(chartRows[chartRows.length - 1].ts) + ' KST · ' + chartRows.length + '개 시세';
      }
      element.setAttribute('data-history-count', String(values.length));
      element.setAttribute('data-history-range', caption);
      var note = element.nextElementSibling;
      if (!note || !note.classList.contains('home-index-history-caption')) {
        note = document.createElement('small'); note.className = 'home-index-history-caption'; element.insertAdjacentElement('afterend', note);
      }
      note.textContent = caption;
      if (values.length < 2) {
        stopHomeChartMotion(element);
        homeChartMotion.delete(element);
        element.innerHTML = '<span class="home-index-chart-empty">추이 데이터 없음</span>';
        return;
      }
      var width = element.clientWidth || 240;
      var height = element.clientHeight || 48;
      var pad = monthlyMini ? 38 : 2;
      var topPad = monthlyMini ? 5 : 2;
      var bottom = monthlyMini ? height - 16 : height - 2;
      var plotHeight = bottom - topPad;
      var lineEnd = width - 26; // 펜촉 끝이 실제 데이터 끝 좌표에 닿도록 우측 공간을 둔다.
      var min = Math.min.apply(Math, values);
      var max = Math.max.apply(Math, values);
      var range = max - min || 1;
      var coords = values.map(function (value, index) {
        var x = pad + index * (lineEnd - pad) / (values.length - 1);
        var y = bottom - ((value - min) / range) * plotHeight;
        return [x, y];
      });
      var points = coords.map(function (point) { return point[0].toFixed(2) + ',' + point[1].toFixed(2); }).join(' ');
      var hasReference = isFinite(Number(reference)) && reference != null;
      var baseline = hasReference ? Number(reference) : key === 'kospiNight'
        ? Number(chartRows[0].open) : values[values.length - 2];
      if (!isFinite(baseline)) baseline = values[0];
      var last = values[values.length - 1];
      var dotColor = key === 'kospiNight' && !hasReference ? 'var(--hmb-chart-line, #b0bbc8)'
        : last > baseline ? 'var(--hmb-chart-up, #e7aaa5)' : last < baseline ? 'var(--hmb-chart-down, #9dbbe0)' : 'var(--hmb-chart-line, #b0bbc8)';
      var lastY = bottom - ((values[values.length - 1] - min) / range) * plotHeight;
      var guideY = bottom - ((baseline - min) / range) * plotHeight;
      guideY = Math.max(topPad, Math.min(bottom, guideY));
      var signature = chartRows.map(function (row) { return (row.ts || row.date || '') + ':' + row.close; }).join('|');
      var old = homeChartMotion.get(element);
      var sameSize = old && old.width === width && old.height === height;
      if (old && sameSize && old.signature === signature && element.querySelector('.home-chart-trace')) {
        var oldDot = element.querySelector('.home-glow-dot');
        if (oldDot) { oldDot.style.borderColor = dotColor; oldDot.style.backgroundColor = dotColor; }
        return;
      }
      var axis = '';
      if (monthlyMini) {
        [max, min].forEach(function (value, index) {
          axis += '<text class="home-chart-axis" x="1" y="' + (index ? bottom : topPad + 6) + '">' + value.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '</text>';
        });
        [0, chartRows.length - 1].forEach(function (index) {
          var date = String(chartRows[index].date).replace(/-/g, '');
          axis += '<text class="home-chart-axis" x="' + (index ? lineEnd : pad) + '" y="' + (height - 2) + '" text-anchor="' + (index ? 'end' : 'start') + '">' + date.slice(4, 6) + '/' + date.slice(6, 8) + '</text>';
        });
      }
      stopHomeChartMotion(element);
      var append = old && sameSize && chartRows.length > old.count && signature.indexOf(old.signature + '|') === 0;
      var reviseLast = old && sameSize && chartRows.length === old.count && old.signature.split('|').slice(0, -1).join('|') === signature.split('|').slice(0, -1).join('|');
      var animate = !homeChartReducedMotion && !document.hidden && typeof requestAnimationFrame === 'function'
        && (!old || append || reviseLast);
      var startIndex = append ? old.count - 1 : reviseLast ? Math.max(0, coords.length - 2) : 0;
      var duration = append || reviseLast ? 420 : 1800;
      var initial = animate ? startIndex : coords.length - 1;
      element.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">'
        + axis
        + '<line x1="' + pad + '" x2="' + lineEnd + '" y1="' + guideY.toFixed(2) + '" y2="' + guideY.toFixed(2) + '" stroke="#cbd0d6" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>'
        + '<polyline class="home-chart-trace" points="' + (animate ? coords[initial][0].toFixed(2) + ',' + coords[initial][1].toFixed(2) : points) + '" fill="none" stroke="var(--hmb-chart-line, #b0bbc8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>'
        + '<g class="home-chart-pen" transform="translate(' + coords[initial][0].toFixed(2) + ' ' + coords[initial][1].toFixed(2) + ')">'
        + '<path d="M0 0 L4 -1.2 L8 -1.2 L8 1.2 L4 1.2 Z" fill="#374151" stroke="#1f2937" stroke-width=".5" vector-effect="non-scaling-stroke"></path>'
        + '<path d="M8 -1.4 L19 -1.4 M8 1.4 L19 1.4 M19 -2.4 L19 2.4" fill="none" stroke="#374151" stroke-width=".9" vector-effect="non-scaling-stroke"></path>'
        + '<path d="M9 0 L17 0" stroke="#9ca3af" stroke-width=".55" vector-effect="non-scaling-stroke"></path></g></svg>'
        + '<span class="home-glow-dot" style="left:' + (lineEnd / width * 100).toFixed(2) + '%;top:' + (lastY / height * 100).toFixed(2) + '%;border-color:' + dotColor + ';background-color:' + dotColor + '" aria-hidden="true"></span>';
      var trace = element.querySelector('.home-chart-trace');
      var pen = element.querySelector('.home-chart-pen');
      var dot = element.querySelector('.home-glow-dot');
      var state = { signature: signature, count: chartRows.length, width: width, height: height, frame: 0, finish: null };
      homeChartMotion.set(element, state);
      function paint(progress) {
        var position = startIndex + progress * (coords.length - 1 - startIndex);
        var index = Math.min(coords.length - 2, Math.floor(position));
        var fraction = Math.min(1, position - index);
        var x = coords[index][0] + (coords[index + 1][0] - coords[index][0]) * fraction;
        var y = coords[index][1] + (coords[index + 1][1] - coords[index][1]) * fraction;
        var visible = coords.slice(0, index + 1).map(function (point) { return point[0].toFixed(2) + ',' + point[1].toFixed(2); });
        visible.push(x.toFixed(2) + ',' + y.toFixed(2));
        trace.setAttribute('points', visible.join(' '));
        pen.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')');
        dot.style.left = (x / width * 100).toFixed(2) + '%';
        dot.style.top = (y / height * 100).toFixed(2) + '%';
      }
      state.finish = function () { if (state.frame) cancelAnimationFrame(state.frame); state.frame = 0; paint(1); };
      if (animate) {
        var began = null;
        function tick(now) {
          if (homeChartMotion.get(element) !== state) return;
          if (began === null) began = now;
          var progress = Math.min(1, (now - began) / duration);
          paint(progress);
          if (progress < 1) state.frame = requestAnimationFrame(tick);
          else state.frame = 0;
        }
        state.frame = requestAnimationFrame(tick);
      } else state.finish();
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
      var selected = window.HomeMarketSelection && window.HomeMarketSelection.get
        ? window.HomeMarketSelection.get() : null;
      if (selected === 'closed') return {
        closed: true,
        market: 'closed',
        title: '휴장',
        live: '주말 · 공휴일',
        subtitle: '시장 휴장 안내',
        keys: [],
        labels: []
      };
      // get()은 항상 값을 돌려주므로(선택값 없으면 MarketHours.homeMarket()) 여기서
      // 시각을 다시 계산하지 않는다 - 경계를 두 곳에서 재는 일이 없어야 한다.
      var isUsSession = selected === 'us';
      var usSession = usIndexSessionState();
      return isUsSession ? {
        market: 'us',
        title: '미국 시장',
        live: usSession.live,
        subtitle: usSession.subtitle,
        statusLabel: usSession.statusLabel,
        keys: usSession.keys,
        labels: usSession.labels
      } : (function () {
        var hours = window.MarketHours;
        var kr = hours && typeof hours.krCash === 'function' ? hours.krCash() : null;
        var label = kr && kr.label ? kr.label : '장 마감';
        var live = label;
        var subtitle = kr && (kr.open || kr.nxtOpen)
          ? '국내 현물 · ' + label
          : '국내 현물 · ' + label;
        return {
          market: 'domestic',
          title: '국내 시장',
          live: live,
          subtitle: subtitle,
          statusLabel: label,
          keys: ['KOSPI', 'KOSDAQ'],
          labels: ['KOSPI', 'KOSDAQ']
        };
      }());
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

    function loadHomeSessionCharts() {
      // These charts and the night-futures panel are only visible in US mode.
      if (homeMarketSession().market !== 'us' || document.hidden) return;
      if (homeSessionLoading) return;
      homeSessionLoading = true;
      fetchHomeJson('https://goodbyestar.cloud/home-session-chart', 12000)
        .then(function (data) {
          (data && data.data || []).forEach(function (item) { homeSessionCharts[item.symbol] = item; });
          if (latestHomeIndices) renderHomeIndices(latestHomeIndices);
        }).catch(function () { /* Keep the last confirmed series on failure. */ })
        .finally(function () { homeSessionLoading = false; });
    }

    function renderHomeIndices(items) {
      var session = homeMarketSession();
      applyHomeMarketSession(session);
      var bySymbol = {};
      (items || []).forEach(function (item) { if (item && item.symbol) bySymbol[item.symbol] = item; });
      latestHomeIndices = items || [];
      renderMarketParticipation();
      if (session.market === 'domestic') renderDomesticDirection(homeDomesticMarketTemp);
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
        // 야간 차트에는 별도로 받은 실제 분봉만 사용한다. 마지막 세션은 장 종료 후에도
        // 남기고, 다음 18:00 세션의 첫 분봉이 도착하면 그때 새 세션으로 교체한다.
        if (nightChartEl) {
          nightChartEl.hidden = false;
          renderHomeIndexChart(nightChartEl, [], 'kospiNight', isFinite(nPrice) && isFinite(nChange) ? nPrice - nChange : null);
        }
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
        renderHomeIndexChart(chartEl, item && item.chart, key, item && item.price != null && item.change != null ? Number(item.price) - Number(item.change) : null);
      });
    }

    var homeChartResizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(homeChartResizeTimer);
      homeChartResizeTimer = setTimeout(function () {
        if (latestHomeIndices && latestHomeIndices.length) renderHomeIndices(latestHomeIndices);
      }, 120);
    });

    var homeHistoryJobs = {};
    function loadHomeHistory(session) {
      var group = session.market === 'us' ? 'global' : 'domestic';
      if (homeHistoryJobs[group]) return;
      homeHistoryJobs[group] = loadHomeScript('https://goodbyestarwars.github.io/tistory-ticker/js/market-history.js?v=20261008-home-5y', 'MarketChartHistory')
        .then(function (history) { return history.load(group); })
        .then(function () { if (latestHomeIndices) renderHomeIndices(latestHomeIndices); })
        .catch(function () { /* 이력 로딩 실패 시 기존 최근 자료로 시세 화면을 유지한다. */ });
    }
    function loadHomeIndices() {
      var session = homeMarketSession();
      loadHomeHistory(session);
      applyHomeMarketSession(session);
      if (session.closed) return;
      var request = window.QuickIndices && typeof window.QuickIndices.fetchFutures === 'function'
        ? window.QuickIndices.fetchFutures()
        : fetchHomeJson('https://goodbyestar.cloud/futures?symbols=KOSPI%2CKOSDAQ%2CNASDAQ_INDEX%2CSP500_INDEX%2CNASDAQ100%2CSP500%2CKOSPI200_NIGHT&stored_only=true', 12000)
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
    loadHomeSessionCharts();
    loadHomeIndexBreadth();
    setInterval(function () {
      if (document.hidden) return;
      loadHomeIndices();
      loadHomeSessionCharts();
      loadHomeIndexBreadth();
    }, 60 * 1000);


    // 관심종목 공시 레일은 경제 뉴스 패널의 맨 위에 표시한다.
    var homeMarketBoard = dashboardSection.querySelector('#homeMarketBoard');
    var homeDisclosureSection = homeMarketBoard && homeMarketBoard.querySelector('[data-home-disclosure-section]');
    var homeDisclosureSlot = dashboardSection.querySelector('[data-home-disclosure-slot]');
    if (homeDisclosureSection && homeDisclosureSlot) homeDisclosureSlot.appendChild(homeDisclosureSection);
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

    // 환율을 포함한 시장 온도는 현재값이 핵심이다. 예전 캐시를 먼저 그리면
    // 제공처가 바뀌거나 서버가 복구된 뒤에도 오래된 환율이 화면에 남을 수 있다.
    // 키를 올려 기존 값을 폐기하고, 최신 응답을 받은 뒤에만 정상값을 그린다.
    var marketTempCacheKey = 'home_market_temp_vm_v3';
    var marketSectorCacheKey = 'home_market_sectors_v1';
    var cachedMarketTemp = readHomeDataCache(marketTempCacheKey, 2 * 60 * 1000);
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

    // Use the same VM score100/components as the market page. The GAS temperature
    // model has different inputs and must not silently replace this score.
    fetchHomeJson(MARKET_TEMP_VM_URL, 12000)
      .then(function (body) { return body && body.data ? body.data : body; })
      .then(function (market) {
        if (!market || typeof market.score100 !== 'number' || !isFinite(market.score100)) throw new Error('market score unavailable');
        writeHomeDataCache(marketTempCacheKey, market);
        if (homeMarketSession().market === 'us') renderMarketExchange(market);
        else renderMarketTemperature(market);
      })
      .catch(function () {
        // 네트워크가 실패한 경우에만 2분 이내의 캐시를 비상 표시로 사용한다.
        // 정상 경로에서는 반드시 이번 요청의 최신 응답을 먼저 그린다.
        if (cachedMarketTemp) {
          if (homeMarketSession().market === 'us') renderMarketExchange(cachedMarketTemp);
          else renderMarketTemperature(cachedMarketTemp);
        } else if (homeMarketSession().market !== 'us') {
          if (!homeVmScoreText) setField('temperature', '일시 지연', 'home-neutral');
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
      loadHomeUsIndexBreadth();
      (window.HomeMarketBoard
        ? window.HomeMarketBoard.fetch('us')
        : fetchHomeJson('https://goodbyestar.cloud/market-board?market=us&limit=40', 12000))
        .then(renderUsMarketSummary)
        .catch(function () {
          setField('temperature', '데이터 확인 중', 'home-neutral');
          setField('leaders', '데이터 확인 중', 'home-neutral');
          setField('cautions', '데이터 확인 중', 'home-neutral');
        });
    };

    loadHomeDomesticSummary = function () {
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
      if (value == null || value === '') return '-';
      var n = Number(value);
      if (!isFinite(n)) return '-';
      if (n === 0) return '0억';
      var sign = n < 0 ? '-' : '+';
      var abs = Math.abs(n);
      if (abs >= 10000) return sign + (abs / 10000).toFixed(1).replace(/\.0$/, '') + '조';
      return sign + Math.round(abs).toLocaleString('ko-KR') + '억';
    }

    var homeInvestorMode = 'area';  // 2026-10-16 사용자 요청: 면적/막대 전환 지표의 기본값은 면적
    var homeInvestorResults = null;
    var homeInvestorLoading = false;

    function investorTimeText(value) {
      var date = new Date(value);
      return value && isFinite(date.getTime()) ? date.toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
      }) : '-';
    }

    function investorSparkline(result, mode, marketKey) {
      // Retain real slot positions: never compress gaps or invent missing bars.
      var rows = (result.rows || []).filter(function (r) {
        return Number.isInteger(r.slot) && r.slot >= 0 && r.slot < 14
          && r.frgn != null && isFinite(Number(r.frgn));
      }).slice().sort(function (a, b) { return a.slot - b.slot; });
      if (!rows.length) return '<div class="hmb-investor-spark-empty">장중 기록 수집 전</div>';
      var high = result.extrema && result.extrema.high;
      var low = result.extrema && result.extrema.low;
      if (!high || high.value == null || !isFinite(Number(high.value))) high = rows.reduce(function (a, r) { return r.frgn > a.value ? { slot: r.slot, value: Number(r.frgn) } : a; }, { slot: rows[0].slot, value: Number(rows[0].frgn) });
      if (!low || low.value == null || !isFinite(Number(low.value))) low = rows.reduce(function (a, r) { return r.frgn < a.value ? { slot: r.slot, value: Number(r.frgn) } : a; }, { slot: rows[0].slot, value: Number(rows[0].frgn) });
      var nums = rows.map(function (r) { return Number(r.frgn); }).concat([Number(high.value), Number(low.value), 0]);
      var min = Math.min.apply(Math, nums), max = Math.max.apply(Math, nums);
      if (min === max) { min -= 1; max += 1; }
      function y(value) { return 78 - (value - min) / (max - min) * 66; }
      function x(slot) { return 4 + slot * 92 / 13; }
      var zero = y(0), marks = '';
      var prefix = 'home-investor-' + marketKey;
      if (mode === 'area') {
        var groups = [];
        rows.forEach(function (r) {
          var group = groups[groups.length - 1];
          if (!group || r.slot !== group[group.length - 1].slot + 1) { group = []; groups.push(group); }
          group.push(r);
        });
        marks = '<defs><clipPath id="' + prefix + '-buy"><rect x="0" y="0" width="100" height="' + zero + '"/></clipPath>'
          + '<clipPath id="' + prefix + '-sell"><rect x="0" y="' + zero + '" width="100" height="' + (90 - zero) + '"/></clipPath></defs>';
        groups.forEach(function (group) {
          var points = group.map(function (r) { return x(r.slot).toFixed(2) + ',' + y(Number(r.frgn)).toFixed(2); }).join(' ');
          if (group.length > 1) {
            var area = x(group[0].slot) + ',' + zero + ' ' + points + ' ' + x(group[group.length - 1].slot) + ',' + zero;
            ['buy', 'sell'].forEach(function (side) {
              marks += '<g clip-path="url(#' + prefix + '-' + side + ')" class="hmb-investor-' + side + '">'
                + '<polygon points="' + area + '" class="hmb-investor-area"/>'
                + '<polyline points="' + points + '" class="hmb-investor-line" vector-effect="non-scaling-stroke"/></g>';
            });
          }
        });
      }
      rows.forEach(function (r) {
        var value = Number(r.frgn), side = value > 0 ? 'buy' : value < 0 ? 'sell' : 'flat';
        var minute = 540 + r.slot * 30;
        var label = Math.floor(minute / 60) + ':' + String(minute % 60).padStart(2, '0');
        var title = '<title>' + label + ' 구간 · 누적 ' + investorAmountText(value) + ' · 수집 ' + investorTimeText(r.asOf) + '</title>';
        if (mode === 'area') {
          marks += '<circle cx="' + x(r.slot) + '" cy="' + y(value) + '" r=".8" class="hmb-investor-' + side + '">' + title + '</circle>';
        } else {
          marks += '<rect data-investor-slot="' + r.slot + '" x="' + (x(r.slot) - 2.3) + '" y="' + (value === 0 ? zero - .3 : Math.min(zero, y(value))) + '" width="4.6" height="' + Math.max(.6, Math.abs(y(value) - zero)) + '" rx=".4" class="hmb-investor-' + side + '">' + title + '</rect>';
        }
      });
      function point(extreme, name) {
        return '<span class="hmb-investor-point is-' + name + '" style="left:' + x(extreme.slot).toFixed(2) + '%;top:' + (y(extreme.value) / 90 * 100).toFixed(2) + '%" aria-hidden="true"></span>';
      }
      var investorHover = rows.map(function (r) {
        var minute = 540 + r.slot * 30;
        return [x(r.slot), y(Number(r.frgn)) / 90 * 100,
          Math.floor(minute / 60) + ':' + String(minute % 60).padStart(2, '0') + ' KST 구간 · 외국인 누적 ' + investorAmountText(Number(r.frgn))
            + '\n수집 ' + investorTimeText(r.asOf)];
      });
      return '<div class="hmb-investor-spark-wrap" data-hover-points="' + homeHoverAttr(investorHover) + '"><svg class="hmb-investor-spark" viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label="30분 구간별 누적 외국인 순매수, 확보 ' + rows.length + '개, 관측 고점 ' + investorAmountText(high.value) + ', 저점 ' + investorAmountText(low.value) + '">'
        + '<line x1="1" y1="' + zero + '" x2="99" y2="' + zero + '" class="hmb-investor-zero" vector-effect="non-scaling-stroke"/>'
        + marks + '</svg>' + point(high, 'high') + (high.value !== low.value ? point(low, 'low') : '') + '</div>'
        + '<div class="hmb-investor-axis"><span>09:00</span><span>12:00</span><span>15:30</span></div>'
        + '<div class="hmb-investor-extrema"><span>고점 <b>' + investorAmountText(high.value) + '</b></span><span>저점 <b>' + investorAmountText(low.value) + '</b></span></div>';
    }

    function renderHomeInvestorTrend(results) {
      homeInvestorResults = results;
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
        var latest = result.latest;
        var tone = latest > 0 ? 'home-positive' : latest < 0 ? 'home-negative' : 'home-neutral';
        return '<div class="hmb-investor-row">'
          + '<div class="hmb-investor-row-top"><strong>' + market.label + '</strong><b class="' + tone + '">' + investorAmountText(latest) + '</b></div>'
          + investorSparkline(result, homeInvestorMode, market.key)
          + '<div class="hmb-investor-asof">' + String(result.date || '').replace(/[^0-9-]/g, '') + ' · '
          + (rows.length ? '관측 ' + investorTimeText(result.asOf) + ' · ' + rows.length + '/14개' : '일별 최근값 · 장중 기록 없음') + '</div>'
          + '</div>';
      }).join('');
      body.innerHTML = html || '<span class="hmb-investor-loading">데이터 확인 중</span>';
    }

    var investorHost = dashboardSection.querySelector('[data-home-investor-trend]');
    if (investorHost) investorHost.addEventListener('click', function (event) {
      if (!event.target.closest('[data-investor-switch]')) return;
      homeInvestorMode = homeInvestorMode === 'bar' ? 'area' : 'bar';
      var name = investorHost.querySelector('[data-investor-mode]');
      if (name) name.textContent = homeInvestorMode === 'bar' ? '막대' : '면적';
      investorHost.querySelectorAll('[data-investor-switch]').forEach(function (button) {
        button.setAttribute('aria-label', (homeInvestorMode === 'bar' ? '면적' : '막대') + ' 차트로 전환');
      });
      if (homeInvestorResults) renderHomeInvestorTrend(homeInvestorResults);
    });

    loadHomeInvestorTrend = function () {
      var host = dashboardSection.querySelector('[data-home-investor-trend]');
      if (!host || host.hidden || homeInvestorLoading) return;
      homeInvestorLoading = true;
      var body = host.querySelector('.hmb-investor-trend-body');
      if (body && !body.querySelector('.hmb-investor-row')) body.innerHTML = '<span class="hmb-investor-loading">데이터 확인 중</span>';
      Promise.all([
        fetchHomeJson('https://goodbyestar.cloud/investor-trend?period=intraday&market=kospi', 12000),
        fetchHomeJson('https://goodbyestar.cloud/investor-trend?period=intraday&market=kosdaq', 12000)
      ]).then(renderHomeInvestorTrend).catch(function () {
        if (body && !homeInvestorResults) body.innerHTML = '<span class="hmb-investor-loading">데이터 확인 중</span>';
        else if (body) body.querySelectorAll('.hmb-investor-asof').forEach(function (el) {
          if (el.textContent.indexOf('갱신 지연') < 0) el.textContent += ' · 갱신 지연';
        });
      }).then(function () { homeInvestorLoading = false; });
    };

    loadSummaryForSession(homeMarketSession());
    window.addEventListener('home-market-change', function () {
      // 탭 상태만 바꾸면 직전 시장의 지수 카드가 화면에 남는다. 시장을
      // 전환하는 순간 카드의 라벨·값·차트를 함께 초기화하고 다시 조회한다.
      loadHomeIndices();
      loadHomeSessionCharts();
      loadHomeIndexBreadth();
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
          loadHomeIndexBreadth();
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

    /* 최신 브리핑 8건: 제목 위, 큰 흰색 카드를 좌우로 넘기는 캐러셀. */
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
      briefing.innerHTML = '<div class="home-section-heading briefing-intro"><div><span class="learn-eyebrow">시장을 읽는 투자 노트</span><strong><svg class="briefing-title-icon" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2 6h4" /> <path d="M2 10h4" /> <path d="M2 14h4" /> <path d="M2 18h4" /> <rect width="16" height="20" x="4" y="2" rx="2" /> <path d="M9.5 8h5" /> <path d="M9.5 12H16" /> <path d="M9.5 16H14" /> </svg> 마켓브리핑</strong>'
        + '<p>주가를 움직인 사건과 흐름, 핵심 해석을 살펴보세요.</p></div>'
        + '<a class="home-briefing-more" href="/category/마켓 브리핑"><svg class="briefing-archive-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg><span>브리핑 아카이브</span> <i aria-hidden="true">↗</i></a></div>'
        + '<div class="home-briefing-grid briefing-carousel-track" tabindex="0" role="region" aria-label="마켓브리핑 카드"></div>'
        + '<div class="briefing-carousel-controls"><input class="briefing-carousel-progress" type="range" min="0" max="1000" value="0" aria-label="브리핑 카드 이동 위치">'
        + '<div><button type="button" data-briefing-prev aria-label="이전 브리핑">←</button><button type="button" data-briefing-next aria-label="다음 브리핑">→</button></div></div>';
      feed.appendChild(briefing);
      selectedCards.forEach(function (card, index) {
        card.classList.add('home-briefing-card');
        card.setAttribute('data-briefing-number', String(index + 1).padStart(2, '0'));
        briefing.querySelector('.briefing-carousel-track').appendChild(card);
      });
      initBriefingCarousel(briefing);
    } else {
      briefing = document.createElement('section');
      briefing.className = 'home-briefing-section';
      briefing.innerHTML = '<div class="home-section-heading"><div><strong><svg class="briefing-title-icon" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M2 6h4" /> <path d="M2 10h4" /> <path d="M2 14h4" /> <path d="M2 18h4" /> <rect width="16" height="20" x="4" y="2" rx="2" /> <path d="M9.5 8h5" /> <path d="M9.5 12H16" /> <path d="M9.5 16H14" /> </svg> 마켓브리핑</strong>'
        + '<span>투자 판단에 필요한 핵심 해석</span></div></div>'
        + '<div class="home-card-state">최신 마켓브리핑을 확인하는 중입니다.</div>'
        + '<a class="home-briefing-more" href="/category/마켓 브리핑"><span>브리핑 아카이브</span><strong>마켓 브리핑</strong><i aria-hidden="true">→</i></a>';
      feed.appendChild(briefing);
    }

    var pagination = feed.querySelector(':scope > .pagination');
    if (pagination) pagination.remove();

    // 2026-10-18 사용자 요청("휴장에는 마켓브리핑이 없는데 추가"): 마켓 브리핑 섹션은 위젯 모듈이 .home-widget-grid 안으로 옮기는데,
    // 휴장 화면은 그 그리드를 통째로 숨겨서 브리핑도 같이 사라졌다. 휴장(dashboardSection.is-market-closed)이면 주간 리포트 바로 아래로
    // 꺼내 보이고, 장이 열리면 원래 자리(표시해 둔 주석 노드 앞)로 되돌린다. 탭 전환으로 클래스가 바뀔 때마다 다시 맞춘다.
    function syncBriefingPlacement() {
      var section = feed.querySelector('.home-briefing-section') || document.querySelector('.home-briefing-section');
      if (!section) return;
      var closed = dashboardSection.classList.contains('is-market-closed');
      var report = document.getElementById('homeWeeklyReport');
      var weekly = window.HomeWeeklyReport;
      if (report && weekly && weekly.syncContent) { weekly.syncContent(report, closed); return; }
      if (closed) {
        if (!report || !report.parentNode) return;
        if (!section.__homeSlot) {
          section.__homeSlot = document.createComment('home-briefing-slot');
          section.parentNode.insertBefore(section.__homeSlot, section);
        }
        if (report.nextSibling !== section) report.parentNode.insertBefore(section, report.nextSibling);
        section.hidden = false;
      } else if (section.__homeSlot && section.__homeSlot.parentNode) {
        section.__homeSlot.parentNode.insertBefore(section, section.__homeSlot);
        section.__homeSlot.remove();
        section.__homeSlot = null;
      }
    }
    if (window.MutationObserver) new MutationObserver(syncBriefingPlacement).observe(dashboardSection, { attributes: true, attributeFilter: ['class'] });

    // 네 모듈은 서로의 코드에 의존하지 않는다. 기존 직렬 로딩을 병렬로
    // 바꿔 첫 화면에서 네트워크 왕복 한 번 이상을 줄인다.
    Promise.all([
      loadHomeScript(HOME_WEEKLY_REPORT_SCRIPT_URL, 'HomeWeeklyReport').catch(function () { return null; }),
      loadHomeScript(HOME_WIDGETS_SCRIPT_URL, 'HomeDashboardWidgets').catch(function () { return null; }),
      loadHomeScript(HOME_REALTIME_TABLE_SCRIPT_URL, 'HomeRealtimeTable').catch(function () { return null; }),
      loadHomeScript(HOME_ECONOMIC_NEWS_SCRIPT_URL, 'HomeEconomicNews').catch(function () { return null; }),
      loadHomeScript(HOME_CHART_HOVER_SCRIPT_URL, 'HomeChartHover').catch(function () { return null; })
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
        syncBriefingPlacement();
        setTimeout(syncBriefingPlacement, 1500);
      })
      .catch(function () {
        /* 위젯 관리 모듈이 막혀도 기존 고정형 대시보드는 그대로 사용할 수 있게 둔다. */
      });
    // Publish the complete synchronous layout; do not wait for API or optional widgets.
    document.documentElement.classList.remove('home-render-pending');
  })();

  /* ── 카테고리 글목록: 신문 지면형 고정 편집(2026-08-26) ──
     일반 카테고리는 대표 1개 + 헤드라인 최대 4개 뒤에 작은 카드·2열을 반복한다. 다만
     마켓브리핑은 같은 크기의 가로 카드 선반으로 표시한다.
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
    var isMarketBriefing = decodeURIComponent(location.pathname) === '/category/마켓 브리핑';
    if (!cards.length || (cards.length < 2 && !isMarketBriefing)) return;

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

    // 마켓브리핑은 일반 카테고리의 hero/cards/duo 편집과 분리한다.
    if (isMarketBriefing) {
      // Equal-size editorial cards on an Apple-style horizontal shelf. Keep the
      // original articles, links, dates and order; reuse the shared carousel.
      var shelf = document.createElement('section');
      shelf.className = 'briefing-shelf';
      shelf.innerHTML = '<div class="briefing-shelf-track" tabindex="0" role="region" aria-label="마켓브리핑 카드"></div>'
        + '<button type="button" class="briefing-shelf-arrow briefing-shelf-prev" data-briefing-shelf-prev aria-label="이전 마켓브리핑">‹</button>'
        + '<button type="button" class="briefing-shelf-arrow briefing-shelf-next" data-briefing-shelf-next aria-label="다음 마켓브리핑">›</button>'
        + '<p class="briefing-shelf-empty" hidden>검색 결과가 없습니다.</p>';
      feed.insertBefore(shelf, cards[0]);
      var shelfTrack = shelf.querySelector('.briefing-shelf-track');
      cards.forEach(function (card) {
        card.classList.add('feed-briefing-cards-item');
        shelfTrack.appendChild(card);
      });
      (window.SiteInteractionsReady || Promise.resolve(window.SiteInteractions)).then(function (module) {
        if (module) module.carousel(shelf, {
          track: '.briefing-shelf-track', previous: '[data-briefing-shelf-prev]',
          next: '[data-briefing-shelf-next]', card: '.feed-briefing-cards-item'
        });
      }).catch(function () {});
      var search = document.createElement('label');
      search.className = 'briefing-search';
      search.innerHTML = '<input type="search" aria-label="마켓브리핑 제목·내용 검색" placeholder="마켓브리핑 제목·내용 검색" autocomplete="off"><small data-briefing-search-result>전체 ' + cards.length + '건</small>';
      feed.insertBefore(search, shelf);
      var input = search.querySelector('input');
      var result = search.querySelector('[data-briefing-search-result]');
      input.addEventListener('input', function () {
        var query = input.value.trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (card) {
          var match = !query || card.textContent.toLowerCase().indexOf(query) !== -1;
          card.hidden = !match;
          if (match) shown += 1;
        });
        shelf.querySelector('.briefing-shelf-empty').hidden = shown !== 0;
        result.textContent = query ? shown + '건 검색됨' : '전체 ' + cards.length + '건';
      });
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

  /* 2026-09-15 작업지시서: 메인페이지 "국내 시장" 카드 헤더의 VI·사이드카 배지.
     서버 한 곳이 20초마다 조회해 둔 캐시(/api/circuit-breaker)만 읽는다 - 브라우저가 증권사 API를
     직접 부르지 않는다. 사이드카(지수 전체)와 VI(개별종목)는 위계가 달라 배지 두 개로 나누고,
     발동이 없으면 둘 다 숨긴다. 사이드카는 확인된 데이터 출처가 생기기 전까지 서버가 available=false로
     보내 배지가 뜨지 않는다. */
  (function homeCircuitBreakerBadges() {
    var CB_API = 'https://goodbyestar.cloud/api/circuit-breaker';
    var CB_POLL_MS = 20000;
    var lastData = null;
    var panel = null;                 // null | 'halt' | 'vi'
    var viView = { mode: 'active', market: 'ALL', kind: 'ALL' };

    function q(selector) {
      var board = document.getElementById('homeMarketBoard');
      return board ? board.querySelector(selector) : null;
    }
    function hhmm(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    }
    function hhmmss(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function isDomesticCard() {
      var selection = window.HomeMarketSelection;
      return !!selection && typeof selection.get === 'function' && selection.get() === 'domestic';
    }

    // 시장 전체 사이드카(주황)·서킷브레이커(빨강). 발동 중이 가장 위, 그 아래 당일 해제·거래재개 이력. 같은 id는 한 번만 그린다.
    var MARKET_LABEL = { KOSPI: '코스피', KOSDAQ: '코스닥' };
    var haltOpen = null;
    function haltTitle(e) {
      var side = e.direction === 'SELL' ? '매도 사이드카' : e.direction === 'BUY' ? '매수 사이드카' : '사이드카';
      return (MARKET_LABEL[e.market] || e.market) + ' ' + (e.kind === 'CIRCUIT_BREAKER' ? '서킷브레이커' + (e.stage ? ' ' + e.stage + '단계' : '') : side);
    }
    function haltRow(e) {
      var cls = e.kind === 'CIRCUIT_BREAKER' ? 'is-cb' : 'is-sidecar';
      var state = e.status === 'active' ? '발동 중' : (e.status === 'resumed' ? '거래 재개 ' + hhmm(e.resumed_at || e.released_at)
        : '해제 ' + hhmm(e.released_at || e.resumed_at) + (e.basis === 'DURATION_ELAPSED' ? ' (지속시간 경과)' : ''));
      var pct = typeof e.change_pct === 'number' ? ' · ' + (e.kind === 'CIRCUIT_BREAKER' ? '지수 ' : '선물 ') + (e.change_pct > 0 ? '+' : '') + e.change_pct.toFixed(2) + '%' : '';
      return '<li class="' + cls + (e.status === 'active' ? ' is-active' : ' is-ended') + '"><b>' + esc(haltTitle(e)) + '</b>'
        + '<span>발동 ' + esc(hhmm(e.triggered_at)) + esc(pct) + '</span><em>' + esc(state) + '</em></li>';
    }
    // 출처와 '실시간이 아님'을 항상 밝힌다. 링크는 한국거래소 KIND 주소만 허용한다.
    function haltSource(halt) {
      var url = /^https:\/\/kind\.krx\.co\.kr\//.test(String(halt.source_url || '')) ? halt.source_url : '';
      var label = esc(halt.source || '한국거래소 공시');
      return '<small class="home-halt-src">출처 ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label)
        + ' · ' + esc(halt.delay_note || '공시 기준 · 실시간 데이터가 아닙니다')
        + (halt.received_at ? ' · 확인 ' + esc(hhmm(halt.received_at)) : '') + '</small>';
    }
    function renderHalt(el, halt) {
      if (!el) return;
      if (!halt) { el.hidden = true; return; }
      if (!halt.available) {
        // 수신 경로가 없거나 끊김: 정상으로 보이게 두지 않고 '확인 불가'를 낮은 강조로 표시한다(경고색 배너가 아님).
        el.className = 'home-halt is-unknown';
        el.innerHTML = '<span>사이드카·서킷브레이커 자동 확인 불가</span><small>'
          + esc(halt.reason === 'FETCH_FAILED' ? '수신 실패(한국거래소 접속 오류) · 정상이라는 뜻이 아님 · 한국거래소 공지 확인'
            : halt.reason === 'STALE' ? '수신 지연 중 · 정상이라는 뜻이 아님 · 한국거래소 공지 확인' : '수신 경로 미연결 · 정상 여부를 알 수 없음 · 한국거래소 공지 확인') + '</small>';
        el.hidden = false;
        return;
      }
      var seen = {};
      var events = (halt.events || []).filter(function (e) { if (!e || seen[e.id]) return false; seen[e.id] = true; return true; });
      if (!events.length) { el.hidden = true; return; }                       // 이벤트가 없으면 배너를 두지 않는다
      var byNewest = function (a, b) { return String(b.triggered_at).localeCompare(String(a.triggered_at)); };
      var active = events.filter(function (e) { return e.status === 'active'; }).sort(byNewest);
      var ended = events.filter(function (e) { return e.status !== 'active'; }).sort(byNewest);
      var anyCb = active.some(function (e) { return e.kind === 'CIRCUIT_BREAKER'; });
      el.className = 'home-halt ' + (active.length ? (anyCb ? 'is-cb-active' : 'is-sidecar-active') : 'is-history');
      // 압축 한 줄(눌러서 펼침). 발동 중이면 기본 펼침, 해제 이력만 있으면 기본 접힘 - 사용자가 누른 뒤에는 그 선택을 유지한다.
      var open = haltOpen === null ? active.length > 0 : haltOpen;
      var summary = active.length
        ? (anyCb ? '서킷브레이커' : '사이드카') + ' 발동 중 ' + active.length + '건 · 누르면 상세'
        : '오늘 시장 조치 ' + events.length + '건 · 모두 해제';
      el.innerHTML = '<button type="button" class="home-halt-sum" aria-expanded="' + (open ? 'true' : 'false') + '">' + esc(summary) + '<i aria-hidden="true">' + (open ? '▴' : '▾') + '</i></button>'
        + '<div class="home-halt-body"' + (open ? '' : ' hidden') + '>'
        + (active.length ? '<strong>' + (anyCb ? '서킷브레이커' : '사이드카') + ' 발동 중</strong>' : '<strong>오늘 시장 조치 이력</strong>')
        + '<ul>' + active.map(haltRow).join('') + '</ul>'
        + (ended.length ? (active.length ? '<h4>오늘 해제·거래재개 이력</h4>' : '') + '<ul class="is-history-list">' + ended.map(haltRow).join('') + '</ul>' : '')
        + haltSource(halt) + '</div>';
      el.hidden = false;
    }

    // ---- 시장 변동성 모니터(CB · 사이드카 · VI) ----
    var KIND_TEXT = { STATIC: '정적', DYNAMIC: '동적', BOTH: '정적·동적' };
    function fmtNum(v) { return typeof v === 'number' && isFinite(v) && v !== 0 ? v.toLocaleString('ko-KR') : '-'; }
    function fmtPct(v) { return typeof v === 'number' && isFinite(v) && v !== 0 ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '-'; }

    // 지금 발동 중인 CB·사이드카만 경고 카드로 올린다(해제되면 상단에서 빠지고 이력은 눌러서 여는 상세에만 남는다).
    function activeHalts(halt) {
      if (!halt || !halt.available) return [];
      return (halt.events || []).filter(function (e) { return e.status === 'active' && (e.kind === 'CIRCUIT_BREAKER' || e.kind === 'SIDECAR'); })
        .sort(function (x, y) { return (x.kind === y.kind ? 0 : x.kind === 'CIRCUIT_BREAKER' ? -1 : 1) || String(y.triggered_at).localeCompare(String(x.triggered_at)); });
    }
    function haltCardHtml(e, open) {
      var isCb = e.kind === 'CIRCUIT_BREAKER';
      var detail = [MARKET_LABEL[e.market] || e.market, isCb ? (e.stage ? e.stage + '단계' : '') : (e.direction === 'SELL' ? '매도' : e.direction === 'BUY' ? '매수' : '')]
        .filter(function (t) { return t; }).join(' · ');
      return '<button type="button" class="vol-alert ' + (isCb ? 'is-cb' : 'is-side') + '" data-vol-open="halt" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="volPanel">'
        + '<strong>' + (isCb ? '서킷브레이커' : '사이드카') + '</strong>'
        + '<b class="vol-state">' + esc((detail ? detail + ' ' : '') + '발동') + '</b>'
        + '<span>' + esc(hhmm(e.triggered_at)) + ' 발동</span></button>';
    }
    // VI 카드용 요약: 발동 중이 1건 이상일 때만 값이 있고, 전체 현황을 못 받는 중이면 null(카드를 그리지 않는다).
    function viLine(data) {
      if (data.vi_available === false || data.vi_active_count == null) return null;
      var act = (data.vi_today || []).filter(function (r) { return r.status === 'active'; });
      if (!act.length) return null;
      var last = act[0];
      return { count: act.length, time: hhmm(last.triggered_at), market: MARKET_LABEL[last.market] || '', name: last.name };
    }
    function viCardHtml(v, open) {
      return '<button type="button" class="vol-alert is-vi" data-vol-open="vi" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="volPanel">'
        + '<strong>변동성완화장치 VI ' + v.count + '건 발동중</strong></button>';
    }
    function haltHistoryCount(halt) {
      return halt && halt.available ? (halt.events || []).length : 0;
    }

    function viRows(data) {
      var rows = (data.vi_today || []).filter(function (r) {
        if (viView.mode === 'active' && r.status !== 'active') return false;
        if (viView.market !== 'ALL' && r.market !== viView.market) return false;
        if (viView.kind !== 'ALL' && r.kind !== viView.kind) return false;
        return true;
      });
      return rows;   // 서버가 이미 발동 중 우선, 최근 발동 순으로 정렬해 보낸다
    }
    function seg(group, items) {
      return '<span class="vol-seg" role="group">' + items.map(function (it) {
        var on = viView[group] === it[0];
        return '<button type="button" class="vol-seg-btn' + (on ? ' is-on' : '') + '" data-vol-set="' + group + ':' + it[0] + '" aria-pressed="' + on + '">' + esc(it[1]) + '</button>';
      }).join('') + '</span>';
    }
    function viPanelHtml(data) {
      if (data.vi_available === false) {
        return '<p class="vol-note">VI 전체 현황을 받지 못하고 있습니다. 정상이라는 뜻이 아니며 지금 발동 중인 종목 수를 알 수 없습니다.</p>';
      }
      var rows = viRows(data);
      var html = '<div class="vol-ctl">' + seg('mode', [['active', '발동 중'], ['today', '오늘 이력']])
        + seg('market', [['ALL', '전체'], ['KOSPI', '코스피'], ['KOSDAQ', '코스닥']])
        + seg('kind', [['ALL', '전체'], ['STATIC', '정적'], ['DYNAMIC', '동적']]) + '</div>';
      if (!rows.length) return html + '<p class="vol-note">' + (viView.mode === 'active' ? '지금 발동 중인 VI가 없습니다.' : '조건에 맞는 오늘 VI 이력이 없습니다.') + '</p>';
      html += '<ul class="vol-list">' + rows.map(function (r) {
        var state = r.status === 'active' ? '발동 중' : r.status === 'released' ? '해제' : '확인 불가';
        var refPrice = r.kind === 'DYNAMIC' ? r.dyn_price : r.static_price;
        var refDprt = r.kind === 'DYNAMIC' ? r.dyn_dprt : r.static_dprt;
        return '<li class="' + (r.status === 'active' ? 'is-active' : '') + '">'
          + '<a class="vol-name" href="/page/stock-search?code=' + encodeURIComponent(r.code) + '&amp;name=' + encodeURIComponent(r.name) + '">' + esc(r.name) + ' <small>' + esc(r.code) + '</small></a>'
          + '<span class="vol-kind">' + esc(KIND_TEXT[r.kind] ? KIND_TEXT[r.kind] + ' VI' : 'VI 종류 확인 불가') + '</span>'
          + '<b class="vol-state">' + state + '</b>'
          + '<span class="vol-time">발동 ' + esc(hhmmss(r.triggered_at)) + ' · 해제 ' + esc(r.released_at ? hhmmss(r.released_at) : '-') + '</span>'
          + '<span class="vol-price">발동가 ' + fmtNum(r.price) + ' · 기준가 ' + fmtNum(refPrice) + ' (' + fmtPct(refDprt) + ')</span>'
          + '<span class="vol-count">오늘 ' + (r.count == null ? '-' : r.count) + '회</span></li>';
      }).join('') + '</ul>';
      var basis = data.vi_basis || {};
      return html + '<small class="vol-src">출처 KIS 변동성완화장치 현황(20초 갱신)' + (basis.ws_events ? ' · 실시간 H0STVIC0 보완 ' + basis.ws_events + '건' : '') + ' · 서버 가동 이후 수신분부터 쌓입니다</small>';
    }

    // 평소(이벤트가 없을 때)에는 카드 영역을 그리지 않는다. 발동 중인 것만 카드로: 서킷브레이커(빨강) · 사이드카(주황) · VI(회색).
    // 해제된 이벤트는 카드에서 빠지고 당일 이력은 상세(카드를 눌러 열거나 헤더의 '오늘 변동성 이력' 링크)에서만 본다.
    function renderAlerts(box, data) {
      if (!box) return;
      if (!isDomesticCard()) { hideAll(); return; }
      var link = q('[data-vol-history]');
      if (!data) { box.hidden = true; if (link) link.hidden = true; return; }
      lastData = data;
      var halts = activeHalts(data.market_halt), vi = viLine(data);
      var haltHistory = haltHistoryCount(data.market_halt);
      var viHistory = data.vi_available === false ? 0 : (data.vi_today || []).length;
      var cards = halts.map(function (e) { return haltCardHtml(e, panel === 'halt'); }).join('') + (vi ? viCardHtml(vi, panel === 'vi') : '');
      if (link) {
        link.hidden = !!cards || !(haltHistory || viHistory);
        link.setAttribute('aria-expanded', panel === 'all' ? 'true' : 'false');
      }
      var html = cards;                  // 수신이 안 되면 카드가 없을 뿐 별도 문구는 두지 않는다(안 뜰 때는 비어 있는 게 정상)
      if (!html && !panel) { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = html + '<div class="vol-panel" id="volPanel" role="region" aria-label="시장 변동성 상세"' + (panel ? '' : ' hidden') + '></div>';
      box.hidden = false;
      var p = box.querySelector('.vol-panel');
      function haltHolder() {
        haltOpen = true;
        var holder = document.createElement('div');
        holder.className = 'home-halt';
        renderHalt(holder, data.market_halt);
        if (holder.hidden) holder.innerHTML = '<small class="vol-note">오늘 사이드카·서킷브레이커 발동 이력이 없습니다.</small>';
        holder.hidden = false;
        return holder;
      }
      if (panel === 'vi') p.innerHTML = viPanelHtml(data);
      else if (panel === 'halt') p.appendChild(haltHolder());
      else if (panel === 'all') {
        if (haltHistory) p.appendChild(haltHolder());
        var viBox = document.createElement('div');
        viBox.innerHTML = viPanelHtml(data);
        p.appendChild(viBox);
      }
    }
    function openPanel(next, focusBack) {
      panel = panel === next ? null : next;
      if (panel === 'all') viView.mode = 'today';          // 이력 링크로 열면 오늘 이력부터 보여 준다
      renderAlerts(q('[data-vol-monitor]'), lastData);
      if (!panel && focusBack) { var b = q('[data-vol-open="' + focusBack + '"]'); if (b) b.focus(); }
    }

    function hideAll() {
      var box = q('[data-vol-monitor]');
      if (box) { box.hidden = true; box.innerHTML = ''; }
      var hl = q('[data-vol-history]');
      if (hl) hl.hidden = true;
      panel = null;
      lastData = null;
    }

    function tick() {
      if (document.hidden || !document.getElementById('homeMarketBoard')) return;
      if (!q('[data-vol-monitor]')) return;
      if (!isDomesticCard()) { hideAll(); return; }
      fetch(CB_API)
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) {
          var data = body && body.data ? body.data : body;
          if (!isDomesticCard()) { hideAll(); return; }
          if (!data) return;
          renderAlerts(q('[data-vol-monitor]'), data);
        })
        .catch(function () { /* 보조 표시라 실패하면 직전 상태를 그대로 둔다 */ });
    }

    document.addEventListener('click', function (event) {
      if (!isDomesticCard()) { hideAll(); return; }
      var t = event.target;
      var open = t.closest && t.closest('[data-vol-open]');
      if (open) { openPanel(open.getAttribute('data-vol-open'), open.getAttribute('data-vol-open')); return; }
      var set = t.closest && t.closest('[data-vol-set]');
      if (set) {
        var kv = set.getAttribute('data-vol-set').split(':');
        viView[kv[0]] = kv[1];
        renderAlerts(q('[data-vol-monitor]'), lastData);
        return;
      }
      var box = q('[data-vol-monitor]');
      if (panel && box && !box.contains(t)) { panel = null; renderAlerts(box, lastData); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel) { var was = panel; openPanel(was, was); }
    });
    window.addEventListener('home-market-change', function () {
      if (!isDomesticCard()) hideAll();
      else tick();
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    setTimeout(tick, 2000);   // 홈 카드가 그려진 뒤 첫 조회
    setInterval(tick, CB_POLL_MS);
  })();

/* 2026-10-05: 업종 로테이션은 홈에서 시장 > 증시온도 페이지(js/market-temp.js)로 옮겼다. */
