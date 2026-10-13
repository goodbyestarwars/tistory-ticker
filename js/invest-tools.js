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

  function numberValue(input) { return Number(String(input.value || '').replace(/,/g, '')); }
  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return '-';
    return value.toLocaleString('ko-KR', { maximumFractionDigits: digits == null ? 0 : digits });
  }
  function ensureStyle() {
    if (document.querySelector('link[data-invest-tools-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/invest-tools.css?v=20261013-tools2';
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

  var api = { calculateAverage: calculateAverage, openAveraging: openAveraging };
  global.NineInvestTools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
