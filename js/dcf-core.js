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
  function accepted(item) { return item && item.value !== null && Number.isFinite(item.value) && (item.status === 'auto' || item.status === 'user' || item.status === 'estimate'); }
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

  // Automatic model is isolated from the untouched public disclosure draft.
  // Review candidates pass only receipt/unit/account checks, never a checkbox.
  function analyze(draft, now) {
    var notes = [], missingKeys = [], company = draft.company;
    var reportAge = (now || Date.now()) - Date.parse(draft.generatedAt);
    function blocked(reason) { return { ok: false, classification: '자동 평가 불가', reason: reason,
      missing: missingKeys, notes: notes, scenarios: [], model: null }; }
    if (!company) return blocked('종목을 검색하고 검색 결과에서 선택하세요.');
    if (company.kind === 'financial' || company.kind === 'spac' || company.kind === 'holding' || company.shareClass === 'preferred')
      return blocked('금융업·스팩·지주회사·우선주는 일반 FCFF 모형으로 자동 평가하지 않습니다. 별도 가치 배분 모형이 필요합니다.');
    if (!Number.isFinite(reportAge) || reportAge < -86400000 || reportAge > 45 * 86400000)
      return blocked('최신 정적 공시 자료가 없거나 수집 기준일이 45일을 넘었습니다.');
    if (draft.baseYear !== Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date(now || Date.now()))) - 1)
      return blocked('최근 완료 연도의 사업보고서가 아닙니다.');
    var supplement = draft.supplement, validSupplement = supplement && supplement.schemaVersion === 1 &&
      supplement.code === company.sourceCode && supplement.basis === draft.basis && supplement.year === draft.baseYear &&
      supplement.receipt === (draft.years[4].report || {}).rcept_no &&
      supplement.revenue === field(draft.years[4], 'revenue').value && supplement.ebit === field(draft.years[4], 'ebit').value && Number.isFinite(supplement.debt) && supplement.debt>=0 && Number.isFinite(supplement.minority) && supplement.minority>=0;
    var names = { ebit: ['영업이익','영업이익(손실)'], revenue:['매출액','수익(매출액)'],
      depreciation:['감가상각비'], amortisation:['무형자산상각비'], daCombined:['감가상각 및 무형자산상각비'],
      ppeCapex:['유형자산의 취득'], intangibleCapex:['무형자산의 취득'], receivables:['매출채권'], inventory:['재고자산'], payables:['매입채무'],
      pretax:['법인세비용차감전순이익'], taxExpense:['법인세비용'], cash:['현금및현금성자산'] };
    function usable(row, key) {
      var item = field(row,key);
      if (!Number.isFinite(item.value) || item.value == null) return null;
      if (item.status === 'user') return item.value;
      if (!row.report || !/^\d{14}$/.test(row.report.rcept_no)) return null;
      var sources = item.sources || [];
      if (!sources.length || !sources.every(function (s) { return s.rcept_no === row.report.rcept_no && s.currency === 'KRW'; })) return null;
      if (item.status === 'auto' || (item.status === 'review' && sources.length === 1 && (names[key] || []).indexOf(sources[0].account_nm) !== -1)) return item.value;
      return null;
    }
    function median(values) { if (!values.length) return null; values=values.slice().sort(function(a,b){return a-b;}); var i=Math.floor(values.length/2);return values.length%2?values[i]:(values[i-1]+values[i])/2; }
    function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
    function estimated(v,reason){ return cell(v,'estimate',reason); }
    var taxRates = draft.years.map(function(r){var t=usable(r,'taxExpense'),p=usable(r,'pretax');return t!=null&&p>0&&t/p>=0&&t/p<=1?t/p:null;}).filter(function(v){return v!=null;});
    var tax = taxRates.length >= 3 ? clamp(median(taxRates),.15,.30) : .25;
    if (accepted(draft.assumptions.taxRate)) tax=draft.assumptions.taxRate.value;
    if (tax<0 || tax>1) return blocked('정상 세율은 0~100% 범위여야 합니다.');
    notes.push('정상 세율: 수익 발생 연도 실효세율 중앙값을 15~30%로 제한; 3년 미만이면 모형 가정 25%. 과거 공시 세율을 변경하지 않습니다.');
    var model=copy(draft), history=[], valid=0, total=0;
    var priorNwc = draft.priorNwc && draft.priorNwc.value;
    var priorValid = draft.priorNwc && draft.priorNwc.sources && draft.priorNwc.sources.length === 3 &&
      draft.priorNwc.sources.every(function(s){return s.currency==='KRW'&&/^\d{14}$/.test(s.rcept_no||'');});
    draft.years.forEach(function(r,i){
      var e=usable(r,'ebit'), dep=usable(r,'depreciation'), amort=usable(r,'amortisation'),da=usable(r,'daCombined');
      if(da==null && dep!=null && amort!=null) da=dep+amort;
      var extra=validSupplement && supplement.years && supplement.years[String(r.year)];
      if(da==null && extra && extra.receipt===(r.report||{}).rcept_no && extra.revenue===field(r,'revenue').value && Number.isFinite(extra.da) && extra.da>=0) da=extra.da;
      if(field(r,'da').status==='user') da=field(r,'da').value;
      var pc=usable(r,'ppeCapex'),ic=usable(r,'intangibleCapex'),capex=pc!=null&&ic!=null?Math.abs(pc)+Math.abs(ic):null;
      if(field(r,'capex').status==='user')capex=field(r,'capex').value;
      else if(extra && extra.receipt===(r.report||{}).rcept_no && capex!=null && Number.isFinite(extra.leaseCapex) && extra.leaseCapex>=0)capex+=extra.leaseCapex;
      var ar=usable(r,'receivables'), inv=usable(r,'inventory'), ap=usable(r,'payables');
      var nwc=ar!=null&&inv!=null&&ap!=null?ar+inv-ap:null;
      if(field(r,'nwc').status==='user')nwc=field(r,'nwc').value;
      var delta=nwc!=null&&priorValid&&priorNwc!=null?nwc-priorNwc:null;
      if(field(r,'deltaNwc').status==='user')delta=field(r,'deltaNwc').value;
      [['영업이익',e],['감가상각·상각비',da],['CAPEX',capex],['운전자본 증가액',delta]].forEach(function(pair){total++;if(pair[1]!=null)valid++;else missingKeys.push(r.year+' '+pair[0]);});
      var fcff=e!=null&&da!=null&&capex!=null&&delta!=null&&da>=0&&capex>=0?e*(1-tax)+da-capex-delta:null;
      history.push({year:r.year,value:fcff,inputs:{ebit:e,da:da,capex:capex,deltaNwc:delta,taxRate:tax}});
      model.years[i].fields.fcff=estimated(fcff,'정상 세율·영업운전자본 대용치를 적용한 FCFF 모형값');
      priorNwc=nwc;priorValid=nwc!=null;
    });
    var completeness=valid/total;
    if(validSupplement)notes.push(supplement.leaseCapexProxy ? '리스 재투자 추정: 금융활동 주석의 리스부채 증가를 신규 리스 재투자 대용치로 모형 CAPEX에 더합니다. 변경 계약 등의 영향이 포함될 수 있으며 실제 현금 지출과 구별합니다.' : '리스 금융부채 처리: 사용권자산 감가상각이 포함되므로 신규 리스계약의 사용권자산 취득액도 모형 CAPEX에 더합니다. 공시 현금 CAPEX 원본은 유지합니다.');
    notes.push('운전자본 모형: 매출채권+재고−매입채무. 기타 영업자산·부채와 비현금 변동은 포함하지 않는 대용치입니다.');
    var recent=history.slice(-3).map(function(r){return r.value;});
    if(recent.some(function(v){return v==null;}))return Object.assign(blocked('최근 3년 FCFF의 핵심 공시 구성값이 부족합니다: '+missingKeys.slice(-8).join(', ')),{history:history,completeness:completeness});
    if(recent[2]<=0 || median(recent)<=0)return Object.assign(blocked('최근 FCFF가 음수이거나 정상화 현금흐름이 양수가 아닙니다. 회복을 임의로 가정하지 않습니다.'),{history:history,completeness:completeness});
    var latest=draft.years[4], debt=usable(latest,'debt'), cash=usable(latest,'cash'), minority=usable(latest,'nonControllingInterests');
    if(validSupplement){debt=supplement.debt;minority=supplement.minority;}
    var netDebt=debt!=null&&cash!=null&&minority!=null?debt-cash+minority:null;
    var allocation = validSupplement && supplement.allocation;
    var sf=draft.shareFields, issued=(sf.issuedShares||{}).value,treasury=(sf.treasuryShares||{}).value,shares=(sf.shares||{}).value;
    var shareOK=Number.isFinite(issued)&&Number.isFinite(treasury)&&issued>0&&treasury>=0&&issued-treasury===shares&&
      ['issuedShares','treasuryShares','shares'].every(function(k){return (sf[k].sources||[]).length===1&&sf[k].sources[0].rcept_no===(latest.report||{}).rcept_no&&sf[k].sources[0].originalUnit==='주';});
    if(!shareOK)shares=null;
    if(company.hasOtherShares){
      if(!allocation || allocation.common!==shares || !Number.isFinite(allocation.preferred) || allocation.preferred<0)shares=null;
      else {shares+=allocation.preferred;notes.push('보통주·우선주 경제적 가치 동일 배분 가정. 두 종류 유통주식 합계로 나누며 의결권·추가배당 차이와 미래 희석은 미반영.');}
    } else notes.push('주식 수: 사업보고서 발행−자기주식 대조. 기준일 이후 증자·희석은 미반영.');
    if(accepted(draft.assumptions.netDebt)&&draft.assumptions.netDebt.status==='user')netDebt=draft.assumptions.netDebt.value;
    if(accepted(draft.assumptions.shares)&&draft.assumptions.shares.status==='user')shares=draft.assumptions.shares.value;
    if(netDebt==null || shares==null || shares<=0)return Object.assign(blocked('순차입금·리스 포함 총차입금·비지배지분·주식 권리 배분의 검증 자료가 부족합니다. 누락 부채를 0으로 처리하지 않습니다.'),{history:history,completeness:completeness});
    notes.push('지분가치 조정: 이자부차입금(리스 포함)−현금+비지배지분 장부금액. 투자자산은 별도 가산하지 않는 보수적 모형입니다.');
    var growths=[];
    ['revenue','ebit'].forEach(function(k){var changes=[];for(var i=1;i<5;i++){var before=usable(draft.years[i-1],k),after=usable(draft.years[i],k);if(before>0&&after>0)changes.push(clamp(after/before-1,-.2,.2));}if(changes.length>=2)growths.push(median(changes));});
    var fcChanges=[];for(var h=1;h<5;h++){if(history[h-1].value>0&&history[h].value>0)fcChanges.push(clamp(history[h].value/history[h-1].value-1,-.2,.2));}
    if(fcChanges.length>=2)growths.push(median(fcChanges));
    var growth=clamp(growths.length?median(growths)*.5:0,-.03,.10);
    var base=(recent[2]+median(recent))/2;
    notes.push('미래 FCFF: 최근 3년 중앙값과 최신값의 평균에서 시작. 매출·영업이익·양수 FCFF 증가율은 ±20% 제한 후 중앙값·50% 축소, 최종 −3~10%로 제한. 일회성 항목은 완전히 제거할 수 없습니다.');
    var assumptions=model.assumptions;
    function defaultValue(k,v,reason){if(!assumptions[k]||assumptions[k].status!=='user')assumptions[k]=estimated(v,reason);}
    defaultValue('wacc',.10,'측정 WACC가 아닌 고정 시나리오 할인율 10%; 무위험수익률·베타·시장 프리미엄·부채비용 미확보');
    defaultValue('terminalGrowth',.02,'장기 성장 모형 가정 2%');
    defaultValue('growth',growth,'과거 증가율 중앙값 제한·정상화');
    defaultValue('taxRate',tax,'정상 세율 모형 가정');
    defaultValue('netDebt',netDebt,'리스 포함 차입금−현금+비지배지분 장부금액');
    defaultValue('shares',shares,'사업보고서 유통주식 기준·종류주식 배분 가정');
    defaultValue('forecastMode',1,'자동 정상화 FCFF 5년 추정');
    for(var f=1;f<=5;f++)defaultValue('forecast'+f,base*Math.pow(1+assumptions.growth.value,f),'정상화 FCFF 성장 모형');
    var result=evaluate(model,'model',now);
    if(!result.ok)return Object.assign(blocked(result.reason),{history:history,completeness:completeness,model:model});
    var scenarios=[{name:'보수적',wacc:assumptions.wacc.value+.02,g:Math.max(-.01,assumptions.terminalGrowth.value-.01),growth:assumptions.growth.value-.02,base:.85},
      {name:'기본',wacc:assumptions.wacc.value,g:assumptions.terminalGrowth.value,growth:assumptions.growth.value,base:1},
      {name:'낙관적',wacc:assumptions.wacc.value-.01,g:assumptions.terminalGrowth.value+.005,growth:assumptions.growth.value+.02,base:1.15}].map(function(s){
        var d=copy(model);d.assumptions.wacc=estimated(s.wacc,'시나리오');d.assumptions.terminalGrowth=estimated(s.g,'시나리오');
        if(!(draft.assumptions.forecastMode&&draft.assumptions.forecastMode.status==='user'))for(var j=1;j<=5;j++)d.assumptions['forecast'+j]=estimated(result.forecast[j-1]*s.base*Math.pow((1+s.growth)/(1+assumptions.growth.value),j),'시나리오 민감도');
        return Object.assign(s,evaluate(d,'model',now));
      });
    if(scenarios.some(function(s){return !s.ok;}))notes.push('일부 시나리오 할인율·성장률 조건이 유효하지 않아 그 결과는 표시하지 않습니다.');
    return Object.assign(result,{classification:'추정 포함 계산',model:model,scenarios:scenarios,history:history,notes:notes,missing:missingKeys,completeness:completeness,
      estimateDependence:'정상 세율·운전자본 범위·미래 FCFF·할인율·성장률·지분 조정·주식 배분에 모형 가정 포함',reason:'공시 기반 재무값과 명시적인 자동 가정을 사용한 시나리오 분석'});
  }

  var api = { analyze: analyze, numeric: numeric, scale: SCALE, cell: cell, field: field, accepted: accepted, recalculate: recalculate,
    blank: blank, autoDraft: autoDraft, edit: edit, restore: restore, setAssumption: setAssumption, evaluate: evaluate, search: search, state: state };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DcfCore = api;
}(typeof window !== 'undefined' ? window : globalThis));
