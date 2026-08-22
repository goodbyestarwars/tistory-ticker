# 9Pay 주요 작업이력

**2026-08-22(8차) 눌림목(`detect_pullback`/`detectPullback_`) 보강**: 작업지시서 7단계 중
1~4번 반영, 5~7번은 지시대로 보류/분리.
1) 저점 탐색을 "오늘 기준" 창(recentStart)에서 "고점 기준" `PULLBACK_LOW_SEARCH_WINDOW`
(25봉) 창으로 재anchoring - 6개월 전 저점 대비 계산되는 착시 방지 목적.
2) 조정구간 최대거래량이 상승구간 최대거래량의 `PULLBACK_MAX_VOL_RATIO`(0.70) 이하여야
하는 조건 신설 - 구현 중 "고점 당일을 조정구간에 포함시키면 고점 자체가 보통 상승구간
전체 최고 거래량이라 조건이 사실상 항상 실패한다"는 걸 발견해 조정구간을 고점 당일이
아니라 다음 날부터로 정의(기존 `is_volume_declining`의 평균 비교 방식은 그대로 고점
포함 유지 - 둘은 성격이 다른 별개 체크라 안 건드림).
3) "20일선 상승 중" 단일 조건을 `PULLBACK_TREND_FILTER_VERSION` 플래그로 두 버전 중
선택 가능하게 변경 - A(`ma5_above_ma20`, 정배열 초입) / B(`ma20_slope_tol`, -0.5% 이내
완만한 하락 허용). 기존 회귀 테스트 데이터로 실측한 결과 A는 탈락(조정구간엔 5일선이
20일선보다 먼저 처지는 게 흔함), B는 통과해서 기본값을 B로 정했다(사용자가 지시서에서
기본값을 특정하지 않아 실측 근거로 선택, 백테스트 비교 후 재확정 예정).
4) `check_pullback_entry_trigger(daily, pullback_result)` 신설 - 지지선(20/240일선) 근접
Zone 확인 후 아래꼬리 캔들 또는 양봉 전환 중 하나만 있어도 `entry_signal=True`(박스권의
"2개 중 2개 이상"과 달리 지시서 문구대로 "1개 중 1개"). `detect_pullback` 결과에
`entryTrigger`/`entrySignal` 필드 추가.
5) 거래대금 필터는 `PULLBACK_MIN_TRADING_VALUE=0`(비활성 placeholder)으로만 분리.
6) 시장 지수 필터는 지시대로 함수 내부에 안 넣고 `check_market_regime(index_daily,
ma_period)`을 별도 함수로 신설(호출부는 아직 없음 - 지수 데이터 소스 연결은 이번 범위
밖).
7) 점수 체계는 지시대로 그대로 유지.
`gas/ticker-proxy.gs`의 `detectPullback_`(온디맨드 차트 재판정용)에도 1~3번을 동일하게
반영(4~6번은 VM 전용, 박스권 선례와 동일). 기존 `pullback_daily()` 테스트 픽스처가 새
조건(고점 당일 거래량이 상승구간 최고치라 조정구간 최대비율 조건을 위반, 기본값이 B로
바뀌며 A 조건 자체는 문제 없었음)에 안 맞아 조정구간 거래량 값을 낮춰 갱신. 신규 회귀
테스트(entryTrigger 포함 확인, 거래량 급증 제외, 진입 트리거 3케이스, 시장국면 함수
2케이스) 추가, 전체 46건 통과.

**2026-08-22 "시초 갭상승" 탭 삭제**: 사용자 요청으로 `js/pattern-scan.js`의 TABS
목록에서 `openingGap` 항목만 제거(화면에서 사라짐). 백엔드(`pattern_detect.detect_opening_gap`,
GAS `?patternScan=1` 데이터, `scripts/cloud-vm/opening_gap.py` 백테스트 모듈)는 되돌리기
쉽게 그대로 남겨뒀다(daily_scan.py가 계속 계산은 하지만 화면에 안 보임, 무해). 나머지
`openingGap` 관련 코드 분기(상세 스냅샷·차트 렌더링)는 이제 도달 불가능한 죽은 코드지만
같은 이유로 남겨뒀다. `test/test_ui_ia.py`의 `test_chart_search_includes_opening_gap_tab`을
탭이 없어졌는지 확인하는 테스트로 전환하고, 공통조건 테스트에서 시초 갭상승 전용
어서션을 제거. 전체 회귀 98(UI)+37(pattern_detect) 통과.

**2026-08-22(7차) 박스권 하단 Zone 계산식 확인 + 진입 트리거 신설 + 조건 라벨 정리**:
작업지시서 4단계 전부 반영.
1단계(확인): "박스 하단 위치" 조건(`lower_position=(종가-support)/box_height`, 범위 -2%~35%)이
절대가격 기준이 아니라 **박스 높이 비율 기준**(형태 B)임을 코드로 확인 - 조건 A(20봉
종가 변동폭 10% 이내)와 단위 자체가 달라서(A는 종가 변동폭, 이건 박스 높이 대비 위치)
35%가 10%보다 커도 논리적 모순이 아니었다. 값은 임의로 안 바꾸고 주석에 근거만 추가.
2단계(신설): `check_box_range_low_entry_trigger(daily, box_result)` 함수 추가 - 박스
하단 Zone 안에서도 캔들(양봉/망치형)·거래량(직전5봉평균 1.3배 이상)·5일선(상향돌파 또는
1% 이내 근접) 3개 신호 중 2개 이상 충족해야 `entry_signal=True`. 튜닝 상수
(`BOX_ENTRY_VOLUME_MULT`=1.3, 망치형 배수=2.0, 5일선 근접=1%)는 지시서 명시대로 임의
초기값 - 추후 백테스트로 조정 필요.
3단계: `detect_box_range_low` 리턴에 `entryTrigger`(위 함수 전체 결과)/`entrySignal`(bool)
추가.
4단계: 조건 라벨을 A,B,C,D,E(구 G, 시가이평),F(구 J, 수익률),G(구 E, 시가총액)로
실행 순서에 맞춰 연속 재정렬 - grep으로 확인한 결과 옛 라벨 문자열(`'A 최근...'` 등)을
참조하는 다른 코드(JS/GAS/테스트)가 없어 안전하게 변경. 로직·기준값은 전혀 안 바꿈.
GAS `detectBoxRangeLow_`는 이 A~G 스킴과 무관한 완전히 다른 구현(지지/저항 평균+터치
횟수 방식)이라 동기화 대상 아님(재확인).
검증: `test/test_pattern_detect.py`에 라벨 순서 테스트 1건 + `entryTrigger` 포함 확인 1건 +
`check_box_range_low_entry_trigger` 전용 테스트 4건(Zone 밖 제외/신호2개 통과/신호1개
미통과/box_result 없음 제외) 추가, 전체 37건 통과. 셀프 리뷰 중 "All A~G gates are hard
filters" 주석이 조건부 게이트인 G(시가총액)까지 hard filter라고 잘못 넓혀 쓴 걸 발견해
"A~F는 항상 필수, G는 require_market_cap=False일 때만 선택적"으로 정정.

**2026-08-22(6차) 역헤드앤숄더(`detect_inv_head_shoulders`/`detectInvHeadShoulders_`) 넥라인
계산 변경 + 신규 무효 조건 추가**: 사용자 요청 2건 반영. (1) 넥라인을 "좌어깨~헤드/헤드~우어깨
두 구간 고가 중 더 낮은 쪽"에서 "더 높은 쪽"(`max`)으로 변경. (2) 우어깨 이후 최저가가
헤드 저점보다 1% 넘게 더 빠지면(새로운 저점을 다시 만든 셈) 무효 처리하는 조건 신설 -
`min_low_between()`(쌍바닥 작업 때 추가한 헬퍼) 재사용. `pattern_detect.py`와
`gas/ticker-proxy.gs`의 `detectInvHeadShoulders_` 양쪽에 동일 반영. `test/test_pattern_detect.py`에
회귀 테스트 2건(`test_neckline_uses_the_higher_of_the_two_peaks`,
`test_new_low_after_right_shoulder_is_excluded`) 추가, 전체 31건 통과. `js/pattern-scan.js`
탭 설명 문구 갱신.

**2026-08-22(5차) 이평 상승 초입형에 최소 위치 조건 재도입 + 상단/하단 시도 점수 차등**:
사용자가 표+검증 코드로 제시한 수정안을 그대로 반영. (1) 3차에서 구름 하단 이탈을
전면 허용했더니 구름 하단을 한참 벗어난 역배열 약세 종목이 저가만 살짝 하단에 닿아도
고점수를 받는 문제가 있어, "종가 >= 구름하단 × 0.98" 최소 위치 조건을 다시 넣었다(장중
밀렸어도 종가 기준 최소 지지력은 있어야 함). (2) 구름 상단/하단 시도 점수를 차등 -
상단 시도(저항 돌파 임박)는 근접도에 따라 35~50점, 하단 시도(단순 지지 테스트)는
근접도와 무관하게 25점 고정(상단 대비 가치 낮춤), 둘 다 만족하면 상단 기준으로 채점.
`test/test_pattern_detect.py`에 최소 위치 조건 회귀 테스트(`test_far_below_cloud_bottom_is_excluded`)
추가, 전체 29건 통과. `js/pattern-scan.js` 탭 설명 문구 갱신.

**2026-08-22(4차) 쌍바닥(`detect_double_bottom`/`detectDoubleBottom_`)에 "두 저점 사이 더
낮은 저가 없음" 검증 추가**: 사용자가 제시한 검증 코드(`between_min_price = min(low_prices[
low1_idx:low2_idx])`, `min(low1,low2)*0.98`보다 낮으면 무효)를 그대로 반영 - 두 저점 사이에
그보다 2% 넘게 더 낮은 저가가 끼어있으면 진짜 W자 쌍바닥이 아니라 중간에 더 낮은 저점이
있는 잘못된 조합(삼중바닥/하락 추세)으로 보고 제외한다. `pattern_detect.py`에
`min_low_between()`(기존 `max_high_between`과 짝) 헬퍼를 추가하고 저점 가격차 확인 직후에
체크를 넣었다. GAS `ticker-proxy.gs`의 `detectDoubleBottom_`(온디맨드 차트 재판정용)에도
`minLowBetween_()` 헬퍼 + 동일 체크를 추가 - 단, 이 함수의 `DB_LOW_TOL`(0.02)/
`DB_MIN_GAP_DAYS`(12)/`DB_MAX_GAP_DAYS`(35)/`DB_SECOND_VOLUME_MAX_RATIO`(0.85) 상수가
Python 쪽(각각 0.03/10/45/1.00)과 이미 오래전부터 어긋나 있었음을 발견함(이번 작업 범위
밖이라 손대지 않음 - GAS는 스캔 목록이 아니라 클릭 시 온디맨드 차트 재판정에만 쓰여서
실사용 영향은 제한적이지만, 나중에 이 패턴을 다시 만질 때 같이 맞출 필요가 있음).
`test/test_pattern_detect.py`에 회귀 테스트(`test_deeper_low_between_the_two_bottoms_is_excluded`)
추가, 전체 28건 통과. `js/pattern-scan.js` 탭 설명 문구 갱신.

**2026-08-22(3차) 이평 상승 초입형 "구름 상단 시도" 조건에 "구름 하단 시도"를 OR로 추가**:
2차 수정 직후 사용자가 "하단 시도도 or로 넣어줘"라고 추가 요청 - 기존엔 고가가 구름
상단 3% 이내로 접근하는 것만 필수였는데, 저가가 구름 하단 3% 이내로 접근하는 것도
동등한 자격으로 인정해 둘 중 하나만 만족해도 통과하게 했다(`top_attempt or
bottom_attempt`). 점수 산정도 상단/하단 중 실제로 더 가깝게 시도한 쪽의 근접도를
기준으로 하도록 바꾸고(`cloud_gap = min(top_gap, bottom_gap)`), reasons/interpretation
문구도 "상단"과 "하단" 중 해당하는 쪽이 동적으로 나오게 했다. `test_pattern_detect.py`
27건 전부 통과(기존 하단 이탈 테스트가 상단·하단 둘 다 근접한 조합이라 이번 변경으로도
그대로 통과함을 재확인). `js/pattern-scan.js` 탭 설명·신호 라벨 문구 갱신.

**2026-08-22(2차) 이평 상승 초입형(`detect_ma_cloud_breakout`) 필수 조건 2개 완화/제거**:
사용자 확인 결과 (1) 구름 하단을 뚫고 내려간 경우도 "상승 초입"으로 포함해야 함(상단만
아직 안 넘었으면 통과 - 종가가 구름 아래에 있어도 제외하지 않도록 `close < cloud['bottom']`
하한 제거, `close > cloud['top']` 상한만 유지), (2) 최근 5거래일 안 5일선-20일선
골든크로스 요건은 완전히 제거(사용자: "골든 크로스 없어도 된다"). 이제 필수 조건은
224일선 근접(3% 이내) + 구름 상단 시도(고가가 상단 3% 이내) 2개뿐이다. 점수 배점도
기존 35/35/30(골든크로스 고정 30점) 구조에서 224일선50 + 구름상단시도50 2개로
재배분했다(최저 70점 보장, 최고 100점). `js/pattern-scan.js` 탭 설명·신호 라벨 문구도
갱신. `test/test_pattern_detect.py`의 골든크로스 관련 assertion을 수정하고, 구름 하단
이탈 케이스가 포함되는지 확인하는 신규 테스트(`test_below_cloud_bottom_is_still_included`)를
추가 - `python -m unittest test_pattern_detect` 27건 전부 통과. 이 함수는 GAS엔 대응
구현이 없어(원래 4종만 GAS에 있었고 이평 상승 초입형은 VM 전용으로 나중에 추가됨) GAS
동기화는 불필요. 단, `scripts/cloud-vm/ma_cloud_breakout.py`(전체이력 백테스트 전용,
운영 미반영)는 원본과 동일한 상수·조건(골든크로스 포함)을 그대로 복제해둔 상태라 이번
변경이 반영 안 돼 있음 - 이 백테스트 도구를 다시 쓸 일이 있으면 같이 갱신할 것.

**2026-08-22 저점상승형(pattern_detect.detect_rising_lows/gas의 detectRisingLows_) 최소
저점 상승폭 하한 추가**: 기업은행 실제 차트를 검토하다가, 박스권 안에서 저점이 0.4%~1%
수준으로 미세하게만 올라간 종목도 저점상승형으로 잡혀 화면에 뜨는 문제가 리포트됨(미원에쓰씨
같은 확실한 V자 반등만 남기고 싶다는 요청). "최근 저점이 직전 저점보다 조금이라도 높으면
통과"였던 조건에 `WEDGE_MIN_LOW_RISE`(5%) 하한을 추가 - 이 값 미만이면 제외한다.
5%로 정한 이유: 기존 회귀 테스트(`test_pattern_detect.py`)에 저점이 7.1%만 오른 "가온칩스"
초기 반등 케이스가 의도적으로 포함(검색 결과에서 누락되면 안 됨, 2026-07-22 결정)돼 있어
8%로 잡으면 이 케이스까지 걸러져 회귀가 발생했다 - 0.4%(박스권 노이즈, 제외 대상)와
7.1%(가온칩스, 유지 대상) 사이인 5%를 하한으로 채택했다. `pattern_detect.py`와
`gas/ticker-proxy.gs`의 `detectRisingLows_`(GAS `?patternScan=1`이 실제 라이브 스캔 소스)
양쪽에 동일하게 반영(두 구현이 항상 일치해야 함). 점수 공식(고정 40/20/20/10/10점)은
그대로 두고 하한을 통과 여부(포함/제외)로만 반영 - 통과한 케이스에서 상승폭 크기에 따라
점수를 더 주는 방식은 시도했다가 "가온칩스"류(하한을 살짝 넘는 약한 케이스도 신뢰도 높게
보여줘야 함) 테스트와 충돌해 되돌렸다. `test/test_pattern_detect.py`의
`test_small_rise_and_short_gap_are_valid`를 `test_rise_below_min_threshold_is_excluded`(0.4%
케이스는 이제 None)와 `test_short_gap_with_sufficient_rise_is_valid`(8%대 상승 유지)로
분리하고 `python -m unittest test_pattern_detect`로 26개 전부 통과 확인. `js/pattern-scan.js`
탭 설명 문구도 "8% 이상" → "5% 이상"으로 갱신. `gas/ticker-proxy.gs`는 GitHub Actions(clasp)가
push 후 자동 배포한다.

**2026-08-22 저점상승형(pattern_detect.detect_rising_lows/gas의 detectRisingLows_) 최소
저점 상승폭 하한 추가**: 기업은행 실제 차트를 검토하다가, 박스권 안에서 저점이 0.4%~1%
수준으로 미세하게만 올라간 종목도 저점상승형으로 잡혀 화면에 뜨는 문제가 리포트됨(미원에쓰씨
같은 확실한 V자 반등만 남기고 싶다는 요청). "최근 저점이 직전 저점보다 조금이라도 높으면
통과"였던 조건에 `WEDGE_MIN_LOW_RISE`(5%) 하한을 추가 - 이 값 미만이면 제외한다.
5%로 정한 이유: 기존 회귀 테스트(`test_pattern_detect.py`)에 저점이 7.1%만 오른 "가온칩스"
초기 반등 케이스가 의도적으로 포함(검색 결과에서 누락되면 안 됨, 2026-07-22 결정)돼 있어
8%로 잡으면 이 케이스까지 걸러져 회귀가 발생했다 - 0.4%(박스권 노이즈, 제외 대상)와
7.1%(가온칩스, 유지 대상) 사이인 5%를 하한으로 채택했다. `pattern_detect.py`와
`gas/ticker-proxy.gs`의 `detectRisingLows_`(GAS `?patternScan=1`이 실제 라이브 스캔 소스)
양쪽에 동일하게 반영(두 구현이 항상 일치해야 함). 점수 공식(고정 40/20/20/10/10점)은
그대로 두고 하한을 통과 여부(포함/제외)로만 반영 - 통과한 케이스에서 상승폭 크기에 따라
점수를 더 주는 방식은 시도했다가 "가온칩스"류(하한을 살짝 넘는 약한 케이스도 신뢰도 높게
보여줘야 함) 테스트와 충돌해 되돌렸다. `test/test_pattern_detect.py`의
`test_small_rise_and_short_gap_are_valid`를 `test_rise_below_min_threshold_is_excluded`(0.4%
케이스는 이제 None)와 `test_short_gap_with_sufficient_rise_is_valid`(8%대 상승 유지)로
분리하고 `python -m unittest test_pattern_detect`로 26개 전부 통과 확인. `js/pattern-scan.js`
탭 설명 문구도 "8% 이상" → "5% 이상"으로 갱신. `gas/ticker-proxy.gs`는 GitHub Actions(clasp)가
push 후 자동 배포한다.

**2026-08-21 저점 상승형(ascending_triangle.py) 판정 기준을 "저항선이 오르지 않아야
함"에서 "간격이 좁혀지기만 하면 됨"으로 확장**: 미원상사(002840) 실제 차트를 놓고 저점
형성 여부를 같이 보다가, 사용자가 "저점 상승형"으로 인정할 3가지 유형을 정확히 못박았다 -
(1) 상단 막혀있고(저항선 평평) 저점 높아지는 거, (2) 둘 다 높아지는 거, (3) 상단
낮아지고 저점 높아지는 거. 기존 코드는 저항선이 "오르지 않아야"(`not_rising`, 평평하거나
하락만) 통과했어서 (2) 케이스가 걸리지 않았다. `not_rising` 조건을 없애고 `rising`(저점
계단식 상승)과 `converging`(저점-고점 간격이 갈수록 좁혀짐) + `decline_ok`(저항선이
하락하는 경우에만 15% 이내로 제한)만 필수 조건으로 남겼다 - 저항선이 저점보다 느리게
올라가도 간격이 좁혀지면 통과하고(케이스2), 저항선이 저점보다 더 빨리 올라 간격이 벌어지는
발산형 채널(막힘 없는 평행/발산 채널)만 여전히 제외된다. `test/test_ascending_triangle.py`에
`rising_converging` 케이스(저항 50씩/저점 100씩 상승, 간격 900→700 좁혀짐) 신규 테스트를
추가하고, 기존 "고점도 오르면 신호 없음" 테스트는 발산형(저항 150씩/저점 100씩 상승, 간격
500→700 벌어짐)이라는 걸 명확히 하는 이름으로 정리했다. `pytest test/ -q` 524 passed(기존
523 + 신규 1). `ascending_triangle_scan.py`의 출력 제목이 예전 "고점 정체·완만한 하락"
문구 그대로 남아있어 새 로직(케이스2 포함)이 반영 안 된 것처럼 보이는 문제를 뒤늦게
발견해 제목을 3케이스 다 반영하도록 고쳤다(PR #344). VM에서 실제로 갱신된 코드로
5일 보유 기준 재스캔한 결과: 전체 3910종목 중 673건 거래, 승률 52.6%, 평균 수익률
+0.33%, 손익비(profit factor) 1.15, 오늘 기준 신규 돌파 0종목 - 이전에 확인했던 다른
패턴들(대부분 마이너스 기대값)보다 나은 소폭 플러스 엣지를 확인했다.

**2026-08-21 글로벌/국내시장지표 실시간 연결 상태를 배지로 개선**: 시장 > 글로벌 시장지표,
국내시장지표 둘 다 WS 연결 상태("실시간"/"지연"/"연결 재시도")가 그냥 맨 텍스트로만
떠서 눈에 안 띈다는 요청. `js/overnight-market.js`의 `setIndicatorStatus()`,
`js/domestic-market-indicators.js`의 `setLiveStatus()`가 텍스트뿐 아니라 상태별
`data-state`(live/stale/retry) 속성도 같이 설정하도록 고치고, `css/overnight-market.css`
/`css/domestic-market-indicators.css`에 점(dot) + 색깔 배지 스타일을 추가했다(실시간=초록
+ 살짝 깜빡임, 지연=주황, 연결 재시도=회색). `domestic-market-indicators.js`의
`.dmi-live-status`는 이미 `.dmi-heading`(flex)의 형제 span이라 CSS만 추가했다.
`overnight-market.js`의 `.om-live-status`는 처음엔 헤딩이 없어 텍스트를 `<span>`으로
한번 더 감싸고 CSS를 `.om-live-status [data-om-connection]`(자손 선택자)로 걸었는데,
배포 직후 라이브에서 국내는 배지가 뜨고 글로벌만 맨 텍스트로 남는 문제가 확인됐다(JS·CSS
캐시 갱신 시점이 어긋나면 이 자손 선택자가 통째로 매치 실패하는 구조적 결합 문제로 판단) -
JS 구조 변경을 되돌리고(`data-om-connection`을 다시 div에 직접), CSS도
`.om-live-status`에 `display:table; margin-left:auto`로 직접 스타일을 걸어 dmi와
동일하게 JS 구조에 의존하지 않는 형태로 고쳤다. `test/overnight-market.html`에
Playwright로 라이트/다크/모바일(375px) 렌더링과 실시간/지연/연결 재시도 3개 상태를
스크린샷으로 확인했다. `pytest test/ -q` 523 passed, `node --check`로 두 JS 파일 문법
검사 통과. `js/`, `css/`는 master 반영 후 GitHub Pages
자동 배포.

**2026-08-21 패턴 백테스트 스캔 6종에 `--hold-days` 옵션 추가**: `ascending_triangle_scan.py`
/`box_range_scan.py`/`double_bottom_scan.py`/`inv_head_shoulders_v2_scan.py`
/`opening_gap_scan.py`/`pullback_patterns_scan.py`(고정 보유일 방식 백테스트 스크립트
6개, `ma_cloud_breakout_scan.py`는 손절+타임컷 방식이라 개념이 달라 제외)에
`--hold-days=N` 커맨드라인 옵션을 추가했다. 기존엔 보유일(기본 5일)을 바꾸려면 각
스크립트의 `BACKTEST_HOLD_DAYS` 상수를 코드에서 직접 고쳐야 했음. 사용자가 단타보다
2주 보유 관점 위주라 10거래일 기준으로 재검증하고 싶어해서, 값을 안 주면 기존 기본값
그대로 동작하고 `--hold-days=10`처럼 주면 그 값으로 백테스트하도록 만들었다. 화면
표시나 daily_scan_cache.json 저장 로직은 건드리지 않음(이 스크립트들은 원래도 수동
분석용 별도 산출물 파일에만 쓴다). 검증: `py_compile` 6개 전부 통과, `pytest test/ -q`
523 passed. VM에서 `--hold-days=10`(10거래일 보유)으로 6개 스크립트 재실행 진행 중(전종목
3910개 기준, nohup 백그라운드) - 실행 전 VM의 `~/kiwoom-api` 최상단 스크립트 사본이
`git pull`만으로는 안 갱신됨을 확인(이 디렉토리는 스파스 체크아웃이라 `git pull`은
`scripts/cloud-vm/` 하위 추적 경로만 갱신하고, 실제 실행되는 최상단 평평한 사본은
`deploy_check.sh`의 자동 배포가 돌기 전에 수동으로 재실행하면 `cp scripts/cloud-vm/*.py .`를
직접 해줘야 함 - 자동 배포 스크립트 자체의 문제는 아니고, 자동 배포 주기 전에 수동으로 먼저
돌리려 할 때 생기는 함정). 5일 대 10일 보유 비교 결과는 스캔 완료 후 추가 예정.

**2026-08-21 코드베이스 전수 감사 - CSS 7건 수정(전수 감사 7개 영역 전부 완료)**: 전수 감사
마지막 영역인 CSS 11건 중 7건 수정, 4건은 근거를 남기고 의도적으로 보류(아래 참고). 이걸로
2026-08-21에 시작한 코드베이스 전수 감사(논리적 오류 + 속도, 7개 영역) 전부 완료.

- `watchlist.css`/`dashboard-enhancements.css`: skin.html이 모든 페이지에서 이미 `<link>`로
  로드 중인 MaruBuri/Pretendard 폰트를 매 페이지 별도 `@import`하던 걸 제거(렌더링 블로킹
  요청 감소).
- `foreign-flow.js`/`foreign-flow.css`: 호출되지 않는 매물대 시각화 3세대(타워/일러스트/
  라인아트 - `buildAptChartHtmlLegacy`/`buildAptLineArtHtmlLegacy`/
  `buildAptIllustratedLineArtHtml` + 이들만 쓰던 헬퍼·`buildAptZoomButtons`)를 JS에서
  제거하고, 다른 어떤 살아있는 코드도 참조하지 않는 CSS 클래스 172개 + keyframes 23개를
  함께 삭제(파일 149KB→약 96KB, foreign-flow.js 570줄 감소). 실제로 살아있는 클래스인지는
  파일 전체(3개 지운 함수 구간 제외)에서 클래스명이 다시 등장하는지 스크립트로 교차검증했다.
- `skin.html`/`css/market-ribbon.css`/`js/market-ribbon.js`: 2026-07-16에 이미 기능 폐기되고
  `display:none !important`로만 숨겨져 있던 리본을 완전히 걷어냈다(`<link>`·빈 `<div>`·
  `<script>`·인라인 숨김 `<style>` 전부 제거, CSS/JS 파일 삭제, `test/market-ribbon.html`도
  같이 삭제). style.css의 navbar/sidebar 오프셋은 2026-07-16에 이미 리본 없는 값으로
  고정돼 있어 영향 없음. **skin.html은 Tistory 관리자에서 수동 반영 필요** - 반영 전까지는
  라이브 사이트가 삭제된 market-ribbon.css/js를 요청해 404가 뜰 수 있으나(콘솔에만 보임),
  두 파일 다 이미 아무 시각적 역할이 없어(인라인 스타일이 항상 숨겨왔음) 화면 깨짐은 없다.
- `strategy-search.css`: `.ss-tab`/`.ss-product-tab`이 3세대(알약형→밑줄형→다시 알약형+
  `!important`, 라이트+다크모드 각각)에 걸쳐 재정의되며 앞 세대가 지워지지 않고 있던 걸
  최종 세대만 남기고 정리.
- `domestic-market-indicators.css`: `.dmi-fund-card *`(모든 자손) 유니버설 선택자가
  `.dmi-fund-value.dmi-positive/.dmi-negative`의 상승/하락 색을 가리고 있던 근본 원인을
  제거(2026-08-14엔 그 두 규칙에 `!important`를 얹어 임시 대응했었음). `.dmi-fund-card`
  자손들은 전부 이름 붙은 클래스가 이미 `color:#000`을 명시하고 있어 검은색 유지에는 영향 없음.
- `dashboard-enhancements.css`: `#market-temp .mt-guide-card`류가 "화려한" 초안과
  "차분한" 재디자인 두 세대로 나뉘어 있어 뒤 세대가 항상 이기는데, 뒤 세대가 손대지
  않은 구조 속성(position/overflow/transition 등)은 앞 세대에만 있어 단순 삭제 대신
  최종 값 하나로 합쳤다(계산된 스타일 동일, 다운로드 바이트만 감소).
- `quick-indices.css`: 30초 무한 `transform` 애니메이션(`.qi-news-track` 뉴스 스크롤)에
  `will-change: transform` 추가.

**보류(근거 남김, 4건)**: (1) market-temp.css의 게이지 마커/진행바 `left`/`width` 스윕 -
JS 주석에 "JS/rAF와 무관하게 항상 최종적으로 올바른 값"이 되도록 의도적으로 설계된
구조라 `transform` 기반으로 바꾸면 그 보장이 깨질 위험, 게다가 0.6~0.8초 1회성
애니메이션이라 실제 체감 비용이 낮음. (2) marketcap-bubble.css `.mcb-cell`의 SVG
x/y/width/height 트랜지션 - `transform` 전환에는 `<g transform>` 래핑이 필요해 JS의
SVG 생성 로직까지 같이 바꿔야 하는 더 큰 리팩터. (3) z-index 값 CSS 변수화 - 8개 넘는
파일에 흩어져 있어 상대 순서를 하나라도 잘못 옮기면 지금은 없는 겹침 버그를 새로 만들
위험. (4) sector-dashboard-v3.css/market-temp.css 중복 - 확인해보니 `sector-dashboard-
v3.css`가 skin.html이나 어떤 JS의 동적 로드 경로에서도 안 잡혀서(테스트용 로컬 HTML
`test/sector-dashboard-v4.html`에서만 참조) 실제 운영에서 어떻게 로드되는지부터 다시
확인해야 안전하게 합칠 수 있음. 모바일 브레이크포인트 통일(원래 감사에서 "하" 등급·낮은
확신도로 표시된 5번째 항목)도 시각 검증 없이는 위험해 계속 보류.

검증: `node --check`로 JS 문법 확인, CSS 중괄호 짝 맞음 확인, 전체 회귀 523건 통과
(스킨 로고 텍스트 관련 1건, `.dmi-fund-card *` 관련 1건 테스트를 실제 수정 내용에 맞게
갱신). `master` 반영 후 GitHub Pages 자동 배포(`css/`, `js/`) - `skin.html`만 수동 반영 필요.

**2026-08-21 코드베이스 전수 감사 - 프론트엔드 나머지 위젯 JS 6건 수정**: 전수 감사 7개
영역 중 "프론트엔드 나머지 위젯 JS" 영역 7건 중 6건 수정(사이트 로고 텍스트 건은 사용자가
의도한 것으로 확인되어 제외).

- `stock-news.js` 종목 클릭(`selectStock`): 뉴스 응답 경로에 요청 순서 가드가 없어
  A→B 연속 클릭 시 A의 늦은 응답이 B의 뉴스 패널을 덮어쓸 수 있었음 - 같은 파일의
  `loadAnalysis`와 동일한 `requestCode` 가드 추가.
- `pension-fund.js`/`short-pressure.js` 검색: 연속 검색 시 이전(느린, FETCH_TIMEOUT_MS
  20초) 검색 응답이 최신 결과를 덮어쓸 수 있었음 - `searchRequestSeq` 가드 추가.
- `sidebar-rank.js` "더보기" 모달: `foreign-flow.js`와 동일한 유형 - 닫기 버튼·오버레이
  클릭으로 닫으면 keydown 리스너가 안 지워지던 누수 수정.
- `dashboard-enhancements.js`: `document.body` 전체를 감시하는 MutationObserver가
  DOM 변경마다(실시간 위젯이 자주 innerHTML을 갈아끼움) 무거운 5중 querySelectorAll을
  반복 실행했음 - `requestAnimationFrame`으로 프레임당 최대 1회 `scan()`으로 코얼레싱.
- `stock-search-panel.js` 자동완성 화살표 키 이동: 활성 인덱스만 바꾸면 되는데 매번
  `renderMatches`를 재호출해 로컬 별칭에 안 걸리는 검색어는 화살표 이동마다 원격 API를
  재호출했음 - 이미 그려진 목록의 활성 표시만 갱신하도록 분리.
- `stock-discussion.js` 자동완성 항목: 종목명·코드가 이스케이프 없이 innerHTML에
  삽입되고 있었음(로컬 목록은 안전하지만 `/us-search` 응답 경로도 같은 함수를 거침) -
  다른 위젯과 동일하게 `escapeHtml` 추가.

검증: `node --check`로 7개 파일 문법 확인, 관련 Python 회귀 523건 통과(영향 없음 확인).
`master` 반영 후 GitHub Pages 자동 배포.

**2026-08-21 코드베이스 전수 감사 - 프론트엔드 대형 위젯 JS 6건 수정**: 전수 감사 7개
영역 중 "프론트엔드 대형 위젯 JS"(foreign-flow.js·kospi-futures.js·skin-main.js) 영역
6건 전부 수정.

- `foreign-flow.js` 종목 검색(`search()`): 요청 순서 가드가 없어 A종목 검색 직후 B종목을
  검색하면 A의 느린 응답이 나중에 도착해 B의 결과를 덮어쓸 수 있었다 - `loadSignalSummary`와
  동일한 `requestId`/`searchRequestSeq` 가드 추가.
- `kospi-futures.js` 30초 자동 새로고침, `foreign-flow.js` 종목 상세 시세 폴링(15초):
  둘 다 백그라운드 탭에서도 계속 돌고 있었음 - 다른 실시간 위젯과 동일하게
  `document.hidden` 가드 추가.
- `foreign-flow.js` 업종/테마 관련종목 모달: Esc로 닫을 때만 keydown 리스너가 해제되고
  닫기 버튼·오버레이 클릭으로 닫으면 안 지워져 반복해서 열 때마다 리스너가 쌓였음 -
  `closeRelatedModal()`이 경로와 무관하게 항상 해제하도록 참조를 모듈 스코프로 이동.
- `foreign-flow.js` 수급 차트 호버: mousemove마다 `getBoundingClientRect()`를 2번씩
  강제로 읽어 매번 동기 리플로우가 발생했음 - 호버 시작 시점에 한 번만 캐시하고,
  `requestAnimationFrame`으로 좌표 갱신을 프레임당 최대 1회로 코얼레싱.
- `skin-main.js` 장 전환 카운트다운(1초 타이머): 다른 60초 타이머는 이미 있던
  `document.hidden` 가드가 이것만 빠져 있었음 - 추가하고, 탭이 다시 보이면 즉시
  최신 상태로 갱신되도록 `visibilitychange`에서도 한 번 더 tick() 호출.

검증: `node --check`로 6개 파일 문법 확인, 관련 Python 회귀 523건 통과(영향 없음 확인).
`master` 반영 후 GitHub Pages 자동 배포.

**2026-08-21 코드베이스 전수 감사 - GAS 프록시 4건 수정**: 전수 감사 7개 영역 중
"GAS 프록시"(`gas/ticker-proxy.gs`) 영역 4건 전부 수정.

- `getMarketRibbon()`(코스피/코스닥/환율/BTC, 모든 페이지 최상단): 캐시 TTL이 08:00/20:00
  (NXT 프리·애프터마켓) 경계만 알고 09:00 정규장 개장 경계를 몰라, 08:59에 캐싱되면
  09:29까지 장전 값이 그대로 나가는 문제 - `capTtlToSessionBoundary_`가 09:00/15:40
  경계도 함께 캡핑하도록 확장(시세 캐시·시총버블에 이미 적용된 수정과 동일한 유형).
- `getShortPressure()`: 컬럼 매핑이 "실제 미확인, 추정"이라고 스스로 주석에 적어둔 채
  공매도 압박 점수를 인증 없이 공개 응답하고 있었음(CLAUDE.md "미검증 API 필드를 확정값
  처럼 쓰지 않는다" 규칙 위반) - 실제 컬럼 순서를 라이브 검증할 수단이 없어 데이터는
  그대로 두되, `columnMappingVerified: false` 플래그와 사용자 노출 안내문을 추가해
  미검증 상태를 명시했다. `?debugShortNaver=1`로 실측 검증되면 되돌릴 것.
- `getMarketTemp()`: 섹터 풀 전체(~238종목, `getMarketcapBubble()`과 동일 크기)를
  `fetchFromNaver()`(순차 for 루프)로 조회하던 걸, 필드 구성(volume 포함)을 유지한 채
  `fetchQuotesWithCap()`과 같은 `fetchAll` 병렬 패턴의 신규 `fetchFromNaverParallel_()`로
  교체(기존 `fetchFromNaver()`의 다른 호출부는 그대로 둠).
- `getPatternChart()`: `getFlowChart()`와 달리 VM 우선 조회·캐싱 없이 매번 50페이지
  네이버 크롤링을 하던 걸, VM `/ohlc` 우선 조회 + 폴백 + 30분 캐싱(신규
  `fetchDailyOhlcForPatternChart_`, scanDate에 따라 달라지는 패턴 판정 자체는 캐싱
  대상에서 제외)으로 교체.

검증: `node --check`로 문법 확인(GAS는 pytest 대상 아님), 관련 Python 회귀 523건 통과
(영향 없음 확인). `master` 반영 후 GitHub Actions(clasp) 자동 배포 - Secrets 없으면
GAS 편집기에서 수동 배포 필요.

**2026-08-21 코드베이스 전수 감사 - 뉴스/펀더멘털/데이터 수집 4건 수정**: 전수 감사 7개
영역 중 "뉴스·펀더멘털·외부데이터 수집" 영역 4건 전부 수정.

- `domestic_news.py`: 주간 뉴스 백필 분기가 초기화 안 된 `oldest` 변수를 참조+대입해
  이 분기가 실행될 때마다(주간 커버리지 4일 미만일 때, 자주 발생) `UnboundLocalError`를
  던지고 있었다 - 호출부 try/except가 조용히 삼켜 그 주 뉴스 아카이브 전체가 빈 결과로
  대체됨. 사용처 없는 변수라 그냥 삭제.
- `news_momentum_scan.py`: `--full` 배치가 커서/예산은 KST로 계산하면서 정작 뉴스
  수집·이슈 추출·커버리지 저장 기준(`today`)은 `date.today()`(시스템 로컬=UTC)를 따로
  써서, KST 00:00~09:00 구간(UTC 날짜가 KST보다 하루 뒤처짐)엔 90일 백필 컷오프가 하루
  밀려 저장됐다 - `today`도 이미 계산해둔 `today_kst`를 쓰도록 통일.
- `db_schema.py`/`migrate_fundamentals.py`: DART 배당 데이터(`fetch_stock()`의
  `dividend` 키)가 SQLite `fundamentals` 테이블에 컬럼 자체가 없어 이관 과정에서
  통째로 누락되던 걸 `dividend_json` 컬럼 추가 + 이관 INSERT에 포함해 고침(현재 이
  테이블을 읽는 서비스 코드가 없어 운영 화면 영향은 없음 - 향후 잠재 버그 예방).
- `bond_yield.py`: `fetch_history()`가 최대 58페이지를 쉬는 시간 없이 순차 크롤링하던
  걸 페이지 사이 0.2초 쓰로틀 추가.

검증: 신규 테스트 4건(`test_domestic_news_weekly_backfill.py`, `test_news_momentum.py`
1건 추가, `test_migrate_fundamentals.py`, `test_bond_yield.py`) 포함 전체 회귀 523건 통과.
`master` 반영 후 VM 자동 배포.

**2026-08-21 코드베이스 전수 감사 - 패턴/전략 스캔 배치 6건 수정**: 전수 감사(논리적 오류 + 속도)
7개 영역 중 "패턴·전략 스캔 배치" 영역의 7건 중 6건 수정(1건은 하 등급·저시급 판단으로 의도적
보류, 아래 참고).

- `daily_scan_cache.json`을 4개 스크립트(daily_scan.py/rescan_patterns.py/angle_momentum_scan.py/
  gongpasan_scan.py)가 잠금 없이 나눠 쓰던 문제 - `daily_scan.py`가 API 지연으로 예정보다 늦게
  끝나면 먼저 끝난 스크립트가 써둔 angleMomentum/gongpasan 섹션을 통째로 덮어쓸 수 있었다.
  신규 `scripts/cloud-vm/daily_scan_cache.py`(파일 잠금 fcntl.flock + tmp파일·os.replace 원자적
  쓰기)로 4개 스크립트를 전부 통일하고, daily_scan.py/rescan_patterns.py도 patternScan.patterns를
  통째로 교체하지 않고 자기 소관 키만 update()하도록 고쳤다.
- `swing_model.py`의 `_moving_average`가 인덱스마다 윈도우를 새로 슬라이싱+합산하던
  O(n·period) 구현이었던 걸 슬라이딩 합 O(n)으로 교체(224일선 기준 최대 224배 비용 절감,
  daily_scan.py가 거의 전종목에 매일 호출).
- `strategy_scan.py`의 scan/scan_dividend/scan_etf_returns/scan_nps_holdings 4개가 같은
  universe의 daily_prices를 각자 독립 조회하던 걸 main()에서 한 번만 로드해 공유하는
  캐시(`daily_cache`)로 교체.
- `monitor_swing_recommendations.py`가 t20_return까지 이미 확정된(다시 안 변하는) 오래된
  스냅샷까지 매일 무제한 누적 테이블 전체를 재처리하던 걸 `t20_return IS NULL` 조건으로 좁히고,
  같은 실행 안에서 code별 가격 이력 중복 로드도 캐시로 제거.
- `ma_cloud_breakout.py`/`pullback_patterns.py`가 pandas rolling().mean()/numpy .mean()을
  써서, pattern_detect.py가 이미 회귀 테스트로 피했던(부동소수점 합산 순서 차이로 골든크로스·
  거래량 증감 비교가 뒤집히는) 문제를 재도입한 걸 pattern_detect.py와 동일한 누적합(sum())
  방식으로 교체.
- (보류) `_scan.py` 다수가 종목별로 개별 SQLite 조회하는 관행 - 감사에서 "하" 등급·"당장
  시급도는 낮음"으로 명시됐고, 고치려면 ~10개 독립 스캔 스크립트와 대응 테스트를 전부
  건드려야 해서 위험 대비 이득이 낮다고 판단해 이번엔 보류.

검증: 신규 테스트 6건(`test_daily_scan_cache.py` 4건, `test_monitor_swing_recommendations.py`
2건) 포함 전체 회귀 519건 통과(기존 시그니처 문자열을 검사하던 `test_ui_ia.py` 1건도 새
파라미터에 맞춰 갱신). `master` 반영 후 VM 자동 배포.

**2026-08-21 쌍바닥 스캔 스크립트 누락 보완**: VM에서 신규 패턴 백테스트 7종을 순서대로 돌리던 중 `double_bottom_scan.py`가 애초에 만들어지지 않았던 걸 발견(PR #326에서 `double_bottom.py`만 추가되고 스캔 스크립트가 빠짐). 다른 패턴들(`opening_gap_scan.py` 등)과 동일한 템플릿으로 `scripts/cloud-vm/double_bottom_scan.py`를 추가했다 - 전종목 SQLite 스캔 후 `double_bottom_backtest.json`에 저장, daily_scan_cache.json은 건드리지 않음. VM에서 `venv/bin/python double_bottom_scan.py` 수동 실행 필요.

**2026-08-21 시초 갭상승 백테스트 도구 추가 - 8개 패턴 저점부터 하나씩 검토 완료(수동 실행 전용, 운영 미반영)**: "저점부터 하나씩 코드 좀 줘봐"로 시작된 차트검색 패턴 8종 코드 리뷰의 마지막 항목. 시초 갭상승(`pattern_detect.detect_opening_gap`)은 하루짜리 스냅샷 조건(전일 종가 대비 시가 갭 B + 장중 추가상승 K + 시가 범위 G + 거래대금 범위 L)이라 스윙점이나 여러 날짜 구조가 없어 다른 패턴들과 달리 벡터화가 단순했다 - `scripts/cloud-vm/opening_gap.py`(신규)가 원본 조건 4개를 그대로 pandas 비교식으로 옮겼고, 원본과 완전히 동일한 결과(갭율·장중등락률·거래대금 소수점까지 일치)를 내는 걸 확인했다.

이걸로 저점상승형(pandas 전환)·이평 상승 초입형(구름 손절 백테스트)·쌍바닥·역헤드앤숄더(재설계)·박스권·눌림목 2종(우량주/급등주)·시초 갭상승, 그리고 사용자가 새로 요청한 상승/수렴삼각형까지 - 기존 6종 전부와 신규 패턴 각각에 전체이력 신호+백테스트 도구가 갖춰졌다(각도기 타점·공파산 타점은 이전 세션에 이미 백테스트 보유). 전부 daily_scan_cache.json을 건드리지 않는 별도 분석 산출물이라 운영 화면에는 영향이 없다.

검증: `test/test_opening_gap.py`(신규) 8건(원본 스냅샷 판정과 소수점까지 동일한 결과, 갭 없음/장중상승 미달/거래대금 범위 밖 음성대조군, 첫날은 전일 종가가 없어 신호 불가) 포함 전체 회귀 513건 통과. VM에서 `venv/bin/python opening_gap_scan.py` 수동 실행 필요.

**2026-08-21 역헤드앤숄더 재설계 백테스트 도구 추가(수동 실행 전용, 운영 미반영)**: 역헤드앤숄더 코드 리뷰 중 사용자가 레퍼런스 이미지 3장을 제시했는데, 기존 코드(`pattern_detect.detect_inv_head_shoulders` - 어깨-머리-어깨 가격 대칭성 + 넥라인 돌파 + "우어깨 이후 거래량 급증")와 방향이 다른 정의였다 - 레퍼런스는 "하락 추세를 뚫은 고점이 이전 고점보다 높아지는 형태"(대칭성이 아니라 하락 추세선 돌파)와 "눌림목에서 거래량이 많이 죽었을 때"(급증이 아니라 감소) 들어가는 게 포인트라고 설명한다. 거래량 조건이 기존 코드와 정반대라는 걸 짚어 확인 후, 대칭성 조건 없이 재설계하기로 했다.

`scripts/cloud-vm/inv_head_shoulders_v2.py`(신규, 기존 pattern_detect.py 코드는 그대로 두고 별도 모듈로 추가)는 (1) 순차적으로 낮아지는 고점 3개 이상으로 "하락 추세선"을 확인하고, (2) 그 뒤 고가가 마지막(가장 낮은) 고점을 2% 넘게 뚫으면 "추세선 돌파"로 관심 등록, (3) 그 뒤 10거래일 안에 처음으로 (전일 대비 하락 + 거래량이 돌파일의 60% 미만으로 죽은) 날을 진짜 진입 시점(entry_signal)으로 잡는다. ascending_triangle.py와 동일한 look-ahead 방지·돌파 후 스윙점 재사용 방지 구조를 그대로 따랐다.

검증: `test/test_inv_head_shoulders_v2.py`(신규) 7건(눌림목 진입이 정확히 1번만 뜨는지, 고점이 순차 하락하지 않으면/눌림목 거래량이 안 죽으면 신호 없는지, look-ahead 방지) 포함 전체 회귀 505건 통과. 운영 서비스에 연결되지 않은 분석 전용 도구 - VM에서 `venv/bin/python inv_head_shoulders_v2_scan.py` 수동 실행 필요.

**2026-08-21 눌림목 2종(우량주/급등주) 백테스트 도구 추가(수동 실행 전용, 운영 미반영)**: "눌림목 3가지"(우량주/추세/급등주) 레퍼런스를 받고 사용자가 "우량주 + 급등주 둘 다"를 골랐다. `scripts/cloud-vm/pullback_patterns.py`(신규) - 우량주 눌림목(`compute_bluechip_pullback_signal`)은 `pattern_detect.detect_pullback`을 그대로 전체 이력에 걸쳐 매일 재판정하는 버전(원본과 동일 상수·조건). 원본 코드를 재검토하며 "최근 25일 안에서 고점→그 이전 저점을 찾는" 부분이 실제로는 260일 전체 창과 무관하게 항상 고정폭 25일 윈도우라는 걸 확인해(recent_start 계산식이 결국 그렇게 귀결됨) 매일 반복 계산을 단순화했다. 급등주 눌림목(`compute_surge_pullback_signal`)은 새로 설계했다 - 훨씬 짧은 구간(10거래일)에 훨씬 큰 상승폭(30%+)이 나야 "급등"으로 보고, 우량주와 달리 장기 이평선(20/240일) 근접·상승 조건은 요구하지 않는다(모멘텀 성격이라 평균회귀 기준이 덜 맞는다고 보고 뺐다 - 대신 상승구간 거래량 증가는 유지). 합성 데이터로 확인하는 과정에서 조정(눌림)이 며칠에 걸쳐 천천히 오면 저점 탐색 창이 이미 진짜 급등 시작점을 지나쳐버려 상승폭이 실제보다 작게 측정되는 걸 발견해, 급등 후 조정은 "며칠 안에 빠르게" 오는 경우를 전제로 한다는 걸 코드 주석에 명시했다.

검증: `test/test_pullback_patterns.py`(신규) 10건(우량주는 원본 스냅샷 판정과 동일한 결론을 내는지 직접 대조, 급등주는 상승폭·조정폭이 기준 미달이면 신호 없는지) 포함 전체 회귀 498건 통과. 운영 서비스에 연결되지 않은 분석 전용 도구 - VM에서 `venv/bin/python pullback_patterns_scan.py` 수동 실행 필요.

**2026-08-21 박스권 백테스트 도구 추가(수동 실행 전용, 운영 미반영)**: 박스권 손그림(노란 박스 안에서 고점 3번·저점 3번 왕복 후 돌파)에 사용자가 "박스권은 뭐 평범해... 너의 생각이 더 중요해"로 설계를 맡겼다. `scripts/cloud-vm/box_range.py`(신규)는 ascending_triangle.py와 같은 뼈대(스윙 탐지, look-ahead 방지, 돌파 후 스윙점 재사용 방지)를 쓰되, 상승삼각형과 달리 저점이 "계단식으로 높아질" 필요 없이 저항선·지지선 둘 다 평평한 밴드(BAND_TOL_PCT 3%) 안에만 있으면 되고(폭이 좁아지는 수렴 조건도 없음), 두 밴드가 서로 겹치지 않아야(지지선 최댓값 < 저항선 최솟값) "진짜 박스"로 인정한다. entry_signal은 저항선을 2% 넘게 뚫는 첫 날.

검증: `test/test_box_range.py`(신규) 8건(돌파 캔들에서 정확히 1번만 신호, 저항선이 계속 오르면/지지선이 계속 내려가면 신호 없음, look-ahead 방지, 백테스트 net_return 계산) 포함 전체 회귀 488건 통과. 운영 서비스에 연결되지 않은 분석 전용 도구 - VM에서 `venv/bin/python box_range_scan.py` 수동 실행 필요.

**2026-08-21 쌍바닥 백테스트 도구 추가(수동 실행 전용, 운영 미반영)**: 쌍바닥(`pattern_detect.detect_double_bottom`) 코드를 리뷰하며 손그림으로 "박스권 아니냐"고 되물었으나, 사용자가 레퍼런스 이미지 3장(전형적인 W형 쌍바닥 - 낙폭 지속 중 비슷한 구간에 저점 2개, 첫 저점을 깨지 않고 재반등, "넥라인을 뚫어야 진짜 W")을 제시해 기존 코드 정의가 이미 정확함을 확인했다. `scripts/cloud-vm/double_bottom.py`(신규)는 accumulation_angle.py/ascending_triangle.py와 같은 스타일로 만들었다 - 구조 조건(저점 간격 10~45일, 두 저점 가격차 3% 이내, 2번째 저점 거래량 감소, 넥라인까지 반등폭 8%+)은 원본과 동일한 값을 재사용하고, entry_signal은 "넥라인 돌파 확정 순간"(원본의 "최근 캔들 양봉" 등 스냅샷 전용 확인 조건은 돌파일 자체가 사실상 내포한다고 보고 생략 - 완전히 동일한 조건은 아님을 문서화)으로 잡았다.

개발 중 실제 버그를 하나 더 잡았다 - 테스트 합성 데이터의 평평한 기준선이 스윙 저점 동률(tie)을 대량으로 만들어, 두 개의 기준선 저점이 우연히 진짜 넥라인 돌기를 사이에 끼면서 가짜 쌍바닥으로 오판되는 문제(2번째 저점 가격차 5%로 벌려도 신호가 계속 뜸)를 음성 대조군 테스트로 발견했다 - 기준선에 미세한 단조 증가(하루 0.5)를 줘서 동률을 없애 해결했다(코드 버그가 아니라 테스트 픽스처 버그였음).

검증: `test/test_double_bottom.py`(신규) 8건(넥라인 돌파 시 정확히 1번만 신호, 2번째 저점이 3% 밴드를 벗어나면 거부, 돌파 없이 넥라인 근처까지만 오면 신호 없음, look-ahead 방지, 백테스트 net_return 계산) 포함 전체 회귀 480건 통과. 운영 서비스에 연결되지 않은 분석 전용 도구.

**2026-08-21 상승삼각형 저항선 판정을 "평평함" → "오르지 않고 좁혀짐"으로 완화**: 상승삼각형 손그림을 확인받은 뒤 사용자가 두 번째 그림(저항선이 완전히 평평하지 않고 완만하게 하락하면서 저점 추세선과 서로 좁혀 들어가는 수렴형)을 보여주며 "자로 잴 필요 없어 이런 것도 포함이야 - 눈으로 봤을 때 흐름을 만들어 간다고 할까"로 조건을 넓혀달라고 했다("넓혀"로 확인). `ascending_triangle.py`의 저항 판정을 `RESISTANCE_FLAT_TOL_PCT`(고점들끼리 2.5% 이내로 몰려있어야 함, 딱딱한 밴드)에서 세 조건으로 바꿨다 - (1) 고점이 오르지 않음(평평하거나 완만히 하락, `not_rising`), (2) 하락폭이 `RESISTANCE_MAX_DECLINE_PCT`(15%, 느슨한 안전판) 이내, (3) 최근 저점-고점 간격이 초반보다 좁혀지고 있음(`converging`) - 상승삼각형(평평한 저항)과 수렴삼각형(완만히 하락하는 저항)을 하나의 조건으로 함께 잡는다. 저항선 기준값도 고점 평균에서 가장 최근 저항 터치값으로 바꿨다(하락형에서 평균을 쓰면 이미 낮아진 실제 저항보다 높게 잡혀 돌파 기준이 부정확해짐).

검증: `test/test_ascending_triangle.py`에 완만히 하락하는 저항선 케이스(신호가 정확히 1번 뜨고 저항값이 가장 최근 터치와 일치하는지) 1건을 추가해 총 9건, 기존 8건(수평 저항·저점 미상승 음성대조·평행채널 음성대조·look-ahead 방지 등)도 새 조건에서 여전히 통과하는지 재확인했다. 전체 회귀 472건 통과. 운영 서비스에 연결되지 않은 분석 전용 도구라 배포돼도 기존 서비스 동작에 영향 없음.

**2026-08-21 이평 상승 초입형 구름 하단 손절 백테스트 도구 추가(수동 실행 전용, 운영 미반영)**: 이평 상승 초입형(`pattern_detect.detect_ma_cloud_breakout`) 코드를 같이 보면서 "필터를 더 붙이면 뭐가 좋을까"라는 질문에 거래량 확인·구름 색(양운/음운) 구분·반복 실패 배제를 제안했으나, 사용자가 "224선/구름은 그냥 기준선(근처에 오는 것 자체가 거래량 없인 불가능), 구름 색 구분 안 함, 반복 실패는 신호를 거를 이유가 아니라 청산 규칙 문제 - 구름 아래로 이탈하면 손절, 위에 있으면 계속 보유"로 정정했다. 진입 조건에 필터를 추가하는 대신, 이 신호에 맞는 청산 규칙(구름 하단 손절) 백테스트가 아예 없었다는 걸 확인하고 그것부터 만들었다.

`scripts/cloud-vm/ma_cloud_breakout.py`(신규)는 원래 "오늘 스냅샷"만 판정하던 `detect_ma_cloud_breakout`을 accumulation_angle.py/ascending_triangle.py와 같은 스타일(전체 이력 pandas 신호 계산)로 옮겼다 - 진입 조건 4개(224일선 3% 이내, 종가가 구름 안, 고가가 구름 상단 3% 이내 노크, 최근 5거래일 안 5일선-20일선 골든크로스)는 원본과 동일한 상수·공식을 그대로 재사용했고, 합성 데이터로 원본 스냅샷 판정과 ma224·구름 상단/하단 값이 정확히 일치하는지 대조 확인했다. 청산 규칙은 gongpasan_strategy.py의 손절+타임컷 패턴과 동일하게 - 진입 후 종가가 그날 보이는 구름 하단 아래로 마감하면 손절, 아니면 최대 20거래일(스킬/사용자가 준 숫자 없어 gongpasan_strategy.DEFAULT_TIMECUT_DAYS와 동일하게 임의 설정) 보유 후 강제 청산.

`scripts/cloud-vm/ma_cloud_breakout_scan.py`(신규)가 전종목을 스캔해 승률/평균수익률/손익비를 계산한다 - 이 신호 자체는 이미 pattern_detect.py를 통해 차트검색에 나가고 있지만(오늘 스냅샷만), 이 백테스트는 아직 화면에 붙이기로 확정된 게 아니라 daily_scan_cache.json은 건드리지 않고 별도 산출물에만 저장한다.

검증: `test/test_ma_cloud_breakout.py`(신규) 9건(원본 스냅샷 판정과의 일치, 평평한 데이터에서 신호 없음, 구름 하단 이탈 시 손절 계산, 손절 없이 타임컷까지 보유하는 계산, 신호가 끝자락에 있어 다음날 시가가 없는 경우 제외) 포함 전체 회귀 471건 통과. 무작위 합성 종목 60개(랜덤워크)로는 신호 0건이었는데 - 4개 조건(224일선 근접+구름 안+상단 노크+최근 골든크로스)이 동시에 맞아야 해서 순수 랜덤워크엔 거의 안 나오는 게 정상(다른 패턴들도 동일). 운영 서비스에 연결되지 않은 분석 전용 도구 - VM에서 `venv/bin/python ma_cloud_breakout_scan.py` 수동 실행 필요.

**2026-08-21 상승삼각형(고점 막힘+저점 계단식 상승) 신규 패턴 백테스트 도구 추가(수동 실행 전용, 운영 미반영)**: 저점상승형(`pattern_detect.detect_rising_lows`) 코드를 같이 보다가 "고점이 막혀있는지도 보나?"라는 질문을 받았다 - 실제로 확인해보니 그 함수는 고점 스윙을 찾긴 하지만 저항선 하나(최댓값)를 뽑아 5일선 근접도 점수에만 쓸 뿐, "고점들이 같은 자리에 몰려있는지(막힘)"는 전혀 판정하지 않았다. 사용자가 손그림(계단식 저점 + 수평 저항선 + 저점을 잇는 우상향 추세선 + 저항선을 뚫는 폭발적 상승)으로 원하는 모양을 명확히 보여줘서, 이걸 그대로 구현했다 - 고전적인 "상승삼각형(ascending triangle)" 패턴.

`scripts/cloud-vm/ascending_triangle.py`(신규)는 accumulation_angle.py/gongpasan_strategy.py와 같은 스타일(전체 이력에 걸쳐 pandas로 신호 컬럼 계산 + 백테스트 가능)로 만들었다 - 최근 60거래일(LOOKBACK_WINDOW) 안에서 스윙 저점 3개 이상이 전부 순차적으로 높아지고(계단식), 스윙 고점 3개 이상이 서로 2.5%(RESISTANCE_FLAT_TOL_PCT) 이내로 몰려있으면(막힘) "삼각형 완성"으로 보고, 그 뒤 10거래일 안에 종가가 그 저항선을 2% 넘게 뚫는 첫 날에만 entry_signal이 뜬다. 개발 중 두 가지 실제 버그를 합성 데이터 테스트로 잡았다 - (1) 돌파 이후에도 돌파 전 스윙점들이 룩백 구간에 남아있으면 같은 저항선으로 "새 삼각형"이 곧바로 다시 완성된 걸로 오판해 같은 돌파가 며칠 연속 재신호를 냈다(돌파 이후엔 그 이후 스윙점만 다시 모으도록 수정), (2) 고점 최소 개수를 2개로 뒀더니 고점도 계속 오르는 평행채널(막힘 없음)에서 인접한 2개만 우연히 허용오차 안에 들어와 "막혔다"고 오판했다(3개로 상향). 신호는 look-ahead 편향 없이(각 스윙점은 미래 SWING봉이 실제로 지나야 "확정"된 것으로 취급) 계산된다. 저점/고점 최소 개수·저항 평탄 허용오차·룩백 구간·돌파 확인 폭은 스킬이나 사용자가 준 정확한 숫자가 없어 임의로 정했다(코드 주석에 명시) - 실제 확률(백테스트) 결과를 보고 조정 필요.

`scripts/cloud-vm/ascending_triangle_scan.py`(신규)가 전종목을 스캔해 승률/평균수익률/손익비를 계산한다 - 아직 화면(차트검색)에 붙이기로 확정된 게 아니라 daily_scan_cache.json은 건드리지 않고 별도 산출물(`ascending_triangle_backtest.json`)에만 저장한다.

검증: `test/test_ascending_triangle.py`(신규) 8건(돌파 캔들에서 정확히 1번만 신호가 뜨는지 - 재신호 방지 확인, 저점이 안 오르면/고점이 계속 오르면 신호가 안 뜨는지, look-ahead 편향이 없는지 - 돌파 시점 이후 데이터를 잘라내도 그 전엔 신호가 안 뜨는지, 백테스트 net_return이 accumulation_angle.py와 동일한 진입/청산 공식을 재사용하는지) 포함 전체 회귀 462건 통과. 무작위 합성 종목 60개(300거래일, 랜덤워크)로는 신호가 0건이었는데 - 저점 3개+ 계단식 상승과 고점 3개+ 2.5% 이내 수렴이 동시에 맞아야 하는 구체적인 압축 구조라 순수 랜덤워크엔 거의 안 나오는 게 정상이다(다른 패턴들도 랜덤 데이터엔 거의 안 떴던 것과 같은 이유) - 실제 확률은 VM 실데이터로 확인 필요. 운영 서비스에 연결되지 않은 분석 전용 도구 - VM에서 `venv/bin/python ascending_triangle_scan.py` 수동 실행 필요.

**2026-08-21 각도기 타점 눌림목 대기 진입 비교 도구 추가(수동 실행 전용, 운영 미반영)**: 위 보조지표 민감도 분석 실제 결과(전종목 48,823건)를 같이 해석했다 - 상관계수는 다 약했지만(최대 |r|=0.055), ATR변동성·거래량배율·RSI·ADX·OBV기울기 등 여러 지표가 공통적으로 "값이 가장 극단적인 구간(Q4)에서 승률이 가장 낮다"는 패턴을 보였다(예: ATR변동성 Q4 42.92%·평균수익률 -0.89%, RSI Q4(과매수) 40.85%). 즉 각도기 신호가 뜬 순간 이미 거래량·변동성·RSI가 과열된 상태에서 진입하면 승률이 떨어지는 경향이 있었다.

이 결과를 바탕으로 "복합 지표 필터"를 제안했으나 사용자가 "너무 복잡하다, 매집봉 뜨고 눌림목 왔을 때는 어때? 세력이랑 동반하는 걸 생각하는거야"로 더 단순한 대안을 제시했다 - 방금 발견한 패턴(과열 상태 진입이 안 좋음)과도 맞아떨어지는 아이디어다. 새로 만들지 않고 `gongpasan_strategy.py`가 이미 쓰고 있는 `_pullback_entry_flags`("돌파 이후 첫 지지 캔들만 진입") 로직을 그대로 재사용해 각도기의 entry_signal(매집 신호)에 얹었다 - 지지선은 공파산의 sma20 대신 각도기가 이미 계산해둔 ema_long(20)을 그대로 썼다(각도기는 EMA 기반이라 새 이평선을 추가 계산하지 않음). `scripts/cloud-vm/angle_momentum_pullback_variant_scan.py`(신규)가 전종목을 스캔하며 "즉시 진입(기존 entry_signal)" vs "눌림목 대기 진입(entry_signal 이후 ema_long 첫 지지 캔들)" 두 백테스트를 나란히 돌려 승률·손익비를 직접 비교한다.

검증: `test/test_angle_momentum_pullback_variant.py`(신규) 4건(눌림목 진입 시점이 실제로 첫 지지 캔들로 옮겨지는지, 지지선을 못 만나면 거래가 소멸하는지, 신호 없을 때·빈 데이터 처리) 포함 전체 회귀 454건 통과. 무작위 합성 종목 30개로 파이프라인 전체가 예외 없이 도는 것도 확인했다(다만 랜덤워크 데이터라 가설 자체의 검증은 아니고 코드 정상 동작 확인용). 운영 서비스에 연결되지 않은 분석 전용 도구 - VM에서 `venv/bin/python angle_momentum_pullback_variant_scan.py` 수동 실행 필요.

**2026-08-21 각도기 타점 보조지표 민감도 분석 도구 신설(수동 실행 전용, 운영 미반영)**: "각도기 타점 기준으로, 뭘 더 더하면 승률이 높아지는지 거래량 이평선·보조지표를 하나씩 다 대입해봐" 요청을 받았다. 지표를 하나씩 따로 VM에서 재백테스트하면 지표 수만큼 왕복이 필요해서, `scripts/cloud-vm/indicator_sensitivity.py`(신규)에 후보 보조지표 10종(거래량/20일평균 배율, 거래량 5일선/20일선 비율, RSI(14), MACD 히스토그램(12,26,9), 볼린저 %b(20,2), 스토캐스틱 %K(14), ADX(14), ATR(14)/종가 변동성, 20일선 이격도, OBV 5일 기울기)을 pandas로 계산하는 함수와, `accumulation_angle.entry_signal`이 뜬 날마다 기존 5일 보유 백테스트(net_return)와 그날의 지표값을 함께 기록하는 함수를 만들었다. 전종목을 한 번만 스캔하면서 지표별로 4분위(Q1~Q4)로 나눠 구간별 승률·평균수익률·상관계수를 계산해, "이 지표가 높을 때/낮을 때 승률이 오르는지"를 지표 10개 전부 한 번에 비교할 수 있다.

`scripts/cloud-vm/angle_momentum_indicator_scan.py`(신규, `rescan_patterns.py`와 같은 성격 - 수동 실행 전용, 타이머 없음)가 실제 전종목 스캔을 돌려 `angle_momentum_indicator_sensitivity.json`(신규 산출물, `daily_scan_cache.json`과 분리 - 화면에 표시하는 운영 데이터가 아니라 분석용이라 서빙 캐시를 건드리지 않는다)에 저장하고, 표준출력에 지표별 구간 승률을 사람이 읽기 쉽게 요약해 찍는다. 지표 공식은 표준 정의를 pandas로 재현한 것이라 pandas-ta 등 특정 라이브러리 실제 출력과 대조 검증은 못했고, 지표 10개를 동시에 사후 비교하는 거라 다중검정 문제(우연히 그럴듯해 보이는 지표가 나올 수 있음)가 있다는 점을 스크립트 주석·docstring에 명시했다 - 결과는 "필터 후보를 좁히는" 용도로만 쓰고, 실제 채택 전엔 그 지표만 넣은 백테스트로 한 번 더 확인을 권장.

검증: `test/test_indicator_sensitivity.py`(신규) 10건(지표 계산 값 범위, 신호별 net_return 계산이 기존 `backtest_entry_signal`과 동일한 공식인지, 완전상관 데이터에서 4분위 승률이 단조증가·상관계수가 1에 가까운지, 표본 부족 지표는 건너뛰는지) 포함 전체 회귀 450건 통과. 무작위 합성 종목 30개(400거래일)로 전체 파이프라인(지표 계산→거래 수집→4분위 요약)이 예외 없이 끝까지 도는 것도 별도로 확인했다. 운영 서비스 화면·API·타이머에는 전혀 연결되지 않은 분석 전용 도구라 배포해도 기존 서비스 동작에 영향 없음 - VM에서 `venv/bin/python angle_momentum_indicator_scan.py` 수동 실행 필요.

**2026-08-21 차트검색 조건 구분선을 실선으로 변경**: 각도기 타점/공파산 타점 조건 박스의 공통조건-개별조건 구분선(`.ps-tab-desc-divider`)을 사용자 요청대로 실선으로 바꿨다(전날 점선으로 만들었던 걸 되돌림). `css/pattern-scan.css` 한 줄만 수정, Playwright로 `border-top-style: solid` 렌더링 확인, 전체 회귀 434건 통과.

**2026-08-21 차트검색 나머지 패턴 6종(저점상승형·이평 상승 초입형·쌍바닥·역헤드앤숄더·박스권 하단·눌림목)을 pandas/numpy 기반으로 전환**: "이 지표들도 다 PD로 바꿔" 요청으로 `scripts/cloud-vm/pattern_detect.py`의 나머지 패턴 판정 로직을 pandas/numpy로 옮겼다(각도기 타점·공파산 타점은 이미 pandas 기반). 스윙 저점/고점 탐지(`find_swing_indices`)는 `rolling(window, center=True).min()/.max()`로, `has_bullish_after`·`max_high_between`은 numpy 비교/argmax로, 눌림목의 고점/저점 탐색 루프는 `np.argmax`/`np.argmin`으로, 박스권 하단의 이평선 근접 카운트·수익률 계산은 numpy 불리언 합산으로 벡터화했다. 쌍바닥·역헤드앤숄더의 중첩 조합 탐색 루프(스윙 저점 조합을 뒤에서부터 순회하며 첫 매치를 반환하는 상태 유지형 로직)는 공파산_strategy.py의 선례(지표 계산은 pandas, 신호 판정은 루프 유지)와 같은 원칙으로 그대로 두고, numpy 배열로 데이터만 넘기게 했다.

전환 전 원본 파일을 스냅샷으로 떼어두고, 두 모듈을 나란히 불러 같은 입력에 대해 출력이 완전히 같은지 비교하는 차분 테스트(회귀 확인용 스크립트, 저장소에는 포함하지 않음)를 만들어 (1) 무작위 OHLC 3,536건, (2) 각 패턴을 실제로 성립시키는 표적 합성 데이터 2,100건 + `scan_stock` 전체 파이프라인 560건에서 0건 불일치를 확인했다. 이 과정에서 진짜 버그를 하나 잡았다 - `moving_average`를 `pandas.rolling().mean()`으로, `avg_volume`/`rsi_last`의 초기 평균을 `numpy.mean()`으로 바꿨더니 원본의 좌→우 순차 합산과 부동소수점 결과가 마지막 자리수에서 미세하게 달라졌고, 이평 상승 초입형의 "5일선이 20일선을 정확히 넘어서는 순간"처럼 두 값이 같을 때를 기준으로 삼는 비교에서 그 오차만으로 골든크로스 유무가 뒤집히는 사례가 나왔다. 세 함수 모두 numpy 배열은 쓰되 합산 자체는 원본과 동일한 순서(`sum()`/명시적 루프)로 계산하도록 되돌렸다(주석에 이유 명시) - 값 자체보다 연산 순서를 원본과 맞추는 게 더 중요하다고 판단했다.

기존에 쌍바닥·역헤드앤숄더·눌림목 세 패턴은 `scan_stock`을 거치는 간접 테스트조차 없었다는 것도 이번에 발견해, 위 표적 합성 데이터를 정리해 `test/test_pattern_detect.py`에 실제 단위 테스트 6건(패턴별 탐지+scan_stock 노출 각 1건)을 새로 추가했다.

성능은 종목당 약 0.24ms → 1.51ms로 늘었다(pandas Series 생성 오버헤드, 전종목(3,900개) 스캔 기준 약 1초 → 6초 추정) - 절대값은 여전히 작지만(하루 1회 배치, DB 조회 시간에 비하면 미미) 6배 늘어난 건 사실이라 알려둔다.

검증: `test/test_pattern_detect.py` 신규 6건 포함 전체 회귀 440건 통과, `python3 -m py_compile pattern_detect.py` 통과. `scripts/cloud-vm/`은 `master` 반영 후 VM 자동 배포 대상 - 다음 배치 스캔부터 반영된다.

**2026-08-20(28차) 공파산 타점 백테스트 - 손절 버퍼 추가(승률 개선 시도)**: `kiwoom-gongpasanscan.timer`가 실제로는 한 번도 등록된 적이 없었음을 확인(직전 세션에서 각도기 타점 타이머만 등록하고 공파산 것은 빠뜨렸었다) - 사용자가 VM에서 직접 등록·최초 실행해 실제 백테스트 결과(863건)를 처음으로 얻었다. 결과가 승률 25.03%·손익비 0.87로 낮게 나와 스윙 관점으로 같이 뜯어봤다: 이 손익비(평균 익절 8.91% : 평균 손절 3.42%)면 승률 27.7%만 넘어도 손익분기인데 25.03%는 그 바로 아래 - 완전히 망가진 전략이 아니라 근소한 차이였다.

원인을 구조적으로 짚어보니 entry_signal 자체가 "20일선에 막 지지받은 첫 캔들"에서 진입하는데 손절 기준은 "종가가 20일선 아래로 마감"이라 진입가와 손절가가 거의 붙어있어, 진입 직후 하루만 흔들려도(휩쏘) 바로 손절되기 쉬운 구조였다. `STOP_BUFFER_PCT = 3.0`을 추가해 20일선 대비 3% 이상 진짜로 이탈해야 손절되도록 여유를 줬다(스킬에 명시된 숫자는 아니라 임의로 정함 - 코드 주석에 명시). 실제 승률 개선 여부는 로컬에 시세 DB가 없어 확인 불가 - VM에서 재배포 후 백테스트를 다시 돌려봐야 안다.

검증: `test/test_gongpasan_strategy.py`/`test/test_gongpasan_scan.py`(16건, 트레이드 개수 등 카운트 기반 검증이라 버퍼 값 변경에 영향 없음) 포함 전체 회귀 434건 통과, `node --check js/pattern-scan.js` 통과(백테스트 배너 각주 문구도 "20일선 대비 3% 이상 이탈"로 갱신).

**2026-08-20(27차) 차트검색 조건 박스 통합 + "각도기 타점" 이름 변경 + 공파산 문구에서 기법 용어 삭제**: "각도기 테스트 -> 각도기 타점으로 이름 바꿔"와 함께, 차트검색(pattern-scan) 탭 전체의 조건 안내를 전략검색처럼 "하나의 칸"으로 합쳐달라는 요청을 받았다. 원래 공통 조건(`.ps-common-desc`)과 탭별 조건(`.ps-tab-desc`)이 별도 박스 두 개였는데, 하나의 `.ps-tab-desc` 박스 안에 공통 조건(굵게) - 구분선 - 탭별 조건 순으로 합쳤다. 공통 조건 문구도 실제 `pattern_detect.is_excluded_stock()`가 이미 걸러내고 있었지만 문구에 없던 관리종목·우선주·동전주(1,000원 미만)를 추가해 정확하게 맞췄다(새 필터를 만든 게 아니라 기존 코드에 이미 있던 걸 문구에 반영).

공파산 타점 설명 문구에서 "역매공파(역배열·매집봉·공구리·파란점선)", "오돌이" 같은 특정 단타 기법 고유 용어를 전부 뺐다(사용자: "단타기법이라서 내가 copy 한거 알려지는 걸 원하지 않아 - 풀어서 쓰던지 해"). 조건의 숫자·판정 기준(160일 고점 대비 25%, 40일 횡보, 60일 매집봉, 5봉+5일선 돌파, 20일선 눌림)은 그대로 두고 설명만 용어 없이 풀어썼다(공구리->횡보로만 표기).

검증: Playwright로 실제 렌더링해 병합된 박스(굵은 공통 조건 + 구분선 + 탭별 조건)와 라이트/다크모드를 스크린샷으로 확인, 탭 라벨이 "각도기 타점"으로 바뀐 것 확인. `test/test_ui_ia.py`의 `.ps-common-desc` 존재 확인을 `.ps-tab-desc-divider`로 교체, 전체 회귀 434건 통과, `node --check js/pattern-scan.js` 통과.

**2026-08-20(26차) 국민연금 보유종목 UI 다듬기**: "(연 1회 공시 스냅샷) 지워, 조건 자세히에 표기해, 개수 안내 위로 올려" 3가지 리포트를 받았다. "연 1회 공시 스냅샷" 문구는 요약 줄(`methodologySummary`)에서만 빼고 "조건 자세히"(서버 `NPS_METHODOLOGY_NOTE`)엔 이미 같은 내용이 있어 그대로 유지(둘 다 손볼 필요 없었음). "전체 N종목 중 지분율 X% 이상 M종목" 개수 안내는 원래 `.ss-hint`(빈 상태 안내용, 위아래 28px 패딩) 클래스를 그대로 재사용하고 있어서 필터 셀렉트 밑에 큰 공백이 뜨고 한참 아래로 처져 보였다 - 전용 클래스(`ss-nps-filter-meta`)로 분리해 필터 셀렉트와 같은 줄에 붙였다. 검증: Playwright로 실제 렌더링해 요약 줄에서 문구가 빠지고 개수 안내가 필터와 한 줄에 붙는 것을 스크린샷으로 확인, 전체 회귀 434건 통과.

**2026-08-20(25차) 국민연금 보유종목 - 2025년 말 실데이터로 갱신(fund.nps.or.kr 직접 소싱)**: "지금 26년 8월인데 2025년 데이터는 없어?"라는 질문에 확인해보니, data.go.kr(namespace 3070507)은 실제로 아직 2024-12-31 스냅샷까지만 있었다(infuser.odcloud.kr 스웨거 문서로 직접 확인). 원인은 이 정부 공개 데이터셋 자체가 원본보다 늦게 재배포되기 때문 - 사용자가 국민연금기금운용본부 자체 사이트(fund.nps.or.kr → 운용현황 → 자산군별 현황 → 국내 주식 → 투자종목 → 2025 다운로드)에서 2025년 말 데이터를 직접 받아 전달했다(다운로드 파일 안내문: "전년도 말 기준 자산군별 세부내역은 금년도 3분기에 공시" - 마침 지금(2026년 3분기)이 그 시점이라 data.go.kr보다 원본이 먼저 나온 상태였음).

받은 xlsx(1206종목, 번호/종목명/평가액(억원)/자산군 내 비중/지분율, 전부 소수 형식)를 `public_data.py`가 쓰는 필드명(종목명/평가액(억 원)/자산군 내 비중(퍼센트)/지분율(퍼센트), 퍼센트는 ×100)으로 변환해 `scripts/cloud-vm/nps_holdings_2025.json`으로 커밋했다(공개 데이터라 저장소에 넣어도 무방 - `.gitignore`의 `*_cache.json` 패턴에 안 걸리는 이름 확인). `public_data._fetch_nps_rows()`가 이 파일이 있으면 data.go.kr API 호출 없이 그대로 쓰도록 수정(캐시 로직은 유지, API 폴백 코드는 파일이 없을 때를 위해 그대로 남김). `_NPS_AS_OF`를 2025-12-31로, `_NPS_SOURCE`/`NPS_METHODOLOGY_NOTE`도 fund.nps.or.kr 출처로 갱신.

fund.nps.or.kr을 매번 직접 호출하는 자동화는 이번엔 안 함(사용자 결정: "둘 다 - 일단 지금 파일로 교체하고, 자동화는 나중에") - 다운로드 URL이 세션/버튼 클릭 기반인지 안정적인 직접 호출 경로인지 검증 전이라 별도 조사 과제로 남겨둠. 다음 연도 갱신 방법은 `docs/PUBLIC_DATA_SETUP.md`에 기록.

검증: 모킹 없이 실제 커밋된 스냅샷 파일을 읽는 테스트 2건(`test_fetch_nps_rows_reads_static_2025_snapshot_when_present`, `test_fetch_nps_holding_uses_2025_as_of_from_static_snapshot`) 신규 포함 전체 회귀 434건 통과. `fetch_nps_holding('삼성전자')`/`fetch_nps_holding('SK하이닉스')` 직접 호출해 실제 값(지분율 7.76%/7.90%, 평가액 등) 확인.

**2026-08-20(24차) 국민연금 보유종목 - 개수 상한을 지분율 필터로 교체 + 기준일 안내문 삭제**: 21차에서 개수(상위 100개)로 잘랐는데, 사용자 피드백으로 방향을 바꿨다: "1000개 종목은 너무 과하다. 위에 %로 자르자(10%/8%/5% 이상 등) - 서버에 부담되나?"와 "기준일 OO 공시 스냅샷입니다는 삭제해 - 24년 데이터 보여주는 게 신뢰성 제로다, 진짜 문제다." VM에서 실제 매칭 전체 종목 수(자르기 전)를 직접 확인하니 1120개였다.

`strategy_scan.py`의 `NPS_TOP_N`을 다시 무제한(`None`)으로 되돌렸다 - 어제 원인 분석대로 문제는 서버가 보내는 JSON 크기가 아니라(1120건 정도는 네트워크로 전혀 부담 없음) 클라이언트가 그걸 전부 DOM 표 행으로 렌더링하던 것이었으므로, 실제 안전장치는 클라이언트 쪽에 둬야 한다고 판단. `js/strategy-search.js`에 지분율 임계값 셀렉트(`ss-nps-filter-select`, 10/8/5/3/1% 이상, 기본 5%)를 추가해 이미 받아온 전체 목록을 클라이언트에서 필터링하고(서버 재호출 없음, 배당주 정렬 셀렉트와 같은 패턴), 임계값을 아무리 낮춰도(예: 1% 이상=1027건) 다시 대량 렌더로 멈추지 않도록 `NPS_RENDER_CAP=300` 방어 상한을 별도로 걸었다(선택한 임계값과 무관하게 항상 적용, 잘렸으면 "상위 300개만 표시" 안내). "기준일 OO 공시 스냅샷입니다" 표 상단 안내문은 요청대로 완전히 삭제했고, `NPS_METHODOLOGY_NOTE`에서도 "(화면의 기준일 참고)"처럼 이제 존재하지 않는 안내문을 가리키던 문구를 정리했다.

검증: Playwright로 실제 1120건 규모 합성 데이터를 주입해 5%/1%/10% 각 임계값에서 렌더링 개수·안내 문구(전체 N종목 중 M종목 · 상위 300개만 표시)가 정확히 일치하는지 확인, 300행이 렌더링된 상태에서 "조건 자세히" 토글을 반복해도 300ms 안에 끝나고 콘솔 에러가 없음을 확인(어제 멈춤 문제 재현 안 됨). 전체 회귀 432건 통과, `node --check js/strategy-search.js` 통과.

**2026-08-20(23차) 한 주 마감 리포트 다크모드 구분선 색 수정**: "한 주 마감 리포트" 제목 아래 구분선(`.hwr-head` border-bottom, `#e5e9ef` 옅은 회색)만 다크모드 대응이 빠져있어 주변보다 밝게 떠 보였다(사용자 리포트: "중간에 흰색 줄(진한색) 주위 선색이랑 같게 해줘" - 같은 파일의 다른 요소들은 18차 작업에서 대부분 이미 다크 대응됨). `html.dark .hwr-head { border-color: rgba(245,239,224,.16); }` 추가, `js/home-weekly-report.js`의 CSS 캐시 버전 갱신. 검증: Playwright로 실제 렌더링해 border-bottom-color가 `rgba(245, 239, 224, 0.16)`으로 바뀌는 것 확인, 전체 회귀 432건 통과.

**2026-08-20(22차) 국내/미국 시장 요약 칸 다크모드 배경 불일치 수정**: 18차에서 홈 편집판 다크모드를 대규모로 고쳤는데도, "국내 시장 요약"/"미국 시장 요약" 칸(`.hmb-list > div`)만 카드·페이지 배경과 다른 옅은 톤으로 남아있었다(사용자가 실제 다크모드 스크린샷으로 리포트: "뒤에 배경색이 다르지? 검은색으로 통일시켜줘"). 원인은 `html.dark .hmb-list > div { background: rgba(245,239,224,.05) !important; }`(라이트모드의 은은한 카드 틴트를 다크모드로 그대로 옮긴 규칙) - 홈 편집판 전용 규칙(`body#tt-body-index .home-editorial-page .hmb-list > div { background: transparent; }`, 페이지 배경에 맞게 의도된 값)보다 소스 순서상 나중이면서 `!important`까지 있어 이 칸만 항상 이겨서 옅은 크림색 틴트가 남았다. `!important` 배경 선언을 제거해 편집판의 `transparent` 의도가 정상적으로 적용되게 했다. 검증: Playwright로 `test/home-editorial-preview.html`을 다크모드로 렌더링해 셀 배경이 `rgba(0,0,0,0)`(완전 투명, 페이지 배경과 동일)로 바뀌는 것을 실제 확인, 전체 회귀 432건 통과.

**2026-08-20(21차) 국민연금 보유종목 - 브라우저 응답없음 버그 수정(상위 100개로 제한)**: 19차에서 URL 버그를 고치고 실데이터가 들어오기 시작하자, 전략검색 "국민연금 보유종목" 탭에서 "조건 자세히"를 누르면 브라우저가 멈추는 리포트를 받았다. 원인은 `strategy_scan.py`의 `NPS_TOP_N = None`(무제한) - `DIVIDEND_TOP_N`/`ETF_RETURN_TOP_N`과 같은 패턴이지만, 그 카테고리들은 실제로는 수십 건 수준이라 문제가 없었던 반면 국민연금은 URL 버그 때문에 그동안 항상 0건이라 진짜 규모(유니버스 전체 대비 수백 건)를 본 적이 없었다. `js/strategy-search.js`의 `renderNpsTable()`이 이걸 섹터 구분 없이 표 하나로 통째로 그리다 보니, "조건 자세히"(`<details>` 토글)로 박스 높이가 바뀌면서 그 큰 표 전체가 리플로우돼 멈춘 것으로 보인다. `BLUECHIP_TOP_N`/`OPENING_GAP_TOP_N`과 같은 패턴으로 `NPS_TOP_N = 100`으로 제한하고, 서버 methodology 문구와 클라이언트 요약 문구 둘 다 "상위 100개"를 명시하도록 갱신했다. 검증: 전체 회귀 432건 통과, `node --check js/strategy-search.js` 통과 - 실제 브라우저 프리징 재현/해소는 VM 배포 후 사용자 확인 필요.

**2026-08-20(20차) 국민연금 대량보유상황보고(5%룰) 보조 정보 추가**: "연 1회는 오래됐다"는 리포트를 받고, 분기 단위로 갱신되는 다른 공식 데이터셋(data.go.kr "국민연금공단_대량보유주식 보고내역", namespace 15106890)이 실제로 존재하는지 사용자와 함께 확인했다. 자본시장법상 5% 이상 보유·1%p 이상 변동 시 영업일 5일 이내 신고해야 하는 수시공시(대량보유상황보고)를 data.go.kr이 분기 단위로 묶어 재배포하는 것으로, "분기"는 공시 자체의 주기가 아니라 이 정부 데이터셋의 발행 주기임을 확인. 사용자가 VM에서 직접 curl로 실제 응답을 확인한 결과, 발행기관명/보고서 작성기준일(행마다 실제 날짜)/지분율(퍼센트)만 있고 평가액·자산군 비중 필드는 없으며, 전체 종목 수도 142개뿐(국민연금 전체 포트폴리오가 아니라 5%룰 신고 대상 종목만)임을 확인. 이 차이 때문에 기존 전략검색 "국민연금 보유종목" 카테고리(19차에서 URL 버그 수정한 것, 1200종목 전체 랭킹·연 1회)는 그대로 두고, 종목분석 페이지 연기금 카드에 `large_holding_report`라는 별도 보조 정보로만 추가하기로 사용자와 확정("기존건 유지하고 이건 별도로 추가").

`scripts/cloud-vm/public_data.py`에 `NPS_LARGE_HOLDING_URL`(namespace 15106890의 최신 분기 uddi, 19차와 같은 방식으로 스웨거 문서에서 직접 확인)과 `fetch_nps_large_holding(name)`을 추가 - 기존 `fetch_nps_holding()`/`_fetch_nps_rows()`와 캐시 키·에러 메시지를 분리해 서로 영향 없게 했다. `investor_flow.py`에 `large_holding_report(name)` 래퍼(서비스키 미설정/조회 실패 시 None, 나머지 수급 데이터는 그대로) 추가, `pension` 응답에 `large_holding_report` 필드 추가. `js/foreign-flow.js`의 `buildPensionCard()`에 있으면만 표시하는 방식으로 한 줄 추가(국민연금 5% 신고 - 지분율, 기준일).

검증: `test/test_public_data.py`(3건)+`test/test_investor_flow.py`(4건) 신규 포함 전체 회귀 432건 통과, `node --check js/foreign-flow.js` 통과. `docs/PUBLIC_DATA_SETUP.md`에 이 연결 지점과 "국민연금 관련 데이터셋 2개는 활용신청이 각각 별도로 필요하다"는 점을 기록. **후속 주의**: 이 데이터셋도 분기마다 새 uddi 리소스가 발행되므로(19차의 연 1회 데이터셋과 마찬가지로) 다음 분기부터는 `NPS_LARGE_HOLDING_URL`을 스웨거 문서에서 최신 uddi로 다시 갱신해야 한다 - 하드코딩된 상수라 자동 갱신되지 않는다.

**2026-08-20(19차) 국민연금 보유종목 카테고리 - 잘못된 odcloud UDDI URL 수정**: 8차에서 연결한 국민연금 보유종목 카테고리가 계속 빈 결과만 냈던 실제 원인을 VM에서 직접 진단해 찾았다. 1) `.env`에 국민연금용 서비스키가 아예 없었음(KOFIA 전용 키만 있었음) - data.go.kr "일반 인증키"는 계정 단위로 여러 승인 데이터셋에 공용으로 쓰이는 걸 확인하고 같은 키를 `DATA_GO_KR_NPS_SERVICE_KEY`로 VM `.env`에 추가(사용자가 VM에서 직접 처리). 2) 키를 넣은 뒤에도 HTTP 404 - `scripts/cloud-vm/public_data.py`의 `NPS_HOLDING_URL`이 odcloud 리소스 UDDI 뒤에 `_20241231`을 잘못 붙이고 있었다(실제 존재하지 않는 리소스 경로). infuser.odcloud.kr 스웨거 문서(namespace=3070507/v1) API 목록을 사용자가 VM에서 직접 조회해 "국민연금공단_국내주식 투자정보_20241231"의 실제 경로가 접미사 없는 UDDI임을 확인 후 상수 수정(이전 연도 리소스는 접미사가 있는 게 맞음 - 이 최신 리소스만 예외). 데이터셋이 매년 갱신되면 이 상수도 같은 방식(스웨거 문서에서 최신 uddi 확인)으로 다시 갱신해야 한다는 점을 코드 주석에 남김. 검증: 전체 회귀 425건 통과(URL 상수 변경뿐이라 기존 테스트 영향 없음) - 실제 API 응답이 200으로 오는지는 VM에서 배포 후 재확인 필요.

**2026-08-20(18차) 다크모드 대규모 수정 - 홈 "편집판" 배경 토큰 미정의가 근본 원인 + 전략검색 표 폭·검색창 스타일 조정**: 한 메시지로 여러 리포트를 받았다 - 전략검색 3개 표(재무건전 장기 눌림/배당주/ETF)가 전부 화면 폭을 넘어가 스크롤해야 보임, 커뮤니티(종목선택/의견남기기/댓글)·MY 보유기준·홈 화면 다수(주요일정/실시간 종목판/거래대금/미국시장 요약 박스/한국증시·미국증시·휴장 탭/휴장 Market Closed 박스/주간 경제뉴스 박스)가 다크모드 미적용, 검색창 테두리 두께·폰트 크기 조정, 마켓브리핑 마우스오버 스타일 변경.

가장 큰 발견은 홈 "편집판"(`body#tt-body-index .home-editorial-page`, 실시간 종목판·미국시장 요약 등 최근 재설계된 뉴스페이퍼 스타일 구획)이 배경·글자·구분선 색을 전부 `var(--text-main)`/`var(--text-sub)`/`var(--rule)`/`var(--page-bg)`/`var(--surface)` CSS 커스텀 프로퍼티로 참조하는데, 이 프로퍼티들 자체엔 다크모드 재정의가 `:root`에만 있고 `html.dark`엔 전혀 없었다는 것 - 개별 컴포넌트에 `html.dark .hrt-stock` 같은 패치가 몇 군데 있었지만 근본 토큰은 안 건드려져 있었다. 특히 `html:not(.font-gothic) body { background: var(--page-bg) !important; }`(기본 뉴스페이퍼 디자인 모드, 대부분의 방문자가 이 모드)가 `!important`로 페이지 배경 자체를 강제하고 있어서, `html.dark body { background:#1A1A1A }`(`!important` 없음)가 애초에 이길 수 없었다 - **다크모드인데 페이지 배경 자체가 계속 밝은 채로 남아있던 진짜 원인**이었고, 이번 리포트 대부분(주요일정/실시간 종목판/거래대금/한국증시·미국증시·휴장 탭 클릭 시 텍스트가 배경에 묻혀 "검은색으로 변하는" 것처럼 보인 현상 포함)이 여기서 파생됐다. `html.dark { --text-main:#F5EFE0; --text-sub:rgba(245,239,224,.65); --rule:rgba(245,239,224,.16); --page-bg:#1A1A1A; --surface:#1A1A1A; }`로 토큰 자체를 재정의해 이 토큰을 쓰는 모든 곳을 한 번에 고쳤다(Playwright로 `test/home-editorial-preview.html`을 다크모드로 렌더링해 실제로 배경·글자색이 바뀌는 것을 스크린샷으로 확인).

이 토큰 재정의로 못 잡히는 개별 버그 2건도 별도로 찾아 고쳤다 - (1) "휴장 Market Closed" 마스트헤드(`.home-closed-page`)는 애초에 "a plain white field"라는 주석과 함께 `background:#fff !important` + 리터럴 색으로 라이트모드 전용 설계돼 있어 토큰 재정의로도 안 고쳐졌다(Playwright로 실제 흰 박스 재현 후 다크 전용 규칙 추가해 확인). (2) `css/home-weekly-report.css`의 `.hwr-news-card`/`.hwr-news-event-body h4`(주간 경제뉴스 박스·뉴스 제목)는 `html.dark` 규칙이 라이트모드 색을 그대로 복붙해와서(`background:#fff !important`/`color:#24324a` 그대로) 다크모드에서도 안 바뀌던 복붙 버그였다.

나머지: `css/stock-discussion.css`(커뮤니티 위젯) 전체에 다크모드가 아예 없어서(종목선택 바·자동완성, 의견 남기기 폼, 댓글 목록) 전부 새로 추가. `css/my-dashboard.css`는 "보유 기준"(`<select>`) 하나가 다크 규칙 목록에서 `input`만 있고 `select`가 빠져 있던 정확한 원인을 찾아 추가(그 외 MY 보유정보 필드는 이미 다크 대응돼 있었음 - 사용자가 요청한 "+로 추가매집 물타기 계산" 기능도 `js/my-dashboard.js`의 "물타기 계산기"(슬라이더로 추가 투입금액 조절, 예상 평단가 자동 계산)로 이미 존재해 별도 구현 안 함, UI를 슬라이더 대신 수량·단가 직접 입력으로 바꿀지는 후속 확인 필요).

전략검색 표 3개(`css/strategy-search.css`)는 `.ss-comparison-table`(1480px)/`.ss-strategy-table`(1420px) 최소폭이 이 페이지("/page/strategy-search", 오른쪽 사이드바 없는 Tistory 페이지 템플릿)의 실제 콘텐츠 폭(최대 1348px)보다 항상 넓게 강제돼 있어 화면 크기와 무관하게 항상 가로 스크롤이 필요했던 게 원인 - 두 min-width와 개별 열 폭을 비례 축소(약 20%)해 실제 콘텐츠 폭 안에 들어오게 했다(Playwright로 실제 폭(1348px)에서 overflow 0 확인, narrow 폭(1200/1024px)에서는 일부 스크롤이 여전히 필요함을 별도 확인 - 정상 범위).

검색창(`skin.html`/`style.css`)은 테두리 1.5px→1px, 폰트 25px→13px(데스크톱)/19px→10px(모바일)로 축소. 마켓브리핑은 `.post-card a:hover .post-title`의 다크모드 규칙이 라이트모드(파란 계열, 밑줄 없음)와 다르게 밑줄+기본색으로 돼 있던 걸 라이트모드와 같은 방식(파란 계열 `#4d9fff`, 밑줄 없음)으로 맞췄다.

검증: `test/test_ui_ia.py` 캐시 버전 갱신 포함 전체 회귀 425건 통과. Playwright로 `test/home-editorial-preview.html`(라이트/다크), `test/strategy-search.html`(3개 탭 × 3개 폭)을 직접 렌더링해 실제 배경·글자색·표 폭을 스크린샷/좌표값으로 확인 - 텍스트만으로 짐작하지 않았다. **미확인/후속 필요**: (1) 국민연금 보유종목 "연 1회 공시"는 이 시점 data.go.kr 실제 데이터셋(`국민연금공단_국내주식 투자정보_20241231`)과 대조해 정확한 값으로 확인됨(웹검색) - 별도로 "대량보유주식 보고내역"이라는 분기 단위 공시 데이터셋도 존재하나 현재 코드가 쓰는 데이터셋과는 다름, 전환 여부는 사용자 확인 필요. (2) 같은 카테고리에 "검색이 안 된다"는 리포트는 VM의 실제 배치 스캔 결과(서비스키 승인 여부·최근 실행 여부)를 직접 봐야 확인 가능해 사용자에게 VM 확인을 요청함. `style.css`/`css/`는 GitHub Pages 자동 배포, `skin.html`은 Tistory 관리자 수동 반영 대상.

**2026-08-20(17차) "공파산 타점" 신규 - 역매공파 스킬 정의를 코드로 이식, 차트검색 탭/백테스트 서비스화**: "공파산" 전용 스캐너를 만들어달라는 작업지시서(다른 AI가 작성)를 받았는데, 파란점선을 볼린저밴드 상단(20,2)으로, 공구리를 "20·60일선이 112일선과 ±3% 이격"으로 정의하고 있었다. 이 저장소엔 이미 검증된 "역매공파" 스킬(`.claude/skills/synced/yeokmaegongpa`, 12종목·600일 백테스트 기록 있음)이 있는데 그 정의와 정면으로 어긋났다 - 스킬은 "파란점선은 볼린저밴드 아님, 엔벨로프 상단(46일선×1.12)"이라고 명시하고, 공구리도 이평선 수렴이 아니라 "가격 변동폭이 좁게 다져지는 구간"으로 정의하며, 특히 매수 타점 자체가 다르다(작업지시서: 파란점선 돌파 그 순간이 진입 / 스킬: 돌파는 "관심 등록"일 뿐이고 그 후 20일선 눌림목에서 지지받는 첫 캔들이 진짜 타점 - 스킬 §5가 "오돌이 장대양봉을 매수 자리로 착각 금지"라고 명시적으로 경고). 사용자에게 확인한 결과 "공파산 = 역매공파에 이름만 붙인 것"이라는 답을 받아, 작업지시서 대신 스킬 정의를 그대로 구현하기로 했다.

`scripts/cloud-vm/gongpasan_strategy.py`(신규)에 `calculate_gongpasan_signal(code, conn=None, rows=None)`을 만들었다: 스킬 §4 필터(최근 160일 고점 대비 낙폭 25%+, 최근 40일 종가 변동폭 25% 이하 공구리, 최근 60일 내 거래량 20일평균 2.5배+·몸통 4%+ 매집봉, 직전 5봉 고가+5일선 동시 돌파 오돌이)를 전부 만족하면 `breakout_signal`("관심 등록"), 그 이후 20일선에 처음 지지받는 캔들이 나오면 `entry_signal`("매수 타점")로 표시한다(돌파~눌림목 사이 유효 기간·지지 허용오차는 스킬에 명시된 숫자가 없어 임의로 정하고 주석에 밝혔다). `backtest_gongpasan()`은 entry_signal 다음날 시가 진입 후 20일선 이탈 손절/파란점선(엔벨로프 상단) 도달 익절/20일 타임컷(작업지시서에 있던 값 그대로 유지) 중 먼저 오는 조건으로 청산한 net_return을 모은다. `pandas-ta`는 이번에도 설치 불가(15·16차와 동일 사유)라 이동평균 전부 pandas SMA로 직접 계산했다.

노출은 각도기 테스트와 동일한 경로 - `gongpasan_scan.py`(신규, `angle_momentum_scan.py`와 같은 SQLite 전용 전종목 스캔 패턴이지만 서로 참조하지 않는 완전 독립 모듈)가 `daily_scan_cache.json`의 `patternScan.patterns.gongpasan`/`gongpasanBacktest`로 저장하고, `gas/ticker-proxy.gs`의 `getPatternScanResult()`에 매핑을 추가했다. `js/pattern-scan.js`엔 "공파산 타점" 탭(설명 문구, 신호/해석 텍스트, 상세 차트에 20일선+파란점선(점선) 오버레이)을 추가했고, 백테스트 요약 배너(`#psBacktestBox`)는 각도기 테스트와 공파산이 청산 규칙이 달라(고정 N일 보유 vs 손절/익절/타임컷) 탭별로 각주 문구가 다르게 나오도록 `BACKTEST_CONFIGS` 맵으로 일반화했다. VM 자동 실행은 `scripts/cloud-vm/setup_gongpasanscan_timer.sh`(각도기 테스트 5분 뒤, 16:30 KST)로 새로 만들었다 - VM에서 1회 수동 실행 필요.

검증: 160일 급락 → 40일 공구리(중간에 매집봉 1개) → 단 하루 만에 5봉 고가+5일선 동시 돌파 → 20일선 눌림 순으로 합성한 OHLC로 `breakout_signal`이 오돌이 캔들에서 정확히 1회, `entry_signal`이 그 이후 눌림목에서만 뜨는 것을 확인했고, 돌파 없이 평평하기만 한 데이터에선 둘 다 전혀 안 뜨는 것도 확인했다. `gongpasan_scan.py`도 인메모리 SQLite+모킹으로 `main()` 전체를 종단 실행해 확인(자동화 테스트에는 미포함 - `rescan_patterns.py`/`angle_momentum_scan.py`와 같은 저장소 관례). `test/test_gongpasan_strategy.py`(12건)+`test/test_gongpasan_scan.py`(4건) 신규 포함 전체 회귀 425건 통과, `node --check`로 `js/pattern-scan.js`/`gas/ticker-proxy.gs` 문법 검사 통과. **VM에 아직 반영 전** - `pip install pandas numpy`(16차 작업 때 이미 설치 완료 확인됨)와 `setup_gongpasanscan_timer.sh` 수동 실행이 필요하다.

**2026-08-20(16차) "각도기 테스트" 신규 - 세력매집각도 정규화+분출필터 개선판으로 교체하고 차트검색 탭 실제 노출 + 백테스트 서비스화**: 15차에서 만든 `accumulation_angle.py`(원값 각도, 함수 단위만 존재·화면 미노출)를 사용자가 별도로 검토한 개선 스펙으로 요청받았다 - (1) 각도 계산에 넣는 시리즈를 절대 EMA값이 아니라 "N봉 전 대비 %(변동률)"로 정규화(동전주·고가주가 같은 상승률이어도 절대 가격차 때문에 각도가 달라지는 문제 해결), (2) "각도가 0을 넘었는지"가 아니라 "각도 자체가 지금 가속 중인지"(`np.sign(각도.diff())`)로 전환 판정 방식 변경, (3) 분출 필터(단기 각도의 하루 변화량이 최근 20일 변화량 표준편차의 1.5배 초과) 추가, (4) 신호 발생 후 5일 보유 백테스트(다음날 시가 진입, 슬리피지 왕복 0.15%×2 차감) 추가. 이번에도 `pandas-ta`는 이 환경(Python 3.11)에 설치가 안 돼(15차와 동일 사유) pandas+numpy로 동일 계산식을 직접 재현했다. `compute_accumulation_angle()`의 출력 컬럼/`entry_signal` 조건식 자체를 이 버전으로 교체했고(함수 시그니처는 유지, `rows` 파라미터를 옵션으로 추가해 이미 로드한 OHLC를 재사용할 수 있게 함), `backtest_entry_signal()`/`summarize_backtest()` 두 함수를 새로 추가했다.

노출 위치는 "전략검색"이 아니라 "종목 > 종목검색 > 차트검색"에 새 탭 "각도기 테스트"로 사용자가 직접 지정했다. `rescan_patterns.py`(SQLite만 읽는 전종목 재채점 스크립트)와 같은 패턴으로 `angle_momentum_scan.py`를 새로 만들어 전종목을 훑어 최신 entry_signal 후보 목록 + 전체 종목·전체 시점 백테스트 집계를 `daily_scan_cache.json`의 `patternScan.patterns.angleMomentum`(후보 목록)/`angleMomentumBacktest`(승률·평균수익률·손익비 요약)로 저장한다 - 기존 6개 패턴 탭과 같은 서빙 경로(`/daily-scan-batch` → GAS `getPatternScanResult()` → `js/pattern-scan.js`)를 그대로 타서 VM `main.py`/엔드포인트는 손대지 않았다. `gas/ticker-proxy.gs`의 `getPatternScanResult()`에 `angleMomentum` 패턴 매핑과 `angleMomentumBacktest` 전달을 추가했다. `js/pattern-scan.js`엔 새 탭 정의(설명 문구 포함)와 신호/해석 텍스트, 상세 차트 EMA5·EMA20 라인 오버레이(다른 탭처럼 단순 종가 이동평균 근사), 그리고 탭 전용 백테스트 요약 배너(`#psBacktestBox` - "과거 신호 N건 · 5일 보유 백테스트(참고용)"과 함께 승률/평균수익률/손익비 표시, "과거 성과가 미래 수익을 보장하지 않습니다" 문구 포함)를 추가했다. 상세 클릭 시 GAS `getPatternChart()`는 이 새 탭에 대한 판정 재현 로직이 없어 `detail`이 항상 null로 오는데, 이는 기존 `maCloudBreakout`/`openingGap` 탭도 이미 겪는 동작이라 프론트가 이미 갖고 있던 스냅샷 폴백(`item.patternDetail`, `snapshotFallback:true`)이 그대로 처리한다 - GAS 쪽은 추가 수정 없음. VM 자동 실행은 `scripts/cloud-vm/setup_anglemomentumscan_timer.sh`(strategy_scan 5분 뒤, 16:25 KST)로 새로 만들었다 - 다른 `setup_*_timer.sh`와 같은 패턴으로 VM에서 1회 수동 실행 필요.

검증: 합성 데이터(평탄→가속→평탄상승 3구간)로 entry_signal이 가속 초입에서만 뜨고 평탄 구간에선 절대 안 뜨는 것을 확인, `backtest_entry_signal`/`summarize_backtest`도 같은 데이터로 확인. `angle_momentum_scan.py`는 인메모리 SQLite+모킹으로 `main()` 전체를 종단 실행해 기존 패턴 섹션(`risingLows` 등)과 `universe` 값이 스캔 후에도 그대로 보존되는지 별도로 확인했다(자동화 테스트에는 안 넣음 - `rescan_patterns.py`도 같은 이유로 테스트 파일이 없는 이 저장소 관례를 따름). `test/test_accumulation_angle.py`(12건, 로직 변경에 맞춰 전면 재작성) + `test/test_angle_momentum_scan.py`(4건, 신규) 포함 전체 회귀 409건 통과, `node --check`로 `js/pattern-scan.js`/`gas/ticker-proxy.gs` 문법 검사 통과. **VM에 아직 반영 전** - `pip install pandas numpy`(15차와 동일 caveat, 아직 미확인)와 `setup_anglemomentumscan_timer.sh` 수동 실행이 모두 필요해야 실제로 후보/백테스트 데이터가 채워진다(그 전까진 탭이 "아직 스캔 결과가 없어요"로 보임).

**2026-08-20(15차) 세력매집각도 지표 신규 추가 (pandas + numpy, pandas-ta 미사용)**: "전형가 기반 EMA 단기5/장기20 각도로 매집 전환을 판정하는 지표를 pandas-ta로 만들어달라"는 요청을 받았다. `pandas-ta` 설치를 먼저 시도했는데, 이 시점 PyPI엔 정식(stable) 릴리즈가 없고 베타(`0.4.67b0`/`0.4.71b0`)만 있는데 둘 다 **Python 3.12+ 전용**이라 이 프로젝트가 쓰는 Python 3.11 환경(VM도 3.12 미만이면 동일하게 막힘 - 이 세션에서 VM 파이썬 버전은 직접 확인 못 함)엔 설치가 안 됐다. 사용자와 상의해 `pandas`(EMA는 `.ewm` 내장) + `numpy`(arctan/degrees)만으로 pandas-ta의 slope(as_angle=True, to_degrees=True) 계산 방식(구간 length 동안 1봉당 평균 변화량 → arctan → degrees)을 직접 재현하기로 했다 - 외부 지표 라이브러리 의존 없이 동일한 로직, VM 파이썬 버전과 무관하게 동작한다. `scripts/cloud-vm/accumulation_angle.py`(신규)에 `compute_accumulation_angle(code, conn=None)`을 추가했다: 전형가=(고가+저가+종가)/3, EMA 단기5/장기20을 전형가 기준으로 계산하고, 단기각도(EMA5 기준 5구간)/중기각도(EMA20 기준 5구간)/장기각도(EMA20 기준 20구간) 3개를 구하며, 진입조건(`entry_signal`) = 단기각도>0 AND 중기·장기각도가 직전 봉 대비 음수→양수로 막 전환된 시점(둘 다)으로 정의했다. 합성 데이터(평평한 구간 → 우상향 전환)로 직접 검증해 전환 시점에서만 정확히 한 번 `entry_signal`이 뜨는 것을 확인했다(pandas-ta 자체를 설치 못 해 그 실제 출력과 나란히 대조 검증은 못함 - 코드 주석에 명시). `test/test_accumulation_angle.py` 5건 신규(pandas 미설치 환경에서는 자동 스킵), 전체 회귀 398건 통과. **VM에 아직 반영 전 - 이 저장소엔 requirements.txt 등 의존성 관리 파일이 없어(기존 scripts/cloud-vm 코드는 표준 라이브러리 위주) VM에 `pip install pandas numpy`가 별도로 필요할 수 있다.** 배치 스캔이나 API 엔드포인트에 연결하는 작업은 이번 범위에 없음(함수 단위로만 완료) - 필요하면 후속 작업으로 진행.

**2026-08-20(15차) 모바일 navbar 로고·검색창 겹침 - 한 줄 트릭 대신 두 줄 구조로 변경**: 오늘 초(1차)에 고쳤다고 봤던 모바일 로고·검색창 겹침이 여러 캐시 재반영 이후에도 계속 재현됐다. 기존 방식(로고 `max-width:38vw` 말줄임 + 검색창 `flex:1 1 auto` 잔여폭 채우기로 한 줄에 욱여넣기)이 실제 기기 폭에서 로고+아이콘+검색창 세 요소의 최소 폭 합이 가용 폭을 넘어서면 검색창이 찌그러지며 겹쳐 보이는 근본적으로 불안정한 구조였다. 사용자 요청("그냥 두줄로 만들어")대로 구조를 바꿨다 - `flex-wrap`+`order`로 1번째 줄엔 로고+아이콘, 2번째 줄엔 검색창을 항상 전체 폭으로 배치한다(DOM 순서는 그대로 두고 시각 순서만 CSS `order`로 재배치). navbar가 2줄이 되며 높이가 56px 고정에서 늘어나므로, 그 차이를 `--navbar-mobile-extra-height` CSS 변수로 빼서 `.page-wrap`(본문 시작 위치)과 `.sidebar-left`(상단 메뉴바 위치)의 기존 오프셋 계산식에 더했다(데스크톱은 0이라 영향 없음) - 이 값을 빼먹으면 본문/메뉴바가 넓어진 navbar 밑에 가려지는 새 버그가 생기므로, Playwright로 실제 navbar 마크업+style.css를 모바일 폭(390px)에 렌더링해 늘어난 실제 높이(82px, 기존 56px 대비 +26px)를 직접 측정해 정확한 값을 넣었고, 겹침 없음/빈틈 없음을 스크린샷과 좌표값으로 확인했다. 전체 회귀 393건(fastapi 포함) 통과. `style.css`는 GitHub Pages 자동 배포 대상.

**2026-08-20(14차) Groq 모델 단종으로 AI 요약 전체 실패 수정 + 미국 종목판 거래대금 탭 시가총액·회사명 누락 수정**: "증시온도 참고의견이 브리핑을 생성하지 못했습니다" 리포트를 받았는데, GAS 실행 로그(Executions)엔 실패(빨간색) 항목이 하나도 없었다 - `safeCall()`이 예외를 조용히 삼켜서 전부 "완료됨"으로만 표시되고 있었다. `callGroq()`의 각 실패 분기(키 없음/HTTP 실패/JSON 파싱 실패/빈 응답/레이트리밋)에 `console.log` 진단 로그를 먼저 추가해 배포한 뒤 사용자가 다시 실행해 로그를 받아왔는데, 실제 원인은 `응답 코드 404, {"error":{"message":"The model \`llama-3.3-70b-versatile\` does not exist or you do not have access to it.","code":"model_not_found"}}` - GROQ_API_KEY는 정상이고, 코드에 박아둔 모델명이 Groq에서 단종된 것이었다. Groq 공식 모델 목록(console.groq.com/docs/models)에서 Production Models 등급(안정성 보장, Preview는 예고 없이 단종될 수 있어 제외) 중 가장 강력한 `openai/gpt-oss-120b`로 `GROQ_MODEL` 상수를 교체했다 - 이 상수는 참고의견뿐 아니라 종목뉴스 요약·공매도 해석 등 사이트의 모든 Groq 호출이 공유해서, 이 하나로 여러 기능이 같이 복구될 가능성이 높다. `ARCHITECTURE.md`/`docs/ARCHITECTURE_SPEC.md`의 모델명 표기도 갱신했다.

같은 날 "미국 종목판에서 거래대금 탭은 시가총액이 -, 종목명도 티커뿐인데 거래량 탭은 정상"이라는 리포트도 받았다. 원인: `scripts/cloud-vm/market_board.py`의 `fetch_us_kis()`는 KIS 거래대금/거래량 응답에 없는 회사 정식명·시가총액을 KIS의 marketCap 순위 응답에서 종목코드 기준으로 병합해 채우는데(`merge_us_kis_metadata`, 8/17~18 작업), 이때 KIS 자체 marketCap 응답이 비어 있으면(레이트리밋 등) 병합할 재료가 없어 그냥 통과했다. `main.py`의 `/market-board` 엔드포인트는 그 뒤에 비어있는 지표들을 키움 폴백으로 따로 채워 넣는데(`missing_metrics` 처리), marketCap이 그 폴백으로 뒤늦게 채워져도 병합을 다시 시도하지 않아 tradeAmount 등 KIS 원본 섹션은 계속 빈 상태로 남았다 - 반면 marketCap 자체가 통째로 키움으로 대체된 tradeVolume 탭은 키움 데이터에 이름·시가총액이 이미 포함돼 있어 정상으로 보였던 것. `merge_us_kis_metadata`를 공개 함수로 바꾸고(기존 `_merge_us_kis_metadata`), 키움 폴백으로 marketCap을 채운 직후 이 함수를 한 번 더 호출해 KIS 원본 섹션에도 뒤늦게 채워진 메타데이터가 반영되게 했다(종목코드 매칭이라 KIS/키움 소스가 섞여도 안전). `test/test_market_board.py` 2건 추가, 전체 회귀 393건(fastapi 포함) 통과. `gas/ticker-proxy.gs`는 GitHub Actions(clasp) 자동 배포, `scripts/cloud-vm/`은 VM 자동 배포 대상.

**2026-08-20(13차) 뉴스 타임라인 날짜 열 폭 여유 없어 폰트 교체 시 줄바꿈·겹침 위험 수정**: "폰트 변경 시 두 개 배경화면 색이 차이가 나지? 그리고 빨간색 쪽이 다르지?"라는 스크린샷 리포트를 받았다 - 경제 종합뉴스 목록에서 날짜("08/20")가 "08/"에서 줄바꿈되며 옆 타임라인 점(rail) 열과 겹쳐 보였다. `.app-news-date`(경제뉴스·미국뉴스·종목분석 관련뉴스가 공유하는 뉴스 타임라인 컴포넌트)의 날짜 열이 52px(모바일 45px)로 고정돼 있었는데, 실측해보니 "08/20" 텍스트 폭이 그 52px에 여유 0px로 딱 맞아떨어지는 상태였다 - 11차에서 UI 폰트를 나눔고딕에서 프리텐다드로 바꾸며 글자폭이 미세하게라도 넓어지면 곧바로 흘러넘칠 수 있는 상태였던 것. `white-space:nowrap`도 없어서 흘러넘칠 때 "08/" 다음에서 줄바꿈되며 옆 열과 겹쳐 보이는 최악의 형태로 깨졌다. `.app-news-date strong`/`small`에 `white-space:nowrap`을 추가하고, 날짜 열 폭을 52px→56px(모바일 45px→48px)로 넉넉하게 늘렸다. 같은 52px/45px 패턴을 각자 다시 선언하고 있던 `css/us-stocks.css`(`.us-stocks-news-item`)와 `css/stock-search.css`(`#stock-search .ss-news-item`, 종목분석 관련뉴스)도 같은 폭으로 맞췄다(둘 다 `.app-news-event`/`.app-news-date` 공유 클래스를 쓰는 동일 컴포넌트라 같은 위험을 안고 있었음). 관련 계약 테스트 4건 값을 갱신했고 전체 회귀 351건 통과.

**2026-08-20(12차) 배포 직후 검색 캐시 갱신이 매번 죽는 버그 수정 (kiwoom-deploy.service KillMode)**: "전략검색에 연기금은 아직도 반영이 안되었는데?"라는 리포트를 받았다(8차에서 추가한 국민연금 보유종목 카테고리). deploy_check.sh에는 원래 새 검색 규칙이 다음날 정규 배치까지 안 기다리고 배포 직후 바로 반영되게 하는 장치(`run_search_scan_refresh_after_deploy` - strategy_scan.py를 `&`+`disown`으로 백그라운드 실행)가 있었는데, 사용자가 VM에서 직접 받아준 로그로 확인해보니 이게 실제로는 한 번도 성공한 적이 없었다 - `search-scan-refresh.log`에 "started"만 5시간 동안 10번 찍히고 "finished"는 단 한 번도 없었고, `ps aux`에도 스캔 프로세스가 없었다(느리게 도는 중이 아니라 매번 죽고 있었다는 뜻). `journalctl -u kiwoom-deploy.service`를 보면 deploy_check.sh 본체가 끝난 지 1초 만에 "Deactivated successfully"가 찍혔다. 원인: `kiwoom-deploy.service`(Type=oneshot, 이 저장소엔 유닛 파일이 없고 VM에만 수동 설정돼 있던 기존 서비스)가 KillMode를 따로 안 정해 systemd 기본값(control-group)이 적용되는데, `disown`은 bash job control에서만 분리시킬 뿐 systemd cgroup 추적에서는 안 빠져서, 서비스 본체가 "완료" 처리되는 순간 같은 cgroup에 남아있던 방금 띄운 백그라운드 스캔까지 통째로 강제 종료됐다 - 배포마다 반복되는 구조적 버그였다(8차 이후 국민연금 카테고리가 계속 캐시에 안 들어간 이유). 기존 유닛 파일 전체 내용을 확실히 모르는 상태라 실수로 다른 설정을 지울 위험을 피하려고, 파일을 다시 쓰지 않고 `scripts/cloud-vm/fix_deploy_service_killmode.sh`로 drop-in override(`/etc/systemd/system/kiwoom-deploy.service.d/killmode-process.conf`)에 `KillMode=process`만 추가하는 방식을 택했다 - VM에서 1회 수동 실행 필요(다른 `setup_*_timer.sh`와 같은 패턴, 이 저장소 자동 배포 대상이 아님). 즉시 반영을 위해 사용자에게 수동으로 `strategy_scan.py`를 대화형 SSH 셸에서(배포 서비스 cgroup 밖이라 안전) 한 번 돌리도록 안내했다. 이 스크립트를 실행하지 않으면 앞으로도 배포 직후 캐시 갱신은 계속 실패하고 다음날 정규 배치(16:20 KST)까지 기다려야 한다.

**2026-08-20(11차) 고딕 모드 폰트 나눔고딕 → 프리텐다드 교체**: "폰트 나눔고딕을 프리텐다드로 변경 처리해, 기존 마루부리는 유지하고, 나눔고딕만 프리텐다드로 웹 폰트로 적용하면 된다"는 요청을 받았다. 나눔고딕은 두 곳에서 쓰이고 있었다 - (1) 사이트 기본 모드의 UI 폰트(`style.css`의 `--font-ui` 변수, 제목 마루부리·수치 시스템 고딕과 함께 조합되는 3종 세트 중 하나)와 (2) `#fontModeBtn`으로 전환하는 "고딕 모드"(`html.font-gothic`, 본문 전체를 강제로 고딕으로 바꾸는 토글) 양쪽 모두. 실제 웹폰트 로드는 `skin.html`이 네이버 한글한글아름답게 CDN(`hangeul.pstatic.net/.../nanum-gothic.css`)에서 하고 있었는데, 이걸 프리텐다드 공식 배포(`cdn.jsdelivr.net/gh/orioncactus/pretendard`)로 교체했다. `style.css`(`--font-ui` 변수, `.account-login-modal`, `.font-gothic` 강제 규칙), `css/dashboard-enhancements.css`·`css/watchlist.css`(각자 별도로 폰트를 다시 `@import`하는 구조라 두 곳 다 수정), `css/pattern-scan.css`의 나눔고딕 참조를 전부 프리텐다드로 바꿨다. 마루부리(`--font-title`, 제목·로고)는 요청대로 전혀 손대지 않았다. `legal/opensource-license.html`의 오픈소스 폰트 목록도 나눔고딕(네이버 나눔글꼴 라이선스) 항목을 프리텐다드(SIL Open Font License 1.1, github.com/orioncactus/pretendard) 항목으로 교체했다. `test/test_ui_ia.py`의 관련 계약 테스트 2건을 새 폰트명에 맞게 갱신했다(라이선스 페이지에 나눔고딕 문자열이 더 이상 없는지도 함께 확인). 전체 회귀 351건 통과, JS 문법 검사 통과. `style.css`/`css/`/`skin.html`은 각각 GitHub Pages 자동 배포·Tistory 관리자 수동 반영 대상(`skin.html`은 수동 반영 필요).

**2026-08-20(10차) 전략검색 표(재무건전 장기 눌림·배당주·ETF) 모바일에서 끝이 잘리는 문제 수정**: "전부 표로 되어 있는데, 끝에가 짤려"라는 리포트를 받았다. 말로만은 원인이 좁혀지지 않아 이 환경에 미리 깔린 Chromium(Playwright)으로 `test/strategy-search.html`을 모바일 폭(390px)으로 직접 렌더링·스크린샷해서 실제 원인을 확인했다. 두 가지 독립된 버그가 겹쳐 있었다 - (1) `css/strategy-search.css`의 `.ss-strategy-table`(재무건전 장기 눌림·국민연금 보유종목이 쓰는 표)이 데스크톱 열 정렬용으로 `min-width:1420px`를 미디어쿼리 밖에서 항상 걸어두는데, 모바일 구간(`@media max-width:640px`)의 `.ss-comparison-table{min-width:0}` 카드형 리셋과 우선순위(specificity)가 같아 소스 순서상 더 뒤에 있는 1420px 규칙이 이겨버렸다 - 그 결과 모바일에서도 표 폭이 1420px로 강제되고, 같은 모바일 구간이 가로 스크롤까지 꺼버려서(`overflow:visible`) 화면 밖으로 넘어간 나머지 열이 그대로 안 보였다(요청한 "끝이 짤림"과 정확히 일치). (2) 모바일 카드형 레이아웃에서 "현재가" 열(`td.ss-col-price`)이 `position:absolute`로 각 행의 우측 상단에 붙게 되어 있는데, 그 기준이 되어야 할 `tr.ss-table-row`에 `position:relative`가 빠져 있어 모든 행의 가격이 자기 행이 아니라 페이지 최상단 한 지점에 전부 겹쳐서 렌더링되고 있었다(스크린샷으로 확인 - 세 자리 숫자가 뒤섞여 보임). 이 두 버그는 재무건전·배당주·ETF·국민연금 네 탭이 공유하는 같은 표 컴포넌트(`.ss-table-wrap`/`.ss-comparison-table`)에서 발생해 모든 탭에 동일하게 나타났다. `tr.ss-table-row`에 `position:relative`를 추가하고, `.ss-strategy-table`의 모바일 min-width를 `!important`로 확실히 리셋해 수정한 뒤, 같은 스크린샷 방식으로 재무건전·배당주·ETF 세 탭 모두 모바일(390px)·데스크톱(1280px) 양쪽에서 정상 렌더링(가격이 각 행에 정확히 표시, 가로 잘림 없음)됨을 확인했다. 전체 회귀 351건, JS 문법 검사 통과. `css/`는 GitHub Pages 자동 배포 대상.

**2026-08-20(9차) 연기금 매매 동향 카드에 국민연금 연말 보유정보 연결**: 8차 작업 완료 보고 중 "종목분석에 연기금 동향이 있어 이거 아니야?"라는 질문을 받았다. 확인해보니 그 카드(`js/foreign-flow.js`의 `buildPensionCard`, "연기금 매매 동향")는 8차에서 추가한 "국민연금 보유종목"과는 다른 데이터(최근 5·20·60일 순매수 등 매매 흐름, KRX 투자자별 매매동향 기준 `scripts/cloud-vm/investor_flow.py`)를 보여주는 카드였다. 다만 이 카드는 애초에 `p.official_holding`이 있으면 "국민연금 연말 보유(평가액·지분율)"를 매매동향 아래 같이 보여주도록 프론트에 이미 조건부로 짜여 있었는데, 그 값을 채워주는 백엔드가 없어 항상 빈 채로 숨어 있던 죽은 참조였다(8차 완료 보고에서 언급한 그 항목). 이번에 실제로 연결했다 - `investor_flow.py`의 `fetch_stock(token, code, name)`(종목분석이 이미 종목명을 넘겨주고 있어 추가 파라미터 불필요)에 `official_holding(name)` 헬퍼를 추가해 8차에서 쓴 `public_data.fetch_nps_holding(name)`(단일 종목 조회, 24시간 캐시)을 그대로 재사용했다. 서비스키 미설정이나 조회 실패 시 `None`을 돌려줘 나머지 매매동향 데이터는 그대로 보이고 이 줄만 조용히 빠지게 했다(주 데이터를 절대 깨지 않는 기존 폴백 원칙 유지). 배치 스크립트(`batch_scan.py`)에서도 같은 함수를 호출하는데, `public_data`의 24시간 메모리 캐시 덕에 전종목을 순회해도 국민연금 데이터는 최초 1회만 실제로 조회된다. `test/test_investor_flow.py` 신규 4건(성공/서비스키 없음/예외/미보유 각각 나머지 데이터를 안 깨는지) 추가, 전체 회귀 351건 통과. `scripts/cloud-vm/`은 VM 자동 배포 대상.

**2026-08-20(8차) 전략검색에 "국민연금 보유종목" 카테고리 추가**: "국민연금이 가진 종목 조회 가능하지? KRX나 공공데이터 포털 연동 해놨자나"라는 요청을 받았고, 원하는 노출 위치를 물으니 "종목분석 > 전략검색 탭에 하나 추가"라는 답을 받았다. 확인해보니 공공데이터포털(data.go.kr) 국민연금 국내주식 투자정보 연동은 `scripts/cloud-vm/public_data.py`의 `fetch_nps_holding(name)`으로 이미 존재했지만 어디서도 호출하지 않는 죽은 코드였다(단일 종목명 조회만 지원, 전체 유니버스 스캔용 아님). 배당주/저평가/ETF와 같은 구조로 `strategy_scan.py`에 새 카테고리를 추가했다: (1) `public_data.py`에 전체 유니버스를 한 번에 매칭하는 `fetch_nps_holdings_by_code(universe)`를 새로 추가하고(기존 `fetch_nps_holding`과 지분율/평가액/기준일 파싱 로직을 `_nps_row_info()`로 공유), 종목명 표기 차이(주식회사·공백 등)를 흡수하는 정규화 매칭을 썼다. (2) `strategy_scan.py`에 `scan_nps_holdings()`를 추가해 유니버스·WICS 업종·일봉 시세와 결합, 보유 지분율 높은 순으로 정렬한 뒤 `output['categories']['nationalPension']`(이름: "국민연금 보유종목")으로 배치 결과에 포함시켰다. 국민연금 공시는 연 1회 스냅샷(현재 기준일 2024-12-31)이라 실시간 갱신이 아니라는 안내 문구(`NPS_METHODOLOGY_NOTE`)를 카테고리에 같이 담았다. 서비스키 미설정 등으로 조회 자체가 안 되면 빈 결과를 돌려줘 "지금은 확인할 수 있는 종목이 없어요"로 자연스럽게 처리되게 했다(임의值로 채우지 않음). (3) `js/strategy-search.js`는 탭 목록과 방법론 요약이 이미 카테고리 키 기반으로 동작하는 범용 구조라 탭 추가 자체엔 손댈 게 없었고, 표 렌더링 분기(`renderNpsTable`/`npsTableRow` - 종목명/업종/현재가/등락률/보유지분율/평가액 컬럼, 기준일 안내 배지)만 추가했다. 행 클릭 시 종목상세 이동은 기존 범용 폴백 핸들러가 그대로 처리해 별도 수정이 필요 없었다. 조사 중 `js/foreign-flow.js`의 "연기금 매매 동향" 카드(`buildPensionCard`)가 `p.official_holding.evaluation_amount_eok`/`holding_pct` 필드를 참조하는데 이 필드도 어떤 백엔드에서도 채워준 적이 없는 별개의 죽은 프론트 참조임을 발견했다 - 이번 요청 범위(전략검색 탭) 밖이라 손대지 않았고 필요하면 같은 국민연금 데이터로 후속 연동 가능하다. `test/test_public_data.py`(3건 추가), `test/test_strategy_scan.py`(3건 추가), `test/test_ui_ia.py`(1건 추가) 포함 전체 회귀 347건 통과, JS 문법 검사 통과. `scripts/cloud-vm/`은 VM 자동 배포, `js/`는 GitHub Pages 자동 배포 대상이며 새 카테고리 데이터는 다음 배치 스캔 회차부터 채워진다.

**2026-08-20(7차) 전략검색 배당주 상세 모달 PER/PBR 추가**: 6차에서 ROE만 고치고 미룬 PER/PBR을 사용자가 KIS 공식 문서(`FHKST01010100` 국내주식 현재가 시세) 링크로 이어서 요청해 진행했다. 조사해보니 이 프로젝트에 "PER/PBR 데이터가 없다"는 `strategy_scan.py` 모듈 docstring의 전제 자체가 부정확했다 - `js/foreign-flow.js` 종목분석 펀더멘탈 탭이 이미 GAS `getFundamentals_()`(VM `/quote` → 키움 `ka10001`, KIS 실패 시 폴백) 응답의 `per`/`pbr` 필드를 그대로 읽어 화면에 표시하고 있었다(검증된 필드명). "실시간 밸류에이션은 시세 응답이 없어 표시하지 않습니다"는 그 온디맨드 호출이 실패했을 때만 뜨는 폴백 문구인데, 이걸 "구조적으로 데이터가 없다"로 오인해 배당주 스캔이 PER/PBR을 아예 시도하지 않았던 것. 같은 검증된 TR(`ka10001`)을 `daily_scan.py`의 `market_cap_getter()`와 동일한 패턴(키움 토큰 1회 발급, 배당 신호를 통과한 후보에만 종목당 0.25초 대기 호출, 종목 단위 try/except로 개별 실패가 전체 스캔을 안 죽임)으로 `strategy_scan.py`에 추가했다(`fetch_dividend_valuation()`). `KIWOOM_APPKEY`/`KIWOOM_SECRETKEY` 미설정 시에는 기존과 동일하게 PER/PBR 없이(`None`) 계속 진행한다. "저평가" 전략의 이격도(disparity) 기반 판정 로직 자체는 그대로 두었다 - PER/PBR 전환은 그 전략의 별도 결정이라 이번 범위에 넣지 않았고, 부정확했던 docstring 설명은 정정했다. 시장(KOSPI/KOSDAQ)은 여전히 손대지 않았다(원인이 또 다름 - 6차 기록 참고). `test/test_strategy_scan.py`에 회귀 테스트 6건(ROE 반영, valuation 없을 때 None, valuation 있을 때 반영, 토큰 없으면 미호출, ka10001 응답 파싱, 호출 실패 시 안전 처리) 추가해 37건, 전체 회귀 340건 통과. `scripts/cloud-vm/`은 VM 자동 배포 대상이며 새 값은 다음 배치 회차부터 채워진다.

**2026-08-20(6차) 전략검색 배당주 상세 모달 ROE 항상 "—" 표시 수정**: "종목 > 종목검색 > 전략검색 > 배당주" 모달에서 ROE/PER/PBR/시장이 항상 "—"라는 리포트를 받았다(현대엘리베이터 스크린샷 확인). 원인을 나눠서 봤다 - (1) ROE는 `scripts/cloud-vm/strategy_scan.py`의 `build_dividend_match()`가 이미 인자로 받는 DART 연간 재무(`annual['latest_roe_pct']`)를 응답 딕셔너리에 담지 않고 누락시킨 단순 버그였다(같은 파일의 재무건전 전략 `build_match()`는 이미 `roe`를 담고 있어 배당주만 빠져 있었음) - `annual.get('latest_roe_pct')`를 `roe`로 추가해 해결, 새 API 호출 없음. (2) PER/PBR은 DART 연간 재무 계산 결과(`fundamentals.py`)에 애초에 없는 필드다(매출·영업이익·순이익·자본·부채·자산만 계산 - EPS/BPS/PER/PBR은 시세 기반이라 별도 API가 필요). (3) 시장(KOSPI/KOSDAQ)은 배당주 스캔이 쓰는 유니버스 소스(`load_full_universe()`, `data/krx_map.js` 파싱)에 애초에 `market` 필드가 없다(같은 파일의 재무건전 전략이 쓰는 `daily_scan.py` 쪽 유니버스와 다른 소스). PER/PBR/시장은 배치 스캔에 새 API 호출이나 유니버스 소스 변경이 필요해 이번엔 손대지 않았다 - ROE만 우선 수정. `test/test_strategy_scan.py` 31건, 전체 회귀 334건 통과. `scripts/cloud-vm/`은 VM 자동 배포 대상이며 새 값은 다음 배치 회차부터 채워진다.

**2026-08-20(5차) 종목분석 수급 조회 - 같은 스코프 버그 재발(slopeAt is not defined)**: 3차 수정(`crossedAbove` 스코프 버그) 배포 후 재현 리포트에서 새 에러 확인 - `(slopeAt is not defined)`. 원인은 완전히 동일한 패턴이었다: `slopeAt(period, lookback, end)`도 `crossedAbove`와 마찬가지로 `swingChartRegime()` 안에서만 정의된 지역 함수인데 `swingWaveStructure()`가 스코프 밖에서 그대로 참조하고 있었다(`ma20Slope`/`ma60Slope` 직전 변화량 계산용). 3차 수정 때 `crossedAbove`만 고치고 바로 옆 줄의 `slopeAt` 참조를 놓쳤다. 이번엔 `swingChartRegime`↔`swingWaveStructure`↔`buildSwingAssessment`↔`buildSwingSummaryBox` 네 함수 전체에 걸쳐 `ma`/`slope`/`slopeAt`/`crossedAbove`/`event`가 스코프 밖에서 쓰이는 자리가 더 있는지 전수 재검토했고(grep으로 각 호출부 라인 확인), 이제 남은 문제가 없음을 확인했다. `swingWaveStructure()` 안에 `slopeAt`을 자신의 `ma`/`closes`로 재정의해 추가했다. `test/test_ui_ia.py` 97건, JS 문법 검사 통과.

**2026-08-20(4차) 종목분석 첫 화면 "차트 흐름 데이터를 불러오지 못했어요" 조사 - GAS 응답 크기 축소 시도**: 3차 수정과 무관한 별개 리포트 - 검색 이전, 페이지가 처음 열릴 때 뜨는 "차트 흐름별 탐색" 섹션이 실패했다(`loadSignalData()` → GAS `?investSignal=1`, 오늘 이전 세 차례 수정과 겹치는 코드가 전혀 없음을 diff로 확인). GAS `?investSignal=1`을 주소창에서 직접 열면 정상 응답(스캔 2,217종목 데이터 확인)하는데 페이지 안 `fetch()`만 매번 실패해, 큰 응답을 `script.googleusercontent.com/macros/echo?...`로 리다이렉트하는 Apps Script의 처리 경로에 걸렸을 가능성이 높다고 판단했다(리다이렉트된 origin이 CORS 헤더를 안 들고 있으면 `fetch()`만 막히고 주소창 직접 접속은 CORS 검사 자체가 없어 정상으로 보인다 - 실측으로 이 가설을 완전히 확정하지는 못했다). 2026-08-14에 버킷당 종목 상한을 100 → 3,000으로 올린 시점(`invest_signal.py` `INVEST_SIGNAL_BUCKET_CAP`)과 응답이 커진 시점이 맞물린다. 응답에 포함된 `rankings`(수급/외국인·기관 등 top-N 랭킹 10종)는 `js/foreign-flow.js` 어디서도 읽지 않는 죽은 필드임을 grep으로 확인해(2026-07-20 "가중치 탭" 통합 이전 잔재로 추정) `gas/ticker-proxy.gs`의 `getInvestSignalResult()` 응답에서 제외했다 - 실제로 검색·필터에 쓰이는 `buckets`는 손대지 않았다. 이걸로 부족하면(여전히 크면) `buckets` 쪽 축소를 다음 단계로 검토해야 한다. `test/test_ui_ia.py` 97건, 전체 회귀 334건 통과(gas 파일 자체는 자동화된 실행 테스트 없음 - GAS 편집기 밖에서 실행 불가). `gas/ticker-proxy.gs`는 master 반영 후 GitHub Actions(clasp) 자동 배포 대상.

**2026-08-20(3차) 종목분석 수급 조회 실패 진짜 원인 수정 - crossedAbove 스코프 버그**: 1·2차로 추가한 실패 원인 문구 노출 덕에 실제 에러가 화면에 떴다 - `수급 데이터를 불러오지 못했어요. (crossedAbove is not defined)`. VM·GAS 데이터 조회는 처음부터 문제가 없었고(005930 실측 등 이미 확인됨), 네트워크/CORS와도 무관한 순수 JS 버그였다. `swingChartRegime()` 안에서만 정의된 지역 함수 `crossedAbove(period)`를 완전히 다른 함수인 `swingWaveStructure()`가 그대로 참조하고 있어(스코프 밖) `ReferenceError`가 났고, 이 예외가 `Promise.all(...).then()` 체인을 타고 올라가 "수급 데이터를 불러오지 못했어요"로 뭉뚱그려 보였다. `shortSignal` 판정(`if (shortSignal.key === 'none' && crossedAbove(20))`)이 5일선 회복 신호가 없는 대부분의 종목에서 실행되는 조건이라 "특정 종목이 아니라 거의 모든 종목이 실패"로 보였던 것도 이걸로 설명된다. `swingWaveStructure()` 자신의 `ma`/`closes`를 쓰는 동일 로직의 `crossedAbove`를 그 함수 안에 새로 정의해 해결했다. `test/test_ui_ia.py` 97건, 전체 회귀 334건, JS 문법 검사 통과.

**2026-08-20(2차) 종목분석 수급 실패 원인 문구 - resolve된 {error:...} 응답도 포착**: 1차 수정(실패 메시지를 `err.message`로 화면에 노출) 배포 후에도 재현 리포트("그래디언트" 검색)에서 괄호 안 원인 문구가 안 떴다. 원인은 `fetchFlow`/`fetchFlowChart`의 실패 경로 중 일부가 예외를 던지지 않고 `{error:...}`/`{detail:...}` 모양 JSON을 정상 응답(resolve)으로 그냥 돌려준다는 것 - 예를 들어 VM이 실패해 재시도까지 던졌지만 그 다음 네이버 GAS 폴백이 200으로 응답하면서 body가 `{error:...}`인 경우, `.catch()`는 전혀 안 걸리고 `.then()`으로 정상 진행되어 1차 수정이 심어둔 `err.message` 캡처를 놓쳤다. `search()`/`loadSignalSummary()` 두 경로 모두 `.then()` 단계에서도 응답의 `.error`/`.detail` 필드를 같이 확인해 `flowErr_`/`chartErr_`에 담도록 보강했다. `test/test_ui_ia.py` 97건, JS 문법 검사 통과.

**2026-08-20 종목분석 수급 "불러오지 못했어요" 에러에 실패 원인 문구 추가**: "종목 > 종목분석에서 모든 종목이 다 안 된다"는 리포트를 받았다. VM `/foreign-flow/{code}`와 GAS `?action=flowChart`를 직접 호출해보면 둘 다 정상 응답하는데도(실측 확인: 005930), 실제 페이지의 `js/foreign-flow.js`는 둘 다 실패한 것으로 처리해 항상 "수급 데이터를 불러오지 못했어요"만 표시했다 - VM 직접 호출은 CORS 제한이 없어 원인 재현이 안 되지만, 페이지의 실제 `fetch()`는 CORS(`ghlee.tistory.com`만 허용)에 걸릴 가능성이 있다. 두 호출 모두 실패를 조용히 `null`로 흡수하고 있어(위젯 전체가 죽지 않도록 하는 기존 설계) 실제 실패 사유(CORS 차단/타임아웃/네트워크 오류 등)가 화면에 전혀 안 남아 원격으로 원인을 좁힐 방법이 없었다. `search()`/`loadSignalSummary()` 두 조회 경로에서 `flowPromise`/`chartPromise`의 실패 메시지(`err.message`)를 변수에 남겨뒀다가, 최종적으로 정말 아무 것도 못 그릴 때만 기존 에러 문구 아래에 작게 덧붙이도록 했다(성공 경로·기존 폴백 동작은 변경 없음). 다음 재현 시 화면에 뜨는 괄호 안 문구로 원인을 바로 좁힐 수 있다. `test/test_ui_ia.py` 97건, 전체 회귀 334건, JS 문법 검사 통과. `js/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-20 증시온도 카드 보기 종목 시세 실시간 WebSocket 처리**: "시장 > 증시온도 > 카드 > 종목"을 실시간으로 처리해달라는 요청을 받았다. 증시온도 위젯의 "카드 보기" 탭(`js/market-temp.js` → `js/sector-dashboard-v4.js`의 `SD.renderCardsHtml`)은 최초 GAS 배치 조회 1회 후 갱신이 전혀 없었다 - 카드를 다시 열거나 새로고침해야만 최신 시세가 보였다. `js/watchlist.js`·`js/home-realtime-table.js`가 이미 쓰는 실시간 체결가 소켓(`wss://goodbyestar.cloud/ws/quotes`)을 그대로 재사용해, 카드에 그려진 종목코드를 구독하고 가격·등락률만 자리에서 갱신하도록(카드 재조립 없음) `sector-dashboard-v4.js`에 `SD.startCardRealtimeQuotes`/`stopCardRealtimeQuotes`를 추가했다. 재연결은 `home-realtime-table.js`와 동일한 지수 백오프(1.5초~30초) + 세대(generation) 검증 패턴을 따르고, 탭 비활성/복귀 시 소켓을 정리·재연결한다. `renderCardsHtml`이 만드는 `.sector-row`에 `data-code`를 추가해 갱신 대상을 찾으며, 같은 종목이 여러 섹터 카드에 중복 등장하는 경우 `querySelectorAll`로 전부 갱신한다. `market-temp.js`는 카드 렌더링 직후 이 구독을 시작하고, 섹터 편집 저장·취소로 카드가 다시 그려질 때도 새 목록으로 재구독한다(내부에서 기존 연결을 먼저 정리). 히트맵 보기·시총비례 히트맵 탭과 `#sector-dashboard` 자체(비운영 테스트 전용 진입점)는 이번 범위에 포함하지 않았다. `test/test_ui_ia.py` 97건 포함 전체 회귀 테스트(fastapi 설치 후 374건) 통과, JS 문법 검사 통과. `js/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-20 모바일 종목검색 플로팅 버튼·하단 앱 탭바 겹침 수정**: "모바일에서 배너랑 종목검색이랑 겹쳐서 보인다" 리포트를 받았다. 우하단에 떠 있는 종목검색 플로팅 버튼(`.ssp-wrap`, `js/stock-search-panel.js`)이 720px 이하 모바일에서 `bottom: 66px`로 고정돼 있는데, 같은 폭에서 나타나는 앱형 하단 탭바(`.mobile-app-bottom-nav`, 높이 `78px + safe-area`, z-index 1200)보다 낮게 있어 버튼 하단이 탭바에 가려 겹쳐 보였다. 2026-08-13에 같은 탭바 문제를 겪었던 홈 장 전환 카운트다운 배지(`.home-switch-countdown`)와 동일하게 `bottom: calc(78px + env(safe-area-inset-bottom) + 10px)`로 탭바 위로 띄우는 규칙을 `css/stock-search-panel.css`에 추가했다(탭바가 나타나는 720px 이하로 브레이크포인트를 맞춤). `js/`·`css/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-20 휴장 탭 검은 깜박임·헤더 검색창 하단 구분선 겹침 수정**: 두 가지 화면 버그 리포트를 수정했다. (1) "휴장 눌렀을 때 검은색 무늬 한번 깜박이고 제대로 된 창 나와" - 주간 리포트의 황소·곰 심리 아이콘 SVG가 `stroke="currentColor"`로 색을 상속받는데, 실제 색은 휴장 탭을 열 때에야 동적으로 삽입되는 `css/home-weekly-report.css`에서만 정해져 있어, 스타일시트가 도착하기 전 브라우저 기본색(검정)으로 먼저 그려졌다가 빨강/파랑으로 바뀌는 깜박임이 있었다. 래퍼 div에 같은 색을 인라인 `style`로도 넣어 외부 CSS 도착 전에도 첫 페인트부터 올바른 색이 나오게 했다. (2) "상위 종목검색 하단 검은색 줄이 뒤에 구분선과 겹쳐" - 헤더 검색창(`​.navbar .nav-search-input-wrap`)의 `min-height`가 64px로 `.navbar` 자체 높이(56px)보다 커서, 검색창 하단 실선(underline)이 navbar 밖으로 흘러넘쳐 바로 아래 상단 메뉴바(`.sidebar-left`)의 `border-top`과 겹쳐 두꺼운 검은 줄처럼 보였다. `min-height`를 50px로 줄여 navbar 안에 완전히 들어오도록 했다. 두 회귀 테스트를 추가했고 전체 테스트 335건 중 334건 통과(기존 fastapi 미설치 오류 1건 제외), JS 문법 검사 통과.

**2026-08-20 국내시장지표 스크립트 캐시 버전 누락 수정**: `js/kospi-futures.js`가 `domestic-market-indicators.js`를 불러올 때 붙이는 캐시 버스팅 버전이 `20260817-dmi-futures-chart-v1`에 고정된 채로, 이후 이 파일 내용을 바꾼 여러 커밋(국내시장지표 섹션 평탄화, 캔들차트 복원, 시장뉴스·실시간지표 레이아웃 정리 등)이 반영돼도 로더 버전은 갱신되지 않았음을 확인했다. 이미 이 URL을 캐시해둔 브라우저는 최신 코드를 못 받고 있었을 수 있어 로더 버전을 `20260819-dmi-cache-fix-v1`로 올리고, 관련 회귀 테스트를 최신 값으로 맞췄다. 전체 회귀 테스트 통과(기존 fastapi 미설치 오류 1건 제외).

**2026-08-20 미국 실시간 종목판 시가총액·회사명 공통 보강**: 거래대금·거래량 순위 응답에는 종목코드와 시세만 있고 시가총액(`tomv`)·정식 영문명이 빠지는 경우가 있어 `MRNA`처럼 표시명과 시가총액이 `-`로 남았다. 시가총액 순위 응답을 종목코드 기준으로 다른 순위 탭에도 병합해 `Moderna Inc`와 시가총액을 공통 표시하도록 수정했으며, 회사명 문자열이 아니라 티커를 조인 키로 사용했다. 단위테스트로 회귀를 확인했다.

**2026-08-19 휴장 지면 다음 주 준비 문구 추가**: 휴장 안내의 하단 문구를 단순한 데이터 갱신 안내에서 `다음 주 시장을 준비하는 시간입니다`로 바꾸고, 다음 거래일 데이터 업데이트·관심종목 일정 안내를 함께 표시하도록 정리했다.

**2026-08-19 휴장 지면 하단 시장 화면 숨김 보정**: 휴장 지면은 열렸지만 Tistory 스킨의 body id가 달라 CSS 선택자가 적용되지 않아 미국시장·경제뉴스가 아래에 남던 문제를 수정했다. 휴장 상태에서 시장 그리드·실시간 종목판을 DOM `hidden`으로도 직접 제어하고 body id 의존 CSS를 제거했으며, 정적 자산 캐시 버전을 갱신했다.

**2026-08-19 메인 휴장 탭 전환 복구**: `home-widgets.js`가 홈 위젯 레이아웃을 재구성할 때 `home-closed-page`를 보존하지 않아, 휴장 버튼 클릭 후 이벤트는 실행되어도 표시할 휴장 지면이 사라지는 문제를 수정했다. 휴장 지면을 시장 위젯 그리드 바깥에 유지하고 `home-widgets.js` 캐시 버전을 갱신했으며, 관련 UI 계약 테스트와 JavaScript 문법 검사를 통과했다. 운영 커밋 `fd1c315`, GitHub Pages 정적 자산 반영 및 `/health` HTTP 200을 확인했다.

**2026-08-19 Tistory 글쓰기 카카오 로그인 경로 수정**: 우측 상단 연필 버튼이 `manage/newpost/`를 `openArticleModal()`의 iframe 안에서 열어 Tistory가 카카오 로그인으로 리다이렉트할 때 인증 흐름이 막힐 수 있던 문제를 확인했다. `skin.html`의 연필 링크를 직접 관리자 글쓰기 주소로 바꾸고, 이미 설치된 이전 스킨 HTML에도 적용되도록 `js/skin-shell.js`가 기존 `onclick`을 제거한 뒤 최상위 창(`window.top`)으로 이동시키게 했다. 인증 페이지를 iframe에 넣지 않으며, 관련 UI 계약 테스트와 JavaScript 문법 검사를 추가했다. 운영 커밋 `fa6b4ab`.

**2026-08-19 홈 휴장 지면·시장 전환 보강**: 주말에 국내·미국 시세 화면 대신 미리 만든 휴장 안내 지면을 자동 표시하도록 홈 시장 선택에 `휴장` 탭과 `home-closed-page`를 추가했다. 토·일 KST 자동 판정, 금요일 화면을 열어 둔 채 자정을 넘긴 경우의 자동 전환, 월요일 자동 시장 복귀를 지원한다. 실사용 화면에서 `휴장` 클릭 후 미국시장 화면이 남는 경로가 확인되어 API 응답을 기다리지 않고 클릭 핸들러가 휴장 지면을 즉시 적용하도록 보강했으며, 구형 WebView에서 `CustomEvent`가 실패해도 직접 화면 동기화가 되도록 예외 경로를 추가했다. 운영 최종 커밋 `fd5cfb9`, `/health` HTTP 200, Pages 정적 JS 반영을 확인했다.

**2026-08-19 국내 실시간 종목판 필드 보강**: 국내 실시간 종목판의 거래증가율·거래회전율·거래대금회전율 및 52주 고가·저가 필드 매핑을 보정하고, 거래대금 옆에 시가총액을 표시했다. KIS 응답의 snake/camel case 차이를 프론트 어댑터에서 흡수하며 기존 순위 탭·모바일 가로 스크롤·휴장 빈 데이터 처리는 유지했다. 운영 반영 커밋 `18127cb`, `56e1810`.

**2026-08-17~18 홈·뉴스·전략·호가창 후속 정리**: 경제 종합뉴스 행 높이를 속보 행과 맞추고 빈 속보 영역은 숨겼으며, 관심종목 주간 공시 하단 중복선을 제거하고 공시 레일을 정리했다. 홈 시장 요약의 주도·주의 업종과 미국 장외 상태 표시를 보강하고, 미국 실시간 종목판에서 데이터가 없는 거래량 급증·체결강도·신고가·신저가 탭을 숨겼다. 전략검색은 탭·필드 정렬·배당 정보 모달을 정리했고, 종목검색 호가창은 기본 2패널을 유지하면서 폭 조절과 좁은 호가창을 지원하도록 보강했다. 미국 시세 등락 방향 정규화와 시장 요약 업종 데이터도 함께 반영했다.

> 2026-08-20 note: 아래 4개 항목은 당시 작업이력 기록이 누락되어 커밋 로그를 근거로 소급 작성했다.

**2026-08-19 미국 시장 섹터 요약 추가**: 미국 시장 섹터별 요약 데이터를 새로 채우고, 지수가 하락하는 구간에서도 상대적으로 강세인 섹터를 함께 보여주도록 했다. `scripts/cloud-vm/market_board.py`에 섹터 집계 로직을 추가했다.

**2026-08-18 추세 전환 신호·단계별 후보 추가**: 종목분석·watchlist에 추세 구간(trend horizon)과 5일 회복 신호를 추가하고, 단계별 추세 전환 후보를 새로 도입했다. 주요 로직은 `scripts/cloud-vm/swing_model.py`에 들어갔고 `foreign-flow.js`·`watchlist.js`·`daily_scan.py`·`weekly_report.py`가 함께 조정됐다.

**2026-08-17 국내지수 캔들차트 복원 및 종목 로고 표시 추가**: 국내지수 차트가 표준 캔들스틱이 아닌 형태로 바뀌어 있던 것을 원래대로 복원했다. 실시간 시세·종목분석·종목검색 등 종목 화면 전반에 종목 로고 표시를 추가했다. 미국주식 관련뉴스 열 배치, 모바일 배당 경고 행, 정규장 외 시간 라벨도 함께 정리했다.

**2026-08-17 홈 화면 에디토리얼 리디자인**: 홈을 카드형 위젯 나열에서 경제지 스타일의 에디토리얼 레이아웃으로 개편했다. 이어서 정보 밀도를 낮추고 주요 기사를 강조했으며, ETF·배당 카드를 랭킹 테이블로 교체하고, 국내시장지표 섹션 구조를 평탄화했다. 모바일에서 뉴스 흐름이 겹치던 문제와 브리핑 폭 문제를 함께 수정했다.

**2026-08-17 차트검색 빈 스냅샷 캐시 방지**: 실제 `patternScan=1` GAS 응답에는 `scannedAt`과 스캔 결과가 정상인데도 이전 빈 응답이 브라우저 캐시에 남으면 결과 없음 문구가 계속 보일 수 있어, 차트검색 목록 요청에 timestamp query를 붙여 최신 VM 일일 스냅샷을 확인하도록 했다. 현재 스캔 구조가 GAS 수동 실행이 아니라 VM `daily_scan.py`라는 점에 맞춰 안내 문구도 수정하고 UI 회귀 테스트를 추가했다.

**2026-08-17 실시간 종목판 업종 TOP 열 너비 보정**: 업종 TOP 집계표가 좁은 화면에서 업종명·대표 종목을 충분히 보여주지 못하던 문제를 확인해, 업종 탭이 활성화된 데스크톱에서만 표 전체 폭을 사용하고 업종명 34%·평균등락률 14%·거래대금 15%·종목 수 10%·상승비율 13%·대표 종목 14%로 열 비중을 조정했다. 다른 순위 탭과 모바일 가로 스크롤 동작은 유지했으며 CSS 캐시 버전을 갱신했다.

**2026-08-17 블로그 전체 경제신문·리서치 디자인 시스템 적용**: 데이터·API·분석 로직은 변경하지 않고 전역 폰트·색상 토큰을 정리했다. 제목·뉴스·해석은 MaruBuri, 일반 UI·본문은 Nanum Gothic, 숫자·시세·테이블은 Malgun Gothic/system-ui로 역할을 분리하고, 배경·상승/하락 색·얇은 규칙선을 공통화했다. 홈·경제 종합뉴스·시장지표·실시간 종목판·ETF/배당·종목분석·캘린더·커뮤니티의 공통 패널에서 과한 그림자·둥근 모서리·민트/네온 요소를 줄이고 뉴스 타임라인·탭·테이블 위계를 통일했다. Tistory 스킨의 정적 CSS 캐시 버전을 갱신했으며 데스크톱·390px 브라우저 검수에서 수평 넘침과 콘솔 오류가 없고, UI 77건·전체 회귀 347건 및 JavaScript 문법 검사를 통과했다.

**2026-08-17 차트검색기 저점상승형 개별 가격 구조 표시**: 저점상승형 결과 행에서 반복되던 공통 해석문을 제거하고, 상단 조건 설명에만 공통 판정 기준을 남겼다. 기존 스캔에 사용한 최근 20거래일 종가·스윙 저점·저항·현재 위치를 결과 캐시에 함께 저장하고, 프론트는 종목별 실제 미니차트와 직전/최근 저점 마커, 저점 상승률·최근 저점 이후 변화율·저항까지 거리를 `개별 관측`으로 표시한다. 추가 OHLC 호출은 없으며 390px 모바일에서 관측 문장을 행 전체 폭으로 배치했다. 기존 검출·필터·정렬 로직은 변경하지 않았고 전체 테스트 342건과 브라우저 데스크톱·390px 검수를 통과했다.

**2026-08-17 종목분석 차트 흐름별 탐색 개편**: 종목분석 검색 첫 화면을 기존 점수·별점 중심 목록에서 `상방 변곡 감지`·`상승 추세 재개`·`상승 추세 지속`·`수렴·압축`·`하방 변곡 감지`·`하락 추세 지속` 6개 차트 흐름을 탐색하는 화면으로 전환했다. 기존 swing assessment의 대·중·소 파동과 최근 이벤트를 새 판정식 없이 흐름 그룹으로 매핑하고, 거래대금·거래량·위험·현재 위치를 한 행에 표시한다. 업종별 교차 보기와 24개 단위 더 보기, 모바일 390px 레이아웃을 추가했으며, GAS는 기존 투자시그널 응답에 `swingScan.flowGroups`를 병행 전달한다. 전체 테스트 342건, JavaScript/Python 문법 검사를 통과했다.

**2026-08-17 종목분석 224일선 원복 확인 및 새로고침 검은 띠 FOUC 차단**: 종목분석 가격 차트는 5·20·60·224일선을 유지한다. 새로고침 때 잠깐 보이는 검은 영역은 폐기된 빈 `market-ribbon`이 외부 CSS/JS보다 먼저 페인트되는 문제로 분리해, 스킨 head의 즉시 숨김 규칙과 CSS 캐시 버전 갱신으로 차단했다. 224일선 표시 상태와 FOUC 회귀 계약 테스트를 함께 유지한다.
**2026-08-16 다음 주 뜨거워질·차가워질 후보 추가**: 지난주 결과인 뜨거운·차가운 종목과 구분해, 다음 주 후보를 별도 표시한다. KIS/키움이 이미 반환한 상승·하락 방향에 거래량 증가·거래량 급증·매수체결강도·거래대금·회전율 등 독립 신호가 하나 이상 겹친 종목만 후보로 선정하고, 후보 점수 자체보다 실제 근거를 문장으로 보여준다. 추가 API 호출 없이 기존 병렬 주간 리포트 응답에서 계산하며, 기존 VM 주간 스냅샷 버전도 올려 이전 응답이 후보 필드를 가리는 일을 막았다.

**2026-08-16 주말 리포트 곰장 샘플 및 자동 판정 복귀**: 황소·곰 라인아트 비교를 위해 심리 표시를 잠시 `곰장 · 하락`에 고정해 실제 화면에서 확인한 뒤, 강제 플래그를 제거하고 지수 등락률 합산 기반 자동 판정으로 복귀했다.

**2026-08-16 주간 리포트 자산 카드 중복 제거**: 주간 리포트의 개별 카드 영역에서는 코스피·코스닥·나스닥·S&P500만 유지하고, WTI 원유·금 선물·미국 10년 국채·비트코인 카드 행을 제거했다. 네 자산의 주간 등락률은 상단 `주간 지수·자산 요약`에 그대로 남겨 핵심 수치는 유지하면서 중복과 세로 공간 낭비를 줄였다.

**2026-08-16 주간 리포트 종목 사유 강조**: 주말 통합 리포트의 뜨거운 종목·차가운 종목에 표시되는 변동 사유 문장을 굵게 처리해 종목명·현재가·등락률과 구분하면서도 핵심 원인을 빠르게 읽을 수 있도록 했다. PC와 모바일에 동일하게 적용하고 스타일·스크립트 캐시 버전 및 회귀 검사를 갱신했다.

**2026-08-16 MY 색상·전체화면 RSI·증시온도·주말 황소 표시 보정**: MY 선택 종목명의 색을 평단 대비 평가손익이 아니라 당일 등락률 기준으로 통일해 상승=빨강·하락=파랑 전역 규칙을 적용하고, snake_case 시세 필드와 쉼표·퍼센트·유니코드 마이너스가 포함된 숫자도 안전하게 해석한다. 실시간 시세 차트는 다시 그릴 때 남던 RSI 라벨을 제거하고 비동기 렌더 세대가 뒤섞이지 않게 해 전체화면 상단 이동평균 범례와 겹치지 않도록 했다. 증시온도 카드 편집 후 이미 열어본 일반 히트맵도 다음 전환에서 개인 구성으로 다시 그리며, 시장 전체 고정 풀인 시총비례 히트맵은 개인 편집과 분리된다는 동작을 코드에 명시했다. 주말 황소·곰 SVG에는 CSS 로드 전에도 적용되는 크기·투명 채움·선 색상 속성을 넣어 새로고침 순간 검은 대형 SVG가 번쩍이는 현상을 막았다. 로컬 전체화면 실측에서 RSI 라벨 1개와 하단 재배치를 확인했고, MY +7.43% 빨간색 및 황소 SVG 104×52·fill none을 확인했으며 전체 회귀 테스트 306건을 통과했다.

**2026-08-16 마켓브리핑 공유 버튼 표시 통일**: 마켓브리핑 글 자체에는 모두 공유 버튼이 있었지만, 홈 대표·작은 카드와 카테고리의 제목형·3열·2열 레이아웃 CSS가 버튼을 각각 숨기고 있어 무작위 카드 배치에 따라 보였다 사라지던 문제를 수정했다. 모든 카드형에서 공유 버튼을 유지하고, 공간이 좁은 제목형 목록은 더 보기 버튼 대신 작은 공유 버튼만 표시한다.

**2026-08-16 과거 시뮬레이션 현재가 표시 추가**: 과거 시뮬레이션 상단 요약을 `기준일 → 현재가 → 평가금액 → 수익률` 순서로 정리했다. 현재가는 재생 중인 기준일의 종가로 매 프레임 갱신되며, 처음부터 버튼을 누르거나 투자금을 바꿔 초기화하면 최초 거래일 종가로 함께 돌아간다.

**2026-08-16 종목분석 매물대 UI 간소화**: 매물대를 건물·창문·지하층·헬리콥터로 표현하던 복잡한 일러스트 대신, 인접 가격 구간을 12개로 압축한 가로 거래량 막대 차트로 교체했다. 현재가·최대 매물대·평균단가를 상단 요약으로 분리하고 차트에는 현재·평균·최대 표식만 남겼으며, 현재가와 최대 매물대의 관계도 한 줄로 안내한다. 실제 체결가 기반 데이터와 일봉 근사치 폴백, 반영 기간 및 출처 표시는 그대로 유지한다. PC 로컬 화면 검증과 JS 문법 검사, 전체 회귀 테스트 293건을 통과했다.

**2026-08-15 미국 실적 캘린더 티커 대신 회사명 표시**: Finnhub 실적 이벤트가 `company`를 내려주고도 프론트가 제목의 `$AAPL`만 굵게 표시하던 구조를 확인했다. 서버 이벤트에 회사명을 별도 필드로 보존하고, 캘린더에는 `Apple Inc. (AAPL)` 형식으로 표시하도록 변경했다. 기존 localStorage 이벤트도 제목에 이미 포함된 `· 회사명`을 복구하며, 국내 일정은 기존 종목명 표시를 유지한다. 캘린더 스크립트 캐시 버전을 갱신하고 백엔드·UI 회귀 테스트를 추가했다.

**2026-08-15 모바일 반응형 메뉴·시장차트·종목검색 정리**: 모바일 하단 앱 메뉴와 상단 메뉴를 모두 유지하되 상단 메뉴의 높이·글자·간격을 줄이고 가로 스크롤 가능한 앱형 탭으로 정리했다(PC 규칙은 유지). 국내시장지표의 코스피·코스닥 현물 차트는 모바일에서 선물 차트와 같은 제목→조작 탭→차트 흐름, 단일 열, 330px 차트 높이로 통일했다. 모바일 본문은 한글 단어 단위 줄바꿈을 사용하고, 차트검색·전략검색 종목 라벨은 2열 카드·말줄임으로 압축했다. 스킨·국내시장지표 CSS 캐시 버전도 갱신했다. 로컬 모바일 뷰포트에서 차트검색 2열과 전략검색 2열을 확인하고 UI 회귀 테스트를 추가했다.

**2026-08-15 RSI 오버레이 잔상 및 거래량 패널 크기 수정**: 차트를 이동·확대할 때 RSI 색칠 캔버스가 새 시간축 좌표로 다시 그려지지 않아 이전 위치의 붉은 영역이 잔상처럼 남던 버그를 수정했다. 시간축 이동·확대와 pane 높이 변경 이벤트마다 RSI 오버레이와 라벨 위치를 다시 계산한다. 거래량·RSI 기본 서브패널 비율도 각각 16%/최소 58px에서 20%/최소 82px로 키워 기본 상태에서도 거래량이 보이도록 했다.

**2026-08-15 일목균형표 선행스팬 색상·구름 스타일 통일**: 실시간 시세·종목분석·패턴검색 차트의 일목균형표를 선행스팬1·2 모두 `#4dabf7` 파란색 선으로 통일했다. 상승/하락에 따라 빨강·파랑이 바뀌던 구름을 제거하고, 선행스팬 사이에는 테두리 없는 옅은 파란색 면만 표시한다.

**2026-08-15 실시간 차트 RSI 네이티브 범례 위치 수정**: RSI 시리즈의 `title`과 `lastValueVisible` 때문에 RSI 이름·값이 가격 패널 상단 이동평균 범례에 섞여 보이던 문제를 확인했다. RSI 시리즈의 네이티브 제목·마지막 값 배지를 끄고, 아래 RSI 패널의 사용자 지정 `RSI(14)` 라벨만 사용하도록 수정했다.

**2026-08-15 실시간 RSI·종목분석 차트 표시 정리**: 실시간 시세 차트의 RSI를 50 기준 빨강·파랑 두 선에서 첨부 화면과 같은 검정 단일선으로 변경하고, 70 이상·30 이하에서만 RSI 선과 기준선 사이를 반투명 색상으로 채우도록 했다. RSI 계산부에서 더 이상 쓰지 않는 MACD 계산도 제거했다. 종목분석 차트 범례에서 실제 표시되지 않는 `뉴스`와 `패턴·거래`를 삭제하고, 골든·데드·거래량 급증 마커도 제거했다. `foreign-flow.js` 캐시 버전을 갱신했으며 전체 테스트 267건과 JS 문법 검사를 통과했다.

**2026-08-15 VM 운영 보안·장외 유지보수 2차 개선**: 기존 장외 유지보수가 앱 로그 상한과 DB 정리만 수행하고 VM OS 로그는 방치하던 부분을 보완했다. `maintenance.py`가 주말 새벽에 비대화식 `sudo -n`으로 현재 syslog 계열 파일을 비우고 `/var/log` 바로 아래 회전·압축 로그를 삭제하며, systemd journal을 14일·500MB 상한으로 vacuum한다. root 권한이나 sudo 허용이 없으면 실패 처리해 날짜 마커를 남기지 않고 다음 회차에 재시도한다. 기존 앱 로그 10,000줄 상한, 뉴스·매물대 보존 정리, SQLite WAL 체크포인트는 유지한다.

**2026-08-15 VM 운영 보안·장외 유지보수 1차 개선**: VM FastAPI가 외부 공급자 예외 원문을 502 응답에 그대로 넣던 경로를 안전한 사용자 메시지로 바꾸고, 실제 예외 타입만 서버 로그에 남기도록 공통 변환기를 추가했다. `maintenance.py`를 신설해 새벽 03:00~05:00 KST에 로그 4종을 10,000줄로 제한하고, 뉴스 모멘텀 90일·매물대 200일 보존 정리, SQLite WAL 체크포인트·`PRAGMA optimize`를 수행하게 했다. 뉴스 DB 삭제 전 `backup_sqlite.py`로 최근 7개 백업을 유지한다. 기존 5분 `deploy_check.sh`가 별도 lock·KST 날짜 마커로 하루 한 번 유지보수를 백그라운드 실행하며, 중복 폴러 실행부는 `polling.py` 공통 루프로 일부 통합했다. Google Calendar 브라우저 키 항목은 사용자 요청대로 변경하지 않았다. 전체 테스트 265건 통과.

**2026-08-15 실시간 시세 RSI 과매수·과매도 영역 색상 표시**: RSI 해석을 쉽게 볼 수 있도록 실시간 시세 차트 RSI 패널에서 70 이상 구간은 옅은 빨강, 30 이하 구간은 옅은 파랑으로 배경을 칠했다. Lightweight Charts v5의 개별 패널 배경 밴드 기능이 없어 RSI 시리즈의 70·30 좌표와 실제 패널 높이를 읽는 캔버스 오버레이로 구현했으며, 전체화면·리사이즈에도 다시 그린다. 기존 RSI 빨강/파랑 선과 70·50·30 기준선은 유지했다.

**2026-08-15 실시간 종목판 원화 조 단위 10배 표시 오류 수정**: 삼성전자 시가총액이 `16048조`로 보이고 거래대금도 `107.2조`로 실제보다 10배 크게 표시된다는 제보를 확인했다. `js/home-realtime-table.js`의 원화 조 단위 변환이 `1조=10^11원`으로 잘못 작성돼 있었던 것이 원인이며, 한국식 단위인 `1조=10^12원`으로 기준값과 나눗셈을 함께 수정했다. 삼성전자 시가총액은 키움 원자료 `16,048,035억원`이 정상적으로 `1,604.8조원`으로 표시되도록 고쳤고, 거래대금도 같은 방식으로 정상화했다.

**2026-08-15 종목분석·실시간 시세 차트 보조지표 정리**: 사용자가 종목분석 차트에서 뉴스가 무엇인지 바로 알기 어렵고, 보조차트의 MACD·RSI가 아래 RSI와 중복된다고 지적해 차트 뉴스 API 호출·뉴스 마커·뉴스 상세 영역을 제거했다. 종목분석 차트는 가격·거래량·외국인·기관 수급 패널만 남기고, RSI는 기존 하단 별도 섹션에서만 표시한다. 실시간 시세 차트는 Lightweight Charts가 실제로 적용한 패널 높이를 읽어 거래량 범례와 RSI 라벨을 각 패널 시작점에 다시 배치하도록 보강했으며, RSI 빨강/파랑 선은 각각 50 이상·50 미만 구간을 뜻한다. 의존 스크립트 캐시 버전도 `20260815-chart-cleanup`으로 갱신했다.

**2026-08-15 종목분석 차트 뉴스 마커 상세 확인 추가**: 차트에 `뉴스`라는 마커만 표시되어 어떤 기사인지 알 수 없던 문제를 개선했다. 차트의 뉴스 마커 또는 해당 거래일을 클릭하면 기사 제목·출처가 차트 아래에 표시되고 제목 클릭 시 원문으로 이동한다. 네이버 뉴스의 RFC 822 날짜 형식도 차트 거래일과 연결되도록 날짜 파서를 보강했으며, CSS/의존 스크립트 캐시 버전을 갱신했다.

**2026-08-15 국내시장지표 코스피·코스닥 차트 패널 테두리 제거**: 선물 차트처럼 코스피·코스닥 주간현물 차트도 주변 박스 테두리 없이 보이도록 `css/domestic-market-indicators.css`의 `.dmi-panel`을 `border: none`으로 변경했다. CSS가 브라우저에 남아 있지 않도록 국내시장지표 CSS와 JS 로더의 캐시 버전을 `20260815-dmi-panel-borderless`로 올렸고, UI 회귀 테스트에 테두리 제거 규칙을 고정했다.

**2026-08-15 코스피200 선물 차트 테두리 제거 + 참고의견 문장 축소**: 두 가지 요청. (1) 코스피200 주간선물·야간선물 차트 패널에 둘러진 회색 테두리 박스를 없애고 "그냥 차트만" 보이도록 해달라는 요청(첨부 화면 기준) - `css/kospi-futures.css`의 `.kf-chart`(라이트)·`html.dark .kf-chart`(다크) 규칙에서 `border`를 제거했다. (2) 직전 세션에서 사이트 전반 Groq 프롬프트를 "주의할 점 포함"으로 강화하며 코스피 선물 참고의견을 3~4문장→6~7문장으로 늘렸는데, 실제 출력이 너무 길고 장황하다는 지적(실제 출력 샘플에 한글 "분석" 대신 한자 "分析"이 섞여 나온 것도 함께 확인)을 받았다. `getKospiFuturesAnalysis` 프롬프트를 4~5문장으로 다시 줄이고 지시문도 "선물 시사점 한 문장+옵션 심리 한 문장+주의할 점 한 문장" 위주로 간결하게 정리했으며, "반드시 한국어로만(한자·중국어 금지)"을 명시해 문자 혼입을 방지했다. 옛 프롬프트로 만든 캐시가 남지 않도록 캐시 키 버전을 `v4`→`v5`로 올렸다. `test/test_ui_ia.py` 51건 회귀 없이 통과. `css/`는 GitHub Pages, `gas/ticker-proxy.gs`는 GitHub Actions(clasp)가 각각 master 반영 후 자동 배포한다.

**2026-08-14 사이트 전반 Groq AI 요약 상자 제목·아이콘 통일**: 위젯마다 AI 요약 상자 제목이 "참고의견"(코스피 선물·해외지표)/"종합 요약"(증시자금)/"요약"(홈 시황·종목뉴스)/"📰 시장 브리핑"(증시온도)으로 제각각이고 아이콘도 있다 없다 한다는 지적을 받았다. 가장 먼저 자리 잡은 "참고의견" + 말풍선 SVG 아이콘(`js/kospi-futures.js`·`js/overnight-market.js`가 이미 씀, 완전히 동일한 path)으로 통일했다 - `js/domestic-market-indicators.js`(증시자금)·`js/market-temp.js`(증시온도 브리핑)·`js/stock-news.js`(종목뉴스 요약)·`js/sector-dashboard-v4.js`(홈 시황)의 제목 문구를 "참고의견"으로 바꾸고 같은 아이콘을 추가했다. `test/test_ui_ia.py`에 아이콘 클래스·문구 존재를 고정하는 회귀 assertion을 추가. 같은 요청에 "투자자별 매매동향" 소제목 옆 "개인 · 외국인 · 기관" 부제도 제거했다.

**2026-08-14 국내시장지표 접기 - "선 그리기/지우기" 버튼만 안 사라지던 진짜 원인 발견**: `.dmi-tabs`에 `!important`를 걸어도 이 두 버튼만 계속 보인다는 재제보를 받아, 접힌 패널 안에서 이 버튼의 `getComputedStyle`/`offsetParent`를 직접 실측한 끝에 원인을 찾았다 - `js/dashboard-enhancements.js`가 모든 차트 위젯에 공통으로 넣는 "⛶ 전체 화면" 버튼 기능이, 준비 과정에서 `moveDrawingControlsBelowFullscreen()`으로 이 두 버튼을 `.dmi-tabs` **밖으로 물리적으로 꺼내** `.de-draw-controls`라는 새 형제 요소에 옮겨 담고 있었다. `.dmi-panel.dmi-collapsed .dmi-tabs`는 옮겨지기 전 위치만 가리키니 옮겨진 뒤엔 아무 효과가 없었던 것. 여러 위젯이 공유하는 `dashboard-enhancements.js`는 손대지 않고, `css/domestic-market-indicators.css`에 `.dmi-panel.dmi-collapsed .de-draw-controls { display: none !important; }`만 추가해 접힌 패널 안에 있을 때는 이 옮겨진 버튼도 같이 숨긴다.

**2026-08-14 증시자금 카드 숫자색이 실제로는 한 번도 안 보이던 버그 수정 + 평균 대비 색상으로 통일**: 카드 제목을 bold로, 숫자 색을 "높으면 빨강/낮으면 파랑"으로 해달라는 요청을 받아 확인하다가, 차익/비차익거래 카드에 이미 있던 `.dmi-fund-value.dmi-positive/.dmi-negative` 색 규칙이 `.dmi-shell .dmi-fund-card * { color:#000 !important }` 블록 규칙에 밀려 처음부터 한 번도 실제로 표시된 적이 없었다는 걸 발견했다(코드는 맞는데 항상 검은 글씨로만 보였음). 두 색 규칙에도 `!important`를 붙여 이기도록 고쳤다. 색 기준도 통일했다 - 기존엔 차익/비차익거래만 "순매수(+)/순매도(-)" 부호로 색을 정했는데, 신용잔고 같은 잔고형 값은 항상 양수라 부호 기준으로는 색이 전혀 안 갈렸다. 미니 그래프 선 색과 같은 기준(1년 평균 대비 높으면 빨강/낮으면 파랑)으로 6개 카드 전부 통일해서 값 색과 그래프 선 색이 항상 일치하게 했다(`avgCompareClass` 헬퍼로 통합).

**2026-08-14 사이트 전반 Groq AI 해설에 "주의할 점" 강화**: 증시자금 종합 요약이 숫자를 그냥 읽어주는 수준이라 "이러니까 뭘 주의해라/뭘 참고해라" 식으로 강화해달라는 요청을 받았다. 다만 특정 종목·상품을 "사라/팔아라"고 직접 권유하면 자본시장법상 무인가 투자자문업 규제에 걸릴 수 있어(공매도 압박 해설을 "단정하지 않는다"로 설계한 것과 같은 이유), 해석·주의점까지만 가고 직접 매수/매도 권유는 금지하는 공통 가드 문구(`GROQ_NO_ADVICE_GUARD_`)를 만들어 적용 대상 프롬프트 전체에 넣었다. 적용: `getDomesticFundsAnalysis`(증시자금)·`getKospiFuturesAnalysis`(코스피 선물 참고의견)·`getMarketAnalysis`(홈 시황)·`getMarketTempBriefing`(증시온도 브리핑)·`getSubIndexAnalysis`(보조지수, 3문장→4문장으로 늘려 마지막에 시사점 추가)·`summarizeStockNews`(종목뉴스 요약)에 "마지막 문장은 주의할 점/참고 포인트"를 명시적으로 요구하도록 프롬프트를 수정했다. `getFlowAiSummary`(종목분석 수급 요약판)는 이미 확정된 결론의 근거만 인용하도록 설계돼 있어("이 결론과 다른 의견을 새로 내지 마라") 대상에서 제외했고, `summarizePriceMoveReason`(50자 단문 "오늘 왜 이렇게 움직였나")도 성격이 달라 제외했다. `getSubIndexAnalysis`는 문장 수·순서를 엄격히 검증하는 `isSubIndexAnalysisValid_`가 있어 4번째 문장은 새 등락률 숫자를 안 쓰게 지시해 기존 검증(퍼센트 있는 문장엔 반드시 지표명 필요)을 그대로 통과하도록 했다. 프롬프트가 바뀐 6개 엔드포인트는 캐시 키 버전을 모두 올려 옛 프롬프트로 만든 캐시가 즉시 무효화되게 했다. `gas/ticker-proxy.gs`는 master 반영 후 GitHub Actions(clasp)가 자동 배포한다.

**2026-08-14 증시자금 카드 위에 Groq "종합 요약" 추가**: 신용잔고·고객예탁금·차익/비차익거래·신용대주잔고·예탁증권담보융자 6개 카드 숫자를 사용자가 직접 해석해달라고 요청받아 답한 뒤, 매번 이렇게 해석해줄 게 아니라 화면에 상시 붙어 있는 AI 요약으로 만들어달라는 요청을 받았다. `js/kospi-futures.js`의 "참고의견"(Groq AI 해설)과 동일한 패턴으로 구현 - GAS에 새 액션 `?action=domesticFundsAnalysis`(`getDomesticFundsAnalysis`)를 추가해 VM `/domestic-market-indicators` 응답 하나만을 소스로 삼아(화면 숫자와 어긋나지 않도록) 프롬프트를 만들고 Groq를 호출한다. 차익/비차익거래는 VM이 이미 계산해서 내려주는 20일/252일 평균을 그대로 쓰고, 신용잔고/고객예탁금/신용대주잔고/예탁증권담보융자는 GAS에서 프론트(js/domestic-market-indicators.js)와 동일한 평균 창(20일/252일)으로 series 원자료를 직접 평균 낸다. 각 지표가 최근 평균·1년 평균 대비 높은지 낮은지를 근거로 빚투 심리·매수 여력·프로그램매매 동향을 4~5문장으로 종합하도록 프롬프트를 짰다. 프론트는 "증시자금" 소제목과 카드 그리드 사이에 "종합 요약" 박스(`#dmiFundsAi`, 데이터 없으면 숨김)를 추가해 GAS 응답을 그대로 표시한다. 30분 캐시(GAS 스크립트 캐시), 실패 시 2분 뒤 재시도. `gas/ticker-proxy.gs`는 master 반영 후 GitHub Actions(clasp)가 자동 배포한다.

**2026-08-14 국내시장지표 차트 접기 버튼 진짜 근본 원인 수정 - closest()가 버튼 자신에게 걸림**: 캐시 버전·0×0 차트 문제를 차례로 고쳤는데도 "접기 버튼 동작 안 함"이 계속 재현돼 사용자와 함께 여러 차례 콘솔 진단(`elementFromPoint`, before/after class 비교 등)한 끝에 진짜 원인을 찾았다. 접기 버튼(`<button class="dmi-collapse-btn" data-dmi-panel="KOSPI">`)과 그 바깥 패널(`<section class="dmi-panel" data-dmi-panel="KOSPI">`)이 우연히 같은 `data-dmi-panel` 속성을 갖고 있었는데, 클릭 핸들러가 `collapseButton.closest('[data-dmi-panel]')`로 패널을 찾다 보니 `closest()`가 "자기 자신부터" 검사하는 특성 때문에 버튼 자신이 걸려버렸다 - `dmi-collapsed` 클래스가 CSS가 실제로 보는 `<section>`이 아니라 아무 효과 없는 버튼 자신에게 계속 붙었다 떨어졌다만 반복한 것. 버튼엔 없고 패널에만 있는 `.dmi-panel` 클래스로 찾도록(`closest('.dmi-panel')`) 고쳤다. 로더 캐시 버전도 `20260814-collapse-fix2`로 다시 올렸다.

**2026-08-14 신용대주잔고·예탁증권담보융자 단위 버그 수정 - "24,715,600.8조원" 같은 불가능한 값 표시**: 방금 KOFIA 서비스키 등록 후 카드가 뜨자마자 "예탁증권담보융자 24715600.8조원"처럼 물리적으로 불가능한 값이 나온다는 스크린샷 제보를 받았다. `fetch_leverage_detail()`을 만들 때 같은 KOFIA 응답의 형제 필드인 `loan_total`(신용융자)이 백만원 단위인 걸 보고 `lending_total`(신용대주)·`collateral_loan`(예탁증권담보융자)도 같은 단위라고 별 검증 없이 가정했는데(`unit: 'million_krw'`), 실측 원자값을 그대로(원 단위로) 해석하면 각각 273억원·24.7조원으로 신용융자·예탁금과 비슷한 합리적 규모가 나오는 반면 백만원으로 보면 신용대주가 신용융자의 1000배가 되는 등 말이 안 됐다 - 같은 TR 응답 안에서도 필드마다 단위가 다른 경우였다. `unit`을 `'krw'`(원, 배율 없음)로 고쳤다. 공식 문서가 없어 이 결론도 실측값이 만드는 규모의 타당성으로 추론한 것(다른 KOFIA/키움 미문서화 필드들과 동일한 방식)이라는 점을 코드 주석에 남겼다. `test/test_domestic_market_indicators.py`에 unit 값을 고정하는 회귀 assertion을 추가.

**2026-08-14 국내시장지표 차트 접기 기능 실제 원인 수정 - 접힌 상태에서 만든 차트가 0×0으로 굳는 문제**: 캐시 버전 갱신 후에도 "숨기기 버튼 안된다"는 재제보를 받아 브라우저 콘솔로 같이 진단한 결과, 접기/펼치기 토글 자체(class·aria-expanded)는 정상 동작하는데 펼쳤을 때 차트 영역이 완전히 빈 화면으로 남는 게 실제 증상이었다. 원인은 `.dmi-chart`가 `display:none`(접힘)인 상태에서 lightweight-charts를 `autoSize:true`로 생성하면 크기가 0×0으로 굳어버려서, 나중에 펼쳐도 기존 코드가 `chart.resize()`만 호출해서는 되살아나지 않는 것이었다 - 같은 페이지의 `js/kospi-futures.js`(코스피200 선물 차트)는 이미 이 문제를 겪어서 펼칠 때마다 차트를 버리고 다시 만드는 방식(`destroyChart`+재생성)으로 대응해뒀는데, `domestic-market-indicators.js`의 접기 기능에는 그 대응이 없었다. (1) `renderCharts()`가 접힌 패널에는 애초에 차트를 만들지 않도록 건너뛰고, (2) 접기 버튼을 펼칠 때 기존 차트 인스턴스를 버리고 그 시점에 새로 만들도록 고쳤다(추가 API 호출 없이 `root._dmiData`에 이미 있는 데이터 재사용). `js/kospi-futures.js`의 로더 캐시 버전도 `20260814-collapse-fix`로 다시 올렸다.

**2026-08-14 국내시장지표 차트 접기 기능이 안 된다는 리포트 - JS 로더 캐시 버전 갱신 누락 수정**: "코스피·코스닥 주간현물 차트 접기가 안 된다"는 리포트를 받아 `js/domestic-market-indicators.js`의 접기 버튼 로직·CSS를 코드로 재확인했으나 로직 자체는 정상이었다. 원인은 `js/kospi-futures.js`가 이 파일을 동적으로 불러올 때 붙이는 캐시 버스팅 버전 문자열(`?v=20260813-fund-average`)이 어제 날짜에 박제돼 있었던 것 - 오늘(2026-08-14) 하루 동안 `domestic-market-indicators.js`를 여러 번 고쳤는데(증시자금 평균 그래프, 프로그램매매 날짜 재시도, 카드 문구, 신용대주잔고 추가 등) 이 로더의 버전 문자열은 한 번도 안 올려서, 이 URL을 이미 캐시해둔 브라우저는 오늘 고친 내용을 전혀 못 받고 있었을 수 있다. 버전을 `20260814-leverage-detail`로 올렸다 - 이 파일을 고칠 때는 앞으로 매번 이 로더의 버전 문자열도 같이 올려야 한다.

**2026-08-14 증시자금에 신용대주잔고·예탁증권담보융자 카드 추가 + 공매도·대차거래 카드에 절대수치 복원**: 두 가지 요청. (1) 증시자금에 신용대주잔고(공매도용으로 주식 자체를 빌린 잔고)·예탁증권담보융자(보유 주식 담보 대출)를 추가해달라는 요청 - KIS mktfunds(FHKST649100C0)에는 이 두 필드가 없어서, 증시온도 위젯이 이미 쓰고 있던 KOFIA 공공데이터(`public_data.fetch_kofia_market`)의 신용공여잔고추이에서 `lending_total`(신용대주)·`collateral_loan`(예탁증권담보융자)만 뽑아 새 함수 `fetch_leverage_detail()`로 추가했다. 2026-08-12에 "증시자금은 KIS 전용으로 고정, KOFIA fallback 제거"했던 것과는 성격이 다르다 - 그건 신용잔고/고객예탁금의 대체 공급자 제거였고, 이번은 KIS에 아예 없는 새 필드를 보충하는 것이라 신용잔고/고객예탁금(`_fetch_kis_funds`)은 그대로 KIS 전용을 유지한다(회귀 테스트로 고정). `fetch_kofia_market`의 `days` 상한을 90→400으로 올려 1년 평균 계산에 쓸 수 있게 했다(기존 `/kofia-market` 엔드포인트는 `Query(le=90)`로 그대로라 영향 없음). (2) 종목분석 "공매도·대차거래" 카드에서 "공매도가 얼마치, 몇 주라는 건지 모르겠다"는 리포트 - 2026-07-19에 "절대수치는 해석이 안 된다"며 뺐던 공매도 잔고 수량·대차잔고 수량을 추정 금액과 함께 다시 넣었다(증감률이 방향을, 절대수치가 규모를 보여주는 역할 분담). 대차잔고는 개별 체결가가 없어 현재가로 근사한 금액임을 라벨에 명시했다. `test/test_domestic_market_indicators.py`(신규 3건)·`test/test_ui_ia.py` 포함 회귀 없이 통과(fastapi 미설치 1건 제외, 기존 샌드박스 제약).

**2026-08-14 증시자금 차익/비차익거래 카드가 자정 이후·주말에 사라지던 버그 수정**: 1년 평균 그래프를 추가한 직후 배포한 것을 확인해보니 신용잔고·고객예탁금 2개 카드만 보이고 차익거래·비차익거래 2개 카드가 안 뜬다는 리포트를 받았다. 콘솔에서 직접 확인해보니 `programTrading.available: false`. 원인은 `_fetch_kiwoom_program_trading()`이 ka90007에 넘기는 `date` 파라미터를 항상 `datetime.now(KST)` "오늘" 하루로만 고정해뒀던 것 - `mktfunds`(신용잔고/고객예탁금)와 달리 이 TR은 지정한 그 하루 값만 주는 구조라, 자정을 넘긴 새벽이나 주말·공휴일처럼 그날 거래가 없으면 빈 배열이 오고 그대로 `available: false`로 폴백됐다(실제로 확인 시점이 KST 기준 토요일 새벽이었음). 최근 영업일을 찾을 때까지 하루씩 과거로 물러나며 재시도하도록 고쳤다 - 토·일요일은 API를 부르지 않고 건너뛰고(`backfill_program_trading_history.py`와 동일 판단), 평일인데 빈 배열이 오면(공휴일 등) 그 전날을 시도한다(최대 7일 소급). `test/test_domestic_market_indicators.py`에 "오늘"을 토요일로 고정해두고 직전 영업일(금요일)에서 값을 찾아오는지 확인하는 회귀 테스트를 추가해 전체 11건(이 파일 기준) 통과.

**2026-08-14 ETF 검색창 한글 입력 중 글자 씹힘 수정(재조정)**: 자모 분리 버그를 고친 직후 "한글 조합은 되는데 중간에 글자를 먹는다"는 재제보를 받았다. 원인은 `compositionend`와 그 직후 브라우저가 자동으로 보내주는 `input`(이때 `isComposing=false`) 이벤트를 둘 다 처리하고 있었던 것 - 한글 한 글자가 완성될 때마다 재렌더링이 두 번 겹쳐 일어났고, 그 사이 다음 키 입력이 오면 포커스 재조정 타이밍과 겹쳐 글자를 잃어버렸다. `compositionend` 리스너를 없애고 `input` 이벤트의 `isComposing` 체크만으로 단일화했다(MDN 권장 패턴). `test/test_ui_ia.py` 51건 회귀 없이 통과.

**2026-08-14 증시자금 4개 카드에 1년 평균 + 평균선 미니 그래프 추가**: 신용잔고·고객예탁금·차익거래·비차익거래 카드에 "최근 평균"(20일) 옆에 "1년 평균"(252영업일 근사치)을 추가하고, 값 추이 + 평균선을 그리는 미니 SVG 그래프를 넣었다. 지금 값이 평균보다 높으면 빨강, 낮으면 파랑으로 그래프 선 색을 바꾼다(사이트 공통 상승=빨강/하락=파랑 규칙을 "평균 대비"로 적용). 신용잔고/고객예탁금은 KIS mktfunds가 이미 한 번 호출로 여러 날을 주는 series를 그대로 활용해 상한만 90→400으로 늘렸다. 차익거래/비차익거래는 ka90007이 "오늘" 하루 값만 주고 과거 여러 날을 한 번에 안 줘서(2026-08-14 VM 실측), 새 모듈 `scripts/cloud-vm/program_trading_history.py`로 조회할 때마다 하루치씩 로컬에 누적 기록한다 - 배포 직후에는 그래프가 짧게 시작해서 매일 자동으로 길어지며, 즉시 채우고 싶으면 `backfill_program_trading_history.py`(1회성, 과거 영업일을 하루씩 조회해 미리 채움)를 VM에서 실행할 수 있다. 같은 요청으로 "비차익거래" 설명 문구도 "차익거래가 아닌 프로그램매매"라는 순환적 정의 대신 "여러 종목을 한 번에 묶어서 컴퓨터가 자동으로 사고파는 금액입니다(인덱스펀드·ETF 재조정 등)"로 더 직관적으로 바꿨다. `test/test_program_trading_history.py`(신규) 6건 포함 전체 217건 중 216건 통과(fastapi 미설치로 못 도는 `test_news_momentum` 1건 제외, 샌드박스 기존 제약).

**2026-08-14 ETF 검색창 한글(IME) 입력 시 자모 분리되는 문제 수정**: 방금 추가한 ETF 검색창에 한글을 입력하면 "헬스케어"가 "헤ㄹㅋ케ㅇㅓ"처럼 자모가 낱개로 흩어져 버린다는 스크린샷 제보를 받았다. 한글 등 조합형 입력은 자모를 하나씩 합쳐 완성되는데(`compositionstart`~`compositionend`), 조합이 끝나기 전에 매 입력마다 `renderCards()`가 검색창 DOM을 통째로 다시 그려서 브라우저가 조합 중이던 글자를 잃어버린 것 - 영문 검색은 조합 과정이 없어 문제없이 됐었다. `input` 이벤트에서 `event.isComposing`이면 재렌더링을 건너뛰고, `compositionend`에서 한 번만 검색어를 반영하도록 고쳤다. `test/test_ui_ia.py` 51건 회귀 없이 통과.

**2026-08-14 전략검색 ETF 수익률 상위에 ETF명/코드 검색창 추가**: 기간 탭(1개월·3개월·6개월·12개월) 오른쪽에 검색창을 추가해 ETF명·코드로 바로 찾을 수 있게 했다(사용자 스크린샷으로 지정한 위치). 입력하면 운용사별 카드 전체를 이름/코드 부분일치로 필터링 후 다시 그룹핑해서 보여주고, 일치 결과가 없으면 안내 문구를 띄운다. `renderCards()`가 매 입력마다 카드 영역 전체를 다시 그려서 검색창 DOM도 매번 교체되는데, 그대로 두면 타이핑 중 포커스·커서 위치가 날아가므로 입력 이벤트에서 커서 위치를 기억해뒀다가 재렌더링 후 새 입력창에 그대로 되돌려준다. `test/test_ui_ia.py` 51건 회귀 없이 통과.

**2026-08-14 전략검색 ETF 수익률 상위: 클릭 시 종목분석 대신 구성종목 모달**: ETF를 클릭하면 개별주식과 동일한 종목분석 페이지(`/page/foreign-flow`)로 이동하던 것을, ETF 카테고리에서만 실제 편입 종목·비중을 보여주는 모달로 바꿨다(저평가 종목·배당주는 기존 종목분석 이동 유지). 백엔드 `scripts/cloud-vm/main.py`에 `/etf-components/{code}`를 추가해 KIS ETF구성종목시세(`FHKST121600C0`, 국내주식-073)를 온디맨드 호출한다 - 이 TR을 저장소에서 처음 써서 정확한 필수 파라미터를 문서로 확인 못 했지만, VM 진단 스크립트(`probe_etf_components.py`, KODEX 200/069500, 정식 반영 후 제거)로 정상 응답(`rt_cd=0`)을 직접 확인한 뒤 반영했다(`FID_COND_MRKT_DIV_CODE=J`, `FID_COND_SCR_DIV_CODE=11216`). 편입비중은 자주 안 바뀌어 10분 메모리 캐시를 적용했고, 해외지수 추종 ETF처럼 구성종목이 없는 경우 안내 문구를 보여준다. 프론트 `js/strategy-search.js`의 `openEtfComponentsModal()`은 `document.body`에 오버레이를 붙이는 기존 `.de-chart-overlay` 패턴을 따른다. `test/test_ui_ia.py` 51건 포함 전체 210건(fastapi 미설치로 못 도는 `test_news_momentum` 1건 제외, 샌드박스 기존 제약) 회귀 없이 통과.

**2026-08-14 거래량 패널 막대 위치 고정 + 범례 재배치(3차)**: 범례를 패널 하단으로 옮긴 뒤에도 패널 리사이즈 구분선 근처에서 자리가 안 맞는다는 리포트가 계속됐다. 근본 원인은 거래량 히스토그램의 `scaleMargins`를 명시하지 않아 막대가 패널의 어느 높이에서 시작/끝나는지 값에 따라 계속 달라졌던 것 - 범례를 막대 옆 어디에 둬도 어긋날 수밖에 없는 구조였다. `chart.priceScale('volume')`에 `scaleMargins: { top: 0.15, bottom: 0 }`을 명시해 막대를 항상 패널 하단(기준선 0)에 붙이고 위쪽 15%만 비워두도록 고정했고, 범례는 RSI 라벨과 같은 패턴으로 패널 맨 위에 다시 둬서 데이터 값과 무관하게 항상 막대 바로 위 여백에 오도록 했다. `test/test_ui_ia.py` 51건 회귀 없이 통과.

**2026-08-14 실시간 시세 차트 캔들 패널 여백 축소 + 거래량 범례 하단 배치**: MACD 패널을 없앤 뒤에도 "거래량이 아래로 내려와야지, 기준선 밑에 있어야 해" 리포트를 받았다. 원인 두 가지: (1) 캔들 패널의 bottom scaleMargins가 0.36으로, 거래량이 같은 패널에 겹쳐 그려지던 옛 구조의 값이 별도 패널로 분리된 뒤에도 안 줄어 있어서 패널 하단에 불필요한 빈 공간과 음수 유령 눈금("-50,000"류, 실제 데이터 없이 여백만큼 축 범위가 늘어나 생김)이 생겼다 - 0.08로 축소. (2) 거래량 범례("거래량 885K...")가 패널 맨 위(mainHeight)에 있었는데 실제 막대는 패널 하단(기준선 0)에 붙어 그려져 서로 멀리 떨어져 보였다 - 범례를 패널 하단(RSI 패널 시작 바로 위)으로 옮겼다. `test/test_ui_ia.py` 51건 회귀 없이 통과.

**2026-08-14 실시간 시세 차트 MACD 패널 제거**: 거래량/RSI/MACD 3개 서브패널이 좁은 공간에서 라벨·값 배지가 계속 겹쳐 보인다는 리포트가 반복됐다(같은 날 패널 위치 계산을 두 차례 고쳤는데도 하드 리프레시 후에도 재현). 근본적으로 패널 수를 줄이는 쪽으로 정리해 MACD 히스토그램·MACD·Signal 시리즈와 패널 제목을 제거하고 거래량·RSI 2개 서브패널만 남겼다. `test/test_ui_ia.py` 51건 회귀 없이 통과.

**2026-08-14 국내시장지표 증시자금에 프로그램매매(차익/비차익거래) 추가**: 증시자금 카드에 신용잔고·고객예탁금만 있고 프로그램매매 차익/비차익거래가 없다는 요청을 받아, 키움 `ka90007`(프로그램매매누적추이요청)로 코스피 전체 시장 당일 순매수를 추가했다. VM에서 먼저 진단 스크립트(`probe_program_trading.py`, 정식 반영 후 제거)로 실제 응답을 확인한 뒤 반영했다 - 스킬 문서에 없던 필수 파라미터 `date`(YYYYMMDD)가 빠지면 `return_code=2` 오류가 났고, 응답 컨테이너 키는 `prm_trde_acc_trnsn`, 부호가 `"--239707"`처럼 두 번 겹쳐 내려와 `_number()`에서 흡수하도록 고쳤다. 금액 단위는 공식 문서가 없어 `all_tdy = dfrt_trde_tdy + ndiffpro_trde_tdy` 정합성으로 파싱만 검증했고, 규모상 백만원 단위로 추정했다(다른 TR들과 동일하게 완전한 공식 확정은 아님, 코드 주석에 명시). 프론트엔드 `formatFunds()`가 항상 양수를 가정해 음수 순매도 값을 억/조 단위로 못 줄이던 문제를 발견해 `formatSignedFunds()`를 새로 추가했고, 카드 색상은 사이트 공통 규칙(상승=빨강/하락=파랑)을 따른다. `test/test_domestic_market_indicators.py`에 실측 응답 형태 그대로의 회귀 테스트 3건을 추가해 전체 61건 통과.

**2026-08-14 국내시장지표 응답 병렬화로 로딩 속도 개선**: 국내시장지표(코스피·코스닥 주간현물, 투자자별 매매동향, 증시자금)가 같은 페이지의 코스피200 선물 위젯보다 훨씬 느리게 뜬다는 리포트를 받았다. `domestic_market_indicators.build_dashboard()`가 코스피·코스닥 현물 차트 6개(2시장 x 분/일/주, 각각 키움→KIS→네이버 폴백)와 투자자별 매매동향, 증시자금까지 총 8개의 독립적인 외부 API 호출을 전부 순차로 실행하고 있어서 캐시(60초 TTL)가 만료될 때마다 응답이 느렸다. 8개 호출 사이에 순서를 지킬 의존관계가 없고 `kiwoom_client`/`kis_client`의 토큰 캐시가 이미 `threading.Lock`으로 동시 호출에 안전해서, `concurrent.futures.ThreadPoolExecutor`로 병렬 실행하도록 바꿨다 - 전체 응답 시간이 8개 합산에서 가장 느린 호출 1개 수준으로 줄어든다. `test/test_domestic_market_indicators.py` 7건 포함 회귀 없이 통과.

**2026-08-14 실시간 시세 차트 전체화면 확대 시 보조지표 라벨 겹침 수정**: 종목검색 실시간 시세 차트를 전체화면으로 확대하면 거래량·RSI(14)·MACD(12,26,9) 패널 제목과 거래량 범례가 전부 캔들차트 상단 쪽에 뭉쳐 서로 겹쳐 보인다는 리포트(스크린샷)를 받았다. 원인은 이 라벨들의 top 위치를 `renderLwChart()`가 최초 렌더링 시 1회만 계산해서 인라인 스타일로 고정해두는데, 전체화면 모달을 열고 닫을 때 발생하는 `tistory-chart-resize` 이벤트(`resizeStockChart()`)는 패널 높이(`setHeight`)만 새 컨테이너 크기에 맞춰 다시 잡고 라벨 위치는 갱신하지 않았기 때문 - 작은 인라인 컨테이너 기준으로 계산된 얕은 top 값이 훨씬 커진 전체화면 컨테이너에도 그대로 남아 모든 라벨이 캔들 패널 위쪽에 몰려 보였다. 위치 계산 로직을 `positionLwcPaneLabels()`로 공유 함수화해서 `renderLwChart()`의 최초 렌더링과 `resizeStockChart()`의 리사이즈 양쪽에서 실제 적용된 패널 높이 기준으로 다시 맞추도록 했다. `test/test_ui_ia.py` 51건 회귀 없이 통과. `js/`는 GitHub Pages 자동 배포 대상.

**2026-08-14 실시간 종목판 최초 로딩 속도 개선**: `js/home-realtime-table.js`가 업종 라벨 보강용 `wics-map.js`(약 220KB, GitHub Pages 정적 파일)를 완전히 받은 뒤에야 종목 데이터(`fetchBoard`)를 요청하기 시작해 최초 표시가 불필요하게 늦어지고 있었다(이 파일은 없어도 기본 렌더링에 지장 없는 폴백). 두 요청을 병렬로 바꾸고, `wics-map.js`가 늦게 도착하면 이미 그려진 행에 업종 라벨만 다시 채우도록 재렌더링하게 했다.

**2026-08-14 배당주 스캔 펀더멘탈 백필 스크립트(backfill_fundamentals.py) 추가**: 전략검색 배당주 화면에 현대엘리베이터가 안 보인다는 리포트를 받아 확인해보니, 섹터 필터 때문이 아니라(`data/wics-map.js`에 산업재로 정상 등록돼 있음) `dividend_signal`이 요구하는 DART 배당 데이터가 이 종목 캐시에 아예 없었던 것이었다. `fetch_dividend_history`(배당 수집)는 2026-08-12에 막 추가된 기능인데 현대엘리베이터의 `fundamentals_cache.json` 항목은 그보다 한 달 전인 2026-07-13에 수집된 레거시 데이터라 `dividend` 키 자체가 없었다(VM 접속 확인). `batch_scan.py`는 dividend 키가 없는 종목은 신선도와 무관하게 재수집하도록 돼 있지만, 하루 20분 시간예산으로 전체 2,700여 종목을 커서 기반 이어달리기로 도는 구조라 이 기능이 생긴 지 이틀 만에 아직 그 위치까지 못 돈 상태였다(설계 결함이 아니라 백필 지연). 정기 커서를 기다리지 않고 특정 종목만 즉시 재수집할 수 있는 `scripts/cloud-vm/backfill_fundamentals.py`(신규)를 추가했다 - 종목코드를 인자로 주거나 `--missing-dividend`로 dividend 키 없는 종목 전체를 대상으로 실행할 수 있고, `batch_scan.py`의 커서 파일은 건드리지 않는다. 한국쉘석유가 배당주 목록에 없는 것은 별개로, 유통주식이 극히 적어 20일 평균 거래대금 10억원 최소 유동성 필터(`MIN_AVG_TURNOVER`)에 걸리는 의도된 동작으로 보인다(실측 거래대금까지 직접 확인은 못 함). `scripts/cloud-vm/`은 master 반영 후 VM 자동 배포 - 배포 후 VM에서 `python3 backfill_fundamentals.py 017800` 실행 필요(자동 실행 아님, 1회성 수동 스크립트).

**2026-08-14 관심종목 탭 재방문 시 시세 초기화(깜빡임) 수정**: 다른 탭을 보고 관심종목 드로어로 돌아오면 시세가 "-"로 초기화됐다가 다시 채워지는 것처럼 보였다. 원인은 `visibilitychange`에서 탭이 다시 보일 때 `render(container)`를 호출했는데, 이 함수가 카드 그리드 전체를 `innerHTML`로 갈아엎어 빈 카드부터 다시 그린 뒤 시세를 채우는 구조였기 때문(자리 비운 지 3분(`QUOTES_CACHE_MAX_AGE_MS`)이 넘으면 시세 캐시도 비어 fetch가 끝날 때까지 빈 값이 그대로 보임). 목록 구성(종목/그룹)은 그대로고 시세만 새로 받으면 되는 이 경로 전용으로 `resumeQuotesInPlace()`를 추가해, DOM을 갈아엎지 않고 기존 카드 값만 갱신하도록 했다. 종목 추가/삭제·그룹 변경처럼 목록 자체가 바뀌는 경로는 계속 `render()`를 그대로 쓴다.

**2026-08-14 GAS 자동 배포 파이프라인(GitHub Actions+clasp) 추가**: 지금까지 `gas/ticker-proxy.gs`는 git push만으로 배포되지 않고 script.google.com에서 매번 수동으로 "새 버전 배포"를 눌러야 했다(사용자가 로컬 소스 보관 없이 배포까지 자동화하길 원함). `.github/workflows/deploy-gas.yml`을 추가해 `gas/ticker-proxy.gs`·`gas/.clasp.json`이 master에 push되면 GitHub의 클라우드 러너에서 `clasp push`+`clasp deploy`를 실행해 기존 배포(운영 웹앱 URL)에 자동 반영하도록 했다. `gas/.clasp.json`(스크립트ID, rootDir)도 저장소에 추가했다(민감정보 아님). 실제 동작하려면 저장소 Secrets에 `CLASP_CREDENTIALS`(clasp login 결과)·`CLASP_DEPLOYMENT_ID`(기존 배포ID)를 1회 등록해야 한다 - 절차는 `docs/GAS_AUTO_DEPLOY.md` 참고. clasp push가 "appsscript.json 매니페스트 필요" 오류로 실패해 `gas/appsscript.json`(기존 배포 설정값 그대로: Asia/Seoul, V8, webapp 실행권한)도 추가했다. 같은 날 시크릿 등록 후 실제 push로 자동 배포 성공까지 확인 완료(더 이상 수동 배포 불필요, `ARCHITECTURE.md`/`CLAUDE.md` 갱신).
**참고**: 이 이전(2026-08-14 이전) 세션들이 설명하던 "gas 수정 → push → Apps Script 편집기에 수동 반영 → 수동 새 버전 배포" 절차는 이 항목 이후로 더 이상 유효하지 않다. 다른 AI 세션이 그 옛 절차를 사실처럼 설명하면(예: 로컬 컨텍스트가 오래됐거나 이 저장소 최신 상태를 못 본 경우) 이 항목과 `ARCHITECTURE.md`/`CLAUDE.md`의 "배포 주의" 최신 내용을 기준으로 정정한다.

**2026-08-14 GAS 시세 캐시가 08:00/20:00 경계를 넘겨 최대 30분 유지되던 버그 수정**: `gas/ticker-proxy.gs`의 관심종목 시세 배치(`?codes=`)와 시총버블(`getMarketcapBubble`) 캐시가 `isAnyTradingSessionOpen_()`(08:00~20:00 KST)의 열림/닫힘 여부로만 TTL(60초/1800초)을 정해서, 예를 들어 07:59에 쓰인 캐시는 "장외" 판정으로 1800초 TTL을 그대로 받아 08:00가 지나 장이 열려도 최악의 경우 08:29까지 직전 장외 스냅샷("0.00%")이 그대로 나갔다(사용자 리포트: 08:01에 관심종목 시세가 갱신 안 됨). 새 헬퍼 `capTtlToSessionBoundary_`로 TTL을 다음 08:00/20:00 경계까지 남은 초로 캡핑해 경계 시점 근처에서 캐시가 자연 만료되도록 했다. **GAS는 git push만으로 배포되지 않으므로 script.google.com에서 새 버전으로 수동 배포해야 실제 반영된다.**

**2026-08-13 홈 국내/미국 장 전환 카운트다운 배지 추가**: `homeMarketSession()`이 국내(코스피/코스닥)·미국(나스닥/S&P500) 요약을 08:00·20:00(KST) 기준으로 바꾸는 것에 맞춰, 전환 3분 전부터만 나타나는 라인아트 링 카운트다운 배지를 추가했다(`js/skin-main.js` setupHomeSwitchCountdown, `style.css` `.home-switch-countdown`). 화면 좌하단에 고정 배치했고(정확한 여백 폭을 확인할 방법이 없어 임시로 안전한 위치 선택, 필요 시 재배치 예정), 남은 초에 따라 SVG 링이 비워지며 08:00 전환은 파란색, 20:00 전환은 빨간색으로 구분했다. 모바일 하단 탭바와 겹치지 않도록 720px 이하에서 위치를 올렸다.

**2026-08-13 홈 미국 시장 요약에 코스피 야간선물 추가**: 홈 대시보드의 "미국 시장 요약" 카드는 항목이 5개(상승 종목 비율·시장 방향·원/달러·주도 업종·주의 업종)뿐이라 3열 그리드 마지막 칸이 항상 빈 채로 남아있었다(사용자 스크린샷 제보). 미국 장이 열려 있는 시간대(국내는 야간)라 다음날 코스피 방향을 가늠할 수 있는 "코스피 야간선물"을 그 빈 칸에 채웠다. 기존에 관심지수 리본(`js/quick-indices.js`)이 이미 수집하던 `KOSPI200_NIGHT`(VM `/futures`) 값을 그대로 재사용해 별도 API 호출을 늘리지 않았다. 국내 시장 요약(주간)에서는 이미 투자자 동향이 그 자리를 채우고 있어 이 칸은 숨긴다.
같은 날 후속으로, 국내 시장 요약(주간)의 코스피/코스닥 카드에는 있는 추이 그래프가 이 칸엔 텍스트만 있고 빠져 있다는 리포트로, `renderHomeIndexChart`(코스피/코스닥 카드와 동일 함수)를 재사용해 작은 추이 그래프를 추가했다(`.home-night-futures-chart`로 높이만 축소).

**2026-08-13 종목검색 실시간 시세 차트 보조지표 패널 정비**: `js/stock-search.js`의 풀스크린 "실시간 시세 차트"(TradingView v5 멀티패널) 보조지표 3종을 정비했다. ① 거래량/RSI(14)/MACD(12,26,9) 패널 제목과 거래량 범례 위치가 CSS 고정 %(58/72/86%, 70%)로 하드코딩돼 있어 컨테이너 실제 높이(JS가 매번 다르게 계산)와 어긋나 보이던 문제를 고쳐, 차트 렌더링 시 JS가 계산한 실제 패널 높이 그대로 인라인 스타일로 위치를 맞추도록 바꿨다. ② 거래량 20일 이동평균선(파란 선)을 설명하는 범례(`.ss-volume-study-label`)가 `position:absolute` 등 배치 속성 없이 `display:none`만 있어 사실상 항상 숨겨져 있던 걸 발견해 되살리고, 5일 이동평균선(주황)을 추가해 색점으로 5일/20일을 구분했다. ③ RSI(14) 라인을 50 기준으로 위(빨강)/아래(파랑) 두 색으로 나눠 그리도록 시리즈를 분리했다(사이트 공통 상승=빨강/하락=파랑 규칙 적용, 70/50/30 기준선 유지).

**2026-08-13 과거 시뮬레이션 "기다림의 시간·수익구간" 추가 및 축 라벨 겹침 수정**: 종목분석 과거 시뮬레이션 탭에 최근 원금 이탈~회복까지 걸린 기간("기다림의 시간")과 그 회복 이후 지금까지 수익구간을 유지한 기간("수익구간")을 추가했다. 산 이후 한 번도 원금 밑으로 내려간 적이 없으면 "축하축하" 메시지만, 아직 회복 전(현재도 원금 밑)이면 "진행 중, N일째"로 표시한다. 둘 다 비율·날짜만으로 계산돼 투자금과 무관하다. 수익률 폭이 아주 큰 종목(+1000%대 등)에서는 축 스케일이 원금(비율 1) 쪽으로 눌리면서 "원금" 라벨과 축 최고/최저 금액 라벨의 y좌표가 겹쳐 두 줄처럼 보이는 문제(사용자 스크린샷 제보)를 발견해, 라벨 간 최소 간격을 강제로 벌리도록 수정했다. 축 최고/최저·원금 라벨, 최고/최저 마커 라벨 모두 굵게(font-weight 700~800) 표시하도록 스타일을 올렸다.

**2026-08-13 전략검색 ETF 수익률 상위 운용사 순서·더보기 추가**: 전략검색(`js/strategy-search.js`)의 "ETF 수익률 상위" 화면에서 운용사별 카드 순서를 국내 ETF 시장에서 통상 알려진 운용사 순자산 규모 순(KODEX·TIGER·RISE/KBSTAR·ACE·PLUS/ARIRANG·SOL·HANARO·KOSEF·TIMEFOLIO·1Q·FOCUS)으로 바꿨다(기존은 임의 순서, 실시간 AUM 연동은 아니고 통념상 순위). 카드마다 상위 10개만 먼저 보여주고 10개를 넘으면 "더보기" 버튼으로 전체를 펼치도록 했다(다른 전략 카테고리는 그대로 전체 노출 유지).

**2026-08-13 종목분석 "과거 시뮬레이션" 탭 추가**: 종목분석(`js/foreign-flow.js`)의 수급/매물대/차트/펀더멘탈/모멘텀 5탭에 6번째 탭 "과거 시뮬레이션"을 추가했다. "차트" 탭이 이미 불러온 `?action=flowChart` 응답(`chartData.daily`, 최대 500거래일·약 2년치 종가)을 그대로 재사용해 별도 API 호출 없이, 투자금을 입력하고 "재생"을 누르면 과거 종가 비율(daily[i].close/daily[0].close)로 환산한 평가금액을 애니메이션(벡터 SVG polyline, 약 5초)으로 순서대로 그려준다. 재생 중이 아니어도 시작일·투자금 기준의 최종 평가금액·수익률 요약 문구는 즉시 계산해 보여준다. 매매수수료·세금·배당은 반영하지 않은 종가 기준 단순 계산이라는 안내를 카드 하단에 고정했다. `css/foreign-flow.css`에 라이트/다크 모드 스타일을 추가했다.
배포 직후 사용자 스크린샷 제보로 Y축 금액 라벨이 전체 자릿수(`fmtWon`, 예 "903,826,341원")로 표시되면서 좁은 축 여백을 넘어 텍스트 앞부분이 잘려나가 카드 밖으로 삐져나오고 "원금"·x축 날짜 라벨과 겹쳐 보이는 문제를 발견해 같은 날 수정했다. 축 라벨만 억/만 단위 축약 포맷(`fmtCompactWon`)으로 바꾸고, 평가금액 축 하한이 패딩 계산으로 0원 밑까지 내려가 음수로 표기되던 것도 0원 바닥으로 고정했다.
같은 날 최고점/최저점 표기 요청으로, 차트 위에는 "최고"/"최저" 2글자 마커만 라벨 x좌표를 차트 안쪽으로 clamp해서 붙이고(직전 오버플로 사고 재발 방지), 정확한 날짜·평가금액·수익률은 차트 아래 별도 텍스트 줄(`ffSimExtremes`)로 보여주도록 분리했다. 투자금을 바꾸면 이 텍스트도 같이 갱신된다.

**2026-08-12 국내시장지표 표기·공급자 정리**: 국내시장지표 헤더의 공급자 fallback 문구를 제거하고 현물 차트 안내를 `코스피 · 코스닥 주간현물 (09:00~15:45)`로 명확히 했다. 투자자별 매매동향의 내부 background collector 문구를 화면에서 숨겼으며, 증시자금은 KIS 전용으로 고정하고 네이버/KOFIA fallback을 제거했다. 해당 화면의 일반 폰트 색상은 검은색으로 통일했다.

**2026-08-10 주요 일정 카드 세로 확장 버그 수정**: 공통 세로 목록 스타일의 `flex-direction: column`이 주요 일정 가로 카드 목록에 상속되어 카드가 한 장씩 세로로 늘어나던 문제를 `flex-direction: row`로 고정해 수정했다.

**2026-08-10 주요 일정 스크롤바 투명화**: 주요 일정 가로 드래그 영역의 스크롤바 색상과 WebKit 트랙·thumb를 투명하게 처리해 카드 콘텐츠만 보이도록 정리했다.
**2026-08-10 미국 장 홈 요약·주요 일정 UX 개선**: 미국 장 세션에서 홈 하단 요약이 국내 증시 문구·기준을 계속 사용하지 않도록 미국 장 요약(상승 종목 비율·시장 방향·미국 주도/주의 업종)으로 전환하고, 주요 일정 카드를 최대 12개까지 가로 스크롤 및 마우스 드래그로 탐색할 수 있게 개선했다.

**2026-08-10 네이버 증권 종목 아이콘 소스 통합**: 국내 종목은 기존 Git 저장소의 네이버 SVG 아이콘을 로컬 우선으로 사용하고, 미국 주요 26종목의 네이버 SVG도 `img/stock-icons`에 저장해 외부 주소 의존 없이 표시하도록 했다. 로컬 파일이 없을 때만 네이버 `TICKER.O`·일반 티커 주소와 기존 Iconify/favicon fallback을 순서대로 시도한다.

**2026-08-10 미국시장 보드 거래대금 순위 전환 회귀검증 보강**: 키움 `usa20540` 전체 미국주식 거래대금 순위 응답을 사용하는 최신 보드 경로에 대해 순위 조회 인자·중첩 응답 파싱·하락 종목 가격 부호 정규화·천 달러 단위 거래대금 변환을 단위 테스트로 고정했다. 기존 국내/미국 주식 관련 테스트와 함께 검증했다.

**2026-08-10 실시간 종목판 미국 종목 아이콘 fallback 개선**: 로컬 `img/stock-icons`에 없는 미국 종목을 SVG→PNG→Iconify 브랜드 아이콘→공식 도메인 favicon→이니셜 순서로 표시하도록 보강했다. SpaceX·Sandisk·Intel·Cisco·Wells Fargo·Alphabet·McDonald's·AstraZeneca 등 주요 종목 매핑을 추가하고, 아이콘 비율이 잘리지 않도록 `contain` 렌더링을 적용했다. Iconify·favicon 모두 실패하면 기존 이니셜 fallback을 유지한다.

**2026-08-08 공공데이터 2차 경로 연결**: 승인된 금융위원회·국민연금 공공데이터를 주 데이터 장애 시에만 사용하는 fallback으로 연결했다. `/quote`는 키움 실패 시 금융위원회 주식시세정보와 증권상품시세정보를 순서대로 시도하고, `/ohlc/{code}`는 주식시세정보 일봉으로 보완한다. 전종목 일일 스캔은 GitHub Pages의 KRX 목록을 읽지 못할 때 KRX상장종목정보로 전환하며, 종목분석 연기금 카드에는 국민연금 연말 보유액·지분율을 보조 지표로 표시한다. 서비스키는 VM `.env`에서만 읽고 실시간·분봉·당일 수급의 대체로 사용하지 않는다. `docs/PUBLIC_DATA_SETUP.md`, `test/test_public_data.py`를 추가했다.

**2026-08-09 종목 메뉴 하위 메뉴 통합**: 직접 이동 링크였던 `종목`을 그룹 메뉴로 바꾸고, `종목분석`·`차트검색`·`전략검색`을 고정형 2차 메뉴로 통합했다. 종목 페이지에서도 현재 하위 메뉴가 자동으로 열리며, 기존 URL과 검색 이동 경로는 유지한다. UI 계약 테스트로 메뉴 구조를 검증했다.

중요한 기능, 구조, API, 데이터베이스, 배포 변경만 기록한다.
세부 파일 변경은 Git 커밋을 기준으로 확인한다.

**2026-08-08 관망 전략의 AI형 강조 제거**: 관망 상태에만 적용했던 노랑 배경·왼쪽 강조선을 제거하고, 오늘의 전략 영역은 장식 없는 일반 텍스트로 통일했다. AI 브리핑 전용으로 보이는 대괄호형 강조를 전략 카드에서 분리했다.

**2026-08-08 관망 전략 배지 개선**: 오늘의 전략이 중립일 때 보이던 단순 회색 테두리 박스를 제거하고, 노랑 계열의 은은한 배경과 왼쪽 강조선으로 관망 상태를 표현하도록 변경했다. 다크모드에서도 동일한 의미색을 유지한다.

**2026-08-08 증시온도 색상·하단 브리핑 통합**: 현재 온도 숫자·온도계·7일 흐름의 색을 동일한 5단계 온도 밴드에 연결하고, 과거 포인트별 구간 색상·7일 평균·최저·최고·시작 대비 변화·면적 그래프를 추가했다. 긴 오늘의 전략 카드를 시장 브리핑과 2열 통합 카드로 묶어 화면 마지막으로 이동했으며, 대시보드 강화 CSS 캐시 버전도 갱신했다. Node 문법 검사와 증시온도 이력 UI 계약 테스트를 통과했다.

**2026-08-08 증시온도 현재값·과거 추이 재배치**: 오늘의 증시온도와 최근 7일 스파크라인을 하나의 히어로 카드 안에서 `오늘 값 | 과거→오늘 흐름`으로 재구성했다. 기존 아래쪽 중복 차트를 제거하고, 요약 라벨도 시간 흐름에 맞게 `1주 전 → 어제 → 오늘` 순서로 정렬했으며 PC·모바일·다크모드 대응을 유지했다. `node --check` 및 증시온도 이력 UI 계약 테스트를 통과했으며 아직 배포하지 않았다.

**2026-08-07 증시온도 관리자 Google 로그인**: 카드 편집 저장을 기존 브라우저 `X-API-Key` 입력 방식에서 Google OAuth/OIDC 관리자 세션 방식으로 전환할 수 있도록 FastAPI에 `/auth/google/start`, `/auth/google/callback`, `/auth/google/me`, `/auth/google/logout`을 추가했다. Google ID 토큰은 discovery JWKS의 RS256 공개키로 서버에서 검증하고, `state`·`nonce`·HttpOnly Secure 세션 쿠키를 사용한다. 관리자 허용 이메일은 기본 `goodbyestarwars@gmail.com`이며 Google OAuth 환경변수가 설정되기 전에는 기존 토큰 방식이 임시 fallback으로 유지된다. 설정 절차는 `docs/GOOGLE_AUTH_SETUP.md`에 기록했다.

**2026-08-07 증시온도 카드 구성 DB 편집 기반 전환**: 기존 `data/sectors-v3.js` 정적 파일을 최초 1회 기존 VM SQLite(`ohlc_snapshot.db`)의 `sector_cards_config`로 시드하고, FastAPI `/sector-cards` 조회 및 관리자 `PUT` update API를 추가했다. revision 기반 낙관적 동시성 검사를 적용해 다른 편집자의 변경을 덮어쓰지 않도록 했으며, 증시온도 카드보기에서 카테고리·종목 추가/수정/삭제와 종목명 자동검색, 관리자 토큰 저장, 저장 후 재조회 UI를 추가했다. GAS 증시온도 섹터 풀도 DB API를 읽도록 전환했다. `py_compile`, Node 문법 검사, SQLite 스키마·시드·revision 충돌 검증을 통과했다. VM API 변경은 master 반영 후 자동 배포되고, GAS 변경은 GAS 웹앱 수동 재배포가 필요하다.

**2026-08-06 관심종목 전역 우측 드로어·드래그앤드롭**: MY 페이지에 한정됐던 관심종목을 모든 페이지에서 공통으로 로드되는 `stock-search-panel.js`가 우측 고정 드로어로 주입하도록 변경했다. 오른쪽 끝의 관심 탭으로 열고 닫으며 열린 상태를 브라우저에 저장한다. 기존 MY 메뉴 항목은 제거했고, 기존 `/page/watchlist`의 마운트가 있으면 페이지 본문에서 드로어로 이동해 중복 렌더링을 막는다. 관심종목은 카드형 블록으로 표시하며 HTML5 드래그앤드롭으로 같은 그룹 내 순서 변경과 다른 그룹 이동을 동시에 저장한다. 기존 `wl_codes_v1`·`wl_groups_v1`, 실시간 시세와 종목 클릭 이동은 유지했다. Node 문법 검사와 UI 계약 검사를 통과했으며 `js/`·`css/`는 master 반영 후 GitHub Pages 자동 배포 대상이다.

**2026-08-06 MY 관심종목 우측 패널·그룹화**: MY 관심종목을 PC에서 우측 정렬된 세로형 패널로 바꾸고 모바일에서는 전체 폭을 유지했다. 기존 `wl_codes_v1` 목록을 보존하면서 `wl_groups_v1`에 그룹·접힘 상태를 저장하고, 그룹 생성·삭제·종목 이동을 추가했다. 별도 차트 보기 버튼은 제거하고 종목 행 전체를 누르면 기존 `/page/stock-search` 실시간 시세로 이동하도록 통합했다. JavaScript 문법 검사와 UI 계약 테스트를 통과했으며 아직 배포하지 않았다.

**2026-08-06 종목분석 실제 체결가 매물대 UI를 고층 타워형으로 개편**: 매물대 카드를 기존 행형 아파트에서 롯데월드타워처럼 위가 가늘고 아래가 넓어지는 고층 타워 실루엣으로 변경했다. 층수 확대·축소(12/18/24/36/48층), KIS `FHPST01130000` 실제 체결가·체결거래량, `/pbar-tratio`의 SQLite `volume_profile_daily` D+1 누적, POC, VWAP 계산은 전혀 변경하지 않았다. VWAP가 속한 실제 가격층을 초록색으로 강조하고 현재가선과 평균단가선을 분리했으며, 구름·왕복 헬기·회전 로터·B1 지하실·B2 마그마방 장식을 유지했다. PC·모바일·다크모드 스타일을 함께 보완했고 Node 문법검사와 CSS 괄호 검사를 통과했다. Python 런타임이 없는 작업환경이라 pytest는 실행하지 못했으며, 변경 대상은 GitHub Pages 자동 배포 파일(`js/foreign-flow.js`, `css/foreign-flow.css`)이다.

**2026-08-05(후속25) 실시간 랭킹 간헐적 "데이터를 불러오지 못했습니다" 원인 수정 - /market-rank를 온디맨드 키움 호출에서 백그라운드 폴링으로 전환**: 후속24에서 원인만 짚어두고 미뤘던 구조적 문제를 마저 고쳤다. `/market-rank`(`scripts/cloud-vm/main.py`)는 30초 서버 캐시가 만료되는 순간마다 요청 핸들러 안에서 키움 REST를 직접 호출했는데, 그 순간 키움이 느리거나 일시 오류를 내면 방문자 브라우저(`js/sidebar-rank.js`)의 8초 fetch 타임아웃에 걸려 "데이터를 불러오지 못했습니다"가 간헐적으로 떴다. 이 저장소의 다른 실시간 데이터(해외선물·BTC·국채금리·옵션수급·투자자동향)는 전부 FastAPI 기동 시 백그라운드 스레드로 상시 수집해 미리 채워두고 요청 핸들러는 읽기만 하는 패턴인데 `market_rank.py`만 예외였다 - `option_flow.py`(5분 주기 폴링) 패턴을 그대로 따라 `market_rank.py`에 `start_background()`(30초 주기, limit=20까지 미리 수집)와 `get_cached()`를 추가하고, `main.py`의 `_start_futures_collectors()`(서버 기동 훅)에서 다른 수집기들과 함께 시작하도록 연결했다. `/market-rank` 핸들러는 이제 이 캐시를 먼저 읽고, 서버 기동 직후 백그라운드가 아직 한 번도 못 채운 극초반에만 기존 온디맨드 경로(키움 직접 호출 + 30초 TTL 캐시)로 폴백한다 - 기존 코드는 삭제하지 않고 안전망으로 남겨뒀다. 스텁으로 캐시/백그라운드 로직 단위 검증(초기 None → refresh 후 limit별 슬라이스 정상, 스레드 기동 후 캐시 채워짐) 완료. `scripts/cloud-vm/`은 `master` 반영 후 VM 자동 배포 대상.

**2026-08-05(후속24) 홈 "오늘의 시장판" 간헐적 "일시 지연" 원인 수정 - marketTemp/bubble fetch 타임아웃 12초 → 20초**: 사용자가 홈 화면 스크린샷을 주고 지수 카드 전부 "-", 오늘의 시장판 "일시 지연"/"데이터 확인 중", 실시간 랭킹 "데이터를 불러오지 못했습니다"가 가끔 뜨는 이유를 물었다. 세 증상을 각각 추적한 결과, 실시간 랭킹(`js/sidebar-rank.js`)과 지수 카드(`js/quick-indices.js`)는 VM(`/market-rank`가 30초 캐시 미스 시 키움 API 실시간 호출, `/futures` 8초 타임아웃)의 순간적 지연에 취약한 구조적 특성으로 확인됐고(별도 수정 없이 원인만 설명, 랭킹 쪽은 후속25에서 마저 고침), 오늘의 시장판은 명확한 코드 결함을 찾았다 - `js/market-temp.js`(증시온도 페이지 전용 위젯)는 GAS `getMarketTemp()`가 캐시 만료 시 VIX·수급·거래대금 등 9개 지표를 순차 외부 호출해 느려지는 문제 때문에 이미 타임아웃을 8000→20000으로 올려뒀는데(2026-07-22 주석), 홈 대시보드를 만드는 `js/skin-main.js`의 같은 GAS 호출(`?marketTemp=1`, `?bubble=1`)은 12000으로 남아 있어 캐시가 30분마다 갱신되는 순간 홈에서만 타임아웃이 나고 있었다. `skin-main.js`의 두 `fetchHomeJson` 타임아웃을 20000으로 맞춰 수정. `js/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(후속23) 관심지수 리본 야간선물 장중 표시를 코스피 선물 페이지와 통일**: 후속22에서 남겨뒀던 "필요하면 후속으로 통일" 요청이 왔다. `js/quick-indices.js`의 `marketStatus()`도 `js/kospi-futures.js`의 `isMarketOpen`과 똑같이 두 가지를 고쳤다 - (1) 야간선물 마감 05:00 → 06:00, (2) 요일 미고려 버그(주말 저녁/새벽에도 "실시간"으로 잘못 표시하던 것)를 같은 방식(평일 저녁 시작 + 화~토 새벽 종료)으로 수정. 요일 경계 5개 케이스(화요일 05:20/06:00 경계, 토·일 주말 휴장, 토요일 금요일 연장)를 Node로 검증(전부 PASS).

**2026-08-05(후속22) 코스피200 야간선물 장 마감 판정 시각 정정(05:00 → 06:00)**: 후속16에서 "(장 마감)" 배지를 만들 때 야간선물 마감을 `js/quick-indices.js`의 기존 주석("18:00~익일 05:00")을 그대로 가져다 05:00으로 썼는데, 사용자가 실시간으로 05:20에 야간선물이 아직 거래되는 걸 보고 "장 마감"으로 잘못 뜬다고 리포트했다 - 참고했던 주석 값 자체가 부정확했던 것으로 보고, 실제 마감을 06:00으로 정정했다(공식 문서 대조는 못 했으나 실시간 관찰이 오래된 주석보다 신뢰도가 높다고 판단). `js/kospi-futures.js`의 `isMarketOpen`의 `earlyMorningOpen` 판정만 고쳤고(요일 경계 로직은 그대로), `js/quick-indices.js`의 동일 값은 이번 요청 범위(코스피 선물 페이지) 밖이라 그대로 남겨뒀다 - 필요하면 후속으로 통일. 요일 경계 5개 케이스(화요일 05:20/05:59/06:00 경계, 토요일 05:59 금요일 연장, 일요일 05:59 휴장)를 Node로 재검증(전부 PASS).

**2026-08-05(후속21) 코스피 선물 분봉 차트 X축 - 기본 확대 구간을 최근 거래일로 좁힘**: 앞서(후속16) 분봉 X축이 9시간 이르게 표시되던 시간대 버그(`KST_OFFSET_SEC`)를 고쳤는데도 "X축이 분단위로 안나온다" 리포트가 다시 왔다 - 별개의 원인이었다. 저장된 확대 구간이 없는 첫 방문에는 `fitContent()`로 최근 3~4거래일치(최대 1500봉, `db_schema.load_future_chart_minute` 상한)를 한 화면에 다 보여주는데, 1200px 폭에 1600개 가까운 1분봉을 욱여넣으면 Lightweight Charts가 X축에 날짜 경계("30일"/"31일"/"8월")만 듬성듬성 찍고 시:분 눈금은 거의 안 그린다 - CDN이 막힌 환경 대신 `npm install lightweight-charts@4.2.0`으로 실제 배포 버전을 받아 Playwright로 직접 렌더링해 이 현상과 수정 후 정상 동작(09:30~15:30 눈금 정상 표시)을 둘 다 실측 확인했다. `js/kospi-futures.js`의 `applySavedRange`가 분봉이고 저장된 구간이 없을 때 `fitContent()` 대신 "가장 최근 캔들이 속한 하루"로 기본 구간을 좁히도록 수정 - 이전 거래일 데이터는 그대로 남아있어 확대·좌스크롤하면 보인다.

**2026-08-05(후속20) 제목만 목록을 히어로(대표+목록) 블록으로 흡수 + 목록 항목 날짜 위치 수정**: 후속19에서 독립 블록으로 뒀던 "제목만 4줄 목록"에 대해 사용자가 직접 "저럴 때는 왼쪽에 포스팅 하나, 오른쪽에 제목만 있는 포스팅을 해야 하지 않을까?"라고 지적했다 - 제목 목록이 혼자 떠 있는 것보다 대표 글 옆에 붙어야 자연스럽다는 지적이 맞아서, `single`(대표 1개)과 `headline`(제목 목록)을 하나의 `hero` 블록(왼쪽 대표 1 + 오른쪽 제목 목록 최대 4, 남은 글 수에 따라 2~5개 가변)으로 합쳤다 - `single` 단독(대표 글만 있고 옆에 아무것도 없는 경우)은 별개 블록 타입으로 남겨 여전히 무작위 후보에 포함된다.

같은 자리에서 "제목만 4줄이라며 왜 날짜까지 넣었냐"는 자체 점검으로, 목록 항목의 날짜가 제목 위에 혼자 한 줄을 차지해 밀도가 떨어지던 것도 고쳤다 - CSS flex `order`만으로 제목(`<a>`, order:1)과 날짜(`.post-header`, order:2)의 시각적 순서를 뒤집어, 날짜가 제목 다음에 작게 붙는 한 줄로 표시되게 했다(skin.html 마크업은 안 건드림). Playwright로 히어로 블록(대표+목록) 정상 렌더링, 순서 유지(0~19), 모바일 1열 collapse 재확인.

**2026-08-05(후속19) 카테고리 글목록을 진짜 구조가 다른 블록 4종으로 무작위 배치**: 후속18에서 카드마다 크기만 다르게 준 게 전부 세로 1열이라 "왜 일열이야?"라는 피드백을 받았다 - 사용자가 표로 예를 들어 요구한 건 [1개짜리 대표 글] / [제목만 4줄 목록] / [작은 카드 3개 그리드] / [가로 2개 나란히]처럼 구조 자체가 다른 블록들이 섞이는 것이었다. `js/skin-main.js`를 `buildCategoryFeedBlocks`로 다시 짰다: 글을 맨 앞부터 순서대로(최신순 그대로, 재정렬 없음) 소비하면서, 매번 남은 글 수에 맞는 블록 타입(1/4/3/2개 필요)을 무작위로 골라 그만큼씩 묶어 서로 다른 그리드/목록 구조로 렌더링한다(남은 글이 부족한 타입은 후보에서 자동 제외, 1개짜리 대표는 항상 가능해 안전망 역할). `style.css`에 `.feed-block-headline`(제목만 목록, 카드 대신 패널+구분선), `.feed-block-cards`(3단 그리드), `.feed-block-duo`(2단 그리드) 3종을 새로 추가하고 기존 `.feed-featured`는 그대로 재사용. Playwright로 글 20개 기준 순서(0~19 그대로) 유지와 네 블록 타입이 실제로 섞여 렌더링되는 것, 모바일에서 그리드가 1열로 접히는 것까지 확인.

**2026-08-05(후속18) 카테고리 글목록 배치를 히어로 고정 구조에서 카드별 무작위 모양으로 단순화**: 후속17의 [대표1+오른쪽 헤드라인4] 히어로 고정 배치를 사용자가 "그냥 랜덤(최신순만 유지)으로 해줘"로 다시 요청했다. AskUserQuestion으로 "모양 종류는 여러 개 유지, 어느 글이 어느 모양을 받을지는 무작위"임을 확인 - 카드를 그룹으로 묶거나 DOM 위치를 옮기는 걸 그만두고, `js/skin-main.js`의 `randomizeCategoryFeedShapes`가 각 카드에 독립적으로 무작위 모양 클래스(featured 1/6, compact 2/6, standard 3/6 가중치)만 부여하도록 바꿨다 - 카드가 화면에 나오는 순서는 전혀 건드리지 않는다(순서 유지를 Playwright로 직접 검증: DOM 순서가 0~9 그대로). `feed-hero`/`feed-hero-featured-slot`/`feed-hero-headlines`/`feed-headline-item`은 이 구조로 대체되어 삭제, 새 `feed-compact`는 카드 테두리·그림자를 유지한 채(독립된 카드라 목록형 구분선 대신 카드 자체를 남김) 패딩·글자 크기만 줄인 형태로 새로 추가했다. 새로고침/페이지 이동마다 모양이 다시 섞인다.

**2026-08-05(후속17) 카테고리 글목록 배치를 네이버 뉴스 홈 참고로 재설계 + 목록 카드 카테고리 배지 제거**: 후속15에서 만든 "5개 묶음 반복(featured+2단 듀오+기본 2)" 리듬을, 사용자가 네이버 뉴스 홈 스크린샷을 주며 "배치만 참고하라"고 다시 요청해 바꿨다. 네이버는 묶음이 반복되는 게 아니라 페이지 맨 위에 [큰 기사 1개 + 오른쪽 헤드라인 목록] 히어로 블록 하나만 있고 그 아래는 평범한 목록이다 - `js/skin-main.js`의 `buildCategoryFeedHero`로 다시 짰다: 1번째 글(최신)만 대표(`feed-featured`), 2~5번째 글은 카드 테두리 없는 목록형 헤드라인(`feed-headline-item`, 제목 2줄 클램프+날짜만)으로 오른쪽 열에 묶고, 6번째 글부터는 손대지 않아 원래 기본 카드 그대로 아래에 이어진다 - "1페이지 10개 글" 기준 대표1+헤드라인4+기본5로 맞아떨어지는 구조다(페이지당 글 개수 자체는 Tistory 관리자 설정이라 git으로 바꿀 수 없어 사용자에게 별도 안내함). `.feed-duo-row`/`.feed-duo-item`은 이 구조로 대체되어 삭제.

같은 요청에서 "왼쪽 대괄호 bold 부분 빼줘"도 반영 - 실제 라이브 화면을 보여주며 지목한 게 목록 카드 제목 앞의 카테고리 배지(굵은 글씨 알약, `.post-cat-badge`)였다. `skin.html`의 `s_index_article_rep`(목록 카드) 블록에서만 배지 마크업을 제거하고, `data-cat` 속성은 남겨(홈 대시보드의 "마켓 브리핑" 카드 필터가 이 속성을 씀) 필터링은 그대로 동작한다. 퍼머링크(단일 글) 화면의 배지는 요청 범위 밖이라 그대로 유지. 배지가 빠지면서 `.post-header`에 날짜 하나만 남아 `justify-content: space-between`이 왼쪽으로 붙던 것도 `flex-end`로 고쳐 원래처럼 오른쪽에 유지(공지 카드는 배지가 그대로라 대상에서 제외).

로컬 Playwright로 라이트/다크/모바일 렌더링 확인(대표+헤드라인4+기본5 구조, 배지 없음, 날짜 우측 정렬, 모바일 1단 collapse 전부 정상). `js/`·`css/`·`skin.html`은 각각 GitHub Pages 자동 배포(js/css), Tistory 관리자 수동 반영(skin.html) 대상.

**2026-08-05(후속16) 코스피 선물 페이지: 장 마감 배지 추가 + 분봉 X축 시간·야간선물 분봉 누락 수정**: "시장 > 코스피 선물" 페이지에서 세 가지 리포트를 받았다.

(1) 주간·야간선물 정규장 마감 시 "(장 마감)" 표시: `js/kospi-futures.js`에 `isMarketOpen(panelKey)`을 추가했다. 주간선물은 09:00~15:45(같은 파일 옵션 수급 설명문에 이미 있던 값, 사용자가 요청한 15:00과 달라 확인 후 15:45로 확정), 야간선물은 평일 18:00~익일 05:00. `js/quick-indices.js`에도 비슷한 `marketStatus()`가 있지만 야간선물 판정에서 요일을 안 따져 토요일 밤/일요일 새벽처럼 세션이 없는 구간도 "실시간"으로 잘못 표시하는 문제가 있어(사용자가 "주말에는 휴장" 요구), 여기서는 세션 시작(평일 저녁)과 종료(전날이 평일이었던 새벽)를 따로 확인하도록 새로 짰다 - 토·일 경계 6가지 케이스를 Node로 직접 검증(전부 PASS). 배지는 가격 fetch 성공 여부와 무관하게 즉시·30초마다 갱신된다(`updateMarketStatusBadges`).

(2) 분봉 차트 X축 시간 오류: Lightweight Charts는 UNIX 타임스탬프의 시:분을 항상 UTC 기준으로 읽는데, 서버(`domestic_futures.py`/`night_futures_ws.py`)가 주는 분봉 `ts`는 정확히 변환된 진짜 UTC초라 그대로 넣으면 X축에 KST보다 9시간 이른 시각이 찍힌다 - 같은 날 `js/stock-search.js`가 분봉 탭에서 먼저 발견·수정한 것과 동일한 라이브러리 특성(반대 방향으로 문자열+'Z' 트릭 사용). `js/kospi-futures.js`는 이미 true UTC초를 갖고 있으므로 반대로 9시간을 더해(`KST_OFFSET_SEC`) 화면에 실제 거래소 시각이 나오게 했다(Node로 09:30 KST가 09:30으로 표시되는지 계산 검증).

(3) 야간선물 분봉이 아예 안 나오는 문제: `scripts/cloud-vm/main.py`의 `/futures?interval=minute`이 `domestic_futures.MINUTE_SYMBOLS`를 "분봉이 존재할 수 있는 심볼" 읽기 게이트로 재사용하고 있었는데, 이 집합은 2026-08-03에 KOSPI200_NIGHT이 빠졌다(도메스틱 수집기 자신이 야간선물 자리를 주간선물 데이터로 잘못 덮어쓰던 버그 수정 - `domestic_futures.py` 상단 주석 참고, 그때는 "쓰기 범위"만 좁힌 것이었다). 그런데 `night_futures_ws.py`는 여전히 별도 KIS 웹소켓 소스로 KOSPI200_NIGHT 분봉을 정상적으로 DB에 채우고 있어서, 읽기 게이트가 같은 집합을 재사용하는 바람에 이미 존재하는 야간선물 분봉까지 응답에서 통째로 빠지는 회귀였다. `_MINUTE_CHART_READ_SYMBOLS = domestic_futures.MINUTE_SYMBOLS | {'KOSPI200_NIGHT'}`로 읽기/쓰기 범위를 분리해 수정.

`py_compile`·Node `--check`로 문법 검증. `js/`·`css/`는 GitHub Pages 자동 배포, `scripts/cloud-vm/`은 `master` 반영 후 VM 자동 배포 대상.

**2026-08-05(후속15) 카테고리 글목록 우측 "실시간 랭킹" 제거 + 카드 배치 다양화**: `/category/마켓 브리핑` 등 카테고리 글목록 화면에서 우측 사이드바에 뜨던 "실시간 랭킹"(거래량/상승률/하락률 TOP) 위젯을 없애달라는 요청. 위젯 DOM(`#sidebar-rank`)과 `js/sidebar-rank.js` 자체는 지우지 않았다 - 같은 DOM을 홈("/") 대시보드("오늘의 시장판" 카드 옆 `home-rank-slot`)가 그대로 옮겨 재사용하기 때문(`js/skin-main.js`의 `buildHomeDashboard`). 대신 카테고리 화면만 우측 사이드바를 강제로 띄우던 `style.css` 예외 규칙(`html.full-width-page body#tt-body-category .sidebar-right`)을 삭제해, skin.html head 스크립트가 원래 의도한 대로("우측 사이드바는 전체글에서만 노출") 일반 규칙을 타게 했다. 화면에서 숨겨져도 백그라운드에서 계속 30초 폴링하지 않도록 `js/sidebar-rank.js`의 초기화 자체를 홈 경로("/")에서만 실행하도록 가드를 추가했다.

같은 화면에서 카드가 전부 같은 모양으로만 세로 나열되던 것도 "여러 모양을 써달라"는 요청에 따라 바꿨다. `js/skin-main.js`에 `diversifyCategoryFeedLayout`을 추가해, 카테고리 글목록(`/category/`)의 `.post-card` 목록을 5개 묶음 단위로 [대표 1장(featured, 풀폭+좌측 강조선) + 2단 그리드 2장(duo) + 기본 2장(standard)] 리듬이 반복되도록 클래스만 부여·재배치한다 - 글 순서(Tistory 기본 최신순)는 그대로 두고 시각적 크기만 바꾸며, 페이지네이션은 항상 원래 위치(맨 끝)에 남는다. 관련 스타일은 `style.css`의 `.feed-featured`/`.feed-duo-row`/`.feed-duo-item`, 모바일(720px 이하)에서는 2단 그리드를 1단으로 접는다. 로컬 Playwright로 데스크톱·모바일 렌더링을 확인(우측 사이드바 사라짐, featured/duo/standard 3가지 모양 정상 배치, 순서 유지, 모바일 1단 collapse). `js/`·`css/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(후속14) 전략검색을 "저평가 종목 전용 페이지"로 잘못 만든 것 수정 - 카테고리 탭 구조 복원**: 후속13에서 kisyaml 10개를 지우고 "저평가 종목"을 만들면서, 탭 자체를 없애고 페이지 정체성(위젯 타이틀 "저평가 종목", 메뉴 라벨도 "전략검색"→"저평가 종목")까지 그 하나로 고정해버렸다. 사용자 피드백: "전략검색은 냅두고 10개를 1개로 줄이는 거였지, 페이지 자체를 저평가 종목으로 박아버리라는 게 아니었다 - 계속 추가할 것". 즉 "전략검색"은 여러 카테고리를 탭으로 보여주는 틀이고 "저평가 종목"은 그 중 첫 카테고리일 뿐이어야 했다.

바로잡음: `strategy_scan.py` 출력을 `sectors: {...}`(최상위)에서 `categories: {undervalued: {name, methodology, sectors}}`로 한 겹 감쌌다 - 카테고리를 추가할 땐 이 딕셔너리에 키 하나만 더 넣으면 됨. `gas/ticker-proxy.gs`의 `getStrategyScanResult()`도 `categories`를 그대로 통과시키게 갱신. `js/strategy-search.js`는 탭 UI(`.ss-tabs`/`.ss-tab`)를 되살려 `categories` 키들을 탭으로 렌더링하고, 활성 탭의 methodology+섹터 카드만 보여주도록 재작성(카드/행 렌더링 로직 자체는 유지). `js/skin-menu.js` 메뉴 라벨은 "전략검색"으로 원복. `test/strategy-search.html`에 mock 카테고리를 2개(저평가 종목 + 예시용 두 번째 카테고리)로 넣어 탭 전환이 실제로 되는지 로컬에서 확인.

`scripts/cloud-vm/`·`gas/ticker-proxy.gs`(수동 배포 필요)·`js/`·`css/` 변경.

**2026-08-05(후속13) 전략검색 전면 개편 - kisyaml 프리셋 10개 폐기, "저평가 종목" 단일 스캔 신설**: "이 정도면 코스피 목록 찍는 거랑 뭐가 다르냐, 변별력이 없다"는 피드백을 받았다. 근본 원인은 프리셋 10개가 전부 entry.logic: AND의 단일·소수 조건 스크리너라 매칭 종목이 너무 쉽게, 너무 많이 나온 것 - 사용자가 10개 전량 삭제와 "저평가 종목" 신규 1개 신설을 명확히 지시했다.

"AI로 저평가 정의"의 의미와 데이터 소스를 먼저 확인했다(AskUserQuestion) - ① 낮은 PER류 개념이지만 섹터별로 분류돼야 변별력이 생긴다 ② 새 API 연동 없이 지금 있는 데이터로 빠르게. 확인 결과 이 코드베이스엔 PER/PBR(밸류에이션) 데이터가 아예 없다(`js/foreign-flow.js`가 이미 "원천 시세 응답이 없어 표시 안 함"으로 비활성 처리해둔 상태) - 그래서 진짜 PER 기반 저평가는 지금 구현 불가능하고, 대신 이미 전종목 배치로 쌓이고 있는 두 데이터를 조합했다: DART 연간 재무(`fundamentals_cache.json`, `batch_scan.py`가 매일 이어달리기로 갱신, `invest_signal.compute_fundamental_score` - ROE 60%+부채비율 40%, daily_scan.py 투자시그널과 동일 공식 재사용)로 "우량"을 판정하는 품질 게이트 + daily_prices(OHLC)의 120일 이평 대비 이격도로 "가격이 눌려있음"을 근사하는 가격 게이트. 두 게이트를 모두 통과한 종목만 WICS 대분류 섹터(`data/wics-map.js`, 2,529종목 분류)별로 묶어 섹터당 이격도가 가장 낮은 상위 5개만 남긴다(섹터 분류 요청 반영 + 무제한 노출로 인한 변별력 부족 재발 방지).

`scripts/cloud-vm/strategies/*.kis.yaml` 10개와 그걸 로드하던 `load_presets()`를 삭제했다. `kisyaml_strategy.py` 엔진 자체(파서·지표·evaluate())는 재사용 가능성 때문에 저장소에 남겨뒀다(더 이상 이 스캔이 쓰지 않을 뿐) - `test_kisyaml_strategy.py`에서 번들 프리셋 존재를 전제로 하던 `TenPresetTests`/`ExampleFileTests`만 제거하고 엔진 자체 테스트는 그대로 유지. `strategy_scan.py` 파일명·`/strategy-scan-batch` 엔드포인트·`strategy_scan_cache.json` 캐시 파일명은 그대로 유지했다 - VM에 이미 등록된 `kiwoom-strategyscan.timer`가 이 파일명을 그대로 가리키고 있어 배포 경로를 유지해야 재등록 없이 그대로 돌아간다(내용만 완전히 새로 작성).

배지 재발 방지: 이번엔 종목마다 실제로 다른 값(이격도·펀더멘탈점수·ROE·부채비율)을 화면에 그대로 노출해 "다 100%" 문제가 구조적으로 재발할 수 없게 했다. 화면 하단이 아니라 상단에 "저평가"의 정확한 판정 기준과 "PER/PBR 없이 근사한 값이라 진짜 저평가와 다를 수 있다"는 한계를 그대로 명시(`METHODOLOGY_NOTE`, 프론트가 문구를 재해석하지 않고 그대로 표시). `js/skin-menu.js` 메뉴 라벨도 "전략검색" → "저평가 종목"으로 변경(URL은 `/page/strategy-search` 그대로 유지).

`test/test_strategy_scan.py`를 새 데이터 모델(품질 게이트·가격 게이트·섹터 그룹·컷 개수)에 맞게 전면 재작성(13개 테스트) - 이격도 계산 시 마지막 날 값이 120일 평균 자체에도 포함되는 자기참조 효과까지 감안해 테스트 값을 잡았다. `wics-map.js`/`krx_map.js` 파싱 정규식은 저장소의 실제 데이터 파일로 직접 검증(2,529·3,913건 정상 파싱). VM 네트워크(krx_map.js/wics-map.js fetch)는 이 세션 샌드박스에서 막혀있어 라이브 스모크는 못 돌렸다(기존 daily_scan.py 등 다른 배치 스크립트도 동일한 제약) - 다음 VM 배치 실행에서 실제 라이브 확인 필요. `scripts/cloud-vm/`·`gas/ticker-proxy.gs`(수동 배포 필요)·`js/`·`css/`가 모두 바뀐 변경.

**2026-08-05(후속12) 전략검색 카드/행 스타일을 증시온도 카드보기 값 그대로 복제**: 후속11까지 거치며 직접 좁힌 값(line-height:1.3, padding:6px 0, columns:3 210px, 이름 굵게+진한 색)이 오히려 "다닥다닥 붙어있다"는 반대 피드백을 받았다 - 사용자가 "증시온도 > 카드보기 딱 이렇게, 그냥 가져다 써"라고 명확히 지정. 확인해보니 증시온도의 카드보기(`js/market-temp.js`)는 `js/sector-dashboard-v4.js`의 `SectorDashboard.renderCardsHtml()`을 그대로 재사용하고 `css/market-temp.css`가 `#market-temp` 스코프로 `.sector-card`/`.sector-row` 스타일을 복제해두고 있었다 - 그 값(padding: 8px 0, columns: 3 220px/column-gap 14px, 이름 font-weight 500·색 #374151, line-height 미지정=post-single-body의 1.9를 그대로 씀, 모바일 640px에서 1단)을 그대로 `#strategy-search .ss-*`에 옮겼다. 직접 줄였던 값은 전부 되돌렸다. 종목코드 표시(`.ss-row-code`)처럼 market-temp에 없는 것만 최소로 남겨뒀다. `.post-single-body` 컨텍스트를 재현해 실측(행 높이 약 42px, market-temp와 동일 비율)과 모바일 1단 collapse를 Playwright로 확인. `css/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(후속11) 전략검색 행이 카드 전체 폭을 다 써서 좌우로 헐렁한 문제 수정**: 후속10에서 "행이 너무 넓다"는 리포트를 줄간격(높이) 문제로 오판하고 line-height만 고쳤는데, 실제로는 좌우 폭 얘기였다(사용자가 다시 지적) - 행 하나가 카드 전체 폭(글 본문 너비, 보통 700px 이상)을 혼자 차지해서 종목명과 가격 사이에 빈 공간만 넓게 뜨는 문제. `css/sector-dashboard-v3.css`의 `.sector-cards-grid`가 이미 쓰는 다단(column) 기법을 그대로 적용해 `.ss-rows`에 `columns: 3 210px`를 줘서 행 폭 자체를 좁혔다(화면이 좁으면 자동 1단으로 줄어듦, 모바일 380px 확인). `.ss-row`엔 `break-inside: avoid`를 추가해 다단 사이에서 행 하나가 갈라지지 않게 했다. Playwright로 넓은 화면(3단)·모바일(1단) 렌더링을 실측 확인.

**2026-08-05(후속10) 전략검색 행 높이 과다 - post-single-body line-height 상속 수정**: 실배포 후 "행이 너무 넓다, UI 낭비"라는 스크린샷 리포트를 받았다. 원인은 `.ss-row`에 line-height를 직접 지정하지 않아 Tistory 글 본문 스타일(`style.css`의 `.post-single-body { line-height: 1.9 }`)이 그대로 상속된 것 - 13px 텍스트 한 줄에도 줄간격만 약 25px가 붙어 padding(9px×2)까지 더하면 행 하나가 44px에 달했다. `css/quick-indices.css`의 `.qi-news-item`이 이미 쓰던 패턴(줄간격을 직접 짧게 지정해 상속을 끊음)을 그대로 적용해 `.ss-row`에 `line-height: 1.3`을 명시하고 padding도 9px→6px로 줄였다(행 높이 약 44px → 30px, 32% 감소). `.ss-card-title`에도 동일하게 명시. 로컬에서 `.post-single-body` 컨텍스트를 그대로 재현해 수정 전/후 행 높이를 실측(43.7px → 29.9px)으로 검증. `css/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(후속9) 전략검색 목록을 카드/행 스타일로 전면 개편**: 사용자가 다른 위젯(js/sector-dashboard-v4.js, 섹터별 실시간 시세 - 제목 앞 파란 바 카드 + 종목명·가격·등락률 행)의 스크린샷을 주고 같은 스타일로 바꿔달라고 요청했다. 기존 박스형 그리드(`.ss-item`)를 걷어내고 카드(`.ss-card`, 제목 앞 파란 바) + 행 목록(`.ss-rows`/`.ss-row`) 구조로 다시 짰다 - 두 위젯이 서로 다른 Tistory Page라 CSS를 공유하지 않으므로 클래스는 `ss-` 접두사로 새로 정의(재사용 아님). 이전에 뺐던 "조건 충족" 배지도 요청대로 완전히 없앴고, breakout_fail(이탈 경보)은 배지 대신 행 배경색(호박색)+이름 앞 ⚠로 구분한다. 등락률 표시도 sector-dashboard와 동일하게 `▲/▼` 기호 형식으로 맞췄다. 시장구분(P=KOSPI/Q=KOSDAQ) 뱃지는 스크린샷에는 있지만 넣지 않았다 - sector-dashboard는 curated ~238종목 풀(`data/sectors-v3.js`, market 필드 있음)을 쓰는 반면 전략검색은 전종목(`data/krx_map.js`, market 필드 없음)을 스캔해서 근거 데이터가 없다(코드로 KOSPI/KOSDAQ을 추정하지 않음 - 미검증 값 확정 표시 금지 원칙).

"10개 전략이 한국투자증권 제공"이라고 써달라는 요청은 정확히 그대로 쓰지 않고 수정했다 - `kisyaml_strategy.py` 모듈 독스트링과 프리셋 야믈의 `author` 필드를 보면 한투증권(KIS) open-trading-api strategy_builder README에서 가져온 건 `.kis.yaml` "포맷" 자체와 골든크로스 1개(author: KIS, README 예시)뿐이고, 나머지 9개는 그 포맷 위에서 9Pay가 직접 만든 것(author: 9Pay)이라 "10개 다 한투증권 제공"은 부정확하다. 화면 하단 각주에 "전략 조건은 한국투자증권(KIS) open-trading-api strategy_builder의 .kis.yaml 포맷을 기반으로 구성했습니다(골든크로스는 원본 README 예시, 나머지 9개는 그 포맷 위에서 9Pay가 직접 구성)"라고 정확하게 밝혔다.

Playwright로 라이트·다크모드, 매칭 있음/없음, 이탈 경보 상태를 스크린샷 확인. `js/`·`css/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(후속8) 돌파 계열 2개 프리셋에 거래량 급증 확인 조건 추가**: `week52_high`(52주 신고가)·`volatility`(변동성 확장) - 프리셋 category가 실제로 `breakout`인 2개 - 는 가격만 보고 매칭돼 거래 없이 슬쩍 넘는 저거래량 돌파도 잡히는 문제가 있었다. 새 지표를 만들지 않고 기존 `disparity` 지표를 `field: volume`으로 재사용해(`kisyaml_strategy.py`의 `_disparity`는 field 종류를 안 가림 - "오늘 거래량 / 20일 평균 거래량 x 100") entry AND 조건에 "20일 평균 대비 1.5배 이상"을 추가했다(`vol_surge > 150`, 백테스트로 정한 값이 아닌 잠정 기준). 20일 평균에 오늘 거래량 자체가 포함돼 계산되는 한계(`highest`의 `exclude_current`와 달리 `sma`엔 없음)는 두 프리셋 야믈과 `_disparity` 독스트링에 명시했다. `breakout_fail`(카테고리는 stop_loss)은 신규 매수가 아니라 이탈 경보라 이번엔 대상에서 뺐다 - 필요하면 별도로. 합성 데이터로 "신고가인데 평시 거래량"은 HOLD, "신고가+거래량 2배"는 BUY로 갈리는 걸 직접 확인했고, 기존 `test/test_kisyaml_strategy.py`(18개)·`test/test_strategy_scan.py`(7개) 전부 통과. `scripts/cloud-vm/`은 `master` 반영 후 VM 자동 배포 대상(다음 크론 스캔부터 반영).

**2026-08-05(후속7) 전략검색 메타줄에 유동성 부족 제외 종목 수 노출**: 후속6에서 추가한 `skippedIlliquid`가 VM 캐시 JSON에는 있어도 GAS(`gas/ticker-proxy.gs`의 `getStrategyScanResult`)가 화이트리스트로 필드를 걸러 넘기고 있어 프론트까지 안 나오던 걸 연결했다. GAS 응답에 `skippedNoData`·`skippedIlliquid`를 추가하고, `js/strategy-search.js`의 메타줄에 "스캔 …·대상 N/M종목" 뒤에 값이 0보다 클 때만 "· 유동성 부족 제외 K종목"을 덧붙였다(값이 없는 구형 GAS 배포와도 안전하게 호환). **`gas/ticker-proxy.gs`는 GAS 관리자에서 새 버전으로 수동 배포해야 반영된다 - 아직 배포 전.** `js/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(후속6) 전략검색 유동성 하한 필터 추가**: 전략검색 10개 프리셋이 신호 조건만 보고 매칭해, 실제로 사고팔기 어려운 초소형·품절주도 조건만 맞으면 그대로 결과에 뜨는 문제가 있었다. `strategy_scan.py`의 `scan()`에 프리셋 평가 전 유동성 하한 필터를 추가했다 - 최근 20거래일 평균 거래대금(종가×거래량 근사)이 10억원(`MIN_AVG_TURNOVER`, 잠정값) 미만이면 어떤 프리셋과도 매칭시키지 않고 건너뛴다. 공식은 이미 검증되어 쓰이던 `pattern_detect.compute_volume_multiple()`(js/foreign-flow.js의 computeVolumeMultiple과 동일 공식)을 그대로 재사용해 새 계산 로직을 만들지 않았다. 이건 신호 조건(거래량 급증 등)이 아니라 "거래 가능한 종목만 보여준다"는 위생 필터라 10개 프리셋 전체에 공통 적용했다 - 개별 전략(예: 돌파 계열의 거래량 급증 확인 조건)은 별도로 다룰 예정. 캐시 JSON에 `skippedIlliquid` 필드를 추가했지만 GAS(`ticker-proxy.gs`의 `getStrategyScanResult`)가 아직 화이트리스트 방식으로 필드를 걸러 넘기고 있어 프론트까지는 노출되지 않는다(기존 `skippedNoData`도 동일하게 안 넘어가던 상태 - 필요하면 GAS 수동 배포와 함께 후속으로 노출). `test/test_strategy_scan.py`에 유동성 필터 단위테스트를 추가하고 기존 테스트의 `scan()` 반환값(3-tuple→4-tuple) 언패킹을 갱신, 합성 거래량도 필터를 통과하도록 조정해 7개 테스트 전부 통과 확인. `scripts/cloud-vm/`은 `master` 반영 후 VM 자동 배포 대상.

**2026-08-05(후속5) 전략검색 배지·클릭 이동 개선**: 전략검색(`/page/strategy-search`)에서 "종목마다 배지가 다 100%로 보인다"는 리포트를 받았다. 원인은 표시 로직이 아니라 데이터 구조 자체였다 - `strategy_scan.py`가 `kisyaml_strategy.evaluate()`의 entry 조건이 전부(AND) 충족된 종목만 매칭 결과에 담기 때문에(10개 프리셋 전략이 전부 entry.logic: AND), 종목마다 달라져야 할 `matched/total`·`confidence`가 구조적으로 항상 최댓값(=1/1, 100%)이 되어 배지가 아무 정보도 구분해주지 못하고 있었다. 백엔드 산식을 바꾸는 대신(새 "신호 강도" 공식을 임의로 만드는 건 미검증 값을 확정값처럼 쓰는 것과 같은 문제라 보류), 프론트(`js/strategy-search.js`)에서 그 숫자를 배지에 노출하지 않도록 바꿨다 - breakout_fail(손절 카테고리)은 그대로 "⚠ 이탈 경보", 나머지는 "조건 충족"만 표시한다. 추가로 종목 카드를 눌렀을 때 아무 반응이 없던 것도 리포트를 받아, 사이트에 이미 있는 종목분석 이동 방식(`js/stock-search-panel.js`·`js/watchlist.js`와 동일하게 `/page/foreign-flow?code=&name=`)을 그대로 연결해 펀더멘탈(PER·PBR·DART 재무)·차트·수급을 바로 확인할 수 있게 했다. `js/`·`css/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-05(후속4) 호가창 KRX+NXT 통합 조회 시도**: 호가창이 지금까지 KRX 단독인지 NXT 포함 통합인지 확인된 적이 없었는데(`API_REFERENCE.md`에 "시장 범위 명시 없음"으로 남겨둔 상태), 종목코드에 `_AL` 접미사(예: `005930_AL`)를 붙이면 통합 조회가 될 수 있다는 안내를 받아 `order_book.py`의 `ka10004`(호가)·`ka10003`(체결)·`ka10046`(체결강도) 호출에 적용했다. 이미 운영 중인 기능이라 접미사가 실제로 안 먹혀 빈 응답이 오면 원래 코드로 자동 재시도하는 폴백을 넣어 기존 KRX 단독 동작이 깨지지 않게 안전장치를 뒀다. 응답에 `stexTp`(거래소구분) 필드를 노출해 실제 통합 여부를 확인할 수 있게 했다. 배포는 됐지만 실제 통합 여부 검증은 장 시간 외(호가가 전부 0)라 확인이 안 됐고, 다음 거래일 장중(09:00~15:30 KST)에 `stexTp` 값과 잔량 규모를 보고 확정해야 한다(미검증 상태로 남김). `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-08-05(후속3) 호가창에 실제 체결강도(ka10046) 연동**: 호가창(`js/order-book.js`) HUD의 "체결강도"가 지금까지는 진짜 체결 데이터가 아니라 "추적 중인 매도벽이 2초 폴링 사이 얼마나 줄었는가"로 추정한 근사치였다. 키움 체결강도추이시간별요청(`ka10046`)이 실제 체결강도(`cntr_str`, 틱 기준·100=매수/매도 균형)를 직접 제공한다는 걸 공식 문서로 확인해(응답은 `cntr_str_tm` 리스트, 최신 항목이 맨 앞) `order_book.py`에 `fetch_execution_strength`를 추가하고 `/order-book/{code}` 응답에 `strength` 필드로 포함시켰다. 프론트는 이 값이 있으면 우선 쓰고(0~100 스코어 막대와 척도가 달라 200%를 만땅으로 재매핑), 장 시간 외처럼 정상적으로 빈 값일 때만 기존 매도벽 소진 근사치로 폴백한다. 필드명 확인 전 원본 응답을 그대로 노출하는 임시 진단 엔드포인트(`/_diag/execution-strength`)를 먼저 붙여 실호출로 검증한 뒤 파싱을 완성하고 진단 엔드포인트는 제거했다. `scripts/cloud-vm/`은 VM 자동 배포, `js/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-05(후속2) 매물대 카드에 평균단가(VWAP) 표시**: `/pbar-tratio` 응답에 `avgPrice`(Σ가격×거래량/Σ거래량, 거래량 가중평균가) 필드를 추가했다. `bins`가 이미 실제 체결가·체결거래량(비중% 아님)이라 정확히 계산되며, `price*volume`을 요청마다 그때그때 합산하는 방식이라 별도 DB 컬럼(`amount`)은 추가하지 않았다. 매물대 아파트 카드 요약줄에 POC 옆으로 표시해 사용자가 자기 평단과 비교해볼 수 있게 했다.

**2026-08-05(후속) 매물대 아파트 카드에서 "최근 120일(근사)" 뷰 제거**: 다일 누적 실제 체결가 뷰가 갖춰진 뒤 근사치 병행 노출이 "혼란만 가중시킨다"는 사용자 판단으로, "최근 120일(근사)" / "실제 체결가" 토글을 없애고 실제 체결가 뷰 하나로 통일했다. `computeVolumeProfile`(일봉 고가~저가 클라이언트 비례배분) 함수 자체는 차트 탭의 매물대 오버레이(`addVolumeProfileOverlay`, 별개 기능)가 여전히 쓰므로 남겨뒀고, 아파트 카드 쪽 호출부(`buildAptCard`/`wireAptTabs`)만 제거했다. 카드가 이제 항상 비동기로 `/pbar-tratio`를 불러오는 구조라 첫 렌더는 "불러오는 중" placeholder를 보여주고 응답이 오면 채운다. `js/`·`css/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-05 실제 체결가 매물대를 다일(多日) 누적으로 확장 + 구간 경계를 실제 호가에 맞춤**: 전날 추가한 "오늘"(KIS pbar-tratio) 뷰를 두 가지로 개선했다. (1) 층 경계 버그 수정: `computeTodayVolumeProfile`이 (최고가-최저가)/층수로 균등분할해 근사치와 똑같이 실존한 적 없는 가격을 층 경계로 쓰고 있었다(사용자가 "500원 단위지?"로 지적) - 정렬된 실제 체결가를 개수 기준으로 묶어 각 층의 저가/고가가 항상 pbar-tratio가 실제로 반환한 가격이 되도록 고쳤다(`aptBinIndex`/`aptBandRanges`도 균등폭 가정을 버리고 `bins[i].low/high`를 직접 훑도록 일반화). (2) 다일 누적: pbar-tratio는 "오늘"치만 주지만, 신규 SQLite 테이블 `volume_profile_daily`(code, trade_date, price, volume)에 조회될 때마다(배치 없이 온디맨드로, `kis_flow_cache`와 동일 패턴) 그날 최신 누적 스냅샷을 UPSERT해두면 - pbar-tratio 응답 자체가 이미 "그 시점까지의 당일 누적치"라 같은 날엔 덮어쓰기만 하면 되고, 날짜가 바뀌면 그 행은 더 갱신되지 않아 자연히 그날의 스냅샷으로 고정된다 - 여러 거래일치를 실제 체결가 기준으로 쌓을 수 있다는 걸 확인해 구현했다. `GET /pbar-tratio/{code}?days=N`이 요청마다 오늘 스냅샷을 저장하고 저장된 과거 거래일(최대 N-1개)과 오늘 실시간 응답을 가격별로 합산해 반환하며, 실제 반영된 거래일 수는 `daysIncluded`로 노출한다(온디맨드 적재라 "정확히 최근 N거래일"이 아니라 "조회된 적 있는 날짜 중 최근 N개" - 뜸하게 조회되는 종목은 커버리지가 듬성듬성할 수 있음, 알려진 한계). 200일 초과 데이터는 시간당 최대 1회 정리한다. 프론트 토글 라벨을 "오늘" → "실제 체결가"로 바꾸고 각주에 실제 반영된 거래일 수를 표시한다. DB 로직(덮어쓰기 vs 합산, 날짜 제외, 정리)은 임시 SQLite로 단위 검증했다. `scripts/cloud-vm/`은 VM 자동 배포, `js/`는 GitHub Pages 자동 배포 대상이며 신규 테이블은 첫 배포 시 `create_schema()`로 자동 생성된다.

**2026-08-04(후속) 종목분석 매물대 카드에 "오늘"(실제 체결가) 뷰 추가(VM 신규 엔드포인트 `/pbar-tratio`)**: 매물대 아파트 카드가 항상 "최근 120거래일 근사치"(일봉 고가~저가에 거래량을 비례 분산한 값, 실제 체결가 아님)만 보여주던 걸, 한국투자(KIS) 매물대/거래비중 API(TR `FHPST01130000`, [국내주식-196], HTS `[0113] 당일가격대별 매물대`와 동일)로 만든 "오늘" 뷰를 병행 추가했다. 이 API는 실제 체결가(`stck_prpr`)와 그 가격의 체결거래량(`cntg_vol`)을 직접 주지만 **오늘 하루치만** 제공해 - 기존 120일 근사치와는 성격이 다른 별개 정보라 서로 대체하지 않고 카드 안에 "최근 120일"/"오늘" 토글로 병행 노출한다. 시도했던 다른 두 경로는 폐기했다: 키움 `ka10025`(매물대집중요청)는 실호출 결과 종목 하나의 히스토그램이 아니라 매물집중비율 조건에 맞는 종목을 찾는 시장 전체 스크리너로 밝혀져 관련 코드를 되돌렸다. 요청 파라미터·응답 필드는 한국투자 공식 GitHub(`koreainvestment/open-trading-api`)의 예제 코드로 확인한 뒤 실호출(005930)로 최종 검증했다. `kis_client.py`에 `fetch_pbar_tratio` 추가, `main.py`에 `GET /pbar-tratio/{code}` 신설(`/ohlc-minute`와 동일하게 공개+CORS+rate limit, KIS 키 미설정 시 503), `js/foreign-flow.js`의 `wireAptTabs`가 토글 클릭 시 이 엔드포인트를 브라우저에서 직접 호출해 기존 아파트 시각화(층수 확대/축소 포함)를 그대로 재사용한다. `scripts/cloud-vm/`은 VM 자동 배포, `js/`·`css/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-04 증시검색 분봉 탭 추가(VM 신규 엔드포인트 `/ohlc-minute`)**: 증시검색(`js/stock-search.js`) 차트에 있던 분봉 탭이 "데이터 소스 없음"으로 비활성 상태였던 걸 실제로 연결했다. `scripts/cloud-vm/kiwoom_market.py`에 키움 `ka10080`(주식분봉차트조회) 호출 함수(`fetch_minute_ohlc`)를 추가하고 `main.py`에 `GET /ohlc-minute/{code}?tic_scope=1` 엔드포인트를 신설했다 - `ka10080`을 이 프로젝트에서 처음 실호출해 응답 필드명(`stk_min_pole_chart_qry`, `cntr_tm` 등)을 검증했다(005930 1분봉 정상 수신, 한 번 호출에 최근 며칠치가 옴). 인증은 `/ohlc`(GAS 경유, API 키 필요)와 달리 `/order-book`·`/foreign-flow`와 동일하게 공개(인증 없음) + CORS(`ghlee.tistory.com`만) + rate limit 패턴을 써서 브라우저가 VM을 직접 호출한다(VM 시크릿을 프론트 JS에 넣지 않기 위함). 실측으로 정규장 마감 후 15:20~15:30(종가 단일가) 구간의 거래량이 비정상적으로 크게 찍히는 걸 발견해(누적치로 추정, 이 값 자체는 미검증) 프론트가 09:00~15:20 구간만 걸러 캔들·거래량 차트에 반영한다. 일목균형표 구름대 투영은 분봉 간격을 지원하지 않아 분봉 탭에서는 건너뛴다(체크 시 "데이터 부족"만 표시). `scripts/cloud-vm/`은 master 반영 후 VM 자동 배포, `js/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-03(후속3) 구글 캘린더 API 키 GAS 이관 원복**: 앞선 후속2 작업에서 `js/stock-calendar.js`의 하드코딩된 Google Calendar API 키를 GAS `?action=calendarEvents` 프록시로 옮겼는데, 사용자가 GCP 콘솔에서 이 키에 리퍼러 제한(이 블로그 도메인만 허용)을 이미 걸어뒀다고 확인해 원복했다. 리퍼러 제한이 걸린 클라이언트 API 키는 다른 도메인에서 그대로 가져다 써도 호출이 거부되므로, 소스에 노출돼도 실질적인 남용 위험이 없어 GAS 경유가 불필요하다. `js/stock-calendar.js`를 API_KEY/CAL_ID 직접 호출 방식으로 되돌리고, `gas/ticker-proxy.gs`의 `?action=calendarEvents` 라우팅과 `getStockCalendarEvents_()` 함수를 제거했다(신규 스크립트 속성 `GOOGLE_CALENDAR_API_KEY`/`GOOGLE_CALENDAR_ID`는 더 이상 필요 없음). 링크 이스케이프(`escapeHtml`에 큰따옴표 처리 추가, `ev.link` 이스케이프)는 API 키 이슈와 무관한 별개의 방어 수정이라 그대로 유지했다. `docs/SOURCE_CODE_SPEC.md`·`docs/ARCHITECTURE_SPEC.md`도 이 결정을 반영해 갱신했다.

**2026-08-03(후속2) 백엔드·프론트엔드 속도·오류·보안 이슈 일괄 수정**: 앞선 전체 소스 점검에서 `scripts/cloud-vm/`·`js/`에 나온 이슈를 사용자 요청으로 마저 수정했다. 오류(데이터 정확성): `domestic_futures.py`의 `MINUTE_SYMBOLS`에서 `KOSPI200_NIGHT`를 제거해, `night_futures_ws.py`(실제 KIS 야간선물)와 서로 다른 데이터를 같은 DB 행에 번갈아 upsert하던 충돌을 없앴다(코스피 선물 페이지 야간선물 분봉이 간헐적으로 주간선물 시세로 뒤바뀌던 버그). 보안: (1) `main.py`의 `require_api_key`를 `hmac.compare_digest` 상수시간 비교로 교체. (2) `/investor-flow/{code}`·`/foreign-flow/{code}`·`/order-book/{code}`(종목코드별 캐시라 순회 남용에 취약)에 IP당 분당 요청 상한(`_check_rate_limit`, 각 30·30·60회)을 추가 - 정상적인 방문자 탐색은 여유 있게 허용하고 기계적 코드 순회만 제한한다. (3) `/ws/quotes`에 동시 연결 수 상한(`_WS_MAX_CONNECTIONS=200`)을 추가해 `Origin` 헤더 우회 시에도 자원 고갈 규모를 제한. (4) `js/stock-calendar.js`에 하드코딩돼 있던 Google Calendar API 키·캘린더 ID를 GAS `?action=calendarEvents` 프록시(`gas/ticker-proxy.gs`, 스크립트 속성 `GOOGLE_CALENDAR_API_KEY`/`GOOGLE_CALENDAR_ID` 필요)로 이관해 다른 시크릿과 동일하게 관리한다 - 프론트 파일에는 더 이상 키가 없다. (5) `js/marketcap-bubble.js`의 툴팁 3곳과 `js/quick-indices.js`의 도달 불가 죽은 코드 2곳에 기존 `escapeHtml`/`escapeNewsHtml`을 적용했다. 속도: `main.py`의 메모리 캐시 6개(`_ohlc_cache`/`_investor_flow_cache_mem`/`_foreign_flow_cache_mem`/`_futures_cache`/`_order_book_cache`/`_earnings_calendar_cache`)를 상한 도달 시 전량 비우기(`cache.clear()`)에서 `OrderedDict` 기반 LRU(`_evict_lru`, 1건씩만 제거)로 교체해 트래픽 스파이크 시 콜드패스 몰림을 줄였다. `kis_client.py`의 옵션수급 5분 폴링마다 상시 실행되던 디버그 크로스체크 API 호출과 응답 원문 로깅(+ 이제 미사용인 `fetch_option_quote` 함수)을 제거했다 - 콜/풋 자동 교정 로직(delta 부호 기반)은 그대로 유지. 미수정으로 남긴 것: `js/skin-menu.js`의 `.nav-logo-name` 깨진 문구는 브랜드 문구라 사용자 확인 없이 임의로 바꾸지 않았다. `finance.naver.com/item/short_trade.naver` 컬럼 순서 자체의 실검증은 외부망 접근이 필요해 이 세션에서는 못했다(개발자가 `DEBUG_ACCESS_KEY` 설정 후 확인). `/ws/quotes`의 `Origin` 헤더 우회 가능성 자체(별도 인증 토큰 필요)는 더 큰 구조 변경이라 보류했다. Python은 `py_compile`, GAS·JS는 Node `--check`로 문법을 검증했다(fastapi/pytest 미설치 환경이라 런타임 테스트는 실행하지 못함 - 배포 후 확인 권장). `scripts/cloud-vm/`은 master 반영 후 VM 자동 배포, `gas/ticker-proxy.gs`는 script.google.com 수동 재배포(+ 신규 스크립트 속성 2종 설정)가 필요하다. `docs/SOURCE_CODE_SPEC.md`·`docs/ARCHITECTURE_SPEC.md`의 해당 항목에 수정 여부를 반영했다.

**2026-08-03(후속) GAS 프록시 속도·오류·보안 이슈 일괄 수정**: 같은 날 앞선 전체 소스 점검에서 `gas/ticker-proxy.gs`에 나온 이슈를 사용자 요청("전부 다")에 따라 실제로 수정했다(git push만으론 반영 안 됨 — script.google.com에서 수동 재배포 필요). 보안: (1) `cacheKeyFor`에 `quotes_` 네임스페이스를 추가해 `?codes=` 값이 다른 라우트의 고정 캐시 키(`ticker_market_ribbon3` 등)와 충돌해 무인증 GET 1건으로 운영 캐시를 오염시키던 경로를 막았다. (2) `getFlowAiSummary`가 `name`/`*Note`/`verdictLabel`을 검증 없이 Groq 프롬프트에 넣던 것을 길이 제한(200자)·제어문자 제거로 정제하고, 정제된 값의 해시를 캐시 키에 포함시켜 위조 입력이 정상 캐시를 덮어쓰지 못하도록(별도 슬롯 격리) 바꿨다. (3) 인증 없이 열려 있던 `?debugShortNaver=1`을 스크립트 속성 `DEBUG_ACCESS_KEY` 검증으로 잠갔다(속성 미설정 시 기본 비활성화). (4) 소스 주석에 남아있던 VM 실 IP를 플레이스홀더로 교체했다. 오류: (1) `getFlowAiSummary`/`getMarketAnalysis`/`getKospiFuturesAnalysis`/`getSubIndexAnalysis`/`getMarketTempBriefing` 5곳의 "실패 시 2분 캐싱" 로직이 빈 문자열을 falsy로 오판해 무력화되던 버그를 `cached !== null` 판정으로 수정하고, 실패 캐시가 없던 분기에도 추가했다. (2) 캐시값 `JSON.parse(cached)`를 무방비로 호출하던 8곳을 공용 헬퍼 `parseCachedJson_`로 통일해 캐시 손상 시 위젯 전체가 깨지는 대신 새로 조회하도록 했다. (3) 하루 1회 트리거 `logDailyMarketTemp_()`를 `safeCall`로 감싸 `getMarketTemp()` 예외가 트리거 실행 자체를 막지 않도록 했다. 속도: `computeCombinedFlowScore_`가 foreign/inst 계산을 위해 동일 종목(069500) 수급을 2번 크롤링하던 것을 1번으로 줄이고, `getMarketTemp()`가 `sectors-v3.js`를 2번(태그 없는 버전+태그 있는 버전) fetch하던 것을 1번으로 합쳤다. `fetchQuotesWithCap`(히트맵)과 `getRankingNews`(랭킹뉴스)의 순차 `UrlFetchApp.fetch` 반복을 같은 파일의 `fetchDailyOhlc_`가 이미 쓰던 `fetchAll` 병렬 패턴으로 교체했다. `getMarketTemp()`의 나머지 독립 호출(VIX/52주/환율/미국선물) 전면 병렬화는 재구조화 리스크 대비 효과가 작아 보류했다. 미수정으로 남긴 것: `finance.naver.com/item/short_trade.naver` 컬럼 순서 자체의 실검증(외부망 접근 불가 - 개발자가 `DEBUG_ACCESS_KEY` 설정 후 `?debugShortNaver=1`로 직접 확인 필요), `.nav-logo-name` 깨진 문구(프론트, 사용자 확인 필요), VM(`main.py`)의 레이트리밋 부재·`/ws/quotes` Origin 검사 우회 가능성·`require_api_key` 비상수시간 비교, `js/stock-calendar.js`의 Google Calendar API 키 하드코딩, `js/marketcap-bubble.js`의 이스케이프 누락 — 전부 프론트·백엔드(Python) 영역이라 이번 GAS 작업 범위 밖으로 남겼다. Node `--check`로 문법 검증했다. `docs/SOURCE_CODE_SPEC.md`·`docs/ARCHITECTURE_SPEC.md`의 해당 항목에 수정 여부를 반영했다.

**2026-08-03 전체 소스 점검 및 정의서 3종 신설**: 프론트 25개 JS(16,576줄)·CSS 22개, GAS 단일 파일(3,090줄), 백엔드 38개 Python(8,664줄) 전체를 직접 읽어 속도·오류·보안 관점으로 점검했다(보안은 수정하지 않고 발견 사실만 기록). 주요 발견: (1) GAS `?codes=` 캐시 키가 형식 검증 없이 다른 라우트의 고정 캐시 키(`ticker_market_ribbon3` 등)와 충돌할 수 있어 무인증 단일 GET으로 운영 캐시를 오염시킬 수 있음(보안, 높음) — 미수정. (2) `getFlowAiSummary`가 `name`/`*Note`/`verdictLabel` 등을 검증 없이 Groq 프롬프트에 삽입하고 결과를 캐싱해 프롬프트 인젝션·쿼터 남용 벡터가 됨(보안, 중간) — 미수정. (3) `domestic_futures.py`와 `night_futures_ws.py`가 코스피200 야간선물 분봉을 서로 다른 소스로 같은 SQLite 행에 upsert해 차트가 간헐적으로 주간선물 시세로 뒤바뀔 수 있음(오류) — 미수정. (4) GAS AI요약 5개 엔드포인트의 실패-캐시가 빈 문자열 falsy 판정으로 무력화돼 의도한 백오프가 동작하지 않음(오류) — 미수정. (5) `js/stock-calendar.js`의 Google Calendar API 키 하드코딩은 기존에 이미 알려진 노출 상태임을 재확인. 이 점검 결과를 근거로 `docs/SOURCE_CODE_SPEC.md`(파일별 역할·함수·품질점검), `docs/ARCHITECTURE_SPEC.md`(컴포넌트·인증·캐싱·동시성 상세), `docs/DB_SPEC.md`(SQLite 2종 ERD·컬럼 정의·파일 기반 캐시/정적데이터)를 신설하고 `docs/README.md` 안내 표에 등록했다. 코드는 변경하지 않았으며 위 이슈들은 후속 수정 과제로 남겨둔다.

**2026-08-01 홈·시장·캘린더 로딩 및 데이터 표시 안정화**: 홈의 투자자 매매동향·글로벌 지표·실시간 랭킹·상단 차트는 마지막 정상 응답을 localStorage에서 먼저 표시하고 백그라운드 갱신하도록 바꿨다. 느린 시총 버블 업종 요약과 글로벌 평균선 조회는 첫 페인트 이후로 지연했다. `오늘 신규 발견`은 브라우저의 오늘 날짜가 아니라 최신 스캔의 마지막 거래일을 기준으로 집계해 주말·휴장일 0건 문제를 수정했다. 마켓브리핑 일반 카드도 각 글의 `더 보기` 버튼을 표시한다. 공시 리본은 KRX 공시와 주요 증시 뉴스를 동시에 조회해 공시·뉴스를 번갈아 보여준다. 캘린더는 DART에 실제 접수된 잠정실적/실적 공시를 VM `/earnings-calendar`에서 받아 Google Calendar 일정과 병합하고 15분마다 갱신한다. 미래 발표일을 임의로 생성하지 않으며, DART 키/서비스가 없으면 기존 Google Calendar만 유지한다. 정적 자산은 GitHub Pages, VM 라우트는 VM 배포 후 반영이 필요하다.

**2026-08-02 매물대 아파트 카드 개편: 매수/매도벽 폐기, 순수 거래량 매물대 + 층수 확대/축소**: 개인·외국인·기관별 매수/매도벽으로 나눠 보여주던 이전 버전(같은 날 앞서 추가한 기간 선택 버튼 포함)을 사용자 요청("매도벽은 필요 없다, 토스처럼 그냥 매물대(거래량)만 보여달라")으로 전면 교체했다. 이제 차트 탭의 매물대 오버레이(VP)와 동일한 계산(`computeVolumeProfile` - 일별 고가~저가 구간에 거래량을 분산해 가격대별로 합산)을 아파트 형태로만 다르게 그리며, 개인/외국인/기관 탭과 매도벽·매수벽 구분, "매도 우위/매수 우위 구간" 통계 카드를 모두 제거했다. 데이터 소스도 수급 API(`/foreign-flow`, 63거래일 상한)에서 `chartData.daily`(가격+거래량, 최대 약 500거래일)로 바꿔 훨씬 긴 이력을 반영할 수 있게 됐다. 기간 선택 버튼 대신 카드 안에 확대(+)/축소(-) 버튼을 둬 층수(12/18/24/36/48층)를 즉시 바꿀 수 있다 - 이미 받아온 `chartData.daily`만으로 클라이언트에서 재계산해 서버 재조회가 없다(토스 차트에서 확대·축소하면 매물대가 다시 그려지는 것과 같은 반응성을 층수 조절로 구현). 옥상 헬리패드·사다리·로비·지하실 같은 기존 장식 요소는 그대로 유지하고 각 층의 막대만 매수/매도 듀얼 바에서 거래량 단일 바(POC 강조)로 바꿨다. `js/foreign-flow.js`의 `computeVolumeProfile`을 lookbackDays/binCount를 받는 함수로 일반화해 차트 탭 오버레이와 아파트 카드가 같은 계산을 공유한다. `js/`·`css/`는 GitHub Pages 자동 배포 대상이며 백엔드 변경은 없다.

**2026-08-02 종목분석 펀더멘탈·모멘텀 탭 데이터 복구**: 두 탭이 비어 보이는 원인을 각각 확인해 수정했다. 펀더멘탈은 GAS `getFundamentals_`가 종목 하나를 보여주려고 전 종목 배치 캐시(`/fundamentals-batch`, 수 MB)를 매 요청 통째로 받아 파싱하고 있어 프론트 20초 타임아웃에 걸릴 수 있었다. VM에 단건 조회 `/fundamentals/{code}`를 추가하고(같은 `fundamentals_cache.json`을 파일 mtime 기준으로만 재파싱해 메모리 보관, 해당 종목만 잘라 반환) GAS가 이를 우선 사용하도록 바꿨다. 기존 배치 경로는 VM 미배포 상황을 위한 폴백으로 남기고, 종목별 응답은 GAS `CacheService`에 6시간 캐시한다(DART 재무는 하루 1회 갱신이라 신선도 손실 없음). 모멘텀은 배치가 파일럿 8종목만 수집하고 있어 그 외 종목은 원래부터 데이터가 없었다. `news_momentum_scan.py --full`을 전 상장종목 대상 이어달리기로 바꿔(`news_momentum_cursor.json` 커서, 회차당 20분 시간 예산, 같은 날 재조회 스킵) `deploy_check.sh`가 파일럿 목록 대신 `--full`로 실행하도록 변경했다. 호출 예산은 네이버 검색 API 실제 한도(일 25,000회·월 775,000건 통합 관리)와 같은 키를 쓰는 `/naver-news`의 하루 300회 남짓을 반영해 일 22,000회·월 680,000회로 두고 KST 일·월 단위로 누적하며, 남은 예산이 더 작은 쪽을 회차 상한으로 쓴다. DataLab은 별개 한도라 하루 900회를 유지했다. 시간 예산으로 슬라이스만 끝나면 종료코드 2로 알려 날짜 마커를 기록하지 않고 기존 5분 배포 타이머가 같은 날 안에서 커서를 이어받게 했다(전수 커버리지가 며칠이 아니라 몇 시간 안에 채워진다). 호출 예산 소진이나 전수 완료는 종료코드 0으로 그날을 마감한다. 개별 종목 실패는 커서를 넘겨 다음 종목을 막지 않으며, 전량 실패일 때만 배치 실패로 본다. 프론트는 펀더멘탈 캐시 히트 경로가 동기 실행이라 렌더 예외 시 탭이 빈 화면으로 남던 문제를 try/catch로 막고, `annual`은 있는데 `years` 배열이 없는 응답도 "데이터 없음"으로 처리한다. 모멘텀 빈 상태는 기능 비활성화·수집 대기·반복 이슈 없음을 구분해 안내한다. Python 28건(커서 회전·복구·KST 날짜 판정·일/월 예산 소진·슬라이스 종료코드·단건 엔드포인트 포함), UI 계약 15건, Chromium 실측 14건, flock 종료코드 분기 실측 4건, JS·GAS·bash 문법 검사를 통과했다. `scripts/cloud-vm/`은 VM 자동 배포, `js/`는 GitHub Pages 자동 배포, `gas/ticker-proxy.gs`는 GAS 웹앱 수동 재배포가 필요하다.

**2026-08-02 모멘텀 검색 관심도 검색어 확장**: 모멘텀 카드의 `검색 관심도`가 대부분 `데이터 부족`으로 뜨는 원인을 확인했다. DataLab 검색어를 만드는 `_keyword_group()`의 확장 규칙이 공장·HBM·AI 반도체 3개에만 하드코딩돼 있어서, 그 외 이슈는 `종목명 + 라벨 전체`라는 롱테일 문구 하나로만 조회됐다(예: `한화오션 조원 돌파`). 아무도 그렇게 검색하지 않으니 DataLab이 빈 응답을 반환했다. 규칙 라벨 12종을 `ISSUE_SEARCH_TERMS` 표로 옮겨 실제로 검색되는 짧은 표현을 함께 넣고, `{지역}공장 신설/증설`은 규칙으로 생성한다. 표에 없는 폴백 라벨은 그 이슈 기사 제목에서 2건 이상 반복된 핵심어를 검색어로 쓴다(`한화오션 조원 돌파` → `한화오션 수주잔고`). 정도어(증가·확대·돌파 등)와 단위어(조원·억원 등)는 종목명과 붙여도 검색되지 않으므로 단독 검색어에서 제외했다. 변별력은 세 겹으로 보장한다 - 모든 키워드가 종목명을 포함하고, 종목명 단독 키워드는 만들지 않으며, 같은 종목의 이슈끼리 겹치는 키워드는 `_drop_shared_keywords()`가 양쪽에서 제거하되 이슈마다 고유한 `종목명 + 라벨 전체`는 항상 남겨 빈 묶음이 생기지 않게 한다. 실적 개선/부진은 공통어 `실적`을 쓰지 않고 서로 다른 표현만 쓴다. 검색어가 바뀌면 기존 `query_version` 증가 로직이 다음 배치에서 DataLab을 자동 재조회하므로 별도 마이그레이션은 없다. Python 30건(표 확장·폴백 핵심어·정도어 제외·이슈 간 키워드 겹침 0 검증 포함)을 통과했다. `scripts/cloud-vm/`은 VM 자동 배포 대상이며 값은 다음 배치 회차부터 채워진다.

**2026-08-02 수급 개인 데이터 재시도 + 모멘텀 가격서술 라벨 억제**: 두 사용자 리포트(비에이치아이 실측)를 원인부터 확인해 수정했다. (1) 종목분석 수급 표의 개인 열이 통째로 `-`였던 원인은, VM 경로(`/foreign-flow/{code}`, 키움·KIS 기반)만 개인 순매매를 제공하고 네이버 폴백(`finance.naver.com/item/frgn.naver` 크롤링)은 그 페이지 자체에 개인 열이 없어 구조적으로 항상 비어 있는데, 프론트가 VM이 한 번만 실패해도 재시도 없이 곧장 네이버로 넘어갔기 때문이다. `js/foreign-flow.js`의 `fetchFlow()`가 폴백 전에 VM을 800ms 뒤 한 번 더 재시도하도록 바꿔, 일시적 VM 오류로 인한 개인 데이터 손실 빈도를 줄였다. 재시도까지 실패하면 기존대로 네이버로 폴백하며, 그 경우 개인 데이터는 여전히 원본에 없으므로 `-` 표시를 유지한다(임의로 채우지 않음). (2) 모멘텀 탭에 "장중 하락"·"마감 하락"·"마감 상승" 같은 라벨이 뜨던 원인은 `news_momentum.py`의 `_issue_labels()` 폴백 규칙("핵심명사 + 사건어")이 시점어(장중/마감/개장 등)를 핵심명사로, 종목명 자체를 핵심명사 후보로 오인했기 때문이다. 이런 제목은 그 시점에 오르거나 내렸다는 것 외엔 정보가 없어 이 탭이 구분하려는 "가격 변동이 아닌 뉴스 반복성"에 해당하지 않는다. `MARKET_SESSION_WORDS`(장중/마감/개장/특징주/장초반/장마감/시가/종가)와 종목명을 핵심명사 후보에서 제외해 이런 제목은 아예 라벨을 만들지 않도록 했고, 같은 필터를 `_keyword_group()`의 DataLab 검색어 확장에도 적용했다. `한화오션 조원 돌파` 같은 실제 사건 라벨(핵심명사가 시점어가 아닌 경우)은 영향받지 않는다. Python 33건(가격서술 라벨 0건 검증, 종목명 자기중복 방지, 실제 사건 라벨 보존 회귀 포함), UI 계약 15건, Playwright 실측 2건(VM 재시도 성공 시 네이버 미호출, 재시도까지 실패 시 정상 폴백)을 통과했다. `js/`는 GitHub Pages, `scripts/cloud-vm/`은 VM 자동 배포 대상이며 라벨 필터는 다음 배치 회차부터 반영된다.

**2026-08-02 가격서술 노이즈 이슈 1회성 정리**: 배치 코드를 고쳐도 `news_topics`에 이미 저장된 "장중 하락"·"마감 상승" 같은 노이즈 행은 자동으로 안 지워지는 걸 확인해 별도 정리 스크립트를 추가했다. `news_topics`는 원문 제목을 저장하지 않고 `topic_name`(종목명+라벨)만 남기므로, `cleanup_price_recap_topics.py`는 라벨이 정확히 2단어이고 첫 단어가 `MARKET_SESSION_WORDS`(장중/마감/개장 등)이거나 종목명 자체인 행만 역으로 식별해 삭제 대상으로 잡는다. 정규식 규칙 라벨(HBM 수요 증가·신규 수주 등)이나 "한화오션 조원 돌파" 같은 실제 사건 폴백 라벨은 이 조건에 걸리지 않아 보존된다. 기본은 미리보기(dry-run)만 하고, `--apply`를 명시해야 실제로 지우며 그 직전에 `backup_sqlite.py`로 `news_momentum.db`를 자동 백업한다(FK CASCADE로 딸린 일별 데이터·검색트렌드도 함께 삭제되는 되돌릴 수 없는 작업이라 백업을 건너뛰지 않는다). `deploy_check.sh`는 마커 파일(`PRICE_RECAP_CLEANUP_MARKER`)로 게이팅해 배포마다 반복 실행하지 않고 1회만 적용하며, 실패 시 마커를 남기지 않아 다음 5분 회차가 재시도한다. Python 4건(정상/노이즈 판정 정확성, dry-run 미삭제, apply 시 CASCADE·백업, DB 없음 no-op)과 배포 계약 테스트 갱신을 통과했다.

**2026-08-02 모멘텀 전종목 배치 종목간 딜레이 누락 긴급 수정**: `--full` 전 종목 확대 배포 직후 VM 전체가 눈에 띄게 느려진다는 사용자 실측 리포트(로컬 `clear` 명령조차 느려짐 - 네트워크·API와 무관한 순수 자원 경합 신호)를 받아 원인을 확인했다. `news_momentum_scan.py`는 종목마다 여러 번 네이버 API를 호출하면서도 종목 사이 딜레이가 전혀 없었다 - 파일럿 8종목일 땐 티가 안 났지만 전 종목(약 2,700개)으로 커지면서 CPU·디스크 I/O 경합을 일으킨 것으로 추정된다. 같은 저장소의 다른 배치(`batch_scan.py`)는 이미 종목마다 `THROTTLE_SEC=0.25`초를 쉬어가는 게 기존 관례였는데 새 배치에서 이걸 빠뜨렸다. 동일한 `THROTTLE_SEC=0.25`를 추가해 성공·실패 관계없이 매 종목 처리 후 쉬어가도록 했다(`finally` 블록 - `batch_scan.py`와 동일 배치 위치). Python 38건(신규 스로틀 호출 횟수·값 직접 검증 포함, 실제 `time.sleep`은 테스트에서 패치해 무자원 실행)을 통과했다. VM 자원 상태 자체는 이 수정만으로 즉시 해소되지 않을 수 있어(이미 쌓인 지연·잔여 프로세스는 별개) 배포 후 VM에서 직접 확인이 필요하다.

**2026-08-02 VM 장애 대응: SQLite 백업 재시작 증폭 버그 긴급 수정**: 사용자가 종목분석 개인수급 미표시를 신고한 뒤 VM에서 실측(`top`, `ps aux`, `/proc/PID/io`)한 결과, `deploy_check.sh`가 배포 때마다 실행하는 `backup_sqlite.py`(`ohlc_snapshot.db` 백업)가 40분 넘게 `D`(디스크 I/O 대기) 상태로 멈춰 디스크 I/O를 95%대로 포화시키고 있었다(`load average` 9대, FastAPI(uvicorn) 프로세스 자체도 응답 불가 상태). `/proc/PID/io`로 확인하니 200MB 짜리 DB를 백업하며 59GB(약 300배)를 이미 써버린 상태였다. 원인은 예전 `sqlite3.Connection.backup()`(온라인 백업 API)의 공식 동작 - 백업 도중 원본이 바뀌면(WAL 체크포인트 포함) 처음부터 다시 복사를 시작한다 - 이었다. `ohlc_snapshot.db`는 실시간 시세 WebSocket 중계가 초당 여러 번 커밋하는 라이브 DB라, 40분 넘는 백업 동안 이 재시작이 반복되며 같은 데이터를 계속 다시 썼다. `backup_sqlite.py`를 `VACUUM INTO`(SQLite 3.27+, 단일 트랜잭션으로 시작 시점 스냅샷을 원자적으로 복사 - 재시작 문제 자체가 없음)로 교체했다. Python 신규 2건(배경 스레드로 쉬지 않고 커밋하는 동안에도 10초 안에 끝나는지 직접 검증, 백업 대상 경로가 이미 있을 때 기존 파일을 건드리지 않고 명확히 실패하는지 검증) + 기존 백업 계약 테스트 포함 40건을 통과했다. 이 사고와는 별개로 같은 세션에서 `news_momentum_scan.py --full`(전 종목 배치)에 종목간 딜레이가 없던 것도 함께 발견해 `THROTTLE_SEC=0.25`(기존 `batch_scan.py`와 동일 값)를 추가했다 - 둘 다 VM 자원 경합에 기여했을 수 있어 함께 반영한다. 이미 멈춰있던 백업 프로세스는 VM에서 직접 `kill`로 종료했다(원본 DB는 읽기 전용 연결이라 안전). `scripts/cloud-vm/`은 master 반영 후 VM 자동 배포 대상이며, 다음 배포부터 새 백업 로직이 적용된다.

**2026-08-02(후속) VM 장애 실측 해소 확인 및 전종목 배치 첫 가동**: 위 수정 배포 과정에서 짧은 시간에 여러 커밋을 연속 push하면서 `deploy_check.sh`가 각 push마다 재트리거돼, 옛 버그 버전 백업이 VM에서 두 번 더(총 세 번) 폭주해 재발했다 - 매번 `/proc/PID/io`로 실제 진행 여부를 확인하고 원본은 읽기 전용이라 안전함을 확인한 뒤 `kill`로 종료했다. 이 과정에서 `deploy_check.sh`가 동시 실행을 막는 잠금장치(`flock`) 없이 배포 타이머와 수동 실행이 겹칠 수 있다는 별도 문제도 발견했다(아직 미수정 - 후속 과제). `VACUUM INTO` 배포 후 백업이 `integrity=ok`로 정상 완료되고 `%wa`가 95%대에서 0%대로, load average가 9대에서 1대로 떨어진 것을 `top`으로 확인해 사고를 종료했다. `post_deploy_check.py`가 `/health`·`/ohlc/005930`·`/news-momentum/000660`·모멘텀 DB 파일럿 8종목 커버리지를 모두 PASS했고, `cleanup_price_recap_topics.py`는 파일럿 8종목에서 실제로 29건("마감 급락"·"마감 하락"·"마감 상승"·"장중 하락"·"장중 상승"·"마감 최대"·종목명 축약형 자기중복 등)을 백업 후 삭제했다. 오늘 자정 이전에 파일럿 8종목 기준으로 이미 한 번 정상 완료돼 있던 일일 마커 때문에 `--full` 배치가 자동으로는 트리거되지 않는 것을 확인해, `news_momentum_scan.py --full`을 VM에서 직접(nohup, 절대경로, `-u` 무버퍼 옵션으로) 1회 수동 실행했다. 20분 시간 예산 안에서 신규 96종목 처리(+이미 처리된 60종목 스킵) = 3,913종목 중 156종목 커버, 이슈 2,530개 발견, 뉴스 API 896회 사용(일 예산 22,000회의 4%), 실패 0건으로 정상 종료했다(`중단사유 time-budget-exhausted`, 다음 커서 156 저장). 나머지는 다음 날(KST 날짜 변경)부터 배포 타이머가 자동으로 이어서 처리한다.

**2026-08-01 BHI 종목분석 누락 데이터 안정화**: 네이버 수급 폴백에 개인 순매매 필드가 없는 경우 `undefined × 종가` 계산으로 발생하던 `NaN`을 `-`로 바꾸고, 개인 데이터를 임의로 0으로 추정하지 않도록 했다. 일봉 API가 실패해도 수급 종가·거래량으로 차트와 매물대를 임시 표시하며, 원천 OHLC가 복구되면 자동 교체하도록 보완했다. 밸류에이션 응답이 비어도 DART 연간·분기 실적과 실시간 PER/PBR/EPS 부재를 분리해 표시한다. 정적 JS와 GAS 소스를 문법·브라우저 화면에서 검증했으며, GAS 폴백은 웹앱 수동 재배포 후 운영 반영된다.

## 기록 규칙

- 작업을 수행한 AI 또는 개발자가 별도 요청 없이 기록한다.
- 날짜(KST), 목적, 주요 변경, 검증·배포 결과를 간결하게 남긴다.
- 사소한 문구 수정, 단순 색상 조정, 반복된 후속 수정은 기록하지 않는다.
- 같은 작업의 후속 변경은 기존 항목에 합치거나 바로 아래에 추가한다.
- API 키, 토큰, 계정정보, 응답 원문 등 민감정보는 기록하지 않는다.

**2026-07-28 새로고침 시 검은 영역 FOUC 수정**: 라이트모드 새로고침 때 화면 상단 일부가 검게 먼저 나타났다 흰색으로 바뀌는 현상은 다크모드 초기화 문제가 아니라, 2026-07-16에 폐기된 구형 `#market-ribbon`의 CSS/JS 실행 시점 차이였다. `skin.html`에 빈 컨테이너와 `css/market-ribbon.css`/`js/market-ribbon.js` 로드가 남아 있는데, CSS가 먼저 높이 32px·검은 배경의 fixed bar를 페인트하고 `defer`된 JS가 DOMContentLoaded 이후에야 인라인 `display:none`을 적용했다. `css/market-ribbon.css`의 첫 규칙에 `.market-ribbon{display:none!important}`을 추가해 첫 스타일 계산부터 숨기도록 수정했다. 이제 JS 로드·DOMContentLoaded·네트워크 속도와 무관하게 검은 바가 한 프레임도 노출되지 않는다. 구형 규칙과 JS는 롤백 이력 때문에 유지한다.

**2026-07-28 종목분석 목록·패널·매물대 UI 개선**: 투자시그널 등급 버킷의 100종목 제한을 3,000으로 확대해 보유 835종목을 포함한 스캔 전종목을 검색·필터할 수 있게 하고, bucket tuple 뒤에 종합점수와 거래대금(`[code,name,price,changeRate,stars,totalScore,tradingValue]`)을 추가했다. 프론트는 전체 데이터를 한 번에 DOM에 만들지 않고 20개씩 점진 렌더링하며 종합점수·등락률·거래대금·종목명 정렬을 지원한다. 목록 제목에는 조건별 실제 건수와 정렬 기준을 함께 표시한다. 미선택 `ffSigBanner`는 `[hidden]{display:none!important}`으로 첫 화면의 빈 파란 바와 여백을 제거했다. PC의 목록·상세 카드는 오른쪽 상세 높이에 맞추고 목록만 내부 스크롤하며, 모바일은 세로 스택과 20개 더보기를 유지한다. 상세의 판정 카드와 항목별 점수 사이 간격을 14px(모바일 11px)로 분리했고, 매물대 지상/B1/B2 외곽선은 1px 저채도 선으로 줄였다. 새 bucket 데이터는 다음 `daily_scan.py` 배치부터 채워지며 기존 5칸 tuple도 프론트에서 호환한다.

**2026-07-29 종목뉴스 종목분석 요약 의존성 수정**: 종목뉴스의 `loadAnalysis()`는 `ForeignFlow.fetchAnalysisSummary()`를 호출하면서도 `/page/stock-news`에 `js/foreign-flow.js`가 별도로 삽입돼 있다고 가정해, 페이지 편집에서 해당 스크립트가 빠지면 항상 “종목분석 데이터를 사용할 수 없어요”만 표시했다. `stock-news.js`가 자신의 CDN URL을 기준으로 같은 디렉터리의 `foreign-flow.js`를 한 번만 지연 로드하는 `ensureForeignFlow()`를 추가했다. 이제 티스토리 페이지 HTML을 수동 수정하지 않아도 요약 패널이 로드되며, 의존성 로드 실패 시 재시도할 수 있도록 실패한 Promise 캐시는 비운다.

**2026-07-29 뉴스·검색 관심도 모멘텀 8종목 파일럿**: 가격 모멘텀과 구분되는 이슈·재료 지속성 탭을 종목분석에 추가했다. `news_momentum.py`는 기존 `ohlc_snapshot.db`를 건드리지 않고 별도 `news_momentum.db`에 `news_topics`/`news_topic_daily`/`datalab_trends`/`news_stock_coverage`와 필수 인덱스를 만들며 WAL/NORMAL/foreign_keys/busy_timeout/temp_store 설정을 적용한다. 기사 원문·HTML·이미지는 저장하지 않고 서로 다른 제목 2건 이상에서 반복된 복합 이슈, 일별 건수, 대표 URL 최대 3개, 방향성, NAVER Search Trend 상대지수만 저장한다. `news_momentum_scan.py`는 기본 실행 시 SK하이닉스·삼성전자·현대차·비에이치아이·한화오션·NAVER·LG전자·에코프로비엠만 처리한다. 뉴스는 최신순 최대 1,000건을 최근 90일 경계까지 백필하며 실제 기준일과 백필 완료/부분 상태를 API·화면에 표시한다. DataLab은 활성 이슈 최대 5개를 한 요청으로 묶고 같은 query_version은 하루 1회만 갱신한다. `/news-momentum/{code}`는 DB만 읽고 `NEWS_MOMENTUM_ENABLED` Feature Flag를 지원한다. 프론트 모멘텀 탭도 최초 진입 때 이 API만 지연 호출하며, 종목뉴스 요약의 예전 가격 기반 “모멘텀”은 “가격추세”로 개칭했다. `deploy_check.sh`는 배포 전 Python sqlite3 backup API로 `ohlc_snapshot.db`를 백업·검증하고 health/기존 OHLC 회귀검사 후 배포 SHA를 기록한다. 모멘텀은 기존 `kiwoom-deploy.timer` 안에서 `goodbyestarwars`, `/home/goodbyestarwars/kiwoom-api`, venv Python 절대경로, `flock`, Asia/Seoul 날짜 마커로 별도 실행한다. 배치·DB·모멘텀 API가 모두 성공한 뒤에만 날짜 마커를 기록하며 실패는 기존 배포나 FastAPI 재시작을 롤백하지 않고 다음 5분 회차에서 재시도한다. 별도 systemd 유닛과 모멘텀용 sudo는 없다. 실패 진단은 키·응답 본문 없이 종목코드와 예외 종류만 `news_momentum_batch_status.json`에 기록한다. DB·WAL·SHM·잠금·상태·백업 파일은 `.gitignore` 대상이다.

**2026-07-29 모멘텀 이슈 카드 감성·확산 상태 보강**: `news_momentum.db`에만 nullable 감성 집계와 이전 7일·변화율·확산 상태 컬럼을 최소 추가한다. 중복 제거된 기사마다 기존 긍정/부정 단어 규칙으로 긍정·중립·부정을 배치 분류하고 일별 집계한 뒤, 감성별 합계가 이슈 총 기사 수와 같은 경우에만 API의 `sentimentCounts`를 반환한다. 근거가 없는 기존 행은 0건으로 꾸미지 않고 `null`을 반환한다. 최근 7일과 이전 8~14일을 비교해 신규·확산·감소·지속을 배치에서 확정하며, 이전 기간 0건은 나눗셈 없이 변화율 `null`로 처리한다. 프론트는 뉴스 방향성·감성별 건수·순감성·부정 비중·모멘텀 상태·기간별 건수와 검색 관심도를 구분해 표시하고, DATA LAB 값이 없으면 `데이터 부족`, 감성 근거가 없으면 `감성 데이터 없음`으로 표시한다. 420px 이하에서는 카드 지표를 1열로 전환하며 다크모드 의미색을 유지한다.

**2026-07-30 메뉴 정보구조·홈 대시보드 개편**: 공통 1차 텍스트 메뉴를 홈·시장·종목·패턴·발굴·캘린더·커뮤니티 6개로 정리하고 기존 페이지 URL을 시장·종목·패턴 드롭다운에 재배치했다. `증시검색`은 URL을 유지한 채 `실시간 시세`로 개칭했으며, 종목뉴스는 메뉴에서만 제외하고 기존 페이지에 종목분석 이동 안내를 추가했다. MY는 navbar 아이콘으로 이동했다. PC 드롭다운은 hover/click/Tab/ESC와 ARIA 상태를 지원하고, 모바일은 활성 카테고리의 2차 메뉴를 가로 스크롤로 표시한다. 홈은 기존 API를 바꾸지 않고 거래량·상승률·하락률을 단일 실시간 랭킹 탭으로 통합했으며, 투자자별 매매동향 높이를 축소하고 오류 재시도를 추가했다. 상단 지수는 국내·해외·환율·원자재·디지털 그룹을 표시하고, 공시는 명시적 중요 제목 키워드 우선 최대 5건, 홈 글은 최신 3건과 전체보기만 남겼다. Python UI 계약 테스트 4건, 기존 뉴스 모멘텀 18건, 수정 JavaScript 문법 검사와 `git diff --check`를 통과했다. 정적 JS/CSS는 `master` push 후 GitHub Pages 자동 반영되며 `skin.html` 원본의 MY 아이콘은 티스토리 관리자 수동 반영 대상이지만 `skin-shell.js` 런타임 폴백으로 운영 화면에도 자동 주입된다.

**2026-07-30 메뉴·홈 실측 후속 수정**: 드롭다운이 렌더링돼도 보이지 않았던 원인은 PC 메뉴 컨테이너의 `overflow-x:auto`가 계산상 양축 `auto`가 되어 하위 메뉴를 50px 메뉴바 안에서 잘랐기 때문이다. PC overflow를 열고 모바일에서만 가로 스크롤을 유지했다. 모바일에서는 서브메뉴가 열릴 때 1차 버튼이 86px로 늘어 서브메뉴를 덮던 문제를 확인해 1차 행 높이를 43px로 고정했다. 상단 티커의 뉴스·공시 DOM과 호출을 제거하고 핵심 시장지표 8개가 전체 폭을 사용하도록 바꿨다. 데이터 로드 후 298px이던 투자자 매매동향과 187px이던 랭킹 카드를 각각 232px로 통일했으며, 설명을 제목 행으로 합치고 표 행·막대 높이를 줄였다. API·DB·순위 데이터 소스는 변경하지 않았다.

**2026-07-30 홈 시장 상황판·고정형 2차 메뉴 재개편**: MY를 1차 텍스트 메뉴로 복구하고 시장·종목·패턴·발굴의 화살표와 hover/click 드롭다운을 제거했다. 해당 1차 메뉴를 누르거나 하위 페이지에 들어가면 헤더 아래 고정형 2차 메뉴가 열리고 현재 1·2차 메뉴를 함께 활성화하며, 모바일은 두 행을 각각 가로 스크롤한다. 홈 상단 티커는 지정된 8개 시장지표만 같은 폭의 한 줄 카드로 표시한다. 투자자별 매매동향은 높이와 표 밀도를 298px 수준으로 원복하고 PC에서 약 2/3 폭으로 줄였으며, 오른쪽 오늘의 시장판은 기존 증시온도·수급·환율·시총 버블 업종 데이터를 재사용해 부호 규칙형 문장을 만든다. 다음 행은 기존 `/market-rank`, 패턴 스캔, 증시캘린더 데이터로 랭킹·패턴·일정 3개 카드를 구성하고 마켓브리핑은 대표 1개+일반 2개로 바꿨다. `/market-rank` URL과 응답 키는 유지한 채 기존 키움 ka10017 조회 조건만 2(상승)·5(하락)로 맞춰 실제 등락률 순위를 반환한다.

**2026-07-30 홈 UI 3차 개선**: 고정형 2차 메뉴를 1차 메뉴 바로 아래 독립 행으로 정렬하고 위·아래 구분선을 명확히 했다. 홈은 `home-widgets.js` 위젯 레지스트리로 확장해 투자자 수급·시장판 다음에 랭킹·패턴·MY·일정·실시간 공시 5개 동일 카드를 PC 한 줄에 배치한다. MY는 `wl_codes_v1`과 기존 GAS 묶음 시세, 공시는 기존 KIND/KRX RSS를 재사용하며 새 DB/API를 만들지 않았다. 마켓브리핑은 대표 1개+중간 3개로 늘리고 양쪽 총높이를 CSS grid stretch로 맞췄다. 8개 위젯은 핸들 드래그, 모바일 450ms 길게 누르기, 맨 위/아래 이동, 숨김/복원, 초기화를 지원하고 `home_dashboard_layout_v1`에 즉시 저장한다.

**2026-07-30 홈 수급 카드·시장 방향 보정**: 투자자별 매매동향의 298px 카드 높이는 유지하면서 `.itw-body`와 표 래퍼가 남는 세로 공간을 채우도록 변경해 하단 공백을 카드 패딩 수준으로 줄였다. 오늘의 시장판 방향은 상승 종목 비율 하나만 보던 판정을 수정해 기존 `?market=1`의 코스피 등락률을 최우선으로 반영하고, 지수 조회 실패 시에는 기존 증시온도의 상승 비율과 동일가중 평균등락률로 강도를 보완한다. 코스피 ±4% 이상은 급등·급락, ±2% 이상은 강한 강세·강한 약세로 구분하며 데이터가 없으면 임의 상태를 만들지 않는다.

**2026-07-30 홈 브리핑 밀도·패턴 미리보기 개선**: 마켓브리핑 대표 카드의 왼쪽 굵은 강조선을 제거하고, 기존 오른쪽 최신 글 3개는 유지하면서 대표 글 아래 남는 공간에 추가 최신 글 2개를 같은 카드 디자인으로 배치해 총 6건을 노출한다. 오늘의 패턴 네 행은 클릭 가능한 버튼으로 바꾸고, 선택하면 기존 패턴 스캔 응답의 점수 상위 실제 종목 최대 4개와 등락률을 카드 안에서 보여준다. 패턴 데이터가 없을 때는 빈 상태만 표시하며 새 API나 임의 종목은 추가하지 않는다.

**2026-07-30 홈 위젯 가독성·시장 방향 재보정**: 오늘의 패턴 선택 결과를 상위 4개 제한에서 기존 스캔 응답의 전체 종목으로 확대하고, 카드 높이는 유지한 채 투명 스크롤 영역에서 탐색하도록 변경했다. 주요 일정은 시간·구분·일정명 순서의 한 줄 구조로 정리했다. 실시간 랭킹은 거래량·상승률·하락률 모두 긴 종목명을 한 줄 말줄임 처리한다. 오늘의 시장판은 코스피 지수 데이터가 있으면 ±2% 이상에서만 강한 강세·약세를 사용하고, 그 미만에서는 상승·약세 우위 또는 혼조만 표시한다. 시장 폭·평균등락률의 강도 판정은 지수 조회 실패 시에만 대체 사용한다.

**2026-07-30 MY 관심종목 검색 키보드 탐색 수정**: MY 관심종목 자동완성에 빠져 있던 위·아래 방향키 탐색과 활성 항목의 Enter 선택을 추가했다. 선택 항목은 목록 내부에서 자동 스크롤되고 마우스 hover와 동일한 활성 스타일을 사용한다. 검색창과 결과 목록에는 combobox/listbox/option, `aria-expanded`, `aria-activedescendant`, `aria-selected` 상태를 연결했으며 Escape로 목록을 닫는다. 기존 종목 마스터와 관심종목 localStorage 구조는 변경하지 않았다.

**2026-07-30 홈 MY·실시간 랭킹 밀도 수정**: 홈 MY 위젯의 5종목 제한을 제거하고 `wl_codes_v1`에 저장된 기존 관심종목 전체를 기존 묶음 시세 API로 조회한다. 카드 높이는 유지하면서 목록만 투명 스크롤하고 각 행 오른쪽에 현재가와 등락률을 함께 표시한다. 실시간 랭킹은 종목당 이름 1줄과 현재가·등락률·거래량 1줄의 2단 구조로 정리해 현재가 행이 카드 밀도 때문에 잘리지 않도록 했다. API·DB·관심종목 저장 형식은 변경하지 않았다.

**2026-07-30 증시온도 일별 추이 기록 복구**: 최근 7일 증시온도 API의 `recentDays`가 오늘 1건, `history`가 null로만 반환되는 원인을 확인했다. 일별 기록이 수동 설치형 Apps Script 트리거에만 의존해 트리거가 등록되지 않은 배포에서는 기록이 전혀 쌓이지 않았다. 일반 `marketTemp` 조회 시에도 당일 값을 ScriptProperties에 날짜 기준으로 멱등 저장하도록 변경하고, 장 마감 트리거는 선택적 보정 수단으로 남겼다. 손상된 저장값은 안전하게 무시하고 최근 35일만 유지하며 캐시 키를 v5로 갱신했다. 프론트는 기록 1건일 때 무기한 수집 중 문구 대신 현재 온도와 기록 시작일을 즉시 표시하고, 실제 2일 이상 데이터부터 추이 그래프를 그린다. 과거 값은 임의 생성하지 않는다. UI 회귀 테스트 29건과 JavaScript 문법 검사를 통과했고, 정적 자산은 `master`에 반영했으며 GAS 웹앱은 기존 배포 ID를 유지한 버전 93으로 운영 배포했다.

**2026-07-31 실시간 시세 거래량 차트 개선**: 종목 > 실시간 시세 차트의 거래량을 TradingView 형태에 가깝게 하단 약 30%의 보조 영역으로 분리했다. 거래량 우측 값은 주가처럼 쉼표 숫자로 표시하지 않고 Lightweight Charts의 거래량 축약 형식(K/M/B)을 사용하며, 하단 범례에는 최신 거래량과 20봉 거래량 이동평균을 함께 표시한다. 주가축은 기존 원 단위 쉼표 형식을 유지하고 일봉·주봉·월봉 전환 때 거래량 범례가 중복 생성되지 않도록 정리했다. KIS 일별시세의 기존 누적거래량 필드를 그대로 사용하며 API·DB·GAS는 변경하지 않았다.

**2026-07-31 실시간 시세 이동평균·일목 구름대 추가**: 기존 420px 차트와 하단 거래량 배치를 유지하면서 가격 영역에 5·20·224봉 이동평균선을 추가했다. 일목균형표는 전환선 9, 기준선 26, 선행스팬B 52와 26봉 선행 기준으로 계산하고 선행스팬 A/B 경계선과 상승·하락 구름대를 캔들 아래 레이어에 표시한다. 일·주·월 전환 시 선택 주기의 봉으로 다시 계산하며 필요한 봉 수가 부족하면 임의 값을 만들지 않고 데이터 부족 상태를 표시한다. 계산은 기존 일봉 응답을 브라우저에서 재사용하므로 API·DB·GAS는 변경하지 않았다.

**2026-07-31 종목분석·실시간 시세 차트 지표 통일**: 두 차트의 이동평균선을 5일 빨강, 20일 파랑, 60일 녹색, 224일 검정 굵은 선으로 통일했다. 종목분석 차트에서는 매물대 표시 체크박스와 근사 매물대 범례를 제거하고 `이동평균선 표시` 다음에 `일목균형표(구름) 표시`가 오도록 토글 순서를 정리했다. 종목분석에도 실시간 시세와 같은 하단 30% 거래량 막대와 20봉 거래량 평균선, K/M/B 우측 값을 추가했다. 실시간 시세에는 60일선을 추가하고 동일한 순서의 이동평균선·구름대 토글을 제공한다. 기존 일봉의 OHLC·거래량과 이동평균 응답만 재사용하며 API·DB·GAS는 변경하지 않았다.

**2026-07-31 호가창 현재가·등락률 WebSocket 실시간 반영**: 관심종목(`js/watchlist.js`)에만 붙어 있던 VM 실시간 체결가 WebSocket 중계(`wss://goodbyestar.cloud/ws/quotes`, 키움 0B REAL을 서버가 대신 구독해 브라우저로 전달, 키움 토큰은 서버 밖으로 나가지 않음)를 호가창(`js/order-book.js`)에도 동일 패턴으로 연결했다. 호가 사다리·저항/지지 HUD·매물벽 돌파 판정은 기존 2초 폴링(`tick`)이 그대로 계산하고, WebSocket은 헤더·현재가 행의 가격/등락률 텍스트만 체결 단위로 더 빠르게 갱신한다(`data-field` 속성으로 대상 지정). 소켓은 종목 전환·탭 비활성화 시 정리되고 재연결은 5초 간격으로 재시도하며, 실패해도 기존 2초 GAS 시세 폴링이 그대로 폴백한다. VM 백엔드(`scripts/cloud-vm/main.py`의 `/ws/quotes`, `realtime_quotes.py`)는 이미 배포돼 있어 이번 변경은 프론트 정적 자산(`js/order-book.js`)만 수정했다. 사이트 내 다른 지표(관심지수 리본·사이드바 랭킹·시총버블·증시온도 등)는 지수·선물·랭킹처럼 종목코드 고정 구독 모델과 맞지 않거나 원래 배치성 데이터라 이번 범위에서 제외했다(사용자 확인). `node --check`로 문법 검증했고, `master` push 후 GitHub Pages 자동 배포로 반영된다.

**2026-07-31 홈 대시보드 MY 카드 WebSocket 실시간 반영**: 홈 대시보드의 MY 카드(`js/home-widgets.js`의 `loadMyWidget`)는 페이지 로드 시 GAS 묶음 시세를 1회만 조회하고 이후 갱신이 없었다. `/page/watchlist`(`js/watchlist.js`)와 동일한 `wss://goodbyestar.cloud/ws/quotes` 중계에 연결해 각 행의 현재가/등락률을 체결 단위로 갱신하도록 추가했다. 목록 전체를 다시 그리지 않고 `data-code`/`data-field` 속성으로 해당 종목 행만 찾아 텍스트를 갱신하며, 탭 비활성화 시 소켓을 정리하고 복귀 시 현재 관심종목 목록으로 재연결한다. 기존 1회성 GAS 조회·`storage` 이벤트 기반 재조회·저장 형식은 그대로 유지했다. `node --check` 통과, `master` push 후 GitHub Pages 자동 배포로 반영된다.

**2026-07-31 홈 위젯 초기 로딩 안정화**: 홈 시장판이 30초 이상 걸리는 `?market=1` 응답까지 `Promise.all`로 기다리면서 증시온도·환율·업종까지 함께 늦게 표시되던 병목을 제거했다. 홈 방향 판정은 이미 증시온도 응답에 포함된 전체 시장 상승 비율과 평균등락률을 재사용하며, 증시온도와 시총버블 업종은 독립적으로 도착 즉시 렌더링한다. 시장판·패턴·실시간 랭킹·MY 시세·공시는 마지막 정상 응답을 유효시간이 있는 localStorage 캐시로 먼저 표시한 뒤 백그라운드 갱신하고, 느린 갱신 실패가 기존 정상 화면을 지우지 않게 했다. 동적 캘린더·위젯 스크립트에는 10초 종료 처리를 추가해 실패한 기존 script 태그를 무기한 기다리지 않으며, 브리핑 목록이 일시적으로 비어도 나머지 위젯 레지스트리는 초기화한다. 기존 API URL·DB·GAS는 변경하지 않았다.

**2026-07-31 코스피 선물 분봉 로딩 오류 수정**: 시장 > 코스피 선물 차트에서 분봉을 처음 불러온 뒤 30초 주기 자동 새로고침 때 "분봉을 불러오지 못했어요."로 화면이 깨지는 문제를 수정했다. `js/kospi-futures.js`의 `loadMinuteAndRender()`는 주기적 새로고침에서도 매번 새로 fetch하면서 요청 시작과 동시에 기존 차트를 지우고 "불러오는 중..."으로 덮었다가, 그 요청이 실패하면(일시적 네트워크·응답 지연 포함) 이미 정상 표시 중이던 차트까지 에러로 덮어썼다. 일봉·주봉은 주기적 새로고침에서 캐시된 `dayItem`을 재사용해 이런 문제가 없는 것과 동일하게, 이미 받아온 `minuteRows`가 있으면 백그라운드에서만 갱신을 시도하고 실패해도 기존 차트를 그대로 유지하도록 변경했다. 최초 로딩(캐시 없음) 실패 시의 에러 표시는 그대로 유지된다. API·DB·엔드포인트는 변경하지 않았다. `node --check`로 문법 검증했고, `master` push 후 GitHub Pages 자동 배포로 반영된다.

**2026-07-31 코스피 선물 분봉 응답 축소·확대구간 유지(2차)**: 위 1차 수정 후에도 분봉이 응답 지연으로 실패한다는 신고를 받아 요청 자체를 줄였다. `/futures`는 21개 심볼을 한 번에 주는 공용 엔드포인트인데 이 페이지는 선물 2개만 쓰면서 분봉 요청에도 `days` 기본값 250이 붙어 안 쓰는 심볼 19개의 일봉까지 매번 받았고, 주간·야간 두 패널이 같은 요청을 각각 던져 30초마다 무거운 요청이 2번씩 나갔다. `/futures`에 화이트리스트 교집합으로만 동작하는 `symbols` 파라미터를 추가하고(미지정 시 기존과 완전히 동일한 전체 응답이라 관심지수 리본·보조지수·GAS 호출부는 영향 없음), 프론트는 분봉을 `days=1`+`symbols`로 요청하며 두 패널이 응답 하나를 공유한다. 서버 분봉 수집 주기가 5분(`domestic_futures.py`, `night_futures_ws.py`)인 점을 반영해 자동 새로고침의 분봉 재요청 간격을 최소 60초로 두고, 분봉 요청 타임아웃만 25초로 늘렸다. 최초 로딩 실패 시에는 "다시 시도" 버튼을 제공해 페이지 새로고침 없이 복구할 수 있다. 확대(zoom)해 둔 구간이 새로고침마다 초기화되던 문제도 함께 고쳤다 - 같은 주기 차트는 `remove()` 후 재생성하지 않고 `setData()`로 데이터만 교체하며, 보이는 구간은 차트별·주기별로 localStorage(`kf_range_*`)에 저장해 페이지 새로고침·섹션 접기펼치기 후에도 복원한다(저장 구간이 현재 데이터 범위와 겹치지 않으면 전체 보기로 폴백). `test/kospi-futures.html`에 분봉·지연·분봉실패 mock을 추가했고, Chromium 실측 16건(요청 파라미터·중복요청 없음·자동새로고침 후 에러 미발생·같은 canvas 재사용·확대구간 유지·새로고침 후 복원·재시도 버튼 동작)과 `/futures` 엔드포인트 직접 호출 10건을 통과했다. `js/`·`css/`는 GitHub Pages, `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-07-31 VM 응답 gzip 압축·/futures 캐시(첫 로딩 지연 대응, 3차)**: 코스피 선물 첫 로딩이 30초 넘게 걸린다는 신고로 응답 경로를 점검해 두 가지 구조적 낭비를 제거했다. 첫째, VM(`scripts/cloud-vm/main.py`)이 그동안 모든 JSON을 무압축으로 내려보내고 있어 `GZipMiddleware(minimum_size=500)`를 추가했다 - 일봉/분봉 배열은 반복 구조라 실측 압축률이 2.6%(39KB→1KB)로, 이 페이지뿐 아니라 `/futures` 전체를 받는 관심지수 리본 등 모든 엔드포인트가 같이 개선된다. 둘째, `/futures`는 홈의 관심지수 리본(20초 폴링)·코스피 선물 페이지(30초 폴링)·GAS AI 해설이 각각 같은 데이터를 조회해 방문자가 여러 명이면 동일 쿼리가 계속 겹쳤는데, `/market-rank`·`/order-book`과 동일한 패턴의 짧은 TTL 메모리 캐시(`_FUTURES_TTL=10`초, 파라미터 조합별 분리, 50키 상한)를 추가했다. 수집 주기(실시간 30초, 분봉 5분)보다 짧은 TTL이라 신선도 손실은 없다. 응답이 1초를 넘으면 소요시간·행수를 WARNING으로 남겨 남은 병목을 로그로 좁힐 수 있게 했다. 프론트(`js/kospi-futures.js`)는 차트 라이브러리(CDN)를 데이터 요청과 동시에 받기 시작하도록 바꿨고(기존에는 `/futures` 응답 후에야 로드를 시작해 CDN 왕복이 직렬로 붙었다 - 실측 214ms 시점 시작), AI 해설(GAS, 생성에 수십 초 소요 가능 + 서버에서 `/futures`·`/option-flow` 재호출)은 차트 데이터가 도착한 직후 또는 늦어도 3초 뒤에 시작하도록 순서를 조정했다. 검증은 Chromium 실측 22건(기존 16건 회귀 + 병렬 로딩 2건 + 참고의견·옵션수급·현재가·전체실패 4건), `/futures` 함수 직접 호출 15건(symbols 필터 10건 + 캐시 적재·TTL 내 DB 미조회·파라미터별 분리·TTL 경과 후 재조회·상한 정리 5건), gzip/CORS 조합 8건을 통과했다.

**2026-07-31 관심지수 리본 /futures 요청 축소(4차)**: 홈의 관심지수 리본(`js/quick-indices.js`)이 `/futures`를 파라미터 없이 호출해 21개 심볼 전체를 받고 있었는데, 실제로 쓰는 건 `OPTIONS`에 정의된 12종뿐이었다(코스피200 주간선물·미국 현물지수 3종·국고채/미국채 4종·ETH 등 9종은 응답만 받고 버려짐). `OPTIONS`에서 `source === 'futures'`인 항목의 `sourceKey`를 자동으로 모아 `symbols`로 요청하도록 바꿔, 지표를 추가해도 이 코드를 따로 고칠 필요가 없게 했다. 선택 항목별로 요청을 쪼개지 않고 항상 12종 전체를 요청하는데, 요청 URL이 고정돼야 VM의 짧은 TTL 캐시를 모든 방문자가 공유하고 선택이 바뀌어도 재조회가 생기지 않기 때문이다. `days`는 붙이지 않아 미니차트 구간(서버 기본 90일)이 그대로 유지된다. 리본은 2026-07-27부터 홈에서만 렌더되므로 이 변경의 효과 범위도 홈 첫 로딩이다(3차 기록에서 "모든 페이지"로 적었던 서술을 함께 정정했다). Chromium 실측 9건(요청 1건·12종만 요청·`days` 미포함·미사용 심볼 제외·기본 8종 카드 렌더·현재가 표시·미니차트 8/8 렌더·재방문 URL 동일·선택 가능 지표 전부 커버)을 통과했다.

**2026-08-03 종목분석 수급 표 "당일" 0 표시 수정**: 개장 직후(비유동 종목은 몇 분 이상) 종목분석 수급 표의 "당일" 행이 개인·외국인·기관 순매매·추정대금 전부 0으로 뜨는 리포트를 원인부터 확인했다. `kiwoom_market.fetch_foreign_inst_daily`는 KIS 확정 일별 TR이 채워지기 전(KIS `FHPTJ04160001`은 00:00~15:40 KST 구간 자체가 막혀 있음, 코드 내 기존 실측 주석 참고) 장중 누적치 TR(ka10059)의 최신 행으로 "당일" 행을 만드는데, 그날 아직 체결이 하나도 없어 누적거래량이 0인 시점엔 투자자별 순매매 필드도 집계 전이라 비어 있다. `to_num()`이 빈 값을 실제 순매매 0으로 오인해 "당일" 행 전체가 진짜 0인 것처럼 표시됐다. `_live_investor_row_from()`에 누적거래량 0 가드를 추가해 이 경우 `None`을 돌려주도록 했다 - 호출부가 가짜 "당일" 행을 만들지 않고 직전 확정일(예: 07/31)을 그대로 최상단에 보여준다(원본에 없는 값을 0으로 채우지 않는다는 기존 원칙과 동일). `test/test_kiwoom_market.py`에 회귀 테스트 4건(행 없음·오늘자 아님·거래 전 0 가드·정상 당일 행)을 추가해 통과했다. `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-08-03(2차) 종목분석 수급 표 "당일" 개인·기관 0 표시 수정**: 위 수정 배포 후 이어진 실측 리포트 - 거래가 시작된 뒤에는 "당일" 행에 외국인은 실제 순매매가 찍히는데 개인·기관은 계속 0으로 뜬다는 신고를 받았다. `ka10059`의 투자자 유형별 필드(외국인 `frgnr_invsr`, 기관 `orgn`, 개인 `ind_invsr`)가 동시에 채워지지 않고 외국인이 먼저 집계되는 구간이 있어, 아직 빈 문자열인 개인·기관 필드를 `to_num()`이 0으로 오인해 "외국인만 실제값, 개인·기관은 0"으로 뒤섞여 보였다. `_live_investor_row_from()`에 가드를 추가해 세 필드 중 하나라도 원본이 비어 있으면(키 없음·`None`·빈 문자열) "당일" 행 전체를 만들지 않고 직전 확정일을 그대로 보여주도록 했다 - 일부만 실제값이고 나머지는 0인 뒤섞인 행을 노출하지 않는다. `test/test_kiwoom_market.py`에 회귀 테스트 2건(외국인만 채워진 경우, 필드 키 자체가 없는 경우)을 추가해 총 6건이 통과했다. `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-08-03(3차) 종목분석 수급 표 "당일" 개인 0 표시 - 실시간 개인 순매매를 아예 신뢰하지 않도록 변경**: 위 2차 수정 배포 후에도 재현됨 - 이번엔 외국인·기관은 실제 순매매(예: -1,000 / +10,000)가 찍히는데 개인만 정확히 0으로 남는 신고를 받았다. `ka10059`가 개인 필드를 집계 전에도 빈 문자열이 아니라 문자열 `"0"`으로 내려주는 것으로 보여, 2차 가드(빈 문자열 검사)로는 "진짜 개인 순매매 0"과 "아직 집계 안 됨"을 값만으로 구분할 수 없었다. 서로 다른 두 종목에서 같은 패턴(외국인·기관은 0이 아닌데 개인만 0)이 반복 관측됐고, 개인은 통상 전체 거래에서 외국인·기관·기타법인을 뺀 잔차로 집계되어 셋 중 가장 늦게 확정되는 값이라는 점을 근거로 접근을 바꿨다 - 이 실시간 패치(`_live_investor_row_from`)에서는 외국인·기관은 계속 신뢰해 실제값을 넘기되, 개인 순매매(`ind_net`)는 값을 아예 쓰지 않고 항상 `None`으로 돌린다. 프론트는 기존 규칙대로 `null`을 "-"로 표시하므로(개인 열이 구조적으로 없는 네이버 폴백과 동일한 처리) 별도 프론트 변경은 없었다. 다만 `None`이 `daily[0]`에 들어가면서 `foreign_flow_compute.py`의 집계 함수(`rolling_sum`/`amount_sum`/`streak`/`signal`)가 산술 연산 중 크래시할 수 있어, `None`을 합산에서는 0 기여로 제외하고 연속매매 판정에서는 그 시점에 중단하도록 null-tolerant하게 고쳤다. 개인의 확정치는 KIS 일별 TR이 열리는 15:40(KST) 이후 다음 조회부터 정상 반영된다. `test/test_kiwoom_market.py` 3건, `test/test_foreign_flow_compute.py`(신규) 5건을 추가해 통과했다. `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-08-03(3차 보강) 위 결정의 구조적 근거 확인**: 배포 후 "외국인·기관은 진짜 실시간이냐"는 질문을 받아 웹 조사로 확인했다. 키움 HTS 도움말([0796] 종목별투자자)에 따르면 KRX 투자자별 매매동향 잠정정보 집계시각은 09:30(외국인만 제공)·10:00·11:30·13:20·14:30이고 확정정보는 KRX 15:35(NXT 20:05)다 - 이 스케줄은 키움이 아니라 거래소(KRX) 공식 배포 시점이라, KRX 데이터로 직접 받아도 동일한 제약이 있고 오히려 KRX Data Marketplace는 유료 채널이라 무료인 지금 방식보다 불리하다. 외국인·기관은 거래소 등록 계좌라 체결 건별 집계가 가능해 이 배치 스케줄보다 촘촘히 갱신되지만, 개인은 등록 태그가 없어 "전체 - 외국인 - 기관 - 기타법인" 잔차로만 산출돼 거래소 공식 집계 전에는 계산 자체가 불가능하다 - 위 3차 수정의 방향(외국인·기관 신뢰, 개인은 "-")이 이 구조와 일치함을 확인하고 `_live_investor_row_from()` 독스트링에 근거를 보강했다(동작 변경 없음, 코드 주석만).

**2026-08-03 증시캘린더 종목 이벤트 아이콘에 실제 로고 표시**: 증시캘린더(`/page/stock-calendar`)의 실적발표 등 종목 이벤트가 "$종목명" 텍스트 뱃지만 있고 아이콘 자리엔 종목명 앞 2글자(예: "한섬", "현대")만 나와 로고가 안 보인다는 리포트를 받았다. `js/stock-calendar.js`의 `renderEventRow()`가 종목 아이콘을 항상 2글자 텍스트로만 그리고 있어서, `window.KRX_MAP`(종목명→코드, skin.html에서 전역 로드됨)으로 코드를 찾아 다른 페이지(`foreign-flow.js`/`stock-search.js`)와 동일한 `img/stock-icons/{code}.svg`(실패 시 `.png`, 그마저 없으면 숨김) 3단 폴백 로고 이미지를 2글자 텍스트 위에 겹쳐 그리도록 바꿨다. 종목명이 `KRX_MAP`과 정확히 안 맞거나(해외종목 등) 로고 파일이 없으면 이미지가 폴백으로 숨겨져 기존 2글자 약칭이 그대로 보이므로 빈 원으로 깨지지 않는다. `css/stock-calendar.css`에 아이콘 원 안에서 이미지가 텍스트 위에 겹쳐지도록 `position: relative/absolute` 레이어링을 추가했다. `test/stock-calendar.html`에 `krx_map.js` 로드를 추가하고, Playwright로 실제 로고 렌더링(SK하이닉스·현대오토에버)과 폴백 동작(KRX_MAP에 없는 해외종목 램리서치는 텍스트 약칭 유지)을 라이트·다크모드·모바일 폭에서 실측 확인했다. `js/`·`css/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-03(2차) 증시캘린더 종목 이벤트 제목 $ 마커 노출 제거**: 위 로고 표시 개선 배포 후 "$현대자동차 실적발표"처럼 종목명 앞 `$`가 화면에 그대로 보인다는 리포트를 받았다. `$`는 원래 구글 캘린더에 이벤트 제목을 입력할 때 종목 이벤트임을 표시하는 내부 파싱 마커(`js/stock-calendar.js` 상단 규칙 주석)인데, `renderEventRow()`가 이를 그대로 화면에 출력하고 있었다. 로고 아이콘이 이미 종목임을 보여주므로 화면 표시에서만 `$`를 제거했다(파싱 로직·CSS는 영향 없음).

**2026-08-03(3차) 증시캘린더 종목 아이콘 DART 정식명-KRX_MAP 별칭 매핑 추가**: 위 로고 표시 개선 배포 후 "현대자동차만 로고 없이 2글자 텍스트만 뜬다"는 리포트를 받았다. DART 공시 API(`scripts/cloud-vm/earnings_calendar.py`)가 내려주는 정식 회사명은 `현대자동차`인데 `data/krx_map.js`에는 `현대차` 키로만 등록돼 있어 `KRX_MAP["현대자동차"]` 조회가 실패했다. 다른 파일들이 `krx_map.js`의 `현대차` 키를 그대로 참조하고 있어 데이터 파일은 건드리지 않고, `js/stock-calendar.js`에 DART 정식명→`KRX_MAP` 키 별칭 테이블(`DART_NAME_ALIAS`)을 추가해 좁게 수정했다. 같은 리포트의 "네이버 로고 없음"은 코드 문제가 아니라 해당 일정이 DART 자동 태그 없이 구글 캘린더에 직접 입력된 미래 일정인데 제목이 `$`로 시작하지 않아 종목 이벤트로 인식되지 않은 것으로, 캘린더 이벤트 제목 수정이 필요하다(코드 변경 범위 밖). `js/`는 GitHub Pages 자동 배포 대상이다.

**2026-08-03(4차) 종목분석 수급 표 "당일" 개인 순매매 확정치가 장 마감 후에도 "-"로 남는 문제 수정**: 비에이치아이 실측 리포트 - 15:40(KST) 이후 KIS 확정 TR이 열려 개인 순매매 확정치가 들어왔어야 할 시간인데도 "당일" 행 개인 열이 계속 "-"였다. 3차 수정(장중엔 개인 실시간 값을 신뢰하지 않고 항상 `ind_net=None` 반환)의 부작용이었다 - `fetch_foreign_inst_daily`가 `out[0]`(KIS 확정 데이터, 마감 후엔 오늘의 진짜 개인 순매매를 담고 있음)에 `live_row`를 `dict.update()`로 무조건 덮어써서, `live_row['ind_net']`가 항상 `None`이라 이미 확정된 값을 지워버리고 있었다. 이 병합 로직을 `_merge_live_row()` 함수로 분리하고, `out[0]`에 이미 확정 개인 순매매가 있는데 `live_row`의 개인 값이 `None`이면 기존 확정치를 보존하도록 고쳤다(새로 '당일' 행을 끼워 넣는 경우는 확정 데이터가 아예 없는 상태라 기존대로 `None`). `test/test_kiwoom_market.py`에 회귀 테스트 3건(확정치 보존, 확정 행 없을 때 신규 삽입, `live_row` 없을 때 무변경)을 추가해 총 10건이 통과했다. `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-08-03 VM 장애 대응(3차): 배포 블록에 flock 추가해 5분 타이머 중첩 실행 방지**: 사용자가 홈·코스피 선물·시장 브리핑 등 여러 위젯이 한꺼번에 "-"·"불러오는 중..."·"데이터를 불러오지 못했습니다"로 멈춰 있다고 신고했다. `/futures`·`/market-rank`·`/option-flow` 등은 실패하는데 `/investor-trend`는 정상 응답해, FastAPI 프로세스 자체가 죽은 건 아니고 특정 요청 처리가 막힌 상태로 판단했다. 오늘 같은 세션에서 `scripts/cloud-vm/`에 짧은 간격으로 여러 PR을 연달아 머지했는데, `deploy_check.sh`(5분 주기 `kiwoom-deploy.timer`)의 배포 블록(git pull · `backup_sqlite.py` · `sudo systemctl restart kiwoom-api`)에는 잠금장치가 전혀 없었다 - 2026-08-02 SQLite 백업 재시작 증폭 사고 때 이미 "짧은 간격 연속 push 시 회차가 겹칠 수 있다"는 문제를 발견했지만 그때는 뉴스 모멘텀 하위 작업에만 `flock`을 걸고 배포 블록 자체는 후속 과제로 미뤄뒀던 부분이다. 오늘 그 후속 과제가 실제로 재현된 것으로 보고, 스크립트 전체를 `exec 200>"$DEPLOY_LOCK"; flock -n 200`으로 감싸 타이머 회차가 겹치면 뒤 회차는 아무 것도 하지 않고 조용히 종료(exit 0)하도록 고쳤다(건너뛴 회차의 커밋은 다음 회차가 `git fetch`로 그대로 잡아 배포 자체는 누락되지 않는다). `/tmp`에서 두 프로세스가 동시에 같은 락 파일을 잡는 실측 시뮬레이션으로 겹칠 때 뒤 프로세스가 정상적으로 건너뛰고 앞 프로세스가 끝난 뒤엔 정상 획득되는 걸 확인했고, `test/test_news_momentum.py`의 배포 스크립트 계약 테스트에 새 락 관련 assertion 5건을 추가했다(fastapi 미설치 샌드박스라 이 세션에서 직접 실행은 못 했고, 문자열 대조로 실제 파일과 일치함을 확인). VM 프로세스 자체의 현재 상태(재시작 필요 여부, 잔여 백업 프로세스 등)는 이 세션에서 VM에 직접 접근할 방법이 없어 확인하지 못했다 - 배포 후에도 위젯이 계속 안 나오면 VM에서 `top`/`journalctl -u kiwoom-api`로 직접 확인이 필요하다. `scripts/cloud-vm/`은 VM 자동 배포 대상이다.

**2026-08-03 VM 장애 대응(4차, 실제 원인·해결): GCP 서비스 계정 로그·메트릭 전송 권한 누락으로 인한 syslog 자기증식**: 위 3차(flock)는 예방 조치였고, 사용자가 직접 VM에 SSH 접속해 `top`·`journalctl`·`df -h`·`du -sh`로 함께 실측한 결과 실제 원인은 별개였다. `sudo systemctl status kiwoom-api`는 정상(active, 재시작 이력 없음)이었고 `/investor-trend`는 200 OK인데 `/futures`만 응답이 2.5~4.2초로 느렸던 것으로 보아 FastAPI 자체 장애가 아니라 디스크 I/O 병목으로 판단, `df -h`로 루트 디스크가 91%(29G 중 26G) 사용 중임을 확인했다. `du -sh /var/*` -> `/var/log` -> `/var/log/syslog`(4.2G)+`syslog.1`(9.0G)로 좁혀 들어가 `sudo tail -50 /var/log/syslog`로 실제 내용을 확인하니, 구글 클라우드 모니터링 에이전트(`otelopscol`, 2026-07-28부터 6일간 CPU 1012분 누적)가 이 VM의 Compute Engine 기본 서비스 계정(`{project-number}-compute@developer.gserviceaccount.com`)에 `roles/logging.logWriter`가 없어 syslog를 Cloud Logging으로 전송할 때마다 `PermissionDenied`로 실패하고, 그 실패 상세(큐에 쌓인 로그 항목 수백 개 단위)를 다시 syslog에 통째로 찍는 자기증식 루프에 빠져 있었다(같은 방식으로 `roles/monitoring.metricWriter`도 없어 메트릭 전송도 실패 중이었으나 이건 디스크 증식과는 무관). GCP 콘솔 IAM에서 그 서비스 계정을 찾으려 했으나 "Google 제공 역할 부여 포함" 옵션이 꺼져 있어 기본 역할만 가진 계정이 목록에서 숨겨져 있었고, 켜서 확인해보니 이 서비스 계정 자체가 프로젝트에 어떤 역할도 부여받지 못한 상태(신규 추가 필요)였던 것으로 드러났다 - 결국 애초에 권한이 하나도 없었던 게 근본 원인이었다. IAM에서 이 서비스 계정에 "로그 작성자"·"모니터링 측정항목 작성자" 역할을 추가하고 `sudo systemctl restart google-cloud-ops-agent`로 재시작하니 `[API Check] Result: PASS`로 전환됐고, 이후 4분 이상 `PermissionDenied` 신규 발생 없음·syslog 파일 크기 불변(131M 고정)을 실측으로 확인했다. 디스크 정리(`truncate -s 0 /var/log/syslog`, `rm -f syslog.1`, 어제(8/2) 사고 때 남은 고아 백업 파일 `ohlc_snapshot.db.backup-20260728-203726` 삭제, `journalctl --vacuum-size=500M`)로 디스크 사용률을 91%→36%(26G→9.9G)로 낮췄다. 이 사고는 `scripts/cloud-vm/` 코드나 오늘 배포와 무관한 순수 GCP IAM 설정 문제였고(즉 3차의 flock 수정과는 별개 원인), 해결도 전부 GCP 콘솔·VM 셸에서 이뤄져 이번 회차엔 커밋할 코드 변경이 없다. 재발 감시 포인트: 이 서비스 계정에서 IAM 역할이 다시 빠지면 동일 증상이 재현되므로, `/futures` 응답이 다시 느려지거나 위젯이 멈추면 이 작업이력부터 참고할 것.

**2026-08-03 VM 장애 대응(5차, 증상 범위 확정)**: IAM 복구 후에도 "종목분석 로딩이 보통 30초 이상 걸린다"·"HD현대일렉트릭(267260) 개인 수급 열이 확정일(07/31 등)까지 전부 '-'로 나온다"는 리포트가 이어져 별개 버그로 의심했다. `/foreign-flow/{code}`는 키움·KIS를 최대 5번 순차 호출하는 구조라 처음엔 "이 구조 자체가 20초 클라이언트 타임아웃을 넘겨 네이버 폴백(개인 열이 구조적으로 없음)으로 떨어지는 것"으로 가설을 세웠으나, VM에서 `curl localhost:8080/foreign-flow/267260`을 캐시 미스로 직접 재보니 2.977초로 정상 범위였다(가설 기각). 이후 실제 사이트에서 재조회하니 개인 수급이 정상 표시됨을 확인 - 즉 이 두 증상도 같은 4차 사고(디스크 91%로 인한 I/O 병목)의 여파였을 뿐, IAM 복구 이후엔 재현되지 않는다. 별도 코드 수정 없음.

**2026-08-03 응답시간 자체 모니터링 추가(VM 접속 없이 "느려졌나" 확인)**: 위 4~5차 사고 진단 때 매번 사용자가 VM에 SSH 접속해 `curl -w`로 직접 응답시간을 재야 했던 걸 자동화했다. `scripts/cloud-vm/latency_monitor.py`(신규)가 `/futures`·`/market-rank`·`/investor-trend`·`/foreign-flow/005930`·`/investor-flow/005930`(대표 종목 삼성전자 고정) 5개를 로컬(`localhost:8080`)로 호출해 응답시간·상태를 `latency_monitor.log`에 남긴다. `/foreign-flow`는 5분 서버 캐시가 있어 같은 파라미터로 5분마다 재면 캐시 히트만 잡혀 진짜 콜드 패스(키움+KIS 순차 호출) 성능을 못 보므로, 회차마다 `days`(5/10/20/42/63)를 돌려가며 바꿔 콜드 패스 측정도 섞는다. `deploy_check.sh`가 5분 배포 주기마다 이 스크립트를 백그라운드(`&`+`disown`)로 던지고 기다리지 않아, 엔드포인트가 느려도(최악 5개 x 25초) 배포 타이머 자체는 막히지 않는다. `main.py`에 `GET /health/latency`(인증 없음, `/futures`·`/market-rank`와 동일한 공개 수준)를 추가해 이 로그의 최근 N줄을 그대로 반환하므로, 이제 브라우저·curl로 바로 확인할 수 있고 VM SSH 접속이 필요 없다. `test/test_latency_monitor.py`(신규) 9건, `test/test_news_momentum.py` 배포 스크립트 계약에 assertion 2건을 추가해 통과했다(fastapi 미설치 샌드박스라 `/health/latency` 자체는 이 세션에서 직접 실행 못 함). `scripts/cloud-vm/`은 VM 자동 배포 대상이며, 다음 배포 주기부터 로그가 쌓이기 시작한다. 확인 URL: `https://goodbyestar.cloud/health/latency`.

**2026-08-04 `.kis.yaml` 전략 포맷 파서·평가 엔진 추가**: 한국투자증권 open-trading-api `strategy_builder`의 `.kis.yaml` 포맷(https://github.com/koreainvestment/open-trading-api/blob/main/strategy_builder/README.md#kisyaml-포맷) 구현 요청을 받았다. 원본 저장소는 Next.js 비주얼 빌더+FastAPI 백엔드+Backtester+KIS 계좌 인증/실전 주문 실행까지 포함한 완전히 별개의 애플리케이션이라 사용자에게 범위를 확인했고(질문 4지선다), "kisyaml 포맷만" 이식하기로 확정했다 - 화면 위젯 연동·주문 실행·비주얼 빌더 UI는 이번 범위에 없다. `scripts/cloud-vm/kisyaml_strategy.py`(신규)가 (1) `.kis.yaml` 전용 최소 YAML 서브셋 파서(PyYAML 의존성을 새로 추가하지 않기 위해 자체 구현 - VM 자동배포 경로에 미설치 패키지로 인한 크래시 위험을 없앰), (2) 9개 기본 지표(sma/ema/rsi/roc/highest/lowest/stddev/atr/price, README가 언급한 80개 전체가 아니라 명세가 분명한 것만) 계산, (3) entry/exit 조건 평가(cross_above/cross_below/greater_than/less_than/greater_equal/less_equal/equals 연산자, AND/OR 로직)를 제공한다. 지표는 기존 `db_schema.load_daily_prices()`(daily_prices 테이블, daily_scan.py가 이미 채워둠)를 그대로 입력으로 쓴다. compare_to(다른 지표 alias 참조 또는 숫자 리터럴 둘 다 허용)와 confidence 산식(충족 조건 수/전체 조건 수로 근사)은 README에 공식 JSON 스키마가 공개돼 있지 않아 예시·서술 기반으로 추정한 값이며, 코드 주석에 그 근거와 불확실성을 명시했다. `scripts/cloud-vm/strategies/`에 README 원본 예시(golden_cross)와 RSI 필터를 추가한 변형 2개를 `.kis.yaml`로 수록했고, `scripts/cloud-vm/run_kisyaml_strategy.py`(신규)로 DB의 실제 일봉에 대해 수동 실행해볼 수 있다(daily_scan.py 등 기존 자동 배치에는 연결하지 않음). `test/test_kisyaml_strategy.py`(신규) 11건(YAML 파싱, 지표 계산, entry/exit 평가, risk 환산, 번들 예시 파일 파싱)을 추가해 통과했고 기존 테스트(`test_kiwoom_market.py` 등, fastapi 미설치로 실행 불가한 `test_news_momentum.py` 제외)도 회귀 없음을 확인했다. `scripts/cloud-vm/`은 VM 자동 배포 대상이나, 이번 모듈은 기존 자동 실행 경로(main.py/daily_scan.py)에서 import되지 않으므로 배포돼도 기존 서비스 동작에는 영향이 없다.

**2026-08-04(2차) `.kis.yaml` 프리셋 10종 전부 구현 + 신규 지표 3종**: "메뉴에 종목검색(구 패턴·발굴) 안에 차트검색·전략검색을 만들고 싶다"는 후속 요청을 받아, 먼저 전략검색이 어떤 화면일지 샘플(Artifact 목업)로 방향을 맞췄다 - 실제 사이트 코드(스킨 메뉴·페이지)는 아직 변경하지 않았다(사용자 확인: 메뉴 개편은 전략검색 완성 후 한 번에 반영). 이어서 KIS README의 "10개 프리셋 전략" 표(golden_cross/momentum/trend_filter/week52_high/consecutive/disparity/breakout_fail/strong_close/volatility/mean_reversion) 전부를 보고 싶다는 요청을 받아, 지난 회차 kisyaml_strategy.py의 9개 지표만으론 표현할 수 없던 나머지 9개 프리셋을 실제로 구현했다. 새 지표 3종을 추가했다 - `disparity`(종가/기준선(sma 또는 ema)*100, 이격도·평균회귀 프리셋이 기준선·기간만 다르게 공유), `streak`(연속 상승/하락 부호있는 일수), `range_position`(당일 고가-저가 구간에서 종가 위치 0~100, 강한 종가용). 기존 `highest`/`lowest`에는 `exclude_current` 옵션(오늘을 뺀 직전 N일 최고/최저 - 52주 신고가·돌파 실패의 "전고점"에 필요, 오늘을 포함해 계산하면 항상 자기 자신이 최댓값이 돼 신고가 판정이 성립하지 않는다), `stddev`에는 `normalize` 옵션(절대 표준편차 대신 평균 대비 %로 - 가격대가 다른 종목끼리도 비교 가능한 변동성 지표가 변동성 확장 프리셋에 필요)을 추가했다. `breakout_fail`(돌파 실패)은 원본 표에서도 카테고리가 "손절"이라 다른 9개와 달리 매수 신호가 아니라 "전고점을 다시 하회했다"는 이탈 경보로 구현했다 - 화면에 붙일 때는 이 프리셋만 매수 카드가 아니라 경보 카드로 다르게 보여줘야 한다(코드 주석·docstring에 명시, 프론트 작업은 아직 없음). `scripts/cloud-vm/strategies/`에 9개 `.kis.yaml`을 신규 추가했다. `test/test_kisyaml_strategy.py`에 새 지표 단위테스트 5건과, 300거래일 합성 데이터(고정 시드)로 10개 프리셋 전부가 예외 없이 BUY/SELL/HOLD 스키마를 지키는지 확인하는 테스트 2건을 추가해 총 18건이 통과했고, 수동 실측으로 대부분 프리셋이 실제로 BUY/SELL을 낸다는 것도 확인했다(mean_reversion은 이번 합성 데이터에서 우연히 SELL/HOLD만 나왔는데, 조건식 자체는 다른 프리셋과 동일하게 검증됐다). 여전히 진짜 종목 DB 연동(daily_scan.py의 daily_prices를 실제로 스캔해 화면에 종목을 보여주는 API)과 메뉴·화면 반영은 다음 단계로 남아있다.

**2026-08-04(3차) 전략검색 실제 DB 연동 - `/strategy-scan-batch` 신설**: "다음 진행해" 요청으로 10개 kisyaml 프리셋을 실제 종목 DB에 연결했다. `scripts/cloud-vm/strategy_scan.py`(신규)는 daily_scan.py와 달리 키움/KIS API를 전혀 새로 호출하지 않는다 - daily_scan.py가 이미 채워둔 `daily_prices`(SQLite)를 그대로 읽어 `strategies/*.kis.yaml` 10개 전부를 전종목(~2,691개)에 평가하고, 프리셋별로 조건을 충족한 종목만(action=='BUY') 신뢰도(confidence) 내림차순으로 모아 `strategy_scan_cache.json`에 저장한다(원자적 교체 - `os.replace`로 쓰는 도중 읽기 충돌 방지). breakout_fail(돌파 실패, 카테고리 "손절")도 다른 9개와 동일하게 "조건 충족=매칭"으로 캐시에 담기지만, 실제로는 매수 신호가 아니라 이탈 경보라 화면에서 category로 구분해 다르게 보여줘야 한다는 점을 docstring에 명시했다. `main.py`에 `/strategy-scan-batch`(신규, `/daily-scan-batch`·`/week52-batch`와 동일 패턴 - `x_api_key` 필수, 캐시 파일을 그대로 반환)를 추가했다. `daily_prices` 최소 60거래일 미만인 종목(신규 상장 등)은 스캔에서 제외하고(`MIN_BARS`), week52_high(253일 필요)처럼 그보다 더 긴 지표는 데이터가 모자라면 조건값이 None이 되어 자연스럽게 HOLD로 처리되므로 별도 예외 처리가 필요 없다. `scripts/cloud-vm/setup_strategyscan_timer.sh`(신규, daily_scan 타이머와 동일 패턴)로 매일 16:20 KST(daily_scan 16:00 이후 20분 여유)에 자동 실행되게 등록할 수 있다 - VM에서 수동 1회 실행 필요. 지난 회차에 남겨뒀던 데모용 `golden_cross_rsi_filter.kis.yaml`(README 10개 프리셋 표에 없는 예시)은 정식 10개와 섞이면 혼란스러워 삭제했다. `test/test_strategy_scan.py`(신규) 5건(프리셋 10개 전부 로드, changeRate 계산, 데이터부족 종목 제외, 다종목 스캔 시 신뢰도 정렬)을 추가해 기존 18건과 함께 총 23건이 통과했다(fastapi 미설치 샌드박스라 `/strategy-scan-batch` 자체는 이 세션에서 직접 실행 못 함 - `main.py` 문법 검사(`py_compile`)만 통과 확인). 아직 VM에 배포·타이머 등록 전이고(이 PR이 `master`에 머지된 뒤 필요), 화면(전략검색 탭)·메뉴 이름변경도 다음 단계로 남아있다.

**2026-08-04(4차) strategy_scan.py `strategies/` 디렉터리 못 찾는 배포 경로 버그 수정**: 머지 후 사용자가 VM에서 `venv/bin/python strategy_scan.py`를 실행하자 `FileNotFoundError: .../kiwoom-api/strategies`로 즉시 죽었다. 원인은 deploy_check.sh의 배포 방식 - `cp scripts/cloud-vm/*.py $APP_DIR/`로 **.py 파일만** VM의 평평한 `$APP_DIR` 루트에 복사하고 `strategies/`(.kis.yaml, .py가 아님) 같은 하위 디렉터리는 복사하지 않는다(지난 회차 `run_kisyaml_strategy.py`를 VM에서 처음 테스트할 때 동일한 원인으로 한 번 겪었던 문제인데, 그때는 사용자가 실행 시 경로를 직접 지정하는 방식으로 우회했지만 `strategy_scan.py`는 내부적으로 `os.path.dirname(__file__)/strategies`를 고정 경로로 썼던 게 문제 - 평평하게 복사된 위치($APP_DIR)에는 그 하위 폴더가 없다). `_resolve_strategies_dir()` 함수를 추가해 (1) 이 파일과 같은 디렉터리의 `strategies/`(저장소를 그대로 쓸 때), (2) `$APP_DIR/scripts/cloud-vm/strategies/`(VM 배포 후 평평하게 복사된 위치에서 실행할 때 - `$APP_DIR` 자체가 git clone이라 이 하위 경로는 `git pull`로 항상 최신) 순서로 찾도록 했고, 어느 쪽도 없으면 확인한 경로를 그대로 보여주는 에러를 낸다. 모듈 import 시점이 아니라 `load_presets()` 호출 시점에 지연 평가하도록 해서, 이 모듈을 다른 코드가 단순 import만 하는 경우엔 디렉터리가 없어도 죽지 않는다. `run_kisyaml_strategy.py`의 사용법 docstring에도 VM 배포 후 실제로 써야 하는 경로(`scripts/cloud-vm/strategies/...`)를 함께 적었다. VM의 `$APP_DIR` 레이아웃(평평한 루트 + `scripts/cloud-vm/strategies/` 하위 git 경로)을 흉내 낸 임시 디렉터리로 두 경로 케이스 모두 재현 검증했고, `test/test_strategy_scan.py` 5건 포함 기존 테스트 전부 회귀 없이 통과했다. 이 PR(#23)이 squash 머지된 뒤라 브랜치를 `master` 최신 기준으로 다시 세워 이 수정만 새 커밋으로 올린다.


**2026-08-05 전략검색 실제 화면 신설 + 메뉴 개편(패턴·발굴→종목검색, 차트패턴 스캐너→차트검색)**: "실제 화면부터 가자" 요청으로 전략검색을 실제 사이트에 붙였다. `js/strategy-search.js`(신규)+`css/strategy-search.css`(신규)는 `js/pattern-scan.js`와 동일한 패턴(탭→목록, GAS를 통해 VM 결과를 가져옴)이되, 탭을 하드코딩하지 않고 API가 내려주는 `strategies` 객체 키를 그대로 렌더링해 서버 쪽 프리셋이 늘거나 줄어도 이 파일을 고칠 필요가 없게 했다. `breakout_fail`(카테고리 "손절")은 매수 신호가 아니라 이탈 경보라는 걸 화면에서도 구분해야 해서, 이 카테고리만 배지를 다르게(⚠ 이탈 경보, 호박색) 표시한다. `gas/ticker-proxy.gs`에 `?strategyScan=1` 라우팅과 `getStrategyScanResult()`(VM `/strategy-scan-batch`를 그대로 재포장, `getPatternScanResult()`와 동일 패턴)를 추가했다 - **Apps Script 편집기에서 수동으로 "배포 → 배포 관리 → 새 버전"을 눌러야 실제 반영된다**(git push만으론 반영 안 됨, ARCHITECTURE.md 기존 원칙 그대로). `js/skin-menu.js`의 2차 메뉴 그룹 `패턴·발굴`을 `종목검색`으로, 그 안의 `차트패턴 스캐너`를 `차트검색`으로 이름만 바꾸고(URL은 `/page/pattern-scan` 그대로 유지 - 페이지 자체를 새로 만들 필요 없음), `전략검색`(`/page/strategy-search`)을 새 항목으로 추가했다. `strategy_scan.py`의 `build_match()`에 화면 배지("2/2 충족")용 `matched`/`total` 필드를 추가했다(kisyaml_strategy.evaluate()의 entry.matched/total을 그대로 실어보냄, 하위호환 - 없어도 confidence로 폴백). `test/strategy-search.html`(신규, mock 데이터)을 Chromium(Playwright)으로 렌더링해 탭 전환·종목 카드·breakout_fail 경보 배지·다크모드까지 실측 확인했고(스크린샷), JS 콘솔 에러 없음도 확인했다. `test/test_ui_ia.py`의 메뉴 라벨 assertion을 갱신했고, 회귀 없이 기존 테스트(kisyaml 18건+strategy_scan 6건+ui_ia 15건 등) 전부 통과했다.

**남은 수동 작업**: (1) `gas/ticker-proxy.gs` Apps Script 새 버전 배포, (2) Tistory 관리자에서 `/page/strategy-search` 페이지를 새로 만들고(제목 "전략검색", URL slug `strategy-search`) 본문에 `<div id="strategy-search"></div>` + `css/strategy-search.css`·`js/strategy-search.js` 링크/스크립트 태그를 붙여넣어야 한다(스킨 skin.html은 위젯별 css/js를 로드하지 않고 각 페이지 본문이 직접 로드하는 기존 구조 - `/page/pattern-scan`도 이 저장소 밖 Tistory 관리자에만 존재해 정확한 원본 스니펫은 확인 못 했고, 기존 관례로 추정해 구성했다). `js/`·`css/`·`scripts/cloud-vm/`은 `master` 반영 후 각각 GitHub Pages·VM 자동 배포된다.


**2026-08-05(2차) 실시간 시세 가격·등락률·분봉차트 자동 갱신 안 되던 문제 + 거래량 Y축 겹침 재수정**: 사용자가 실시간 시세(`/page/stock-search`) 화면에서 종목을 고른 뒤 가만히 있으면 가격·등락률·분봉차트가 전혀 갱신되지 않는다고 리포트했다. 코드를 확인해보니 `js/stock-search.js`에는 애초에 주기적 재조회 자체가 없었다(선택 시 1회만 그리고 끝) - `js/watchlist.js`/`js/order-book.js`가 이미 쓰고 있는 실시간 체결가 WebSocket(`wss://goodbyestar.cloud/ws/quotes`)을 이 파일에는 아직 연결하지 않았던 것. 동일한 패턴으로 WebSocket을 추가해 상단 요약(`#ssSummary`)의 가격·등락률 텍스트를 체결 단위로 갱신하고, 분봉 탭에 머무는 동안은 60초 간격으로 분봉을 다시 불러오도록(`startMinuteRefresh`) 추가했다(`kospi-futures.js`의 "최소 60초" 관례와 동일 - 다만 확대구간을 보존하는 `setData()` 방식이 아니라 매번 차트를 다시 그리는 기존 방식 그대로라 60초마다 살짝 다시 그려지는 건 남아있음, 필요하면 후속 개선 대상). 탭 전환·종목 변경·화면 비활성화(`visibilitychange`) 시 소켓/타이머를 정리해 누수가 없게 했다. 같은 리포트의 "거래량 Y축이 가격과 겹친다"는 지난 회차(`2fb00f3`)에 커스텀 CSS 라벨(`.ss-volume-study-label`) 위치를 옮겨 한 번 고쳤던 것과는 다른 원인이었다 - 거래량 히스토그램 시리즈 자체가 `lastValueVisible: true`/`priceLineVisible: true`로 라이브러리 네이티브 마지막값 배지·점선을 그리고 있어서, 이미 같은 값을 보여주는 커스텀 범례와 별개로 가격축 배지·눈금 라벨과 같은 오른쪽 여백에 겹쳐 그려지고 있었다. 다른 보조지표 시리즈(이동평균선·일목균형표·거래량 20일선)와 동일하게 두 옵션을 꺼서 네이티브 배지 자체를 없앴다. `test/test_ui_ia.py`의 관련 계약 테스트(`lastValueVisible: true` 요구)가 이 변경과 충돌해 함께 갱신했다. 이 세션 샌드박스는 외부 CDN(unpkg.com의 Lightweight Charts)에 접근이 막혀 있어 실제 렌더링 스크린샷으로 최종 확인은 못 했고, 코드 비교(다른 보조지표 시리즈와 동일한 설정으로 맞춤)로 근거를 확보했다 - 배포 후 실제 화면에서 확인 필요. 회귀 없이 전체 테스트(ui_ia 15건, kisyaml 18건, strategy_scan 6건 등) 통과. `js/`·`css/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(3차) 실시간 시세 가격 불일치(상단 요약 vs 호가창) + 분봉 X축 시간 미표시 수정**: 위 자동갱신 수정 배포 후 사용자가 스크린샷으로 재확인해줬는데, 두 가지 새 문제가 보였다. (1) 상단 요약(27,250원 +4.41%)과 호가창(27,350원 +4.79%)이 서로 다른 가격을 보여줬다 - 원인은 같은 종목코드에 실시간 체결가 WebSocket을 2개(이 파일이 새로 연 것 + `js/order-book.js`가 이미 갖고 있던 것) 열어서 두 소켓의 수신 타이밍이 어긋난 것이었다. `js/order-book.js`에 `opts.onQuote` 콜백 훅을 추가해(`state.onQuote`, `applyRealtimeQuote` 마지막에 호출) 소켓은 `order-book.js` 하나만 열고 `js/stock-search.js`는 그 위젯이 이미 갱신한 값을 콜백으로 받아쓰도록 되돌렸다 - 이제 두 표시가 항상 같은 값을 보여준다. (2) 분봉 차트 X축이 "5일 5일..."처럼 날짜만 반복 표시되고 시각이 안 보였다 - 분봉의 `time`은 UNIX 타임스탬프인데 `timeScale.timeVisible`이 꺼져 있어 라이브러리가 날짜만 찍었다. `lwcThemeOptions(LWC, timeframe)`에 `timeframe` 인자를 추가해 분봉일 때만 `timeVisible: true`(시:분 표시)를 켜고 일/주/월봉(날짜 문자열이라 시간 개념이 없음)은 그대로 뒀다. `test/test_ui_ia.py`에 회귀 테스트 2건(자체 소켓 재도입 방지, 분봉 timeVisible)을 추가해 총 17건이 통과했다. 이번에도 CDN 접근 제한으로 실제 차트 렌더링은 이 세션에서 스크린샷 확인을 못 했다 - 배포 후 확인 필요. `js/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(4차) 분봉 X축 시각이 9시간 이르게 표시되던 문제 수정**: 위 (3차)에서 분봉 X축에 시:분을 켠 뒤 사용자가 스크린샷으로 "00:34, 00:50, 01:00"처럼 9시간 이른 시각이 찍힌다고 리포트했다(실제로는 09:34, 09:50, 10:00 장중 시각이어야 함). 원인은 Lightweight Charts가 UNIX 타임스탬프의 시:분을 표시할 때 브라우저 로컬 시간대가 아니라 항상 UTC 기준으로 읽는 라이브러리 동작 - `minuteRowsToBars()`가 실제 KST 시각을 정확하게 UTC로 환산해(`+09:00`) 타임스탬프를 만들었는데, 그 값을 UTC로 그대로 표시하니 9시간 밀려 보인 것. `+09:00` 대신 `Z`를 써서 "KST 시:분 숫자를 UTC인 척" 만드는 방식(다른 시리즈도 전부 이 값을 기준으로 좌표를 맞추므로 내부적으로는 일관되게 동작, 이 차트는 절대시각이 아니라 "장중 몇 시 몇 분"이라는 표시만 중요해 문제없음)으로 바꿔 해결했다. Node로 old/new 두 방식의 UTC 시각 값을 직접 계산해 09:30 KST가 old=0:30, new=9:30으로 나오는 걸 확인했다. `test/test_ui_ia.py`에 회귀 테스트 1건을 추가해 총 18건이 통과했다. 이번에도 CDN 접근 제한으로 실제 차트 렌더링은 이 세션에서 확인 못 함 - 배포 후 확인 필요. `js/`는 GitHub Pages 자동 배포 대상.

**2026-08-05(5차) 분봉 차트 여러 날짜 이어붙음 + VM 캐시 5분 지연 수정**: 위 (4차) 배포 후에도 분봉이 "23분에 멈춰있다"는 리포트가 계속돼 브라우저 Network 탭으로 함께 진단했다. `/ohlc-minute` 요청 자체는 60초마다 정상적으로 나가고 있었는데(프론트 타이머는 정상), VM이 이 응답을 `_LIVE_CACHE_TTL`(다른 여러 엔드포인트와 공유하는 5분 캐시)로 캐싱하고 있어 재요청해도 최대 5분간 같은 응답을 그대로 돌려주고 있었다(`API_REFERENCE.md`에 이미 문서화돼 있던 값). 사용자 확인 하에 `/ohlc-minute` 전용 캐시(`_OHLC_MINUTE_CACHE_TTL=60`)를 새로 분리해 프론트 폴링 주기와 맞췄다 - `_live_cache_get()`에 `ttl` 파라미터를 추가하고(기본값은 기존 `_LIVE_CACHE_TTL` 그대로라 다른 엔드포인트는 영향 없음) `/ohlc-minute`만 이 값을 넘기도록 했다. 이어서 사용자가 스크린샷으로 분봉 차트에 8/3~8/5 여러 날짜가 하나로 이어붙어 그려지고 있는 걸 보여줬는데, `API_REFERENCE.md`에 이미 적혀 있던 대로 `/ohlc-minute`(ka10080)는 "최근 며칠치가 한 번에" 오는 API였다 - `minuteRowsToBars()`가 시간(09:00~15:20)만 걸러내고 날짜는 걸러내지 않아서 여러 날의 분봉이 하나의 타임라인에 이어붙었고, 매번 그 전체 구간에 맞춰 `fitContent()`가 실행되면서 "새로고침할 때마다 줌아웃되는" 것처럼 보였다. 응답에 포함된 날짜 중 가장 최근 날짜만 남기도록 필터를 추가해 해결했다. `test/test_ui_ia.py`에 회귀 테스트 1건, `test/test_main_ohlc_minute_cache.py`(신규, main.py가 fastapi 의존성 때문에 이 샌드박스에서 import 안 돼 test_ui_ia.py와 동일하게 소스 텍스트 검사 방식)에 1건을 추가해 총 20건이 통과했다. `API_REFERENCE.md`의 `/ohlc-minute` 캐시 시간·데이터 주의 항목도 갱신했다. `js/`는 GitHub Pages, `scripts/cloud-vm/`은 VM 자동 배포 대상.
## 2026-08-08

- 가격 지형도 건물 영역에 좌우 드래그를 연결해 하단 `가격별 매물대` 가격 구간을 함께 이동하도록 개선. 기존 하단 rail 드래그와 좌우 버튼은 유지.
- 매물대 전체화면 모달로 이동할 때 `#foreign-flow` CSS 스코프가 끊겨 SVG가 검정색으로 보이던 문제 수정. 임시 스코프 래퍼를 유지해 원래 일러스트 색상과 레이아웃을 적용.
- 넓은 화면에서 가격 칸이 모두 한 줄에 들어가 드래그할 스크롤 공간이 없던 문제 수정. 가격 칸을 고정 폭으로 바꾸고 포인터가 rail 밖으로 나가도 캡처를 유지해 마우스 좌우 드래그가 계속 동작하도록 보강.
- 가격 지도 드래그 동작을 하단 rail 이동이 아닌 건물 트랙 직접 이동으로 변경. 10개 가격 구간 건물을 이어 렌더링하고, 드래그할 때 클리핑 영역 안으로 인접 건물이 들어오도록 구현.
- 가격별 매물대 rail 간격을 촘촘하게 조정하고, PC 건물 지도는 최대 14개 가격 구간을 이어 더 넓게 드래그하도록 확장. 헬기 아래 흐름 사다리와 지하실 방향의 움직이는 체결 흐름·문 빛 효과를 추가.
- 헬기 위치를 위로 올리고, 사다리를 지상까지 내리지 않고 헬기 아래 대표 건물의 옥상까지만 연결하도록 조정.

**2026-08-08 금융투자협회 종합통계 보조지표 연결**: 공공데이터포털 금융위원회 금융투자협회 종합통계 API의 `신용공여잔고추이`·`증시자금추이`를 VM `/kofia-market`(30분 캐시)으로 연결했다. 신용융자 잔고, 투자자예탁금, 반대매매 비중과 최근 일별 추이를 마지막 시장 브리핑 카드에 보조지표로 표시하며, 기존 증시온도 점수에는 합산하지 않아 실시간 온도 기준은 유지한다. 인증키는 코드에 저장하지 않고 VM `.env`의 `DATA_GO_KR_KOFIA_SERVICE_KEY`에서만 읽는다.
**2026-08-08 빚투 위험도 시장온도 반영**: KOFIA의 신용융자 잔고·투자자예탁금·반대매매 비중을 최근 추세와 함께 계산해 `빚투 위험도` 10점 구성요소로 편입했다. 예탁금 대비 신용융자 35% 미만·최근 평균 대비 +5% 미만·반대매매 비중 10% 미만을 안정 기준으로, 45% 이상·+10% 이상·15% 이상 중 하나면 과열로 표시한다. 별도 그래프는 추가하지 않고 구성요소 행의 상태·비율·ⓘ 기준 설명으로 처리해 화면 길이를 늘리지 않았다. KOFIA 미설정 시 기존 온도 점수는 그대로 유지된다.
**2026-08-10 홈 실시간 종목판 WebSocket 재연결 보강**: 서버가 Finnhub 체결 이벤트를 정상 발행하는데도 브라우저 소켓이 일시적으로 끊기면 `onclose`에서 참조만 지우고 다시 연결하지 않아 가격이 멈춰 보일 수 있었다. `js/home-realtime-table.js`에 지수 백오프 재연결(1.5초~30초), 생성 세대 검증으로 이전 소켓 이벤트 무시, `onerror` 정리, 탭 비활성/복귀 시 소켓 정리·재연결을 추가하고 연결 상태를 화면에 표시한다. 기존 30초 REST 갱신은 초기 목록과 폴백으로 유지한다. `test/test_ui_ia.py`에 재연결 계약 검사를 추가했다.
**2026-08-10 미국 차트 224일선용 일봉 이력 보강**: 운영 `/us-chart/AAPL?timeframe=daily`가 2년 시작일을 요청해도 키움 `usa06012` 응답을 100개 일봉만 반환해 224일 이동평균 계산에 필요한 봉 수가 부족했다. 일봉 응답이 224개 미만이면 성공 응답으로 간주하지 않고 Yahoo Finance의 `range=2y&interval=1d` 데이터로 폴백하도록 변경했다. 분봉과 224개 이상을 반환하는 일봉은 기존 키움 우선 경로를 유지하며, 데이터 부족 원인은 서버 로그에 남긴다. 관련 회귀 테스트를 추가했다.
**2026-08-10 미국 차트 Y축 가격 표시 보정**: 미국 차트의 Y축은 캔들 가격 축이었지만 공통 포맷터가 모든 시장에 `Math.round()`를 적용해 달러 기호와 소수점이 사라지고 `38`, `35`, `20`처럼 표시됐다. 미국 종목(`US:`)은 `$38.00` 형식과 0.01 최소 눈금으로 표시하고, 국내 종목은 기존 원화 정수 표시를 유지하도록 `js/stock-search.js`를 수정했다. MA5/20/60/224 범례 값도 같은 미국 달러 포맷을 사용한다. 관련 UI 회귀 검사를 추가했다.
**2026-08-10 미국 종목분석 폰트·가격 필드 표시 보정**: `css/stock-search.css`가 시스템 고딕을 직접 지정해 사이트의 마루부리/나눔고딕 폰트 토글을 무시하던 문제를 `font-family: inherit`로 수정하고, Lightweight Charts 캔버스에도 현재 본문 폰트를 전달했다. 함께 키움 미국 시세 응답의 고가·저가·52주 고저가에 붙는 부호를 절대값으로 정규화해 `$-98.96`처럼 보이던 잘못된 가격 표시도 바로잡았다.
**2026-08-17 실시간 종목판 휴장 순위 처리·업종 TOP 집계 수정**: 국내장이 휴장하면 KIS의 거래증가율·거래회전율·거래대금회전율 응답이 비어 있는데 프론트가 거래대금 순위로 폴백해 같은 목록을 보여주던 문제를 수정했다. 빈 순위는 `국내시장 휴장 또는 해당 순위 데이터가 없습니다.`로 표시한다. `업종 TOP`은 WICS 업종 맵으로 이미 수집된 종목 후보를 업종별로 묶어 평균등락률(1순위)·상승비율(2순위)·거래대금(3순위)으로 정렬하고, 업종별 종목 수·상승 종목 수·대표 종목을 함께 보여준다. 신규 종목별 시세 호출은 추가하지 않았다. 전체 테스트 343건, UI 75건, 시장보드 11건과 Python/JS 문법 검사를 통과했다.
