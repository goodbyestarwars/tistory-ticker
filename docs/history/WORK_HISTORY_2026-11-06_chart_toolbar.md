**2026-11-04 미국 애널리스트 기관별 의견 문구 · Finnhub 무료 범위 재확인**

요청: "권한 미확보" 문구 변경, 무료 여부 재확인. 변경: `js/us-stocks.js` 기관별 투자의견 머리말을 "제공하지 않음"으로(코드 `access_denied` 처리는 그대로). 확인(2026-11-04 Finnhub 공식 문서 사이드바): Recommendation Trends는 Premium 표시 없음(무료), Upgrade Downgrade·Price Target은 Premium. 한도: 전 플랜 초당 30회 상한(무료 분당 한도는 문서에서 못 찾음). 미확인: 무료 키 데이터의 사이트 재표시 약관. 배포: master → Pages.

**2026-11-04 미국 호가강도를 10단계 총잔량 비율로**

요청: 미국 호가강도가 초 단위로 요동침. 원인: 매도·매수 각 최대 한 칸끼리 나눈 값이라 주문 한두 건에 크게 변동. 변경: `js/us-stocks.js` 호가강도·우위 문구를 10단계 총잔량(매수÷매도) 기준으로(저항·지지 막대는 기존 최대 한 칸 그대로). 검증: test_us_stocks.py 15 passed, 실제 화면 확인 미실시. 배포: master → Pages.

