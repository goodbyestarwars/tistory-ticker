# 메인 페이지 UI/UX 개편 — 설계 문서 (UI_RENEWAL.md)

> 작성일 2026-07-17. 이 문서는 **사전 설계 문서**이며 실제 코드 변경은 아직 시작하지 않았다.
> 다른 대화 세션에서도 이 저장소를 열면 이 문서를 그대로 참고할 수 있다.
> 원본 지시: 작업지시서(하단 "원본 작업지시서 요약" 참고) + `메인화면시안.pptx`.

---

## 0. 요약 — 먼저 읽을 것

- 이 저장소는 **티스토리(tistory.com) 스킨 + GitHub Pages 정적 자산 + Google Apps Script(GAS) 백엔드** 3단 구조다. React/Vue 같은 프레임워크나 번들러는 없고, 모든 JS는 `<script defer>` + IIFE 패턴의 vanilla JS다. 이 개편도 이 틀을 유지하는 것을 기본 전제로 설계했다(프레임워크 도입은 별도 논의 필요 — 8장 참고).
- **PPT 시안(`메인화면시안.pptx`)을 열어본 결과, 슬라이드 1장에 이미지 7개가 좌표별로 배치된 "배치 와이어프레임"이었고, 그 이미지 대부분이 이미 이 사이트에 구현되어 라이브 중인 위젯의 실제 스크린샷이었다.** 즉 이 PPT는 새 비주얼 디자인이 아니라 "기존 위젯을 이 순서로 재배치하자"는 레이아웃 순서 지시로 해석하는 것이 맞다. 상세 매핑은 1.3절 참고.
- 작업 중 **로컬 저장소가 origin보다 7커밋 뒤처져 있던 것을 발견해 `git pull --ff-only`로 동기화했다**(충돌 없음, 로컬 변경사항 없었음). 이 문서의 "현재 구조"는 동기화 이후 기준이다.
- 이 문서 작성만으로 확정할 수 없는 항목이 여러 개 있다 — **9장 "미해결 질문"을 반드시 검토하고 답을 준 뒤 구현에 착수할 것.** 특히 (a) Tistory 도메인을 유지할지, (b) 다크모드를 기본값으로 바꿀지는 구조 전체를 좌우한다.

---

## 1. 현재 구조 분석

### 1.1 인프라 4단 구조

| 계층 | 역할 | 배포 방식 |
|---|---|---|
| **Tistory (tistory.com)** | 블로그 도메인 자체. `skin.html`(전역 골격: 네비바/사이드바/글목록/댓글/방명록/카테고리), 그리고 각 기능별 "Page"(`/page/foreign-flow`, `/pages/invest-signal` 등, 같은 skin.html 골격 안에 커스텀 본문만 심음) | **Tistory 관리자 스킨 편집기에 수동 붙여넣기.** git push로 반영 안 됨(`skin.html`, `skin.html.bak`은 `.gitignore` 대상 — 캘린더 API 키 등 개인정보 포함) |
| **GitHub Pages** (`goodbyestarwars.github.io/tistory-ticker/`) | 정적 JS/CSS/데이터 파일 전체(`js/`, `css/`, `data/`, `img/`) | master push → 최대 10분 후 반영(`cache max-age=600`) |
| **Google Apps Script (GAS)** | 시세/뉴스/AI요약/증시온도/히트맵/수급/랭킹뉴스/패턴스캔/투자시그널 등 모든 API | `gas/ticker-proxy.gs` 수정 후 **script.google.com에서 수동 재배포** 필요 |
| **사용자 PC + VM(GCP e2-micro, 고정IP `34.28.220.13:8080` → 도메인 `GOODBYESTAR.CLOUD`)** | 공매도/대차거래/연기금(키움 API 온디맨드 `/investor-flow`, `/investor-flow-batch`), 차트패턴 스캔 SQLite. GAS의 `kiwoomVmFetch_()`가 이 서버를 호출(`js/foreign-flow.js`는 GAS를 경유, VM을 직접 호출하지 않음) | `kiwoom-deploy.timer`가 5분마다 자동 git pull+재시작(수동 SSH 불필요) |

이 4단 구조는 **이번 UI 개편으로 바뀌지 않는다.** 개편 범위는 오직 (a) Tistory에 붙여넣는 `skin.html`/각 Page 본문, (b) GitHub Pages의 `js/`·`css/` 파일뿐이다. GAS 엔드포인트·VM 배치는 그대로 재사용한다.

### 1.2 skin.html의 현재 화면 구성 (홈 `/` 기준, 위→아래)

