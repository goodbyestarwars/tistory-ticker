/* 자동 파동 구조 (실험적 차트 분석 보조) - 가격 움직임의 구조를 대·중·소 세 계층으로 객관적으로 나눠 보여줄 뿐이다.
 * 엘리어트 번호를 매기지 않고, 특정 투자자의 공식 알고리즘을 재현한다고 주장하지 않으며, 매수·매도 추천이나 미래 방향을 말하지 않는다.
 * 일봉 OHLCV만 쓰고 브라우저에서 계산한다.
 *
 * ── 큰 틀 ──────────────────────────────────────────────────────────────────────────────
 *  한 번의 순차 처리(봉을 하나씩 먹이는 상태기계)로 세 규모의 지그재그를 동시에 돌린다. 어느 봉에서 낸 결과도 그 봉까지의 자료만 쓴다.
 *  analyze(prefix)와 analyze(전체)에서 같은 confirmedIndex 이하의 확정 파동은 늘 같고, 겉모습이 달라지는 경우(박스가 앞선 파동을 감싸는 등)는
 *  revisions 에 사유·시점이 기록된다. test/test_auto_wave_causality.js 가 봉마다 엄격하게 비교한다.
 *
 *  규모(ATR14 배수로 반대 방향 되돌림이 확인돼야 극점 확정):
 *    소파동(minor)  - 짧은 눌림·재돌파·단기 저점 상승.            기본 1.5xATR
 *    중파동(medium) - 스윙매매 기준의 상승·조정·재상승.            기본 3.0xATR (기존 자동 파동의 기준을 이어받음)
 *    대파동(major)  - 주된 방향(고점·저점의 상승/하락, 긴 횡보·바닥). 기본 8.0xATR
 *  상·하위 연결: 소→중→대 순으로 시간 포함 관계로 parent 를 잇는다(같은 일봉 위의 서로 다른 규모). 박스(횡보)는 안의 파동을 지우지 않고
 *  childIds 로 가지고 있으며, 박스에 감싸인 같은 규모의 파동은 suppressed=true(그 규모 화면에서는 박스만 그림, 더 작은 규모에서는 그대로 보임).
 *
 * ── 용어 ───────────────────────────────────────────────────────────────────────────────
 *  극점 날짜(start/end)와 확정 시점(startConfirmedIndex/confirmedIndex)은 다르다. 극점은 되돌림이 확인돼야 확정되므로 늘 뒤늦게 알려진다.
 *  진행 중(confirmed=false)인 파동은 새 봉이 들어오면 끝점·방향이 바뀔 수 있다.
 *  같은 봉의 고가·저가 발생 순서는 일봉만으로 알 수 없다. 그래서 (1) 신고가·신저가를 낸 봉은 반대 방향 되돌림 판정에 쓰지 않고(다음 봉부터 판정),
 *  (2) 첫 방향을 정하는 구간에서 위아래 조건이 한 봉에 동시에 충족되면 정하지 않고 다음 봉으로 미룬다.
 *
 *  횡보(박스) 판정(isSideways): "ATR이 작다"만으로는 횡보가 아니다. 방향 효율성 ER 이 낮고, 순변화가 범위의 절반 이하이며, 범위 상·하단 띠를 각각
 *  2번 이상 두드리고 중간선을 2번 이상 오가며, 구간 끝 이동평균이 평탄하고, 범위가 ATR 배수·저점 대비 비율 상한 안일 때만 인정한다.
 *  저점 대비 범위가 30% 이상이면 kind 'wide'(변동성 큰 박스권)로 구분하고 '응축'이라 부르지 않는다.
 *
 *  대파동의 추세 상태(regime): 대파동 극점의 고점·저점이 둘 다 올랐으면 'up', 둘 다 내렸으면 'down', 고점은 내리고 저점은 오르면 'compression',
 *  고점은 오르고 저점은 내리면 'expansion', 그 밖은 'range'. 상승 구조에서 직전 대파동 저점을 종가로 이탈하면 'up_broken',
 *  하락 구조에서 직전 대파동 고점을 종가로 넘으면 'down_recovering'. 224일선·60일선·구름대는 이 판정을 대신하지 않고 근거(evidence)로만 붙는다.
 */
