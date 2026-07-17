# tistory-ticker

티스토리 블로그(ghlee.tistory.com, 9bolt 스킨)의 티커 툴팁·섹터 대시보드·종목뉴스·마켓리본 소스.
**GitHub Pages로 서빙됨**: `https://goodbyestarwars.github.io/tistory-ticker/{경로}` — master에 push하면 1~10분 내 블로그에 자동 반영된다(cache max-age=600). 파일명 버저닝 금지: 같은 파일을 계속 갱신할 것(URL이 블로그 HTML에 박혀 있음).

## 파일 구성

| 경로 | 역할 |
|---|---|
| `data/sectors-v3.js` | 섹터 대시보드 데이터. `window.SECTOR_MAP = { "섹터명": [{ name, code, market }, ...] }` (market: "KOSPI"/"KOSDAQ") |
| `js/sector-dashboard-v4.js` | 섹터 대시보드 렌더링(시장 뱃지 P/Q 포함, 뱃지 CSS는 JS가 주입) |
| `css/sector-dashboard-v3.css` | 대시보드 스타일(카드/히트맵/다크모드) |
| `data/krx_map.js` | 종목명→코드 전 종목 매핑(티커 툴팁·종목뉴스용) |
| `js/ticker-tooltip-v5.js`, `js/stock-news.js`, `js/market-ribbon.js` | 본문 툴팁 / 종목뉴스 / 상단 리본(`market-ribbon`은 2026-07-16부로 폐기, `js/quick-indices.js`로 기능 이관·display:none) |
| `js/quick-indices.js`, `css/quick-indices.css` | **관심지수 리본** - navbar 바로 아래 모든 페이지 공통 바(2026-07-17 13차부터 position:absolute - 스크롤하면 페이지와 함께 올라가 사라짐). 코스피/코스닥/코스피 야간선물/금 선물/BTC 등은 VM(`https://goodbyestar.cloud/futures`, 이력 있어 미니차트 가능 - BTC는 2026-07-17 14차부터 `scripts/cloud-vm/btc_futures.py`가 업비트를 서버사이드로 수집, 클라이언트 직접 호출 방식은 방문자별 레이트리밋/CORS로 불안정해 폐기), 원달러는 GAS `?market=1`. "큰 카드 1개 + 그리드(3줄, 168px 열이 오른쪽으로 auto-flow)" 밀집 배치(토스증권 참고) - 최대 11종이 전부 한 화면에 들어가 페이징 없음(2026-07-17 10차에 화살표 페이징 제거), 남는 폭은 긴급속보 패널이 차지. 접기/펼치기·표시 종목 커스텀은 localStorage(`qi_selected_v1`/`qi_collapsed_v1`). 자기 높이를 `--qi-height`(style.css `:root`)에 실시간 반영해서 `.page-wrap`/`.sidebar-left`/`.sidebar-right`의 좌표 오프셋이 항상 맞물리게 함 - 이 바의 높이를 바꾸면 style.css의 `calc(...+var(--qi-height))` 오프셋도 같이 확인할 것. **2026-07-17(9차)부터 KRX 공시 티커(옛 별도 고정 바)를 이 리본 오른쪽 "긴급속보"(`.qi-news`) 패널로 흡수** - fetch/파싱 로직은 같은 GAS(`?market=0`)를 그대로 쓰되 가로 스크롤 대신 세로 스크롤 목록으로 렌더링. 장외 시간엔 공시 RSS가 비므로 GAS `?rankNews=1`(네이버 뉴스 시황 헤드라인)로 폴백 |
| `data/marketcap-codes.js`, `js/marketcap-bubble.js`, `css/marketcap-bubble.css` | 시가총액 히트맵(트리맵). ETF10/INVERSE4/단일종목레버리지 합산 2종은 `data/marketcap-codes.js`, 코스피·코스닥 개별종목은 `data/sectors-v3.js` 전체 풀(업종 태그 포함, 업종 필터 지원)을 GAS가 재사용. 등락률 -3%~+3% 7단계 색상. GAS `?bubble=1` 액션을 45초 간격 폴링 |
| `gas/ticker-proxy.gs` | GAS 프록시 소스(시세·뉴스·AI요약·증시온도·히트맵·수급·공매도압박·연기금·랭킹뉴스·차트패턴스캔·오늘의투자시그널). 수정 시 script.google.com에서 수동 재배포 필요 — push만으로는 반영 안 됨. 히트맵 ETF/INVERSE/레버리지 구성 변경 시 `data/marketcap-codes.js`와 이 파일의 `MARKETCAP_CODES` 둘 다 수정. **`scanInvestSignal`(하루 1회 트리거)은 `data/investor-flow-cache.js`를 HTTP로 재fetch해서 재사용** — 이 파일 스키마(short/pension 필드명)가 바뀌면 GAS의 파싱 로직도 같이 고쳐야 함. **랭킹뉴스(`?rankNews=1`)는 2026-07-18부터 네이버를 직접 안 부르고 VM `/naver-news`를 거침**(`scripts/cloud-vm/naver_news.py`) — 네이버 검색API가 NCP API HUB로 이관되며 IP 화이트리스트(최대 10개)를 지원하게 됐는데, GAS(UrlFetchApp)는 고정 IP가 없어 화이트리스트를 못 걸어서 고정 IP를 가진 VM이 대신 호출하도록 우회함. VM엔 `NAVER_APIHUB_CLIENT_ID`/`NAVER_APIHUB_CLIENT_SECRET` 환경변수 필요(NCP API HUB 콘솔에서 Search API 신청 시 발급 — 계정 전체 IAM 키(`ncp_iam_*`)와는 다른 별개 키) |
| `js/foreign-flow.js`, `css/foreign-flow.css` | 종목별 외국인·기관 수급 위젯(연속매매·추세전환 뱃지 포함). GAS `?action=foreignFlow` 온디맨드 크롤링, 서버 캐시 없음. **2026-07-11부터 공매도/대차거래/연기금 섹션이 여기 병합됨**(`buildExtraSections`) — `data/investor-flow-cache.js`에 있는 종목만 추가로 표시, 없으면 안내 문구만 노출. 가격 차트(지지/저항+이평선, 최근 1년)는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드)로 렌더링 — 직접 그리는 SVG 아님 |
| `data/investor-flow-cache.js`, `scripts/fetch_investor_flow.py` | 공매도(누적잔고/평균가/거래비중/Days to Cover/압박점수 100점)·대차거래(잔고/증감률)·연기금(연속순매수일수/구간별 순매수/해석) 캐시. KRX가 완전 차단됐지만 **증권사(키움) 정식 REST API는 이 데이터를 계속 제공**해서 이 경로로 우회. GAS가 아니라 **사용자 PC에서 로컬로 스크립트 실행 → git commit/push**하는 구조(증권사 API 앱키가 IP 등록 필요 + 계좌 연동 개인키라 GAS 같은 공개 서버에 못 둠). `KIWOOM_APPKEY`/`KIWOOM_SECRETKEY` 환경변수 필요(하드코딩 금지), 대상 종목은 `data/sectors-v3.js` 풀(238종목, 전체 종목 아님) 재사용. 데이터는 하루 1회 갱신이라 실시간 서버 불필요 — PC를 하루 한 번 켤 때 실행하는 것으로 충분. **미검증**: REST 엔드포인트는 MCP(`mcp__kiwoom__*`)로 확인한 실제 응답 필드 기준으로 작성했지만 실계정으로 직접 테스트 안 됨 — `TEST_CODES`로 소량 검증 후 `--all` 실행할 것 |
| `js/pattern-scan.js`, `css/pattern-scan.css` | 차트 패턴 스캔 위젯(저점상승형/쌍바닥/역헤드앤숄더/박스권하단/눌림목 5종, 지시서 스펙 그대로) - 캔들차트(TradingView Lightweight Charts, CDN 지연 로드) + 패턴선 오버레이. 모든 패턴은 0~100점 채점(70점 이상만 노출, AI 임의판단 없이 수치조건), 점수+원인+한줄해석을 함께 표시. 리스트는 GAS `?patternScan=1`(하루 1회 시간 트리거로 미리 스캔·캐싱, 눌림목은 MA60 필요해 별도 트리거로 분리), 클릭 시 차트는 `?patternChart=1&code=&pattern=`으로 온디맨드 재크롤링. 스캔 대상은 `data/sectors-v3.js`를 GAS가 fetch해서 재사용(별도 종목 리스트 하드코딩 없음) |
| `js/invest-signal.js`, `css/invest-signal.css` | **오늘의 투자시그널 페이지 전용**(종목분석/차트패턴 등과 달리 별도의 새 티스토리 포스트에 임베드). ①전체 종목(섹터 풀 237종목) 매수~매도 5등급 분포(클릭 시 종목목록) ②수급 랭킹(외국인/기관/연기금 TOP20 + 최근5일 수급개선/악화 TOP20). GAS `?investSignal=1`(하루 1회 트리거 `scanInvestSignal`이 미리 계산·캐싱)을 그대로 표시 — 점수 공식(수급40%+외국인기관25%+기술적20%+공매도10%+연기금5%)은 `js/foreign-flow.js`와 완전히 동일(서버에 그대로 포팅되어 있어 두 페이지의 등급/별점이 항상 일치). 공매도/연기금 항목만 `data/investor-flow-cache.js` 스냅샷을 읽어 붙이므로 PC를 안 켜도 나머지 85%는 매일 자동 갱신됨. 종목 클릭 시 새 상세화면을 만들지 않고 **종목분석 페이지(`/page/foreign-flow`)로 `?code=&name=` 붙여서 이동**(그쪽 `js/foreign-flow.js`가 파라미터를 읽어 자동검색). 이 페이지 자체는 `/pages/invest-signal`에 임베드돼 있고, `js/skin-menu.js`의 사이드바 메뉴에도 등록돼 있음 |
| `js/watchlist.js`, `css/watchlist.css` | 관심종목 카드 위젯. localStorage(최대 50개, 종목명 자동완성으로 추가) - 신규 GAS 엔드포인트 없이 기존 `?codes=` 시세 API 재사용 |
| `js/market-temp.js`, `css/market-temp.css` | **오늘의 증시온도** - CNN Fear&Greed 스타일 대표 콘텐츠(2026-07-18 전면 개편). VIX20+수급20+거래대금15+평균등락률15+상승비율10+섹터강도10+52주신고저10+환율5+미국선물5=110점을 0~40℃로 환산(GAS `?marketTemp=1`). 섹션 순서: Hero(온도+전일/주간/월간대비+역발상 투자시그널 별점, 공포=매수 신호) → AI 시장 브리핑(`?marketTempBriefing=1`, Groq, TOP5 기여도를 프롬프트에 정확히 명시해 AI가 숫자를 지어내지 않게 함) → 오늘 영향요인 TOP5(점수기여도=score-max/2) → 게이지 → 개별지표(계산식 툴팁, GAS가 내려주는 `band` 필드) → 7일 스파크라인/레이더차트(둘 다 hand-roll SVG, 라이브러리 미사용) → 투자전략 카드 → 기준표 → (기존 유지) 카드보기/히트맵보기/시총비례 탐색. VIX는 Yahoo Finance(`query1.finance.yahoo.com`, 네이버엔 없음), 수급은 KODEX200(069500) 대리지표, 상승비율/거래대금/섹터강도는 섹터 종목풀 재사용, 52주신고저는 VM `/week52-batch`. **애니메이션(count-up/게이지스윕/진행바채움/스파크라인draw)은 rAF·CSS 타임라인이 안 도는 환경(백그라운드 탭 등)에서 값이 고정돼버리는 문제가 실측됐음** - 전부 JS `setTimeout` 안전장치를 병행해 데이터 정확성은 애니메이션 성공 여부와 무관하게 보장됨(향후 이 위젯에 애니메이션 추가 시 같은 패턴 유지할 것) |
| `js/short-pressure.js`, `css/short-pressure.css` | **구 공매도 압박 위젯(네이버/KRX 기반) - 폐기 예정, 코드만 유지.** KRX·네이버 경로 모두 막혀 있었음(무료 소스 없음). `js/foreign-flow.js`의 병합 섹션(키움 API 기반)이 이 기능을 대체함 — 티스토리에 이 위젯을 단독 페이지로 임베드해뒀다면 수동으로 정리 필요(어느 페이지인지 이 저장소에서 확인 불가, skin.html이 gitignore 대상). |
| `js/pension-fund.js`, `css/pension-fund.css` | **구 연기금 위젯(기관 합산 추정치) - 폐기 예정, 코드만 유지.** 연기금 단독 데이터가 없어 기관 합산으로 대체했던 버전. `js/foreign-flow.js`의 병합 섹션이 키움 API의 진짜 연기금(`penfnd_etc`) 데이터로 이 기능을 대체함 — 단독 페이지로 임베드해뒀다면 수동 정리 필요. |
| `test/*.html` | 로컬 프리뷰(python -m http.server로 열기). 위젯마다 기본은 mock 데이터, `?real=1`이면 실제 GAS 호출 |
| `data/sectors-v3-검수표.md` | 종목코드 매핑 검수표 — 섹터 데이터 수정 시 같이 갱신 |
| `js/skin-shell.js` | 스킨의 **태그 없는 순수 UI 조각**(모바일 오버레이·검색 오버레이·스크롤탑 버튼, 드로어 헤더, 구글 캘린더 위젯 껍데기, 서브 필터 바)을 `skin.html`의 `<div id="shell-*">` mount에 런타임 주입. **반드시 skin-menu.js/skin-main.js보다 먼저 로드**(그 스크립트들이 이 안에서 만든 id를 getElementById로 찾음). 이 파일에 있는 것들은 push만으로 반영, skin.html 재배포 불필요. (구 KRX 공시 티커 껍데기는 2026-07-17(9차)에 제거 — `js/quick-indices.js`의 긴급속보 패널로 흡수됨. `skin.html`의 `#shell-discTicker` mount는 빈 채로 남아있지만 무해함) |
| `js/skin-menu.js` | 왼쪽 사이드바 커스텀 메뉴(`#nav-menu-mount`) 렌더링. 메뉴 추가/삭제/순서 변경은 `MENU_ITEMS` 배열만 고치면 됨 |
| `js/skin-main.js` | 스킨 공통 동작 — 다크모드/폰트 토글, 카테고리 파싱(좌측 카테고리 목록·서브 필터 탭), 아티클 모달, 모바일 드로어·검색, 구글 캘린더 위젯 로직. **`js/skin-main.js`에 구글 캘린더 API 키와 캘린더 ID가 하드코딩되어 있고 이 파일은 public 저장소로 push됨 — 노출 상태.** 키 재발급/리퍼러 제한은 사용자가 Google Cloud Console에서 직접 해야 함(로그인 필요). (구 KRX 공시 티커 fetch/파싱 로직은 2026-07-17(9차)에 `js/quick-indices.js`로 이관됨) |

