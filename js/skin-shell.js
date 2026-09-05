/**
 * 9bolt 스킨 - 태그 없는 정적 UI 조각 (git 관리)
 * skin.html에는 빈 mount div(id="shell-*")만 남기고, 실제 마크업은 여기서 주입한다.
 * 목적: 이 조각들은 티스토리 서버 치환 태그([##_..._##], s_xxx)가 전혀 없어서
 * git push만으로 반영 가능 — skin.html 재배포(스킨 편집기 붙여넣기) 불필요.
 *
 * 반드시 skin-menu.js/skin-main.js보다 먼저 로드돼야 함 — 그 스크립트들이
 * mobileMenuBtn, scrollTopBtn 등을 getElementById로 찾기 때문.
 *
 * 태그가 하나라도 섞인 블록(네비바 로고/검색창, 카테고리 데이터, 글 목록,
 * 방문자 통계, 공지/방명록/페이지네이션 등)은 여기로 옮길 수 없음 — skin.html에
 * 그대로 남아있어야 티스토리 서버가 치환해준다.
 *
 * 2026-07-17(9차): KRX 공시 티커 껍데기(discTicker)를 여기서 제거함 - js/quick-indices.js의
 * "긴급속보" 패널로 흡수됐다. skin.html의 #shell-discTicker mount는 이제 그냥 빈 div로
 * 남아있지만(치환 태그가 없어 존재해도 무해), 굳이 지우려면 skin.html 재배포가 필요해
 * 손대지 않았다.
 */
