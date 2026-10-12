# 장중 실시간 페이퍼 트레이딩(자동매매 2.0 모의매매 엔진) — 2026-10-12

**실주문 없음.** 키움 **조회**(1분봉·일봉)만 쓰고 주문 함수·주문 API 경로가 코드에 없다(테스트가 소스에서 금지어를 검사). `LIVE_SELL`이 켜져 있으면 엔진이 스스로 멈추고 경고한다.

**주문 불가를 실행 시점에 보장한다**(2026-10-12 추가): 봇과 공유하는 `KiwoomClient`를 `research_job.read_only_client()`로 감싸 일봉(`ka10081`)·1분봉(`ka10080`) 조회 TR 외의 `call()`은 네트워크에 나가기 전에 예외로 막고 `sell_market()`은 호출 즉시 예외를 낸다(`test_read_only_client_blocks_order_paths`). 장중 실행기와 일봉 연구 실행기가 모두 이 클라이언트만 쓴다.

## 세 가지 성과의 구분
| 구분 | 내용 | 코드 | 표시 |
|---|---|---|---|
| A 백테스트 | 과거 일봉 시뮬레이션 | `backtest/`, `data/quant-backtest.js` | 'A 검색기별 백테스트 성과' |
| B 일봉 사후 모의 | 확정 일봉으로 다음 시가 체결을 가정 | `candidate_gen.paper_*`, `paper_exits.py` | 'B 일봉 사후 모의매매' |
| C 장중 실시간 | **실제 관측 시세·시각**으로 만든 가상 체결 | `live_paper.py`, `live_paper_job.py` | 'C 장중 실시간 가상매매'(`simulationType=LIVE_PAPER`) |

C의 체결은 시장 체결이 아니라 '관측가 + 슬리피지 가정'이다. 세 성과는 테이블·JSON 필드·화면 구역이 모두 분리돼 합산하지 않는다.

## 거래일 판정(긴급 수정)
- `research/krx_calendar.py`: 휴장일 표는 `scripts/cloud-vm/market_temp.py: KRX_HOLIDAYS_2026` 하나만 쓴다. 표가 덮지 않는 연도·표 읽기 실패는 `CalendarUnknown` → 후보 생성 `CALENDAR_UNKNOWN`, 진입 보류, 엔진 정지+이벤트.
- 기존 `_next_weekday`(주말만 제외)와 달력일 4일 만료(`STALE_DAYS`)를 거래일 기준(`STALE_TRADING_DAYS=3`, 진입 봉은 스캔일 **다음 거래일**이어야 함)으로 교체. 10/8 스캔은 10/9 휴장·주말을 건너 10/12 09:00 전까지 유효하다(실측: 이전 코드는 10/12 08:26에 `STALE_SCAN(2026-10-08)`로 거절).
- `research_job.py`의 감시 구간·다음 실행·후보 없는 날 계산도 같은 달력을 쓴다(달력을 모르면 평일로 대신 - 일정 계산 한정).
- 늦게 복구한 후보로 이미 지난 시각의 가상 체결을 만들지 않는다(진입 마감 09:30 이후엔 `UNFILLED`).

## 엔진 동작(`live_paper.py`)
- 후보: 직전 거래일 스캔의 `candidates`. 검색기별 점수 체계가 달라 **원점수를 섞어 정렬하지 않고** 검색기 안의 순위(rank_norm)로 번갈아 배치. 같은 종목 중복·감시 상한(`max_watch`=30)은 이유와 함께 `lp_selection`에 기록.
- 진입: 09:00 이후 처음 관측한 신선한(150초 이내) 시세, 09:30까지. 가격 = 관측가 × 1.002(호가 필드 미검증이라 슬리피지 가정, 호가를 쓰게 되면 0으로 두어 이중 차감 방지). 기준가 대비 +2% 갭은 SKIPPED. 시세·ATR이 없으면 `UNFILLED(DATA_UNAVAILABLE)`.
- 자금: 전략별 독립 계좌(초기 1,000만원), 동시 5·종목당 10%·총 30%(`allocation.entry_size`). 매도 체결 대금만 현금. 순수익률 = 체결가/진입가 − 1 − 0.4%(연구와 동일).
- 청산 3전략: `trail_atr`(장중 관측가가 추적선 이하 → 가상 매도, 최대 30일 확정 종가), `atr_close`·`dead35`(확정 일봉 신호 → 다음 거래일 처음 관측한 시세, 최대 150일). 미확정 장중 가격으로 신호를 확정하지 않는다. 신호 당일엔 체결하지 않고 `PENDING_EXIT`. 선택 대조군 `fix3_5`(−3%/+5%, 기본 꺼짐, 같은 봉에 둘 다 가능하면 손절 먼저).
- 시세 단절(3분 무수신): `FEED_DOWN`, 신규 진입 보류. 단절 중 놓친 추적선 이탈은 일봉으로 사후 발견해도 관측 체결로 쓰지 않고 `STOP_BREACH_UNOBSERVED` → 다음 거래일 관측가로 체결. 복구해도 단절 구간을 채우지 않는다.
- 원자성·중복 방지: 체결·계좌·결정·이벤트가 한 SQLite 트랜잭션. `UNIQUE(strategy_id, code, scan_date)`와 `lp_decisions` PK로 같은 신호 중복 매수 불가(재시작 포함). 상태는 전부 `research.db`(`lp_*`)에 있어 재시작하면 이어서 동작.
- 실행기 `live_paper_job.py`: 거래일 08:50~15:50, 30초 주기, 15:45 이후 확정 일봉 갱신. `livepaper.json`(웹용 상태), `live_paper.log`(순환), `live_paper.lock`(중복 실행 방지). 연구 폴더 5GB 상한 유지.

