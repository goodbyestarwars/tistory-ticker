(function (global) {
  'use strict';

  function calculateAverage(currentQuantity, currentAverage, buyQuantity, buyPrice) {
    var cq = Number(currentQuantity), ca = Number(currentAverage), bq = Number(buyQuantity), bp = Number(buyPrice);
    if (![cq, ca, bq, bp].every(Number.isFinite) || cq < 0 || ca < 0 || bq <= 0 || bp <= 0) return null;
    var currentCost = cq * ca;
    var buyCost = bq * bp;
    var totalQuantity = cq + bq;
    if (!totalQuantity) return null;
    var average = (currentCost + buyCost) / totalQuantity;
    return {
      totalQuantity: totalQuantity,
      currentCost: currentCost,
      buyCost: buyCost,
      totalCost: currentCost + buyCost,
      average: average,
      averageChangePct: ca > 0 ? (average - ca) / ca * 100 : null,
      recoveryPct: average > 0 ? (average - bp) / bp * 100 : null
    };
  }

  function numberValue(input) {
    return Number(String(input.value || '').replace(/,/g, ''));
  }
  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return '-';
    return value.toLocaleString('ko-KR', { maximumFractionDigits: digits == null ? 0 : digits });
  }
  function ensureStyle() {
    if (document.querySelector('link[data-invest-tools-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/invest-tools.css?v=20261013-tools1';
    link.setAttribute('data-invest-tools-css', '1');
    document.head.appendChild(link);
  }
  function openAveraging() {
    ensureStyle();
    var previous = document.querySelector('.it-overlay');
    if (previous) previous.remove();
    var overlay = document.createElement('div');
    overlay.className = 'it-overlay';
    overlay.innerHTML = '<section class="it-modal" role="dialog" aria-modal="true" aria-labelledby="itTitle">'
      + '<header><div><span>투자도구</span><h2 id="itTitle">물타기 계산기</h2><p>현재 보유분과 추가 매수를 합친 새 평균단가를 계산합니다.</p></div><button type="button" class="it-close" aria-label="닫기">✕</button></header>'
      + '<div class="it-input-grid">'
      + '<label><span>현재 보유 수량</span><input inputmode="decimal" data-it="currentQuantity" placeholder="예: 10"></label>'
      + '<label><span>현재 평균단가</span><input inputmode="decimal" data-it="currentAverage" placeholder="예: 120,000"></label>'
      + '<label><span>추가 매수 수량</span><input inputmode="decimal" data-it="buyQuantity" placeholder="예: 5"></label>'
      + '<label><span>추가 매수 가격</span><input inputmode="decimal" data-it="buyPrice" placeholder="예: 100,000"></label>'
      + '</div><div class="it-results" aria-live="polite">'
      + '<article class="it-primary"><span>새 평균단가</span><strong data-it-result="average">-</strong></article>'
      + '<article><span>총 보유 수량</span><strong data-it-result="quantity">-</strong></article>'
      + '<article><span>총 투자금액</span><strong data-it-result="cost">-</strong></article>'
      + '<article><span>기존 평단 대비</span><strong data-it-result="change">-</strong></article>'
      + '<article><span>추가 매수가 → 새 평단</span><strong data-it-result="recovery">-</strong></article>'
      + '</div><p class="it-note">수수료와 세금은 포함하지 않은 단순 평균단가 계산입니다.</p></section>';
    document.body.appendChild(overlay);
    var oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function close() { overlay.remove(); document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); }
    function onKey(event) { if (event.key === 'Escape') close(); }
    function render() {
      var values = {};
      overlay.querySelectorAll('[data-it]').forEach(function (input) { values[input.getAttribute('data-it')] = numberValue(input); });
      var result = calculateAverage(values.currentQuantity, values.currentAverage, values.buyQuantity, values.buyPrice);
      var set = function (key, value) { overlay.querySelector('[data-it-result="' + key + '"]').textContent = value; };
      if (!result) { ['average', 'quantity', 'cost', 'change', 'recovery'].forEach(function (key) { set(key, '-'); }); return; }
      set('average', formatNumber(result.average, 2) + '원');
      set('quantity', formatNumber(result.totalQuantity, 4) + '주');
      set('cost', formatNumber(result.totalCost, 0) + '원');
      set('change', result.averageChangePct == null ? '-' : (result.averageChangePct > 0 ? '+' : '') + result.averageChangePct.toFixed(2) + '%');
      set('recovery', result.recoveryPct == null ? '-' : (result.recoveryPct > 0 ? '+' : '') + result.recoveryPct.toFixed(2) + '%');
    }
    overlay.addEventListener('input', render);
    overlay.querySelector('.it-close').addEventListener('click', close);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    overlay.querySelector('input').focus();
  }

  var api = { calculateAverage: calculateAverage, openAveraging: openAveraging };
  global.NineInvestTools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
