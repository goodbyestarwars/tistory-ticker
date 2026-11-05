> **상시 적용 규칙:** 이 문서를 읽은 에이전트는 사용자의 별도 요청·프롬프트·재확인 없이 아래 정책을 모든 작업의 기본으로 적용한다. 기존 공통 모듈·호출부 확인 → 재사용 → 필요한 공통 확장 순서로 작업하며 동일 기능의 중복 구현을 금지한다.

# 9Pay 공통 개발 정책

한국 주식시장 데이터 수집·분석·시각화 서비스. 기본·배포 브랜치는 `master`다.
운영 사이트 https://ghlee.tistory.com · VM API https://goodbyestar.cloud

## 시작 순서

사용자는 할 작업만 지시하면 된다. 공통 모듈 재사용을 매번 요청하게 하지 않는다.

1. 이 파일 → `docs/README.md` → `docs/WORK_HISTORY.md` 최근 필요한 일부만 읽는다.
2. 서비스·메뉴·공급자·DB·스케줄·자동매매 상세는 `docs/SERVICE_MAP.md`를 필요한 구간만 본다.
3. 최신 `docs/HANDOFF_*.md` 1개와 해당 작업의 원본 명세·코드·운영 응답을 대조한다.
   문서에 설정·배포 기록이 있다는 것과 현재 정상 동작한다는 것은 구분한다. 시각은 KST다.

## 수정 원칙

- 기존 기능·직접 URL·DOM/전역 객체 계약·저장 데이터·캐시를 임의 삭제하지 않는다.
- 수정 전 호출 관계와 배포 경로를 확인한다. 요청 범위 밖 변경을 섞지 않는다.
- **같은 기능은 공통 모듈을 재사용한다.** 차트는 `js/chart-core.js`와 그 모듈
  (`chart-data`, `chart-drawing`, `chart-wave-overlay`, `chart-sr` 등), 호가는 `js/order-book.js`,
  추세선은 같은 `chart-wave-overlay`에서 선택 규모의 숨겨진 방향 파동까지 구간별로 분석한다. 국소 채널은 양쪽 경계 접점을 검증하고 과거 구간 끝에서 멈추며, `up/down` 호환값과 `lines` 목록을 함께 유지한다. 추세선은 공통 `auto-wave.shapeOf`의 방향 일관성과 접점 분포를 먼저 본다. 기본 15봉 기준보다 짧아도 형태가 뚜렷한 12~14봉 구간은 허용하고, 길어도 방향이 불명확한 잡음은 제외한다.  최근 5봉 이내까지 이어진 유효 구간은 현재 봉까지 검증한 뒤 5봉 앞을 점선으로 투영한다. 진행 구간의 최근 2봉은 경계 적합에서 분리해 이탈을 검증한다.
  눌림목은 `auto-wave.js`가 기존 상승·조정 파동에 계산 메타데이터를 붙이고 `chart-wave-overlay`가 공통 라벨을 표시한다. 후보/확정을 구분하며 확정 시점 이후 데이터로 과거 판정을 바꾸지 않는다. 기준은 `docs/AUTO_WAVE_VALIDATION_2026-10-13.md`를 따른다.
  검색기 5개 메뉴의 기본 후보는 공통 `auto-wave.selectShapesOf`로 전체 저장 일봉의 OHLCV 모양에서 새로 선정한다. `shape_scan.py`가 기존 DB·캐시·원자 저장을 재사용하며 Node 배치 1회로 같은 JS 엔진을 실행한다. 공개 `/pattern-scan.shapeSelection`은 관찰 전용(`orderAuthorized=false`)이고 기존 `patterns`·확정 신호·이력·주문 피드는 보존한다. 종목 유형·최신 일봉·유동성·장기 재무 관문은 유지한다.
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

## 지표 해석·개선 원칙 (사용자 지침, 2026-11-05)

- 모든 지표는 숫자보다 차트의 모양·흐름·앞뒤 맥락을 우선한다. 상승·조정·횡보의 연결, 고점·저점 구조, 기울기·기간·봉 크기·거래량 변화로 사람이 자연스럽게 인식하는 형태를 먼저 설명·모델링하고, 수치는 이를 확인하는 보조 근거로 쓴다.
- 특정 봉 수·되돌림 비율 등 고정 임계값만으로 모양을 강제하거나 정상적인 패턴을 배제하지 않는다. 눌림목도 고점 후 N봉이 아닌 상승 후 조정의 형태로 해석한다. 수치 기준은 변동성·규모·상황에 맞춰 검증하고, 형성 중·반등 시도·재상승과 사후 확정을 구분한다.
- 이는 향후 해석·설계의 우선 원칙이며 기존 계산·실계좌·주문 경계를 임의 변경하는 승인이 아니다.

