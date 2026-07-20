/**
 * 우측 사이드바 - 실시간 시장데이터 TOP 리스트(거래대금/상한가/하한가).
 * 작업지시서(9bolt 사이드바 리디자인, 2026-07-20) Phase 1 범위 - 배당주 TOP은 배당수익률
 * 데이터 소스 자체가 코드베이스에 없어(DART 배당공시 미연동) Phase 2로 미룸(사용자 확인).
 *
 * 데이터: VM(goodbyestar.cloud/market-rank, 키움 REST 랭킹 TR ka10032/ka10017)을 브라우저가
 * 직접 호출(인증 없음, CORS로 블로그 도메인만 허용 - js/kospi-futures.js의 /futures, /option-flow
 * 와 동일 패턴). 30초 주기로 갱신(지시서 4.2 "거래대금 TOP 30초~1분"에 맞춤, 상한가/하한가
 * 요구사항인 "1분"보다 촘촘하지만 세 섹션을 한 번의 호출로 같이 받아오는 게 더 단순함).
 *
 * 색상: 지시서 원문은 #E24B4A(상승)/#378ADD(하락)를 지정했지만, 사이트 전체가 이미
 * #d24f45(상승)/#1261c4(하락)로 통일돼 있어(CLAUDE.md) 그 값 대신 기존 사이트 색을 그대로
 * 썼다 - 다른 페이지들과 색이 어긋나면 안 되므로. 상한가/하한가 뱃지도 지시서가 지정한
 * CSS 변수(--bg-accent 등)가 이 코드베이스에 없어서, 기존 배지 팔레트(ff-badge-buy/sell과
 * 동일 톤)를 재사용했다.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/market-rank';
  var CONTAINER_SELECTOR = '#sidebar-rank';
  var REFRESH_MS = 30 * 1000;
  var STOCK_ANALYSIS_URL = 'https://ghlee.tistory.com/page/foreign-flow';

  var SECTIONS = [
    {
      key: 'tradeAmount', title: '거래대금 TOP', iconCls: 'si-blue', showAmount: true,
      more: 'https://finance.naver.com/sise/sise_quant.naver',
      emptyText: '거래대금 데이터가 없어요.', errorText: '거래대금 데이터를 불러오지 못했어요.'
    },
    {
      key: 'upperLimit', title: '상한가', iconCls: 'si-amber', showAmount: false,
      more: 'https://finance.naver.com/sise/sise_upper.naver',
      emptyText: '오늘 상한가 종목이 없어요.', errorText: '상한가 데이터를 불러오지 못했어요.'
    },
    {
      key: 'lowerLimit', title: '하한가', iconCls: 'si-purple', showAmount: false,
      more: 'https://finance.naver.com/sise/sise_low.naver',
      emptyText: '오늘 하한가 종목이 없어요.', errorText: '하한가 데이터를 불러오지 못했어요.'
    }
  ];

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = SECTIONS.map(buildSectionShell).join('');
    refresh(container);
    setInterval(function () { refresh(container); }, REFRESH_MS);
  }

  function buildSectionShell(s) {
    return '<div class="card sidebar-card sr-card" data-section="' + s.key + '">'
      + '<div class="sidebar-title sr-title">'
      + '<div class="sidebar-icon ' + s.iconCls + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.1-4-4L3 15.5"/></svg></div>'
      + '<span class="sr-title-text">' + s.title + '</span>'
      + '<span class="sr-updated" id="srUpdated-' + s.key + '"></span>'
      + '</div>'
      + '<ol class="sr-list" id="srList-' + s.key + '"><li class="sr-hint">불러오는 중...</li></ol>'
      + '<a class="sr-more" href="' + s.more + '" target="_blank" rel="noopener">더보기 →</a>'
      + '</div>';
  }

  function refresh(container) {
    SidebarRank.fetchRank()
      .then(function (data) {
        SECTIONS.forEach(function (s) {
          renderSection(container, s, (data && data[s.key]) || []);
        });
      })
      .catch(function () {
        SECTIONS.forEach(function (s) {
          var list = container.querySelector('#srList-' + s.key);
          if (list) list.innerHTML = '<li class="sr-hint sr-error">' + escapeHtml(s.errorText) + '</li>';
        });
      });
  }

  function renderSection(container, s, items) {
    var list = container.querySelector('#srList-' + s.key);
    var updated = container.querySelector('#srUpdated-' + s.key);
    if (updated) updated.textContent = fmtTime(new Date());
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<li class="sr-hint">' + escapeHtml(s.emptyText) + '</li>';
      return;
    }
    list.innerHTML = items.map(function (it, i) { return rowHtml(it, i + 1, s.showAmount); }).join('');
  }

  function rowHtml(item, rank, showAmount) {
    var rate = item.change_rate;
    var cls = rate > 0 ? 'sr-up' : rate < 0 ? 'sr-down' : 'sr-flat';
    var arrow = rate > 0 ? '▲' : rate < 0 ? '▼' : '-';
    var url = STOCK_ANALYSIS_URL + '?code=' + encodeURIComponent(item.code) + '&name=' + encodeURIComponent(item.name);
    return '<li class="sr-row">'
      + '<span class="sr-rank">' + rank + '</span>'
      + '<a class="sr-name" href="' + url + '" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</a>'
      + '<span class="sr-rate ' + cls + '">' + arrow + ' ' + Math.abs(rate).toFixed(2) + '%</span>'
      + (showAmount ? '<span class="sr-amount">' + fmtAmount(item.trade_amount) + '</span>' : '')
      + '</li>';
  }

  // trade_amount는 백만원 단위로 온다(키움 ka10032 관례, VM 실측 확인 2026-07-20) -
  // 억원 = 백만원/100.
  function fmtAmount(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v / 100).toLocaleString('ko-KR') + '억';
  }

  function fmtTime(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fetchRank() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, 15000) : null;
    return fetch(API_URL, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('market-rank API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || {};
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  var SidebarRank = {
    init: init,
    fetchRank: fetchRank
  };
  global.SidebarRank = SidebarRank;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
