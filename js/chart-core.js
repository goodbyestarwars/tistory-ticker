/**
 * 차트 공통 엔진(2026-10-14) - 차트검색·실시간 시세(js/stock-search.js)와 종목분석(js/foreign-flow.js)이 같이 쓴다.
 *
 * 여기에 두는 것(한 곳에서만 구현): 라이브러리(Lightweight Charts) 1회 로드, 보조 모듈 지연 로드, 테마·옵션,
 * 리소스 정리 범위(scope), 공용 ResizeObserver·다크모드 감시자, 이동평균·캔들·거래량 시리즈 생성, 일목균형표 계산·구름,
 * 날짜·가격 서식. 화면마다 차트 인스턴스는 따로 만들고(상태 공유 없음) 이 파일의 함수·자원 관리 방식만 공유한다.
 *
 * 화면 전용 기능(RSI 패널·수급 패널·매물대 막대·범례 배치 등)은 각 화면에 그대로 두고, 이 엔진의 부품을 호출해 붙인다.
 * 보조 모듈 목록: chart-data(데이터·캐시) / chart-drawing(수동 드로잉·오버레이 층) / chart-wave-overlay(자동 파동)
 *                / chart-sr(지지·저항) / chart-memo(메모).
 */
(function (global) {
  'use strict';

  var VERSION = '2026-10-21-summary-ui-9';
  var LWC_URL = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var CANDLE_UP = '#d24f45';       // 상승 빨강
  var CANDLE_DOWN = '#1261c4';     // 하락 파랑
  var ICHIMOKU_CLOUD_FILL = 'rgba(90,170,215,0.4)';
  var ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)';
  var ICHIMOKU = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };
  // group: 화면의 이동평균선 옵션 두 개(단기 3·5·20·60 / 장기 112·224·448). legacy: 그룹을 주지 않는 옛 호출(지수 차트 등)이 쓰는 4개.
  var MA_STUDIES = [
    { key: 'ma3', period: 3, color: '#f08c00', width: 1, group: 'short' },
    { key: 'ma5', period: 5, color: '#d24f45', width: 1, group: 'short', legacy: true },
    { key: 'ma20', period: 20, color: '#1261c4', width: 1, group: 'short', legacy: true },
    { key: 'ma60', period: 60, color: '#0ca678', width: 1, group: 'short', legacy: true },
    { key: 'ma112', period: 112, color: '#7048e8', width: 1.5, group: 'long' },
    { key: 'ma224', period: 224, color: null, width: 3, group: 'long', legacy: true },   // 224일선은 테마에 따라 검정/밝은 회색(굵게)
    { key: 'ma448', period: 448, color: '#6b7280', width: 2, group: 'long' }
  ];

  // ---- 자산 주소(이 스크립트가 실제로 내려온 곳 기준 - 운영은 GitHub Pages, 로컬 점검은 로컬 서버) ----
  var DOC = typeof document !== 'undefined' ? document : null;
  var SELF_SRC = (DOC && DOC.currentScript && DOC.currentScript.src) || '';
  var ROOT = (SELF_SRC.match(/^(.*\/)js\/chart-core\.js/) || [])[1] || 'https://goodbyestarwars.github.io/tistory-ticker/';
  var MODULES = {
    data: { file: 'js/chart-data.js', global: 'NineChartData', v: '20261022-order1' },
    drawing: { file: 'js/chart-drawing.js', global: 'NineChartDrawing', v: '20261022-hline-preview' },
    wave: { file: 'js/chart-wave-overlay.js', global: 'NineChartWave', v: '20261022-trend2', needs: ['data', 'autowave'] },
    divergence: { file: 'js/chart-divergence.js', global: 'NineChartDivergence', v: '20261022-div1', needs: ['wave'] },
    autowave: { file: 'js/auto-wave.js', global: 'AutoWave', v: '20261013-hier' },
    memo: { file: 'js/chart-memo.js', global: 'NineChartMemo', v: '' },
    sr: { file: 'js/chart-sr.js', global: 'NineChartSR', v: '20261021-sr-strength2' },
    vp: { file: 'js/volume-profile-analysis.js', global: 'NineVolumeProfile', v: '20261019-vp1' }
  };

  // ---- 라이브러리·모듈 로드: 페이지당 한 번(여러 화면·여러 호출자가 동시에 불러도 같은 약속을 돌려준다) ----
  var loads = global.__nineChartLoads = global.__nineChartLoads || {};

  function injectScript(url, mark) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.setAttribute('data-nine-chart', mark);
      s.onload = function () { resolve(); };
      s.onerror = function () { s.remove(); reject(new Error('load failed: ' + mark)); };
      document.head.appendChild(s);
    });
  }

  function loadLibrary() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (loads.lwc) return loads.lwc;
    // 다른 모듈(시장지표 탭 등)이 이미 같은 라이브러리 태그를 넣었으면 새로 받지 않고 그 로드를 기다린다.
    var existing = document.querySelector('script[src*="lightweight-charts"]');
    loads.lwc = new Promise(function (resolve, reject) {
      function done() { global.LightweightCharts ? resolve(global.LightweightCharts) : fallback(); }
      function fallback() {
        injectScript(LWC_URL, 'lwc').then(function () { resolve(global.LightweightCharts); }, function (e) { loads.lwc = null; reject(e); });
      }
      if (existing) {
        existing.addEventListener('load', done);
        existing.addEventListener('error', fallback);
        // 이미 끝난 태그라면 이벤트가 안 오므로 한 번 확인한다
        if (global.LightweightCharts) done();
      } else fallback();
    });
    return loads.lwc;
  }

  function moduleUrl(name) {
    var m = MODULES[name];
    return ROOT + m.file + (m.v ? '?v=' + m.v : '');
  }

  function loadModule(name) {
    var m = MODULES[name];
    if (!m) return Promise.reject(new Error('unknown chart module: ' + name));
    if (global[m.global]) return Promise.resolve(global[m.global]);
    if (loads[name]) return loads[name];
    var pre = (m.needs || []).map(loadModule);
    loads[name] = Promise.all(pre).then(function () {
      var tag = document.querySelector('script[data-nine-chart="' + name + '"], script[data-auto-wave-module]');
      if (name === 'autowave' && tag && !global[m.global]) {
        return new Promise(function (resolve, reject) { tag.addEventListener('load', resolve); tag.addEventListener('error', reject); });
      }
      return injectScript(moduleUrl(name), name);
    }).then(function () { return global[m.global]; }).catch(function (e) { loads[name] = null; throw e; });
    return loads[name];
  }

  // 라이브러리 + 필요한 모듈을 한 번에. 차트 인스턴스는 만들지 않는다(모두 받은 뒤에만 화면이 만든다).
  function ready(names) {
    return Promise.all([loadLibrary()].concat((names || []).map(loadModule)));
  }

  // 차트를 곧 열 가능성이 큰 시점(검색 결과가 그려진 직후 등)에 한가한 틈에 미리 받아 둔다.
  function prefetch(names) {
    var run = function () { ready(names).catch(function () { /* 실제로 열 때 다시 시도하고 오류를 보여 준다 */ }); };
    if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(run, { timeout: 2000 });
    else global.setTimeout(run, 200);
  }

  // ---- 테마·옵션 ----
  function isDark() { return document.documentElement.classList.contains('dark'); }

  function themeColors(dark) {
    return {
      text: dark ? '#a6b5c5' : '#555', grid: dark ? '#37424e' : '#eee', border: dark ? '#37424e' : '#ddd',
      paneSep: dark ? '#37424e' : '#e5e7eb', paneSepHover: dark ? '#4b5b70' : '#cbd5e1', label: dark ? '#3a4d65' : '#555'
    };
  }

  // 화면별 차이는 profile 로 둔다(같은 부품, 다른 설정). 기본값은 지금 화면들이 쓰던 값 그대로다.
  //   search  - 차트검색·실시간 시세: 본문 글꼴, 패널 구분선 고정, 캔들 아래 여백 8%, 분봉이면 시:분 표시
  //   analysis - 종목분석: 패널 구분선 드래그, 캔들 아래 여백 36%, 최소 봉 간격 2
  var PROFILES = {
    search: {
      font: true, enableResize: true, margins: { top: 0.06, bottom: 0.08 },
      timeScale: function (tf) { return { rightOffset: 6, minBarSpacing: 0.1, timeVisible: tf === 'minute', secondsVisible: false, barSpacing: tf === 'minute' ? 9 : 7 }; },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    },
    analysis: {
      font: true, enableResize: true, margins: { top: 0.06, bottom: 0.36 },
      timeScale: function () { return { rightOffset: 6, minBarSpacing: 0.1, lockVisibleTimeRangeOnResize:true, timeVisible: false, secondsVisible: false }; },
      handleScroll: null,
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
    }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Lightweight Charts 옵션 전체(테마 + 화면 기본). opts: { dark, timeframe, fontFamily, width, height, autoSize }
  function chartOptions(LWC, profileName, opts) {
    opts = opts || {};
    var p = PROFILES[profileName] || PROFILES.search;
    var c = themeColors(opts.dark != null ? opts.dark : isDark());
    var layout = {
      background: { color: 'transparent' }, textColor: c.text, attributionLogo: false,
      panes: { enableResize: p.enableResize, separatorColor: c.paneSep, separatorHoverColor: c.paneSepHover }
    };
    layout.fontFamily = opts.fontFamily || 'Pretendard Variable, Pretendard, Malgun Gothic, sans-serif';
    var timeScale = p.timeScale(opts.timeframe);
    timeScale.borderColor = c.border;
    var out = {
      layout: layout,
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: p.margins.top, bottom: p.margins.bottom }, alignLabels: false },
      timeScale: timeScale,
      // 다크모드에서 십자선 라벨 배경이 라이브러리 기본 회색으로 남지 않게 테마에 맞춰 명시한다(2026-07-28 제보).
      crosshair: { mode: LWC.CrosshairMode.Normal, vertLine: { labelBackgroundColor: c.label }, horzLine: { labelBackgroundColor: c.label } },
      localization: { locale: 'ko-KR' },
      handleScale: clone(p.handleScale)   // 라이브러리가 넘긴 옵션 객체를 제자리에서 바꾸므로 공유 객체를 그대로 주지 않는다
    };
    if (p.handleScroll) out.handleScroll = clone(p.handleScroll);
    if (opts.autoSize != null) out.autoSize = opts.autoSize;
    if (opts.width != null) out.width = opts.width;
    if (opts.height != null) out.height = opts.height;
    return out;
  }

  // 다크모드 전환 때 다시 입힐 옵션(생성 옵션 중 색에 해당하는 것만)
  function themeUpdateOptions(LWC, profileName, opts) {
    var full = chartOptions(LWC, profileName, opts);
    return { layout: full.layout, grid: full.grid, rightPriceScale: { borderColor: full.rightPriceScale.borderColor }, timeScale: { borderColor: full.timeScale.borderColor }, crosshair: full.crosshair };
  }

  function ma224Color(dark) { return (dark != null ? dark : isDark()) ? '#f1f3f5' : '#000000'; }

  // 공용 다크모드 감시자: 페이지에 하나만 두고 html.dark 가 실제로 바뀔 때만 구독자를 부른다.
  var themeWatch = { observer: null, last: null, subs: [] };
  function onThemeChange(fn) {
    if (!themeWatch.observer && typeof global.MutationObserver === 'function') {
      themeWatch.last = isDark();
      themeWatch.observer = new global.MutationObserver(function () {
        var now = isDark();
        if (now === themeWatch.last) return;
        themeWatch.last = now;
        themeWatch.subs.slice().forEach(function (f) { try { f(now); } catch (e) { /* 한 구독자의 오류가 다른 차트를 막지 않게 */ } });
      });
      themeWatch.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    themeWatch.subs.push(fn);
    return function () {
      var i = themeWatch.subs.indexOf(fn);
      if (i >= 0) themeWatch.subs.splice(i, 1);
      if (!themeWatch.subs.length && themeWatch.observer) { themeWatch.observer.disconnect(); themeWatch.observer = null; }
    };
  }

  // 공용 ResizeObserver: 여러 차트·오버레이가 같은 관찰자 하나를 나눠 쓰고, 구독이 없어지면 해제한다.
  var resizeWatch = { ro: null, map: typeof Map === 'function' ? new Map() : null };
  function observeResize(el, fn) {
    if (!el || !resizeWatch.map || typeof global.ResizeObserver !== 'function') {
      global.addEventListener('resize', fn);
      return function () { global.removeEventListener('resize', fn); };
    }
    if (!resizeWatch.ro) {
      resizeWatch.ro = new global.ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var set = resizeWatch.map.get(entry.target);
          if (set) set.slice().forEach(function (f) { try { f(entry); } catch (e) { /* 다른 구독자 보호 */ } });
        });
      });
    }
    var list = resizeWatch.map.get(el);
    if (!list) { list = []; resizeWatch.map.set(el, list); resizeWatch.ro.observe(el); }
    list.push(fn);
    return function () {
      var cur = resizeWatch.map.get(el);
      if (!cur) return;
      var i = cur.indexOf(fn);
      if (i >= 0) cur.splice(i, 1);
      if (!cur.length) {
        resizeWatch.map.delete(el);
        if (resizeWatch.ro) resizeWatch.ro.unobserve(el);
        if (!resizeWatch.map.size && resizeWatch.ro) { resizeWatch.ro.disconnect(); resizeWatch.ro = null; }
      }
    };
  }

  // ---- 리소스 정리 범위: 차트 하나가 만든 이벤트·타이머·프레임·구독·캔버스를 한 번에 해제 ----
  function createScope(name) {
    var disposers = [], disposed = false;
    var scope = {
      name: name || '', get disposed() { return disposed; },
      add: function (fn) {
        if (typeof fn !== 'function') return fn;
        if (disposed) { try { fn(); } catch (e) { /* 이미 정리된 범위 */ } return fn; }
        disposers.push(fn);
        return fn;
      },
      on: function (target, type, fn, opts) {
        if (!target || !target.addEventListener) return;
        target.addEventListener(type, fn, opts);
        scope.add(function () { target.removeEventListener(type, fn, opts); });
      },
      timeout: function (fn, ms) {
        var id = global.setTimeout(function () { fn(); }, ms);
        scope.add(function () { global.clearTimeout(id); });
        return id;
      },
      frame: function (fn) {
        var id = global.requestAnimationFrame(fn);
        scope.add(function () { global.cancelAnimationFrame(id); });
        return id;
      },
      resize: function (el, fn) { var off = observeResize(el, fn); scope.add(off); return off; },
      theme: function (fn) { var off = onThemeChange(fn); scope.add(off); return off; },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        var list = disposers; disposers = [];
        for (var i = list.length - 1; i >= 0; i--) { try { list[i](); } catch (e) { /* 하나가 실패해도 나머지는 정리한다 */ } }
      }
    };
    return scope;
  }

  // 화면마다 생성한 차트 인스턴스를 같은 시간축 조작 버튼에서 찾는다.
  // 재렌더 시 이전 인스턴스의 정리 함수가 새 차트를 지우지 않도록 동일성 확인.
  var chartInstances = typeof WeakMap === 'function' ? new WeakMap() : null;
  function registerChart(container, chart, options) {
    if (!chartInstances || !container || !chart) return function () {};
    var record = { chart: chart, bars: options && Number(options.bars) || 0, timeframe: options && options.timeframe || 'day' };
    chartInstances.set(container, record);
    return function () { var current = chartInstances.get(container); if (current && current.chart === chart) chartInstances.delete(container); };
  }
  function zoomBars(container, factor) {
    var record = chartInstances && chartInstances.get(container), chart = record && record.chart;
    if (!chart || !isFinite(factor) || factor <= 0) return false;
    var scale = chart.timeScale(), visible = scale.getVisibleLogicalRange();
    if (!visible) return false;
    var center = (visible.from + visible.to) / 2;
    var count = Math.min(2000, Math.max(12, (visible.to - visible.from) * factor));
    scale.setVisibleLogicalRange({ from: center - count / 2, to: center + count / 2 });
    return true;
  }
  function fitBars(container, years) {
    var record = chartInstances && chartInstances.get(container), chart = record && record.chart;
    if (!chart) return false;
    var timeframe = record.timeframe, barsPerYear = timeframe === 'week' ? 52 : timeframe === 'month' ? 12 : timeframe === 'minute' ? 0 : 252;
    var wanted = barsPerYear && Number(years) > 0 ? Math.round(barsPerYear * Number(years)) : record.bars;
    var count = Math.min(record.bars || wanted, wanted || record.bars);
    if (count > 1) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, record.bars - count), to: record.bars - 1 + 3 });
    else chart.timeScale().fitContent();
    return true;
  }

  // ---- 마우스 휠: 커서 아래 봉을 유지하며 rAF마다 점진 확대·축소 ----
  // 설치한 화면에서만 라이브러리 기본 wheel scale/scroll을 비활성화한다.
  // 드래그·핀치·가격축·보조지표·작도는 별도 기본 이벤트를 계속 사용한다.
  function installSmoothWheelZoom(chart, element, opts) {
    if (!chart || !chart.timeScale || !element || !element.addEventListener) return function () {};
    opts = opts || {};
    var scale = chart.timeScale();
    var total = Math.max(1, Number(opts.bars) || 250);
    var edge = 12, minSpan = 12;
    var leftLimit = -edge, rightLimit = total - 1 + edge;
    var maxSpan = Math.max(minSpan, Math.min(2000, rightLimit - leftLimit));
    var target = null, frame = 0, disposed = false;
    var lastFrameTime = null, lastDirection = 0, lastGesture = null;
    // 네이버·토스처럼(2026-10-22): 휠을 빠르게 돌리면 점점 더 크게 움직이고(가속), 최신 봉 근처에서 확대하면 최신 봉을 오른쪽에 붙여 둔다.
    // 드래그로 밀다 놓으면 관성으로 조금 더 미끄러진다.
    var lastWheelAt = 0, streak = 0;
    var drag = null, inertia = null, inertiaFrame = 0, ignoreRange = false;

    function rightMaxFor(span) { return Math.max(rightLimit, total - 1 + span * 0.75); }
    function bounded(from, span) {
      span = Math.max(minSpan, Math.min(maxSpan, span));
      var to = from + span;
      // 오른쪽은 마지막 봉 뒤 빈 공간까지 볼 수 있어야 한다(2026-10-22 사용자 요청): 마지막 봉이 화면 왼쪽 1/4까지 올 수 있게
      // 화면 폭의 75%만큼 허용한다(기존 12봉 고정이면 휠·관성이 그보다 더 간 빈 공간을 되돌려 놓았다).
      var rightMax = rightMaxFor(span);
      if (from < leftLimit) { from = leftLimit; to = from + span; }
      if (to > rightMax) { to = rightMax; from = to - span; }
      return { from: from, to: to };
    }

    function stopInertia() {
      if (inertiaFrame) global.cancelAnimationFrame(inertiaFrame);
      inertiaFrame = 0;
      inertia = null;
    }
    function stop() {
      if (frame) global.cancelAnimationFrame(frame);
      frame = 0;
      target = null;
      lastFrameTime = null;
      lastDirection = 0;
      lastGesture = null;
      streak = 0;
      lastWheelAt = 0;
      stopInertia();
    }

    function animate(timestamp) {
      frame = 0;
      if (disposed || !target) return;
      var now = scale.getVisibleLogicalRange();
      if (!now || !isFinite(now.from) || !isFinite(now.to)) { target = null; return; }
      // Use elapsed time so 60/120/144Hz displays have the same gesture response.
      var stamp = Number.isFinite(timestamp) ? timestamp : (lastFrameTime == null ? 0 : lastFrameTime + 1000 / 60);
      var elapsed = lastFrameTime == null ? 1000 / 60 : Math.max(0, Math.min(64, stamp - lastFrameTime));
      lastFrameTime = stamp;
      var alpha = 1 - Math.exp(-elapsed / 60);
      var from = now.from + (target.from - now.from) * alpha;
      var to = now.to + (target.to - now.to) * alpha;
      var done = Math.abs(target.from - from) < 0.035 && Math.abs(target.to - to) < 0.035;
      scale.setVisibleLogicalRange(done ? target : { from: from, to: to });
      if (done) { target = null; lastFrameTime = null; }
      else frame = global.requestAnimationFrame(animate);
    }

    // 오른쪽 가격축 위의 휠: 커서 가격을 기준으로 가격 범위를 늘이고 줄인다(축을 끌어 늘이는 것과 같은 결과, 라이브러리 기본 휠은 꺼 둠).
    function priceAxisWheel(event, rect) {
      var series = opts.priceSeries && opts.priceSeries();
      var ps = chart.priceScale && chart.priceScale('right');
      if (!series || !ps || !ps.getVisibleRange || !ps.setVisibleRange) return;
      var range = ps.getVisibleRange();
      if (!range || !isFinite(range.from) || !isFinite(range.to) || range.to <= range.from) return;
      var dy = Number(event.deltaY) || 0;
      if (!dy) return;
      if (event.cancelable !== false && event.preventDefault) event.preventDefault();
      var anchor = series.coordinateToPrice(event.clientY - rect.top);
      if (!isFinite(anchor)) anchor = (range.from + range.to) / 2;
      anchor = Math.max(range.from, Math.min(range.to, anchor));
      var unit = event.deltaMode === 1 ? 16 : 1;
      var f = Math.exp(Math.max(-240, Math.min(240, dy * unit)) * 0.0015);   // 위로 굴리면 확대, 아래로 굴리면 축소
      var from = anchor - (anchor - range.from) * f, to = anchor + (range.to - anchor) * f;
      if (!(to - from > 0) || !isFinite(from) || !isFinite(to)) return;
      ps.setVisibleRange({ from: from, to: to });
    }

    function onWheel(event) {
      if (disposed) return;
      if (event.target && event.target.closest && event.target.closest('button, a, input, textarea, select, [data-no-wheel-zoom]')) return;
      stopInertia();
      var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (element.clientHeight || 400) : 1;
      // 마우스 노치/고해상도 트랙패드 모두 입력 강도에 비례하도록 제한한다.
      var dx = Math.max(-240, Math.min(240, (Number(event.deltaX) || 0) * unit));
      var dy = Math.max(-240, Math.min(240, (Number(event.deltaY) || 0) * unit));
      if (!dx && !dy) return;
      var rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0 };
      var width = typeof scale.width === 'function' ? scale.width() : element.clientWidth;
      if (!(width > 0)) return;
      if (typeof event.clientX === 'number' && event.clientX > rect.left + width) { priceAxisWheel(event, rect); return; }
      var live = scale.getVisibleLogicalRange();
      if (!live || !isFinite(live.from) || !isFinite(live.to) || live.to <= live.from) return;
      if (event.cancelable !== false && event.preventDefault) event.preventDefault();

      var panning = Math.abs(dx) > Math.abs(dy) || event.shiftKey;
      var direction = Math.sign(panning ? (dx || dy) : dy);
      var gesture = panning ? 'pan' : 'zoom';
      // Reverse from the visible position immediately; discard the old momentum.
      if (target && (gesture !== lastGesture || direction !== lastDirection)) target = null;
      lastDirection = direction;
      lastGesture = gesture;
      var base = target || live;
      var span = base.to - base.from;
      if (panning) {
        // 트랙패드 가로 스크롤/Shift+휠은 시간축 좌우 이동.
        var move = (dx || dy) * span / width;
        target = bounded(base.from + move, span);
      } else {
        // 마우스 아래 논리적 봉 위치를 줌 중심으로 보존한다.
        var ratio = typeof event.clientX === 'number'
          ? Math.max(0, Math.min(1, (event.clientX - rect.left) / width)) : 0.5;
        // 최신 봉이 보이고 커서가 오른쪽 가장자리 쪽이면 오른쪽 끝을 고정해 최신 봉이 화면 밖으로 밀리지 않게 한다.
        if (live.to >= total - 1 - 0.5 && ratio > 0.8) ratio = 1;
        var anchor = live.from + ratio * (live.to - live.from);
        // 빠르게 이어 돌리면 가속(최대 1.8배), 잠깐 멈췄다 돌리면 처음 속도로 돌아간다.
        var stamp = typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : Date.now();
        streak = stamp - lastWheelAt < 120 ? Math.min(5, streak + 1) : 0;
        lastWheelAt = stamp;
        var boost = 1 + streak * 0.16;
        var nextSpan = span * Math.exp(dy * 0.0014 * boost);
        nextSpan = Math.max(minSpan, Math.min(maxSpan, nextSpan));
        target = bounded(anchor - ratio * nextSpan, nextSpan);
      }
      if (!frame) frame = global.requestAnimationFrame(animate);
    }

    // 드래그 관성: 누른 채 좌우로 밀다 놓으면 놓기 직전 속도로 조금 더 미끄러지며 감속한다(시간 폭 변화 없는 이동만).
    function onRangeChange() {
      if (!drag || ignoreRange) return;
      var r = scale.getVisibleLogicalRange();
      if (!r || !isFinite(r.from) || !isFinite(r.to)) return;
      var t = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      drag.samples.push({ t: t, from: r.from, span: r.to - r.from });
      while (drag.samples.length > 2 && t - drag.samples[0].t > 120) drag.samples.shift();
    }
    function onPointerDown(event) {
      stop();
      // Lightweight Charts already provides native touch inertia. Applying our
      // mouse momentum to touch as well causes a second glide on mobile.
      if (event && event.pointerType === 'touch') return;
      drag = { samples: [] };
    }
    function onPointerUp() {
      var d = drag;
      drag = null;
      if (!d || d.samples.length < 2 || disposed) return;
      var a = d.samples[0], b = d.samples[d.samples.length - 1];
      var dt = b.t - a.t;
      if (!(dt > 8) || Math.abs(b.span - a.span) > 0.5) return;   // 확대·축소 드래그는 관성 없음
      var v = (b.from - a.from) / dt;                              // 봉/ms
      if (!isFinite(v) || Math.abs(v) < 0.006) return;
      v = Math.max(-0.6, Math.min(0.6, v));
      inertia = { v: v, span: b.span };
      var last = null;
      function glide(timestamp) {
        inertiaFrame = 0;
        if (disposed || !inertia) return;
        var stamp = Number.isFinite(timestamp) ? timestamp : (last == null ? 0 : last + 1000 / 60);
        var elapsed = last == null ? 1000 / 60 : Math.max(0, Math.min(64, stamp - last));
        last = stamp;
        var now = scale.getVisibleLogicalRange();
        if (!now || !isFinite(now.from)) { inertia = null; return; }
        // 사용자가 이미 한도를 넘겨 끌어 둔 위치라면(라이브러리는 더 멀리 허용) 관성으로 되돌려 놓지 않고 그대로 멈춘다.
        if (now.to > rightMaxFor(inertia.span) + 1e-6 || now.from < leftLimit - 1e-6) { inertia = null; return; }
        var desired = now.from + inertia.v * elapsed;
        var next = bounded(desired, inertia.span);
        var hitEdge = Math.abs(next.from - desired) > 1e-6;   // 기록된 범위 끝에 닿으면 멈춘다
        inertia.v *= Math.exp(-elapsed / 260);
        ignoreRange = true;
        scale.setVisibleLogicalRange(next);
        ignoreRange = false;
        if (Math.abs(inertia.v) < 0.004 || hitEdge) { inertia = null; return; }
        inertiaFrame = global.requestAnimationFrame(glide);
      }
      inertiaFrame = global.requestAnimationFrame(glide);
    }
    var upTarget = global.addEventListener ? global : element;   // 요소 밖에서 놓아도 받는다
    var rangeSub = typeof scale.subscribeVisibleLogicalRangeChange === 'function';
    if (rangeSub) scale.subscribeVisibleLogicalRangeChange(onRangeChange);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown, { passive: true });
    element.addEventListener('touchstart', stop, { passive: true });
    upTarget.addEventListener('pointerup', onPointerUp, { passive: true });
    upTarget.addEventListener('pointercancel', onPointerUp, { passive: true });
    return function () {
      disposed = true;
      stop();
      if (rangeSub && typeof scale.unsubscribeVisibleLogicalRangeChange === 'function') scale.unsubscribeVisibleLogicalRangeChange(onRangeChange);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('touchstart', stop);
      upTarget.removeEventListener('pointerup', onPointerUp);
      upTarget.removeEventListener('pointercancel', onPointerUp);
    };
  }

  // ---- 데이터 보조(순수 함수) ----
  function movingAveragePoints(bars, field, period) {
    var sum = 0, points = [];
    bars.forEach(function (bar, i) {
      sum += Number(bar[field]) || 0;
      if (i >= period) sum -= Number(bars[i - period][field]) || 0;
      if (i >= period - 1) points.push({ time: bar.date, value: sum / period });
    });
    return points;
  }

  // 모집단 표준편차를 사용한다. 중심선은 기존 SMA 계산을 그대로 재사용한다.
  function bollingerPoints(bars, period, multiplier) {
    period = period || 20; multiplier = multiplier == null ? 2 : multiplier;
    var middle = movingAveragePoints(bars, 'close', period);
    var sumSquares = 0, invalid = 0, out = [];
    bars.forEach(function (bar, i) {
      var close = Number(bar.close);
      if (Number.isFinite(close) && close > 0) sumSquares += close * close;
      else invalid++;
      if (i >= period) {
        var old = Number(bars[i - period].close);
        if (Number.isFinite(old) && old > 0) sumSquares -= old * old;
        else invalid--;
      }
      if (i < period - 1 || invalid) return;
      var avg = middle[i - period + 1].value;
      var deviation = Math.sqrt(Math.max(0, sumSquares / period - avg * avg));
      if (Number.isFinite(deviation)) out.push({ time: bar.date, middle: avg, upper: avg + multiplier * deviation, lower: avg - multiplier * deviation });
    });
    return out;
  }

  function addBollingerBands(chart, LWC, bars) {
    var points = bollingerPoints(bars, 20, 2);
    if (!points.length) return [];
    var specs = [
      { key: 'upper', color: '#d9a600', width: 2 },
      { key: 'middle', color: '#e6bc30', width: 1, style: LWC.LineStyle.Dashed },
      { key: 'lower', color: '#d9a600', width: 2 }
    ];
    var series = specs.map(function (spec) {
      var line = chart.addSeries(LWC.LineSeries, {
        color: spec.color, lineWidth: spec.width, lineStyle: spec.style,
        priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false
      });
      line.setData(points.map(function (p) { return { time: p.time, value: p[spec.key] }; }));
      return line;
    });
    if (typeof series[0].attachPrimitive === 'function') {
      try { series[0].attachPrimitive(createCloudPrimitive(points.map(function (p) { return { time: p.time, a: p.upper, b: p.lower }; }), 'rgba(230,190,35,0.08)')); } catch (e) { /* 선은 유지 */ }
    }
    return series;
  }

  // Lightweight Charts는 본문 세로 팬을 제공하지 않는다. 같은 가격축의 모든
  // 시리즈 autoscale 범위를 함께 옮기면 데이터·작도 좌표는 그대로 유지된다.
  function installVerticalPan(chart, container, opts) {
    opts = opts || {};
    var originalAdd = chart.addSeries.bind(chart);
    var originalRemove = chart.removeSeries.bind(chart);
    var originalTouchAction = container.style.touchAction;
    // Leave vertical page scrolling to the browser on phones while preserving
    // horizontal candle drag and chart-managed two-finger pinch.
    container.style.touchAction = 'pan-y';
    var watched = [], offset = 0, pointer = null, frame = 0;
    chart.addSeries = function (type, options, paneIndex) {
      var next = Object.assign({}, options || {});
      var provider = null;
      if (paneIndex == null || paneIndex === 0) {
        var originalProvider = next.autoscaleInfoProvider;
        provider = function (defaultInfo) {
          var info = originalProvider ? originalProvider(defaultInfo) : defaultInfo();
          if (!info || !info.priceRange || !offset) return info;
          return Object.assign({}, info, { priceRange: {
            minValue: info.priceRange.minValue + offset,
            maxValue: info.priceRange.maxValue + offset
          } });
        };
        next.autoscaleInfoProvider = provider;
      }
      var series = originalAdd(type, next, paneIndex);
      if (provider) watched.push({ series: series, provider: provider });
      return series;
    };
    chart.removeSeries = function (series) {
      watched = watched.filter(function (entry) { return entry.series !== series; });
      return originalRemove(series);
    };
    function refresh() {
      frame = 0;
      watched.forEach(function (entry) {
        try { entry.series.applyOptions({ autoscaleInfoProvider: entry.provider }); } catch (e) { /* 제거된 시리즈 */ }
      });
    }
    function requestRefresh() { if (!frame) frame = global.requestAnimationFrame(refresh); }
    function priceSeries() { return opts.priceSeries && opts.priceSeries(); }
    function down(event) {
      // Single-finger touch belongs to the chart's horizontal navigation or
      // the page's vertical scroll, never to desktop-only vertical price pan.
      if (event.pointerType === 'touch' || event.button !== 0 || (opts.isDrawing && opts.isDrawing())) return;
      if (event.target.closest && event.target.closest('button,input,select,textarea')) return;
      // 오른쪽 가격축 위의 드래그는 라이브러리의 축 늘이기·줄이기(axisPressedMouseMove)에 맡긴다.
      try {
        var axisWidth = chart.priceScale('right').width();
        var box = container.getBoundingClientRect();
        if (axisWidth > 0 && event.clientX >= box.right - axisWidth) return;
      } catch (e) { /* 축 폭을 못 읽으면 기존 동작 */ }
      pointer = { id: event.pointerId, y: event.clientY };
    }
    function move(event) {
      if (!pointer || pointer.id !== event.pointerId || (opts.isDrawing && opts.isDrawing())) return;
      var series = priceSeries();
      if (!series || !series.coordinateToPrice) return;
      var dy = event.clientY - pointer.y;
      pointer.y = event.clientY;
      if (!dy) return;
      // 좌표 변환은 가격 패널 안에서 수행한다. 전체 높이의 가운데는 거래량·RSI
      // 패널일 수 있어 priceToCoordinate가 null을 돌려준다.
      var y = Math.max(20, Math.min(100, container.clientHeight / 4));
      var upper = series.coordinateToPrice(y), lower = series.coordinateToPrice(y + dy);
      if (Number.isFinite(upper) && Number.isFinite(lower)) {
        offset += upper - lower;
        requestRefresh();
      }
    }
    function up(event) { if (pointer && pointer.id === event.pointerId) pointer = null; }
    function reset(event) {
      if (opts.isDrawing && opts.isDrawing()) return;
      // 축을 더블클릭하면(라이브러리 기본) 자동 맞춤으로 돌아간다. 아래 코드가 본문 더블클릭도 같은 동작을 맡는다.
      offset = 0;
      chart.priceScale('right').applyOptions({ autoScale: true });
      requestRefresh();
    }
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    global.addEventListener('pointerup', up);
    global.addEventListener('pointercancel', up);
    container.addEventListener('dblclick', reset);
    return function () {
      if (frame) global.cancelAnimationFrame(frame);
      chart.addSeries = originalAdd;
      chart.removeSeries = originalRemove;
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointermove', move);
      global.removeEventListener('pointerup', up);
      global.removeEventListener('pointercancel', up);
      container.removeEventListener('dblclick', reset);
      container.style.touchAction = originalTouchAction;
    };
  }

  function chartDate(value) {
    var raw = String(value || '');
    if (/^\d{8}$/.test(raw)) return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
    var m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  // 거래량 축약(K/M/B). 두 화면이 같은 식을 따로 갖고 있던 것을 한 곳으로 모았다(출력 동일).
  function compactVolume(value) {
    var n = Number(value) || 0;
    function scaled(divisor, suffix) {
      var v = n / divisor;
      var digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      var text = v.toFixed(digits);
      if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
      return text + suffix;
    }
    if (Math.abs(n) >= 1000000000) return scaled(1000000000, 'B');
    if (Math.abs(n) >= 1000000) return scaled(1000000, 'M');
    if (Math.abs(n) >= 1000) return scaled(1000, 'K');
    return global.NineUI.number(n, {round:true});
  }

  // ---- 시리즈 부품(옵션·호출 순서는 두 화면이 쓰던 그대로 - 화면은 필요한 순서로 호출만 한다) ----
  function candleOptions(priceFormat) {
    return {
      upColor: CANDLE_UP, downColor: CANDLE_DOWN,
      borderUpColor: CANDLE_UP, borderDownColor: CANDLE_DOWN,
      wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN,
      priceLineStyle: global.LightweightCharts.LineStyle.Solid,
      priceFormat: priceFormat
    };
  }

  // scaleMargins 를 주면 시리즈 생성 직후·데이터 입력 전에 가격축 여백을 적용한다(두 화면이 쓰던 순서 그대로).
  function addCandles(chart, LWC, bars, priceFormat, scaleMargins) {
    var series = chart.addSeries(LWC.CandlestickSeries, candleOptions(priceFormat));
    if (scaleMargins) series.priceScale().applyOptions({ scaleMargins: scaleMargins });
    series.setData(bars.map(function (d) { return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close }; }));
    return series;
  }

  // 이동평균선 한 줄. points 를 주면 그대로(서버 계산값 등), 없으면 종가 단순이동평균을 계산한다.
  function addMovingAverageLine(chart, LWC, study, points, extra) {
    var o = {
      color: study.color, lineWidth: study.width, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false
    };
    for (var k in (extra || {})) o[k] = extra[k];
    var series = chart.addSeries(LWC.LineSeries, o);
    series.setData(points);
    return series;
  }

  // groups 를 주면(['short'], ['long'], 둘 다) 그 그룹의 선만, 안 주면 예전 4개(5·20·60·224)만 돌려준다.
  function maStudies(dark, groups) {
    return MA_STUDIES.filter(function (s) {
      return groups ? groups.indexOf(s.group) >= 0 : s.legacy === true;
    }).map(function (s) {
      return { key: s.key, period: s.period, width: s.width, color: s.key === 'ma224' ? ma224Color(dark) : s.color };
    });
  }

  // 거래량 체감 배수(2026-10-21): 그 봉의 거래량 / 직전 20봉 평균. 그날 알 수 있는 값만 쓰며(오늘 봉은 평균에서 뺀다)
  // 직전 봉이 10개 미만이거나 평균이 0이면 null. 막대 진하기(2배↑·3배↑)와 3배↑ 숫자 라벨에 쓴다.
  var VOLUME_SPIKE = { strong: 2, label: 3, maxLabels: 60, labelPx: 44 };
  function volumeSpikeMultiples(bars) {
    return bars.map(function (bar, i) {
      var sum = 0, n = 0;
      for (var j = Math.max(0, i - 20); j < i; j++) {
        var v = Number(bars[j].volume);
        if (isFinite(v) && bars[j].volume !== '' && bars[j].volume != null) { sum += v; n++; }
      }
      var vol = Number(bar.volume);
      if (n < 10 || !(sum > 0) || !isFinite(vol) || bar.volume === '' || bar.volume == null) return null;
      return vol / (sum / n);
    });
  }

  // 거래량 막대 + 거래량 평균선. opts: { pane, scaleId, margins(거래량 축 설정), ma5(5일 평균선 추가), volumeMa20 색 등 }
  function addVolumePane(chart, LWC, bars, opts) {
    opts = opts || {};
    var pane = opts.pane != null ? opts.pane : 1;
    var hist = { priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false };
    if (opts.scaleId) hist.priceScaleId = opts.scaleId;
    var volume = chart.addSeries(LWC.HistogramSeries, hist, pane);
    if (opts.scaleId && opts.scaleOptions) chart.priceScale(opts.scaleId).applyOptions(opts.scaleOptions);
    // 상승 빨강·하락 파랑은 그대로 두고, 평균 대비 2배↑는 진하게·3배↑는 가장 진하게(색 의미를 바꾸지 않는다).
    var multiples = volumeSpikeMultiples(bars);
    var multiplesOn = opts.multiples === true;   // 켜고 끄는 옵션(setMultiples). 기본은 끔(호출자가 true 를 줄 때만 켠다)
    function volumeData() {
      return bars.map(function (d, i) {
        var m = multiplesOn ? multiples[i] : null, up = d.close >= d.open;
        var alpha = m != null && m >= VOLUME_SPIKE.label ? 1 : (m != null && m >= VOLUME_SPIKE.strong ? 0.85 : 0.5);
        return { time: d.date, value: Math.max(0, Number(d.volume) || 0), color: (up ? 'rgba(210,79,69,' : 'rgba(18,97,196,') + alpha + ')' };
      });
    }
    volume.setData(volumeData());
    var relabelFn = null;
    var refreshSpikes = null;
    var rangeSubscribed = false;
    // 3배 이상 봉에 `3.2배` 라벨. 5년처럼 넓게 보면 라벨이 겹쳐 읽히지 않으므로, 보이는 범위의 봉 간격(px)으로
    // 라벨 폭만큼 떨어진 것만 남긴다(겹치면 배수가 큰 쪽 우선). 확대·이동 때마다 다시 고른다.
    if (opts.multipleLabels !== false && typeof LWC.createSeriesMarkers === 'function') {
      var spikes = [];
      refreshSpikes = function () { spikes = []; bars.forEach(function (d, i) {
        var m = multiples[i];
        if (m == null || m < VOLUME_SPIKE.label) return;
        spikes.push({ i: i, m: m, time: d.date, color: d.close >= d.open ? '#d24f45' : '#1261c4', text: (Math.round(m * 10) / 10) + '배' });
      }); };
      refreshSpikes();
      function toMarker(c) { return { time: c.time, position: 'aboveBar', shape: 'circle', size: 0, color: c.color, text: c.text }; }
      var markerPlugin = null;
      try { markerPlugin = LWC.createSeriesMarkers(volume, []); } catch (e) { markerPlugin = null; }
      var hasScale = typeof chart.timeScale === 'function' && markerPlugin && typeof markerPlugin.setMarkers === 'function';
      var relabel = function () {
        if (!markerPlugin) return;
        if (!multiplesOn) { try { markerPlugin.setMarkers([]); } catch (e) { /* 무시 */ } return; }
        var chosen = spikes;
        if (hasScale) {
          var ts = chart.timeScale(), range = ts.getVisibleLogicalRange(), width = ts.width();
          if (!range || !(width > 0)) return;
          var spacing = width / Math.max(1, range.to - range.from);
          var gap = Math.max(1, Math.ceil(VOLUME_SPIKE.labelPx / spacing));
          chosen = [];
          spikes.filter(function (c) { return c.i >= range.from - 1 && c.i <= range.to + 1; })
            .sort(function (x, y) { return y.m - x.m; })
            .forEach(function (c) { if (!chosen.some(function (k) { return Math.abs(k.i - c.i) < gap; })) chosen.push(c); });
          chosen.sort(function (x, y) { return x.i - y.i; });
        } else if (chosen.length > VOLUME_SPIKE.maxLabels) chosen = chosen.slice(-VOLUME_SPIKE.maxLabels);
        try { markerPlugin.setMarkers(chosen.map(toMarker)); } catch (e) { /* 라벨만 빠진다 */ }
      };
      if (hasScale) { chart.timeScale().subscribeVisibleLogicalRangeChange(relabel); rangeSubscribed = true; }
      relabel();
      relabelFn = relabel;
    }
    function avgLine(period, color, width) {
      var pts = movingAveragePoints(bars, 'volume', period);
      var line = chart.addSeries(LWC.LineSeries, {
        color: color, lineWidth: width, priceFormat: { type: 'volume' },
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false
      }, pane);
      line.setData(pts.map(function (p) { return { time: p.time, value: Math.max(0, Number(p.value) || 0) }; }));
      return { series: line, points: pts };
    }
    var ma20 = avgLine(20, '#3b82f6', 2);
    var ma5 = opts.ma5 ? avgLine(5, '#f59e0b', 1.6) : null;
    // 차트를 다시 만들지 않고 체감 배수(진한 막대·라벨)만 켜고 끈다.
    function setMultiples(on) {
      multiplesOn = on === true;
      volume.setData(volumeData());
      if (relabelFn) relabelFn();
    }
    function updateData(nextBars) {
      var range = chart.timeScale().getVisibleLogicalRange();
      bars = nextBars;
      multiples = volumeSpikeMultiples(bars);
      volume.setData(volumeData());
      [ma20, ma5].forEach(function (ma, i) {
        if (!ma) return;
        ma.points = movingAveragePoints(bars, 'volume', i ? 5 : 20);
        ma.series.setData(ma.points.map(function (p) { return {time:p.time, value:Math.max(0, Number(p.value)||0)}; }));
      });
      if (refreshSpikes) refreshSpikes();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
      if (relabelFn) relabelFn();
    }
    function destroy() {
      if (rangeSubscribed && relabelFn) chart.timeScale().unsubscribeVisibleLogicalRangeChange(relabelFn);
      rangeSubscribed = false;
    }
    return { volume: volume, ma20: ma20, ma5: ma5, setMultiples: setMultiples, updateData: updateData, destroy: destroy };
  }

  // ---- 일목균형표(전환 9·기준 26·선행B 52, 26봉 선행) ----
  function futureBarTimes(lastDate, timeframe, count) {
    var out = [], d = new Date(lastDate + 'T00:00:00Z'), originalDay = d.getUTCDate();
    for (var i = 0; i < count; i++) {
      if (timeframe === 'week') d.setUTCDate(d.getUTCDate() + 7);
      else if (timeframe === 'month') {
        var nextMonth = d.getUTCMonth() + 1;
        var nextYear = d.getUTCFullYear() + Math.floor(nextMonth / 12);
        nextMonth = nextMonth % 12;
        var lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
        d = new Date(Date.UTC(nextYear, nextMonth, Math.min(originalDay, lastDay)));
      } else {
        do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      }
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function rollingMidpoint(bars, period) {
    return bars.map(function (_, i) {
      if (i < period - 1) return null;
      var high = -Infinity, low = Infinity;
      for (var j = i - period + 1; j <= i; j++) {
        high = Math.max(high, Number(bars[j].high) || 0);
        low = Math.min(low, Number(bars[j].low) || 0);
      }
      return (high + low) / 2;
    });
  }

  // 선행스팬 A/B 점(26봉 앞 시각). 미래 구간은 일봉=주말 제외, 주봉=7일, 월봉=1개월(공휴일 값을 만들지 않는다).
  function ichimokuCloudPoints(bars, timeframe) {
    if (!bars.length) return [];
    var conv = rollingMidpoint(bars, ICHIMOKU.tenkan), base = rollingMidpoint(bars, ICHIMOKU.kijun), spanB = rollingMidpoint(bars, ICHIMOKU.senkouB);
    var times = bars.map(function (b) { return b.date; }).concat(futureBarTimes(bars[bars.length - 1].date, timeframe, ICHIMOKU.displacement));
    var points = [];
    bars.forEach(function (_, i) {
      if (conv[i] == null || base[i] == null || spanB[i] == null) return;
      points.push({ time: times[i + ICHIMOKU.displacement], sourceTime: bars[i].date, spanA: (conv[i] + base[i]) / 2, spanB: spanB[i] });
    });
    return points;
  }

  // 구름(선행스팬 1·2 사이)을 캔들·선 뒤 배경에 채우는 시리즈 플러그인
  function createCloudPrimitive(bandPts, color) {
    return {
      _chart: null, _series: null,
      attached: function (params) { this._chart = params.chart; this._series = params.series; },
      detached: function () { this._chart = null; this._series = null; },
      updateAllViews: function () {},
      paneViews: function () {
        var self = this;
        return [{
          renderer: function () {
            return {
              draw: function () {},
              drawBackground: function (target) {
                var chart = self._chart, series = self._series;
                if (!chart || !series) return;
                target.useBitmapCoordinateSpace(function (scope) {
                  var ctx = scope.context, hR = scope.horizontalPixelRatio, vR = scope.verticalPixelRatio, ts = chart.timeScale();
                  var pts = bandPts.map(function (p) {
                    var x = ts.timeToCoordinate(p.time), yA = series.priceToCoordinate(p.a), yB = series.priceToCoordinate(p.b);
                    if (x == null || yA == null || yB == null) return null;
                    return { x: x * hR, yA: yA * vR, yB: yB * vR };
                  });
                  ctx.save();
                  for (var k = 0; k < pts.length - 1; k++) {
                    var p0 = pts[k], p1 = pts[k + 1];
                    if (!p0 || !p1) continue;
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.yA); ctx.lineTo(p1.x, p1.yA); ctx.lineTo(p1.x, p1.yB); ctx.lineTo(p0.x, p0.yB);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                  }
                  ctx.restore();
                });
              }
            };
          }
        }];
      }
    };
  }

  // ---- 서식 ----
  function priceText(value, isUs) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '';
    return isUs ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : global.NineUI.number(n, {round:true});
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }


  // ---- 대량 거래 표시 (2026-10-19 사용자 정의로 교체: 기존 대량 양봉·윗꼬리형·털기? 표시는 삭제) ----
  // 매집이 확인된 것이 아니라 "거래량이 평소보다 크게 터진 봉이 바닥권 또는 횡보(박스권)에서 나왔다"는 관찰용 표시다. 그날까지의 정보만 쓴다.
  //  - 거래량 : 직전 20일 평균의 2배 이상 + 거래대금 30억원 이상.
  //  - 바닥권 : 종가가 최근 250봉 저가~고가 범위의 하위 30%.
  //  - 횡보(박스권) : 최근 60봉 고저 폭이 25% 이하이고 250봉 범위 하위 60%(바닥권이 아닌 경우).
  //  - 신고가 구간 제외 : 종가가 최근 250봉 고가의 90% 이상이면 표시하지 않는다.
  // 일봉·국내 종목에서만 쓰고 250봉이 안 되는 종목은 표시하지 않는다.
  // 주의: 5년 일봉 시험(docs/INVERTED_HAMMER_EXIT_STUDY_2026-10-19.md '사용자 정의 매집봉')에서 바닥권 표시는 이후 기준선보다 낮았고 횡보는 유의하지 않았다. 매수 신호가 아니다.
  var ACCUMULATION = { volMult: 2.0, amountMin: 3000000000, avgBars: 20, color: '#e8590c', windowBars: 250, boxBars: 60,
    bottomPos: 0.3, boxPos: 0.6, boxMaxRange: 0.25, highExclude: 0.9 };

  // 빈 값(null·'')은 0이 아니라 없는 값이다 - 서버(volume_accumulation._f)가 평균에서 빼는 것과 같게 맞춘다.
  function accNumber(value) {
    return value === null || value === undefined || value === '' ? NaN : Number(value);
  }

  // i번째 봉 종가가 최근 period봉(i 포함) 이동평균 대비 몇 % 위인지. 봉이 모자라면 null.
  function accMaDistance(bars, i, period) {
    if (i + 1 < period) return null;
    var sum = 0;
    for (var j = i - period + 1; j <= i; j++) {
      var cj = accNumber(bars[j].close);
      if (!isFinite(cj)) return null;
      sum += cj;
    }
    return (accNumber(bars[i].close) / (sum / period) - 1) * 100;
  }

  // i번째 봉 종가가 직전 60봉(i 제외) 최고가 대비 몇 % 위/아래인지. 직전 봉이 20개도 없으면 null.
  function accHighDistance(bars, i) {
    var from = Math.max(0, i - ACCUMULATION.highBars);
    if (i - from < ACCUMULATION.avgBars) return null;
    var top = -Infinity;
    for (var j = from; j < i; j++) {
      var hj = accNumber(bars[j].high);
      if (isFinite(hj) && hj > top) top = hj;
    }
    return isFinite(top) && top > 0 ? (accNumber(bars[i].close) / top - 1) * 100 : null;
  }

  // i번째 봉이 최근 250봉(i 포함) 저가~고가 범위에서 몇 % 위치인지. 봉이 120개도 안 되면 null.
  function accPosition(bars, i) {
    var from = Math.max(0, i - 249);
    if (i - from < 119) return null;
    var lo = Infinity, hi = -Infinity;
    for (var j = from; j <= i; j++) {
      var l = accNumber(bars[j].low), h = accNumber(bars[j].high);
      if (isFinite(l) && l < lo) lo = l;
      if (isFinite(h) && h > hi) hi = h;
    }
    return hi > lo ? (accNumber(bars[i].close) - lo) / (hi - lo) * 100 : null;
  }

  // 반환: [{ index, date, zone, multiple, wickPct, openChange, highChange, fromHigh, position, boxRange, highDist, ma112Dist, ma224Dist }]
  //   zone = 'bottom'(바닥권) | 'box'(횡보). 고가(highChange) = (당일 고가 / 당일 시가 - 1) x 100, 종가 변화율(openChange)과 다르다.
  function accumulationBars(bars) {
    var out = [];
    var W = ACCUMULATION.windowBars;
    if (!bars || bars.length < W) return out;
    for (var i = W - 1; i < bars.length; i++) {
      var b = bars[i];
      var o = accNumber(b.open), h = accNumber(b.high), l = accNumber(b.low), c = accNumber(b.close), v = accNumber(b.volume);
      if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c) || !isFinite(v) || o <= 0 || c <= 0 || h <= l) continue;
      if (c * v < ACCUMULATION.amountMin) continue;
      var sum = 0, count = 0;
      for (var j = i - ACCUMULATION.avgBars; j < i; j++) {
        var pv = accNumber(bars[j].volume);
        if (isFinite(pv)) { sum += pv; count++; }
      }
      var avg = count ? sum / count : 0;
      if (!avg || v < ACCUMULATION.volMult * avg) continue;
      var top = -Infinity, bot = Infinity;
      for (var k = i - W + 1; k <= i; k++) {
        var hk = accNumber(bars[k].high), lk = accNumber(bars[k].low);
        if (isFinite(hk) && hk > top) top = hk;
        if (isFinite(lk) && lk < bot) bot = lk;
      }
      if (!isFinite(top) || !isFinite(bot) || top <= bot || c >= ACCUMULATION.highExclude * top) continue;
      var pos = (c - bot) / (top - bot);
      var h60 = -Infinity, l60 = Infinity;
      for (var m = i - ACCUMULATION.boxBars + 1; m <= i; m++) {
        var hm = accNumber(bars[m].high), lm = accNumber(bars[m].low);
        if (isFinite(hm) && hm > h60) h60 = hm;
        if (isFinite(lm) && lm < l60) l60 = lm;
      }
      var boxRange = isFinite(h60) && isFinite(l60) && l60 > 0 ? h60 / l60 - 1 : null;
      var zone = pos <= ACCUMULATION.bottomPos ? 'bottom'
        : (boxRange !== null && boxRange <= ACCUMULATION.boxMaxRange && pos <= ACCUMULATION.boxPos ? 'box' : null);
      if (!zone) continue;
      out.push({ index: i, date: b.date, zone: zone, multiple: v / avg, wickPct: (h - Math.max(o, c)) / (h - l) * 100, openChange: (c / o - 1) * 100,
        highChange: (h / o - 1) * 100, fromHigh: (c / h - 1) * 100, position: pos * 100, boxRange: boxRange === null ? null : boxRange * 100,
        highDist: (c / top - 1) * 100, ma112Dist: accMaDistance(bars, i, 112), ma224Dist: accMaDistance(bars, i, 224) });
    }
    return out;
  }

  // text 는 차트에 찍히는 짧은 이름, label 은 범례·툴팁의 전체 이름이다. 모두 관찰용이며 매집을 확정하지 않는다.
  var ACC_MARKER = {
    bottom: { color: '#e8590c', size: 1, text: '대량 바닥권', label: '대량 거래 · 바닥권 (매집 의심, 관찰용)' },
    box: { color: '#e8590c', size: 1, text: '대량 횡보', label: '대량 거래 · 횡보(박스권) (매집 의심, 관찰용)' }
  };

  function accumulationMarkers(bars) {
    return accumulationBars(bars).map(function (hit) {
      var style = ACC_MARKER[hit.zone];
      return { time: hit.date, position: 'belowBar', color: style.color, shape: 'circle', size: style.size, text: style.text };
    });
  }

  // 반환: { accumulation: 전체 개수, bottom: 바닥권 개수, box: 횡보 개수 }
  function accumulationSummary(bars) {
    var counts = { accumulation: 0, bottom: 0, box: 0 };
    accumulationBars(bars).forEach(function (hit) { counts.accumulation++; counts[hit.zone]++; });
    return counts;
  }

  // 범례(차트검색·종목분석 공통): 색·이름·개수. 개수는 setAccumulationMarkers 가 돌려준 값이다.
  function accumulationLegendHtml(counts) {
    counts = counts || { accumulation: 0, bottom: 0, box: 0 };
    return '<span style="color:' + ACCUMULATION.color + '">대량 거래 ● ' + ACC_MARKER.bottom.text + ' <b>' + counts.bottom + '</b> · ● ' + ACC_MARKER.box.text + ' <b>' + counts.box + '</b></span>';
  }

  // 봉마다 거래량과 '직전 N봉 평균 대비 배수'(그 봉 제외, 전일 하루가 아님)를 한 번에 계산한다. 반환: { '날짜키': { volume, multiple } }.
  // 직전 봉이 N개 안 되거나 평균이 0이면 multiple = null. 마우스 오버 툴팁이 읽기만 하므로 차트당 한 번(O(n)) 계산한다.
  function volumeMultiples(bars, period) {
    var n = period || 20, out = {};
    if (!bars) return out;
    var window = [], sum = 0;
    for (var i = 0; i < bars.length; i++) {
      var v = accNumber(bars[i].volume);
      var multiple = null;
      if (window.length === n && sum > 0 && isFinite(v)) multiple = v / (sum / n);
      if (bars[i].date !== undefined && bars[i].date !== null) out[String(bars[i].date)] = { volume: isFinite(v) ? v : null, multiple: multiple };
      if (isFinite(v)) {
        window.push(v); sum += v;
        if (window.length > n) sum -= window.shift();
      }
    }
    return out;
  }

  function accSigned(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return (value >= 0 ? '+' : '') + value.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  // 마커가 찍힌 봉 위에 십자선이 오면 판단에 쓴 수치를 보여 준다(관찰용). 반환: 해제 함수.
  function attachAccumulationTooltip(chart, container, bars) {
    if (!chart || !container || typeof chart.subscribeCrosshairMove !== 'function') return function () {};
    var byDate = {};
    accumulationBars(bars).forEach(function (hit) { byDate[hit.date] = hit; });
    Array.prototype.forEach.call(container.querySelectorAll('.nine-acc-tip'), function (old) { old.remove(); });   // 다시 그릴 때 이전 차트의 툴팁이 남지 않게
    var tip = document.createElement('div');
    tip.className = 'nine-acc-tip';
    tip.hidden = true;
    var dark = isDark();
    tip.style.cssText = 'position:absolute;z-index:8;pointer-events:none;max-width:230px;padding:6px 8px;border-radius:6px;font-size:11px;line-height:1.5;'
      + 'box-shadow:0 2px 8px rgba(15,23,42,.18);border:1px solid ' + (dark ? '#37424e' : 'rgba(148,163,184,.52)') + ';'
      + 'background:' + (dark ? '#283340' : 'rgba(255,255,255,.96)') + ';color:' + (dark ? '#f1f4f8' : '#334155') + ';';
    container.appendChild(tip);
    function dateKey(time) {
      if (typeof time === 'string') return time;
      if (time && typeof time === 'object' && time.year != null) return time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0');
      return '';
    }
    var onMove = function (param) {
      var hit = param && param.point ? byDate[dateKey(param.time)] : null;
      if (!hit) { tip.hidden = true; return; }
      var style = ACC_MARKER[hit.zone];
      tip.innerHTML = '<b style="color:' + style.color + '">' + style.label + '</b><br><span style="opacity:.7">' + hit.date + ' · 관찰용, 매집 확정 아님</span><br>'
        + '거래량 <b>' + hit.multiple.toFixed(1) + '배</b> <span style="opacity:.7">(직전 20일 평균 대비)</span> · 윗꼬리 <b>' + hit.wickPct.toFixed(0) + '%</b><br>'
        + '고가 <b>' + accSigned(hit.highChange) + '</b> <span style="opacity:.7">(시가→당일 고가)</span><br>'
        + '종가 <b>' + accSigned(hit.openChange) + '</b> <span style="opacity:.7">(시가→종가)</span> · 고점 대비 종가 <b>' + accSigned(hit.fromHigh) + '</b><br>'
        + '250봉 가격 위치 <b>' + (hit.position === null || hit.position === undefined ? '—' : hit.position.toFixed(0) + '%') + '</b> · 60봉 고저 폭 <b>' + (hit.boxRange === null || hit.boxRange === undefined ? '—' : hit.boxRange.toFixed(0) + '%') + '</b><br>'
        + '250봉 고점 대비 종가 <b>' + accSigned(hit.highDist) + '</b><br>'
        + '112일선 대비 <b>' + accSigned(hit.ma112Dist) + '</b> · 224일선 대비 <b>' + accSigned(hit.ma224Dist) + '</b>';
      var width = container.clientWidth || 0;
      var x = Number(param.point.x || 0);
      tip.style.left = Math.max(4, x > width * 0.58 ? x - 244 : x + 14) + 'px';
      tip.style.top = Math.max(4, Number(param.point.y || 0) + 14) + 'px';
      tip.hidden = false;
    };
    chart.subscribeCrosshairMove(onMove);
    return function () {
      if (typeof chart.unsubscribeCrosshairMove === 'function') chart.unsubscribeCrosshairMove(onMove);
      tip.remove();
    };
  }

  // ---- 이동평균 배열 추세 상태(2026-10-19 사용자 요청: 주가 예측이 아니라 추세를 보는 옵션) ----
  //  장기 역배열 = MA20 < MA60 < MA120 < MA224 (주가가 크게 빠져 장기 추세가 하락), 장기 정배열 = 반대 순서.
  //  단기 정배열 = MA5 > MA10 > MA20 (탄력이 붙음), 단기 역배열 = 반대 순서. 그 밖은 혼조.
  //  전환 표시는 같은 상태가 3봉 연속 유지됐을 때 3번째 봉에 한 번 찍는다(그 봉까지의 종가만 쓴다, 미래 비참조). 매수·매도 신호가 아니다.
  var TREND = { longBars: [20, 60, 120, 224], shortBars: [5, 10, 20], confirmBars: 3, highBars: 250 };

  function trendMaSeries(bars, period) {
    var out = new Array(bars.length), sum = 0, count = 0;
    for (var i = 0; i < bars.length; i++) {
      var c = accNumber(bars[i].close);
      if (!isFinite(c)) { out[i] = null; sum = 0; count = 0; continue; }
      sum += c; count++;
      if (count > period) { sum -= accNumber(bars[i - period].close); count = period; }
      out[i] = count === period ? sum / period : null;
    }
    return out;
  }

  // 반환: 봉마다 { long: 'reverse'|'forward'|'mixed'|null, short: 'forward'|'reverse'|'mixed'|null }
  function trendStates(bars) {
    var states = [];
    if (!bars || !bars.length) return states;
    var longMa = TREND.longBars.map(function (p) { return trendMaSeries(bars, p); });
    var shortMa = TREND.shortBars.map(function (p) { return trendMaSeries(bars, p); });
    function order(mas, i) {
      var v = mas.map(function (m) { return m[i]; });
      if (v.some(function (x) { return x === null || x === undefined; })) return null;
      var up = true, down = true;
      for (var k = 1; k < v.length; k++) { if (!(v[k] > v[k - 1])) up = false; if (!(v[k] < v[k - 1])) down = false; }
      return up ? 'asc' : (down ? 'desc' : 'mixed');
    }
    for (var i = 0; i < bars.length; i++) {
      var lo = order(longMa, i), sh = order(shortMa, i);
      states.push({
        long: lo === null ? null : (lo === 'asc' ? 'reverse' : (lo === 'desc' ? 'forward' : 'mixed')),    // MA20<MA60<MA120<MA224(오름차순) = 역배열
        short: sh === null ? null : (sh === 'desc' ? 'forward' : (sh === 'asc' ? 'reverse' : 'mixed'))     // MA5>MA10>MA20(내림차순) = 정배열
      });
    }
    return states;
  }

  // 마지막 봉 기준 현재 상태 + 250봉 고점 대비 하락률. 봉이 모자라면 해당 값은 null.
  function trendSummary(bars) {
    var states = trendStates(bars);
    var last = states.length ? states[states.length - 1] : { long: null, short: null };
    var dd = null;
    if (bars && bars.length) {
      var from = Math.max(0, bars.length - TREND.highBars), top = -Infinity;
      for (var j = from; j < bars.length; j++) { var hj = accNumber(bars[j].high); if (isFinite(hj) && hj > top) top = hj; }
      var cl = accNumber(bars[bars.length - 1].close);
      if (isFinite(top) && top > 0 && isFinite(cl)) dd = (cl / top - 1) * 100;
    }
    return { long: last.long, short: last.short, drawdown: dd };
  }

  // 전환 표시: 장기 역배열 시작(파랑, 위), 단기 정배열 시작(빨강, 아래). 같은 상태가 confirmBars 연속일 때 그 마지막 봉에 한 번.
  function trendMarkers(bars) {
    var states = trendStates(bars), out = [];
    function scan(key, want, build) {
      var run = 0, fired = false;
      for (var i = 0; i < states.length; i++) {
        if (states[i][key] === want) {
          run++;
          if (run === TREND.confirmBars && !fired) { out.push(build(bars[i].date)); fired = true; }
        } else { run = 0; fired = false; }
      }
    }
    scan('long', 'reverse', function (date) { return { time: date, position: 'aboveBar', color: '#2563eb', shape: 'arrowDown', size: 1, text: '장기 역배열' }; });
    scan('short', 'forward', function (date) { return { time: date, position: 'belowBar', color: '#dc2626', shape: 'arrowUp', size: 1, text: '단기 정배열' }; });
    return out;
  }

  var TREND_LABEL = { long: { reverse: '장기 역배열', forward: '장기 정배열', mixed: '장기 혼조' }, short: { forward: '단기 정배열', reverse: '단기 역배열', mixed: '단기 혼조' } };
  var TREND_COLOR = { long: { reverse: '#2563eb', forward: '#dc2626', mixed: '#8a9099' }, short: { forward: '#dc2626', reverse: '#2563eb', mixed: '#8a9099' } };

  // 범례·배지 HTML(차트검색·종목분석 공통). 정배열은 빨강, 역배열은 파랑, 혼조는 회색.
  function trendLegendHtml(summary) {
    summary = summary || { long: null, short: null, drawdown: null };
    var parts = [];
    ['long', 'short'].forEach(function (key) {
      var s = summary[key];
      parts.push(s ? '<span style="color:' + TREND_COLOR[key][s] + '">' + TREND_LABEL[key][s] + '</span>' : '<span style="opacity:.6">' + (key === 'long' ? '장기' : '단기') + ' 데이터 부족</span>');
    });
    var dd = summary.drawdown === null || summary.drawdown === undefined || !isFinite(summary.drawdown) ? '—' : (summary.drawdown >= 0 ? '+' : '') + summary.drawdown.toFixed(1) + '%';
    return '<span style="opacity:.75">추세</span> ' + parts.join(' · ') + '<span style="opacity:.7"> · 250일 고점 대비 <b>' + dd + '</b> (이평 배열, 신호 아님)</span>';
  }

  // 주 마커 홀더(holder)에 전환 표시를 건다. 대량거래 표시와 한 플러그인에 합쳐진다. enabled=false 면 전환 표시를 뺀다.
  function setTrendMarkers(LWC, series, bars, enabled, holder) {
    holder = holder || {};
    holder.trend = []; // Legacy calculations remain exported; no trend arrows on candles.
    if (holder.trendCleanup) { holder.trendCleanup(); holder.trendCleanup = null; }
    return Object.prototype.hasOwnProperty.call(holder, 'supplyEnabled') ? setSupplyTraceMarkers(LWC, series, bars, holder.supplyEnabled, holder) : setAccumulationMarkers(LWC, series, bars, holder.accEnabled === true, holder);
  }

  // 대파동 보조 판정은 그 시점까지의 종가 변화만 본다. 극점·구조 판정과 독립적이다.
  var REGIME = { confirmBars:3, lanes:[
    {key:'month1',label:'1개월',periods:{day:21,week:4,month:1},threshold:3},
    {key:'month3',label:'3개월',periods:{day:63,week:13,month:3},threshold:6},
    {key:'month6',label:'6개월',periods:{day:126,week:26,month:6},threshold:9},
    {key:'year1',label:'1년',periods:{day:252,week:52,month:12},threshold:12}
  ] };
  var REGIME_COLOR={up:CANDLE_UP,down:CANDLE_DOWN,neutral:'#a0a6ad',unknown:'#d8dce1'};
  var REGIME_LABEL={up:'상승',down:'하락',neutral:'전환·중립',unknown:'자료 부족'};
  function trendRegimes(bars,timeframe) {
    bars=bars || [];
    timeframe=timeframe==='week'||timeframe==='month'?timeframe:'day';
    var closes=bars.map(function(b){var c=accNumber(b.close);return c>0?c:NaN;});
    var invalidPrefix=[0];closes.forEach(function(c){invalidPrefix.push(invalidPrefix[invalidPrefix.length-1]+(isFinite(c)?0:1));});
    var lanes={};
    REGIME.lanes.forEach(function(cfg){
      var stable='unknown',pending=null,run=0,lookback=cfg.periods[timeframe];
      lanes[cfg.key]=bars.map(function(b,i){
        var ready=i>=lookback && invalidPrefix[i+1]===invalidPrefix[i-lookback];
        var change=ready?(closes[i]/closes[i-lookback]-1)*100:null;
        var raw=!ready?'unknown':change>=cfg.threshold?'up':change<=-cfg.threshold?'down':'neutral';
        if(raw==='unknown'){stable='unknown';pending=null;run=0;}
        else {
          if(raw===pending)run++;else{pending=raw;run=1;}
          if(run>=REGIME.confirmBars)stable=raw;
        }
        return {index:i,date:b.date || b.time,state:stable,raw:raw,pending:raw!==stable?run:0,change:change};
      });
    });
    return lanes;
  }
  // 대파동 보조 설명만 계산한다. ATR 극점·박스·확정 시점은 변경하지 않는다.
  // index는 설명 기준 봉이며, 확정 당시 설명에는 confirmedIndex를 전달한다.
  function majorWaveContext(lanes, wave, index) {
    var direction=wave && (wave.kind==='up'||wave.kind==='down')?wave.kind:null;
    var periods=REGIME.lanes.map(function(cfg){
      var row=(lanes[cfg.key] || [])[index] || {state:'unknown',raw:'unknown',pending:0,change:null};
      return {key:cfg.key,label:cfg.label,state:row.state,raw:row.raw,pending:row.pending,change:row.change};
    });
    var known=periods.filter(function(p){return p.state!=='unknown';});
    var opposed=direction?known.filter(function(p){return p.state!=='neutral' && p.state!==direction;}):[];
    var aligned=direction?known.filter(function(p){return p.state===direction;}):[];
    var pending=periods.some(function(p){return p.pending>0;});
    var againstLong=opposed.some(function(p){return p.key==='month6'||p.key==='year1';});
    var text=!known.length?'보조 자료 부족':opposed.length||pending?'전환 확인 중':aligned.length?'방향 일치':!direction && known.some(function(p){return p.state!=='neutral';})?'방향 비교 보류':'기간 흐름 중립';
    return {index:index,direction:direction,periods:periods,aligned:aligned.map(function(p){return p.key;}),
      opposed:opposed.map(function(p){return p.key;}),againstLong:againstLong,pending:pending,text:text};
  }
  function trendRegimeLegendHtml(lanes,timeframe,index) {
    var unit=timeframe==='day'?'일봉':timeframe==='week'?'주봉':timeframe==='month'?'월봉':'분봉';
    return REGIME.lanes.map(function(c){var rows=lanes[c.key] || [],r=rows[index===undefined?rows.length-1:index] || {state:'unknown'};
      return '<span style="color:'+(r.state==='unknown'?'#747b84':REGIME_COLOR[r.state])+'">'+c.label+' '+REGIME_LABEL[r.state]+(r.pending?' ('+r.pending+'/3 확인)':'')+'</span>';
    }).join(' · ')+' <small>'+unit+' · 종가 변화 · 3봉 확인</small>';
  }
  function studyHeaderBottom(container) {
    var ma=container.querySelector('.ss-price-study-label'),top=Math.max(26,ma?ma.offsetTop+ma.offsetHeight+4:26);
    var trace=container.querySelector('.nine-trace-legend');
    if(trace && trace.parentElement!==ma){trace.style.top=top+'px';top+=trace.offsetHeight+4;}
    return top;
  }
  // 시리즈에 마커를 건다. 같은 시리즈에 이미 다른 마커(예: 종목분석의 이벤트 표시)가 있으면 holder.base 와 합쳐 한 번에 건다.
  // holder: { plugin, base, chart, container } - 호출자가 들고 있다가 껐다 켤 때 같은 객체를 넘긴다. chart·container 가 있으면 툴팁도 함께 건다.
  // 반환: {accumulation, bottom, box} 개수(꺼져 있으면 0).
  function setAccumulationMarkers(LWC, series, bars, enabled, holder) {
    holder = holder || {};
    holder.accEnabled = !!enabled;
    var acc = enabled ? accumulationMarkers(bars) : [];
    var counts = enabled ? accumulationSummary(bars) : { accumulation: 0, bottom: 0, box: 0 };
    if (holder.tipCleanup) { holder.tipCleanup(); holder.tipCleanup = null; }
    if (enabled && holder.chart && holder.container) holder.tipCleanup = attachAccumulationTooltip(holder.chart, holder.container, bars);
    var merged = (holder.base || []).concat(holder.trend || [], acc).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    if (typeof LWC.createSeriesMarkers !== 'function') return counts;
    if (!holder.plugin) {
      if (!merged.length) return counts;
      holder.plugin = LWC.createSeriesMarkers(series, merged);
    } else if (typeof holder.plugin.setMarkers === 'function') {
      holder.plugin.setMarkers(merged);
    }
    return counts;
  }


  // 수급 흔적: OHLCV 관찰용. 이전 accumulation* API는 비교·롤백용으로 보존한다.
  var SUPPLY_TRACES = { volumePeriod: 20, volumeMultiple: 3, maPeriods: [112, 224, 448],
    approachPct: 2, crossPct: 1, followBars: 20, upperWickPct: 40, lowTolerancePct: 2,
    color: '#e8590c' };
  function supplyTraceBars(bars) {
    bars = bars || [];
    var cfg = SUPPLY_TRACES, hits = [], pending = [], volumes = [], closes = [];
    var states = cfg.maPeriods.map(function () { return { side: 0, near: false, broken: null }; });
    bars.forEach(function (b, i) {
      var o = accNumber(b.open), h = accNumber(b.high), l = accNumber(b.low), c = accNumber(b.close), v = accNumber(b.volume);
      var valid = [o,h,l,c].every(function (x) { return isFinite(x) && x > 0; }) && h >= Math.max(o,c) && l <= Math.min(o,c) && h >= l;
      var volValid = isFinite(v) && v >= 0;
      var prior = volumes.slice(-cfg.volumePeriod);
      var avg = prior.length === cfg.volumePeriod && prior.every(function (x) { return isFinite(x); }) ? prior.reduce(function (a,x) { return a+x; },0)/cfg.volumePeriod : NaN;
      var multiple = volValid && avg > 0 ? v/avg : null;
      volumes.push(volValid ? v : NaN);
      closes.push(valid ? c : NaN);
      if (!valid) { pending = []; states = cfg.maPeriods.map(function () { return { side:0, near:false, broken:null }; }); return; }
      var hit = { index:i, date:b.date || b.time, multiple:multiple, amount:volValid ? c*v : null,
        candle:c>o?'양봉':c<o?'음봉':'보합', wickPct:h>l?(h-Math.max(o,c))/(h-l)*100:0,
        volumeSurge:multiple !== null && multiple >= cfg.volumeMultiple, longMA:[], recoveries:[] };
      pending = pending.filter(function (a) {
        if (i-a.index > cfg.followBars || l < a.low*(1-cfg.lowTolerancePct/100)) return false;
        if (c > a.high) { hit.recoveries.push({ date:a.date, index:a.index, elapsed:i-a.index, low:a.low, high:a.high }); return false; }
        return true;
      });
      cfg.maPeriods.forEach(function (period, k) {
        var window = closes.slice(-period), st = states[k];
        if (window.length !== period || !window.every(function (x) { return isFinite(x); })) return;
        var ma = window.reduce(function (a,x) { return a+x; },0)/period, distance = (c/ma-1)*100;
        var near = Math.abs(distance) <= cfg.approachPct;
        var side = distance >= cfg.crossPct ? 1 : distance <= -cfg.crossPct ? -1 : 0;
        var action = null;
        if (st.broken && i-st.broken.index > cfg.followBars) st.broken = null;
        if (side === -1 && st.side === 1) { action='이탈'; st.broken={index:i, ma:ma}; }
        if (side === 1 && st.side === -1) {
          action = st.broken && c >= st.broken.ma ? '회복' : '돌파';
          st.broken=null;
        }
        if (!action && near && !st.near) action='접근';
        if (action) hit.longMA.push({period:period, action:action, ma:ma, distance:distance});
        if (side) st.side=side;
        else if (!st.side) st.side=distance <= 0 ? -1 : 1;
        st.near=near;
      });
      if (hit.volumeSurge && hit.wickPct >= cfg.upperWickPct) pending.push({index:i,date:hit.date,low:l,high:h});
      if (hit.volumeSurge || hit.longMA.length || hit.recoveries.length) hits.push(hit);
    });
    return hits;
  }
  function supplyTraceMarkers(bars, hits) {
    var markers=[];
    (hits || supplyTraceBars(bars)).forEach(function (h) {
      if (h.volumeSurge) markers.push({time:h.date,position:'belowBar',color:SUPPLY_TRACES.color,shape:'circle',size:0.7,text:'거래량 급증'});
      if (h.longMA.length) markers.push({time:h.date,position:'aboveBar',color:'#7950b2',shape:'square',size:0.7,text:h.longMA.map(function (m) { return m.period+' '+m.action; }).join(' · ')});
      if (h.recoveries.length) markers.push({time:h.date,position:'belowBar',color:CANDLE_UP,shape:'arrowUp',size:0.7,text:'회복 확인'});
    });
    return markers;
  }
  // Importance means independently validated outcome evidence, not 3x volume
  // or simple MA proximity. The 2020-2026 audit admitted no types. Raw evidence
  // stays available in detail mode; no invented "important" buy signal.
  var SUPPLY_DISPLAY={validatedTypes:[],minPixels:16};
  function supplyDisplayEvents(bars,hits,mode) {
    var dates={},priority={recovery:4,longMA:3,volume:2,approach:1};
    (hits || supplyTraceBars(bars)).forEach(function(h){
      var type=h.recoveries.length?'recovery':h.longMA.some(function(m){return m.action!=='접근';})?'longMA':h.volumeSurge?'volume':'approach';
      if(!dates[h.date] || priority[type]>priority[dates[h.date].type])dates[h.date]={index:h.index,date:h.date,type:type,hit:h};
    });
    return Object.keys(dates).map(function(d){return dates[d];}).sort(function(a,b){return a.index-b.index;}).filter(function(e){return mode==='detail' || SUPPLY_DISPLAY.validatedTypes.indexOf(e.type)>=0;});
  }
  function supplyDisplayMarkers(events,range,width) {
    var last=-Infinity;
    return events.filter(function(e){
      if(!range)return true;
      if(e.index<Math.floor(range.from)-1 || e.index>Math.ceil(range.to)+1)return false;
      var x=(e.index-range.from)*width/Math.max(1,range.to-range.from);
      if(x-last<SUPPLY_DISPLAY.minPixels)return false;
      last=x;return true;
    }).map(function(e){return {time:e.date,position:e.type==='longMA'||e.type==='approach'?'aboveBar':'belowBar',
      color:e.type==='volume'?SUPPLY_TRACES.color:e.type==='recovery'?CANDLE_UP:'#7950b2',
      shape:e.type==='volume'?'circle':e.type==='recovery'?'arrowUp':'square',size:.45,text:''};});
  }
  function supplyTraceSummary(bars, hits) {
    hits=hits || supplyTraceBars(bars);
    var result={bars:hits.length, volume:0, longMA:0, recovery:0, unavailable:[]};
    hits.forEach(function (h) { if(h.volumeSurge)result.volume++; if(h.longMA.length)result.longMA++; if(h.recoveries.length)result.recovery++; });
    SUPPLY_TRACES.maPeriods.forEach(function (p) {
      var tail=(bars || []).slice(-p);
      if(tail.length<p || tail.some(function(b){var o=accNumber(b.open),h=accNumber(b.high),l=accNumber(b.low),c=accNumber(b.close);return ![o,h,l,c].every(function(x){return isFinite(x)&&x>0;})||h<Math.max(o,c)||l>Math.min(o,c)||h<l;}))result.unavailable.push(p);
    });
    return result;
  }
  function supplyTraceLegendHtml(counts) {
    counts=counts || {volume:0,longMA:0,recovery:0,unavailable:[]};
    return '<span style="color:#e8590c">● 거래량 급증 '+counts.volume+'</span> · <span style="color:#7950b2">■ 장기선 관찰 '+counts.longMA+'</span> · <span style="color:'+CANDLE_UP+'">▲ 가격 회복 '+counts.recovery+'</span><span style="opacity:.75"> · 일봉 관찰값 · 실제 수급/매집 아님'+(counts.unavailable.length?' · 장기선 자료 부족: '+counts.unavailable.join('/')+'일':'')+'</span>';
  }
  function supplyEscape(value) { return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function supplyTraceTooltipHtml(h) {
    if (!h) return '';
    var out='<b>'+supplyEscape(h.date)+' · 거래량·가격 관찰</b><br>';
    if(h.volumeSurge)out+='<b style="color:#e8590c">● 거래량 급증</b><br>';
    out+='거래량 '+(h.multiple===null?'—':h.multiple.toFixed(2)+'배')+' (직전 20일 평균)<br>거래대금 '+(h.amount===null?'—':(h.amount/100000000).toFixed(2)+'억원')+' (종가×거래량 대용값)<br>'+h.candle+' · 윗꼬리 '+h.wickPct.toFixed(1)+'% (고저 범위 대비)<br>';
    if(h.volumeSurge && h.wickPct>=SUPPLY_TRACES.upperWickPct)out+='윗꼬리 이후 저점·회복 관찰 시작 (미확인)<br>';
    if(h.longMA.length)out+='<b style="color:#7950b2">■ 장기선 공방</b><br>'+h.longMA.map(function(m){return m.period+'일선 '+m.action+' · '+Math.round(m.ma).toLocaleString()+'원 ('+accSigned(m.distance)+')';}).join('<br>')+'<br>';
    if(h.recoveries.length)out+='<b style="color:'+CANDLE_UP+'">▲ 회복 확인</b><br>'+h.recoveries.map(function(a){return supplyEscape(a.date)+' 윗꼬리봉 이후 '+a.elapsed+'거래일<br>저점 '+a.low.toLocaleString()+'원 대비 -2% 이내 방어·종가가 고가 '+a.high.toLocaleString()+'원 초과';}).join('<br>')+'<br>';
    return out+'<small>일봉 OHLCV 관찰용 · 실제 매집·세력 매수 확정 및 매수 신호 아님<br>진행 중 일봉은 종가 확정 전 변할 수 있음</small>';
  }
  function attachSupplyTraceTooltip(chart, container, bars, hits) {
    var byDate={}; (hits || supplyTraceBars(bars)).forEach(function(h){byDate[h.date]=h;});
    var tip=document.createElement('div'); tip.className='nine-acc-tip nine-supply-tip';
    tip.style.cssText='position:absolute;z-index:30;display:none;box-sizing:border-box;padding:9px;border:1px solid #888;border-radius:6px;background:rgba(255,255,255,.97);color:#222;font-size:11px;line-height:1.5;overflow:auto;pointer-events:auto;';
    container.appendChild(tip);
    function handler(param) {
      var time=param && param.time;
      if(time && typeof time==='object')time=time.year+'-'+String(time.month).padStart(2,'0')+'-'+String(time.day).padStart(2,'0');
      var hit=byDate[time], point=param && param.point;
      if(!hit || !point || point.x<0 || point.y<0 || point.x>container.clientWidth || point.y>container.clientHeight){tip.style.display='none';return;}
      tip.innerHTML=supplyTraceTooltipHtml(hit);
      var width=Math.max(0,Math.min(330,container.clientWidth-8));
      var rect=container.getBoundingClientRect(), top=Math.max(4,4-rect.top), bottom=Math.min(container.clientHeight-4,(global.innerHeight || rect.bottom)-rect.top-4);
      tip.style.width=width+'px'; tip.style.maxHeight=Math.max(0,Math.min(340,bottom-top))+'px'; tip.style.display='block';
      tip.style.left=Math.max(4,Math.min(point.x+12,container.clientWidth-width-4))+'px';
      tip.style.top=Math.max(top,Math.min(point.y+14,bottom-tip.offsetHeight))+'px';
    }
    chart.subscribeCrosshairMove(handler);
    return function(){chart.unsubscribeCrosshairMove(handler);tip.remove();};
  }
  function setSupplyTraceMarkers(LWC, series, bars, enabled, holder) {
    holder=holder || {}; holder.supplyEnabled=!!enabled;
    var hits=enabled?supplyTraceBars(bars):[], counts=supplyTraceSummary(enabled?bars:[],hits);
    if(holder.tipCleanup){holder.tipCleanup();holder.tipCleanup=null;}
    if(holder.densityCleanup){holder.densityCleanup();holder.densityCleanup=null;}
    var mode=holder.supplyMode || 'detail',events=enabled?supplyDisplayEvents(bars,hits,mode):[];
    counts.mode=mode;counts.selected=events.length;
    if(holder.legendCleanup){holder.legendCleanup();holder.legendCleanup=null;}
    if(enabled && holder.container){
      var legend=document.createElement('div');legend.className='nine-trace-legend';
      legend.dataset.study='trace';
      legend.innerHTML='<span style="color:'+SUPPLY_TRACES.color+'">● 거래량</span> <span style="color:#7950b2">■ 112·224·448선</span> <span style="color:'+CANDLE_UP+'">▲ 고가 재돌파</span>';
      legend.title='일봉 OHLCV 관찰값이며 실제 수급 주체를 뜻하지 않습니다. 장기선은 112/224/448일 단순이동평균입니다. 고가 재돌파는 대량 윗꼬리봉 이후 저점 방어와 그 봉의 고가를 종가로 다시 넘긴 관찰값이며, 장기선 회복과 다릅니다.'+(mode==='important'?' 중요 모드는 검증 통과 유형만 표시하며 현재 통과 유형은 없습니다.':'');
      legend.style.cssText='position:absolute;z-index:8;left:8px;right:76px;font-size:11px;line-height:1.5;white-space:normal;';
      holder.container.appendChild(legend);
      var legendFrame=global.requestAnimationFrame(function(){
        var header=holder.container.querySelector('.ss-price-study-label');
        if(header){legend.style.cssText='display:inline-flex;gap:6px;white-space:nowrap;pointer-events:auto;';header.appendChild(legend);
          var order=holder.studyOrder || [];Array.from(header.children).sort(function(a,b){return order.indexOf(a.dataset.study)-order.indexOf(b.dataset.study);}).forEach(function(el){header.appendChild(el);});
        }
        studyHeaderBottom(holder.container);holder.container.dispatchEvent(new Event('nine-study-header-change'));
      });
      holder.legendCleanup=function(){global.cancelAnimationFrame(legendFrame);legend.remove();};
    }
    if(holder.container)holder.container.dispatchEvent(new Event('nine-study-header-change'));

    if(enabled && holder.chart && holder.container && mode==='detail')holder.tipCleanup=attachSupplyTraceTooltip(holder.chart,holder.container,bars,hits);
    function paint(){
      var range=holder.chart?holder.chart.timeScale().getVisibleLogicalRange():null,width=holder.container?Math.max(1,holder.container.clientWidth-76):1;
      var merged=(holder.base || []).concat(holder.trend || [],supplyDisplayMarkers(events,range,width)).sort(function(a,b){return a.time<b.time?-1:a.time>b.time?1:0;});
      if(typeof LWC.createSeriesMarkers==='function') {
        if(holder.plugin && holder.plugin.setMarkers)holder.plugin.setMarkers(merged);
        else if(merged.length)holder.plugin=LWC.createSeriesMarkers(series,merged);
      }
    }
    paint();
    if(holder.chart && enabled){
      var ts=holder.chart.timeScale(),ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(paint):null;
      ts.subscribeVisibleLogicalRangeChange(paint);if(ro && holder.container)ro.observe(holder.container);
      holder.densityCleanup=function(){ts.unsubscribeVisibleLogicalRangeChange(paint);if(ro)ro.disconnect();};
    }
    return counts;
  }

  global.NineChartCore = {
    REGIME:REGIME,trendRegimes:trendRegimes,trendRegimeLegendHtml:trendRegimeLegendHtml,majorWaveContext:majorWaveContext,
    SUPPLY_DISPLAY:SUPPLY_DISPLAY,supplyDisplayEvents:supplyDisplayEvents,supplyDisplayMarkers:supplyDisplayMarkers,
    SUPPLY_TRACES: SUPPLY_TRACES, supplyTraceBars: supplyTraceBars, supplyTraceMarkers: supplyTraceMarkers, supplyTraceSummary: supplyTraceSummary, supplyTraceLegendHtml: supplyTraceLegendHtml, supplyTraceTooltipHtml: supplyTraceTooltipHtml, attachSupplyTraceTooltip: attachSupplyTraceTooltip, setSupplyTraceMarkers: setSupplyTraceMarkers,
    VERSION: VERSION, ROOT: ROOT, LWC_URL: LWC_URL,
    CANDLE_UP: CANDLE_UP, CANDLE_DOWN: CANDLE_DOWN, ICHIMOKU: ICHIMOKU,
    ICHIMOKU_CLOUD_FILL: ICHIMOKU_CLOUD_FILL, ICHIMOKU_BORDER_COLOR: ICHIMOKU_BORDER_COLOR,
    loadLibrary: loadLibrary, loadModule: loadModule, moduleUrl: moduleUrl, ready: ready, prefetch: prefetch,
    isDark: isDark, themeColors: themeColors, chartOptions: chartOptions, themeUpdateOptions: themeUpdateOptions, profiles: PROFILES,
    ma224Color: ma224Color, maStudies: maStudies,
    onThemeChange: onThemeChange, observeResize: observeResize, createScope: createScope,
    registerChart: registerChart, zoomBars: zoomBars, fitBars: fitBars, installSmoothWheelZoom: installSmoothWheelZoom,
    movingAveragePoints: movingAveragePoints, bollingerPoints: bollingerPoints, addBollingerBands: addBollingerBands, installVerticalPan: installVerticalPan, chartDate: chartDate, compactVolume: compactVolume,
    candleOptions: candleOptions, addCandles: addCandles, addMovingAverageLine: addMovingAverageLine, addVolumePane: addVolumePane,
    futureBarTimes: futureBarTimes, rollingMidpoint: rollingMidpoint, ichimokuCloudPoints: ichimokuCloudPoints, createCloudPrimitive: createCloudPrimitive,
    priceText: priceText, mergeOptions: mergeOptions,
    volumeSpikeMultiples: volumeSpikeMultiples, accumulationBars: accumulationBars, accumulationMarkers: accumulationMarkers, accumulationSummary: accumulationSummary, accumulationLegendHtml: accumulationLegendHtml, volumeMultiples: volumeMultiples, trendStates: trendStates, trendSummary: trendSummary, trendMarkers: trendMarkers, trendLegendHtml: trendLegendHtml, setTrendMarkers: setTrendMarkers, TREND: TREND, attachAccumulationTooltip: attachAccumulationTooltip, setAccumulationMarkers: setAccumulationMarkers, ACCUMULATION: ACCUMULATION
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartCore;
})(typeof window !== 'undefined' ? window : globalThis);
