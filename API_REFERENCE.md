# 클라우드 VM API 레퍼런스 (`goodbyestar.cloud`)

## 확정 검증·수신 증거 추가 계약 (2026-10-28, 작업 PR)

`/pattern-scan` 기존 행에 `signalReview`를 추가한다: version=confirmation-shadow-v1, mode=shadow, orderAuthorized=false, confirmed, entryValid=false(일봉), confirmedAt, signalPrice, invalidationPrice, dataAsOf, evaluatedAt, checks, reasons, legacyConfirmed, signalId. 기존 patterns/status/이력 키는 보존한다.

`/health/realtime`의 ninePayResearch.items에는 수신 당시 1차 Shadow 평가와 confirmationMode=shadow를 추가한다. 키움/Toss 허브에는 quoteReceipts(종목별 receivedAt·ageSec), observedFreshCodes(최근90초 실제 수신), 키움에는 registrationAcknowledged를 추가한다. 기존 등록/liveCodes와 구분한다. 키움 receivedAt은 UTC ISO, Toss는 epoch seconds이며 거래소 전송 시각을 뜻하지 않는다. 기존 `/health/9pay` 주문 피드에는 Shadow를 넣지 않으며 현재 무효화 관측이 있으면 해당 저장 이벤트를 제외한다. [범위·한계](docs/NINEPAY_INTEGRATED_CONFIRMATION.md).

> 운영 기준: 2026-08-17 · `origin/master` 배포 커밋 `0f18642`

운영 절차·인증 경계·WebSocket·장애 대응은 [`docs/API_OPERATION_SPEC.md`](docs/API_OPERATION_SPEC.md)를
먼저 읽는다. 이 문서는 엔드포인트별 필드 레퍼런스다.

`scripts/cloud-vm/main.py`(FastAPI) 소스코드를 직접 읽어서 정리한 문서. 이 세션은 VM의
실제 `/openapi.json`에 네트워크로 접근할 수 없어서(샌드박스 환경), **소스에서 라우트
데코레이터·파라미터 타입·응답 딕셔너리 구성을 그대로 추출**하는 방식으로 작성했다 —
FastAPI가 `/openapi.json`을 만드는 것과 같은 소스를 보고 정리한 것이므로 내용은
동일해야 하지만, 배포된 버전과 이 문서 작성 시점의 소스가 다를 수 있으니 중요한 작업
전에는 실제 `https://goodbyestar.cloud/openapi.json`(또는 `/docs` Swagger UI)과 한 번
대조해보는 걸 권장한다.

가독성을 위해 요청하신 12개 항목(파라미터/응답/단위/캐시 등)은 **엔드포인트 1개당 속성
테이블 1개**로 정리했다(9개 항목을 한 줄에 다 욱여넣으면 표가 옆으로 너무 길어져서 오히려
읽기 어려움). X-API-Key **값 자체는 어디에도 적지 않았고**, 필요 여부와 헤더 이름만 표시함.

## 공통 규칙

- **Base URL**: `https://goodbyestar.cloud`
- **REST 라우트는 GET 중심이며 사용자 설정에 PUT/DELETE가 있다.** `/watchlist`와
  `/sector-cards/me`는 Google 세션 기반으로 저장·삭제하고, 공용 `/sector-cards` PUT은
  관리자 인증이 필요하다. WebSocket은 `/ws/quotes`, `/ws/economic-news` 두 개다.
- **성공 응답 공통 포맷**(`envelope()` 함수가 모든 라우트에 일괄 적용):
  ```json
  { "success": true, "updatedAt": "2026-07-28T05:12:00.123456+00:00", "data": { /* 라우트별 내용 */ } }
  ```
  `updatedAt`은 응답을 만든 시각(UTC, ISO 8601)이지 데이터 자체의 갱신 시각이 아님 — 데이터
  신선도는 각 엔드포인트의 "데이터 갱신 주기"를 볼 것.
- **인증 방식**: 헤더 `X-API-Key: <API_TOKEN>` (HTTP 헤더는 대소문자 구분 없음). 두 그룹으로
  나뉜다:
  - **인증 필요**(GAS만 호출, 스크립트 속성의 `KIWOOM_VM_TOKEN`) — 아래 표에 "필요"로 표시
  - **인증 불필요**(방문자 브라우저가 직접 호출) — 대신 CORS로 `https://ghlee.tistory.com`
    Origin만 허용(`allow_methods=['GET']`, `allow_headers=['*']`). **서버 대 서버 호출(브라우저가
    아닌 백엔드에서 curl/fetch)은 Origin 헤더를 안 보내는 게 보통이라 CORS 제한 자체를 안
    받는다** — 즉 ChatGPT가 백엔드에서 이 라우트들을 호출하는 건 인증·CORS 어느 쪽으로도
    막히지 않는다(공개 시세 데이터라 애초에 막을 필요가 없는 것들).
- **공통 에러 포맷**: FastAPI 기본 형식
  ```json
  { "detail": "서버에 KIWOOM_APPKEY/KIWOOM_SECRETKEY가 설정되지 않았습니다." }
  ```
  경로/쿼리 파라미터 형식 자체가 틀리면(예: `code`가 6자리가 아님) FastAPI가 422를 자동
  반환하며 형식이 다르다:
  ```json
  { "detail": [ { "type": "string_too_short", "loc": ["query", "code"], "msg": "String should have at least 6 characters", "input": "12345" } ] }
  ```
  자주 나오는 상태코드: `401`(X-API-Key 없음/틀림) · `404`(데이터 없음) · `422`(파라미터 형식
  오류) · `500`(서버 환경변수 미설정) · `502`(키움/KIS 등 상위 API 호출 실패) · `503`(배치
  캐시 파일이 아직 생성 전).

---

## 우선순위 엔드포인트 상세

### `GET /domestic-quotes?codes=083650,006800`

실시간 검색·호가의 현재가 조회용 공개 API. 기존 네이버 시세를 GAS 경유 없이 VM에서 직접 요청한다. 응답은 `envelope.data` 배열이며 `code,name,market,price,change,changeRate,volume,time` 필드는 기존 GAS와 같다. 장외 NXT 가격 우선 규칙도 유지한다. 최대 30종목, 종목별 5초 캐시(최대 300종목), 외부 다운로드 동시 1건·6초 제한·대기 1초 제한, IP당 분당 60회. 타이머·증권사 추가 조회·DB 저장 없음. `/quote`의 서버 간 인증은 유지한다.

### `GET /strategy-scan`

공개 저장 결과의 `scannedAt,categories,scanned,universe,skippedNoData,skippedIlliquid,skippedNoSector,skippedNoFundamentals`만 반환한다.
GAS `getStrategyScanResult`와 필드 projection이 같다. 파일 mtime별 JSON/gzip 캐시·분당30회/IP,
파일 없으면503이며 새 수집을 실행하지 않는다. `/strategy-scan-batch`는 기존 API 키 인증을 유지한다.
도메인별 정식 경로·단위·fallback은 `docs/API_OPERATION_SPEC.md`가 단일 출처다.

### `GET /quote`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **필요** (`X-API-Key`) |
| 필수 파라미터 | `code` (쿼리) |
| 선택 파라미터 | 없음 |
| 파라미터 형식·허용값 | `code`: 문자열, 정확히 6자리(영숫자), 예 `"005930"` |
| 응답 JSON 구조 | 키움 `ka10001`(주식기본정보요청) TR 응답을 **가공 없이 그대로 통과**시킴 (`data` = TR 원본 JSON). 이 사이트가 실제로 읽어 쓰는 필드: `mac`(시가총액), `flo_stk`(발행주식수), `dstr_stk`(유통주식수), `dstr_rt`(유통비율), `for_exh_rt`(외국인소진율), `per`, `pbr`, `eps`, `bps` — 이 외 필드도 TR 원본 그대로 다 들어있음(전체 필드 목록은 키움 공식 문서 기준) |
| 데이터 단위 | `mac`은 코드에서 억원으로 그대로 취급(`gas/ticker-proxy.gs`의 `market_cap_eok: toNum_(quote.mac)` — 별도 환산 없음, **미검증**: 키움 공식 단위 문서 대조 안 함). `flo_stk`/`dstr_stk`는 천주. `eps`/`bps`는 원 |
| 시장 범위 | 코스피·코스닥 전 종목(ka10001 자체의 KRX/NXT 통합 여부는 문서에 명시 안 됨) |
| 데이터 갱신 주기 | 실시간 — 매 호출마다 키움에 라이브 조회(캐시 없음) |
| 캐시 시간 | **없음** (요청마다 실제 키움 API를 호출하므로 과도한 반복 호출 주의) |
| 호출 예시 | `curl -H "X-API-Key: $TOKEN" "https://goodbyestar.cloud/quote?code=005930"` |
| 오류 응답 예시 | `code` 형식 오류 → 422 / 키 없음·오류 → 401 / `KIWOOM_APPKEY` 미설정 → 500 `{"detail":"서버에 KIWOOM_APPKEY/KIWOOM_SECRETKEY가 설정되지 않았습니다."}` / 키움 호출 실패 → 502 |

### `GET /ohlc/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **필요** (`X-API-Key`) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | 없음 |
| 파라미터 형식·허용값 | `code`: 문자열, 정확히 6자리 |
| 응답 JSON 구조 | `data` = 일봉 배열, **오름차순(과거→최신)**: `[{"date":"2026-07-25","open":72000,"high":72800,"low":71600,"close":72500,"volume":8123456}, ...]` |
| 데이터 단위 | `open/high/low/close`: 원 · `volume`: 주 |
| 시장 범위 | ka10081(주식일봉차트조회) — KRX/NXT 통합 여부 문서에 불명 |
| 데이터 갱신 주기 | 일봉이라 그날 정규장 마감 후 그날 봉이 확정됨. 최대 약 600영업일(ka10081 1회 호출 한도)까지 반환 |
| 캐시 시간 | VM 프로세스 메모리 5분(재시작 시 초기화, `_LIVE_CACHE_TTL=300`) |
| 호출 예시 | `curl -H "X-API-Key: $TOKEN" "https://goodbyestar.cloud/ohlc/005930"` |
| 오류 응답 예시 | 데이터 없음 → 404 `{"detail":"일봉 데이터를 찾을 수 없습니다."}` / 키움 실패 → 502 |

