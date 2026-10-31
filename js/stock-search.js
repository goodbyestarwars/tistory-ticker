/**
 * 증시검색 - "9Pay 증권" 개편 작업지시서 #6~#8.
 * 독립 Tistory Page(/page/stock-search 예정, <div id="stock-search"> 임베드) 위젯.
 * 종목 검색 결과 리스트 + 선택 종목 호가창(js/order-book.js 재사용) + HTS 스타일
 * 캔들차트(일/주/월봉 + 거래량)를 한 화면에 통합한다. 예전 "호가창" 단독 메뉴 자리를
 * 대신하며(js/skin-menu.js), 3D 산점도는 이 개편에서 완전히 삭제됨(js/order-book.js 참고).
 *
 * window.KRX_MAP, window.SECTOR_MAP(둘 다 이 스크립트보다 먼저 로드),
 * js/order-book.js(호가창 렌더링을 그대로 재사용 - OrderBook.init/select)가 필요하다.
 *
 * 검색 결과 리스트에 표시하는 필드는 일부러 "무료로 대량 조회 가능한 것"만 넣었다 -
 * 종목명/코드/현재가/등락률/거래량/거래대금(계산)/업종(sectors-v3.js 조회)은 기존
 * ?codes= 배치 시세로 여러 종목을 한 번에 받을 수 있다.
 *
 * 2026-07-28: 선택 종목 요약의 "시가총액"/"외국인·기관 수급(5일)" 라인은 사용자 요청으로
 * 제거하고, 대신 GAS ?action=priceReason(오늘 뉴스 기반 AI 한줄요약 - "오늘 왜 올랐는지/
 * 빠졌는지")으로 교체했다.
 *
 * 2026-08-05 사용자 리포트: 종목을 고른 뒤 가만히 있으면 가격/등락률/분봉차트가 전혀
 * 갱신되지 않았다(최초 1회만 그리고 끝 - 이 파일에 주기적 재조회가 아예 없었음). 두 가지를
 * 추가했다 - (1) 상단 요약의 가격/등락률을 체결 단위로 갱신(아래 (2차) 참고),
 * (2) 분봉 탭에 있는 동안 60초 간격으로 분봉을 다시 불러온다(캔들/이평선/거래량 전체
 * 다시 그림 - kospi-futures.js처럼 확대구간을 보존하는 setData() 갱신은 아니라서 60초마다
 * 살짝 다시 그려지는 깜빡임은 남아있음, 필요하면 후속 개선 대상).
 *
 * 2026-08-05(2차) 사용자 리포트: 위 (1)을 처음엔 watchlist.js/order-book.js와 동일하게
 * 이 파일에서 별도로 wss://goodbyestar.cloud/ws/quotes 소켓을 열어 구현했는데, 같은 코드에
 * 소켓이 2개(이 파일 것 + order-book.js 것) 뜨면서 수신 타이밍이 어긋나 상단 요약과
 * 호가창에 서로 다른 가격이 잠깐씩 보였다. 소켓은 order-book.js(#order-book 위젯) 하나만
 * 열도록 되돌리고, 그 위젯의 실시간 틱을 콜백(OrderBook.init의 opts.onQuote)으로 받아써서
 * 항상 같은 값을 보여주게 했다(applyRealtimeQuote 참고).
 *
 * 2026-08-05(3차) 사용자 리포트: 분봉 차트 X축이 날짜만 반복 표시됐음("5일 5일...") -
 * 분봉의 time은 UNIX 타임스탬프인데 timeScale.timeVisible이 꺼져 있어 라이브러리가 날짜만
 * 찍은 것. 분봉일 때만 시:분(HH:mm)을 보여주도록 lwcThemeOptions에 timeframe 인자를
 * 추가했다.
 */
