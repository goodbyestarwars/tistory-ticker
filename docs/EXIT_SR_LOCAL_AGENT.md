# 로컬(Windows) Claude/Codex 실행 지시 — 지지·저항 청산 연구 (읽기 전용)

PR #794(`research/exit-support-resistance`)는 **병합 보류**다. 이 문서는 PC에서 연구를 한 번에 돌리는 지시서다.

## 로컬 에이전트에게 줄 지시문
> PowerShell 에서 아래 한 줄만 실행하고 출력 전체를 보고해. 다른 변경은 하지 마.
> ```powershell
> $b="C:\Users\goodb\exit_sr_study"; New-Item -ItemType Directory -Force $b | Out-Null; if(-not (Test-Path "$b\repo\.git")){git clone --branch research/exit-support-resistance --single-branch https://github.com/goodbyestarwars/tistory-ticker.git "$b\repo"}; powershell -ExecutionPolicy Bypass -File "$b\repo\scripts\research\bootstrap_exit_sr.ps1"
> ```
> 금지: `C:\Users\goodb\autotrader` 파일 수정/삭제, 실제 주문, `AutotraderLiveTrading` 예약 작업 변경·재시작, 운영 DB 쓰기, `.env`/원장/분봉 내용 출력·업로드, 스크립트 수정. 실패하면 출력된 `[실행 불가:코드]` 메시지만 그대로 보고한다.

## 스크립트가 하는 일
1. 점검: Python 3.8+, git, 운영 폴더·`live_orders.db`·`.env` 변수 이름(값은 읽지 않음), 장중 여부(평일 08:50~15:40에는 키움 토큰 발급이 가동 중인 엔진과 겹칠 수 있어 중단; 장 마감 후 실행), 작업 폴더가 운영 폴더 밖인지.
2. 저장소: `C:\Users\goodb\exit_sr_study\repo` 전용 사본(기존 clone·작업 중 변경은 건드리지 않음).
3. 장부 스냅샷(SQLite 읽기 전용 + 온라인 백업)·PC 엔진 파일 해시/상수 대조(`engine_check.json`).
4. 네이버 일봉 캐시 자동 확보: 거래일 달력(005930), 국면 대용(069500), 거래 종목만 받는다(전 종목 5년 캐시 불필요). 실패하면 원인을 보고하고 중단.
5. 키움 1분봉 조회 전용 수집 → A / A_cycle / B_SR / C_SR 비교.
6. `C:\Users\goodb\exit_sr_study\out\RESULT.md`: 하이브·파인엠텍·제주항공 + A/B/C 비교만 정리. 같은 폴더의 `summary.json`·`trades_abc.csv`·`cases.json`·`coverage.json`과 `..\engine_check.json`이 익명 요약이다.

종료 코드: 0 성공, 2 조건 미충족(원인 출력), 3 일봉 캐시 확보 실패.