```
<head> 다크모드/폰트 조기적용, preconnect, style.css 등 로드
<nav class="navbar">
  햄버거(모바일 전용, 데스크탑엔 안 보임) | 로고 | 검색창(작음) | 폰트토글 다크토글 방명록 검색 글쓰기 관리자 로그아웃 아이콘들
<div id="market-ribbon">                     ← 지수/환율/코인 리본 (js/market-ribbon.js)
<div id="home-dashboard">                    ← 홈 전용 대시보드 (js/home-dashboard.js, 아래 1.4절)
<div class="page-wrap">
  <div class="main-layout">  (max-width 1380px 3단 그리드)
    <aside class="sidebar-left">
      nav-menu-mount            ← 커스텀 메뉴 (js/skin-menu.js) + 하단 종목검색 인풋
      카테고리 목록
      구글 캘린더 위젯 (모달 트리거)
      방문자 통계
    <section class="feed">
      공지사항 → 글 목록(post-card 반복) → 방명록 → 페이지네이션
    <aside class="sidebar-right">              ← 홈("/")에서만 보임, 다른 페이지는 CSS로 숨김
      인기글 TOP5
      해시태그
      copyright
```

핵심: **네비바/사이드바/피드 골격은 Tistory가 모든 페이지(홈, 카테고리, 개별 글, `/page/*`, `/pages/*`)에 동일하게 렌더링한다.** 즉 "공통 Header/Sidebar/Footer"는 이미 skin.html 한 파일로 전 페이지에 공유되고 있다(작업지시서 10번 항목이 요구하는 컴포넌트화가 구조적으로는 이미 되어 있다는 뜻 — 5장에서 다시 설명).

### 1.3 PPT 시안 이미지 → 실제 기존 위젯 매핑

슬라이드의 이미지 좌표(y값, EMU)를 위→아래로 정렬하면 다음과 같다. 슬라이드 캔버스 자체가 7.5"×13.33"(세로로 긴 모바일/스크롤형 캔버스)이다.

| 순서 | PPT 이미지 | 실제 정체 | 소스 파일 |
|---|---|---|---|
| 1 | 네비바 | 현재 skin.html 네비바 (라이트 테마 그대로) | skin.html |
| 2 | 지수 리본 (코스피/코스닥/나스닥선물/필라델피아/원달러/원유/BTC/VIX/코스피야간선물/S&P500선물/다우선물) | `market-ribbon.js` | `js/market-ribbon.js` |
| 3 | 대형 캔들차트 (지수/종목 선택 + 이동평균 5/20/60/120 + 기간탭 + 지지/저항) | **`home-dashboard.js`의 `hd-card-chart`** (Lightweight Charts) | `js/home-dashboard.js` |
| 4(좌) | 오늘의 증시온도 게이지(28.0℃, VIX/수급/거래대금/등락률/상승비율/섹터강도/신고신저/환율/미국선물지수 세부 막대) | **`market-temp.js`**를 `gaugeOnly` 모드로 재사용 (home-dashboard 안에서도 동일 위젯 재사용 중) | `js/market-temp.js` |
| 4(우) | 관심종목 리스트(비에이치아이/에코프로비엠/NAVER/현대차/한화오션 등, X 삭제) + 종목검색 + 선택종목 AI요약(Groq) + 관련뉴스 | **`watchlist.js`(좌측 리스트) + `stock-news.js`(검색·AI요약·관련뉴스)** 조합 | `js/watchlist.js`, `js/stock-news.js` |
| 5 | 코스피/코스닥 시총 트리맵 히트맵(삼성전자 1599조 +4.0% 등) | **`marketcap-bubble.js`** (home-dashboard 안에서도 재사용 중) | `js/marketcap-bubble.js` |
| 6 | 랭킹뉴스 · 증시 헤드라인 TOP10 | **`home-dashboard.js`의 `hd-card-rank`** | `js/home-dashboard.js` |
| 7 | 마켓 브리핑 포스트 피드(카드형, 공유/더보기 버튼) | 현재 `post-card` 글 목록 그대로 | skin.html의 `s_article_rep` 루프 |

**중요한 발견**: `home-dashboard.js`(2026-07-16 신설, 이번 git pull로 확인됨)가 이미 [3][4좌][5][6]을 2열 그리드 카드로 홈 최상단에 구현해뒀다. PPT가 보여주는 배치는 **이 기존 컴포넌트에서 카드 순서/스타일만 다듬고, 거기에 [4우](관심종목+AI요약)를 추가로 얹은 것**과 거의 동일하다. 즉 이번 개편의 실체는 "0에서 새로 만드는 Hero"가 아니라 **"이미 있는 home-dashboard를 강화 + 재배치 + 리스타일링"** 이다.