### `GET /ohlc-minute/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (`/order-book`, `/foreign-flow`와 동일 패턴 - CORS(`ghlee.tistory.com`만) + rate limit로 대체, 브라우저가 직접 호출) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | `tic_scope`: `1`\|`3`\|`5`\|`10`\|`15`\|`30`\|`45`\|`60`(분, 기본 `1`) |
| 응답 JSON 구조 | `data` = 분봉 배열, **오름차순(과거→최신)**: `[{"date":"2026-08-03","time":"09:01","open":...,"high":...,"low":...,"close":...,"volume":...}, ...]` |
| 시장 범위 | ka10080(주식분봉차트조회) - 2026-08-04 실호출로 필드명 검증 완료(005930 1분봉 정상 수신, 최근 며칠치가 한 번에 옴) |
| 데이터 주의 | 정규장 마감 후 15:20~15:30(종가 단일가) 구간 행은 거래량이 비정상적으로 크게 찍힘(누적치로 추정, 미검증) - 프론트(`js/stock-search.js`)가 최근 며칠치 응답 중 가장 최근 날짜만 남기고, 그 안에서 09:00~15:20만 걸러 사용(2026-08-05: 날짜 필터 누락으로 여러 날짜가 이어붙어 그려지던 버그 수정) |
| 캐시 시간 | VM 프로세스 메모리 1분(`_OHLC_MINUTE_CACHE_TTL=60`, 2026-08-05부터 - 프론트 분봉 자동 재조회 주기와 맞춤. 다른 엔드포인트와 공유하는 `_LIVE_CACHE_TTL=300`과 별개) + `(code, tic_scope)` 단위 rate limit |
| 호출 예시 | `curl "https://goodbyestar.cloud/ohlc-minute/005930?tic_scope=1"` |
| 오류 응답 예시 | `tic_scope` 오류 → 400 / 데이터 없음 → 404 / 키움 실패 → 502(원인 메시지 그대로 노출) |

### `GET /hour-direction`

선택 종목 한 개의 **확인 당시 가격보다 1시간 뒤 높을지 낮을지** 판단하는 미검증 방향 가설. code(6자 국내코드)필수, name(80자이하)선택. 화면은 세 결과와 아래 짧은 근거다. 응답 data: code,name,direction(up|down|unclear),label,reason,checkedAt,expiresAt,horizonMinutes:60,objective:direction,referencePrice,referenceBasis:확인 당시 최근 체결가,probability:null,validated:false,rulesVersion:hour-direction-rules-v6,sourceStatus,recorded. 호환 가격/목표 필드 targetPct,stopPct,entryPrice,targetPrice,stopPrice는 항상null. 자료 검증 전 referencePrice도null. +3%/−3% 이동폭 검사와 확대계산 제거. 최근5봉 가격 방향과30분VWAP, 패턴 또는 체결강도로 확인하며 체결강도 단독 신호가 아니다. 상세 [방향명세](docs/HOUR_CANDIDATES.md).

`/hour-candidates`와 같은 전역동시1건·IP분당3회 버킷·KIS간격 공유. 국내거래일09:05~14:30전 직접1종목, 워커1개, 최근30분. 전일거래량조회 생략, 정상 공급자4회(분봉1회 포함; 토큰/재시도 별도). 추가폴링/분봉페이지 없음. no-store, 장외공급자0회, 입력422/동시409/확보실패503. 같은 KIS KRX의 최근체결가가 방향 비교 기준이며 매수주문가격이 아니다. 저장상세는 기존5MB회전기록, 수동 클릭/검색만 호출, URL자동진입/분봉갱신에는 조회하지 않는다.

### 1시간 방향 성과 검증(2026-10-09)

기존 `/hour-direction` 계산은 변경하지 않고 `predictionId`, `validationRecorded`를 추가한다. `GET /hour-direction/performance`는 공개/no-store/IP분당10회/외부조회0회. model·code·group_by(model/hour/code/direction)·start포함/end제외(KST날짜)·scope(in-session기본/outside-window)로 분리하며 적중률·보류율·상하 가상수익·손익비·제외사유·가격시간오차를 반환한다. `GET /hour-direction/records`는 기존 X-API-Key 인증, limit최대100/nextCursor를 after로 전달하여 원본/결과 export. [고정 평가 정책·보존·부하](docs/HOUR_DIRECTION_VALIDATION.md). 실제 성과와 통계 우위는 구별하며 validated:false를 유지한다.

### `GET /hour-candidates`

| 항목 | 값 |
|---|---|
| 목적 | 국내 오전 수동 확인: 매수 기준가 대비 +3%·손절 −3%·60분의 **미검증 실험 후보 필터** |
| 인증 / 캐시 | 공개, 기존 CORS / `Cache-Control: no-store`, 이전 판정 재사용 없음 |
| 입력 | `mode=ranked\|selected`(기본 ranked), selected는 `code` 필수·`name` 선택; `max_open_rise_pct=5`(1~10), `max_minute_jump_pct=1.5`(0.3~5) |
| 확인 시간 | 국내 거래일 09:05 이상 09:15 미만. 그 밖에는 `state=outside_window`, 공급자 조회 안 함 |
| 자료 | 전부 KIS `J`(KRX): 당일 원본 분봉·호가 접수시각·최근 체결·실제 당일 체결강도·전일 확정 거래량 |
| 기준가 | 최우선 매도호가 1주의 스냅샷, 주문 체결가 아님. 종목별 `checkedAt`, `expiresAt` 고정 |
| 응답 | `state, checkedAt, scanStartedAt, scanCompletedAt, modelVersion, criteria, coverage, items, rejected, unknown, probability:null, note, recorded`(장외는 일부 부가키 없음). 행은 `entryPrice,targetPrice,stopPrice,targetPct,stopPct,checkedAt,expiresAt,metrics,reasons,probability:null` |
| 검사 범위 | KIS 3종 순위 중복 제거 후 거래대금순 최대 24개 또는 선택 종목 1개. `fullMarket:false`, 풀·평가·건너뜀·실패 순위 개수 표시 |
| 보호 | IP당 분당 3회, 전체 동시 확인 1개, 상세 워커 3개·시세 함수 호출 시작 최대 초당 10회. 30초 작업 예산·시세 HTTP 4초(토큰 발급·재시도 대기로 엄밀한 HTTP 상한 아님) |
| 오류 | 입력 400/422, 다른 확인 진행 중 409, 공급자 확보 실패 503. 미수신 값을 가짜 0·확률로 채우지 않음 |

기존 후보 API는 호환용이며 화면은 `/hour-direction`으로 단순화했다. 수동 확인만 호출하며 자동 감지 목록과 독립이다. 현재 분·이후 봉은 계산하지 않고 누락 봉·수집 중 분 변경·10초 넘은 호가/체결은 자료 부족으로 처리한다. 규칙·검증 단계·기록 보존은 [기능 명세](docs/HOUR_CANDIDATES.md) 참고.

### `GET /health/volume-profile`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | 불필요(레이트리밋 20) |
| 응답 JSON 구조 | `data` = `{"running", "threadAlive", "lastRunDate", "lastRun": {"date","requested","stored","failed","rows","stoppedEarly","lastError","durationSec"}, "lastError", "schedule", "maxCodes", "recentDays"}` |
| 용도 | 매물대 실제 체결가 일별 수집(`volume_profile_collector.py`)이 오늘 돌았는지·몇 종목을 저장했는지 VM 접속 없이 확인(2026-09-15) |

### `GET /pbar-tratio/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (`/ohlc-minute`와 동일 패턴) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | `days`: 1~120(기본 1) - 1이면 오늘치만, 2 이상이면 SQLite(`volume_profile_daily`)에 누적된 과거 거래일과 오늘 실시간 응답을 가격별로 합산 |
| 응답 JSON 구조 | `data` = `{"currentPrice": .., "avgPrice": .., "daysIncluded": N, "bins": [{"price":..,"volume":..}, ...]}`, `bins`는 가격 오름차순. `daysIncluded`는 실제로 합산에 반영된 거래일 수(요청한 `days`보다 적을 수 있음). `avgPrice`는 거래량 가중평균가(VWAP, Σ가격×거래량/Σ거래량) - `bins`가 실제 체결가·체결거래량이라 정확히 계산됨(비중%이 아님) |
| 시장 범위 | KIS FHPST01130000(국내주식 매물대/거래비중, [국내주식-196]) - HTS(eFriend Plus) [0113] 당일가격대별 매물대 화면과 동일. `js/foreign-flow.js`의 `computeVolumeProfile`(최근 120거래일 근사치)과 별개로 실제 체결가 기반 뷰 |
| 데이터 누적 방식 | 이 엔드포인트가 호출될 때마다 그날 최신 누적 스냅샷을 `volume_profile_daily`에 UPSERT(같은 날은 덮어쓰기, 더하지 않음 - pbar-tratio 응답 자체가 이미 그 시점까지의 당일 누적치라서). 2026-09-15부터 `volume_profile_collector.py`가 KRX 거래일 18:10~20:00 KST 하루 1회 종목판 국내 순위 종목 + 최근 30일 저장 종목(최대 120)도 같은 방식으로 저장한다. 그 밖의 종목은 여전히 "조회된 적 있는 날짜 중 최근 N개"다. 200일보다 오래된 행은 시간당 최대 1회 정리(`_maybe_prune_volume_profile`) |
| 화면 사용 | 2026-09-15부터 종목분석·MY 매물대 화면은 이 엔드포인트를 부르지 않는다(최근 120거래일 일봉 추정치로 통일). 실제 체결가 날수가 충분히 쌓이면 전환을 검토한다 |
| 선택 환경변수 | `KIS_APPKEY`/`KIS_APPSECRET` 미설정 시 503 |
| 캐시 시간 | VM 프로세스 메모리 5분(`_LIVE_CACHE_TTL=300`), `(code, days)` 단위 |
| 호출 예시 | `curl "https://goodbyestar.cloud/pbar-tratio/005930?days=120"` |
| 오류 응답 예시 | KIS 미설정 → 503 / 데이터 없음 → 404 / KIS 실패 → 502(원인 메시지 그대로 노출) |
| 검증 | 요청 파라미터·응답 필드는 한국투자 공식 GitHub(`koreainvestment/open-trading-api`, `examples_llm/domestic_stock/pbar_tratio/`)로 확인했고, 2026-08-04 실호출(005930)로 정상 응답까지 검증 완료. `days` 다일 누적 로직은 db_schema 단위 테스트로 검증(실제 여러 거래일 데이터 축적 확인은 배포 후 시간 경과에 따라 자연히 확인됨). |

