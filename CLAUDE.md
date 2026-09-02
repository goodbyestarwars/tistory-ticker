# 9Pay 증권

한국 주식시장 데이터 수집·분석·시각화 서비스다.

## 핵심 구조

- 프론트엔드: Tistory 스킨 + GitHub Pages 정적 자산
- 백엔드: Google Apps Script + GCP VM FastAPI
- 운영 API: `https://goodbyestar.cloud`
- 운영 사이트: `https://ghlee.tistory.com`
- 기본·배포 브랜치: `master`

## 필수 규칙

- 기존 기능을 임의로 삭제하지 않는다.
- 요청 범위를 벗어난 리팩터링을 하지 않는다.
- 수정 전 관련 파일, 호출 관계, 배포 경로를 확인한다.
- API 키, 토큰, 계정정보를 코드·문서·로그에 기록하지 않는다.
- PC 화면을 우선하되 모바일 반응형을 유지한다.
- 상승은 빨강, 하락은 파랑 의미색을 유지한다.
- 데이터 파일은 `window.XXX = {...}` 형태의 `.js`를 사용한다.
- KRX 내부 크롤링 경로를 새로 추가하지 않는다.
- 미검증 API 필드나 단위를 확정값처럼 쓰지 않는다.
- 완료 후 변경 파일, 검증 결과, 수동 배포 여부를 요약한다.
- 중요한 기능·구조·API·배포 변경은 별도 요청이 없어도 `docs/WORK_HISTORY.md`에 기록한다.
- 사소한 문구·스타일 조정은 작업이력에 남기지 않고 Git 커밋으로만 관리한다.
- 작업이력은 날짜, 목적, 주요 변경, 검증·배포 결과만 간결하게 기록한다.
- 커밋·push 전에 이번 작업이 중요 변경에 해당하면 `docs/WORK_HISTORY.md` 반영 여부를 반드시 확인한다.
- 작업이력 변경은 관련 코드 변경과 동일한 커밋 또는 push 범위에 포함한다.

## 작업별 문서 참조 규칙

작업 시작 전에 아래 표에서 해당하는 항목의 문서를 **모두 참조**한다. 한 문서만 읽고
구조·API·DB·배포를 판단하지 않는다. 작업 범위가 여러 항목에 걸치면 해당 행을 합쳐서
읽는다.

| 작업 항목 | 반드시 참조할 문서 | 확인할 내용 |
|---|---|---|
| 모든 작업의 진입 | `docs/README.md`, `CLAUDE.md` | 문서 지도·공통 규칙·현재 작업 범위 |
| 시스템 구조·호출 흐름 | `ARCHITECTURE.md`, `docs/ARCHITECTURE_SPEC.md` | Tistory·GitHub Pages·GAS·VM 역할, 호출 경계, WebSocket, 캐시 |
| REST·WebSocket API | `API_REFERENCE.md`, `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md` | 라우트·필드·인증·CORS·TTL·장애 대응·운영 점검 |
| DB·캐시·데이터 보존 | `docs/DB_SPEC.md`, `docs/ARCHITECTURE_SPEC.md`, `scripts/cloud-vm/db_schema.py`, 관련 캐시 모듈 | SQLite 스키마, JSON 캐시, 온디맨드/배치, 보존·백업 |
| 백엔드 소스 수정 | `docs/SOURCE_CODE_SPEC.md`, `API_REFERENCE.md`, `docs/DB_SPEC.md` | 파일 역할, 함수 연결, 응답·저장 구조 |
| UI·반응형 수정 | `docs/UI_GUIDE.md`, `ARCHITECTURE.md`, 관련 `js/`·`css/` 파일 | Tistory/GitHub Pages 경로, 디자인·모바일·캐시 버전 |
| Tistory 스킨 수정 | `ARCHITECTURE.md`, `docs/ARCHITECTURE_SPEC.md`, `skin.html` | 자동 배포 여부와 Tistory 관리자 수동 반영 필요성 |
| GAS 수정 | `ARCHITECTURE.md`, `docs/API_OPERATION_SPEC.md`, `docs/GAS_AUTO_DEPLOY.md`, `gas/ticker-proxy.gs` | Script Properties, VM 인증, Actions/clasp 배포 |
| VM 배포·장애 점검 | `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md`, `docs/DB_SPEC.md`, `scripts/cloud-vm/deploy_check.sh` | health, 로그, DB 유지보수, 자동 배포·롤백 |
| 작업 이력·인수인계 | `docs/WORK_HISTORY.md`, 최신 `docs/HANDOFF_*.md` | 최근 변경, 검증 결과, 남은 수동 반영·주의사항 |
| 인증·외부 데이터 설정 | 해당 `docs/*_SETUP.md`, `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md` | 키 저장 위치, 공급자 폴백, 운영 도메인 제한 |

최신 작업을 이어받을 때는 `docs/HANDOFF_*.md`를 먼저 확인하되, 그것을 현재 코드의
유일한 근거로 사용하지 않는다. 실제 구현·운영 상태는 위 표의 원본 문서와 소스를
대조한다.

문서 전체 목록과 목적은 `docs/README.md`를 기준으로 한다. 중요 변경은
`docs/WORK_HISTORY.md`에도 기록한다.

## 작업별 Skill

- 기능 추가: `/feature-development`
- 오류 수정: `/bug-fix`
- UI 개선: `/ui-improvement`
- 배포 점검: `/deploy`
- 티스토리 포스팅 HTML: `/tistory-post-html`

## 배포 주의

- `js/`, `css/`, `data/`: `master` 반영 후 GitHub Pages 자동 배포
- `scripts/cloud-vm/`: `master` 반영 후 VM 자동 배포
- `gas/ticker-proxy.gs`: `master` 반영 후 GitHub Actions(clasp)가 자동 배포(2026-08-14부터). 저장소 Secrets(`CLASP_CREDENTIALS`/`CLASP_DEPLOYMENT_ID`) 없으면 예전처럼 GAS에서 수동 배포
- `skin.html`: Tistory 관리자에서 수동 반영

## 점검 도구

- `.github/workflows/api-probe.yml`: 운영 API·라이브 사이트 응답을 GitHub Actions 러너에서
  대신 호출해 확인한다. 아웃바운드가 막힌 작업 환경에서 API 필드·단위를 추정하지 않고
  실측할 때 Actions 탭에서 수동 실행한다. 인증 엔드포인트는 대상이 아니다.
