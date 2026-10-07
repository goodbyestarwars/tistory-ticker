# 글로벌 시장지표 해석과 휴장 지표

2026-10-07: `js/overnight-market.js`, `css/overnight-market.css`, `js/us-macro-indicators.js`, `css/us-macro-indicators.css`.

- 바이낸스 국내주식 토큰은 휴장 홈과 같은 삼성전자·SK하이닉스·현대차·삼성전기·한미반도체·LG전자·NAVER·KODEX 200의 8종목이다. 가격·24시간 등락·마크가격·펀딩비를 방문자 브라우저에서 직접 조회한다. 홈의 금요일 이후 등락과 글로벌 카드의 24시간 등락은 기준이 다르므로 카드에 24시간을 유지한다. 실제 국내 주식 가격/수급으로 취급하지 않는다.
- 기존 타이머를 30초로 변경. 문서 또는 상위 패널이 숨겨지면 주기 조회를 쉰다. 48시간 미니차트는 기존 30분 캐시를 재사용. 지역 제한 시 기존 VM 폴백 유지. VM 수집 종목·타이머·DB 변경 없음.
- 토큰 그리드는 PC 4열, 1600px 이상 5열, 1000px 이하 2열, 480px 이하 1열이다.
- BTC·ETH는 기존 원화 가격과 365일 차트/평균 자료를 재사용한다. 차트 높이 164px, 주황 52주·보라 6개월 평균 라벨, 두 평균을 포함하는 자동 가격 범위, 원화 축의 억/만 표기. 평균값과 `(현재가 / 평균 - 1) × 100`을 아래에 별도 표시한다. 평균은 기간 종가의 실측 평균이며 적정가나 미래 수익률을 뜻하지 않는다.
- 경제 발표 10개 카드에 높으면·낮으면·좋은 흐름 설명 추가. 물가는 지수 수준 대신 상승률, 고용은 증감·수정값, 소매판매는 물가 미조정 금액이라는 점을 구분한다. 연준 2% 목표는 전체 PCE 기준이다. 경기 위축과 물가 완화를 구분하며 예상치 차이·수정값도 확인하도록 안내한다. 설명은 조건부 교육 문구이며 수치를 기반으로 자동 매수/매도 판정을 내리지 않는다.

해설 참고 원문:

2026-10-08 캘린더에도 공시 완료와 분리된 미국 경제 데이터 결과 영역을 추가했다. 주요 미국 발표의 10지표 렌더러와 단일 진행 요청·30분 브라우저 캐시를 공유하며, 수동 결과 갱신은 캐시를 우회한다. 기존 `/futures?interval=day&days=500&symbols=...` 자료만 재사용하고 새 VM 수집·DB·타이머는 없다. 달력 선택 날짜의 과거 속보값과 연결하지 않고 **최신 확인값**으로 표시한다. 통계 기준 월/분기와 자료 수집 시각(KST)을 구분하며 수정값 반영 가능·예상치 미제공을 안내한다. 날짜·월 선택과 공시 검색은 결과 카드를 유지한다. 기존 캘린더 15분 타이머에서 캐시 만료만 확인한다. 실패 시 기존 성공 결과를 유지하고 실패 표시·재시도를 제공한다. 누락값은 0으로 바꾸지 않는다.

- [BLS CPI 정의·다른 물가지표와 차이](https://www.bls.gov/cpi/questions-and-answers.htm)
- [BLS PPI 정의](https://www.bls.gov/ppi/overview.htm)
- [연준 목표·물가와 고용](https://www.federalreserve.gov/monetarypolicy/monetary-policy-what-are-its-goals-how-does-it-work.htm)
- [Census 소매판매: 물가 변화 미조정](https://www.census.gov/retail/marts/www/timeseries.html)
- [BEA 실질 GDP](https://bea.gov/data/gdp/gross-domestic-product)
- [BLS JOLTS](https://www.bls.gov/jlt/)
- [미시간대 소비자심리](https://www.sca.isr.umich.edu/)

검증: `node test/test_global_indicator_context.js`, 관련 `test/test_ui_ia.py` 5건, JS 문법·diff. 실제 API의 BTC/ETH 365일 차트와 365/180일 평균 응답 확인. 브라우저에서 실제 Lightweight Charts로 평균 라벨·가격 범위와 PC 1920px 5열/1280px 4열·모바일390px 1열/가로 넘침 없음 확인. 토큰 배치 QA는 별도로 명시한 테스트 가격을 사용했다.
