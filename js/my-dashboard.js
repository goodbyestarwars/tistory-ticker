/**
 * MY portfolio screen.
 *
 * Only the user's small portfolio metadata is persisted through /watchlist:
 * symbol, name, quantity and average price. Quotes, charts, order books and
 * analysis remain shared/on-demand data and are never copied into the user's DB.
 */
(function (global) {
  'use strict';

  var API_BASE = 'https://goodbyestar.cloud';
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var VM_URL = API_BASE;
  var FOREIGN_FLOW_SCRIPT = 'https://goodbyestarwars.github.io/tistory-ticker/js/foreign-flow.js?v=20260816-banner-race-fix';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  // 서버에 예전에 저장된 영문 회사명도 MY 화면에서는 동일한 한글 표시명으로 보여준다.
  // 티커(code)는 API 조회와 상세 페이지 이동에 쓰이므로 그대로 유지한다.
  var US_DISPLAY_NAMES = {
    AAPL: '애플', MSFT: '마이크로소프트', NVDA: '엔비디아', AMZN: '아마존',
    GOOGL: '알파벳 A', GOOG: '알파벳 C', TSLA: '테슬라', META: '메타', INTC: '인텔',
    MRVL: '마벨 테크놀로지', AVGO: '브로드컴', AMD: 'AMD', PLTR: '팔란티어',
    SKHY: 'SK하이닉스(ADR)', SPCX: '스페이스X', MSTR: '스트래티지', CRWD: '크라우드스트라이크',
    STX: '씨게이트 테크놀로지', RGTI: '리게티 컴퓨팅', RKLB: '로켓 랩',
    ORCL: '오라클', MU: '마이크론 테크놀로지', CBRS: '세레브라스 시스템즈',
    SNDK: '샌디스크', DELL: '델 테크놀로지스', IONQ: '아이온큐', LLY: '일라이 릴리',
    ASTS: 'AST 스페이스모바일', NFLX: '넷플릭스', SPY: 'S&P 500 ETF', QQQ: '인베스코 QQQ ETF'
  };
  var US_NAME_ALIASES = {
    'sk hynix': 'SKHY', 'sk hynix adr': 'SKHY', 'apple': 'AAPL', 'microsoft': 'MSFT', 'nvidia': 'NVDA', 'amazon': 'AMZN',
    'amazon.com inc': 'AMZN', 'amazon.com, inc.': 'AMZN', 'alphabet': 'GOOGL',
    'google': 'GOOGL', 'tesla': 'TSLA', 'meta platforms inc': 'META', 'meta platforms, inc.': 'META',
    'intel': 'INTC', 'intel corp': 'INTC', 'intel corporation': 'INTC',
    'marvell': 'MRVL', 'marvell technology inc': 'MRVL', 'broadcom': 'AVGO',
    'advanced micro devices': 'AMD', 'advanced micro devices inc': 'AMD', 'palantir': 'PLTR',
    'palantir technologies inc': 'PLTR', 'spacex': 'SPCX', 'space exploration technologies corp': 'SPCX',
    'strategy': 'MSTR', 'strategy inc': 'MSTR', 'microstrategy': 'MSTR',
    'crowdstrike': 'CRWD', 'crowdstrike holdings inc': 'CRWD',
    'seagate': 'STX', 'seagate technology holdings plc': 'STX'
  };
  var state = { selectedCode: null, selectedItem: null, quotes: {}, analyses: {}, requestId: 0, watchlistQuoteAt: 0, watchlistCollapsed: false };
  var mount = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function escapeAttr(value) { return escapeHtml(value); }
  function stockIconUrl(code) {
    var iconCode = String(code || '').replace(/^US:/i, '').toUpperCase();
    return iconCode ? STOCK_ICON_BASE + encodeURIComponent(iconCode) + '.svg' : '';
  }
  function normalizeUsQuery(value) {
    return String(value || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  }
  function localizedUsName(code, fallback) {
    var symbol = String(code || '').replace(/^US:/i, '').toUpperCase();
    return /^US:/i.test(String(code || '')) && US_DISPLAY_NAMES[symbol]
      ? US_DISPLAY_NAMES[symbol]
      : String(fallback || symbol || '종목');
  }
  function usSymbolForQuery(query) {
    var raw = String(query || '').trim();
    var symbol = raw.replace(/^US:/i, '').toUpperCase();
    if (US_DISPLAY_NAMES[symbol]) return symbol;
    var normalized = normalizeUsQuery(raw.replace(/^US:/i, ''));
    if (US_NAME_ALIASES[normalized]) return US_NAME_ALIASES[normalized];
    for (var key in US_DISPLAY_NAMES) {
      if (Object.prototype.hasOwnProperty.call(US_DISPLAY_NAMES, key) && normalizeUsQuery(US_DISPLAY_NAMES[key]) === normalized) return key;
    }
    return null;
  }
  function displayName(item) {
    return localizedUsName(item && item.code, item && item.name);
  }
  function stockInitials(item) {
    var value = String(displayName(item) || item && item.code || '?').replace(/^US:/i, '').trim();
    return escapeHtml(value.slice(0, 2).toUpperCase());
  }
  function stockIconHtml(item) {
    var code = item && item.code || '';
    return '<span class="my-watchlist-icon"><span>' + stockInitials(item) + '</span><img src="' + escapeAttr(stockIconUrl(code)) + '" alt="" loading="lazy" onerror="this.hidden=true;this.previousElementSibling.hidden=false" onload="this.previousElementSibling.hidden=true"></span>';
  }
  function number(value, fallback) {
    if (value == null || value === '') return fallback == null ? null : fallback;
    var normalized = typeof value === 'string'
      ? value.replace(/,/g, '').replace(/%/g, '').replace(/[\u2212\u2013\u2014]/g, '-').trim()
      : value;
    var n = Number(normalized);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }
  function formatNumber(value, digits) {
    var n = number(value, null);
    if (n == null) return '-';
    return n.toLocaleString('ko-KR', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }
  function formatSigned(value, digits) {
    var n = number(value, null);
    if (n == null) return '-';
    return (n > 0 ? '+' : '') + formatNumber(n, digits);
  }
  function formatSignedShares(value) {
    var n = number(value, null);
    return n == null ? '-' : formatSigned(n, 0) + '주';
  }
  function formatPrice(value, code) {
    var n = number(value, null);
    if (n == null) return '-';
    return /^US:/i.test(code) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatNumber(n, 0) + '원';
  }
  function signClass(value) { return number(value) > 0 ? 'is-up' : number(value) < 0 ? 'is-down' : 'is-flat'; }
  function holdingOf(item) {
    var h = item && item.holding || {};
    return { quantity: Math.max(0, number(h.quantity)), averagePrice: Math.max(0, number(h.averagePrice)), horizon: h.horizon === 'long' ? 'long' : 'short' };
  }
  function itemByCode(code) {
    var saved = global.Watchlist.getList().filter(function (item) { return item.code === code; })[0];
    return saved || (state.selectedItem && state.selectedItem.code === code ? state.selectedItem : null);
  }
  function fetchJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.detail || body.message || ('HTTP ' + response.status));
        return body;
      });
    });
  }
  function loadScript(src, marker) {
    if (global.ForeignFlow && marker === 'foreign-flow') return Promise.resolve(global.ForeignFlow);
    var existing = document.querySelector('script[data-my-source="' + marker + '"]');
    if (existing) return new Promise(function (resolve, reject) {
      var started = Date.now();
      var timer = setInterval(function () {
        if (global.ForeignFlow && marker === 'foreign-flow') { clearInterval(timer); resolve(global.ForeignFlow); }
        else if (Date.now() - started > 15000) { clearInterval(timer); reject(new Error(marker + ' load timeout')); }
      }, 50);
    });
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-my-source', marker);
      script.onload = function () { resolve(global.ForeignFlow); };
      script.onerror = function () { reject(new Error(marker + ' load failed')); };
      document.body.appendChild(script);
    });
  }
  function waitForWatchlist() {
    if (global.Watchlist) return Promise.resolve(global.Watchlist);
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var timer = setInterval(function () {
        if (global.Watchlist) { clearInterval(timer); resolve(global.Watchlist); }
        else if (Date.now() - started > 15000) { clearInterval(timer); reject(new Error('watchlist load timeout')); }
      }, 50);
    });
  }
  function mountPage() {
    var watchlistMount = document.getElementById('watchlist');
    if (!watchlistMount) return null;
    watchlistMount.classList.add('my-source-watchlist');
    var current = document.getElementById('my-dashboard');
    if (!current) {
      current = document.createElement('section');
      current.id = 'my-dashboard';
      current.className = 'my-dashboard';
      watchlistMount.insertAdjacentElement('afterend', current);
    }
    return current;
  }
  function renderShell() {
    mount.innerHTML = '<header class="my-dashboard-head">'
      + '<div><span class="my-dashboard-eyebrow">MY PORTFOLIO</span><h2>내 종목 분석</h2><p>종목을 입력하면 시세·차트·수급·매물대를 바로 분석합니다.</p></div></header>'
      + '<div class="my-search-panel"><label for="myStockInput">분석할 종목</label><div class="my-search-row"><div class="my-input-wrap"><span class="my-input-logo" data-my-input-logo aria-hidden="true"><span data-my-input-initials>종목</span><img data-my-input-image alt="" hidden></span><input id="myStockInput" list="myStockOptions" type="search" placeholder="종목명, 종목코드 또는 미국 티커 입력" autocomplete="off"><datalist id="myStockOptions"></datalist></div><button type="button" data-my-load aria-label="입력한 종목 불러오기"><svg class="my-load-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 7.2 4.5M12 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>불러오기</span></button></div><p>불러오기는 분석만 진행합니다. MY에 계속 보관하려면 아래 <b>+ 관심종목 추가</b>를 이용하세요.</p></div>'
      + '<div class="my-watchlist-wrap"><section class="my-watchlist-panel"><div class="my-watchlist-panel-head"><div><strong>MY 관심종목</strong><span>그룹을 접어 필요한 종목만 보고, 행을 누르면 아래에서 분석할 수 있습니다.</span></div><div class="my-watchlist-head-actions"><small data-my-watchlist-count>0종목</small><button type="button" class="my-watchlist-add" data-my-watchlist-add>+ 관심종목 추가</button></div></div><div class="my-watchlist-groups" data-my-watchlist-table></div></section><button type="button" class="my-watchlist-show" data-my-watchlist-show hidden>관심종목 보기</button></div>'
      + '<div class="my-watchlist-modal" data-my-watchlist-modal hidden><div class="my-watchlist-modal-backdrop" data-my-watchlist-close></div><section class="my-watchlist-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="myWatchlistModalTitle"><div class="my-watchlist-modal-head"><strong id="myWatchlistModalTitle">관심종목 추가</strong><button type="button" class="my-watchlist-modal-close" data-my-watchlist-close aria-label="관심종목 추가 창 닫기">×</button></div><p>국내 종목명·6자리 코드 또는 미국 티커를 입력하세요.</p><div class="my-watchlist-modal-row"><input id="myWatchlistAddInput" list="myWatchlistAddOptions" type="search" placeholder="예: 삼성전자, 005930, AAPL" autocomplete="off"><datalist id="myWatchlistAddOptions"></datalist><button type="button" data-my-watchlist-add-confirm>추가</button></div><p class="my-watchlist-modal-message" data-my-watchlist-modal-message hidden></p></section></div>'
      + '<div id="myDashboardStatus" class="my-dashboard-status">분석할 종목을 입력하세요.</div>'
      + '<main class="my-dashboard-detail" id="myDashboardDetail"></main>';
  }
  function populateOptions(id) {
    var options = document.getElementById(id);
    if (!options || !global.Watchlist) return;
    options.innerHTML = global.Watchlist.getList().map(function (item) {
      return '<option value="' + escapeAttr(displayName(item)) + '">' + escapeHtml(item.code) + '</option>';
    }).join('');
  }
  function populateSearchOptions() {
    populateOptions('myStockOptions');
    populateOptions('myWatchlistAddOptions');
  }
  function watchlistModalMessage(message) {
    var output = document.querySelector('[data-my-watchlist-modal-message]');
    if (!output) return;
    output.textContent = message || '';
    output.hidden = !message;
  }
  function openWatchlistAddModal() {
    var modal = document.querySelector('[data-my-watchlist-modal]');
    var input = document.getElementById('myWatchlistAddInput');
    if (!modal) return;
    populateOptions('myWatchlistAddOptions');
    watchlistModalMessage('');
    modal.hidden = false;
    if (input) { input.value = ''; input.focus(); }
  }
  function closeWatchlistAddModal() {
    var modal = document.querySelector('[data-my-watchlist-modal]');
    if (modal) modal.hidden = true;
  }
  function addFromWatchlistModal() {
    var input = document.getElementById('myWatchlistAddInput');
    var item = resolveInput(input && input.value);
    if (!item) {
      watchlistModalMessage('종목명·6자리 코드·미국 티커를 정확히 입력해 주세요.');
      return;
    }
    var result = global.Watchlist.add(item.code, item.name);
    if (!result.ok) {
      var messages = { login: '로그인 후 관심종목으로 저장할 수 있습니다.', exists: '이미 관심종목에 담긴 종목입니다.', full: '관심종목은 최대 50개까지 담을 수 있습니다.' };
      watchlistModalMessage(messages[result.reason] || '관심종목을 추가하지 못했습니다.');
      return;
    }
    state.selectedCode = item.code;
    state.selectedItem = item;
    state.watchlistCollapsed = false;
    closeWatchlistAddModal();
    render();
  }
  function updateInputLogo(item) {
    var logo = document.querySelector('[data-my-input-logo]');
    var image = logo && logo.querySelector('[data-my-input-image]');
    var initials = logo && logo.querySelector('[data-my-input-initials]');
    if (!logo || !image || !initials) return;
    var value = item || { name: (document.getElementById('myStockInput') || {}).value || '종목' };
    initials.textContent = String(displayName(value) || value.code || '종목').replace(/^US:/i, '').slice(0, 2).toUpperCase();
    image.hidden = true;
    initials.hidden = false;
    if (value.code) {
      image.src = stockIconUrl(value.code);
      image.onload = function () { image.hidden = false; initials.hidden = true; };
      image.onerror = function () { image.hidden = true; initials.hidden = false; };
    }
  }
  function resolveInput(query) {
    var q = String(query || '').trim();
    if (!q) return null;
    var saved = global.Watchlist.getList();
    var normalizedQuery = normalizeUsQuery(q);
    var exactSaved = saved.filter(function (item) {
      return String(item.code || '').toLowerCase() === q.toLowerCase()
        || normalizeUsQuery(item.name) === normalizedQuery
        || normalizeUsQuery(displayName(item)) === normalizedQuery
        || (usSymbolForQuery(q) && String(item.code || '').toUpperCase() === 'US:' + usSymbolForQuery(q));
    })[0];
    if (exactSaved) return Object.assign({}, exactSaved, { name: displayName(exactSaved) });
    var usSymbol = usSymbolForQuery(q);
    if (usSymbol) return { code: 'US:' + usSymbol, name: localizedUsName('US:' + usSymbol, usSymbol), temporary: true, holding: { quantity: 0, averagePrice: 0 } };
    if (/^US:/i.test(q)) return { code: 'US:' + q.slice(3).trim().toUpperCase(), name: q.slice(3).trim().toUpperCase(), temporary: true, holding: { quantity: 0, averagePrice: 0 } };
    var map = global.KRX_MAP || {};
    if (/^[0-9A-Z]{6}$/i.test(q)) {
      for (var name in map) if (Object.prototype.hasOwnProperty.call(map, name) && String(map[name]).toUpperCase() === q.toUpperCase()) return { code: map[name], name: name, temporary: true, holding: { quantity: 0, averagePrice: 0 } };
    }
    if (Object.prototype.hasOwnProperty.call(map, q)) return { code: map[q], name: q, temporary: true, holding: { quantity: 0, averagePrice: 0 } };
    var matches = Object.keys(map).filter(function (name) { return name.toLowerCase().indexOf(q.toLowerCase()) !== -1; });
    if (matches.length === 1) return { code: map[matches[0]], name: matches[0], temporary: true, holding: { quantity: 0, averagePrice: 0 } };
    if (/^[A-Z][A-Z0-9.\-]{0,9}$/i.test(q)) return { code: 'US:' + q.toUpperCase(), name: localizedUsName('US:' + q.toUpperCase(), q.toUpperCase()), temporary: true, holding: { quantity: 0, averagePrice: 0 } };
    return null;
  }
  function selectedFromInput() {
    var input = document.getElementById('myStockInput');
    var item = resolveInput(input && input.value);
    if (!item) {
      var status = document.getElementById('myDashboardStatus');
      if (status) status.textContent = '종목명·6자리 코드·미국 티커를 정확히 입력해 주세요.';
      return;
    }
    state.selectedCode = item.code;
    state.selectedItem = item;
    if (input) input.value = item.name;
    updateInputLogo(item);
    delete state.analyses[item.code];
    render();
  }
  function itemMetrics(item, quote) {
    var holding = holdingOf(item);
    var price = number(quote && quote.price, null);
    var invested = holding.averagePrice * holding.quantity;
    var value = price == null ? null : price * holding.quantity;
    var pnl = value == null || !invested ? null : value - invested;
    var rate = pnl == null || !invested ? null : pnl / invested * 100;
    return { holding: holding, price: price, invested: invested, value: value, pnl: pnl, rate: rate };
  }
  function quoteField(quote, names) {
    var source = quote || {};
    for (var i = 0; i < names.length; i++) {
      if (source[names[i]] != null && source[names[i]] !== '') return source[names[i]];
    }
    return null;
  }
  function tableVolume(quote) {
    return quoteField(quote, ['volume', 'tradeVolume', 'trade_volume', 'acmlVol', 'acml_vol', 'trde_qty']);
  }
  function tableMarketCap(quote, code) {
    var raw = quoteField(quote, ['marketCap', 'market_cap', 'market_cap_eok', 'mac']);
    var value = number(raw, null);
    if (value == null) return '-';
    if (quote && (quote.market_cap_eok != null || quote.mac != null) && !/^US:/i.test(code)) return formatNumber(value, 0) + '억';
    if (/^US:/i.test(code)) return '$' + formatNumber(value, 0);
    return formatNumber(value, 0);
  }
  function watchlistRows(items) {
    return items.map(function (item) {
      var name = displayName(item);
      var quote = state.quotes[item.code] || {};
      var changeRate = quoteField(quote, ['changeRate', 'change_rate', 'change_rate_pct']);
      var price = quoteField(quote, ['price', 'currentPrice', 'stck_prpr']);
      var change = quoteField(quote, ['change', 'changeValue', 'prdy_vrss']);
      var high = quoteField(quote, ['high', 'highPrice', 'high_price', 'stck_hgpr']);
      var low = quoteField(quote, ['low', 'lowPrice', 'low_price', 'stck_lwpr']);
      var open = quoteField(quote, ['open', 'openPrice', 'open_price', 'stck_oprc']);
      return '<tr class="my-watchlist-row' + (state.selectedCode === item.code ? ' is-selected' : '') + '" data-my-row="' + escapeAttr(item.code) + '" tabindex="0" role="button"><th><span class="my-watchlist-name">' + stockIconHtml(item) + '<span><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(item.code) + '</small></span></span></th><td>' + formatPrice(price, item.code) + '</td><td class="' + signClass(changeRate) + '">' + (changeRate == null ? '-' : formatSigned(changeRate, 2) + '%') + (change != null ? '<small>' + formatSigned(change, /^US:/i.test(item.code) ? 2 : 0) + '</small>' : '') + '</td><td>' + formatNumber(tableVolume(quote), 0) + '</td><td>' + formatPrice(high, item.code) + '</td><td>' + formatPrice(low, item.code) + '</td><td>' + tableMarketCap(quote, item.code) + '</td><td>' + formatPrice(open, item.code) + '</td></tr>';
    }).join('');
  }
  function groupedWatchlist(items) {
    var groups = global.Watchlist && global.Watchlist.getGroups ? global.Watchlist.getGroups() : [];
    var byId = {};
    groups.forEach(function (group) { byId[group.id] = { group: group, items: [] }; });
    items.forEach(function (item) {
      var id = item.groupId || 'default';
      if (!byId[id]) {
        var fallback = { id: id, name: id === 'default' ? '기본' : '기타', collapsed: false };
        groups.push(fallback);
        byId[id] = { group: fallback, items: [] };
      }
      byId[id].items.push(item);
    });
    return groups.map(function (group) { return byId[group.id]; }).filter(function (entry) { return entry && entry.items.length; });
  }
  function buildWatchlistTable(items) {
    var tableMount = mount.querySelector('[data-my-watchlist-table]');
    var count = mount.querySelector('[data-my-watchlist-count]');
    if (count) count.textContent = items.length + '종목';
    if (!tableMount) return;
    if (!items.length) {
      tableMount.innerHTML = '<div class="my-watchlist-empty">관심종목이 없습니다. 위 검색창으로 종목을 불러오거나 기존 관심종목에 추가하세요.</div>';
      return;
    }
    tableMount.innerHTML = groupedWatchlist(items).map(function (entry) {
      var group = entry.group;
      var collapsed = !!group.collapsed;
      return '<section class="my-watchlist-group' + (collapsed ? ' is-collapsed' : '') + '" data-my-group="' + escapeAttr(group.id) + '">'
        + '<button type="button" class="my-watchlist-group-toggle" data-my-group-toggle="' + escapeAttr(group.id) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '"><span><strong>' + escapeHtml(group.name || '기본') + '</strong><small>' + entry.items.length + '종목</small></span><i aria-hidden="true"></i></button>'
        + '<div class="my-watchlist-group-body"><div class="my-watchlist-scroll"><table class="my-watchlist-table"><thead><tr><th>종목명</th><th>현재가</th><th>전일대비</th><th>거래량</th><th>고가</th><th>저가</th><th>시가총액</th><th>시가</th></tr></thead><tbody>' + watchlistRows(entry.items) + '</tbody></table></div></div></section>';
    }).join('');
  }
  function updateWatchlistVisibility() {
    var panel = mount && mount.querySelector('.my-watchlist-panel');
    var show = mount && mount.querySelector('[data-my-watchlist-show]');
    var collapsed = !!state.watchlistCollapsed && !!state.selectedCode;
    if (panel) panel.hidden = collapsed;
    if (show) show.hidden = !collapsed;
  }
  function refreshWatchlistQuotes(items) {
    if (!items.length || !global.Watchlist) return;
    if (Date.now() - state.watchlistQuoteAt < 30000) return;
    state.watchlistQuoteAt = Date.now();
    global.Watchlist.fetchQuotes(items.map(function (item) { return item.code; })).then(function (quotes) {
      state.quotes = Object.assign(state.quotes, quotes || {});
      buildWatchlistTable(global.Watchlist.getList());
      var item = itemByCode(state.selectedCode);
      if (item && state.analyses[item.code]) renderDetail(item, state.analyses[item.code]);
    }).catch(function () {});
  }
  function buildHoldingForm(item, metrics) {
    var isTemporary = !!item.temporary;
    return '<div class="my-holding-card"><div class="my-card-title"><strong>내 보유정보</strong><span>' + (isTemporary ? '저장하려면 로그인 필요' : '입력값 저장') + '</span></div>'
      + '<div class="my-holding-fields"><label>수량<input type="number" min="0" step="any" data-my-field="quantity" value="' + escapeAttr(metrics.holding.quantity || '') + '"></label>'
      + '<label>평단가<input type="number" min="0" step="any" data-my-field="averagePrice" value="' + escapeAttr(metrics.holding.averagePrice || '') + '"></label>'
      + '<label>보유 기준<select data-my-field="horizon"><option value="short"' + (metrics.holding.horizon === 'short' ? ' selected' : '') + '>단타 · 5·20일선</option><option value="long"' + (metrics.holding.horizon === 'long' ? ' selected' : '') + '>중장기 · 60·224일선</option></select></label>'
      + '<button type="button" class="my-save-holding" data-my-save="' + escapeAttr(item.code) + '">' + (isTemporary ? 'MY에 저장' : '저장') + '</button></div>'
      + '<div class="my-holding-preview" data-my-holding-preview><span>현재 평가금액<strong>' + (metrics.value == null ? '-' : formatPrice(metrics.value, item.code)) + '</strong></span><span>평가손익<strong class="' + signClass(metrics.pnl) + '">' + (metrics.pnl == null ? '평단 입력 필요' : formatPrice(metrics.pnl, item.code)) + '</strong></span><span>수익률<strong class="' + signClass(metrics.rate) + '">' + (metrics.rate == null ? '-' : formatSigned(metrics.rate, 2) + '%') + '</strong></span></div>'
      + '<div class="my-holding-note">수량·평단을 입력하면 아래 계산값이 즉시 바뀝니다. 저장하면 다음 방문에도 유지됩니다.</div></div>';
  }
  function buildAveragingCalculator(metrics, code) {
    var invested = metrics.invested || 0;
    var maxBudget = Math.max(invested * 2, metrics.price || metrics.holding.averagePrice || 1000000);
    var defaultBudget = invested ? Math.round(invested * 0.5) : 0;
    var step = Math.max(1, Math.round(maxBudget / 100));
    return '<section class="my-analysis-card my-calculator"><div class="my-card-title"><strong>물타기 계산기</strong><span>슬라이더로 추가 매수금액 조절</span></div>'
      + '<label class="my-range-label">추가 투입금액 <output data-my-calc-output>' + formatPrice(defaultBudget, code) + '</output><input type="range" min="0" max="' + escapeAttr(maxBudget) + '" step="' + escapeAttr(step) + '" value="' + escapeAttr(defaultBudget) + '" data-my-calc="budget"></label>'
      + '<div class="my-calc-auto"><span>추가 매수가<strong data-my-calc-price>' + formatPrice(metrics.price, code) + '</strong></span><span>자동 매수 수량<strong data-my-calc-quantity>-</strong></span></div>'
      + '<div class="my-calc-result" data-my-calc-result>현재 수량과 평단을 입력하면 예상 평단가를 계산합니다.</div></section>';
  }
  function buildMyFlowMiniChart(flow) {
    var daily = flow && Array.isArray(flow.daily) ? flow.daily : [];
    var asc = daily.slice(0, 20).reverse().filter(function (row) { return row && row.date; });
    if (asc.length < 2) return '';
    var values = [];
    asc.forEach(function (row) {
      ['foreign_net', 'inst_net', 'ind_net'].forEach(function (key) {
        var value = number(row[key], null);
        if (value != null) values.push(value);
      });
    });
    if (!values.length) return '';
    var max = Math.max.apply(null, values.concat([0]));
    var min = Math.min.apply(null, values.concat([0]));
    var span = (max - min) || 1;
    min -= span * .08;
    max += span * .08;
    var width = 720, height = 148;
    var pad = { left: 42, right: 8, top: 10, bottom: 24 };
    var innerWidth = width - pad.left - pad.right;
    var innerHeight = height - pad.top - pad.bottom;
    function x(index) { return pad.left + (index / (asc.length - 1)) * innerWidth; }
    function y(value) { return pad.top + (1 - (value - min) / (max - min)) * innerHeight; }
    function compact(value) {
      var abs = Math.abs(value), sign = value > 0 ? '+' : value < 0 ? '-' : '';
      if (abs >= 100000000) return sign + (abs / 100000000).toFixed(1) + '억';
      if (abs >= 10000) return sign + Math.round(abs / 10000).toLocaleString() + '만';
      return sign + Math.round(abs).toLocaleString();
    }
    function points(field) {
      return asc.map(function (row, index) {
        return x(index).toFixed(1) + ',' + y(number(row[field], 0)).toFixed(1);
      }).join(' ');
    }
    function dateLabel(date) { return String(date).slice(5, 10).replace('-', '/'); }
    var svg = '<svg class="my-flow-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="최근 20거래일 개인 외국인 기관 순매매 흐름">';
    svg += '<line class="my-flow-grid-line" x1="' + pad.left + '" y1="' + y(max).toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y(max).toFixed(1) + '"/>';
    svg += '<line class="my-flow-grid-line" x1="' + pad.left + '" y1="' + y(min).toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y(min).toFixed(1) + '"/>';
    svg += '<line class="my-flow-zero-line" x1="' + pad.left + '" y1="' + y(0).toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y(0).toFixed(1) + '"/>';
    svg += '<text class="my-flow-axis" x="' + (pad.left - 5) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + compact(max) + '</text>';
    svg += '<text class="my-flow-axis" x="' + (pad.left - 5) + '" y="' + (y(0) + 4).toFixed(1) + '" text-anchor="end">0</text>';
    svg += '<text class="my-flow-axis" x="' + (pad.left - 5) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + compact(min) + '</text>';
    [0, Math.floor((asc.length - 1) / 2), asc.length - 1].forEach(function (index, labelIndex) {
      var anchor = labelIndex === 0 ? 'start' : labelIndex === 2 ? 'end' : 'middle';
      svg += '<text class="my-flow-axis" x="' + x(index).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="' + anchor + '">' + dateLabel(asc[index].date) + '</text>';
    });
    if (asc.some(function (row) { return number(row.ind_net, null) != null; })) svg += '<polyline class="my-flow-line-ind" points="' + points('ind_net') + '"/>';
    svg += '<polyline class="my-flow-line-foreign" points="' + points('foreign_net') + '"/>';
    svg += '<polyline class="my-flow-line-inst" points="' + points('inst_net') + '"/>';
    return '<div class="my-flow-chart"><div class="my-flow-chart-head"><strong>최근 20거래일 흐름</strong><small>순매수 + · 순매도 -</small></div>' + svg + '<div class="my-flow-legend"><span><i class="my-flow-dot my-flow-dot-ind"></i>개인</span><span><i class="my-flow-dot my-flow-dot-foreign"></i>외국인</span><span><i class="my-flow-dot my-flow-dot-inst"></i>기관</span></div></div>';
  }
  function buildFlowCard(flow) {
    var daily = flow && flow.daily && flow.daily[0] || {};
    var rolling = flow && flow.rolling && flow.rolling['5d'] || {};
    var rows = [
      ['외국인', daily.foreign_net, rolling.foreign],
      ['기관', daily.inst_net, rolling.inst],
      ['개인', daily.ind_net, rolling.ind]
    ];
    return '<section class="my-analysis-card"><div class="my-card-title"><strong>수요·공급 흐름</strong><span>단위: 주 · ' + escapeHtml(daily.date || '최근 데이터') + '</span></div>'
      + '<div class="my-flow-grid">' + rows.map(function (row) {
        return '<div class="my-flow-row"><span>' + row[0] + '</span><b class="' + signClass(row[1]) + '">' + formatSignedShares(row[1]) + '</b><small>5일 ' + formatSignedShares(row[2]) + '</small></div>';
      }).join('') + '</div>' + buildMyFlowMiniChart(flow) + '<p class="my-analysis-footnote">+는 순매수, -는 순매도입니다. 수급은 투자 참고용으로만 확인하세요.</p></section>';
  }
  var MY_VOLUME_LOOKBACK_DAYS = 120;
  var MY_VOLUME_BIN_COUNT = 24;
  var MY_VOLUME_DISPLAY_COUNT = 12;

  // 호가/오늘 체결량과 섞지 않고, 완전한 일봉 OHLCV로 최근 체결 매물대를
  // 계산한다. 하루 거래량은 그날의 고가~저가 구간에 비례 배분한다.
  function buildDailyVolumeProfile(chart, code) {
    if (!chart || !Array.isArray(chart.daily)) return null;
    var points = chart.daily.map(function (row) {
      var low = number(row.low, null), high = number(row.high, null);
      var close = number(row.close, null), volume = Math.max(0, number(row.volume, 0));
      if (low == null || high == null || close == null || high < low || close <= 0) return null;
      return { date: String(row.date || ''), low: low, high: high, close: close, volume: volume };
    }).filter(Boolean).sort(function (a, b) { return a.date.localeCompare(b.date); }).slice(-MY_VOLUME_LOOKBACK_DAYS);
    if (points.length < 2) return null;
    var minLow = Math.min.apply(null, points.map(function (row) { return row.low; }));
    var maxHigh = Math.max.apply(null, points.map(function (row) { return row.high; }));
    if (!(maxHigh > minLow)) return null;
    var binSize = (maxHigh - minLow) / MY_VOLUME_BIN_COUNT;
    var bins = [];
    for (var i = 0; i < MY_VOLUME_BIN_COUNT; i++) {
      bins.push({ low: minLow + i * binSize, high: minLow + (i + 1) * binSize, volume: 0 });
    }
    points.forEach(function (row) {
      if (!(row.volume > 0)) return;
      var range = row.high - row.low;
      if (!(range > 0)) {
        var flatIndex = Math.min(MY_VOLUME_BIN_COUNT - 1, Math.max(0, Math.floor((row.close - minLow) / binSize)));
        bins[flatIndex].volume += row.volume;
        return;
      }
      var startIndex = Math.max(0, Math.floor((row.low - minLow) / binSize));
      var endIndex = Math.min(MY_VOLUME_BIN_COUNT - 1, Math.floor((row.high - minLow) / binSize));
      for (var index = startIndex; index <= endIndex; index++) {
        var overlap = Math.min(bins[index].high, row.high) - Math.max(bins[index].low, row.low);
        if (overlap > 0) bins[index].volume += row.volume * (overlap / range);
      }
    });
    var pocIndex = 0, maxVolume = 0;
    bins.forEach(function (bin, index) {
      if (bin.volume > maxVolume) { maxVolume = bin.volume; pocIndex = index; }
    });
    if (!(maxVolume > 0)) return null;
    return {
      code: code,
      currentPrice: points[points.length - 1].close,
      daysIncluded: points.length,
      approximate: true,
      source: 'daily-ohlcv',
      poc: (bins[pocIndex].low + bins[pocIndex].high) / 2,
      pocLow: bins[pocIndex].low,
      pocHigh: bins[pocIndex].high,
      bins: bins.map(function (bin) {
        return { price: (bin.low + bin.high) / 2, low: bin.low, high: bin.high, volume: bin.volume };
      })
    };
  }
  function buildVolumeCard(volume, chart, code, livePrice) {
    volume = buildDailyVolumeProfile(chart, code);
    if (!volume || !volume.bins || !volume.bins.length) return '<section class="my-analysis-card"><div class="my-card-title"><strong>매물대</strong></div><p class="my-muted">가격·거래량 데이터가 부족해 그래프를 표시할 수 없습니다.</p></section>';
    var bins = volume.bins.map(function (bin) {
      var low = number(bin.low, null), high = number(bin.high, null);
      var price = number(bin.price, null);
      if (low == null || high == null) return null;
      return { price: price == null ? (low + high) / 2 : price, low: low, high: high, volume: Math.max(0, number(bin.volume || bin.vol, 0)) };
    }).filter(Boolean);
    bins = bins.filter(function (bin) { return bin.price > 0 && bin.high >= bin.low; });
    if (!bins.length) return '<section class="my-analysis-card"><div class="my-card-title"><strong>매물대</strong></div><p class="my-muted">가격대별 거래량이 없습니다.</p></section>';
    var poc = volume.poc || volume.pocPrice || bins[0].price;
    var bucketSize = Math.max(1, Math.ceil(bins.length / MY_VOLUME_DISPLAY_COUNT));
    var compact = [];
    for (var i = 0; i < bins.length; i += bucketSize) {
      var part = bins.slice(i, i + bucketSize);
      compact.push({ low: part[0].low, high: part[part.length - 1].high, volume: part.reduce(function (sum, bin) { return sum + bin.volume; }, 0) });
    }
    var maxVolume = compact.reduce(function (best, bin) { return Math.max(best, bin.volume); }, 0) || 1;
    var current = number(livePrice, number(volume.currentPrice, null));
    var rows = compact.map(function (bin) {
      var width = Math.max(4, Math.round(bin.volume / maxVolume * 100));
      var isPoc = poc >= bin.low && poc <= bin.high;
      var isCurrent = current != null && current >= bin.low && current <= bin.high;
      var rangeLabel = formatPrice(bin.low, volume.code || '') + ' ~ ' + formatPrice(bin.high, volume.code || '');
      return '<div class="my-volume-row' + (isPoc ? ' is-poc' : '') + (isCurrent ? ' is-current' : '') + '"><span>' + rangeLabel + '</span><i><b style="width:' + width + '%"></b></i><small>' + formatNumber(bin.volume, 0) + '</small></div>';
    }).join('');
    var periodLabel = '최근 ' + volume.daysIncluded + '거래일 일봉';
    return '<section class="my-analysis-card"><div class="my-card-title"><strong>매물대</strong><span>' + periodLabel + '</span></div>'
      + '<div class="my-volume-highlight"><span>최근 체결량 최대 구간</span><strong>' + formatPrice(volume.pocLow, volume.code || '') + ' ~ ' + formatPrice(volume.pocHigh, volume.code || '') + '</strong></div>'
      + '<div class="my-volume-chart" aria-label="가격대별 매물대 간략 그래프">' + rows + '</div>'
      + '<div class="my-volume-legend"><span><i class="is-poc"></i>거래량 최다</span><span><i class="is-current"></i>현재가</span></div>'
      + '<p class="my-analysis-footnote">호가창의 현재 대기 물량과는 다른 지표입니다. 현재가가 두꺼운 매물대 위에 있으면 지지, 아래에 있으면 저항 후보로 참고하세요. 일봉 고가·저가·거래량을 구간에 비례 배분한 추정치입니다.</p></section>';
  }
  function buildChartShapeCard(chart, summary) {
    var notes = summaryNotes(summary);
    if (!chart || !chart.daily || chart.daily.length < 2) return '<section class="my-analysis-card my-chart-shape"><div class="my-card-title"><strong>차트 모양 분석</strong></div><p class="my-muted">차트 데이터를 불러오지 못했습니다.</p></section>';
    var daily = chart.daily, last = daily[daily.length - 1], close = number(last.close, 0);
    function returnPct(days) { if (daily.length <= days) return null; var prev = daily[daily.length - 1 - days]; return prev && prev.close ? (close - prev.close) / prev.close * 100 : null; }
    var ret5 = returnPct(5), ret20 = returnPct(20), ret60 = returnPct(60), ret112 = returnPct(112), ret224 = returnPct(224);
    var ma5 = chart.ma && chart.ma.ma5 && chart.ma.ma5[chart.ma.ma5.length - 1];
    var ma20 = chart.ma && chart.ma.ma20 && chart.ma.ma20[chart.ma.ma20.length - 1];
    var shape = '횡보·방향 탐색';
    if (ret20 != null && ret5 != null) {
      if (ret20 >= 8 && ret5 < 0) shape = '상승 추세 속 단기 눌림';
      else if (ret20 <= -8 && ret5 > 0) shape = '하락 추세 속 단기 반등';
      else if (ret20 >= 8) shape = '상승 추세';
      else if (ret20 <= -8) shape = '하락 추세';
      else if (Math.abs(ret20) < 5) shape = '박스권·횡보';
    }
    var maLabel = notes.tech && notes.tech.desc ? notes.tech.desc : (ma5 != null && ma20 != null ? (ma5 >= ma20 ? '단기 이평선이 중기 이평선 위' : '단기 이평선이 중기 이평선 아래') : '이평선 데이터 부족');
    var momentumLabel = notes.momentum && notes.momentum.desc ? notes.momentum.desc : '최근 가격 추세 데이터 부족';
    return '<section class="my-analysis-card my-chart-shape"><div class="my-card-title"><strong>차트 모양 분석</strong><span>최근 가격 흐름 기준</span></div>'
      + '<div class="my-shape-badge ' + signClass(ret20) + '">' + escapeHtml(shape) + '</div>'
      + '<div class="my-shape-grid"><div><span>5일 변화</span><strong class="' + signClass(ret5) + '">' + formatSigned(ret5, 2) + '%</strong></div><div><span>20일 변화</span><strong class="' + signClass(ret20) + '">' + formatSigned(ret20, 2) + '%</strong></div><div><span>60일 변화</span><strong class="' + signClass(ret60) + '">' + formatSigned(ret60, 2) + '%</strong></div><div><span>112일 변화</span><strong class="' + signClass(ret112) + '">' + formatSigned(ret112, 2) + '%</strong></div><div><span>224일 변화</span><strong class="' + signClass(ret224) + '">' + formatSigned(ret224, 2) + '%</strong></div></div>'
      + '<p class="my-shape-note"><b>이평선</b> ' + escapeHtml(maLabel) + '</p><p class="my-shape-note"><b>추세</b> ' + escapeHtml(momentumLabel) + '</p></section>';
  }
  function chartShapeData(chart, summary) {
    if (!chart || !chart.daily || chart.daily.length < 2) return null;
    var daily = chart.daily, last = daily[daily.length - 1], close = number(last.close, 0);
    function returnPct(days) { if (daily.length <= days) return null; var prev = daily[daily.length - 1 - days]; return prev && prev.close ? (close - prev.close) / prev.close * 100 : null; }
    var ret5 = returnPct(5), ret20 = returnPct(20), ret60 = returnPct(60), ret112 = returnPct(112), ret224 = returnPct(224);
    var ma5 = chart.ma && chart.ma.ma5 && chart.ma.ma5[chart.ma.ma5.length - 1];
    var ma20 = chart.ma && chart.ma.ma20 && chart.ma.ma20[chart.ma.ma20.length - 1];
    var notes = summaryNotes(summary);
    var shape = '중립·박스권';
    if (ret20 != null && ret5 != null) {
      if (ret20 >= 8 && ret5 < 0) shape = '상승 추세 · 단기 조정';
      else if (ret20 <= -8 && ret5 > 0) shape = '하락 추세 · 단기 반등';
      else if (ret20 >= 8) shape = '상승 추세';
      else if (ret20 <= -8) shape = '하락 추세';
    }
    return { close: close, ret5: ret5, ret20: ret20, ret60: ret60, ret112: ret112, ret224: ret224, ma5: number(ma5, null), ma20: number(ma20, null), shape: shape, tech: notes.tech && notes.tech.desc || '', momentum: notes.momentum && notes.momentum.desc || '' };
  }
  function chartShapeNote(chart, summary) {
    var data = chartShapeData(chart, summary);
    if (!data) return '차트 모양 데이터 없음';
    return data.shape + ', 5일 ' + formatSigned(data.ret5, 2) + '%, 20일 ' + formatSigned(data.ret20, 2) + '%, 60일 ' + formatSigned(data.ret60, 2) + '%, 112일 ' + formatSigned(data.ret112, 2) + '%, 224일 ' + formatSigned(data.ret224, 2) + '%; ' + (data.tech || data.momentum || '이동평균 데이터 없음');
  }
  function profitTakingSignal(chart, data, horizon) {
    if (horizon === 'long') {
      var ma60Long = chart && chart.ma && chart.ma.ma60 || [];
      var ma120Long = chart && chart.ma && chart.ma.ma120 || [];
      var ma224Long = chart && chart.ma && chart.ma.ma224 || [];
      var longLast = Math.max(ma60Long.length, ma120Long.length, ma224Long.length) - 1;
      var current60 = longLast >= 0 ? number(ma60Long[longLast], null) : null;
      var current120 = longLast >= 0 ? number(ma120Long[longLast], null) : null;
      var current224 = longLast >= 0 ? number(ma224Long[longLast], null) : null;
      var closeLong = number(data && data.close, null);
      var below224 = closeLong != null && current224 != null && closeLong < current224;
      var below60 = closeLong != null && current60 != null && closeLong < current60;
      var longBearAligned = current60 != null && current224 != null && current60 < current224;
      if (below224) return { level: 3, note: '현재가가 224일선 아래로 내려왔습니다. 중장기 기준선이 훼손된 상태이므로 수익 중이면 분할 익절과 보유 비중 축소를 검토하세요.' };
      if (below60 && longBearAligned) return { level: 2, note: '현재가가 60일선 아래이고 60일선도 224일선 아래입니다. 중장기 추세가 약해지는 구간이므로 수익 중이면 일부 익절 후 기준선 회복 여부를 확인하세요.' };
      return { level: 0, note: '' };
    }
    var ma5 = chart && chart.ma && chart.ma.ma5 || [];
    var ma20 = chart && chart.ma && chart.ma.ma20 || [];
    var last = Math.min(ma5.length, ma20.length) - 1;
    var currentMa5 = last >= 0 ? number(ma5[last], null) : number(data && data.ma5, null);
    var currentMa20 = last >= 0 ? number(ma20[last], null) : number(data && data.ma20, null);
    var close = number(data && data.close, null);
    var bearishCross = false;
    var crossDays = null;
    var start = Math.max(1, last - 4);
    for (var i = start; i <= last; i++) {
      var prev5 = number(ma5[i - 1], null), prev20 = number(ma20[i - 1], null);
      var now5 = number(ma5[i], null), now20 = number(ma20[i], null);
      if (prev5 != null && prev20 != null && now5 != null && now20 != null && prev5 >= prev20 && now5 < now20) {
        bearishCross = true;
        crossDays = last - i;
        break;
      }
    }
    var belowMa5 = close != null && currentMa5 != null && close < currentMa5;
    var belowMa20 = close != null && currentMa20 != null && close < currentMa20;
    var ma5BelowMa20 = currentMa5 != null && currentMa20 != null && currentMa5 < currentMa20;
    var fallingShortMa = ma5.length >= 4 && number(ma5[last], null) != null && number(ma5[last - 3], null) != null && ma5[last] < ma5[last - 3];
    if (bearishCross && belowMa5) {
      return { level: 3, note: '최근 ' + (crossDays === 0 ? '현재' : crossDays + '거래일 전') + ' 5일선이 20일선을 하향 이탈했고 현재가도 5일선 아래라 단기 추세가 약해졌습니다. 수익 중이면 전량 매도보다 분할 익절을 우선 검토하세요.' };
    }
    if (belowMa5 && belowMa20 && ma5BelowMa20) {
      return { level: 2, note: '현재가가 5일선과 20일선을 모두 이탈하고 5일선이 20일선 아래에 있습니다. 수익 중이면 보유 비중 일부를 익절하고 나머지는 반등 여부를 확인하세요.' };
    }
    if (belowMa5 && (fallingShortMa || (data && data.ret5 < 0))) {
      return { level: 1, note: '현재가가 5일선 아래로 밀리고 단기 모멘텀이 약해졌습니다. 수익 중이면 5일선 재돌파 실패 여부를 보며 분할 익절 구간을 관리하세요.' };
    }
    return { level: 0, note: '' };
  }
  function clampScore(value) {
    return Math.max(0, Math.min(100, number(value, 50)));
  }
  function averageAvailableScores(scores) {
    var available = scores.map(function (value) { return number(value, null); }).filter(function (value) { return value != null; });
    if (!available.length) return null;
    return available.reduce(function (sum, value) { return sum + value; }, 0) / available.length;
  }
  function scoreWord(score) {
    if (score == null) return '데이터 부족';
    if (score >= 65) return '우호';
    if (score >= 45) return '중립';
    return '주의';
  }
  function positionDecision(metrics, chart, summary, volume) {
    var data = chartShapeData(chart, summary);
    var notes = summaryNotes(summary);
    var flowScore = averageAvailableScores([
      notes.flow && notes.flow.score,
      notes.foreignInst && notes.foreignInst.score,
      notes.pension && notes.pension.score,
      notes.short && notes.short.score
    ]);
    var chartScore = number(notes.tech && notes.tech.score, null);
    if (chartScore == null) chartScore = number(notes.momentum && notes.momentum.score, null);
    if (chartScore == null && data) chartScore = 50 + (number(data.ret5, 0) * 1.8) + (number(data.ret20, 0) * 0.35);
    chartScore = chartScore == null ? null : clampScore(chartScore);
    var effectiveVolume = volume || buildDailyVolumeProfile(chart, metrics && metrics.code);
    var poc = effectiveVolume && number(effectiveVolume.poc || effectiveVolume.pocPrice, null);
    var belowPoc = !!(poc != null && data && data.close < poc);
    var hasHolding = !!(metrics && metrics.holding && metrics.holding.quantity && metrics.holding.averagePrice && metrics.price != null);
    var lossRate = hasHolding ? number(metrics.rate, null) : null;
    var flowWeak = flowScore != null && flowScore < 40;
    var chartWeak = chartScore != null && chartScore < 40;
    var flowHealthy = flowScore != null && flowScore >= 55;
    var chartHealthy = chartScore != null && chartScore >= 55;
    var improving = !!(data && data.ret5 > 0 && (data.ma5 == null || data.close >= data.ma5));
    var deterioration = !!(data && data.ret20 <= -12 && data.ret5 <= 0 && belowPoc);
    var synchronizedWeakness = flowWeak && chartWeak && deterioration;
    var repairable = flowHealthy && chartHealthy && (improving || !belowPoc);
    var exitSignal = profitTakingSignal(chart, data, metrics && metrics.holding && metrics.holding.horizon);
    // A small positive return is not, by itself, a profit-taking signal. The
    // holding model currently has no entry date, so use a conservative return
    // band until the user has enough price/flow confirmation.
    var modestProfit = lossRate != null && lossRate >= 0 && lossRate < 3;
    var advice;
    if (!hasHolding) {
      advice = { label: '보유 수량·평단 입력 필요', tone: 'neutral', reason: '수급과 차트는 확인했지만 물타기·손절 판단은 보유 수량과 평단을 입력한 뒤 계산합니다.' };
    } else if (lossRate >= 0 && exitSignal.level >= 2) {
      advice = { label: '분할 익절 검토', tone: 'up', reason: exitSignal.note };
    } else if (modestProfit) {
      advice = { label: '보유 · 추세 확인', tone: 'neutral', reason: '현재 수익률은 소폭 상승 구간입니다. 매수 당일이나 초기 수익만으로 분할 익절을 판단하지 않고 5일선·거래량·수급의 유지 여부를 확인하세요.' };
    } else if (lossRate >= 0) {
      advice = { label: '수익 구간 · 목표가·비중 점검', tone: 'up', reason: '수익률만으로 분할 익절을 결정하지 않습니다. 수급과 차트가 유지되는지 확인하면서 목표가와 보유 비중을 관리하세요.' };
    } else if (repairable) {
      advice = { label: '조건부 분할 물타기 검토', tone: 'up', reason: '손실률이 있어도 수급과 차트가 함께 회복 신호를 보여 전량 물타기보다 예산을 나눠 평균단가를 낮추는 시나리오를 검토할 수 있습니다.' };
    } else if (synchronizedWeakness && lossRate <= -20) {
      advice = { label: '손절 기준 검토 · 물타기 보류', tone: 'down', reason: '손실률 하나가 아니라 수급 약화와 중기 하락, 매물대 아래 체류가 동시에 확인됩니다. 추가 매수보다 사전에 정한 손실 제한선과 비중 축소 기준을 먼저 점검하세요.' };
    } else if (flowWeak && chartWeak) {
      advice = { label: '물타기 보류 · 반등 확인', tone: 'neutral', reason: '수급과 차트가 모두 약하지만 아직 손절을 단정할 단계는 아닙니다. 매물대 회복과 외국인·기관 수급 전환을 확인한 뒤 대응하세요.' };
    } else {
      advice = { label: '시장 조정·혼조 구간 · 관찰', tone: 'neutral', reason: '손실률만으로 손절하지 않습니다. 현재 신호가 엇갈리므로 물타기는 보류하고 수급·차트 중 한 축이라도 회복되는지 확인하세요.' };
    }
    return {
      advice: advice,
      flowScore: flowScore,
      chartScore: chartScore,
      flowLabel: scoreWord(flowScore),
      chartLabel: scoreWord(chartScore),
      flowNote: notes.flow && notes.flow.desc || notes.foreignInst && notes.foreignInst.desc || '수급 데이터가 부족합니다.',
      chartNote: data ? chartShapeNote(chart, summary) + (exitSignal.note ? ' ' + exitSignal.note : '') : '차트 데이터가 부족합니다.',
      lossRate: lossRate,
      belowPoc: belowPoc,
      exitSignal: exitSignal
    };
  }
  function positionAdvice(metrics, chart, summary, volume) {
    return positionDecision(metrics, chart, summary, volume).advice;
  }
  function buildCompositeOpinionCard(metrics, chart, summary, volume, ai) {
    var model = positionDecision(metrics, chart, summary, volume);
    var advice = model.advice;
    var lossText = model.lossRate == null ? '평단 입력 필요' : '손익률 ' + formatSigned(model.lossRate, 2) + '%';
    function axis(label, score, state, note) {
      return '<div class="my-opinion-axis"><div class="my-opinion-axis-head"><strong>' + label + '</strong><span class="' + (score >= 65 ? 'is-up' : score != null && score < 45 ? 'is-down' : 'is-flat') + '">' + (score == null ? '데이터 부족' : Math.round(score) + '점 · ' + state) + '</span></div><p>' + escapeHtml(note) + '</p></div>';
    }
    return '<section class="my-analysis-card my-composite-card my-ai-card my-position-advice"><div class="my-card-title"><strong>종합의견</strong><span>수급 · 차트 · 물타기</span></div>'
      + '<div class="my-opinion-grid">'
      + axis('수급', model.flowScore, model.flowLabel, model.flowNote)
      + axis('차트', model.chartScore, model.chartLabel, model.chartNote)
      + axis('물타기', null, advice.label, advice.reason)
      + '</div><div class="my-opinion-verdict ' + advice.tone + '"><span>현재 판단</span><strong>' + escapeHtml(advice.label) + '</strong><p>' + escapeHtml(advice.reason) + '</p><small>' + escapeHtml(lossText) + ' · 손실률만으로 판단하지 않음</small></div>'
      + (ai ? '<div class="my-ai-evidence"><b>보조 코멘트</b> ' + escapeHtml(ai) + '</div>' : '')
      + '<p class="my-analysis-footnote">투자 참고용 · 수급·차트·보유정보를 함께 계산한 참고 신호이며 투자 권유나 손실 회복을 보장하지 않습니다.</p></section>';
  }
  function estimateRecovery(chart, currentPrice, targetPrice) {
    if (!(currentPrice > 0) || !(targetPrice > currentPrice) || !chart || !chart.daily || chart.daily.length < 3) return targetPrice <= currentPrice ? '현재가 수준' : '산정 불가';
    var closes = chart.daily.map(function (row) { return number(row.close, null); }).filter(function (value) { return value > 0; }).slice(-61);
    if (closes.length < 3) return '산정 불가';
    var recent = closes.slice(-21), start = recent[0], end = recent[recent.length - 1];
    var dailyRate = start > 0 && end > 0 ? Math.pow(end / start, 1 / Math.max(1, recent.length - 1)) - 1 : 0;
    if (!(dailyRate > 0.0005)) return '산정 불가(상승 추세 필요)';
    var days = Math.ceil(Math.log(targetPrice / currentPrice) / Math.log(1 + dailyRate));
    if (!isFinite(days) || days > 2520) return '5년 초과';
    return days + '거래일(약 ' + Math.max(1, Math.ceil(days / 21)) + '개월)';
  }
  function summaryNotes(summary) {
    var result = {};
    (summary && summary.items || []).forEach(function (item) { result[item.key] = item; });
    return result;
  }
  function buildAveragingCalculatorWithRecovery(metrics, code, chart) {
    var invested = metrics.invested || 0;
    var maxBudget = Math.max(invested * 2, metrics.price || metrics.holding.averagePrice || 1000000);
    var defaultBudget = invested ? Math.round(invested * 0.5) : 0;
    var step = Math.max(1, Math.round(maxBudget / 100));
    return '<section class="my-analysis-card my-calculator"><div class="my-card-title"><strong>물타기 계산기</strong><span>슬라이더로 추가 매수금액 조절</span></div>'
      + '<label class="my-range-label">추가 투입금액 <output data-my-calc-output>' + formatPrice(defaultBudget, code) + '</output><input type="range" min="0" max="' + escapeAttr(maxBudget) + '" step="' + escapeAttr(step) + '" value="' + escapeAttr(defaultBudget) + '" data-my-calc="budget"></label>'
      + '<div class="my-calc-auto"><span>추가 매수가<strong data-my-calc-price>' + formatPrice(metrics.price, code) + '</strong></span><span>자동 매수 수량<strong data-my-calc-quantity>-</strong></span><span>새 평균단가<strong data-my-calc-target>-</strong></span><span>원금 회복 예상시간<strong data-my-calc-recovery>-</strong></span></div>'
      + '<div class="my-calc-result" data-my-calc-result>현재 수량과 평단을 입력하면 예상 평균단가와 회복 시간을 계산합니다.</div></section>';
  }
  function arrangeAnalysisSections(root) {
    var holding = root.querySelector('.my-holding-card');
    if (!holding) return;
    var nodes = ['.my-composite-card', '.my-analysis-grid', '.my-chart-shape', '.my-calculator'].map(function (selector) { return root.querySelector(selector); }).filter(Boolean);
    var cursor = holding;
    nodes.forEach(function (node) { cursor.insertAdjacentElement('afterend', node); cursor = node; });
  }
  function appendAiChartInsight(root, chart, summary) {
    var card = root.querySelector('.my-ai-card');
    var text = card && card.querySelector('p');
    if (!text) return;
    var insight = document.createElement('p');
    insight.className = 'my-ai-evidence';
    insight.innerHTML = '<b>차트 모양 근거</b> ' + escapeHtml(chartShapeNote(chart, summary));
    text.insertAdjacentElement('afterend', insight);
  }
  function fetchAi(item, summary, volume, metrics, chart) {
    if (/^US:/i.test(item.code)) return Promise.resolve('미국 종목은 수급 원천 데이터 제한으로 수급 점수 대신 가격·차트 모양을 중심으로 분석합니다. ' + chartShapeNote(chart, summary));
    var notes = summaryNotes(summary);
    var params = new URLSearchParams();
    params.set('action', 'flowAiSummary');
    params.set('code', item.code);
    params.set('name', displayName(item));
    params.set('flowScore', notes.flow && notes.flow.score || '');
    params.set('flowNote', notes.flow && notes.flow.desc || '');
    params.set('foreignInstScore', notes.foreignInst && notes.foreignInst.score || '');
    params.set('foreignInstNote', notes.foreignInst && notes.foreignInst.desc || '');
    params.set('techScore', notes.tech && notes.tech.score || '');
    params.set('techNote', notes.tech && notes.tech.desc || '');
    params.set('shortScore', notes.short && notes.short.score || '');
    params.set('shortNote', notes.short && notes.short.desc || '');
    params.set('pensionScore', notes.pension && notes.pension.score || '');
    params.set('pensionNote', notes.pension && notes.pension.desc || '');
    params.set('volNote', '현재가 ' + formatPrice(metrics.price, item.code) + ', 평단 ' + formatPrice(metrics.holding.averagePrice, item.code) + ', 매물대 중심 ' + (volume && (volume.poc || volume.pocPrice) || '데이터 없음'));
    params.set('rsiNote', notes.momentum && notes.momentum.desc || '');
    params.set('chartNote', chartShapeNote(chart, summary));
    var advice = positionAdvice(metrics, chart, summary, volume);
    params.set('positionNote', advice.label + ' / ' + advice.reason);
    params.set('holdingNote', '보유수량 ' + formatNumber(metrics.holding.quantity, 2) + ', 평단 ' + formatPrice(metrics.holding.averagePrice, item.code) + ', 손익률 ' + formatSigned(metrics.rate, 2) + '%');
    return fetchJson(GAS_URL + '?' + params.toString()).then(function (body) { return body && body.data && body.data.summary || body.summary || null; });
  }
  function fetchSelected(item) {
    var id = ++state.requestId;
    var cached = state.analyses[item.code];
    var quotePromise = global.Watchlist.fetchQuotes([item.code]).then(function (quotes) { state.quotes[item.code] = quotes[item.code] || {}; return quotes[item.code] || {}; }).catch(function () { return state.quotes[item.code] || {}; });
    var flowPromise = loadScript(FOREIGN_FLOW_SCRIPT, 'foreign-flow').then(function (flowApi) { return flowApi.fetchFlow(item.code, displayName(item), 63); }).catch(function () { return null; });
    var summaryPromise = loadScript(FOREIGN_FLOW_SCRIPT, 'foreign-flow').then(function (flowApi) { return flowApi.fetchAnalysisSummary(item.code, displayName(item)); }).catch(function () { return null; });
    var chartPromise = loadScript(FOREIGN_FLOW_SCRIPT, 'foreign-flow').then(function (flowApi) { return flowApi.fetchJson(GAS_URL + '?action=flowChart&code=' + encodeURIComponent(item.code)); }).catch(function () { return null; });
    var volumePromise = Promise.resolve(null);
    Promise.all([quotePromise, flowPromise, summaryPromise, volumePromise, chartPromise]).then(function (results) {
      if (id !== state.requestId || !itemByCode(item.code)) return;
      var metrics = itemMetrics(item, results[0]);
      var volume = buildDailyVolumeProfile(results[4], item.code);
      fetchAi(item, results[2], volume, metrics, results[4]).catch(function () { return null; }).then(function (ai) {
        if (id !== state.requestId) return;
        state.analyses[item.code] = { quote: results[0], flow: results[1], summary: results[2], volume: volume, chart: results[4], ai: ai };
        render();
      });
    });
    if (!cached) renderDetail(item, { loading: true, quote: state.quotes[item.code] || {} });
  }
  function renderDetail(item, analysis) {
    var detail = document.getElementById('myDashboardDetail');
    if (!detail) return;
    if (!item) { detail.innerHTML = '<div class="my-dashboard-empty"><strong>분석할 종목을 입력하세요.</strong><p>위 입력창에 종목명, 6자리 코드 또는 미국 티커를 입력하면 수급·매물대·차트 모양을 계산합니다.</p></div>'; return; }
    var name = displayName(item);
    var quote = analysis && analysis.quote || state.quotes[item.code] || {};
    var metrics = itemMetrics(item, quote);
    var dailyChangeRate = quoteField(quote, ['changeRate', 'change_rate', 'change_rate_pct']);
    var dailyChangeClass = signClass(dailyChangeRate);
    if (analysis && analysis.loading) {
      detail.innerHTML = '<div class="my-detail-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><strong>' + escapeHtml(name) + '</strong><p>차트·수급·매물대 자료를 불러오는 중입니다...</p></div>' + buildHoldingForm(item, metrics);
      return;
    }
    var frameUrl = '/page/foreign-flow?code=' + encodeURIComponent(item.code) + '&name=' + encodeURIComponent(name);
    detail.innerHTML = '<div class="my-detail-head"><div><span class="my-dashboard-eyebrow">SELECTED STOCK</span><h3 class="my-selected-title ' + dailyChangeClass + '"><span class="my-selected-name">' + escapeHtml(name) + '</span> <small>' + escapeHtml(item.code) + '</small></h3></div><div class="my-detail-actions"><a href="' + frameUrl + '" target="_blank" rel="noopener">상세 종목분석</a><a href="/page/stock-search?code=' + encodeURIComponent(item.code) + '" target="_blank" rel="noopener">호가·실시간</a></div></div>'
      + '<div class="my-metric-grid"><div><span>현재가</span><strong>' + formatPrice(metrics.price, item.code) + '</strong><small class="' + dailyChangeClass + '">' + (dailyChangeRate == null ? '-' : formatSigned(dailyChangeRate, 2) + '%') + '</small></div><div><span>평가금액</span><strong>' + (metrics.value == null ? '-' : formatPrice(metrics.value, item.code)) + '</strong></div><div><span>평가손익</span><strong class="' + signClass(metrics.pnl) + '">' + (metrics.pnl == null ? '-' : formatSigned(metrics.pnl, 0) + '원') + '</strong><small>' + (metrics.rate == null ? '평단 입력 필요' : formatSigned(metrics.rate, 2) + '%') + '</small></div></div>'
      + buildHoldingForm(item, metrics)
      + '<div class="my-analysis-grid">' + buildFlowCard(analysis && analysis.flow) + buildVolumeCard(analysis && analysis.volume, analysis && analysis.chart, item.code, metrics.price) + '</div>'
      + buildChartShapeCard(analysis && analysis.chart, analysis && analysis.summary)
      + buildCompositeOpinionCard(metrics, analysis && analysis.chart, analysis && analysis.summary, analysis && analysis.volume, analysis && analysis.ai || '')
      + buildAveragingCalculatorWithRecovery(metrics, item.code, analysis && analysis.chart)
      + '<details class="my-detail-frame"><summary>기존 차트·매물대 도구를 이 화면에서 펼치기</summary><iframe title="' + escapeAttr(name) + ' 종목분석" loading="lazy" src="' + frameUrl + '"></iframe></details>';
    arrangeAnalysisSections(detail);
    updateCalculatorWithRecovery(detail, metrics, analysis && analysis.chart);
  }
  function updateCalculator(root, metrics) {
    var budgetInput = root.querySelector('[data-my-calc="budget"]');
    var budgetOutput = root.querySelector('[data-my-calc-output]');
    var priceOutput = root.querySelector('[data-my-calc-price]');
    var quantityOutput = root.querySelector('[data-my-calc-quantity]');
    var output = root.querySelector('[data-my-calc-result]');
    if (!budgetInput || !output) return;
    var addBudget = number(budgetInput.value, 0);
    var addPrice = metrics.price || metrics.holding.averagePrice || 0;
    var addQuantity = addPrice > 0 ? addBudget / addPrice : 0;
    if (budgetOutput) budgetOutput.textContent = formatPrice(addBudget, state.selectedCode);
    if (priceOutput) priceOutput.textContent = formatPrice(addPrice, state.selectedCode);
    if (quantityOutput) quantityOutput.textContent = addQuantity ? formatNumber(addQuantity, 2) + '주' : '-';
    var totalQuantity = metrics.holding.quantity + addQuantity;
    if (!metrics.holding.quantity || !metrics.holding.averagePrice || !addPrice || !addQuantity || !totalQuantity) {
      output.textContent = '현재 수량과 평단을 입력하면 슬라이더로 예상 평단가를 계산합니다.';
      return;
    }
    var nextAverage = (metrics.holding.quantity * metrics.holding.averagePrice + addQuantity * addPrice) / totalQuantity;
    output.innerHTML = '추가 후 예상 평단가 <strong>' + formatPrice(nextAverage, state.selectedCode) + '</strong> · 총 수량 ' + formatNumber(totalQuantity, 2) + '주';
  }
  function updateCalculatorWithRecovery(root, metrics, chart) {
    var budgetInput = root.querySelector('[data-my-calc="budget"]');
    var budgetOutput = root.querySelector('[data-my-calc-output]');
    var priceOutput = root.querySelector('[data-my-calc-price]');
    var quantityOutput = root.querySelector('[data-my-calc-quantity]');
    var targetOutput = root.querySelector('[data-my-calc-target]');
    var recoveryOutput = root.querySelector('[data-my-calc-recovery]');
    var output = root.querySelector('[data-my-calc-result]');
    if (!budgetInput || !output) return;
    var addBudget = number(budgetInput.value, 0);
    var addPrice = metrics.price || metrics.holding.averagePrice || 0;
    var addQuantity = addPrice > 0 ? addBudget / addPrice : 0;
    if (budgetOutput) budgetOutput.textContent = formatPrice(addBudget, state.selectedCode);
    if (priceOutput) priceOutput.textContent = formatPrice(addPrice, state.selectedCode);
    if (quantityOutput) quantityOutput.textContent = addQuantity ? formatNumber(addQuantity, 2) + '주' : '-';
    var totalQuantity = metrics.holding.quantity + addQuantity;
    if (!metrics.holding.quantity || !metrics.holding.averagePrice || !addPrice || !addQuantity || !totalQuantity) {
      if (targetOutput) targetOutput.textContent = '-';
      if (recoveryOutput) recoveryOutput.textContent = '-';
      output.textContent = '현재 수량과 평단을 입력하면 예상 평균단가와 회복 시간을 계산합니다.';
      return;
    }
    var nextAverage = (metrics.holding.quantity * metrics.holding.averagePrice + addQuantity * addPrice) / totalQuantity;
    var recovery = estimateRecovery(chart, addPrice, nextAverage);
    if (targetOutput) targetOutput.textContent = formatPrice(nextAverage, state.selectedCode);
    if (recoveryOutput) recoveryOutput.textContent = recovery;
    output.innerHTML = '추가 후 예상 평단가 <strong>' + formatPrice(nextAverage, state.selectedCode) + '</strong> · 총 수량 ' + formatNumber(totalQuantity, 2) + '주 · 원금 회복 예상 <strong>' + escapeHtml(recovery) + '</strong><br><small>최근 20거래일 상승률을 단순 연장한 참고치이며 실제 회복을 보장하지 않습니다.</small>';
  }
  function updateHoldingPreview(root, item) {
    if (!root || !item) return;
    var metrics = itemMetrics(item, state.quotes[item.code] || {});
    var preview = root.querySelector('[data-my-holding-preview]');
    if (!preview) return;
    var values = preview.querySelectorAll('strong');
    var pnl = values[1];
    var rate = values[2];
    if (values[0]) values[0].textContent = metrics.value == null ? '-' : formatPrice(metrics.value, item.code);
    if (pnl) { pnl.textContent = metrics.pnl == null ? '평단 입력 필요' : formatPrice(metrics.pnl, item.code); pnl.className = signClass(metrics.pnl); }
    if (rate) { rate.textContent = metrics.rate == null ? '-' : formatSigned(metrics.rate, 2) + '%'; rate.className = signClass(metrics.rate); }
    updateCalculatorWithRecovery(root, metrics, state.analyses[item.code] && state.analyses[item.code].chart);
  }
  function render() {
    if (!mount || !global.Watchlist) return;
    var items = global.Watchlist.getList();
    if (state.selectedCode && !items.some(function (item) { return item.code === state.selectedCode; }) && !(state.selectedItem && state.selectedItem.code === state.selectedCode)) state.selectedCode = null;
    if (state.selectedCode && items.some(function (item) { return item.code === state.selectedCode; })) state.selectedItem = items.filter(function (item) { return item.code === state.selectedCode; })[0];
    populateSearchOptions();
    buildWatchlistTable(items);
    updateWatchlistVisibility();
    refreshWatchlistQuotes(items);
    var status = document.getElementById('myDashboardStatus');
    if (status && !state.selectedCode) status.textContent = global.Watchlist.isReady() ? '분석할 종목을 입력하세요.' : '로그인 상태를 확인하는 중입니다. 분석은 먼저 이용할 수 있습니다.';
    var item = itemByCode(state.selectedCode);
    var cached = item && state.analyses[item.code];
    renderDetail(item, cached || { loading: true, quote: item && state.quotes[item.code] || {} });
    if (item && !cached) fetchSelected(item);
  }
  function wire() {
    mount.addEventListener('click', function (event) {
      var load = event.target.closest('[data-my-load]');
      if (load) { selectedFromInput(); return; }
      var addWatchlist = event.target.closest('[data-my-watchlist-add]');
      if (addWatchlist) { openWatchlistAddModal(); return; }
      var closeWatchlistModal = event.target.closest('[data-my-watchlist-close]');
      if (closeWatchlistModal) { closeWatchlistAddModal(); return; }
      var confirmWatchlist = event.target.closest('[data-my-watchlist-add-confirm]');
      if (confirmWatchlist) { addFromWatchlistModal(); return; }
      var groupToggle = event.target.closest('[data-my-group-toggle]');
      if (groupToggle) {
        var groupId = groupToggle.getAttribute('data-my-group-toggle');
        var expanded = groupToggle.getAttribute('aria-expanded') === 'true';
        if (global.Watchlist.setGroupCollapsed) global.Watchlist.setGroupCollapsed(groupId, expanded);
        buildWatchlistTable(global.Watchlist.getList());
        return;
      }
      var row = event.target.closest('[data-my-row]');
      if (row) {
        var rowItem = itemByCode(row.getAttribute('data-my-row'));
        if (rowItem) {
          state.selectedCode = rowItem.code;
          state.selectedItem = rowItem;
          state.watchlistCollapsed = true;
          var input = document.getElementById('myStockInput');
          if (input) input.value = displayName(rowItem);
          updateInputLogo(rowItem);
          delete state.analyses[rowItem.code];
          render();
        }
        return;
      }
      var showWatchlist = event.target.closest('[data-my-watchlist-show]');
      if (showWatchlist) {
        state.watchlistCollapsed = false;
        updateWatchlistVisibility();
        return;
      }
      var save = event.target.closest('[data-my-save]');
      if (save) {
        var item = itemByCode(save.getAttribute('data-my-save'));
        var root = save.closest('.my-dashboard-detail');
        var holding = { quantity: number(root.querySelector('[data-my-field="quantity"]').value), averagePrice: number(root.querySelector('[data-my-field="averagePrice"]').value), horizon: root.querySelector('[data-my-field="horizon"]').value };
        var added = item && item.temporary ? global.Watchlist.add(item.code, item.name) : { ok: true };
        var result = added.ok ? global.Watchlist.updateHolding(item.code, holding) : added;
        save.textContent = result.ok ? '저장됨' : (result.reason === 'login' ? '로그인 필요' : '저장 실패');
        setTimeout(function () { save.textContent = item && item.temporary ? 'MY에 저장' : '저장'; }, 1500);
        if (result.ok) { state.selectedItem = itemByCode(item.code) || Object.assign(item, { temporary: false, holding: holding }); delete state.analyses[item.code]; render(); }
      }
    });
    mount.addEventListener('input', function (event) {
      if (event.target.id === 'myStockInput') updateInputLogo(resolveInput(event.target.value));
      if (event.target.matches('[data-my-field]')) {
        var selected = itemByCode(state.selectedCode);
        if (selected) {
          selected.holding = { quantity: number(mount.querySelector('[data-my-field="quantity"]').value), averagePrice: number(mount.querySelector('[data-my-field="averagePrice"]').value), horizon: mount.querySelector('[data-my-field="horizon"]').value };
          updateHoldingPreview(mount, selected);
          buildWatchlistTable(global.Watchlist.getList());
        }
      }
      if (event.target.matches('[data-my-calc]')) {
        var item = itemByCode(state.selectedCode);
        if (item) updateCalculatorWithRecovery(mount, itemMetrics(item, state.quotes[item.code] || {}), state.analyses[item.code] && state.analyses[item.code].chart);
      }
    });
    mount.addEventListener('keydown', function (event) {
      if (event.target.id === 'myStockInput' && event.key === 'Enter') { event.preventDefault(); selectedFromInput(); }
      if (event.target.id === 'myWatchlistAddInput' && event.key === 'Enter') { event.preventDefault(); addFromWatchlistModal(); }
      if (event.target.id === 'myWatchlistAddInput' && event.key === 'Escape') { event.preventDefault(); closeWatchlistAddModal(); }
    });
    global.addEventListener('watchlist:changed', function () { render(); });
  }
  function init() {
    mount = mountPage();
    if (!mount) return;
    renderShell();
    wire();
    waitForWatchlist().then(function () { render(); }).catch(function () {
      var status = document.getElementById('myDashboardStatus');
      if (status) status.innerHTML = 'Google 로그인 후 내 종목 분석을 사용할 수 있습니다. <a href="' + API_BASE + '/auth/google/start?return_to=' + encodeURIComponent(global.location.href) + '">Google로 로그인</a>';
    });
    setInterval(function () {
      var codes = state.selectedCode ? [state.selectedCode] : [];
      if (!codes.length || !global.Watchlist) return;
      global.Watchlist.fetchQuotes(codes).then(function (quotes) { state.quotes = Object.assign(state.quotes, quotes || {}); var item = itemByCode(state.selectedCode); if (item && state.analyses[item.code]) renderDetail(item, state.analyses[item.code]); });
    }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
