/* 홈 증권사형 실시간 종목판. 초기 목록은 REST, 변경된 숫자는 WebSocket으로 갱신한다. */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/market-board';
  var WS_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var LIMIT = 20;
  var REFRESH_MS = 30 * 1000;
  var SESSION_CHECK_MS = 60 * 1000;
  var TABS = [
    ['tradeAmount', '거래대금'],
    ['tradeVolume', '거래량'],
    ['rising', '상승률'],
    ['falling', '하락률'],
    ['marketCap', '시가총액'],
    ['industry', '업종']
  ];
  var state = { mount: null, market: '', active: 'tradeAmount', data: null, socket: null, timer: null, loading: false };
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
    var now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var hour = now.getUTCHours();
    return hour >= 20 || hour < 8 ? 'us' : 'domestic';
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
    if (parsed >= 100000000000) return (parsed / 100000000000).toFixed(1).replace(/\.0$/, '') + '조';
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

  function rowHtml(item, rank) {
    var code = item.code || item.symbol;
    var rate = number(item.change_rate);
    var tone = rate > 0 ? 'hrt-up' : rate < 0 ? 'hrt-down' : 'hrt-flat';
    var industry = industryFor(item);
    if ((!industry || industry === '미분류') && global.WICS_MAP && global.WICS_MAP[code]) {
      industry = global.WICS_MAP[code].industry || global.WICS_MAP[code].sector || '';
    }
    return '<tr data-code="' + escapeHtml(code) + '">'
      + '<td class="hrt-stock"><span class="hrt-rank">' + rank + '</span>' + stockIconHtml(item) + '<a href="/page/stock-search?code=' + encodeURIComponent(code)
      + '&name=' + encodeURIComponent(item.name || code) + '"><strong>' + escapeHtml(item.name || code) + '</strong><small>'
      + escapeHtml(item.symbol || code) + '</small></a></td>'
      + '<td class="hrt-price" data-field="price">' + fmtPrice(item.price, item.currency) + '</td>'
      + '<td data-field="amount">' + fmtAmount(item.trade_amount, item.currency) + '</td>'
      + '<td data-field="volume">' + fmtCount(item.trade_volume) + '</td>'
      + '<td data-field="rising">' + rateCell(rate, true) + '</td>'
      + '<td data-field="falling">' + rateCell(rate, false) + '</td>'
      + '<td data-field="cap">' + fmtMarketCap(item.market_cap, item.currency) + '</td>'
      + '<td class="hrt-industry" title="' + escapeHtml(industry) + '">' + escapeHtml(industry || '-') + '</td>'
      + '</tr>';
  }

  function buildShell(mount) {
    mount.innerHTML = '<div class="hrt-head"><div><strong>실시간 종목판</strong><span data-hrt-session></span></div>'
      + '<small data-hrt-updated>시세 확인 중</small></div>'
      + '<div class="hrt-tabs" role="tablist" aria-label="실시간 종목 정렬">'
      + TABS.map(function (tab) {
        return '<button type="button" role="tab" data-hrt-tab="' + tab[0] + '" aria-selected="' + (tab[0] === state.active) + '">' + tab[1] + '</button>';
      }).join('') + '</div>'
      + '<div class="hrt-table-wrap"><table><thead><tr><th>종목</th><th>현재가</th><th>거래대금</th><th>거래량</th><th>상승률</th><th>하락률</th><th>시가총액</th><th>업종</th></tr></thead>'
      + '<tbody data-hrt-body><tr><td colspan="8" class="hrt-state">실시간 종목을 불러오는 중입니다.</td></tr></tbody></table></div>'
      + '<div class="hrt-foot"><span data-hrt-source>초기 목록 로딩 중</span><span>체결 발생 행만 갱신</span></div>';
  }

  function rowsForActive() {
    var sections = state.data && state.data.sections;
    return (sections && sections[state.active]) || (state.data && state.data.rows) || [];
  }

  function renderRows() {
    if (!state.mount) return;
    var body = state.mount.querySelector('[data-hrt-body]');
    if (!body) return;
    var rows = rowsForActive();
    body.innerHTML = rows.length
      ? rows.map(function (item, index) { return rowHtml(item, index + 1); }).join('')
      : '<tr><td colspan="8" class="hrt-state">현재 세션의 종목 데이터가 없습니다.</td></tr>';
    state.mount.querySelectorAll('[data-hrt-tab]').forEach(function (button) {
      var selected = button.getAttribute('data-hrt-tab') === state.active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function stopRealtime() {
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
      state.socket = null;
    }
  }

  function startRealtime() {
    stopRealtime();
    var data = state.data || {};
    var all = [];
    var seen = {};
    Object.keys(data.sections || {}).forEach(function (key) {
      (data.sections[key] || []).forEach(function (item) {
        if (item && item.code && !seen[item.code]) { seen[item.code] = true; all.push(item.code); }
      });
    });
    if (!all.length || !('WebSocket' in global) || document.hidden) return;
    var socket = new WebSocket(WS_URL + '?codes=' + all.map(encodeURIComponent).join(','));
    state.socket = socket;
    socket.onmessage = function (event) {
      try {
        var quote = JSON.parse(event.data);
        if (quote.type === 'quote' && quote.code) updateRow(quote.code, quote);
      } catch (error) {}
    };
    socket.onclose = function () { if (state.socket === socket) state.socket = null; };
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

  function fetchBoard() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    var market = currentMarket();
    if (market !== state.market) {
      state.market = market;
      state.active = 'tradeAmount';
      stopRealtime();
    }
    var url = API_URL + '?market=' + market + '&limit=' + LIMIT;
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('market-board ' + response.status);
      return response.json();
    }).then(function (json) {
      state.data = json.data || json;
      var session = state.mount.querySelector('[data-hrt-session]');
      var updated = state.mount.querySelector('[data-hrt-updated]');
      var source = state.mount.querySelector('[data-hrt-source]');
      if (session) session.textContent = state.data.session || marketLabel(market);
      if (updated) updated.textContent = '실시간 · ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
      if (source) source.textContent = state.data.source || '시장 데이터';
      renderRows();
      startRealtime();
    }).catch(function () {
      var body = state.mount.querySelector('[data-hrt-body]');
      if (body && !state.data) body.innerHTML = '<tr><td colspan="8" class="hrt-state">종목 데이터를 잠시 불러오지 못했습니다.</td></tr>';
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
    var loadIndustryMap = global.WICS_MAP ? Promise.resolve() : new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'https://goodbyestarwars.github.io/tistory-ticker/data/wics-map.js?v=20260810';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
    loadIndustryMap.then(fetchBoard);
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
