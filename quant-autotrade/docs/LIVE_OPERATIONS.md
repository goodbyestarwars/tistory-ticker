# 자동매매 실계좌 운영 (자동매매 전용 Google VM)

> **2026-11-04 정정(전면 개정):** 실계좌 runner·엔진·주문 어댑터·텔레그램 봇은 **자동매매 전용 Google VM**(`instance-20260712-153038`, 사용자 `autotrader`, 폴더 `~/autotrader`)에서만 동작한다. 사용자 PC 예약 작업(`AutotraderLiveTrading`)은 삭제됐다. 2026-10-19~27 기록의 "PC"는 이전 위치의 과거 사실이며 아래 이력 표에만 남긴다. 기준: `docs/HANDOFF_2026-10-30.md` §1·§3, 2026-11-04 VM 실측.

## 2026-11-04 주문 제어 패치(운영 상태는 별도)

비공개 `autotrader-private/main`: `order_guard.py` 공통 시간/STOP/수동중지/주문 잠금, `live_runner.py` 14:00 자동 종료, `control_agent.py` 웹 영구중지·수동 시작, `bot.py` 엔진 보유분 중복 매도 차단, `ninepay_signal_client.py` Shadow·시간·무효 신호 거부, `live_engine.py` 스윙 우선·미분류 제외. GitHub Actions 테스트 통과.
**미확인:** Google VM 실제 pull SHA, 기존 `/etc/sudoers.d/autotrader-control` 교체, Runner/timer 상태, 장부/보유·미체결, 계좌 승인·`STOP`·`MANUAL_STOP`, 다음 장중의 동작. 특히 sudoers 구버전이면 웹 stop에서 타이머 비활성화, 장중 웹 start에서 서비스 시작이 실패할 수 있으며 수동 주문 차단 표식은 계속 유효하다.
Google VM 설치·검증은 비공개 `control/README.md`를 따른다. SSH/실계좌 주문을 이번 GitHub 변경으로 수행했다고 해석하지 않는다.

## 2026-10-28 통합 PR의 운영 상태

확정 UI·Shadow 증거·주문 경계 변경은 작업 브랜치/PR에만 제공한다. 공개 상태는 키움 연결·Toss 미실행·9Pay 장외/20종목 한도이며 장중 400종목 정상 수신을 입증하지 않는다. [전환·롤백과 미검증 범위](../../docs/NINEPAY_INTEGRATED_CONFIRMATION.md).

> 이 문서는 운영 상태를 추정하거나 실거래 주문을 승인하지 않는다. 파일 해시·스위치·장부 값은 문서가 아니라 VM에서 직접 조회한다.

## 1. 저장소와 실제 실행 위치

| 구성요소 | 위치 | 책임 |
|---|---|---|
| `kiwoom_9pay_observer.py` | 백엔드(Oracle, `goodbyestar.cloud`) | 장중 A/B 관찰·신호·`/health/9pay`, **주문 없음** |
| `live_runner.py` (`autotrader-live.timer` 평일 08:55, `Restart=no`) | 자동매매 VM | 매도 점검 → 9Pay 단타 → 기존 후보 순회 |
| `live_engine.py` | 자동매매 VM | 예산·보유 제한·확정 일봉 순위·매도 청산·장부·`HOLD_BUY` 확인 |
| `ninepay_signal_client.py` / `ninepay_trade.py` | 자동매매 VM | 피드 검증·단타 지정가 주문 |
| `autotrader-bot` (상시) | 자동매매 VM | 잔고·텔레그램 감시, `LIVE_SELL=1`(11/04 VM 기록). 확정 감시 목록의 수동 보유만 14시 이전 매도 가능. `MANUAL_STOP`과 엔진 소유·공통 잠금으로 주문 차단 |
| `control/control_agent.py` (20초 타이머) | 자동매매 VM | 상태·주문 내역을 사이트로 업로드, 시작/중지/보류/재개 명령 수행(주문 없음) |
| `research.db`·`live_orders.db` | 자동매매 VM | 연구 후보·실거래 주문 의도/포지션, **Git에 올리지 않음** |

코드 원본은 비공개 저장소 `autotrader-private`의 `main`이며, 푸시하면 VM의 `autotrader-deploy.timer`(2분)가 fast-forward로 반영하고 장외에만 봇을 재시작한다. 공유 계좌와 장부를 사용한다. 사이트 웹화면의 연구 신호를 실주문/체결 성과로 간주하지 않는다.

## 2. 설치·운영 이력 (확인된 기록 / 확인 안 된 현재)