(function (global) {
  'use strict';

  // 차트 공통 엔진(js/chart-core.js 외): 이 파일이 실제로 내려온 곳을 기준으로 받는다(운영=GitHub Pages, 로컬 점검=로컬 서버).
  var CHART_BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    var m = src && src.match(/^(.*\/)js\/stock-search\.js/);
    return m ? m[1] : 'https://goodbyestarwars.github.io/tistory-ticker/';
  }());
  var CHART_CORE_URL = CHART_BASE + 'js/chart-core.js?v=20261024-volume-update';
  var CHART_OPTIONAL = ['drawing', 'memo', 'vp'];   // 못 받아도 차트는 그려진다(해당 기능만 빠진다). 지지·저항·파동은 켤 때 받는다
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#stock-search';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var MAX_RESULTS = 30;
  var FETCH_TIMEOUT_MS = 15000;
  var VM_OHLC_MINUTE_URL = 'https://goodbyestar.cloud/ohlc-minute/';
  var US_STOCKS_SCRIPT = 'https://goodbyestarwars.github.io/tistory-ticker/js/us-stocks.js?v=20261020-analysis-review';
  var US_API_BASE = 'https://goodbyestar.cloud';
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: '애플', aliases: '애플 apple apple inc' },
    { symbol: 'MSFT', name: '마이크로소프트', aliases: '마이크로소프트 microsoft microsoft corporation' },
    { symbol: 'NVDA', name: '엔비디아', aliases: '엔비디아 nvidia nvidia corporation' },
    { symbol: 'AMZN', name: '아마존', aliases: '아마존 amazon amazon.com' },
    { symbol: 'GOOGL', name: '구글', aliases: '구글 알파벳 google alphabet alphabet inc' },
    { symbol: 'TSLA', name: '테슬라', aliases: '테슬라 tesla' },
    { symbol: 'META', name: '메타', aliases: '메타 meta 페이스북 facebook' },
    { symbol: 'INTC', name: '인텔', aliases: '인텔 intel intel corporation' },
    { symbol: 'SPCX', name: '스페이스X', aliases: '스페이스X spacex' },
    { symbol: 'SKHY', name: 'SK하이닉스(ADR)', aliases: 'SK하이닉스 하이닉스 sk hynix' },
    { symbol: 'MRVL', name: '마벨 테크놀로지', aliases: '마벨 마벨테크놀로지 marvell marvell technology' },
    { symbol: 'RGTI', name: '리게티 컴퓨팅', aliases: '리게티 rigetti rigetti computing' },
    { symbol: 'RKLB', name: '로켓 랩', aliases: '로켓랩 로켓 랩 rocket lab' },
    { symbol: 'AVGO', name: '브로드컴', aliases: '브로드컴 broadcom broadcom inc' },
    { symbol: 'ORCL', name: '오라클', aliases: '오라클 oracle oracle corporation' },
    { symbol: 'MU', name: '마이크론 테크놀로지', aliases: '마이크론 마이크론테크놀로지 micron micron technology' },
    { symbol: 'CBRS', name: '세레브라스 시스템즈', aliases: '세레브라스 cerebras cerebras systems' },
    { symbol: 'PLTR', name: '팔란티어', aliases: '팔란티어 palantir palantir technologies' },
    { symbol: 'SNDK', name: '샌디스크', aliases: '샌디스크 sandisk' },
    { symbol: 'DELL', name: '델 테크놀로지스', aliases: '델 델테크놀로지스 dell dell technologies' },
    { symbol: 'IONQ', name: '아이온큐', aliases: '아이온큐 ionq' },
    { symbol: 'AMD', name: 'AMD', aliases: 'amd advanced micro devices' },
    { symbol: 'LLY', name: '일라이 릴리', aliases: '일라이릴리 일라이 릴리 eli lilly lilly' },
    { symbol: 'ASTS', name: 'AST 스페이스모바일', aliases: 'ast asts 스페이스모바일 spacemobile ast spacemobile' }
  ];
  // 신규상장·특수코드는 data/krx_map.js 갱신 전 며칠 동안 검색/차트 진입이 막히기 쉽다.
  // 사용자가 제보한 종목은 런타임에서 KRX_MAP에 보강해, 현재가·차트 API까지 먼저 열어둔다.
  var DOMESTIC_LISTING_FALLBACKS = [
    { code: '486510', name: '글로벌테크놀로지', aliases: '글로벌 테크놀로지 global technology' },
    { code: '0035S0', name: '빅웨이브로보틱스', aliases: '빅웨이브 로보틱스 bigwave robotics big wave robotics' },
    { code: '266690', name: '덕산넵코어스', aliases: '덕산 넵코어스 덕산넵코어스 duksan navcours navcours' },
    { code: '468670', name: '브릴스', aliases: '브릴스 brils' },
    { code: '0013Y0', name: '엠에스바이오', aliases: '엠에스 바이오 msbio ms bio' }
  ];
  var MINUTE_REFRESH_MS = 60000; // 분봉 자동 재조회 간격 - kospi-futures.js와 동일하게 최소 60초
  var MINUTE_SCOPES = ['1', '3', '5', '30', '60'];

  function localizedUsName(symbol, fallback) {
    var code = String(symbol || '').replace(/^US:/i, '').toUpperCase();
    var local = LOCAL_US_SYMBOLS.find(function (row) { return row.symbol === code; });
    var safeFallback = String(fallback || '').trim();
    return local ? local.name : (/[가-힣]/.test(safeFallback) ? safeFallback : '미국 종목');
  }

  function applyDomesticListingFallbacks() {
    global.KRX_MAP = global.KRX_MAP || {};
    DOMESTIC_LISTING_FALLBACKS.forEach(function (row) {
      if (!global.KRX_MAP[row.name]) global.KRX_MAP[row.name] = row.code;
    });
    return global.KRX_MAP;
  }

  var state = {
    selectedCode: null,
    selectedName: null,
    ladderMounted: false,
    timeframe: 'day', // 'day' | 'week' | 'month' | 'minute'
    minuteScope: '1',
    studyOrder: ['ma'],
    lineHighlight: {},   // 범례를 눌러 굵게 표시한 선(키: ma5·ma224·bollinger 등), 종목을 바꿔도 유지
    movingAverageShortEnabled: true,   // 단기 이동평균선 3·5·20·60일
    movingAverageLongEnabled: true,    // 장기 이동평균선 112·224·448일
    ichimokuEnabled: false,
    bollingerEnabled: false,
    accumulationEnabled: false,
    supplyMode: 'detail',
    volumeProfileEnabled: false,
    supportResistanceEnabled: false,
    rsiEnabled: false,             // RSI(14) 서브패널(기본 끔)
    rsiDivergenceEnabled: false,   // RSI 다이버전스(js/chart-divergence.js)
    volumeMultipleEnabled: false,   // 거래량 체감 배수(진한 막대·3배↑ 라벨)
    wave: { enabled: false, level: 'medium' },   // 자동 파동: 대파동 major · 중파동 medium(기본) · 소파동 minor
    chartCache: {},   // code -> flowChart 응답(daily/ma/levels) 5분 캐시
    minuteCache: {},  // code|scope -> { t, bars(LWC 형식으로 변환 완료) }
    lastResults: null,     // 마지막 검색 결과(재렌더링용, 재조회 없이 접기/펼치기)
    resultsCollapsed: false, // 종목을 고르면 목록이 화면을 계속 차지하지 않도록 접음(사용자 리포트)
    minuteRefreshTimer: null,
    externalMinuteLoader: null,
    liveQuotes: {}
  };
  var lwcChart = null;
  var lwcChartContainer = null;
  var lwcCandleSeries = null;
  var lwcLiveBars = [];
  var lwcLiveTimeframe = null;
  var lwcCloudCleanup = null;
  var lwcSrCleanup = null;
  var lwcVolumePane = null;
  var memoCtl = null;
  var lwcRsiZonesCleanup = null;
  var lwcPaneLabelsCleanup = null;
  var lwcDivergenceCleanup = null;
  // 범례 항목(MA3·MA5·…·볼린저)을 누르면 해당 선을 굵게 표시하고 다시 누르면 원래 굵기로 돌린다(2026-10-22 사용자 요청).
  function lineEntries(seriesList) {
    return [].concat(seriesList).map(function (series) {
      var base = 1;
      try { base = series.options().lineWidth || 1; } catch (e) { /* 옵션을 못 읽으면 1px 기준 */ }
      return { series: series, base: base };
    });
  }
  function applyLineHighlight(lines, legendEl) {
    Object.keys(lines).forEach(function (key) {
      var on = !!state.lineHighlight[key];
      lines[key].forEach(function (item) {
        try { item.series.applyOptions({ lineWidth: on ? item.base + 2.5 : item.base }); } catch (e) { /* 이미 제거된 차트면 무시 */ }
      });
    });
    if (legendEl) legendEl.querySelectorAll('[data-line-key]').forEach(function (el) {
      el.classList.toggle('is-on', !!state.lineHighlight[el.getAttribute('data-line-key')]);
    });
  }
  function rememberStudyToggle(key,enabled) {
    var i=state.studyOrder.indexOf(key);if(i>=0)state.studyOrder.splice(i,1);
    if(enabled)state.studyOrder.push(key);
  }
  var supplyMarkerHolder = null;
  var lwcOhlcTooltipCleanup = null;
  var stockPanCleanup = null;
  var stockWheelCleanup = null;
  var stockChartRegistryOff = null;
  var lwcRenderId = 0;
  var drawingCtl = null;     // chart-drawing 컨트롤러(차트 하나당 하나)
  var waveHandle = null;     // chart-wave-overlay 핸들
  var suggestionRequestId = 0;
  var stockSearchRequestId = 0;
  var INDEXES = [
    { code: 'KOSPI', name: '코스피', aliases: 'kospi 코스피 종합주가지수' },
    { code: 'KOSDAQ', name: '코스닥', aliases: 'kosdaq 코스닥' },
    { code: 'NASDAQ_INDEX', name: '나스닥', aliases: 'nasdaq 나스닥 나스닥종합' },
    { code: 'SP500_INDEX', name: 'S&P&500', aliases: 's&p s&p500 sp500 s&p 500 에스앤피 스탠더드앤드푸어스' },
    { code: 'DOW_INDEX', name: '다우존스', aliases: 'dow 다우 다우존스' },
    { code: 'SOX', name: '필라델피아 반도체지수', aliases: 'sox phlx 필라델피아 필라델피아반도체 반도체지수' }
  ];
  var indexStudies = { maShort: true, maLong: true, cloud: false, bollinger: false, sr: false, rsi: false, divergence: false, volmult: false, vp: false, trace: false };   // 이동평균선은 단기(3·5·20·60)·장기(112·224·448) 두 옵션
  var indexWaveState = { enabled: false, level: 'medium', trend: false };   // trend: 파동 박스 안 추세선
  var indexStudySeries = [];
  var indexSrCleanup = null;
  var indexWaveHandle = null;
  var indexStudyUpdate = null;
  var indexVolumeUpdate = null;
  var indexChart = null;
  var indexSeries = null;
  var indexOhlcTooltipCleanup = null;
  var indexWheelCleanup = null;
  var indexDrawingCtl = null;
  var indexExtraCleanup = [];
  function clearIndexExtras() { indexExtraCleanup.splice(0).forEach(function (off) { off(); }); }
  function indexVolumeAvailable(bars) { return (bars || []).filter(function (b) { return b.volume > 0; }).length >= 21; }
  function syncIndexCapabilities(panel, bars) {
    var available = indexVolumeAvailable(bars);
    panel.querySelectorAll('[data-index-volume]').forEach(function (input) {
      input.disabled = !available;
      input.parentElement.hidden = !available;
      input.parentElement.title = available ? "수신된 거래량이 있는 봉 기준" : "이 지수의 거래량 자료가 없습니다";
    });
  }
  var indexBars = [];
  var indexTimeframe = 'day';
  var indexRangeDays = 0;
  var indexRenderId = 0;
  var indexTimer = null;
  // 지수 실시간(2026-10-19): 서버 /ws/market-indicators 가 5초마다 보내는 최신 스냅샷(VM 수집값 중계)으로 시세 숫자를 갱신한다.
  // 서버가 지원하는 지수(코스피·코스닥·나스닥·S&P500·다우)만 연결하고 필라델피아 반도체(SOX)는 지원 목록에 없어 30초 조회만 쓴다.
  var INDEX_WS_URL = 'wss://goodbyestar.cloud/ws/market-indicators';
  var INDEX_WS_SYMBOLS = { KOSPI: 1, KOSDAQ: 1, NASDAQ_INDEX: 1, SP500_INDEX: 1, DOW_INDEX: 1 };
  var indexSocket = null, indexSocketTimer = null, indexSocketDelay = 1500, indexSocketGen = 0, indexSocketTarget = null, indexRefreshNow = null;
  var indexHistoryModuleJob = null;
  function loadIndexHistory(symbol) {
    var group = symbol === 'KOSPI' || symbol === 'KOSDAQ' ? 'domestic' : 'global';
    if (!indexHistoryModuleJob) {
      indexHistoryModuleJob = global.MarketChartHistory ? Promise.resolve(global.MarketChartHistory) : new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = CHART_BASE + 'js/market-history.js?v=20261018-index-3y';
        script.onload = function () { resolve(global.MarketChartHistory || null); };
        script.onerror = function () { resolve(null); };
        document.head.appendChild(script);
      });
    }
    return indexHistoryModuleJob.then(function (history) {
      return history ? history.load(group).then(function () { return history; }) : null;
    });
  }
  function indexThreeYearRows(symbol, recent, history) {
    var rows = history ? history.merge(symbol, recent) : (recent || []);
    var today = new Date(Date.now() + 9 * 3600000);
    var month = today.getUTCMonth(), day = today.getUTCDate();
    today.setUTCFullYear(today.getUTCFullYear() - 3);
    if (today.getUTCMonth() !== month) today.setUTCDate(0);
    var from = today.toISOString().slice(0, 10).replace(/-/g, '');
    return rows.filter(function (row) { return String(row.date || '').replace(/-/g, '') >= from; });
  }
  function indexMatches(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return INDEXES.filter(function (row) { return (row.name + ' ' + row.code + ' ' + row.aliases).toLowerCase().indexOf(q) >= 0; });
  }
  function exactIndex(query) {
    var q = String(query || '').trim().toLowerCase().replace(/^index:/, '');
    return INDEXES.filter(function (row) { return row.code.toLowerCase() === q || row.name.toLowerCase() === q || row.aliases.split(' ').indexOf(q) >= 0; })[0];
  }

  // 거래량/RSI 서브패널은 같은 최소 높이와 비율을 사용해 항상 1:1로 유지한다.
  var SUB_PANE_MIN_HEIGHT = 82;
  var SUB_PANE_RATIO = 0.20;
  var ICHIMOKU_CLOUD_FILL = 'rgba(90,170,215,0.4)'; // 2026-08-22 요청: "더 진한 색으로" - 옅은 하늘색 0.24 알파에서 더 짙고 채도 높은 파랑 0.4 알파로 조정
  var ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)';

  // 패널 제목(RSI)·거래량 범례의 top 위치를 실제 적용된 패널 높이에 맞춰 다시 계산한다.
  // renderLwChart()의 최초 렌더링과 resizeStockChart()의 리사이즈(전체화면 전환·창 크기
  // 변경) 양쪽에서 같이 써야 한다 - 리사이즈 쪽에서 패널 높이만 다시 잡고 라벨 위치는
  // 그대로 두면, 전체화면으로 열었을 때 라벨이 예전(작은 컨테이너 기준) 위치에 남아
  // 실제 패널과 어긋나 보인다(2026-08-14 사용자 스크린샷 제보). MACD 패널은 같은 날
  // 아예 없앴다(거래량/RSI/MACD 3패널 좁은 공간에서 라벨·배지가 계속 겹쳐 보인다는
  // 리포트가 반복돼, 패널 자체를 줄이는 쪽으로 정리).
  function positionLwcPaneLabels(container, panes, mainHeight, subHeight) {
    // 거래량 패널은 ss-volume-study-label(실제 수치가 있는 범례)이 이미 "거래량" 문구를
    // 포함하고 있어서, paneLabels의 span("RSI(14)" 제목만 있는 라벨)을 같은 top에
    // 겹쳐 놓으면 두 텍스트가 같은 자리에 찍혀 보인다 - paneLabels에는 RSI 라벨만 남기고
    // 거래량은 범례에만 맡긴다.
    var paneLabels = container.querySelector('.ss-lwc-pane-labels');
    var volumeLegend = container.querySelector('.ss-volume-study-label');
    var actualMainHeight = panes && panes[0] && panes[0].getHeight ? panes[0].getHeight() : mainHeight;
    var actualVolumeHeight = panes && panes[1] && panes[1].getHeight ? panes[1].getHeight() : subHeight;
    if (!Number.isFinite(actualMainHeight) || actualMainHeight <= 0) actualMainHeight = mainHeight;
    if (!Number.isFinite(actualVolumeHeight) || actualVolumeHeight <= 0) actualVolumeHeight = subHeight;
    if (paneLabels) {
      var rsiLabel = paneLabels.querySelector('span');
      if (rsiLabel) {
        rsiLabel.style.top = (actualMainHeight + actualVolumeHeight + 6) + 'px';
        paneLabels.style.visibility = 'visible';
      }
    }
    // 거래량 막대는 이제 항상 패널 하단(기준선 0)에 붙고 위쪽 15%만 비워두도록 고정했다
    // (chart.priceScale('volume') scaleMargins) - 범례를 패널 맨 위에 두면 데이터 값과
    // 무관하게 항상 막대 바로 위 여백에 온다(2026-08-14 사용자 리포트로 "패널 하단에
    // 붙이기"를 먼저 시도했지만 막대 시작 위치를 못 미리 알아 자리가 계속 안 맞았음 -
    // 막대 위치 자체를 고정하는 쪽으로 대신 해결).
    if (volumeLegend) volumeLegend.style.top = (actualMainHeight + 6) + 'px';
    fitVolumeLegend(volumeLegend, actualVolumeHeight);
  }

  function installPaneLabelSync(container, panes, sizes) {
    var frame = 0, disposed = false;
    function schedule() {
      if (disposed || frame) return;
      frame = global.requestAnimationFrame(function () {
        // resize/stretch layout can itself be queued for this frame. Read the
        // pane heights on the next frame, after that layout has settled.
        frame = global.requestAnimationFrame(function () {
          frame = 0;
          if (!disposed) positionLwcPaneLabels(container, panes, sizes.mainHeight, sizes.subHeight);
        });
      });
    }
    // LWC 5.2 panes have getHTMLElement(), not subscribeSizeChange(). Observe
    // real pane elements so fullscreen, restoration and divider drags all sync.
    var observer = typeof global.ResizeObserver === 'function' ? new global.ResizeObserver(schedule) : null;
    if (observer) {
      observer.observe(container);
      panes.forEach(function (pane) {
        var element = pane.getHTMLElement ? pane.getHTMLElement() : null;
        if (element) observer.observe(element);
      });
    }
    global.addEventListener('tistory-chart-resize', schedule);
    global.addEventListener('resize', schedule);
    schedule();
    return function () {
      disposed = true;
      if (frame) global.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      global.removeEventListener('tistory-chart-resize', schedule);
      global.removeEventListener('resize', schedule);
    };
  }

  // 좁은 화면에서는 범례를 거래량 패널 높이에 맞게 단계적으로 접는다.
  function fitVolumeLegend(volumeLegend, volumeHeight) {
    if (!volumeLegend || !Number.isFinite(volumeHeight) || volumeHeight <= 0) return;
    var budget = volumeHeight - 8;
    // RSI 구역 캔버스가 매 프레임 positionLwcPaneLabels()를 부르므로, 같은 높이로 이미 맞춰 뒀으면
    // offsetHeight를 다시 읽지 않는다(강제 레이아웃 회피). 범례는 다시 그릴 때 새로 만들어지므로
    // 내용이 바뀌면 이 표시도 함께 사라진다.
    if (volumeLegend.dataset.fitBudget === String(budget)) return;
    volumeLegend.dataset.fitBudget = String(budget);
    volumeLegend.classList.remove('is-compact', 'is-minimal');
    if (volumeLegend.offsetHeight <= budget) return;
    volumeLegend.classList.add('is-compact');   // 괄호 안 상세(20일 대비·현재 %)
    if (volumeLegend.offsetHeight <= budget) return;
    volumeLegend.classList.add('is-minimal');   // 5일·20일 평균 줄
  }

  function sizeStockChartPanes(panes, totalHeight, compactSubPanes) {
    if (!panes || panes.length < 2) return { mainHeight: totalHeight, subHeight: 0 };
    var subPaneCount = panes.length - 1;
    var minSubHeight = compactSubPanes ? 58 : SUB_PANE_MIN_HEIGHT;
    var subRatio = compactSubPanes ? 0.12 : SUB_PANE_RATIO;
    var preferredSubHeight = Math.max(minSubHeight, Math.round(totalHeight * subRatio));
    var availableSubHeight = Math.max(1, Math.floor((totalHeight - 220) / subPaneCount));
    var subHeight = Math.min(preferredSubHeight, availableSubHeight);
    var mainHeight = Math.max(220, totalHeight - subHeight * subPaneCount);
    // 거래량과 RSI에 똑같은 값을 적용한다. 가격 패널은 남은 높이만 사용한다.
    panes.forEach(function (pane, index) {
      var target = index === 0 ? mainHeight : subHeight;
      // 비율로 분배하면 시간축·구분선 높이를 라이브러리가 한 번에 제외한다.
      // 각 패널의 픽셀 높이를 차례로 바꿔 다시 레이아웃을 만드는 것을 피한다.
      if (pane.setStretchFactor) {
        if (!pane.getStretchFactor || pane.getStretchFactor() !== target) pane.setStretchFactor(target);
      } else if (pane.setHeight) pane.setHeight(target);
    });
    return { mainHeight: mainHeight, subHeight: subHeight };
  }

  var stockChartResizeFrame = 0;
  var stockChartResizeOff = null;
  var stockChartMeasuredWidth = 0;
  var stockChartMeasuredHeight = 0;

  function resizeStockChart() {
    if (!lwcChart || !lwcChartContainer || !lwcChart.resize) return;
    if (stockChartResizeFrame) return;
    stockChartResizeFrame = global.requestAnimationFrame(function () {
      stockChartResizeFrame = 0;
      if (!lwcChart || !lwcChartContainer) return;
      var width = Math.floor(lwcChartContainer.clientWidth);
      var height = Math.floor(lwcChartContainer.clientHeight);
      if (width > 0 && height > 0
          && (width !== stockChartMeasuredWidth || height !== stockChartMeasuredHeight)) {
        try {
          lwcChart.resize(width, height);
          stockChartMeasuredWidth = width;
          stockChartMeasuredHeight = height;
          var panes = lwcChart.panes ? lwcChart.panes() : [];
          if (panes.length > 1) {
            var sizes = sizeStockChartPanes(panes, height, !!lwcChartContainer.closest('.de-chart-overlay'));
            positionLwcPaneLabels(lwcChartContainer, panes, sizes.mainHeight, sizes.subHeight);
          }
        } catch (e) { /* 레이아웃 정리 후 다음 요청에서 재시도 */ }
      }
      if (drawingCtl) drawingCtl.resize();
    });
  }
  global.addEventListener('tistory-chart-resize', resizeStockChart);
  global.addEventListener('resize', resizeStockChart);

  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    var iconCode = String(code).replace(/^US:/i, '').toUpperCase();
    var market = /^US:/i.test(String(code)) ? 'us' : 'domestic';
    return '<img class="ss-icon" data-icon-code="' + escapeAttr(iconCode) + '" data-icon-market="' + market
      + '" src="' + STOCK_ICON_BASE + encodeURIComponent(iconCode) + '.svg" alt="" loading="lazy" onerror="window.StockIconFallback ? window.StockIconFallback(this) : window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    if (isIndependentChartMode()) container.classList.add('ss-independent-chart');
    document.title = document.title.replace(/증시검색/g, isIndependentChartMode() ? '독립 차트' : '실시간 시세');
    document.querySelectorAll('.post-single-title').forEach(function (title) {
      if (title.textContent.trim() === '증시검색') title.textContent = isIndependentChartMode() ? '독립 차트' : '실시간 시세';
    });
    container.innerHTML = buildShell();
    chartReady().catch(function () { /* 차트를 열 때 다시 시도하고 오류를 보여 준다 */ });   // 라이브러리·모듈을 검색·시세 조회와 겹쳐 미리 받는다
    if (global.OrderBook) global.OrderBook.flowChartProvider = loadSharedFlowChart;
    wirePanelResize(container);
    wireSearch(container);
    autoSearchFromUrl(container);

    // 실시간 체결가 소켓의 visibilitychange 처리는 order-book.js가 자기 자신의 init()에서
    // 이미 하고 있다(#order-book 위젯을 그대로 재사용 - 위 applyRealtimeQuote 주석 참고).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopMinuteRefresh();
      } else if (state.timeframe === 'minute' && state.selectedCode) {
        startMinuteRefresh(container, state.selectedCode);
      }
    });
  }

  function isUsRoute() {
    var params = new URLSearchParams(location.search);
    return params.get('market') === 'us' || /^US:/i.test(params.get('code') || '');
  }

  function isIndependentChartMode() {
    return new URLSearchParams(location.search).get('tool') === 'independent-chart';
  }

  // Keep the domestic and US views mutually exclusive. Both modules share this
  // page, so leaving the previous module visible produces stale or empty charts.
  function setMarketMode(container, isUs) {
    var usModule = container.querySelector('#ssUsModule');
    var results = container.querySelector('#ssResults');
    var overview = container.querySelector('#ssOverview');
    var detail = container.querySelector('#ssDetail');
    if (usModule) usModule.hidden = !isUs;
    if (overview) overview.hidden = !!isUs;
    if (!isUs && global.UsStocks && typeof global.UsStocks.pause === 'function') global.UsStocks.pause();
    if (results) results.hidden = !!isUs;
    if (detail && isUs) detail.hidden = true;
    if (isUs) { stockSearchRequestId += 1; hideIndex(container); }
  }

  function loadUsStocksModule(container) {
    var target = container.querySelector('#ssUsModule');
    if (!target) return;
    setMarketMode(container, true);
    if (global.UsStocks && typeof global.UsStocks.init === 'function') {
      global.UsStocks.init(target);
      return;
    }
    if (document.querySelector('script[data-us-stocks-module]')) return;
    var script = document.createElement('script');
    script.src = US_STOCKS_SCRIPT;
    script.async = true;
    script.setAttribute('data-us-stocks-module', '1');
    script.onload = function () {
      if (global.UsStocks && typeof global.UsStocks.init === 'function') {
        global.UsStocks.init(target);
      }
    };
    script.onerror = function () {
      target.innerHTML = '<div class="ss-hint ss-error">미국주식 시세 모듈을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    };
    document.body.appendChild(script);
  }

  // 관심종목(MY) 카드의 "차트 보기" 버튼이 ?code=005930&name=삼성전자로 넘어오면
  // 사용자가 직접 검색하지 않아도 바로 그 종목을 조회한다(js/foreign-flow.js의
  // autoSearchFromUrl과 동일 패턴, js/watchlist.js가 이 URL로 링크를 건다).
  function autoSearchFromUrl(container) {
    var params = new URLSearchParams(location.search);
    var code = (params.get('code') || '').trim();
    if (!code && isIndependentChartMode()) code = '005930';
    if (/^INDEX:/i.test(code)) { runSearch(container, code); return; }
    if (params.get('market') === 'us' || /^US:/i.test(code)) {
      setMarketMode(container, true);
      loadUsStocksModule(container);
      return;
    }
    setMarketMode(container, false);
    if (!code) return;
    var name = (params.get('name') || '').trim() || (code === '005930' ? '삼성전자' : '');
    var input = container.querySelector('#ssInput');
    if (input) input.value = name || code;
    runSearch(container, code);
  }

  function minuteCacheKey(code, scope) {
    return String(code || '') + '|' + String(scope || state.minuteScope || '1');
  }

  // 파동 분석 규모 선택(대·중·소) 자리. 셸을 먼저 그려야 해서 비워 두고(숨김), 단추는 js/chart-wave-overlay.js 가 채운다.
  function waveLevelHtml() {
    return '<span class="ss-wave-level" data-chart-wave-level role="group" aria-label="파동 규모"' + (state.wave.enabled ? '' : ' hidden') + '></span>';
  }

  function minuteScopeControlHtml() {
    return '<label class="ss-minute-scope"><span>분봉 간격</span><select data-minute-scope aria-label="분봉 간격">'
      + MINUTE_SCOPES.map(function (scope) {
        return '<option value="' + scope + '"' + (scope === '1' ? ' selected' : '') + '>' + scope + '분</option>';
      }).join('')
      + '</select></label>';
  }

  function openUsSymbol(container, query) {
    var symbol = String(query || '').replace(/^US:/i, '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-^=]{0,11}$/.test(symbol)) return false;
    setMarketMode(container, true);
    var target = container.querySelector('#ssUsModule');
    if (target) target.setAttribute('data-us-symbol', symbol);
    try {
      var url = new URL(location.href);
      url.searchParams.set('code', 'US:' + symbol);
      url.searchParams.set('market', 'us');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* 구형 브라우저는 주소 갱신 없이 계속 조회한다. */ }
    loadUsStocksModule(container);
    if (global.UsStocks && typeof global.UsStocks.select === 'function') global.UsStocks.select(symbol);
    return true;
  }

  function buildShell() {
    return ''
      + '<div class="ss-search">'
      + '<div class="ss-input-wrap">'
      + '<input type="text" id="ssInput" class="ss-input" placeholder="한국·미국 종목명 또는 코드 (예: 삼성전자, AAPL)" autocomplete="off" />'
      + '<div id="ssSuggest" class="ss-suggest"></div>'
      + '</div>'
      + '<button type="button" id="ssGoBtn" class="ss-go-btn">검색</button>'
      + '</div>'
      // One shared card: complete search result table + OHLC/analysis/AI details.
      + '<div id="ssOverview" class="ss-overview">'
      + '<div id="ssResults" class="ss-results"></div>'
      + '<div id="ssSummary" class="ss-summary" hidden></div>'
      + '</div>'
      + '<div id="ssUsModule" class="ss-us-module" hidden></div>'
      + '<section id="ssIndexPanel" class="ss-index-panel" hidden></section>'
      + '<div id="ssDetail" class="ss-detail" hidden>'
      + '<div class="ss-panels">'
      // css/order-book.css의 모든 규칙이 "#order-book .ob-xxx"로 ID에 고정돼 있어(다른
      // ID로 마운트하면 스타일이 하나도 안 먹음 - 실측으로 발견) 마운트 id를 그대로
      // "order-book"으로 맞춰 기존 CSS를 손대지 않고 재사용한다. 이 페이지엔 이 위젯이
      // 하나뿐이라 중복 id 걱정은 없다.
      + '<div class="ss-panel-left"><div class="ss-panel-head"><h4>호가</h4></div>'
      + '<div id="ssSessionCandle" class="ss-session">시가·고가·저가 자료를 불러오는 중…</div>'
      + '<div id="order-book"></div></div>'
      + '<div class="ss-resize-handle" role="separator" aria-orientation="vertical" aria-label="호가창과 차트 폭 조절" tabindex="0"></div>'
      + '<div class="ss-panel-right">'
      + '<div class="ss-panel-head"><h4>차트</h4></div>'
      + '<div class="ss-stock-controls" role="group" aria-label="종목 차트 설정">'
      + '<div class="ss-chart-tabs">'
      + '<div class="ss-timeframe-tools">'
      + '<button type="button" class="ss-tf-btn active" data-tf="day">일봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="week">주봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="month">월봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="minute">분봉</button>'
      + '</div>'
      + '<div class="ss-minute-scope-wrap" data-minute-scope-wrap hidden>' + minuteScopeControlHtml() + '</div>'
      + '<div class="ss-drawing-tools">'
      + '<button type="button" class="ss-memo-toggle" aria-pressed="false" title="차트의 봉을 눌러 메모를 남깁니다(일·주·월봉)">메모</button>'
      + '<button type="button" class="ss-draw-toggle" aria-pressed="false">직선</button>'
      + '<button type="button" class="ss-circle-toggle" aria-pressed="false">동그라미</button>'
      + '<button type="button" class="ss-box-toggle" aria-pressed="false">박스</button>'
      + '<button type="button" class="ss-hline-toggle" aria-pressed="false">가로선</button>'
      + '<button type="button" class="ss-measure-toggle" aria-pressed="false" title="고점에서 저점까지 끌면 변화율(%)을 보여 줍니다">측정</button>'
      + '<button type="button" class="ss-pencil-toggle" aria-pressed="false">연필</button>'
      + '<button type="button" class="ss-draw-clear">지우기</button>'
      + '</div></div>'
      + '<div class="ss-chart-studies">'
      + '<label title="3·5·20·60일선"><input type="checkbox" data-chart-ma-short-toggle checked /> 단기 이평선(3·5·20·60)</label>'
      + '<label title="112·224·448일선. 224일선은 굵은 검정"><input type="checkbox" data-chart-ma-long-toggle checked /> 장기 이평선(112·224·448)</label>'
      + '<label title="전환선(9)·기준선(26)·선행스팬(52, 26봉 앞)으로 그린 구름대입니다. 구름 위는 상승 우위, 아래는 하락 우위로 읽습니다. 참고용이며 매수·매도 신호가 아닙니다."><input type="checkbox" id="ssIchimokuToggle" /> 일목균형표(구름) 표시</label>'
      + '<label title="20일 이동평균을 가운데로 위아래 표준편차 2배 폭의 밴드입니다. 밴드가 좁아지면 변동성 수축, 넓어지면 확대를 뜻합니다."><input type="checkbox" id="ssBollingerToggle" /> 볼린저 밴드</label>'
      + '<label title="과거에 가격이 반응했던 가격대를 가로 띠로 표시합니다. 반응 횟수·최근 반응일·거래량 동반 여부로 선 굵기가 달라지고, 보라색 파선은 지지와 저항이 바뀐 가격대입니다."><input type="checkbox" id="ssSupportResistanceToggle" /> 지지·저항 표시</label>'
      + '<label title="배수 = 그 봉 거래량 ÷ 바로 앞 20봉(일봉이면 20일) 평균 거래량(그 봉 제외). 2배 이상이면 막대를 진하게, 3배 이상이면 `3.2배`처럼 숫자를 붙입니다. 매수·매도 신호가 아닙니다."><input type="checkbox" data-chart-volmult-toggle /> 거래량 배수 표시</label>'
      + '<label title="RSI(14) 보조 패널을 표시합니다. 70 이상은 과매수, 30 이하는 과매도 구간으로 색을 입힙니다. 끄면 패널이 사라지고 RSI 다이버전스도 함께 꺼집니다."><input type="checkbox" data-chart-rsi-toggle /> RSI</label>'
      + '<label title="자동 파동이 확정한 고점·저점끼리 가격과 RSI의 방향이 엇갈린 구간에 선을 긋습니다. 과거 구조를 보여 줄 뿐 매수·매도 신호가 아닙니다."><input type="checkbox" data-chart-rsidiv-toggle /> RSI 다이버전스</label>'
      + '<label title="가격대별로 거래량이 많이 쌓인 구간을 차트 옆 막대로 보여 줍니다. 매물이 많이 걸린 가격대를 찾을 때 씁니다."><input type="checkbox" id="ssVolumeProfileToggle" /> 매물대 표시</label>'
      + '<label title="일봉 OHLCV 관찰용. 상세 모드는 3배 거래량·장기선 접근/공방·회복의 원 관측을 하루 한 기호로 표시합니다. 축소 시 일부 기호를 생략하며 확대하면 다시 보입니다. 모든 조건은 십자선 툴팁에 있습니다. 실제 수급 주체를 뜻하지 않습니다."><input type="checkbox" id="ssAccumulationToggle" /> 거래량·가격 흔적</label>'
      + '<label title="실험 기능: 가격 움직임의 구조를 상승(빨강)·하락(파랑)·횡보(회색)·변동성 큰 박스권(보라 회색) 박스로 나눠 보여줍니다. 대·중·소 규모를 고를 수 있고(기본 중파동) 한 단계 위 규모는 옅은 점선 윤곽으로 함께 보입니다. 극점은 되돌림이 확인된 뒤에 확정되고, 점선(진행 중·방향 미확정) 구간은 새 봉이 들어오면 바뀔 수 있습니다. 매수·매도 추천이 아닙니다."><input type="checkbox" id="ssAutoWaveToggle" data-chart-wave-toggle /> 파동 분석</label>' + waveLevelHtml()
      + '</div></div>'
      + '<div id="ssChartNotice" class="ss-chart-legend" hidden></div>'
      + '<div id="ssChart" class="ss-chart"><div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>차트를 불러오는 중...</div></div>'
      + '<div class="ss-chart-legend">거래량은 캔들 아래 막대로 표시됩니다.</div>'
      + '</div>'
      + '<section class="ss-news-panel"><div class="ss-news-panel-head"><h3>관련 뉴스</h3><span>최근 24시간</span></div><div id="ssDomesticNews" class="ss-domestic-news"><div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>뉴스를 불러오는 중...</div></div></section>'
      + '</div>';
  }

  function wirePanelResize(container) {
    var panels = container.querySelector('.ss-panels');
    var handle = panels && panels.querySelector('.ss-resize-handle');
    if (!panels || !handle) return;
    if (handle.getAttribute('data-resize-bound') === '1') {
      if (typeof handle.__refreshResizeAria === 'function') handle.__refreshResizeAria();
      return;
    }
    handle.setAttribute('data-resize-bound', '1');

    // 240px에서는 이전처럼 체결가가 줄바꿈될 수 있어, 읽을 수 있는 하한만 300px으로 둔다.
    var MIN_LEFT = 300;
    var MIN_RIGHT = 360;
    var HANDLE_WIDTH = 16;
    var dragging = false;
    var pointerId = null;
    var startX = 0;
    var startWidth = 0;
    var previousUserSelect = '';
    var previousCursor = '';

    function panelWidth() {
      return panels.getBoundingClientRect().width || panels.clientWidth || 0;
    }

    function maxLeftWidth() {
      return Math.max(MIN_LEFT, panelWidth() - HANDLE_WIDTH - MIN_RIGHT);
    }

    function clampWidth(width) {
      return Math.min(maxLeftWidth(), Math.max(MIN_LEFT, Number(width) || MIN_LEFT));
    }

    function currentWidth() {
      var raw = getComputedStyle(panels).getPropertyValue('--ss-left-width');
      // 기본값이 %이면 숫자만 읽으면 틀리므로 실제 좌측 패널 폭을 잰다.
      if (/px\s*$/.test(raw)) return clampWidth(parseFloat(raw) || 394);
      var left = panels.querySelector('.ss-panel-left');
      return clampWidth((left && left.getBoundingClientRect().width) || 394);
    }

    function updateAria(width) {
      var value = Math.round(clampWidth(width));
      handle.setAttribute('aria-valuemin', String(MIN_LEFT));
      handle.setAttribute('aria-valuemax', String(Math.round(maxLeftWidth())));
      handle.setAttribute('aria-valuenow', String(value));
    }

    function setWidth(width) {
      var value = clampWidth(width);
      panels.style.setProperty('--ss-left-width', Math.round(value) + 'px');
      updateAria(value);
    }

    function stopDragging(event) {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (pointerId !== null && handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      pointerId = null;
      if (event && event.preventDefault) event.preventDefault();
    }

    handle.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = currentWidth();
      previousUserSelect = document.body.style.userSelect;
      previousCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      handle.classList.add('is-dragging');
      if (handle.setPointerCapture) handle.setPointerCapture(pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', function (event) {
      if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) return;
      setWidth(startWidth + event.clientX - startX);
      event.preventDefault();
    });
    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);

    handle.addEventListener('keydown', function (event) {
      var width = currentWidth();
      if (event.key === 'ArrowLeft') {
        setWidth(width - 20);
        event.preventDefault();
      } else if (event.key === 'ArrowRight') {
        setWidth(width + 20);
        event.preventDefault();
      } else if (event.key === 'Home') {
        setWidth(MIN_LEFT);
        event.preventDefault();
      } else if (event.key === 'End') {
        setWidth(maxLeftWidth());
        event.preventDefault();
      }
    });

    window.addEventListener('resize', function () { updateAria(currentWidth()); });
    window.addEventListener('blur', stopDragging);
    handle.__refreshResizeAria = function () { updateAria(currentWidth()); };
    updateAria(currentWidth());
  }

  // ---- 검색/자동완성 (다른 위젯들과 동일한 KRX_MAP 패턴) ----

  function wireSearch(container) {
    var input = container.querySelector('#ssInput');
    var suggestBox = container.querySelector('#ssSuggest');
    var goBtn = container.querySelector('#ssGoBtn');

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    // 2026-07-28: 자동완성 목록에서 방향키(위/아래)로 항목을 훑을 수 있어야 하는데
    // Enter/Escape만 처리하고 있었음(사용자 리포트, js/stock-news.js에 이미 있던
    // getActiveSuggestion/setActiveSuggestion 패턴을 그대로 옮겨옴).
    input.addEventListener('keydown', function (e) {
      var items = suggestBox.querySelectorAll('.ss-suggest-item');
      if (e.key === 'ArrowDown') {
        if (!items.length) return;
        e.preventDefault();
        setActiveSuggestion(suggestBox, items, (getActiveSuggestion(suggestBox) + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        setActiveSuggestion(suggestBox, items, (getActiveSuggestion(suggestBox) - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var idx = getActiveSuggestion(suggestBox);
        var picked = idx > -1 && items[idx] ? items[idx].getAttribute('data-name') : input.value.trim();
        if (idx > -1 && items[idx]) input.value = picked;
        hideSuggestions(suggestBox);
        runSearch(container, picked);
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    goBtn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      runSearch(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    box.__activeIndex = -1;
  }

  function getActiveSuggestion(box) {
    return typeof box.__activeIndex === 'number' ? box.__activeIndex : -1;
  }
  function setActiveSuggestion(box, items, idx) {
    items.forEach(function (el) { el.classList.remove('active'); });
    box.__activeIndex = idx;
    var el = items[idx];
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function matchNames(query, limit) {
    var map = applyDomesticListingFallbacks();
    var q = query.toLowerCase();
    var starts = [], contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) { if (starts.length < limit) starts.push(name); }
      else if (lower.indexOf(q) > -1) { if (contains.length < limit) contains.push(name); }
      if (starts.length >= limit && contains.length >= limit) break;
    }
    return starts.concat(contains).slice(0, limit);
  }

  function renderSuggestions(container, box, query) {
    if (!query) { hideSuggestions(box); return; }
    applyDomesticListingFallbacks();
    var requestId = ++suggestionRequestId;
    var indexRows = indexMatches(query).map(function (row) { return { name: row.name, code: 'INDEX:' + row.code, market: 'index' }; });
    var domesticRows = matchNames(query, 6).map(function (name) {
      return { name: name, code: global.KRX_MAP[name], market: 'kr' };
    });
    fetchUsSearch(query).then(function (usRows) {
      if (requestId !== suggestionRequestId) return;
      var rows = indexRows.concat(domesticRows, usRows).slice(0, 8);
      if (!rows.length) { hideSuggestions(box); return; }
      box.innerHTML = rows.map(function (row) {
        var isUs = row.market === 'us' || /^US:/i.test(row.code);
        return '<div class="ss-suggest-item" data-name="' + escapeAttr(row.name) + '" data-code="' + escapeAttr(row.code) + '">'
          + stockIconHtml(row.code)
          + escapeHtml(row.name) + (isUs ? '<small class="ss-suggest-code">' + escapeHtml(String(row.code).replace(/^US:/i, '')) + '</small>' : '')
          + '</div>';
      }).join('');
      box.classList.add('active');
      box.__activeIndex = -1;
      box.querySelectorAll('.ss-suggest-item').forEach(function (el, i) {
        el.addEventListener('mouseenter', function () {
          setActiveSuggestion(box, box.querySelectorAll('.ss-suggest-item'), i);
        });
        el.addEventListener('click', function () {
          var name = el.getAttribute('data-name');
          container.querySelector('#ssInput').value = name;
          hideSuggestions(box);
          runSearch(container, el.getAttribute('data-code') || name);
        });
      });
    });
  }

  // ---- 검색 결과 리스트 ----

  function resolveDomesticName(query) {
    var map = applyDomesticListingFallbacks();
    var needle = String(query || '').trim().toLowerCase();
    if (!needle) return null;
    for (var name in map) {
      if (map.hasOwnProperty(name) && String(name).toLowerCase() === needle) {
        return { name: name, code: map[name] };
      }
    }
    return null;
  }

  function runSearch(container, query) {
    var searchId = ++stockSearchRequestId;
    var resultsBox = container.querySelector('#ssResults');
    var summary = container.querySelector('#ssSummary');
    var detail = container.querySelector('#ssDetail');
    if (summary) summary.hidden = true;
    if (detail) detail.hidden = true;
    if (!query) { resultsBox.innerHTML = '<div class="ss-hint">종목명 또는 코드를 입력해주세요.</div>'; return; }
    var chosenIndex = exactIndex(query);
    if (chosenIndex) { openIndex(container, chosenIndex); return; }
    var indexCandidates = indexMatches(query);
    if (indexCandidates.length && !resolveDomesticName(query)) {
      hideIndex(container); setMarketMode(container, false);
      container.querySelector('#ssDetail').hidden = true;
      resultsBox.innerHTML = '<div class="ss-results-count">지수 검색 결과 ' + indexCandidates.length + '건</div>'
        + indexCandidates.map(function (row) { return '<button type="button" class="ss-index-result" data-symbol="' + escapeAttr(row.code) + '">' + escapeHtml(row.name) + '</button>'; }).join('');
      resultsBox.querySelectorAll('.ss-index-result').forEach(function (button) {
        button.addEventListener('click', function () {
          var selected = indexCandidates.filter(function (row) { return row.code === button.getAttribute('data-symbol'); })[0];
          if (selected) openIndex(container, selected);
        });
      });
      return;
    }
    hideIndex(container);
    setMarketMode(container, false);
    var domesticMatch = resolveDomesticName(query);
    if (domesticMatch) {
      runDomesticSearch(container, domesticMatch.name, searchId);
      return;
    }
    if (/^US:/i.test(query) || (/^[A-Z][A-Z0-9.\-^=]{0,11}$/.test(query) && !/^[0-9A-Za-z]{6}$/.test(query))) {
      openUsSymbol(container, query);
      return;
    }
    if (!/^[0-9A-Za-z]{6}$/.test(query)) {
      resultsBox.innerHTML = '<div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>한국·미국 종목을 찾는 중...</div>';
      fetchUsSearch(query).then(function (rows) {
        if (searchId !== stockSearchRequestId) return;
        if (rows.length) {
          openUsSymbol(container, rows[0].code);
          return;
        }
        runDomesticSearch(container, query, searchId);
      }).catch(function () { if (searchId === stockSearchRequestId) runDomesticSearch(container, query, searchId); });
      return;
    }
    runDomesticSearch(container, query, searchId);
  }

  // 오늘(한국 시각) 날짜 'YYYY-MM-DD'.
  function kstToday(now) {
    var d = new Date((now || Date.now()) + 9 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  // 실시간 시세로 마지막 일봉을 갱신할 수 있으면 새 봉을, 아니면 null 을 돌려준다.
  // 한국 지수만, 마지막 봉 날짜가 오늘(KST)일 때만 고가·저가·종가를 갱신한다(어제 봉을 오늘 가격으로 덮어쓰지 않는다). 시가는 그대로 둔다.
  function indexLiveBar(code, lastBar, price, today) {
    if ((code !== 'KOSPI' && code !== 'KOSDAQ') || !lastBar || !(price > 0) || lastBar.date !== today) return null;
    return { date: lastBar.date, open: lastBar.open, high: Math.max(lastBar.high, price), low: Math.min(lastBar.low, price), close: price };
  }

  function closeIndexSocket() {
    indexSocketGen += 1;
    if (indexSocketTimer) { clearTimeout(indexSocketTimer); indexSocketTimer = null; }
    var current = indexSocket;
    indexSocket = null;
    indexSocketDelay = 1500;
    indexSocketTarget = null;
    if (current) { try { current.close(); } catch (e) { /* 이미 닫힘 */ } }
  }

  // 탭이 숨겨져 있던 동안 끊겼다면 다시 보일 때 이어 붙인다(30초 조회와 같은 정책).
  // 지수 화면을 숨겨진 탭에서 열면(링크를 새 탭으로 열 때 등) 조회가 건너뛰어져 '불러오는 중...'에 멈춘다. 탭이 보이면 바로 한 번 조회한다.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (indexRefreshNow) indexRefreshNow();
    var t = indexSocketTarget;
    if (indexSocket || !t || t.panel.hidden || state.selectedCode !== 'INDEX:' + t.row.code) return;
    connectIndexSocket(t.panel, t.row);
  });

  function connectIndexSocket(panel, row) {
    if (!INDEX_WS_SYMBOLS[row.code]) return;
    indexSocketTarget = { panel: panel, row: row };          // 숨겨진 탭에서 열었어도 보이는 순간 이어 붙일 수 있게 먼저 기억한다
    if (indexSocket || !global.WebSocket || document.hidden) return;
    var gen = indexSocketGen;
    var socket;
    try { socket = new WebSocket(INDEX_WS_URL + '?symbols=' + encodeURIComponent(row.code)); } catch (e) { return; }
    indexSocket = socket;
    socket.onopen = function () { if (gen === indexSocketGen) indexSocketDelay = 1500; };
    socket.onmessage = function (event) {
      if (gen !== indexSocketGen || state.selectedCode !== 'INDEX:' + row.code || panel.hidden) return;
      var packet;
      try { packet = JSON.parse(event.data); } catch (e) { return; }
      if (!packet || packet.type !== 'market-indicators' || !Array.isArray(packet.data)) return;
      var quote = packet.data.filter(function (q) { return q && q.symbol === row.code && typeof q.price === 'number'; })[0];
      if (!quote) return;
      var quoteEl = panel.querySelector('.ss-index-quote');
      var noteEl = panel.querySelector('.ss-index-note');
      if (quoteEl) { quoteEl.innerHTML = Number(quote.price).toLocaleString('ko-KR') + ' <small>' + fmtSignedPct(quote.change_rate) + '</small>'; quoteEl.className = 'ss-index-quote ' + signClass(quote.change_rate); }
      if (noteEl) noteEl.textContent = '현물 지수 · 실시간 연결(5초) · ' + ((window.NineTime && window.NineTime.updated(quote.updated_at)) || ('갱신 ' + (quote.updated_at || '시각 미확인'))) + ' · 실제 분봉 원본 미제공';
      var last = indexBars.length ? indexBars[indexBars.length - 1] : null;
      var next = indexLiveBar(row.code, last, quote.price, kstToday());
      if (next && (next.close !== last.close || next.high !== last.high || next.low !== last.low)) {
        indexBars[indexBars.length - 1] = next;
        if (indexTimeframe === 'day' && indexSeries) { indexSeries.update({ time: next.date, open: next.open, high: next.high, low: next.low, close: next.close }); if (typeof indexStudyUpdate === 'function') indexStudyUpdate(); }
      }
    };
    socket.onerror = function () { /* onclose 에서 재연결 */ };
    socket.onclose = function () {
      if (gen !== indexSocketGen) return;
      indexSocket = null;
      if (state.selectedCode !== 'INDEX:' + row.code || panel.hidden) return;
      var delay = indexSocketDelay;
      indexSocketDelay = Math.min(30000, Math.round(indexSocketDelay * 1.8));
      indexSocketTimer = setTimeout(function () { indexSocketTimer = null; connectIndexSocket(panel, row); }, delay);
    };
  }

  function hideIndex(container) {
    var panel = container.querySelector('#ssIndexPanel');
    if (panel) panel.hidden = true;
    if (indexTimer) { clearInterval(indexTimer); indexTimer = null; }
    closeIndexSocket();
    indexRefreshNow = null;
    indexRenderId += 1;
    indexStudyUpdate = null;
    indexVolumeUpdate = null;
    indexStudySeries = [];
    clearIndexExtras();
    if (indexSrCleanup) { indexSrCleanup(); indexSrCleanup = null; }
    if (indexWaveHandle) { indexWaveHandle.detach(); indexWaveHandle = null; }
    if (indexDrawingCtl) { indexDrawingCtl.detach(); indexDrawingCtl = null; }
    if (indexOhlcTooltipCleanup) { indexOhlcTooltipCleanup(); indexOhlcTooltipCleanup = null; }
    if (indexWheelCleanup) { indexWheelCleanup(); indexWheelCleanup = null; }
    if (indexChart) { indexChart.remove(); indexChart = null; }
    indexSeries = null;
    indexBars = [];
  }

  function indexChartRows(rows) {
    return (rows || []).map(function (row) {
      var d = String(row.date || '');
      var time = d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) : d;
      return { date: time, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
        volume: Number(row.volume) > 0 ? Number(row.volume) : 0 };
    }).filter(function (row) { return /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0; });
  }

  // 코스피·코스닥만 KIS 영속 일봉 이력의 실제 거래량을 날짜로 합친다.
  // 단위는 공급자 응답 그대로다(미검증이라 단위 문구를 붙이지 않는다).
  function loadIndexVolume(symbol) {
    if (symbol !== 'KOSPI' && symbol !== 'KOSDAQ') return Promise.resolve(null);
    return fetchJson('https://goodbyestar.cloud/domestic-market-indicators/chart?market=' + encodeURIComponent(symbol) + '&interval=day&long=1')
      .then(function (payload) {
        var data = payload && (payload.data || payload);
        if (!data || data.source !== 'kis') throw new Error('KIS 지수 거래량 미수신');
        var map = {};
        ((data && data.rows) || []).forEach(function (r) {
          var d = String(r.date || '').replace(/-/g, '');
          if (/^\d{8}$/.test(d) && r.volume != null && isFinite(Number(r.volume)) && Number(r.volume) >= 0) map[d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6)] = Number(r.volume);
        });
        return {map: Object.keys(map).length ? map : null, meta: data.cache || {asOf: (data.rows || []).slice(-1)[0] && data.rows.slice(-1)[0].date}};
      });
  }
  // Independent per-index cache and shared pending requests. Empty backfill
  // responses retry at the server hint; failures keep the last map for 1 minute.
  var indexVolumeState = {};
  function ensureIndexVolume(symbol, onReady) {
    if (symbol !== 'KOSPI' && symbol !== 'KOSDAQ') return;
    var st = indexVolumeState[symbol] || (indexVolumeState[symbol] = {map:null, meta:{}, next:0, job:null});
    if (st.map) onReady(st.map, st.meta);
    if (!st.job && Date.now() >= st.next) {
      st.job = loadIndexVolume(symbol).then(function (result) {
        if (result.map) st.map = result.map;
        st.meta = result.meta;
        st.next = Date.now() + Math.max(1000, Number(st.meta.retryAfterMs) || 60000);
      }).catch(function () {
        st.meta = Object.assign({}, st.meta, {refreshing:false, usingLastValid:!!st.map, lastError:'거래량 조회 실패'});
        st.next = Date.now() + 60000;
      }).then(function () { st.job = null; });
    }
    if (st.job) return st.job.then(function () { onReady(st.map, st.meta); });
    return Promise.resolve(st.map);
  }
  function indexVolumeStatus(meta) {
    return 'KIS 거래량 · 원본 단위(미확정) · 기준일 ' + (meta.asOf || '확인 중')
      + (meta.usingLastValid ? ' · 마지막 유효 자료 사용' : '')
      + (meta.lastSuccessAt ? ' · 수집 ' + meta.lastSuccessAt : '')
      + (meta.lastError ? ' · 갱신 실패' + (meta.lastErrorAt ? ' ' + meta.lastErrorAt : '') : meta.refreshing ? ' · 백그라운드 갱신 중' : '');
  }
  function applyIndexVolume(bars, volumeMap) {
    if (!volumeMap) return bars;
    bars.forEach(function (bar) { if (Object.prototype.hasOwnProperty.call(volumeMap, bar.date)) bar.volume = volumeMap[bar.date]; });
    return bars;
  }

  function renderIndexChart(panel, symbol, resetView) {
    var previousIndexRange = !resetView && indexChart ? indexChart.timeScale().getVisibleLogicalRange() : null;
    var renderId = ++indexRenderId;
    indexStudyUpdate = null;
    indexVolumeUpdate = null;
    indexStudySeries = [];
    clearIndexExtras();
    if (indexSrCleanup) { indexSrCleanup(); indexSrCleanup = null; }
    if (indexWaveHandle) { indexWaveHandle.detach(); indexWaveHandle = null; }
    if (indexDrawingCtl) { indexDrawingCtl.detach(); indexDrawingCtl = null; }
    if (indexOhlcTooltipCleanup) { indexOhlcTooltipCleanup(); indexOhlcTooltipCleanup = null; }
    if (indexWheelCleanup) { indexWheelCleanup(); indexWheelCleanup = null; }
    if (indexChart) { indexChart.remove(); indexChart = null; }
    indexSeries = null;
    var host = panel.querySelector('#ssIndexChart');
    if (!host || !indexBars.length) return;
    // 구버전 CSS가 캐시에 남아도 그리기 캔버스의 기준점을 차트 안에 고정한다.
    host.style.position = 'relative';
    host.textContent = '차트를 불러오는 중...';
    chartReady().then(function (LWC) {
      var core = global.NineChartCore;
      return Promise.all([
        indexStudies.sr ? core.loadModule('sr') : Promise.resolve(),
        indexWaveState.enabled ? core.loadModule('wave') : Promise.resolve(),
        indexStudies.divergence ? core.loadModule('divergence') : Promise.resolve()
      ]).then(function () { return LWC; });
    }).then(function (LWC) {
      if (renderId !== indexRenderId || state.selectedCode !== 'INDEX:' + symbol || panel.hidden) return;
      var core = global.NineChartCore;
      var bars = global.NineChartData.barsForTimeframe(indexBars, indexTimeframe);
      var dark = document.documentElement.classList.contains('dark');
      syncIndexCapabilities(panel, bars);
      host.textContent = '';
      indexChart = LWC.createChart(host, { autoSize: true, height: 440,
        layout: { background: { color: dark ? '#202731' : '#ffffff' }, textColor: dark ? '#a6b5c5' : '#606b78', attributionLogo: false },
        // 기본 십자선(Magnet)은 가로줄이 봉 가격에 붙어 마우스를 따라가지 않는다. 종목 차트처럼 자유롭게 따라가게 한다.
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { borderVisible: false },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true } });
      indexWheelCleanup = global.NineChartCore.installSmoothWheelZoom(indexChart, host, { bars: bars.length });
      var series = indexChart.addSeries(LWC.CandlestickSeries, {
        upColor: '#d24f45', downColor: '#1261c4', borderVisible: false,
        wickUpColor: '#d24f45', wickDownColor: '#1261c4',
        priceLineStyle: LWC.LineStyle.Solid
      });
      indexSeries = series;
      series.setData(bars.map(function (bar) {
        return { time: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
      }));
      indexOhlcTooltipCleanup = installStockOhlcTooltip(host, indexChart, series, false);
      var volumePane = null, volLegend = null, volByTime = {}, volumeBars = bars;
      var volumeProfile = null, traceHolder = null;
      function clearTrace() {
        if (traceHolder) ['legendCleanup', 'tipCleanup', 'densityCleanup'].forEach(function (key) { if (traceHolder[key]) traceHolder[key](); });
        traceHolder = null;
      }
      function showVolume(value) {
        if (volLegend) volLegend.innerHTML = '<span class="ss-volume-current-label">거래량 <b>' + (value != null ? global.NineUI.number(value, {round:true}) : '-') + '</b></span>';
      }
      function crosshairVolume(param) {
        showVolume(param && param.time && volByTime[param.time] != null ? volByTime[param.time] : volumeBars[volumeBars.length-1].volume);
      }
      indexExtraCleanup.push(function () {
        clearTrace();
        if (volumePane && volumePane.destroy) volumePane.destroy();
        if (volLegend) { indexChart.unsubscribeCrosshairMove(crosshairVolume); volLegend.remove(); }
      });
      indexVolumeUpdate = function () {
        if (renderId !== indexRenderId || !indexChart || state.selectedCode !== 'INDEX:' + symbol) return;
        var current = global.NineChartData.barsForTimeframe(indexBars, indexTimeframe);
        syncIndexCapabilities(panel, current);
        if (!current.some(function (bar) { return bar.volume > 0; })) return;
        var range = indexChart.timeScale().getVisibleLogicalRange();
        volumeBars = current;
        try {
          if (!volumePane) {
            // RSI may already own pane 1. Insert a volume pane without replacing
            // the candle series, drawings, indicators or crosshair subscriptions.
            if (indexChart.panes().length > 1) indexChart.addPane().moveTo(1);
            volumePane = core.addVolumePane(indexChart, LWC, current, {
              pane:1, scaleId:'volume', ma5:true, multiples:indexStudies.volmult,
              scaleOptions:{drawTicks:false,ticksVisible:false,borderVisible:false,scaleMargins:{top:0.15,bottom:0}}
            });
            volLegend = document.createElement('div');
            volLegend.className = 'ss-volume-study-label';
            host.appendChild(volLegend);
            indexChart.subscribeCrosshairMove(crosshairVolume);
          } else volumePane.updateData(current);
          var sizes = sizeStockChartPanes(indexChart.panes(), 440, false);
          volLegend.style.top = (sizes.mainHeight + 6) + 'px';
          volByTime = {};
          current.forEach(function (bar) { volByTime[bar.date] = bar.volume; });
          showVolume(current[current.length-1].volume);
          if (volumeProfile) { series.detachPrimitive(volumeProfile); volumeProfile = null; }
          if (indexStudies.vp && indexVolumeAvailable(current)) {
            volumeProfile = createVolumeProfilePrimitive(current, false, 'INDEX:' + symbol, host, indexTimeframe, {index:true});
            series.attachPrimitive(volumeProfile);
          }
          clearTrace();
          if (indexStudies.trace && indexVolumeAvailable(current)) {
            traceHolder = {chart:indexChart,container:host,supplyMode:'detail',timeframe:indexTimeframe};
            core.setSupplyTraceMarkers(LWC, series, current, true, traceHolder);
          }
          if (range) indexChart.timeScale().setVisibleLogicalRange(range);
        } catch (volumeError) { /* Keep the existing price chart on pane errors. */ }
      };
      indexVolumeUpdate();
      if (indexStudies.rsi || indexStudies.divergence) {
        var rsiValues = stockRsi(bars);
        var rsi = indexChart.addSeries(LWC.LineSeries, { color: dark ? '#f1f4f8' : '#333333', lineWidth: 2, lastValueVisible: false, priceLineVisible: false }, volumePane ? 2 : 1);
        rsi.setData(bars.map(function (bar, i) { return rsiValues[i] == null ? null : { time: bar.date, value: rsiValues[i] }; }).filter(Boolean));
        [30, 50, 70].forEach(function (value) { rsi.createPriceLine({ price: value, color: '#9ca3af', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false }); });
        sizeStockChartPanes(indexChart.panes(), 440, false);
        if (indexStudies.divergence && global.NineChartDivergence && global.NineChartWave) {
          var analysis = global.NineChartWave.analysis(bars, 'INDEX:' + symbol, indexTimeframe);
          var list = global.NineChartDivergence.find(bars, rsiValues, analysis, indexWaveState.level || 'medium');
          indexExtraCleanup.push(global.NineChartDivergence.install({ container: host, chart: indexChart, candleSeries: series, rsiSeries: rsi, panes: indexChart.panes(), bars: bars, list: list }));
        }
      }
      indexChart.timeScale().fitContent();
      var Drawing = global.NineChartDrawing;
      if (Drawing) indexDrawingCtl = Drawing.attach({
        core: global.NineChartCore, container: host, chart: indexChart, series: series,
        // 예전 캔버스 배치에서 저장된 잘못된 좌표를 다시 그리지 않는다.
        bars: bars, key: 'INDEX_V2_' + symbol, timeframe: indexTimeframe,
        className: 'ss-drawing-layer', ariaLabel: '지수 차트 그리기 영역',
        bounds: 'container', point: 'anchored', tools: ['line', 'pencil', 'circle', 'box', 'hline', 'measure'],
        buttons: stockDrawingButtons(host), store: STOCK_DRAWING_STORE,
        style: { stroke: '#e11d48', dots: true, previewDash: true }, sync: false
      });
      var initializingIndexStudies = true;
      indexStudyUpdate = function () {
        if (renderId !== indexRenderId) return;
        if (!initializingIndexStudies && (indexStudies.rsi || indexStudies.divergence || indexStudies.vp || indexStudies.trace || indexStudies.volmult)) { renderIndexChart(panel, symbol); return; }
        var core = global.NineChartCore;
        var currentBars = global.NineChartData.barsForTimeframe(indexBars, indexTimeframe);
        indexStudySeries.forEach(function (line) { indexChart.removeSeries(line); });
        indexStudySeries = [];
        var indexMaGroups = [];
        if (indexStudies.maShort) indexMaGroups.push('short');
        if (indexStudies.maLong) indexMaGroups.push('long');
        if (indexMaGroups.length) core.maStudies(dark, indexMaGroups).forEach(function (study) {
          var maPoints = core.movingAveragePoints(currentBars, 'close', study.period);
          if (!maPoints.length) return;   // 봉이 모자라 계산할 수 없는 선(예: 448일)은 그리지 않는다
          indexStudySeries.push(core.addMovingAverageLine(indexChart, LWC, study, maPoints));
        });
        if (indexStudies.bollinger) indexStudySeries = indexStudySeries.concat(core.addBollingerBands(indexChart, LWC, currentBars));
        if (indexStudies.cloud) {
          var cloud = core.ichimokuCloudPoints(currentBars, indexTimeframe);
          ['spanA', 'spanB'].forEach(function (key) {
            var line = indexChart.addSeries(LWC.LineSeries, { color: '#939ca8', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
            line.setData(cloud.map(function (point) { return { time: point.time, value: point[key] }; }));
            indexStudySeries.push(line);
          });
          if (indexStudySeries.length && cloud.length) indexStudySeries[indexStudySeries.length - 1].attachPrimitive(core.createCloudPrimitive(cloud.map(function (point) { return { time: point.time, a: point.spanA, b: point.spanB }; }), 'rgba(147,156,168,0.15)'));
        }
        if (indexStudies.sr && global.NineChartSR) {
          var result = global.NineChartSR.levels(currentBars, null, { timeframe: indexTimeframe });
          if (indexSrCleanup) indexSrCleanup.update(result);
          else indexSrCleanup = global.NineChartSR.install(host, indexChart, series, result, function (price) { return Number(price).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); });
        }
        if (indexDrawingCtl) indexDrawingCtl.shapes.bars = currentBars;
        if (indexWaveState.enabled && indexDrawingCtl && global.NineChartWave) {
          if (indexWaveHandle) indexWaveHandle.detach();
          indexWaveHandle = global.NineChartWave.attach({ core: core, ctl: indexDrawingCtl, key: 'INDEX:' + symbol, timeframe: indexTimeframe, bars: currentBars, state: indexWaveState, font: 'MaruBuri, serif' });
          indexWaveHandle.apply();
        }
      };
      indexStudyUpdate();
      initializingIndexStudies = false;
      if (previousIndexRange) indexChart.timeScale().setVisibleLogicalRange(previousIndexRange);
      else if (indexRangeDays) {
        var end = new Date(bars[bars.length - 1].date + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() - indexRangeDays);
        indexChart.timeScale().setVisibleRange({ from: [end.toISOString().slice(0, 10), bars[0].date].sort()[1], to: bars[bars.length - 1].date });
      } else indexChart.timeScale().fitContent();
    }).catch(function () { if (renderId === indexRenderId) host.textContent = '차트를 불러오지 못했습니다.'; });
  }

  function openIndex(container, row) {
    stockSearchRequestId += 1;
    var indexOpenId = stockSearchRequestId;
    hideIndex(container);
    setMarketMode(container, false);
    var panel = container.querySelector('#ssIndexPanel');
    container.querySelector('#ssResults').hidden = true;
    var overview = container.querySelector('#ssOverview');
    if (overview) overview.hidden = true;
    container.querySelector('#ssDetail').hidden = true;
    panel.hidden = false;
    panel.innerHTML = '<div class="ss-hint">지수 시세와 차트를 불러오는 중...</div>';
    state.selectedCode = 'INDEX:' + row.code;
    state.selectedName = row.name;
    indexTimeframe = 'day';
    indexRangeDays = 0;
    try {
      var url = new URL(location.href);
      url.searchParams.set('code', 'INDEX:' + row.code);
      url.searchParams.set('name', row.name);
      url.searchParams.delete('market');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* URL 갱신 실패는 검색 결과와 무관 */ }
    var volumeRetry = null;
    function refreshVolume() {
      if (indexOpenId !== stockSearchRequestId || state.selectedCode !== 'INDEX:' + row.code || panel.hidden || document.hidden) return;
      ensureIndexVolume(row.code, function (map, meta) {
        if (indexOpenId !== stockSearchRequestId || state.selectedCode !== 'INDEX:' + row.code || panel.hidden) return;
        var status = panel.querySelector('[data-index-volume-status]');
        if (status) status.textContent = indexVolumeStatus(meta);
        if (map && indexBars.length) {
          applyIndexVolume(indexBars, map);
          if (indexVolumeUpdate) indexVolumeUpdate();
        }
        if (meta.refreshing && !volumeRetry) volumeRetry = setTimeout(function () {
          volumeRetry = null;
          if (indexOpenId === stockSearchRequestId && state.selectedCode === 'INDEX:' + row.code && !panel.hidden && !document.hidden) refreshVolume();
        }, 2000);
      });
    }
    function refresh() {
      if (indexOpenId !== stockSearchRequestId || state.selectedCode !== 'INDEX:' + row.code || panel.hidden || document.hidden) return;
      refreshVolume();
      Promise.all([
        fetchJson('https://goodbyestar.cloud/futures?symbols=' + encodeURIComponent(row.code) + '&days=500'),
        loadIndexHistory(row.code).catch(function () { return null; })
      ]).then(function (results) {
          var body = results[0], history = results[1];
          var volumeMap = indexVolumeState[row.code] && indexVolumeState[row.code].map;
          if (indexOpenId !== stockSearchRequestId || state.selectedCode !== 'INDEX:' + row.code || panel.hidden) return;
          var item = (Array.isArray(body) ? body : (body && body.data) || []).filter(function (it) { return it.symbol === row.code; })[0];
          if (!item) throw new Error('index missing');
          var bars = applyIndexVolume(indexChartRows(indexThreeYearRows(row.code, item.chart, history)), volumeMap);
          if (panel.querySelector('.ss-index-heading')) {
            var quote = panel.querySelector('.ss-index-quote');
            var note = panel.querySelector('.ss-index-note');
            if (quote) quote.innerHTML = (item.price == null ? '시세 없음' : Number(item.price).toLocaleString('ko-KR')) + ' <small>' + fmtSignedPct(item.change_rate) + '</small>';
            if (quote) quote.className = 'ss-index-quote ' + signClass(item.change_rate);
            if (note) note.textContent = '현물 지수 · ' + (indexSocket && indexSocket.readyState === 1 ? '실시간 연결(5초) · ' : '') + ((window.NineTime && window.NineTime.updated(item.updated_at)) || ('갱신 ' + (item.updated_at || '시각 미확인'))) + ' · 실제 분봉 원본 미제공';
            if (bars.length) {
              var latest = bars[bars.length - 1];
              var old = indexBars[indexBars.length - 1];
              if (!old || latest.date !== old.date) {
                indexBars = bars;
                renderIndexChart(panel, row.code);
              } else if (latest.open !== old.open || latest.high !== old.high || latest.low !== old.low || latest.close !== old.close) {
                indexBars = bars;
                if (indexTimeframe === 'day' && indexSeries) {
                  indexSeries.update({ time: latest.date, open: latest.open, high: latest.high, low: latest.low, close: latest.close });
                  if (typeof indexStudyUpdate === 'function') indexStudyUpdate();
                } else {
                  renderIndexChart(panel, row.code);
                }
              }
            }
            return;
          }
          panel.innerHTML = '<div class="ss-index-heading"><strong>' + escapeHtml(row.name) + '</strong><span>' + escapeHtml(row.code) + '</span></div>'
            + '<div class="ss-index-quote ' + signClass(item.change_rate) + '">' + (item.price == null ? '시세 없음' : Number(item.price).toLocaleString('ko-KR'))
            + ' <small>' + fmtSignedPct(item.change_rate) + '</small></div>'
            + '<div class="ss-index-note">현물 지수 · ' + escapeHtml((window.NineTime && window.NineTime.updated(item.updated_at)) || ('갱신 ' + (item.updated_at || '시각 미확인'))) + ' · 실제 분봉 원본 미제공</div>'
            // Compact index toolbar; small controls and a comfortably wide wave selector.
            + '<div class="ss-index-note" data-index-volume-status></div>'
            + '<div class="ss-index-controls ss-stock-controls" role="group" aria-label="지수 차트 설정">'
            + '<div class="ss-index-tools ss-chart-tabs">'
            + '<div class="ss-timeframe-tools">'
            + '<button type="button" class="active" data-index-tf="day">일봉</button>'
            + '<button type="button" data-index-tf="week">주봉</button>'
            + '<button type="button" data-index-tf="month">월봉</button>'
            + '<button type="button" disabled title="이 지수의 실제 분봉 원본이 없습니다">분봉</button>'
            + '</div><div class="ss-drawing-tools">'
            + '<button type="button" class="ss-draw-toggle">직선</button>'
            + '<button type="button" class="ss-circle-toggle">동그라미</button>'
            + '<button type="button" class="ss-box-toggle">박스</button>'
            + '<button type="button" class="ss-hline-toggle">가로선</button>'
            + '<button type="button" class="ss-measure-toggle" title="고점에서 저점까지 끌면 변화율(%)을 보여 줍니다">측정</button>'
            + '<button type="button" class="ss-pencil-toggle">연필</button>'
            + '<button type="button" class="ss-draw-clear">지우기</button></div></div>'
            + '<div class="nine-chart-ranges">' + [[30, '1개월'], [90, '3개월'], [180, '6개월'], [365, '1년'], [1095, '3년'], [0, '전체']].map(function (range) { return '<button type="button" class="nine-range-btn" data-index-range="' + range[0] + '">' + range[1] + '</button>'; }).join('') + '</div>'
            + '<div class="ss-chart-studies ss-index-studies" role="group" aria-label="차트 보조지표">'
            + [['maShort', '단기 이평선(3·5·20·60)'], ['maLong', '장기 이평선(112·224·448)'], ['cloud', '일목균형표(구름) 표시'], ['bollinger', '볼린저 밴드'], ['sr', '지지·저항 표시']].map(function (option) {
              return '<label><input type="checkbox" data-index-study="' + option[0] + '"' + (indexStudies[option[0]] ? ' checked' : '') + ' /> ' + option[1] + '</label>';
            }).join('')
            + '<span class="ss-index-wave-group"><label><input type="checkbox" data-index-study="wave"' + (indexWaveState.enabled ? ' checked' : '') + ' /> 파동 분석</label>'
            + '<select data-index-wave-level aria-label="파동 규모"><option value="major">대파동</option><option value="medium">중파동</option><option value="minor">소파동</option></select>'
            + '<label title="선택한 규모의 상승·하락 파동 박스 안에 한 단계 아래 규모의 고점·저점을 이은 선을 긋습니다"><input type="checkbox" data-index-wave-trend' + (indexWaveState.trend ? ' checked' : '') + ' /> 추세선</label></span>'
            + '<label><input type="checkbox" data-index-study="rsi"' + (indexStudies.rsi ? ' checked' : '') + ' /> RSI</label>'
            + '<label><input type="checkbox" data-index-study="divergence"' + (indexStudies.divergence ? ' checked' : '') + ' /> RSI 다이버전스</label>'
            + [['volmult', '거래량 배수 표시'], ['vp', '매물대 표시'], ['trace', '거래량·가격 흔적']].map(function (option) {
              return '<label><input type="checkbox" data-index-volume data-index-study="' + option[0] + '"' + (indexStudies[option[0]] ? ' checked' : '') + ' /> ' + option[1] + '</label>';
            }).join('') + '</div>'
            + '</div>'
            + '<div class="ss-index-chart" id="ssIndexChart"></div>';
          syncIndexCapabilities(panel, bars);
          panel.querySelectorAll('[data-index-study]').forEach(function (input) {
            input.addEventListener('change', function () {
              var key = input.getAttribute('data-index-study');
              if (key === 'wave') indexWaveState.enabled = input.checked;
              else indexStudies[key] = input.checked;
              if (key === 'divergence' && input.checked) indexStudies.rsi = true;
              if (key === 'rsi' && !input.checked) indexStudies.divergence = false;
              panel.querySelectorAll('[data-index-study]').forEach(function (control) { var name = control.getAttribute('data-index-study'); control.checked = name === 'wave' ? indexWaveState.enabled : !!indexStudies[name]; });
              renderIndexChart(panel, row.code);
            });
          });
          panel.querySelectorAll('[data-index-range]').forEach(function (button) {
            button.addEventListener('click', function () {
              indexRangeDays = Number(button.getAttribute('data-index-range'));
              if (!indexChart || !indexBars.length) return;
              if (!indexRangeDays) indexChart.timeScale().fitContent();
              else { var last = indexBars[indexBars.length - 1].date, start = new Date(last + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - indexRangeDays); indexChart.timeScale().setVisibleRange({ from: [start.toISOString().slice(0, 10), indexBars[0].date].sort()[1], to: last }); }
              panel.querySelectorAll('[data-index-range]').forEach(function (control) { control.classList.toggle('active', control === button); control.setAttribute('aria-pressed', control === button ? 'true' : 'false'); });
            });
          });
          var waveLevel = panel.querySelector('[data-index-wave-level]');
          waveLevel.value = indexWaveState.level;
          waveLevel.addEventListener('change', function () { indexWaveState.level = waveLevel.value; if (indexWaveState.enabled) renderIndexChart(panel, row.code); });
          var waveTrend = panel.querySelector('[data-index-wave-trend]');
          if (waveTrend) waveTrend.addEventListener('change', function () { indexWaveState.trend = waveTrend.checked; if (indexWaveState.enabled) renderIndexChart(panel, row.code); });
          panel.querySelectorAll('[data-index-tf]').forEach(function (button) {
            button.addEventListener('click', function () {
              indexTimeframe = button.getAttribute('data-index-tf');
              panel.querySelectorAll('[data-index-tf]').forEach(function (b) { b.classList.toggle('active', b === button); });
              renderIndexChart(panel, row.code, true);
            });
          });
          indexBars = bars;
          var volumeState = indexVolumeState[row.code];
          if (volumeState) { var status = panel.querySelector('[data-index-volume-status]'); if (status) status.textContent = indexVolumeStatus(volumeState.meta); }
          if (bars.length) renderIndexChart(panel, row.code);
          else panel.querySelector('#ssIndexChart').textContent = '차트 이력이 없습니다.';
        }).catch(function () { if (indexOpenId === stockSearchRequestId && state.selectedCode === 'INDEX:' + row.code) panel.innerHTML = '<div class="ss-hint ss-error">지수 데이터를 불러오지 못했습니다.</div>'; });
    }
    indexRefreshNow = refresh;
    refresh();
    indexTimer = setInterval(refresh, 30000);
    connectIndexSocket(panel, row);
  }

  function runDomesticSearch(container, query, searchId) {
    var resultsBox = container.querySelector('#ssResults');

    var map = applyDomesticListingFallbacks();
    var names;
    // 6자리 코드로 직접 입력한 경우 코드로도 매칭(watchlist.js 등과 동일한 관례)
    if (/^[0-9A-Za-z]{6}$/.test(query)) {
      names = Object.keys(map).filter(function (n) { return map[n].toUpperCase() === query.toUpperCase(); });
    } else {
      names = matchNames(query, MAX_RESULTS);
    }

    if (!names.length) {
      resultsBox.innerHTML = '<div class="ss-hint ss-error">"' + escapeHtml(query) + '" 에 해당하는 종목을 찾을 수 없어요.</div>';
      return;
    }

    resultsBox.innerHTML = '<div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>시세를 불러오는 중...</div>';

    var items = names.map(function (name) { return { name: name, code: map[name] }; });
    var codes = items.map(function (it) { return it.code; });

    global.NineAPI.domesticQuotes(codes, {request:fetchJson})
      .then(function (response) {
        var quotes = response && response.data ? response.data : response;
        if (searchId !== stockSearchRequestId) return;
        var byCode = {};
        (quotes || []).forEach(function (q) { byCode[q.code] = q; });
        items.forEach(function (it) {
          var q = byCode[it.code];
          it.price = q ? q.price : null;
          it.change = q ? q.change : null;
          it.changeRate = q ? q.changeRate : null;
          it.volume = q ? q.volume : null;
          it.tradingValue = (it.price != null && it.volume != null) ? it.price * it.volume : null;
          it.sectors = lookupSectors(it.code);
        });
        state.lastResults = items;
        state.resultsCollapsed = false;
        renderResults(container, items);
      })
      .catch(function () {
        if (searchId !== stockSearchRequestId) return;
        // A newly listed stock can be known before the quote provider publishes its first tick.
        // Preserve an explicit no-price state and let the user open orderbook/minute chart.
        var listingPending = items.some(function (it) {
          return DOMESTIC_LISTING_FALLBACKS.some(function (row) { return row.code === it.code; });
        });
        if (!listingPending) {
          resultsBox.innerHTML = '<div class="ss-hint ss-error">시세를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
          return;
        }
        items.forEach(function (it) {
          it.price = null; it.change = null; it.changeRate = null;
          it.volume = null; it.tradingValue = null; it.sectors = lookupSectors(it.code);
        });
        state.lastResults = items;
        state.resultsCollapsed = false;
        renderResults(container, items);
        if (!isIndependentChartMode()) {
          var notice = document.createElement('p');
          notice.className = 'ss-hint ss-error';
          notice.textContent = '신규상장 종목의 시세가 아직 수신되지 않았습니다. 종목 화면은 열 수 있지만 가격 정보는 미제공입니다.';
          resultsBox.insertBefore(notice, resultsBox.firstChild);
        }
      });
  }

  function fetchUsSearch(query) {
    var localRows = LOCAL_US_SYMBOLS.filter(function (row) {
      return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(String(query || '').toLowerCase()) !== -1;
    }).slice(0, 8).map(function (row) {
      return { code: 'US:' + row.symbol, name: row.name, market: 'us' };
    });
    if (localRows.length) return Promise.resolve(localRows);
    var request = typeof global.fetch === 'function'
      ? global.fetch(US_API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=8')
      : Promise.reject(new Error('fetch unavailable'));
    return request
      .then(function (response) {
        if (!response.ok) throw new Error('미국주식 검색 오류: ' + response.status);
        return response.json();
      })
      .then(function (body) {
        var rows = (body && body.data ? body.data : []).map(function (row) {
          var code = row.code || ('US:' + row.symbol);
          return { code: code, name: localizedUsName(code, row.name || row.symbol), market: 'us' };
        });
        if (!rows.length) throw new Error('미국주식 검색 결과 없음');
        var seen = {};
        return localRows.concat(rows).filter(function (row) {
          var key = String(row.code || '').toUpperCase();
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }).slice(0, 8);
      })
      .catch(function () {
        return localRows;
      });
  }

  // 종목이 속한 섹터(data/sectors-v3.js) 조회 - 없으면(SECTOR_MAP 미로드 등) 빈 배열
  function lookupSectors(code) {
    var map = global.SECTOR_MAP;
    if (!map || !code) return [];
    var out = [];
    for (var sector in map) {
      if (!map.hasOwnProperty(sector)) continue;
      if (map[sector].some(function (s) { return s.code === code; })) out.push(sector);
    }
    return out;
  }

  // Search results remain in the same card as selected-stock details.
  // For long lists collapse stays an explicit user action.
  function renderResults(container, items, userExpanded) {
    var resultsBox = container.querySelector('#ssResults');
    var overview = container.querySelector('#ssOverview');

    if (isIndependentChartMode() && items.length) {
      state.lastResults = items;
      resultsBox.hidden = true;
      selectStock(container, items[0]);
      return;
    }

    if (overview && items.length) overview.classList.add('ss-overview-active');
    if (state.resultsCollapsed) {
      // The selected stock's name/price live in the detailed summary below.
      // Keep only a small results navigation control instead of a duplicate stock header.
      resultsBox.innerHTML = '<div class="ss-results-collapsed">'
        + '<span>검색 결과 ' + items.length + '건</span>'
        + '<button type="button" class="ss-results-toggle" data-action="expand">목록 다시 보기 ▾</button>'
        + '</div>';
      var expandBtn = resultsBox.querySelector('.ss-results-toggle');
      if (expandBtn) expandBtn.addEventListener('click', function () {
        state.resultsCollapsed = false;
        renderResults(container, items, true);
      });
      syncOverviewSelection(container);
      return;
    }

    resultsBox.innerHTML = '<div class="ss-results-count">검색 결과 ' + items.length + '건'
      + (items.length > 1 ? '<button type="button" class="ss-results-toggle" data-action="collapse">목록 접기 ▴</button>' : '')
      + '</div>'
      + '<div class="ss-results-table">'
      + '<div class="ss-results-head">'
      + '<span>종목</span><span>현재가</span><span>등락률</span><span>거래량</span><span>거래대금</span><span>업종</span><span>관심</span>'
      + '</div>'
      + items.map(function (it, idx) { return resultRowHtml(it, idx); }).join('')
      + '</div>';

    var collapseBtn = resultsBox.querySelector('.ss-results-toggle');
    if (collapseBtn) collapseBtn.addEventListener('click', function () {
      state.resultsCollapsed = true;
      renderResults(container, items);
    });

    resultsBox.querySelectorAll('.ss-result-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var idx = Number(row.getAttribute('data-idx'));
        selectStock(container, items[idx]);
        resultsBox.querySelectorAll('.ss-result-row').forEach(function (r) { r.classList.remove('active'); });
        row.classList.add('active');
        // Keep the selected row visible; collapse is an explicit user action.
        syncOverviewSelection(container);
      });
    });

    // 2026-07-27: "9Pay 증권" 개편 작업지시서 #11 - 검색 결과의 ⭐ 버튼으로 관심종목(MY)에
    // 바로 등록. js/watchlist.js가 이 페이지에 없으면(로드 순서 누락 등) 버튼을 눌러도
    // 조용히 무시되게 존재 체크만 하고 에러는 안 던진다.
    resultsBox.querySelectorAll('.ss-fav-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!global.Watchlist) return;
        var code = btn.getAttribute('data-code');
        var name = btn.getAttribute('data-name');
        if (global.Watchlist.has(code)) {
          global.Watchlist.remove(code);
          btn.classList.remove('active');
        } else {
          var result = global.Watchlist.add(code, name);
          if (result.ok) btn.classList.add('active');
          else if (result.reason === 'login') alert('로그인 후 관심종목을 저장할 수 있습니다.');
          else if (result.reason === 'full') alert('관심종목은 최대 ' + global.Watchlist.MAX_ITEMS + '개까지 담을 수 있습니다.');
        }
      });
    });

    // One result: show the complete table row and OHLC/AI/analysis together.
    if (items.length === 1) {
      selectStock(container, items[0]);
      var onlyRow = resultsBox.querySelector('.ss-result-row');
      if (onlyRow) onlyRow.classList.add('active');
    }
    syncOverviewSelection(container);
  }

  function syncOverviewSelection(container) {
    var overview = container.querySelector('#ssOverview');
    var resultsBox = container.querySelector('#ssResults');
    if (!overview || !resultsBox) return;
    var index = (state.lastResults || []).findIndex(function (item) {
      return item.code === state.selectedCode;
    });
    var visible = !state.resultsCollapsed && !resultsBox.hidden && index >= 0
      && !!resultsBox.querySelector('.ss-result-row[data-idx="' + index + '"]');
    // Show the name/price/change in the table only while its row is visible.
    // When a long list is manually collapsed, the summary restores them.
    overview.classList.toggle('ss-overview-selected', !!visible);
  }

  function resultRowHtml(it, idx) {
    var cls = signClass(it.changeRate);
    var sectorHtml = it.sectors.length
      ? it.sectors.slice(0, 2).map(function (s) { return '<span class="ss-sector-tag">' + escapeHtml(s) + '</span>'; }).join('')
      : '<span class="ss-sector-tag ss-sector-tag-empty">-</span>';
    var isFav = !!(global.Watchlist && global.Watchlist.has(it.code));
    return '<div class="ss-result-row" data-idx="' + idx + '">'
      + '<span class="ss-result-name">' + stockIconHtml(it.code) + '<span>' + escapeHtml(it.name) + '</span><span class="ss-result-code">' + escapeHtml(it.code) + '</span></span>'
      + '<span class="' + cls + '">' + fmtPrice(it.price) + '</span>'
      + '<span class="' + cls + '">' + fmtSignedPct(it.changeRate) + '</span>'
      + '<span>' + fmtQty(it.volume) + '</span>'
      + '<span>' + fmtEok(it.tradingValue) + '</span>'
      + '<span class="ss-result-sectors">' + sectorHtml + '</span>'
      + '<span><button type="button" class="ss-fav-btn' + (isFav ? ' active' : '') + '" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '" title="관심종목에 추가/제거" aria-label="관심종목 토글">★</button></span>'
      + '</div>';
  }

  // ---- 선택 종목: 요약 + 호가창(재사용) + 차트 ----

  function selectStock(container, item) {
    stockSearchRequestId += 1;
    setMarketMode(container, false);
    hideIndex(container);
    if (isUsRoute()) {
      try {
        var url = new URL(location.href);
        url.searchParams.delete('market');
        url.searchParams.set('code', item.code);
        url.searchParams.set('name', item.name);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (err) { /* Keep the current page usable when history is unavailable. */ }
    }
    state.selectedCode = item.code;
    state.selectedName = item.name;
    delete state.liveQuotes[item.code];
    document.dispatchEvent(new CustomEvent('nine-stock-selection', { detail: {
      code: item.code, name: item.name, price: item.price, changeRate: item.changeRate
    } }));
    state.minuteScope = '1';
    state.externalMinuteLoader = null;
    var chartNotice = container.querySelector('#ssChartNotice');
    if (chartNotice) chartNotice.hidden = true;

    var detail = container.querySelector('#ssDetail');
    detail.hidden = false;
    // 초기 바인딩 시 상세 패널이 hidden이라 폭을 읽을 수 없으므로, 표시한 뒤
    // aria 범위와 키보드 End 위치를 실제 데스크톱 폭으로 다시 계산한다.
    wirePanelResize(container);

    if (!isIndependentChartMode()) {
      var summaryBox = container.querySelector('#ssSummary');
      var overview = container.querySelector('#ssOverview');
      if (overview) {
        overview.hidden = false;
        overview.classList.add('ss-overview-active');
      }
      if (summaryBox) summaryBox.hidden = false;
      renderSummary(container, item);
      renderSessionCandle(container, {});
      syncOverviewSelection(container);
    }

    var ladderBox = container.querySelector('#order-book');
    if (!state.ladderMounted && global.OrderBook && ladderBox) {
      global.OrderBook.init('#order-book', {
        hideSearch: true,
        quoteOnly: isIndependentChartMode(),
        onQuote: function (quote) { applyRealtimeQuote(container, quote); },
        onSummary: function (summary,code) { if(code===state.selectedCode)renderSessionCandle(container,summary); }
      });
      state.ladderMounted = true;
    }
    if (global.OrderBook && ladderBox) global.OrderBook.select(ladderBox, item.code, item.name);

    loadChart(container, item.code);
    if (!isIndependentChartMode()) loadDomesticNews(container, item);
    wireChartTabs(container);
  }

  function renderSummary(container, item) {
    var box = container.querySelector('#ssSummary');
    var cls = signClass(item.changeRate);
    box.innerHTML = ''
      + '<div class="ss-summary-head">'
      + stockIconHtml(item.code)
      + '<span class="ss-summary-name">' + escapeHtml(item.name) + '</span>'
      + '<span class="ss-summary-code">(' + escapeHtml(item.code) + ')</span>'
      + '<span class="ss-summary-price ' + cls + '">' + fmtPrice(item.price) + '원</span>'
      + '<span class="ss-summary-change ' + cls + '">' + fmtSignedPct(item.changeRate) + '</span>'
      + '<a class="ss-analysis-link" href="/page/foreign-flow?code=' + encodeURIComponent(item.code)
      + '&amp;name=' + encodeURIComponent(item.name) + '">종목분석</a>'
      + '</div>';
  }

  // 같은 호가 자료로 상단 현재가를 맞추고, 호가 패널 위에 시가·고가·저가를 표시한다.
  function renderSessionCandle(container,summary) {
    var box=container.querySelector('#ssSessionCandle');if(!box)return;
    var c=Number(summary.current);
    var price=container.querySelector('.ss-summary-price'),rate=container.querySelector('.ss-summary-change');
    if(price && c>0)price.textContent=fmtPrice(c)+'원';
    if(summary.changeRate!=null){var tone=signClass(summary.changeRate);if(price)price.className='ss-summary-price '+tone;if(rate){rate.textContent=fmtSignedPct(summary.changeRate);rate.className='ss-summary-change '+tone;}}
    var labels=[['시가',summary.open],['고가',summary.high],['저가',summary.low]];
    var values='<div class="ss-session-values">'+labels.map(function(item){var tone=item[0]==='고가'?' class="ss-session-high"':item[0]==='저가'?' class="ss-session-low"':'';return '<div><span>'+item[0]+'</span><b'+tone+'>'+(item[1]>0?fmtPrice(item[1]):'—')+'</b></div>';}).join('')+'</div>';
    box.title=(summary.date || '')+' 일봉 기준';
    box.innerHTML=values;
  }

  // ---- 실시간 체결가 ----
  // 2026-08-05(2차) 사용자 리포트: 상단 요약(27,250원)과 호가창(27,350원)이 서로 다른
  // 가격을 보여줬다 - 처음엔 order-book.js와 별개로 이 파일에서도 wss://.../ws/quotes
  // 소켓을 하나 더 열었는데, 같은 코드에 소켓이 2개 뜨면 두 소켓의 수신 타이밍이 미묘하게
  // 어긋나 서로 다른 시점의 값이 잠깐씩 보였다. 소켓은 order-book.js(#order-book 위젯)
  // 하나만 열고, 그 위젯이 이미 갱신에 성공한 값을 콜백(opts.onQuote, selectStock 참고)으로
  // 그대로 받아써서 항상 같은 값을 보여주게 했다.
  function parseDomesticNewsDate(value) {
    var raw = String(value || '').trim();
    if (/^\d{8}$/.test(raw)) {
      return new Date(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
    }
    return new Date(raw);
  }

  function domesticNewsTimestamp(item) {
    var date = parseDomesticNewsDate(item && item.pubDate);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function domesticNewsWithin24Hours(item) {
    var raw = String(item && item.pubDate || '').trim();
    var now = new Date();
    if (/^\d{8}$/.test(raw)) {
      // DART provides a date without a time, so retain today and the previous
      // KST calendar date rather than dropping a valid overnight disclosure.
      var currentDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(now);
      var publishedDate = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
      var previousDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      var previousKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(previousDate);
      return publishedDate === currentDate || publishedDate === previousKey;
    }
    var timestamp = domesticNewsTimestamp(item);
    return timestamp > 0 && timestamp <= now.getTime() + 5 * 60 * 1000
      && now.getTime() - timestamp <= 24 * 60 * 60 * 1000;
  }

  function domesticNewsBucket(value) {
    var date = parseDomesticNewsDate(value);
    if (isNaN(date.getTime())) return 'night';
    var hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false
    }).format(date));
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    return 'night';
  }

  function domesticNewsTime(value) {
    var raw = String(value || '').trim();
    if (/^\d{8}$/.test(raw)) return raw.slice(4, 6) + '.' + raw.slice(6, 8);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(5, 7) + '.' + raw.slice(8, 10);
    var date = parseDomesticNewsDate(value);
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
      });
    }
    return '--:--';
  }

  function domesticNewsDate(value) {
    var date = parseDomesticNewsDate(value);
    if (isNaN(date.getTime())) return '';
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).formatToParts(date);
    var month = (parts.find(function (part) { return part.type === 'month'; }) || {}).value || '';
    var day = (parts.find(function (part) { return part.type === 'day'; }) || {}).value || '';
    return month + '/' + day;
  }

  function loadDomesticNews(container, item) {
    var mount = container.querySelector('#ssDomesticNews');
    if (!mount) return;
    var code = item.code;
    mount.innerHTML = '<div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>' + escapeHtml(item.name) + ' 뉴스를 불러오는 중...</div>';
    fetchJson('https://goodbyestar.cloud/domestic-news?code=' + encodeURIComponent(code)
      + '&name=' + encodeURIComponent(item.name) + '&limit=10')
      .then(function (payload) {
        if (state.selectedCode !== code) return;
        var data = payload && payload.data ? payload.data : payload;
        renderDomesticNews(mount, (data && data.items) || []);
      })
      .catch(function () {
        if (state.selectedCode === code) mount.innerHTML = '<div class="ss-hint ss-error">뉴스를 불러오지 못했습니다.</div>';
      });
  }

  function renderDomesticNews(mount, items) {
    var recentItems = items.filter(domesticNewsWithin24Hours);
    if (!recentItems.length) {
      mount.innerHTML = '<div class="ss-hint">최근 24시간 관련 뉴스·공시가 없습니다.</div>';
      return;
    }
    var rows = recentItems.slice(0, 10).sort(function (a, b) {
      if (a.kind === 'disclosure' && b.kind !== 'disclosure') return -1;
      if (a.kind !== 'disclosure' && b.kind === 'disclosure') return 1;
      return domesticNewsTimestamp(b) - domesticNewsTimestamp(a);
    });
    mount.innerHTML = '<div class="app-news-timeline ss-news-timeline" role="list">' + rows.map(function (item, index) {
        var category = item.category || (item.kind === 'disclosure' ? '공시' : '뉴스');
        var pubDate = item.pubDate || '';
        var type = item.kind === 'disclosure' ? '공시' : '뉴스';
        return '<a class="app-news-event ss-news-item" href="' + escapeAttr(item.link || '#') + '" target="_blank" rel="noopener" role="listitem">'
          + '<div class="app-news-date"><strong>' + escapeHtml(domesticNewsDate(pubDate)) + '</strong><small>' + escapeHtml(domesticNewsTime(pubDate)) + '</small></div>'
          + '<div class="app-news-rail" aria-hidden="true"><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></div>'
          + '<div class="app-news-body"><div class="app-news-meta"><b class="app-news-market app-news-market--한국">한국</b><b class="app-news-type app-news-type--' + escapeHtml(type) + '">' + escapeHtml(type) + '</b><small>' + escapeHtml(item.source || item.publisher || '') + '</small></div>'
          + '<strong>' + escapeHtml(item.title || '') + '</strong></div></a>';
      }).join('') + '</div>';
  }

  function applyRealtimeQuote(container, quote) {
    if (state.selectedCode !== quote.code || !Number.isFinite(quote.price)) return;
    state.liveQuotes[quote.code] = quote;

    // 검색 결과는 GAS 조회 시점의 스냅샷이고 상세 상단은 WebSocket 체결가이므로,
    // 장중에는 같은 종목이 서로 다른 가격으로 남을 수 있다. 선택된 결과 행도
    // 동일한 체결가로 갱신해 화면 안의 종목 가격 기준을 하나로 맞춘다.
    var resultIndex = -1;
    (state.lastResults || []).some(function (item, index) {
      if (item.code !== quote.code) return false;
      resultIndex = index;
      item.price = quote.price;
      item.change = quote.change;
      item.changeRate = quote.changeRate;
      if (item.volume != null) item.tradingValue = item.price * item.volume;
      return true;
    });
    if (resultIndex > -1) {
      var resultRow = container.querySelector('.ss-result-row[data-idx="' + resultIndex + '"]');
      if (resultRow) {
        var resultPrice = resultRow.children[1];
        var resultRate = resultRow.children[2];
        var resultClass = signClass(quote.changeRate);
        if (resultPrice) {
          resultPrice.textContent = fmtPrice(quote.price);
          resultPrice.className = resultClass;
        }
        if (resultRate) {
          resultRate.textContent = fmtSignedPct(quote.changeRate);
          resultRate.className = resultClass;
        }
      }
    }

    var box = container.querySelector('#ssSummary');
    var cls = signClass(quote.changeRate);
    var priceEl = box && box.querySelector('.ss-summary-price');
    if (priceEl) { priceEl.textContent = fmtPrice(quote.price) + '원'; priceEl.className = 'ss-summary-price ' + cls; }
    var changeEl = box && box.querySelector('.ss-summary-change');
    if (changeEl) { changeEl.textContent = fmtSignedPct(quote.changeRate); changeEl.className = 'ss-summary-change ' + cls; }
    document.dispatchEvent(new CustomEvent('nine-stock-quote', { detail: {
      code: quote.code, price: quote.price, changeRate: quote.changeRate
    } }));
    updateLiveChartQuote(quote.code, quote);
    updateStockSrReference(quote.price);
  }

  // 호가창과 차트가 서로 다른 시점의 가격을 보여주지 않도록, 같은 WebSocket 체결가를
  // 현재 분봉의 종가·고가·저가에도 즉시 반영한다. 새 분봉 생성은 다음 분봉 API 갱신이
  // 담당하고, 현재 캔들 안의 틱은 setData 전체 재렌더 없이 Lightweight Charts update로
  // 갱신해 화면 흔들림을 줄인다.
  function updateLiveChartQuote(code, quote) {
    if (!lwcCandleSeries || lwcLiveTimeframe !== 'minute' || state.selectedCode !== code) return;
    var price = Number(quote && quote.price);
    var last = lwcLiveBars.length ? lwcLiveBars[lwcLiveBars.length - 1] : null;
    if (!last || !Number.isFinite(price)) return;
    last.close = price;
    last.high = Math.max(Number(last.high) || price, price);
    last.low = Math.min(Number(last.low) || price, price);
    lwcCandleSeries.update({ time: last.date, open: last.open, high: last.high, low: last.low, close: last.close });
  }

  // ---- 분봉 자동 재조회 ----
  // 분봉 탭에 머무는 동안 60초마다 다시 불러온다(캔들·이평선·거래량 전체 재렌더 - 확대구간
  // 보존 없음, kospi-futures.js의 setData() 방식보다 단순하다).

  function stopMinuteRefresh() {
    clearInterval(state.minuteRefreshTimer);
    state.minuteRefreshTimer = null;
  }

  function startMinuteRefresh(container, code) {
    stopMinuteRefresh();
    if (!code || document.hidden) return;
    state.minuteRefreshTimer = setInterval(function () {
      if (state.selectedCode !== code || state.timeframe !== 'minute' || document.hidden) {
        stopMinuteRefresh();
        return;
      }
      delete state.minuteCache[minuteCacheKey(code, state.minuteScope)]; // 60초 캐시 TTL과 무관하게 강제로 새로 받음
      renderMinuteChart(container, code);
    }, MINUTE_REFRESH_MS);
  }

  // ---- 차트 (일/주/월/분봉 + 거래량) ----
  // 분봉은 VM /ohlc-minute를 브라우저가 직접 호출(js/order-book.js와 동일 패턴, 인증 없음).
  // 일/주/월봉과 달리 state.chartCache(daily)가 아니라 별도 state.minuteCache를 쓴다.

  function wireChartTabs(container) {
    var minuteScopeWrap = container.querySelector('[data-minute-scope-wrap]');
    var minuteScope = container.querySelector('[data-minute-scope]');
    if (minuteScope) {
      minuteScope.value = state.minuteScope;
      minuteScope.onchange = function () {
        var nextScope = MINUTE_SCOPES.indexOf(minuteScope.value) > -1 ? minuteScope.value : '1';
        state.minuteScope = nextScope;
        if (state.selectedCode) delete state.minuteCache[minuteCacheKey(state.selectedCode, nextScope)];
        if (state.timeframe === 'minute') renderChartForCode(container, state.selectedCode);
      };
    }
    container.querySelectorAll('.ss-tf-btn').forEach(function (btn) {
      if (btn.disabled) return;
      btn.onclick = function () {
        var tf = btn.getAttribute('data-tf');
        if (state.timeframe === tf) return;
        state.timeframe = tf;
        container.querySelectorAll('.ss-tf-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        if (minuteScopeWrap) minuteScopeWrap.hidden = tf !== 'minute';
        renderChartForCode(container, state.selectedCode);
      };
    });
    if (minuteScopeWrap) minuteScopeWrap.hidden = state.timeframe !== 'minute';
    var rsiToggle = container.querySelector('[data-chart-rsi-toggle]');
    var rsiDivToggle = container.querySelector('[data-chart-rsidiv-toggle]');
    if (rsiToggle) {
      rsiToggle.checked = state.rsiEnabled;
      rsiToggle.onchange = function () {
        state.rsiEnabled = rsiToggle.checked;
        if (!state.rsiEnabled) { state.rsiDivergenceEnabled = false; if (rsiDivToggle) rsiDivToggle.checked = false; }   // 다이버전스는 RSI 패널이 있어야 그린다
        renderChartForCode(container, state.selectedCode);
      };
    }
    if (rsiDivToggle) {
      rsiDivToggle.checked = state.rsiDivergenceEnabled;
      rsiDivToggle.onchange = function () {
        state.rsiDivergenceEnabled = rsiDivToggle.checked;
        if (state.rsiDivergenceEnabled && !state.rsiEnabled) { state.rsiEnabled = true; if (rsiToggle) rsiToggle.checked = true; }
        renderChartForCode(container, state.selectedCode);
      };
    }
    var maShortToggle = container.querySelector('[data-chart-ma-short-toggle]');
    var maLongToggle = container.querySelector('[data-chart-ma-long-toggle]');
    function wireMaToggle(toggle, key) {
      if (!toggle) return;
      toggle.checked = state[key];
      toggle.onchange = function () {
        state[key] = toggle.checked;
        rememberStudyToggle('ma', state.movingAverageShortEnabled || state.movingAverageLongEnabled);
        renderChartForCode(container, state.selectedCode);
      };
    }
    wireMaToggle(maShortToggle, 'movingAverageShortEnabled');
    wireMaToggle(maLongToggle, 'movingAverageLongEnabled');
    var ichimokuToggle = container.querySelector('#ssIchimokuToggle, [data-chart-ichimoku-toggle]');
    if (ichimokuToggle) {
      ichimokuToggle.checked = state.ichimokuEnabled;
      ichimokuToggle.onchange = function () {
        state.ichimokuEnabled = ichimokuToggle.checked;
        rememberStudyToggle('cloud',state.ichimokuEnabled);
        renderChartForCode(container, state.selectedCode);
      };
    }
    var bollingerToggle = container.querySelector('#ssBollingerToggle, [data-chart-bollinger-toggle]');
    if (bollingerToggle) {
      bollingerToggle.checked = state.bollingerEnabled;
      bollingerToggle.onchange = function () {
        state.bollingerEnabled = bollingerToggle.checked;
        rememberStudyToggle('bollinger',state.bollingerEnabled);
        renderChartForCode(container, state.selectedCode);
      };
    }
    var accToggle = container.querySelector('#ssAccumulationToggle');
    if (accToggle) {
      accToggle.checked = state.accumulationEnabled;
      accToggle.onchange = function () {
        state.accumulationEnabled = accToggle.checked;
        rememberStudyToggle('trace',state.accumulationEnabled);
        renderChartForCode(container, state.selectedCode);
      };
    }
    var vpToggle = container.querySelector('#ssVolumeProfileToggle, [data-chart-vp-toggle]');
    if (vpToggle) {
      vpToggle.checked = state.volumeProfileEnabled;
      vpToggle.onchange = function () {
        state.volumeProfileEnabled = vpToggle.checked;
        renderChartForCode(container, state.selectedCode);
      };
    }
    // 파동 분석 체크·규모 선택: 분석은 캐시를 재사용하고 규모만 바꿔 다시 그린다(chart-wave-overlay 가 연결).
    // 파동 모듈·분석 엔진은 체크를 켜는 순간에야 받는다(안 쓰면 요청도 없다).
    var waveToggle = container.querySelector('[data-chart-wave-toggle]');
    if (waveToggle) {
      waveToggle.onchange = function () {
        state.wave.enabled = waveToggle.checked;   // 모듈이 오기 전에 누른 값을 먼저 반영한다
        loadChartCore().then(function (core) { return core.loadModule('wave'); }).then(function (Wave) {
          if (!waveToggle.isConnected) return;
          Wave.wireControls(waveToggle.closest('.de-modal-target') || container, state.wave, function () { applyStockWave(); }, 'ss');
          applyStockWave();
        }).catch(function () { waveToggle.checked = false; state.wave.enabled = false; /* 파동 모듈을 못 받아도 차트는 그대로 */ });
      };
      if (state.wave.enabled) { waveToggle.checked = true; waveToggle.onchange(); }
    }
    var srToggle = container.querySelector('#ssSupportResistanceToggle, [data-chart-sr-toggle]');
    if (srToggle) {
      srToggle.checked = state.supportResistanceEnabled;
      srToggle.onchange = function () {
        state.supportResistanceEnabled = srToggle.checked;
        rememberStudyToggle('sr',state.supportResistanceEnabled);
        renderChartForCode(container, state.selectedCode);
      };
    }
    var volMultToggle = container.querySelector('[data-chart-volmult-toggle]');
    if (volMultToggle) {
      volMultToggle.checked = state.volumeMultipleEnabled;
      volMultToggle.onchange = function () {
        state.volumeMultipleEnabled = volMultToggle.checked;
        if (lwcVolumePane && typeof lwcVolumePane.setMultiples === 'function') lwcVolumePane.setMultiples(state.volumeMultipleEnabled);
      };
    }
    var memoButton = container.querySelector('.ss-memo-toggle');
    if (memoButton && memoButton.getAttribute('data-memo-wired') !== '1') {
      memoButton.setAttribute('data-memo-wired', '1');
      memoButton.onclick = function () {
        if (state.timeframe === 'minute') { memoButton.title = '분봉에서는 일·주·월봉에서 메모해 주세요.'; return; }
        if (!memoCtl) return;
        var on = !memoCtl.isMode();
        if (on && drawingCtl) drawingCtl.setMode(null);
        memoCtl.setMode(on);
        memoButton.classList.toggle('is-active', on);
        memoButton.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
    }
    // 그리기 도구 단추는 차트를 그릴 때마다 chart-drawing 이 새 컨트롤러에 연결한다.
  }

  // 신규상장 종목은 일봉 분석에 필요한 기록이 없어도 실제 분봉은 조회할 수 있다.
  // NO_DATA만 분봉으로 전환하고, 통신 장애를 일봉 부족으로 오인하지 않는다.
  function showMinuteForMissingDaily(container, code) {
    if (state.selectedCode !== code) return;
    state.timeframe = 'minute';
    state.minuteScope = '1';
    var notice = container.querySelector('#ssChartNotice');
    if (notice) {
      notice.textContent = '일봉 자료가 부족해 1분봉으로 표시합니다.';
      notice.hidden = false;
    }
    container.querySelectorAll('.ss-tf-btn').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-tf') === 'minute');
    });
    wireChartTabs(container);
    renderChartForCode(container, code);
  }

  // 다른 화면이 같은 종목 일봉을 이 탭 저장소(chart-data 가 쓰는 키)에 남겨 뒀을 수 있는지 동기로 확인한다.
  // 있으면 엔진을 기다려 캐시에서 읽고(요청 생략), 없으면 엔진을 기다리지 않고 바로 요청한다.
  function sharedFlowChartMayExist(code) {
    try { return !!global.sessionStorage.getItem('nine-chart:v1:flow-chart|' + String(code || '').toUpperCase() + '|server'); } catch (e) { return false; }
  }

  // 일봉(/flow-chart) 요청: 호가 요약(order-book.js)·차트가 같은 경로를 쓰고, 종목분석과 메모리·탭 저장소 캐시를 같이 쓴다(chart-data).
  function requestFlowChart(code) {
    return global.OrderBook && global.OrderBook.fetchChart
      ? global.OrderBook.fetchChart(code)
      : global.NineAPI.flowChart(code, {request:fetchJson});
  }

  function loadSharedFlowChart(code) {
    var api = global.NineChartData;
    if (api) return api.fetchFlowChart(code, requestFlowChart);
    // 엔진이 아직 없으면: 탭 저장소에 있을 수 있을 때만 엔진을 기다리고, 아니면 기다리지 않고 바로 요청한다(캐시는 올라온 뒤 채운다).
    if (sharedFlowChartMayExist(code)) {
      return chartReady().then(function () { return global.NineChartData.fetchFlowChart(code, requestFlowChart); }, function () { return requestFlowChart(code); });
    }
    return requestFlowChart(code).then(function (data) {
      chartReady().then(function () { global.NineChartData.primeFlowChart(code, data); }).catch(function () { /* 캐시만 건너뜀 */ });
      return data;
    });
  }

  function loadChart(container, code) {
    var chartEl = activeStockChartElement(container);
    if (!chartEl) return;
    var cached = state.chartCache[code];
    if (cached && Date.now() - cached.t < 5 * 60 * 1000) {
      if (cached.noDaily) { showMinuteForMissingDaily(container, code); return; }
      renderChartForCode(container, code);
      return;
    }
    chartEl.innerHTML = '<div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>차트를 불러오는 중...</div>';
    // 같은 일봉(/flow-chart)은 종목분석과 메모리·탭 저장소 캐시를 같이 쓰고, 진행 중 요청도 하나로 합친다(chart-data).
    var chartRequest = loadSharedFlowChart(code);
    chartRequest
      .then(function (data) {
        if (data && (data.error === 'NO_DATA' || (!data.error && Array.isArray(data.daily) && !data.daily.length))) {
          state.chartCache[code] = { t: Date.now(), noDaily: true };
          showMinuteForMissingDaily(container, code);
          return;
        }
        if (!data || data.error || !data.daily || !data.daily.length) throw new Error('NO_DATA');
        state.chartCache[code] = { t: Date.now(), data: data };
        if (state.selectedCode === code) renderChartForCode(container, code);
      })
      .catch(function () {
        if (state.selectedCode === code) {
          chartEl.innerHTML = '<div class="ss-hint ss-error">차트 데이터를 불러오지 못했어요.</div>';
        }
      });
  }

  function stockRsi(bars) {
    var close = bars.map(function (bar) { return Number(bar.close) || 0; });
    var rsi = [], gain = 0, loss = 0, period = 14;
    for (var i = 0; i < close.length; i++) {
      if (i === 0) { rsi.push(null); continue; }
      var diff = close[i] - close[i - 1];
      if (i <= period) { gain += Math.max(diff, 0); loss += Math.max(-diff, 0); }
      if (i === period) { gain /= period; loss /= period; }
      else if (i > period) {
        gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
        loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
      }
      rsi.push(i < period ? null : (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)));
    }
    return rsi;
  }

  function installIchimokuCloudCanvas(container, chart, candleSeries, points) {
    if (!points.length) return function () {};
    var chartRoot = container.firstElementChild;
    if (chartRoot) chartRoot.classList.add('ss-lw-chart-root');

    var canvas = document.createElement('canvas');
    canvas.className = 'ss-ichimoku-cloud';
    canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(canvas, chartRoot || container.firstChild);

    var frameId = 0;
    var resizeObserver = null;
    function draw() {
      frameId = 0;
      if (!document.body.contains(container)) return;
      var width = container.clientWidth;
      var height = container.clientHeight;
      if (!width || !height) return;
      var ratio = Math.max(1, global.devicePixelRatio || 1);
      // Resizing clears/reallocates the backing store: only do it on actual resize.
      var pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      var coordinates = points.map(function (point) {
        var x = chart.timeScale().timeToCoordinate(point.time);
        if (!Number.isFinite(x) && point.sourceTime) {
          x = chart.timeScale().timeToCoordinate(point.sourceTime);
        }
        return {
          x: x,
          yA: candleSeries.priceToCoordinate(point.spanA),
          yB: candleSeries.priceToCoordinate(point.spanB)
        };
      });
      for (var i = 1; i < coordinates.length; i++) {
        var prev = coordinates[i - 1];
        var curr = coordinates[i];
        if (![prev.x, prev.yA, prev.yB, curr.x, curr.yA, curr.yB].every(Number.isFinite)) continue;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.yA);
        ctx.lineTo(curr.x, curr.yA);
        ctx.lineTo(curr.x, curr.yB);
        ctx.lineTo(prev.x, prev.yB);
        ctx.closePath();
        ctx.fillStyle = ICHIMOKU_CLOUD_FILL;
        ctx.fill();
      }
    }
    function scheduleDraw() {
      if (!frameId) frameId = global.requestAnimationFrame(draw);
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw);
    if ('ResizeObserver' in global) {
      resizeObserver = new ResizeObserver(scheduleDraw);
      resizeObserver.observe(container);
    } else {
      global.addEventListener('resize', scheduleDraw);
    }
    scheduleDraw();

    return function () {
      if (frameId) global.cancelAnimationFrame(frameId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw);
      if (resizeObserver) resizeObserver.disconnect();
      else global.removeEventListener('resize', scheduleDraw);
      canvas.remove();
    };
  }

  function installRsiZoneCanvas(container, chart, rsiSeries, panes, bars, rsiValues) {
    if (!rsiSeries || !panes || panes.length < 3) return function () {};
    var chartRoot = container.querySelector('.ss-lw-chart-root') || container.querySelector('div');
    var canvas = document.createElement('canvas');
    canvas.className = 'ss-rsi-zones';
    canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(canvas, chartRoot || container.firstChild);

    var frameId = 0;
    var resizeObserver = null;
    var paneSizeSubscriptions = [];
    function paneHeight(pane, fallback) {
      var value = pane && pane.getHeight ? pane.getHeight() : fallback;
      return Number.isFinite(value) && value > 0 ? value : fallback;
    }
    function fillThresholdSegment(ctx, x0, y0, v0, x1, y1, v1, threshold, thresholdY, above, color) {
      var inside0 = above ? v0 >= threshold : v0 <= threshold;
      var inside1 = above ? v1 >= threshold : v1 <= threshold;
      if (!inside0 && !inside1) return;

      var startX = x0, startY = y0, endX = x1, endY = y1;
      if (inside0 !== inside1) {
        var t = (threshold - v0) / (v1 - v0);
        var crossX = x0 + t * (x1 - x0);
        if (!inside0) { startX = crossX; startY = thresholdY; }
        if (!inside1) { endX = crossX; endY = thresholdY; }
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(startX, thresholdY);
      ctx.lineTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.lineTo(endX, thresholdY);
      ctx.closePath();
      ctx.fill();
    }
    function draw() {
      frameId = 0;
      if (!document.body.contains(container)) return;
      var width = container.clientWidth;
      var height = container.clientHeight;
      if (!width || !height) return;
      var mainHeight = paneHeight(panes[0], Math.max(220, height * 0.68));
      var volumeHeight = paneHeight(panes[1], Math.max(SUB_PANE_MIN_HEIGHT, height * SUB_PANE_RATIO));
      var rsiTop = mainHeight + volumeHeight;
      var y70 = rsiSeries.priceToCoordinate(70);
      var y30 = rsiSeries.priceToCoordinate(30);
      if (!Number.isFinite(y70) || !Number.isFinite(y30) || !bars || !rsiValues) return;
      positionLwcPaneLabels(container, panes, mainHeight, volumeHeight);

      var ratio = Math.max(1, global.devicePixelRatio || 1);
      // Resizing clears/reallocates the backing store: only do it on actual resize.
      var pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      var dark = document.documentElement.classList.contains('dark');
      var red = dark ? 'rgba(210,79,69,0.28)' : 'rgba(210,79,69,0.22)';
      var blue = dark ? 'rgba(18,97,196,0.28)' : 'rgba(18,97,196,0.18)';
      var y70Absolute = rsiTop + y70;
      var y30Absolute = rsiTop + y30;
      var timeScale = chart.timeScale();
      for (var i = 1; i < bars.length; i++) {
        var v0 = rsiValues[i - 1], v1 = rsiValues[i];
        if (v0 == null || v1 == null) continue;
        var x0 = timeScale.timeToCoordinate(bars[i - 1].date);
        var x1 = timeScale.timeToCoordinate(bars[i].date);
        var p0 = rsiSeries.priceToCoordinate(v0), p1 = rsiSeries.priceToCoordinate(v1);
        if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(p0) || !Number.isFinite(p1)) continue;
        fillThresholdSegment(ctx, x0, rsiTop + p0, v0, x1, rsiTop + p1, v1, 70, y70Absolute, true, red);
        fillThresholdSegment(ctx, x0, rsiTop + p0, v0, x1, rsiTop + p1, v1, 30, y30Absolute, false, blue);
      }
    }
    function scheduleDraw() {
      if (!frameId) frameId = global.requestAnimationFrame(draw);
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw);
    panes.forEach(function (pane) {
      if (pane && typeof pane.subscribeSizeChange === 'function') {
        pane.subscribeSizeChange(scheduleDraw);
        paneSizeSubscriptions.push(pane);
      }
    });
    if ('ResizeObserver' in global) {
      resizeObserver = new ResizeObserver(scheduleDraw);
      resizeObserver.observe(container);
    } else {
      global.addEventListener('resize', scheduleDraw);
    }
    scheduleDraw();

    return function () {
      if (frameId) global.cancelAnimationFrame(frameId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw);
      paneSizeSubscriptions.forEach(function (pane) {
        if (typeof pane.unsubscribeSizeChange === 'function') pane.unsubscribeSizeChange(scheduleDraw);
      });
      if (resizeObserver) resizeObserver.disconnect();
      else global.removeEventListener('resize', scheduleDraw);
      canvas.remove();
    };
  }

  function compactVolume(value) { return global.NineChartCore.compactVolume(value); }
  function ratioPercent(value, basis) {
    var numerator = Number(value), denominator = Number(basis);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return '';
    return (numerator / denominator * 100).toFixed(1) + '%';
  }
  function compactTradingValue(value, isUsChart) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '-';
    if (isUsChart) return '$' + compactVolume(n);
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
    if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
    return global.NineUI.number(n, {round:true}) + '원';
  }

  function ma224Color() { return global.NineChartCore.ma224Color(); }

  // 전체화면에서는 .ss-panel-right가 모달로 옮겨진다. 기존 #stock-search 참조는
  // 더 이상 #ssChart를 포함하지 않으므로, 토글이 null을 렌더러로 넘기지 않게 한다.
  function activeStockChartElement(container) {
    var fullscreenChart = document.querySelector('.de-chart-overlay #ssChart');
    if (fullscreenChart) return fullscreenChart;
    if (!container || !container.querySelectorAll) return null;
    // Embedded US and domestic hosts both retain #ssChart. Never render into
    // the hidden market's chart when switching back to the other market.
    var charts = container.querySelectorAll('#ssChart');
    for (var i = 0; i < charts.length; i++) {
      if (!charts[i].closest('[hidden]')) return charts[i];
    }
    return null;
  }

  function renderChartForCode(container, code) {
    var rangeWrap = container.querySelector('.nine-chart-ranges');
    if (rangeWrap) rangeWrap.hidden = state.timeframe === 'minute';
    if (state.timeframe === 'minute') {
      renderMinuteChart(container, code);
      startMinuteRefresh(container, code);
      return;
    }
    stopMinuteRefresh();
    var cached = state.chartCache[code];
    if (!cached) return;
    if (cached.noDaily) { showMinuteForMissingDaily(container, code); return; }
    var timeframe = state.timeframe;
    chartReady().then(function () {
      if (state.selectedCode !== code || state.timeframe !== timeframe) return;   // 받는 사이 종목·주기가 바뀌었다
      var bars = global.NineChartData.barsForTimeframe(cached.data.daily, timeframe);
      var chartEl = activeStockChartElement(container);
      if (chartEl) {
        global.NineChartData.installRangeButtons(chartEl, code, function () { return state.chartCache[code].data; }, function (data) {
          state.chartCache[code] = { t: Date.now(), data: data };
          renderChartForCode(container, code);
        });
        renderLwChart(chartEl, bars, timeframe);
      }
    }).catch(function () {
      var failEl = activeStockChartElement(container);
      if (failEl && state.selectedCode === code) failEl.innerHTML = '<div class="ss-hint ss-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // 미국 주식도 국내 종목 화면과 같은 차트 UI/렌더러를 사용한다.
  // 외부 데이터 공급자는 국내 형식({date, open, high, low, close, volume})으로만 변환해 넘긴다.
  function mountExternalChart(options) {
    options = options || {};
    var container = options.container;
    var code = String(options.key || options.code || '').trim();
    if (!container || !code || typeof options.load !== 'function') return Promise.reject(new Error('CHART_OPTIONS'));

    stopMinuteRefresh();
    state.selectedCode = code;
    state.selectedName = /^US:/i.test(code) ? localizedUsName(code) : (options.name || code);
    state.timeframe = 'day';
    state.minuteScope = '1';
    state.externalMinuteLoader = function (scope) { return options.load('minute', scope); };
    container.innerHTML = ''
      + '<div class="ss-stock-controls" role="group" aria-label="종목 차트 설정">'
      + '<div class="ss-chart-tabs">'
      + '<div class="ss-timeframe-tools">'
      + '<button type="button" class="ss-tf-btn active" data-tf="day">일봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="week">주봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="month">월봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="minute">분봉</button>'
      + '</div>'
      + '<div class="ss-minute-scope-wrap" data-minute-scope-wrap hidden>' + minuteScopeControlHtml() + '</div>'
      + '<div class="ss-drawing-tools">'
      + '<button type="button" class="ss-memo-toggle" aria-pressed="false" title="차트의 봉을 눌러 메모를 남깁니다(일·주·월봉)">메모</button>'
      + '<button type="button" class="ss-draw-toggle" aria-pressed="false">직선</button>'
      + '<button type="button" class="ss-circle-toggle" aria-pressed="false">동그라미</button>'
      + '<button type="button" class="ss-box-toggle" aria-pressed="false">박스</button>'
      + '<button type="button" class="ss-hline-toggle" aria-pressed="false">가로선</button>'
      + '<button type="button" class="ss-measure-toggle" aria-pressed="false" title="고점에서 저점까지 끌면 변화율(%)을 보여 줍니다">측정</button>'
      + '<button type="button" class="ss-pencil-toggle" aria-pressed="false">연필</button>'
      + '<button type="button" class="ss-draw-clear">지우기</button>'
      + '</div></div>'
      + '<div class="ss-chart-studies">'
      + '<label title="3·5·20·60일선"><input type="checkbox" data-chart-ma-short-toggle checked /> 단기 이평선(3·5·20·60)</label>'
      + '<label title="112·224·448일선. 224일선은 굵은 검정"><input type="checkbox" data-chart-ma-long-toggle checked /> 장기 이평선(112·224·448)</label>'
      + '<label title="전환선(9)·기준선(26)·선행스팬(52, 26봉 앞)으로 그린 구름대입니다. 구름 위는 상승 우위, 아래는 하락 우위로 읽습니다. 참고용이며 매수·매도 신호가 아닙니다."><input type="checkbox" data-chart-ichimoku-toggle /> 일목균형표(구름) 표시</label>'
      + '<label title="20일 이동평균을 가운데로 위아래 표준편차 2배 폭의 밴드입니다. 밴드가 좁아지면 변동성 수축, 넓어지면 확대를 뜻합니다."><input type="checkbox" data-chart-bollinger-toggle /> 볼린저 밴드</label>'
      + '<label title="과거에 가격이 반응했던 가격대를 가로 띠로 표시합니다. 반응 횟수·최근 반응일·거래량 동반 여부로 선 굵기가 달라지고, 보라색 파선은 지지와 저항이 바뀐 가격대입니다."><input type="checkbox" data-chart-sr-toggle /> 지지·저항 표시</label>'
      + '<label title="배수 = 그 봉 거래량 ÷ 바로 앞 20봉(일봉이면 20일) 평균 거래량(그 봉 제외). 2배 이상이면 막대를 진하게, 3배 이상이면 `3.2배`처럼 숫자를 붙입니다. 매수·매도 신호가 아닙니다."><input type="checkbox" data-chart-volmult-toggle /> 거래량 배수 표시</label>'
      + '<label title="RSI(14) 보조 패널을 표시합니다. 70 이상은 과매수, 30 이하는 과매도 구간으로 색을 입힙니다. 끄면 패널이 사라지고 RSI 다이버전스도 함께 꺼집니다."><input type="checkbox" data-chart-rsi-toggle /> RSI</label>'
      + '<label title="자동 파동이 확정한 고점·저점끼리 가격과 RSI의 방향이 엇갈린 구간에 선을 긋습니다. 과거 구조를 보여 줄 뿐 매수·매도 신호가 아닙니다."><input type="checkbox" data-chart-rsidiv-toggle /> RSI 다이버전스</label>'
      + '<label title="가격대별로 거래량이 많이 쌓인 구간을 차트 옆 막대로 보여 줍니다. 매물이 많이 걸린 가격대를 찾을 때 씁니다."><input type="checkbox" data-chart-vp-toggle /> 매물대 표시</label>'
      + '<label title="실험 기능: 가격 움직임의 구조를 상승(빨강)·하락(파랑)·횡보(회색)·변동성 큰 박스권(보라 회색) 박스로 나눠 보여줍니다. 대·중·소 규모를 고를 수 있고(기본 중파동) 한 단계 위 규모는 옅은 점선 윤곽으로 함께 보입니다. 극점은 되돌림이 확인된 뒤에 확정되고, 점선(진행 중·방향 미확정) 구간은 새 봉이 들어오면 바뀔 수 있습니다. 매수·매도 추천이 아닙니다."><input type="checkbox" data-chart-wave-toggle /> 파동 분석</label>' + waveLevelHtml()
      + '</div></div>'
      + '<div id="ssChart" class="ss-chart"><div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>차트를 불러오는 중...</div></div>'
      + '<div class="ss-chart-legend">미국 일봉은 제공된 약 2년 자료 범위에서 기간을 선택합니다. 전체 = 수신한 자료 전체.</div>';

    // 첫 화면은 일봉만 보인다. 이전에는 보이지 않는 분봉까지 동시에 조회해서
    // 미국 상세 진입 때 뉴스·일봉·분봉 외부 요청이 한꺼번에 몰렸다. 분봉은 탭을
    // 실제로 눌렀을 때 renderMinuteChart()가 조회한다.
    var existingDaily = state.chartCache[code];
    return Promise.resolve().then(function () {
      return existingDaily && Date.now() - existingDaily.t < 5 * 60 * 1000 && existingDaily.data
        ? existingDaily.data.daily : options.load('daily');
    }).then(function (dailyResult) {
      var daily = Array.isArray(dailyResult) ? dailyResult : [];
      if (!daily.length) throw new Error('NO_DATA');
      state.chartCache[code] = { t: Date.now(), data: { daily: daily } };
      if (state.selectedCode !== code) return { daily: daily, minute: [] };
      wireChartTabs(container);
      renderChartForCode(container, code);
      return { daily: daily, minute: [] };
    }).catch(function (error) {
      var chartEl = container.querySelector('#ssChart');
      if (chartEl && state.selectedCode === code) chartEl.innerHTML = '<div class="ss-hint ss-error">차트 데이터를 불러오지 못했습니다.</div>';
      throw error;
    });
  }

  // 2026-08-05(5차) 사용자 리포트: 분봉 차트가 여러 날짜(8/3~8/5)가 이어붙어 그려지고,
  // 새로고침할 때마다 그 전체 구간에 맞춰 줌아웃된 것처럼 보였다 - API_REFERENCE.md에
  // 이미 문서화돼 있던 대로 /ohlc-minute(ka10080)는 "최근 며칠치가 한 번에" 온다. 아래
  // 시간 필터만으로는 날짜는 안 걸러지므로, 응답에 포함된 날짜 중 가장 최근 날짜만 남긴다
  // (오늘 데이터가 아직 없는 장 시작 전에는 어제 등 최근 거래일이 대신 나오게 된다).
  //
  // 정규장 연속거래(09:00~15:20)만 사용한다 - 15:20~15:30 종가 단일가 구간은 거래량이
  // 비정상적으로 크게 찍혀(실측 확인, 누적치로 추정) 그대로 넣으면 캔들/거래량 축이
  // 그 한 칸 때문에 왜곡된다. LWC의 분봉 time은 날짜 문자열이 아니라 UNIX 초 단위여야 한다.
  //
  // 2026-08-05 사용자 리포트: X축에 timeVisible을 켰더니(위 lwcThemeOptions) 시각이
  // "09:30" 아니라 "00:30"처럼 9시간 이른 값으로 나왔다 - Lightweight Charts가 UNIX
  // 타임스탬프의 시:분을 표시할 때 브라우저 로컬 시간대가 아니라 항상 UTC 기준으로 읽기
  // 때문이다(라이브러리 문서화된 동작). 그래서 실제 KST 시각을 '+09:00'으로 정확히
  // UTC로 환산해 넣으면, 화면엔 그 UTC 값의 시:분이 그대로 찍혀 9시간 밀린 것처럼
  // 보인다. 해결책은 반대로 "KST 시:분 숫자를 UTC인 척" 넣는 것('+09:00' 대신 'Z') -
  // 실제 시간대와는 다른 순간을 가리키게 되지만, 이 차트는 절대시각이 아니라 "장중
  // 몇 시 몇 분"이라는 표시만 중요하므로 문제없다(다른 시간대 방문자가 봐도 거래소
  // 기준 시각이 그대로 보여야 한다는 요구사항과도 맞음).
  function minuteRowsToBars(rows) {
    var latestDate = rows.reduce(function (max, r) { return r.date > max ? r.date : max; }, '');
    return rows
      .filter(function (r) { return r.date === latestDate && r.time >= '09:00' && r.time <= '15:20'; })
      .map(function (r) {
        return {
          date: Math.floor(new Date(r.date + 'T' + r.time + ':00Z').getTime() / 1000),
          open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume || 0
        };
      });
  }

  function renderMinuteChart(container, code) {
    var chartEl = activeStockChartElement(container);
    if (!chartEl) return;
    var scope = state.minuteScope;
    var cacheKey = minuteCacheKey(code, scope);
    var cached = state.minuteCache[cacheKey];
    if (cached && Date.now() - cached.t < 60 * 1000) {
      renderLwChart(chartEl, cached.bars, 'minute');
      return;
    }
    chartEl.innerHTML = '<div class="ss-hint"><svg class="ss-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>분봉을 불러오는 중...</div>';
    var loader = typeof state.externalMinuteLoader === 'function' && /^US:/i.test(String(code))
      ? state.externalMinuteLoader(scope)
      : fetchJson(VM_OHLC_MINUTE_URL + encodeURIComponent(code) + '?tic_scope=' + encodeURIComponent(scope));
    Promise.resolve(loader)
      .then(function (payload) {
        var bars = Array.isArray(payload) ? payload : minuteRowsToBars((payload && payload.data) || []);
        state.minuteCache[cacheKey] = { t: Date.now(), bars: bars };
        if (state.selectedCode === code && state.timeframe === 'minute') {
          var currentChartEl = activeStockChartElement(container);
          if (currentChartEl) renderLwChart(currentChartEl, bars, 'minute');
        }
      })
      .catch(function () {
        if (state.selectedCode === code && state.timeframe === 'minute') {
          chartEl.innerHTML = '<div class="ss-hint ss-error">분봉 데이터를 불러오지 못했어요.</div>';
        }
      });
  }

  // 차트 엔진(js/chart-core.js)과 이 화면이 쓰는 보조 모듈을 페이지당 한 번만 받는다. 차트 인스턴스는 만들지 않는다(그리는 시점에 만든다).
  function loadChartCore() {
    if (global.NineChartCore) return Promise.resolve(global.NineChartCore);
    var loads = global.__nineChartLoads = global.__nineChartLoads || {};
    if (loads.core) return loads.core;
    loads.core = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-nine-chart="core"]');
      var script = existing || document.createElement('script');
      script.addEventListener('load', function () { resolve(global.NineChartCore); });
      script.addEventListener('error', function () { loads.core = null; if (script.remove) script.remove(); reject(new Error('차트 엔진 로드 실패')); });
      if (!existing) {
        script.src = CHART_CORE_URL;
        script.async = true;
        script.setAttribute('data-nine-chart', 'core');
        document.head.appendChild(script);
      }
    });
    return loads.core;
  }

  // 라이브러리 + 보조 모듈이 모두 준비되면 LightweightCharts 를 돌려준다.
  function chartReady() {
    return loadChartCore().then(function (core) {
      var optional = CHART_OPTIONAL.map(function (name) { return core.loadModule(name).catch(function () { return null; }); });
      return core.ready(['data']).then(function (parts) { return Promise.all(optional).then(function () { return parts[0]; }); });
    });
  }

  function chartPriceText(value, isUsChart) { return global.NineChartCore.priceText(value, isUsChart); }

  function stockSrLegendHtml(result, isUsChart) {
    var srPart = function (list, cls) {
      return list.map(function (l) { return '<b class="' + cls + '">' + chartPriceText(l.price, isUsChart) + '</b>'; }).join(' · ');
    };
    return result && (result.support.length || result.resistance.length)
      ? '지지 ' + (result.support.length ? srPart(result.support, 'ss-sr-support') : '없음')
        + ' / 저항 ' + (result.resistance.length ? srPart(result.resistance, 'ss-sr-resistance') : '없음')
      : '지지·저항 <b>데이터 부족</b>';
  }

  function updateStockSrReference(referencePrice) {
    if (!state.supportResistanceEnabled || !global.NineChartSR || !lwcLiveBars.length || !lwcSrCleanup || typeof lwcSrCleanup.update !== 'function') return;
    var result = global.NineChartSR.levels(lwcLiveBars, referencePrice, { timeframe: lwcLiveTimeframe });
    lwcSrCleanup.update(result);
    var label = lwcChartContainer && lwcChartContainer.querySelector('.ss-sr-label');
    if (label) label.innerHTML = stockSrLegendHtml(result, /^US:/i.test(String(state.selectedCode || '')));
  }

  function chartOhlcDateText(time) {
    if (typeof time === 'string') return time;
    if (typeof time === 'number' && Number.isFinite(time)) {
      // 분봉은 KST 시각을 UTC 초로 담아 Lightweight Charts의 축이 그대로 KST처럼
      // 읽히게 한다. 따라서 여기서도 UTC getter를 써야 툴팁이 축과 9시간 어긋나지 않는다.
      var date = new Date(time * 1000);
      function two(value) { return String(value).padStart(2, '0'); }
      return date.getUTCFullYear() + '-' + two(date.getUTCMonth() + 1) + '-' + two(date.getUTCDate())
        + ' ' + two(date.getUTCHours()) + ':' + two(date.getUTCMinutes());
    }
    if (time && typeof time === 'object' && time.year != null) {
      return time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0');
    }
    return '';
  }

  // 툴팁의 거래량 줄: '거래량 1,234,000 (20일 평균 대비 2.2배)'. 기준은 그 봉 직전 20봉(그 봉 제외) 평균이며 전일 하루가 아니다.
  function stockVolumeTooltipHtml(volInfo, time) {
    if (!volInfo || !volInfo.map) return '';
    var key = time && typeof time === 'object' && time.year != null
      ? time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0') : String(time);
    var row = volInfo.map[key];
    if (!row || row.volume === null || row.volume === undefined) return '';
    var multiple = row.multiple === null || row.multiple === undefined ? '—' : row.multiple.toFixed(1) + '배';
    return '<span class="ss-ohlc-volume">거래량 <em>' + Math.round(row.volume).toLocaleString('ko-KR') + '</em> <i>(' + (volInfo.label || '20일') + ' 평균 대비 <em>' + multiple + '</em>)</i></span>';
  }

  // Lightweight Charts 기본 십자선에는 현재 가로선 값만 있어 어떤 봉의 종가인지
  // 바로 알기 어렵다. 캔들 시리즈에서 실제 OHLC를 받아 네 값 모두를 고정 형식으로 표시한다.
  // volInfo(선택) = { map: core.volumeMultiples 결과, label: '20일'|'20봉' } - 있으면 거래량과 직전 평균 대비 배수를 한 줄 더 보여 준다.
  function installStockOhlcTooltip(container, chart, candleSeries, isUsChart, volInfo) {
    if (!container || !chart || !candleSeries || !chart.subscribeCrosshairMove) return function () {};
    var tooltip = document.createElement('div');
    tooltip.className = 'ss-ohlc-tooltip';
    tooltip.hidden = true;
    tooltip.setAttribute('aria-live', 'polite');
    container.appendChild(tooltip);
    var onCrosshairMove = function (param) {
      var point = param && param.point;
      var bar = param && param.seriesData && param.seriesData.get ? param.seriesData.get(candleSeries) : null;
      if (!point || !bar || !Number.isFinite(Number(bar.close))) {
        tooltip.hidden = true;
        return;
      }
      var width = container.clientWidth || 0;
      var left = Math.max(8, Math.min(Math.max(8, width - 282), Number(point.x || 0) + 14));
      if (Number(point.x || 0) > width * 0.58) left = Math.max(8, Number(point.x || 0) - 282);
      tooltip.style.left = left + 'px';
      tooltip.innerHTML = '<b>' + escapeHtml(chartOhlcDateText(param.time)) + '</b>'
        + '<span>시 <em>' + chartPriceText(bar.open, isUsChart) + '</em></span>'
        + '<span>고 <em>' + chartPriceText(bar.high, isUsChart) + '</em></span>'
        + '<span>저 <em>' + chartPriceText(bar.low, isUsChart) + '</em></span>'
        + '<span class="ss-ohlc-close">종 <em>' + chartPriceText(bar.close, isUsChart) + '</em></span>'
        + stockVolumeTooltipHtml(volInfo, param.time);
      tooltip.hidden = false;
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    return function () {
      if (chart.unsubscribeCrosshairMove) chart.unsubscribeCrosshairMove(onCrosshairMove);
      tooltip.remove();
    };
  }

  // ---- 수동 그리기·자동 파동은 공용 모듈(js/chart-drawing.js, js/chart-wave-overlay.js) ----
  // 저장 키·종류는 예전과 같다(브라우저 `tistory-ticker:stock-drawings:<종목>:<봉>` + 로그인 시 계정 /chart-drawings). 분봉과 자동 파동은 서버에 저장하지 않는다.
  var STOCK_DRAWING_STORE = {
    key: function (code, tf) { return 'tistory-ticker:stock-drawings:' + String(code || '') + ':' + String(tf || 'day'); },
    kinds: ['lines', 'paths', 'circles', 'hlines', 'boxes'],
    legacyArray: true
  };

  function stockDrawingButtons(element) {
    var scope = element.parentElement || element;
    return {
      line: scope.querySelector('.ss-draw-toggle'), pencil: scope.querySelector('.ss-pencil-toggle'),
      circle: scope.querySelector('.ss-circle-toggle'), box: scope.querySelector('.ss-box-toggle'),
      hline: scope.querySelector('.ss-hline-toggle'), measure: scope.querySelector('.ss-measure-toggle'), clear: scope.querySelector('.ss-draw-clear')
    };
  }

  function destroyStockOverlays() {
    if (waveHandle) { waveHandle.detach(); waveHandle = null; }
    if (drawingCtl) { drawingCtl.detach(); drawingCtl = null; }
  }

  // 차트 한 개에 그리기 층 + 자동 파동을 붙인다. 파동 계산은 켜져 있을 때만, 데이터가 바뀔 때만 한다.
  function setupStockOverlays(element, chart, series, timeframe, bars) {
    destroyStockOverlays();
    var core = global.NineChartCore, Drawing = global.NineChartDrawing;
    if (!Drawing) return;
    drawingCtl = Drawing.attach({
      core: core, container: element, chart: chart, series: series, bars: bars || [],
      key: state.selectedCode, timeframe: timeframe,
      className: 'ss-drawing-layer', ariaLabel: '차트 추세선 그리기 영역',
      bounds: 'container', point: 'anchored', tools: ['line', 'pencil', 'circle', 'box', 'hline', 'measure'],
      buttons: stockDrawingButtons(element), store: STOCK_DRAWING_STORE,
      style: { stroke: '#e11d48', dots: true, previewDash: true },
      sync: timeframe !== 'minute'
    });
    if (state.wave.enabled) applyStockWave();   // 켜 둔 상태에서 종목·주기가 바뀌면 새 차트에도 바로 붙인다
  }

  // 켜져 있으면 모듈을 받아 현재 차트에 붙이고 계산, 꺼져 있으면 층을 걷어 낸다.
  function applyStockWave() {
    var ctlNow = drawingCtl;
    if (!ctlNow || (!state.wave.enabled && !waveHandle)) return;
    var bars = ctlNow.shapes.bars, timeframe = ctlNow.shapes.timeframe;
    loadChartCore().then(function (core) { return core.loadModule('wave'); }).then(function (Wave) {
      if (drawingCtl !== ctlNow || ctlNow.detached) return;   // 그 사이 차트가 다시 그려졌다
      if (!waveHandle) waveHandle = Wave.attach({ core: global.NineChartCore, ctl: ctlNow, key: state.selectedCode, timeframe: timeframe, bars: bars, state: state.wave, font: 'MaruBuri, serif' });
      waveHandle.apply();
    }).catch(function () { /* 파동 모듈을 못 받아도 차트는 그대로 */ });
  }

  // ---- 매물대(2026-10-05 사용자 요청: 호가창·차트·매물대 연동, 토스처럼 확대·축소를 따라감) ----
  // 화면에 보이는 기간의 봉으로 가격대별 거래량(봉 하나의 거래량을 고가~저가에 균등 분산한 근사치)을
  // 다시 계산하고, 구간 높이는 가격축 확대에 맞춰 화면 약 10px로 정한다. 계산은 범위·구간 수가 바뀔 때만,
  // 막대 길이는 프레임마다 목표값으로 조금씩(easing) 다가가 부드럽게 움직인다. 계산 결과는
  // window.__ssVolumeProfile로 내보내고 'ss-volume-profile' 이벤트를 쏴서 호가창(order-book.js)이
  // 매물대 구간의 호가를 주황으로 표시한다.
  var VP_CORE_RATIO = 0.85;  // 핵심 매물대 기준(거래량 최대 대비)
  var VP_MAX_WIDTH_RATIO = 0.50;   // 가장 긴 막대가 차트 폭에서 차지하는 비율(왼쪽에서 오른쪽으로 뻗는다)
  var VP_MAX_BINS = 300;           // 아주 긴 기간을 한 번에 볼 때 막대가 너무 가늘어지지 않게 하는 상한

  function vpRound(v) { return Math.round(v * 1e6) / 1e6; }

  // 2026-10-22 사용자 요청("토스처럼 왼쪽에 500원 단위로"): 구간 크기를 확대·축소가 아니라 가격대로 고정한다.
  // 현재가의 약 0.3%에 가장 가까운 '깔끔한' 값(국내 1·5·10·50·100·500·1,000·5,000·10,000원, 미국 0.01~10달러)을 고르므로
  // 18만원대 종목은 500원, 7만원대는 100원, 5천원대는 10원 단위가 된다. 기간이 너무 길어 구간이 300개를 넘으면 정수배로 키운다.
  var VP_STEPS_KR = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];
  var VP_STEPS_US = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
  function vpFixedStep(price, isUs) {
    var table = isUs ? VP_STEPS_US : VP_STEPS_KR;
    var target = Math.max(price, table[0]) * 0.003;
    var best = table[0], bestGap = Infinity;
    table.forEach(function (v) {
      var gap = Math.abs(Math.log(v / target));
      if (gap < bestGap) { bestGap = gap; best = v; }
    });
    return best;
  }

  function computeVolumeProfile(bars, binCount, isUs, displayBins) {
    if (!bars || bars.length < 2) return null;
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (d) { if (d.low < lo) lo = d.low; if (d.high > hi) hi = d.high; });
    if (!(hi > lo)) return null;
    var lastClose = Number(bars[bars.length - 1].close);
    var step = vpFixedStep(lastClose > 0 ? lastClose : hi, isUs);
    // 차트 오버레이는 약 12개의 넓은 가격 구간으로 표시한다. 기본 계산의 가격 단위는 유지한다.
    var limit = displayBins > 1 ? displayBins - 1 : VP_MAX_BINS;
    var ratio = (hi - lo) / step / limit;
    if (ratio > 1) {
      var factor = [2, 5, 10, 20, 50, 100, 200, 500].filter(function (f) { return f >= ratio; })[0] || Math.ceil(ratio);
      step = vpRound(step * factor);
    }
    var bottom = vpRound(Math.floor(lo / step + 1e-9) * step);
    var top = vpRound(Math.ceil(hi / step - 1e-9) * step);
    if (!(top > bottom)) top = vpRound(bottom + step);
    var count = Math.max(1, Math.round((top - bottom) / step));
    var bins = [];
    for (var i = 0; i < count; i++) bins.push({ low: vpRound(bottom + i * step), high: vpRound(bottom + (i + 1) * step), volume: 0 });
    bars.forEach(function (d) {
      if (!(d.volume > 0)) return;
      var range = d.high - d.low;
      if (!(range > 0)) {
        bins[Math.min(count - 1, Math.max(0, Math.floor((d.close - bottom) / step)))].volume += d.volume;
        return;
      }
      var a = Math.max(0, Math.floor((d.low - bottom) / step));
      var b = Math.min(count - 1, Math.floor((d.high - bottom) / step));
      for (var k = a; k <= b; k++) {
        var overlap = Math.min(bins[k].high, d.high) - Math.max(bins[k].low, d.low);
        if (overlap > 0) bins[k].volume += d.volume * (overlap / range);
      }
    });
    var maxVolume = 0, pocIndex = 0;
    bins.forEach(function (b, idx) { if (b.volume > maxVolume) { maxVolume = b.volume; pocIndex = idx; } });
    if (maxVolume <= 0) return null;
    // 핵심 매물대: 거래량이 최대의 85% 이상인 구간 중 상위 2개(주황 표시 대상, 호가창 연동 기준)
    bins.slice().sort(function (a, b) { return b.volume - a.volume; }).slice(0, 2).forEach(function (b) {
      if (b.volume >= maxVolume * VP_CORE_RATIO) b.core = true;
    });
    return { bins: bins, maxVolume: maxVolume, pocIndex: pocIndex, binSize: step };
  }

  function publishVolumeProfile(code, profile) {
    global.__ssVolumeProfile = profile ? { code: code, bins: profile.bins, maxVolume: profile.maxVolume } : null;
    try { global.dispatchEvent(new CustomEvent('ss-volume-profile', { detail: { code: code } })); } catch (e) { /* 구형 브라우저 */ }
  }

  function lwcBarsForProfile(bars) {
    return bars.map(function (d) {
      return { low: Number(d.low), high: Number(d.high), close: Number(d.close), volume: Number(d.volume) || 0 };
    });
  }

  // ---- 매물대 분석 패널(2026-10-19): 화면에 보이는 봉 기준 비중·가까운 지지/저항 후보. 계산은 js/volume-profile-analysis.js ----
  function vpPanelFor(container) {
    var host = container && container.parentNode;
    if (!host) return null;
    var panel = host.querySelector('.ss-vp-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ss-vp-panel';
      panel.setAttribute('aria-live', 'polite');
      container.insertAdjacentElement('afterend', panel);
    }
    return panel;
  }

  function vpEsc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function renderVpPanel(panel, analysis, info) {
    if (!panel) return;
    var VP = global.NineVolumeProfile;
    if (!analysis || !VP) { panel.style.visibility = 'hidden'; panel.innerHTML = ''; panel.__vpHtml = null; return; }   // hidden 이 아니라 visibility: 높이를 유지해 차트 영역이 들썩이지 않게 한다
    var fmt = function (v) { return chartPriceText(v, info.isUs); };
    var opts = { format: fmt };
    var core = global.NineChartCore;
    function vol(v) { return (core && core.compactVolume ? core.compactVolume(v) : global.NineUI.number(v, {round:true})) + '주'; }
    // 최대 매물대 색 점은 차트와 같은 분홍색. 저항·지지 후보의 패널 의미색은 유지한다.
    function dot(kind) { return '<i class="ss-vp-dot ss-vp-dot-' + kind + '"></i>'; }
    function zone(label, z, g, sign) {
      var kind = label.indexOf('저항') >= 0 ? 'res' : 'sup';
      if (!z) return '<span class="ss-vp-item"><b>' + dot(kind) + label + '</b> 뚜렷한 구간 없음</span>';
      return '<span class="ss-vp-item"><b>' + dot(kind) + label + '</b> ' + fmt(z.low) + '~' + fmt(z.high)
        + (g ? ' <em>(' + sign + g.pct.toFixed(1) + '%)</em>' : ' <em>(현재가 포함)</em>')
        + ' · ' + vol(z.volume) + ' · ' + z.share.toFixed(1) + '%</span>';
    }
    var poc = analysis.poc;
    var pg = analysis.pocGap && analysis.pocGap.where !== 'inside' ? analysis.pocGap : null;
    // 패널은 보이는 구간·해상도가 바뀔 때마다 다시 그려진다. 그때마다 innerHTML 을 통째로 바꾸면 사용자가 펼쳐 둔 '거래량이 적은 가격대'가
    // 바로 접혀 펼쳐지지 않는 것처럼 보인다(2026-10-19 사용자 리포트). 그래서 (1) 내용이 같으면 다시 그리지 않고 (2) 다시 그릴 때는 펼침 상태를 이어받는다.
    var prevThin = panel.querySelector ? panel.querySelector('.ss-vp-thin') : null;
    var thinOpen = !!(prevThin && prevThin.open);
    var thin = analysis.thin.length
      ? '<details class="ss-vp-thin"><summary>거래량이 적은 가격대 ' + analysis.thin.length + '곳</summary><ul>' + analysis.thin.map(function (t) {
        return '<li>' + vpEsc(VP.thinText(t, opts)) + '</li>';
      }).join('') + '</ul></details>' : '';
    // 2026-10-22 사용자 요청(설명이 길다): 머리글은 짧게(긴 설명은 마우스를 올리면 툴팁), 상태 문장은 첫 문장만(전체는 툴팁),
    // 호가형 항목 4개는 한 줄에, 안내 문구는 한 줄로 줄인다. 패널 높이는 고정이라 내용이 바뀌어도 차트가 들썩이지 않는다.
    var stepText = info.step != null ? Number(info.step).toLocaleString('ko-KR') + (info.isUs ? '달러' : '원') : '';
    var headTip = '화면에 보이는 ' + info.barCount + '개 ' + info.unit + ' 기준 · 가격 구간 ' + stepText + ' 단위 · 확대·축소하면 기간이 바뀝니다 · 고가~저가에 거래량을 나눈 추정치이며 체결가 기준이 아닙니다.';
    var stateText = analysis.state ? String(analysis.state.text || '') : '';
    var firstSentence = (stateText.match(/^.*?(?:입니다|습니다|있습니다)\./) || [stateText])[0];
    var html = '<div class="ss-vp-head"><strong>매물대 분석</strong><span title="' + vpEsc(headTip) + '">' + info.unit + ' ' + info.barCount + '개 · 구간 ' + stepText + ' · 추정치</span></div>'
      + '<div class="ss-vp-items">'
      + zone('저항 후보', analysis.resistance, analysis.resistanceGap, '+')
      + zone('지지 후보', analysis.support, analysis.supportGap, '-')
      + '<span class="ss-vp-item"><b>' + dot('poc') + '최대 매물대</b> ' + fmt(poc.low) + '~' + fmt(poc.high)
      + (pg ? ' <em>(' + (pg.where === 'above' ? '+' : '-') + pg.pct.toFixed(1) + '%)</em>' : ' <em>(현재가 포함)</em>')
      + ' · ' + vol(poc.volume) + ' · ' + poc.share.toFixed(1) + '%</span>'
      + '<span class="ss-vp-item"><b>위·아래</b> ' + analysis.aboveShare.toFixed(0) + '% / ' + analysis.belowShare.toFixed(0) + '%</span></div>'
      + (analysis.state ? '<p class="ss-vp-state" title="' + vpEsc(stateText) + '"><b>' + vpEsc(analysis.state.label) + '</b> ' + vpEsc(firstSentence) + '</p>' : '')
      + '<p class="ss-vp-hover" data-vp-hover>막대에 마우스를 올리면 구간별 추정 거래량이 보입니다.</p>' + thin;
    if (panel.__vpHtml !== html) {                                   // 내용이 같으면 DOM 을 건드리지 않는다(펼침·호버 문구 유지)
      panel.innerHTML = thinOpen ? html.replace('<details class="ss-vp-thin">', '<details class="ss-vp-thin" open>') : html;
      panel.__vpHtml = html;
    }
    panel.hidden = false;
    panel.style.visibility = '';
  }

  function createVolumeProfilePrimitive(bars, isUs, code, container, unit, context) {
    var isIndex = context && context.index;
    var profilePrice = function (value) { return isIndex ? Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + 'pt' : chartPriceText(value, isUs); };
    return {
      _series: null, _chart: null, _requestUpdate: null,
      _key: null, _profile: null, _shown: {}, _step: null,
      attached: function (params) {
        var self = this;
        this._series = params.series; this._chart = params.chart; this._requestUpdate = params.requestUpdate;
        this._panel = vpPanelFor(container);
        // 마우스가 가리키는 가격이 속한 구간의 추정 거래량·비중(막대 위에 올리면 보인다)
        this._onCross = function (param) {
          var line = self._panel && self._panel.querySelector('[data-vp-hover]');
          if (!line || !self._profile || !self._series) return;
          if (!param || !param.point) { line.textContent = '막대에 마우스를 올리면 구간별 추정 거래량이 보입니다.'; return; }
          var price = self._series.coordinateToPrice(param.point.y);
          var hit = null;
          if (price != null) self._profile.bins.forEach(function (b) { if (price >= b.low && price < b.high) hit = b; });
          var all = self._profile.bins.reduce(function (sum, b) { return sum + b.volume; }, 0);
          if (!hit || !(all > 0)) { line.textContent = '이 가격대에는 집계된 추정 거래량이 없습니다.'; return; }
          var core = global.NineChartCore;
          line.textContent = profilePrice(hit.low) + '~' + profilePrice(hit.high) + ' · 추정 거래량 '
            + (core && core.compactVolume ? core.compactVolume(hit.volume) : Math.round(hit.volume)) + (isIndex ? ' (원본 단위) · 전체의 ' : '주 · 전체의 ')
            + (hit.volume / all * 100).toFixed(1) + '% · 최대 구간 대비 ' + Math.round(hit.volume / self._profile.maxVolume * 100) + '%';
        };
        try { params.chart.subscribeCrosshairMove(this._onCross); } catch (e) { /* 구버전은 호버 문구만 빠진다 */ }
      },
      detached: function () {
        try { if (this._chart && this._onCross) this._chart.unsubscribeCrosshairMove(this._onCross); } catch (e) { /* 이미 제거됨 */ }
        if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
        this._panel = null; this._series = null; this._chart = null; this._requestUpdate = null;
      },
      updateAllViews: function () {},
      _analyze: function (win, profile, from, to) {
        if (isIndex) {
          this._panel.innerHTML = '<div class="ss-vp-head"><strong>지수 구간별 추정 거래량</strong></div><p>거래량이 수신된 ' + win.filter(function (bar) { return bar.volume > 0; }).length + '봉의 고가·저가에 비례 배분한 추정치입니다. 실제 가격별 체결량·보유 주식 물량이 아닙니다.</p><div data-vp-hover>막대에 마우스를 올리면 구간별 비중이 보입니다.</div>';
          this._panel.style.visibility = 'visible';
          return null;
        }
        var VP = global.NineVolumeProfile;
        var live = lwcLiveBars.length ? lwcLiveBars[lwcLiveBars.length - 1].close : null;
        var price = Number(live != null ? live : bars[bars.length - 1].close);
        if (!VP || !(price > 0)) { renderVpPanel(this._panel, null); return null; }
        var analysis = VP.analyze(profile.bins, price, bars.slice(0, to + 1).map(function (b) { return b.close; }), { format: function (v) { return chartPriceText(v, isUs); } });
        renderVpPanel(this._panel, analysis, { isUs: isUs, barCount: to - from + 1, unit: unit || '봉', step: profile.binSize });
        return analysis;
      },
      _profileFor: function (heightPx) {
        var series = this._series, chart = this._chart;
        var from = 0, to = bars.length - 1;
        var range = chart && chart.timeScale().getVisibleLogicalRange();
        if (range) { from = Math.max(0, Math.floor(range.from)); to = Math.min(bars.length - 1, Math.ceil(range.to)); }
        if (to - from < 1) return null;
        var pTop = series.coordinateToPrice(0), pBottom = series.coordinateToPrice(heightPx);
        if (pTop == null || pBottom == null) return null;
        var win = bars.slice(from, to + 1);
        var lo = Infinity, hi = -Infinity;
        win.forEach(function (d) { if (d.low < lo) lo = d.low; if (d.high > hi) hi = d.high; });
        var key = from + '|' + to;   // 구간 크기는 가격대로 고정이라 화면 높이·확대에는 다시 계산하지 않는다
        if (key !== this._key) {
          this._key = key;
          this._profile = computeVolumeProfile(win, 0, isUs, 12);
          this._analysis = this._profile ? this._analyze(win, this._profile, from, to) : null;
          if (!this._profile) renderVpPanel(this._panel, null);
          publishVolumeProfile(code, this._profile);
        }
        return this._profile;
      },
      paneViews: function () {
        var self = this;
        return [{
          renderer: function () {
            return {
              draw: function () {},
              drawBackground: function (target) {
                if (!self._series) return;
                target.useBitmapCoordinateSpace(function (scope) {
                  var profile = self._profileFor(scope.mediaSize.height);
                  if (!profile) return;
                  var ctx = scope.context;
                  var hR = scope.horizontalPixelRatio, vR = scope.verticalPixelRatio;
                  var paneWidth = scope.bitmapSize.width;
                  var maxBarPx = paneWidth * VP_MAX_WIDTH_RATIO;
                  if (self._step !== profile.binSize) { self._shown = {}; self._step = profile.binSize; }
                  var next = {}, moving = false;
                  ctx.save();
                  profile.bins.forEach(function (b, i) {
                    var t = b.volume / profile.maxVolume;
                    var cur = self._shown[b.low] == null ? t : self._shown[b.low];
                    cur += (t - cur) * 0.3;
                    if (Math.abs(t - cur) > 0.004) moving = true; else cur = t;
                    next[b.low] = cur;
                    if (cur <= 0.002) return;
                    var yTop = self._series.priceToCoordinate(b.high);
                    var yBottom = self._series.priceToCoordinate(b.low);
                    if (yTop == null || yBottom == null) return;
                    var barPx = Math.max(2 * hR, cur * maxBarPx);
                    var top = yTop * vR, h = Math.max(1, (yBottom - yTop) * vR);
                    // 캔들 뒤에 빈틈 없는 사각형으로 표시하고 최대 거래량 구간만 분홍색으로 강조한다.
                    ctx.fillStyle = i === profile.pocIndex ? 'rgba(236,72,153,0.42)' : 'rgba(56,169,225,0.28)';
                    ctx.fillRect(0, top, barPx, h);
                  });
                  ctx.restore();
                  self._shown = next;
                  if (moving && self._requestUpdate) self._requestUpdate();
                });
              }
            };
          }
        }];
      }
    };
  }

  function renderLwChart(container, bars, timeframe) {
    // 전체화면 모달을 여닫는 순간에도 이전 DOM 참조가 남을 수 있다.
    // 렌더 대상을 찾지 못한 경우 기존 차트를 먼저 지워 빈 화면을 만들지 않는다.
    if (!container || !container.querySelectorAll) return;
    var renderId = ++lwcRenderId;
    lwcCandleSeries = null;
    lwcLiveBars = [];
    lwcLiveTimeframe = null;
    destroyStockOverlays();
    if (stockChartResizeOff) { stockChartResizeOff(); stockChartResizeOff = null; }
    if (stockChartResizeFrame) { global.cancelAnimationFrame(stockChartResizeFrame); stockChartResizeFrame = 0; }
    stockChartMeasuredWidth = 0;
    stockChartMeasuredHeight = 0;
    if (lwcCloudCleanup) { lwcCloudCleanup(); lwcCloudCleanup = null; }
    if (lwcSrCleanup) { lwcSrCleanup(); lwcSrCleanup = null; }
    if (memoCtl) { memoCtl.dispose(); memoCtl = null; }
    if (lwcRsiZonesCleanup) { lwcRsiZonesCleanup(); lwcRsiZonesCleanup = null; }
    if (lwcPaneLabelsCleanup) { lwcPaneLabelsCleanup(); lwcPaneLabelsCleanup = null; }
    if (lwcDivergenceCleanup) { lwcDivergenceCleanup(); lwcDivergenceCleanup = null; }
    if (supplyMarkerHolder && supplyMarkerHolder.legendCleanup) supplyMarkerHolder.legendCleanup();
    if (supplyMarkerHolder && supplyMarkerHolder.tipCleanup) supplyMarkerHolder.tipCleanup();
    if (supplyMarkerHolder && supplyMarkerHolder.densityCleanup) supplyMarkerHolder.densityCleanup();
    supplyMarkerHolder = null;
    if (lwcOhlcTooltipCleanup) { lwcOhlcTooltipCleanup(); lwcOhlcTooltipCleanup = null; }
    if (stockPanCleanup) { stockPanCleanup(); stockPanCleanup = null; }
    if (stockWheelCleanup) { stockWheelCleanup(); stockWheelCleanup = null; }
    if (stockChartRegistryOff) { stockChartRegistryOff(); stockChartRegistryOff = null; }
    if (lwcChart) { try { lwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ } lwcChart = null; }
    lwcChartContainer = null;
    container.querySelectorAll('.ss-volume-study-label, .ss-price-study-label, .ss-lwc-pane-labels, .ss-ichimoku-cloud, .ss-sr-zones').forEach(function (el) { el.remove(); });
    if (container.parentNode && container.parentNode.querySelectorAll) container.parentNode.querySelectorAll('.ss-vp-panel').forEach(function (el) { el.remove(); });

    chartReady().then(function (LWC) {
      // 지지·저항은 체크했을 때만 모듈이 필요하다
      var studyLoads = [];
      if (state.supportResistanceEnabled) studyLoads.push(global.NineChartCore.loadModule('sr').catch(function () { return null; }));
      if (state.rsiDivergenceEnabled) studyLoads.push(global.NineChartCore.loadModule('divergence').catch(function () { return null; }));
      return Promise.all(studyLoads).then(function () { return LWC; });
    }).then(function (LWC) {
      if (renderId !== lwcRenderId || !document.body.contains(container)) return;
      var core = global.NineChartCore;
      if (container.querySelector('.ss-hint')) container.innerHTML = '';

      var options = core.chartOptions(LWC, 'search', {
        timeframe: timeframe,
        fontFamily: global.getComputedStyle ? global.getComputedStyle(document.body).fontFamily : "Pretendard Variable, Pretendard, sans-serif",
        autoSize: false,
        width: Math.max(1, Math.floor(container.clientWidth)),
        height: Math.max(1, Math.floor(container.clientHeight || 420))
      });
      // 라이브러리 기본 휠 스크롤/확대와 중복되지 않도록 이 화면에서만 비활성화.
      options.handleScale.mouseWheel = false;
      options.handleScroll.mouseWheel = false;
      var chart = LWC.createChart(container, options);
      stockWheelCleanup = core.installSmoothWheelZoom(chart, container, { bars: bars.length, priceSeries: function () { return lwcCandleSeries; } });
      lwcChart = chart;
      lwcChartContainer = container;
      stockChartRegistryOff = core.registerChart(container, chart, { bars: bars.length, timeframe: timeframe });
      stockPanCleanup = core.installVerticalPan(chart, container, {
        priceSeries: function () { return lwcCandleSeries; },
        isDrawing: function () { return !!(drawingCtl && drawingCtl.mode()); }
      });
      stockChartResizeOff = core.observeResize(container, resizeStockChart);
      chart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.06, bottom: 0.08 },
        alignLabels: false
      });

      var isUsChart = /^US:/i.test(String(state.selectedCode || ''));
      var priceMinMove = isUsChart ? 0.01 : 1;
      var candleSeries = core.addCandles(chart, LWC, bars, {
        type: 'custom',
        minMove: priceMinMove,
        formatter: function (v) { return chartPriceText(v, isUsChart); }
      }, { top: 0.06, bottom: 0.08 });
      lwcOhlcTooltipCleanup = installStockOhlcTooltip(container, chart, candleSeries, isUsChart, { map: core.volumeMultiples(bars, 20), label: timeframe === 'day' ? '20일' : '직전 20봉' });
      lwcCandleSeries = candleSeries;
      if (state.volumeProfileEnabled && typeof candleSeries.attachPrimitive === 'function') {
        try { candleSeries.attachPrimitive(createVolumeProfilePrimitive(lwcBarsForProfile(bars), isUsChart, state.selectedCode, container, timeframe === 'week' ? '주봉' : timeframe === 'month' ? '월봉' : timeframe === 'minute' ? '분봉' : '일봉')); } catch (e) { /* 매물대만 빠지고 차트는 계속 */ }
      } else if (!state.volumeProfileEnabled) {
        publishVolumeProfile(state.selectedCode, null);
      }
      lwcLiveBars = bars.map(function (bar) {
        return { date: bar.date, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume) || 0 };
      });
      lwcLiveTimeframe = timeframe;
      if (state.liveQuotes[state.selectedCode]) updateLiveChartQuote(state.selectedCode, state.liveQuotes[state.selectedCode]);

      var priceLegendHtml = [];
      var legendLines = {};   // 범례 키 -> 선 시리즈(굵게 표시용)
      var maGroups = [];
      if (state.movingAverageShortEnabled) maGroups.push('short');
      if (state.movingAverageLongEnabled) maGroups.push('long');
      if (maGroups.length) {
        core.maStudies(undefined, maGroups).forEach(function (study) {
          var points = core.movingAveragePoints(bars, 'close', study.period);
          if (!points.length) return;   // 봉이 모자라(예: 448일선) 그릴 수 없는 선은 범례도 만들지 않는다
          var maSeries = core.addMovingAverageLine(chart, LWC, study, points, {
            priceScaleId: 'right',
            priceFormat: {
              type: 'custom',
              minMove: priceMinMove,
              formatter: function (v) { return chartPriceText(v, isUsChart); }
            }
          });
          var latest = points.length ? chartPriceText(points[points.length - 1].value, isUsChart) : '—';
          legendLines[study.key] = lineEntries(maSeries);
          priceLegendHtml.push('<span data-study="ma" data-line-key="' + study.key + '" class="ss-legend-click" title="눌러서 이 선을 굵게" style="color:' + study.color + '">MA' + study.period + ' <b>' + latest + '</b></span>');
        });
      }
      var markHolder = supplyMarkerHolder = { chart: chart, container: container, supplyEnabled: false, supplyMode:state.supplyMode, studyOrder:state.studyOrder, timeframe:timeframe };
      if (state.accumulationEnabled && timeframe === 'day' && !isUsChart) {
        core.setSupplyTraceMarkers(LWC, candleSeries, bars, true, markHolder);
      } else if (state.accumulationEnabled) {
        priceLegendHtml.push('<span style="color:' + core.SUPPLY_TRACES.color + '">거래량·가격 흔적은 국내 일봉에서만 표시됩니다</span>');
      }
      if (state.bollingerEnabled) {
        legendLines.bollinger = lineEntries(core.addBollingerBands(chart, LWC, bars));
        priceLegendHtml.push('<span data-study="bollinger" data-line-key="bollinger" class="ss-legend-click" title="눌러서 이 선을 굵게" style="color:#d9a600">볼린저 20·2</span>');
      }

      // futureBarTimes가 분봉 간격을 모르는 채로 하루씩 미래 날짜를 만들어버리므로
      // 분봉 탭에서는 구름대 투영을 건너뛴다(체크돼 있어도 "데이터 부족"으로만 표시됨).
      var cloudPoints = (state.ichimokuEnabled && timeframe !== 'minute') ? core.ichimokuCloudPoints(bars, timeframe) : [];
      if (state.ichimokuEnabled) {
        var spanASeries = chart.addSeries(LWC.LineSeries, {
          color: ICHIMOKU_BORDER_COLOR,
          lineWidth: 1,
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false
        });
        var spanBSeries = chart.addSeries(LWC.LineSeries, {
          color: ICHIMOKU_BORDER_COLOR,
          lineWidth: 1,
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false
        });
        // 구름 데이터가 일부 브라우저/차트 버전에서 미래 시각·중복 시각을
        // 거부해 전체 차트 렌더링이 중단되지 않도록 유한값과 단조 증가 시각만 전달한다.
        var safeCloudPoints = cloudPoints.filter(function (point, index, all) {
          return point && point.time && Number.isFinite(Number(point.spanA)) && Number.isFinite(Number(point.spanB))
            && (index === 0 || String(point.time) > String(all[index - 1].time));
        });
        spanASeries.setData(safeCloudPoints.map(function (point) { return { time: point.time, value: point.spanA }; }));
        spanBSeries.setData(safeCloudPoints.map(function (point) { return { time: point.time, value: point.spanB }; }));
        cloudPoints = safeCloudPoints;
        priceLegendHtml.push('<span data-study="cloud" class="ss-ichimoku-label">일목 구름대' + (cloudPoints.length ? '' : ' <b>데이터 부족</b>') + '</span>');
      }

      var liveQuote = state.liveQuotes[state.selectedCode];
      var srReferencePrice = liveQuote && Number.isFinite(Number(liveQuote.price)) ? Number(liveQuote.price) : null;
      var srResult = state.supportResistanceEnabled && global.NineChartSR ? global.NineChartSR.levels(bars, srReferencePrice, { timeframe: timeframe }) : null;
      if (state.supportResistanceEnabled) {
        priceLegendHtml.push('<span data-study="sr" class="ss-sr-label">' + stockSrLegendHtml(srResult, isUsChart) + '</span>');
      }

      if (priceLegendHtml.length || (state.accumulationEnabled && timeframe === 'day' && !isUsChart)) {
        var priceLegend = document.createElement('div');
        priceLegend.className = 'ss-price-study-label';
        priceLegend.innerHTML = priceLegendHtml.join('');
        Array.from(priceLegend.children).sort(function(a,b){return state.studyOrder.indexOf(a.dataset.study)-state.studyOrder.indexOf(b.dataset.study);}).forEach(function(el){priceLegend.appendChild(el);});
        container.appendChild(priceLegend);
        priceLegend.addEventListener('click', function (event) {
          var hit = event.target.closest ? event.target.closest('[data-line-key]') : null;
          if (!hit) return;
          var key = hit.getAttribute('data-line-key');
          state.lineHighlight[key] = !state.lineHighlight[key];
          applyLineHighlight(legendLines, priceLegend);
        });
        applyLineHighlight(legendLines, priceLegend);
      }

      // TradingView v5의 독립 패널: 거래량(1) · RSI(2).
      // 차트 전체의 localization.priceFormatter를 없애고 시리즈별 포맷을 사용해야
      // 거래량 값이 2,539,179 같은 주가형 숫자가 아니라 2.54M처럼 축약 표시된다.
      // 2026-08-05 사용자 리포트: 거래량 Y축에 가격 데이터와 거래량 데이터가 겹쳐 보였음 -
      // lastValueVisible/priceLineVisible을 켜두면 라이브러리가 거래량 시리즈의 마지막 값
      // 배지·점선을 오른쪽 가격축(캔들과 같은 여백)에 그대로 그려서 가격 마지막 값 배지·
      // 눈금 라벨과 겹친다. 같은 값은 이미 아래 .ss-volume-study-label(커스텀 범례)이
      // 텍스트로 보여주고 있어 중복이라, 다른 보조지표 시리즈(MA/일목균형표)와 동일하게 끈다.
      var volumePane = core.addVolumePane(chart, LWC, bars, {
        pane: 1, scaleId: 'volume', ma5: true, multiples: state.volumeMultipleEnabled,
        // 막대를 항상 패널 하단(기준선 0)에 붙이고 위쪽 15%만 비워 범례가 막대 바로 위에 오게 한다(2026-08-14).
        scaleOptions: { drawTicks: false, ticksVisible: false, borderVisible: false, scaleMargins: { top: 0.15, bottom: 0 } }
      });
      var volumeMaPoints = volumePane.ma20.points;
      var volumeMa5Points = volumePane.ma5.points;

      var rsiValues = state.rsiEnabled ? stockRsi(bars) : null;
      var rsiSeries = null;
      if (state.rsiEnabled) {
        // 첨부 화면과 같은 RSI(14) 검정 단일선. 색상은 50 기준으로 나누지 않고,
        // 과매수·과매도 구간만 선과 70/30 기준선 사이를 배경으로 강조한다.
        rsiSeries = chart.addSeries(LWC.LineSeries, {
          color: '#333333', lineWidth: 2, lastValueVisible: false, priceLineVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: { type: 'custom', minMove: 0.1, formatter: function (v) { return Number(v).toFixed(1); } }
        }, 2);
        rsiSeries.setData(bars.map(function (bar, index) {
          return rsiValues[index] == null ? null : { time: bar.date, value: rsiValues[index] };
        }).filter(Boolean));
        // 2026-09-16 민원("차트 안 글자가 겹쳐 보임"): 축 라벨 칩('70'·'30')이 가격축 눈금(70.0·30.0)
        // 바로 옆에 겹쳐 찍혀 같은 숫자가 두 번 보였다. 점선은 그대로 두고 중복 칩만 끈다.
        rsiSeries.createPriceLine({ price: 70, color: '#d9d9d9', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false, title: '70' });
        rsiSeries.createPriceLine({ price: 50, color: '#6b7280', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false, title: '50' });
        rsiSeries.createPriceLine({ price: 30, color: '#d9d9d9', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false, title: '30' });
        // 2026-08-14 요청: 거래량/RSI/MACD 3개 서브패널이 좁은 공간에서 라벨·배지가 계속
        // 겹쳐 보인다는 리포트가 반복돼(패널 위치 계산을 두 차례 고쳐도 재현) MACD 패널
        // 자체를 없애고 거래량·RSI 2개만 남긴다.
      }

      var paneLabels = document.createElement('div');
      paneLabels.className = 'ss-lwc-pane-labels';
      paneLabels.style.visibility = 'hidden';
      paneLabels.innerHTML = '<span>RSI(14)</span>';
      if (state.rsiEnabled) container.appendChild(paneLabels);

      var latestBar = bars[bars.length - 1] || {};
      var previousBar = bars.length > 1 ? bars[bars.length - 2] : null;
      var latestVolumeMa5 = volumeMa5Points.length ? volumeMa5Points[volumeMa5Points.length - 1].value : null;
      var latestVolumeMa = volumeMaPoints.length ? volumeMaPoints[volumeMaPoints.length - 1].value : null;
      var previousVolume = previousBar ? Number(previousBar.volume) || 0 : 0;
      var latestVolume = Number(latestBar.volume) || 0;
      var volumeChangePct = previousVolume > 0 ? (latestVolume - previousVolume) / previousVolume * 100 : null;
      // 거래대금은 일봉 종가×거래량으로 계산한 참고값이다. 국내·미국 모두 같은
      // 비율을 적용하되, 표시는 국내는 억원·미국은 달러 축약 단위로 구분한다.
      var valueBars = bars.map(function (bar) {
        return { date: bar.date, tradingValue: Math.max(0, Number(bar.close) || 0) * Math.max(0, Number(bar.volume) || 0) };
      });
      var valueMa20Points = core.movingAveragePoints(valueBars, 'tradingValue', 20);
      var latestTradingValue = Math.max(0, Number(latestBar.close) || 0) * latestVolume;
      var latestTradingValueMa20 = valueMa20Points.length ? valueMa20Points[valueMa20Points.length - 1].value : null;
      var latestVolumeVs20 = ratioPercent(latestVolume, latestVolumeMa);
      var latestTradingValueVs20 = ratioPercent(latestTradingValue, latestTradingValueMa20);
      var latestVsMa5 = ratioPercent(latestVolume, latestVolumeMa5);
      var latestVsMa20 = ratioPercent(latestVolume, latestVolumeMa);
      var volumeLegend = document.createElement('div');
      volumeLegend.className = 'ss-volume-study-label';
      volumeLegend.innerHTML = '<span class="ss-volume-current-label">거래량 <b>' + compactVolume(latestVolume) + '</b>' + (latestVolumeVs20 ? ' <em>(' + latestVolumeVs20 + ' · 20일 대비)</em>' : '') + '</span>'
        + '<span class="ss-volume-amount-label">거래대금 <b>' + compactTradingValue(latestTradingValue, isUsChart) + '</b>' + (latestTradingValueVs20 ? ' <em>(' + latestTradingValueVs20 + ' · 20일 대비)</em>' : '') + '</span>'
        + (latestVolumeMa5 == null ? '' : '<b class="ss-volume-ma5-value"><i class="ss-volume-dot ss-volume-dot-5"></i>5일평균 ' + compactVolume(latestVolumeMa5) + (latestVsMa5 ? ' <em>(현재 ' + latestVsMa5 + ')</em>' : '') + '</b>')
        + (latestVolumeMa == null ? '' : '<b class="ss-volume-ma-value"><i class="ss-volume-dot ss-volume-dot-20"></i>20일평균 ' + compactVolume(latestVolumeMa) + (latestVsMa20 ? ' <em>(현재 ' + latestVsMa20 + ')</em>' : '') + '</b>')
        + '<span class="ss-volume-day-label">전일 대비</span>'
        + '<b class="ss-volume-day-change ' + (volumeChangePct > 0 ? 'is-up' : (volumeChangePct < 0 ? 'is-down' : 'is-flat')) + '">' + formatSignedPercent(volumeChangePct) + '</b>';
      container.appendChild(volumeLegend);

      chart.timeScale().fitContent();
      if (timeframe !== 'minute' && global.NineChartData && (/^[0-9A-Z]{6}$/i.test(String(state.selectedCode || '')) || isUsChart)) {
        var visibleDates = global.NineChartData.rangeDates(bars, state.selectedCode);
        if (visibleDates) chart.timeScale().setVisibleRange(visibleDates);
        if (!isUsChart) global.NineChartData.loadOnLeftScroll(chart, container, state.selectedCode,
          function () { return state.chartCache[state.selectedCode] && state.chartCache[state.selectedCode].data; });
      }
      var panes = chart.panes();
      var totalHeight = container.clientHeight || 420;
      var sizes = sizeStockChartPanes(panes, totalHeight, !!container.closest('.de-chart-overlay'));
      // 패널 제목·거래량 범례 위치를 CSS 고정 %(58/72/86%) 대신 실제로 적용한 패널 높이
      // 그대로 계산해서 맞춘다 - 컨테이너 높이가 달라지면 고정 %는 패널 경계와 어긋난다
      // (2026-08-13 사용자 스크린샷 제보: "거래량" 제목이 실제 거래량 패널과 안 맞음).
      // 전체화면으로 열고 닫을 때도 동일하게 다시 맞춰야 해서 resizeStockChart()와
      // positionLwcPaneLabels() 함수를 공유한다.
      positionLwcPaneLabels(container, panes, sizes.mainHeight, sizes.subHeight);
      lwcPaneLabelsCleanup = installPaneLabelSync(container, panes, sizes);
      lwcCloudCleanup = installIchimokuCloudCanvas(container, chart, candleSeries, cloudPoints);
      memoCtl = timeframe === 'minute' || !global.NineChartMemo ? null : global.NineChartMemo.install({
        container: container, chart: chart, series: candleSeries, bars: bars, timeframe: timeframe,
        code: state.selectedCode, name: state.selectedName,
        formatPrice: function (p) { return chartPriceText(p, isUsChart); },
        isDrawing: function () { return !!(drawingCtl && drawingCtl.mode()); }
      });
      lwcVolumePane = volumePane;
      lwcSrCleanup = global.NineChartSR ? global.NineChartSR.install(container, chart, candleSeries, srResult, function (p) { return chartPriceText(p, isUsChart); }, { isUs: isUsChart }) : null;
      lwcRsiZonesCleanup = installRsiZoneCanvas(container, chart, rsiSeries, panes, bars, rsiValues);
      // RSI 다이버전스: 자동 파동이 확정한 고점·저점끼리 가격과 RSI의 방향이 엇갈린 구간(분봉 제외)
      if (state.rsiEnabled && state.rsiDivergenceEnabled && timeframe !== 'minute' && global.NineChartDivergence && global.NineChartWave && global.AutoWave) {
        var divResult = global.NineChartWave.analysis(bars, state.selectedCode, timeframe);
        var divList = global.NineChartDivergence.find(bars, rsiValues, divResult, state.wave.level || 'medium');
        lwcDivergenceCleanup = global.NineChartDivergence.install({ container: container, chart: chart, candleSeries: candleSeries, rsiSeries: rsiSeries, panes: panes, bars: bars, list: divList });
      }
      setupStockOverlays(container, chart, candleSeries, timeframe, bars);
      resizeStockChart();
    }).catch(function () {
      if (renderId !== lwcRenderId) return;
      container.innerHTML = '<div class="ss-hint ss-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  function formatSignedPercent(value) {
    if (value == null || !Number.isFinite(Number(value))) return '-';
    var n = Number(value);
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function fetchJson(url) {
    return global.NineHttp.json(url, { timeoutMs: FETCH_TIMEOUT_MS });
  }

  function signClass(rate) {
    if (rate > 0) return 'ss-up';
    if (rate < 0) return 'ss-down';
    return 'ss-flat';
  }
  function fmtPrice(v) { return global.NineUI.number(v); }
  function fmtSignedPct(v) { return global.NineUI.signedPercent(v, {plusZero:true}); }
  function fmtQty(v) { return global.NineUI.number(v, {round:true}); }
  // 거래대금(원)을 억원 단위로 - 사이트 다른 위젯(마켓 브리핑 등)과 동일한 단위 관례
  function fmtEok(v) { return v == null ? '-' : (v / 1e8).toFixed(1) + '억'; }

  function escapeHtml(s) { return global.NineUI.escapeHtml(s); }
  function escapeAttr(s) { return escapeHtml(s); }

  // 전체화면 헤더에서도 같은 종목 선택 경로를 호출한다. 차트 패널은 기존 모달이
  // 이동시킨 DOM 그대로 두므로 전체화면과 수동 작도가 유지된다.
  function fullscreenSelection(query) {
    var container = document.querySelector('#stock-search-original') || document.querySelector('#stock-search');
    if (!container) return null;
    var needle = String(query || '').trim().toLowerCase();
    if (!needle) return null;
    if (/^US:/i.test(String(state.selectedCode || ''))) {
      var symbol = String(query || '').trim().replace(/^US:/i, '').toUpperCase();
      var usMatch = LOCAL_US_SYMBOLS.filter(function (row) {
        return row.symbol === symbol || row.name.toLowerCase() === needle || row.aliases.toLowerCase().indexOf(needle) !== -1;
      })[0];
      if (usMatch) symbol = usMatch.symbol;
      if (!global.UsStocks || !global.UsStocks.selectChartInFullscreen(symbol)) return null;
      state.selectedCode = 'US:' + symbol;
      state.selectedName = localizedUsName(symbol, usMatch && usMatch.name);
      var usSelection = { code: state.selectedCode, name: state.selectedName };
      document.dispatchEvent(new CustomEvent('nine-stock-selection', { detail: usSelection }));
      return usSelection;
    }
    var map = applyDomesticListingFallbacks();
    var match = Object.keys(map).filter(function (name) {
      return name.toLowerCase() === needle || String(map[name]).toLowerCase() === needle;
    })[0] || Object.keys(map).filter(function (name) { return name.toLowerCase().indexOf(needle) !== -1; })[0];
    if (!needle || !match) return null;
    var item = (state.lastResults || []).filter(function (row) { return row.code === map[match]; })[0]
      || { name: match, code: map[match], price: null, changeRate: null, sectors: lookupSectors(map[match]) };
    selectStock(container, item);
    return { code: item.code, name: item.name, price: item.price, changeRate: item.changeRate };
  }

  function fullscreenAdjacent(direction) {
    if (/^US:/i.test(String(state.selectedCode || ''))) {
      var usIndex = LOCAL_US_SYMBOLS.findIndex(function (row) { return 'US:' + row.symbol === state.selectedCode; });
      if (usIndex < 0) return null;
      return fullscreenSelection('US:' + LOCAL_US_SYMBOLS[(usIndex + direction + LOCAL_US_SYMBOLS.length) % LOCAL_US_SYMBOLS.length].symbol);
    }
    var rows = state.lastResults && state.lastResults.length > 1 ? state.lastResults : Object.keys(applyDomesticListingFallbacks()).map(function (name) {
      return { name: name, code: global.KRX_MAP[name] };
    }).sort(function (a, b) { return a.code.localeCompare(b.code); }).filter(function (row, index, all) {
      return index === 0 || row.code !== all[index - 1].code;
    });
    var index = rows.findIndex(function (row) { return row.code === state.selectedCode; });
    if (index < 0 || !rows.length) return null;
    var item = rows[(index + direction + rows.length) % rows.length];
    return fullscreenSelection(item.code);
  }

  global.StockSearch = { init: init };
  if (global.StockSearch) {
    global.StockSearch.fullscreenSelection = fullscreenSelection;
    global.StockSearch.fullscreenAdjacent = fullscreenAdjacent;
    global.StockSearch.currentSelection = function () {
      var item = (state.lastResults || []).filter(function (row) { return row.code === state.selectedCode; })[0] || {};
      var quote = state.liveQuotes[state.selectedCode] || item;
      if (/^US:/i.test(state.selectedCode || '') && global.UsStocks && global.UsStocks.currentQuote) {
        var usQuote = global.UsStocks.currentQuote();
        if (usQuote && 'US:' + usQuote.symbol === state.selectedCode) quote = { price: usQuote.price, changeRate: usQuote.change_rate };
      }
      return { code: state.selectedCode, name: state.selectedName || localizedUsName(state.selectedCode),
        price: quote.price, changeRate: quote.changeRate };
    };
  }
  global.StockSearchChart = { mount: mountExternalChart, updateQuote: updateLiveChartQuote };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
