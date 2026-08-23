/**
 * 증시캘린더 - 독립 페이지 위젯 (2026-07-22)
 * 예전엔 js/skin-main.js의 openCalendarModal()이 중앙 모달로 띄우는 방식이었으나,
 * 사용자 요청으로 별도 Tistory Page(#stock-calendar 마운트)로 전환 - 월간 목록 대신
 * 오늘 날짜의 일정만 간결하게 보여준다.
 *
 * 데이터 소스는 구글 캘린더 이벤트(제목+날짜/시간)와 DART 국내 실적공시, Finnhub
 * 미국 예정 실적일정이다. 예측치/이전치 같은 경제지표 수치는 소스가 없어 표시하지 않는다.
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
  var CONTAINER_SELECTOR = '#stock-calendar';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var CALENDAR_STORAGE_KEY = 'tistory-ticker:calendar-events:v2';

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
    if (/^\d{6}$/.test(symbol)) return symbol;
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
    var controller = 'AbortController' in global ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 7000) : null;
    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('캘린더 API 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) { if (timer) clearTimeout(timer); return data; })
      .catch(function (error) { if (timer) clearTimeout(timer); throw error; });
  }

  function fetchEarnings(year, month) {
    return fetchJson(EARNINGS_API + '?year=' + encodeURIComponent(year) + '&month=' + encodeURIComponent(month + 1), 15000)
      .then(function (data) { return Array.isArray(data) ? data : (data && data.data) || []; })
      .catch(function () { return []; });
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
      var key = String(event.start || '') + '|' + String(event.title || '').replace(/\s+/g, ' ').trim();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(compareEvents);
  }

  function calendarEventKey(event) {
    var source = String(event && (event.source || event.provider) || '').toLowerCase();
    if (event && event.id) return 'google:' + String(event.id);
    if (source === 'dart' && event.receipt_no) return 'dart:' + String(event.receipt_no);
    if (source === 'finnhub' && (event.symbol || event.ticker)) {
      return 'finnhub:' + String(event.symbol || event.ticker).toUpperCase() + ':' + String(event.start || '').slice(0, 7);
    }
    return String(event && event.start || '') + '|' + String(event && event.title || '').replace(/\s+/g, ' ').trim();
  }

  function loadStoredCalendarEvents() {
    try {
      var raw = global.localStorage.getItem(CALENDAR_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (event) { return event && event.start; }) : [];
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
      if (event && event.start) byKey[calendarEventKey(event)] = event;
    });
    var stored = Object.keys(byKey).map(function (key) { return byKey[key]; });
    saveStoredCalendarEvents(stored);
    return stored;
  }

  function storedMonthEvents(year, month) {
    var prefix = String(year) + '-' + String(month + 1).padStart(2, '0');
    return loadStoredCalendarEvents().filter(function (event) { return String(event.start || '').slice(0, 7) === prefix; });
  }

  function fetchGoogleEvents(year, month) {
    var tMin = new Date(year, month == null ? 0 : month, 1).toISOString();
    var tMax = month == null
      ? new Date(year + 1, 0, 1).toISOString()
      : new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    var url = 'https://www.googleapis.com/calendar/v3/calendars/' + CAL_ID
      + '/events?key=' + API_KEY
      + '&timeMin=' + encodeURIComponent(tMin)
      + '&timeMax=' + encodeURIComponent(tMax)
      + '&singleEvents=true&orderBy=startTime&maxResults=' + (month == null ? '2500' : '100');
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Google Calendar API 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        return (data.items || []).map(function (it) {
          var title = it.summary
            ? it.summary
            : (it.visibility === 'private' ? '🔒 비공개 일정' : '(제목 없음)');
          return { id: it.id, title: title, start: it.start.dateTime || it.start.date, link: it.htmlLink, source: 'google' };
        });
      })
      .catch(function () { return []; });

  }

  function fetchEvents(year, month) {
    return Promise.all([fetchGoogleEvents(year, month), fetchEarnings(year, month)])
      .then(function (results) {
        upsertStoredCalendarEvents((results[0] || []).concat(results[1] || []));
        return mergeEvents(storedMonthEvents(year, month), []);
      });
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

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeOf(ev) {
    if (ev.start.indexOf('T') === -1) return '종일';
    var dt = new Date(ev.start);
    return dt.getHours() + ':' + String(dt.getMinutes()).padStart(2, '0');
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
    var explicit = String(ev && (ev.company || ev.companyName) || '').trim();
    if (explicit && explicit.toUpperCase() !== String(meta.stockName || '').toUpperCase()) return explicit;
    var text = String(meta && meta.text || '');
    var marker = text.lastIndexOf(' · ');
    if (marker !== -1) {
      var fromTitle = text.slice(marker + 3).trim();
      if (fromTitle && !/^(장전|장후|실적발표|실적발표 완료)/.test(fromTitle)) return fromTitle;
    }
    return '';
  }

  function renderEventRow(ev) {
    var meta = parseEvent(ev.title);
    var iconClass, iconHtml;
    if (meta.isStock) {
      iconClass = 'sc-ev-icon stock';
      // 2글자 약칭을 바탕색으로 항상 먼저 깔고, KRX_MAP(종목명->코드)에서 코드를 찾으면
      // 실제 로고 이미지를 그 위에 겹쳐 그린다 - 이름이 KRX_MAP과 정확히 안 맞거나
      // (예: 표기 차이) 로고 파일이 없는 종목은 svg->png 3단 폴백 끝에 이미지가 숨겨져도
      // 밑에 깔린 약칭이 그대로 보여 빈 원으로 남지 않는다.
      var code = stockCodeFor(ev, meta.stockName);
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
    var titleHtml = meta.isStock
      ? '<strong class="sc-ev-ticker">' + stockLabel + '</strong> ' + escapeHtml(eventText)
      : escapeHtml(meta.text);
    var tagHtml = meta.tag ? '<span class="sc-ev-tag">' + escapeHtml(meta.tag) + '</span>' : '';
    var blockedExternalLink = isFinnhubLink(ev.link);
    var rowStart = blockedExternalLink
      ? '<div class="sc-ev-item sc-ev-item-disabled" aria-disabled="true" data-external-link-blocked="finnhub">'
      : '<a href="' + escapeHtml(ev.link || '#') + '" target="_blank" class="sc-ev-item">';
    var rowEnd = blockedExternalLink ? '</div>' : '</a>';
    return rowStart
      + '<span class="sc-ev-date">' + dateLabelOf(ev) + '</span>'
      + '<span class="' + iconClass + '">' + iconHtml + '</span>'
      + '<span class="sc-ev-body"><span class="sc-ev-title">' + titleHtml + tagHtml + '</span></span>'
      + '<span class="sc-ev-time">' + timeOf(ev) + '</span>'
      + rowEnd;
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    function dateKey(date) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
        + '-' + String(date.getDate()).padStart(2, '0');
    }

    function renderToday(today, events) {
      var todayKey = dateKey(today);
      var todayEvents = (events || []).filter(function (event) {
        return String(event && event.start || '').slice(0, 10) === todayKey;
      }).sort(compareEvents);
      var dateTitle = today.getFullYear() + '년 ' + (today.getMonth() + 1) + '월 ' + today.getDate() + '일';
      var listHtml = todayEvents.length
        ? '<div class="sc-today-rows">' + todayEvents.map(renderEventRow).join('') + '</div>'
        : '<div class="sc-empty">오늘 예정된 일정이 없습니다.</div>';

      container.innerHTML =
        '<div class="sc-today-only">'
        + '<div class="sc-today-head"><div><strong>오늘의 일정</strong><span>' + dateTitle + '</span></div>'
        + '<small>오늘 일정만 표시합니다.</small></div>'
        + listHtml
        + '</div>';
    }

    function loadToday() {
      var today = new Date();
      container.innerHTML = '<div class="sc-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>불러오는 중...</div>';
      StockCalendar.fetchEvents(today.getFullYear(), today.getMonth())
        .then(function (evs) {
          renderToday(today, evs);
        })
        .catch(function () {
          container.innerHTML = '<div class="sc-error">일정을 불러오지 못했습니다.</div>';
        });
    }

    loadToday();
    // 새로 접수된 오늘 일정이 화면에 반영되도록 주기적으로 갱신한다.
    // 페이지를 떠나면 브라우저가 타이머를 정리하므로 별도 서버 작업은 필요 없다.
    setInterval(function () {
      if (!document.hidden) loadToday();
    }, 15 * 60 * 1000);
  }

  var StockCalendar = { fetchEvents: fetchEvents, init: init };
  global.StockCalendar = StockCalendar;
  document.addEventListener('DOMContentLoaded', init);
})(window);
