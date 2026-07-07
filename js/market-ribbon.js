/**
 * 상단 지수/환율/코인 리본 (2단계)
 * 코스피·코스닥·원달러환율·BTC를 GAS 프록시(?market=1)로 한 번에 조회해 상단 바에 표시.
 * GAS 쪽 CacheService TTL(장중 60초/장외 1800초)과 맞춰 폴링한다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#market-ribbon';
  var REFRESH_MS = 60 * 1000;
  var FETCH_TIMEOUT_MS = 5000;

  var ITEMS = [
    { key: 'kospi', label: '코스피' },
    { key: 'kosdaq', label: '코스닥' },
    { key: 'usdkrw', label: '원/달러' },
    { key: 'btc', label: 'BTC' }
  ];

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  function fetchRibbon() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(GAS_TICKER_URL + '?market=1', hasAbort ? { signal: controller.signal } : {})
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

  function directionClass(change) {
    if (change > 0) return 'ribbon-up';
    if (change < 0) return 'ribbon-down';
    return 'ribbon-flat';
  }

  function arrowSymbol(change) {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '';
  }

  function formatNumber(n) {
    var num = Number(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString('ko-KR', { maximumFractionDigits: num >= 1000 ? 0 : 2 });
  }

  function render(container, data) {
    var html = ITEMS.map(function (item) {
      var d = data && data[item.key];
      if (!d) return '';
      return (
        '<span class="ribbon-item">' +
          '<span class="ribbon-label">' + item.label + '</span>' +
          '<span class="ribbon-price">' + formatNumber(d.price) + '</span>' +
          '<span class="ribbon-rate ' + directionClass(d.change) + '">' +
            arrowSymbol(d.change) + Math.abs(d.changeRate).toFixed(2) + '%</span>' +
        '</span>'
      );
    }).join('');

    container.innerHTML = html;
    container.style.display = html ? '' : 'none';
  }

  function tick(container) {
    MarketRibbon.fetchRibbon()
      .then(function (data) { render(container, data); })
      .catch(function (err) { logError('[market-ribbon] 조회 실패', err); });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    tick(container);
    setInterval(function () {
      if (document.hidden) return; // 백그라운드 탭에서는 불필요한 폴링 skip
      tick(container);
    }, REFRESH_MS);
  }

  var MarketRibbon = {
    init: init,
    fetchRibbon: fetchRibbon
  };
  global.MarketRibbon = MarketRibbon;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
