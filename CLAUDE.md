# 9Pay 증권

한국 주식시장 데이터 수집·분석·시각화 서비스다.


## 처음 읽는 AI를 위한 단일 인수인계 지도 (2026-10-21 기준)

**새 ChatGPT/Claude/Codex 세션의 시작 명령은 “goodbyestarwars/tistory-ticker의 CLAUDE.md를 읽고 이어받아”면 된다.** `AGENTS.md`는 이 파일로 안내하는 진입점이고, **이 절만 읽어도 서비스·메뉴·데이터·DB·스케줄·자동매매의 전체 지도를 파악**하도록 유지한다. 아래의 기존 필수 규칙도 반드시 따른다.

> **상태 구분:** 이 표는 2026-10-21 `master` 소스 및 10/20~21 작업 기록을 대조한 **구현·예약 구성의 스냅샷**이다. “설정됨/배포 기록 있음”과 “지금 실제 정상 가동 중”은 다르다. VM systemd, 사용자 PC 작업 스케줄러, GAS 편집기, 운영 API의 실시간 상태는 별도 조회·검증해야 한다. 미검증 내용을 정상·수신·주문 성공으로 단정하지 않는다. 모든 시간은 **KST**.

### 0. 30초 요약: 어디에 무엇이 있는가

| 구분 | 실제 소유·역할 | 확인할 원본 |
|---|---|---|
| 운영 사이트 | https://ghlee.tistory.com · 티스토리 스킨이 메뉴/마크업 제공 | `skin.html`, `js/skin-menu.js`, `js/skin-main.js` |
| 정적 프론트/공개 데이터 | GitHub Pages가 `master`의 JS/CSS/정적 데이터를 서빙 | `js/`, `css/`, `data/`, `dcf-data/` |
| 백엔드 API | https://goodbyestar.cloud · GCP e2-micro(메모리 1GB) FastAPI + REST/WS + SQLite/JSON + 배치 | `scripts/cloud-vm/main.py`, `API_REFERENCE.md` |
| 보조 서버 | Google Apps Script(GAS): VM 호출 중계, 공용 캐시, 뉴스/AI 해설, 로그인·개인 기능 일부 | `gas/ticker-proxy.gs` |
| 외부 데이터 | 키움·KIS·네이버·DART·KOFIA·KIND·한국수출입은행·미국 데이터 공급자 등 **기능별 상이** | `docs/ARCHITECTURE_SPEC.md`, 해당 소스별 문서 |
| PC 자동매매 | 사용자 Windows PC의 로컬 봇·실계좌 키움 어댑터·예약 작업. **VM 자체가 주문하지 않음** | `quant-autotrade/local_bot/`, `docs/NINEPAY_LIVE_TRADING.md` |
| 개발·배포 | `master` = 웹/VM/GAS 배포 기준. 별도 연구 작업 브랜치는 운영과 분리 | `ARCHITECTURE.md`, `docs/API_OPERATION_SPEC.md` |

~~~text
이용자 브라우저 (ghlee.tistory.com, Tistory skin.html)
  ├─ 공통 메뉴 / 정적 JS·CSS·data ← GitHub Pages (master)
  ├─ 공개 REST·WebSocket ────────→ goodbyestar.cloud / VM FastAPI
  │                                 ├─ 장중 폴러·후속 스캔·시장/종목 API
  │                                 ├─ VM 로컬 SQLite + JSON 캐시
  │                                 └─ 키움 / KIS / DART / 뉴스 / 공시 / 경제 지표
  └─ GAS 웹앱 ── 캐시·AI 요약·인증 경로 ──→ VM 및 외부 공급자

운영 VM의 9Pay A/B 신호 (주문 기능 없음)
  └─ 인증·시각·누락 검증 → Windows PC 실거래 runner → 키움 계좌
                                └─ 보유/미체결/승인/예산/STOP 재검증
Windows PC 연구 스케줄 → 공개 pattern-scan + 조회용 일봉 → 연구 DB/모의 결과 (주문 금지)
~~~

**절대로 혼동하지 말 것:** ① `skin.html`은 git push만으로 티스토리에 반영되지 않는다. ② `js/css/data`는 Pages, `scripts/cloud-vm`은 VM, `gas/`는 clasp 경로다. ③ VM은 신호를 만들 뿐 실거래 주문은 PC가 수행한다. ④ 사이트에 보이는 값과 저장된 일봉/캐시의 수집·기준 시각을 분리한다.

### 1. 메뉴별로 어떤 정보를 얻는가 (실제 메뉴 정의: js/skin-menu.js)

| 메뉴·직접 주소 | 방문자가 얻는 정보/할 수 있는 일 | 주로 연결되는 소스·데이터 |
|---|---|---|
| **홈** `/` | 오늘의 시장판, KOSPI/KOSDAQ·미국 지수, 투자자 수급, 실시간 종목 랭킹, 패턴, 관심종목, 일정, 공시, 마켓브리핑 | `js/skin-main.js`, `js/home-widgets.js`, VM 시장/랭킹/투자자 API·GAS |
| 시장 > **마켓브리핑** `/category/마켓 브리핑` | 작성된 시황 해석·브리핑/주간 콘텐츠 | 티스토리 글 및 뉴스/시장 참고 데이터 |
| 시장 > **주요 뉴스** `/pages/main-news` | 국내·미국·경제·가상자산 주요 뉴스, 최신 기사 | `js/` 뉴스 모듈, VM 뉴스 캐시·GAS |
| 시장 > **증시온도** `/page/market-temp` | 수급 방향·가격 방향의 심리점수(0~100), 별도 위험도, 상승/하락 폭, 업종 자금 흐름, 단기 이력, 개인용 체크리스트 | `js/market-temp.js` → VM `/market-temp`, KOFIA 위험자료; **신용잔고/예탁금은 종합 방향점수가 아닌 위험 축**. `docs/MARKET_TEMP_METHOD.md` |
| 시장 > **시장지표** `/pages/kospi-futures` | 국내 주요 지수·투자자 수급·**증시자금(고객예탁금, 신용잔고, 대주/담보융자)**·프로그램매매, 글로벌 지표·환율·선물·가상자산·미국 주요 발표 및 차트 | `js/kospi-futures.js`, `js/domestic-market-indicators.js` → VM `/domestic-market-indicators`, `/futures`, `/fx-rates` 등. 신용·예탁금은 `funds` 응답의 날짜/단위를 반드시 함께 확인 |
| 종목 > **국내 주요종목** `/page/market-temp?view=stocks` | 국내 실시간 종목판(거래량·거래대금·회전율·체결강도·상승/하락 등)과 ETF 표시 | 해당 종목판 JS, VM `/market-board` 계열; `docs/DOMESTIC_VOLUME_POWER.md` |
| 종목 > **종목분석** `/page/foreign-flow` | 국내 수급·재무·공시·뉴스·차트/매물대/파동, 미국 주식 실적·내부자 거래·애널리스트 의견 | `js/foreign-flow.js`, 공통 차트 엔진, VM 분석/재무·DART/미국 공급자 |
| 종목 > **검색기** `/page/pattern-scan` | **단타 2(거래량·수급 / 추세돌파), 스윙 2(바닥형성 / 눌림·재돌파), 중장기 1(224일선·구름대+재무)**; 태그/단계/원래 검색기별 이력·성과 | `/pattern-scan`, `pattern_detect.py`, `daily_scan.py`, `docs/SCANNER_FIVE_GROUPS_2026-10-19.md` |
| 종목 > **전략검색** `/page/strategy-search` | ETF·각도·공파산 등 별도 전략 후보 및 결과 | VM 전략·ETF·각도·공파산 스캔/캐시 |
| 상단 전체 검색 → **실시간 시세** `/page/stock-search` | 국내/미국 종목 검색, 호가(매도10·중앙 현재가·매수10), 최근 체결, 차트·보조지표·파동·뉴스. **메뉴에서 숨겨졌지만 주소·링크는 살아 있음** | `js/stock-search.js`, `js/order-book.js`, VM 호가·OHLC·WS |
| 투자도구 > **독립 차트** `/page/stock-search?tool=independent-chart` | 호가/뉴스 없는 큰 차트와 작도 | 공통 차트 엔진 |
| 투자도구 > **물타기 계산기** / **미국주식 환율 계산기** | 여러 번 매수한 평균단가·수수료/환율 기준 매수가능 수량 | 브라우저 계산; 실주문 아님 |
| **캘린더** `/page/stock-calendar` | 실적·경제 발표·시장 이벤트 일정 | `js/stock-calendar.js`, 일정 공급자 |
| **커뮤니티** `/guestbook` | 방명록·커뮤니티 | 티스토리 |
| **MY** `/page/watchlist` | 개인 관심종목·메모·동기화·관심 그룹 | 계정/로그인·GAS/VM 사용자 데이터 및 브라우저 저장 |
| **자동매매** `/page/auto-trader` | 관리자에게만 내비게이션 링크 표시. PC 봇 연결·작업 상태·주문/연구/모의 성과·운영센터 | `js/auto-trader.js`, 로컬 봇 토큰 인증 API. **메뉴 숨김은 인증/보안 경계가 아님** |
| 기타 직접 URL `/page/dcf`, `/page/foreign-flow` 등 | 숨겨진 기업가치(DCF) 및 옛 주소 기능은 별도 지시 없이 삭제 금지 | `dcf-data/`, 기존 UI/라우팅 |

