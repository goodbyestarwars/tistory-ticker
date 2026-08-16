/**
 * Weekend weekly market recap. Weekdays keep the existing live dashboard;
 * Saturday shows the completed-week recap and Sunday emphasizes next-week prep.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20260816-weekly-report-v1';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : null;
  }
  function signed(value, digits) {
    var parsed = num(value);
    if (parsed == null) return '-';
    return (parsed > 0 ? '+' : '') + parsed.toFixed(digits == null ? 2 : digits) + '%';
  }
  function compact(value) {
    var parsed = num(value);
    if (parsed == null) return '-';
    var absolute = Math.abs(parsed);
    if (absolute >= 1000000000000) return (parsed / 1000000000000).toFixed(1) + '조';
    if (absolute >= 100000000) return (parsed / 100000000).toFixed(1) + '억';
    if (absolute >= 10000) return (parsed / 10000).toFixed(1) + '만';
    return parsed.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }
  function formatPrice(value, symbol) {
    var parsed = num(value);
    if (parsed == null) return '-';
    return symbol && /^US/i.test(symbol) ? '$' + parsed.toLocaleString('en-US', { maximumFractionDigits: 2 }) : parsed.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  function signClass(value) { return num(value) > 0 ? 'is-up' : num(value) < 0 ? 'is-down' : 'is-flat'; }
  function sparkline(points) {
    if (!points || points.length < 2) return '<span class="hwr-no-chart">추이 데이터 없음</span>';
    var values = points.map(function (point) { return num(point.close); }).filter(function (value) { return value != null; });
    if (values.length < 2) return '<span class="hwr-no-chart">추이 데이터 없음</span>';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), range = max - min || 1;
    var poly = values.map(function (value, index) {
      var x = 2 + index * 96 / Math.max(1, values.length - 1);
      var y = 30 - (value - min) / range * 26;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + poly + '"></polyline></svg>';
  }
  function itemList(items, empty) {
    if (!items || !items.length) return '<p class="hwr-empty">' + escapeHtml(empty || '이번 주 데이터가 없습니다.') + '</p>';
    return '<ul>' + items.map(function (item) {
      return '<li><a href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">' + escapeHtml(item.title || item.name || '제목 없음') + '</a><small>' + escapeHtml(item.source || item.pubDate || '') + '</small></li>';
    }).join('') + '</ul>';
  }
  function stockList(items) {
    if (!items || !items.length) return '<p class="hwr-empty">마지막 거래일 순위를 받지 못했습니다.</p>';
    return '<ul class="hwr-stock-list">' + items.slice(0, 10).map(function (item) {
      var tags = (item.tags || []).join(' · ');
      return '<li><span class="hwr-stock-name"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.code) + ' · ' + escapeHtml(tags) + '</small></span><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b></li>';
    }).join('') + '</ul>';
  }
  function scheduleList(items) {
    if (!items || !items.length) return '<p class="hwr-empty">등록된 다음 주 실적 일정이 없습니다.</p>';
    return '<ul class="hwr-schedule-list">' + items.slice(0, 12).map(function (item) {
      return '<li><time>' + escapeHtml(item.date) + '</time><span>' + escapeHtml(item.title) + (item.symbol ? ' <small>' + escapeHtml(item.symbol) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }
  function render(root, payload) {
    var data = payload && payload.data ? payload.data : payload || {};
    var weekendDay = new Date().getDay();
    var title = weekendDay === 0 ? '다음 주 준비 리포트' : '한 주 마감 리포트';
    var subtitle = weekendDay === 0 ? '지난주 흐름을 정리하고 다음 주 일정을 확인합니다.' : '국내·미국 시장의 지난주 흐름을 한 화면에 정리합니다.';
    var indices = data.indices || [];
    var fx = data.fx || {};
    root.innerHTML = '<div class="hwr-head"><div><span class="hwr-eyebrow">WEEKLY MARKET</span><h2>' + title + '</h2><p>' + subtitle + '</p></div><div class="hwr-period">' + escapeHtml(data.week && data.week.label || '기준일 확인 중') + '<small>금요일 마감 기준</small></div></div>'
      + '<div class="hwr-index-grid">' + indices.map(function (item) {
        return '<article class="hwr-index-card"><div><strong>' + escapeHtml(item.name) + '</strong><span class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span></div><b>' + formatPrice(item.end, item.symbol) + '</b><div class="hwr-spark">' + sparkline(item.series) + '</div><small>' + (item.available ? '주간 종가 추이' : '데이터 없음') + '</small></article>';
      }).join('') + '</div>'
      + '<div class="hwr-summary-row"><article><span>원/달러 환율</span><strong>' + formatPrice(fx.price || (fx.chart && fx.chart[fx.chart.length - 1] && fx.chart[fx.chart.length - 1].close), 'KRW') + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b><small>주간 데이터 기준</small></article><p class="hwr-source-note">국내 지수 기준: KRX/KIS 수집 데이터 · 미국 지수: 네이버·KIS 수집 데이터<br>종목 순위는 마지막 거래일 KIS 순위와 키움 폴백 결과를 사용합니다.</p></div>'
      + '<div class="hwr-columns"><article><div class="hwr-card-title"><strong>이번 주 뜨거운 국내 종목</strong><span>상승·하락·거래량 급증</span></div>' + stockList(data.hotStocks && data.hotStocks.domestic) + '</article><article><div class="hwr-card-title"><strong>이번 주 뜨거운 미국 종목</strong><span>상승·하락·체결강도</span></div>' + stockList(data.hotStocks && data.hotStocks.us) + '</article></div>'
      + '<div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국 뉴스</strong><span>이번 주 주요 제목</span></div>' + itemList(data.news && data.news.domestic, '이번 주 국내 뉴스가 없습니다.') + '</article><article><div class="hwr-card-title"><strong>미국 뉴스</strong><span>이번 주 주요 제목</span></div>' + itemList(data.news && data.news.us, '이번 주 미국 뉴스가 없습니다.') + '</article></div>'
      + '<article class="hwr-schedule"><div class="hwr-card-title"><strong>다음 주 스케줄</strong><span>실적 발표·확인된 일정</span></div>' + scheduleList(data.schedule) + '</article>'
      + '<p class="hwr-disclaimer">뉴스·일정은 수집 시점에 확인된 제목과 발표일만 표시합니다. 투자 판단의 단독 근거로 사용하지 마세요.</p>';
  }
  function init() {
    var day = new Date().getDay();
    if (day !== 0 && day !== 6) return null;
    var feed = document.querySelector('.feed');
    if (!feed || document.getElementById('homeWeeklyReport')) return null;
    if (!document.querySelector('link[data-home-weekly-report-css]')) {
      var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = CSS_URL; link.setAttribute('data-home-weekly-report-css', '1'); document.head.appendChild(link);
    }
    var root = document.createElement('section');
    root.id = 'homeWeeklyReport'; root.className = 'home-weekly-report';
    root.innerHTML = '<div class="hwr-loading"><strong>주간 리포트를 준비하는 중입니다.</strong><span>지수·뉴스·일정을 묶고 있습니다.</span></div>';
    var dashboard = feed.querySelector('.home-dashboard');
    feed.insertBefore(root, dashboard || feed.firstChild);
    fetch(API_URL).then(function (response) { if (!response.ok) throw new Error('weekly report ' + response.status); return response.json(); }).then(function (payload) { render(root, payload); }).catch(function () { root.innerHTML = '<div class="hwr-loading"><strong>주간 리포트를 잠시 불러오지 못했습니다.</strong><span>기존 실시간 시장판은 계속 이용할 수 있습니다.</span></div>'; });
    return root;
  }
  global.HomeWeeklyReport = { init: init };
})(window);
