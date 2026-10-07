**2026-10-04 지지·저항: 한쪽에 선이 없을 때 1회 스윙으로 보충**

사용자 지적("지지/저항 없는데?" - NAVER처럼 52주 저점 부근이라 현재가 아래에 2회 이상 닿은 가격대가 1개뿐). `js/chart-sr.js`·`js/stock-search.js`의 `supportResistanceLevels`가 한쪽(지지/저항)에 2회 이상 닿은 선이 2개 미만이면 한 번만 닿은 스윙 고·저점(1회)을 가까운 순서로 보충해 최소 2개까지 표시한다(NAVER: 지지 190,533·2회 + 181,100·1회). 검증: `test_support_resistance.py`·`test_ui_ia.py` 통과, NAVER 실제 일봉으로 확인.
