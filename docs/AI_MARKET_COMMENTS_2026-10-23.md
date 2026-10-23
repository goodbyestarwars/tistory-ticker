# 9Pay AI 시장 코멘트 엔진 (2026-10-23)

증시온도 카드 옆 한 줄 해설은 예전에는 `js/market-temp.js`의 **미리 쓴 문장 배열에서 고르는** 구조였다(`COMMENT_POOLS_`·`marketComment_`·`tmComment_`·`rateComment_`·`programComment_`).
이제는 **서버가 실제 데이터를 정량 분석 → Groq가 한국어 코멘트 생성 → 코드가 검증 → SQLite에 저장 → 모든 방문자에게 같은 확정 코멘트**를 보여 준다.
브라우저에는 문장 풀도, AI 호출도, 키도 없다. 새 유료 AI 서비스와 새 시세 API는 추가하지 않았다(기존 Groq·GAS 프록시와 VM이 이미 모은 데이터만 사용).

## 1. 구조

~~~text
VM 기존 수집 데이터 (KIS·키움·FRED·네이버·KOFIA → /domestic-market-indicators 메모리 캐시, /market-temp 캐시, future_prices/future_chart/option_flow DB, morning_briefing)
  └─ ai_comment_facts.py   ② 정량 분석 → 카드별 '사실 객체'(numbers/context/flags/state/sig)  ← AI 호출 전, 순수 함수
       └─ ai_comments.py   ③ 묶음(group)별 프롬프트 1개 → POST GAS ?action=marketComments (token=VM API_TOKEN)
            └─ GAS doPost   Groq(openai/gpt-oss-120b, GROQ_API_KEY는 GAS 스크립트 속성에만) → JSON 문자열 + usage
       └─ ai_comment_validator.py  ④ 카드별 검증 → 통과분만 저장, 반려분은 같은 요청 안에서 교정 재요청 1회
  └─ SQLite ai_comments / ai_comment_history / ai_comment_runs  ⑤ 저장
브라우저 ← GET /ai-comments (DB 읽기만, max-age=30)   상태: GET /health/ai-comments, /health/schedules.internalJobs
~~~

- **Groq 키는 VM에 없다.** GAS `doPost`(`gas/ticker-proxy.gs` `marketCommentsProxy_`)가 VM의 `API_TOKEN`(GAS 스크립트 속성 `KIWOOM_VM_TOKEN`과 같은 값)을 본문 `token`으로 상수시간 비교해 인증한 뒤 Groq를 부르고 응답만 돌려준다. GAS에서도 프롬프트 길이(3만 자)·출력 토큰(≤3000)·하루 호출(`MARKET_COMMENTS_DAILY_CAP`, 기본 200)을 이중으로 제한한다. 브라우저 호출 경로는 없다.
- 스케줄은 새 systemd 타이머가 아니라 FastAPI 안 스레드 `ai-comments`(시작 90초 뒤부터 장중·마감 후 2분 / 그 밖 5분마다 점검). 점검은 DB·메모리 캐시 읽기와 CPU 계산뿐이고 **호출은 코멘트 서명(sig)이 바뀐 카드가 있을 때만** 한다.
- 입력은 `main.py`가 이미 메모리에 가진 `_domestic_market_indicators_cache`, `market_temp.get_cached()`와 DB(`future_prices`, `future_chart`, `option_flow`, `morning_briefing`)다. 새 외부 시세 호출은 없다.

## 2. 묶음(요청 1회 = 여러 카드)과 생성 주기

| 묶음 | 카드(slot) | 언제 만드는가 | 최소 간격 / 일 상한 |
|---|---|---|---|
| `brief` | `spx` `nas` `dji` `sox` `vix` `night` `brief_summary` | 07:00 시장 브리핑이 `final`이 된 뒤 1회. 같은 거래일엔 장중에도 바뀌지 않는다(브리핑이 정정되어 수치가 달라질 때만 다시) | 10분 / 6회 |
| `intraday` | `kospi_volume` `kosdaq_volume` `breadth` `foreign` `institution` `individual` `program` `putcall` `market_summary` | 점검마다 상태를 계산, **서명이 바뀐 카드만** 다시 요청(개별 카드가 바뀌면 요약 카드도). 방향이 반대로 뒤집힌 카드는 5분 간격까지 허용 | 20분(긴급 5분) / 16회 |
| `funds` | `credit` `deposits` | 일별 확정 데이터(기준일)가 새로 들어왔을 때. 두 카드를 한 요청으로 묶어 예탁금·신용을 구분해 해석 | 30분 / 4회 |
| `macro` | `rate` `fx` `oil` `gold` `btc` | 새 유효 데이터(금리·환율은 새 일봉 기준일, 원자재·BTC는 방향·강도 단계 변화/새 날짜). 조금 변했다고 매번 호출하지 않는다 | 45분 / 12회 |

