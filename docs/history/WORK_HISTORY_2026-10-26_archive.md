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

**2026-10-24 뉴스 기사 제목 가독성(마루부리 유지, 크기·행간·색)**

사용자 지적(주요 뉴스·경제 종합뉴스 제목이 가늘게 뭉개져 보임, 애플 스토어와 비교). 원인: 기사 제목만 마루부리 Regular 14px(2026-10 지정 `경제 종합뉴스 기사 제목만 Regular`)라 획이 가늘다. `style.css` 끝: 같은 선택자(`.home-economic-news …`, `#main-news .mn-row-title`)의 제목을 글꼴은 그대로 15px·행간 1.55·짙은 글자색(다크는 `--dk-text`)·`antialiased`로. 글꼴 자체를 Pretendard로 바꾸는 안은 하지 않았다(기존 지정 존중, 필요하면 한 줄로 전환 가능). 미확인: 실제 화면에서 체감. 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 휴장 대시보드 마켓브리핑을 장중 화면과 같은 가로 캐러셀 카드로**

사용자 지시(스크린샷: 장중 화면=가로 넘김 카드가 정상, 휴장 화면=2열 목록). 원인: 휴장이면 브리핑 섹션이 위젯 격자 밖(주간 리포트 아래)으로 옮겨져 `.home-editorial-page .briefing-carousel-track …` 규칙이 닿지 않고 `.home-widget--full .home-briefing-grid` 2열 격자로 풀렸다. `style.css` 끝: 휴장 조건(`body:has(.home-editorial-page.is-market-closed) .home-briefing-section`)으로 같은 트랙(`display:flex; overflow-x:auto; gap`)·카드 크기(PC 342×414px, 모바일 화면폭-72px×430px)를 다시 건다(레이어 안, 카드 테두리·배경은 앞선 휴장 카드 규칙). 글 내용·장중 화면 불변. 미확인: 휴장 화면 실렌더(토요일 휴장 창 안에서 확인 필요, 캐러셀 이동 버튼·진행바 동작은 기존 JS). 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 사이트 공통 UI 치수·표 면·송골매 투명 원본 통일**

사용자 전체 UI 통일 지시. `style.css` 기존 np/np.np 규칙을 직접 수정해 카드 14px·내부 9px·패딩 18/14px·간격 10px·섹션 20/16px·UI 제목 Pretendard 600·24/22px 및 17px 토큰을 정의했다. 홈 미국/국내 시장과 뉴스의 두 칸은 각각 카드 역할을 유지하며 같은 면·테두리·패딩을 사용하고, 휴장·브리핑·주간 리포트·검색기·종목분석 등 공통 카드에 치수를 연결했다. 휴장 브리핑은 실제 DOM에서 `.is-market-closed`의 자손이 아닌 형제여서 기존 규칙이 닿지 않았음: body:has로 상태를 확인하도록 선택자를 수정했다. `indicator-board.css`의 헤더/본문 색 충돌을 부품 안에서 해결(다크 헤더 panel·본문 card·선택 active·호버 hover, 이름 셀 배경은 행 상속), 모바일 전 열·차트 연동 유지. `market-indicators.css`의 과도한 60/42px 섹션 간격은 공통 토큰으로, `domestic-market-indicators.css`의 모바일 차트 그리드 자동 최소폭 넘침은 min-width:0/minmax(0,1fr)로 수정. 관심종목 UI 글꼴·제목·그림자 정리. 새 다크 색상·금융 API/계산/갱신/인증/저장 변경 없음.

로고: 기존 `img/falcon-logo-source.webp`에 실제 alpha가 있어 그대로 재사용. 헤더는 종전 CSS 배경의 불투명 brand-banner 대신 투명 원본 머리 크롭(비율 유지, 배경 마스킹 없음), PC·모바일 공통. `skin-shell.js` 푸터도 동일 원본을 contain으로 표시. 이미지 생성·원본 변조 없음. favicon/터치 아이콘 정책 보존. `skin.html` 변경 없음, 관리자 수동 반영 불필요.

검증: 운영 DOM에 후보 CSS를 같은 위치로 치환해 미국·휴장 375/390/768/1440px 라이트·다크 및 증시자금 4폭 다크·PC 라이트를 확인, computed style 카드 #202731/14px, 표 #202731·헤더 #272f3a, 증시자금 본문 폭=scrollWidth 확인. 표 고객예탁금 선택→차트 제목 변경 확인. 증시온도·검색기·종목분석·캘린더 PC/375px 스모크. 로컬 전후 캡처 보관. `test_domestic_layout`·`test_watchlist_drawer_first_paint` 12 pass, 미국 세션 5 pass, `node --check js/skin-shell.js`·diff check 통과. `test_ui_ia`는 변경 전 HEAD에서 38 failed/140 passed/37 subtests를 재현; 의도된 로고 경로·간격 계약만 갱신한 변경 후 동일 38 failed(합산 152 passed/37 subtests), 신규 실패 없음. `test_indicator_board.js`는 변경 전과 같은 탭 CSS 로더 수 기대 4/실제 5의 기존 실패라 별도 기록.

미확인/기존 문제: 사용자 언급 첨부 3장은 대화에 없어서 운영 화면을 기준으로 비교했다. 관심종목은 사이트 계정 비로그인 상태여서 서랍·로그인/빈 상태만 확인(저장·로그인 실행 안 함). 일부 티스토리 페이지 모바일에서 외부 광고 iframe 1200px가 문서 전체를 넘침(9Pay 위젯 본문은 정상), 티스토리 common.js `$ is not a function` 기존 오류가 남음. 차트 모바일→PC 리사이즈 직후 일시적 작은 SVG는 재로딩 후 추가 관찰 필요. 배포 경로는 master의 style.css/css/js → GitHub Pages, VM/GAS 및 티스토리 마크업 변경 없음.

배포 완료 확인: 소스 커밋 5e8ea43d의 Pages build= built/error=null. 공개 style.css·indicator-board.css·market-temp.css·skin-shell.js 응답이 커밋 Git blob과 바이트 일치. 임시 preview CSS 0개인 운영 화면에서 홈 4폭 가로 넘침 없음, 주요 4페이지 본문 폭/scrollWidth 일치 및 제목 PC 24px/모바일 22px·증시온도 카드 14px·투명 송골매 URL을 재확인했다. 티스토리 마크업 수동 조치 없음.
