/**
 * 증시캘린더 - 독립 페이지 위젯 (2026-07-22)
 * 예전엔 js/skin-main.js의 openCalendarModal()이 중앙 모달로 띄우는 방식이었으나,
 * 사용자 요청으로 별도 Tistory Page(#stock-calendar 마운트)로 전환 - 기본은
 * 오늘 날짜의 일정만 보여주되, 월 달력에서 날짜를 선택하면 해당 날짜를 조회한다.
 *
 * 데이터 소스는 구글 캘린더 이벤트(제목+날짜/시간)와 DART 국내 실적공시, Finnhub
 * 미국 예정 실적일정(S&P 500만), 미국 주요 경제지표 발표일(data/us-econ-calendar.js, FRED·연준 공식 일정)이다.
 * 예측치/이전치 같은 경제지표 수치는 소스가 없어 표시하지 않는다.
 * 하단 미국 경제 데이터 결과는 기존 /futures의 최신 통계값을 별도로 표시한다.
 * 선택 날짜의 발표 당시 값이 아니라 현재 수정 반영값이며, 통계 기준기간을 표시한다.
 *
 * 이벤트 제목 규칙(사람이 구글 캘린더에 입력할 때 지켜야 함):
 *   "$종목명 텍스트 | 태그"
 *   - "$종목명"으로 시작하면 종목 이벤트(실적발표 등)로 인식 -> 종목명 뱃지로 표시
 *   - 국기 이모지(🇺🇸 등)로 시작하면 해외 지표로 인식 -> 아이콘에 국기 표시
 *   - "|" 뒤 텍스트는 "관심"/"주요" 같은 태그 뱃지로 분리 표시
 *
 * Tistory Page에 <div id="stock-calendar"></div>를 넣고 이 js 파일과
 * css/stock-calendar.css를 <script>/<link>로 불러오면 자동 렌더링된다.
 */
