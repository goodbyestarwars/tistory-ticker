# API 운영 명세서 — `goodbyestar.cloud`

작성일: 2026-08-17 · 운영 기준 커밋: `0f18642` (`origin/master`)

이 문서는 `scripts/cloud-vm/main.py`의 FastAPI 운영 경계를 정리한다. 필드별 상세 응답은
루트 `API_REFERENCE.md`, 시스템 배포·호출 흐름은 `ARCHITECTURE.md`와
`docs/ARCHITECTURE_SPEC.md`, 저장 데이터는 `docs/DB_SPEC.md`를 기준으로 한다.

## 1. 운영 주소와 프로토콜

| 항목 | 값 |
|---|---|
| Base URL | `https://goodbyestar.cloud` |
| REST 문서 | `https://goodbyestar.cloud/docs`, `/openapi.json` |
| 헬스체크 | `GET /health` |
| 지연 모니터 | `GET /health/latency?lines=50` |
| WebSocket | `wss://goodbyestar.cloud/ws/quotes`, `wss://goodbyestar.cloud/ws/economic-news` |
| 실행 형태 | FastAPI + Uvicorn, VM systemd 서비스 |
| 배포 | `master` push 후 VM 자동 배포, 약 5분 내 반영. FastAPI 재시작·검색 스캔 재실행은 `scripts/cloud-vm/`·`data/`가 바뀐 커밋에만(js/css만 바뀐 커밋은 재시작 없음) |

REST 성공 응답은 일반적으로 다음 envelope을 사용한다.

```json
{
  "success": true,
  "updatedAt": "2026-08-17T06:00:00+00:00",
  "data": {}
}
```

`updatedAt`은 응답 생성 시각이며, 실제 데이터 수집 시각은 각 데이터의 `updated_at`,
`asOf`, `scannedAt`, `fetchedAt` 같은 필드를 따로 확인한다. OAuth redirect와 일부
레거시 경로는 이 envelope을 사용하지 않을 수 있다.

## 2. 인증과 CORS

### 2.1 서버 간 비공개 API

GAS에서 VM을 호출하는 배치·프록시 경로는 다음 헤더가 필요하다.

```http
X-API-Key: <VM_API_TOKEN>
```

토큰 값은 문서·소스·프론트에 기록하지 않는다. GAS에서는 Script Properties의
`KIWOOM_VM_TOKEN`, VM에서는 환경변수 `API_TOKEN`으로 관리한다.

대표 비공개 경로:

`/quote`, `/ohlc/{code}`, `/naver-news`, `/investor-flow-batch`,
`/fundamentals-batch`, `/fundamentals/{code}`, `/daily-scan-batch`,
`/strategy-scan-batch`, `/week52-batch`.

### 2.2 브라우저 공개 API

시세·시장판·뉴스 조회 경로는 별도 API 키 없이 호출한다. 브라우저 CORS 허용 Origin은
`https://ghlee.tistory.com`이며 GET 중심으로 운영한다. CORS는 브라우저 정책이지
서버 간 호출 방화벽이 아니므로, 공개 경로는 서버 간 요청을 완전히 차단하지 않는다.

### 2.3 Google 사용자 세션

관심종목과 개인 카드 설정은 Google OAuth 로그인 후 HttpOnly·Secure 세션 쿠키로 인증한다.
`/watchlist`, `/watchlist/disclosures`, `/sector-cards/me`는 로그인 세션이 필요하다.
공용 카드 설정의 PUT은 Google 관리자 허용목록과 `X-API-Key`를 함께 확인한다.

## 3. 엔드포인트 운영표

### 3.1 상태·인증·사용자 설정

