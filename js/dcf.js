/* 9Pay DCF: static issuer archive only. No production VM/GAS requests. */
(function (global) {
  'use strict';
  var root = document.getElementById('dcf');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = '1';
  var C = global.DcfCore;
  var base = root.dataset.assetBase || 'https://goodbyestarwars.github.io/tistory-ticker/';
  var year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date())) - 1;
  var state = C.state(year), index = null, loading = false, controller = null, message = '', results = [], active = -1;
  var LABELS = { auto: '자동 확인', user: '사용자 조정', review: '확인 필요', missing: '미확보' };
  var FIELDS = [
    ['revenue', '매출액'], ['ebit', '영업이익 (EBIT 근사)'], ['pretax', '세전이익'], ['taxExpense', '법인세비용'], ['taxPaid', '납부법인세 (환급 포함)'],
    ['taxRate', '정상 세율 (%)'], ['da', '감가상각·상각비'], ['capex', 'CAPEX (지출 양수)'], ['nwc', '순영업운전자본'],
    ['deltaNwc', '순영업운전자본 증가액'], ['ocf', '영업현금흐름'], ['cash', '현금및현금성자산'], ['debt', '이자부 차입금'],
    ['simpleFcf', '영업현금흐름−CAPEX'], ['fcff', 'FCFF']
  ];
  var COMPONENTS = [['depreciation', '감가상각비'], ['amortisation', '무형자산상각비'], ['ppeCapex', '유형자산 취득'], ['intangibleCapex', '무형자산 취득'],
    ['receivables', '채권 후보'], ['inventory', '재고자산'], ['payables', '채무 후보'], ['shortDebt', '단기차입금'], ['longDebt', '장기차입금'],
    ['currentLongDebt', '유동성장기차입금'], ['bonds', '사채'], ['currentBonds', '유동성사채'], ['leaseDebt', '리스부채'], ['currentLeaseDebt', '유동리스부채']];
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(value) { return value == null ? '미확보' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 }); }
  function coverageText() {
    if (!index) return '종목 목록과 공시 확보 현황을 준비하는 중…';
    var total = new Set(index.stocks.map(function (s) { return s.sourceCode; })).size;
    var available = Object.keys(index.available).length;
    return '검색 ' + num(index.stocks.length) + '종목 · 실제 공시 확보 ' + num(available) + '/' + num(total)
      + '기업' + (available < total ? ' · 전 종목 순차 수집 중' : '') + ' · 우선주는 해당 기업 자료를 공유합니다.';
  }
  function unitLabel(draft, unit) { var u = unit || draft.unit; return draft.currency === 'KRW' ? u : ({ '원': '1', '천원': '천', '백만원': '백만', '억원': '억' }[u] + ' ' + draft.currency); }
  function factor(key, draft) { return ['taxRate', 'wacc', 'terminalGrowth', 'growth'].indexOf(key) >= 0 ? .01 : ['shares', 'price', 'modelReviewed', 'forecastMode'].indexOf(key) >= 0 ? 1 : C.scale[draft.unit]; }
  function display(value, key, draft) { return value == null ? '' : String(Number((value / factor(key, draft)).toPrecision(12))); }
  function typed(value, key, draft) { var n = C.numeric(value); return n == null ? null : n * factor(key, draft); }
  function receiptLink(receipt, title) { return /^\d{14}$/.test(receipt || '') ? '<a target="_blank" rel="noopener" href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + receipt + '">' + esc(title || '공시 원문') + '</a>' : ''; }
  function parseStatic(text, name) {
    var prefix = 'window.' + name + '=';
    if (text.indexOf(prefix) !== 0 || !/;\s*$/.test(text)) throw new Error('정적 자료 형식 오류');
    return JSON.parse(text.slice(prefix.length).replace(/;\s*$/, ''));
  }
  async function archive(path, name, signal) {
    var response = await fetch(base + path, { signal: signal });
    if (!response.ok) throw new Error(response.status === 404 ? '정적 자료 없음' : '정적 자료 조회 오류');
    return parseStatic(await response.text(), name);
  }
  function metadata(item, original) {
    var source = item.sources || [];
    return '<details><summary>출처·원본</summary><div class="dcf-source">'
      + (original ? '<p>원본값: ' + esc(num(original.value)) + ' / ' + esc(LABELS[original.status]) + '</p>' : '')
      + '<p>' + esc(item.reason || 'DART 공시 계정') + '</p>'
      + (item.inputs ? '<p>계산 입력 (원금액·세율 비율): ' + esc(item.inputs.map(num).join(' / ')) + '</p>' : '')
      + source.map(function (s) { return '<p>' + esc(s.account_nm) + ' · ' + esc(s.account_id || '') + ' · ' + esc(s.sj_div || '')
        + '<br>공시 원금액: ' + esc(s.thstrm_amount) + ' ' + esc(s.currency || s.originalUnit || '')
        + '<br>' + esc(s.originalUnit || 'DART API 통화금액') + '<br>' + receiptLink(s.rcept_no) + '</p>'; }).join('')
      + (source.length ? '' : '<p>공시 출처 미확보 / 사용자 입력</p>') + '</div></details>';
  }
  function table(fields, draft) {
    return '<div class="dcf-table-wrap"><table class="dcf-table"><caption>과거 확정 실적 · 금액: ' + esc(unitLabel(draft)) + ' · 통화: ' + esc(draft.currency) + ' · 세율: %</caption><thead><tr><th scope="col">항목</th>'
      + draft.years.map(function (r) { return '<th scope="col">' + r.year + '<small>' + esc(r.basis === 'CFS' ? '연결' : r.basis === 'OFS' ? '별도' : '직접 입력') + '</small></th>'; }).join('')
      + '</tr></thead><tbody>' + fields.map(function (entry) {
        var key = entry[0], calculated = ['fcff', 'simpleFcf'].indexOf(key) !== -1;
        return '<tr><th scope="row">' + esc(entry[1]) + '</th>' + draft.years.map(function (r) {
          var item = C.field(r, key), originalRow = draft.original && draft.original.years.find(function (o) { return o.year === r.year; });
          var original = originalRow ? C.field(originalRow, key) : null;
          return '<td>' + (calculated ? '<strong data-output="' + key + '" data-year="' + r.year + '">' + esc(num(item.value == null ? null : item.value / C.scale[draft.unit])) + '</strong>'
            : '<input type="text" inputmode="decimal" data-year="' + r.year + '" data-field="' + key + '" aria-label="' + r.year + ' ' + esc(entry[1]) + '" value="' + esc(display(item.value, key, draft)) + '"' + (loading ? ' disabled' : '') + '>')
            + '<span class="dcf-status dcf-status-' + item.status + '">' + esc(LABELS[item.status] || '확인 필요') + '</span>'
            + (!calculated ? '<button type="button" class="dcf-text-btn" data-confirm="' + key + '" data-year="' + r.year + '"' + (item.status === 'review' && item.value != null ? '' : ' hidden') + '>값 확인</button><button type="button" class="dcf-text-btn" data-restore="' + key + '" data-year="' + r.year + '"' + (item.status === 'user' ? '' : ' hidden') + '>원본 복원</button>' : '')
            + metadata(item, original) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function input(draft, key, label) {
    var item = draft.assumptions[key] || C.cell(null);
    return '<label class="dcf-assumption"><span>' + esc(label) + '</span><input type="text" inputmode="decimal" data-assumption="' + key + '" value="' + esc(display(item.value, key, draft)) + '"' + (loading ? ' disabled' : '') + '><small>' + esc(LABELS[item.status]) + '</small>'
      + '<button type="button" class="dcf-text-btn" data-confirm-assumption="' + key + '"' + (item.status === 'review' && item.value != null ? '' : ' hidden') + '>값 확인</button>'
      + (draft.original && draft.original.assumptions[key] ? '<button type="button" class="dcf-text-btn" data-restore-assumption="' + key + '"' + (item.status === 'user' ? '' : ' hidden') + '>원본 복원</button>' : '')
      + (item.sources && item.sources.length ? metadata(item, draft.original && draft.original.assumptions[key]) : '') + '</label>';
  }
  function chart(draft) {
    var rows = draft.years, values = [];
    rows.forEach(function (r) { ['fcff', 'simpleFcf'].forEach(function (k) { var v = C.field(r, k).value; if (v != null) values.push(v); }); });
    if (!values.length) return '<p>추세 그래프: 재무자료 부족. 입력 또는 확인 후 실제 값만 표시합니다.</p>';
    var max = Math.max.apply(null, values.concat([0])), min = Math.min.apply(null, values.concat([0]));
    if (max === min) { max++; min--; }
    function y(v) { return 150 - (v - min) / (max - min) * 120; }
    var svg = '<svg viewBox="0 0 640 200" role="img" aria-label="과거 FCFF와 영업현금흐름 차감 FCF 추세">';
    svg += '<line x1="50" x2="600" y1="' + y(0) + '" y2="' + y(0) + '" stroke="currentColor" opacity=".25"/>';
    [['fcff', '#d24f45'], ['simpleFcf', '#1261c4']].forEach(function (series) {
      rows.forEach(function (r, i) {
        var item = C.field(r, series[0]), x = 60 + i * 130;
        if (item.value == null) return;
        var previous = i ? C.field(rows[i - 1], series[0]) : null;
        if (previous && previous.value != null) svg += '<line x1="' + (x - 130) + '" x2="' + x + '" y1="' + y(previous.value) + '" y2="' + y(item.value) + '" stroke="' + series[1] + '"' + (item.status === 'review' ? ' stroke-dasharray="4 4"' : '') + '/>';
        svg += '<circle cx="' + x + '" cy="' + y(item.value) + '" r="4" fill="' + series[1] + '"><title>' + r.year + ' ' + series[0] + ': ' + num(item.value / C.scale[draft.unit]) + ' ' + unitLabel(draft) + ' / ' + LABELS[item.status] + '</title></circle>';
      });
    });
    rows.forEach(function (r, i) { svg += '<text x="' + (60 + i * 130) + '" y="185" text-anchor="middle" fill="currentColor">' + r.year + '</text>'; });
    return '<p>빨강: FCFF · 파랑: 영업현금흐름−CAPEX · 확인 필요 후보는 점선 · 금액 ' + esc(unitLabel(draft)) + '</p>' + svg + '</svg>';
  }
  function resultHtml(draft) {
    var result = C.evaluate(draft, state.mode);
    var final = '<p class="dcf-result-status">' + esc(result.reason || '계산 가능 · 사용자 가정에 따른 FCFF DCF') + '</p>';
    if (result.ok) final = '<dl class="dcf-results"><div><dt>기업가치 (' + esc(unitLabel(draft)) + ')</dt><dd>' + num(result.enterprise / C.scale[draft.unit]) + '</dd></div><div><dt>지분가치 (' + esc(unitLabel(draft)) + ')</dt><dd>' + num(result.equity / C.scale[draft.unit]) + '</dd></div><div><dt>주당 가치 (' + esc(draft.currency) + ')</dt><dd>' + num(result.perShare) + '</dd></div><div><dt>현재주가 대비 (%)</dt><dd>' + (result.upside == null ? '주가 입력 필요' : num(result.upside)) + '</dd></div></dl>'
      + '<p>' + esc(result.warning) + '</p><p>미래 추정 FCFF (' + esc(unitLabel(draft)) + '): ' + result.forecast.map(function (v, i) { return (draft.baseYear + i + 1) + '년 ' + num(v / C.scale[draft.unit]); }).join(' / ') + '</p>';
    return final;
  }
  function refreshNumbers() {
    var draft = C.recalculate(state.current());
    root.querySelectorAll('input[data-field]').forEach(function (element) {
      var row = draft.years.find(function (r) { return r.year === Number(element.dataset.year); });
      var item = C.field(row, element.dataset.field), td = element.closest('td');
      if (element !== document.activeElement) element.value = display(item.value, element.dataset.field, draft);
      var status = td.querySelector('.dcf-status'); status.textContent = LABELS[item.status]; status.className = 'dcf-status dcf-status-' + item.status;
      td.querySelector('[data-confirm]').hidden = item.status !== 'review' || item.value == null;
      td.querySelector('[data-restore]').hidden = item.status !== 'user';
    });
    root.querySelectorAll('[data-output]').forEach(function (element) {
      var row = draft.years.find(function (r) { return r.year === Number(element.dataset.year); });
      var item = C.field(row, element.dataset.output), td = element.closest('td');
      element.textContent = num(item.value == null ? null : item.value / C.scale[draft.unit]);
      td.querySelector('.dcf-status').textContent = LABELS[item.status];
    });
    root.querySelectorAll('[data-assumption]').forEach(function (element) {
      var item = draft.assumptions[element.dataset.assumption] || C.cell(null);
      if (element !== document.activeElement) element.value = display(item.value, element.dataset.assumption, draft);
      element.parentElement.querySelector('small').textContent = LABELS[item.status];
      element.parentElement.querySelector('[data-confirm-assumption]').hidden = item.status !== 'review' || item.value == null;
      var restore = element.parentElement.querySelector('[data-restore-assumption]');
      if (restore) restore.hidden = item.status !== 'user';
    });
    root.querySelector('[data-result]').innerHTML = resultHtml(draft);
    root.querySelector('[data-chart]').innerHTML = chart(draft);
  }
  function render() {
    var draft = C.recalculate(state.current()), stock = draft.company;
    var isAuto = state.mode === 'auto';
    root.innerHTML = '<header><h1>기업가치 분석</h1><p>실제 공시 자료와 사용자 가정으로 계산하는 FCFF DCF 밸류에이션</p></header>'
      + '<p data-coverage>' + esc(coverageText()) + '</p>'
      + '<div class="dcf-toolbar"><button type="button" class="ui-btn ' + (isAuto ? 'ui-btn-primary' : 'ui-btn-secondary') + '" data-mode="auto" aria-pressed="' + isAuto + '">종목 자동 분석</button><button type="button" class="ui-btn ' + (!isAuto ? 'ui-btn-primary' : 'ui-btn-secondary') + '" data-mode="manual" aria-pressed="' + !isAuto + '">직접 입력</button></div>'
      + (isAuto ? '<section class="dcf-section"><label for="dcf-search">종목명 또는 종목코드</label><input id="dcf-search" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="dcf-suggestions" aria-expanded="false" placeholder="예: 삼성전자 / 005930" value="' + esc(stock ? stock.name : '') + '"><ul id="dcf-suggestions" role="listbox" hidden></ul><p>' + (stock ? '<strong>' + esc(stock.name) + '</strong> · ' + esc(stock.code) + ' · ' + esc(stock.market) + ' · ' + (stock.shareClass === 'preferred' ? '우선주 (자동 가치평가 제한)' : '보통주 후보') + ' · ' + esc(stock.industry || '업종 확인 필요') : '기업을 선택하면 해당 기업의 자료만 조회합니다.') + '</p></section>'
        : '<section class="dcf-section"><label>기업명 (선택)<input data-company-name value="' + esc(draft.companyName || '') + '"></label><label>기준 연도<input data-base-year type="number" min="1900" max="2200" value="' + draft.baseYear + '"></label><label>통화<select data-currency><option' + (draft.currency === 'KRW' ? ' selected' : '') + '>KRW</option><option' + (draft.currency === 'USD' ? ' selected' : '') + '>USD</option><option' + (draft.currency === 'EUR' ? ' selected' : '') + '>EUR</option></select></label></section>')
      + '<p role="status" aria-live="polite" class="dcf-message">' + esc(loading ? '공시 정적 자료를 불러오는 중…' : message) + '</p>'
      + '<p class="dcf-guide">사용 순서: ① 검색 결과에서 종목 선택 → ② 공시값의 확인 필요·미확보 항목 검토 → ③ 아래 DCF 가정값 입력 → ④ 맨 아래 평가 결과 확인. 입력하면 자동 계산됩니다. 수집 대기 기업은 재무값이 비어 있으며, 직접 입력하거나 수집 후 다시 선택하세요.</p>'
      + '<div class="dcf-toolbar"><label>금액 입력·표시 단위<select data-unit>' + Object.keys(C.scale).map(function (u) { return '<option value="' + u + '"' + (draft.unit === u ? ' selected' : '') + '>' + esc(unitLabel(draft, u)) + '</option>'; }).join('') + '</select></label>'
      + (isAuto && draft.original ? '<button type="button" class="ui-btn ui-btn-secondary" data-restore-all>공시 원본값 전체 복원</button>' : '') + '</div>'
      + '<section class="dcf-section"><h2>최근 5년 재무자료</h2><p>금액은 공시 API 원금액에서 환산합니다. 빈 값과 실제 0은 구별합니다. 모든 입력은 직접 수정할 수 있습니다.</p>'
      + (draft.generatedAt ? '<p>출처: DART · 생성 기준일 ' + esc(draft.generatedAt) + ' · ' + esc(draft.basis === 'CFS' ? '연결' : '별도') + ' 기준</p>' : '<p>확보된 공시 자료 없음. 아래는 빈 입력표입니다.</p>')
      + draft.years.map(function (r) { return r.report ? '<p>' + r.year + ' · ' + receiptLink(r.report.rcept_no, r.report.report_nm) + ' · 접수 ' + esc(r.report.rcept_dt) + '</p>' : ''; }).join('')
      + table(FIELDS, draft) + '<details><summary>공시 구성 계정 확인</summary>' + table(COMPONENTS, draft) + '</details></section>'
      + '<section class="dcf-section"><h2>과거 FCF 추세</h2><div data-chart>' + chart(draft) + '</div></section>'
      + '<section class="dcf-section"><h2>DCF 가정값</h2><p>자동값의 확인 필요 표시를 확인하고, 정상 세율·영업운전자본 정의·차입금 범위를 검토하세요. 할인율과 성장률은 사용자 가정입니다.</p><div class="dcf-assumptions">'
      + input(draft, 'wacc', 'WACC (%)') + input(draft, 'terminalGrowth', '영구성장률 (%)') + input(draft, 'growth', '예측 성장률 (%)')
      + input(draft, 'netDebt', '조정 순차입금 (' + unitLabel(draft) + ')') + input(draft, 'shares', '조정 주식 수 (주)') + input(draft, 'price', '현재주가 (' + draft.currency + '/주)')
      + (!isAuto ? input(draft, 'baseFcff', '기준 FCFF (' + unitLabel(draft) + ')') : '') + '</div>'
      + '<p>현재주가는 추가 VM 요청 없이 직접 입력합니다. 주식 수는 발행−자기주식과 희석증권·다른 종류 주식·비지배지분을 확인한 후 조정하세요.</p>'
      + (Object.keys(draft.shareFields || {}).length ? '<p>공시 주식 수 (주): ' + ['issuedShares', 'treasuryShares', 'shares'].map(function (k, i) { return ['발행', '자기주식', '유통'][i] + ' ' + num((draft.shareFields[k] || {}).value); }).join(' / ') + '</p>' : '')
      + '<label><input type="checkbox" data-forecast-mode' + (draft.assumptions.forecastMode && draft.assumptions.forecastMode.value === 1 ? ' checked' : '') + '> 향후 연도별 FCFF 직접 입력 (미래 추정)</label><div class="dcf-assumptions">'
      + Array.from({ length: 5 }, function (_, i) { return input(draft, 'forecast' + (i + 1), (draft.baseYear + i + 1) + '년 추정 FCFF (' + unitLabel(draft) + ')'); }).join('') + '</div>'
      + (isAuto ? '<label><input type="checkbox" data-model-review' + (draft.assumptions.modelReviewed && draft.assumptions.modelReviewed.value === 1 ? ' checked' : '') + '> 업종·지주회사 구조·주식 권리·희석증권·비지배지분을 검토했습니다.</label>' : '') + '</section>'
      + '<section class="dcf-section"><h2>평가 결과</h2><div data-result>' + resultHtml(draft) + '</div><p>FCFF=EBIT×(1−세율)+D&A−CAPEX−ΔNWC. 기업가치에서 조정 순차입금을 빼고 조정 주식 수로 나눕니다. 미래 추정과 과거 공시를 구분하세요.</p></section>';
  }
  function search(query) {
    var box = root.querySelector('#dcf-suggestions'), searchInput = root.querySelector('#dcf-search');
    results = index ? C.search(index.stocks, query) : [];
    active = -1;
    box.innerHTML = results.map(function (s, i) { return '<li role="option" id="dcf-option-' + i + '" aria-selected="false"><button type="button" data-code="' + esc(s.code) + '">' + esc(s.name) + ' · ' + esc(s.code) + ' · ' + esc(s.market) + ' · ' + (s.shareClass === 'preferred' ? '우선주' : '보통주 후보') + '</button></li>'; }).join('')
      || '<li>' + (index ? '검색 결과 없음' : '종목 마스터를 불러오는 중 또는 조회 실패') + '</li>';
    box.hidden = !query.trim();
    searchInput.setAttribute('aria-expanded', String(!box.hidden));
    searchInput.removeAttribute('aria-activedescendant');
  }
  async function select(stock) {
    if (controller) controller.abort();
    var token = state.select(stock);
    message = '';
    if (state.auto.generatedAt) { loading = false; render(); return; }
    if (!index.available[stock.sourceCode]) {
      loading = false;
      message = index.failures && index.failures[stock.sourceCode]
        ? index.failures[stock.sourceCode] + '. 정적 공시 파일이 없어 직접 입력을 사용할 수 있습니다.'
        : '전 종목 순차 수집 대기: 이 기업의 정적 공시 파일은 아직 없습니다. 직접 입력을 사용할 수 있습니다.';
      render(); return;
    }
    controller = new AbortController();
    var selectedController = controller;
    var timer = setTimeout(function () { selectedController.abort(); }, 15000);
    loading = true; render();
    try {
      var files = await archive('dcf-data/companies/' + encodeURIComponent(stock.sourceCode) + '.js', 'DCF_FILES', selectedController.signal);
      if (!files[stock.sourceCode]) throw new Error('선택 기업의 공시 파일 내용 미확보');
      if (state.resolve(token, stock, files[stock.sourceCode])) {
        message = '공시 자료를 반영했습니다. 확인 필요 항목은 검토 후 수정 또는 값 확인을 눌러주세요.';
        if (index.failures && index.failures[stock.sourceCode]) message += ' 최근 갱신 실패로 이전에 확보한 공시 자료를 표시합니다.';
        loading = false; render();
      }
    } catch (error) {
      if (token === state.token && state.mode === 'auto') {
        message = error.name === 'AbortError' ? '자료 조회 시간 초과. 직접 입력 가능.' : '자료 조회 실패: ' + error.message + '. 직접 입력 가능.';
        loading = false; render();
      }
    } finally { clearTimeout(timer); }
  }
  root.addEventListener('input', function (event) {
    if (event.target.id === 'dcf-search') search(event.target.value);
    else if (event.target.dataset.field || event.target.dataset.assumption) {
      var target = event.target, d = state.current(), key = target.dataset.field || target.dataset.assumption;
      if (target.dataset.field) C.edit(d, target.dataset.year, key, typed(target.value, key, d));
      else C.setAssumption(d, key, typed(target.value, key, d));
      target.setAttribute('aria-invalid', String(target.value.trim() !== '' && C.numeric(target.value) == null));
      refreshNumbers();
    }
  });
  root.addEventListener('keydown', function (event) {
    if (event.target.id !== 'dcf-search') return;
    var box = root.querySelector('#dcf-suggestions');
    if (event.key === 'Escape') { box.hidden = true; event.target.setAttribute('aria-expanded', 'false'); }
    if (['ArrowDown', 'ArrowUp'].indexOf(event.key) !== -1 && results.length) {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      box.hidden = false;
      event.target.setAttribute('aria-expanded', 'true');
      event.target.setAttribute('aria-activedescendant', 'dcf-option-' + active);
      box.querySelectorAll('[role="option"]').forEach(function (row, i) { row.setAttribute('aria-selected', String(i === active)); });
      box.children[active].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && active >= 0 && !box.hidden) { event.preventDefault(); select(results[active]); }
  });
  root.addEventListener('click', function (event) {
    var target = event.target.closest('button');
    if (!target) return;
    var d = state.current(), key, row;
    if (target.dataset.mode) {
      if (controller) controller.abort();
      state.switchMode(target.dataset.mode); loading = false; message = ''; render();
    } else if (target.dataset.code) select(index.stocks.find(function (s) { return s.code === target.dataset.code; }));
    else if (target.dataset.restore) { C.restore(d, target.dataset.year, target.dataset.restore); render(); }
    else if (target.dataset.confirm) {
      key = target.dataset.confirm; row = d.years.find(function (r) { return r.year === Number(target.dataset.year); });
      C.edit(d, row.year, key, C.field(row, key).value); render();
    } else if (target.hasAttribute('data-restore-all')) {
      var unit = d.unit; state.auto = C.autoDraft(d.company, {
        schemaVersion: 1, code: d.company.sourceCode, currency: 'KRW', amountUnit: '원', basis: d.basis,
        generatedAt: d.generatedAt, years: d.original.years, priorNwc: d.original.priorNwc,
        shareFields: d.original.shareFields, warnings: d.original.warnings, quote: d.original.assumptions.price
      }, year); state.auto.unit = unit; render();
    } else if (target.dataset.confirmAssumption) { key = target.dataset.confirmAssumption; C.setAssumption(d, key, d.assumptions[key].value); render(); }
    else if (target.dataset.restoreAssumption) { key = target.dataset.restoreAssumption; d.assumptions[key] = JSON.parse(JSON.stringify(d.original.assumptions[key])); render(); }
  });
  root.addEventListener('change', function (event) {
    var target = event.target, d = state.current();
    if (target.dataset.field || target.dataset.assumption) { refreshNumbers(); return; }
    else if (target.hasAttribute('data-unit')) d.unit = target.value;
    else if (target.hasAttribute('data-currency') && state.mode === 'manual') d.currency = target.value;
    else if (target.hasAttribute('data-company-name')) d.companyName = target.value;
    else if (target.hasAttribute('data-base-year') && state.mode === 'manual') {
      var newYear = Number(target.value);
      if (Number.isInteger(newYear) && newYear >= 1900 && newYear <= 2200) { d.baseYear = newYear; d.years.forEach(function (r, i) { r.year = newYear - 4 + i; }); }
    } else if (target.hasAttribute('data-forecast-mode')) C.setAssumption(d, 'forecastMode', target.checked ? 1 : 0);
    else if (target.hasAttribute('data-model-review')) C.setAssumption(d, 'modelReviewed', target.checked ? 1 : 0);
    else return;
    render();
  });
  document.title = '기업가치 분석 | DCF 밸류에이션';
  render();
  var indexController = new AbortController();
  var indexTimer = setTimeout(function () { indexController.abort(); }, 15000);
  archive('dcf-data/index.js', 'DCF_INDEX', indexController.signal).then(function (data) {
    if (data.schemaVersion !== 1 || !Array.isArray(data.stocks) || !data.available) throw new Error('종목 마스터 규격 오류');
    index = data;
    root.querySelector('[data-coverage]').textContent = coverageText();
    var inputElement = root.querySelector('#dcf-search');
    if (inputElement && inputElement.value) search(inputElement.value);
    var code = new URLSearchParams(location.search).get('code');
    var stock = code && index.stocks.find(function (s) { return s.code === code; });
    if (stock && state.mode === 'auto' && !state.auto.company) select(stock);
  }).catch(function () {
    message = '종목 마스터 조회 실패. 직접 입력은 계속 사용할 수 있습니다.';
    if (state.mode === 'auto') render();
  }).finally(function () { clearTimeout(indexTimer); });
  global.DcfPage = { state: state, select: select, render: render, parseStatic: parseStatic };
}(window));