### `GET /foreign-flow/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS로 `ghlee.tistory.com`만 브라우저 제한 — 서버 간 호출은 제약 없음) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | `days` (쿼리) |
| 파라미터 형식·허용값 | `code`: 6자리 · `days`: 정수, 허용값 `{5, 10, 20, 42, 63}`만 유효(그 외 값은 기본치 63으로 자동 보정) |
| 응답 JSON 구조 | `data = {"code":"005930","as_of":"2026-07-25","daily":[{"date","close","change_pct","volume","inst_net","foreign_net","ind_net","foreign_shares","foreign_ratio"}, ...] (내림차순,최신일 우선),"rolling":{"today":{...},"5d":{...},"10d":{...},"20d":{...},"2m":{...},"3m":{...}} (각각 {foreign,inst,ind}),"amount_estimate":{"today_krw":...,"inst_today_krw":...,"ind_today_krw":...,"5d_krw":...,"inst_5d_krw":...,... (rolling과 동일 키 세트 × `_krw`)},"streak":{"foreign":{"days","direction"},"inst":{...},"ind":{...}},"signal":{"foreign":{"trend_shift","price_confirmed","note"},"inst":{...},"ind":{...}}}` |
| 데이터 단위 | `close`: 원 · `change_pct`: % · `volume/inst_net/foreign_net/ind_net/foreign_shares`: 주(순매수는 부호 있음, +매수/-매도) · `foreign_ratio`: % · `rolling.*`: 주(합산) · `amount_estimate.*_krw`: 원(수량×종가 근사 추정치, 실제 체결금액 아님) |
| 시장 범위 | KRX+NXT **통합**(KIS `FID_COND_MRKT_DIV_CODE=UN`가 1차 소스, `foreign_net`은 등록외국인 기준). KIS 미설정/실패 시 키움 `ka10045` 폴백(**NXT 미포함 축소값** — 폴백 중인지 응답만으로는 구분 안 됨, 알려진 한계) |
| 데이터 갱신 주기 | 전일 정규장 마감 기준 확정치(일별). KIS `FHPTJ04160001`는 매일 00:00~15:40(KST)에는 호출 자체가 막혀있어(TR 자체 정책) 그 시간대엔 최근 성공 캐시(SQLite, 최대 20시간 보관)를 재사용 |
| 캐시 시간 | VM 프로세스 메모리 5분(코드+days 조합별로 별도 캐시) |
| 호출 예시 | `curl "https://goodbyestar.cloud/foreign-flow/005930?days=20"` |
| 오류 응답 예시 | 데이터 없음 → 404 `{"detail":"수급 데이터를 찾을 수 없습니다."}` |

### `GET /investor-flow/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | `name` (쿼리) |
| 파라미터 형식·허용값 | `code`: 6자리 · `name`: 문자열, 기본 `''` — 종목 한글명(KRX 공시 RSS 매칭용, URL 인코딩 필요) |
| 응답 JSON 구조 | `data = {"name","as_of":"YYYYMMDD","short":{"balance_qty","avg_price","today_ratio_pct","avg_volume_20d","days_to_cover","balance_change_pct","short_squeeze_index","pressure":{"score","grade":{"emoji","label"},"breakdown":{"short_ratio","loan_increase","balance_increase","foreign_sell","inst_sell"},"danger_gate":{"krx_overheated","price_decline_pct","volume_rising","triggered"}}},"loan":{"balance_qty","balance_change_pct"},"credit":{"balance_qty","balance_change_pct","signal":{"flag","label","text", ...}\|null},"pension":{"streak":{"days","direction"},"net_5d","net_20d","net_60d","net_cumulative","cumulative_window_days","current_price"}}` |
| 데이터 단위 | `balance_qty`류: 주 · `avg_price`/`current_price`: 원 · `*_pct`류: % · `pressure.score`: 0~100점 · `short_squeeze_index`: %(외국인+기관 순매수 ÷ 공매도거래량) · `days_to_cover`: 배수(일) · `net_5d/20d/60d/cumulative`: 주(연기금 순매수, 부호 있음) |
| 시장 범위 | 코스피·코스닥 개별 종목(키움 `ka10014`/`ka20068`/`ka10059`/`ka10013`) — KRX/NXT 구분 명시 없음 |
| 데이터 갱신 주기 | 전일 기준 확정치(일별), 실시간 아님 |
| 캐시 시간 | VM 프로세스 메모리 5분 |
| 호출 예시 | `curl "https://goodbyestar.cloud/investor-flow/005930?name=삼성전자"` |
| 오류 응답 예시 | 데이터 없음 → 404 `{"detail":"해당 종목의 공매도/대차/수급 데이터를 찾을 수 없습니다."}` |

### `GET /news-momentum/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, 기존 VM CORS 정책 적용) |
| 필수 파라미터 | `code` (경로) |
| 파라미터 형식·허용값 | `code`: 문자열, 정확히 6자리 |
| 응답 JSON 구조 | 기존 필드를 유지하고 topic마다 `newsCount`, `recent7dCount`, `previous7dCount`, `changeRate`, `momentumStatus`(`new`/`expanding`/`declining`/`persistent`), `sentimentCounts`(`positive`/`neutral`/`negative`), `netSentiment`, `negativeShare`를 추가한다. 감성 집계 근거가 없는 기존 행은 `sentimentCounts=null`이며 임의의 0건으로 반환하지 않는다. |
| 데이터 단위 | 뉴스 횟수는 중복 제거된 기사 건수이며 감성별 합계는 `newsCount`와 같다. 최근 7일은 기준일 포함 7일, 이전 7일은 8~14일 구간이다. `changeRate`는 이전 7일이 0이면 `null`이다. `latestSearchInterest`/`searchInterestChange`는 NAVER DataLab 상대지수(조회 묶음의 최고 검색량=100)다. |
| 데이터 소스 | `news_momentum_scan.py`가 NAVER 뉴스 제목에서 반복 이슈를 규칙 기반으로 추출하고, 활성 이슈만 NAVER API HUB Search Trend로 확인 |
| 검색어 구성 | DataLab 키워드는 항상 `종목명 + 이슈어` 형태로만 만든다(종목명 단독은 쓰지 않는다 - 검색량은 늘지만 이슈별 변별력이 사라진다). 규칙 라벨은 `ISSUE_SEARCH_TERMS` 표의 짧은 표현을, 표에 없는 라벨은 그 이슈 기사 제목에서 2건 이상 반복된 핵심어를 함께 쓴다. 정도어(증가·확대·돌파 등)와 단위어(조원·억원 등)는 단독 검색어로 쓰지 않는다. 마지막으로 같은 종목의 이슈끼리 겹치는 키워드는 양쪽에서 제거하고, 이슈마다 고유한 `종목명 + 라벨 전체`는 항상 남긴다 |
| 데이터 갱신 주기 | 전 상장종목 대상 이어달리기(`news_momentum_scan.py --full`). 한 회차는 20분 시간 예산까지만 쓰고 `news_momentum_cursor.json`에 커서를 남기며, 기존 5분 배포 타이머가 같은 날 안에서 커서를 이어받아 계속 슬라이스를 돌린다. 하루 호출 예산이 소진되거나 전수 한 바퀴가 끝나면 그날은 종료하고 다음 날 같은 순서로 순환 갱신한다 |
| API 호출 예산 | 네이버 검색 API 한도는 일 25,000회 / 월 775,000건(검색 카테고리 통합). 같은 키를 쓰는 `/naver-news`는 3개 쿼리 × 15분 캐시라 하루 300회 남짓이므로, 배치 예산을 일 22,000회 / 월 680,000회로 두고 남은 쪽이 더 작은 값을 그 회차 상한으로 쓴다. DataLab(Search Trend)은 별개 한도라 하루 900회. 사용량은 KST 일·월 단위로 `news_momentum_cursor.json`에 누적한다 |
| 캐시/DB | 기존 `ohlc_snapshot.db`와 분리된 `news_momentum.db` 즉시 조회. 사용자 요청 시 외부 API 호출 없음 |
| 초기 백필·기준일 | 최신순 뉴스 API를 최대 1,000건까지 페이지 조회해 최근 90일 경계에 도달했는지 저장한다. 화면의 `데이터 기준일`과 `최근 90일 뉴스 백필 완료/부분` 표시는 `coverage` 값에 따른 실제 상태이며, 1,000건 한도로 경계에 못 닿으면 `backfillComplete=false` |
| Feature Flag | `.env`의 `NEWS_MOMENTUM_ENABLED=0`이면 DB를 열지 않고 `enabled:false`, `topics:[]` 반환 |
| 호출 예시 | `curl "https://goodbyestar.cloud/news-momentum/000660"` |
| 빈 데이터 | DB가 아직 없거나 반복 이슈가 없으면 200과 `topics:[]` 반환. 아직 수집 차례가 오지 않은 종목은 `coverage:null`이고, 수집은 됐지만 반복 이슈가 없으면 `coverage`가 채워진 채 `topics:[]`다(화면이 두 상태를 구분해 안내한다) |

### `GET /investor-trend`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | `period`, `market` (둘 다 쿼리) |
| 파라미터 형식·허용값 | `period`: `"day"` \| `"week"` \| `"month"`(기본 `"week"`, 그 외 값은 자동으로 `week`) · `market`: `"kospi"` \| `"kosdaq"`(기본 `"kospi"`, 모르는 값은 자동으로 `kospi`) |
| 응답 JSON 구조 | `data = {"period","market","asOf":"ISO8601"\|null,"rows":[{"label","ind","frgn","orgn"}, ...]}` — `label` 형식은 `period`에 따라 다름: day="MM.DD", week="M월 N주", month="YYYY.MM" |
| 데이터 단위 | `ind`(개인)/`frgn`(외국인)/`orgn`(기관): **억원**(순매수, 부호 있음) |
| 시장 범위 | 코스피=KRX 전체(KIS `iscd=KSP`), 코스닥=KRX 전체(`iscd=KSQ`) — **코스피 선물은 데이터 소스 자체가 없어 미지원** |
| 데이터 갱신 주기 | 1분 주기 백그라운드 폴러가 "오늘" 값 갱신(KIS 1순위 → 네이버(코스피만) 2순위 → 키움 3순위 자동 폴백), 과거 확정일은 SQLite에 최대 140영업일 백필 |
| 캐시 시간 | 엔드포인트 자체는 캐시 없이 SQLite 즉시 조회(실시간 외부 API 호출은 없음 — 신선도는 백그라운드 폴러가 담당) |
| 반환 개수 | day=최근 10개, week=최근 5주, month=최근 6개월 |
| 호출 예시 | `curl "https://goodbyestar.cloud/investor-trend?period=day&market=kosdaq"` |
| 오류 응답 예시 | 내부 계산 실패 시에만 502, 그 외엔 항상 200(알 수 없는 파라미터는 자동 보정) |

### `GET /investor-trend?period=intraday`

2026-10-16 추가. `market=kospi|kosdaq`, 공개·외부 조회 0회. 기존 KIS FHPTJ04040000 폴러의 성공 결과만 저장한다. 응답 `data{period,market,date,intervalMinutes:30,sessionStart:"09:00",sessionEnd:"15:30",slotCount:14,state:ok|no_samples,source,basis,latest,asOf,extrema:{high:{value,slot}|null,low:{value,slot}|null},rows:[{slot,label,ind,frgn,orgn,high,low,asOf}]}`. 금액은 억원, `slot`은 0~13이며 각 30분 구간의 최신 **누적값**이다(구간 매수액 합계가 아님). `asOf`는 KST 수집 시각으로 거래소 체결 시각이 아니다. 고저는 저장된 1분 관측 범위이며 미관측 고저를 보장하지 않는다. 미확보 구간은 누락, 일별 값에서 과거 장중 봉을 복원하지 않는다. 기존 day/week/month 응답은 유지한다.

### `GET /investor-trend/history`

