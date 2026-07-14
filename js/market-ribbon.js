/**
 * 상단 지수/환율/코인 리본 - 2026-07-16부로 기능 이전됨
 *
 * "코스피/코스닥/원달러/BTC 고정 노출"을 사용자 선택형(+)으로 바꿨다가(2026-07-15),
 * 실사용 확인 결과 "카드를 공시 밑/공지사항 위쪽에 간밤 시황처럼 보여달라"는 피드백을 받아
 * 그 기능 전체(선택 UI + 카드 렌더링)를 js/quick-indices.js로 옮겼다.
 *
 * 이 `.market-ribbon` 바(고정 32px, top:0)는 style.css 전역에 top offset이 하드코딩돼
 * 있어(.navbar top:32px, .disc-ticker top:88px, .page-wrap padding-top:88px, 사이드바
 * top:108px 등) 통째로 없애면 사이트 전체 레이아웃이 밀리거나 빈 공백이 생긴다. 그래서
 * 컨테이너 자체(위치·높이)는 남겨두되 내용은 비워둔다 - 화면엔 얇은 여백 바로만 보인다.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#market-ribbon';

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '';
  }

  var MarketRibbon = { init: init };
  global.MarketRibbon = MarketRibbon;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
