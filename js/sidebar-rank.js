/**
 * 우측 사이드바 - 실시간 시장데이터 TOP 리스트(거래량/상한가/하한가).
 * 작업지시서(9bolt 사이드바 리디자인, 2026-07-20) Phase 1 범위 - 배당주 TOP은 배당수익률
 * 데이터 소스 자체가 코드베이스에 없어(DART 배당공시 미연동) Phase 2로 미룸(사용자 확인).
 *
 * 데이터: VM(goodbyestar.cloud/market-rank, 키움 REST 랭킹 TR ka10030/ka10017)을 브라우저가
 * 직접 호출(인증 없음, CORS로 블로그 도메인만 허용 - js/kospi-futures.js의 /futures, /option-flow
 * 와 동일 패턴). 30초 주기로 갱신(지시서 4.2 "거래대금 TOP 30초~1분"에 맞춤, 상한가/하한가
 * 요구사항인 "1분"보다 촘촘하지만 세 섹션을 한 번의 호출로 같이 받아오는 게 더 단순함).
 *
 * **2026-07-22: 거래대금 TOP → 거래량 TOP으로 교체**(사용자 피드백: 거래대금 기준으로
 * 뽑으면 단가가 비싼 SK하이닉스 같은 종목만 걸려서 의도한 "많이 거래되는 종목"과 어긋남).
 * VM 쪽 `scripts/cloud-vm/market_rank.py`가 ka10032(거래대금상위) 대신 ka10030(당일거래량
 * 상위)을 호출하도록 같이 바꿨고, 응답 키도 `tradeAmount`→`tradeVolume`로 변경됨.
 *
 * 색상: 지시서 원문은 #E24B4A(상승)/#378ADD(하락)를 지정했지만, 사이트 전체가 이미
 * #d24f45(상승)/#1261c4(하락)로 통일돼 있어(CLAUDE.md) 그 값 대신 기존 사이트 색을 그대로
 * 썼다 - 다른 페이지들과 색이 어긋나면 안 되므로. 상한가/하한가 뱃지도 지시서가 지정한
 * CSS 변수(--bg-accent 등)가 이 코드베이스에 없어서, 기존 배지 팔레트(ff-badge-buy/sell과
 * 동일 톤)를 재사용했다.
 *
 * "더보기"(2026-07-20 2차): 처음엔 네이버 랭킹 페이지로 외부 이동시켰는데, 방문자를 블로그
 * 밖으로 내보내는 게 아쉽다는 피드백 - 종목분석 페이지의 "업종/테마 관련종목" 모달
 * (js/foreign-flow.js showRelatedStocks)과 같은 패턴으로, 블로그 안에서 TOP20을 모달로
 * 보여주도록 교체. /market-rank?limit=20을 그때그때 호출(기본 폴링은 계속 limit=5).
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/market-rank';
  var CONTAINER_SELECTOR = '#sidebar-rank';
  var REFRESH_MS = 30 * 1000;
  var MODAL_LIMIT = 20;
  var STOCK_ANALYSIS_URL = 'https://ghlee.tistory.com/page/foreign-flow';

  var SECTIONS = [
    {
      key: 'tradeVolume', title: '거래량 TOP', shortTitle: '거래량', iconCls: 'si-blue', showAmount: true,
      emptyText: '거래량 데이터가 없어요.', errorText: '거래량 데이터를 불러오지 못했어요.'
    },
    {
      key: 'upperLimit', title: '상한가', shortTitle: '상한가', iconCls: 'si-amber', showAmount: false,
      emptyText: '오늘 상한가 종목이 없어요.', errorText: '상한가 데이터를 불러오지 못했어요.'
    },
    {
      key: 'lowerLimit', title: '하한가', shortTitle: '하한가', iconCls: 'si-purple', showAmount: false,
      emptyText: '오늘 하한가 종목이 없어요.', errorText: '하한가 데이터를 불러오지 못했어요.'
    }
  ];
  var SECTION_BY_KEY = {};
  SECTIONS.forEach(function (s) { SECTION_BY_KEY[s.key] = s; });

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = SECTIONS.map(buildSectionShell).join('');
    container.addEventListener('click', function (e) {
      var moreBtn = e.target.closest ? e.target.closest('.sr-more') : null;
      if (moreBtn) openModal(moreBtn.getAttribute('data-section'));
    });
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
      + '<button type="button" class="sr-more" data-section="' + s.key + '">더보기 →</button>'
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
      + '<span class="sr-quote">'
      + '<span class="sr-price">' + fmtPrice(item.price) + '</span>'
      + '<span class="sr-rate ' + cls + '">' + arrow + ' ' + Math.abs(rate).toFixed(2) + '%</span>'
      + '</span>'
      + (showAmount ? '<span class="sr-amount">' + fmtVolume(item.trade_volume) + '</span>' : '')
      + '</li>';
  }

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v).toLocaleString('ko-KR');
  }

  // ---- "더보기" 모달(TOP20, 블로그 안에서 보여줌 - 외부 이동 없음) ----

  function closeModal() {
    var existing = document.querySelector('.sr-modal-overlay');
    if (existing) existing.remove();
  }

  function openModal(sectionKey) {
    var s = SECTION_BY_KEY[sectionKey];
    if (!s) return;
    closeModal();

    var overlay = document.createElement('div');
    overlay.className = 'sr-modal-overlay';
    overlay.innerHTML = '<div class="sr-modal">'
      + '<div class="sr-modal-header"><span>' + escapeHtml(s.shortTitle) + ' TOP' + MODAL_LIMIT + '</span>'
      + '<button type="button" class="sr-modal-close" aria-label="닫기">✕</button></div>'
      + '<ol class="sr-list sr-modal-list"><li class="sr-hint">불러오는 중...</li></ol>'
      + '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.sr-modal-close')) closeModal();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key !== 'Escape') return;
      closeModal();
      document.removeEventListener('keydown', escHandler);
    });

    SidebarRank.fetchRank(MODAL_LIMIT)
      .then(function (data) {
        if (!document.body.contains(overlay)) return; // 응답 오는 사이 닫았으면 무시
        var items = (data && data[sectionKey]) || [];
        var list = overlay.querySelector('.sr-modal-list');
        if (!items.length) {
          list.innerHTML = '<li class="sr-hint">' + escapeHtml(s.emptyText) + '</li>';
          return;
        }
        list.innerHTML = items.map(function (it, i) { return rowHtml(it, i + 1, s.showAmount); }).join('');
      })
      .catch(function () {
        if (!document.body.contains(overlay)) return;
        var list = overlay.querySelector('.sr-modal-list');
        if (list) list.innerHTML = '<li class="sr-hint sr-error">' + escapeHtml(s.errorText) + '</li>';
      });
  }

  // trade_volume은 주 단위 원시값으로 온다(키움 ka10030) - 만주 단위로 축약 표시.
  function fmtVolume(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v / 10000).toLocaleString('ko-KR') + '만주';
  }

  function fmtTime(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fetchRank(limit) {
    var url = API_URL + (limit ? '?limit=' + encodeURIComponent(limit) : '');
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, 15000) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
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