국내시장지표 '04 국내 증시 자금 흐름'(`js/investor-flow.js`)이 쓰는 투자자별 **일별 이력**. `/investor-trend`와 같은 SQLite 테이블(`investor_trend_daily`)을 읽어 날짜 오름차순으로 돌려준다(요청마다 KIS를 부르지 않는다).

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한, IP당 분당 30회) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | `market`(기본 `kospi`, `kospi`\|`kosdaq`, 그 외 422), `days`(기본 260, 5~300, 범위 밖 422) |
| 응답 JSON 구조 | `data = {"market","unit":"억원","source","foreignBasis","asOf":"ISO8601"\|null,"latestDate":"YYYY-MM-DD"\|null,"provisional":bool,"count","requestedDays","from","to","rows":[{"date","individual","foreign","institution","indexClose":number\|null}, ...],"gross":{"supported":false,"reason"}}` |
| 데이터 단위 | `individual`·`foreign`·`institution`: **억원**(순매수, 부호 있음, KIS 응답의 백만원을 100으로 나눔). `foreign`은 **등록 외국인**(`frgn_reg_ntby_pbmn`) 기준. `indexClose`: 업종지수 종가(포인트, 모르면 `null`) |
| 거래일 규칙 | 행은 **거래일만** 있다(주말·휴장일은 행이 없고 0으로 채우지 않음). 세 값이 모두 0인 행은 거래일 자료가 아니라 제외하고, 같은 날짜는 한 행만 둔다. 확보된 기간이 요청 `days`보다 짧으면 `count`로 알 수 있다 |
| `provisional` | 최신 행이 오늘(KST)이고 18:30 이전이면 `true`(장중 누적 또는 마감 직후 잠정치) |
| 세 주체의 합 | 개인+외국인(등록)+기관은 0이 아니다. 2026-10-11 운영 VM 실측(10-06·10-07·10-08 코스피): `prsn + frgn_reg + orgn + etc_corp(기타법인) + frgn_nreg(비등록 외국인) = 0`이 세 날 모두 성립했고 기타법인이 하루 수천억~1조 원 규모로 나머지를 메운다. 그래서 화면은 세 주체 합이 0이 아닌 이유를 기타법인 등으로 안내한다(기타법인은 이 API 응답에 포함하지 않음) |
| 총매수·총매도 | **원자료에 없다.** KIS 시장별 투자자매매동향(일별, `FHPTJ04040000`)은 순매수(수량·대금)와 업종지수만 준다. 그래서 `gross.supported=false`이며 순매수에서 거꾸로 계산하지 않는다. 총액 원자료(공식 소스)가 확인되면 `gross`를 채우는 방식으로 확장한다 |
| 이력 확보 | 시작 시 한 번 `FHPTJ04040000`을 날짜 하나(`DATE_1=DATE_2`)로 호출하면 그 날짜까지 최근 약 300영업일이 한꺼번에 온다(2026-10-12 운영 VM 실측: 코스피·코스닥 모두 2025-07-16~2026-10-08, 날짜 중복 없음). 이후는 기존 1분 폴러가 "오늘" 행만 갱신한다 |
| 캐시 시간 | 30초 메모리 캐시(`market`·`days` 조합별) |
| 호출 예시 | `curl "https://goodbyestar.cloud/investor-trend/history?market=kospi&days=260"` |
| 오류 응답 예시 | 파라미터 오류 422, DB 읽기 실패 시 502(내부 경로·메시지는 노출하지 않음) |

### `GET /investor-trend/stock-ranks`

KIS `FHPTJ04400000` 장중 가집계의 외국인·기관 종목별 순매수·순매도 상위(순매수 수량, 주)를 반환한다. 공식 응답의 종목코드·종목명·투자자별 순매수 수량 필드를 검사하고 유효한 행만 표시한다. 5분 캐시. `individual.supported=false`이며 개인 종목 순위는 표시하지 않는다.

### `GET /futures`

`stored_only=true`는 DB에 이미 저장된 시세·이력과30초 응답 캐시만 읽는다. 환율 현재가 보강 외부 호출을 생략하며 일반 응답과 캐시 키를 분리한다. 미수집 가격은 null이고 원래 기준시각을 보존한다. 응답 헤더 `X-Market-Read-Mode: stored`로 적용 여부를 확인할 수 있다. 반복 화면 갱신용이며 수집 주기를 변경하지 않는다. 기본값 false의 기존 동작은 유지한다.

미국 경제 발표 탭의 수동 갱신은 `PUT /futures/refresh-macro`로 FRED 거시지표 11종 수집을 요청한다. 응답 `data`에는 `running`, `started_at`(Unix 초), `checked_at`(UTC ISO), `success`·`failed`(확인한 계열 수), `error`가 있다. 진행 상태는 `GET /futures/refresh-macro`로 읽는다. 동시 요청은 한 작업으로 합치고 시작 간격은 서버 전체에서 최소 5분이다. 공개 라우트이며 기존 CORS와 IP별 요청 제한을 적용한다. 수집이 끝나면 `/futures`의 30초 메모리 캐시를 비운다. 발표가 없으면 기존 관측값이 유지된다.

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | `interval`, `days`, `symbols` (모두 쿼리) |
| 파라미터 형식·허용값 | `interval`: `"day"`(기본) \| `"minute"`(코스피200 주/야간선물처럼 `domestic_futures.MINUTE_SYMBOLS`에 있는 심볼만 실제 분봉 적용, 나머지는 그대로 일봉) · `days`: 정수, 1~500로 clamp(기본 90) · `symbols`: 쉼표로 구분한 지원 심볼만 선택(미지정 시 전체) |
| 응답 JSON 구조 | `data = [{"symbol","name","price","change","change_rate","high","low","updated_at","source","source_delay","contract_code","stale","oi","oi_change","chart":[...]}, ...]` — 기존 심볼에 `BRENT` 추가. WTI·GOLD·BRENT의 출처와 지연 확인 상태를 명시하며, BRENT 시세가 20분 넘게 오래되면 `stale=true`와 가격 `null`을 반환한다. |
| 데이터 단위 | 지수류는 포인트, 환율은 원, 채권금리·실업률·실질 GDP 성장률은 %, CPI·근원 CPI·근원 PCE·PPI·소비심리는 지수, 비농업고용·JOLTS 구인건수는 천 건, 소매판매는 백만 달러, 원자재/코인은 해당 통화 그대로. `US_PPI_FINAL_DEMAND`는 FRED `PPIFIS`(BLS 최종수요·계절조정), 기존 `US_PPI`는 별도 전 품목 `PPIACO`다. `oi`(미결제약정)는 코스피200 야간선물(`KOSPI200_NIGHT`)만 값이 있고 나머지는 `null` |
| 시장 범위 | 국내(코스피/코스닥/코스피200 주간·야간선물) + 해외(미국 지수 3종 현물·선물, SOX, VIX, WTI, 금, ICE 브렌트유) + 환율 + 국채금리 + FRED 거시지표 + 가상자산(BTC/ETH). 원자재별 출처·권한 검증은 [COMMODITY_SOURCES](docs/COMMODITY_SOURCES.md) 참고 |
| 데이터 갱신 주기 | 백그라운드 수집기가 심볼별로 상시 수집(수집 주기는 심볼마다 다름 — `foreign_futures.py`/`domestic_futures.py`/`btc_futures.py`/`bond_yield.py` 각각 확인 필요) |
| 캐시 시간 | 10초 메모리 캐시(조회 조건별) — 원본 최신 시각은 수집 주기를 따름 |
| 호출 예시 | `curl "https://goodbyestar.cloud/futures?interval=day&days=180"` |
| 오류 응답 예시 | 없음 — 데이터가 없는 심볼은 필드가 `null`일 뿐 요청 자체는 항상 200 |


시장지표 5년 차트는 이 API의 행 수를 늘리지 않고 Pages 정적 이력과 브라우저에서 합친다. [자료·용량·갱신](docs/MARKET_CHART_HISTORY.md).

### `GET /order-book/{code}`

2026-10-21: 응답의 `available`은 양쪽 중 한쪽이라도 유효 가격이 있는지를 뜻한다. `status`는 `available/preopen/closed/unavailable`, `session`은 `preopen/closed/open`, `checkedAt`은 조회 완료 시각(호가 발생 시각 아님), `note`는 안내다. 운영시간 중 KIS0원 호가는 키움으로 재조회하며 장전/장외에는 불필요한 대체 조회를 추가하지 않는다. 07시대 LG전자/삼성전자/한화오션 KIS UN/J/NX 및 키움 직접조회가 모두0원임을 확인했다. 장전에는 NXT 대상08:00/KRX08:30 접수 안내를 표시하며 실호가가 있다고 주장하지 않는다.

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | 없음 |
| 파라미터 형식·허용값 | `code`: 6자리 |
| 응답 JSON 구조 | `data = {"code","asks":[{"price","qty"}, ...최대10, 가격 내림차순],"bids":[{"price","qty"}, ...최대10, 내림차순],"totalAskQty","totalBidQty","stexTp","trade":{"time","price","qty","up","down"}\|null,"strength":{"value","value5min","value20min","value60min","stexTp"}\|null}` |
| 데이터 단위 | `price`: 원 · `qty`/`totalAskQty`/`totalBidQty`: 주 · `strength.*`: % (100=매수/매도 균형, ka10046 실측 확인) |
| 시장 범위 | 명시 없음(ka10004/ka10003/ka10046). **미검증 주의**: 매도1~5차선·매수 전체 필드명이 문서에 없어 명명규칙을 확장 추정한 값 — 응답이 계속 비면 VM 로그(`order_book.py`의 "호가 필드를 하나도 못 찾음" 경고)로 확인 필요. `strength`는 장 시간 외엔 최근 틱이 없어 정상적으로 `null`(js/order-book.js가 그럴 땐 매도벽 소진 근사치로 폴백). 2026-08-05: KRX+NXT 통합 호가를 시도하려고 종목코드에 `_AL` 접미사를 붙여 우선 호출하고(미검증, 사용자 제공 안내) 빈 응답이면 원래 코드로 자동 재시도 - `stexTp`(거래소구분) 값으로 실제 통합됐는지 확인 가능 |
| 데이터 갱신 주기 | 실시간 — 호출마다 키움 라이브 조회, 프론트는 2초 간격 폴링 |
| 캐시 시간 | 서버 메모리 1.5초(동시 다중 요청을 키움 호출 1번으로 묶기 위함) |
| 호출 예시 | `curl "https://goodbyestar.cloud/order-book/005930"` |
| 오류 응답 예시 | 키움 호출 실패 → 502(명시적 404 없음) |

