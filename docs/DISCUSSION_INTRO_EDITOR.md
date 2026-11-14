# 대화방 인트로 편집 (2026-11-15)

- 위치: 대화방 상단 인트로의 **문구 편집**. 서버 NineAccess 관리자 판정 후 표시하며 Tistory owner 표시는 권한 근거가 아니다.
- 제목(100자), 본문(4,000자), 문자 그림(2,000자·공백 보존), 하단 안내(200자)를 모달에서 편집한다. 저장 즉시 현재 화면에 적용하고 다른 방문자는 다음 페이지 조회 시 읽는다. 폴링 없음.
- 네이티브 dialog: 가운데 배치·내부 스크롤·Esc/닫기·초점 복귀. 저장 중 중복 제출/닫기 차단, 실패 시 입력 유지. 전역 UI 토큰 사용.
- 공통 NineHttp 사용. 모든 공개 문구는 textContent로 렌더링하며 HTML을 실행하지 않는다. 읽기 실패는 코드 기본 문구 유지, 편집 모달에서 최신 조회가 실패하면 저장 금지.
- GET /discussion-intro: 공개, no-store, {success,data:{content:null|{title,body,art,etiquette},revision,updatedAt}}. 저장 전 content=null이면 기존 JS 기본값 사용. 감사 정보는 공개하지 않는다.
- PUT /discussion-intro: 기존 Google 관리자 세션 + 허용 Origin, 분당20회, 본문32KiB 이하. {content,revision} 원자 저장, 잘못된 입력400·비관리자/Origin403·동시 수정409·초과413·파일읽기503/쓰기500. 공유 화면 권한과 원천시세/거래 권한은 불변.
- discussion_intro.py는 snapshot_io.atomic_json과 프로세스/파일 잠금으로 discussion_intro_state.json을 저장한다. 손상된 기존 파일은 덮어쓰지 않는다. 현재 문구와 전체 history를 동일 파일에 원자 저장한다. history는 각 버전 content(제목/본문/문자 그림/하단 안내)·revision·at(UTC ISO 시각)·actor·source를 보관하며 건수 제한으로 삭제하지 않는다. 요약 audit만 최근100개를 유지한다. 공개 view는 content/revision/updatedAt만 반환하므로 이력/변경 계정은 API·UI에 노출되지 않는다.
- 파일: js/stock-discussion.js, css/stock-discussion.css, scripts/cloud-vm/discussion_intro.py, main.py. 상태 JSON/lock은 .gitignore로 제외한다.
- 검증: test/test_discussion_intro.py, test/test_discussion_intro_routes.py, test/test_discussion_intro_ui.cjs. 서버 저장/충돌/손상/실패·관리자/Origin/크기·공개 감사 미노출, guest/member/owner위장 버튼차단·모달/XSS/공유재조회·저장실패/Esc·1280/390/320.
- 배포: master→Oracle API(기존 읽기용 사이트 서비스)→Pages. 거래 Google VM/runner/봇/주문은 변경·재시작하지 않는다.

## 서버 원문 이력 (2026-11-15)

- 현재 저장 문구가 있으면 기존 revision/내용/시각/확인 가능한 변경 계정을 existing-snapshot으로 보존한다. 과거 원문이 없는 audit를 이용해 예전 내용을 꾸며 만들지 않는다.
- 저장 전인 최초 설치는 같은 배포의 JS 기본 문구를 code-default-baseline, revision=0, actor=null로 보존한다. 이는 사용자 편집으로 기록하지 않는다. 이미 저장된 문구는 기본값으로 덮어쓰지 않는다.
- 운영 서버에서 `venv/bin/python discussion_intro.py --baseline <공개 기본 문구 JSON 경로>`로 최초 보존을 실행한다. 기존 이력이 있으면 그대로 유지하는 멱등 작업이며 출력은 revision/versions뿐이다.
- 이후 성공한 모든 관리자 저장은 admin-save 버전을 추가한다. 충돌/입력 오류/파일 저장 실패는 버전을 추가하지 않는다. 현재 문구와 최종 이력이 어긋나거나 이력이 손상되면 덮어쓰지 않는다.
- UI 이력 목록이나 이력 조회 API는 추가하지 않는다. 파일은 기존 VM 비공개 discussion_intro_state.json 내부 history에 누적되며 재배포·재시작으로 삭제하지 않는다. 실제 과거 원문은 도입 시점부터 보존된 범위만 확인 가능하다.
- 테스트: 105회 저장 후 최초 원문 유지·audit만100개, 기존7번 버전부터 이관, 기본값 최초 보존/재실행 무변경, 실패시 파일 바이트 동일/손상 거부.
