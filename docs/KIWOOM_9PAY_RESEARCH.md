# 키움 중심 9Pay 장중 관찰 연구

순수 연구 상태기는 `scripts/cloud-vm/kiwoom_9pay_observer.py`에 있으며 주문·계좌와 분리된다.

## 입력·연결

- 후보: `kiwoom_9pay_live.py`가 장중 60초마다 기존 키움 클라이언트로 `ka10030` 거래량순과 `ka10032` 거래대금순을 각각 1회 읽어 최대 20개를 합친다. 후자는 키움 공식 예제의 요청 파라미터·`trde_prica_upper` 응답 필드를 따른다. 실패하면 거래량 순위 내 거래대금순으로 대체하고 `amountFallback=true`로 표시한다. 두 순위 밖의 종목은 누락된다.
- 체결: 기존 `kiwoom_ws_hub`의 단일 연결에 `subscribe(codes, include_volume=True)`로 붙는다. 기존 화면 구독은 `include_volume=False`여서 응답 모양이 바뀌지 않는다. `REG refresh=0`는 전체 목록 교체이므로 별도 소켓/직접 REG를 만들지 않는다. 공유 허브의 100개 상한은 설정값이며 연구 구독은 최대 20개로 제한한다. 다른 구독의 등록 가능 여부는 `/health/realtime`의 `droppedCount`로 확인한다.
- 거래량: **키움 공식 0B 예제에서 누적 거래량은 FID `13`, FID `16`은 시가**다. 파서를 13으로 수정했다. 연구 구독자에게만 거래량을 전달한다. 장중 키움 틱이 60초간 없으면 기존 `volume_surge_live` KIS 30초 순위 표본을 메모리에서 읽는다(추가 KIS API 호출 없음). 공급자별 상태기를 분리해 누적량을 섞지 않는다. 키움/KIS 모두 결측이면 `volumeMissing=true`이며 신호가 나지 않는다.
- 신호: 직전 거래일 거래량 대비 3분 내 누적 증가 3% 이상 → 해당 시점 이후 고점에서 1% 첫 눌림 → 고점 위 가격 및 누적 거래량 증가 시 종목당 관찰 신호 1회. 임계값은 연구 가설이며 수익성 검증값이 아니다. 틱/폴링 시각이 앞뒤로 뒤섞이거나 누적량이 감소하면 신호를 내지 않는다.

## 검증·후속 게이트

후보는 두 순위 응답 밖 종목을 놓친다. 최초 조건 충족 시각은 표본 주기에 따라 늦게 관측된다. `/health/realtime`의 `ninePayResearch`는 후보·순위 오류·폴백·거래량 틱·KIS 표본·신호 수를 표시한다. 회전 로그 `kiwoom_9pay_research.jsonl*`은 순위 후보와 신호, 5분 간격 관측가격 MFE/MAE를 기록한다(토큰·계좌 없음). 최대 20종목×120표본/공급자로 상태를 제한하며 VM 실제 RSS 영향은 활성화 뒤 실측한다. 감지 지연은 원시 시장 조건 충족시각 자료가 없어 관측 주기의 상한만 제시할 수 있다. `ka10032` 실제 응답/제한, FID 13 장중 값·리셋, 20개 등록·누락은 다음 거래일 실측이 필요하다.

활성화: VM 서비스의 비밀값 없는 환경변수 `NINEPAY_RESEARCH_ENABLED=1`과 기존 키움 앱키·시크릿이 있을 때만 FastAPI 내부 스레드가 시작한다. 장외에는 순위 API·구독을 하지 않는다. 비활성화하려면 환경변수를 제거하고 서비스를 재시작한다. 실계좌 엔진·주문 경로·20:10 배치는 연결하지 않는다.

공식 근거: [키움 0B 실시간 예제](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/main/examples/%EA%B5%AD%EB%82%B4%EC%A3%BC%EC%8B%9D/%EC%8B%A4%EC%8B%9C%EA%B0%84%EC%8B%9C%EC%84%B8/subscribe_domestic_stock_trade_pubsub.py), [ka10032 예제](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/main/examples/%EA%B5%AD%EB%82%B4%EC%A3%BC%EC%8B%9D/%EC%88%9C%EC%9C%84%EC%A0%95%EB%B3%B4/get_domestic_trading_value_top.py).

스윙 11개 기존 검색기와 20:10 `daily_scan.py` 배치는 그대로 둔다. 장중 지지/추세 추적은 당일 후보에 전일 확정 일봉의 지지·이평 수준을 읽기 전용으로 붙이고, 같은 `observe` 시각의 가격과 비교하는 별도 연구 단계를 권장한다. 21:00 배치는 패턴 결과 생성이 아닌 캐시 작업이다.

비밀값은 저장소/채팅에 넣지 않는다. VM의 기존 비공개 키움 환경 설정을 재사용한다.
