/**
 * 다음 파동 예측 표시 공통 모듈(2026-10-14, 실험) - 차트검색·실시간 시세와 종목분석이 같은 계산 결과·같은 그림·같은 표를 쓴다.
 *
 * 계산은 js/wave-forecast.js(규칙 기반 시나리오) 하나이고, 입력인 자동 파동 분석은 chart-wave-overlay 의 캐시를 그대로 쓴다(파동 분석 체크와 같은 결과·재계산 없음).
 * 같은 종목·봉 지문·엔진·모델 버전·규모면 두 화면이 같은 예측 객체를 공유하고, 확대·이동·기간 전환에서는 다시 계산하지 않는다(그리기만 다시 한다).
 *
 * 그리기: 마지막 봉 오른쪽에 (1) 시나리오의 확인·이탈·무효화 가격을 가로 점선으로(시간축을 늘리거나 임의의 파동 굴곡을 그리지 않는다),
 * (2) 변동 범위 참고선(일일 변동률 1σ × √거래일, 방향 아님)을 오른쪽 끝 띠로 표시한다. 상승 빨강·횡보 회색·하락 파랑, 점선=아직 일어나지 않은 조건.
 * 표: 차트 아래에 시나리오·확인 조건·무효화 조건·과거 통계(검증 문턱을 통과한 칸만 숫자)를 간결한 표로 보여 준다.
 * 가격 예측·매수·매도 추천이 아니며 자동매매와 연결되지 않는다.
 */
