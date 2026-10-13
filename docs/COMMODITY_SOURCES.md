# 에너지·원자재 선물 데이터 (2026-10-14 운영 계정 실측)

## 검증 결과

KIS 공식 `ffcode.mst` 상품 마스터의 `최근월물여부=1`과 운영 VM 계정의 해외선물 REST 응답을 대조했다. 코드는 월물 교체에 따라 달라진다. 아래 코드는 검증 시점의 값이다.

| 목표 | 최근월물 코드 | 거래소 | 현재가·변동률 | 일봉 | 운영 시세 권한 | 화면 |
|---|---|---|---|---|---|---|
| WTI | CLX26 | NYMEX | HTTP 500, EGW00551 | 같은 권한 오류 | 미신청 | 기존 Naver 비공식 선물 시세 유지 |
| 금 | GCZ26 | COMEX | HTTP 500, EGW00553 | 권한 미확보 | 미신청 | 기존 Naver 비공식 선물 시세 유지 |
| 브렌트유 | BRNZ26 | ICE | 정상, 가격·전일대비·등락률·고저·체결시각 | 정상, OHLC 5행 실측 | 조회 가능 | KIS 추가 |
| 천연가스 | NGX26 | NYMEX | HTTP 500, EGW00551 | 권한 미확보 | 미신청 | 미표시 |
| 은 | SIZ26 | COMEX | HTTP 500, EGW00553 | 권한 미확보 | 미신청 | 미표시 |
| 구리 | HGZ26 | COMEX | HTTP 500, EGW00553 | 권한 미확보 | 미신청 | 미표시 |

KIS의 `rt_cd=0`이더라도 코드가 틀리면 값이 빈 응답이 올 수 있으므로, HTTP 성공만으로 종목 검증을 끝내지 않는다. KIS 현재가의 `proc_date`·`proc_time`은 운영 실측에서 한국시간 진행 시각과 일치했다. 별도의 시세 지연 계약 수준은 확인되지 않아 화면에 **지연 여부 미확인**으로 표시한다.

## 운영 정책

- 수집 우선순위: 검증된 KIS ICE 브렌트유만 KIS를 사용한다. WTI·금은 기존 Naver 수집을 유지한다. NYMEX·COMEX 권한을 확보하기 전에는 KIS 우선 전환을 활성화하지 않는다.
- 브렌트유는 공식 마스터 파일에서 ICE `BRN` 최근월물을 12시간마다 다시 고른다. 마스터 실패 시 직전 코드를 사용하되 새로운 가격이 유효할 때만 저장한다.
- 시세의 실제 처리시각이 현재보다 20분 넘게 오래되면 새 값으로 저장하지 않으며 `/futures`와 WebSocket은 기존 보관값도 `stale=true`, 가격 없음으로 내린다. 휴장 시 최신가로 오인하지 않도록 한다.
- 월물이 바뀌면 이전 월물 일봉을 제거한다. `BRENT` 일봉을 만기 교체를 조정한 연속선물로 해석하지 않는다. 화면의 5년 선택에 자료가 부족하면 실제 제공 기간만 표시한다.
- 브렌트유 KIS 오류 시 근거 없는 다른 선물·현물로 대체하지 않는다. WTI·금의 기존 Naver 경로는 독립적으로 계속 작동한다.
- EIA·FRED 일간/현물 지표는 이번 실시간 선물 화면에 섞지 않는다. 에너지·원자재 그룹의 방향성 해석은 계속 비활성이다.

공식 근거: [KIS 해외선물 현재가 예제](https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/overseas_futureoption/inquire_price), [일간 체결추이 예제](https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/overseas_futureoption/daily_ccnl), [상품 마스터 다운로드 코드](https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/overseas_future_code.py).