### `GET /market-rank`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | `limit` (쿼리) |
| 파라미터 형식·허용값 | `limit`: 정수, `1` ~ `20`(기본 5) |
| 응답 JSON 구조 | `data = {"tradeVolume":[{"code","name","price","change_rate","trade_volume"}, ...×limit],"upperLimit":[{"code","name","price","change_rate"}, ...×limit],"lowerLimit":[{"code","name","price","change_rate"}, ...×limit]}` |
| 데이터 단위 | `price`: 원 · `change_rate`: % · `trade_volume`: 주(원시값, 환산 없음) |
| 시장 범위 | 전체 시장(`mrkt_tp='000'`), KRX+NXT **통합**(`stex_tp='3'`) |
| 데이터 갱신 주기 | 서버 캐시 TTL과 동일(30초) |
| 캐시 시간 | 서버 메모리 30초, **`limit` 값별로 독립 캐시**(5와 20은 서로 다른 캐시 슬롯) |
| 호출 예시 | `curl "https://goodbyestar.cloud/market-rank?limit=10"` |
| 오류 응답 예시 | 키움 호출 실패 → 502 |

### `GET /sector-quotes?codes=005930,000660`

카테고리 모니터링 공개 시세. 최대 300개 6자리 코드·중복 제거·IP 분당20회.
`data` 배열의 `code,name,price,change,changeRate,volume,market,time`은 `/domestic-quotes`와 동일하다.
기존 5초/300종목 캐시·전체 다운로드 잠금을 공유하고 누락 종목만 60개씩 최대4배치 병렬 조회한다.
새 폴러·DB 없음. 기존 `/domestic-quotes`는 30코드·분당60회 제한을 유지한다.

### `GET /option-flow`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | 없음 |
| 응답 JSON 구조 | `data = {"CALL":{"side":"CALL","volume","oi","oi_change","updated_at"},"PUT":{"side":"PUT","volume","oi","oi_change","updated_at"}}` |
| 데이터 단위 | `volume`/`oi`/`oi_change`: 계약수(KIS가 반환한 콜·풋 각 최대100행 합산, 전체시장 합계 아님) |
| 시장 범위 | 코스피200 옵션, 최근월물 자동 판별(매월 둘째주 목요일(휴장일이면 직전 거래일) 15:20 KST 만기 기준) |
| 데이터 갱신 주기 | 5분 주기 백그라운드 폴러(KIS `FHPIF05030100`) |
| 캐시 시간 | 엔드포인트 자체 캐시 없음(SQLite 즉시 읽기) — 5분 수집 주기가 곧 갱신 주기 |
| 호출 예시 | `curl "https://goodbyestar.cloud/option-flow"` |
| 오류 응답 예시 | 없음 — `KIS_APPKEY`/`APPSECRET` 미설정 시 데이터가 비어있을 수 있으나 에러는 아님 |

---

## 그 외 라우트 (요약)

| Method | Endpoint | 인증 | 캐시/갱신 | 비고 |
|---|---|---|---|---|
| GET | `/health` | 불필요 | - | 헬스체크, `{"status":"ok"}` + 배포 확인용 `deployedCommit`(deploy_check.sh가 처리한 master SHA)·`deployRecordedAt`·`processStartedAt`(2026-09-15) |
| GET | `/health/load` | 불필요 | - | VM 부하 스냅샷(읽기 전용): load average, 메모리·스왑, FastAPI 스레드별 누적 CPU 초, 다른 파이썬 프로세스(스캔 등)의 스크립트 이름·RSS·누적 CPU 초. 두 번 불러 차이로 본다(2026-09-15) |
| GET | `/health/scanner` | 불필요 | 메모리/로컬 상태 읽기 | 스캐너 순위 읽기 함수 호출·오류/시간·메모리 캐시 적중/미적중·전체 수신 후보 대비 기존20칸 누락 관찰. `mode:observation-only`, 원천시각 미확인=null, 부분장애 누락률=null. 매매 후보/구독 변경 없음. 프로세스별 계수는 재시작 시 초기화. [정의·제약](docs/SCANNER_EFFICIENCY_2026-10-20.md) |
| GET | `/futures/avg` | 불필요 | 없음(즉시계산) | 쿼리 `symbol`(필수) · `days`(1~1000, 기본365) - 지정 심볼의 장기평균/최고/최저 |
| GET | `/naver-news` | **필요** | 없음 | 쿼리 `query`(필수, 1~100자) - 네이버 뉴스검색 프록시, 호출마다 네이버 API 쿼터 소모 |
| GET | `/investor-flow-batch` | **필요** | 하루 1회(`batch_scan.py`) | 섹터 풀(238종목) 공매도/대차/연기금 배치 캐시 |
| GET | `/fundamentals-batch` | **필요** | 하루 1회(`batch_scan.py`) | DART 재무제표(5년 추세+최근분기) 전종목 배치 캐시 - 배치 소비자 전용 |
| GET | `/fundamentals/{code}` | **필요** | 하루 1회(`batch_scan.py`) | 위 캐시에서 해당 종목만 잘라 반환(`{code, fundamentals, fetchedAt}`). 종목분석 펀더멘탈 탭용 단건 조회 - 캐시에 없으면 `fundamentals: null` |
| GET | `/fundamentals-meta` | **필요** | 배치 저장 시 | `{generatedAt}` - GAS 종목별 펀더멘탈 캐시 키(갱신 시각 기반 무효화)용 |
| GET | `/earnings-calendar?year=YYYY&month=M` | 불필요 | 10분 메모리 캐시 | DART 거래소 공시 중 실제 접수된 잠정실적/실적 공시를 캘린더 이벤트로 반환. `DART_API_KEY`가 없으면 빈 배열. 미국(Finnhub) 실적은 S&P 100만 반환(2026-10-04, 저장소에 남은 이전 소형주 일정도 읽을 때 제외) |
| GET | `/weekly-report` | 불필요 | 15분 메모리 캐시 | 완료된 월~금의 KOSPI·KOSDAQ·나스닥·S&P500·환율 추이, 국내·미국 뉴스, 순위(KIS/키움)에 오른 종목을 후보 풀로 모아 이번 주(월~금) 등락률 +3%↑/-3%↓로 다시 고른 주목 종목(`hotStocks`/`coldStocks`, 항목 `changeRate`=주간·`dayChangeRate`=마지막 거래일, `period.{domestic,us}`='week'|'lastDay'; 주간 일봉을 못 받은 시장만 마지막 거래일 순위 방식, 2026-10-18)·다음 주 후보(`hotCandidates`/`coldCandidates`), 다음 주 실적 일정을 반환. 후보는 상승·하락 방향과 거래량·체결강도·거래대금·회전율 등 독립 신호가 겹친 종목을 선별하며 가격 예측값이 아니다. KIS 실패 시 키움 순위로 폴백 |
| GET | `/weekend-us-themes` | 불필요 | 30분 메모리 캐시 | 2026-10-04 신설. 토요일 06:00 이상~월요일 06:00 미만(KST)에 발행된 미국 일반 뉴스 제목에서 테마 키워드(AI·반도체, 에너지·원유, 방산·지정학, 금리·연준 등 11개) 언급 기사 수를 세어 상위 8개를 반환: `themes[{key,name,risk,count,headlines[{title,link,source,pubDate}],usTickers,krSectors,krStocks[{name,code,sector}]}]`·`articleCount`·`basis`. 발행시각이 확인되지 않는 기사는 제외한다. 호재·악재 판단은 하지 않으며 국내 종목은 운영 섹터 분류(`sector_cards`)의 앞 종목. `/weekly-report` 주 단위 스냅샷과 분리해 주말 동안 갱신 |
| GET | `/stock-members/{code}` | 불필요 | 장중 30초·장 밖 10분 메모리 캐시 | 2026-10-04 신설. 종목분석 "거래원 매매 상위". KIS 주식현재가 회원사(`FHKST01010600`, KRX) 매수·매도 상위 5 거래원: `buy`/`sell[{rank,name,code,qty(주),share,change,foreign}]`·`foreign{buyQty,sellQty,netQty}`(외국계 합계)·`asOf`(조회 시각 KST). `share`·`change` 단위는 실측 전 |
| GET | `/us-sector-rotation` | 불필요 | 15분 메모리 캐시 | 2026-10-05 신설. 미국장 업종 로테이션: SPDR 섹터 ETF 11개(XLK·XLC·XLY·XLF·XLV·XLI·XLE·XLP·XLB·XLU·XLRE)를 SPY 대비 5·20일 상대수익, 5일 순위 변화, 거래대금 강도, ETF 20일 평균 위 여부로 `sector_rotation.classify_phase` 분류. 응답 모양은 `/sector-rotation`과 같고 `market:'us'`, 항목에 `ticker`·`aboveMa20`(Breadth 칸은 null). 일봉은 `us_stocks.chart` daily(Yahoo) |
| GET | `/us-etf-returns` | 불필요 | 15분 메모리 캐시 | 2026-10-05 신설. 주요 ETF 8종(SPY·QQQ·DIA·IWM·SOXX·SCHD·TLT·GLD) `items[{symbol,name,close,date,return1d,return1w(5거래일),return1m(21거래일),returnYtd(직전 연도 마지막 종가 대비)}]` |
| GET | `/daily-scan-batch` | **필요** | 하루 1회(`daily_scan.py`) | 차트패턴·눌림목·투자시그널 전종목 스캔 결과 |

`/daily-scan-batch`의 `data.investSignal.buckets[등급]`은 전종목 검색·정렬용으로 최대
3,000개를 보존한다. 각 항목은
`[code, name, price, changeRate, stars, totalScore, tradingValue]` 순서이며
`price`는 원, `changeRate`는 %, `totalScore`는 0~100점, `tradingValue`는 원 단위
`종가×거래량`이다. 앞 5개 필드 순서는 구버전과 동일하다.
| GET | `/week52-batch` | **필요** | 하루 1회(`week52_scan.py`) | 섹터 풀 52주 신고가/신저가 캐시 |

---

## 현재 운영 라우트 보충

아래 경로는 최신 운영 기능이며, 필드 상세는 실제 `/openapi.json`과 소스의 Pydantic/
dict 구성을 함께 대조한다.

