# 검색기 모니터링과 다시 쓰는 기준 (2026-11-20 KST, 사용자 지시 "확실하면 남기고 아니면 모니터링 및 수정 대상")

## 지금 쓰는 것과 모니터링 대상

- **자동매매 신규 매수:** 검증을 통과한 '주도주 조용한 눌림'만(비공개 `autotrader-private` PR #9, `SWING_ENTRIES=False`·`NINEPAY_ENTRIES=False`).
- **모니터링·수정 대상:** 스윙 검색기 4개(눌림목·쌍바닥·역헤드앤숄더·구름대 돌파), 9Pay 단타, 검색기 5개 메뉴, 저점상승 등 나머지 검색기.
  화면 표시는 그대로 둔다(사용자 선택). 후보 수집·추적 기록은 계속한다.

## 모니터링 방법

- `scripts/cloud-vm/shape_scan.py`의 `monitor_summary`가 매일 모양 선정 배치에서 기존 추적 기록(`pattern_tracks`)을 읽어
  검색기마다 exit-v1(20일선)·exit-v2(60일선) 실제 결과를 따로 집계한다(`exit_plan.track_summary`, 다음 거래일 시가 매수·비용 0.7%·보유 중 재포착 제외).
- 같은 집계를 'KOSPI 종가가 60일선 위인 날 포착분만'으로도 낸다(저장된 KOSPI 확정 종가, 새 호출 없음).
- 결과는 `/pattern-scan`의 `shapeSelection.monitor`에 있다. 화면 표시·선정·주문은 바꾸지 않는다.
- 대상 키: `pattern:shape-v2:<5개 메뉴>`, `pattern:pullback·doubleBottom·invHeadShoulders·maCloudBreakout·risingLows·shortTermMaBreakout·boxRangeLow·firstPullbackBreakout·longTermQuality·accumulationBar`,
  `pattern:edge:quietLeaderPullback·rsHighResidual·surgeNextDay·gapVolumeClose·timeLagAccumulation`. 9Pay 단타는 `docs/NINEPAY_DAYTRADE_VALIDATION_2026-11-20.md`를 따른다.

## 다시 쓰는 기준 (결과 보기 전 고정, 바꾸지 않음)

- exit-v2 기준으로 끝난 매매 100건 이상, PF 1.3 이상, 매매 1건 평균 +1.0% 이상(비용 차감)을
  '전체' 또는 'KOSPI 60일선 위' 중 하나에서 넘으면 자동매매에 다시 넣는 안을 사용자에게 올린다(넘은 쪽 조건 그대로).
- 기준을 넘어도 자동으로 켜지 않는다. 실계좌 변경은 항상 별도 승인이다.
- 한계: 추적 기록은 2026-10 이후라 표본이 작고, 한 시장 국면만 담는다. 과거 5년 성적표(`docs/SCANNER_MENU_SCORECARD_2026-11-20.md`)와 함께 본다.