**작업지시서 텍스트 vs PPT 이미지의 불일치**: 작업지시서는 "오늘의 투자시그널"(별점/등급)과 "AI 관심종목"을 Hero 바로 아래 상단에 명시적으로 요구하지만, PPT 이미지 7장 중 "오늘의 투자시그널"(`js/invest-signal.js`의 매수~매도 5등급 분포) 스크린샷은 없다. 관심종목(4우)은 있지만 투자시그널 요약 카드는 PPT에 없다. → **9장 질문 1 참고, 사용자 확인 필요.**

### 1.4 `home-dashboard.js` 상세 (2026-07-16 신설, 가장 최근 기능)

- 마운트: `#home-dashboard` (skin-shell.js가 빈 div로 심어두고, `.page-wrap` 바로 앞 = 풀블리드 폭)
- 홈페이지(`/`) 전용 가드 — 다른 페이지에서는 빈 div로 남아 화면에 영향 없음
- 2열 CSS 그리드(`hd-grid`, max-width 1600px): 대형차트(풀폭) → 증시온도 게이지 / 시총트리맵 → 랭킹뉴스TOP10 / AI시황요약(Groq) → 공시티커(풀폭)
- 차트는 `js/lwc-common.js`(신설, TradingView Lightweight Charts 공용 로더) 재사용
- 라이트 테마 하드코딩(`background:#fff`, `#f7f8fa` 등) + `html.dark #home-dashboard ...!important` 오버라이드 별도 정의 — **디자인 토큰화가 안 된 상태**라 이번 개편에서 가장 먼저 손댈 대상

### 1.5 디자인 현황

- 색상: 인라인 하드코딩 값(`#fff`, `#eee`, `#333`, `#d24f45`/`#1261c4` 상승/하락 등)이 각 CSS 파일에 개별 정의됨. 공유 CSS 커스텀 프로퍼티(디자인 토큰) 시스템 없음 — `style.css` 전체에 `:root { --* }` 정의가 사실상 전무(`--qi-height` 하나뿐, `css/quick-indices.css` 소유)
- 다크모드: `html.dark` 클래스 토글, **기본값은 라이트**(localStorage에 저장된 게 없으면 라이트로 시작)
- 카드: 각 위젯(`hd-card`, `post-card`, `sidebar-card` 등)이 각자 `border-radius`/`box-shadow`/`padding` 값을 따로 정의 — 파일 수 기준 19개 CSS 파일, 총 7,951줄
- 뉴스 카드(`post-excerpt`): `js/skin-main.js`가 런타임에 텍스트를 정리해서 넣고, 3줄 클램프는 `style.css`가 담당 — 이미 부분적으로 구현되어 있음(작업지시서 7번 요구사항의 상당 부분은 이미 존재, 2줄 제목 클램프만 추가 필요할 가능성)
- 사이드바 우측(인기글/해시태그)은 **이미 홈(`/`)에서만 보이도록 CSS로 제한되어 있음**(`full-width-page` 클래스, style.css:2453) — 제거 범위가 skin.html의 해당 블록 + `.sidebar-right` 관련 CSS로 국한됨, 생각보다 작은 작업

---

## 2. 변경 대상 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `skin.html` (Tistory 붙여넣기, git 미추적) | 네비바 축소(햄버거만), Hero mount 추가, 종목검색 위치 이동, `sidebar-right`(인기글/해시태그) 블록 삭제 |
| `style.css` | 디자인 토큰(`:root { --* }`) 도입, 카드 공통 클래스 정리, `post-card`/`post-excerpt` 2줄 제목 클램프 추가, `.sidebar-right` 관련 규칙 정리 |
| `js/skin-shell.js` | Hero mount(`shell-hero`) 추가 |
| `js/skin-menu.js` | (메뉴 항목은 대부분 이미 요구사항과 일치 — 문구/아이콘 미세조정 정도, 3장 참고) |
| `js/home-dashboard.js`, `css/home-dashboard.css` | 카드 순서/스타일을 디자인 토큰 기반으로 재작성, 관심종목+AI요약(watchlist+stock-news) 카드 통합 |
| `js/market-temp.js`, `css/market-temp.css` | 디자인 토큰 적용 (게이지 자체 로직 불변) |
| `js/marketcap-bubble.js`, `css/marketcap-bubble.css` | 디자인 토큰 적용 |
| `js/watchlist.js`, `css/watchlist.css` | 홈 대시보드 카드 안에서 렌더되도록 마운트 지점 옵션 추가 |
| `js/stock-news.js`, `css/stock-news.css` | 동일 |
| 나머지 위젯 CSS 전부(`foreign-flow`, `invest-signal`, `pattern-scan`, `sector-dashboard-v3`, `kospi-futures`, `overnight-market`, `quick-indices`, `market-ribbon`, `ticker-tooltip-v3`, `stock-search-panel`) | 색상/여백/radius 값을 디자인 토큰 `var()`로 치환 (기능 로직은 변경 없음, 각 페이지별로 순차 진행 — 8장 개발순서 참고) |

