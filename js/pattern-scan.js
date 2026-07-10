/**
 * 차트 패턴 스캔 위젯
 * 저점상승형 / 쌍바닥 / 역헤드앤숄더 3개 탭 -> 종목 리스트 -> 클릭 시 캔들차트 + 패턴선.
 *
 * 리스트는 GAS가 하루 1회 미리 스캔해둔 결과(?patternScan=1)를 그대로 보여준다(가벼움).
 * 클릭한 종목의 차트는 그 종목만 온디맨드로 다시 크롤링(?patternChart=1&code=&pattern=).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#pattern-scan';
  var FETCH_TIMEOUT_MS = 15000;

  var CHART_W = 820;
  var CHART_H = 320;
  var PAD = { l: 60, r: 16, t: 16, b: 28 };

  var TABS = [
    { key: 'risingLows', label: '저점상승형' },
    { key: 'doubleBottom', label: '쌍바닥' },
    { key: 'invHeadShoulders', label: '역헤드앤숄더' }
  ];

  var scanData = null;
  var activeTab = 'risingLows';

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireTabs(container);
    loadScan(container);
  }

  function buildShell() {
    var tabsHtml = TABS.map(function (t, i) {
      return '<button type="button" class="ps-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + t.key + '">' + t.label + '</button>';
    }).join('');

    return ''
      + '<div class="ps-head">'
      + '<div class="ps-tabs">' + tabsHtml + '</div>'
      + '<div class="ps-meta" id="psMeta">불러오는 중...</div>'
      + '</div>'
      + '<div class="ps-list" id="psList"><div class="ps-hint">불러오는 중...</div></div>'
      + '<div class="ps-detail" id="psDetail" hidden></div>';
  }

  function wireTabs(container) {
    container.querySelectorAll('.ps-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeTab = btn.getAttribute('data-tab');
        renderList(container);
        closeDetail(container);
      });
    });
  }

  function loadScan(container) {
    PatternScan.fetchJson(GAS_TICKER_URL + '?patternScan=1')
      .then(function (data) {
        scanData = data;
        var meta = container.querySelector('#psMeta');
        if (meta) {
          meta.textContent = data.scannedAt
            ? ('스캔 ' + data.scannedAt + ' · 대상 ' + (data.scanned || 0) + '/' + (data.universe || 0) + '종목')
            : '아직 스캔 결과가 없어요. (GAS에서 scanChartPatterns를 한 번 실행해야 함)';
        }
        renderList(container);
      })
      .catch(function () {
        var list = container.querySelector('#psList');
        if (list) list.innerHTML = '<div class="ps-error">스캔 결과를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function renderList(container) {
    var list = container.querySelector('#psList');
    if (!list) return;
    if (!scanData) { list.innerHTML = '<div class="ps-hint">불러오는 중...</div>'; return; }

    var items = (scanData.patterns && scanData.patterns[activeTab]) || [];
    if (!items.length) {
      list.innerHTML = '<div class="ps-hint">지금 이 패턴에 해당하는 종목이 없어요.</div>';
      return;
    }

    list.innerHTML = items.map(function (it) {
      var cc = chgClass(it.changeRate);
      return '<div class="ps-item" data-code="' + it.code + '">'
        + '<span class="ps-name">' + escapeHtml(it.name) + '<span class="ps-code">(' + escapeHtml(it.code) + ')</span></span>'
        + '<span class="ps-quote"><span class="ps-price">' + fmt(it.price) + '</span>'
        + '<span class="ps-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
        + '</div>';
    }).join('');

    list.querySelectorAll('.ps-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var code = el.getAttribute('data-code');
        var item = items.filter(function (x) { return x.code === code; })[0];
        openDetail(container, item);
      });
    });
  }

  // ---- 상세(캔들차트 + 패턴선) ----

  function openDetail(container, item) {
    var detail = container.querySelector('#psDetail');
    if (!detail || !item) return;
    detail.hidden = false;
    detail.innerHTML = '<div class="ps-loading">' + escapeHtml(item.name) + ' 차트를 불러오는 중...</div>';
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    PatternScan.fetchJson(GAS_TICKER_URL + '?patternChart=1&code=' + encodeURIComponent(item.code) + '&pattern=' + encodeURIComponent(activeTab))
      .then(function (data) {
        if (data.error || !data.daily || !data.daily.length) {
          detail.innerHTML = '<div class="ps-error">' + escapeHtml((data && data.message) || '차트를 불러오지 못했어요.') + '</div>';
          return;
        }
        renderDetail(detail, item, data);
      })
      .catch(function () {
        detail.innerHTML = '<div class="ps-error">차트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function closeDetail(container) {
    var detail = container.querySelector('#psDetail');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  }

  function renderDetail(box, item, data) {
    var html = '<div class="ps-detail-head">'
      + '<span class="ps-detail-name">' + escapeHtml(item.name) + ' <span class="ps-code">(' + escapeHtml(item.code) + ')</span></span>'
      + '<button type="button" class="ps-close" id="psClose">닫기 ✕</button>'
      + '</div>';
    html += buildCandleChart(data.daily, data.pattern, data.detail);
    html += '<div class="ps-footnote">※ 패턴 판정은 최근 ' + data.daily.length + '영업일 기준 참고 지표이며, 아직 저항선/넥라인을 못 뚫은 "형성 중" 패턴만 표시됩니다. <b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>';
    box.innerHTML = html;

    var closeBtn = box.querySelector('#psClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { box.hidden = true; box.innerHTML = ''; });
  }

  function buildCandleChart(daily, pattern, detail) {
    var n = daily.length;
    if (n < 2) return '';

    var lows = daily.map(function (d) { return d.low; });
    var highs = daily.map(function (d) { return d.high; });
    var min = Math.min.apply(null, lows);
    var max = Math.max.apply(null, highs);
    var span = (max - min) || 1;
    min -= span * 0.06;
    max += span * 0.06;

    var iw = CHART_W - PAD.l - PAD.r;
    var ih = CHART_H - PAD.t - PAD.b;
    var slot = iw / n;
    function x(i) { return PAD.l + slot * (i + 0.5); }
    function y(v) { return PAD.t + (1 - (v - min) / (max - min)) * ih; }
    function idxByDate(date) {
      for (var i = 0; i < daily.length; i++) if (daily[i].date === date) return i;
      return -1;
    }

    var svg = '<svg class="ps-svg" viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img" aria-label="캔들차트">';

    // 캔들
    daily.forEach(function (d, i) {
      var up = d.close >= d.open;
      var color = up ? '#d24f45' : '#1261c4';
      var xC = x(i);
      var bodyTop = y(Math.max(d.open, d.close));
      var bodyBot = y(Math.min(d.open, d.close));
      var bodyH = Math.max(1, bodyBot - bodyTop);
      var bw = Math.max(2, slot * 0.6);
      svg += '<line x1="' + xC.toFixed(1) + '" x2="' + xC.toFixed(1) + '" y1="' + y(d.high).toFixed(1) + '" y2="' + y(d.low).toFixed(1) + '" stroke="' + color + '" stroke-width="1"/>';
      svg += '<rect x="' + (xC - bw / 2).toFixed(1) + '" y="' + bodyTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bodyH.toFixed(1) + '" fill="' + color + '"/>';
    });

    // y축 레이블
    svg += '<text class="ps-axis" x="' + (PAD.l - 6) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + fmt(max) + '</text>';
    svg += '<text class="ps-axis" x="' + (PAD.l - 6) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + fmt(min) + '</text>';

    // x축 레이블 (처음/중간/끝)
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i, k) {
      var anchor = k === 0 ? 'start' : (k === 2 ? 'end' : 'middle');
      svg += '<text class="ps-axis" x="' + x(i).toFixed(1) + '" y="' + (CHART_H - 8) + '" text-anchor="' + anchor + '">' + shortDate(daily[i].date) + '</text>';
    });

    // 패턴 오버레이
    svg += buildPatternOverlay(pattern, detail, idxByDate, x, y);

    svg += '</svg>';
    return '<div class="ps-chart">' + svg + '</div>';
  }

  function buildPatternOverlay(pattern, detail, idxByDate, x, y) {
    if (!detail) return '';
    var svg = '';

    function line(p1, p2, cls) {
      var i1 = idxByDate(p1.date), i2 = idxByDate(p2.date);
      if (i1 < 0 || i2 < 0) return '';
      return '<line class="' + cls + '" x1="' + x(i1).toFixed(1) + '" y1="' + y(p1.price).toFixed(1)
        + '" x2="' + x(i2).toFixed(1) + '" y2="' + y(p2.price).toFixed(1) + '"/>';
    }
    function dot(p, cls) {
      var i = idxByDate(p.date);
      if (i < 0) return '';
      return '<circle class="' + cls + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.price).toFixed(1) + '" r="4"/>';
    }
    function hline(price, cls) {
      return '<line class="' + cls + '" x1="' + (PAD.l) + '" y1="' + y(price).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(price).toFixed(1) + '"/>';
    }

    if (pattern === 'risingLows') {
      var lows = detail.low_swings || [];
      var highs = detail.high_swings || [];
      for (var i = 1; i < lows.length; i++) svg += line(lows[i - 1], lows[i], 'ps-line-support');
      for (var j = 1; j < highs.length; j++) svg += line(highs[j - 1], highs[j], 'ps-line-resist');
      lows.forEach(function (p) { svg += dot(p, 'ps-dot-support'); });
      highs.forEach(function (p) { svg += dot(p, 'ps-dot-resist'); });
    } else if (pattern === 'doubleBottom') {
      if (detail.neckline) svg += hline(detail.neckline.price, 'ps-line-resist');
      if (detail.low1 && detail.low2) svg += line(detail.low1, detail.low2, 'ps-line-support');
      if (detail.low1) svg += dot(detail.low1, 'ps-dot-support');
      if (detail.low2) svg += dot(detail.low2, 'ps-dot-support');
      if (detail.neckline) svg += dot(detail.neckline, 'ps-dot-resist');
    } else if (pattern === 'invHeadShoulders') {
      if (detail.neckline) svg += hline(detail.neckline.price, 'ps-line-resist');
      if (detail.left_shoulder && detail.head) svg += line(detail.left_shoulder, detail.head, 'ps-line-support');
      if (detail.head && detail.right_shoulder) svg += line(detail.head, detail.right_shoulder, 'ps-line-support');
      ['left_shoulder', 'head', 'right_shoulder'].forEach(function (k) {
        if (detail[k]) svg += dot(detail[k], 'ps-dot-support');
      });
      if (detail.neckline) svg += dot(detail.neckline, 'ps-dot-resist');
    }

    return svg;
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
    return r > 0 ? 'ps-up' : (r < 0 ? 'ps-down' : 'ps-flat');
  }
  function chgSign(rt) {
    if (rt == null) return '';
    var r = parseFloat(rt);
    return (r > 0 ? '+' : '') + r.toFixed(2) + '%';
  }
  function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function shortDate(iso) { return iso.slice(5, 7) + '/' + iso.slice(8, 10); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.PatternScan = { init: init, fetchJson: fetchJson };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
