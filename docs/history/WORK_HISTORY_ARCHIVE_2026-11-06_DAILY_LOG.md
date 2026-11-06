**2026-11-04 차트 추세선 재설계: 저점/고점 추세선 + 이탈·전환 판정**

요청: 박스 안 채널은 추세선이 아님, 허용 오차 안에서 일직선을 이탈하면 '추세 이탈'. 변경: `js/chart-wave-overlay.js`의 `channelOf/fitLine`을 `trendLinesOf`로 교체(상승=저점끼리 붉은색, 하락=고점끼리 파란색, 현재 봉까지 연장). 허용 오차 ATR14 기준(닿음 max(0.5ATR,1.5%), 이탈 max(1ATR,2.5%) 종가 2봉 연속), 닿음 3회↑ 실선·2회 점선, 이탈 라벨·추세 전환 라벨·이탈 후 옅은 점선. 파동 엔진·VM/API 변경 없음. 검증: `test/test_chart_studies.js`(추세선 시험으로 교체, 상승/하락/하루 이탈 무시/2봉 이탈/데이터 부족) 통과. 미확인: 실제 종목 일봉에서의 임계값 적합도·PC/모바일 실화면, `test_site_guide_chart.js`는 변경 전부터 실패(가이드 '2026년 10월 26일 업데이트' 문구). 갱신: UI_GUIDE·이용방법·릴리스 노트. 배포: master→Pages.

**2026-11-04 국내 시세 세션 표기 후속 적용(홈·관심종목·툴팁)**

목적: 정규장/애프터마켓·거래소 표기를 남은 화면에도 공통 함수로 적용. 변경: `krQuoteSession`에 `clockOnly` 옵션(시세 근거 없을 때 '애프터마켓 시간대'처럼 시간대만), `js/home-realtime-table.js` 제목이 이를 사용, `js/watchlist.js` 국내 카드 배지와 `js/ticker-tooltip-v5.js` 기준시각이 공급자 `market_state` 있을 때 같은 문구 사용. 시세·등락률 계산, WebSocket/REST, 호출량, 주문 로직 변경 없음. 검증: `test/test_kr_quote_session.js` 17건·`test_closed_countdown.js` 통과, 변경 JS node --check. 갱신: 이용방법·릴리스 노트. 미확인: 실화면 PC/모바일 줄바꿈(병합 후 확인). 배포: master→Pages(미머지).

**2026-11-04 운영센터 내역 보강: 번호·평단·추천 이유·기간 CSV**

요청: 주문 번호·시간·평단·보유수량, 추천 종목의 검색기·이유·추천 단가, 기간 선택 다운로드. 변경: 에이전트가 주문 순번(`no`)·보유 평단(보유수량을 채우는 최근 매수 주문가 가중평균 추정)·후보 선정 이유(`reasons`)·과거 후보 20거래일(30분마다)을 올리고, `autotrader_control.py` 허용 목록·history 유지·주문 상한 400, `main.py` 본문 상한 256KB. `js/auto-trader.js`: 번호 열, 보유 수량·평단가(추정), 검색기별 후보 표(점수·추천 단가·이유), 기간 선택 + 주문/추천 CSV(UTF-8 BOM). 한계: 장부가 주문 접수 기록뿐이라 주문별 체결가·평단·손익은 없고, 보유 평단은 주문가 기준 추정이다. 검증: `test/test_autotrader_control.py` 13건, 렌더·CSV 단위 확인, VM에서 에이전트 `activity()` 실측. 미확인: 로그인 상태 실제 화면. 배포: master→Oracle·Pages, 에이전트 autotrader-private main.

**2026-11-04 운영센터 주문 내역·보유·연구 후보 표시**

요청: 매매내역 표시, 최근 30건+더 보기, 텔레그램 추천 종목을 접는 리본으로. 변경: 에이전트(autotrader-private `control/control_agent.py`)가 장부 `live_orders.db`(최근 주문 200건·열린 보유)와 `research/research.db` 최신 후보를 읽기 전용으로 올린다(주문번호·상세·비고·계좌·잔고는 읽지 않음). `scripts/cloud-vm/autotrader_control.py`에 `sanitize_activity`(허용 필드만·행 수 상한)와 `/autotrader/status`의 `activity`(수신 중일 때만), `main.py` 동기화 본문 상한 64→128KB. `js/auto-trader.js`·`css/auto-trader.css`에 주문 표(30건+'더 보기' 접힘 유지)·보유 표·연구 후보 리본. 기존 죽은 `ordersHtml`은 데이터 모양이 달라 재사용하지 않았다. 검증: `test/test_autotrader_control.py` 12건, 렌더 단위 확인(30행+더 보기 5건), VM에서 `activity()` 9.8KB(주문 35·보유 1·후보 42) 실측. 미확인: 로그인 상태의 실제 화면. 제외: 체결가·손익(장부에 없음). 배포: master→Oracle·Pages, 에이전트는 autotrader-private main→VM 자동 반영.

**2026-11-04 국내 시세 세션·거래소 표기 공통 함수**

목적: 사용자가 보는 국내 가격이 정규장인지 애프터마켓인지, 어느 거래소 값인지 혼동하지 않게. 변경: `js/skin-shell.js`에 `MarketHours.krQuoteSession(quote)` 추가(공급자 `market_state`·`price_session`·`exchange` 근거로만 프리/애프터 표기, 네이버 NXT 시간외 값은 '애프터마켓 · NXT', 거래소 불명은 거래소 생략, 시계만으로 애프터 판정 안 함, 20:00 이후 '장 마감', 휴장), `js/foreign-flow.js` 종목 상세 `quoteStatusLabel`이 이를 사용. 시세·등락률 계산, WebSocket/REST, 호출량은 변경 없음. 검증: `test/test_kr_quote_session.js` 13건·`test_closed_countdown.js` 통과, `test_market_hours.py`는 Windows subprocess 오류 6건이 변경 전과 동일. 미적용: 홈 실시간 표 제목(시계 기반 세션명 유지)·관심종목 국내 행·티커 툴팁(세션 문구 없음, 후속). 갱신: 이용방법(`legal/guide.html`)·릴리스 노트. 배포: master→Pages.

**2026-11-04 미국 종목 거래량 기준 표기 · SPCX 마감 비교**

요청: 한투 거래량이 일봉보다 낮아 보이는 문제 확인. 비교(11/3 마감 후): 한투 71,164,835 = Yahoo 정규장 71,164,835, 토스 61.7M(약 13% 낮음, 다른 피드). 장중 차이(한투 39.9M·토스 47.5M·Yahoo 55.6M)는 소스별 반영 지연. 변경: `js/us-stocks.js` 거래량 옆에 '(마감 전 누적)'(장중)·'(정규장 누적)'(마감 후) 표기, 출처 교체 없음. 검증: node --check. 배포: master→Pages.
