# 클라우드 VM API 레퍼런스 (`goodbyestar.cloud`)

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
- **모든 라우트는 GET만 존재**(POST/PUT/DELETE 없음)
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

### `GET /pbar-tratio/{code}`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (`/ohlc-minute`와 동일 패턴) |
| 필수 파라미터 | `code` (경로) |
| 선택 파라미터 | `days`: 1~120(기본 1) - 1이면 오늘치만, 2 이상이면 SQLite(`volume_profile_daily`)에 누적된 과거 거래일과 오늘 실시간 응답을 가격별로 합산 |
| 응답 JSON 구조 | `data` = `{"currentPrice": .., "avgPrice": .., "daysIncluded": N, "bins": [{"price":..,"volume":..}, ...]}`, `bins`는 가격 오름차순. `daysIncluded`는 실제로 합산에 반영된 거래일 수(요청한 `days`보다 적을 수 있음). `avgPrice`는 거래량 가중평균가(VWAP, Σ가격×거래량/Σ거래량) - `bins`가 실제 체결가·체결거래량이라 정확히 계산됨(비중%이 아님) |
| 시장 범위 | KIS FHPST01130000(국내주식 매물대/거래비중, [국내주식-196]) - HTS(eFriend Plus) [0113] 당일가격대별 매물대 화면과 동일. `js/foreign-flow.js`의 `computeVolumeProfile`(최근 120거래일 근사치)과 별개로 실제 체결가 기반 뷰 |
| 데이터 누적 방식 | 배치 없음 - 이 엔드포인트가 호출될 때(=사용자가 실제로 조회한 종목만)마다 그날 최신 누적 스냅샷을 `volume_profile_daily`에 UPSERT(같은 날은 덮어쓰기, 더하지 않음 - pbar-tratio 응답 자체가 이미 그 시점까지의 당일 누적치라서). 그래서 "최근 N일"은 정확히 최근 N거래일이 아니라 "조회된 적 있는 날짜 중 최근 N개"임(뜸하게 조회되는 종목은 커버리지가 듬성듬성할 수 있음). 200일보다 오래된 행은 시간당 최대 1회 정리(`_maybe_prune_volume_profile`) |
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

### `GET /futures`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | `interval`, `days` (둘 다 쿼리) |
| 파라미터 형식·허용값 | `interval`: `"day"`(기본) \| `"minute"`(코스피200 주/야간선물처럼 `domestic_futures.MINUTE_SYMBOLS`에 있는 심볼만 실제 분봉 적용, 나머지는 그대로 일봉) · `days`: 정수, 1~500로 clamp(기본 90) |
| 응답 JSON 구조 | `data = [{"symbol","name","price","change","change_rate","high","low","updated_at","oi","oi_change","chart":[...]}, ...]` — 항상 21개 심볼 고정 순서로 반환(데이터 없으면 해당 필드 `null`): `KOSPI, KOSDAQ, NASDAQ_INDEX, SP500_INDEX, DOW_INDEX, NASDAQ100, SP500, DOW, KOSPI200_DAY, KOSPI200_NIGHT, SOX, VIX, WTI, GOLD, USDKRW, KTB3Y, US10Y, US2Y, US30Y, BTC, ETH` |
| 데이터 단위 | 지수류는 포인트, 환율은 원, 채권금리는 %, 원자재/코인은 해당 통화 그대로. `oi`(미결제약정)는 코스피200 야간선물(`KOSPI200_NIGHT`)만 값이 있고 나머지는 `null` |
| 시장 범위 | 국내(코스피/코스닥/코스피200 주간·야간선물) + 해외(미국 지수 3종 현물·선물, SOX, VIX, WTI, 금) + 환율 + 국채금리(한국 3년/미국 2·10·30년) + 가상자산(BTC/ETH) — 심볼별 데이터 출처가 다름(네이버/KIS/업비트) |
| 데이터 갱신 주기 | 백그라운드 수집기가 심볼별로 상시 수집(수집 주기는 심볼마다 다름 — `foreign_futures.py`/`domestic_futures.py`/`btc_futures.py`/`bond_yield.py` 각각 확인 필요) |
| 캐시 시간 | 엔드포인트 자체 캐시 없음(SQLite 즉시 읽기) — 사실상 수집 주기가 갱신 주기 |
| 호출 예시 | `curl "https://goodbyestar.cloud/futures?interval=day&days=180"` |
| 오류 응답 예시 | 없음 — 데이터가 없는 심볼은 필드가 `null`일 뿐 요청 자체는 항상 200 |