| Method | Endpoint | 인증 | 역할 |
|---|---|---|---|
| GET | `/domestic-news` | 없음 | 국내 일반뉴스·DART 공시 |
| GET | `/foreign-news` | 없음 | 미국·글로벌 일반뉴스 |
| GET | `/market-board` | 없음 | 시장별 실시간 종목판·업종 TOP |
| GET | `/health/realtime` | 없음 | KIS·키움 공유 허브와 `ninePayResearch`(후보·순위 오류·거래량 이벤트·KIS 폴백·신호; `NINEPAY_RESEARCH_ENABLED=1`일 때 동작). A/B 계약: `ruleVersion=ab70-v1`, `items`에 후보명·가격·70% 최초 관측·80% 우선·갭·저점·눌림·단계·신호·결측. `at`는 수신 시각, `orderStatus=미연동`. [필드·조건·저장 상세](docs/NINEPAY_SCANNER_AB_2026-10-19.md) |
| GET | `/health/9pay` | 없음 | PC 전용 경량 피드. 같은 `data.ninePayResearch`의 running/active/ruleVersion/rankAt/rankError/amountFallback/queueDropped/persistenceError와 신호 근거11필드를 반환한다. 비동기 핸들러·메모리 읽기만 사용하며 주문/계좌/새 외부 조회는 없다 |
| GET | `/theme-flow` | 없음 | 국내 주요종목 "오늘 돈이 몰린 섹터" - 키움 테마(ka90001/ka90002) 등락률 상위 20개, 거래대금 순, 3분 백그라운드 2026-10-23: 행마다 `rank`·`prev_rank`·`rank_change`(양수=순위 상승, null=NEW 또는 비교 불가)·`rank_basis`(직전 갱신 시각, 같은 거래일만 비교) 추가, 테마 안 같은 종목코드 중복 합산 제거 |
| GET | `/morning-briefing` | 없음 | **시장 브리핑**(국내 거래일 07:00 서버 확정 스냅샷) `{serverTime,today,session{phase,tradingDay,openAt,closeAt,postCloseMinutes,nextTradingDay},briefing{targetDate,targetLabel,status(final/pending/failed),scheduledAt,firstConfirmedAt,revisedAt,revision,revisions[],attempts,nextRetryAt,lastError,snapshot{inputs,night,signal,usHoliday,usHolidayAssumed}}|null,next{targetDate,targetLabel,scheduledAt}}`. 선택 `?date=YYYY-MM-DD`. DB 읽기만(요청이 계산하지 않음), 확정본 `max-age=30`/그 외 `no-store`. 상세 `docs/MARKET_BRIEFING_AND_LIVE_2026-10-23.md` |
| POST | `/morning-briefing/revise` | `x-api-key` | 운영자 복구: `?date=YYYY-MM-DD&reason=` 그 거래일 브리핑 재계산·정정(최초 확정 시각 유지, 정정 시각·사유 기록) |
| GET | `/ai-comments` | 없음 | **AI 시장 코멘트**(증시온도 카드별 한 줄 해설, 서버가 생성·검증해 저장한 확정본) `{serverTime,tradeDate,promptVersion,comments{slot:{text,group,generatedAt,dataAsOf,tradeDate,model,carried}},hidden{slot:사유(state-changed/data-missing/too-old)}}`. slot: spx nas dji sox vix night brief_summary / kospi_volume kosdaq_volume breadth foreign institution individual program putcall market_summary / credit deposits / rate fx oil gold btc. DB 읽기만(AI 호출·계산 없음), `max-age=30`. 상세 `docs/AI_MARKET_COMMENTS_2026-10-23.md` |
| GET | `/health/ai-comments` | 없음 | AI 코멘트 상태(비밀 없음): `state`(정상/대기/오류/꺼짐), `callsToday`·`tokensToday`와 상한, 묶음별 `lastSuccessAt`·`lastRun`·`consecutiveFailures`, `visibleComments`, `hiddenComments`. `/health/schedules.internalJobs`에도 요약 |
| GET | `/money-picks` | 없음 | 증시온도 '돈이 몰린 섹터' 대표 종목의 최근 14일 기록 `{history:[{date,code,name,theme,rank,rec_price}],windowDays,recordAfter,perTheme}`. 기준가만 주며 수익률은 화면이 현재가로 계산 |
| GET | `/theme-list` | 없음 | 키움 전체 테마 목록 `{themes:[{code,name,stock_count,change_rate}],count}`(카테고리 추가 후보, 3분 백그라운드 값) |
| GET | `/theme-stocks?code=` | 없음 | 한 테마의 구성종목 `{code,stocks:[{code,name,price,change_rate}]}`. 목록에 있는 테마코드만, 3분 캐시, 시장(KOSPI/KOSDAQ) 구분 없음 |
| GET | `/binance-kr-equity` | 없음 | 바이낸스 국내주식 토큰(SAMSUNGUSDT·SKHYNIXUSDT) 참고 시세: 가격(USDT)·24시간 등락·마크가격·펀딩비·1시간 종가 48개. 국내 장 닫힘 5분/장중 30분 백그라운드, 451이면 `restricted`. 2026-09-15부터 화면은 방문자 브라우저가 `fapi.binance.com`을 직접 조회하고(CORS 허용) 이 엔드포인트는 폴백 |
| GET | `/api/circuit-breaker` | 없음 | 메인페이지 VI·사이드카 배지 캐시(2026-10-15 `market_halt{available,reason(NO_VERIFIED_SOURCE|STALE),events[{id,market,kind(SIDECAR|CIRCUIT_BREAKER),stage,status(active|released|resumed),triggered_at,released_at,resumed_at}],active_count,note}` 추가: 시장 전체 사이드카·서킷브레이커. 확인된 공식 수신 경로가 없어 현재 `available=false`=확인 불가이며 `ingest_market_halt()`로만 채워진다. 가격 급락으로 추정하지 않음). 2026-10-15부터 한국거래소 KIND 시장조치 공시를 30초마다 확인해 채운다(`source`·`source_url`·`delay_note`·`received_at`, 공시 기준이며 실시간 체결 데이터가 아님; 이벤트 `direction`·`change_pct`·`ends_at`·`basis=DURATION_ELAPSED`·`time_precision`). 상세 `docs/MARKET_HALT_KIND.md`. `sidecar{available,active,market,triggered_at,note}`, `vi_active_count`, `vi_list[{code,name,status(active|released),triggered_at,released_at}]`(최근 발동 순 최대 10, 해제 후 5분까지), `fetchedAt`, `error`. 서버가 KIS 변동성완화장치(VI) 현황(FHPST01390000)을 거래일 08:55~15:35·15:55~20:05에 20초마다 1회 조회. 사이드카는 확인된 출처가 없어 `available=false` |
| GET | `/volume-surge-live` | 없음 | (2026-10-15 확장: 같은 목록에 실시간 매집 의심·기존 매집봉 재상승 신호를 종목별 한 행으로 합침 - `items[].patternDetail.signals[{type(EARLY_PACE|REALTIME_ACCUM|OLD_BAR_REBREAK),label,status,score,rvol|volumeMultiple,distribution{risk,flags},reasons}]`·`distribution`·`volumeMultiple`, 응답에 `dataBasis{realtime,realtimeNote,dailyNote}`. RVOL은 20일 평균 대비 단순 시간비례 근사이며 5분봉은 이 감시의 30초 표본으로 만든다. `/pattern-scan`의 `patterns.volumeBreakout`도 일봉 스캔의 기존 매집봉(`accumulationBar`)과 합쳐 같은 모양으로 내려가며 새 응답 키는 없다.) 차트검색 "거래량 돌파" 탭의 장중 사전포착 목록(서버 메모리). `items[]`는 `/pattern-scan` 패턴 행과 같은 모양(`price`=감지가, `patternDetail.status` early|moving·`pace3`·`gainSinceDetectPct`), `ranCount`(감지 후 +6% 이상 올라 제외), `expiredCount`, `active`, `updatedAt`, `intervalSec`. 평일 09:00~15:35에 30초마다 KIS 거래량·거래증가율·거래대금·상승률 순위(ETF 제외)를 읽어 "최근 3분 거래량이 전일 거래량의 3% 이상(3분 환산)이면서 등락률 +5% 이하"인 종목을 감지. 순위권 밖 종목은 놓칠 수 있음 |
| GET | `/gap-shadow` | 없음 | (2026-10-16, Issue #697) 아침 라이브 갭상승 **그림자 검색기**의 규칙·성과 요약·최근 신호. 읽기 전용, 주문·계좌 없음, 요청 제한 30/분. 응답 `rules{openObsEnd,orEnd,signalEnd,gapPct,cumVolumeRatioMin,maxStopPct,costPct}`, `summary{signals,entered,costPct,minSample,byHorizon{D0|D1|D3|D5{all|riskOk × withStop|noStop → n,enough,expectancyNetPct,medianNetPct,winRatePct,avgWinPct,avgLossPct,payoffRatio,expectancyR,reach15Pct,stoppedPct,worstNetPct,expectancyNetExTopPct}},note}`, `recent[]`(신호·진입 시각/가격, 시초 관측가, 첫 5분 고저, 손절 후보가·손절폭, 장중 MAE/MFE 관측). 기존 `openingGap`(일봉 배치)은 대체하지 않고 별도로 유지. 시초가·고저가는 순위 응답에 필드가 없어 30초 관측가이며 공식 OHLC가 아니다. 표본 15건 미만은 `enough=false`(결론으로 쓰지 않는다). 사후 리뷰 보완(2026-10-16): `summary.byHorizon`에 `complete_*`·`completeRiskOk_*`(진입 뒤 30초 관측이 장 마감까지 120초 간격 안에서 이어진 건만) 추가, `summary.observation{entryMissing,entryMissingPct,pathComplete,pathIncomplete,forwardFromSignalPrice{entered|entryMissing → D0|D1}}`(순위권 이탈로 진입이 누락된 신호와 선택 편향 점검), `summary.openObsVsOfficial`(30초 시초 관측가 대 D0 일봉 시가 차이), `runtime{date,polls,lastObserveAt,watched,statusCounts}`(오늘 이 프로세스가 본 것, 재시작 시 초기화), `rules.stopRule`(손절은 시초 범위 저가이며 실계좌 -3%·2회 확인과 다름) |
| GET | `/industry-flow` | 없음 | 증시온도 업종 TOP 10(테마별 거래대금·평균등락·대표 종목). 증시온도 백그라운드 계산(3분)의 저장값을 서빙. `previousDate`·`previousRanks`(`{테마: 순위}`)는 직전 거래일 순위로, 비교할 날이 없거나 배포 직후 옛 캐시면 `null` |
| GET | `/domestic-market-indicators` | 없음 | 국내시장 요약 지표 |
| GET | `/kofia-market` | 없음 | 신용·예탁금·반대매매 보조지표 |
| GET | `/strategy-scan-batch` | API 키 | 전략검색 캐시 |
| GET | `/scan-performance` | API 키 | 스캔 히트 종목의 D+N 사후 수익률 |
| GET | `/flow-chart/{code}` | 없음 | 종목분석 가격차트(일봉+MA+지지/저항) |

`/flow-chart/{code}`는 기존과 같이 최근 500봉을 반환한다. `?history=5y`는 종목별 SQLite 이력을 우선 사용하고 부족할 때만 키움 수정주가 일봉을 연속조회하며, 실제 확보한 날짜 범위(최대 1,550봉)를 반환한다. `historyAttempted`는 장기 조회가 실제 완료됐는지만 나타내며 5년 분량 확보를 뜻하지 않는다. 공급자 장애 시 저장된 일봉을 반환한다.
| GET | `/invest-signal` | 없음 | 종목분석 차트 흐름별 탐색(`/daily-scan-batch`를 GAS와 같은 형태로 재포장) |
| GET | `/sector-rotation`, `/sector-rotation/{업종}` | 없음 | 업종 로테이션(유입 `emerging`·주도 `leading`·둔화 `weakening`·이탈 `lagging`·중립 `neutral`, 각 항목 `rank`·`rank5DaysAgo`·`rankChange5d`(양수=순위 상승)·`rs5`·`rs20`·퍼센타일·Breadth·`tradingValueRatio`·`rotationScore`). 일봉 확정값 서버 계산, 5분 캐시. `map`은 Rotation Map용 `{sector,x=rs20,y=rs5,phase}`. 상세는 대표 강세 종목 `leaders` 포함 |
| GET | `/pattern-scan` | 없음 | 차트검색 패턴별 목록(`/daily-scan-batch`를 GAS와 같은 형태로 재포장) |

| GET | `/etf-components/{code}` | 없음 | ETF 구성종목 |
| GET | `/us-search`, `/us-quote/{symbol}`, `/us-quotes?symbols=AAPL,MSFT`, `/us-orderbook/{symbol}` | 없음 | 미국 검색·단건/일괄 시세·호가 |

미국 단건/일괄 시세의 기존 `price/change/change_rate/previous_close`는 브로커의 최신가·전일 대비 계약을 유지한다. 애프터마켓에는 `regular_session{price,previous_close,change,change_rate,as_of,session_date,source}`와 `session_change/session_change_rate`를 추가한다. 당일 정규장 종가는 Yahoo chart 메타데이터로 보강(종목/뉴욕 날짜/마감 시각 검증, 성공·실패 모두 5분 메모리 캐시), 시간외 가격은 기존 KIS→키움 우선순위를 유지한다. 시간외 등락은 이 정규장 종가 대비이며 기준 확인 실패 시 새 필드는 null이다. 웹은 이 기준을 사용하고 정규장 종가·등락도 함께 표시한다. Yahoo 최종 폴백에 postMarketPrice가 없으면 실제 시간외 5분봉 종가를 사용하며 시간외 데이터도 없으면 정규장 마감으로 표시한다.

| GET | `/us-options/{symbol}` | 없음 | 미국 종목 가장 가까운 만기(당일이면 0DTE)의 행사가별 감마 노출 요약. Cboe 지연 시세 공개 JSON 기반, 결과만 캐시(장중 5분·장외 30분·옵션 없음/4MB 초과 1시간). 행사가별 `call/put`(감마 노출 백만$)·`*_oi`·`*_vol`과 `as_of`(Cboe 기준 시각 epoch초) 포함 |
| GET | `/us-chart/{symbol}`, `/us-news/{symbol}`, `/us-analysis/{symbol}` | 없음 | 미국 차트·뉴스·분석. 분석 v3의 `summary.insider`는 최근90일 비파생 P/S 매수·매도와 기타 변동/공시일/원문을 구분. `summary.analyst_ratings`는 월별 추천 집계와 별도이며 `access_denied`는 기관별 자료 미확보를 뜻함. 상세: `docs/US_ANALYSIS_REVIEW_2026-10-20.md` |
| GET/PUT | `/watchlist` | Google 세션 | 관심종목 조회·저장 |
| GET | `/watchlist/disclosures` | Google 세션 | 관심종목 최근 7일 DART 공시 |
| GET/PUT | `/memo` | Google 세션 | 메모 목록 조회·저장(종목별/자유 메모, `user_memos` 1행 JSON 배열 - watchlist_configs와 같은 패턴) |
| GET/PUT | `/sector-cards` | GET 공개 / PUT 관리자 | 공용 증시온도 카드 |
| GET/PUT/DELETE | `/sector-cards/me` | Google 세션 | 개인 카드 설정 |
| GET/PUT | `/top-picks/me` | Google 세션 | 국내 주요종목 '추가 종목' 목록 동기화. GET `{picks: [...]|null}`(null=미동기화), PUT `{picks:[{code,name,price?,change_rate?}]}`(6자리 코드·최대 100개·마지막 저장 우선) |
| GET | `/auth/google/start`, `/auth/google/callback`, `/auth/google/me`, `/auth/google/logout` | OAuth | Google 로그인 흐름. `me`는 `provider`(`google`/`naver`)·`naverConfigured`도 반환 |
| GET | `/auth/naver/start`, `/auth/naver/callback` | OAuth | 네이버 로그인(2026-10-04). 세션 쿠키·`me`·`logout`은 Google과 공용, `sub=naver:<id>`, 관리자 권한 없음 |
| WS | `/ws/quotes` | Origin 확인 | 국내·미국 실시간 종목판 |
| WS | `/ws/economic-news` | Origin 확인 | 시장별 경제 종합뉴스 push |

국내 KIS `/ws/quotes`의 `type:quote`에는 개별 체결을 수신한 경우에만 선택적
`trade:{time,date,price,qty,direction,directionSource,market}`가 추가된다. `date`는
원본 영업일자(없으면 빈 문자열)이며 `qty`는 원본
`CNTG_VOL`(주), 기존 최상위 `volume`은 당일 누적량이다. KRX 체결구분 1/5는
`directionSource:provider`, 통합/NXT는 동시 최우선 호가로만 `estimate`, 그 밖은
`unknown`이다. 키움·REST 폴백에는 `trade`가 없으며, 원본 이벤트 ID도 없어
실시간 수신 목록의 중복·누락을 완전하게 판별할 수 없다. `/order-book/{code}`의
`trade.up/down`은 여전히 전일 종가 대비 방향인 REST 표본이며 체결 주도 방향이 아니다.

`patterns.firstPullbackBreakout`은 일봉 **첫 눌림 재돌파** 목록이다. 기존 `patterns.pullback`의 화면 이름은 **이평선 눌림**이며 키·조건은 유지한다. `firstPullbackBreakoutReady`는 최초 검색 완료 여부(미완료와 후보 없음 구분)다. 새 검색기의 조건·필드·공통 배치/추적 규칙은 [FIRST_PULLBACK_BREAKOUT.md](docs/FIRST_PULLBACK_BREAKOUT.md)를 참고한다.

`/pattern-scan`의 `patterns`는 `risingLows`·`shortTermMaBreakout`·`maCloudBreakout`·`doubleBottom`·`invHeadShoulders`·`boxRangeLow`·`pullback`·`firstPullbackBreakout`·`angleMomentum`·`gongpasan`·`volumeBreakout`(+화면에서 숨긴 `openingGap`) 12개 키를 항상 리스트로 내려준다(2026-10-15에 `shortTermMaBreakout`이 응답에서 빠져 있던 것을 추가). `gongpasanStages`는 급락 후 첫 눌림목 1~3단계(WATCH_ACCUM·BREAKOUT·WAIT_PULLBACK) 관찰 후보다(`status` ok|stale, `asOf` 일봉 기준일, `counts` 단계별 전체 건수, `stages` 단계별 상위 30건, 항목의 `score`는 null). 최종 신호는 `patterns.gongpasan`(지지 확인)뿐이다. `angleMomentumScannedAt`·`gongpasanScannedAt`은 일봉 배치 뒤 직렬 실행되는 두 스캔의 완료 시각이다.

`/pattern-scan`의 `patterns.volumeBreakout`은 다른 탭과 달리 **장중 09:05 KST 스냅샷**이다
(`volume_breakout_scan.py`, 평일 전용 systemd 타이머). "전일 거래량을 개장 10분 만에
넘었는가"는 그 시각에만 확정되는 조건이라 장 마감 뒤 도는 `daily_scan.py`로는 알 수 없다.
스캔 시각이 다른 탭과 달라 `volumeBreakoutScannedAt`을 따로 내려준다. 후보는 KIS 순위
API의 당일 거래량·거래대금·거래증가율 상위 목록(섹션당 최대 40)이라 **완전 탐색이 아니다**.

`/invest-signal`, `/pattern-scan`은 브라우저가 GAS를 거치지 않고 직접 부르는 공개 경로다
(`/flow-chart/{code}`와 같은 모델 - X-API-Key 없이 CORS로 블로그 도메인만 허용하고
레이트리밋 분당 30회). 응답은 `gas/ticker-proxy.gs`의 `getInvestSignalResult()`/
`getPatternScanResult()`와 **같은 형태여야 한다** - 프론트가 두 경로를 같은 렌더 함수로
그리고 VM이 막히면 GAS로 폴백하기 때문이다. 데이터는 `/daily-scan-batch`와 같은
`daily_scan_cache.json`이고 mtime이 바뀔 때만 재파싱해 메모리에 둔다.

`/ws/economic-news` 서버 캐시/브로드캐스트 주기는 각각 4분/5분이며, 화면 속보 한 건
전환 5초는 프론트 동작이다. `/ws/quotes`는 동시 연결 상한 200을 적용한다. 자세한 운영
규칙과 오류 대응은 `docs/API_OPERATION_SPEC.md`를 기준으로 한다.

---

## 참고

- 원본 소스: `scripts/cloud-vm/main.py` + `kiwoom_client.py`/`kiwoom_market.py`/
  `foreign_flow_compute.py`/`investor_flow.py`/`investor_trend.py`/`order_book.py`/
  `market_rank.py`/`option_flow.py`/`db_schema.py`
- 인프라 전체 그림은 `ARCHITECTURE.md`, 심화 구조는 `docs/ARCHITECTURE_SPEC.md`,
  DB/캐시는 `docs/DB_SPEC.md`, 사이트 기능별 이력은 `CLAUDE.md` 참고
- **"미검증" 표시가 있는 필드(호가 필드명, `/quote`의 `mac` 단위 등)는 실제 응답을 한 번
  받아서 대조해보고 쓸 것** — 공식 문서가 필드 목록을 자르거나 단위를 명시하지 않는 경우가
  코드 곳곳에서 이미 발견된 바 있다(코드 주석 참고).

## 가상자산 전문 뉴스 (2026-10-08)

`GET /crypto-news?limit=20` (1~50, 기본20). 기존 public/CORS 정책, IP별 분당20회. 응답 `data{market:"crypto", source, items, updatedAt, stale}`. items는 title/title_ko(번역 성공 시)/link/pubDate/source/provider/market/category. CoinDesk·Cointelegraph RSS 제목·출처·링크만 수집하며 일반 미국주식 피드를 혼합하지 않는다. 본문 저장 없음. 10분 메모리 캐시, 온디맨드 동시조회 단일화. 실패 공급자의 이전 기사 유지, 전체 실패 때 stale=true.

### 최신 뉴스 24시간·현지 시각 (2026-10-08)

주요 뉴스·홈 경제뉴스·국내/미국 종목 뉴스·가상자산 뉴스는 현재부터 실제 경과 24시간만 표시한다. 날짜 자정 기준이 아니며, 기사가 적어도 오래된 기사로 채우지 않는다. 발행시각 미상·미래 시각은 제외한다. 국내는 KST, 미국은 America/New_York(ET, 서머타임 자동 적용), 가상자산 API는 UTC 오프셋으로 정규화한다. DST 전환일에도 실제 경과 86,400초를 유지한다. 시차만으로 뉴스에 13/14시간을 추가하지 않는다.

API는 기존 캐시 결과를 반환 직전에 필터링하며 REST·경제뉴스 WebSocket·뉴스 속보에 동일하게 적용한다. `/domestic-news`, `/foreign-news`, `/us-news/{symbol}`, `/crypto-news`에 `newsWindowHours:24`, `newsTimeZone`을 추가한다. 인증된 `/naver-news`도 최근 기사만 반환한다. 공시·주간 보고서·과거 기사 저장은 기존 보존/조회 규칙을 유지한다. 외부 조회 횟수·캐시 TTL·DB 스키마·수집 주기 변경 없음.

### 한국수출입은행 일별 고시환율 (2026-10-11)

시장지표 환율 탭 전용. 공개 GET(CORS: 블로그 도메인), SQLite(`fx_koreaexim.db`)에 저장된 값만 읽고 요청 경로에서 외부 API를 호출하지 않는다. 응답 30초 캐시. 상세 [FX_KOREAEXIM.md](docs/FX_KOREAEXIM.md).

- `GET /fx-rates` (IP별 분당 30회) → `data{source, kind, official:true, realtime:false, notice, baseDate, prevDate, lastCollectedAt, lastCheckedAt, lastSuccessAt, pendingToday, state, stateMessage, coverage{from,to,days}, currencies[]}`.
  `currencies[]`: `code`(API 표기 그대로, 위안화는 `CNH`), `curUnit`(`JPY(100)` 등 원문), `unit`(1 또는 100 - **기준 단위, 1단위로 환산하지 않음**), `name`, `dealBasR`(매매기준율, 원), `prev`·`change`·`changeRate`(같은 통화·같은 단위의 직전 고시일 대비), `ttb`(송금 받을 때)·`tts`(송금 보낼 때)(없으면 null), `bkpr`, `kftcDealBasR`, `featured`. 주요 통화(USD·JPY·EUR·CNH·GBP·CHF)가 앞.
  `state`: `ok` · `collecting`(최초/과거 이력 수집 중) · `no_key` · `auth_error` · `quota` · `network_error`. 주말·공휴일에는 새 고시가 없어 `baseDate`가 직전 정상 고시일로 유지된다.
- `GET /fx-rates/history?cur=USD&range=3m` (`cur` 영문 3자, `range` 1m|3m|1y, IP별 분당 60회) → `data{code, curUnit, unit, name, range, points[[YYYY-MM-DD, 매매기준율]...], count, from, to, coverageFrom, incomplete}`. `incomplete:true`면 선택한 기간보다 수집된 이력이 짧다는 뜻. 잘못된 파라미터는 422.

### `GET /home-session-chart`
2026-10-16 추가. 공개·IP 분당 30회, 외부 공급자 호출 0회. 기존 홈 야간 분봉 요청을 대체한다. `data`는 NASDAQ_INDEX/SP500_INDEX/NASDAQ100/SP500/KOSPI200_NIGHT 5행: `symbol`, `intervalMinutes:30`, `basis`, `session{date,start,end,timeZone,slotCount,slot}` 또는 null, `rows[{slot,open,high,low,close,ts}]`. 미국은 기존 시세 성공 결과의 실제 `localTradedAt`·`marketStatus=OPEN`만 저장(미래 60초 초과·20분 초과 지연 거부). 미국 OHLC는 관측 표본 범위이며 거래소 봉이 아니다. 야간은 기존 실제 분봉 집계. 누락 구간 생성 없음. 각 최신 한 세션만 반환, 빈 기록은 rows 빈 배열. 시각은 미국 ET(DST 자동)/야간 KST, 날짜는 세션 시작일. 가격 단위는 포인트.

2026-10-16 야간 차트 보완: 같은 세션의 실제 분봉보다 새로운 20분 이내 최신 시세만 한 점 보태며 basis는 '실제 분봉 + 같은 세션 최신 시세'. 날짜/누락 구간을 합성하지 않는다.

2026-10-16 한국 지수 추가: /home-session-chart에 KOSPI/KOSDAQ 추가(총7행). Asia/Seoul 정규장09:00~15:30 최대14개, 국내 거래일만 기록. 기존 domestic_futures 시세 성공 결과의 localTradedAt/marketStatus만 사용, 추가 공급자 호출 없음.

### 2026-10-19 검색기 통합 재무 관문

`/pattern-scan`은 기존 개별 patterns를 보존하고 `patterns.longTermQuality`(재무 관문 통과 장기 후보), `longTermFilter`(조건·통과/제외·사유별 건수/종목)를 추가한다. 장기 후보의 `financialScreen`은 연간 비율·이익 성장률·최신 단독분기/공시 접수번호·확인시각을 담는다. 구버전/누락/만료 자료는 통과시키지 않는다. 통합 메뉴 통계는 원래 scanner별로 분리한다. [계산·캐시·검증](docs/SCANNER_FIVE_GROUPS_2026-10-19.md).


### GET /us-market-breadth (2026-10-28)

공개 지수 구성종목 집계. `data.byIndex.SP500`은 SP:SPX, `NASDAQ`은 NASDAQ:IXIC 구성 증권이다. 각 항목은 `up/down/flat/missing/total`, `status`(ok/stale/unavailable), `retrievedAt`, `delaySeconds`를 제공한다. total은 기업 수가 아닌 공급자 구성 증권 수(복수 종류주 포함)다. 미국 거래대금 상위 40종목과 별도 경로이며 소규모 순위로 대체하지 않는다.

공급원 TradingView scanner: KIS 순위 API에는 지수 전체 구성종목의 상승·하락 집계가 없어 별도 읽기 전용 공급원을 사용한다. 지수별 요청 1회씩, 미국 평일 09:30~16:00 ET 공유 캐시 120초/그 외 1시간. 새 스케줄·상시 스레드·종목별 조회 없음. 실패 60초 백오프, 최근 성공 최대 15분만 stale로 반환하고 이후 unavailable. 구성 목록 잘림·중복은 거부하며 결측 등락을 보합으로 합치지 않는다. `retrievedAt`은 수집 시각이며 시세 시각이 아니다. 공급자 시세는 최대 15분 지연으로 UI에 명시한다. 브라우저는 NineAPI.usMarketBreadth를 통해 조회한다.


### GET /market-participation?market=domestic|us (2026-10-28)

기존 `us_market_breadth`의 공급자·캐시·누락 검증을 공유하며 국내 두 지수만 추가한다. 국내는 TradingView KRX:KOSPI/KRX:KOSDAQ **지수 구성종목**으로, 기존 KIS 시장 전체 상승·하락 집계와 모집단이 다르다(우선주 등 포함 범위 차이). 국내 전체 등락 막대는 기존 KIS 그대로 유지한다. 국내/미국 캐시와 잠금은 독립한다. 각 시장의 본장에는120초, 장외에는3600초 캐시이며 오류는60초 백오프다. 상시 스케줄·프로세스·종목별 조회를 추가하지 않는다.

각 지수의 `volumeParticipation`은 `relative_volume_intraday|5`를 사용한다. 최근10거래일 **동일 시각 5분봉 거래량 평균** 대비 현재5분봉 거래량 배수가1을 초과하는 종목의 비율이다. 누적 하루 거래량/동시각 누적 거래량이 아니며 7일 기준으로 바꾸어 표시하지 않는다. `increased/eligible/total/ratio/median`, `basis=same-time-5m`, `lookbackDays=10`, `status`를 반환한다. 결측은 분모에서 제외하고 eligible/total 분석 범위를 표시한다. 매수 자금 유입이나 상승을 뜻하지 않으며 지수 등락·상승 종목 비율과 독립 표시한다. 국내 최대20분/미국 최대15분 지연. 미국 기존 `/us-market-breadth`에도 같은 필드가 추가되어 별도 호출 없이 재사용된다.


### 거래량 평균100 지수 (2026-10-28 개정)

`/market-participation`과 `/us-market-breadth`의 각 구성 집계에 `volumeIndex`를 추가한다. 기존 종목 수 참여비율 계약은 하위 호환으로 유지하지만 홈에서는 표시하지 않는다. 공급자 단일 요청에서 `volume|5`와 `relative_volume_intraday|5`를 같은 행으로 받아, 유효 종목별 현재5분 거래량 v와 동시각 과거평균 b=v/상대거래량을 구한다. 결과는 **100×Σv/Σb**이며 종목별 배수의 단순평균이나 증가 종목 수 비율이 아니다. 현재5분봉/최근10거래일 동시각 평균 기준이며 하루누적 거래량으로 표기하지 않는다.

필드 `current`, `baseline`, `index100`, `eligible`, `total`, `basis=same-time-5m-volume-sum`, `lookbackDays=10`, `status`. 결측 또는 평균 복원이 불가능한 0 상대거래량은 제외한다. 구성 범위의95% 미만이 유효하거나 평균0/비유한 값이면 unavailable, index100=null. 유효 범위는 툴팁에 표시한다. 홈은 시장별 두 지수에 공통 대칭 눈금을 적용하고 100 위의 차이만 전역 빨강, 아래 차이만 전역 파랑으로 그린다. 110과90의 높이는 같으며100은 채움이 없다.


### 국내 홈 누적 거래대금 `turnoverIndex` (2026-10-28)

`GET /market-participation?market=domestic`의 `byIndex.KOSPI|KOSDAQ`에 `turnoverIndex`를 추가한다. 기존 `volumeIndex`, `volumeParticipation`, 상승/하락 집계는 유지한다. 미국 응답에는 추가하지 않는다.

- KIS `FHKUP03500200`, `inquire-time-indexchartprice`, 업종0001/1001, 정규장만(`FID_ETC_CLS_CODE=1`),1800초,과거포함Y. 한 페이지102행·지수당1회, 국내 기존 공유캐시120초/장외3600초 안에서 재사용. 종목별조회·별도폴러·DB/수집프로세스 없음. 최종 마감값을 확보하도록 국내 짧은캐시를15:40까지 유지한다.
- `basis=same-time-cumulative-30m`, `source=KIS`, `market=KRX`, `unit=KRW`, `lookbackDays=5`, `sampleDays`, `baselineDates`, `asOf`(실제 누적구간 끝,KST), `retrievedAt`, `current`(누적원), `baseline`(직전5거래일 같은시각 누적원 평균), `index100=100*current/baseline`, `status`.
- 현재 진행봉은 제외. 완료30분봉의 `acml_tr_pbmn`(백만원)을 원으로 변환한다. 실측에서14:00시작30분봉=14:29분봉 누적값임을 확인했고 `asOf=14:30`으로 표시한다.2분 확정 유예,15:30종가행은15:32이후 사용. 개장첫32분은 비교대기,장중최대약32분이전 기준이다.
- 공통 거래일/특별세션으로 직전5거래일을 정확히 지정한다. 같은시각이 없거나 중복·비정상값·기준금액0·5일미달·특별장시간 불일치는unavailable. 과거종가금액/전체하루금액/시간비례추정으로 대신하지 않는다. 장외/휴일은직전거래일종가 기준일을 유지한다.
- 신규 필드가 아직 운영 서버에 없으면 홈은 거래대금확인중으로 표시하며 기존거래량을 거래대금으로 재표기하지 않는다. 거래량참여도는기존 공급자/기준으로 따로표시한다. 상세 검증/배포 경계: `docs/DOMESTIC_TURNOVER.md`.
