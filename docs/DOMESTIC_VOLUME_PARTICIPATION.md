# 국내 시장 거래량 참여도 — 2026-10-28

홈 국내 패널만 `volumeParticipation`으로 전환한다. 미국 합산 막대, KIS 상승/하락 집계, 증시온도, 서버 응답과 캐시, 검색기와 실주문 코드는 변경하지 않는다. 기존 NineAPI.marketParticipation을 재사용한다. 별도 수집/프로세스/요청을 추가하지 않는다.

## 정의·품질

- 증가: 상대 거래량 >1, 종목당 1표. 중앙값은 서버 값을 사용한다. 유효/구성/증가 수를 구분한다.
- 참여도 status=ok, 지수 status=ok, basis=same-time-5m, lookbackDays=10, 정수 표본·증가수·모집단 일치, eligible/total >=95%, ratio 0~1 및 increased/eligible 일치, median 유한·0 이상을 모두 검사한다. 보조 합산 지수는 독립 검증한다.
- 95%는 기존 합산 지수의 보수적 기준과 통일했다. 부족한 상대 거래량 표본의 서버 status를 변경하지 않고 홈에서 차단해 다른 소비자 계약을 유지한다.
- 평일 KST09:00~15:40 수집 후300초, 그 외3600초 초과는 갱신 지연. 서버120초/3600초 TTL을 고려한다. 휴일에도 평일 장중 구간은 보수적으로300초 적용. 공급자 지연은 응답 delaySeconds 그대로, 수집은 retrievedAt을 KST로 표시한다. actual bar timestamp는 응답에 없으므로 시세 기준시각을 만들어내지 않는다. API 실패는 수치 제거/확인 중.
- [TradingView 공식 Screener 설명](https://www.tradingview.com/support/solutions/43000635874-how-do-we-calculate-relative-volume-and-relative-volume-at-time/)은 최근10일 동시간대5분봉 평균 비교라고 명시한다. `relative_volume_intraday|5`를 요청하는 기존 scanner 응답을 직접 확인했다. 원시 과거10일 봉·분모는 공급되지 않아 종목별 과거 기준 재계산/신규상장 이력/정지 여부/관측시각 동기성은 독립 검증 불가. 화면에는 공급자 설명 기준임을 명시한다. 누적 하루 거래량으로 설명하지 않는다.

## 실제 공급자 비교 (2026-10-28 약11:00 KST 단일 관측)

| 지수 | 구성/행/고유/유효 | 증가 비율 | 중앙값 | 거래량>0 필터 후 유효 | 필터 후 비율/중앙값 |
|---|---|---|---|---|---|
| KOSPI |805/805/805/805|34.1615%|0.769809|805|동일|
| KOSDAQ |1723/1723/1723/1723|34.5328%|0.740179|1723|동일|

중복·응답 totalCount 대비 누락 없음. 전체 KRX 상장명부와 일치한다는 의미는 아니다. KIS 전체시장 집계와 공급자 지수 구성은 모집단이 다르다. 상대 거래량100배 초과는 각각1/2종목이었다. 이상치를 임의로 잘라내지 않으며 동일 가중·중앙값으로 영향 제한. 0거래량 제외 비교에서 변화가 없었고 소형주 최소 유동성/신규상장 필터를 정당화할 근거가 없어 추가하지 않았다. 결측·음수·비유한 배수는 기존 서버에서 제외하며 실제0배수는 포함한다. 유효성은 현재 거래량 필드가 필요한 합산 지수와 다르다. 신규상장/정지의 모든 상태를 검증했다고 주장하지 않는다.

## 검증

- Python: breadth, 증시온도 score/cache/snapshot, observer 및 PC entry priority/runner/signal client/trade: **159 passed, 26 subtests passed**.
- JS: 참여도 모델·렌더러, 0/50/100%, 중앙값0/<1/=1/>1, 비정상숫자/결측/표본94·95%, 시장격리, 오래된 수집/실패/20분지연, 합산 지수 독립성 검증 통과.
- 초대형주2개의 상대거래량100만배·현재거래량10^15 변형: 참여비율50%/중앙값1배 불변, 합산 지수만 증가.
- 기존 JS 회귀19파일 중18통과. `test_market_temp_heatmap.js`는 `asOfText_ is not defined` fixture 누락으로 실패. 관련 test/js/서버 파일이 origin/master와 동일함을 git diff로 확인했으며 이번 변경의 통과로 보고하지 않는다.
- Headless Edge: 1440/390/360px × 정상/결측/지연 및 이전 화면12장. 동일 가로눈금·모바일 세로·가로넘침0·상세열기 확인. 공통 home-market-board.css와 실제 렌더 함수 사용. 비교 화면은 **합성 테스트 자료**이며 운영 사이트 화면이나 실거래 증거가 아니다. 파일: [변경 전 PC](qa/domestic-participation-2026-10-28/before-1440.png), [변경 후 PC](qa/domestic-participation-2026-10-28/after-1440.png), [모바일](qa/domestic-participation-2026-10-28/after-390.png).
- 재현: `node test/test_market_participation.js`, `node test/test_market_participation_bars.js`, `node test/test_market_participation_browser.js` (playwright 필요, 기본 msedge, PLAYWRIGHT_CHANNEL로 변경).

## 배포·롤백

단일 PR을 master로 병합하면 기존 Pages 경로에서 JS/CSS 배포. skin.html 수동 변경 불필요. VM Python·data/ 변경 없음. 운영 VM 배포/서비스 재시작/실거래 설정 변경 명령을 실행하지 않는다. VM 타이머는 frontend-only diff에서 VM 코드 복사/재시작을 생략하지만 이전 미배포 backend 변경이나 배포 SHA 유실이 있으면 재시작 가능하므로, 이번 요청의 VM 승인 제한을 위해 master 병합 전에 이 상태를 확인해야 한다. 확인이 불가능하면 PR을 열어 둔다.

롤백은 이 PR의 단일 병합 커밋을 revert하는 PR을 master로 반영하여 Pages의 이전 JS/CSS를 복원한다. 서버 캐시·데이터·매매 설정 복원 작업은 없다. 배포 완료 여부는 PR/최종 보고에서 별도로 구분한다.

배포 경계 실측: VM `.last_deployed_sha`는 `92b7b1b2`, 작업 기준 master는 `1182b05b`다. 두 SHA 사이에 기존 backend 9파일의 미배포 변경(피드/신호 포함)이 있다. 이번 PR이 프런트만 바꿔도 master 병합은 기존 VM 타이머의 미배포 backend 배포 경로에 영향을 줄 수 있으므로 **PR 생성까지만 수행하고 병합/운영 배포는 보류**한다. 사용자 VM 별도 승인 제한을 따른다.