**차트 공통 기능은 한 번만 수정한다:** `js/chart-core.js`·`chart-data.js`·`chart-drawing.js`·`chart-wave-overlay.js`·`chart-sr.js`. 메뉴 링크는 `/page`와 `/pages`가 혼재하므로 임의 통일하지 말고 실제 운영 주소를 확인한다.

### 2. 데이터 출처·폴백(대체 공급처) 운영 지도 — 첫 인수인계 때 반드시 확인

증시온도 표시 갱신(2026-10-23): 장중 표시 화면의 국내지표1분·요약/테마3분·해외5분, 장외5분, 숨김/오프라인 중단·실패 최대10분 지연. 기존 VM 수집 캐시와 `/futures?stored_only=true`의 DB 자료만 읽고 강제 수집/환율 현재가 보강을 요청하지 않는다. 미국장 참고/금리/환율은 한 응답을 공유하고 값의 원래 기준일을 보존한다. 원본 시장요약3분/국내 일봉5분·자금 일별 등 수집 주기는 그대로다. 프론트 표시 갱신을 서버 수집·실시간 틱으로 해석하지 않는다.

**용어:** **1차**=기본 수집처, **폴백**=1차가 실패·미설정·유효값 없음 등 **해당 코드의 조건을 만족할 때만** 쓰는 대체 경로, **캐시 유지**=같은 공급자의 과거 성공값(신규 실시간값 아님), **보강**=다른 필드만 채우는 추가 공급처(폴백과 다름), **없음**=없는 자료를 다른 원천으로 채우지 않음. 아래는 **2026-10-21 `master` 구현 기준**이며, 실제 선택된 공급처·수신시각은 운영 응답 `source/provider`·`updated_at/asOf/date` 및 로그로 확인한다. **빈값·늦은 자료·통신 실패를 정상 실시간/0건으로 바꾸지 않는다.** 같은 공급자도 화면/API마다 우선순위가 다르다.

#### 한국 시장·시세·호가