| Method | Endpoint | 인증 | 운영 역할 |
|---|---|---|---|
| GET | `/health` | 없음 | 서비스 상태와 배포 가드 버전 + `deployedCommit`/`deployedCommitShort`(VM이 처리한 master 커밋), `deployRecordedAt`(그 기록 시각), `processStartedAt`(FastAPI 시작 시각 - 이 값이 기록 시각보다 뒤면 그 커밋의 VM 코드가 실행 중) |
| GET | `/health/load` | 없음 | VM 부하 스냅샷: loadAvg, 메모리·스왑(MB), FastAPI 스레드별 누적 CPU 초(상위 12), 다른 파이썬 프로세스의 .py 이름·RSS·누적 CPU 초·경과 초(상위 10). 명령줄 인자는 내보내지 않음. 분당 20회 제한 |
| GET | `/health/latency` | 없음 | VM 지연 모니터 최근 로그 |
| GET | `/health/realtime` | 없음 | KIS 실시간 공유 허브 상태(연결·마지막 체결·누락 구독·KIS 오류) |
| GET | `/theme-flow` | 없음 | 국내 주요종목 "오늘 돈이 몰린 섹터" - 키움 테마(ka90001/ka90002) 등락률 상위 20개, 거래대금 순, 3분 백그라운드 |
| GET | `/binance-kr-equity` | 없음 | 바이낸스 국내주식 토큰(SAMSUNGUSDT·SKHYNIXUSDT) 참고 시세: 가격(USDT)·24시간 등락·마크가격·펀딩비·1시간 종가 48개. 국내 장 닫힘 5분/장중 30분 백그라운드, 451이면 `restricted`. 2026-09-15부터 화면은 방문자 브라우저가 `fapi.binance.com`을 직접 조회하고(CORS 허용) 이 엔드포인트는 폴백 |
| GET | `/api/circuit-breaker` | 없음 | 메인페이지 VI·사이드카 배지 캐시. `sidecar{available,active,market,triggered_at,note}`, `vi_active_count`, `vi_list[{code,name,status(active|released),triggered_at,released_at}]`(최근 발동 순 최대 10, 해제 후 5분까지), `fetchedAt`, `error`. 서버가 KIS 변동성완화장치(VI) 현황(FHPST01390000)을 거래일 08:55~15:35·15:55~20:05에 20초마다 1회 조회. 사이드카는 확인된 출처가 없어 `available=false` |
| GET | `/auth/google/start` | 없음 | OAuth 시작, `return_to` 선택 |
| GET | `/auth/google/callback` | OAuth state/nonce | OAuth 콜백 및 세션 발급 |
| GET | `/auth/google/me` | 세션 선택 | 로그인 상태 확인 |
| GET | `/auth/google/logout` | 없음 | 세션 쿠키 삭제 |
| GET/PUT | `/watchlist` | Google 세션 | 사용자 관심종목 조회·저장, revision 충돌 시 409 |
| GET | `/watchlist/disclosures` | Google 세션 | 관심종목 최근 7일 국내 DART 공시 |
| GET | `/sector-cards` | 없음 | 공용 증시온도 카드 설정 |
| PUT | `/sector-cards` | 관리자 + API 키 | 공용 카드 설정 전체 교체 |
| GET/PUT/DELETE | `/sector-cards/me` | Google 세션 | 개인 카드 설정 조회·저장·공용 기본값 복귀 |

PUT 요청 본문은 JSON 객체여야 하며, revision이 오래된 경우 임의 덮어쓰지 않고 409를
반환한다. 사용자는 다시 GET한 뒤 최신 revision으로 재저장해야 한다.

### 3.2 국내 종목·분석·검색

| Endpoint | 인증 | 캐시/갱신 | 비고 |
|---|---|---|---|
| `/quote?code=000000` | API 키 | VM 단기 LRU | 키움 기본정보 원본 가공 응답 |
| `/ohlc/{code}` | API 키 | VM 단기 LRU | 국내 일봉 |
| `/ohlc-minute/{code}` | 없음 | VM 단기 LRU | 국내 분봉 |
| `/pbar-tratio/{code}?days=N` | 없음 | VM 5분 + SQLite(온디맨드 + 거래일 18:10 일별 수집) | 실제 체결가 매물대(화면은 2026-09-15부터 일봉 추정치 사용) |
| `/health/volume-profile` | 없음 | 실시간 | 매물대 실제 체결가 일별 수집 상태 |
| `/etf-components/{code}` | 없음 | VM 캐시 | ETF 구성종목 |
| `/foreign-flow/{code}?days=N` | 없음 | VM 5분 | 외국인·기관 일별 수급 |
| `/investor-flow/{code}?name=...` | 없음 | VM 5분 | 공매도·대차·연기금 |
| `/investor-flow-batch` | API 키 | 하루 1회 배치 캐시 | 배치 수급 요약 |
| `/fundamentals-batch` | API 키 | 하루 1회 배치 캐시 | DART 재무제표 배치 |
| `/fundamentals/{code}` | API 키 | 배치 캐시 읽기 | 종목별 DART 재무제표 |
| `/daily-scan-batch` | API 키 | VM 일일 스냅샷 | 차트 패턴·스윙 스냅샷 |
| `/strategy-scan-batch` | API 키 | VM 일일 캐시 | 전략검색 후보군 |
| `/week52-batch` | API 키 | VM 일일 캐시 | 52주 신고가·신저가 |
| `/investor-trend?period=week&market=kospi` | 없음 | SQLite 백그라운드 폴러 | 코스피·코스닥 투자자 동향 |
| `/market-rank?limit=5` | 없음 | 약 30초 | 거래량·상한가·하한가 |
| `/market-board?market=domestic&tab=...` | 없음 | 시장별 단기 캐시 | 실시간 종목판·업종 TOP |
| `/order-book/{code}` | 없음 | 약 1.5초 | 호가·체결강도, 프론트 2초 폴링 |