(function (global) {
  'use strict';

  // Google Calendar API 키는 리퍼러 제한(GCP 콘솔에서 이 블로그 도메인만 허용)이 걸려있어
  // 클라이언트에 노출돼도 다른 도메인에서 남용할 수 없다 - 사용자가 이미 조치함(2026-08-03
  // 확인). GAS 프록시로 옮기지 않고 기존처럼 직접 호출한다.
  var API_KEY = 'AIzaSyB9zgyudgEblbLoP-fW231dwf6VjOFK00o';
  var CAL_ID  = encodeURIComponent('405dbd75cc8e798f6dfb0003494d0fa64eecbc00ae2edeb1cdbf6deee0b07f76@group.calendar.google.com');
  var EARNINGS_API = 'https://goodbyestar.cloud/earnings-calendar';
  // 2026-10-04 사용자 요청("캘린더는 국내주식 + S&P 500 + 미국 경제지표 발표일정"): 발표일은 정적 데이터 파일이다.
  var ECON_DATA_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/us-econ-calendar.js?v=20261004-econ-v1';
  var ECON_LINKS = { FOMC: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' };
  var CONTAINER_SELECTOR = '#stock-calendar';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  // 미국 장후 실적의 KST 날짜가 달라졌으므로 이전 현지일 캐시와 섞지 않는다.
  var CALENDAR_STORAGE_KEY = 'tistory-ticker:calendar-events:v4';
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var monthFetchInflight = {};
  // Membership is owned by the server; never duplicate the constituent filter here.
  var sourceHealth = {};
  var monthCache = {};
  var US_COMPANY_NAME_MAP = {
    AAPL: '애플', ABBV: '애브비', ABT: '애보트', ACN: '액센츄어', ADBE: '어도비', AIG: 'AIG',
    AMD: 'AMD', AMGN: '암젠', AMT: '아메리칸타워', AMZN: '아마존', AVGO: '브로드컴', AXP: '아메리칸익스프레스',
    BA: '보잉', BAC: '뱅크오브아메리카', BK: 'BNY멜론', BKNG: '부킹홀딩스', BLK: '블랙록',
    BMY: '브리스톨마이어스스큅', 'BRK.B': '버크셔해서웨이', C: '씨티그룹', CAT: '캐터필러',
    CHTR: '차터커뮤니케이션스', CL: '콜게이트', CMCSA: '컴캐스트', COF: '캐피털원',
    COP: '코노코필립스', COST: '코스트코', CRM: '세일즈포스', CSCO: '시스코', CVS: 'CVS헬스',
    CVX: '셰브론', DE: '디어', DHR: '다나허', DIS: '디즈니', DOW: '다우', DUK: '듀크에너지',
    EMR: '에머슨일렉트릭', EXC: '엑셀론', F: '포드', FDX: '페덱스', GD: '제너럴다이내믹스',
    GE: 'GE에어로스페이스', GILD: '길리어드', GM: '제너럴모터스', GOOG: '알파벳', GOOGL: '알파벳',
    GS: '골드만삭스', HD: '홈디포', HON: '허니웰', IBM: 'IBM', INTC: '인텔', JNJ: '존슨앤드존슨',
    JPM: 'JP모건체이스', KHC: '크래프트하인즈', KO: '코카콜라', LIN: '린데', LLY: '일라이릴리',
    LMT: '록히드마틴', LOW: '로우스', MA: '마스터카드', MCD: '맥도날드', MDLZ: '몬델리즈',
    MDT: '메드트로닉', MET: '메트라이프', META: '메타', MMM: '3M', MO: '알트리아', MRK: '머크',
    MS: '모건스탠리', MSFT: '마이크로소프트', NEE: '넥스트에라에너지', NFLX: '넷플릭스', NKE: '나이키',
    NOW: '서비스나우', NVDA: '엔비디아', ORCL: '오라클', PEP: '펩시코', PFE: '화이자', PG: '프록터앤드갬블',
    PM: '필립모리스', PYPL: '페이팔', QCOM: '퀄컴', RTX: 'RTX', SBUX: '스타벅스',
    SCHW: '찰스슈왑', SO: '서던컴퍼니', SPG: '사이먼프로퍼티', T: 'AT&T',
    TGT: '타깃', TMO: '써모피셔', TMUS: 'T모바일', TSLA: '테슬라', TXN: '텍사스인스트루먼트',
    UNH: '유나이티드헬스', UNP: '유니언퍼시픽', UPS: 'UPS', USB: 'US뱅코프', V: '비자',
    VZ: '버라이즌', WBA: '월그린스부츠', WFC: '웰스파고', WDC: '웨스턴디지털', WMT: '월마트', XOM: '엑슨모빌',
    STX: '시게이트', HOOD: '로빈후드', ANEB: '애네벡스'
  };

  function isCalendarEvent(event) {
    return !!(event && event.start);
  }

  // DART 공시의 정식 회사명이 KRX_MAP(data/krx_map.js)의 약칭 키와 다른 경우의 별칭.
  // 예: DART corp_name "현대자동차" vs KRX_MAP 키 "현대차"(005380).
  var DART_NAME_ALIAS = { '현대자동차': '현대차' };
  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙,
  // js/foreign-flow.js·js/stock-search.js와 동일 패턴 - window.__stockIconFallback 공유).
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    return '<img src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }
  function krxCodeFor(stockName) {
    if (!stockName || !global.KRX_MAP) return null;
    return global.KRX_MAP[stockName] || global.KRX_MAP[DART_NAME_ALIAS[stockName]] || null;
  }

  function stockCodeFor(event, stockName) {
    // DART가 내려주는 stock_code가 가장 정확하다. 회사명은 DART 정식명칭과
    // KRX_MAP 약칭이 다를 수 있어 이름만으로 찾으면 국내 공시 아이콘이 빠진다.
    var symbol = String(event && event.symbol || '').trim();
    if (/^[0-9A-Za-z]{6}$/.test(symbol)) return symbol;
    return krxCodeFor(stockName) || usTickerFor(stockName);
  }

  function usTickerFor(stockName) {
    var value = String(stockName || '').trim();
    return /^[A-Za-z][A-Za-z0-9.-]*$/.test(value) ? value.toUpperCase() : null;
  }

  function isFinnhubLink(link) {
    return /(?:^|:\/\/)(?:www\.)?finnhub\.io(?:\/|$)/i.test(String(link || ''));
  }

  function fetchJson(url, timeoutMs) {
    return global.NineHttp.json(url, { timeoutMs: timeoutMs || 7000 });
  }

  function fetchEarnings(year, month) {
    // skin-main.js가 제공하는 월별 공유 로더(60초 단일 요청)로 중복 호출을 없앤다.
    // 홈에서 일정 카드·미국 실적·주간 리포트가 같은 월을 각자 fetch 하던 것을 합친다.
    // 전역이 없으면(로드 실패 등) 기존 직접 호출로 폴백한다.
    if (global.EarningsCalendarFeed) return global.EarningsCalendarFeed.month(year, month + 1).then(function (events) {
      sourceHealth.earnings = global.EarningsCalendarFeed.status ? global.EarningsCalendarFeed.status(year, month + 1) : {state:'unknown'};
      return (events || []).filter(isCalendarEvent);
    });
    return fetchJson(EARNINGS_API + '?year=' + encodeURIComponent(year) + '&month=' + encodeURIComponent(month + 1), 15000)
      .then(function (data) { sourceHealth.earnings = {state:'ok', health:data.calendarHealth}; return (Array.isArray(data) ? data : (data && data.data) || []).filter(isCalendarEvent); })
      .catch(function () { sourceHealth.earnings = {state:'error'}; return []; });
  }

  var econLoad = null;
  function loadEconCalendar() {
    if (global.US_ECON_CALENDAR) return Promise.resolve(global.US_ECON_CALENDAR);
    if (econLoad) return econLoad;
    econLoad = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = ECON_DATA_URL;
      script.async = true;
      script.onload = function () { sourceHealth.econ = {state:global.US_ECON_CALENDAR ? 'ok' : 'error'}; resolve(global.US_ECON_CALENDAR || null); };
      script.onerror = function () { sourceHealth.econ = {state:'error'}; econLoad = null; resolve(null); };
      document.head.appendChild(script);
    });
    return econLoad;
  }

  function fetchEconEvents(year, month) {
    var prefix = month == null ? String(year) : String(year) + '-' + String(month + 1).padStart(2, '0');
    return loadEconCalendar().then(function (data) {
      return ((data && data.events) || []).filter(function (item) {
        return String(item.start || '').slice(0, prefix.length) === prefix;
      }).map(function (item) {
        // 국기로 시작하는 제목은 parseEvent()가 해외 지표로 읽는다. 시각은 KST(start)로 보여주려고 us_date는 넣지 않는다.
        return {
          id: 'econ-' + item.code + '-' + item.us_date,
          title: '🇺🇸 ' + item.title + (item.importance >= 3 ? ' | 주요' : ''),
          start: item.start,
          link: ECON_LINKS[item.code] || 'https://fred.stlouisfed.org/releases/calendar',
          source: 'econ',
          market: 'us',
          code: item.code,
          importance: item.importance
        };
      });
    }).catch(function () { return []; });
  }

  function marketPriority(event) {
    var market = String(event && event.market || '').toLowerCase();
    if (market === 'domestic' || market === 'kr' || market === 'korea') return 0;
    if (market === 'us' || market === 'usa' || market === 'foreign') return 1;
    var source = String(event && (event.source || event.provider || '') || '');
    var title = String(event && event.title || '').trim();
    if (/dart|국내|한국|kospi|kosdaq/i.test(source + ' ' + title)) return 0;
    if (/finnhub|미국|nasdaq|nyse|s&p/i.test(source + ' ' + title)) return 1;
    if (/^\$/.test(title) || /^\p{Regional_Indicator}{2}/u.test(title)) return 1;
    return 0;
  }

  // 전체보기는 국내·미국을 날짜 순서대로 한 목록에 섞어 보여준다.
  // marketPriority는 기존 국내/미국 분류 규칙(구글·DART·Finnhub·미국 경제)을 그대로 사용한다.
  function calendarMarketKey(event) {
    return event && event.source === 'econ' ? 'econ' : marketPriority(event) === 1 ? 'us' : 'domestic';
  }

  function eventMatchesMarket(event, marketFilter) {
    return !marketFilter || marketFilter === 'all' || calendarMarketKey(event) === marketFilter;
  }

  function compareEvents(a, b) {
    var startA = String(a && a.start || '');
    var startB = String(b && b.start || '');
    var dayOrder = startA.slice(0, 10).localeCompare(startB.slice(0, 10));
    if (dayOrder) return dayOrder;
    var marketOrder = marketPriority(a) - marketPriority(b);
    if (marketOrder) return marketOrder;
    var timeOrder = startA.localeCompare(startB);
    if (timeOrder) return timeOrder;
    return String(a && a.title || '').localeCompare(String(b && b.title || ''));
  }

  function mergeEvents(primary, secondary) {
    var seen = {};
    return (primary || []).concat(secondary || []).filter(function (event) {
      var key = calendarEventKey(event);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(compareEvents);
  }

  function calendarEventKey(event) {
    var source = String(event && (event.source || event.provider) || '').toLowerCase();
    if (event && event.eventId) return event.eventId;
    if (event && event.id) return String(event.source || 'google') + ':' + String(event.id);
    if (source === 'dart' && event.receipt_no) return 'dart:' + String(event.receipt_no);
    if (source === 'finnhub' && (event.symbol || event.ticker)) {
      // KST 표시일은 장후 실적에서 다음 달이 될 수 있으므로, 원본 미국 날짜로 갱신 키를
      // 고정해 이전 현지일 캐시 행을 새 KST 행으로 교체한다.
      var usDate = String(event.us_date || event.start || '');
      return 'finnhub:' + String(event.symbol || event.ticker).toUpperCase() + ':' + usDate.slice(0, 7);
    }
    return String(event && event.start || '') + '|' + String(event && event.title || '').replace(/\s+/g, ' ').trim();
  }

  function loadStoredCalendarEvents() {
    try {
      var raw = global.localStorage.getItem(CALENDAR_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (event) { return event && event.start && isCalendarEvent(event); }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveStoredCalendarEvents(events) {
    try { global.localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events)); } catch (e) { /* 저장 공간이 없으면 현재 응답만 표시 */ }
  }

  function upsertStoredCalendarEvents(incoming) {
    var byKey = {};
    loadStoredCalendarEvents().forEach(function (event) { byKey[calendarEventKey(event)] = event; });
    (incoming || []).forEach(function (event) {
      if (event && event.start && isCalendarEvent(event)) byKey[calendarEventKey(event)] = event;
    });
    var stored = Object.keys(byKey).map(function (key) { return byKey[key]; });
    saveStoredCalendarEvents(stored);
    return stored;
  }

  function storedMonthEvents(year, month) {
    var prefix = String(year) + '-' + String(month + 1).padStart(2, '0');
    return loadStoredCalendarEvents().filter(function (event) {
      return String(event.start || '').slice(0, 7) === prefix && isCalendarEvent(event);
    });
  }

  function fetchGoogleEvents(year, month) {
    // 일정의 월·오늘 기준은 사용자의 기기 시간이나 미국 시간이 아니라 KST로 고정한다.
    // Google Calendar timeMax는 exclusive라 다음 달 1일 00:00 KST를 그대로 준다.
    var tMin = kstBoundaryIso(year, month == null ? 0 : month, 1);
    var tMax = month == null
      ? kstBoundaryIso(year + 1, 0, 1)
      : kstBoundaryIso(year, month + 1, 1);
    var url = 'https://www.googleapis.com/calendar/v3/calendars/' + CAL_ID
      + '/events?key=' + API_KEY
      + '&timeMin=' + encodeURIComponent(tMin)
      + '&timeMax=' + encodeURIComponent(tMax)
      + '&singleEvents=true&orderBy=startTime&maxResults=' + (month == null ? '2500' : '100');
    var seenPages = {};
    function page(token) {
      return fetchJson(url + (token ? '&pageToken=' + encodeURIComponent(token) : ''), 8000).then(function (data) {
        sourceHealth.google = {state:'ok'};
        var rows = (data.items || []).map(function (it) {
          var title = it.summary
            ? it.summary
            : (it.visibility === 'private' ? '🔒 비공개 일정' : '(제목 없음)');
          var original = it.start.dateTime || it.start.date;
          return { id: it.id, title: title, start: it.start.dateTime ? kstDateKey(original) + 'T' + kstParts(original).hour + ':' + kstParts(original).minute + ':00+09:00' : original, link: it.htmlLink, source: 'google' };
        });
        var next = data.nextPageToken;
        if (!next) return rows;
        if (seenPages[next]) throw new Error('calendar repeated page');
        seenPages[next] = true;
        return page(next).then(function (more) { return rows.concat(more); });
      });
    }
    return page('')
      .catch(function () { sourceHealth.google = {state:'error'}; return []; });

  }

  // 2026-09-12 사용자 지적("캘린더 표시가 계속 잘 안된다"): 두 공급자를 Promise.all로
  // 묶어 둘 다 끝나야 화면이 채워졌다. 라이브 실측으로 Google Calendar는 0.34초인데
  // /earnings-calendar가 12.7초(러너 기준 콜드 3.8초·웜 1.4초) 걸려, 그동안 달력 점도
  // 목록도 비어 있었다. onProgress를 넘기면 각 공급자가 도착하는 즉시 그때까지 모인
  // 월 일정을 넘겨준다. 반환 Promise(둘 다 끝난 최종 결과)는 기존 호출부(skin-main.js
  // 홈 일정 카드)를 위해 그대로 둔다.
  function fetchEvents(year, month, onProgress) {
    var key = String(year) + '-' + String(month == null ? 'year' : month);
    var hit = monthCache[key];
    if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.events);
    if (monthFetchInflight[key]) return monthFetchInflight[key];
    var sources = [fetchGoogleEvents(year, month), fetchEarnings(year, month), fetchEconEvents(year, month)];
    if (typeof onProgress === 'function' && month != null) {
      sources.forEach(function (source) {
        source.then(function (events) {
          upsertStoredCalendarEvents(events || []);
          onProgress(mergeEvents(storedMonthEvents(year, month), []));
        }, function () { /* 각 공급자는 이미 빈 배열로 실패를 흡수한다 */ });
      });
    }
    var request = Promise.all(sources)
      .then(function (results) {
        upsertStoredCalendarEvents((results[0] || []).concat(results[1] || [], results[2] || []));
        var events = mergeEvents(storedMonthEvents(year, month), []);
        monthCache[key] = {at:Date.now(), events:events};
        return events;
      });
    monthFetchInflight[key] = request;
    request.then(function () { delete monthFetchInflight[key]; }, function () { delete monthFetchInflight[key]; });
    return request;
  }

  function stripProviderLabel(rawTitle) {
    // 과거 localStorage/API 응답에 남아 있는 제공처 꼬리표도 화면에서는 숨긴다.
    // source/provider 필드는 시장 구분과 결과 병합에만 사용하고, 제공처 안내는 약관에서 한다.
    return String(rawTitle || '')
      .replace(/\s*\|\s*(?:자동\(DART\)|미국\(Finnhub\))\s*$/i, '')
      .replace(/\s+(?:자동\(DART\)|미국\(Finnhub\))\s*$/i, '')
      .trim();
  }

  function parseEvent(rawTitle) {
    var segs = stripProviderLabel(rawTitle).split('|').map(function (s) { return s.trim(); });
    var head = segs[0] || '';
    var tag  = segs[1] || '';
    var stockMatch = head.match(/^\$(\S+)\s*(.*)$/);
    var flagMatch  = !stockMatch && head.match(/^(\p{Regional_Indicator}{2})\s*(.*)$/u);
    return {
      isStock: !!stockMatch,
      isForeign: !!flagMatch,
      stockName: stockMatch ? stockMatch[1] : null,
      text: stockMatch ? stockMatch[2] : (flagMatch ? flagMatch[2] : head),
      flag: flagMatch ? flagMatch[1] : null,
      tag: tag
    };
  }

  // 2026-08-30 중복 점검: 저장소의 escapeHtml 26벌 중 이 구현만 작은따옴표를 빠뜨리고
  // 있었다. 지금 사용처는 전부 큰따옴표 속성이라 실제 구멍은 아니지만, 나중에 누가
  // 작은따옴표 속성으로 바꾸면 그때 뚫린다. 나머지 25벌과 동작을 맞춘다.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function kstBoundaryIso(year, month, day) {
    return new Date(Date.UTC(year, month, day) - KST_OFFSET_MS).toISOString();
  }

  function kstParts(value) {
    var date = value instanceof Date ? value : new Date(value);
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
    }).formatToParts(date).reduce(function (result, part) {
      result[part.type] = part.value;
      return result;
    }, {});
    if (parts.hour === '24') parts.hour = '00';
    return parts;
  }

  function kstDateKey(value) {
    var parts = kstParts(value);
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  function usDateLabel(ev) {
    var datePart = String(ev && ev.us_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return '';
    var session = String(ev.us_session || '').trim();
    return '미국 ' + Number(datePart.slice(5, 7)) + '/' + Number(datePart.slice(8, 10))
      + (session ? ' · ' + session : '');
  }

  function timeOf(ev) {
    if (ev.scheduledAt) { var actual = kstParts(ev.scheduledAt); return actual.hour + ':' + actual.minute + ' KST'; }
    var usLabel = usDateLabel(ev);
    if (usLabel) return usLabel;
    if (ev.conferenceCallAt) { var call = kstParts(ev.conferenceCallAt); return '콜 ' + call.hour + ':' + call.minute + ' KST'; }
    if (ev.start.indexOf('T') === -1) return ev.eventType === 'earnings' ? '시각 미확인' : '종일';
    var parts = kstParts(ev.start);
    return parts.hour + ':' + parts.minute;
  }

  /* "M/D" 형식 - 주차 리스트는 여러 날짜가 섞여 있어 행마다 날짜를 밝혀야 함(사용자 요청) */
  function dateLabelOf(ev) {
    var datePart = ev.start.slice(0, 10); /* "YYYY-MM-DD" */
    var m = parseInt(datePart.slice(5, 7), 10);
    var d = parseInt(datePart.slice(8, 10), 10);
    return m + '/' + d;
  }

  // Finnhub 실적 이벤트는 회사명을 별도 필드로 내려준다. 예전 localStorage에 저장된
  // 이벤트는 그 필드가 없을 수 있어, 당시 제목에 이미 들어간 "· 회사명"도 한 번 복구한다.
  function usCompanyNameFor(ev, meta) {
    var symbol = String(meta && meta.stockName || ev && (ev.symbol || ev.ticker) || '').toUpperCase().replace('-', '.');
    var explicit = String(ev && (ev.company || ev.companyName || ev.name || ev.securityName || ev.displayName) || '').trim();
    if (US_COMPANY_NAME_MAP[symbol]) return US_COMPANY_NAME_MAP[symbol];
    if (explicit && explicit.toUpperCase() !== String(meta.stockName || '').toUpperCase()) return explicit;
    var text = String(meta && meta.text || '');
    var marker = text.lastIndexOf(' · ');
    if (marker !== -1) {
      var fromTitle = text.slice(marker + 3).trim();
      if (fromTitle && !/^(장전|장후|실적발표|실적발표 완료)/.test(fromTitle)) return fromTitle;
    }
    return '';
  }

  function isUsStockEvent(ev, meta) {
    var market = String(ev && ev.market || '').toLowerCase();
    var source = String(ev && (ev.source || ev.provider) || '').toLowerCase();
    if (market === 'us' || market === 'usa' || market === 'foreign' || source === 'finnhub') return true;
    return !!(meta && meta.isStock && !krxCodeFor(meta.stockName) && usTickerFor(meta.stockName));
  }

  function renderEventRow(ev) {
    var meta = parseEvent(ev.title);
    var iconClass, iconHtml;
    var code = meta.isStock ? stockCodeFor(ev, meta.stockName) : null;
    if (meta.isStock) {
      iconClass = 'sc-ev-icon stock';
      // 2글자 약칭을 바탕색으로 항상 먼저 깔고, KRX_MAP(종목명->코드)에서 코드를 찾으면
      // 실제 로고 이미지를 그 위에 겹쳐 그린다 - 이름이 KRX_MAP과 정확히 안 맞거나
      // (예: 표기 차이) 로고 파일이 없는 종목은 svg->png 3단 폴백 끝에 이미지가 숨겨져도
      // 밑에 깔린 약칭이 그대로 보여 빈 원으로 남지 않는다.
      iconHtml = escapeHtml((meta.stockName || '').slice(0, 2)) + stockIconHtml(code);
    } else if (meta.isForeign) {
      iconClass = 'sc-ev-icon flag';
      iconHtml  = meta.flag;
    } else {
      iconClass = 'sc-ev-icon default';
      iconHtml  = '📅';
    }
    var eventText = meta.text;
    if (meta.isStock && String(ev.source || '').toLowerCase() === 'dart' && ev.status === 'reported'
      && eventText.indexOf('완료') === -1) {
      eventText = '실적공시 완료 · ' + eventText;
    }
    if (ev.result && eventText.indexOf(String(ev.result)) === -1) {
      eventText += (eventText ? ' · ' : '') + String(ev.result);
    }
    var companyName = meta.isStock && (String(ev.market || '').toLowerCase() === 'us'
      || String(ev.source || '').toLowerCase() === 'finnhub') ? usCompanyNameFor(ev, meta) : '';
    var stockLabel = companyName
      ? escapeHtml(companyName) + ' <span class="sc-ev-symbol">(' + escapeHtml(meta.stockName) + ')</span>'
      : escapeHtml(meta.stockName);
    var stockSearchCode = code ? (isUsStockEvent(ev, meta) ? 'US:' + code : code) : '';
    var stockSearchName = companyName || meta.stockName || '';
    var stockLabelHtml = meta.isStock && stockSearchCode
      ? '<button type="button" class="sc-ev-stock-link" data-stock-search-code="'
        + escapeHtml(stockSearchCode) + '" data-stock-search-name="' + escapeHtml(stockSearchName)
        + '" data-stock-search-market="' + (isUsStockEvent(ev, meta) ? 'us' : 'domestic') + '">'
        + stockLabel + '</button>'
      : stockLabel;
    var titleHtml = meta.isStock
      ? '<strong class="sc-ev-ticker">' + stockLabelHtml + '</strong> ' + escapeHtml(eventText)
      : escapeHtml(meta.text);
    var tagHtml = meta.tag ? '<span class="sc-ev-tag">' + escapeHtml(meta.tag) + '</span>' : '';
    var blockedExternalLink = isFinnhubLink(ev.link);
    var rowStart = '<div class="sc-ev-item" data-event-id="' + escapeHtml(calendarEventKey(ev)) + '" tabindex="-1">';
    var rowEnd = '</div>';
    var status = {scheduled:'예정',reported:'발표 완료',changed:'변경',cancelled:'취소',announced:'공지 접수'}[ev.status] || '';
    var proof = renderProvenance(ev, blockedExternalLink);
    return rowStart
      + '<span class="sc-ev-date">' + dateLabelOf(ev) + '</span>'
      + '<span class="' + iconClass + '">' + iconHtml + '</span>'
      + '<span class="sc-ev-body"><span class="sc-ev-title">' + titleHtml + tagHtml + '</span>'
      + (status ? '<span class="sc-event-status">' + escapeHtml(status) + (ev.verification === 'conflict' ? ' · 출처 간 일정 충돌, 확인 필요' : '') + '</span>' : '')
      + proof + '</span>'
      + '<span class="sc-ev-time">' + timeOf(ev) + '</span>'
      + rowEnd;
  }

  function renderMarketSwitch(state) {
    return '<nav class="sc-market-switch" role="group" aria-label="캘린더 시장 선택">'
      + [['all', '전체보기'], ['domestic', '국내'], ['us', '미국'], ['econ', '경제']].map(function (tab) {
        var active = state.marketFilter === tab[0];
        return '<button type="button" class="sc-market-btn' + (active ? ' is-active' : '')
          + '" data-calendar-market="' + tab[0] + '" aria-pressed="' + active + '">' + tab[1] + '</button>';
      }).join('') + '</nav>';
  }

  function matchesQuery(event, query) {
    var meta = parseEvent(event.title);
    var symbol = String(event.symbol || event.stock_code || meta.stockName || '').toUpperCase().replace('-', '.');
    var name = US_COMPANY_NAME_MAP[symbol] || '';
    var krx = krxCodeFor(event.company || event.corp_name || meta.stockName) || '';
    var haystack = [event.title, event.company, event.companyName, event.corp_name, event.report_name,
      event.result, event.symbol, event.stock_code, event.ticker, event.fiscalPeriod, event.code, name, krx]
      .map(function (x) { return String(x || '').normalize('NFKC').toLowerCase(); }).join(' ');
    return String(query || '').normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean)
      .every(function (term) { return haystack.indexOf(term) >= 0; });
  }

  function foldRows(rows, render, limit, extraClass) {
    return rows.slice(0, limit).map(render).join('') + (rows.length > limit
      ? '<details class="sc-more"><summary>나머지 ' + (rows.length - limit) + '건 펼치기</summary>'
        + (extraClass ? '<div class="' + escapeHtml(extraClass) + '">' : '')
        + rows.slice(limit).map(render).join('') + (extraClass ? '</div>' : '') + '</details>' : '');
  }

  function safeLink(url) { return /^https?:\/\//i.test(String(url || '')) ? escapeHtml(url) : ''; }
  function renderProvenance(ev, blocked) {
    var source = String(ev.source || '');
    var parts = [];
    if (ev.dateBasis === 'disclosure_receipt') parts.push('공시 접수일 기준');
    if (ev.releaseTimeNote) parts.push(escapeHtml(ev.releaseTimeNote));
    if (ev.dateConversion === 'session_estimate' || ev.datePrecision === 'session') parts.push('한국 날짜는 미국 세션 기준 · 정확한 발표 시각 미확인');
    if (ev.verifiedAt) {
      var verified = Date.parse(ev.verifiedAt);
      var exactStamp = String(ev.verifiedAt).indexOf('T') >= 0;
      parts.push('확인 ' + escapeHtml(Number.isFinite(verified) && exactStamp
        ? new Date(verified).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) + ' KST' : String(ev.verifiedAt)));
      if (Number.isFinite(verified) && Date.now() - verified > 86400000) parts.push('마지막 확인 후 24시간 경과');
    }
    var url = safeLink(ev.sourceUrl || ev.link);
    if (url && !blocked) parts.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source || '일정') + ' 원문</a>');
    else if (source) parts.push(escapeHtml(source));
    if (safeLink(ev.resultUrl) && ev.resultUrl !== ev.sourceUrl) parts.push('<a href="' + safeLink(ev.resultUrl) + '" target="_blank" rel="noopener noreferrer">발표 결과</a>');
    if (ev.sources && ev.sources.length > 1) parts.push(ev.sources.map(function (s) {
      var label = escapeHtml(String(s.source || '') + ' ' + String(s.eventDate || ''));
      return safeLink(s.url) && !isFinnhubLink(s.url) ? '<a href="' + safeLink(s.url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
    }).join(' / '));
    if (ev.conferenceCallAt && ev.market === 'us') {
      var callAt = kstParts(ev.conferenceCallAt);
      parts.push('컨퍼런스콜 ' + kstDateKey(ev.conferenceCallAt) + ' ' + callAt.hour + ':' + callAt.minute + ' KST');
    }
    return parts.length ? '<small class="sc-event-proof">' + parts.join(' · ') + '</small>' : '';
  }

  function renderSourceHealth(state) {
    var e = sourceHealth.earnings || {state: 'pending'};
    var h = e.health || {};
    var sources = h.sources || {};
    var labels = {ok:'정상', partial:'일부 수집 · 다음 회차 계속', error:'수집 실패 · 마지막 확인 자료 유지', unavailable:'미연결', pending:'갱신 대기', unknown:'확인 상태 미제공'};
    var sourceNames = {dart:'DART 실적 공시', finnhub:'미국 실적', 'corporate-ir':'국내 공식 IR', 'corporate-hynix':'SK하이닉스 공식 IR', 'corporate-samsung':'삼성전자 공식 IR', 'dart-ir':'국내 IR 공시', 'official-STX':'시게이트 공식 IR', 'official-HOOD':'로빈후드 공식 IR'};
    var parts = Object.keys(sources).map(function (key) { return escapeHtml(sourceNames[key] || key) + ': ' + escapeHtml(labels[sources[key].state] || sources[key].state); });
    ['google','econ'].forEach(function (key) { if (sourceHealth[key]) parts.push(key + ': ' + (labels[sourceHealth[key].state] || '확인 필요')); });
    if (e.state === 'error') parts.unshift('실적 API 조회 실패 · 저장된 일정 유지');
    if (h.pending) parts.unshift('서버 일정 갱신 대기');
    if (!parts.length) parts.push('공급원 확인 대기 · 일정 0건은 전체 기업의 발표 없음과 다릅니다.');
    if (h.coverage) parts.push('S&P 500 구성 ' + h.coverage.universe + '종목 중 이달 일정 확인 ' + h.coverage.symbolsWithEvents + '종목 (미확인 ≠ 발표 없음)');
    if (h.access) parts.push('IRGO는 재사용 제한으로 공식 IR 대체 · KIND 공개 피드 확인 불가 시 DART의 거래소 공시 사본 활용');
    return '<details class="sc-source-health"><summary>일정 출처·수집 상태</summary><p>' + parts.join('<br>') + '</p></details>';
  }


  function renderCompletedDisclosures(state, loading) {
    var monthKey = String(state.viewYear) + '-' + String(state.viewMonth + 1).padStart(2, '0');
    var terms = String(state.disclosureQuery || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    var seen = new Set();
    var completed = (state.events || []).filter(function (event) {
      if (!event || (!terms.length && event.status !== 'reported') || String(event.start || '').slice(0, 7) !== monthKey
        || !eventMatchesMarket(event, state.marketFilter)) return false;
      var key = calendarEventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesQuery(event, state.disclosureQuery);
    }).sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); });
    function cardHtml(event) {
      var market = calendarMarketKey(event);
      return '<article class="sc-completed-card"><div class="sc-completed-card-head">'
        + '<span class="sc-completed-badge sc-completed-badge--' + market + '">'
        + (market === 'us' ? '미국' : market === 'econ' ? '경제' : '국내') + ' · '
        + escapeHtml({reported:'발표 완료',scheduled:'예정',changed:'변경',cancelled:'취소',announced:'공지 접수'}[event.status] || '일정') + '</span>'
        + '<time datetime="' + escapeHtml(String(event.start).slice(0, 10)) + '">'
        + escapeHtml(String(event.start).slice(0, 10)) + '</time></div>'
        + (terms.length ? '<button type="button" class="sc-result-jump" data-calendar-result="' + escapeHtml(calendarEventKey(event)) + '">' + escapeHtml(event.start.slice(0,10)) + ' 일정 보기</button>' : '')
        + renderEventRow(event) + '</article>';
    }
    // 국내 전체 목록 + 그 아래 미국 목록을 연달아 쌓던 구조를 제거한다.
    // 국가 선택과 무관하게 하나의 날짜 내림차순 그리드만 사용한다.
    var body = completed.length
      ? '<div class="sc-completed-grid">' + foldRows(completed, cardHtml, 8) + '</div>'
      : '<div class="sc-empty">' + (loading ? '공시를 불러오는 중이야.'
        : terms.length ? '검색 결과가 없습니다. 종목명·코드·티커를 확인하거나 다른 달을 선택하세요.'
        : '선택한 시장에 표시할 완료 공시가 없어.') + '</div>';
    var marketTitle = state.marketFilter === 'us' ? '미국' : state.marketFilter === 'domestic' ? '국내' : '국내·미국';
    return '<section class="sc-completed" aria-label="공시 완료"><div class="sc-completed-head">'
      + '<div><h2>' + (terms.length ? '통합 검색 결과' : '공시 완료') + ' <span>' + completed.length + '건</span></h2>'
      + '<p>' + state.viewYear + '년 ' + (state.viewMonth + 1)
      + '월 · ' + marketTitle + (terms.length ? ' 전체 일정 검색' : ' 발표 완료 이력') + '</p></div>'
      + renderMarketSwitch(state) + '</div>'
      + body + '</section>';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<form class="sc-disclosure-search" role="search"><label class="sc-search"><span>일정·실적 통합 검색</span>'
      + '<input type="search" data-disclosure-search placeholder="종목명 · 종목코드 · 티커 · 일정 제목" autocomplete="off" aria-describedby="scDisclosureScope"></label>'
      + '<button type="submit" class="sc-search-submit">검색</button><small id="scDisclosureScope"></small></form><div data-calendar-content></div>';
    var calendarContent = container.querySelector('[data-calendar-content]');
    function dateKey(date) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
        + '-' + String(date.getDate()).padStart(2, '0');
    }

    function dateTitle(key) {
      var parts = String(key || '').split('-');
      return parts.length === 3
        ? parts[0] + '년 ' + Number(parts[1]) + '월 ' + Number(parts[2]) + '일'
        : '선택한 날짜';
    }

    function hasEventOn(events, key, marketFilter) {
      return (events || []).some(function (event) {
        return eventMatchesMarket(event, marketFilter)
          && String(event && event.start || '').slice(0, 10) === key;
      });
    }

    function renderMonthCalendar(state) {
      var first = new Date(state.viewYear, state.viewMonth, 1);
      var daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
      var todayKey = kstDateKey(new Date());
      var cells = [];
      var day;
      for (day = 0; day < first.getDay(); day += 1) {
        cells.push('<span class="sc-day sc-day-empty" aria-hidden="true"></span>');
      }
      for (day = 1; day <= daysInMonth; day += 1) {
        var current = new Date(state.viewYear, state.viewMonth, day);
        var key = dateKey(current);
        var classes = ['sc-day', 'sc-day-clickable'];
        if (key === todayKey) classes.push('sc-today');
        if (key === state.selectedKey) classes.push('sc-selected');
        cells.push('<button type="button" class="' + classes.join(' ') + '" data-calendar-date="' + key + '" aria-label="'
          + (state.viewMonth + 1) + '월 ' + day + '일' + (hasEventOn(state.events, key, state.marketFilter) ? ', 일정 있음' : '') + '" aria-pressed="'
          + (key === state.selectedKey ? 'true' : 'false') + '">' + day
          + (hasEventOn(state.events, key, state.marketFilter) ? '<span class="sc-dot" aria-hidden="true"></span>' : '')
          + '</button>');
      }
      while (cells.length % 7) cells.push('<span class="sc-day sc-day-empty" aria-hidden="true"></span>');
      var monthTitle = state.viewYear + '년 ' + (state.viewMonth + 1) + '월';
      return '<div class="sc-cal-header">'
        + '<button type="button" class="sc-nav" data-calendar-action="previous" aria-label="이전 달">‹</button>'
        + '<strong class="sc-cal-title">' + monthTitle + '</strong>'
        + '<button type="button" class="sc-nav" data-calendar-action="next" aria-label="다음 달">›</button>'
        + '</div>'
        + '<div class="sc-dow" aria-hidden="true"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>'
        + '<div class="sc-grid">' + cells.join('') + '</div>';
    }

    function renderSchedule(state, loading) {
      state.loading = !!loading;
      container.querySelector('#scDisclosureScope').textContent = state.viewYear + '년 ' + (state.viewMonth + 1) + '월 전체 일정에서 검색합니다. 국내·미국 실적, 경제지표, Google 일정 포함.';
      var selectedEvents = (state.events || []).filter(function (event) {
        return eventMatchesMarket(event, state.marketFilter)
          && String(event && event.start || '').slice(0, 10) === state.selectedKey;
      }).sort(compareEvents);
      var isToday = state.selectedKey === kstDateKey(new Date());
      var listHtml = loading
        ? '<div class="sc-loading">불러오는 중...</div>'
        : selectedEvents.length
          ? '<div class="sc-today-rows">' + foldRows(selectedEvents, renderEventRow, 8, 'sc-today-extra') + '</div>'
          : '<div class="sc-empty">선택한 날짜에 예정된 일정이 없습니다.</div>';

      var searching = !!String(state.disclosureQuery || '').trim();
      calendarContent.innerHTML =
        (searching ? renderCompletedDisclosures(state, loading) : '') + '<div class="sc-layout">'
        + '<aside class="sc-cal-col" aria-label="일정 달력">'
        + renderMonthCalendar(state)
        + '</aside>'
        + '<section class="sc-list-col" aria-live="polite">'
        + '<div class="sc-today-head"><div><strong>' + (isToday ? '오늘의 일정' : '선택한 날짜 일정') + '</strong><span>' + dateTitle(state.selectedKey) + '</span></div>'
        + (isToday ? '<small>달력에서 날짜를 선택할 수 있습니다.</small>' : '<button type="button" class="sc-cal-today" data-calendar-action="today">오늘로 이동</button>')
        + '</div>'
        + listHtml
        + '</section>'
        + '</div>'
        + (searching ? '' : renderCompletedDisclosures(state, loading)) + renderSourceHealth(state);
      if (state.highlightEvent) {
        var row = Array.from(calendarContent.querySelectorAll('.sc-list-col [data-event-id]')).find(function (el) { return el.getAttribute('data-event-id') === state.highlightEvent; });
        if (row) { var details = row.closest('details'); if (details) details.open = true; row.classList.add('is-highlighted'); row.focus(); }
      }
    }

    var now = kstParts(new Date());
    var state = {
      viewYear: Number(now.year),
      viewMonth: Number(now.month) - 1,
      selectedKey: now.year + '-' + now.month + '-' + now.day,
      events: [],
      disclosureQuery: '',
      marketFilter: 'all', // 기본값: 전체보기(탭 선택은 날짜/월 이동에도 유지)
      loading: false
    };
    var requestId = 0;
    var input = container.querySelector('[data-disclosure-search]');
    var composing = false;
    function applySearch() { state.disclosureQuery = input.value.trim(); state.highlightEvent = null; renderSchedule(state, state.loading); }
    input.addEventListener('compositionstart', function () { composing = true; });
    input.addEventListener('compositionend', function () { composing = false; applySearch(); });
    input.addEventListener('input', function (event) { if (!composing && !event.isComposing) applySearch(); });
    input.addEventListener('search', applySearch);
    container.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); if (!composing) applySearch(); });

    function loadMonth(year, month, selected) {
      var target = new Date(year, month, 1);
      state.viewYear = target.getFullYear();
      state.viewMonth = target.getMonth();
      state.selectedKey = selected || dateKey(target);
      // 2026-09-12: 이전에 받아 localStorage에 저장해 둔 이 달 일정을 먼저 그린다.
      // 예전엔 []로 비우고 "불러오는 중"만 띄워, 새로 받기 전까지 이미 아는 일정도 안 보였다.
      // 저장분이 전혀 없을 때만 로딩 문구를 쓴다.
      state.events = storedMonthEvents(state.viewYear, state.viewMonth);
      var currentRequest = ++requestId;
      renderSchedule(state, !state.events.length);
      StockCalendar.fetchEvents(state.viewYear, state.viewMonth, function (partial) {
        if (currentRequest !== requestId) return;
        state.events = partial || [];
        renderSchedule(state, false);
      })
        .then(function (events) {
          if (currentRequest !== requestId) return;
          state.events = events || [];
          renderSchedule(state, false);
        })
        .catch(function () {
          if (currentRequest !== requestId) return;
          renderSchedule(state, false);
          var empty = container.querySelector('.sc-empty');
          if (empty) empty.textContent = '일정을 불러오지 못했습니다.';
        });
    }

    function findActionTarget(target) {
      while (target && target !== container) {
        if (target.getAttribute && (target.getAttribute('data-calendar-action') || target.getAttribute('data-calendar-date')
          || target.getAttribute('data-calendar-market') || target.getAttribute('data-calendar-result') || target.getAttribute('data-stock-search-code'))) return target;
        target = target.parentNode;
      }
      return null;
    }

    container.addEventListener('click', function (event) {
      var target = findActionTarget(event.target);
      if (!target) return;
      var resultKey = target.getAttribute('data-calendar-result');
      if (resultKey) {
        var result = state.events.find(function (ev) { return calendarEventKey(ev) === resultKey; });
        if (result) { state.selectedKey = result.start.slice(0,10); state.highlightEvent = resultKey; renderSchedule(state, false); }
        return;
      }
      var stockSearchCode = target.getAttribute('data-stock-search-code');
      if (stockSearchCode) {
        event.preventDefault();
        event.stopPropagation();
        var stockSearchName = target.getAttribute('data-stock-search-name') || '';
        var stockSearchMarket = target.getAttribute('data-stock-search-market') || '';
        var stockSearchUrl = '/page/stock-search?code=' + encodeURIComponent(stockSearchCode)
          + '&name=' + encodeURIComponent(stockSearchName);
        if (stockSearchMarket === 'us') stockSearchUrl += '&market=us';
        global.location.href = stockSearchUrl;
        return;
      }
      var market = target.getAttribute('data-calendar-market');
      if (market === 'all' || market === 'domestic' || market === 'us' || market === 'econ') {
        state.marketFilter = market;
        renderSchedule(state, state.loading);
        return;
      }
      var action = target.getAttribute('data-calendar-action');
      if (action === 'today') {
        var today = kstParts(new Date());
        loadMonth(Number(today.year), Number(today.month) - 1, today.year + '-' + today.month + '-' + today.day);
        return;
      }
      if (action === 'previous' || action === 'next') {
        var offset = action === 'previous' ? -1 : 1;
        var next = new Date(state.viewYear, state.viewMonth + offset, 1);
        loadMonth(next.getFullYear(), next.getMonth(), dateKey(next));
        return;
      }
      var selected = target.getAttribute('data-calendar-date');
      if (selected) {
        state.selectedKey = selected;
        renderSchedule(state, false);
      }
    });

    loadMonth(state.viewYear, state.viewMonth, state.selectedKey);
    // 새로 접수된 일정이 화면에 반영되도록 주기적으로 갱신한다.
    // 페이지를 떠나면 브라우저가 타이머를 정리하므로 별도 서버 작업은 필요 없다.
    setInterval(function () {
      if (!document.hidden) {
        loadMonth(state.viewYear, state.viewMonth, state.selectedKey);
      }
    }, 15 * 60 * 1000);
  }

  // 다른 화면(주말 리포트 "다음 주 핵심 스케줄")이 이 캘린더와 같은 표기로 한 줄 요약을 만들 때 쓴다.
  // kind: 한국 | 미국 | 지표 | 일정, text: 종목명(미국은 한글 회사명) + 내용, important: 주요 지표 여부
  function describeEvent(ev) {
    var meta = parseEvent(ev && ev.title);
    var source = String(ev && (ev.source || ev.provider) || '').toLowerCase();
    if (source === 'econ' || meta.isForeign) {
      return { kind: '지표', text: meta.text, important: Number(ev && ev.importance) >= 3 || meta.tag === '주요' };
    }
    if (meta.isStock) {
      var us = isUsStockEvent(ev, meta);
      var name = us ? (usCompanyNameFor(ev, meta) || meta.stockName) : meta.stockName;
      var text = String(meta.text || '');
      if (us) {
        var marker = text.lastIndexOf(' · ');
        if (marker !== -1 && !/^(EPS|매출)/.test(text.slice(marker + 3))) text = text.slice(0, marker);
      }
      return { kind: us ? '미국' : '한국', text: name + ' ' + text, important: false };
    }
    return { kind: '일정', text: meta.text, important: meta.tag === '주요' };
  }

  var StockCalendar = { matchesQuery: matchesQuery, eventKey: calendarEventKey, fetchEvents: fetchEvents, describe: describeEvent, init: init };
  global.StockCalendar = StockCalendar;
  document.addEventListener('DOMContentLoaded', init);
})(window);
