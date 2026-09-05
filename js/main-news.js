/* 주요 뉴스(/page/main-news): 한국·미국 시장 뉴스를 한 화면에 나란히 보여준다.
 *
 * 2026-09-05 요청("시장 밑에 주요 뉴스를 만들고 싶어 / 미국 + 한국").
 *
 * 홈의 경제 종합뉴스(js/home-economic-news.js)는 **지금 시장 하나만** 보여준다.
 * 장중이면 국내, 프리마켓부터는 미국으로 자동 전환된다. 이 페이지는 그 반대로
 * 두 시장을 동시에 놓고 비교해 읽는 자리다. 그래서 탭 전환이 아니라 두 칼럼이다
 * (모바일에서는 세로로 쌓이고 국내가 위로 온다).
 *
 * 데이터는 이미 있는 엔드포인트를 그대로 쓴다. 새 백엔드 경로를 만들지 않는다.
 *   GET /domestic-news?kind=news&limit=N   네이버 국내 뉴스(공시 제외)
 *   GET /foreign-news?limit=N              CNBC/Bloomberg RSS + Finnhub + Alpha Vantage
 * 미국 기사는 서버가 title_ko를 채워 주면 그것을 우선 쓴다(원문은 title에 남는다).
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#main-news';
  var DOMESTIC_API_URL = 'https://goodbyestar.cloud/domestic-news?kind=news&limit=40';
  var US_API_URL = 'https://goodbyestar.cloud/foreign-news?limit=40';
  var REFRESH_MS = 5 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 15000;
  var RENDER_LIMIT = 30;
  // 모바일은 두 칼럼이 세로로 쌓이므로, 접지 않으면 한국 30건을 다 지나야 미국이 나온다.
  // 처음엔 이만큼만 펴 두고 "더 보기"로 나머지를 연다(PC에서는 CSS가 항상 다 편다).
  var MOBILE_COLLAPSE_AT = 10;

  var state = { container: null, timer: null, generation: 0 };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  /* 국내 공시는 YYYYMMDD로 오고 뉴스는 RFC 문자열로 온다(홈 뉴스 모듈과 같은 규약). */
  function parseDate(value) {
    var text = String(value || '').trim();
    if (/^\d{8}$/.test(text)) {
      text = text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6) + 'T00:00:00+09:00';
    }
    return new Date(text);
  }

  function dateValue(value) {
    var parsed = parseDate(value);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  /* 한국·미국 기사를 한 화면에서 비교하므로 시각은 둘 다 KST로 통일한다.
     오늘 기사는 시:분만, 지난 기사는 날짜를 앞에 붙여 언제 것인지 바로 보이게 한다. */
  function timeLabel(value) {
    var parsed = parseDate(value);
    if (isNaN(parsed.getTime())) return '';
    var fmt = function (opts) {
      return new Intl.DateTimeFormat('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, opts)).format(parsed);
    };
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    var day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(parsed);
    var clock = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
    return day === today ? clock : fmt({ month: '2-digit', day: '2-digit' }) + ' ' + clock;
  }

  /* 출처 표기.
   *
   * 실측(2026-09-05, Actions 러너로 운영 API 확인):
   *   /foreign-news 의 source → "CNBC"(19) "Bloomberg"(14) "Reuters"(7)  = 언론사명
   *   /domestic-news 의 source → "mk.co.kr" "magazine.hankyung.com" ...  = 도메인
   * 미국 쪽은 그대로 쓰면 되고 국내 쪽만 도메인이라, 아는 곳은 이름으로 바꾸고
   * 모르는 곳은 등록 도메인만 남긴다(www./m./view./news. 같은 접두사 제거).
   *
   * category는 국내·미국 모두 "시장" 하나로만 와서 정보가 없다 - 폴백으로 쓰지 않는다.
   * 표에 없는 매체가 나와도 도메인이 보이므로 어디 기사인지는 알 수 있다. */
  var PRESS_BY_DOMAIN = {
    'yna.co.kr': '연합뉴스', 'mk.co.kr': '매일경제', 'hankyung.com': '한국경제',
    'sedaily.com': '서울경제', 'edaily.co.kr': '이데일리', 'asiae.co.kr': '아시아경제',
    'etoday.co.kr': '이투데이', 'fnnews.com': '파이낸셜뉴스', 'mt.co.kr': '머니투데이',
    'hankookilbo.com': '한국일보', 'chosun.com': '조선일보', 'joongang.co.kr': '중앙일보',
    'donga.com': '동아일보', 'khan.co.kr': '경향신문', 'hani.co.kr': '한겨레',
    'newsis.com': '뉴시스', 'news1.kr': '뉴스1', 'inews24.com': '아이뉴스24',
    'thebell.co.kr': '더벨', 'businesspost.co.kr': '비즈니스포스트'
  };

  function registrableDomain(host) {
    var name = String(host || '').trim().toLowerCase().replace(/^(?:www|m|view|news|magazine)\./, '');
    var parts = name.split('.');
    // co.kr·or.kr처럼 2단계 국가 도메인은 세 조각을 남겨야 이름이 된다
    // (mk.co.kr을 두 조각으로 자르면 "co.kr"이 되어 버린다).
    if (parts.length >= 3 && /^(co|or|go|ne|re|pe|ac)$/.test(parts[parts.length - 2])) {
      return parts.slice(-3).join('.');
    }
    if (parts.length > 2) return parts.slice(-2).join('.');
    return name;
  }

  function sourceLabel(item) {
    var raw = String((item && (item.press || item.source)) || '').trim();
    if (!raw) return '';
    if (raw.indexOf('.') === -1) return raw;          // 이미 언론사명(CNBC 등)
    var domain = registrableDomain(raw);
    return PRESS_BY_DOMAIN[domain] || domain;
  }

  function displayTitle(item) {
    var korean = String((item && item.title_ko) || '').trim();
    return korean || String((item && item.title) || '').trim();
  }

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (response) {
        if (!response.ok) throw new Error('뉴스 응답 오류: ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        var data = (payload && payload.data) || payload || {};
        var items = (data.items || []).filter(function (item) { return item && item.title; });
        // 서버가 시간순을 보장하지 않는 경로가 섞여 있어(RSS 합본) 여기서 한 번 더 정렬한다.
        items.sort(function (a, b) { return dateValue(b.pubDate) - dateValue(a.pubDate); });
        return items.slice(0, RENDER_LIMIT);
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function rowHtml(item) {
    var title = displayTitle(item);
    if (!title) return '';
    var href = String((item && item.link) || '').trim();
    var time = timeLabel(item && item.pubDate);
    var open = href ? '<a class="mn-row" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' : '<div class="mn-row">';
    var close = href ? '</a>' : '</div>';
    var source = sourceLabel(item);
    return open
      + '<div class="mn-row-meta">'
      + (time ? '<time>' + escapeHtml(time) + '</time>' : '')
      + (source ? '<span class="mn-row-source">' + escapeHtml(source) + '</span>' : '')
      + '</div>'
      + '<strong class="mn-row-title">' + escapeHtml(title) + '</strong>'
      + close;
  }

  function columnHtml(market, label, sub) {
    return '<section class="mn-column" data-mn-column="' + market + '" aria-label="' + escapeHtml(label) + '">'
      + '<div class="mn-column-head"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(sub) + '</span>'
      + '<small data-mn-updated></small></div>'
      + '<div class="mn-list" data-mn-list><p class="mn-state">뉴스를 불러오는 중입니다.</p></div>'
      + '<button type="button" class="mn-more" data-mn-more hidden>더 보기</button>'
      + '</section>';
  }

  function buildShell() {
    return '<div class="mn-head">'
      + '<h2>주요 뉴스</h2>'
      + '<p>한국·미국 시장 뉴스를 함께 봅니다. 제목을 누르면 원문으로 이동합니다.</p>'
      + '</div>'
      + '<div class="mn-columns">'
      + columnHtml('domestic', '한국', '네이버 뉴스')
      + columnHtml('us', '미국', 'CNBC · Bloomberg · Finnhub')
      + '</div>';
  }

  function renderColumn(container, market, items, error) {
    var column = container.querySelector('[data-mn-column="' + market + '"]');
    if (!column) return;
    var list = column.querySelector('[data-mn-list]');
    var updated = column.querySelector('[data-mn-updated]');
    var more = column.querySelector('[data-mn-more]');
    if (more) more.hidden = true;
    column.classList.remove('is-expanded');
    if (error) {
      list.innerHTML = '<p class="mn-state mn-state--error">뉴스를 불러오지 못했습니다. 잠시 후 다시 시도합니다.</p>';
      return;
    }
    if (!items.length) {
      list.innerHTML = '<p class="mn-state">표시할 뉴스가 없습니다.</p>';
      return;
    }
    list.innerHTML = items.map(rowHtml).join('');
    if (more && items.length > MOBILE_COLLAPSE_AT) {
      more.hidden = false;
      more.textContent = '더 보기 (' + (items.length - MOBILE_COLLAPSE_AT) + '건)';
    }
    if (updated) updated.textContent = timeLabel(new Date().toISOString()) + ' 기준';
  }

  function refresh(container) {
    var generation = ++state.generation;
    [['domestic', DOMESTIC_API_URL], ['us', US_API_URL]].forEach(function (pair) {
      // 두 시장을 따로 그린다 - 한쪽이 실패해도 다른 쪽은 그대로 보여야 한다.
      // 지역 함수가 아니라 export를 거쳐 부른다 - test/main-news.html이 이 한 지점만
      // 갈아끼워 목 데이터로 렌더를 검증한다(js/overnight-market.js와 같은 규약).
      MainNews.fetchJson(pair[1])
        .then(function (items) {
          if (generation !== state.generation) return;
          renderColumn(container, pair[0], items, null);
        })
        .catch(function () {
          if (generation !== state.generation) return;
          renderColumn(container, pair[0], [], true);
        });
    });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    state.container = container;
    container.innerHTML = buildShell();
    container.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-mn-more]') : null;
      if (!button) return;
      var column = button.closest('.mn-column');
      if (!column) return;
      column.classList.add('is-expanded');
      button.hidden = true;
    });
    refresh(container);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { refresh(container); }, REFRESH_MS);
    // 탭을 다시 열었을 때 오래된 목록을 보고 있지 않게 한다.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.container) refresh(state.container);
    });
  }

  var MainNews = { init: init, fetchJson: fetchJson };
  global.MainNews = MainNews;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
