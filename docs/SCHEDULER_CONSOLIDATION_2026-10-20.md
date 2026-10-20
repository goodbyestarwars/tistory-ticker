# 스케줄러 통합·운영 기준 (2026-10-20)

이 문서는 실행 계약과 변경 전 기준을 기록한다. 시각은 KST이다. 실계좌 예약 작업·주문·A/B 판정·자금·청산 규칙은 범위 밖이며 그대로 둔다.

## 변경 전 실측

| 주체 | 입력 → 실행 → 출력 | 마지막 확인과 문제 |
|---|---|---|
| PC `AutotraderCandidates` | 공개 `/pattern-scan` → `candidate_job.py` → `research.db` 후보 | 평일 20:15, 10/19 결과 코드 0. 모의 평가·`status.json` 갱신은 하지 않는다. |
| PC `AutotraderResearch` | 같은 `/pattern-scan` + 키움 조회 전용 일봉 → `research_job.py` → 같은 `research.db` 후보·모의 평가·`status.json` | 평일 20:15와 로그인 2분 후 **중복 로그인 트리거 2개**. 마지막 실행 10/13 21:29, 결과 267014. 로그·상태는 10/13 23:39에 멈춤. 과거 비활성화 이력과 작업 종료 중 무엇이 직접 원인인지는 Windows 작업 기록이 없어 확정 불가. 잠금 PID는 죽은 프로세스였다. |
| VM `dailyscan` | 키움 일봉 + KIS/키움 수급 → SQLite `daily_prices`·`investor_flow_daily`, `daily_scan_cache.json` | 10/19 20:10:05~23:41:36 (**3시간31분31초**). 3,918개 중 패턴 1,995·눌림목 1,949. 누적 12,619초 중 OHLC API 3,953초, 수급 API 5,920초, 의도한 호출 간격 1,960초. API 호출이 78%, 간격이 16%라 단순 타이머 변경으로 해결되지 않는다. |
| VM 후속 | 같은 SQLite 일봉 → ETF/각도/공파산/52주, 21:00 재무·수급 배치, 월 21:10 비ETF 전략 | 공용 `.scan_serial.lock`으로 직렬 실행. 10/19 ETF 23:41:56, 각도 23:46:37, 공파산 10/20 00:00:18, 52주 00:00:27, 배치 02:24:51, 주간 비ETF 03:17:06 완료. 타이머 시작 시각과 실제 계산 시작 시각이 달랐다. |
| VM 유지보수 | 5분 배포 점검에서 03~05시 재시도 → 뉴스·분석 DB 백업 후 보존 정리 | 성공 마커 **2026-09-27**. 10/11 수동 백업 후에도 일일 자동 완료 없음. 후속 스캔·뉴스 모멘텀의 연속 잠금에 `flock -n` 재시도가 굶었다. 백업 전 유지보수 제거 금지. |
| GitHub DCF | 30분 간격 + 제한된 이어받기 → DART 원천 → `dcf-data/` 정적 기록 | 10/20 02:29 정기 실행 성공·커밋. `scripts/build_dcf_data.py`는 공통 `dart_client`를 재사용하나 VM `batch_scan.py`와 실행 위치·캐시·인증·데이터 범위가 달라 원시 응답의 안전한 교차 공유는 현재 없음. |
| GitHub 차트 이력 | 토 09:15 → 공개 원천 → `data/chart-history/` | 10/17 성공. 고유 주기를 유지한다. |
| GAS | 방문 요청 시 캐시, 소스 변경 시 Actions 배포 | 10/15 clasp 배포 성공. 일별 온도 트리거는 편집기 등록 여부를 별도 확인해야 한다. |

## 적용 계약

1. PC 후보 생성은 `AutotraderResearch` 한 작업이 소유한다. `AutotraderCandidates`의 예약 작업은 XML과 설치 소스·SQLite 무결성 백업 후 비활성화한다. 레거시 `candidate_job.py` 실행도 `research_job.py`로 들어가 공용 잠금·DB·상태·모의 분석을 공유한다. `AutotraderLivePaper`는 계속 비활성이다.
2. VM 기본 스캔은 원천 일봉을 한 번 SQLite에 저장한다. ETF·각도·공파산·52주·배치·주간 비ETF는 각자 독립 판정 로직과 주기를 유지하며 공용 잠금 안에서 그날의 `daily_scan_cache.json.generatedAt`을 확인한 뒤 계산한다. 휴장일은 이전 결과를 유지하고, 원천이 없거나 전일이면 실패를 기록한다. 시작·대기·실행 초를 저널에 남긴다.
3. 유지보수는 03시부터 **대기자 하나**를 공용 잠금에 등록한다. 최대 4시간 대기하며 다른 스캔과 동시에 실행하지 않는다. 백업은 기존 `VACUUM INTO`·무결성 검사에 성공한 뒤에만 날짜 마커를 기록한다. 실패 시 기존 데이터와 작업을 유지하고 다음 회차에 재시도한다.
4. 공개 VM `/health/schedules`는 systemd 실행·다음 시각과 유지보수 마커만 제공한다. 인증된 로컬 봇 `/api/schedules`는 Windows 작업 이름·결과·시각만 제공한다. 운영센터는 공개 Actions 실행 결과도 묶어 다섯 상태를 표시한다. 계좌·명령줄·토큰은 응답에 포함하지 않는다.
5. GitHub Actions와 GAS의 고유 주기는 유지한다. 참조·실행 증거가 충분하지 않은 `kind-probe-tmp`나 GAS 설치형 트리거는 임의로 비활성화하지 않는다.

## 원상복구·검증

PC 적용 스크립트 `quant-autotrade/research/consolidate_tasks.ps1`는 두 예약 작업 XML, 기존 설치 소스, 무결성 검사를 통과한 연구 DB 사본을 별도 폴더에 보관한다. `-RollbackPath`로 작업·설치 소스를 복원할 수 있다. 원본 DB·상태·로그는 덮어쓰지 않는다. 사이트·VM 배포 전에는 관련 Python 테스트, JavaScript 구문, 스케줄 시각 계약을 확인한다. 운영 확인에는 VM `/health/schedules`, `/health/load`, 일일 스캔 저널의 `waitSec`·`runSec`, 유지보수 날짜 마커와 백업 무결성 기록을 사용한다.

## 10월 20일 현장 적용 확인

- 09:18 KST PC 연구/후보 작업 XML과 설치 소스, `research.db` 사본을 `C:\Users\goodb\autotrader\scheduler-backup-20261020-091804`에 보관했다. 사본 SQLite `integrity_check=ok` 확인 후 연구 작업의 로그인 트리거 2→1, 후보 작업 `Ready`→`Disabled`를 확인했다. 전체 PC 작업 수는 그대로 5개이며 활성 작업 수만 4→3개가 됐다.
- `AutotraderLiveTrading`은 08:55 시작 후 당시 `Running`이었다. 적용 전후 작업 XML SHA-256은 `028770691BCFD3915234D7178ED02202B0CA6A7B89C8BA1D77D53EA49BA611D7`로 같고, `AutotraderLivePaper`는 계속 `Disabled`다. 실거래 실행 중 PC Bot 재시작은 보류했다.
- 연구 작업의 마지막 성공 기록은 여전히 10/13이다. 다음 20:15 실행 전까지 복구 성공을 단정하지 않는다. 10/13 중단의 직접 원인은 작업 기록 부재로 미확정이다.