(function (global) {
  'use strict';

  var SIDE_COLOR = { up: '#d24f45', flat: '#808080', down: '#1261c4' };
  var SIDE_FILL = { up: 'rgba(210,79,69,.10)', flat: 'rgba(128,128,128,.12)', down: 'rgba(18,97,196,.10)' };
  var HORIZON_LABEL = { 5: '5일', 10: '10일', 20: '20일' };
  var LEVELS = [{ key: 'major', label: '대' }, { key: 'medium', label: '중' }, { key: 'minor', label: '소' }];
  var CSS_URL = null;

  var cache = null;
  function getCache() {
    if (!cache) cache = global.NineChartData.createCache({ ttl: 30 * 60 * 1000, max: 12 });
    return cache;
  }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtPrice(p) { return p == null ? '-' : Math.round(Number(p) * 100) / 100 >= 1000 ? Math.round(p).toLocaleString('ko-KR') : String(Math.round(p * 100) / 100); }
  function pct(v, digits) { return v == null ? '-' : (v * 100).toFixed(digits == null ? 1 : digits) + '%'; }
  function signedPct(v) { return v == null ? '-' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

  function ensureStyles(core) {
    try {
      if (typeof document === 'undefined' || document.getElementById('chartForecastCss')) return;
      var link = document.createElement('link');
      link.id = 'chartForecastCss';
      link.rel = 'stylesheet';
      link.href = (core && core.ROOT ? core.ROOT : '') + 'css/chart-forecast.css?v=20261014-fc1';
      document.head.appendChild(link);
    } catch (e) { /* 스타일을 못 붙여도 표는 동작한다 */ }
  }

  // ---- 계산(공유 캐시) ----
  // bars: 일봉, key: 종목 키, level: 'major'|'medium'|'minor'. 같은 입력이면 같은 객체를 돌려준다.
  function compute(bars, key, level) {
    var Wave = global.NineChartWave, WF = global.WaveForecast;
    if (!Wave || !WF || !global.AutoWave) return null;
    var cacheKey = [key, 'day', Wave.fingerprintOf(bars), global.AutoWave.version || '', WF.MODEL_VERSION, level].join('|');
    var c = getCache(), hit = c.get(cacheKey);
    if (hit) return hit.value;
    var an = Wave.analysis(bars, key, 'day');        // 파동 분석 체크와 같은 캐시(계산은 한 번)
    var fc = WF.forecast(bars, an, { level: level });
    if (fc && !fc.insufficient) WF.attachStats(fc, global.WAVE_FORECAST_STATS || null);
    c.set(cacheKey, fc);
    return fc;
  }

  // ---- 그리기(오버레이 층) ----
  function drawForecast(ctx, view, fc, st, font) {
    if (!fc || fc.insufficient || !view.bars || !view.bars.length) return;
    var last = view.bars[view.bars.length - 1];
    var lastPt = view.coord({ time: last.date, price: last.close });
    var right = view.plotWidth || view.width;
    if (!lastPt || !(right > 0) || lastPt.x > right) return;
    ctx.save();
    var items = [];
    fc.scenarios.forEach(function (s) {
      if (!s.matched || st.hidden[s.id]) return;
      var color = SIDE_COLOR[s.side];
      function add(spec, text, dash) {
        if (!spec || spec.price == null) return;
        var p = view.coord({ time: last.date, price: spec.price });
        if (!p || p.y < 0 || p.y > view.height) return;
        items.push({ y: p.y, color: color, text: text + ' ' + fmtPrice(spec.price), dash: dash, primary: s.primary });
      }
      add(s.watch && s.watch.up, s.id === 'compression' ? '상단' : '확인', [6, 4]);
      add(s.watch && s.watch.down, s.id === 'compression' ? '하단' : '이탈', [6, 4]);
      if (s.invalidate && !(s.watch && ((s.watch.up && s.watch.up.price === s.invalidate.price) || (s.watch.down && s.watch.down.price === s.invalidate.price)))) add(s.invalidate, '무효화', [2, 3]);
    });
    // 가로 점선: 전체 폭은 옅게, 마지막 봉에서 오른쪽 끝까지(예측 구간)는 진하게(시간축을 늘리지 않는다)
    items.sort(function (a, b) { return a.y - b.y; });
    items.forEach(function (it) {
      ctx.strokeStyle = it.color; ctx.setLineDash(it.dash);
      ctx.globalAlpha = it.primary ? 0.35 : 0.22; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, it.y); ctx.lineTo(lastPt.x, it.y); ctx.stroke();
      ctx.globalAlpha = it.primary ? 0.95 : 0.6; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(lastPt.x, it.y); ctx.lineTo(right, it.y); ctx.stroke();
    });
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // 라벨: 왼쪽 가장자리에 작은 알약 모양으로(오른쪽 끝의 지지·저항·현재가 표시와 겹치지 않게), 겹치면 아래로 밀어 낸다
    var dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    ctx.font = '700 10px ' + (font || 'sans-serif'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var prevY = -99;
    items.forEach(function (it) {
      var y = Math.max(it.y - 9, prevY + 14), w = ctx.measureText(it.text).width + 10;
      ctx.fillStyle = dark ? 'rgba(26,26,26,.85)' : 'rgba(255,255,255,.88)'; ctx.fillRect(6, y - 7, w, 14);
      ctx.strokeStyle = it.color; ctx.lineWidth = 1; ctx.strokeRect(6.5, y - 6.5, w - 1, 13);
      ctx.fillStyle = it.color; ctx.fillText(it.text, 11, y);
      prevY = y;
    });
    // 변동 범위 참고선: 오른쪽 끝 띠(1σ × √거래일) - 방향이 아니라 흔들림 크기
    var band = fc.bands && fc.bands.filter(function (b) { return b.h === st.horizon; })[0];
    if (band && band.low != null) {
      var top = view.coord({ time: last.date, price: band.high }), bot = view.coord({ time: last.date, price: band.low });
      if (top && bot) {
        var x1 = Math.max(lastPt.x + 4, right - 26), x2 = right - 6;
        if (x2 > x1) {
          ctx.fillStyle = 'rgba(128,128,128,.14)'; ctx.fillRect(x1, top.y, x2 - x1, bot.y - top.y);
          ctx.strokeStyle = 'rgba(128,128,128,.7)'; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x1, top.y); ctx.lineTo(x2, top.y); ctx.moveTo(x1, bot.y); ctx.lineTo(x2, bot.y); ctx.stroke();
          ctx.fillStyle = 'rgba(100,100,100,.9)'; ctx.font = '10px ' + (font || 'sans-serif'); ctx.textAlign = 'right'; ctx.textBaseline = 'top';
          ctx.fillText(HORIZON_LABEL[st.horizon] + ' 변동폭', x2, Math.max(0, top.y - 13));
        }
      }
    }
    ctx.restore();
  }

  // ---- 표 ----
  function statsHtml(fc, s, st) {
    var info = fc.stats && fc.stats.rows && fc.stats.rows[s.id];
    if (!info) return '<span class="nc-fc-dim">통계 없음</span>';
    var cell = info.filter(function (c) { return c.h === st.horizon; })[0];
    if (!cell) return '<span class="nc-fc-dim">통계 없음</span>';
    if (!cell.shown) return '<span class="nc-fc-dim">' + HORIZON_LABEL[st.horizon] + ' · 검증 미통과' + (cell.n != null ? ' (표본 ' + cell.n.toLocaleString('ko-KR') + '건)' : '') + '</span>';
    return HORIZON_LABEL[st.horizon] + ' · 상승 마감 ' + pct(cell.up, 0) + '(전체 ' + pct(cell.baselineUp, 0) + ') · 중앙값 ' + signedPct(cell.median)
      + ' · 10~90% ' + signedPct(cell.p10) + '~' + signedPct(cell.p90) + ' · 표본 ' + cell.n.toLocaleString('ko-KR') + '건';
  }

  function conditionText(spec) { return spec ? esc(spec.text) + ' <b>' + fmtPrice(spec.price) + '</b>' : '<span class="nc-fc-dim">-</span>'; }

  function panelHtml(fc, st, prefix) {
    if (!fc) return '<div class="nc-fc-note">다음 파동 예측을 불러오는 중입니다…</div>';
    if (fc.insufficient) return '<div class="nc-fc-note">' + esc(fc.reason) + '</div>';
    var passed = 0, total = 0;
    Object.keys(fc.stats && fc.stats.rows || {}).forEach(function (id) { fc.stats.rows[id].forEach(function (c) { total++; if (c.shown) passed++; }); });
    var primary = fc.scenarios.filter(function (s) { return s.primary; })[0];
    var h = '<div class="nc-fc-head"><strong>다음 파동 예측</strong> <em>실험 · 가격 예측·매매 추천이 아닙니다</em>'
      + '<span class="nc-fc-asof">기준 ' + esc(fc.asOfDate) + ' 종가 · 모델 ' + esc(fc.modelVersion) + ' · 엔진 ' + esc(fc.engineVersion || '-') + '</span></div>';
    h += '<div class="nc-fc-state">현재 구조: 대 ' + esc(fc.state.major) + ' · 중 ' + esc(fc.state.medium) + ' · 소 ' + esc(fc.state.minor)
      + (fc.state.regimeProvisional ? ' <span class="nc-fc-dim">(대파동 구조는 임시 판정)</span>' : '') + '</div>';
    h += '<div class="nc-fc-main">' + (primary ? '주 시나리오: <b class="nc-fc-' + primary.side + '">' + esc(primary.name) + '</b> — ' + esc(primary.headline)
      : '주 시나리오: <b>판단 보류</b> — 지금 구조는 정의한 다섯 시나리오 어디에도 뚜렷이 들어가지 않습니다') + '</div>';
    h += '<table class="nc-fc-table"><thead><tr><th>시나리오</th><th>상태</th><th>확인 조건</th><th>무효화 조건</th><th>과거 통계(' + HORIZON_LABEL[st.horizon] + ')</th></tr></thead><tbody>';
    fc.scenarios.forEach(function (s) {
      var hidden = !!st.hidden[s.id];
      var status = s.primary ? '주' : (s.matched ? '동시 성립' : '-');
      var confirm = s.watch && s.watch.up ? conditionText(s.watch.up) : (s.watch && s.watch.down && s.side === 'down' ? conditionText(s.watch.down) : '<span class="nc-fc-dim">-</span>');
      var invalid = s.invalidate ? esc(s.invalidate.text) + ' <b>' + fmtPrice(s.invalidate.price) + '</b>' : (s.watch && s.watch.down && s.side !== 'down' ? conditionText(s.watch.down) : '<span class="nc-fc-dim">-</span>');
      h += '<tr class="' + (s.primary ? 'is-primary ' : '') + (s.matched ? 'is-matched' : 'is-off') + '"><td><label><input type="checkbox" data-forecast-show="' + s.id + '"' + (hidden ? '' : ' checked') + ' /> '
        + '<span class="nc-fc-' + s.side + '">' + esc(s.name) + '</span></label></td><td>' + status + '</td><td>' + (s.matched ? confirm : '<span class="nc-fc-dim">-</span>') + '</td><td>'
        + (s.matched ? invalid : '<span class="nc-fc-dim">-</span>') + '</td><td>' + (s.matched ? statsHtml(fc, s, st) : '<span class="nc-fc-dim">-</span>') + '</td></tr>';
    });
    h += '</tbody></table>';
    if (fc.evidence.length) h += '<div class="nc-fc-sub"><b>판단 근거</b> ' + fc.evidence.map(esc).join(' · ') + '</div>';
    if (fc.triggers.length) h += '<div class="nc-fc-sub"><b>조건이 바뀌면</b> ' + fc.triggers.map(function (t) { return esc(t.when) + ' → ' + esc(t.then); }).join(' / ') + '</div>';
    var band = fc.bands.filter(function (b) { return b.h === st.horizon; })[0];
    h += '<div class="nc-fc-sub"><b>관찰 기간</b> ' + esc(fc.observe.text)
      + (band && band.low != null ? ' <b>변동 범위 참고</b> ' + HORIZON_LABEL[st.horizon] + ' ' + fmtPrice(band.low) + '~' + fmtPrice(band.high) + ' (' + esc(fc.bandNote) + ')' : '') + '</div>';
    var meta = fc.stats && fc.stats.meta;
    h += '<div class="nc-fc-foot">'
      + (passed ? '검증 문턱을 통과한 칸만 숫자를 보여 줍니다. ' : '과거 통계는 아직 검증 문턱(표본·개발/검증 일관성·유의성)을 통과한 시나리오가 없어 숫자를 표시하지 않습니다. ')
      + (meta ? '연구 표본: ' + esc(meta.universe) + ', ' + esc(meta.period && meta.period.join('~')) + '. ' : '통계 표를 불러오지 못했습니다. ')
      + (fc.stats && fc.stats.stale ? '통계 표가 현재 모델 버전과 달라 숫자를 쓰지 않습니다. ' : '')
      + '점선은 아직 충족되지 않은 가격 조건이고, 새 봉이 들어오면 시나리오가 바뀔 수 있습니다.</div>';
    return h;
  }

  // ---- 제어(체크·기간·규모) ----
  function optionsHtml(prefix, st) {
    return '<span class="' + prefix + '-forecast-group" role="group" aria-label="예측 기간">'
      + [5, 10, 20].map(function (h) { var on = h === st.horizon; return '<button type="button" class="' + prefix + '-forecast-btn' + (on ? ' active' : '') + '" data-forecast-horizon="' + h + '" aria-pressed="' + on + '">' + HORIZON_LABEL[h] + '</button>'; }).join('')
      + '</span><span class="' + prefix + '-forecast-group" role="group" aria-label="파동 규모">'
      + LEVELS.map(function (lv) { var on = lv.key === st.level; return '<button type="button" class="' + prefix + '-forecast-btn' + (on ? ' active' : '') + '" data-forecast-level="' + lv.key + '" aria-pressed="' + on + '" title="' + lv.label + '파동 규모 기준">' + lv.label + '</button>'; }).join('')
      + '</span>';
  }

  // root: 체크박스 [data-chart-forecast-toggle]·옵션 자리 [data-chart-forecast-opts]·표 자리 [data-chart-forecast-panel] 를 가진 요소. onChange(kind)
  function wireControls(root, st, onChange, prefix) {
    var toggle = root.querySelector('[data-chart-forecast-toggle]');
    var box = root.querySelector('[data-chart-forecast-opts]');
    var panel = root.querySelector('[data-chart-forecast-panel]');
    prefix = prefix || 'ss';
    function paintOptions() {
      if (!box) return;
      box.hidden = !st.enabled;
      box.innerHTML = optionsHtml(prefix, st);
    }
    if (toggle) {
      toggle.checked = st.enabled;
      toggle.onchange = function () { st.enabled = toggle.checked; paintOptions(); if (panel) panel.hidden = !st.enabled; onChange('toggle'); };
    }
    if (box) {
      paintOptions();
      box.onclick = function (event) {
        var btn = event.target.closest ? event.target.closest('button') : null;
        if (!btn) return;
        if (btn.hasAttribute('data-forecast-horizon')) { st.horizon = +btn.getAttribute('data-forecast-horizon'); paintOptions(); onChange('horizon'); }
        else if (btn.hasAttribute('data-forecast-level')) { st.level = btn.getAttribute('data-forecast-level'); paintOptions(); onChange('level'); }
      };
    }
    if (panel) {
      panel.hidden = !st.enabled;
      panel.onchange = function (event) {
        var t = event.target;
        if (!t || !t.getAttribute || t.getAttribute('data-forecast-show') == null) return;
        st.hidden[t.getAttribute('data-forecast-show')] = !t.checked;
        onChange('visibility');
      };
    }
    return { paint: paintOptions };
  }

  // ---- 한 차트에 붙이기 ----
  // opts: { core, ctl, key, timeframe, bars, state:{enabled,level,horizon,hidden}, panel, font }
  function attach(opts) {
    var core = opts.core || global.NineChartCore, ctl = opts.ctl, st = opts.state, detached = false, fcNow = null;
    var font = opts.font || 'sans-serif', prefix = opts.prefix || 'ss';
    function renderPanel() {
      var panel = opts.panel;
      if (!panel) return;
      if (!st.enabled) { panel.hidden = true; panel.innerHTML = ''; return; }
      panel.hidden = false;
      if (opts.timeframe !== 'day') { panel.innerHTML = '<div class="nc-fc-note">다음 파동 예측은 일봉에서만 제공합니다(과거 통계가 일봉 기준입니다).</div>'; return; }
      panel.innerHTML = panelHtml(fcNow, st, prefix);
    }
    function apply() {
      if (detached) return Promise.resolve();
      if (!st.enabled || opts.timeframe !== 'day') {
        fcNow = null; ctl.removeLayer('forecast'); renderPanel();
        return Promise.resolve();
      }
      ensureStyles(core);
      return core.ready(['forecast', 'forecastStats', 'wave']).catch(function () { return core.ready(['forecast', 'wave']); }).then(function () {
        if (detached || !st.enabled) return;
        fcNow = compute(opts.bars, opts.key, st.level);
        ctl.addLayer('forecast', function (ctx, view) { drawForecast(ctx, view, fcNow, st, font); });
        renderPanel();
        global.NineChartForecast.last = fcNow;   // 점검용: 가장 최근에 그린 예측
        if (opts.onForecast) opts.onForecast(fcNow);
      }).catch(function () {
        if (opts.panel && st.enabled) opts.panel.innerHTML = '<div class="nc-fc-note">다음 파동 예측 모듈을 불러오지 못했습니다.</div>';
      });
    }
    return {
      apply: apply, forecast: function () { return fcNow; },
      detach: function () { detached = true; fcNow = null; try { ctl.removeLayer('forecast'); } catch (e) { /* 이미 정리됨 */ } if (opts.panel) opts.panel.innerHTML = ''; }
    };
  }

  global.NineChartForecast = { compute: compute, drawForecast: drawForecast, panelHtml: panelHtml, optionsHtml: optionsHtml, wireControls: wireControls, attach: attach, HORIZON_LABEL: HORIZON_LABEL, _cache: getCache };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartForecast;
})(typeof window !== 'undefined' ? window : globalThis);
