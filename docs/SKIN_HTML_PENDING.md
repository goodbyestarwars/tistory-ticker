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

## 지금 밀려 있는 것

**1건 — 관심종목 서랍 첫 페인트 여백(2026-10-12 구현).** 저장소의 `skin.html` 머리말에 짧은 스크립트가 추가됐다(아래 마지막 절). 티스토리 관리자에 `skin.html`을 붙여넣어야 효과가 난다. 반영 전에는 예전과 같이 휴장 화면 폭이 좁아졌다 넓어지고(JS·CSS는 하위 호환), 반영하면 사라진다. 그 밖의 밀린 항목은 없다.

(이전 상태) 2026-09-11 사용자가 저장소의 `skin.html`을 티스토리 관리자에 반영했다.

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

## 관심종목 서랍 첫 페인트 여백 (2026-10-11 발견 · 2026-10-12 구현, skin.html 반영 대기)

**대시보드(홈) 휴장 화면에서 관심종목 드로어가 "열림"으로 저장돼 있으면 본문 폭이 좁아졌다 넓어졌다.** 라이브 실측(1366px): 본문 `.feed` 폭이 `1019 → 641 → 951`(닫힘 저장 상태는 `1019 → 1329`).
`stock-search-panel.js`(첫 번째 defer 스크립트)가 저장된 열림 상태를 바로 적용해 `body{padding-right:378px}`가 걸리고, 그 뒤 `skin-main.js`가 홈 레이아웃을 만들면서 폭이 다시 넓어진다.

구현(2026-10-12):
- `skin.html` `<head>` 첫 인라인 스크립트 바로 뒤에 `wl_drawer_open_v1==='1'`이면 `html.wl-open`을 붙이는 스크립트를 추가했다(전용 MY 화면 `/page/watchlist`는 전역 서랍이 없어 제외, 서랍이 6초 안에 안 뜨면 클래스를 걷어 빈 여백이 남지 않게 함).
- `style.css`의 서랍 열림 레이아웃 규칙 11개가 기존 `body:has(.global-watchlist-drawer.is-open)`에 더해 `html.wl-open.wl-open body …`도 받는다(명시도 동일, PC 1024px 이상 한정 그대로).
- `js/stock-search-panel.js`의 `setWatchlistDrawerOpen()`이 서랍을 열고 닫을 때 `html.wl-open`을 함께 켜고 끈다.
- 결과: 열림 저장 상태에서도 첫 페인트부터 378px 여백이 잡혀 폭이 `641 → 951`로 한 방향(닫힘 저장 상태의 `1019 → 1329`와 같은 방식)으로만 바뀐다.
- 검증: `test/test_watchlist_drawer_first_paint.py`(스킨·서랍 스크립트·CSS가 같은 이름을 쓰는지), 로컬에서 `html.wl-open`만으로 body 오른쪽 여백·네비 `right`가 378px, 기존 `:has()` 경로 유지, `.iframe-mode` 제외 확인.
- 반영 방법: 티스토리 관리자 → 스킨 편집 → HTML에 이 리포의 `skin.html`을 붙여넣고 저장. 반영 뒤 라이브에서 `.feed` 폭 변화를 다시 재 확인한다.
