/* Pure FCFF arithmetic and isolated drafts. No network or DOM dependencies. */
(function (global) {
  'use strict';
  var SCALE = { '원': 1, '천원': 1000, '백만원': 1000000, '억원': 100000000 };
  function numeric(value) {
    if (value == null || String(value).trim() === '') return null;
    var text = String(value).trim().replace(/,/g, '');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    var n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function cell(value, status, reason) { return { value: value == null ? null : value, status: status || 'missing', reason: reason || '', sources: [] }; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function missing() { return cell(null); }
  function field(row, key) { return row.fields[key] || missing(); }
  function accepted(item) { return item && item.value !== null && Number.isFinite(item.value) && (item.status === 'auto' || item.status === 'user'); }
  function combine(items, compute, reason) {
    if (items.some(function (item) { return item.value == null; })) return cell(null, 'missing', '구성 항목 미확보');
    var value = compute.apply(null, items.map(function (item) { return item.value; }));
    if (value == null || !Number.isFinite(value)) return cell(null, 'missing', '계산 범위 확인 필요');
    var result = cell(value, items.every(accepted) ? 'auto' : 'review', reason);
    result.sources = items.reduce(function (list, item) { return list.concat(item.sources || []); }, []);
    result.inputs = items.map(function (item) { return item.value; });
    result.formula = reason || '구성 항목 합계 또는 차이';
    return result;
  }
  function recalculate(draft) {
    draft.years.sort(function (a, b) { return a.year - b.year; });
    draft.years.forEach(function (row, i) {
      var f = row.fields;
      function update(key, keys, compute, review) {
        if (f[key] && f[key].status === 'user') return;
        f[key] = combine(keys.map(function (k) { return field(row, k); }), compute);
        if (review && f[key].value !== null) { f[key].status = 'review'; f[key].reason = '해석·범위 수동 확인 필요'; }
      }
      if (f.daCombined || f.depreciation || f.amortisation) {
        if (!f.da || f.da.status !== 'user') {
          var splitAdjusted = ['depreciation', 'amortisation'].some(function (k) { return f[k] && f[k].status === 'user'; });
          if (!splitAdjusted && f.daCombined && f.daCombined.value !== null) f.da = copy(f.daCombined);
          else update('da', ['depreciation', 'amortisation'], function (a, b) { return a + b; });
        }
      }
      if (f.ppeCapex || f.intangibleCapex) update('capex', ['ppeCapex', 'intangibleCapex'], function (a, b) { return Math.abs(a) + Math.abs(b); });
      if (f.taxExpense || f.pretax) update('taxRate', ['taxExpense', 'pretax'], function (t, p) { return p > 0 && t / p >= 0 && t / p <= 1 ? t / p : null; }, true);
      if (f.receivables || f.inventory || f.payables) update('nwc', ['receivables', 'inventory', 'payables'], function (a, b, c) { return a + b - c; }, true);
      if (f.shortDebt || f.longDebt) update('debt', ['shortDebt', 'longDebt', 'currentLongDebt', 'bonds', 'currentBonds', 'leaseDebt', 'currentLeaseDebt'], function () { return Array.from(arguments).reduce(function (sum, v) { return sum + v; }, 0); }, true);
      // Directly adjusted derived fields take precedence; upstream edits otherwise
      // recompute dependants, so FCFF never uses an old delta or tax candidate.
      if (!f.deltaNwc || f.deltaNwc.status !== 'user') {
        var prev = i ? draft.years[i - 1] : null;
        var prior = prev && prev.year === row.year - 1 && prev.basis === row.basis ? field(prev, 'nwc') : (!i ? draft.priorNwc : missing());
        f.deltaNwc = combine([field(row, 'nwc'), prior || missing()], function (a, b) { return a - b; }, '당기 NWC−전기 NWC');
      }
      f.simpleFcf = combine([field(row, 'ocf'), field(row, 'capex')], function (o, c) { return c >= 0 ? o - c : null; }, '영업현금흐름−CAPEX (FCFF와 다름)');
      f.fcff = combine(['ebit', 'taxRate', 'da', 'capex', 'deltaNwc'].map(function (k) { return field(row, k); }), function (e, t, d, c, n) {
        return t >= 0 && t <= 1 && d >= 0 && c >= 0 ? e * (1 - t) + d - c - n : null;
      }, 'EBIT×(1−세율)+D&A−CAPEX−ΔNWC');
    });
    return draft;
  }
  function blank(year) {
    return { company: null, currency: 'KRW', unit: '억원', baseYear: year,
      years: Array.from({ length: 5 }, function (_, i) { return { year: year - 4 + i, basis: 'manual', fields: {} }; }),
      priorNwc: missing(), shareFields: {}, assumptions: {}, original: null, generatedAt: null };
  }
  function autoDraft(stock, payload, year) {
    if (!payload) { var empty = blank(year); empty.company = stock; return empty; }
    if (payload.schemaVersion !== 1 || payload.code !== stock.sourceCode || payload.currency !== 'KRW' || payload.amountUnit !== '원'
        || !Array.isArray(payload.years) || payload.years.length !== 5 || !payload.shareFields
        || payload.years.some(function (r, i) { return !r.fields || r.basis !== payload.basis || r.year !== payload.years[0].year + i; })) throw new Error('정적 자료 규격·기업·연도·단위 확인 실패');
    var draft = blank(year);
    draft.company = copy(stock);
    draft.company.market = payload.market || stock.market;
    draft.years = copy(payload.years);
    draft.baseYear = draft.years[4].year;
    draft.priorNwc = copy(payload.priorNwc || missing());
    draft.shareFields = copy(payload.shareFields);
    draft.generatedAt = payload.generatedAt;
    draft.basis = payload.basis;
    draft.warnings = copy(payload.warnings || []);
    var latest = draft.years[4].fields;
    draft.assumptions = { shares: copy(draft.shareFields.shares || missing()), price: copy(payload.quote || missing()) };
    draft.assumptions.netDebt = combine([latest.debt || missing(), latest.cash || missing()], function (d, c) { return d - c; }, '이자부차입금−현금및현금성자산; 비영업자산·소수주주 조정 검토');
    draft.original = copy(draft);
    return recalculate(draft);
  }
  function edit(draft, year, key, value) {
    var row = draft.years.find(function (r) { return r.year === Number(year); });
    if (!row) throw new Error('Unknown year');
    var prior = field(row, key);
    row.fields[key] = Object.assign({}, prior, { value: numeric(value), status: 'user', reason: '사용자 조정' });
    recalculate(draft);
    if (['debt', 'cash', 'shortDebt', 'longDebt', 'currentLongDebt', 'bonds', 'currentBonds', 'leaseDebt', 'currentLeaseDebt'].indexOf(key) !== -1 && (!draft.assumptions.netDebt || draft.assumptions.netDebt.status !== 'user')) {
      var latest = draft.years[4].fields;
      draft.assumptions.netDebt = combine([latest.debt || missing(), latest.cash || missing()], function (d, c) { return d - c; });
    }
    return recalculate(draft);
  }
  function restore(draft, year, key) {
    var row = draft.years.find(function (r) { return r.year === Number(year); });
    var originalRow = draft.original && draft.original.years.find(function (r) { return r.year === Number(year); });
    row.fields[key] = copy(originalRow ? field(originalRow, key) : missing());
    recalculate(draft);
    if (['debt', 'cash'].indexOf(key) !== -1 && (!draft.assumptions.netDebt || draft.assumptions.netDebt.status !== 'user')) {
      var latest = draft.years[4].fields;
      draft.assumptions.netDebt = combine([latest.debt || missing(), latest.cash || missing()], function (d, c) { return d - c; });
    }
    return recalculate(draft);
  }
  function setAssumption(draft, key, value) { draft.assumptions[key] = cell(numeric(value), 'user', '사용자 가정'); }
  function evaluate(draft, mode, now) {
    function fail(reason) { return { ok: false, reason: reason }; }
    var company = draft.company;
    if (mode === 'auto' && !company) return fail('종목을 선택하거나 직접 입력 모드를 사용하세요.');
    if (mode === 'auto' && company) {
      if (company.kind === 'financial') return fail('일반 FCFF DCF 적용 부적합: 금융업의 자본·차입금 구조는 별도 평가가 필요합니다.');
      if (company.kind === 'spac') return fail('일반 FCFF DCF 적용 부적합: 스팩은 예치금·합병조건을 기준으로 별도 평가가 필요합니다.');
      if (company.shareClass === 'preferred') return fail('일반 FCFF DCF 적용 부적합: 우선주 권리와 보통주 가치 배분을 별도로 검토해야 합니다.');
      if (!draft.generatedAt) return fail('재무자료 부족: 정적 공시 자료가 없습니다. 직접 입력을 사용할 수 있습니다.');
      var age = (now || Date.now()) - Date.parse(draft.generatedAt);
      if (!Number.isFinite(age) || age < -86400000 || age > 45 * 86400000) return fail('오래된 정적 자료: 최신 공시 수집 후 확인하거나 직접 입력을 사용하세요.');
      if (!draft.assumptions.modelReviewed || draft.assumptions.modelReviewed.value !== 1) return fail('일부 항목 수동 확인 필요: 업종·지주회사·주식 권리·희석·소수주주 조정을 확인하세요.');
    }
    var a = draft.assumptions;
    var required = ['wacc', 'terminalGrowth', 'netDebt', 'shares'];
    if (required.some(function (k) { return !accepted(a[k]); })) return fail('필수 입력 또는 확인 필요: WACC·영구성장률·순차입금·조정 주식 수');
    if (a.shares.value <= 0 || a.wacc.value <= 0 || a.wacc.value <= a.terminalGrowth.value || a.terminalGrowth.value <= -1) return fail('WACC>영구성장률, WACC>0, 성장률>−100%, 주식 수>0 조건을 확인하세요.');
    var forecast = [];
    var explicit = a.forecastMode && a.forecastMode.value === 1;
    if (explicit) {
      for (var i = 1; i <= 5; i++) {
        if (!accepted(a['forecast' + i])) return fail('향후 5개 연도의 FCFF를 모두 입력하세요.');
        forecast.push(a['forecast' + i].value);
      }
    } else {
      var base = mode === 'manual' && a.baseFcff && a.baseFcff.value !== null ? a.baseFcff : field(draft.years[4], 'fcff');
      if (!accepted(base)) return fail('일부 항목 수동 확인 필요: EBIT·세율·D&A·CAPEX·ΔNWC 또는 기준 FCFF');
      if (!accepted(a.growth) || a.growth.value <= -1) return fail('예측 성장률을 −100% 초과로 입력하세요.');
      if (base.value <= 0) return fail('기준 FCFF가 0 이하입니다. 회복 근거를 검토하고 향후 연도별 FCFF를 직접 입력하세요.');
      for (var j = 1; j <= 5; j++) forecast.push(base.value * Math.pow(1 + a.growth.value, j));
    }
    if (forecast[4] <= 0) return fail('마지막 예측 FCFF가 0 이하이므로 영구성장 모형을 적용할 수 없습니다.');
    var pv = forecast.reduce(function (sum, f, index) { return sum + f / Math.pow(1 + a.wacc.value, index + 1); }, 0);
    var terminal = forecast[4] * (1 + a.terminalGrowth.value) / (a.wacc.value - a.terminalGrowth.value);
    var enterprise = pv + terminal / Math.pow(1 + a.wacc.value, 5);
    var equity = enterprise - a.netDebt.value;
    var perShare = equity / a.shares.value;
    if (![enterprise, equity, perShare].every(Number.isFinite)) return fail('입력 크기 또는 할인율 범위를 확인하세요.');
    return { ok: true, forecast: forecast, enterprise: enterprise, equity: equity, perShare: perShare,
      upside: accepted(a.price) && a.price.value > 0 ? (perShare / a.price.value - 1) * 100 : null,
      warning: equity <= 0 ? '지분가치가 0 이하입니다. 가정과 순차입금을 재검토하세요.' : '' };
  }
  function search(stocks, query) {
    var q = String(query).toLowerCase().replace(/\s/g, '');
    if (!q) return [];
    return stocks.filter(function (s) { return s.name.toLowerCase().replace(/\s/g, '').indexOf(q) !== -1 || s.code.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) {
        function rank(s) { return s.code.toLowerCase() === q || s.name.toLowerCase().replace(/\s/g, '') === q ? 0 : (s.shareClass === 'preferred' ? 2 : 1); }
        return rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko');
      }).slice(0, 20);
  }
  function state(year) {
    var s = { mode: 'auto', manual: blank(year), auto: blank(year), saved: {}, token: 0 };
    s.current = function () { return s[s.mode]; };
    s.switchMode = function (mode) { s.token++; s.mode = mode; return s.current(); };
    s.select = function (stock) {
      if (s.auto.company) s.saved[s.auto.company.code] = s.auto;
      s.token++;
      s.auto = s.saved[stock.code] || autoDraft(stock, null, year);
      return s.token;
    };
    s.resolve = function (token, stock, payload) {
      if (token !== s.token || s.mode !== 'auto' || !s.auto.company || s.auto.company.code !== stock.code) return false;
      if (!s.auto.generatedAt) s.auto = autoDraft(stock, payload, year);
      return true;
    };
    return s;
  }
  var api = { numeric: numeric, scale: SCALE, cell: cell, field: field, accepted: accepted, recalculate: recalculate,
    blank: blank, autoDraft: autoDraft, edit: edit, restore: restore, setAssumption: setAssumption, evaluate: evaluate, search: search, state: state };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DcfCore = api;
}(typeof window !== 'undefined' ? window : globalThis));
