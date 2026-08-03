# 9Pay 증권 소스코드 정의서

작성일: 2026-08-03 · 기준 커밋: `3565730` (`master`) · 작성 방식: 전체 소스 직독(프론트 25개 JS, GAS 1개 파일 3,090줄, 백엔드 38개 Python 파일 8,664줄)을 근거로 작성. 코드는 수정하지 않았다.

이 문서는 파일 단위로 "무엇이 있는가"를 정리한다. 인프라·배포 구조는 `ARCHITECTURE_SPEC.md`, DB 스키마는 `DB_SPEC.md`를 본다.

## 목차

1. 저장소 구조 개요
2. 프론트엔드 정적 자산 (`js/`, `css/`, `data/`)
3. GAS 프록시 (`gas/ticker-proxy.gs`)
4. 백엔드 VM (`scripts/cloud-vm/`)
5. 테스트 (`test/`)
6. 코드 품질 점검 결과 (속도 · 오류 · 보안)

---

## 1. 저장소 구조 개요

```
tistory-ticker/
├── skin.html            # Tistory 스킨 HTML (수동 배포)
├── style.css             # 스킨 공통 CSS (122,996 bytes)
├── js/                    # 위젯 스크립트 25개, 16,576줄 (GitHub Pages 서빙)
├── css/                   # 위젯 스타일 22개, 8,814줄
├── data/                  # window.XXX 정적 데이터 6개 (js/md)
├── gas/ticker-proxy.gs    # Google Apps Script 프록시 1개 파일, 3,090줄
├── scripts/cloud-vm/      # FastAPI 백엔드 38개 .py, 8,664줄
├── test/                  # 로컬 프리뷰 HTML 20개 + pytest 5개
├── docs/                  # 문서(README/UI_GUIDE/WORK_HISTORY/본 정의서 3종)
└── ARCHITECTURE.md, API_REFERENCE.md, CLAUDE.md, AGENTS.md  # 루트 상시 참조 문서
```

의존성 관리 파일(`requirements.txt` 등)은 이 저장소에 없다 — Python 패키지는 VM에서 별도로 관리된다(레포 밖).

---

## 2. 프론트엔드 정적 자산

### 2.1 JS 위젯 (`js/`, 25개 파일, 16,576줄)

Tistory 스킨(`ghlee.tistory.com`)에 GitHub Pages 정적 자산으로 로드되며, 대부분 GAS 웹앱 또는 VM(`goodbyestar.cloud`) REST API를 `fetch`로 호출해 DOM을 렌더링한다. 데이터 파일은 `window.XXX = {...}` 전역 규약을 따른다.

