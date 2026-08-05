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
 * 하회했다"는 이탈 경보다(scripts/cloud-vm/strategy_scan.py 참고) - 이 카테고리만 행을
 * 다르게(⚠ 접두사 + 경고색 강조) 표시한다.
 *
 * 리스트 시각 스타일은 js/sector-dashboard-v4.js의 카드(제목 앞 파란 바)/행(종목명·가격·
 * 등락률) 구성을 그대로 옮겨왔다(2026-08 UI 피드백) - 다만 두 페이지가 서로 다른 Tistory
 * Page라 CSS를 공유하지 않으므로, 클래스는 여기서 ss- 접두사로 새로 정의한다(같은 이름
 * 재사용 아님). 시장 구분(KOSPI=P/KOSDAQ=Q) 뱃지는 sector-dashboard-v4.js가 쓰는
 * data/sectors-v3.js(curated ~238종목, market 필드 있음)와 달리 이 위젯의 대상은 전종목
 * (data/krx_map.js, market 필드 없음)이라 데이터가 없어 넣지 않았다.
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
      + '<div id="ssList"></div>'
      // .kis.yaml 포맷 출처 - kisyaml_strategy.py 모듈 독스트링 참고("포맷 출처: 한국투자증권
      // open-trading-api strategy_builder README"). 실제 진입/청산 조건과 임계값은 골든크로스
      // 1개(원본 README 예시, author: KIS)를 뺀 나머지 9개를 9Pay가 그 포맷 위에서 직접
      // 구성한 것이라 "10개 전략 자체가 한투증권 제공"이라고 쓰면 부정확하다 - 포맷 출처만
      // 정확히 밝힌다.
      + '<div class="ss-footnote">'
      + '전략 조건은 한국투자증권(KIS) open-trading-api strategy_builder의 .kis.yaml 포맷을 기반으로 구성했습니다. '
      + '(골든크로스는 원본 README 예시, 나머지 9개는 그 포맷 위에서 9Pay가 직접 구성)'
      + '</div>';
  }

  function renderAll(container) {
    renderTabs(container);
    renderMeta(container);
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
      var row = event.target.closest ? event.target.closest('.ss-row') : null;
      if (!row) return;
      var code = row.getAttribute('data-code');
      if (!code) return;
      var name = row.getAttribute('data-name') || code;
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

  // 카드 제목·설명은 목록이 비어 있어도(조건 충족 종목이 없어도) 항상 보이게 한다 - 이
  // 전략이 뭘 찾는 건지는 알 수 있어야 하니까(js/pattern-scan.js의 renderTabDesc와 동일 이유).
  function renderList(container) {
    var list = container.querySelector('#ssList');
    if (!list) return;
    var strat = scanData.strategies[activeKey];
    if (!strat) { list.innerHTML = ''; return; }

    var catLabel = CATEGORY_LABELS[strat.category] || strat.category || '';
    var isWatch = strat.category === 'stop_loss';
    var items = strat.matches || [];

    var head = '<div class="ss-card-title">' + escapeHtml(strat.name || activeKey)
      + (catLabel ? '<span class="ss-cat-chip">' + escapeHtml(catLabel) + '</span>' : '')
      + '</div>'
      + '<div class="ss-card-desc">' + escapeHtml(strat.description || '') + '</div>';

    var body = items.length
      ? '<div class="ss-rows">' + items.map(function (it) { return rowHtml(it, isWatch); }).join('') + '</div>'
      : '<div class="ss-hint">지금 이 전략 조건에 해당하는 종목이 없어요.</div>';

    list.innerHTML = '<div class="ss-card">' + head + body + '</div>';
  }

  function rowHtml(it, isWatch) {
    var cc = chgClass(it.changeRate);
    return '<div class="ss-row' + (isWatch ? ' ss-row-warn' : '') + '" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '" title="눌러서 종목분석 보기">'
      + '<span class="ss-row-name">' + (isWatch ? '⚠ ' : '') + escapeHtml(it.name) + '<span class="ss-row-code">(' + escapeHtml(it.code) + ')</span></span>'
      + '<span><span class="ss-row-price">' + fmt(it.price) + '</span>'
      + '<span class="ss-row-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
      + '</div>';
  }

  // ---- 유틸(js/pattern-scan.js와 동일, 등락 표시는 js/sector-dashboard-v4.js와 동일 형식) ----

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
    var arrow = r > 0 ? '▲' : (r < 0 ? '▼' : '');
    return arrow + Math.abs(r).toFixed(2) + '%';
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
