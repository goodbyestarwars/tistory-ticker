# 검색기 종목 아래 상세 차트 · 2026-10-28

기준 `1c84defc`. 사용자가 선택한 종목 바로 아래에 차트를 펼치고, 넓은 빈 공간과 부족한 차트 도구를 개선했다.

- 기존 공용 `#psDetail` 한 개를 선택한 행 바로 뒤로 옮긴다. 같은 버튼을 다시 누르거나 닫기를 누르면 접는다. 목록 맨 아래로 강제 스크롤하지 않는다.
- 실시간 목록 갱신 때 차트 DOM과 인스턴스를 보존한다. 전체 화면의 복귀 위치도 보존한다. 상태 필터에서 선택 종목이 사라지면 닫는다.
- 종목/패턴/설명, 가격/관측 시각, 상세 버튼을 세 영역으로 정렬한다. 모바일에서는 한 열로 배치한다. 긴 분석 근거는 차트 상단 접이식에 보존하여 도구와 차트가 먼저 보이게 한다.
- 공통 `NineChartCore`, `NineChartDrawing`, `NineChartData`, 메모·지지저항 모듈 및 기존 전체 화면 기능을 재사용한다. 중복 차트/그리기 구현이나 신규 공급자 연결은 없다.
- 5·20·60·224일선 표시 선택, 거래량, 직선·연필·원·박스·가로선·측정·지우기, 확대·축소·전체 보기 도구를 연결했다. 기존 일목균형표·볼린저밴드·지지저항·메모·기간 선택·전체 화면·종목 전환은 유지한다.
- 그리기는 이 브라우저에 종목별로 저장하며 우클릭으로 해제한다. 기존 메모의 계정 저장 기능과 구분한다. 메모와 그리기는 동시에 입력을 가로채지 않는다.
- 늦은 종목 응답, 닫은 차트의 지연 응답, 이전 비동기 차트 생성은 현재 차트를 덮지 못한다. 거래량 결측은 0으로 그리지 않고 해당 옵션을 비활성화한다.

## 검증

실제 Lightweight Charts 5.2 엔진과 로컬 합성 데이터를 사용했다. 실제 주문/계좌 호출은 없다.

```text
python test/qa_scanner_inline_chart.py
  4 PASS: 1440/375px × 밝은 화면/다크모드
  인라인 위치, 단일 차트, 강제 스크롤 없음, 이동평균 토글, 거래량 패널 토글,
  실제 포인터 드래그·로컬 저장, 6개 그리기/측정 도구, 우클릭 해제,
  메모와 그리기 상호 배제, 자동 갱신 중 차트 유지, 전체 화면 갱신 후 복귀,
  종목 전환, 응답 경합, 닫힌 차트 유지, 필터 이동, 거래량 결측, 가로 넘침 없음

python test/qa_scanner_states_browser.py
  기존 68 시나리오 PASS
python test/qa_confirmation_browser.py
  기존 12 시나리오 PASS
python -m pytest -q test/test_public_scan_routes.py test/test_scanner_security_data.py --disable-warnings
  18 passed (기존 FastAPI 경고 10건)
node test/test_scanner_progress.js
node test/test_scanner_dashboard.js
node test/test_scanner_groups.js
node test/test_scanner_loading.js
node test/test_scanner_two_stage.cjs
node test/test_confirmation_ui.cjs
node test/test_scanner_public_states.cjs
node test/test_chart_core.js
node test/test_chart_smooth_wheel.js
node test/test_chart_interactions.js
  모두 PASS
node --check js/pattern-scan.js
git diff --check
  PASS
```

같은 합성 입력·첫 종목 행을 측정했다. 1440px에서 높이 132→87px(약 34% 감소), 375px에서 189→184px였다. 종목명·로고·코드·상태·패턴·근거·가격·시각을 유지한다. 실제 종목명과 패턴 수에 따라 높이는 달라진다.

| 화면 | 이전 | 이후 |
|---|---|---|
| PC | [보기](qa/scanner-inline-2026-10-28/before-1440-light.png) | [보기](qa/scanner-inline-2026-10-28/after-1440-light.png) |
| 모바일 | [보기](qa/scanner-inline-2026-10-28/before-375-light.png) | [보기](qa/scanner-inline-2026-10-28/after-375-light.png) |
| PC 다크 | [보기](qa/scanner-inline-2026-10-28/before-1440-dark.png) | [보기](qa/scanner-inline-2026-10-28/after-1440-dark.png) |
| 모바일 다크 | [보기](qa/scanner-inline-2026-10-28/before-375-dark.png) | [보기](qa/scanner-inline-2026-10-28/after-375-dark.png) |

## 범위와 배포

수정: `js/pattern-scan.js`, `css/pattern-scan.css`, 합성 fixture/브라우저 검증 및 CI, 작업 이력·증빙. `publicConfirmation()`을 기준 코드와 비교하여 동일함을 확인했다. 서버·탐지·주문·시세 연결·저장된 신호/매매 기록은 수정하지 않았다.

기존 일봉 데이터 기준을 유지한다. 추가 주기나 주문 가능 상태를 임의로 만들지 않는다. 실제 운영 피드 결과와 합성 검증 화면을 구분한다.

사용자의 즉시 배포 지시에 따라 PR 검증 후 `master`→GitHub Pages로 반영한다. VM 재시작은 필요 없다. 운영 페이지에서 PC/375px 인라인 위치·실제 도구 준비·전체 화면을 확인한다. 롤백은 이 PR 머지 커밋을 revert하여 같은 정적 배포 경로로 반영한다.

## 추가 개선: 기준 대비 등락률·버튼 통합

관측가(실시간 수신 시 현재가)와 표시된 기준가로 `(관측가 / 기준가 - 1) × 100`을 계산해 소수 둘째 자리까지 표시한다. 전일 종가를 임의로 비교 기준으로 쓰지 않는다. 상승은 기존 빨강, 하락은 기존 파랑을 재사용하고, 같은 가격은 `0.00%`, 결측·0원·유효하지 않은 가격은 `미확인`으로 표시한다.

종목 행의 상세 차트와 패턴별 근거를 `차트·근거 보기` 한 버튼으로 합쳤다. 펼친 영역에 패턴별 상태·근거를 함께 표시하고, 여러 패턴에 해당하면 내부 선택으로 분석 패턴을 바꾼다. 패턴을 바꿔도 이전/다음 종목 이동과 닫기는 유지한다.

기존 분류 회귀에 상승·하락·보합·결측·0원·반올림 검증을 추가했다. 실제 엔진 4개 PC/375px·다크 시나리오에 행별 단일 버튼, 등락률 표시·색상, 내부 패턴 전환, 종목 이동을 추가 검증했다. 신호 검증·탐지·주문·시세 연결은 무변경이며 기존 PR/Pages 배포·롤백 경로를 유지한다.

## 상태 숫자 표시

사용자 요청에 따라 상태 탭을 `확정 (0)`, `관찰 (3)`처럼 표시한다. 숫자는 실제로 수신한 목록과 같은 중복 제거·상태 분류 결과를 사용한다. 조회 불완전 시에도 수신 건수를 표시하되, 위에 집계 확인 중·수신 자료 기준 잠정 집계임을 명시하여 전체 조회 완료나 확정 0건으로 오인하지 않게 한다. 배치 완료·신호 검증·주문 조건은 변경하지 않는다. 기존 브라우저 검증은 6개 상태의 괄호 숫자와 조회 불완전 안내를 함께 확인한다.
