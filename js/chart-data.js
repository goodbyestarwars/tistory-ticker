/**
 * 차트 데이터 공통 부품(2026-10-14) - OHLCV 검증·집계·지문, 같은 요청의 중복 방지, 유효기간이 있는 캐시.
 *
 * 구분 키: 공급처(provider) · 종목 · (수정주가 여부) · 봉 종류 · 기간을 모두 키에 넣는다. 서로 다른 데이터를 같은 캐시로
 * 취급하지 않는다. 전송 방법(주소·제한 시간·대체 경로)은 화면이 fetcher 로 넘기고, 이 파일은 캐시·중복 요청 방지·
 * 검증만 맡는다. 같은 일봉(`/flow-chart/<종목>`)을 부르는 화면은 메모리 캐시와 탭 단위 sessionStorage 를 같이 쓴다(5분).
 */
(function (global) {
  'use strict';

  var FLOW_CHART_TTL_MS = 5 * 60 * 1000;
  var SESSION_PREFIX = 'nine-chart:v1:';
  var SESSION_MAX_ITEMS = 4;           // 탭 저장소에는 최근 4종목까지만(종목당 약 100KB)

  // ---- 공통 캐시: 유효기간 + 개수 상한 + 진행 중 요청 공유 ----
  function createCache(opts) {
    opts = opts || {};
    var ttl = opts.ttl || FLOW_CHART_TTL_MS, max = opts.max || 20;
    var items = {}, order = [], inflight = {};
    function touch(key) { var i = order.indexOf(key); if (i >= 0) order.splice(i, 1); order.push(key); }
    var cache = {
      get: function (key) {
        var hit = items[key];
        if (!hit) return null;
        if (Date.now() - hit.t >= ttl) { delete items[key]; var i = order.indexOf(key); if (i >= 0) order.splice(i, 1); return null; }
        touch(key);
        return hit;
      },
      set: function (key, value, t) {
        items[key] = { t: t || Date.now(), value: value };
        touch(key);
        while (order.length > max) delete items[order.shift()];
        return items[key];
      },
      // loader 는 같은 key 로 동시에 여러 번 불려도 한 번만 실행된다. 실패(예외)와 accept(value)===false 인 응답은 캐시하지 않는다.
      load: function (key, loader, accept) {
        var hit = cache.get(key);
        if (hit) return Promise.resolve(hit.value);
        if (inflight[key]) return inflight[key];
        var p = Promise.resolve().then(loader).then(function (value) {
          delete inflight[key];
          if (!accept || accept(value)) cache.set(key, value);
          return value;
        }, function (err) { delete inflight[key]; throw err; });
        inflight[key] = p;
        return p;
      },
      delete: function (key) { delete items[key]; var i = order.indexOf(key); if (i >= 0) order.splice(i, 1); },
      clear: function () { items = {}; order = []; inflight = {}; },
      size: function () { return order.length; }
    };
    return cache;
  }

  // ---- OHLCV 검증: 깨끗한 자료는 같은 객체를 그대로 돌려준다(복사·변형 없음) ----
  function isFiniteNumber(v) { return typeof v === 'number' ? isFinite(v) : (v != null && v !== '' && isFinite(Number(v))); }

  function validBar(b) {
    return !!b && b.date != null && b.date !== '' && isFiniteNumber(b.open) && isFiniteNumber(b.high) && isFiniteNumber(b.low) && isFiniteNumber(b.close)
      && Number(b.high) >= Number(b.low);
  }

  // 오름차순·날짜 중복 없음·유한한 OHLC 만 남긴다. 같은 날짜가 둘이면 뒤의 것을 쓴다(정정 반영).
  function normalizeBars(rows) {
    if (!Array.isArray(rows)) return [];
    var clean = true, i;
    for (i = 0; i < rows.length; i++) {
      if (!validBar(rows[i]) || (i && String(rows[i].date) <= String(rows[i - 1].date))) { clean = false; break; }
    }
    if (clean) return rows;
    var byDate = {}, dates = [];
    rows.forEach(function (b) {
      if (!validBar(b)) return;
      var d = String(b.date);
      if (!Object.prototype.hasOwnProperty.call(byDate, d)) dates.push(d);
      byDate[d] = b;
    });
    dates.sort();
    return dates.map(function (d) { return byDate[d]; });
  }

  // 데이터 지문(FNV-1a): 과거 봉이 정정됐는데 마지막 봉만 같아도 캐시를 새로 만들게 한다(js/auto-wave.js 의 hashBars 와 같은 식).
  function fingerprint(bars) {
    var h = 0x811c9dc5;
    function mix(text) {
      for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
      h ^= 0x2c; h = (h * 0x01000193) >>> 0;
    }
    for (var k = 0; k < bars.length; k++) {
      var b = bars[k];
      mix(String(b.date)); mix(String(b.open)); mix(String(b.high)); mix(String(b.low)); mix(String(b.close)); mix(String(b.volume));
    }
    return bars.length + ':' + h.toString(16);
  }

  // ---- 주봉·월봉(일봉에서 계산: open=구간 첫날, close=마지막날, high/low=최대/최소, volume=합) ----
  function aggregateBars(daily, groupKeyFn) {
    var groups = [], byKey = {};
    daily.forEach(function (d) {
      var key = groupKeyFn(d.date), g = byKey[key];
      if (!g) {
        g = { date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume || 0 };
        byKey[key] = g;
        groups.push(g);
      } else {
        g.high = Math.max(g.high, d.high);
        g.low = Math.min(g.low, d.low);
        g.close = d.close;
        g.date = d.date;   // 구간의 마지막 날짜를 대표 시각으로
        g.volume += (d.volume || 0);
      }
    });
    return groups;
  }

  function isoWeekKey(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = (d.getUTCDay() + 6) % 7;            // 월요일=0
    d.setUTCDate(d.getUTCDate() - day + 3);       // 그 주 목요일(ISO 주차 관례)
    var firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return d.getUTCFullYear() + '-W' + week;
  }
  function monthKey(dateStr) { return dateStr.slice(0, 7); }

  function barsForTimeframe(daily, tf) {
    if (tf === 'week') return aggregateBars(daily, isoWeekKey);
    if (tf === 'month') return aggregateBars(daily, monthKey);
    return daily;
  }

  // ---- 일봉 차트 응답(/flow-chart) 공유 가져오기 ----
  var flowChartCache = createCache({ ttl: FLOW_CHART_TTL_MS, max: 20 });

  function sessionStore() { try { return global.sessionStorage || null; } catch (e) { return null; } }

  function sessionRead(key) {
    var store = sessionStore();
    if (!store) return null;
    try {
      var raw = store.getItem(SESSION_PREFIX + key);
      if (!raw) return null;
      var hit = JSON.parse(raw);
      if (!hit || Date.now() - hit.t >= FLOW_CHART_TTL_MS || !hit.data) { store.removeItem(SESSION_PREFIX + key); return null; }
      return hit;
    } catch (e) { return null; }
  }

  function sessionWrite(key, data, t) {
    var store = sessionStore();
    if (!store) return;
    try {
      var indexKey = SESSION_PREFIX + 'index';
      var index = JSON.parse(store.getItem(indexKey) || '[]').filter(function (k) { return k !== key; });
      index.push(key);
      while (index.length > SESSION_MAX_ITEMS) store.removeItem(SESSION_PREFIX + index.shift());
      store.setItem(SESSION_PREFIX + key, JSON.stringify({ t: t, data: data }));
      store.setItem(indexKey, JSON.stringify(index));
    } catch (e) { /* 용량 초과·차단: 저장만 건너뛰고 화면은 그대로 */ }
  }

  function usable(data) { return !!data && !data.error && Array.isArray(data.daily) && data.daily.length > 0; }

  function flowChartKey(code, adjust) { return ['flow-chart', String(code || '').toUpperCase(), adjust || 'server'].join('|'); }

  // fetcher(code) -> Promise<{daily, ma, levels, ...}>. 같은 키는 진행 중 요청도 공유하고, 성공한 응답만 저장한다.
  function fetchFlowChart(code, fetcher, opts) {
    opts = opts || {};
    var key = flowChartKey(code, opts.adjust);
    if (opts.force) flowChartCache.delete(key);
    var hit = flowChartCache.get(key);
    if (hit) return Promise.resolve(hit.value);
    var fromSession = !opts.force ? sessionRead(key) : null;
    if (fromSession) { flowChartCache.set(key, fromSession.data, fromSession.t); return Promise.resolve(fromSession.data); }
    return flowChartCache.load(key, function () {
      var t = Date.now();
      return Promise.resolve(fetcher(code)).then(function (data) {
        if (usable(data)) {
          data.daily = normalizeBars(data.daily);
          if (!opts.noSession && !data.source) sessionWrite(key, data, t);     // 임시 대체 자료(source 표시)는 탭 저장소에 두지 않는다
        }
        return data;
      });
    }, usable);
  }

  // 엔진이 아직 없을 때 화면이 바로 받아 둔 응답을 엔진이 올라온 뒤 캐시에 넣어 준다(같은 종목 재조회에서 다시 받지 않게).
  function primeFlowChart(code, data, adjust) {
    if (!usable(data)) return data;
    var key = flowChartKey(code, adjust), t = Date.now();
    data.daily = normalizeBars(data.daily);
    flowChartCache.set(key, data, t);
    if (!data.source) sessionWrite(key, data, t);
    return data;
  }

  var chartRanges = {};
  var viewportOverrides = {};
  var loadingRanges = {};
  var RANGE_OPTIONS = [
    ['1m', '1개월', 30], ['3m', '3개월', 91], ['6m', '6개월', 183],
    ['1y', '1년', 366], ['3y', '3년', 1096], ['5y', '5년', 1830], ['all', '전체', 1830]
  ];
  function selectedRange(code) { return chartRanges[code] || '1y'; }
  function rangeDates(bars, code) {
    if (viewportOverrides[code]) return viewportOverrides[code];
    if (!bars || !bars.length) return null;
    var choice = RANGE_OPTIONS.filter(function (o) { return o[0] === selectedRange(code); })[0];
    if (!choice || !choice[2]) return { from: bars[0].date, to: bars[bars.length - 1].date };
    var end = bars[bars.length - 1].date;
    var start = new Date(end + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - choice[2]);
    return { from: [start.toISOString().slice(0, 10), bars[0].date].sort()[1], to: end };
  }
  function installRangeButtons(chartElement, code, getData, onData) {
    var parent = chartElement && chartElement.parentElement;
    var isUs = /^US:[A-Z0-9.\-]+$/i.test(code);
    if (!parent || (!/^[0-9]{6}$/.test(code) && !isUs)) return;
    var wrap = parent.querySelector('.nine-chart-ranges');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'nine-chart-ranges';   // 모양은 css/ui-system.css(.nine-chart-ranges) - 사이트 탭(.ss-tf-btn)과 같은 스타일
      parent.insertBefore(wrap, chartElement);
    }
    wrap.hidden = false;
    var options = isUs ? RANGE_OPTIONS.filter(function (o) { return o[0] !== '3y' && o[0] !== '5y'; }) : RANGE_OPTIONS;
    wrap.innerHTML = options.map(function (o) {
      var on = selectedRange(code) === o[0];
      return '<button type="button" class="nine-range-btn' + (on ? ' active' : '') + '" data-range="' + o[0] + '" aria-pressed="' + on + '">' + o[1] + '</button>';
    }).join('') + '<span class="nine-chart-range-status" aria-live="polite"></span>';
    wrap.onclick = function (event) {
      var button = event.target.closest('[data-range]');
      if (!button) return;
      var choice = button.getAttribute('data-range');
      chartRanges[code] = choice;
      if (wrap.dataset.scrollLoading !== '1') delete viewportOverrides[code];
      delete wrap.dataset.scrollLoading;
      var extended = !isUs && (choice === '3y' || choice === '5y' || choice === 'all');
      var status = wrap.querySelector('.nine-chart-range-status');
      if (extended && (!getData() || !getData().extendedHistory)) {
        if (loadingRanges[code]) return;
        loadingRanges[code] = true;
        status.textContent = '과거 데이터 불러오는 중…';
        fetchFlowChart(code, function (c) {
          var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var timer = controller ? setTimeout(function () { controller.abort(); }, 50000) : null;
          return fetch('https://goodbyestar.cloud/flow-chart/' + encodeURIComponent(c) + '?history=5y',
            controller ? { signal: controller.signal } : {})
            .then(function (r) { if (!r.ok) throw new Error('HISTORY_HTTP'); return r.json(); })
            .then(function (r) { return r && r.data ? r.data : r; })
            .finally(function () { if (timer) clearTimeout(timer); });
        }, { adjust: '5y', noSession: true, force: true }).then(function (data) {
          if (data && data.daily && data.daily.length) { data.extendedHistory = !!data.historyAttempted; onData(data); }
          var current = parent.querySelector('.nine-chart-range-status');
          if (current) current.textContent = data && data.historyAttempted ? '' : '저장된 데이터만 표시';
        }).catch(function () {
          onData(getData());
          var current = parent.querySelector('.nine-chart-range-status');
          if (current) current.textContent = '저장된 데이터만 표시';
        })
          .finally(function () { delete loadingRanges[code]; });
      } else onData(getData());
    };
  }
  function loadOnLeftScroll(chart, chartElement, code, getData) {
    if (!chart || !chart.timeScale || !/^[0-9]{6}$/.test(code)) return;
    var seenAwayFromStart = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
      if (range && range.from > 20) seenAwayFromStart = true;
      if (!seenAwayFromStart) return;
      if (!range || range.from > 12 || loadingRanges[code] || (getData() && getData().extendedHistory)) return;
      var button = chartElement.parentElement.querySelector('.nine-chart-ranges [data-range="5y"]');
      if (!button) return;
      viewportOverrides[code] = chart.timeScale().getVisibleRange();
      button.parentElement.dataset.scrollLoading = '1';
      button.click();
    });
  }

  global.NineChartData = {
    FLOW_CHART_TTL_MS: FLOW_CHART_TTL_MS,
    createCache: createCache, normalizeBars: normalizeBars, fingerprint: fingerprint,
    aggregateBars: aggregateBars, isoWeekKey: isoWeekKey, monthKey: monthKey, barsForTimeframe: barsForTimeframe,
    flowChartKey: flowChartKey, fetchFlowChart: fetchFlowChart, primeFlowChart: primeFlowChart,
    selectedRange: selectedRange, rangeDates: rangeDates, installRangeButtons: installRangeButtons,
    loadOnLeftScroll: loadOnLeftScroll,
    _flowChartCache: flowChartCache
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartData;
})(typeof window !== 'undefined' ? window : globalThis);
