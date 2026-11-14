# 화면 접근 정책 (2026-11-11)

비로그인·일반 회원은 **대화방(/guestbook)·캘린더·마켓브리핑·시장지표** 4개 화면만, 서버가 확인한 Google 관리자 세션은 기존 9Pay 전체. 증권사 시세의 제3자 제공이 불허된 경우를 전제로 **일반 회원에게 인증만으로 제한 시세를 열지 않는다**(회원 대상 제공은 별도 이용허가 확보 후 새 결정). 인증 체계는 기존 `/auth/google/me`·`google_admin_session` 쿠키를 그대로 쓴다.

## 구성
| 층 | 파일 | 역할 |
|---|---|---|
| 정책·저장 | `scripts/cloud-vm/access_policy.py` | 화면 11종·공개 4종 고정·`guestbook` 고정 ON·제한 REST 접두사 목록·원자 저장(`access_policy_state.json`, 실패 시 이전 정책 유지, 손상 시 기본값) |
| API | `main.py` | `GET /access-policy`(뷰어별 allowed), `PUT /access-policy`(관리자+Origin), HTTP 미들웨어(제한 경로 401/403/503), `/ws/quotes` accept 전 거절 |
| 판정 | `js/access-gate.js` | `NineAccess` 단일 조회·공유. 경로→화면, 직접 URL 이동(`/guestbook`, 반복 없음), 로그인 후 원래 화면 1회 복귀, fail-closed, goodbyestar.cloud 요청에 세션 쿠키 자동 포함 |
| 메뉴 | `skin-menu.js`·`home-mobile-tabs.js` | 같은 판정으로 PC 메뉴·모바일 탭바·서랍 구성, 판정 전/장애는 공개 4개 |
| 전역 도구 | `stock-search-panel.js`·`skin-main.js` | 검색·관심종목 서랍·메모는 관리자 확인 뒤에만 시작 |
| 설정 UI | `js/access-settings.js` | 관리자 메뉴 `화면 설정`: 서버에만 저장, 모든 접속자 공통 |

## 서버 분류
- **제한(관리자 전용)**: 종목 단위 시세·분석·수급·검색기·종목판 계열(`RESTRICTED_PREFIXES`). 비로그인 401, 일반 회원 403, 인증 미설정 503, 본문에 데이터 없음. `/ws/quotes`는 관리자만.
- **공개 유지**: 시장지표·캘린더·브리핑·뉴스·환율·선물·`/ws/market-indicators`·`/ws/economic-news`·`/health`·인증.
- 이미 사용자 인증인 `/watchlist`·`/memo`·`/chart-drawings` 등은 그대로(저장 구조 불변). 자동매매는 기존 관리자 경로 그대로.
- **미확정(운영자 판단)**: 시장지표 화면의 `/futures`·`/domestic-market-indicators`·`/fx-rates`·`/kofia-market`은 KIS/키움/네이버 등 공급자 약관상 공개 가능 여부를 확인하지 않았다. 지금은 공개 화면 데이터로 유지한다. 비공개로 돌릴 항목은 `RESTRICTED_PREFIXES`에 추가(사이트 화면은 해당 지표가 비게 됨).
- GAS 프록시·GitHub Pages 정적 데이터(`data/*.js`)는 이 게이트 밖이다. 제한 대상 시세가 정적 파일에 있는지는 별도 점검 항목.

## 운영
- 롤백: 프런트는 `access-gate.js` 로드를 끊으면 기존 화면(서버 제한은 유지, 제한 데이터를 다시 공개로 돌리지 않음). 정책 파일 삭제 = 기본(전부 ON).
- 배포 순서: VM(`scripts/cloud-vm`) → Pages. 장중 VM 재시작 금지. **서버 제한이 먼저 켜지면 옛 프런트(세션 쿠키 미전송)의 관리자 화면 호출이 401**이므로 두 배포 사이를 짧게 둔다.
- skin.html: `docs/SKIN_HTML_PENDING.md` 참고(없어도 동작, 반영하면 첫 페인트 전 판정).
- 테스트: `test/test_access_policy.py`(8), `test/test_access_gate.js`(vm), `test/test_access_menu.js`(Playwright 12 시나리오+모바일 탭). 기존 `test_kis_menu.js`는 관리자 세션 스텁을 주입하도록 갱신.

## 변경 (2026-11-11 후속)

- 시장지표(`indicators`)는 **로그인 회원 등급(level=member)**: 비로그인에는 메뉴·모바일 탭·랜딩에서 빠지고 직접 URL은 /guestbook으로 이동한다. 비로그인 공개 화면은 대화방·캘린더·마켓브리핑 3개이며, 4번째 자리에는 이야기 시리즈(learn/, 정책 대상 아님·항상 공개)를 둔다.
- 시장지표 데이터 REST(/futures, /fx-rates 등)는 여전히 공개 응답이다. 화면 접근만 로그인 후이며 데이터 제한은 공급자 이용권한 확인 뒤 별도 결정한다.
- 랜딩 네이버 버튼은 `/access-policy.naverConfigured`가 없으면(VM 미배포) `/auth/google/me.naverConfigured`로 확인한다. 랜딩 사진은 `img/landing-interlaken.jpg`가 있으면 SVG 장면 위에 덮인다.

