**2026-10-05 미국장 업종 로테이션·주요 ETF 수익률**

사용자 요청. `scripts/cloud-vm/us_market_etf.py`(순수 함수): 섹터 ETF 11개를 SPY 대비로 국내판과 같은 분류기(`sector_rotation.classify_phase`)에 넣는다. ETF 하나가 업종이라 구성종목 Breadth가 없어 "ETF 종가가 자기 20일 평균 위"를 1/0으로 대신 넣고 화면에는 Breadth로 보여주지 않음. 히스테리시스는 저장 없이 하루 전 계산 상태로 적용. `GET /us-sector-rotation`·`GET /us-etf-returns`(15분 캐시, 일봉은 `us_stocks.chart` daily). 홈 로테이션 위젯은 미국 탭(`data-us`)이면 미국 데이터를 읽고 탭 전환 때 다시 그림(MutationObserver), 미국 시장 요약 아래 "주요 ETF 수익률" 4열 칸(1일 / 1개월·연초 이후). 검증: `test_us_market_etf.py` 3건. 배포: master 반영 시 VM·GitHub Pages 자동.

**2026-10-04 캘린더 미국 실적 기업 아이콘 86종 추가**

사용자 요청(아이콘 없는 기업 확인 후 채움). 9~11월 `/earnings-calendar` 실측: 국내 DART 일정은 전부 아이콘 있음, 미국 S&P 100은 73종목이 빈 원(약칭만)이었다. S&P 100 중 없던 86종목을 Parqet 로고(SVG 76·PNG 10)로 `img/stock-icons/`에 추가, 출처는 `img/stock-icons/README.md`. 코드 변경 없음(기존 svg→png 폴백 그대로). 검증: 헤드리스 렌더로 86개 육안 확인. 배포: master 반영 시 GitHub Pages 자동.

**2026-10-04 일반 사용자 네이버 로그인 추가**

사용자 요청(구글 외 네이버 로그인, 일반 사용자용). 신규 `scripts/cloud-vm/naver_auth.py`(네아로 code→token→`/v1/nid/me`, 토큰은 프로필 조회 후 버림), `GET /auth/naver/start`·`/auth/naver/callback`. 세션은 기존 Google 서명 쿠키를 공용으로 써서 관심종목·메모·대시보드 등 `require_google_user` 경로는 그대로 동작(`sub='naver:<id>'`로 Google과 분리, `app_users.google_sub`에 저장, 스키마 변경 없음). 네이버 email은 동의 선택·소유 미검증이라 비어도 세션 성립, 관리자 판정은 Google 세션만(`GoogleAuthService.is_admin`). `/auth/google/me`에 `provider`·`naverConfigured` 추가. 프론트: 계정 선택창(`js/skin-shell.js`)에 네이버 버튼(키 미설정이면 숨김), 관심종목·메모·내 대시보드의 로그인 버튼은 선택창을 열도록(`window.NinePayAccountLogin`), 문구 "Google 로그인"→"로그인". 설정은 `docs/NAVER_AUTH_SETUP.md`. 검증: `test/test_naver_auth.py` 5건, `main` import 확인, `test_ui_ia.py`는 변경 전과 같은 6건 실패(주말 리포트 쪽). 배포: master 반영 시 VM·GitHub Pages 자동. 2026-10-05 VM `.env`에 `NAVER_OAUTH_CLIENT_ID/SECRET` 반영(`naverConfigured:true` 확인), 개인정보처리방침 3-2 네이버 항목 추가, 네이버 개발자센터 사전 검수 요청(제공 정보는 회원이름만). 검수 승인 전에는 앱 등록자·멤버 아이디만 로그인된다. 앞선 a5af4c6f 커밋에 이 작업의 `main.py` 부분이 섞여 먼저 올라갔다(동시 세션).
