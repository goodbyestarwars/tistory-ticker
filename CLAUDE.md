# tistory-ticker

티스토리 블로그(ghlee.tistory.com, 9bolt 스킨)의 티커 툴팁·섹터 대시보드·종목뉴스·마켓리본 소스.
**GitHub Pages로 서빙됨**: `https://goodbyestarwars.github.io/tistory-ticker/{경로}` — master에 push하면 1~10분 내 블로그에 자동 반영된다(cache max-age=600). 파일명 버저닝 금지: 같은 파일을 계속 갱신할 것(URL이 블로그 HTML에 박혀 있음).

## 파일 구성

| 경로 | 역할 |
|---|---|
| `data/sectors-v3.js` | 섹터 대시보드 데이터. `window.SECTOR_MAP = { "섹터명": [{ name, code, market }, ...] }` (market: "KOSPI"/"KOSDAQ") |
| `js/sector-dashboard-v4.js` | 섹터 대시보드 렌더링(시장 뱃지 P/Q 포함, 뱃지 CSS는 JS가 주입) |
| `css/sector-dashboard-v3.css` | 대시보드 스타일(카드/히트맵/다크모드) |
| `data/krx_map.js` | 종목명→코드 전 종목 매핑(티커 툴팁·종목뉴스용) |
| `js/ticker-tooltip-v5.js`, `js/stock-news.js`, `js/market-ribbon.js` | 본문 툴팁 / 종목뉴스 / 상단 리본 |
| `data/marketcap-codes.js`, `js/marketcap-bubble.js`, `css/marketcap-bubble.css` | 시가총액 히트맵(트리맵). ETF10/INVERSE4/단일종목레버리지 합산 2종은 `data/marketcap-codes.js`, 코스피·코스닥 개별종목은 `data/sectors-v3.js` 전체 풀(업종 태그 포함, 업종 필터 지원)을 GAS가 재사용. 등락률 -3%~+3% 7단계 색상. GAS `?bubble=1` 액션을 45초 간격 폴링 |
| `gas/ticker-proxy.gs` | GAS 프록시 소스(시세·뉴스·AI요약·증시온도·히트맵·수급·공매도압박·연기금·랭킹뉴스·차트패턴스캔). 수정 시 script.google.com에서 수동 재배포 필요 — push만으로는 반영 안 됨. 히트맵 ETF/INVERSE/레버리지 구성 변경 시 `data/marketcap-codes.js`와 이 파일의 `MARKETCAP_CODES` 둘 다 수정 |
| `js/foreign-flow.js`, `css/foreign-flow.css` | 종목별 외국인·기관 수급 위젯(연속매매·추세전환 뱃지 포함). GAS `?action=foreignFlow` 온디맨드 크롤링, 서버 캐시 없음 |
| `js/pattern-scan.js`, `css/pattern-scan.css` | 차트 패턴 스캔 위젯(저점상승형/쌍바닥/역헤드앤숄더/박스권하단/골파기반전/눌림목 6종) - 캔들차트 + 패턴선 오버레이. 모든 패턴은 0~100점 채점(70점 이상만 노출, AI 임의판단 없이 수치조건), 점수+원인+한줄해석을 함께 표시. 리스트는 GAS `?patternScan=1`(하루 1회 시간 트리거로 미리 스캔·캐싱, 골파기/눌림목은 MA60 필요해 별도 트리거로 분리), 클릭 시 차트는 `?patternChart=1&code=&pattern=`으로 온디맨드 재크롤링. 스캔 대상은 `data/sectors-v3.js`를 GAS가 fetch해서 재사용(별도 종목 리스트 하드코딩 없음) |
| `js/watchlist.js`, `css/watchlist.css` | 관심종목 카드 위젯. localStorage(최대 50개, 종목명 자동완성으로 추가) - 신규 GAS 엔드포인트 없이 기존 `?codes=` 시세 API 재사용 |
| `js/market-temp.js`, `css/market-temp.css` | 오늘의 증시온도(VIX25+수급30+상승비율25+거래대금20=100점). VIX는 Yahoo Finance(`query1.finance.yahoo.com`, 네이버엔 없음), 수급은 KODEX200(069500) 대리지표, 상승비율/거래대금은 섹터 종목풀 재사용. GAS `?marketTemp=1` |
| `js/short-pressure.js`, `css/short-pressure.css` | 공매도 압박 위젯(100점, 대차잔고는 네이버·KRX 모두 개별종목 단위 미제공이라 제외하고 재분배: 거래비중40/잔고증가30/외국인15/기관15). 데이터 소스는 KRX 정보데이터시스템(`data.krx.co.kr`, 공개 API — 종목코드→ISIN 매핑 캐싱 필요). GAS `?action=shortPressure&code=` 온디맨드 |
| `js/pension-fund.js`, `css/pension-fund.css` | 연기금 분석 위젯. KRX "투자자별 거래실적 상세"(11개 투자자 구분 중 연기금만 추출 — 기관 합산 아님)로 연속순매수일수/구간별 순매수/평균매수가(추정)/수익률 표시. GAS `?action=pensionFund&code=` 온디맨드 |
| `test/*.html` | 로컬 프리뷰(python -m http.server로 열기). 위젯마다 기본은 mock 데이터, `?real=1`이면 실제 GAS 호출 |
| `data/sectors-v3-검수표.md` | 종목코드 매핑 검수표 — 섹터 데이터 수정 시 같이 갱신 |