## 3. 신규 생성 파일

| 파일 | 역할 |
|---|---|
| `css/design-tokens.css` | 색상(배경/카드/텍스트/보더/상승·하락/accent)·spacing·radius·shadow·타이포 CSS 커스텀 프로퍼티. 라이트/다크 두 세트 정의. **모든 신규·기존 CSS가 이 파일의 변수만 참조하도록 강제** |
| `js/ui-components.js` | 프레임워크 없이 쓰는 소형 렌더 팩토리 함수 모음: `renderNewsCard(data)`, `renderStockCard(data)`, `renderSignalCard(data)`, `renderSectionHeader(title, opts)` 등. `home-dashboard.js`/`stock-news.js`/`invest-signal.js`/`watchlist.js`가 카드 마크업을 각자 문자열 조립하던 걸 여기로 모음(10장 컴포넌트화 요구사항의 vanilla-JS 버전) |
| `js/hero.js`, `css/hero.css` | 신규 Hero 영역. 오늘의 투자시그널 총평(등급/별점) + 증시온도 요약을 큰 카드로. 기존 GAS `?investSignal=1`, `?marketTemp=1` 캐시를 그대로 재사용(신규 GAS 액션 불필요 — 9장 질문 6에서 재확인) |
| `css/nav-drawer.css`(또는 style.css에 통합) | 햄버거 전용 슬라이드 메뉴 애니메이션(데스크탑에서도 동작하도록 확장 — 현재는 모바일 전용 로직) |
| `pages-src/*.html` | 각 Tistory Page(`/page/foreign-flow`, `/pages/invest-signal`, `/page/pattern-scan`, `/page/stock-news`, `/pages/overnight-market`, `/pages/kospi-futures`)에 **실제로 붙여넣는 본문의 git 추적용 정본(source of truth)**. Tistory 태그가 섞이지 않는 순수 mount+script 블록이라 git 추적 가능(9장 질문 2 확정 후 진행) |
| `test/home-page-full.html` | 새 홈 레이아웃(Hero+검색+대시보드+피드) 로컬 프리뷰 — 기존 `test/*.html` 패턴과 동일하게 mock/`?real=1` 지원 |

## 4. 삭제할 파일

| 파일 | 사유 |
|---|---|
| `js/short-pressure.js`, `css/short-pressure.css` | CLAUDE.md에 이미 "폐기 예정, 코드만 유지"로 명시됨. `foreign-flow.js` 병합 섹션이 완전히 대체함. **단, 티스토리에 단독 페이지로 임베드되어 있다면 그 Page도 사용자가 직접 정리해야 함(저장소에서 확인 불가)** — 삭제 전 사용자에게 해당 Page 존재 여부 확인 필요 |
| `js/pension-fund.js`, `css/pension-fund.css` | 동일 사유(`foreign-flow.js`가 진짜 연기금 데이터로 대체) |
| skin.html 내 `sidebar-right`의 인기글 TOP5 / 해시태그 블록 | 작업지시서 2번 요구사항. 파일 삭제는 아니고 마크업 제거(`s_rctps_popular_rep`, `s_random_tags` 관련 블록) — `style.css`의 대응 CSS(`.popular-list`, `.tag-cloud` 등)도 함께 정리 |

이번 개편 범위에서 **삭제하지 않는 것**: GAS(`gas/ticker-proxy.gs`), `data/*.js`, VM 스크립트, `test/*.html` 전부(신규 레이아웃 검증에 계속 필요) — 그대로 유지.

## 5. 공통 컴포넌트 (Header, Sidebar, Footer 등)

**구조적으로 이미 공통 컴포넌트가 존재한다**는 점이 이 프로젝트의 특수성이다. Tistory는 `skin.html` 하나를 모든 페이지(홈/카테고리/개별글/모든 Page)에 동일하게 렌더링하므로, 별도의 "Header.js/Footer.js/Sidebar.js" 컴포넌트 시스템을 새로 만들 필요가 없다 — `skin.html` + `js/skin-shell.js` + `js/skin-menu.js` + `js/skin-main.js`가 이미 그 역할이다.