| 파일 | 줄수 | 역할 | 주요 함수/전역/마운트 | 호출 API |
|---|---:|---|---|---|
| `invest-signal.js` | 18 | 폐기된 페이지 → `/page/foreign-flow` 리다이렉트 | 마운트 `#invest-signal` | 없음 |
| `market-ribbon.js` | 33 | 폐기된 상단 리본을 숨김 처리 | `window.MarketRibbon.init` | 없음 |
| `skin-shell.js` | 70 | skin.html 빈 mount에 정적 마크업 주입(모바일 오버레이·검색 오버레이·스크롤탑·푸터) | 즉시실행, 전역 노출 없음 | 없음 |
| `skin-menu.js` | 148 | 공통 1차/2차 내비게이션 렌더링, 사이드바 검색창 마운트 | `NAV_ITEMS`, `render()`, `#nav-menu-mount` | 없음(StockSearchPanel 호출) |
| `pension-fund.js` | 257 | 연기금 단독 수급 분석 위젯 | `window.PensionFund`, `#pension-fund` | GAS `?action=pensionFund&code=` |
| `short-pressure.js` | 279 | 공매도 압박 점수 위젯 | `window.ShortPressure`, `#short-pressure` | GAS `?action=shortPressure&code=` |
| `sidebar-rank.js` | 285 | 우측 사이드바 실시간 랭킹(거래량/등락률 TOP) | `window.SidebarRank`, `#sidebar-rank` | VM `/market-rank` |
| `stock-calendar.js` | 285 | 증시 캘린더(구글 캘린더 + DART 실적 병합) | `window.StockCalendar`, `#stock-calendar` | **Google Calendar API(키 하드코딩, 리퍼러 제한 적용됨)**, VM `/earnings-calendar` |
| `sector-dashboard-v4.js` | 300 | 섹터별 카드/히트맵(증시온도 위젯이 재사용) | `window.SectorDashboard`, `#sector-dashboard` | GAS `?codes=`, `?marketAnalysis=1` |
| `investor-trend-widget.js` | 320 | 홈 전용 투자자별(개인/외국인/기관) 매매동향 표 | `window.InvestorTrendWidget`, `#investor-trend-widget` | VM `/investor-trend` |
| `stock-search-panel.js` | 446 | 사이드바 종목검색 드롭다운(즐겨찾기/최근검색) | `window.StockSearchPanel`, `#navSearchInput` | GAS `?codes=`, `data/krx_map.js` 지연로드 |
| `ticker-tooltip-v5.js` | 492 | 본문 내 `$종목명` 자동 감지 → 뱃지/툴팁 | `window.TickerTooltip`, `.post-single-body` | GAS `?codes=`, 네이버 차트 이미지 |
| `watchlist.js` | 534 | 관심종목(MY) 카드, localStorage 저장, 실시간 체결가 | `window.Watchlist{add,remove,has}`, `#watchlist` | GAS `?codes=`, WS `wss://goodbyestar.cloud/ws/quotes` |
| `marketcap-bubble.js` | 644 | 시가총액 트리맵(스퀘어파이드) | `window.MarketcapBubble`, `#marketcap-bubble` | GAS `?bubble=1` |
| `home-widgets.js` | 691 | 홈 카드 8개 순서/숨김 관리(드래그앤드롭) | `window.HomeDashboardWidgets.init`, `.home-widget-grid` | GAS(`?market=0`), VM WS |
| `pattern-scan.js` | 714 | 차트 패턴 스캐너(5종, 캔들+일목균형표) | `window.PatternScan`, `#pattern-scan` | GAS `?patternScan=1`,`?patternChart=1`, unpkg LWC CDN |
| `order-book.js` | 738 | 실시간 호가창(2초 폴링) + 매물벽 돌파 감지 | `window.OrderBook`, `#order-book` | VM `/order-book/{code}`, GAS `?codes=`, WS |
| `overnight-market.js` | 752 | 글로벌 시장지표(미국지수/VIX/원자재/채권/코인) | `window.OvernightMarket`, `#overnight-market` | VM `/futures`,`/futures/avg`, GAS `?action=subIndexAnalysis`, LWC CDN |
| `kospi-futures.js` | 763 | 코스피200 주/야간선물 캔들차트 + 옵션 수급 + AI해설 | `window.KospiFutures`, `#kospi-futures` | VM `/futures`,`/option-flow`, GAS `?action=kospiFuturesAnalysis`, LWC CDN |
| `market-temp.js` | 851 | 증시온도(0~40℃) 게이지, AI브리핑, 레이더차트 | `window.MarketTemp`, `#market-temp` | GAS `?marketTemp=1`,`?marketTempBriefing=1` |
| `quick-indices.js` | 885 | 홈 전용 관심지수 카드 바(11종) + 긴급속보 패널 | `window.QuickIndices`, `#quick-indices`(동적 생성) | GAS `?market=1`,`?rankNews=1`, VM `/futures` |
| `stock-news.js` | 888 | 종목별 뉴스(리스트+AI요약+공시+랭킹뉴스) | `window.StockNews`, `#stock-news` | GAS `?codes=`,`?news=1`,`?rankNews=1` |
| `stock-search.js` | 910 | 독립 "실시간 시세" 페이지(검색+호가창+캔들차트) | `window.StockSearch`, `#stock-search` | GAS `?codes=`,`?action=priceReason/flowChart`, LWC CDN |
| `skin-main.js` | 1,022 | 스킨 공통: 다크모드/폰트 토글, 홈 대시보드 조립, 카테고리 파싱, 아티클 모달, 모바일 드로어 | `window.readPost/sharePost`, `buildHomeDashboard()` | GAS(`?marketTemp=1`,`?bubble=1`,`?patternScan=1`) |
| `foreign-flow.js` | 4,251 | **최대 파일.** 종목분석 메인: 투자시그널·수급표·매물대·캔들차트·펀더멘탈·뉴스모멘텀·AI 종합요약 | `window.ForeignFlow{fetchFlow,fetchAnalysisSummary,...}`, `#foreign-flow` | GAS 다수 액션, VM(`/foreign-flow/{code}`,`/investor-flow/{code}`,`/news-momentum/{code}`), LWC CDN |

### 2.2 CSS (`css/`, 22개 파일, 8,814줄)

위젯 1개당 CSS 1개가 원칙이며 `foreign-flow.css`(87KB)가 최대다. `sector-dashboard-v3.css`(JS는 v4)와 `ticker-tooltip-v3.css`(JS는 v5)는 파일명 버전 표기가 JS와 어긋나 있다(§6 오류 참고). `legal.css`는 이용약관 등 정적 고지 페이지 전용.

### 2.3 데이터 파일 (`data/`, window.XXX 규약)

| 파일 | 전역 변수 | 내용 | 갱신 방식 |
|---|---|---|---|
| `krx_map.js` | `window.KRX_MAP` | 종목명 → 6자리 코드 매핑(전 상장사) | 수동 |
| `wics-map.js` | `window.WICS_MAP` | 코드 → {name, sector, industry} WICS 업종 | 수동 |
| `sectors-v3.js` | (스크립트 내 배열) | 커스텀 섹터 분류 37개, {name, code, market} | 수동, `sectors-v3-검수표.md`로 교차검증 |
| `marketcap-codes.js` | - | 히트맵용 ETF/레버리지/인버스 코드 목록 | 수동 |
| `investor-flow-cache.js` | `window.INVESTOR_FLOW_CACHE` | 공매도/대차/연기금 캐시(섹터 풀만) | PC 로컬 1일 1회 수동 실행 → git push |

