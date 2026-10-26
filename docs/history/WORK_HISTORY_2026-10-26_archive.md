**2026-10-24 휴장 화면 마켓브리핑을 카드형으로**

사용자 지시(휴장 대시보드의 마켓브리핑이 카드형이 아니다, 한국증시·미국증시 대시보드와 같게). `style.css` 끝: 휴장(`.is-market-closed`)일 때 `.home-briefing-section .home-briefing-card`에 카드 테두리·둥근 모서리 20px·카드 배경·안쪽 여백·옅은 그림자(다크는 `--dk-card`·`--dk-line`)를 적용. 2열 배치·글 내용·장중 화면(캐러셀 카드)은 불변. 미확인: 휴장 화면 실제 렌더(작성 시점 토요일 09:00 전이라 휴장 탭을 직접 못 봤고, `.is-market-closed`가 브리핑 카드의 조상에 붙는지는 코드 추정) - 반영 후 휴장 화면에서 확인 필요. 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 `항목을 눌러 추이 보기` 문구 삭제**

사용자 지시. `js/market-temp.js` `buildSummaryCard`의 `시장 한눈에` 제목 오른쪽 안내 문구만 삭제(동작 불변). 대표 지수 흐름 간격·면책 문구 오른쪽 정렬은 #951. 미확인: 운영 화면. 배포: js master 머지 후 Pages 자동.

**2026-10-24 대표 지수 흐름 간격·면책 문구 정렬**

사용자 지시. `css/market-temp.css` 끝 블록: `대표 지수 흐름`(`.mt-index-flow`) 위 간격 +32px(업종 로테이션 카드에서 띄움), `참고용 일반 시황 코멘트이며 투자 권유가 아닙니다.`(`.mt-page-disclaimer`)는 오른쪽 정렬. 미확인: 운영 화면. 배포: css master 머지 후 Pages 자동.

**2026-10-24 시장 한눈에 헤드라인 글자 2px 축소**

사용자 지시. `css/market-temp.css` 끝 블록: `.mt-front-headline`("하락 종목 …개, 내림세 우세") 글자 PC 18px→16px, 모바일(760px 이하) 17px→15px. 미확인: 운영 화면(실제 적용 크기는 브라우저에서 확인 필요). 배포: css master 머지 후 Pages 자동.

**2026-10-24 시장 한눈에 5개 칸 높이 소폭 확대**

사용자 지시. `css/market-temp.css` 끝 블록: 코스피 거래량·코스닥 거래량·빚투·예탁금·코스피200 주간선물 칸(`data-market-metric`)만 최소 높이 58px·위아래 패딩 11px로 약 10px 키움(글자·내용 불변, 다른 칸 불변). 미확인: 운영 화면. 배포: css master 머지 후 Pages 자동.

이전 기록: [2026-10-18~10-24 보관본](history/WORK_HISTORY_2026-10-18_2026-10-24_archive.md).

**2026-10-24 홈 시장 헤더 부제 왼쪽 정렬**

사용자 지시(`미국 지수선물(CME) 거래중 · 현물 지수와 값이 다름(현물 본장 마감)`). `css/home-market-board.css`의 `#hmbUpdated`(제목 아래 부제·갱신 시각)를 `margin-left:auto; text-align:right`에서 `margin-left:0; text-align:left`로 바꿔 제목과 같은 왼쪽 줄에 맞춤(국내·미국 공통, 오른쪽 상태 `나스닥100 · S&P500 선물(CME)`는 그대로). 미확인: 홈 화면. 배포: css master 머지 후 Pages 자동.

**2026-10-24 홈 대시보드: 국내 `증시온도` 줄 삭제 · 미국 상승 종목 비율 옆 막대**

사용자 지시(스크린샷). `js/skin-main.js`: 국내 시장 탭의 `증시온도 23점 공포` 줄(`.hmb2-temp`)을 숨김(미국 탭은 상승 종목 비율 줄 유지, 미국 개장 전·마감·휴장은 기존대로 숨김). 미국 장중에는 `renderUsMarketSummary`가 상승 종목 비율 옆에 120px 가로 막대(상승=`--num-up` 붉은색, 나머지=`--num-down` 푸른색, 툴팁에 비율)를 그리고 장이 닫히면 숨긴다. `css/home-market-board.css`: 막대 스타일. 증시온도 데이터·계산·증시온도 페이지는 불변. `test_home_us_session_single_status.js`의 국내 복귀 기대값을 `숨김`으로 변경(통과). 기존 실패(test_home_chart_history·investor_chart)는 변경 전부터. 미확인: 홈 화면 실제 렌더(미국 장중 막대는 장이 열린 시간에만 보임). 배포: js/css master 머지 후 Pages 자동.


**2026-10-24 미국 종목 요약 카드 시간외 안내 정렬**

사용자 지적(스크린샷: 스페이스X, 애프터마켓). `js/us-stocks.js` embedded 요약 카드의 `data-us-session-comparison`(`정규장 종가 … · 시간외 등락은 정규장 종가 대비`)이 `#stock-search .ss-summary`의 2열 격자 오른쪽 칸에 끼어 헤더 옆에 어긋나 보였다. `css/stock-search.css` 끝에 규칙: 이 줄을 `grid-column:1/-1`로 헤더 아래 전체 폭 왼쪽 정렬 한 줄로(테두리·배경 없음, 12px). 아래 분석 카드 5칸·전일 종가 줄은 변경 없음. 미확인: 실제 화면(시간외 시간대에만 보임). 배포: css master 머지 후 Pages 자동.