| 날짜(KST) | 구분 | 기록된 내용 | 현재 운영 확인 |
|---|---|---|---|
| 2026-10-19 06:56 | **PC 설치 기록(이전 위치)** | PC runner/engine/신호 수신기/주문 어댑터 4개 파일을 묶어 백업·설치. 당시 9Pay 스위치는 꺼짐 | **현재 파일 해시 미확인** |
| 2026-10-19 07:18 | **사용자 활성 승인 기록** | 기존 승인 게이트와 함께 `NINEPAY_LIVE_TRADING` 활성화 지시·기록 | 현재 값 직접 조회 못함 |
| 2026-10-19 09:29 | **PC 정책 적용 기록(이전 위치)** | 최대 3종목 제한 해제, 종목당 30만 원·총 100만 원·현금유보 10만 원 유지 | 이후 교체 여부 미확인 |
| 2026-10-22 | **GitHub 코드만** | 100만 원당 최대 1종목, 현재 1종목·최대 90만 원 | 당시 PC 미설치 → 이후 VM 이전 |
| 2026-10-23 | **GitHub 코드만** | 단타 신규 매수 14:00까지 확대, 기존 엔진 신규 진입도 14:00까지 | 당시 PC 미설치 → 이후 VM 이전 |
| 2026-10-26 | **PR #1036** | 단타→스윙→중장기 정렬, 단타 14:00 최종 경계 정합화 | 당시 PC 미확인 → 이후 VM 이전 |
| 2026-10-27 | **문서 정리** | 규칙·운영·검증·이력을 `quant-autotrade/docs`로 집중 | 운영 영향 없음 |
| 2026-11-04 | **VM 반영** | `autotrader-private` d887834(주문·보유 업로드), e4a79c0(`HOLD_BUY` 신규 매수 보류, 중지는 서비스만 정지·타이머 유지, 직접 중지 텔레그램 1회) | VM이 e4a79c0 수신 확인, 실주문 동작은 11-05 08:55 첫 실행에서 확인 |

위 10/19 설치 기록은 [보존한 과거 운영 이력](NINEPAY_LIVE_TRADING_HISTORY.md) 및 [기존 보조 자료](../../docs/NINEPAY_FEED_INCIDENT_2026-10-20.md)에 근거하며, 표의 "PC"는 이전 실행 위치(이후 VM으로 이전)다.

## 3. VM 읽기 전용 점검 체크리스트

VM에서 **자동 실행·종료·재시작 없이** 담당자가 다음을 확인해 기밀값 없이 결과만 요약한다(`ssh google-gcp`).

1. `autotrader-live.timer` 활성 여부·다음 실행, `autotrader-live.service` 마지막 결과(수동 중지는 `SIGTERM`, `status=15/TERM`으로 남으며 장애가 아니다).
2. 설치된 `live_runner.py`·`live_engine.py`·`ninepay_signal_client.py`·`ninepay_trade.py`가 `autotrader-private` `main`과 같은 커밋인지(`git log -1`). 경로/계정/키 값은 보고서에 공개하지 않는다.
3. **실제 로드된 엔진 상수**: `BUDGET`, `RESERVE`, `MAX_STOCKS`, `PER_STOCK`, `STOP_PCT`, `EMERGENCY_STOP_PCT`, `TRAIL_ARM_PCT`, `TRAIL_PCT`, `CONFIRM_CHECKS`, 진입 시간.
4. `LIVE_TRADING`, `NINEPAY_LIVE_TRADING` 활성 여부 및 승인 파일 존재·계좌 일치 여부는 **참/거짓만**. 비밀값/계좌 지문/원본 승인 파일 공유 금지.
5. 기존 포지션·미체결·불확실한 주문 의도·제외 목록 유효 여부와 잔고 여력. `HOLD_BUY`(오늘 신규 매수 보류)·`STOP` 파일 유무. 원본 장부를 복사·초기화·재구성하지 않는다.
6. 백엔드 건강 상태 및 현재 거래일 `queueDropped`, `persistenceError`, `rankError`, `amountFallback`, 순위 갱신 신선도. **누락 누계를 삭제해 신호를 허용하지 않는다.**

상태 확인만으로 자동매매 주문 가능 조건이 충족됐다는 결론을 내리지 않는다.

## 4. 배포 안전 절차

- **PR 코드 검증 → 운영 영향 분석 → 실계좌 적용에 대한 사용자 별도 구체적 승인 → 장외 유지보수 창 → `autotrader-private` `main` 반영(VM 자동 pull) → 해시/구문/호환성/읽기 점검 → 후속 장중 관측**.
- 이 저장소(`tistory-ticker`) `master` 병합은 자동매매 VM에 반영되지 않는다. 반대로 백엔드(Oracle) `master` 배포는 평일 08:00~20:00에 보류되며 피드에 영향을 주므로 의도 없이 하지 않는다.
- VM의 `.env`, 승인 파일, 계좌·제외 목록, 미체결/장부, 타이머는 자동 변경 금지. `--run` 수동 시작도 금지. 장중(08:50~15:40) 봇 재시작 금지.
- 잔고·주문 불확실·피드 누락 시 신규 매수는 차단하고 소급 주문·소급 재구성하지 않는다. 주문/체결·실제 MFE/MAE·수익성은 오프라인 모의 통과만으로 입증되지 않는다.

## 5. 지켜야 할 경계

- 10/19 설치 내역을 현재 파일 상태로 쓰지 않는다. 현재 VM 설치 상태는 3장 점검으로만 확인한다.
- `TRADING_RULES.md`는 규칙 요약, `STRATEGY_TESTS.md`는 모의/CI, `CHANGELOG.md`는 변경·승인 이력을 맡는다. 상세 당시 기록은 [과거 보존본](NINEPAY_LIVE_TRADING_HISTORY.md)과 관련 개별 기록에 남긴다.
