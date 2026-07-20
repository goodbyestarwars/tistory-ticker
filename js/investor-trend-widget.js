/**
 * 메인 페이지 "투자자별 매매 동향" 위젯 - 작업지시서 #4(2026-07-20) + UI개선 지시서(2026-07-21).
 * 홈(공지사항 #pinnedNotice 자리, "메인 중앙 상단 첫 번째 카드")을 대체 - 코스피/코스닥
 * 시장별 개인/외국인/기관계 순매수(억원)를 일/주/월 탭으로 보여준다.
 *
 * 데이터: VM(goodbyestar.cloud/investor-trend?period=day|week|month&market=kospi|kosdaq)을
 * 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만 허용) - js/sidebar-rank.js/
 * kospi-futures.js의 /market-rank, /futures와 동일한 패턴.
 *
 * 지시서는 백엔드를 키움 TR(get_investor_summary/get_investor_trend, stk_cd 없이 호출하면
 * 시장 전체 값)로 가정했지만, 실측 결과 두 TR 모두 종목코드가 필수라 시장 전체 집계를
 * 지원하지 않는다(2026-07-20 확인) - VM은 대신 KIS 시장별 투자자매매동향(일별)을 1차로 쓴다
 * (scripts/cloud-vm/investor_trend.py 참고). 코스피 선물은 KIS/키움/네이버 어디에도
 * 투자자매매동향 데이터 소스가 없어(2026-07-21 조사) 이 위젯 범위에서 제외 - 코스피/코스닥
 * 2개 시장만 지원한다.
 *
 * 개인/외국인/기관 3개 막대가 날짜당 조밀하게 겹쳐 보이던 문제를 해결하려고 투자자별로
 * 3행 분리된 레이아웃(dayRowsHtml)을 쓴다. UI개선 지시서(2026-07-21) 1차안은 일(日) 탭만
 * 이 레이아웃으로 바꾸고 주/월은 기존 그룹 막대+테이블을 유지하는 것이었으나, 사용자가
 * 배포 후 확인하고 "주/월도 일 스타일로" 요청해 전체 탭에 동일하게 적용함(2026-07-21 2차).
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
  var DEFAULT_PERIOD = 'day';

  var MARKETS = [
    { key: 'kospi', label: '코스피' },
    { key: 'kosdaq', label: '코스닥' }
  ];
  var DEFAULT_MARKET = 'kospi';

  var INVESTORS = [
    { key: 'ind', label: '개인' },
    { key: 'frgn', label: '외국인' },
    { key: 'orgn', label: '기관' }
  ];

  var state = { period: DEFAULT_PERIOD, market: DEFAULT_MARKET, timer: null };

  function init() {
    if (location.pathname !== '/' && location.pathname !== '') return;
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = shellHtml();
    container.addEventListener('click', function (e) {
      var periodTab = e.target.closest ? e.target.closest('.itw-tab') : null;
      if (periodTab) {
        var period = periodTab.getAttribute('data-period');
        if (period !== state.period) {
          state.period = period;
          container.querySelectorAll('.itw-tab').forEach(function (t) {
            t.classList.toggle('active', t === periodTab);
          });
          load(container);
        }
        return;
      }
      var marketTab = e.target.closest ? e.target.closest('.itw-market-tab') : null;
      if (marketTab) {
        var market = marketTab.getAttribute('data-market');
        if (market !== state.market) {
          state.market = market;
          container.querySelectorAll('.itw-market-tab').forEach(function (t) {
            t.classList.toggle('active', t === marketTab);
          });
          load(container);
        }
      }
    });

    load(container);
    state.timer = setInterval(function () { load(container); }, REFRESH_MS);
  }

  function shellHtml() {
    var periodTabs = PERIODS.map(function (p) {
      return '<button type="button" class="itw-tab' + (p.key === DEFAULT_PERIOD ? ' active' : '')
        + '" data-period="' + p.key + '">' + p.label + '</button>';
    }).join('');
    var marketTabs = MARKETS.map(function (m) {
      return '<button type="button" class="itw-market-tab' + (m.key === DEFAULT_MARKET ? ' active' : '')
        + '" data-market="' + m.key + '">' + m.label + '</button>';
    }).join('');
    return '<div class="card itw-card">'
      + '<div class="itw-header">'
      + '<span class="itw-title">투자자별 매매 동향</span>'
      + '<span class="itw-asof" id="itwAsOf"></span>'
      + '</div>'
      + '<div class="itw-subtext">외국인 순매수량은 장외거래를 포함한 거래량이에요</div>'
      + '<div class="itw-tabrow">'
      + '<div class="itw-tabs" role="tablist">' + periodTabs + '</div>'
      + '<div class="itw-market-tabs" role="tablist">' + marketTabs + '</div>'
      + '</div>'
      + '<div class="itw-body" id="itwBody"><div class="itw-skeleton"></div></div>'
      + '</div>';
  }

  function load(container) {
    var body = container.querySelector('#itwBody');
    if (body && !body.querySelector('.itw-day-chart')) {
      body.innerHTML = '<div class="itw-skeleton"></div>';
    }
    var period = state.period;
    var market = state.market;
    fetchWithRetry(period, market, RETRY_ATTEMPTS)
      .then(function (result) {
        // 응답 오는 사이 탭이 바뀌었으면 무시
        if (state.period !== period || state.market !== market) return;
        render(container, result);
      })
      .catch(function () {
        if (state.period !== period || state.market !== market) return;
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
    body.innerHTML = dayRowsHtml(rows);
  }

  // ---- 투자자별 3행 분리 레이아웃 - 일/주/월 전체 탭 공용(2026-07-21) ----

  function dayRowsHtml(rows) {
    return '<div class="itw-day-chart">'
      + INVESTORS.map(function (inv) { return dayRowHtml(rows, inv); }).join('')
      + '</div>';
  }

  function dayRowHtml(rows, inv) {
    var maxAbs = 1; // 행별 독립 스케일(지시서 3-4) - 다른 투자자 행과 최대값을 공유하지 않음
    var sum = 0;
    rows.forEach(function (r) {
      maxAbs = Math.max(maxAbs, Math.abs(r[inv.key]));
      sum += r[inv.key];
    });
    var sumUp = sum >= 0;
    var cols = rows.map(function (r) {
      var v = r[inv.key];
      var neg = v < 0;
      var pct = (Math.abs(v) / maxAbs * 50).toFixed(2);
      var pos = neg ? 'top:50%;' : 'bottom:50%;';
      var title = escapeHtml(r.label) + ' ' + fmtUnit(v);
      return '<div class="itw-day-col">'
        + '<div class="itw-day-bar-track">'
        + '<div class="itw-day-zeroline"></div>'
        + '<div class="itw-day-bar itw-day-bar-' + inv.key + (neg ? ' itw-day-bar-neg' : '')
        + '" style="' + pos + 'height:' + pct + '%;" title="' + title + '"></div>'
        + '</div>'
        + '<span class="itw-day-col-date">' + escapeHtml(r.label) + '</span>'
        + '<span class="itw-day-col-value' + (neg ? ' itw-neg' : '') + '">' + fmtUnit(v) + '</span>'
        + '</div>';
    }).join('');
    return '<div class="itw-day-row">'
      + '<div class="itw-day-row-header">'
      + '<span class="itw-dot itw-day-dot-' + inv.key + '"></span>'
      + '<span class="itw-day-row-label">' + inv.label + '</span>'
      + '<span class="itw-day-row-sum ' + (sumUp ? 'itw-day-row-sum-up' : 'itw-day-row-sum-down') + '">'
      + (sumUp ? '▲ ' : '▼ ') + fmtUnit(Math.abs(sum)) + '</span>'
      + '</div>'
      + '<div class="itw-day-row-chart">'
      + '<div class="itw-day-cols">' + cols + '</div>'
      + '</div>'
      + '</div>';
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

  function fetchOnce(period, market) {
    var url = API_URL + '?period=' + encodeURIComponent(period) + '&market=' + encodeURIComponent(market || DEFAULT_MARKET);
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

  function fetchWithRetry(period, market, attemptsLeft) {
    return InvestorTrendWidget.fetchOnce(period, market).catch(function (err) {
      if (attemptsLeft <= 1) throw err;
      return new Promise(function (resolve) {
        setTimeout(resolve, RETRY_DELAY_MS);
      }).then(function () { return fetchWithRetry(period, market, attemptsLeft - 1); });
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
