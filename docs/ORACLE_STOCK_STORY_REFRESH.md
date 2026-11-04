# Oracle 종목 스토리 격주 갱신 — 서버 Claude Code 작업지시서 (2026-11-04)

## 목적과 현재 상태
사용자 확정: **금융 API 인증정보는 Oracle에만 둔다. GitHub Actions·Secrets·소스·로그·커밋에 절대 복사하거나 전달하지 않는다.**
GitHub Actions 전용 수집 워크플로 `.github/workflows/stock-stories-fortnightly.yml`은 삭제됐다. 종목분석 프런트는 심층 스토리 없는 종목(예: 셀트리온 068270)도 이미 계산된 스윙 판정·추세 차트로 기본 카드가 나타나도록 변경돼 있다.

**이 문서는 아직 Oracle systemd 설치/실행 완료를 뜻하지 않는다.** 서버에 설치된 Claude Code가 실제 환경을 확인하고 설치·검증한다.

## 우선 확인할 원본 (불필요한 전수 검색/클론 금지)
1. 작업 서버 기존 체크아웃의 루트 `CLAUDE.md`를 먼저 읽고, `docs/README.md` 지도로 필요한 부분만 확인한다.
2. `scripts/build_stock_stories.py` (`--all` 2,696종목 스냅샷), `scripts/fetch_investor_flow.py` (키움 인증·호출 간격 0.25초), `data/stock-stories.js`, `data/stories/`, `data/company-profiles.js`, `test/test_build_stock_stories.py`, `test/test_stock_stories.py`.
3. `scripts/cloud-vm/scheduled_job.py`, `snapshot_io.py`, `scripts/cloud-vm/deploy_check.sh`, 기존 systemd 타이머 및 `.scan_serial.lock` 소유 경로 확인.
4. 운영 서버의 실제 `kiwoom-api` 체크아웃/배포 파일 경로와 기존 GitHub push 인증 방식, 현재 서버 RAM·디스크·서비스 상태를 확인한다. 문서 예시 경로를 무조건 신뢰하지 않는다.

## 실행 계약
- **Oracle systemd timer**, 격주 **일요일 오전 10:00 KST**, 첫 기준일 **2026-11-08**. systemd는 일요일 주 1회 타이머로 기동하되 실행 진입점이 `(KST 오늘 - 2026-11-08).days % 14 == 0`인지 검증한다. 수동 실행은 명시적 `--force`/예외 모드로만 허용한다. `Persistent=false`로 주말을 놓친 작업이 평일에 갑자기 실행되지 않게 한다. 서버가 UTC여도 KST 기준이 어긋나지 않게 calendar timezone을 명시하고 `systemd-analyze calendar`로 검증한다.
- **새 상시 데몬 금지**, systemd oneshot/timer만 사용. 기존 공용 스캔 잠금과 충돌하지 않게 조율하며, 겹치면 중복/무한 대기 없이 다음 허용 회차 또는 명시적 재실행으로 넘긴다. 저우선순위(예: Nice/CPUWeight/IOWeight), 메모리·전체 소요 시간 상한, 수집 중 FastAPI 응답 부하 확인. 키움 호출 간격을 임의로 줄이거나 새 병렬 요청 추가하지 않는다.
- 원래 서버에만 있는 `.env`/프로세스 환경에서 **기존 키를 읽기만** 한다. 키 값을 출력·복사·업로드하지 않는다. 호출 API는 기존 읽기 전용 `ka10001`, `ka10014`, `ka10059`에 한정한다. 계좌·주문·정정·취소·실거래 정책·서비스는 접근하지 않는다.
- 원본 운영 파일에 직접 덮어쓰지 않는다. 서버 내 **별도 권한 0700 임시 작업 폴더**에 필요한 파일만 복사하고, 키는 서버의 기존 프로세스 환경변수로만 전달해 `python scripts/build_stock_stories.py --all`을 실행한다. `git clone` 금지. 수집/검증 도중 예외·시간초과·인증 오류가 나면 기존 사이트 카드는 그대로 보존한다.
- 기존 카드와 새 카드 간 건수 비교(기준 대비 15% 초과 감소 시 중단), 모든 색인 종목 파일 존재·유효한 JS/JSON·카드 내용·기준일/출처·수기 4종목 보존 검증, 단위 테스트 통과 후에만 공개 데이터 파일을 배포한다. 누락/미선정 종목은 실패와 구분해 개수·사유를 로그의 비밀정보 없는 집계로 남긴다. 과도한 기준 임의 완화/가짜 데이터 생성 금지.
- 배포는 기존 Oracle의 검증된 Git 쓰기 권한을 활용해 **`data/stock-stories.js` 및 `data/stories/` 파일만** `master`에 직접 push한다. 새 GitHub Actions Secrets·금융 자격증명·개인키는 GitHub로 보내지 않는다. 필요한 GitHub 쓰기 권한은 별도 **배포 전용 인증**으로 제한하되 그 비밀은 Oracle 안에만 둔다. 서버 체크아웃의 다른 변경/스케줄·재배포 프로세스와 경합하면 안전하게 중단하고 증거를 남긴다. 강제 push 금지.
- GitHub Pages 빌드/공개 JS URL 반영 확인. Pages 게시 지연은 수집 실패와 구분한다. `deploy_check.sh`는 정적 스토리 자료 변경에 대한 API 재시작·재검색을 이미 제외한다. 운영 서비스 불필요한 재시작 금지.
- 이전 카드 전체/키 없이 복구 가능한 백업 또는 원본 커밋 SHA를 보존해 rollback 가능하게 한다. 토큰·계좌·원시 주문 로그는 기록하지 않는다.