| 기능/화면·API | 1차 데이터 공급처·경로 | 폴백·미수신 처리(중요) | 실제 소스 |
|---|---|---|---|
| **국내 개별종목 현재가** `/quote/{code}` | **KIS 통합 국내 현재가(UN)** | **키움 REST `ka10001` → 공공데이터포털(data.go.kr) 주식시세/증권상품시세**(양 증권사 모두 실패할 때만). 모두 실패하면 오류, 임의 종가 생성 금지 | `main.py`, `kis_client.py`, `kiwoom_client.py`, `public_data.py` |
| **국내 체결/호가 WebSocket** `/ws/quotes` | **KIS 공용 실시간 허브**(`H0UNCNT0` 체결, `H0UNASP0` 통합호가) | 등록 누락·WS 미수신 종목은 **키움 공용 WS 허브** → 그래도 실시간 등록 불가하면 **KIS REST 통합 현재가**, 반드시 `delayed`/coverage로 지연 표시. REST는 실시간 틱이나 체결 내역을 대신하지 않음 | `realtime_quotes.py`, `kis_ws_hub.py`, `kiwoom_ws_hub.py`, `rest_quote_fallback.py` |
| **호가 10+10 및 최근 체결** `/order-book/{code}` | **KIS REST 호가/체결**(호가·체결 각각 독립 조회) | 해당 항목 실패/운영시간 중 0원·미수신 시 **키움 REST `ka10004`(호가), `ka10003`(체결)**. 체결강도 별도 **키움 `ka10046`**; 유효 호가가 없으면 `available:false`·세션별 `preopen/closed/unavailable`. 10+10 틀은 유지, 없는 가격을 만들지 않음 | `order_book.py`, `js/order-book.js` |
| **홈/종목판 국내·미국 랭킹** `/market-board` | 기본 **KIS 순위 TR**(시장별 거래량·거래대금·상승·하락·회전율·체결강도 등) | KIS 전체 오류는 **키움 순위/기본정보**로 폴백; 미국판은 일부 빈 지표만 키움 순위로 보강. 키움 국내 순위까지 비면 미리 지정한 종목의 키움 개별 현재가를 조회하는 축소 폴백. `MARKET_BOARD_SOURCE=kiwoom`은 운영 선택 스위치(평소 자동 폴백이 아님) | `main.py` `market_board_endpoint`, `market_board.py`, `market_rank.py` |
| **코스피·코스닥 현재지수** `/domestic-market-indicators` | 국내시장지표 숫자 카드 **KIS 업종 현재지수** | 이 카드의 실패는 미수신 처리. 별도의 홈/선물 지수 폴러에서 **네이버 지수 시세**를 모으는 경로와 혼동하지 말 것 | `domestic_market_indicators.py`, `domestic_futures.py` |
| **코스피·코스닥 지수 차트** `/domestic-market-indicators/chart` | **KIS 일봉·주봉·분봉** | **분봉만** KIS 부족/오류 시 **네이버 지수 분봉**으로 폴백. **일봉·주봉은 네이버로 바꾸지 않음**(단일 소스 유지); 결과 `source`와 빈 `rows` 확인 | `domestic_market_indicators.py` `fetch_chart` |
| **국내 종목 일봉/장기 차트** `/ohlc/{code}`, `/flow-chart` | **키움 `ka10081` 수정주가 일봉**, 필요하면 SQLite `chart_daily_prices`·`daily_prices` 기존 캐시 | **API에 따라 다름:** `/ohlc/{code}`는 키움 실패 시 **data.go.kr 주식 일봉**; `/flow-chart` 내부의 일봉 읽기는 **저장된 `daily_prices`(최대 약 260봉)** 보조 경로. `/flow-chart` 장기 이력은 SQLite 우선/키움 부족 구간 온디맨드 수집. 다른 API의 폴백을 그대로 옮겨 적지 말 것 | `main.py` `ohlc`·`_load_flow_chart_daily`, `chart_history.py`, `kiwoom_market.py`, `public_data.py` |
| **종목별 외국인·기관 수급** `/foreign-flow/{code}` 및 일일 스캔 | **KIS 종목별투자자매매동향(UN, 확정 일별)**; 오늘 잠정은 키움 `ka10059`로 별도 보강, 외국인 보유비중은 키움 `ka10008` | KIS 실패/00:00~15:40 제한 시 **최근 성공 KIS SQLite 캐시(20시간 이내) → 키움 `ka10045`**. 키움 확정 폴백은 NXT 미포함으로 거래량/수급 차이 가능. 오늘 잠정치를 확정 과거와 혼동 금지 | `kiwoom_market.py` `fetch_foreign_inst_daily`, `db_schema.py` `kis_flow_cache`, `daily_scan.py` |
| **시장별 투자자 순매수 추이** `/investor-trend` | **KIS `FHPTJ04040000`**(KOSPI·KOSDAQ 일별 순매수, 장중 갱신) | **현재 활성 경로는 다른 공급자 폴백 없음.** 실패 시 직전 KIS SQLite 행 보존. 소스 안의 오래된 네이버/키움 함수는 실행 중인 대체 우선순위로 간주하지 말 것 | `investor_trend.py`, `db_schema.py` |
| **증시온도** `/market-temp` | 가격·섹터 거래대금은 **네이버 국내 종목 polling**+정적 섹터 풀; KODEX200 외국인·기관 수급은 **네이버**, 위험축의 VIX·선물·환율은 VM 기존 저장 관측값; 신용융자·예탁금 위험은 **data.go.kr KOFIA** | 네이버 실패 배치는 누락/미확인, 전체 등락종목 수 **KIS 업종지수** 실패 시 별도 자료로 전시장 수치를 꾸미지 않음. KOFIA 날짜/단위 불일치 시 신용위험은 **미검증·점수에서 제외**, 지난 `market_temp_cache.json`을 보일 땐 마지막 계산 시각 표시. **위험축은 종합 방향점수에 포함되지 않음** | `market_temp.py`, `market_temp_data.py`, `market_temp_score.py`, `public_data.py`, `docs/MARKET_TEMP_METHOD.md` |
| **국내시장지표의 신용잔고·고객예탁금** `/domestic-market-indicators` `funds` | **KIS `FHKST649100C0`** 시장자금: 신용융자잔고·투자자예탁금, **억원 단위**, 날짜 포함 | **KOFIA 자동 폴백 없음(2026-08-12에 제거).** KIS 실패 시 `available:false`, 오래된 KOFIA 값으로 끼워 넣지 않음. 단, **신용대주잔고·예탁증권담보융자**는 KIS가 제공하지 않아 **KOFIA 독립 보강 카드**(`fetch_leverage_detail`), 해당 카드만 비울 수 있음 | `domestic_market_indicators.py` `fetch_funds`·`fetch_leverage_detail`, `public_data.py`, `js/domestic-market-indicators.js` |
| **코스피 프로그램매매(차익·비차익)** 동일 API `programTrading` | **KIS 일별 프로그램매매 약 1년 이력** | **현재 활성 `fetch_program_trading`에는 키움 자동 폴백 없음**. 소스의 `_fetch_kiwoom_program_trading_with_history`는 과거/비활성 보조 코드일 뿐 현재 호출 경로에 연결되지 않음. 실패 시 `available:false` | `domestic_market_indicators.py` |
| **주식 52주 최고/최저** 종목판 | **KIS 국내 시세 `w52_hgpr/w52_lwpr` 등** | 결측은 **자체 `daily_prices` 최근 250거래일 최고/최저**로 계산하여 보강. DB가 부족하면 빈값; 과거 52주를 임의 생성하지 않음 | `market_board.py`, `db_schema.py` |
| **일일 검색/전략 스캔** `/pattern-scan` | **키움 `ka10081` 일봉 + KIS/키움 수급 + DART 재무 캐시**를 VM SQLite/JSON에 정규 저장 | 종목 목록은 GitHub 정적 목록 실패 시 **KRX 공공데이터** 제한적 폴백. 개별 종목 시세/필터 오류는 누락·부분 실패를 기록, **과거 스캔 결과를 오늘 신규 신호로 간주하지 않음**. 재무·DART 실패는 검증을 통과로 뒤집지 않음 | `daily_scan.py`, `pattern_detect.py`, `batch_scan.py`, `scan_prereq.py` |
| **시장조치/사이드카/VI** `/api/circuit-breaker` | 시장 전체 조치는 **KIS 장운영정보 WS `H0STMKO0`** 및 **KRX KIND 공시**(허용된 공시 경로); 개별 VI는 KIS 계열 이벤트 | KIND는 VM 접속이 403으로 막힌 사례가 있어 **KIS 경로가 독립 검증/보완**. 두 경로 모두 미수신이면 `available`/마지막 수신시각을 그대로 노출, 사이드카를 추정 발동시키지 않음. VI를 KIND에서 만들어내지 않음 | `market_halt_kis.py`, `market_halt_kind.py`, `circuit_breaker.py`, `vi_kis.py` |

#### 미국·글로벌·경제·기타