`daily_prices`의 대파동 판정은 224거래일 미만이면 억지로 장기 추세를 만들지 않는다.
국내 2주 스윙 스냅샷의 `big_wave`, `mid_wave`, `small_wave`, 최근 이벤트와 근거는
`ohlc_snapshot.db`에 함께 저장한다.

### 3.3 시장지표·뉴스·주간 리포트

| Endpoint | 인증 | 캐시/갱신 | 비고 |
|---|---|---|---|
| `/futures?interval=day&days=90` | 없음 | SQLite 폴러 읽기 | 국내·미국 지수, 환율, 채권, 원자재, BTC/ETH |
| `/futures/avg?symbol=BTC&days=365` | 없음 | 즉시 계산 | 지정 심볼 장기 평균·고저 |
| `/option-flow` | 없음 | 5분 폴러 | 콜·풋 옵션 수급 |
| `/kofia-market?days=30` | 없음 | VM 캐시 | 신용융자·예탁금·반대매매 보조지표 |
| `/domestic-market-indicators` | 없음 | VM 캐시, `fresh` 선택 | 국내시장 지표 |
| `/earnings-calendar?year=YYYY&month=M` | 없음 | 10분 메모리 | DART 실적공시 + 미국 실적 공급자 결과 |
| `/domestic-news?limit=50` | 없음 | SQLite/5분 | 국내 일반뉴스·DART 공시 |
| `/foreign-news?limit=30` | 없음 | 미국 공급자/5분 | 미국·글로벌 일반뉴스 |
| `/news-momentum/{code}` | 없음 | `news_momentum.db` | 외부 API 없는 종목 이슈 집계 |
| `/weekly-report?fresh=false` | 없음 | 주간 스냅샷 + 15분 메모리 | 지난 주 시장·뉴스·후보·실적 일정 |

시장 선택은 프론트 상태와 API의 `market`/전용 경로를 함께 사용한다. 국내시장 화면에서
미국 일반뉴스를 국내 뉴스 목록으로 섞지 않으며, 경제 종합뉴스의 속보는 별도 규칙으로
공통 거시 이벤트를 포함할 수 있다.

### 3.4 미국 종목

| Endpoint | 인증 | 캐시/갱신 | 비고 |
|---|---|---|---|
| `/us-search?q=...` | 없음 | 공급자/메모리 캐시 | 미국 종목 검색 |
| `/us-quote/{symbol}` | 없음 | 공급자별 단기 캐시 | 미국 현재가 |
| `/us-quotes?symbols=AAPL,MSFT` | 없음 | 공급자별 단기 캐시 | 관심종목용 미국 현재가 최대 50종목 일괄 조회 |
| `/us-orderbook/{symbol}` | 없음 | 공급자별 단기 캐시 | 미국 호가 가능 범위 |
| `/us-chart/{symbol}` | 없음 | 공급자 캐시 | 미국 차트 |
| `/us-news/{symbol}` | 없음 | `us_news_cache.db`, 기본 30분 | Alpha Vantage/Finnhub/Google RSS/Naver fallback |
| `/us-analysis/{symbol}` | 없음 | `us_analysis_cache.db`, 기본 6시간 | Finnhub 분석·프로필 |