DB 관점의 상세 스키마는 `DB_SPEC.md` §4를 본다.

### 2.4 skin.html / style.css

`skin.html`(305줄)은 Tistory 서버 치환 태그(`[##_..._##]`, `<s_xxx>`)가 포함된 블록만 남기고, 순수 UI는 `js/skin-shell.js`가 런타임 주입한다. git 추적은 하되 실제 반영은 Tistory 관리자 수동 붙여넣기다.

---

## 3. GAS 프록시 (`gas/ticker-proxy.gs`, 3,090줄, 함수 108개)

단일 파일, `doGet` 쿼리파라미터 라우팅. 인증은 요청 파라미터 기준 없음(공개 프록시) — VM 호출 시에만 `X-API-Key`를 스크립트 속성에서 읽어 첨부한다.

### 3.1 라우팅 표

| 파라미터 | 값 | 핸들러 | 비고 |
|---|---|---|---|
| `market` | `1` | `getMarketRibbon()` | 시세 리본 |
| `news` | `1`(+`code`,`name`) | `getStockNews()` | 종목뉴스 |
| `marketAnalysis` | `1` | `getMarketAnalysis()` | 시황분석 AI |
| `action` | `kospiFuturesAnalysis` | `getKospiFuturesAnalysis()` | 선물 AI해설 |
| `action` | `subIndexAnalysis` | `getSubIndexAnalysis()` | 서브인덱스 AI해설 |
| `marketTemp` | `1` | `getMarketTemp()` | 증시온도 |
| `marketTempBriefing` | `1` | `getMarketTempBriefing()` | 증시온도 AI브리핑 |
| `bubble` | `1` | `getMarketcapBubble()` | 시총 히트맵 |
| `action` | `foreignFlow`(+`code`) | `getForeignFlow()` | 외국인·기관 수급(네이버 크롤링) |
| `action` | `shortPressure`(+`code`) | `getShortPressure()` | 공매도 압박 |
| `action` | `pensionFund`(+`code`) | `getPensionFund()` | 연기금 |
| `action` | `flowAiSummary` | `getFlowAiSummary()` | 종목 AI 한줄평 |
| `action` | `flowChart`(+`code`) | `getFlowChart()` | 종목 캔들차트 |
| `action` | `priceReason`(+`code`,`name`,`changeRate`) | `getPriceMoveReason()` | 등락 이유 AI 요약 |
| `action` | `indexChart`(+`symbol`) | `getIndexChart()` | 지수 차트 |
| `action` | `investorFlow` | (폐기, 실제 분기 없음) | — |
| `action` | `fundamentals`(+`code`) | `getFundamentals_()` | 펀더멘탈 |
| `debugShortNaver` | `1`(+`code`,`debugKey`) | `debugShortTradeNaver()` | 진단용, 2026-08-03부터 `DEBUG_ACCESS_KEY` 스크립트 속성 필요(속성 미설정 시 비활성화, §6 보안 참고) |
| `rankNews` | `1` | `getRankingNews()` | 랭킹뉴스 |
| `patternScan` | `1` | `getPatternScanResult()` | 패턴스캔 배치 결과 |
| `patternChart` | `1`(+`code`,`pattern`) | `getPatternChart()` | 패턴 차트 |
| `investSignal` | `1` | `getInvestSignalResult()` | 투자시그널 배치 결과 |
| `codes` | 콤마구분 목록(기본) | `fetchFromNaver()` | 기본 배치 시세 |

`doPost`/`onOpen` 등 다른 트리거는 없다(전부 GET).

### 3.2 함수 그룹

| 그룹 | 대표 함수 |
|---|---|
| 시세/지수/환율/코인 | `fetchFromNaver`, `applyNxtOverride_`, `getMarketRibbon`, `fetchIndex`, `fetchExchange`, `fetchCrypto*` |
| 히트맵 | `getMarketcapBubble`, `fetchQuotesWithCap`, `aggregateLeverage`, `pickUniverseQuotes` |
| 뉴스+AI요약 | `getStockNews`, `summarizeStockNews`, `getPriceMoveReason`, `getRankingNews`, `callGroq` |
| 수급(프론트 크롤링) | `getForeignFlow`, `parseFrgnRows`, `getShortPressure`, `parseShortTradeRows_`, `getPensionFund` |
| 차트 | `getFlowChart`, `getIndexChart`, `fetchDailyOhlc_`, `movingAverage_`, `computeSupportResistance_` |
| 패턴스캔(온디맨드) | `detectRisingLows_`, `detectDoubleBottom_`, `detectInvHeadShoulders_`, `detectBoxRangeLow_`, `detectPullback_`, `getPatternChart` |
| 배치 재포장 | `getPatternScanResult`, `getInvestSignalResult`(VM `daily_scan.py` 결과 passthrough) |
| 증시온도 | `getMarketTemp`, `computeCombinedFlowScore_`, `computeSectorStrengthScore_`, `computeWeek52Score_`, `computeExchangeScore_`, `computeUsFuturesScore_` |
| VM 연동/공통 | `kiwoomVmFetch_`, `fetchFuturesFromVm_`, `fetchOptionFlowFromVm_`, `cacheKeyFor`, `jsonResponse`, `safeCall` |

