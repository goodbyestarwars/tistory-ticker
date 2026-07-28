# tistory-ticker 시스템 구성도

다른 AI(ChatGPT 등)에게 이 프로젝트의 가벼운 작업을 맡길 때 붙여넣을 용도의 요약 문서.
상세한 파일별/기능별 이력은 `CLAUDE.md`(같은 저장소 루트)에 훨씬 방대하게 있고, 이 문서는
그중 "인프라/배포/외부 연동" 구조만 뽑아 정리한 것.

## 한눈에 보기

```
[티스토리 블로그 ghlee.tistory.com, 9bolt 스킨]
   ├─ skin.html (레이아웃) ── 티스토리 관리자 화면에 "수동 붙여넣기"로만 반영됨
   └─ <script>/<link> 태그들이 아래 정적 자산을 로드
          │
          ▼
[GitHub Pages] https://goodbyestarwars.github.io/tistory-ticker/{경로}
   - 이 저장소(github.com/goodbyestarwars/tistory-ticker)의 master 브랜치를 그대로 정적 서빙
   - js/*.js, css/*.css, data/*.js
   - git push → master 되는 순간 1~10분 내 자동 반영 (cache max-age=600)
          │
          ├─ (일부 위젯) → Google Apps Script 웹앱  ─────────────┐
          │                                                       │
          └─ (일부 위젯) → 클라우드 VM(FastAPI, goodbyestar.cloud) │
                                                                   │
                                                                   ▼
                                                        [외부 API들]
                                                   키움증권 REST / KIS(한국투자증권)
                                                   Open API / 네이버 금융 / DART /
                                                   Groq(LLM) / 구글 캘린더 / KRX 공시 RSS
```

브라우저(방문자)가 직접 부르는 백엔드가 2군데로 나뉜다: **GAS**와 **VM**. 어느 위젯이
어느 쪽을 부르는지는 `CLAUDE.md`의 파일별 표에 다 적혀 있지만, 대략:
- GAS: 시세 배치조회, 뉴스+AI요약, 시황분석/AI해설, 히트맵, 차트(flowChart), 투자시그널 재포장,
  펀더멘탈, 패턴스캔 결과 등 — "캐싱이 필요하거나 비밀키(Groq)를 써야 하는" 대부분
- VM: 실시간에 가까운 값이 필요한 것(호가창 2초 폴링, 종목 수급 온디맨드, 관심지수 리본,
  글로벌 시장지표, 사이드바 랭킹, 투자자별 매매동향) — 서버가 상시 떠 있어야 하는 것들

## 배포 경로별 정리 (제일 헷갈리는 부분)

| 컴포넌트 | 저장 위치 | 배포 트리거 | 반영까지 |
|---|---|---|---|
| `js/*.js`, `css/*.css`, `data/*.js` | 이 GitHub 저장소 | `master`에 push | 1~10분 (GitHub Pages, 캐시 max-age=600) |
| `gas/ticker-proxy.gs` | 이 저장소 + Google Apps Script 프로젝트(별도) | **script.google.com에서 수동 "새 배포"** | git push만으론 반영 안 됨 |
| `scripts/cloud-vm/*.py` (FastAPI) | 이 저장소 + VM(`goodbyestar.cloud`) | git push 후 VM이 자동 배포(약 5분) | 5분 |
| `skin.html` | 이 저장소(히스토리/리뷰용) + 티스토리 스킨 편집기 | **티스토리 관리자 → 꾸미기 → 스킨 편집 → HTML 편집에 수동 붙여넣기** | git push는 배포 경로가 아님 |
| `scripts/fetch_investor_flow.py` | 이 저장소, 실행은 사용자 PC 로컬 | 사용자가 PC에서 하루 1회 수동 실행 → 결과를 git push | 실행 즉시 (수동) |

작업 브랜치는 항상 **최종적으로 `master`에 fast-forward merge**까지 해야 실제로 블로그에
반영된다. session 브랜치에만 push하면 GitHub Pages에 안 올라감.

## 컴포넌트별 상세

### 1. GitHub Pages (정적 프론트)
- 저장소: `goodbyestarwars/tistory-ticker`, `master` 브랜치를 그대로 서빙
- 파일명 버저닝 금지 — 같은 URL이 티스토리 HTML에 그대로 박혀 있어서, 새 파일을 만들지 않고
  기존 파일을 계속 덮어쓴다

### 2. Google Apps Script 프록시 (`gas/ticker-proxy.gs`)
- 단일 GAS 프로젝트, 웹앱으로 배포(`{URL}?codes=...`, `?action=...` 등 쿼리파라미터로 라우팅)
- 비밀키는 코드에 하드코딩하지 않고 **스크립트 속성**(Apps Script 편집기 → 프로젝트 설정 →
  스크립트 속성)에 저장: `GROQ_API_KEY`, `KIWOOM_VM_URL`, `KIWOOM_VM_TOKEN` 등
