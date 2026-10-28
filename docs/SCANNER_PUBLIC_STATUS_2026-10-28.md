# 9Pay 검색기 공개 상태 통합 · 2026-10-28

기준: `master`의 `6eca1345`. UI·공개 표시 정책만 수정했다. 운영 배포, 서버 재시작, 계좌 설정 변경은 실행하지 않았다. 이 작업은 PR 승인 후 배포한다.

## 변경 결과

- 기존 `scan-progress-bolt` SVG를 패턴 검색기에서도 재사용한다. 기본 버건디 `#6D233F`, 기존 전략 화면 `#800020`, 공통 다크모드 토큰을 유지한다. 게이지는 48px이며 진행 중에만 맥동하고 동작 줄이기 설정을 존중한다.
- 배치 상태·진행률·처리 수·관측/완료 시각과 현재 유효 확정 수를 독립적으로 표시한다. 미확인·오류·휴장·갱신 지연을 완료로 바꾸지 않는다. 서버가 종료 원인을 주지 않으면 종료 코드와 로그 확인 필요를 표시한다.
- 단타/스윙/중장기와 기존 5개 소분류·12개 데이터 원천을 유지한다. 그 아래 전체/확정/관찰/연구/제외/만료 필터를 배치한다. 기본 전체에는 확정→관찰→연구 구역을 표시한다.
- 연구 후보는 메인 목록에 바로 보인다. 접이식 영역에는 개별 검색기 이력·성과와 데이터 기준만 남긴다. 기존 신규/준비/성공/실패 이력 경로, 상세 차트와 추적 정보는 유지한다.
- 종목 코드를 기준으로 한 행으로 합치고 패턴별 근거와 분석 진입을 제공한다. 같은 코드의 과거 추적 자료는 현재 신호를 승격시키지 않는다.
- 실제 실시간 수신가와 일봉/과거 관측가를 구분한다. 현재가를 받지 않은 일봉은 `현재가 미수신`으로 명시한다. 없는 기준가·관측 시각은 추정하지 않는다.
- 조회 실패·필수 시각 누락·일부 원천 미수신은 집계를 `—`/확인 중으로 표시한다. 제외 건수만 있고 개별 기록이 누락된 중장기 응답도 전체 집계를 확정하지 않는다.

## 실제 데이터 → 공개 분류

| 데이터 근거 | 공개 분류 | 해석 |
|---|---|---|
| 기존 `publicConfirmation()`의 유효 A/B 검증 + `shadow:false` | 확정 | 원래 시간·거래량·가격·지지 검증을 그대로 통과. 주문 승인은 별도 |
| `COMPRESSION_READY`, `NECKLINE_READY`, `WATCH_ACCUM` | 관찰 | 응축·넥라인·매집 관찰. 추가 확인 대기 |
| `watch`, `volume_met`, `pullback`, `WAIT_PULLBACK`, `PULLING_BACK`, `FIRST_PULLBACK`, `RECOVERY`, `APPROACH` | 관찰 | 실제 진행 단계에 맞는 한 줄 설명 |
| `BREAKOUT_NEW`, `BREAKOUT_CONFIRMED`, `signaled`지만 현재 유효 A/B 증거 없음 | 연구 | 패턴/발생 사실과 현재 검증을 구분 |
| 실시간 1차 또는 일봉 `signalReview.mode=shadow` | 연구 | 실험·검증 자료. 실제 주문 승인과 무관. 독립적인 기존 A/B 증거가 있으면 그것만 별도 검증 |
| `angleMomentum` | 연구 | 기존 실험 데이터 경계 유지 |
| 관측 시각 미수신 | 연구 + 집계 확인 중 | 결측을 0건이나 완료로 위장하지 않음 |
| 명시적인 `excluded`, `financialScreen.passed=false`, `longTermFilter.excludedItems` | 제외 | 기존 제외 사유/재무 사유 재사용. SPAC은 이 목록에도 노출하지 않음 |
| `invalidated`, `entryInvalid`, 관측 지연, 신호/검증 유효 시간 종료 | 만료 | 현재 유효 신호 아님 |
| 과거 추적 `SUCCESS`, `BREAKOUT_CONFIRMED` | 연구 | 과거 돌파 성공. 체결·실현수익·현재 확정과 무관 |
| 과거 추적 `NEW`, `TRACKING`, `BREAKOUT` | 연구 | 과거 패턴의 사후 추적. 현재 신호 검증과 별도 |
| 과거 추적 `FAILED`, `EXPIRED` | 만료 | 조건 이탈 또는 추적 기간 만료 |

동일 종목에 여러 근거가 있으면 확정→관찰→연구→제외→만료 순으로 대표 상태 하나를 정하고 나머지 근거를 상세에 보존한다. 각 필터 수는 동일한 중복 제거 결과에서 산출한다. 집계 범위는 선택한 소분류의 수신 결과와 이미 조회한 추적 기록이며, 전 기간 전체 이력 수가 아니다.