## 완료 검증 및 보고
- `systemctl list-timers`의 다음 격주 실행 계산, 서비스 유닛/타이머 enable 상태, `systemd-analyze verify`/calendar 및 잠금/타임아웃 테스트.
- 가능하면 **읽기 전용 소량 검증**을 먼저 수행하고 정상일 때 2,696종목 전체 수집을 서버 부하 감시 아래 실시해 기존 데이터 갱신·GitHub push·Pages 반영을 확인한다. 오류 시 사이트 정적 카드 데이터 보존.
- 셀트리온(068270)은 심층 선별 실패 시에도 기본 분석 카드 표시, 현대차(005380)·수기 삼성전자(005930)/한화오션(042660) 기존 카드 보존 확인.
- 구조·배포 규칙이 변경되면 `CLAUDE.md` 및 `docs/WORK_HISTORY.md` 최신 이력 갱신. 결과 보고는 **설치 여부, 다음 실행(KST), 실행 성공 건수, 검증, push SHA, Pages 확인, 미완료**만 간결하게 전달한다. 서버 파일·키·토큰·내부 주소값은 보고하지 않는다.


## 설치 구현 및 운영 확인 (2026-11-04 KST)

- 구현: `scripts/oracle-stock-stories/refresh_stock_stories.py`, 같은 폴더의 service/timer 및 `install.sh`. 기존 체크아웃에서 `bash scripts/oracle-stock-stories/install.sh`로 설치한다. 자동 VM 코드 감시 경로 밖에 두어 API 재시작을 유발하지 않는다.
- Oracle oneshot 조정자는 기존 운영 사용자로 읽기 전용 수집 자식 프로세스를 실행하고, Git은 서버의 기존 Git 인증 소유자로 실행한다. 금융 환경은 수집 자식에서만 읽고 Git·테스트에는 전달하지 않는다. 새 인증정보·Secrets를 만들지 않는다.
- `scheduled_job.try_lock`/`stop_group`, `snapshot_io.atomic_json`, 기존 생성기/전송기를 재사용한다. 기존 스케줄러의 야간 창은 일요일 10시와 다르므로 이 진입점이 격주 날짜와 무대기 잠금을 소유한다. 기존 스케줄러 계약은 변경하지 않는다.
- 일요일 10:00 `Asia/Seoul`, 기준일 2026-11-08, `Persistent=false`; 비해당 주는 성공 종료한다. 수동 예외는 `--force`, 소량 검증은 `--force --smoke`다. 잠금 충돌은 즉시 `busy_skip`으로 종료하며 다음 허용 회차 또는 명시적 재실행을 기다린다.
- Nice=15, CPUWeight/IOWeight=10, 메모리 768MiB, 수집 2시간/서비스 전체 3시간 상한, 프로세스 그룹 종료. 60초마다 공개 health 응답을 측정하고 장애 시 중단한다.
- 수집 중 원본 운영 파일을 쓰지 않는다. 권한 0700 임시 폴더만 사용하고 종료 시 삭제한다. 허용 API 3종 및 반환 코드·응답 형태를 검사하고, 실패 한 건이라도 있으면 공개 데이터 배포를 차단한다. 미선정/빈 응답은 실패와 구분해 집계한다.
- 수기 4종목 완전 동일, 15% 감소 차단, 색인/파일 일치, JSON 및 Node JS 파싱, 출처·기준일·막대 범위, 기존 생성/프런트 테스트 통과를 요구한다. 셀트리온 기본 분석 카드 폴백은 기존 프런트 회귀 테스트로 확인한다.
- 배포 잠금을 다시 획득하고 수집 시작 SHA와 원격 master가 같은 경우에만 별도 Git index/commit-tree로 공개 JS 경로만 정상 push한다. 원격이 바뀌면 강제 push 대신 중단한다. 기존 체크아웃 작업 파일과 index를 변경하지 않는다. 성공 SHA와 복구 기준 SHA는 Oracle에 원자 저장한다.
- Pages는 공개 메인 JS와 해당하는 현대차·셀트리온 분할 JS의 SHA-256 일치로 최대 15분 확인한다. 지연은 `pages_pending`으로 분리한다. 이전 공개 데이터는 복구 기준 커밋에서 같은 데이터 경로만 되돌려 새 커밋으로 push해 복구한다(강제 push 금지).
- 설치 확인: 타이머 enabled/active, 다음 2026-11-08 10:00 KST(실제 후속 실행 11-22), calendar/verify 통과. 안전 회귀 3건, 기존 생성 8건/프런트 1건 통과. 비해당 날짜 skip·실제 공용 잠금 충돌 skip 확인. 첫 전종목 실행/Pages 결과는 아래 후속 검증 기록을 기준으로 한다.
