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
  var TIP = '실험 기능: 가격 움직임의 구조를 상승(빨강)·하락(파랑)·횡보(회색)·변동성 큰 박스권(보라 회색) 박스로 나눠 보여줍니다. 대·중·소 규모를 고를 수 있고(기본 중파동) 한 단계 위 규모는 옅은 점선 윤곽으로 함께 보입니다. 극점은 되돌림이 확인된 뒤에 확정되고, 점선(진행 중·방향 미확정) 구간은 새 봉이 들어오면 바뀔 수 있습니다. 눌림목은 앞선 상승의 25~75% 조정·저점 유지·거래량 감소·반등 확인을 함께 계산합니다. 확인 전에는 눌림목 후보입니다. 매수·매도 추천이 아닙니다.';

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
      trendWaves: result.levels[lv] || [],
      lower: lowerName ? (result.levels[lowerName] || []) : [],   // 추세선 재료(스윙 고점·저점): 한 단계 아래 규모의 모든 파동(가려진 것 포함)
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
        onChange('trend');   // 분석은 그대로, 추세선만 다시 그린다
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

  // ---- 추세선 + 이탈 판정 ----
  // 각 파동의 국소 채널·횡보 경계를 보존하고 장기 스윙선(up/down 호환)을 보조로 겹친다. 저점·고점이 딱 붙을 필요는 없고
  // 변동성(ATR14) 기준 허용 오차 안이면 "닿았다"고 센다. 닿음 3회 이상이면 확정선(실선), 2회는 잠정선(점선).
  // 종가가 선에서 이탈 허용치 넘게 벗어난 봉이 2봉 연속이면 추세 이탈, 이탈 뒤 직전 스윙 극점까지 깨면 추세 전환이다.
  // 파동 엔진 결과는 바꾸지 않고 이미 정해진 고점·저점만 읽는다. 허용치는 아래 상수 한 곳에서 조정한다.
  var TREND = { atrPeriod: 14, touchAtr: 0.5, touchPct: 0.015, breakAtr: 1, breakPct: 0.025, breakBars: 2, minTouches: 2, solidTouches: 3, maxPivots: 8, staleBars: 120, minSpan: 14, projectionBars: 5, recentBars: 5 };
  var TREND_COLOR = { up: '#d62524', down: '#1558c9' };
  var TREND_TIP = '선택 규모의 과거·현재 파동마다 검증된 국소 추세선과 평행 채널·횡보 경계를 표시합니다. 너무 짧은 잡음은 제외하고 고점·저점의 연결과 방향 일관성을 우선합니다. 과거 선은 구간 끝에서 멈추고, 현재 유효한 선은 기울기를 5봉 앞까지 점선으로 연장합니다(가격 예언이 아닌 추세 이탈 비교 기준). 현재 자료의 사후 재구성이며 진행 구간은 바뀔 수 있습니다. 상승 추세는 스윙 저점끼리(붉은색), 하락 추세는 스윙 고점끼리(파란색) 이은 선입니다. 변동성(ATR) 안쪽으로 닿으면 같은 선으로 보고, 닿음 3회 이상은 실선·2회는 점선입니다. 종가가 허용치 넘게 2봉 연속 벗어나면 추세 이탈, 직전 극점까지 깨면 추세 전환으로 표시합니다. 관찰용이며 매수·매도 신호가 아닙니다.';

  function atrAt(bars, i) {
    var n = TREND.atrPeriod, from = Math.max(1, i - n + 1), sum = 0, cnt = 0;
    for (var k = from; k <= i; k++) {
      var b = bars[k], pc = bars[k - 1].close;
      var tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
      if (isFinite(tr)) { sum += tr; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  }
  // 한 방향(up=저점 추세선, down=고점 추세선)의 가장 좋은 선 하나. 점은 {i, p}, 오래된 순.
  function bestTrend(bars, pivots, dir) {
    var last = bars.length - 1, atr = atrAt(bars, last), best = null;
    var pts = pivots.slice(-TREND.maxPivots);
    function tol(price, atrMul, pct) { return Math.max(atrMul * atr, pct * price); }
    for (var x = 0; x < pts.length; x++) for (var y = x + 1; y < pts.length; y++) {
      var A = pts[x], B = pts[y];
      if (B.i - A.i < 3) continue;
      var m = (B.p - A.p) / (B.i - A.i);
      if (dir === 'up' ? m <= 0 : m >= 0) continue;
      function at(i) { return A.p + m * (i - A.i); }
      // 이탈 봉: 종가가 선 아래(상승)·위(하락)로 허용치 넘게 breakBars 연속
      var breakIdx = -1, run = 0;
      for (var i = A.i; i <= last; i++) {
        var gap = dir === 'up' ? at(i) - bars[i].close : bars[i].close - at(i);
        if (gap > tol(at(i), TREND.breakAtr, TREND.breakPct)) { run++; if (run >= TREND.breakBars) { breakIdx = i; break; } } else run = 0;
      }
      var lastOk = breakIdx < 0 ? last : breakIdx - TREND.breakBars;   // 이탈 직전까지만 선의 유효 구간
      if (lastOk < B.i) continue;                                         // 두 번째 점에 닿기 전에 이미 깨진 선은 버린다
      var touches = [];
      pts.forEach(function (q) {
        if (q.i < A.i || q.i > lastOk) return;
        if (Math.abs(q.p - at(q.i)) <= tol(q.p, TREND.touchAtr, TREND.touchPct)) touches.push(q);
      });
      if (touches.length < TREND.minTouches) continue;
      if (breakIdx >= 0 && last - breakIdx > TREND.staleBars) continue;   // 오래전에 끝난 선은 보이지 않는다
      var cand = { dir: dir, m: m, b: A.p - m * A.i, start: A.i, end: last, touches: touches, solid: touches.length >= TREND.solidTouches,
                   breakIndex: breakIdx, reversed: false, reversalIndex: -1, lastTouch: touches[touches.length - 1].i };
      // 점수: 닿음 수 → 최근에 닿은 정도 → 긴 구간 순. 깨진 선보다 살아 있는 선을 우선한다.
      cand.score = (breakIdx < 0 ? 1e6 : 0) + touches.length * 1e4 + cand.lastTouch * 10 + (cand.end - cand.start) * 0.001;
      if (!best || cand.score > best.score) best = cand;
    }
    if (best && best.breakIndex >= 0) {
      // 추세 전환: 이탈 전 마지막 반대편 스윙 극점(상승선이면 직전 저점, 하락선이면 직전 고점)을 이후 종가가 넘어선 봉
      var ref = null;
      pts.forEach(function (q) { if (q.i <= best.breakIndex && (!ref || q.i > ref.i)) ref = q; });
      if (ref) for (var j = best.breakIndex; j <= last; j++) {
        if (dir === 'up' ? bars[j].close < ref.p : bars[j].close > ref.p) { best.reversed = true; best.reversalIndex = j; break; }
      }
    }
    return best;
  }

  // Local channels describe each existing wave; they never change wave detection.
  // Regression proposes a direction, candle envelopes validate both parallel rails.
  function trendShape(bars,start,end) {
    var AW=global.AutoWave, rows=bars.slice(start,end+1);
    var shape=AW && AW.shapeOf ? AW.shapeOf(rows) : null;
    // Tiny strokes remain noise; coherent shorter swings can survive the old 15-bar cutoff.
    var useful=end-start>=TREND.minSpan || (end-start>=11 && shape && shape.coherence>=.8 && shape.efficiency>=.45);
    if(shape && end-start>=TREND.minSpan && shape.coherence<.4 && shape.efficiency<.2)useful=false;
    return {useful:useful,shape:shape};
  }
  function waveChannels(bars, waves) {
    var lines = [];
    (waves || []).forEach(function(w) {
      var start = Math.max(0, w.start), end = Math.min(bars.length - 1, w.end);
      if (!/^(up|down|side|wide)$/.test(w.kind) || !trendShape(bars,start,end).useful) return;
      var observedEnd = end, progressing = w.confirmed === false;
      // Hold the latest two closes out of the fit so a fresh break cannot pull the rail along.
      if (progressing && bars.length-1-end <= TREND.recentBars && end-start >= TREND.minSpan+2) end -= 2;
      var n = end - start + 1, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = start; i <= end; i++) {
        var x = i - start, y = bars[i].close;
        if (![y,bars[i].high,bars[i].low].every(Number.isFinite)) return;
        sx += x; sy += y; sxx += x*x; sxy += x*y;
      }
      var structure=trendShape(bars,start,end).shape;
      var m = structure && Number.isFinite(structure.slope) ? structure.slope : (n*sxy-sx*sy)/(n*sxx-sx*sx);
      var atr = atrAt(bars,end), side = w.kind === 'side' || w.kind === 'wide';
      if (side) m = 0;
      if (!side && (w.kind === 'up' ? m <= 0 : m >= 0)) return;
      var lows = [], highs = [];
      for (var j = start; j <= end; j++) {
        lows.push(bars[j].low-m*j); highs.push(bars[j].high-m*j);
      }
      lows.sort(function(a,b){return a-b;}); highs.sort(function(a,b){return a-b;});
      // Ignore isolated wick outliers, but never accept repeated close violations.
      var lo = lows[Math.floor((n-1)*0.05)], hi = highs[Math.ceil((n-1)*0.95)];
      var outside = 0;
      for (var z=start;z<=end;z++) {
        var residual=bars[z].close-m*z;
        outside = residual < lo-atr || residual > hi+atr ? outside+1 : 0;
        if(outside>=TREND.breakBars)return;
      }
      var width = hi-lo;
      // Very broad envelopes do not describe a useful directional channel.
      if (!(width > 0) || (!side && width > Math.max(6*atr,Math.abs(m)*(end-start)*1.25))) return;
      var rails = [{b:lo,edge:'support'},{b:hi,edge:'resistance'}], valid = [];
      rails.forEach(function(rail) {
        var touches = [], tolerance = Math.max(atr*0.75,Math.abs(sy/n)*0.01);
        for (var k = start; k <= end; k++) {
          var price = rail.edge === 'support' ? bars[k].low : bars[k].high;
          if (Math.abs(price-(m*k+rail.b)) <= tolerance &&
              (!touches.length || k-touches[touches.length-1].i >= 3)) touches.push({i:k,p:price});
        }
        if (touches.length < 2 || touches[touches.length-1].i-touches[0].i < (end-start)*0.3) return;
        valid.push({dir:side?'side':w.kind,m:m,b:rail.b,start:start,end:observedEnd,fitEnd:end,progressing:progressing,
          touches:touches,solid:w.confirmed !== false && touches.length >= 3,
          breakIndex:-1,reversed:false,reversalIndex:-1,local:true,edge:rail.edge});
      });
      // A channel is only shown when both boundaries have independent contacts.
      if (valid.length === 2) lines = lines.concat(valid);
    });
    return lines;
  }

  function trendLinesOf(bars, waves, lowerWaves) {
    if (!bars || bars.length < 20) return { up: null, down: null, lines: [] };
    var lows = [], highs = [], seen = {};
    function add(i, p, type) {
      var k = type + i;
      if (seen[k] || !isFinite(p) || i < 0 || i >= bars.length) return;
      seen[k] = true;
      (type === 'L' ? lows : highs).push({ i: i, p: p });
    }
    (lowerWaves || []).concat(waves || []).forEach(function (w) {
      if (!w || w.isBox || (w.kind !== 'up' && w.kind !== 'down')) return;
      if (w.kind === 'up') { add(w.start, w.low, 'L'); add(w.end, w.high, 'H'); }
      else { add(w.start, w.high, 'H'); add(w.end, w.low, 'L'); }
    });
    var byIndex = function (a, b) { return a.i - b.i; };
    lows.sort(byIndex); highs.sort(byIndex);
    var up = bestTrend(bars,lows,'up'), down = bestTrend(bars,highs,'down');
    var lines = waveChannels(bars,waves);
    // Preserve older local support/resistance even when it has already broken.
    (waves || []).forEach(function(w) {
      if (w.kind !== 'up' && w.kind !== 'down') return;
      var end = Math.min(bars.length-1,w.end), pts = w.kind === 'up' ? lows : highs;
      var t = bestTrend(bars.slice(0,end+1),pts.filter(function(p){return p.i>=w.start && p.i<=end;}),w.kind);
      if (t) { t.end = t.breakIndex >= 0 ? t.breakIndex : end; t.local = true; lines.push(t); }
    });
    // Long context remains secondary to local geometry; cap its extension after a break.
    [up,down].forEach(function(t){if(t){t.end=t.breakIndex>=0?Math.min(t.end,t.breakIndex+8):t.end;lines.push(t);}});
    var unique = [];
    lines.forEach(function(t) {
      if (!trendShape(bars,t.start,t.end).useful) return;
      var duplicate = unique.some(function(q) {
        return q.dir===t.dir && (!q.edge || !t.edge || q.edge===t.edge) && Math.min(q.end,t.end)-Math.max(q.start,t.start) >=
          Math.min(q.end-q.start,t.end-t.start)*0.75 &&
          Math.abs(q.m-t.m)*Math.min(q.end-q.start,t.end-t.start)<Math.max(atrAt(bars,t.end),0.01) &&
          Math.abs((q.m*t.start+q.b)-(t.m*t.start+t.b))<Math.max(atrAt(bars,t.start),0.01);
      });
      if(!duplicate)unique.push(t);
    });
    var last = bars.length-1, fitted = unique.map(function(t){return Object.assign({},t);});
    unique.forEach(function(t) {
      t.active = t.breakIndex < 0 && last-t.end <= TREND.recentBars;
      if (!t.active) return;
      var run = 0, checkFrom = t.fitEnd == null ? t.end+1 : t.fitEnd+1;
      // Channels use the trend's supporting boundary, not its opposite rail.
      var boundary = t.edge && t.dir === 'up' ? 'support' : (t.edge && t.dir === 'down' ? 'resistance' : t.edge);
      var rail = boundary ? fitted.find(function(q) {
        return q.start===t.start && q.end===t.end && q.dir===t.dir && q.edge===boundary;
      }) : t;
      if (!rail) rail=t;
      for(var i=checkFrom;i<=last;i++) {
        var at=rail.m*i+rail.b, close=bars[i].close;
        var gap=rail.dir==='up'?at-close:(rail.dir==='down'?close-at:Math.abs(close-at));
        if(rail.dir==='side')gap=rail.edge==='support'?at-close:close-at;
        var tolerance=Math.max(atrAt(bars,i)*TREND.breakAtr,Math.abs(at)*TREND.breakPct);
        if(gap>tolerance) { if(++run>=TREND.breakBars){t.breakIndex=i;t.end=i;t.active=false;break;} } else run=0;
      }
      if(t.active) t.projectionEnd=last+TREND.projectionBars;
    });
    unique.forEach(function(t){if(t.active)t.end=last;});
    return { up:up, down:down, lines:unique };

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
      var text = wave.pullback ? wave.pullback.label : (wave.label || st.label);
      if (!wave.confirmed) text += ' · 진행 중';
      else if (level !== 'minor' && !wave.isBox && wave.confirmedIndex != null) text += ' · 확정 +' + (wave.confirmedIndex - wave.end) + '봉';
      ctx.font = '700 10px ' + font;
      ctx.fillStyle = st.stroke;
      ctx.textBaseline = 'top';
      // 확대·이동으로 박스 왼쪽이 화면 밖이어도 라벨은 보이는 영역 안에서 시작한다.
      var lx = Math.max(x1 + 4, 4);
      while (text.length > (wave.pullback ? wave.pullback.label.length : 2) && ctx.measureText(text).width > x2 - lx - 2) text = text.slice(0, -1);
      // 소파동은 박스가 아주 많아 라벨이 겹치므로 어느 정도 폭이 있을 때만 쓴다.
      if (x2 - lx > (level === 'minor' ? 34 : 12) && (!wave.pullback || ctx.measureText(wave.pullback.label).width <= x2-lx-2)) ctx.fillText(text, lx, y1 + 3);
    });
    // 구간별 추세/평행 채널 + 보조 장기선. 과거 선은 해당 구간까지만 그린다.
    if (picked.trend) {
      if (!picked._trend || picked._trendFingerprint !== fingerprintOf(bars)) { picked._trend = trendLinesOf(bars, picked.trendWaves || picked.waves, picked.lower); picked._trendFingerprint = fingerprintOf(bars); }
      picked._trend.lines.forEach(function (t) {
        var dir = t.dir;
        if (!t) return;
        var color = TREND_COLOR[dir] || STYLE.side.stroke;
        function pt(i) {
          var last=bars.length-1, p=view.coord({time:bars[Math.min(i,last)].date,price:t.m*i+t.b});
          if (p && i>last) {
            var scale=view.chart && view.chart.timeScale();
            var x=scale && scale.logicalToCoordinate ? scale.logicalToCoordinate(i) : null;
            if(x!=null)p={x:x,y:p.y};
            else if(xa && xb)p={x:p.x+(xb.x-xa.x)*(i-last),y:p.y};
            else return null;
          }
          return p;
        }
        var p0 = pt(t.start), p1 = pt(t.end);
        if (!p0 || !p1 || Math.max(p0.x, p1.x) < 0 || Math.min(p0.x, p1.x) > view.width || (t.local && Math.abs(p1.x-p0.x)<36)) return;
        var brk = t.breakIndex >= 0 ? pt(t.breakIndex) : null;
        ctx.save();
        ctx.strokeStyle = color; ctx.lineWidth = t.local ? 2.2 : 1.4;
        ctx.globalAlpha = t.local ? 0.95 : 0.55;
        // 살아 있는 구간: 확정선은 실선, 잠정선(닿음 2회)은 점선. 이탈 이후 구간은 옅은 점선.
        var liveEnd = brk || p1;
        ctx.setLineDash(t.solid ? [] : [8, 4]);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(liveEnd.x, liveEnd.y); ctx.stroke();
        if (brk) {
          ctx.globalAlpha = 0.5; ctx.setLineDash([3, 5]);
          ctx.beginPath(); ctx.moveTo(brk.x, brk.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        if (t.active && t.projectionEnd != null) {
          var future=pt(t.projectionEnd);
          if(future) {
            ctx.globalAlpha=0.8; ctx.setLineDash([5,4]);
            ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(future.x,future.y);ctx.stroke();
          }
        }
        ctx.restore();
        (t.local ? [] : t.touches).forEach(function (q) {
          var tp = view.coord({ time: bars[q.i].date, price: q.p });
          if (!tp || tp.x < 0 || tp.x > view.width) return;
          ctx.beginPath(); ctx.arc(tp.x, tp.y, 3.6, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        });
        var marks = [];
        if (t.breakIndex >= 0) marks.push({ i: t.breakIndex, text: '추세 이탈 ' + (dir === 'up' ? '▼' : '▲') });
        if (t.reversed) marks.push({ i: t.reversalIndex, text: '추세 전환' });
        marks.forEach(function (mk) {
          var mp = view.coord({ time: bars[mk.i].date, price: t.m * mk.i + t.b });
          if (!mp || mp.x < 0 || mp.x > view.width) return;
          ctx.font = '700 11px ' + font; ctx.fillStyle = color; ctx.textBaseline = dir === 'up' ? 'top' : 'bottom';
          var w = ctx.measureText(mk.text).width, tx = Math.min(Math.max(mp.x - w / 2, 2), Math.max(2, view.width - w - 2));
          ctx.fillText(mk.text, tx, mp.y + (dir === 'up' ? 6 : -6));
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
    out+=escapeText(wave.pullback ? wave.pullback.label : (wave.label || (STYLE[wave.kind] || STYLE.unk).label))+' · '+(wave.confirmed?'확정(실선)':'진행 중(점선·변경 가능)')+'<br>';
    if(wave.pullback)out+='되돌림 '+Math.round(wave.pullback.retrace*100)+'% · '+(wave.pullback.volumeRatio==null?'거래량 자료 부족':'상승 구간 대비 거래량 '+Math.round(wave.pullback.volumeRatio*100)+'%')+'<br>'+escapeText(wave.pullback.reason)+'<br>';
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
        out+='<hr><b>현재 그림의 해당 영역 (사후 재구성)</b><br>'+escapeText(region.pullback ? region.pullback.label : (region.label || STYLE[region.kind].label));
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
    trendShape: trendShape, levelHtml: levelHtml, wireControls: wireControls, drawWaves: drawWaves, trendLinesOf: trendLinesOf, attach: attach, activeMajor:activeMajor, majorTooltipHtml:majorTooltipHtml,
    _cache: getCache
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.NineChartWave;
})(typeof window !== 'undefined' ? window : globalThis);
