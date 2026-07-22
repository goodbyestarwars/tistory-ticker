/**
 * 차트 패턴 스캔 위젯
 * 저점상승형 / 쌍바닥 / 역헤드앤숄더 / 박스권하단 / 눌림목 5개 탭 -> 종목 리스트 -> 클릭 시 캔들차트 + 패턴선.
 *
 * 리스트는 GAS가 하루 1회 미리 스캔해둔 결과(?patternScan=1)를 그대로 보여준다(가벼움).
 * 클릭한 종목의 차트는 그 종목만 온디맨드로 다시 크롤링(?patternChart=1&code=&pattern=).
 *
 * 모든 패턴은 0~100점 스코어링(GAS에서 계산, 70점 이상만 결과에 포함)이며,
 * AI가 패턴을 임의로 판단하지 않고 수치 조건으로만 점수를 매긴다 - 리스트/상세 모두
 * 점수 + 원인(부분점수 breakdown) + 한 줄 해석을 그대로 보여준다.
 *
 * 캔들차트는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드)로 렌더링한다 -
 * 가로 스크롤 없이 컨테이너에 자동으로 맞춰(autoSize) 한눈에 들어오게 하기 위함
 * (js/foreign-flow.js와 동일한 라이브러리/패턴).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#pattern-scan';
  var FETCH_TIMEOUT_MS = 15000;

  var CHART_H = 420;

  var SUPPORT_COLOR = '#d24f45';
  var RESIST_COLOR = '#1261c4';
  var SIGNAL_COLOR = '#ec4899';
  var MA20_COLOR = '#f59e0b';
  var MA60_COLOR = '#8b5cf6';

  // js/foreign-flow.js와 동일한 주기·색상(사이트 전체 일관성) - 일목균형표 토글 전용.
  var ICHIMOKU_TENKAN_PERIOD = 9, ICHIMOKU_KIJUN_PERIOD = 26, ICHIMOKU_SENKOU_B_PERIOD = 52, ICHIMOKU_DISPLACEMENT = 26;
  var ICHIMOKU_COLORS = { tenkan: '#d6336c', kijun: '#1971c2', senkouA: '#37b24d', senkouB: '#f08c00', chikou: '#868e96' };

  // desc는 각 detect*_ 함수(gas/ticker-proxy.gs)의 판정 조건을 일반 투자자가 읽을 수 있는
  // 말로 옮긴 것 - 목록이 비어 있을 때도(70점 미만이라 노출 종목이 없을 때) 이 패턴이
  // 뭘 찾는 건지는 항상 보이게 하기 위함.
  var TABS = [
    { key: 'risingLows', label: '저점상승형', desc: '저점이 이전 저점보다 3% 이상 높아지며 하락 압력이 약해지는 구간. 아직 크게 오르지 않아 조기 진입을 노리는 패턴입니다.' },
    { key: 'doubleBottom', label: '쌍바닥', desc: '비슷한 높이의 저점을 두 번 찍고 그 사이 반등한 고점(넥라인)이 있는 W자 모양. 바닥을 두 번 확인했다는 신호입니다.' },
    { key: 'invHeadShoulders', label: '역헤드앤숄더', desc: '저점 3개가 어깨-머리-어깨 모양(가운데가 가장 낮음)을 이루는 패턴. 하락 추세가 상승으로 반전될 때 자주 나타납니다.' },
    { key: 'boxRangeLow', label: '박스권 하단', desc: '일정 가격대(박스권)에서 등락을 반복하다 그 박스 하단(지지선) 근처까지 내려온 구간. 지지가 버텨주는지 확인하는 자리입니다.' },
    { key: 'pullback', label: '눌림목', desc: '단기간 15% 이상 오른 뒤 5~15% 정도 되돌림(조정)이 나와 20일선·60일선 부근까지 내려온 구간. 상승 추세 중 쉬어가는 자리입니다.' }
  ];

  // 리스트 항목용 미니 패턴 아이콘 - 실제 캔들을 축소한 게 아니라 O(고점/저점)와 선으로
  // 패턴의 핵심 구조만 단순화한 것.
  var PATTERN_ICONS = {
    risingLows: '<path d="M2,15 L9,15 L20,6 L30,3"/><circle cx="9" cy="15" r="2"/><circle cx="20" cy="6" r="2"/>',
    doubleBottom: '<path d="M2,4 L8,14 L16,7 L24,14 L30,4"/><circle cx="8" cy="14" r="2"/><circle cx="24" cy="14" r="2"/>',
    invHeadShoulders: '<path d="M2,6 L7,10 L12,6 L17,15 L22,6 L27,10 L32,3"/><circle cx="7" cy="10" r="2"/><circle cx="17" cy="15" r="2"/><circle cx="27" cy="10" r="2"/>',
    boxRangeLow: '<rect x="3" y="2" width="24" height="12" rx="1"/><circle cx="6" cy="14" r="2"/><circle cx="24" cy="14" r="2"/>',
    pullback: '<path d="M2,15 L10,4 L16,10 L24,2"/><circle cx="10" cy="4" r="2"/><circle cx="16" cy="10" r="2"/>'
  };

  function patternIcon(key) {
    return '<svg class="ps-icon" viewBox="0 0 32 18" width="28" height="16" aria-hidden="true">' + (PATTERN_ICONS[key] || '') + '</svg>';
  }

  var scanData = null;
  var activeTab = 'risingLows';

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireTabs(container);
    renderTabDesc(container);
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
      + '<div class="ps-tab-desc" id="psTabDesc"></div>'
      + '<div class="ps-list" id="psList"><div class="ps-hint">불러오는 중...</div></div>'
      + '<div class="ps-detail" id="psDetail" hidden></div>';
  }

  // 목록이 비어 있어도(70점 넘는 종목이 없어도) 이 패턴이 뭘 찾는 건지는 항상 보이게 한다.
  function renderTabDesc(container) {
    var box = container.querySelector('#psTabDesc');
    if (!box) return;
    var tab = TABS.filter(function (t) { return t.key === activeTab; })[0];
    box.textContent = tab ? tab.desc : '';
  }

  function wireTabs(container) {
    container.querySelectorAll('.ps-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeTab = btn.getAttribute('data-tab');
        renderTabDesc(container);
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
        + '<div class="ps-item-top">' + patternIcon(activeTab)
        + '<span class="ps-name">' + escapeHtml(it.name) + '<span class="ps-code">(' + escapeHtml(it.code) + ')</span></span>'
        + '</div>'
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
    detail.innerHTML = '<div class="ps-loading"><div class="ps-spinner"></div><div>' + escapeHtml(item.name) + ' 차트를 불러오는 중...</div></div>';
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    PatternScan.fetchJson(GAS_TICKER_URL + '?patternChart=1&code=' + encodeURIComponent(item.code) + '&pattern=' + encodeURIComponent(activeTab))
      .then(function (data) {
        if (data.error || !data.daily || !data.daily.length) {
          detail.innerHTML = '<div class="ps-error">' + escapeHtml((data && data.message) || '차트를 불러오지 못했어요.') + '</div>';
          return;
        }
        // 리스트는 하루 1회 스캔 캐시라서, 클릭 시 실시간 재검증에서 패턴이 더 이상
        // 안 잡힐 수 있음(그 사이 가격이 움직여서) - 이 경우 깨진 결과를 보여주는 대신
        // 목록에서 바로 빼서 다음에 같은 종목을 다시 클릭하지 않게 한다.
        if (!data.detail) {
          closeDetail(container);
          removeStaleItem(container, item);
          return;
        }
        renderDetail(detail, item, data);
      })
      .catch(function () {
        detail.innerHTML = '<div class="ps-error">차트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // 재검증 결과 조건을 더 이상 만족하지 않는 종목을 현재 탭 목록에서 제거하고
  // 왜 사라졌는지 잠깐 안내한다. GAS의 하루 1회 스캔 캐시 자체는 건드리지 않으므로
  // 페이지를 새로고침하면 다음 재스캔 전까지는 다시 나타날 수 있다.
  function removeStaleItem(container, item) {
    if (scanData && scanData.patterns && scanData.patterns[activeTab]) {
      scanData.patterns[activeTab] = scanData.patterns[activeTab].filter(function (x) {
        return x.code !== item.code;
      });
    }
    renderList(container);
    showToast(container, '⚠️ ' + escapeHtml(item.name) + eunNeun(item.name) + ' 스캔 이후 가격이 움직여서 더 이상 패턴 조건을 만족하지 않아 목록에서 제외했어요.');
  }

  // 종목명 마지막 글자에 받침이 있으면 "은", 없으면 "는" (한글 완성형 유니코드 오프셋 기준).
  function eunNeun(name) {
    var ch = String(name || '').trim().slice(-1);
    var code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return '는';
    return code % 28 === 0 ? '는' : '은';
  }

  function showToast(container, html) {
    var list = container.querySelector('#psList');
    if (!list) return;
    var toast = document.createElement('div');
    toast.className = 'ps-toast';
    toast.innerHTML = html;
    list.parentNode.insertBefore(toast, list);
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 5000);
  }

  function closeDetail(container) {
    var detail = container.querySelector('#psDetail');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; destroyPsChart(); }
  }

  function renderDetail(box, item, data) {
    var html = '<div class="ps-detail-head">'
      + '<span class="ps-detail-name">' + escapeHtml(item.name) + ' <span class="ps-code">(' + escapeHtml(item.code) + ')</span></span>'
      + '<button type="button" class="ps-close" id="psClose">닫기 ✕</button>'
      + '</div>';
    html += buildScoreBox(data.detail);
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psIchimokuToggle"' + (psIchimokuEnabled ? ' checked' : '') + ' /> 일목균형표(구름) 표시</label>';
    html += buildIchimokuLegend();
    html += '<div class="ps-chart" id="psChart" style="height:' + CHART_H + 'px"></div>';
    html += '<div class="ps-footnote">※ 패턴 판정은 최근 ' + data.daily.length + '영업일 기준 참고 지표이며, 아직 저항선/넥라인을 못 뚫은 "형성 중" 패턴만 표시됩니다. <b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>';
    box.innerHTML = html;

    var closeBtn = box.querySelector('#psClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { destroyPsChart(); box.hidden = true; box.innerHTML = ''; });

    var ichiToggle = box.querySelector('#psIchimokuToggle');
    var ichiLegend = box.querySelector('.ps-ichimoku-legend');
    if (ichiLegend) ichiLegend.hidden = !psIchimokuEnabled;
    if (ichiToggle) {
      ichiToggle.addEventListener('change', function () {
        psIchimokuEnabled = ichiToggle.checked;
        if (ichiLegend) ichiLegend.hidden = !psIchimokuEnabled;
        if (psIchimokuEnabled) addIchimokuOverlay(data.daily); else removeIchimokuOverlay();
      });
    }

    var chartContainer = box.querySelector('#psChart');
    if (chartContainer) renderPatternChart(chartContainer, data.daily, data.pattern, data.detail);
  }

  // 일목균형표는 패턴별 오버레이(지지/저항/스윙 dot)와 별개의 보조지표라 기본은 꺼둔 채
  // 체크박스로 켤 수 있게 한다(js/foreign-flow.js와 같은 색상 배정 - 사이트 전체 일관성).
  var psIchimokuEnabled = false;

  function buildIchimokuLegend() {
    return '<div class="ps-ichimoku-legend"' + (psIchimokuEnabled ? '' : ' hidden') + '>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.tenkan + '"></i>전환선(9)</span>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.kijun + '"></i>기준선(26)</span>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.senkouA + '"></i>선행스팬1</span>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.senkouB + '"></i>선행스팬2</span>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.chikou + '"></i>후행스팬</span>'
      + '</div>';
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

  // ---- 캔들차트 (TradingView Lightweight Charts, CDN 지연 로드) ----

  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var lwcLoadPromise = null;
  var psLwcChart = null;         // 현재 렌더된 차트 인스턴스(재조회/닫기 시 정리용)
  var psLwcThemeObserver = null; // html.dark 토글에 맞춰 차트 색상 실시간 갱신

  function loadLightweightCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcLoadPromise) return lwcLoadPromise;
    lwcLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LWC_CDN;
      s.onload = function () { resolve(global.LightweightCharts); };
      s.onerror = function () { lwcLoadPromise = null; reject(new Error('차트 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return lwcLoadPromise;
  }

  function destroyPsChart() {
    if (psLwcThemeObserver) { psLwcThemeObserver.disconnect(); psLwcThemeObserver = null; }
    if (psLwcChart) {
      try { psLwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
      psLwcChart = null;
    }
    psIchimokuSeries = []; // chart.remove()가 시리즈까지 다 정리하므로 참조만 비움
  }

  // ---- 일목균형표(구름) ----
  // js/foreign-flow.js의 computeIchimoku와 완전히 동일한 계산(전환선9/기준선26/선행스팬B52/
  // 26영업일 이동) - 두 페이지가 같은 종목에서 다른 구름을 보여주면 안 되므로 로직을 그대로 옮김.
  // TODO: 선행스팬1·2 "사이"를 실제로 채워 칠하는 것(진짜 구름 음영)은 Lightweight Charts v4가
  // 지원하지 않아(두 시리즈 사이 채우기 불가) 선 5개만 그린다 - js/foreign-flow.js에도 동일한
  // TODO가 있고, v5 업그레이드+커스텀 플러그인이 필요해 사이트 전체 차트 회귀테스트가 걸려
  // 보류 중(2026-07-16 사용자 결정, git history 참고).
  function ichimokuPeriodMid(daily, i, period) {
    var start = i - period + 1;
    if (start < 0) return null;
    var hi = -Infinity, lo = Infinity;
    for (var k = start; k <= i; k++) {
      if (daily[k].high > hi) hi = daily[k].high;
      if (daily[k].low < lo) lo = daily[k].low;
    }
    return (hi + lo) / 2;
  }

  function nextBusinessDates(lastDate, count) {
    var d = new Date(lastDate + 'T00:00:00');
    var out = [];
    while (out.length < count) {
      d.setDate(d.getDate() + 1);
      var dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function computeIchimoku(daily) {
    var n = daily.length;
    var tenkan = new Array(n).fill(null);
    var kijun = new Array(n).fill(null);
    for (var i = 0; i < n; i++) {
      tenkan[i] = ichimokuPeriodMid(daily, i, ICHIMOKU_TENKAN_PERIOD);
      kijun[i] = ichimokuPeriodMid(daily, i, ICHIMOKU_KIJUN_PERIOD);
    }
    var futureDates = nextBusinessDates(daily[n - 1].date, ICHIMOKU_DISPLACEMENT);
    function timeAt(idx) { return idx < n ? daily[idx].date : futureDates[idx - n]; }

    var tenkanPts = [], kijunPts = [], senkouAPts = [], senkouBPts = [], chikouPts = [];
    for (var j = 0; j < n; j++) {
      if (tenkan[j] != null) tenkanPts.push({ time: daily[j].date, value: tenkan[j] });
      if (kijun[j] != null) kijunPts.push({ time: daily[j].date, value: kijun[j] });
      if (tenkan[j] != null && kijun[j] != null) {
        senkouAPts.push({ time: timeAt(j + ICHIMOKU_DISPLACEMENT), value: (tenkan[j] + kijun[j]) / 2 });
      }
      var spanB = ichimokuPeriodMid(daily, j, ICHIMOKU_SENKOU_B_PERIOD);
      if (spanB != null) senkouBPts.push({ time: timeAt(j + ICHIMOKU_DISPLACEMENT), value: spanB });
      var laggingIdx = j - ICHIMOKU_DISPLACEMENT;
      if (laggingIdx >= 0) chikouPts.push({ time: daily[laggingIdx].date, value: daily[j].close });
    }
    return { tenkan: tenkanPts, kijun: kijunPts, senkouA: senkouAPts, senkouB: senkouBPts, chikou: chikouPts };
  }

  var psIchimokuSeries = []; // 토글 off 시 이 시리즈들만 골라 제거(캔들/MA/패턴선은 유지)

  function addIchimokuOverlay(daily) {
    if (!psLwcChart || psIchimokuSeries.length || !daily || daily.length < ICHIMOKU_SENKOU_B_PERIOD) return;
    var ichi = computeIchimoku(daily);
    [['tenkan', ichi.tenkan], ['kijun', ichi.kijun], ['senkouA', ichi.senkouA], ['senkouB', ichi.senkouB], ['chikou', ichi.chikou]].forEach(function (pair) {
      var key = pair[0], pts = pair[1];
      if (!pts.length) return;
      var series = psLwcChart.addLineSeries({ color: ICHIMOKU_COLORS[key], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      series.setData(pts);
      psIchimokuSeries.push(series);
    });
  }

  function removeIchimokuOverlay() {
    if (psLwcChart) {
      psIchimokuSeries.forEach(function (s) { try { psLwcChart.removeSeries(s); } catch (e) { /* 이미 제거됐으면 무시 */ } });
    }
    psIchimokuSeries = [];
  }

  function psThemeOptions() {
    var dark = document.documentElement.classList.contains('dark');
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(사용자가 나중에 문서 만들 예정, 아직 미작성).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  // 실제 트레이딩뷰 엔진으로 캔들 + MA(눌림목만) + 패턴 오버레이를 렌더링.
  // 가로 스크롤 없이 컨테이너 폭에 autoSize로 맞춰 한눈에 들어오게 한다.
  function renderPatternChart(container, daily, pattern, detail) {
    destroyPsChart();
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return; // 로딩 중 다른 종목/탭으로 이동했으면 중단

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: CHART_H,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: false, secondsVisible: false },
        localization: { priceFormatter: psChartPriceFormatter }
      }, psThemeOptions()));
      psLwcChart = chart;

      var candleSeries = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      candleSeries.setData(daily.map(function (d) {
        return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
      }));

      // 눌림목: 20일선/60일선 중 어디 근처에서 지지받는지 눈으로 보여주기 위해 둘 다 그림(선 색 구분)
      if (pattern === 'pullback') {
        addMaLine(chart, daily, 20, MA20_COLOR);
        addMaLine(chart, daily, 60, MA60_COLOR);
      }

      addPatternOverlay(LWC, chart, candleSeries, daily, pattern, detail);

      if (psIchimokuEnabled) addIchimokuOverlay(daily);

      chart.timeScale().fitContent();

      psLwcThemeObserver = new MutationObserver(function () {
        chart.applyOptions(psThemeOptions());
      });
      psLwcThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }).catch(function () {
      container.innerHTML = '<div class="ps-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // 종가 N일 이동평균선을 라인 시리즈로 그림(눌림목 전용)
  function addMaLine(chart, daily, period, color) {
    var pts = [];
    var sum = 0;
    for (var i = 0; i < daily.length; i++) {
      sum += daily[i].close;
      if (i >= period) sum -= daily[i - period].close;
      if (i >= period - 1) pts.push({ time: daily[i].date, value: sum / period });
    }
    if (pts.length < 2) return;
    chart.addLineSeries({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(pts);
  }

  // 패턴별 지지/저항선 + 스윙 포인트 dot + 확인(signal) 지점을 라인 시리즈/마커로 오버레이.
  // (예전 SVG 버전의 polyline/hline/dot/signalRing을 Lightweight Charts 프리미티브로 대체)
  function addPatternOverlay(LWC, chart, candleSeries, daily, pattern, detail) {
    if (!detail) return;
    var markers = [];

    function idxByDate(date) {
      for (var i = 0; i < daily.length; i++) if (daily[i].date === date) return i;
      return -1;
    }
    // 여러 점을 순서대로 잇는 선(쌍바닥/역헤드앤숄더의 실제 굴곡을 그대로 표현하기 위함).
    // opts.bold를 주면 굵은 실선으로 그려서 패턴 모양(W자 등)이 한눈에 보이게 강조한다.
    function addLine(points, color, opts) {
      var data = (points || []).filter(function (p) { return p && idxByDate(p.date) >= 0; })
        .map(function (p) { return { time: p.date, value: p.price }; });
      if (data.length < 2) return;
      var o = opts || {};
      chart.addLineSeries({
        color: color,
        lineWidth: o.bold ? 3 : 2,
        lineStyle: o.bold ? LWC.LineStyle.Solid : LWC.LineStyle.Dashed,
        priceLineVisible: false, lastValueVisible: false
      }).setData(data);
    }
    // fromDate를 주면 그 지점부터 마지막 캔들까지만 수평선을 그림(패턴 구간만 강조, 전체 폭 X)
    function addHLine(price, fromDate, color) {
      var fromIdx = fromDate ? idxByDate(fromDate) : -1;
      if (fromIdx < 0) fromIdx = 0;
      var lastDate = daily[daily.length - 1].date;
      addLine([{ date: daily[fromIdx].date, price: price }, { date: lastDate, price: price }], color);
    }
    function addDot(p, color, position, size) {
      if (!p || idxByDate(p.date) < 0) return;
      markers.push({ time: p.date, position: position, color: color, shape: 'circle', size: size || 1 });
    }
    // 확인/매수 검토 지점 강조 (참고 이미지의 핑크색 원 컨벤션)
    function addSignal(p) {
      if (!p || idxByDate(p.date) < 0) return;
      markers.push({ time: p.date, position: 'inBar', color: SIGNAL_COLOR, shape: 'circle' });
    }

    if (pattern === 'risingLows') {
      // low_swings_display는 마지막 스윙 저점 뒤에 "오늘"(현재가)까지 이어붙인 배열 -
      // 패턴이 이미 끝난 게 아니라 지금도 진행 중임을 보여주기 위함
      var lows = detail.low_swings_display || detail.low_swings || [];
      var highs = detail.high_swings || [];
      addLine(lows, SUPPORT_COLOR);
      addLine(highs, RESIST_COLOR);
      (detail.low_swings || []).forEach(function (p) { addDot(p, SUPPORT_COLOR, 'belowBar'); });
      highs.forEach(function (p) { addDot(p, RESIST_COLOR, 'aboveBar'); });
      if (detail.signal) addSignal(detail.signal); // 오늘(현재가) - 항상 최근 봉 기준
    } else if (pattern === 'doubleBottom') {
      // 왼쪽 고점(leftPeak) -> 저점1 -> 넥라인(중간 반등 고점) -> 저점2 -> 현재가 순서로 이어야
      // 위-아래-위-아래-위, 진짜 W자 모양이 나온다(leftPeak 없으면 저점1부터 시작 - 예전과 동일).
      // 굵은 실선 + 큰 점으로 그려서 눈으로 W 모양이 바로 보이게 강조.
      if (detail.low1 && detail.neckline && detail.low2) {
        var dbPoints = [];
        if (detail.leftPeak) dbPoints.push(detail.leftPeak);
        dbPoints.push(detail.low1, detail.neckline, detail.low2);
        if (detail.current) dbPoints.push(detail.current);
        addLine(dbPoints, SUPPORT_COLOR, { bold: true });
        addHLine(detail.neckline.price, detail.low1.date, RESIST_COLOR);
        addDot(detail.low1, SUPPORT_COLOR, 'belowBar', 1.8);
        addDot(detail.low2, SUPPORT_COLOR, 'belowBar', 1.8);
        addDot(detail.neckline, RESIST_COLOR, 'aboveBar', 1.5);
        if (detail.signal) addSignal(detail.signal);
      }
    } else if (pattern === 'invHeadShoulders') {
      // 좌어깨 -> 좌고점 -> 헤드 -> 우고점 -> 우어깨 -> 현재가 순서로 이어 봉우리 2개 + 최근 흐름까지 표현
      var seq = [detail.left_shoulder, detail.left_peak, detail.head, detail.right_peak, detail.right_shoulder];
      if (seq.every(function (p) { return !!p; })) {
        if (detail.current) seq.push(detail.current);
        addLine(seq, SUPPORT_COLOR);
        addHLine(detail.neckline.price, detail.left_shoulder.date, RESIST_COLOR);
        ['left_shoulder', 'head', 'right_shoulder'].forEach(function (k) { addDot(detail[k], SUPPORT_COLOR, 'belowBar'); });
        addDot(detail.neckline, RESIST_COLOR, 'aboveBar');
        if (detail.signal) addSignal(detail.signal);
      }
    } else if (pattern === 'boxRangeLow') {
      var boxLows = detail.low_swings || [];
      var boxHighs = detail.high_swings || [];
      if (detail.support != null) addHLine(detail.support, boxLows[0] && boxLows[0].date, SUPPORT_COLOR);
      if (detail.resistance != null) addHLine(detail.resistance, boxHighs[0] && boxHighs[0].date, RESIST_COLOR);
      boxLows.forEach(function (p) { addDot(p, SUPPORT_COLOR, 'belowBar'); });
      boxHighs.forEach(function (p) { addDot(p, RESIST_COLOR, 'aboveBar'); });
      if (detail.signal) addSignal(detail.signal); // 현재가(박스 하단 근접 지점)
    } else if (pattern === 'pullback') {
      // 상승 시작(저점) -> 고점 -> 현재가(조정 중) 순서로 이어 "얼마나 올랐다가 얼마나
      // 눌렸는지"를 한눈에 보여준다. 이평선은 addMaLine으로 배경에 이미 그림.
      if (detail.rise_start && detail.peak && detail.current) {
        addLine([detail.rise_start, detail.peak, detail.current], SUPPORT_COLOR);
        addDot(detail.rise_start, SUPPORT_COLOR, 'belowBar');
        addDot(detail.peak, RESIST_COLOR, 'aboveBar');
        addSignal(detail.current);
      }
    }

    if (markers.length) candleSeries.setMarkers(markers);
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
  // 캔들차트 축·크로스헤어·패턴선에 표시되는 가격에 천단위 콤마(원화는 소수점 없음)
  function psChartPriceFormatter(v) { return v == null || isNaN(v) ? '' : Math.round(v).toLocaleString(); }

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
