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