전체 상한: 하루 `AI_COMMENTS_DAILY_CALLS`(기본 60회)·`AI_COMMENTS_DAILY_TOKENS`(기본 150000토큰), 한 번 만들 때 모델 호출 최대 2회(최초 + 반려 카드만 교정 재요청). 연속 실패 시 5분→10분→…→60분 백오프. `AI_COMMENTS_ENABLED=0`이면 호출 없이 꺼진다.
**Groq 요금제의 실제 한도(무료 티어 일 토큰 등)는 미확인**이다. 다른 GAS Groq 해설과 한도를 공유하므로 운영 후 `/health/ai-comments`의 `tokensToday`를 보고 상한을 조정한다.

## 3. 정량 분석(AI 호출 전) — `ai_comment_facts.py`

카드마다 전일 대비·5/20기록 변화·20기록 평균 대비·연속 상승/하락 일수·20일 고저점·60기록 내 위치를 계산하고, 수급은 매수/매도 우위 일수(최근 20일 중 N일)·5/20일 누적 방향·평소 대비 규모·방향 전환 여부, 금리는 최근 120일 수준×일 변동(프런트 `rateStats_`를 그대로 이식), 예탁금·신용은 두 지표의 동행/엇갈림(`pair_reading`)을 만든다.
관련성이 확인된 쌍(`RELATED`)만 함께 해석하게 하고 그 밖의 지표 언급은 검증기가 막는다.

- `numbers`: 코멘트에 **인용해도 되는 숫자**. 장중에 계속 변하는 값(거래량 비율·순매수 금액·풋콜 비율·원자재 등락률)은 일부러 넣지 않는다 → 문장에 쓰면 반려. 확정 값(일수·확정 일봉 기반 등락률·금리 bp)만 들어간다.
- `state`: 시장 상태 한 단어. 코멘트를 만든 때의 `state`와 지금 `state`가 **반대 극**(상승↔하락, 매수↔매도, 풋↔콜)이면 조회 API가 코멘트를 숨긴다. 보합/거래량 단계 같은 변화는 숨기지 않고 서명이 바뀌면 다시 만든다.
- `sig`: 재생성 서명(데이터 기준일 + 방향 + 강도 단계 + 연속 일수 구간 …). 같으면 호출하지 않는다 → **새로 고침·재시작·배포 후에도 같은 코멘트**.
- `flags`: `big`(급등·급락 같은 큰 변동 표현 허용) / `streak`(연속·내내) / `extreme`(최고·고점·바닥) / `intraday`(장중 잠정치).
- `angles`: 데이터가 실제로 뒷받침하는 관점 후보. 서버가 **이 카드가 가장 오래전에 쓴 관점**을 `angle`로 지정한다(날짜 해시가 아니라 `ai_comment_history.angle` 사용 이력 기준). 같은 상승이라도 거래량·최근 추세·수급 상태에 따라 관점이 달라진다.
- 거래량: 장중 잠정 누적이면 `phase` 로 알리고 많고 적음 판단을 금지(마감 전엔 평소보다 낮아 보이는 게 정상). 마감 후 `volume_ratio_vs_20d`(직전 20기록 평균=100%)만 인용 가능.
- 휴장·미수신: 데이터가 없으면 slot 사실이 없고(`current_state='__missing__'`) 이전 코멘트가 숨는다. 휴장일에는 마지막 거래일 데이터의 `asof`가 그대로라 서명이 안 바뀌고, 코멘트는 원래 `generatedAt`·`dataAsOf`와 함께 유지된다(새 시황처럼 쓰지 않는다).

## 4. 프롬프트와 반복 방지

시스템 프롬프트(`ai_comments.SYSTEM_PROMPT`)가 말투·형식·사실 규칙을 정하고, 사용자 메시지는 `{"session":…, "cards":{slot:{label,data_date,state,numbers,context,flags,avoid,angles,angle,max_chars,related,recent}}}` JSON이다.
`recent`는 같은 카드의 **최근 14일** 통과 문장(날짜가 다른 것 우선 6개). 말투 예시 6문장은 분위기 참고용으로만 주고, 그대로 베끼면 검증기가 반려한다. 응답은 `{"comments":{slot:"문장"}}`.

