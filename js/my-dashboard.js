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
  var FOREIGN_FLOW_SCRIPT = 'https://goodbyestarwars.github.io/tistory-ticker/js/foreign-flow.js?v=20260813-my-dashboard';
  var state = { selectedCode: null, quotes: {}, analyses: {}, requestId: 0 };
  var mount = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function escapeAttr(value) { return escapeHtml(value); }
  function number(value, fallback) {
    if (value == null || value === '') return fallback == null ? null : fallback;
    var n = Number(value);
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
  function formatPrice(value, code) {
    var n = number(value, null);
    if (n == null) return '-';
    return /^US:/i.test(code) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatNumber(n, 0) + '원';
  }
  function signClass(value) { return number(value) > 0 ? 'is-up' : number(value) < 0 ? 'is-down' : 'is-flat'; }
  function holdingOf(item) {
    var h = item && item.holding || {};
    return { quantity: Math.max(0, number(h.quantity)), averagePrice: Math.max(0, number(h.averagePrice)) };
  }
  function itemByCode(code) {
    return global.Watchlist.getList().filter(function (item) { return item.code === code; })[0] || null;
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
      + '<div><span class="my-dashboard-eyebrow">MY PORTFOLIO</span><h2>내 종목 분석</h2><p>보유정보만 저장하고, 시세·차트·수급·매물대는 필요할 때 불러옵니다.</p></div>'
      + '<span class="my-dashboard-storage">DB에는 종목·수량·평단만 저장</span></header>'
      + '<div id="myDashboardStatus" class="my-dashboard-status">내 종목을 불러오는 중...</div>'
      + '<div class="my-dashboard-grid"><aside class="my-dashboard-list" id="myDashboardList"></aside><main class="my-dashboard-detail" id="myDashboardDetail"></main></div>';
  }
  function renderList(items) {
    var list = document.getElementById('myDashboardList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="my-dashboard-empty"><strong>내 종목이 없습니다.</strong><p>위 관심종목 영역에서 종목을 추가하면 이곳에서 평단·수익·수급을 함께 분석할 수 있습니다.</p></div>';
      return;
    }
    list.innerHTML = '<div class="my-dashboard-list-head"><strong>내 종목</strong><span>' + items.length + '개</span></div>'
      + items.map(function (item) {
        var quote = state.quotes[item.code] || {};
        var holding = holdingOf(item);
        var pnl = holding.averagePrice && holding.quantity ? (number(quote.price) - holding.averagePrice) * holding.quantity : null;
        return '<button type="button" class="my-stock-row' + (item.code === state.selectedCode ? ' is-selected' : '') + '" data-my-select="' + escapeAttr(item.code) + '">'
          + '<span class="my-stock-row-name"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.code) + '</small></span>'
          + '<span class="my-stock-row-price">' + formatPrice(quote.price, item.code) + '<small class="' + signClass(quote.changeRate) + '">' + formatSigned(quote.changeRate, 2) + '%</small></span>'
          + '<span class="my-stock-row-pnl ' + signClass(pnl) + '">' + (pnl == null ? '평단 미입력' : formatSigned(pnl, 0) + '원') + '</span></button>';
      }).join('');
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
  function buildHoldingForm(item, metrics) {
    return '<div class="my-holding-card"><div class="my-card-title"><strong>내 보유정보</strong><span>Google 계정에 저장</span></div>'
      + '<div class="my-holding-fields"><label>수량<input type="number" min="0" step="any" data-my-field="quantity" value="' + escapeAttr(metrics.holding.quantity || '') + '"></label>'
      + '<label>평단가<input type="number" min="0" step="any" data-my-field="averagePrice" value="' + escapeAttr(metrics.holding.averagePrice || '') + '"></label>'
      + '<button type="button" class="my-save-holding" data-my-save="' + escapeAttr(item.code) + '">저장</button></div>'
      + '<div class="my-holding-note">입력하지 않으면 시세·수급 분석만 표시됩니다.</div></div>';
  }
  function buildAveragingCalculator(metrics, code) {
    var basePrice = metrics.price == null ? metrics.holding.averagePrice : metrics.price;
    return '<section class="my-analysis-card my-calculator"><div class="my-card-title"><strong>물타기 계산기</strong><span>계산 결과는 저장하지 않음</span></div>'
      + '<div class="my-calc-fields"><label>추가 매수가<input type="number" min="0" step="any" data-my-calc="price" value="' + escapeAttr(basePrice || '') + '"></label>'
      + '<label>추가 수량<input type="number" min="0" step="any" data-my-calc="quantity" value=""></label></div>'
      + '<div class="my-calc-result" data-my-calc-result>현재 수량과 평단을 입력하면 예상 평단가를 계산합니다.</div></section>';
  }
  function buildFlowCard(flow) {
    var daily = flow && flow.daily && flow.daily[0] || {};
    var rolling = flow && flow.rolling && flow.rolling['5d'] || {};
    var rows = [
      ['외국인', daily.foreign_net, rolling.foreign],
      ['기관', daily.inst_net, rolling.inst],
      ['개인', daily.ind_net, rolling.ind]
    ];
    return '<section class="my-analysis-card"><div class="my-card-title"><strong>수요·공급 흐름</strong><span>' + escapeHtml(daily.date || '최근 데이터') + '</span></div>'
      + '<div class="my-flow-grid">' + rows.map(function (row) {
        return '<div class="my-flow-row"><span>' + row[0] + '</span><b class="' + signClass(row[1]) + '">' + formatSigned(row[1], 0) + '</b><small>5일 ' + formatSigned(row[2], 0) + '</small></div>';
      }).join('') + '</div><p class="my-analysis-footnote">+는 순매수, -는 순매도입니다. 수급은 투자 참고용으로만 확인하세요.</p></section>';
  }
  function buildVolumeCard(volume) {
    if (!volume || !volume.bins || !volume.bins.length) return '<section class="my-analysis-card"><div class="my-card-title"><strong>매물대</strong></div><p class="my-muted">실제 체결가 매물대 데이터를 불러오지 못했습니다.</p></section>';
    var max = volume.bins.reduce(function (best, bin) { return number(bin.volume || bin.vol) > number(best.volume || best.vol) ? bin : best; }, volume.bins[0]);
    var poc = volume.poc || volume.pocPrice || max.price || ((number(max.low) + number(max.high)) / 2);
    return '<section class="my-analysis-card"><div class="my-card-title"><strong>매물대</strong><span>실제 체결가 기반</span></div>'
      + '<div class="my-volume-highlight"><span>거래가 가장 몰린 구간</span><strong>' + formatPrice(poc, volume.code || '') + '</strong></div>'
      + '<p class="my-analysis-footnote">현재가가 두꺼운 매물대 위에 있으면 지지, 아래에 있으면 저항으로 해석할 수 있습니다. 상세 차트에서 전체 구간을 확인하세요.</p></section>';
  }
  function summaryNotes(summary) {
    var result = {};
    (summary && summary.items || []).forEach(function (item) { result[item.key] = item; });
    return result;
  }
  function fetchAi(item, summary, volume, metrics) {
    if (/^US:/i.test(item.code)) return Promise.resolve('미국 종목은 현재 시세와 상세 분석 화면을 연결해 두었습니다. 미국 수급 전용 AI 분석은 다음 단계에서 연결합니다.');
    var notes = summaryNotes(summary);
    var params = new URLSearchParams();
    params.set('action', 'flowAiSummary');
    params.set('code', item.code);
    params.set('name', item.name);
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
    return fetchJson(GAS_URL + '?' + params.toString()).then(function (body) { return body && body.data && body.data.summary || body.summary || null; });
  }
  function fetchVolume(item) {
    if (/^US:/i.test(item.code)) return Promise.resolve(null);
    return fetchJson(VM_URL + '/pbar-tratio/' + encodeURIComponent(item.code) + '?days=20').then(function (body) {
      var data = body && body.data || body;
      if (data) data.code = item.code;
      return data;
    }).catch(function () { return null; });
  }
  function fetchSelected(item) {
    var id = ++state.requestId;
    var cached = state.analyses[item.code];
    var quotePromise = global.Watchlist.fetchQuotes([item.code]).then(function (quotes) { state.quotes[item.code] = quotes[item.code] || {}; return quotes[item.code] || {}; }).catch(function () { return state.quotes[item.code] || {}; });
    var flowPromise = loadScript(FOREIGN_FLOW_SCRIPT, 'foreign-flow').then(function (flowApi) { return flowApi.fetchFlow(item.code, item.name, 63); }).catch(function () { return null; });
    var summaryPromise = loadScript(FOREIGN_FLOW_SCRIPT, 'foreign-flow').then(function (flowApi) { return flowApi.fetchAnalysisSummary(item.code, item.name); }).catch(function () { return null; });
    var volumePromise = fetchVolume(item);
    Promise.all([quotePromise, flowPromise, summaryPromise, volumePromise]).then(function (results) {
      if (id !== state.requestId || !itemByCode(item.code)) return;
      var metrics = itemMetrics(item, results[0]);
      fetchAi(item, results[2], results[3], metrics).catch(function () { return null; }).then(function (ai) {
        if (id !== state.requestId) return;
        state.analyses[item.code] = { quote: results[0], flow: results[1], summary: results[2], volume: results[3], ai: ai };
        render();
      });
    });
    if (!cached) renderDetail(item, { loading: true, quote: state.quotes[item.code] || {} });
  }
  function renderDetail(item, analysis) {
    var detail = document.getElementById('myDashboardDetail');
    if (!detail) return;
    if (!item) { detail.innerHTML = '<div class="my-dashboard-empty"><strong>분석할 종목을 선택하세요.</strong><p>왼쪽 내 종목 목록에서 종목을 선택하면 수급·매물대·보유손익을 계산합니다.</p></div>'; return; }
    var quote = analysis && analysis.quote || state.quotes[item.code] || {};
    var metrics = itemMetrics(item, quote);
    if (analysis && analysis.loading) {
      detail.innerHTML = '<div class="my-detail-loading"><strong>' + escapeHtml(item.name) + '</strong><p>차트·수급·매물대 자료를 불러오는 중입니다...</p></div>' + buildHoldingForm(item, metrics);
      return;
    }
    var frameUrl = '/page/foreign-flow?code=' + encodeURIComponent(item.code) + '&name=' + encodeURIComponent(item.name);
    detail.innerHTML = '<div class="my-detail-head"><div><span class="my-dashboard-eyebrow">SELECTED STOCK</span><h3>' + escapeHtml(item.name) + ' <small>' + escapeHtml(item.code) + '</small></h3></div><div class="my-detail-actions"><a href="' + frameUrl + '" target="_blank" rel="noopener">상세 종목분석</a><a href="/page/stock-search?code=' + encodeURIComponent(item.code) + '" target="_blank" rel="noopener">호가·실시간</a></div></div>'
      + '<div class="my-metric-grid"><div><span>현재가</span><strong>' + formatPrice(metrics.price, item.code) + '</strong><small class="' + signClass(quote.changeRate) + '">' + formatSigned(quote.changeRate, 2) + '%</small></div><div><span>평가금액</span><strong>' + (metrics.value == null ? '-' : formatPrice(metrics.value, item.code)) + '</strong></div><div><span>평가손익</span><strong class="' + signClass(metrics.pnl) + '">' + (metrics.pnl == null ? '-' : formatSigned(metrics.pnl, 0) + '원') + '</strong><small>' + (metrics.rate == null ? '평단 입력 필요' : formatSigned(metrics.rate, 2) + '%') + '</small></div></div>'
      + buildHoldingForm(item, metrics)
      + '<div class="my-analysis-grid">' + buildFlowCard(analysis && analysis.flow) + buildVolumeCard(analysis && analysis.volume) + '</div>'
      + '<section class="my-analysis-card my-ai-card"><div class="my-card-title"><strong>AI 종합 분석</strong><span>Groq · 수급·기술·매물대</span></div><p>' + escapeHtml(analysis && analysis.ai || 'AI 분석 결과를 준비 중입니다.') + '</p></section>'
      + buildAveragingCalculator(metrics, item.code)
      + '<details class="my-detail-frame"><summary>기존 차트·매물대 도구를 이 화면에서 펼치기</summary><iframe title="' + escapeAttr(item.name) + ' 종목분석" loading="lazy" src="' + frameUrl + '"></iframe></details>';
    updateCalculator(detail, metrics);
  }
  function updateCalculator(root, metrics) {
    var priceInput = root.querySelector('[data-my-calc="price"]');
    var quantityInput = root.querySelector('[data-my-calc="quantity"]');
    var output = root.querySelector('[data-my-calc-result]');
    if (!priceInput || !quantityInput || !output) return;
    var addPrice = number(priceInput.value, 0);
    var addQuantity = number(quantityInput.value, 0);
    var totalQuantity = metrics.holding.quantity + addQuantity;
    if (!metrics.holding.quantity || !metrics.holding.averagePrice || !addPrice || !addQuantity || !totalQuantity) {
      output.textContent = '현재 수량·평단과 추가 매수가·수량을 입력하면 예상 평단가를 계산합니다.';
      return;
    }
    var nextAverage = (metrics.holding.quantity * metrics.holding.averagePrice + addQuantity * addPrice) / totalQuantity;
    output.innerHTML = '추가 후 예상 평단가 <strong>' + formatPrice(nextAverage) + '</strong> · 총 수량 ' + formatNumber(totalQuantity, 2) + '주';
  }
  function render() {
    if (!mount || !global.Watchlist) return;
    var items = global.Watchlist.getList();
    if (state.selectedCode && !items.some(function (item) { return item.code === state.selectedCode; })) state.selectedCode = null;
    if (!state.selectedCode && items.length) state.selectedCode = items[0].code;
    var status = document.getElementById('myDashboardStatus');
    if (status) status.textContent = global.Watchlist.isReady() ? 'Google 계정별 내 종목 분석' : 'Google 로그인 상태를 확인하는 중...';
    renderList(items);
    var item = itemByCode(state.selectedCode);
    var cached = item && state.analyses[item.code];
    renderDetail(item, cached || { loading: true, quote: item && state.quotes[item.code] || {} });
    if (item && !cached) fetchSelected(item);
  }
  function wire() {
    mount.addEventListener('click', function (event) {
      var select = event.target.closest('[data-my-select]');
      if (select) { state.selectedCode = select.getAttribute('data-my-select'); render(); return; }
      var save = event.target.closest('[data-my-save]');
      if (save) {
        var item = itemByCode(save.getAttribute('data-my-save'));
        var root = save.closest('.my-dashboard-detail');
        var result = global.Watchlist.updateHolding(item.code, {
          quantity: number(root.querySelector('[data-my-field="quantity"]').value),
          averagePrice: number(root.querySelector('[data-my-field="averagePrice"]').value)
        });
        save.textContent = result.ok ? '저장됨' : '저장 실패';
        setTimeout(function () { save.textContent = '저장'; }, 1500);
        if (result.ok) { delete state.analyses[item.code]; render(); }
      }
    });
    mount.addEventListener('input', function (event) {
      if (event.target.matches('[data-my-calc]')) {
        var item = itemByCode(state.selectedCode);
        if (item) updateCalculator(mount, itemMetrics(item, state.quotes[item.code] || {}));
      }
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
      var codes = global.Watchlist && global.Watchlist.getList().map(function (item) { return item.code; }) || [];
      if (!codes.length || !global.Watchlist) return;
      global.Watchlist.fetchQuotes(codes).then(function (quotes) { state.quotes = Object.assign(state.quotes, quotes || {}); renderList(global.Watchlist.getList()); var item = itemByCode(state.selectedCode); if (item && state.analyses[item.code]) renderDetail(item, state.analyses[item.code]); });
    }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
