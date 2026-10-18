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

  var VERSION = '2026-10-14-core-4';
  var LWC_URL = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var CANDLE_UP = '#d24f45';       // 상승 빨강
  var CANDLE_DOWN = '#1261c4';     // 하락 파랑
  var ICHIMOKU_CLOUD_FILL = 'rgba(90,170,215,0.4)';
  var ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)';
  var ICHIMOKU = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };
  var MA_STUDIES = [
    { key: 'ma5', period: 5, color: '#d24f45', width: 1 },
    { key: 'ma20', period: 20, color: '#1261c4', width: 1 },
    { key: 'ma60', period: 60, color: '#0ca678', width: 1 },
    { key: 'ma224', period: 224, color: null, width: 3 }   // 224일선은 테마에 따라 검정/밝은 회색
  ];

  // ---- 자산 주소(이 스크립트가 실제로 내려온 곳 기준 - 운영은 GitHub Pages, 로컬 점검은 로컬 서버) ----
  var DOC = typeof document !== 'undefined' ? document : null;
  var SELF_SRC = (DOC && DOC.currentScript && DOC.currentScript.src) || '';
  var ROOT = (SELF_SRC.match(/^(.*\/)js\/chart-core\.js/) || [])[1] || 'https://goodbyestarwars.github.io/tistory-ticker/';
  var MODULES = {
    data: { file: 'js/chart-data.js', global: 'NineChartData', v: '20261014-history2' },
    drawing: { file: 'js/chart-drawing.js', global: 'NineChartDrawing', v: '20261014-core1' },
    wave: { file: 'js/chart-wave-overlay.js', global: 'NineChartWave', v: '20261014-core1', needs: ['data', 'autowave'] },
    autowave: { file: 'js/auto-wave.js', global: 'AutoWave', v: '20261013-hier' },
    memo: { file: 'js/chart-memo.js', global: 'NineChartMemo', v: '' },
    sr: { file: 'js/chart-sr.js', global: 'NineChartSR', v: '20261018-sr-trend' }
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
      text: dark ? '#aaa' : '#555', grid: dark ? '#3a3a3a' : '#eee', border: dark ? '#3a3a3a' : '#ddd',
      paneSep: dark ? '#3a3a3a' : '#e5e7eb', paneSepHover: dark ? '#666' : '#cbd5e1', label: dark ? '#2a2a2a' : '#555'
    };
  }

  // 화면별 차이는 profile 로 둔다(같은 부품, 다른 설정). 기본값은 지금 화면들이 쓰던 값 그대로다.
  //   search  - 차트검색·실시간 시세: 본문 글꼴, 패널 구분선 고정, 캔들 아래 여백 8%, 분봉이면 시:분 표시
  //   analysis - 종목분석: 패널 구분선 드래그, 캔들 아래 여백 36%, 최소 봉 간격 2
  var PROFILES = {
    search: {
      font: true, enableResize: true, margins: { top: 0.06, bottom: 0.08 },
      timeScale: function (tf) { return { rightOffset: 6, minBarSpacing: 3, timeVisible: tf === 'minute', secondsVisible: false, barSpacing: tf === 'minute' ? 9 : 7 }; },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    },
    analysis: {
      font: true, enableResize: true, margins: { top: 0.06, bottom: 0.36 },
      timeScale: function () { return { rightOffset: 6, minBarSpacing: 2, timeVisible: false, secondsVisible: false }; },
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
    if (p.font && opts.fontFamily) layout.fontFamily = opts.fontFamily;
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
    container.style.touchAction = 'none';
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
      if (event.button !== 0 || (opts.isDrawing && opts.isDrawing())) return;
      if (event.target.closest && event.target.closest('button,input,select,textarea')) return;
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
    return Math.round(n).toLocaleString('ko-KR');
  }

  // ---- 시리즈 부품(옵션·호출 순서는 두 화면이 쓰던 그대로 - 화면은 필요한 순서로 호출만 한다) ----
  function candleOptions(priceFormat) {
    return {
      upColor: CANDLE_UP, downColor: CANDLE_DOWN,
      borderUpColor: CANDLE_UP, borderDownColor: CANDLE_DOWN,
      wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN,
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

  function maStudies(dark) {
    return MA_STUDIES.map(function (s) {
      return { key: s.key, period: s.period, width: s.width, color: s.key === 'ma224' ? ma224Color(dark) : s.color };
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
    volume.setData(bars.map(function (d) {
      return { time: d.date, value: Math.max(0, Number(d.volume) || 0), color: d.close >= d.open ? 'rgba(210,79,69,0.5)' : 'rgba(18,97,196,0.5)' };
    }));
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
    return { volume: volume, ma20: ma20, ma5: ma5 };
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
    return isUs ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString('ko-KR');
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }


  // ---- 대량거래 흔적 표시(매집봉이라 부르지 않는다: 실제 매집 확인이 아님) (2026-10-16 사용자 요청, 2026-10-17 단순화, 2026-10-18 윗꼬리형 추가) ----
  // 세 가지만 찍는다. 모두 그날 알 수 있는 정보만 쓰고(미래 봉·사후 상승 여부로 색을 바꾸지 않는다) 매수 신호나 매집 확정이 아니다.
  //  - 대량 양봉(주황)  : scripts/cloud-vm/volume_accumulation.py find_accumulation_bar 와 같은 기준 - 거래량 직전 20일 평균의 2.5배 이상
  //                       + 양봉 몸통 2% 이상 + 종가가 그날 범위의 상위 40%(위치 0.6 이상) + 거래대금 30억원 이상.
  //  - 윗꼬리형(보라)   : 연구용 가설 - 윗꼬리가 범위의 40% 이상 + 몸통 절댓값 3% 이하 + 거래량 직전 20일 평균의 2배 이상 + 거래대금 30억원 이상.
  //                       5년 일봉 시험(docs/ACCUMULATION_MFE_CHART_2026-10-18.md)에서 기준선보다 나은 근거가 없어 관찰용으로만 둔다.
  //  - 털기?(회색)      : 위 두 조건 중 하나를 만족하지만 직전 20봉이 +25% 이상 오른 뒤에 나온 봉(상승 과열 뒤 위험 의심).
  // 한 봉은 하나의 표시만 받는다: 털기? > 대량 양봉 > 윗꼬리형 (대량 양봉 조건을 먼저 보고, 어느 쪽이든 과열이면 털기?).
  // 일봉·국내 종목에서만 쓴다.
  var ACCUMULATION = { volMult: 2.5, minBodyPct: 2.0, closePosMin: 0.6, amountMin: 3000000000, avgBars: 20, color: '#e8590c',
    runupBars: 20, distributionRunup: 0.25,
    wickVolMult: 2.0, wickMinRatio: 0.4, wickMaxBodyPct: 3.0, highBars: 60 };

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

  // 반환: [{ index, date, kind, status, multiple, wickPct, openChange, fromHigh, position, highDist, ma112Dist, ma224Dist, runup }]
  //   kind   = 'volume'(대량 양봉 조건) | 'wick'(윗꼬리형 조건)
  //   status = 'accumulation'(대량 양봉) | 'wick'(윗꼬리형) | 'distribution'(털기?)
  function accumulationBars(bars) {
    var out = [];
    if (!bars || bars.length <= ACCUMULATION.avgBars) return out;
    for (var i = ACCUMULATION.avgBars; i < bars.length; i++) {
      var b = bars[i];
      var o = accNumber(b.open), h = accNumber(b.high), l = accNumber(b.low), c = accNumber(b.close), v = accNumber(b.volume);
      if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c) || !isFinite(v) || o <= 0 || c <= 0 || h <= l) continue;
      var sum = 0, count = 0;
      for (var j = i - ACCUMULATION.avgBars; j < i; j++) {
        var pv = accNumber(bars[j].volume);
        if (isFinite(pv)) { sum += pv; count++; }
      }
      var avg = count ? sum / count : 0;
      if (!avg || c * v < ACCUMULATION.amountMin) continue;
      var kind = null;
      if (v >= ACCUMULATION.volMult * avg && c > o && (c / o - 1) * 100 >= ACCUMULATION.minBodyPct && (c - l) / (h - l) >= ACCUMULATION.closePosMin) {
        kind = 'volume';
      } else if (v >= ACCUMULATION.wickVolMult * avg && (h - Math.max(o, c)) / (h - l) >= ACCUMULATION.wickMinRatio
          && Math.abs(c / o - 1) * 100 <= ACCUMULATION.wickMaxBodyPct) {
        kind = 'wick';
      }
      if (!kind) continue;
      var before = i > ACCUMULATION.runupBars ? accNumber(bars[i - 1].close) / accNumber(bars[i - 1 - ACCUMULATION.runupBars].close) - 1 : NaN;
      var hot = isFinite(before) && before >= ACCUMULATION.distributionRunup;
      out.push({ index: i, date: b.date, kind: kind, status: hot ? 'distribution' : (kind === 'volume' ? 'accumulation' : 'wick'),
        multiple: v / avg, wickPct: (h - Math.max(o, c)) / (h - l) * 100, openChange: (c / o - 1) * 100, fromHigh: (c / h - 1) * 100, position: accPosition(bars, i), highDist: accHighDistance(bars, i),
        ma112Dist: accMaDistance(bars, i, 112), ma224Dist: accMaDistance(bars, i, 224), runup: isFinite(before) ? before * 100 : null });
    }
    return out;
  }

  // 2026-10-18 문구 정리: 주황·보라는 봉 모양(대량 양봉 / 대량 윗꼬리), 회색은 가격 위치(상승 과열 뒤 = 고점권)다. 모양과 위치를 한 이름에 섞지 않는다.
  // text 는 차트에 찍히는 짧은 이름, label 은 범례·툴팁의 전체 이름이다. 모두 관찰용이며 매집·분배를 확정하지 않는다.
  var ACC_MARKER = {
    accumulation: { color: '#e8590c', size: 1, text: '대량 양봉', label: '대량 양봉 · 매수 우위 관찰' },
    wick: { color: '#7c3aed', size: 1, text: '대량 윗꼬리', label: '대량 윗꼬리 · 매도압력 의심' },
    distribution: { color: '#4b5563', size: 1, text: '고점권 대량', label: '고점권 대량거래 · 분배 위험' }
  };

  function accumulationMarkers(bars) {
    return accumulationBars(bars).map(function (hit) {
      var style = ACC_MARKER[hit.status];
      return { time: hit.date, position: 'belowBar', color: style.color, shape: 'circle', size: style.size, text: style.text };
    });
  }

  function accumulationSummary(bars) {
    var counts = { accumulation: 0, wick: 0, distribution: 0 };
    accumulationBars(bars).forEach(function (hit) { counts[hit.status]++; });
    return counts;
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
      + 'box-shadow:0 2px 8px rgba(15,23,42,.18);border:1px solid ' + (dark ? 'rgba(245,239,224,.24)' : 'rgba(148,163,184,.52)') + ';'
      + 'background:' + (dark ? 'rgba(26,26,26,.95)' : 'rgba(255,255,255,.96)') + ';color:' + (dark ? '#F5EFE0' : '#334155') + ';';
    container.appendChild(tip);
    function dateKey(time) {
      if (typeof time === 'string') return time;
      if (time && typeof time === 'object' && time.year != null) return time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0');
      return '';
    }
    var onMove = function (param) {
      var hit = param && param.point ? byDate[dateKey(param.time)] : null;
      if (!hit) { tip.hidden = true; return; }
      var style = ACC_MARKER[hit.status];
      tip.innerHTML = '<b style="color:' + style.color + '">' + style.label + '</b><br><span style="opacity:.7">' + hit.date + ' · 관찰용, 매집·분배 확정 아님</span><br>'
        + '거래량 <b>' + hit.multiple.toFixed(1) + '배</b> · 윗꼬리 <b>' + hit.wickPct.toFixed(0) + '%</b><br>'
        + '시가 대비 <b>' + accSigned(hit.openChange) + '</b> · 고가 대비 <b>' + accSigned(hit.fromHigh) + '</b><br>'
        + '250봉 가격 위치 <b>' + (hit.position === null || hit.position === undefined ? '—' : hit.position.toFixed(0) + '%') + '</b><br>'
        + '직전 60봉 고점 대비 <b>' + accSigned(hit.highDist) + '</b><br>'
        + '112일선 대비 <b>' + accSigned(hit.ma112Dist) + '</b> · 224일선 대비 <b>' + accSigned(hit.ma224Dist) + '</b><br>'
        + '직전 20봉 <b>' + accSigned(hit.runup) + '</b>';
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

  // 시리즈에 마커를 건다. 같은 시리즈에 이미 다른 마커(예: 종목분석의 이벤트 표시)가 있으면 holder.base 와 합쳐 한 번에 건다.
  // holder: { plugin, base, chart, container } - 호출자가 들고 있다가 껐다 켤 때 같은 객체를 넘긴다. chart·container 가 있으면 툴팁도 함께 건다.
  // 반환: {accumulation, wick, distribution} 개수(꺼져 있으면 0).
  function setAccumulationMarkers(LWC, series, bars, enabled, holder) {
    holder = holder || {};
    var acc = enabled ? accumulationMarkers(bars) : [];
    var counts = enabled ? accumulationSummary(bars) : { accumulation: 0, wick: 0, distribution: 0 };
    if (holder.tipCleanup) { holder.tipCleanup(); holder.tipCleanup = null; }
    if (enabled && holder.chart && holder.container) holder.tipCleanup = attachAccumulationTooltip(holder.chart, holder.container, bars);
    var merged = (holder.base || []).concat(acc).sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    if (typeof LWC.createSeriesMarkers !== 'function') return counts;
    if (!holder.plugin) {
      if (!merged.length) return counts;
      holder.plugin = LWC.createSeriesMarkers(series, merged);
    } else if (typeof holder.plugin.setMarkers === 'function') {
      holder.plugin.setMarkers(merged);
    }
    return counts;
  }

  global.NineChartCore = {
    VERSION: VERSION, ROOT: ROOT, LWC_URL: LWC_URL,
    CANDLE_UP: CANDLE_UP, CANDLE_DOWN: CANDLE_DOWN, ICHIMOKU: ICHIMOKU,
    ICHIMOKU_CLOUD_FILL: ICHIMOKU_CLOUD_FILL, ICHIMOKU_BORDER_COLOR: ICHIMOKU_BORDER_COLOR,
    loadLibrary: loadLibrary, loadModule: loadModule, moduleUrl: moduleUrl, ready: ready, prefetch: prefetch,
    isDark: isDark, themeColors: themeColors, chartOptions: chartOptions, themeUpdateOptions: themeUpdateOptions, profiles: PROFILES,
    ma224Color: ma224Color, maStudies: maStudies,
    onThemeChange: onThemeChange, observeResize: observeResize, createScope: createScope,
    registerChart: registerChart, zoomBars: zoomBars, fitBars: fitBars,
    movingAveragePoints: movingAveragePoints, bollingerPoints: bollingerPoints, addBollingerBands: addBollingerBands, installVerticalPan: installVerticalPan, chartDate: chartDate, compactVolume: compactVolume,
    candleOptions: candleOptions, addCandles: addCandles, addMovingAverageLine: addMovingAverageLine, addVolumePane: addVolumePane,
    futureBarTimes: futureBarTimes, rollingMidpoint: rollingMidpoint, ichimokuCloudPoints: ichimokuCloudPoints, createCloudPrimitive: createCloudPrimitive,
    priceText: priceText, mergeOptions: mergeOptions,
    accumulationBars: accumulationBars, accumulationMarkers: accumulationMarkers, accumulationSummary: accumulationSummary, attachAccumulationTooltip: attachAccumulationTooltip, setAccumulationMarkers: setAccumulationMarkers, ACCUMULATION: ACCUMULATION
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartCore;
})(typeof window !== 'undefined' ? window : globalThis);