### 3.3 외부 API 호출 목록

`polling.finance.naver.com`(시세) · `api.stock.naver.com`(환율) · `api.bithumb.com`/`api.coingecko.com`(BTC) · `m.stock.naver.com`(종목뉴스) · `finance.naver.com/item/frgn·short_trade·sise_day`(HTML 크롤링) · `query1.finance.yahoo.com`(VIX, ES=F) · `api.groq.com`(LLM) · VM `goodbyestar.cloud`(`/futures`,`/option-flow`은 무인증, 그 외는 `X-API-Key`) · GitHub Pages(`data/sectors-v3.js` 텍스트 파싱).

### 3.4 CacheService 사용 패턴

공통 prefix `ticker_`(예외: `fundamentals_v1_{code}`). 스키마 변경 시 키 버전을 올리는 관례(`market_temp_v5`, `sub_index_analysis_v7` 등)가 지켜지고 있다. TTL은 항목별 60초(장중 시세)~3시간(AI 요약)까지 다양하며, `getForeignFlow`/`getShortPressure`/`getPensionFund`/`getPatternChart` 등 온디맨드 크롤링류는 서버 캐시가 없고 클라이언트 5분 디바운스에 의존한다.

---

## 4. 백엔드 VM (`scripts/cloud-vm/`, 38개 .py, 8,664줄)

### 4.1 엔트리포인트(`main.py`, 737줄) 라우트 목록

`GET /health`, `/health/latency`, `/quote`, `/ohlc/{code}`, `/investor-flow/{code}`, `/foreign-flow/{code}`, `/investor-flow-batch`, `/fundamentals-batch`, `/fundamentals/{code}`, `/daily-scan-batch`, `/futures`, `/earnings-calendar`, `/futures/avg`, `/naver-news`, `/news-momentum/{code}`, `/option-flow`, `/market-rank`, `/order-book/{code}`, `/investor-trend`, `/week52-batch` + `WS /ws/quotes`. 상세 파라미터·응답·캐시 TTL은 `API_REFERENCE.md` 참고. `/ws/quotes`와 `/health/latency`는 `API_REFERENCE.md`에 없는 최신 추가분이라 이 문서와 소스가 1차 근거다.

### 4.2 도메인 모듈별 요약

