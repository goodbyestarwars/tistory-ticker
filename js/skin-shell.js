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
   * apple-touch-icon(홈 화면 추가용)은 손대지 않는다. iOS는 SVG를 받지 않는데 정사각형
   * PNG 로고 자산이 아직 없다 - 티스토리 기본값을 지우기만 하면 스크린샷으로 떨어져서
   * 지금보다 나빠진다.
   *
   * LOGO_VERSION 값은 로고가 바뀐 날짜다. 로고를 또 교체할 때만 올린다.
   */
  var LOGO_VERSION = '20260817-heart-monitor';
  var LOGO_URL = 'https://goodbyestarwars.github.io/tistory-ticker/img/heart-monitor.svg?v=' + LOGO_VERSION;

  function refreshBrandIcon() {
    var image = document.querySelector('.nav-logo-image');
    if (image && image.getAttribute('src') !== LOGO_URL) image.setAttribute('src', LOGO_URL);

    // rel~="icon"은 rel="icon"과 rel="shortcut icon"을 잡고 apple-touch-icon은 건드리지
    // 않는다(공백으로 나뉜 단어 단위 비교라 "apple-touch-icon"은 "icon"과 다른 단어다).
    var links = document.querySelectorAll('link[rel~="icon"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].parentNode) links[i].parentNode.removeChild(links[i]);
    }
    var icon = document.createElement('link');
    icon.setAttribute('rel', 'icon');
    icon.setAttribute('type', 'image/svg+xml');
    icon.setAttribute('href', LOGO_URL);
    document.head.appendChild(icon);
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