/* ──────────────────────────────────────────────────────────────────────────
   시장 시간 단일 기준 (2026-09-05)

   왜 여기 있나: skin.html은 티스토리 관리자에서만 고칠 수 있어 새 <script> 태그를
   추가할 수 없다. 이 파일은 skin.html이 skin-menu.js·skin-main.js보다 **먼저**
   defer로 부르는 유일한 공통 스크립트라, 여기 두면 모든 소비자가 자기 코드가 돌기
   전에 window.MarketHours를 확실히 볼 수 있다(주입 방식은 경쟁 조건이 생긴다).

   왜 만들었나: 같은 판정이 파일마다 다른 경계로 복제돼 있었다.
     미국 전환   skin-main 17:00 / home-widgets 20:30 / home-economic-news 17:00
     휴장 창     skin-main 토09:00~월09:00 / home-weekly-report 토07:00~월06:00
     현물 마감   quick-indices 15:30 / domestic-market-indicators 15:45
   토 07:00~09:00처럼 창이 어긋나는 구간에서 실제로 화면이 깨졌다(2026-09-04 휴장
   안내가 주간 리포트 아래로 밀린 건). 경계를 한 곳에만 둔다.

   기준 시간표(한국거래소 / KST):
     정규장(현물)      09:00 ~ 15:30
     장 시작 동시호가  08:30 ~ 09:00
     장 마감 동시호가  15:20 ~ 15:30   (정규장 안)
     시간외 종가 장전  08:30 ~ 08:40   (전일 종가로 거래)
     시간외 종가 장후  15:40 ~ 16:00   (당일 종가로 거래)
     시간외 단일가     16:00 ~ 18:00   (10분 단위 체결, 당일 종가 대비 ±10%)
     대체거래소(NXT)   08:00 ~ 20:00
     지수선물 정규장   09:00 ~ 15:45   (현물보다 15분 늦게 끝난다)
     지수선물 야간     18:00 ~ 익일 05:00

   미국(현지 ET → KST). 서머타임이면 한 시간씩 당겨진다:
     프리마켓 04:00~09:30 ET → EDT 17:00~22:30 / EST 18:00~23:30
     정규장   09:30~16:00 ET → EDT 22:30~05:00 / EST 23:30~06:00
     애프터   16:00~20:00 ET → EDT 05:00~09:00 / EST 06:00~10:00
   서머타임 여부는 규칙을 직접 갖지 않고 Intl로 실제 뉴욕 시각을 물어 판정한다.
   ────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';
  if (global.MarketHours) return;

  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var M = function (h, m) { return h * 60 + (m || 0); };

  // 한국거래소 휴장일. js/domestic-market-indicators.js와 js/kospi-futures.js에
  // 따로 있던 표를 여기로 모았다. 해가 바뀌면 이 표만 갱신하면 된다.
  var KRX_HOLIDAYS = {
    '2026': {
      '20260101': 1, '20260216': 1, '20260217': 1, '20260218': 1,
      '20260301': 1, '20260302': 1, '20260501': 1, '20260505': 1,
      '20260525': 1, '20260603': 1, '20260606': 1, '20260717': 1,
      '20260815': 1, '20260817': 1, '20260924': 1, '20260925': 1,
      '20260926': 1, '20261003': 1, '20261005': 1, '20261009': 1,
      '20261225': 1, '20261231': 1
    }
  };

  // Date.now()는 방문자 위치와 무관하게 항상 UTC epoch ms라서, 9시간을 더하면
  // 방문자 시간대와 상관없이 정확한 KST가 나온다(기존 파일들과 같은 기법).
  function kst(date) {
    var t = date ? (date.getTime ? date.getTime() : Number(date)) : Date.now();
    var d = new Date(t + KST_OFFSET_MS);
    var y = d.getUTCFullYear();
    var mo = String(d.getUTCMonth() + 1);
    var da = String(d.getUTCDate());
    return {
      year: y,
      day: d.getUTCDay(),                                   // 0=일 ... 6=토
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
      dateKey: String(y) + (mo.length < 2 ? '0' : '') + mo + (da.length < 2 ? '0' : '') + da
    };
  }

  function isKrHoliday(date) {
    var k = kst(date);
    if (k.day === 0 || k.day === 6) return true;
    var year = KRX_HOLIDAYS[String(k.year)];
    return !!(year && year[k.dateKey]);
  }

  function isKrTradingDay(date) { return !isKrHoliday(date); }

  /* 현물 세션. phase는 화면에 한 줄로 쓸 수 있게 하나만 고르고, 겹치는 제도
     (마감 동시호가·시간외 종가 장전·NXT)는 별도 플래그로 함께 돌려준다. */
  function krCash(date) {
    var k = kst(date);
    var m = k.minutes;
    var nxtOpen = !isKrHoliday(date) && m >= M(8) && m < M(20);
    var out = {
      phase: 'closed', open: false, label: '휴장',
      closeAuction: false, preClosePrice: false, nxtOpen: nxtOpen
    };
    if (isKrHoliday(date)) return out;
    out.closeAuction = m >= M(15, 20) && m < M(15, 30);
    out.preClosePrice = m >= M(8, 30) && m < M(8, 40);
    if (m >= M(9) && m < M(15, 30)) {
      out.phase = 'regular'; out.open = true;
      out.label = out.closeAuction ? '마감 동시호가' : '정규장';
    } else if (m >= M(8, 30) && m < M(9)) {
      out.phase = 'preAuction'; out.label = '장 시작 동시호가';
    } else if (m >= M(15, 40) && m < M(16)) {
      out.phase = 'afterClose'; out.label = '시간외 종가';
    } else if (m >= M(16) && m < M(18)) {
      out.phase = 'singlePrice'; out.label = '시간외 단일가';
    } else if (nxtOpen) {
      out.phase = 'nxt'; out.label = 'NXT 거래';
    } else {
      out.label = '장 마감';
    }
    return out;
  }

  /* 지수선물. 정규장은 현물보다 15분 늦은 15:45에 끝나고, 야간 세션은 18:00에
     열려 다음 날 05:00에 닫힌다. 00:00~05:00은 전날 저녁에 시작한 세션이므로
     휴장 판정도 전날 기준으로 한다.

     2026-09-05: 야간 종료를 06:00에서 05:00으로 정정했다. 옮겨온 코드
     (js/kospi-futures.js·js/quick-indices.js)가 06:00을 쓰고 있었는데, 그 한 시간은
     이미 닫힌 세션을 "실시간"으로 표시하고 시세도 계속 폴링하던 구간이다. */
  function krFutures(date) {
    var k = kst(date);
    var m = k.minutes;
    if (m < M(5)) {
      var prev = new Date((date ? date.getTime() : Date.now()) - 24 * 60 * 60 * 1000);
      return isKrHoliday(prev)
        ? { phase: 'closed', open: false, label: '휴장' }
        : { phase: 'night', open: true, label: '야간선물' };
    }
    if (isKrHoliday(date)) return { phase: 'closed', open: false, label: '휴장' };
    if (m >= M(9) && m < M(15, 45)) return { phase: 'regular', open: true, label: '정규장' };
    if (m >= M(18)) return { phase: 'night', open: true, label: '야간선물' };
    return { phase: 'closed', open: false, label: '장 마감' };
  }

  /* 야간선물 세션의 휴장 여부. 00:00~05:00은 전날 저녁에 시작한 세션이라 전날로
     판정한다. 소비자(skin-main.js·kospi-futures.js)가 각자 경계를 재지 않게 여기 둔다. */
  function isNightSessionHoliday(date) {
    var t = date ? (date.getTime ? date.getTime() : Number(date)) : Date.now();
    return kst(t).minutes < M(5)
      ? isKrHoliday(new Date(t - 24 * 60 * 60 * 1000))
      : isKrHoliday(new Date(t));
  }

  /* 뉴욕 현지 시각. 서머타임 규칙을 직접 갖지 않고 Intl에 묻는다. */
  function nyClock(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short'
    }).formatToParts(date || new Date()).reduce(function (acc, part) {
      acc[part.type] = part.value; return acc;
    }, {});
    var hour = Number(parts.hour);
    if (hour === 24) hour = 0;                              // 자정을 24로 주는 엔진 대응
    return {
      weekday: parts.weekday,
      minutes: hour * 60 + Number(parts.minute),
      dst: /EDT|GMT-4|GMT-04|UTC-4|UTC-04/.test(String(parts.timeZoneName || ''))
    };
  }

  // Intl의 timeZone을 못 쓰는 구형 WebView 폴백. 미국 서머타임은 3월 둘째 일요일
  // ~ 11월 첫째 일요일이라 월만으로도 대부분 맞고, 경계 달만 날짜를 따진다.
  function usDstFallback(date) {
    var d = date ? new Date(date.getTime()) : new Date();
    var month = d.getUTCMonth() + 1;
    if (month > 3 && month < 11) return true;
    if (month < 3 || month > 11) return false;
    var day = d.getUTCDate();
    return month === 3 ? day >= 8 : day < 8;
  }

  function us(date) {
    var clock;
    try {
      clock = nyClock(date);
    } catch (error) {
      clock = null;
    }
    var dst = clock ? clock.dst : usDstFallback(date);
    var windows = dst
      ? { pre: '17:00~22:30', regular: '22:30~05:00', after: '05:00~09:00' }
      : { pre: '18:00~23:30', regular: '23:30~06:00', after: '06:00~10:00' };
    var out = { phase: 'closed', open: false, label: '휴장', dst: dst, kst: windows };
    if (!clock) { out.label = '상태 확인 중'; out.phase = 'unknown'; return out; }
    if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return out;
    var m = clock.minutes;
    if (m >= M(9, 30) && m < M(16)) { out.phase = 'regular'; out.open = true; out.label = '정규장'; }
    else if (m >= M(4) && m < M(9, 30)) { out.phase = 'pre'; out.label = '프리마켓'; }
    else if (m >= M(16) && m < M(20)) { out.phase = 'after'; out.label = '애프터마켓'; }
    else { out.label = '장 마감'; }
    return out;
  }

  /* 미국 프리마켓이 열리는 KST 시각. 홈이 미국 화면으로 넘어가는 기준이다.
     서머타임이면 17:00, 표준시면 18:00 - 예전엔 17:00으로 박혀 있어 겨울에는
     한 시간 일찍 미국 화면으로 넘어갔다. */
  function usPreOpenKstMinutes(date) { return us(date).dst ? M(17) : M(18); }
  /* 금요일 애프터마켓이 끝나 주말 휴장이 시작되는 토요일 KST 시각(09:00 / 10:00). */
  function weekendStartKstMinutes(date) { return us(date).dst ? M(9) : M(10); }

  /* 주말 휴장 창: 토요일 미국 애프터마켓 종료 ~ 월요일 KOSPI 개장(09:00). */
  function isWeekendClosed(date) {
    var k = kst(date);
    if (k.day === 6) return k.minutes >= weekendStartKstMinutes(date);
    if (k.day === 0) return true;
    if (k.day === 1) return k.minutes < M(9);
    return false;
  }

  /* 홈이 어느 시장 화면을 보여줄지. 이 함수가 유일한 기준이다. */
  function homeMarket(date) {
    if (isWeekendClosed(date)) return 'closed';
    var k = kst(date);
    return (k.minutes >= usPreOpenKstMinutes(date) || k.minutes < M(9)) ? 'us' : 'domestic';
  }

  global.MarketHours = {
    KST_OFFSET_MS: KST_OFFSET_MS,
    kst: kst,
    isKrHoliday: isKrHoliday,
    isKrTradingDay: isKrTradingDay,
    isNightSessionHoliday: isNightSessionHoliday,
    krCash: krCash,
    krFutures: krFutures,
    us: us,
    usPreOpenKstMinutes: usPreOpenKstMinutes,
    weekendStartKstMinutes: weekendStartKstMinutes,
    isWeekendClosed: isWeekendClosed,
    homeMarket: homeMarket
  };
})(window);

