# 자동매매 정책·승인·검증 변경 이력

## 2026-10-29 kt00018 유량제어 코드 준비 (운영 미적용)

공통 OS 잠금·0.55초 대기, 잔고 실패/부분응답 차단, 조회 클라이언트 교착 수정과 주문 인증 자동 재전송 차단. 전략·예산·우선순위 불변. [구조·검증·적용/롤백](KT00018_RATE_LIMIT_2026-10-29.md). master/PC/VM 변경·실주문 없음.


## 2026-10-28 확정 화면과 실주문 계약 분리 (미배포)

신규 검증은 Shadow 전용이며 기존 A/B 진입·예산·청산 조건은 유지한다. PC 수신 경계에서 Shadow/UI 계약 거부·재수신 중복 제거, VM에서 무효화된 이벤트 즉시 제외를 추가했다. 운영 PC/계좌 승인/환경변수/예약 작업/서비스는 변경하지 않았다. [구현·검증·한계·롤백](../../docs/NINEPAY_INTEGRATED_CONFIRMATION.md).

> 이 파일은 자동매매 상세 변경 이력의 **공식 진입점**이다. 날짜는 KST. 과거 문서를 삭제·고쳐 쓰지 않고 각 사건의 출처를 연결한다. `docs/WORK_HISTORY.md`에는 짧은 변경 요약만 기록한다.
>
> **기록의 상태**: 제안/코드 준비/오프라인 테스트/PR/PC 설치/운영 활성화/실측 완료는 서로 다른 상태다. 한 단계가 완료됐다고 다른 단계가 자동 완료되지 않는다.

| 날짜 | 구분 | 변경·판정 | 실제 운영 근거 |
|---|---|---|---|
| 2026-10-11 | 연구 | 여러 전략 백테스트에서 통과 전략 없음. 연구 후보는 `RESEARCH/live_eligible=0` | [초기 결과](PLAN_2026-10-11.md) |
| 2026-10-14 | 최초 실계좌 준비·승인 기록 | 100만원 예산·3종목×30만원·10만원 유보, 계좌 지문·날짜 승인 게이트. **현재 규칙 아님** | [당시 제안 정책](PROPOSED_SINGLE_ACCOUNT_POLICY_2026-10-13.md) |
| 2026-10-16 | 매도 정책 승인 기록 | -3% 2회, -5% 즉시, +3% 최고가 후 고점 -2.5% 2회; 고정 +6% 익절 폐지 | [청산 변경](LIVE_EXIT_RULES_2026-10-16.md) |
| 2026-10-19 06:56 | **PC 설치 기록** | 9Pay runner·기존 엔진·신호 수신기·주문 어댑터 4파일 백업·설치 | [과거 운영 기록](NINEPAY_LIVE_TRADING_HISTORY.md) |
| 2026-10-19 07:18 | **사용자 활성 승인 기록** | 9Pay 별도 실계좌 스위치 활성 승인 이력. **현재 설정값 미확인** | [과거 운영 기록](NINEPAY_LIVE_TRADING_HISTORY.md) |
| 2026-10-19 09:29 | **PC 적용 기록** | 최대 종목 수 제한 해제, 종목당 30만원·총 100만원·유보 10만원 유지 | [과거 운영 기록](NINEPAY_LIVE_TRADING_HISTORY.md) |
| 2026-10-20 | VM 피드 장애 수정 | 순위 조회 중 체결 큐 누락 재현·보호. 실거래 주문 정책 무변경 | [피드 장애 기술 기록](../../docs/NINEPAY_FEED_INCIDENT_2026-10-20.md) |
| 2026-10-22 | **코드·테스트만** | 100만원당 1종목, 현재 최대 1종목·상한 90만원. **PC 미설치** | [과거 운영 기록](NINEPAY_LIVE_TRADING_HISTORY.md) |
| 2026-10-23 | **코드·테스트만** | 9Pay 70% 관측 및 기존 엔진 진입 14:00까지 확장. **PC 미설치** | [과거 운영 기록](NINEPAY_LIVE_TRADING_HISTORY.md) |
| 2026-10-26 | **PR #1036** | 단타→스윙→중장기 순위, 중복 우선순위, 14시 신호·매수 차단 경계 정합화 | [PR #1036](https://github.com/goodbyestarwars/tistory-ticker/pull/1036) |
| 2026-10-26 | **GitHub CI 성공** | 새 오프라인·모의 안전 회귀 61건 + 하위 26건, 큐 5건 및 공통 회귀 통과 | [9Pay Actions](https://github.com/goodbyestarwars/tistory-ticker/actions/runs/40335750430) · [공통 Actions](https://github.com/goodbyestarwars/tistory-ticker/actions/runs/40335750317) |
| 2026-10-27 | **문서 정리만** | `TRADING_RULES` / `LIVE_OPERATIONS` / `STRATEGY_TESTS` / `CHANGELOG`를 정식 문서 체계로 정리, 기존 기록 보존 | 이번 PR 문서 커밋 |

## 이후 변경 시 기록할 것

1. 날짜/KST·요청·종전 수치·신규 수치·영향 받은 전략/코드.
2. 상태(제안/코드/테스트/PR/master/VM/PC 설치/실거래 활성/장중 관측)를 각기 분리.
3. 승인 범위, 테스트 링크, PC 설치 해시 검증 결과 **기밀 없는 요약**, 롤백 방법.
4. 기존 금지 상품·주문 안전장치가 보존됐는지와 미확인 사항.

정책 본문은 [TRADING_RULES.md](TRADING_RULES.md), 운영 확인은 [LIVE_OPERATIONS.md](LIVE_OPERATIONS.md), 검증은 [STRATEGY_TESTS.md](STRATEGY_TESTS.md)에 한 번만 쓴다. 과거 전체 서술은 [NINEPAY_LIVE_TRADING_HISTORY.md](NINEPAY_LIVE_TRADING_HISTORY.md)에서 원문 보존한다.
