/* 주요 미국 발표: 가격 차트와 섞지 않고 발표 일정과 최신 수치를 읽는 전용 탭. */
(function (global) {
  'use strict';

  var ROOT_ID = 'us-macro-indicators';
  var API = 'https://goodbyestar.cloud/futures';
  var SYMBOLS = ['US_CPI', 'US_PPI', 'US_REAL_GDP_GROWTH', 'US_UNEMPLOYMENT', 'US_RETAIL_SALES'];
  var REFRESH_MS = 30 * 60 * 1000;
  // 연준이 공표한 2026년 잔여 회의와 공표된 2027년 1월 회의. 다음 일정이 공표되면 이어 붙인다.
  var FOMC_DATES = ['2026-10-27', '2026-12-08', '2027-01-26'];
  var META = {
    US_CPI: { label: '소비자물가지수', unit: 'pt', cadence: '월간 · CPI' },
    US_PPI: { label: '생산자물가지수', unit: 'pt', cadence: '월간 · PPI' },
    US_REAL_GDP_GROWTH: { label: '실질 GDP 성장률', unit: '%', cadence: '분기 · 연율' },
    US_UNEMPLOYMENT: { label: '실업률', unit: '%', cadence: '월간 · 가계조사' },
    US_RETAIL_SALES: { label: '소매판매', unit: '백만 달러', cadence: '월간 · 소매판매' }
  };
  var timer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function nextFomc_() {
    var now = new Date();
    for (var i = 0; i < FOMC_DATES.length; i++) {
      if (new Date(FOMC_DATES[i] + 'T00:00:00+09:00') >= now) return FOMC_DATES[i];
    }
    return '';
  }

  function dateLabel_(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value.replace(/-/g, '.') : '일정 확인 중';
  }

  function itemDate_(item) {
    var chart = item && item.chart;
    return chart && chart.length ? chart[chart.length - 1].date : '';
  }

  function value_(symbol, item) {
    var value = Number(item && item.price);
    if (!isFinite(value)) return '-';
    var digits = symbol === 'US_RETAIL_SALES' ? 0 : 1;
    return value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' ' + META[symbol].unit;
  }

  function change_(item) {
    var value = Number(item && item.change);
    if (!isFinite(value)) return '전회 비교 데이터 없음';
    return '전회 대비 ' + (value > 0 ? '+' : '') + value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }

  function card_(symbol, item) {
    var meta = META[symbol];
    return '<article class="umi-card"><small>' + escapeHtml(meta.cadence) + '</small><strong>' + escapeHtml(meta.label) + '</strong>'
      + '<b>' + escapeHtml(value_(symbol, item)) + '</b><span>' + escapeHtml(change_(item))
      + (itemDate_(item) ? ' · ' + escapeHtml(itemDate_(item).replace(/-/g, '.')) + ' 발표값' : '') + '</span></article>';
  }

  function shell_() {
    var next = nextFomc_();
    return '<section class="umi" aria-label="주요 미국 발표">'
      + '<div class="umi-head"><div><h2>주요 미국 발표</h2><p>발표 수치는 시장 가격이 아니라 최신 공표값입니다. 금리는 글로벌 시장지표의 채권 카드에서 확인하세요.</p></div>'
      + '<button type="button" class="umi-refresh" data-umi-refresh>갱신</button></div>'
      + '<div class="umi-grid"><article class="umi-card umi-card--fomc"><small>통화정책 일정</small><strong>다음 FOMC 회의</strong><b>' + escapeHtml(dateLabel_(next)) + '</b><span>' + (next ? escapeHtml(next.slice(5).replace('-', '/') + ' 시작') : '연준 공식 일정 확인 필요') + '</span></article>'
      + '<div data-umi-cards class="umi-grid umi-grid--data"><p class="umi-state">발표값을 불러오는 중입니다.</p></div></div></section>';
  }

  function refresh_(root) {
    var target = root.querySelector('[data-umi-cards]');
    var button = root.querySelector('[data-umi-refresh]');
    if (!target) return;
    if (button) { button.disabled = true; button.textContent = '갱신 중'; }
    fetch(API + '?interval=day&days=400&symbols=' + encodeURIComponent(SYMBOLS.join(',')))
      .then(function (response) { if (!response.ok) throw new Error('macro response'); return response.json(); })
      .then(function (payload) {
        var bySymbol = {};
        ((payload && payload.data) || []).forEach(function (item) { bySymbol[item.symbol] = item; });
        target.innerHTML = SYMBOLS.map(function (symbol) { return card_(symbol, bySymbol[symbol] || {}); }).join('');
      })
      .catch(function () { target.innerHTML = '<p class="umi-state">발표값을 불러오지 못했습니다. 잠시 후 다시 갱신해 주세요.</p>'; })
      .finally(function () { if (button) { button.disabled = false; button.textContent = '갱신'; } });
  }

  function init() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.innerHTML = shell_();
    var button = root.querySelector('[data-umi-refresh]');
    if (button) button.addEventListener('click', function () { refresh_(root); });
    refresh_(root);
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) refresh_(root); }, REFRESH_MS);
  }

  global.UsMacroIndicators = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