## SPAC 표시 제외

[한국투자증권 공개 KOSPI 파서](https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/kis_kospi_code_mst.py)와 [KOSDAQ 파서](https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/kis_kosdaq_code_mst.py)의 실제 SPAC 구분 필드를 읽는다. 가격·주문 API나 인증 정보는 사용하지 않는다.

빌드 결과: KOSPI 일반 주식 분류 912개 중 SPAC 0개, KOSDAQ 1,805개 중 SPAC 69개. 이 숫자는 공식 마스터를 빌드한 시점의 자료이며 실시간 전체 시장 수라고 주장하지 않는다. 원본 4천여 행 중 ETF 등 `ST`가 아닌 상품은 해당 주식 유형 스냅샷에 포함하지 않는다.

판별 순서: 명시적인 SPAC 유형/플래그 → 공식 코드 분류 → 미등재 종목에 한해 제한적인 이름 보조 판별. 공식 일반 주식 플래그가 있는 `스팩트럼` 같은 이름을 문자열 때문에 제외하지 않는다. 같은 코드의 다른 원천에서 SPAC 근거가 발견되면 별칭 행도 함께 숨긴다. 메인 결과, 제외 필터, 과거 행, 대시보드 최근 이력, 상세 진입에 동일 정책을 적용한다.

`pattern_detect.is_excluded_stock()`와 주문 필터는 수정하지 않았다. 서버의 원본 결과·제외 사유·저장 이력도 그대로 남는다.

## 실행한 검증

```text
python scripts/build_scanner_security_data.py
  KOSPI classified=912 spac=0 / KOSDAQ classified=1805 spac=69

node test/test_scanner_progress.js
node test/test_scanner_dashboard.js
node test/test_scanner_groups.js
node test/test_scanner_loading.js
node test/test_scanner_two_stage.cjs
node test/test_confirmation_ui.cjs
node test/test_scanner_public_states.cjs
  7개 프로그램 PASS

python -m pytest -q test/test_scanner_security_data.py test/test_public_scan_routes.py --disable-warnings
  18 passed (기존 FastAPI 수명주기 경고 10건)

python -m pytest -q test/test_signal_review.py test/test_pattern_detect.py
  quant-autotrade/local_bot/test_entry_priority.py
  quant-autotrade/local_bot/test_ninepay_runner.py
  quant-autotrade/local_bot/test_ninepay_signal_client.py
  quant-autotrade/local_bot/test_ninepay_trade.py
  quant-autotrade/local_bot/test_live_exclusion.py
  165 passed, 26 subtests passed

python test/qa_scanner_states_browser.py
  68 offline browser cases PASS (1440/375px × light/dark × 17상황)
python test/qa_confirmation_browser.py
  12 offline browser cases PASS (기존 fixture 회귀)
git diff --check
  PASS
```

브라우저 검증은 합성 종목·고정 시각·로컬 파일·공통 NineHttp/NineUI/NineAPI를 사용한다. 실제 계좌/주문 호출은 없다. 진행/대기/오류/휴장/미확인/지연, 100%와 확정 0, Shadow, 자료 결측, 빈 결과, 장외, 구버전 응답, 과거 성공, 정적 종목 마스터 로딩을 검증한다. 기간 전환·필터 수·중복 제거·스팩 숨김·375px 넘침 없음·신규 배치 완료 자동 갱신·필터 전환 추가 API 없음도 검증한다. 매 시나리오는 새로 탐색하여 새로고침 상태에서 시작한다.

기존 공개 API 테스트는 `master`에서 이미 반환하는 `longTermFilter`/`longTermQuality`가 기대값에 빠져 있었다. 기대 계약만 보완했으며 서버 응답 코드는 변경하지 않았다.

추가 진단으로 실행한 `test/test_ui_ia.py` 전체 사이트 문자열 계약에는 기존 실패가 있다. 최초 pytest 실행은 50 실패/129 통과/37 하위 검증 통과였다. 동일 조건의 변경 전후 비교에서는 각 49 실패였으며 새 실패 집합은 비어 있었다. 이 작업에서 전역 메뉴/기사/다른 차트의 오래된 문자열 계약까지 변경하지 않았다. 전체 사이트 테스트가 모두 통과했다고 주장하지 않는다.

## 자동매매 무변경 확인

`git diff -- scripts/cloud-vm/ quant-autotrade/` 결과가 비어 있다. 탐지 조건, 주문 승인, 손절/익절, 배분, 보유 제한, 시세 연결, 저장 이력은 무변경이다. `publicConfirmation()` 함수 본문은 기준 커밋과 바이트 비교하여 동일함을 확인했다.

```text
publicConfirmation SHA256
0dd3584b2bd5427fd0074446d90624fc5535ba2a9a4bdc0396bdfe10388ed338
```

