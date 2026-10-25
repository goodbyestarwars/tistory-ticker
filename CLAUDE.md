> **작업 시작 프롬프트:** CLAUDE.md와 관련 명세를 먼저 읽고 기존 공통 모듈·호출부를 확인하라. 같은 기능은 재사용하고, 부족한 기능은 공통 모듈 확장을 우선하라. 페이지별 전송·포맷터·로딩·차트·표·호가·스케줄·저장 로직의 중복 구현을 금지한다. 로드 순서·API 단위/기준일·UI 규칙·기존 동작을 보존하고, 재사용·확장한 모듈과 검증·배포 상태를 보고하라.

# 9Pay 공통 개발 정책

한국 주식시장 데이터 수집·분석·시각화 서비스. 기본·배포 브랜치는 `master`다.
운영 사이트 https://ghlee.tistory.com · VM API https://goodbyestar.cloud

## 시작 순서

1. 이 파일 → `docs/README.md` → `docs/WORK_HISTORY.md` 최근 필요한 일부만 읽는다.
2. 서비스·메뉴·공급자·DB·스케줄·자동매매 상세는 `docs/SERVICE_MAP.md`를 필요한 구간만 본다.
3. 최신 `docs/HANDOFF_*.md` 1개와 해당 작업의 원본 명세·코드·운영 응답을 대조한다.
   문서에 설정·배포 기록이 있다는 것과 현재 정상 동작한다는 것은 구분한다. 시각은 KST다.

## 수정 원칙

- 기존 기능·직접 URL·DOM/전역 객체 계약·저장 데이터·캐시를 임의 삭제하지 않는다.
- 수정 전 호출 관계와 배포 경로를 확인한다. 요청 범위 밖 변경을 섞지 않는다.
- **같은 기능은 공통 모듈을 재사용한다.** 차트는 `js/chart-core.js`와 그 모듈
  (`chart-data`, `chart-drawing`, `chart-wave-overlay`, `chart-sr` 등), 호가는 `js/order-book.js`,
  표는 `js/indicator-board.js`, 입력 효과/캐러셀은 `js/site-interactions.js`를 먼저 확인한다.
- 공통 진입점 `js/skin-shell.js`의 `NineHttp.json`(전송)·`NineAPI`(정식 경로/공통 계약/fallback)·
  `NineUI`(포맷/로딩)를 재사용한다. 화면별 transport를 새로 만들지 않고 특수 단위·표시는 호출부가 소유한다.
- VM 공통 기능은 `scripts/cloud-vm/`의 `scheduled_job.py`(실행 계약), `snapshot_io.py`(원자 JSON 저장),
  `scan_inputs.py`(일봉/확정 수급 검증·재사용), `market_calendar.py`(휴장 판정)를 먼저 확인한다.
- 새 공통 모듈이 불가피하면 기존 모듈로 해결할 수 없는 차이와 이유를 명시한다. 공통 모듈을 복사해
  별도 버전을 만들지 않고 기존 호출부의 로드 순서·응답 계약·단위·기준일을 함께 검증한다.
- VM/GAS API를 같은 것으로 가정해 바꾸지 않는다. 공급자·시장(KRX/NXT/UN)·페이로드·거래일·
  단위를 확인한다. 지연/결측/실패를 오늘 정상값이나 0으로 바꾸지 않는다.
- 키·토큰·계좌·IP·`.env`·DB·원시 로그는 Git/문서/공개 응답에 올리지 않는다.
- KRX 내부 크롤링 신규 경로 금지. KIND 시장조치 공시는 승인된 예외다(`docs/MARKET_HALT_KIND.md`).
- 데이터 파일은 `window.XXX = {...}` 형태의 `.js`다.

## UI

- PC와 모바일을 함께 유지한다. 글꼴 역할·굵기·여백은 `docs/UI_GUIDE.md`와 기존 토큰이 단일 출처다.
- MaruBuriBold 지정 제목과 Pretendard Variable 본문/숫자의 기존 역할을 준수한다.
- 전체 페이지 배경과 의미색은 유지한다. 라이트 콘텐츠 박스는 흰색 공통 면 토큰을 쓴다.
- 상승/매수 빨강·하락/매도 파랑을 유지한다. 다크는 `style.css`의 공식 `--dk-*` 토큰만 쓴다.
- 기존 레이어 안에서 수정하고 `!important`·높은 명시도·파일 끝 우회 규칙을 새로 쌓지 않는다.

