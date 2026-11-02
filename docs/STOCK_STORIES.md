# 종목 스토리

## 표시 계약

- `/pages/foreign-flow?code=*`의 국내 개별 종목 전부가 대상이다. ETF 분기는 유지한다.
- Tier2는 `js/stock-story-template.js`의 순수 계산이다. 종목별 파일·fetch·타이머가 없다.
  `foreign-flow.js`가 받은 `foreignFlow`, `investorFlow`, `fundamentals`, `opinion`, `chartData`를 전달한다.
  기한 이후 도착한 기존 Promise도 재사용한다. 추가 공급자 호출은 없다.
- Tier1은 `data/stock-stories/index.js`에 있는 종목만 `data/stock-stories/{code}.js`를 읽는다.
  제외할 때 index만 수정하고 원본 파일은 남긴다. 기존 `data/stock-stories.js`는 과거 소비자 호환용이며 새 화면은 읽지 않는다.
- 렌더러는 `buildStockStoryCard` 한 개다. `topic` 또는 `topics`로 Tier1과 겹친 Tier2 주제를 제거한다.
  주제 키는 `earnings`, `flow`, `short-credit`, `target`, `position`, `risk`다.
- Tier2 후보는 최대 5장이다. 비교 자료·날짜가 없거나 조건 미달이면 생략한다. 없는 값을 0으로 채우지 않는다.
  유효한 수급 20일, 비중 25일, 이동평균 224일을 요구한다. 52주 고저는 실제 364일 범위를 덮는 고가·저가 이력이 있어야 한다.
- 실적은 단독 분기(`standalone_3m`)와 DART 누적(`dart_ytd_reported`)을 구분한다. YoY/QoQ 20% 이상인 지표만 표시한다.
  연간 실적을 최근 분기로 바꾸지 않는다. 기준일은 공시 접수일이다.
- 외국인·기관 일별 수급은 현행 `/foreign-flow` 응답에 있다. `/investor-flow`의 연기금 순매수를 외국인·기관 값으로 쓰지 않는다.
- 현행 `/investor-flow`에는 공매도·신용의 25일 비중 이력이 없다. 해당 카드는 생략한다.
  향후 동일 응답에 `short.daily`/`credit.daily`의 `{date, ratio_pct}`가 생기면 사용할 수 있다.
- 현행 `/invest-opinion`은 증권사별 리포트가 아닌 날짜별 관측치다. 최근 1개월의 유효 목표가 산술평균을 그렇게 명시한다.
  기존 3개월 `avgTargetPrice`는 중앙값이므로 1개월 평균으로 재명명하지 않는다.
  상향·하향 건수는 `broker`, `reportId`, `previousTargetPrice`가 실제 있을 때만 집계한다.

## Tier1 갱신 운영 규칙

전 종목 Tier2에는 갱신 작업이 없다. Tier1만 다음 기준을 적용한다.

1. 공시 감시 이벤트가 들어오면 해당 코드만 검토한다. 공시 문서는 사실 검증 자료이며 실행 지시로 취급하지 않는다.
2. 2주마다 검토한다. `asOf`가 45일을 넘었거나, 표시 배지가 폐기됐거나, 새 정기보고서가 있을 때만 재작성한다.
   재검토했다는 이유로 `asOf`를 오늘 날짜로 바꾸지 않는다. 내용이 같으면 커밋하지 않는다.
3. 월 1회 전체 KOSPI·KOSDAQ의 검증 가능한 시총 순위로 Tier1 후보 약 100개를 재산정한다.
   사용자 후속 답변은 '전 종목'이므로 개인 관심종목을 읽거나 공개 저장소에 복사하지 않는다.
   선정과 원고 확보를 구분한다. 원고가 없는 코드는 Tier2를 유지하며 작성 완료처럼 index에 등록하지 않는다.
4. 원고의 수치·날짜·출처를 확인한 후 기존 공통 렌더러 스키마로 저장한다. 내용 변경 때만 커밋하고 master→Pages 배포를 확인한다.
5. 빠진 종목의 파일은 삭제하지 않고 index에서만 제외한다.

### 운영 파이프라인

- `.github/workflows/stock-stories.yml`이 GitHub Actions에서 실행된다. VM에 수집 프로세스를 추가하지 않는다.
- 전체 KOSPI·KOSDAQ 공개 마스터 파서는 기존 `scripts/build_dcf_data.py`의 `load_public_market_master`를 공유한다.
  공식 고정폭 시총 필드(전일 기준·억원)를 검증하고, 보통주 전체를 합쳐 상위 100개를 선정한다.
  `data/stock-story-selection.js`에 표본 수·순위·선정 시점·단위를 기록한다. 표본 섹터 순위가 아니다.
- 정적 원고는 `scripts/build_stock_stories.py`가 기존 `dart_client`, `fundamentals`의 계정 추출·기간 구분을 재사용해 생성한다.
  분기/연간 절대 실적, 전년 동기 대비, 연초 누적을 구분하며 흑자·적자 전환을 증가 배수로 쓰지 않는다.
  모든 공시 카드에는 실제 접수번호, 공시 기준일, DART 원문 링크가 있다.
