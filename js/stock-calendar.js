/**
 * 증시캘린더 - 독립 페이지 위젯 (2026-07-22)
 * 예전엔 js/skin-main.js의 openCalendarModal()이 중앙 모달로 띄우는 방식이었으나,
 * 사용자 요청으로 별도 Tistory Page(#stock-calendar 마운트)로 전환 - 필터 없이
 * 월 달력 + 주차별 이벤트 리스트만 항상 펼쳐서 보여준다.
 *
 * 데이터 소스는 이전과 동일한 구글 캘린더 이벤트(제목+날짜/시간)뿐 - 예측치/이전치 같은
 * 경제지표 수치는 소스가 없어 표시하지 않는다.
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

  var API_KEY = 'AIzaSyB9zgyudgEblbLoP-fW231dwf6VjOFK00o';
  var CAL_ID  = encodeURIComponent('405dbd75cc8e798f6dfb0003494d0fa64eecbc00ae2edeb1cdbf6deee0b07f76@group.calendar.google.com');
  var CONTAINER_SELECTOR = '#stock-calendar';

  function fetchEvents(year, month) {
    var tMin = new Date(year, month, 1).toISOString();
    var tMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    var url = 'https://www.googleapis.com/calendar/v3/calendars/' + CAL_ID
      + '/events?key=' + API_KEY
      + '&timeMin=' + encodeURIComponent(tMin)
      + '&timeMax=' + encodeURIComponent(tMax)
      + '&singleEvents=true&orderBy=startTime&maxResults=100';
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        return (data.items || []).map(function (it) {
          var title = it.summary
            ? it.summary
            : (it.visibility === 'private' ? '🔒 비공개 일정' : '(제목 없음)');
          return { title: title, start: it.start.dateTime || it.start.date, link: it.htmlLink };
        });
      });
  }

  function parseEvent(rawTitle) {
    var segs = String(rawTitle || '').split('|').map(function (s) { return s.trim(); });
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
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dayOf(ev) {
    return parseInt((ev.start.indexOf('T') !== -1 ? ev.start : ev.start + 'T00:00').slice(8, 10), 10);
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

  function renderEventRow(ev) {
    var meta = parseEvent(ev.title);
    var iconClass, iconHtml;
    if (meta.isStock) {
      iconClass = 'sc-ev-icon stock';
      iconHtml  = escapeHtml((meta.stockName || '').slice(0, 2));
    } else if (meta.isForeign) {
      iconClass = 'sc-ev-icon flag';
      iconHtml  = meta.flag;
    } else {
      iconClass = 'sc-ev-icon default';
      iconHtml  = '📅';
    }
    var titleHtml = meta.isStock
      ? '<strong class="sc-ev-ticker">$' + escapeHtml(meta.stockName) + '</strong> ' + escapeHtml(meta.text)
      : escapeHtml(meta.text);
    var tagHtml = meta.tag ? '<span class="sc-ev-tag">' + escapeHtml(meta.tag) + '</span>' : '';
    return '<a href="' + (ev.link || '#') + '" target="_blank" class="sc-ev-item">'
      + '<span class="sc-ev-date">' + dateLabelOf(ev) + '</span>'
      + '<span class="' + iconClass + '">' + iconHtml + '</span>'
      + '<span class="sc-ev-body"><span class="sc-ev-title">' + titleHtml + tagHtml + '</span></span>'
      + '<span class="sc-ev-time">' + timeOf(ev) + '</span>'
      + '</a>';
  }

  /* 달력 그리드의 각 행(일~토)을 "N주차"로 묶는다 - 이벤트가 있는 주차만 리스트에 노출 */
  function groupByWeek(year, month, evs) {
    var byDay = {};
    evs.forEach(function (ev) {
      var d = dayOf(ev);
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(ev);
    });
    var firstDay    = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var weeks = [];
    var weekNo = 1;
    var current = { weekNo: weekNo, items: [] };
    for (var d = 1; d <= daysInMonth; d++) {
      var dow = (firstDay + d - 1) % 7;
      if (byDay[d]) {
        byDay[d].forEach(function (ev) { current.items.push(ev); });
      }
      if (dow === 6 || d === daysInMonth) {
        weeks.push(current);
        weekNo++;
        current = { weekNo: weekNo, items: [] };
      }
    }
    return weeks.filter(function (w) { return w.items.length > 0; });
  }

  function buildMonthGrid(year, month, evs) {
    var byDay = {};
    evs.forEach(function (ev) { byDay[dayOf(ev)] = true; });
    var firstDay    = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = new Date();
    var isThisMonth = year === today.getFullYear() && month === today.getMonth();
    var html = '';
    for (var i = 0; i < firstDay; i++) html += '<div class="sc-day sc-day-empty"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var dow = (firstDay + d - 1) % 7;
      var isToday = isThisMonth && d === today.getDate();
      var cls = 'sc-day' + (isToday ? ' sc-today' : '') + (byDay[d] ? ' sc-has-event' : '');
      var style = '';
      if (!isToday) {
        if (dow === 0) style = ' style="color:#e11d48;"';
        if (dow === 6) style = ' style="color:#2563eb;"';
      }
      html += '<div class="' + cls + '"' + style + '><span>' + d + '</span>'
        + (byDay[d] ? '<div class="sc-dot"></div>' : '') + '</div>';
    }
    return html;
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    function load(year, month) {
      if (month < 0) { month = 11; year -= 1; }
      if (month > 11) { month = 0; year += 1; }
      container.innerHTML = '<div class="sc-loading">불러오는 중...</div>';
      StockCalendar.fetchEvents(year, month)
        .then(function (evs) { renderPage(year, month, evs); })
        .catch(function () {
          container.innerHTML = '<div class="sc-error">일정을 불러오지 못했습니다.</div>';
        });
    }

    function renderPage(year, month, evs) {
      var weeks = groupByWeek(year, month, evs);
      var listHtml = weeks.length
        ? weeks.map(function (w) {
            return '<div class="sc-week">'
              + '<div class="sc-week-title">' + (month + 1) + '월 ' + w.weekNo + '주차</div>'
              + '<div class="sc-week-rows">' + w.items.map(renderEventRow).join('') + '</div>'
              + '</div>';
          }).join('')
        : '<div class="sc-empty">이번 달 일정이 없습니다.</div>';

      container.innerHTML =
        '<div class="sc-layout">'
        + '<div class="sc-cal-col">'
        + '<div class="sc-cal-header"><button type="button" class="sc-nav" id="scPrev">‹</button>'
        + '<span class="sc-cal-title">' + year + '년 ' + (month + 1) + '월</span>'
        + '<button type="button" class="sc-nav" id="scNext">›</button></div>'
        + '<div class="sc-dow"><span style="color:#e11d48;">일</span><span>월</span><span>화</span>'
        + '<span>수</span><span>목</span><span>금</span><span style="color:#2563eb;">토</span></div>'
        + '<div class="sc-grid">' + buildMonthGrid(year, month, evs) + '</div>'
        + '</div>'
        + '<div class="sc-list-col">' + listHtml + '</div>'
        + '</div>';

      document.getElementById('scPrev').addEventListener('click', function () { load(year, month - 1); });
      document.getElementById('scNext').addEventListener('click', function () { load(year, month + 1); });
    }

    var today = new Date();
    load(today.getFullYear(), today.getMonth());
  }

  var StockCalendar = { fetchEvents: fetchEvents, init: init };
  global.StockCalendar = StockCalendar;
  document.addEventListener('DOMContentLoaded', init);
})(window);
