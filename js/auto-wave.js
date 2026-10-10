/* 자동 파동 구조 박스 (실험적 차트 분석 보조) - 가격 움직임의 구조를 객관적으로 나눠 보여줄 뿐이다.
 * 엘리어트 번호를 매기지 않으며 매수·매도 추천이나 미래 방향을 말하지 않는다. 일봉 OHLCV만 쓰고 브라우저에서 계산한다.
 *
 * 규칙 - 모두 "그 시점까지의 봉"만 사용한다(미래를 미리 아는 판정 없음)
 *  1. 확정 스윙: 직전 극점에서 ZIGZAG_ATR x ATR14 이상 반대로 움직이면 그 극점을 스윙으로 본다.
 *     극점이 생긴 봉(index)과 확정된 봉(confirmedIndex)은 다르다 - 되돌림이 확인돼야 확정되므로 늘 뒤늦게 알려진다.
 *  2. 확정 스윙 사이 구간은 저점->고점 = 상승, 고점->저점 = 하락 파동. 폭이 LEG_MIN_ATR x ATR 미만이거나 MIN_BARS 봉 미만이면 약한 구간이다.
 *  3. 횡보 판정(isSideways): "ATR이 작다"만으로는 횡보가 아니다. 다음을 함께 만족해야 한다.
 *     - 방향 효율성 ER = |순변화| / 종가 이동 경로 합 <= SIDE_ER_MAX (직선으로 가지 않고 같은 범위를 오간다)
 *     - 순변화가 구간 가격 범위의 SIDE_NET_RANGE_MAX 이하 (범위를 벗어나 한쪽으로 가지 않았다)
 *     - 범위 상단·하단 띠에 서로 다른 봉이 각각 2번 이상 닿고 중간선을 2번 이상 교차(왕복)한다(고점·저점이 반복된다)
 *     - 20일선이 구간 끝 10봉 동안 SIDE_MA20_FLAT_ATR x ATR 이하로만 움직였다(5일선은 20일선 부근을 오간다)
 *     - 가격 범위가 SIDE_RANGE_ATR_MAX x ATR 이하(변동성이 큰 박스권도 이 상한 안이면 인정)
 *     추세 파동과 겹치면 방향성이 뚜렷한 추세 파동(ER >= TREND_ER_MIN)이 우선하고, 약한 구간 묶음만 횡보 후보가 된다.
 *  4. 마지막 확정 스윙 이후 현재까지는 "진행 중"이다: 상승/하락 진행 중(방향 뚜렷), 횡보 진행 중(횡보 조건 충족),
 *     그 외는 방향 미확정. 새 봉이 들어오면 진행 중 구간은 바뀔 수 있다.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    atrPeriod: 14,
    zigzagAtr: 3.0,
    legMinAtr: 4.0,
    minBars: 3,
    minSidewaysBars: 12,
    sideErMax: 0.25,
    sideNetRangeMax: 0.5,
    sideRangeAtrMax: 12,
    mergeRangeAtrMax: 9,
    sideMa20FlatAtr: 2.0,
    trendErMin: 0.35,
    trendMoveAtr: 3.0
  };

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

  function smaSeries(bars, period) {
    var out = new Array(bars.length), sum = 0;
    for (var i = 0; i < bars.length; i++) {
      sum += bars[i].close;
      if (i >= period) sum -= bars[i - period].close;
      out[i] = i >= period - 1 ? sum / period : null;
    }
    return out;
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

  /* 확정 스윙: { index, type, price, confirmedIndex } */
  function confirmedSwings(bars, atr, opt) {
    var swings = [], dir = 0, extIdx = 0, extPrice = bars[0].close;
    for (var i = 1; i < bars.length; i++) {
      var a = atr[i];
      if (a == null) continue;
      var th = a * opt.zigzagAtr;
      if (dir === 0) {
        if (bars[i].high - bars[extIdx].low >= th) { swings.push({ index: extIdx, type: 'low', price: bars[extIdx].low, confirmedIndex: i }); dir = 1; extIdx = i; extPrice = bars[i].high; }
        else if (bars[extIdx].high - bars[i].low >= th) { swings.push({ index: extIdx, type: 'high', price: bars[extIdx].high, confirmedIndex: i }); dir = -1; extIdx = i; extPrice = bars[i].low; }
        else if (bars[i].low < bars[extIdx].low) extIdx = i;
        continue;
      }
      if (dir === 1) {
        if (bars[i].high > extPrice) { extPrice = bars[i].high; extIdx = i; }
        else if (extPrice - bars[i].low >= th) { swings.push({ index: extIdx, type: 'high', price: extPrice, confirmedIndex: i }); dir = -1; extIdx = i; extPrice = bars[i].low; }
      } else {
        if (bars[i].low < extPrice) { extPrice = bars[i].low; extIdx = i; }
        else if (bars[i].high - extPrice >= th) { swings.push({ index: extIdx, type: 'low', price: extPrice, confirmedIndex: i }); dir = 1; extIdx = i; extPrice = bars[i].high; }
      }
    }
    return swings;
  }

  /* 횡보 판정: 구간 [a, b]가 같은 범위를 오가는 박스권인가 */
  function isSideways(ctx, a, b, rangeAtrMax) {
    var bars = ctx.bars, opt = ctx.opt;
    if (b - a + 1 < opt.minSidewaysBars) return false;
    // 변동성이 구간 중간에 커졌다 줄어도 한 박스로 보이도록 구간 평균 ATR을 기준으로 삼는다.
    var atrSum = 0, atrN = 0;
    for (var t = a; t <= b; t++) if (ctx.atr[t]) { atrSum += ctx.atr[t]; atrN++; }
    var atr = atrN ? atrSum / atrN : null;
    if (!atr) return false;
    var r = rangeOf(bars, a, b), range = r.high - r.low;
    if (!(range > 0) || range > (rangeAtrMax || opt.sideRangeAtrMax) * atr) return false;
    if (efficiency(bars, a, b) > opt.sideErMax) return false;
    if (Math.abs(bars[b].close - bars[a].close) > opt.sideNetRangeMax * range) return false;
    // 20일선이 구간 끝 10봉 동안 거의 안 움직였는가
    var m1 = ctx.ma20[b], m0 = ctx.ma20[Math.max(a, b - 10)];
    if (m1 == null || m0 == null || Math.abs(m1 - m0) > opt.sideMa20FlatAtr * atr) return false;
    // 상·하단 띠 반복 접촉 + 중간선 교차
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

  /* 반환: [{ kind:'up'|'down'|'side'|'unk', state:'확정'|'진행 중'|'방향 미확정', confirmed, start, end,
              high, low, endConfirmedIndex }] - start/end는 봉 인덱스 */
  function detectWaves(bars, options) {
    var opt = {};
    Object.keys(DEFAULTS).forEach(function (k) { opt[k] = options && options[k] != null ? options[k] : DEFAULTS[k]; });
    if (!bars || bars.length < opt.atrPeriod + 10) return [];
    var ctx = { bars: bars, opt: opt, atr: atrSeries(bars, opt.atrPeriod), ma20: smaSeries(bars, 20) };
    var sw = confirmedSwings(bars, ctx.atr, opt);
    var legs = [];
    for (var i = 1; i < sw.length; i++) {
      var s0 = sw[i - 1], s1 = sw[i];
      var a = ctx.atr[s1.index] || ctx.atr[s1.confirmedIndex];
      var size = Math.abs(s1.price - s0.price);
      var strong = !!(a && size >= opt.legMinAtr * a && s1.index - s0.index >= opt.minBars);
      legs.push({ kind: s1.type === 'high' ? 'up' : 'down', start: s0.index, end: s1.index, strong: strong, confirmedIndex: s1.confirmedIndex });
    }
    var waves = [];
    var k = 0;
    while (k < legs.length) {
      var leg = legs[k];
      if (leg.strong) {
        var r = rangeOf(bars, leg.start, leg.end);
        waves.push({ kind: leg.kind, state: '확정', confirmed: true, start: leg.start, end: leg.end, high: r.high, low: r.low, endConfirmedIndex: leg.confirmedIndex });
        k++;
        continue;
      }
      var j = k;
      while (j + 1 < legs.length && !legs[j + 1].strong) j++;
      if (isSideways(ctx, legs[k].start, legs[j].end)) {
        var span = rangeOf(bars, legs[k].start, legs[j].end);
        waves.push({ kind: 'side', state: '확정', confirmed: true, start: legs[k].start, end: legs[j].end, high: span.high, low: span.low, endConfirmedIndex: legs[j].confirmedIndex });
      }
      k = j + 1;
    }
    // 우선순위: 방향 없이 같은 범위를 오가는 상승·하락 파동의 연속(3개 이상)은 하나의 횡보 박스로 합친다.
    // 방향 효율성이 낮고 범위가 ATR 상한 안일 때만이라, 뚜렷한 추세 파동은 그대로 남는다.
    var merged = [];
    var m = 0;
    while (m < waves.length) {
      var best = -1;
      if (waves[m].kind === 'up' || waves[m].kind === 'down') {
        var runEnd = m;
        while (runEnd + 1 < waves.length && (waves[runEnd + 1].kind === 'up' || waves[runEnd + 1].kind === 'down')) runEnd++;
        for (var q = runEnd; q >= m + 2; q--) {
          if (isSideways(ctx, waves[m].start, waves[q].end, opt.mergeRangeAtrMax)) { best = q; break; }
        }
      }
      if (best >= 0) {
        var sp = rangeOf(bars, waves[m].start, waves[best].end);
        merged.push({ kind: 'side', state: '확정', confirmed: true, start: waves[m].start, end: waves[best].end, high: sp.high, low: sp.low, endConfirmedIndex: waves[best].endConfirmedIndex });
        m = best + 1;
      } else { merged.push(waves[m]); m++; }
    }
    waves = merged;
    // 진행 중: 마지막 확정 스윙 이후 현재까지
    if (sw.length) {
      var last = sw[sw.length - 1], end = bars.length - 1, a2 = ctx.atr[end];
      if (a2 && end - last.index >= opt.minBars) {
        var rp = rangeOf(bars, last.index, end);
        var base = { confirmed: false, start: last.index, end: end, high: rp.high, low: rp.low, endConfirmedIndex: null };
        var er = efficiency(bars, last.index, end);
        var net = bars[end].close - bars[last.index].close;
        if (isSideways(ctx, last.index, end)) {
          waves.push(Object.assign(base, { kind: 'side', state: '진행 중' }));
        } else if (er >= opt.trendErMin && Math.abs(net) >= opt.trendMoveAtr * a2) {
          waves.push(Object.assign(base, { kind: net > 0 ? 'up' : 'down', state: '진행 중' }));
        } else {
          waves.push(Object.assign(base, { kind: 'unk', state: '방향 미확정' }));
        }
      }
    }
    return waves;
  }

  var api = { detectWaves: detectWaves, defaults: DEFAULTS, atrSeries: atrSeries, isSideways: isSideways };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AutoWave = api;
})(typeof window !== 'undefined' ? window : globalThis);