### `GET /order-book/{code}`

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

### `GET /option-flow`

| 항목 | 내용 |
|---|---|
| 인증 필요 여부 | **불필요** (공개, CORS 제한) |
| 필수 파라미터 | 없음 |
| 선택 파라미터 | 없음 |
| 응답 JSON 구조 | `data = {"CALL":{"side":"CALL","volume","oi","oi_change","updated_at"},"PUT":{"side":"PUT","volume","oi","oi_change","updated_at"}}` |
| 데이터 단위 | `volume`/`oi`/`oi_change`: 계약수(콜·풋 전체 합산) |
| 시장 범위 | 코스피200 옵션, 최근월물 자동 판별(매월 둘째주 목요일 만기 기준) |
| 데이터 갱신 주기 | 5분 주기 백그라운드 폴러(KIS `FHPIF05030100`) |
| 캐시 시간 | 엔드포인트 자체 캐시 없음(SQLite 즉시 읽기) — 5분 수집 주기가 곧 갱신 주기 |
| 호출 예시 | `curl "https://goodbyestar.cloud/option-flow"` |
| 오류 응답 예시 | 없음 — `KIS_APPKEY`/`APPSECRET` 미설정 시 데이터가 비어있을 수 있으나 에러는 아님 |

---

## 그 외 라우트 (요약)

| Method | Endpoint | 인증 | 캐시/갱신 | 비고 |
|---|---|---|---|---|
| GET | `/health` | 불필요 | - | 헬스체크, `{"status":"ok"}` |
| GET | `/futures/avg` | 불필요 | 없음(즉시계산) | 쿼리 `symbol`(필수) · `days`(1~1000, 기본365) - 지정 심볼의 장기평균/최고/최저 |
| GET | `/naver-news` | **필요** | 없음 | 쿼리 `query`(필수, 1~100자) - 네이버 뉴스검색 프록시, 호출마다 네이버 API 쿼터 소모 |
| GET | `/investor-flow-batch` | **필요** | 하루 1회(`batch_scan.py`) | 섹터 풀(238종목) 공매도/대차/연기금 배치 캐시 |
| GET | `/fundamentals-batch` | **필요** | 하루 1회(`batch_scan.py`) | DART 재무제표(5년 추세+최근분기) 전종목 배치 캐시 - 배치 소비자 전용 |
| GET | `/fundamentals/{code}` | **필요** | 하루 1회(`batch_scan.py`) | 위 캐시에서 해당 종목만 잘라 반환(`{code, fundamentals, fetchedAt}`). 종목분석 펀더멘탈 탭용 단건 조회 - 캐시에 없으면 `fundamentals: null` |
| GET | `/earnings-calendar?year=YYYY&month=M` | 불필요 | 10분 메모리 캐시 | DART 거래소 공시 중 실제 접수된 잠정실적/실적 공시를 캘린더 이벤트로 반환. `DART_API_KEY`가 없으면 빈 배열 |
| GET | `/daily-scan-batch` | **필요** | 하루 1회(`daily_scan.py`) | 차트패턴·눌림목·투자시그널 전종목 스캔 결과 |

`/daily-scan-batch`의 `data.investSignal.buckets[등급]`은 전종목 검색·정렬용으로 최대
3,000개를 보존한다. 각 항목은
`[code, name, price, changeRate, stars, totalScore, tradingValue]` 순서이며
`price`는 원, `changeRate`는 %, `totalScore`는 0~100점, `tradingValue`는 원 단위
`종가×거래량`이다. 앞 5개 필드 순서는 구버전과 동일하다.
| GET | `/week52-batch` | **필요** | 하루 1회(`week52_scan.py`) | 섹터 풀 52주 신고가/신저가 캐시 |

---

## 참고

- 원본 소스: `scripts/cloud-vm/main.py` + `kiwoom_client.py`/`kiwoom_market.py`/
  `foreign_flow_compute.py`/`investor_flow.py`/`investor_trend.py`/`order_book.py`/
  `market_rank.py`/`option_flow.py`/`db_schema.py`
- 인프라 전체 그림은 `ARCHITECTURE.md`, 사이트 기능별 이력은 `CLAUDE.md` 참고
- **"미검증" 표시가 있는 필드(호가 필드명, `/quote`의 `mac` 단위 등)는 실제 응답을 한 번
  받아서 대조해보고 쓸 것** — 공식 문서가 필드 목록을 자르거나 단위를 명시하지 않는 경우가
  코드 곳곳에서 이미 발견된 바 있다(코드 주석 참고).