미국은 국내 DART가 없으므로 미국 기업 뉴스·실적·프로필 공급자를 사용한다. 미국
실적 일정은 `/earnings-calendar`의 미국 공급자 결과로 보완하며 국내 DART와 같은 DB에
합쳐 저장하지 않는다.

미국 의회 거래는 유료 API를 서버에서 재배포하지 않는다. 미국 종목분석 화면에는 선택한
티커를 붙인 Quiver 종목별 거래 페이지와 미 하원 공식 신고자료 페이지로 연결되는 외부 링크만
표시한다. 거래 원자료·API 응답·캐시는 저장하지 않으며, 외부 페이지에서 거래일과 신고일을
직접 확인하도록 안내한다.

## 4. WebSocket 운영

### `/ws/quotes`

- Origin은 `https://ghlee.tistory.com`만 허용한다.
- 쿼리 `codes`에 국내 6자리 코드와 `US:SYMBOL`을 쉼표로 전달한다.
- 서버 인증키·외부 공급자 자격증명은 브라우저로 전달하지 않는다.
- 동시 연결 상한은 200이다.
- KIS 국내·미국 WebSocket을 우선 사용하고, 설정·실패 시 기존 키움/Finnhub 경로로
  폴백한다.
- KIS 경로는 브라우저 연결마다 KIS 세션을 열지 않는다. 프로세스 공용 허브
  (`kis_ws_hub.py`)가 KIS WebSocket 하나를 유지하고, 야간선물·주간선물·옵션 수집기와 이
  중계가 모두 여기에 구독만 한다(2026-09-14, 같은 앱키 세션끼리 충돌해 체결이 0건이던 장애).
- 틱이 없는 동안 15초마다 `{"type":"status","upstream":"connected|retrying","lastTickAgeSec":…}`를
  보낸다. 화면은 이것으로 "지연"을 판단할 수 있다.
- 구독 3초 뒤부터 1초마다 허브 실제 등록 여부를 보고, 바뀌면
  `{"type":"coverage","live":[…],"delayed":[…]}`를 보낸다(2026-09-14). `delayed` 종목(등록 자리 40에
  못 들어갔거나 KIS 연결이 끊긴 종목)은 서버가 주식현재가 시세(FHKST01010100, 시장 `UN`)를
  평일 07:55~20:05엔 15초, 그 외 10분 간격으로 서버 전체 한 번만 조회해
  `{"type":"quote",…,"source":"KIS REST","delayed":true}`로 대신 보낸다(`rest_quote_fallback.py`).
  화면(홈 종목판·국내 주요종목 카드·관심종목·홈 MY)은 해당 행에 "지연"을 표시한다.
- 2026-09-15부터 KIS 자리에 못 들어간 종목은 REST보다 먼저 키움 공유 허브(`kiwoom_ws_hub.py`,
  키움 WebSocket 1개)에 구독해 `{"type":"quote",…,"source":"Kiwoom WebSocket"}`(가격·대비·등락률,
  거래량 없음)으로 보낸다. 키움이 받는 종목은 `coverage.live`에 들어가고 REST 폴백을 부르지 않는다.
  구독자가 없으면 키움에 연결하지 않고, 모두 떠나면 60초 뒤 닫는다. 미검증 값은 환경변수로 둔다:
  연결당 등록 수 `KIWOOM_WS_MAX_CODES`(기본 100), 통합 종목코드 접미사 `KIWOOM_WS_CODE_SUFFIX`(기본
  `_AL`, 등록 거절 시 접미사 없이 1회 재등록). 목록이 바뀌면 `REG`를 `refresh:'0'` 전체 목록으로 다시 보낸다.
  상태는 `/health/realtime`의 `kiwoom`(로그인·등록 응답·체결 수·접미사)으로 확인한다.
- 한 연결은 국내 종목을 300개까지 요청할 수 있다. 실시간 등록은 앞 50종목까지만 하고 나머지는
  처음부터 `delayed`로 REST 폴백을 받는다. REST 폴백은 서버 전체 초당 5건으로 제한한다(KIS REST
  초당 한도를 종목판·수급 등 다른 작업과 나눠 쓰므로). 키움 폴백 경로는 50종목까지 그대로.
