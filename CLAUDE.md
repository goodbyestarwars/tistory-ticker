# 9Pay 증권

한국 주식시장 데이터 수집·분석·시각화 서비스다.

## 핵심 구조

- 프론트엔드: Tistory 스킨 + GitHub Pages 정적 자산
- 백엔드: Google Apps Script + GCP VM FastAPI
- 운영 API: `https://goodbyestar.cloud`
- 운영 사이트: `https://ghlee.tistory.com`
- 기본·배포 브랜치: `master`

## 필수 규칙

- 기존 기능을 임의로 삭제하지 않는다.
- 요청 범위를 벗어난 리팩터링을 하지 않는다.
- 수정 전 관련 파일, 호출 관계, 배포 경로를 확인한다.
- API 키, 토큰, 계정정보를 코드·문서·로그에 기록하지 않는다.
- PC 화면을 우선하되 모바일 반응형을 유지한다.
- 상승은 빨강, 하락은 파랑 의미색을 유지한다.
- 데이터 파일은 `window.XXX = {...}` 형태의 `.js`를 사용한다.
- KRX 내부 크롤링 경로를 새로 추가하지 않는다.
- 미검증 API 필드나 단위를 확정값처럼 쓰지 않는다.
- 완료 후 변경 파일, 검증 결과, 수동 배포 여부를 요약한다.

**2026-07-28 새로고침 시 검은 영역 FOUC 수정**: 라이트모드 새로고침 때 화면 상단 일부가 검게 먼저 나타났다 흰색으로 바뀌는 현상은 다크모드 초기화 문제가 아니라, 2026-07-16에 폐기된 구형 `#market-ribbon`의 CSS/JS 실행 시점 차이였다. `skin.html`에 빈 컨테이너와 `css/market-ribbon.css`/`js/market-ribbon.js` 로드가 남아 있는데, CSS가 먼저 높이 32px·검은 배경의 fixed bar를 페인트하고 `defer`된 JS가 DOMContentLoaded 이후에야 인라인 `display:none`을 적용했다. `css/market-ribbon.css`의 첫 규칙에 `.market-ribbon{display:none!important}`을 추가해 첫 스타일 계산부터 숨기도록 수정했다. 이제 JS 로드·DOMContentLoaded·네트워크 속도와 무관하게 검은 바가 한 프레임도 노출되지 않는다. 구형 규칙과 JS는 롤백 이력 때문에 유지한다.

**2026-07-28 종목분석 목록·패널·매물대 UI 개선**: 투자시그널 등급 버킷의 100종목 제한을 3,000으로 확대해 보유 835종목을 포함한 스캔 전종목을 검색·필터할 수 있게 하고, bucket tuple 뒤에 종합점수와 거래대금(`[code,name,price,changeRate,stars,totalScore,tradingValue]`)을 추가했다. 프론트는 전체 데이터를 한 번에 DOM에 만들지 않고 20개씩 점진 렌더링하며 종합점수·등락률·거래대금·종목명 정렬을 지원한다. 목록 제목에는 조건별 실제 건수와 정렬 기준을 함께 표시한다. 미선택 `ffSigBanner`는 `[hidden]{display:none!important}`으로 첫 화면의 빈 파란 바와 여백을 제거했다. PC의 목록·상세 카드는 오른쪽 상세 높이에 맞추고 목록만 내부 스크롤하며, 모바일은 세로 스택과 20개 더보기를 유지한다. 상세의 판정 카드와 항목별 점수 사이 간격을 14px(모바일 11px)로 분리했고, 매물대 지상/B1/B2 외곽선은 1px 저채도 선으로 줄였다. 새 bucket 데이터는 다음 `daily_scan.py` 배치부터 채워지며 기존 5칸 tuple도 프론트에서 호환한다.

