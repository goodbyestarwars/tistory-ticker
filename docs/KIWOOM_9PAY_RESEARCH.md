# 키움 중심 9Pay 장중 관찰 연구

이 브랜치는 주문·계좌·운영 설정과 분리된 순수 연구 모듈 `scripts/research/kiwoom_9pay_observer.py`만 추가한다. 자동 실행·배포·PC 설치는 없다.

## 입력·연결

- 후보: 기존 `market_rank.fetch_volume_top`의 키움 `ka10030` 거래량순 응답과 연구 전용 `fetch_amount_top`의 `ka10032` 거래대금순 응답을 반씩 합쳐 최대 30개로 제한한다. 후자는 키움 공식 예제의 요청 파라미터·`trde_prica_upper` 응답 필드를 따른다. 호출은 주입한 기존 `kiwoom_client.call_tr`로만 하며, 현재 자동 실행/주기 설정은 없다. 금액 순위 호출에 실패하면 `amount_rows=None`으로 거래량 순위 안에서만 대체하고 **부분 후보 범위**로 표기해야 한다.
- 체결: 기존 `kiwoom_ws_hub`의 단일 연결에 `subscribe(codes)`로 붙이는 설계다. `REG refresh=0`는 전체 목록 교체이므로 별도 소켓/직접 REG를 만들면 구독 충돌 위험이 있다. 운영 허브 변경 없이 독립 관찰 모듈의 입력 계약만 마련했다. 공유 허브의 100개 상한은 설정값이며 30개 추가 수용 가능 여부는 다른 구독 수에 달렸다.
- 거래량: **키움 공식 0B 예제에서 누적 거래량은 FID `13`, FID `16`은 시가**다. 기존 `realtime_quotes._quote_events`가 `16`을 누적 거래량으로 읽는 코드는 잘못되었으나 이 PR은 운영 파일을 수정하지 않는다. `kiwoom_ws_hub._dispatch`가 그 `volume`을 제거하므로 현재 공유 허브 경로로는 거래량을 받을 수 없다. 거래량 없는 키움 이벤트는 `volumeMissing=true`이고 신호가 나지 않는다. 기존 KIS 누적 거래량 REST 폴링값을 `observe(..., cumulative_volume=..., source='KIS polling')`에 주입하는 대안은 가능하지만 **이 PR은 호출·운영 연결을 하지 않았다**.
- 신호: 직전 거래일 거래량 대비 3분 내 누적 증가 3% 이상 → 해당 시점 이후 고점에서 1% 첫 눌림 → 고점 위 가격 및 누적 거래량 증가 시 종목당 관찰 신호 1회. 임계값은 연구 가설이며 수익성 검증값이 아니다. 틱/폴링 시각이 앞뒤로 뒤섞이거나 누적량이 감소하면 신호를 내지 않는다.

## 검증·후속 게이트

후보는 두 순위 응답 밖 종목을 놓친다. 최초 조건 충족 시각은 표본 주기에 따라 늦게 관측된다. 결과에는 공급자·관측시각·거래량 결측·신호 이후 관측가격 MFE/MAE를 남긴다. 원시 이벤트·순위 스냅샷·후보 편입/이탈·감지 지연·구독 거절·드롭·API 호출수·RSS를 제한된 로그에 기록할 운영 관찰기는 후속 작업이다. 1GB VM에서 30종목×120표본 이내의 상태만 유지하는 구조이나 실측 메모리 사용량은 미확인이다. 키움 `ka10032` 실제 응답/제한, 0B FID 13 장중 값·리셋 및 30개 등록, 장중 지연·누락을 확인한 뒤 허브 공급 경로를 열어야 한다.

공식 근거: [키움 0B 실시간 예제](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/main/examples/%EA%B5%AD%EB%82%B4%EC%A3%BC%EC%8B%9D/%EC%8B%A4%EC%8B%9C%EA%B0%84%EC%8B%9C%EC%84%B8/subscribe_domestic_stock_trade_pubsub.py), [ka10032 예제](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/main/examples/%EA%B5%AD%EB%82%B4%EC%A3%BC%EC%8B%9D/%EC%88%9C%EC%9C%84%EC%A0%95%EB%B3%B4/get_domestic_trading_value_top.py).

스윙 11개 기존 검색기와 20:10 `daily_scan.py` 배치는 그대로 둔다. 장중 지지/추세 추적은 당일 후보에 전일 확정 일봉의 지지·이평 수준을 읽기 전용으로 붙이고, 같은 `observe` 시각의 가격과 비교하는 별도 연구 단계를 권장한다. 21:00 배치는 패턴 결과 생성이 아닌 캐시 작업이다.

비밀값은 저장소/채팅에 넣지 않는다. 후속 로컬 검증 시 기존 PC/VM의 비공개 환경 설정에서 키움 앱키·시크릿을 읽되 로그엔 기록하지 않는다. 이 저장소의 연구 모듈 자체는 키가 필요 없다.