| 파일 | 줄수 | 역할 | 주요 함수 |
|---|---:|---|---|
| `kiwoom_client.py` | 75 | 키움 REST 토큰 캐시 + TR 공통 호출기 | `get_token`, `call_tr` |
| `kiwoom_market.py` | 439 | 일봉(ka10081)/외국인·기관 일별수급(KIS 우선, ka10045 폴백) | `fetch_daily_ohlc`, `fetch_foreign_inst_daily` |
| `kis_client.py` | 317 | KIS Open API 클라이언트(토큰/웹소켓 접속키/REST) | `get_token`, `fetch_option_board`, `fetch_investor_trade_daily` |
| `db_schema.py` | 380 | `ohlc_snapshot.db` 스키마 + CRUD 헬퍼 | `get_conn`, `create_schema`, `load_daily_prices` 등 |
| `order_book.py` | 100 | 실시간 호가(ka10004)+체결(ka10003) | `fetch_order_book`, `fetch_trade` |
| `market_rank.py` | 140 | 거래량/상하한가 랭킹(ka10030/ka10017) | `fetch_sidebar_rank` |
| `investor_trend.py` | 457 | 시장별 투자자매매 동향(KIS→네이버→키움 폴백) | `backfill_kis`, `bucket_daily/weekly/monthly`, `start_background` |
| `investor_flow.py` | 389 | 공매도/대차/연기금+반대매매 압박 지표 | `fetch_stock`, `short_pressure_score`, `pension_streak` |
| `foreign_flow_compute.py` | 128 | 수급 표 rolling/streak/signal 순수 계산 | `rolling_sum`, `build_result` |
| `domestic_futures.py` | 278 | 코스피/코스닥/코스피200주간선물/환율(네이버) | `refresh_realtime_all`, `refresh_minute_all` |
| `foreign_futures.py` | 155 | 나스닥100/S&P500/다우/SOX/VIX/WTI/GOLD(네이버) | `refresh_realtime_all` |
| `btc_futures.py` | 156 | BTC/ETH(업비트) | `fetch_ticker`, `refresh_realtime` |
| `bond_yield.py` | 197 | 국고채3년(네이버)+미국채(FRED) | `fetch_fred_series`, `refresh_fred_all` |
| `option_flow.py` | 88 | 코스피200 옵션 콜/풋 수급 집계 | `refresh_option_flow` |
| `realtime_quotes.py` | 122 | 키움 0B 웹소켓→브라우저 중계 | `relay_quotes` |
| `night_futures_code.py` | 56 | 코스피200 야간선물 근월물 코드 파싱 | `get_front_month_code` |
| `night_futures_ws.py` | 263 | 야간선물 실시간(KIS WS)+일/분봉 백필 | `_run_once`, `refresh_minute` |
| `week52.py` | 28 | 52주 신고가/신저가 순수 계산 | `compute_week52` |
| `week52_scan.py` | 93 | 섹터풀 238종목 52주 배치 | `main` |
| `naver_news.py` | 68 | 네이버 API HUB 뉴스검색 프록시 | `search_news` |
| `dart_client.py` | 86 | DART OpenAPI(기업코드+재무제표) | `get_corp_code_map`, `call_fnltt` |
| `fundamentals.py` | 177 | DART 재무제표→5년 추세+최근분기 YoY | `fetch_stock` |
| `pattern_detect.py` | 825 | 차트패턴 5종 판정 | `scan_stock`, `compute_tech_score` |
| `daily_scan.py` | 310 | 전종목(~2,700) 패턴+눌림목+투자시그널 일 배치 | `main` |
| `invest_signal.py` | 180 | 투자시그널 점수/등급 계산 | `compute_verdict`, `upsert_ranked` |
| `batch_scan.py` | 249 | 전종목 공매도/대차/연기금+DART 재무 배치 | `main`, `scan_fundamentals` |
| `news_momentum.py` | 879 | 뉴스 반복이슈+DataLab 검색관심도 (`news_momentum.db`) | `extract_topics`, `load_stock_momentum` |
| `news_momentum_scan.py` | 484 | 뉴스모멘텀 배치 드라이버(파일럿/`--full`) | `run`, `BatchLock` |
| `earnings_calendar.py` | 93 | DART 접수 실적공시→캘린더 이벤트 | `fetch_month` |
| `migrate_fundamentals.py` | 77 | `fundamentals_cache.json` → SQLite 이관 | `main` |
| `migrate_investor_summary.py` | 59 | `investor_flow_cache.json` → SQLite 이관 | `main` |
| `backup_sqlite.py` | 94 | SQLite 원자적 백업(`VACUUM INTO`) | `backup_database` |
| `latency_monitor.py` | 103 | 주요 엔드포인트 응답시간 5분 주기 기록 | `run_once` |
| `post_deploy_check.py` | 84 | 배포 후 API 회귀 점검 | `main` |
| `rescan_patterns.py` | 96 | SQLite 기반 전종목 패턴 재채점(수동) | `main` |
| `verify_news_momentum_db.py` | 101 | `news_momentum.db` 무결성/커버리지 배포검증 | `verify_database` |
| `cleanup_price_recap_topics.py` | 101 | 과거 버그 노이즈 이슈 정리(dry-run 기본) | `find_noisy_topics` |

### 4.3 백그라운드 스레드(상시 구동, `main.py` `@app.on_event('startup')`)

`foreign_futures`, `domestic_futures`, `btc_futures`, `bond_yield`, `investor_trend`, (조건부) `night_futures_ws`, `option_flow` — 총 최대 7개 폴러가 동시에 `db_schema.get_conn()`으로 각자 SQLite에 쓴다.

---

## 5. 테스트 (`test/`)

로컬 프리뷰 HTML 20개(`?real=1`로 실제 GAS 호출 가능한 mock 페이지)와 pytest 5개(`test_foreign_flow_compute.py`, `test_kiwoom_market.py`, `test_latency_monitor.py`, `test_news_momentum.py`, `test_ui_ia.py`). 프론트 JS 25개, GAS 3,090줄에는 자동화된 단위 테스트가 없다 — 로컬 HTML 프리뷰가 유일한 검증 수단이다.

---

## 6. 코드 품질 점검 결과

전체 소스(프론트 25개 JS + GAS 1개 파일 + 백엔드 38개 Python)를 직접 읽고 확인한 결과다. 이 시점에는 **보안 항목을 포함해 발견 사실만 기록**했다. **2026-08-03(같은 날 후속 작업 2건)**: 사용자 요청으로 (1) `gas/ticker-proxy.gs` 항목, 이어서 (2) 백엔드(`scripts/cloud-vm/`)·프론트(`js/`) 항목까지 표에 남은 것 대부분을 실제로 수정했다 — 표는 발견 당시 기록을 그대로 남기고 수정 여부만 각주로 남긴다. `.nav-logo-name` 깨진 문구(사용자 확인 필요)만 임의로 바꾸지 않고 미수정으로 남겼다.