**`skin.html`은 이 저장소에 없음(.gitignore, 캘린더 위젯 등에 개인정보 소지)** — 티스토리 스킨 편집기(관리자 → 꾸미기 → 스킨 편집 → HTML 편집)에 직접 붙여넣어야 반영됨, push로는 절대 안 됨. `style.css`는 2026-07-10부터 git으로 이전되어 일반 파일처럼 push로 반영됨(스킨의 CSS 탭 미사용).

**skin.html 수정 시 필수 절차** (2026-07-11 사고 이후):
1. **로컬 skin.html을 신뢰하지 말 것.** git에 없으므로 로컬 사본이 실제 라이브 버전과 다를 수 있음(과거 실제로 다른 사례 있었음). 확신 없으면 사용자에게 티스토리 관리자 HTML 편집 화면의 실제 내용을 붙여달라고 요청해서 그걸 기준으로 삼을 것.
2. **티스토리 서버 치환 태그(`[##_..._##]`, `<s_xxx>` 블록)가 하나라도 포함된 요소는 절대 git으로 못 옮김** — Tistory가 서버에서 렌더링할 때만 치환되므로 GitHub Pages 정적 파일(JS로 나중에 주입)로는 작동 안 함. 이런 요소가 있는 블록(네비바 로고/검색창, 카테고리 데이터, 방문자 통계, 글·공지 루프, 방명록, 페이지네이션, 인기글, 해시태그, 카피라이트)은 skin.html에 그대로 남겨야 함.
3. **태그가 전혀 없는 블록**만 `js/skin-shell.js`에 옮기고 skin.html에는 빈 `<div id="shell-이름">`만 남긴다 (패턴은 그 파일 참고).
4. skin.html의 순수 UI 구조를 바꿀 때(예: 특정 영역 제거/추가) JS로 런타임에 `.remove()`/`.style.display` 하는 방식은 **깜빡임(FOUC)이 생김** — 이미 로드된 실제 콘텐츠를 나중에 지우는 거라서. 빈 mount + 즉시 채우기 방식(위 패턴)은 깜빡임 없음. 이미 skin.html에 박제된 콘텐츠를 지우고 싶다면 skin.html 자체에서 지워야 함(즉 스킨 편집기 재배포 필요).
5. skin.html을 수정했다면 **반드시 로컬에서 실제로 실행해서 검증**: 티스토리 태그 부분에 목업 데이터(예시 카테고리 목록 등)를 채운 테스트 사본을 만들고, git의 실제 JS 파일들을 로컬 경로로 붙여서 `python -m http.server`로 띄운 뒤 Browser 도구로 콘솔 에러·기능 동작(드로어 열기/닫기, 다크모드, 캘린더 등)을 확인하고 테스트 파일은 삭제한다. "코드가 맞아 보인다"만으로 끝내지 말 것.
6. 검증 끝나면 **skin.html 전체 내용을 사용자에게 텍스트로 제공**해서 티스토리 편집기에 직접 붙여넣게 한다 — 이 저장소에서 직접 배포할 방법이 없음.

