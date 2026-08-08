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

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#stock-search';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var MAX_RESULTS = 30;
  var FETCH_TIMEOUT_MS = 15000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var VM_OHLC_MINUTE_URL = 'https://goodbyestar.cloud/ohlc-minute/';
  var US_STOCKS_SCRIPT = 'https://goodbyestarwars.github.io/tistory-ticker/js/us-stocks.js';
  var US_API_BASE = 'https://goodbyestar.cloud';
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: 'Apple Inc.', aliases: '애플 apple' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', aliases: '마이크로소프트 microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', aliases: '엔비디아 nvidia' },
    { symbol: 'AMZN', name: 'Amazon.com, Inc.', aliases: '아마존 amazon' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', aliases: '구글 알파벳 google alphabet' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', aliases: '테슬라 tesla' },
    { symbol: 'META', name: 'Meta Platforms, Inc.', aliases: '메타 meta 페이스북' },
    { symbol: 'INTC', name: 'Intel Corporation', aliases: '인텔 intel' },
    { symbol: 'SPCX', name: 'SpaceX', aliases: '스페이스X spacex' }
  ];
  var MINUTE_REFRESH_MS = 60000; // 분봉 자동 재조회 간격 - kospi-futures.js와 동일하게 최소 60초

  var state = {
    selectedCode: null,
    selectedName: null,
    ladderMounted: false,
    timeframe: 'day', // 'day' | 'week' | 'month' | 'minute'
    movingAverageEnabled: true,
    ichimokuEnabled: false,
    chartCache: {},   // code -> flowChart 응답(daily/ma/levels) 5분 캐시
    minuteCache: {},  // code -> { t, bars(LWC 형식으로 변환 완료) } 1분 캐시
    lastResults: null,     // 마지막 검색 결과(재렌더링용, 재조회 없이 접기/펼치기)
    resultsCollapsed: false, // 종목을 고르면 목록이 화면을 계속 차지하지 않도록 접음(사용자 리포트)
    minuteRefreshTimer: null
  };
  var lwcLoadPromise = null;
  var lwcChart = null;
  var lwcCloudCleanup = null;
  var suggestionRequestId = 0;

  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    var iconCode = String(code).replace(/^US:/i, '').toUpperCase();
    return '<img class="ss-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(iconCode) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    document.title = document.title.replace(/증시검색/g, '실시간 시세');
    document.querySelectorAll('.post-single-title').forEach(function (title) {
      if (title.textContent.trim() === '증시검색') title.textContent = '실시간 시세';
    });
    container.innerHTML = buildShell();
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

  function loadUsStocksModule(container) {
    var target = container.querySelector('#ssUsModule');
    if (!target) return;
    target.hidden = false;
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
        var pending = target.getAttribute('data-us-symbol');
        if (pending && typeof global.UsStocks.select === 'function') global.UsStocks.select(pending);
      }
    };
    script.onerror = function () {
      container.innerHTML = '<div class="ss-hint ss-error">미국주식 시세 모듈을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    };
    document.body.appendChild(script);
  }

  // 관심종목(MY) 카드의 "차트 보기" 버튼이 ?code=005930&name=삼성전자로 넘어오면
  // 사용자가 직접 검색하지 않아도 바로 그 종목을 조회한다(js/foreign-flow.js의
  // autoSearchFromUrl과 동일 패턴, js/watchlist.js가 이 URL로 링크를 건다).
  function autoSearchFromUrl(container) {
    var params = new URLSearchParams(location.search);
    var code = (params.get('code') || '').trim();
    if (params.get('market') === 'us' || /^US:/i.test(code)) {
      loadUsStocksModule(container);
      return;
    }
    if (!code) return;
    var name = (params.get('name') || '').trim();
    var input = container.querySelector('#ssInput');
    if (input) input.value = name || code;
    runSearch(container, code);
  }

  function openUsSymbol(container, query) {
    var symbol = String(query || '').replace(/^US:/i, '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-^=]{0,11}$/.test(symbol)) return false;
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
      + '<div id="ssResults" class="ss-results"></div>'
      + '<div id="ssUsModule" class="ss-us-module" hidden></div>'
      + '<div id="ssDetail" class="ss-detail" hidden>'
      + '<div id="ssSummary" class="ss-summary"></div>'
      + '<div class="ss-panels">'
      // css/order-book.css의 모든 규칙이 "#order-book .ob-xxx"로 ID에 고정돼 있어(다른
      // ID로 마운트하면 스타일이 하나도 안 먹음 - 실측으로 발견) 마운트 id를 그대로
      // "order-book"으로 맞춰 기존 CSS를 손대지 않고 재사용한다. 이 페이지엔 이 위젯이
      // 하나뿐이라 중복 id 걱정은 없다.
      + '<div class="ss-panel-left"><div id="order-book"></div></div>'
      + '<div class="ss-panel-right">'
      + '<div class="ss-chart-tabs">'
      + '<button type="button" class="ss-tf-btn active" data-tf="day">일봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="week">주봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="month">월봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="minute">분봉</button>'
      + '</div>'
      + '<div class="ss-chart-studies">'
      + '<label><input type="checkbox" id="ssMovingAverageToggle" checked /> 이동평균선 표시</label>'
      + '<label><input type="checkbox" id="ssIchimokuToggle" /> 일목균형표(구름) 표시</label>'
      + '</div>'
      + '<div id="ssChart" class="ss-chart"><div class="ss-hint">차트를 불러오는 중...</div></div>'
      + '<div class="ss-chart-legend">거래량은 캔들 아래 막대로 표시됩니다.</div>'
      + '</div>'
      + '</div>'
      + '</div>';
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
    var map = global.KRX_MAP || {};
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
    if (!query || !global.KRX_MAP) { hideSuggestions(box); return; }
    var requestId = ++suggestionRequestId;
    var domesticRows = matchNames(query, 6).map(function (name) {
      return { name: name, code: global.KRX_MAP[name], market: 'kr' };
    });
    fetchUsSearch(query).then(function (usRows) {
      if (requestId !== suggestionRequestId) return;
      var rows = domesticRows.concat(usRows).slice(0, 8);
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

  function runSearch(container, query) {
    var resultsBox = container.querySelector('#ssResults');
    if (!query) { resultsBox.innerHTML = '<div class="ss-hint">종목명 또는 코드를 입력해주세요.</div>'; return; }
    if (/^US:/i.test(query) || (/^[A-Z][A-Z0-9.\-^=]{0,11}$/.test(query) && !/^\d{6}$/.test(query))) {
      openUsSymbol(container, query);
      return;
    }
    if (!/^\d{6}$/.test(query)) {
      resultsBox.innerHTML = '<div class="ss-hint"><div class="ss-spinner"></div>한국·미국 종목을 찾는 중...</div>';
      fetchUsSearch(query).then(function (rows) {
        if (rows.length) {
          openUsSymbol(container, rows[0].code);
          return;
        }
        runDomesticSearch(container, query);
      }).catch(function () { runDomesticSearch(container, query); });
      return;
    }
    runDomesticSearch(container, query);
  }

  function runDomesticSearch(container, query) {
    var resultsBox = container.querySelector('#ssResults');

    var map = global.KRX_MAP || {};
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

    resultsBox.innerHTML = '<div class="ss-hint"><div class="ss-spinner"></div>시세를 불러오는 중...</div>';

    var items = names.map(function (name) { return { name: name, code: map[name] }; });
    var codes = items.map(function (it) { return it.code; });

    fetchJson(GAS_TICKER_URL + '?codes=' + codes.join(','))
      .then(function (quotes) {
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
        resultsBox.innerHTML = '<div class="ss-hint ss-error">시세를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function fetchUsSearch(query) {
    return fetch(US_API_BASE + '/us-search?q=' + encodeURIComponent(query) + '&limit=8')
      .then(function (response) {
        if (!response.ok) throw new Error('미국주식 검색 오류: ' + response.status);
        return response.json();
      })
      .then(function (body) {
        var rows = (body && body.data ? body.data : []).map(function (row) {
          return { code: row.code || ('US:' + row.symbol), name: row.name || row.symbol, market: 'us' };
        });
        if (!rows.length) throw new Error('미국주식 검색 결과 없음');
        return rows;
      })
      .catch(function () {
        var needle = String(query || '').toLowerCase();
        return LOCAL_US_SYMBOLS.filter(function (row) {
          return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(needle) !== -1;
        }).slice(0, 8).map(function (row) {
          return { code: 'US:' + row.symbol, name: row.name, market: 'us' };
        });
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

  // 2026-07-28: 검색 결과가 많을 때(예: "삼성" 30건) 종목을 하나 골라도 목록이 화면에
  // 계속 남아있어 "없어지질 않는다"는 리포트가 있었음 - 종목을 고르면 목록을 접어
  // "검색 결과 N건 (다시 보기)" 한 줄로 줄인다(재조회 없이 state.lastResults로 다시
  // 펼칠 수 있음). 선택된 종목이 어떤 건지 잊지 않도록 접힌 줄에도 이름을 같이 보여준다.
  function renderResults(container, items) {
    var resultsBox = container.querySelector('#ssResults');

    if (state.resultsCollapsed) {
      var selected = items.filter(function (it) { return it.code === state.selectedCode; })[0];
      resultsBox.innerHTML = '<div class="ss-results-collapsed">'
        + '<span>검색 결과 ' + items.length + '건' + (selected ? ' · 선택: ' + escapeHtml(selected.name) : '') + '</span>'
        + '<button type="button" class="ss-results-toggle" data-action="expand">목록 다시 보기 ▾</button>'
        + '</div>';
      var expandBtn = resultsBox.querySelector('.ss-results-toggle');
      if (expandBtn) expandBtn.addEventListener('click', function () {
        state.resultsCollapsed = false;
        renderResults(container, items);
      });
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
        // 종목을 골랐으면 목록을 접어서 화면을 계속 차지하지 않게 한다(사용자 리포트) -
        // 결과가 1건뿐일 때는 접을 목록 자체가 무의미하니 그대로 둠.
        if (items.length > 1) {
          state.resultsCollapsed = true;
          renderResults(container, items);
        }
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
          else if (result.reason === 'login') alert('Google 로그인 후 관심종목을 저장할 수 있습니다.');
          else if (result.reason === 'full') alert('관심종목은 최대 ' + global.Watchlist.MAX_ITEMS + '개까지 담을 수 있습니다.');
        }
      });
    });

    // 결과가 1건뿐이면(코드 직접 입력 등) 바로 상세까지 보여준다
    if (items.length === 1) {
      selectStock(container, items[0]);
      var onlyRow = resultsBox.querySelector('.ss-result-row');
      if (onlyRow) onlyRow.classList.add('active');
    }
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
    state.selectedCode = item.code;
    state.selectedName = item.name;

    var detail = container.querySelector('#ssDetail');
    detail.hidden = false;

    renderSummary(container, item);
    loadPriceReason(container, item);

    var ladderBox = container.querySelector('#order-book');
    if (!state.ladderMounted && global.OrderBook) {
      global.OrderBook.init('#order-book', {
        hideSearch: true,
        onQuote: function (quote) { applyRealtimeQuote(container, quote); }
      });
      state.ladderMounted = true;
    }
    if (global.OrderBook && ladderBox) {
      global.OrderBook.select(ladderBox, item.code, item.name);
    }

    loadChart(container, item.code);
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
      + '</div>'
      + '<div class="ss-summary-reason" id="ssSummaryReason">'
      + '<span class="ss-reason-badge">AI</span>'
      + '<span class="ss-reason-text">오늘 움직인 이유를 불러오는 중...</span>'
      + '</div>';
  }

  // 2026-07-28 사용자 요청: "시가총액"/"외국인·기관 수급(5일)" 라인을 없애고, 대신 오늘
  // 이 종목이 왜 올랐는지/빠졌는지 뉴스 기반 AI 한줄요약으로 교체(GAS ?action=priceReason -
  // 오늘 발행된 뉴스만 추려 Groq에 한 문장 요약을 요청, js/stock-news.js의 3문장 종합요약과는
  // 별개의 가벼운 엔드포인트). 오늘 관련 뉴스가 없으면 요약을 만들지 않고 안내 문구만 표시.
  function loadPriceReason(container, item) {
    var url = GAS_TICKER_URL + '?action=priceReason&code=' + encodeURIComponent(item.code)
      + '&name=' + encodeURIComponent(item.name) + '&changeRate=' + encodeURIComponent(item.changeRate);
    fetchJson(url)
      .then(function (data) {
        if (state.selectedCode !== item.code) return; // 그 사이 다른 종목을 골랐으면 무시
        var el = container.querySelector('#ssSummaryReason .ss-reason-text');
        if (el) el.textContent = (data && data.reason) ? data.reason : '오늘 이 종목에 대한 특별한 뉴스가 없어요.';
      })
      .catch(function () {
        if (state.selectedCode !== item.code) return;
        var el = container.querySelector('#ssSummaryReason .ss-reason-text');
        if (el) el.textContent = '오늘 움직인 이유를 불러오지 못했어요.';
      });
  }

  // ---- 실시간 체결가 ----
  // 2026-08-05(2차) 사용자 리포트: 상단 요약(27,250원)과 호가창(27,350원)이 서로 다른
  // 가격을 보여줬다 - 처음엔 order-book.js와 별개로 이 파일에서도 wss://.../ws/quotes
  // 소켓을 하나 더 열었는데, 같은 코드에 소켓이 2개 뜨면 두 소켓의 수신 타이밍이 미묘하게
  // 어긋나 서로 다른 시점의 값이 잠깐씩 보였다. 소켓은 order-book.js(#order-book 위젯)
  // 하나만 열고, 그 위젯이 이미 갱신에 성공한 값을 콜백(opts.onQuote, selectStock 참고)으로
  // 그대로 받아써서 항상 같은 값을 보여주게 했다.
  function applyRealtimeQuote(container, quote) {
    if (state.selectedCode !== quote.code || typeof quote.price !== 'number') return;
    var box = container.querySelector('#ssSummary');
    if (!box) return;
    var cls = signClass(quote.changeRate);
    var priceEl = box.querySelector('.ss-summary-price');
    if (priceEl) { priceEl.textContent = fmtPrice(quote.price) + '원'; priceEl.className = 'ss-summary-price ' + cls; }
    var changeEl = box.querySelector('.ss-summary-change');
    if (changeEl) { changeEl.textContent = fmtSignedPct(quote.changeRate); changeEl.className = 'ss-summary-change ' + cls; }
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
      delete state.minuteCache[code]; // 60초 캐시 TTL과 무관하게 이 타이머 주기마다 강제로 새로 받음
      renderMinuteChart(container, code);
    }, MINUTE_REFRESH_MS);
  }

  // ---- 차트 (일/주/월/분봉 + 거래량) ----
  // 분봉은 VM /ohlc-minute를 브라우저가 직접 호출(js/order-book.js와 동일 패턴, 인증 없음).
  // 일/주/월봉과 달리 state.chartCache(daily)가 아니라 별도 state.minuteCache를 쓴다.

  function wireChartTabs(container) {
    container.querySelectorAll('.ss-tf-btn').forEach(function (btn) {
      if (btn.disabled) return;
      btn.onclick = function () {
        var tf = btn.getAttribute('data-tf');
        if (state.timeframe === tf) return;
        state.timeframe = tf;
        container.querySelectorAll('.ss-tf-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        renderChartForCode(container, state.selectedCode);
      };
    });
    var movingAverageToggle = container.querySelector('#ssMovingAverageToggle, [data-chart-ma-toggle]');
    if (movingAverageToggle) {
      movingAverageToggle.checked = state.movingAverageEnabled;
      movingAverageToggle.onchange = function () {
        state.movingAverageEnabled = movingAverageToggle.checked;
        renderChartForCode(container, state.selectedCode);
      };
    }
    var ichimokuToggle = container.querySelector('#ssIchimokuToggle, [data-chart-ichimoku-toggle]');
    if (ichimokuToggle) {
      ichimokuToggle.checked = state.ichimokuEnabled;
      ichimokuToggle.onchange = function () {
        state.ichimokuEnabled = ichimokuToggle.checked;
        renderChartForCode(container, state.selectedCode);
      };
    }
  }

  function loadChart(container, code) {
    var chartEl = container.querySelector('#ssChart');
    var cached = state.chartCache[code];
    if (cached && Date.now() - cached.t < 5 * 60 * 1000) {
      renderChartForCode(container, code);
      return;
    }
    chartEl.innerHTML = '<div class="ss-hint"><div class="ss-spinner"></div>차트를 불러오는 중...</div>';
    fetchJson(GAS_TICKER_URL + '?action=flowChart&code=' + encodeURIComponent(code))
      .then(function (data) {
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

  // 일봉을 ISO 주차/월 단위로 묶어 주봉·월봉을 클라이언트에서 계산(백엔드는 일봉만 제공) -
  // open=구간 첫날, close=구간 마지막날, high/low=구간 내 최댓값/최솟값, volume=합계.
  function aggregateBars(daily, groupKeyFn) {
    var groups = [];
    var byKey = {};
    daily.forEach(function (d) {
      var key = groupKeyFn(d.date);
      var g = byKey[key];
      if (!g) {
        g = { date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume || 0 };
        byKey[key] = g;
        groups.push(g);
      } else {
        g.high = Math.max(g.high, d.high);
        g.low = Math.min(g.low, d.low);
        g.close = d.close;
        g.date = d.date; // 구간의 마지막 날짜를 대표 타임스탬프로 사용
        g.volume += (d.volume || 0);
      }
    });
    return groups;
  }

  function isoWeekKey(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = (d.getUTCDay() + 6) % 7; // 월요일=0
    d.setUTCDate(d.getUTCDate() - day + 3); // 그 주 목요일로 이동(ISO 주차 계산 관례)
    var firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return d.getUTCFullYear() + '-W' + week;
  }
  function monthKey(dateStr) { return dateStr.slice(0, 7); }

  function barsForTimeframe(daily, tf) {
    if (tf === 'week') return aggregateBars(daily, isoWeekKey);
    if (tf === 'month') return aggregateBars(daily, monthKey);
    return daily;
  }

  function movingAveragePoints(bars, field, period) {
    var sum = 0;
    var points = [];
    bars.forEach(function (bar, i) {
      sum += Number(bar[field]) || 0;
      if (i >= period) sum -= Number(bars[i - period][field]) || 0;
      if (i >= period - 1) points.push({ time: bar.date, value: sum / period });
    });
    return points;
  }

  function rollingMidpointValues(bars, period) {
    return bars.map(function (_, i) {
      if (i < period - 1) return null;
      var high = -Infinity;
      var low = Infinity;
      for (var j = i - period + 1; j <= i; j++) {
        high = Math.max(high, Number(bars[j].high) || 0);
        low = Math.min(low, Number(bars[j].low) || 0);
      }
      return (high + low) / 2;
    });
  }

  function futureBarTimes(lastDate, timeframe, count) {
    var out = [];
    var d = new Date(lastDate + 'T00:00:00Z');
    var originalDay = d.getUTCDate();
    for (var i = 0; i < count; i++) {
      if (timeframe === 'week') {
        d.setUTCDate(d.getUTCDate() + 7);
      } else if (timeframe === 'month') {
        var nextMonth = d.getUTCMonth() + 1;
        var nextYear = d.getUTCFullYear() + Math.floor(nextMonth / 12);
        nextMonth = nextMonth % 12;
        var lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
        d = new Date(Date.UTC(nextYear, nextMonth, Math.min(originalDay, lastDay)));
      } else {
        do { d.setUTCDate(d.getUTCDate() + 1); }
        while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      }
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  // 일목균형표 구름대: 전환선(9), 기준선(26), 선행스팬B(52)를 계산한 뒤
  // 선행스팬 A/B를 현재 봉 기준 26봉 앞으로 이동한다. 미래 구간은 일봉이면 주말을,
  // 주봉/월봉이면 각각 7일/1개월 간격을 사용하며 공휴일 값을 임의 생성하지 않는다.
  function ichimokuCloudPoints(bars, timeframe) {
    if (!bars.length) return [];
    var conversion = rollingMidpointValues(bars, 9);
    var base = rollingMidpointValues(bars, 26);
    var spanBValues = rollingMidpointValues(bars, 52);
    var times = bars.map(function (bar) { return bar.date; })
      .concat(futureBarTimes(bars[bars.length - 1].date, timeframe, 26));
    var points = [];
    bars.forEach(function (_, i) {
      if (conversion[i] == null || base[i] == null || spanBValues[i] == null) return;
      points.push({
        time: times[i + 26],
        spanA: (conversion[i] + base[i]) / 2,
        spanB: spanBValues[i]
      });
    });
    return points;
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
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      var coordinates = points.map(function (point) {
        return {
          x: chart.timeScale().timeToCoordinate(point.time),
          yA: candleSeries.priceToCoordinate(point.spanA),
          yB: candleSeries.priceToCoordinate(point.spanB),
          bullish: point.spanA >= point.spanB
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
        ctx.fillStyle = (prev.bullish && curr.bullish)
          ? 'rgba(210,79,69,0.13)'
          : (!prev.bullish && !curr.bullish)
            ? 'rgba(18,97,196,0.12)'
            : 'rgba(132,139,148,0.10)';
        ctx.fill();
      }
    }
    function scheduleDraw() {
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = global.requestAnimationFrame(draw);
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

  function compactVolume(value) {
    var n = Number(value) || 0;
    function scaled(divisor, suffix) {
      var v = n / divisor;
      var digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      var text = v.toFixed(digits);
      if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
      return text + suffix;
    }
    if (Math.abs(n) >= 1000000000) return scaled(1000000000, 'B');
    if (Math.abs(n) >= 1000000) return scaled(1000000, 'M');
    if (Math.abs(n) >= 1000) return scaled(1000, 'K');
    return Math.round(n).toLocaleString('ko-KR');
  }

  function ma224Color() {
    return document.documentElement.classList.contains('dark') ? '#f1f3f5' : '#000000';
  }

  function renderChartForCode(container, code) {
    if (state.timeframe === 'minute') {
      renderMinuteChart(container, code);
      startMinuteRefresh(container, code);
      return;
    }
    stopMinuteRefresh();
    var cached = state.chartCache[code];
    if (!cached) return;
    var bars = barsForTimeframe(cached.data.daily, state.timeframe);
    renderLwChart(container.querySelector('#ssChart'), bars, state.timeframe);
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
    state.timeframe = 'day';
    container.innerHTML = ''
      + '<div class="ss-chart-tabs">'
      + '<button type="button" class="ss-tf-btn active" data-tf="day">일봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="week">주봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="month">월봉</button>'
      + '<button type="button" class="ss-tf-btn" data-tf="minute">분봉</button>'
      + '</div>'
      + '<div class="ss-chart-studies">'
      + '<label><input type="checkbox" data-chart-ma-toggle checked /> 이동평균선 표시</label>'
      + '<label><input type="checkbox" data-chart-ichimoku-toggle /> 일목균형표(구름) 표시</label>'
      + '</div>'
      + '<div id="ssChart" class="ss-chart"><div class="ss-hint">차트를 불러오는 중...</div></div>'
      + '<div class="ss-chart-legend">거래량은 캔들 아래에 국내 종목 화면과 같은 방식으로 표시됩니다.</div>';

    var dailyPromise = Promise.resolve().then(function () { return options.load('daily'); }).catch(function () { return []; });
    var minutePromise = Promise.resolve().then(function () { return options.load('minute'); }).catch(function () { return []; });
    return Promise.all([dailyPromise, minutePromise]).then(function (result) {
      var daily = Array.isArray(result[0]) ? result[0] : [];
      var minute = Array.isArray(result[1]) ? result[1] : [];
      if (!daily.length && !minute.length) throw new Error('NO_DATA');
      state.chartCache[code] = { t: Date.now(), data: { daily: daily } };
      state.minuteCache[code] = { t: Date.now(), bars: minute };
      if (state.selectedCode !== code) return { daily: daily, minute: minute };
      wireChartTabs(container);
      renderChartForCode(container, code);
      return { daily: daily, minute: minute };
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
    var chartEl = container.querySelector('#ssChart');
    var cached = state.minuteCache[code];
    if (cached && Date.now() - cached.t < 60 * 1000) {
      renderLwChart(chartEl, cached.bars, 'minute');
      return;
    }
    chartEl.innerHTML = '<div class="ss-hint"><div class="ss-spinner"></div>분봉을 불러오는 중...</div>';
    fetchJson(VM_OHLC_MINUTE_URL + encodeURIComponent(code) + '?tic_scope=1')
      .then(function (json) {
        var bars = minuteRowsToBars((json && json.data) || []);
        state.minuteCache[code] = { t: Date.now(), bars: bars };
        if (state.selectedCode === code && state.timeframe === 'minute') {
          renderLwChart(container.querySelector('#ssChart'), bars, 'minute');
        }
      })
      .catch(function () {
        if (state.selectedCode === code && state.timeframe === 'minute') {
          chartEl.innerHTML = '<div class="ss-hint ss-error">분봉 데이터를 불러오지 못했어요.</div>';
        }
      });
  }

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

  function lwcThemeOptions(LWC, timeframe) {
    var dark = document.documentElement.classList.contains('dark');
    return {
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      // 2026-08-05 사용자 리포트: 분봉 X축이 같은 날짜("5일")만 반복 표시됐음 - 분봉의
      // time은 UNIX 타임스탬프(minuteRowsToBars 참고)인데 timeVisible이 꺼져 있으면
      // 라이브러리가 날짜만 찍는다. 분봉일 때만 시:분(HH:mm)을 보여주고, 일/주/월봉은
      // (time이 날짜 문자열이라 시간 개념이 없어) 그대로 둔다.
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd', timeVisible: timeframe === 'minute', secondsVisible: false },
      // 2026-07-28 사용자 리포트: 다크모드에서 차트 위에 안 어울리는 회색 네모(십자선
      // 가격/시각 라벨의 기본 배경색, 라이브러리 기본값이라 다크 팔레트와 무관하게 고정)가
      // 떴음 - 라벨 배경색을 테마에 맞게 명시(js/foreign-flow.js와 동일 수정).
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: dark ? '#2a2a2a' : '#555' },
        horzLine: { labelBackgroundColor: dark ? '#2a2a2a' : '#555' }
      }
    };
  }

  function renderLwChart(container, bars, timeframe) {
    if (lwcCloudCleanup) { lwcCloudCleanup(); lwcCloudCleanup = null; }
    if (lwcChart) { try { lwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ } lwcChart = null; }
    container.querySelectorAll('.ss-volume-study-label, .ss-price-study-label, .ss-ichimoku-cloud').forEach(function (el) { el.remove(); });

    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;
      if (container.querySelector('.ss-hint')) container.innerHTML = '';

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: 420,
        // crosshair는 lwcThemeOptions()에 있음(mergeOptions가 얕은 병합이라 두 곳에 나눠
        // 쓰면 뒤에 오는 쪽이 통째로 덮어씀).
        localization: { locale: 'ko-KR' }
      }, lwcThemeOptions(LWC, timeframe)));
      lwcChart = chart;

      var candleSeries = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4',
        priceFormat: {
          type: 'custom',
          minMove: 1,
          formatter: function (v) { return Math.round(v).toLocaleString('ko-KR'); }
        }
      });
      candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.36 } });
      candleSeries.setData(bars.map(function (d) {
        return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
      }));

      var priceStudies = [
        { period: 5, label: '5', color: '#d24f45' },
        { period: 20, label: '20', color: '#1261c4' },
        { period: 60, label: '60', color: '#0ca678' },
        { period: 224, label: '224', color: ma224Color() }
      ];
      var priceLegendHtml = [];
      if (state.movingAverageEnabled) {
        priceStudies.forEach(function (study) {
          var points = movingAveragePoints(bars, 'close', study.period);
          var series = chart.addLineSeries({
            color: study.color,
            lineWidth: study.period === 224 ? 3 : 1,
            priceScaleId: 'right',
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            priceFormat: {
              type: 'custom',
              minMove: 1,
              formatter: function (v) { return Math.round(v).toLocaleString('ko-KR'); }
            }
          });
          series.setData(points);
          var latest = points.length ? Math.round(points[points.length - 1].value).toLocaleString('ko-KR') : '—';
          priceLegendHtml.push('<span style="color:' + study.color + '">MA' + study.label + ' <b>' + latest + '</b></span>');
        });
      }

      // futureBarTimes가 분봉 간격을 모르는 채로 하루씩 미래 날짜를 만들어버리므로
      // 분봉 탭에서는 구름대 투영을 건너뛴다(체크돼 있어도 "데이터 부족"으로만 표시됨).
      var cloudPoints = (state.ichimokuEnabled && timeframe !== 'minute') ? ichimokuCloudPoints(bars, timeframe) : [];
      if (state.ichimokuEnabled) {
        var spanASeries = chart.addLineSeries({
          color: 'rgba(210,79,69,0.62)',
          lineWidth: 1,
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false
        });
        var spanBSeries = chart.addLineSeries({
          color: 'rgba(18,97,196,0.62)',
          lineWidth: 1,
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false
        });
        spanASeries.setData(cloudPoints.map(function (point) { return { time: point.time, value: point.spanA }; }));
        spanBSeries.setData(cloudPoints.map(function (point) { return { time: point.time, value: point.spanB }; }));
        priceLegendHtml.push('<span class="ss-ichimoku-label">일목 구름대' + (cloudPoints.length ? '' : ' <b>데이터 부족</b>') + '</span>');
      }

      if (priceLegendHtml.length) {
        var priceLegend = document.createElement('div');
        priceLegend.className = 'ss-price-study-label';
        priceLegend.innerHTML = priceLegendHtml.join('');
        container.appendChild(priceLegend);
      }

      // TradingView 방식처럼 거래량을 하단 30% overlay 영역에 배치한다. 차트 전체의
      // localization.priceFormatter를 없애고 시리즈별 포맷을 사용해야 거래량 값이
      // 2,539,179 같은 주가형 숫자가 아니라 2.54M처럼 축약 표시된다.
      // 2026-08-05 사용자 리포트: 거래량 Y축에 가격 데이터와 거래량 데이터가 겹쳐 보였음 -
      // lastValueVisible/priceLineVisible을 켜두면 라이브러리가 거래량 시리즈의 마지막 값
      // 배지·점선을 오른쪽 가격축(캔들과 같은 여백)에 그대로 그려서 가격 마지막 값 배지·
      // 눈금 라벨과 겹친다. 같은 값은 이미 아래 .ss-volume-study-label(커스텀 범례)이
      // 텍스트로 보여주고 있어 중복이라, 다른 보조지표 시리즈(MA/일목균형표)와 동일하게 끈다.
      var volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false
      });
      // 거래량은 가격과 별도 overlay 축을 쓰고 축 자체는 숨긴다. 기본 overlay 축('')을
      // 공유하면 차트 localization의 가격 formatter가 거래량 눈금에 붙는 경우가 있다.
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.72, bottom: 0 }, visible: false, borderVisible: false });
      volumeSeries.setData(bars.map(function (d) {
        return { time: d.date, value: Math.max(0, Number(d.volume) || 0), color: d.close >= d.open ? 'rgba(210,79,69,0.5)' : 'rgba(18,97,196,0.5)' };
      }));

      var volumeMaPoints = movingAveragePoints(bars, 'volume', 20);
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

      var latestBar = bars[bars.length - 1] || {};
      var latestVolumeMa = volumeMaPoints.length ? volumeMaPoints[volumeMaPoints.length - 1].value : null;
      var volumeLegend = document.createElement('div');
      volumeLegend.className = 'ss-volume-study-label';
      volumeLegend.innerHTML = '<span>거래량 (20)</span>'
        + '<b>' + compactVolume(latestBar.volume) + '</b>'
        + (latestVolumeMa == null ? '' : '<b class="ss-volume-ma-value">' + compactVolume(latestVolumeMa) + '</b>');
      container.appendChild(volumeLegend);

      chart.timeScale().fitContent();
      lwcCloudCleanup = installIchimokuCloudCanvas(container, chart, candleSeries, cloudPoints);
    }).catch(function () {
      container.innerHTML = '<div class="ss-hint ss-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  // ---- 유틸 ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { if (timer) clearTimeout(timer); return data; })
      .catch(function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  function signClass(rate) {
    if (rate > 0) return 'ss-up';
    if (rate < 0) return 'ss-down';
    return 'ss-flat';
  }
  function fmtPrice(v) { return v == null ? '-' : Number(v).toLocaleString('ko-KR'); }
  function fmtSignedPct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }
  function fmtQty(v) { return v == null ? '-' : Math.round(v).toLocaleString('ko-KR'); }
  // 거래대금(원)을 억원 단위로 - 사이트 다른 위젯(마켓 브리핑 등)과 동일한 단위 관례
  function fmtEok(v) { return v == null ? '-' : (v / 1e8).toFixed(1) + '억'; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  global.StockSearch = { init: init };
  global.StockSearchChart = { mount: mountExternalChart };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