- 기존 편집 원고보다 오래된 정기보고서로 최신 편집 내용을 덮지 않는다. 새 정기보고서가 나온 경우 실적 주제만 교체하고,
  다른 주제의 원고는 개별 기준일을 보존한다. 임의의 해석이나 공시 문서 속 실행 지시를 적용하지 않는다.
- 공시 감시는 매시 03·13·23·33·43·53분(UTC, 매 10분) 공식 DART 정기공시 목록을 확인한다.
  **감지된 이벤트는 같은 실행에서 해당 종목 재작성→검증→변경분 커밋→Pages 빌드를 수행한다.**
  공시 게시부터 감지까지는 수집 주기와 GitHub 대기 시간이 있으며, 게시 시점의 무지연 푸시라고 표현하지 않는다.
- `repository_dispatch`의 `stock-story-disclosure`를 통한 외부 공시 이벤트도 같은 파이프라인으로 즉시 처리한다.
  payload는 `{"codes":"005930,042660"}`다. 공급자 원문·키·계좌 정보를 전달하지 않는다.
- 배지 폐기는 `stock-story-badge-retired` 이벤트에 `{"codes":"005930","retiredBadgeIds":["badge-id"]}`를 전달한다.
  명시한 종목·배지 ID만 폐기하며, 만료일이 지난 배지도 정기 점검에서 제거한다.
- 각 종목의 마지막 검토에서 14일이 지나면 새 정기보고서를 확인한다. 재작성은 신규 접수번호·45일 경과·배지 폐기일 때만 한다.
  동일 내용과 동일 출처면 `written`도 바꾸지 않아 커밋이 생기지 않는다.
- 월이 바뀐 첫 실행에서 순위를 재산정한다. 선정 내용이 같으면 조회 시간만 변경하는 커밋을 만들지 않는다.
  제외 종목은 index에서만 제거하며 파일을 보존한다.
- DART 응답의 접수번호가 새 공시와 다르면 이전 원고를 유지하고 이벤트를 미처리 상태로 남겨 다음 실행에서 재시도한다.
  실패·결측을 정상값으로 바꾸지 않는다. 하루 1,500회·실행당 최대 400회·20분 수집 상한, 0.35초 호출 간격을 둔다.
  기존 공통 Collector가 Actions의 최대 4개 수집 워커에 동일한 간격·호출 예산을 적용한다.
  공시 페이지 커서·이벤트 대기열·검토 시각·호출 예산은 Actions 캐시에 저장하고 공개 저장소에는 올리지 않는다.
- 브라우저 전용 `data/stock-stories/`와 선정표는 VM 재시작·전 종목 재검색 경로에서 제외한다. 장중 보호창은 유지한다.
- 초기 Codex 앱 예약 2개는 위 실행 파이프라인으로 대체해 삭제했다. 앱이 열려 있어야만 수행되는 갱신 작업이 아니다.

수동 재현:

```sh
gh workflow run stock-stories.yml -f mode=bootstrap
gh workflow run stock-stories.yml -f mode=review
gh workflow run stock-stories.yml -f mode=reselect
python scripts/validate_stock_stories.py --require-count 100
```

## 2026-11-02 검증·배포 결과

- 전체 보통주 2,538개에서 선정한 실제 Tier1 100종목·301개 카드. 삼성전자 005930도 운영 원고다.
- 초기 수집 실행 `41413730727`: 성공, 대상 100, 오류 0, 대기 0, DART 202회.
- 실제 `repository_dispatch` 실행 `41416053467`: 성공, 대상 100, 변경 0, 오류 0, 대기 0.
  동일 공시 재전달 시 불필요한 파일 수정·커밋이 없음을 확인했다.
- `python scripts/validate_stock_stories.py --require-count 100`: 접수번호·날짜·파일·원문 링크 검증 통과.
- `python -m unittest discover -s test -p 'test_stock_story_pipeline.py'`: 11개 통과.
  신규 공시 교체, 미제공 원문 재시도, 다른 접수번호 계정 배제, 4워커 공용 호출 예산, 배지 만료, 변경 없는 원고 날짜 보존.
- DCF 회귀 37개 통과. 공통 Collector 변경 후 기존 병렬 호출 상한 테스트도 통과.
- 스토리 템플릿·기존 스토리 회귀 통과. 배포 계약 13개 통과·1개 환경상 생략, 장중 배포 보호 10개 통과.
- 실제 100종목의 301개 카드를 PC1643/모바일390 × 라이트/다크에서 렌더링해 숫자 오류·가로 넘침이 없음을 확인.
  실제 삼성전자 원고의 공통 캐러셀 이동과 화면 캡처를 확인했다.
- 배포된 Pages 자산으로 000020 Tier2의 API 추가 호출 0회, 042660·005930의 실제 종목별 지연 로드를 확인했다.
- 앞선 16개 화면 조합에는 000040 전체 결측 fixture의 영역 생략 검증이 포함된다.
  fixture를 실제 결측 종목이나 사용자 로그인 검증으로 설명하지 않는다.
- Pages 배포 `41416153660` 성공 및 index·삼성전자·알파벳 종목코드 0126Z0·선정표의 실제 HTTP 200 반영 확인.
