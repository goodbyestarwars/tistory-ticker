# 9Pay 문서 안내

AI가 시작 토큰을 아끼면서 필요한 정보만 읽도록 문서를 목적별로 분리했다.

| 위치 | 용도 | 로딩 |
|---|---|---|
| `../AGENTS.md` | ChatGPT·Codex가 `CLAUDE.md`로 이동하는 진입점 | 에이전트 시작 시 |
| `../CLAUDE.md` | 모든 AI의 단일 공통 규칙과 문서 지도 | 작업 시작 시 |
| `../ARCHITECTURE.md` | 인프라, 호출 흐름, 배포 경로 | 구조·배포 작업 |
| `../API_REFERENCE.md` | goodbyestar.cloud API 명세 | API 작업 |
| `API_OPERATION_SPEC.md` | API 인증·WebSocket·운영·장애 대응 | 운영/배포 작업 |
| `UI_GUIDE.md` | 색상, 레이아웃, 반응형 원칙 | UI 작업 |
| `DOMESTIC_VOLUME_POWER.md` | 국내 실시간 종목판 체결강도 순위 API·공유 캐시·PC/모바일 표시 | 체결강도 탭 |
| `NINEPAY_SCANNER_AB_2026-10-19.md` | 기존 검색기 메뉴의 단타/스윙/중장기 분류, 장초반 70% A OR B·화면 계약·#761 충돌 검토(웹/VM 배포 완료) | 장중 검색기 UI·조건 |
| `MARKET_TEMP_METHOD.md` | 증시온도 방향 점수·위험도·원자료·이력 재계산 기준 | 증시온도 작업 |
| `AUTO_WAVE_VALIDATION_2026-10-13.md` | 자동 파동(대·중·소) 검증 보고: 이전 엔진 문제·기준·수동 기준 대조·미래 비참조 시험·수익성 비교 | 차트 파동 작업 |
| `WAVE_FORECAST_VALIDATION_2026-10-14.md` | 제거된 다음 파동 예측 기능의 과거 검증 기록 | 과거 연구 확인 |
| `YEOKMAEGONGPA112_BACKTEST_2026-10-16.md` | 역매공파 112 조건(역배열·매집봉·안착·112근접) 일봉 백테스트: 손절 3.5%/목표 20%·구조 손절·MFE/MAE·시장 구간별(연구용, 실전 연결 없음) | 스윙 검색기 연구 |
| `REALTIME_ALERTS_2026-10-18.md` | 실계좌 엔진 매수·매도 텔레그램 알림 개선, 화면 WebSocket 점검, 거래량 급증 관찰 알림, 전 종목 실시간 감지 가능성(PC 미적용) | 텔레그램·실시간 |
| `INVERTED_HAMMER_EXIT_STUDY_2026-10-19.md` | 역배열 역망치 매집·224일선 위 세력 탈출·고점 무거래량 가설의 일봉 검증(2,618종목, 연구용) | 신호 연구 |
| `SURGE_PRECURSOR_STUDY_2026-10-18.md` | 급등 직전 패턴·이상치 탐색(일봉 32피처, 변동성 통제·급락 대조): 선행 신호는 변동성 확대일 뿐 방향 없음(연구용) | 신호 연구 |
| `EXIT_STRATEGY_STUDY_2026-10-18.md` | 시가 중심 매수 종목의 매도 전략 A(현재 엔진)·B(시초 구조)·C(ATR) 비교 연구, 실제 장부 재현 검증(연구용, 엔진 변경 없음, 현행 A 유지 권고) | 자동매매 연구 |
| `../research_data/open_volume_2026-10-18/README.md` | 시초 거래량 돌파 연구의 공개 가능한 표본 목록·표집 틀·이벤트 표(비밀정보·원자료 없음, PR #750 교차 검증용) | 연구 데이터 |
| `OPEN_VOLUME_TPSL_COMPARE_2026-10-18.md` | 100% 돌파 익절 279건 vs 손절 466건의 진입 전·직후 특징 비교(진입 전 구분 신호 없음, 연구용) | 신호 연구 |
| `OPEN_VOLUME_ABSORPTION_STUDY_2026-10-18.md` | 시초 30분 거래량 돌파(전일의 30·50·100·150%)와 매물 흡수·분배 의심 신호의 후속 성과(1분봉, 층화 표본·가중치, 연구용, 도입 근거 없음) | 신호 연구 |
| `MA256_BACKTEST_2026-10-17.md` | 256 기법(5·20·60일선 골든크로스) 5년 일봉 백테스트: 손익비·비용 민감도·시장 구간별과 현재 흡사 종목(연구용, 실전 연결 없음) | 스윙 검색기 연구 |
| `ACCUMULATION_BAR_CONTEXT_2026-10-17.md` | 차트 매집봉 후보 표시의 기준·5년 일봉 맥락별 사후 성과(후속 확인·상승 뒤 털기?)와 화면 반영 | 차트 매집봉 작업 |
| `AI_COLLABORATION.md` | ChatGPT·Claude Code 공동 개발 협업 규약(Issue 논의·PR 검토·합의/미합의·실계좌 승인) | AI가 Issue/PR로 협업할 때 |
| `WORK_HISTORY.md` | 중요한 기능·구조·배포 이력(최근 50건) | 이력 확인·갱신 시 |
| `history/WORK_HISTORY_*.md` | 옮겨 둔 지난 이력 | 과거 항목을 `grep`으로 찾을 때만 |
| `GAS_AUTO_DEPLOY.md` | GAS 자동 배포(GitHub Actions+clasp) 설정·확인 절차 | GAS 배포 작업 |
| `MARKET_CHART_HISTORY.md` | 시장지표 5년 이력·VM 부하·용량·갱신 | 장기 차트 수정 |
| `COMMODITY_SOURCES.md` | 에너지·원자재 선물 KIS 권한 실측·출처·월물·스테일 정책 | 원자재 소스 수정 |
| `HOUR_DIRECTION_VALIDATION.md` | 1시간 v6 전진 평가 정책·불변 보존·통계·부하·복구 | 방향 성과 검증 |
| `COMPANY_PROFILES.md` | 종목분석 회사 소개 정적 자료·수집/갱신·누락 처리 | 회사 소개 수정 |
| `SITE_INTERACTIONS.md` | 공통 누름 포인터·차트 제외·브리핑/휴장 뉴스 캐러셀·독립 페이지 적용 | 전역 입력 효과 수정 |
| `FX_KOREAEXIM.md` | 시장지표 환율 탭: 수출입은행 일별 고시환율 수집·저장·API·화면, 키 등록, 단위·한도·재시도 | 환율 탭 수정 |
| `DCF.md` | FCFF DCF·정적 DART 수집·자동/수동 입력·실자료/VM 영향 | DCF 수정 |
| `SOURCE_CODE_SPEC.md` | 파일별 역할·함수·코드 품질 점검(속도/오류/보안) | 전체 구조 파악·리팩터링 전 |
| `ARCHITECTURE_SPEC.md` | 컴포넌트 간 호출·인증·캐싱·동시성 상세 | 인프라 심화 작업 |
| `DB_SPEC.md` | SQLite 2종 + 파일 기반 데이터 스키마 정의 | DB/캐시 구조 작업 |
| `SKIN_HTML_PENDING.md` | 운영 스킨(skin.html) 미반영 항목과 임시 우회 목록 | skin.html 관련 작업 |
| `HANDOFF_*.md` | 세션 인수인계서(날짜별). 최신 것부터 본다 | 작업을 이어받을 때 |
| `../.claude/rules/` | 경로별 세부 규칙 | 관련 파일 작업 시 |
| `../.claude/skills/` | 반복 작업 절차 | Skill 호출 시 |

## 유지 원칙

- 공통 규칙은 `CLAUDE.md`에만 작성하고 `AGENTS.md`에 중복하지 않는다.
- 반복 절차는 `.claude/skills/`에 둔다.
- 특정 경로의 규칙은 `.claude/rules/`에 둔다.
- 중요한 작업내역은 `WORK_HISTORY.md`, 세부 변경은 Git 커밋에 둔다.
- 이력 문서는 통독하지 않는다(`CLAUDE.md`의 "문서 읽기 비용 규칙"). 항목이 50건을 넘으면
  오래된 쪽을 `history/`로 옮긴다 - 내용은 지우지 않는다.
- 긴 문서를 자동 import하지 않고 필요한 경우에만 읽는다.
- 문서와 실제 코드가 다르면 코드를 기준으로 문서를 갱신한다.

- 자동매매 프로젝트(별도 폴더·브랜치): `quant-autotrade/README.md`, `quant-autotrade/docs/HANDOFF_2026-10-11.md`
