# 로컬(Windows) Claude/Codex 실행 지시 — 지지·저항 청산 연구 (읽기 전용)

PR #794(`research/exit-support-resistance`)는 **병합 보류**다. 이 문서는 PC에서 연구를 한 번에 돌리는 지시서다.

## 로컬 에이전트에게 줄 지시문
> PowerShell 에서 아래 한 줄만 실행하고 출력 전체를 보고해. 다른 변경은 하지 마.
> ```powershell
> $b="C:\Users\goodb\exit_sr_study"; New-Item -ItemType Directory -Force $b | Out-Null; if(-not (Test-Path "$b\repo\.git")){git clone --branch research/exit-support-resistance --single-branch https://github.com/goodbyestarwars/tistory-ticker.git "$b\repo"}; powershell -ExecutionPolicy Bypass -File "$b\repo\scripts\research\bootstrap_exit_sr.ps1"
> ```
> 금지: `C:\Users\goodb\autotrader` 파일 수정/삭제, 실제 주문, `AutotraderLiveTrading` 예약 작업 변경·재시작, 운영 DB 쓰기, `.env`/원장/분봉 내용 출력·업로드, 스크립트 수정. 실패하면 출력된 `[실행 불가:코드]` 메시지만 그대로 보고한다.

## 실행 순서 (권장)
1. 입력 구조 점검 + 자료 충족 예상만 먼저: `bootstrap_exit_sr.ps1 -Mode audit` — 장부/`research.db`/체결 파일의 실제 구조, 장부 note 키 이름, 포착 이력 4종 건수·기간을 출력하고 어댑터 가정과 다르면 경고한다(값·주문번호는 읽지 않는다, 분봉 수집 없음). 부족한 기간·검색기가 여기서 먼저 보인다.
2. 전체 실행: `bootstrap_exit_sr.ps1`(기본 `-Mode all`) — 검색기 전체 가상 백테스트(`out_universe\RESULT_UNIVERSE.md`)와 실제 원장 분석(`out\RESULT.md`, 실제 매도 vs A_cycle 재현 일치율 = 백테스트 현실성 검증 포함).

## 연구 범위 (2026-10-21 수정: 검색기 전체 우선)
- **universe(우선)**: 실제 매수 여부와 무관하게 검색기 4종(pullback·maCloudBreakout·doubleBottom·invHeadShoulders)의 과거 포착 이력 전체를 같은 진입(다음 거래일 09:01 시가+0.1%, 기준가 +2% 이상 갭 제외)·같은 비용에서 A / A_cycle / B_SR / C_SR로 비교한다. 결과: `out_universe\RESULT_UNIVERSE.md`(전체·검색기별 A/B/C 표, 동시 보유 3슬롯 반영, 워크포워드, 국면별, 최종 판정 4택1).
- **ledger**: 실제 원장 거래 분석(`out\RESULT.md`, 하이브·파인엠텍·제주항공은 해석용 사례). universe와 섞지 않는다.
- 포착 이력은 공개 `/scan-performance-public`(검색기당 최대 1500건)에서 받는다. 더 긴 이력이 필요하면 VM `scan_hits` 전체 덤프 JSON을 `-HitsFile`로 준다(원장·키가 아니라 포착 이력만; 업로드 불필요, PC 안에서만 사용).
- 9Pay A/B 장중 단타와 4종 외 검색기는 진입 시각을 검증할 수 없어 제외 사유로 건수만 기록한다(9Pay A/B 과거 신호 이력이 PC에 있으면 별도 집단으로 추가 가능 - 현재 미구현).
- 분봉은 키움이 제공하는 기간까지만 있다. 그 이전은 일봉·5분봉으로 대체하지 않고 `BEYOND_MINUTE_DATA_WINDOW`로 제외하며 보유 기간을 결과에 표기한다. 검증 100건·3개월·분봉 충족률 70% 미만이면 **판정 보류**다.

## 스크립트가 하는 일
1. 점검: Python 3.8+, git, 운영 폴더·`live_orders.db`·`.env` 변수 이름(값은 읽지 않음), 장중 여부(평일 08:50~15:40에는 키움 토큰 발급이 가동 중인 엔진과 겹칠 수 있어 중단; 장 마감 후 실행), 작업 폴더가 운영 폴더 밖인지.
2. 저장소: `C:\Users\goodb\exit_sr_study\repo` 전용 사본(기존 clone·작업 중 변경은 건드리지 않음).
3. 장부 스냅샷(SQLite 읽기 전용 + 온라인 백업)·PC 엔진 파일 해시/상수 대조(`engine_check.json`).
4. 네이버 일봉 캐시 자동 확보: 거래일 달력(005930), 국면 대용(069500), 거래 종목만 받는다(전 종목 5년 캐시 불필요). 실패하면 원인을 보고하고 중단.
5. 키움 1분봉 조회 전용 수집 → A / A_cycle / B_SR / C_SR 비교.
6. `C:\Users\goodb\exit_sr_study\out\RESULT.md`: 하이브·파인엠텍·제주항공 + A/B/C 비교만 정리. 같은 폴더의 `summary.json`·`trades_abc.csv`·`cases.json`·`coverage.json`과 `..\engine_check.json`이 익명 요약이다.

종료 코드: 0 성공, 2 조건 미충족(원인 출력), 3 일봉 캐시 확보 실패.

## 백테스트 수치 신뢰성 진단 (`-Mode diagnose`)
이미 만들어 둔 `exit_sr_study` 산출물(`out_universe\trades_abc.csv`, `minbars`, `naver`)만 읽어 `out_diagnose\DIAGNOSIS.md`·`diagnose.json`을 새로 만든다. 키움 재수집·운영 폴더 접근 없음(장중에도 가능). 비용 분해(원가격→슬리피지→비용), 분포, 엔진 필터 부분집합, 단순 보유 기준, 상관·중복, 시뮬레이터 현실성, MDD 해석을 담는다.
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\goodb\exit_sr_study\repo\scripts\research\bootstrap_exit_sr.ps1" -Mode diagnose
# 실제 계좌 왕복 비용(수수료+세금, %)을 확인했다면: -RealCost 0.25  (확인 전에는 쓰지 말 것)
```

## 최종 판단 보고서 (`-Mode decision`)
기존 산출물(`out_universe\trades_abc.csv`, `minbars`, `naver`, `out\summary.json`)만 읽어 `out_decision\SCANNER_EXIT_DECISION.md` 하나를 만든다(키움·운영 폴더 접근 없음, 장중에도 가능). 선별 후보 점수 5개를 학습 구간에서 하나로 고정해 검증 구간에 적용하고, 같은 종목에서 A/B/C 청산을 비교하며, 실제 원장 재현이 70% 미만이면 청산 우열을 판정하지 않는다.
```powershell
git -C C:\Users\goodb\exit_sr_study\repo pull --ff-only
powershell -ExecutionPolicy Bypass -File "C:\Users\goodb\exit_sr_study\repo\scripts\research\bootstrap_exit_sr.ps1" -Mode decision
```
