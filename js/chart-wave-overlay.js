/**
 * 자동 파동 표시 공통 모듈(2026-10-14) - 차트검색·실시간 시세(stock-search.js)와 종목분석(foreign-flow.js)이 같은 분석·같은 그림을 쓴다.
 *
 * 분석 엔진은 js/auto-wave.js(대·중·소 3계층) 하나뿐이다. 이 파일은 (1) 분석 결과 캐시(종목·봉 주기·전체 OHLCV 지문·엔진 버전),
 * (2) 규모 선택(대·중·소) 제어와 마크업, (3) 차트 위 박스·라벨·상위 윤곽 그리기(chart-drawing 의 오버레이 층)를 맡는다.
 * 분석은 데이터가 바뀔 때만 다시 하고, 규모 전환·확대·이동은 계산 없이 좌표만 다시 그린다.
 *
 * 실험 기능이다: 가격 구조를 설명할 뿐 매수·매도 추천이나 미래 방향을 말하지 않는다. 진행 중(점선) 파동은 새 봉이 들어오면 바뀔 수 있다.
 */
(function (global) {
  'use strict';

  var LEVELS = [
    { key: 'major', label: '대파동', tip: '주된 방향(큰 상승·하락, 긴 횡보·바닥). 확정이 가장 늦다' },
    { key: 'medium', label: '중파동', tip: '스윙매매 규모의 상승·조정·재상승(기본)' },
    { key: 'minor', label: '소파동', tip: '짧은 눌림·재돌파·단기 저점 상승. 가장 빨리 확정되지만 잡음이 많다' }
  ];
  var LEVEL_NAME = { major: '대파동', medium: '중파동', minor: '소파동' };
  var STYLE = {
    up: { stroke: '#e34d4b', fill: 'rgba(227,77,75,.10)', label: '상승 파동' },
    down: { stroke: '#2674d9', fill: 'rgba(38,116,217,.10)', label: '하락 파동' },
    side: { stroke: '#808080', fill: 'rgba(128,128,128,.12)', label: '횡보' },
    wide: { stroke: '#7c6f9a', fill: 'rgba(124,111,154,.10)', label: '변동성 큰 박스권' },
    unk: { stroke: '#a0a0a0', fill: 'rgba(160,160,160,.05)', label: '방향 미확정' }
  };
  var TIP = '실험 기능: 가격 움직임의 구조를 상승(빨강)·하락(파랑)·횡보(회색)·변동성 큰 박스권(보라 회색) 박스로 나눠 보여줍니다. 대·중·소 규모를 고를 수 있고(기본 중파동) 한 단계 위 규모는 옅은 점선 윤곽으로 함께 보입니다. 극점은 되돌림이 확인된 뒤에 확정되고, 점선(진행 중·방향 미확정) 구간은 새 봉이 들어오면 바뀔 수 있습니다. 매수·매도 추천이 아닙니다.';

  // ---- 분석 결과 캐시(페이지 안의 모든 차트가 공유) ----
  var data = global.NineChartData;
  var cache = null;
  var pending = Object.create(null), worker = null, jobs = Object.create(null), nextJob = 0;
  function getCache() {
    if (!cache) {
      var D = global.NineChartData;
      cache = D ? D.createCache({ ttl: 30 * 60 * 1000, max: 12 }) : { get: function () { return null; }, set: function () {} };
    }
    return cache;
  }

  function fingerprintOf(bars) {
    var AW = global.AutoWave;
    if (AW && typeof AW.hashBars === 'function') return AW.hashBars(bars);
    return bars.length + ':' + (bars.length ? bars[bars.length - 1].date + ',' + bars[bars.length - 1].close : '');
  }

  // 같은 종목·봉 주기·전체 OHLCV·엔진 버전이면 결과를 재사용한다. 과거 봉이 정정돼 지문이 달라지면 새로 계산한다.
  function analysis(bars, key, timeframe) {
    var AW = global.AutoWave;
    if (!AW) return null;
    var cacheKey = [key, timeframe, fingerprintOf(bars), AW.version || ''].join('|');
    var c = getCache(), hit = c.get(cacheKey);
    if (hit) return hit.value;
    var result;
    try {
      if (typeof AW.analyze === 'function') result = AW.analyze(bars);
      else result = { levels: { medium: AW.detectWaves(bars) }, state: null };   // 옛 모듈(대·중·소 없음) 호환
    } catch (e) { result = { levels: { major: [], medium: [], minor: [] }, state: null }; }
    c.set(cacheKey, result);
    return result;
  }

  // The initial analysis can scan many candidate boxes. Keep it off the UI thread;
  // the promise and the completed result are shared by both chart features.
  function analysisAsync(bars, key, timeframe, core) {
    var AW = global.AutoWave;
    if (!AW) return Promise.reject(new Error('파동 엔진이 없습니다.'));
    var cacheKey = [key, timeframe, fingerprintOf(bars), AW.version || ''].join('|');
    var c = getCache(), hit = c.get(cacheKey);
    if (hit) return Promise.resolve(hit.value);
    if (pending[cacheKey]) return pending[cacheKey];
    if (!global.Worker || !global.Blob || !global.URL || !global.URL.createObjectURL) {
      return Promise.reject(new Error('이 브라우저는 파동 계산 Worker를 지원하지 않습니다.'));
    }
    if (!worker) {
      var source = "var loaded='';self.onmessage=function(e){try{if(loaded!==e.data.url){importScripts(e.data.url);loaded=e.data.url;}self.postMessage({id:e.data.id,result:self.AutoWave.analyze(e.data.bars)});}catch(err){self.postMessage({id:e.data.id,error:String(err)});}};";
      var url = global.URL.createObjectURL(new global.Blob([source], { type: 'text/javascript' }));
      try { worker = new global.Worker(url); } finally { global.URL.revokeObjectURL(url); }
      worker.onmessage = function (event) {
        var job = jobs[event.data.id];
        if (!job) return;
        delete jobs[event.data.id];
        if (event.data.error) job.reject(new Error(event.data.error));
        else job.resolve(event.data.result);
      };
      worker.onerror = function () {
        Object.keys(jobs).forEach(function (id) { jobs[id].reject(new Error('파동 계산 Worker 오류')); delete jobs[id]; });
        worker.terminate(); worker = null;
      };
    }
    var id = ++nextJob;
    pending[cacheKey] = new Promise(function (resolve, reject) {
      jobs[id] = { resolve: resolve, reject: reject };
      try { worker.postMessage({ id: id, url: (core || global.NineChartCore).moduleUrl('autowave'), bars: bars }); }
      catch (e) { delete jobs[id]; reject(e); }
    }).then(function (result) { c.set(cacheKey, result); return result; }).finally(function () { delete pending[cacheKey]; });
    return pending[cacheKey];
  }

  // 선택한 규모의 파동(박스에 가려진 것 제외)과, 한 단계 위 규모의 옅은 윤곽(부모)을 고른다.
  function pickLevel(result, level) {
    var lv = result.levels && result.levels[level] ? level : 'medium';
    var parentName = lv === 'minor' ? 'medium' : (lv === 'medium' ? 'major' : null);
    return {
      level: lv,
      waves: (result.levels[lv] || []).filter(function (w) { return !w.suppressed; }),
      parents: parentName ? (result.levels[parentName] || []).filter(function (w) { return !w.suppressed; }) : [],
      summary: result.state ? result.state.summaryText : ''
    };
  }

  // ---- 마크업·제어 ----
  // 규모 선택 묶음. prefix 는 화면별 CSS 이름(ss → ss-wave-level / ff → ff-wave-level). 파동 분석이 꺼져 있으면 숨긴다.
  function levelHtml(prefix, enabled, level) {
    return '<span class="' + prefix + '-wave-level" data-chart-wave-level role="group" aria-label="파동 규모"' + (enabled ? '' : ' hidden') + '>'
      + LEVELS.map(function (lv) {
        var on = lv.key === level;
        return '<button type="button" class="' + prefix + '-wave-btn' + (on ? ' active' : '') + '" data-wave-level="' + lv.key + '" aria-pressed="' + on + '" title="' + lv.tip + '">' + lv.label + '</button>';
      }).join('') + '</span>';
  }

  // 체크박스 + 규모 단추를 연결한다. state: { enabled, level }(화면이 들고 있는 값). onChange(kind) 는 'toggle' | 'level'.
  // 화면은 셸을 먼저 그려야 해서 규모 묶음을 비워 둔 채(hidden) 내보낸다 - 여기서 단추를 채워 마크업을 이 파일 한 곳에 둔다.
  function wireControls(root, state, onChange, prefix) {
    var toggle = root.querySelector('[data-chart-wave-toggle]');
    var box = root.querySelector('[data-chart-wave-level]');
    if (box && !box.querySelector('[data-wave-level]')) {
      var p = prefix || (box.className.match(/([a-z]+)-wave-level/) || [])[1] || 'ss';
      box.innerHTML = levelHtml(p, state.enabled, state.level).replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '');
    }
    function sync() {
      if (!box) return;
      box.hidden = !state.enabled;
      Array.prototype.forEach.call(box.querySelectorAll('[data-wave-level]'), function (btn) {
        var on = btn.getAttribute('data-wave-level') === state.level;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    }
    if (toggle) {
      toggle.checked = state.enabled;
      toggle.onchange = function () { state.enabled = toggle.checked; sync(); onChange('toggle'); };
    }
    if (box) {
      sync();
      box.onclick = function (event) {
        var btn = event.target.closest ? event.target.closest('[data-wave-level]') : null;
        if (!btn) return;
        state.level = btn.getAttribute('data-wave-level');
        sync();
        onChange('level');   // 분석은 캐시를 재사용하고 규모만 바꿔 다시 그린다
      };
    }
    return { sync: sync };
  }

  // ---- 그리기(오버레이 층용) ----
  // font: 박스 라벨 글꼴, summaryFont: 맨 위 한 줄 요약 글꼴(차트검색은 예전처럼 sans-serif, 종목분석은 화면 글꼴).
  function drawWaves(ctx, view, picked, font, summaryFont, summaryTop) {
    var waves = picked && picked.waves, bars = view.bars || [];
    if (!waves || bars.length < 2) return;
    var level = picked.level || 'medium';
    var xa = view.coord({ time: bars[bars.length - 2].date, price: bars[bars.length - 2].close });
    var xb = view.coord({ time: bars[bars.length - 1].date, price: bars[bars.length - 1].close });
    var half = xa && xb ? Math.max(1, Math.abs(xb.x - xa.x) / 2) : 2;
    function rectOf(wave) {
      var b0 = bars[wave.start], b1 = bars[wave.end];
      if (!b0 || !b1) return null;
      var p0 = view.coord({ time: b0.date, price: wave.high });
      var p1 = view.coord({ time: b1.date, price: wave.low });
      if (!p0 || !p1) return null;
      var r = { x1: Math.min(p0.x, p1.x) - half, x2: Math.max(p0.x, p1.x) + half, y1: Math.min(p0.y, p1.y), y2: Math.max(p0.y, p1.y) };
      // 화면 밖 구간은 그리지 않는다(확대·이동 때 불필요한 그리기 작업 축소)
      if (r.x2 < 0 || r.x1 > view.width || r.y2 < 0 || r.y1 > view.height) return null;
      return r;
    }
    ctx.save();
    // 한 단계 위 규모: 채움·라벨 없이 옅은 점선 윤곽만(복잡해지지 않게 배경 정보로만 둔다)
    (picked.parents || []).forEach(function (wave) {
      var st = STYLE[wave.kind], r = rectOf(wave);
      if (!st || !r) return;
      ctx.strokeStyle = st.stroke;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(r.x1 + .5, r.y1 + .5, r.x2 - r.x1 - 1, r.y2 - r.y1 - 1);
    });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    waves.forEach(function (wave) {
      var st = STYLE[wave.kind], r = rectOf(wave);
      if (!st || !r) return;
      var x1 = r.x1, x2 = r.x2, y1 = r.y1, y2 = r.y2;
      ctx.fillStyle = st.fill;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = st.stroke;
      ctx.globalAlpha = wave.confirmed ? 0.55 : 0.85;
      ctx.lineWidth = 1;
      ctx.setLineDash(wave.confirmed ? [] : [5, 4]);       // 진행 중은 점선, 확정은 실선
      ctx.strokeRect(x1 + .5, y1 + .5, x2 - x1 - 1, y2 - y1 - 1);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      var text = wave.label || st.label;
      if (!wave.confirmed) text += ' · 진행 중';
      else if (level !== 'minor' && !wave.isBox && wave.confirmedIndex != null) text += ' · 확정 +' + (wave.confirmedIndex - wave.end) + '봉';
      ctx.font = '700 10px ' + font;
      ctx.fillStyle = st.stroke;
      ctx.textBaseline = 'top';
      // 확대·이동으로 박스 왼쪽이 화면 밖이어도 라벨은 보이는 영역 안에서 시작한다.
      var lx = Math.max(x1 + 4, 4);
      while (text.length > 2 && ctx.measureText(text).width > x2 - lx - 2) text = text.slice(0, -1);
      // 소파동은 박스가 아주 많아 라벨이 겹치므로 어느 정도 폭이 있을 때만 쓴다.
      if (x2 - lx > (level === 'minor' ? 34 : 12)) ctx.fillText(text, lx, y1 + 3);
    });
    ctx.font = '10px ' + (summaryFont || 'sans-serif');
    ctx.fillStyle = 'rgba(100,100,100,.85)';
    ctx.textBaseline = 'top';
    // 이동평균 범례 줄 바로 아래(날짜 축·거래량 라벨과 겹치지 않는 위치). 한 줄에 규모·현재 구조·주의를 담고, 좁으면 뒤쪽 주의 문구부터 줄인다.
    var head = '파동 분석(' + (LEVEL_NAME[level] || '중파동') + ')' + (picked.summary ? ' · ' + picked.summary : '');
    var full = head + ' · 점선=진행 중(바뀔 수 있음) · 매매 추천 아님';
    var maxWidth = Math.max(60, (view.width || 600) - 16);
    var line = ctx.measureText(full).width <= maxWidth ? full : head;
    while (line.length > 6 && ctx.measureText(line).width > maxWidth) line = line.slice(0, -1);
    ctx.fillText(line, 8, summaryTop == null ? 30 : summaryTop);   // 차트검색은 이동평균 범례 줄 아래(30), 범례가 없는 화면은 맨 위
    ctx.restore();
  }

  // ---- 한 차트에 붙이기 ----
  // opts: { core, ctl(chart-drawing 컨트롤러), key, timeframe, bars, state:{enabled, level}, font }
  // 반환: { apply(), picked(), analysis(), detach() } - apply() 는 현재 state 에 맞게 계산(필요할 때만)·층 등록/해제.
  function attach(opts) {
    var core = opts.core || global.NineChartCore;
    var ctl = opts.ctl, state = opts.state, detached = false, pickedNow = null, resultNow = null, generation = 0, notice = null;
    var font = opts.font || 'sans-serif';
    function showError(message) {
      if (!notice) {
        notice = document.createElement('div'); notice.className = 'nc-wave-error'; notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:absolute;left:8px;top:8px;z-index:2;padding:4px 8px;background:#fff;color:#b42318;font-size:12px;pointer-events:none';
        ctl.overlay.parentElement.appendChild(notice);
      }
      notice.textContent = message;
    }
    function apply() {
      if (detached) return Promise.resolve();
      var request = ++generation;
      if (!state.enabled || opts.timeframe === 'minute') {
        pickedNow = null; resultNow = null;
        if (notice) { notice.remove(); notice = null; }
        ctl.removeLayer('wave');
        return Promise.resolve();
      }
      return core.loadModule('autowave').then(function () {
        if (detached || !state.enabled || request !== generation) return;
        return global.NineChartWave.analysisAsync(opts.bars, opts.key, opts.timeframe, core);
      }).then(function (result) {
        if (detached || !state.enabled || request !== generation || !result) return;
        resultNow = result;
        if (!resultNow) return;
        if (notice) { notice.remove(); notice = null; }
        pickedNow = pickLevel(resultNow, state.level);
        ctl.addLayer('wave', function (ctx, view) { drawWaves(ctx, view, pickedNow, font, opts.summaryFont, opts.summaryTop); });
        if (opts.onPicked) opts.onPicked(pickedNow, resultNow);
      }).catch(function () { if (!detached && state.enabled && request === generation) showError('파동 분석을 표시하지 못했습니다.'); });
    }
    return {
      apply: apply,
      picked: function () { return pickedNow; },
      analysis: function () { return resultNow; },
      detach: function () { detached = true; generation++; pickedNow = null; resultNow = null; if (notice) notice.remove(); try { ctl.removeLayer('wave'); } catch (e) { /* 이미 정리됨 */ } }
    };
  }

  global.NineChartWave = {
    LEVELS: LEVELS, LEVEL_NAME: LEVEL_NAME, STYLE: STYLE, TIP: TIP,
    analysis: analysis, analysisAsync: analysisAsync, pickLevel: pickLevel, fingerprintOf: fingerprintOf,
    levelHtml: levelHtml, wireControls: wireControls, drawWaves: drawWaves, attach: attach,
    _cache: getCache
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartWave;
})(typeof window !== 'undefined' ? window : globalThis);
