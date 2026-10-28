# skin.html 미반영 항목

`skin.html`은 티스토리 관리자(스킨 편집기)에서만 고칠 수 있다. git push로는 운영 화면에
닿지 않는다. 이 문서는 **리포의 `skin.html`은 이미 맞는데 운영 스킨이 낡아서 생기는
문제**와, 그것 때문에 임시로 넣어둔 런타임 우회를 모아 둔다.

## 규칙

- `skin.html`을 바꾸면 해결되는 문제에 **런타임 우회를 새로 만들지 않는다.** 여기에
  기록만 하고 사용자에게 알린다(2026-09-05 사용자 지시: "html 바꾸면 되는 문제는
  기억만해, 땜질식으로 수정할 필요없어").
- 이미 들어가 있는 우회는 지우지 않는다. 지금 운영 화면이 그걸로 버티고 있어서,
  먼저 지우면 반영 전까지 화면이 나빠진다. 반영 뒤에 함께 걷어낸다.
- 티스토리가 **매 요청마다 주입**하는 것(파비콘 link 등)은 여기 해당하지 않는다.
  스킨을 갱신해도 계속 주입되므로 런타임 처리가 정상 해법이다.

## 반영 방법

티스토리 관리자 → 스킨 편집 → HTML에 이 리포의 `skin.html`을 붙여넣고 저장.

## 홈 첫 페인트 정리 — 2026-10-28 (사용자 직접 반영 예정)

사용자가 GitHub의 `skin.html`을 직접 복사해서 적용하기로 했다. Pages JavaScript 배포만으로 완료됐다고 보고하지 않는다.

- `<head>`에서 기존 `home-market-board.css`를 정적 stylesheet로 먼저 로드한다. 기존 JS 로더와 같은 URL/`data-home-market-board-css` 표식을 사용하여 중복 로드를 막는다. 이 파일의 규칙은 홈에 한정되며 다른 페이지의 스타일을 바꾸지 않는다.
- 홈 경로에만 `home-render-pending`을 먼저 붙인다. 재배치할 직속 글/공지 카드·페이지 번호만 잠시 준비 안내로 대체한다. 내비게이션·페이지 전체·최종 대시보드·API 응답을 숨기지 않는다.
- `buildHomeDashboard`가 동기 레이아웃과 브리핑 재배치를 마치면 즉시 표식을 제거한다. API나 선택 위젯을 기다리지 않는다. 스크립트 실패 시 6초 후 원래 글 목록을 표시한다. JavaScript를 끄면 표식 자체가 없어 기존 글을 바로 읽을 수 있다.
- 원래 홈페이지 HTML+수정한 스킨 조각/JS를 사용한 로컬 브라우저에서 1440/390px × 정상/JS 1.5초 지연/CSS 1.5초 지연 6사례, 실패 복구 및 스크립트 없는 상태 2사례를 확인했다. 임시 원문 카드 노출0·미스타일 대시보드 노출0·대시보드 중복0·가로 넘침0. 속도 개선이나 운영 반영 완료의 증거로 사용하지 않는다.
- 적용: GitHub `master/skin.html`의 Raw 전체를 티스토리 관리자 → 스킨 편집 → HTML에 복사하고 적용한다. 롤백은 적용 전 스킨 HTML을 복원한다. 서버/실거래 설정 변경은 없다.

## 지금 밀려 있는 것

**2026-10-23 아이콘 정비로 새로 생긴 항목 (skin.html 직접 수정 필요, 우회 안 만듦).** 상단 오른쪽 `.nav-icons`의 SVG는 티스토리 치환 태그(`[##_guestbook_link_##]`) 안에 있어 JS 주입으로 옮길 수 없다. 아래를 `skin.html`에 반영하면 된다(저장소 `skin.html`은 아직 옛 모양 그대로다).

- 방명록 링크(`href="[##_guestbook_link_##]"`)의 아이콘이 **종 모양**(알림)이라 방명록 뜻과 맞지 않는다. 말풍선(Lucide `message-circle`)으로 바꾸는 것을 권한다: `<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>` (stroke 2, 17×17 그대로).
- 나머지 4개(검색 돋보기·글쓰기 연필·관리자 톱니·로그아웃)는 뜻이 맞고 선 굵기도 같아 그대로 둔다.

**그 밖에는 없다.** 2026-10-12 사용자가 서랍 첫 페인트 여백 수정이 담긴 `skin.html`을 티스토리 관리자에 반영했고, 라이브 HTML에서 새 머리말 스크립트(`wl_drawer_open_v1` → `html.wl-open`)를 확인했다. 서랍 열림 저장 상태에서 첫 화면부터 `html.wl-open`·본문 여백 378px가 잡히고 본문 `.feed` 폭이 950px로 안정되며 레이아웃 이동(CLS)이 기록되지 않았다.

(그 앞 상태) 2026-09-11 사용자가 저장소의 `skin.html`을 티스토리 관리자에 반영했다.

라이브 HTML 실측(`ghlee.tistory.com/`, api-probe)으로 확인한 것:

- 네비 로고 `<img>`가 `img/brand-banner.png?v=20260905-banner-v2` — 새 경로
- `.nav-logo-icon.nav-logo-emblem` 컨테이너 존재
- `<span class="nav-logo-name">ㄱㅖ조 ㅏ심폐소생술</span>` — 새 문구가 마크업에 직접
- `nav-icons`에 옛 MY 아이콘(`.nav-my-btn`)도 폰트 전환 버튼(`#fontModeBtn`)도 없음

### 반영과 함께 걷어낸 것 (2026-09-11)

- `js/skin-menu.js`의 `removeLegacyFontToggle()` — 옛 폰트 전환 버튼 제거·`font-gothic`
  클래스 해제·`bolt-font` 로컬스토리지 정리. 이제 버튼이 마크업에 없고, 저장소 어디에도
  `font-gothic`을 **붙이는** 코드가 없다(CSS는 `html:not(.font-gothic)`로 읽기만 한다).
- `js/skin-menu.js`의 `.nav-my-btn` 런타임 제거
- `js/skin-menu.js`의 로고 텍스트 런타임 덮어쓰기
- `style.css`의 `.nav-font-btn { display: none !important; }` — 맞는 요소가 없어졌다

`test/test_ui_ia.py::test_stale_skin_workarounds_are_gone_after_the_skin_was_applied`가
이 상태를 고정한다(우회 코드가 없고, 스킨에 그 UI가 없다는 것 양쪽).

### 걷어내지 않은 것과 그 이유

- **`img/heart-monitor.svg` 삭제 — 못 한다.** 이 문서의 2026-09-05 판에는 "아무도
  참조하지 않게 되므로 삭제 가능"이라고 적혀 있었는데 **틀렸다.** `legal/privacy.html`,
  `legal/terms.html`, `legal/opensource-license.html`, `legal/guide.html`이 아직
  파비콘 `<link>`로 이 파일을 가리킨다. 지우면 그 네 페이지 파비콘이 깨진다. 정리하려면
  legal 4개를 `img/favicon.png`로 함께 옮겨야 한다(별건).
- **`style.css`의 `.nav-logo-emblem` 배경 + `.nav-logo-emblem img { display: none; }`** —
  둘 다 남긴다. 지금 배경과 `<img>`가 **같은** `brand-banner.png`를 가리키므로 어느 쪽으로
  그리든 결과가 같고, 한쪽을 지우는 건 렌더 방식만 바꾸면서 겹쳐 보일 위험만 생긴다.
  얻는 게 없다.
- **`js/skin-shell.js`의 파비콘·홈 화면 아이콘 link 교체** — 남겨야 한다. 티스토리가
  `<head>`에 자기 아이콘 link 3개를 **매 요청마다** 주입하므로(2026-09-04 실측) 스킨을
  갱신해도 계속 걷어내야 한다.

## 관심종목 서랍 첫 페인트 여백 (2026-10-11 발견 · 2026-10-12 구현·skin.html 반영 완료)

**대시보드(홈) 휴장 화면에서 관심종목 드로어가 "열림"으로 저장돼 있으면 본문 폭이 좁아졌다 넓어졌다.** 라이브 실측(1366px): 본문 `.feed` 폭이 `1019 → 641 → 951`(닫힘 저장 상태는 `1019 → 1329`).
`stock-search-panel.js`(첫 번째 defer 스크립트)가 저장된 열림 상태를 바로 적용해 `body{padding-right:378px}`가 걸리고, 그 뒤 `skin-main.js`가 홈 레이아웃을 만들면서 폭이 다시 넓어진다.

구현(2026-10-12):
- `skin.html` `<head>` 첫 인라인 스크립트 바로 뒤에 `wl_drawer_open_v1==='1'`이면 `html.wl-open`을 붙이는 스크립트를 추가했다(전용 MY 화면 `/page/watchlist`는 전역 서랍이 없어 제외, 서랍이 6초 안에 안 뜨면 클래스를 걷어 빈 여백이 남지 않게 함).
- `style.css`의 서랍 열림 레이아웃 규칙 11개가 기존 `body:has(.global-watchlist-drawer.is-open)`에 더해 `html.wl-open.wl-open body …`도 받는다(명시도 동일, PC 1024px 이상 한정 그대로).
- `js/stock-search-panel.js`의 `setWatchlistDrawerOpen()`이 서랍을 열고 닫을 때 `html.wl-open`을 함께 켜고 끈다.
- 결과: 열림 저장 상태에서도 첫 페인트부터 378px 여백이 잡혀 폭이 `641 → 951`로 한 방향(닫힘 저장 상태의 `1019 → 1329`와 같은 방식)으로만 바뀐다.
- 검증: `test/test_watchlist_drawer_first_paint.py`(스킨·서랍 스크립트·CSS가 같은 이름을 쓰는지), 로컬에서 `html.wl-open`만으로 body 오른쪽 여백·네비 `right`가 378px, 기존 `:has()` 경로 유지, `.iframe-mode` 제외 확인.
- 반영: 2026-10-12 사용자가 티스토리 관리자에 반영 완료. 라이브 확인(1366px, 열림 저장 상태): `html.wl-open`·`.global-watchlist-drawer.is-open`·body 오른쪽 여백 378px, `.feed` 950px, layout-shift 0건.
