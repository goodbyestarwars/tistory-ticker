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

  var VERSION = '2026-10-14-core-1';
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
    data: { file: 'js/chart-data.js', global: 'NineChartData', v: '20261014-core1' },
    drawing: { file: 'js/chart-drawing.js', global: 'NineChartDrawing', v: '20261014-core1' },
    wave: { file: 'js/chart-wave-overlay.js', global: 'NineChartWave', v: '20261014-core1', needs: ['data', 'autowave'] },
    autowave: { file: 'js/auto-wave.js', global: 'AutoWave', v: '20261013-hier' },
    memo: { file: 'js/chart-memo.js', global: 'NineChartMemo', v: '' },
    sr: { file: 'js/chart-sr.js', global: 'NineChartSR', v: '20261012-current-price' }
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
      font: true, enableResize: false, margins: { top: 0.06, bottom: 0.08 },
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

  global.NineChartCore = {
    VERSION: VERSION, ROOT: ROOT, LWC_URL: LWC_URL,
    CANDLE_UP: CANDLE_UP, CANDLE_DOWN: CANDLE_DOWN, ICHIMOKU: ICHIMOKU,
    ICHIMOKU_CLOUD_FILL: ICHIMOKU_CLOUD_FILL, ICHIMOKU_BORDER_COLOR: ICHIMOKU_BORDER_COLOR,
    loadLibrary: loadLibrary, loadModule: loadModule, moduleUrl: moduleUrl, ready: ready, prefetch: prefetch,
    isDark: isDark, themeColors: themeColors, chartOptions: chartOptions, themeUpdateOptions: themeUpdateOptions, profiles: PROFILES,
    ma224Color: ma224Color, maStudies: maStudies,
    onThemeChange: onThemeChange, observeResize: observeResize, createScope: createScope,
    movingAveragePoints: movingAveragePoints, chartDate: chartDate, compactVolume: compactVolume,
    candleOptions: candleOptions, addCandles: addCandles, addMovingAverageLine: addMovingAverageLine, addVolumePane: addVolumePane,
    futureBarTimes: futureBarTimes, rollingMidpoint: rollingMidpoint, ichimokuCloudPoints: ichimokuCloudPoints, createCloudPrimitive: createCloudPrimitive,
    priceText: priceText, mergeOptions: mergeOptions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartCore;
})(typeof window !== 'undefined' ? window : globalThis);