| 기능/화면·API | 1차 데이터 공급처 | 폴백·제한·참조 소스 |
|---|---|---|
| **미국 개별주식 현재가** `/us-quote` 등 | **KIS 해외주식 현재가 → 키움 미국 REST → Yahoo Finance 차트 메타** | 최종 Yahoo는 **지연 보조값**(장전/장후/정규장 구분·시각 검증). `us_stocks.py` 상단에 남은 과거 “키움 우선” 주석보다 **실제 `quote()` 호출 순서**를 기준으로 판단 |
| **미국주식 차트** | **일봉(약 2년) Yahoo Finance** 직접; 분봉은 **키움 미국 차트** | 분봉 키움 실패 시 Yahoo Finance 차트(해당 기간만). 주봉/월봉 UI는 확보된 일봉 재가공 여부 확인. 없는 3/5년 데이터를 만들지 않음. `us_stocks.py` `chart` |
| **미국 실시간 호가·체결** | KIS 공용 해외주식 WS 및 `finnhub_realtime.py` 별도 공유 Finnhub 스트림 등 **기능/화면별** | WS 미수신 시 화면마다 REST 시세와 last-known/지연 표기를 구분. 미국 10호가 보유를 가정하지 않음. `realtime_quotes.py`, `finnhub_realtime.py`, `us_stocks.py` |
| **미국 재무·실적·기관 의견·내부자 거래** `/us-analysis` | **Finnhub**(metric, reported-financials, earnings, recommendations, insider, profile) | `us_analysis_cache.db` 정상 6시간·일부 미확보 5분. **기관별 upgrade/downgrade 403 접근 제한**은 `access_denied`/미제공이지 다른 기관 추정 폴백 아님. SEC 원문 링크는 출처 연결이며 실시간 데이터 대체 아님. **미국 ETF 실보유명세는 별도 라이선스 미연결로 미제공**. `us_analysis.py`, `us_etf_holdings.py`, `docs/US_ETF_DATA.md` |
| **미국/글로벌 뉴스** | 국내·미국 종목 기본 **NAVER API HUB**(`naver_news.py`, VM IP 허용) + 뉴스 통합기: Google News RSS, **선택형 Alpha Vantage·Finnhub**, CNBC/Bloomberg RSS 및 SEC 공시 피드(용도별) | 한 소스 실패 시 **다른 실제 공급자의 기사만** 병합, 본문/기사·출처 창작 금지. `us_news_cache.db` 마지막 정상 캐시/TTL, 없으면 빈 목록·사유. `news_aggregator.py`, `naver_news.py`, `domestic_news.py` |
| **국내 공시·재무·일정** | **DART OpenAPI** 재무제표·정정/신규 보고서, **KRX/KIND 공개 공시·RSS**, **Google Calendar** 이벤트 | 재무는 **연결(CFS) → 별도(OFS)** 같은 DART 내부 폴백; 새 공시 확인 불가·자료 오래됨은 미확인/후보 제외. GAS/VM 기존 캐시가 남아도 최신 공식값으로 속이지 않음. `dart_client.py`, `fundamentals.py`, `earnings_calendar.py`, `js/stock-calendar.js` |
| **KOSPI200 주간·야간 선물/옵션** | **KIS 선물 WS**(설정 시), KIS 옵션 전광판·옵션 호가/WS | 주간 선물은 KIS WS 시작 불가 시 **네이버 선물 polling** 경로 존재. **야간선물 분봉은 `night_futures_ws.py` KIS 단일 수집 원칙**, 없는 분봉을 다른 날짜·현물로 채우지 않음. 단 홈 야간선물 30분 차트만은 분봉이 없는 구간을 **같은 KIS 실시간 틱의 30분 관측값**(`home_session_prices`, `record_night_tick`, 2026-10-22)으로 채운다(분봉 우선, 틈 유지). 옵션 ATM 창 부족 시 **동일 KIS 옵션 전광판 상위 100행**으로 범위 축소(다른 공급자 아님). `domestic_futures.py`, `night_futures_ws.py`, `option_flow.py` |
| **해외 지수·VIX·원/달러 장중** | **네이버 `polling.finance.naver.com` / `api.stock.naver.com`** 수집(글로벌 지수/선물·환율 등 종목별 소스 차이) | 저장된 마지막 정상값·수신시각/휴장 여부 표시. VIX는 증시온도에서 기존 VM 폴러값을 재사용하며 GAS 옛 Yahoo 직접조회와 구분. `foreign_futures.py`, `domestic_futures.py`, `market_temp_data.py` |
| **한국 국고채·미국채·미국 주요 경제발표** | 국고3년 **네이버 `KFIA103000` JSON**; 미국채 2/10/30년·CPI/PPI/고용 등은 **FRED 공식 CSV** | 실패하면 이전 확정일/자료없음 처리; 다른 나라 금리나 발표값으로 대체 금지. FRED 데이터는 실제 관측일·단위와 발표일을 분리. `bond_yield.py` |
| **한국수출입은행 공식 고시환율 탭** `/fx-rates` | **한국수출입은행 OpenAPI**(영업일 고시 환율) → `fx_koreaexim.db` | 주말/휴일/미고시일에는 **직전 실제 고시일값 + `baseDate/pendingToday`**. 네이버의 장중 USDKRW 시장환율과 서로 대체하지 않음(서로 다른 정의). `fx_koreaexim.py`, `docs/FX_KOREAEXIM.md` |
| **원자재 선물** | **브렌트유(ICE)는 권한 확인된 KIS**, **WTI·금은 네이버 비공식 선물 시세** | 브렌트 KIS 실패·20분 이상 오래됨: **다른 원유/현물로 폴백 없음**, `stale`·미수신. WTI·금에 미권한 KIS 상품을 시험 삼아 붙이지 않음. `foreign_futures.py`, `commodity_kis.py`, `docs/COMMODITY_SOURCES.md` |
| **비트코인/이더리움·주식토큰 참고시세** | BTC/ETH **업비트 공개시세**; 별도 주식토큰은 **Binance 관련 수집 경로** | Binance 지역 제한·공급 실패 시 새 값 날조 금지, 재시도 시간/제한·저장된 실제 시각 명시. 주식토큰은 실제 한국 주식 체결/수급과 다름. `btc_futures.py`, `binance_flow.py`, `binance_client.py` |
| **AI 참고의견/번역** | **Groq API**(GAS 프록시, 시황·종목/뉴스 해설); 뉴스 제목 번역은 별도 번역캐시·보조 API | **AI는 시세·재무의 데이터 공급처/폴백이 아님**. 생성 오류 시 참고의견만 빠지고 원본 수치·기사 유지. 캐시 생성시각/TTL·출처 표기. `gas/ticker-proxy.gs`, `news_aggregator.py` |
| **5년 차트/DCF 정적 원본** | GitHub Actions가 **공개 시장 데이터·DART 공시**를 가져와 `data/chart-history/*.js`, `dcf-data/` 갱신 | 서버 실시간 값으로 과거 미수집 구간을 임의 복원하지 않음. 마지막 성공한 정적 자료/기간 표시. 공급자·커서·갱신주기는 `scripts/build_market_history.py`, `scripts/build_dcf_data.py`, `.github/workflows/*` 확인 |

**대표 원천 URL·API 찾는 법:** 네이버 시세 `polling.finance.naver.com`/`api.stock.naver.com`; KIS/키움은 `kis_client.py`/`kiwoom_client.py`에 인증된 REST/WS TR 정의; 공공데이터포털 `public_data.py`; DART `dart_client.py`; Finnhub `us_analysis.py`; FRED `bond_yield.py`; 업비트 `btc_futures.py`; 한국수출입은행 `fx_koreaexim.py`. **도메인/호출 허가만으로 수집·재게시 라이선스가 확보된 것은 아니다.**

