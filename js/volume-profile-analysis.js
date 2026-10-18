/* 매물대 분석 공통 계산(2026-10-19) - 화면 코드 없이 숫자만 다룬다.
 *
 * 입력은 "가격 구간별 추정 거래량"(bins: [{low, high, volume}], 낮은 가격부터)이다. 일봉 OHLCV의 거래량을
 * 고가~저가에 비례 배분한 근사치이지 실제 체결가별 거래량이 아니다. 차트검색(js/stock-search.js)·종목분석·MY
 * (js/foreign-flow.js)가 이 파일 하나로 같은 규칙을 쓴다. 브라우저에서는 window.NineVolumeProfile, node 테스트에서는 require.
 *
 * 규칙
 * - 비중 = 구간 거래량 / 전체 분석 거래량 x 100 (구간 합계 = 100%)
 * - 상대 강도 = 구간 밀도 / 최대 밀도 x 100. 밀도 = 거래량 / 구간 폭이라 구간 폭이 달라도 같은 가격폭 기준으로 비교한다.
 * - 주요 집중 구간 = 밀도가 최대의 significantRatio 이상인 연속 구간. 분포가 평평하면(최대/평균 < minPeakToMean) 만들지 않는다.
 * - 얇은 구간 = 밀도가 평균의 thinRatio 이하인 연속 구간 중 주요 구간 가까이(thinNearBins칸 이내)에 있는 것.
 * - 현재가 위·아래 거래량은 현재가가 속한 구간을 가격 비율로 나눠 합이 항상 100%가 되게 한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NineVolumeProfile = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DEFAULTS = {
    significantRatio: 0.7,   // 주요 구간 판정: 최대 밀도 대비
    minPeakToMean: 1.3,      // 최대 밀도/평균 밀도가 이보다 작으면 집중 구간이 없다고 본다
    thinRatio: 0.35,         // 얇은 구간 판정: 평균 밀도 대비
    thinNearBins: 3,         // 얇은 구간은 주요 구간에서 이 칸 수 이내만
    thinMax: 3,              // 표시할 얇은 구간 수
    nearPct: 5,              // '가까운' 구간으로 보는 현재가와의 거리(%)
    approachPct: 3,          // 지지 후보 접근 판정(%)
    recentDays: 10,          // 돌파·이탈을 볼 최근 종가 수
    upperPartRatio: 0.7      // 구간 안에서 이 비율 위를 '상단'으로 본다
  };

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function settings(opts) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = opts && opts[k] != null ? opts[k] : DEFAULTS[k]; });
    out.format = opts && opts.format || function (v) { return Math.round(v).toLocaleString('ko-KR') + '원'; };
    out.formatVolume = opts && opts.formatVolume || function (v) { return Math.round(v).toLocaleString('ko-KR') + '주'; };
    return out;
  }

  function pct(value, digits) { return (isFinite(value) ? value : 0).toFixed(digits == null ? 1 : digits) + '%'; }

  // 구간마다 비중(share)·밀도(density)·상대 강도(strength)를 붙인 새 배열
  function decorate(bins) {
    var list = (bins || []).map(function (b) {
      var low = num(b.low), high = num(b.high), volume = Math.max(0, num(b.volume));
      var width = high - low;
      return { low: low, high: high, volume: volume, width: width, density: width > 0 ? volume / width : 0 };
    });
    var total = list.reduce(function (s, b) { return s + b.volume; }, 0);
    var maxDensity = list.reduce(function (m, b) { return Math.max(m, b.density); }, 0);
    var meanDensity = list.length ? list.reduce(function (s, b) { return s + b.density; }, 0) / list.length : 0;
    list.forEach(function (b) {
      b.share = total > 0 ? b.volume / total * 100 : 0;
      b.strength = maxDensity > 0 ? b.density / maxDensity * 100 : 0;
    });
    return { bins: list, total: total, maxDensity: maxDensity, meanDensity: meanDensity };
  }

  function makeZone(list, from, to, pocIndex) {
    var slice = list.slice(from, to + 1);
    var volume = slice.reduce(function (s, b) { return s + b.volume; }, 0);
    var width = list[to].high - list[from].low;
    var peak = slice.reduce(function (m, b) { return Math.max(m, b.strength); }, 0);
    return {
      low: list[from].low, high: list[to].high, from: from, to: to, binCount: slice.length,
      volume: volume, share: slice.reduce(function (s, b) { return s + b.share; }, 0),
      density: width > 0 ? volume / width : 0, strength: peak,
      hasPoc: pocIndex >= from && pocIndex <= to
    };
  }

  // 연속된 구간 묶음(조건을 만족하는 칸끼리)
  function runs(list, test) {
    var out = [], start = -1;
    list.forEach(function (b, i) {
      if (test(b, i)) { if (start < 0) start = i; }
      else if (start >= 0) { out.push([start, i - 1]); start = -1; }
    });
    if (start >= 0) out.push([start, list.length - 1]);
    return out;
  }

  // 현재가 위·아래 거래량 비중. 현재가가 속한 구간은 가격 비율로 나눈다.
  function sideShares(list, total, price) {
    var above = 0, below = 0;
    list.forEach(function (b) {
      if (b.low >= price) above += b.volume;
      else if (b.high <= price) below += b.volume;
      else {
        var upper = b.width > 0 ? (b.high - price) / b.width : 0;
        above += b.volume * upper;
        below += b.volume * (1 - upper);
      }
    });
    return { above: total > 0 ? above / total * 100 : 0, below: total > 0 ? below / total * 100 : 0 };
  }

  function gap(zone, price, side) {
    // 현재가에서 구간의 가까운 경계까지(side: 'above' = 구간 하단, 'below' = 구간 상단)
    var edge = side === 'above' ? zone.low : zone.high;
    var diff = Math.abs(edge - price);
    return { edge: edge, diff: diff, pct: price > 0 ? diff / price * 100 : 0 };
  }

  function analyze(bins, price, closes, opts) {
    var s = settings(opts);
    var d = decorate(bins);
    var list = d.bins;
    var p = Number(price);
    if (!list.length || !(d.total > 0) || !(d.maxDensity > 0)) return null;
    var pocIndex = 0;
    list.forEach(function (b, i) { if (b.density > list[pocIndex].density) pocIndex = i; });
    var poc = makeZone(list, pocIndex, pocIndex, pocIndex);

    var hasPrice = isFinite(p) && p > 0;
    var widthsEqual = list.every(function (b) { return Math.abs(b.width - list[0].width) <= Math.abs(list[0].width) * 1e-6 + 1e-9; });
    var concentrated = d.maxDensity / (d.meanDensity || 1) >= s.minPeakToMean;
    var zones = concentrated
      ? runs(list, function (b) { return b.strength >= s.significantRatio * 100; }).map(function (r) { return makeZone(list, r[0], r[1], pocIndex); })
      : [];

    var out = {
      total: d.total, peakToMean: d.maxDensity / (d.meanDensity || 1), binCount: list.length, uniformWidth: widthsEqual, concentrated: concentrated,
      bins: list, pocIndex: pocIndex, poc: poc, zones: zones, price: hasPrice ? p : null,
      resistance: null, support: null, inZone: null, aboveShare: null, belowShare: null, thin: [], state: null,
      settings: { significantRatio: s.significantRatio, thinRatio: s.thinRatio, nearPct: s.nearPct, approachPct: s.approachPct }
    };
    if (!hasPrice) return out;

    var side = sideShares(list, d.total, p);
    out.aboveShare = side.above;
    out.belowShare = side.below;
    zones.forEach(function (z) {
      if (p >= z.low && p <= z.high) out.inZone = z;
      else if (z.low > p) { if (!out.resistance || z.low < out.resistance.low) out.resistance = z; }
      else if (z.high < p) { if (!out.support || z.high > out.support.high) out.support = z; }
    });
    if (out.resistance) out.resistanceGap = gap(out.resistance, p, 'above');
    if (out.support) out.supportGap = gap(out.support, p, 'below');
    out.pocGap = p < poc.low ? { where: 'above', diff: poc.low - p, pct: (poc.low - p) / p * 100 }
      : p > poc.high ? { where: 'below', diff: p - poc.high, pct: (p - poc.high) / p * 100 }
        : { where: 'inside', diff: 0, pct: 0 };

    out.thin = thinZones(list, d, zones, p, s);
    out.state = judge(out, p, Array.isArray(closes) ? closes.map(Number).filter(isFinite) : [], s);
    return out;
  }

  function thinZones(list, d, zones, p, s) {
    if (!zones.length) return [];
    var limit = d.meanDensity * s.thinRatio;
    var found = runs(list, function (b) { return b.density <= limit; }).map(function (r) {
      var low = list[r[0]].low, high = list[r[1]].high;
      var volume = 0, share = 0;
      for (var i = r[0]; i <= r[1]; i++) { volume += list[i].volume; share += list[i].share; }
      var width = high - low;
      // 가장 가까운 주요 구간(칸 수 기준)
      var near = null, nearDist = Infinity;
      zones.forEach(function (z) {
        var dist = z.to < r[0] ? r[0] - z.to : z.from > r[1] ? z.from - r[1] : 0;
        if (dist < nearDist) { nearDist = dist; near = z; }
      });
      var density = width > 0 ? volume / width : 0;
      return {
        low: low, high: high, binCount: r[1] - r[0] + 1, volume: volume, share: share,
        neighbor: near, neighborBins: nearDist,
        ratioToNeighbor: near && near.density > 0 ? density / near.density * 100 : null,
        distance: p >= low && p <= high ? 0 : p < low ? low - p : p - high,
        distancePct: p >= low && p <= high ? 0 : (p < low ? low - p : p - high) / p * 100,
        contains: p >= low && p <= high, where: p < low ? 'above' : p > high ? 'below' : 'inside'
      };
    }).filter(function (t) { return t.neighborBins <= s.thinNearBins; });
    found.sort(function (a, b) { return a.distance - b.distance; });
    return found.slice(0, s.thinMax);
  }

  function zoneText(z, s) {
    return s.format(z.low) + '~' + s.format(z.high);
  }

  // 현재가 위치를 근거 수치와 함께 문장으로. 확정 표현은 쓰지 않는다.
  function judge(a, p, closes, s) {
    var hist = closes.slice(-s.recentDays - 1, -1);   // 마지막 종가(오늘)는 제외한 최근 종가들
    var fmt = s.format;
    function share(z) { return pct(z.share); }
    if (!a.zones.length) {
      return { key: 'none', label: '현재가 주변에서 유의미한 집중 구간이 발견되지 않음',
        text: '이 기간은 가격대별 추정 거래량이 고르게 퍼져 있어(최대 구간이 평균의 ' + a.peakToMean.toFixed(1) + '배, 기준 ' + s.minPeakToMean + '배) 뚜렷한 집중 구간을 만들지 않았습니다.' };
    }
    var z = a.inZone;
    if (z) {
      var brokeAbove = hist.some(function (c) { return c > z.high; });
      var heightRatio = z.high > z.low ? (p - z.low) / (z.high - z.low) : 0;
      if (brokeAbove) {
        return { key: 'reenter', label: '돌파 후 재이탈(구간 안으로 되돌림)',
          text: '최근 ' + hist.length + '거래일 안에 이 구간 상단 ' + fmt(z.high) + ' 위에서 마감한 날이 있었지만 현재가 ' + fmt(p) + '은 다시 구간(' + zoneText(z, s) + ') 안입니다. 이 구간은 추정 거래량의 ' + share(z) + '가 배분된 곳입니다.' };
      }
      if (heightRatio >= s.upperPartRatio) {
        return { key: 'breakout-try', label: '주요 매물 집중 구간 상단 돌파 시도',
          text: '현재가 ' + fmt(p) + '은 주요 집중 구간(' + zoneText(z, s) + ') 상단 ' + fmt(z.high) + '보다 ' + pct((z.high - p) / p * 100) + ' 아래입니다. 이 구간은 추정 거래량의 ' + share(z) + '가 배분된 곳입니다.' };
      }
      return { key: 'inside', label: '주요 매물 집중 구간에 진입',
        text: '현재가 ' + fmt(p) + '은 주요 집중 구간(' + zoneText(z, s) + ') 안에 있습니다. 이 구간은 추정 거래량의 ' + share(z) + '가 배분된 곳이고 구간 상단까지 ' + pct((z.high - p) / p * 100) + '입니다.' };
    }
    var below = a.support, above = a.resistance;
    if (below && a.supportGap.pct <= s.nearPct) {
      var held = 0;
      for (var i = closes.length - 1; i >= 0 && closes[i] > below.high; i--) held++;
      var cameFrom = hist.some(function (c) { return c <= below.high; });
      if (cameFrom && held >= 1) {
        return { key: 'breakout-held', label: '돌파 후 가격 유지',
          text: '현재가 ' + fmt(p) + '은 집중 구간(' + zoneText(below, s) + ') 상단 ' + fmt(below.high) + ' 위에 있고 종가가 ' + held + '거래일 연속 그 위에 머물렀습니다. 이 구간은 추정 거래량의 ' + share(below) + '가 배분된 곳입니다.' };
      }
      if (a.supportGap.pct <= s.approachPct) {
        return { key: 'support-near', label: '주요 지지 후보에 접근',
          text: '현재가 ' + fmt(p) + '은 가까운 지지 후보(' + zoneText(below, s) + ') 상단보다 ' + pct(a.supportGap.pct) + ' 위입니다. 이 구간은 추정 거래량의 ' + share(below) + '가 배분된 곳입니다.' };
      }
    }
    if (above) {
      var lost = hist.some(function (c) { return c >= above.high; });
      if (lost && a.resistanceGap.pct <= s.nearPct) {
        return { key: 'support-lost', label: '지지 후보 이탈',
          text: '최근 ' + hist.length + '거래일 안에 이 구간(' + zoneText(above, s) + ') 위에서 마감한 날이 있었지만 현재가 ' + fmt(p) + '은 하단 ' + fmt(above.low) + '보다 ' + pct(a.resistanceGap.pct) + ' 아래입니다. 이 구간은 추정 거래량의 ' + share(above) + '가 배분된 곳입니다.' };
      }
      return { key: 'below-resistance', label: '현재가가 주요 저항 후보 아래',
        text: '현재가는 가장 가까운 주요 저항 후보(' + zoneText(above, s) + ') 하단보다 ' + pct(a.resistanceGap.pct) + ' 낮습니다. 해당 가격대는 분석 기간 추정 거래량의 ' + share(above) + '가 배분된 구간입니다.' };
    }
    return { key: 'above-all', label: '가까운 저항 후보 없음(주요 구간 위)',
      text: '현재가 ' + fmt(p) + ' 위에는 주요 집중 구간이 없고, 가장 가까운 아래 구간(' + zoneText(below, s) + ')과 ' + pct(a.supportGap.pct) + ' 떨어져 있습니다.' };
  }

  // 얇은 구간 문장
  function thinText(t, opts) {
    var s = settings(opts);
    var rel = t.ratioToNeighbor != null ? ' 인접 주요 구간 밀도의 ' + pct(t.ratioToNeighbor, 0) + ' 수준입니다.' : '';
    return s.format(t.low) + '~' + s.format(t.high) + '은 같은 기간·같은 가격폭 기준으로 인접 가격대보다 추정 거래량이 적은 구간입니다(전체의 ' + pct(t.share) + ').' + rel;
  }

  return { DEFAULTS: DEFAULTS, decorate: decorate, analyze: analyze, sideShares: sideShares, thinText: thinText, pct: pct };
});
