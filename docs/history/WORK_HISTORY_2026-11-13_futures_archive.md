# 과거 작업이력 (최근 50건 유지)

**2026-11-11 비회원 홈 카드 레이아웃 바로잡기**

증상: 비회원 홈에서 브리핑 8개·이야기 시리즈 12개가 기존 푸터/홈 가로 캐러셀 CSS와 결합해 넓이 초과, 제목·카드 불일치, 수평 스크롤로 표시됨. 수정: `js/guest-home.js`에서 홈·푸터 캐러셀 전용 클래스를 분리하고 `css/guest-home.css`에 반응형 카드 그리드를 적용. 마켓브리핑·이야기는 PC 여러 열, 모바일 2~1열로 자동 줄바꿈하며 가로 스크롤·캐러셀 화살표 제거. 기존 원본 카드·링크·관리자 대시보드 유지. 검증: JS 구문 및 GitHub 재조회로 변경 확인. 실사이트 PC/모바일 렌더링은 미검증(Pages 캐시 반영 후 확인 필요). 배포: master → Pages.

**2026-11-12 랜딩 로고 글꼴 수정**

원인: `style.css`의 `html body * { font-family: ... !important }`가 랜딩 로고 CSS를 이겨 Pretendard로 표시됨. 수정: 로고 요소 인라인 스타일(`!important`)로 Noto Serif KR Site 700 적용, 문구를 스킨 원문(ㄱㅖ조 ㅏ심폐소생술)과 일치. 검증: 실사이트 위 로컬 파일 덮어쓰기로 계산 글꼴 확인.

**2026-11-12 로그인·비회원 화면 분리(비회원 입장 + 비회원 홈)**

요청: 시작 화면에 [로그인]·[비회원 로그인] 두 버튼, 로그인은 확대 모달(기존 Google/네이버/카카오 재사용), 비회원은 인증 없이 탭 단위(`sessionStorage nine_guest`) 입장. 비회원 메뉴는 홈·시장(주요뉴스·마켓브리핑)·캘린더·대화방만(PC 메뉴·모바일 서랍·하단 탭 동일), 이야기 시리즈 메뉴 항목 제거, 비회원 홈은 마켓브리핑+이야기 시리즈 두 영역만. 변경: `js/access-landing.js`(버튼·모달·ESC·바깥 클릭·포커스 트랩), `js/access-gate.js`(비회원 판정·`guest-home.js` 로드·비공개 URL은 /guestbook), 신규 `js/guest-home.js`·`css/guest-home.css`(피드의 마켓브리핑 카드·푸터 이야기 시리즈 재사용, 대시보드·시세 요청 없음), `js/skin-menu.js`·`js/home-mobile-tabs.js`, 서버 `access_policy.py`에 공개 화면 `news`(주요 뉴스) 추가. 일반 로그인 계정에 관리자 기능·제한 시세는 열지 않음. 검증(테스트): `test_access_gate/menu/landing/kis_menu/early_bootstrap`·`test_access_policy.py` 통과, 실사이트 HTML에 로컬 파일을 덮은 브라우저 확인(1280/390, 비회원 홈에 카드 8·이야기 12, 대시보드 0, 시세 요청 없음). 배포: master → Pages, 서버 `news`는 VM 자동 배포(평일 20:00 이후) 전까지 클라이언트가 `news`를 공개로 간주. skin.html 수동 반영 불필요.

**2026-11-11 비로그인 로그인 랜딩(마테호른·인터라켄)**

요청: 비로그인 첫 화면을 로그인 창이 먼저 뜨는 형태로(스위스 배경, 상단 공개 메뉴, Google·네이버·카카오). 또 첫 0.6초에 티스토리 원본 글 틀이 왼쪽에 먼저 보이다가 정리되는 깜빡임 제보. 변경: `js/access-landing.js`(외부 이미지 없이 SVG 풍경, 공개 메뉴 4개, 로그인 카드), `access-gate.js`가 비로그인·세션 첫 방문에만 띄우고(로그인 이력 힌트 `nine_authed`가 없으면 판정 전 즉시) 로그인 확인 시 닫음. 카카오는 사이트 회원 로그인이 아니라 기존 티스토리 관리자 로그인으로 연결(회원 이메일 검증 불가, 카드에 명시). 서버 `/access-policy`에 `naverConfigured` 추가(배포는 20:00 이후 VM 반영과 함께). 검증: `test_access_landing.js`(1440/390/320)·`test_access_gate.js`. 미확인: '시장지표 자리에 이야기 시리즈가 보임' 제보는 재현 못 함.

**2026-11-11 화면 접근 정책(비로그인 4개 화면·관리자 ON/OFF)**

요청: 증권사 시세 제3자 제공 불허를 전제로 비로그인은 대화방·캘린더·마켓브리핑·시장지표만, 첫 화면 `/guestbook`, 관리자가 화면별 ON/OFF. 일반 회원에게 인증만으로 제한 시세를 열지 않음(첫 문장 "구현한다"는 본문과 충돌하는 오타로 보고 미구현 해석). 변경: `access_policy.py`·`/access-policy`(GET/PUT)·제한 REST 미들웨어(401/403)·`/ws/quotes` 인증 거절, `js/access-gate.js`(NineAccess)·`access-settings.js`, 메뉴·모바일 탭바·검색·관심종목·메모 게이팅, `skin-main.js` 보호 화면 판정 후 초기화. 시장지표 공급자 공개 가능 여부는 미확정(상세 `ACCESS_POLICY_2026-11-11.md`). 검증: `test_access_policy.py` 8·`test_access_gate.js`·`test_access_menu.js`(PC 1280/모바일 390·320, 비로그인·일반·장애·관리자)·FastAPI TestClient 통합(401/403/200·WS 거절·설정 저장). 배포: PR(초안) - 미병합, VM→Pages 순서·장중 재시작 금지·skin.html 수동 반영 대기. 실서버·실제 로그인 세션 검증 미실시.