| 작업지시서가 요구한 것 | 이 저장소에서의 실제 대응 |
|---|---|
| 공통 Header | `skin.html`의 `<nav class="navbar">` — 전 페이지 공유. **이번에 네비바 자체를 축소(햄버거만)하는 게 목표이므로 이 부분만 skin.html 안에서 수정** |
| 공통 Sidebar | `skin.html`의 `sidebar-left`(`js/skin-menu.js`가 메뉴 렌더링) — 전 페이지 공유, 대부분 유지. `sidebar-right`(인기글/해시태그)만 제거 |
| 공통 Footer | 별도 footer 없음(`copyright` div가 sidebar-right 안에 있음) — sidebar-right 제거 시 copyright를 feed 하단이나 별도 mount로 옮길지 결정 필요 |
| 공통 JS | `js/skin-shell.js`(태그 없는 UI 조각 주입) + `js/skin-main.js`(다크모드/카테고리/모달/드로어 등) — 이미 공통 모듈. 신규 `js/ui-components.js`를 같은 층위에 추가 |
| 공통 CSS | `style.css` — 이번에 `css/design-tokens.css`를 분리해서 최상단에 두고 나머지가 참조하는 구조로 재편 |
| NewsCard / StockCard / SignalCard / Widget | `js/ui-components.js`의 렌더 함수로 구현(React 컴포넌트가 아니라 문자열/DOM 조립 함수) |

## 6. 페이지 구조

### 6.1 홈(`/`) 신규 순서

```
1. 네비바 (햄버거만, 로고, 검색 아이콘)
2. 지수 리본 (기존 유지)
3. Hero (신규) — 오늘의 투자시그널 총평 + 증시온도 요약, 2카드 나란히
4. 종목검색 (Hero 바로 아래로 이동, 큰 사이즈, 자동완성 유지)
5. home-dashboard 대시보드 (기존 재배치)
   5-1. 대형 차트
   5-2. 증시온도 게이지 / AI 관심종목(watchlist+stock-news 통합)
   5-3. 시총 히트맵
   5-4. 랭킹뉴스 TOP10 / AI 시황요약
6. 마켓 브리핑 피드 (기존 post-card 그대로, 카드 디자인만 리스타일)
7. (커뮤니티/방명록은 기존처럼 좌측 메뉴에서 이동, 홈 본문엔 안 넣음)
```

작업지시서의 "차트패턴 스캐너/종목뉴스/커뮤니티"까지 홈 본문에 카드로 다 넣을지, 좌측 메뉴 링크로 충분한지는 **9장 질문 3**에서 확인.

### 6.2 그 외 페이지 (`/page/*`, `/pages/*`)

Tistory Page 구조를 유지하는 한(9장 질문 2 결정에 따름), 각 페이지는 지금처럼 "skin.html 공통 골격 + 그 페이지 전용 mount"로 유지된다. 작업지시서 9번의 `stock.html`/`news.html`/`pattern.html`/`heatmap.html`/`signal.html`/`community.html`/`market-temperature.html` 명명은 **git에 보관하는 정본 소스 파일명**(`pages-src/*.html`)으로 대응시키고, 실제 서빙 URL은 그대로 `/page/foreign-flow` 등을 유지하는 것을 권장한다(이유는 9장 질문 2, 11장 위험요소 참고).

| 정본 소스 (신규, `pages-src/`) | 실제 서빙 URL | 대응 위젯 |
|---|---|---|
| `stock.html` | `/page/foreign-flow` | `js/foreign-flow.js` |
| `news.html` | `/page/stock-news` | `js/stock-news.js` |
| `pattern.html` | `/page/pattern-scan` | `js/pattern-scan.js` |
| `signal.html` | `/pages/invest-signal` | `js/invest-signal.js` |
| `market-temperature.html` | `/page/market-temp` | `js/market-temp.js` |
| `overnight.html` | `/pages/overnight-market` | `js/overnight-market.js` |
| `kospi-futures.html` | `/pages/kospi-futures` | `js/kospi-futures.js` |
| `community.html` | `/guestbook` | Tistory 방명록 기본 기능(정본 소스 불필요, Tistory 자체 기능) |

## 7. 디렉터리 구조

```
tistory-ticker/
├── UI_RENEWAL.md              ← 이 문서
├── style.css                  ← 유지, design-tokens.css를 최상단 @import
├── css/
│   ├── design-tokens.css      ← 신규
│   ├── hero.css                ← 신규
│   ├── home-dashboard.css     ← 개편
│   └── ...(기존 위젯 CSS, 순차 리팩터)
├── js/
│   ├── ui-components.js       ← 신규
│   ├── hero.js                 ← 신규
│   ├── skin-shell.js           ← hero mount 추가
│   ├── home-dashboard.js       ← 개편
│   └── ...(기존 위젯 JS, 대부분 로직 불변)
├── pages-src/                  ← 신규, Tistory Page 정본 소스(9장 질문 2 확정 후)
│   ├── stock.html
│   ├── news.html
│   ├── pattern.html
│   ├── signal.html
│   ├── market-temperature.html
│   ├── overnight.html
│   └── kospi-futures.html
├── data/                       ← 변경 없음
├── gas/                        ← 변경 없음
├── scripts/                    ← 변경 없음
└── test/
    ├── home-page-full.html    ← 신규
    └── ...(기존 유지)
```

