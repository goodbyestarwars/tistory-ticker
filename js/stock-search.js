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
 * ?codes= 배치 시세로 여러 종목을 한 번에 받을 수 있지만, 시가총액·외국인/기관 수급은
 * 종목 하나씩 온디맨드로만 제공돼(VM /foreign-flow/{code}) 검색 결과 전체에 걸면 종목
 * 수만큼 호출이 폭발한다 - 그래서 그 두 필드는 "선택한 종목 요약"에서만 보여준다
 * (검색 결과 클릭 -> 상세, 라는 작업지시서 흐름과도 맞음).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var KIWOOM_VM_URL = 'https://goodbyestar.cloud';
  var CONTAINER_SELECTOR = '#stock-search';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var MAX_RESULTS = 30;
  var FETCH_TIMEOUT_MS = 15000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';

  var state = {
    selectedCode: null,
    selectedName: null,
    ladderMounted: false,
    timeframe: 'day', // 'day' | 'week' | 'month'
    chartCache: {},   // code -> flowChart 응답(daily/ma/levels) 5분 캐시
    lastResults: null,     // 마지막 검색 결과(재렌더링용, 재조회 없이 접기/펼치기)
    resultsCollapsed: false // 종목을 고르면 목록이 화면을 계속 차지하지 않도록 접음(사용자 리포트)
  };
  var lwcLoadPromise = null;
  var lwcChart = null;

  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    return '<img class="ss-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireSearch(container);
    autoSearchFromUrl(container);
  }

  // 관심종목(MY) 카드의 "차트 보기" 버튼이 ?code=005930&name=삼성전자로 넘어오면
  // 사용자가 직접 검색하지 않아도 바로 그 종목을 조회한다(js/foreign-flow.js의
  // autoSearchFromUrl과 동일 패턴, js/watchlist.js가 이 URL로 링크를 건다).
  function autoSearchFromUrl(container) {
    var params = new URLSearchParams(location.search);
    var code = (params.get('code') || '').trim();
    if (!code) return;
    var name = (params.get('name') || '').trim();
    var input = container.querySelector('#ssInput');
    if (input) input.value = name || code;
    runSearch(container, code);
  }

  function buildShell() {
    return ''
      + '<div class="ss-search">'
      + '<div class="ss-input-wrap">'
      + '<input type="text" id="ssInput" class="ss-input" placeholder="종목명 또는 종목코드를 입력하세요 (예: 삼성전자, 005930)" autocomplete="off" />'
      + '<div id="ssSuggest" class="ss-suggest"></div>'
      + '</div>'
      + '<button type="button" id="ssGoBtn" class="ss-go-btn">검색</button>'
      + '</div>'
      + '<div id="ssResults" class="ss-results"></div>'
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
      + '<button type="button" class="ss-tf-btn" data-tf="minute" disabled title="실시간 분봉 데이터 소스가 아직 없어요(준비 중)">분봉</button>'
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
    var matches = matchNames(query, 8);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="ss-suggest-item" data-name="' + escapeAttr(name) + '">' + stockIconHtml(global.KRX_MAP[name]) + escapeHtml(name) + '</div>';
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
        runSearch(container, name);
      });
    });
  }

  // ---- 검색 결과 리스트 ----

  function runSearch(container, query) {
    var resultsBox = container.querySelector('#ssResults');
    if (!query) { resultsBox.innerHTML = '<div class="ss-hint">종목명 또는 코드를 입력해주세요.</div>'; return; }

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
    fetchSummaryExtra(item.code, item.name).then(function (extra) {
      if (state.selectedCode !== item.code) return; // 그 사이 다른 종목을 골랐으면 무시
      renderSummary(container, item, extra);
    });

    var ladderBox = container.querySelector('#order-book');
    if (!state.ladderMounted && global.OrderBook) {
      global.OrderBook.init('#order-book', { hideSearch: true });
      state.ladderMounted = true;
    }
    if (global.OrderBook && ladderBox) {
      global.OrderBook.select(ladderBox, item.code, item.name);
    }

    loadChart(container, item.code);
    wireChartTabs(container);
  }

  function renderSummary(container, item, extra) {
    var box = container.querySelector('#ssSummary');
    var cls = signClass(item.changeRate);
    var marketCapHtml = extra && extra.market_cap_eok != null
      ? fmtEokWon(extra.market_cap_eok)
      : (extra === null ? '자료 없음' : '조회 중...');
    var flowHtml = extra
      ? summaryFlowText(extra)
      : (extra === null ? '자료 없음' : '조회 중...');

    box.innerHTML = ''
      + '<div class="ss-summary-head">'
      + stockIconHtml(item.code)
      + '<span class="ss-summary-name">' + escapeHtml(item.name) + '</span>'
      + '<span class="ss-summary-code">(' + escapeHtml(item.code) + ')</span>'
      + '<span class="ss-summary-price ' + cls + '">' + fmtPrice(item.price) + '원</span>'
      + '<span class="ss-summary-change ' + cls + '">' + fmtSignedPct(item.changeRate) + '</span>'
      + '</div>'
      + '<div class="ss-summary-extra">'
      + '<span><b>시가총액</b> ' + marketCapHtml + '</span>'
      + '<span><b>외국인·기관 수급(5일)</b> ' + flowHtml + '</span>'
      + '</div>';
  }

  function summaryFlowText(extra) {
    var rolling = extra.rolling && extra.rolling['5d'];
    if (!rolling) return '자료 없음';
    var f = rolling.foreign, i = rolling.inst;
    var fText = f > 0 ? '외국인 순매수' : (f < 0 ? '외국인 순매도' : '외국인 중립');
    var iText = i > 0 ? '기관 순매수' : (i < 0 ? '기관 순매도' : '기관 중립');
    return fText + ' · ' + iText;
  }

  // 시가총액/외국인·기관 수급 - 종목 하나씩만 온디맨드 조회 가능해 "선택한 종목"에서만 호출.
  // 실패해도(장기 미상장/데이터 없음 등) 나머지 화면은 정상 동작해야 하므로 null로 흡수.
  function fetchSummaryExtra(code, name) {
    var url = KIWOOM_VM_URL + '/foreign-flow/' + encodeURIComponent(code) + '?days=5';
    return fetchJson(url)
      .then(function (envelope) {
        var data = envelope && envelope.data;
        if (!data || data.error) return null;
        return data;
      })
      .catch(function () { return null; });
  }

  // ---- 차트 (일/주/월봉 + 거래량, 분봉은 데이터 소스 없어 비활성) ----

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

  function renderChartForCode(container, code) {
    var cached = state.chartCache[code];
    if (!cached) return;
    var bars = barsForTimeframe(cached.data.daily, state.timeframe);
    renderLwChart(container.querySelector('#ssChart'), bars);
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

  function lwcThemeOptions(LWC) {
    var dark = document.documentElement.classList.contains('dark');
    return {
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  function renderLwChart(container, bars) {
    if (lwcChart) { try { lwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ } lwcChart = null; }

    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;
      if (container.querySelector('.ss-hint')) container.innerHTML = '';

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: 420,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        localization: { priceFormatter: function (v) { return Math.round(v).toLocaleString(); } },
        rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.22 } }
      }, lwcThemeOptions(LWC)));
      lwcChart = chart;

      var candleSeries = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      candleSeries.setData(bars.map(function (d) {
        return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
      }));

      // 거래량은 캔들과 같은 패널 하단 20%에 별도 가격축(overlay)으로 겹쳐 그린다(HTS 관례).
      var volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'ss-volume'
      });
      chart.priceScale('ss-volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeries.setData(bars.map(function (d) {
        return { time: d.date, value: d.volume || 0, color: d.close >= d.open ? 'rgba(210,79,69,0.5)' : 'rgba(18,97,196,0.5)' };
      }));

      chart.timeScale().fitContent();
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
  function fmtEokWon(v) { return v == null ? '-' : Math.round(v).toLocaleString('ko-KR') + '억원'; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  global.StockSearch = { init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
