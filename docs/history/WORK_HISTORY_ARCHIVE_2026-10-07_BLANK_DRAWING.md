# 이관 작업이력

**2026-10-04 패턴 포착 사후 추적(포착 → 추적 → 결과 판정)**

목적: 차트검색은 그날 조건에 맞는 종목만 보여 줘서 한 번 포착된 종목의 결과를 볼 수 없었다. `scripts/cloud-vm/pattern_tracker.py` 신설 + SQLite `pattern_tracks` 테이블(포착 당시 스냅샷 immutable: 포착가·점수·지지·저항·ATR·patternDetail / 현재값 별도 갱신). 상태 NEW→TRACKING→BREAKOUT→BREAKOUT_CONFIRMED, FAILED(지지 이탈·돌파 실패), EXPIRED(15거래일). 종가 기준: 돌파=종가≥저항×1.02, 유지=돌파 후 3거래일 종가가 저항×0.99 이상, 지지 이탈=지지선−0.5ATR 아래 연속 2일 또는 −1ATR 아래 즉시. MFE/MAE는 포착가 대비 고가·저가, 5/10/20일 수익률은 종가. `daily_scan.py`가 스캔 직후 신규 등록과 일봉 재판정을 수행(실패는 무시), 스캔 결과에서 빠져도 기록은 지우지 않는다. `GET /pattern-tracks?scanner=pattern:<키>&view=active|closed|all`(공개, 읽기 전용) + 검색기별 통계. 화면(`js/pattern-scan.js`)에 [현재 포착][추적 중][추적 종료] 전환, 통계 헤더, 상세 헤더·차트 마커·포착 지지/저항선 추가, 문구 "추천"→"포착". 검증: `test_pattern_tracker.py` 11건 통과, 전체 테스트 실패 13건은 변경 전과 동일(Windows fcntl 등). 배포: master 반영 시 VM 자동 배포, 첫 포착 기록은 다음 일일 스캔부터 쌓임.
