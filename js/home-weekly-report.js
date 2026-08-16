/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * Saturday 06:00 through Monday 07:00 uses this compact weekend view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20260816-weekend-lineart-v13';

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
    if (match) return match[2] + '/' + match[3];
    var parsed = new Date(text);
    if (isNaN(parsed.getTime())) return '';
    return String(parsed.getUTCMonth() + 1).padStart(2, '0') + '/' + String(parsed.getUTCDate()).padStart(2, '0');
  }
  function timeLabel(value) {
    var match = String(value || '').match(/(?:T|\s)(\d{1,2}:\d{2})/);
    return match ? match[1] : '';
  }
  function newsType(item) {
    var text = String((item && item.title) || '') + ' ' + String((item && item.source) || '');
    return /(공시|10-[QK]|8-K|분기보고서|사업보고서|증권신고서|유상증자|배당|IPO)/i.test(text) ? '공시' : '뉴스';
  }
  function newsSummary(item) {
    var summary = String((item && (item.summary || item.description)) || '').trim();
    var title = String((item && item.title) || '').trim();
    if (!summary || summary === title) return '';
    return summary.length > 150 ? summary.slice(0, 147) + '…' : summary;
  }
  function newsTimeline(items) {
    if (!items || !items.length) return '<p class="hwr-empty">완료된 주간 뉴스가 없습니다.</p>';
    var rows = items.slice(0, 20).map(function (item, index) {
      var market = item.market === '미국' ? '미국' : '한국';
      var type = newsType(item);
      var summary = newsSummary(item);
      var quote = item.price != null ? '<span class="hwr-news-quote"><b>' + escapeHtml(formatStockPrice(item)) + '</b><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b></span>' : '';
      return '<article class="hwr-news-event" data-news-type="' + type + '">'
        + '<div class="hwr-news-date"><strong>' + escapeHtml(dateLabel(item.pubDate)) + '</strong><small>' + escapeHtml(timeLabel(item.pubDate)) + '</small></div>'
        + '<div class="hwr-news-rail"><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></div>'
        + '<div class="hwr-news-event-body"><div class="hwr-news-event-meta">'
        + '<b class="hwr-news-market hwr-news-market--' + market + '">' + market + '</b>'
        + '<b class="hwr-news-type hwr-news-type--' + type + '">' + type + '</b>'
        + '<small>' + escapeHtml(item.source || '') + '</small></div>'
        + '<h4>' + escapeHtml(item.title || '제목 없음') + '</h4>'
        + (summary ? '<p>' + escapeHtml(summary) + '</p>' : '')
        + '<div class="hwr-news-event-footer">' + quote + '<a href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">원문 보기 ↗</a></div></div></article>';
    }).join('');
    return '<div class="hwr-news-timeline" data-hwr-news-timeline>' + rows + '</div><p class="hwr-news-filter-empty" data-hwr-news-filter-empty hidden>해당 유형의 소식이 없습니다.</p>';
  }
  function bindNewsFilters(root) {
    var buttons = root.querySelectorAll('[data-hwr-news-filter]');
    var events = root.querySelectorAll('[data-news-type]');
    var empty = root.querySelector('[data-hwr-news-filter-empty]');
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var filter = button.getAttribute('data-hwr-news-filter');
        var visible = 0;
        buttons.forEach(function (candidate) {
          var active = candidate === button;
          candidate.classList.toggle('is-active', active);
          candidate.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        events.forEach(function (event) {
          var show = filter === 'all' || event.getAttribute('data-news-type') === filter;
          event.hidden = !show;
          if (show) visible += 1;
        });
        if (empty) empty.hidden = visible > 0;
      });
    });
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
      return '<div class="hwr-sentiment hwr-sentiment--up" aria-label="상승 흐름"><svg viewBox="0 0 160 82" role="img" aria-hidden="true"><path d="M24 50c2-16 15-28 34-29 15-1 28 5 37 16l13-3c11-2 22 2 28 10l-8 7-11-3-8 9-15-2c-8 9-18 13-31 13-18 0-33-7-39-18Z"/><path d="M111 35c7-8 15-11 24-8l9-5-4 10 7 8-16 2-9-7"/><path d="M116 27c-2-8 1-15 8-19M128 26c5-7 12-9 19-6M45 65v11M68 66v11M92 62v10M24 43c-8-2-13-7-16-14"/><circle cx="132" cy="38" r="2"/></svg><strong>상승 흐름</strong></div>';
    }
    return '<div class="hwr-sentiment hwr-sentiment--down" aria-label="하락 흐름"><svg viewBox="0 0 160 82" role="img" aria-hidden="true"><path d="M25 53c0-15 12-27 29-30 15-3 29 2 39 12l14-2c11-2 22 3 27 12l-8 7-12-4-8 8-15-1c-8 9-18 14-31 14-17 0-30-6-35-16Z"/><path d="M111 35c7-8 15-11 24-8l9-5-4 10 7 8-16 2-9-7"/><path d="M115 27c-2-8 1-15 8-19M128 26c5-7 12-9 19-6M46 66v10M69 66v10M93 63v9M25 46c-8-1-13-6-17-13"/><circle cx="132" cy="38" r="2"/></svg><strong>하락 흐름</strong></div>';
  }
  function fxStatus(fx) {
    var analysis = fx && fx.analysis || {};
    var status = analysis.status || 'unknown';
    var label = analysis.label || '환율 데이터 확인 중';
    var message = analysis.message || '1년 환율 데이터가 부족합니다.';
    return '<div class="hwr-fx-advice"><span class="hwr-fx-status hwr-fx-status--' + escapeHtml(status) + '">' + escapeHtml(label) + '</span><small>' + escapeHtml(message) + '</small></div>';
  }
  function fxSparkline(fx) {
    var analysis = fx && fx.analysis || {};
    var points = (fx && fx.chart || []).map(function (point) { return num(point && point.close); }).filter(function (value) { return value != null; });
    if (points.length < 2) return '<div class="hwr-fx-chart hwr-fx-chart--empty">1년 추이 데이터 없음</div>';
    var reference = [analysis.low, analysis.high, analysis.average, analysis.p25, analysis.p75].map(num).filter(function (value) { return value != null; });
    var values = points.concat(reference);
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var range = max - min || 1;
    var pad = range * .08;
    min -= pad; max += pad; range = max - min || 1;
    var y = function (value) { return 39 - ((value - min) / range * 34); };
    var poly = points.map(function (value, index) {
      var x = 2 + index * 96 / Math.max(1, points.length - 1);
      return x.toFixed(1) + ',' + y(value).toFixed(1);
    }).join(' ');
    var low = num(analysis.low), p25 = num(analysis.p25), average = num(analysis.average);
    var bandTop = p25 == null ? 39 : y(p25);
    var bandBottom = low == null ? 39 : y(low);
    var bandHeight = Math.max(0, bandBottom - bandTop);
    var averageLine = average == null ? '' : '<line class="hwr-fx-average-line" x1="0" y1="' + y(average).toFixed(1) + '" x2="100" y2="' + y(average).toFixed(1) + '"></line>';
    var interestBand = p25 == null || low == null ? '' : '<rect class="hwr-fx-interest-band" x="0" y="' + bandTop.toFixed(1) + '" width="100" height="' + bandHeight.toFixed(1) + '" rx="1"></rect>';
    return '<div class="hwr-fx-chart"><svg class="hwr-fx-spark ' + signClass(fx.change_rate) + '" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="최근 1년 원달러 환율 추이"><line class="hwr-fx-guide-line" x1="0" y1="5" x2="100" y2="5"></line><line class="hwr-fx-guide-line" x1="0" y1="39" x2="100" y2="39"></line>' + interestBand + averageLine + '<polyline points="' + poly + '"></polyline></svg></div>';
  }
  function fxCard(fx) {
    fx = fx || {};
    var analysis = fx.analysis || {};
    var current = analysis.current != null ? analysis.current : fx.price;
    var average = analysis.average;
    var low = analysis.low, high = analysis.high, p25 = analysis.p25;
    return '<article class="hwr-fx-card"><div class="hwr-card-title"><strong>원/달러 환율</strong><span>최근 1년 기준</span></div><div class="hwr-fx-main"><strong>' + (current == null ? '-' : formatPrice(current, 'KRW') + '원') + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b></div>' + fxSparkline(fx) + '<div class="hwr-fx-legend"><span><i class="hwr-fx-legend-line hwr-fx-legend-line--average"></i>1년 평균 <b>' + (average == null ? '-' : formatPrice(average, 'KRW') + '원') + '</b></span><span><i class="hwr-fx-legend-swatch"></i>관심 구간 ≤ ' + (p25 == null ? '-' : formatPrice(p25, 'KRW') + '원') + '</span></div><div class="hwr-fx-range"><span>1년 저점 ' + (low == null ? '-' : formatPrice(low, 'KRW') + '원') + '</span><span>1년 고점 ' + (high == null ? '-' : formatPrice(high, 'KRW') + '원') + '</span></div><div class="hwr-fx-meta">' + fxStatus(fx) + '</div></article>';
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
        return '<article class="hwr-index-card"><div><strong>' + escapeHtml(item.name) + '</strong><span class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span></div><b>' + formatPrice(item.end, item.symbol) + '</b><div class="hwr-spark">' + sparkline(item.series, 'hwr-index-spark ' + signClass(item.changeRate)) + '</div><small>' + (item.available ? '주간 종가 추이' : '데이터 없음') + '</small></article>';
      }).join('') + '</div>'
      + '<div class="hwr-summary-row"><div>' + fxCard(fx) + '</div><p class="hwr-source-note"><b>데이터 출처</b><br>지수: 국내 KRX/KIS · 미국 네이버·KIS<br>한국 뉴스: 네이버 뉴스 · DART 공시<br>미국 뉴스: Finnhub · Alpha Vantage (설정된 공급자 기준)<br><small>환율 구간은 최근 1년 관측값을 기준으로 한 참고용 분류입니다.</small></p></div>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>뜨거운 종목</strong><span>상승·수급·거래대금 신호와 사유</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.us, 'us') + '</article></div></section>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>차가운 종목</strong><span>하락률 상위 중 유동성 종목 우선</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.us, 'us') + '</article></div></section>'
      + '<article class="hwr-news-card"><div class="hwr-news-toolbar"><div class="hwr-card-title"><strong>주간 경제 뉴스·이슈</strong><span>월~금 주요 뉴스 · 한국·미국 통합</span></div><div class="hwr-news-filters" role="tablist" aria-label="뉴스 유형 필터"><button type="button" role="tab" aria-selected="true" class="is-active" data-hwr-news-filter="all">통합</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="뉴스">뉴스</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="공시">공시</button></div></div>' + newsTimeline(data.news && data.news.timeline) + '</article>'
      + '<article class="hwr-schedule"><div class="hwr-card-title"><strong>다음 주 핵심 스케줄</strong><span>' + escapeHtml(data.scheduleBasis || '확인된 주요 일정만 표시') + '</span></div>' + scheduleList(data.schedule) + '</article>'
      + '<p class="hwr-disclaimer">뉴스·일정은 수집 시점에 확인된 제목과 발표일만 표시합니다. 투자 판단의 단독 근거로 사용하지 마세요.</p>';
    bindNewsFilters(root);
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
