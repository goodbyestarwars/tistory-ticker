# 이전 작업이력 (시장맵 회사 소개 반영 당시 최근 50건 유지)

**2026-11-12 비회원 홈 ‘지금 주목할 뉴스’ 타임라인·다크모드 버튼·로그인 창 박스 투명**

- 타임라인: 비회원 홈 마켓브리핑 위에 텍스트형 뉴스 타임라인(이미지 없음). `js/main-news.js`의 `MainNews`에 조회 주소·`dateValue`·`timeLabel`·`sourceLabel`·`displayTitle`·`safeHref`를 노출해 `guest-home.js`가 재사용(새 수집·크롤러 없음). 최근 24시간·발행시각/원문 확인 기사만 중복 제거 후 국내·미국 2건씩(부족하면 다른 쪽으로 보충) 최대 4건, 과거 → 최신. 머리말·더보기는 마켓브리핑과 같은 `.briefing-intro`/`.home-briefing-more`, 기사 제목은 공통 `.ui-section-title`, 섹션 제목 명조는 `style.css` 기존 예외 목록에 선택자만 추가. PC 4열 가로선+화살표, 900px 이하 세로 타임라인. 뉴스 영역은 `.home-widget-grid` 밖에 두어 모바일 브리핑/이야기 스와이프에 끼어들지 않음.
- 다크모드: 버튼 연결이 `skin-main.js`의 접근 판정 뒤 초기화 안에 있어 비회원 홈에서 동작하지 않던 것을 파일 상단으로 이동.
- 로그인 창: `access-landing.js` 박스 배경을 투명으로(사용자 지시).
- 검증(운영 페이지 덮어쓰기): 1440/1280 4열 균등, 768/390/320 세로, 가로 넘침 없음, 섹션 제목 Noto Serif KR 700 24px(모바일 22px)·기사 제목 Noto Serif KR 700 17px·시간 배지 Pretendard 600·메타 Pretendard 400, 섹션 내 이미지 0, 시간 오름차순, 라이트/다크, 브리핑 8장·이야기 유지, 다크 버튼 클릭 전환. `test_access_gate`/`menu`/`landing`/`home_first_paint`/`home_closed_briefing` 통과.

**2026-11-11 로그아웃 전체 해제·랜딩 사진 교체**

- 로그아웃: 로그인 상태에서 헤더 로그아웃을 눌러도 사이트 세션이 남던 문제. 원인: 다른 사이트 fetch 응답의 쿠키 삭제(SameSite 미지정)를 브라우저가 받지 않음. 수정(`access-gate.js`): 서버 로그아웃 주소로 최상위 이동 → 돌아오면 `nine_logout_step` 표식으로 티스토리 로그아웃 → 홈에서 로그인 창. 서버 변경 없음. 검증: `test_access_gate`(2단계 사례 추가), 운영 페이지 덮어쓰기로 이동 순서(사이트 로그아웃 → 티스토리 로그아웃 → `/` 랜딩) 확인. 실제 관리자 세션 삭제는 사용자 확인 필요.
- 랜딩 배경: 흐린 인터라켄 사진 → 맑은 날 뮈렌 전망(`img/landing-murren.jpg`, 1920×1280, Ximonic (Simo Räsänen), CC BY-SA 4.0, Wikimedia Commons), 출처 표기 갱신. 이전 파일은 보존.