**데이터·폴백 수정 전 확인 순서:** ① 메뉴 → 브라우저 JS URL → FastAPI `main.py` 라우트 → 해당 실제 함수(독스트링보다 호출 코드 우선), ② 성공 판정(0원/빈배열/오래된 값·기준시각·단위), ③ 폴백 발동 조건·동일 종목/시장·유통시장 KRX/NXT/통합 구분, ④ 원본 `source/provider/status/asOf/checkedAt`를 실제 응답으로 검증, ⑤ 새 API 호출·비용·시세 계약·레이트리밋·VM 1GB 부하, ⑥ 사용자 요청 없이 임의 공급자 교체/폴백 추가/스케줄 변경하지 않기. 새 기능을 개발할 때는 이 표와 `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md`, 관련 공급자·실측 문서를 같이 업데이트한다.

### 3. DB·캐시에 어떤 정보가 있는가 (VM 파일과 공개 정적 자료를 구분)

| 저장소/실행 위치 | 대표 테이블·내용 | 읽기/쓰기 주체·주의 |
|---|---|---|
| VM **ohlc_snapshot.db** (핵심 SQLite, WAL) | `daily_prices`(종목 일봉), `chart_daily_prices`(긴 차트 일봉), `fundamentals`(DART 연·분기), `investor_flow_daily`(외국인·기관 일별), `investor_summary`(공매도·대차·연기금), `kis_flow_cache` | `db_schema.py`, `daily_scan.py`, `batch_scan.py`, 온디맨드 조회. 일봉·재무/수급 캐시를 혼동하지 말 것 |
| 같은 SQLite: 시장·선물·옵션 | `future_prices`, `future_chart`, `future_chart_minute`, `option_flow`, `investor_trend_daily`, `investor_trend_intraday`, `home_session_prices` | 선물·옵션 최신/차트, 투자자 일별/장중 관측, 홈 30분 구간. 기록 전 구간을 보간하지 않음 |
| 같은 SQLite: 신호·시장·사용자 | `volume_profile_daily`, `scan_hits`, `swing_recommendation_snapshots`, `market_temp_daily`·`market_temp_snapshot`·`market_temp_intraday`·`market_temp_industry_rank`, `sector_rotation_daily`, `money_sector_picks`, `night_futures_close`, `app_users`·`watchlist_configs`·`user_memos`·`user_sector_cards_config`·`user_top_picks` | 매물대·검색 포착/성과·스윙·증시온도·관심종목/메모. 사용자 데이터와 공개 캐시 경계 확인 |
| VM **news_momentum.db** | `news_topics`, `news_topic_daily`, `datalab_trends`, `news_stock_coverage` | 뉴스 이슈·일별 빈도·검색 관심도·백필 진행. 뉴스 원문/HTML 저장 아님 |
| VM 뉴스·미국 캐시 DB | `domestic_news.db`(국내 뉴스·공시), `us_news_cache.db`(미국 뉴스 메타), `us_analysis_cache.db`(미국 프로필/분석) | 공급자별 분리된 SQLite 캐시 |
| VM 기타 별도 SQLite | `fx_koreaexim.db`(일별 고시환율), `hour_validation.db`(1시간 방향 전진 검증·불변), `gap_shadow.db`(장중 첫 갭상승 후보), `volume_surge_history.db`(장중 거래량 최초 신호 이력) | 일부 DB는 후속 기능에서 추가되어 `DB_SPEC.md` 서두의 “총 5개” 설명보다 종류가 많음. 각 모듈 스키마 확인 |
| VM JSON/JSONL | `daily_scan_cache.json`, `fundamentals_cache.json`, `investor_flow_cache.json`, `week52_cache.json`, `strategy_scan_cache.json`, `weekly_report_cache.json`, 실시간 관측/상태 파일 | REST 응답·배치 결과 일부는 **SQLite가 아닌 파일 캐시가 원본**. 생성 시각, TTL, 원자적 교체·잠금 확인 |
| GitHub Pages 정적 자료 | `data/*.js`(`window.XXX` 형식), `data/chart-history/`(5년 시장 이력), `dcf-data/`(DART 연간/DCF 원본), 기타 고정 섹터·종목 매핑 | 버전/갱신 주기 상이. VM DB가 아님 |
| GAS | Script Properties(비밀키) + `CacheService`(시황·해설·뉴스 공용 TTL) | DB가 아님. 방문자별이 아니라 공용 캐시인 항목 존재 |
| 사용자 PC | `research.db`, `status.json`, 실거래 장부·로컬 상태/로그 | **VM DB와 별개**, Git 커밋 금지, PC에서 실행·인증 확인. 연구/실거래 데이터 교차 사용 금지 |

**DB 작업 시:** `docs/DB_SPEC.md` + `scripts/cloud-vm/db_schema.py` 및 관련 모듈이 원본이다. `*.db`, `.env`, 토큰·계좌·체결 원본·로그는 Git에 올리지 않는다. 백업은 장외 유지보수와 무결성 검사를 확인하고 임의 삭제/초기화하지 않는다. **신용잔고·예탁금**은 `/domestic-market-indicators`의 `funds.credit`/`funds.market_funds`와 날짜·단위를 대조한다. `/market-temp`의 `creditRisk`는 별도 위험축이며 방향 점수에 넣지 않는다.

### 4. 예약 작업 총지도 (일/주/월 + 상시)

아래는 **예약 설정/문서상 주기**이지 10/21 현재 성공 보장이 아니다. 후속 스캔은 `.scan_serial.lock`으로 **직렬**이며 설정 시간과 실제 계산 시작/종료가 다를 수 있다. 거래일/휴장 처리도 각 스크립트에서 확인해야 한다.

