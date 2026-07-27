/**
 * 실시간 호가창(증권사 HTS 스타일) - 독립 Tistory Page(/page/order-book 예정,
 * <div id="order-book"> 임베드) 위젯. 2026-07-27 신설.
 *
 * 매도/매수 각 10단계 잔량 사다리는 VM(goodbyestar.cloud/order-book/{code}, 키움 REST
 * ka10004 주식호가요청)을 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만 허용) -
 * js/kospi-futures.js의 /futures와 동일 패턴. 현재가/등락률은 이미 검증된 기존 GAS 시세
 * 프록시(?codes=)를 그대로 재사용한다(호가 사다리와 별도 소스지만 같은 2초 주기로 갱신).
 *
 * 종목 검색은 watchlist.js/foreign-flow.js와 동일한 KRX_MAP 자동완성 패턴.
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var VM_ORDER_BOOK_URL = 'https://goodbyestar.cloud/order-book/';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var CONTAINER_SELECTOR = '#order-book';
  var POLL_MS = 2000;
  var MAX_SUGGESTIONS = 8;
  var FETCH_TIMEOUT_MS = 8000;
  // 3D 산점도(현재가 대비 가격차 x 경과시간 x 잔량) - "매도벽을 현재가가 뚫고 지나가는
  // 과정을 보고 싶다"(2026-07-27 사용자 피드백)는 요구라 1분으로는 너무 짧아서 3분(2초
  // 간격 폴링 기준 90틱)으로 늘림 - 벽이 무너지는 데 걸리는 시간을 고려한 값.
  var HISTORY_MAX = 90;
  var PLOTLY_CDN = 'https://cdn.plot.ly/plotly-gl3d-2.35.2.min.js';

  var state = {
    code: null,
    name: null,
    timer: null,
    // history[i] = { t: ms, base: 그 시점 현재가(없으면 직전 값 유지), asks:[{price,qty}], bids:[{price,qty}] }
    history: [],
    startTime: null,
    lastBase: null,     // 직전 tick의 현재가(quote 조회가 실패한 틱에서 이어받을 기준가)
    viewMode: 'ladder'  // 'ladder' | '3d'
  };
  var plotlyLoadPromise = null;

  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙)
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    return '<img class="ob-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireSearch(container);
    wireViewToggle(container);
  }

  function wireViewToggle(container) {
    container.querySelectorAll('.ob-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(container, btn.getAttribute('data-view'));
      });
    });
  }

  function setViewMode(container, mode) {
    if (state.viewMode === mode) return;
    state.viewMode = mode;
    container.querySelectorAll('.ob-view-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === mode);
    });
    container.querySelector('#obBoard').hidden = mode !== 'ladder';
    container.querySelector('#ob3d').hidden = mode !== '3d';
    if (mode === '3d') render3D(container);
  }

  function buildShell() {
    return ''
      + '<div class="ob-search">'
      + '<div class="ob-input-wrap">'
      + '<input type="text" id="obInput" class="ob-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="obSuggest" class="ob-suggest"></div>'
      + '</div>'
      + '<button type="button" id="obGoBtn" class="ob-go-btn">조회</button>'
      + '</div>'
      + '<div class="ob-view-toggle">'
      + '<button type="button" class="ob-view-btn active" data-view="ladder">호가창</button>'
      + '<button type="button" class="ob-view-btn" data-view="3d">3D 산점도</button>'
      + '</div>'
      + '<div id="obBoard" class="ob-board"><div class="ob-hint">종목을 검색해서 호가창을 확인해보세요.</div></div>'
      + '<div id="ob3d" class="ob-3d" hidden><div id="ob3dPlot" class="ob-3d-plot"></div><div class="ob-3d-legend">X 현재가 대비 가격차(0=현재가) · Y 경과(초) · Z 잔량(점 크기도 비례) · 색상은 범례 참고 · 최근 약 3분(' + HISTORY_MAX + '틱) 누적, 드래그로 회전</div></div>';
  }

  // ---- 검색/자동완성 (watchlist.js와 동일 패턴) ----

  function wireSearch(container) {
    var input = container.querySelector('#obInput');
    var suggestBox = container.querySelector('#obSuggest');
    var goBtn = container.querySelector('#obGoBtn');

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions(suggestBox);
        selectByQuery(container, input.value.trim());
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    goBtn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      selectByQuery(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
  }

  function renderSuggestions(container, box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    var starts = [], contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) { if (starts.length < MAX_SUGGESTIONS) starts.push(name); }
      else if (lower.indexOf(q) > -1) { if (contains.length < MAX_SUGGESTIONS) contains.push(name); }
    }
    var matches = starts.concat(contains).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="ob-suggest-item" data-name="' + escapeAttr(name) + '">' + stockIconHtml(map[name]) + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.ob-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#obInput').value = name;
        hideSuggestions(box);
        selectByQuery(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만(watchlist.js와 동일 로직).
  function resolveStock(query) {
    if (!query) return null;
    var map = global.KRX_MAP || {};
    if (/^[0-9A-Z]{6}$/i.test(query)) {
      for (var nm in map) {
        if (map.hasOwnProperty(nm) && map[nm].toUpperCase() === query.toUpperCase()) {
          return { code: map[nm], name: nm };
        }
      }
      return null;
    }
    if (map.hasOwnProperty(query)) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var matches = [];
    for (var name in map) {
      if (map.hasOwnProperty(name) && name.toLowerCase().indexOf(q) > -1) matches.push(name);
    }
    if (matches.length === 1) return { code: map[matches[0]], name: matches[0] };
    return null;
  }

  function selectByQuery(container, query) {
    var stock = resolveStock(query);
    var board = container.querySelector('#obBoard');
    if (!stock) {
      board.innerHTML = '<div class="ob-hint ob-error">종목을 찾을 수 없습니다: "' + escapeHtml(query) + '"</div>';
      return;
    }
    selectStock(container, stock.code, stock.name);
  }

  // ---- 폴링 ----

  function selectStock(container, code, name) {
    state.code = code;
    state.name = name;
    state.history = [];
    state.startTime = Date.now();
    state.lastBase = null;
    if (state.timer) clearInterval(state.timer);

    var board = container.querySelector('#obBoard');
    board.innerHTML = '<div class="ob-hint"><div class="ob-spinner"></div>' + escapeHtml(name) + ' 호가 불러오는 중...</div>';
    var plot3d = container.querySelector('#ob3dPlot');
    if (plot3d) plot3d.innerHTML = '';

    tick(container);
    state.timer = setInterval(function () { tick(container); }, POLL_MS);
  }

  function tick(container) {
    var code = state.code;
    if (!code) return;
    // 호가(order-book)와 시세(quote)는 서로 다른 소스라 하나만 실패할 수 있다 - 특히 시세만
    // 실패해도 호가 사다리/3D 누적은 계속돼야 하므로(recordSnapshot의 기준가 이어받기가
    // 뜻이 있으려면) 각각 독립적으로 실패를 흡수하고, 정작 중요한 호가만 없을 때만 에러로 취급.
    Promise.all([
      OrderBook.fetchOrderBook(code),
      OrderBook.fetchQuote(code).catch(function () { return null; })
    ])
      .then(function (results) {
        if (state.code !== code) return; // 응답 오는 사이 다른 종목을 골랐으면 무시(레이스 방지)
        var book = results[0];
        var quote = results[1];
        if (book && (book.asks.length || book.bids.length)) {
          recordSnapshot(book, quote);
          if (state.viewMode === '3d') render3D(container);
        }
        renderBoard(container, book, quote);
      })
      .catch(function () {
        if (state.code !== code) return;
        var board = container.querySelector('#obBoard');
        if (board && !board.querySelector('.ob-table')) {
          board.innerHTML = '<div class="ob-hint ob-error">호가 데이터를 불러오지 못했어요. 다음 갱신에 자동으로 재시도합니다.</div>';
        }
      });
  }

  function recordSnapshot(book, quote) {
    // quote 조회가 이번 틱에 실패했으면(호가는 왔는데 시세만 실패) 직전 기준가를 그대로
    // 이어받는다 - 기준가가 갑자기 사라져서 X축(현재가 대비 가격차)이 튀는 걸 방지.
    var base = (quote && quote.price != null) ? Number(quote.price) : state.lastBase;
    if (base != null) state.lastBase = base;
    state.history.push({ t: Date.now(), base: base, asks: book.asks, bids: book.bids });
    if (state.history.length > HISTORY_MAX) state.history.shift();
  }

  function fetchOrderBook(code) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(VM_ORDER_BOOK_URL + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('order-book API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchQuote(code) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?codes=' + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return (data && data[0]) || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ---- 렌더링 ----

  function renderBoard(container, book, quote) {
    var board = container.querySelector('#obBoard');
    if (!book || (!book.asks.length && !book.bids.length)) {
      board.innerHTML = '<div class="ob-hint">호가 정보가 없는 종목이거나 장 운영시간이 아니에요.</div>';
      return;
    }

    var maxQty = 0;
    book.asks.forEach(function (r) { if (r.qty > maxQty) maxQty = r.qty; });
    book.bids.forEach(function (r) { if (r.qty > maxQty) maxQty = r.qty; });
    if (!maxQty) maxQty = 1;

    var priceCls = quote ? signClass(quote.changeRate) : '';
    var priceNum = quote ? Number(quote.price).toLocaleString('ko-KR') + '원' : '-';
    var changeText = quote
      ? (quote.changeRate >= 0 ? '+' : '') + quote.changeRate.toFixed(2) + '% (' + (quote.change >= 0 ? '+' : '') + Number(quote.change).toLocaleString('ko-KR') + '원)'
      : '';

    var headerHtml = '<div class="ob-header">'
      + stockIconHtml(state.code)
      + '<span class="ob-header-name">' + escapeHtml(state.name) + '</span>'
      + '<span class="ob-header-code">(' + escapeHtml(state.code) + ')</span>'
      + '<span class="ob-header-price ' + priceCls + '">' + priceNum + '</span>'
      + (changeText ? '<span class="ob-header-change ' + priceCls + '">' + changeText + '</span>' : '')
      + '</div>';

    var askRows = book.asks.map(function (r) { return rowHtml(r, maxQty, 'ask'); }).join('');
    var bidRows = book.bids.map(function (r) { return rowHtml(r, maxQty, 'bid'); }).join('');

    var totalAsk = book.totalAskQty || 0;
    var totalBid = book.totalBidQty || 0;
    var totalSum = totalAsk + totalBid || 1;
    var askPct = (totalAsk / totalSum * 100).toFixed(1);
    var bidPct = (totalBid / totalSum * 100).toFixed(1);

    var footerHtml = '<div class="ob-footer">'
      + '<div class="ob-footer-label">총잔량 <span class="ob-ask-text">매도 ' + fmtQty(totalAsk) + '</span> · <span class="ob-bid-text">매수 ' + fmtQty(totalBid) + '</span></div>'
      + '<div class="ob-footer-bar"><span class="ob-footer-bar-ask" style="width:' + askPct + '%"></span><span class="ob-footer-bar-bid" style="width:' + bidPct + '%"></span></div>'
      + '</div>';

    board.innerHTML = headerHtml
      + '<div class="ob-table">' + askRows + '<div class="ob-current-row ' + priceCls + '">' + priceNum + (changeText ? ' <span class="ob-current-change">' + changeText + '</span>' : '') + '</div>' + bidRows + '</div>'
      + footerHtml;
  }

  function rowHtml(row, maxQty, side) {
    var pct = Math.max(2, Math.round(row.qty / maxQty * 100));
    var barCls = side === 'ask' ? 'ob-bar-ask' : 'ob-bar-bid';
    var textCls = side === 'ask' ? 'ob-ask-text' : 'ob-bid-text';
    return '<div class="ob-row ob-row-' + side + '">'
      + '<span class="ob-qty ' + textCls + '">' + fmtQty(row.qty) + '</span>'
      + '<span class="ob-bar-wrap"><span class="' + barCls + '" style="width:' + pct + '%"></span></span>'
      + '<span class="ob-price ' + textCls + '">' + Math.round(row.price).toLocaleString('ko-KR') + '</span>'
      + '</div>';
  }

  // ---- 3D 산점도 (가격 x 경과시간 x 잔량) ----
  // Plotly gl3d 최소 번들만 CDN에서 1회 지연 로드(TradingView Lightweight Charts를 쓰는
  // 다른 위젯들과 동일한 "필요할 때만" 패턴 - js/foreign-flow.js의 loadLightweightCharts 참고).
  function loadPlotly() {
    if (global.Plotly) return Promise.resolve(global.Plotly);
    if (plotlyLoadPromise) return plotlyLoadPromise;
    plotlyLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PLOTLY_CDN;
      s.onload = function () { resolve(global.Plotly); };
      s.onerror = function () { plotlyLoadPromise = null; reject(new Error('3D 차트 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return plotlyLoadPromise;
  }

  function render3D(container) {
    var plotEl = container.querySelector('#ob3dPlot');
    if (!plotEl) return;
    if (!state.history.some(function (s) { return s.base != null; })) {
      plotEl.innerHTML = '<div class="ob-hint">데이터를 모으는 중이에요 (2초마다 한 틱씩 쌓입니다)...</div>';
      return;
    }

    loadPlotly().then(function (Plotly) {
      // loadPlotly가 비동기라 그 사이 다른 종목으로 바꿨거나 뷰를 다시 전환했을 수 있음.
      if (state.viewMode !== '3d' || !container.isConnected) return;
      if (plotEl.querySelector('.ob-hint')) plotEl.innerHTML = '';

      var traces = buildPlotlyTraces();
      var dark = document.documentElement.classList.contains('dark');
      var gridColor = dark ? '#3a3a3a' : '#e5e5e5';
      var textColor = dark ? '#ccc' : '#444';
      var layout = {
        margin: { l: 0, r: 0, t: 10, b: 0 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        scene: {
          // X=0이 항상 "그 틱 시점의 현재가" - 매도벽(양수 X)이 시간(Y)이 지나며 0쪽으로
          // 다가오거나 잔량(Z)이 줄어드는 걸 보면 현재가가 벽을 뚫는 과정을 읽을 수 있다
          // (2026-07-27 사용자 요청). zeroline은 옅게(청록 "현재가" 트레이스가 이미 선으로
          // 그 위치를 또렷하게 그려주므로 배경 기준선은 은은한 보조 표시로만 남긴다).
          xaxis: {
            title: '현재가 대비 가격차(원)', color: textColor, gridcolor: gridColor,
            zeroline: true, zerolinecolor: CURRENT_PRICE_COLOR, zerolinewidth: 2
          },
          yaxis: { title: '경과(초)', color: textColor, gridcolor: gridColor },
          zaxis: { title: '잔량', color: textColor, gridcolor: gridColor },
          bgcolor: 'rgba(0,0,0,0)'
        },
        showlegend: true,
        legend: { font: { color: textColor }, x: 0, y: 1 }
      };
      Plotly.react(plotEl, traces, layout, { displayModeBar: false, responsive: true });
    }).catch(function () {
      plotEl.innerHTML = '<div class="ob-hint ob-error">3D 차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  var CURRENT_PRICE_COLOR = '#0ca678'; // 매도(파랑)/매수(빨강)와 겹치지 않는 별도 색(청록)

  function buildPlotlyTraces() {
    var startTime = state.startTime || Date.now();
    var ask = { x: [], y: [], z: [], text: [], qty: [] };
    var bid = { x: [], y: [], z: [], text: [], qty: [] };
    var cur = { x: [], y: [], z: [], text: [] }; // 현재가 궤적(항상 X=0) - 매도/매수와 구분되는 색으로 표시
    var maxQty = 1;

    state.history.forEach(function (snap) {
      if (snap.base == null) return; // 첫 틱들 중 시세 조회가 아직 안 된 구간은 기준가가 없어 skip
      var elapsed = Number(((snap.t - startTime) / 1000).toFixed(1));
      snap.asks.forEach(function (r) {
        var diff = r.price - snap.base;
        ask.x.push(diff); ask.y.push(elapsed); ask.z.push(r.qty); ask.qty.push(r.qty);
        ask.text.push('매도 ' + Math.round(r.price).toLocaleString('ko-KR') + '원(현재가 ' + (diff >= 0 ? '+' : '') + Math.round(diff).toLocaleString('ko-KR') + ') · 잔량 ' + fmtQty(r.qty) + ' · ' + elapsed + '초');
        if (r.qty > maxQty) maxQty = r.qty;
      });
      snap.bids.forEach(function (r) {
        var diff = r.price - snap.base;
        bid.x.push(diff); bid.y.push(elapsed); bid.z.push(r.qty); bid.qty.push(r.qty);
        bid.text.push('매수 ' + Math.round(r.price).toLocaleString('ko-KR') + '원(현재가 ' + (diff >= 0 ? '+' : '') + Math.round(diff).toLocaleString('ko-KR') + ') · 잔량 ' + fmtQty(r.qty) + ' · ' + elapsed + '초');
        if (r.qty > maxQty) maxQty = r.qty;
      });
      cur.x.push(0); cur.y.push(elapsed); cur.z.push(0);
      cur.text.push('현재가 ' + Math.round(snap.base).toLocaleString('ko-KR') + '원 · ' + elapsed + '초');
    });

    // 잔량이 클수록(=벽이 셀수록) 점도 커 보이게 - Z높이만으로는 회전시켜 보면 크기 비교가
    // 어려워서 마커 크기에도 같은 신호를 이중으로 인코딩.
    function sizeOf(qtyArr) {
      return qtyArr.map(function (q) { return 3 + (q / maxQty) * 13; });
    }

    return [
      {
        type: 'scatter3d', mode: 'markers', name: '매도(위쪽 벽)',
        x: ask.x, y: ask.y, z: ask.z, text: ask.text, hoverinfo: 'text',
        marker: { size: sizeOf(ask.qty), color: '#1261c4', opacity: 0.75 }
      },
      {
        type: 'scatter3d', mode: 'markers', name: '매수(아래쪽 벽)',
        x: bid.x, y: bid.y, z: bid.z, text: bid.text, hoverinfo: 'text',
        marker: { size: sizeOf(bid.qty), color: '#d24f45', opacity: 0.75 }
      },
      {
        // 현재가는 X=0 정의상 항상 이 선 위에 있으므로 매도/매수와 다른 색(청록) 선+점으로
        // 눈에 띄게 표시 - X=0 zeroline과 겹쳐 그려져 "여기가 현재가"를 이중으로 강조한다.
        type: 'scatter3d', mode: 'lines+markers', name: '현재가',
        x: cur.x, y: cur.y, z: cur.z, text: cur.text, hoverinfo: 'text',
        line: { color: CURRENT_PRICE_COLOR, width: 5 },
        marker: { size: 3, color: CURRENT_PRICE_COLOR }
      }
    ];
  }

  function fmtQty(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v).toLocaleString('ko-KR');
  }

  function signClass(rate) {
    if (rate > 0) return 'ob-up';
    if (rate < 0) return 'ob-down';
    return 'ob-flat';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  var OrderBook = { init: init, fetchOrderBook: fetchOrderBook, fetchQuote: fetchQuote };
  global.OrderBook = OrderBook;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
