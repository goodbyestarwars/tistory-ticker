# 자동매매 전략 검증·모의매매 기록

## 2026-10-29 kt00018 오프라인 검증

Windows Python 3.14에서 local_bot 전체 252개 통과(89.805초), 운영 소스 복사본에 최소 패치를 적용한 신규 안전성 테스트 14개 통과(15.935초). 브로커 fake/mock, 외부 socket 차단, 로컬 fake HTTP만 허용했다. 실제 API·계좌 주문은 호출하지 않았다. 운영본 동봉 과거 테스트 60개는 수정 전/후 동일한 12개 실패(48 통과, 8 실패, 4 오류)이며 설치 fixture 누락/옛 전략 가정이 포함된다. 모두 통과한 것으로 취급하지 않는다. [검증 항목·제한·운영 적용](KT00018_RATE_LIMIT_2026-10-29.md).


## 2026-10-28 통합 검증 (운영·수익성 검증 아님)

기존 패턴/추적·입력과 PC/연구·피드 통합 478 passed + 26 subtests. 허브/종목별 수신 증거 37 passed. 신규 Shadow의 주문 의도·실주문 0건, 신호 중복/무효화·확정 봉·미래자료 차단, 비용/미완료 거래/비교군 분리 및 PC/모바일 12개 합성 화면을 검사했다. [상세](../../docs/NINEPAY_INTEGRATED_CONFIRMATION.md). 실제 체결/수익성/400종목 장중 부하 검증은 수행하지 않았다.

> 실거래 주문·체결·성과와 **백테스트 / 일봉 사후 모의 / 장중 가상체결 / PR 회귀 테스트**를 합산하지 않는다. 테스트 통과는 수익성 검증이나 실계좌 활성 승인과 다르다.

## 1. 검증 종류별 경계

| 종류 | 판정·자료 | 해석 |
|---|---|---|
| A. 과거 백테스트 | `backtest/`, [PLAN_2026-10-11.md](PLAN_2026-10-11.md) | 과거 일봉·추정 체결; 통과 전략 없음 |
| B. 일봉 사후 모의 | `research/candidate_gen.py`, [PAPER_EXITS.md](PAPER_EXITS.md) | 확정 일봉 뒤 가상 진입·청산, 실거래 아님 |
| C. 장중 실시간 모의 | `research/live_paper.py`, [LIVE_PAPER_2026-10-12.md](LIVE_PAPER_2026-10-12.md) | 관측 시세+슬리피지 가정의 가상 체결, 실거래 아님 |
| D. 코드/안전 회귀 | `local_bot/test_*.py`, `test/test_kiwoom_9pay_*.py` | 코드 경계 검증, 전략 수익성/실주문 체결 아님 |

연구 후보 `RESEARCH`·`live_eligible=0`는 연구 테이블 계약이다. 현재 PC 실거래 후보 로더와의 완전한 권한 분리 여부는 별도로 감사해야 한다.

## 2. 최신 PR #1036 오프라인 회귀

