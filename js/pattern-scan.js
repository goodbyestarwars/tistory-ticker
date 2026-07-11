/**
 * 차트 패턴 스캔 위젯
 * 저점상승형 / 쌍바닥 / 역헤드앤숄더 / 박스권하단 / 골파기반전 / 눌림목 6개 탭 -> 종목 리스트 -> 클릭 시 캔들차트 + 패턴선.
 *
 * 리스트는 GAS가 하루 1회 미리 스캔해둔 결과(?patternScan=1)를 그대로 보여준다(가벼움).
 * 클릭한 종목의 차트는 그 종목만 온디맨드로 다시 크롤링(?patternChart=1&code=&pattern=).
 *
 * 모든 패턴은 0~100점 스코어링(GAS에서 계산, 70점 이상만 결과에 포함)이며,
 * AI가 패턴을 임의로 판단하지 않고 수치 조건으로만 점수를 매긴다 - 리스트/상세 모두
 * 점수 + 원인(부분점수 breakdown) + 한 줄 해석을 그대로 보여준다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#pattern-scan';
  var FETCH_TIMEOUT_MS = 15000;

  var CHART_W = 1300;
  var CHART_H = 440;
  var PAD = { l: 64, r: 16, t: 16, b: 28 };

  var TABS = [
    { key: 'risingLows', label: '저점상승형' },
    { key: 'doubleBottom', label: '쌍바닥' },
    { key: 'invHeadShoulders', label: '역헤드앤숄더' },
    { key: 'boxRangeLow', label: '박스권 하단' },
    { key: 'goldPitReversal', label: '골파기 반전' },
    { key: 'pullback', label: '눌림목' }
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

    // 점수 높은 순으로 정렬 - 지시서 "70점 이상만 노출" 중에서도 가장 근거가 탄탄한 종목이 위로
    var sorted = items.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });

    list.innerHTML = sorted.map(function (it) {
      var cc = chgClass(it.changeRate);
      return '<div class="ps-item" data-code="' + it.code + '">'
        + '<span class="ps-name">' + escapeHtml(it.name) + '<span class="ps-code">(' + escapeHtml(it.code) + ')</span></span>'
        + '<span class="ps-score-badge">' + (it.score != null ? it.score + '점' : '-') + '</span>'
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
    html += buildScoreBox(data.detail);
    html += buildCandleChart(data.daily, data.pattern, data.detail);
    html += '<div class="ps-footnote">※ 패턴 판정은 최근 ' + data.daily.length + '영업일 기준 참고 지표이며, 아직 저항선/넥라인을 못 뚫은 "형성 중" 패턴만 표시됩니다. <b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>';
    box.innerHTML = html;

    var closeBtn = box.querySelector('#psClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { box.hidden = true; box.innerHTML = ''; });
  }

  // 점수 + 원인(부분점수) + AI 한 줄 해석 - 지시서 원칙("결과에는 점수 + 원인 + AI 한 줄 해석을
  // 함께 제공한다")을 그대로 반영. 점수는 GAS가 수치 조건으로만 계산(임의 판단 없음).
  function buildScoreBox(detail) {
    if (!detail || detail.score == null) return '';
    var reasons = (detail.reasons || []).map(function (r) {
      return '<li>' + escapeHtml(r) + '</li>';
    }).join('');
    return '<div class="ps-score-box">'
      + '<div class="ps-score-big">' + detail.score + '<span class="ps-score-unit">점</span></div>'
      + '<div class="ps-score-body">'
      + (detail.interpretation ? '<div class="ps-interp">' + escapeHtml(detail.interpretation) + '</div>' : '')
      + (reasons ? '<ul class="ps-reasons">' + reasons + '</ul>' : '')
      + '</div>'
      + '</div>';
  }

  function buildCandleChart(daily, pattern, detail) {
    var n = daily.length;
    if (n < 2) return '';

    // 캔들 수가 많으면(골파기는 90일치) 차트 폭을 늘려서 촘촘해지지 않게 함
    var chartW = Math.max(CHART_W, n * 24);

    var lows = daily.map(function (d) { return d.low; });
    var highs = daily.map(function (d) { return d.high; });
    var min = Math.min.apply(null, lows);
    var max = Math.max.apply(null, highs);
    var span = (max - min) || 1;
    min -= span * 0.06;
    max += span * 0.06;

    var iw = chartW - PAD.l - PAD.r;
    var ih = CHART_H - PAD.t - PAD.b;
    var slot = iw / n;
    function x(i) { return PAD.l + slot * (i + 0.5); }
    function y(v) { return PAD.t + (1 - (v - min) / (max - min)) * ih; }
    function idxByDate(date) {
      for (var i = 0; i < daily.length; i++) if (daily[i].date === date) return i;
      return -1;
    }

    var svg = '<svg class="ps-svg" viewBox="0 0 ' + chartW + ' ' + CHART_H + '" role="img" aria-label="캔들차트" style="min-width:' + chartW + 'px">';

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

    // MA60(골파기 전용): 종가 60일 이동평균선을 배경에 그려서 추세전환을 눈으로 볼 수 있게 함
    if (pattern === 'goldPitReversal' && detail && detail.ma_period) {
      svg += buildMaLine(daily, detail.ma_period, x, y);
    }
    // 눌림목: 20일선/60일선 중 어디 근처에서 지지받는지 눈으로 보여주기 위해 둘 다 그림(선 색 구분)
    if (pattern === 'pullback') {
      svg += buildMaLine(daily, 20, x, y, 'ps-line-ma20');
      svg += buildMaLine(daily, 60, x, y, 'ps-line-ma60');
    }

    // y축 레이블
    svg += '<text class="ps-axis" x="' + (PAD.l - 6) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + fmt(max) + '</text>';
    svg += '<text class="ps-axis" x="' + (PAD.l - 6) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + fmt(min) + '</text>';

    // x축 레이블 (처음/중간/끝)
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i, k) {
      var anchor = k === 0 ? 'start' : (k === 2 ? 'end' : 'middle');
      svg += '<text class="ps-axis" x="' + x(i).toFixed(1) + '" y="' + (CHART_H - 8) + '" text-anchor="' + anchor + '">' + shortDate(daily[i].date) + '</text>';
    });

    // 패턴 오버레이
    svg += buildPatternOverlay(pattern, detail, idxByDate, x, y, chartW);

    svg += '</svg>';
    return '<div class="ps-chart">' + svg + '</div>';
  }

  // 종가 N일 이동평균선을 폴리라인으로 그림 (골파기 반전 전용)
  function buildMaLine(daily, period, x, y, cls) {
    var pts = [];
    var sum = 0;
    for (var i = 0; i < daily.length; i++) {
      sum += daily[i].close;
      if (i >= period) sum -= daily[i - period].close;
      if (i >= period - 1) pts.push(x(i).toFixed(1) + ',' + y(sum / period).toFixed(1));
    }
    if (pts.length < 2) return '';
    return '<polyline class="' + (cls || 'ps-line-ma') + '" points="' + pts.join(' ') + '"/>';
  }

  function buildPatternOverlay(pattern, detail, idxByDate, x, y, chartW) {
    if (!detail) return '';
    var svg = '';

    function line(p1, p2, cls) {
      var i1 = idxByDate(p1.date), i2 = idxByDate(p2.date);
      if (i1 < 0 || i2 < 0) return '';
      return '<line class="' + cls + '" x1="' + x(i1).toFixed(1) + '" y1="' + y(p1.price).toFixed(1)
        + '" x2="' + x(i2).toFixed(1) + '" y2="' + y(p2.price).toFixed(1) + '"/>';
    }
    // 여러 점을 순서대로 잇는 꺾은선 (쌍바닥/역헤드앤숄더의 실제 굴곡을 그대로 표현하기 위함)
    function polyline(points, cls) {
      var coords = [];
      points.forEach(function (p) {
        var i = idxByDate(p.date);
        if (i < 0) return;
        coords.push(x(i).toFixed(1) + ',' + y(p.price).toFixed(1));
      });
      if (coords.length < 2) return '';
      return '<polyline class="' + cls + '" points="' + coords.join(' ') + '"/>';
    }
    function dot(p, cls) {
      var i = idxByDate(p.date);
      if (i < 0) return '';
      return '<circle class="' + cls + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.price).toFixed(1) + '" r="4"/>';
    }
    // 확인/매수 검토 지점을 O(원) 표시로 강조 (참고 이미지의 핑크색 원 컨벤션)
    function signalRing(p) {
      var i = idxByDate(p.date);
      if (i < 0) return '';
      return '<circle class="ps-dot-signal" cx="' + x(i).toFixed(1) + '" cy="' + y(p.price).toFixed(1) + '" r="9"/>';
    }
    // fromDate를 주면 그 지점부터 오른쪽 끝까지만 수평선을 그림(패턴 구간만 강조, 전체 폭 X)
    function hline(price, cls, fromDate) {
      var xStart = PAD.l;
      if (fromDate) {
        var i = idxByDate(fromDate);
        if (i >= 0) xStart = x(i);
      }
      return '<line class="' + cls + '" x1="' + xStart.toFixed(1) + '" y1="' + y(price).toFixed(1)
        + '" x2="' + (chartW - PAD.r) + '" y2="' + y(price).toFixed(1) + '"/>';
    }

    if (pattern === 'risingLows') {
      // low_swings_display는 마지막 스윙 저점 뒤에 "오늘"(현재가)까지 이어붙인 배열 -
      // 패턴이 이미 끝난 게 아니라 지금도 진행 중임을 보여주기 위함
      var lows = detail.low_swings_display || detail.low_swings || [];
      var highs = detail.high_swings || [];
      svg += polyline(lows, 'ps-line-support');
      svg += polyline(highs, 'ps-line-resist');
      (detail.low_swings || []).forEach(function (p) { svg += dot(p, 'ps-dot-support'); });
      highs.forEach(function (p) { svg += dot(p, 'ps-dot-resist'); });
      if (detail.signal) svg += signalRing(detail.signal); // 오늘(현재가) - 항상 최근 봉 기준
    } else if (pattern === 'doubleBottom') {
      // 저점1 -> 넥라인(중간 반등 고점) -> 저점2 -> 현재가 순서로 이어야 실제 W 모양이 나온다
      // (저점2에서 끊으면 "^" 하나만 보여서 W로 안 읽힘 - 현재가까지 이어 오른쪽 다리를 완성)
      if (detail.low1 && detail.neckline && detail.low2) {
        var dbPoints = [detail.low1, detail.neckline, detail.low2];
        if (detail.current) dbPoints.push(detail.current);
        svg += polyline(dbPoints, 'ps-line-support');
        svg += hline(detail.neckline.price, 'ps-line-resist', detail.low1.date);
        svg += dot(detail.low1, 'ps-dot-support');
        svg += dot(detail.low2, 'ps-dot-support');
        svg += dot(detail.neckline, 'ps-dot-resist');
        if (detail.signal) svg += signalRing(detail.signal); // 오늘(현재가)
      }
    } else if (pattern === 'invHeadShoulders') {
      // 좌어깨 -> 좌고점 -> 헤드 -> 우고점 -> 우어깨 -> 현재가 순서로 이어 봉우리 2개 + 최근 흐름까지 표현
      var seq = [detail.left_shoulder, detail.left_peak, detail.head, detail.right_peak, detail.right_shoulder];
      if (seq.every(function (p) { return !!p; })) {
        if (detail.current) seq.push(detail.current);
        svg += polyline(seq, 'ps-line-support');
        svg += hline(detail.neckline.price, 'ps-line-resist', detail.left_shoulder.date);
        ['left_shoulder', 'head', 'right_shoulder'].forEach(function (k) { svg += dot(detail[k], 'ps-dot-support'); });
        svg += dot(detail.neckline, 'ps-dot-resist');
        if (detail.signal) svg += signalRing(detail.signal); // 오늘(현재가)
      }
    } else if (pattern === 'boxRangeLow') {
      var boxLows = detail.low_swings || [];
      var boxHighs = detail.high_swings || [];
      if (detail.support != null) svg += hline(detail.support, 'ps-line-support', boxLows[0] && boxLows[0].date);
      if (detail.resistance != null) svg += hline(detail.resistance, 'ps-line-resist', boxHighs[0] && boxHighs[0].date);
      boxLows.forEach(function (p) { svg += dot(p, 'ps-dot-support'); });
      boxHighs.forEach(function (p) { svg += dot(p, 'ps-dot-resist'); });
      if (detail.signal) svg += signalRing(detail.signal); // 현재가(박스 하단 근접 지점)
    } else if (pattern === 'goldPitReversal') {
      // MA60 전환 지점(cross) -> 현재가 2점만 표시. 랠리/눌림목까지 기다리지 않고
      // "막 돌파한 초반"만 잡는 설계라 배경의 MA60선(buildCandleChart에서 그림)이 핵심 근거.
      if (detail.cross && detail.current) {
        svg += polyline([detail.cross, detail.current], 'ps-line-support');
        svg += dot(detail.cross, 'ps-dot-resist');
        svg += signalRing(detail.current); // 돌파 확인 지점(오늘)
      }
    } else if (pattern === 'pullback') {
      // 상승 시작(저점) -> 고점 -> 현재가(조정 중) 순서로 이어 "얼마나 올랐다가 얼마나
      // 눌렸는지"를 한눈에 보여준다. 이평선은 buildCandleChart에서 배경에 이미 그림.
      if (detail.rise_start && detail.peak && detail.current) {
        svg += polyline([detail.rise_start, detail.peak, detail.current], 'ps-line-support');
        svg += dot(detail.rise_start, 'ps-dot-support');
        svg += dot(detail.peak, 'ps-dot-resist');
        svg += signalRing(detail.current); // 눌림목 확인 지점(오늘)
      }
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
