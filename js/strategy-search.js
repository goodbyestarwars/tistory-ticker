/**
 * 전략검색 위젯
 * kisyaml 프리셋 전략(scripts/cloud-vm/strategies/*.kis.yaml, 현재 10개)이 찾아낸 종목을
 * 전략별 탭 -> 종목 리스트로 보여준다.
 *
 * 리스트는 VM(strategy_scan.py)이 하루 1회 미리 스캔해둔 결과(?strategyScan=1)를 그대로
 * 보여준다(가벼움) - js/pattern-scan.js와 동일한 패턴. 탭은 API가 내려주는 strategies
 * 객체 키를 그대로 쓰므로, 서버 쪽 프리셋이 늘거나 줄어도 이 파일을 고칠 필요가 없다.
 *
 * breakout_fail(카테고리 stop_loss, "돌파 실패")은 매수 신호가 아니라 "전고점을 다시
 * 하회했다"는 이탈 경보다(scripts/cloud-vm/strategy_scan.py 참고) - 이 카테고리만 배지를
 * 다르게(⚠ 이탈 경보) 표시한다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#strategy-search';
  var FETCH_TIMEOUT_MS = 15000;
  // 종목분석 상세 페이지 - js/stock-search-panel.js·js/watchlist.js와 동일한 이동 방식
  // (?code=&name=). 이 페이지가 펀더멘탈(PER·PBR·DART 재무)과 차트(캔들+이치모쿠)를
  // 함께 보여주므로, 전략검색이 찾아낸 종목을 눌렀을 때 근거를 확인할 수 있는 가장 가까운
  // 기존 페이지다.
  var STOCK_DETAIL_PAGE = '/page/foreign-flow';

  // README(KIS strategy_builder) "10개 프리셋 전략" 표의 카테고리 한글 라벨.
  var CATEGORY_LABELS = {
    trend: '추세추종', breakout: '돌파매매', reversion: '역추세', stop_loss: '손절', momentum: '모멘텀'
  };

  var scanData = null;
  var activeKey = null;

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<div class="ss-hint">불러오는 중...</div>';
    loadScan(container);
  }

  function loadScan(container) {
    StrategySearch.fetchJson(GAS_TICKER_URL + '?strategyScan=1')
      .then(function (data) {
        scanData = data;
        var keys = Object.keys((data && data.strategies) || {});
        if (!keys.length) {
          container.innerHTML = '<div class="ss-error">아직 스캔 결과가 없어요. (VM에서 strategy_scan.py가 한 번 실행돼야 함)</div>';
          return;
        }
        if (!activeKey || keys.indexOf(activeKey) === -1) activeKey = keys[0];
        container.innerHTML = buildShell();
        wireTabs(container);
        renderAll(container);
      })
      .catch(function () {
        container.innerHTML = '<div class="ss-error">스캔 결과를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function buildShell() {
    return ''
      + '<div class="ss-head">'
      + '<div class="ss-tabs" id="ssTabs"></div>'
      + '<div class="ss-meta" id="ssMeta"></div>'
      + '</div>'
      + '<div class="ss-tab-desc" id="ssDesc"></div>'
      + '<div class="ss-list" id="ssList"></div>';
  }

  function renderAll(container) {
    renderTabs(container);
    renderMeta(container);
    renderDesc(container);
    renderList(container);
  }

  function strategyKeys() {
    return Object.keys(scanData.strategies);
  }

  function renderTabs(container) {
    var tabsEl = container.querySelector('#ssTabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = strategyKeys().map(function (key) {
      var s = scanData.strategies[key];
      return '<button type="button" class="ss-tab' + (key === activeKey ? ' active' : '') + '" data-key="' + key + '">'
        + escapeHtml((s && s.name) || key) + '</button>';
    }).join('');
  }

  function wireTabs(container) {
    container.addEventListener('click', function (event) {
      var tabBtn = event.target.closest ? event.target.closest('.ss-tab') : null;
      if (tabBtn) {
        var key = tabBtn.getAttribute('data-key');
        if (key === activeKey) return;
        activeKey = key;
        renderAll(container);
        return;
      }
      var item = event.target.closest ? event.target.closest('.ss-item') : null;
      if (!item) return;
      var code = item.getAttribute('data-code');
      if (!code) return;
      var name = item.getAttribute('data-name') || code;
      global.location.href = STOCK_DETAIL_PAGE + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name);
    });
  }

  function renderMeta(container) {
    var meta = container.querySelector('#ssMeta');
    if (!meta) return;
    if (!scanData.scannedAt) {
      meta.textContent = '아직 스캔 결과가 없어요.';
      return;
    }
    var text = '스캔 ' + scanData.scannedAt + ' · 대상 ' + (scanData.scanned || 0) + '/' + (scanData.universe || 0) + '종목';
    // scripts/cloud-vm/strategy_scan.py의 유동성 하한(MIN_AVG_TURNOVER) 필터로 빠진 종목 수 -
    // 0이면 굳이 안 보여준다(구형 GAS 배포에선 이 필드 자체가 없을 수도 있어 존재 확인).
    if (scanData.skippedIlliquid) {
      text += ' · 유동성 부족 제외 ' + scanData.skippedIlliquid + '종목';
    }
    meta.textContent = text;
  }

  // 목록이 비어 있어도(조건 충족 종목이 없어도) 이 전략이 뭘 찾는 건지는 항상 보이게 한다
  // (js/pattern-scan.js의 renderTabDesc와 동일한 이유).
  function renderDesc(container) {
    var box = container.querySelector('#ssDesc');
    if (!box) return;
    var strat = scanData.strategies[activeKey];
    if (!strat) { box.innerHTML = ''; return; }
    var catLabel = CATEGORY_LABELS[strat.category] || strat.category || '';
    box.innerHTML = escapeHtml(strat.description || '')
      + (catLabel ? '<span class="ss-cat-chip">' + escapeHtml(catLabel) + '</span>' : '');
  }

  function renderList(container) {
    var list = container.querySelector('#ssList');
    if (!list) return;
    var strat = scanData.strategies[activeKey];
    var items = (strat && strat.matches) || [];
    if (!items.length) {
      list.innerHTML = '<div class="ss-hint">지금 이 전략 조건에 해당하는 종목이 없어요.</div>';
      return;
    }

    var isWatch = strat && strat.category === 'stop_loss';
    list.innerHTML = items.map(function (it) {
      var cc = chgClass(it.changeRate);
      return '<div class="ss-item" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '" title="눌러서 종목분석 보기">'
        + '<div class="ss-item-top">'
        + '<span class="ss-name">' + escapeHtml(it.name) + '<span class="ss-code">(' + escapeHtml(it.code) + ')</span></span>'
        + '</div>'
        + '<span class="ss-badge' + (isWatch ? ' ss-badge-warn' : '') + '">' + escapeHtml(badgeText(isWatch)) + '</span>'
        + '<span class="ss-quote"><span class="ss-price">' + fmt(it.price) + '</span>'
        + '<span class="ss-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
        + '</div>';
    }).join('');
  }

  // matched/total, confidence는 항상 entry 조건이 전부(AND) 충족된 종목만 결과에 담기므로
  // (scripts/cloud-vm/strategy_scan.py의 scan() 참고) 값이 사실상 항상 최댓값(=1/1, 100%)
  // 이다 - 종목마다 달라지는 실제 신호 강도가 아니라서 배지에 그 숫자를 그대로 보여주면
  // "왜 다 100%야?"처럼 오해를 준다. 그래서 숫자 대신 "조건에 맞았다"는 사실만 알려준다.
  function badgeText(isWatch) {
    return isWatch ? '⚠ 이탈 경보' : '조건 충족';
  }

  // ---- 유틸(js/pattern-scan.js와 동일) ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(url, hasAbort ? { signal: controller.signal } : {})
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

  function chgClass(rt) {
    if (rt == null) return 'ss-flat';
    var r = parseFloat(rt);
    return r > 0 ? 'ss-up' : (r < 0 ? 'ss-down' : 'ss-flat');
  }
  function chgSign(rt) {
    if (rt == null) return '';
    var r = parseFloat(rt);
    return (r > 0 ? '+' : '') + r.toFixed(2) + '%';
  }
  function fmt(n) { return n == null ? '-' : Math.round(n).toLocaleString('ko-KR'); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  global.StrategySearch = { init: init, fetchJson: fetchJson };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