| 실행 위치 | 등록/예약 시각(KST) | 내용 → 데이터·결과 |
|---|---|---|
| **VM systemd** `kiwoom-deploy.timer` | **5분마다**, 평일 08:00~20:00 백엔드 재시작/배포 보류 정책 | master 변경 점검·배포·health. 장중 실시간 피드 단절 보호(`deploy_check.sh`) |
| **VM 일별** `kiwoom-dailyscan` | **20:10** | 전종목 키움 일봉/수급 → `ohlc_snapshot.db` + `daily_scan_cache.json` |
| **VM 일별** `kiwoom-etfstrategyscan` | **20:30** | 공통 일봉 → ETF 독립 전략 판정/캐시 |
| **VM 일별** `kiwoom-anglemomentumscan` | **20:35** | 공통 일봉 → 각도 모멘텀 후보/캐시 |
| **VM 일별** `kiwoom-gongpasanscan` | **20:40** | 공통 일봉 → 공파산 후보/캐시 |
| **VM 일별** `kiwoom-week52` | **20:50** | 공통 일봉 → 52주 후보/캐시 |
| **VM 일별** `kiwoom-batch` | **21:00** | DART 재무·KIS/키움 수급 등 → `fundamentals_cache.json`·`investor_flow_cache.json`, 관련 SQLite |
| **VM 월요일마다** `kiwoom-strategyscan` | **월 21:10** (*요일 월요일*) | 공통 일봉 → **비ETF 주간 전략** 후보/캐시. “월 21:10”을 매월 21일로 읽지 말 것 |
| **VM 장중** `kiwoom-volumebreakout` | **거래일 09:05** | 시초 거래량 돌파 후보 |
| **VM 일별** `kiwoom-scanreaper` | **07:30** | 전일 야간 스캔 마감·잠금/잔여 정리. 무한 대기 금지 |
| **VM 일별** `kiwoom-swingmonitor` | **07:45** | 스윙 후보 D+5/D+10 성과 후속 |
| **VM 장외 유지보수** (배포 점검 경유) | **03:00~05:00 시작**, 잠금 대기 가능 | SQLite 검증·백업, 로그·뉴스 보존 정리. **10/20 문서상 완료 마커는 9/27로 지연** → 최신 성공 재확인 필수 |
| **VM/FastAPI 경량 폴러** | 기능별 장중 수초~분/장외 느린 주기 | WS, 호가, 랭킹, 뉴스, 환율 등. 별도 systemd 타이머가 아니라 `market_clock.py`/모듈 내부 주기 |
| **Windows PC** `AutotraderLiveTrading` | **거래일 08:55 예약** | PC 기존 실거래 runner + 9Pay 장중 A/B 피드, 보유·미체결·예산 검사 → 승인된 계좌만 주문 가능 |
| **Windows PC** `AutotraderBot` | **5분 간격 감시** | 로컬 봇 실행/관제·토큰 인증 운영센터 API |
| **Windows PC** `AutotraderResearch` | **평일 20:15**, 시작 후 **10분 간격** 스캔 완료 감시(~다음 08:15), 로그인 후 1회 | `/pattern-scan` 확정 → 후보 생성 1회·읽기 전용 일봉·연구 모의평가 → PC `research.db`·`status.json` |
| **Windows PC** `AutotraderCandidates` / `AutotraderLivePaper` | **비활성화**(2026-10-20 현장 확인) | 중복 후보 작업·별도 실모의 예약 실행 금지. 연구 기능 자체는 `AutotraderResearch`에 통합 |
| **GitHub Actions** `dcf-data.yml` | **매시 :17·:47(UTC cron)** = 한국시각에도 매시 :17·:47 | DART 연간 공시/DCF 정적 파일 생성. **30일 경과 데이터 갱신**은 자료 유효기간 정책이며 “매월 1회” 작업이 아님 |
| **GitHub Actions** `market-chart-history.yml` | **매주 토요일 09:15** | 5년 시장지표 정적 차트 이력 갱신 |
| **GitHub Actions** `deploy-gas.yml` | `master`의 `gas/` 변경 시, 또는 수동 | clasp push/deploy. 고정 매일/매월 일정 아님 |
| **GitHub Actions** `api-probe.yml`, `page-speed.yml` | **수동 실행 전용** | 운영 API 실측/성능 검증 |
| **GAS** | 호출 시 캐시·설치형 트리거 가능 | 공용 프록시/AI 요약. **일별 증시온도 설치형 트리거는 편집기에서 등록·최근 성공 확인 필요** |
| **매월 고정 예약** | **별도 확인된 월간 정기 작업 없음** | 30일 DCF 재검증, 90일 데이터 보존은 *정책/기간*이지 월 1회 스케줄이 아님. 새 월간 일정을 지어내지 말 것 |

**스케줄 최신 상태는** VM 공개 `GET /health/schedules`(systemd·다음 시각·최근 결과), `/health/load`, 로컬 봇 인증 `GET /api/schedules`, GitHub Actions 실제 실행 기록, GAS 편집기 트리거에서 확인. Windows 작업 등록 상태/지연·마지막 성공은 Git만으로 확인 불가. `docs/SCHEDULER_CONSOLIDATION_2026-10-20.md`의 10/20 실측과 `quant-autotrade/docs/SCHEDULER.md`를 먼저 대조한다.

### 5. 자동매매 — 운영 실계좌와 연구용을 반드시 나눠서 이해

| 분류 | 마지막 문서화된 구현/현황 (상태 기준일 표시) | 제한·실행 경계 |
|---|---|---|
| **PC 실계좌 기존 엔진 + 9Pay A/B** | **10/19 사용자 승인으로 `NINEPAY_LIVE_TRADING` 활성화 기록.** PC 예약 작업 08:55 유지. **10/20 21:42 피드 경량화·배포 보호 보정본 PC 설치 기록**, 실주문 수동 실행 없음. **10/21 현재 실행/주문/체결 성공은 이 문서만으로 검증 불가** | 주문은 VM이 아닌 PC. 기존 엔진의 **총 예산 100만원·종목당 30만원·현금 10만원 유보**, 공유 보유/미체결 차감. 10/19 이후 **최대 3종목 제한 해제**(잔여 자금 제약은 유지) |
| **신규 진입 9Pay 신호** | VM A OR B 연구 관찰 → PC 수신. 장초반 **09:00~09:29:59 최초 70% 관측**, 신호 10초 이내·순위 120초 이내·데이터 완전·큐 누락 없음 등 다중 검증 | 실패/장외/누락/오래된 신호는 **신규 매수 금지**. 피드 불완전 시 기존 신규 매수도 보류, 기존 보유 청산 점검 우선 |
| **청산(실거래)** | 일반 손절 매입가 대비 **-3% 연속 2회**, 급락 **-5% 즉시**, 최고가 **+3% 달성 후 고점 대비 -2.5% 하락 연속 2회** | 주문 응답 불명확하면 맹목적 재시도 금지. 기존 장부·계좌 승인·STOP·미체결 필수 확인 |
| **상시 상품 제외** | 인버스·레버리지, CD금리/KOFR·SOFR/MMF/머니마켓/단기채·파킹 등 현금성·금리형 신규 주문 제외. **일반 ETF 전체 제외 아님** | 재부팅·다음 거래일·재설치·롤백에도 유지. VM 후보와 PC 주문 직전 양쪽 검사 |
| **PC 연구 후보/백테스트/모의** | `quant-autotrade/` 별도 연구 트랙. `AutotraderResearch`가 후보·3종 청산 모의결과를 기록. 10/20 중복 예약 작업 비활성화. 이전 인수인계에는 미배포 UI/별도 브랜치 내용도 있음 | **연구 결과를 실거래 매수 승인으로 해석 금지**. 연구 DB·모의 주문과 실계좌 기록/스위치 분리 |
| **운영센터/텔레그램** | 관리자 메뉴 `/page/auto-trader`, PC 로컬 봇 `/api/schedules`·`/api/research`·상태 API, 텔레그램 읽기/알림 | 운영센터는 상태 표시; 브라우저의 관리자 메뉴 노출 여부는 권한 검증이 아님. 계좌·원시 로그·토큰 공개 금지 |

**안전 원칙:** 실계좌 관련 코드는 **문서/테스트만 바꾼 것과 PC 운영 파일 설치를 구분**한다. 사용자의 **구체적인 실계좌 주문·활성화·정책 변경 승인 없이** 실행·재시작·매수/매도·스위치 변경 금지. 장중(특히 평일 08~20시) VM 백엔드 재시작은 피드 단절 위험. 절대 피드 큐 누락값을 임의 초기화해서 매수 재개하지 않는다. 최신 규칙: `docs/NINEPAY_LIVE_TRADING.md`, `docs/NINEPAY_FEED_INCIDENT_2026-10-20.md`, `quant-autotrade/docs/LIVE_EXIT_RULES_2026-10-16.md`.

### 6. 작업 시작·완료 체크리스트 (ChatGPT/Claude 공통)

