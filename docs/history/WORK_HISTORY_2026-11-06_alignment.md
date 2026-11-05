**2026-11-04 미국 시장 카드에 필라델피아 반도체(SOX) 추가**

요청: S&P 500·나스닥 거래량 게이지에 필라델피아 반도체도. 변경: `scripts/cloud-vm/us_market_breadth.py` 지수 목록에 `SOX`=`NASDAQ:SOX`(TradingView 스캐너, 라이브 확인: 30종목 전부 거래량·평균 대비 값 있음, `CBOE:SOX`는 0건), 갱신당 외부 요청 2→3회·기존 2분 캐시 유지. `js/skin-main.js` 거래량 게이지·상승/하락 막대 행에 SOX 추가(시장 방향 계산은 S&P 500·나스닥 종합 두 지수만 유지), `css/home-market-board.css` 게이지 3개일 때만 칸 폭 116→176px(국내 2개는 그대로). 검증: `test_us_market_breadth` 14건·`test_market_participation*.js` 통과, 라이브 페이지에 CSS 주입해 3칸 폭 176px 확인. 미확인: 서버 반영 후 실제 SOX 값, PC/모바일 실화면. 배포: master → Pages·VM 자동 배포.

**2026-11-04 의회 거래 공식 링크를 검색 화면으로**

요청: 하원 공식 링크가 안내문만 있는 화면이라 어떻게 보는지 모르겠음. 변경: `js/us-stocks.js` 링크를 `ViewReport`(안내 페이지)에서 `ViewSearch`(성·연도 검색, 200 응답·LastName 입력 확인)로, 문구를 "미 하원 공식 신고 검색 · 의원 성·연도로 검색 → 거래 보고서(PDF) 원문"으로. 미확인: 운영 화면 클릭·검색 화면 렌더. 배포: master → Pages.

