/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * Saturday 07:00 through Monday 06:00 uses this compact weekend view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20261005-pill-v14';
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
  // 2026-10-03 빛 규칙 시범(사용자: "그래프 주위로 색감이 퍼지는 효과"): 선 아래 방향색 면(위에서 아래로 옅어짐)
  // + 선 뒤 후광 + 마지막 점. 빛은 정보다 - 마지막 값 하나만 점으로 빛나고, 색은 상승 빨강·하락 파랑을 따른다.
  // 후광은 두꺼운 반투명 선이라 filter(blur)를 쓰지 않는다(카드가 많아도 가볍다).
  var glowSeq = 0;
  function glowParts(poly, viewH, className) {
    var pts = String(poly).split(' ').map(function (pair) { var xy = pair.split(','); return [Number(xy[0]), Number(xy[1])]; });
    if (pts.length < 2 || pts.some(function (xy) { return !isFinite(xy[0]) || !isFinite(xy[1]); })) return { svg: '', dot: '' };
    var id = 'hwrGlow' + (++glowSeq);
    var last = pts[pts.length - 1];
    var area = poly + ' ' + last[0].toFixed(1) + ',' + viewH + ' ' + pts[0][0].toFixed(1) + ',' + viewH;
    return {
      svg: '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hwr-glow-top"/><stop offset="1" class="hwr-glow-bottom"/></linearGradient></defs>'
        + '<polygon class="hwr-glow-area" points="' + area + '" fill="url(#' + id + ')" stroke="none"></polygon>'
        + '<polyline class="hwr-glow-halo" points="' + poly + '" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>',
      dot: '<span class="hwr-glow-dot ' + escapeHtml(className || '') + '" style="left:' + last[0].toFixed(1) + '%;top:' + (last[1] / viewH * 100).toFixed(1) + '%" aria-hidden="true"></span>'
    };
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
    var glow = glowParts(poly, 32, className);
    return '<svg class="' + escapeHtml(className || '') + '" viewBox="0 0 100 32" width="100%" height="38" preserveAspectRatio="none" aria-hidden="true">'
      + glow.svg
      + '<polyline points="' + poly + '" fill="none" stroke="' + strokeAttr(className, '#2563eb') + '" stroke-width="1.8" vector-effect="non-scaling-stroke"></polyline></svg>' + glow.dot;
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
  // 2026-10-04 주말 리포트 재디자인: 뉴스를 국내/해외 두 열의 한 줄 행(시간·매체·제목)으로 줄이고 기본 6건만 보여준다.
  // 나머지는 섹션 하단 "더보기" 하나로 연다. 요약문·원문 버튼·시장 배지는 걷고 제목 자체를 원문 링크로 쓴다.
  var NEWS_VISIBLE = 6;
  function newsRow(item, index) {
    var type = newsType(item);
    var quote = item.price != null ? '<span class="hwr2-news-quote"><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b></span>' : '';
    return '<li class="hwr2-news-row' + (index >= NEWS_VISIBLE ? ' is-extra' : '') + '" data-news-type="' + type + '">'
      + '<time>' + escapeHtml(dateLabel(item.pubDate)) + ' ' + escapeHtml(timeLabel(item.pubDate)) + '</time>'
      + '<span class="hwr2-news-main"><a href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">' + escapeHtml(item.title || '제목 없음') + '</a>'
      + '<small>' + escapeHtml(item.source || '') + (type === '공시' ? ' · 공시' : '') + '</small></span>' + quote + '</li>';
  }
  function newsColumn(title, items) {
    return '<div class="hwr2-col"><h4 class="hwr2-col-title">' + title + '</h4>'
      + (items.length ? '<ul class="hwr2-news-list">' + items.map(newsRow).join('') + '</ul>' : '<p class="hwr-empty">완료된 주간 뉴스가 없습니다.</p>') + '</div>';
  }
  function newsTimeline(items) {
    if (!items || !items.length) return '<p class="hwr-empty">완료된 주간 뉴스가 없습니다.</p>';
    var rows = items.slice(0, 20);
    var domestic = rows.filter(function (item) { return item.market !== '미국'; });
    var overseas = rows.filter(function (item) { return item.market === '미국'; });
    var hasExtra = domestic.length > NEWS_VISIBLE || overseas.length > NEWS_VISIBLE;
    return '<div class="hwr2-cols" data-hwr-news-timeline>' + newsColumn('국내 뉴스', domestic) + newsColumn('해외 뉴스', overseas) + '</div>'
      + '<p class="hwr-news-filter-empty" data-hwr-news-filter-empty hidden>해당 유형의 소식이 없습니다.</p>'
      + (hasExtra ? '<div class="hwr2-more-wrap"><button type="button" class="hwr2-more" data-hwr-news-more aria-expanded="false">뉴스 더보기</button></div>' : '');
  }
  function bindNewsMore(root) {
    var more = root.querySelector('[data-hwr-news-more]');
    var box = root.querySelector('.hwr2-news');
    if (!more || !box) return;
    more.addEventListener('click', function () {
      var open = !box.classList.contains('is-expanded');
      box.classList.toggle('is-expanded', open);
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.textContent = open ? '뉴스 접기' : '뉴스 더보기';
    });
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
  // 2026-10-04 주말 리포트 재디자인: 종목 하나 = 카드 하나를 걷고 한 줄 행(순위·종목·등락률/가격)으로 바꾼다.
  function moverRows(items, market, emptyText) {
    if (!items || !items.length) return '<p class="hwr-empty">' + escapeHtml(emptyText || '해당 조건의 종목을 찾지 못했습니다.') + '</p>';
    return '<ol class="hwr2-rows">' + items.slice(0, 4).map(function (item, index) {
      var tags = (item.tags || []).slice(0, 2).join(' · ');
      var meta = market === 'us' ? item.code : item.code + (tags ? ' · ' + tags : '');
      var reason = item.reason || '순위·등락 데이터 기준';
      return '<li><i class="hwr2-rank">' + (index < 9 ? '0' : '') + (index + 1) + '</i>'
        + '<span class="hwr2-name"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(meta) + '</small><em>' + escapeHtml(reason) + '</em></span>'
        + '<span class="hwr2-val"><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b><small>' + escapeHtml(formatStockPrice(item)) + '</small></span></li>';
    }).join('') + '</ol>';
  }
  function moversSection(data) {
    var hot = data.hotStocks || {}, cold = data.coldStocks || {};
    function block(label, market, hotItems, coldItems) {
      return '<div class="hwr2-market"><h4 class="hwr2-market-title">' + label + '</h4><div class="hwr2-cols">'
        + '<div class="hwr2-col"><h5 class="hwr2-col-sub is-up">많이 오른 종목</h5>' + moverRows(hotItems, market) + '</div>'
        + '<div class="hwr2-col"><h5 class="hwr2-col-sub is-down">많이 내린 종목</h5>' + moverRows(coldItems, market) + '</div>'
        + '</div></div>';
    }
    return '<section class="hwr2-section"><div class="hwr2-h"><h3>이번 주 움직인 종목</h3><p>마지막 거래일 기준 · 상승은 +1% 이상, 하락은 -1% 이하만 표시</p></div>'
      + block('한국', 'domestic', hot.domestic, cold.domestic)
      + block('미국', 'us', hot.us, cold.us)
      + '</section>';
  }
  // 2026-08-22 신설: "기록 공유" - 지난 2주 스윙 후보가 그 후 T+5/T+10 동안 실제로 어떻게
  // 움직였는지 보여준다(이번 주 신규 후보와 별개 섹션). 데이터가 없으면(아직 확정된 결과가
  // 없거나 백엔드가 옛 버전이면) 섹션 자체를 숨긴다(빈 박스를 억지로 보여주지 않음).
  // 2026-08-22(2차) 신설: "성과지표" - 목록(최근 8건)만으로는 승률·평균수익률을 말하기엔
  // 표본이 작다는 지적으로, 백엔드가 더 넉넉한 표본(최대 200건)으로 미리 계산해 내려주는
  // stats(t5/t10 각각 count/winRatePct/avgReturnPct)를 목록 위에 요약카드로 얹는다.
  // 표본이 하나도 없으면(t5/t10 둘 다 null) 카드 자체를 숨긴다.
  // 2026-10-04 재디자인: 위쪽에 T+5/T+10 승률을 큰 숫자로, 아래에 종목별 한 줄(T+5·T+10)로 정리한다.
  function pastOutcomeStatsCard(stats) {
    if (!stats) return '';
    var cells = ['t5', 't10'].map(function (key) {
      var st = stats[key];
      if (!st) return '';
      return '<div class="hwr2-stat"><span>' + (key === 't5' ? 'T+5 승률' : 'T+10 승률') + '</span>'
        + '<strong>' + st.winRatePct + '%</strong>'
        + '<small class="' + signClass(st.avgReturnPct) + '">평균 ' + signed(st.avgReturnPct) + ' · ' + st.count + '건</small></div>';
    }).join('');
    return cells ? '<div class="hwr2-stats">' + cells + '</div>' : '';
  }
  function pastOutcomeRows(items) {
    return '<ol class="hwr2-rows hwr2-rows--outcome">' + items.map(function (item) {
      var t5 = item.t5ReturnPct != null ? '<b class="' + signClass(item.t5ReturnPct) + '"><small>T+5</small>' + signed(item.t5ReturnPct) + '</b>' : '<b class="hwr-outcome-pending"><small>T+5</small>집계 중</b>';
      var t10 = item.t10ReturnPct != null ? '<b class="' + signClass(item.t10ReturnPct) + '"><small>T+10</small>' + signed(item.t10ReturnPct) + '</b>' : '<b class="hwr-outcome-pending"><small>T+10</small>집계 중</b>';
      var opinion = item.entryOpinion ? ' · ' + escapeHtml(item.entryOpinion) : '';
      return '<li><span class="hwr2-name"><strong>' + escapeHtml(item.name || item.code || '') + '</strong><small>' + escapeHtml(dateLabel(item.asOfDate)) + ' 신호' + opinion + '</small></span>'
        + '<span class="hwr2-val hwr2-val--pair">' + t5 + t10 + '</span></li>';
    }).join('') + '</ol>';
  }
  function checkSection(data) {
    var outcomes = data.pastCandidateOutcomes || {};
    var past = outcomes.domestic;
    var hasPast = past && past.length;
    var left = '<div class="hwr2-col"><h5 class="hwr2-col-sub is-up">매매 신호 <small>2주 스윙 상승 후보</small></h5>'
      + moverRows(data.hotCandidates && data.hotCandidates.domestic, 'domestic', '현재 조건 충족 후보 없음') + '</div>';
    var right = hasPast
      ? '<div class="hwr2-col"><h5 class="hwr2-col-sub">지난 신호 성과 <small>신호일 대비 확정 수익률</small></h5>' + pastOutcomeStatsCard(outcomes.stats) + pastOutcomeRows(past) + '</div>'
      : '';
    return '<section class="hwr2-section"><div class="hwr2-h"><h3>다음 주 체크할 종목</h3><p>국내 차트 국면·모멘텀·펀더멘털·위험 필터를 통과한 종목만 표시합니다</p></div>'
      + '<div class="hwr2-cols' + (hasPast ? '' : ' is-single') + '">' + left + right + '</div></section>';
  }
  // 2026-10-04: 위 지수 4개(KOSPI·KOSDAQ·나스닥·S&P500)는 바로 아래 지수 블록에 이미 있어서 여기서는 빼고,
  // 거기 없는 자산(원유·금·미국 10년 국채·비트코인)만 크게 보여준다.
  function indexSummary(indices) {
    // 비트코인은 아래 "주말에도 움직이는 시장"에 실시간으로 있어 여기서 뺀다(2026-10-04 사용자 요청).
    var displayOrder = { WTI: 4, GOLD: 5, US10Y: 6 };
    var rows = (indices || []).filter(function (item) {
      return item && Object.prototype.hasOwnProperty.call(displayOrder, item.symbol) && num(item.changeRate) != null;
    }).sort(function (a, b) {
      return displayOrder[a.symbol] - displayOrder[b.symbol];
    });
    if (!rows.length) return '';
    // 2026-10-04 사용자 지적("주간 자산 요약 손봐야" → "크게 말고 미니멀하게"): 이름 · 값 · 주간 등락을 한 줄 띠로.
    // 금리는 수준(%) 자체가 단위라 등락을 %p 차이로 보여준다(예: 5.17% → 5.24% = +0.07%p). 기준은 직전 주 마지막 종가.
    return '<div class="hwr2-asset-strip" aria-label="주간 자산 요약"><span class="hwr2-strip-label">주간 자산<small>직전 주 종가 대비</small></span>'
      + rows.map(function (item) {
        var isYield = item.valueType === 'yield' && num(item.changeAbs) != null;
        var tone = signClass(isYield ? item.changeAbs : item.changeRate);
        var change = isYield ? (num(item.changeAbs) > 0 ? '+' : '') + num(item.changeAbs).toFixed(2) + '%p' : signed(item.changeRate);
        return '<span class="hwr2-strip-item"><small>' + escapeHtml(item.name) + '</small><b>' + assetValue(item) + '</b><em class="' + tone + '">' + change + '</em></span>';
      }).join('') + '</div>';
  }
  function assetValue(item) {
    var value = num(item && item.end);
    if (value != null && item.valueType === 'krw' && Math.abs(value) >= 100000000) return (value / 100000000).toFixed(2) + '억원';
    return formatMarketValue(item);
  }

  // 2026-10-04 사용자 요청("비트코인이랑 이더리움, 바이낸스 국내주식토큰 띄우면 좋을 것 같다"): 주말에도 거래되는 시세.
  // VM은 바이낸스가 서버 위치(미국)를 막아(HTTP 451) 가져올 수 없어서 브라우저가 바이낸스 공개 API를 직접 부른다(CORS 허용, 키 없음).
  // 국내주식 토큰은 1주 가격을 USD로 추종하는 무기한선물이다(2026-10-04 실측: 8종 모두 국내 종가 ÷ 토큰가 ≈ 원/달러 1,330~1,390).
  // 원화 환산 갭은 환율·괴리가 섞여 단정할 수 없어 보여주지 않고, 토큰 자체의 등락만 보여준다.
  var BINANCE_SPOT = 'https://api.binance.com/api/v3/';
  var BINANCE_FUTURES = 'https://fapi.binance.com/fapi/v1/';
  var LIVE_COINS = [
    { symbol: 'BTCUSDT', name: '비트코인', short: 'BTC' },
    { symbol: 'ETHUSDT', name: '이더리움', short: 'ETH' }
  ];
  var LIVE_KR_TOKENS = [
    { symbol: 'SAMSUNGUSDT', name: '삼성전자', code: '005930' },
    { symbol: 'SKHYNIXUSDT', name: 'SK하이닉스', code: '000660' },
    { symbol: 'HYUNDAIUSDT', name: '현대차', code: '005380' },
    { symbol: 'SAMSUNGEMUSDT', name: '삼성전기', code: '009150' },
    { symbol: 'HANMIUSDT', name: '한미반도체', code: '042700' },
    { symbol: 'LGELECTRONICSUSDT', name: 'LG전자', code: '066570' },
    { symbol: 'NAVERUSDT', name: 'NAVER', code: '035420' },
    { symbol: 'KODEX200USDT', name: 'KODEX 200', code: '069500' }
  ];
  function fetchJsonTimeout(url, ms) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, ms || 6000);
    return fetch(url, controller ? { signal: controller.signal } : {}).then(function (response) {
      clearTimeout(timer);
      if (!response.ok) throw new Error('live ' + response.status);
      return response.json();
    }, function (error) { clearTimeout(timer); throw error; });
  }
  // 금요일 국내 장 마감(15:30 KST) 시점 가격 = 그 시각에 시작한 15분봉의 시가.
  var sincePriceMemo = {};
  function priceAt(base, symbol, ms) {
    if (!ms || ms > Date.now()) return Promise.resolve(null);
    var key = symbol + '@' + ms;
    if (sincePriceMemo[key]) return sincePriceMemo[key];
    var promise = fetchJsonTimeout(base + 'klines?symbol=' + symbol + '&interval=15m&startTime=' + ms + '&limit=1')
      .then(function (rows) { return rows && rows[0] ? num(rows[0][1]) : null; })
      .catch(function () { delete sincePriceMemo[key]; return null; });
    sincePriceMemo[key] = promise;
    return promise;
  }
  function liveQuote(base, item, sinceMs, withChart) {
    var ticker = fetchJsonTimeout(base + 'ticker/24hr?symbol=' + item.symbol);
    var chart = withChart
      ? fetchJsonTimeout(base + 'klines?symbol=' + item.symbol + '&interval=1h&limit=48').catch(function () { return []; })
      : Promise.resolve([]);
    return Promise.all([ticker, priceAt(base, item.symbol, sinceMs), chart]).then(function (parts) {
      var price = num(parts[0] && parts[0].lastPrice);
      if (price == null) return null;
      var since = parts[1];
      return {
        item: item, price: price,
        change24h: num(parts[0].priceChangePercent),
        sinceFriday: since ? (price - since) / since * 100 : null,
        series: (parts[2] || []).map(function (row) { return { close: num(row && row[4]) }; })
      };
    }).catch(function () { return null; });
  }
  function usd(value) {
    var parsed = num(value);
    if (parsed == null) return '-';
    return '$' + parsed.toLocaleString('en-US', { maximumFractionDigits: parsed >= 1000 ? 0 : 2, minimumFractionDigits: parsed >= 1000 ? 0 : 2 });
  }
  // 2026-10-04 사용자 요청("비트코인이랑 이더리움도 크기를 국내주식 토큰이랑 맞게"): 코인도 토큰과 같은 한 줄 행으로.
  function liveRow(row) {
    var meta = row.item.code ? row.item.code + ' · ' + row.item.symbol : '코인 · ' + row.item.symbol;
    return '<li><span class="hwr2-name"><strong>' + escapeHtml(row.item.name) + '</strong><small>' + escapeHtml(meta) + '</small></span>'
      + '<span class="hwr2-token-price">' + usd(row.price) + '</span>'
      + '<b class="' + signClass(row.sinceFriday) + '">' + (row.sinceFriday != null ? signed(row.sinceFriday) : '-') + '</b>'
      + '<b class="hwr2-token-24h ' + signClass(row.change24h) + '">' + signed(row.change24h) + '</b></li>';
  }
  function liveColumn(rows, label) {
    return '<div class="hwr2-live-col"><div class="hwr2-token-head"><span>' + label + '</span><span>가격</span><span>금요일 이후</span><span class="hwr2-token-24h">24시간</span></div>'
      + '<ol class="hwr2-rows hwr2-token-rows">' + rows.map(liveRow).join('') + '</ol></div>';
  }
  var liveMemo = null;
  var themesMemo = null;
  // 2026-10-05 사용자 확인("새로고침 주기가? 실시간인가?" → 1번 자동 갱신): 전에는 페이지를 열 때 한 번만 받아 "실시간"
  // 문구와 달랐다. 30초마다 다시 받고, 탭이 가려져 있으면 쉬었다가 다시 보일 때 바로 한 번 받는다. 바이낸스를 브라우저가
  // 직접 부르므로 VM 부담은 없다. 리포트가 화면에서 사라지면(평일 전환 등) 타이머를 멈춘다.
  var LIVE_REFRESH_MS = 30000;
  var liveTimer = null;
  var liveCtx = null;
  function clockText(ms) {
    var d = new Date(ms);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function stopWeekendLive() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    liveCtx = null;
    document.removeEventListener('visibilitychange', onLiveVisibility);
  }
  function onLiveVisibility() {
    if (!document.hidden && liveCtx) loadWeekendLive(liveCtx.root, liveCtx.weekEndIso, true);
  }
  function loadWeekendLive(root, weekEndIso, force) {
    var mount = root.querySelector('[data-hwr-live]');
    if (!mount) return;
    var sinceMs = weekEndIso ? Date.parse(weekEndIso + 'T15:30:00+09:00') : null;
    if (!isFinite(sinceMs)) sinceMs = null;
    // render()는 캐시본·새 응답으로 두 번 불린다 - 1분 안에는 같은 요청 결과를 다시 쓴다(주기 갱신은 force).
    if (force || !liveMemo || Date.now() - liveMemo.t > 60000 || liveMemo.since !== sinceMs) {
      var coins = Promise.all(LIVE_COINS.map(function (item) { return liveQuote(BINANCE_SPOT, item, sinceMs, false); }));
      var tokens = Promise.all(LIVE_KR_TOKENS.map(function (item) { return liveQuote(BINANCE_FUTURES, item, sinceMs, false); }));
      liveMemo = { t: Date.now(), since: sinceMs, promise: Promise.all([coins, tokens]) };
    }
    if (!liveTimer) {
      liveTimer = setInterval(function () {
        if (!liveCtx || !document.body.contains(liveCtx.root)) { stopWeekendLive(); return; }
        if (document.hidden) return;
        loadWeekendLive(liveCtx.root, liveCtx.weekEndIso, true);
      }, LIVE_REFRESH_MS);
      document.addEventListener('visibilitychange', onLiveVisibility);
    }
    liveCtx = { root: root, weekEndIso: weekEndIso };
    var memo = liveMemo;
    memo.promise.then(function (parts) {
      if (memo !== liveMemo) return;   // 더 새 요청이 있으면 그 결과를 쓴다
      var coinRows = parts[0].filter(Boolean), tokenRows = parts[1].filter(Boolean);
      if (!coinRows.length && !tokenRows.length) return;   // 갱신 실패 시 직전 표를 그대로 둔다
      var fri = weekEndIso ? weekEndIso.slice(5).replace('-', '/') : '';
      var rows = coinRows.concat(tokenRows);
      var half = Math.ceil(rows.length / 2);
      mount.innerHTML = '<h4 class="hwr2-sub">주말에도 움직이는 시장 <small>바이낸스 · 30초마다 갱신(' + clockText(memo.t) + ' 기준) · 금요일(' + escapeHtml(fri) + ') 국내 장 마감 15:30 이후 등락</small></h4>'
        + '<div class="hwr2-live">' + liveColumn(rows.slice(0, half), '종목') + (rows.length > half ? liveColumn(rows.slice(half), '종목') : '') + '</div>'
        + '<p class="hwr2-live-note">국내주식 토큰은 바이낸스 무기한선물(파생상품) 가격입니다. 실제 주식 수급이 아닌 월요일 개장 전 참고 지표입니다.</p>';
      mount.hidden = false;
    }).catch(function () { /* 보조 정보 - 실패하면 구역을 숨긴 채(또는 직전 표 그대로) 둔다 */ });
  }

  // 2026-10-04 사용자 요청("미국 주말 뉴스를 보고 주목할 만한 테마나 종목 추천"): /weekend-us-themes(30분 캐시).
  // 서버가 금~일 미국 뉴스 제목에서 테마 키워드 언급 수를 세고, 국내 관련 종목은 운영 섹터 분류에서 꺼낸다.
  var THEMES_URL = 'https://goodbyestar.cloud/weekend-us-themes';
  function themeBlock(theme) {
    var headlines = (theme.headlines || []).map(function (item) {
      var when = dateLabel(item.pubDate);
      // 번역(title_ko)이 있으면 한국어 제목을 보이고 원문은 마우스를 올리면 보이게 둔다.
      var ko = String(item.title_ko || '').trim();
      return '<li><a href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener"' + (ko ? ' title="' + escapeHtml(item.title) + '"' : '') + '>' + escapeHtml(ko || item.title) + '</a>'
        + '<small>' + escapeHtml([item.source, when].filter(Boolean).join(' · ')) + '</small></li>';
    }).join('');
    var kr = (theme.krStocks || []).map(function (stock) {
      return '<a href="/page/stock-search?code=' + encodeURIComponent(stock.code) + '&name=' + encodeURIComponent(stock.name || '') + '">' + escapeHtml(stock.name) + '</a>';
    }).join('');
    var us = (theme.usTickers || []).map(function (ticker) { return '<span>' + escapeHtml(ticker) + '</span>'; }).join('');
    return '<article class="hwr2-theme' + (theme.risk ? ' is-risk' : '') + '">'
      + '<div class="hwr2-theme-head"><strong>' + escapeHtml(theme.name) + '</strong>'
      + '<span>' + (theme.risk ? '조심할 재료 · ' : '') + '기사 ' + Number(theme.count || 0) + '건</span></div>'
      + '<ul class="hwr2-theme-news">' + headlines + '</ul>'
      + (kr ? '<div class="hwr2-theme-stocks"><em>국내 관련</em>' + kr + '</div>' : '')
      + (us ? '<div class="hwr2-theme-stocks hwr2-theme-us"><em>미국</em>' + us + '</div>' : '')
      + '</article>';
  }
  function loadWeekendThemes(root) {
    var mount = root.querySelector('[data-hwr-themes]');
    if (!mount) return;
    if (!themesMemo || Date.now() - themesMemo.t > 60000) themesMemo = { t: Date.now(), promise: fetchJsonTimeout(THEMES_URL, 8000) };
    themesMemo.promise.then(function (payload) {
      var data = payload && payload.data || {};
      var themes = (data.themes || []).filter(function (theme) { return theme && theme.count > 0; });
      if (!themes.length) return;
      mount.innerHTML = '<div class="hwr2-h"><h3>주말 미국 뉴스로 본 관심 테마</h3><p>' + escapeHtml(data.basis || '') + ' · 매수 추천이 아니라 월요일에 확인할 후보입니다</p></div>'
        + '<div class="hwr2-theme-grid">' + themes.map(themeBlock).join('') + '</div>';
      mount.hidden = false;
    }).catch(function () { /* 테마는 보조 구역 - 실패하면 숨긴다 */ });
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
  // 2026-10-04 사용자 요청("캔들 말고 다른 걸로"): 장식 대신 정보를 그린다 - "주간 맥박".
  // 2026-10-05 사용자 지적("미국장이랑 구분을 할 수가 없잖아"): 4개 지수를 한 줄로 평균하면 국내·미국이 섞인다
  // (예: 9/28 주 KOSPI -1.09%·KOSDAQ +5.78% / 나스닥 +0.45%·S&P500 -0.27%). 국내(KOSPI·KOSDAQ)·미국(나스닥·S&P500) 두 줄로 나눈다.
  // 2026-10-05 사용자 요청: 잠시 선(직전 금요일 종가 기준 누적 등락)으로 그렸다가, 빨강·파랑 반반 캡슐 그림을 보고 "알약으로 표시"로 바꿨다.
  // 캡슐 왼쪽 절반 = 국내(KOSPI·KOSDAQ 주간 평균), 오른쪽 절반 = 미국(나스닥·S&P500 주간 평균). 절반마다 그 시장이 직전 주 금요일
  // 종가보다 위에서 끝났으면 빨강, 아래면 파랑, 데이터가 없으면 회색. 유리 광택·반짝이 입자는 장식이고 정보는 색과 아래 숫자뿐이다.
  // 반쪽마다 <title>로 월~금 누적 등락을 보여준다. 첫 페인트용 색은 인라인 fill로 박는다.
  var WEEK_DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
  var PULSE_MARKETS = [
    { key: 'kr', label: '국내', symbols: ['KOSPI', 'KOSDAQ'] },
    { key: 'us', label: '미국', symbols: ['NASDAQ_INDEX', 'SP500_INDEX'] }
  ];
  var PILL_TONES = {
    up: ['#ff8a80', '#e0443a', '#9c1f18'],
    down: ['#6fa8ff', '#1f6fe0', '#0b3b86'],
    flat: ['#d0d5dd', '#98a2b3', '#667085']
  };
  // 반짝이 입자 위치(반쪽 기준 0~1 좌표, 고정값이라 매번 같은 그림)
  var PILL_SPARKS = [[.18, .35, 1.1], [.32, .62, .7], [.46, .3, .8], [.58, .72, 1], [.7, .45, .6], [.84, .6, .9], [.26, .8, .6], [.64, .22, .7], [.9, .32, .6], [.4, .5, .5], [.12, .58, .5], [.76, .82, .6]];
  var pulseSeq = 0;
  // 지수별 base(직전 주 금요일 종가) 대비 날짜별 누적 등락률 목록
  function weeklyPulse(indices) {
    var byDate = {};
    (indices || []).filter(function (item) { return item && (!item.group || item.group === 'index'); }).forEach(function (item) {
      var base = num(item.base);
      if (base == null || base === 0) return;
      (item.series || []).forEach(function (point) {
        var close = num(point && point.close);
        var day = String(point && point.date || '').slice(0, 10);
        if (close == null || !day) return;
        (byDate[day] = byDate[day] || []).push((close - base) / base * 100);
      });
    });
    return byDate;
  }
  function average(list) {
    return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : null;
  }
  function sentimentArt(indices) {
    var up = isBullishWeek(indices);
    var weekly = (indices || []).filter(function (item) { return item && (!item.group || item.group === 'index'); })
      .map(function (item) { return num(item.changeRate); }).filter(function (v) { return v != null; });
    var avg = average(weekly);
    var markets = PULSE_MARKETS.map(function (market) {
      var items = (indices || []).filter(function (item) { return item && market.symbols.indexOf(item.symbol) !== -1; });
      return { market: market, byDate: weeklyPulse(items), weekly: average(items.map(function (item) { return num(item.changeRate); }).filter(function (v) { return v != null; })) };
    }).filter(function (row) { return Object.keys(row.byDate).length; });
    var dayKeys = {};
    markets.forEach(function (row) { Object.keys(row.byDate).forEach(function (day) { dayKeys[day] = true; }); });
    var days = Object.keys(dayKeys).sort().slice(-5).map(function (day) {
      var parsed = new Date(day + 'T00:00:00+09:00');
      return { day: day, label: isNaN(parsed.getTime()) ? day.slice(8) : WEEK_DAYS_KO[parsed.getDay()] };
    });
    markets.forEach(function (row) {
      row.changes = days.map(function (d) { return row.byDate[d.day] ? average(row.byDate[d.day]) : null; });
    });
    var UP = '#d24f45', DOWN = '#1261c4';
    var id = 'hwrPill' + (++pulseSeq);
    var W = 168, H = 64, X = 6, Y = 8, PW = 156, PH = 46, R = 23, half = PW / 2;
    var byKey = {};
    markets.forEach(function (row) { byKey[row.market.key] = row; });
    var halves = PULSE_MARKETS.map(function (market, i) {
      var row = byKey[market.key];
      var weekly = row ? row.weekly : null;
      var tone = weekly == null ? 'flat' : weekly >= 0 ? 'up' : 'down';
      var c = PILL_TONES[tone];
      var x0 = X + i * half;
      var tip = market.label + (weekly == null ? ' 데이터 없음' : ' 주간 ' + signed(weekly) + ' (직전 금요일 종가 대비 '
        + row.changes.map(function (v, k) { return days[k].label + ' ' + (v == null ? '휴장' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'); }).join(' · ') + ')');
      var sparks = PILL_SPARKS.map(function (p) {
        return '<circle cx="' + (x0 + p[0] * half).toFixed(1) + '" cy="' + (Y + p[1] * PH).toFixed(1) + '" r="' + p[2] + '" fill="#fff" fill-opacity=".55"/>';
      }).join('');
      return { market: market, row: row, weekly: weekly, tone: tone,
        defs: '<linearGradient id="' + id + market.key + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset=".55" stop-color="' + c[1] + '"/><stop offset="1" stop-color="' + c[2] + '"/></linearGradient>',
        body: '<g class="hwr-pill-half is-' + tone + '"><title>' + escapeHtml(tip) + '</title><rect x="' + x0 + '" y="' + Y + '" width="' + half + '" height="' + PH + '" fill="url(#' + id + market.key + ')"/>' + sparks + '</g>' };
    });
    var pill = '<svg class="hwr-pill" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">'
      + '<defs><clipPath id="' + id + 'c"><rect x="' + X + '" y="' + Y + '" width="' + PW + '" height="' + PH + '" rx="' + R + '"/></clipPath>'
      + halves.map(function (h) { return h.defs; }).join('')
      + '<radialGradient id="' + id + 'sh" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>'
      + '<ellipse class="hwr-pill-shadow" cx="' + (W / 2) + '" cy="' + (Y + PH + 5) + '" rx="' + (PW / 2 - 6) + '" ry="4" fill="url(#' + id + 'sh)"/>'
      + '<g clip-path="url(#' + id + 'c)">' + halves.map(function (h) { return h.body; }).join('')
      + '<rect x="' + (X + 14) + '" y="' + (Y + 5) + '" width="' + (PW - 28) + '" height="9" rx="4.5" fill="#fff" fill-opacity=".38"/>'
      + '<rect x="' + (X + half - 1) + '" y="' + Y + '" width="2" height="' + PH + '" fill="#fff" fill-opacity=".55"/></g>'
      + '<rect x="' + X + '" y="' + Y + '" width="' + PW + '" height="' + PH + '" rx="' + R + '" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1"/>'
      + '</svg>';
    var labels = '<span class="hwr-pill-labels">' + halves.map(function (h) {
      var color = h.weekly == null ? '' : ' style="color:' + (h.weekly >= 0 ? UP : DOWN) + '"';
      return '<span><small>' + h.market.label + '</small><b class="' + signClass(h.weekly) + '"' + color + '>' + (h.weekly == null ? '-' : signed(h.weekly)) + '</b></span>';
    }).join('') + '</span>';
    var color = up ? UP : DOWN;
    var label = up ? '상승 마감 주간' : '하락 마감 주간';
    var aria = label + markets.map(function (row) { return ', ' + row.market.label + ' 주간 평균 ' + (row.weekly == null ? '확인 불가' : signed(row.weekly)); }).join('');
    return '<div class="hwr-sentiment hwr-pulse hwr-sentiment--' + (up ? 'up' : 'down') + '" style="color:' + color + '" aria-label="' + escapeHtml(aria) + '">'
      + (markets.length ? '<span class="hwr-pill-wrap">' + pill + labels + '</span>' : '')
      + '<span class="hwr-pulse-text"><strong>' + label + '</strong>' + (avg != null ? '<em>4개 지수 평균<b>' + signed(avg) + '</b></em>' : '') + '</span></div>';
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
    // 2026-08-31 회귀 수정: 여기 `fill="#2563eb" fill-opacity=".10"`을 쓰면 CSS의
    // `.hwr-fx-interest-band { fill: rgba(37,99,235,.10) }`가 fill만 덮고 fill-opacity는
    // CSS에 없어서 프레젠테이션 속성이 그대로 살아남는다 -> 0.10 x 0.10 = 불투명도 1%로
    // 매수 관심 구간이 사실상 안 보였다(2026-08-30 FOUC 수정에서 들어간 값).
    // CSS와 같은 최종 색을 fill 하나로 넣어 곱해지지 않게 한다.
    var interestBand = p25 == null || low == null ? '' : '<rect class="hwr-fx-interest-band" x="0" y="' + bandTop.toFixed(1) + '" width="100" height="' + bandHeight.toFixed(1) + '" rx="1" fill="rgba(255, 179, 0, 0.45)"></rect>';
    var spark = signClass(fx.change_rate);
    var fxGlow = glowParts(poly, 44, spark);
    return '<div class="hwr-fx-chart"><svg class="hwr-fx-spark ' + spark + '" viewBox="0 0 100 44" width="100%" height="72" preserveAspectRatio="none" role="img" aria-label="최근 1년 ' + escapeHtml(title || '자산') + ' 추이">'
      + '<line class="hwr-fx-guide-line" x1="0" y1="5" x2="100" y2="5"' + guideAttrs + '></line>'
      + '<line class="hwr-fx-guide-line" x1="0" y1="39" x2="100" y2="39"' + guideAttrs + '></line>'
      + fxGlow.svg + interestBand + averageLine
      + '<polyline points="' + poly + '" fill="none" stroke="' + strokeAttr(spark, '#64748b') + '" stroke-width="1.7" vector-effect="non-scaling-stroke"></polyline></svg>' + fxGlow.dot + '</div>';
  }
  function rangeCard(fx, options) {
    fx = fx || {};
    options = options || {};
    var analysis = fx.analysis || rangeAnalysis(fx, options.fallbackMessage);
    var current = analysis.current != null ? analysis.current : fx.price;
    var average = analysis.average;
    var low = analysis.low, high = analysis.high, p25 = analysis.p25;
    var isUsd = options.unit === 'usd';
    var symbol = isUsd ? 'US' : 'KRW';
    // 2026-08-31: formatPrice()는 US 심볼이면 이미 '$'를 앞에 붙인다. 여기서 단위를 또
    // 붙여서 "$4,504.3$"처럼 달러 기호가 두 번 나오고 있었다(금 선물 카드 전부).
    // 원화만 뒤에 '원'을 붙인다.
    var display = function (value) {
      return value == null ? '-' : formatPrice(value, symbol) + (isUsd ? '' : '원');
    };
    // 숫자는 라벨과 분리해 nowrap으로 감싼다 - 좁은 폭에서 "1,411원"이 "1," / "411원"으로
    // 쪼개지던 문제(2026-08-31 사용자 리포트).
    var num_ = function (value) { return '<span class="hwr-fx-num">' + display(value) + '</span>'; };
    var status = (analysis.status || 'unknown').replace(/[^a-z-]/g, '');
    return '<article class="hwr-fx-card hwr-fx-card--' + escapeHtml(status) + '"><div class="hwr-card-title"><strong>' + escapeHtml(options.title || '원/달러 환율') + '</strong><span>최근 1년 기준</span></div><div class="hwr-fx-main"><strong>' + num_(current) + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b></div>' + fxSparkline(fx, options.title) + '<div class="hwr-fx-legend"><span><i class="hwr-fx-legend-line hwr-fx-legend-line--average"></i>1년 평균 <b>' + num_(average) + '</b></span><span><i class="hwr-fx-legend-swatch"></i>매수 관심 ≤ ' + num_(p25) + '</span></div><div class="hwr-fx-range"><span>1년 저점 ' + num_(low) + '</span><span>1년 고점 ' + num_(high) + '</span></div><div class="hwr-fx-meta">' + fxStatus(fx, options.fallbackLabel, options.fallbackMessage) + '</div></article>';
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
  // 2026-10-04 요청: "다음 주 핵심 스케줄은 캘린더랑 연동돼서 다 볼 수 있게". 서버 schedule(주요 일정 일부)만 쓰지 않고
  // /page/stock-calendar가 쓰는 같은 모듈(StockCalendar.fetchEvents: 구글 캘린더+DART+미국 실적)에서 다음 주 월~일 일정을 모두 가져와 보여준다.
  // 모듈이 없거나 일정이 하나도 없으면 서버 일정 목록을 그대로 둔다.
  var CALENDAR_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/stock-calendar.js?v=20261004-econ-sp100-v1';
  var SCHEDULE_VISIBLE = 12;
  var WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
  function loadCalendarModule() {
    if (window.StockCalendar && window.StockCalendar.fetchEvents) return Promise.resolve(window.StockCalendar);
    return new Promise(function (resolve) {
      var existing = document.querySelector('script[data-hwr-calendar]');
      var script = existing || document.createElement('script');
      function done() { resolve(window.StockCalendar && window.StockCalendar.fetchEvents ? window.StockCalendar : null); }
      script.addEventListener('load', done);
      script.addEventListener('error', function () { resolve(null); });
      if (!existing) {
        script.src = CALENDAR_SCRIPT_URL;
        script.async = true;
        script.setAttribute('data-hwr-calendar', '1');
        document.head.appendChild(script);
      }
      setTimeout(done, 8000);
    });
  }
  function calendarMarket(event) {
    var source = String(event && (event.source || event.provider) || '').toLowerCase();
    var title = String(event && event.title || '');
    if (/finnhub/.test(source) || /^\$[A-Z]/.test(title)) return '미국';
    if (/dart/.test(source)) return '한국';
    return '일정';
  }
  // 2026-10-04: "$PEP 실적발표 (장전)"에서 티커만 지워 "실적발표 (장전)"처럼 누구 일정인지 안 보이던 것을
  // 캘린더 모듈의 describe()(한글 회사명·지표 구분)로 바꾼다. 경제지표 시각은 KST로 붙인다.
  function calendarRow(event, index) {
    var day = String(event.start || '').slice(0, 10);
    var parsed = new Date(day + 'T00:00:00+09:00');
    var label = day.slice(5).replace('-', '/') + (isNaN(parsed.getTime()) ? '' : ' ' + WEEKDAY_KO[parsed.getDay()]);
    var info = window.StockCalendar && window.StockCalendar.describe
      ? window.StockCalendar.describe(event)
      : { kind: calendarMarket(event), text: String(event.title || '').replace(/^\$[A-Z]{1,6}\s+/, ''), important: false };
    var clock = /T(\d{2}:\d{2})/.exec(String(event.start || ''));
    var text = info.text + (info.kind === '지표' && clock ? ' · ' + clock[1] : '');
    var finnhub = /finnhub\.io/i.test(String(event.link || ''));
    var inner = event.link && !finnhub ? '<a href="' + escapeHtml(event.link) + '" target="_blank" rel="noopener">' + escapeHtml(text) + '</a>' : escapeHtml(text);
    return '<li class="' + (index >= SCHEDULE_VISIBLE ? 'is-extra' : '') + (info.important ? ' is-key' : '') + '"><time>' + escapeHtml(label) + '</time><b class="hwr-schedule-market' + (info.kind === '지표' ? ' is-macro' : '') + '">' + escapeHtml(info.kind) + '</b><span>' + inner + '</span></li>';
  }
  function loadNextWeekCalendar(root, weekEndIso) {
    var box = root.querySelector('[data-hwr-schedule]');
    if (!box) return;
    var end = weekEndIso ? new Date(weekEndIso + 'T00:00:00+09:00') : new Date();
    if (isNaN(end.getTime())) return;
    var nextStart = new Date(end.getTime() + 3 * 86400000);
    var nextEnd = new Date(nextStart.getTime() + 6 * 86400000);
    var startIso = fmtIsoDate(nextStart), endIso = fmtIsoDate(nextEnd);
    var calendar = null;
    loadCalendarModule().then(function (module) {
      calendar = module;
      if (!calendar) return null;
      var months = [];
      [nextStart, nextEnd].forEach(function (date) {
        var key = date.getFullYear() + '-' + date.getMonth();
        if (!months.some(function (m) { return m.key === key; })) months.push({ key: key, year: date.getFullYear(), month: date.getMonth() });
      });
      return Promise.all(months.map(function (m) { return calendar.fetchEvents(m.year, m.month).catch(function () { return []; }); }));
    }).then(function (groups) {
      if (!groups) return;
      var merged = [];
      groups.forEach(function (group) { merged = merged.concat(group || []); });
      var events = merged.filter(function (event) {
        var day = String(event && event.start || '').slice(0, 10);
        return day >= startIso && day <= endIso;
      });
      // 같은 날 안에서는 주요 경제지표(CPI·고용·FOMC 등)를 먼저 둔다 - 12건만 보일 때 묻히지 않게.
      var keyOf = function (event) {
        var info = calendar.describe ? calendar.describe(event) : {};
        return String(event.start || '').slice(0, 10) + (info.important ? '0' : info.kind === '지표' ? '1' : '2');
      };
      events = events.map(function (event, i) { return { e: event, k: keyOf(event), i: i }; })
        .sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i; })
        .map(function (row) { return row.e; });
      if (!events.length) return;
      var title = box.querySelector('.hwr-card-title span');
      if (title) title.textContent = '캘린더 연동 · ' + startIso.slice(5).replace('-', '/') + ' ~ ' + endIso.slice(5).replace('-', '/') + ' 전체 ' + events.length + '건';
      var list = box.querySelector('.hwr-schedule-list') || box.querySelector('.hwr-empty');
      var html = '<ul class="hwr-schedule-list">' + events.map(calendarRow).join('') + '</ul>'
        + (events.length > SCHEDULE_VISIBLE ? '<div class="hwr2-more-wrap"><button type="button" class="hwr2-more" data-hwr-schedule-more aria-expanded="false">나머지 ' + (events.length - SCHEDULE_VISIBLE) + '건 더보기</button></div>' : '')
        + '<p class="hwr2-cal-link"><a href="/page/stock-calendar">캘린더에서 전체 보기 →</a></p>';
      if (list) list.outerHTML = html; else box.insertAdjacentHTML('beforeend', html);
      var more = box.querySelector('[data-hwr-schedule-more]');
      if (more) more.addEventListener('click', function () {
        var open = !box.classList.contains('is-expanded');
        box.classList.toggle('is-expanded', open);
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        more.textContent = open ? '접기' : '나머지 ' + (events.length - SCHEDULE_VISIBLE) + '건 더보기';
      });
    }).catch(function () { /* 캘린더 연동은 보조 - 실패하면 서버 일정 목록을 그대로 둔다 */ });
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
    // 2026-09-05: js/skin-shell.js의 MarketHours 하나만 본다. 여기 있던 창(토 07:00~
    // 월 06:00)이 홈의 휴장 창(토 09:00~월 09:00)과 달라서, 겹치지 않는 토 07:00~09:00에
    // 들어오면 리포트가 대시보드 앞에 붙고 휴장 안내가 화면 맨 밑으로 밀렸다.
    var hours = window.MarketHours;
    return hours ? hours.isWeekendClosed(date) : false;
  }
  function render(root, payload) {
    var data = payload && payload.data ? payload.data : payload || {};
    var weekendDay = new Date().getDay();
    var title = weekendDay === 0 || weekendDay === 1 ? '다음 주 준비 리포트' : '한 주 마감 리포트';
    var indices = data.indices || [];
    var fx = data.fx || {};
    var gold = data.gold || {};
    applyLockSentiment(isBullishWeek(indices));
    // 2026-10-04 재디자인: ①휴장 안내(배너, 대시보드 쪽) → ②다음 주 준비(지수·환율·금·일정) → ③움직인 종목 → ④다음 주 체크 종목 → ⑤뉴스.
    // 데이터·계산은 그대로, 카드를 큰 구역 단위로 줄이고 종목·뉴스는 한 줄 행으로 보여준다.
    var indexCards = indices.filter(function (item) {
      return item && ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX'].indexOf(item.symbol) !== -1;
    }).map(function (item) {
      return '<article class="hwr-index-card"><strong class="hwr2-idx-name">' + escapeHtml(item.name) + '</strong><b>' + formatMarketValue(item) + '</b>'
        + '<span class="hwr2-idx-chg ' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</span>'
        + '<div class="hwr-spark">' + sparkline(item.series, 'hwr-index-spark ' + signClass(item.changeRate)) + '</div></article>';
    }).join('');
    root.innerHTML = '<div class="hwr-head"><div class="hwr-head-copy"><h2>' + title + '</h2><p>이번 주 시장 흐름을 한눈에</p></div>' + sentimentArt(indices) + '<div class="hwr-period">' + escapeHtml(data.week && data.week.label || '기준일 확인 중') + '<small>금요일 장 마감 기준</small></div></div>'
      + '<section class="hwr2-section hwr2-prep">'
      + '<div class="hwr-index-grid">' + indexCards + '</div>'
      + indexSummary(indices)
      + '<div class="hwr2-live-wrap" data-hwr-live hidden></div>'
      + '<h4 class="hwr2-sub">시장 흐름</h4>'
      + '<div class="hwr-summary-row hwr-asset-row"><div>' + rangeCard(fx, { title: '원/달러 환율', unit: 'krw', fallbackLabel: '환율 데이터 확인 중', fallbackMessage: '1년 환율 데이터가 부족합니다.' }) + '</div><div>' + rangeCard(gold, { title: '금 선물', unit: 'usd', fallbackLabel: '금 시세 데이터 확인 중', fallbackMessage: '1년 금 시세 데이터가 부족합니다.' }) + '</div></div>'
      + '<article class="hwr-schedule" data-hwr-schedule><div class="hwr-card-title"><strong>다음 주 핵심 스케줄</strong><span>' + escapeHtml(data.scheduleBasis || '확인된 주요 일정만 표시') + '</span></div>' + scheduleList(data.schedule) + '</article>'
      + '<article class="hwr-schedule hwr-my-schedule" data-hwr-my-schedule hidden></article>'
      + '</section>'
      + moversSection(data)
      + '<section class="hwr2-section hwr2-themes" data-hwr-themes hidden></section>'
      + checkSection(data)
      + '<section class="hwr2-section hwr2-news"><div class="hwr2-h hwr2-h--tools"><div><h3>시장 뉴스</h3><p>' + escapeHtml(data.news && data.news.basis || '금~일 날짜별 주요 뉴스 · 한국·미국 통합') + '</p></div>'
      + '<div class="hwr-news-filters" role="tablist" aria-label="뉴스 유형 필터"><button type="button" role="tab" aria-selected="true" class="is-active" data-hwr-news-filter="all">통합</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="뉴스">뉴스</button><button type="button" role="tab" aria-selected="false" data-hwr-news-filter="공시">공시</button></div></div>'
      + newsTimeline(data.news && data.news.timeline) + '</section>'
      + '<p class="hwr-disclaimer">뉴스·일정은 수집 시점에 확인된 제목과 발표일만 표시합니다. 투자 판단의 단독 근거로 사용하지 마세요.</p>';
    bindNewsFilters(root);
    bindNewsMore(root);
    loadMyWatchlistSchedule(root, data.week && data.week.end);
    loadNextWeekCalendar(root, data.week && data.week.end);
    loadWeekendLive(root, data.week && data.week.end);
    loadWeekendThemes(root);
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
    if (!feed) return null;
    var dashboard = feed.querySelector('.home-dashboard');

    // 2026-09-04: 리포트는 **항상** 대시보드 바로 뒤에 둔다.
    //
    // 예전에는 붙이는 위치를 그때의 선택 시장(closedSelected)으로 갈랐는데, 주말 판정
    // 창이 두 곳에서 서로 달라서 어긋났다.
    //   - 이 파일 isWeekendWindow(): 토 07:00 ~ 월 06:00 → 리포트를 붙인다
    //   - skin-main.js isClosedWindowKst(): 토 09:00 ~ 월 09:00 → 시장이 'closed'가 된다
    // 겹치지 않는 토 07:00~09:00에 홈에 들어오면 리포트는 붙는데 시장은 아직 'us'라
    // else 가지를 타 **대시보드 앞**에 들어갔다. 그 상태에서 사용자가 휴장 탭을 누르면
    // 휴장 안내(WEEKEND MARKET NOTE)가 긴 주간 리포트 아래로 밀려 화면 맨 밑에 나왔다
    // (사용자 리포트: "이게 맨 밑에 있어"). init()이 다시 불려도 existing이 있으면
    // 그대로 return 해서 위치를 되돌릴 기회도 없었다.
    //
    // 리포트가 보이는 건 어차피 휴장일 때뿐이고(skin-main.js applyHomeMarketSession이
    // isClosed로 hidden을 동기화한다), 휴장 지면의 머리글은 대시보드 안의 휴장 안내다.
    // 그러니 리포트가 그 앞에 설 이유가 없다. 판정 창이 또 어긋나도 순서가 흔들리지
    // 않도록 위치를 시장 선택과 분리한다.
    if (existing) {
      if (dashboard && existing.previousElementSibling !== dashboard) {
        dashboard.insertAdjacentElement('afterend', existing);
      }
      return null;
    }
    ensureStyle();
    var root = document.createElement('section');
    root.id = 'homeWeeklyReport'; root.className = 'home-weekly-report';
    root.innerHTML = '<div class="hwr-loading"><strong>주간 리포트를 준비하는 중입니다.</strong><span>지수·뉴스·일정을 묶고 있습니다.</span></div>';
    if (dashboard) dashboard.insertAdjacentElement('afterend', root);
    else feed.insertBefore(root, feed.firstChild);
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
