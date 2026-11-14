# 대화방 인트로 편집 (2026-11-15)

- 위치: 대화방 상단 인트로의 **문구 편집**. 서버 NineAccess 관리자 판정 후 표시하며 Tistory owner 표시는 권한 근거가 아니다.
- 제목(100자), 본문(4,000자), 문자 그림(2,000자·공백 보존), 하단 안내(200자)를 모달에서 편집한다. 저장 즉시 현재 화면에 적용하고 다른 방문자는 다음 페이지 조회 시 읽는다. 폴링 없음.
- 네이티브 dialog: 가운데 배치·내부 스크롤·Esc/닫기·초점 복귀. 저장 중 중복 제출/닫기 차단, 실패 시 입력 유지. 전역 UI 토큰 사용.
- 공통 NineHttp 사용. 모든 공개 문구는 textContent로 렌더링하며 HTML을 실행하지 않는다. 읽기 실패는 코드 기본 문구 유지, 편집 모달에서 최신 조회가 실패하면 저장 금지.
- GET /discussion-intro: 공개, no-store, {success,data:{content:null|{title,body,art,etiquette},revision,updatedAt}}. 저장 전 content=null이면 기존 JS 기본값 사용. 감사 정보는 공개하지 않는다.
- PUT /discussion-intro: 기존 Google 관리자 세션 + 허용 Origin, 분당20회, 본문32KiB 이하. {content,revision} 원자 저장, 잘못된 입력400·비관리자/Origin403·동시 수정409·초과413·파일읽기503/쓰기500. 공유 화면 권한과 원천시세/거래 권한은 불변.
- discussion_intro.py는 snapshot_io.atomic_json과 프로세스/파일 잠금으로 discussion_intro_state.json을 저장한다. 손상된 기존 파일은 덮어쓰지 않는다. 감사 actor/시각/리비전 최근100개는 VM 비공개 파일에만 보관한다.
- 파일: js/stock-discussion.js, css/stock-discussion.css, scripts/cloud-vm/discussion_intro.py, main.py. 상태 JSON/lock은 .gitignore로 제외한다.
- 검증: test/test_discussion_intro.py, test/test_discussion_intro_routes.py, test/test_discussion_intro_ui.cjs. 서버 저장/충돌/손상/실패·관리자/Origin/크기·공개 감사 미노출, guest/member/owner위장 버튼차단·모달/XSS/공유재조회·저장실패/Esc·1280/390/320.
- 배포: master→Oracle API(기존 읽기용 사이트 서비스)→Pages. 거래 Google VM/runner/봇/주문은 변경·재시작하지 않는다.
