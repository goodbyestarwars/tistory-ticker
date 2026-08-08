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

현재 연결 지점:

- `/quote`: 키움 실패 시 `주식시세정보`, 이후 `증권상품시세정보`를 시도합니다.
- `/ohlc/{code}`: 키움 일봉 실패 시 `주식시세정보`의 종목별 일봉을 시도합니다. 실시간·분봉 대체가 아닙니다.
- `daily_scan.py`: GitHub Pages의 `data/krx_map.js`를 읽지 못할 때 `KRX상장종목정보`로 전종목 목록을 구성합니다.
- `/investor-flow/{code}`: 기존 연기금 매매 흐름에 국민연금 연말 보유액·자산군 비중·지분율을 보조 필드로 추가합니다.
- `fetch_etf_list.py`: 기존처럼 `증권상품시세정보`의 ETF 오퍼레이션으로 ETF 종목 목록을 갱신합니다.

공공데이터는 일별·지연 데이터이므로 실시간 시세, 호가, 분봉, 당일 투자자별 수급을 대신하지 않습니다. 주 데이터가 정상일 때는 기존 KIS/키움 결과를 우선합니다.
