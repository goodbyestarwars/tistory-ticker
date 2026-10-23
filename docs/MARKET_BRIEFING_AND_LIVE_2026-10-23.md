# 시장 브리핑(07:00 확정)과 장중 실시간 데이터의 분리 (2026-10-23)

증시온도 페이지(`/page/market-temp`)의 데이터를 **성격이 다른 두 시스템**으로 나눈다. 화면 문구만 바꾼 것이 아니라
서버 수집·스케줄·저장·API·브라우저 갱신 주기가 모두 다르다.

| | A. 시장 브리핑 | B. 장중 시장 분석 |
|---|---|---|
| 화면 | 맨 위 `시장 브리핑 · 10/26(월)` + `07:00 확정 · 미국장 마감 기준` | `오늘의 증시`(+ 한눈에·수급·섹터·체크포인트) |
| 성격 | 국내 거래일 KST 07:00에 서버가 **한 번 확정**하는 장 시작 전 스냅샷 | 장중 값(수집 주기마다 바뀜) |
| 입력 | 미국 정규장 종가(S&P 500·나스닥 종합·다우·SOX·VIX)·원/달러 일봉·코스피200 야간선물 최종 일봉 | KIS/키움/네이버 등 서버가 수집·캐시한 국내 시세·수급·프로그램매매·테마 |
| 저장 | SQLite `morning_briefing`(거래일당 1행) + `morning_briefing_runs`(시도 이력) | 기존 캐시·DB(`/market-temp`, `/domestic-market-indicators`, `/theme-flow`…) |
| 갱신 | 07:00 생성 → 같은 거래일에는 **바뀌지 않음**(정정만 별도 기록) | 레인별 주기(아래) |

## A. 시장 브리핑

### 실행(스케줄)
- `scripts/cloud-vm/morning_briefing.py` `start_background()` — `main.py` 시작 시 FastAPI 프로세스 안의 스레드 1개(`morning-briefing`).
  **새 systemd 타이머·서비스를 만들지 않는다**(e2-micro 1GB, 배포 경로 변경 없음: `master` 반영 → 기존 `kiwoom-deploy` 자동 배포로 반영).
- 점검 주기: 대기 중 최대 5분, 평소 60초(15~600초로 제한). 모든 상태가 DB에 있어 **프로세스가 재시작돼도 이어서 재시도**한다.
- 거래일 KST 07:00(`RUN_MINUTE`)부터 시도. 한국 휴장일(`market_temp.KRX_HOLIDAYS_2026`)에는 만들지 않는다.
- 미확정이면 개장(09:00) 전 5분, 개장 후 30분 간격으로 재시도하고 장 마감(15:30, 수능일 등은 `market_clock.KR_SPECIAL_SESSIONS`) 뒤에는 `failed`로 닫는다.
  장 마감 뒤 서비스가 뒤늦게 시작되면 **소급 생성하지 않는다**(07:00 브리핑이 아니므로) — `failed`와 사유만 남긴다.
- 확정 조건: 미국 5지표 최신 일봉 날짜 = 직전 미국 정규장 날짜, 원/달러 최신 일봉 ≥ 직전 한국 거래일, 야간선물 최종 봉 대기는 07:15까지만(그 뒤 야간선물 없이 6항 모델로 확정).
- 정정: 야간선물이 늦게 들어오면 **개장 전(09:00)까지 한 번** 자동 정정(`revise_if_night_arrived`). 운영자 수동 정정은 `POST /morning-briefing/revise`(API 토큰)
  또는 VM에서 `python morning_briefing.py revise YYYY-MM-DD 사유`. 정정해도 `first_confirmed_at`은 그대로이고 `revised_at`·`revision`·`revisions_json`(이전 판정 포함)이 남는다.
  `python morning_briefing.py status|run YYYY-MM-DD`로 상태 확인·수동 시도도 가능.
- 확정본 불변: `status='final'`이면 `attempt()`·`run_due()`가 본문을 건드리지 않는다(시험: 장중 입력이 바뀌어도 스냅샷·확정 시각 동일).

### 한국/미국 거래일 매핑 (`market_clock.us_session_before_kr_day`)
KST 07:00은 뉴욕 전날 17~18시다. 한국 거래일 `T`의 브리핑은 `T-1`(달력) 이전의 **가장 최근 미국 정규장**을 쓴다.
월요일→직전 금요일, 미국 휴장(노동절·독립기념일 대체 등) 다음 한국 거래일→휴장 전 거래일(스냅샷 `usHoliday`에 건너뛴 휴장일 표기).
한국 휴장 다음 거래일은 마지막 미국 정규장 하루만 쓴다(옛 계산과 같음). 미국 휴장표는 2026년만 있다(`US_HOLIDAYS_2026`, 해가 바뀌면 `js/skin-shell.js`와 함께 갱신).
표에 없는 미국 휴장은 다섯 미국 지표가 **정확히 한 미국 거래일** 늦게 같은 날짜에 멈춰 있고 08:30 이후일 때만 `usHolidayAssumed`로 확정하고 화면에 `미국 휴장 추정`이라 쓴다(며칠 묵은 수집 장애는 휴장으로 덮지 않음).

