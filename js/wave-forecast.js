/**
 * 다음 파동 시나리오 분석 (2026-10-14, 실험·연구용 - 매매 판단·자동매매와 연결하지 않는다).
 *
 * 입력: 일봉 OHLCV + js/auto-wave.js 의 AutoWave.analyze() 결과(대·중·소 파동·상태·신호). 이 파일은 파동을 새로 찾지 않는다.
 * 출력: 지금 구조가 어떤 시나리오인지, 그 시나리오를 확인·무효화하는 가격, 근거, 변동 범위 참고선. 미래 가격을 예측하지 않는다.
 *
 * 미래 비참조: asOfIndex(마지막 봉)까지의 자료와 그 봉까지 확정된 파동만 쓴다. 결과에 asOfDate·signalDate·modelVersion·engineVersion·dataFingerprint 를 같이 담아
 * 나중에 같은 입력으로 같은 결과를 재현할 수 있다. 같은 입력이면 항상 같은 결과다(난수·시각 의존 없음).
 *
 * 시나리오(서로 배타적인 '주 시나리오' 하나 + 동시에 성립할 수 있는 '보조 조건'):
 *   breakdown(상승 추세 훼손) > fakeRally(가짜 상승) > compression(횡보·에너지 응축) > pullback(정상 눌림목) > continuation(상승 지속·재상승) > 없음
 *   먼저 성립한 쪽이 주 시나리오다. 나머지 성립 조건은 candidates 에 남고, 224일선·구름대·거래량·저점 상승 같은 조건은 evidence 로 따로 적는다.
 *
 * 통계(WAVE_FORECAST_STATS)는 오프라인 연구(scripts/analysis/wave_forecast_study.*)로 만든 표다. 표본 수·개발/검증 일관성·유의성 문턱을 통과한
 * 칸만 화면에 숫자를 보여 주고, 통과하지 못하면 '검증 미통과'만 적는다(단순 조건 일치율을 상승 확률이라고 부르지 않는다).
 */
