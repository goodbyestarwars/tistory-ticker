/**
 * 관심 지수 카드 (공시 티커 바로 아래, 공지사항 카드 위쪽)
 *
 * js/market-ribbon.js에 있던 "코스피/코스닥/원달러/BTC + 해외선물 6종을 사용자가 골라
 * 보는" 기능을 이 위치로 옮겼다(2026-07-16 피드백: 상단 얇은 바의 팝오버 방식 대신
 * js/overnight-market.js(간밤 시황)처럼 카드로, 다만 그보다 작게).
 *
 * 마운트 위치: #discTicker(공시 티커)는 skin.html에서 position:fixed라 그 DOM 형제로
 * 끼워 넣어도 실제 스크롤되는 본문 흐름엔 들어가지 않는다. 대신 skin.html의 글 목록 루프
 * (<s_notice_rep>/<s_article_rep>, 티스토리 서버 치환 태그라 git으로 옮길 수 없음)가 항상
 * 렌더링하는 리터럴 클래스 `.post-card`(공지 카드는 `.post-card.notice-card`, 일반 글도
 * `.post-card`)를 앵커로 써서, 그 목록의 실제 부모 컨테이너 바로 안쪽 맨 위에 형제로
 * 끼워 넣는다 - 래퍼 div의 class/id를 몰라도 항상 "글 목록 바로 위"에 정확히 꽂힌다.
 *
 * 데이터 소스 2곳(기존 market-ribbon.js와 동일):
 * - 코스피/코스닥/원달러/BTC: GAS ?market=1
 * - 코스피200 야간선물/나스닥100/S&P500/필라델피아(SOX)/VIX/WTI: VM(https://ghlee.duckdns.org/futures)
 *   (js/overnight-market.js와 같은 소스 - "간밤 시황" 페이지 전용 임베드라 항상 같이 로드된다는
 *   보장이 없어서 이 파일도 독립적으로 다시 fetch한다)
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FUTURES_API = 'https://ghlee.duckdns.org/futures';
  var CONTAINER_ID = 'quick-indices';
  var ANCHOR_SELECTOR = '.post-card'; // 이 요소(글 목록 첫 카드) 바로 앞에 컨테이너를 끼워 넣는다
  var STORAGE_KEY = 'qi_selected_v1';
  var REFRESH_MS = 60 * 1000;
  var FETCH_TIMEOUT_MS = 8000;

  var OPTIONS = [
    { key: 'kospi', label: '코스피', source: 'market', sourceKey: 'kospi' },
    { key: 'kosdaq', label: '코스닥', source: 'market', sourceKey: 'kosdaq' },
    { key: 'usdkrw', label: '원/달러', source: 'market', sourceKey: 'usdkrw' },
    { key: 'btc', label: 'BTC', source: 'market', sourceKey: 'btc' },
    { key: 'kospi_night', label: '코스피 야간선물', source: 'futures', sourceKey: 'KOSPI200_NIGHT' },
    { key: 'nasdaq', label: '나스닥', source: 'futures', sourceKey: 'NASDAQ100' },
    { key: 'sp500', label: 'S&P500', source: 'futures', sourceKey: 'SP500' },
    { key: 'sox', label: '필라델피아', source: 'futures', sourceKey: 'SOX' },
    { key: 'wti', label: '원유', source: 'futures', sourceKey: 'WTI' },
    { key: 'vix', label: 'VIX', source: 'futures', sourceKey: 'VIX' }
  ];
  var OPTION_BY_KEY = {};
  OPTIONS.forEach(function (o) { OPTION_BY_KEY[o.key] = o; });
  var DEFAULT_SELECTED = ['kospi', 'kosdaq', 'usdkrw', 'btc'];

  var refreshTimer = null;

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  // ---- localStorage ----

  function loadSelected() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return DEFAULT_SELECTED.slice();
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return DEFAULT_SELECTED.slice();
      return list.filter(function (k) { return OPTION_BY_KEY.hasOwnProperty(k); });
    } catch (err) {
      return DEFAULT_SELECTED.slice();
    }
  }

  function saveSelected(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (err) { /* 프라이빗 모드 등 무시 */ }
  }

  function toggleSelected(key) {
    var list = loadSelected();
    var idx = list.indexOf(key);
    if (idx > -1) list.splice(idx, 1);
    else list.push(key);
    saveSelected(list);
    return list;
  }

  // ---- 데이터 조회 ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error('응답 오류: ' + r.status); return r.json(); })
      .then(function (data) { if (timer) clearTimeout(timer); return data; })
      .catch(function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  function fetchMarket() { return fetchJson(GAS_TICKER_URL + '?market=1'); }
  function fetchFutures() { return fetchJson(FUTURES_API).then(function (json) { return json.data || []; }); }

  function fetchSelectedData(selected) {
    var needMarket = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'market'; });
    var needFutures = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'futures'; });

    return Promise.all([
      needMarket ? QuickIndices.fetchMarket().catch(function () { return null; }) : Promise.resolve(null),
      needFutures ? QuickIndices.fetchFutures().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (results) {
      var marketData = results[0] || {};
      var futuresBySymbol = {};
      (results[1] || []).forEach(function (it) { futuresBySymbol[it.symbol] = it; });

      var out = {};
      selected.forEach(function (key) {
        var opt = OPTION_BY_KEY[key];
        if (opt.source === 'market') {
          var m = marketData[opt.sourceKey];
          if (m) out[key] = { price: m.price, change: m.change, changeRate: m.changeRate };
        } else {
          var f = futuresBySymbol[opt.sourceKey];
          if (f && typeof f.price === 'number') out[key] = { price: f.price, change: f.change, changeRate: f.change_rate };
        }
      });
      return out;
    });
  }

  // ---- 렌더링 ----

  function toneClass(change) {
    if (change > 0) return 'qi-pos';
    if (change < 0) return 'qi-neg';
    return 'qi-zero';
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

  function ensureContainer() {
    var existing = document.getElementById(CONTAINER_ID);
    if (existing) return existing;

    var el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.className = 'qi-wrap';

    var anchor = document.querySelector(ANCHOR_SELECTOR);
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(el, anchor);
    } else {
      // 글이 하나도 없는 카테고리 등 - 못 찾으면 본문 맨 위에라도 붙여서 기능은 살린다
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function buildCard(opt, data) {
    if (!data) {
      return '<div class="qi-card" data-key="' + opt.key + '"><div class="qi-card-label">' + opt.label + '</div><div class="qi-card-price">-</div></div>';
    }
    return '<div class="qi-card" data-key="' + opt.key + '">'
      + '<div class="qi-card-label">' + opt.label + '</div>'
      + '<div class="qi-card-price ' + toneClass(data.change) + '">' + formatNumber(data.price) + '</div>'
      + '<div class="qi-card-change ' + toneClass(data.change) + '">' + arrowSymbol(data.change) + Math.abs(data.changeRate).toFixed(2) + '%</div>'
      + '</div>';
  }

  function renderShell(container) {
    container.innerHTML = ''
      + '<div class="qi-grid" id="qiGrid"></div>'
      + '<div class="qi-popover" id="qiPopover"></div>';
  }

  function renderCards(container, selected, dataByKey) {
    var grid = container.querySelector('#qiGrid');
    if (!grid) return;
    var cardsHtml = selected.map(function (key) {
      var opt = OPTION_BY_KEY[key];
      return opt ? buildCard(opt, dataByKey[key]) : '';
    }).join('');
    grid.innerHTML = cardsHtml + '<button type="button" class="qi-add-card" id="qiAddBtn">+ 지수 추가</button>';

    var addBtn = grid.querySelector('#qiAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePopover(container);
      });
    }
  }

  function renderPopover(container, selected) {
    var pop = container.querySelector('#qiPopover');
    if (!pop) return;
    pop.innerHTML = OPTIONS.map(function (opt) {
      var checked = selected.indexOf(opt.key) > -1;
      return '<label class="qi-pop-item">'
        + '<input type="checkbox" data-key="' + opt.key + '"' + (checked ? ' checked' : '') + ' />'
        + '<span>' + opt.label + '</span>'
        + '</label>';
    }).join('');
  }

  function togglePopover(container) {
    var pop = container.querySelector('#qiPopover');
    if (!pop) return;
    var willOpen = !pop.classList.contains('open');
    if (willOpen) renderPopover(container, loadSelected());
    pop.classList.toggle('open', willOpen);
  }

  function closePopover(container) {
    var pop = container.querySelector('#qiPopover');
    if (pop) pop.classList.remove('open');
  }

  function wireEvents(container) {
    container.addEventListener('click', function (e) {
      var input = e.target.closest ? e.target.closest('input[type="checkbox"]') : null;
      if (!input) return;
      var key = input.getAttribute('data-key');
      var list = toggleSelected(key);
      tick(container, list);
    });

    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) closePopover(container);
    });
  }

  function tick(container, selected) {
    selected = selected || loadSelected();
    renderCards(container, selected, {});
    if (!selected.length) return;
    fetchSelectedData(selected)
      .then(function (dataByKey) { renderCards(container, selected, dataByKey); })
      .catch(function (err) { logError('[quick-indices] 조회 실패', err); });
  }

  function init() {
    var container = ensureContainer();
    renderShell(container);
    wireEvents(container);
    tick(container);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.hidden) return;
      tick(container);
    }, REFRESH_MS);
  }

  var QuickIndices = { init: init, fetchMarket: fetchMarket, fetchFutures: fetchFutures };
  global.QuickIndices = QuickIndices;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