- [9Pay queue regression (2026-10-26, 성공)](https://github.com/goodbyestarwars/tistory-ticker/actions/runs/40335750430): 단타 우선·스윙/중장기 정렬·중복·미분류·유동성 게이트·14:00 이전/이후·단타 A/B·모의 주문 안전성 **61 passed + 26 subtests**, 기존 큐 안전장치 **5 passed**.
- [Shared HTTP and nightly scan regression (성공)](https://github.com/goodbyestarwars/tistory-ticker/actions/runs/40335750317). 기존 공통 API/스캔 테스트이며 매매 성과 검증은 아니다.
- 우선순위 7건: `local_bot/test_entry_priority.py`. 장중/PC 수신/주문/runner의 경계 사례는 각 `test_ninepay_*.py`, VM 관찰기 `test/test_kiwoom_9pay_observer.py`에 추가.
- 코드 PR: [PR #1036](https://github.com/goodbyestarwars/tistory-ticker/pull/1036). **실제 VM 배포·PC 설치 상태는 미확인**, 운영 장중·호가/체결 미검증.

## 3. 단타를 먼저 검증할 때 확인할 항목

1. **전량 관측 가능성**: 9Pay 구독 대상(20칸 한도), 종목 순위 120초 신선도, 최초 70%/80% 관측 시각과 키움 FID 거래량/시가 실측, KIS 폴백. 관측 공백·순위권 밖 미감시는 실제 무신호와 구분한다.
2. **신호 정확성**: A 또는 B 증거, 초기 1% 눌림, 0.3% 반등, 무효화·동일 종목 중복·10초 만료·14:00 신규 진입 차단. 처음 연구된 09:00~09:29 구간과 확대된 09:30~13:59 구간의 성과를 **별도로** 평가한다.
3. **가상 체결**: 신호가, 확인시세, 매수 지정가, 실제 체결 가능성(호가가 없으면 가정값으로 표시), 수수료/세금·슬리피지 가정, 미체결·부분체결을 분리.
4. **기존 청산**: -3% 2회, -5% 즉시, +3% 이후 고점 -2.5% 2회, 고점·카운터 재시작 유지. 일반 매도 점검이 9Pay 3초 폴링에 의해 중복 계산되지 않도록 한다.
5. **기회비용**: 단타 매수 때문에 스윙/중장기 후보가 실제로 배제됐는지를 **적격 판정·잔액·시간·중복·청산**과 함께 측정. `PRIORITY_POOL_AFTER_DAY_BUY`의 원시 건수만으로 실제 기회 손실을 주장하지 않는다.
6. **성과 지표**: 충분한 거래일·시장 국면에서 거래수, 실측 체결률, 평균 손익, 승률, 손익비, MDD, 연속 손절, 수익분포, 미체결률, 거래비용 민감도 및 비교군(단타 미적용)을 별도로 보고한다.

현재 5번의 적격 배제 건수 및 6번의 실측 수익성은 **미확인**이다. 실계좌 데이터 조회·신규 주문 테스트는 수행하지 않았다.

## 4. 기존 연구 결론 보존

- [초기 5년 일봉/검색기 연구](PLAN_2026-10-11.md): 검증 구간에서 일관된 통계적 우위로 **통과한 자동매수 검색기 없음**. 일부 포트폴리오 수익은 선택 편향·표본 한계가 있어 실매매 승인 근거가 아니다.
- [추세/청산 연구](TREND_EXIT_STUDY_2026-10-11.md), [보유/익절·청산 설계](PAPER_EXITS.md): 연구용 전략과 실계좌 2026-10-16 청산 규칙을 혼동하지 않는다.
- [VM 9Pay A/B 신호 계약](../../docs/NINEPAY_SCANNER_AB_2026-10-19.md), [거래량 피드 장애 분석](../../docs/NINEPAY_FEED_INCIDENT_2026-10-20.md): 장중 누락·성능·재현과 실제 매매 성과는 별도 문제다.

## 5. 재검증 진입점 (오프라인/읽기 전용)

- GitHub PR CI: `.github/workflows/ninepay-queue-regression.yml`에서 `test_entry_priority.py`, `test_ninepay_runner.py`, `test_ninepay_signal_client.py`, `test_ninepay_trade.py`, `test_kiwoom_9pay_observer.py`와 큐 검사를 실행한다.
- 로컬 연구·모의: `python -m unittest discover -s quant-autotrade/research`, `python -m unittest discover -s quant-autotrade/local_bot -p "test_*.py"`. 실행 위치/의존성을 확인해야 한다. 명시된 `--run` 실거래 실행은 **검증 명령이 아니다**.
- 정책·PC 해시 확인: [LIVE_OPERATIONS.md](LIVE_OPERATIONS.md)의 읽기 전용 절차. PC 직접 확인 결과 없이 운영 완료 처리하지 않는다.
