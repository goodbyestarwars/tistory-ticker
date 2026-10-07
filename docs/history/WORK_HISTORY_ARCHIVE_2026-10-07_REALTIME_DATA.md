# 작업이력 이관

**2026-10-04 업종 로테이션(홈 국내 시장 카드 하단)**

목적: "업종 상승률 순위"가 아니라 시장 대비 상대강도·순위 변화·Breadth·거래대금으로 자금 이동을 유입/주도/둔화/이탈로 분류. `scripts/cloud-vm/sector_rotation.py` 신설(순수 계산 + SQLite `sector_rotation_daily` 일별 스냅샷), `GET /sector-rotation`(+`/{업종}` 상세, 5분 캐시), `js/home-sector-rotation.js`·`css/home-sector-rotation.css`(정보 스트립, 각 상태 3개, 클릭 상세, 모바일 2열), `js/skin-main.js`에 자리·로더. 데이터: 운영 sector_cards 37개 테마(코스피 3대장 제외), `daily_prices` 일봉 확정값(장중 틱·실시간 계산 없음). 업종 수익률=구성종목 median(시총 데이터 없음), Benchmark=전 종목(일평균 거래대금 5억 이상) 수익률 median, 순위=5일 상대강도 순위(5거래일 전 같은 방식 순위와 비교), 점수=퍼센타일 기반 30/15/20/20/15, 상태는 히스테리시스 적용(판정 기준 상수는 파일 상단). 검증: `test_sector_rotation.py` 25건, 실제 일봉(238종목, 벤치마크는 풀 자체로 대체)으로 32개 업종 분류 확인. 배포: master 반영 시 VM·GitHub Pages 자동, 첫 스냅샷은 첫 호출 시 저장.