1. **읽기 순서:** 지금 이 `CLAUDE.md` → `docs/README.md` 문서 지도 → `docs/WORK_HISTORY.md` **맨 위 필요한 일부만** → 최신 `docs/HANDOFF_*.md` 1개(현재 저장소 최신 파일명이 반드시 최신 *작업*이라는 뜻은 아님) → 해당 작업의 원본 SPEC/API/소스. 처음부터 전체 이력/과거 인수인계 통독 금지.
2. **수정 위치 찾기:** 위 메뉴 표로 해당 JS·API·DB 소유 경계를 찾는다. 프론트만 고쳐야 할지 GAS/VM/skin 마크업도 필요한지 먼저 판단. 소스/문서가 충돌하면 실제 코드/운영 수신 실측을 우선한다.
3. **실시간 팩트 확인:** 운영 수치·상태·스케줄·PC 설치·실계좌 거래 결과를 **문서 날짜만으로 현재 정상이라고 주장하지 않는다**. 접근 불가 시 미확인이라고 명시한다. API 인증 필요하면 승인된 테스트/읽기 경로만 사용한다.
4. **변경 원칙:** 기존 기능/계약·PC 주문·DB/캐시·비용·보안 경계 보존. 요청 범위 외 리팩터링·실시간 필드/단위 추정·무검증 API 경로 추가 금지. PC/모바일·결측·장외·재연결·배포 후 상태 확인.
5. **종료/인수인계 갱신:** 중요 변경이면 `docs/WORK_HISTORY.md` 상단에 날짜·목적·변경·검증·배포만 기록. **메뉴/구성도/DB/예약 작업/자동매매의 실질 구조가 바뀌면 이 단일 지도를 함께 갱신**한다. 과거 기록 삭제 금지. 최종 응답은 수정 파일·테스트·배포/수동 스킨 반영·미검증 사항을 구분한다.


## 핵심 구조

- 프론트엔드: Tistory 스킨 + GitHub Pages 정적 자산
- 백엔드: Google Apps Script + GCP VM FastAPI
- 운영 API: `https://goodbyestar.cloud`
- 운영 사이트: `https://ghlee.tistory.com`
- 기본·배포 브랜치: `master`
- VM은 e2-micro(메모리 1GB)다. 새 수집은 별도 프로세스·타이머 대신 FastAPI 안의 가벼운 스레드로, 국내 장이 닫힌 시간엔 느린 주기로 둔다(`market_clock.py`). 예: 바이낸스 국내주식 토큰 참고 시세 `binance_flow.py`(2026-09-15)
- 메인 VI·사이드카 배지 API는 `GET /api/circuit-breaker`(서버 1곳 20초 폴링 캐시). 스키마 `sidecar{available,active,market,triggered_at,note}`·`vi_active_count`·`vi_list[{code,name,status,triggered_at,released_at}]`. 사이드카는 검증된 증권사 필드가 없어 `available=false`로 두고 배지를 숨긴다(2026-09-15)

- 차트검색(`js/stock-search.js`)·종목분석(`js/foreign-flow.js`) 차트의 공통 기능은 `js/chart-core.js`·`chart-data.js`·`chart-drawing.js`·`chart-wave-overlay.js`·`chart-sr.js` 한 곳에만 있다. 차트 기능을 고칠 때 두 화면에 같은 코드를 따로 쓰지 않는다(`docs/UI_GUIDE.md` '차트 공통 엔진').

## 필수 규칙

- 기존 기능을 임의로 삭제하지 않는다.
- 사용자 상시 제외 지시: 9Pay 실시간 단타 후보·신규주문에서는 인버스·레버리지 및 CD금리·KOFR/SOFR·머니마켓·단기채 등 현금성/금리형 상품을 계속 제외한다. 일반 ETF 전체 제외가 아니다. 다음 거래일·재시작·설치/업데이트에도 유지하고, 사용자의 명시적 해제 지시 없이 완화하지 않는다(`docs/NINEPAY_LIVE_TRADING.md`).
- 요청 범위를 벗어난 리팩터링을 하지 않는다.
- 수정 전 관련 파일, 호출 관계, 배포 경로를 확인한다.
- API 키, 토큰, 계정정보를 코드·문서·로그에 기록하지 않는다.
- PC 화면을 우선하되 모바일 반응형을 유지한다.
- 상승은 빨강, 하락은 파랑 의미색을 유지한다.
- 데이터 파일은 `window.XXX = {...}` 형태의 `.js`를 사용한다.
- KRX 내부 크롤링 경로를 새로 추가하지 않는다. 단 2026-10-15 사용자 승인으로 **한국거래소 KIND 시장조치 공시(사이드카·서킷브레이커) 수신만** 예외다(`docs/MARKET_HALT_KIND.md`).
- 미검증 API 필드나 단위를 확정값처럼 쓰지 않는다.
- 완료 후 변경 파일, 검증 결과, 수동 배포 여부를 요약한다.
- 중요한 기능·구조·API·배포 변경은 별도 요청이 없어도 `docs/WORK_HISTORY.md`에 기록한다.
- 사소한 문구·스타일 조정은 작업이력에 남기지 않고 Git 커밋으로만 관리한다.
- 작업이력은 날짜, 목적, 주요 변경, 검증·배포 결과만 간결하게 기록한다.
- 커밋·push 전에 이번 작업이 중요 변경에 해당하면 `docs/WORK_HISTORY.md` 반영 여부를 반드시 확인한다.
- 작업이력 변경은 관련 코드 변경과 동일한 커밋 또는 push 범위에 포함한다.

## 작업별 문서 참조 규칙

작업 시작 전에 아래 표에서 해당하는 항목의 문서를 **모두 참조**한다. 한 문서만 읽고
구조·API·DB·배포를 판단하지 않는다. 작업 범위가 여러 항목에 걸치면 해당 행을 합쳐서
읽는다.

| 작업 항목 | 반드시 참조할 문서 | 확인할 내용 |
|---|---|---|
| 모든 작업의 진입 | `docs/README.md`, `CLAUDE.md` | 문서 지도·공통 규칙·현재 작업 범위 |
| 시스템 구조·호출 흐름 | `ARCHITECTURE.md`, `docs/ARCHITECTURE_SPEC.md` | Tistory·GitHub Pages·GAS·VM 역할, 호출 경계, WebSocket, 캐시 |
| REST·WebSocket API | `API_REFERENCE.md`, `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md` | 라우트·필드·인증·CORS·TTL·장애 대응·운영 점검 |
| DB·캐시·데이터 보존 | `docs/DB_SPEC.md`, `docs/ARCHITECTURE_SPEC.md`, `scripts/cloud-vm/db_schema.py`, 관련 캐시 모듈 | SQLite 스키마, JSON 캐시, 온디맨드/배치, 보존·백업 |
| 백엔드 소스 수정 | `docs/SOURCE_CODE_SPEC.md`, `API_REFERENCE.md`, `docs/DB_SPEC.md` | 파일 역할, 함수 연결, 응답·저장 구조 |
| UI·반응형 수정 | `docs/UI_GUIDE.md`, `ARCHITECTURE.md`, 관련 `js/`·`css/` 파일 | Tistory/GitHub Pages 경로, 디자인·모바일·캐시 버전 |
| Tistory 스킨 수정 | `ARCHITECTURE.md`, `docs/ARCHITECTURE_SPEC.md`, `docs/SKIN_HTML_PENDING.md`, `skin.html` | 자동 배포 여부, 관리자 수동 반영 필요성, 이미 밀려 있는 항목 |
| GAS 수정 | `ARCHITECTURE.md`, `docs/API_OPERATION_SPEC.md`, `docs/GAS_AUTO_DEPLOY.md`, `gas/ticker-proxy.gs` | Script Properties, VM 인증, Actions/clasp 배포 |
| VM 배포·장애 점검 | `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md`, `docs/DB_SPEC.md`, `scripts/cloud-vm/deploy_check.sh` | health, 로그, DB 유지보수, 자동 배포·롤백 |
| 작업 이력·인수인계 | `docs/WORK_HISTORY.md`, **가장 최근** `docs/HANDOFF_*.md` 1개 | 최근 변경, 검증 결과, 남은 수동 반영·주의사항 |
| 인증·외부 데이터 설정 | 해당 `docs/*_SETUP.md`, `docs/API_OPERATION_SPEC.md`, `docs/ARCHITECTURE_SPEC.md` | 키 저장 위치, 공급자 폴백, 운영 도메인 제한 |

