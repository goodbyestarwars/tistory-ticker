/**
 * 종목별 외국인·기관 수급 조회 위젯
 * 종목명 검색(기존 KRX_MAP 자동완성 재사용) -> GAS 프록시 ?action=foreignFlow&code= 호출 ->
 * 롤링 합산 표 + 순매매량 라인차트 + 외국인 보유율 미니차트 렌더링.
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * 서버 캐시 없음(온디맨드 크롤링) - 대신 이 스크립트가 종목별 5분 메모리 캐시로
 * 같은 종목 반복 조회를 디바운스한다(네이버 부하/GAS 호출량 억제).
 *
 * 공매도/대차거래/연기금 섹션(ff-extra-*):
 * 2026-07-13: GAS ?action=investorFlow 경유 방식은 폐기됨 - GAS->VM 구간이 간헐적으로
 * 통째로 막히는 원인 불명 현상이 있어, 브라우저가 VM(키움 REST API 상시 서버, HTTPS
 * 도메인)을 직접 호출하도록 바꿈(CORS로 이 블로그 도메인만 허용). VM은 종목코드 제한이
 * 없어 전 종목 커버(예전 data/investor-flow-cache.js 정적 스냅샷은 섹터풀 238종목만
 * 커버했음 - 폐기). 실패 시(네트워크 오류 등) 안내 문구만 표시(에러 아님, 조용히 생략하지
 * 않고 이유를 보여준다).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var KIWOOM_VM_URL = 'https://goodbyestar.cloud';
  var CONTAINER_SELECTOR = '#foreign-flow';
  var FETCH_TIMEOUT_MS = 20000; // 네이버 2페이지 크롤링 + 파싱이라 여유 있게
  var MAX_SUGGESTIONS = 8;
  var CLIENT_CACHE_MS = 5 * 60 * 1000;
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var KRX_MAP_JS = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
  var krxMapPromise = null;

  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙)
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code, cls) {
    if (!code) return '';
    return '<img class="' + cls + '" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  var CHART_W = 820;
  var CHART_H = 280;
  var RATIO_H = 120;
  var PAD = { l: 68, r: 16, t: 16, b: 30 };

  var FCHART_H = 360;
  var MA_COLORS = { ma5: '#d24f45', ma20: '#1261c4', ma60: '#0ca678' };
  var MA_WIDTHS = { ma5: 1, ma20: 1, ma60: 1, ma224: 3 };
  var ICHIMOKU_CLOUD_FILL = 'rgba(135,206,235,0.24)';
  var ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)';
  // 224일선은 다른 이평선과 구분되는 장기 추세선이라 검은색+굵게(사용자 요청, 2026-07-22) -
  // 다만 순검은색은 다크모드 차트 배경(#222)에서 안 보이므로 테마에 따라 흰색으로 바꿔준다.
  function ma224Color() {
    return document.documentElement.classList.contains('dark') ? '#f1f3f5' : '#000000';
  }
  // 일목균형표는 선행스팬 1·2 사이 구간만 파란색 구름으로 표시하고 경계선은 숨긴다.

  // TradingView Lightweight Charts(오픈소스, CDN 지연 로드) - 가격 캔들차트 렌더링 엔진.
  // 손으로 그리던 SVG 캔들차트를 대체 - 확대/축소·패닝·크로스헤어를 라이브러리가 제공.
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var lwcLoadPromise = null;
  var lwcChart = null;         // 현재 렌더된 차트 인스턴스(재검색 시 정리용)
  var lwcChartContainer = null;
  var lwcThemeObserver = null; // html.dark 토글에 맞춰 차트 색상 실시간 갱신
  var lwcMarkers = null;       // v5 Series Markers 플러그인

  function resizeForeignFlowChart() {
    if (!lwcChart || !lwcChartContainer || !lwcChart.resize) return;
    global.requestAnimationFrame(function () {
      if (!lwcChart || !lwcChartContainer) return;
      var width = lwcChartContainer.clientWidth;
      var height = lwcChartContainer.clientHeight;
      if (width > 0 && height > 0) {
        try {
          lwcChart.resize(width, height);
          var panes = lwcChart.panes ? lwcChart.panes() : [];
          if (panes.length > 1) {
            var subHeight = Math.max(42, Math.round(height * 0.14));
            if (panes[0].setHeight) panes[0].setHeight(Math.max(220, height - subHeight * (panes.length - 1)));
            panes.slice(1).forEach(function (pane) { if (pane.setHeight) pane.setHeight(subHeight); });
          }
        } catch (e) { /* 레이아웃 정리 후 다음 요청에서 재시도 */ }
      }
    });
  }
  global.addEventListener('tistory-chart-resize', resizeForeignFlowChart);

  var cacheByCode = {};   // code -> { t, data }
  var inflightByCode = {}; // code -> Promise
  var flowChartCache = {};    // code -> { t, data }
  var flowChartInflight = {}; // code -> Promise
  var investorFlowCache = {};    // code -> { t, data }
  var investorFlowInflight = {}; // code -> Promise
  var quoteCache = {};    // code -> { t, data } - 헤더 현재가용
  var quoteInflight = {}; // code -> Promise
  var fundamentalsCache = {};    // code -> GAS ?action=fundamentals 응답(당일 내내 유효, 새로고침 시 초기화)
  var fundamentalsInflight = {}; // code -> Promise
  var newsMomentumCache = {};    // code -> VM news_momentum.db 조회 결과
  var newsMomentumInflight = {}; // code -> Promise
  var activeView = 'flow';       // 'flow' | 'apt' | 'chart' | 'fundamentals' | 'momentum'

  // ---- 종합 점수 요약 박스용 (수급/공매도/연기금/기술적 점수 + AI 한줄요약) ----
  var PENSION_TONE_SCORE = {
    very_positive: 90, positive: 75, neutral_positive: 60, neutral: 50, caution: 25
  };
  // 연기금 해석 라벨 뱃지 색: 비중 확대 쪽(긍정)은 매수 색, 비중 축소 쪽(경계)은 매도 색
  var TONE_BADGE_CLASS = {
    very_positive: 'ff-badge-buy', positive: 'ff-badge-buy', neutral_positive: 'ff-badge-buy',
    neutral: 'ff-badge-neutral', caution: 'ff-badge-sell'
  };
  // 공매도 압박 등급(약함=안전)을 위 톤 팔레트에 얹어서 색만 재사용.
  // '위험'(2026-07-22): KRX 공매도 과열종목 지정 + 실제 주가 하락 + 공매도/대차잔고 증가가
  // 전부 겹칠 때만 뜨는 별도 승격 등급(investor_flow.py apply_danger_override) - 100점
  // 계산상의 '매우 강함'과 같은 톤(caution)을 쓰되 라벨 자체로 구분한다.
  var SHORT_GRADE_TONE = {
    '매우 약함': 'very_positive', '약함': 'positive', '보통': 'neutral',
    '강함': 'caution', '매우 강함': 'caution', '위험': 'caution'
  };

  // ---- 차트 흐름별 탐색 ----
  // 기존 daily_scan의 swing assessment를 화면에서 탐색하기 위한 표현 메타데이터다.
  // 새 점수·추천·판정식을 만들지 않고, 서버가 제공한 6개 흐름 그룹만 표시한다.
  var FLOW_META = [
    { key: 'upturn', label: '상방 변곡 감지', tone: 'up', description: '하락·횡보 뒤 상승 전환 초기 구조를 탐색합니다.', line: 'M4 36 C18 35 24 30 34 31 S48 26 58 27 S71 16 82 12', aria: '하락 뒤 반등하는 개념 라인' },
    { key: 'uptrend_resume', label: '상승 추세 재개', tone: 'up', description: '상승 흐름의 눌림 뒤 다시 방향을 회복한 구조입니다.', line: 'M4 30 C17 27 23 18 35 22 S48 30 57 19 S70 10 82 8', aria: '눌림 뒤 상승을 재개하는 개념 라인' },
    { key: 'uptrend', label: '상승 추세 지속', tone: 'up', description: '고점과 저점이 함께 높아지는 상승 흐름입니다.', line: 'M4 32 L18 27 L29 29 L42 20 L54 23 L67 13 L82 7', aria: '고점과 저점이 함께 높아지는 개념 라인' },
    { key: 'compression', label: '수렴·압축', tone: 'neutral', description: '변동 폭이 줄어들며 방향을 기다리는 구조입니다.', line: 'M4 10 L20 15 L35 18 L50 22 L65 24 L82 26 M4 38 L20 33 L35 30 L50 28 L65 27 L82 26', aria: '변동 폭이 줄어드는 개념 라인' },
    { key: 'downturn', label: '하방 변곡 감지', tone: 'down', description: '상승·횡보 뒤 하락 전환이 감지된 구조입니다.', line: 'M4 10 C18 11 25 18 35 16 S49 20 58 25 S71 31 82 36', aria: '상승 뒤 하락 전환하는 개념 라인' },
    { key: 'downtrend', label: '하락 추세 지속', tone: 'down', description: '고점과 저점이 함께 낮아지는 하락 흐름입니다.', line: 'M4 8 L18 13 L29 11 L42 21 L54 18 L67 29 L82 36', aria: '고점과 저점이 함께 낮아지는 개념 라인' }
  ];
  var FLOW_SORT_META = [
    { key: 'signal', label: '신호 최신순' },
    { key: 'tradingValue', label: '거래대금순' },
    { key: 'volume', label: '거래량순' },
    { key: 'industry', label: '업종별' }
  ];
  var SIGNAL_PAGE_SIZE = 24;
  var signalData = null;
  var activeFlowKey = null;
  var activeIndustry = null;
  var flowView = 'flow';
  var flowSortKey = 'signal';
  var flowVisibleCount = SIGNAL_PAGE_SIZE;
  var signalRequestSeq = 0;
  var searchRequestSeq = 0; // 2026-08-21 코드 감사: search()에 늦게 도착한 이전 요청 응답이
                            // 최신 검색 결과를 덮어쓰지 않도록 loadSignalSummary와 동일한
                            // 요청 순서 가드용(레이스 방지).

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
    ensureKrxMap().catch(function () { /* 입력 시 다시 시도한다. */ });
    loadSignalData(container);
    autoSearchFromUrl(container);

    global.addEventListener('resize', function () { syncSignalPanelHeight(container); });
  }

  // 다른 페이지(오늘의 투자시그널 등)에서 ?code=005930&name=삼성전자로 넘어오면
  // 사용자가 직접 입력하지 않아도 바로 검색 결과를 보여준다(js/invest-signal.js 연동).
  function autoSearchFromUrl(container) {
    var params = new URLSearchParams(location.search);
    var code = (params.get('code') || '').trim();
    if (!code) return;
    var name = (params.get('name') || '').trim();
    var input = container.querySelector('#ffInput');
    if (input) input.value = name || code;
    search(container, code);
  }

  function buildShell() {
    return ''
      + '<div class="ff-search ff-search-compact">'
      + '<div class="ff-input-wrap">'
      + '<input type="text" id="ffInput" class="ff-input" placeholder="종목명 또는 코드 입력" autocomplete="off" />'
      + '<div id="ffSuggest" class="ff-suggest"></div>'
      + '</div>'
      + '<button type="button" id="ffSearchBtn" class="ff-search-btn">조회</button>'
      + '</div>'
      + '<div id="ffSigWrap">'
      + '<div class="ff-explore-intro"><strong>국내 2주 스윙 분석</strong><span>장기 국면은 배경, 중기 국면은 방향, 단기 국면은 진입 시점을 확인합니다.</span></div>'
      + '<div class="ff-explore-tabs" role="tablist">'
      + '<button type="button" class="ff-explore-tab active" data-explore-view="flow" role="tab">차트 흐름별 탐색</button>'
      + '<button type="button" class="ff-explore-tab" data-explore-view="industry" role="tab">업종별 보기</button>'
      + '</div>'
      + '<div id="ffSigCount" class="ff-explore-meta"><div class="ff-hint">차트 흐름 집계를 불러오는 중...</div></div>'
      + '<div id="ffSigList" class="ff-explore-content"></div>'
      + '<div class="ff-divider"></div>'
      + '</div>'
      + '<div id="ffResult" class="ff-result"></div>';
  }

  function loadSignalData(container) {
    ForeignFlow.fetchJson(GAS_TICKER_URL + '?investSignal=1')
      .then(function (data) {
        signalData = data;
        renderExplore(container);
        syncSignalPanelHeight(container);
      })
      .catch(function () {
        var box = container.querySelector('#ffSigCount');
        if (box) box.innerHTML = '<div class="ff-error">차트 흐름 데이터를 불러오지 못했어요.</div>';
      });
  }

  function swingScanData() { return (signalData && signalData.swingScan) || {}; }

  function flowMeta(key) {
    return FLOW_META.filter(function (item) { return item.key === key; })[0] || FLOW_META[0];
  }

  function flowKeyFromRecord(record) {
    var swing = record && record.swing || record || {};
    var chart = swing.chartRegime || {};
    var event = swing.recentEvent || chart.recentEvent || {};
    var eventKey = event.key;
    if (eventKey === 'upturn_detected' || eventKey === 'upturn_confirmed' || chart.key === 'upturn') return 'upturn';
    if (eventKey === 'uptrend_resume') return 'uptrend_resume';
    if (eventKey === 'downturn_detected' || eventKey === 'downturn_confirmed' || chart.key === 'downturn') return 'downturn';
    if (eventKey === 'downtrend_resume') return 'downtrend';
    var transitions = swing.transitions || record && record.transitions || {};
    if (eventKey !== 'breakdown' && eventKey !== 'fake_breakout' && eventKey !== 'fake_breakdown'
      && eventKey !== 'downturn_detected' && eventKey !== 'downturn_confirmed'
      && ((transitions.short && transitions.short.active) || (transitions.mid && transitions.mid.active))) return 'upturn';
    var auxiliary = swing.auxiliaryStates || chart.auxiliaryStates || [];
    if (eventKey === 'compression' || auxiliary.some(function (item) { return item && item.key === 'compression'; })) return 'compression';
    if (chart.key === 'uptrend') return 'uptrend';
    if (chart.key === 'downtrend') return 'downtrend';
    return null;
  }

  function normalizeFlowRow(row, fallback) {
    var swing = row.swing || {};
    var chart = swing.chartRegime || {};
    var waves = swing.waves || {};
    var signal = row.signal || (waves.small && waves.small.event) || swing.recentEvent || chart.recentEvent || {};
    var shortSignal = row.shortSignal || swing.shortSignal || waves.shortSignal || {};
    if (shortSignal.key && shortSignal.key !== 'none') signal = shortSignal;
    var risk = row.risk || swing.risk || {};
    var code = row.code || fallback && fallback.code;
    var info = (global.WICS_MAP && global.WICS_MAP[code]) || {};
    return {
      code: code,
      name: row.name || fallback && fallback.name || info.name || code,
      price: finiteNumber(row.price),
      changeRate: finiteNumber(row.changeRate),
      tradingValue: finiteNumber(row.tradingValue),
      volume: finiteNumber(row.volume),
      volumeAvg20: finiteNumber(row.volumeAvg20),
      bigWave: row.bigWave || waves.big && waves.big.label || '데이터 부족',
      midWave: row.midWave || waves.mid && waves.mid.label || '데이터 부족',
      smallWave: row.smallWave || waves.small && waves.small.label || '데이터 부족',
      shortSignal: shortSignal,
      transitions: row.transitions || swing.transitions || {},
      signal: signal.label || '이벤트 없음',
      currentLocation: row.currentLocation || chart.currentRegime && chart.currentRegime.label || '판단 보류',
      riskState: risk.state || '확인 안 됨',
      riskFlags: risk.flags || [],
      industry: info.industry || info.sector || '업종 미분류',
      asOf: row.asOf || row.date || ''
    };
  }

  function flowRows(key) {
    var scan = swingScanData();
    var groups = scan.flowGroups || {};
    var raw = groups[key];
    if (Array.isArray(raw)) return raw.map(function (row) { return normalizeFlowRow(row); }).filter(function (row) { return row.code; });
    // 이전 캐시를 읽는 동안에는 새 그룹이 없을 수 있다. 그때도 임의의 상태/건수를
    // 만들지 않고, 이미 저장된 swingCandidates만 해당 흐름에 한해 보여준다.
    return (scan.candidates || []).filter(function (row) { return flowKeyFromRecord(row) === key; })
      .map(function (row) { return normalizeFlowRow(row); }).filter(function (row) { return row.code; });
  }

  function allFlowRows() {
    var out = [];
    FLOW_META.forEach(function (meta) { flowRows(meta.key).forEach(function (row) { row.flowKey = meta.key; out.push(row); }); });
    return out;
  }

  function flowCounts() {
    var counts = {};
    FLOW_META.forEach(function (meta) { counts[meta.key] = flowRows(meta.key).length; });
    return counts;
  }

  function flowSvg(meta) {
    return '<svg class="ff-flow-line ' + meta.tone + '" viewBox="0 0 86 44" role="img" aria-label="' + escapeAttr(meta.aria) + '"><path d="' + meta.line + '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>';
  }

  function renderExplore(container) {
    var metaBox = container.querySelector('#ffSigCount');
    if (metaBox) {
      var scan = swingScanData();
      var scanned = scan.scanned || signalData.scanned || 0;
      var when = signalData.scannedAt || signalData.generatedAt;
      metaBox.innerHTML = '<div class="ff-explore-meta-copy"><strong>차트 흐름·추세 국면으로 후보를 좁혀보세요.</strong><span>'
        + (when ? '스캔 기준 ' + escapeHtml(when) + ' · ' : '') + '분석 대상 ' + Number(scanned).toLocaleString('ko-KR') + '종목</span></div>'
        + '<small>라인은 흐름 형태 예시이며 실제 종목 차트가 아닙니다.</small>';
    }
    var content = container.querySelector('#ffSigList');
    if (!content) return;
    content.innerHTML = flowView === 'industry' ? renderIndustryView() : renderFlowView();
  }

  function renderFlowView() {
    var counts = flowCounts();
    var cards = FLOW_META.map(function (meta) {
      var count = counts[meta.key];
      return '<button type="button" class="ff-flow-card tone-' + meta.tone + (activeFlowKey === meta.key ? ' active' : '') + '" data-flow="' + meta.key + '">'
        + '<span class="ff-flow-card-copy"><strong>' + escapeHtml(meta.label) + '</strong><b>' + count.toLocaleString('ko-KR') + '종목</b><small>' + escapeHtml(meta.description) + '</small></span>'
        + flowSvg(meta) + '</button>';
    }).join('');
    var detail = activeFlowKey ? renderFlowList(activeFlowKey, null) : '<div class="ff-flow-empty">흐름을 선택하면 해당 상태의 종목과 장기·중기·단기 국면을 확인할 수 있습니다.</div>';
    return '<section class="ff-flow-overview"><div class="ff-section-head"><div><h2>차트 흐름별 탐색</h2><p>차트 흐름을 먼저 확인하고 종목분석에서 세부 데이터를 살펴봅니다.</p></div></div><div class="ff-flow-grid">' + cards + '</div></section>' + detail;
  }

  function renderIndustryView() {
    var rows = allFlowRows();
    var byIndustry = {};
    rows.forEach(function (row) {
      var key = row.industry || '업종 미분류';
      if (!byIndustry[key]) byIndustry[key] = { total: 0, counts: {} };
      byIndustry[key].total++;
      byIndustry[key].counts[row.flowKey] = (byIndustry[key].counts[row.flowKey] || 0) + 1;
    });
    var industries = Object.keys(byIndustry).sort(function (a, b) { return byIndustry[b].total - byIndustry[a].total || a.localeCompare(b, 'ko'); });
    if (!industries.length) return '<div class="ff-flow-empty">업종별 차트 흐름 데이터가 없습니다.</div>';
    var cards = industries.map(function (industry) {
      var item = byIndustry[industry];
      var summary = FLOW_META.filter(function (meta) { return item.counts[meta.key]; }).map(function (meta) { return meta.label + ' ' + item.counts[meta.key]; }).join(' · ');
      return '<button type="button" class="ff-industry-card' + (activeIndustry === industry ? ' active' : '') + '" data-industry="' + escapeAttr(industry) + '"><strong>' + escapeHtml(industry) + '</strong><b>' + item.total + '종목</b><small>' + escapeHtml(summary || '흐름 데이터 없음') + '</small></button>';
    }).join('');
    var detail = activeIndustry ? renderIndustryRows(rows.filter(function (row) { return row.industry === activeIndustry; })) : '<div class="ff-flow-empty">업종을 선택하면 같은 분석 결과를 업종별로 교차 확인할 수 있습니다.</div>';
    return '<section class="ff-industry-view"><div class="ff-section-head"><div><h2>업종별 보기</h2><p>같은 차트 흐름 분석을 업종 관점으로 확인합니다.</p></div></div><div class="ff-industry-grid">' + cards + '</div></section>' + detail;
  }

  function sortFlowRows(rows) {
    return rows.slice().sort(function (a, b) {
      if (flowSortKey === 'tradingValue') return (b.tradingValue || 0) - (a.tradingValue || 0) || (b.volume || 0) - (a.volume || 0);
      if (flowSortKey === 'volume') return (b.volume || 0) - (a.volume || 0) || (b.tradingValue || 0) - (a.tradingValue || 0);
      if (flowSortKey === 'industry') return (a.industry || '').localeCompare(b.industry || '', 'ko') || (a.name || '').localeCompare(b.name || '', 'ko');
      return String(b.asOf || '').localeCompare(String(a.asOf || '')) || (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }

  function renderFlowList(key, filteredRows) {
    var meta = flowMeta(key);
    var rows = sortFlowRows(filteredRows || flowRows(key));
    var shown = rows.slice(0, flowVisibleCount);
    var head = '<div class="ff-flow-list-head"><div><h3>' + escapeHtml(meta.label) + ' · ' + rows.length.toLocaleString('ko-KR') + '종목</h3><p>' + escapeHtml(meta.description) + '</p></div><label>정렬<select class="ff-explore-sort">' + FLOW_SORT_META.map(function (item) { return '<option value="' + item.key + '"' + (flowSortKey === item.key ? ' selected' : '') + '>' + item.label + '</option>'; }).join('') + '</select></label></div>';
    if (!rows.length) return head + '<div class="ff-flow-empty">현재 엔진에서 이 흐름으로 분류된 종목이 없습니다.</div>';
    var tableHead = '<div class="ff-flow-table-head"><span>종목</span><span>추세 국면 · 감지 신호</span><span>현재 위치</span><span>거래대금 · 거래량</span><span>위험 확인</span></div>';
    var body = shown.map(flowRowHtml).join('');
    var more = rows.length > shown.length ? '<button type="button" class="ff-flow-more" data-flow-more="1">더 보기 <span>' + shown.length + ' / ' + rows.length + '</span></button>' : '';
    return '<section class="ff-flow-results">' + head + tableHead + '<div class="ff-flow-rows">' + body + '</div>' + more + '</section>';
  }

  function renderIndustryRows(rows) {
    var flowKey = rows[0] && rows[0].flowKey;
    var sorted = sortFlowRows(rows);
    var shown = sorted.slice(0, flowVisibleCount);
    var head = '<div class="ff-flow-list-head"><div><h3>선택 업종 · ' + rows.length.toLocaleString('ko-KR') + '종목</h3><p>차트 흐름별 결과를 업종 안에서 교차 확인합니다.</p></div><label>정렬<select class="ff-explore-sort">' + FLOW_SORT_META.map(function (item) { return '<option value="' + item.key + '"' + (flowSortKey === item.key ? ' selected' : '') + '>' + item.label + '</option>'; }).join('') + '</select></label></div>';
    if (!rows.length) return head + '<div class="ff-flow-empty">선택한 업종에 표시할 데이터가 없습니다.</div>';
    return '<section class="ff-flow-results"><div class="ff-flow-industry-note">' + escapeHtml(flowKey ? flowMeta(flowKey).label : '차트 흐름별 결과') + '</div><div class="ff-flow-table-head"><span>종목</span><span>추세 국면 · 감지 신호</span><span>현재 위치</span><span>거래대금 · 거래량</span><span>위험 확인</span></div><div class="ff-flow-rows">' + shown.map(flowRowHtml).join('') + '</div>' + (sorted.length > shown.length ? '<button type="button" class="ff-flow-more" data-flow-more="1">더 보기 <span>' + shown.length + ' / ' + sorted.length + '</span></button>' : '') + '</section>';
  }

  function formatCompact(value) {
    if (value == null || isNaN(value)) return '-';
    var n = Math.abs(Number(value));
    if (n >= 100000000) return (Number(value) / 100000000).toFixed(1) + '억';
    if (n >= 10000) return (Number(value) / 10000).toFixed(1) + '만';
    return Math.round(Number(value)).toLocaleString('ko-KR');
  }

  function flowRowHtml(row) {
    var volumeNote = row.volumeAvg20 && row.volume != null ? ' · 평균 대비 ' + (row.volume / row.volumeAvg20).toFixed(1) + '배' : '';
    var risk = row.riskFlags.length ? row.riskFlags.join(' · ') : row.riskState;
    var price = row.price == null ? '-' : Math.round(row.price).toLocaleString('ko-KR') + '원';
    return '<button type="button" class="ff-flow-row" data-flow-code="' + escapeAttr(row.code) + '" data-flow-name="' + escapeAttr(row.name) + '">'
      + '<span class="ff-flow-stock">' + stockIconHtml(row.code, 'ff-flow-icon') + '<strong>' + escapeHtml(row.name) + '</strong><small>' + escapeHtml(row.code) + '</small><em>' + escapeHtml(row.industry) + '</em><i class="ff-flow-quote">' + escapeHtml(price) + ' · <span class="' + signClass(row.changeRate) + '">' + escapeHtml(fmtSignedPct(row.changeRate)) + '</span></i></span>'
      + '<span class="ff-flow-signal"><b>' + escapeHtml(row.bigWave) + ' · ' + escapeHtml(row.midWave) + '</b><small>' + escapeHtml(row.smallWave) + ' · ' + escapeHtml(row.signal) + '</small></span>'
      + '<span class="ff-flow-location">' + escapeHtml(row.currentLocation) + '</span>'
      + '<span class="ff-flow-volume"><b>' + formatCompact(row.tradingValue) + '</b><small>' + formatCompact(row.volume) + volumeNote + '</small></span>'
      + '<span class="ff-flow-risk ' + (row.riskFlags.length ? 'warn' : '') + '">' + escapeHtml(risk) + '</span>'
      + '</button>';
  }

  // 2026-07-28 사용자 리포트: 리스트 행의 가격·등락률이 daily_scan(하루 1회 배치) 시점
  // 스냅샷이라 상세 헤더(startQuotePolling으로 실시간 갱신)와 값이 어긋나 보임 -
  // 등급·점수·순위는 배치 기준이 맞는 값이라 그대로 두고, 화면에 보이는 종목들의 가격·
  // 등락률만 GAS ?codes=(실시간)로 덮어쓴다.
  function patchSignalListPrices(container) {
    var box = container.querySelector('#ffSigList');
    if (!box) return;
    var rows = box.querySelectorAll('.ff-sig-row[data-code]');
    var codes = [];
    rows.forEach(function (row) {
      var code = row.getAttribute('data-code');
      if (code && codes.indexOf(code) === -1) codes.push(code);
    });
    if (!codes.length) return;

    fetchJson(GAS_TICKER_URL + '?codes=' + codes.join(','))
      .then(function (list) {
        var byCode = {};
        (list || []).forEach(function (d) { byCode[d.code] = d; });
        rows.forEach(function (row) {
          var d = byCode[row.getAttribute('data-code')];
          if (!d) return;
          var priceEl = row.querySelector('.ff-sig-price');
          var rateEl = row.querySelector('.ff-sig-rate');
          if (priceEl && d.price != null && !isNaN(d.price)) priceEl.textContent = Math.round(d.price).toLocaleString('ko-KR');
          if (rateEl && d.changeRate != null && !isNaN(d.changeRate)) {
            rateEl.textContent = fmtSignedPct(d.changeRate);
            rateEl.className = 'ff-sig-rate ' + signClass(d.changeRate);
          }
        });
      })
      .catch(function () { /* 실패하면 배치 스냅샷 값 그대로 둔다 */ });
  }

  function listRowHtml(record) {
    var activeCls = record.code === activeSignalCode ? ' active' : '';
    var metricHtml = (record.rankMeta && record.metricValue != null)
      ? '<span class="ff-sig-metric">' + escapeHtml(record.rankMeta.metricLabel) + ' ' + escapeHtml(record.rankMeta.fmt(record.metricValue)) + '</span>'
      : '';
    return '<button type="button" class="ff-sig-row ff-sig-list-row' + activeCls + '" data-code="' + escapeAttr(record.code) + '" data-name="' + escapeAttr(record.name) + '">'
      + stockIconHtml(record.code, 'ff-sig-icon')
      + '<span class="ff-sig-name">' + escapeHtml(record.name) + '<span class="ff-sig-code">(' + escapeHtml(record.code) + ')</span></span>'
      + metricHtml
      + '<span class="ff-sig-quote"><span class="ff-sig-price">' + (record.price == null || isNaN(record.price) ? '-' : Math.round(record.price).toLocaleString('ko-KR')) + '</span>'
      + '<span class="ff-sig-rate ' + signClass(record.changeRate) + '">' + fmtSignedPct(record.changeRate) + '</span></span>'
      + '</button>';
  }

  // 리스트에서 종목 클릭 -> 우측 요약 패널(+ 상단 배너) 갱신. 페이지 이동 없음(작업지시서 ③).
  function selectListStock(container, code, name) {
    if (activeSignalCode === code) {
      clearSignalSelection(container);
      return;
    }
    activeSignalCode = code;
    renderSignalList(container); // 활성 행 하이라이트 갱신
    loadSignalSummary(container, code, name);
  }

  function clearSignalSelection(container) {
    activeSignalCode = null;
    signalRequestSeq++;
    var bannerBox = container.querySelector('#ffSigBanner');
    var panelBox = container.querySelector('#ffSigSummary');
    if (bannerBox) {
      bannerBox.hidden = true;
      bannerBox.innerHTML = '';
    }
    if (panelBox) panelBox.innerHTML = '<div class="ff-hint">종목을 선택하세요</div>';
    renderSignalList(container);
    syncSignalPanelHeight(container);
  }

  // PC에서는 오른쪽 상세 카드의 자연 높이를 기준으로 한 행의 높이를 정하고, 왼쪽 목록만
  // 내부 스크롤한다. 모바일은 CSS가 세로 스택으로 바꾸므로 높이 제한을 제거한다.
  function syncSignalPanelHeight(container) {
    var layout = container.querySelector('.ff-sig-twocol');
    var panel = container.querySelector('#ffSigSummary');
    if (!layout || !panel) return;
    layout.style.removeProperty('--ff-sig-panel-height');
    if (global.matchMedia && global.matchMedia('(max-width: 760px)').matches) return;
    global.requestAnimationFrame(function () {
      // grid의 align-items:stretch 때문에 panel.scrollHeight는 왼쪽 목록의 자연 높이까지
      // 따라 늘어난다. 마지막 실제 자식의 하단 좌표로 오른쪽 콘텐츠 고유 높이만 측정한다.
      var lastChild = panel.lastElementChild;
      var panelRect = panel.getBoundingClientRect();
      var paddingBottom = parseFloat(global.getComputedStyle(panel).paddingBottom) || 0;
      var naturalHeight = lastChild
        ? lastChild.getBoundingClientRect().bottom - panelRect.top + paddingBottom
        : 0;
      var targetHeight = Math.max(560, Math.ceil(naturalHeight));
      layout.style.setProperty('--ff-sig-panel-height', targetHeight + 'px');
    });
  }

  // 요약 패널의 "상세 보기"를 누르면 그제서야 기존 검색창 흐름(⑤ 상세 영역)을 실행한다.
  function openFullDetail(container, code, name) {
    var input = container.querySelector('#ffInput');
    if (input) input.value = name;
    search(container, code);
    var resultBox = container.querySelector('#ffResult');
    if (resultBox) resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fmtSharesUnit(v) { return v == null || isNaN(v) ? '-' : fmtShares(v) + '주'; }

  // 0~100점 -> 배너/요약패널용 한글 등급 텍스트(작업지시서: 문자 등급 대신 "양호/중립/부진" 등)
  function scoreToWord(score) {
    if (score == null) return '-';
    if (score >= 65) return '양호';
    if (score >= 40) return '중립';
    return '부진';
  }
  // scoreToWord와 같은 기준(65/40)으로 카드형 지표값 색상을 매수/보유/매도 톤에 맞춘다.
  function scoreColorCls(score) {
    if (score == null) return '';
    if (score >= 65) return 'ff-buy';
    if (score >= 40) return 'ff-flat';
    return 'ff-sell';
  }
  // 공매도 압박 등급 라벨(매우약함~매우강함)을 배너용 2단 텍스트로 압축
  function shortToWord(label) {
    if (!label) return '-';
    if (label.indexOf('약함') !== -1) return '낮음';
    if (label.indexOf('강함') !== -1) return '높음';
    return '중립';
  }
  // 연기금 톤(긍정/부정)을 화살표로 표시
  function pensionToWord(pension) {
    if (!pension) return '-';
    var tone = pensionInterpText(pension).tone;
    if (tone === 'very_positive' || tone === 'positive' || tone === 'neutral_positive') return '↑';
    if (tone === 'caution') return '↓';
    return '-';
  }

  // 리스트 클릭 시 필요한 5개 데이터를 병렬로 불러와 배너+요약 패널을 채운다. 기존 search()와
  // 같은 fetch 함수(fetchFlow/fetchFlowChart/fetchInvestorFlowLive/fetchLiveQuote/fetchFundamentals)를
  // 그대로 재사용 - 5분 메모리 캐시가 이미 걸려 있어 같은 종목을 리스트에서 눌렀다가 검색창으로
  // 다시 조회해도 중복 호출이 없다.
  function loadSignalSummary(container, code, name) {
    var requestId = ++signalRequestSeq;
    var bannerBox = container.querySelector('#ffSigBanner');
    var panelBox = container.querySelector('#ffSigSummary');
    if (bannerBox) {
      bannerBox.hidden = true;
      bannerBox.innerHTML = '';
    }
    if (panelBox) panelBox.innerHTML = '<div class="ff-loading"><svg class="ff-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><div>' + escapeHtml(name) + ' 불러오는 중...</div></div>';
    syncSignalPanelHeight(container);

    // 2026-08-20: search()와 동일하게 실패 원인을 flowErr_/chartErr_에 남겨 최종 에러
    // 문구에 같이 보여준다(개발자도구 없이도 원인 문구를 바로 확인할 수 있게).
    var flowErr_ = null, chartErr_ = null;
    // fetchFlow/fetchFlowChart는 VM·GAS 폴백까지 실패해도 예외 없이 {error:...} 모양
    // JSON을 정상 응답으로 돌려주는 경로가 있어(search()와 동일 이유) resolve된 값도 같이 본다.
    var chartPromise = fetchFlowChart(code)
      .then(function (d) { if (d && (d.error || d.detail) && !chartErr_) chartErr_ = d.message || d.error || d.detail; return d; })
      .catch(function (err) { chartErr_ = err && err.message; return null; });
    var investorFlowPromise = fetchInvestorFlowLive(code, name).catch(function () { return null; });
    var quotePromise = fetchLiveQuote(code).catch(function () { return null; });
    var fundamentalsPromise = fetchFundamentals(code, name).catch(function () { return null; });

    var flowPromise = ForeignFlow.fetchFlow(code, name)
      .then(function (d) { if (d && (d.error || d.detail) && !flowErr_) flowErr_ = d.message || d.error || d.detail; return d; })
      .catch(function (err) { flowErr_ = err && err.message; return null; });
    Promise.all([flowPromise, chartPromise, investorFlowPromise, quotePromise, fundamentalsPromise])
      .then(function (results) {
        if (activeSignalCode !== code || signalRequestSeq !== requestId) return; // 이전 요청 응답은 무시(레이스 방지)
        var data = results[0], chartData = results[1], entry = results[2], quote = results[3], fundamentals = results[4];
        if (!data || data.error || !data.daily || !data.daily.length) {
          data = buildUnavailableFlowData(chartData, code, name);
          if (data) data.flowUnavailable = true;
          if (!data) {
            var detail_ = flowErr_ || chartErr_;
            if (panelBox) panelBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요.'
              + (detail_ ? '<br><small style="opacity:.6">(' + escapeHtml(detail_) + ')</small>' : '')
              + '</div>';
            return;
          }
        }
        var techScore = computeTechnicalScore(chartData);
        renderSignalBanner(bannerBox, data, entry, techScore, fundamentals, chartData);
        renderSignalSummaryPanel(panelBox, data, entry, techScore, fundamentals, quote, chartData);
        syncSignalPanelHeight(container);
      })
      .catch(function (err) {
        if (activeSignalCode !== code || signalRequestSeq !== requestId) return;
        if (panelBox) panelBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'
          + (err && err.message ? '<br><small style="opacity:.6">(' + escapeHtml(err.message) + ')</small>' : '')
          + '</div>';
        syncSignalPanelHeight(container);
      });
  }

  // ① 시그널 배너 - 항상 연한 파랑 고정색(작업지시서 지정), 등급 칩은 문자 등급 대신 한글 텍스트.
  function renderSignalBanner(box, data, entry, techScore, fundamentals, chartData) {
    if (!box) return;
    var swing = buildSwingAssessment(data, entry, chartData, computeFundamentalScore(fundamentals));
    var chart = swing.chartRegime;
    box.hidden = false;
    box.innerHTML = '<span class="ff-sig-badge ' + (chart.key === 'uptrend' || chart.key === 'upturn' ? 'ff-buy' : chart.key === 'downtrend' || chart.key === 'downturn' ? 'ff-sell' : 'ff-flat') + '">' + escapeHtml(chart.label) + '</span>'
      + stockIconHtml(data.code, 'ff-sig-banner-icon')
      + '<span class="ff-sig-banner-name">' + escapeHtml(data.name || data.code) + '</span>'
      + '<span class="ff-sig-banner-score">모멘텀 ' + escapeHtml(swing.momentum.state) + ' · 위험 ' + escapeHtml(swing.risk.state) + '</span>'
      + '<span class="ff-sig-banner-chip">신규 진입: ' + escapeHtml(swing.entryOpinion) + '</span>';
    return;
    var flowScore = computeFlowScore(data);
    var shortP = entry && entry.short && entry.short.pressure;
    var shortScore = shortP ? shortP.score : null;
    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;
    var foreignInstScore = computeForeignInstScore(data);
    var creditScore = computeCreditScore(entry && entry.credit);
    var fundamentalScore = computeFundamentalScore(fundamentals);
    var verdict = computeVerdict(flowScore, foreignInstScore, techScore, shortScore, pensionScore, creditScore, fundamentalScore);

    var chips = [
      '수급 ' + scoreToWord(flowScore),
      '기술 ' + scoreToWord(techScore ? techScore.score : null),
      '공매도 ' + shortToWord(shortP ? shortP.grade.label : null),
      '연기금' + pensionToWord(pension)
    ];
    var chipsHtml = chips.map(function (c) { return '<span class="ff-sig-banner-chip">' + escapeHtml(c) + '</span>'; }).join('');

    box.hidden = false;
    box.innerHTML = '<span class="ff-sig-badge ' + verdict.cls + '">' + verdict.label + '</span>'
      + stockIconHtml(data.code, 'ff-sig-banner-icon')
      + '<span class="ff-sig-banner-name">' + escapeHtml(data.name || data.code) + '</span>'
      + '<span class="ff-sig-banner-score"><span class="ff-sig-banner-score-num">' + verdict.score.toFixed(1) + '</span>'
      + '<span class="ff-sig-banner-score-sub">점 · ' + verdict.stars.toFixed(1) + '/5</span></span>'
      + chipsHtml;
  }

  // ③ 우측 요약 패널 - 헤더 + 수급/차트/펀더멘탈/투자의견 4개 섹션(작업지시서 3.3~3.8,
  // 2026-07-20 4차: 텍스트 나열 -> 카드/그리드/구분선 테이블로 개편).
  function renderSignalSummaryPanel(box, data, entry, techScore, fundamentals, quote, chartData) {
    if (!box) return;
    box.innerHTML = buildSwingSummaryBox(data, entry, techScore, fundamentals, chartData)
      + '<button type="button" class="ff-panel-detail-link" data-open-detail="' + escapeAttr(data.code) + '" data-open-detail-name="' + escapeAttr(data.name || data.code) + '">수급·차트·펀더멘탈·모멘텀 상세 보기 →</button>';
    return;
    var latest = data.daily && data.daily[0];
    var shortEntry = entry && entry.short;
    var valuation = fundamentals && fundamentals.valuation;
    var annual = fundamentals && fundamentals.fundamentals && fundamentals.fundamentals.annual;
    var industry = (global.WICS_MAP && global.WICS_MAP[data.code] && global.WICS_MAP[data.code].industry) || '-';
    var daily = chartData && chartData.daily;

    function row(label, val) { return '<div class="ff-panel-row"><span class="ff-panel-label">' + label + '</span><span class="ff-panel-val">' + val + '</span></div>'; }
    function metricCell(label, val, cls) {
      return '<div class="ff-metric"><div class="ff-metric-label">' + label + '</div><div class="ff-metric-val' + (cls ? ' ' + cls : '') + '">' + val + '</div></div>';
    }
    function chartCard(label, value, sub, cls, full) {
      return '<div class="ff-chart-card' + (full ? ' ff-chart-card-full' : '') + '">'
        + '<div class="ff-chart-card-label">' + label + '</div>'
        + '<div class="ff-chart-card-val' + (cls ? ' ' + cls : '') + '">' + escapeHtml(value) + '</div>'
        + (sub ? '<div class="ff-chart-card-sub">' + escapeHtml(sub) + '</div>' : '')
        + '</div>';
    }

    // 3.3 헤더: 종목명+코드 한 줄 / 현재가(24px) / 등락률·등락금액(13px), 전부 동일 색상
    var priceCls = quote ? signClass(quote.changeRate) : '';
    var priceNum = quote ? Number(quote.price).toLocaleString() + '원' : (latest ? Number(latest.close).toLocaleString() + '원' : '-');
    var changeText = quote
      ? (quote.changeRate >= 0 ? '+' : '') + quote.changeRate.toFixed(2) + '% (' + (quote.change >= 0 ? '+' : '') + Number(quote.change).toLocaleString() + '원)'
      : '';
    var headerHtml = '<div class="ff-panel-header">'
      + '<div class="ff-panel-header-top">' + stockIconHtml(data.code, 'ff-panel-header-icon')
      + '<span class="ff-panel-header-name">' + escapeHtml(data.name || data.code) + '</span>'
      + '<span class="ff-panel-header-code">(' + escapeHtml(data.code) + ')</span></div>'
      + '<div class="ff-panel-header-price ' + priceCls + '">' + priceNum + '</div>'
      + (changeText ? '<div class="ff-panel-header-change ' + priceCls + '">' + changeText + '</div>' : '')
      + '</div>';

    // 3.5 수급 카드: 3그리드(외국인/기관/개인) + 2그리드(공매도비중/Days to Cover), 16%+ 경고색
    var shortWarnCls = shortEntry && shortEntry.today_ratio_pct != null && shortEntry.today_ratio_pct >= 16 ? 'ff-warn' : '';
    var flowSection = '<div class="ff-panel-section"><div class="ff-panel-title">수급</div>'
      + '<div class="ff-card">'
      + '<div class="ff-card-grid3">'
      + metricCell('외국인', latest ? fmtSharesUnit(latest.foreign_net) : '-', latest ? signClass(latest.foreign_net) : '')
      + metricCell('기관', latest ? fmtSharesUnit(latest.inst_net) : '-', latest ? signClass(latest.inst_net) : '')
      + metricCell('개인', latest ? fmtSharesUnit(latest.ind_net) : '-', latest ? signClass(latest.ind_net) : '')
      + '</div>'
      + '<div class="ff-card-grid2">'
      + metricCell('공매도 비중', shortEntry ? fmtPct(shortEntry.today_ratio_pct) : '-', shortWarnCls)
      + metricCell('Days to Cover', shortEntry && shortEntry.days_to_cover != null ? shortEntry.days_to_cover.toFixed(1) + '일' : '-', '')
      + '</div>'
      + '</div></div>';

    // 3.6 차트 지표: 2x2 카드 + 풀폭 시그널. 계산은 기존 함수 재사용, 표시만 카드로 분리.
    var maLabel = techScore ? techScore.ma.label : '-';
    var maCls = maLabel === '정배열' ? 'ff-buy' : maLabel === '역배열' ? 'ff-sell' : 'ff-flat';
    var rsi = daily ? computeRSI(daily, 14) : null;
    var rsiLast = null;
    if (rsi) { for (var ri = rsi.length - 1; ri >= 0; ri--) { if (rsi[ri] != null) { rsiLast = rsi[ri]; break; } } }
    var rsiVal = rsiLast == null ? '-' : rsiLast.toFixed(1);
    var rsiSub = rsiLast == null ? '데이터 부족' : (rsiLast >= 70 ? '과매수' : rsiLast <= 30 ? '과매도' : '중립');
    var rsiCls = rsiLast == null ? 'ff-flat' : (rsiLast >= 70 ? 'ff-sell' : rsiLast <= 30 ? 'ff-buy' : 'ff-flat');
    var crossLabel = techScore ? techScore.ichimoku.cross.label : '-';
    var crossCls = crossLabel.indexOf('골든') !== -1 ? 'ff-buy' : crossLabel.indexOf('데드') !== -1 ? 'ff-sell' : 'ff-flat';
    var chartSection = '<div class="ff-panel-section"><div class="ff-panel-title">차트</div>'
      + '<div class="ff-chart-grid">'
      + chartCard('이동평균', maLabel, null, maCls)
      + chartCard('RSI(14)', rsiVal, rsiSub, rsiCls)
      + chartCard('볼린저밴드', daily ? bollingerInterpText(daily) : '데이터 부족')
      + chartCard('지지/저항', techScore ? techScore.support.label : '-', techScore ? techScore.resistance.label : '')
      + chartCard('시그널', crossLabel, null, crossCls, true)
      + '</div></div>';

    // 3.7 펀더멘탈: 행 구분선 테이블, 섹션 타이틀에 업종명 병기
    var fundSection = '<div class="ff-panel-section"><div class="ff-panel-title">펀더멘탈 · ' + escapeHtml(industry) + '</div>'
      + row('PER', valuation && valuation.per != null ? valuation.per.toFixed(1) + 'x' : '-')
      + row('PBR', valuation && valuation.pbr != null ? valuation.pbr.toFixed(1) + 'x' : '-')
      + row('EPS', valuation ? fmtWon(valuation.eps) : '-')
      + row('ROE', annual && annual.latest_roe_pct != null ? fmtPct(annual.latest_roe_pct) : '-')
      + '</div>';

    // 3.8 투자의견: 파란 배경 카드(#E6F1FB/#0C447C 고정색) + 상세보기 버튼
    var opinionSection = '<div class="ff-panel-section ff-panel-opinion"><div class="ff-panel-title">투자의견</div>'
      + '<div class="ff-panel-opinion-text" id="ffPanelOpinion">생성 중...</div>'
      + '</div>';

    var detailLink = '<button type="button" class="ff-panel-detail-link" data-open-detail="' + escapeAttr(data.code) + '" data-open-detail-name="' + escapeAttr(data.name || data.code) + '">수급·차트·펀더멘탈·모멘텀 상세 보기 →</button>';

    box.innerHTML = headerHtml + flowSection + chartSection + fundSection + opinionSection + detailLink;

    loadPanelOpinion(box, data, entry, techScore, chartData, fundamentals);
  }

  // 투자의견 한 줄 - loadAiSummary와 같은 GAS(?action=flowAiSummary), 같은 컴포넌트 점수+verdict를
  // 넘겨 결론이 서로 어긋나지 않게 한다.
  function loadPanelOpinion(box, data, entry, techScore, chartData, fundamentals) {
    var el = box.querySelector('#ffPanelOpinion');
    if (!el) return;

    var shortP = entry && entry.short && entry.short.pressure;
    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;
    var flowScore = computeFlowScore(data);
    var foreignInstScore = computeForeignInstScore(data);
    var shortScore = shortP ? shortP.score : null;
    var creditScore = computeCreditScore(entry && entry.credit);
    var fundamentalScore = computeFundamentalScore(fundamentals);
    var verdict = computeVerdict(flowScore, foreignInstScore, techScore, shortScore, pensionScore, creditScore, fundamentalScore);

    var daily = chartData && chartData.daily;
    var volNote = volumeMultipleText(daily ? computeVolumeMultiple(daily) : null);
    var rsiNote = daily ? rsiInterpText(daily) : 'RSI 데이터가 부족합니다.';

    var qs = '?action=flowAiSummary'
      + '&code=' + encodeURIComponent(data.code)
      + '&name=' + encodeURIComponent(data.name || data.code)
      + '&flowScore=' + flowScore
      + '&flowNote=' + encodeURIComponent(flowScoreInterpText(data))
      + '&foreignInstScore=' + foreignInstScore
      + '&foreignInstNote=' + encodeURIComponent(foreignInstDescText(data))
      + '&shortScore=' + (shortScore == null ? '' : shortScore)
      + '&shortNote=' + encodeURIComponent(shortInterpText(entry && entry.short, entry && entry.loan))
      + '&pensionScore=' + (pensionScore == null ? '' : pensionScore)
      + '&pensionNote=' + encodeURIComponent(pensionInterpText(pension).text)
      + '&techScore=' + (techScore ? techScore.score : '')
      + '&techNote=' + encodeURIComponent(techInterpText(techScore))
      + '&volNote=' + encodeURIComponent(volNote)
      + '&rsiNote=' + encodeURIComponent(rsiNote)
      + '&verdictLabel=' + encodeURIComponent(verdict.label)
      + '&verdictScore=' + (verdict.score == null ? '' : Math.round(verdict.score));

    fetchJson(GAS_TICKER_URL + qs)
      .then(function (res) {
        el.textContent = (res && res.summary) || '요약을 생성하지 못했어요.';
      })
      .catch(function () {
        el.textContent = '요약을 생성하지 못했어요.';
      });
  }

  // ---- 검색/자동완성 (stock-news.js와 동일 패턴) ----

  function wireEvents(container) {
    var input = container.querySelector('#ffInput');
    var suggestBox = container.querySelector('#ffSuggest');
    var btn = container.querySelector('#ffSearchBtn');

    input.addEventListener('input', function () {
      var query = input.value.trim();
      if (!query) { hideSuggestions(suggestBox); return; }
      ensureKrxMap().then(function () {
        renderSuggestions(container, suggestBox, query);
      }).catch(function () {
        hideSuggestions(suggestBox);
      });
    });
    input.addEventListener('keydown', function (e) {
      var items = suggestBox.querySelectorAll('.ff-suggest-item');
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
        search(container, picked);
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    btn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      search(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });

    container.addEventListener('click', function (e) {
      var viewTab = e.target.closest ? e.target.closest('.ff-explore-tab') : null;
      if (viewTab) {
        flowView = viewTab.getAttribute('data-explore-view') || 'flow';
        activeFlowKey = null;
        activeIndustry = null;
        flowVisibleCount = SIGNAL_PAGE_SIZE;
        container.querySelectorAll('.ff-explore-tab').forEach(function (tab) { tab.classList.toggle('active', tab === viewTab); });
        renderExplore(container);
        return;
      }
      var flowCard = e.target.closest ? e.target.closest('.ff-flow-card') : null;
      if (flowCard) {
        activeFlowKey = activeFlowKey === flowCard.getAttribute('data-flow') ? null : flowCard.getAttribute('data-flow');
        activeIndustry = null;
        flowVisibleCount = SIGNAL_PAGE_SIZE;
        renderExplore(container);
        return;
      }
      var industryCard = e.target.closest ? e.target.closest('.ff-industry-card') : null;
      if (industryCard) {
        activeIndustry = activeIndustry === industryCard.getAttribute('data-industry') ? null : industryCard.getAttribute('data-industry');
        flowVisibleCount = SIGNAL_PAGE_SIZE;
        renderExplore(container);
        return;
      }
      var sortSelect = e.target.closest ? e.target.closest('.ff-explore-sort') : null;
      if (sortSelect) {
        flowSortKey = sortSelect.value || 'signal';
        flowVisibleCount = SIGNAL_PAGE_SIZE;
        renderExplore(container);
        return;
      }
      var flowMore = e.target.closest ? e.target.closest('.ff-flow-more') : null;
      if (flowMore) {
        flowVisibleCount += SIGNAL_PAGE_SIZE;
        renderExplore(container);
        return;
      }
      var flowRow = e.target.closest ? e.target.closest('.ff-flow-row') : null;
      if (flowRow) {
        openFullDetail(container, flowRow.getAttribute('data-flow-code'), flowRow.getAttribute('data-flow-name'));
        return;
      }
      var badge = e.target.closest ? e.target.closest('.ff-badge-clickable') : null;
      if (badge) {
        showRelatedStocks(container, badge.getAttribute('data-related'), badge.getAttribute('data-related-type'));
        return;
      }
      var detailLink = e.target.closest ? e.target.closest('[data-open-detail]') : null;
      if (detailLink) {
        openFullDetail(container, detailLink.getAttribute('data-open-detail'), detailLink.getAttribute('data-open-detail-name'));
      }
    });
  }

  // ---- 업종/테마 배지 클릭 -> 관련 종목 목록 모달 ----

  function relatedStocksFor(name, type) {
    if (type === 'theme') {
      var list = (global.SECTOR_MAP && global.SECTOR_MAP[name]) || [];
      return list.map(function (s) { return { code: s.code, name: s.name }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    }
    var map = global.WICS_MAP || {};
    var out = [];
    for (var code in map) {
      if (!map.hasOwnProperty(code) || map[code].industry !== name) continue;
      out.push({ code: code, name: map[code].name });
    }
    return out.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }

  var relatedModalEscHandler = null; // 2026-08-21 코드 감사: 모달을 열 때마다 새 keydown
                                      // 리스너를 등록하는데, Esc가 아니라 닫기 버튼/오버레이
                                      // 클릭으로 닫으면 해제가 안 돼 계속 쌓였다 - closeRelatedModal
                                      // 이 경로와 무관하게 항상 해제하도록 참조를 여기서 관리.

  function closeRelatedModal() {
    var existing = document.querySelector('.ff-related-overlay');
    if (existing) existing.remove();
    if (relatedModalEscHandler) {
      document.removeEventListener('keydown', relatedModalEscHandler);
      relatedModalEscHandler = null;
    }
  }

  function showRelatedStocks(container, name, type) {
    if (!name) return;
    var stocks = relatedStocksFor(name, type);
    closeRelatedModal();

    var overlay = document.createElement('div');
    overlay.className = 'ff-related-overlay';
    overlay.innerHTML = '<div class="ff-related-modal">'
      + '<div class="ff-related-modal-header">'
      + '<span>' + escapeHtml(name) + ' <span class="ff-related-count">(' + stocks.length + '개 종목)</span></span>'
      + '<button type="button" class="ff-related-close" aria-label="닫기">✕</button>'
      + '</div>'
      + '<div class="ff-related-list">'
      + (stocks.length
          ? stocks.map(function (s) {
              return '<div class="ff-related-item" data-code="' + escapeAttr(s.code) + '" data-name="' + escapeAttr(s.name) + '">'
                + '<span class="ff-related-left">' + stockIconHtml(s.code, 'ff-related-icon')
                + '<span class="ff-related-name">' + escapeHtml(s.name) + '</span></span>'
                + '<span class="ff-related-quote" data-quote-code="' + escapeAttr(s.code) + '">'
                + '<span class="ff-related-price">-</span><span class="ff-related-rate">-</span></span>'
                + '</div>';
            }).join('')
          : '<div class="ff-hint">종목이 없습니다.</div>')
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
    relatedModalEscHandler = function (e) {
      if (e.key !== 'Escape') return;
      closeRelatedModal();
    };
    document.addEventListener('keydown', relatedModalEscHandler);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.ff-related-close')) { closeRelatedModal(); return; }
      var item = e.target.closest('.ff-related-item');
      if (!item) return;
      closeRelatedModal();
      var input = container.querySelector('#ffInput');
      if (input) input.value = item.getAttribute('data-name');
      search(container, item.getAttribute('data-code'));
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // 2026-07-20 사용자 요청: 종목명만 나오던 목록에 현재가/등락률도 같이 보여준다 -
    // 기존 단일종목 시세 조회(GAS ?codes=)를 콤마 목록으로 한 번에 배치 호출.
    if (stocks.length) loadRelatedQuotes(overlay, stocks);
  }

  function loadRelatedQuotes(overlay, stocks) {
    var codes = stocks.map(function (s) { return s.code; });
    fetchJson(GAS_TICKER_URL + '?codes=' + encodeURIComponent(codes.join(',')))
      .then(function (list) {
        if (!document.body.contains(overlay)) return; // 응답 오는 사이 모달을 닫았으면 무시
        var byCode = {};
        (list || []).forEach(function (q) { byCode[q.code] = q; });
        overlay.querySelectorAll('.ff-related-quote').forEach(function (el) {
          var q = byCode[el.getAttribute('data-quote-code')];
          if (!q || q.price == null) return;
          el.querySelector('.ff-related-price').textContent = Math.round(q.price).toLocaleString('ko-KR');
          var rateEl = el.querySelector('.ff-related-rate');
          rateEl.textContent = fmtSignedPct(q.changeRate);
          rateEl.className = 'ff-related-rate ' + signClass(q.changeRate);
        });
      })
      .catch(function () { /* 실패해도 종목명은 이미 보이니 조용히 무시 */ });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    box.__activeIndex = -1;
  }

  // Tistory 본문에 삽입된 페이지에서는 defer 공통 스크립트보다 foreign-flow가
  // 먼저 실행될 수 있다. 이때 첫 입력 순간 KRX_MAP이 아직 없으면 기존 코드는
  // 자동완성을 숨긴 뒤 다시 시도하지 않아 "미리보기 없음"처럼 보였다.
  function ensureKrxMap() {
    if (global.KRX_MAP) return Promise.resolve(global.KRX_MAP);
    if (krxMapPromise) return krxMapPromise;
    krxMapPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = KRX_MAP_JS + '?v=20260810-preview';
      script.onload = function () {
        if (global.KRX_MAP) resolve(global.KRX_MAP);
        else reject(new Error('KRX_MAP 없음'));
      };
      script.onerror = function () {
        krxMapPromise = null;
        reject(new Error('KRX_MAP 로드 실패'));
      };
      document.head.appendChild(script);
    });
    return krxMapPromise;
  }

  // 키보드(위/아래 화살표)로 자동완성 항목 탐색 - box.__activeIndex에 현재 위치 저장
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

  // 2026-07-20: data/krx_map.js가 window.KRX_ETF_NAMES(ETF 이름 목록)도 같이 내려준다 -
  // Set으로 한 번만 변환해 자동완성 정렬에서 "이 이름이 ETF인지" O(1)로 판별한다.
  var etfNameSet = null;
  function isEtfName(name) {
    if (!etfNameSet) {
      etfNameSet = {};
      (global.KRX_ETF_NAMES || []).forEach(function (n) { etfNameSet[n] = true; });
    }
    return !!etfNameSet[name];
  }

  function renderSuggestions(container, box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    // 2026-07-20: ETF 병합(data/krx_map.js) 이후 "삼성전자"를 검색하면 진짜 삼성전자보다
    // "KODEX 삼성전자SK하이닉스채권혼합50" 같은, 이름에 검색어가 포함된 ETF가 먼저 뜨는
    // 문제가 실측 발견됨 - 시작일치/포함일치 2단계 정렬은 그대로 두고, 각 단계 안에서
    // 일반 종목을 ETF보다 항상 먼저 보여주도록 4단계로 세분화(isEtfName, KRX_ETF_NAMES 참고).
    var startsStock = [], startsEtf = [], containsStock = [], containsEtf = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      var etf = isEtfName(name);
      if (lower.indexOf(q) === 0) {
        if (etf) { if (startsEtf.length < MAX_SUGGESTIONS) startsEtf.push(name); }
        else if (startsStock.length < MAX_SUGGESTIONS) startsStock.push(name);
      } else if (lower.indexOf(q) > -1) {
        if (etf) { if (containsEtf.length < MAX_SUGGESTIONS) containsEtf.push(name); }
        else if (containsStock.length < MAX_SUGGESTIONS) containsStock.push(name);
      }
    }
    var matches = startsStock.concat(startsEtf, containsStock, containsEtf).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="ff-suggest-item" data-name="' + escapeAttr(name) + '">' + stockIconHtml(map[name], 'ff-suggest-icon')
        + '<span class="ff-suggest-copy"><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(map[name]) + '</small></span></div>';
    }).join('');
    box.classList.add('active');
    box.__activeIndex = -1;

    box.querySelectorAll('.ff-suggest-item').forEach(function (el, i) {
      el.addEventListener('mouseenter', function () {
        setActiveSuggestion(box, box.querySelectorAll('.ff-suggest-item'), i);
      });
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#ffInput').value = name;
        hideSuggestions(box);
        search(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만.
  function resolveStock(query) {
    if (!query) return null;
    var map = global.KRX_MAP || {};

    // 2026-07-16 버그 수정: 6자리 코드로 검색하면 이름을 못 찾고 name에 코드를 그대로
    // 넣어서 "005930 (005930)"처럼 이름 자리에 코드가 중복 표시됐음(다른 종목 이동 링크가
    // ?code=&name=을 안 쓰고 code만 넘기는 경로에서 노출됨). KRX_MAP에서 코드로 역조회한다.
    if (/^\d{6}$/.test(query)) {
      for (var nm2 in map) {
        if (map.hasOwnProperty(nm2) && map[nm2] === query) return { code: query, name: nm2 };
      }
      return { code: query, name: query }; // KRX_MAP에 없는 코드(신규상장 등) - 코드라도 보여줌
    }

    if (map[query]) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var found = null;
    var count = 0;
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      if (name.toLowerCase().indexOf(q) > -1) {
        found = name;
        count++;
        if (count > 1) break;
      }
    }
    return count === 1 ? { code: map[found], name: found } : null;
  }

  // ---- 조회 ----

  // 수급 VM이 일시적으로 응답하지 않아도 가격 차트와 분석 화면 전체를 막지 않는다.
  // 차트의 날짜·종가만으로 수급 행을 만들고, 수급 값은 추정하지 않고 —로 표시한다.
  function buildUnavailableFlowData(chartData, code, name) {
    var rows = chartData && Array.isArray(chartData.daily) ? chartData.daily.slice() : [];
    if (rows.length < 2) return null;
    rows = rows.reverse().map(function (row) {
      return { date: row.date, close: Number(row.close), ind_net: null, foreign_net: null, inst_net: null };
    }).filter(function (row) { return isFinite(row.close); });
    if (rows.length < 2) return null;
    return { code: code, name: name, daily: rows, rolling: {}, signals: {}, flowUnavailable: true };
  }

  function search(container, query) {
    var resultBox = container.querySelector('#ffResult');
    destroyLwChart(); // 이전 검색의 차트 인스턴스/리스너 정리(리렌더 전에 먼저 끊는다)
    stopQuotePolling(); // 이전 종목의 헤더 시세 폴링도 같이 정리
    var requestId = ++searchRequestSeq; // 이 호출의 응답이 나중에 늦게 오면 무시(레이스 방지)
    var resolved = resolveStock(query);
    if (!resolved) {
      resultBox.innerHTML = '<div class="ff-error">'
        + (query ? '"' + escapeHtml(query) + '" 종목을 찾을 수 없어요. 정확한 종목명을 입력해보세요.' : '종목명을 입력해주세요.')
        + '</div>';
      return;
    }

    resultBox.innerHTML = '<div class="ff-loading"><svg class="ff-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><div>' + escapeHtml(resolved.name) + ' 분석 중입니다. (가격 차트는 최초 조회 시 다소 걸릴 수 있어요)</div></div>';

    // 2026-07-20 사용자 피드백: 종목을 조회하면 위 투자시그널 카운트/탭 영역은 화면만
    // 길어지게 하므로 숨긴다(랭킹 행 클릭이든 직접 입력 검색이든 동일하게 적용).
    var sigWrap = container.querySelector('#ffSigWrap');
    if (sigWrap) sigWrap.hidden = true;

    // 차트 크롤링/VM 온디맨드 호출 둘 다 실패 가능성이 있는데, 그것 때문에 나머지
    // 위젯까지 통째로 에러 처리되면 안 되므로 각자 잡아 실패 시 null/에러 객체로 대체한다.
    // 2026-08-20: 실패 원인(err.message)을 flowErr_/chartErr_에 남겨뒀다가, 최종적으로
    // 정말 아무 것도 못 그릴 때만("수급 데이터를 불러오지 못했어요") 화면에 같이 보여준다 -
    // 사용자 리포트("모든 종목이 다 안 된다")를 재현 못 하는 서버 직접 호출과 달리, 실제
    // fetch()가 브라우저에서 왜 막히는지(CORS/네트워크 등)를 개발자도구 없이도 바로 볼 수 있게.
    // fetchFlow/fetchFlowChart는 VM·GAS 최종 폴백까지 실패해도 "예외를 던지지 않고" 그냥
    // {error:...} 모양 JSON을 정상 응답(resolve)으로 돌려주는 경로가 있다(예: VM은 실패해
    // 던졌지만 그 다음 네이버 GAS 폴백은 200으로 응답하되 body가 {error:...}인 경우) - 이땐
    // .catch()가 안 걸려서 err.message만 보던 최초 버전은 이 경우를 놓쳤다. resolve된 값도
    // .error/.detail을 같이 확인한다.
    var flowErr_ = null, chartErr_ = null;
    var chartPromise = fetchFlowChart(resolved.code)
      .then(function (d) { if (d && (d.error || d.detail) && !chartErr_) chartErr_ = d.message || d.error || d.detail; return d; })
      .catch(function (err) { chartErr_ = err && err.message; return { error: 'FETCH_FAILED', message: '차트 데이터를 불러오지 못했어요.' }; });
    var investorFlowPromise = fetchInvestorFlowLive(resolved.code, resolved.name)
      .catch(function () { return null; });
    var quotePromise = fetchLiveQuote(resolved.code)
      .catch(function () { return null; });
    // 2026-07-19: 종합점수에 펀더멘탈(ROE/부채비율)을 반영하면서(computeFundamentalScore)
    // "펀더멘탈" 탭을 열 때만 불러오던 걸 처음부터 같이 불러오도록 변경 - fetchFundamentals가
    // fundamentalsCache에 저장해두므로 이후 탭 클릭 시 재요청 없음(loadFundamentals 재사용).
    var fundamentalsPromise = fetchFundamentals(resolved.code, resolved.name)
      .catch(function () { return null; });
    var flowPromise = ForeignFlow.fetchFlow(resolved.code, resolved.name)
      .then(function (d) { if (d && (d.error || d.detail) && !flowErr_) flowErr_ = d.message || d.error || d.detail; return d; })
      .catch(function (err) { flowErr_ = err && err.message; return null; });
    Promise.all([flowPromise, chartPromise, investorFlowPromise, quotePromise, fundamentalsPromise])
      .then(function (results) {
        if (requestId !== searchRequestSeq) return; // 이전 검색 응답은 무시(레이스 방지)
        var data = results[0];
        var chartData = results[1];
        var flowEntry = results[2];
        var quote = results[3];
        var fundamentals = results[4];
        if (!data || data.error || !data.daily || !data.daily.length) {
          data = buildUnavailableFlowData(chartData, resolved.code, resolved.name);
          if (data) data.flowUnavailable = true;
        }
        if (!data || !data.daily || !data.daily.length) {
          var detail_ = flowErr_ || chartErr_;
          resultBox.innerHTML = '<div class="ff-error">'
            + escapeHtml((data && data.message) || '수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.')
            + (detail_ ? '<br><small style="opacity:.6">(' + escapeHtml(detail_) + ')</small>' : '')
            + '</div>';
          return;
        }
        renderResult(resultBox, data, chartData, flowEntry, quote, fundamentals);
      })
      .catch(function (err) {
        if (requestId !== searchRequestSeq) return; // 이전 검색 응답은 무시(레이스 방지)
        resultBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'
          + (err && err.message ? '<br><small style="opacity:.6">(' + escapeHtml(err.message) + ')</small>' : '')
          + '</div>';
      });
  }

  // 종목분석 메인 수급 표 - 5분 메모리 캐시 + 진행 중 요청 재사용(연타 디바운스).
  // 2026-07-13: 키움 API(VM 직접 호출)를 1차로 쓰고, 실패할 때만 네이버(GAS 경유) 폴백으로
  // 넘어간다 - 네이버는 백업 전용, 평소엔 안 씀.
  // days: 수급 기간 선택(1개월=30/3개월=63/6개월=126/1년=252, 2026-07-19 도입) - 생략하면
  // 백엔드 기본치(63=3개월, kiwoom_market.FLOW_DEFAULT_DAYS와 동일)와 맞춰 캐시 키가
  // 겹치도록 여기서도 63으로 고정한다(같은 기간을 기본 로드 후 버튼으로 다시 눌러도
  // 재요청 없이 캐시로 즉시 응답).
  var FLOW_VM_RETRY_DELAY_MS = 800;

  function fetchFlow(code, name, days) {
    days = days || 63;
    var cacheKey = code + ':' + days;
    var hit = cacheByCode[cacheKey];
    if (hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (inflightByCode[cacheKey]) return inflightByCode[cacheKey];

    var vmUrl = KIWOOM_VM_URL + '/foreign-flow/' + encodeURIComponent(code) + '?days=' + days;
    function fetchFromVm() {
      return fetchJson(vmUrl, 60000).then(function (envelope) {
        var data = envelope && envelope.data;
        if (!data || data.error) throw new Error('VM 수급 데이터 없음');
        return data;
      });
    }

    // VM(키움+KIS)은 개인 순매매까지 포함하지만, 네이버 폴백(finance.naver.com/item/frgn.naver)은
    // 그 페이지 자체에 개인 열이 없어 구조적으로 항상 "-"만 나온다(2026-08-02 사용자 리포트 -
    // 비에이치아이 개인 열이 통째로 미표시). VM이 한 번 실패했다고 바로 폴백하면 일시적
    // 오류 하나로 이번 조회 내내 개인 수급이 안 보이게 되므로, 폴백 전에 짧게 한 번만 더
    // 재시도한다. 재시도까지 실패해야 네이버로 넘어간다 - 그때는 여전히 개인 데이터가 없고,
    // 값을 임의로 채우지 않고 "-"로 표시하는 게 맞다(원본에 없는 값을 추정하지 않는다).
    var p = fetchFromVm()
      .catch(function () {
        return new Promise(function (resolve) { setTimeout(resolve, FLOW_VM_RETRY_DELAY_MS); })
          .then(fetchFromVm);
      })
      .then(function (data) {
        if (name && !data.name) data.name = name;
        return data;
      })
      .catch(function () {
        // 재시도까지 실패했을 때만 네이버(GAS) 폴백 - 기간 선택 미지원(항상 기본 기간)
        return fetchJson(GAS_TICKER_URL + '?action=foreignFlow&code=' + encodeURIComponent(code));
      })
      .then(function (data) {
        delete inflightByCode[cacheKey];
        if (data && !data.error) cacheByCode[cacheKey] = { t: Date.now(), data: data };
        return data;
      })
      .catch(function (err) {
        delete inflightByCode[cacheKey];
        throw err;
      });
    inflightByCode[cacheKey] = p;
    return p;
  }

  // 가격 차트(지지/저항 + MA5/20/60/224) - 5분 메모리 캐시 + 진행 중 요청 재사용
  function fetchFlowChart(code) {
    var hit = flowChartCache[code];
    if (hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (flowChartInflight[code]) return flowChartInflight[code];

    var p = fetchJson(GAS_TICKER_URL + '?action=flowChart&code=' + encodeURIComponent(code))
      .then(function (data) {
        delete flowChartInflight[code];
        if (data && !data.error) flowChartCache[code] = { t: Date.now(), data: data };
        return data;
      })
      .catch(function (err) {
        delete flowChartInflight[code];
        throw err;
      });
    flowChartInflight[code] = p;
    return p;
  }

  // 일부 폴백 소스(네이버 수급 표)는 개인 순매매를 제공하지 않는다. 값을 억지로
  // 0으로 채우면 실제 순매도/순매수로 오해할 수 있으므로, 숫자가 아닌 값은 null로
  // 유지해 화면에서 '-'로 표시한다.
  function finiteNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function amountFromShares(shares, close) {
    var s = finiteNumber(shares), c = finiteNumber(close);
    return s == null || c == null ? null : s * c;
  }

  // 차트 VM/GAS가 일시적으로 실패해도 이미 받아온 수급의 종가·거래량으로 최소한의
  // 가격 차트를 제공한다. OHLC가 없는 구간은 종가를 그대로 사용하며, 추정 데이터임을
  // chartData.source로 표시한다. 실제 OHLC가 도착하면 이 데이터는 사용하지 않는다.
  function buildFlowChartFallback(flowData) {
    var source = flowData && flowData.daily || [];
    var asc = source.slice().reverse().map(function (d, i, all) {
      var close = finiteNumber(d.close);
      if (close == null) return null;
      var prev = i > 0 ? finiteNumber(all[i - 1].close) : null;
      var pct = finiteNumber(d.change_pct);
      var open = pct != null && pct > -99 ? close / (1 + pct / 100) : (prev == null ? close : prev);
      return {
        date: d.date,
        open: open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close: close,
        volume: finiteNumber(d.volume) || 0
      };
    }).filter(function (d) { return d; });
    if (asc.length < 2) return null;

    function movingAverage(period) {
      var values = new Array(asc.length).fill(null), sum = 0;
      asc.forEach(function (d, i) {
        sum += d.close;
        if (i >= period) sum -= asc[i - period].close;
        if (i >= period - 1) values[i] = sum / period;
      });
      return values;
    }
    return {
      code: flowData.code,
      daily: asc,
      ma: { ma5: movingAverage(5), ma20: movingAverage(20), ma60: movingAverage(60), ma224: movingAverage(224) },
      levels: { support: [], resistance: [] },
      source: 'flow-fallback'
    };
  }

  // 공매도/대차거래/연기금(VM 직접 온디맨드 호출, GAS 미경유) - 5분 메모리 캐시 +
  // 진행 중 요청 재사용. 실패해도 나머지 위젯은 정상 표시돼야 하므로 호출부에서 catch로 null 처리.
  function fetchInvestorFlowLive(code, name) {
    var hit = investorFlowCache[code];
    if (hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (investorFlowInflight[code]) return investorFlowInflight[code];

    // 2026-07-22: name도 같이 보낸다 - VM의 "위험" 승격 게이트가 KRX 공시 RSS에서
    // 종목명으로 매칭해야 해서(investor_flow.py apply_danger_override), 예전처럼
    // "화면표시용 캐스메틱이라 안 보내도 됨"이 아니게 됨.
    var url = KIWOOM_VM_URL + '/investor-flow/' + encodeURIComponent(code)
      + '?name=' + encodeURIComponent(name || '');
    var p = fetchJson(url)
      .then(function (data) {
        delete investorFlowInflight[code];
        if (data && data.data && !data.data.name) data.data.name = name; // VM은 name을 안 돌려줌 - 프론트가 이미 아는 값으로 채움
        var result = data && data.data ? data.data : data;
        if (result && !result.error) investorFlowCache[code] = { t: Date.now(), data: result };
        return result;
      })
      .catch(function (err) {
        delete investorFlowInflight[code];
        throw err;
      });
    investorFlowInflight[code] = p;
    return p;
  }

  // 헤더 현재가 - data.daily[0].close는 외국인·기관 수급표(EOD, 당일 정규장 종가 고정)라
  // 정규장 마감 후엔 그대로 멈춰 보인다(2026-07-16 사용자 지적). ticker-proxy.gs의 ?codes=
  // 엔드포인트(js/kospi-futures.js 등이 쓰는 것과 동일 소스)는 NXT 시간외가 반영돼 있어
  // 그걸 따로 불러와 헤더에 우선 쓴다 - 실패해도 daily[0]로 자연스럽게 폴백된다.
  function fetchLiveQuote(code, force) {
    var hit = quoteCache[code];
    if (!force && hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (quoteInflight[code]) return quoteInflight[code];

    var p = fetchJson(GAS_TICKER_URL + '?codes=' + encodeURIComponent(code))
      .then(function (list) {
        delete quoteInflight[code];
        var q = (list && list[0]) || null;
        if (q) quoteCache[code] = { t: Date.now(), data: q };
        return q;
      })
      .catch(function (err) {
        delete quoteInflight[code];
        throw err;
      });
    quoteInflight[code] = p;
    return p;
  }

  function fetchJson(url, timeoutMs) {
    timeoutMs = timeoutMs || FETCH_TIMEOUT_MS;
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ---- 렌더링 ----

  function renderResult(box, data, chartData, entry, quote, fundamentals) {
    if (!chartData || chartData.error || !chartData.daily || chartData.daily.length < 2) {
      chartData = buildFlowChartFallback(data);
    }
    // 수급 API는 최신일 우선, 가격 차트는 과거일 우선이므로 차트 쪽에서 날짜로
    // 병합할 수 있도록 원자료를 별도 필드로 전달한다.
    chartData.flow = data.daily || [];
    var techScore = computeTechnicalScore(chartData);

    var latest = data.daily && data.daily[0]; // getForeignFlow는 최신일 우선(내림차순) 정렬
    var aptCurrentPrice = quote ? Number(quote.price) : (latest && latest.close);
    // quote(실시간, NXT 시간외 포함)가 있으면 그걸 헤더에 우선 쓰고, 실패 시에만 daily[0](정규장
    // 종가 고정)로 폴백한다. asOfLabel도 quote 성공 시 "시각"으로, 폴백 시 기존처럼 "날짜"로 보여준다.
    var priceHtml = '';
    var asOfLabel = data.as_of;
    if (quote) {
      priceHtml = ' <span class="ff-price ' + signClass(quote.changeRate) + '">' + Number(quote.price).toLocaleString()
        + '원 (' + (quote.changeRate >= 0 ? '+' : '') + quote.changeRate.toFixed(2) + '%)</span>';
      asOfLabel = quote.time;
    } else if (latest) {
      priceHtml = ' <span class="ff-price ' + signClass(latest.change_pct) + '">' + Number(latest.close).toLocaleString()
        + '원 (' + (latest.change_pct >= 0 ? '+' : '') + latest.change_pct.toFixed(2) + '%)</span>';
    }

    // 헤더(종목명/가격)를 맨 위에 두고 구분선으로 아래 요약 박스와 분리
    var html = '<div class="ff-header">' + stockIconHtml(data.code, 'ff-header-icon') + escapeHtml(data.name || data.code)
      + ' <span class="ff-code">(' + escapeHtml(data.code) + ')</span>'
      + priceHtml
      + ' <span class="ff-asof">' + escapeHtml(asOfLabel) + ' 기준</span></div>'
      + '<div class="ff-divider"></div>';

    // 2주 스윙 판정은 탭 밖에 항상 노출한다. 별점/구 등급은 화면 최종의견에서 제거하고
    // 국면·보유자 행동·신규 진입을 분리해 보여준다.
    html += buildSummaryBox(data, entry, techScore, fundamentals, chartData);

    activeView = 'flow'; // 새 검색마다 수급 탭으로 리셋
    html += buildViewTabs();

    html += '<div class="ff-view" id="ffViewFlow">';
    html += buildFlowCard(data);
    html += buildFlowExtraSections(entry, latest && latest.close);
    html += '</div>';
    html += '<div class="ff-view" id="ffViewApt" hidden>';
    html += buildAptCard();
    html += '</div>';
    html += '<div class="ff-view" id="ffViewChart" hidden>';
    html += buildChartSection(chartData, techScore);
    html += '</div>';
    html += '<div class="ff-view" id="ffViewFundamentals" hidden></div>';
    html += '<div class="ff-view" id="ffViewMomentum" hidden></div>';
    html += '<div class="ff-view" id="ffViewSim" hidden></div>';

    box.innerHTML = html;

    // 캔들차트는 차트 탭이 처음 열릴 때 지연 렌더링한다(wireViewTabs) - hidden(display:none)
    // 컨테이너에 바로 그리면 TradingView Lightweight Charts가 크기를 0으로 잡아 빈 화면이 됨.

    wireChartHover(box.querySelector('.ff-chart-net'), data.daily, 'net');
    wireChartHover(box.querySelector('.ff-chart-ratio'), data.daily, 'ratio');
    wireFlowPeriod(box, data.code, data.name);
    wireViewTabs(box, data.code, data.name, chartData);
    wireMovingAverageToggle(box);
    wireIchimokuToggle(box, chartData);
    wireAptTabs(box, chartData && chartData.daily, aptCurrentPrice, data.code);
    startQuotePolling(box, data.code);
  }

  // 2026-07-28 사용자 리포트: 종목을 조회한 뒤 탭을 오래 열어두면 가격이 조회 시점에
  // 멈춘 채로 안 바뀜(예: 실제 -2%인데 화면엔 +5.99% 그대로) - 이 위젯이 검색 시 딱
  // 한 번만 fetch하고 자동 갱신을 전혀 안 했던 게 원인. 전체 리렌더 대신 헤더의
  // 가격/기준시각만 주기적으로 갱신한다(전체 리렌더는 스크롤 위치·차트 확대상태·열어둔
  // 탭 등을 리셋시켜 오히려 방해가 됨 - 수급/매물대/차트/펀더멘탈 값 자체는 검색 시점
  // 스냅샷 그대로 두는 게 사용자 경험상 낫다는 판단).
  var QUOTE_POLL_MS = 15000;
  var quotePollTimer = null;
  function stopQuotePolling() {
    if (quotePollTimer) { clearInterval(quotePollTimer); quotePollTimer = null; }
  }
  function startQuotePolling(box, code) {
    stopQuotePolling();
    quotePollTimer = setInterval(function () {
      // 2026-08-21 코드 감사: 백그라운드 탭에서도 15초마다 계속 폴링됐음 - 다른 실시간
      // 위젯(watchlist.js, home-widgets.js 등)과 동일하게 탭이 보일 때만 갱신.
      if (document.hidden) return;
      fetchLiveQuote(code, true).then(function (q) {
        if (!q) return;
        var header = box.querySelector('.ff-header');
        if (!header) { stopQuotePolling(); return; } // 다른 종목 재검색으로 이 헤더 자체가 사라짐
        var aptCard = box.querySelector('#ffAptCard');
        if (aptCard && typeof aptCard.__updateCurrentPrice === 'function') aptCard.__updateCurrentPrice(q.price);
        var priceEl = header.querySelector('.ff-price');
        var asofEl = header.querySelector('.ff-asof');
        if (!priceEl) return; // 최초 조회 때 시세를 아예 못 받아온 드문 경우 - 다음 tick 재시도
        priceEl.className = 'ff-price ' + signClass(q.changeRate);
        priceEl.textContent = Number(q.price).toLocaleString() + '원 (' + (q.changeRate >= 0 ? '+' : '') + q.changeRate.toFixed(2) + '%)';
        if (asofEl) asofEl.textContent = q.time + ' 기준';
      }).catch(function () {}); // 실패는 조용히 무시하고 다음 tick에 재시도
    }, QUOTE_POLL_MS);
  }

  // ---- 탭(수급 / 매물대 / 차트 / 펀더멘탈 / 모멘텀) ----
  // 2026-07-27: 매물대(아파트) 카드가 원래 "수급" 탭 안에 얹혀 있었는데, Ver.2 리디자인으로
  // 카드 자체가 옥상/사다리/로비/지하실까지 딸린 큰 위젯이 되면서 수급 탭이 너무 길어져
  // 별도 탭으로 분리(사용자 요청).

  function buildViewTabs() {
    return '<div class="ff-view-tabs">'
      + '<button type="button" class="ff-view-tab active" data-view="flow">수급</button>'
      + '<button type="button" class="ff-view-tab" data-view="apt">매물대</button>'
      + '<button type="button" class="ff-view-tab" data-view="chart">차트</button>'
      + '<button type="button" class="ff-view-tab" data-view="fundamentals">펀더멘탈</button>'
      + '<button type="button" class="ff-view-tab" data-view="momentum">모멘텀</button>'
      + '<button type="button" class="ff-view-tab" data-view="sim">과거 시뮬레이션</button>'
      + '</div>';
  }

  function wireViewTabs(box, code, name, chartData) {
    var tabs = box.querySelectorAll('.ff-view-tab');
    var flowBox = box.querySelector('#ffViewFlow');
    var aptBox = box.querySelector('#ffViewApt');
    var chartBox = box.querySelector('#ffViewChart');
    var fundBox = box.querySelector('#ffViewFundamentals');
    var momentumBox = box.querySelector('#ffViewMomentum');
    var simBox = box.querySelector('#ffViewSim');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        if (view === activeView) return;
        activeView = view;
        tabs.forEach(function (b) { b.classList.toggle('active', b === btn); });
        if (flowBox) flowBox.hidden = view !== 'flow';
        if (aptBox) aptBox.hidden = view !== 'apt';
        if (chartBox) chartBox.hidden = view !== 'chart';
        if (fundBox) fundBox.hidden = view !== 'fundamentals';
        if (momentumBox) momentumBox.hidden = view !== 'momentum';
        if (simBox) simBox.hidden = view !== 'sim';
        if (view === 'fundamentals' && fundBox) loadFundamentals(fundBox, code, name);
        if (view === 'momentum' && momentumBox && !momentumBox.dataset.loaded) {
          momentumBox.dataset.loaded = '1';
          loadNewsMomentum(momentumBox, code, name);
        }
        // 매물대 탭은 hidden(display:none) 상태에서 진입 애니메이션(class 토글)이 이미
        // 끝나버려 처음 열 때 정지 상태로 보이므로, 탭을 열 때마다 다시 재생한다.
        if (view === 'apt' && aptBox) {
          var aptCard = aptBox.querySelector('#ffAptCard');
          if (aptCard) playAptEntrance(aptCard);
        }
        // 차트 탭은 처음 열릴 때만 렌더링(hidden 상태에서 그리면 크기 0으로 잡히는 문제 방지)
        if (view === 'chart' && chartBox && !chartBox.dataset.rendered) {
          chartBox.dataset.rendered = '1';
          var lwContainer = chartBox.querySelector('#ffLwChart');
          if (lwContainer) renderLwChart(lwContainer, chartData);
        }
        // 과거 시뮬레이션 탭도 처음 열릴 때만 만든다(수급/펀더멘탈처럼 항상 켜둘 필요는 없음).
        if (view === 'sim' && simBox && !simBox.dataset.loaded) {
          simBox.dataset.loaded = '1';
          simBox.innerHTML = buildSimulationCard(chartData);
          wireSimulation(simBox, chartData);
        }
      });
    });
  }

  // 2026-07-19: 종합점수(computeFundamentalScore)가 이 데이터를 필요로 해서 "펀더멘탈" 탭을
  // 열 때만 부르던 걸 종목 조회 시점에 항상 먼저 불러오도록 분리(캐싱은 그대로 재사용).
  function fetchFundamentals(code, name) {
    if (fundamentalsCache[code]) return Promise.resolve(fundamentalsCache[code]);
    if (fundamentalsInflight[code]) return fundamentalsInflight[code];
    var p = fetchJson(GAS_TICKER_URL + '?action=fundamentals&code=' + encodeURIComponent(code))
      .then(function (res) {
        delete fundamentalsInflight[code];
        fundamentalsCache[code] = res;
        return res;
      })
      .catch(function (err) {
        delete fundamentalsInflight[code];
        throw err;
      });
    fundamentalsInflight[code] = p;
    return p;
  }

  // 뉴스·검색 관심도 모멘텀은 배치가 별도 news_momentum.db에 미리 계산한 결과만 읽는다.
  // 사용자 탭 진입 시 네이버 뉴스/DataLab API를 직접 호출하지 않는다.
  function fetchNewsMomentum(code) {
    if (newsMomentumCache[code]) return Promise.resolve(newsMomentumCache[code]);
    if (newsMomentumInflight[code]) return newsMomentumInflight[code];
    var p = fetchJson(KIWOOM_VM_URL + '/news-momentum/' + encodeURIComponent(code))
      .then(function (res) {
        delete newsMomentumInflight[code];
        var data = res && res.data ? res.data : res;
        newsMomentumCache[code] = data || { stockCode: code, topics: [] };
        return newsMomentumCache[code];
      })
      .catch(function (err) {
        delete newsMomentumInflight[code];
        throw err;
      });
    newsMomentumInflight[code] = p;
    return p;
  }

  function safeExternalUrl(value) {
    return /^https?:\/\//i.test(value || '') ? value : '';
  }

  function momentumStatusLabel(status) {
    if (status === 'active') return '활성';
    if (status === 'cooling') return '관심 둔화';
    return '종료';
  }

  function momentumSentimentLabel(sentiment) {
    if (sentiment === 'positive') return '긍정';
    if (sentiment === 'negative') return '부정';
    return '중립';
  }

  function momentumChangeStatusLabel(status) {
    if (status === 'new') return '신규';
    if (status === 'expanding') return '확산';
    if (status === 'declining') return '감소';
    if (status === 'persistent') return '지속';
    return '데이터 없음';
  }

  function momentumChangeDescription(status) {
    if (status === 'new') return '최근 7일에 새로 등장했습니다.';
    if (status === 'expanding') return '최근 뉴스가 이전 기간보다 증가하고 있습니다.';
    if (status === 'declining') return '최근 뉴스가 이전 기간보다 감소하고 있습니다.';
    if (status === 'persistent') return '이전 기간과 비슷한 수준을 유지하고 있습니다.';
    return '기간 비교 데이터가 없습니다.';
  }

  function momentumAgeLabel(lastSeenAt) {
    if (!lastSeenAt) return '-';
    var seen = new Date(lastSeenAt + 'T00:00:00');
    var age = Math.max(0, Math.floor((Date.now() - seen.getTime()) / 86400000));
    return age === 0 ? '오늘' : 'D-' + age;
  }

  function momentumTrendBars(daily) {
    var points = (daily || []).filter(function (row) { return row.search_interest != null; }).slice(-14);
    if (!points.length) return '<div class="ff-momentum-no-trend">검색 관심도 데이터 부족</div>';
    var max = Math.max.apply(null, points.map(function (row) { return Number(row.search_interest) || 0; })) || 1;
    return '<div class="ff-momentum-trend" aria-label="최근 검색 관심도">'
      + points.map(function (row) {
        var height = Math.max(4, Math.round((Number(row.search_interest) || 0) / max * 42));
        return '<i style="height:' + height + 'px" title="' + escapeAttr(row.date + ' · ' + Number(row.search_interest).toFixed(1)) + '"></i>';
      }).join('')
      + '</div>';
  }

  function buildNewsMomentumPanel(data, stockName) {
    var topics = (data && data.topics) || [];
    var coverage = data && data.coverage;
    var coverageText = coverage
      ? '데이터 기준일 ' + escapeHtml(data.dataAsOf || coverage.actualEndDate || '-')
        + ' · 최근 ' + Number(coverage.backfillDays || 90) + '일 뉴스 백필 '
        + (coverage.backfillComplete ? '완료' : '부분')
        + ' (' + escapeHtml(coverage.actualStartDate || '-') + ' ~ '
        + escapeHtml(coverage.actualEndDate || '-') + ')'
      : '데이터 기준일 준비 중 · 최근 90일 뉴스 백필 여부 확인 중';
    var intro = '<div class="ff-momentum-intro"><b>이슈·재료 지속성 분석</b>'
      + '<span>가격 변동이 아니라 뉴스 반복성·최근성·통합검색 관심도를 배치 집계한 결과입니다.</span>'
      + '<span class="ff-momentum-coverage">' + coverageText + '</span></div>';
    if (!topics.length) {
      // 2026-08-02: 예전에는 "수집 대상이 아직 아님"과 "수집했지만 반복 이슈가 없음"이
      // 같은 문구로 나와서, 사용자 눈에는 모멘텀 탭이 그냥 안 나오는 것처럼 보였다.
      // 배치 진행 상태(coverage 유무)로 실제 이유를 구분해 표시한다.
      var emptyTitle, emptyDesc;
      if (data && data.enabled === false) {
        emptyTitle = '모멘텀 수집이 일시 중지됨';
        emptyDesc = '서버에서 뉴스·검색 관심도 수집을 잠시 꺼둔 상태입니다. 다시 켜지면 자동으로 표시됩니다.';
      } else if (!coverage) {
        emptyTitle = escapeHtml(stockName) + ' 뉴스 수집 대기 중';
        emptyDesc = '전 종목을 순서대로 수집하고 있어 아직 이 종목 차례가 오지 않았습니다. 수집이 끝나면 자동으로 표시됩니다.';
      } else {
        emptyTitle = escapeHtml(stockName) + ' 반복 이슈 없음';
        emptyDesc = '최근 90일 뉴스를 수집했지만 서로 다른 기사에서 2회 이상 반복된 이슈가 없습니다.';
      }
      return intro + '<div class="ff-momentum-empty"><b>' + emptyTitle + '</b>'
        + '<span>' + escapeHtml(emptyDesc) + '</span></div>';
    }
    var cards = topics.map(function (topic) {
      var sentiment = topic.sentiment || 'neutral';
      var sentimentCounts = topic.sentimentCounts;
      var sentimentCountsText = sentimentCounts
        ? '긍정 ' + Number(sentimentCounts.positive).toLocaleString() + '건 · 중립 '
          + Number(sentimentCounts.neutral).toLocaleString() + '건 · 부정 '
          + Number(sentimentCounts.negative).toLocaleString() + '건'
        : '감성 데이터 없음';
      var sentimentExtra = sentimentCounts
        ? '순감성 ' + (Number(topic.netSentiment) > 0 ? '+' : '') + Number(topic.netSentiment).toLocaleString()
          + ' · 부정 비중 ' + (Number(topic.negativeShare || 0) * 100).toFixed(1) + '%'
        : '분류 가능한 기사 집계 전';
      var recent7dCount = topic.recent7dCount == null ? topic.count7d : topic.recent7dCount;
      var previous7dCount = topic.previous7dCount;
      var changeStatus = topic.momentumStatus;
      var changeRateText = topic.changeRate == null
        ? (changeStatus === 'new' ? '이전 기간 0건' : '변화율 데이터 없음')
        : '변화율 ' + (Number(topic.changeRate) >= 0 ? '+' : '') + Number(topic.changeRate).toFixed(1) + '%';
      var recentComparisonText = previous7dCount == null
        ? '기간별 뉴스 데이터 없음'
        : '최근 7일 ' + Number(recent7dCount || 0).toLocaleString() + '건 · 이전 7일 '
          + Number(previous7dCount).toLocaleString() + '건';
      var latestInterest = topic.latestSearchInterest == null
        ? '데이터 부족' : Number(topic.latestSearchInterest).toFixed(1);
      var interestChange = topic.searchInterestChange;
      var interestChangeText = interestChange == null
        ? '비교 데이터 없음'
        : '7일 평균 대비 ' + (interestChange >= 0 ? '+' : '') + Number(interestChange).toFixed(1);
      var urls = (topic.representativeUrls || []).map(function (url, index) {
        var safe = safeExternalUrl(url);
        return safe ? '<a href="' + escapeAttr(safe) + '" target="_blank" rel="noopener">대표 기사 ' + (index + 1) + '</a>' : '';
      }).join('');
      return '<article class="ff-momentum-card">'
        + '<div class="ff-momentum-card-head"><h4>' + escapeHtml(topic.topicName) + '</h4>'
        + '<span class="ff-momentum-status status-' + escapeAttr(topic.status) + '">' + momentumStatusLabel(topic.status) + '</span>'
        + '<span class="ff-momentum-sentiment sentiment-' + escapeAttr(sentiment) + '">' + momentumSentimentLabel(sentiment) + '</span></div>'
        + '<div class="ff-momentum-metrics">'
        + '<div class="ff-momentum-metric ff-momentum-sentiment-metric"><span>뉴스 방향성</span>'
        + '<b class="sentiment-' + escapeAttr(sentiment) + '">' + momentumSentimentLabel(sentiment) + '</b>'
        + '<small>' + escapeHtml(sentimentCountsText) + '</small><small>' + escapeHtml(sentimentExtra) + '</small>'
        + '<small>※ 뉴스 제목 기준 자동 분류</small></div>'
        + '<div class="ff-momentum-metric ff-momentum-change-metric"><span>모멘텀 상태</span>'
        + '<b class="ff-momentum-change status-' + escapeAttr(changeStatus || 'unknown') + '">'
        + momentumChangeStatusLabel(changeStatus) + '</b><small>' + escapeHtml(recentComparisonText) + '</small>'
        + '<small>' + escapeHtml(changeRateText) + ' · ' + escapeHtml(momentumChangeDescription(changeStatus)) + '</small></div>'
        + '<div class="ff-momentum-metric"><span>검색 관심도</span><b>' + latestInterest + '</b>'
        + '<small>' + escapeHtml(interestChangeText) + '</small></div>'
        + '<div class="ff-momentum-metric"><span>뉴스 반복·최근성</span>'
        + '<b>30일 ' + Number(topic.count30d || 0).toLocaleString() + '건</b>'
        + '<small>' + escapeHtml(momentumAgeLabel(topic.lastSeenAt)) + ' · ' + escapeHtml(topic.lastSeenAt || '-') + '</small></div>'
        + '</div>'
        + momentumTrendBars(topic.daily)
        + '<div class="ff-momentum-keywords">' + (topic.keywords || []).slice(0, 4).map(function (keyword) {
          return '<span>' + escapeHtml(keyword) + '</span>';
        }).join('') + '</div>'
        + (urls ? '<div class="ff-momentum-links">' + urls + '</div>' : '')
        + '</article>';
    }).join('');
    return intro + '<div class="ff-momentum-list">' + cards + '</div>';
  }

  function loadNewsMomentum(box, code, name) {
    box.innerHTML = '<div class="ff-loading"><svg class="ff-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><div>뉴스·검색 관심도 모멘텀을 불러오는 중...</div></div>';
    // 테스트 페이지에서 외부 VM 호출 없이 고정 데이터를 주입할 수 있도록 공개 API를 경유한다.
    var api = global.ForeignFlow && global.ForeignFlow.fetchNewsMomentum
      ? global.ForeignFlow.fetchNewsMomentum : fetchNewsMomentum;
    api(code).then(function (data) {
      // 조회는 됐는데 그리다가 실패한 경우와 조회 자체가 실패한 경우를 구분해 안내한다.
      try {
        box.innerHTML = buildNewsMomentumPanel(data, name);
      } catch (err) {
        box.innerHTML = '<div class="ff-error">모멘텀 데이터를 표시하지 못했어요. 응답 형식이 예상과 달라 화면을 그릴 수 없습니다.</div>';
      }
    }).catch(function () {
      box.innerHTML = '<div class="ff-error">모멘텀 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      delete box.dataset.loaded;
    });
  }

  // 2026-07-28: js/stock-news.js의 "종목분석 요약" 패널이 쓰는 경량 API - #foreign-flow
  // 위젯 전체(검색창/투자시그널 리스트/차트)를 초기화하지 않고, 종합점수 8개 컴포넌트만
  // 계산해 데이터로 돌려준다. 점수 공식은 buildSummaryBox(이 파일)와 완전히 동일한 함수를
  // 그대로 호출하므로 두 화면의 등급이 어긋나지 않는다 - 종목뉴스 쪽에서 점수를 별도로
  // 다시 계산하지 말 것. 가격추세는 이 패널에서만 쓰는 8번째 항목이라 종합점수(computeVerdict)
  // 계산에는 포함하지 않는다(그 공식은 VM의 invest_signal.py와 공유되는 계약이라 항목 수를
  // 바꾸면 daily_scan 배치와 어긋남 - CLAUDE.md 기타 규칙 참고).
  function fetchAnalysisSummary(code, name) {
    var chartPromise = fetchFlowChart(code).catch(function () { return null; });
    var investorFlowPromise = fetchInvestorFlowLive(code, name).catch(function () { return null; });
    var fundamentalsPromise = fetchFundamentals(code, name).catch(function () { return null; });

    return Promise.all([fetchFlow(code, name), chartPromise, investorFlowPromise, fundamentalsPromise])
      .then(function (results) {
        var data = results[0];
        if (!data || data.error || !data.daily || !data.daily.length) return null;
        var chartData = results[1];
        var entry = results[2];
        var fundamentals = results[3];

        var techScore = computeTechnicalScore(chartData);
        var momentum = computeMomentumScore(chartData);
        var flowScore = computeFlowScore(data);
        var foreignInstScore = computeForeignInstScore(data);
        var shortP = entry && entry.short && entry.short.pressure;
        var shortScore = shortP ? shortP.score : null;
        var pension = entry && entry.pension;
        var pensionScore = pension ? computePensionScore(pension) : null;
        var creditP = entry && entry.credit;
        var creditScore = computeCreditScore(creditP);
        var fundamentalScore = computeFundamentalScore(fundamentals);

        return {
          code: data.code,
          name: data.name || name,
          items: [
            { key: 'flow', label: '단기 수급강도', score: flowScore, desc: flowScoreInterpText(data) },
            { key: 'foreignInst', label: '외국인·기관', score: foreignInstScore, desc: foreignInstDescText(data) },
            { key: 'tech', label: '기술적 점수', score: techScore ? techScore.score : null, desc: techInterpText(techScore) },
            { key: 'short', label: '공매도 압박', score: shortScore, desc: shortInterpText(entry && entry.short, entry && entry.loan) },
            { key: 'pension', label: '연기금', score: pensionScore, desc: pensionInterpText(pension).text },
            { key: 'credit', label: '반대매매', score: creditScore, desc: (creditP && creditP.signal) ? creditP.signal.text : '신용융자 데이터가 없는 종목입니다.' },
            { key: 'fundamental', label: '펀더멘탈', score: fundamentalScore, desc: fundamentalInterpText(fundamentals) },
            { key: 'momentum', label: '가격추세', score: momentum ? momentum.score : null, desc: momentumInterpText(momentum) }
          ]
        };
      });
  }

  // investorFlowCache와 동일한 패턴: 종목코드별로 캐싱해 탭 재전환 시 재호출하지 않는다.
  // renderResult 시점에 fetchFundamentals가 이미 불러둬서(위 함수) 보통은 캐시 히트로
  // 즉시 렌더링되고, 실패했을 때만 여기서 다시 시도한다.
  // 2026-08-02: 캐시 히트 경로는 동기 실행이라 buildFundamentalsPanel이 예외를 던지면
  // box.innerHTML이 아예 설정되지 않아 탭이 빈 화면으로 남았다(응답 구조가 조금만 달라도
  // 사용자 눈에는 "펀더멘탈이 안 나온다"로 보임). 두 경로 모두 렌더 실패를 잡아 안내한다.
  function renderFundamentalsPanel(box, res, name) {
    try {
      box.innerHTML = buildFundamentalsPanel(res, name);
    } catch (err) {
      box.innerHTML = '<div class="ff-error">펀더멘탈 데이터를 표시하지 못했어요. 응답 형식이 예상과 달라 화면을 그릴 수 없습니다.</div>';
    }
  }

  function loadFundamentals(box, code, name) {
    if (fundamentalsCache[code]) {
      renderFundamentalsPanel(box, fundamentalsCache[code], name);
      return;
    }
    box.innerHTML = '<div class="ff-loading"><svg class="ff-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><div>펀더멘탈 데이터를 불러오는 중...</div></div>';
    fetchFundamentals(code, name).then(function (res) {
      renderFundamentalsPanel(box, res, name);
    }).catch(function () {
      box.innerHTML = '<div class="ff-error">펀더멘탈 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    });
  }

  function fmtEokWon(eok) {
    if (eok == null || isNaN(eok)) return '-';
    if (Math.abs(eok) >= 10000) return (eok / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '조원';
    return Math.round(eok).toLocaleString('ko-KR') + '억원';
  }
  function fmtThousandShares(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v * 1000).toLocaleString('ko-KR') + '주';
  }
  // fundamentals.py는 원 단위(정수)로 내려온다.
  function fmtWonAmount(v) {
    if (v == null || isNaN(v)) return '-';
    return fmtEokWon(v / 1e8);
  }

  function buildFundamentalsPanel(res, name) {
    var valuation = res && res.valuation;
    var fundamentals = res && res.fundamentals;
    var annual = fundamentals && fundamentals.annual;
    var quarter = fundamentals && fundamentals.latest_quarter;

    var valuationHint = valuation
      ? ''
      : '<div class="ff-hint">실시간 밸류에이션(PER·PBR·EPS)은 현재 시세 응답이 없어 표시하지 않습니다. 아래 연간 실적은 별도로 표시됩니다.</div>';

    // 2026-07-20: 제목이 "기업 개요 · 업종"이었는데 실제로 보여주는 건 시가총액/발행주식수
    // 등 밸류에이션 숫자뿐이라 사용자가 "이게 왜 업종이야, 시가총액이잖아"라고 지적함(사업을
    // 설명하는 텍스트 데이터소스 자체가 없어 "기업개요"는 애초에 구현된 적이 없음, 아래
    // buildSectorTags 참고) - 실제 내용과 맞게 제목을 바꿈.
    // 2026-07-20(2차): "코스피 3대장"이 업종으로 뜨는 게 어색하다는 지적을 계기로, 업종/테마를
    // 아예 분리해서 보여주도록 확장(buildSectorTags 참고) - 제목도 그에 맞게 갱신.
    var html = '<div class="ff-fund-section">'
      + '<div class="ff-fund-title">업종 · 테마 · 시가총액</div>'
      + (valuation ? buildOverviewGrid(valuation) : valuationHint)
      + buildSectorTags(res && res.code)
      + '</div>';

    // annual은 있는데 years 배열이 비었거나 없는 응답도 "데이터 없음"으로 다룬다
    // (예전에는 여기서 예외가 나면서 탭 전체가 빈 화면이 됐다).
    var hasAnnualYears = !!(annual && annual.years && annual.years.length);
    html += '<div class="ff-fund-section">'
      + '<div class="ff-fund-title">재무 (최근 5년)</div>'
      + (hasAnnualYears ? buildAnnualTable(annual) + buildAnnualCharts(annual) : '<div class="ff-hint">' + escapeHtml(name || '') + '은(는) 재무 데이터가 없는 종목입니다(공시 미제출 또는 아직 배치 스캔 전).</div>')
      + '</div>';

    html += '<div class="ff-fund-section">'
      + '<div class="ff-fund-title">성장성 (5년 CAGR)</div>'
      + (hasAnnualYears ? buildGrowthGrid(annual) : '<div class="ff-hint">재무 데이터가 없어 성장성을 계산할 수 없습니다.</div>')
      + '</div>';

    html += '<div class="ff-fund-section">'
      + '<div class="ff-fund-title">최근 실적</div>'
      + (quarter ? buildQuarterBlock(quarter) : '<div class="ff-hint">최근 분기 실적 데이터가 없습니다.</div>')
      + '</div>';

    html += '<div class="ff-fund-section">'
      + '<div class="ff-fund-title">투자지표</div>'
      + (valuation ? buildValuationGrid(valuation) : '<div class="ff-hint">실시간 PER·PBR·EPS 데이터가 없습니다. 재무 실적 기준 지표는 위 연간 실적을 확인해주세요.</div>')
      + '</div>';

    html += '<div class="ff-footnote">재무 데이터와 밸류에이션은 참고용이며, 투자판단 및 그에 따른 책임은 본인에게 있습니다.</div>';

    return html;
  }

  function buildOverviewGrid(v) {
    var rows = [
      ['시가총액', fmtEokWon(v.market_cap_eok)],
      ['발행주식수', fmtThousandShares(v.listed_shares_thousand)],
      ['유통주식수', fmtThousandShares(v.float_shares_thousand) + (v.float_ratio_pct != null ? ' (' + fmtPct(v.float_ratio_pct) + ')' : '')],
      ['외국인 보유율', fmtPct(v.foreign_hold_ratio_pct)]
    ];
    return '<div class="ff-fund-grid">' + rows.map(function (r) {
      return '<div class="ff-fund-cell"><span class="ff-fund-label">' + r[0] + '</span><span class="ff-fund-val">' + r[1] + '</span></div>';
    }).join('') + '</div>';
  }

  function buildValuationGrid(v) {
    var rows = [
      ['PER', v.per == null ? '-' : v.per.toFixed(2) + '배'],
      ['PBR', v.pbr == null ? '-' : v.pbr.toFixed(2) + '배'],
      ['EPS', fmtWon(v.eps)],
      ['BPS', fmtWon(v.bps)]
    ];
    return '<div class="ff-fund-grid">' + rows.map(function (r) {
      return '<div class="ff-fund-cell"><span class="ff-fund-label">' + r[0] + '</span><span class="ff-fund-val">' + r[1] + '</span></div>';
    }).join('') + '</div>';
  }

  // 2026-07-20(3차): "업종"은 원래 data/sectors-v3.js(수작업 큐레이션, ~266종목)의 업종성
  // 카테고리로 대신했었는데, 커버리지가 좁아 삼성전자조차 빠지는 문제가 있었다(직접 발견).
  // 키움 공식 업종분류(ka10100 upName)도 실측해봤지만 KOSPI 기준 31개 대분류뿐이라("전기/
  // 전자" 하나에 반도체·2차전지·가전이 다 섞임) 부적합 판정. 최종적으로 FnGuide WICS(GICS를
  // 국내 실정에 맞게 재구성, 네이버/다음 증권이 쓰는 것과 같은 체계 - 인증 없는 공개
  // 엔드포인트)로 교체(사용자 제안, scripts/fetch_wics_map.py가 data/wics-map.js 생성) -
  // ~2,500종목을 GICS 수준 세밀도(예: "반도체와반도체장비")로 커버한다.
  // "테마"(2차전지/로봇/우주항공/방위산업/K뷰티 등)는 WICS에 대응 개념이 없는 내러티브
  // 중심 그룹이라(실측 확인: LG에너지솔루션의 WICS 업종은 "전자와 전기제품"일 뿐 "2차전지"가
  // 아님, 한화에어로스페이스는 "자본재"일 뿐 "방위산업"이 아님) data/sectors-v3.js의 수작업
  // 큐레이션을 그대로 유지한다 - 아래 SECTOR_TYPE_MAP은 이제 "테마로 볼 카테고리"만 표시하는
  // 용도(그 외 sectors-v3.js 카테고리는 대시보드 전용으로만 쓰이고 여기선 안 읽음).
  var SECTOR_TYPE_MAP = {
    'IT/스테이블코인': 'theme',
    '2차전지': 'theme',
    '신재생/원자력': 'theme',
    '로봇': 'theme',
    '우주항공': 'theme',
    '방위산업': 'theme',
    'K뷰티': 'theme'
  };

  function buildSectorTags(code) {
    if (!code) return '<div class="ff-hint">업종 데이터를 불러오지 못했어요.</div>';

    var wics = global.WICS_MAP && global.WICS_MAP[code];
    var industries = wics && wics.industry ? [wics.industry] : [];

    var sectorMap = global.SECTOR_MAP;
    var themes = [];
    if (sectorMap) {
      for (var name in sectorMap) {
        if (!sectorMap.hasOwnProperty(name) || SECTOR_TYPE_MAP[name] !== 'theme') continue;
        var list = sectorMap[name] || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].code === code) { themes.push(name); break; }
        }
      }
    }
    if (!industries.length && !themes.length) return '<div class="ff-hint">업종 분류 정보가 없는 종목입니다.</div>';

    function tagRow(label, names, cls) {
      if (!names.length) return '';
      return '<div class="ff-sector-row">'
        + '<span class="ff-sector-row-label">' + label + '</span>'
        + '<div class="ff-sector-tags">' + names.map(function (s) {
            // 2026-07-20: 배지를 클릭하면 같은 업종/테마의 다른 종목 목록을 보여준다
            // (사용자 요청) - data-related-type으로 WICS_MAP 역조회(업종)와 SECTOR_MAP
            // 직접 조회(테마)를 구분한다(showRelatedStocks 참고).
            return '<span class="ff-badge ff-badge-clickable ' + cls + '" data-related="' + escapeAttr(s) + '" data-related-type="' + (cls === 'ff-badge-theme' ? 'theme' : 'industry') + '">' + escapeHtml(s) + '</span>';
          }).join('') + '</div>'
        + '</div>';
    }
    return tagRow('업종', industries, 'ff-badge-neutral') + tagRow('테마', themes, 'ff-badge-theme');
  }

  // fundamentals.py의 fetch_annual_series가 이미 계산해 캐시에 넣어둔 CAGR/최근 ROE·ROA·
  // 부채비율을 화면에 노출만 한다(서버 변경 불필요, 기존에 계산만 되고 표시가 안 되고 있었음).
  function buildGrowthGrid(annual) {
    var rows = [
      ['매출액 CAGR', fmtSignedPct(annual.revenue_cagr_pct)],
      ['영업이익 CAGR', fmtSignedPct(annual.operating_income_cagr_pct)],
      ['순이익 CAGR', fmtSignedPct(annual.net_income_cagr_pct)],
      ['최근 ROE', fmtPct(annual.latest_roe_pct)],
      ['최근 ROA', fmtPct(annual.latest_roa_pct)],
      ['최근 부채비율', fmtPct(annual.latest_debt_ratio_pct)]
    ];
    return '<div class="ff-fund-grid">' + rows.map(function (r) {
      return '<div class="ff-fund-cell"><span class="ff-fund-label">' + r[0] + '</span><span class="ff-fund-val">' + r[1] + '</span></div>';
    }).join('') + '</div>';
  }

  function buildAnnualTable(annual) {
    var rows = annual.years.map(function (y) {
      return '<tr><td>' + y.year + '</td>'
        + '<td>' + fmtWonAmount(y.revenue) + '</td>'
        + '<td>' + fmtWonAmount(y.operating_income) + '</td>'
        + '<td>' + fmtWonAmount(y.net_income) + '</td>'
        + '<td>' + fmtPct(y.revenue != null && y.operating_income != null && y.revenue !== 0 ? y.operating_income / y.revenue * 100 : null) + '</td>'
        + '<td>' + fmtPct(y.revenue != null && y.net_income != null && y.revenue !== 0 ? y.net_income / y.revenue * 100 : null) + '</td>'
        + '<td>' + fmtPct(y.roe_pct) + '</td>'
        + '<td>' + fmtPct(y.roa_pct) + '</td>'
        + '<td>' + fmtPct(y.debt_ratio_pct) + '</td>'
        + '</tr>';
    }).join('');
    return '<table class="ff-fund-table"><thead><tr>'
      + '<th>연도</th><th>매출액</th><th>영업이익</th><th>순이익</th><th>영업이익률</th><th>순이익률</th><th>ROE</th><th>ROA</th><th>부채비율</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  var TREND_NEUTRAL_COLOR = '#9ca3af';

  // 외부 차트 라이브러리 없이 인라인 SVG 막대그래프(marketcap-bubble.js/섹터 히트맵과 동일한 방식).
  // items[i].trend가 있으면 그 값('up'/'down')으로 색을 정하고(추세 기준: 증가=빨강/감소=파랑),
  // 없으면 예전처럼 값의 부호로 정한다(부호 기준 색이 맞는 경우, 예: YoY %처럼 이미 증감을
  // 나타내는 값).
  function svgBarChart(items, colorPos, colorNeg) {
    var w = 320, h = 90, barW = Math.min(48, (w - 20) / items.length - 10);
    var vals = items.map(function (it) { return it.value == null ? 0 : it.value; });
    var maxAbs = Math.max.apply(null, vals.map(Math.abs).concat([1]));
    var zeroY = h - 22;
    var scale = (zeroY - 10) / maxAbs;
    var bars = items.map(function (it, i) {
      var x = 10 + i * (w - 20) / items.length + ((w - 20) / items.length - barW) / 2;
      var v = it.value == null ? 0 : it.value;
      var barH = Math.abs(v) * scale;
      var y = v >= 0 ? zeroY - barH : zeroY;
      var color = it.trend === 'up' ? colorPos : it.trend === 'down' ? colorNeg
        : it.trend === null ? TREND_NEUTRAL_COLOR
        : (v >= 0 ? colorPos : colorNeg);
      var label = it.value == null ? '-' : (Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(1) + '조' : (v / 1e8).toFixed(0) + '억');
      return '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(barH, 1) + '" fill="' + color + '" rx="2"></rect>'
        + '<text x="' + (x + barW / 2) + '" y="' + (v >= 0 ? y - 4 : zeroY + barH + 12) + '" text-anchor="middle" class="ff-bar-val">' + label + '</text>'
        + '<text x="' + (x + barW / 2) + '" y="' + (h - 6) + '" text-anchor="middle" class="ff-bar-label">' + escapeHtml(it.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ff-bar-chart"><line x1="0" y1="' + zeroY + '" x2="' + w + '" y2="' + zeroY + '" class="ff-bar-axis"></line>' + bars + '</svg>';
  }

  function buildAnnualCharts(annual) {
    var years = annual.years;
    // 전년 대비 증가=빨강/감소=파랑 (값 자체의 부호가 아니라 추세로 색을 정한다).
    // 첫 해는 비교할 전년이 없어 중립색.
    function series(field) {
      return years.map(function (y, i) {
        var v = y[field];
        var prev = i > 0 ? years[i - 1][field] : null;
        var trend = i === 0 || v == null || prev == null ? null : (v >= prev ? 'up' : 'down');
        return { label: String(y.year).slice(2) + "'", value: v, trend: trend };
      });
    }
    return '<div class="ff-fund-charts">'
      + '<div class="ff-chart-block"><div class="ff-chart-title">매출액 추이</div>' + svgBarChart(series('revenue'), '#d24f45', '#1261c4') + '</div>'
      + '<div class="ff-chart-block"><div class="ff-chart-title">영업이익 추이</div>' + svgBarChart(series('operating_income'), '#d24f45', '#1261c4') + '</div>'
      + '<div class="ff-chart-block"><div class="ff-chart-title">순이익 추이</div>' + svgBarChart(series('net_income'), '#d24f45', '#1261c4') + '</div>'
      + '</div>';
  }

  // 매출액/영업이익/순이익을 한 차트에 같이 그리면 규모 차이(매출액 >> 순이익) 때문에
  // 작은 지표 막대가 안 보일 정도로 찌그러진다 - 지표별로 독립된 스케일의 2-바(전년동기 vs
  // 이번분기) 미니 차트로 나눠서 각자 잘 보이게 하고, 증가/감소를 색으로도 바로 알 수 있게 한다.
  function quarterMetricChart(title, current, yoyPct) {
    var prev = null;
    if (current != null && yoyPct != null) {
      var ratio = 1 + yoyPct / 100;
      if (ratio !== 0) prev = current / ratio;
    }
    var trend = current == null || prev == null ? null : (current >= prev ? 'up' : 'down');
    var items = [
      { label: '전년동기', value: prev, trend: null },
      { label: '이번분기', value: current, trend: trend }
    ];
    return '<div class="ff-chart-block"><div class="ff-chart-title">' + escapeHtml(title) + '</div>' + svgBarChart(items, '#d24f45', '#1261c4') + '</div>';
  }

  function buildQuarterBlock(q) {
    var rows = [
      ['매출액', fmtWonAmount(q.revenue), fmtSignedPct(q.revenue_yoy_pct)],
      ['영업이익', fmtWonAmount(q.operating_income), fmtSignedPct(q.operating_income_yoy_pct)],
      ['당기순이익', fmtWonAmount(q.net_income), fmtSignedPct(q.net_income_yoy_pct)]
    ];
    var tableHtml = '<div class="ff-quarter-label">' + escapeHtml(q.period_label || q.label || '') + ' (전년 동기 대비 YoY)</div>'
      + '<table class="ff-fund-table"><thead><tr><th>구분</th><th>금액</th><th>YoY</th></tr></thead><tbody>'
      + rows.map(function (r) {
        var cls = r[2] === '-' ? 'ff-flat' : (r[2].indexOf('-') === 0 ? 'ff-sell' : 'ff-buy');
        return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="' + cls + '">' + r[2] + '</td></tr>';
      }).join('') + '</tbody></table>';

    var chartsHtml = '<div class="ff-fund-charts">'
      + quarterMetricChart('매출액', q.revenue, q.revenue_yoy_pct)
      + quarterMetricChart('영업이익', q.operating_income, q.operating_income_yoy_pct)
      + quarterMetricChart('순이익', q.net_income, q.net_income_yoy_pct)
      + '</div>';
    return tableHtml + chartsHtml;
  }

  // ---- 종합 점수 요약 박스 (수급/공매도/연기금/기술적 점수 + AI 한줄요약) ----

  var ICHIMOKU_TENKAN_PERIOD = 9, ICHIMOKU_KIJUN_PERIOD = 26, ICHIMOKU_SENKOU_B_PERIOD = 52, ICHIMOKU_DISPLACEMENT = 26;

  function ichimokuPeriodMid(daily, i, period) {
    var start = i - period + 1;
    if (start < 0) return null;
    var hi = -Infinity, lo = Infinity;
    for (var k = start; k <= i; k++) {
      if (daily[k].high > hi) hi = daily[k].high;
      if (daily[k].low < lo) lo = daily[k].low;
    }
    return (hi + lo) / 2;
  }

  // 마지막 거래일 이후 26영업일치 날짜를 만들어 선행스팬(미래로 26일 선행)을 그릴 자리를 마련한다.
  // 공휴일은 고려하지 않는 근사치(주말만 건너뜀) - 캔들이 없는 구간에 참고용 구름 선을 얹는
  // 용도라 실제 거래일과 1~2일 어긋나도 해석에 지장 없음.
  function nextBusinessDates(lastDate, count) {
    var d = new Date(lastDate + 'T00:00:00');
    var out = [];
    while (out.length < count) {
      d.setDate(d.getDate() + 1);
      var dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  // 일목균형표 5선. 전환선(9)/기준선(26)은 daily와 같은 시점에, 선행스팬1·2는 26영업일 뒤,
  // 후행스팬(종가)은 26영업일 전 자리에 그린다.
  // TODO(2026-07-16, 사용자 요청 보류): 구름(선행스팬1·2 사이) 채우기는 Lightweight Charts
  // v4가 "두 선 사이 채우기"를 지원 안 해서 지금은 선 5개만 그린다. 하려면 v5로 올려 커스텀
  // 시리즈 플러그인을 만들어야 하는데, 이 CDN 버전을 종목분석/코스피선물/보조지수/관심지수
  // 등 사이트 전체가 공유해서 쓰고 있어 버전업 시 전체 차트 회귀테스트가 필요함 - 사용자가
  // "to do list로 남기자"고 결정, 지금 당장은 손대지 않음.
  function computeIchimoku(daily) {
    var n = daily.length;
    var tenkan = new Array(n).fill(null);
    var kijun = new Array(n).fill(null);
    for (var i = 0; i < n; i++) {
      tenkan[i] = ichimokuPeriodMid(daily, i, ICHIMOKU_TENKAN_PERIOD);
      kijun[i] = ichimokuPeriodMid(daily, i, ICHIMOKU_KIJUN_PERIOD);
    }
    var futureDates = nextBusinessDates(daily[n - 1].date, ICHIMOKU_DISPLACEMENT);
    function timeAt(idx) { return idx < n ? daily[idx].date : futureDates[idx - n]; }

    var tenkanPts = [], kijunPts = [], senkouAPts = [], senkouBPts = [], chikouPts = [];
    for (var j = 0; j < n; j++) {
      if (tenkan[j] != null) tenkanPts.push({ time: daily[j].date, value: tenkan[j] });
      if (kijun[j] != null) kijunPts.push({ time: daily[j].date, value: kijun[j] });
      if (tenkan[j] != null && kijun[j] != null) {
        senkouAPts.push({ time: timeAt(j + ICHIMOKU_DISPLACEMENT), value: (tenkan[j] + kijun[j]) / 2 });
      }
      var spanB = ichimokuPeriodMid(daily, j, ICHIMOKU_SENKOU_B_PERIOD);
      if (spanB != null) senkouBPts.push({ time: timeAt(j + ICHIMOKU_DISPLACEMENT), value: spanB });
      var laggingIdx = j - ICHIMOKU_DISPLACEMENT;
      if (laggingIdx >= 0) chikouPts.push({ time: daily[laggingIdx].date, value: daily[j].close });
    }

    // "오늘" 자리 위의 구름 상/하단은 26영업일 전 시점에 계산된 선행스팬 값과 같다(선행스팬은
    // 26일 앞서 그려지므로, 오늘 자리에 얹힌 구름은 26일 전 데이터로 만들어진 것) - 점수 계산용.
    var cloudIdx = n - 1 - ICHIMOKU_DISPLACEMENT;
    var todaySenkouA = cloudIdx >= 0 && tenkan[cloudIdx] != null && kijun[cloudIdx] != null
      ? (tenkan[cloudIdx] + kijun[cloudIdx]) / 2 : null;
    var todaySenkouB = cloudIdx >= 0 ? ichimokuPeriodMid(daily, cloudIdx, ICHIMOKU_SENKOU_B_PERIOD) : null;

    return {
      tenkan: tenkanPts, kijun: kijunPts, senkouA: senkouAPts, senkouB: senkouBPts, chikou: chikouPts,
      lastTenkan: tenkan[n - 1], lastKijun: kijun[n - 1],
      todaySenkouA: todaySenkouA, todaySenkouB: todaySenkouB
    };
  }

  // 구름 위/아래(10) + 전환선-기준선 골든/데드(10) + 구름 색 양운/음운(10) = 0~30점.
  // scripts/cloud-vm/pattern_detect.py의 compute_tech_score와 동일 공식으로 유지해야
  // 종목분석/투자시그널 등급이 어긋나지 않는다.
  function computeIchimokuScore(daily) {
    var ichi = computeIchimoku(daily);
    var close = daily[daily.length - 1].close;

    var cloudScore = 0, cloudLabel = '데이터 부족';
    if (ichi.todaySenkouA != null && ichi.todaySenkouB != null) {
      var top = Math.max(ichi.todaySenkouA, ichi.todaySenkouB);
      var bottom = Math.min(ichi.todaySenkouA, ichi.todaySenkouB);
      if (close > top) { cloudScore = 10; cloudLabel = '구름 위'; }
      else if (close < bottom) { cloudScore = 0; cloudLabel = '구름 아래'; }
      else { cloudScore = 5; cloudLabel = '구름 안(혼조)'; }
    }

    var crossScore = 0, crossLabel = '데이터 부족';
    if (ichi.lastTenkan != null && ichi.lastKijun != null) {
      if (ichi.lastTenkan > ichi.lastKijun) { crossScore = 10; crossLabel = '전환선 > 기준선(골든)'; }
      else if (ichi.lastTenkan < ichi.lastKijun) { crossScore = 0; crossLabel = '전환선 < 기준선(데드)'; }
      else { crossScore = 5; crossLabel = '전환선 = 기준선'; }
    }

    var colorScore = 0, colorLabel = '데이터 부족';
    if (ichi.todaySenkouA != null && ichi.todaySenkouB != null) {
      if (ichi.todaySenkouA > ichi.todaySenkouB) { colorScore = 10; colorLabel = '양운(선행스팬1 > 2)'; }
      else if (ichi.todaySenkouA < ichi.todaySenkouB) { colorScore = 0; colorLabel = '음운(선행스팬1 < 2)'; }
      else { colorScore = 5; colorLabel = '중립'; }
    }

    return {
      score: cloudScore + crossScore + colorScore,
      cloud: { score: cloudScore, label: cloudLabel },
      cross: { score: crossScore, label: crossLabel },
      color: { score: colorScore, label: colorLabel },
      lines: ichi
    };
  }

  // 이동평균(25) + 지지선 근접도(15) + 저항선 근접도(15) + 일목균형표(30) + 거래량(15) = 0~100점.
  // (2026-07-22: 거래량을 5번째 항목으로 추가하며 기존 30/20/20/30에서 5점씩 걷어 15점을
  // 새로 배정 - 일목균형표는 이미 3개 신호(구름/교차/색)를 종합한 지표라 30점 그대로 유지).
  // scripts/cloud-vm/pattern_detect.py의 compute_tech_score와 배점을 반드시 일치시킬 것.
  // 차트 데이터(?action=flowChart)가 없으면 null.
  function computeTechnicalScore(chartData) {
    if (!chartData || chartData.error || !chartData.daily || !chartData.daily.length) return null;
    var daily = chartData.daily;
    var close = daily[daily.length - 1].close;
    var ma = chartData.ma || {};
    function lastVal(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
    var ma5 = lastVal(ma.ma5), ma20 = lastVal(ma.ma20), ma60 = lastVal(ma.ma60);

    var maScore = 0, maLabel = '데이터 부족';
    if (ma5 != null && ma20 != null && ma60 != null) {
      if (ma5 > ma20 && ma20 > ma60) { maScore = 25; maLabel = '정배열'; }
      else if (ma20 > ma60) { maScore = 17; maLabel = '20일선 > 60일선'; }
      else if (ma5 > ma20) { maScore = 8; maLabel = '5일선만 상향'; }
      else { maScore = 0; maLabel = '역배열'; }
    }

    var support = (chartData.levels && chartData.levels.support) || [];
    var supScore = 0, supLabel = '지지선 없음';
    if (support.length) {
      var nearestSup = support.reduce(function (a, b) { return Math.abs(b - close) < Math.abs(a - close) ? b : a; });
      var supGap = (close - nearestSup) / nearestSup * 100;
      if (supGap < 0) { supScore = 0; supLabel = '지지선 이탈'; }
      else if (supGap <= 2) { supScore = 15; supLabel = '지지선 ±2% 이내'; }
      else if (supGap <= 5) { supScore = 9; supLabel = '지지선 ±5% 이내'; }
      else if (supGap <= 8) { supScore = 4; supLabel = '지지선 ±8% 이내'; }
      else { supScore = 0; supLabel = '지지선과 거리 있음'; }
    }

    var resistance = (chartData.levels && chartData.levels.resistance) || [];
    var resScore = 0, resLabel = '저항선 없음';
    if (resistance.length) {
      var nearestRes = resistance.reduce(function (a, b) { return Math.abs(b - close) < Math.abs(a - close) ? b : a; });
      var resGap = (nearestRes - close) / close * 100;
      // "저항 접근 중" 상한(8%)은 지시서 표에 정확한 경계값이 없어 3%(15점) 다음 구간으로 잡은 값
      if (resGap < 0) { resScore = 15; resLabel = '저항 돌파'; }
      else if (resGap <= 3) { resScore = 9; resLabel = '저항 3% 이내'; }
      else if (resGap <= 8) { resScore = 4; resLabel = '저항 접근 중'; }
      else { resScore = 0; resLabel = '저항 아래 멀리'; }
    }

    var ichi = computeIchimokuScore(daily);
    var vol = computeVolumeScore(daily);

    return {
      score: maScore + supScore + resScore + ichi.score + vol.score,
      ma: { score: maScore, label: maLabel },
      support: { score: supScore, label: supLabel },
      resistance: { score: resScore, label: resLabel },
      ichimoku: ichi,
      volume: vol
    };
  }

  function techInterpText(t) {
    if (!t) return '차트 데이터가 부족해 기술적 점수를 계산하지 못했습니다.';
    return '기술적 점수 ' + t.score + '/100 · 이평 ' + t.ma.score + '/25 (' + t.ma.label + ') · 지지 ' + t.support.score + '/15 (' + t.support.label + ') · 저항 ' + t.resistance.score + '/15 (' + t.resistance.label + ') · 일목 ' + t.ichimoku.score + '/30 · 거래량 ' + t.volume.score + '/15';
  }

  // 가격추세 - 2026-07-28 종목뉴스 페이지("종목분석" 요약 패널) 참고 항목. 최근 가격 추세의
  // 강도를 0~100점으로 환산 - 5·20거래일 수익률(chartData.daily, ?action=flowChart 응답을
  // 그대로 재사용)과 5일선 기울기(정배열/역배열과는 별개로 "방향이 막 바뀌었는지"를 봄)를
  // 합산한다. 새 백엔드 없이 이미 있는 차트 데이터만으로 클라이언트에서 계산.
  function computeMomentumScore(chartData) {
    if (!chartData || chartData.error || !chartData.daily || chartData.daily.length < 21) return null;
    var daily = chartData.daily;
    var close = daily[daily.length - 1].close;
    var close5 = daily[daily.length - 6].close;
    var close20 = daily[daily.length - 21].close;
    var ret5 = (close - close5) / close5 * 100;
    var ret20 = (close - close20) / close20 * 100;

    function bandScore(v, bands) {
      for (var i = 0; i < bands.length; i++) {
        if (v >= bands[i][0]) return bands[i][1];
      }
      return 0;
    }
    var ret5Score = bandScore(ret5, [[10, 40], [5, 32], [2, 24], [0, 16], [-2, 8]]);
    var ret20Score = bandScore(ret20, [[20, 35], [10, 28], [5, 21], [0, 14], [-5, 7]]);

    var ma5arr = (chartData.ma && chartData.ma.ma5) || [];
    var slopeScore = 10, slopeLabel = '5일선 데이터 부족';
    if (ma5arr.length >= 6 && ma5arr[ma5arr.length - 1] != null && ma5arr[ma5arr.length - 6] != null) {
      var slope = (ma5arr[ma5arr.length - 1] - ma5arr[ma5arr.length - 6]) / ma5arr[ma5arr.length - 6] * 100;
      if (slope > 1) { slopeScore = 25; slopeLabel = '5일선 상승 전환'; }
      else if (slope > 0) { slopeScore = 15; slopeLabel = '5일선 완만한 상승'; }
      else if (slope > -1) { slopeScore = 8; slopeLabel = '5일선 완만한 하락'; }
      else { slopeScore = 0; slopeLabel = '5일선 하락 전환'; }
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(ret5Score + ret20Score + slopeScore))),
      ret5: ret5,
      ret20: ret20,
      slopeLabel: slopeLabel
    };
  }

  function momentumInterpText(m) {
    if (!m) return '차트 데이터가 부족해 가격추세를 계산하지 못했습니다.';
    var s5 = (m.ret5 >= 0 ? '+' : '') + m.ret5.toFixed(1) + '%';
    var s20 = (m.ret20 >= 0 ? '+' : '') + m.ret20.toFixed(1) + '%';
    return '최근 5일 ' + s5 + ' · 20일 ' + s20 + ' · ' + m.slopeLabel;
  }

  // 외국인/기관 5일·20일 순매매 방향(4개) 각 ±12.5점, 기준 50점 -> 0~100점.
  function computeFlowScore(data) {
    var r = data.rolling || {};
    var f5 = r['5d'] ? r['5d'].foreign : 0;
    var f20 = r['20d'] ? r['20d'].foreign : 0;
    var i5 = r['5d'] ? r['5d'].inst : 0;
    var i20 = r['20d'] ? r['20d'].inst : 0;
    function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
    var score = 50 + 12.5 * (sgn(f5) + sgn(f20) + sgn(i5) + sgn(i20));
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // 연기금 톤(very_positive~caution) 기준점수 + 연속매매일수 가중치 -> 0~100점.
  function computePensionScore(p) {
    if (!p) return null;
    var base = PENSION_TONE_SCORE[pensionInterpText(p).tone];
    if (base == null) return null;
    var streak = p.streak || { days: 0, direction: 'flat' };
    var days = Math.min(streak.days || 0, 15);
    var adj = streak.direction === 'buy' ? days * 0.7 : streak.direction === 'sell' ? -days * 0.7 : 0;
    return Math.max(0, Math.min(100, Math.round(base + adj)));
  }

  // 2026-07-19: scripts/cloud-vm/invest_signal.py의 compute_credit_score와 완전히 동일한
  // 공식(둘 중 하나만 고치면 두 페이지 등급이 어긋남) - 반대매매 압박 신호를 "높을수록
  // 안전"인 0~100으로 환산(플래그 없음=100, 가능성=40, 강함=10).
  function computeCreditScore(credit) {
    if (!credit || !credit.signal) return null;
    var sig = credit.signal;
    if (!sig.flag) return 100;
    return (sig.label || '').indexOf('강함') !== -1 ? 10 : 40;
  }

  // 2026-07-19: scripts/cloud-vm/invest_signal.py의 compute_fundamental_score와 동일 공식.
  // DART 연간 재무(ROE 60%+부채비율 40%)만 사용 - PER/PBR은 배치가 라이브 시세를 안 불러와서
  // 제외(두 페이지가 항상 같은 입력으로 계산 가능해야 함). fundamentals.annual이 없으면(DART
  // 미제출 등) null -> computeVerdict가 중립(50점)으로 채운다.
  function computeFundamentalScore(fundamentals) {
    var annual = fundamentals && fundamentals.fundamentals && fundamentals.fundamentals.annual;
    if (!annual) return null;
    var roe = annual.latest_roe_pct, debt = annual.latest_debt_ratio_pct;
    if (roe == null && debt == null) return null;
    var roeScore = roe != null ? (roe >= 15 ? 100 : roe >= 10 ? 80 : roe >= 5 ? 60 : roe >= 0 ? 40 : 20) : 50;
    var debtScore = debt != null ? (debt <= 50 ? 100 : debt <= 100 ? 80 : debt <= 150 ? 60 : debt <= 200 ? 40 : 20) : 50;
    return Math.round(roeScore * 0.6 + debtScore * 0.4);
  }

  // computeFlowScore와 완전히 같은 신호(5·20일 롤링 합산 부호 4개)로 설명 문구를 만들어서
  // "오늘의 수급" 행의 점수와 설명이 절대 어긋나지 않게 한다(예: 100점인데 "방향이 뚜렷하지
  // 않다"고 나오는 모순 방지) - flowInterpText(아래, streak 기준)는 상단 배지 전용이고
  // 이 둘을 같은 자리에 섞어 쓰면 안 된다.
  function flowScoreInterpText(data) {
    var r = data.rolling || {};
    var f5 = r['5d'] ? r['5d'].foreign : 0;
    var f20 = r['20d'] ? r['20d'].foreign : 0;
    var i5 = r['5d'] ? r['5d'].inst : 0;
    var i20 = r['20d'] ? r['20d'].inst : 0;
    function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
    var total = sgn(f5) + sgn(f20) + sgn(i5) + sgn(i20); // computeFlowScore의 score = 50 + 12.5*total과 동일 신호
    if (total >= 3) return '최근 5·20일 외국인·기관 수급이 뚜렷한 순매수 우위입니다.';
    if (total >= 1) return '최근 5·20일 외국인·기관 수급이 순매수 쪽으로 다소 기울어 있습니다.';
    if (total <= -3) return '최근 5·20일 외국인·기관 수급이 뚜렷한 순매도 우위입니다.';
    if (total <= -1) return '최근 5·20일 외국인·기관 수급이 순매도 쪽으로 다소 기울어 있습니다.';
    return '최근 5·20일 외국인·기관 수급이 혼조세입니다.';
  }

  // 상단 배지(색·톤)와 해석 문구가 같은 방향 판정을 쓰도록 하는 공용 헬퍼.
  // 예전엔 streak.direction(최신일부터 역순 연속 방향)을 그대로 썼는데, 그러면 4일 연속
  // 순매수하다 오늘 하루만 반대매매가 나와도 streak이 "1일 순매도"로 리셋되면서 곧바로
  // 중립으로 떨어지는 문제가 있었다(2026-07-23 사용자 리포트: 신일전기 - 외국인이 5일 누적
  // +51,876주 순매수인데 당일 -4,952주 하나 때문에 "방향이 뚜렷하지 않다"로 표시됨).
  // streak이 짧으면(3일 미만) 노이즈로 보고 5일 합산 부호로 스무딩하고, streak이 3일
  // 이상 이어졌다면(=frgnSignal의 "5일 중 3일 이상" 연속성 기준과 동일선상) 이미 노이즈가
  // 아니라 실제 흐름이므로 raw streak을 그대로 신뢰한다.
  function flowDirection(kind, data) {
    var st = (data.streak && data.streak[kind]) || { direction: 'flat', days: 0 };
    if (st.direction !== 'flat' && st.days >= 3) return st.direction;
    var v5 = data.rolling && data.rolling['5d'] ? data.rolling['5d'][kind] : 0;
    if (v5 > 0) return 'buy';
    if (v5 < 0) return 'sell';
    return st.direction;
  }

  // "오늘의 수급" 행(flowScoreInterpText, rolling 5·20일 기준)과는 별개로 상단 배지 전용
  // 문구 - flowDirection과 같은 방향 판정을 써서 배지·문구가 항상 같은 결론을 가리키게 한다.
  function flowInterpText(data) {
    var f = flowDirection('foreign', data);
    var i = flowDirection('inst', data);
    if (f === 'buy' && i === 'buy') return '외국인과 기관이 동반 순매수하며 수급이 양호합니다.';
    if (f === 'buy' && i === 'sell') return '외국인은 순매수, 기관은 순매도로 엇갈리고 있습니다.';
    if (f === 'sell' && i === 'buy') return '기관은 순매수, 외국인은 순매도로 엇갈리고 있습니다.';
    if (f === 'sell' && i === 'sell') return '외국인과 기관이 동반 순매도하며 수급이 약화되고 있습니다.';
    return '외국인·기관 수급 방향이 뚜렷하지 않습니다.';
  }

  // flowInterpText와 같은 flowDirection 기준으로 색·배지 톤을 정해서 문구와 절대 어긋나지 않게 한다.
  function flowTone(data) {
    var f = flowDirection('foreign', data);
    var i = flowDirection('inst', data);
    if (f === 'buy' && i === 'buy') return { tone: 'positive', label: '긍정' };
    if (f === 'sell' && i === 'sell') return { tone: 'caution', label: '주의' };
    return { tone: 'neutral', label: '중립' };
  }

  function shortInterpText(s, l) {
    if (!s || !s.pressure) return '공매도 데이터가 없는 종목입니다.';
    var label = s.pressure.grade.label;
    var parts = ['거래비중 ' + fmtPct(s.today_ratio_pct)];
    if (s.days_to_cover != null) parts.push('Days to Cover ' + s.days_to_cover.toFixed(1) + '일');
    if (l && l.balance_change_pct != null) parts.push('대차잔고 ' + fmtSignedPct(l.balance_change_pct));
    var base = parts.join(' · ') + '로 압박 ' + label + ' 수준입니다.';
    var gate = s.pressure.danger_gate;
    if (gate && gate.triggered) {
      base += ' KRX 공매도 과열종목 지정 + 최근 5거래일 ' + fmtSignedPct(gate.price_decline_pct)
        + ' 하락 + 공매도·대차 물량 증가가 겹쳐 실제 하락 압력으로 확인돼 등급을 위험으로 올렸습니다.';
    }
    return base;
  }

  // 연기금 해석(긍정/중립/부정 판정 + 근거 문구) - 예전엔 백엔드가 "N일 연속"만 반복하는
  // 문구를 내려줬는데, 실제 순매수 금액이 없어 "왜 이 판정인지" 근거가 빈약하다는 피드백
  // (2026-07-19)으로 shortInterpText와 같은 패턴(원자료만 서버가 주고 문구는 여기서 조립,
  // fmtSignedWon으로 실제 금액을 근거에 넣음)으로 프론트로 이관.
  function pensionInterpText(p) {
    if (!p) return { tone: 'neutral', label: '-', text: '연기금 데이터가 없는 종목입니다.' };
    var streak = p.streak || { days: 0, direction: 'flat' };
    var amt5 = fmtSignedWon(p.net_5d) + '원';
    if (streak.direction === 'buy' && streak.days >= 5) {
      return {
        tone: 'very_positive', label: '매우 긍정',
        text: '연기금이 ' + streak.days + '일 연속 순매수 중이며 최근 5일간 ' + amt5 + '을 사들였습니다. '
          + '연기금은 장기·안정 지향 자금이라 방향성이 오래 유지될수록 신뢰도가 높은 신호로 봅니다.'
      };
    }
    if (streak.direction === 'buy') {
      return {
        tone: 'neutral_positive', label: '중립~긍정',
        text: '연기금이 ' + streak.days + '일째 순매수 중입니다(최근 5일 ' + amt5 + '). 연속성이 아직 짧아 방향 전환 여부는 더 지켜봐야 합니다.'
      };
    }
    if (streak.direction === 'sell' && streak.days >= 5) {
      return {
        tone: 'caution', label: '비중 축소 가능성',
        text: '연기금이 ' + streak.days + '일 연속 순매도 중이며 최근 5일간 ' + amt5 + '을 팔았습니다. 장기 자금이 지속적으로 비중을 줄이고 있다는 신호로 해석될 수 있습니다.'
      };
    }
    if (streak.direction === 'sell') {
      return {
        tone: 'neutral', label: '중립',
        text: '연기금이 ' + streak.days + '일째 순매도 중이나(최근 5일 ' + amt5 + ') 연속성은 아직 짧습니다.'
      };
    }
    return {
      tone: 'neutral', label: '중립',
      text: '최근 연기금 매매 방향성이 뚜렷하지 않습니다(최근 20일 순매매 ' + fmtSignedWon(p.net_20d) + '원).'
    };
  }

  // 종합점수 = 수급x0.37 + 외국인/기관x0.23 + 기술적x0.17 + 공매도x0.08 + 연기금x0.04
  // + 반대매매x0.03 + 펀더멘탈x0.08 (2026-07-19: 반대매매·펀더멘탈 신규 추가, 기존 5개는
  // 비례 축소 - scripts/cloud-vm/invest_signal.py와 동일 가중치, "오늘의 투자시그널"
  // 페이지 점수와 항상 일치해야 해서 두 곳을 항상 같이 고칠 것).
  // 데이터 없는 항목은 평균 대신 중립(50)으로 채워서 - 있는 항목만으로 재계산해
  // 가중치 배분이 흔들리는 것보다 "이 종목은 정보가 부족해 중립"이 더 예측 가능하다.
  var SCORE_WEIGHTS = {
    flow: 0.37, foreignInst: 0.23, tech: 0.17, short: 0.08, pension: 0.04,
    credit: 0.03, fundamental: 0.08
  };

  function scoreToStars(score) {
    if (score == null) return null;
    return Math.max(0, Math.min(5, Math.round(score / 20 * 2) / 2));
  }

  // 지시서 추천 기준표: 4.5~5.0 적극매수 / 3.8~4.4 매수우위 / 2.8~3.7 보유 / 1.8~2.7 비중축소 / 0~1.7 매도
  function starRecommendation(stars) {
    if (stars == null) return { label: '판단 보류', cls: 'ff-flat' };
    if (stars >= 4.5) return { label: '적극 매수', cls: 'ff-buy' };
    if (stars >= 3.8) return { label: '매수 우위', cls: 'ff-buy' };
    if (stars >= 2.8) return { label: '보유', cls: 'ff-flat' };
    if (stars >= 1.8) return { label: '비중축소', cls: 'ff-sell' };
    return { label: '매도', cls: 'ff-sell' };
  }

  // ★ 5개를 겹쳐서 (점수/5*100)%만큼만 금색으로 잘라 보여주는 방식 - 0.5단위 부분 채움 표현.
  function starsHtml(stars, extraCls) {
    if (stars == null) return '<span class="ff-stars' + (extraCls ? ' ' + extraCls : '') + '">-</span>';
    var pct = (stars / 5 * 100).toFixed(1);
    return '<span class="ff-stars' + (extraCls ? ' ' + extraCls : '') + '" style="--ff-star-pct:' + pct + '%">★★★★★</span>';
  }

  // 외국인·기관 수급 카드의 연속매매(streak) 방향·일수를 0~100 점수로 환산한다.
  // "오늘의 수급"(flowScore)은 5·20일 롤링 합산 부호 기반의 단기 신호이고, 이건
  // "최근 며칠째 같은 방향이 이어지는가"라는 지속성 신호라 서로 다른 항목으로 취급한다.
  function computeForeignInstScore(data) {
    var streak = data.streak || {};
    function dirScore(st) {
      if (!st || st.direction === 'flat') return 0;
      var days = Math.min(st.days || 0, 10);
      return (st.direction === 'buy' ? 1 : -1) * (10 + days * 3);
    }
    var score = 50 + (dirScore(streak.foreign) + dirScore(streak.inst)) / 2;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function foreignInstDescText(data) {
    var streak = data.streak || {};
    function seg(label, st) {
      st = st || { days: 0, direction: 'flat' };
      if (st.direction === 'flat') return label + ' 방향 뚜렷하지 않음';
      return label + ' ' + st.days + '일 연속 ' + (st.direction === 'buy' ? '순매수' : '순매도');
    }
    return seg('외국인', streak.foreign) + ' · ' + seg('기관', streak.inst);
  }

  // 가중치 기반 종합점수 -> 별점(0~5, 0.5단위) -> 추천 라벨. 100점 평균 대신 가중합을
  // 쓰는 이유: 단순 평균은 항목 5개가 다 비슷한 무게로 섞여 변별력이 떨어진다(지시서 피드백).
  // 지시서 예시(수급75·외국인기관85·기술적30·공매도49·연기금22 -> 63.25점) 그대로 검증됨:
  // 화면에 표시되는 점수를 방향 보정 없이 그대로 가중합한다(공매도 점수도 raw 값을 그대로 사용).
  function computeVerdict(flowScore, foreignInstScore, techScoreObj, shortScore, pensionScore, creditScore, fundamentalScore) {
    var techVal = techScoreObj && techScoreObj.score != null ? techScoreObj.score : null;
    var vals = {
      flow: flowScore != null ? flowScore : 50,
      foreignInst: foreignInstScore != null ? foreignInstScore : 50,
      tech: techVal != null ? techVal : 50,
      short: shortScore != null ? shortScore : 50,
      pension: pensionScore != null ? pensionScore : 50,
      credit: creditScore != null ? creditScore : 50,
      fundamental: fundamentalScore != null ? fundamentalScore : 50
    };
    var composite = vals.flow * SCORE_WEIGHTS.flow
      + vals.foreignInst * SCORE_WEIGHTS.foreignInst
      + vals.tech * SCORE_WEIGHTS.tech
      + vals.short * SCORE_WEIGHTS.short
      + vals.pension * SCORE_WEIGHTS.pension
      + vals.credit * SCORE_WEIGHTS.credit
      + vals.fundamental * SCORE_WEIGHTS.fundamental;
    var stars = scoreToStars(composite);
    var rec = starRecommendation(stars);
    return { score: composite, stars: stars, label: rec.label, cls: rec.cls };
  }

  function fundamentalInterpText(fundamentals) {
    var annual = fundamentals && fundamentals.fundamentals && fundamentals.fundamentals.annual;
    if (!annual) return '재무 데이터가 없는 종목입니다(공시 미제출 또는 아직 배치 스캔 전).';
    var parts = [];
    if (annual.latest_roe_pct != null) parts.push('ROE ' + fmtPct(annual.latest_roe_pct));
    if (annual.latest_debt_ratio_pct != null) parts.push('부채비율 ' + fmtPct(annual.latest_debt_ratio_pct));
    return parts.length ? parts.join(' · ') + ' 기준입니다.' : '재무 데이터가 불완전합니다.';
  }

  // 2주 스윙 판정은 별점·합산점수와 분리한다. 배치의 swing_model.py와 같은
  // 국면 순서(상승/변곡/보류/하방)를 브라우저에서도 재현해 온디맨드 분석과
  // 전종목 배치가 같은 행동 문장을 보여주도록 한다. 224일선은 표시·장기
  // 참고값으로만 남기고 4주 행동을 직접 뒤집지 않는다.
  function swingChartRegime(daily) {
    daily = (daily || []).filter(function (row) { return finiteNumber(row.close) != null; });
    var closes = daily.map(function (row) { return Number(row.close); });
    function ma(period, end) {
      if (end + 1 < period) return null;
      var sum = 0;
      for (var i = end - period + 1; i <= end; i++) sum += Number(daily[i].close);
      return sum / period;
    }
    function slope(period, lookback) {
      var now = ma(period, daily.length - 1), before = ma(period, daily.length - 1 - lookback);
      return now == null || before == null || !before ? 0 : (now - before) / Math.abs(before);
    }
    function slopeAt(period, lookback, end) {
      var now = ma(period, end), before = ma(period, end - lookback);
      return now == null || before == null || !before ? 0 : (now - before) / Math.abs(before);
    }
    function crossedAbove(period) {
      var previousMa = ma(period, daily.length - 2), currentMa = ma(period, daily.length - 1);
      return previousMa != null && currentMa != null
        && closes[closes.length - 2] < previousMa && closes[closes.length - 1] >= currentMa;
    }
    var ma5 = ma(5, daily.length - 1), ma20 = ma(20, daily.length - 1), ma60 = ma(60, daily.length - 1);
    var ma224 = ma(224, daily.length - 1), current = Number(daily[daily.length - 1].close);
    if (daily.length < 60 || ma20 == null || ma60 == null) {
      return { key: 'neutral', label: '횡보·판단 보류', confidence: 'low', turningPoint: 'unknown',
        reasons: ['5·20·60일선 계산에 필요한 일봉이 부족합니다.'], invalidation: '일봉 데이터 60개 이상 확보 후 재판정',
        ma: { ma5: ma5, ma20: ma20, ma60: ma60, ma224: ma224 },
        currentRegime: { key: 'neutral', label: '횡보·수렴' },
        recentEvent: { key: 'none', label: '이벤트 없음', stage: 'none' }, auxiliaryStates: [] };
    }
    var s20 = slope(20, 5), s60 = slope(60, 10), s5 = slope(5, 3);
    var prev = daily.slice(Math.max(0, daily.length - 15), Math.max(0, daily.length - 5)).map(function (r) { return Number(r.close); });
    var recent = daily.slice(Math.max(0, daily.length - 5)).map(function (r) { return Number(r.close); });
    var prevLow = Math.min.apply(Math, prev), prevHigh = Math.max.apply(Math, prev);
    var recentLow = Math.min.apply(Math, recent), recentHigh = Math.max.apply(Math, recent);
    var oldLow = Math.min.apply(Math, daily.slice(-12, -5).map(function (r) { return Number(r.close); }));
    var oldHigh = Math.max.apply(Math, daily.slice(-12, -5).map(function (r) { return Number(r.close); }));
    var higherLow = recentLow > oldLow * 1.005, lowerHigh = recentHigh < oldHigh * 0.995;
    var rebound = current / prevLow - 1, retreat = current / prevHigh - 1;
    var upSignals = [rebound >= 0.03, s5 > 0.002, higherLow, current >= ma20];
    var downSignals = [retreat <= -0.03, s5 < -0.002, lowerHigh, current <= ma20];
    var upCount = upSignals.filter(Boolean).length, downCount = downSignals.filter(Boolean).length;
    var upTrend = ma5 != null && ma5 >= ma20 && ma20 >= ma60 && current >= ma20 && s20 >= 0.002 && s60 >= -0.001;
    var downTrend = ma5 != null && ma5 <= ma20 && ma20 <= ma60 && current <= ma20 && s20 <= -0.002 && s60 <= 0.001;
    var key, turningPoint, confidence;
    if (upTrend) { key = 'uptrend'; turningPoint = 'confirmed'; confidence = 'high'; }
    else if (downTrend) { key = 'downtrend'; turningPoint = 'confirmed'; confidence = 'high'; }
    else if (upCount >= 2 && downCount < 2) { key = 'upturn'; turningPoint = upCount >= 3 && current >= ma20 ? 'confirmed' : 'detected'; confidence = turningPoint === 'confirmed' ? 'medium' : 'low'; }
    else if (downCount >= 2 && upCount < 2) { key = 'downturn'; turningPoint = downCount >= 3 && current <= ma20 ? 'confirmed' : 'detected'; confidence = turningPoint === 'confirmed' ? 'medium' : 'low'; }
    else { key = 'neutral'; turningPoint = 'none'; confidence = 'low'; }
    var currentKey = key === 'uptrend' ? 'uptrend' : key === 'downtrend' ? 'downtrend' : 'neutral';
    var currentRegime = { key: currentKey, label: currentKey === 'uptrend' ? '상승 추세' : currentKey === 'downtrend' ? '하락 추세' : '횡보·수렴' };
    var eventLabels = { none: '이벤트 없음', upturn_detected: '상방 변곡 감지', upturn_confirmed: '상방 변곡 확정', uptrend_resume: '상승 추세 재개', downturn_detected: '하방 변곡 감지', downturn_confirmed: '하방 변곡 확정', downtrend_resume: '하락 추세 재개', breakout: '상단 돌파', breakdown: '하단 이탈', compression: '수렴·압축', overheated: '과열·소진', fake_breakout: '페이크 돌파', fake_breakdown: '페이크 이탈', exhaustion: '하락 소진 감지' };
    function event(key, stage) { return { key: key, label: eventLabels[key], stage: stage || 'none' }; }
    var recentEvent = event('none');
    if (closes.length >= 24) {
      var reference = closes.slice(-23, -3), refHigh = Math.max.apply(Math, reference), refLow = Math.min.apply(Math, reference);
      if (closes[closes.length - 3] > refHigh * 1.01 && current <= refHigh * 1.01) recentEvent = event('fake_breakout', 'confirmed');
      else if (closes[closes.length - 3] < refLow * .99 && current >= refLow * .99) recentEvent = event('fake_breakdown', 'confirmed');
    }
    if (recentEvent.key === 'none' && closes.length >= 22) {
      var prior = closes.slice(-21, -1), rangeHigh = Math.max.apply(Math, prior), rangeLow = Math.min.apply(Math, prior), previous = closes[closes.length - 2];
      if (current > rangeHigh * 1.01 && previous <= rangeHigh * 1.01) recentEvent = event('breakout', 'confirmed');
      else if (current < rangeLow * .99 && previous >= rangeLow * .99) recentEvent = event('breakdown', 'confirmed');
    }
    if (recentEvent.key === 'none' && key === 'upturn') recentEvent = event(turningPoint === 'confirmed' ? 'upturn_confirmed' : 'upturn_detected', turningPoint);
    else if (recentEvent.key === 'none' && key === 'downturn') recentEvent = event(turningPoint === 'confirmed' ? 'downturn_confirmed' : 'downturn_detected', turningPoint);
    else if (recentEvent.key === 'none' && currentKey === 'uptrend' && closes.slice(-10, -1).some(function (value) { return value < ma20; }) && current >= ma20 && s5 > 0) recentEvent = event('uptrend_resume', 'confirmed');
    else if (recentEvent.key === 'none' && currentKey === 'downtrend') recentEvent = event('downtrend_resume', 'confirmed');
    var auxiliaryStates = [];
    if (currentKey === 'uptrend' && ((current / ma20 - 1 >= .08) || (closes.length >= 21 && closes[closes.length - 1] / closes[closes.length - 21] - 1 >= .15))) auxiliaryStates.push(event('overheated', 'confirmed'));
    var exhaustionStart = closes.length >= 21 ? closes[closes.length - 21] : closes[closes.length - 11];
    var exhaustionEnd = closes.length >= 21 ? closes[closes.length - 11] : closes[closes.length - 1];
    if (currentKey === 'downtrend' && closes.length >= 11 && exhaustionEnd / exhaustionStart - 1 <= -.08 && closes[closes.length - 1] / closes[closes.length - 6] - 1 >= -.03) auxiliaryStates.push(event('exhaustion', 'detected'));
    if (recentEvent.key.indexOf('fake_') === 0) auxiliaryStates = [];
    auxiliaryStates = auxiliaryStates.slice(0, 2);
    var labels = { uptrend: '상승 지속', upturn: '상방 변곡', neutral: '횡보·판단 보류', downturn: '하방 변곡', downtrend: '하락 지속' };
    var invalidation = { uptrend: '20일선 이탈 후 회복 실패', upturn: '반등 저점 이탈 또는 20일선 회복 실패', neutral: '20일선 위 안착 또는 하향 이탈로 국면 재판정', downturn: '최근 반등 고점 돌파 및 20일선 회복', downtrend: '20일선 회복 후 안착' };
    return { key: key, label: labels[key], confidence: confidence, turningPoint: turningPoint,
      reasons: ['5·20·60일선 ' + Math.round(ma5) + ' / ' + Math.round(ma20) + ' / ' + Math.round(ma60), '20일선 5거래일 변화 ' + (s20 * 100).toFixed(2) + '%'].concat(higherLow ? ['최근 저점이 이전 저점보다 높음'] : []).concat(ma224 != null ? ['224일선은 장기 추세 참고값으로만 사용'] : []),
      invalidation: invalidation[key], ma: { ma5: ma5, ma20: ma20, ma60: ma60, ma224: ma224 }, signals: { up: upCount, down: downCount },
      currentRegime: currentRegime, recentEvent: recentEvent, mainEvent: recentEvent, auxiliaryStates: auxiliaryStates };
  }

  function swingWaveStructure(daily, chart) {
    daily = (daily || []).filter(function (row) { return finiteNumber(row.close) != null; });
    var closes = daily.map(function (row) { return Number(row.close); });
    function ma(period, end) {
      if (end + 1 < period) return null;
      var total = 0;
      for (var i = end - period + 1; i <= end; i++) total += closes[i];
      return total / period;
    }
    function slope(period, lookback) {
      var now = ma(period, closes.length - 1), before = ma(period, closes.length - 1 - lookback);
      return now == null || before == null || !before ? 0 : (now - before) / Math.abs(before);
    }
    // 2026-08-20: swingChartRegime()의 같은 이름 헬퍼들은 그 함수 스코프에만 있어 여기선 안
    // 보이는데(별개 함수), 아래 shortSignal/ma20Slope 판정이 이 함수 이름들을 그대로
    // 참조하고 있었다 - "crossedAbove is not defined"에 이어 "slopeAt is not defined"까지
    // 같은 패턴의 ReferenceError로 종목분석 수급 조회가 계속 실패했다(사용자 리포트 2건).
    // swingChartRegime과 같은 로직을 이 함수 자신의 ma/closes로 재정의한다. 이 두 함수가
    // swingChartRegime의 지역 헬퍼를 참조하는 나머지 자리(event/ma/slope 등)는 이미 각자
    // 지역 정의가 있어 문제없음을 확인했다(2708~2709줄 부근 전체 재검토).
    function crossedAbove(period) {
      var previousMa = ma(period, closes.length - 2), currentMa = ma(period, closes.length - 1);
      return previousMa != null && currentMa != null
        && closes[closes.length - 2] < previousMa && closes[closes.length - 1] >= currentMa;
    }
    function slopeAt(period, lookback, end) {
      var now = ma(period, end), before = ma(period, end - lookback);
      return now == null || before == null || !before ? 0 : (now - before) / Math.abs(before);
    }
    function key(fastPeriod, slowPeriod, longPeriod) {
      if (closes.length < Math.max(slowPeriod, longPeriod || 0)) return 'insufficient';
      var fast = ma(fastPeriod, closes.length - 1), slow = ma(slowPeriod, closes.length - 1), long = longPeriod ? ma(longPeriod, closes.length - 1) : null;
      var fastSlope = slope(fastPeriod, fastPeriod <= 20 ? 5 : 10), slowSlope = slope(slowPeriod, slowPeriod <= 60 ? 10 : 20), current = closes[closes.length - 1];
      if (longPeriod) {
        if (current >= slow && fast >= slow && slow >= long && slowSlope >= -.002) return 'uptrend';
        if (current <= slow && fast <= slow && slow <= long && slowSlope <= .002) return 'downtrend';
        return 'neutral';
      }
      if (fastPeriod === 20 && slowPeriod === 60) {
        if (fast >= slow && slowSlope >= -.005) return 'uptrend';
        if (fast <= slow && slowSlope <= .005) return 'downtrend';
        return 'neutral';
      }
      if (fast >= slow && fastSlope >= .001 && slowSlope >= -.003) return 'uptrend';
      if (fast <= slow && fastSlope <= -.001 && slowSlope <= .003) return 'downtrend';
      return 'neutral';
    }
    var labels = { uptrend: '상승 추세', downtrend: '하락 추세', neutral: '횡보·수렴', insufficient: '데이터 부족' };
    function wave(layer, waveKey, minimum, basis) {
      return { layer: layer, key: waveKey, label: waveKey === 'insufficient' && layer === 'big' ? '장기 데이터 부족' : labels[waveKey], available: waveKey !== 'insufficient', sampleDays: closes.length, minRequired: minimum, basis: basis };
    }
    var bigKey = key(60, 120, 224), midKey = key(20, 60), smallKey = key(5, 20);
    var big = wave('big', bigKey, 224, '60·120·224일선과 장기 고점·저점');
    var mid = wave('mid', midKey, 60, '20·60일선과 4~12주 흐름');
    var small = wave('small', smallKey, 20, '5·20일선과 최근 1~4주 흐름');
    var eventLabels = { none: '이벤트 없음', upturn_detected: '상방 변곡 감지', upturn_confirmed: '상방 변곡 확정', uptrend_resume: '상승 추세 재개', downturn_detected: '하방 변곡 감지', downturn_confirmed: '하방 변곡 확정', downtrend_resume: '하락 추세 재개', breakout: '상단 돌파', breakdown: '하단 이탈', fake_breakout: '페이크 돌파', fake_breakdown: '페이크 이탈', ma5_recovery: '5일선 회복', ma20_breakout: '20일선 돌파' };
    function layerEvent(layer, item) {
      item = item || { key: 'none', label: '이벤트 없음', stage: 'none' };
      return { layer: layer, key: item.key || 'none', label: '[' + (layer === 'big' ? '장기' : layer === 'mid' ? '중기' : '단기') + '] ' + (item.label || eventLabels[item.key] || '이벤트 없음'), stage: item.stage || 'none' };
    }
    function priorKey(values, fastPeriod, slowPeriod, longPeriod) {
      if (values.length < Math.max(slowPeriod, longPeriod || 0)) return 'insufficient';
      var saved = closes; closes = values; var result = key(fastPeriod, slowPeriod, longPeriod); closes = saved; return result;
    }
    var midEvent = { key: 'none', label: '이벤트 없음', stage: 'none' };
    if (midKey !== 'insufficient' && closes.length >= 65 && priorKey(closes.slice(0, -5), 20, 60) !== midKey) midEvent = { key: midKey === 'uptrend' ? 'uptrend_resume' : 'downturn_confirmed', label: eventLabels[midKey === 'uptrend' ? 'uptrend_resume' : 'downturn_confirmed'], stage: 'confirmed' };
    var shortSignal = { key: 'none', label: '이벤트 없음', stage: 'none' };
    if (closes.length >= 6) {
      var previousMa5 = ma(5, closes.length - 2), currentMa5 = ma(5, closes.length - 1);
      if (previousMa5 != null && currentMa5 != null && closes[closes.length - 2] < previousMa5 && closes[closes.length - 1] >= currentMa5) shortSignal = { key: 'ma5_recovery', label: eventLabels.ma5_recovery, stage: 'confirmed' };
    }
    if (shortSignal.key === 'none' && crossedAbove(20)) shortSignal = { key: 'ma20_breakout', label: eventLabels.ma20_breakout, stage: 'confirmed' };
    var shortTransition = (shortSignal.key === 'ma5_recovery' || shortSignal.key === 'ma20_breakout') && slope(5, 3) > 0;
    var ma20Slope = slope(20, 5), priorMa20Slope = slopeAt(20, 5, closes.length - 6);
    var ma60Slope = slope(60, 10), priorMa60Slope = slopeAt(60, 10, closes.length - 11);
    var currentMa20 = ma(20, closes.length - 1), currentMa224 = ma(224, closes.length - 1);
    var midTransition = currentMa20 != null && closes[closes.length - 1] >= currentMa20
      && (ma20Slope >= 0 || ma20Slope > priorMa20Slope)
      && (ma60Slope >= 0 || ma60Slope > priorMa60Slope);
    var longTransition = currentMa224 != null && closes[closes.length - 1] >= currentMa224 && bigKey === 'uptrend';
    var transitions = {
      short: { active: shortTransition, label: shortTransition ? '단기 전환 후보' : '단기 전환 없음', basis: '5일선 회복 또는 20일선 돌파 AND 5일선 상승' },
      mid: { active: midTransition, label: midTransition ? '중기 전환 후보' : '중기 전환 없음', basis: '종가 20일선 위 AND 20일선 방향 개선 AND 60일선 하락 둔화 또는 상승' },
      long: { active: longTransition, label: longTransition ? '장기 추세 확정' : '장기 정배열 미확인', basis: '60일선·120일선·224일선 정배열 AND 종가 224일선 위' }
    };
    var smallEvent = chart.recentEvent || { key: 'none', label: '이벤트 없음', stage: 'none' };
    if (smallEvent.key === 'none' && smallKey !== 'insufficient' && closes.length >= 25 && priorKey(closes.slice(0, -3), 5, 20) !== smallKey) smallEvent = { key: smallKey === 'uptrend' ? 'uptrend_resume' : 'downturn_confirmed', label: eventLabels[smallKey === 'uptrend' ? 'uptrend_resume' : 'downturn_confirmed'], stage: 'confirmed' };
    var events = [];
    if (midEvent.key !== 'none') events.push(layerEvent('mid', midEvent));
    if (smallEvent.key !== 'none') events.push(layerEvent('small', smallEvent));
    var diagnosis, actionKey;
    var smallUpturn = smallEvent.key === 'upturn_detected' || smallEvent.key === 'upturn_confirmed';
    if (bigKey === 'insufficient') { diagnosis = '장기 데이터 부족'; actionKey = 'insufficient'; }
    else if (bigKey === 'uptrend' && midKey === 'uptrend' && smallKey === 'uptrend' && smallUpturn) { diagnosis = '상승 추세 내 단기 상방 변곡 · 확인 대기'; actionKey = 'observe'; }
    else if (bigKey === 'uptrend' && midKey === 'uptrend' && smallKey === 'uptrend') { diagnosis = '장기·중기·단기 추세 정렬'; actionKey = 'pullback_candidate'; }
    else if (bigKey === 'uptrend' && midKey === 'uptrend' && smallKey === 'downtrend') { diagnosis = '상승 추세 내 정상 조정'; actionKey = 'observe'; }
    else if (bigKey === 'uptrend' && midKey === 'downtrend' && smallKey === 'uptrend') { diagnosis = '중기 조정 중 반등 · 중기 확인 대기'; actionKey = 'wait_mid_confirmation'; }
    else if (shortTransition) { diagnosis = '단기 전환 후보 · 중기 확인 대기'; actionKey = 'short_transition_candidate'; }
    else if (midTransition) { diagnosis = '중기 전환 후보 · 장기 확인 대기'; actionKey = 'mid_transition_candidate'; }
    else if (bigKey === 'downtrend' && midKey === 'downtrend' && smallKey === 'uptrend') { diagnosis = '하락 추세 안의 기술적 반등'; actionKey = 'prohibited_rebound'; }
    else if (bigKey === 'downtrend' && midKey === 'uptrend' && smallKey === 'uptrend') { diagnosis = '역추세 반등 · 고위험 관찰'; actionKey = 'high_risk_observe'; }
    else if (bigKey === 'neutral' && midKey === 'neutral' && smallKey === 'uptrend') { diagnosis = '돌파 확인 대기'; actionKey = 'wait_breakout'; }
    else if (bigKey === 'neutral' && midKey === 'neutral' && smallKey === 'downtrend') { diagnosis = '하단 이탈 · 신규 진입 금지'; actionKey = 'prohibited_breakdown'; }
    else if (midKey === 'downtrend') { diagnosis = '중기 하락 · 신규 진입 금지'; actionKey = 'prohibited'; }
    else if (midKey === 'neutral') { diagnosis = '중기 방향 확인 대기'; actionKey = 'observe'; }
    else { diagnosis = '추세 방향 확인 대기'; actionKey = 'observe'; }
    small.event = layerEvent('small', smallEvent); mid.event = layerEvent('mid', midEvent);
    return { big: big, mid: mid, small: small, shortSignal: shortSignal, transitions: transitions, diagnosis: diagnosis, actionKey: actionKey, recentEvents: events.slice(-6) };
  }

  function buildSwingAssessment(data, entry, chartData, fundamentalScore) {
    var daily = chartData && chartData.daily ? chartData.daily : [];
    var chart = swingChartRegime(daily);
    var waves = swingWaveStructure(daily, chart);
    var flowScore = computeFlowScore(data), foreignInstScore = computeForeignInstScore(data);
    var momentumScore = (flowScore + foreignInstScore) / 2;
    var momentum = momentumScore >= 65 ? '강화' : momentumScore < 40 ? '약화' : '중립';
    var fundamental = fundamentalScore == null ? '데이터 부족' : fundamentalScore >= 65 ? '지지' : fundamentalScore < 40 ? '부담' : '중립';
    var shortP = entry && entry.short && entry.short.pressure;
    var credit = entry && entry.credit && entry.credit.signal;
    var flags = [];
    if (shortP && shortP.danger_gate && shortP.danger_gate.triggered) flags.push('공매도 과열·가격하락·대차증가 동시 확인');
    else if (shortP && shortP.score != null && shortP.score < 35) flags.push('공매도 압박 높음');
    if (credit && credit.flag) flags.push(credit.label || '신용·반대매매 주의');
    var risk = flags.length > 1 || (shortP && shortP.danger_gate && shortP.danger_gate.triggered) ? '경고' : flags.length ? '주의' : '없음';
    var blocks = risk !== '없음';
    var holder, entryOpinion, base, eventKey = chart.recentEvent && chart.recentEvent.key, auxKeys = (chart.auxiliaryStates || []).map(function (item) { return item.key; });
    if (eventKey === 'fake_breakout' || eventKey === 'fake_breakdown') { holder = '보유 / 신호 취소 후 관찰'; entryOpinion = '관찰'; base = 35; }
    else if (waves.actionKey === 'insufficient') { holder = '보유 / 장기 데이터 부족 관찰'; entryOpinion = '장기 데이터 부족 · 관찰'; base = 25; }
    else if (waves.actionKey === 'pullback_candidate') { holder = '보유 / 추가매수 검토'; entryOpinion = blocks ? '신규 진입 금지' : '눌림목 매수 후보'; base = 100; }
    else if (waves.actionKey === 'short_transition_candidate') { holder = '보유 / 단기 전환 확인'; entryOpinion = '단기 전환 후보'; base = 72; }
    else if (waves.actionKey === 'mid_transition_candidate') { holder = '보유 / 중기 전환 확인'; entryOpinion = '중기 전환 후보'; base = 82; }
    else if (waves.actionKey === 'wait_mid_confirmation') { holder = '보유 / 중기 조정 확인'; entryOpinion = '중기 확인 대기'; base = 58; }
    else if (waves.actionKey === 'prohibited_rebound') { holder = '보유 / 반등 구간 위험 관리'; entryOpinion = '신규 진입 금지'; base = 20; }
    else if (waves.actionKey === 'high_risk_observe') { holder = '보유 / 역추세 반등 위험 관리'; entryOpinion = '고위험 관찰'; base = 30; }
    else if (waves.actionKey === 'wait_breakout') { holder = '보유 / 돌파 확인'; entryOpinion = '돌파 확인 대기'; base = 45; }
    else if (waves.actionKey === 'prohibited_breakdown' || waves.actionKey === 'prohibited') { holder = '보유 주의 / 하락 위험 관리'; entryOpinion = '신규 진입 금지'; base = 10; }
    else if (waves.actionKey === 'observe') { holder = '보유 / 정상 조정 관찰'; entryOpinion = '관찰'; base = 65; }
    else if (chart.key === 'downturn') { holder = '보유 주의 / 비중축소 검토'; entryOpinion = '신규 진입 금지'; base = 18; }
    else if (auxKeys.indexOf('exhaustion') !== -1) { holder = '보유 주의 / 바닥 확인'; entryOpinion = '바닥 확인 관찰'; base = 12; }
    else { holder = '비중축소 / 매도 검토'; entryOpinion = '후보 제외'; base = 5; }
    if (blocks && ['pullback_candidate', 'short_transition_candidate', 'mid_transition_candidate'].indexOf(waves.actionKey) !== -1 && eventKey !== 'fake_breakout' && eventKey !== 'fake_breakdown') entryOpinion = '신규 진입 금지';
    return { modelVersion: 'swing-4w-v5', chartRegime: chart, currentRegime: chart.currentRegime, recentEvent: chart.recentEvent, shortSignal: waves.shortSignal, transitions: waves.transitions || {}, auxiliaryStates: chart.auxiliaryStates || [], waves: waves, diagnosis: waves.diagnosis, momentum: { state: momentum, score: momentumScore }, fundamental: { state: fundamental, score: fundamentalScore }, risk: { state: risk, flags: flags, blocksEntry: blocks }, holderAction: holder, entryOpinion: entryOpinion, internalPriorityScore: Math.max(0, Math.min(100, base + (momentumScore - 50) * .25)), legacy: {} };
  }

  function buildSwingSummaryBox(data, entry, techScore, fundamentals, chartData) {
    var assessment = buildSwingAssessment(data, entry, chartData, computeFundamentalScore(fundamentals));
    var chart = assessment.chartRegime, risk = assessment.risk;
    var reasons = (chart.reasons || []).join(' · ');
    var currentRegime = assessment.currentRegime || chart.currentRegime || { label: chart.label };
    var recentEvent = assessment.recentEvent || chart.recentEvent || { label: '이벤트 없음' };
    var auxiliary = (assessment.auxiliaryStates || chart.auxiliaryStates || []).map(function (item) { return item.label; }).join(' · ') || '없음';
    var waves = assessment.waves || {};
    var bigWave = waves.big || { label: '장기 데이터 부족' };
    var midWave = waves.mid || { label: '데이터 부족' };
    var smallWave = waves.small || { label: '데이터 부족' };
    var shortSignal = assessment.shortSignal || waves.shortSignal || { label: '없음' };
    var transition = waves.transitions || assessment.transitions || {};
    var transitionLabel = transition.long && transition.long.active ? transition.long.label
      : transition.mid && transition.mid.active ? transition.mid.label
      : transition.short && transition.short.active ? transition.short.label : '전환 신호 없음';
    return '<div class="ff-summary ff-swing-summary">'
      + '<div class="ff-swing-regime"><span class="ff-panel-title">2주 스윙 판정</span><strong>' + escapeHtml(currentRegime.label) + '</strong><small>최근 이벤트 · ' + escapeHtml(recentEvent.label) + '</small></div>'
      + '<div class="ff-swing-flow" aria-label="장기·중기·단기 추세 국면">'
      + '<div class="ff-swing-flow-track">'
      + '<div class="ff-swing-step"><span class="ff-swing-step-label">장기 국면 <em>맥락</em></span><strong>' + escapeHtml(bigWave.label) + '</strong></div>'
      + '<div class="ff-swing-step"><span class="ff-swing-step-label">중기 국면 <em>방향</em></span><strong>' + escapeHtml(midWave.label) + '</strong></div>'
      + '<div class="ff-swing-step"><span class="ff-swing-step-label">단기 국면 <em>진입 시점</em></span><strong>' + escapeHtml(smallWave.label) + '</strong></div>'
      + '</div>'
      + '</div>'
      + '<div class="ff-swing-diagnosis"><span>진단</span><strong>' + escapeHtml(assessment.diagnosis || waves.diagnosis || '-') + '</strong></div>'
      + '<div class="ff-swing-actions">'
      + '<div class="ff-swing-action"><span>보유자 행동</span><strong>' + escapeHtml(assessment.holderAction) + '</strong></div>'
      + '<div class="ff-swing-action"><span>신규 진입</span><strong>' + escapeHtml(assessment.entryOpinion) + '</strong></div>'
      + '</div>'
      + '<div class="ff-swing-facts">'
      + '<span class="ff-swing-fact"><small>5일선 신호</small><b>' + escapeHtml(shortSignal.label || '없음') + '</b></span>'
      + '<span class="ff-swing-fact"><small>전환 단계</small><b>' + escapeHtml(transitionLabel) + '</b></span>'
      + '<span class="ff-swing-fact"><small>보조 상태</small><b>' + escapeHtml(auxiliary) + '</b></span>'
      + '<span class="ff-swing-fact"><small>모멘텀</small><b>' + escapeHtml(assessment.momentum.state) + '</b></span>'
      + '<span class="ff-swing-fact"><small>펀더멘털</small><b>' + escapeHtml(assessment.fundamental.state) + '</b></span>'
      + '<span class="ff-swing-fact"><small>위험</small><b>' + escapeHtml(risk.state) + '</b></span>'
      + '</div>'
      + '<div class="ff-swing-reasons"><b>판정 근거</b> ' + escapeHtml(reasons || '차트 데이터 확인 중') + '</div>'
      + '<div class="ff-swing-invalidation"><b>무효화 조건</b> ' + escapeHtml(chart.invalidation || '-') + '</div>'
      + (risk.flags && risk.flags.length ? '<div class="ff-swing-risk-detail"><b>위험 근거</b> ' + escapeHtml(risk.flags.join(' · ')) + '</div>' : '')
      + '</div>';
  }

  function buildSummaryBox(data, entry, techScore, fundamentals, chartData) {
    return buildSwingSummaryBox(data, entry, techScore, fundamentals, chartData);
    var flowScore = computeFlowScore(data);
    var foreignInstScore = computeForeignInstScore(data);

    var shortP = entry && entry.short && entry.short.pressure;
    var shortScore = shortP ? shortP.score : null;

    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;

    var creditP = entry && entry.credit;
    var creditScore = computeCreditScore(creditP);

    var fundamentalScore = computeFundamentalScore(fundamentals);

    // 2026-07-20(3차) 작업지시서 "종목 카드 점수 복원": 항목별 배지(등급 문자) 대신 7개
    // 컴포넌트 점수를 N점+별점 리스트로 다시 노출한다. 등급 텍스트 배지는 이제 페이지 상단
    // ①시그널 배너(renderSignalBanner)가 맡아서 여기서 중복 표시하지 않는다.
    var shortLabel = shortP ? shortP.grade.label : '-';
    // 2026-07-21: 점수·별점만으로는 "왜 이 점수인지" 알 수 없다는 피드백 - 각 항목마다
    // 이미 있던 해석 문구(flowScoreInterpText 등, AI요약에도 같이 쓰는 근거 텍스트)를
    // 그대로 재사용해 점수 밑에 노출한다(새 문구 만들지 않아 AI요약 근거와 항상 일치).
    var creditText = (creditP && creditP.signal) ? creditP.signal.text : '신용융자 데이터가 없는 종목입니다.';
    var scoreItems = [
      ['단기 수급강도', flowScore, flowScoreInterpText(data)],
      ['외국인·기관', foreignInstScore, foreignInstDescText(data)],
      ['기술적 점수', techScore ? techScore.score : null, techInterpText(techScore)],
      ['공매도 압박', shortScore, shortInterpText(entry && entry.short, entry && entry.loan)],
      ['연기금', pensionScore, pensionInterpText(pension).text],
      ['반대매매', creditScore, creditText],
      ['펀더멘탈', fundamentalScore, fundamentalInterpText(fundamentals)]
    ];
    // 2026-07-20(5차): 점선 리스트 -> 요약 패널(ffSigSummary)과 동일한 카드/그리드 지표셀로 통일.
    // 2026-07-27: "9Pay 증권" 개편 작업지시서 #9 - 값이 없는 항목(공매도·연기금 데이터가
    // 없는 종목 등)을 "-"로 채운 빈 카드로 보여주는 대신 아예 숨긴다("파란색 원형(점수
    // 배지) 값이 NULL이면 해당 UI 요소 숨김 처리").
    function scoreCell(it) {
      var label = it[0], score = it[1], desc = it[2];
      if (score == null) return '';
      return '<div class="ff-metric ff-metric-scored">'
        + '<div class="ff-metric-label">' + label + '</div>'
        + '<div class="ff-metric-val ' + scoreColorCls(score) + '">' + Math.round(score) + '점</div>'
        + '<div class="ff-metric-sub">' + starsHtml(scoreToStars(score)) + '</div>'
        + '<div class="ff-metric-desc">' + escapeHtml(desc || '') + '</div>'
        + '</div>';
    }
    var visibleScoreCells = scoreItems.map(scoreCell).filter(function (html) { return html !== ''; });
    var scoreListHtml = visibleScoreCells.length ? '<div class="ff-panel-section"><div class="ff-panel-title">항목별 점수</div>'
      + '<div class="ff-card"><div class="ff-card-grid4">' + visibleScoreCells.join('') + '</div></div>'
      + '<div class="ff-score-legend">※ 65점 이상 긍정(빨강) · 40~64점 중립(회색) · 40점 미만 주의(파랑) 기준으로 색이 매겨지며, 각 점수 밑 설명이 그 점수가 나온 근거입니다.</div>'
      + '</div>' : '';

    var latest = data.daily && data.daily[0];
    var valuation = fundamentals && fundamentals.valuation;
    function metricCell(label, val, cls) {
      return '<div class="ff-metric"><div class="ff-metric-label">' + label + '</div><div class="ff-metric-val' + (cls ? ' ' + cls : '') + '">' + val + '</div></div>';
    }
    var flowCard = '<div class="ff-card"><div class="ff-card-grid3">'
      + metricCell('외국인', latest ? fmtSharesUnit(latest.foreign_net) : '-', latest ? signClass(latest.foreign_net) : '')
      + metricCell('기관', latest ? fmtSharesUnit(latest.inst_net) : '-', latest ? signClass(latest.inst_net) : '')
      + metricCell('공매도', shortLabel, '')
      + '</div></div>';
    var fundCard = '<div class="ff-card"><div class="ff-card-grid3">'
      + metricCell('PER', valuation && valuation.per != null ? valuation.per.toFixed(1) + 'x' : '-', '')
      + metricCell('PBR', valuation && valuation.pbr != null ? valuation.pbr.toFixed(1) + 'x' : '-', '')
      + metricCell('EPS', valuation ? fmtWon(valuation.eps) : '-', '')
      + '</div></div>';
    // 2026-07-21: 수급/펀더멘탈 각각 풀폭 섹션으로 세로로 쌓으면 항목 6개(3+3)치고 너무
    // 길다는 피드백 - 한 섹션 안에 2칸으로 나란히 배치해 세로 길이를 절반으로 줄인다.
    var gridHtml = '<div class="ff-panel-section ff-panel-section-row">'
      + '<div class="ff-panel-col"><div class="ff-panel-title">수급</div>' + flowCard + '</div>'
      + '<div class="ff-panel-col"><div class="ff-panel-title">펀더멘탈</div>' + fundCard + '</div>'
      + '</div>';

    var verdict = computeVerdict(flowScore, foreignInstScore, techScore, shortScore, pensionScore, creditScore, fundamentalScore);

    // 판정(별점+등급)과 AI 근거 문장이 한 줄에 뭉치면 안 읽혀서(사용자 피드백),
    // 판정 박스는 등급 색으로 칠해 분리하고 AI 요약은 그 아래 별도 줄로 내린다.
    var verdictTone = verdict.cls === 'ff-buy' ? 'buy' : verdict.cls === 'ff-sell' ? 'sell' : 'flat';

    return '<div class="ff-summary">'
      + '<div class="ff-verdict-box ff-verdict-box-' + verdictTone + '">'
      + '<span class="ff-verdict ' + verdict.cls + '">' + verdict.label + '</span>'
      + starsHtml(verdict.stars, 'ff-stars-lg')
      + '<span class="ff-verdict-score">' + (verdict.score == null ? '-' : verdict.score.toFixed(1) + '점 · ' + verdict.stars.toFixed(1) + '/5') + '</span>'
      + '</div>'
      + scoreListHtml
      + gridHtml
      + '<div class="ff-panel-opinion" id="ffAiSummary">'
      + '<div class="ff-panel-title">투자의견</div>'
      + '<div class="ff-panel-opinion-text">생성 중...</div>'
      + '</div>'
      + '</div>';
  }

  // AI 한줄요약은 Groq 호출이라 느릴 수 있어 나머지 렌더링을 막지 않고 비동기로 채운다.
  // 별점 판정(computeVerdict)과 다른 결론을 AI가 스스로 내리는 걸 막기 위해, 여기서도
  // buildSummaryBox와 똑같이 5개 컴포넌트 점수 + verdict를 구해서 GAS에 "이미 이 결론이다"로
  // 넘긴다 - LLM은 근거 문장만 쓰고 매수/매도/보유 자체는 다시 판단하지 않는다.
  function loadAiSummary(box, data, entry, techScore, chartData, fundamentals) {
    var el = box.querySelector('#ffAiSummary .ff-panel-opinion-text');
    if (!el) return;

    var shortP = entry && entry.short && entry.short.pressure;
    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;
    var flowScore = computeFlowScore(data);
    var foreignInstScore = computeForeignInstScore(data);
    var shortScore = shortP ? shortP.score : null;
    var creditP = entry && entry.credit;
    var creditScore = computeCreditScore(creditP);
    var fundamentalScore = computeFundamentalScore(fundamentals);
    var verdict = computeVerdict(flowScore, foreignInstScore, techScore, shortScore, pensionScore, creditScore, fundamentalScore);

    var daily = chartData && chartData.daily;
    var volNote = volumeMultipleText(daily ? computeVolumeMultiple(daily) : null);
    var rsiNote = daily ? rsiInterpText(daily) : 'RSI 데이터가 부족합니다.';

    var qs = '?action=flowAiSummary'
      + '&code=' + encodeURIComponent(data.code)
      + '&name=' + encodeURIComponent(data.name || data.code)
      + '&flowScore=' + flowScore
      + '&flowNote=' + encodeURIComponent(flowScoreInterpText(data))
      + '&foreignInstScore=' + foreignInstScore
      + '&foreignInstNote=' + encodeURIComponent(foreignInstDescText(data))
      + '&shortScore=' + (shortScore == null ? '' : shortScore)
      + '&shortNote=' + encodeURIComponent(shortInterpText(entry && entry.short, entry && entry.loan))
      + '&pensionScore=' + (pensionScore == null ? '' : pensionScore)
      + '&pensionNote=' + encodeURIComponent(pensionInterpText(pension).text)
      + '&techScore=' + (techScore ? techScore.score : '')
      + '&techNote=' + encodeURIComponent(techInterpText(techScore))
      + '&volNote=' + encodeURIComponent(volNote)
      + '&rsiNote=' + encodeURIComponent(rsiNote)
      + '&verdictLabel=' + encodeURIComponent(verdict.label)
      + '&verdictScore=' + (verdict.score == null ? '' : Math.round(verdict.score));
    // creditScore/fundamentalScore는 verdict 계산엔 이미 반영됐지만, GAS flowAiSummary
    // 프롬프트(gas/ticker-proxy.gs)는 아직 이 두 값을 안 읽음 - 근거 문장에 반영하려면
    // GAS 쪽도 별도로 고치고 수동 재배포해야 함(2026-07-19 기준 미착수, 점수 자체는 정확함).

    fetchJson(GAS_TICKER_URL + qs)
      .then(function (res) {
        el.textContent = (res && res.summary) || '요약을 생성하지 못했어요.';
      })
      .catch(function () {
        el.textContent = '요약을 생성하지 못했어요.';
      });
  }

  function buildBadges(data) {
    var streak = data.streak || {};
    var signal = data.signal || {};

    var parts = [
      streakBadge('개인', streak.ind),
      streakBadge('외국인', streak.foreign),
      streakBadge('기관', streak.inst),
      signalBadge('개인', signal.ind),
      signalBadge('외국인', signal.foreign),
      signalBadge('기관', signal.inst)
    ];
    var hasAny = parts.some(function (p) { return !!p; });

    var out = '<div class="ff-badges">' + parts.join('') + '</div>';
    if (hasAny) {
      out += '<div class="ff-badge-legend">'
        + '<div>※ 연속매매: 최신 거래일부터 역순으로 순매매 부호가 이어지는 일수.</div>'
        + '<div>추세전환: 최근 5일이 이전 15일과 반대 방향이고 평소 2배 이상 크기일 때</div>'
        + '<div>(5일 중 3일 이상 같은 방향일 때만 표시되는 참고 지표)</div>'
        + '<div><b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>'
        + '</div>';
    }
    return out;
  }

  function streakBadge(label, st) {
    if (!st || !(st.days > 0) || st.direction === 'flat') return '';
    var isBuy = st.direction === 'buy';
    return '<span class="ff-badge ' + (isBuy ? 'ff-badge-buy' : 'ff-badge-sell') + '">'
      + label + ' ' + st.days + '일 연속 ' + (isBuy ? '순매수' : '순매도') + '</span>';
  }

  function signalBadge(label, sig) {
    if (!sig || !sig.trend_shift) return '';
    var html = '<span class="ff-badge ff-badge-shift">' + label + ' 추세 전환</span>';
    if (sig.note) html += '<span class="ff-signal-note">' + escapeHtml(sig.note) + '</span>';
    return html;
  }

  var ROLLING_TABLE_WINDOWS = [
    ['5d', '5일 합산'], ['10d', '10일 합산'], ['20d', '20일 합산'],
    ['2m', '2개월 합산'], ['3m', '3개월 합산']
  ];

  function buildRollingTable(data) {
    var amt = data.amount_estimate || {};
    var daily = data.daily || [];

    // 2026-07-19(3차): 당일~4일전은 일자별로, 그 이후는 5일/10일/20일/2개월/3개월 합산만
    // 보여주도록 재구성(사용자 피드백 - 최근 며칠은 일자별 상세가, 긴 구간은 합산만
    // 필요하다는 요청). 개인/외국인/기관 열 순서는 기존 그대로(2026-07-18 재배치 유지).
    var rows = [];
    for (var i = 0; i < Math.min(5, daily.length); i++) {
      var d = daily[i];
      rows.push([
        i === 0 ? '당일' : d.date.slice(5).replace('-', '/'),
        { ind: d.ind_net, foreign: d.foreign_net, inst: d.inst_net },
        amountFromShares(d.ind_net, d.close), amountFromShares(d.foreign_net, d.close), amountFromShares(d.inst_net, d.close)
      ]);
    }
    ROLLING_TABLE_WINDOWS.forEach(function (w) {
      var key = w[0], label = w[1];
      var r = data.rolling && data.rolling[key];
      if (!r) return; // 조회 기간이 짧아 데이터가 부족하면(예: 5일치만 불러온 경우) 해당 구간 생략
      rows.push([label, r, amt['ind_' + key + '_krw'], amt[key + '_krw'], amt['inst_' + key + '_krw']]);
    });

    var hasMissingIndividual = rows.some(function (r) { return finiteNumber(r[1].ind) == null; });
    var html = '<table class="ff-table"><thead><tr>'
      + '<th>구분</th><th>개인 순매매(주)</th><th>개인 추정대금</th>'
      + '<th>외국인 순매매(주)</th><th>외국인 추정대금</th>'
      + '<th>기관 순매매(주)</th><th>기관 추정대금</th>'
      + '</tr></thead><tbody>';

    rows.forEach(function (r) {
      html += '<tr><td class="ff-td-label">' + r[0] + '</td>'
        + '<td class="' + signClass(r[1].ind) + '">' + fmtShares(r[1].ind) + '</td>'
        // 개인/기관 추정대금은 GAS 재배포 후부터 내려옴 - 이전 응답(값 없음)은 '-'로 표시
        + '<td class="' + (r[2] == null ? 'ff-flat' : signClass(r[2])) + '">' + (r[2] == null ? '-' : fmtKrw(r[2])) + '</td>'
        + '<td class="' + signClass(r[1].foreign) + '">' + fmtShares(r[1].foreign) + '</td>'
        + '<td class="' + signClass(r[3]) + '">' + fmtKrw(r[3]) + '</td>'
        + '<td class="' + signClass(r[1].inst) + '">' + fmtShares(r[1].inst) + '</td>'
        + '<td class="' + (r[4] == null ? 'ff-flat' : signClass(r[4])) + '">' + (r[4] == null ? '-' : fmtKrw(r[4])) + '</td></tr>';
    });

    html += '</tbody></table>';
    // 개인 열 추가로 7열이 되면서 좁은 화면에서 넘칠 수 있어 가로 스크롤 컨테이너로 감쌈
    // (2026-07-18, 표 자체 레이아웃은 그대로 두고 안전장치만 추가).
    return (hasMissingIndividual
      ? '<div class="ff-hint">개인 순매매 데이터가 원본에 없는 날짜는 `-`로 표시합니다. 외국인·기관 합계만 제공되는 폴백 응답을 개인 수급으로 추정하지 않습니다.</div>'
      : '') + '<div class="ff-table-scroll">' + html + '</div>';
  }

  // 수급 표/차트 기간 선택 - rolling(5/10/20일 합산)·streak·signal·배지는 daily[0..N]만
  // 보고 항상 "가장 최근" 기준으로 계산되므로(foreign_flow_compute.py) 이 선택은 순매매량
  // 차트·보유율 차트에 보여줄 과거 일수만 바꾸고 위 표/배지 값은 그대로다 - 그래서
  // 기간을 바꿔도 buildRollingTable/buildBadges는 다시 그릴 필요가 없다(#ffFlowChartsWrap만
  // 교체, wireFlowPeriod 참고).
  // 2026-07-19(3차): 1개월/3개월/6개월/1년 -> 5일/10일/20일/2개월/3개월로 축소(사용자
  // 피드백 - 1년까지는 필요 없고, 표의 합산 구간(5/10/20일/2개월/3개월)과 맞춰 같은
  // 기간 어휘를 쓰는 게 일관적). 기본 진입 시 활성 버튼은 63일(3개월, FLOW_DEFAULT_DAYS와 동일).
  var FLOW_PERIOD_OPTIONS = [
    { days: 5, label: '5일' }, { days: 10, label: '10일' }, { days: 20, label: '20일' },
    { days: 42, label: '2개월' }, { days: 63, label: '3개월' }
  ];

  function buildFlowPeriodButtons(activeDays) {
    return '<div class="ff-flow-period" id="ffFlowPeriod">' + FLOW_PERIOD_OPTIONS.map(function (o) {
      return '<button type="button" class="ff-flow-period-btn' + (o.days === activeDays ? ' active' : '')
        + '" data-days="' + o.days + '">' + o.label + '</button>';
    }).join('') + '</div>';
  }

  function buildFlowChartsInner(daily) {
    return '<div class="ff-chart-title">개인·외국인·기관 순매매량 추이 (최근 ' + daily.length + '영업일)</div>'
      + buildNetChart(daily)
      + '<div class="ff-chart-title">외국인 보유율 추이</div>'
      + buildRatioChart(daily);
  }

  function buildFlowChartsWrap(daily) {
    return '<div id="ffFlowChartsWrap">' + buildFlowChartsInner(daily) + '</div>';
  }

  // ---- 수급(연속매매 배지 + 롤링 표 + 순매매량/보유율 추이) - 하나의 구역 카드로 묶음 ----
  function buildFlowCard(data) {
    var tone = flowTone(data);
    var toneBadgeCls = TONE_BADGE_CLASS[tone.tone] || 'ff-badge-neutral';
    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">🧭 개인·외국인·기관 수급</div>'
      + (data.flowUnavailable ? '<div class="ff-data-notice">수급 원자료가 지연되어 가격 차트만 표시합니다. 실제 수급값은 —로 표시됩니다.</div>' : '')
      + buildBadges(data)
      + '<div class="ff-extra-interp ff-extra-tone-' + tone.tone + '">'
      + '<span class="ff-badge ' + toneBadgeCls + '">' + tone.label + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(flowInterpText(data)) + '</span>'
      + '</div>'
      + buildRollingTable(data)
      + buildFlowPeriodButtons(data.daily.length)
      + buildFlowChartsWrap(data.daily)
      + '<div class="ff-footnote">※ 추정대금은 순매매량 × 당일 종가로 계산한 <b>추정치</b>이며 실제 거래대금과 다를 수 있습니다.</div>'
      + '</div>';
  }

  // 기간 버튼 클릭 시 /foreign-flow?days=를 다시 불러 순매매량/보유율 차트만 교체한다
  // (표·배지·판정문구는 어느 기간이든 항상 동일해서 다시 그릴 필요 없음, 위 주석 참고).
  // fetchFlow 캐시가 code+days 조합별로 따로 캐싱하므로 같은 기간 재클릭은 즉시 응답된다.
  // 2026-07-19: 첫 클릭만 반응하고 이후 버튼이 먹통이 되는 버그 발견 - chartsWrap.outerHTML로
  // 통째로 교체하면 그 시점에 잡고 있던 chartsWrap DOM 노드가 문서에서 떨어져나가면서 클로저가
  // 든 chartsWrap 변수는 계속 "죽은" 노드를 가리키게 됨(재조회 안 함). innerHTML만 갈아끼워
  // 컨테이너 노드 자체는 항상 같은 걸 쓰도록 고침 - 이제 몇 번을 눌러도 같은 노드가 살아있다.
  function wireFlowPeriod(box, code, name) {
    var wrap = box.querySelector('#ffFlowPeriod');
    var chartsWrap = box.querySelector('#ffFlowChartsWrap');
    if (!wrap || !chartsWrap) return;
    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.ff-flow-period-btn');
      if (!btn || btn.classList.contains('active')) return;
      var days = Number(btn.getAttribute('data-days'));
      wrap.querySelectorAll('.ff-flow-period-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      chartsWrap.innerHTML = '<div class="ff-loading"><svg class="ff-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><div>불러오는 중...</div></div>';
      ForeignFlow.fetchFlow(code, name, days)
        .then(function (data) {
          if (!data || data.error || !data.daily || !data.daily.length) throw new Error('기간 데이터 없음');
          chartsWrap.innerHTML = buildFlowChartsInner(data.daily);
          wireChartHover(chartsWrap.querySelector('.ff-chart-net'), data.daily, 'net');
          wireChartHover(chartsWrap.querySelector('.ff-chart-ratio'), data.daily, 'ratio');
        })
        .catch(function () {
          chartsWrap.innerHTML = '<div class="ff-error">해당 기간 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
        });
    });
  }

  // ---- 공매도/대차거래/연기금 (GAS ?action=investorFlow 경유 VM 온디맨드) - 수급 탭 ----

  function buildFlowExtraSections(entry, currentClose) {
    if (!entry) {
      return '<div class="ff-extra-missing">공매도·대차거래·연기금 데이터를 일시적으로 가져오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    }

    var html = '<div class="ff-extra">';
    html += buildShortLoanCard(entry.short, entry.loan, currentClose);
    html += buildCreditCard(entry.credit);
    html += buildPensionCard(entry.pension, entry.name);
    html += '<div class="ff-extra-note">공매도 압박 점수는 항상 <b>가능성·추정치</b>이며, 공매도가 주가를 누른다고 단정하지 않습니다. '
      + escapeHtml(entry.as_of) + ' 기준</div>';
    html += '</div>';
    return html;
  }

  // ---- 가격 차트(캔들+MA+지지저항+RSI+볼린저밴드) - 차트 탭 ----

  function buildChartSection(chartData, techScore) {
    return '<div class="ff-extra">' + buildFlowChartCard(chartData, techScore) + '</div>';
  }

  // ---- 과거 시뮬레이션(백테스트 재생) ----
  // "차트" 탭이 이미 불러온 chartData.daily(?action=flowChart, 최대 500거래일·약 2년치
  // 종가)를 그대로 재사용한다 - 별도 API 호출 없음. 투자금을 넣고 "재생"을 누르면 과거일부터
  // 오늘까지 종가 비율(daily[i].close / daily[0].close)로 환산한 평가금액을 애니메이션으로
  // 순서대로 그려준다. 실제 매매수수료·세금·배당(분배락)은 반영하지 않은 단순 종가 계산이다.
  var SIM_H = 220;

  function simGeometry(daily) {
    var n = daily.length;
    var base = daily[0].close;
    var ratios = daily.map(function (d) { return d.close / base; });
    var max = Math.max.apply(null, ratios);
    var min = Math.min.apply(null, ratios);
    var peakIdx = ratios.indexOf(max);
    var troughIdx = ratios.indexOf(min);
    var span = (max - min) || 0.1;
    var domMax = max + span * 0.12;
    // 평가금액은 원금을 다 잃어도 0원 아래로는 안 내려가므로 축 바닥을 0 밑으로 두지 않는다
    // (패딩만 적용하면 음수가 나올 수 있었음 - 축 라벨에 음수 표기가 남던 문제 수정).
    var domMin = Math.max(0, min - span * 0.12);
    var iw = CHART_W - PAD.l - PAD.r;
    var ih = SIM_H - PAD.t - PAD.b;
    function x(i) { return PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * iw); }
    function y(ratio) { return PAD.t + (1 - (ratio - domMin) / (domMax - domMin)) * ih; }
    return { n: n, ratios: ratios, x: x, y: y, domMax: domMax, domMin: domMin, peakIdx: peakIdx, troughIdx: troughIdx };
  }

  // 최고/최저점 마커: 원 안쪽에 "최고"/"최저" 라벨만 짧게 붙인다(2026-08-13 축 라벨
  // 오버플로 사고 직후라, 날짜·금액까지 SVG 안에 욱여넣지 않고 라벨 x좌표를 차트 안쪽으로
  // clamp해서 끝단(최근일 근처)에서도 절대 밖으로 안 나가게 한다). 정확한 날짜·금액은
  // 차트 아래 ff-sim-extremes 텍스트 줄에서 보여준다.
  function simExtremeMark(geo, kind, idx) {
    var cx = geo.x(idx);
    var cy = geo.y(geo.ratios[idx]);
    var labelX = Math.min(CHART_W - PAD.r - 14, Math.max(PAD.l + 14, cx));
    var labelY = kind === 'peak' ? cy - 9 : cy + 15;
    var cls = kind === 'peak' ? 'ff-sim-mark-peak' : 'ff-sim-mark-trough';
    var label = kind === 'peak' ? '최고' : '최저';
    return '<circle class="ff-sim-mark ' + cls + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.5"/>'
      + '<text class="ff-axis ff-sim-mark-label ' + cls + '" x="' + labelX.toFixed(1) + '" y="' + labelY.toFixed(1) + '" text-anchor="middle">' + label + '</text>';
  }

  function buildSimChartSvg(daily) {
    var geo = simGeometry(daily);
    var baseline = geo.y(1);
    var baselineLabelY = baseline + 4;
    var maxLabelY = geo.y(geo.domMax) + 4;
    var minLabelY = geo.y(geo.domMin) + 4;
    // 수익률 폭이 아주 크면(예: +1000%대) 축 상/하단이 원금(비율 1) 쪽으로 눌리면서 "원금"
    // 라벨과 축 최고/최저 금액 라벨의 y좌표가 거의 같아져 두 줄이 겹쳐 보인다(2026-08-13
    // 사용자 스크린샷 제보 - "왜 줄을 바꾸지?"). domMax>=1>=domMin이 항상 성립해
    // maxLabelY<=baselineLabelY<=minLabelY 순서는 유지되므로, 최소 간격만 강제로 벌린다.
    var MIN_LABEL_GAP = 13;
    if (baselineLabelY - maxLabelY < MIN_LABEL_GAP) maxLabelY = baselineLabelY - MIN_LABEL_GAP;
    if (minLabelY - baselineLabelY < MIN_LABEL_GAP) minLabelY = baselineLabelY + MIN_LABEL_GAP;
    var svg = '<svg class="ff-svg" id="ffSimSvg" viewBox="0 0 ' + CHART_W + ' ' + SIM_H + '" role="img" aria-label="과거 시뮬레이션 평가금액 추이">';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + geo.y(geo.domMax).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + geo.y(geo.domMax).toFixed(1) + '"/>';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + geo.y(geo.domMin).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + geo.y(geo.domMin).toFixed(1) + '"/>';
    svg += '<line class="ff-zero" x1="' + PAD.l + '" y1="' + baseline.toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + baseline.toFixed(1) + '"/>';
    svg += '<text class="ff-axis ff-sim-axis-label" id="ffSimAxisMax" x="' + (PAD.l - 6) + '" y="' + maxLabelY.toFixed(1) + '" text-anchor="end"></text>';
    svg += '<text class="ff-axis ff-sim-axis-label" x="' + (PAD.l - 6) + '" y="' + baselineLabelY.toFixed(1) + '" text-anchor="end">원금</text>';
    svg += '<text class="ff-axis ff-sim-axis-label" id="ffSimAxisMin" x="' + (PAD.l - 6) + '" y="' + minLabelY.toFixed(1) + '" text-anchor="end"></text>';
    svg += rsiAxisLabels(daily, geo.x, SIM_H - 8);
    svg += '<polyline class="ff-sim-line" id="ffSimLine" points=""/>';
    svg += simExtremeMark(geo, 'peak', geo.peakIdx);
    svg += simExtremeMark(geo, 'trough', geo.troughIdx);
    svg += '<circle class="ff-sim-dot" id="ffSimDot" r="4" visibility="hidden"/>';
    svg += '</svg>';
    return svg;
  }

  // 차트 안 마커는 "최고"/"최저" 두 글자뿐이라, 정확한 날짜·금액은 이 텍스트 줄로 보여준다.
  function simExtremesText(daily, geo, amount) {
    var peakIdx = geo.peakIdx, troughIdx = geo.troughIdx;
    var peakValue = Math.round(amount * geo.ratios[peakIdx]);
    var troughValue = Math.round(amount * geo.ratios[troughIdx]);
    var peakRate = (geo.ratios[peakIdx] - 1) * 100;
    var troughRate = (geo.ratios[troughIdx] - 1) * 100;
    return '<span class="ff-sim-extreme"><b class="ff-buy">▲ 최고점</b> ' + escapeHtml(daily[peakIdx].date) + ' ' + fmtWon(peakValue) + ' (' + fmtSignedPct(peakRate) + ')</span>'
      + '<span class="ff-sim-extreme"><b class="ff-sell">▼ 최저점</b> ' + escapeHtml(daily[troughIdx].date) + ' ' + fmtWon(troughValue) + ' (' + fmtSignedPct(troughRate) + ')</span>';
  }

  function daysBetweenIso(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }

  function fmtDuration(days) {
    if (days <= 0) return '0일';
    if (days < 30) return days + '일';
    var months = Math.round(days / 30.44);
    if (months < 12) return months + '개월';
    var years = Math.floor(months / 12);
    var remMonths = months - years * 12;
    return years + '년' + (remMonths ? ' ' + remMonths + '개월' : '');
  }

  // "기다림의 시간"(가장 최근 원금 이탈~회복 기간)과 "수익구간"(그 회복 이후 지금까지 유지
  // 기간). 비율·날짜만으로 계산되는 값이라 투자금과 무관 - amount가 바뀌어도 다시 계산할
  // 필요 없다(wireSimulation에서 갱신 안 함). 한 번도 원금 밑으로 안 내려갔으면 기다림 없이
  // 축하 메시지만, 지금도 원금 밑이면(회복 전) 진행 중이라고 표시한다.
  function simPatienceHtml(daily, ratios) {
    var n = ratios.length;
    var lastDipStartIdx = null;
    var lastRecoverIdx = null;
    var below = false;
    for (var i = 1; i < n; i++) {
      if (ratios[i] < 1 && !below) {
        below = true;
        lastDipStartIdx = i;
        lastRecoverIdx = null;
      } else if (ratios[i] >= 1 && below) {
        below = false;
        lastRecoverIdx = i;
      }
    }

    if (lastDipStartIdx == null) {
      return '<div class="ff-sim-patience-item ff-sim-patience-good">🎉 축하축하! 산 이후로 한 번도 원금 밑으로 내려간 적이 없어요 — 기다림 없이 쭉 수익구간이었습니다.</div>';
    }

    if (below) {
      var openDays = daysBetweenIso(daily[lastDipStartIdx].date, daily[n - 1].date);
      return '<div class="ff-sim-patience-item ff-sim-patience-wait">⏳ <b>' + escapeHtml(daily[lastDipStartIdx].date) + '</b>부터 아직 원금 회복 전이에요 <span class="ff-sim-patience-sub">(' + fmtDuration(openDays) + '째 대기 중)</span></div>';
    }

    var waitDays = daysBetweenIso(daily[lastDipStartIdx].date, daily[lastRecoverIdx].date);
    var profitDays = daysBetweenIso(daily[lastRecoverIdx].date, daily[n - 1].date);
    return '<div class="ff-sim-patience-item ff-sim-patience-wait">⏳ 기다림의 시간(원금 회복 기간) <b class="ff-sell">' + fmtDuration(waitDays) + '</b>'
      + ' <span class="ff-sim-patience-sub">(' + escapeHtml(daily[lastDipStartIdx].date) + ' 원금 이탈 → ' + escapeHtml(daily[lastRecoverIdx].date) + ' 회복)</span></div>'
      + '<div class="ff-sim-patience-item ff-sim-patience-profit">📈 수익구간 <b class="ff-buy">' + fmtDuration(profitDays) + '</b>'
      + ' <span class="ff-sim-patience-sub">(' + escapeHtml(daily[lastRecoverIdx].date) + ' ~ ' + escapeHtml(daily[n - 1].date) + ')</span></div>';
  }

  function simResultText(daily, amount) {
    var start = daily[0], end = daily[daily.length - 1];
    var ratio = end.close / start.close;
    var finalValue = Math.round(amount * ratio);
    var rate = (ratio - 1) * 100;
    var cls = signClass(rate);
    return escapeHtml(start.date) + '에 <b>' + fmtWon(amount) + '</b> 투자했다면, ' + escapeHtml(end.date) + ' 기준 <b class="' + cls + '">'
      + fmtWon(finalValue) + '</b>(<span class="' + cls + '">' + fmtSignedPct(rate) + '</span>)이 됩니다.';
  }

  function buildSimulationCard(chartData) {
    var daily = chartData && chartData.daily;
    if (!daily || daily.length < 2) {
      return '<div class="ff-extra-card"><div class="ff-extra-card-title">🎬 과거 시뮬레이션</div>'
        + '<div class="ff-error">시뮬레이션할 차트 데이터가 부족해요.</div></div>';
    }
    var years = (daily.length / 245).toFixed(1); // KRX 연간 거래일수(약 245일) 기준 환산
    var defaultAmount = 1000000;
    var geo = simGeometry(daily);
    return '<div class="ff-extra-card ff-sim-card">'
      + '<div class="ff-extra-card-title">🎬 과거 시뮬레이션</div>'
      + '<p class="ff-sim-desc">최근 ' + daily.length.toLocaleString('ko-KR') + '거래일(약 ' + years + '년, '
      + escapeHtml(daily[0].date) + ' ~ ' + escapeHtml(daily[daily.length - 1].date)
      + ') 종가를 그대로 재생합니다. 투자금을 넣고 재생을 눌러보세요.</p>'
      + '<div class="ff-sim-controls">'
      + '<label class="ff-sim-amount-label">투자금 <input type="number" id="ffSimAmount" min="10000" step="10000" value="' + defaultAmount + '">원</label>'
      + '<button type="button" id="ffSimPlay" class="ff-sim-btn ff-sim-btn-play">▶ 재생</button>'
      + '<button type="button" id="ffSimReset" class="ff-sim-btn ff-sim-btn-reset" disabled>↺ 처음부터</button>'
      + '</div>'
      + '<div class="ff-sim-stats">'
      + '<div class="ff-sim-stat"><span>기준일</span><b id="ffSimDate">' + escapeHtml(daily[0].date) + '</b></div>'
      + '<div class="ff-sim-stat"><span>현재가</span><b id="ffSimPrice">' + fmtWon(daily[0].close) + '</b></div>'
      + '<div class="ff-sim-stat"><span>평가금액</span><b id="ffSimValue">' + fmtWon(defaultAmount) + '</b></div>'
      + '<div class="ff-sim-stat"><span>수익률</span><b id="ffSimRate" class="ff-flat">0.0%</b></div>'
      + '</div>'
      + '<div class="ff-chart ff-chart-sim">' + buildSimChartSvg(daily) + '</div>'
      + '<div class="ff-sim-extremes" id="ffSimExtremes">' + simExtremesText(daily, geo, defaultAmount) + '</div>'
      + '<div class="ff-sim-patience">' + simPatienceHtml(daily, geo.ratios) + '</div>'
      + '<div class="ff-sim-result" id="ffSimResult">' + simResultText(daily, defaultAmount) + '</div>'
      + '<div class="ff-hint">매매수수료·세금·배당은 반영하지 않은 종가 기준 단순 계산이며, 투자 조언이 아닙니다.</div>'
      + '</div>';
  }

  function wireSimulation(box, chartData) {
    var daily = chartData && chartData.daily;
    if (!daily || daily.length < 2) return;
    var geo = simGeometry(daily);
    var amountInput = box.querySelector('#ffSimAmount');
    var playBtn = box.querySelector('#ffSimPlay');
    var resetBtn = box.querySelector('#ffSimReset');
    var dateEl = box.querySelector('#ffSimDate');
    var priceEl = box.querySelector('#ffSimPrice');
    var valueEl = box.querySelector('#ffSimValue');
    var rateEl = box.querySelector('#ffSimRate');
    var resultEl = box.querySelector('#ffSimResult');
    var extremesEl = box.querySelector('#ffSimExtremes');
    var lineEl = box.querySelector('#ffSimLine');
    var dotEl = box.querySelector('#ffSimDot');
    var axisMaxEl = box.querySelector('#ffSimAxisMax');
    var axisMinEl = box.querySelector('#ffSimAxisMin');
    if (!amountInput || !playBtn || !resetBtn || !lineEl) return;

    var timer = null;
    var idx = 0;

    function currentAmount() {
      var n = Number(amountInput.value);
      return (isFinite(n) && n > 0) ? n : 1000000;
    }

    function updateAxis() {
      var amount = currentAmount();
      if (axisMaxEl) axisMaxEl.textContent = fmtCompactWon(amount * geo.domMax);
      if (axisMinEl) axisMinEl.textContent = fmtCompactWon(amount * geo.domMin);
      if (extremesEl) extremesEl.innerHTML = simExtremesText(daily, geo, amount);
    }

    function pointsUpTo(i) {
      var pts = [];
      for (var k = 0; k <= i; k++) pts.push(geo.x(k).toFixed(1) + ',' + geo.y(geo.ratios[k]).toFixed(1));
      return pts.join(' ');
    }

    function renderFrame(i) {
      var amount = currentAmount();
      var d = daily[i];
      var value = amount * geo.ratios[i];
      var rate = (geo.ratios[i] - 1) * 100;
      lineEl.setAttribute('points', pointsUpTo(i));
      lineEl.setAttribute('class', 'ff-sim-line ' + (geo.ratios[i] >= 1 ? 'ff-buy' : 'ff-sell'));
      if (dotEl) {
        dotEl.setAttribute('cx', geo.x(i).toFixed(1));
        dotEl.setAttribute('cy', geo.y(geo.ratios[i]).toFixed(1));
        dotEl.setAttribute('visibility', 'visible');
      }
      if (dateEl) dateEl.textContent = d.date;
      if (priceEl) priceEl.textContent = fmtWon(d.close);
      if (valueEl) valueEl.textContent = fmtWon(Math.round(value));
      if (rateEl) {
        rateEl.textContent = fmtSignedPct(rate);
        rateEl.className = signClass(rate);
      }
    }

    function reset() {
      if (timer) { clearInterval(timer); timer = null; }
      idx = 0;
      updateAxis();
      lineEl.setAttribute('points', '');
      lineEl.setAttribute('class', 'ff-sim-line');
      if (dotEl) dotEl.setAttribute('visibility', 'hidden');
      var amount = currentAmount();
      if (dateEl) dateEl.textContent = daily[0].date;
      if (priceEl) priceEl.textContent = fmtWon(daily[0].close);
      if (valueEl) valueEl.textContent = fmtWon(amount);
      if (rateEl) { rateEl.textContent = '0.0%'; rateEl.className = 'ff-flat'; }
      if (resultEl) resultEl.innerHTML = simResultText(daily, amount);
      playBtn.disabled = false;
      playBtn.textContent = '▶ 재생';
      resetBtn.disabled = true;
    }

    function pause() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      playBtn.disabled = false;
      playBtn.textContent = '▶ 재생';
    }

    function play() {
      if (timer) return;
      updateAxis();
      playBtn.disabled = false;
      playBtn.textContent = '⏸ 일시정지';
      resetBtn.disabled = false;
      var n = daily.length;
      var perTick = Math.max(1, Math.ceil(n / 220)); // 약 5초 안팎으로 재생되도록 프레임 보정
      timer = setInterval(function () {
        idx = Math.min(idx + perTick, n - 1);
        renderFrame(idx);
        if (idx >= n - 1) {
          clearInterval(timer);
          timer = null;
          playBtn.textContent = '▶ 다시 재생';
          playBtn.disabled = false;
        }
      }, 24);
    }

    playBtn.addEventListener('click', function () {
      if (timer) {
        pause();
        return;
      }
      if (idx >= daily.length - 1) reset();
      play();
    });
    resetBtn.addEventListener('click', reset);
    amountInput.addEventListener('change', reset);
    amountInput.addEventListener('input', function () {
      if (timer) return; // 재생 중에는 입력해도 즉시 반영하지 않음(change에서 재생 재시작)
      updateAxis();
      var amount = currentAmount();
      if (idx === 0 && valueEl) valueEl.textContent = fmtWon(amount);
      if (resultEl) resultEl.innerHTML = simResultText(daily, amount);
    });

    reset();
  }

  function extraMetric(label, valueHtml) {
    return '<div class="ff-extra-metric"><div class="ff-extra-metric-label">' + escapeHtml(label) + '</div>'
      + '<div class="ff-extra-metric-value">' + valueHtml + '</div></div>';
  }

  // 숏 압박 지수는 0을 기준으로 위(+)는 외국인·기관 순매수가 공매도 거래량보다 강함(숏스퀴즈
  // 가능권 - 매수 우호적), 아래(-)는 외국인·기관도 동반 매도 중임을 뜻한다. 임계값은 공식
  // 스펙이 없어 이 구현에서 정한 값(추후 실제 분포 보고 조정 가능).
  function squeezeGrade(v) {
    if (v == null) return null;
    if (v >= 200) return { label: '매우 높음', cls: 'ff-buy' };
    if (v >= 50) return { label: '높음', cls: 'ff-buy' };
    if (v > -50) return { label: '보통', cls: 'ff-flat' };
    if (v > -200) return { label: '낮음', cls: 'ff-sell' };
    return { label: '매우 낮음', cls: 'ff-sell' };
  }

  // 공매도 + 대차거래 병합 카드 (원래 두 카드였으나 서로 연관된 지표라 하나로 합침)
  function buildShortLoanCard(s, l, currentClose) {
    if (!s && !l) return '';
    var p = (s && s.pressure) || { score: 0, grade: { emoji: '', label: '-' }, breakdown: {} };
    var b = p.breakdown || {};
    var causes = [];
    if (s) {
      if (b.short_ratio > 0) causes.push('공매도 거래비중 ' + fmtPct(s.today_ratio_pct));
      if (b.loan_increase > 0) causes.push('대차잔고 증가 ' + fmtSignedPct(l && l.balance_change_pct));
      if (b.balance_increase > 0) causes.push('공매도 잔고 증가 ' + fmtSignedPct(s.balance_change_pct));
      if (b.foreign_sell > 0) causes.push('외국인 순매도 동반');
      if (b.inst_sell > 0) causes.push('기관 순매도 동반');
      if (p.danger_gate && p.danger_gate.triggered) causes.push('KRX 공매도 과열종목 지정');
    }

    var grid = '';
    // 대차잔고는 종목별 실제 체결가가 없어 현재가로 근사(추정)한다 - s 유무와 무관하게
    // 항상 같은 값이어야 해서 s 블록 밖에 둔다.
    var loanAmount = (l && l.balance_qty != null && currentClose) ? l.balance_qty * currentClose : null;
    if (s) {
      // "악성" 신호는 붉게 강조: 공매도 평균가격이 현재가와 20% 이상 괴리, 당일 거래비중 10%↑
      // (거래비중 임계값은 scripts/fetch_investor_flow.py의 압박점수 밴드(>=10=강한 구간)와 통일)
      var gapPct = (currentClose && s.avg_price) ? (s.avg_price - currentClose) / currentClose * 100 : null;
      var gapWarn = gapPct != null && Math.abs(gapPct) >= 20;
      var ratioWarn = s.today_ratio_pct != null && s.today_ratio_pct >= 10;
      var sg = squeezeGrade(s.short_squeeze_index);

      // 2026-07-19: 절대수치는 그 자체로는 해석이 안 돼서(방향성은 "증감률"이 더 잘
      // 보여줌) 한 번 뺐었는데, 2026-08-14 "공매도가 얼마치라는건지, 몇 주라는건지" 재요청을
      // 받아 공매도 잔고(수량+추정 금액)를 다시 넣는다 - 증감률이 방향을, 이 절대수치가
      // 규모를 보여주는 역할 분담으로 둘 다 필요하다는 피드백.
      var shortAmount = (s.balance_qty != null && s.avg_price != null) ? s.balance_qty * s.avg_price : null;
      grid += extraMetric('공매도 평균가격(추정)', '<span class="' + (gapWarn ? 'ff-warn' : '') + '">' + fmtWon(s.avg_price) + '</span>'
          + (gapPct != null ? '<div class="ff-extra-metric-sub">현재가 대비 ' + fmtSignedPct(gapPct) + '</div>' : ''))
        + extraMetric('공매도 잔고', fmtAbsShares(s.balance_qty)
          + (shortAmount != null ? '<div class="ff-extra-metric-sub">약 ' + fmtCompactWon(shortAmount) + '</div>' : ''))
        + extraMetric('당일 거래비중', '<span class="' + (ratioWarn ? 'ff-warn' : '') + '">' + fmtPct(s.today_ratio_pct) + '</span>')
        + extraMetric('Days to Cover', s.days_to_cover == null ? '-' : s.days_to_cover.toFixed(2) + '일')
        + extraMetric('숏 압박 지수', (s.short_squeeze_index == null ? '-' : s.short_squeeze_index.toFixed(1))
          + (sg ? ' <span class="ff-squeeze-grade ' + sg.cls + '">' + sg.label + '</span>' : ''));
    }
    if (l) {
      // 공매도 지표(위 5개)와 대차잔고 지표(아래 2개)는 grid가 flow 레이아웃이라 경계가
      // 안 보인다는 피드백(2026-08-14) - 두 그룹이 다 있을 때만 얇은 구분선을 넣는다.
      if (s) grid += '<div class="ff-extra-divider"></div>';
      grid += extraMetric('대차잔고 증감률', '<span class="' + signClass(l.balance_change_pct) + '">' + fmtSignedPct(l.balance_change_pct) + '</span>')
        + extraMetric('대차잔고', fmtAbsShares(l.balance_qty)
          + (loanAmount != null ? '<div class="ff-extra-metric-sub">약 ' + fmtCompactWon(loanAmount) + '(현재가 기준 추정)</div>' : ''));
    }

    var tone = SHORT_GRADE_TONE[p.grade.label] || 'neutral';
    var toneBadgeCls = TONE_BADGE_CLASS[tone] || 'ff-badge-neutral';

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">🔻 공매도·대차거래 <span class="ff-extra-grade">' + escapeHtml(p.grade.label) + '</span></div>'
      + (causes.length ? '<div class="ff-extra-badges">' + causes.map(function (c) { return '<span class="ff-extra-badge">' + escapeHtml(c) + '</span>'; }).join('') + '</div>' : '')
      + (s ? '<div class="ff-extra-interp ff-extra-tone-' + tone + '">'
          + '<span class="ff-badge ' + toneBadgeCls + '">' + escapeHtml(p.grade.label) + '</span>'
          + '<span class="ff-extra-interp-text">' + escapeHtml(shortInterpText(s, l)) + '</span>'
          + '</div>' : '')
      + '<div class="ff-extra-grid">' + grid + '</div>'
      + '<div class="ff-extra-help">'
      + '<b>Day to Cover</b>: 공매도 잔고를 20일 평균 거래량으로 다 갚는 데 걸리는 거래일 수(클수록 상환 물량 소화가 오래 걸림).<br>'
      + '<b>숏 압박 지수</b>: (외국인+기관 순매수)÷공매도 거래량×100. 0 이상이면 숏스퀴즈 압력 구간, 미만이면 동반 매도 구간.<br>'
      + '<b>대차잔고 증감률</b>: 대차거래(기관·외국인이 주식을 빌리고 빌려주는 거래)로 시중에 풀린 주식 잔고의 증감. '
      + '공매도는 대부분 이렇게 빌린 주식을 팔아서 이뤄지므로, 잔고가 늘면 앞으로 공매도에 쓰일 수 있는 물량이 쌓이는 중(선행 경고 신호), 줄면 빌린 주식이 상환되며 공매도 압박이 누그러지는 중이라는 뜻.<br>'
      + '<b>위험 등급</b>: ①KRX가 오늘 공매도 과열종목으로 지정/연장했고 ②최근 5거래일 주가가 실제로 하락했고 ③공매도·대차 물량이 늘어난 경우, 이 3가지가 전부 겹칠 때만 별도로 승격됩니다(하나라도 안 맞으면 위 100점 계산 등급 그대로).'
      + '</div>'
      + '</div>';
  }

  // 반대매매(담보부족·미수 강제청산) 압박 - 개별 계좌 단위 정보라 특정 매도가 반대매매인지
  // 직접 확인은 불가능하고, "주가 급락+신용융자잔고 급감(대량 상환)"이 동시에 나타나는
  // 최근 10영업일 내 가장 심한 날을 근사 신호로 보여준다(백엔드 credit_pressure_signal,
  // scripts/cloud-vm/investor_flow.py). 신용거래 자체가 없는 종목은 credit이 통째로 없을
  // 수 있어(entry.credit이 아예 undefined) 최상단에서 걸러진다.
  function buildCreditCard(credit) {
    if (!credit) return '';
    var sig = credit.signal || { flag: false, label: '데이터 없음', text: '신용융자 데이터가 없는 종목입니다.' };
    var tone = sig.flag ? 'caution' : 'neutral';
    var toneBadgeCls = TONE_BADGE_CLASS[tone] || 'ff-badge-neutral';

    var grid = extraMetric('신용융자잔고', credit.balance_qty == null ? '-' : fmtAbsShares(credit.balance_qty))
      + extraMetric('신용융자잔고 증감률(당일)', '<span class="' + signClass(credit.balance_change_pct) + '">'
        + fmtSignedPct(credit.balance_change_pct) + '</span>');
    if (sig.flag) {
      grid += extraMetric('감지일', escapeHtml(sig.date || '-'))
        + extraMetric('그 날 주가 등락률', '<span class="' + signClass(sig.price_change_pct) + '">' + fmtSignedPct(sig.price_change_pct) + '</span>')
        + extraMetric('그 날 잔고 증감률', '<span class="' + signClass(sig.balance_change_pct) + '">' + fmtSignedPct(sig.balance_change_pct) + '</span>');
    }

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">⚠️ 반대매매 압박</div>'
      + '<div class="ff-extra-interp ff-extra-tone-' + tone + '">'
      + '<span class="ff-badge ' + toneBadgeCls + '">' + escapeHtml(sig.label) + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(sig.text) + '</span>'
      + '</div>'
      + '<div class="ff-extra-grid">' + grid + '</div>'
      + '<div class="ff-extra-help">'
      + '반대매매는 미수·신용 담보비율 미달 시 증권사가 강제로 청산하는 매도로, 개별 계좌 단위라 직접 확인할 방법이 없습니다. '
      + '"주가가 크게 떨어진 날 신용융자잔고도 크게(대량 상환) 줄었는지"를 최근 10영업일에서 찾아 <b>가능성·추정치</b>로만 보여드립니다 - 실제 반대매매 발생을 확정하지 않습니다.'
      + '</div>'
      + '</div>';
  }

  function buildPensionCard(p, name) {
    if (!p) return '';
    var streak = p.streak || { days: 0, direction: 'flat' };
    var streakLabel = streak.direction === 'buy' ? '연속 순매수' : streak.direction === 'sell' ? '연속 순매도' : '뚜렷한 방향 없음';
    var streakBadgeCls = streak.direction === 'buy' ? 'ff-badge-buy' : streak.direction === 'sell' ? 'ff-badge-sell' : 'ff-badge-neutral';
    var interp = pensionInterpText(p);
    var badgeCls = TONE_BADGE_CLASS[interp.tone] || 'ff-badge-neutral';

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">🏦 연기금 매매 동향</div>'
      + '<div class="ff-extra-streak"><span class="ff-badge ' + streakBadgeCls + '">' + streakLabel + ' ' + streak.days + '일</span></div>'
      + '<div class="ff-extra-interp ff-extra-tone-' + escapeAttr(interp.tone) + '">'
      + '<span class="ff-badge ' + badgeCls + '">' + escapeHtml(interp.label) + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(interp.text) + '</span>'
      + '</div>'
      + '<div class="ff-extra-grid">'
      + extraMetric('최근 5일 순매수', fmtSignedWon(p.net_5d))
      + extraMetric('최근 20일 순매수', fmtSignedWon(p.net_20d))
      + extraMetric('최근 60일 순매수', p.net_60d == null ? '-' : fmtSignedWon(p.net_60d))
      + extraMetric('누적(' + (p.cumulative_window_days || 0) + '영업일)', fmtSignedWon(p.net_cumulative))
      + (p.official_holding ? extraMetric('국민연금 연말 보유', fmtEokWon(p.official_holding.evaluation_amount_eok)
        + ' · 지분율 ' + fmtPct(p.official_holding.holding_pct)) : '')
      + (p.large_holding_report ? extraMetric('국민연금 5% 신고(' + escapeHtml(p.large_holding_report.as_of || '-') + ' 기준)',
        '지분율 ' + fmtPct(p.large_holding_report.holding_pct)) : '')
      + '</div>'
      + '</div>';
  }

  // ---- 가격 차트: 지지/저항 + 이동평균 5/20/60일선 (?action=flowChart) ----

  function buildFlowChartCard(chartData, techScore) {
    var body;
    if (!chartData || chartData.error || !chartData.daily || chartData.daily.length < 2) {
      body = '<div class="ff-error">' + escapeHtml((chartData && chartData.message) || '차트 데이터를 불러오지 못했어요.') + '</div>';
    } else {
      body = '<div class="ff-chart-toggles">'
        + '<label class="ff-ichimoku-toggle"><input type="checkbox" id="ffMovingAverageToggle"' + (movingAverageEnabled ? ' checked' : '') + ' /> 이동평균선 표시</label>'
        + '<label class="ff-ichimoku-toggle"><input type="checkbox" id="ffIchimokuToggle"' + (ichimokuEnabled ? ' checked' : '') + ' /> 일목균형표(구름) 표시</label>'
        + '</div>'
        + '<div class="ff-chart ff-chart-candle" id="ffLwChart" style="height:' + FCHART_H + 'px"></div>'
        + (chartData.source === 'flow-fallback'
          ? '<div class="ff-hint">일봉 원천 응답이 지연되어 수급 응답의 종가·거래량으로 임시 표시 중입니다. 실제 OHLC가 도착하면 자동으로 교체됩니다.</div>'
          : '')
        + buildLwLegend()
        + buildTechBreakdown(techScore)
        + buildRsiSection(chartData.daily);
    }
    return '<div class="ff-extra-card ff-flow-chart-card">'
      + '<div class="ff-extra-card-title">📉 가격 차트</div>'
      + body
      + '</div>';
  }

  function buildLwLegend() {
    return '<div class="ff-legend">'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma5 + '"></i>5일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma20 + '"></i>20일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma60 + '"></i>60일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + ma224Color() + '"></i>224일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#1261c4"></i>지지선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#d24f45"></i>저항선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#f59e0b"></i>공시</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#8b5cf6"></i>실적</span>'
      + '</div>';
  }

  var movingAverageEnabled = true;
  var movingAverageOverlaySeries = [];

  function wireMovingAverageToggle(box) {
    var toggle = box.querySelector('#ffMovingAverageToggle');
    if (!toggle) return;
    toggle.addEventListener('change', function () {
      movingAverageEnabled = toggle.checked;
      movingAverageOverlaySeries.forEach(function (series) {
        try { series.applyOptions({ visible: movingAverageEnabled }); } catch (e) { /* 제거된 차트면 무시 */ }
      });
    });
  }

  // 일목균형표는 캔들과 겹치는 별도 보조지표라 체크박스로 켜고 끈다(기본 꺼짐).
  var ichimokuEnabled = false;
  var ichimokuOverlaySeries = [];
  var ichimokuCloudPrimitive = null; // { series, primitive }

  // 선행스팬1(A)·2(B)를 같은 시각끼리 짝지어 { time, a, b } 배열로 만든다(js/pattern-scan.js와
  // 동일 로직 - 두 계열은 필요 기간이 달라 시작 시점이 어긋나므로 B가 있는 시각만 교집합으로 뽑음).
  function pairIchimokuBand(aPts, bPts) {
    var bMap = {};
    for (var i = 0; i < bPts.length; i++) bMap[bPts[i].time] = bPts[i].value;
    var out = [];
    for (var j = 0; j < aPts.length; j++) {
      var t = aPts[j].time;
      if (Object.prototype.hasOwnProperty.call(bMap, t)) out.push({ time: t, a: aPts[j].value, b: bMap[t] });
    }
    return out;
  }

  // TradingView 공식 "Bands Indicator" 플러그인 예제와 같은 구조(Series Primitive, v5 지원 -
  // js/pattern-scan.js 참고). drawBackground()로 캔들/선보다 먼저 그려 구름이 배경에 깔리게 한다.
  function createIchimokuCloudPrimitive(bandPts, cloudColor) {
    return {
      _chart: null,
      _series: null,
      attached: function (params) { this._chart = params.chart; this._series = params.series; },
      detached: function () { this._chart = null; this._series = null; },
      updateAllViews: function () {},
      paneViews: function () {
        var self = this;
        return [{
          renderer: function () {
            return {
              draw: function () {},
              drawBackground: function (target) {
                var chart = self._chart, series = self._series;
                if (!chart || !series) return;
                target.useBitmapCoordinateSpace(function (scope) {
                  var ctx = scope.context;
                  var hRatio = scope.horizontalPixelRatio, vRatio = scope.verticalPixelRatio;
                  var timeScale = chart.timeScale();
                  var pts = bandPts.map(function (p) {
                    var x = timeScale.timeToCoordinate(p.time);
                    var yA = series.priceToCoordinate(p.a);
                    var yB = series.priceToCoordinate(p.b);
                    if (x == null || yA == null || yB == null) return null;
                    return { x: x * hRatio, yA: yA * vRatio, yB: yB * vRatio };
                  });
                  ctx.save();
                  for (var k = 0; k < pts.length - 1; k++) {
                    var p0 = pts[k], p1 = pts[k + 1];
                    if (!p0 || !p1) continue;
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.yA);
                    ctx.lineTo(p1.x, p1.yA);
                    ctx.lineTo(p1.x, p1.yB);
                    ctx.lineTo(p0.x, p0.yB);
                    ctx.closePath();
                    ctx.fillStyle = cloudColor;
                    ctx.fill();
                  }
                  ctx.restore();
                });
              }
            };
          }
        }];
      }
    };
  }

  // computeIchimoku(daily)는 computeIchimokuScore가 이미 쓰는 기존 함수를 그대로 재사용한다
  // (전환선/기준선도 내부적으로 계산해야 선행스팬이 나오지만, 화면엔 구름 경계선 2개만 그림).
  function addIchimokuOverlay(daily) {
    if (!lwcChart || ichimokuOverlaySeries.length || !daily || daily.length < ICHIMOKU_SENKOU_B_PERIOD) return;
    var ichi = computeIchimoku(daily);
    var seriesByKey = {};
    [['senkouA', ichi.senkouA], ['senkouB', ichi.senkouB]].forEach(function (pair) {
      var key = pair[0], pts = pair[1];
      if (!pts.length) return;
      // 선행스팬 데이터는 미래 시간축 계산에 사용하되 경계선은 투명하게 숨기고,
      // 두 선 사이의 하늘색 구름만 표시한다.
      var series = lwcChart.addSeries(global.LightweightCharts.LineSeries, { color: ICHIMOKU_BORDER_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      series.setData(pts);
      ichimokuOverlaySeries.push(series);
      seriesByKey[key] = series;
    });

    if (seriesByKey.senkouA && typeof seriesByKey.senkouA.attachPrimitive === 'function') {
      try {
        var bandPts = pairIchimokuBand(ichi.senkouA, ichi.senkouB);
        if (bandPts.length > 1) {
          var cloudPrimitive = createIchimokuCloudPrimitive(bandPts, ICHIMOKU_CLOUD_FILL);
          seriesByKey.senkouA.attachPrimitive(cloudPrimitive);
          ichimokuCloudPrimitive = { series: seriesByKey.senkouA, primitive: cloudPrimitive };
        }
      } catch (e) { /* primitive 렌더링을 지원하지 않는 차트에서는 구름을 생략한다 */ }
    }
  }

  function removeIchimokuOverlay() {
    if (lwcChart) {
      if (ichimokuCloudPrimitive) {
        try { ichimokuCloudPrimitive.series.detachPrimitive(ichimokuCloudPrimitive.primitive); } catch (e) { /* 무시 */ }
      }
      ichimokuOverlaySeries.forEach(function (s) { try { lwcChart.removeSeries(s); } catch (e) { /* 이미 제거됐으면 무시 */ } });
    }
    ichimokuOverlaySeries = [];
    ichimokuCloudPrimitive = null;
  }

  function wireIchimokuToggle(box, chartData) {
    var toggle = box.querySelector('#ffIchimokuToggle');
    if (!toggle) return;
    toggle.addEventListener('change', function () {
      ichimokuEnabled = toggle.checked;
      if (ichimokuEnabled) addIchimokuOverlay(chartData && chartData.daily); else removeIchimokuOverlay();
    });
  }

  // ---- 매물대 아파트(2026-08-02: 매수/매도벽 구분 폐기, 순수 거래량 매물대로 전환) ----
  // 개인/외국인/기관 순매수·순매도 벽으로 나눠 보여주던 이전 버전은 "매도벽은 필요 없다,
  // 토스처럼 그냥 매물대(거래량)만 보여달라"는 사용자 요청으로 걷어냈다. 이제 차트 탭의
  // 매물대 오버레이(VP, 아래 computeVolumeProfile)와 완전히 같은 계산을 아파트 형태로만
  // 다르게 그린다 - 데이터도 chartData.daily(가격+거래량, 최대 500거래일)를 그대로
  // 재사용해서 수급 API(63거래일 상한)에 더는 의존하지 않는다. 층수(bin 개수)는 카드 안의
  // 확대(+)/축소(-) 버튼으로 즉시 바꿀 수 있다 - 서버 재조회 없이 이미 받아온
  // chartData.daily만으로 다시 계산하므로 즉시 반영된다(토스 차트에서 확대/축소하면
  // 매물대가 다시 그려지는 것과 같은 원리를 층수 조절로 구현).
  var APT_LOOKBACK_DAYS = 120;
  var APT_BIN_STEPS = [12, 18, 24, 36, 48];
  var APT_BIN_DEFAULT_INDEX = 2; // 24층 기본

  // bins[i].low/high를 직접 훑어 찾는다(예전엔 minLow+i*binSize로 계산했는데, 균등폭
  // bins에서만 맞는 공식이라 "실제 체결가" 매물대처럼 실제 호가 경계에 맞춰 폭이 들쭉날쭉한
  // bins(computeRealVolumeProfile 참고)에서는 틀린 값이 나왔다).
  function aptBinIndex(profile, price) {
    if (!profile || price == null || !(profile.maxHigh > profile.minLow)) return -1;
    var bins = profile.bins;
    for (var i = 0; i < bins.length; i++) {
      if (price <= bins[i].high) return i;
    }
    return bins.length - 1;
  }

  // 원본 매물대는 최대 48개 가격 구간까지 내려오지만, 화면에서는 인접 구간을 12개로
  // 합쳐 가격의 연속성은 유지하면서 한눈에 비교할 수 있게 한다.
  function compactAptProfileBins(profile, rowCount) {
    if (!profile || !profile.bins || !profile.bins.length) return [];
    var bins = profile.bins;
    var count = Math.max(1, Math.min(Number(rowCount) || 12, bins.length));
    var compacted = [];
    for (var i = 0; i < count; i++) {
      var start = Math.floor(i * bins.length / count);
      var end = Math.max(start + 1, Math.floor((i + 1) * bins.length / count));
      var chunk = bins.slice(start, end);
      var volume = chunk.reduce(function (sum, bin) {
        return sum + Math.max(0, Number(bin.volume) || 0);
      }, 0);
      compacted.push({
        low: Number(chunk[0].low),
        high: Number(chunk[chunk.length - 1].high),
        volume: volume,
        start: start,
        end: end - 1
      });
    }
    return compacted;
  }

  function buildSimpleVolumeProfileHtml(profile, currentPrice, avgPrice, periodLabel) {
    if (!profile || !profile.bins || !profile.bins.length) {
      return '<div class="ff-apt-empty">이 구간엔 매물대를 계산할 데이터가 부족해요.</div>';
    }
    var rows = compactAptProfileBins(profile, 12);
    var pocBin = profile.bins[profile.pocIndex];
    var pocMid = pocBin ? (Number(pocBin.low) + Number(pocBin.high)) / 2 : null;
    var maxVolume = rows.reduce(function (max, row) { return Math.max(max, row.volume); }, 0);
    var pocRow = rows.findIndex(function (row) {
      return profile.pocIndex >= row.start && profile.pocIndex <= row.end;
    });

    function won(value) {
      return value == null || !isFinite(Number(value)) ? '-' : Math.round(Number(value)).toLocaleString('ko-KR') + '원';
    }
    function rowHasPrice(row, price) {
      return price != null && isFinite(Number(price)) && Number(price) >= row.low && Number(price) <= row.high;
    }
    function rangeText(row) {
      if (Math.round(row.low) === Math.round(row.high)) return won(row.low);
      return Math.round(row.low).toLocaleString('ko-KR') + '~' + Math.round(row.high).toLocaleString('ko-KR');
    }

    var rowHtml = rows.slice().reverse().map(function (row, reverseIndex) {
      var originalIndex = rows.length - 1 - reverseIndex;
      var isCurrent = rowHasPrice(row, currentPrice);
      var isAverage = rowHasPrice(row, avgPrice);
      var isPoc = originalIndex === pocRow;
      var width = maxVolume > 0 ? Math.max(3, Math.round(row.volume / maxVolume * 1000) / 10) : 0;
      var classes = 'ff-apt-simple-row' + (isCurrent ? ' is-current' : '') + (isAverage ? ' is-average' : '') + (isPoc ? ' is-poc' : '');
      var markers = (isCurrent ? '<span class="current">현재</span>' : '')
        + (isAverage ? '<span class="average">평균</span>' : '')
        + (isPoc ? '<span class="poc">최대</span>' : '');
      return '<div class="' + classes + '">'
        + '<span class="ff-apt-simple-price">' + rangeText(row) + '</span>'
        + '<span class="ff-apt-simple-track"><i style="width:' + width + '%"></i></span>'
        + '<span class="ff-apt-simple-volume">' + compactChartVolume(row.volume) + '주</span>'
        + '<span class="ff-apt-simple-markers">' + markers + '</span>'
        + '</div>';
    }).join('');

    var relation = '최대 매물대 부근';
    var relationNote = '거래가 가장 많이 쌓인 가격대라 지지·저항이 바뀔 수 있는 구간입니다.';
    if (currentPrice != null && pocMid != null && Number(currentPrice) > pocMid * 1.01) {
      relation = '현재가는 최대 매물대 위';
      relationNote = '아래의 두꺼운 매물대가 지지 후보가 될 수 있습니다.';
    } else if (currentPrice != null && pocMid != null && Number(currentPrice) < pocMid * .99) {
      relation = '현재가는 최대 매물대 아래';
      relationNote = '위의 두꺼운 매물대가 저항 후보가 될 수 있습니다.';
    }

    return '<div class="ff-apt-simple-summary">'
      + '<div><span>현재가</span><strong data-apt-simple-current>' + won(currentPrice) + '</strong></div>'
      + '<div><span>최대 매물대</span><strong>' + won(pocMid) + '</strong></div>'
      + '<div><span>평균단가</span><strong>' + won(avgPrice) + '</strong></div>'
      + '</div>'
      + '<div class="ff-apt-chart-wrap ff-apt-simple" role="img" aria-label="가격대별 거래량 매물대 막대 차트">'
      + '<div class="ff-apt-simple-head"><div><strong>가격대별 거래량</strong><span>막대가 길수록 거래가 많이 쌓인 구간</span></div><em>' + periodLabel + '</em></div>'
      + '<div class="ff-apt-simple-chart">' + rowHtml + '</div>'
      + '<div class="ff-apt-simple-legend"><span class="current">현재가</span><span class="average">평균단가</span><span class="poc">최대 매물대</span></div>'
      + '</div>'
      + '<div class="ff-apt-simple-note" role="note"><strong>' + relation + '</strong><span>' + relationNote + ' 단독 매매 신호가 아닌 참고 지표입니다.</span></div>';
  }

  // 한국투자 pbar-tratio(실제 체결가) 기반 - ?days=로 VM이 SQLite 누적분까지 합산해준다.
  // 조회할 때마다 그날 스냅샷이 쌓여서 daysIncluded가 자연히 늘어난다.
  // 2026-08-05: "최근 120일(근사)" 병행 뷰는 혼란만 준다는 사용자 판단으로 제거하고
  // 이 실제 체결가 뷰 하나로 통일했다(computeVolumeProfile 자체는 차트 탭 매물대
  // 오버레이(addVolumeProfileOverlay)가 여전히 써서 남겨둠).
  function buildAptDynamicHtml(profile, currentPrice, stepIndex, daysIncluded, avgPrice) {
    var sourceText = profile.source === 'ohlc-estimate'
      ? '일봉 고가·저가·거래량 기반 근사치'
      : '실제 체결가·체결거래량 기준';
    var footnote = '<div class="ff-footnote ff-apt-simple-source">' + sourceText + ' · 최근 <b>'
      + (daysIncluded || 1) + '거래일</b> 반영</div>';
    var periodLabel = (daysIncluded || 1) === 1 ? '오늘' : '최근 ' + daysIncluded + '거래일';
    return buildSimpleVolumeProfileHtml(profile, currentPrice, avgPrice, periodLabel)
      + footnote;
  }

  function buildAptCard() {
    return '<div class="ff-extra-card ff-apt-card" id="ffAptCard">'
      + '<div class="ff-extra-card-title">매물대</div>'
      + '<div id="ffAptDynamic"><div class="ff-apt-empty">매물대를 불러오는 중...</div></div>'
      + '</div>';
  }

  // 탭을 바꿀 때마다 막대를 처음부터 다시 자라나게 해서(더블 rAF로 0폭 상태를 한 프레임
  // 확실히 그린 뒤 목표폭으로 전환) 데이터가 바뀌었다는 걸 시각적으로도 알려준다.
  function playAptEntrance(card) {
    var wrap = card.querySelector('.ff-apt-chart-wrap');
    if (!wrap) return;
    wrap.classList.remove('ff-apt-in');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { wrap.classList.add('ff-apt-in'); });
    });
  }

  // 실제 체결가 매물대(한국투자 pbar-tratio, ?days=로 VM이 SQLite 누적분까지 합산해줌) 캐시 -
  // 같은 종목을 다시 열거나 층수만 바꿀 때 매번 재조회하지 않도록 1분 캐시.
  var realAptCache = {};
  var REAL_APT_CACHE_MS = 60 * 1000;

  function fetchRealVolumeProfile(code, days) {
    var cached = realAptCache[code];
    if (cached && Date.now() - cached.t < REAL_APT_CACHE_MS) return Promise.resolve(cached);
    return fetchJson(KIWOOM_VM_URL + '/pbar-tratio/' + encodeURIComponent(code) + '?days=' + days)
      .then(function (json) {
        var data = (json && json.data) || {};
        var result = { bins: data.bins || [], daysIncluded: data.daysIncluded || 1, avgPrice: data.avgPrice };
        realAptCache[code] = { t: Date.now(), bins: result.bins, daysIncluded: result.daysIncluded, avgPrice: result.avgPrice };
        return result;
      });
  }

  // KIS 가격대 API가 휴장일·장 시작 전·일시적인 호출 제한으로 실패해도
  // OHLC에 거래량이 있으면 근사 매물대를 표시한다. 실제 체결가와 섞지 않고
  // 결과에 출처를 남겨 화면에서 구분한다.
  function buildApproxVolumeProfile(daily, binCount) {
    var profile = computeVolumeProfile(daily, APT_LOOKBACK_DAYS, binCount);
    if (!profile) return null;
    var total = profile.bins.reduce(function (sum, bin) { return sum + Math.max(0, Number(bin.volume) || 0); }, 0);
    var avg = total > 0 ? profile.bins.reduce(function (sum, bin) {
      return sum + ((Number(bin.low) + Number(bin.high)) / 2) * (Math.max(0, Number(bin.volume) || 0));
    }, 0) / total : null;
    return {
      bins: profile.bins.map(function (bin) {
        return { price: (Number(bin.low) + Number(bin.high)) / 2, volume: Number(bin.volume) || 0 };
      }),
      daysIncluded: profile.days,
      avgPrice: avg,
      source: 'ohlc-estimate'
    };
  }

  // 실제 체결가 매물대는 이미 실제 가격×체결거래량 쌍(pbar-tratio, 실제 호가단위로 옴)이다.
  // (maxHigh-minLow)/binCount로 균등분할하면 근사치와 똑같은 문제(구간 경계가 실제
  // 존재한 적 없는 가격이 됨)가 재발하므로, 대신 정렬된 원본 가격들을 개수 기준으로
  // binCount개 묶음으로 나눈다 - 각 층의 저가/고가가 항상 실제 체결가 중 하나가 된다.
  function computeRealVolumeProfile(rawBins, binCount, trendUp) {
    if (!rawBins || !rawBins.length) return null;
    var n = rawBins.length;
    var perBucket = Math.max(1, Math.ceil(n / binCount));
    var bins = [];
    for (var start = 0; start < n; start += perBucket) {
      var chunk = rawBins.slice(start, start + perBucket);
      var volume = 0;
      chunk.forEach(function (r) { volume += r.volume || 0; });
      bins.push({ low: chunk[0].price, high: chunk[chunk.length - 1].price, volume: volume });
    }
    // 묶음이 가격 1개짜리라 low===high인 층은 다음 층의 저가까지 살짝 넓혀(실제 가격이라
    // 안전) 폭 0 막대가 이상해 보이지 않게 한다. 마지막 층은 넓힐 다음 층이 없으면 그대로 둔다.
    for (var i = 0; i < bins.length - 1; i++) {
      if (bins[i].high === bins[i].low) bins[i].high = bins[i + 1].low;
    }
    var maxVolume = 0, pocIndex = 0;
    bins.forEach(function (b, i) { if (b.volume > maxVolume) { maxVolume = b.volume; pocIndex = i; } });
    if (maxVolume <= 0) return null;
    return {
      bins: bins, maxVolume: maxVolume, pocIndex: pocIndex,
      minLow: bins[0].low, maxHigh: bins[bins.length - 1].high,
      days: 1, trendUp: trendUp
    };
  }

  // 확대(+)/축소(-) 버튼: 캐시된 pbar-tratio 원자료로 층수(bin count)만 바꿔 즉시
  // 재계산한다(fetchRealVolumeProfile 자체가 1분 캐시라 층수만 바꿀 땐 재조회 없음) -
  // 토스 차트에서 확대/축소하면 매물대가 다시 그려지는 것과 같은 반응성을 구현.
  function wireAptTabs(box, chartDaily, currentPrice, code) {
    var card = box.querySelector('#ffAptCard');
    if (!card) return;
    var stepIndex = APT_BIN_DEFAULT_INDEX;
    var activeProfile = null;

    function markerY(map, price) {
      var low = Number(map.getAttribute('data-apt-price-low'));
      var high = Number(map.getAttribute('data-apt-price-high'));
      if (!(high > low)) return 382;
      var ratio = Math.max(0, Math.min(1, (high - Number(price)) / (high - low)));
      return 116 + ratio * 266;
    }

    function updateCurrentMarker(map, price) {
      var y = markerY(map, price);
      var line = map.querySelector('line[data-apt-marker="current"]');
      var dot = map.querySelector('circle[data-apt-marker="current"]');
      var label = map.querySelector('text[data-apt-marker="current"]');
      if (line) { line.setAttribute('y1', y); line.setAttribute('y2', y); }
      if (dot) dot.setAttribute('cy', y);
      if (label) { label.setAttribute('y', y + 20); label.textContent = '현재가 ' + Math.round(price).toLocaleString('ko-KR') + '원'; }
      var summary = card.querySelector('.ff-apt-summary-current b');
      if (summary) summary.textContent = Math.round(price).toLocaleString('ko-KR') + '원';
    }

    function bandIndexForPrice(profile, price, bandCount) {
      var index = aptBinIndex(profile, price);
      if (index < 0) return -1;
      return Math.max(0, Math.min(bandCount - 1, Math.floor(index * bandCount / profile.bins.length)));
    }

    function animateRoofTraveler(map, nextBand, price) {
      var traveler = map.querySelector('[data-apt-roof-traveler]');
      if (!traveler) return;
      var bandCount = Number(map.getAttribute('data-apt-band-count')) || 1;
      var heights = String(map.getAttribute('data-apt-band-heights') || '').split(',').map(Number);
      var startX = Number(map.getAttribute('data-apt-current-x')) || 0;
      var startY = Number(map.getAttribute('data-apt-current-y')) || 0;
      var targetX = 38 + nextBand * 96 + 44;
      var targetY = 379 - (heights[nextBand] || 158) - 18;
      if (traveler.__raf) cancelAnimationFrame(traveler.__raf);
      var started = performance.now();
      var duration = Math.min(1400, Math.max(560, 520 + Math.abs(targetX - startX) * 1.2));
      traveler.classList.add('is-jumping');

      function frame(now) {
        var progress = Math.max(0, Math.min(1, (now - started) / duration));
        var eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        var arc = Math.sin(Math.PI * progress) * Math.min(42, 18 + Math.abs(targetX - startX) * .14);
        var x = startX + (targetX - startX) * eased;
        var y = startY + (targetY - startY) * eased - arc;
        traveler.setAttribute('transform', 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')');
        traveler.__currentX = x;
        traveler.__currentY = y;
        if (progress < 1) {
          traveler.__raf = requestAnimationFrame(frame);
          return;
        }
        traveler.__raf = null;
        map.setAttribute('data-apt-current-x', targetX);
        map.setAttribute('data-apt-current-y', targetY);
        traveler.classList.remove('is-jumping');
      }
      traveler.__currentX = startX;
      traveler.__currentY = startY;
      traveler.__raf = requestAnimationFrame(frame);
      map.setAttribute('data-apt-current-band', nextBand);
      map.querySelectorAll('.ff-apt-illustration-building').forEach(function (building, index) {
        building.classList.toggle('current-band', index === nextBand);
      });
      updateCurrentMarker(map, price);
    }

    function updateCurrentPrice(nextPrice) {
      var parsed = Number(nextPrice);
      if (!isFinite(parsed) || !activeProfile) return;
      currentPrice = parsed;
      var simpleCurrent = card.querySelector('[data-apt-simple-current]');
      if (simpleCurrent) simpleCurrent.textContent = Math.round(parsed).toLocaleString('ko-KR') + '원';
      var map = card.querySelector('[data-price-map-surface]');
      if (!map) return;
      updateCurrentMarker(map, parsed);
      var bandCount = Number(map.getAttribute('data-apt-band-count')) || 1;
      var nextBand = bandIndexForPrice(activeProfile, parsed, bandCount);
      var previousBand = Number(map.getAttribute('data-apt-current-band'));
      if (nextBand >= 0 && nextBand !== previousBand) animateRoofTraveler(map, nextBand, parsed);
    }
    card.__updateCurrentPrice = updateCurrentPrice;

    function trendUpFromDaily() {
      if (!chartDaily || !chartDaily.length) return true;
      var last = chartDaily[chartDaily.length - 1], prev = chartDaily[chartDaily.length - 2];
      return last && prev ? last.close >= prev.close : true;
    }

    function render() {
      var dynamic = card.querySelector('#ffAptDynamic');
      if (!dynamic) return;
      fetchRealVolumeProfile(code, APT_LOOKBACK_DAYS).then(function (result) {
        var profile = computeRealVolumeProfile(result.bins, APT_BIN_STEPS[stepIndex], trendUpFromDaily());
        if (!profile) throw new Error('실제 체결 데이터가 비어 있습니다.');
        profile.source = result.source || 'kis-pbar';
        activeProfile = profile;
        dynamic.innerHTML = buildAptDynamicHtml(profile, currentPrice, stepIndex, result.daysIncluded, result.avgPrice);
        wireZoom();
        wireBinRail();
        playAptEntrance(card);
      }).catch(function () {
        var fallback = buildApproxVolumeProfile(chartDaily, APT_BIN_STEPS[stepIndex]);
        if (!fallback) {
          dynamic.innerHTML = '<div class="ff-apt-empty">매물대를 불러오지 못했어요. 거래량 데이터가 없습니다.</div>';
          return;
        }
        var fallbackProfile = computeRealVolumeProfile(fallback.bins, APT_BIN_STEPS[stepIndex], trendUpFromDaily());
        if (!fallbackProfile) {
          dynamic.innerHTML = '<div class="ff-apt-empty">매물대를 계산할 거래량 데이터가 없습니다.</div>';
          return;
        }
        fallbackProfile.source = fallback.source;
        activeProfile = fallbackProfile;
        dynamic.innerHTML = buildAptDynamicHtml(fallbackProfile, currentPrice, stepIndex, fallback.daysIncluded, fallback.avgPrice);
        wireZoom();
        wireBinRail();
        playAptEntrance(card);
      });
    }

    function wireZoom() {
      var zoomWrap = card.querySelector('#ffAptZoom');
      if (!zoomWrap) return;
      zoomWrap.querySelectorAll('.ff-apt-zoom-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var dir = btn.getAttribute('data-zoom');
          var nextIndex = stepIndex + (dir === 'in' ? 1 : -1);
          if (nextIndex < 0 || nextIndex >= APT_BIN_STEPS.length) return;
          stepIndex = nextIndex;
          render();
        });
      });
    }

    function wireBinRail() {
      var rail = card.querySelector('[data-price-bin-rail]');
      if (!rail || rail.getAttribute('data-drag-ready') === '1') return;
      rail.setAttribute('data-drag-ready', '1');
      var dragging = false, startX = 0, startScroll = 0;
      rail.addEventListener('pointerdown', function (event) {
        dragging = true;
        startX = event.clientX;
        startScroll = rail.scrollLeft;
        rail.classList.add('is-dragging');
        try { rail.setPointerCapture(event.pointerId); } catch (ignore) {}
      });
      rail.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        rail.scrollLeft = startScroll - (event.clientX - startX);
      });
      function stopDragging() {
        dragging = false;
        rail.classList.remove('is-dragging');
      }
      rail.addEventListener('pointerup', stopDragging);
      rail.addEventListener('pointercancel', stopDragging);
      rail.addEventListener('lostpointercapture', stopDragging);
      rail.addEventListener('wheel', function (event) {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          rail.scrollLeft += event.deltaY;
          event.preventDefault();
        }
      }, { passive: false });

      var map = card.querySelector('[data-price-map-surface]');
      if (map && map.getAttribute('data-drag-ready') !== '1') {
        var buildingTrack = map.querySelector('[data-price-map-buildings]');
        var mapDragging = false, mapStartX = 0, mapStartScroll = 0, mapStartOffset = 0;
        map.setAttribute('data-drag-ready', '1');
        map.addEventListener('pointerdown', function (event) {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          mapDragging = true;
          mapStartX = event.clientX;
          mapStartScroll = rail.scrollLeft;
          mapStartOffset = buildingTrack ? Number(buildingTrack.getAttribute('data-building-offset')) || 0 : 0;
          map.classList.add('is-dragging');
          try { map.setPointerCapture(event.pointerId); } catch (ignore) {}
          event.preventDefault();
        });
        map.addEventListener('pointermove', function (event) {
          if (!mapDragging) return;
          var deltaX = event.clientX - mapStartX;
          if (buildingTrack) {
            var minOffset = Number(buildingTrack.getAttribute('data-building-min-offset')) || 0;
            var maxOffset = Number(buildingTrack.getAttribute('data-building-max-offset')) || 0;
            var nextOffset = Math.max(minOffset, Math.min(maxOffset, mapStartOffset + deltaX));
            buildingTrack.setAttribute('data-building-offset', nextOffset);
            buildingTrack.setAttribute('transform', 'translate(' + nextOffset + ' 0)');
          }
          rail.scrollLeft = mapStartScroll - deltaX;
          event.preventDefault();
        });
        function stopMapDragging() {
          mapDragging = false;
          map.classList.remove('is-dragging');
        }
        map.addEventListener('pointerup', stopMapDragging);
        map.addEventListener('pointercancel', stopMapDragging);
        map.addEventListener('lostpointercapture', stopMapDragging);
      }
      card.querySelectorAll('[data-bin-scroll]').forEach(function (button) {
        button.addEventListener('click', function () {
          rail.scrollBy({ left: Number(button.getAttribute('data-bin-scroll')) * Math.max(180, rail.clientWidth * 0.72), behavior: 'smooth' });
        });
      });
    }

    render();
  }

  // ---- 매물대(근사) ----
  // 진짜 매물대는 틱/체결가 기준인데 우리는 일봉(고가/저가/거래량)만 갖고 있어서, 하루
  // 거래량을 그날의 고가~저가 구간에 균등 분산시켜 가격대별로 합산하는 근사치다.
  // computeSupportResistance_(gas/ticker-proxy.gs)와 같은 120거래일 창을 써서 지지/저항과
  // 보는 기간을 맞춘다(전체 500일을 다 쓰면 산일전기처럼 급등 전 낮은 가격대까지 섞여
  // 지금 가격대와 무관한 구간이 커짐). 화면엔 근사치라는 걸 범례에 명시한다.
  var VP_LOOKBACK_DAYS = 120;
  var VP_BIN_COUNT = 24;
  // 매물대 막대 최대 폭 = 패널 폭의 16%(오른쪽 끝에 바짝 붙여서 캔들을 덜 가리게, 2026-07-24
  // 사용자 피드백으로 26%->16% 축소 - 막대가 왼쪽으로 너무 많이 뻗어 보인다는 지적)
  var VP_MAX_WIDTH_RATIO = 0.16;
  var vpEnabled = false;
  var vpPrimitive = null; // { series, primitive }
  var lwcCandleSeries = null;

  // lookbackDays/binCount 생략 시 차트 탭 오버레이 기본값(VP_LOOKBACK_DAYS/VP_BIN_COUNT)을
  // 쓴다. 매물대 아파트 카드(위 aptBinIndex 등)도 이 함수를 그대로 재사용해 층수(줌)만
  // 다르게 넘긴다 - 계산 로직이 완전히 같아 중복 구현을 피한다.
  function computeVolumeProfile(daily, lookbackDays, binCount) {
    lookbackDays = lookbackDays || VP_LOOKBACK_DAYS;
    binCount = binCount || VP_BIN_COUNT;
    if (!daily || daily.length < 2) return null;
    var win = daily.slice(Math.max(0, daily.length - lookbackDays));
    var minLow = Math.min.apply(null, win.map(function (d) { return d.low; }));
    var maxHigh = Math.max.apply(null, win.map(function (d) { return d.high; }));
    if (!(maxHigh > minLow)) return null;

    var binSize = (maxHigh - minLow) / binCount;
    var bins = [];
    for (var i = 0; i < binCount; i++) {
      bins.push({ low: minLow + i * binSize, high: minLow + (i + 1) * binSize, volume: 0 });
    }

    win.forEach(function (d) {
      if (!(d.volume > 0)) return;
      var range = d.high - d.low;
      if (!(range > 0)) {
        // 하루 종일 가격 변동이 없으면(상하한가 등) 종가가 속한 구간에 거래량 전량 배정
        var idx = Math.min(binCount - 1, Math.max(0, Math.floor((d.close - minLow) / binSize)));
        bins[idx].volume += d.volume;
        return;
      }
      var startIdx = Math.max(0, Math.floor((d.low - minLow) / binSize));
      var endIdx = Math.min(binCount - 1, Math.floor((d.high - minLow) / binSize));
      for (var b = startIdx; b <= endIdx; b++) {
        var overlap = Math.min(bins[b].high, d.high) - Math.max(bins[b].low, d.low);
        if (overlap > 0) bins[b].volume += d.volume * (overlap / range);
      }
    });

    var maxVolume = 0, pocIndex = 0;
    bins.forEach(function (b, i) {
      if (b.volume > maxVolume) { maxVolume = b.volume; pocIndex = i; }
    });
    if (maxVolume <= 0) return null;
    var last = win[win.length - 1], prev = win[win.length - 2];
    return {
      bins: bins, maxVolume: maxVolume, pocIndex: pocIndex,
      minLow: minLow, maxHigh: maxHigh, binSize: binSize, days: win.length,
      trendUp: last && prev ? last.close >= prev.close : true
    };
  }

  function buildVpLegend() {
    return '<div class="ff-vp-legend"' + (vpEnabled ? '' : ' hidden') + '>'
      + '<span>※ 매물대(근사): 최근 ' + VP_LOOKBACK_DAYS + '거래일 일봉 고가~저가 구간에 거래량을 분산해 합산한 근사치입니다(체결가 기준 아님).</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#e8590c"></i>거래량 최다 구간</span>'
      + '</div>';
  }

  // 일목균형표 구름과 동일한 Series Primitive 패턴(v5 지원) - drawBackground()로 캔들보다
  // 먼저 그려 막대가 캔들 뒤에 깔리게 한다. 패널 오른쪽 끝에서 왼쪽으로 뻗는 가로 막대이고
  // 길이는 그 가격구간 거래량/최댓값 비율. 시간축과 무관해(항상 오른쪽 고정) time-based
  // 좌표변환은 필요 없고 series.priceToCoordinate()만 쓴다.
  function createVolumeProfilePrimitive(profile) {
    return {
      _series: null,
      attached: function (params) { this._series = params.series; },
      detached: function () { this._series = null; },
      updateAllViews: function () {},
      paneViews: function () {
        var self = this;
        return [{
          renderer: function () {
            return {
              draw: function () {},
              drawBackground: function (target) {
                var series = self._series;
                if (!series) return;
                target.useBitmapCoordinateSpace(function (scope) {
                  var ctx = scope.context;
                  var hRatio = scope.horizontalPixelRatio, vRatio = scope.verticalPixelRatio;
                  var paneWidth = scope.bitmapSize.width;
                  var maxBarPx = paneWidth * VP_MAX_WIDTH_RATIO;
                  ctx.save();
                  profile.bins.forEach(function (b, i) {
                    if (b.volume <= 0) return;
                    var yTop = series.priceToCoordinate(b.high);
                    var yBottom = series.priceToCoordinate(b.low);
                    if (yTop == null || yBottom == null) return;
                    var barPx = Math.max(2 * hRatio, (b.volume / profile.maxVolume) * maxBarPx);
                    var top = yTop * vRatio, bottom = yBottom * vRatio;
                    ctx.fillStyle = i === profile.pocIndex ? 'rgba(232,89,12,0.32)' : 'rgba(130,130,130,0.16)';
                    ctx.fillRect(paneWidth - barPx, top, barPx, Math.max(1, bottom - top));
                  });
                  ctx.restore();
                });
              }
            };
          }
        }];
      }
    };
  }

  function addVolumeProfileOverlay(daily) {
    if (!lwcCandleSeries || vpPrimitive || !daily) return;
    if (typeof lwcCandleSeries.attachPrimitive !== 'function') return;
    var profile = computeVolumeProfile(daily);
    if (!profile) return;
    try {
      var primitive = createVolumeProfilePrimitive(profile);
      lwcCandleSeries.attachPrimitive(primitive);
      vpPrimitive = { series: lwcCandleSeries, primitive: primitive };
    } catch (e) { /* primitive 렌더링 실패해도 캔들/이평선은 이미 그려져 있음 */ }
  }

  function removeVolumeProfileOverlay() {
    if (vpPrimitive) {
      try { vpPrimitive.series.detachPrimitive(vpPrimitive.primitive); } catch (e) { /* 무시 */ }
    }
    vpPrimitive = null;
  }

  function wireVolumeProfileToggle(box, chartData) {
    var toggle = box.querySelector('#ffVolumeProfileToggle');
    var legend = box.querySelector('.ff-vp-legend');
    if (!toggle) return;
    toggle.addEventListener('change', function () {
      vpEnabled = toggle.checked;
      if (legend) legend.hidden = !vpEnabled;
      if (vpEnabled) addVolumeProfileOverlay(chartData && chartData.daily); else removeVolumeProfileOverlay();
    });
  }

  // ---- 보조지표: RSI(14) / 볼린저밴드(20,2) / 거래대금 배수 - 전부 이미 받아온 chartData.daily
  // (종가·거래량)로 프론트에서 계산한다. 서버(GAS/VM) 변경이나 새 데이터소스가 필요 없다.

  // Wilder's smoothing(표준 RSI 공식) - 최초 period개는 단순평균, 이후는 지수 가중 이동평균.
  function computeRSI(daily, period) {
    period = period || 14;
    var closes = daily.map(function (d) { return d.close; });
    var rsi = new Array(closes.length).fill(null);
    if (closes.length <= period) return rsi;

    var gains = 0, losses = 0;
    for (var i = 1; i <= period; i++) {
      var diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    var avgGain = gains / period, avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (var j = period + 1; j < closes.length; j++) {
      var d = closes[j] - closes[j - 1];
      var gain = d > 0 ? d : 0, loss = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[j] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
  }

  // 중심선(SMA20)은 이미 화면의 20일 이동평균선과 같은 값이라 중복 표시하지 않고 상/하단
  // 밴드만 계산한다(캔들차트에 선이 너무 많아지는 것도 방지).
  function computeBollinger(daily, period, mult) {
    period = period || 20; mult = mult || 2;
    var closes = daily.map(function (d) { return d.close; });
    var upper = new Array(closes.length).fill(null);
    var lower = new Array(closes.length).fill(null);
    for (var i = period - 1; i < closes.length; i++) {
      var slice = closes.slice(i - period + 1, i + 1);
      var mean = slice.reduce(function (a, b) { return a + b; }, 0) / period;
      var variance = slice.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / period;
      var sd = Math.sqrt(variance);
      upper[i] = mean + mult * sd;
      lower[i] = mean - mult * sd;
    }
    return { upper: upper, lower: lower };
  }

  // 오늘 거래대금(종가×거래량 추정) ÷ 최근 20일(오늘 제외) 평균 거래대금
  function computeVolumeMultiple(daily) {
    if (!daily || daily.length < 21) return null;
    var today = daily[daily.length - 1];
    if (!today.volume) return null;
    var todayAmt = today.close * today.volume;
    var win = daily.slice(daily.length - 21, daily.length - 1);
    var avgAmt = win.reduce(function (s, d) { return s + d.close * d.volume; }, 0) / win.length;
    if (!avgAmt) return null;
    return { today: todayAmt, avg20: avgAmt, multiple: todayAmt / avgAmt };
  }

  // 거래량(거래대금 배수) 점수 - 2026-07-22 신설, 15점 만점.
  // 단순히 "거래량이 많을수록 고득점"으로 채점하지 않는다 - 거래 급증은 방향과 같이 봐야
  // 의미가 있고(급증+상승=강한 확인, 급증+하락=분산·투매 경고), 방향 정보 없는 거래량 단독
  // 수치는 매수 신호로 오독되기 쉽다. scripts/cloud-vm/pattern_detect.py의
  // compute_volume_score와 동일 공식으로 유지할 것(기술적 점수 전체가 daily_scan 배치와
  // 어긋나면 안 됨).
  function computeVolumeScore(daily) {
    var vm = computeVolumeMultiple(daily);
    if (!vm) return { score: 0, label: '데이터 부족' };
    var n = daily.length;
    var last = daily[n - 1], prev = daily[n - 2];
    var changePct = (prev && prev.close) ? (last.close - prev.close) / prev.close * 100 : 0;
    var mult = vm.multiple;
    var score, label;
    if (mult >= 2) {
      if (changePct > 0.3) { score = 15; label = '거래 급증 + 상승(강한 확인)'; }
      else if (changePct < -0.3) { score = 0; label = '거래 급증 + 하락(분산 경고)'; }
      else { score = 8; label = '거래 급증(방향 불분명)'; }
    } else if (mult >= 1.3) {
      if (changePct > 0.3) { score = 11; label = '거래 증가 + 상승'; }
      else if (changePct < -0.3) { score = 4; label = '거래 증가 + 하락'; }
      else { score = 7; label = '거래 다소 증가'; }
    } else if (mult >= 0.7) {
      score = 7; label = '평이한 거래량';
    } else {
      score = 5; label = '거래 부진';
    }
    return { score: score, label: label + ' (' + mult.toFixed(1) + '배)' };
  }

  function volumeMultipleText(vm) {
    if (!vm) return '거래대금 데이터가 부족합니다.';
    return '오늘 거래대금이 20일 평균 대비 ' + vm.multiple.toFixed(1) + '배입니다.';
  }

  function rsiInterpText(daily) {
    var rsi = computeRSI(daily, 14);
    var last = null;
    for (var i = rsi.length - 1; i >= 0; i--) { if (rsi[i] != null) { last = rsi[i]; break; } }
    if (last == null) return 'RSI 데이터가 부족합니다.';
    var label = last >= 70 ? '과매수' : last <= 30 ? '과매도' : '중립';
    return 'RSI(14) ' + last.toFixed(1) + '로 ' + label + ' 구간입니다.';
  }

  // 요약 패널 "볼린저밴드" 행 - 종가가 상단/하단 밴드에 얼마나 붙어있는지를 한 단어로 표현.
  function bollingerInterpText(daily) {
    if (!daily || daily.length < 20) return '데이터 부족';
    var boll = computeBollinger(daily, 20, 2);
    var i = daily.length - 1;
    var close = daily[i].close;
    var upper = boll.upper[i], lower = boll.lower[i];
    if (upper == null || lower == null) return '데이터 부족';
    if (close >= upper) return '상단 돌파';
    if (close <= lower) return '하단 이탈';
    var pos = (close - lower) / (upper - lower);
    if (pos >= 0.8) return '상단 근접';
    if (pos <= 0.2) return '하단 근접';
    return '중앙권';
  }

  // RSI(14) 미니차트 - buildRatioChart와 동일한 SVG 패턴(외부 라이브러리 없음), 0~100 고정 축 +
  // 30/70 기준선. 2026-07-22: 기술적 점수표 참고행으로 통합했다가 사용자 요청으로 원복.
  // RSI가 기준선을 넘는(mode='above', 70 과매수) 또는 못 미치는(mode='below', 30 과매도)
  // 구간만 기준선과 RSI 곡선 사이를 채운 폴리곤으로 만든다(구간 경계는 선형보간으로 기준선
  // 교차 지점을 정확히 잡아 삐뚤빼뚤한 계단 없이 매끄럽게 이어짐).
  function buildRsiThresholdFill(pts, x, y, threshold, mode) {
    var yT = y(threshold);
    var isAbove = mode === 'above';
    var out = '';
    for (var i = 0; i < pts.length - 1; i++) {
      var v0 = pts[i].v, v1 = pts[i + 1].v;
      var bothInside = isAbove ? (v0 <= threshold && v1 <= threshold) : (v0 >= threshold && v1 >= threshold);
      if (bothInside) continue;
      var x0 = x(i), x1 = x(i + 1);
      var startX = x0, startY = y(v0);
      var endX = x1, endY = y(v1);
      var clip0 = isAbove ? v0 < threshold : v0 > threshold;
      var clip1 = isAbove ? v1 < threshold : v1 > threshold;
      if (clip0) {
        var t0 = (threshold - v0) / (v1 - v0);
        startX = x0 + t0 * (x1 - x0);
        startY = yT;
      }
      if (clip1) {
        var t1 = (threshold - v0) / (v1 - v0);
        endX = x0 + t1 * (x1 - x0);
        endY = yT;
      }
      out += '<polygon class="ff-rsi-fill ff-rsi-fill-' + mode + '" points="'
        + startX.toFixed(1) + ',' + yT.toFixed(1) + ' '
        + startX.toFixed(1) + ',' + startY.toFixed(1) + ' '
        + endX.toFixed(1) + ',' + endY.toFixed(1) + ' '
        + endX.toFixed(1) + ',' + yT.toFixed(1) + '"/>';
    }
    return out;
  }

  function buildRsiSection(daily) {
    var rsi = computeRSI(daily, 14);
    var pts = [];
    for (var i = 0; i < daily.length; i++) {
      if (rsi[i] != null) pts.push({ date: daily[i].date, v: rsi[i] });
    }
    if (pts.length < 2) return '';

    var n = pts.length;
    var iw = CHART_W - PAD.l - PAD.r;
    var ih = RATIO_H - PAD.t - PAD.b;
    function x(i) { return PAD.l + (i / (n - 1)) * iw; }
    function y(v) { return PAD.t + (1 - v / 100) * ih; }

    var linePts = pts.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ');

    var svg = '<svg class="ff-svg" viewBox="0 0 ' + CHART_W + ' ' + RATIO_H + '" role="img" aria-label="RSI(14) 추이">';
    svg += '<line class="ff-grid ff-rsi-band" x1="' + PAD.l + '" y1="' + y(70).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(70).toFixed(1) + '"/>';
    svg += '<line class="ff-grid ff-rsi-band" x1="' + PAD.l + '" y1="' + y(30).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(30).toFixed(1) + '"/>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(70) + 4).toFixed(1) + '" text-anchor="end">70</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(30) + 4).toFixed(1) + '" text-anchor="end">30</text>';
    svg += rsiAxisLabels(pts, x, RATIO_H - 8);
    svg += buildRsiThresholdFill(pts, x, y, 70, 'above');
    svg += buildRsiThresholdFill(pts, x, y, 30, 'below');
    svg += '<polyline class="ff-line-rsi" points="' + linePts + '"/>';
    svg += '</svg>';

    var last = pts[n - 1].v;
    var label = last >= 70 ? '과매수' : last <= 30 ? '과매도' : '중립';
    var cls = last >= 70 ? 'ff-sell' : last <= 30 ? 'ff-buy' : 'ff-flat';

    return '<div class="ff-chart-title">RSI(14)</div>'
      + '<div class="ff-chart ff-chart-rsi">' + svg
      + '<div class="ff-legend"><span class="ff-legend-item"><i class="ff-dot" style="background:#666"></i>RSI(14) <span class="' + cls + '">' + last.toFixed(1) + ' · ' + label + '</span></span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#d24f45"></i>70 이상(과매수)</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#1261c4"></i>30 이하(과매도)</span></div>'
      + '</div>';
  }

  // 차트 밑에 붙는 설명 + 기술적 점수 채점표(①이평선 25 ②지지선 15 ③저항선 15 ④일목균형표 30
  // ⑤거래량 15 = 100). RSI는 점수에 안 넣고 별도 미니차트(buildRsiSection)로 원복.
  function buildTechBreakdown(t) {
    if (!t) return '';
    var ichi = t.ichimoku;
    var ichiRow = ichi
      ? '<tr><td>④ 일목균형표</td><td>' + escapeHtml(ichi.cloud.label) + ' · ' + escapeHtml(ichi.cross.label) + ' · ' + escapeHtml(ichi.color.label) + '</td><td>' + ichi.score + '/30</td></tr>'
      : '';
    var vol = t.volume;
    var volRow = vol
      ? '<tr><td>⑤ 거래량</td><td>' + escapeHtml(vol.label) + '</td><td>' + vol.score + '/15</td></tr>'
      : '';

    return '<div class="ff-tech">'
      + '<div class="ff-tech-desc">파란 점선=지지선, 빨간 점선=저항선(최근 120영업일 스윙 고점·저점 기준). '
      + '5·20·60·224일 이동평균선이 위에서부터 순서대로 놓이면(정배열) 상승 추세, 반대 순서(역배열)면 하락 추세로 봅니다. '
      + '일목균형표는 구름 위/아래, 전환선-기준선 교차, 구름 색(양운/음운)을 종합한 점수입니다. '
      + '거래량은 20일 평균 거래대금 대비 배수를 가격 방향과 같이 봅니다(거래 급증만으로는 고득점 안 됨 - 급증+상승이라야 고득점, 급증+하락은 분산 경고로 0점).</div>'
      + '<table class="ff-tech-table"><thead><tr><th>구분</th><th>상태</th><th>점수</th></tr></thead><tbody>'
      + '<tr><td>① 이동평균 상태</td><td>' + escapeHtml(t.ma.label) + '</td><td>' + t.ma.score + '/25</td></tr>'
      + '<tr><td>② 지지선</td><td>' + escapeHtml(t.support.label) + '</td><td>' + t.support.score + '/15</td></tr>'
      + '<tr><td>③ 저항선</td><td>' + escapeHtml(t.resistance.label) + '</td><td>' + t.resistance.score + '/15</td></tr>'
      + ichiRow
      + volRow
      + '<tr class="ff-tech-total-row"><td colspan="2">기술적 점수</td><td>' + t.score + '/100</td></tr>'
      + '</tbody></table>'
      + '</div>';
  }

  // CDN에서 라이브러리를 1회만 지연 로드(이미 로드돼 있으면 즉시 resolve)
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

  // 재검색/언마운트 시 이전 차트 인스턴스와 다크모드 감시자를 정리(리스너 누수 방지)
  function destroyLwChart() {
    if (lwcThemeObserver) { lwcThemeObserver.disconnect(); lwcThemeObserver = null; }
    if (lwcChart) {
      try { lwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
      lwcChart = null;
      lwcChartContainer = null;
    }
    lwcMarkers = null;
    movingAverageOverlaySeries = [];
    ichimokuOverlaySeries = []; // chart.remove()가 시리즈까지 다 정리하므로 참조만 비움
    ichimokuCloudPrimitive = null;
    lwcCandleSeries = null;
    vpPrimitive = null;
  }

  // 9bolt 스킨의 html.dark 토글은 새로고침 없이 클래스만 바뀌므로, 캔버스 기반 차트도
  // 같이 갱신되게 색상을 여기 한 곳에서 계산한다(MutationObserver로 재적용).
  function lwcThemeOptions(LWC) {
    var dark = document.documentElement.classList.contains('dark');
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(사용자가 나중에 문서 만들 예정, 아직 미작성).
      layout: {
        background: { color: 'transparent' },
        textColor: dark ? '#aaa' : '#555',
        attributionLogo: false,
        panes: { enableResize: true, separatorColor: dark ? '#3a3a3a' : '#e5e7eb', separatorHoverColor: dark ? '#666' : '#cbd5e1' }
      },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      // scaleMargins: 캔들이 세로로 납작해 보인다는 피드백(2026-07-19)으로 기본 여백(대략
      // 위20%/아래10%)보다 좁혀 캔들이 세로 공간을 더 채우도록 함.
      rightPriceScale: {
        borderColor: dark ? '#3a3a3a' : '#ddd',
        scaleMargins: { top: 0.06, bottom: 0.36 },
        alignLabels: false
      },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd', rightOffset: 6, minBarSpacing: 2, timeVisible: false, secondsVisible: false },
      // 2026-07-28 사용자 리포트: 다크모드에서 차트 위에 안 어울리는 회색 네모(십자선
      // 가격/시각 라벨의 기본 배경색 #4c525e, 라이브러리 기본값이라 다크 팔레트와 무관하게
      // 고정)가 떴음 - 라벨 배경색을 명시적으로 테마에 맞게 지정해서 해결.
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: dark ? '#2a2a2a' : '#555' },
        horzLine: { labelBackgroundColor: dark ? '#2a2a2a' : '#555' }
      }
    };
  }

  function chartDate(value) {
    var raw = String(value || '');
    if (/^\d{8}$/.test(raw)) return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
    var match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function nearestChartDate(value, dates) {
    var target = chartDate(value);
    if (!target) return null;
    if (dates.indexOf(target) !== -1) return target;
    var targetTime = new Date(target + 'T00:00:00').getTime();
    var best = null, bestDistance = Infinity;
    dates.forEach(function (date) {
      var distance = Math.abs(new Date(date + 'T00:00:00').getTime() - targetTime);
      if (distance < bestDistance && distance <= 3 * 86400000) { best = date; bestDistance = distance; }
    });
    return best;
  }

  function buildChartMarkers(daily, chartData) {
    var dates = daily.map(function (d) { return chartDate(d.date); });
    var markerByKey = {};
    function add(value, type, text, color, position, shape) {
      var date = nearestChartDate(value, dates);
      if (!date) return;
      var key = date + ':' + type;
      if (markerByKey[key]) return;
      markerByKey[key] = { time: date, position: position || 'aboveBar', color: color, shape: shape || 'circle', text: text };
    }
    var flowMap = {};
    (chartData.flow || []).forEach(function (row) { flowMap[chartDate(row.date)] = row; });
    for (var k = Math.max(0, daily.length - 60); k < daily.length; k++) {
      var flow = flowMap[chartDate(daily[k].date)];
      if (!flow) continue;
      var net = Math.abs(Number(flow.foreign_net) || 0) + Math.abs(Number(flow.inst_net) || 0);
      if (net > 0 && net >= 200000) add(daily[k].date, 'flow', '수급', '#d946ef', 'belowBar', 'square');
    }
    return Object.keys(markerByKey).map(function (key) { return markerByKey[key]; })
      .sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  }

  // TradingView Lightweight Charts v5 멀티 패널 차트.
  // 0=가격, 1=거래량, 2=외국인·기관 순매수. RSI는 아래 별도 섹션에서 표시한다.
  function renderLwChart(container, chartData) {
    destroyLwChart();
    container.querySelectorAll('.ff-volume-study-label').forEach(function (el) { el.remove(); });
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return; // 로딩 중 다른 종목 재검색되면 중단

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: FCHART_H,
        // crosshair는 lwcThemeOptions()에 있음(mergeOptions가 얕은 병합이라 두 곳에 나눠
        // 쓰면 뒤에 오는 쪽이 통째로 덮어씀 - rightPriceScale과 동일한 이유).
        timeScale: { timeVisible: false, secondsVisible: false, rightOffset: 6, minBarSpacing: 2 },
        localization: { locale: 'ko-KR' },
        layout: { panes: { enableResize: true, separatorColor: '#e5e7eb', separatorHoverColor: '#cbd5e1' } },
        // 2026-07-19: 캔들이 세로로 너무 납작해 보인다는 피드백 - 가격축(오른쪽) 드래그로
        // 직접 세로 확대가 가능하게 함(마우스 휠은 기존처럼 가로/시간축 확대). 위아래 여백은
        // lwcThemeOptions()의 rightPriceScale에 같이 설정(mergeOptions가 얕은 병합이라
        // 여기 쓰면 아래서 borderColor로 덮어써짐 - 두 값을 한 객체에 모아야 함).
        handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
      }, lwcThemeOptions(LWC)));
      lwcChart = chart;
      lwcChartContainer = container;
      chart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.06, bottom: 0.36 },
        alignLabels: false
      });

      var daily = chartData.daily;
      var candleSeries = chart.addSeries(LWC.CandlestickSeries, {
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4',
        priceFormat: {
          type: 'custom',
          minMove: 1,
          formatter: chartPriceFormatter
        }
      });
      candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.36 } });
      candleSeries.setData(daily.map(function (d) {
        return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
      }));
      lwcCandleSeries = candleSeries;

      var levels = chartData.levels || {};
      (levels.support || []).forEach(function (v) {
        candleSeries.createPriceLine({ price: v, color: '#1261c4', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '지지' });
      });
      (levels.resistance || []).forEach(function (v) {
        candleSeries.createPriceLine({ price: v, color: '#d24f45', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '저항' });
      });

      ['ma5', 'ma20', 'ma60', 'ma224'].forEach(function (key) {
        var series = (chartData.ma && chartData.ma[key]) || [];
        if (!series.length) return;
        var color = key === 'ma224' ? ma224Color() : MA_COLORS[key];
        var lineSeries = chart.addSeries(LWC.LineSeries, {
          color: color,
          lineWidth: MA_WIDTHS[key],
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: movingAverageEnabled
        });
        var pts = [];
        daily.forEach(function (d, i) {
          if (series[i] == null) return;
          pts.push({ time: d.date, value: series[i] });
        });
        lineSeries.setData(pts);
        movingAverageOverlaySeries.push(lineSeries);
      });

      if (ichimokuEnabled) addIchimokuOverlay(daily);

      // 실시간 시세와 같은 하단 30% 거래량 영역. 전체 localization formatter를 쓰지
      // 않고 시리즈별 포맷을 적용해야 우측 값이 가격처럼 보이지 않고 K/M/B로 축약된다.
      var volumeSeries = chart.addSeries(LWC.HistogramSeries, {
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false
      }, 1);
      volumeSeries.setData(daily.map(function (d) {
        return {
          time: d.date,
          value: Math.max(0, Number(d.volume) || 0),
          color: d.close >= d.open ? 'rgba(210,79,69,0.5)' : 'rgba(18,97,196,0.5)'
        };
      }));

      var volumeMaPoints = movingAverageChartPoints(daily, 'volume', 20);
      var volumeMaSeries = chart.addSeries(LWC.LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false
      }, 1);
      volumeMaSeries.setData(volumeMaPoints.map(function (point) {
        return { time: point.time, value: Math.max(0, Number(point.value) || 0) };
      }));

      var flowMap = {};
      (chartData.flow || []).forEach(function (row) { flowMap[chartDate(row.date)] = row; });
      var foreignSeries = chart.addSeries(LWC.LineSeries, { color: '#8b5cf6', lineWidth: 2, lastValueVisible: true, priceLineVisible: false, title: '외국인' }, 2);
      var institutionSeries = chart.addSeries(LWC.LineSeries, { color: '#0ca678', lineWidth: 2, lastValueVisible: true, priceLineVisible: false, title: '기관' }, 2);
      foreignSeries.setData(daily.map(function (d) { var r = flowMap[chartDate(d.date)]; return r && r.foreign_net != null ? { time: d.date, value: Number(r.foreign_net) } : null; }).filter(Boolean));
      institutionSeries.setData(daily.map(function (d) { var r = flowMap[chartDate(d.date)]; return r && r.inst_net != null ? { time: d.date, value: Number(r.inst_net) } : null; }).filter(Boolean));

      var markers = buildChartMarkers(daily, chartData);
      if (markers.length && typeof LWC.createSeriesMarkers === 'function') {
        lwcMarkers = LWC.createSeriesMarkers(candleSeries, markers);
      }

      var paneLabels = document.createElement('div');
      paneLabels.className = 'ff-lwc-pane-labels';
      paneLabels.innerHTML = '<span>거래량</span><span>외국인·기관 순매수</span>';
      container.appendChild(paneLabels);

      // 각 패널을 초기 비율로 나누되 layout.panes.enableResize=true로 사용자가 구분선을 드래그할 수 있다.
      var panes = chart.panes();
      var totalHeight = container.clientHeight || FCHART_H;
      var subHeight = Math.max(48, Math.round(totalHeight * 0.105));
      var priceHeight = Math.max(220, totalHeight - subHeight * (panes.length - 1));
      if (panes[0] && panes[0].setHeight) panes[0].setHeight(priceHeight);
      panes.slice(1).forEach(function (pane) { if (pane.setHeight) pane.setHeight(subHeight); });
      paneLabels.querySelectorAll('span').forEach(function (label, index) {
        label.style.top = (priceHeight + subHeight * index) + 'px';
      });

      var latest = daily[daily.length - 1] || {};
      var latestVolumeMa = volumeMaPoints.length ? volumeMaPoints[volumeMaPoints.length - 1].value : null;
      var volumeLegend = document.createElement('div');
      volumeLegend.className = 'ff-volume-study-label';
      volumeLegend.innerHTML = '<span>거래량 (20)</span>'
        + '<b>' + compactChartVolume(latest.volume) + '</b>'
        + (latestVolumeMa == null ? '' : '<b class="ff-volume-ma-value">' + compactChartVolume(latestVolumeMa) + '</b>');
      container.appendChild(volumeLegend);

      // 2026-07-22: 볼린저밴드·일목균형표 선은 캔들과 겹쳐 차트가 복잡해진다는 피드백으로
      // 차트 시각화에서 제거(계산 자체는 buildTechBreakdown의 기술적 점수·참고지표에서
      // 계속 쓰임 - computeBollinger/computeIchimoku 함수는 그대로 둠).

      // 2026-07-19: fitContent()가 전체 히스토리(최대 ~600~700봉)를 억지로 다 우겨넣어서
      // 캔들 하나가 1~2px로 뭉개져 실선처럼 보이는 문제가 스크린샷으로 제보됨(이동평균
      // 보조선만 두껍게 보이고 캔들 몸통은 안 보임) - 기본은 최근 90봉만
      // 보여주고(그래야 캔들이 눈에 띄게 넓어짐), 데이터가 그보다 적을 때만 fitContent로
      // 폴백한다. 사용자는 마우스 휠/드래그로 왼쪽(과거)까지 자유롭게 스크롤할 수 있다.
      var DEFAULT_VISIBLE_BARS = 90;
      if (daily.length > DEFAULT_VISIBLE_BARS) {
        chart.timeScale().setVisibleLogicalRange({
          from: daily.length - DEFAULT_VISIBLE_BARS,
          to: daily.length + 1
        });
      } else {
        chart.timeScale().fitContent();
      }

      lwcThemeObserver = new MutationObserver(function () {
        chart.applyOptions(lwcThemeOptions(LWC));
      });
      lwcThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }).catch(function () {
      container.innerHTML = '<div class="ff-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  function fmtAbsShares(v) { return v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString() + '주'; }
  function fmtWon(v) { return v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString() + '원'; }
  // 시뮬레이션 차트 Y축처럼 좁은 여백(PAD.l)에 넣는 금액용 - fmtWon은 전체 자릿수라
  // 억대 투자금에서 글자가 축 여백을 넘어 차트 밖으로 삐져나온다(2026-08-13 스크린샷 제보).
  function fmtCompactWon(v) {
    if (v == null || isNaN(v)) return '-';
    var n = Math.round(v);
    var abs = Math.abs(n);
    if (abs >= 1e8) return (n / 1e8).toFixed(1) + '억원';
    if (abs >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만원';
    return n.toLocaleString('ko-KR') + '원';
  }
  // 캔들차트 축·지지/저항선·크로스헤어에 표시되는 가격에 천단위 콤마(원화는 소수점 없음)
  function chartPriceFormatter(v) { return v == null || isNaN(v) ? '' : Math.round(v).toLocaleString(); }
  function movingAverageChartPoints(bars, field, period) {
    var sum = 0;
    var points = [];
    bars.forEach(function (bar, i) {
      sum += Number(bar[field]) || 0;
      if (i >= period) sum -= Number(bars[i - period][field]) || 0;
      if (i >= period - 1) points.push({ time: bar.date, value: sum / period });
    });
    return points;
  }
  function compactChartVolume(value) {
    var n = Number(value) || 0;
    function scaled(divisor, suffix) {
      var v = n / divisor;
      var digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      return v.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') + suffix;
    }
    if (Math.abs(n) >= 1000000000) return scaled(1000000000, 'B');
    if (Math.abs(n) >= 1000000) return scaled(1000000, 'M');
    if (Math.abs(n) >= 1000) return scaled(1000, 'K');
    return Math.round(n).toLocaleString('ko-KR');
  }
  function fmtPct(v) { return v == null || isNaN(v) ? '-' : v.toFixed(2) + '%'; }
  function fmtSignedPct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function fmtSignedWon(n) {
    if (n == null || isNaN(n)) return '-';
    var eok = n / 100; // penfnd_etc는 백만원 단위로 내려오므로 억원 = /100
    return (eok >= 0 ? '+' : '') + eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억';
  }

  // ---- 차트 (vanilla SVG - 버블차트와 스택 통일, 외부 라이브러리 없음) ----

  // y축 범위 계산 - 차트 생성과 호버 좌표 역산이 같은 스케일을 써야 해서 분리
  function netDomain(asc) {
    var vals = [];
    // 개인 순매매가 없는 폴백 응답도 다른 선의 스케일 계산을 깨뜨리지 않는다.
    asc.forEach(function (d) {
      [d.foreign_net, d.inst_net, d.ind_net].forEach(function (v) {
        var n = finiteNumber(v);
        if (n != null) vals.push(n);
      });
    });
    var max = Math.max.apply(null, vals.concat([0]));
    var min = Math.min.apply(null, vals.concat([0]));
    var span = (max - min) || 1;
    return { min: min - span * 0.08, max: max + span * 0.08 };
  }

  function ratioDomain(asc) {
    var vals = asc.map(function (d) { return d.foreign_ratio; });
    var max = Math.max.apply(null, vals);
    var min = Math.min.apply(null, vals);
    var span = (max - min) || 0.5;
    return { min: min - span * 0.15, max: max + span * 0.15 };
  }

  // 순매매량 라인차트: 외국인/기관 2개 시리즈, 0선 기준
  function buildNetChart(daily) {
    var asc = daily.slice().reverse(); // 왼쪽=과거, 오른쪽=최신
    var n = asc.length;
    if (n < 2) return '';

    var dom = netDomain(asc);
    var min = dom.min;
    var max = dom.max;

    var iw = CHART_W - PAD.l - PAD.r;
    var ih = CHART_H - PAD.t - PAD.b;
    function x(i) { return PAD.l + (i / (n - 1)) * iw; }
    function y(v) { return PAD.t + (1 - (v - min) / (max - min)) * ih; }

    function points(field) {
      return asc.map(function (d, i) {
        var value = finiteNumber(d[field]);
        return x(i).toFixed(1) + ',' + y(value == null ? 0 : value).toFixed(1);
      }).join(' ');
    }
    var hasIndividual = asc.some(function (d) { return finiteNumber(d.ind_net) != null; });

    var svg = '<svg class="ff-svg" viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img" aria-label="외국인 기관 순매매량 추이">';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(max).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(max).toFixed(1) + '"/>';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(min).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(min).toFixed(1) + '"/>';
    svg += '<line class="ff-zero" x1="' + PAD.l + '" y1="' + y(0).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(0).toFixed(1) + '"/>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + fmtCompact(max) + '</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(0) + 4).toFixed(1) + '" text-anchor="end">0</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + fmtCompact(min) + '</text>';
    svg += xAxisLabels(asc, x, CHART_H - 8);
    if (hasIndividual) svg += '<polyline class="ff-line-ind" points="' + points('ind_net') + '"/>';
    svg += '<polyline class="ff-line-foreign" points="' + points('foreign_net') + '"/>';
    svg += '<polyline class="ff-line-inst" points="' + points('inst_net') + '"/>';
    svg += hoverMarkup(CHART_H, ['ind', 'foreign', 'inst']);
    svg += '</svg>';

    return '<div class="ff-chart ff-chart-net">' + svg
      + '<div class="ff-tt" hidden></div>'
      + '<div class="ff-legend">'
      + '<span class="ff-legend-item"><i class="ff-dot ff-dot-ind"></i>개인</span>'
      + '<span class="ff-legend-item"><i class="ff-dot ff-dot-foreign"></i>외국인</span>'
      + '<span class="ff-legend-item"><i class="ff-dot ff-dot-inst"></i>기관</span>'
      + '</div></div>';
  }

  // 외국인 보유율 미니차트
  // 2026-07-20: foreign_ratio가 전부 null인 경우(ka10008 소스 일시 장애 등)
  // last.toFixed()에서 TypeError가 나서 위젯 전체(수급 표까지)가 "불러오지 못했어요"로
  // 죽는 버그 발견(fetch 자체는 200으로 성공했는데 렌더링 중 예외가 나서 Promise.all
  // catch로 흡수됨) - 데이터가 아예 없을 땐 차트를 그리지 않고 안내문구만 보여준다.
  function buildRatioChart(daily) {
    var asc = daily.slice().reverse();
    var n = asc.length;
    if (n < 2) return '';
    if (!asc.some(function (d) { return d.foreign_ratio != null; })) {
      return '<div class="ff-chart-empty">외국인 보유율 데이터를 일시적으로 가져오지 못했어요.</div>';
    }

    var dom = ratioDomain(asc);
    var min = dom.min;
    var max = dom.max;

    var iw = CHART_W - PAD.l - PAD.r;
    var ih = RATIO_H - PAD.t - PAD.b;
    function x(i) { return PAD.l + (i / (n - 1)) * iw; }
    function y(v) { return PAD.t + (1 - (v - min) / (max - min)) * ih; }

    var pts = asc.map(function (d, i) {
      return x(i).toFixed(1) + ',' + y(d.foreign_ratio).toFixed(1);
    }).join(' ');

    var svg = '<svg class="ff-svg" viewBox="0 0 ' + CHART_W + ' ' + RATIO_H + '" role="img" aria-label="외국인 보유율 추이">';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(max).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(max).toFixed(1) + '"/>';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(min).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(min).toFixed(1) + '"/>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + max.toFixed(1) + '%</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + min.toFixed(1) + '%</text>';
    svg += xAxisLabels(asc, x, RATIO_H - 8);
    svg += '<polyline class="ff-line-ratio" points="' + pts + '"/>';
    svg += hoverMarkup(RATIO_H, ['ratio']);
    svg += '</svg>';

    // 전체가 null은 아니어도(위 가드 통과) 가장 최근 날짜 하나만 null인 예외적인 경우를
    // 대비해 last도 개별적으로 null 방어(뒤에서부터 가장 최근 실측치를 찾는다).
    var last = null;
    for (var li = n - 1; li >= 0; li--) {
      if (asc[li].foreign_ratio != null) { last = asc[li].foreign_ratio; break; }
    }
    return '<div class="ff-chart ff-chart-ratio">' + svg
      + '<div class="ff-tt" hidden></div>'
      + '<div class="ff-legend"><span class="ff-legend-item"><i class="ff-dot ff-dot-ratio"></i>보유율 (현재 ' + (last == null ? '-' : last.toFixed(2) + '%') + ')</span></div>'
      + '</div>';
  }

  // ---- 호버 툴팁 (세로 가이드선 + 시리즈별 점 + 날짜/수치) ----

  function hoverMarkup(h, seriesKeys) {
    var out = '<line class="ff-hover-line" x1="0" x2="0" y1="' + PAD.t + '" y2="' + (h - PAD.b) + '" visibility="hidden"/>';
    seriesKeys.forEach(function (key) {
      out += '<circle class="ff-hover-dot ff-hover-dot-' + key + '" r="4" visibility="hidden"/>';
    });
    return out;
  }

  function wireChartHover(chartEl, daily, type) {
    if (!chartEl) return;
    var svg = chartEl.querySelector('svg.ff-svg');
    var tt = chartEl.querySelector('.ff-tt');
    var line = chartEl.querySelector('.ff-hover-line');
    if (!svg || !tt || !line) return;

    var asc = daily.slice().reverse();
    var n = asc.length;
    if (n < 2) return;

    var H = type === 'net' ? CHART_H : RATIO_H;
    var iw = CHART_W - PAD.l - PAD.r;
    var ih = H - PAD.t - PAD.b;
    var dom = type === 'net' ? netDomain(asc) : ratioDomain(asc);

    function xAt(i) { return PAD.l + (i / (n - 1)) * iw; }
    function yAt(v) { return PAD.t + (1 - (v - dom.min) / (dom.max - dom.min)) * ih; }

    var dots = {};
    ['foreign', 'inst', 'ind', 'ratio'].forEach(function (key) {
      var el = chartEl.querySelector('.ff-hover-dot-' + key);
      if (el) dots[key] = el;
    });

    // 2026-08-21 코드 감사: mousemove마다 getBoundingClientRect()를 2번씩 강제로 읽어
    // 매번 동기 리플로우를 유발했다 - 차트 폭은 CHART_W 고정값 기반 변환이라, 호버 시작
    // (mouseenter/최초 클릭) 시점에 한 번만 읽어 캐시하고 재사용한다.
    var hoverRect = null, hoverChartRect = null;
    function refreshHoverRects() {
      hoverRect = svg.getBoundingClientRect();
      hoverChartRect = chartEl.getBoundingClientRect();
    }

    function show(evt) {
      var rect = hoverRect || svg.getBoundingClientRect();
      if (!rect.width) return;
      var vx = (evt.clientX - rect.left) / rect.width * CHART_W;
      var i = Math.round((vx - PAD.l) / iw * (n - 1));
      if (i < 0) i = 0;
      if (i > n - 1) i = n - 1;
      var d = asc[i];
      var X = xAt(i);

      line.setAttribute('x1', X);
      line.setAttribute('x2', X);
      line.setAttribute('visibility', 'visible');

      if (type === 'net') {
        if (dots.foreign) {
          dots.foreign.setAttribute('cx', X);
          dots.foreign.setAttribute('cy', yAt(d.foreign_net));
          dots.foreign.setAttribute('visibility', 'visible');
        }
        if (dots.inst) {
          dots.inst.setAttribute('cx', X);
          dots.inst.setAttribute('cy', yAt(d.inst_net));
          dots.inst.setAttribute('visibility', 'visible');
        }
        if (dots.ind) {
          var individual = finiteNumber(d.ind_net);
          if (individual == null) {
            dots.ind.setAttribute('visibility', 'hidden');
          } else {
            dots.ind.setAttribute('cx', X);
            dots.ind.setAttribute('cy', yAt(individual));
            dots.ind.setAttribute('visibility', 'visible');
          }
        }
        tt.innerHTML = '<div class="ff-tt-date">' + escapeHtml(d.date) + '</div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-ind"></i>개인 <b class="' + signClass(d.ind_net) + '">' + fmtShares(d.ind_net) + '</b></div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-foreign"></i>외국인 <b class="' + signClass(d.foreign_net) + '">' + fmtShares(d.foreign_net) + '</b></div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-inst"></i>기관 <b class="' + signClass(d.inst_net) + '">' + fmtShares(d.inst_net) + '</b></div>'
          + '<div class="ff-tt-row ff-tt-sub">종가 ' + Number(d.close).toLocaleString() + ' (' + (d.change_pct >= 0 ? '+' : '') + d.change_pct.toFixed(2) + '%)</div>';
      } else {
        if (dots.ratio) {
          dots.ratio.setAttribute('cx', X);
          dots.ratio.setAttribute('cy', yAt(d.foreign_ratio));
          dots.ratio.setAttribute('visibility', 'visible');
        }
        tt.innerHTML = '<div class="ff-tt-date">' + escapeHtml(d.date) + '</div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-ratio"></i>보유율 <b>' + d.foreign_ratio.toFixed(2) + '%</b></div>'
          + '<div class="ff-tt-row ff-tt-sub">보유주수 ' + Number(d.foreign_shares).toLocaleString() + '주</div>';
      }
      tt.hidden = false;

      // 툴팁 픽셀 위치: 가이드선 오른쪽에 붙이되, 오른쪽 끝에선 왼쪽으로 뒤집는다
      var chartRect = hoverChartRect || chartEl.getBoundingClientRect();
      var lineLeft = (rect.left - chartRect.left) + (X / CHART_W) * rect.width;
      var ttW = tt.offsetWidth || 150;
      var left = lineLeft + 10;
      if (left + ttW > chartRect.width - 4) left = lineLeft - ttW - 10;
      tt.style.left = Math.max(left, 4) + 'px';
      tt.style.top = ((rect.top - chartRect.top) + 8) + 'px';
    }

    function hide() {
      tt.hidden = true;
      line.setAttribute('visibility', 'hidden');
      Object.keys(dots).forEach(function (k) { dots[k].setAttribute('visibility', 'hidden'); });
    }

    // 2026-08-21 코드 감사: rAF/쓰로틀 없이 mousemove에 직접 바인딩돼 있어, 마우스가
    // 빠르게 움직이면(초당 수십 회) 매번 동기 리플로우가 발생했다 - requestAnimationFrame으로
    // 좌표 갱신을 프레임당 최대 1회로 코얼레싱한다.
    var hoverRafPending = false, hoverLastEvt = null;
    function onHoverMove(evt) {
      hoverLastEvt = evt;
      if (hoverRafPending) return;
      hoverRafPending = true;
      requestAnimationFrame(function () {
        hoverRafPending = false;
        show(hoverLastEvt);
      });
    }

    svg.addEventListener('mouseenter', refreshHoverRects);
    svg.addEventListener('mousemove', onHoverMove);
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('click', function (evt) { refreshHoverRects(); show(evt); }); // 모바일 탭 대응
  }

  // x축 날짜 레이블: 처음/중간/끝 3개
  function xAxisLabels(asc, x, textY) {
    var idxs = [0, Math.floor((asc.length - 1) / 2), asc.length - 1];
    var out = '';
    idxs.forEach(function (i, k) {
      var anchor = k === 0 ? 'start' : (k === 2 ? 'end' : 'middle');
      out += '<text class="ff-axis" x="' + x(i).toFixed(1) + '" y="' + textY + '" text-anchor="' + anchor + '">'
        + shortDate(asc[i].date) + '</text>';
    });
    return out;
  }

  function shortDate(iso) {
    // "2026-07-10" -> "07/10"
    return iso.slice(5, 7) + '/' + iso.slice(8, 10);
  }

  // RSI 차트는 chartData.daily(최대 500영업일, 약 2년치)를 그대로 쓰기 때문에 순매매/보유율
  // 차트(40일 안팎)용 shortDate(MM/DD, 연도 생략)를 그대로 쓰면 다른 해의 같은 날짜가 뒤섞여
  // 보인다 - 연도 2자리를 포함한 별도 포맷을 쓴다.
  function shortDateWithYear(iso) {
    // "2026-07-10" -> "26/07/10"
    return iso.slice(2, 4) + '/' + iso.slice(5, 7) + '/' + iso.slice(8, 10);
  }

  function rsiAxisLabels(pts, x, textY) {
    var idxs = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    var out = '';
    idxs.forEach(function (i, k) {
      var anchor = k === 0 ? 'start' : (k === 2 ? 'end' : 'middle');
      out += '<text class="ff-axis" x="' + x(i).toFixed(1) + '" y="' + textY + '" text-anchor="' + anchor + '">'
        + shortDateWithYear(pts[i].date) + '</text>';
    });
    return out;
  }

  // ---- 포맷터 ----

  function signClass(v) {
    var n = finiteNumber(v);
    if (n == null) return 'ff-flat';
    if (n > 0) return 'ff-buy';
    if (n < 0) return 'ff-sell';
    return 'ff-flat';
  }

  function fmtShares(v) {
    var n = finiteNumber(v);
    if (n == null) return '-';
    var sign = n > 0 ? '+' : '';
    return sign + Math.round(n).toLocaleString();
  }

  // 축 레이블용 축약: 12,880,455 -> "+1,288만"
  function fmtCompact(v) {
    var abs = Math.abs(v);
    var sign = v > 0 ? '+' : v < 0 ? '-' : '';
    if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + '억';
    if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만';
    return sign + Math.round(abs).toLocaleString();
  }

  function fmtKrw(v) {
    var n = finiteNumber(v);
    if (n == null) return '-';
    var abs = Math.abs(n);
    var sign = n > 0 ? '+' : n < 0 ? '-' : '';
    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + '조원';
    if (abs >= 1e8) return sign + Math.round(abs / 1e8).toLocaleString() + '억원';
    if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만원';
    return sign + Math.round(abs).toLocaleString() + '원';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  var ForeignFlow = {
    init: init,
    fetchFlow: fetchFlow,
    search: search,
    // fetchJson을 네임스페이스 경유로 호출(loadSignalData)해서 테스트 페이지가 fetchFlow처럼
    // ForeignFlow.fetchJson을 몽키패치해 mock 데이터로 검증할 수 있게 한다(js/invest-signal.js와
    // 동일한 관례).
    fetchJson: fetchJson,
    fetchNewsMomentum: fetchNewsMomentum,
    // js/stock-news.js "종목분석 요약" 패널 전용 경량 API(위 정의부 주석 참고) - #foreign-flow
    // 마운트 없이도(즉 이 스크립트를 로드만 해도) 호출 가능.
    fetchAnalysisSummary: fetchAnalysisSummary
  };
  global.ForeignFlow = ForeignFlow;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
