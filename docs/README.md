# 9Pay 문서 안내

AI가 시작 토큰을 아끼면서 필요한 정보만 읽도록 문서를 목적별로 분리했다.

| 위치 | 용도 | 로딩 |
|---|---|---|
| `../AGENTS.md` | ChatGPT·Codex가 `CLAUDE.md`로 이동하는 진입점 | 에이전트 시작 시 |
| `../CLAUDE.md` | 모든 AI의 단일 공통 규칙과 문서 지도 | 작업 시작 시 |
| `../ARCHITECTURE.md` | 인프라, 호출 흐름, 배포 경로 | 구조·배포 작업 |
| `../API_REFERENCE.md` | goodbyestar.cloud API 명세 | API 작업 |
| `UI_GUIDE.md` | 색상, 레이아웃, 반응형 원칙 | UI 작업 |
| `WORK_HISTORY.md` | 중요한 기능·구조·배포 이력 | 이력 확인·갱신 시 |
| `SOURCE_CODE_SPEC.md` | 파일별 역할·함수·코드 품질 점검(속도/오류/보안) | 전체 구조 파악·리팩터링 전 |
| `ARCHITECTURE_SPEC.md` | 컴포넌트 간 호출·인증·캐싱·동시성 상세 | 인프라 심화 작업 |
| `DB_SPEC.md` | SQLite 2종 + 파일 기반 데이터 스키마 정의 | DB/캐시 구조 작업 |
| `../.claude/rules/` | 경로별 세부 규칙 | 관련 파일 작업 시 |
| `../.claude/skills/` | 반복 작업 절차 | Skill 호출 시 |

## 유지 원칙

- 공통 규칙은 `CLAUDE.md`에만 작성하고 `AGENTS.md`에 중복하지 않는다.
- 반복 절차는 `.claude/skills/`에 둔다.
- 특정 경로의 규칙은 `.claude/rules/`에 둔다.
- 중요한 작업내역은 `WORK_HISTORY.md`, 세부 변경은 Git 커밋에 둔다.
- 긴 문서를 자동 import하지 않고 필요한 경우에만 읽는다.
- 문서와 실제 코드가 다르면 코드를 기준으로 문서를 갱신한다.