최신 작업을 이어받을 때는 `docs/HANDOFF_*.md`를 먼저 확인하되, 그것을 현재 코드의
유일한 근거로 사용하지 않는다. 실제 구현·운영 상태는 위 표의 원본 문서와 소스를
대조한다.

문서 전체 목록과 목적은 `docs/README.md`를 기준으로 한다. 중요 변경은
`docs/WORK_HISTORY.md`에도 기록한다.

## 문서 읽기 비용 규칙

문서가 늘어나는 것 자체는 비용이 아니다(자동으로 읽히는 건 `CLAUDE.md`와 memory뿐이다).
비용은 **한 파일을 통째로 읽을 때** 생긴다. 2026-09-17 기준 작업이력이 736KB까지 자라
한 번 통독하면 약 20만 토큰을 썼다.

- `docs/WORK_HISTORY.md`는 **통독하지 않는다.** 기본은 위에서부터 필요한 만큼(예: `head -80`),
  특정 사건을 찾을 때는 `grep`으로 해당 항목만 본다. 최신순 정렬이라 위쪽이 최근이다.
- 지난 기록은 `docs/history/`에 있다. **`grep`으로만** 본다. 통독 대상이 아니다.
- 작업이력 항목이 50건을 넘으면 오래된 쪽을 `docs/history/WORK_HISTORY_<시작일>_<종료일>.md`로
  옮긴다. 내용은 지우지 않고 그대로 옮긴다.
- 인수인계서는 **가장 최근 1개만** 읽는다. 과거본은 필요할 때만 `grep`으로 본다.
- 스펙 문서(`docs/*_SPEC.md`, `API_REFERENCE.md`)도 관련 구간만 읽는다.

## 자동매매 프로젝트(quant-autotrade)

- 위치: `quant-autotrade/` (로컬 봇·연구 후보 생성기·백테스트·UI 시안·문서). 작업 브랜치 `feature/quant-autotrade-2`.
- `master` 병합·운영 배포·실계좌 주문은 사용자 별도 승인 전까지 하지 않는다. 키·토큰·계좌·IP·`.env`·DB·로그는 올리지 않는다.
- 현황·남은 일: `quant-autotrade/docs/HANDOFF_2026-10-11.md`, 설계·결과: `quant-autotrade/docs/PLAN_2026-10-11.md`, 스케줄러: `quant-autotrade/docs/SCHEDULER.md`.
- 텔레그램 관제(알림·읽기 전용 명령, `local_bot/tg_*.py`): `quant-autotrade/docs/TELEGRAM.md`. 토큰·ID는 PC `.env`에만 두고 `telegram_setup.bat`으로 페어링한다.
- 기능 개발 후에는 테스트를 돌리고 작업 브랜치에 commit·push한다.

## 작업별 Skill

- 기능 추가: `/feature-development`
- 오류 수정: `/bug-fix`
- UI 개선: `/ui-improvement`
- 배포 점검: `/deploy`
- 티스토리 포스팅 HTML: `/tistory-post-html`

## 배포 주의

- `js/`, `css/`, `data/`: `master` 반영 후 GitHub Pages 자동 배포
- `scripts/cloud-vm/`: `master` 반영 후 VM 자동 배포
- `gas/ticker-proxy.gs`: `master` 반영 후 GitHub Actions(clasp)가 자동 배포(2026-08-14부터). 저장소 Secrets(`CLASP_CREDENTIALS`/`CLASP_DEPLOYMENT_ID`) 없으면 예전처럼 GAS에서 수동 배포
- `skin.html`을 바꾸면 해결되는 문제에는 **런타임 우회를 새로 만들지 않는다.**
  `docs/SKIN_HTML_PENDING.md`에 기록하고 사용자에게 알린다(2026-09-05 지시:
  "html 바꾸면 되는 문제는 기억만해, 땜질식으로 수정할 필요없어"). 이미 들어가 있는
  우회는 반영 전까지 화면을 지탱하므로 먼저 지우지 않는다. 티스토리가 매 요청마다
  주입하는 것(파비콘 link 등)은 예외 - 스킨을 갱신해도 남으므로 런타임 처리가 맞다.
- `skin.html`: Tistory 관리자에서 수동 반영. 단 **마크업이 바뀐 경우만** 그렇다.
  `?v=` 캐시 문자열만 올린 변경은 수동 반영 없이도 사용자에게 닿는다 - GitHub Pages는
  `?v=` 값과 무관하게 같은 파일을 서빙하고 `cache-control: max-age=600`이라, 옛 `?v=`가
  박힌 라이브 스킨도 10분 안에 새 `js/`·`css/` 내용을 받아간다(2026-09-04 실측:
  옛 URL 응답이 새 파일과 바이트까지 일치). `?v=` 갱신은 즉시 반영을 강제하고 무엇이
  올라가 있는지 기록하는 용도이지, 반영의 전제조건이 아니다. 작업 요약에 "수동 반영
  없으면 반영 안 됨"이라고 쓰지 않는다.

## 점검 도구

- `.github/workflows/api-probe.yml`: 운영 API·라이브 사이트 응답을 GitHub Actions 러너에서
  대신 호출해 확인한다. 아웃바운드가 막힌 작업 환경에서 API 필드·단위를 추정하지 않고
  실측할 때 Actions 탭에서 수동 실행한다. 인증 엔드포인트는 대상이 아니다.
- `.github/workflows/page-speed.yml`: 라이브 페이지의 **체감 로딩 속도**를 헤드리스 크롬으로
  잰다(FCP·LCP + 페이지별 "목록·수치가 실제로 채워진 시각"). API 응답시간만으로는 화면이
  언제 쓸 만해지는지 알 수 없어서 별도로 둔다. 러너 위치·회선이 실제 사용자와 다르므로
  절대값보다 **페이지 간 비교와 변경 전후 비교**에 쓴다. 수동 실행 전용.