React/Vue식 `src/components/*.tsx` + 빌드 산출물 구조는 **채택하지 않는다** — 이 저장소에 번들러가 없고, GitHub Pages가 원본 파일을 그대로 서빙하는 구조이기 때문이다(8장에서 재확인).

## 8. 개발 순서

번호는 착수 순서. 각 단계는 **로컬 `python -m http.server` + `test/*.html`로 검증 후 push**하는 기존 워크플로(CLAUDE.md 5번 규칙)를 그대로 따른다.

1. **`css/design-tokens.css` 작성** — 색상/spacing/radius/shadow 변수 확정(라이트+다크 두 세트). 이 단계가 끝나야 이후 모든 리스타일링이 같은 값을 참조할 수 있음
2. **`js/ui-components.js` 골격** — NewsCard/StockCard/SignalCard 렌더 함수, 아직 기존 위젯에 연결하지 않고 단독 테스트
3. **`home-dashboard.js`/`css` 리스타일 + 관심종목 통합** — 가장 최근 만든 모듈이라 손대기 쉽고, PPT가 요구하는 화면의 70%가 이미 여기 있음. watchlist+stock-news를 이 안의 카드로 통합
4. **`js/hero.js`/`css/hero.css` 신규 구현** — 기존 investSignal/marketTemp 캐시 재사용해서 요약 카드 제작
5. **`skin.html` 변경(1차)** — 햄버거 전용 네비바, Hero mount, 종목검색 이동, sidebar-right 제거. **CLAUDE.md의 "skin.html 수정 시 필수 절차" 6단계를 그대로 따를 것**(로컬 사본 신뢹 금지 → 티스토리 실제 편집기 내용 기준으로 시작, 태그 포함 블록 판별, FOUC 방지, 로컬 검증, 사용자에게 전체 텍스트 전달)
6. **`test/home-page-full.html`로 통합 프리뷰 검증** — 콘솔 에러, 다크모드, 모바일 반응형, 드로어 동작 확인
7. **나머지 위젯 CSS 순차 토큰화** — 사용 빈도 높은 순(`foreign-flow` → `invest-signal` → `pattern-scan` → 나머지). 페이지 단위로 하나씩 push해서 위험을 분산
8. **`post-card`/`post-excerpt` 뉴스 카드 2줄 제목 클램프** — `style.css` 소규모 수정
9. **`pages-src/*.html` 정본화**(질문 2 결론이 "Tistory 유지"일 경우) — 기존에 이미 Tistory 편집기에 붙여넣어져 있는 내용을 역으로 git에 옮겨 담는 작업
10. **최종 QA + `skin.html` 전체 텍스트를 사용자에게 전달** → 사용자가 Tistory 편집기에 붙여넣음

## 9. 미해결 질문 (구현 착수 전 확인 필요)

1. **Hero에 "오늘의 투자시그널" 요약을 넣을 때** — PPT엔 없고 작업지시서 텍스트에만 있는 항목이다. 기존 `/pages/invest-signal`의 등급 분포 데이터를 요약(예: 최다 등급 + 비중)해서 카드 하나로 압축하는 방식으로 진행해도 되는지, 아니면 다른 형태를 원하는지?
2. ~~**Tistory Page 구조를 유지할지, 완전 별도 정적 HTML로 옮길지.**~~ **[2026-07-17 확정] Pages 유지.** URL은 지금처럼 `/page/foreign-flow` 등을 그대로 쓰고, git에는 `pages-src/*.html`로 정본 소스만 백업(6.2절, 3장 참고) — 배포 경로나 서빙 방식은 바뀌지 않는다. 완전 별도 정적 HTML로 옮기는 안(댓글·방명록·카테고리 등 Tistory 고유 기능 소실)은 채택하지 않기로 함.
3. **홈 본문에 차트패턴 스캐너/종목뉴스/커뮤니티까지 카드로 다 넣을지, 좌측 메뉴 링크로 충분한지.** 작업지시서 5번은 9개 섹션을 홈에 나열하지만, 이미 각각 전용 페이지가 있어 홈이 과도하게 길어질 위험이 있다.
4. **다크모드를 기본값(초기 로드 시)으로 바꿀지.** 지금은 라이트 기본 + 토글이고, 작업지시서는 "심플한 다크 테마"를 새 디자인의 기준처럼 서술한다 — 토글은 유지하되 첫 방문 시 기본값을 다크로 바꾸는 것까지 원하는지?
5. **sidebar-right 제거 후 그 폭을 어떻게 쓸지.** 그냥 없애서 피드 폭을 넓힐지, 다른 콘텐츠(예: AI 관심종목 미니카드)로 채울지?
6. **Hero의 "오늘의 투자시그널/증시온도" 요약에 신규 GAS 필드가 필요한지, 기존 캐시로 충분한지** — `gas/ticker-proxy.gs`를 확인해서 결정할 사항이라 별도 조사가 필요하다(재배포 필요 여부도 함께 확인).
7. **비주얼 디자인(색·타이포·아이콘 스타일)의 구체적 기준.** PPT는 배치 순서만 알려줄 뿐 "Bloomberg/TradingView/Perplexity/Apple풍"이라는 텍스트 설명 외에 실제 색상 팔레트·폰트가 정해진 참고 이미지가 없다. `css/design-tokens.css` 값을 확정하기 전에 추가 레퍼런스(스크린샷, 팔레트 코드 등)가 더 필요한지 확인.

