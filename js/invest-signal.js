/**
 * 오늘의 투자시그널 페이지 -> 종목분석 페이지 리다이렉트
 *
 * 2026-07-20: 작업지시서(투자시그널 → 종목분석 통합)에 따라 이 페이지의 기능(등급 카운트 +
 * 가중치 탭 랭킹)이 전부 종목분석 페이지(js/foreign-flow.js) 상단으로 흡수됨. 별도 페이지를
 * 새로 만들지 않고 이 파일 자체를 리다이렉트 스크립트로 교체함(파일명 버저닝 금지 규칙 -
 * skin.html/사이드바 메뉴가 이미 이 파일을 로드하도록 박혀 있어 URL을 그대로 재사용).
 * 원래 등급/랭킹 로직은 js/foreign-flow.js로 이전됨 - 되돌릴 일이 생기면 git history 참고.
 */
(function (global) {
  'use strict';

  var STOCK_ANALYSIS_URL = 'https://ghlee.tistory.com/page/foreign-flow';

  if (document.querySelector('#invest-signal')) {
    location.replace(STOCK_ANALYSIS_URL);
  }
})(window);
