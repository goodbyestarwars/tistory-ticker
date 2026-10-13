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

  function numberValue(input) { return Number(String(input.value || '').replace(/,/g, '')); }
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
      + '<header><div><span>투자도구</span><h2 id="itTitle">물타기 계산기</h2><p>매수할 때마다 + 버튼으로 항목을 추가해 최종 평균단가를 계산합니다.</p></div><button type="button" class="it-close" aria-label="닫기">✕</button></header>'
      + '<div class="it-input-grid it-current-grid">'
      + '<label><span>현재 보유 수량</span><input inputmode="decimal" data-it="currentQuantity" placeholder="예: 10"></label>'
      + '<label><span>현재 평균단가</span><input inputmode="decimal" data-it="currentAverage" placeholder="예: 120,000"></label>'
      + '</div>'
      + '<div class="it-additions-head"><strong>추가 매수 내역</strong><button type="button" class="it-add-more" aria-label="추가 매수 항목 추가">＋ 추가</button></div>'
      + '<div class="it-additions">' + buyRowHtml(1) + '</div>'
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
    overlay.addEventListener('input', render);
    overlay.querySelector('.it-add-more').addEventListener('click', function () {
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
      + '<label><span>매수 수수료</span><span class="it-input-unit"><input inputmode="decimal" data-it-fx="commission" value="0.25"><i>%</i></span></label>'
      + '</div>'
      + '<p class="it-field-help">환율은 자동으로 들어옵니다. 증권사 앱에 실제 적용환율이 보이면 그 숫자로 바꿔 더 정확하게 계산할 수 있습니다.</p>'
      + '<div class="it-results" aria-live="polite">'
      + '<article class="it-primary"><span>매수 가능 수량 · 정수주 기준</span><strong data-it-fx-result="shares">-</strong></article>'
      + '<article><span>환전 후 투자 가능 달러</span><strong data-it-fx-result="usd">-</strong></article>'
      + '<article><span>계산에 쓴 환율</span><strong data-it-fx-result="effectiveRate">-</strong></article>'
      + '<article><span>주식 매수금액</span><strong data-it-fx-result="order">-</strong></article>'
      + '<article><span>예상 매수 수수료</span><strong data-it-fx-result="commission">-</strong></article>'
      + '<article><span>남는 금액</span><strong data-it-fx-result="remaining">-</strong></article>'
      + '</div><p class="it-note">환전·매수 전 비교용 예상치입니다. 실제 체결 환율, 환율 우대, 최소 수수료와 제비용은 이용 증권사 기준을 확인하세요.</p></section>';
    document.body.appendChild(overlay);
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
    overlay.addEventListener('input', render);
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
      overlay.querySelector('[data-it-fx="rate"]').value = String(buyRate);
      overlay.querySelector('[data-it-rate-status]').textContent = '자동 입력 · 한국수출입은행 ' + (data.baseDate || '최근 고시일') + ' 달러 살 때 참고환율 ' + formatNumber(buyRate, 2) + '원 · 실시간 환율 아님';
      render();
    }).catch(function () {
      overlay.querySelector('[data-it-rate-status]').textContent = '환율을 불러오지 못했습니다. 현재 이용 중인 증권사 환율을 직접 입력하세요.';
    });
    overlay.querySelector('[data-it-fx="krw"]').focus();
  }

  var api = { calculateAverage: calculateAverage, calculateNasdaqFx: calculateNasdaqFx, openAveraging: openAveraging, openNasdaqFx: openNasdaqFx };
  global.NineInvestTools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
