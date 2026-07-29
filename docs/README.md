# 9Pay 문서 안내

AI가 시작 토큰을 아끼면서 필요한 정보만 읽도록 문서를 목적별로 분리했다.

| 위치 | 용도 | 기본 사용자 |
|---|---|---|
| `../AGENTS.md` | 범용 AI 작업·기록 규칙 | ChatGPT, Codex, 기타 에이전트 |
| `../CLAUDE.md` | 프로젝트 핵심 규칙과 문서 지도 | Claude Code |
| `../ARCHITECTURE.md` | 인프라, 호출 흐름, 배포 경로 | 구조·배포 작업 |
| `../API_REFERENCE.md` | goodbyestar.cloud API 명세 | API 작업 |
| `UI_GUIDE.md` | 색상, 레이아웃, 반응형 원칙 | UI 작업 |
| `WORK_HISTORY.md` | 중요한 기능·구조·배포 이력 | 모든 작업 에이전트 |
| `../.claude/rules/` | 경로별 규칙 | Claude Code |
| `../.claude/skills/` | 반복 작업 절차 | Claude Code |

## 유지 원칙

- 항상 필요한 사실만 `CLAUDE.md`와 `AGENTS.md`에 둔다.
- 반복 절차는 `.claude/skills/`에 둔다.
- 특정 경로의 규칙은 `.claude/rules/`에 둔다.
- 중요한 작업내역은 `WORK_HISTORY.md`, 세부 변경은 Git 커밋에 둔다.
- 긴 문서를 자동 import하지 않고 필요한 경우에만 읽는다.
- 문서와 실제 코드가 다르면 코드를 기준으로 문서를 갱신한다.
