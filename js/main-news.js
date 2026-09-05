/* 주요 뉴스(/page/main-news): 한국·미국 시장 뉴스를 시간순 한 줄기로 보여준다.
 *
 * 2026-09-05 요청("시장 밑에 주요 뉴스를 만들고 싶어 / 미국 + 한국"),
 * 이어서 "한줄에 나와도 되고 플래그로 한국 미국 구분만 지어줘".
 *
 * 처음엔 두 칼럼이었는데 한 목록으로 합쳤다. 칼럼을 나누면 "어느 쪽이 더 최근인가"를
 * 눈으로 맞춰봐야 하고 모바일에서는 한쪽을 다 지나야 다른 쪽이 나온다. 하나로 섞어
 * 시간순으로 세우면 그 두 문제가 같이 사라지고, 시장 구분은 줄머리 국기로 한다.
 *
 * 홈의 경제 종합뉴스(js/home-economic-news.js)는 **지금 시장 하나만** 보여준다
 * (장중이면 국내, 프리마켓부터는 미국). 이 페이지는 두 시장을 함께 놓는 자리다.
 *
 * 데이터는 이미 있는 엔드포인트를 그대로 쓴다. 새 백엔드 경로를 만들지 않는다.
 *   GET /domestic-news?kind=news&limit=N   네이버 국내 뉴스(공시 제외)
 *   GET /foreign-news?limit=N              CNBC/Bloomberg RSS + Finnhub + Alpha Vantage
 * 미국 기사는 서버가 title_ko를 채워 주면 그것을 우선 쓴다(원문은 title에 남는다).
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#main-news';
  // 화면에 그리는 수(RENDER_LIMIT)만큼만 받는다. 40건을 받아 25건만 쓰던 걸 맞췄다.
  var DOMESTIC_API_URL = 'https://goodbyestar.cloud/domestic-news?kind=news&limit=25';
  var US_API_URL = 'https://goodbyestar.cloud/foreign-news?limit=25';
  var REFRESH_MS = 5 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 15000;
  // 실패가 잠깐이면(서버 재시작·순간 혼잡·429) 5분을 기다리지 않고 한 번 더 시도한다.
  var RETRY_MS = 6000;
  // 탭에 돌아올 때마다 다시 부르면 앱을 몇 번 오가는 것만으로 요청이 쌓인다.
  // /domestic-news는 IP당 60초에 20회 제한이라 실제로 429가 날 수 있다 - 이만큼
  // 지났을 때만 다시 부른다.
  var STALE_MS = 60 * 1000;
  // 시장별로 받아 와 섞으므로 한쪽이 시간대를 독차지하지 않게 같은 수로 자른다.
  var RENDER_LIMIT = 25;
  // 2026-09-05: 국기 이모지에서 글자 배지로 바꿨다(사용자 요청 "kor, us 이런 형태로").
  // 국기는 지역 표시 문자라 윈도우 크롬에서 두 글자로 그려져 플랫폼마다 모양이 달랐다.
  // 글자는 어디서나 같고 낭독기에도 그대로 읽힌다 - aria-label로 한글 이름을 붙인다.
  var MARKETS = [
    { key: 'domestic', code: 'KOR', label: '한국' },
    { key: 'us', code: 'US', label: '미국' }
  ];

  var state = { container: null, timer: null, generation: 0, loadedAt: 0, retryTimer: null };

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

  function marketOf(item) {
    return item && item._market === 'us' ? MARKETS[1] : MARKETS[0];
  }

  function rowHtml(item) {
    var title = displayTitle(item);
    if (!title) return '';
    var market = marketOf(item);
    var href = String((item && item.link) || '').trim();
    var time = timeLabel(item && item.pubDate);
    var source = sourceLabel(item);
    var open = href ? '<a class="mn-row" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' : '<div class="mn-row">';
    var close = href ? '</a>' : '</div>';
    return open
      + '<span class="mn-market" aria-label="' + market.label + '">' + market.code + '</span>'
      + '<span class="mn-row-body">'
      + '<span class="mn-row-meta">'
      + (time ? '<time>' + escapeHtml(time) + '</time>' : '')
      + (source ? '<span class="mn-row-source">' + escapeHtml(source) + '</span>' : '')
      + '</span>'
      + '<strong class="mn-row-title">' + escapeHtml(title) + '</strong>'
      + '</span>'
      + close;
  }

  function buildShell() {
    return '<div class="mn-head">'
      + '<h2>주요 뉴스</h2>'
      + '<p>한국(' + MARKETS[0].code + ')·미국(' + MARKETS[1].code + ') 시장 뉴스를 최신순으로 함께 봅니다.'
      + ' 제목을 누르면 원문으로 이동합니다.</p>'
      + '<small data-mn-updated></small>'
      + '</div>'
      + '<div class="mn-list" data-mn-list><p class="mn-state">뉴스를 불러오는 중입니다.</p></div>';
  }

  function render(container, items, failed) {
    var list = container.querySelector('[data-mn-list]');
    var updated = container.querySelector('[data-mn-updated]');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = failed.length
        ? '<p class="mn-state mn-state--error">뉴스를 불러오지 못했습니다. 잠시 후 다시 시도합니다.</p>'
        : '<p class="mn-state">표시할 뉴스가 없습니다.</p>';
      return;
    }
    // 한쪽만 실패하면 나머지는 그대로 보여주되, 무엇이 빠졌는지는 숨기지 않는다.
    var notice = failed.length
      ? '<p class="mn-state mn-state--error">' + failed.join('·') + ' 뉴스를 불러오지 못했습니다.</p>'
      : '';
    list.innerHTML = notice + items.map(rowHtml).join('');
    if (updated) updated.textContent = timeLabel(new Date().toISOString()) + ' 기준';
  }

  function refresh(container) {
    var generation = ++state.generation;
    var collected = [];
    var failed = [];
    var pending = MARKETS.length;
    MARKETS.forEach(function (market) {
      var url = market.key === 'us' ? US_API_URL : DOMESTIC_API_URL;
      MainNews.fetchJson(url)
        .then(function (items) {
          items.forEach(function (item) { item._market = market.key; });
          collected = collected.concat(items);
        })
        .catch(function () { failed.push(market.label); })
        .then(function () {
          if (--pending || generation !== state.generation) return;
          // 두 시장을 하나로 세우려면 여기서 다시 정렬해야 한다(각 응답은 자기 안에서만 정렬돼 있다).
          collected.sort(function (a, b) { return dateValue(b.pubDate) - dateValue(a.pubDate); });
          render(container, collected, failed);
          if (collected.length) state.loadedAt = Date.now();
          // 전부 실패했을 때만 한 번 더. 성공분이 있으면 5분 주기에 맡긴다.
          if (!collected.length && failed.length && !state.retryTimer) {
            state.retryTimer = setTimeout(function () {
              state.retryTimer = null;
              if (state.container) refresh(state.container);
            }, RETRY_MS);
          }
        });
    });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    state.container = container;
    container.innerHTML = buildShell();
    refresh(container);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { refresh(container); }, REFRESH_MS);
    // 탭을 다시 열었을 때 오래된 목록을 보고 있지 않게 한다. 다만 앱을 오갈 때마다
    // 부르면 요청이 쌓여 오히려 429로 화면이 비므로, 충분히 지났을 때만 부른다.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !state.container) return;
      if (Date.now() - state.loadedAt < STALE_MS) return;
      refresh(state.container);
    });
  }

  var MainNews = { init: init, fetchJson: fetchJson };
  global.MainNews = MainNews;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