## 5. 검증 — `ai_comment_validator.py` (통과 못 하면 쓰지 않는다)

형식(8~64자, 요약 96자, 한국어, 줄바꿈·마크다운·이모지·링크·허용 목록 밖 영문 금지) / 숫자(numbers 밖 숫자 금지, 5·20 윈도우만 공통 허용) / 방향 모순(상승/매수 카드에 하락 표현만 등) / 큰 변동·연속·고저점 표현은 flags 근거가 있을 때만 / 원인 단정 금지(`때문에·영향으로·덕분·인해…`, 단 `때문인지·탓일까` 의문형은 허용) / 사건·기관·종목 언급 금지 / 관련 없는 다른 지표 언급 금지 / 매수·매도 권유·보장·폭락 예고 금지 / 카드별 금지 해석:

| 카드 | 막는 것 |
|---|---|
| 예탁금·빚투 | 자금 이탈·고갈·말랐다·빠져나감 단정, 반대매매·거품 |
| 외국인·기관·개인·프로그램 | 하락/상승 확정, 지수를 끌어내렸다 등 인과 동사 |
| 풋/콜 | 다들·모두·투자자들·베팅·공포·비관·낙관 |
| 금리 | 주식→채권 자금 이동·호재/악재·인상/인하(원인) |
| 환율 | 수익·이익·환차익·유리/불리·수출입 원인 (방향 단어 검사는 면제: 달러 상승=원화 약세) |
| VIX | 폭락·공포·위기·경고음 |
| 거래량 | 매수세·유입·몰렸다, 장중 누적치의 많고 적음 단정 |
| 원자재·BTC | 전쟁·감산·안전자산·달러·반감기·승인 등 원인 |

반복: 최근 14일 같은 카드 문장과 유사도(글자 2-그램 자카드/공통 앞부분) 0.60 이상이면 반려 후 다른 관점·구조로 재요청. 재요청 뒤에도 남으면 다른 결함이 없고 유사도 <0.90인 것 중 가장 덜 비슷한 문장을 쓰고, 0.90 이상(거의 그대로)이면 새 문장을 저장하지 않는다. 이 경우 이전 코멘트가 그대로 남지만(같은 극이면 원래 `generatedAt`·`dataAsOf` 툴팁과 지난 거래일 꼬리표와 함께, 반대 극으로 뒤집혔으면 숨김) 오늘 데이터로 새로 쓴 것처럼 보이지는 않는다.

## 6. 조회와 실패 처리

`GET /ai-comments` → `{serverTime, tradeDate, promptVersion, comments{slot:{text,group,generatedAt,dataAsOf,tradeDate,model,carried}}, hidden{slot:사유}}`. 숨김 사유: `state-changed`(반대 극으로 뒤집힘) / `data-missing`(입력 미수신) / `too-old`(묶음별 최대 경과일: brief 6, intraday 4, funds 8, macro 4일).
AI/GAS 장애, 키 없음, 한도 초과, 검증 탈락 어느 경우에도 **금융 데이터·카드 값 표시에는 영향이 없다**. 코멘트 칸만 비고(높이는 한 줄 예약), 고정 문구로 채우지 않는다. 서명이 바뀌었지만 새 코멘트를 못 만든 동안에는 같은 극이면 이전 코멘트가 `generatedAt`·`dataAsOf` 툴팁과 함께 남고, 지난 거래일 코멘트에는 `· M.D 기준` 꼬리표가 붙는다.

## 7. 화면 (`js/market-temp.js`, `css/market-temp.css`)

- `loadAiComments_`가 레인 `ai`(장중 2분 / 개장 전·마감 후 5분 / 휴장·마감 뒤 15~30분, DB 읽기만)로 `/ai-comments`를 읽고, 바뀐 경우에만 해당 카드를 다시 그린다. 실패하면 조용히 이전 코멘트를 유지한다(부분 지연 표시도 하지 않음).
- 위치: 시장 한눈에 행(코스피·코스닥 거래량, 외국인·기관·개인, 빚투, 예탁금, 환율), 상승/하락 종목 비중 아래, 시장 한눈에 요약 줄, 프로그램매매·옵션 풋콜·금리·원유·금·비트코인 카드, 브리핑의 6칸(S&P·나스닥·다우·SOX·VIX·야간선물)과 브리핑 요약 줄.
- 모든 문장은 `escapeHtml`로 출력한다. 라이트·다크 공통 토큰(`--pulse-sub`, `--pulse-ink`)만 사용, 줄은 최대 2줄(`line-clamp`)이며 비어 있어도 한 줄 높이를 예약한다.