## 실측으로 확인한 것 / 미검증
- 확인(2026-10-12 08:56~09:03, 읽기 전용): 키움 `ka10080` 1분봉 응답에 `cntr_tm`(YYYYMMDDHHMMSS)·`cur_prc`가 있고, 9:03에 9:03 봉이 반환됨. 응답에는 NXT 시간대(예: 10/8 19:59) 봉도 섞여 있어 엔진은 **오늘 09:00 이후 봉만** 쓴다. DB 사본에서 실제 시세로 6종목×3전략 가상 매수가 정상 기록됨(운영 DB 미사용).
- **미검증**: 호가(`ka10004`) 최우선 호가 필드명, 1분봉 가격이 KRX 단독인지 KRX+NXT 합산인지, 거래정지·관리종목 조회, 호출 한도(현재 호출 간격 0.35초·감시 30종목 상한으로 제한). 이 값들을 확정값처럼 쓰지 않는다.
- 미구현: 장중 KOSPI 대비 성과(지수 수집 미연결), 호가 기반 체결 판정.

## 텔레그램
- 모든 알림에 `[모의매매]`·'가상 체결·실계좌 주문 아님'. `watch_live_paper`가 `lp_events`를 커서(`lp_last_id`)+대기열 키로 한 번만 발송(한 주기 묶음 1통). 후보 선정·가상 매수/매도·신호·장 마감 계좌·시세 단절/복구·엔진 재시작·달력 오류·LIVE_SELL 감지.
- `/sim`(읽기 전용): `livepaper.json` 요약. 기존 명령 유지.

## 운영 방법(승인 후)
```powershell
powershell -ExecutionPolicy Bypass -File quant-autotrade\research\install_live_task.ps1
```
- `AutotraderLivePaper` 작업(평일 08:50 + 로그온 2분 뒤)을 등록한다. 텔레그램 변경(`tg_*.py`)과 `server.py`(`/api/research`의 `livePaper`)는 `local_bot\install_bot.ps1` 후 봇 재시작이 필요하다.
- 상태 확인: `python <데이터 폴더>\research_app\quant-autotrade\research\live_paper_job.py --status`

## 다음 거래일에 확인할 것
1. `live_paper.log`·`livepaper.json`에서 엔진 시작·후보 선정(`NO_CANDIDATES` 여부)·`feedOk`.
2. 09:00~09:30 사이 `BUY` 이벤트의 `quoteTs`가 당일 09시대인지, 체결가가 관측가×1.002인지.
3. 15:45 이후 `EOD_REPORT`·`lp_equity` 3행, `PENDING_EXIT` 포지션이 다음 날 처음 관측가로 체결되는지.
4. 텔레그램 `[모의매매]` 알림이 한 번만 오는지.

## 가동 현황 — 2026-10-12 PC 반영 (코드는 PR #625로 master 병합, 병합 커밋 `37f8a2b7`)
- **반영함**: `install_live_task.ps1`(작업 `AutotraderLivePaper` 등록 + `research_app` 코드 갱신 - 일봉 연구 작업도 같은 사본을 쓴다) → `install_bot.ps1 -NoTask`(봇 5개 파일 반영·재시작, 감시 작업·`.env`·DB 불변). 로그온 상태에서만 실행되는 모드(`S4U`는 권한 거부) - **PC가 켜져 로그온돼 있어야 한다**(08:50, 20:15).
- **오늘(10/12)은 거래 없음**: 옛 코드가 10/9 휴장을 몰라 10/8 스캔을 `STALE_SCAN`으로 7번 거절해 후보가 0건이었고, 수정 코드는 09:13에야 나왔다. 09:00 이후에는 만료라 늦게 후보를 만들어 09:30 전 몇 분 사이에 사지 않는다. 엔진은 10/12 09:25에 정상 시작해 `NO_CANDIDATES`를 기록했다.
- **첫 거래일은 10/13(화)**: 오늘 밤 20:15 일봉 연구 작업이 10/12 스캔으로 후보를 만들고 → 10/13 08:50 장중 실행기가 09:00~09:30에 가상 매수.
- 사본 DB 재현(운영 DB 불변): 수정 코드 + 실제 10/8 스캔 → 안정화 1회 대기 뒤 후보 39건(이중바닥 20·역헤드앤숄더 4·이평구름 9·눌림목 6). 그 후보로 실제 키움 시세(읽기 전용) → 4종목×3전략 가상 매수 12건, +2% 갭 2종목 `SKIPPED`.
- 같은 날 고친 것: `live_paper_job.py --status`가 엔진 시작 전(계좌 행 없음)에 죽던 문제.
- 웹: 봇 `/api/research`가 `livePaper`(`orderApi=none`, `liveSellActive=false`)를 돌려준다. 텔레그램 `[모의매매]` 엔진 시작·후보 없음 알림 발송(`SENT`) 확인.
- 발견: 포트 8765에 다른 세션의 정적 `http.server`가 봇과 함께 바인딩돼 봇 로컬 API(운영센터·`/api/research`)를 가렸다. 로컬 개발 서버는 8765를 쓰지 않는다.