- `CacheService`로 응답 캐싱(항목마다 TTL 다름, 보통 몇 분~30분)
- 여기서 VM을 호출할 때는 `X-API-Key` 헤더(`KIWOOM_VM_TOKEN`)로 인증
- **코드를 고쳐도 script.google.com에서 수동으로 "배포 → 배포 관리 → 새 버전"을 눌러야
  실제 반영됨** — 이 저장소에 push만 해두는 건 히스토리 보관일 뿐

### 3. 클라우드 VM (`scripts/cloud-vm/`, FastAPI, `goodbyestar.cloud`)
- 엔트리포인트 `main.py` (`uvicorn main:app`), systemd 서비스로 상시 구동
- 도메인별 모듈: `kiwoom_client.py`/`kiwoom_market.py`(키움 시세·수급), `kis_client.py`(KIS
  API), `order_book.py`(실시간 호가), `market_rank.py`(거래량/상하한가 랭킹),
  `investor_trend.py`(투자자별 매매동향), `domestic_futures.py`/`foreign_futures.py`/
  `btc_futures.py`/`bond_yield.py`(글로벌 시장지표), `naver_news.py`(네이버 뉴스 검색 우회),
  `pattern_detect.py`/`daily_scan.py`/`invest_signal.py`(차트패턴·투자시그널 배치 스캔),
  `fundamentals.py`/`dart_client.py`(재무제표), `db_schema.py`(SQLite)
- 뉴스 모멘텀은 `news_momentum.py`(별도 `news_momentum.db` 스키마·이슈 집계·DataLab 저장)와
  `news_momentum_scan.py`(기본 지정 8종목 파일럿, 명시적 `--full`만 전종목)로 분리한다. 브라우저의
  `/news-momentum/{code}` 조회는 DB만 읽고 NAVER API를 호출하지 않는다. 별도 systemd 쓰기
  권한을 요구하지 않고 기존 `kiwoom-deploy.timer`의 5분 주기를 재사용한다.
  `deploy_check.sh`는 `goodbyestarwars` 사용자·`/home/goodbyestarwars/kiwoom-api`
  WorkingDirectory·venv Python 절대경로를 검증하고, `flock`과 Asia/Seoul 날짜 마커로 하루
  한 번만 8종목 배치를 실행한다. 배치·DB·API 확인이 모두 성공한 뒤에만 날짜 마커를 쓰며
  실패는 배포 SHA나 FastAPI 재시작 결과에 영향을 주지 않고 다음 5분 회차에서 재시도한다.
  전종목 전환 전까지 `--full`을 붙이지 않는다.
  배치는 OS 파일 잠금으로 중복 실행을 건너뛰고, 최근 90일 백필의 요청 시작일·실제 시작일·
  기준일·완료 여부를 `news_stock_coverage`에 기록한다.
- 자동 배포는 서비스 재시작 전에 `backup_sqlite.py`의 Python `sqlite3.Connection.backup()`으로
  `ohlc_snapshot.db`를 `backups/`에 백업하고 무결성 검사 후 최근 7개만 보관한다. 배포 뒤
  `/health`, `/news-momentum/000660`, 인증 `/ohlc/005930`을 점검한다. 실패 시
  기존 API 배포 회귀검사는 모멘텀 배치와 분리한다. 모멘텀 실패 시 기존 배포를 롤백하거나
  FastAPI를 다시 시작하지 않고 날짜 마커를 남기지 않는 방식으로만 재시도를 예약한다.
- 필수 환경변수: `KIWOOM_APPKEY`/`KIWOOM_SECRETKEY`(키움 REST), `API_TOKEN`(GAS→VM 인증용
  자체 토큰), 선택: `KIS_APPKEY`/`KIS_APPSECRET`(KIS API), `NAVER_APIHUB_CLIENT_ID`/`_SECRET`
- 두 가지 호출 경로가 있음:
  1. **GAS가 대신 호출**하는 라우트 — `X-API-Key` 헤더 필요(비공개, GAS 스크립트 속성의
     토큰만 통과)
  2. **브라우저가 직접 호출**하는 라우트 — 인증 없음, 대신 `CORSMiddleware`로
     `https://ghlee.tistory.com` 도메인만 허용(호가창처럼 2초 간격 폴링이라 GAS를 거치면
     느려지는 것들)
- git push하면 VM이 약 5분 내 자동 재배포(구체적 CI/CD 스크립트는 이 저장소 밖, VM 쪽 설정)

### 4. skin.html (티스토리 스킨 HTML)
- 2026-07-27부터 git으로 추적은 하지만, **git에 있다고 배포되는 게 아님** — Tistory는 이
  저장소를 pull하지 않는다
- 실제 반영은 항상 티스토리 관리자 → 꾸미기 → 스킨 편집 → HTML 편집에 수동 붙여넣기
- 티스토리 서버 치환 태그(`[##_..._##]`, `<s_xxx>`)가 포함된 블록(로고/검색창/카테고리/
  방문자통계/글목록/방명록/페이지네이션/인기글/해시태그/카피라이트)은 정적 JS로 옮길 수 없어
  skin.html에 그대로 남아있음. 태그 없는 순수 UI는 `js/skin-shell.js`가 런타임에 주입.

