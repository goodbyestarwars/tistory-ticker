# 임시 KIS Trading Tool

기존 Oracle Lab의 KIS Strategy Builder 화면을 `https://goodbyestar.cloud/kis-tool/`에서 사용한다. 분석 엔진을 운영 앱 안에 복사하지 않고, 임시 메뉴와 독립 게이트웨이만 연결한다.

## 접근·주문 경계

- 사용자가 카카오·티스토리 이메일 대신 **기존 사이트 관리자 Google 계정**으로 보호하도록 승인했다.
- 기존 `/auth/google/me`가 서명·만료를 확인한 응답의 `authenticated=true`, `isAdmin=true`, `provider=google`을 모두 요구한다. 브라우저 ROLE/이메일 문자열은 인증 수단이 아니다.
- 메뉴는 NineAccess 서버 화면 정책의 관리자 체크값으로 자동매매 옆에 표시한다. Tistory ROLE은 서버 관리자 권한의 근거로 사용하지 않는다. 페이지·정적 자산·분석 API는 별도로 Google 관리자 권한을 확인하고 인증 실패/로그아웃 시 서버가 차단한다. CORS는 운영 블로그만 허용하고 응답은 `private, no-store`다.
- 쿠키는 기존 인증 API에만 전달한다. KIS UI/API에 쿠키·Authorization·사용자 Host를 전달하지 않는다. 게이트웨이에 로그인 비밀키나 증권 자격증명을 저장하지 않는다.
- 주문·계좌·브로커 로그인/모드 전환은 게이트웨이와 기존 Lab에서 차단. Lab의 증권사 네트워크 차단, Lean `--network=none` 유지.
- 쓰기 요청은 도구의 동일 출처만 허용. 외부 호스트 선택/임의 프록시 경로 없음. HTTP만 지원하며 실시간 주문용 WebSocket은 연결하지 않는다.

## 운영

- Lab: `/home/ubuntu/ninepay-lab/`, 서비스 `ninepay-kis-web.service`(ubuntu 사용자, 127.0.0.1:18870).
- 원본 UI를 보존하고 `frontend-web` 복제에 Next basePath와 `NEXT_PUBLIC_API_URL`을 적용해 빌드했다. 기존 Lab UI 서비스 18300이 새 빌드를 사용한다. API 18800은 그대로다.
- 2026-11-07 웹 백테스터 제거: 백테스트는 Lab 명령(`run-history.sh` 등)으로 실행한다. 게이트웨이·포털에서 `backtest` 경로를 뺐고 사용자 서비스 `ninepay-kis-backtest-ui`(18301)·`ninepay-kis-backtest-api`(18802)를 중지·비활성화했다. 소스·빌드·Lean 데이터(`backtester/.lean-workspace`, 빌더 종목 검색이 사용)는 보존한다. 복구는 두 서비스 `enable --now`와 게이트웨이 이전 버전 복원.
- `oracle_guard.py`는 기존 Lab 어댑터의 추적 가능한 원본이다(서버 `app-20261101/lab_guard.py`). 원래 종목 검색 함수를 재사용하며 과거 목록에 `exchange=krx`/`exchange_name=KRX` 계약을 보충한다. 거래소 세부 분류는 확인되지 않아 추정하지 않고 상태에 `exchangeBreakdownAvailable=false`를 명시한다. 저장된 3,917개 종목을 표시하며 신규 마스터 수집은 차단한다.
- `patch_ui.py`는 원본을 보존한 `frontend-web`에서만 미인증 배지를 백데이터로 바꾸고 브로커 설정 버튼을 제거한다. 실제 증권 인증 상태를 참으로 위장하지 않는다.
- nginx `/kis-tool/`만 게이트웨이로 전달한다. 기존 운영 API 서비스/인증/자동매매 설정 변경·재시작 없음. nginx는 검사 후 reload.
- 이번 변경 전 UI 서비스 파일·nginx 설정·기존 게이트웨이(있는 경우)를 Lab `backups/web-*`에 보관했다. 원본 데이터와 기존 UI 빌드 보존.
- PC SSH 터널 없이 HTTPS로 사용. 자동매매가 표시되면 KIS 메뉴도 바로 옆에 표시된다. 클릭 후 기존 사이트 관리자 Google 계정 인증이 필요하며 티스토리 표시 상태는 서버 권한을 부여하지 않는다.
- 자동 증분 수집 기능을 추가하지 않았다. 종목별 데이터 기간이 다르며 고가 사후 도달값은 실제 체결 수익률이 아니다.

## 검증·제거

- `python scripts/kis-lab/test_gateway.py`: 익명/일반/네이버/인증 실패 차단, CORS, 쿠키 격리, 고정 프록시, 주문 차단, CSRF, 경로 검증.
- `node test/test_kis_menu.js`: Playwright 설치 환경에서 1280/900/390px 관리자 메뉴 인접 배치와 Google 로그인만 한 방문자의 숨김, Google 상태와 메뉴 표시 조건의 분리 검증. `PLAYWRIGHT_MODULE`로 설치 위치 지정 가능.
- 실제 서버 UI/정적 자산/전략 목록, 캐시 전략 실행 및 Lean 백테스트를 별도 프로세스의 테스트 인증 fixture로 검증한다. 실제 사용자의 Google 브라우저 로그인 확인과 구분한다.
- 제거 시 메뉴/NineAPI 연결 제거 → nginx의 `/kis-tool` 두 location 제거 및 검사/reload → 독립 gateway 중지. Lab 데이터·분석 결과는 보존한다. 필요 시 UI 서비스 파일을 `backups/web-*`에서 복원하고 Lab UI만 재시작한다.

- 2026-11-14: 포털의 ‘1. 전략’ 묶음 제목만 제거, 전략 빌더/분석/주문 차단은 유지한다. portal.html은 게이트웨이가 요청마다 읽으므로 파일 반영만으로 적용하며 독립 Lab/운영 API/실거래 서비스를 재시작하지 않는다.

- 메뉴별 체크와 직접URL을 일치시키기 위해 기존 Google 관리자 검증 뒤 공통 `/access-policy`의 kis.allowed도 확인한다. 실패/OFF는 자산·분석 API를 함께 차단한다. 이 게이트웨이 변경만 독립 사용자 서비스 ninepay-kis-web 재시작이 필요하며, 거래·빌더 엔진은 재시작하지 않는다.
