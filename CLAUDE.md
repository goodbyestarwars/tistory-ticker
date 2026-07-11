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
| `js/foreign-flow.js`, `css/foreign-flow.css` | 종목별 외국인·기관 수급 위젯(연속매매·추세전환 뱃지 포함). GAS `?action=foreignFlow` 온디맨드 크롤링, 서버 캐시 없음. **2026-07-11부터 공매도/대차거래/연기금 섹션이 여기 병합됨**(`buildExtraSections`) — `data/investor-flow-cache.js`에 있는 종목만 추가로 표시, 없으면 안내 문구만 노출. 가격 차트(지지/저항+이평선, 최근 1년)는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드)로 렌더링 — 직접 그리는 SVG 아님 |
| `data/investor-flow-cache.js`, `scripts/fetch_investor_flow.py` | 공매도(누적잔고/평균가/거래비중/Days to Cover/압박점수 100점)·대차거래(잔고/증감률)·연기금(연속순매수일수/구간별 순매수/해석) 캐시. KRX가 완전 차단됐지만 **증권사(키움) 정식 REST API는 이 데이터를 계속 제공**해서 이 경로로 우회. GAS가 아니라 **사용자 PC에서 로컬로 스크립트 실행 → git commit/push**하는 구조(증권사 API 앱키가 IP 등록 필요 + 계좌 연동 개인키라 GAS 같은 공개 서버에 못 둠). `KIWOOM_APPKEY`/`KIWOOM_SECRETKEY` 환경변수 필요(하드코딩 금지), 대상 종목은 `data/sectors-v3.js` 풀(238종목, 전체 종목 아님) 재사용. 데이터는 하루 1회 갱신이라 실시간 서버 불필요 — PC를 하루 한 번 켤 때 실행하는 것으로 충분. **미검증**: REST 엔드포인트는 MCP(`mcp__kiwoom__*`)로 확인한 실제 응답 필드 기준으로 작성했지만 실계정으로 직접 테스트 안 됨 — `TEST_CODES`로 소량 검증 후 `--all` 실행할 것 |
| `js/pattern-scan.js`, `css/pattern-scan.css` | 차트 패턴 스캔 위젯(저점상승형/쌍바닥/역헤드앤숄더/박스권하단/눌림목 5종, 지시서 스펙 그대로) - 캔들차트(TradingView Lightweight Charts, CDN 지연 로드) + 패턴선 오버레이. 모든 패턴은 0~100점 채점(70점 이상만 노출, AI 임의판단 없이 수치조건), 점수+원인+한줄해석을 함께 표시. 리스트는 GAS `?patternScan=1`(하루 1회 시간 트리거로 미리 스캔·캐싱, 눌림목은 MA60 필요해 별도 트리거로 분리), 클릭 시 차트는 `?patternChart=1&code=&pattern=`으로 온디맨드 재크롤링. 스캔 대상은 `data/sectors-v3.js`를 GAS가 fetch해서 재사용(별도 종목 리스트 하드코딩 없음) |
| `js/watchlist.js`, `css/watchlist.css` | 관심종목 카드 위젯. localStorage(최대 50개, 종목명 자동완성으로 추가) - 신규 GAS 엔드포인트 없이 기존 `?codes=` 시세 API 재사용 |
| `js/market-temp.js`, `css/market-temp.css` | 오늘의 증시온도(VIX25+수급30+상승비율25+거래대금20=100점). VIX는 Yahoo Finance(`query1.finance.yahoo.com`, 네이버엔 없음), 수급은 KODEX200(069500) 대리지표, 상승비율/거래대금은 섹터 종목풀 재사용. GAS `?marketTemp=1` |
| `js/short-pressure.js`, `css/short-pressure.css` | **구 공매도 압박 위젯(네이버/KRX 기반) - 폐기 예정, 코드만 유지.** KRX·네이버 경로 모두 막혀 있었음(무료 소스 없음). `js/foreign-flow.js`의 병합 섹션(키움 API 기반)이 이 기능을 대체함 — 티스토리에 이 위젯을 단독 페이지로 임베드해뒀다면 수동으로 정리 필요(어느 페이지인지 이 저장소에서 확인 불가, skin.html이 gitignore 대상). |
| `js/pension-fund.js`, `css/pension-fund.css` | **구 연기금 위젯(기관 합산 추정치) - 폐기 예정, 코드만 유지.** 연기금 단독 데이터가 없어 기관 합산으로 대체했던 버전. `js/foreign-flow.js`의 병합 섹션이 키움 API의 진짜 연기금(`penfnd_etc`) 데이터로 이 기능을 대체함 — 단독 페이지로 임베드해뒀다면 수동 정리 필요. |
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
- **KRX 내부 크롤링 경로(`data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`, OTP+CSV 다운로드 경로 `generate.cmd` 포함)는 2026-07-11부로 완전 차단.** 세션 쿠키를 붙여도, OTP 발급을 시도해도 "LOGOUT"으로 거부됨(실측 확인됨). KRX 정식 Open API(`openapi.krx.co.kr`)에도 공매도·투자자별 매매동향 서비스 자체가 없음 — **새 KRX 직접 크롤링 코드를 다시 추가하지 말 것.**
- **공매도/대차거래/연기금은 KRX 대신 증권사(키움) 정식 REST API로 우회한다.** `scripts/fetch_investor_flow.py` 참고. 이 데이터는 사용자 개인 계좌의 API 키가 필요해 GAS 같은 공개 서버에 둘 수 없고, 앱키가 IP 등록 방식이라 GitHub Actions 같은 유동 IP 클라우드도 못 씀 — 그래서 PC 로컬 실행 + git push 구조. 오픈API 이용약관(재배포/제3자 제공 제한 여부)은 미확인 상태로 진행 중임을 인지할 것.
