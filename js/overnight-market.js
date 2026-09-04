/**
 * 글로벌 시장지표(코스피/코스닥, 미국 현물지수 3종·선물 3종, 필라델피아 반도체지수, VIX,
 * WTI 원유·금 선물, 원달러 환율, 국채 금리(한국 3년/미국 10·2·30년), BTC) 카드 - 카테고리별로
 * 묶어서 표시. (2026-07-18: "전체 종합지수"에서 "글로벌 시장지표"로 재개칭, 파일명/URL 유지)
 *
 * 2026-07-15: TradingView 임베드 위젯을 완전히 걷어내고 자체 구현으로 교체.
 * TradingView 무료 위젯은 CME/NYMEX 연결선물·지수 심볼이 데이터 라이선스로 계속 막혀서
 * (KRX야간선물은 대체 심볼조차 없었음) 안정적으로 쓸 수 없었음 - 자세한 경위는 git log 참고.
 *
 * 2026-07-16: 사용자 요청으로 다우존스 선물(DOW) 추가 + 미니차트를 단색 영역차트에서
 * 베이스라인 차트(구간 시작가 기준 위/아래 자동 채색)로 변경 + 종합 보조지수 요약 문구 추가.
 *
 * 2026-07-16(2차): "간밤 시황"에서 "보조지수"로 개편(파일명은 유지 - URL이 티스토리 HTML에
 * 박제돼 있어 CLAUDE.md 규칙상 변경 불가). 코스피200 야간선물 카드는 별도 페이지
 * (js/kospi-futures.js)로 분리하며 여기서 제거하고, 대신 원/달러 환율 카드를 추가했다.
 * 규칙기반 요약(buildSummaryText)은 그대로 두고 그 아래에 GAS ?action=subIndexAnalysis(Groq)가
 * 만든 AI 해설 문단을 비동기로 붙였다. AI 해설은 30초 데이터 리프레시와 무관하게 페이지 진입 시
 * 1회만 불러온다(Groq 호출량 절약, GAS 쪽도 30분 캐시).
 *
 * 2026-07-16(3차): 사용자 요청으로 "선물만 있고 현물지수가 없다"는 지적을 반영해 미국
 * 현물지수 3종(나스닥종합/S&P500/다우존스)과 BTC를 추가 - 관심지수 리본(js/quick-indices.js)에
 * 있는 항목 중 코스피 계열을 뺀 전부가 이 페이지에도 나오도록 맞췄다. 이때 종합 요약
 * (buildSummaryText)이 VM 원본 응답(코스피200 주간/야간선물 등 이 페이지에 안 쓰는 심볼까지
 * 포함)을 그대로 세고 있던 버그도 같이 고쳤다 - "N개 중" 카운트가 화면 카드 수보다 많게
 * 나오던 원인. refresh()에서 SYMBOL_ORDER로 필터링한 배열만 renderAll에 넘기도록 수정.
 *
 * 2026-07-18(4차): "보조지수"->"전체 종합지수"로 개편(표시 텍스트만, 파일명/URL 유지).
 * - BTC를 GAS(?market=1, 이력 없음)에서 VM(/futures)로 전환 - scripts/cloud-vm/btc_futures.py가
 *   2026-07-17부터 업비트를 서버사이드로 수집해 SQLite에 이력까지 쌓고 있어서, 다른 심볼과
 *   동일하게 /futures 하나로 통일 가능해짐(BTC 카드만 미니차트가 안 뜨던 문제가 이걸로 해결됨).
 *   fetchBtc()/GAS 머지 로직은 전부 제거.
 * - 코스피/코스닥/금선물을 카드에 추가 - 셋 다 VM /futures 응답에는 이미 있었는데
 *   (domestic_futures.py/foreign_futures.py, 관심지수 리본이 이미 씀) 이 페이지의
 *   SYMBOL_ORDER/LABELS에서만 빠져 있었음.
 * - 국고채 3년물 금리를 신규 추가(scripts/cloud-vm/bond_yield.py, 네이버 marketindex 일별시세
 *   HTML 스크래핑 - JSON API가 없는 지표라 다른 심볼과 소스 형태가 다름).
 * - "11개 중 4개 상승"처럼 단순 상승/하락 개수만 세면 환율·VIX·채권처럼 "오르면 오히려
 *   나쁜" 지표가 섞여 오해를 줄 수 있어(사용자 지적), CATEGORIES에 각 지표의 direction
 *   (1=상승이 호재, -1=상승이 악재, 0=방향성 해석 없음)을 매겨 카테고리별로 나눠 보여주고,
 *   종합 톤도 방향을 반영해 계산하도록 buildSummaryText를 전면 재작성.
 *
 * 데이터 소스:
 * - 나스닥종합/S&P500/다우존스(현물), 나스닥100/S&P500/다우(선물), SOX, VIX, WTI, 금선물,
 *   코스피/코스닥, 원/달러 환율, BTC: 전부 VM(scripts/cloud-vm/foreign_futures.py,
 *   domestic_futures.py, btc_futures.py)이 상시 수집해 SQLite에 저장 - 이 위젯은 VM의
 *   /futures 엔드포인트 하나만 호출한다(방문자 브라우저가 각 소스를 직접 호출하지 않음 -
 *   CORS/레이트리밋 문제 회피).
 * - 국고채 3년물 금리: VM(scripts/cloud-vm/bond_yield.py)이 네이버 marketindex 일별시세
 *   페이지를 스크래핑(하루 1번 갱신되는 채권 종가라 갱신 주기가 다른 심볼보다 느림) - 마찬가지로
 *   /futures 하나로 합쳐져서 나온다.
 * AI 해설은 GAS(gas/ticker-proxy.gs의 getSubIndexAnalysis)가 같은 VM /futures 응답 + BTC를
 * 프롬프트에 그대로 넣어 생성 - 화면 숫자와 AI 문장이 어긋나지 않도록 소스를 통일.
 *
 * 미니차트는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드, js/foreign-flow.js와
 * 동일 라이브러리)로 직접 그린다 - 축/라벨/크로스헤어/줌 전부 끈 순수 스파크라인.
 *
 * 2026-07-18(5차): 모든 미니차트에 기준선(구간 시작가, 회색 점선) 추가 - 베이스라인
 * 시리즈가 위/아래 색은 자동으로 나누지만 그 경계를 나타내는 선 자체는 없어서 "기준선이
 * 안 보인다"는 지적을 반영(series.createPriceLine()). WTI 카드에는 "최근 1년 평균"
 * 참고선(주황 실선)을 하나 더 추가 - "적정 유가 기준을 보여달라, 전쟁 나면 오르지 않냐"는
 * 요청에 대해, 객관적으로 정해진 적정가는 없어서 대신 실측 장기 평균을 참고선으로 제공한다
 * (VM main.py의 /futures/avg?symbol=&days= - 페이지 진입 시 심볼별 1회만 호출, AI 해설과
 * 동일 패턴).
 *
 * 2026-07-18(6차): 사용자 요청으로 두 가지 추가.
 * - VIX/환율을 "변동성·환율" 카테고리로 합쳐 한 줄에 나란히 표시(각자 카테고리였을 때 카드가
 *   1개씩이라 한 줄에 하나만 놓여 어색했음) - buildSummaryText는 listIndividually 플래그로
 *   여전히 심볼별로 따로 풀어 씀(둘을 뭉뚱그리면 등락폭 규모 차이 때문에 정보가 사라짐).
 * - 장기평균 참고선(원래 WTI 전용)을 VIX/환율/채권까지 확장(fetchWtiBenchmark ->
 *   fetchBenchmark(symbol), BENCHMARK_SYMBOLS/BENCHMARK_NOTE로 일반화) - "채권 기준선 위로는
 *   주가에 부담" 같은 요청대로 심볼마다 다른 해석 문구를 붙였다.
 * - BTC 미니차트가 다시 안 보이던 버그도 같이 수정 - scripts/cloud-vm/btc_futures.py가 날짜를
 *   업비트 원본 그대로('YYYY-MM-DD', 대시 있음) 저장하고 있어서 다른 심볼('YYYYMMDD', 대시
 *   없음)과 포맷이 달랐고, toLwcTime()이 대시 없는 8자리를 가정하고 슬라이스해서 날짜가
 *   깨졌던 게 원인(2026-07-17에 GAS->VM 전환할 때 날짜 포맷 통일을 놓쳤음) - VM 쪽에서
 *   대시를 떼도록 수정.
 *
 * 2026-07-18(7차): 미국 국채 10/2/30년물 추가(사용자가 채권 중요도 순위표를 제시하며 요청).
 * 데이터 소스는 FRED(세인트루이스 연준 공식 CSV, API 키 불필요, scripts/cloud-vm/bond_yield.py
 * fetch_fred_series) - 한국 국고채 10년물은 무료 일별 소스를 못 찾아(OECD 월간 데이터만
 * 있음, 다른 채권 카드와 갱신 주기가 안 맞음) 사용자와 상의 후 보류함. "채권" 카테고리를
 * listIndividually:true로 바꿔 4개 만기를 각각 풀어 쓰게 함(평균 내면 만기별 의미가 사라짐).
 *
 * 2026-07-18(8차): 사용자가 "국고채 참고선이 3개월 평균이라 너무 짧다"고 지적 - 원인은
 * benchmarkCaption의 "개월" 계산이 응답의 실제 rows 개수(거래일 기준, 달력월보다 적음)를
 * 30으로 나누기만 해서 실제 달력 기간을 과소평가하고 있었던 것 + KTB3Y 자체가
 * bond_yield.py에서 90일치만 수집하고 있었던 것 두 가지 복합 원인. (1) bond_yield.py의
 * KTB3Y 수집기간을 400일로 확대(다른 벤치마크 심볼과 맞춤), (2) benchmarkCaption을
 * "개월" 대신 응답의 from/to(실제 달력 날짜 범위)로 계산하도록 수정 - 앞으로 어떤 심볼을
 * 추가해도 거래일 밀도와 무관하게 정확한 기간이 표시된다.
 * BTC에 52주 이동평균선 추가(사용자 요청, 기술적분석에서 흔한 지표) - 업비트 캔들 API가
 * count를 최대 200으로 자르는 제약이 있어(count=365를 줘도 200개만 옴, 실측 확인)
 * btc_futures.py의 fetch_daily_chart를 to= 파라미터로 페이징하도록 재작성해 380일치를
 * 모은다. BENCHMARK_SYMBOLS/BENCHMARK_NOTE에 BTC 추가 - 다른 심볼과 달리 direction:1(상승
 * 자체는 호재)이라 "부담/완화" 대신 통상적인 이동평균선 해석 문구를 붙임.
 *
 * 2026-07-18(9차): 미국 국채 3종에도 장기평균 참고선+해설이 빠져있던 걸 추가(다른 벤치마크
 * 심볼과 동일 패턴, 10년물은 "전세계 주가 밸류에이션에 가장 큰 영향" 문구로 명시). 이더리움
 * (ETH) 추가(사용자 요청) - scripts/cloud-vm/btc_futures.py를 BTC 전용 상수에서
 * CRYPTO_SYMBOLS 리스트로 일반화(foreign_futures.py의 SYMBOLS 패턴과 동일). "가상자산"
 * 카테고리도 listIndividually:true로 바꿔 BTC/ETH를 각각 표시(가격 규모가 크게 달라
 * 평균 내면 의미 없음), 52주 이동평균선도 CRYPTO_SYMBOLS 판정으로 일반화해 ETH까지 적용.
 *
 * 2026-07-18(10차): 채권 4종(미국채 10/2/30년물+국고채3년)의 참고 기간이 13~20개월로
 * 제각각이던 걸 정확히 12개월(52주)로 통일해달라는 요청 - 프론트가 아니라 VM main.py의
 * /futures/avg가 원인이었음(row 개수 기준 LIMIT이라 채권처럼 주5일만 거래되는 심볼과
 * 저장된 총량에 따라 실제 달력 기간이 달라졌음). db_schema.load_future_chart_since로
 * 날짜 기준(date>=cutoff) 필터링으로 바꿔 모든 벤치마크 심볼이 항상 정확히 365일(12개월)
 * 창을 갖도록 수정 - 이 페이지 쪽 코드 변경은 없음(days=365 파라미터는 그대로).
 *
 * 2026-07-21: BTC/ETH 카드에 52주 평균선 옆에 "6개월 평균선"을 추가(사용자 요청 - "비트코인이
 * 6개월 선행한다"는 통설을 봤다며 참고선을 하나 더 요청). VM /futures/avg가 이미 days를
 * 파라미터로 받는 범용 엔드포인트라 백엔드 변경 없이 프론트에서 days=180으로 한 번 더 호출.
 * 52주선(주황 실선)과 겹쳐 안 보이지 않도록 보라 실선으로 구분. "6개월 선행" 주장 자체는
 * 코드 주석이 아니라 사용자에게 채팅으로 별도 팩트체크 결과를 전달함(리서치 결과, 검증된
 * 통계라기보다 업계에서 도는 경험칙에 가까움 - 4년 반감기 주기와 "선행" 서사가 뒤섞여 있고
 * 표본이 반감기 3~4회뿐이라 통계적으로 확정하기 어려움).
 *
 * 2026-08-25: BTC/ETH의 52주 평균선이 차트에서 사라지는 것처럼 보이던 원인을 수정.
 * /futures의 기본 차트는 90일인데 평균선은 365일/180일 범위로 계산되고 있어, 52주 평균이
 * 현재 차트의 세로 범위 밖으로 밀릴 수 있었다. 이 페이지는 365일 차트 데이터를 요청하고,
 * 화면에 쓰는 심볼만 symbols 파라미터로 제한해 평균선과 차트의 기간을 일치시킨다.
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#overnight-market';
  var FUTURES_API = 'https://goodbyestar.cloud/futures';
  var INDICATORS_WS_URL = 'wss://goodbyestar.cloud/ws/market-indicators';
  var FUTURES_AVG_API = 'https://goodbyestar.cloud/futures/avg';
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var FETCH_TIMEOUT_MS = 10000;
  var FUTURES_HISTORY_DAYS = 365;
  // 기존 v1에는 90일 차트가 들어 있으므로, 365일 차트가 섞이지 않도록 캐시 키를 분리한다.
  var FUTURES_CACHE_KEY = 'overnight_market_futures_v2_365d';
  var FUTURES_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
  var lastFuturesUsedCache = false;
  var latestFuturesRequest = null;
  var REFRESH_INTERVAL_MS = 30000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var SPARKLINE_HEIGHT = 64;

  var LABELS = {
    KOSPI: 'KOSPI',
    KOSDAQ: 'KOSDAQ',
    NASDAQ_INDEX: '나스닥 종합지수',
    SP500_INDEX: 'S&P500 지수',
    DOW_INDEX: '다우존스 지수',
    NASDAQ100: '나스닥 100 선물',
    SP500: 'S&P500 선물',
    DOW: '다우 선물',
    SOX: '필라델피아 반도체지수',
    VIX: 'VIX(변동성지수)',
    WTI: 'WTI 원유',
    GOLD: '금 선물',
    USDKRW: '원/달러 환율',
    KTB3Y: '국고채 3년물 금리',
    US10Y: '미국 국채 10년물 금리',
    US2Y: '미국 국채 2년물 금리',
    US30Y: '미국 국채 30년물 금리',
    BTC: '비트코인(BTC)',
    ETH: '이더리움(ETH)'
  };

  // direction: 1=오르면 시장에 호재, -1=오르면 시장에 부담(악재), 0=방향성 해석 없음(그대로 표시만).
  // 카테고리별로 카드를 묶어 보여주고, 종합 요약(buildSummaryText)도 이 방향을 반영해 계산한다 -
  // "환율/VIX/채권은 오른다고 무조건 좋은 게 아니다"라는 사용자 지적을 코드로 명시한 것.
  var CATEGORIES = [
    { key: 'index', label: '시장지수', direction: 1,
      symbols: ['KOSPI', 'KOSDAQ', 'NASDAQ_INDEX', 'SP500_INDEX', 'DOW_INDEX', 'NASDAQ100', 'SP500', 'DOW', 'SOX'] },
    // VIX/환율은 한 카드씩이라 각자 카테고리로 나누면 한 줄에 하나만 놓여 어색해 보인다는
    // 지적(2026-07-18) - 같은 카테고리로 묶어 한 줄에 나란히 표시. listIndividually:true는
    // buildSummaryText가 "2개 중 N개 상승" 집계 대신 심볼별로 따로 풀어 쓰게 하는 표시(둘의
    // 등락폭 규모가 서로 크게 달라 뭉뚱그리면 정보가 사라짐).
    { key: 'volatility_fx', label: '변동성·환율', direction: -1, listIndividually: true, symbols: ['VIX', 'USDKRW'] },
    // 2026-07-18: 미국 국채 10/2/30년물 추가(사용자 요청 - "가장 중요"~"장기 경기 전망"
    // 순으로 나열). 만기별로 등락폭 규모가 다르고(2년물이 통화정책에 더 민감하게 움직임)
    // 평균으로 뭉뚱그리면 의미가 사라져서 listIndividually:true. 한국 국고채 10년물은
    // 무료 일별 데이터 소스를 못 찾아 보류(scripts/cloud-vm/bond_yield.py 상단 주석 참고).
    { key: 'bond', label: '채권', direction: -1, listIndividually: true,
      symbols: ['US10Y', 'US2Y', 'US30Y', 'KTB3Y'] },
    { key: 'energy', label: '에너지·원자재', direction: 0, symbols: ['WTI', 'GOLD'] },
    // 2026-07-18: 이더리움 추가(사용자 요청) - BTC와 가격 규모가 크게 달라(BTC 억 단위 vs
    // ETH 백만 단위) 평균으로 뭉뚱그리면 의미가 없어서 listIndividually:true.
    { key: 'crypto', label: '가상자산', direction: 1, listIndividually: true, symbols: ['BTC', 'ETH'] }
  ];
  var SYMBOL_ORDER = CATEGORIES.reduce(function (acc, cat) { return acc.concat(cat.symbols); }, []);
  var CRYPTO_SYMBOLS = ['BTC', 'ETH']; // benchmarkCaption의 원화 단위/52주 표기 분기에 재사용

  // 카드 표시 단위/소수점 - 지정 없으면 digits:2, unit:''(가격 그대로). 채권 카테고리는
  // 전부 금리(%)라 CATEGORIES에서 심볼을 뽑아 한 번에 채운다(심볼 추가할 때 이중 관리 방지).
  var SYMBOL_META = { BTC: { digits: 0 }, ETH: { digits: 0 } };
  CATEGORIES.filter(function (c) { return c.key === 'bond'; }).forEach(function (c) {
    c.symbols.forEach(function (s) { SYMBOL_META[s] = { digits: 2, unit: '%', changeUnit: '%p' }; });
  });
  function symbolMeta(symbol) {
    var m = SYMBOL_META[symbol] || {};
    return { digits: m.digits == null ? 2 : m.digits, unit: m.unit || '', changeUnit: m.changeUnit || m.unit || '' };
  }

  var lwcLoadPromise = null;
  var chartInstances = {}; // symbol -> { chart, series }
  var themeObserver = null;
  var refreshTimer = null;
  var indicatorsSocket = null;
  var indicatorsReconnectTimer = null;
  var indicatorsStaleTimer = null;
  var indicatorsReconnectDelay = 1500;
  var indicatorsGeneration = 0;
  var indicatorsContainer = null;
  var missingDataTimer = null;
  var MISSING_DATA_GRACE_MS = 15000;
  var currentItems = [];
  // "이 선 위로 오르면 시장에 부담"이라는 해석이 뚜렷한 지표 + BTC(52주 이동평균선, 통상적인
  // 기술적분석 지표)에 장기평균 참고선을 붙인다. 시장지수류는 방향성이 뚜렷하지 않거나
  // (에너지) 이미 상승=호재로 직관적이라 생략하고, GOLD는 별도 해석 코멘트를 함께 제공한다.
  var BENCHMARK_SYMBOLS = ['WTI', 'VIX', 'USDKRW', 'GOLD', 'KTB3Y', 'US10Y', 'US2Y', 'US30Y', 'BTC', 'ETH'];
  // 2026-07-21: BTC/ETH 카드에만 6개월 평균선을 추가로 그린다(52주선과 별도 색으로 구분).
  var BENCHMARK_6M_SYMBOLS = CRYPTO_SYMBOLS;
  var BENCHMARK_6M_DAYS = 180;
  var BENCHMARK_52W_COLOR = '#c9701f';
  var BENCHMARK_6M_COLOR = '#8b5fbf';
  var BENCHMARK_NOTE = {
    GOLD: '금값 상승은 달러 약세·금리 하락 또는 안전자산 선호가 반영된 신호일 수 있습니다. 금값만으로 달러 강세/약세를 단정하지 말고 원/달러 환율과 미 국채금리를 함께 확인하세요',
    WTI: '전쟁 등 지정학적 충격 시 이 선 위로 급등하는 경향이 있습니다',
    VIX: '이 선 위로 오르면 시장 불안(위험회피) 심리가 커지고 있다는 뜻입니다',
    USDKRW: '이 선 위로 오르면(원화 약세) 외국인 자금 이탈 우려로 증시에 부담입니다',
    KTB3Y: '이 선 위로 오르면(금리 상승) 긴축 부담으로 증시에 부담입니다',
    // 2026-07-18: 사용자 지적("국고채보단 미국 10년물이 주가랑 가장 연관 있지 않냐") 반영 -
    // 전세계 주식 밸류에이션에 가장 큰 영향을 미치는 지표라는 점을 명시.
    US10Y: '전세계 주가 밸류에이션에 가장 큰 영향을 미치는 지표 - 이 선 위로 오르면(금리 상승) 특히 성장주 중심으로 증시에 부담입니다',
    US2Y: '연준 통화정책 기대를 가장 민감하게 반영 - 이 선 위로 오르면 긴축 장기화 우려로 증시에 부담입니다',
    US30Y: '장기 성장·인플레이션 기대를 반영 - 이 선 위로 오르면 장기 자금조달 비용 상승 우려로 증시에 부담입니다',
    BTC: '이동평균선 위는 상승 추세, 아래는 하락 추세로 보는 게 일반적입니다',
    ETH: '이동평균선 위는 상승 추세, 아래는 하락 추세로 보는 게 일반적입니다'
  };
  var benchmarks = {}; // symbol -> { avg, min, max, days } - fetchBenchmark() 참고
  var benchmarks6m = {}; // symbol -> { avg, min, max, days } (BENCHMARK_6M_SYMBOLS 전용, days=180)

  function loadLightweightCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcLoadPromise) return lwcLoadPromise;
    lwcLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LWC_CDN;
      s.onload = function () { resolve(global.LightweightCharts); };
      s.onerror = function () { lwcLoadPromise = null; reject(new Error('차트 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return lwcLoadPromise;
  }

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function futuresRequestUrl() {
    // 화면에 쓰지 않는 KOSPI200 선물까지 내려받지 않아 365일로 늘어난 응답량을 최소화한다.
    return FUTURES_API + '?days=' + FUTURES_HISTORY_DAYS
      + '&symbols=' + encodeURIComponent(SYMBOL_ORDER.join(','));
  }

  function fetchFutures(forceFresh) {
    var cached = readFuturesCache();
    lastFuturesUsedCache = !!(cached && !forceFresh);
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    var request = fetch(futuresRequestUrl(), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('futures API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        var items = json.data || [];
        writeFuturesCache(items);
        return items;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
    latestFuturesRequest = request;
    if (cached && !forceFresh) {
      request.catch(function () {});
      return Promise.resolve(cached);
    }
    return request;
  }

  function fetchFuturesFresh() {
    return latestFuturesRequest || fetchFutures(true);
  }

  function readFuturesCache() {
    try {
      var cached = JSON.parse(localStorage.getItem(FUTURES_CACHE_KEY) || 'null');
      if (!cached || !Array.isArray(cached.data) || Date.now() - Number(cached.savedAt) > FUTURES_CACHE_MAX_AGE_MS) return null;
      return cached.data;
    } catch (error) { return null; }
  }

  function writeFuturesCache(data) {
    try { localStorage.setItem(FUTURES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: data })); }
    catch (error) { /* 캐시 저장 실패 시 현재 응답만 사용한다. */ }
  }

  // "장기평균 참고선"(WTI에서 시작: "적정 유가 기준을 보여달라, 전쟁 나면 오르잖아" ->
  // VIX/환율/채권으로 확장). 객관적인 "적정 수준"은 없어서 대신 실제 수집된 값의 장기 평균을
  // 참고용으로 보여준다. 페이지 진입 시 심볼별로 1회만 호출(AI 해설과 동일 패턴).
  function fetchBenchmark(symbol, days) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(FUTURES_AVG_API + '?symbol=' + symbol + '&days=' + (days || 365), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('futures/avg API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fmtPrice(v, digits) {
    if (v == null || isNaN(v)) return '-';
    if (digits == null) digits = 2;
    return v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtSigned(v, digits) {
    if (v == null || isNaN(v)) return '-';
    var s = v.toFixed(digits == null ? 2 : digits);
    return (v > 0 ? '+' : '') + s;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildShell() {
    var groups = CATEGORIES.map(function (cat) {
      var hint = cat.direction === -1
        ? '<div class="om-cat-hint">상승 = 시장에 부담 요인</div>'
        : cat.direction === 0 ? '<div class="om-cat-hint">방향성 해석 없음(수치만 참고)</div>' : '';
      var cards = cat.symbols.map(function (symbol) {
        return ''
          + '<div class="om-card" data-symbol="' + symbol + '">'
          + '<div class="om-title">' + escapeHtml(LABELS[symbol]) + '</div>'
          + '<div class="om-body om-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>불러오는 중...</div>'
          + '</div>';
      }).join('');
      return '<div class="om-category">'
        + '<div class="om-cat-head"><span class="om-cat-label">' + escapeHtml(cat.label) + '</span>' + hint + '</div>'
        + '<div class="om-grid">' + cards + '</div>'
        + '</div>';
    }).join('');
    return '<div class="om-live-status" data-om-connection>REST 확인 중</div>'
      + '<div class="om-summary" id="omSummary" hidden></div>'
      + '<div class="om-ai" id="omAi" hidden></div>'
      + groups;
  }

  function buildCardBody(item) {
    var isLoading = !!(item && item._loading);
    var hasPrice = typeof item.price === 'number';
    var tone = item.change_rate > 0 ? 'om-pos' : item.change_rate < 0 ? 'om-neg' : 'om-zero';
    var arrow = item.change_rate > 0 ? '▲' : item.change_rate < 0 ? '▼' : '-';
    var meta = symbolMeta(item.symbol);
    var rangeLabel = item.high_low_scope === 'chart_range' ? '기간 고가' : '고가';
    var lowLabel = item.high_low_scope === 'chart_range' ? '기간 저가' : '저가';

    return ''
      + '<div class="om-body' + (isLoading ? ' om-loading' : '') + '">'
      + '<div class="om-price ' + tone + '">' + (isLoading ? '확인 중...' : (hasPrice ? fmtPrice(item.price, meta.digits) + meta.unit : '데이터 없음')) + '</div>'
      + (hasPrice
        ? '<div class="om-change ' + tone + '">' + arrow + ' ' + fmtSigned(item.change, meta.digits) + meta.changeUnit + ' (' + fmtSigned(item.change_rate, 2) + '%)</div>'
        : '')
      + '<div class="om-chart" data-symbol="' + escapeHtml(item.symbol) + '"></div>'
      + '<div class="om-hl">'
      + '<span>' + rangeLabel + ' ' + (item.high != null ? fmtPrice(item.high, meta.digits) + meta.unit : '-') + '</span>'
      + '<span>' + lowLabel + ' ' + (item.low != null ? fmtPrice(item.low, meta.digits) + meta.unit : '-') + '</span>'
      + '</div>'
      + benchmarkCaption(item.symbol)
      + '</div>';
  }

  // b.days(응답에 실린 rows 개수)는 거래일 기준이라 30으로 나누면 달력상 실제 기간보다
  // 짧게 나온다(예: 채권 시장이 평일에만 열려 400일 요청해도 rows는 그보다 적게 옴) - 응답의
  // from/to(실제 달력 날짜)로 계산해야 정확하다(2026-07-18, 국고채 참고선이 "3개월"로
  // 표시돼 사용자가 지적하면서 발견).
  function monthsBetween(fromStr, toStr) {
    if (!fromStr || !toStr) return 1;
    var f = new Date(+fromStr.slice(0, 4), +fromStr.slice(4, 6) - 1, +fromStr.slice(6, 8));
    var t = new Date(+toStr.slice(0, 4), +toStr.slice(4, 6) - 1, +toStr.slice(6, 8));
    return Math.max(1, Math.round((t - f) / 86400000 / 30));
  }

  function benchmarkCaption(symbol) {
    var b = benchmarks[symbol];
    var out = '';
    if (BENCHMARK_SYMBOLS.indexOf(symbol) !== -1 && b) {
      var meta = symbolMeta(symbol);
      var isCrypto = CRYPTO_SYMBOLS.indexOf(symbol) !== -1;
      var valueStr = symbol === 'WTI' ? '$' + fmtPrice(b.avg, meta.digits)
        : (symbol === 'USDKRW' || isCrypto) ? fmtPrice(b.avg, meta.digits) + '원'
        : fmtPrice(b.avg, meta.digits) + meta.unit;
      // BTC/ETH는 "52주 이동평균선"이 기술적분석에서 흔히 쓰는 관용적 표현이라 그대로 씀(실제
      // 수집 기간도 380일 ≈ 54주라 근사치로 맞음). 나머지는 실제 달력 기간을 그대로 노출.
      var periodLabel = isCrypto ? '52주' : monthsBetween(b.from, b.to) + '개월';
      out += '<div class="om-benchmark">최근 ' + periodLabel + ' 평균(주황 실선) ' + valueStr + ' — '
        + (BENCHMARK_NOTE[symbol] || '') + '(객관적 "적정 수준"이 아니라 실측 평균 참고선).</div>';
    }
    // 2026-07-21: BTC/ETH 전용 6개월 평균선(보라 실선) - 52주선과 별도 색으로 구분.
    var b6 = benchmarks6m[symbol];
    if (BENCHMARK_6M_SYMBOLS.indexOf(symbol) !== -1 && b6) {
      var meta6 = symbolMeta(symbol);
      var valueStr6 = fmtPrice(b6.avg, meta6.digits) + '원';
      out += '<div class="om-benchmark om-benchmark-6m">최근 6개월 평균(보라 실선) ' + valueStr6
        + ' — 이동평균선 위는 상승 추세, 아래는 하락 추세로 보는 게 일반적입니다(실측 평균 참고선).</div>';
    }
    return out;
  }

  function chartThemeOptions() {
    var dark = isDark();
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(사용자가 나중에 문서 만들 예정, 아직 미작성).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } }
    };
  }

  function destroyChart(symbol) {
    var inst = chartInstances[symbol];
    if (!inst) return;
    try { inst.chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
    delete chartInstances[symbol];
  }

  // 2026-07-16: 단일 색 영역차트 -> 베이스라인 차트로 변경(구간 시작가 기준 위/아래 이중톤).
  // 2026-07-20(11차): 사용자 지적 - 코스피가 당일 -4.46%로 빠졌는데 미니차트는 빨강/파랑이
  // 섞여 보임(기준선이 "차트에 표시된 기간의 첫 종가", 기본 90거래일 전이라 당일 등락 방향과
  // 무관했음). js/quick-indices.js가 2026-07-17(11차)에 똑같은 문제를 겪고 고친 해법을
  // 그대로 이식 - 이중톤 베이스라인 대신 단일 색 영역차트로 되돌리고, 색은 당일 등락 방향
  // (positive), 점선 기준선은 "전일 종가"(price - change)로 통일해서 상단 등락 배지와 항상
  // 일치하게 만든다. 차트 마지막 점도 현재가로 맞춰(일봉 이력이 어제까지만 있으면 오늘 점을
  // 덧붙임) 선의 위/아래가 등락 배지와 어긋나지 않게 한다.
  function renderSparkline(container, symbol, chartRows, positive, price, change) {
    var normalizedRows = normalizeChartRows(chartRows);
    if (normalizedRows.length < 2) return;
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;

      destroyChart(symbol);

      var chart = LWC.createChart(container, Object.assign({
        autoSize: true,
        height: SPARKLINE_HEIGHT,
        handleScroll: false,
        handleScale: false,
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: { visible: false },
        crosshair: {
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false }
        }
      }, chartThemeOptions()));

      var color = positive ? '#d24f45' : '#1261c4';
      var series = chart.addSeries(LWC.AreaSeries, {
        lineColor: color,
        topColor: hexToRgba(color, 0.2),
        bottomColor: hexToRgba(color, 0.02),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      var seriesData = normalizedRows.map(function (r) { return { time: toLwcTime(r.date), value: r.close }; });
      if (typeof price === 'number') {
        var kst = new Date(Date.now() + 9 * 60 * 60000);
        var today = kst.toISOString().slice(0, 10);
        var last = seriesData[seriesData.length - 1];
        if (last.time >= today) last.value = price;
        else seriesData.push({ time: today, value: price });
      }
      series.setData(seriesData);
      chart.timeScale().fitContent();

      // 기준선(전일 종가) - priceLine을 chartInstances에 같이 들고 있어야 다크모드 토글 때
      // 색을 다시 맞출 수 있다.
      var baseValue = (typeof price === 'number' && typeof change === 'number') ? price - change : normalizedRows[0].close;
      var baseLine = series.createPriceLine({
        price: baseValue,
        color: isDark() ? '#666' : '#ccc',
        lineWidth: 1,
        lineStyle: LWC.LineStyle.Dashed,
        axisLabelVisible: false
      });

      // BENCHMARK_SYMBOLS 카드에는 "최근 N개월 평균" 참고선을 추가로 그린다(WTI에서 시작해
      // 사용자 요청으로 VIX/환율/채권까지 확장 - 각각 "이 선 위로 오르면 시장에 부담"이라는
      // 해석이 뚜렷한 지표들). 기준선(dashed, 회색)과 헷갈리지 않도록 실선+주황색으로 구분.
      if (BENCHMARK_SYMBOLS.indexOf(symbol) !== -1 && benchmarks[symbol]) {
        series.createPriceLine({
          price: benchmarks[symbol].avg,
          color: BENCHMARK_52W_COLOR,
          lineWidth: 2,
          lineStyle: LWC.LineStyle.Solid,
          axisLabelVisible: false
        });
      }

      // 2026-07-21: BTC/ETH 카드 전용 6개월 평균선 - 52주선(주황 실선)과 겹쳐도 구분되도록
      // 보라 실선으로 그린다.
      if (BENCHMARK_6M_SYMBOLS.indexOf(symbol) !== -1 && benchmarks6m[symbol]) {
        series.createPriceLine({
          price: benchmarks6m[symbol].avg,
          color: BENCHMARK_6M_COLOR,
          lineWidth: 2,
          lineStyle: LWC.LineStyle.Solid,
          axisLabelVisible: false
        });
      }

      chartInstances[symbol] = { chart: chart, series: series, baseLine: baseLine };
    }).catch(function () {
      container.innerHTML = '<div class="om-chart-error">차트를 불러오지 못했어요.</div>';
    });
  }

  // ---- 글로벌 시장지표 요약(규칙 기반 - AI 호출 없이 클라이언트에서 즉시 계산) ----
  //
  // 단순히 "N개 중 M개 상승"만 세면 환율/VIX/채권처럼 오르는 게 오히려 시장에 부담인 지표가
  // 섞여 오해를 준다(사용자 지적) - 카테고리별로 나눠 보여주고, 종합 톤은 CATEGORIES의
  // direction(1=상승 호재, -1=상승 악재, 0=해석 없음)을 반영한 가중 평균으로 계산한다.

  // 2026-07-21: 카테고리별 문장을 " · "로 이어붙인 한 줄짜리 blob이던 걸 사용자 요청("단락
  // 구분 확실하게")으로 카테고리별 한 줄(paragraph)씩 끊어서 반환하도록 변경 - { label, text }
  // 배열로 돌려주고 렌더링(renderSummary)이 각각 자기 줄에 그린다. 종합 톤 문장도 별도 줄로
  // 분리해서 renderSummary가 맨 아래에 따로 붙인다.
  function buildSummaryText(items) {
    var bySymbol = {};
    items.forEach(function (it) { bySymbol[it.symbol] = it; });

    var lines = [];
    var riskScoreSum = 0, riskCatCount = 0;

    CATEGORIES.forEach(function (cat) {
      var catItems = cat.symbols
        .map(function (s) { return bySymbol[s]; })
        .filter(function (it) { return it && typeof it.change_rate === 'number'; });
      if (!catItems.length) return;

      if (cat.symbols.length > 1 && !cat.listIndividually) {
        var up = catItems.filter(function (it) { return it.change_rate > 0; }).length;
        var down = catItems.filter(function (it) { return it.change_rate < 0; }).length;
        var avg = catItems.reduce(function (s, it) { return s + it.change_rate; }, 0) / catItems.length;
        lines.push({ label: cat.label, text: catItems.length + '개 중 ' + up + '개 상승·' + down + '개 하락(평균 '
          + (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%)' });
        if (cat.direction !== 0) { riskScoreSum += avg * cat.direction; riskCatCount++; }
      } else {
        // 단일 종목 카테고리이거나(환율, 채권 등) listIndividually:true(변동성·환율처럼 묶여
        // 있어도 등락폭 규모가 서로 달라 뭉뚱그리면 안 되는 경우) - 심볼별로 따로 풀어 쓴다.
        var pieces = catItems.map(function (it) {
          var note = cat.direction === -1
            ? (it.change_rate > 0 ? '(부담)' : it.change_rate < 0 ? '(완화)' : '')
            : '';
          return LABELS[it.symbol] + ' ' + (it.change_rate >= 0 ? '+' : '') + it.change_rate.toFixed(2) + '%' + note;
        });
        lines.push({ label: cat.label, text: pieces.join(', ') });
        catItems.forEach(function (it) {
          if (cat.direction !== 0) { riskScoreSum += it.change_rate * cat.direction; riskCatCount++; }
        });
      }
    });

    if (!lines.length) return null;
    var overallAvg = riskCatCount ? riskScoreSum / riskCatCount : 0;
    var tone = overallAvg > 0.3 ? '우호적' : overallAvg < -0.3 ? '부담' : '혼조';
    return {
      lines: lines,
      toneText: '방향성(환율·VIX·채권은 상승=부담)을 반영하면 전반적으로 ' + tone + ' 흐름입니다.'
    };
  }

  // 헤더 라벨 앞에 붙는 간단한 바차트 아이콘 - currentColor라 다크모드에서도 별도 처리 없이
  // 색이 따라간다.
  var OM_SUMMARY_ICON = '<svg class="om-summary-icon" width="15" height="15" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>';

  function renderSummary(container, items) {
    var box = container.querySelector('#omSummary');
    if (!box) return;
    var summary = buildSummaryText(items);
    if (!summary) { box.hidden = true; return; }
    box.hidden = false;
    var linesHtml = summary.lines.map(function (l) {
      return '<div class="om-summary-line"><b>' + escapeHtml(l.label) + '</b> ' + escapeHtml(l.text) + '</div>';
    }).join('');
    box.innerHTML = '<div class="om-summary-head">' + OM_SUMMARY_ICON + '<b>글로벌 시장지표 요약</b></div>'
      + '<div class="om-summary-body">' + linesHtml
      + '<div class="om-summary-tone">' + escapeHtml(summary.toneText) + '</div>'
      + '</div>';
  }

  // ---- 종합 AI 해설(GAS ?action=subIndexAnalysis, Groq) - 페이지 진입 시 1회만 호출 ----

  function fetchAiSummary() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?action=subIndexAnalysis', hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data && data.analysis;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // 말풍선 아이콘 - om-summary-icon과 같은 톤의 SVG로 통일(이모지 💬 대신).
  var OM_AI_ICON = '<svg class="om-ai-icon" width="15" height="15" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // 2026-07-21: Groq가 돌려주는 AI 해설이 문장 여러 개가 붙은 하나의 blob이라 "단락 구분이
  // 안 된다"는 지적(글로벌 시장지표 요약 박스와 동일한 요청) - 문장 종결 부호(.!?) + 공백
  // 기준으로 잘라 문장마다 자기 줄에 그린다.
  // (2차) 처음엔 "3.5%처럼 숫자 뒤 마침표는 공백이 안 따라와 안 걸린다"고 가정했는데 틀렸음 -
  // gas/ticker-proxy.gs의 AI 해설 검증 로직을 실제 응답("26,107.01(+0.59%)"처럼 소수점이 낀
  // 정상 문장)으로 테스트하다가, 옛 정규식이 그 소수점에서 문장을 반토막 내는 걸 발견함(둘이
  // 완전히 같은 정규식을 썼었음). 소수점(숫자 사이의 '.')은 문장 몸통으로 취급하고, 뒤에
  // 공백/끝이 오는 '.'만 진짜 문장 종결로 인정하도록 수정 - GAS 쪽과 동일한 패턴으로 맞춤.
  function splitSentences(text) {
    var matches = text.match(/(?:[^.!?]|\.(?=\d))+[.!?]+(?!\d)(?:\s+|$)/g);
    if (!matches) return [text.trim()];
    return matches.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function renderAiSummary(container) {
    var box = container.querySelector('#omAi');
    if (!box) return;
    OvernightMarket.fetchAiSummary()
      .then(function (text) {
        if (!text) { box.hidden = true; return; }
        box.hidden = false;
        var linesHtml = splitSentences(text).map(function (line) {
          return '<div class="om-ai-line">' + escapeHtml(line) + '</div>';
        }).join('');
        box.innerHTML = '<div class="om-ai-head">' + OM_AI_ICON + '<b>참고의견</b></div>'
          + '<div class="om-ai-body">' + linesHtml + '</div>';
      })
      .catch(function () { box.hidden = true; });
  }

  // 백엔드(KIS stck_bsop_date, 네이버 localDate)는 'YYYYMMDD'를 주고, 과거 BTC DB에는
  // 일부 'YYYY-MM-DD' 행이 남아 있어 두 포맷이 섞일 수 있다. 차트 입력 전 항상 대시를
  // 제거해 한 포맷으로 통일한다.
  function normalizeChartRows(rows) {
    var byDate = {};
    (rows || []).forEach(function (row) {
      var date = String(row && row.date || '').replace(/-/g, '').slice(0, 8);
      if (!/^\d{8}$/.test(date) || !row || row.close == null) return;
      // 같은 날짜의 구형/신형 행이 동시에 있으면 이미 정규화된 행을 우선한다.
      if (!byDate[date] || String(row.date) === date) {
        byDate[date] = { date: date, close: Number(row.close) };
      }
    });
    return Object.keys(byDate).sort().map(function (date) { return byDate[date]; });
  }

  // Lightweight Charts는 business day 문자열로 'YYYY-MM-DD'(대시 포함)를 요구한다.
  function toLwcTime(yyyymmdd) {
    var date = String(yyyymmdd).replace(/-/g, '');
    return date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8);
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* 아직 값이 안 온 심볼은 '데이터 없음'이 아니라 '확인 중...'으로 둔다.
     유예시간이 지나도 안 오면 그때 '데이터 없음'으로 내린다.

     2026-09-04 사용자 스크린샷(글로벌 시장지표): 다우존스 지수는 값이 있는데
     나스닥100/S&P500/다우 선물만 "데이터 없음"이었다. 아래 WebSocket 수신 처리가
     REST 응답이 도착하기 전에 SYMBOL_ORDER 전체를 그리면서, 그 패킷에 안 들어 있는
     심볼을 전부 빈 값으로 덮어버린 것이다(REST 경로에는 이미 유예가 있었는데 WS
     경로만 빠져 있었다). /futures는 큰 요청이라(days=365, 비압축 1.36MB) 응답이
     WebSocket 첫 패킷보다 늦게 오는 게 정상이다. */
  function withLoadingPlaceholders(bySymbol) {
    return SYMBOL_ORDER.map(function (symbol) {
      return bySymbol[symbol] || { symbol: symbol, _loading: true };
    });
  }

  function scheduleMissingDataDemotion(container) {
    var hasMissing = currentItems.some(function (item) { return item && item._loading; });
    if (!hasMissing || missingDataTimer) return;
    missingDataTimer = setTimeout(function () {
      missingDataTimer = null;
      renderAll(container, currentItems.map(function (item) {
        return item && item._loading ? { symbol: item.symbol } : item;
      }));
    }, MISSING_DATA_GRACE_MS);
  }

  function renderAll(container, items) {
    currentItems = items || [];
    var bySymbol = {};
    items.forEach(function (item) { bySymbol[item.symbol] = item; });

    renderSummary(container, items);

    SYMBOL_ORDER.forEach(function (symbol) {
      var card = container.querySelector('.om-card[data-symbol="' + symbol + '"]');
      if (!card) return;
      var item = bySymbol[symbol] || { symbol: symbol };
      card.querySelector('.om-body').outerHTML = buildCardBody(item);
      var chartContainer = card.querySelector('.om-chart');
      if (chartContainer) renderSparkline(chartContainer, symbol, item.chart, item.change_rate >= 0, item.price, item.change);
    });
  }

  // VM(/futures, BTC 포함)을 SYMBOL_ORDER로 필터링해 renderAll에 넘긴다. 이 필터링이 없으면
  // renderSummary가 VM 원본 응답의 심볼(코스피200 주간/야간선물 등 이 페이지에 안 쓰는
  // 것들까지)을 전부 세어버리는 문제가 생긴다 - 과거 실제 발생한 버그.
  function refresh(container) {
    OvernightMarket.fetchFutures()
      .then(function (futuresItems) {
        var bySymbol = {};
        futuresItems.forEach(function (it) { bySymbol[it.symbol] = it; });
        renderAll(container, withLoadingPlaceholders(bySymbol));
        // 일부 지표가 뒤늦게 도착하는 짧은 구간에는 '데이터 없음'으로 단정하지 않는다.
        scheduleMissingDataDemotion(container);

        // 캐시를 먼저 그린 경우에도 최신 REST 응답이 도착하면 즉시 화면을 갱신한다.
        if (lastFuturesUsedCache) {
          OvernightMarket.fetchFuturesFresh().then(function (freshItems) {
            var freshBySymbol = {};
            freshItems.forEach(function (it) { freshBySymbol[it.symbol] = it; });
            renderAll(container, withLoadingPlaceholders(freshBySymbol));
            scheduleMissingDataDemotion(container);
          }).catch(function () { /* 캐시 화면은 그대로 유지한다. */ });
        }
      })
      .catch(function () {
        SYMBOL_ORDER.forEach(function (symbol) {
          var card = container.querySelector('.om-card[data-symbol="' + symbol + '"]');
          if (!card) return;
          var body = card.querySelector('.om-body');
          if (body && body.classList.contains('om-loading')) {
            body.outerHTML = '<div class="om-body om-error">시세를 불러오지 못했어요.</div>';
          }
        });
      });
  }

  var LIVE_STATUS_STATE = { '실시간': 'live', '지연': 'stale', '연결 재시도': 'retry' };

  function setIndicatorStatus(text) {
    if (!indicatorsContainer) return;
    var node = indicatorsContainer.querySelector('[data-om-connection]');
    if (!node) return;
    node.textContent = text;
    node.setAttribute('data-state', LIVE_STATUS_STATE[text] || 'init');
  }

  function scheduleIndicatorReconnect() {
    if (document.hidden || indicatorsReconnectTimer) return;
    var delay = indicatorsReconnectDelay;
    indicatorsReconnectDelay = Math.min(30000, Math.round(indicatorsReconnectDelay * 1.8));
    indicatorsReconnectTimer = setTimeout(function () {
      indicatorsReconnectTimer = null;
      connectIndicatorSocket();
    }, delay);
  }

  function closeIndicatorSocket(reconnect) {
    indicatorsGeneration += 1;
    if (indicatorsReconnectTimer) clearTimeout(indicatorsReconnectTimer);
    if (indicatorsStaleTimer) clearTimeout(indicatorsStaleTimer);
    indicatorsReconnectTimer = null;
    indicatorsStaleTimer = null;
    var socket = indicatorsSocket;
    indicatorsSocket = null;
    if (socket) { try { socket.close(); } catch (error) {} }
    if (reconnect) scheduleIndicatorReconnect();
  }

  function connectIndicatorSocket() {
    if (document.hidden || indicatorsSocket || !global.WebSocket) return;
    var generation = indicatorsGeneration;
    setIndicatorStatus('연결 재시도');
    try {
      indicatorsSocket = new WebSocket(INDICATORS_WS_URL + '?symbols=' + encodeURIComponent(SYMBOL_ORDER.join(',')));
    } catch (error) {
      indicatorsSocket = null;
      scheduleIndicatorReconnect();
      return;
    }
    indicatorsSocket.onopen = function () {
      if (generation !== indicatorsGeneration) return;
      indicatorsReconnectDelay = 1500;
      setIndicatorStatus('실시간');
    };
    indicatorsSocket.onmessage = function (event) {
      if (generation !== indicatorsGeneration) return;
      var packet;
      try { packet = JSON.parse(event.data); } catch (error) { return; }
      if (!packet || packet.type !== 'market-indicators' || !Array.isArray(packet.data)) return;
      var bySymbol = {};
      currentItems.forEach(function (item) { bySymbol[item.symbol] = item; });
      packet.data.forEach(function (quote) {
        if (!quote || !quote.symbol) return;
        bySymbol[quote.symbol] = Object.assign({}, bySymbol[quote.symbol] || { symbol: quote.symbol }, quote);
      });
      renderAll(indicatorsContainer, withLoadingPlaceholders(bySymbol));
      scheduleMissingDataDemotion(indicatorsContainer);
      setIndicatorStatus('실시간');
      if (indicatorsStaleTimer) clearTimeout(indicatorsStaleTimer);
      indicatorsStaleTimer = setTimeout(function () { setIndicatorStatus('지연'); }, 20000);
    };
    indicatorsSocket.onerror = function () { setIndicatorStatus('연결 재시도'); };
    indicatorsSocket.onclose = function () {
      if (generation !== indicatorsGeneration) return;
      indicatorsSocket = null;
      setIndicatorStatus('연결 재시도');
      scheduleIndicatorReconnect();
    };
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    indicatorsContainer = container;
    refresh(container);
    connectIndicatorSocket();
    renderAiSummary(container);

    // 장기평균 참고선 데이터는 페이지 진입 시 심볼별로 1회만 불러온다(AI 해설과 동일한 이유 -
    // 30초마다 다시 부를 필요 없는 장기 통계). 전부 도착하면 해당 카드들이 참고선 포함해서
    // 다시 그려지도록 한 번 더 refresh - 이미 렌더된 다른 카드도 같이 다시 그려지지만 데이터는
    // 캐시돼 있어 사실상 즉시 끝난다(추가 fetchFutures 호출은 있음, 허용 가능한 비용).
    var loadBenchmarks = function () {
      var benchmarkFetches = BENCHMARK_SYMBOLS.map(function (symbol) {
        return OvernightMarket.fetchBenchmark(symbol)
          .then(function (b) { benchmarks[symbol] = b; })
          .catch(function () { /* 참고선 없이도 나머지 카드는 정상 동작해야 함 */ });
      }).concat(BENCHMARK_6M_SYMBOLS.map(function (symbol) {
        return OvernightMarket.fetchBenchmark(symbol, BENCHMARK_6M_DAYS)
          .then(function (b) { benchmarks6m[symbol] = b; })
          .catch(function () { /* 참고선 없이도 나머지 카드는 정상 동작해야 함 */ });
      }));
      Promise.all(benchmarkFetches).then(function () { refresh(container); });
    };
    // 평균선은 보조 정보이므로 시세 카드의 첫 화면을 기다리게 하지 않는다.
    setTimeout(loadBenchmarks, 1200);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { refresh(container); }, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) closeIndicatorSocket(false);
      else { connectIndicatorSocket(); refresh(container); }
    });
    global.addEventListener('beforeunload', function () { closeIndicatorSocket(false); });

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      Object.keys(chartInstances).forEach(function (symbol) {
        var inst = chartInstances[symbol];
        inst.chart.applyOptions(chartThemeOptions());
        if (inst.baseLine) inst.baseLine.applyOptions({ color: isDark() ? '#666' : '#ccc' });
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  var OvernightMarket = {
    init: init,
    fetchFutures: fetchFutures,
    fetchFuturesFresh: fetchFuturesFresh,
    fetchAiSummary: fetchAiSummary,
    fetchBenchmark: fetchBenchmark
  };
  global.OvernightMarket = OvernightMarket;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