### 계산식
옛 `js/market-temp.js`의 `tomorrowSignal_`·`TOMORROW_BUCKETS7/6`·`nightSignal_`를 그대로 서버로 옮겼다(7항: S&P·나스닥·다우 1/3 가중, SOX, VIX, 원/달러, 야간선물).
무작위 300개 입력으로 옛 JS와 대조해 합계(z)·구간·모델이 일치함을 확인했다(오차 1e-9). 구간 경계와 통계 문구(232거래일)는 같은 값이며 바꾸려면 재검증 후 서버 한 곳에서만 바꾼다.
브라우저는 계산하지 않는다(`test_market_temp_briefing.js`가 소스에 `tomorrowSignal_` 등이 없음을 확인).
야간선물 값은 일봉 종가(D 저녁~D+1 05:00 세션) ÷ D 주간 종가 − 1이며 주간 선물·현물로 대체하지 않는다. 화면에는 가격·변화·등락률(주간 종가 대비)을 보인다.
원/달러는 신호 계산에는 들어가고 화면 칸은 없다(시장 한눈에 환율 저울과 중복이라 2026-10-23 사용자 지시로 칸 제거) — `한국장 영향` 문장에 방향이 나온다.

### 저장 (`db_schema.py`, `ohlc_snapshot.db`)
- `morning_briefing`: PK `target_date`(거래일), `status`(`final`/`pending`/`failed`), `snapshot_json`, `us_session_date`, `scheduled_at`(07:00), `first_confirmed_at`, `revised_at`, `revision`, `revisions_json`, `attempts`, `last_attempt_at`, `next_retry_at`, `last_error`, `created_at`, `updated_at`. 400행 보관.
- `morning_briefing_runs`: 시도마다 1행(`trigger`=scheduled/manual/revise, `outcome`=final/pending/failed/revised/revise-failed, `detail`). 600행 보관.
- 시각은 모두 KST 문자열. 스냅샷 본문: `inputs`(지표별 등락률·기준일·종가), `night`(포함 여부·종가·주간 종가·등락률·세션일), `signal`(합계·모델 6/7항·구간·통계 문구), `usHoliday`, `usHolidayAssumed`.

### API
`GET /morning-briefing[?date=YYYY-MM-DD]` — DB만 읽는다(계산·외부 호출 없음). 확정본은 `Cache-Control: public, max-age=30`, 그 밖에는 `no-store`.
`session`에 오늘의 국내 정규장 단계(`phase`)·개장·마감 시각(`openAt`/`closeAt`)·마감 후 후속 분(`postCloseMinutes`)이 들어 있어 브라우저는 휴장·수능일 같은 일정을 따로 갖지 않는다(서버 시간표가 단일 출처).
선택 규칙: 오늘이 거래일이고 07:00이 지났으면 오늘 행(확정 전이면 `pending`, 마감 뒤에도 못 만들었으면 `failed` — 어제 숫자를 오늘 것처럼 보이지 않는다),
그 외(휴장일·07:00 전)에는 가장 최근 확정 행(화면에 `지난 거래일 브리핑 · 다음 10/26(월) 07:00 확정 예정`). `/health/schedules`의 `internalJobs`에 상태 요약이 붙는다.

## B. 장중 시장 분석과 갱신 레인 (`js/market-temp.js`)

서버가 수집·캐시한 값을 브라우저가 읽는다(키움·KIS·네이버를 브라우저가 직접 부르지 않음). 같은 응답은 `sharedMarketJson_`가 공유해 컴포넌트가 중복 호출하지 않는다.

| 레인 | 대상(API) | 장중(09:00~15:30) | 마감 후 후속(15:30~16:30) | 개장 전·16:30 이후·휴장 |
|---|---|---|---|---|
| brief | `/morning-briefing` | 확정이면 요청 없음 / 미확정 5분 | — | 07:00:20에 깨어나 확인(확정 전 1분, 확정 뒤 개장 전 5분 정정 확인) |
| live | `/domestic-market-indicators`(지수·수급·프로그램매매, 서버 60초 수집) | 1분 | 10분 | 중지 |
| snap | `/market-temp`(상승·하락 종목 수·증시온도, 서버 3분 계산) | 2분 | 10분 | 중지 |
| sector | `/theme-flow`(거래대금 상위 섹터, 서버 3분 수집) | 2분 | 10분 | 중지 |
| check | 오늘 투자 체크포인트 다시 쓰기 + `/investor-trend?period=intraday`(외국인 30분 누적) | 5분 | 10분 | 중지 |
| macro | `/futures`·`/option-flow`(해외 지수·원자재·가상자산·금리) | 5분 | 5분 | 거래일 5분 / 휴장·마감 15분 / 주말 휴장창 30분 |
| ai | `/ai-comments`(서버가 생성·검증·저장한 AI 카드 코멘트, DB 읽기만) | 2분 | 5분 | 개장 전 5분 / 휴장·마감 뒤 15분(주말 30분) |

