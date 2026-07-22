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

    /* 사이트 하단 푸터: 표준 4종 링크(이용약관/개인정보처리방침/오픈소스 라이선스/문의하기).
       이용약관·개인정보처리방침·오픈소스 라이선스는 티스토리 페이지가 아니라 이 저장소의
       legal/*.html 정적 페이지로 연결(2026-07-22 신설) - git push만으로 내용 수정 가능,
       티스토리 페이지 수동 생성 불필요. 문의하기는 mailto. */
    footer:
      '<footer class="site-footer">' +
        '<nav class="site-footer-links">' +
          '<a href="https://goodbyestarwars.github.io/tistory-ticker/legal/terms.html">서비스 이용약관</a>' +
          '<a href="https://goodbyestarwars.github.io/tistory-ticker/legal/privacy.html">개인정보처리방침</a>' +
          '<a href="https://goodbyestarwars.github.io/tistory-ticker/legal/opensource-license.html">오픈소스 라이선스</a>' +
          '<a href="mailto:goodbyestarwars@gmail.com">문의하기</a>' +
        '</nav>' +
      '</footer>'
  };

  Object.keys(SHELL).forEach(function (key) {
    var mount = document.getElementById('shell-' + key);
    if (mount) mount.outerHTML = SHELL[key];
  });
})();