## 10. 기존 기능 유지 방법

- **원칙: 로직 파일(GAS 호출, 데이터 처리)은 건드리지 않고, 마크업/CSS만 디자인 토큰 기반으로 교체한다.** 예: `market-temp.js`의 게이지 계산 로직은 그대로 두고 `<div class="mt-gauge">`에 붙는 색상값만 `var(--...)`로 치환.
- 각 위젯은 독립된 `init()` 진입점을 가진 IIFE 모듈이라(예: `MarketTemp.init({gaugeOnly:true})`) 마운트 위치만 바꾸면 재사용 가능 — 이미 `home-dashboard.js`가 `market-temp.js`/`marketcap-bubble.js`를 이런 식으로 재사용하고 있어 **검증된 패턴**이다. `watchlist.js`/`stock-news.js` 통합도 같은 패턴을 따른다.
- 자동완성(`stock-search-panel.js`, `home-dashboard.js`의 심볼 검색)은 `data/krx_map.js` 하나를 공유하므로 위치를 옮겨도 로직 변경 불필요.
- `test/*.html` 전부를 그대로 유지해서 리팩터 전/후 스크린샷을 비교하며 회귀를 잡는다.
- 각 위젯 CSS를 토큰화할 때 **한 파일씩** 옮기고 그때마다 해당 `test/*.html`로 확인 후 push — 한 번에 19개 CSS를 다 바꾸지 않는다(11장 위험요소 참고).

## 11. 예상 영향 범위

| 영역 | 영향도 | 설명 |
|---|---|---|
| 홈(`/`) 화면 | **높음** | 이번 개편의 핵심 대상. Hero 신설, 대시보드 재배치, 사이드바 우측 제거 |
| 전체 페이지 공통 네비바/사이드바좌측 | **높음** | `skin.html` 한 파일 수정이 전 페이지에 즉시 영향 — 잘못되면 전체 사이트 네비게이션이 깨짐 |
| 각 `/page/*` 개별 위젯 | **중간** | CSS 토큰 교체 위주, 기능 로직 불변이라 안전하지만 19개 파일 전부 손대야 해서 범위가 넓음 |
| GAS/데이터 파이프라인 | **없음** | 이번 개편 범위 아님. 엔드포인트/캐시 스키마 변경 없음 |
| SEO/방문자 통계/댓글/방명록 | **낮음(단, Tistory 유지 결정 시)** | Tistory 고유 기능이라 서버 렌더 태그 그대로 유지하면 영향 없음. 별도 정적 HTML로 이전하면 **영향 매우 큼**(9장 질문 2) |
| 모바일 UX | **중간** | 햄버거 메뉴를 데스크탑까지 확장하는 게 새 요구사항이라 기존 모바일 전용 드로어 로직(`skin-main.js`)을 데스크탑에서도 타게 확장해야 함 |

## 12. 위험 요소 및 대응 방안