(function (global) {
  'use strict';

  var VERSION = '2026-11-05-shape-selection';

  var DEFAULTS = {
    atrPeriod: 14,
    levels: {
      minor: { zigzagAtr: 1.5, minBars: 2 },
      medium: {
        zigzagAtr: 3.0, minBars: 3,
        box: { minBars: 12, rangeAtrMax: 10, maxRangePct: 0.50, maxPivots: 30, ma: 20, maLookback: 10, pivotBand: 0.30 }
      },
      major: {
        zigzagAtr: 8.0, minBars: 8,
        box: { minBars: 60, rangeAtrMax: 18, maxRangePct: 0.60, maxPivots: 24, ma: 60, maLookback: 20, pivotBand: 0.30 }
      }
    },
    sideErMax: 0.25,
    sideNetRangeMax: 0.5,
    sideMaFlatAtr: 2.0,
    wideRangePct: 0.30,
    baseMinBars: 80,          // 바닥 횡보로 보는 최소 기간(약 4개월)
    baseDeclinePct: 0.15,     // 바닥 이전 최근 120봉 고점 대비 이만큼 이상 내려온 뒤여야 한다
    baseMinHigherLows: 2,     // 박스 안 중파동 저점이 직전 저점보다 높아진 횟수
    pullbackMinRetrace: 0.25, // 직전 상승분의 이 비율 이상 되돌린 중파동 하락을 눌림으로 본다
    rallyExpireBars: 60,      // 하락 구조 안의 단기 급등이 저항을 못 넘고 시작 저점을 이탈하는지 지켜보는 기간
    supportBreakPct: 0.0      // 상승 구조의 직전 대파동 저점을 종가로 이만큼 이상 이탈하면 훼손
  };

  var LEVELS = ['major', 'medium', 'minor'];

  /* ── 지표(모두 그 봉까지의 값) ─────────────────────────────────────────────────────── */
  function atrSeries(bars, period) {
    var out = new Array(bars.length), sum = 0;
    for (var i = 0; i < bars.length; i++) {
      var prevClose = i ? bars[i - 1].close : bars[i].close;
      var tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevClose), Math.abs(bars[i].low - prevClose));
      if (i < period) { sum += tr; out[i] = i === period - 1 ? sum / period : null; }
      else out[i] = (out[i - 1] * (period - 1) + tr) / period;
    }
    return out;
  }

  function smaSeries(bars, period, key) {
    var out = new Array(bars.length), sum = 0;
    key = key || 'close';
    for (var i = 0; i < bars.length; i++) {
      sum += bars[i][key] || 0;
      if (i >= period) sum -= bars[i - period][key] || 0;
      out[i] = i >= period - 1 ? sum / period : null;
    }
    return out;
  }

  /* 일목균형표 구름(선행스팬 A·B). 구름은 26봉 앞으로 그려지므로 i 봉의 구름은 i-26 봉까지의 자료로 만든 값이다(미래 비참조). */
  function cloudSeries(bars) {
    var n = bars.length, top = new Array(n), bottom = new Array(n);
    function mid(a, b) {
      var hi = -Infinity, lo = Infinity;
      for (var k = a; k <= b; k++) { if (bars[k].high > hi) hi = bars[k].high; if (bars[k].low < lo) lo = bars[k].low; }
      return (hi + lo) / 2;
    }
    for (var i = 0; i < n; i++) {
      var s = i - 26;
      if (s < 51) { top[i] = bottom[i] = null; continue; }
      var spanA = (mid(s - 8, s) + mid(s - 25, s)) / 2;
      var spanB = mid(s - 51, s);
      top[i] = Math.max(spanA, spanB); bottom[i] = Math.min(spanA, spanB);
    }
    return { top: top, bottom: bottom };
  }

  function rangeOf(bars, a, b) {
    var hi = -Infinity, lo = Infinity;
    for (var i = a; i <= b; i++) { if (bars[i].high > hi) hi = bars[i].high; if (bars[i].low < lo) lo = bars[i].low; }
    return { high: hi, low: lo };
  }

  function efficiency(bars, a, b) {
    var path = 0;
    for (var i = a + 1; i <= b; i++) path += Math.abs(bars[i].close - bars[i - 1].close);
    return path > 0 ? Math.abs(bars[b].close - bars[a].close) / path : 0;
  }

  function sideKind(range, opt) {
    return range.high / range.low - 1 >= opt.wideRangePct ? 'wide' : 'side';
  }

  /* 데이터 지문(FNV-1a): 마지막 봉만 같고 과거 OHLC 가 정정된 경우도 캐시를 새로 만들게 한다. */
  function hashBars(bars) {
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

  /* ── 규모별 지그재그(순차 입력) ───────────────────────────────────────────────────── */
  function makeZigzag(bars, atr, k) {
    var z = { dir: 0, extIdx: -1, extPrice: 0, hiIdx: -1, hiPrice: 0, loIdx: -1, loPrice: 0, started: false, pivots: [] };
    z.feed = function (i) {
      var a = atr[i];
      if (a == null) return null;
      var b = bars[i], th = a * k, piv = null;
      if (!z.started) { z.started = true; z.hiIdx = z.loIdx = i; z.hiPrice = b.high; z.loPrice = b.low; return null; }
      if (z.dir === 0) {
        // 첫 방향: 위·아래 조건이 한 봉에서 함께 충족되면 순서를 알 수 없으므로 정하지 않는다.
        var upOk = b.high - z.loPrice >= th, downOk = z.hiPrice - b.low >= th;
        if (upOk && !downOk) { piv = { idx: z.loIdx, type: 'low', price: z.loPrice, confirmedIndex: i }; z.dir = 1; z.extIdx = i; z.extPrice = b.high; }
        else if (downOk && !upOk) { piv = { idx: z.hiIdx, type: 'high', price: z.hiPrice, confirmedIndex: i }; z.dir = -1; z.extIdx = i; z.extPrice = b.low; }
        else {
          if (b.high > z.hiPrice) { z.hiPrice = b.high; z.hiIdx = i; }
          if (b.low < z.loPrice) { z.loPrice = b.low; z.loIdx = i; }
        }
      } else if (z.dir === 1) {
        // 신고가를 낸 봉은 되돌림 판정에 쓰지 않는다(같은 봉 안의 고·저 순서를 모른다).
        if (b.high > z.extPrice) { z.extPrice = b.high; z.extIdx = i; }
        else if (z.extPrice - b.low >= th) { piv = { idx: z.extIdx, type: 'high', price: z.extPrice, confirmedIndex: i }; z.dir = -1; z.extIdx = i; z.extPrice = b.low; }
      } else {
        if (b.low < z.extPrice) { z.extPrice = b.low; z.extIdx = i; }
        else if (b.high - z.extPrice >= th) { piv = { idx: z.extIdx, type: 'low', price: z.extPrice, confirmedIndex: i }; z.dir = 1; z.extIdx = i; z.extPrice = b.high; }
      }
      if (piv) z.pivots.push(piv);
      return piv;
    };
    return z;
  }

  /* ── 횡보 판정: 구간 [a, b] 가 같은 범위를 오가는 박스권인가 ──────────────────────── */
  function isSideways(ctx, a, b, prm) {
    var bars = ctx.bars, opt = ctx.opt;
    prm = prm || {};
    var minBars = prm.minBars != null ? prm.minBars : opt.levels.medium.box.minBars;
    var rangeAtrMax = prm.rangeAtrMax != null ? prm.rangeAtrMax : opt.levels.medium.box.rangeAtrMax;
    if (b - a + 1 < minBars) return false;
    var atrSum = 0, atrN = 0;
    for (var t = a; t <= b; t++) if (ctx.atr[t]) { atrSum += ctx.atr[t]; atrN++; }
    var atr = atrN ? atrSum / atrN : null;
    if (!atr) return false;
    var r = rangeOf(bars, a, b), range = r.high - r.low;
    if (!(range > 0) || range > rangeAtrMax * atr) return false;
    if (prm.maxRangePct != null && r.high / r.low - 1 > prm.maxRangePct) return false;
    if (efficiency(bars, a, b) > opt.sideErMax) return false;
    if (Math.abs(bars[b].close - bars[a].close) > opt.sideNetRangeMax * range) return false;
    var ma = prm.ma === 60 ? ctx.ma60 : ctx.ma20, look = prm.maLookback || 10;
    var m1 = ma[b], m0 = ma[Math.max(a, b - look)];
    if (m1 == null || m0 == null || Math.abs(m1 - m0) > opt.sideMaFlatAtr * atr) return false;
    var upBand = r.high - range * 0.25, loBand = r.low + range * 0.25, mid = (r.high + r.low) / 2;
    var upTouch = 0, loTouch = 0, lastUp = -9, lastLo = -9, cross = 0, side = 0;
    for (var i = a; i <= b; i++) {
      if (bars[i].high >= upBand && i - lastUp >= 3) { upTouch++; lastUp = i; }
      if (bars[i].low <= loBand && i - lastLo >= 3) { loTouch++; lastLo = i; }
      var s = bars[i].close >= mid ? 1 : -1;
      if (side && s !== side) cross++;
      side = s;
    }
    return upTouch >= 2 && loTouch >= 2 && cross >= 2;
  }

  function mergeOptions(options) {
    var opt = JSON.parse(JSON.stringify(DEFAULTS));
    options = options || {};
    Object.keys(opt).forEach(function (k) {
      if (k === 'levels') return;
      if (options[k] != null) opt[k] = options[k];
    });
    // 예전 평평한 옵션 이름은 중파동 설정으로 읽는다(하위 호환).
    var med = opt.levels.medium;
    if (options.zigzagAtr != null) med.zigzagAtr = options.zigzagAtr;
    if (options.minBars != null) med.minBars = options.minBars;
    if (options.minSidewaysBars != null) med.box.minBars = options.minSidewaysBars;
    if (options.sideRangeAtrMax != null) med.box.rangeAtrMax = options.sideRangeAtrMax;
    if (options.levels) {
      LEVELS.forEach(function (name) {
        var src = options.levels[name];
        if (!src) return;
        Object.keys(src).forEach(function (key) {
          if (key === 'box') Object.keys(src.box).forEach(function (bk) { opt.levels[name].box[bk] = src.box[bk]; });
          else opt.levels[name][key] = src[key];
        });
      });
    }
    return opt;
  }

  /* ── 본체 ──────────────────────────────────────────────────────────────────────────── */
  function analyze(bars, options) {
    var opt = mergeOptions(options);
    var empty = { version: VERSION, params: opt, levels: { major: [], medium: [], minor: [] }, waves: [], revisions: [], signals: [], state: null, asOf: bars ? bars.length - 1 : -1, dataHash: null };
    if (!bars || bars.length < opt.atrPeriod + 10) return empty;
    var n = bars.length;
    var ctx = { bars: bars, opt: opt, atr: atrSeries(bars, opt.atrPeriod), ma20: smaSeries(bars, 20), ma60: smaSeries(bars, 60), ma224: smaSeries(bars, 224), vol20: smaSeries(bars, 20, 'volume'), cloud: cloudSeries(bars) };
    var revisions = [], signals = [];
    var regimeSeries = options && options.withSeries ? new Array(n) : null;

    var scales = {};
    LEVELS.forEach(function (name) {
      var prm = opt.levels[name];
      scales[name] = { name: name, prm: prm, zz: makeZigzag(bars, ctx.atr, prm.zigzagAtr), pivots: [], legs: [], boxes: [], openBox: null, boxFloor: 0, growth: {} };
    });
    var majorHighs = [], majorLows = [];
    var pendingRally = [];     // 이번 봉에서 확정된 중파동 상승(하락 구조 안의 반등 후보)
    var rallies = [];
    var prevFlags = { H1: false, H2: false, H3: false };
    var lastSignalIdx = { H1: -999, H2: -999, H3: -999 };
    var lastCross224 = -999;

    function legTags(leg, prevSame, prevLeg) {
      // 끝 극점이 같은 종류의 직전 극점과 비교해 고점·저점이 올랐는가(HH/HL) 내렸는가(LH/LL)
      if (prevSame) {
        if (leg.kind === 'up') leg.struct = leg.endPrice > prevSame.price ? 'HH' : 'LH';
        else leg.struct = leg.endPrice < prevSame.price ? 'LL' : 'HL';
      } else leg.struct = null;
      if (prevLeg) {
        var prevSize = Math.abs(prevLeg.endPrice - prevLeg.startPrice);
        leg.retrace = prevSize > 0 ? +(Math.abs(leg.endPrice - leg.startPrice) / prevSize).toFixed(2) : null;
      } else leg.retrace = null;
    }

    function onPivot(sc, piv, i) {
      var P = sc.pivots;
      P.push(piv);
      if (sc.name === 'major') (piv.type === 'high' ? majorHighs : majorLows).push(piv);
      if (P.length >= 2) {
        var p0 = P[P.length - 2], p1 = piv;
        var up = p1.type === 'high';
        var leg = {
          id: sc.name + ':' + p0.idx + ':' + p1.idx, level: sc.name, kind: up ? 'up' : 'down', state: '확정', confirmed: true,
          start: p0.idx, end: p1.idx, startPrice: p0.price, endPrice: p1.price,
          high: up ? p1.price : p0.price, low: up ? p0.price : p1.price,
          startConfirmedIndex: p0.confirmedIndex, confirmedIndex: p1.confirmedIndex, endConfirmedIndex: p1.confirmedIndex,
          parent: null, childIds: [], tags: [], label: null, boxId: null, suppressed: false
        };
        var prevLeg = sc.legs.length ? sc.legs[sc.legs.length - 1] : null;
        legTags(leg, P.length >= 3 ? P[P.length - 3] : null, prevLeg);
        sc.legs.push(leg);
        if (sc.name === 'medium' && up) pendingRally.push(leg);
      }
      if (sc.prm.box) updateBoxes(sc, i);
    }

    function boxRevision(sc, box, legsInside, at) {
      var ids = [];
      (sc.growth[box.id] = sc.growth[box.id] || []).push({ end: box.end, at: at });   // 박스가 그 길이에 처음 알려진 봉(승격 시점 계산용)
      legsInside.forEach(function (l) { if (!l.boxId) { l.boxId = box.id; ids.push(l.id); } });
      if (ids.length) revisions.push({ at: at, level: sc.name, type: 'absorbed', boxId: box.id, waveIds: ids,
        reason: '같은 범위를 오가는 파동 ' + ids.length + '개가 횡보 박스로 묶임(파동 자체는 확정 그대로이고 이 규모에서는 박스 안의 파동으로 표시)' });
    }

    /* V자·역V자 한 번 오간 것을 박스로 착각하지 않도록, 구간 안의 극점이 범위 위쪽 띠에 고점 2개 이상, 아래쪽 띠에 저점 2개 이상 있어야 한다. */
    function repeatsHighsAndLows(P, j, last, prm) {
      var a = P[j].idx, b = P[last].idx, r = rangeOf(bars, a, b), range = r.high - r.low, band = (prm.pivotBand != null ? prm.pivotBand : 0.3) * range;
      var hi = 0, lo = 0;
      for (var q = j; q <= last; q++) {
        if (P[q].type === 'high' && P[q].price >= r.high - band) hi++;
        if (P[q].type === 'low' && P[q].price <= r.low + band) lo++;
      }
      return hi >= 2 && lo >= 2;
    }

    function legsBetween(sc, a, b) {
      return sc.legs.filter(function (l) { return l.start >= a && l.end <= b; });
    }

    function updateBoxes(sc, i) {
      var P = sc.pivots, last = P.length - 1, prm = sc.prm.box;
      if (last < 3) return;
      var open = sc.openBox;
      if (open) {
        if (isSideways(ctx, open.start, P[last].idx, prm) && repeatsHighsAndLows(P, open.startPivot, last, prm)) {
          open.end = P[last].idx; open.lastPivot = last;
          boxRevision(sc, open, legsBetween(sc, open.start, open.end), i);
          return;
        }
        // 범위를 벗어난 극점이 확정됐다: 박스는 그 직전 극점에서 끝난 것으로 확정한다.
        var rg = rangeOf(bars, open.start, open.end);
        open.high = rg.high; open.low = rg.low; open.kind = sideKind(rg, opt);
        open.state = '확정'; open.confirmed = true; open.confirmedIndex = i; open.endConfirmedIndex = i;
        sc.boxes.push(open);
        sc.boxFloor = open.lastPivot;
        sc.openBox = null;
      }
      for (var j = Math.max(sc.boxFloor, last - prm.maxPivots); j <= last - 3; j++) {
        if (isSideways(ctx, P[j].idx, P[last].idx, prm) && repeatsHighsAndLows(P, j, last, prm)) {
          var r = rangeOf(bars, P[j].idx, P[last].idx);
          var box = {
            id: sc.name + ':box:' + P[j].idx, level: sc.name, kind: sideKind(r, opt), state: '진행 중', confirmed: false, isBox: true,
            start: P[j].idx, end: P[last].idx, startPivot: j, lastPivot: last, high: r.high, low: r.low,
            startConfirmedIndex: P[j].confirmedIndex, confirmedIndex: null, endConfirmedIndex: null,
            parent: null, childIds: [], tags: [], label: null
          };
          sc.openBox = box;
          boxRevision(sc, box, legsBetween(sc, box.start, box.end), i);
          return;
        }
      }
    }

    /* 대파동 추세 상태 - 그 봉까지의 확정 대파동 극점과 종가만 쓴다.
       일봉이 600개 안팎이면 확정 대파동 극점이 4개가 안 돼 구조를 못 정하는 일이 잦다. 그때만 지금 진행 중인 대파동의 극점(아직 확정 전)을
       임시 극점으로 더해 판정하고 provisional 로 표시한다. */
    function structureOf(hs, ls) {
      if (hs.length < 2 || ls.length < 2) return 'unknown';
      var h2 = hs[hs.length - 1].price, h1 = hs[hs.length - 2].price, l2 = ls[ls.length - 1].price, l1 = ls[ls.length - 2].price;
      if (h2 > h1 && l2 > l1) return 'up';
      if (h2 < h1 && l2 < l1) return 'down';
      if (h2 < h1 && l2 > l1) return 'compression';
      if (h2 > h1 && l2 < l1) return 'expansion';
      return 'range';
    }

    function regimeAt(i) {
      var c = bars[i].close, z = scales.major.zz, provisional = false;
      var base = structureOf(majorHighs, majorLows);
      var hs = majorHighs, ls = majorLows;
      if (base === 'unknown' && z.dir !== 0 && scales.major.pivots.length) {
        var lastP = scales.major.pivots[scales.major.pivots.length - 1];
        if (z.extIdx > lastP.idx) {
          var hs2 = majorHighs, ls2 = majorLows;
          if (z.dir === 1) hs2 = majorHighs.concat([{ price: z.extPrice }]);
          else ls2 = majorLows.concat([{ price: z.extPrice }]);
          var alt = structureOf(hs2, ls2);
          if (alt !== 'unknown') { base = alt; hs = hs2; ls = ls2; provisional = true; }
        }
      }
      // 확정된 고점·저점이 아직 짝으로 모자라도, 대파동 규모(8xATR)의 상승·하락이 진행 중이면 그 방향의 임시 구조로 본다(provisional).
      // 직전 확정 대파동 고점(저점)과의 관계로 방향을 정한다: 상승 중인 대파동이 아직 직전 고점 아래면 '하락 구조 안의 반등', 하락 중인 대파동이 직전 저점 위면 '상승 구조 안의 눌림'.
      if (base === 'unknown' && z.dir !== 0 && scales.major.pivots.length) {
        if (z.dir === 1) base = (majorHighs.length && z.extPrice <= majorHighs[majorHighs.length - 1].price) ? 'down' : 'up';
        else base = (majorLows.length && z.extPrice >= majorLows[majorLows.length - 1].price) ? 'up' : 'down';
        provisional = true;
      }
      if (base === 'up' && ls.length && c < ls[ls.length - 1].price * (1 - opt.supportBreakPct) && !(provisional && z.dir === -1)) base = 'up_broken';
      if (base === 'down' && hs.length && c > hs[hs.length - 1].price && !(provisional && z.dir === 1)) base = 'down_recovering';
      return { regime: base, source: 'major', provisional: provisional };
    }

    function mediumPullback() {
      var sc = scales.medium, z = sc.zz, P = sc.pivots;
      if (z.dir !== -1 || P.length < 2) return null;
      var hi = P[P.length - 1], lo = P[P.length - 2];
      if (hi.type !== 'high' || lo.type !== 'low') return null;
      var size = hi.price - lo.price;
      if (!(size > 0)) return null;
      return { retrace: (hi.price - z.extPrice) / size, prevLow: lo.price, high: hi.price, extPrice: z.extPrice };
    }

    function rising(arr) {
      return arr.length >= 2 && arr[arr.length - 1].price > arr[arr.length - 2].price;
    }

    /* 바닥 횡보 모양(이전 하락 → 80봉 이상 박스 → 박스 안 저점 상승)이 i 봉까지의 자료로 성립하는가. 라벨 표시(markBases)와 돌파 신호가 같은 판정을 쓴다. */
    function baseAsOf(box, boxEnd) {
      var len = boxEnd - box.start + 1;
      if (len < opt.baseMinBars) return null;
      var from = Math.max(0, box.start - 120), prior = -Infinity;
      for (var k = from; k < box.start; k++) if (bars[k].close > prior) prior = bars[k].close;
      if (!(prior > 0) || bars[box.start].close > prior * (1 - opt.baseDeclinePct)) return null;
      var lows = scales.medium.legs.filter(function (w) { return w.kind === 'down' && w.end >= box.start && w.end <= boxEnd; });
      var steps = 0;
      for (var q = 1; q < lows.length; q++) if (lows[q].endPrice > lows[q - 1].endPrice) steps++;
      if (steps < opt.baseMinHigherLows) return null;
      return { higherLows: steps, declinePct: +(1 - bars[box.start].close / prior).toFixed(3), bars: len };
    }

    /* 열린 박스의 끝: 마지막 극점 뒤로, 종가가 범위(±25%)를 벗어나기 전까지의 봉. i 봉까지의 자료만 쓴다. */
    function openBoxEnd(box, i) {
      var rg = rangeOf(bars, box.start, box.end), span = rg.high - rg.low, tail = box.end;
      for (var t = box.end + 1; t <= i; t++) {
        if (bars[t].close > rg.high + span * 0.25 || bars[t].close < rg.low - span * 0.25) break;
        tail = t;
      }
      return tail;
    }

    /* 바닥 박스 돌파: i 봉 종가가 (i-1 봉까지 알려진) 박스 상단·224일선·구름대 위로 올라선 첫 봉에서 한 번만 낸다. 매수 신호가 아니다.
       i 봉 이전에 확정·진행 중이던 박스만 보므로 prefix 분석과 전체 분석의 결과가 같다. */
    var baseDone = {};
    function checkBaseBreakout(i) {
      ['medium', 'major'].forEach(function (name) {
        var sc = scales[name], boxes = sc.boxes.concat(sc.openBox ? [sc.openBox] : []);
        boxes.forEach(function (b) {
          if (baseDone[b.start]) return;
          var boxEnd = b === sc.openBox ? openBoxEnd(b, i - 1) : b.end;
          if (i <= boxEnd) return;
          var info = baseAsOf(b, boxEnd);
          if (!info) return;
          var hi = rangeOf(bars, b.start, boxEnd);
          var c = bars[i].close;
          if (c < hi.low * 0.97) { baseDone[b.start] = 'broken'; return; }
          var cloudTop = ctx.cloud.top[i], ma = ctx.ma224[i];
          if (c > hi.high && ma != null && c > ma && cloudTop != null && c > cloudTop) {
            var volNow = ctx.vol20[i], volBox = 0, cnt = 0;
            for (var v = b.start; v <= boxEnd; v++) { volBox += bars[v].volume || 0; cnt++; }
            volBox = cnt ? volBox / cnt : 0;
            baseDone[b.start] = i;
            signals.push({ index: i, type: 'base_breakout', boxId: 'medium:box:' + b.start, boxStart: b.start,
              evidence: { boxBars: info.bars, higherLows: info.higherLows, volumeRatio: volBox > 0 && volNow ? +(volNow / volBox).toFixed(2) : null, above224: true, aboveCloud: true } });
          }
        });
      });
    }

    function emit(type, i, extra) {
      var s = { index: i, type: type };
      if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
      signals.push(s);
    }

    /* 봉 단위 상태·신호. 신호는 상태가 처음 성립한 봉에서 한 번만(같은 종류는 일정 봉 동안 다시 내지 않음) 나온다. 매수 신호가 아니다. */
    function stepState(i) {
      var reg = regimeAt(i);
      var prevReg = i > 0 && regimeSeries ? regimeSeries[i - 1] : null;
      if (regimeSeries) regimeSeries[i] = reg.regime;
      var c = bars[i].close;
      // 반등 후보 등록·감시(하락 구조 안의 단기 급등이 저항을 못 넘고 시작 저점을 이탈하면 '가짜 상승')
      pendingRally.forEach(function (leg) {
        if (reg.regime === 'down' || reg.regime === 'range' || reg.regime === 'expansion' || reg.regime === 'unknown') {
          rallies.push({ startPrice: leg.startPrice, highPrice: leg.endPrice, resistance: majorHighs.length ? majorHighs[majorHighs.length - 1].price : null, since: i, id: leg.id });
        }
      });
      pendingRally = [];
      var failedNow = [];
      rallies = rallies.filter(function (r) {
        if (i - r.since > opt.rallyExpireBars) return false;
        if (r.resistance != null && c > r.resistance) return false;
        if (c < r.startPrice) { failedNow.push(r); return false; }
        return true;
      });
      if (failedNow.length) emit('failed_rally', i, { rallyIds: failedNow.map(function (r) { return r.id; }), startPrice: Math.min.apply(null, failedNow.map(function (r) { return r.startPrice; })), highPrice: Math.max.apply(null, failedNow.map(function (r) { return r.highPrice; })) });
      // H1: 대파동 상승 + 중파동 눌림
      var pb = mediumPullback();
      var up = reg.regime === 'up';
      var lastMajorLow = majorLows.length ? majorLows[majorLows.length - 1].price : null;
      var h1 = !!(up && pb && pb.retrace >= opt.pullbackMinRetrace && pb.extPrice > pb.prevLow && (lastMajorLow == null || c >= lastMajorLow));
      // H2: H1 + 소파동 상승 전환(눌림 중 확정된 소파동 저점이 중파동 눌림 저점 위)
      var mn = scales.minor, mz = mn.zz, mP = mn.pivots, h2 = false;
      if (h1 && mz.dir === 1 && mP.length) {
        var ml = mP[mP.length - 1];
        h2 = ml.type === 'low' && ml.price >= pb.extPrice && ml.idx >= scales.medium.pivots[scales.medium.pivots.length - 1].idx;
      }
      // H3: 224일선 돌파 + 저점 상승 + 중파동 재상승
      if (i > 0 && ctx.ma224[i] != null && ctx.ma224[i - 1] != null && c > ctx.ma224[i] && bars[i - 1].close <= ctx.ma224[i - 1]) lastCross224 = i;
      var medLows = scales.medium.pivots.filter(function (p) { return p.type === 'low'; });
      var h3 = !!(ctx.ma224[i] != null && i - lastCross224 <= 10 && c > ctx.ma224[i] && rising(medLows) && scales.medium.zz.dir === 1);
      var flags = { H1: h1, H2: h2, H3: h3 };
      ['H1', 'H2', 'H3'].forEach(function (k) {
        if (flags[k] && !prevFlags[k] && i - lastSignalIdx[k] >= 20) {
          emit(k, i, { regime: reg.regime, retrace: pb ? +pb.retrace.toFixed(2) : null });
          lastSignalIdx[k] = i;
        }
        prevFlags[k] = flags[k];
      });
      return reg;
    }

    // 단일 순차 처리
    var lastReg = null;
    for (var i = 0; i < n; i++) {
      if (ctx.atr[i] == null) { if (regimeSeries) regimeSeries[i] = null; continue; }
      checkBaseBreakout(i);
      LEVELS.forEach(function (name) {
        var sc = scales[name];
        var piv = sc.zz.feed(i);
        if (piv) onPivot(sc, piv, i);
      });
      lastReg = stepState(i);
    }

    var res = assemble(bars, ctx, scales, revisions, signals, lastReg, { majorHighs: majorHighs, majorLows: majorLows });
    if (regimeSeries) res.regimeSeries = regimeSeries;
    return res;
  }

  /* ── 조립: 진행 중 파동·박스·상하위 연결·태그·바닥 판정 ───────────────────────────── */
  function assemble(bars, ctx, scales, revisions, signals, lastReg, pivotsByMajor) {
    var opt = ctx.opt, n = bars.length, last = n - 1;
    var levels = { major: [], medium: [], minor: [] };

    LEVELS.forEach(function (name) {
      var sc = scales[name], out = levels[name];
      sc.legs.forEach(function (l) { l.suppressed = !!l.boxId; out.push(l); });
      sc.boxes.forEach(function (b) { out.push(b); });
      // 진행 중 파동: 마지막 확정 극점 이후 지그재그가 지금 따라가는 방향
      var z = sc.zz, P = sc.pivots;
      if (z.dir !== 0 && P.length) {
        var lp = P[P.length - 1], endIdx = z.extIdx, up = z.dir === 1;
        if (endIdx > lp.idx) {
          out.push({
            id: name + ':' + lp.idx + ':open', level: name, kind: up ? 'up' : 'down', state: '진행 중', confirmed: false,
            start: lp.idx, end: endIdx, startPrice: lp.price, endPrice: z.extPrice,
            high: up ? z.extPrice : lp.price, low: up ? lp.price : z.extPrice,
            startConfirmedIndex: lp.confirmedIndex, confirmedIndex: null, endConfirmedIndex: null,
            parent: null, childIds: [], tags: [], label: null, boxId: null, suppressed: false
          });
        }
      }
      if (sc.openBox) {
        var ob = sc.openBox;
        var rg = rangeOf(bars, ob.start, ob.end), span = rg.high - rg.low, tail = ob.end;
        for (var t = ob.end + 1; t <= last; t++) {
          if (bars[t].close > rg.high + span * 0.25 || bars[t].close < rg.low - span * 0.25) break;
          tail = t;
        }
        var rt = rangeOf(bars, ob.start, tail);
        ob.end = tail; ob.high = rt.high; ob.low = rt.low;
        ob.kind = sideKind(rt, opt);
        out.push(ob);
      }
    });

    promoteLongBoxes(levels, bars, ctx, scales, revisions);
    attachParents(levels);
    tagWaves(levels, ctx);
    markBases(levels, bars, ctx, signals);
    var state = summarize(bars, ctx, scales, levels, signals, lastReg, pivotsByMajor);
    var flat = [];
    LEVELS.forEach(function (name) { levels[name].forEach(function (w) { flat.push(w); }); });
    signals.sort(function (a, b) { return a.index - b.index; });
    return { version: VERSION, params: opt, levels: levels, waves: flat, revisions: revisions, signals: signals, state: state, asOf: last, dataHash: hashBars(bars) };
  }

  /* 대파동 규모(8xATR)에서는 극점이 거의 안 생기는 긴 횡보·바닥을 놓친다. 중파동 박스가 60봉 이상 이어지면 대파동 박스로도 올린다
     (같은 박스를 한 단계 위 규모에서 보는 것이므로 새 정보를 만들지 않는다). 이미 겹치는 대파동 박스가 있으면 만들지 않는다.
     박스 안에 완전히 들어가는 대파동 확정 파동은 이 규모 화면에서 박스에 가려진다(suppressed). */
  function promoteLongBoxes(levels, bars, ctx, scales, revisions) {
    var minBars = ctx.opt.levels.major.box.minBars;
    levels.medium.filter(function (b) { return b.isBox && b.end - b.start + 1 >= minBars; }).forEach(function (b) {
      var overlaps = levels.major.some(function (m) { return m.isBox && m.start <= b.end && m.end >= b.start; });
      if (overlaps) return;
      var atrStart = ctx.atr[Math.min(b.end, b.start + 14)], atrEnd = ctx.atr[b.end];
      var promoted = {
        id: 'major:box:' + b.start, level: 'major', kind: b.kind, state: b.state, confirmed: b.confirmed, isBox: true,
        start: b.start, end: b.end, high: b.high, low: b.low,
        startConfirmedIndex: b.startConfirmedIndex, confirmedIndex: b.confirmedIndex, endConfirmedIndex: b.endConfirmedIndex,
        parent: null, childIds: [], tags: ['fromMedium'], label: null, promotedFrom: b.id,
        compression: !!(atrStart && atrEnd && atrEnd < atrStart * 0.75)
      };
      levels.major.push(promoted);
      // 승격 시점: 중파동 박스가 처음 60봉(대파동 박스 최소 길이)에 이른 봉. 그 전에는 대파동 박스를 알 수 없었다.
      var growth = (scales && scales.medium.growth[b.id]) || [], at = null;
      for (var g = 0; g < growth.length; g++) if (growth[g].end - b.start + 1 >= minBars) { at = growth[g].at; break; }
      if (at == null) at = b.confirmedIndex != null ? b.confirmedIndex : bars.length - 1;
      var absorbed = [];
      levels.major.forEach(function (w) {
        if (!w.isBox && w.confirmed && w.start >= promoted.start && w.end <= promoted.end && !w.boxId) { w.boxId = promoted.id; w.suppressed = true; absorbed.push(w); }
      });
      if (absorbed.length) {
        var when = at;
        absorbed.forEach(function (w) { if (w.confirmedIndex > when) when = w.confirmedIndex; });
        revisions.push({ at: when, level: 'major', type: 'absorbed', boxId: promoted.id, waveIds: absorbed.map(function (w) { return w.id; }),
          reason: '중파동 횡보 박스가 ' + minBars + '봉 이상 이어져 대파동 박스로도 올라가, 이 박스 안의 대파동 ' + absorbed.length + '개가 박스 안의 파동으로 표시됨(파동 자체는 확정 그대로)' });
      }
    });
    levels.major.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  }

  /* 상위 파동: 같은 일봉 위에서 시간 포함 관계로 잇는다. 종점이 들어 있는 상위 파동(박스 우선)을 부모로 본다.
     부모는 관계 정보일 뿐이며, 상위 극점이 나중에 확정되면 바뀔 수 있다(파동의 모양·확정 정보는 바뀌지 않는다). */
  function attachParents(levels) {
    var order = ['minor', 'medium', 'major'];
    for (var o = 0; o < 2; o++) {
      var kids = levels[order[o]], parents = levels[order[o + 1]];
      kids.forEach(function (k) {
        var best = null, bestOverlap = -1;
        parents.forEach(function (p) {
          var a = Math.max(k.start, p.start), b = Math.min(k.end, p.end);
          var ov = b - a;
          if (ov < 0) return;
          var prefer = ov + (p.isBox ? 0.5 : 0);
          if (prefer > bestOverlap) { bestOverlap = prefer; best = p; }
        });
        if (best) { k.parent = best.id; best.childIds.push(k.id); }
      });
    }
  }


  /* Observational pullback label: use only data known at the wave's confirmation.
     Missing volume remains unknown; candidate is never a completed reversal claim. */
  function pullbackOf(bars, wave, prior, options, knownAtr) {
    var opt = options || DEFAULTS;
    if (!wave || !prior || wave.isBox || prior.isBox || wave.kind !== 'down' || prior.kind !== 'up' ||
        prior.end !== wave.start || prior.struct === 'LH' || wave.struct === 'LL') return null;
    var start=wave.start,end=wave.end,known=wave.confirmed ? wave.confirmedIndex : bars.length-1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(known) ||
        start<0 || end-start<3 || known<end || known>=bars.length || prior.start<0) return null;
    var base=prior.startPrice,peak=prior.endPrice,low=wave.endPrice,rise=peak-base;
    var atr=knownAtr ? knownAtr[start] : atrSeries(bars.slice(0,start+1),opt.atrPeriod || 14)[start];
    if (!(base>0) || !(rise>=Math.max(base*0.05,3*(atr || 0))) || !(low>base)) return null;
    var retrace=(peak-low)/rise;
    if (retrace<(opt.pullbackMinRetrace || 0.25) || retrace>0.75) return null;
    for(var i=prior.start;i<=known;i++) {
      var b=bars[i];
      if(!b || ![b.open,b.high,b.low,b.close].every(Number.isFinite) || b.high<b.low)return null;
      if(i>=start && b.close<=base)return null;
    }
    function averageVolume(a,z) {
      var sum=0,count=0,total=z-a+1;
      for(var j=a;j<=z;j++)if(Number.isFinite(bars[j].volume) && bars[j].volume>0){sum+=bars[j].volume;count++;}
      return count>=Math.max(3,Math.ceil(total*0.8)) ? sum/count : null;
    }
    var upVolume=averageVolume(prior.start+1,prior.end),downVolume=averageVolume(start+1,end);
    var volumeRatio=upVolume && downVolume ? downVolume/upVolume : null;
    if(volumeRatio!=null && volumeRatio>1.3)return null;
    var confirmed=!!wave.confirmed && volumeRatio!=null && volumeRatio<1;
    return {status:confirmed?'confirmed':'candidate',label:confirmed?'눌림목':'눌림목 후보',
      retrace:+retrace.toFixed(3),volumeRatio:volumeRatio==null?null:+volumeRatio.toFixed(3),
      support:base,knownIndex:known,reason:confirmed?'상승 후 조정·저점 유지·거래량 감소·반등 확인':
        (!wave.confirmed?'조정 진행·반등 미확인':(volumeRatio==null?'거래량 자료 부족':'거래량 감소 미확인'))};
  }

  function tagWaves(levels, ctx) {
    LEVELS.forEach(function (name) {
      levels[name].forEach(function (w) {
        if (w.isBox) { w.label = w.kind === 'wide' ? '변동성 큰 박스권' : (w.compression ? '횡보·변동성 압축' : '횡보'); return; }
        if (w.struct) w.tags.push(w.struct);
      });
    });
    LEVELS.forEach(function(name) {
      var prior=null;
      levels[name].filter(function(w){return !w.isBox;}).forEach(function(w) {
        w.pullback=pullbackOf(ctx.bars,w,prior,ctx.opt,ctx.atr);
        prior=w;
      });
    });
    // 중파동 서술 라벨: 직전 흐름 안에서의 위치(눌림·재상승 등). 그 파동이 확정된 시점까지의 정보만 쓴다.
    var run = { ups: 0, pull: 0 };
    levels.medium.filter(function (w) { return !w.isBox && w.confirmed; }).forEach(function (w) {
      if (w.kind === 'up') {
        if (w.struct === 'HH') { run.ups++; w.label = run.ups <= 1 ? '1차 상승' : (run.pull ? '재상승·고점 갱신' : '상승 지속'); }
        else w.label = w.struct === 'LH' ? '반등(고점 낮아짐)' : '상승';
      } else {
        if (w.struct === 'HL') { run.pull++; w.label = run.pull === 1 ? '첫 눌림' : '눌림'; }
        else if (w.struct === 'LL') { w.label = '저점 이탈'; run.ups = 0; run.pull = 0; }
        else w.label = '하락';
      }
    });
    levels.medium.filter(function (w) { return !w.isBox && !w.confirmed; }).forEach(function (w) { w.label = w.kind === 'up' ? '상승' : '하락'; });
    levels.minor.filter(function (w) { return !w.isBox; }).forEach(function (w) {
      if (w.kind === 'up') w.label = w.struct === 'HH' ? '전고 돌파' : '반등';
      else w.label = w.struct === 'HL' ? '저점 상승' : (w.struct === 'LL' ? '저점 이탈' : '눌림');
    });
    levels.major.filter(function (w) { return !w.isBox; }).forEach(function (w) {
      w.label = w.kind === 'up' ? (w.struct === 'HH' ? '대 상승(고점 상승)' : '대 상승') : (w.struct === 'LL' ? '대 하락(저점 하락)' : '대 하락');
    });
  }

  /* 바닥 횡보(단테식 밥그릇 구조에서 참고할 만한 모양): 이전 하락 → 80봉 이상 박스 → 박스 안 저점 상승.
     횡보를 곧바로 세력 매집으로 단정하지 않는다 - 모양과 거래량 변화를 사실대로 적을 뿐이다.
     돌파 신호(base_breakout)는 종가가 박스 상단·224일선·구름대 위로 올라선 첫 봉에서만 난다. */
  function markBases(levels, bars, ctx, signals) {
    var opt = ctx.opt, brk = {};
    signals.forEach(function (sg) { if (sg.type === 'base_breakout') brk[sg.boxStart] = sg.index; });
    ['major', 'medium'].forEach(function (name) {
      levels[name].forEach(function (b) {
        if (!b.isBox || b.end - b.start + 1 < opt.baseMinBars) return;
        var from = Math.max(0, b.start - 120), prior = -Infinity;
        for (var k = from; k < b.start; k++) if (bars[k].close > prior) prior = bars[k].close;
        if (!(prior > 0) || bars[b.start].close > prior * (1 - opt.baseDeclinePct)) return;
        var lows = levels.medium.filter(function (w) { return !w.isBox && w.kind === 'down' && w.end >= b.start && w.end <= b.end && w.confirmed; });
        var steps = 0;
        for (var q = 1; q < lows.length; q++) if (lows[q].endPrice > lows[q - 1].endPrice) steps++;
        if (steps < opt.baseMinHigherLows) return;
        b.tags.push('base'); b.label = '바닥 횡보(저점 상승)';
        b.base = { higherLows: steps, declinePct: +(1 - bars[b.start].close / prior).toFixed(3), bars: b.end - b.start + 1 };
        if (brk[b.start] != null) b.base.breakoutIndex = brk[b.start];
      });
    });
  }

  function summarize(bars, ctx, scales, levels, signals, lastReg, pivotsByMajor) {
    var last = bars.length - 1, c = bars[last].close, opt = ctx.opt;
    var reg = lastReg ? lastReg.regime : 'unknown';
    var hs = pivotsByMajor.majorHighs, ls = pivotsByMajor.majorLows;
    var med = levels.medium.filter(function (w) { return !w.isBox; });
    var lastMed = med.length ? med[med.length - 1] : null;
    var lastMedConfirmed = null;
    for (var i = med.length - 1; i >= 0; i--) if (med[i].confirmed) { lastMedConfirmed = med[i]; break; }
    var mn = levels.minor.filter(function (w) { return !w.isBox; });
    var lastMinor = mn.length ? mn[mn.length - 1] : null;
    var recent = function (type, within) { return signals.some(function (s) { return s.type === type && last - s.index <= within; }); };
    var up = reg === 'up';
    var medDownNow = !!(lastMed && lastMed.kind === 'down');
    var minorUp = !!(lastMinor && lastMinor.kind === 'up');
    var openBoxes = levels.medium.concat(levels.major).filter(function (w) { return w.isBox && !w.confirmed; });
    var scenario = {
      A: up && medDownNow && !minorUp,                                         // 대 상승 → 중 조정 → 소 하락: 추세 종료로 보지 않는다
      B: up && !!(lastMedConfirmed && lastMedConfirmed.kind === 'down' && lastMedConfirmed.struct === 'HL' && minorUp), // 눌림 저점 지지 → 소 상승 전환(관찰 대상, 신호 아님)
      C: recent('base_breakout', 20),
      D: recent('failed_rally', 20),
      E: openBoxes.some(function (b) { return b.childIds.length >= 3; })
    };
    var evidence = {
      above224: ctx.ma224[last] != null ? c > ctx.ma224[last] : null,
      ma224Rising: ctx.ma224[last] != null && ctx.ma224[last - 20] != null ? ctx.ma224[last] > ctx.ma224[last - 20] : null,
      above60: ctx.ma60[last] != null ? c > ctx.ma60[last] : null,
      aboveCloud: ctx.cloud.top[last] != null ? c > ctx.cloud.top[last] : null
    };
    var regimeText = { up: '대 상승', up_broken: '대 상승 훼손', down: '대 하락', down_recovering: '대 하락 후 회복 시도', compression: '대 횡보·변동성 압축', expansion: '대 변동성 확대', range: '대 횡보', unknown: '대 구조 미확정' }[reg] || reg;
    var medText = lastMed ? (lastMed.confirmed ? '중 ' + (lastMed.label || (lastMed.kind === 'up' ? '상승' : '하락')) : '중 ' + (lastMed.kind === 'up' ? '상승 진행' : '조정 진행')) : '';
    var minText = lastMinor ? '소 ' + (lastMinor.kind === 'up' ? '상승' : '하락') + (lastMinor.confirmed ? '' : ' 진행') : '';
    return {
      regime: reg, regimeSource: lastReg ? lastReg.source : 'major', regimeProvisional: !!(lastReg && lastReg.provisional), evidence: evidence, scenario: scenario,
      lastMajorHigh: hs.length ? hs[hs.length - 1].price : null, lastMajorLow: ls.length ? ls[ls.length - 1].price : null,
      summaryText: [regimeText, medText, minText].filter(Boolean).join(' · ')
    };
  }

  /* ── 하위 호환: 예전 detectWaves(bars, options) 모양(중파동 + 박스 + 진행 중) ─────── */
  function detectWaves(bars, options) {
    var res = analyze(bars, options);
    return res.levels.medium.filter(function (w) { return !w.suppressed; }).map(function (w) {
      var copy = {};
      Object.keys(w).forEach(function (k) { copy[k] = w[k]; });
      return copy;
    });
  }


  // Shared visual structure for chart rails and scanner close-series summaries.
  // Bounded median-slope fit is scale invariant and resists a single price spike.
  function shapeOf(rows) {
    var unknown={type:'unknown',label:'모양 자료 부족',score:0,slope:null,coherence:0,efficiency:0,basis:'종가 흐름'};
    if(!Array.isArray(rows) || rows.length<8)return unknown;
    var values=rows.map(function(r){return typeof r==='number'?r:r && r.close;});
    if(values.some(function(v){return !Number.isFinite(v)||v<=0;}))return unknown;
    if(rows.some(function(r,i){return i && r && r.date && rows[i-1] && rows[i-1].date && String(r.date)<=String(rows[i-1].date);}))return unknown;
    function median(a){a=a.slice().sort(function(x,y){return x-y;});var k=Math.floor(a.length/2);return a.length%2?a[k]:(a[k-1]+a[k])/2;}
    function clip(v){return Math.max(0,Math.min(1,v));}
    var n=values.length,changes=[],path=0;
    for(var i=1;i<n;i++){var d=Math.abs(values[i]-values[i-1]);changes.push(d);path+=d;}
    var range=Math.max.apply(null,values)-Math.min.apply(null,values),noise=median(changes);
    if(!range)return {type:'range',label:'횡보·가격 안정',score:40,slope:0,coherence:1,efficiency:0,contraction:0,basis:'종가 흐름'};
    var indexes=[],step=Math.max(1,Math.ceil((n-1)/24));
    for(var j=0;j<n;j+=step)indexes.push(j);
    if(indexes[indexes.length-1]!==n-1)indexes.push(n-1);
    var slopes=[];
    indexes.forEach(function(a){indexes.forEach(function(b){if(b-a>=Math.max(2,n/4))slopes.push((values[b]-values[a])/(b-a));});});
    var slope=median(slopes),intercept=median(values.map(function(v,k){return v-slope*k;}));
    var error=median(values.map(function(v,k){return Math.abs(v-(slope*k+intercept));}));
    var coherence=clip(1-error/range*3),eff=path?Math.abs(values[n-1]-values[0])/path:0;
    var blocks=[],size=Math.floor(n/4);
    for(var q=0;q<4;q++){var chunk=values.slice(q*size,q===3?n:(q+1)*size);blocks.push({low:Math.min.apply(null,chunk),high:Math.max.apply(null,chunk)});}
    var higher=0,lower=0;
    for(var z=1;z<4;z++){if(blocks[z].low>blocks[z-1].low+noise*.25)higher++;if(blocks[z].high<blocks[z-1].high-noise*.25)lower++;}
    var third=Math.max(2,Math.floor(changes.length/3)),early=median(changes.slice(0,third)),late=median(changes.slice(-third));
    var contraction=early>0?late/early:null;
    var peak=values.indexOf(Math.max.apply(null,values)),before=values.slice(0,peak+1);
    var base=Math.min.apply(null,before),rise=values[peak]-base;
    var after=values.slice(peak+1),afterLow=after.length?Math.min.apply(null,after):values[peak];
    var dip=values[peak]-afterLow,tail=values[n-1],recovery=tail-afterLow;
    var riseSteps=0,biggestRise=0;
    for(var u=1;u<=peak;u++){if(values[u]>values[u-1])riseSteps++;biggestRise=Math.max(biggestRise,values[u]-values[u-1]);}
    var realRise=peak>=2 && riseSteps>=Math.max(2,Math.floor(peak*.35)) &&
      biggestRise<rise*.75 && rise>Math.max(noise*3,range*.25);
    var pull=realRise && after.length>=2 && afterLow>base &&
      dip>Math.max(noise,range*.08) && dip<rise && peak<n-2;
    var type='range',label='횡보·방향 탐색',score=40+15*coherence, pullbackIndexes;
    if(pull){
      type=recovery>Math.max(noise, dip*.3)?'rebound':'pullback';
      label=type==='rebound'?'상승 뒤 조정·반등 시도':'상승 뒤 눌림 형성';
      score=65+15*(1-dip/rise)+10*(contraction!=null?clip(1-contraction/2):.25);
      var lowIndex=peak+1+after.indexOf(afterLow);
      pullbackIndexes=[before.indexOf(base),peak,lowIndex];
      if(type==='rebound' && lowIndex<n-1)pullbackIndexes.push(n-1);
    }else if(slope>0 && higher>=2 && eff>.2){type='up';label='저점이 높아지는 상승 흐름';score=65+20*coherence+10*eff;}
    else if(slope<0 && lower>=2 && eff>.2){type='down';label='고점이 낮아지는 하락 흐름';score=20+10*coherence;}
    else if(contraction!=null && contraction<.8){type='compression';label='변동폭 축소·방향 대기';score=55+20*clip(1-contraction);}
    return {type:type,label:label,score:Math.round(score),slope:slope,coherence:coherence,efficiency:eff,
      higherLows:higher,lowerHighs:lower,contraction:contraction,basis:'종가 흐름',pullbackIndexes:pullbackIndexes};
  }


  // Relative strength against every given index ("my way": stronger than the
  // market whichever index it belongs to). Each benchmark is [{date, close}] on
  // the same trading calendar; the weakest comparison is the summary value.
  // Missing or stale index data is reported as such, never treated as a pass.
  function relativeStrengthOf(bars, benchmarks) {
    var names=Object.keys(benchmarks || {}), vs={};
    if(!Array.isArray(bars) || bars.length<21 || !names.length)return {status:'missing',vs:vs};
    var last=bars[bars.length-1].date;
    for(var k=0;k<names.length;k++) {
      var map={};
      (benchmarks[names[k]] || []).forEach(function(row){ if(row && Number(row.close)>0)map[row.date]=Number(row.close); });
      if(!map[last])return {status:'missing',vs:vs,missing:names[k]};
      var rows=bars.filter(function(b){return map[b.date] && b.close>0;}).slice(-61);
      if(rows.length<21)return {status:'missing',vs:vs,missing:names[k]};
      var line=rows.map(function(b){return b.close/map[b.date];});
      var ret=function(n){ var a=rows[rows.length-1-n]; return a ? ((rows[rows.length-1].close/a.close)-(map[last]/map[a.date]))*100 : null; };
      var recent=line.slice(-20), hi=Math.max.apply(null,recent), lo=Math.min.apply(null,recent);
      var down=0, held=0;
      for(var i=rows.length-20;i<rows.length;i++) {
        var p=rows[i-1], b=rows[i], m=map[b.date]/map[p.date]-1;
        if(m<0){ down++; if(b.close/p.close-1>m)held++; }
      }
      vs[names[k]]={rs20:ret(20),rs60:rows.length>60?ret(60):null,rsPosition20:hi>lo?(line[line.length-1]-lo)/(hi-lo):1,
        downDays:down,downDayHold:down>=4?held/down:null,
        todayExcess:((rows[rows.length-1].close/rows[rows.length-2].close)-(map[last]/map[rows[rows.length-2].date]))*100};
    }
    function weakest(field){
      var values=names.map(function(n){return vs[n][field];});
      return values.some(function(v){return v==null;}) ? null : Math.min.apply(null,values);
    }
    var own=function(n){ var a=bars[bars.length-1-n]; return a && a.close>0 ? (bars[bars.length-1].close/a.close-1)*100 : null; };
    return {status:'ok',basis:names.join('+'),vs:vs,own20:own(20),own60:bars.length>60?own(60):null,rs20:weakest('rs20'),rs60:weakest('rs60'),
      rsPosition20:weakest('rsPosition20'),downDayHold:weakest('downDayHold'),todayExcess:weakest('todayExcess')};
  }

  // High-basis research signals (2026-11-08 backtest, later 1~15-day highs vs same-day,
  // same-ATR peers). Observation tags only: no order meaning. Uses closed daily bars.
  //  surgeNextDay   : today closed +20% or more -> next session open is the observed entry.
  //  gapVolumeClose : gap above the prior high (+2%+), prior-day uptrend, volume >= 5x the
  //                   prior day and a strong +10~29% close (limit-up closes are not fillable).
  //  rsHigh60/resmom20: ratio line vs every index at a 60-day high; residual momentum after
  //                   removing the home index (120-day beta). The cross-sectional top-40%
  //                   cut for resmom20 is applied by the caller over the whole universe.
  function edgeSignalsOf(bars, benchmarks) {
    var out={version:'edge-v1',surgeNextDay:false,gapVolumeClose:false,rsHigh60:null,resmom20:null};
    if(!Array.isArray(bars) || bars.length<62)return out;
    var n=bars.length,last=bars[n-1],prev=bars[n-2];
    if(!(prev.close>0 && prev.volume>0 && last.close>0))return out;
    var dayRet=last.close/prev.close-1;
    out.dayReturn=dayRet;
    out.surgeNextDay=dayRet>=.2;
    var closes=bars.map(function(b){return b.close;});
    function ma(end,len){if(end-len+1<0)return null;var s=0;for(var i=end-len+1;i<=end;i++)s+=closes[i];return s/len;}
    var p=n-2,m20=ma(p,20),m60=ma(p,60),m20b=ma(p-5,20),m60b=ma(p-20,60);
    var uptrend=m20!=null && m60!=null && m20b!=null && m60b!=null && prev.close>m20 && m20>m60 && m20>m20b && m60>m60b;
    out.gapVolumeClose=!!(uptrend && last.open>=prev.close*1.02 && last.open>prev.high && last.volume>=prev.volume*5 && dayRet>=.1 && dayRet<.29);
    var names=Object.keys(benchmarks || {});
    if(!names.length)return out;
    var highs=[],fits=[];
    for(var k=0;k<names.length;k++) {
      var map={};
      (benchmarks[names[k]] || []).forEach(function(row){ if(row && Number(row.close)>0)map[row.date]=Number(row.close); });
      if(!map[last.date])return out;
      var rows=bars.filter(function(b){return map[b.date] && b.close>0;});
      if(rows.length<62)return out;
      var line=rows.map(function(b){return b.close/map[b.date];}),L=line.length;
      highs.push(line[L-1]>=Math.max.apply(null,line.slice(L-61,L-1)));
      if(rows.length>=141) {
        var rs=[],ri=[];
        for(var i=rows.length-140;i<rows.length;i++){rs.push(rows[i].close/rows[i-1].close-1);ri.push(map[rows[i].date]/map[rows[i-1].date]-1);}
        var est=function(a,b){var ma_=0,mb=0,j;for(j=0;j<a.length;j++){ma_+=a[j];mb+=b[j];}ma_/=a.length;mb/=b.length;
          var cv=0,va=0,vb=0;for(j=0;j<a.length;j++){cv+=(a[j]-ma_)*(b[j]-mb);va+=(a[j]-ma_)*(a[j]-ma_);vb+=(b[j]-mb)*(b[j]-mb);}
          return {beta:vb>0?cv/vb:null,corr:va>0&&vb>0?cv/Math.sqrt(va*vb):null};};
        var f=est(rs.slice(-120),ri.slice(-120));
        if(f.beta!=null && f.corr!=null) {
          var res=rs.map(function(r,j){return r-f.beta*ri[j];}).slice(-60);
          var mean=res.reduce(function(s,x){return s+x;},0)/60,sd=Math.sqrt(res.reduce(function(s,x){return s+(x-mean)*(x-mean);},0)/59);
          var sum20=res.slice(-20).reduce(function(s,x){return s+x;},0);
          if(sd>0)fits.push({corr:f.corr,value:sum20/(sd*Math.sqrt(20))});
        }
      }
    }
    out.rsHigh60=highs.every(Boolean);
    if(fits.length===names.length)out.resmom20=fits.sort(function(a,b){return b.corr-a.corr;})[0].value;
    return out;
  }

  // Menu-specific reading of the same relative-strength shape. "My way" means
  // stronger than both indices AND its own price still rising, so a stock that
  // merely fell less than a crashing market is not counted. Short trades need the
  // ratio line at/near its recent high; a trend pullback may rest inside its range
  // but must stay ahead and rising over the longer window; a base must hold up
  // while the market falls. Long-term quality keeps its own financial gate.
  function myWayOf(rs, group) {
    if(group==='longTermQuality')return {pass:true,applied:false};
    if(!rs || rs.status!=='ok')return {pass:null,applied:false};
    var hold=rs.downDayHold==null || rs.downDayHold>=.5, rising=rs.own20>0;
    var lead=rs.rs60!=null ? rs.rs60>0 && rs.own60>0 : rs.rs20>0 && rising;
    var pass=group==='pullbackRebreak' ? lead && rs.rsPosition20>=.5
      : group==='bottomFormation' ? rs.rs20>0 && rising && hold
      : rs.rs20>0 && rising && rs.rsPosition20>=.8 && hold;
    var reasons=['20일 '+(rs.own20>=0?'+':'')+rs.own20.toFixed(1)+'% · 두 지수 대비 '+(rs.rs20>=0?'+':'')+rs.rs20.toFixed(1)+'%p'];
    if(rs.downDayHold!=null)reasons.push('지수 하락일 '+Math.round(rs.downDayHold*100)+'% 버팀');
    return {pass:!!pass,applied:true,reasons:reasons};
  }

  // Shared chart-first structural selection. Never uses future bars or research tags.
  function setupMedian(a){a=a.slice().sort(function(x,y){return x-y;});return a.length?a[Math.floor(a.length/2)]:0;}
  const med=setupMedian,max=a=>Math.max.apply(null,a),min=a=>Math.min.apply(null,a);
