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
  // 224일선은 다른 이평선과 구분되는 장기 추세선이라 검은색+굵게(사용자 요청, 2026-07-22) -
  // 다만 순검은색은 다크모드 차트 배경(#222)에서 안 보이므로 테마에 따라 흰색으로 바꿔준다.
  function ma224Color() {
    return document.documentElement.classList.contains('dark') ? '#f1f3f5' : '#000000';
  }
  // 실시간 시세 차트와 동일하게 양운은 상승색(빨강), 음운은 하락색(파랑)으로 통일한다.
  var ICHIMOKU_COLORS = { senkouA: '#d24f45', senkouB: '#1261c4' };

  // TradingView Lightweight Charts(오픈소스, CDN 지연 로드) - 가격 캔들차트 렌더링 엔진.
  // 손으로 그리던 SVG 캔들차트를 대체 - 확대/축소·패닝·크로스헤어를 라이브러리가 제공.
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var lwcLoadPromise = null;
  var lwcChart = null;         // 현재 렌더된 차트 인스턴스(재검색 시 정리용)
  var lwcThemeObserver = null; // html.dark 토글에 맞춰 차트 색상 실시간 갱신

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

  // ---- 2026-07-20(3차): 작업지시서 최종본 - 가중치 탭(6개) 대신 단일 종목 리스트 + 우측
  // 요약 패널(2열 레이아웃)로 교체(사용자 확인: 탭 제거, 단일 리스트). 카운트 칩 클릭 시 그
  // 등급 종목만 리스트에 필터링되고, 아무 등급도 안 골랐으면 전체 등급을 매수쪽부터 이어붙인
  // 기본 리스트(종합점수순에 근접)를 보여준다. 데이터는 기존과 동일 GAS(?investSignal=1)를
  // 그대로 재사용. 별도 페이지(js/invest-signal.js)는 이 페이지로 리다이렉트만 함.
  // cls: 필터탭 배경색(작업지시서 3.2 - 적극매수·매수=빨강/보유=주황/비중축소·매도=파랑)
  var GRADE_META = [
    { key: '적극 매수', bucketKey: 'activeBuy', emoji: '🟢', label: '적극매수', cls: 'grade-buy' },
    { key: '매수 우위', bucketKey: 'buy', emoji: '🟢', label: '매수', cls: 'grade-buy' },
    { key: '보유', bucketKey: 'hold', emoji: '🟡', label: '보유', cls: 'grade-hold' },
    { key: '비중축소', bucketKey: 'reduce', emoji: '🟠', label: '비중축소', cls: 'grade-sell' },
    { key: '매도', bucketKey: 'sell', emoji: '🔴', label: '매도', cls: 'grade-sell' }
  ];
  var GRADE_BUCKET_ORDER = ['activeBuy', 'buy', 'hold', 'reduce', 'sell']; // 종합점수 높은 순
  var SIGNAL_PAGE_SIZE = 20; // 전체를 한 번에 DOM에 넣지 않고 PC·모바일 모두 20개씩 점진 렌더링

  // 2026-07-27: "9Pay 증권" 개편 작업지시서 #9 - 종목분석에 필터를 추가하되, 새 배치
  // 필드를 만들지 않고 daily_scan.py가 이미 계산해서 GAS(getInvestSignalResult)가
  // 내려주는 rankings.*(수급/외국인기관/기술적/공매도/연기금/펀더멘탈 TOP20, 각 항목
  // [code,name,price,changeRate,metricValue,stars] 6-tuple - invest_signal.upsert_ranked
  // 참고)를 그대로 정렬 기준 탭으로 재사용한다. "상승률"은 rankings에 없지만 버킷 데이터에
  // 이미 changeRate가 있어 클라이언트에서 바로 정렬 가능해 추가했다. PER·배당·거래대금·
  // 차트패턴은 대량 종목에 걸쳐 한 번에 제공하는 데이터 소스가 아직 없어(온디맨드 단건
  // 조회만 가능) 비활성 탭으로 남겨 "없는 척" 하지 않고 준비 중임을 그대로 보여준다.
  var RANKING_META = [
    { key: 'flow', label: '수급강도', metricLabel: '수급점수', fmt: function (v) { return Math.round(v) + '점'; } },
    { key: 'foreignInst', label: '외국인·기관', metricLabel: '5일 합산', fmt: fmtSharesUnit },
    { key: 'tech', label: '기술적', metricLabel: '기술점수', fmt: function (v) { return Math.round(v) + '점'; } },
    { key: 'shortSafe', label: '공매도 안전', metricLabel: '공매도비중', fmt: function (v) { return v.toFixed(1) + '%'; } },
    { key: 'pension', label: '연기금', metricLabel: '5일 순매수', fmt: fmtSharesUnit },
    { key: 'fundamental', label: '펀더멘탈', metricLabel: '펀더멘탈점수', fmt: function (v) { return Math.round(v) + '점'; } }
  ];
  var DISABLED_RANKING_LABELS = ['PER', '배당', '차트패턴']; // 데이터 소스 준비 전 - 안내용 비활성 탭
  var SIGNAL_SORT_META = [
    { key: 'score', label: '종합점수순' },
    { key: 'changeRate', label: '등락률순' },
    { key: 'tradingValue', label: '거래대금순' },
    { key: 'name', label: '종목명순' }
  ];

  var signalData = null;
  var activeGradeBucket = null; // 카운트 배지 클릭으로 필터링한 등급(GRADE_META.key), null이면 전체
  var activeRanking = null;     // RANKING_META.key - null이면 등급 버킷 기준(기본), 값이 있으면 그 랭킹으로 정렬
  var signalSortKey = 'score';
  var signalVisibleCount = SIGNAL_PAGE_SIZE;
  var activeSignalCode = null;  // 우측 요약 패널에 표시 중인 종목코드(리스트 하이라이트용)
  var signalSearchQuery = '';   // 리스트 내부 종목명 검색어(빈 문자열이면 검색 비활성)

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
    loadSignalData(container);
    autoSearchFromUrl(container);

    // 리스트가 화면에 떠 있는 동안(=종목을 조회 중이 아닐 때) 가격·등락률을 주기적으로
    // 최신화한다(위 patchSignalListPrices 주석 참고). 종목 조회 중엔 ffSigWrap이 숨겨지므로
    // 그때는 건드리지 않는다.
    setInterval(function () {
      var sigWrap = container.querySelector('#ffSigWrap');
      if (sigWrap && !sigWrap.hidden && !document.hidden) patchSignalListPrices(container);
    }, 20000);
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

  // 필터탭(ffSigCount)은 좌측 패널 요소(작업지시서 3.2)라 좌측 컬럼 안에 리스트와 함께 둔다.
  function buildShell() {
    return ''
      + '<div class="ff-search ff-search-compact">'
      + '<div class="ff-input-wrap">'
      + '<input type="text" id="ffInput" class="ff-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="ffSuggest" class="ff-suggest"></div>'
      + '</div>'
      + '<button type="button" id="ffSearchBtn" class="ff-search-btn">조회</button>'
      + '</div>'
      + '<div id="ffSigWrap">'
      + '<div class="ff-sig-banner" id="ffSigBanner" hidden></div>'
      + '<div class="ff-sig-twocol">'
      + '<div class="ff-sig-list-col">'
      + '<div class="ff-sig-count" id="ffSigCount"><div class="ff-hint">투자시그널 불러오는 중...</div></div>'
      + '<div class="ff-sig-rank-tabs" id="ffSigRankTabs"></div>'
      + '<div class="ff-sig-list-tools">'
      + '<input type="text" id="ffSigSearch" class="ff-sig-search-input" placeholder="목록 내 종목명 검색" autocomplete="off" />'
      + '<label class="ff-sig-sort-label" for="ffSigSort">정렬'
      + '<select id="ffSigSort" class="ff-sig-sort-select">'
      + SIGNAL_SORT_META.map(function (s) { return '<option value="' + s.key + '">' + s.label + '</option>'; }).join('')
      + '</select></label>'
      + '</div>'
      + '<div class="ff-sig-list" id="ffSigList"></div>'
      + '</div>'
      + '<div class="ff-sig-summary" id="ffSigSummary"><div class="ff-hint">종목을 선택하세요</div></div>'
      + '</div>'
      + '<div class="ff-divider"></div>'
      + '</div>'
      + '<div id="ffResult" class="ff-result"></div>';
  }

  // ---- 오늘의 투자시그널(① 배너 ② 카운트 칩 ③ 종목 리스트+요약 패널) ----

  function loadSignalData(container) {
    ForeignFlow.fetchJson(GAS_TICKER_URL + '?investSignal=1')
      .then(function (data) {
        signalData = data;
        renderSignalCount(container);
        renderRankingTabs(container);
        renderSignalList(container);
        syncSignalPanelHeight(container);
      })
      .catch(function () {
        var box = container.querySelector('#ffSigCount');
        if (box) box.innerHTML = '<div class="ff-error">투자시그널 데이터를 불러오지 못했어요.</div>';
      });
  }

  // 필터 탭 - rankings.*를 그대로 정렬 기준으로 노출(RANKING_META 상단 주석 참고).
  // 데이터 소스가 아직 없는 PER/배당/거래대금/차트패턴은 비활성 탭으로 같이 보여줘서
  // "필터가 있는데 안 보인다"가 아니라 "준비 중"임을 명확히 한다.
  function renderRankingTabs(container) {
    var box = container.querySelector('#ffSigRankTabs');
    if (!box) return;
    var activeTabs = RANKING_META.map(function (r) {
      return '<button type="button" class="ff-rank-tab' + (activeRanking === r.key ? ' active' : '') + '" data-rank="' + escapeAttr(r.key) + '">' + escapeHtml(r.label) + '</button>';
    }).join('');
    var disabledTabs = DISABLED_RANKING_LABELS.map(function (label) {
      return '<button type="button" class="ff-rank-tab ff-rank-tab-disabled" disabled title="데이터 준비 중입니다">' + escapeHtml(label) + '</button>';
    }).join('');
    box.innerHTML = '<span class="ff-rank-tabs-label">필터</span>' + activeTabs + disabledTabs;
  }

  // 카운트 배지를 클릭 가능한 버튼으로 렌더링 - 클릭 시 아래 종목 리스트가 그 등급으로 필터링됨.
  function renderSignalCount(container) {
    var box = container.querySelector('#ffSigCount');
    if (!box) return;
    var counts = signalData.counts || {};
    var line = GRADE_META.map(function (g) {
      return '<button type="button" class="ff-sig-grade ' + g.cls + (activeGradeBucket === g.key ? ' active' : '') + '" data-grade="' + escapeAttr(g.key) + '">'
        + g.label + ' ' + (counts[g.key] || 0).toLocaleString('ko-KR') + '종목</button>';
    }).join('');
    var meta = signalData.scannedAt
      ? ('스캔 ' + signalData.scannedAt + ' · 대상 ' + (signalData.scanned || 0) + '/' + (signalData.universe || 0) + '종목')
      : '아직 스캔 결과가 없어요.';
    box.innerHTML = '<div class="ff-sig-count-line">' + line + '</div>'
      + '<div class="ff-sig-meta">' + escapeHtml(meta) + '</div>';
  }

  // bucket tuple은 구버전 [code,name,price,changeRate,stars]와 신버전
  // [code,name,price,changeRate,stars,totalScore,tradingValue]를 모두 허용한다.
  function bucketSignalRecord(item, gradeMeta) {
    var stars = Number(item[4]);
    var totalScore = item.length > 5 && item[5] != null ? Number(item[5]) : stars * 20;
    return {
      code: item[0],
      name: item[1],
      price: Number(item[2]),
      changeRate: Number(item[3]),
      stars: isNaN(stars) ? 0 : stars,
      totalScore: isNaN(totalScore) ? 0 : totalScore,
      tradingValue: item.length > 6 && item[6] != null ? Number(item[6]) || 0 : 0,
      gradeKey: gradeMeta ? gradeMeta.key : null,
      metricValue: null,
      rankMeta: null
    };
  }

  // 다섯 등급 버킷을 하나의 전체 종목 풀로 정규화한다. 동일 종목이 중복으로 들어와도
  // code 기준 한 번만 유지해 검색·건수·점진 렌더링이 서로 어긋나지 않게 한다.
  function allSignalRecords() {
    var out = [];
    var seen = {};
    GRADE_META.forEach(function (gradeMeta) {
      var arr = (signalData.buckets && signalData.buckets[gradeMeta.bucketKey]) || [];
      arr.forEach(function (item) {
        if (!item || !item[0] || seen[item[0]]) return;
        seen[item[0]] = true;
        out.push(bucketSignalRecord(item, gradeMeta));
      });
    });
    return out;
  }

  function rankingSignalRecords(rankMeta, baseRecords) {
    var byCode = {};
    baseRecords.forEach(function (record) { byCode[record.code] = record; });
    var ranked = (signalData.rankings && signalData.rankings[rankMeta.key]) || [];
    return ranked.map(function (item) {
      var base = byCode[item[0]] || bucketSignalRecord([item[0], item[1], item[2], item[3], item[5]], null);
      return {
        code: base.code,
        name: base.name,
        price: base.price,
        changeRate: base.changeRate,
        stars: item[5] == null ? base.stars : Number(item[5]),
        totalScore: base.totalScore,
        tradingValue: base.tradingValue,
        gradeKey: base.gradeKey,
        metricValue: item[4],
        rankMeta: rankMeta
      };
    });
  }

  function signalSortLabel() {
    var meta = SIGNAL_SORT_META.filter(function (s) { return s.key === signalSortKey; })[0];
    return meta ? meta.label : '종합점수순';
  }

  function sortSignalRecords(records) {
    return records.slice().sort(function (a, b) {
      if (signalSortKey === 'changeRate') return (b.changeRate || 0) - (a.changeRate || 0) || (b.totalScore || 0) - (a.totalScore || 0);
      if (signalSortKey === 'tradingValue') return (b.tradingValue || 0) - (a.tradingValue || 0) || (b.totalScore || 0) - (a.totalScore || 0);
      if (signalSortKey === 'name') return (a.name || '').localeCompare(b.name || '', 'ko');
      return (b.totalScore || 0) - (a.totalScore || 0) || (b.stars || 0) - (a.stars || 0);
    });
  }

  function renderSignalList(container) {
    var box = container.querySelector('#ffSigList');
    if (!box) return;
    if (!signalData) { box.innerHTML = '<div class="ff-hint">불러오는 중...</div>'; return; }

    var rankMeta = activeRanking ? RANKING_META.filter(function (r) { return r.key === activeRanking; })[0] : null;
    var meta = (!rankMeta && activeGradeBucket) ? GRADE_META.filter(function (g) { return g.key === activeGradeBucket; })[0] : null;

    var allRecords = allSignalRecords();
    var items = rankMeta
      ? rankingSignalRecords(rankMeta, allRecords)
      : (meta ? allRecords.filter(function (record) { return record.gradeKey === meta.key; }) : allRecords);

    var query = signalSearchQuery.trim();
    if (query) {
      var q = query.toLowerCase();
      items = items.filter(function (record) {
        return (record.name && record.name.toLowerCase().indexOf(q) !== -1) || (record.code && record.code.indexOf(q) !== -1);
      });
    }
    items = sortSignalRecords(items);

    var filterLabel = rankMeta ? (rankMeta.label + ' 조건') : (meta ? (meta.label + ' 조건') : '전체 종목');
    var headText = filterLabel + ' ' + items.length.toLocaleString('ko-KR') + '개 · ' + signalSortLabel();
    if (query) headText = '"' + query + '" 검색 · ' + headText;
    var headHtml = '<div class="ff-sig-list-head">' + escapeHtml(headText) + '</div>';

    if (!items.length) {
      box.innerHTML = headHtml + '<div class="ff-hint">' + (query ? '검색 결과가 없어요.' : '해당 종목이 없어요.') + '</div>';
      return;
    }

    var shown = items.slice(0, signalVisibleCount);
    var rowsHtml = shown.map(function (record) { return listRowHtml(record); }).join('');
    var moreHtml = items.length > shown.length
      ? '<button type="button" class="ff-sig-more" data-list-more="1">전체 ' + items.length.toLocaleString('ko-KR')
        + '종목 보기 <span>현재 ' + shown.length.toLocaleString('ko-KR') + '개</span></button>'
      : '';

    box.innerHTML = headHtml + '<div class="ff-sig-table">' + rowsHtml + '</div>' + moreHtml;
    patchSignalListPrices(container);
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
      + '<span class="ff-sig-score">' + starsHtml(record.stars) + '</span>'
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
    var bannerBox = container.querySelector('#ffSigBanner');
    var panelBox = container.querySelector('#ffSigSummary');
    if (bannerBox) bannerBox.hidden = true;
    if (panelBox) panelBox.innerHTML = '<div class="ff-loading"><div class="ff-spinner"></div><div>' + escapeHtml(name) + ' 불러오는 중...</div></div>';
    syncSignalPanelHeight(container);

    var chartPromise = fetchFlowChart(code).catch(function () { return null; });
    var investorFlowPromise = fetchInvestorFlowLive(code, name).catch(function () { return null; });
    var quotePromise = fetchLiveQuote(code).catch(function () { return null; });
    var fundamentalsPromise = fetchFundamentals(code, name).catch(function () { return null; });

    Promise.all([ForeignFlow.fetchFlow(code, name), chartPromise, investorFlowPromise, quotePromise, fundamentalsPromise])
      .then(function (results) {
        if (activeSignalCode !== code) return; // 응답 오는 사이 다른 종목을 눌렀으면 무시(레이스 방지)
        var data = results[0], chartData = results[1], entry = results[2], quote = results[3], fundamentals = results[4];
        if (!data || data.error || !data.daily || !data.daily.length) {
          if (panelBox) panelBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요.</div>';
          return;
        }
        var techScore = computeTechnicalScore(chartData);
        renderSignalBanner(bannerBox, data, entry, techScore, fundamentals);
        renderSignalSummaryPanel(panelBox, data, entry, techScore, fundamentals, quote, chartData);
        syncSignalPanelHeight(container);
      })
      .catch(function () {
        if (activeSignalCode !== code) return;
        if (panelBox) panelBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
        syncSignalPanelHeight(container);
      });
  }

  // ① 시그널 배너 - 항상 연한 파랑 고정색(작업지시서 지정), 등급 칩은 문자 등급 대신 한글 텍스트.
  function renderSignalBanner(box, data, entry, techScore, fundamentals) {
    if (!box) return;
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
    var sigSearchInput = container.querySelector('#ffSigSearch');
    var sigSortSelect = container.querySelector('#ffSigSort');

    if (sigSearchInput) {
      sigSearchInput.addEventListener('input', function () {
        signalSearchQuery = sigSearchInput.value;
        signalVisibleCount = SIGNAL_PAGE_SIZE;
        renderSignalList(container);
      });
    }
    if (sigSortSelect) {
      sigSortSelect.addEventListener('change', function () {
        signalSortKey = sigSortSelect.value || 'score';
        signalVisibleCount = SIGNAL_PAGE_SIZE;
        renderSignalList(container);
      });
    }

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
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

    // 2026-07-20: 업종/테마 배지 클릭 -> 같은 분류의 다른 종목 목록 표시(사용자 요청).
    // 이벤트 위임으로 container에 한 번만 걸어둔다 - search()가 #ffResult 내부를 통째로
    // 다시 그려도(펀더멘탈 패널 재생성 등) container 자체는 안 바뀌니 리스너가 계속 산다.
    container.addEventListener('click', function (e) {
      var badge = e.target.closest ? e.target.closest('.ff-badge-clickable') : null;
      if (badge) {
        showRelatedStocks(container, badge.getAttribute('data-related'), badge.getAttribute('data-related-type'));
        return;
      }
      // 종목 리스트 행 클릭 -> 우측 요약 패널 갱신(페이지 이동 없음, 작업지시서 ③).
      var sigRow = e.target.closest ? e.target.closest('.ff-sig-list-row') : null;
      if (sigRow) {
        selectListStock(container, sigRow.getAttribute('data-code'), sigRow.getAttribute('data-name'));
        return;
      }
      var moreBtn = e.target.closest ? e.target.closest('.ff-sig-more') : null;
      if (moreBtn) {
        signalVisibleCount += SIGNAL_PAGE_SIZE;
        renderSignalList(container);
        return;
      }
      var gradeBtn = e.target.closest ? e.target.closest('.ff-sig-grade') : null;
      if (gradeBtn) {
        var key = gradeBtn.getAttribute('data-grade');
        activeGradeBucket = activeGradeBucket === key ? null : key;
        activeRanking = null; // 등급 필터와 정렬 필터는 동시에 적용하지 않음(단순한 단일 리스트 유지)
        signalVisibleCount = SIGNAL_PAGE_SIZE;
        renderSignalCount(container);
        renderRankingTabs(container);
        renderSignalList(container);
        return;
      }
      var rankBtn = e.target.closest ? e.target.closest('.ff-rank-tab:not(.ff-rank-tab-disabled)') : null;
      if (rankBtn) {
        var rankKey = rankBtn.getAttribute('data-rank');
        activeRanking = activeRanking === rankKey ? null : rankKey;
        activeGradeBucket = null;
        signalVisibleCount = SIGNAL_PAGE_SIZE;
        renderSignalCount(container);
        renderRankingTabs(container);
        renderSignalList(container);
        return;
      }
      // 요약 패널의 "상세 보기" -> 기존 검색 흐름(⑤)으로 전환.
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

  function closeRelatedModal() {
    var existing = document.querySelector('.ff-related-overlay');
    if (existing) existing.remove();
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
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key !== 'Escape') return;
      closeRelatedModal();
      document.removeEventListener('keydown', escHandler);
    });

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
      return '<div class="ff-suggest-item" data-name="' + escapeAttr(name) + '">' + stockIconHtml(map[name], 'ff-suggest-icon') + escapeHtml(name) + '</div>';
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

  function search(container, query) {
    var resultBox = container.querySelector('#ffResult');
    destroyLwChart(); // 이전 검색의 차트 인스턴스/리스너 정리(리렌더 전에 먼저 끊는다)
    stopQuotePolling(); // 이전 종목의 헤더 시세 폴링도 같이 정리
    var resolved = resolveStock(query);
    if (!resolved) {
      resultBox.innerHTML = '<div class="ff-error">'
        + (query ? '"' + escapeHtml(query) + '" 종목을 찾을 수 없어요. 정확한 종목명을 입력해보세요.' : '종목명을 입력해주세요.')
        + '</div>';
      return;
    }

    resultBox.innerHTML = '<div class="ff-loading"><div class="ff-spinner"></div><div>' + escapeHtml(resolved.name) + ' 분석 중입니다. (가격 차트는 최초 조회 시 다소 걸릴 수 있어요)</div></div>';

    // 2026-07-20 사용자 피드백: 종목을 조회하면 위 투자시그널 카운트/탭 영역은 화면만
    // 길어지게 하므로 숨긴다(랭킹 행 클릭이든 직접 입력 검색이든 동일하게 적용).
    var sigWrap = container.querySelector('#ffSigWrap');
    if (sigWrap) sigWrap.hidden = true;

    // 차트 크롤링/VM 온디맨드 호출 둘 다 실패 가능성이 있는데, 그것 때문에 나머지
    // 위젯까지 통째로 에러 처리되면 안 되므로 각자 잡아 실패 시 null/에러 객체로 대체한다.
    var chartPromise = fetchFlowChart(resolved.code)
      .catch(function () { return { error: 'FETCH_FAILED', message: '차트 데이터를 불러오지 못했어요.' }; });
    var investorFlowPromise = fetchInvestorFlowLive(resolved.code, resolved.name)
      .catch(function () { return null; });
    var quotePromise = fetchLiveQuote(resolved.code)
      .catch(function () { return null; });
    // 2026-07-19: 종합점수에 펀더멘탈(ROE/부채비율)을 반영하면서(computeFundamentalScore)
    // "펀더멘탈" 탭을 열 때만 불러오던 걸 처음부터 같이 불러오도록 변경 - fetchFundamentals가
    // fundamentalsCache에 저장해두므로 이후 탭 클릭 시 재요청 없음(loadFundamentals 재사용).
    var fundamentalsPromise = fetchFundamentals(resolved.code, resolved.name)
      .catch(function () { return null; });

    Promise.all([ForeignFlow.fetchFlow(resolved.code, resolved.name), chartPromise, investorFlowPromise, quotePromise, fundamentalsPromise])
      .then(function (results) {
        var data = results[0];
        var chartData = results[1];
        var flowEntry = results[2];
        var quote = results[3];
        var fundamentals = results[4];
        if (!data || data.error || !data.daily || !data.daily.length) {
          resultBox.innerHTML = '<div class="ff-error">'
            + escapeHtml((data && data.message) || '수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.')
            + '</div>';
          return;
        }
        renderResult(resultBox, data, chartData, flowEntry, quote, fundamentals);
      })
      .catch(function () {
        resultBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
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

    // 종합평가(점수·별점·AI 투자의견)는 탭 밖에 항상 노출 - 수급/차트/펀더멘탈 어느 탭을
    // 보고 있어도 판정 결과가 계속 보여야 한다(2026-07-13 사용자 피드백: 탭으로 분리해달라).
    html += buildSummaryBox(data, entry, techScore, fundamentals);

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

    box.innerHTML = html;

    // 캔들차트는 차트 탭이 처음 열릴 때 지연 렌더링한다(wireViewTabs) - hidden(display:none)
    // 컨테이너에 바로 그리면 TradingView Lightweight Charts가 크기를 0으로 잡아 빈 화면이 됨.

    wireChartHover(box.querySelector('.ff-chart-net'), data.daily, 'net');
    wireChartHover(box.querySelector('.ff-chart-ratio'), data.daily, 'ratio');
    wireFlowPeriod(box, data.code, data.name);
    loadAiSummary(box, data, entry, techScore, chartData, fundamentals);
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
      fetchLiveQuote(code, true).then(function (q) {
        if (!q) return;
        var header = box.querySelector('.ff-header');
        if (!header) { stopQuotePolling(); return; } // 다른 종목 재검색으로 이 헤더 자체가 사라짐
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
      + '</div>';
  }

  function wireViewTabs(box, code, name, chartData) {
    var tabs = box.querySelectorAll('.ff-view-tab');
    var flowBox = box.querySelector('#ffViewFlow');
    var aptBox = box.querySelector('#ffViewApt');
    var chartBox = box.querySelector('#ffViewChart');
    var fundBox = box.querySelector('#ffViewFundamentals');
    var momentumBox = box.querySelector('#ffViewMomentum');
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
      + '<span>가격 변동이 아니라 뉴스 반복성·최근성·네이버 통합검색 관심도를 배치 집계한 결과입니다.</span>'
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
    box.innerHTML = '<div class="ff-loading"><div class="ff-spinner"></div><div>뉴스·검색 관심도 모멘텀을 불러오는 중...</div></div>';
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
    box.innerHTML = '<div class="ff-loading"><div class="ff-spinner"></div><div>펀더멘탈 데이터를 불러오는 중...</div></div>';
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
      : '<div class="ff-hint">실시간 밸류에이션(PER·PBR·EPS)은 현재 원천 시세 응답이 없어 표시하지 않습니다. 아래 DART 연간 실적은 별도로 표시됩니다.</div>';

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
      + (hasAnnualYears ? buildAnnualTable(annual) + buildAnnualCharts(annual) : '<div class="ff-hint">' + escapeHtml(name || '') + '은(는) 재무 데이터가 없는 종목입니다(DART 미제출 또는 아직 배치 스캔 전).</div>')
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

    html += '<div class="ff-footnote">재무 데이터는 DART(금융감독원 전자공시) 기준, 밸류에이션은 키움 API 실시간 기준입니다. 투자판단 및 그에 따른 책임은 본인에게 있습니다.</div>';

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
    return t.ma.label + ' · ' + t.support.label + ' · ' + t.resistance.label;
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
    if (!annual) return '재무 데이터가 없는 종목입니다(DART 미제출 또는 아직 배치 스캔 전).';
    var parts = [];
    if (annual.latest_roe_pct != null) parts.push('ROE ' + fmtPct(annual.latest_roe_pct));
    if (annual.latest_debt_ratio_pct != null) parts.push('부채비율 ' + fmtPct(annual.latest_debt_ratio_pct));
    return parts.length ? parts.join(' · ') + ' 기준입니다.' : '재무 데이터가 불완전합니다.';
  }

  function buildSummaryBox(data, entry, techScore, fundamentals) {
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
      + buildBadges(data)
      + '<div class="ff-extra-interp ff-extra-tone-' + tone.tone + '">'
      + '<span class="ff-badge ' + toneBadgeCls + '">' + tone.label + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(flowInterpText(data)) + '</span>'
      + '</div>'
      + buildRollingTable(data)
      + buildFlowPeriodButtons(data.daily.length)
      + buildFlowChartsWrap(data.daily)
      + '<div class="ff-footnote">※ 추정대금은 순매매량 × 당일 종가로 계산한 <b>추정치</b>이며 실제 거래대금과 다를 수 있습니다. 자료: 네이버 금융</div>'
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
      chartsWrap.innerHTML = '<div class="ff-loading"><div class="ff-spinner"></div><div>불러오는 중...</div></div>';
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
      + escapeHtml(entry.as_of) + ' 기준 · 키움증권 API</div>';
    html += '</div>';
    return html;
  }

  // ---- 가격 차트(캔들+MA+지지저항+RSI+볼린저밴드) - 차트 탭 ----

  function buildChartSection(chartData, techScore) {
    return '<div class="ff-extra">' + buildFlowChartCard(chartData, techScore) + '</div>';
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
    if (s) {
      // "악성" 신호는 붉게 강조: 공매도 평균가격이 현재가와 20% 이상 괴리, 당일 거래비중 10%↑
      // (거래비중 임계값은 scripts/fetch_investor_flow.py의 압박점수 밴드(>=10=강한 구간)와 통일)
      var gapPct = (currentClose && s.avg_price) ? (s.avg_price - currentClose) / currentClose * 100 : null;
      var gapWarn = gapPct != null && Math.abs(gapPct) >= 20;
      var ratioWarn = s.today_ratio_pct != null && s.today_ratio_pct >= 10;
      var sg = squeezeGrade(s.short_squeeze_index);

      // 2026-07-19: 절대수치라 그 자체로는 해석이 안 되는 항목(공매도 누적잔고/일평균
      // 거래량(20일)/대차잔고 절대량)은 카드에서 제거 - Days to Cover에 이미 20일 평균
      // 거래량 의미가 녹아있고, 잔고는 "증감률"로 방향성을 보여주는 편이 실제 판단에 쓰임.
      grid += extraMetric('공매도 평균가격(추정)', '<span class="' + (gapWarn ? 'ff-warn' : '') + '">' + fmtWon(s.avg_price) + '</span>'
          + (gapPct != null ? '<div class="ff-extra-metric-sub">현재가 대비 ' + fmtSignedPct(gapPct) + '</div>' : ''))
        + extraMetric('당일 거래비중', '<span class="' + (ratioWarn ? 'ff-warn' : '') + '">' + fmtPct(s.today_ratio_pct) + '</span>')
        + extraMetric('Days to Cover', s.days_to_cover == null ? '-' : s.days_to_cover.toFixed(2) + '일')
        + extraMetric('숏 압박 지수', (s.short_squeeze_index == null ? '-' : s.short_squeeze_index.toFixed(1))
          + (sg ? ' <span class="ff-squeeze-grade ' + sg.cls + '">' + sg.label + '</span>' : ''));
    }
    if (l) {
      grid += extraMetric('대차잔고 증감률', '<span class="' + signClass(l.balance_change_pct) + '">' + fmtSignedPct(l.balance_change_pct) + '</span>');
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
      + '</div>'
      + '</div>';
  }

  // ---- 가격 차트: 지지/저항 + 이동평균 5/20/60/224일선 (?action=flowChart) ----

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

  // TradingView 공식 "Bands Indicator" 플러그인 예제와 같은 구조(Series Primitive, v4.1+ 지원 -
  // js/pattern-scan.js 참고). drawBackground()로 캔들/선보다 먼저 그려 구름이 배경에 깔리게 한다.
  function createIchimokuCloudPrimitive(bandPts, bullColor, bearColor) {
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
                    return { x: x * hRatio, yA: yA * vRatio, yB: yB * vRatio, bull: p.a >= p.b };
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
                    ctx.fillStyle = p0.bull ? bullColor : bearColor;
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
      var series = lwcChart.addLineSeries({ color: ICHIMOKU_COLORS[key], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      series.setData(pts);
      ichimokuOverlaySeries.push(series);
      seriesByKey[key] = series;
    });

    if (seriesByKey.senkouA && typeof seriesByKey.senkouA.attachPrimitive === 'function') {
      try {
        var bandPts = pairIchimokuBand(ichi.senkouA, ichi.senkouB);
        if (bandPts.length > 1) {
          var cloudPrimitive = createIchimokuCloudPrimitive(bandPts, 'rgba(210,79,69,0.13)', 'rgba(18,97,196,0.12)');
          seriesByKey.senkouA.attachPrimitive(cloudPrimitive);
          ichimokuCloudPrimitive = { series: seriesByKey.senkouA, primitive: cloudPrimitive };
        }
      } catch (e) { /* primitive 렌더링 실패해도 구름 경계선 2개는 이미 그려져 있음 */ }
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

  // 왼쪽 구간 안내판 라벨(네이버 위젯의 로비/저층/중층/고층/탑층 참고) - bin index를
  // t=0(로비)~1(탑층)로 정규화해 5개 구간으로 나눈다. binCount가 줌에 따라 바뀌므로
  // 매개변수로 받는다.
  function aptBandLabel(i, binCount) {
    var t = i / (binCount - 1);
    if (t >= 0.8) return '탑층';
    if (t >= 0.6) return '고층';
    if (t >= 0.35) return '중층';
    if (t >= 0.12) return '저층';
    return '로비';
  }

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

  // 구간 안내판(탑층~로비) 밑에 표시할 가격범위 - "90,000원~" 처럼 각 구간의 실제 최저/최고가를
  // 보여준다(장식이 아니라 bins[i].low/high에서 그대로 읽은 실데이터).
  function aptBandRanges(profile) {
    var n = profile.bins.length;
    var ranges = {};
    for (var i = 0; i < n; i++) {
      var band = aptBandLabel(i, n);
      var lo = profile.bins[i].low, hi = profile.bins[i].high;
      if (!ranges[band]) ranges[band] = { low: lo, high: hi };
      else { ranges[band].low = Math.min(ranges[band].low, lo); ranges[band].high = Math.max(ranges[band].high, hi); }
    }
    return ranges;
  }
  function aptBandRangeText(band, ranges) {
    var r = ranges[band];
    if (!r) return '';
    if (band === '탑층') return Math.round(r.low).toLocaleString('ko-KR') + '원 ~';
    if (band === '로비') return '~ ' + Math.round(r.high).toLocaleString('ko-KR') + '원';
    return Math.round(r.low).toLocaleString('ko-KR') + '~' + Math.round(r.high).toLocaleString('ko-KR') + '원';
  }

  function buildAptSummaryHtml(profile, periodLabel, avgPrice) {
    if (!profile) {
      return '<div class="ff-apt-summary">이 구간엔 계산할 매물대 데이터가 부족해요.</div>';
    }
    var poc = profile.bins[profile.pocIndex];
    var pocMid = poc ? Math.round((poc.low + poc.high) / 2) : null;
    return '<div class="ff-apt-summary">'
      + '<span class="ff-apt-summary-item">' + (periodLabel || ('최근 ' + profile.days + '거래일')) + '</span>'
      + (pocMid != null
        ? '<span class="ff-apt-summary-item">거래량 최다 구간 <b>' + pocMid.toLocaleString('ko-KR') + '원</b></span>'
        : '')
      + (avgPrice != null
        ? '<span class="ff-apt-summary-item">평균단가 <b>' + Math.round(avgPrice).toLocaleString('ko-KR') + '원</b></span>'
        : '')
      + '<span class="ff-apt-legend"><span class="ff-apt-legend-item"><i class="ff-apt-swatch ff-apt-swatch-vol"></i>매물대</span>'
      + '<span class="ff-apt-legend-item"><i class="ff-apt-swatch ff-apt-swatch-poc"></i>거래량 최다</span></span>'
      + '</div>';
  }

  // .ff-apt-row 실제 높이(px)와 반드시 일치시킬 것 - 엘리베이터 세로 위치/길이를
  // JS에서 픽셀로 직접 계산하는 유일한 기준값이다(CSS를 바꾸면 이 값도 같이 바꿀 것).
  var APT_ROW_HEIGHT = 20;

  // 이전 프로파일 라인 렌더러는 데이터 호환용으로 남겨 둔다.
  function buildAptLineArtHtmlLegacy(profile, currentPrice, avgPrice) {
    if (!profile || !profile.bins || !profile.bins.length) {
      return '<div class="ff-apt-empty">이 구간엔 매물대를 계산할 데이터가 부족해요.</div>';
    }
    var bins = profile.bins;
    var n = bins.length;
    var maxVolume = Number(profile.maxVolume) || 0;
    var curIdx = aptBinIndex(profile, currentPrice);
    var avgIdx = aptBinIndex(profile, avgPrice);
    var pocIdx = profile.pocIndex >= 0 && profile.pocIndex < n ? profile.pocIndex : -1;
    var left = 94, right = 468, top = 58, bottom = 466;
    var plotHeight = bottom - top;

    function yForIndex(index) {
      return top + ((n - 1 - index) / Math.max(1, n - 1)) * plotHeight;
    }
    function xForVolume(volume) {
      var ratio = maxVolume > 0 ? Math.max(0, Math.min(1, Number(volume) / maxVolume)) : 0;
      return left + ratio * (right - left);
    }
    function priceText(value) {
      return value == null || isNaN(value) ? '-' : Math.round(value).toLocaleString('ko-KR');
    }
    function marker(index, color, label, value) {
      if (index < 0 || index >= n) return '';
      var y = yForIndex(index);
      return '<line class="ff-apt-line-marker" x1="' + (left - 12) + '" x2="' + right + '" y1="' + y + '" y2="' + y + '" stroke="' + color + '" />'
        + '<circle class="ff-apt-line-marker-dot" cx="' + (left - 12) + '" cy="' + y + '" r="4" fill="' + color + '" />'
        + '<text class="ff-apt-line-marker-label" x="' + (left + 8) + '" y="' + (y - 7) + '" fill="' + color + '">' + label + ' ' + priceText(value) + '원</text>';
    }

    var gridHtml = '';
    for (var i = 0; i < n; i++) {
      var gy = yForIndex(i);
      gridHtml += '<line class="ff-apt-line-grid" x1="' + left + '" x2="' + right + '" y1="' + gy + '" y2="' + gy + '" />';
    }

    var points = [];
    for (var j = n - 1; j >= 0; j--) {
      var bin = bins[j];
      points.push(Math.round(xForVolume(bin.volume) * 10) / 10 + ',' + Math.round(yForIndex(j) * 10) / 10);
    }
    var profilePath = points.length ? 'M' + points.join(' L') : '';
    var fillPath = profilePath ? profilePath + ' L' + left + ',' + bottom + ' L' + left + ',' + top + ' Z' : '';
    var high = bins[n - 1];
    var middle = bins[Math.floor((n - 1) / 2)];
    var low = bins[0];
    var labelHtml = ''
      + '<text class="ff-apt-line-axis-label" x="12" y="' + (top + 4) + '">' + priceText(high.high) + '원</text>'
      + '<text class="ff-apt-line-axis-label" x="12" y="' + (yForIndex(Math.floor((n - 1) / 2)) + 4) + '">' + priceText((middle.low + middle.high) / 2) + '원</text>'
      + '<text class="ff-apt-line-axis-label" x="12" y="' + (bottom + 4) + '">' + priceText(low.low) + '원</text>';
    var pocText = pocIdx >= 0 && bins[pocIdx] ? priceText((bins[pocIdx].low + bins[pocIdx].high) / 2) + '원' : '-';

    return '<div class="ff-apt-chart-wrap ff-apt-line-art" role="img" aria-label="가격대별 거래량 매물대 라인아트">'
      + '<div class="ff-apt-lineart-head"><strong>가격대별 거래량 라인</strong><span>중심 가격 ' + pocText + '</span></div>'
      + '<svg class="ff-apt-lineart-svg" viewBox="0 0 520 520" preserveAspectRatio="none" aria-hidden="true">'
      + '<title>가격대별 거래량 매물대 라인아트</title>'
      + '<desc>가격이 높아질수록 위로 표시되며 선의 오른쪽 끝이 해당 가격대 거래량입니다.</desc>'
      + '<line class="ff-apt-line-axis" x1="' + left + '" x2="' + left + '" y1="' + top + '" y2="' + bottom + '" />'
      + gridHtml
      + labelHtml
      + '<path class="ff-apt-line-fill" d="' + fillPath + '" />'
      + '<path class="ff-apt-line-profile" d="' + profilePath + '" />'
      + marker(curIdx, '#d24f45', '현재가', currentPrice)
      + marker(avgIdx, '#1971c2', '평균', avgPrice)
      + (pocIdx >= 0 ? marker(pocIdx, '#e8590c', '거래량 최다', (bins[pocIdx].low + bins[pocIdx].high) / 2) : '')
      + '<text class="ff-apt-line-volume-label" x="' + right + '" y="' + (bottom + 30) + '" text-anchor="end">거래량 →</text>'
      + '</svg>'
      + '<div class="ff-apt-lineart-note">선의 길이 = 가격대별 체결거래량 · 점선 = 가격 구간</div>'
      + '</div>';
  }

  // 참고 이미지의 정보 전달 방식만 차용한 독자적인 매물대 일러스트. 도시는 장식이지만 오른쪽
  // 프로파일 선은 실제 bins의 거래량을 그대로 사용해 데이터 의미를 유지한다.
  function buildAptIllustratedLineArtHtml(profile, currentPrice, avgPrice) {
    if (!profile || !profile.bins || !profile.bins.length) {
      return '<div class="ff-apt-empty">이 구간엔 매물대를 계산할 데이터가 부족해요.</div>';
    }
    var bins = profile.bins;
    var n = bins.length;
    var maxVolume = Number(profile.maxVolume) || 0;
    var curIdx = aptBinIndex(profile, currentPrice);
    var avgIdx = aptBinIndex(profile, avgPrice);
    var pocIdx = profile.pocIndex >= 0 && profile.pocIndex < n ? profile.pocIndex : -1;
    var plotLeft = 720, plotRight = 868, plotTop = 116, plotBottom = 382;

    function priceText(value) {
      return value == null || isNaN(value) ? '-' : Math.round(value).toLocaleString('ko-KR');
    }
    var priceLow = Number(profile.minLow);
    var priceHigh = Number(profile.maxHigh);
    if (!isFinite(priceLow)) priceLow = Number(bins[0].low);
    if (!isFinite(priceHigh)) priceHigh = Number(bins[n - 1].high);
    function yForPrice(price) {
      if (!(priceHigh > priceLow)) return plotBottom;
      var ratio = Math.max(0, Math.min(1, (priceHigh - Number(price)) / (priceHigh - priceLow)));
      return plotTop + ratio * (plotBottom - plotTop);
    }
    function yForIndex(index) {
      var safeIndex = Math.max(0, Math.min(n - 1, index));
      var bin = bins[safeIndex];
      return yForPrice((Number(bin.low) + Number(bin.high)) / 2);
    }
    function xForVolume(volume) {
      var ratio = maxVolume > 0 ? Math.max(0, Math.min(1, Number(volume) / maxVolume)) : 0;
      return plotLeft + ratio * (plotRight - plotLeft);
    }
    function building(x, width, band, index) {
      // 건물의 세로 위치와 높이는 거래량이 아니라 이 가격 구간의 low/high를 그대로
      // 가격축에 매핑한다. 거래량은 창문 개수·농도로만 표현한다.
      // 참고 이미지처럼 층 슬래브·유리 파사드·로비를 넣되, 각 건물은 하나의 가격대다.
      var groundY = 379;
      // 각 가격 구간을 '회사 빌딩 한 동'으로 읽게 한다. 거래량이 많을수록
      // 층수가 높아지고, 선택된 구간에는 옥상 사인이 붙어 한눈에 찾을 수 있다.
      var height = 158 + Math.round(band.ratio * 122);
      var y = groundY - height;
      var rows = Math.max(4, Math.min(10, 4 + Math.round(band.ratio * 6)));
      var cols = width >= 100 ? 4 : 3;
      var delay = ((Number(index) || 0) * -0.55).toFixed(2);
      var frontWidth = width - 10;
      var sideStart = x + frontWidth;
      var signLabel = band.current ? '현재가' : band.average ? '평균단가' : band.poc ? 'POC' : '';
      var html = '<g class="ff-apt-illustration-building ' + (band.poc ? 'poc-band ' : '') + (band.current ? 'current-band ' : '') + (band.average ? 'average-band' : '') + '" style="--ff-building-delay:' + delay + 's">'
        + '<rect x="' + x + '" y="' + y + '" width="' + frontWidth + '" height="' + height + '" rx="2" />'
        + '<path class="ff-apt-building-side" d="M' + sideStart + ' ' + (y + 3) + ' L' + (x + width) + ' ' + (y + 8) + ' V' + (groundY - 8) + ' L' + sideStart + ' ' + (groundY - 8) + ' Z" />'
        + '<path class="ff-apt-building-roof" d="M' + (x + 3) + ' ' + (y - 6) + ' H' + (x + width - 3) + ' L' + (x + width + 2) + ' ' + (y - 1) + ' H' + (x - 2) + ' Z" />'
        + '<path class="ff-apt-building-roof-cap" d="M' + (x + 10) + ' ' + (y - 11) + ' H' + (x + width - 10) + ' M' + (x + width / 2) + ' ' + (y - 11) + ' V' + (y - 17) + '" />'
        + '<path class="ff-apt-building-frame" d="M' + (x + frontWidth / 2) + ' ' + (y + 4) + ' V' + (groundY - 8) + ' M' + (x + 5) + ' ' + (y + 5) + ' V' + (groundY - 8) + '" />';
      var floorH = height / (rows + 1);
      var cellW = Math.max(7, (frontWidth - 16) / cols - 4);
      var cellH = Math.max(8, Math.min(16, floorH - 7));
      var floorNames = ['탑층', '고층', '중층', '저층', '로비'];
      var markerColumns = [];
      function markerRow(index) {
        var span = Math.max(1, band.end - band.start - 1);
        var relative = Math.max(0, Math.min(1, (index - band.start) / span));
        // SVG의 0행은 고가 쪽이므로 저가 bin일수록 아래 행에 놓는다.
        return Math.max(0, Math.min(rows - 1, Math.round((1 - relative) * (rows - 1))));
      }
      if (band.current) markerColumns.push({ col: 0, row: markerRow(curIdx), type: 'current' });
      if (band.average) markerColumns.push({ col: Math.min(1, cols - 1), row: markerRow(avgIdx), type: 'average' });
      if (band.poc) markerColumns.push({ col: Math.min(2, cols - 1), row: markerRow(pocIdx), type: 'poc' });
      for (var row = 0; row < rows; row++) {
        var floorY = y + (row + 1) * floorH;
        html += '<path class="ff-apt-building-floor" d="M' + (x - 3) + ' ' + floorY.toFixed(1) + ' H' + (x + width + 3) + '" />';
        if ((band.current || band.average || band.poc) && row % 2 === 0) {
          html += '<text class="ff-apt-building-floor-label" x="' + (x - 5) + '" y="' + (floorY - 3) + '" text-anchor="end">' + floorNames[Math.min(floorNames.length - 1, Math.floor(row * floorNames.length / rows))] + '</text>';
        }
        for (var col = 0; col < cols; col++) {
          var wx = x + 8 + col * (cellW + 4);
          var wy = floorY - cellH - 3;
          var isAccent = col === (row % cols) || (row + col) % Math.max(2, cols) === 0;
          var windowMarker = markerColumns.filter(function (item) { return item.col === col && row === item.row; })[0];
          var windowClass = isAccent ? 'ff-apt-illustration-window accent' : 'ff-apt-illustration-window';
          if (windowMarker) windowClass += ' ' + windowMarker.type + '-window';
          html += '<rect class="' + windowClass + '" style="opacity:' + (0.42 + band.ratio * 0.5).toFixed(2) + '" x="' + wx + '" y="' + wy + '" width="' + cellW + '" height="' + cellH + '" rx="1" />';
          if (!windowMarker && (row + col + index) % 3 === 0) {
            var deskY = wy + cellH * .66;
            html += '<path class="ff-apt-building-desk" d="M' + (wx + cellW * .22) + ' ' + deskY + ' h' + (cellW * .56).toFixed(1) + ' M' + (wx + cellW * .5) + ' ' + deskY + ' v' + (cellH * .2).toFixed(1) + '" />'
              + '<circle class="ff-apt-building-worker" cx="' + (wx + cellW * .5) + '" cy="' + (wy + cellH * .35) + '" r="' + Math.max(1.1, cellH * .12).toFixed(1) + '" />';
          }
          if (windowMarker && windowMarker.type === 'average') {
            var fx = wx + cellW / 2, fy = wy + cellH / 2;
            html += '<g class="ff-apt-building-average-person" transform="translate(' + fx + ' ' + (fy + 1) + ')"><path class="shoulders" d="M-5 5 Q0 1 5 5 V7 H-5 Z" /><circle class="head" r="4.4" /><path class="hair" d="M-4 -1 Q0 -6 4 -1 Z" /><circle class="eye" cx="-1.5" cy="0" r=".55" /><circle class="eye" cx="1.5" cy="0" r=".55" /></g>';
          } else if (windowMarker && windowMarker.type === 'current') {
            html += '<circle class="ff-apt-building-current-icon ff-apt-building-current-ring" cx="' + (wx + cellW / 2) + '" cy="' + (wy + cellH / 2) + '" r="4" /><path class="ff-apt-building-current-icon" d="M' + (wx + cellW / 2 - 6) + ' ' + (wy + cellH / 2) + ' h12 M' + (wx + cellW / 2) + ' ' + (wy + cellH / 2 - 6) + ' v12" />';
          } else if (windowMarker && windowMarker.type === 'poc') {
            var px = wx + cellW / 2, py = wy + cellH / 2;
            html += '<path class="ff-apt-building-poc-icon" d="M' + (px - 5) + ' ' + (py - 2) + ' l2 3 3-5 3 5 2-3-1 6 H' + (px - 4) + ' Z" />';
          }
          if (windowMarker) {
            html += '<text class="ff-apt-window-marker-label ' + windowMarker.type + '" x="' + (wx + cellW / 2) + '" y="' + (wy - 3) + '" text-anchor="middle">'
              + (windowMarker.type === 'average' ? '평균' : windowMarker.type === 'current' ? '현재' : 'POC') + '</text>';
          }
        }
      }
      html += '<rect class="ff-apt-building-lobby" x="' + (x + frontWidth * .31) + '" y="' + (groundY - 31) + '" width="' + (frontWidth * .38) + '" height="24" rx="2" />'
        + '<path class="ff-apt-building-lobby-door" d="M' + (x + frontWidth * .5) + ' ' + (groundY - 31) + ' V' + (groundY - 7) + ' M' + (x + frontWidth * .31) + ' ' + (groundY - 31) + ' H' + (x + frontWidth * .69) + '" />';
      if (signLabel) {
        html += '<g class="ff-apt-building-sign"><rect x="' + (x + 10) + '" y="' + (y - 29) + '" width="' + (width - 20) + '" height="14" rx="5" /><text x="' + (x + width / 2) + '" y="' + (y - 19) + '" text-anchor="middle">' + signLabel + '</text></g>';
      }
      html += '<text class="ff-apt-building-price" x="' + (x + width / 2) + '" y="' + (y - 12) + '" text-anchor="middle">' + priceText(band.mid) + '원</text>'
        + '<text class="ff-apt-building-volume" x="' + (x + width / 2) + '" y="' + (y - 1) + '" text-anchor="middle">' + Math.round(band.volume).toLocaleString('ko-KR') + '주</text>'
        + '<text class="ff-apt-building-band" x="' + (x + width / 2) + '" y="' + (groundY + 7) + '" text-anchor="middle">' + aptBandLabel(band.start, n) + '</text>'
        + '</g>';
      return html;
    }
    function marker(index, color, label, value) {
      if (index < 0 || index >= n) return '';
      var y = yForIndex(index);
      var labelOffset = color === '#3b82f6' ? -32 : color === '#0f766e' ? 8 : -14;
      return '<line class="ff-apt-illustration-marker" x1="' + (plotLeft - 8) + '" x2="' + plotRight + '" y1="' + y + '" y2="' + y + '" stroke="' + color + '" />'
        + '<circle cx="' + (plotLeft - 8) + '" cy="' + y + '" r="4" fill="' + color + '" />'
        + '<rect class="ff-apt-illustration-label-bg" x="' + (plotLeft - 4) + '" y="' + (y + labelOffset) + '" width="140" height="18" rx="9" />'
        + '<text class="ff-apt-illustration-marker-label" x="' + (plotLeft + 6) + '" y="' + (y + labelOffset + 12) + '" fill="' + color + '">' + label + ' ' + priceText(value) + '원</text>';
    }

    // 화면에는 6~7개 안팎의 건물이 보이지만, 전체 가격 구간은 최대 14개 건물로
    // 이어서 만든다. 그래서 지도 자체를 드래그하면 양옆의 인접 가격대가
    // 실제 건물처럼 화면 안으로 들어온다.
    var bandCount = Math.min(14, n);
    var bands = [];
    for (var bandIndex = 0; bandIndex < bandCount; bandIndex++) {
      var bandStart = Math.floor(bandIndex * n / bandCount);
      var bandEnd = Math.max(bandStart + 1, Math.floor((bandIndex + 1) * n / bandCount));
      bandEnd = Math.min(n, bandEnd);
      var bandVolume = 0;
      for (var bandRow = bandStart; bandRow < bandEnd; bandRow++) bandVolume += Math.max(0, Number(bins[bandRow].volume) || 0);
      bands.push({
        low: bins[bandStart].low,
        high: bins[bandEnd - 1].high,
        mid: (bins[bandStart].low + bins[bandEnd - 1].high) / 2,
        volume: bandVolume,
        start: bandStart,
        end: bandEnd,
        current: curIdx >= bandStart && curIdx < bandEnd,
        average: avgIdx >= bandStart && avgIdx < bandEnd,
        poc: pocIdx >= bandStart && pocIdx < bandEnd
      });
    }
    var maxBandVolume = Math.max.apply(null, bands.map(function (band) { return band.volume; })) || 1;
    bands.forEach(function (band) { band.ratio = Math.max(0, Math.min(1, band.volume / maxBandVolume)); });
    var buildingViewportLeft = 28;
    var buildingViewportRight = 680;
    var buildingStartX = 38;
    var buildingWidth = 88;
    var buildingGap = 8;
    var buildingStep = buildingWidth + buildingGap;
    var buildingTrackRight = buildingStartX + (bandCount - 1) * buildingStep + buildingWidth;
    var buildingMinOffset = Math.min(0, buildingViewportRight - buildingTrackRight);
    var currentBandIndex = Math.max(0, Math.min(bandCount - 1, Math.floor(curIdx * bandCount / n)));
    var viewportCenter = (buildingViewportLeft + buildingViewportRight) / 2;
    var currentBuildingCenter = buildingStartX + currentBandIndex * buildingStep + buildingWidth / 2;
    var buildingInitialOffset = Math.max(buildingMinOffset, Math.min(0, viewportCenter - currentBuildingCenter));
    var buildingSpecs = bands.map(function (band, index) {
      return { x: buildingStartX + index * buildingStep, width: buildingWidth };
    });
    var skyline = bands.map(function (band, index) {
      var spec = buildingSpecs[index];
      return building(spec.x, spec.width, band, index);
    }).join('');
    var buildingClipId = 'ff-apt-buildings-clip-' + Math.floor(Math.random() * 1000000000);
    var skylineTrack = '<g class="ff-apt-illustration-building-track" data-price-map-buildings data-building-offset="' + buildingInitialOffset + '" data-building-min-offset="' + buildingMinOffset + '" data-building-max-offset="0" transform="translate(' + buildingInitialOffset + ' 0)" clip-path="url(#' + buildingClipId + ')">' + skyline + '</g>';
    var basement = '<g class="ff-apt-illustration-basement" role="group" aria-label="지하실">'
      + '<path class="ff-apt-basement-shell" d="M190 390 H520 V458 H190 Z" />'
      + '<path class="ff-apt-basement-ceiling" d="M218 390 H486" />'
      + '<path class="ff-apt-basement-stair" d="M166 390 l24 68 M176 390 l24 68 M186 390 l24 68" />'
      + '<path class="ff-apt-basement-flow-line" d="M244 360 C244 378 250 386 250 405 M360 360 V405 M476 360 C476 378 470 386 470 405" />'
      + '<path class="ff-apt-basement-flow-arrow" d="M250 399 l-4 7 h8 Z M360 399 l-4 7 h8 Z M470 399 l-4 7 h8 Z" />'
      + '<rect class="ff-apt-basement-window" x="224" y="411" width="42" height="18" rx="2" />'
      + '<rect class="ff-apt-basement-window" x="280" y="411" width="42" height="18" rx="2" />'
      + '<rect class="ff-apt-basement-window" x="336" y="411" width="42" height="18" rx="2" />'
      + '<rect class="ff-apt-basement-window" x="392" y="411" width="42" height="18" rx="2" />'
      + '<rect class="ff-apt-basement-door" x="452" y="405" width="42" height="38" rx="2" />'
      + '<path class="ff-apt-basement-door-light" d="M458 411 V437 H488 V411" />'
      + '<path class="ff-apt-basement-door-seam" d="M472 407 V441" />'
      + '<circle class="ff-apt-basement-handle" cx="483" cy="424" r="1.8" />'
      + '<text class="ff-apt-basement-label" x="360" y="450" text-anchor="middle">지하실 · 미체결 가격대</text>'
      + '</g>';
    var ladderDockX = 392;
    var ladderDockIndex = Math.max(0, Math.min(bandCount - 1, Math.round((ladderDockX - buildingInitialOffset - buildingStartX - buildingWidth / 2) / buildingStep)));
    var ladderDockBand = bands[ladderDockIndex];
    var ladderDockHeight = 170 + Math.round((ladderDockBand ? ladderDockBand.ratio : 0) * 105);
    var ladderTopY = 110;
    var ladderBottomY = Math.max(ladderTopY + 28, 379 - ladderDockHeight - 6);
    var ladderRungs = '';
    for (var ladderY = ladderTopY + 12; ladderY < ladderBottomY - 4; ladderY += 14) {
      ladderRungs += 'M382 ' + ladderY + ' H402 ';
    }
    var helicopter = '<g class="ff-apt-helicopter-lift" transform="translate(0 -28)"><g class="ff-apt-illustration-helicopter" role="img" aria-label="옥상 헬기">'
      + '<path class="ff-apt-helicopter-body" d="M345 128 Q354 119 372 119 H397 Q410 119 420 127 L413 134 H354 Z" />'
      + '<path class="ff-apt-helicopter-window" d="M360 121 H376 L382 128 H355 Z" />'
      + '<path class="ff-apt-helicopter-tail" d="M418 126 L434 118 L440 120 L425 130" />'
      + '<path class="ff-apt-helicopter-rotor" d="M374 115 H413 M393 115 V120" />'
      + '<path class="ff-apt-helicopter-skid" d="M357 137 H411 M367 133 V137 M401 133 V137" />'
      + '<circle class="ff-apt-helicopter-light" cx="350" cy="128" r="2" />'
      + '</g></g>';
    var ladder = '<g class="ff-apt-illustration-ladder" role="img" aria-label="헬기에서 옥상으로 이어지는 가격 흐름 사다리">'
      + '<path class="ff-apt-ladder-rail" d="M382 ' + ladderTopY + ' V' + ladderBottomY + ' M402 ' + ladderTopY + ' V' + ladderBottomY + '" />'
      + '<path class="ff-apt-ladder-rungs" d="' + ladderRungs + '" />'
      + '<circle class="ff-apt-ladder-beacon" cx="392" cy="' + (ladderTopY + 7) + '" r="3" />'
      + '</g>';
    var profilePoints = [];
    for (var i = n - 1; i >= 0; i--) {
      profilePoints.push(Math.round(xForVolume(bins[i].volume) * 10) / 10 + ',' + Math.round(yForIndex(i) * 10) / 10);
    }
    var profilePath = profilePoints.length ? 'M' + profilePoints.join(' L') : '';
    var high = bins[n - 1];
    var middle = bins[Math.floor((n - 1) / 2)];
    var low = bins[0];
    var pocText = pocIdx >= 0 && bins[pocIdx] ? priceText((bins[pocIdx].low + bins[pocIdx].high) / 2) + '원' : '-';
    function signalCard(x, width, label, value, color, kind) {
      return '<g class="ff-apt-signal-card ' + kind + '-signal" style="--ff-signal-color:' + color + '">'
        + '<rect x="' + x + '" y="18" width="' + width + '" height="32" rx="10" />'
        + '<circle class="ff-apt-signal-dot" cx="' + (x + 14) + '" cy="28" r="4" />'
        + '<text class="ff-apt-signal-label" x="' + (x + 24) + '" y="28">' + label + '</text>'
        + '<text class="ff-apt-signal-value" x="' + (x + 24) + '" y="42">' + value + '</text>'
        + '</g>';
    }
    var signalCards = signalCard(314, 104, '현재가', priceText(currentPrice) + '원', '#0f766e', 'current')
      + signalCard(428, 104, '평균 단가', priceText(avgPrice) + '원', '#3b82f6', 'average')
      + signalCard(542, 104, '중심 가격', pocText, '#f08c46', 'poc');
    var grid = '';
    for (var g = 0; g < n; g += Math.max(1, Math.ceil(n / 12))) {
      var gy = yForIndex(g);
      grid += '<line class="ff-apt-illustration-grid" x1="' + plotLeft + '" x2="' + plotRight + '" y1="' + gy + '" y2="' + gy + '" />';
    }

    var binMaxVolume = Math.max.apply(null, bins.map(function (bin) { return Math.max(0, Number(bin.volume) || 0); })) || 1;
    var binRail = bins.map(function (bin, binIndex) {
      var midpoint = (Number(bin.low) + Number(bin.high)) / 2;
      var isCurrent = binIndex === curIdx;
      var isAverage = binIndex === avgIdx;
      var isPoc = binIndex === pocIdx;
      var markerText = isCurrent ? '현재가' : isAverage ? '평균단가' : isPoc ? 'POC' : '';
      var markers = markerText ? '<b class="ff-apt-bin-marker ' + (isCurrent ? 'current' : isAverage ? 'average' : 'poc') + '">' + markerText + '</b>' : '';
      return '<div class="ff-apt-bin' + (markerText ? ' has-marker' : '') + '" data-bin-index="' + binIndex + '" title="' + priceText(bin.low) + ' ~ ' + priceText(bin.high) + '원 · 거래량 ' + Math.round(Number(bin.volume) || 0).toLocaleString('ko-KR') + '">'
        + markers
        + '<span class="ff-apt-bin-price">' + priceText(midpoint) + '</span>'
        + '<span class="ff-apt-bin-bar" style="height:' + Math.max(8, Math.round((Math.max(0, Number(bin.volume) || 0) / binMaxVolume) * 54)) + 'px"></span>'
        + '</div>';
    }).join('');

    return '<div class="ff-apt-chart-wrap ff-apt-line-art ff-apt-illustration" role="img" aria-label="가격대별 매물대 일러스트">'
      + '<div class="ff-apt-lineart-head"><strong>가격대별 매물대</strong><span>중심 가격 ' + pocText + '</span></div>'
      + '<svg class="ff-apt-lineart-svg ff-apt-illustration-svg ff-apt-price-map-surface" data-price-map-surface viewBox="0 0 900 465" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
      + '<title>가격대별 매물대 일러스트</title>'
      + '<desc>건물의 크기와 창문 밀도는 거래량을 나타내며 평균·현재가·중심 가격을 창문 아이콘으로 표시합니다.</desc>'
      + '<defs><clipPath id="' + buildingClipId + '"><rect x="' + buildingViewportLeft + '" y="90" width="' + (buildingViewportRight - buildingViewportLeft) + '" height="310" /></clipPath></defs>'
      + '<rect class="ff-apt-illustration-canvas" x="10" y="12" width="880" height="441" rx="22" />'
      + '<path class="ff-apt-illustration-orbit" d="M-20 312 C130 60 430 24 690 132" />'
      + '<path class="ff-apt-illustration-orbit" d="M-60 382 C120 90 500 70 750 24" />'
      + '<path class="ff-apt-illustration-orbit" d="M120 430 C230 172 566 126 924 190" />'
      + '<g class="ff-apt-illustration-title"><rect x="48" y="48" width="200" height="40" rx="8" /><path d="M68 68 h22 m-11-11 v22" /><text x="104" y="74">가격 지형도</text></g>'
      + signalCards
      + '<g class="ff-apt-illustration-tag"><rect x="48" y="118" width="122" height="28" rx="6" /><text x="66" y="137">거래량 지도</text></g>'
      + '<g class="ff-apt-illustration-tag"><rect x="520" y="72" width="112" height="28" rx="6" /><text x="540" y="91">체결 흐름</text></g>'
      + skylineTrack
      + ladder
      + helicopter
      + basement
      + '<path class="ff-apt-illustration-ground" d="M28 380 H680" />'
      + '<path class="ff-apt-illustration-ground" d="M28 390 H680" />'
      + '<path class="ff-apt-illustration-ribbon" d="M62 174 C136 154 202 194 274 174 S416 154 492 178 S586 198 654 170" />'
      + '<circle class="ff-apt-illustration-node" cx="274" cy="174" r="5" />'
      + '<circle class="ff-apt-illustration-node" cx="492" cy="178" r="5" />'
      + '<g class="ff-apt-illustration-profile"><rect x="696" y="100" width="178" height="300" rx="12" /><text class="ff-apt-illustration-profile-title" x="714" y="126">거래량 프로파일</text>'
      + '<line class="ff-apt-illustration-axis" x1="' + plotLeft + '" x2="' + plotLeft + '" y1="' + plotTop + '" y2="' + plotBottom + '" />'
      + grid
      + '<path class="ff-apt-illustration-profile-line" d="' + profilePath + '" />'
      + '<text class="ff-apt-illustration-price" x="714" y="150">' + priceText(high.high) + '원</text>'
      + '<text class="ff-apt-illustration-price" x="714" y="252">' + priceText((middle.low + middle.high) / 2) + '원</text>'
      + '<text class="ff-apt-illustration-price" x="714" y="386">' + priceText(low.low) + '원</text>'
      + marker(curIdx, '#0f766e', '현재가', currentPrice)
      + marker(avgIdx, '#3b82f6', '평균', avgPrice)
      + (pocIdx >= 0 ? marker(pocIdx, '#f08c46', '거래량 최다', (bins[pocIdx].low + bins[pocIdx].high) / 2) : '')
      + '<text class="ff-apt-illustration-volume" x="858" y="392" text-anchor="end">거래량 →</text></g>'
      + '</svg>'
      + '<div class="ff-apt-bin-guide"><strong>가격별 매물대</strong><span>건물들을 좌우로 드래그하면 인접 가격대 건물이 나타납니다 · 막대가 높을수록 체결량이 많습니다</span><div class="ff-apt-bin-controls"><button type="button" data-bin-scroll="-1" aria-label="가격대 왼쪽 보기">←</button><button type="button" data-bin-scroll="1" aria-label="가격대 오른쪽 보기">→</button></div></div>'
      + '<div class="ff-apt-bin-rail" data-price-bin-rail tabindex="0" aria-label="가격별 매물대 좌우 탐색">' + binRail + '</div>'
      + '<div class="ff-apt-visual-key"><span><i class="current"></i>십자 현재가</span><span><i class="average"></i>파란 사람 평균단가</span><span><i class="poc"></i>왕관 POC</span><span><i class="window"></i>창문 밀도 거래량</span></div>'
      + '<div class="ff-apt-lineart-note">건물 지도를 좌우로 드래그하면 화면 밖의 인접 가격대 건물이 들어옵니다. 건물의 창문 밀도는 체결량을, 현재가·평균단가·POC는 아이콘을 나타냅니다.</div>'
      + '</div>';
  }

  // "주가가 사는 아파트"라는 컨셉(옥상 헬리패드+헬기, 층마다 가격 옆 미니 창문 아이콘, 구간
  // 안내판에 가격범위 부기, 현재가 말풍선+좌우 강조선, 현재층→지하실로 이어지는 사다리, 로비/
  // 지하실 장식)은 그대로 유지하고, 각 층의 막대만 매수/매도 듀얼 바에서 거래량 단일 바로
  // 바꿨다(2026-08-02, 위 헤더 주석 참고) - POC(거래량 최다 구간)만 강조색으로 표시한다.
  function buildAptChartHtmlLegacy(profile, currentPrice, avgPrice) {
    if (!profile) {
      return '<div class="ff-apt-empty">이 구간엔 매물대를 계산할 데이터가 부족해요.</div>';
    }
    var n = profile.bins.length;
    var curIdx = aptBinIndex(profile, currentPrice);
    var avgIdx = aptBinIndex(profile, avgPrice);
    var bandRanges = aptBandRanges(profile);
    var prevBand = null;
    var rows = '';
    for (var i = n - 1; i >= 0; i--) {
      var b = profile.bins[i];
      var mid = Math.round((b.low + b.high) / 2);
      var band = aptBandLabel(i, n);
      var showBand = band !== prevBand;
      prevBand = band;
      var isCurrent = i === curIdx;
      var isAverage = i === avgIdx;
      var isPoc = i === profile.pocIndex && b.volume > 0;
      var pct = profile.maxVolume > 0 ? Math.max(0, Math.round(b.volume / profile.maxVolume * 100)) : 0;
      var valueLabel = b.volume > 0 ? '<span class="ff-apt-bar-value">' + Math.round(b.volume).toLocaleString('ko-KR') + '주</span>' : '';
      var title = mid.toLocaleString('ko-KR') + '원\n거래량 ' + Math.round(b.volume).toLocaleString('ko-KR') + '주';
      var bandLabelHtml = showBand
        ? '<span class="ff-apt-band-icon">⌂</span><span class="ff-apt-band-name">' + band + '</span>'
          + '<span class="ff-apt-band-range">' + aptBandRangeText(band, bandRanges) + '</span>'
        : '';
      var floorWidth = Math.round(52 + ((n - 1 - i) / Math.max(1, n - 1)) * 42);
      rows += '<div class="ff-apt-row' + (showBand ? ' ff-apt-band-start' : '') + (isCurrent ? ' ff-apt-row-current' : '') + (isAverage ? ' ff-apt-row-average' : '') + '"'
        + ' title="' + escapeHtml(title) + '">'
        + '<span class="ff-apt-band-label">' + bandLabelHtml + '</span>'
        + '<span class="ff-apt-tower-floor" style="width:' + floorWidth + 'px"><i></i><i></i><i></i></span>'
        + '<span class="ff-apt-price">' + mid.toLocaleString('ko-KR') + '</span>'
        + '<span class="ff-apt-bar-slot">'
          + '<span class="ff-apt-bar ff-apt-bar-vol' + (isPoc ? ' ff-apt-bar-max' : '') + '" style="width:' + pct + '%"></span>' + valueLabel
          + '</span>'
        + (isCurrent
          ? '<span class="ff-apt-current-badge"><span class="ff-apt-current-arrow">◀</span>현재가 ' + mid.toLocaleString('ko-KR') + '원</span>'
          : '')
        + (isAverage
          ? '<span class="ff-apt-average-badge">평균단가 ' + Math.round(avgPrice).toLocaleString('ko-KR') + '원</span>'
          : '')
        + '</div>';
    }

    var roofHtml = '<div class="ff-apt-roof-block">'
      + '<div class="ff-apt-clouds" aria-hidden="true">'
      + '<span class="ff-apt-cloud ff-apt-cloud-left"></span>'
      + '<span class="ff-apt-cloud ff-apt-cloud-right"></span>'
      + '<span class="ff-apt-cloud ff-apt-cloud-high"></span>'
      + '<span class="ff-apt-cloud ff-apt-cloud-rain"><i></i><i></i><i></i></span>'
      + '</div>'
      + '<div class="ff-apt-nameplate">매물대 타워</div>'
      + '<div class="ff-apt-helipad"><span class="ff-apt-helipad-h">H</span></div>'
      + '<div class="ff-apt-heli"><span class="ff-apt-heli-rotor"></span><span class="ff-apt-heli-body">🚁</span></div>'
      + '</div>';

    // 유리 엘리베이터: 현재가 층과 지하 로비 사이를 왕복하는 장식(데이터 아님).
    // 위치와 높이만 현재가 bin에서 계산하고, 운행 방향은 최근일 등락 방향을 반영한다.
    var elevatorHtml = '';
    if (curIdx >= 0) {
      var elevatorTop = (n - 1 - curIdx) * APT_ROW_HEIGHT + APT_ROW_HEIGHT / 2;
      var elevatorHeight = curIdx * APT_ROW_HEIGHT + 12;
      elevatorHtml = '<div class="ff-apt-elevator" style="top:' + elevatorTop + 'px;height:' + elevatorHeight + 'px">'
        + '<span class="ff-apt-elevator-shaft"></span>'
        + '<span class="ff-apt-elevator-car ff-apt-elevator-car-' + (profile.trendUp ? 'up' : 'down') + '"><i></i><b>↕</b></span>'
        + '</div>';
    }

    // 2026-07-28 사용자 요청: 로비 소품 4개(자동문/화분/우편함/안내판)를 큰 문 하나로
    // 단순화 - "문만 좀 큰거 있으면 좋겠다"는 피드백. 그 아래 지하실로 내려가는 맨홀
    // 뚜껑을 따로 뒀었는데, 문+맨홀 두 아이콘이 "그냥 던져 놓은" 느낌이라는 후속 피드백으로
    // 맨홀은 지우고 문 하나만 남김.
    var lobbyHtml = '<div class="ff-apt-ground">'
      + '<span class="ff-apt-ground-label">최저가 · 지상 1층</span>'
      + '<span class="ff-apt-basement-entry" aria-hidden="true">'
      + '<span class="ff-apt-entry-door"><i></i><i></i></span>'
      + '<span class="ff-apt-entry-stairs"><i></i><i></i><i></i><b>↓ B1</b></span>'
      + '</span></div>';
    // 지하실은 실제 데이터가 존재하는 가격구간이 아니라 "아직 매집되지 않은 가격 / 추가
    // 하락 가능 영역"을 뜻하는 상징적인 공간이라 bin/거래량과 연결하지 않는다(작업지시서 명시).
    var basementHtml = '<div class="ff-apt-basement">'
      + '<div class="ff-apt-basement-heading">'
      + '<strong><span class="ff-apt-basement-level">B1</span> 지하실</strong>'
      + '<span>최저가 아래 · 아직 매집되지 않은 가격대</span>'
      + '</div>'
      + '<div class="ff-apt-basement-rooms">'
      + '<span class="ff-apt-basement-room">📦창고</span>'
      + '<span class="ff-apt-basement-room">⚡전기실</span>'
      + '<span class="ff-apt-basement-room">⚙️기계실</span>'
      + '<span class="ff-apt-basement-room">🅿️주차장</span>'
      + '</div></div>';

    // B2 마그마방도 실제 가격구간이 아닌 장식이다. B1 아래에 암반층을 두어 별도 공간으로
    // 분리하고, 최저가보다 훨씬 아래의 극단적 하락 영역이라는 은유만 전달한다.
    var magmaHtml = '<div class="ff-apt-magma" aria-label="B2 마그마방 · 극단적 하락 영역">'
      + '<div class="ff-apt-magma-crust"></div>'
      + '<div class="ff-apt-magma-label"><strong>B2 마그마방</strong><span>최저가보다 훨씬 아래 · 극단적 하락 영역</span></div>'
      + '<span class="ff-apt-magma-bubble ff-apt-magma-bubble-1"></span>'
      + '<span class="ff-apt-magma-bubble ff-apt-magma-bubble-2"></span>'
      + '<span class="ff-apt-magma-bubble ff-apt-magma-bubble-3"></span>'
      + '<span class="ff-apt-magma-glow"></span>'
      + '</div>';

    var coreHtml = '<div class="ff-apt-core" aria-label="B3 지구 핵 · 장기 하락 위험 구간">'
      + '<span class="ff-apt-core-glow"></span>'
      + '<div class="ff-apt-core-label"><strong>B3 지구 핵</strong><span>최저가보다 더 아래 · 장기 하락 위험 구간</span></div>'
      + '<span class="ff-apt-core-bubble ff-apt-core-bubble-1"></span>'
      + '<span class="ff-apt-core-bubble ff-apt-core-bubble-2"></span>'
      + '</div>';

    return '<div class="ff-apt-chart-wrap">' + roofHtml
      + '<div class="ff-apt-floors">' + rows + elevatorHtml + '</div>'
      + lobbyHtml + basementHtml + magmaHtml + coreHtml + '</div>';
  }

  function buildAptZoomButtons(stepIndex) {
    var atMin = stepIndex <= 0, atMax = stepIndex >= APT_BIN_STEPS.length - 1;
    return '<div class="ff-apt-zoom" id="ffAptZoom">'
      + '<button type="button" class="ff-apt-zoom-btn" data-zoom="out"' + (atMin ? ' disabled' : '') + '>축소 −</button>'
      + '<span class="ff-apt-zoom-label" id="ffAptZoomLabel">' + APT_BIN_STEPS[stepIndex] + '층</span>'
      + '<button type="button" class="ff-apt-zoom-btn" data-zoom="in"' + (atMax ? ' disabled' : '') + '>확대 ＋</button>'
      + '</div>';
  }

  // 한국투자 pbar-tratio(실제 체결가) 기반 - ?days=로 VM이 SQLite 누적분까지 합산해준다.
  // 조회할 때마다 그날 스냅샷이 쌓여서 daysIncluded가 자연히 늘어난다.
  // 2026-08-05: "최근 120일(근사)" 병행 뷰는 혼란만 준다는 사용자 판단으로 제거하고
  // 이 실제 체결가 뷰 하나로 통일했다(computeVolumeProfile 자체는 차트 탭 매물대
  // 오버레이(addVolumeProfileOverlay)가 여전히 써서 남겨둠).
  function buildAptDynamicHtml(profile, currentPrice, stepIndex, daysIncluded, avgPrice) {
    var sourceText = profile.source === 'ohlc-estimate'
      ? '※ 실제 체결가 API가 응답하지 않아 일봉 고가·저가·거래량 기반의 근사 매물대를 표시합니다.'
      : '※ 한국투자 API(실제 체결가·체결거래량)로 만든 매물대입니다.';
    var footnote = '<div class="ff-footnote">' + sourceText + ' 이 종목을 조회할 때마다 그날 데이터가 쌓여 지금은 최근 <b>'
      + (daysIncluded || 1) + '거래일</b>치가 반영돼 있어요(뜸하게 조회된 종목은 며칠치만 있을 수 있음, 최대 ' + APT_LOOKBACK_DAYS + '일).</div>';
    var periodLabel = (daysIncluded || 1) === 1 ? '오늘' : '최근 ' + daysIncluded + '거래일';
    return buildAptZoomButtons(stepIndex)
      + buildAptSummaryHtml(profile, periodLabel, avgPrice)
      + buildAptIllustratedLineArtHtml(profile, currentPrice, avgPrice)
      + '<div class="ff-apt-meaning" role="note">'
      + '<strong>매물대는 이렇게 읽습니다</strong>'
      + '<p>가격별로 실제 체결 거래량이 얼마나 쌓였는지를 보여주는 지도입니다. 건물의 높이와 창문 밀도가 클수록 해당 가격에서 거래가 많이 일어났다는 뜻입니다.</p>'
      + '<p><b>현재가</b>는 지금 가격, <b>평균단가</b>는 조회 기간의 거래량 가중 평균 가격, <b>중심 가격(POC)</b>은 거래량이 가장 많이 몰린 가격입니다. 현재가가 두꺼운 매물대 위에 있으면 지지, 아래에 있으면 저항으로 해석할 수 있지만 단독 매매 신호는 아닙니다.</p>'
      + '</div>'
      + footnote;
  }

  function buildAptCard() {
    return '<div class="ff-extra-card ff-apt-card" id="ffAptCard">'
      + '<div class="ff-extra-card-title">🏢 매물대</div>'
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

  // 일목균형표 구름과 동일한 Series Primitive 패턴(v4.1+ 지원) - drawBackground()로 캔들보다
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
    }
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
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      // scaleMargins: 캔들이 세로로 납작해 보인다는 피드백(2026-07-19)으로 기본 여백(대략
      // 위20%/아래10%)보다 좁혀 캔들이 세로 공간을 더 채우도록 함.
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
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

  // 실제 트레이딩뷰 엔진(TradingView Lightweight Charts)으로 캔들/이평선/지지저항을 렌더링.
  // GAS ?action=flowChart 응답(daily 오름차순 + ma5/20/60/224 + levels)을 그대로 먹인다.
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
        timeScale: { timeVisible: false, secondsVisible: false },
        localization: { locale: 'ko-KR' },
        // 2026-07-19: 캔들이 세로로 너무 납작해 보인다는 피드백 - 가격축(오른쪽) 드래그로
        // 직접 세로 확대가 가능하게 함(마우스 휠은 기존처럼 가로/시간축 확대). 위아래 여백은
        // lwcThemeOptions()의 rightPriceScale에 같이 설정(mergeOptions가 얕은 병합이라
        // 여기 쓰면 아래서 borderColor로 덮어써짐 - 두 값을 한 객체에 모아야 함).
        handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
      }, lwcThemeOptions(LWC)));
      lwcChart = chart;

      var daily = chartData.daily;
      var candleSeries = chart.addCandlestickSeries({
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
        var lineSeries = chart.addLineSeries({
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
      var volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false
      });
      // 거래량용 overlay 축은 가격 축과 분리하고 눈금/마지막 값은 감춘다. 그래야
      // 거래량 영역 오른쪽에 가격 formatter가 붙는 현상이 사라진다.
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.72, bottom: 0 }, visible: false, borderVisible: false });
      volumeSeries.setData(daily.map(function (d) {
        return {
          time: d.date,
          value: Math.max(0, Number(d.volume) || 0),
          color: d.close >= d.open ? 'rgba(210,79,69,0.5)' : 'rgba(18,97,196,0.5)'
        };
      }));

      var volumeMaPoints = movingAverageChartPoints(daily, 'volume', 20);
      var volumeMaSeries = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false
      });
      volumeMaSeries.setData(volumeMaPoints.map(function (point) {
        return { time: point.time, value: Math.max(0, Number(point.value) || 0) };
      }));

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

    function show(evt) {
      var rect = svg.getBoundingClientRect();
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
      var chartRect = chartEl.getBoundingClientRect();
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

    svg.addEventListener('mousemove', show);
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('click', show); // 모바일 탭 대응
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
