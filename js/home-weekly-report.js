/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * Saturday 07:00 through Monday 06:00 uses this compact weekend view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20260820-dark-border-v1';
  var LOCAL_CACHE_KEY = 'tistoryTicker:weeklyReport:v4';
  var GOLD_FALLBACK_URL = 'https://goodbyestar.cloud/futures?interval=day&days=365&symbols=GOLD';
  var FETCH_TIMEOUT_MS = 8000;
  var STYLE_TIMEOUT_MS = 2000;
  // 2026-08-22 요청: "다음 주 핵심 스케쥴"에 M7·금리 같은 시장 공통 일정뿐 아니라
  // "내 종목"(js/watchlist.js 관심종목) 공시·실적 일정도 조건부로 보여달라는 요청.
  // weekly_report.py의 next_week_schedule은 순수 함수(사용자 구분 불가, 하루 1회 공용
  // 캐시)라 여기서 서버가 개인화할 수 없다 - 대신 이미 있는 /earnings-calendar(월별,
  // DART+Finnhub 병합)를 브라우저가 직접 불러와 Watchlist.getList()의 종목코드와
  // 교집합만 남기는 방식으로 클라이언트에서 개인화한다(js/home-widgets.js의 MY 카드가
  // 같은 /earnings-calendar 월별 조회 패턴을 이미 쓰고 있음).
  var EARNINGS_CALENDAR_URL = 'https://goodbyestar.cloud/earnings-calendar';

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
      var data = payload && payload.data;
      if (data && data.gold && (data.gold.price != null || (data.gold.chart && data.gold.chart.length))) return payload;
      return fetch(GOLD_FALLBACK_URL, { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('gold fallback ' + response.status);
        return response.json();
      }).then(function (goldPayload) {
        var rows = goldPayload && goldPayload.data;
        var gold = Array.isArray(rows) ? rows.filter(function (row) { return row && row.symbol === 'GOLD'; })[0] : null;
        if (gold && data) { gold.analysis = rangeAnalysis(gold, '1년 금 시세 데이터가 부족합니다.'); data.gold = gold; }
        return payload;
      }).catch(function () { return payload; });
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
  // 2026-08-30: 스파크라인의 fill/stroke가 css/home-weekly-report.css에만 있어서, 그 CSS가
  // 도착하기 전 한 프레임이 SVG 기본값(fill:black, stroke:none)으로 칠해졌다 - <polyline>이
  // 검은 덩어리로 채워져 "검은색 대각선"이 번쩍이는 현상(사용자 리포트). 최종 색을 프레젠테이션
  // 속성으로 같이 박아 첫 페인트부터 같은 그림이 나오게 한다(CSS 속성이 프레젠테이션 속성을
  // 이기므로 CSS가 도착하면 그대로 덮인다).
  function strokeAttr(className, flatColor) {
    var name = String(className || '');
    if (name.indexOf('is-up') !== -1) return '#d24f45';
    if (name.indexOf('is-down') !== -1) return '#1261c4';
    return flatColor;
  }
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
    return '<svg class="' + escapeHtml(className || '') + '" viewBox="0 0 100 32" width="100%" height="38" preserveAspectRatio="none" aria-hidden="true">'
      + '<polyline points="' + poly + '" fill="none" stroke="' + strokeAttr(className, '#2563eb') + '" stroke-width="1.8" vector-effect="non-scaling-stroke"></polyline></svg>';
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
  function stockListWithReasons(items, market, emptyText) {
    if (!items || !items.length) return '<p class="hwr-empty">' + escapeHtml(emptyText || '해당 조건의 종목을 찾지 못했습니다.') + '</p>';
    return '<ul class="hwr-stock-list hwr-stock-list--four">' + items.slice(0, 4).map(function (item) {
      var tags = (item.tags || []).slice(0, 2).join(' · ');
      var meta = market === 'us' ? item.code : item.code + (tags ? ' · ' + tags : '');
      return '<li><span class="hwr-stock-name"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(meta) + '</small><em class="hwr-stock-reason">' + escapeHtml(item.reason || '순위·등락 데이터 기준') + '</em></span><span class="hwr-stock-values"><b>' + escapeHtml(formatStockPrice(item)) + '</b><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b></span></li>';
    }).join('') + '</ul>';
  }
  // 2026-08-22 신설: "기록 공유" - 지난 2주 스윙 후보가 그 후 T+5/T+10 동안 실제로 어떻게
  // 움직였는지 보여준다(이번 주 신규 후보와 별개 섹션). 데이터가 없으면(아직 확정된 결과가
  // 없거나 백엔드가 옛 버전이면) 섹션 자체를 숨긴다(빈 박스를 억지로 보여주지 않음).
  // 2026-08-22(2차) 신설: "성과지표" - 목록(최근 8건)만으로는 승률·평균수익률을 말하기엔
  // 표본이 작다는 지적으로, 백엔드가 더 넉넉한 표본(최대 200건)으로 미리 계산해 내려주는
  // stats(t5/t10 각각 count/winRatePct/avgReturnPct)를 목록 위에 요약카드로 얹는다.
  // 표본이 하나도 없으면(t5/t10 둘 다 null) 카드 자체를 숨긴다.
  function pastOutcomeStatsCard(stats) {
    if (!stats) return '';
    var cells = ['t5', 't10'].map(function (key) {
      var s = stats[key];
      if (!s) return '';
      var label = key === 't5' ? '단타 5거래일(T+5)' : '2주(T+10)';
      return '<div class="hwr-outcome-stat"><b>' + label + '</b>'
        + '<strong class="' + signClass(s.avgReturnPct) + '">' + s.winRatePct + '% 승률</strong>'
        + '<span>평균 ' + signed(s.avgReturnPct) + ' · ' + s.count + '건</span></div>';
    }).join('');
    if (!cells) return '';
    return '<div class="hwr-outcome-stats">' + cells + '</div>';
  }
  function pastOutcomeList(items, stats) {
    if (!items || !items.length) return '';
    return '<section class="hwr-stock-section hwr-outcome-section"><div class="hwr-section-heading"><strong>지난 2주 스윙 추천 결과</strong><span>신호일 대비 T+5·T+10 실제 수익률(확정된 건만 표시)</span></div>'
      + pastOutcomeStatsCard(stats)
      + '<ul class="hwr-stock-list hwr-outcome-list">' + items.map(function (item) {
        var t5 = item.t5ReturnPct != null ? '<b class="' + signClass(item.t5ReturnPct) + '">T+5 ' + signed(item.t5ReturnPct) + '</b>' : '<b class="hwr-outcome-pending">T+5 집계 중</b>';
        var t10 = item.t10ReturnPct != null ? '<b class="' + signClass(item.t10ReturnPct) + '">T+10 ' + signed(item.t10ReturnPct) + '</b>' : '<b class="hwr-outcome-pending">T+10 집계 중</b>';
        return '<li><span class="hwr-stock-name"><strong>' + escapeHtml(item.name || item.code || '') + '</strong><small>' + escapeHtml(dateLabel(item.asOfDate)) + ' 신호 · ' + escapeHtml(item.entryOpinion || '') + '</small></span><span class="hwr-stock-values hwr-outcome-values">' + t5 + t10 + '</span></li>';
      }).join('') + '</ul></section>';
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
  function isBullishWeek(indices) {
    var values = (indices || []).filter(function (item) { return !item.group || item.group === 'index'; }).map(function (item) { return num(item && item.changeRate); }).filter(function (value) { return value != null; });
    return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) >= 0 : true;
  }
  // 2026-08-22 요청: "Markets Closed" 자물쇠도 같은 황소·곰 기준(빨강=상승/파랑=하락)으로
  // 색을 입혀달라는 요청 - skin-main.js가 그리는 정적 마크업(#home-closed-page 안의
  // .home-closed-lock)에 이 데이터가 도착한 시점(render())에 클래스만 덧입힌다. 파일이
  // 갈려 있어(skin-main.js는 골격, 이 파일은 데이터) DOM 클래스로 다리를 놓는 방식 -
  // 두 파일 다 이 클래스 이름(is-bull/is-bear)에 합의돼 있어야 함.
  // 2026-08-22(3차): 래스터 이미지(lock-bull.png/lock-bear.png, 사용자가 준 손그림
  // 레퍼런스를 크롭한 것)를 사용자 요청으로 다시 인라인 SVG로 교체 - 확대해도 흐려지지
  // 않고 currentColor로 클래스 스와핑만으로 색이 바뀐다(이미지 두 장을 별도로 안 둬도 됨).
  function applyLockSentiment(bullish) {
    var lock = document.querySelector('.home-closed-lock');
    if (!lock) return;
    lock.classList.toggle('is-bull', bullish);
    lock.classList.toggle('is-bear', !bullish);
  }
  function sentimentArt(indices) {
    var bullish = isBullishWeek(indices);
    // 2026-08-20: 이 SVG는 stroke="currentColor"로 색을 상속받는데, 실제 색은 외부
    // css/home-weekly-report.css의 .hwr-sentiment(색)에서만 정해진다. 이 CSS는 휴장
    // 탭을 열 때(init())에야 동적으로 <link>가 삽입돼 늦게 도착하므로, 그 사이 브라우저
    // 기본 색(검정)으로 황소·곰 그림이 먼저 그려졌다가 CSS 도착 후 빨강/파랑으로 바뀌는
    // "검은 무늬가 한 번 깜박이는" 현상이 있었다(사용자 리포트). 래퍼에 같은 색을 인라인
    // style로도 넣어 외부 CSS 도착 전에도 첫 페인트부터 올바른 색이 나오게 한다.
    if (bullish) {
      return '<div class="hwr-sentiment hwr-sentiment--up" style="color:#d24f45" aria-label="황소장 상승"><svg width="104" height="52" viewBox="0 0 160 82" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M51 31C39 32 29 26 24 16 20 8 12 4 4 8c11 1 19 7 23 17 3 7 10 11 20 11ZM109 31c12 1 22-5 27-15 4-8 12-12 20-8-11 1-19 7-23 17-3 7-10 11-20 11Z"/><path d="M47 31c7-13 19-19 33-19s26 6 33 19l-7 31c-7 10-16 15-26 15s-19-5-26-15Z"/><path d="M49 34 35 32l5 12 10 2M111 34l14-2-5 12-10 2M59 40l10-3M101 40l-10-3M62 58c3-7 10-10 18-10s15 3 18 10c-4 7-10 10-18 10s-14-3-18-10ZM71 61c0 9 4 14 9 14s9-5 9-14"/><circle cx="64" cy="43" r="2"/><circle cx="96" cy="43" r="2"/><circle cx="71" cy="58" r="2"/><circle cx="89" cy="58" r="2"/></svg><strong>황소장 · 상승</strong></div>';
    }
    return '<div class="hwr-sentiment hwr-sentiment--down" style="color:#1261c4" aria-label="곰장 하락"><svg width="104" height="52" viewBox="0 0 160 82" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true"><path d="M54 24c-3-10-15-14-23-7-7 6-4 18 5 21M106 24c3-10 15-14 23-7 7 6 4 18-5 21"/><path d="M43 34c5-14 19-23 37-23s32 9 37 23l5 20c-5 16-20 25-42 25s-37-9-42-25Z"/><path d="M59 38l10-3M101 38l-10-3M61 59c3-8 10-12 19-12s16 4 19 12c-4 8-10 12-19 12S65 67 61 59ZM80 58v8M72 64c2 2 5 3 8 2 3 1 6 0 8-2"/><circle cx="64" cy="41" r="2"/><circle cx="96" cy="41" r="2"/><circle cx="80" cy="56" r="2.4"/></svg><strong>곰장 · 하락</strong></div>';
  }
  function fxStatus(fx, fallbackLabel, fallbackMessage) {
    var analysis = fx && fx.analysis || {};
    var status = analysis.status || 'unknown';
    var label = analysis.label || fallbackLabel || '데이터 확인 중';
    var message = analysis.message || fallbackMessage || '1년 관측 데이터가 부족합니다.';
    return '<div class="hwr-fx-advice"><span class="hwr-fx-status hwr-fx-status--' + escapeHtml(status) + '">' + escapeHtml(label) + '</span><small>' + escapeHtml(message) + '</small></div>';
  }
  function rangeAnalysis(asset, fallbackMessage) {
    asset = asset || {};
    var points = (asset.chart || []).map(function (point) { return num(point && point.close); }).filter(function (value) { return value != null; }).slice(-365);
    var current = points.length ? points[points.length - 1] : num(asset.price);
    if (!points.length || current == null) return { status: 'unknown', label: '데이터 확인 중', message: fallbackMessage || '1년 관측 데이터가 부족합니다.' };
    var ordered = points.slice().sort(function (a, b) { return a - b; });
    var average = points.reduce(function (sum, value) { return sum + value; }, 0) / points.length;
    var low = ordered[0], high = ordered[ordered.length - 1];
    var p25 = ordered[Math.floor((ordered.length - 1) * .25)];
    var p75 = ordered[Math.floor((ordered.length - 1) * .75)];
    var common = { current: current, average: average, low: low, high: high, p25: p25, p75: p75 };
    if (current >= p75) return Object.assign({ status: 'caution', label: '고점 주의', message: '1년 관측 범위 상단이라 추격 매수는 주의' }, common);
    if (current <= p25) return Object.assign({ status: 'interest', label: '매수 관심 구간', message: '1년 관측 범위 하단이라 분할 접근을 검토' }, common);
    return Object.assign({ status: 'neutral', label: '중립·관망', message: '1년 평균 범위 안에서 방향을 확인' }, common);
  }
  function fxSparkline(fx, title) {
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
    // 위 sparkline()과 같은 이유로 CSS 도착 전 첫 페인트용 프레젠테이션 속성을 같이 박는다.
    // 특히 <rect class="hwr-fx-interest-band">는 fill 기본값이 검정이라 CSS가 늦으면 차트
    // 자리에 검은 사각형이 그대로 보였다.
    var guideAttrs = ' stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"';
    var averageLine = average == null ? '' : '<line class="hwr-fx-average-line" x1="0" y1="' + y(average).toFixed(1) + '" x2="100" y2="' + y(average).toFixed(1) + '" stroke="#475569" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"></line>';
    var interestBand = p25 == null || low == null ? '' : '<rect class="hwr-fx-interest-band" x="0" y="' + bandTop.toFixed(1) + '" width="100" height="' + bandHeight.toFixed(1) + '" rx="1" fill="#2563eb" fill-opacity=".10"></rect>';
    var spark = signClass(fx.change_rate);
    return '<div class="hwr-fx-chart"><svg class="hwr-fx-spark ' + spark + '" viewBox="0 0 100 44" width="100%" height="72" preserveAspectRatio="none" role="img" aria-label="최근 1년 ' + escapeHtml(title || '자산') + ' 추이">'
      + '<line class="hwr-fx-guide-line" x1="0" y1="5" x2="100" y2="5"' + guideAttrs + '></line>'
      + '<line class="hwr-fx-guide-line" x1="0" y1="39" x2="100" y2="39"' + guideAttrs + '></line>'
      + interestBand + averageLine
      + '<polyline points="' + poly + '" fill="none" stroke="' + strokeAttr(spark, '#64748b') + '" stroke-width="1.7" vector-effect="non-scaling-stroke"></polyline></svg></div>';
  }
  function rangeCard(fx, options) {
    fx = fx || {};
    options = options || {};
    var analysis = fx.analysis || rangeAnalysis(fx, options.fallbackMessage);
    var current = analysis.current != null ? analysis.current : fx.price;
    var average = analysis.average;
    var low = analysis.low, high = analysis.high, p25 = analysis.p25;
    var unit = options.unit === 'usd' ? '$' : '원';
    var symbol = options.unit === 'usd' ? 'US' : 'KRW';
    var display = function (value) { return value == null ? '-' : formatPrice(value, symbol) + unit; };
    var status = (analysis.status || 'unknown').replace(/[^a-z-]/g, '');
    return '<article class="hwr-fx-card hwr-fx-card--' + escapeHtml(status) + '"><div class="hwr-card-title"><strong>' + escapeHtml(options.title || '원/달러 환율') + '</strong><span>최근 1년 기준</span></div><div class="hwr-fx-main"><strong>' + display(current) + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b></div>' + fxSparkline(fx, options.title) + '<div class="hwr-fx-legend"><span><i class="hwr-fx-legend-line hwr-fx-legend-line--average"></i>1년 평균 <b>' + display(average) + '</b></span><span><i class="hwr-fx-legend-swatch"></i>매수 관심 ≤ ' + display(p25) + '</span></div><div class="hwr-fx-range"><span>1년 저점 ' + display(low) + '</span><span>1년 고점 ' + display(high) + '</span></div><div class="hwr-fx-meta">' + fxStatus(fx, options.fallbackLabel, options.fallbackMessage) + '</div></article>';
  }
  // 관심종목 코드 -> 표시용 이름 맵. window.Watchlist.getList()는 #watchlist 컨테이너가
  // 실제로 DOM에 있는 페이지(예: /page/watchlist)에서만 채워지고 홈 화면(휴장 탭이 붙는
  // 곳)엔 그 컨테이너가 없어 항상 빈 배열이 된다 - 그래서 js/watchlist.js가 쓰는
  // localStorage 키(wl_codes_v1)를 여기서도 직접 읽는다(로그인 여부와 무관하게 항상
  // 최신 로컬 미러를 유지하는 키). 국내는 6자리 코드 그대로, 미국은 watchlist.js가
  // "US:AAPL" 형태로 저장하므로 접두어를 떼고 대문자로 맞춰 earnings-calendar의
  // symbol(6자리 코드 또는 대문자 티커)과 직접 비교 가능하게 만든다.
  function watchlistSymbolMap() {
    var list;
    try {
      list = JSON.parse(localStorage.getItem('wl_codes_v1') || '[]');
    } catch (error) {
      list = [];
    }
    var map = {};
    (Array.isArray(list) ? list : []).forEach(function (item) {
      var code = String((item && item.code) || '').trim();
      if (!code) return;
      var symbol = code.indexOf('US:') === 0 ? code.slice(3).toUpperCase() : code;
      map[symbol] = (item && item.name) || symbol;
    });
    return map;
  }
  function fmtIsoDate(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function myScheduleList(items, nameMap) {
    return '<ul class="hwr-schedule-list hwr-my-schedule-list">' + items.map(function (item) {
      var label = nameMap[String(item.symbol || '').toUpperCase()] || item.symbol;
      return '<li><time>' + escapeHtml(String(item.start || item.date || '').slice(5, 10)) + '</time><b class="hwr-schedule-market hwr-schedule-market--mine">보유</b><span><strong>' + escapeHtml(label) + '</strong> ' + escapeHtml(item.title || '') + '</span></li>';
    }).join('') + '</ul>';
  }
  // 표본이 하나도 없으면(관심종목 미등록, 또는 다음 주에 해당하는 일정이 없음) 마운트
  // 자체를 숨긴다 - "그냥 데이터만 붙여넣은 대시보드"가 되지 않도록 빈 섹션을 만들지 않음.
  function loadMyWatchlistSchedule(root, weekEndIso) {
    var mount = root.querySelector('[data-hwr-my-schedule]');
    if (!mount) return;
    var nameMap = watchlistSymbolMap();
    var symbols = Object.keys(nameMap);
    if (!symbols.length) { mount.hidden = true; return; }
    var end = weekEndIso ? new Date(weekEndIso + 'T00:00:00+09:00') : new Date();
    if (isNaN(end.getTime())) { mount.hidden = true; return; }
    var nextStart = new Date(end.getTime() + 3 * 86400000);
    var nextEnd = new Date(nextStart.getTime() + 6 * 86400000);
    var startIso = fmtIsoDate(nextStart);
    var endIso = fmtIsoDate(nextEnd);
    var months = [];
    var seenMonths = {};
    [nextStart, nextEnd].forEach(function (date) {
      var key = date.getFullYear() + '-' + (date.getMonth() + 1);
      if (!seenMonths[key]) { seenMonths[key] = true; months.push({ year: date.getFullYear(), month: date.getMonth() + 1 }); }
    });
    Promise.all(months.map(function (period) {
      if (window.EarningsCalendarFeed) return window.EarningsCalendarFeed.month(period.year, period.month);
      return fetch(EARNINGS_CALENDAR_URL + '?year=' + period.year + '&month=' + period.month)
        .then(function (response) { if (!response.ok) throw new Error('일정 응답 오류'); return response.json(); })
        .then(function (payload) { return Array.isArray(payload) ? payload : (payload && payload.data) || []; })
        .catch(function () { return []; });
    })).then(function (groups) {
      var merged = [];
      groups.forEach(function (group) { merged = merged.concat(group); });
      var filtered = merged.filter(function (item) {
        var day = String(item && (item.start || item.date) || '').slice(0, 10);
        var symbol = String(item && item.symbol || '').toUpperCase();
        return day >= startIso && day <= endIso && nameMap.hasOwnProperty(symbol);
      }).sort(function (a, b) {
        return String(a.start || a.date || '').localeCompare(String(b.start || b.date || ''));
      });
      if (!filtered.length) { mount.hidden = true; return; }
      mount.hidden = false;
      mount.innerHTML = '<div class="hwr-card-title"><strong>내 종목 다음 주 일정</strong><span>관심종목 실적·공시 일정만 표시</span></div>' + myScheduleList(filtered, nameMap);
    }).catch(function () { mount.hidden = true; });
  }
  function scheduleList(items) {
    if (!items || !items.length) return '<p class="hwr-empty">다음 주 M7·금리·주요 기업 일정이 확인되지 않았습니다.</p>';
    return '<ul class="hwr-schedule-list">' + items.slice(0, 16).map(function (item) {
      var isUs = item.market === 'us' || /^[A-Z]{1,6}$/.test(String(item.symbol || '')) || /미국|Finnhub|\$[A-Z]/i.test(String(item.title || ''));
      // 2026-08-23: "$NVDA 실적발표"처럼 티커 앞에 붙는 "$" 캐시태그 표기가 그대로 노출되던
      // 문제 - 표시용 제목에서만 선행 "$SYMBOL " 접두어를 제거한다(isUs 판별은 원본으로 이미 끝남).
      var title = String(item.title || '').replace(/^\$[A-Z]{1,6}\s+/, '');
      // 2026-08-22: 제목에 이미 "$NVDA 실적발표"처럼 심볼이 들어있는데 뒤에 <small>NVDA</small>가
      // 또 붙어 "$NVDA 실적발표 (장후) NVDA"로 중복 표시되던 문제 - 제목이 이미 그 심볼을
      // 포함하면 별도 태그를 만들지 않는다.
      var symbol = String(item.symbol || '');
      var showSymbolTag = symbol && title.toUpperCase().indexOf(symbol.toUpperCase()) === -1;
      return '<li><time>' + escapeHtml(String(item.date || '').slice(5)) + '</time><b class="hwr-schedule-market">' + (isUs ? '미국' : '한국') + '</b><span>' + escapeHtml(title) + (showSymbolTag ? ' <small>' + escapeHtml(symbol) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }
  function isWeekendWindow(date) {
    // 2026-08-22: skin-main.js의 HomeMarketSelection 휴장 판정(토요일 07:00~월요일
    // 06:00)과 동일한 경계로 통일 - 예전엔 06:00/07:00으로 살짝 어긋나 있었다.
    var kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    var day = kst.getUTCDay();
    var hour = kst.getUTCHours();
    return (day === 6 && hour >= 7) || day === 0 || (day === 1 && hour < 6);
  }
  function render(root, payload) {
    var data = payload && payload.data ? payload.data : payload || {};
    var weekendDay = new Date().getDay();
    var title = weekendDay === 0 || weekendDay === 1 ? '다음 주 준비 리포트' : '한 주 마감 리포트';
    var subtitle = weekendDay === 0 || weekendDay === 1 ? '한국·미국 증시 흐름과 다음 주 핵심 일정·뉴스를 한 화면에 통합합니다.' : '이번 주 시장 흐름과 주요 이슈를 한 화면에 정리합니다.';
    var indices = data.indices || [];
    var fx = data.fx || {};
    var gold = data.gold || {};
    applyLockSentiment(isBullishWeek(indices));
    root.innerHTML = '<div class="hwr-head"><div class="hwr-head-copy"><span class="hwr-eyebrow">WEEKEND BRIEF</span><h2>' + title + '</h2><p>' + subtitle + '</p></div>' + sentimentArt(indices) + '<div class="hwr-period">' + escapeHtml(data.week && data.week.label || '기준일 확인 중') + '<small>금요일 장 마감 기준</small></div></div>'
      + '<article class="hwr-schedule"><div class="hwr-card-title"><strong>다음 주 핵심 스케줄</strong><span>' + escapeHtml(data.scheduleBasis || '확인된 주요 일정만 표시') + '</span></div>' + scheduleList(data.schedule) + '</article>'
      + indexSummary(indices)
      + '<div class="hwr-index-grid">' + indices.filter(function (item) {
        return item && ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX'].indexOf(item.symbol) !== -1;
      }).map(function (item) {
        return '<article class="hwr-index-card"><div><strong>' + escapeHtml(item.name) + '</strong><span class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span></div><b>' + formatMarketValue(item) + '</b><div class="hwr-spark">' + sparkline(item.series, 'hwr-index-spark ' + signClass(item.changeRate)) + '</div><small>' + (item.available ? '주간 추이' : '데이터 없음') + '</small></article>';
      }).join('') + '</div>'
      + '<div class="hwr-summary-row hwr-asset-row"><div>' + rangeCard(fx, { title: '원/달러 환율', unit: 'krw', fallbackLabel: '환율 데이터 확인 중', fallbackMessage: '1년 환율 데이터가 부족합니다.' }) + '</div><div>' + rangeCard(gold, { title: '금 선물', unit: 'usd', fallbackLabel: '금 시세 데이터 확인 중', fallbackMessage: '1년 금 시세 데이터가 부족합니다.' }) + '</div></div>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>뜨거웠던 종목</strong><span>지난주 상승·수급·거래대금 신호와 사유</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>왜 움직였나</span></div>' + stockListWithReasons(data.hotStocks && data.hotStocks.us, 'us') + '</article></div></section>'
      + '<section class="hwr-stock-section"><div class="hwr-section-heading"><strong>차가웠던 종목</strong><span>지난주 하락률 상위 중 유동성 종목 우선</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong>한국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.domestic, 'domestic') + '</article><article><div class="hwr-card-title"><strong>미국</strong><span>약세 이유</span></div>' + stockListWithReasons(data.coldStocks && data.coldStocks.us, 'us') + '</article></div></section>'
      + '<section class="hwr-stock-section hwr-candidate-section"><div class="hwr-section-heading"><strong>2주 스윙 상승 후보</strong><span>국내 차트 국면·모멘텀·펀더멘털·위험 필터 통과 종목만 표시</span></div><div class="hwr-columns"><article><div class="hwr-card-title"><strong class="is-up">국내 후보</strong><span>보유자 행동과 신규 진입을 분리</span></div>' + stockListWithReasons(data.hotCandidates && data.hotCandidates.domestic, 'domestic', '현재 조건 충족 후보 없음') + '</article></div></section>'
      + pastOutcomeList(data.pastCandidateOutcomes && data.pastCandidateOutcomes.domestic, data.pastCandidateOutcomes && data.pastCandidateOutcomes.stats)
      + '<article class="hwr-news-card"><div class="hwr-news-toolbar"><div class="hwr-card-title"><strong>주간 경제 뉴스·이슈</strong><span>' + escapeHtml(data.news && data.news.basis || '금~일 날짜별 주요 뉴스 · 한국·미국 통합') + '</span></div><div class="hwr-news-filters" role="tablist" aria-label="뉴스 유형 필터"><button type="button" role="tab" aria-selected="true" class="is-active" data-hwr-news-filter="all">통합</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="뉴스">뉴스</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="공시">공시</button></div></div>' + newsTimeline(data.news && data.news.timeline) + '</article>'
      + '<article class="hwr-schedule hwr-my-schedule" data-hwr-my-schedule hidden></article>'
      + '<p class="hwr-disclaimer">뉴스·일정은 수집 시점에 확인된 제목과 발표일만 표시합니다. 투자 판단의 단독 근거로 사용하지 마세요.</p>';
    bindNewsFilters(root);
    loadMyWatchlistSchedule(root, data.week && data.week.end);
  }
  // 2026-08-30: css/home-weekly-report.css는 휴장 탭을 열 때에야 <link>로 붙는데,
  // localStorage 캐시가 있으면 바로 다음 줄에서 마크업까지 그려져 스타일이 도착하기 전
  // 몇 프레임이 그대로 페인트됐다(사용자 리포트: 휴장 전환 시 검은 대각선 덩어리가 뜸).
  // 스타일이 준비된 뒤에 본문을 그리고, 로드 실패나 지연이면 타임아웃으로 그냥 그린다
  // (그 경우에도 위 SVG 프레젠테이션 속성 덕분에 검은 덩어리로는 안 보인다).
  var styleReady = false;
  var stylePending = [];
  function markStyleReady() {
    if (styleReady) return;
    styleReady = true;
    var queued = stylePending.splice(0, stylePending.length);
    queued.forEach(function (fn) { fn(); });
  }
  function ensureStyle() {
    var link = document.querySelector('link[data-home-weekly-report-css]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_URL;
      link.setAttribute('data-home-weekly-report-css', '1');
      document.head.appendChild(link);
    }
    // 교차 출처(GitHub Pages) 스타일시트도 로드가 끝나면 link.sheet 객체는 생긴다.
    if (link.sheet) { markStyleReady(); return; }
    link.addEventListener('load', markStyleReady);
    link.addEventListener('error', markStyleReady);
    setTimeout(markStyleReady, STYLE_TIMEOUT_MS);
  }
  function whenStyleReady(fn) {
    if (styleReady) { fn(); return; }
    stylePending.push(fn);
  }
  function init() {
    var closedSelected = window.HomeMarketSelection && typeof window.HomeMarketSelection.get === 'function'
      && window.HomeMarketSelection.get() === 'closed';
    var existing = document.getElementById('homeWeeklyReport');
    if (!isWeekendWindow(new Date()) && !closedSelected) {
      if (existing) existing.remove();
      return null;
    }
    var feed = document.querySelector('.feed');
    if (!feed || existing) return null;
    ensureStyle();
    var root = document.createElement('section');
    root.id = 'homeWeeklyReport'; root.className = 'home-weekly-report';
    root.innerHTML = '<div class="hwr-loading"><strong>주간 리포트를 준비하는 중입니다.</strong><span>지수·뉴스·일정을 묶고 있습니다.</span></div>';
    var dashboard = feed.querySelector('.home-dashboard');
    var closedSelected = window.HomeMarketSelection && typeof window.HomeMarketSelection.get === 'function'
      && window.HomeMarketSelection.get() === 'closed';
    if (closedSelected && dashboard) dashboard.insertAdjacentElement('afterend', root);
    else feed.insertBefore(root, dashboard || feed.firstChild);
    var cached = readLocalReport();
    if (cached) {
      root.setAttribute('data-hwr-refreshing', 'true');
      whenStyleReady(function () { render(root, cached); });
    }
    fetchReport().then(function (payload) {
      writeLocalReport(payload);
      whenStyleReady(function () {
        render(root, payload);
        root.removeAttribute('data-hwr-refreshing');
      });
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
