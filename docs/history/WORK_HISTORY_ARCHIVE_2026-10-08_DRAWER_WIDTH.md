# 관심종목 폭 수정 시 이전 기록 이관

**2026-10-04 종목분석 "거래원 매매 상위" 추가**

사용자 요청(토스 화면 참고, 다른 항목은 이미 수집 중이라 거래원만). `GET /stock-members/{code}`(장중 30초·장 밖 10분 캐시) = KIS 주식현재가 회원사 `FHKST01010600`(공식 예제 계약 그대로, KRX), `kis_client.fetch_domestic_member`·`member_ranking`(매수/매도 상위 5·외국계 여부·외국계 합계). 종목분석 수급 탭의 수급 카드 아래에 매수|매도 두 열 막대(각 쪽 1위 대비 길이, 매수 빨강·매도 파랑), 실패 시 구역 숨김. 비중·증감 필드 단위는 실측 전이라 화면에 쓰지 않음. 검증: `test_kis_member_ranking.py` 2건. 배포: master 반영 시 VM·GitHub Pages 자동.