## 변경 (2026-11-12 비회원 입장)

- 시작 화면은 [로그인](모달, 기존 Google/네이버/카카오)·[비회원 로그인](인증 없음, `sessionStorage nine_guest`, 탭 단위·새로고침 유지) 두 버튼. 비회원은 인증된 상태가 아니며 서버 정책 판정은 비로그인과 같다.
- 공개 화면에 `news`(주요 뉴스) 추가. 비회원 메뉴: 홈·시장(주요뉴스·마켓브리핑)·캘린더·대화방. 비회원 홈은 `js/guest-home.js`가 마켓브리핑+이야기 시리즈만 그린다(대시보드·시세 요청 없음). 관리자가 아닌 로그인 계정도 같은 홈.
- 서버 배포 전(`news` 미노출)에는 클라이언트가 `news`를 공개로 간주한다. skin.html 수동 반영 불필요.

## 2026-11-12 연구 후보 수집 인증 복구

연구 수집기의 익명 `/pattern-scan` 조회가 401로 실패하던 것을 기존 제어 HMAC 검증으로 인증한다. Google의 기존 CONTROL_SECRET과 Oracle의 기존 AUTOTRADER_CONTROL_SECRET을 그대로 사용한다(새 키·복사 없음). `X-Ts`/`X-Sig` 서명 본문은 `GET /pattern-scan` 고정 바이트이며 60초 창, 정확한 GET/경로에만 유효하다. 제어 sync 본문 서명과 분리하며 익명·일반 회원 제한과 주문 게이트는 유지한다.

## 2026-11-12 원천 시세 API 접근 차단(공급자 권한 확인 전)

- 관리자 전용: `/futures` 및 하위 `/futures/avg`·`/futures/refresh-macro` 등 경로 전체. `access_policy.RESTRICTED_PREFIXES`의 공통 HTTP 미들웨어가 비로그인 401, 일반 회원 403(관리자 인증 설정 오류 503)으로 거절한다. 내부 서버 호출의 기존 X-API-Key 예외는 유지.
- 관리자 전용: `/ws/market-indicators`. 기존 Origin 검사에 더해 `_access_denied(websocket)`를 `websocket.accept()` **이전**에 실행한다. 비관리자는 1008 종료, 최초 스냅샷 및 스트리밍 데이터 모두 미전달.
- 일반 회원 `indicators` 화면 등급은 기존 `member` 그대로 유지되지만, 위 두 경로의 시세는 접근 불가하다. 비회원 홈·뉴스·마켓브리핑·캘린더·대화방과 이외 API·키움/KIS 수집·주문 기능은 불변.
- 이는 공개 화면에서 원천 시세가 노출되던 경계 수정이며 공급자별 재배포 권한 확인·공개용 데이터 교체와 별개. `/domestic-market-indicators`·`/fx-rates`·`/kofia-market` 등 **다른 API의 권한 상태는 변경하지 않았다**.
- 배포: master → Oracle `kiwoom-deploy.timer` 경로. 평일 08:00~20:00 KST에는 `deploy_check.sh`가 VM 코드 변경의 pull·복사·재시작을 보류하고 20:00 이후 재시도한다. GitHub 커밋과 운영 적용을 구분해 확인한다.


## 2026-11-12 화면 설정 역할별 분리

- 관리자 화면 설정은 **비회원 / 일반회원 / 관리자** 3열이다. `SCREENS`의 `public/member/admin`은 최대 허용 등급으로 유지하며, 관리자 화면을 비회원·일반 회원에게 공개하는 체크박스는 제공하지 않는다(서버에서도 거부).
- `PUT /access-policy`는 신규 `roles: {screen: {guest/member/admin: bool}}`를 받는다. 기존 `screens: {screen: bool}` 요청과 저장 파일을 유지하고, 신규 역할별 설정이 우선한다. 편집용 `roles`는 서버가 확인한 관리자에게만 응답하고 비관리자는 자신에게 허용된 `allowed`만 받는다.
- 대화방(`guestbook`)은 세 역할 모두 필수 ON이다. 홈(`/`)의 비회원·일반회원용 브리핑은 기존 예외 동작이고 설정의 `home`은 관리자 대시보드만 뜻한다.
- UI는 서버에서 역할별 상태를 응답하기 전까지 저장을 비활성화한다(평일 VM 배포 보호시간 동안 구 서버에 신규 요청 전송 금지). `NineAccess`·PC/모바일 메뉴·직접 URL의 기존 `allowed` 판정을 재사용하며 원천 시세 REST/WS 접근 제한과 거래/주문 경계는 변경하지 않는다.
- 검증 기준: `test/test_access_policy.py`(역할 독립·구형 이관·허용 등급·필수 항목)·`test/test_access_gate.js`·`test/test_access_menu.js`. 티스토리의 정적 페이지를 메뉴에서 숨기는 것은 서버 콘텐츠 보안과 다르므로 제한 데이터는 별도 API에서 계속 보호해야 한다.


