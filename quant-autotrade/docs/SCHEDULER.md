# 연구 후보 생성기 — Windows 작업 스케줄러 운영 문서

읽기 전용 작업이다. 키움 주문 API는 호출하지 않고, 키움 **일봉 조회**(모의 진입·청산 판정용)와 운영 서버의 공개 `GET /pattern-scan`만 쓴다.

## 동작

| 항목 | 값 |
|---|---|
| 실행 요일 | 월~금 |
| 감시 시작 | 20:15 KST |
| 확인 간격 | 10분 |
| 확인 종료 | 다음 날 08:15 (금요일 밤 시작분은 토요일 08:15) |
| 후보 생성 | 스캔이 확정되면 **한 번만**. 같은 `scannedAt`으로는 다시 만들지 않음 |
| 주말 | 토·일 저녁에는 새 거래일 스캔을 기다리지 않음. 금요일 밤 스캔이 자정을 넘겨 끝나면 토요일 새벽에 처리 |
| 놓친 실행 | PC가 꺼져 있었다면 다음 시작 때 한 번만 확인(감시 구간 밖이면 `once`). 오래된 스캔은 `STALE_SCAN`으로 거절 — 지난 후보를 소급 생성하지 않음 |

완료 판정은 `research/candidate_gen.py: check_scan`이다(시간만 보고 끝났다고 가정하지 않는다):

1. 항목들의 마지막 봉 날짜가 한 값으로 모이고, 저장 시각이 그날 20:10 이후일 것
2. 그 날짜 다음 평일 09:00 전일 것(오래된 스캔·휴장 뒤 재사용 차단)
3. 처리 종목 수가 최근 정상 회차의 90% 이상일 것(이력이 없으면 universe의 50%)
4. 같은 `scannedAt`이 3분 이상 변하지 않을 것

> 참고: 운영 서버 스캔은 20:10에 시작하지만 `scannedAt`(저장 시각)은 23:58 KST까지 밀릴 수 있다. 21:00 배치(`batch_scan.py`)는 공매도·재무 캐시용이며 패턴 결과를 만들지 않는다.

## 설치

저장소 루트에서 PowerShell로:

```powershell
powershell -ExecutionPolicy Bypass -File quant-autotrade\research\install_task.ps1
```

- 소스를 `<데이터 폴더>\research_app`으로 복사해 그 사본을 실행한다(브랜치를 바꿔도 예약 작업의 코드는 바뀌지 않음). **코드를 수정한 뒤에는 이 스크립트를 다시 실행**해야 사본이 갱신된다.
- `<데이터 폴더>` = 환경변수 `AUTOTRADER_DIR`, 없으면 `%USERPROFILE%\autotrader`. 연구 데이터·로그·상태는 그 아래 `research\`에 쌓인다. (로컬 봇 폴더와 같게 두면 `/api/research`가 바로 읽는다.)
- 인터프리터: 저장소 `.venv\Scripts\pythonw.exe`가 있으면 그것, 없으면 PATH의 `pythonw.exe`. 설치 중 sqlite3·ssl 임포트를 확인한다. 창은 뜨지 않는다.
- 트리거: 평일 20:15 + 로그온 2분 뒤(PC 재시작·절전 후 복귀 시 놓친 실행 확인). 시작 시각 트리거(부팅)는 관리자 권한이 필요해 쓰지 않는다. 작업 설정은 `StartWhenAvailable`, `MultipleInstances=IgnoreNew`.
- **로그오프 상태에서도 실행(S4U)**은 일부 PC에서 관리자 권한이 필요하다. 거부되면 "로그온 상태에서만"으로 등록되고 스크립트가 그 사실을 출력한다. 로그오프 중에도 돌리려면 **관리자 PowerShell**에서 설치 스크립트를 다시 실행한다. PC가 절전 상태이면 실행되지 않으므로 평일 밤에는 절전 해제(또는 전원 설정에서 절전 안 함)가 필요하다.
- 재부팅 후에도 작업은 유지된다(작업 스케줄러에 영구 등록).

제거: `quant-autotrade\research\uninstall_task.ps1` (복사본과 기록은 남는다).

확인: `Get-ScheduledTask -TaskName AutotraderResearch`, `Get-ScheduledTaskInfo -TaskName AutotraderResearch`(다음 실행 시각).
즉시 1회 점검(대기 없이): `python <데이터 폴더>\research_app\quant-autotrade\research\research_job.py --once`

## 안전장치

- 중복 프로세스: `research.lock`에 PID를 기록하고, 살아 있는 다른 프로세스가 쥐고 있으면 종료한다(죽은 PID·20시간 넘은 잠금은 인계). 작업 설정도 중복 실행을 막는다.
- 로그: `research\research.log`, 1MB × 5개 순환. DB는 90일 지난 스캔 관측과 365일 지난 생성 로그를 정리한다.
- 용량: `research\` 폴더 총량이 5GB에 도달하면 후보 생성을 멈추고 `status.json`에 `disk_limit`을 기록한다(실제 사용량은 수 MB 수준).
- 장애: 네트워크·키움 조회 실패는 기록 후 계속(종목 단위), 스캔 미완료는 `no_scan`으로 종료하고 이유를 남긴다.

## 상태 데이터 (웹 연동 준비)

`research\status.json`(원자적 갱신)을 로컬 봇의 `GET /api/research`(토큰 인증, 허용 Origin 1곳, `127.0.0.1` 전용 — 기존 PC→웹 경로 재사용)가 읽기 전용으로 돌려준다. 봇을 재시작해야 새 엔드포인트가 적용된다.

| 필드 | 의미 |
|---|---|
| `heartbeatAt` / `updatedAt` / `pid` | 마지막 생존 신호(PC·작업 온라인 판단) |
| `runner` | `starting` · `waiting`(스캔 대기) · `done` · `no_scan` · `disk_limit` |
| `mode` | `poll`(감시 구간) / `once`(구간 밖 1회) |
| `lastSuccessAt`, `lastScanConfirmedAt` | 마지막 정상 실행·스캔 완료 확인 시각 |
| `lastGen` | 마지막 확인 결과 `{ok, reason, created, at}` (`STALE_SCAN`, `PARTIAL_SCAN`, `WAIT_STABLE` 등) |
| `candidatesToday` | 오늘 생성된 연구 후보 수 |
| `nextRunAt` | 다음 정기 실행 예정(평일 20:15) |
| `errors`, `missingWeekdays` | 최근 오류, 후보가 생성되지 않은 평일(휴장일일 수 있음) |

`/api/research`는 위 값에 더해 모의 성과 집계(`paper`), 열린 모의 포지션 수(`openPaper`), 최근 후보 30건(`recentCandidates`)을 포함한다. 웹 화면(`js/auto-trader.js`)에는 아직 연결하지 않았다(UI 단계에서 연결).