### 6.1 속도 — 우선순위 상위

| 위치 | 문제 | 영향 |
|---|---|---|
| `gas/ticker-proxy.gs` `getMarketTemp()` | 캐시 미스 1건당 외부 HTTP 15회 이상 직렬 호출(네이버 배치 6회 + Yahoo 2회 + VM 2회 + GitHub Pages 2회 등) | **GAS 일부 수정됨(2026-08-03)**: `sectors-v3.js` 중복 fetch 제거(1회→0회 절감) + `computeCombinedFlowScore_` 중복 크롤링 제거로 요청 수 축소. VIX/Week52/환율/미국선물 등 나머지 독립 호출의 전면 병렬화(fetchAll 재구조화)는 리스크 대비 효과가 작아 보류 |
| `gas/ticker-proxy.gs` `computeCombinedFlowScore_` | `foreign`/`inst` 계산을 위해 동일 종목(069500) 수급을 2번 크롤링(총 4요청) | **GAS 수정됨(2026-08-03)**: `computeFlowRatioFromData_`로 분리해 `getForeignFlow`를 1회만 호출하도록 변경(4회→2회) |
| `gas/ticker-proxy.gs` `fetchQuotesWithCap` | ~266개 코드를 `UrlFetchApp.fetchAll` 대신 `for` 루프 순차 fetch(같은 파일의 `fetchDailyOhlc_`는 이미 `fetchAll` 사용 중) | **GAS 수정됨(2026-08-03)**: `fetchDailyOhlc_`와 동일한 `fetchAll` 청크 병렬 패턴으로 교체 |
| `main.py:157-159, 525-526, 705-706` | 캐시 상한 도달 시 LRU가 아니라 `cache.clear()`로 전량 비움 | **수정됨(2026-08-03)**: `_ohlc_cache`/`_investor_flow_cache_mem`/`_foreign_flow_cache_mem`/`_futures_cache`/`_order_book_cache`/`_earnings_calendar_cache` 6곳 모두 `OrderedDict` 기반 LRU(`_evict_lru`)로 교체 - 상한 초과 시 1건씩만 제거 |
| `kis_client.py:174-198` | "TEMP DEBUG(2026-07-20 3차)" 표시된 디버그용 교차검증 호출이 옵션 수급 5분 폴링마다 상시 실행 | **수정됨(2026-08-03)**: 디버그 로깅 블록과 `fetch_option_quote` 교차검증 호출(+ 이제 미사용인 `fetch_option_quote` 함수)을 제거. 콜/풋 자동 교정 로직(delta 부호 기반)은 그대로 유지 |
| `domestic_futures.py:236-248` | `refresh_minute_all`이 심볼과 무관하게 항상 동일 카테고리 조회(§6.2 오류와 동일 지점) | 5분마다 동일 API 중복 호출 |
| `market_rank.py:130-140`, `investor_flow.py:266-283`, `order_book.py:90-100` | 각 3~4회 외부 TR을 순차 블로킹 호출(`investor_flow`는 `sleep(0.25)`×3 포함) | 캐시 미스 시 응답시간 누적(최소 0.75초+) |
| `gas/ticker-proxy.gs` `getRankingNews()` | `RANK_NEWS_QUERIES` 3개를 `kiwoomVmFetch_`로 순차 호출(각 최대 2회 재시도, 최대 6회 직렬 왕복) | **GAS 수정됨(2026-08-03)**: `fetchNaverSearchNewsAll_`로 `UrlFetchApp.fetchAll` 1회 병렬 요청 + 실패한 쿼리만 개별 폴백하도록 변경 |

### 6.2 오류(버그) — 우선순위 상위

