/**
 * TradingView Lightweight Charts 공용 헬퍼 - js/home-dashboard.js 전용.
 * kospi-futures.js/foreign-flow.js/overnight-market.js/quick-indices.js/pattern-scan.js가
 * 각자 이 로직(로더/테마/destroy)을 중복 구현하고 있는데, 그 5개를 건드리면 회귀 위험이 있어
 * 손대지 않고, 신규 위젯(home-dashboard.js)이 6번째 중복을 만들지 않도록 공용 모듈로 뺐다.
 * 기존 5개 파일의 chartThemeOptions()/destroyChart() 등과 동일한 패턴(동일 CDN 버전, 동일
 * 색상값)을 그대로 따른다.
 */
(function (global) {
  'use strict';

  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var lwcLoadPromise = null;

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  // CDN에서 라이브러리를 1회만 지연 로드(이미 로드돼 있으면 즉시 resolve)
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

  // 9bolt 스킨의 html.dark 토글은 새로고침 없이 클래스만 바뀌므로, 다른 위젯들과 동일하게
  // 이 옵션을 다크모드 변경 시 재적용해야 한다(observeThemeChanges 참고).
  function chartThemeOptions() {
    var dark = isDark();
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(다른 차트 위젯들과 동일한 미해결 TODO).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  // document.documentElement의 class 변경(다크모드 토글)을 감시해 applyFn을 재호출한다.
  // 반환값(disconnect)을 호출하면 감시를 멈춘다 - destroyChart 시 같이 호출할 것.
  function observeThemeChanges(applyFn) {
    var observer = new MutationObserver(function () { applyFn(chartThemeOptions()); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return function disconnect() { observer.disconnect(); };
  }

  function destroyChart(chart) {
    if (!chart) return;
    try { chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  // 백엔드(KIS stck_bsop_date, 네이버 localDate, GAS flowChart)가 전부 'YYYYMMDD' 포맷을 주는데
  // Lightweight Charts는 business day 문자열로 'YYYY-MM-DD'(대시 포함)를 요구한다.
  function toLwcTime(yyyymmdd) {
    return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
  }

  global.LwcCommon = {
    loadLightweightCharts: loadLightweightCharts,
    chartThemeOptions: chartThemeOptions,
    observeThemeChanges: observeThemeChanges,
    destroyChart: destroyChart,
    mergeOptions: mergeOptions,
    toLwcTime: toLwcTime,
    isDark: isDark
  };
})(window);
