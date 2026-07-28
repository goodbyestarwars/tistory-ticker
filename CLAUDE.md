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

## 필요한 문서만 읽기

아래 문서를 시작 시 전부 읽지 않는다.

- 구조·배포: `ARCHITECTURE.md`
- VM REST API: `API_REFERENCE.md`
- UI 기준: `docs/UI_GUIDE.md`
- 문서 안내: `docs/README.md`
- 과거 상세 이력: `git log -p -- CLAUDE.md`

## 작업별 Skill

- 기능 추가: `/feature-development`
- 오류 수정: `/bug-fix`
- UI 개선: `/ui-improvement`
- 배포 점검: `/deploy`

## 배포 주의

- `js/`, `css/`, `data/`: `master` 반영 후 GitHub Pages 자동 배포
- `scripts/cloud-vm/`: `master` 반영 후 VM 자동 배포
- `gas/ticker-proxy.gs`: GAS에서 새 버전 수동 배포
- `skin.html`: Tistory 관리자에서 수동 반영