| 위치 | 문제 | 재현/영향 |
|---|---|---|
| `gas/ticker-proxy.gs` (`getFlowAiSummary`, `getMarketAnalysis`, `getKospiFuturesAnalysis`, `getSubIndexAnalysis`, `getMarketTempBriefing`) | Groq 실패 시 빈 문자열 `''`을 "실패 캐시"로 저장 → `if (cached)` 검사가 `''`을 falsy로 판정해 **캐시 히트가 항상 무효화**됨 | **GAS 수정됨(2026-08-03)**: 5곳 전부 `cached !== null` 판정으로 교체해 의도한 2분 백오프가 실제로 동작하도록 수정. `getMarketAnalysis`/`getKospiFuturesAnalysis`/`getSubIndexAnalysis`의 "데이터 없음" 조기 반환 분기에도 실패 캐시를 추가해 장애 중 반복 재시도를 줄임 |
| `domestic_futures.py:51,236-248` ↔ `night_futures_ws.py:157-182` | 코스피200 **야간선물** 분봉을 두 백그라운드 스레드가 서로 다른 소스(하나는 주간 FUT, 하나는 실제 야간선물)로 같은 `(symbol='KOSPI200_NIGHT', ts)` 행에 upsert | **수정됨(2026-08-03)**: `domestic_futures.MINUTE_SYMBOLS`에서 `KOSPI200_NIGHT`를 제거해 `night_futures_ws.py`만 이 심볼의 분봉을 쓰도록 단일 소스화. `night_futures_ws`가 못 뜬 환경에서는 야간선물 분봉이 비어있는 게, 다른 상품 시세로 잘못 채워지는 것보다 낫다는 원칙 적용 |
| `gas/ticker-proxy.gs:1893-1996` `getShortPressure()` | `finance.naver.com/item/short_trade.naver` 컬럼 순서가 "frgn.naver와 같을 것"이라는 **미검증 추정**으로 파싱, 그대로 프론트에 확정값처럼 노출 | **부분 대응(2026-08-03)**: 실제 컬럼 순서를 라이브로 확인할 수단인 `?debugShortNaver=1`이 인증 없이 열려 있던 것을 `DEBUG_ACCESS_KEY` 스크립트 속성 검증으로 잠갔다(보안 §6.3). 컬럼 순서 자체의 검증은 실제 네이버 응답 대조가 필요해 이 세션(외부망 접근 불가)에서는 못함 — 개발자가 `DEBUG_ACCESS_KEY`를 설정해 `?debugShortNaver=1&debugKey=...`로 직접 확인 필요 |
| `js/skin-menu.js:130-136` | 모든 페이지 로드마다 `.nav-logo-name` 텍스트를 `'ㄱㅖ조 ㅏ심폐소생술'`(자모 분리된 깨진 한글)로 강제 치환 | 의도한 문구인지 재확인 필요 — **미수정**(브랜드 문구라 사용자 확인 없이 임의로 바꾸지 않음, 2026-08-03에도 보류) |
| `gas/ticker-proxy.gs` 8곳 (기본 `?codes=` 라우트 포함) | 캐시값 `JSON.parse(cached)`를 try/catch 없이 호출(같은 파일 `fetchFundamentalsForCode_`는 방어 처리됨) | **GAS 수정됨(2026-08-03)**: 공용 헬퍼 `parseCachedJson_`을 추가해 8곳 모두 파싱 실패 시 캐시 미스처럼 새로 조회하도록 통일 |
| `main.py:536-549` `_earnings_calendar_cache` | 다른 모든 메모리 캐시와 달리 상한/정리 로직 없음 | **수정됨(2026-08-03)**: `OrderedDict` + `_EARNINGS_CALENDAR_MAX_ENTRIES=200`으로 다른 캐시와 동일한 LRU 방어 추가 |
| `gas/ticker-proxy.gs:1228-1231` `logDailyMarketTemp_()` | 하루 1회 트리거가 `getMarketTemp()` 예외 처리 없이 호출 | **GAS 수정됨(2026-08-03)**: `safeCall`로 감싸 예외 발생 시에도 다음 날 트리거가 정상 동작하도록 수정 |

### 6.3 보안 — 발견 사실만 기록(수정 없음)

