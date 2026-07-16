/**
 * 9bolt 스킨 - 태그 없는 정적 UI 조각 (git 관리)
 * skin.html에는 빈 mount div(id="shell-*")만 남기고, 실제 마크업은 여기서 주입한다.
 * 목적: 이 조각들은 티스토리 서버 치환 태그([##_..._##], s_xxx)가 전혀 없어서
 * git push만으로 반영 가능 — skin.html 재배포(스킨 편집기 붙여넣기) 불필요.
 *
 * 반드시 skin-menu.js/skin-main.js보다 먼저 로드돼야 함 — 그 스크립트들이
 * mobileMenuBtn, scrollTopBtn, discTrack 등을 getElementById로 찾기 때문.
 *
 * 태그가 하나라도 섞인 블록(네비바 로고/검색창, 카테고리 데이터, 글 목록,
 * 방문자 통계, 공지/방명록/페이지네이션 등)은 여기로 옮길 수 없음 — skin.html에
 * 그대로 남아있어야 티스토리 서버가 치환해준다.
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

    /* KRX 공시 티커 껍데기 - 내용은 skin-main.js가 GAS에서 받아와 #discTrack에 채움 */
    discTicker:
      '<div class="disc-ticker" id="discTicker">' +
        '<div class="disc-badge">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '공시' +
        '</div>' +
        '<div class="disc-wrap">' +
          '<div class="disc-track" id="discTrack"><span class="disc-loading">공시 로딩 중...</span></div>' +
        '</div>' +
      '</div>',

    /* 모바일 드로어 헤더 (데스크탑에선 숨김) */
    drawerHeader:
      '<div class="drawer-header" style="display:none;">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
        '<span class="drawer-header-title">Navigation</span>' +
      '</div>',

    /* 세부 카테고리 서브 필터 바 - skin-main.js가 채움 */
    subFilterBar:
      '<div class="sub-filter-bar" id="subFilterBar" style="display:none;"></div>'
  };

  Object.keys(SHELL).forEach(function (key) {
    var mount = document.getElementById('shell-' + key);
    if (mount) mount.outerHTML = SHELL[key];
  });
})();
