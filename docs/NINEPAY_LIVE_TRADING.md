# 9Pay 장중 실계좌 연결

- 사용자 선택: 기존 PC 엔진의 100만 원 예산, 최대 3종목, 종목당 30만 원, 10만 원 현금 유보를 공유한다. 매도는 기존 엔진의 -3% 연속 확인, -5% 즉시 손절, +3% 도달 후 고점 대비 -2.5% 규칙을 사용한다.
- VM의 기존 관찰기는 주문 기능이 없다. `/health/realtime`의 `ninePayResearch`에 신호 ID·발생가를 추가하고, PC가 HTTPS로 3초마다 확인한다. REST 순위가 불완전하거나 120초 이상 지났거나, 신호가 10초 이상 지났거나, 거래량이 결측이면 매수하지 않는다.
- PC 전용 파일은 `quant-autotrade/local_bot/live_runner_9pay.py`, `ninepay_signal_client.py`, `ninepay_trade.py`다. PC의 기존 `live_engine.py`와 `live_kiwoom.py`를 그대로 호출하며 별도 계좌·장부·주문 프로세스를 만들지 않는다. 기존 엔진 매도 주기는 30초다.
- 실제 주문에는 기존 `LIVE_TRADING=1`·계좌 지문 승인 파일과 별도로 PC `.env`의 `NINEPAY_LIVE_TRADING=1`이 필요하다. 이 값은 현재 **미설정**이다. 키·토큰·계좌번호는 문서/저장소에 넣지 않는다.
- 설치 위치는 사용자의 `autotrader` 폴더이며, `live_runner.py`를 백업한 뒤 `live_runner_9pay.py` 내용으로 교체한다. 기존 주문 클라이언트는 `live_kiwoom.py`로 분리해 다른 봇 설치가 덮어쓰는 `kiwoom.py`와 충돌을 피한다. 되돌리려면 백업 `live_runner.py`를 복원하고 `NINEPAY_LIVE_TRADING`을 제거한다.
- 매수 전 계좌·기존 보유/미체결·장부의 미확정 주문·제외 종목·가용 현금·전체 예산·종목 수를 다시 확인한다. 키움 `ka10001` 현재가가 신호가보다 0.3% 넘게 높으면 추격하지 않는다. 주문 전 intent를 먼저 저장하고 응답이 불확실하면 자동 재시도하지 않는다.
- 미확인: 다음 거래일 실시간 0B FID 13 값, 20개 등록 성공/누락, REST 순위 정확성·지연, KIS 폴백 시 신호 수·시점, 실제 체결·MFE/MAE·손익, PC에서 실주문 응답. 첫 장중 관측과 소액 실행 전까지 9Pay 스위치를 켜지 않는다. 기존 시작 현금 기준도 현재 `WAIT`이므로 신규 매수는 차단된다.
