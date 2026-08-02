# Claude Code 스킬 설치 가이드

작성일: 2026-08-02

9Pay 개발에 사용하는 Claude Code 환경에 추가로 설치를 검토한 외부 스킬/플러그인 정리. 9Pay 앱 코드와는 무관한 로컬 도구 설정 문서다.

> 모든 설치 명령은 사용자 로컬 Claude Code 터미널에서 직접 실행한다. Cowork(원격 세션)에서는 `curl | bash`, `npx` 설치 스크립트를 대신 실행할 수 없다.

## 1. 생산성 (토큰 절감)

### 1-1. caveman

- **효과**: 출력 토큰 65~75% 절감. 응답을 원시인체(fragment)로 압축하되 기술 정확도는 유지. thinking/reasoning 토큰은 영향 없음.
- **문제점**: 기본 설치 시 `SessionStart`/`UserPromptSubmit` 훅과 `caveman-shrink` MCP가 자동 등록됨(매 세션·매 프롬프트 실행). 훅 스크립트 및 `caveman-shrink` 패키지 코드는 자체 검토 안 됨.
- **설치 위치**: Claude Code 터미널 (Cowork 불가)
- **설치 명령**:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --minimal --only claude
  ```

- **권장**: `--minimal --only claude`로 훅/MCP 없이 최소 설치. 기본 옵션(플래그 없음)은 비권장.

### 1-2. karpathy-guidelines

- **효과**: 추측성 코딩 방지, 과설계 방지, 무관한 코드 변경 방지, 작업 전 성공 기준 명시. 코딩 결과물의 diff가 작아지고 스코프 이탈이 줄어듦.
- **문제점**: 없음 (텍스트 규칙 파일, 실행 코드 없음).
- **설치 위치**: Claude Code 터미널
- **설치 명령**:

  ```
  /plugin marketplace add forrestchang/andrej-karpathy-skills
  /plugin install andrej-karpathy-skills@karpathy-skills
  ```

## 2. UI/UX 디자인

### 2-1. frontend-design (Anthropic 공식)

- **효과**: "AI스러운" 뻔한 디자인(보라 그라디언트, 획일적 둥근모서리, Inter 폰트 남발) 회피. 브랜드별 개성 있는 팔레트·타이포·레이아웃 선택 유도.
- **문제점**: 없음. Anthropic 공식 리포(`anthropics/skills`).
- **설치 위치**: Claude Code 터미널 (Cowork 디렉터리에는 아직 미등록)
- **설치 명령**:

  ```
  /plugin marketplace add anthropics/skills
  /plugin install example-skills@anthropic-agent-skills
  ```

  개별 설치:

  ```bash
  npx skills add https://github.com/anthropics/skills --skill frontend-design
  ```

### 2-2. web-artifacts-builder (Anthropic 공식)

- **효과**: React/Tailwind/shadcn 기반 복잡한 멀티컴포넌트 claude.ai 아티팩트(상태관리·라우팅 필요 시) 생성. 단일 파일로 번들링.
- **문제점**: 없음. Anthropic 공식.
- **설치 위치**: Cowork 디렉터리 검색 가능 (스킬 > "frontend" 검색) 또는 Claude Code
- **설치 명령** (Claude Code):

  ```bash
  npx skills add https://github.com/anthropics/skills --skill web-artifacts-builder
  ```

### 2-3. ui-ux-pro-max

- **효과**: 스타일 84종·컬러팔레트 192개·폰트조합 74개·UX 가이드라인 98개 등 로컬 DB를 참조해 코드 생성. 생성 후 안티패턴 자동 검증.
- **문제점**: 커뮤니티 제작(공식 아님). 유료 Premium 티어 존재(uupm.cc) — 무료 범위 확인 필요.
- **설치 위치**: Claude Code 터미널
- **설치 명령**:

  ```
  /plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
  /plugin install ui-ux-pro-max@ui-ux-pro-max-skill
  ```

## 3. 보류

### 3-1. handoff

- **상태**: 동명 프로젝트 다수(`willseltzer/claude-handoff`, `thegeneralist01/claude-handoff-skills`, `steveyegge/beads` 내 handoff). 출처(SNS 링크/스크린샷) 확인 후 특정 필요.

## 참고

- Cowork 세션에서는 `curl | bash`, `npx` 설치 스크립트를 대신 실행할 수 없음 — 위 명령은 사용자 로컬 Claude Code 터미널에서 직접 실행한다.
- 코딩 작업 시 리포에 `CLAUDE.md`가 있으면 push 전 갱신 여부를 확인한다(기존 작업 규칙).
