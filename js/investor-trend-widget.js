/**
 * 메인 페이지 "투자자별 매매 동향" 위젯 - 작업지시서 #4(2026-07-20).
 * 홈(공지사항 #pinnedNotice 자리, "메인 중앙 상단 첫 번째 카드")을 대체 - 코스피 시장
 * 전체 개인/외국인/기관계 순매수(억원)를 일/주/월 탭으로 보여준다.
 *
 * 데이터: VM(goodbyestar.cloud/investor-trend?period=day|week|month)을 브라우저가 직접
 * 호출(인증 없음, CORS로 블로그 도메인만 허용) - js/sidebar-rank.js/kospi-futures.js의
 * /market-rank, /futures와 동일한 패턴.
 *
 * 지시서는 백엔드를 키움 TR(get_investor_summary/get_investor_trend, stk_cd 없이 호출하면
 * 시장 전체 값)로 가정했지만, 실측 결과 두 TR 모두 종목코드가 필수라 시장 전체 집계를
 * 지원하지 않는다(2026-07-20 확인) - VM은 대신 네이버(투자자별 매매동향)를 소스로 쓴다
 * (scripts/cloud-vm/investor_trend.py 참고, domestic_futures.py와 동일한 우회 사유).
 *
 * 홈("/")에서만 마운트 - 예전 #pinnedNotice와 동일하게 카테고리/글 페이지 등에서는 숨김.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/investor-trend';
  var CONTAINER_SELECTOR = '#investor-trend-widget';
  var REFRESH_MS = 60 * 1000;
  var RETRY_ATTEMPTS = 3;
  var RETRY_DELAY_MS = 2000;

  var PERIODS = [
    { key: 'day', label: '일' },
    { key: 'week', label: '주' },
    { key: 'month', label: '월' }
  ];
  var DEFAULT_PERIOD = 'week';

  var INVESTORS = [
    { key: 'ind', label: '개인' },
    { key: 'frgn', label: '외국인' },
    { key: 'orgn', label: '기관' }
  ];

  var state = { period: DEFAULT_PERIOD, timer: null };

  function init() {
    if (location.pathname !== '/' && location.pathname !== '') return;
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = shellHtml();
    container.addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('.itw-tab') : null;
      if (!tab) return;
      var period = tab.getAttribute('data-period');
      if (period === state.period) return;
      state.period = period;
      container.querySelectorAll('.itw-tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      load(container);
    });

    load(container);
    state.timer = setInterval(function () { load(container); }, REFRESH_MS);
  }

  function shellHtml() {
    var tabs = PERIODS.map(function (p) {
      return '<button type="button" class="itw-tab' + (p.key === DEFAULT_PERIOD ? ' active' : '')
        + '" data-period="' + p.key + '">' + p.label + '</button>';
    }).join('');
    return '<div class="card itw-card">'
      + '<div class="itw-header">'
      + '<span class="itw-title">투자자별 매매 동향</span>'
      + '<span class="itw-asof" id="itwAsOf"></span>'
      + '</div>'
      + '<div class="itw-subtext">외국인 순매수량은 장외거래를 포함한 거래량이에요</div>'
      + '<div class="itw-tabs" role="tablist">' + tabs + '</div>'
      + '<div class="itw-body" id="itwBody"><div class="itw-skeleton"></div></div>'
      + '</div>';
  }

  function load(container) {
    var body = container.querySelector('#itwBody');
    if (body && !body.querySelector('.itw-chart')) {
      body.innerHTML = '<div class="itw-skeleton"></div>';
    }
    fetchWithRetry(state.period, RETRY_ATTEMPTS)
      .then(function (result) {
        if (result.period !== state.period) return; // 응답 오는 사이 탭이 바뀌었으면 무시
        render(container, result);
      })
      .catch(function () {
        if (body) body.innerHTML = '<div class="itw-error">데이터를 불러오지 못했어요.</div>';
      });
  }

  function render(container, result) {
    var body = container.querySelector('#itwBody');
    var asOf = container.querySelector('#itwAsOf');
    if (asOf) asOf.textContent = fmtAsOf(result.asOf);
    if (!body) return;
    var rows = result.rows || [];
    if (!rows.length) {
      body.innerHTML = '<div class="itw-error">데이터를 불러오지 못했어요.</div>';
      return;
    }
    body.innerHTML = chartHtml(rows) + tableHtml(rows);
  }

  function chartHtml(rows) {
    var maxAbs = 1;
    rows.forEach(function (r) {
      maxAbs = Math.max(maxAbs, Math.abs(r.ind), Math.abs(r.frgn), Math.abs(r.orgn));
    });
    var groups = rows.map(function (r) {
      return '<div class="itw-group">'
        + barHtml(r.ind, maxAbs, 'ind')
        + barHtml(r.frgn, maxAbs, 'frgn')
        + barHtml(r.orgn, maxAbs, 'orgn')
        + '</div>';
    }).join('');
    return '<div class="itw-chart"><div class="itw-zeroline"></div><div class="itw-groups">' + groups + '</div></div>';
  }

  function barHtml(val, maxAbs, kind) {
    var pct = (Math.abs(val) / maxAbs * 50).toFixed(2);
    var neg = val < 0;
    var pos = neg ? 'top:50%;' : 'bottom:50%;';
    return '<div class="itw-bar itw-bar-' + kind + (neg ? ' itw-bar-neg' : '')
      + '" style="' + pos + 'height:' + pct + '%;"></div>';
  }

  function tableHtml(rows) {
    var head = '<tr><th></th>' + rows.map(function (r) {
      return '<th>' + escapeHtml(r.label) + '</th>';
    }).join('') + '</tr>';
    var body = INVESTORS.map(function (inv) {
      var cells = rows.map(function (r) {
        var v = r[inv.key];
        var neg = v < 0;
        return '<td class="itw-cell-' + inv.key + (neg ? ' itw-neg' : '') + '">' + fmtUnit(v) + '</td>';
      }).join('');
      return '<tr><td class="itw-legend"><span class="itw-dot itw-dot-' + inv.key + '"></span>' + inv.label + '</td>' + cells + '</tr>';
    }).join('');
    return '<div class="itw-table-wrap"><table class="itw-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  // 억원 단위 입력값을 'N.N조'(1만억 이상) 또는 'N,NNN억'으로 변환, 부호는 '-' 유지.
  function fmtUnit(v) {
    if (v == null || isNaN(v)) return '-';
    var sign = v < 0 ? '-' : '';
    var abs = Math.abs(v);
    if (abs >= 10000) return sign + (abs / 10000).toFixed(1) + '조';
    return sign + Math.round(abs).toLocaleString('ko-KR') + '억';
  }

  function fmtAsOf(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var kst = new Date(d.getTime() + 9 * 3600 * 1000);
    var mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(kst.getUTCDate()).padStart(2, '0');
    var hh = String(kst.getUTCHours()).padStart(2, '0');
    var mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return mm + '.' + dd + '. ' + hh + ':' + mi + ' 기준';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fetchOnce(period) {
    var url = API_URL + '?period=' + encodeURIComponent(period);
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, 15000) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('investor-trend API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return (json && json.data) || {};
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchWithRetry(period, attemptsLeft) {
    return InvestorTrendWidget.fetchOnce(period).catch(function (err) {
      if (attemptsLeft <= 1) throw err;
      return new Promise(function (resolve) {
        setTimeout(resolve, RETRY_DELAY_MS);
      }).then(function () { return fetchWithRetry(period, attemptsLeft - 1); });
    });
  }

  var InvestorTrendWidget = { init: init, fetchOnce: fetchOnce };
  global.InvestorTrendWidget = InvestorTrendWidget;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
