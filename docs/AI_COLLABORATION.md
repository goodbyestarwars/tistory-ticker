# ChatGPT × Claude Code 수동 협업 절차

이 문서는 `goodbyestarwars/tistory-ticker`의 GitHub Issue·PR을 두 도구의 공통 기록장으로 쓰는 방법이다. 사용자가 매 차례 직접 시작한다. 기존 ChatGPT·Claude 구독으로 각 제품을 사용하며 별도 AI API 호출, 봇, 웹훅, 예약 실행, GitHub Actions 기반 AI 리뷰를 만들지 않는다. 구독별 사용 한도와 제품 제공 범위는 별개다.

## 시작 전

1. 두 도구 모두 루트 `CLAUDE.md`와 `docs/README.md`를 읽고, 작업별 필수 문서를 확인한다. `AGENTS.md`는 `CLAUDE.md`의 진입점이다.
2. 사용자 요청과 변경 범위, 기준 브랜치·SHA를 Issue에 적는다. 보안상 키·토큰·계정정보·IP·`.env`·DB·로그 원문은 Issue, PR, 프롬프트에 넣지 않는다.
3. 실계좌 엔진·주문 정책의 변경과 실제 적용, 배포는 사용자의 명시적 승인 범위를 확인한다. 승인되지 않은 실계좌 변경·병합·배포를 하지 않는다. `master`의 자동 배포 경로는 `CLAUDE.md`를 따른다.

## 한 건의 작업 흐름

1. **Issue — 독립 분석.** 사용자가 같은 Issue URL과 범위를 ChatGPT, Claude Code에 각각 전달한다. 각자 상대 의견을 보기 전에 관련 코드·문서를 확인하고 별도 의견을 작성한다: 근거(파일·행 또는 커밋), 제안, 위험·반례, 확인 방법, 불확실한 점. 어느 한쪽만 구현 담당으로 고정하지 않는다.
2. **Issue — 상호 비평과 결정.** 사용자가 두 의견을 서로에게 전달한다. 각자는 상대 제안을 검토해 수용·수정·반대 항목과 이유를 적는다. 합의점과 남은 이견을 Issue에 남긴다. 합의되지 않은 위험한 변경은 사용자가 결정하기 전까지 보류한다. AI 간 합의만으로 사용자 승인 요건을 대신하지 않는다.
3. **PR — 구현과 교차 검토.** 사용자가 선택한 범위에서 작업 브랜치에 수정하고 PR을 연다. 구현은 어느 도구가 해도 된다. PR 본문에 Issue 링크, 합의/이견, 변경 파일, 테스트 결과, 미확인 사항, 배포 영향, 사용자 승인 상태를 적는다. 다른 도구는 최종 diff와 해당 SHA를 독립적으로 읽고, 구체적 결함·대안 또는 검토 완료 의견을 남긴다. 수정 후에는 새 SHA를 기준으로 필요한 부분만 다시 검토한다.
4. **마무리.** 최종 결정·남은 이견·테스트·병합 및 실제 배포 여부를 PR에 기록한다. 중요한 기능·구조·API·배포 변경은 `CLAUDE.md` 규칙대로 관련 코드와 같은 커밋 또는 push 범위에서 `docs/WORK_HISTORY.md`에 날짜·목적·주요 변경·검증/배포 결과를 간결하게 남긴다. 사소한 문구·스타일만의 변경은 Git 커밋으로 관리한다.

ChatGPT의 일반 GitHub 연결은 저장소 읽기 기능으로 제공될 수 있다. 쓰기 기능이 없는 화면에서는 ChatGPT 의견을 사용자가 Issue/PR에 붙여 넣고 `ChatGPT 검토 (사용자 전달)`로 표시한다. Claude Code도 GitHub 쓰기 접근이 없으면 같은 방식으로 전달한다. 서로의 의견을 독립 검토한 것처럼 가장하지 않는다.

## 기록 형식

Issue와 PR 댓글에는 아래 항목을 짧게 적는다. GitHub 댓글 작성자가 실제 도구 계정과 다르면 전달자를 명시한다.

```text
작성: ChatGPT / Claude Code (직접 또는 사용자 전달)
대상: Issue/PR URL, 기준 브랜치 또는 커밋 SHA
판단: 제안 / 수용 / 수정 제안 / 반대 / 확인 보류
근거: 파일·행, 관찰 결과
위험·반례:
검증 방법·결과:
합의점 / 남은 이견 / 사용자 결정 필요 사항:
```

## 첫 교환 예시

대상은 **문서와 코드의 불일치 1건**처럼 작고 읽기 전용으로 시작한다. 사용자가 새 Issue에 “`CLAUDE.md`와 `docs/README.md`를 기준으로, 배포 설명 중 현재 코드와 다른 점 하나를 찾아 근거와 수정안을 제시해 달라. 아직 수정·배포하지 말라”라고 적는다. 동일한 Issue URL을 두 도구에 전달해 독립 의견을 받은 다음 서로의 의견을 전달한다. 합의된 문서 수정만 별도 PR로 검토하고, 실제 배포가 수반되는 변경은 별도 승인 절차를 따른다.

## 사용자 연결

- **ChatGPT:** 설정의 Apps 또는 Plugins에서 GitHub를 연결하고, GitHub에서 이 저장소 접근을 허용한다. 사용 가능한 화면·권한은 구독과 제품에 따라 다르다. 저장소가 안 보이면 GitHub 앱의 저장소 선택·승인 상태를 확인한다. 대화에서 저장소명, Issue/PR URL, 기준 SHA, 읽을 파일을 명시한다.
- **Claude Code:** Claude 구독 계정으로 로그인해 저장소 폴더에서 실행한다. 별도 Anthropic API 키를 설정하지 않는다. GitHub CLI를 설치하고 `gh auth login`으로 본인 GitHub 계정을 인증한 뒤 `gh repo clone goodbyestarwars/tistory-ticker` 또는 기존 클론을 사용한다. `gh auth status`와 `gh repo view goodbyestarwars/tistory-ticker`로 접근을 확인한다. Issue/PR에 직접 기록할 때만 필요한 GitHub 권한을 사용한다.

참고: [ChatGPT GitHub 연결](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt), [Claude Code 시작](https://code.claude.com/docs/en/quickstart), [GitHub CLI 시작](https://docs.github.com/en/github-cli/github-cli/quickstart).
