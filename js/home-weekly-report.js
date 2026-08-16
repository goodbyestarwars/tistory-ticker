/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * Saturday 06:00 through Monday 07:00 uses this compact weekend view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20260816-weekend-lineart-v6';

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
  function sparkline(points, className) {
    if (!points || points.length < 2) return '<span class="hwr-no-chart">추이 데이터 없음</span>';
    var values = points.map(function (point) { return num(point.close); }).filter(function (value) { return value != null; });
    if (values.length < 2) return '<span class="hwr-no-chart">추이 데이터 없음</span>';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), range = max - min || 1;
    var poly = values.map(function (value, index) {
      var x = 2 + index * 96 / Math.max(1, values.length - 1);
      var y = 30 - (value - min) / range * 26;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="' + escapeHtml(className || '') + '" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + poly + '"></polyline></svg>';
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
        + '<b class="hwr-news-market hwr-news-market--' + market + '">' + market + '</b>'
        + '<span><strong>' + escapeHtml(item.title || '제목 없음') + '</strong><small>' + escapeHtml(item.source || '') + '</small></span>'
        + '<time>' + escapeHtml(dateLabel(item.pubDate)) + '</time></a>';
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
  function stockListWithReasons(items, market) {
    if (!items || !items.length) return '<p class="hwr-empty">해당 조건의 종목을 찾지 못했습니다.</p>';
    return '<ul class="hwr-stock-list">' + items.slice(0, 8).map(function (item) {
      var tags = (item.tags || []).slice(0, 2).join(' · ');
      var meta = market === 'us' ? item.code : item.code + (tags ? ' · ' + tags : '');
      return '<li><span class="hwr-stock-name"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(meta) + '</small><em class="hwr-stock-reason">' + escapeHtml(item.reason || '순위·등락 데이터 기준') + '</em></span><span class="hwr-stock-values"><b>' + escapeHtml(formatStockPrice(item)) + '</b><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b></span></li>';
    }).join('') + '</ul>';
  }
  function indexSummary(indices) {
    var rows = (indices || []).filter(function (item) { return item && num(item.changeRate) != null; });
    if (!rows.length) return '<div class="hwr-index-summary"><span>지수 흐름</span><b>데이터 확인 중</b></div>';
    return '<div class="hwr-index-summary" aria-label="주간 지수 요약"><span>주간 지수 요약</span>' + rows.map(function (item) {
      return '<b><small>' + escapeHtml(item.name) + '</small><strong class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</strong></b>';
    }).join('') + '</div>';
  }
  function sentimentArt(indices) {
    var values = (indices || []).map(function (item) { return num(item && item.changeRate); }).filter(function (value) { return value != null; });
    var bullish = values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) >= 0 : true;
    if (bullish) {
      return '<div class="hwr-sentiment hwr-sentiment--up" aria-label="상승 흐름"><svg viewBox="0 0 150 72" role="img" aria-hidden="true"><path d="M18 51c8-14 17-22 31-22 9 0 15 4 22 10l12-13 11 5 12-12 19 8 8 18-10 5-11-7-10 9-15-4c-8 13-18 19-31 19-16 0-28-4-38-16Z"/><path d="M68 39c8-12 16-20 25-23l8-10 3 14 13-6 8 8"/><path d="M28 31 15 18M32 28 23 11M108 28l17-12M113 32l20-4"/><circle cx="112" cy="28" r="2"/></svg><strong>상승 흐름</strong></div>';
    }
    return '<div class="hwr-sentiment hwr-sentiment--down" aria-label="하락 흐름"><svg viewBox="0 0 150 72" role="img" aria-hidden="true"><path d="M19 48c8-13 18-20 31-20 11 0 18 5 25 14l13-8 11 5 12-11 19 5 8 17-10 6-12-6-10 9-16-3c-8 11-18 16-31 16-16 0-29-6-40-24Z"/><path d="M66 39c8-12 16-18 27-21l7-10 7 13 14-3 10 9"/><path d="M31 29 18 13M38 27 31 8M108 29l16-15M114 34l21 0"/><circle cx="115" cy="30" r="2"/></svg><strong>하락 흐름</strong></div>';
  }
  function fxStatus(fx) {
    var analysis = fx && fx.analysis || {};
    var status = analysis.status || 'unknown';
    var label = analysis.label || '환율 데이터 확인 중';
    var message = analysis.message || '1년 환율 데이터가 부족합니다.';
    return '<span class="hwr-fx-status hwr-fx-status--' + escapeHtml(status) + '">' + escapeHtml(label) + '</span><small>' + escapeHtml(message) + '</small>';
  }
  function fxCard(fx) {
    fx = fx || {};
    var analysis = fx.analysis || {};
    var current = analysis.current != null ? analysis.current : fx.price;
    var average = analysis.average;
    return '<article class="hwr-fx-card"><div class="hwr-card-title"><strong>원/달러 환율</strong><span>최근 1년 기준</span></div><div class="hwr-fx-main"><strong>' + (current == null ? '-' : formatPrice(current, 'KRW') + '원') + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b></div><div class="hwr-fx-chart">' + sparkline(fx.chart, 'hwr-fx-spark') + '</div><div class="hwr-fx-meta"><span>1년 평균 ' + (average == null ? '-' : formatPrice(average, 'KRW') + '원') + '</span>' + fxStatus(fx) + '</div></article>';
  }
  function scheduleList(items) {
    if (!items || !items.length) return '<p class="hwr-empty">다음 주 M7·금리·주요 기업 일정이 확인되지 않았습니다.</p>';
    return '<ul class="hwr-schedule-list">' + items.slice(0, 16).map(function (item) {
      var isUs = item.market === 'us' || /^[A-Z]{1,6}$/.test(String(item.symbol || '')) || /미국|Finnhub|\$[A-Z]/i.test(String(item.title || ''));
      return '<li><time>' + escapeHtml(String(item.date || '').slice(5)) + '</time><b class="hwr-schedule-market">' + (isUs ? '미국' : '한국') + '</b><span>' + escapeHtml(item.title) + (item.symbol ? ' <small>' + escapeHtml(item.symbol) + '</small>' : '') + '</span></li>';
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
    var subtitle = weekendDay === 0 || weekendDay === 1 ? '한국·미국 증시 흐름과 다음 주 핵심 일정·뉴스를 한 화면에 통합합니다.' : '이번 주 시장 흐름과 주요 이슈를 한 화면에 정리합니다.';
    var indices = data.indices || [];
    var fx = data.fx || {};
    root.innerHTML = '<div class="hwr-head"><div class="hwr-head-copy"><span class="hwr-eyebrow">WEEKEND BRIEF</span><h2>' + title + '</h2><p>' + subtitle + '</p></div>' + sentimentArt(indices) + '<div class="hwr-period">' + escapeHtml(data.week && data.week.label || '기준일 확인 중') + '<small>금요일 장 마감 기준</small></div></div>'
      + indexSummary(indices)
      + '<div class="hwr-index-grid">' + indices.map(function (item) {
        return '<article class="hwr-index-card"><div><strong>' + escapeHtml(item.name) + '</strong><span class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span></div><b>' + formatPrice(item.end, item.symbol) + '</b><div class="hwr-spark">' + sparkline(item.series) + '</div><small>' + (item.available ? '주간 종가 추이' : '데이터 없음') + '</small></article>';
      }).join('') + '</div>'
      + '<div class="hwr-summary-row"><div>' + fxCard(fx) + '</div><p class="hwr-source-note"><b>데이터 출처</b><br>지수: 국내 KRX/KIS · 미국 네이버·KIS<br>한국 뉴스: 네이버 뉴스 · DART 공시<br>미국 뉴스: Finnhub · Alpha Vantage (설정된 공급자 기준)<br><small>환율 구간은 최근 1년 관측값을 기준으로 한 참고용 분류입니다.</small></p></div>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>뜨거운 종목</strong><span>상승·수급·거래대금 신호와 사유</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.us, 'us') + '</article></div></section>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>차가운 종목</strong><span>하락률 상위 중 유동성 종목 우선</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.us, 'us') + '</article></div></section>'
      + '<article class="hwr-news-card"><div class="hwr-card-title"><strong>주간 경제 종합뉴스</strong><span>한국·미국 통합 타임라인 · 날짜순</span></div>' + newsTimeline(data.news && data.news.timeline) + '</article>'
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
