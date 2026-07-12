/**
 * 오늘의 투자시그널 위젯 (신규 페이지 전용)
 *
 * ① 오늘의 투자시그널: 섹터 종목 풀 전체(sectors-v3.js, 237종목)를 매수~매도 5단계로
 *    분류한 개수. 클릭하면 해당 등급 종목 목록이 펼쳐진다.
 * ② 수급 랭킹: 외국인/기관/연기금 TOP20 + 최근 5일 수급 개선/악화 TOP20.
 *
 * 데이터는 GAS가 하루 1회 미리 계산해둔 결과(?investSignal=1)를 그대로 보여준다(가벼움).
 * 점수 산식(수급40%+외국인기관25%+기술적20%+공매도10%+연기금5%)은 js/foreign-flow.js의
 * 종목분석 위젯과 완전히 동일하다(gas/ticker-proxy.gs의 scanInvestSignal이 같은 공식을
 * 서버에서 재계산) - 이 페이지의 등급과 종목분석 페이지의 별점이 항상 같은 결론을 가리킨다.
 *
 * 종목을 클릭하면 새 상세 화면을 여기서 만들지 않고, 이미 있는 "종목분석" 페이지
 * (/page/foreign-flow)로 ?code=&name= 파라미터를 붙여 이동시킨다(그 페이지의
 * js/foreign-flow.js가 파라미터를 읽어 자동 검색).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#invest-signal';
  var FETCH_TIMEOUT_MS = 15000;

  var STOCK_ANALYSIS_URL = 'https://ghlee.tistory.com/page/foreign-flow';

  var BUCKET_META = [
    { key: 'activeBuy', countKey: '적극 매수', emoji: '🟢', label: '적극매수' },
    { key: 'buy', countKey: '매수 우위', emoji: '🟢', label: '매수' },
    { key: 'hold', countKey: '보유', emoji: '🟡', label: '보유' },
    { key: 'reduce', countKey: '비중축소', emoji: '🟠', label: '비중축소' },
    { key: 'sell', countKey: '매도', emoji: '🔴', label: '매도' }
  ];

  var RANK_TABS = [
    { key: 'foreign', label: '🔥 외국인 순매수 TOP20', metricLabel: '외국인 5일 순매수', metricFmt: fmtShares,
      desc: '최근 5일간 외국인이 가장 많이 순매수(주식을 사들인)한 종목 순위입니다.' },
    { key: 'inst', label: '🏦 기관 순매수 TOP20', metricLabel: '기관 5일 순매수', metricFmt: fmtShares,
      desc: '최근 5일간 기관투자자가 가장 많이 순매수한 종목 순위입니다.' },
    { key: 'pension', label: '💰 연기금 TOP20', metricLabel: '연기금 5일 순매수', metricFmt: fmtPensionWon,
      desc: '최근 5일간 국민연금 등 연기금이 가장 많이 순매수한 종목 순위입니다(키움 API 기반, 하루 1회 갱신 - 사용자 PC를 켠 시점 기준으로 데이터가 새로워짐).' },
    { key: 'improved', label: '📈 최근 5일 수급 개선', metricLabel: '수급 개선폭(일평균)', metricFmt: fmtShiftShares,
      desc: '최근 5일 외국인+기관 합산 순매매(일평균)가 그 이전 15일 평균보다 좋아지고 있는 종목 순위입니다. 매수세가 강해지는 초입일 수 있습니다.' },
    { key: 'worsened', label: '📉 최근 5일 수급 악화', metricLabel: '수급 악화폭(일평균)', metricFmt: fmtShiftShares,
      desc: '최근 5일 외국인+기관 합산 순매매(일평균)가 그 이전 15일 평균보다 나빠지고 있는 종목 순위입니다. 매도세가 강해지는 초입일 수 있습니다.' }
  ];

  var signalData = null;
  var activeBucket = null; // null이면 전부 접힘
  var activeRankTab = 'foreign';

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    load(container);
  }

  function buildShell() {
    return ''
      + '<div class="is-meta" id="isMeta">불러오는 중...</div>'
      + '<div class="is-section">'
      + '<div class="is-section-title">① 오늘의 투자시그널</div>'
      + '<div class="is-section-desc">수급(40%)·외국인·기관 연속매매(25%)·기술적 점수(20%)·공매도 압박(10%)·연기금(5%)을 '
      + '가중합산한 종합점수를 별점(0~5)으로 환산해 5단계로 나눕니다. '
      + '<b>4.5★ 이상 적극매수 · 3.8~4.4★ 매수 · 2.8~3.7★ 보유 · 1.8~2.7★ 비중축소 · 1.8★ 미만 매도.</b> '
      + '종목분석 페이지의 별점과 완전히 같은 계산식입니다.</div>'
      + '<div class="is-buckets" id="isBuckets"><div class="is-hint">불러오는 중...</div></div>'
      + '<div class="is-bucket-list" id="isBucketList" hidden></div>'
      + '</div>'
      + '<div class="is-section">'
      + '<div class="is-section-title">② 수급 랭킹</div>'
      + '<div class="is-rank-tabs" id="isRankTabs"></div>'
      + '<div class="is-rank-desc" id="isRankDesc"></div>'
      + '<div class="is-rank-list" id="isRankList"><div class="is-hint">불러오는 중...</div></div>'
      + '</div>'
      + '<div class="is-footnote">종목명을 클릭하면 종목분석 페이지로 이동해 자동으로 상세 수급을 조회합니다. '
      + '<b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>';
  }

  function load(container) {
    global.InvestSignal.fetchJson(GAS_TICKER_URL + '?investSignal=1')
      .then(function (data) {
        signalData = data;
        renderMeta(container);
        renderBuckets(container);
        wireRankTabs(container);
        renderRankList(container);
      })
      .catch(function () {
        var meta = container.querySelector('#isMeta');
        if (meta) meta.textContent = '데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
        var buckets = container.querySelector('#isBuckets');
        if (buckets) buckets.innerHTML = '<div class="is-error">등급 데이터를 불러오지 못했어요.</div>';
        var rank = container.querySelector('#isRankList');
        if (rank) rank.innerHTML = '<div class="is-error">랭킹 데이터를 불러오지 못했어요.</div>';
      });
  }

  function renderMeta(container) {
    var meta = container.querySelector('#isMeta');
    if (!meta) return;
    meta.textContent = signalData.scannedAt
      ? ('스캔 ' + signalData.scannedAt + ' · 대상 ' + (signalData.scanned || 0) + '/' + (signalData.universe || 0) + '종목')
      : '아직 스캔 결과가 없어요. (GAS에서 scanInvestSignal을 한 번 실행해야 함)';
  }

  // ---- ① 오늘의 투자시그널 ----

  function renderBuckets(container) {
    var box = container.querySelector('#isBuckets');
    if (!box) return;
    var counts = signalData.counts || {};

    box.innerHTML = BUCKET_META.map(function (b) {
      var n = counts[b.countKey] || 0;
      return '<button type="button" class="is-bucket' + (activeBucket === b.key ? ' active' : '') + '" data-bucket="' + b.key + '">'
        + '<span class="is-bucket-emoji">' + b.emoji + '</span>'
        + '<span class="is-bucket-label">' + b.label + '</span>'
        + '<span class="is-bucket-count">' + n.toLocaleString('ko-KR') + '종목</span>'
        + '</button>';
    }).join('');

    box.querySelectorAll('.is-bucket').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-bucket');
        activeBucket = activeBucket === key ? null : key;
        renderBuckets(container);
        renderBucketList(container);
      });
    });

    renderBucketList(container);
  }

  function renderBucketList(container) {
    var listBox = container.querySelector('#isBucketList');
    if (!listBox) return;
    if (!activeBucket) { listBox.hidden = true; listBox.innerHTML = ''; return; }

    var meta = BUCKET_META.filter(function (b) { return b.key === activeBucket; })[0];
    var items = (signalData.buckets && signalData.buckets[activeBucket]) || [];
    var totalCount = (signalData.counts && signalData.counts[meta.countKey]) || 0;

    listBox.hidden = false;
    if (!items.length) {
      listBox.innerHTML = '<div class="is-hint">해당 등급에 속한 종목이 없어요.</div>';
      return;
    }

    var rowsHtml = items.map(function (it) {
      return stockRowHtml(it[0], it[1], it[2], it[3]);
    }).join('');

    listBox.innerHTML = '<div class="is-list-head">' + meta.emoji + ' ' + meta.label + ' 종목 목록'
      + (totalCount > items.length ? ' <span class="is-list-cap">(상위 ' + items.length + '/' + totalCount + '종목만 표시)</span>' : '')
      + '</div>'
      + '<div class="is-stock-table">' + rowsHtml + '</div>';
  }

  // ---- ② 수급 랭킹 ----

  function wireRankTabs(container) {
    var box = container.querySelector('#isRankTabs');
    if (!box) return;
    box.innerHTML = RANK_TABS.map(function (t) {
      return '<button type="button" class="is-rank-tab' + (activeRankTab === t.key ? ' active' : '') + '" data-tab="' + t.key + '">' + t.label + '</button>';
    }).join('');

    box.querySelectorAll('.is-rank-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        box.querySelectorAll('.is-rank-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeRankTab = btn.getAttribute('data-tab');
        renderRankDesc(container);
        renderRankList(container);
      });
    });

    renderRankDesc(container);
  }

  // 목록이 비어 있어도 이 랭킹이 뭘 보여주는 건지는 항상 보이게 한다(ps-tab-desc와 동일한 취지).
  function renderRankDesc(container) {
    var box = container.querySelector('#isRankDesc');
    if (!box) return;
    var tab = RANK_TABS.filter(function (t) { return t.key === activeRankTab; })[0];
    box.textContent = tab ? tab.desc : '';
  }

  function renderRankList(container) {
    var box = container.querySelector('#isRankList');
    if (!box) return;
    var tab = RANK_TABS.filter(function (t) { return t.key === activeRankTab; })[0];
    var items = (signalData.rankings && signalData.rankings[activeRankTab]) || [];

    if (!items.length) {
      box.innerHTML = '<div class="is-hint">랭킹 데이터가 아직 없어요.</div>';
      return;
    }

    var rowsHtml = items.map(function (it, i) {
      return stockRowHtml(it[0], it[1], it[2], it[3], (i + 1), it[4], tab.metricFmt, tab.metricLabel);
    }).join('');

    box.innerHTML = '<div class="is-stock-table is-stock-table-ranked">' + rowsHtml + '</div>';
  }

  // rank/metricVal/metricFmt/metricLabel이 있으면 랭킹용(순위+지표값 컬럼), 없으면 등급 목록용(단순 시세만)
  function stockRowHtml(code, name, price, changeRate, rank, metricVal, metricFmt, metricLabel) {
    var cc = chgClass(changeRate);
    var href = stockHref(code, name);
    var metricHtml = (rank != null)
      ? '<span class="is-rank-num">' + rank + '</span>'
        + '<span class="is-metric"><span class="is-metric-label">' + escapeHtml(metricLabel || '') + '</span>'
        + '<span class="is-metric-val">' + metricFmt(metricVal) + '</span></span>'
      : '';
    return '<a class="is-stock-row" href="' + escapeAttr(href) + '" target="_blank" rel="noopener">'
      + metricHtml
      + '<span class="is-stock-name">' + escapeHtml(name) + '<span class="is-stock-code">(' + escapeHtml(code) + ')</span></span>'
      + '<span class="is-stock-quote"><span class="is-stock-price">' + fmt(price) + '</span>'
      + '<span class="is-stock-rate ' + cc + '">' + chgSign(changeRate) + '</span></span>'
      + '</a>';
  }

  function stockHref(code, name) {
    return STOCK_ANALYSIS_URL + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name);
  }

  // ---- 유틸 ----

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
    var r = parseFloat(rt);
    return r > 0 ? 'is-up' : (r < 0 ? 'is-down' : 'is-flat');
  }
  function chgSign(rt) {
    if (rt == null) return '';
    var r = parseFloat(rt);
    return (r > 0 ? '+' : '') + r.toFixed(2) + '%';
  }
  function fmt(n) { return n == null || isNaN(n) ? '-' : Math.round(n).toLocaleString('ko-KR'); }
  function fmtShares(n) { return n == null || isNaN(n) ? '-' : (n >= 0 ? '+' : '') + Math.round(n).toLocaleString('ko-KR') + '주'; }
  // 연기금 net_5d는 백만원 단위로 내려오므로(js/foreign-flow.js fmtSignedWon과 동일 규칙) /100 = 억원
  function fmtPensionWon(n) {
    if (n == null || isNaN(n)) return '-';
    var eok = n / 100;
    return (eok >= 0 ? '+' : '') + eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억';
  }
  function fmtShiftShares(n) { return n == null || isNaN(n) ? '-' : (n >= 0 ? '+' : '') + Math.round(n).toLocaleString('ko-KR') + '주/일'; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  global.InvestSignal = { init: init, fetchJson: fetchJson };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