### 5. 로컬 전용 데이터 수집 (`scripts/fetch_investor_flow.py`)
- 공매도/대차거래/연기금 데이터. 계좌 연동 개인키(키움 API 앱키가 IP 등록 방식)라 GAS 같은
  공개 서버나 GitHub Actions 같은 유동 IP 클라우드에 못 둠
- 사용자 PC에서 하루 1회 로컬 실행 → 결과(`data/investor-flow-cache.js`)를 git push

## 외부 API / 데이터 소스

| 소스 | 용도 | 접근 경로 |
|---|---|---|
| 키움증권 정식 REST API | 시세, 수급(개인·외국인·기관), 호가, 랭킹, 차트, 공매도/대차/연기금 | VM(`kiwoom_client.py`) + 사용자 PC 로컬 스크립트 |
| 한국투자증권(KIS) Open API | 야간선물, 시장별 투자자매매동향(일별) | VM(`kis_client.py`), GAS 일부 |
| 네이버 금융 | 실시간 시세 폴링(백업), 종목뉴스, 뉴스검색(VM 경유로 IP 화이트리스트 우회) | GAS 직접 + VM(`naver_news.py`) |
| DART(전자공시) | 재무제표(5년 추세, 최근분기) | VM(`dart_client.py`) |
| Groq API (`llama-3.3-70b-versatile`) | AI 요약 전반(종목뉴스 3문장 요약, 오늘 등락 이유 한줄요약, 시황분석, 투자의견 근거, 서브인덱스 해설) | GAS(`callGroq`), 스크립트 속성에 키 저장 |
| 구글 캘린더 API | 증시캘린더 이벤트(실적발표 등) | `js/stock-calendar.js`에 API 키 하드코딩(노출 상태, 리퍼러 제한 필요) |
| KRX 공시 RSS | 실시간 공시 피드 | GAS(`?market=0`) 경유, XML/base64 파싱은 프론트에서 |
| KRX 내부 크롤링 경로 | ~~사용 중단~~ | **2026-07-11부로 완전 차단됨 — 재시도 금지** |

## 개발 중에 쓰는 MCP (★ 프로덕션 인프라 아님, VM에 배포된 것도 아님)

VM에는 MCP 서버가 떠 있지 않다 — VM은 순수 FastAPI REST 서버다. "MCP"는 **개발할 때
Claude Code 세션에서 API 문서/응답 필드를 확인하려고 쓰는 로컬 도구**이고, 사용자의 Windows
PC에 등록돼 있다:

- **`kis-code-assistant-mcp`**: 한국투자증권 공식 코드검색 MCP. `claude mcp add`로 user
  scope 등록, 경로 `C:\Users\goodb\.mcp-servers\open-trading-api\MCP\KIS Code Assistant MCP`.
  KIS TR 코드/파라미터를 찾을 때 씀(코드 검색 전용, 실제 API 호출/테스트는 못 함).
- **`mcp__kiwoom__*`**: 키움증권 REST API의 실제 응답 필드를 확인할 때 쓰는 MCP(개발 세션에서
  실계정으로 직접 호출해 필드명을 확인). `scripts/fetch_investor_flow.py` 등 일부 코드는
  "이 MCP로 확인한 필드 기준으로 작성했지만 실계정 미검증"이라고 명시된 부분이 있음 -
  실제 서비스 트래픽과는 무관.
- ChatGPT에 이 프로젝트 작업을 맡길 때는 이 MCP들이 없으므로, 키움/KIS API 파라미터·응답
  필드가 필요한 작업(REST 엔드포인트 신규 추가 등)은 이미 검증된 기존 코드(`kiwoom_client.py`,
  `kiwoom_market.py`, `kis_client.py`)의 패턴을 그대로 따라 하게 시키는 게 안전함 — API
  문서를 새로 찾아 짐작하게 하면 필드명이 틀릴 위험이 큼(코드 곳곳에 "미검증" 표시가 그런 사례들).

## 색상/UI 컨벤션 (참고)

- 상승=빨강(`#d24f45`), 하락=파랑(`#1261c4`)
- 다크모드는 `html.dark` 클래스 토글 방식(OS `prefers-color-scheme` 아님) — 배경
  `#1A1A1A` + 글자 `#F5EFE0` 2색 체계로 통일돼 있음(의미색인 상승/하락/뱃지/별점 등은 예외)

## 이 문서가 다루지 않는 것

파일별 상세 이력, 특정 버그의 원인/수정 과정, 종목 데이터 검증 규칙 등은 전부
`CLAUDE.md`에 있다. ChatGPT에게 "이 리포에서 이 위젯 고쳐줘" 식으로 시킬 땐 이 문서 +
`CLAUDE.md`의 해당 파일 행을 같이 붙여넣는 걸 권장.
