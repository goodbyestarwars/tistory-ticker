# quant-autotrade — 자동매매 연구·운영 프로젝트

개인용 자동매매 프로젝트의 소스·테스트·설계 문서를 한곳에 모은 폴더다. 사이트(Tistory 스킨, GAS, VM FastAPI)와 코드는 섞지 않는다.
**현재 작업 브랜치 `fix/trade-priority-day-swing-long-20261026`의 [Draft PR #1036](https://github.com/goodbyestarwars/tistory-ticker/pull/1036)은 코드·오프라인 검증 단계이며 `master` 병합과 PC/VM 적용은 보류한다.** 연구·모의 매매는 실주문이 아니며, 2026-10-19의 별도 실계좌 활성 승인 이력은 [운영 현황](docs/LIVE_OPERATIONS.md)에서 확인한다. 현재 PC 활성 여부는 미확인이다.

## 폴더

| 폴더 | 내용 | 실행 위치 |
|---|---|---|
| `local_bot/` | 로컬 관제 봇·조회 API와 **별도 승인 게이트가 있는** PC 실계좌 runner/engine/9Pay 주문 어댑터. 봇 감시 기능과 주문 엔진을 구분 | 사용자 PC |
| `research/` | 연구 후보 생성기(`candidate_gen.py`), 평일 자동 실행 작업(`research_job.py`), 작업 스케줄러 등록 스크립트, 테스트 | 사용자 PC (읽기 전용) |
| `backtest/` | 검색기×청산 전략 백테스트, 일별 포트폴리오 시뮬레이터, 시장 추세 필터 비교 (오프라인) | 개발 PC |
| `local_collector/` | 키움 모의서버 읽기 전용 실측 도구(probe) | 사용자 PC |
| `mockups/` | 웹 운영센터 UI 시안(DEMO 데이터, 정적 HTML) | 브라우저 |
| `docs/` | **자동매매 문서의 공식 위치**: [매매규칙](docs/TRADING_RULES.md) · [실계좌 운영/PC 적용](docs/LIVE_OPERATIONS.md) · [검증/모의](docs/STRATEGY_TESTS.md) · [변경 이력](docs/CHANGELOG.md) · [과거 원문](docs/NINEPAY_LIVE_TRADING_HISTORY.md) 및 세부 연구·스케줄 문서 | — |

백테스트·후보 생성기는 저장소의 `scripts/analysis/signal_backtest.py`, `scripts/cloud-vm/pattern_detect.py` 등 기존 모듈을 읽기 전용으로 가져다 쓴다(수정하지 않는다).

## 올리지 않는 것 (`.gitignore`로 차단)

API 키·토큰·계좌번호·비밀번호, `.env`, `.token`, `config.json`, SQLite DB(`*.db`), 로그, `status.json`, 실거래·모의 기록, 분봉·호가 원본, 실행용 복사본(`research_app/`), 캐시(`*.pkl`, `*.csv`). 문서에는 PC 사용자명·절대경로·IP를 적지 않는다.

## 구조 한눈에

```
장 마감 → (운영 VM) 20:10 일일 스캔 시작, 저장은 23:58 KST까지 밀림
        → (사용자 PC) 평일 20:15부터 10분 간격으로 /pattern-scan 완료 판정 → 연구 후보 1회 생성 → 다음 거래일 모의 진입·성과 기록
        → 상태(status.json) → 로컬 봇 API /api/research → 웹 운영센터(UI 시안 단계)
```

연구 후보 생성 경로는 `RESEARCH`·`live_eligible=0`로 기록하며 [초기 백테스트](docs/PLAN_2026-10-11.md)에서 수익성 기준을 통과한 전략은 없었다. **하지만 PC 실계좌 주문 엔진은 별도 경로·승인으로 과거 활성화된 기록이 있다.** 연구 상태값만 보고 현재 실계좌 주문이 비활성이라고 단정하지 않는다. 두 경로의 계약과 실제 PC 버전 차이는 [LIVE_OPERATIONS.md](docs/LIVE_OPERATIONS.md)에서 별도 확인한다.

## 개발 규칙

1. 기능을 만들면 테스트를 돌리고 작업 브랜치에 commit·push한다.
2. 테스트: `python -m unittest discover -s quant-autotrade/research`, `python -m unittest discover -s quant-autotrade/local_bot -p "test_*.py"` (저장소 루트에서).
3. 키·토큰·계좌 값은 채팅·코드·문서·로그에 쓰지 않는다. 설정은 PC의 `.env`에서만 읽는다.
4. **자동매매 정책 변경은 이 폴더의 `docs/CHANGELOG.md`에 먼저 기록**하고, `docs/TRADING_RULES.md`·`LIVE_OPERATIONS.md`·`STRATEGY_TESTS.md`에서 각자 소유한 내용을 갱신한다. 작업 인수인계는 `docs/HANDOFF_*.md`로 연결한다. 사이트 `docs/WORK_HISTORY.md`에는 중요 변경의 짧은 요약과 링크만 남긴다.