- 처음 한 번은 모든 레인을 부른다. 숨긴 화면·오프라인에서는 멈추고 돌아오면 밀린 레인만 한 번 부른다. 실패하면 1분부터 최대 10분까지 늘려 재시도한다.
- 단계 전환(개장·마감·마감 후 후속 종료)과 다음 07:00에 맞춰 깨어난다. 휴장일에는 처음 한 번과 해외 레인(15분)·다음 07:00 확인만 남는다.
- `오늘의 증시` 아래 한 줄 상태: `장중 자동 갱신 · 10:24 기준` / `장 시작 전 · 국내 지표는 전 거래일 값 · 09:00 개장 후 자동 갱신` / `장 마감 · 15:40 기준 · 늦게 확정되는 수급은 16:30까지 확인` / `장 마감 · … · 자동 갱신 없음` / `휴장일 · 마지막 거래일 자료 · 자동 갱신 없음`.
  시각은 서버가 그 값을 계산한 시각(`/market-temp.updatedAt`)이지 화면을 연 시각이 아니다.
- `오늘 투자 체크포인트`: 제목 옆 `HH:MM 기준`(마지막 재작성 시각, 장중·마감 후 후속에서만). 위쪽에 `07:00 브리핑 · 하락 우세 …`와 `HH:MM 장중 변화 …` 줄을 따로 둔다.
  장중 변화는 실제 데이터로 확인될 때만 쓴다: ①외국인 코스피 30분 누적 순매수/순매도 부호가 오늘 안에서 바뀐 가장 최근 시점, ②코스피 등락률 ±0.5% 이상일 때 브리핑 방향과 같은지/반대인지.
  자료가 없으면 줄을 쓰지 않고, 있는데 변화가 없으면 `브리핑 이후 확인된 뚜렷한 변화 없음`만 쓴다.
- `오늘 거래대금 상위 섹터`: 머리말 `HH:MM 기준`(서버 수집 시각), 섹터 이름 옆 `▲2/▼1/–/NEW`(직전 갱신 대비 순위 변화). 순위 변화는 서버(`theme_flow.annotate_rank_change`)가 같은 거래일의 직전 갱신과 비교해 `rank`·`prev_rank`·`rank_change`·`rank_basis`로 내려준다(전 거래일과는 비교하지 않음).
  테마 거래대금은 구성종목 `현재가×누적거래량`의 합이며 **같은 테마 안**에서는 6자리 종목코드로 한 번만 센다(거래소 접미사 중복 합산 방지). 한 종목이 여러 테마에 속하는 것은 정상이므로 **테마끼리의 거래대금은 더하지 않는다**(시장 전체 거래대금이 아님).
- 원자재·가상자산·금리: 값 아래에 수신 시각과 경과(`10.23 21:03 수신(8분 전)`), 응답이 준 출처·지연 여부(`Naver 비공식 선물 시세 · 지연 여부 미확인`, `KIS 공식 해외선물 시세`, BTC `업비트 공개시세`)를 적는다. API가 보장하지 않는 `실시간`이라는 말은 쓰지 않는다. 금리는 `일봉 종가 MM.DD 기준(FRED, 하루 1회 확정)`.

## 검증
- 서버: `test/test_morning_briefing.py`(계산식 기준 벡터, 한국/미국 거래일 매핑, 07:00 실행, 재시도·복구(프로세스 재시작), 확정본 불변, 정정 기록, 마감 후 중단, 조회 규칙, HTTP 계약, 테마 중복·순위 변화).
- 브라우저: `test/test_market_temp_briefing.js`(화면 상태 전부, 단계·레인 호출 횟수 시뮬레이션, 상태 문구, 체크포인트 문맥, 섹터 순위, 단일 요청), `test_market_temp_refresh.js`(루프: 예정 없음·숨김·오프라인·백오프).
- 운영 반영 후 확인할 것: 다음 거래일 07:00 이후 `GET https://goodbyestar.cloud/morning-briefing`의 `briefing.status`/`firstConfirmedAt`, `GET /health/schedules`의 `internalJobs`, VM `journalctl -u kiwoom-backend | grep morning_briefing`.

## C. 카드 코멘트(AI, 2026-10-23)

카드 옆 한 줄 해설(브리핑의 6칸·요약 포함)은 고정 문장 풀이 아니라 서버가 실제 데이터로 생성·검증해 저장한 AI 코멘트다. 07:00 브리핑 코멘트는 브리핑이 `final`이 된 뒤 한 번 만들어 그 거래일 동안 바뀌지 않고(정정으로 수치가 바뀔 때만 다시), 장중 코멘트는 상태가 의미 있게 바뀔 때만 갱신된다. 구조·주기·검증·운영은 [AI_MARKET_COMMENTS_2026-10-23.md](AI_MARKET_COMMENTS_2026-10-23.md).