## 섹터 데이터 수정 규칙 (가장 잦은 작업)

1. **중복 제거 금지**: 한 종목이 여러 섹터에 의도적으로 중복 포함됨(현대차, 포스코DX, SK이노베이션, 한화에어로스페이스, 풍산, POSCO홀딩스, 삼성물산, GS, LS, LG화학, 두산에너빌리티, 한전기술 등).
2. **종목코드는 추측 금지**: KRX KIND 상장사 목록으로 확인할 것 —
   `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=stockMkt`(코스피) / `kosdaqMkt`(코스닥), EUC-KR HTML 테이블. 확인 불가하면 사용자에게 보고.
3. **KIND 등록명과 표기가 다른 종목(별칭 함정)**: 현대차→현대자동차, KT→케이티, KT&G→케이티앤지, KCC→케이씨씨, LS ELECTRIC→엘에스일렉트릭, SK바이오팜→에스케이바이오팜, 삼성화재→삼성화재해상보험, 한국전력→한국전력공사, HDC현대산업개발→IPARK현대산업개발, HD현대건설기계→HD건설기계. 표시명은 블로그 표기를 쓰고 코드만 KIND에서 가져온다.
4. 삼성에피스홀딩스는 특수코드 `0126Z0`(정상). HD현대인프라코어(042670)는 합병 상장폐지라 시세가 안 나옴.
5. 수정 후 검증: `python -m http.server` + `test/sector-dashboard-v4.html` 열어서 해당 섹터 카드에 종목·시세가 뜨는지 확인. 그 다음 commit·push.
6. push 후 반영 확인: `curl https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js` 에 수정 내용이 실렸는지 확인(최대 10분 지연).