**2026-07-29 종목뉴스 종목분석 요약 의존성 수정**: 종목뉴스의 `loadAnalysis()`는 `ForeignFlow.fetchAnalysisSummary()`를 호출하면서도 `/page/stock-news`에 `js/foreign-flow.js`가 별도로 삽입돼 있다고 가정해, 페이지 편집에서 해당 스크립트가 빠지면 항상 “종목분석 데이터를 사용할 수 없어요”만 표시했다. `stock-news.js`가 자신의 CDN URL을 기준으로 같은 디렉터리의 `foreign-flow.js`를 한 번만 지연 로드하는 `ensureForeignFlow()`를 추가했다. 이제 티스토리 페이지 HTML을 수동 수정하지 않아도 요약 패널이 로드되며, 의존성 로드 실패 시 재시도할 수 있도록 실패한 Promise 캐시는 비운다.

**2026-07-29 뉴스·검색 관심도 모멘텀 8종목 파일럿**: 가격 모멘텀과 구분되는 이슈·재료 지속성 탭을 종목분석에 추가했다. `news_momentum.py`는 기존 `ohlc_snapshot.db`를 건드리지 않고 별도 `news_momentum.db`에 `news_topics`/`news_topic_daily`/`datalab_trends`/`news_stock_coverage`와 필수 인덱스를 만들며 WAL/NORMAL/foreign_keys/busy_timeout/temp_store 설정을 적용한다. 기사 원문·HTML·이미지는 저장하지 않고 서로 다른 제목 2건 이상에서 반복된 복합 이슈, 일별 건수, 대표 URL 최대 3개, 방향성, NAVER Search Trend 상대지수만 저장한다. `news_momentum_scan.py`는 기본 실행 시 SK하이닉스·삼성전자·현대차·비에이치아이·한화오션·NAVER·LG전자·에코프로비엠만 처리하고 OS 파일 잠금으로 중복 실행을 건너뛴다. 뉴스는 최신순 최대 1,000건을 최근 90일 경계까지 백필하며 실제 기준일과 백필 완료/부분 상태를 API·화면에 표시한다. DataLab은 활성 이슈 최대 5개를 한 요청으로 묶고 같은 query_version은 하루 1회만 갱신한다. `/news-momentum/{code}`는 DB만 읽고 `NEWS_MOMENTUM_ENABLED` Feature Flag를 지원한다. 프론트 모멘텀 탭도 최초 진입 때 이 API만 지연 호출하며, 종목뉴스 요약의 예전 가격 기반 “모멘텀”은 “가격추세”로 개칭했다. `deploy_check.sh`는 배포 전 Python sqlite3 backup API로 `ohlc_snapshot.db`를 백업·검증하고, 배포 후 health/모멘텀/기존 OHLC API를 회귀 점검한다. 실패 시 flag 비활성화와 `news_momentum.db` 이름 변경으로 자동 롤백한다. systemd 작업 경로와 사용자는 `$HOME`이 아니라 저장소 절대경로와 실제 소유자로 계산한다. 실패한 `news_momentum_release.txt` 버전은 다시 자동 활성화하지 않고 버전을 올린 수정 배포만 한 번 재시도한다. DB·WAL·SHM·잠금·상태·백업 파일은 `.gitignore` 대상이다.

## 필요한 문서만 읽기

아래 문서를 시작 시 전부 읽지 않는다.

- 구조·배포: `ARCHITECTURE.md`
- VM REST API: `API_REFERENCE.md`
- UI 기준: `docs/UI_GUIDE.md`
- 문서 안내: `docs/README.md`
- 과거 상세 이력: `git log -p -- CLAUDE.md`

## 작업별 Skill

- 기능 추가: `/feature-development`
- 오류 수정: `/bug-fix`
- UI 개선: `/ui-improvement`
- 배포 점검: `/deploy`
- 티스토리 포스팅 HTML: `/tistory-post-html`

## 배포 주의

- `js/`, `css/`, `data/`: `master` 반영 후 GitHub Pages 자동 배포
- `scripts/cloud-vm/`: `master` 반영 후 VM 자동 배포
- `gas/ticker-proxy.gs`: GAS에서 새 버전 수동 배포
- `skin.html`: Tistory 관리자에서 수동 반영