## UI

- PC와 모바일을 함께 유지한다. 글꼴 역할·굵기·여백은 `docs/UI_GUIDE.md`와 기존 토큰이 단일 출처다. 홈 KR/US 대시보드 카드 소제목은 휴장 ‘이번 주 주요 일정’과 같은 `--ui-section-size`(17px)를 PC·모바일 공통 적용한다. 메인과 독립 문서의 여백은 `css/ui-spacing.css`를 공유하며 화면별 고정값으로 되돌리지 않는다.
- 홈 마켓브리핑 캐러셀과 이야기 시리즈 카드 제목은 공통 `--home-editorial-card-title-size`(PC 20.7px/720px 이하 16.2px)를 재사용한다. 페이지·섹션 제목이나 아카이브 카드에는 적용하지 않는다.
- 홈 한국증시 주도·주의 업종은 국내시장 박스에서 미국시장과 같은 2열 업종 막대 컴포넌트를 재사용한다(국내 시총 버블 업종별 표본 평균, 미국 섹터 ETF와 구분). ‘시장 핵심 지표’는 원/달러·KOSPI200 주간선물 2열과 기존 대표지수형 20거래일 미니 차트로 구성한다. 주간선물·환율 일봉은 기존 VM 저장 시세 1분 조회를 함께 재사용하고 공통 지수 20초 폴러에는 추가하지 않는다. 투자자 동향은 KOSPI·KOSDAQ 2개 차트 및 각 70px 높이 그대로, 동일 KIS 수급 응답의 외국인 실선·기관 점선을 겹쳐 표시하고 면적/막대 전환을 유지한다. 차트 독립 버튼은 봉 주기와 같은 세그먼트 트랙을 쓰며 저장·복사는 그 바로 아래에 둔다.
- 명조는 공통 `css/fonts.css`의 `--font-serif`(Noto Serif KR)로 일원화한다. 기존 Bold 제목은 실제 700, 본문/숫자는 기존 Pretendard Variable 역할을 유지하며 합성 굵기는 금지한다. 명조의 시각 크기/행 메트릭은 fonts.css의 size-adjust·ascent/descent/line-gap에서만 보정하고 화면별 font-size를 확대하지 않는다.
- 전체 페이지 배경과 의미색은 유지한다. 라이트 콘텐츠 박스는 흰색 공통 면 토큰을 쓴다. **종목분석 카드형도 주변 콘텐츠 박스와 같은 폭·흰색 공통 면·테두리를 사용하며 Liquid Glass를 적용하지 않는다.** PC에서는 카드 내부 왼쪽에 간결한 MA 해석·20/60/224일선 대비 수치, 오른쪽에 축소 차트를 배치한다. 넓은 화면(1600px 이상)에서만 카드 바깥 왼쪽 여백에 보조 5분봉을 제공한다(기존 엔드포인트 재사용). 카드 차트는 공통 chart-core의 MA·일목 계산을 재사용하고 26봉 선행 공간에 파란 채우기만 표시한다. 유효한 차트가 있으면 카드형에는 차트 1장만 노출하고, 기존 판정·스토리 원본 데이터/렌더러는 삭제하지 않는다(차트 부재 시 폴백 유지). 범례는 하단 왼쪽 소형(10~11px)이며 구름의 공식 명칭은 `일목균형표(구름대)`다. 폰트 크기는 확대하지 않는다.
- 상승/매수 빨강·하락/매도 파랑을 유지한다. 다크는 `style.css`의 공식 `--dk-*` 토큰만 쓴다.
- 기존 레이어 안에서 수정하고 `!important`·높은 명시도·파일 끝 우회 규칙을 새로 쌓지 않는다.

## 운영·주문 경계

