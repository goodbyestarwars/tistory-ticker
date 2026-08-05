/**
 * 코스피 선물(주간·야간) 페이지 - 코스피200 주간선물/야간선물을 큰 차트 2개로 보여준 뒤,
 * AI가 "선물 간 관계와 현물지수와의 연관성, 특히 야간선물이 다음 거래일 한국 증시에
 * 미치는 영향" 관점으로 해설한다.
 *
 * 2026-07-16 신설. js/overnight-market.js(구 간밤 시황)에서 코스피200 야간선물 카드를
 * 분리해 이 페이지로 옮기고, 코스피200 주간선물을 새로 추가했다.
 *
 * 2026-07-16(2차): 사용자 요청으로 코스피 현물지수 카드를 제거하고 선물(주간+야간)만
 * 남겼다 - 관심지수 리본(js/quick-indices.js)에 코스피 현물이 항상 떠 있어 이 페이지에서
 * 또 보여주는 게 중복이라는 판단. VM도 더는 코스피 현물지수를 수집하지 않는다
 * (scripts/cloud-vm/domestic_futures.py 상단 주석 참고).
 *
 * 데이터 소스:
 * - 코스피200 주간선물(KOSPI200_DAY): 네이버 API, VM이 현재가+최근 90일 일봉 수집
 *   (scripts/cloud-vm/domestic_futures.py).
 * - 코스피200 야간선물(KOSPI200_NIGHT): 한국투자증권(KIS) API, VM이 웹소켓으로 상시 수집
 *   (scripts/cloud-vm/night_futures_ws.py) - js/overnight-market.js와 동일 소스.
 * 둘 다 VM의 /futures 엔드포인트 하나로 묶여서 나온다(js/overnight-market.js와 동일 API,
 * 이 페이지가 쓰는 심볼만 다름).
 *
 * AI 해설은 GAS(gas/ticker-proxy.gs의 getKospiFuturesAnalysis, ?action=kospiFuturesAnalysis)가
 * /futures 응답을 프롬프트에 그대로 넣어 생성 - 화면 숫자와 AI 문장이 어긋나지 않도록 소스를
 * 통일했다(과거 코스피 100배 버그로 AI가 엉뚱한 숫자를 지어낸 전례 있음).
 *
 * 2026-07-22: AI 해설(getKospiFuturesAnalysis)이 /option-flow 응답도 같이 받아 콜/풋 OI
 * 동향(신규 진입/청산, 상승·하락 어느 쪽 심리가 우세한지)까지 해석해서 문장에 포함하도록 확장했다
 * - 참고의견(buildAiSection)과 옵션 수급 원자료(buildOptionSection)는 한 차례 한 섹션으로
 * 합쳤다가, 페이지 흐름(참고의견 -> 지수 -> 차트 -> 옵션 원자료)을 위해 다시 분리했다
 * (buildAiSection은 최상단 단독 섹션, buildOptionSection은 차트 다음 맨 아래).
 *
 * 큰 차트는 js/foreign-flow.js의 renderLwChart 패턴(캔들스틱, 크로스헤어 활성화, 축 표시)을
 * 그대로 재사용한다 - js/overnight-market.js의 축 없는 스파크라인과 다르게 여기는 인터랙션을
 * 전부 열어둔 큰 차트가 필요해서다.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#kospi-futures';
  var FUTURES_API = 'https://goodbyestar.cloud/futures';
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FETCH_TIMEOUT_MS = 10000;
  // 분봉 응답은 심볼당 최대 1500봉(db_schema.load_future_chart_minute)이라 일봉보다 훨씬 커서
  // 10초로는 장중에 자주 타임아웃됐다(2026-07-31 "시간이 너무 오래걸려서 뜬다" 신고) -
  // 아래 payload 축소와 함께 분봉 요청만 타임아웃을 더 넉넉하게 준다.
  var MINUTE_FETCH_TIMEOUT_MS = 25000;
  // 서버(VM)의 분봉 수집 주기가 5분이라(domestic_futures.py의 _MINUTE_REFRESH_INTERVAL,
  // night_futures_ws.py도 동일) 30초마다 다시 받아도 대부분 같은 데이터다 - 자동 새로고침에서는
  // 최소 이 간격으로만 재요청한다(재시도 버튼처럼 사용자가 직접 요청하면 즉시 재요청).
  var MINUTE_MIN_REFETCH_MS = 60000;
  var REFRESH_INTERVAL_MS = 30000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var CHART_HEIGHT = 420;
  // Lightweight Charts는 UNIX 타임스탬프의 시:분을 표시할 때 항상 UTC 기준으로 읽는다(라이브러리
  // 문서화된 동작 - js/stock-search.js가 2026-08-05에 분봉 X축에서 먼저 확인·수정한 것과 동일
  // 원인). 서버(domestic_futures.py/night_futures_ws.py)의 분봉 ts는 정확히 변환된 진짜 UTC초라서
  // 그대로 넣으면 X축에 KST보다 9시간 이른 시각(예: 09:30 대신 00:30)이 찍힌다 - "KST 시:분
  // 숫자를 UTC인 척" 보여줘야 화면에 실제 거래소 시각이 그대로 나오므로, renderChartPanel에서
  // 분봉 point를 만들 때 진짜 UTC초에 이 오프셋을 더해 넣는다(stock-search.js의 문자열+'Z' 트릭과
  // 목적은 같고 시작 표현만 다름 - 여긴 이미 true UTC초라 9시간을 더해 되돌린다).
  var KST_OFFSET_SEC = 9 * 60 * 60;

  var PANEL_ORDER = ['KOSPI200_DAY', 'KOSPI200_NIGHT'];
  var PANEL_LABELS = {
    KOSPI200_DAY: '코스피200 주간선물',
    KOSPI200_NIGHT: '코스피200 야간선물'
  };
  // buildStatBody/updateMarketStatusBadges가 심볼 -> 세션 종류를 찾을 때 쓴다(아래 isMarketOpen).
  var PANEL_KEY_BY_SYMBOL = { KOSPI200_DAY: 'day', KOSPI200_NIGHT: 'night' };
  // 이 페이지가 실제로 쓰는 심볼만 서버에 요청한다 - /futures는 코스피/코스닥·미국지수·원자재·
  // 환율·채권·코인까지 21개 심볼을 한 번에 주는 공용 엔드포인트인데, 이 페이지는 선물 2개만
  // 쓰면서 나머지 19개 심볼의 일봉까지 매번 받아 응답이 필요 이상으로 컸다(2026-07-31).
  // symbols를 모르는 구버전 서버에 붙어도 파라미터가 무시되고 기존 전체 응답이 와서 동작은 같다.
  var PAGE_SYMBOLS = PANEL_ORDER.join(',');
  var DAY_RANGE = 250; // 기존 90일 -> 약 1년으로 확대(VM domestic_futures.py 기본 수집 범위와 일치)
  var INTERVAL_LABELS = { minute: '분봉', day: '일봉', week: '주봉' };
  // 2026-07-16: 야간선물도 분봉 지원 추가 - 처음엔 KIS에 소스가 없다고 판단했었으나 공식
  // 예제 저장소에서 TR(FHKIF03020200)을 찾아 실측 확인함(night_futures_ws.py 참고).
  var CHARTS = [
    { key: 'day', symbol: 'KOSPI200_DAY', elId: 'kfChartDay', label: '코스피200 주간선물', intervals: ['minute', 'day', 'week'] },
    { key: 'night', symbol: 'KOSPI200_NIGHT', elId: 'kfChartNight', label: '코스피200 야간선물', intervals: ['minute', 'day', 'week'] }
  ];
  var OPTION_FLOW_API = 'https://goodbyestar.cloud/option-flow';

  var CHART_EL_BY_KEY = {};
  CHARTS.forEach(function (c) { CHART_EL_BY_KEY[c.key] = c.elId; });

  // 섹션별 펼침/접힘 - localStorage에 저장해 다음 방문에도 유지(예: 야간에는 주간선물을
  // 접어두면 다음에 들어와도 접힌 채로 시작). 기본은 둘 다 펼침.
  function collapseKey(chartKey) { return 'kf_collapsed_' + chartKey + '_v1'; }
  function loadCollapsed(chartKey) {
    try { return localStorage.getItem(collapseKey(chartKey)) === '1'; } catch (err) { return false; }
  }
  function saveCollapsed(chartKey, collapsed) {
    try { localStorage.setItem(collapseKey(chartKey), collapsed ? '1' : '0'); } catch (err) { /* 무시 */ }
  }

  var lwcLoadPromise = null;
  var chartInstances = {}; // key -> { chart, series }
  var themeObserver = null;
  var refreshTimer = null;
  // key -> { interval, dayItem(마지막 일봉 fetch 결과), minuteRows(마지막 분봉 fetch 결과) }
  var panelState = {};
  CHARTS.forEach(function (c) { panelState[c.key] = { interval: c.intervals[0] === 'minute' ? 'day' : c.intervals[0], dayItem: null, minuteRows: null }; });

  function loadLightweightCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcLoadPromise) return lwcLoadPromise;
    lwcLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LWC_CDN;
      s.onload = function () { resolve(global.LightweightCharts); };
      s.onerror = function () { lwcLoadPromise = null; reject(new Error('차트 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return lwcLoadPromise;
  }

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  // opts: { symbols: 'A,B'(응답에 실을 심볼 제한), timeoutMs }
  function fetchFutures(interval, days, opts) {
    var options = opts || {};
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    var url = FUTURES_API + '?interval=' + (interval || 'day') + '&days=' + (days || DAY_RANGE)
      + (options.symbols ? '&symbols=' + encodeURIComponent(options.symbols) : '');
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('futures API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || [];
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchAiSummary() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?action=kospiFuturesAnalysis', hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data && data.analysis;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    return v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtSigned(v, digits) {
    if (v == null || isNaN(v)) return '-';
    return (v > 0 ? '+' : '') + v.toFixed(digits == null ? 2 : digits);
  }

  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('ko-KR', { hour12: false });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 2026-08-05 요청: "(장 마감)" 배지 - 주간선물 정규장은 09:00~15:45(옵션 수급 설명문의
  // "정규장(09:00~15:45)"과 동일 값, 사용자 확인). 야간선물은 평일 18:00~익일 05:00
  // (js/kospi-futures.js 헤더 주석·night_futures_ws.py와 동일 값).
  //
  // js/quick-indices.js에도 비슷한 marketStatus()가 있지만 그쪽은 야간선물 판정에서 요일을
  // 안 따져(mins만 봄) 토요일 저녁·일요일 새벽처럼 실제로는 세션이 없는 구간도 "실시간"으로
  // 잘못 표시한다 - 사용자가 명시적으로 "주말에는 휴장"을 요구해서 여기서는 정확히 따진다.
  // 야간선물은 "평일 저녁에 열려 다음날 새벽에 닫히는" 세션이라 시작(그날이 평일 저녁)과
  // 종료(전날이 평일이었던 새벽, 즉 오늘이 화~토)를 따로 확인해야 토요일 밤(금요일 세션의
  // 정상 연장)은 열림으로, 일요일 새벽(토요일엔 세션이 없었으므로)은 닫힘으로 구분된다.
  function isMarketOpen(panelKey) {
    // Date.now()는 방문자 위치와 무관하게 항상 UTC epoch ms라서, 9시간을 더하면 방문자
    // 로컬 시간대와 상관없이 정확한 KST 시각이 나온다(js/quick-indices.js와 동일 기법).
    var kst = new Date(Date.now() + 9 * 60 * 60000);
    var day = kst.getUTCDay(); // 0=일요일 ... 6=토요일
    var mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var isWeekday = day >= 1 && day <= 5;
    if (panelKey === 'day') {
      return isWeekday && mins >= 9 * 60 && mins < 15 * 60 + 45;
    }
    var eveningOpen = isWeekday && mins >= 18 * 60;
    var earlyMorningOpen = day >= 2 && day <= 6 && mins < 5 * 60;
    return eveningOpen || earlyMorningOpen;
  }

  // 가격 fetch 성공/실패와 무관하게(시각은 API 응답 없이도 계산 가능) 항상 최신 상태를
  // 반영하도록 배지 갱신을 렌더 결과가 아니라 별도 타이머(REFRESH_INTERVAL_MS)로 돌린다.
  function updateMarketStatusBadges(container) {
    PANEL_ORDER.forEach(function (symbol) {
      var badge = container.querySelector('.kf-stat-status[data-symbol="' + symbol + '"]');
      if (!badge) return;
      var panelKey = PANEL_KEY_BY_SYMBOL[symbol];
      badge.textContent = panelKey && !isMarketOpen(panelKey) ? '(장 마감)' : '';
    });
  }

  function buildShell() {
    var panelCards = PANEL_ORDER.map(function (symbol) {
      return '<div class="kf-stat-card" data-symbol="' + symbol + '">'
        + '<div class="kf-stat-label">' + escapeHtml(PANEL_LABELS[symbol])
        + ' <span class="kf-stat-status" data-symbol="' + symbol + '"></span></div>'
        + '<div class="kf-stat-body kf-loading">불러오는 중...</div>'
        + '</div>';
    }).join('');

    var sections = CHARTS.map(function (c) {
      var toggleHtml = '<div class="kf-interval-toggle" data-chart-key="' + c.key + '">' + c.intervals.map(function (iv) {
        return '<button type="button" class="kf-interval-btn' + (iv === panelState[c.key].interval ? ' active' : '') + '" data-interval="' + iv + '">' + INTERVAL_LABELS[iv] + '</button>';
      }).join('') + '</div>';
      var collapsed = loadCollapsed(c.key);
      return '<div class="kf-section' + (collapsed ? ' kf-collapsed' : '') + '" data-section-key="' + c.key + '">'
        + '<div class="kf-section-head">'
        + '<div class="kf-section-title">' + escapeHtml(c.label) + '</div>'
        + '<button type="button" class="kf-collapse-btn" data-chart-key="' + c.key + '" aria-label="펼치기/접기">' + (collapsed ? '▸' : '▾') + '</button>'
        + '</div>'
        + '<div class="kf-section-body">'
        + toggleHtml
        + '<div class="kf-chart" id="' + c.elId + '" style="height:' + CHART_HEIGHT + 'px"></div>'
        + '</div>'
        + '</div>';
    }).join('');

    return ''
      + buildAiSection()
      + '<div class="kf-panel" id="kfPanel">' + panelCards + '</div>'
      + sections
      + buildOptionSection();
  }

  // ---- 참고의견(선물 AI 해설) ----
  // 2026-07-22: AI 해설(getKospiFuturesAnalysis)이 옵션 OI 데이터도 같이 받아 콜/풋 포지션
  // 해석까지 문장에 포함한다(gas/ticker-proxy.gs 참고) - 그래서 이 박스 자체는 "선물"만이
  // 아니라 "선물+옵션" 해설이지만, 페이지 흐름상(참고의견 -> 지수 -> 차트 -> 옵션 원자료)
  // 최상단에 단독 섹션으로 둔다(사용자 요청, 한 차례 옵션 카드와 합쳤다가 다시 분리함).
  function buildAiSection() {
    return '<div class="kf-section" data-section-key="ai">'
      + '<div class="kf-section-head"><div class="kf-section-title">💬 참고의견</div></div>'
      + '<div class="kf-ai" id="kfAi" hidden></div>'
      + '</div>';
  }

  // ---- 옵션 수급(콜/풋 OI 원자료) ----
  // 외국인/기관/개인별 신규·청산 분리는 KIS/키움 어디에도 그런 API가 없어(2026-07-16 조사)
  // 콜 전체/풋 전체 단위로만 "미결제약정(OI) 증감" 기준 신규·청산 우세를 원자료 카드로 보여준다 -
  // 개별 투자자 매수/매도 방향까지는 알 수 없다는 걸 설명 문구로 명시한다.
  var OPTION_SIDES = [
    { key: 'CALL', label: '콜옵션' },
    { key: 'PUT', label: '풋옵션' }
  ];

  function buildOptionSection() {
    var cards = OPTION_SIDES.map(function (s) {
      return '<div class="kf-opt-card" data-side="' + s.key + '">'
        + '<div class="kf-opt-title">' + escapeHtml(s.label) + '</div>'
        + '<div class="kf-opt-body kf-loading">불러오는 중...</div>'
        + '</div>';
    }).join('');
    return '<div class="kf-section" data-section-key="option">'
      + '<div class="kf-section-head"><div class="kf-section-title">옵션 수급</div></div>'
      + '<div class="kf-opt-grid" id="kfOptGrid">' + cards + '</div>'
      + '<div class="kf-opt-desc">투자자 유형(외국인·기관·개인)별 매수·매도 구분 데이터는 제공하는 곳이 없어, '
      + '콜/풋 전체 미결제약정(OI) 증감으로 포지션 방향을 추정해서 보여드립니다. 콜옵션은 상승 포지션, 풋옵션은 '
      + '하락 포지션으로 보고, OI가 늘면 신규 진입(포지션 확대), 줄면 청산(포지션 정리)으로 표시합니다 - '
      + '단순 순매수/순매도 부호만으로 상승·하락을 단정하지 않고 신규/청산을 구분해서 보여드리는 방식입니다. '
      + '옵션은 야간선물과 달리 야간 세션이 없어 정규장(09:00~15:45)에만 값이 바뀌고, '
      + '장 마감 후에는 마지막 값이 그대로 표시됩니다.</div>'
      + '</div>';
  }

  // 2026-07-20: 콜은 정상 거래되는데 풋만 거래량 0(+OI증감 0)이 종일 이어지는 현상을
  // 실측 확인(전광판 TR/개별종목조회 TR 둘 다 동일값 - KIS 쪽 데이터 문제로 추정, 원인
  // 불명). 이 상태를 "보합"(실제로 거래됐는데 방향성이 없다는 뜻)으로 보여주면 오해를
  // 유발하므로, 거래량 자체가 0이면 "데이터 미제공"으로 구분해서 보여준다.
  //
  // 2026-07-21: "옵션 수급 표현 방식 개선 작업지시서" 반영 - 예전엔 순값 부호만 보고
  // "신규 진입 우세"/"청산 우세"라고만 표시했는데, 콜/풋 어느 쪽인지를 안 섞어서 보면
  // "청산"이 실제로는 상승(콜)/하락(풋) 중 어느 방향 포지션이 청산되는 건지 알 수 없어
  // 오해 소지가 있었다. 지시서는 투자자 유형별 매수/매도-신규/청산 4분류 원 데이터를
  // 전제하지만 그런 세분화 API는 없다(위 buildOptionSection 설명문 참고) - 대신 이미
  // 갖고 있는 side(콜=상승 관련/풋=하락 관련)와 oi_change 부호(신규/청산)만으로 지시서의
  // "최종 상태 표시" 4개 라벨(상승 포지션 확대/청산, 하락 포지션 확대/청산)과 동일한
  // 결과를 만들 수 있어 그 방식으로 구현 - 매수/매도 거래량을 따로 추정하지 않는다.
  function optTendency(row, side) {
    if (!row) return { label: '-', cls: 'kf-zero' };
    if (!row.volume) return { label: '데이터 미제공', cls: 'kf-zero' };
    var oiChange = row.oi_change;
    if (oiChange == null) return { label: '-', cls: 'kf-zero' };
    var bullish = side === 'CALL';
    if (oiChange > 0) {
      return bullish
        ? { label: '📈 상승 포지션 확대', cls: 'kf-pos' }
        : { label: '📉 하락 포지션 확대', cls: 'kf-neg' };
    }
    if (oiChange < 0) {
      return bullish
        ? { label: '💰 상승 포지션 청산', cls: 'kf-pos kf-tendency-close' }
        : { label: '💰 하락 포지션 청산', cls: 'kf-neg kf-tendency-close' };
    }
    return { label: '보합', cls: 'kf-zero' };
  }

  function buildOptCardBody(row, side) {
    if (!row) return '<div class="kf-opt-body">데이터 없음</div>';
    var t = optTendency(row, side);
    var sign = row.oi_change > 0 ? '+' : '';
    return '<div class="kf-opt-body">'
      + '<span class="kf-opt-tendency ' + t.cls + '">' + t.label + '</span>'
      + '<div class="kf-opt-row"><span>거래량</span><b>' + Math.round(row.volume || 0).toLocaleString('ko-KR') + '</b></div>'
      + '<div class="kf-opt-row"><span>미결제약정(OI)</span><b>' + Math.round(row.oi || 0).toLocaleString('ko-KR') + '</b></div>'
      + '<div class="kf-opt-row"><span>OI 증감</span><b class="' + t.cls + '">' + sign + Math.round(row.oi_change || 0).toLocaleString('ko-KR') + '</b></div>'
      + '<div class="kf-opt-updated">업데이트 ' + fmtTime(row.updated_at) + '</div>'
      + '</div>';
  }

  function fetchOptionFlow() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(OPTION_FLOW_API, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('option-flow API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || {};
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function refreshOptionFlow(container) {
    KospiFutures.fetchOptionFlow().then(function (bySide) {
      OPTION_SIDES.forEach(function (s) {
        var card = container.querySelector('.kf-opt-card[data-side="' + s.key + '"]');
        if (!card) return;
        card.querySelector('.kf-opt-body').outerHTML = buildOptCardBody(bySide[s.key], s.key);
      });
    }).catch(function () {
      container.querySelectorAll('.kf-opt-card').forEach(function (card) {
        var body = card.querySelector('.kf-opt-body');
        if (body && body.classList.contains('kf-loading')) {
          body.outerHTML = '<div class="kf-opt-body kf-error">옵션 수급을 불러오지 못했어요.</div>';
        }
      });
    });
  }

  // 미결제약정(OI)은 야간선물(KIS 소스)만 값이 있음 - 주간선물(네이버)은 원래 OI를 안 줘서
  // item.oi가 null로 온다(정상, 에러 아님).
  function fmtOiLine(oi, oiChange) {
    if (oi == null) return '';
    var tone = oiChange > 0 ? 'kf-pos' : oiChange < 0 ? 'kf-neg' : 'kf-zero';
    var sign = oiChange > 0 ? '+' : '';
    return '<div class="kf-stat-oi">미결제약정 ' + Math.round(oi).toLocaleString('ko-KR')
      + (oiChange != null ? ' <span class="' + tone + '">(' + sign + Math.round(oiChange).toLocaleString('ko-KR') + ')</span>' : '')
      + '</div>';
  }

  function buildStatBody(item) {
    var hasPrice = item && typeof item.price === 'number';
    var tone = !hasPrice ? 'kf-zero' : item.change_rate > 0 ? 'kf-pos' : item.change_rate < 0 ? 'kf-neg' : 'kf-zero';
    var arrow = !hasPrice ? '' : item.change_rate > 0 ? '▲' : item.change_rate < 0 ? '▼' : '-';
    return ''
      + '<div class="kf-stat-body">'
      + '<div class="kf-stat-price ' + tone + '">' + (hasPrice ? fmtPrice(item.price) : '데이터 없음') + '</div>'
      + (hasPrice
        ? '<div class="kf-stat-change ' + tone + '">' + arrow + ' ' + fmtSigned(item.change, 2) + ' (' + fmtSigned(item.change_rate, 2) + '%)</div>'
        : '')
      + (hasPrice ? fmtOiLine(item.oi, item.oi_change) : '')
      + '<div class="kf-stat-updated">' + (hasPrice ? '업데이트 ' + fmtTime(item.updated_at) : '') + '</div>'
      + '</div>';
  }

  // js/foreign-flow.js의 lwcThemeOptions와 동일 패턴 - 9bolt 스킨 다크모드(html.dark 토글)를
  // MutationObserver로 감지해 차트에도 반영한다.
  function chartThemeOptions() {
    var dark = isDark();
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(js/overnight-market.js, js/foreign-flow.js와
      // 동일한 미해결 TODO - 사용자가 나중에 문서 만들 예정).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  function chartPriceFormatter(v) {
    return v == null || isNaN(v) ? '' : v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  function destroyChart(key) {
    var inst = chartInstances[key];
    if (!inst) return;
    if (inst.rangeSaveTimer) clearTimeout(inst.rangeSaveTimer);
    try { inst.chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
    delete chartInstances[key];
  }

  // ---- 확대·이동(zoom/pan) 구간 유지 ----
  // 2026-07-31: 확대해 둔 차트가 30초 자동 새로고침이나 페이지 새로고침 때마다 전체 구간으로
  // 되돌아간다는 신고 대응. 섹션 접힘(collapseKey)과 동일하게 localStorage에 차트별·주기별로
  // 보이는 구간을 저장하고 다시 그릴 때 복원한다(주기마다 따로 저장해 분봉/일봉/주봉이 서로
  // 확대 상태를 덮어쓰지 않게 한다).
  function rangeKey(chartKey, interval) { return 'kf_range_' + chartKey + '_' + interval + '_v1'; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // LWC 시간값은 분봉이면 epoch초(number), 일·주봉이면 'YYYY-MM-DD' 문자열인데
  // getVisibleRange()가 business day를 {year,month,day} 객체로 주는 경우도 있어 문자열로 통일한다.
  function normalizeTime(t) {
    if (typeof t === 'number' || typeof t === 'string') return t;
    if (t && t.year && t.month && t.day) return t.year + '-' + pad2(t.month) + '-' + pad2(t.day);
    return null;
  }

  // 같은 주기 안에서는 number끼리 또는 문자열끼리만 비교되므로(분봉=epoch초, 일·주봉=날짜문자열)
  // 문자열 비교로도 시간 순서가 그대로 유지된다.
  function timeLte(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a <= b;
    return String(a) <= String(b);
  }

  function loadSavedRange(chartKey, interval) {
    try {
      var raw = localStorage.getItem(rangeKey(chartKey, interval));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.from == null || parsed.to == null) return null;
      return parsed;
    } catch (err) { return null; }
  }

  function saveRange(chartKey, interval, range) {
    if (!range) return;
    var from = normalizeTime(range.from);
    var to = normalizeTime(range.to);
    if (from == null || to == null) return;
    try {
      localStorage.setItem(rangeKey(chartKey, interval), JSON.stringify({ from: from, to: to }));
    } catch (err) { /* 무시 */ }
  }

  // 저장된 구간이 지금 데이터 범위와 아예 겹치지 않으면(오래 지난 값) 전체 보기로 시작한다.
  function applySavedRange(chart, chartKey, interval, points) {
    var saved = loadSavedRange(chartKey, interval);
    if (saved && timeLte(saved.from, points[points.length - 1].time) && timeLte(points[0].time, saved.to)) {
      try {
        chart.timeScale().setVisibleRange({ from: saved.from, to: saved.to });
        return;
      } catch (err) { /* 아래 fitContent로 폴백 */ }
    }
    chart.timeScale().fitContent();
  }

  // 백엔드(KIS stck_bsop_date, 네이버 localDate)가 전부 'YYYYMMDD' 포맷을 주는데
  // Lightweight Charts는 business day 문자열로 'YYYY-MM-DD'(대시 포함)를 요구한다.
  function toLwcTime(yyyymmdd) {
    return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
  }

  // 일봉 배열을 ISO 주(월요일 시작) 단위로 묶어 주봉을 만든다 - 서버에 새 엔드포인트를
  // 만들지 않고 이미 받아온 일봉으로 클라이언트에서 처리(주봉 소스가 Naver에 없는 것도 실측
  // 확인됨 - domestic_futures.py 상단 주석 참고).
  function resampleWeekly(dailyRows) {
    var weeks = [];
    var byWeekKey = {};
    dailyRows.forEach(function (r) {
      var d = new Date(r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8) + 'T00:00:00');
      var dow = d.getDay() || 7; // 일요일(0) -> 7로 바꿔 월요일(1) 시작 주 계산
      var monday = new Date(d);
      monday.setDate(d.getDate() - dow + 1);
      var weekKey = monday.toISOString().slice(0, 10);
      var bucket = byWeekKey[weekKey];
      if (!bucket) {
        bucket = { time: weekKey, open: r.open, high: r.high, low: r.low, close: r.close };
        byWeekKey[weekKey] = bucket;
        weeks.push(bucket);
      } else {
        bucket.high = Math.max(bucket.high, r.high);
        bucket.low = Math.min(bucket.low, r.low);
        bucket.close = r.close;
      }
    });
    return weeks;
  }

  function renderBigChart(key, points, interval) {
    var container = document.getElementById(CHART_EL_BY_KEY[key]);
    if (!container) return;
    if (!points || points.length < 2) {
      destroyChart(key);
      container.innerHTML = '<div class="kf-chart-error">차트 데이터가 없습니다.</div>';
      return;
    }
    // 같은 주기 차트가 이미 살아 있으면 remove/재생성하지 않고 데이터만 갈아끼운다 -
    // 차트를 새로 만들면 사용자가 확대해 둔 구간이 매번 초기화되기 때문(setData는 현재
    // 보이는 구간을 유지한다). 캔버스 존재도 같이 확인한다 - 로딩·에러 문구로 innerHTML이
    // 덮인 뒤라면 인스턴스만 남고 DOM은 사라진 상태일 수 있다.
    var live = chartInstances[key];
    if (live && live.interval === interval && live.container === container && container.querySelector('canvas')) {
      try {
        live.series.setData(points);
        return;
      } catch (err) { /* 재사용 실패 시 아래에서 새로 만든다 */ }
    }
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;
      destroyChart(key);
      container.innerHTML = '';

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: CHART_HEIGHT,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: interval === 'minute', secondsVisible: false },
        localization: { priceFormatter: chartPriceFormatter }
      }, chartThemeOptions()));

      var series = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      series.setData(points);

      var inst = { chart: chart, series: series, interval: interval, container: container, rangeSaveTimer: null };
      chartInstances[key] = inst;
      applySavedRange(chart, key, interval, points);

      // 사용자가 확대·이동할 때마다 현재 구간을 저장(디바운스) - 페이지를 새로고침해도 복원된다.
      chart.timeScale().subscribeVisibleTimeRangeChange(function () {
        if (inst.rangeSaveTimer) clearTimeout(inst.rangeSaveTimer);
        inst.rangeSaveTimer = setTimeout(function () {
          if (chartInstances[key] !== inst) return;
          try { saveRange(key, interval, chart.timeScale().getVisibleRange()); } catch (err) { /* 무시 */ }
        }, 500);
      });
    }).catch(function () {
      container.innerHTML = '<div class="kf-chart-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // panelState[cfg.key].interval에 맞춰 캐시된 데이터로 다시 그린다(재요청 없음 - 일봉/주봉은
  // 이미 받아온 dayItem을, 분봉은 이미 받아온 minuteRows를 그대로 씀).
  function renderChartPanel(cfg) {
    var st = panelState[cfg.key];
    if (st.interval === 'minute') {
      var rows = (st.minuteRows || []).filter(function (r) { return r.ts != null; });
      // KST_OFFSET_SEC: 위 상수 설명 참고 - X축에 실제 거래소(KST) 시:분이 나오도록 보정.
      var points = rows.map(function (r) { return { time: r.ts + KST_OFFSET_SEC, open: r.open, high: r.high, low: r.low, close: r.close }; });
      renderBigChart(cfg.key, points, 'minute');
      return;
    }
    var dayRows = (st.dayItem && st.dayItem.chart) || [];
    if (st.interval === 'week') {
      var weekPts = resampleWeekly(dayRows);
      renderBigChart(cfg.key, weekPts, 'week');
      return;
    }
    var dayPts = dayRows.map(function (r) { return { time: toLwcTime(r.date), open: r.open, high: r.high, low: r.low, close: r.close }; });
    renderBigChart(cfg.key, dayPts, 'day');
  }

  var minuteInflight = null;  // 주간·야간 두 패널이 같은 분봉 응답 하나를 공유(예전엔 각자 따로 요청)
  var minuteFetchedAt = 0;

  // 분봉 요청은 이 함수 하나로만 나간다. 원래는 패널마다 30초마다 같은 요청을 각각 던져
  // (요청 2배 + 응답에 안 쓰는 심볼 19개 일봉까지 포함) 자주 타임아웃됐다 - 요청을 공유하고
  // days=1 + symbols로 payload를 줄이고, 서버 수집 주기(5분)를 감안해 재요청 간격도 둔다.
  // 반환값 true면 응답으로 캐시를 갱신했고, false면 최근 값이 있어 요청을 건너뛴 것이다.
  function fetchMinuteShared(force) {
    if (minuteInflight) return minuteInflight;
    if (!force && minuteFetchedAt && Date.now() - minuteFetchedAt < MINUTE_MIN_REFETCH_MS) {
      return Promise.resolve(false);
    }
    minuteInflight = KospiFutures.fetchFutures('minute', 1, {
      symbols: PAGE_SYMBOLS,
      timeoutMs: MINUTE_FETCH_TIMEOUT_MS
    }).then(function (items) {
      minuteFetchedAt = Date.now();
      minuteInflight = null;
      // 응답 하나에 두 심볼이 다 들어 있으니 요청한 패널만이 아니라 전부 갱신한다.
      CHARTS.forEach(function (c) {
        var item = (items || []).filter(function (it) { return it.symbol === c.symbol; })[0];
        if (item) panelState[c.key].minuteRows = item.chart || [];
      });
      return true;
    }).catch(function (err) {
      minuteInflight = null;
      throw err;
    });
    return minuteInflight;
  }

  // 2026-07-31: 30초 주기 자동 새로고침(refresh -> renderAll)도 interval이 'minute'이면
  // 매번 이 함수를 다시 타는데, 기존엔 요청 시작과 동시에 이미 떠 있던 차트를 지우고
  // "불러오는 중..."으로 덮었다가 실패하면 그대로 에러로 덮어써서 - 처음 로딩은 잘 되다가
  // 이후 새로고침 때 차트가 통째로 에러로 바뀌는 원인이었다. 일봉/주봉이 캐시된 dayItem을
  // 재사용하는 것과 같은 방식으로, 이미 받아온 minuteRows가 있으면 백그라운드에서 갱신만
  // 시도하고 실패해도 기존 차트를 그대로 둔다.
  function loadMinuteAndRender(cfg, force) {
    var container = document.getElementById(CHART_EL_BY_KEY[cfg.key]);
    var st = panelState[cfg.key];
    var hasCached = !!(st.minuteRows && st.minuteRows.length);
    if (container && !hasCached) container.innerHTML = '<div class="kf-chart-error">분봉 불러오는 중...</div>';
    fetchMinuteShared(force).then(function () {
      if (st.interval === 'minute') renderChartPanel(cfg);
    }).catch(function () {
      if (!hasCached && container && st.interval === 'minute') showMinuteError(cfg, container);
    });
  }

  // 최초 로딩 실패 때만 에러를 띄우고, 페이지 전체를 새로고침하지 않고 이 자리에서 다시 받을 수
  // 있게 재시도 버튼을 준다(새로고침은 다른 차트까지 다시 그리게 되므로).
  function showMinuteError(cfg, container) {
    container.innerHTML = '<div class="kf-chart-error">분봉을 불러오지 못했어요. '
      + '<button type="button" class="kf-retry-btn">다시 시도</button></div>';
    var btn = container.querySelector('.kf-retry-btn');
    if (btn) btn.addEventListener('click', function () { loadMinuteAndRender(cfg, true); });
  }

  function wireIntervalToggles(container) {
    container.querySelectorAll('.kf-interval-toggle').forEach(function (toggle) {
      var key = toggle.getAttribute('data-chart-key');
      var cfg = CHARTS.filter(function (c) { return c.key === key; })[0];
      if (!cfg) return;
      toggle.querySelectorAll('.kf-interval-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var interval = btn.getAttribute('data-interval');
          if (panelState[key].interval === interval) return;
          panelState[key].interval = interval;
          toggle.querySelectorAll('.kf-interval-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
          if (interval === 'minute' && !(panelState[key].minuteRows && panelState[key].minuteRows.length)) {
            loadMinuteAndRender(cfg);
          } else {
            renderChartPanel(cfg);
          }
        });
      });
    });
  }

  function renderAll(container, items) {
    var bySymbol = {};
    items.forEach(function (item) { bySymbol[item.symbol] = item; });

    PANEL_ORDER.forEach(function (symbol) {
      var card = container.querySelector('.kf-stat-card[data-symbol="' + symbol + '"]');
      if (!card) return;
      card.querySelector('.kf-stat-body').outerHTML = buildStatBody(bySymbol[symbol]);
    });

    CHARTS.forEach(function (cfg) {
      panelState[cfg.key].dayItem = bySymbol[cfg.symbol];
      if (panelState[cfg.key].interval === 'minute') {
        loadMinuteAndRender(cfg);
      } else {
        renderChartPanel(cfg);
      }
    });
  }

  function refresh(container) {
    return KospiFutures.fetchFutures('day', DAY_RANGE, { symbols: PAGE_SYMBOLS })
      .then(function (items) { renderAll(container, items); })
      .catch(function () {
        PANEL_ORDER.forEach(function (symbol) {
          var card = container.querySelector('.kf-stat-card[data-symbol="' + symbol + '"]');
          if (!card) return;
          var body = card.querySelector('.kf-stat-body');
          if (body && body.classList.contains('kf-loading')) {
            body.outerHTML = '<div class="kf-stat-body kf-error">시세를 불러오지 못했어요.</div>';
          }
        });
      });
  }

  function renderAiSummary(container) {
    var box = container.querySelector('#kfAi');
    if (!box) return;
    KospiFutures.fetchAiSummary()
      .then(function (text) {
        if (!text) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = '<p>' + escapeHtml(text) + '</p>';
      })
      .catch(function () { box.hidden = true; });
  }

  // 접힌 상태에서는 차트 컨테이너가 display:none이라 LWC의 autoSize(ResizeObserver)가
  // 정상적으로 크기를 못 잡을 수 있어, 펼칠 때마다 기존 인스턴스를 버리고 다시 만든다
  // (이미 받아온 데이터를 그대로 쓰므로 재요청 없음 - renderChartPanel 참고. 확대해 둔
  // 구간은 localStorage에서 복원되므로 다시 만들어도 그대로 유지된다 - applySavedRange).
  function wireCollapseToggles(container) {
    container.querySelectorAll('.kf-collapse-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-chart-key');
        var section = container.querySelector('.kf-section[data-section-key="' + key + '"]');
        var cfg = CHARTS.filter(function (c) { return c.key === key; })[0];
        if (!section || !cfg) return;
        var collapsed = !section.classList.contains('kf-collapsed');
        section.classList.toggle('kf-collapsed', collapsed);
        btn.textContent = collapsed ? '▸' : '▾';
        saveCollapsed(key, collapsed);
        if (!collapsed) {
          destroyChart(key);
          renderChartPanel(cfg);
        }
      });
    });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    wireIntervalToggles(container);
    wireCollapseToggles(container);
    updateMarketStatusBadges(container); // 가격 fetch를 기다리지 않고 바로 표시

    // 차트 라이브러리(CDN)를 데이터 요청과 동시에 받기 시작한다 - 예전엔 /futures 응답이
    // 온 뒤에야 renderBigChart에서 처음 로드해서 첫 차트까지 CDN 왕복이 직렬로 한 번 더
    // 붙었다(2026-07-31 첫 로딩 지연 신고). 실패 처리는 renderBigChart가 그대로 담당한다.
    loadLightweightCharts().catch(function () { /* renderBigChart에서 문구 표시 */ });

    refreshOptionFlow(container);

    // AI 해설(GAS)은 생성에 수십 초가 걸릴 수 있고 서버에서 /futures와 /option-flow를 또
    // 호출하므로, 차트 데이터가 먼저 도착하도록 뒤로 미룬다 - 차트 응답이 끝나는 즉시, 늦어도
    // 3초 뒤에는 시작한다(차트 요청이 실패·지연돼도 참고의견이 안 뜨는 일은 없게).
    var aiStarted = false;
    function startAi() {
      if (aiStarted) return;
      aiStarted = true;
      renderAiSummary(container);
    }
    refresh(container).then(startAi);
    setTimeout(startAi, 3000);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      refresh(container);
      refreshOptionFlow(container);
      updateMarketStatusBadges(container);
    }, REFRESH_INTERVAL_MS);

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      Object.keys(chartInstances).forEach(function (key) {
        chartInstances[key].chart.applyOptions(chartThemeOptions());
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  var KospiFutures = {
    init: init,
    fetchFutures: fetchFutures,
    fetchAiSummary: fetchAiSummary,
    fetchOptionFlow: fetchOptionFlow
  };
  global.KospiFutures = KospiFutures;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
