**2026-10-05 업종 로테이션을 홈에서 시장 > 증시온도로 이동**

사용자 요청. 홈 대시보드(`skin-main.js` 마크업·US 탭 토글·로더, `home-widgets.js` 배치)에서 제거하고 `js/market-temp.js`에 `buildRotationSlot_`/`mountRotation_`로 "오늘 돈이 몰린 섹터" 바로 아래·대표 지수 흐름 위에 배치. 홈의 한국/미국 탭이 없어져 기존 미국 업종 로테이션(`data-us`)은 구역 위 국내|미국 글자 탭으로 유지(`css/market-temp.css` 30-e). API·계산 변경 없음. 배포: GitHub Pages 자동.


이전 기록: [DCF 전종목 확장 시 이관](history/WORK_HISTORY_2026-10-09_DCF_full_universe_archive.md).
