# quant-autotrade — 자동매매 연구·운영 프로젝트

개인용 자동매매 프로젝트의 소스·테스트·설계 문서를 한곳에 모은 폴더다. 사이트(Tistory 스킨, GAS, VM FastAPI)와 코드는 섞지 않는다.
**작업 브랜치는 `feature/quant-autotrade-2`이며, `master` 병합과 운영 배포는 별도 승인 전까지 하지 않는다.** 실계좌 주문 기능은 활성화하지 않는다.

## 폴더

| 폴더 | 내용 | 실행 위치 |
|---|---|---|
| `local_bot/` | 로컬 봇(키움 잔고 조회·감시 종목 손절/익절·로컬 API `127.0.0.1:8765`). 매수 기능 없음, 매도는 `LIVE_SELL=true`일 때만 | 사용자 PC |
| `research/` | 연구 후보 생성기(`candidate_gen.py`), 평일 자동 실행 작업(`research_job.py`), 작업 스케줄러 등록 스크립트, 테스트 | 사용자 PC (읽기 전용) |
| `backtest/` | 검색기×청산 전략 백테스트, 일별 포트폴리오 시뮬레이터, 시장 추세 필터 비교 (오프라인) | 개발 PC |
| `local_collector/` | 키움 모의서버 읽기 전용 실측 도구(probe) | 사용자 PC |
| `mockups/` | 웹 운영센터 UI 시안(DEMO 데이터, 정적 HTML) | 브라우저 |
| `docs/` | 계획서·결과 보고(`PLAN_*.md`), 스케줄러 문서(`SCHEDULER.md`), 인수인계(`HANDOFF_*.md`) | — |

백테스트·후보 생성기는 저장소의 `scripts/analysis/signal_backtest.py`, `scripts/cloud-vm/pattern_detect.py` 등 기존 모듈을 읽기 전용으로 가져다 쓴다(수정하지 않는다).

## 올리지 않는 것 (`.gitignore`로 차단)

API 키·토큰·계좌번호·비밀번호, `.env`, `.token`, `config.json`, SQLite DB(`*.db`), 로그, `status.json`, 실거래·모의 기록, 분봉·호가 원본, 실행용 복사본(`research_app/`), 캐시(`*.pkl`, `*.csv`). 문서에는 PC 사용자명·절대경로·IP를 적지 않는다.

## 구조 한눈에

```
장 마감 → (운영 VM) 20:10 일일 스캔 시작, 저장은 23:58 KST까지 밀림
        → (사용자 PC) 평일 20:15부터 10분 간격으로 /pattern-scan 완료 판정 → 연구 후보 1회 생성 → 다음 거래일 모의 진입·성과 기록
        → 상태(status.json) → 로컬 봇 API /api/research → 웹 운영센터(UI 시안 단계)
```

연구 후보는 항상 `RESEARCH`·`live_eligible=0`이다. 백테스트 결과 수익성이 검증된 전략이 없어 실제 매수는 비활성이다(`docs/PLAN_2026-10-11.md`).

## 개발 규칙

1. 기능을 만들면 테스트를 돌리고 작업 브랜치에 commit·push한다.
2. 테스트: `python -m unittest discover -s quant-autotrade/research`, `python -m unittest discover -s quant-autotrade/local_bot -p "test_*.py"` (저장소 루트에서).
3. 키·토큰·계좌 값은 채팅·코드·문서·로그에 쓰지 않는다. 설정은 PC의 `.env`에서만 읽는다.
4. 중요 변경은 `docs/WORK_HISTORY.md`가 아니라 이 폴더의 `docs/HANDOFF_*.md`에 먼저 기록하고, `master` 병합 시 사이트 `docs/WORK_HISTORY.md`에 요약한다.
