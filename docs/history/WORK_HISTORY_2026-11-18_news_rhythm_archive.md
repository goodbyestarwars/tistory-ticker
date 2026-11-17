**2026-11-13 자동매매 운영센터 날짜별 매매 판단 로그**

- 목적: SSH 복기 없이 관리자 전용 화면에서 왜 매수·매도했는지, 어떤 검색기·후보 순위·손절 판단을 썼는지 확인.
- 변경(공개 master): 기존 `/autotrader/status.activity`의 주문 `decision` 허용 목록(검색기/스캔일/전일 기준가/순위/거래대금/평단/손절 확인 횟수), `skips`(미진입 사유/횟수), `botOrders`(별도 봇 매도 사유)를 `autotrader_control.py`에서 재검증. `js/auto-trader.js` 날짜 선택·주문별 판단 카드·정확히 맞는 스캔일의 후보 선정 설명·미매수 사유·CSV 확장, `css/auto-trader.css` 반응형/다크 공통 토큰. 기존 스케줄/제어/주문·승인 정책 무변경.
- private VM: `goodbyestarwars/autotrader-private` PR #1(draft)은 에이전트의 `activity()` 읽기 전용 전송 필드 확장, **main 미병합/운영 미적용**. 자동 pull에 따른 VM 재시작 가능성 있어 별도 실계좌 운영 승인 전 병합하지 않는다.
- 검증: 백엔드 `test/test_autotrader_control.py` 허용 목록/비밀 필드 차단 회귀 추가. 실행·운영 실제 Google VM DB/화면·체결 결과는 미검증. 공개 master→Pages/Oracle 자동 배포 대상(운영 서버 반영은 미확인). 과거 주문에 근거가 없으면 미수신 표시하며 접수(ACK)를 체결로 표시하지 않음.

