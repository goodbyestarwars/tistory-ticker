(function (global) {
  'use strict';

  function calculateAverage(currentQuantity, currentAverage, additions, legacyPrice) {
    var cq = Number(currentQuantity), ca = Number(currentAverage);
    var rows = Array.isArray(additions) ? additions : [{ quantity: additions, price: legacyPrice }];
    if (![cq, ca].every(Number.isFinite) || cq < 0 || ca < 0 || !rows.length) return null;
    var buyQuantity = 0, buyCost = 0, additionCount = 0;
    for (var i = 0; i < rows.length; i++) {
      var quantity = Number(rows[i] && rows[i].quantity);
      var price = Number(rows[i] && rows[i].price);
      if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) return null;
      buyQuantity += quantity;
      buyCost += quantity * price;
      additionCount += 1;
    }
    var currentCost = cq * ca;
    var totalQuantity = cq + buyQuantity;
    if (!totalQuantity || !buyQuantity) return null;
    var average = (currentCost + buyCost) / totalQuantity;
    var buyAverage = buyCost / buyQuantity;
    return {
      additionCount: additionCount,
      buyQuantity: buyQuantity,
      buyAverage: buyAverage,
      totalQuantity: totalQuantity,
      currentCost: currentCost,
      buyCost: buyCost,
      totalCost: currentCost + buyCost,
      average: average,
      averageChangePct: ca > 0 ? (average - ca) / ca * 100 : null,
      recoveryPct: buyAverage > 0 ? (average - buyAverage) / buyAverage * 100 : null
    };
  }

  // 목표 손실률은 총 매입금 대비 평가손실의 비율이며, 현재가 매수 시 손실금은 변하지 않는다.
  function calculateLossTarget(quantity, average, price, targetPercent) {
    var q = Number(quantity), a = Number(average), p = Number(price), rate = Number(targetPercent);
    if (![q, a, p, rate].every(Number.isFinite) || !Number.isSafeInteger(q) || q <= 0 || a <= 0 || p <= 0 || rate <= 0 || rate > 100) return null;
    var initialCost = q * a, loss = q * Math.max(0, a - p);
    var rawShares = Math.max(0, (loss / (rate / 100) - initialCost) / p);
    var shares = Math.ceil(rawShares);
    if (!Number.isSafeInteger(shares) || !Number.isSafeInteger(q + shares) || !Number.isFinite(initialCost + shares * p)) return { tooLarge: true };
    var addedCost = shares * p, totalCost = initialCost + addedCost;
    return { shares: shares, addedCost: addedCost, totalCost: totalCost, loss: loss, lossRate: totalCost ? loss / totalCost * 100 : 0,
      average: totalCost / (q + shares) };
  }

  function calculateRecovery(quantity, average, price, target) {
    var q = Number(quantity), a = Number(average), p = Number(price), t = Number(target);
    if (![q, a, p, t].every(Number.isFinite) || !Number.isSafeInteger(q) || q <= 0 || a <= 0 || p <= 0 || t <= 0) return null;
    if (t >= a) return { shares: 0, cost: 0, average: a, pnl: q * (t - a) };
    if (t <= p) return { impossible: true };
    var shares = Math.ceil(q * (a - t) / (t - p));
    if (!Number.isSafeInteger(shares) || !Number.isSafeInteger(q + shares)) return { tooLarge: true };
    var cost = shares * p, total = q * a + cost;
    return { shares: shares, cost: cost, average: total / (q + shares), pnl: (q + shares) * t - total };
  }

  function calculateNasdaqFx(krwBudget, appliedRate, stockPrice, commissionPct) {
    var krw = Number(krwBudget), rate = Number(appliedRate);
    var price = Number(stockPrice), commission = Number(commissionPct || 0);
    if (![krw, rate, price, commission].every(Number.isFinite)
        || krw <= 0 || rate <= 0 || price <= 0 || commission < 0) return null;
    var effectiveRate = rate;
    var availableUsd = krw / effectiveRate;
    var perShareUsd = price * (1 + commission / 100);
    var shares = Math.floor(availableUsd / perShareUsd);
    var orderUsd = shares * price;
    var commissionUsd = orderUsd * commission / 100;
    var usedUsd = orderUsd + commissionUsd;
    var remainingUsd = Math.max(0, availableUsd - usedUsd);
    return {
      effectiveRate: effectiveRate,
      availableUsd: availableUsd,
      shares: shares,
      orderUsd: orderUsd,
      commissionUsd: commissionUsd,
      usedKrw: usedUsd * effectiveRate,
      remainingUsd: remainingUsd,
      remainingKrw: remainingUsd * effectiveRate
    };
  }

  // 미국주식 온라인 기본 매수 요율, 2026-10-14 공식 안내 확인.
  var FX_BROKERS = {
    kis: { name: '한국투자증권', rate: 0.25, url: 'https://www.truefriend.com/main/bond/research/_static/TF03ca050000.jsp' },
    kiwoom: { name: '키움증권', rate: 0.25, url: 'https://www.kiwoom.com/h/help/fee/VHelpFoFeeView' },
    other: { name: '기타 · 직접 입력', rate: 0.25, url: '' }
  };
  function fxBrokerKey(value) {
    if (FX_BROKERS[value]) return value;
    if (/한국투자|KIS|뱅키스/i.test(value || '')) return 'kis';
    if (/키움|kiwoom/i.test(value || '')) return 'kiwoom';
    return 'other';
  }
  function validFee(value) { return /^\d+(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value)); }
  function resolveFxFee(saved) {
    // 계좌 연동 설정은 화면에 공개되지 않는다. 미저장 시 기존 데이터 연동 KIS를 선택.
    var broker = saved && saved.broker ? fxBrokerKey(saved.broker) : 'kis';
    var rates = {};
    if (saved && saved.rates && typeof saved.rates === 'object') {
      Object.keys(FX_BROKERS).forEach(function (key) {
        if (validFee(saved.rates[key])) rates[key] = Number(saved.rates[key]);
      });
    }
    if (saved && validFee(saved.rate) && saved.manual !== false) rates[broker] = Number(saved.rate);
    return { broker: broker, rates: rates };
  }

  function numberValue(input) { return Number(String(input.value || '').replace(/,/g, '')); }
  function groupInput(input) {
    var before = input.value, caret = input.selectionStart;
    var raw = before.replace(/,/g, '');
    if (!/^(?:\d+)?(?:\.\d*)?$/.test(raw)) return;
    var parts = raw.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var formatted = parts.join('.');
    if (formatted === before) return;
    var digitsBeforeCaret = before.slice(0, caret).replace(/,/g, '').length;
    input.value = formatted;
    var position = 0, seen = 0;
    while (position < formatted.length && seen < digitsBeforeCaret) {
      if (formatted.charAt(position) !== ',') seen++;
      position++;
    }
    input.setSelectionRange(position, position);
  }
  function formatInputsOnEdit(event) {
    var input = event.target;
    if (input && input.matches('input[inputmode="decimal"]')) groupInput(input);
  }
  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return '-';
    return value.toLocaleString('ko-KR', { maximumFractionDigits: digits == null ? 0 : digits });
  }
  function ensureStyle() {
    if (document.querySelector('link[data-invest-tools-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/invest-tools.css?v=20261013-tools3';
    link.setAttribute('data-invest-tools-css', '1');
    document.head.appendChild(link);
  }
  function buyRowHtml(index) {
    return '<div class="it-add-row" data-it-add-row>'
      + '<strong>추가 매수 ' + index + '</strong>'
      + '<label><span>수량</span><input inputmode="decimal" data-it-buy-quantity placeholder="예: 5"></label>'
      + '<label><span>매수가</span><input inputmode="decimal" data-it-buy-price placeholder="예: 100,000"></label>'
      + '<button type="button" class="it-remove" aria-label="추가 매수 ' + index + ' 삭제">삭제</button>'
      + '</div>';
  }
  function openAveraging() {
    ensureStyle();
    var previous = document.querySelector('.it-overlay');
    if (previous) previous.remove();
    var overlay = document.createElement('div');
    overlay.className = 'it-overlay';
    overlay.innerHTML = '<section class="it-modal" role="dialog" aria-modal="true" aria-labelledby="itTitle">'
      + '<header><div><span>투자도구</span><h2 id="itTitle">물타기 계산기</h2><p>현재 보유 현황을 계산한 뒤 추가 매수와 목표 평단을 비교합니다.</p></div><button type="button" class="it-close" aria-label="닫기">✕</button></header>'
      + '<section class="it-recovery"><h3>현재 보유 정보</h3>'
      + '<div class="it-stock-row"><label>국내 종목명 또는 코드<input type="search" data-it-stock list="itStockOptions" autocomplete="off" placeholder="예: 삼성전자 또는 005930"></label><datalist id="itStockOptions"></datalist><button type="button" class="it-add-more" data-it-load>현재가 불러오기</button></div>'
      + '<p class="it-field-help" data-it-stock-status aria-live="polite">종목을 선택하거나 현재가를 직접 입력하세요.</p>'
      + '<div class="it-input-grid it-recovery-grid"><label><span>현재가</span><input inputmode="decimal" data-it-recovery="price" placeholder="직접 입력 가능"></label><label><span>현재 보유 수량</span><input inputmode="decimal" data-it="currentQuantity" placeholder="예: 10"></label><label><span>현재 평균단가</span><input inputmode="decimal" data-it="currentAverage" placeholder="예: 120,000"></label><label><span>목표 손실률 (−%)</span><input inputmode="decimal" data-it-loss-rate value="1" placeholder="예: 1"></label></div>'
      + '<button type="button" class="it-add-more it-calculate" data-it-calculate>계산하기</button>'
      + '<p class="it-field-help" data-it-calculate-error role="status"></p>'
      + '<div data-it-summary hidden><div class="it-table-wrap"><table class="it-summary-table"><caption>현재 보유와 목표 손실률 비교</caption><thead><tr><th scope="col">구분</th><th scope="col">보유 수량</th><th scope="col">평균단가</th><th scope="col">투자금</th><th scope="col">평가손익</th><th scope="col">손익률</th></tr></thead><tbody><tr><th scope="row">현재 보유</th><td data-it-cell="currentQuantity"></td><td data-it-cell="currentAverage"></td><td data-it-cell="currentCost"></td><td data-it-cell="currentPnl"></td><td data-it-cell="currentRate"></td></tr><tr><th scope="row">목표 손실률</th><td data-it-cell="targetQuantity"></td><td data-it-cell="targetAverage"></td><td data-it-cell="targetCost"></td><td data-it-cell="targetPnl"></td><td data-it-cell="targetRate"></td></tr></tbody></table></div><div class="it-recovery-result" data-it-loss-result aria-live="polite"></div><p class="it-field-help">현재가로 매수하고 주가가 그대로라면 기존 평가손익 금액은 변하지 않습니다. 목표 손실률은 정수주로 올림해 계산합니다.</p></div>'
      + '<details class="it-target-detail"><summary>목표 반등가 손익분기 계산</summary><div class="it-input-grid it-recovery-grid"><label><span>목표 반등가</span><input inputmode="decimal" data-it-recovery="target" placeholder="예: 110,000"></label></div><div class="it-recovery-result" aria-live="polite" data-it-recovery-result>목표 반등가를 입력하세요.</div></details></section>'
      + '<div class="it-additions-head"><strong>추가 매수 내역</strong><button type="button" class="it-add-more" aria-label="추가 매수 항목 추가">＋ 추가</button></div>'
      + '<div class="it-additions">' + buyRowHtml(1) + '</div>'
      + '<div class="it-input-grid it-recovery-grid"><label><span>원하는 새 평균단가 (선택)</span><input inputmode="decimal" data-it-desired-average placeholder="예: 180,000"></label></div><p class="it-field-help">추가 매수가를 입력하면 그 가격으로, 비워두면 현재가로 필요한 최소 수량을 계산합니다.</p><div class="it-recovery-result" data-it-desired-result aria-live="polite">원하는 새 평균단가를 입력하세요.</div>'

      + '<div class="it-results" aria-live="polite">'
      + '<article class="it-primary"><span>새 평균단가</span><strong data-it-result="average">-</strong></article>'
      + '<article><span>총 보유 수량</span><strong data-it-result="quantity">-</strong></article>'
      + '<article><span>총 투자금액</span><strong data-it-result="cost">-</strong></article>'
      + '<article><span>기존 평단 대비</span><strong data-it-result="change">-</strong></article>'
      + '<article><span>추가 매수 평균가 → 새 평단</span><strong data-it-result="recovery">-</strong></article>'
      + '</div><p class="it-note">수수료와 세금은 포함하지 않은 단순 평균단가 계산입니다.</p></section>';
    document.body.appendChild(overlay);
    var oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function close() { overlay.remove(); document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); }
    function onKey(event) { if (event.key === 'Escape') close(); }
    function renumberRows() {
      var rows = overlay.querySelectorAll('[data-it-add-row]');
      rows.forEach(function (row, index) {
        row.querySelector('strong').textContent = '추가 매수 ' + (index + 1);
        row.querySelector('.it-remove').setAttribute('aria-label', '추가 매수 ' + (index + 1) + ' 삭제');
        row.querySelector('.it-remove').hidden = rows.length === 1;
      });
    }
    var stockInput = overlay.querySelector('[data-it-stock]');
    var stockStatus = overlay.querySelector('[data-it-stock-status]');
    var loadButton = overlay.querySelector('[data-it-load]');
    var requestId = 0, summaryReady = false;
    function invalidateSummary() { summaryReady = false; overlay.querySelector('[data-it-summary]').hidden = true; }
    function updateStockOptions() {
      var query = stockInput.value.trim().toLowerCase(), list = overlay.querySelector('#itStockOptions');
      list.textContent = '';
      if (!query || !global.KRX_MAP) return;
      Object.keys(global.KRX_MAP).filter(function (name) {
        return name.toLowerCase().indexOf(query) !== -1 || String(global.KRX_MAP[name]).toLowerCase().indexOf(query) !== -1;
      }).slice(0, 30).forEach(function (name) {
        var option = document.createElement('option'); option.value = name; option.label = global.KRX_MAP[name]; list.appendChild(option);
      });
    }
    if (!global.KRX_MAP) {
      var mapScript = document.createElement('script');
      mapScript.src = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
      mapScript.onload = updateStockOptions;
      mapScript.onerror = function () { stockStatus.textContent = '종목 목록을 불러오지 못했습니다. 6자리 코드를 입력하거나 현재가를 직접 입력하세요.'; };
      document.head.appendChild(mapScript);
    }
    stockInput.addEventListener('input', function () { invalidateSummary(); requestId++; overlay.querySelector('[data-it-recovery="price"]').value = ''; updateStockOptions(); renderRecovery(); stockStatus.textContent = '종목을 선택하고 현재가 불러오기를 누르세요.'; });
    loadButton.addEventListener('click', function () {
      var query = stockInput.value.trim(), map = global.KRX_MAP || {}, name = Object.keys(map).find(function (key) { return key.toLowerCase() === query.toLowerCase(); });
      var code = name ? map[name] : /^[0-9A-Za-z]{6}$/.test(query) ? query.toUpperCase() : '';
      if (!code) { stockStatus.textContent = '목록에서 종목명을 선택하거나 6자리 종목코드를 입력하세요.'; return; }
      if (!global.NineAPI || !global.NineAPI.domesticQuotes) { stockStatus.textContent = '시세 기능을 사용할 수 없습니다. 현재가를 직접 입력하세요.'; return; }
      var id = ++requestId; loadButton.disabled = true; stockStatus.textContent = '현재가를 불러오는 중...';
      global.NineAPI.domesticQuotes([code]).then(function (rows) {
        if (id !== requestId || !overlay.isConnected) return;
        var row = rows && rows[0], price = Number(row && row.price);
        if (!Number.isFinite(price) || price <= 0) throw new Error('no price');
        invalidateSummary();
        overlay.querySelector('[data-it-recovery="price"]').value = formatNumber(price, 2);
        render();
        renderDesired();
        stockStatus.textContent = (name || code) + ' · ' + formatNumber(price, 2) + '원 · 조회 시점 참고가' + (row.degraded ? ' · 대체 경로' : '') + (row.dataDate ? ' · 기준 ' + row.dataDate : '');
        renderRecovery();
      }).catch(function () { if (id === requestId && overlay.isConnected) stockStatus.textContent = '현재가를 불러오지 못했습니다. 직접 입력하거나 다시 시도하세요.'; })
        .finally(function () { if (overlay.isConnected) loadButton.disabled = false; });
    });
    function renderRecovery() {
      var box = overlay.querySelector('[data-it-recovery-result]');
      var q = numberValue(overlay.querySelector('[data-it="currentQuantity"]'));
      var a = numberValue(overlay.querySelector('[data-it="currentAverage"]'));
      var p = numberValue(overlay.querySelector('[data-it-recovery="price"]'));
      var t = numberValue(overlay.querySelector('[data-it-recovery="target"]'));
      var rate = numberValue(overlay.querySelector('[data-it-loss-rate]'));
      var lossBox = overlay.querySelector('[data-it-loss-result]');
      if (summaryReady) {
        var lossResult = calculateLossTarget(q, a, p, rate);
        if (lossResult && !lossResult.tooLarge) {
          var pnl = q * (p - a), cost = q * a;
          function cell(key, value) { overlay.querySelector('[data-it-cell="' + key + '"]').textContent = value; }
          function signed(value, digits) { return (value > 0 ? '+' : '') + formatNumber(value, digits); }
          cell('currentQuantity', formatNumber(q) + '주'); cell('currentAverage', formatNumber(a, 2) + '원');
          cell('currentCost', formatNumber(cost, 2) + '원'); cell('currentPnl', signed(pnl, 2) + '원'); cell('currentRate', signed(pnl / cost * 100, 4) + '%');
          cell('targetQuantity', formatNumber(q + lossResult.shares) + '주'); cell('targetAverage', formatNumber(lossResult.average, 2) + '원');
          cell('targetCost', formatNumber(lossResult.totalCost, 2) + '원'); cell('targetPnl', signed(pnl, 2) + '원'); cell('targetRate', signed(pnl / lossResult.totalCost * 100, 4) + '%');
          lossBox.textContent = '목표 손실률까지 추가 매수 ' + formatNumber(lossResult.shares) + '주 · 필요 자금 ' + formatNumber(lossResult.addedCost, 2) + '원';
        }
      }
      if (!q || !a || !p || !t) { box.textContent = '현재 보유 정보와 목표 반등가를 입력하세요.'; return; }
      var result = calculateRecovery(q, a, p, t);
      if (!result) { box.textContent = '보유 수량은 1 이상의 정수주로, 가격은 0보다 크게 입력하세요.'; return; }
      if (result.impossible) { box.textContent = '목표가가 현재가 이하이면 추가 매수로 손익분기에 도달할 수 없습니다.'; return; }
      if (result.tooLarge) { box.textContent = '입력값이 너무 커서 계산할 수 없습니다.'; return; }
      box.textContent = result.shares ? '최소 추가 매수 ' + formatNumber(result.shares) + '주 · ' + formatNumber(result.cost) + '원 | 새 평단 ' + formatNumber(result.average, 2) + '원 | 목표가 평가손익 ' + formatNumber(result.pnl, 2) + '원' : '추가 매수 0주 · 목표가가 기존 평단 이상입니다. 목표가 평가손익 ' + formatNumber(result.pnl, 2) + '원';
    }
    function renderDesired() {
      var output = overlay.querySelector('[data-it-desired-result]');
      var q = numberValue(overlay.querySelector('[data-it="currentQuantity"]'));
      var a = numberValue(overlay.querySelector('[data-it="currentAverage"]'));
      var desired = numberValue(overlay.querySelector('[data-it-desired-average]'));
      var buyInput = overlay.querySelector('[data-it-buy-price]');
      var p = buyInput.value.trim() ? numberValue(buyInput) : numberValue(overlay.querySelector('[data-it-recovery="price"]'));
      if (!desired) { output.textContent = '원하는 새 평균단가를 입력하세요.'; return; }
      if (!q || !a || !p) { output.textContent = '보유 수량·평단과 현재가 또는 추가 매수가를 입력하세요.'; return; }
      var result = calculateRecovery(q, a, p, desired);
      if (!result) { output.textContent = '수량은 정수주, 가격은 0보다 크게 입력하세요.'; return; }
      if (result.impossible) { output.textContent = '원하는 평단이 추가 매수가 이하이면 그 가격으로 추가 매수해도 도달할 수 없습니다.'; return; }
      if (result.tooLarge) { output.textContent = '필요한 수량이 너무 커서 계산할 수 없습니다.'; return; }
      output.textContent = '추가 매수가 ' + formatNumber(p, 2) + '원 기준 · 최소 ' + formatNumber(result.shares) + '주 · 필요 자금 ' + formatNumber(result.cost, 2) + '원 · 실제 새 평단 ' + formatNumber(result.average, 2) + '원';
    }
    overlay.querySelector('[data-it-calculate]').addEventListener('click', function () {
      var q = numberValue(overlay.querySelector('[data-it="currentQuantity"]'));
      var a = numberValue(overlay.querySelector('[data-it="currentAverage"]'));
      var p = numberValue(overlay.querySelector('[data-it-recovery="price"]'));
      var rate = numberValue(overlay.querySelector('[data-it-loss-rate]'));
      var r = calculateLossTarget(q, a, p, rate), error = overlay.querySelector('[data-it-calculate-error]');
      if (!r || r.tooLarge) { invalidateSummary(); error.textContent = r && r.tooLarge ? '입력값이 너무 큽니다.' : '현재가·평단은 0보다 크게, 수량은 정수주, 목표 손실률은 0보다 크고 100 이하로 입력하세요.'; return; }
      error.textContent = ''; summaryReady = true; overlay.querySelector('[data-it-summary]').hidden = false; renderRecovery();
    });
    function render() {
      var currentQuantity = numberValue(overlay.querySelector('[data-it="currentQuantity"]'));
      var currentAverage = numberValue(overlay.querySelector('[data-it="currentAverage"]'));
      var additions = [], incomplete = false;
      overlay.querySelectorAll('[data-it-add-row]').forEach(function (row) {
        var quantityInput = row.querySelector('[data-it-buy-quantity]');
        var priceInput = row.querySelector('[data-it-buy-price]');
        var quantityText = quantityInput.value.trim(), priceText = priceInput.value.trim();
        if (!quantityText && !priceText) return;
        if (!quantityText || !priceText) { incomplete = true; return; }
        additions.push({ quantity: numberValue(quantityInput), price: numberValue(priceInput) });
      });
      var result = incomplete ? null : calculateAverage(currentQuantity, currentAverage, additions);
      var set = function (key, value) { overlay.querySelector('[data-it-result="' + key + '"]').textContent = value; };
      if (!result) { ['average', 'quantity', 'cost', 'change', 'recovery'].forEach(function (key) { set(key, '-'); }); return; }
      set('average', formatNumber(result.average, 2) + '원');
      set('quantity', formatNumber(result.totalQuantity, 4) + '주');
      set('cost', formatNumber(result.totalCost, 0) + '원');
      set('change', result.averageChangePct == null ? '-' : (result.averageChangePct > 0 ? '+' : '') + result.averageChangePct.toFixed(2) + '%');
      set('recovery', result.recoveryPct == null ? '-' : (result.recoveryPct > 0 ? '+' : '') + result.recoveryPct.toFixed(2) + '%');
    }
    overlay.addEventListener('input', function (event) { formatInputsOnEdit(event); if (event.target.matches('[data-it-recovery="price"], [data-it="currentQuantity"], [data-it="currentAverage"], [data-it-loss-rate]')) invalidateSummary(); if (event.target.matches('[data-it-recovery="price"]')) { requestId++; stockStatus.textContent = '직접 입력한 현재가로 계산합니다.'; } render(); renderRecovery(); renderDesired(); });
    overlay.querySelector('.it-additions-head .it-add-more').addEventListener('click', function () {
      var additions = overlay.querySelector('.it-additions');
      additions.insertAdjacentHTML('beforeend', buyRowHtml(additions.children.length + 1));
      renumberRows();
      additions.lastElementChild.querySelector('input').focus();
    });
    overlay.querySelector('.it-additions').addEventListener('click', function (event) {
      var remove = event.target.closest('.it-remove');
      if (!remove) return;
      if (overlay.querySelectorAll('[data-it-add-row]').length > 1) remove.closest('[data-it-add-row]').remove();
      renumberRows();
      render();
      renderDesired();
    });
    overlay.querySelector('.it-close').addEventListener('click', close);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    renumberRows();
    overlay.querySelector('input').focus();
  }

  function openNasdaqFx() {
    ensureStyle();
    var previous = document.querySelector('.it-overlay');
    if (previous) previous.remove();
    var overlay = document.createElement('div');
    overlay.className = 'it-overlay';
    overlay.innerHTML = '<section class="it-modal it-fx-modal" role="dialog" aria-modal="true" aria-labelledby="itFxTitle">'
      + '<header><div><span>투자도구 · 미국주식</span><h2 id="itFxTitle">나스닥 환율 계산기</h2><p>원화 예산으로 살 수 있는 미국주식 수량과 환전 후 남는 금액을 계산합니다.</p></div><button type="button" class="it-close" aria-label="닫기">✕</button></header>'
      + '<div class="it-rate-status" data-it-rate-status>공식 원/달러 환율을 불러오는 중...</div>'
      + '<div class="it-input-grid">'
      + '<label><span>투자할 원화</span><input inputmode="decimal" data-it-fx="krw" placeholder="예: 5,000,000"></label>'
      + '<label><span>달러 살 때 적용 환율</span><input inputmode="decimal" data-it-fx="rate" placeholder="자동으로 입력됩니다"></label>'
      + '<label><span>미국주식 1주 가격</span><span class="it-input-unit"><input inputmode="decimal" data-it-fx="stockPrice" placeholder="예: 180"><i>$</i></span></label>'
      + '<label><span>증권사 · 미국주식 온라인</span><select data-it-broker><option value="kis">한국투자증권</option><option value="kiwoom">키움증권</option><option value="other">기타 · 직접 입력</option></select></label>'
      + '<label><span>매수 수수료율</span><span class="it-input-unit"><input inputmode="decimal" data-it-fx="commission" value="0.25"><i>%</i></span></label>'
      + '</div>'
      + '<p class="it-field-help" data-it-fee-help></p><button type="button" class="ui-btn ui-btn-text" data-it-fee-reset>기본 수수료율로 복원</button>'
      + '<div class="it-results" aria-live="polite">'
      + '<article class="it-primary"><span>매수 가능 수량 · 정수주 기준</span><strong data-it-fx-result="shares">-</strong></article>'
      + '<article><span>환전 후 투자 가능 달러</span><strong data-it-fx-result="usd">-</strong></article>'
      + '<article><span>계산에 쓴 환율</span><strong data-it-fx-result="effectiveRate">-</strong></article>'
      + '<article><span>주식 매수금액</span><strong data-it-fx-result="order">-</strong></article>'
      + '<article><span>예상 매수 수수료</span><strong data-it-fx-result="commission">-</strong></article>'
      + '<article><span>남는 금액</span><strong data-it-fx-result="remaining">-</strong></article>'
      + '</div><p class="it-note">환전·매수 전 비교용 예상치입니다. 실제 체결 환율, 환율 우대, 최소 수수료와 제비용은 이용 증권사 기준을 확인하세요.</p></section>';
    document.body.appendChild(overlay);
    var feeInput = overlay.querySelector('[data-it-fx="commission"]');
    var brokerInput = overlay.querySelector('[data-it-broker]');
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('nine_invest_fx_fee_v1') || 'null'); } catch (e) { /* 저장소 제한 */ }
    var feeSettings = resolveFxFee(saved);
    brokerInput.value = feeSettings.broker;
    function applyBrokerFee() {
      var broker = FX_BROKERS[brokerInput.value];
      var manual = Object.prototype.hasOwnProperty.call(feeSettings.rates, brokerInput.value);
      feeInput.value = String(manual ? feeSettings.rates[brokerInput.value] : broker.rate);
      var help = overlay.querySelector('[data-it-fee-help]');
      help.textContent = (manual ? '저장된 수동 요율 적용. ' : brokerInput.value === 'other' ? '예시 요율 0.25% · 실제 요율을 직접 입력하세요. ' : broker.name + ' 온라인 기본 요율 ' + broker.rate + '% 적용. ')
        + '계좌별 우대율은 조회할 수 없습니다. 실제 매수 요율로 수정하면 증권사별로 저장됩니다.'
        + (!saved ? ' 증권사는 서비스 데이터 연동 기준으로 선택되며 본인 계좌 연동을 의미하지 않습니다.' : '');
      if (broker.url) {
        var link = document.createElement('a'); link.href = broker.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = ' 공식 수수료 안내'; help.appendChild(link);
      }
    }
    function saveFeeSettings() {
      var manual = Object.prototype.hasOwnProperty.call(feeSettings.rates, brokerInput.value);
      try { localStorage.setItem('nine_invest_fx_fee_v1', JSON.stringify({ broker: brokerInput.value, rate: feeInput.value.replace(/,/g, ''), manual: manual, rates: feeSettings.rates })); } catch (e) { /* 저장소 제한 */ }
    }
    applyBrokerFee();
    var oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function close() { overlay.remove(); document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); }
    function onKey(event) { if (event.key === 'Escape') close(); }
    function set(key, value) { overlay.querySelector('[data-it-fx-result="' + key + '"]').textContent = value; }
    function render() {
      var values = {};
      overlay.querySelectorAll('[data-it-fx]').forEach(function (input) { values[input.getAttribute('data-it-fx')] = numberValue(input); });
      var result = calculateNasdaqFx(values.krw, values.rate, values.stockPrice, values.commission);
      if (!result) { ['shares', 'usd', 'effectiveRate', 'order', 'commission', 'remaining'].forEach(function (key) { set(key, '-'); }); return; }
      set('shares', formatNumber(result.shares, 0) + '주');
      set('usd', '$' + formatNumber(result.availableUsd, 2));
      set('effectiveRate', formatNumber(result.effectiveRate, 2) + '원/$');
      set('order', '$' + formatNumber(result.orderUsd, 2) + ' · ' + formatNumber(result.usedKrw, 0) + '원');
      set('commission', '$' + formatNumber(result.commissionUsd, 2));
      set('remaining', '$' + formatNumber(result.remainingUsd, 2) + ' · ' + formatNumber(result.remainingKrw, 0) + '원');
    }
    overlay.addEventListener('input', function (event) {
      formatInputsOnEdit(event);
      if (event.target === feeInput) {
        var rateText = feeInput.value.replace(/,/g, '');
        if (validFee(rateText)) {
          feeSettings.rates[brokerInput.value] = Number(rateText);
          saveFeeSettings();
          overlay.querySelector('[data-it-fee-help]').textContent = '수동 요율 적용 · 계좌별 우대율 확인 불가. 실제 매수 요율을 증권사 앱에서 확인하세요. 증권사별로 저장됩니다.';
        }
      }
      render();
    });
    brokerInput.addEventListener('change', function () { applyBrokerFee(); saveFeeSettings(); render(); });
    overlay.querySelector('[data-it-fee-reset]').addEventListener('click', function () {
      delete feeSettings.rates[brokerInput.value]; applyBrokerFee(); saveFeeSettings(); render();
    });
    overlay.querySelector('.it-close').addEventListener('click', close);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    fetch('https://goodbyestar.cloud/fx-rates', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('fx ' + response.status);
      return response.json();
    }).then(function (payload) {
      var data = payload && payload.data;
      var usd = data && (data.currencies || []).filter(function (item) { return item.code === 'USD'; })[0];
      var buyRate = Number(usd && (usd.tts || usd.dealBasR));
      if (!Number.isFinite(buyRate)) throw new Error('USD rate unavailable');
      overlay.querySelector('[data-it-fx="rate"]').value = formatNumber(buyRate, 4);
      overlay.querySelector('[data-it-rate-status]').textContent = '자동 입력 · 한국수출입은행 ' + (data.baseDate || '최근 고시일') + ' 달러 살 때 참고환율 ' + formatNumber(buyRate, 2) + '원 · 실시간 환율 아님';
      render();
    }).catch(function () {
      overlay.querySelector('[data-it-rate-status]').textContent = '환율을 불러오지 못했습니다. 현재 이용 중인 증권사 환율을 직접 입력하세요.';
    });
    overlay.querySelector('[data-it-fx="krw"]').focus();
  }

  var api = { calculateLossTarget: calculateLossTarget, calculateRecovery: calculateRecovery, calculateAverage: calculateAverage, calculateNasdaqFx: calculateNasdaqFx, resolveFxFee: resolveFxFee, openAveraging: openAveraging, openNasdaqFx: openNasdaqFx };
  global.NineInvestTools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