| 위험 | 설명 | 대응 |
|---|---|---|
| **skin.html 로컬 사본과 라이브 버전의 불일치** | CLAUDE.md에 이미 경고된 사항 — 로컬에 남은 사본을 신뢰하면 실제 라이브 버전과 다른 내용을 덮어쓸 수 있다 | skin.html 수정 착수 직전에 반드시 사용자에게 Tistory 관리자 HTML 편집 화면의 **현재 실제 내용**을 요청해서 그걸 기준으로 diff 작성 |
| **Tistory 서버 치환 태그(`[##_..._##]`, `s_xxx`) 오염** | 새 Hero/검색 영역을 만들다가 실수로 이 태그들을 git 파일로 옮기면 GitHub Pages에서는 절대 작동하지 않음(정적 파일이라 서버 치환이 없음) | 새 블록은 100% 태그 없는 순수 UI로 설계하고 `js/skin-shell.js` 패턴을 그대로 따름(1.2, 5장 참고) |
| **FOUC(깜빡임)** | 기존 콘텐츠(사이드바 인기글 등)를 JS로 나중에 지우면 깜빡인다는 점이 CLAUDE.md에 명시됨 | "빈 mount + 즉시 채우기" 패턴만 사용. 정말 지워야 하는 콘텐츠(sidebar-right)는 skin.html 자체에서 제거(런타임 remove 금지) |
| **19개 CSS 파일 동시 리팩터로 인한 광범위 회귀** | 디자인 토큰 도입이 실수로 값이 어긋나면 모든 페이지에 동시다발적으로 스타일 깨짐 발생 가능 | 8장 개발순서대로 페이지 단위 순차 진행, 파일 하나 바꿀 때마다 해당 `test/*.html`로 검증 후 push |
| **GitHub Pages 캐시(10분 지연)로 인한 느린 반복** | push 후 실제 반영까지 최대 10분 걸려서 라이브 확인 주기가 느림 | 개발 중에는 `python -m http.server`로 로컬 파일을 직접 서빙하며 `test/*.html`에서 검증하고, push는 검증이 끝난 뒤에만 |
| **short-pressure/pension-fund 단독 Tistory 페이지가 남아있을 가능성** | 이 저장소에서는 어느 URL에 임베드됐는지 확인 불가(skin.html이 gitignore 대상이라) | 파일 삭제 전 사용자에게 해당 Page 존재 여부를 직접 확인받음(4장) |
| **햄버거 메뉴를 데스크탑까지 확장하며 발생하는 상호작용 회귀** | 검색 아이콘, 다크모드 토글, 로그인/글쓰기 버튼 등 기존 네비바 아이콘들의 재배치가 필요해지고, 클릭 밖 닫힘/ESC/포커스트랩 등 접근성 로직도 데스크탑 케이스로 확장해야 함 | `test/navbar-mobile.html`을 데스크탑 케이스까지 포함하도록 확장해서 검증 |
| **작업지시서와 PPT의 불일치**(1.3절) | 잘못된 가정으로 설계를 진행하면 구현 후 재작업 위험 | 9장 질문에 대한 답을 받기 전까지 스타일 토큰(1단계)과 컴포넌트 골격(2단계) 이상으로 진행하지 않음 — 이 두 단계는 어떤 답이 나와도 재사용 가능 |
| **DB/데이터 스키마 영향** | 해당 없음 — 이번 개편은 프레젠테이션 계층만 다루고 GAS 응답 스키마, `data/investor-flow-cache.js` 스키마, VM SQLite 스키마 어느 것도 변경하지 않는다 | (대응 불필요, 명시적으로 범위 밖임을 확인) |

---

## 부록: 원본 작업지시서 요약

1. 첨부 PPT 기준 레이아웃(여백/카드크기/제목크기/간격/섹션배치) 최대한 동일 구현, 반응형 고려
2. 상단 메뉴 전면 교체: 인기글/해시태그 삭제, 햄버거만 남기고 슬라이드 메뉴(홈/오늘의투자시그널/AI관심종목/종목분석/종목뉴스/차트패턴스캐너/실시간히트맵/증시온도/증시캘린더/커뮤니티)
3. Hero 영역 신설(투자시그널+증시온도 크게)
4. 종목검색 최상단(Hero 바로 아래) 이동, 자동완성 유지
5. 메인 레이아웃 순서: Hero→검색→투자시그널→AI관심종목→증시온도→시장브리핑→차트패턴스캐너→종목뉴스→커뮤니티
6. 카드 디자인 개선(높이 축소, 여백 확대, hover 애니메이션, radius 통일, 그림자 최소화)
7. 뉴스 카드 제목 2줄/본문 3줄 말줄임, 날짜 우측 상단
8. 다크테마 유지 + 색상/폰트/버튼/아이콘 통일
9. HTML 기반 구조 전환(index/stock/news/pattern/heatmap/signal/community/market-temperature) + 공통 Header/Footer/Sidebar/JS/CSS 분리
10. 컴포넌트화(NewsCard/StockCard/SignalCard/Header/Footer/SearchBar/Sidebar/Widget)
11. 반응형(Desktop/Tablet/Mobile), 햄버거 모바일 동일 동작
12. 성능(Lazy Loading, 이미지 최적화, DOM/스크립트/CSS 최소화)
13. 기존 기능 전체 유지(검색/자동완성/AI관심종목/증시온도/투자시그널/시장브리핑/뉴스/차트패턴/실시간데이터)
14. 최종 목표: "블로그"가 아니라 "전문 금융 웹 플랫폼" 인상