(function () {
  'use strict';

  var SHELL = {
    /* 모바일 드로어 오버레이 + 검색 오버레이 + 스크롤탑 버튼 (position:fixed라 DOM 위치 무관) */
    mobileOverlays:
      '<div class="mobile-overlay" id="mobileOverlay"></div>' +
      '<div class="mobile-search-overlay" id="mobileSearchOverlay">' +
        '<div class="mso-inner">' +
          '<input type="text" class="mso-input" id="msoInput" ' +
            'placeholder="검색어를 입력하세요..." ' +
            'onkeypress="if(event.keyCode==13){ var q=this.value.trim(); if(q){ location.href=\'/search/\'+encodeURIComponent(q); } }" />' +
          '<button class="mso-close-btn" id="msoCloseBtn" aria-label="검색 닫기">✕</button>' +
        '</div>' +
        '<p class="mso-hint">Enter 키를 눌러 검색하세요</p>' +
      '</div>' +
      '<button class="scroll-top-btn" id="scrollTopBtn" aria-label="맨 위로">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>' +
      '</button>',

    /* 모바일 드로어 헤더 (데스크탑에선 숨김) */
    drawerHeader:
      '<div class="drawer-header" style="display:none;">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
        '<span class="drawer-header-title">Navigation</span>' +
      '</div>',

    /* 세부 카테고리 서브 필터 바 - skin-main.js가 채움 */
    subFilterBar:
      '<div class="sub-filter-bar" id="subFilterBar" style="display:none;"></div>',

    /* 사이트 하단 푸터의 링크 4종(이용약관/개인정보처리방침/오픈소스 라이선스/문의하기).
       이용약관·개인정보처리방침·오픈소스 라이선스는 티스토리 페이지가 아니라 이 저장소의
       legal/*.html 정적 페이지로 연결(2026-07-22 신설) - git push만으로 내용 수정 가능,
       티스토리 페이지 수동 생성 불필요. 문의하기는 mailto.
       바깥 <footer class="site-footer"> 래퍼는 skin.html에 직접 있음(카피라이트에 티스토리
       태그가 섞여있어 그 부분만은 git으로 못 옮기고, 같은 줄에 두려면 래퍼를 공유해야 함) -
       이 mount는 그 안의 링크 nav 자리(id="shell-footerLinks")만 채운다. */
    footerLinks:
      '<nav class="site-footer-links">' +
        '<a href="https://goodbyestarwars.github.io/tistory-ticker/legal/terms.html">서비스 이용약관</a>' +
        '<a href="https://goodbyestarwars.github.io/tistory-ticker/legal/privacy.html">개인정보처리방침</a>' +
        '<a href="https://goodbyestarwars.github.io/tistory-ticker/legal/opensource-license.html">오픈소스 라이선스</a>' +
        '<a href="mailto:goodbyestarwars@gmail.com">문의하기</a>' +
      '</nav>'
  };

  Object.keys(SHELL).forEach(function (key) {
    var mount = document.getElementById('shell-' + key);
    if (mount) mount.outerHTML = SHELL[key];
  });

  /*
   * 브랜드 아이콘 강제 적용 (2026-09-04).
   *
   * 브랜드 아이콘은 2026-08-17에 9bolt 번개(img/icon-9bolt-transparent.svg)에서
   * 심장박동기(img/heart-monitor.svg)로 바뀌었다. skin.html의 마크업은 이미 새 로고를
   * 가리키고 있는데도 탭 아이콘은 옛것이 계속 나왔다.
   *
   * 실측(2026-09-04, Actions 러너로 라이브 HTML 확인)한 원인: 티스토리가 <head>에
   * **자기 파비콘 link를 스킨보다 먼저** 세 개 넣는다.
   *   <link rel="icon" sizes="any" href=".../tistory_favicon_32x32.ico">
   *   <link rel="icon" type="image/svg+xml" href=".../bi-tistory-favicon.svg">
   *   <link rel="apple-touch-icon" href=".../tistory-apple-touch-favicon.png">
   * 스킨의 heart-monitor link는 그 뒤에 온다. 브라우저는 여러 후보 중 하나를 고르는데
   * 먼저 선언된 .ico(sizes="any")가 이기는 경우가 많고, 파비콘은 응답의 max-age(600초)와
   * 무관하게 별도 저장소에 오래 붙잡혀 재검증도 잘 안 한다.
   *
   * 앞선 수정(2026-09-04 1차)은 여기서 무력화됐다. querySelector('link[rel="icon"]')가
   * 문서 순서상 **티스토리의 .ico**를 집어오고, 그 href에는 heart-monitor.svg가 없으니
   * 버전 함수가 null을 돌려주고 그대로 return - 파비콘을 건드리지도 못했다.
   *
   * 그래서 href를 고치는 대신 **경쟁하는 icon link를 전부 걷어내고 우리 것 하나만
   * 마지막에 새로 넣는다.** URL도 DOM에 있던 값을 손보는 게 아니라 상수에서 만든다 -
   * 라이브 skin.html의 link가 낡았거나 없어도 결과가 같아야 한다.
   * skin.html은 티스토리 관리자에서만 고칠 수 있으므로 런타임에서 해결한다.
   *
   * apple-touch-icon(홈 화면 추가용)도 2026-09-05부터 함께 바꾼다. iOS는 SVG를 안 받아서
   * 한동안 티스토리 기본 "T"가 그대로 나갔는데(지우기만 하면 페이지 스크린샷으로 떨어져
   * 더 나빠진다), 같은 흑백 마크를 180x180 PNG(img/apple-touch-icon.png)로 굽고 그걸
   * 가리키게 했다. 홈 화면 아이콘은 iOS가 모서리를 깎으므로 여백을 넉넉히 두고 구웠다.
   *
   * LOGO_VERSION 값은 로고가 바뀐 날짜다. 로고를 또 교체할 때만 올린다.
   */
  var LOGO_VERSION = '20260905-banner-v2';
  var LOGO_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/';
  // 탭 아이콘은 전용 64x64(5.7KB)를 쓴다. 네비 배경용 128x128(18.9KB)을 그대로 쓰면
  // 그게 다 내려오기 전까지 브라우저가 옛 아이콘을 계속 띄운다 - 사용자가 본 "구버전
  // 로고가 0.5초 먼저 뜬다"가 이 다운로드 시간이다. 작을수록 교체가 빨라진다.
  var LOGO_URL = LOGO_BASE + 'favicon.png?v=' + LOGO_VERSION;
  var TOUCH_ICON_URL = LOGO_BASE + 'apple-touch-icon.png?v=' + LOGO_VERSION;

  function refreshBrandIcon() {
    // 2026-09-05: 네비 로고는 여기서 손대지 않는다. <img src>를 갈아끼우면 skin.html이
    // 박아둔 이미지가 먼저 그려졌다가 바뀌며 깜빡이는데, 그 skin.html은 티스토리
    // 관리자에만 있어 우리가 고칠 수 없다. 그래서 로고는 style.css의 .nav-logo-emblem
    // 배경으로 옮겼다 - CSS는 <head>에서 오므로 첫 페인트부터 확정이고 교체가 없다.
    // 파비콘과 홈 화면 아이콘은 CSS로 못 하므로 아래에서 계속 여기서 처리한다.

    // rel~="icon"은 rel="icon"과 rel="shortcut icon"만 잡는다(공백으로 나뉜 단어 단위
    // 비교라 "apple-touch-icon"은 "icon"과 다른 단어다). 홈 화면 아이콘은 아래에서 따로.
    var links = document.querySelectorAll('link[rel~="icon"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].parentNode) links[i].parentNode.removeChild(links[i]);
    }
    var icon = document.createElement('link');
    icon.setAttribute('rel', 'icon');
    icon.setAttribute('type', 'image/png');
    icon.setAttribute('href', LOGO_URL);
    document.head.appendChild(icon);

    // 홈 화면 추가 아이콘도 같은 방식으로 갈아끼운다. 티스토리가 자기 것을 먼저 넣어둬서
    // href만 고치는 걸로는 안 되고, 있는 것을 걷어낸 뒤 우리 것 하나만 남겨야 한다.
    var touchLinks = document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]');
    for (var t = 0; t < touchLinks.length; t++) {
      if (touchLinks[t].parentNode) touchLinks[t].parentNode.removeChild(touchLinks[t]);
    }
    var touch = document.createElement('link');
    touch.setAttribute('rel', 'apple-touch-icon');
    touch.setAttribute('sizes', '180x180');
    touch.setAttribute('href', TOUCH_ICON_URL);
    document.head.appendChild(touch);
  }

  refreshBrandIcon();

  /*
   * Tistory's manager link and this site's Google account are different
   * authentication realms. Keep the original manager URL, but let the gear
   * button choose between Tistory/Kakao administration and Google services.
   */
  function initAccountLoginChooser() {
    var manageLink = document.querySelector('.nav-manage-btn');
    if (!manageLink || manageLink.getAttribute('data-account-login-ready') === '1') return;
    manageLink.setAttribute('data-account-login-ready', '1');

    var managerUrl = manageLink.href;
    var googleStartUrl = 'https://goodbyestar.cloud/auth/google/start';
    var googleMeUrl = 'https://goodbyestar.cloud/auth/google/me';
    var modal = document.createElement('div');
    modal.className = 'account-login-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="account-login-backdrop" data-account-action="close">' +
        '<section class="account-login-dialog" role="dialog" aria-modal="true" aria-labelledby="accountLoginTitle" aria-describedby="accountLoginDescription">' +
          '<button type="button" class="account-login-close" data-account-action="close" aria-label="로그인 선택 닫기">×</button>' +
          '<div class="account-login-heading">' +
            '<span class="account-login-eyebrow">ACCOUNT</span>' +
            '<h2 id="accountLoginTitle">어디에 로그인할까요?</h2>' +
            '<p id="accountLoginDescription">블로그 관리와 서비스 이용은 서로 다른 계정으로 안전하게 운영됩니다.</p>' +
          '</div>' +
          '<div class="account-login-options">' +
            '<a class="account-login-option account-login-tistory" data-account-action="tistory" href="#">' +
              '<span class="account-login-option-icon account-login-kakao-icon" aria-hidden="true">●</span>' +
              '<span class="account-login-option-copy"><strong>블로그 관리</strong><small>카카오 · Tistory 관리자</small></span>' +
              '<span class="account-login-option-arrow" aria-hidden="true">→</span>' +
            '</a>' +
            '<button type="button" class="account-login-option account-login-google" data-account-action="google">' +
              '<span class="account-login-option-icon account-login-google-icon" aria-hidden="true">G</span>' +
              '<span class="account-login-option-copy"><strong>서비스 이용</strong><small>Google · 관심종목과 분석</small></span>' +
              '<span class="account-login-option-arrow" aria-hidden="true">→</span>' +
            '</button>' +
          '</div>' +
          '<div class="account-login-google-status" aria-live="polite">Google 계정 상태를 확인하고 있습니다.</div>' +
          '<div class="account-login-footer"><span>두 로그인은 동시에 유지되며 서로의 권한에 영향을 주지 않습니다.</span></div>' +
        '</section>' +
      '</div>';
    document.body.appendChild(modal);

    var googleStatus = modal.querySelector('.account-login-google-status');
    var googleOption = modal.querySelector('.account-login-google');
    var tistoryOption = modal.querySelector('.account-login-tistory');

    tistoryOption.href = managerUrl;

    function updateGoogleStatus() {
      return fetch(googleMeUrl, { credentials: 'include', cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('Google auth status ' + response.status);
          return response.json();
        })
        .then(function (body) {
          var data = body && body.data ? body.data : {};
          if (data.authenticated) {
            googleStatus.textContent = '현재 Google 로그인: ' + (data.email || '로그인된 계정');
            googleOption.querySelector('strong').textContent = 'Google 계정으로 계속하기';
          } else {
            googleStatus.textContent = 'Google로 로그인하면 관심종목과 서비스 설정이 계정별로 저장됩니다.';
            googleOption.querySelector('strong').textContent = 'Google로 로그인';
          }
          return data;
        })
        .catch(function () {
          googleStatus.textContent = 'Google 로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.';
          googleOption.querySelector('strong').textContent = 'Google로 로그인';
          return null;
        });
    }

    function openModal() {
      modal.hidden = false;
      document.body.classList.add('account-login-open');
      updateGoogleStatus();
      window.setTimeout(function () {
        var closeButton = modal.querySelector('.account-login-close');
        if (closeButton) closeButton.focus();
      }, 0);
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove('account-login-open');
      manageLink.focus();
    }

    manageLink.addEventListener('click', function (event) {
      event.preventDefault();
      openModal();
    });

    modal.addEventListener('click', function (event) {
      var actionEl = event.target.closest('[data-account-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-account-action');
      if (action === 'close') {
        event.preventDefault();
        closeModal();
      } else if (action === 'google') {
        event.preventDefault();
        window.location.href = googleStartUrl + '?return_to=' + encodeURIComponent(window.location.href);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  /*
   * 글쓰기 화면은 Tistory/Kakao 인증 리다이렉트를 거쳐야 하므로
   * openArticleModal()의 iframe 안에서 열면 안 된다. 기존에 배포된 skin.html에
   * 남아 있는 onclick도 제거하고, 항상 최상위 창에서 관리자 글쓰기 주소로
   * 이동시켜 로그인 화면이 정상적으로 이어지게 한다.
   */
  function initWriteButton() {
    var writeLink = document.querySelector('.nav-write-btn');
    if (!writeLink || writeLink.getAttribute('data-write-auth-ready') === '1') return;

    var writeUrl = writeLink.getAttribute('href') || '';
    if (!writeUrl || /^javascript:/i.test(writeUrl)) {
      var manageLink = document.querySelector('.nav-manage-btn');
      var managerUrl = manageLink && manageLink.href ? manageLink.href : '';
      writeUrl = managerUrl.replace(/\/manage\/?(?:#.*)?$/, '/manage/newpost/');
    }
    if (!writeUrl || /^javascript:/i.test(writeUrl)) return;

    writeLink.setAttribute('href', writeUrl);
    writeLink.removeAttribute('onclick');
    writeLink.setAttribute('data-write-auth-ready', '1');
    writeLink.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      (window.top || window).location.href = writeUrl;
    }, true);
  }

  function initShellAuthLinks() {
    initWriteButton();
    initAccountLoginChooser();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShellAuthLinks);
  } else {
    initShellAuthLinks();
  }
})();