(function (global) {
  'use strict';

  var MODEL_VERSION = '2026-10-14-wf1';
  var HORIZONS = [5, 10, 20];
  var LEVEL_ORDER = ['major', 'medium', 'minor'];
  // 극점이 확정되기까지의 중앙값 지연(봉) - docs/AUTO_WAVE_VALIDATION_2026-10-13.md. 관찰 기간 안내에 쓴다.
  var CONFIRM_DELAY = { major: 39, medium: 6, minor: 2 };
  var SCENARIOS = {
    continuation: { name: '상승 지속·재상승', side: 'up', headline: '상승 지속 또는 재상승 가능성' },
    pullback: { name: '정상 눌림목', side: 'up', headline: '상승 추세 내 조정 진행, 재상승 조건 관찰' },
    compression: { name: '횡보·에너지 응축', side: 'flat', headline: '횡보·응축 구간 - 박스 상·하단 이탈 방향을 관찰(이후 변동폭이 커진다는 근거는 과거 통계에서 확인되지 않음)' },
    fakeRally: { name: '가짜 상승(반등 실패)', side: 'down', headline: '반등 실패 또는 하락 추세 재개 가능성' },
    breakdown: { name: '상승 추세 훼손', side: 'down', headline: '중기 상승 추세 약화 또는 하락 전환 가능성' }
  };
  var PRIORITY = ['breakdown', 'fakeRally', 'compression', 'pullback', 'continuation'];
  var REGIME_TEXT = { up: '대 상승', up_broken: '대 상승 훼손', down: '대 하락', down_recovering: '대 하락 후 회복 시도', compression: '대 횡보·변동성 압축', expansion: '대 변동성 확대', range: '대 횡보', unknown: '대 구조 미확정' };

  function AW() { return global.AutoWave; }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function round(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function lastOf(a) { return a.length ? a[a.length - 1] : null; }

  // ---- 입력 정리 ----
  function legsOf(analysis, level) {
    return ((analysis.levels && analysis.levels[level]) || []).filter(function (w) { return !w.isBox; }).sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  }
  function boxesOf(analysis, level) {
    return ((analysis.levels && analysis.levels[level]) || []).filter(function (w) { return w.isBox; });
  }

  function mean(bars, a, b, key) {
    var s = 0, n = 0;
    for (var i = Math.max(0, a); i <= b && i < bars.length; i++) { s += Number(bars[i][key]) || 0; n++; }
    return n ? s / n : null;
  }

  function stdev(values) {
    if (values.length < 2) return null;
    var m = values.reduce(function (x, y) { return x + y; }, 0) / values.length;
    return Math.sqrt(values.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (values.length - 1));
  }

  // 마지막 봉 기준 필요한 값을 한 번에 모은다(그 봉까지의 자료만).
  function features(bars, an, level) {
    var A = AW(), L = bars.length - 1, c = bars[L].close;
    var k = Math.max(0, LEVEL_ORDER.indexOf(level));
    var ctxLevel = LEVEL_ORDER[Math.max(0, k - 1)], trigLevel = LEVEL_ORDER[Math.min(2, k + 1)];
    var swing = legsOf(an, level), trig = legsOf(an, trigLevel);
    var confirmed = swing.filter(function (w) { return w.confirmed; });
    var open = swing.filter(function (w) { return !w.confirmed; });
    var inProgress = lastOf(open);
    var lastLeg = lastOf(swing);
    var lastConfirmed = lastOf(confirmed);
    var confLows = confirmed.filter(function (w) { return w.kind === 'down'; }).map(function (w) { return { price: w.endPrice, idx: w.end, struct: w.struct }; });
    var confHighs = confirmed.filter(function (w) { return w.kind === 'up'; }).map(function (w) { return { price: w.endPrice, idx: w.end, struct: w.struct }; });
    var lastLow = lastOf(confLows), prevLow = confLows.length > 1 ? confLows[confLows.length - 2] : null;
    var lastHigh = lastOf(confHighs), prevHigh = confHighs.length > 1 ? confHighs[confHighs.length - 2] : null;
    var st = an.state || {};
    var ma = { m20: A.smaSeries(bars, 20), m60: A.smaSeries(bars, 60), m224: A.smaSeries(bars, 224), v20: A.smaSeries(bars, 20, 'volume'), v60: A.smaSeries(bars, 60, 'volume') };
    var cloud = A.cloudSeries(bars), atrArr = A.atrSeries(bars, 14);
    var rets = [];
    for (var i = Math.max(1, L - 59); i <= L; i++) if (bars[i - 1].close > 0) rets.push(Math.log(bars[i].close / bars[i - 1].close));
    var openBoxes = boxesOf(an, level).concat(boxesOf(an, 'major')).filter(function (b) { return !b.confirmed; });
    var box = openBoxes.length ? openBoxes.sort(function (a, b) { return (b.childIds || []).length - (a.childIds || []).length; })[0] : null;
    // 조정(눌림) 구간: 진행 중인 하락 파동
    var pull = null;
    if (inProgress && inProgress.kind === 'down') {
      var prevUp = null;
      for (var q = swing.length - 1; q >= 0; q--) if (swing[q] !== inProgress && swing[q].kind === 'up' && swing[q].confirmed) { prevUp = swing[q]; break; }
      var upSize = prevUp ? Math.abs(prevUp.endPrice - prevUp.startPrice) : null;
      pull = { high: inProgress.startPrice, low: inProgress.endPrice, start: inProgress.start, retrace: upSize ? (inProgress.startPrice - inProgress.endPrice) / upSize : null,
        volRatio: (function () { var dv = mean(bars, inProgress.start, L, 'volume'), uv = prevUp ? mean(bars, prevUp.start, prevUp.end, 'volume') : null; return dv != null && uv ? dv / uv : null; })() };
    }
    // 반등(진행 중 상승 파동)의 거래량: 직전 하락 구간 평균 대비
    var rally = null;
    if (inProgress && inProgress.kind === 'up') {
      var prevDown = null;
      for (var r = swing.length - 1; r >= 0; r--) if (swing[r] !== inProgress && swing[r].kind === 'down') { prevDown = swing[r]; break; }
      var uv2 = mean(bars, inProgress.start, L, 'volume'), dv2 = prevDown ? mean(bars, prevDown.start, prevDown.end, 'volume') : null;
      rally = { startPrice: inProgress.startPrice, high: inProgress.endPrice, volRatio: uv2 != null && dv2 ? uv2 / dv2 : null };
    }
    // 눌림 시작 이후의 가장 최근 하위(트리거) 규모 고점/저점
    var since = pull ? pull.start : (lastLow ? lastLow.idx : 0);
    var trigHighs = trig.filter(function (w) { return w.kind === 'up' && w.end >= since; });
    var trigHigh = trigHighs.length ? Math.max.apply(null, trigHighs.map(function (w) { return w.endPrice; })) : null;
    var lastTrig = lastOf(trig);
    var recent = function (type, within) { return (an.signals || []).some(function (s) { return s.type === type && L - s.index <= within; }); };
    var cloudTop = cloud.top[L], cloudBottom = cloud.bottom[L];
    return {
      L: L, close: c, atr: num(atrArr[L]), sigma: stdev(rets),
      level: level, ctxLevel: ctxLevel, trigLevel: trigLevel,
      regime: st.regime || 'unknown', regimeProvisional: !!st.regimeProvisional, lastMajorHigh: num(st.lastMajorHigh), lastMajorLow: num(st.lastMajorLow),
      engine: st.scenario || {}, summaryText: st.summaryText || '',
      inProgress: inProgress, lastLeg: lastLeg, lastConfirmed: lastConfirmed, lastLow: lastLow, prevLow: prevLow, lastHigh: lastHigh, prevHigh: prevHigh,
      pull: pull, rally: rally, box: box, trigHigh: trigHigh, trigUp: !!(lastTrig && lastTrig.kind === 'up'),
      ma20: num(ma.m20[L]), ma60: num(ma.m60[L]), ma224: num(ma.m224[L]), ma224Prev: num(ma.m224[L - 20]),
      vol20: num(ma.v20[L]), vol60: num(ma.v60[L]), cloudTop: num(cloudTop), cloudBottom: num(cloudBottom),
      atrThen: num(atrArr[Math.max(0, L - 60)]),
      sig: { H1: recent('H1', 20), H2: recent('H2', 20), H3: recent('H3', 20), base: recent('base_breakout', 20), failed: recent('failed_rally', 20) }
    };
  }

  function cond(text, met, value) { return { text: text, met: met, value: value == null ? null : value }; }

  // ---- 시나리오 판정 ----
  function evaluate(f) {
    var c = f.close, out = {};
    var up = f.regime === 'up';
    var above224 = f.ma224 != null ? c > f.ma224 : null;
    var aboveCloud = f.cloudTop != null ? c > f.cloudTop : null;
    var lowerLow = !!(f.lastLow && f.prevLow && f.lastLow.price < f.prevLow.price);
    var lowerHigh = !!(f.lastHigh && f.prevHigh && f.lastHigh.price < f.prevHigh.price);
    var brokeSwingLow = !!(f.lastLow && c < f.lastLow.price);
    var volDry = f.pull && f.pull.volRatio != null ? f.pull.volRatio < 0.8 : null;
    var rangeShrink = f.atr != null && f.atrThen ? f.atr < f.atrThen * 0.85 : null;
    var maTight = f.ma20 != null && f.ma60 != null ? Math.abs(f.ma20 / f.ma60 - 1) < 0.03 : null;
    var volDown = f.vol20 != null && f.vol60 ? f.vol20 < f.vol60 * 0.9 : null;

    // 상승 추세 훼손: 대파동 구조가 훼손됐거나, 상승 구조에서 확정된 스윙 저점을 종가로 이탈
    var bdMatched = f.regime === 'up_broken' || (up && brokeSwingLow);
    out.breakdown = {
      matched: bdMatched,
      conditions: [
        cond('대파동 상승 구조가 훼손(직전 대파동 저점 종가 이탈)', f.regime === 'up_broken'),
        cond('확정된 스윙 저점을 종가로 이탈', f.lastLow ? brokeSwingLow : null, f.lastLow && round(f.lastLow.price)),
        cond('고점이 낮아짐(Lower High)', f.prevHigh ? lowerHigh : null),
        cond('저점이 낮아짐(Lower Low)', f.prevLow ? lowerLow : null),
        cond('224일선 아래', above224 == null ? null : !above224),
        cond('구름대 아래', aboveCloud == null ? null : !aboveCloud)
      ],
      watch: { up: f.lastLow ? { price: round(f.lastLow.price), text: '이탈한 스윙 저점을 종가로 되찾으면 훼손 해소 시도' } : null, down: null },
      invalidate: f.lastLow ? { price: round(f.lastLow.price), dir: 'up', text: '종가가 이 가격 위로 회복하면 훼손 시나리오 약화' } : null
    };

    // 가짜 상승: 하락·횡보 구조의 반등이 저항을 못 넘고 시작 저점을 이탈
    var rallyWeak = f.rally && f.rally.volRatio != null ? f.rally.volRatio < 0.9 : null;
    var downish = f.regime === 'down' || f.regime === 'range' || f.regime === 'expansion' || f.regime === 'unknown' || f.regime === 'down_recovering';
    var fkMatched = !!(f.engine.D || f.sig.failed || (downish && f.rally && f.lastMajorHigh != null && c < f.lastMajorHigh && f.rally.volRatio != null && f.rally.volRatio < 0.9));
    out.fakeRally = {
      matched: fkMatched,
      conditions: [
        cond('대파동이 하락·횡보 구조', downish),
        cond('최근 상승(반등)이 직전 대파동 고점 아래', f.rally && f.lastMajorHigh != null ? c < f.lastMajorHigh : null, f.lastMajorHigh && round(f.lastMajorHigh)),
        cond('반등 구간 거래량이 직전 하락 구간보다 적음', rallyWeak),
        cond('반등 시작 저점 이탈(반등 실패 신호가 최근 20봉 안에 발생)', f.sig.failed || !!f.engine.D)
      ],
      watch: { up: f.lastMajorHigh != null ? { price: round(f.lastMajorHigh), text: '직전 대파동 고점을 종가로 넘으면 반등 실패 시나리오 약화' } : null,
        down: f.rally ? { price: round(f.rally.startPrice), text: '반등 시작 가격을 종가로 이탈하면 반등 실패 확인' } : null },
      invalidate: f.lastMajorHigh != null ? { price: round(f.lastMajorHigh), dir: 'up', text: '종가가 직전 대파동 고점 위로 올라서면 무효' } : null
    };

    // 횡보·에너지 응축: 진행 중인 박스(안쪽 파동 3개 이상 = 엔진의 시나리오 E)
    var cpMatched = !!(f.engine.E || (f.box && (f.box.childIds || []).length >= 3));
    out.compression = {
      matched: cpMatched,
      conditions: [
        cond('가격 박스 진행 중(안쪽 파동 3개 이상)', cpMatched, f.box ? f.box.end - f.box.start + 1 : null),
        cond('최근 변동폭(ATR)이 60봉 전보다 줄어듦', rangeShrink),
        cond('20일선·60일선 밀집(3% 이내)', maTight),
        cond('거래량 감소(20일 평균이 60일 평균의 90% 미만)', volDown),
        cond('224일선 위', above224),
        cond('구름대 위', aboveCloud)
      ],
      watch: f.box ? { up: { price: round(f.box.high), text: '박스 상단을 종가로 돌파하면 상방 변동성 확대' }, down: { price: round(f.box.low), text: '박스 하단을 종가로 이탈하면 하방 변동성 확대' } } : { up: null, down: null },
      invalidate: null
    };

    // 정상 눌림목: 상승 구조에서 조정 진행, 직전 스윙 저점 위·대파동 저점 위
    var holdsLow = f.pull && f.lastLow ? f.pull.low > f.lastLow.price : (f.pull ? true : null);
    var holdsMajor = f.lastMajorLow != null ? c >= f.lastMajorLow : null;
    var pbMatched = !!(up && ((f.pull && holdsLow !== false && holdsMajor !== false) || f.engine.A));
    var turnTry = f.trigUp;
    out.pullback = {
      matched: pbMatched,
      conditions: [
        cond('대파동 상승 구조', up),
        cond('조정 진행 중(' + levelName(f.level) + ' 하락 파동)', !!f.pull, f.pull && f.pull.retrace != null ? round(f.pull.retrace) : null),
        cond('직전 스윙 저점 위에서 조정 중', holdsLow, f.lastLow && round(f.lastLow.price)),
        cond('대파동 저점 위', holdsMajor, f.lastMajorLow && round(f.lastMajorLow)),
        cond('조정 구간 거래량 감소(직전 상승 구간 대비 80% 미만)', volDry, f.pull && f.pull.volRatio != null ? round(f.pull.volRatio) : null),
        cond('하위 파동(' + levelName(f.trigLevel) + ') 상승 전환 시도', turnTry)
      ],
      watch: {
        up: f.trigHigh != null ? { price: round(f.trigHigh), text: '최근 ' + levelName(f.trigLevel) + ' 고점을 종가로 돌파하면 재상승 조건 강화' }
          : (f.pull ? { price: round(f.pull.high), text: '조정 시작 고점을 종가로 회복하면 재상승 조건 강화' } : null),
        down: f.pull ? { price: round(f.pull.low), text: '조정 저점을 종가로 이탈하면 조정 연장 또는 추세 훼손' } : null
      },
      invalidate: f.lastLow ? { price: round(f.lastLow.price), dir: 'down', text: '직전 스윙 저점을 종가로 이탈하면 정상 눌림 시나리오 무효' } : (f.pull ? { price: round(f.pull.low), dir: 'down', text: '조정 저점 이탈 시 무효' } : null)
    };

    // 상승 지속·재상승: 상승 구조에서 상승 파동 진행 중이거나 눌림 저점 지지 후 상승 전환
    var upLeg = f.inProgress && f.inProgress.kind === 'up';
    var hl = !!(f.lastLow && f.lastLow.struct === 'HL');
    var ctMatched = !!(up && !bdMatched && (upLeg || f.engine.B || f.sig.H2 || f.sig.H3 || f.sig.base));
    out.continuation = {
      matched: ctMatched,
      conditions: [
        cond('대파동 상승 구조 유지', up),
        cond(levelName(f.level) + ' 상승 파동 진행 중', !!upLeg),
        cond('저점 상승(Higher Low) 확인', f.lastLow ? hl : null, f.lastLow && round(f.lastLow.price)),
        cond('눌림 저점 지지 후 ' + levelName(f.trigLevel) + ' 상승 전환', !!f.engine.B),
        cond('224일선 위(상승 중)', above224 == null ? null : (above224 && (f.ma224Prev == null || f.ma224 >= f.ma224Prev))),
        cond('구름대 위', aboveCloud),
        cond('224일선·구름대 돌파 후 저점 상승(신호 H3/바닥 돌파)', f.sig.H3 || f.sig.base)
      ],
      watch: {
        up: f.lastHigh ? { price: round(f.lastHigh.price), text: '직전 스윙 고점을 종가로 넘으면 고점 갱신(상승 지속 확인)' } : null,
        down: f.lastLow ? { price: round(f.lastLow.price), text: '직전 스윙 저점을 종가로 이탈하면 상승 구조 약화' } : null
      },
      invalidate: f.lastLow ? { price: round(f.lastLow.price), dir: 'down', text: '직전 스윙 저점을 종가로 이탈하면 무효' } : null
    };
    return out;
  }

  function levelName(level) { return { major: '대파동', medium: '중파동', minor: '소파동' }[level] || level; }

  function stateText(f) {
    function txt(level) {
      var legs = legsOf(f._an, level), w = lastOf(legs);
      if (!w) return '미확정';
      var dir = w.kind === 'up' ? '상승' : '하락';
      return w.confirmed ? (w.label || dir) : (w.kind === 'up' ? '상승 진행' : '조정 진행');
    }
    return { major: REGIME_TEXT[f.regime] ? REGIME_TEXT[f.regime].replace(/^대 /, '') : f.regime, medium: txt('medium'), minor: txt('minor') };
  }

  // ---- 본체 ----
  // bars: 오름차순 일봉, an: AutoWave.analyze(bars) 결과(없으면 직접 계산). opts.level: 'major'|'medium'(기본)|'minor'
  function forecast(bars, an, opts) {
    opts = opts || {};
    var A = AW();
    if (!A) return null;
    var level = LEVEL_ORDER.indexOf(opts.level) >= 0 ? opts.level : 'medium';
    // 과거 시점 재현: asOfIndex 까지의 봉만 쓴다. 분석 결과(an)가 전체 자료로 만든 것일 수 있으므로 버리고 그 봉까지의 자료로 다시 계산한다.
    if (bars && opts.asOfIndex != null && opts.asOfIndex < bars.length - 1) { bars = bars.slice(0, opts.asOfIndex + 1); an = null; }
    if (!bars || bars.length < 60) return { modelVersion: MODEL_VERSION, insufficient: true, reason: '일봉이 60개 미만이라 분석하지 않습니다.' };
    an = an || A.analyze(bars);
    if (!an || !an.state) return { modelVersion: MODEL_VERSION, insufficient: true, reason: '파동 분석 결과가 없습니다.' };
    var f = features(bars, an, level);
    f._an = an;
    var verdicts = evaluate(f);
    var primary = null, candidates = [];
    PRIORITY.forEach(function (id) { if (verdicts[id].matched) { if (!primary) primary = id; else candidates.push(id); } });
    var asOf = bars[f.L];
    var st = stateText(f);
    var scenarios = PRIORITY.map(function (id) {
      var v = verdicts[id], meta = SCENARIOS[id];
      return { id: id, name: meta.name, side: meta.side, headline: meta.headline, matched: v.matched, primary: id === primary,
        conditions: v.conditions, watch: v.watch, invalidate: v.invalidate };
    });
    var sigma = f.sigma;
    var bands = HORIZONS.map(function (h) {
      if (sigma == null) return { h: h, low: null, high: null };
      var s = sigma * Math.sqrt(h);
      return { h: h, low: round(f.close * Math.exp(-s)), high: round(f.close * Math.exp(s)) };
    });
    var evidence = [];
    if (f.ma224 != null) evidence.push('종가 ' + (f.close > f.ma224 ? '224일선 위' : '224일선 아래') + (f.ma224Prev != null ? '(224일선 ' + (f.ma224 >= f.ma224Prev ? '상승' : '하락') + ' 중)' : ''));
    if (f.cloudTop != null) evidence.push('종가 ' + (f.close > f.cloudTop ? '구름대 위' : (f.cloudBottom != null && f.close < f.cloudBottom ? '구름대 아래' : '구름대 안')));
    if (f.lastMajorLow != null || f.lastMajorHigh != null) evidence.push('직전 대파동 ' + (f.lastMajorHigh != null ? '고점 ' + round(f.lastMajorHigh) : '') + (f.lastMajorHigh != null && f.lastMajorLow != null ? ' · ' : '') + (f.lastMajorLow != null ? '저점 ' + round(f.lastMajorLow) : ''));
    (primary ? verdicts[primary].conditions : []).forEach(function (c) { if (c.met === true) evidence.push(c.text + (c.value != null ? ' (' + c.value + ')' : '')); });
    var chosen = primary ? scenarios.filter(function (s) { return s.primary; })[0] : null;
    var triggers = [];
    if (chosen) {
      if (chosen.watch && chosen.watch.up) triggers.push({ when: '종가 ' + chosen.watch.up.price + ' 위', then: chosen.watch.up.text });
      if (chosen.watch && chosen.watch.down) triggers.push({ when: '종가 ' + chosen.watch.down.price + ' 아래', then: chosen.watch.down.text });
      triggers.push({ when: '위 조건이 모두 충족되지 않으면', then: '현재 시나리오(' + chosen.name + ') 유지, 새 봉이 들어올 때마다 다시 판정' });
    }
    return {
      modelVersion: MODEL_VERSION, engineVersion: an.version || null, level: level,
      asOfIndex: f.L, asOfDate: asOf.date, signalDate: asOf.date, forecastHorizons: HORIZONS.slice(), dataFingerprint: an.dataHash || null,
      close: f.close, atr: f.atr, sigma: sigma == null ? null : Math.round(sigma * 10000) / 10000,
      state: { major: st.major, medium: st.medium, minor: st.minor, regime: f.regime, regimeProvisional: f.regimeProvisional, summary: f.summaryText },
      primary: primary, candidates: candidates, scenarios: scenarios, evidence: evidence, triggers: triggers,
      observe: { bars: HORIZONS.slice(), confirmDelay: CONFIRM_DELAY[level], text: levelName(level) + ' 극점은 되돌림이 확인된 뒤(중앙값 약 ' + CONFIRM_DELAY[level] + '봉 뒤) 확정되므로 5·10·20거래일 단위로 조건 충족 여부를 지켜봅니다.' },
      bands: bands, bandNote: '일일 변동률(최근 60봉) × √거래일 기준 1σ 참고선 - 방향이 아니라 흔들림 크기',
      levels: levelList(f, verdicts, primary)
    };
  }

  // 화면에 줄로 그릴 가격대(주 시나리오의 확인·무효화 가격 + 지지·저항 참고)
  function levelList(f, verdicts, primary) {
    var out = [];
    if (!primary) return out;
    var v = verdicts[primary];
    if (v.watch && v.watch.up) out.push({ price: v.watch.up.price, kind: 'confirm', label: '확인 ' + v.watch.up.price });
    if (v.watch && v.watch.down) out.push({ price: v.watch.down.price, kind: 'risk', label: '이탈 ' + v.watch.down.price });
    if (v.invalidate && !out.some(function (l) { return l.price === v.invalidate.price; })) out.push({ price: v.invalidate.price, kind: 'invalid', label: '무효화 ' + v.invalidate.price });
    return out;
  }

  // ---- 통계 표 결합: 검증 문턱을 통과한 칸만 숫자를 보여 준다 ----
  // 연구(scripts/analysis/wave_forecast_study.py)의 표시 문턱과 같은 값 - 통계 표의 gate 가 이 문턱으로 계산돼 온다.
  var GATE = { minSamples: 200, minValidationSamples: 100, zValidation: 2.9, zDevelopment: 2.0 };

  function attachStats(fc, table) {
    if (!fc || !fc.scenarios) return fc;
    var rows = {};
    fc.scenarios.forEach(function (s) {
      rows[s.id] = HORIZONS.map(function (h) {
        var cell = table && table.scenarios && table.scenarios[s.id] && table.scenarios[s.id]['h' + h];
        if (!cell) return { h: h, shown: false, reason: '통계 없음' };
        var gate = cell.gate || { passed: false, reasons: ['검증 정보 없음'] };
        if (!gate.passed) return { h: h, shown: false, n: cell.n, nVal: cell.nVal, reason: gate.reasons.join(' · ') || '검증 미통과' };
        return { h: h, shown: true, n: cell.n, nVal: cell.nVal, up: cell.up, down: cell.down, median: cell.median, p10: cell.p10, p90: cell.p90, mfe: cell.mfe, mae: cell.mae,
          baselineUp: cell.baselineUp, success: cell.success, failure: cell.failure, net: cell.net };
      });
    });
    fc.stats = { rows: rows, meta: table ? { period: table.period, universe: table.universe, generated: table.generated, engineVersion: table.engineVersion, modelVersion: table.modelVersion, note: table.note } : null,
      stale: !!(table && table.modelVersion && table.modelVersion !== fc.modelVersion) };
    return fc;
  }

  var api = { MODEL_VERSION: MODEL_VERSION, HORIZONS: HORIZONS, SCENARIOS: SCENARIOS, PRIORITY: PRIORITY, GATE: GATE, CONFIRM_DELAY: CONFIRM_DELAY,
    forecast: forecast, attachStats: attachStats, features: features, evaluate: evaluate, levelName: levelName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.WaveForecast = api;
})(typeof window !== 'undefined' ? window : globalThis);