## 운영·주문 경계

- VM은 e2-micro 1GB다. 전종목 데이터는 종목별로 읽고, 새 상시 프로세스/수집 주체를 늘리지 않는다.
- 공급자 호출 간격·예산을 유지한다. 일봉과 수급의 최신성·누락·실패를 독립적으로 기록한다.
- 거래중 VM 재시작은 피드 단절 위험이 있으므로 금지한다. 장외에도 배포 전 상태·회복을 확인한다.
- 실계좌 실행·재시작·주문·활성화·정책은 구체적인 사용자 승인 없이는 바꾸지 않는다.
- 인버스·레버리지 및 CD/KOFR/SOFR/MMF/머니마켓/단기채 등 현금성·금리형 신규 주문 제외를
  유지한다. 일반 ETF 전체 제외가 아니다. 피드 큐 누락값을 초기화해 신규 매수를 재개하지 않는다.
- 연구/모의 결과는 실계좌 승인으로 해석하지 않는다. `quant-autotrade/`의 별도 운영 경계를 준수한다.

## 작업별 원본

| 범위 | 먼저 확인할 원본 |
|---|---|
| 구조·호출 | `ARCHITECTURE.md`, `docs/ARCHITECTURE_SPEC.md` |
| API·운영·배포 | `API_REFERENCE.md`, `docs/API_OPERATION_SPEC.md`, `scripts/cloud-vm/deploy_check.sh` |
| 백엔드·DB | `docs/SOURCE_CODE_SPEC.md`, `docs/DB_SPEC.md`, `scripts/cloud-vm/db_schema.py` |
| UI·스킨 | `docs/UI_GUIDE.md`, `docs/SKIN_HTML_PENDING.md`, `skin.html` |
| GAS | `docs/GAS_AUTO_DEPLOY.md`, `gas/ticker-proxy.gs` |
| 스케줄 | `docs/SCHEDULER_CONSOLIDATION_2026-10-20.md`, `quant-autotrade/docs/SCHEDULER.md` |
| 주문/피드 | `docs/NINEPAY_LIVE_TRADING.md`, `docs/NINEPAY_FEED_INCIDENT_2026-10-20.md` |

경로별 규칙은 `.claude/rules/`, 작업 절차는 `.claude/skills/`를 확인한다.

## 배포·기록

- `js/css/data/style.css`는 master → Pages, `scripts/cloud-vm`은 master → VM 자동 배포다.
  `gas/`는 master → Actions/clasp(설정 없으면 수동)다. 작업 브랜치 push는 운영 배포가 아니다.
- `skin.html` 마크업은 Tistory 관리자 수동 반영이다. HTML로 해결할 문제에 새 런타임 우회를
  만들지 않고 `docs/SKIN_HTML_PENDING.md`에 기록한다. 기존 우회는 실제 반영 확인 전 보존한다.
- `?v=`만 바꾼 수정은 스킨 수동 반영의 전제가 아니다. Pages는 기존 URL도 약 10분 안에 갱신한다.
- 관련 검증과 PC/모바일·장외/결측·재연결을 확인한다. 전체 테스트 기준선과 이번 검증을 구분한다.
- 중요한 변경은 코드와 같은 커밋 범위에 `docs/WORK_HISTORY.md` 상단으로 날짜·목적·변경·검증·배포만
  짧게 쓴다. 사소한 문구/스타일은 Git 커밋으로 관리한다. 최종 보고는 파일·측정치·검증·배포·미완료를 구분한다.
- 작업이력은 통독하지 않는다. 최근 50건만 유지하고 오래된 것은 `docs/history/`로 원문 그대로 옮긴다.
  명세도 관련 구간만 읽으며, 공통 정책·현재 구조·과거 이력을 서로 복제하지 않는다.
