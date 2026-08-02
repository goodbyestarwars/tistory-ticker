# AI 작업 진입점

이 저장소의 공통 작업 규칙은 `CLAUDE.md` 하나로 통합 관리한다.

ChatGPT, Codex 및 기타 코딩 에이전트는 작업을 시작하기 전에 루트의
`CLAUDE.md`를 읽고 해당 규칙을 따른다.

`AGENTS.md`에는 규칙을 중복 작성하지 않는다.

## 작업별 절차 확인

Claude Code는 `CLAUDE.md`의 슬래시 커맨드(`/feature-development` 등)로
`.claude/skills/`를 자동 호출한다. ChatGPT, Codex 등은 슬래시 커맨드를 실행할
수 없으므로, 작업 시작 전 아래 중 현재 작업과 관련된 파일이 있으면 직접 열어
그 절차를 따른다.

- 기능 추가: `.claude/skills/feature-development/SKILL.md`
- 오류 수정: `.claude/skills/bug-fix/SKILL.md`
- UI 개선: `.claude/skills/ui-improvement/SKILL.md`
- 배포 점검: `.claude/skills/deploy/SKILL.md`
- 티스토리 포스팅 HTML: `.claude/skills/tistory-post-html/SKILL.md`
