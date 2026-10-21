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
  var TREND_TIP = '박스 안의 한 단계 아래 규모 고점끼리·저점끼리 이은 선(채널). 아래 규모 점이 2개 미만이거나 소파동·횡보 박스는 선을 긋지 않습니다. 진행 중 박스의 선은 점선입니다. 관찰용이며 매수·매도 신호가 아닙니다.';
  var TIP = '실험 기능: 가격 움직임의 구조를 상승(빨강)·하락(파랑)·횡보(회색)·변동성 큰 박스권(보라 회색) 박스로 나눠 보여줍니다. 대·중·소 규모를 고를 수 있고(기본 중파동) 한 단계 위 규모는 옅은 점선 윤곽으로 함께 보입니다. 극점은 되돌림이 확인된 뒤에 확정되고, 점선(진행 중·방향 미확정) 구간은 새 봉이 들어오면 바뀔 수 있습니다. 매수·매도 추천이 아닙니다.';

  // ---- 분석 결과 캐시(페이지 안의 모든 차트가 공유) ----
  var data = global.NineChartData;
  var cache = null;
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

  // 선택한 규모의 파동(박스에 가려진 것 제외)과, 한 단계 위 규모의 옅은 윤곽(부모)을 고른다.
  function pickLevel(result, level) {
    var lv = result.levels && result.levels[level] ? level : 'medium';
    var parentName = lv === 'minor' ? 'medium' : (lv === 'medium' ? 'major' : null);
    var lowerName = lv === 'major' ? 'medium' : (lv === 'medium' ? 'minor' : null);
    return {
      level: lv,
      lower: lowerName ? (result.levels[lowerName] || []) : [],   // 추세선(채널)을 긋는 재료: 한 단계 아래 규모의 모든 파동(가려진 것 포함)
      waves: (result.levels[lv] || []).filter(function (w) { return !w.suppressed; }),
      parents: parentName ? (result.levels[parentName] || []).filter(function (w) { return !w.suppressed; }) : [],
      summary: result.state ? result.state.summaryText : ''
    };
  }

  // ---- 마크업·제어 ----
  // 규모 선택 묶음. prefix 는 화면별 CSS 이름(ss → ss-wave-level / ff → ff-wave-level). 파동 분석이 꺼져 있으면 숨긴다.
  function levelHtml(prefix, enabled, level, trendOn) {
    return '<span class="' + prefix + '-wave-level" data-chart-wave-level role="group" aria-label="파동 규모"' + (enabled ? '' : ' hidden') + '>'
      + LEVELS.map(function (lv) {
        var on = lv.key === level;
        return '<button type="button" class="' + prefix + '-wave-btn' + (on ? ' active' : '') + '" data-wave-level="' + lv.key + '" aria-pressed="' + on + '" title="' + lv.tip + '">' + lv.label + '</button>';
      }).join('')
      + '<label class="' + prefix + '-wave-trend" style="margin-left:8px;font-size:12px;white-space:nowrap" title="' + TREND_TIP + '"><input type="checkbox" data-wave-trend' + (trendOn ? ' checked' : '') + ' /> 추세선</label></span>';
  }

  // 체크박스 + 규모 단추를 연결한다. state: { enabled, level }(화면이 들고 있는 값). onChange(kind) 는 'toggle' | 'level'.
  // 화면은 셸을 먼저 그려야 해서 규모 묶음을 비워 둔 채(hidden) 내보낸다 - 여기서 단추를 채워 마크업을 이 파일 한 곳에 둔다.
  function wireControls(root, state, onChange, prefix) {
    var toggle = root.querySelector('[data-chart-wave-toggle]');
    var box = root.querySelector('[data-chart-wave-level]');
    if (box && !box.querySelector('[data-wave-level]')) {
      var p = prefix || (box.className.match(/([a-z]+)-wave-level/) || [])[1] || 'ss';
      box.innerHTML = levelHtml(p, state.enabled, state.level, state.trend).replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '');
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
      box.onchange = function (event) {
        var chk = event.target && event.target.matches && event.target.matches('[data-wave-trend]') ? event.target : null;
        if (!chk) return;
        state.trend = chk.checked;
        onChange('trend');   // 분석은 그대로, 채널만 다시 그린다
      };
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

  // ---- 박스 안 추세선(채널) ----
  // 상승·하락 파동 하나(wave)에 대해, 그 안에 들어 있는 한 단계 아래 규모의 확정·진행 중 고점·저점으로 위선·아래선을 긋는다.
  // 위선은 모든 고점 위를, 아래선은 모든 저점 아래를 지나는 최소제곱선이라 두 선이 평행하지 않아도 된다(쐐기·확장 그대로).
  // 박스에 고점·저점이 각각 2개 미만이면 선을 긋지 않는다(null). 계산은 이미 정해진 파동 정보만 쓰며 새 봉을 보지 않는다.
  function fitLine(points, above) {
    var n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    points.forEach(function (q) { sx += q.i; sy += q.p; sxx += q.i * q.i; sxy += q.i * q.p; });
    var d = n * sxx - sx * sx;
    var m = d === 0 ? 0 : (n * sxy - sx * sy) / d;
    var b = above ? -Infinity : Infinity;
    points.forEach(function (q) { var r = q.p - m * q.i; b = above ? Math.max(b, r) : Math.min(b, r); });
    return { m: m, b: b };
  }
  function channelOf(wave, lowerWaves) {
    if (!wave || wave.isBox || (wave.kind !== 'up' && wave.kind !== 'down') || !lowerWaves || !lowerWaves.length) return null;
    var seen = {}, lows = [], highs = [];
    function add(i, p, type) {
      if (i < wave.start || i > wave.end || !isFinite(p)) return;
      var k = type + i;
      if (seen[k]) return;
      seen[k] = true;
      (type === 'L' ? lows : highs).push({ i: i, p: p });
    }
    // 이 파동 자신의 양 끝도 점으로 쓴다(한 단계 아래 규모의 점과 겹치면 한 번만 센다).
    if (wave.kind === 'up') { add(wave.start, wave.low, 'L'); add(wave.end, wave.high, 'H'); }
    else { add(wave.start, wave.high, 'H'); add(wave.end, wave.low, 'L'); }
    lowerWaves.forEach(function (w) {
      if (w.isBox || (w.kind !== 'up' && w.kind !== 'down')) return;
      if (w.kind === 'up') { add(w.start, w.low, 'L'); add(w.end, w.high, 'H'); }
      else { add(w.start, w.high, 'H'); add(w.end, w.low, 'L'); }
    });
    if (lows.length < 2 || highs.length < 2) return null;
    return { kind: wave.kind, start: wave.start, end: wave.end, confirmed: !!wave.confirmed, upper: fitLine(highs, true), lower: fitLine(lows, false), lows: lows, highs: highs };
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
    // 추세선(채널): 박스 안에서만, 박스와 같은 색(상승 빨강·하락 파랑). 진행 중 박스는 점선.
    if (picked.trend && picked.lower && picked.lower.length) {
      waves.forEach(function (wave) {
        var ch = channelOf(wave, picked.lower), st = STYLE[wave.kind], b0 = bars[wave.start], b1 = bars[wave.end];
        if (!ch || !st || !b0 || !b1) return;
        var u0 = view.coord({ time: b0.date, price: ch.upper.m * wave.start + ch.upper.b }), u1 = view.coord({ time: b1.date, price: ch.upper.m * wave.end + ch.upper.b });
        var l0 = view.coord({ time: b0.date, price: ch.lower.m * wave.start + ch.lower.b }), l1 = view.coord({ time: b1.date, price: ch.lower.m * wave.end + ch.lower.b });
        if (!u0 || !u1 || !l0 || !l1) return;
        if (Math.max(u0.x, u1.x, l0.x, l1.x) < 0 || Math.min(u0.x, u1.x, l0.x, l1.x) > view.width) return;
        // 선이 박스 밖으로 나가 보이지 않게 박스 안으로 자른다(기울기 때문에 한쪽 끝이 박스 위·아래를 넘을 수 있다).
        var box = rectOf(wave) || { x1: 0, y1: 0, x2: view.width, y2: view.height };
        ctx.save();
        ctx.beginPath(); ctx.rect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1); ctx.clip();
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = 1.6;
        ctx.setLineDash(ch.confirmed ? [] : [6, 4]);
        ctx.beginPath(); ctx.moveTo(u0.x, u0.y); ctx.lineTo(u1.x, u1.y); ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        [[u0, u1], [l0, l1]].forEach(function (pair) {
          pair.forEach(function (pt) {
            if (pt.x < box.x1 || pt.x > box.x2 || pt.y < box.y1 || pt.y > box.y2) return;
            ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.strokeStyle = st.stroke; ctx.lineWidth = 1.5; ctx.stroke();
          });
        });
      });
    }
    ctx.font = '10px ' + (summaryFont || 'sans-serif');
    ctx.fillStyle = 'rgba(100,100,100,.85)';
    ctx.textBaseline = 'top';
    // 이동평균 범례 줄 바로 아래(날짜 축·거래량 라벨과 겹치지 않는 위치). 한 줄에 규모·현재 구조·주의를 담고, 좁으면 뒤쪽 주의 문구부터 줄인다.
    var head = '파동 분석(' + (LEVEL_NAME[level] || '중파동') + ')' + (picked.summary ? ' · ' + picked.summary : '');
    if(level==='major')head='파동 분석 > 대파동 · 현재 자료로 재구성'+(picked.support?' · '+picked.support.text:'');
    var full = head + ' · 실선=확정 · 점선=진행 중';
    var maxWidth = Math.max(60, (view.width || 600) - 16);
    var line = ctx.measureText(full).width <= maxWidth ? full : head;
    while (line.length > 6 && ctx.measureText(line).width > maxWidth) line = line.slice(0, -1);
    ctx.fillText(line, 8, summaryTop == null ? 30 : summaryTop);   // 차트검색은 이동평균 범례 줄 아래(30), 범례가 없는 화면은 맨 위
    ctx.restore();
  }

  function activeMajor(result) {
    var waves=(result.levels.major || []).filter(function(w){return !w.suppressed;});
    // 마지막 봉을 덮는 진행 중 박스를 우선한다. 없으면 마지막 방향 파동.
    return waves.filter(function(w){return w.end===result.asOf && w.isBox;}).pop()
      || waves.filter(function(w){return !w.isBox;}).pop() || waves.pop() || null;
  }
  function escapeText(value) { return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function contextHtml(context) {
    if(!context)return '보조 자료 부족';
    var labels={up:'상승',down:'하락',neutral:'중립',unknown:'자료 부족'};
    return '<b>'+context.text+(context.againstLong?' · 장기 흐름 역행':'')+'</b><br>'
      +context.periods.map(function(p){return p.label+' '+labels[p.state]+(p.change==null?'':' ('+(p.change>=0?'+':'')+p.change.toFixed(1)+'%)')
        +(p.pending?' · '+p.pending+'/3봉 확인 중':'');}).join('<br>');
  }
  // 과거 십자선은 그 날짜까지 다시 계산한다. 현재 그림의 확정 정보를 과거에 소급하지 않는다.
  function majorTooltipHtml(bars, result, lanes, index, core, reconstructed) {
    var wave=activeMajor(result),date=bars[index].date;
    var out='<b>대파동 · '+escapeText(date)+' 당시 자료 기준</b><br>';
    if(!wave)return out+'파동 자료 부족';
    out+=escapeText(wave.label || (STYLE[wave.kind] || STYLE.unk).label)+' · '+(wave.confirmed?'확정(실선)':'진행 중(점선·변경 가능)')+'<br>';
    out+='극점 구간 '+escapeText(bars[wave.start].date)+' ~ '+escapeText(bars[wave.end].date)+'<br>';
    if(wave.confirmed && wave.confirmedIndex!=null)out+='확정일 '+escapeText(bars[wave.confirmedIndex].date)+' · 극점 이후 '+(wave.confirmedIndex-wave.end)+'봉<br>';
    var context=core.majorWaveContext(lanes,wave,index);
    out+=contextHtml(context);
    // 확정 당시와 조회일의 보조 판정을 별도 표기한다. 확정 여부는 기간 흐름이 바꾸지 않는다.
    if(wave.confirmed && wave.confirmedIndex!=null && wave.confirmedIndex!==index){
      out+='<br>확정일 보조 설명 ('+escapeText(bars[wave.confirmedIndex].date)+')<br>'+contextHtml(core.majorWaveContext(lanes,wave,wave.confirmedIndex));
    }
    if(reconstructed && index<bars.length-1){
      var drawn=(reconstructed.levels.major || []).filter(function(w){return !w.suppressed && w.start<=index && w.end>=index;});
      var region=drawn.filter(function(w){return w.isBox;}).pop() || drawn.pop();
      if(region){
        out+='<hr><b>현재 그림의 해당 영역 (사후 재구성)</b><br>'+escapeText(region.label || STYLE[region.kind].label);
        if(region.confirmed && region.confirmedIndex!=null){
          out+='<br>확정일 '+escapeText(bars[region.confirmedIndex].date)+(region.confirmedIndex>index?' · 조회일에는 미확정':'');
          out+='<br>확정일 보조 설명<br>'+contextHtml(core.majorWaveContext(lanes,region,region.confirmedIndex));
        }else out+=' · 진행 중';
      }
    }
    return out+'<br><small>종가 변화 ±3/6/9/12% · 3봉 확인 · 미완료 봉은 잠정<br>화면 영역은 현재 자료로 재구성한 파동이며 이후 확정을 포함할 수 있음<br>보조 판정은 극점·확정일을 옮기지 않음</small>';
  }
  function attachMajorTooltip(opts, result, lanes) {
    var chart=opts.ctl.shapes && opts.ctl.shapes.chart,container=opts.ctl.overlay && opts.ctl.overlay.parentElement;
    if(!chart || !container)return function(){};
    var core=opts.core || global.NineChartCore,bars=opts.bars,indexes={};bars.forEach(function(b,i){indexes[b.date]=i;});
    var tip=document.createElement('div');tip.className='nine-wave-tip';tip.setAttribute('role','status');
    tip.style.cssText='position:absolute;z-index:29;display:none;box-sizing:border-box;padding:8px;background:rgba(255,255,255,.97);border:1px solid #888;color:#222;font:11px/1.45 sans-serif;overflow:auto;pointer-events:none;';container.appendChild(tip);
    var supplyTip=container.querySelector('.nine-supply-tip');
    // 대파동/흔적을 한 툴팁으로 읽게 해 서로 덮지 않는다. 흔적 OFF면 원 툴팁도 없다.
    if(supplyTip)supplyTip.style.visibility='hidden';
    var last=-1,lastTrace=null,frame=0,latest=null,disposed=false;
    function update(){
      frame=0;if(disposed)return;
      var param=latest,t=param && param.time;
      if(t && typeof t==='object')t=t.year+'-'+String(t.month).padStart(2,'0')+'-'+String(t.day).padStart(2,'0');
      var i=indexes[t],point=param && param.point;
      // 수동 작도 모드에서는 안내가 그리기를 가리지 않는다.
      if(i===undefined || !point || point.x<0 || point.y<0 || point.x>container.clientWidth || point.y>container.clientHeight || (opts.ctl.mode && opts.ctl.mode())){tip.style.display='none';return;}
      supplyTip=container.querySelector('.nine-supply-tip');
      if(supplyTip)supplyTip.style.visibility='hidden';
      var traceHtml=supplyTip && supplyTip.style.display==='block'?supplyTip.innerHTML:'';
      if(last!==i || lastTrace!==traceHtml){
        var historical=i===bars.length-1?result:analysis(bars.slice(0,i+1),opts.key,opts.timeframe);
        tip.innerHTML=majorTooltipHtml(bars,historical,lanes,i,core,result);
        if(traceHtml)tip.innerHTML+='<hr>'+traceHtml;
        last=i;lastTrace=traceHtml;
      }
      var width=Math.min(310,container.clientWidth-8);tip.style.width=width+'px';tip.style.maxHeight=Math.min(520,container.clientHeight-8)+'px';tip.style.display='block';
      tip.style.left=Math.max(4,Math.min(point.x+12,container.clientWidth-width-4))+'px';
      tip.style.top=Math.max(4,Math.min(point.y+12,container.clientHeight-tip.offsetHeight-4))+'px';
    }
    function move(param){latest=param;if(!frame)frame=global.requestAnimationFrame(update);}
    chart.subscribeCrosshairMove(move);
    return function(){disposed=true;if(frame)global.cancelAnimationFrame(frame);chart.unsubscribeCrosshairMove(move);tip.remove();if(supplyTip)supplyTip.style.visibility='';};
  }

  // ---- 한 차트에 붙이기 ----
  // opts: { core, ctl(chart-drawing 컨트롤러), key, timeframe, bars, state:{enabled, level}, font }
  // 반환: { apply(), picked(), analysis(), detach() } - apply() 는 현재 state 에 맞게 계산(필요할 때만)·층 등록/해제.
  function attach(opts) {
    var core = opts.core || global.NineChartCore;
    var ctl = opts.ctl, state = opts.state, detached = false, pickedNow = null, resultNow = null;
    var font = opts.font || 'sans-serif', tipCleanup=null;
    function clearTip(){if(tipCleanup){tipCleanup();tipCleanup=null;}}
    function apply() {
      if (detached) return Promise.resolve();
      clearTip();
      if (!state.enabled || opts.timeframe === 'minute') {
        pickedNow = null; resultNow = null;
        ctl.removeLayer('wave');
        return Promise.resolve();
      }
      return core.loadModule('autowave').then(function () {
        if (detached || !state.enabled) return;
        resultNow = analysis(opts.bars, opts.key, opts.timeframe);
        if (!resultNow) return;
        clearTip();
        pickedNow = pickLevel(resultNow, state.level);
        pickedNow.trend = !!state.trend;
        if(state.level==='major' && core.trendRegimes && core.majorWaveContext){
          var lanes=core.trendRegimes(opts.bars,opts.timeframe);
          pickedNow.support=core.majorWaveContext(lanes,activeMajor(resultNow),resultNow.asOf);
          tipCleanup=attachMajorTooltip(opts,resultNow,lanes);
        }
        ctl.addLayer('wave', function (ctx, view) {
          var container=ctl.overlay && ctl.overlay.parentElement,top=opts.summaryTop;
          if(container){
            var header=container.querySelector('.ss-price-study-label'),trace=container.querySelector('.nine-trace-legend');
            top=Math.max(top || 4,header?header.offsetTop+header.offsetHeight+4:4,trace?trace.offsetTop+trace.offsetHeight+4:4);
          }
          drawWaves(ctx, view, pickedNow, font, opts.summaryFont, top);
        });
        if (opts.onPicked) opts.onPicked(pickedNow, resultNow);
      }).catch(function () { /* 엔진 스크립트를 못 받으면 파동만 빠지고 차트는 계속 */ });
    }
    return {
      apply: apply,
      picked: function () { return pickedNow; },
      analysis: function () { return resultNow; },
      detach: function () { detached = true; clearTip(); pickedNow = null; resultNow = null; try { ctl.removeLayer('wave'); } catch (e) { /* 이미 정리됨 */ } }
    };
  }

  global.NineChartWave = {
    LEVELS: LEVELS, LEVEL_NAME: LEVEL_NAME, STYLE: STYLE, TIP: TIP,
    analysis: analysis, pickLevel: pickLevel, fingerprintOf: fingerprintOf,
    levelHtml: levelHtml, wireControls: wireControls, drawWaves: drawWaves, channelOf: channelOf, attach: attach, activeMajor:activeMajor, majorTooltipHtml:majorTooltipHtml,
    _cache: getCache
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartWave;
})(typeof window !== 'undefined' ? window : globalThis);
