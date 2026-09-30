/* 주요 미국 발표: 가격 차트와 섞지 않고 발표 일정과 최신 수치를 읽는 전용 탭. */
(function (global) {
  'use strict';

  var ROOT_ID = 'us-macro-indicators';
  var API = 'https://goodbyestar.cloud/futures';
  // 물가·고용·경기를 한쪽으로 치우치지 않게 읽는 최소 세트. 금리는 글로벌 시장지표에만 둔다.
  var SYMBOLS = [
    'US_CPI', 'US_CORE_CPI', 'US_CORE_PCE', 'US_PPI',
    'US_NONFARM_PAYROLLS', 'US_UNEMPLOYMENT',
    'US_RETAIL_SALES', 'US_REAL_GDP_GROWTH', 'US_CONSUMER_SENTIMENT'
  ];
  var REFRESH_MS = 30 * 60 * 1000;
  // 연준이 공표한 2026년 잔여 회의와 2027년 일정. FOMC 공표 전에는 확정 일정이 아니므로
  // 별도 데이터 수집값처럼 다루지 않고, 공식 일정이 바뀔 때만 이 목록을 갱신한다.
  var FOMC_DATES = ['2026-10-27', '2026-12-08', '2027-01-26', '2027-03-16', '2027-04-27', '2027-06-08', '2027-07-27', '2027-09-14', '2027-10-26', '2027-12-07'];
  var INFLATION_SYMBOLS = { US_CPI: true, US_CORE_CPI: true, US_CORE_PCE: true, US_PPI: true };
  var META = {
    US_CPI: { label: '소비자물가지수 (CPI)', unit: 'pt', cadence: '월간 · 헤드라인 CPI', category: '물가', source: 'BLS' },
    US_CORE_CPI: { label: '근원 소비자물가지수', unit: 'pt', cadence: '월간 · Core CPI', category: '물가', source: 'BLS' },
    US_CORE_PCE: { label: '근원 PCE 물가', unit: 'pt', cadence: '월간 · Core PCE', category: '물가', source: 'BEA' },
    US_PPI: { label: '생산자물가지수 (PPI)', unit: 'pt', cadence: '월간 · 생산단 물가', category: '물가', source: 'BLS' },
    US_NONFARM_PAYROLLS: { label: '비농업고용', unit: '천 명', cadence: '월간 · 고용보고서', category: '고용', source: 'BLS' },
    US_UNEMPLOYMENT: { label: '실업률', unit: '%', cadence: '월간 · 가계조사', category: '고용', source: 'BLS' },
    US_RETAIL_SALES: { label: '소매판매', unit: '백만 달러', cadence: '월간 · 소비', category: '경기', source: 'Census' },
    US_REAL_GDP_GROWTH: { label: '실질 GDP 성장률', unit: '%', cadence: '분기 · 연율', category: '경기', source: 'BEA' },
    US_CONSUMER_SENTIMENT: { label: '소비자심리지수', unit: 'pt', cadence: '월간 · 미시간대', category: '경기', source: 'UMich' }
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
    var text = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/-/g, '.');
    if (/^\d{8}$/.test(text)) return text.slice(0, 4) + '.' + text.slice(4, 6) + '.' + text.slice(6, 8);
    return '일정 확인 중';
  }

  function itemDate_(item) {
    var chart = item && item.chart;
    return chart && chart.length ? chart[chart.length - 1].date : '';
  }

  function number_(value, digits) {
    return Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function value_(symbol, item) {
    var value = Number(item && item.price);
    if (!isFinite(value)) return '-';
    var digits = (symbol === 'US_RETAIL_SALES' || symbol === 'US_NONFARM_PAYROLLS') ? 0 : 1;
    return number_(value, digits) + ' ' + META[symbol].unit;
  }

  function change_(item, suffix) {
    var value = Number(item && item.change);
    if (!isFinite(value)) return '전회 비교 데이터 없음';
    return '전회 대비 ' + (value > 0 ? '+' : '') + number_(value, 2) + (suffix || '');
  }

  function yearAgo_(item) {
    var chart = (item && item.chart) || [];
    var latest = chart[chart.length - 1];
    if (!latest || !/^\d{8}$/.test(String(latest.date || ''))) return NaN;
    var target = String(Number(String(latest.date).slice(0, 4)) - 1) + String(latest.date).slice(4, 6);
    for (var i = chart.length - 2; i >= 0; i--) {
      if (String(chart[i].date || '').slice(0, 6) === target && isFinite(Number(chart[i].close))) return Number(chart[i].close);
    }
    return NaN;
  }

  function yearChange_(item) {
    var current = Number(item && item.price);
    var prior = yearAgo_(item);
    if (!isFinite(current) || !isFinite(prior) || !prior) return NaN;
    return (current - prior) / prior * 100;
  }

  function keyValue_(symbol, item) {
    var change = Number(item && item.change);
    var yoy = yearChange_(item);
    if (INFLATION_SYMBOLS[symbol] && isFinite(yoy)) return '전년 동월 ' + (yoy > 0 ? '+' : '') + number_(yoy, 2) + '%';
    if (symbol === 'US_NONFARM_PAYROLLS' && isFinite(change)) return '전월 ' + (change > 0 ? '+' : '') + number_(change, 0) + '천 명';
    if (symbol === 'US_RETAIL_SALES' && isFinite(change)) {
      var rate = Number(item && item.change_rate);
      return isFinite(rate) ? '전월 ' + (rate > 0 ? '+' : '') + number_(rate, 2) + '%' : change_(item);
    }
    return value_(symbol, item);
  }

  function detail_(symbol, item) {
    var parts = [];
    if (INFLATION_SYMBOLS[symbol] || symbol === 'US_NONFARM_PAYROLLS' || symbol === 'US_RETAIL_SALES') parts.push('발표값 ' + value_(symbol, item));
    var suffix = symbol === 'US_NONFARM_PAYROLLS' ? '천 명' : '';
    parts.push(change_(item, suffix));
    var date = itemDate_(item);
    if (date) parts.push(dateLabel_(date) + ' 기준');
    return parts.join(' · ');
  }

  function recentValues_(item) {
    return ((item && item.chart) || []).map(function (point) { return Number(point && point.close); })
      .filter(function (value) { return isFinite(value); }).slice(-12);
  }

  function average_(symbol, item) {
    var values = recentValues_(item);
    if (!values.length) return '-';
    var value = values.reduce(function (sum, item) { return sum + item; }, 0) / values.length;
    var digits = (symbol === 'US_RETAIL_SALES' || symbol === 'US_NONFARM_PAYROLLS') ? 0 : 1;
    return number_(value, digits) + ' ' + META[symbol].unit;
  }

  function miniChart_(item) {
    var values = recentValues_(item);
    if (values.length < 2) return '';
    var low = Math.min.apply(Math, values);
    var high = Math.max.apply(Math, values);
    var span = high - low || 1;
    var points = values.map(function (value, index) {
      return (index / (values.length - 1) * 116 + 2).toFixed(1) + ',' + (28 - (value - low) / span * 22).toFixed(1);
    }).join(' ');
    return '<svg class="umi-mini-chart" viewBox="0 0 120 32" preserveAspectRatio="none" aria-label="최근 12회 발표 흐름"><polyline points="' + points + '"></polyline><circle cx="118" cy="' + (28 - (values[values.length - 1] - low) / span * 22).toFixed(1) + '" r="2.4"></circle></svg>';
  }

  function readGuide_(symbol) {
    var guides = {
      US_CPI: '물가 목표는 연 2% 부근', US_CORE_CPI: '추세 물가는 완만한 둔화가 중요', US_CORE_PCE: '연준이 주로 보는 물가 지표', US_PPI: '소비자물가보다 앞서 움직일 수 있음',
      US_NONFARM_PAYROLLS: '고용 증감보다 추세 둔화를 함께 확인', US_UNEMPLOYMENT: '4% 안팎은 통상 안정 범위', US_RETAIL_SALES: '전월 대비와 3개월 흐름을 같이 확인',
      US_REAL_GDP_GROWTH: '연율 2% 안팎이면 완만한 성장', US_CONSUMER_SENTIMENT: '장기 평균과의 차이를 확인'
    };
    return guides[symbol] || '';
  }

  function card_(symbol, item) {
    var meta = META[symbol];
    var primary = symbol === 'US_CPI' ? ' umi-card--primary' : '';
    return '<article class="umi-card' + primary + '"><small>' + escapeHtml(meta.category + ' · ' + meta.cadence) + '</small><strong>' + escapeHtml(meta.label) + '</strong>'
      + '<b>' + escapeHtml(keyValue_(symbol, item)) + '</b><span>' + escapeHtml(detail_(symbol, item)) + '</span>'
      + '<div class="umi-reading"><span>최근 12회 평균 <b>' + escapeHtml(average_(symbol, item)) + '</b></span>' + miniChart_(item) + '</div>'
      + '<i><b>읽는 기준</b> · ' + escapeHtml(readGuide_(symbol)) + ' · 출처 ' + escapeHtml(meta.source) + '</i></article>';
  }

  function shell_() {
    var next = nextFomc_();
    return '<section class="umi" aria-label="미국 경제 발표">'
      + '<div class="umi-head"><div><h2>미국 경제 발표</h2><p><b>CPI를 맨 앞</b>에 두고 물가·고용·경기 발표를 한 번에 봅니다. 숫자만 보지 않도록 최근 평균과 12회 흐름, 읽는 기준을 같이 표시합니다. 금리는 글로벌 시장지표에서 확인하세요.</p></div>'
      + '<button type="button" class="umi-refresh" data-umi-refresh>갱신</button></div>'
      + '<div class="umi-grid"><article class="umi-card umi-card--fomc"><small>통화정책 일정</small><strong>다음 FOMC 회의</strong><b>' + escapeHtml(dateLabel_(next)) + '</b><span>' + (next ? escapeHtml(next.slice(5).replace('-', '/') + ' 시작 · 연준 공식 일정') : '연준 공식 일정 확인 필요') + '</span></article>'
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