## 8. 운영 확인

- `GET https://goodbyestar.cloud/health/ai-comments`: `state`(정상/대기/오류/꺼짐), `callsToday`·`tokensToday`와 상한, 묶음별 `lastSuccessAt`·`lastRun{outcome,accepted,rejected,error}`·`consecutiveFailures`, `visibleComments`, `hiddenComments`. `GET /health/schedules`의 `internalJobs`에도 요약.
- VM: `python ai_comments.py status|view`, `journalctl -u kiwoom-backend | grep ai_comments`.
- 환경변수(모두 선택): `AI_COMMENTS_ENABLED`, `AI_COMMENTS_DAILY_CALLS`, `AI_COMMENTS_DAILY_TOKENS`, `AI_COMMENTS_GAS_URL`(기본은 운영 GAS 웹앱). 키·토큰은 코드·문서·로그에 없다(예외 메시지에도 싣지 않는다).
- **GAS가 먼저 배포돼야 한다**: master의 `gas/` 변경은 `deploy-gas.yml`(clasp)로 자동 배포된다(저장소 Secrets 없으면 GAS 편집기에서 수동 배포). 배포 전에는 VM이 `GAS 응답이 JSON 이 아님`으로 실패를 기록하고 코멘트 칸이 빈 채로 두며 나머지는 정상이다.

## 9. 검증

- `test/test_ai_comments.py`(47건, Groq는 전부 목): 사실 객체(프로그램 20일 매도·예탁금↓+신용↑ 구분·장중 값 인용 불가·금리 단계·미수신), 검증기(숫자·원인 단정·권유·카드별 금융 단정·큰 변동/연속/고점 근거·방향 모순·다른 지표 혼입·사건 언급·형식·반복), 파이프라인(같은 데이터 새로고침=같은 문장·호출 없음 / 다음 거래일 새 분석 / 최근 14일이 프롬프트에 포함·반복 재시도·거의 같은 문장은 해설 없음 / 관점 순환 / 장중 외국인 매도→매수 전환 시 숨김 후 재생성 / 원화 강세 수익 표현 반려 / 금리 급변 원인 단정 반려 / Groq 장애 시 빈 칸·백오프·상태 오류 / 휴장일 기준일 유지 / 입력 미수신 숨김·노후 만료 / 일 호출 상한·끄기 / 묶음 1회 요청·사용량 기록 / 요약 동반 갱신 / 비밀 미노출 / 07:00 브리핑 코멘트 고정) + HTTP 계약.
- `test/test_market_temp_ai_comments.js`, 갱신된 `test_market_temp_briefing.js`·`commodity.js`·`extras.js`(고정 문구 제거 확인, 빈 칸 예약, 이스케이프, 기준일 꼬리표, 장애 격리, `ai` 레인 주기).
- 미확인: 운영 GAS의 Groq 호출(`response_format`/`reasoning_effort` 옵션 수용 여부는 GAS가 400이면 옵션 없이 재시도하도록 방어했지만 실제 응답은 배포 후 확인), Groq 요금제 한도, 실제 문장 품질(말투). 첫 운영 확인은 배포 후 `/health/ai-comments`와 `/ai-comments`.

## 10. 운영 첫 실행 기록과 보정 (2026-10-24)

배포 직후(10/24 01:26 KST) 실제 Groq 응답으로 `intraday`·`funds` 묶음은 정상 저장됐고 `/ai-comments`에 나왔다. `macro` 묶음은 같은 점검에서 연달아 호출되어 `groq-failed`(분당 토큰 한도 추정, 원인 미확인)로 실패했다 → 실제 호출 사이 최소 25초 간격(`MIN_CALL_SPACING_SEC`)을 둔다. 휴장일에는 수집 시각이 아니라 직전 거래일을 기준일로 쓴다(`trading_asof`: 풋/콜·상승하락 비중이 토요일 날짜로 찍혀 하루마다 재생성되는 것을 막음).
