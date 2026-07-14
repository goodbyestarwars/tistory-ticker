/**
 * 상단 지수/환율/코인 리본 - 2026-07-16부로 완전히 폐기됨
 *
 * "코스피/코스닥/원달러/BTC 고정 노출"을 사용자 선택형(+)으로 바꿨다가(2026-07-15),
 * 실사용 확인 결과 "카드를 공시 밑에 간밤 시황처럼 보여달라"는 피드백을 받아 그 기능
 * 전체(선택 UI + 카드 렌더링)를 js/quick-indices.js로 옮겼다. 처음엔 이 `.market-ribbon`
 * 바(고정 32px)를 완전히 없애면 style.css에 하드코딩된 top offset들이 다 밀린다고 보고
 * 컨테이너만 남기고 비워뒀는데, 그 결과 navbar 위에 정체불명의 검은 띠가 남는다는 피드백을
 * 받아 style.css의 offset들을 전부 32px씩 당겨서 이 바 자체를 완전히 없앴다
 * (.navbar top:0, .disc-ticker top:56px 등 - style.css 상단 :root 주석 참고).
 * 이제 이 컨테이너는 display:none으로 완전히 숨긴다 - skin.html의 #market-ribbon div
 * 자체는 git 밖(스킨 편집기)이라 지울 수 없어 빈 채로 남겨둔다.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#market-ribbon';

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.style.display = 'none';
  }

  var MarketRibbon = { init: init };
  global.MarketRibbon = MarketRibbon;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
