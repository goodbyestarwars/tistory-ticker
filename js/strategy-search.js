/**
 * 전략검색 위젯
 *
 * 카테고리(전략)를 탭으로 여러 개 보여주는 틀 - 지금은 "저평가 종목" 1개뿐이지만 계속
 * 추가될 예정이라 탭 구조를 유지한다(2026-08 사용자 피드백: "전략검색은 냅두고 10개를
 * 1개로 줄이는 거였지, 페이지 자체를 저평가 종목으로 박아버리라는 게 아니었다").
 * scripts/cloud-vm/strategy_scan.py가 내려주는 categories(카테고리id -> {name,
 * methodology, sectors}) 그대로 탭 목록을 만든다 - 서버 쪽 카테고리가 늘거나 줄어도 이
 * 파일을 고칠 필요가 없다(js/pattern-scan.js와 동일한 설계 원칙).
 *
 * "저평가 종목" 카테고리의 판정 기준(품질 게이트: 펀더멘탈 점수, 가격 게이트: 120일 이평
 * 대비 이격도)은 strategy_scan.py 참고. 결과는 WICS 대분류 섹터별로 묶여 오므로, 카테고리
 * 안에서는 js/sector-dashboard-v4.js·js/market-temp.js의 카드보기와 같은 시각 언어
 * (섹터 = 카드, 종목 = 행)로 보여준다(2026-08 UI 피드백 "증시온도 카드보기 그대로 가져다
 * 써"). 다른 모양의 결과를 내는 카테고리가 나중에 추가되면 renderCategoryBody를 그
 * 카테고리 타입에 맞게 분기해야 한다 - 지금은 섹터 그룹 하나뿐이라 분기 없음.
 *
 * 리스트는 VM(strategy_scan.py)이 하루 1회 미리 스캔해둔 결과(?strategyScan=1)를 그대로
 * 보여준다(가벼움) - js/pattern-scan.js와 동일한 패턴.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#strategy-search';
  var FETCH_TIMEOUT_MS = 15000;
  // 종목분석 상세 페이지 - js/stock-search-panel.js·js/watchlist.js와 동일한 이동 방식
  // (?code=&name=). 펀더멘탈(PER·PBR·DART 재무)·차트·수급을 바로 확인할 수 있어 "왜 이
  // 종목이 뽑혔는지" 근거를 확인하기 가장 가까운 기존 페이지다.
  var STOCK_DETAIL_PAGE = '/page/foreign-flow';

  var scanData = null;
  var activeKey = null;
  var activeEtfPeriod = '1m';
  var ETF_RETURN_PERIODS = [
    { key: '1m', label: '1개월' },
    { key: '3m', label: '3개월' },
    { key: '6m', label: '6개월' },
    { key: '12m', label: '12개월' }
  ];

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<div class="ss-hint">불러오는 중...</div>';
    loadScan(container);
  }

  function loadScan(container) {
    StrategySearch.fetchJson(GAS_TICKER_URL + '?strategyScan=1')
      .then(function (data) {
        scanData = normalizeScanData(data);
        var keys = Object.keys((data && data.categories) || {});
        if (!keys.length) {
          container.innerHTML = '<div class="ss-error">아직 스캔 결과가 없어요. (VM에서 strategy_scan.py가 한 번 실행돼야 함)</div>';
          return;
        }
        if (!activeKey || keys.indexOf(activeKey) === -1) activeKey = keys[0];
        container.innerHTML = buildShell();
        wireContainer(container);
        renderAll(container);
      })
      .catch(function () {
        container.innerHTML = '<div class="ss-error">스캔 결과를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // Older VM/GAS caches still contain four separate etf_1m/3m/6m/12m
  // categories. Merge them on the client so the UI remains correct until the
  // next strategy scan has written the new combined schema.
  function normalizeScanData(data) {
    data = data || {};
    data.categories = data.categories || {};
    var periods = ['1m', '3m', '6m', '12m'];
    if (data.categories.etfReturn) {
      periods.forEach(function (period) { delete data.categories['etf_' + period]; });
      return data;
    }

    var merged = {};
    periods.forEach(function (period) {
      var category = data.categories['etf_' + period];
      if (!category || !category.sectors) return;
      Object.keys(category.sectors).forEach(function (sector) {
        var group = category.sectors[sector] || {};
        (group.matches || []).forEach(function (row) {
          var key = row.code || row.name;
          if (!key) return;
          if (!merged[key]) {
            merged[key] = {};
            Object.keys(row).forEach(function (field) { merged[key][field] = row[field]; });
          }
          merged[key]['returnRate' + period + 'Pct'] = row.returnRatePct;
          merged[key]['return' + period.toUpperCase() + 'Label'] = period;
        });
      });
    });

    if (Object.keys(merged).length) {
      var rows = Object.keys(merged).map(function (key) { return merged[key]; });
      rows.sort(function (a, b) {
        var ar = a.returnRate1mPct == null ? -Infinity : Number(a.returnRate1mPct);
        var br = b.returnRate1mPct == null ? -Infinity : Number(b.returnRate1mPct);
        return br - ar;
      });
      data.categories.etfReturn = {
        name: 'ETF 수익률 상위',
        methodology: '1개월 누적수익률 기준 상위 ETF이며, 각 종목의 1개월·3개월·6개월·12개월 누적수익률을 함께 표시합니다.',
        sectors: { ETF: { name: 'ETF', matches: rows } }
      };
      periods.forEach(function (period) { delete data.categories['etf_' + period]; });
    }
    return data;
  }

  function buildShell() {
    return ''
      + '<div class="ss-head">'
      + '<div class="ss-tabs" id="ssTabs"></div>'
      + '<div class="ss-meta" id="ssMeta"></div>'
      + '</div>'
      + '<div class="ss-methodology" id="ssMethodology"></div>'
      + '<div id="ssCards"></div>';
  }

  function categoryKeys() {
    return Object.keys(scanData.categories);
  }

  function renderAll(container) {
    renderTabs(container);
    renderMeta(container);
    renderMethodology(container);
    renderCards(container);
  }

  function renderTabs(container) {
    var tabsEl = container.querySelector('#ssTabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = categoryKeys().map(function (key) {
      var c = scanData.categories[key];
      return '<button type="button" class="ss-tab' + (key === activeKey ? ' active' : '') + '" data-key="' + key + '">'
        + escapeHtml((c && c.name) || key) + '</button>';
    }).join('');
  }

  // 탭 전환 클릭과 종목 행 클릭(종목분석 이동)을 컨테이너 하나에 위임한다 - renderCards()가
  // 매번 innerHTML을 새로 그려도 이 리스너는 컨테이너 자체에 붙어있어 재등록할 필요가 없다.
  function wireContainer(container) {
    container.addEventListener('click', function (event) {
      var tabBtn = event.target.closest ? event.target.closest('.ss-tab') : null;
      if (tabBtn) {
        var key = tabBtn.getAttribute('data-key');
        if (key === activeKey) return;
        activeKey = key;
        renderAll(container);
        return;
      }
      var periodBtn = event.target.closest ? event.target.closest('.ss-return-period-tab') : null;
      if (periodBtn) {
        var period = periodBtn.getAttribute('data-return-period');
        if (!period || period === activeEtfPeriod) return;
        activeEtfPeriod = period;
        renderCards(container);
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
    if (!scanData || !scanData.scannedAt) {
      meta.textContent = '아직 스캔 결과가 없어요.';
      return;
    }
    var text = '스캔 ' + scanData.scannedAt + ' · 대상 ' + (scanData.scanned || 0) + '/' + (scanData.universe || 0) + '종목';
    if (scanData.skippedIlliquid) {
      text += ' · 유동성 부족 제외 ' + scanData.skippedIlliquid + '종목';
    }
    meta.textContent = text;
  }

  // 카테고리의 실제 판정 기준을 화면에 그대로 밝힌다(예: "저평가 종목"은 PER/PBR 없이
  // 근사한 값이라는 한계까지) - scripts/cloud-vm/strategy_scan.py가 이미 문장으로 채워
  // 보내주는 methodology를 그대로 옮기기만 한다(프론트에서 새로 요약·해석하지 않음).
  function renderMethodology(container) {
    var box = container.querySelector('#ssMethodology');
    if (!box) return;
    var cat = scanData.categories[activeKey];
    box.textContent = (cat && cat.methodology) || '';
  }

  function renderCards(container) {
    var wrap = container.querySelector('#ssCards');
    if (!wrap) return;
    var cat = scanData.categories[activeKey];
    var sectors = (cat && cat.sectors) || {};
    var sectorNames = Object.keys(sectors).filter(function (name) {
      return sectors[name] && sectors[name].matches && sectors[name].matches.length;
    });
    if (!sectorNames.length) {
      wrap.innerHTML = '<div class="ss-hint">지금은 이 카테고리 조건에 맞는 종목이 없어요.</div>';
      return;
    }
    var periodTabs = activeKey === 'etfReturn'
      ? '<div class="ss-return-period-tabs" role="tablist" aria-label="ETF 수익률 기간">'
        + ETF_RETURN_PERIODS.map(function (period) {
          return '<button type="button" class="ss-return-period-tab' + (period.key === activeEtfPeriod ? ' active' : '')
            + '" data-return-period="' + period.key + '" role="tab" aria-selected="' + (period.key === activeEtfPeriod ? 'true' : 'false') + '">'
            + period.label + '</button>';
        }).join('')
        + '</div>'
      : '';
    var html = sectorNames.map(function (name) {
      var matches = sortMatches(sectors[name].matches);
      var rows = matches.map(rowHtml).join('');
      return '<div class="ss-card">'
        + '<div class="ss-card-title">' + escapeHtml(name) + '</div>'
        + '<div class="ss-rows">' + rows + '</div>'
        + '</div>';
    }).join('');
    wrap.innerHTML = periodTabs + '<div class="ss-cards-grid">' + html + '</div>';
  }

  function sortMatches(matches) {
    if (activeKey !== 'etfReturn') return matches;
    var field = 'returnRate' + activeEtfPeriod + 'Pct';
    return matches.slice().sort(function (a, b) {
      var ar = a[field] == null ? -Infinity : Number(a[field]);
      var br = b[field] == null ? -Infinity : Number(b[field]);
      if (br !== ar) return br - ar;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });
  }

  function rowHtml(it) {
    var cc = chgClass(it.changeRate);
    var metric = it.strategy === 'etfReturn'
      ? '<span class="ss-etf-return-metric">'
        + '<span>1개월 <b>' + fmtPct(it.returnRate1mPct) + '</b></span>'
        + '<span>3개월 <b>' + fmtPct(it.returnRate3mPct) + '</b></span>'
        + '<span>6개월 <b>' + fmtPct(it.returnRate6mPct) + '</b></span>'
        + '<span>12개월 <b>' + fmtPct(it.returnRate12mPct) + '</b></span>'
        + '</span>'
      : it.strategy === 'dividend'
      ? '배당수익률 ' + fmtPct(it.dividendYieldPct) + ' · 배당성향 ' + fmtPct(it.payoutRatioPct)
        + ' · 연속배당 ' + (it.dividendStreak || 0) + '년 · 순이익 증가 ' + (it.profitGrowthStreak || 0) + '년'
      : it.gapRatePct != null
      ? '시초갭 ' + fmtPct(it.gapRatePct) + ' · 시가→종가 ' + fmtPct(it.intradayRatePct)
        + ' · 거래대금 ' + fmtMillion(it.turnoverMillion) + '백만원'
      : it.envelope
      ? '엔벨로프 하단 ' + fmtPct(it.envelope.closeDistancePct) + ' · ROE ' + fmtPct(it.roe)
      : '이격도 ' + fmtPct(it.disparity) + ' · ROE ' + fmtPct(it.roe);
    return '<div class="ss-row" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '" title="눌러서 종목분석 보기">'
      + '<div class="ss-row-top">'
      + '<span class="ss-row-name">' + escapeHtml(it.name) + '<span class="ss-row-code">(' + escapeHtml(it.code) + ')</span></span>'
      + '<span><span class="ss-row-price">' + fmt(it.price) + '</span>'
      + '<span class="ss-row-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
      + '</div>'
      + '<div class="ss-row-metric">' + metric + '</div>'
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
  function fmtPct(n) { return n == null ? '-' : n.toFixed(1) + '%'; }
  function fmtMillion(n) { return n == null ? '-' : Math.round(n).toLocaleString('ko-KR'); }

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
