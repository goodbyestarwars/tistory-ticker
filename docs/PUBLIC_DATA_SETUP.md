# 공공데이터 2차 경로 설정

승인된 공공데이터포털 서비스키는 VM의 `scripts/cloud-vm/.env`에만 넣습니다. GitHub Pages와 저장소에는 키를 넣지 않습니다.

```dotenv
DATA_GO_KR_SERVICE_KEY=발급받은_서비스키
```

서비스별로 키를 따로 발급·관리하는 경우에는 아래 선택 환경변수로 분리할 수 있습니다.

```dotenv
DATA_GO_KR_STOCK_SERVICE_KEY=주식시세정보_키
DATA_GO_KR_KRX_SERVICE_KEY=KRX상장종목정보_키
DATA_GO_KR_PRODUCT_SERVICE_KEY=증권상품시세정보_키
DATA_GO_KR_NPS_SERVICE_KEY=국민연금_국내주식투자정보_키
```

`DATA_GO_KR_NPS_SERVICE_KEY`는 국민연금 관련 데이터셋 2개(국내주식 투자정보 namespace 3070507, 대량보유주식 보고내역 namespace 15106890) 모두에 쓰입니다. data.go.kr의 "일반 인증키"는 계정 단위로 여러 승인 데이터셋에 공용으로 쓰이지만, 데이터셋마다 활용신청·승인이 각각 필요합니다 - 하나만 승인받은 상태로는 다른 하나가 계속 실패(서비스키 문제가 아니라 미승인/404)할 수 있습니다.

현재 연결 지점:

- `/quote`: 키움 실패 시 `주식시세정보`, 이후 `증권상품시세정보`를 시도합니다.
- `/ohlc/{code}`: 키움 일봉 실패 시 `주식시세정보`의 종목별 일봉을 시도합니다. 실시간·분봉 대체가 아닙니다.
- `daily_scan.py`: GitHub Pages의 `data/krx_map.js`를 읽지 못할 때 `KRX상장종목정보`로 전종목 목록을 구성합니다.
- `/investor-flow/{code}`: 기존 연기금 매매 흐름에 국민연금 연말 보유액·자산군 비중·지분율(`official_holding`, 연 1회)과 대량보유상황보고(`large_holding_report`, 5% 이상 보유·1%p 이상 변동 시 신고, data.go.kr이 분기 단위로 재배포 - namespace 15106890, 발행기관명/보고서 작성기준일/지분율(퍼센트)만 제공하고 평가액·비중 필드는 없음. 전체 포트폴리오가 아니라 5%룰 신고 종목만 있어 대부분 종목은 None이 정상)를 보조 필드로 추가합니다. 분기마다 새 uddi 리소스가 발행되므로 `public_data.NPS_LARGE_HOLDING_URL`을 그때그때 갱신해야 합니다(infuser.odcloud.kr 스웨거 문서 namespace=15106890/v1에서 최신 uddi 확인).

### 국민연금 연 1회 보유정보(namespace 3070507) - 2026-08-20부터 정적 스냅샷 우선

`public_data._fetch_nps_rows()`는 `scripts/cloud-vm/nps_holdings_2025.json`(저장소에 커밋된 공개 데이터 파일)이 있으면 data.go.kr API를 호출하지 않고 그 파일을 그대로 쓴다. data.go.kr(namespace 3070507)이 아직 2024-12-31 스냅샷까지만 있어서(2026-08-20 기준, infuser.odcloud.kr 스웨거 문서로 직접 확인) 2025년 말 데이터가 없었는데, 국민연금기금운용본부 자체 사이트(`fund.nps.or.kr` → 운용현황 → 자산군별 현황 → 국내 주식 → 투자종목 → 연도별 다운로드)에는 2025년 말 데이터가 이미 있어서(파일 안내문: "전년도 말 기준 자산군별 세부내역은 금년도 3분기에 공시" - data.go.kr 재배포보다 원본이 더 빠름) 그 파일을 직접 받아 반영했다.

**다음 연도 데이터로 갱신하려면**: `fund.nps.or.kr`에서 새 연도 파일을 받아 같은 컬럼(번호/종목명/평가액(억원)/자산군 내 비중/지분율, 소수 형식)으로 파싱해 `scripts/cloud-vm/nps_holdings_2025.json`을 교체(또는 새 연도 파일명으로 바꾸고 `public_data._NPS_STATIC_SNAPSHOT_FILE` 경로도 같이 수정)하고, `public_data._NPS_AS_OF`도 새 기준일로 갱신해야 한다 - 자동 갱신되지 않는다.

`fund.nps.or.kr` 자동 연동은 검토 후 하지 않기로 결정했다(2026-08-20) - 매년 1회 수동으로 파일을 받아 위 방식으로 교체하는 걸 유지한다. 다시 검토하려면 다운로드 버튼의 실제 요청 URL(연도별 파라미터 패턴, 세션/토큰 필요 여부)부터 확인해야 한다.
- `fetch_etf_list.py`: 기존처럼 `증권상품시세정보`의 ETF 오퍼레이션으로 ETF 종목 목록을 갱신합니다.

공공데이터는 일별·지연 데이터이므로 실시간 시세, 호가, 분봉, 당일 투자자별 수급을 대신하지 않습니다. 주 데이터가 정상일 때는 기존 KIS/키움 결과를 우선합니다.

## 금융투자협회 종합통계

KOFIA 보조지표를 사용하려면 VM `.env`에 `DATA_GO_KR_KOFIA_SERVICE_KEY`를 설정합니다. `/kofia-market`이 신용융자 잔고·투자자예탁금·반대매매 비중의 최근 추이를 제공하며, 시장온도 응답의 `kofia` 필드와 시장 구성요소의 `creditRisk` 행에 연결됩니다.

`creditRisk`가 설정되면 시장 구성요소에 10점 항목으로 합산됩니다. 최근 신용융자 추세, 예탁금 대비 비율, 반대매매 비중을 기준으로 안정·주의·과열을 판정하며, 기준은 규제선이 아닌 화면용 운영 기준입니다.
