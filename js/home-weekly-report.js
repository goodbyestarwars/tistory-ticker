/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * Saturday 06:00 through Monday 07:00 uses this compact weekend view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20260816-weekend-lineart-v2';

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
  function formatStockPrice(item) {
    var code = String((item && (item.code || item.symbol)) || '');
    return formatPrice(item && item.price, code) + (item && /^US:/i.test(code) ? '' : '원');
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
  function dateLabel(value) {
    var text = String(value || '');
    var match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    return match[2] + '/' + match[3];
  }
  function newsTimeline(items) {
    if (!items || !items.length) return '<p class="hwr-empty">완료된 주간 뉴스가 없습니다.</p>';
    return '<div class="hwr-news-timeline">' + items.slice(0, 20).map(function (item, index) {
      var market = item.market === '미국' ? '미국' : '한국';
      return '<a class="hwr-news-row" href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">'
        + '<span class="hwr-news-rail"><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></span>'
        + '<time>' + escapeHtml(dateLabel(item.pubDate)) + '</time>'
        + '<b class="hwr-news-market hwr-news-market--' + market + '">' + market + '</b>'
        + '<span><strong>' + escapeHtml(item.title || '제목 없음') + '</strong><small>' + escapeHtml(item.source || '') + '</small></span></a>';
    }).join('') + '</div>';
  }
  function stockList(items, market) {
    if (!items || !items.length) return '<p class="hwr-empty">마지막 거래일 순위를 받지 못했습니다.</p>';
    return '<ul class="hwr-stock-list">' + items.slice(0, 10).map(function (item) {
      var tags = (item.tags || []).slice(0, 2).join(' · ');
      var meta = market === 'us' ? item.code : item.code + (tags ? ' · ' + tags : '');
      return '<li><span class="hwr-stock-name"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(meta) + '</small></span><span class="hwr-stock-values"><b>' + escapeHtml(formatStockPrice(item)) + '</b><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b></span></li>';
    }).join('') + '</ul>';
  }
  function scheduleList(items) {
    if (!items || !items.length) return '<p class="hwr-empty">확인된 핵심 일정이 없습니다.</p>';
    return '<ul class="hwr-schedule-list">' + items.slice(0, 16).map(function (item) {
      return '<li><time>' + escapeHtml(item.date.slice(5)) + '</time><b class="hwr-schedule-market">' + escapeHtml(item.market === 'us' ? '미국' : '한국') + '</b><span>' + escapeHtml(item.title) + (item.symbol ? ' <small>' + escapeHtml(item.symbol) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }
  function isWeekendWindow(date) {
    var kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    var day = kst.getUTCDay();
    var hour = kst.getUTCHours();
    return (day === 6 && hour >= 6) || day === 0 || (day === 1 && hour < 7);
  }
  function render(root, payload) {
    var data = payload && payload.data ? payload.data : payload || {};
    var weekendDay = new Date().getDay();
    var title = weekendDay === 0 || weekendDay === 1 ? '다음 주 준비 리포트' : '한 주 마감 리포트';
    var subtitle = weekendDay === 0 || weekendDay === 1 ? '지난주 흐름과 다음 주 핵심 일정만 간결하게 확인합니다.' : '이번 주 시장 흐름과 주요 이슈를 한 화면에 정리합니다.';
    var indices = data.indices || [];
    var fx = data.fx || {};
    root.innerHTML = '<div class="hwr-head"><div class="hwr-head-copy"><span class="hwr-eyebrow">WEEKEND BRIEF</span><h2>' + title + '</h2><p>' + subtitle + '</p></div><svg class="hwr-line-art" viewBox="0 0 150 54" aria-hidden="true"><path d="M4 43h142M8 38l18-16 15 9 18-20 16 13 18-3 19 13 18-19 20 12"/><path d="M10 48h10M30 48h10M50 48h10M70 48h10M90 48h10M110 48h10M130 48h10"/></svg><div class="hwr-period">' + escapeHtml(data.week && data.week.label || '기준일 확인 중') + '<small>금요일 장 마감 기준</small></div></div>'
      + '<p class="hwr-basis"><b>주간뉴스 기준</b> ' + escapeHtml(data.news && data.news.basis || '완료된 월요일~금요일 발행 뉴스') + '</p>'
      + '<div class="hwr-index-grid">' + indices.map(function (item) {
        return '<article class="hwr-index-card"><div><strong>' + escapeHtml(item.name) + '</strong><span class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span></div><b>' + formatPrice(item.end, item.symbol) + '</b><div class="hwr-spark">' + sparkline(item.series) + '</div><small>' + (item.available ? '주간 종가 추이' : '데이터 없음') + '</small></article>';
      }).join('') + '</div>'
      + '<div class="hwr-summary-row"><article><span>원/달러 환율</span><strong>' + formatPrice(fx.price || (fx.chart && fx.chart[fx.chart.length - 1] && fx.chart[fx.chart.length - 1].close), 'KRW') + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b><small>주간 데이터 기준</small></article><p class="hwr-source-note">국내 지수: KRX/KIS · 미국 지수: 네이버·KIS<br>종목: 마지막 거래일 순위를 상승·하락·거래량·회전율로 분산</p></div>'
      + '<div class="hwr-columns"><article><div class="hwr-card-title"><strong>이번 주 뜨거운 국내 종목</strong><span>신호를 분산해 선정</span></div>' + stockList(data.hotStocks && data.hotStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>이번 주 미국 종목</strong><span>현재가 · 주간 등락률</span></div>' + stockList(data.hotStocks && data.hotStocks.us, 'us') + '</article></div>'
      + '<article class="hwr-news-card"><div class="hwr-card-title"><strong>주간 경제 종합뉴스</strong><span>한국·미국 통합 타임라인</span></div>' + newsTimeline(data.news && data.news.timeline) + '</article>'
      + '<article class="hwr-schedule"><div class="hwr-card-title"><strong>다음 주 핵심 스케줄</strong><span>' + escapeHtml(data.scheduleBasis || '확인된 주요 일정만 표시') + '</span></div>' + scheduleList(data.schedule) + '</article>'
      + '<p class="hwr-disclaimer">뉴스·일정은 수집 시점에 확인된 제목과 발표일만 표시합니다. 투자 판단의 단독 근거로 사용하지 마세요.</p>';
  }
  function init() {
    if (!isWeekendWindow(new Date())) return null;
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