블로그 스킨 원본(skin.html, style.css)은 이 저장소에 없음(.gitignore) — 티스토리 스킨 편집기로 직접 배포.

## 섹터 데이터 수정 규칙 (가장 잦은 작업)

1. **중복 제거 금지**: 한 종목이 여러 섹터에 의도적으로 중복 포함됨(현대차, 포스코DX, SK이노베이션, 한화에어로스페이스, 풍산, POSCO홀딩스, 삼성물산, GS, LS, LG화학, 두산에너빌리티, 한전기술 등).
2. **종목코드는 추측 금지**: KRX KIND 상장사 목록으로 확인할 것 —
   `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=stockMkt`(코스피) / `kosdaqMkt`(코스닥), EUC-KR HTML 테이블. 확인 불가하면 사용자에게 보고.
3. **KIND 등록명과 표기가 다른 종목(별칭 함정)**: 현대차→현대자동차, KT→케이티, KT&G→케이티앤지, KCC→케이씨씨, LS ELECTRIC→엘에스일렉트릭, SK바이오팜→에스케이바이오팜, 삼성화재→삼성화재해상보험, 한국전력→한국전력공사, HDC현대산업개발→IPARK현대산업개발, HD현대건설기계→HD건설기계. 표시명은 블로그 표기를 쓰고 코드만 KIND에서 가져온다.
4. 삼성에피스홀딩스는 특수코드 `0126Z0`(정상). HD현대인프라코어(042670)는 합병 상장폐지라 시세가 안 나옴.
5. 수정 후 검증: `python -m http.server` + `test/sector-dashboard-v4.html` 열어서 해당 섹터 카드에 종목·시세가 뜨는지 확인. 그 다음 commit·push.
6. push 후 반영 확인: `curl https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js` 에 수정 내용이 실렸는지 확인(최대 10분 지연).

## 기타 규칙

- 상승=빨강(#d24f45), 하락=파랑(#1261c4). 스킨 다크모드는 `html.dark` 클래스 — 본문에 들어가는 새 UI는 `html.dark #컨테이너ID ... !important` 오버라이드 필수(스킨의 블랑켓 규칙이 글자색을 흰색으로 덮어씀).
- 시세 조회 GAS URL: `https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec?codes=005930,000660` 형태.
- `.json` 업로드 제약 때문에 데이터는 전부 `window.XXX = {...}` 형태의 `.js`로 만든다.
- KRX 정보데이터시스템(`data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`)은 로그인 없이 POST로 열람 가능한 공개 API(공매도압박·연기금 위젯이 사용). bld/파라미터는 오픈소스 pykrx 라이브러리 소스로 확인했지만, 이 환경은 해당 도메인에 직접 접근 못 해 실제 응답으로 검증한 적은 없다 — GAS 재배포 후 실데이터로 한 번 확인 필요.
