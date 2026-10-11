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

  var VERSION = '2026-10-12-hier-2';

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
      scales[name] = { name: name, prm: prm, zz: makeZigzag(bars, ctx.atr, prm.zigzagAtr), pivots: [], legs: [], boxes: [], openBox: null, boxFloor: 0 };
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

    promoteLongBoxes(levels, bars, ctx);
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
  function promoteLongBoxes(levels, bars, ctx) {
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
      levels.major.forEach(function (w) {
        if (!w.isBox && w.confirmed && w.start >= promoted.start && w.end <= promoted.end) { w.boxId = promoted.id; w.suppressed = true; }
      });
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

  function tagWaves(levels) {
    LEVELS.forEach(function (name) {
      levels[name].forEach(function (w) {
        if (w.isBox) { w.label = w.kind === 'wide' ? '변동성 큰 박스권' : (w.compression ? '횡보·변동성 압축' : '횡보'); return; }
        if (w.struct) w.tags.push(w.struct);
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
    var opt = ctx.opt;
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
        // 박스 이후 첫 돌파 봉
        var after = b.confirmed ? b.end : b.end;
        for (var i = after + 1; i < bars.length; i++) {
          var cloudTop = ctx.cloud.top[i], ma = ctx.ma224[i];
          if (bars[i].close > b.high && ma != null && bars[i].close > ma && cloudTop != null && bars[i].close > cloudTop) {
            var volNow = ctx.vol20[i], volBox = 0, cnt = 0;
            for (var v = b.start; v <= b.end; v++) { volBox += bars[v].volume || 0; cnt++; }
            volBox = cnt ? volBox / cnt : 0;
            var evidence = { boxBars: b.base.bars, higherLows: steps, volumeRatio: volBox > 0 && volNow ? +(volNow / volBox).toFixed(2) : null, above224: true, aboveCloud: true };
            signals.push({ index: i, type: 'base_breakout', boxId: b.id, evidence: evidence });
            b.base.breakoutIndex = i;
            break;
          }
          if (bars[i].close < b.low * 0.97 && !(i <= b.end)) break;
        }
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

  var api = { analyze: analyze, detectWaves: detectWaves, defaults: DEFAULTS, version: VERSION, levels: LEVELS,
    atrSeries: atrSeries, smaSeries: smaSeries, cloudSeries: cloudSeries, isSideways: isSideways, hashBars: hashBars, makeZigzag: makeZigzag };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AutoWave = api;
})(typeof window !== 'undefined' ? window : globalThis);