- 구성(2026-10-30 인계 기준): 사이트 백엔드 `goodbyestar.cloud`는 Oracle A1, 자동매매 runner·봇·연구는 별도 Google VM(`instance-20260712-153038`, 자동매매 전용, PC 작업은 삭제됨)이다. 아래 VM 제한은 사이트 백엔드 기준이며, 구성이 다르게 적힌 문서는 `docs/HANDOFF_2026-10-30.md`가 우선한다.
- 백엔드 VM은 1GB급 자원이다. 전종목 데이터는 종목별로 읽고, 새 상시 프로세스/수집 주체를 늘리지 않는다.
- 공급자 호출 간격·예산을 유지한다. 일봉과 수급의 최신성·누락·실패를 독립적으로 기록한다.
- 거래중 VM 재시작은 피드 단절 위험이 있으므로 금지한다. 장외에도 배포 전 상태·회복을 확인한다.
- 실계좌 실행·재시작·주문·활성화·정책은 구체적인 사용자 승인 없이는 바꾸지 않는다.
- 자동매매 Google VM은 08:55 예약·14:00 KST 절대 주문 종료를 사용한다. 웹 [중지]는 공유 `MANUAL_STOP`으로 Runner와 봇 주문을 함께 차단하며 사용자 [시작] 전까지 날짜가 바뀌어도 해제하지 않는다. `HOLD_BUY`는 당일 신규 매수 보류만 담당한다. 직접 주문 경로는 공통 `order_guard.py` 시간·수동중지·직렬 잠금과 기존 계좌 승인·불확실 장부 검증을 모두 통과해야 한다. `control/autotrader-control.sudoers` 설치는 Git 배포와 별개로 VM에서 검증한다.
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
| 자동매매 정책·PC 운영·검증·이력 | `quant-autotrade/docs/TRADING_RULES.md`, `quant-autotrade/docs/LIVE_OPERATIONS.md`, `quant-autotrade/docs/STRATEGY_TESTS.md`, `quant-autotrade/docs/CHANGELOG.md` |\n| 피드·과거 거래 기록 | `docs/NINEPAY_FEED_INCIDENT_2026-10-20.md`, `quant-autotrade/docs/NINEPAY_LIVE_TRADING_HISTORY.md` |

경로별 규칙은 `.claude/rules/`, 작업 절차는 `.claude/skills/`를 확인한다.

## 배포·기록

- `js/css/data/style.css`는 master → Pages, `scripts/cloud-vm`은 master → VM 자동 배포다.
  종목 스토리 정적 자료(`data/stock-stories.js`, `data/stories/`)는 VM 코드·재스캔 감시에서 제외한다.
  종목 스토리 수집·생성은 **Oracle 서버의 기존 비공개 키**로만 수행한다. GitHub Actions·Secrets·로그·커밋에 키움 인증정보를 전달하거나 복제하지 않는다.
  격주 일요일 10:00 KST 갱신은 Oracle 서버 Claude Code가 설치·검증하는 systemd 타이머가 소유하며, GitHub에는 검증된 공개 카드 JS만 배포한다. 구체적 설치·검증 절차는 `docs/ORACLE_STOCK_STORY_REFRESH.md`를 따른다.
  `gas/`는 master → Actions/clasp(설정 없으면 수동)다. 작업 브랜치 push는 운영 배포가 아니다.
- `skin.html` 마크업은 Tistory 관리자 수동 반영이다. HTML로 해결할 문제에 새 런타임 우회를
  만들지 않고 `docs/SKIN_HTML_PENDING.md`에 기록한다. 기존 우회는 실제 반영 확인 전 보존한다.
- `?v=`만 바꾼 수정은 스킨 수동 반영의 전제가 아니다. Pages는 기존 URL도 약 10분 안에 갱신한다.
- 관련 검증과 PC/모바일·장외/결측·재연결을 확인한다. 전체 테스트 기준선과 이번 검증을 구분한다.
- 중요한 변경은 코드와 같은 커밋 범위에 `docs/WORK_HISTORY.md` 상단으로 날짜·목적·변경·검증·배포만
  짧게 쓴다. 사소한 문구/스타일은 Git 커밋으로 관리한다. 최종 보고는 파일·측정치·검증·배포·미완료를 구분한다.
- 작업이력은 통독하지 않는다. 최근 50건만 유지하고 오래된 것은 `docs/history/`로 원문 그대로 옮긴다.
  명세도 관련 구간만 읽으며, 공통 정책·현재 구조·과거 이력을 서로 복제하지 않는다.
