/**
 * Weekend-only weekly market recap. The live dashboard remains a weekday view;
 * MarketHours and the explicit closed tab control this compact view.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/weekly-report';
  var CSS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-weekly-report.css?v=20261025-weekly-news-black-cards';
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
    if (value == null || value === '') return null;
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
  // 2026-10-18 사용자 요청: 휴장 리포트의 지수 미니 차트에도 장중 대시보드처럼 마우스를 올리면 날짜·종가·전일 대비를 보여 준다.
  // 좌표는 sparkline()과 같은 식이며(viewBox 100x32), js/home-chart-hover.js(skin-main이 로드)가 data-hover-points 를 읽는다.
  function indexHoverAttr(item) {
    var rows = (item && item.series || []).map(function (point) { return { date: point.date, close: num(point.close) }; })
      .filter(function (row) { return row.close != null; });
    if (rows.length < 2) return '';
    var values = rows.map(function (row) { return row.close; });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), range = max - min || 1;
    var base = num(item.base);
    var points = rows.map(function (row, index) {
      var prev = index ? rows[index - 1].close : base;
      var change = prev ? (row.close / prev - 1) * 100 : null;
      var text = dateLabel(row.date) + ' 종가 ' + row.close.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
        + (change != null ? ' (' + (index ? '전일 ' : '직전 주 마감 ') + (change > 0 ? '+' : '') + change.toFixed(2) + '%)' : '');
      return [2 + index * 96 / (rows.length - 1), (30 - (row.close - min) / range * 26) / 32 * 100, text];
    });
    return ' data-hover-points="' + JSON.stringify(points.map(function (point) { return [Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100, point[2]]; }))
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"';
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
  // 2026-10-11 사용자 요청: 휴장 화면의 '시장 뉴스' 구역을 삭제했다(렌더·이벤트·뉴스 전용 함수). 서버 /weekly-report 의 뉴스 수집·응답은 그대로다.
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
  function candidateRows(items) {
    if (!items || !items.length) return '<p class="hwr-empty">현재 조건 충족 후보 없음</p>';
    return '<ol class="hwr2-rows hwr2-rows--candidates">' + items.slice(0, 5).map(function (item, index) {
      var waves = item.waves || {};
      var reasons = [];
      if (waves.mid === '상승 추세') reasons.push('중기 상승');
      if (waves.small === '상승 추세') reasons.push('단기 상승');
      if (item.momentum === '강화') reasons.push('수급 강화');
      if (item.fundamental === '지지') reasons.push('펀더멘털 지지');
      if (item.risk === '없음') reasons.push('위험 없음');
      return '<li><i class="hwr2-rank">' + (index < 9 ? '0' : '') + (index + 1) + '</i>'
        + '<span class="hwr2-name"><strong><a href="/page/stock-search?code=' + encodeURIComponent(item.code) + '&name=' + encodeURIComponent(item.name) + '">' + escapeHtml(item.name) + '</a></strong><small>' + escapeHtml(item.code) + '</small>'
        + (reasons.length ? '<em>선정 근거 · ' + escapeHtml(reasons.join(' · ')) + '</em>' : '') + '</span>'
        + '<span class="hwr2-val"><b class="' + signClass(item.changeRate) + '">' + signed(item.changeRate) + '</b><small>' + escapeHtml(formatStockPrice(item)) + '</small></span></li>';
    }).join('') + '</ol>';
  }
  // 2026-10-18 사용자 지적("이 섹터는 금요일 기준이 아니라 한 주간 뜨거운 종목인데"): 서버가 순위에 오른 종목을 주간 등락률로 다시 골라
  // hotStocks.period[시장] = 'week' 로 알려 준다. 주간 자료를 못 받은 시장만 'lastDay'(마지막 거래일 순위)이며 그때는 문구로 밝힌다.
  // 미국 마지막 거래일 순위는 KIS 상승률 순위가 비면 거래대금 상위 약 20종목 안에서만 고르므로 하락장에는 빈 칸이 되어 이유를 적는다.
  function moverPeriod(data, market) {
    var period = (data.hotStocks && data.hotStocks.period) || {};
    return period[market === 'us' ? 'us' : 'domestic'] === 'week' ? 'week' : 'lastDay';
  }
  function emptyMoverText(market, rising, period) {
    if (period === 'week') return rising ? '이번 주 +3% 이상 오른 종목이 순위 후보 중에 없었습니다.' : '이번 주 -3% 이하로 내린 종목이 순위 후보 중에 없었습니다.';
    if (market !== 'us') return '';
    return rising ? '마지막 거래일 거래대금 상위 미국 종목 중 +1% 이상 오른 종목이 없었습니다.'
      : '마지막 거래일 거래대금 상위 미국 종목 중 -1% 이하로 내린 종목이 없었습니다.';
  }
  function moversSection(data) {
    var hot = data.hotStocks || {}, cold = data.coldStocks || {};
    function block(label, market, hotItems, coldItems) {
      var period = moverPeriod(data, market);
      return '<div class="hwr2-market"><h4 class="hwr2-market-title">' + label + (period === 'lastDay' ? ' <small>(마지막 거래일 기준)</small>' : '') + '</h4><div class="hwr2-cols">'
        + '<div class="hwr2-col"><h5 class="hwr2-col-sub is-up">많이 오른 종목</h5>' + moverRows(hotItems, market, emptyMoverText(market, true, period)) + '</div>'
        + '<div class="hwr2-col"><h5 class="hwr2-col-sub is-down">많이 내린 종목</h5>' + moverRows(coldItems, market, emptyMoverText(market, false, period)) + '</div>'
        + '</div></div>';
    }
    var weekly = moverPeriod(data, 'domestic') === 'week' || moverPeriod(data, 'us') === 'week';
    var note = weekly ? '이번 주(월~금) 등락률 기준 · 순위에 오른 종목 중 상승은 +3% 이상, 하락은 -3% 이하만 표시'
      : '마지막 거래일 기준 · 상승은 +1% 이상, 하락은 -1% 이하만 표시';
    return '<section class="hwr2-section"><div class="hwr2-h"><h3>이번 주 움직인 종목</h3><p>' + note + '</p></div>'
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
      + candidateRows(data.hotCandidates && data.hotCandidates.domestic) + '</div>';
    var right = hasPast
      ? '<div class="hwr2-col"><h5 class="hwr2-col-sub">지난 신호 성과 <small>신호일 대비 확정 수익률</small></h5>' + pastOutcomeStatsCard(outcomes.stats) + pastOutcomeRows(past) + '</div>'
      : '';
    return '<section class="hwr2-section"><div class="hwr2-h"><h3>다음 주 체크할 종목</h3><p>국내 중·단기 상승 추세와 위험 필터를 통과한 종목 중, 수급 모멘텀과 펀더멘털 점수를 반영해 최대 5종목을 표시합니다.</p></div>'
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

  // News and stored index requests use the existing public endpoints.
  function fetchJsonTimeout(url, ms) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, ms || 6000);
    return fetch(url, controller ? { signal: controller.signal } : {}).then(function (response) {
      clearTimeout(timer);
      if (!response.ok) throw new Error('live ' + response.status);
      return response.json();
    }, function (error) { clearTimeout(timer); throw error; });
  }
  var lastLiveQuotes = {}, themesMemo, coinModuleJob;
  var LIVE_REFRESH_MS = 30000, liveTimer, liveCtx;
  function coinModule() {
    if (global.CryptoMarket && global.CryptoMarket.fetchCoinQuotes) return Promise.resolve(global.CryptoMarket);
    if (!coinModuleJob) coinModuleJob = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/crypto-market.js?v=20261024-shared-quotes';
      script.onload = function () { resolve(global.CryptoMarket); };
      script.onerror = function () { coinModuleJob = null; reject(new Error('crypto module')); };
      document.head.appendChild(script);
    });
    return coinModuleJob;
  }
  function coinIcon(symbol) {
    var paths = {
      BTC: '<path d="M10 6v12m4-12v2m0 8v2M8 8h6a2 2 0 0 1 0 4H9m5 0a2 2 0 0 1 0 4H8"/>',
      ETH: '<path d="m12 4-5 8 5 3 5-3-5-8Zm-5 10 5 6 5-6m-5-10v11"/>',
      USDT: '<path d="M7 7h10m-5 0v12M6 11c0 3 12 3 12 0m-12 0c0-2 12-2 12 0"/>'
    };
    return '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/>' + (paths[symbol] || '') + '</svg>';
  }
  function stopWeekendLive() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null; liveCtx = null;
    document.removeEventListener('visibilitychange', onLiveVisibility);
  }
  function onLiveVisibility() {
    if (!document.hidden && liveCtx && !liveCtx.root.hidden) loadWeekendLive(liveCtx.root);
  }
  function loadWeekendLive(root) {
    var mount = root.querySelector('[data-hwr-live]');
    if (!mount) return;
    if (!liveTimer) {
      liveTimer = setInterval(function () {
        if (!liveCtx || !document.body.contains(liveCtx.root)) { stopWeekendLive(); return; }
        if (!document.hidden && !liveCtx.root.hidden) loadWeekendLive(liveCtx.root);
      }, LIVE_REFRESH_MS);
      document.addEventListener('visibilitychange', onLiveVisibility);
    }
    liveCtx = {root: root};
    function paint(pairs, current) {
      if (!document.body.contains(mount)) return;
      var rows = pairs.map(function (pair) {
        var row = lastLiveQuotes[pair[0]], fresh = current[pair[0]], rate = row && row.change_rate;
        return '<li class="wd-coin"><span class="wd-coin-icon">' + coinIcon(pair[0]) + '</span><span><strong>' + escapeHtml(pair[1]) + '</strong><small>' + pair[0] + '</small></span><span class="wd-price"><b>' + (row ? formatPrice(row.price) + '원' : '시세 미수신') + '</b><small>' + (row ? (!fresh || row.stale ? '갱신 지연 · 마지막 가격 ' : '') + (row.updated_at ? kstTime(Date.parse(row.updated_at)) : '기준 시각 미제공') : '') + '</small></span><b class="' + signClass(rate) + '">' + (rate == null ? '미제공' : direction(rate) + ' ' + signed(rate)) + '</b></li>';
      }).join('');
      mount.innerHTML = panelHeading('주말에도 움직이는 자산', '시장지표 · 업비트 원화 · 24시간 등락') + '<ul class="wd-list">' + rows + '</ul><a class="wd-more" href="/pages/kospi-futures?tab=crypto">시장지표 가상자산 자세히 →</a>';
      mount.hidden = false;
    }
    coinModule().then(function (module) {
      return module.fetchCoinQuotes().then(function (rows) {
        var current = {};
        rows.forEach(function (row) { if (row && row.price > 0) { current[row.symbol] = row; lastLiveQuotes[row.symbol] = row; } });
        paint(module.coins, current);
      }, function () { paint(module.coins, {}); });
    }).catch(function () { mount.innerHTML = panelHeading('주말에도 움직이는 자산', '시장지표 가상자산') + '<p class="wd-empty">시세를 불러오지 못했습니다.</p>'; });
  }

  // 2026-10-04 사용자 요청("미국 주말 뉴스를 보고 주목할 만한 테마나 종목 추천"): /weekend-us-themes(30분 캐시).
  // 서버가 금~일 미국 뉴스 제목에서 테마 키워드 언급 수를 세고, 국내 관련 종목은 운영 섹터 분류에서 꺼낸다.
  var THEMES_URL = 'https://goodbyestar.cloud/weekend-us-themes';
  var newsCarousel = null;
  function loadWeekendThemes(root) {
    var mount = root.querySelector('[data-hwr-themes]');
    if (!mount) return;
    if (!themesMemo || Date.now() - themesMemo.t > 60000) themesMemo = {t: Date.now(), promise: fetchJsonTimeout(THEMES_URL, 8000)};
    themesMemo.promise.then(function (payload) {
      var data = payload && payload.data || {}, seen = {};
      var themes = (data.themes || []).map(function (theme) {
        var headlines = (theme.headlines || []).filter(function (item) {
          if (!item || !item.title || !item.source || !item.pubDate || !/^https?:\/\//.test(item.link || '') || seen[item.link]) return false;
          seen[item.link] = true; return true;
        });
        return Object.assign({}, theme, {headlines: headlines});
      }).filter(function (theme) { return theme.headlines.length; });
      mount.innerHTML = panelHeading('이번 주 주요뉴스', '뉴스로 살펴보는 테마와 주요 종목 · ' + (data.window ? data.window.start + ' ~ ' + data.window.end : '기사 발행일 기준')) + (themes.length ? '<div class="wd-news-shelf"><div class="wd-news-track" tabindex="0" role="region" aria-label="이번 주 주요뉴스 카드">' + themes.map(function (theme) {
        var headline = theme.headlines[0];
        var sectors = (theme.krSectors || []).filter(function (sector, i, rows) { return typeof sector === 'string' && rows.indexOf(sector) === i; });
        var stocks = (theme.krStocks || []).filter(function (stock) { return stock.code && stock.name; });
        var koreanLine = headline.summary_ko || headline.description_ko || headline.title_ko || '한국어 뉴스 내용을 준비 중입니다.';
        return '<article class="wd-news-card"><small class="wd-news-source">' + escapeHtml(headline.source || '출처 미상') + ' · ' + escapeHtml(dateLabel(headline.pubDate)) + '</small>'
          + '<a class="wd-news-title" href="' + escapeHtml(headline.link) + '" target="_blank" rel="noopener">' + escapeHtml(headline.title) + '</a>'
          + '<hr class="wd-news-rule" aria-hidden="true">'
          + '<p class="wd-news-korean" title="' + escapeHtml(koreanLine) + '">' + escapeHtml(koreanLine) + '</p>'
          + '<hr class="wd-news-rule" aria-hidden="true">'
          + '<div class="wd-news-topics"><span class="wd-news-label">관련 테마</span><div class="wd-tags"><span class="wd-theme-badge">' + escapeHtml(theme.name) + '</span>' + sectors.map(function (sector) { return '<span class="wd-theme-badge">' + escapeHtml(sector) + '</span>'; }).join('') + (theme.risk ? '<span class="wd-theme-badge">리스크 점검</span>' : '') + '</div></div>'
          + '<div class="wd-news-stocks"><span class="wd-news-label">관심종목</span><div class="wd-related">' + (stocks.length ? stocks.map(function (stock) { return '<a href="/page/stock-search?code=' + encodeURIComponent(stock.code) + '&name=' + encodeURIComponent(stock.name) + '">' + escapeHtml(stock.name) + '</a>'; }).join('') : '<span>연결된 종목 없음</span>') + '</div></div></article>';
      }).join('') + '</div><div class="wd-news-controls"><button type="button" data-wd-news-prev aria-label="이전 뉴스">&#8249;</button><button type="button" data-wd-news-next aria-label="다음 뉴스">&#8250;</button></div></div>' : '<p class="wd-empty">현재 확인된 뉴스 없음</p>') + '<a class="wd-more" href="/pages/main-news">주요 뉴스 전체 →</a>';
      (global.SiteInteractionsReady || Promise.resolve(global.SiteInteractions)).then(function (module) {
        if (!module || !root.contains(mount) || !document.body.contains(root)) return;
        newsCarousel = module.carousel(mount, {track: '.wd-news-track', card: '.wd-news-card', previous: '[data-wd-news-prev]', next: '[data-wd-news-next]'});
      }).catch(function () { /* Native horizontal scrolling remains available. */ });
    }).catch(function () { mount.innerHTML = panelHeading('이번 주 주요뉴스', '기존 뉴스 캐시') + '<p class="wd-empty">뉴스를 불러오지 못했습니다.</p>'; });
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
  function fxSparkline(fx, title, unit) {
    var analysis = fx && fx.analysis || {};
    var rows = (fx && fx.chart || []).map(function (point) { return { date: point && point.date, close: num(point && point.close) }; })
      .filter(function (row) { return row.close != null; });
    var points = rows.map(function (row) { return row.close; });
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
    var interestBand = p25 == null || low == null ? '' : '<rect class="hwr-fx-interest-band" x="0" y="' + bandTop.toFixed(1) + '" width="100" height="' + bandHeight.toFixed(1) + '" rx="1" fill="rgba(255, 205, 90, 0.24)"></rect>';
    var spark = signClass(fx.change_rate);
    var fxGlow = glowParts(poly, 44, spark);
    // 2026-10-18 사용자 요청: 환율·금 선물 1년 차트도 마우스를 올리면 날짜와 값을 보여 준다(js/home-chart-hover.js가 읽는다).
    var fxIsUsd = unit === 'usd';
    var fxHover = JSON.stringify(rows.map(function (row, index) {
      var prev = index ? rows[index - 1].close : null;
      var change = prev ? (row.close / prev - 1) * 100 : null;
      var value = fxIsUsd ? '$' + row.close.toLocaleString('en-US', { maximumFractionDigits: 1 }) : row.close.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '원';
      return [Math.round((2 + index * 96 / Math.max(1, rows.length - 1)) * 100) / 100, Math.round(y(row.close) / 44 * 10000) / 100,
        String(row.date || '').slice(0, 10) + ' 종가 ' + value + (change != null ? ' (전일 ' + (change > 0 ? '+' : '') + change.toFixed(2) + '%)' : '')];
    })).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<div class="hwr-fx-chart" data-hover-points="' + fxHover + '"><svg class="hwr-fx-spark ' + spark + '" viewBox="0 0 100 44" width="100%" height="72" preserveAspectRatio="none" role="img" aria-label="최근 1년 ' + escapeHtml(title || '자산') + ' 추이">'
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
    return '<article class="hwr-fx-card hwr-fx-card--' + escapeHtml(status) + '"><div class="hwr-card-title"><strong>' + escapeHtml(options.title || '원/달러 환율') + '</strong><span>최근 1년 기준</span></div><div class="hwr-fx-main"><strong>' + num_(current) + '</strong><b class="' + signClass(fx.change_rate) + '">' + signed(fx.change_rate) + '</b></div>' + fxSparkline(fx, options.title, options.unit) + '<div class="hwr-fx-legend"><span><i class="hwr-fx-legend-line hwr-fx-legend-line--average"></i>1년 평균 <b>' + num_(average) + '</b></span><span><i class="hwr-fx-legend-swatch"></i>매수 관심 ≤ ' + num_(p25) + '</span></div><div class="hwr-fx-range"><span>1년 저점 ' + num_(low) + '</span><span>1년 고점 ' + num_(high) + '</span></div><div class="hwr-fx-meta">' + fxStatus(fx, options.fallbackLabel, options.fallbackMessage) + '</div></article>';
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
  var SCHEDULE_VISIBLE = 5;
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
    var label = day.slice(5).replace('-', '/') + (isNaN(parsed.getTime()) ? '' : ' ' + WEEKDAY_KO[new Date(day + 'T00:00:00Z').getUTCDay()]);
    var info = window.StockCalendar && window.StockCalendar.describe
      ? window.StockCalendar.describe(event)
      : { kind: calendarMarket(event), text: String(event.title || '').replace(/^\$[A-Z]{1,6}\s+/, ''), important: false };
    var clock = /T(\d{2}:\d{2})/.exec(String(event.start || ''));
    var mine = watchlistSymbolMap()[String(event.symbol || '').toUpperCase()];
    var text = (mine ? '관심 · ' : '') + info.text + (info.kind === '지표' && clock ? ' · ' + clock[1] : '');
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
        return (info.important ? '0' : watchlistSymbolMap()[String(event.symbol || '').toUpperCase()] ? '1' : info.kind === '지표' ? '2' : '3') + String(event.start || '');
      };
      var seen = {};
      events = events.filter(function (event) { var key = String(event.start).slice(0, 10) + '|' + String(event.symbol || event.title); if (seen[key]) return false; seen[key] = true; return true; });
      events = events.map(function (event, i) { return { e: event, k: keyOf(event), i: i }; })
        .sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i; })
        .map(function (row) { return row.e; });
      if (!events.length) return;
      var title = box.querySelector('.hwr-card-title > span');
      if (title) title.textContent = '캘린더 연동 · ' + startIso.slice(5).replace('-', '/') + ' ~ ' + endIso.slice(5).replace('-', '/') + ' · 주요 ' + Math.min(events.length, 5) + '건';
      var list = box.querySelector('.hwr-schedule-list') || box.querySelector('.hwr-empty');
      var html = '<ul class="hwr-schedule-list">' + events.slice(0, SCHEDULE_VISIBLE).map(calendarRow).join('') + '</ul>'
        ;
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
    return '<ul class="hwr-schedule-list">' + items.slice(0, SCHEDULE_VISIBLE).map(function (item) {
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
  function kstTime(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour12: false }) + ' KST';
  }
  function direction(value) { return value == null ? '' : Number(value) > 0 ? '▲' : Number(value) < 0 ? '▼' : '―'; }
  function panelHeading(title, sub) { return '<header class="wd-panel-head"><h3>' + title + '</h3><small>' + escapeHtml(sub || '') + '</small></header>'; }
  function bannerDate(value) {
    if (!value) return '미확인';
    var date = typeof value === 'string' ? new Date(value + 'T12:00:00+09:00') : value;
    if (!date || !isFinite(date.getTime())) return '미확인';
    return date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  }
  function nextTradingDay() {
    var open = global.MarketHours && typeof global.MarketHours.nextKrRegularOpen === 'function' && global.MarketHours.nextKrRegularOpen(new Date());
    return open ? bannerDate(open) : '캘린더에서 확인';
  }
  function countdownMarkup() {
    return '<div class="wd-countdown"><span class="wd-countdown-label">다음 정규장 개장까지</span><div class="wd-flip-clock" role="timer" aria-live="off" aria-label="개장 시간 확인 중">'
      + ['일', '시간', '분', '초'].map(function (unit, i) {
        return '<div class="wd-flip-unit"><div class="wd-flip-pair" data-wd-unit="' + i + '" aria-hidden="true"><span class="wd-flip-digit">-</span><span class="wd-flip-digit">-</span></div><small>' + unit + '</small></div>';
      }).join('') + '</div><small data-wd-open></small></div>';
  }
  var countdownTimer = null;
  function startCountdown(root) {
    clearTimeout(countdownTimer);
    function tick() {
      if (!document.body.contains(root)) return;
      if (!document.hidden && !root.hidden) {
        var now = Date.now();
        var open = global.MarketHours && typeof global.MarketHours.nextKrRegularOpen === 'function' && global.MarketHours.nextKrRegularOpen(new Date(now));
        var clock = root.querySelector('.wd-flip-clock');
        if (!clock) return;
        var total = open ? Math.max(0, Math.ceil((open.getTime() - now) / 1000)) : null;
        var values = total == null ? ['--', '--', '--', '--'] : [Math.floor(total / 86400), Math.floor(total / 3600) % 24, Math.floor(total / 60) % 60, total % 60];
        values.forEach(function (value, i) {
          var pair = clock.querySelector('[data-wd-unit="' + i + '"]');
          var digits = String(value).padStart(2, '0');
          if (pair.textContent === digits) return;
          pair.innerHTML = digits.split('').map(function (digit) { return '<span class="wd-flip-digit is-changing">' + digit + '</span>'; }).join('');
        });
        clock.setAttribute('aria-label', total == null ? '거래일 캘린더 확인 필요' : values[0] + '일 ' + values[1] + '시간 ' + values[2] + '분 ' + values[3] + '초 남음');
        var nextDay = root.querySelector('[data-wd-next-trading]');
        if (nextDay) nextDay.textContent = nextTradingDay();
        root.querySelector('[data-wd-open]').textContent = open ? open.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }) + ' 09:00 KST' : '거래일 캘린더 업데이트가 필요합니다.';
      }
      countdownTimer = setTimeout(tick, 1000 - Date.now() % 1000);
    }
    tick();
  }
  var INDEX_SPECS = [['KOSPI','KOSPI'],['KOSDAQ','KOSDAQ'],['NASDAQ_INDEX','나스닥 종합'],['SP500_INDEX','S&P 500'],['DOW_INDEX','다우존스'],['SOX','필라델피아 반도체']];
  function directionIcon(rate) {
    var path = rate > 0 ? 'm6 15 6-6 6 6M12 9v11' : rate < 0 ? 'm6 9 6 6 6-6M12 4v11' : 'M5 12h14';
    return '<svg class="wd-direction" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  }
  function indexCard(item) {
    var series = (item.series || []).filter(function (p) { return p.close != null && isFinite(Number(p.close)); });
    var date = series.length ? series[series.length - 1].date : '';
    return '<a class="wd-index ' + signClass(item.changeRate) + '" data-index-symbol="' + escapeHtml(item.symbol) + '" href="/pages/kospi-futures"><strong>' + escapeHtml(item.name) + '</strong><b>' + (item.end == null ? '미수신' : formatMarketValue(item)) + '</b><span class="wd-index-change">' + directionIcon(item.changeRate) + '<span>' + (item.changeRate == null ? '등락 미제공' : signed(item.changeRate)) + '</span><small>' + (item.changeAbs == null ? '포인트 미제공' : (item.changeAbs > 0 ? '+' : '') + Number(item.changeAbs).toFixed(2) + 'pt') + '</small></span>'
      + (series.length > 1 ? '<div class="wd-index-spark">' + sparkline(series, signClass(item.changeRate)) + '</div>' : '<div class="wd-index-spark wd-no-series">추이 미제공</div>')
      + '<small class="wd-index-date">' + escapeHtml(date ? dateLabel(series[0].date) + '–' + dateLabel(date) : '기준일 미제공') + ' · 주간</small></a>';
  }
  var extraIndicesMemo;
  function storedWeeklyIndex(row, week) {
    var rows = (row.chart || []).map(function (p) {
      return {date:String(p.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(0,10), close:p.close};
    }).filter(function (p) { return /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.close != null && isFinite(Number(p.close)) && p.date <= week.end; })
      .map(function (p) { return {date:p.date, close:Number(p.close)}; }).sort(function (a,b) { return a.date.localeCompare(b.date); });
    var series = rows.filter(function (p) { return p.date >= week.start; });
    if (series.length < 2) series = rows.slice(-5);
    if (!series.length) return {symbol:row.symbol,name:row.name};
    var prior = rows.filter(function (p) { return p.date < week.start; });
    var base = series[0].close;
    if (series[0].date >= week.start && prior.length) base = prior[prior.length-1].close;
    var end = series[series.length-1].close;
    return {symbol:row.symbol, name:row.name, end:end, base:base, changeAbs:end-base, changeRate:base ? (end/base-1)*100 : null, series:series};
  }
  function loadExtraIndices(root, data) {
    if (!data.week || !data.week.start || !data.week.end) return;
    // The weekly API shares the main indicators' stored futures rows. Only old
    // local reports or incomplete snapshots need this compatibility fallback.
    var missing = ['DOW_INDEX','SOX'].filter(function (symbol) {
      return !(data.indices || []).some(function (row) { return row && row.symbol === symbol && num(row.end) != null; });
    });
    if (!missing.length) return;
    if (!extraIndicesMemo || Date.now()-extraIndicesMemo.t > 300000) {
      extraIndicesMemo = {t:Date.now(),promise:fetchJsonTimeout('https://goodbyestar.cloud/futures?interval=day&days=30&symbols=DOW_INDEX,SOX',8000)};
      extraIndicesMemo.promise.catch(function () { extraIndicesMemo = null; });
    }
    extraIndicesMemo.promise.then(function (payload) {
      if (!document.body.contains(root)) return;
      (payload.data || []).forEach(function (row) {
        if (missing.indexOf(row.symbol) < 0) return;
        var card = root.querySelector('[data-index-symbol="' + row.symbol + '"]');
        if (card) {
          var summary = storedWeeklyIndex(row,data.week);
          if (num(summary.end) == null) return;
          summary.name = INDEX_SPECS.filter(function (spec) { return spec[0] === row.symbol; })[0][1];
          card.outerHTML = indexCard(summary);
        }
      });
    }).catch(function () { /* The explicit unavailable cards remain. */ });
  }

  // Own the two original sections while closed. Comments retain their weekday
  // slots; moving nodes preserves every card, image, link and event listener.
  var contentSources = [
    {key:'briefing', selector:'.home-briefing-section'},
    {key:'stories', selector:'.site-footer-learn'}
  ];
  function restoreContent() {
    contentSources.forEach(function (item) {
      if (!item.node || !item.slot || !item.slot.parentNode) return;
      if (item.key === 'stories') item.slot.parentNode.removeAttribute('data-weekend-learn-slot');
      item.slot.parentNode.insertBefore(item.node, item.slot);
      item.slot.remove(); item.slot = null;
      item.node.hidden = item.wasHidden;
      item.node.removeAttribute('data-weekend-content');
    });
  }
  function syncContent(root, closed) {
    root = root || document.getElementById('homeWeeklyReport');
    if (typeof closed !== 'boolean') {
      var dashboard = document.querySelector('.home-dashboard');
      closed = !!(dashboard && dashboard.classList.contains('is-market-closed'));
    }
    if (!root || !closed) { restoreContent(); return; }
    contentSources.forEach(function (item) {
      var mount = root.querySelector('[data-wd-' + item.key + ']');
      if (!mount) return;
      var node = item.node && item.node.isConnected ? item.node : document.querySelector(item.selector);
      if (!node) { mount.hidden = true; return; }
      item.node = node;
      if (node.parentNode !== mount) {
        // The widget manager may have moved the original since our first render.
        // Capture that real weekday slot rather than restoring to an obsolete one.
        if (item.slot) item.slot.remove();
        item.slot = document.createComment('weekend-' + item.key + '-slot');
        node.parentNode.insertBefore(item.slot, node);
        if (item.key === 'stories') node.parentNode.setAttribute('data-weekend-learn-slot', '');
        item.wasHidden = node.hidden;
        mount.appendChild(node);
      }
      node.hidden = false;
      node.setAttribute('data-weekend-content', item.key);
      mount.hidden = false;
    });
  }

  function render(root, payload) {
    var data = payload && payload.data ? payload.data : payload || {}, indices = data.indices || [];
    if (newsCarousel) { newsCarousel.destroy(); newsCarousel = null; }
    restoreContent();
    root.classList.add('weekend-dashboard');
    var indexCards = INDEX_SPECS.map(function (spec) {
      return indexCard(indices.filter(function (row) { return row && row.symbol === spec[0]; })[0] || {symbol: spec[0], name: spec[1]});
    }).join('');
    root.innerHTML = '<header class="wd-header"><div class="wd-header-copy"><span class="wd-badge">MARKET CLOSED</span><h2>시장도 잠시 쉬어가요</h2><p>한 주를 돌아보고, 다음 거래를 준비하세요.</p></div>' + countdownMarkup() + '<dl><div><dt>이번 주 마감</dt><dd>' + escapeHtml(bannerDate(data.week && data.week.end)) + '</dd></div><div><dt>다음 국내 거래일</dt><dd data-wd-next-trading>' + escapeHtml(nextTradingDay()) + '</dd></div></dl></header>'
      + '<section class="wd-index-section"><div class="wd-section-head"><h3>주요 지수</h3><a href="/pages/kospi-futures">전체 지수 보기 →</a></div><div class="wd-indices" tabindex="0" role="region" aria-label="주요 지수 · 직전 주 종가 대비 · 가로 스크롤">' + indexCards + '</div></section>'
      + '<div class="wd-grid"><section class="wd-panel" data-hwr-live>' + panelHeading('주말에도 움직이는 자산', '시장지표 가상자산') + '<p class="wd-empty">시세 확인 중</p></section>'
      + '<section class="wd-panel wd-calendar" data-hwr-schedule><div class="hwr-card-title">' + panelHeading('다음 주 주요 일정', '시각 KST · 실적은 현지 발표일 / 예정') + '<span></span></div>' + scheduleList(data.schedule) + '<a class="wd-more" href="/page/stock-calendar">전체 캘린더 →</a></section></div>'
      + '<section class="wd-news-section" data-hwr-themes>' + panelHeading('이번 주 주요뉴스', '뉴스로 살펴보는 테마와 주요 종목') + '<p class="wd-empty">뉴스 확인 중</p></section>'
      + '<div class="wd-reading" aria-label="마켓브리핑과 이야기 시리즈"><section class="wd-panel" data-wd-briefing hidden></section><section class="wd-panel" data-wd-stories hidden></section></div>';
    loadNextWeekCalendar(root, data.week && data.week.end);
    loadWeekendLive(root, data.week && data.week.end);
    loadWeekendThemes(root);
    startCountdown(root);
    loadExtraIndices(root, data);
    syncContent(root);
    setTimeout(function () { if (document.body.contains(root)) syncContent(root); }, 1500);
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
      restoreContent();
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
  global.HomeWeeklyReport = { init: init, syncContent: syncContent };
})(window);