## 기타 규칙

- 상승=빨강(#d24f45), 하락=파랑(#1261c4). 스킨 다크모드는 `html.dark` 클래스 — 본문에 들어가는 새 UI는 `html.dark #컨테이너ID ... !important` 오버라이드 필수(스킨의 블랑켓 규칙이 글자색을 흰색으로 덮어씀).
- 시세 조회 GAS URL: `https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec?codes=005930,000660` 형태.
- `.json` 업로드 제약 때문에 데이터는 전부 `window.XXX = {...}` 형태의 `.js`로 만든다.
- **KRX 내부 크롤링 경로(`data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`, OTP+CSV 다운로드 경로 `generate.cmd` 포함)는 2026-07-11부로 완전 차단.** 세션 쿠키를 붙여도, OTP 발급을 시도해도 "LOGOUT"으로 거부됨(실측 확인됨). KRX 정식 Open API(`openapi.krx.co.kr`)에도 공매도·투자자별 매매동향 서비스 자체가 없음 — **새 KRX 직접 크롤링 코드를 다시 추가하지 말 것.**
- **공매도/대차거래/연기금은 KRX 대신 증권사(키움) 정식 REST API로 우회한다.** `scripts/fetch_investor_flow.py` 참고. 이 데이터는 사용자 개인 계좌의 API 키가 필요해 GAS 같은 공개 서버에 둘 수 없고, 앱키가 IP 등록 방식이라 GitHub Actions 같은 유동 IP 클라우드도 못 씀 — 그래서 PC 로컬 실행 + git push 구조. 오픈API 이용약관(재배포/제3자 제공 제한 여부)은 미확인 상태로 진행 중임을 인지할 것.
