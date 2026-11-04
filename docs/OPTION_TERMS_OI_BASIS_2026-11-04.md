# 옵션 용어 개선 및 OI 기준 확인 — Oracle Claude Code 인계

2026-11-04 KST. 먼저 CLAUDE.md를 읽는다. 비밀키를 GitHub·문서·로그에 복사하지 않는다. 실계좌 주문·계좌 API·자동매매 서비스에 접근하거나 활성화하지 않는다.

## 확인된 계산 경로

- scripts/cloud-vm/option_flow.py: refresh_option_flow → _window_rows → option_window.fetch_window → kis_client.fetch_option_quote. 현물 부근 창 실패 시 fetch_option_board 응답 사용.
- _aggregate는 acml_vol, hts_otst_stpl_qty, otst_stpl_qty_icdc를 각각 합산한다. _strike_rows도 같은 증감 필드를 저장한다. 이전 수집값과 차감하는 코드가 없다.
- option_window.fetch_window는 개별 시세 응답을 그대로 유지한다. OI 증감을 재계산하지 않는다.
- 실제 _POLL_INTERVAL_SEC는 30 * 60. realtime_ws_enabled는 False.
- KIS 공식 examples_llm/domestic_futureoption/inquire_price/chk_inquire_price.py는 otst_stpl_qty_icdc를 '미결제 약정 수량 증감'으로만 정의한다. 공식 실시간 예제는 별도 otst_stpl_rgbf_qty_icdc를 '미결제 약정 직전 수량 증감'으로 구분하지만, 이것만으로 현재 REST 필드의 전일 기준일을 확정하지 않았다.
- 따라서 UI는 'KIS 제공값(비교 기준 미확인)', '직전 수집값을 빼서 계산한 수치가 아닙니다'로 표기한다. 전일 대비라는 추정은 넣지 않는다.

## 서버에서 필요한 후속 확인 (읽기 전용)

1. 기존 설치 경로·배포 SHA·수집 상태를 확인한다. 새 수집기·상시 프로세스를 만들거나 서비스 재시작하지 않는다.
2. 서버에 이미 설정된 비공개 인증으로 기존 읽기 전용 시세 응답과 저장된 스냅샷만 확인한다. 키 값·원시 응답을 외부로 내보내지 않는다.
3. 동일 옵션 코드·만기·거래일에 대해 공급자 공식 명세/답변으로 otst_stpl_qty_icdc 기준을 확인한다. 기존 기록으로 전일 확정 OI와 현재 OI의 차이, 연속 수집 시점 차이를 대조한다. 범위가 바뀌는 합계끼리 비교하지 않는다.
4. 공식 정의와 일치하는 근거가 확보된 경우에만 UI 문구를 '전 거래일 대비' 등 정확한 기준으로 교체한다. 근거 부족이면 '비교 기준 미확인' 유지. 날짜·판정·공개 가능한 근거만 짧게 기록한다.

## 웹 변경·배포

js/kospi-futures.js만 런타임 변경. 기존 NineUI 포맷/escapeHtml·NineHttp·mi-sub/mi-sub-cap·전역 CSS 사용. native title 툴팁과 모바일에서 열 수 있는 details 용어 설명을 추가했다. DOM·API 경로·공급자·수집/주문 로직 유지. OI 증감 null은 '미제공' 표시.
master push → 저장소 기존 Pages legacy build (source master /). skin.html 변경 없음, Tistory 수동 스킨 반영 불필요. Oracle 코드 변경·재시작 불필요.
검증: JS 구문·기존 OI 라벨/접기 회귀 통과. Edge headless 1280/390px 라이트·다크 가로 넘침 없음. 화면 확인은 fixture이며 실제 시장값의 정확성 검증과 별개다.