- 허브 상태는 `GET /health/realtime`(연결 여부, 마지막 체결 시각, 등록·누락 구독 수,
  재접속·워치독 횟수, KIS 마지막 오류 메시지)으로 확인한다. 세션당 등록 상한은 미검증이라
  `KIS_WS_MAX_REGISTRATIONS`(기본 40)로 두고, 넘치면 선물 > 종목 체결 > 호가 > 옵션 순으로 남긴다.
  옵션은 자리의 4분의 1(`KIS_WS_OPTIONS_BUDGET`, 기본 10 - 2026-09-15 20에서 축소)까지만 쓰고, 새 키가 들어갈 자리가 없을 때만
  쓰지 않는 키를 해제 프레임(tr_type `2`, KIS 공식 예제 기준)으로 비운다 - 세션을 다시 맺지 않는다.
- 연결이 끊기면 프론트가 재연결하며, 휴장 중 값이 움직이지 않는 것은 정상이다.

### `/ws/economic-news`

- Origin은 `https://ghlee.tistory.com`만 허용하고 연결 직후 시장 스냅샷을 1회 보낸다.
- 서버 공유 캐시는 4분, 브로드캐스트 수집 주기는 5분이다.
- `market` 기본값은 KST 시간대에 따라 서버가 계산하지만, 탭 선택 프론트는 선택 시장과
  다른 패킷을 표시하지 않는다.
- 속보 화면의 아날로그 스코어보드식 한 건 전환은 프론트 5초 타이머다. 5초마다 외부
  뉴스 API를 다시 호출하는 구조가 아니다.
- 속보에서 단순 지수 기사는 오탐 방지를 위해 제거 대상이며, DART/실적·거시 이벤트
  우선순위 규칙은 `main.py`의 `_build_flash_items`가 관리한다.

## 5. 오류·장애 대응

| 상태 | 의미 | 우선 확인 |
|---|---|---|
| 401 | API 키 누락/불일치 | GAS Script Properties와 VM `API_TOKEN` |
| 403/1008 | CORS 또는 WebSocket Origin 거부 | Tistory Origin, HTTPS/WSS 여부 |
| 404 | 종목·캐시 데이터 없음 | 종목코드·배치 생성 여부 |
| 409 | revision 충돌 | 최신 설정 GET 후 재저장 |
| 422 | 파라미터 형식 오류 | 코드 6자리, days/limit 범위 |
| 502 | 키움/KIS/Finnhub 등 상위 공급자 실패 | VM 로그와 공급자 키/장 운영시간 |
| 503 | 필수 환경변수·배치 캐시 미준비 | `/health`, 캐시 파일, systemd 로그 |

점검 순서는 `GET /health` → `GET /health/latency` → 해당 공개 API → 인증 API 순서로
진행한다. 공급자 장애를 프론트에서 임의의 정상값으로 채우지 않고, 응답의 null·빈 배열·
오류 상태를 유지한다.

## 6. 배포·운영 체크리스트

1. 최신 `origin/master`에서 변경 범위를 확인한다.
2. Python 컴파일·JavaScript 문법 검사와 관련 UI/회귀 테스트를 실행한다.
3. `master` push 후 GitHub Pages 정적 자산 반영을 기다린다.
4. `scripts/cloud-vm/` 변경이면 VM 자동 배포 후 `/health`가 200인지 확인한다.
5. `gas/` 변경이면 GitHub Actions의 `Deploy GAS ticker-proxy`가 성공했는지 확인한다.
6. `skin.html` 변경이면 Tistory 관리자 스킨 편집기에 수동 붙여넣었는지 별도 확인한다.
7. API 응답 필드 변경 시 GAS `CacheService` 키 버전과 프론트 캐시 버전을 함께 검토한다.

## 7. 금지사항

- API 토큰·외부 공급자 키를 문서·Git·브라우저에 기록하지 않는다.
- 공개 CORS를 인증으로 오해하지 않는다.
- 휴장 상태를 임의로 이전 가격이나 가짜 실시간 값으로 채우지 않는다.
- 저장소에 VM SQLite 실데이터·뉴스 원문·API 응답 대량 덤프를 커밋하지 않는다.
- Tistory 수동 반영과 GitHub Pages 자동 반영을 같은 배포 단계로 간주하지 않는다.