| 위치 | 위험도 | 발견 내용 |
|---|---|---|
| `gas/ticker-proxy.gs` `cacheKeyFor` | **높음** | `?codes=` 파라미터에 형식 검증이 없어, `?codes=market_ribbon3` 같은 값으로 다른 라우트(`getMarketRibbon` 등, 동일 `ticker_` prefix 고정 키 다수)의 캐시를 오염시킬 수 있다. 인증 없는 단일 GET 요청으로 재현 가능, 최대 3시간(AI요약류) 동안 모든 방문자에게 오염된 응답 노출. **GAS 수정됨(2026-08-03)**: 캐시 키에 전용 네임스페이스(`quotes_`)를 붙여 다른 라우트의 고정 키와 절대 겹치지 않도록 분리 |
| `gas/ticker-proxy.gs` `getFlowAiSummary` | 중간 | `code`만 정규식 검증되고 `name`/`flowNote`/`verdictLabel` 등은 검증 없이 Groq 프롬프트에 직접 삽입 + 결과가 캐시되어 다른 방문자에게 노출. 프롬프트 인젝션 + Groq 쿼터 남용 벡터. **GAS 수정됨(2026-08-03)**: 각 필드 길이 제한(200자)·제어문자 제거로 정제하고, 정제된 값들의 해시를 캐시 키에 포함시켜 위조 입력이 정상 캐시를 덮어쓰지 못하도록(별도 슬롯으로 격리) 변경 |
| `main.py` (`/futures`,`/option-flow`,`/market-rank`,`/order-book/{code}`,`/investor-trend`,`/investor-flow/{code}`,`/foreign-flow/{code}`,`/earnings-calendar`,`/health/latency`) | 중간 | 인증 없이 CORS만으로 "보호" — CORS는 서버-서버 직접 호출을 막지 못하므로 사실상 공개 API. 종목코드/기간 조합을 순회하면 캐시 미스를 유도해 키움/KIS/DART 쿼터를 소진시킬 수 있음(의도된 설계이나 레이트리밋 부재) | **부분 수정됨(2026-08-03)**: 종목코드별 캐시로 순회 남용에 특히 취약한 `/investor-flow/{code}`·`/foreign-flow/{code}`·`/order-book/{code}` 3곳에 IP당 분당 요청 상한(각 30·30·60회, `_check_rate_limit`)을 추가. `/futures`·`/option-flow`·`/market-rank`·`/investor-trend`·`/earnings-calendar`·`/health/latency`는 고정 키/좁은 파라미터 공간이라 캐시가 이미 효과적으로 방어하고 있어 대상에서 제외 |
| `main.py:228-234` `/ws/quotes` | 중간 | 접근 제어가 `Origin` 헤더 검사뿐이며 브라우저 외 클라이언트는 이 헤더를 임의 설정 가능. 동시 연결 수 상한도 없음 | **부분 수정됨(2026-08-03)**: 동시 연결 수 상한(`_WS_MAX_CONNECTIONS=200`) 추가로 자원 고갈 규모를 제한. `Origin` 검사 우회 가능성 자체는 구조적 한계라 미해결(별도 인증 토큰 도입이 필요한 더 큰 변경) |
| `js/stock-calendar.js:23-24` | 낮음~중간(확인됨) | Google Calendar API 키와 캘린더 ID가 소스에 하드코딩(ARCHITECTURE.md에 이미 "노출 상태"로 문서화됨) | **조치 확인됨(2026-08-03)**: GAS 프록시로 이관하는 방안을 한 차례 적용했으나, 사용자가 GCP 콘솔에서 이미 리퍼러 제한(이 블로그 도메인만 허용)을 걸어둔 상태라고 확인해 원복 — 키가 노출돼도 다른 도메인에서 남용할 수 없어 GAS 경유가 불필요하다고 판단, 기존 방식 유지 |
| `gas/ticker-proxy.gs` | 낮음 | `?debugShortNaver=1` 디버그 엔드포인트가 인증 없이 운영에 노출, 호출마다 네이버 실크롤링 유발(캐시 없음). **GAS 수정됨(2026-08-03)**: 스크립트 속성 `DEBUG_ACCESS_KEY`와 일치하는 `debugKey` 쿼리파라미터가 있을 때만 동작하도록 잠금(속성 미설정 시 라우트 전체 비활성화) |
| `js/marketcap-bubble.js:444-459` | 낮음~중간 | `item.name`/`item.breakdown`/`cl.label`을 이스케이프 없이 `innerHTML`에 삽입(같은 파일에 `escapeHtml` 유틸이 있음에도 누락). 공격 표면은 GAS 백엔드 손상 시로 제한 | **수정됨(2026-08-03)**: 세 곳 모두 기존 `escapeHtml` 적용 |
| `js/quick-indices.js:348-393` | 정보성 | 이스케이프 없는 `renderDiscNewsInto`/`renderRankNewsInto`가 정의돼 있으나 호출부가 없는 죽은 코드(현재 도달 불가, 재사용 시 XSS 소스가 됨) | **수정됨(2026-08-03)**: 기존 `escapeNewsHtml` 적용(여전히 도달 불가한 죽은 코드지만, 재사용 시에도 안전하도록 방어) |
| `main.py:187-192` `require_api_key` | 낮음 | `X-API-Key` 비교가 `hmac.compare_digest`가 아닌 일반 문자열 비교(이론적 타이밍 사이드채널) | **수정됨(2026-08-03)**: `hmac.compare_digest`로 교체 |
| `gas/ticker-proxy.gs` | 정보성 | VM 실 IP가 소스 주석에 노출(토큰 자체는 노출 안 됨). **GAS 수정됨(2026-08-03)**: 주석의 실 IP를 `{VM 고정 IP}` 플레이스홀더로 교체 |
| SQL 인젝션 / 커맨드 인젝션 / eval·Function 생성자 / 하드코딩된 백엔드 시크릿 | **발견 없음** | 백엔드 38개 파일 전수 확인 — `subprocess`/`os.system`/`eval`/`exec` 사용 0건, 테이블명 조립은 화이트리스트(`assert`)로만 제한, 모든 쿼리 파라미터 바인딩. GAS 시크릿 3종(`GROQ_API_KEY`,`KIWOOM_VM_URL`,`KIWOOM_VM_TOKEN`) 전부 `PropertiesService`에서만 로드 확인 |
| `js/` 25개 전체 | **발견 없음** | `eval`/`new Function` 0건, `postMessage` 사용 0건, localStorage에 저장되는 값은 종목코드/UI상태/시세캐시뿐(토큰·PII 없음) |

전체 원문 근거는 이번 리뷰 세션에서 세 개의 서브 에이전트(백엔드/프론트엔드/GAS)가 각 파일을 Read로 직접 확인해 작성했으며, 파일:줄번호는 위 표에 인용된 그대로 재확인 가능하다.
