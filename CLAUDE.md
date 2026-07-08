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
| `data/marketcap-codes.js`, `js/marketcap-bubble.js`, `css/marketcap-bubble.css` | 시가총액 버블차트(코스피20/코스닥15/ETF10 + 삼성전자·SK하이닉스 단일종목레버리지 합산). GAS `?bubble=1` 액션을 45초 간격 폴링 |
| `gas/ticker-proxy.gs` | GAS 프록시 소스(시세·뉴스·AI요약·버블차트). 수정 시 script.google.com에서 수동 재배포 필요 — push만으로는 반영 안 됨. 버블차트 종목 구성 변경 시 `data/marketcap-codes.js`와 이 파일의 `MARKETCAP_CODES` 둘 다 수정 |
| `test/*.html` | 로컬 프리뷰(python -m http.server로 열기) |
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
