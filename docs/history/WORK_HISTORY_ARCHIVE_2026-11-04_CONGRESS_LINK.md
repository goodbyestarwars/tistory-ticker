**2026-11-04 의회 거래 링크: 하원 공식 → Capitol Trades 검색**

요청: 하원 공식 자료는 원천 데이터라 쓰기 어렵고 종목별 매칭 필요. 변경: `js/us-stocks.js` `renderCongressLinks`에서 하원 공식 링크를 `capitoltrades.com/issuers?search=티커`로 교체(검색 결과가 종목 1건, TSLA→435211 등 4종목 확인; 번호는 내부 ID라 티커로 직접 못 만듦). Quiver 종목 링크는 유지. 미확인: 운영 화면 클릭. 배포: master → Pages.

