/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * Saturday 06:00 through Monday 07:00 uses this compact weekend view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20260816-weekend-lineart-v13';
  var LOCAL_CACHE_KEY = 'tistoryTicker:weeklyReport:v1';
  var FETCH_TIMEOUT_MS = 8000;

  function readLocalReport() {
    try {
      var saved = JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || 'null');
      return saved && saved.payload ? saved.payload : null;
    } catch (error) {
      return null;
    }
  }
  function writeLocalReport(payload) {
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload: payload }));
    } catch (error) {
      // Safari private mode and full localStorage must not block the report.
    }
  }
  function fetchReport() {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeoutId = setTimeout(function () {
      if (controller) controller.abort();
    }, FETCH_TIMEOUT_MS);
    var options = { cache: 'no-store' };
    if (controller) options.signal = controller.signal;
    return fetch(API_URL, options).then(function (response) {
      if (!response.ok) throw new Error('weekly report ' + response.status);
      return response.json();
    }).then(function (payload) {
      clearTimeout(timeoutId);
      return payload;
    }, function (error) {
      clearTimeout(timeoutId);
      throw error;
    });
  }

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
  function formatMarketValue(item) {
    var value = num(item && item.end);
    if (value == null) return '-';
    if (item.valueType === 'yield') return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%';
    if (item.valueType === 'usd') return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (item.valueType === 'krw') return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
    return formatPrice(value, item.symbol);
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
    var displayOrder = {
      KOSPI: 0, KOSDAQ: 1, NASDAQ_INDEX: 2, SP500_INDEX: 3,
      WTI: 4, GOLD: 5, US10Y: 6, BTC: 7
    };
    var rows = (indices || []).filter(function (item) {
      return item && Object.prototype.hasOwnProperty.call(displayOrder, item.symbol) && num(item.changeRate) != null;
    }).sort(function (a, b) {
      return displayOrder[a.symbol] - displayOrder[b.symbol];
    });
    if (!rows.length) return '<div class="hwr-index-summary"><span>지수·자산 흐름</span><b>데이터 확인 중</b></div>';
    return '<div class="hwr-index-summary" aria-label="주간 지수·자산 요약"><span>주간 지수·자산 요약</span>' + rows.map(function (item) {
      return '<b><small>' + escapeHtml(item.name) + '</small><strong class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</strong></b>';
    }).join('') + '</div>';
  }
  function sentimentArt(indices) {
    var values = (indices || []).filter(function (item) { return !item.group || item.group === 'index'; }).map(function (item) { return num(item && item.changeRate); }).filter(function (value) { return value != null; });
    var bullish = values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) >= 0 : true;
    if (bullish) {
      return '<div class="hwr-sentiment hwr-sentiment--up" aria-label="황소장 상승"><svg width="104" height="52" viewBox="0 0 160 82" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M51 31C39 32 29 26 24 16 20 8 12 4 4 8c11 1 19 7 23 17 3 7 10 11 20 11ZM109 31c12 1 22-5 27-15 4-8 12-12 20-8-11 1-19 7-23 17-3 7-10 11-20 11Z"/><path d="M47 31c7-13 19-19 33-19s26 6 33 19l-7 31c-7 10-16 15-26 15s-19-5-26-15Z"/><path d="M49 34 35 32l5 12 10 2M111 34l14-2-5 12-10 2M59 40l10-3M101 40l-10-3M62 58c3-7 10-10 18-10s15 3 18 10c-4 7-10 10-18 10s-14-3-18-10ZM71 61c0 9 4 14 9 14s9-5 9-14"/><circle cx="64" cy="43" r="2"/><circle cx="96" cy="43" r="2"/><circle cx="71" cy="58" r="2"/><circle cx="89" cy="58" r="2"/></svg><strong>황소장 · 상승</strong></div>';
    }
    return '<div class="hwr-sentiment hwr-sentiment--down" aria-label="곰장 하락"><svg width="104" height="52" viewBox="0 0 160 82" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M54 24c-3-10-15-14-23-7-7 6-4 18 5 21M106 24c3-10 15-14 23-7 7 6 4 18-5 21"/><path d="M43 34c5-14 19-23 37-23s32 9 37 23l5 20c-5 16-20 25-42 25s-37-9-42-25Z"/><path d="M59 38l10-3M101 38l-10-3M61 59c3-8 10-12 19-12s16 4 19 12c-4 8-10 12-19 12S65 67 61 59ZM80 58v8M72 64c2 2 5 3 8 2 3 1 6 0 8-2"/><circle cx="64" cy="41" r="2"/><circle cx="96" cy="41" r="2"/><circle cx="80" cy="56" r="2.4"/></svg><strong>곰장 · 하락</strong></div>';
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
        return '<article class="hwr-index-card"><div><strong>' + escapeHtml(item.name) + '</strong><span class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span></div><b>' + formatMarketValue(item) + '</b><div class="hwr-spark">' + sparkline(item.series, 'hwr-index-spark ' + signClass(item.changeRate)) + '</div><small>' + (item.available ? '주간 추이' : '데이터 없음') + '</small></article>';
      }).join('') + '</div>'
      + '<div class="hwr-summary-row"><div>' + fxCard(fx) + '</div><p class="hwr-source-note"><b>데이터 출처</b><br>지수: 국내 KRX/KIS · 미국 네이버·KIS<br>한국 뉴스: 네이버 뉴스 · DART 공시<br>미국 뉴스: Finnhub · Alpha Vantage (설정된 공급자 기준)<br><small>환율 구간은 최근 1년 관측값을 기준으로 한 참고용 분류입니다.</small></p></div>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>뜨거운 종목</strong><span>상승·수급·거래대금 신호와 사유</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.us, 'us') + '</article></div></section>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>차가운 종목</strong><span>하락률 상위 중 유동성 종목 우선</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.us, 'us') + '</article></div></section>'
      + '<article class="hwr-news-card"><div class="hwr-news-toolbar"><div class="hwr-card-title"><strong>주간 경제 뉴스·이슈</strong><span>' + escapeHtml(data.news && data.news.basis || '월~금 날짜별 주요 뉴스 · 한국·미국 통합') + '</span></div><div class="hwr-news-filters" role="tablist" aria-label="뉴스 유형 필터"><button type="button" role="tab" aria-selected="true" class="is-active" data-hwr-news-filter="all">통합</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="뉴스">뉴스</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="공시">공시</button></div></div>' + newsTimeline(data.news && data.news.timeline) + '</article>'
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
    var cached = readLocalReport();
    if (cached) {
      render(root, cached);
      root.setAttribute('data-hwr-refreshing', 'true');
    }
    fetchReport().then(function (payload) {
      writeLocalReport(payload);
      render(root, payload);
      root.removeAttribute('data-hwr-refreshing');
    }).catch(function () {
      // A previous successful report is more useful than leaving the page in a
      // spinner state when the VM/browser connection is temporarily stalled.
      if (cached) {
        root.removeAttribute('data-hwr-refreshing');
        return;
      }
      root.innerHTML = '<div class="hwr-loading"><strong>주간 리포트를 잠시 불러오지 못했습니다.</strong><span>8초 후 기존 화면을 표시합니다.</span></div>';
    });
    return root;
  }
  global.HomeWeeklyReport = { init: init };
})(window);
