/* 홈 증권사형 실시간 종목판. 초기 목록은 REST, 변경된 숫자는 WebSocket으로 갱신한다. */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/market-board';
  var WS_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var WS_RECONNECT_MIN_MS = 1500;
  var WS_RECONNECT_MAX_MS = 30000;
  var LIMIT = 20;
  var REFRESH_MS = 30 * 1000;
  // 한국시간 기준으로 국내·미국 시장을 자동 전환한다.
  var FORCED_MARKET = null;
  // Quote ticks stay on WebSocket; this only re-syncs the ranking snapshot.
  var RANK_REFRESH_DEBOUNCE_MS = 5000;
  var SESSION_CHECK_MS = 60 * 1000;
  var TABS = [
    ['tradeAmount', '거래대금'],
    ['tradeVolume', '거래량'],
    ['volumeGrowth', '거래증가율'],
    ['turnover', '거래회전율'],
    ['amountTurnover', '거래대금회전율'],
    ['rising', '상승률'],
    ['falling', '하락률'],
    ['marketCap', '시가총액'],
    ['industry', '업종 TOP']
  ];
  // KIS 해외주식 순위분석 API가 제공하는 미국 순위들만 노출한다.
  // 업종은 별도 업종별 시세 API가 필요한 분류 화면이므로 이 종목판에서는 제외한다.
  var US_TABS = [
    ['tradeAmount', '거래대금'],
    ['tradeVolume', '거래량'],
    ['rising', '상승률'],
    ['falling', '하락률'],
    ['marketCap', '시가총액'],
    ['volumeSurge', '거래량급증'],
    ['volumePower', '체결강도'],
    ['newHigh', '신고가'],
    ['newLow', '신저가']
  ];
  var TABLE_COLUMNS = [
    ['stock', '종목'],
    ['price', '현재가'],
    ['amount', '거래대금'],
    ['volume', '거래량'],
    ['rising', '상승률'],
    ['falling', '하락률'],
    ['cap', '시가총액'],
    ['industry', '업종']
  ];
  var US_TABLE_COLUMNS = TABLE_COLUMNS.slice(0, 7);
  var INDUSTRY_COLUMNS = [
    ['industry', '업종'],
    ['avgChangeRate', '평균등락률'],
    ['tradeAmount', '거래대금'],
    ['stockCount', '종목 수'],
    ['riseRatio', '상승비율'],
    ['leader', '대표 종목']
  ];
  var state = {
    mount: null,
    market: '',
    active: 'tradeAmount',
    data: null,
    socket: null,
    timer: null,
    loading: false,
    rankRefreshTimer: null,
    reconnectTimer: null,
    reconnectDelay: WS_RECONNECT_MIN_MS,
    realtimeGeneration: 0,
    realtimeCodes: []
  };
  var NAVER_ICON_BASE = 'https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var ICONIFY_BASE = 'https://api.iconify.design/';
  var FAVICON_BASE = 'https://icons.duckduckgo.com/ip3/';
  // 로컬 아이콘이 아직 없는 미국 종목은 Iconify의 공개 브랜드 아이콘을 먼저 시도한다.
  // 브랜드 아이콘이 없는 경우에도 회사 공식 도메인의 favicon을 한 번 더 시도해
  // 단순 이니셜 박스로 끝나는 종목을 줄인다.
  var BRAND_ICON_MAP = {
    SPCX: ['simple-icons', 'spacex'],
    SNDK: ['thesvg-color', 'sandisk'],
    INTC: ['simple-icons', 'intel'],
    CSCO: ['simple-icons', 'cisco'],
    WFC: ['simple-icons', 'wellsfargo'],
    GOOGL: ['simple-icons', 'google'],
    GOOG: ['simple-icons', 'google'],
    MCD: ['simple-icons', 'mcdonalds'],
    AZN: ['thesvg-color', 'astrazeneca']
  };
  var BRAND_DOMAIN_MAP = {
    RGTI: 'rigetti.com',
    RKLB: 'rocketlabusa.com',
    ORCL: 'oracle.com',
    LLY: 'lilly.com',
    DELL: 'dell.com',
    IONQ: 'ionq.com',
    SKHY: 'skhynix.com',
    ASTS: 'ast-science.com',
    SPCX: 'spacex.com',
    SNDK: 'sandisk.com',
    INTC: 'intel.com',
    CSCO: 'cisco.com',
    WFC: 'wellsfargo.com',
    MRVL: 'marvell.com',
    MCD: 'mcdonalds.com',
    AZN: 'astrazeneca.com',
    CCL: 'carnival.com',
    HWM: 'howmet.com',
    NSC: 'norfolksouthern.com'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function cssEscape(value) {
    return String(value).replace(/(["\\])/g, '\\$1');
  }

  function stockIconFallback(image) {
    if (!image) return;
    var code = image.getAttribute('data-icon-code') || '';
    var stage = image.getAttribute('data-icon-stage') || 'svg';
    var market = image.getAttribute('data-icon-market') || '';
    var brand = BRAND_ICON_MAP[code];
    var domain = BRAND_DOMAIN_MAP[code];
    if (stage === 'local') {
      image.setAttribute('data-icon-stage', 'naver');
      image.setAttribute('data-icon-naver-code', market === 'us' ? code + '.O' : code);
      image.src = NAVER_ICON_BASE + encodeURIComponent(image.getAttribute('data-icon-naver-code')) + '.svg';
      return;
    }
    if (stage === 'naver') {
      if (market === 'us' && image.getAttribute('data-icon-naver-code') === code + '.O') {
        image.setAttribute('data-icon-naver-code', code);
        image.setAttribute('data-icon-stage', 'naver-bare');
        image.src = NAVER_ICON_BASE + encodeURIComponent(code) + '.svg';
        return;
      }
      image.setAttribute('data-icon-stage', 'png');
      image.src = STOCK_ICON_BASE + encodeURIComponent(code) + '.png';
      return;
    }
    if (stage === 'naver-bare' || stage === 'svg') {
      image.setAttribute('data-icon-stage', 'png');
      image.src = STOCK_ICON_BASE + encodeURIComponent(code) + '.png';
      return;
    }
    if (stage === 'png' && brand) {
      image.setAttribute('data-icon-stage', 'iconify');
      image.src = ICONIFY_BASE + encodeURIComponent(brand[0]) + '/' + encodeURIComponent(brand[1]) + '.svg';
      return;
    }
    if ((stage === 'png' || stage === 'iconify') && domain) {
      image.setAttribute('data-icon-stage', 'favicon');
      image.src = FAVICON_BASE + encodeURIComponent(domain) + '.ico';
      return;
    }
    image.style.display = 'none';
    if (image.nextElementSibling) image.nextElementSibling.hidden = false;
  }

  function number(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : null;
  }

  function currentMarket() {
    if (FORCED_MARKET) return FORCED_MARKET;
    if (global.HomeMarketSelection && typeof global.HomeMarketSelection.get === 'function') {
      return global.HomeMarketSelection.get();
    }
    var now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var hour = now.getUTCHours();
    return hour >= 20 || hour < 8 ? 'us' : 'domestic';
  }

  function tabsForMarket() {
    return state.market === 'us' ? US_TABS : TABS;
  }

  function columnsForMarket() {
    return state.market === 'us' ? US_TABLE_COLUMNS : TABLE_COLUMNS;
  }

  function columnsForActive() {
    return state.market !== 'us' && state.active === 'industry'
      ? INDUSTRY_COLUMNS
      : columnsForMarket();
  }

  function tableColspan() {
    return columnsForActive().length;
  }

  function isWeekendInKst() {
    var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var day = kst.getUTCDay();
    return day === 0 || day === 6;
  }

  function marketLabel(market) {
    return market === 'us' ? '미국 · 오후 08:00~오전 08:00' : '국내 · 오전 08:00~오후 08:00';
  }

  function stockIconHtml(item) {
    var code = String(item.code || item.symbol || '').replace(/^US:/i, '').toUpperCase();
    var market = String(item.market || state.market || currentMarket()).toLowerCase();
    var naverCode = market === 'us' ? code + '.O' : code;
    var initials = String(item.name || item.symbol || code).replace(/\s+/g, '').slice(0, 2);
    if (!code) return '<span class="hrt-stock-logo hrt-stock-logo--fallback">?</span>';
    return '<span class="hrt-stock-logo"><img src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" '
      + 'data-icon-code="' + escapeHtml(code) + '" data-icon-market="' + escapeHtml(market) + '" data-icon-naver-code="' + escapeHtml(naverCode) + '" data-icon-stage="local" referrerpolicy="no-referrer" '
      + 'onerror="window.HomeRealtimeTableIconFallback(this);" />'
      + '<span class="hrt-stock-logo--fallback" hidden>' + escapeHtml(initials) + '</span></span>';
  }

  function industryFor(item) {
    var code = String(item.code || item.symbol || '').replace(/^US:/i, '').toUpperCase();
    var industry = item.industry || '';
    var name = String(item.name || item.symbol || '').trim();
    var mapped = global.WICS_MAP && (global.WICS_MAP[code] || global.WICS_MAP[String(code).padStart(6, '0')]);
    if ((!industry || industry === '미분류') && mapped) {
      industry = mapped.industry || mapped.sector || '';
    }
    if (!industry || industry === '미분류') {
      if (/ETF|레버리지|인버스|KODEX|TIGER|ACE|SOL|RISE|KOSEF|HANARO|KBSTAR|ARIRANG|PLUS|TIMEFOLIO|FOCUS|1Q/i.test(name)) {
        return 'ETF';
      }
      return item.market === 'us' ? '미국주식' : '기타';
    }
    return industry;
  }

  function fmtPrice(value, currency) {
    var parsed = number(value);
    if (parsed == null) return '-';
    return currency === 'USD'
      ? '$' + parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(parsed).toLocaleString('ko-KR') + '원';
  }

  function fmtCount(value) {
    var parsed = number(value);
    if (parsed == null) return '-';
    if (Math.abs(parsed) >= 100000000) return (parsed / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
    if (Math.abs(parsed) >= 10000) return (parsed / 10000).toFixed(1).replace(/\.0$/, '') + '만';
    return Math.round(parsed).toLocaleString('ko-KR');
  }

  function fmtAmount(value, currency) {
    var parsed = number(value);
    if (parsed == null) return '-';
    if (currency === 'USD') {
      if (parsed >= 1000000000) return '$' + (parsed / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
      if (parsed >= 1000000) return '$' + (parsed / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      return '$' + Math.round(parsed).toLocaleString('en-US');
    }
    // 한국 원화 단위에서 1조 = 1,000,000,000,000원(10^12)이다.
    // 10^11로 나누면 거래대금·시가총액이 모두 10배 크게 표시된다.
    if (parsed >= 1000000000000) return (parsed / 1000000000000).toFixed(1).replace(/\.0$/, '') + '조';
    if (parsed >= 100000000) return (parsed / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
    return Math.round(parsed).toLocaleString('ko-KR') + '원';
  }

  function fmtMarketCap(value, currency) {
    var parsed = number(value);
    if (parsed == null || parsed <= 0) return '-';
    return currency === 'USD'
      ? fmtAmount(parsed * 1000000, currency)
      : fmtAmount(parsed * 100000000, currency);
  }

  function rateCell(rate, positive) {
    var parsed = number(rate);
    if (parsed == null || (positive ? parsed <= 0 : parsed >= 0)) return '<span class="hrt-muted">-</span>';
    return '<span class="hrt-' + (positive ? 'up' : 'down') + '">' + (positive ? '▲' : '▼')
      + Math.abs(parsed).toFixed(2) + '%</span>';
  }

  function signedRate(rate) {
    var parsed = number(rate);
    if (parsed == null) return '<span class="hrt-muted">-</span>';
    var cls = parsed > 0 ? 'hrt-up' : parsed < 0 ? 'hrt-down' : 'hrt-flat';
    return '<span class="' + cls + '">' + (parsed > 0 ? '+' : '') + parsed.toFixed(2) + '%</span>';
  }

  function ratioPct(ratio) {
    var parsed = number(ratio);
    if (parsed == null) return '<span class="hrt-muted">-</span>';
    return (parsed * 100).toFixed(1) + '%';
  }

  function rowHtml(item, rank) {
    var code = item.code || item.symbol;
    var rate = number(item.change_rate);
    var tone = rate > 0 ? 'hrt-up' : rate < 0 ? 'hrt-down' : 'hrt-flat';
    var industry = industryFor(item);
    if ((!industry || industry === '미분류') && global.WICS_MAP && global.WICS_MAP[code]) {
      industry = global.WICS_MAP[code].industry || global.WICS_MAP[code].sector || '';
    }
    var cells = {
      stock: '<td class="hrt-stock"><span class="hrt-rank">' + rank + '</span>' + stockIconHtml(item) + '<a href="/page/stock-search?code=' + encodeURIComponent(code)
        + '&name=' + encodeURIComponent(item.name || code) + '"><strong>' + escapeHtml(item.name || code) + '</strong><small>'
        + escapeHtml(item.symbol || code) + '</small></a></td>',
      price: '<td class="hrt-price" data-field="price">' + fmtPrice(item.price, item.currency) + '</td>',
      amount: '<td data-field="amount">' + fmtAmount(item.trade_amount, item.currency) + '</td>',
      volume: '<td data-field="volume">' + fmtCount(item.trade_volume) + '</td>',
      rising: '<td data-field="rising">' + rateCell(rate, true) + '</td>',
      falling: '<td data-field="falling">' + rateCell(rate, false) + '</td>',
      cap: '<td data-field="cap">' + fmtMarketCap(item.market_cap, item.currency) + '</td>',
      industry: '<td class="hrt-industry" title="' + escapeHtml(industry) + '">' + escapeHtml(industry || '-') + '</td>'
    };
    return '<tr data-code="' + escapeHtml(code) + '">' + columnsForMarket().map(function (column) {
      return cells[column[0]];
    }).join('') + '</tr>';
  }

  function industryRowHtml(item, rank) {
    var leader = item.leader_name || '-';
    var leaderRate = signedRate(item.leader_change_rate);
    var cells = {
      industry: '<td class="hrt-stock"><span class="hrt-rank">' + rank + '</span><strong>'
        + escapeHtml(item.industry || '업종 미분류') + '</strong><small>' + Number(item.stock_count || 0) + '종목 집계</small></td>',
      avgChangeRate: '<td class="hrt-price" data-field="avgChangeRate">' + signedRate(item.avg_change_rate) + '</td>',
      tradeAmount: '<td data-field="tradeAmount">' + fmtAmount(item.trade_amount, 'KRW') + '</td>',
      stockCount: '<td data-field="stockCount">' + Number(item.stock_count || 0).toLocaleString('ko-KR') + '개</td>',
      riseRatio: '<td data-field="riseRatio">' + ratioPct(item.rise_ratio) + ' <small>(' + Number(item.rising_count || 0) + ' 상승)</small></td>',
      leader: '<td class="hrt-industry" data-field="leader">' + escapeHtml(leader) + '<small> ' + leaderRate + '</small></td>'
    };
    return '<tr class="hrt-industry-row">' + INDUSTRY_COLUMNS.map(function (column) {
      return cells[column[0]];
    }).join('') + '</tr>';
  }

  function renderTableHead() {
    var head = state.mount && state.mount.querySelector('.hrt-table-wrap thead tr');
    if (!head) return;
    head.innerHTML = columnsForActive().map(function (column) {
      return '<th>' + column[1] + '</th>';
    }).join('');
  }

  function emptyStateText() {
    if (state.active === 'industry') return '업종 분류 데이터가 없습니다.';
    if (state.market === 'domestic' && ['volumeGrowth', 'turnover', 'amountTurnover'].indexOf(state.active) >= 0) {
      return '국내시장 휴장 또는 해당 순위 데이터가 없습니다.';
    }
    return '현재 세션의 종목 데이터가 없습니다.';
  }

  function buildShell(mount) {
    var tabs = tabsForMarket();
    var columns = columnsForActive();
    var colspan = columns.length;
    // home-widgets.js decorates this mount with the common drag/menu controls
    // before the realtime table module initializes. Preserve those controls
    // when the table shell is rebuilt on market switch.
    var widgetActions = mount.querySelector('.home-widget-actions');
    if (widgetActions) widgetActions.remove();
    mount.innerHTML = '<div class="hrt-head"><div><strong>실시간 종목판</strong><span data-hrt-session></span></div>'
      + '<small data-hrt-updated>시세 확인 중 · <span data-hrt-connection>실시간 연결 중</span></small></div>'
      + '<div class="hrt-tabs" role="tablist" aria-label="실시간 종목 정렬">'
      + tabs.map(function (tab) {
        return '<button type="button" role="tab" data-hrt-tab="' + tab[0] + '" aria-selected="' + (tab[0] === state.active) + '">' + tab[1] + '</button>';
      }).join('') + '</div>'
      + '<div class="hrt-table-wrap"><table><thead><tr>' + columns.map(function (column) {
        return '<th>' + column[1] + '</th>';
      }).join('') + '</tr></thead>'
      + '<tbody data-hrt-body><tr><td colspan="' + colspan + '" class="hrt-state">실시간 종목을 불러오는 중입니다.</td></tr></tbody></table></div>'
      + '<div class="hrt-foot"><span data-hrt-foot>체결 발생 행만 갱신</span></div>';

    if (widgetActions) mount.appendChild(widgetActions);
  }

  function rowsForActive() {
    var sections = state.data && state.data.sections;
    if (state.active === 'industry') return (sections && sections.industry) || [];
    if (sections && Array.isArray(sections[state.active])) return sections[state.active];
    return (state.data && state.data.rows) || [];
  }

  function renderRows() {
    if (!state.mount) return;
    var body = state.mount.querySelector('[data-hrt-body]');
    if (!body) return;
    var rows = rowsForActive();
    body.innerHTML = rows.length
      ? rows.map(function (item, index) {
        return state.active === 'industry' ? industryRowHtml(item, index + 1) : rowHtml(item, index + 1);
      }).join('')
      : '<tr><td colspan="' + tableColspan() + '" class="hrt-state">' + emptyStateText() + '</td></tr>';
    renderTableHead();
    var foot = state.mount.querySelector('[data-hrt-foot]');
    if (foot) foot.textContent = state.active === 'industry'
      ? '평균등락률 → 상승비율 → 거래대금 순 · 현재 수집 후보 기준'
      : '체결 발생 행만 갱신';
    state.mount.querySelectorAll('[data-hrt-tab]').forEach(function (button) {
      var selected = button.getAttribute('data-hrt-tab') === state.active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function stopRealtime() {
    state.realtimeGeneration += 1;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
      state.socket = null;
    }
  }

  function setRealtimeStatus(text) {
    var element = state.mount && state.mount.querySelector('[data-hrt-connection]');
    if (element) element.textContent = text;
  }

  function scheduleRankRefresh() {
    if (document.hidden || !state.data || state.rankRefreshTimer) return;
    state.rankRefreshTimer = setTimeout(function () {
      state.rankRefreshTimer = null;
      if (!document.hidden && state.data) fetchBoard(true);
    }, RANK_REFRESH_DEBOUNCE_MS);
  }

  function scheduleRealtimeReconnect(generation) {
    if (generation !== state.realtimeGeneration || document.hidden || !state.realtimeCodes.length) return;
    if (state.reconnectTimer) return;
    var delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(WS_RECONNECT_MAX_MS, Math.round(state.reconnectDelay * 1.8));
    setRealtimeStatus('재연결 중');
    state.reconnectTimer = setTimeout(function () {
      state.reconnectTimer = null;
      connectRealtime(generation);
    }, delay);
  }

  function connectRealtime(generation) {
    if (generation !== state.realtimeGeneration || document.hidden || !state.realtimeCodes.length) return;
    var socket;
    try {
      socket = new WebSocket(WS_URL + '?codes=' + state.realtimeCodes.map(encodeURIComponent).join(','));
    } catch (error) {
      setRealtimeStatus('재연결 중');
      scheduleRealtimeReconnect(generation);
      return;
    }
    state.socket = socket;
    setRealtimeStatus('실시간 연결 중');
    socket.onopen = function () {
      if (generation !== state.realtimeGeneration || state.socket !== socket) return;
      state.reconnectDelay = WS_RECONNECT_MIN_MS;
      setRealtimeStatus('실시간 연결됨');
    };
    socket.onmessage = function (event) {
      try {
        var quote = JSON.parse(event.data);
        if (quote.type === 'quote' && quote.code) {
          updateRow(quote.code, quote);
          scheduleRankRefresh();
        }
      } catch (error) {}
    };
    socket.onerror = function () {
      if (generation === state.realtimeGeneration && state.socket === socket) socket.close();
    };
    socket.onclose = function () {
      if (generation !== state.realtimeGeneration || state.socket !== socket) return;
      state.socket = null;
      scheduleRealtimeReconnect(generation);
    };
  }

  function startRealtime() {
    var data = state.data || {};
    var all = [];
    var seen = {};
    Object.keys(data.sections || {}).forEach(function (key) {
      (data.sections[key] || []).forEach(function (item) {
        if (item && item.code && !seen[item.code]) { seen[item.code] = true; all.push(item.code); }
      });
    });
    var sameCodes = all.length === state.realtimeCodes.length && all.every(function (code, index) {
      return state.realtimeCodes[index] === code;
    });
    if (sameCodes && (state.socket || state.reconnectTimer)) return;
    if (!sameCodes) stopRealtime();
    state.realtimeCodes = all;
    state.reconnectDelay = WS_RECONNECT_MIN_MS;
    if (!all.length || !('WebSocket' in global) || document.hidden) {
      setRealtimeStatus(document.hidden ? '화면 복귀 시 연결' : '실시간 연결 불가');
      return;
    }
    connectRealtime(state.realtimeGeneration);
  }

  function updateRow(code, quote) {
    var row = state.mount && state.mount.querySelector('tr[data-code="' + cssEscape(code) + '"]');
    if (!row) return;
    var price = number(quote.price);
    var rate = number(quote.changeRate);
    var item = null;
    Object.keys((state.data && state.data.sections) || {}).some(function (key) {
      return (state.data.sections[key] || []).some(function (candidate) {
        if (candidate.code !== code) return false;
        item = candidate;
        return true;
      });
    });
    if (!item) item = (state.data && state.data.rows || []).find(function (candidate) { return candidate.code === code; });
    if (item) { if (price != null) item.price = price; if (rate != null) item.change_rate = rate; }
    var priceCell = row.querySelector('[data-field="price"]');
    if (priceCell && price != null) priceCell.textContent = fmtPrice(price, item && item.currency);
    var rising = row.querySelector('[data-field="rising"]');
    var falling = row.querySelector('[data-field="falling"]');
    if (rising) rising.innerHTML = rateCell(rate, true);
    if (falling) falling.innerHTML = rateCell(rate, false);
  }

  function fetchBoard(force) {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    var market = currentMarket();
    if (market !== state.market) {
      state.market = market;
      state.active = 'tradeAmount';
      stopRealtime();
      buildShell(state.mount);
    }
    var url = API_URL + '?market=' + market + '&limit=' + LIMIT + (force ? '&fresh=1' : '');
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('market-board ' + response.status);
      return response.json();
    }).then(function (json) {
      state.data = json.data || json;
      var session = state.mount.querySelector('[data-hrt-session]');
      var updated = state.mount.querySelector('[data-hrt-updated]');
      if (session) session.textContent = state.data.session || marketLabel(market);
      if (updated) updated.textContent = (isWeekendInKst() ? '최근 장마감 · ' : '실시간 · ')
        + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
      renderRows();
      startRealtime();
    }).catch(function () {
      var body = state.mount.querySelector('[data-hrt-body]');
      if (body && !state.data) body.innerHTML = '<tr><td colspan="' + tableColspan() + '" class="hrt-state">종목 데이터를 잠시 불러오지 못했습니다.</td></tr>';
    }).then(function () {
      state.loading = false;
    });
  }

  function init(options) {
    var mount = options && options.mount;
    if (!mount || mount.getAttribute('data-hrt-ready') === '1') return;
    state.mount = mount;
    state.market = currentMarket();
    mount.setAttribute('data-hrt-ready', '1');
    buildShell(mount);
    mount.addEventListener('click', function (event) {
      var tab = event.target.closest ? event.target.closest('[data-hrt-tab]') : null;
      if (!tab) return;
      state.active = tab.getAttribute('data-hrt-tab') || 'tradeAmount';
      renderRows();
    });
    global.addEventListener('home-market-change', function (event) {
      var market = event && event.detail && event.detail.market;
      if (market !== 'us' && market !== 'domestic') return;
      FORCED_MARKET = market;
      fetchBoard(true);
    });
    // wics-map.js(약 220KB)는 업종 라벨 보강용 폴백일 뿐 기본 렌더링에 필수는 아니라서,
    // 첫 로딩 때 이 파일을 다 받을 때까지 종목 데이터 요청을 미루지 않는다(2026-08-14 속도
    // 점검 - 직렬 대기가 최초 표시를 불필요하게 늦추고 있었음). 병렬로 요청하고, 늦게
    // 도착하면 이미 그려진 행을 업종 라벨만 다시 채우도록 재렌더링한다.
    fetchBoard();
    if (!global.WICS_MAP) {
      var script = document.createElement('script');
      script.src = 'https://goodbyestarwars.github.io/tistory-ticker/data/wics-map.js?v=20260810';
      script.onload = function () { if (state.data) renderRows(); };
      document.head.appendChild(script);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopRealtime();
        setRealtimeStatus('화면 비활성');
      } else if (state.data) {
        startRealtime();
      }
    });
    state.timer = setInterval(function () {
      if (!document.hidden) fetchBoard();
    }, REFRESH_MS);
    setInterval(function () {
      if (!document.hidden && currentMarket() !== state.market) fetchBoard();
    }, SESSION_CHECK_MS);
  }

  global.HomeRealtimeTableIconFallback = stockIconFallback;
  global.HomeRealtimeTable = { init: init };
})(window);