## 2026-11-14 관리자 관리형 일반회원 확대 (이전 화면 등급 설명보다 우선)

- 공개/미등록 로그인 계정의 기존 권한은 보존. Google 이메일 검증+관리자 허용목록 계정만 `home/stocks/tools/my/market-temp` 일반회원 열 적용. `scanner/strategy`를 종목에서 분리하여 메뉴·직접URL 모두 관리자만. 자동매매·KIS·화면설정은 계속 관리자 전용.
- `/access-policy`는 `isMember`를 추가하고 개인화 응답 no-store. `GET /access-policy/members`는 Google 관리자만 목록·revision·최근20건 감사 반환, `PUT`은 같은 관리자+허용Origin+분당 제한으로 `{email,action:add|remove}`만 처리. 이메일 trim/lowercase/형식/254자/최대1000명 검증, 중복·없는 이메일 해제는 멱등. 비공개 VM `access_members_state.json`에 revision·최근200건 감사(actor/action/email/at)를 원자 저장, 프로세스/스레드 잠금. 저장 실패는 이전 상태 보존, 손상 시 확대 권한 차단·수정 거절.
- 새 Google OAuth의 검증 결과만 서명 세션 `email_verified:true`로 전달. 기존 세션·네이버 이메일·이메일 입력만으로 승격 불가. 기존 사용자는 Google 재로그인 필요. 해제는 다음 정책 조회 즉시 반영하며 이미 열린 화면은 새로고침 시 재판정(민감 API 권한은 원래 관리자만).
- schemaVersion2 이전 화면 저장은 확대된 5개 일반회원 열을 ON으로 이관, 비회원/관리자 열은 그대로. 이후 설정 OFF는 보존. 기존 screens/roles PUT 계약 유지.
- **화면 허용과 데이터 권한은 별개:** RESTRICTED_PREFIXES와 REST 401/403, WS accept 전 관리자 검사, 서버 내부 키/HMAC 예외, 계좌/주문/자동매매/API 운영은 변경 없음. 종목 시세·차트·시장맵은 일반회원에게 데이터를 제공하지 않으며 기존 제한 안내/빈 상태가 남을 수 있음. GAS/정적 공개 자료는 기존 범위 유지.
- 배포: master→Pages 및 Oracle 기존 사이트 API 배포만. Google 실거래 VM·봇·runner 재시작/명령 없음. Tistory 스킨 수동 반영 불필요.
- 검증: test_access_policy.py, test_access_members.py, test_access_members_api.py(수집기와 브로커 없는 실제 접근 라우트), test_access_gate.js, test_access_members_ui.js(Edge PC1280/390/320). 실제 계정 OAuth 로그인·관리자 운영 쓰기는 사용자 세션 없이 검증했다고 주장하지 않음.


## 2026-11-14 메뉴별 기본값·독립 체크(이전 묶음/상한 설명보다 우선)

- 공개 기본: guestbook/calendar/briefing/stories/news. 일반회원 기본: indicators/home/stocks/analysis/stock-search/tools/chart/my/watchlist/memo/market-temp/market-map. scanner/strategy 및 운영은 관리자 기본.
- 관리자가 editableRoles에 있는 역할별 체크를 저장한다. 원천 시세/계좌/주문/API는 별도 보호하며 autotrader/kis는 관리자 상한, 화면 설정은 관리자만. 홈 체크는 시장 대시보드만이며 뉴스/브리핑/이야기와 독립이다. 기본값 복원은 화면 체크만 바꾸고 저장 전 적용하지 않는다.
- schemaVersion3: analysis/stock-search는 stocks, chart는 tools, watchlist/memo는 my, market-map은 market-temp의 이전 역할별 체크를 이어받는다. 기존 묶음 키와 API 계약은 보존한다. 대화방 OFF도 가능하며 거부된 대화방은 홈 입장 화면으로 돌아가 반복 이동을 피한다.
- 모바일 탭·PC 메뉴·직접 URL·전역 검색/관심/메모는 독립 키를 사용한다. Google 서버 관리자 판정으로 운영 메뉴를 표시하며 Tistory ROLE을 운영 권한의 대용으로 사용하지 않는다. 실제 위험 명령/데이터 서버 검증은 변경하지 않는다.
- GET/PUT 관리자 검증/Origin·쓰기 제한·이메일 허용목록은 유지. 새로운 공개 시세 API/WS·GAS 폴백은 추가하지 않는다.
