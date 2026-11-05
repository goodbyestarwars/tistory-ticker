**2026-11-04 내부자 공시 내역을 모달로**

요청: "내부자 공시 내역 (176건)"을 모달로. 변경: `js/us-stocks.js` 카드 안 접이식 목록(`<details>`)을 "내부자 공시 내역 (N건) 보기" 버튼으로 바꾸고 클릭 시 모달(`openInsiderModal`, 바깥 클릭·✕·Esc 닫기, 내용·SEC 원문 링크·완전성 안내 유지), `css/us-stocks.css` `.us-modal*`(공통 면 토큰, 다크·모바일). 검증: 구문 검사, `test_us_orderbook_refresh` 통과. 미확인: 운영 화면 클릭·모달 렌더(PC/모바일/다크). 배포: master → Pages.

