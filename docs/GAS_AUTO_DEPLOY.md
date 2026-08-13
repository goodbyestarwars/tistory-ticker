# GAS 자동 배포 (GitHub Actions + clasp)

`gas/ticker-proxy.gs`가 `master`에 push되면 `.github/workflows/deploy-gas.yml`이
GitHub의 클라우드 러너에서 `clasp push` + `clasp deploy`를 실행해 실제 GAS
배포(운영 웹앱 URL)까지 자동 반영한다. 로컬 PC에 저장소를 clone/보관할 필요가 없다.

**이 문서의 절차를 아직 안 밟았다면 자동배포는 동작하지 않고, `ARCHITECTURE.md`에
적힌 대로 여전히 수동 배포가 필요하다.** 아래 1회성 설정을 마쳐야 이 문서의
설명대로 자동화된다.

## 1회성 설정

### 1. clasp 로그인 (아무 PC에서나, 저장소 clone 불필요)
```powershell
npm install -g @google/clasp
clasp login
```
브라우저 인증 후 `%USERPROFILE%\.clasprc.json`(Windows) 또는 `~/.clasprc.json`
(macOS/Linux)이 생긴다. **이 파일은 저장소와 무관하게 그냥 구글 계정 인증
토큰이라, 리포를 clone하지 않아도 만들 수 있다.**

### 2. `.clasprc.json` 내용을 GitHub Secret으로 등록
1. `type %USERPROFILE%\.clasprc.json`(PowerShell)으로 전체 내용 확인
2. GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret
3. Name: `CLASP_CREDENTIALS`, Value: 방금 확인한 JSON 전체를 붙여넣기

### 3. 기존 배포 ID를 GitHub Secret으로 등록
새 배포를 만드는 게 아니라 **지금 쓰는 웹앱 URL(배포)에 그대로 새 버전만 얹는
것**이라 기존 배포 ID가 필요하다.
1. script.google.com에서 `ticker-proxy.gs` 프로젝트 열기
2. 배포 → 배포 관리 → 현재 쓰는 웹앱 배포 항목의 배포 ID 확인
3. GitHub Secret 추가: Name `CLASP_DEPLOYMENT_ID`, Value: 그 배포 ID

### 4. 동작 확인
- GitHub 저장소 → Actions 탭 → "Deploy GAS ticker-proxy" → **Run workflow**로
  수동 실행해보거나
- `gas/ticker-proxy.gs`를 아주 작게 고쳐 master에 push하면 자동으로 트리거됨
- 로그에서 `clasp push`/`clasp deploy` 단계가 성공(초록색)인지 확인

## 보안 참고
- `CLASP_CREDENTIALS`는 OAuth 리프레시 토큰을 포함한다 - 저장소 코드나 커밋
  메시지, 이슈/PR 본문 등 Secrets가 아닌 곳에 절대 붙여넣지 않는다.
- GAS 서비스는 프로덕션 백엔드 프록시라, 이 워크플로가 실패해도(예: 시크릿
  만료) 기존 배포는 그대로 유지된다 - 실패는 "반영 안 됨"이지 "장애"는 아니다.
