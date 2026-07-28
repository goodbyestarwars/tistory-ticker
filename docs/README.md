# 9Pay 문서 안내

Claude의 시작 토큰을 줄이기 위해 정보를 목적별로 분리했다.

| 위치 | 용도 | 로딩 |
|---|---|---|
| `../CLAUDE.md` | 모든 작업의 최소 규칙 | 세션 시작 시 |
| `../ARCHITECTURE.md` | 인프라, 호출 흐름, 배포 경로 | 필요할 때 |
| `../API_REFERENCE.md` | goodbyestar.cloud API 명세 | 필요할 때 |
| `UI_GUIDE.md` | 색상, 레이아웃, 반응형 원칙 | UI 작업 시 |
| `../.claude/rules/` | 경로별 규칙 | 관련 파일 작업 시 |
| `../.claude/skills/` | 반복 작업 절차 | Skill 호출 시 |

## 유지 원칙

- 항상 필요한 사실만 `CLAUDE.md`에 둔다.
- 반복 절차는 `.claude/skills/`에 둔다.
- 특정 경로의 규칙은 `.claude/rules/`에 둔다.
- 긴 설명은 일반 문서에 두고 필요한 경우에만 읽는다.
- `CLAUDE.md`에서 `@문서` 자동 import를 사용하지 않는다.
- 과거의 긴 `CLAUDE.md` 내용은 Git 이력에서 확인한다.
