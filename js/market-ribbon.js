/**
 * 상단 지수/환율/코인 리본 - 사용자 선택형(+) 버전
 *
 * 2026-07-15: "코스피/코스닥/원달러/BTC 고정 노출"을 폐기하고, 방문자가 +버튼으로
 * 원하는 항목만 골라서 보는 방식으로 전환(요청서 반영). 기본값은 빈 목록 - 아무것도
 * 강제로 보여주지 않는다.
 *
 * 이 파일이 만드는 `.market-ribbon` 바(고정 32px, top:0)는 style.css 전역에 걸쳐
 * top offset이 하드코딩돼 있어(.navbar top:32px, .disc-ticker top:88px, .page-wrap
 * padding-top:88px, 사이드바 top:108px 등) 바를 통째로 없애거나 높이를 바꾸면 사이트
 * 전체 레이아웃이 밀리거나 빈 공백이 생긴다. 그래서 바 자체(위치·높이)는 그대로 두고
 * "내용"만 고정 4종 -> 사용자 선택 목록으로 바꿨다. 물리적으로 공시 티커 "아래"로
 * 옮기려면 저 좌표들을 전부 다시 맞추고 skin.html 실사 검증까지 필요해 이번엔 보류.
 *
 * 데이터 소스 2곳을 그대로 재사용:
 * - 코스피/코스닥/원달러/BTC: 기존 GAS ?market=1
 * - 코스피200 야간선물/나스닥100/S&P500/필라델피아(SOX)/VIX/WTI원유: js/overnight-market.js와
 *   동일한 VM(https://ghlee.duckdns.org/futures) - 이 파일은 스킨 전역에서 로드되고
 *   overnight-market.js는 "간밤 시황" 페이지 전용 임베드라 항상 같이 로드된다는 보장이
 *   없어서, VM 호출 자체는 독립적으로 다시 구현(로직은 단순 fetch라 중복 부담 적음).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FUTURES_API = 'https://ghlee.duckdns.org/futures';
  var CONTAINER_SELECTOR = '#market-ribbon';
  var STORAGE_KEY = 'qi_selected_v1';
  var REFRESH_MS = 60 * 1000;
  var FETCH_TIMEOUT_MS = 8000;

  // key -> { label, source: 'market'|'futures', sourceKey }
  // source='market'  -> GAS ?market=1 응답의 sourceKey 필드
  // source='futures'  -> VM /futures 응답 배열에서 symbol===sourceKey 인 항목
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

  var refreshTimer = null;

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  // ---- localStorage ----

  function loadSelected() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (k) { return OPTION_BY_KEY.hasOwnProperty(k); });
    } catch (err) {
      return [];
    }
  }

  function saveSelected(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (err) {
      // 프라이빗 모드 등 localStorage 불가 - 이번 세션 메모리 상태만 유지
    }
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
      .then(function (r) {
        if (!r.ok) throw new Error('응답 오류: ' + r.status);
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

  function fetchMarket() {
    return fetchJson(GAS_TICKER_URL + '?market=1');
  }

  function fetchFutures() {
    return fetchJson(FUTURES_API).then(function (json) { return json.data || []; });
  }

  // 선택 목록에 필요한 소스만 조회 -> { key: {price, change, changeRate} } 로 병합
  function fetchSelectedData(selected) {
    var needMarket = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'market'; });
    var needFutures = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'futures'; });

    return Promise.all([
      needMarket ? MarketRibbon.fetchMarket().catch(function () { return null; }) : Promise.resolve(null),
      needFutures ? MarketRibbon.fetchFutures().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (results) {
      var marketData = results[0] || {};
      var futuresList = results[1] || [];
      var futuresBySymbol = {};
      futuresList.forEach(function (it) { futuresBySymbol[it.symbol] = it; });

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

  function buildShell() {
    return ''
      + '<div class="ribbon-chips" id="ribbonChips"></div>'
      + '<button type="button" class="ribbon-add-btn" id="ribbonAddBtn" aria-label="지수 추가">+ 지수 추가</button>'
      + '<div class="ribbon-popover" id="ribbonPopover" hidden></div>';
  }

  function renderChips(container, selected, dataByKey) {
    var chipsEl = container.querySelector('#ribbonChips');
    if (!chipsEl) return;

    if (!selected.length) {
      chipsEl.innerHTML = '<span class="ribbon-empty-hint">우측 +버튼으로 코스피·코스닥·환율·BTC·해외선물 등을 골라보세요</span>';
      return;
    }

    chipsEl.innerHTML = selected.map(function (key) {
      var opt = OPTION_BY_KEY[key];
      var d = dataByKey[key];
      if (!opt) return '';
      if (!d) {
        return '<span class="ribbon-item"><span class="ribbon-label">' + opt.label + '</span><span class="ribbon-price">-</span></span>';
      }
      return (
        '<span class="ribbon-item">' +
          '<span class="ribbon-label">' + opt.label + '</span>' +
          '<span class="ribbon-price">' + formatNumber(d.price) + '</span>' +
          '<span class="ribbon-rate ' + directionClass(d.change) + '">' +
            arrowSymbol(d.change) + Math.abs(d.changeRate).toFixed(2) + '%</span>' +
        '</span>'
      );
    }).join('');
  }

  function renderPopover(container, selected) {
    var pop = container.querySelector('#ribbonPopover');
    if (!pop) return;
    pop.innerHTML = OPTIONS.map(function (opt) {
      var checked = selected.indexOf(opt.key) > -1;
      return '<label class="ribbon-pop-item">'
        + '<input type="checkbox" data-key="' + opt.key + '"' + (checked ? ' checked' : '') + ' />'
        + '<span>' + opt.label + '</span>'
        + '</label>';
    }).join('');
  }

  function wireEvents(container) {
    var addBtn = container.querySelector('#ribbonAddBtn');
    var pop = container.querySelector('#ribbonPopover');

    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = pop.hidden;
      if (willOpen) renderPopover(container, loadSelected());
      pop.hidden = !willOpen;
    });

    pop.addEventListener('click', function (e) {
      var input = e.target.closest ? e.target.closest('input[type="checkbox"]') : null;
      if (!input) return;
      var key = input.getAttribute('data-key');
      var list = toggleSelected(key);
      tick(container, list);
    });

    document.addEventListener('click', function (e) {
      if (!pop.hidden && !container.contains(e.target)) pop.hidden = true;
    });
  }

  function tick(container, selected) {
    selected = selected || loadSelected();
    if (!selected.length) {
      renderChips(container, selected, {});
      return;
    }
    fetchSelectedData(selected)
      .then(function (dataByKey) { renderChips(container, selected, dataByKey); })
      .catch(function (err) { logError('[market-ribbon] 조회 실패', err); });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    wireEvents(container);
    tick(container);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.hidden) return; // 백그라운드 탭에서는 불필요한 폴링 skip
      tick(container);
    }, REFRESH_MS);
  }

  var MarketRibbon = {
    init: init,
    fetchMarket: fetchMarket,
    fetchFutures: fetchFutures
  };
  global.MarketRibbon = MarketRibbon;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