표시용 병합에서는 오래된 발생 기록이 최신 수신가를 덮지 않게 했고, 해당 최신 가격을 원래 검증 함수에 전달한다. 주문 경로에는 영향을 주지 않는다.

## 화면 증빙

모두 동일한 합성 입력을 사용한 로컬 화면이다. 운영 결과/실제 계좌 화면으로 오해하지 않도록 화면 자체에도 표시했다.

| 환경 | 변경 전 | 변경 후 |
|---|---|---|
| PC 1440px · 밝은 화면 | [전](qa/scanner-states-2026-10-28/before-1440-light.png) | [후](qa/scanner-states-2026-10-28/after-1440-light.png) |
| 모바일 375px · 밝은 화면 | [전](qa/scanner-states-2026-10-28/before-375-light.png) | [후](qa/scanner-states-2026-10-28/after-375-light.png) |
| PC · 다크모드 | [전](qa/scanner-states-2026-10-28/before-1440-dark.png) | [후](qa/scanner-states-2026-10-28/after-1440-dark.png) |
| 모바일 · 다크모드 | [전](qa/scanner-states-2026-10-28/before-375-dark.png) | [후](qa/scanner-states-2026-10-28/after-375-dark.png) |

[PC 확정 0·Shadow 연구](qa/scanner-states-2026-10-28/after-1440-light-shadow.png) · [모바일 확정 0·Shadow 연구](qa/scanner-states-2026-10-28/after-375-light-shadow.png)

## 변경 파일

- `js/scanner-progress.js`, `css/scanner-progress.css`: 기존 SVG 복원·압축·신호 집계 분리.
- `js/pattern-scan.js`, `css/pattern-scan.css`: 통합 상태 목록·상태별 근거·중복 제거·공개 제외·기존 이력/상세 재배치.
- `js/scanner-dashboard.js`: 과거 성과 표기와 SPAC 최근 이력 표시 제외.
- `js/scanner-security-data.js`, `scripts/build_scanner_security_data.py`: 공식 유형 정적 스냅샷과 수동 재생성 도구. 기존 `build_dcf_data.write_js` 원자적 저장 재사용.
- `test/test_scanner_public_states.cjs`, `test/test_scanner_security_data.py`: 새 상태·공식 유형 파서 회귀.
- `test/test_scanner_progress.js`, `test/test_confirmation_ui.cjs`, `test/test_public_scan_routes.py`, `test/qa_confirmation_browser.py`: 새 기본 화면/현재 공개 계약에 맞춘 회귀.
- `test/scanner-states.html`, `test/qa_scanner_states_browser.py`: 오프라인 브라우저 증빙.
- `.github/workflows/confirmation-regression.yml`: 새 상태/유형/공개 API 검증 추가.
- 이 보고서와 `docs/qa/scanner-states-2026-10-28/`의 전후 PNG 10개 및 기존 UI 계약 기준선 JSON.

## 데이터 제한과 후속 제안

- 유형 스냅샷은 실시간이 아니다. 신규 상장·유형 변경은 재생성 전까지 명시 플래그/제한적인 이름 판별에 의존한다. 주기적 재생성을 별도 운영 작업으로 권고한다. 로딩 실패 시 한계를 표시하고, 정적 파일 대기 때문에 화면 전체가 멈추지 않게 한다.
- 이력 API는 기존 90일/건수 제한과 캐시 범위를 유지한다. 상태 숫자는 조회한 자료 범위이며, 별도 이력·성과의 원본 집계와 같다고 주장하지 않는다. 원본 성과 통계는 내부 전체 표본을 포함할 수 있다.
- API가 주지 않는 기준가·현재가·관측 시각·개별 제외 상세·오류 로그는 만들어 내지 않는다.
- 실제 장중 피드/운영 브라우저 및 실제 주문은 이 작업에서 실행하지 않았다. 운영 배포 후 공개 화면 확인은 별도 승인 이후 수행한다.

## 배포와 롤백

1. 단일 PR의 검증 결과를 확인하고 배포 승인을 받는다. 현재 PR 브랜치만 push하며 `master`에 머지하지 않는다.
2. 승인 후 이 PR을 `master`에 머지한다. 저장소의 기존 GitHub Pages 정적 자산 배포 경로를 사용한다. VM 파일/데이터 경로를 변경하지 않았으므로 VM 재시작은 하지 않는다.
3. 배포 SHA와 새 `scanner-security-data.js` 응답을 확인하고 캐시 갱신 후 PC/375px·다크모드·상태 필터·공개 API 오류 상태를 확인한다. 배치 완료와 신호 0개를 별도로 확인한다.
4. 롤백은 이 PR의 머지 커밋을 `git revert`하여 `master`에 반영하고 동일 정적 자산 경로로 배포한다. 다른 변경이 섞인 `master`를 강제로 되감지 않는다. 저장 이력/계좌/주문 설정 복구는 필요 없다.