function setupShapesOf(bars){
 const n=bars.length,last=bars[n-1],prev=bars[n-2],out={liveFlow:[],trendBreakout:[],bottomFormation:[],pullbackRebreak:[]};
 if(n<100)return out;
 const prior=bars.slice(-15,-1),atr=med(prior.map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[n-16+i].close),Math.abs(b.low-bars[n-16+i].close))));
 if(!(atr>0))return out;
 const waves=analyze(bars),medium=waves.levels.medium.filter(w=>!w.isBox&&!w.suppressed),minor=waves.levels.minor.filter(w=>!w.isBox&&!w.suppressed);
 const closed=medium.filter(w=>w.confirmed),highs=closed.filter(w=>w.kind==='up').map(w=>({i:w.end,p:w.endPrice})),lows=closed.filter(w=>w.kind==='down').map(w=>({i:w.end,p:w.endPrice}));
 const context=shapeOf(bars.slice(-80));
 const emit=(key,stage,score,support,resistance,origin,why)=>{
  if(!Number.isFinite(support)||!Number.isFinite(resistance)||resistance<=support)return;
  const extension=(last.close-resistance)/atr;
  const labels={liveFlow:'지지·응축 뒤 가격 회복',trendBreakout:'반복 고점 저항의 첫 회복',bottomFormation:'반복 저점 지지와 가까운 고점 회복',pullbackRebreak:'선행 상승 뒤 조정·지지·재상승'};
  const stages={prepare:'준비 구간',trigger:'첫 구조 변화',extended:'추격·확장 구간'};
  const start=origin.riseStart!=null?origin.riseStart:origin.a?origin.a.i:origin.from;
  const pivot=origin.riseEnd!=null?origin.riseEnd:origin.b?origin.b.i:origin.to;
  const rise=bars.slice(Math.max(0,start),Math.max(start+1,pivot+1)),correction=bars.slice(Math.max(0,pivot+1),-1);
  const risingVolume=med(rise.map(x=>x.volume)),correctionVolume=med(correction.map(x=>x.volume));
  const beforeVolume=med(bars.slice(-6,-1).map(x=>x.volume));
  const volumeContext={correctionToRise:risingVolume>0&&correctionVolume>0?correctionVolume/risingVolume:null,
    recoveryToCorrection:beforeVolume>0?last.volume/beforeVolume:null};
  const volumeCopy=volumeContext.correctionToRise==null?'조정 거래량 비교 미확인':
    '조정/선행 구간 거래량 '+Math.round(volumeContext.correctionToRise*100)+'%';
  const recoveryCopy=volumeContext.recoveryToCorrection==null?'전환 거래량 미확인':
    '최근 조정 대비 당일 거래량 '+volumeContext.recoveryToCorrection.toFixed(2)+'배';
  const prepared=labels[key]+' · 지지 '+support.toFixed(0)+' / 저항 '+resistance.toFixed(0);
  const changed=stages[stage]+' · 저항 대비 '+((last.close/resistance-1)*100).toFixed(2)+'%';
  const pending=stage==='prepare'?'저항 회복 미확인':stage==='extended'?'이격 축소·새 지지 미확인':'회복한 저항의 지지 전환 미확인';
  const shape=Object.assign({},context,{score:Math.round(score),label:labels[key]});
  const line=(price)=>[{date:bars[Math.max(0,start)].date,price},{date:last.date,price}];
  const resistancePoints=key==='trendBreakout'&&origin.a&&origin.b?
    [{date:bars[origin.a.i].date,price:origin.a.p},{date:bars[origin.b.i].date,price:origin.b.p},{date:last.date,price:resistance}]:line(resistance);
  out[key].push({stage,status:stage==='prepare'?'SHAPE_PREPARE':stage==='trigger'?'SHAPE_TRANSITION':'SHAPE_EXTENDED',
    shapeLabel:labels[key]+' · '+stages[stage],shape,score:Math.round(score),support,resistance,origin,atr,extension,
    context:context.type,why,volumeContext,setup:{prepared,changed,pending},
    position:{resistancePct:(last.close/resistance-1)*100,supportRiskPct:(support/last.close-1)*100,extensionATR:extension},
    patternLines:[{tone:'shape',points:line(support)},{tone:'resistance',points:resistancePoints}],
    selectionVersion:'shape-selection-v1',strategyVersion:'chart-first-v2',windowBars:n,signal:{date:last.date,price:last.close},
    reasons:[prepared,changed,volumeCopy,recoveryCopy,pending],interpretation:prepared+' · '+changed+' · '+pending,
    observationOnly:true,orderAuthorized:false});
 };
 // Repeated descending/flat swing highs, an intervening dip and a first nearby recovery.
 if(highs.length>=2){
  const [a,b]=highs.slice(-2),span=b.i-a.i;
  if(span>=4&&n-1-a.i<=80&&n-1-b.i>=2&&b.p<=a.p+atr*.3){
   const slope=(b.p-a.p)/span,line=i=>a.p+slope*(i-a.i),r=line(n-1);
   const support=min(bars.slice(a.i+1,b.i).map(x=>x.low));
   const tested=bars.slice(Math.max(b.i,n-6),n-1).every((x,j)=>x.close<=line(Math.max(b.i,n-6)+j)+atr*.2);
   const alreadyRecovered=bars.slice(b.i+1,n-1).some((x,j)=>x.close>line(b.i+1+j)+atr*.15);
   if(r>support+atr&&tested&&!alreadyRecovered){
    const trigger=prev.close<=line(n-2)+atr*.15&&last.close>r+atr*.1&&last.close>prev.close&&last.close>last.open;
    const extended=last.close>r+atr*.8||last.close-last.open>atr*1.5;
    if(trigger)emit('trendBreakout',extended?'extended':'trigger',80+Math.min(10,span/3),support,r,{a,b},'confirmed swing-high resistance; dip; first recovery');
    else if(last.close<=r+atr*.1&&last.close>=r-atr*.8&&last.close>support+atr*.5)
     emit('trendBreakout','prepare',70+Math.min(10,span/3),support,r,{a,b},'resistance contacts with price still near/below line');
   }
  }
 }
 // A genuine rising leg followed by an orderly correction, not an old annual peak plus a collapse.
 for(let i=medium.length-2;i>=1;i--){
  const u=medium[i-1],d=medium[i];
  if(u.kind!=='up'||!u.confirmed||d.kind!=='down'||d.start!==u.end)continue;
  if(n-1-u.end>60||u.end-u.start<3||d.end-d.start<3)continue;
  const rise=u.endPrice-u.startPrice,post=bars.slice(u.end+1),low=min(post.map(x=>x.low)),li=u.end+1+post.findIndex(x=>x.low===low),retrace=(u.endPrice-low)/rise;
  if(!(rise>atr*2&&low>u.startPrice+atr*.25&&retrace>0&&retrace<.75&&li<=n-3))continue;
  const riseRanges=bars.slice(u.start,u.end+1).map(x=>x.high-x.low),corrRanges=bars.slice(u.end+1,li+1).map(x=>x.high-x.low);
  if(med(corrRanges)>med(riseRanges)*1.5)continue;
  const minorHigh=minor.filter(w=>w.confirmed&&w.kind==='up'&&w.end>li&&w.end<n-1).slice(-1)[0];
  const recoveryBars=bars.slice(Math.max(li+1,n-5),n-1);
  if(!recoveryBars.length)continue;
  const r=minorHigh?minorHigh.endPrice:max(recoveryBars.map(x=>x.high));
  const alreadyRecovered=bars.slice(li+1,n-1).some(x=>x.close>r+atr*.15);
  if(alreadyRecovered)continue;
  const trigger=prev.close<=r+atr*.15&&last.close>r+atr*.1&&last.close>prev.close&&last.close>last.open;
  const extended=last.close-r>atr*.8||last.close-low>atr*2||last.close-last.open>atr*1.5;
  const origin={riseStart:u.start,riseEnd:u.end,correctionLow:li};
  if(trigger)emit('pullbackRebreak',extended?'extended':'trigger',85-retrace*10,low,r,origin,'rising leg -> supported orderly correction -> first local-high recovery');
  else if(!extended&&last.close>=low+atr*.3&&last.close<=r+atr*.1)
   emit('pullbackRebreak','prepare',75-retrace*10,low,r,origin,'supported corrective leg with price still near the correction base');
  break;
 }
 // A decline, distinct stable lows and intervening recovery. Continuing broad declines require
 // a higher second low AND neckline recovery, not just a bounce from the lowest low.
 if(lows.length>=2){
  const [a,b]=lows.slice(-2),span=b.i-a.i;
  if(span>=6&&n-1-a.i<=100&&n-1-b.i>=2&&b.p>=a.p-atr*.3){
   const between=bars.slice(a.i+1,b.i),r=between.length?max(between.map(x=>x.high)):0;
   const before=bars.slice(Math.max(0,a.i-60),a.i),oldHigh=before.length?max(before.map(x=>x.high)):0;
   const support=Math.min(a.p,b.p),broadDown=context.slope<0&&context.lowerHighs>=2;
   const alreadyRecovered=bars.slice(b.i+1,n-1).some(x=>x.close>r+atr*.15);
   if(r>support+atr*1.2&&oldHigh>r+atr&&r-support<atr*12&&!alreadyRecovered){
    const trigger=prev.close<=r+atr*.15&&last.close>r+atr*.1&&last.close>prev.close&&last.close>last.open;
    const extended=last.close-r>atr*.8||last.close-last.open>atr*1.5;
    const higherLow=b.p>a.p+atr*.1;
    if(trigger&&(!broadDown||higherLow))emit('bottomFormation',extended?'extended':'trigger',80+Math.min(span/5,10),support,r,{a,b},'decline -> repeated lows -> neckline recovery');
    else if(!broadDown&&last.close>=r-atr*.8&&last.close<=r+atr*.1&&higherLow)
     emit('bottomFormation','prepare',70+Math.min(span/5,10),support,r,{a,b},'supported higher low, near an unreclaimed neckline');
   }
  }
 }
 // Short-horizon compression/support, followed by a nearby first range recovery.
 const box=bars.slice(-6,-1),older=bars.slice(-21,-6),lo=min(box.map(x=>x.low)),hi=max(box.map(x=>x.high));
 const olderLow=min(older.map(x=>x.low)),small=med(box.map(x=>x.high-x.low))<=med(older.map(x=>x.high-x.low));
 const recentSupport=minor.filter(w=>w.confirmed&&w.kind==='down'&&w.end>=n-20&&w.end<n-2).slice(-1)[0];
 if(!(context.slope<0&&context.lowerHighs>=2)&&recentSupport&&lo>=olderLow-atr*.2&&hi-lo>=atr*.5&&hi-lo<=atr*2.5&&small){
  const trigger=prev.close<=hi&&last.close>hi+atr*.1&&last.close>prev.close&&last.close>last.open,extended=last.close-hi>atr*.8||last.close-lo>atr*2||last.close-last.open>atr*1.5;
  if(trigger)emit('liveFlow',extended?'extended':'trigger',80,lo,hi,{from:n-6,to:n-2},'small-range support -> first range recovery');
  else if(!extended&&last.close<=hi+atr*.1&&last.close>=hi-atr*.5)
   emit('liveFlow','prepare',70,lo,hi,{from:n-6,to:n-2},'small-range support with price near upper boundary');
 }
 for(const k of Object.keys(out))out[k].sort((a,b)=>b.score-a.score);
 return out;
}

  // Compare the actual correction/support interval, rather than requiring a recent price rise.
  function relativeContextOf(bars, benchmarks, detail) {
    const origin=detail.origin || {},start=origin.riseEnd!=null?origin.riseEnd:origin.b?origin.b.i:origin.from;
    if(!Number.isInteger(start)||start<0||start>=bars.length-1)return {status:'missing',label:'조정 구간 상대강도 미확인'};
    const segment=bars.slice(start),vs={};
    for(const name of ['KOSPI','KOSDAQ']){
      const map={};(benchmarks && benchmarks[name] || []).forEach(b=>{if(b.close>0)map[b.date]=b.close;});
      if(segment.some(b=>!map[b.date]))return {status:'missing',label:'조정 구간 지수 자료 미확인'};
      const first=segment[0],last=segment[segment.length-1];let down=0,held=0;
      for(let i=1;i<segment.length;i++){
        const a=segment[i-1],b=segment[i],market=map[b.date]/map[a.date]-1;
        if(market<0){down++;if(b.close/a.close-1>=market)held++;}
      }
      vs[name]={excessPct:(last.close/first.close-map[last.date]/map[first.date])*100,downDays:down,heldDownDays:held};
    }
    const excess=Math.min(vs.KOSPI.excessPct,vs.KOSDAQ.excessPct);
    return {status:'ok',from:segment[0].date,to:segment[segment.length-1].date,vs,
      label:'조정·지지 구간 두 지수 대비 '+(excess>=0?'+':'')+excess.toFixed(2)+'%p · 보조 확인'};
  }

  // Daily web selection, independent of legacy numeric scanner/order feeds.
  // Windows are observation scales, not required pattern durations.
  function selectShapesOf(bars) {
    var groups={liveFlow:[],trendBreakout:[],bottomFormation:[],pullbackRebreak:[],longTermQuality:[]};
    if(!Array.isArray(bars) || bars.length<24)return groups;
    if(bars.some(function(b,i){return !b || ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
      b.close<=0 || b.volume<0 || b.low>Math.min(b.open,b.close) || b.high<Math.max(b.open,b.close) ||
      i && String(b.date)<=String(bars[i-1].date);}))return groups;
    if(bars.length>=100)Object.assign(groups,setupShapesOf(bars));
    function med(a){a=a.slice().sort(function(x,y){return x-y;});var k=Math.floor(a.length/2);return a.length%2?a[k]:(a[k-1]+a[k])/2;}
    function points(rows, indexes, field) {
      return indexes.map(function (index) { return {date:rows[index].date,price:rows[index][field]}; });
    }
    function level(rows, start, price) {
      return [{date:rows[start].date,price:price},{date:rows[rows.length-1].date,price:price}];
    }
    function emit(key,win,shape,label,stage,reasons,extra) {
      var last=win[win.length-1], detail=Object.assign({status:stage,shapeLabel:label,shape:shape,
        observationOnly:true,orderAuthorized:false,selectionVersion:'shape-selection-v1',strategyVersion:'chart-first-v2',stage:'prepare',
        windowBars:win.length,support:Math.min.apply(null,win.slice(-5).map(function(b){return b.low;})),
        signal:{date:last.date,price:last.close},score:shape.score,reasons:reasons,
        interpretation:label+' · 일봉 모양 관찰'},extra || {});
      if(key==='longTermQuality' && detail.resistance>0){
        var range=atrSeries(win,14)[win.length-1];
        if(range>0 && (last.close-detail.resistance>range*.8 || last.close-last.open>range*1.5)){
          detail.stage='extended';detail.status='SHAPE_EXTENDED';
          detail.shapeLabel=label+' · 추격·확장 구간';
          detail.interpretation=label+' · 최근 변동폭 대비 이격·큰 봉을 기본 후보에서 분리';
        }
      }
      if(!groups[key].length || detail.score>groups[key][0].score)groups[key]=[detail];
    }
    [24,40,80,160,224].forEach(function(length) {
      if(bars.length<length)return;
      var win=bars.slice(-length),n=win.length,last=win[n-1],shape=shapeOf(win);
      if(shape.type==='unknown')return;
      var atr=atrSeries(win,14)[n-1] || 0;
      if(!(atr>0))return;
      var head=win.slice(0,Math.max(4,Math.floor(n*.6))),tail=win.slice(-Math.max(4,Math.floor(n*.2)));
      var tailTR=med(tail.map(function(b){return b.high-b.low;})),headTR=med(head.map(function(b){return b.high-b.low;}));
      var headVol=med(head.map(function(b){return b.volume;})),tailVol=med(tail.map(function(b){return b.volume;}));
      var peakIndex=win.reduce(function(best,b,i){return b.close>win[best].close?i:best;},0);
      var riseVolumes=win.slice(0,peakIndex+1).map(function(b){return b.volume;});
      var correctionVolumes=win.slice(peakIndex+1).map(function(b){return b.volume;});
      var riseVolume=med(riseVolumes),correctionVolume=correctionVolumes.length?med(correctionVolumes):null;
      var quietVolume=riseVolume>0 && correctionVolume>0 && correctionVolume<riseVolume;
      var calm=tailTR<headTR;
      var priorHigh=Math.max.apply(null,win.slice(0,-3).map(function(b){return b.high;}));
      var priorHighIndex=win.findIndex(function(bar){return bar.high===priorHigh;});
      var priorLow=Math.min.apply(null,head.map(function(b){return b.low;}));
      var recentLow=Math.min.apply(null,tail.map(function(b){return b.low;}));
      var stable=recentLow>priorLow-atr*.5;
      var risingTail=last.close>win[n-3].close && last.close>last.open;
      var highBreak=last.close>priorHigh && win[n-2].close<=priorHigh;
      var highs=[];
      for(var i=2;i<n-2;i++)if(win[i].high>=Math.max(win[i-2].high,win[i-1].high,win[i+1].high,win[i+2].high))highs.push(i);
      var descendingBreak=false,resistance=null;
      if(highs.length>=2) {
        var b=highs[highs.length-1],a=highs[highs.length-2],m=(win[b].high-win[a].high)/(b-a);
        if(m<0 && b-a>=3) {
          resistance=win[b].high+m*(n-1-b);
          descendingBreak=last.close>resistance+atr*.15 && win[n-2].close<=resistance-m+atr*.5;
        }
      }
      var panic=tail.filter(function(b){return b.close<b.open && b.open-b.close>atr && headVol>0 && b.volume>headVol*1.5;}).length>=2;
      var structuralRise=shape.higherLows>=2 && shape.slope>0 && shape.coherence>.5;
      var reasons=[shape.label,calm?'최근 봉 변동폭 축소':'최근 봉 변동폭 유지',
        quietVolume?'조정 거래량 감소':'거래량 감소 미확인'];
      if(length>=160 && !panic && stable && (shape.type==='compression' || structuralRise || highBreak) &&
          (calm || quietVolume || highBreak))
        emit('longTermQuality',win,shape,'장기 저점 지지·응축 또는 저항 회복','SHAPE_FORMING',reasons,{resistance:priorHigh,patternLines:[
          {tone:'shape',points:level(win,head.findIndex(function(bar){return bar.low===priorLow;}),priorLow)},
          {tone:'resistance',points:level(win,priorHighIndex,priorHigh)}
        ]});
    });
    return groups;
  }

  // Quietness inputs (2026-11-13 study docs/EDGE_FACTOR_STUDY_2026-11-13.md): low idiosyncratic
  // volatility and no up-day volume crowding were the only price traits that held every year.
  //  ivol60 : sample std of (stock daily return - same-day universe mean return), last 60 sessions
  //           (|daily return| >= 31% skipped as a corporate-action outlier; needs 55 sessions).
  //  upvol20: up-day volume / total volume over the last 20 sessions.
  //  amt20  : mean close*volume over the last 20 sessions (trading-value proxy).
  // marketReturns maps date -> universe mean return for that date; the caller ranks the
  // values across the whole universe (lower ivol60/upvol20 = quieter). Observation only.
  function quietnessOf(bars, marketReturns) {
    var out={version:'quiet-v1',ivol60:null,upvol20:null,amt20:null};
    if(!Array.isArray(bars) || bars.length<22)return out;
    var n=bars.length, up=0, tot=0, amt=0;
    for(var i=n-20;i<n;i++){
      var b=bars[i],p=bars[i-1];
      if(!(b.close>0 && p.close>0 && b.volume>=0))return out;
      tot+=b.volume; amt+=b.close*b.volume; if(b.close>p.close)up+=b.volume;
    }
    out.upvol20=tot>0?up/tot:null; out.amt20=amt/20;
    var ex=[];
    for(var j=Math.max(1,n-60);j<n;j++){
      var r=bars[j].close/bars[j-1].close-1, m=marketReturns ? marketReturns[bars[j].date] : undefined;
      if(Number.isFinite(r) && Math.abs(r)<.31 && Number.isFinite(m))ex.push(r-m);
    }
    if(ex.length>=55){
      var mean=ex.reduce(function(s,x){return s+x;},0)/ex.length;
      out.ivol60=Math.sqrt(ex.reduce(function(s,x){return s+(x-mean)*(x-mean);},0)/(ex.length-1));
    }
    return out;
  }

  var api = { quietnessOf: quietnessOf, selectShapesOf: selectShapesOf, relativeContextOf: relativeContextOf, relativeStrengthOf: relativeStrengthOf, edgeSignalsOf: edgeSignalsOf, myWayOf: myWayOf, shapeOf: shapeOf, pullbackOf: pullbackOf, analyze: analyze, detectWaves: detectWaves, defaults: DEFAULTS, version: VERSION, levels: LEVELS,
    atrSeries: atrSeries, smaSeries: smaSeries, cloudSeries: cloudSeries, isSideways: isSideways, hashBars: hashBars, makeZigzag: makeZigzag };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AutoWave = api;
})(typeof window !== 'undefined' ? window : globalThis);
