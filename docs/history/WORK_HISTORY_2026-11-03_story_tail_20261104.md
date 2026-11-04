**2026-11-03 오픈소스 라이선스 페이지에 TradingView 저작권 고지·링크 추가**

Lightweight Charts는 로고(attributionLogo)를 끄면 NOTICE 문구와 https://www.tradingview.com/ 링크를 사용자가 볼 수 있는 페이지에 둬야 한다(공식 README). 기존 페이지는 라이선스명과 GitHub 링크만 있어 `legal/opensource-license.html`에 NOTICE 문구와 링크를 추가. 검증: 파일 diff 확인, 푸터 링크 경로 기존 유지. 배포: master 푸시 후 Pages.

**2026-11-03 종목 스토리 전 종목 자동 생성 스크립트(PC 2주 1회 스냅샷)**

목적: 시범 3종목의 발견형 카드를 전 종목으로 확대. 변경: `scripts/build_stock_stories.py` 신설(전송·인증·종목 풀은 `fetch_investor_flow.py` 재사용) — 키움 ka10001/ka10014/ka10059로 종목마다 받아 기준을 넘는 카드만 생성(흑자인데 고점 대비 -35%↓, PBR<1·52주 저가 근처, 순매도 쪽이 시총 1%↑이고 반대편이 60%↑ 받음, 공매도 20일 평균 8%↑ 또는 최근5일 2배↑) + 반증 조건 + '틀려지는 때' 카드. 기준 미달 종목은 카드 없음. 수기 항목(한화오션 등)은 보존, 이전 auto 항목은 교체. 공매도는 잔고가 아니라 거래량 비중만 사용. `test/test_build_stock_stories.py` 추가. 검증: 단위 테스트 통과(합성 입력). 미검증: 키움 REST 실호출(이 세션에 키 없음, 필드명 250hgst/250lwst/bus_pro/mac/bps는 MCP 응답 기준), --all 실행 시 파일 크기(600KB 초과 시 분할 필요). 배포: 스크립트만, 데이터 파일 변경 없음.

**2026-11-03 미국 실적 캘린더 한글 종목명 S&P 500 전체로 확대**

원인: 서버 응답의 `company`가 비어 있고(11월 미국 178건 전부) 화면 이름표 `US_COMPANY_NAME_MAP`이 S&P 100(107개)뿐이라 PLTR 등 399개가 티커로만 표시됨. 변경: `js/stock-calendar.js` 이름표에 399개 추가(회사명 확신 없는 P·ECHO·VMRK는 제외, 티커 표시 유지). 검증: 스크립트 구문·캘린더 JS 테스트. 배포: master 푸시 후 Pages.
