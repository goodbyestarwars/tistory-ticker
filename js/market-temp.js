/**
 * 오늘의 증시온도 위젯 (2026-07-18 전면 개편)
 * GAS 프록시 ?marketTemp=1 호출 -> 기본 지표와 KOFIA 빚투 위험도(10점)를
 * 실제 만점 기준으로 0~40℃로 환산해 온도 카드로 렌더링하는
 * 구조 자체는 유지. 이번 개편은 "정보는 있는데 3초 안에 안 읽힌다"는 피드백에 따라 CNN
 * Fear&Greed Index 스타일의 대표 콘텐츠로 재구성한 것 - 백엔드 계산은 대부분 그대로 두고
 * (gas/ticker-proxy.gs getMarketTemp), 응답에 recentDays(5/10/20/40일 단기흐름용)와 지표별 band
 * (계산식 투명성용) 필드만 추가했다.
 *
 * 섹션 순서: Hero+최근 단기흐름 꼬리 -> 시장 구성요소 그래프 | 시장 레이더 -> 온도 기준표
 * -> 시장 브리핑+오늘의 전략(마지막) -> (기존 유지) 카드보기/히트맵보기/시총비례 탐색.
 * "오늘 시장 영향요인 TOP5"는 시장 구성요소와 내용이 중복이라는 지적(5차)에 따라 별도
 * 섹션을 없애고 구성요소 그래프를 |기여도| 내림차순 정렬하는 것으로 흡수 통합함.
 *
 * 투자시그널/투자전략은 "역발상형"(공포=매수 신호, CNN F&G 지수의 통상적 활용법)으로
 * 매핑 - 사용자 확정. "Data Quality %" 같은 근거 없는 가짜 수치는 넣지 않고 실시간 배지 +
 * 업데이트 시각만 표시하기로 함(사용자 확정). 오늘의 전략 액션 문구는 매수=빨강/매도=파랑
 * (사이트 공통 부호색) - 5차에 등급색에서 이 방식으로 변경.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var SECTOR_CARDS_API_URL = 'https://goodbyestar.cloud/sector-cards';
  var USER_SECTOR_CARDS_API_URL = SECTOR_CARDS_API_URL + '/me';
  var GOOGLE_AUTH_START_URL = 'https://goodbyestar.cloud/auth/google/start';
  var GOOGLE_AUTH_ME_URL = 'https://goodbyestar.cloud/auth/google/me';
  var GOOGLE_AUTH_LOGOUT_URL = 'https://goodbyestar.cloud/auth/google/logout';
  var CONTAINER_SELECTOR = '#market-temp';
  // 2026-07-22: 8000 -> 20000. 캐시 미스 시 GAS가 VIX/미국선물/환율/52주신고저(VM)/전종목
  // 시세 등 9개 지표를 순차로 조회해 8초를 넘기기 일쑤였다 - 이때 클라이언트 fetch는
  // timeout으로 실패해 에러 문구가 뜨지만, GAS 실행 자체는 서버에서 끊김 없이 완료돼
  // 캐시(30분 TTL)를 채워두므로 "새로고침을 한 번 더 하면 뜬다"는 현상으로 나타났다
  // (사용자 실측 재현: "항상 2번 리플레시 해야 뜸"). foreign-flow.js/pension-fund.js 등
  // 여러 소스를 조합하는 다른 무거운 위젯들도 이미 20000을 쓰고 있어 그 값에 맞춤.
  var FETCH_TIMEOUT_MS = 20000;
  var LOCAL_SECTOR_CARDS_KEY = 'market_temp_sector_cards_v1';
  var GAUGE_MAX_TEMP = 40; // 서버가 실제 만점 기준으로 이미 0~40℃로 정규화해서 내려줌
  var sectorConfigPromise = null;
  var HISTORY_PERIODS = [5, 10, 20, 40];
  var DEFAULT_HISTORY_PERIOD = 10;
  var INDUSTRY_FLOW_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=40';
  var INDUSTRY_TOP_LIMIT_ = 10;
  // WICS 세부 업종 원문 대신 투자자가 읽기 쉬운 테마 업종으로 집계한다.
  // 저장 키도 분리해 이전 세부 업종 순위가 새 테마 업종 순위에 섞이지 않게 한다.
  var INDUSTRY_FLOW_STORAGE_KEY = 'market_temp_industry_flow_v2';
  // WICS는 자동차·부품, 반도체·장비, 자본재처럼 투자자가 실제로 보는 테마를
  // 한 덩어리로 묶는다. 아래 규칙은 상위 거래대금 종목에만 적용하는 화면용 테마
  // 태깅이며, 공식 업종 분류를 덮어쓰는 회계·지수 분류가 아니다.
  var INDUSTRY_THEME_CODE_MAP_ = {
    '005930': '반도체', '000660': '반도체', '000990': '반도체',
    '005380': '자동차', '000270': '자동차',
    '034020': '원전', '052690': '원전', '051600': '원전', '032820': '원전',
    '094820': '원전', '083650': '원전', '100090': '원전', '121800': '원전'
  };
  var INDUSTRY_THEME_KEYWORDS_ = [
    { label: '원전', words: ['두산에너빌리티', '한전기술', '한전KPS', '우리기술', '보성파워텍', '비에이치아이', '우진', '일진파워', '오르비텍', '한신기계', '우진엔텍'] },
    { label: '자동차 부품', words: ['현대모비스', '현대위아', 'HL만도', '한온시스템', '에스엘', '서연이화', '화신', '성우하이텍', 'SNT모티브', '모토닉', '대원강업', '명신산업', '한국타이어', '금호타이어', '넥센타이어', '아진산업', '피에이치에이', '서진오토모티브', '두올'] },
    { label: '자동차', words: ['현대차', '기아'] },
    { label: '반도체 소부장', words: ['한미반도체', '테크윙', '원익IPS', '원익아이피에스', '주성엔지니어링', 'HPSP', '이오테크닉스', '유진테크', '피에스케이', '리노공업', '동진쎄미켐', '솔브레인', '후성', '심텍', '대덕전자', 'ISC', '하나마이크론', '두산테스나', '오로스테크놀로지', '에스티아이', '케이씨텍', '티씨케이', '넥스틴', '디아이'] }
  ];
  var INDUSTRY_DISPLAY_MAP_ = {
    '내구소비재와의류': '소비재',
    '기술하드웨어와장비': 'IT하드웨어',
    '자본재': '산업재·장비',
    '자동차와부품': '자동차·부품',
    '미디어와엔터테인먼트': '미디어·엔터',
    '제약과생물공학': '제약·바이오',
    '식품,음료,담배': '음식료',
    '반도체와반도체장비': '반도체',
    '소프트웨어와서비스': '소프트웨어',
    '전자와전기제품': '전자·전기',
    '전기통신서비스': '통신',
    '건강관리장비와서비스': '헬스케어',
    '상업서비스와공급품': '상업서비스',
    '호텔,레스토랑,레저': '여행·레저',
    '가정용품과개인용품': '생활용품',
    '금속과광물': '금속·광물',
    '복합기업': '지주·복합기업',
    '소비자서비스': '소비자서비스',
    '금융서비스': '금융',
    '유틸리티': '유틸리티',
    '부동산': '부동산',
    '건설': '건설',
    '운송': '운송',
    '화학': '화학',
    '에너지': '에너지',
    '은행': '은행',
    '보험': '보험',
    '증권': '증권',
    '디스플레이': '디스플레이',
    '교육서비스': '교육',
    '통신장비': '통신장비'
  };

  // unit: 'index'(그대로 표기) / 'pct'(부호 있는 % - 붉은/파란색) / 'pctDirect'(comp에 이미 %
  // 단위로 들어있는 값) / 'ratio'(상승·하락 종목수) / 'sectorCount'(섹터 강도) /
  // 'week52Count'(52주 신고가/신저가 개수) / 'flow'(외국인+기관 통합 수급 전용 포맷)
  // barClass: css/market-temp.css의 카테고리별 바 색상 클래스
  // icon: 2026-07-18 스펙 지정 아이콘으로 통일(vix/수급/거래대금/신고가/섹터강도/상승비율/
  // 환율/미국선물 8개는 스펙 명시 그대로, avgChange만 스펙에 없어 겹치지 않는 신규 아이콘 배정)
  var COMPONENT_META = [
    { key: 'vix', label: 'VIX', max: 20, unit: 'index', icon: '😨', barClass: 'mt-bar-vix', source: 'Yahoo Finance ^VIX',
      guide: '15 미만=20점 · 15~20=16점 · 20~25=10점 · 25~30=5점 · 30 이상=0점',
      desc: '변동성지수(공포지수). 미국 S&P500 옵션의 내재변동성으로 산출 - 낮을수록 시장이 안정적이라는 뜻' },
    { key: 'flow', label: '수급(외국인+기관)', max: 20, unit: 'flow', icon: '🏦', barClass: 'mt-bar-flow', source: 'KODEX 200 최근 5일 수급',
      guide: '외국인 75% + 기관 25% 가중 순매수강도. 중립은 50%, 이를 20점으로 환산',
      desc: 'KODEX 200 최근 5일 순매수를 20일 평균과 비교, 외국인 75%+기관 25% 가중합산' },
    { key: 'tradingValue', label: '거래대금', max: 15, unit: 'pct', icon: '📊', barClass: 'mt-bar-vol', source: '섹터 풀 실시간 시세',
      guide: '직전 5일 평균 대비 130% 이상=15점 · 110~130%=11점 · 90~110%=7점 · 70~90%=4점 · 70% 미만=0점',
      desc: '섹터 풀 종목 거래대금 합계를 최근 5거래일 평균과 비교(평소보다 활발하면 가점)' },
    { key: 'avgChange', label: '평균등락률', max: 15, unit: 'pctDirect', icon: '💹', barClass: 'mt-bar-rise', source: '섹터 풀 실시간 시세',
      guide: '+2% 이상=15점 · +1~2%=12점 · 0~+1%=8점 · -1~0%=4점 · -1% 미만=0점',
      desc: '섹터 풀 종목 동일가중(시가총액 가중 아님) 평균 등락률 - 일부 대형주만 오르는 상황을 지수보다 잘 잡아냄' },
    { key: 'riseRatio', label: '상승비율', max: 10, unit: 'ratio', icon: '⚡', barClass: 'mt-bar-rise', source: '섹터 풀 실시간 시세',
      guide: '상승 종목 비율 70% 이상=10점 · 55~70%=8점 · 45~55%=5점 · 30~45%=3점 · 30% 미만=0점',
      desc: '섹터 풀(코스피+코스닥 통합) 상승·하락 종목 수 비율' },
    { key: 'sectorStrength', label: '섹터 강도', max: 10, unit: 'sectorCount', icon: '🏭', barClass: 'mt-bar-vol', source: '섹터 분류 + 실시간 시세',
      guide: '각 섹터의 평균등락률>0, 상승비율≥50%를 각각 1점으로 계산해 전체 강세 포인트 비율을 10점으로 환산',
      desc: '각 섹터의 평균등락률·상승비율을 종합 - 강세 섹터가 많을수록 가점' },
    { key: 'week52', label: '52주 신고가/신저가', max: 10, unit: 'week52Count', icon: '📈', barClass: 'mt-bar-vix', source: 'VM 일 1회 배치',
      guide: '기본 5점에서 (신고가 수 − 신저가 수)×0.3을 더하거나 빼며, 0~10점 범위로 제한',
      desc: '섹터 풀 종목 중 52주 신고가·신저가 종목 수(VM이 하루 1회 미리 계산)' },
    { key: 'exchange', label: '환율', max: 5, unit: 'pct', icon: '💵', barClass: 'mt-bar-fx', source: '원/달러 전일 대비',
      guide: '기본 2.5점에서 원/달러 전일 등락률을 뺀 값(원화 강세일수록 가점), 0~5점 범위',
      desc: '원/달러 환율 전일 대비 등락률(원화 강세=환율 하락일수록 가점)' },
    { key: 'usFutures', label: '미국 선물지수', max: 5, unit: 'pct', icon: '🌎', barClass: 'mt-bar-fx', source: 'Yahoo Finance S&P500 E-mini',
      guide: '기본 2.5점 + 전일 대비 등락률×시간대 가중치. 장 마감 후에는 중립 2.5점, 0~5점 범위',
      desc: 'S&P500 E-mini 선물(ES=F) 등락률, 시간대별 가중치 적용 - 미국장 마감~한국장 개장 사이 선행지표' },
    { key: 'creditRisk', label: '빚투 위험도', max: 10, unit: 'creditRisk', icon: '💳', barClass: 'mt-bar-vix', source: 'KOFIA 신용융자·예탁금·반대매매',
      guide: '신용/예탁 비율·최근 평균 대비 신용융자 증가율·반대매매 비중을 합산. 안정=고점수, 과열=저점수',
      desc: '신용융자 추세·예탁금 대비 비율·반대매매 비중을 합산한 시장 레버리지 위험도. 안정/주의/과열은 운영 기준입니다.' }
  ];
  var COMPONENT_BY_KEY = {};
  COMPONENT_META.forEach(function (m) { COMPONENT_BY_KEY[m.key] = m; });

  // 레이더 차트 6축(사용자 스펙 명시 그대로) - COMPONENT_META의 서브셋을 재사용.
  var RADAR_KEYS = ['vix', 'flow', 'tradingValue', 'exchange', 'usFutures', 'riseRatio'];

  // 사용자 지정 온도(℃) 구간 - tone은 css/market-temp.css의 카드 배경색 클래스와 매칭.
  // color: 2026-07-18 스펙 지정 5색(등급 필/게이지/기준표/레이더 강조색에 일괄 적용).
  var GRADE_BANDS = [
    { range: '0~10℃', emoji: '🧊', label: '극단적 공포', season: '한겨울', seasonEmoji: '❄️', tone: 'extreme-fear', color: '#1565C0' },
    { range: '10~20℃', emoji: '🔵', label: '공포', season: '초봄', seasonEmoji: '🌱', tone: 'fear', color: '#42A5F5' },
    { range: '20~28℃', emoji: '🟡', label: '중립', season: '포근한 봄', seasonEmoji: '🌼', tone: 'neutral', color: '#FFD54F' },
    { range: '28~35℃', emoji: '🟠', label: '탐욕', season: '한여름', seasonEmoji: '☀️', tone: 'greed', color: '#FB8C00' },
    { range: '35~40℃', emoji: '🔥', label: '극단적 탐욕', season: '폭염', seasonEmoji: '🔥', tone: 'extreme-greed', color: '#E53935' }
  ];
  var GRADE_BY_TONE = {};
  GRADE_BANDS.forEach(function (b) { GRADE_BY_TONE[b.tone] = b; });

  // 역발상형 투자시그널(사용자 확정: 공포=매수 신호, CNN Fear&Greed 지수의 통상적 활용법).
  // actionTone: 2026-07-18(6차) - Hero의 "매수"가 등급색(공포=하늘색 #42A5F5)을 그대로 써서
  // "매수인데 파란색으로 보인다"는 피드백 - 오늘의 전략과 동일하게 매수=빨강/매도=파랑
  // (사이트 공통 부호색)으로 통일. 등급 자체를 나타내는 mt-grade-pill(예: "🔵 공포")은
  // 온도 밴드 색상이 맞으므로 그대로 grade.color 유지.
  var SIGNAL_BY_TONE = {
    'extreme-fear': { label: '적극매수', stars: 5, tone: 'mt-val-pos', summary: '공포가 과도합니다 · 한 번에 매수하지 말고 분할 접근' },
    'fear': { label: '매수', stars: 4, tone: 'mt-val-pos', summary: '공포 우세 구간 · 분할 매수 후보를 확인' },
    'neutral': { label: '관망', stars: 3, tone: 'mt-val-zero', summary: '혼조 구간 · 신규 매수보다 종목 선별 우선' },
    'greed': { label: '주의', stars: 2, tone: 'mt-val-neg', summary: '과열 접근 · 추격 매수는 피하고 비중 점검' },
    'extreme-greed': { label: '위험', stars: 1, tone: 'mt-val-neg', summary: '과열 경고 · 신규 매수는 멈추고 보유 비중 점검' }
  };

  // 오늘 투자전략 카드(같은 역발상 논리) - 사용자 확정 룩업.
  // actionTone: 2026-07-18(5차) 추가 - "매수는 빨간색, 매도는 파란색(분할 포함)"(사용자
  // 요청) - 등급색(grade.color) 대신 사이트 공통 부호색(mt-val-pos=빨강/neg=파랑/zero=회색)
  // 을 그대로 재사용해 매수/매도 방향성만 표시.
  var STRATEGY_BY_TONE = {
    'extreme-fear': { action: '적극 분할매수', actionTone: 'mt-val-pos', stock: 80, cash: 20, note: '변동성 확대 구간 - 분할 대응 권장' },
    'fear': { action: '분할매수', actionTone: 'mt-val-pos', stock: 70, cash: 30, note: '수급 개선 여부 확인 필요' },
    'neutral': { action: '관망', actionTone: 'mt-val-zero', stock: 50, cash: 50, note: '방향성 탐색 구간' },
    'greed': { action: '비중축소 검토', actionTone: 'mt-val-neg', stock: 30, cash: 70, note: '단기 과열 신호 주의' },
    'extreme-greed': { action: '현금 확보', actionTone: 'mt-val-neg', stock: 10, cash: 90, note: '극단적 과열 - 조정 리스크 유의' }
  };

  // 증시온도 화면은 온도 게이지(buildCard)만 렌더링하고, 카드/히트맵 탐색은
  // ?view=stocks의 국내 주요종목 화면에서 별도로 렌더링한다. 기존 호출부의
  // opts.gaugeOnly 인자는 하위 호환을 위해 계속 받을 수 있지만 현재는 동일한 온도 화면을 사용한다.
  function isStocksView() {
    return /(?:^|&)view=stocks(?:&|$)/.test(String(global.location && global.location.search || '').replace(/^\?/, ''));
  }

  function kstDateKey_(date) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date || new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }

  function readIndustryFlowSnapshots_() {
    try {
      var parsed = JSON.parse(localStorage.getItem(INDUSTRY_FLOW_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) { return {}; }
  }

  function writeIndustryFlowSnapshot_(dateKey, rows) {
    try {
      var snapshots = readIndustryFlowSnapshots_();
      snapshots[dateKey] = (rows || []).slice(0, INDUSTRY_TOP_LIMIT_).map(function (row) {
        return { industry: row.industry, avgChangeRate: row.avg_change_rate, tradeAmount: row.trade_amount, riseRatio: row.rise_ratio };
      });
      Object.keys(snapshots).sort().slice(0, -10).forEach(function (key) { delete snapshots[key]; });
      localStorage.setItem(INDUSTRY_FLOW_STORAGE_KEY, JSON.stringify(snapshots));
    } catch (error) { /* 저장소가 막혀도 현재 화면은 표시한다 */ }
  }

  function previousSnapshot_(snapshots, dateKey) {
    var keys = Object.keys(snapshots || {}).filter(function (key) { return key < dateKey; }).sort();
    return keys.length ? (snapshots[keys[keys.length - 1]] || []) : [];
  }

  function formatFlowAmount_(value) {
    var n = Number(value);
    if (!isFinite(n)) return '-';
    if (Math.abs(n) >= 1000000000000) return (n / 1000000000000).toFixed(1) + '조';
    if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(0) + '억';
    return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
  }

  function industryDisplayName_(name) {
    var raw = String(name || '').trim();
    return INDUSTRY_DISPLAY_MAP_[raw] || raw || '기타 업종';
  }

  function industryThemeName_(row) {
    var code = String(row && (row.code || row.stock_code || '') || '').trim();
    var name = String(row && (row.name || row.stock_name || '') || '').trim();
    var rawIndustry = String(row && row.industry || '').trim();
    if (INDUSTRY_THEME_CODE_MAP_[code]) return INDUSTRY_THEME_CODE_MAP_[code];
    for (var i = 0; i < INDUSTRY_THEME_KEYWORDS_.length; i += 1) {
      var rule = INDUSTRY_THEME_KEYWORDS_[i];
      if (rule.words.some(function (word) { return name.indexOf(word) !== -1; })) return rule.label;
    }
    if (rawIndustry === '반도체와반도체장비') return '반도체 소부장';
    if (rawIndustry === '제약과생물공학') return '제약·바이오';
    if (rawIndustry === '자동차와부품') return '자동차·부품';
    if (!rawIndustry || rawIndustry === '미분류' || rawIndustry === '기타') return '';
    return industryDisplayName_(rawIndustry);
  }

  function aggregateIndustryFlow_(rows) {
    var groups = {};
    var totalTradeAmount = 0;
    (rows || []).forEach(function (row) {
      var displayName = industryThemeName_(row);
      var count = Number(row && (row.stock_count != null ? row.stock_count : row.stockCount));
      // market-board의 거래대금 상위 종목 행은 ``change_rate``를 내려준다.
      // 이전에는 업종 집계 전용 필드(avg_change_rate)만 읽어, 개별 종목을 테마로
      // 다시 묶는 오늘 업종 TOP 10이 전부 0.00%로 보였다.
      var rate = Number(row && (row.avg_change_rate != null ? row.avg_change_rate
        : row.avgChangeRate != null ? row.avgChangeRate
          : row.change_rate != null ? row.change_rate : row.changeRate));
      var amount = Number(row && (row.trade_amount != null ? row.trade_amount : row.tradeAmount));
      if (!displayName) return;
      if (!isFinite(count) || count <= 0) count = 1;
      if (!isFinite(rate)) rate = 0;
      if (!isFinite(amount)) amount = 0;
      if (!groups[displayName]) {
        groups[displayName] = { industry: displayName, stockCount: 0, rateTotal: 0, tradeAmount: 0 };
      }
      groups[displayName].stockCount += count;
      groups[displayName].rateTotal += rate * count;
      groups[displayName].tradeAmount += amount;
      totalTradeAmount += amount;
    });
    return Object.keys(groups).map(function (name) {
      var group = groups[name];
      return {
        industry: group.industry,
        stock_count: group.stockCount,
        avg_change_rate: group.stockCount ? group.rateTotal / group.stockCount : 0,
        trade_amount: group.tradeAmount,
        trade_share: totalTradeAmount ? group.tradeAmount / totalTradeAmount : 0
      };
    }).sort(function (a, b) {
      return Number(b.trade_amount) - Number(a.trade_amount)
        || Number(b.avg_change_rate) - Number(a.avg_change_rate);
    });
  }

  function renderIndustryFlow_(mount, rows, dateKey) {
    var snapshots = readIndustryFlowSnapshots_();
    var previous = previousSnapshot_(snapshots, dateKey);
    var previousByName = {};
    previous.forEach(function (row, index) { previousByName[row.industry] = { rank: index + 1 }; });
    var html = (rows || []).slice(0, INDUSTRY_TOP_LIMIT_).map(function (row, index) {
      var old = previousByName[row.industry];
      var rankText = old ? (old.rank === index + 1 ? '유지' : (old.rank > index + 1 ? '▲ ' + (old.rank - index - 1) : '▼ ' + (index + 1 - old.rank))) : '첫 관측';
      var rate = Number(row.avg_change_rate != null ? row.avg_change_rate : row.avgChangeRate);
      var tone = rate > 0 ? 'is-up' : rate < 0 ? 'is-down' : 'is-flat';
      return '<div class="mt-industry-flow-row ' + tone + '">'
        + '<b>' + escapeHtml(row.industry || '-') + '</b>'
        + '<span>' + formatFlowAmount_(row.trade_amount != null ? row.trade_amount : row.tradeAmount) + '</span>'
        + '<span>' + (isFinite(rate) ? (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '-') + '</span>'
        + '<small>' + escapeHtml(rankText) + '</small></div>';
    }).join('');
    mount.innerHTML = '<div class="mt-section mt-card mt-industry-flow-card">'
      + '<div class="mt-industry-flow-head"><strong>오늘 업종 TOP 10</strong><span>테마별 총 거래대금 기준 · 최근 거래일 대비 순위 변화</span></div>'
      + '<div class="mt-industry-flow-columns"><span>테마 업종</span><span>거래대금</span><span>평균등락</span><span>최근 거래일 대비</span></div>'
      + (html || '<div class="mt-hint">업종 흐름 데이터가 없습니다.</div>')
      + '<p class="mt-industry-flow-note">실시간 종목판의 거래대금 상위 종목을 테마별로 합산합니다. 거래대금이 돈의 흐름 순위이며 평균등락률은 보조지표입니다. 전일 순위는 이 브라우저가 관측한 마지막 거래일 스냅샷과 비교합니다.</p>'
      + '</div>';
  }

  function loadIndustryFlow_(container) {
    var mount = container.querySelector('[data-industry-flow]');
    if (!mount) return;
    var dateKey = kstDateKey_(new Date());
    fetch(INDUSTRY_FLOW_URL)
      .then(function (response) { if (!response.ok) throw new Error('industry flow ' + response.status); return response.json(); })
      .then(function (body) {
        // market-board 응답은 현재 { data: { sections: ... } } 형태이며,
        // 구형 프록시가 바로 { sections: ... }를 반환할 가능성도 있어 양쪽을
        // 허용한다. 기존 경로만 읽으면 카드 껍데기만 생기고 행이 비어 보인다.
        var payload = body && body.data ? body.data : body;
        var sections = payload && payload.sections || {};
        // 개별 거래대금 상위 종목이 있으면 자동차/부품·반도체/소부장·원전처럼
        // WICS 한 업종을 투자 테마로 다시 나눌 수 있다. 구형 응답은 기존 집계로 폴백한다.
        var sourceRows = sections.tradeAmount && sections.tradeAmount.length
          ? sections.tradeAmount : sections.industry || [];
        var rows = aggregateIndustryFlow_(sourceRows);
        writeIndustryFlowSnapshot_(dateKey, rows);
        renderIndustryFlow_(mount, rows, dateKey);
      })
      .catch(function () {
        renderIndustryFlow_(mount, readIndustryFlowSnapshots_()[dateKey] || [], dateKey);
      });
  }

  function buildStocksOnlyPage() {
    var params = new URLSearchParams(String(global.location && global.location.search || ''));
    var initialView = params.get('panel') === 'heatmap' ? 'heatmap' : params.get('panel') === 'marketcap' ? 'marketcap' : 'cards';
    return '<div class="mt-stocks-only">'
      + '<div class="mt-stocks-only-heading"><h1>국내 주요종목</h1><p>업종별 주요 종목의 현재가와 등락률을 한눈에 확인합니다.</p></div>'
      + buildExploreCard(initialView)
      + '</div>';
  }

  function init(opts) {
    var stocksOnly = isStocksView();
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    if (stocksOnly) {
      container.innerHTML = buildStocksOnlyPage();
      wireViewTabs(container);
      return;
    }
    container.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>증시온도 불러오는 중...</div>';

    MarketTemp.fetchMarketTemp()
      .then(function (data) {
        if (!data || typeof data.temp !== 'number') {
          container.innerHTML = '<div class="mt-error">증시온도를 불러오지 못했습니다.</div>';
          return;
        }
        container.innerHTML = buildCard(data);
        wireAnimations(container, data);
        loadAiBriefing(container);
        loadIndustryFlow_(container);
      })
      .catch(function () {
        container.innerHTML = '<div class="mt-error">증시온도를 불러오지 못했습니다.</div>';
      });
  }

  function fetchJson_(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchMarketTemp() {
    return fetchJson_(GAS_TICKER_URL + '?marketTemp=1');
  }

  // AI 시장 브리핑은 별도 엔드포인트(Groq 호출이라 메인 온도 조회보다 느릴 수 있음) - 메인
  // 카드 렌더링을 막지 않도록 init()에서 병렬이 아니라 카드가 이미 그려진 뒤 비동기로
  // 채워넣는다(다른 페이지의 AI요약 박스와 동일한 패턴 - 실패해도 나머지 카드는 정상 표시).
  function fetchMarketTempBriefing() {
    return fetchJson_(GAS_TICKER_URL + '?marketTempBriefing=1');
  }

  function loadAiBriefing(container) {
    var mount = container.querySelector('#mtAiBriefing');
    if (!mount) return;
    MarketTemp.fetchMarketTempBriefing()
      .then(function (data) {
        if (data && data.analysis) {
          mount.innerHTML = '<p class="mt-ai-text">' + escapeHtml(data.analysis) + '</p>';
        } else {
          mount.innerHTML = '<p class="mt-ai-text mt-ai-empty">브리핑을 생성하지 못했습니다.</p>';
        }
      })
      .catch(function () {
        mount.innerHTML = '<p class="mt-ai-text mt-ai-empty">브리핑을 불러오지 못했습니다.</p>';
      });
  }

  // comp(서버 응답의 지표별 원자료)에서 unit에 맞는 표시 텍스트 + 색상톤을 뽑는다.
  // 톤 규칙(사용자 지정): 0 초과=붉은색(mt-val-pos), 0 미만=파란색(mt-val-neg), 0=회색(mt-val-zero).
  function formatRaw(meta, comp) {
    if (!comp) return null;

    if (meta.unit === 'index') {
      if (typeof comp.value !== 'number') return null;
      return { text: comp.value.toFixed(2), tone: 'mt-val-zero' };
    }

    if (meta.unit === 'ratio') {
      if (typeof comp.total !== 'number' || comp.total === 0) return { text: '데이터 부족', tone: 'mt-val-zero' };
      var delta = comp.up - comp.down;
      var tone = delta > 0 ? 'mt-val-pos' : delta < 0 ? 'mt-val-neg' : 'mt-val-zero';
      return { text: '상승 ' + comp.up + ' · 하락 ' + comp.down, tone: tone };
    }

    if (meta.unit === 'pctDirect') {
      if (typeof comp.avgChangeRate !== 'number') return null;
      var av = comp.avgChangeRate;
      var avTone = av > 0 ? 'mt-val-pos' : av < 0 ? 'mt-val-neg' : 'mt-val-zero';
      return { text: (av > 0 ? '+' : '') + av.toFixed(2) + '%', tone: avTone };
    }

    if (meta.unit === 'sectorCount') {
      if (typeof comp.sectorCount !== 'number') return null;
      var maxStrong = comp.sectorCount * 2;
      var strTone = comp.strongCount >= maxStrong * 0.6 ? 'mt-val-pos'
        : comp.strongCount <= maxStrong * 0.3 ? 'mt-val-neg' : 'mt-val-zero';
      return { text: '강세 ' + comp.strongCount + '/' + maxStrong + ' (섹터 ' + comp.sectorCount + '개)', tone: strTone };
    }

    if (meta.unit === 'week52Count') {
      if (typeof comp.newHigh !== 'number') return null;
      var wDelta = comp.newHigh - comp.newLow;
      var wTone = wDelta > 0 ? 'mt-val-pos' : wDelta < 0 ? 'mt-val-neg' : 'mt-val-zero';
      return { text: '신고가 ' + comp.newHigh + ' · 신저가 ' + comp.newLow, tone: wTone };
    }

    if (meta.unit === 'flow') {
      if (!comp.foreign) return null;
      var fPct = typeof comp.foreign.ratio === 'number' ? comp.foreign.ratio * 100 : null;
      var iPct = typeof comp.inst.ratio === 'number' ? comp.inst.ratio * 100 : null;
      var parts = [];
      if (fPct != null) parts.push('외' + (fPct > 0 ? '+' : '') + fPct.toFixed(1) + '%');
      if (iPct != null) parts.push('기' + (iPct > 0 ? '+' : '') + iPct.toFixed(1) + '%');
      if (!parts.length) return null;
      var net = (fPct || 0) * 0.75 + (iPct || 0) * 0.25;
      var flowTone = net > 0 ? 'mt-val-pos' : net < 0 ? 'mt-val-neg' : 'mt-val-zero';
      return { text: parts.join(' · '), tone: flowTone };
    }

    if (meta.unit === 'creditRisk') {
      if (comp && comp.validation === 'pending') {
        return { text: '데이터 검증 중', tone: 'mt-val-zero' };
      }
      if (!comp || !comp.available || typeof comp.score !== 'number') {
        return { text: '데이터 준비 중', tone: 'mt-val-zero' };
      }
      var riskTone = comp.state === 'stable' ? 'mt-val-pos'
        : comp.state === 'overheated' ? 'mt-val-neg' : 'mt-val-zero';
      var loanText = typeof comp.loan_total === 'number'
        ? ' · 신용융자 ' + (comp.loan_total / 1000000000000).toFixed(2) + '조원'
        : '';
      var ratioText = typeof comp.loan_to_deposit_pct === 'number'
        ? ' · 신용/예탁 ' + comp.loan_to_deposit_pct.toFixed(1) + '%'
        : '';
      return { text: (comp.stateLabel || '판단 보류') + loanText + ratioText, tone: riskTone };
    }

    // unit === 'pct'
    var v = typeof comp.changeRate === 'number' ? comp.changeRate
      : typeof comp.changePct === 'number' ? comp.changePct
      : typeof comp.relative === 'number' ? (comp.relative - 1) * 100
      : null;
    if (v == null) return null;
    var pctTone = v > 0 ? 'mt-val-pos' : v < 0 ? 'mt-val-neg' : 'mt-val-zero';
    return { text: (v > 0 ? '+' : '') + v.toFixed(2) + '%', tone: pctTone };
  }

  // 지표별 짧은 배지 문구(예: "매도", "활발") - 상승비율/섹터강도/52주신고저는
  // formatRaw의 텍스트 자체가 이미 배지 역할을 겸해서 생략.
  function classify(meta, comp) {
    if (!comp) return null;
    switch (meta.key) {
      case 'vix': {
        var v = comp.value;
        if (v == null) return null;
        if (v < 15) return { word: '안정', tone: 'mt-val-zero' };
        if (v < 20) return { word: '보통', tone: 'mt-val-zero' };
        if (v < 25) return { word: '높음', tone: 'mt-val-pos' };
        if (v < 30) return { word: '매우높음', tone: 'mt-val-pos' };
        return { word: '위험', tone: 'mt-val-pos' };
      }
      case 'flow': {
        if (!comp.foreign || !comp.inst) return null;
        var fR = comp.foreign.ratio, iR = comp.inst.ratio;
        if (fR == null && iR == null) return null;
        var net = (fR || 0) * 0.75 + (iR || 0) * 0.25;
        if (net > 0.15) return { word: '매수', tone: 'mt-val-pos' };
        if (net < -0.15) return { word: '매도', tone: 'mt-val-neg' };
        return { word: '중립', tone: 'mt-val-zero' };
      }
      case 'tradingValue': {
        var rel = comp.relative;
        if (rel == null) return { word: '보통', tone: 'mt-val-zero' };
        if (rel >= 1.1) return { word: '활발', tone: 'mt-val-pos' };
        if (rel <= 0.9) return { word: '저조', tone: 'mt-val-neg' };
        return { word: '보통', tone: 'mt-val-zero' };
      }
      case 'exchange':
      case 'usFutures': {
        var chg = typeof comp.changeRate === 'number' ? comp.changeRate : comp.changePct;
        if (chg == null) return null;
        if (chg > 0.05) return { word: '상승', tone: 'mt-val-pos' };
        if (chg < -0.05) return { word: '하락', tone: 'mt-val-neg' };
        return { word: '보합', tone: 'mt-val-zero' };
      }
      default:
        return null;
    }
  }

  // 점수 기여도 = 점수 - 만점/2 (양수=온도 상승 방향/탐욕, 음수=하락 방향/공포).
  // 개별 지표 행/TOP5 영향요인 카드가 공유하는 계산식 - GAS getMarketTempBriefing()의
  // AI 프롬프트도 동일한 공식을 쓴다(숫자 불일치 방지).
  function contribution(meta, comp) {
    if (meta.unit === 'creditRisk' && (!comp || !comp.available || typeof comp.score !== 'number')) return null;
    var score = comp && typeof comp.score === 'number' ? comp.score : meta.max / 2;
    return score - meta.max / 2;
  }

  function score100(data) {
    var rawScore = Number(data && data.score);
    var rawMax = Number(data && data.maxScore);
    if (isFinite(rawScore) && isFinite(rawMax) && rawMax > 0) return rawScore / rawMax * 100;
    var temp = Number(data && data.temp);
    return isFinite(temp) ? temp / GAUGE_MAX_TEMP * 100 : 0;
  }

  function fmtContribution(c) {
    return (c > 0 ? '+' : c < 0 ? '' : '±') + c.toFixed(1) + '점';
  }
  function contribTone(c) {
    return c > 0 ? 'mt-val-pos' : c < 0 ? 'mt-val-neg' : 'mt-val-zero';
  }

  // ---- ① Hero: 온도 + 등급 + 전일/주간/월간 대비 + 투자시그널 별점 ----

  // 2026-07-18(2차 개편): Hero와 게이지를 하나의 카드로 병합(사용자 요청 - "숫자를 본
  // 직후 바로 위치를 확인할 수 있도록"). buildHero/buildGauge는 이제 각자 outer
  // .mt-section 래퍼 없이 내부 콘텐츠만 반환하고, buildHeroCard가 하나의 카드로 합친다.
  function buildHero(data) {
    var grade = data.grade || { emoji: '', label: '', tone: 'neutral' };
    var signal = SIGNAL_BY_TONE[grade.tone] || SIGNAL_BY_TONE.neutral;
    var normalizedScore = score100(data);
    var starsHtml = '<span class="mt-hero-stars">'
      + '★'.repeat(signal.stars) + '<span class="mt-hero-stars-empty">' + '★'.repeat(5 - signal.stars) + '</span>'
      + '</span>';

    var deltasHtml;
    if (data.history) {
      var h = data.history;
      var weekDelta = Math.round((data.temp - h.weekAvg) * 10) / 10;
      var monthDelta = Math.round((data.temp - h.monthAvg) * 10) / 10;
      function deltaChip(label, v) {
        var tone = v > 0 ? 'mt-val-pos' : v < 0 ? 'mt-val-neg' : 'mt-val-zero';
        var arrow = v > 0 ? '▲' : v < 0 ? '▼' : '-';
        return '<div class="mt-hero-delta"><span class="mt-hero-delta-label">' + label + '</span>'
          + '<span class="mt-hero-delta-value ' + tone + '">' + arrow + Math.abs(v).toFixed(1) + '℃</span></div>';
      }
      deltasHtml = deltaChip('어제 대비', h.dayChange) + deltaChip('지난주 대비', weekDelta) + deltaChip('지난달 대비', monthDelta);
    } else {
      deltasHtml = '<div class="mt-hero-delta-empty">오늘부터 일별 기록을 시작했습니다. 비교값은 실제 기록이 쌓이면 표시됩니다.</div>';
    }

    return ''
      + '<div class="mt-hero">'
      + '<div class="mt-hero-left">'
      + '<div class="mt-hero-title">🌡 오늘의 증시온도 <span class="mt-info" data-tooltip="10개 지표의 원점수(120점 만점)를 100점으로 환산한 뒤 0~40℃로 바꿉니다. 50~70점(20~28℃)은 중립이며, 높을수록 과열 방향·낮을수록 공포 방향입니다.">ⓘ</span></div>'
      + '<div class="mt-hero-main">'
      + '<span class="mt-thermometer-art" aria-hidden="true"><span class="mt-thermometer-mercury"></span></span>'
      // 2026-07-18: 초기 렌더 값을 "0.0"(애니메이션 시작점) 대신 이미 정답 온도로 그린다 -
      // requestAnimationFrame이 안 도는 환경(백그라운드 탭에서 페이지가 로드되는 경우 등
      // 실제로 존재함, 로컬 테스트에서 rAF가 전혀 안 도는 것을 실측 확인)에서도 항상 올바른
      // 값이 보이게 하기 위함(count-up은 순수 시각효과, 실패해도 데이터는 정확해야 함).
      + '<span class="mt-score" style="--mt-score-color:' + grade.color + ';color:var(--mt-score-color)" data-count-target="' + data.temp.toFixed(1) + '">' + data.temp.toFixed(1) + '<span class="mt-score-unit">℃</span></span>'
      + '<span class="mt-grade-pill" style="background:' + grade.color + '22;color:' + grade.color + '">' + escapeHtml(grade.emoji) + ' ' + escapeHtml(grade.label) + '</span>'
      + '</div>'
      + '<div class="mt-hero-score-context"><strong>환산 점수 ' + normalizedScore.toFixed(1) + ' / 100점</strong><span>중립 50~70점 · 현재 ' + escapeHtml(grade.label) + '</span></div>'
      + '<div class="mt-hero-deltas">' + deltasHtml + '</div>'
      + '</div>'
      + '<div class="mt-hero-right">'
      + '<div class="mt-hero-signal-label">오늘의 투자시그널</div>'
      + starsHtml
      + '<div class="mt-hero-signal-word ' + signal.tone + '">' + escapeHtml(signal.label) + '</div>'
      + '</div>'
      + '</div>';
  }

  // ---- ② AI 시장 브리핑 (비동기로 채워짐 - loadAiBriefing 참고) ----

  // 2026-08-14 요청: 사이트 곳곳의 Groq AI 요약 상자 제목이 "참고의견"/"종합 요약"/"요약"으로
  // 제각각이라는 지적 - js/kospi-futures.js·js/overnight-market.js가 이미 쓰는 "참고의견" +
  // 이 말풍선 아이콘으로 통일한다(둘과 완전히 동일한 SVG).
  var MT_AI_ICON = '<svg class="mt-ai-icon" width="14" height="14" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function buildAiBriefingShell() {
    return ''
      + '<div class="mt-briefing-panel">'
      + '<div class="mt-briefing-panel-title">' + MT_AI_ICON + ' 참고의견</div>'
      + '<div id="mtAiBriefing"><div class="mt-hint mt-hint-inline">브리핑 생성 중...</div></div>'
      + '</div>';
  }

  // ---- ③ 오늘 시장 영향요인 TOP5 ----

  // ---- ①-2 온도 게이지 (Hero 카드 안으로 병합됨, buildHeroCard 참고) ----

  function buildGauge(temp) {
    var pct = Math.max(0, Math.min(100, (temp / GAUGE_MAX_TEMP) * 100));
    var stops = GRADE_BANDS.map(function (b, i) {
      return b.color + ' ' + Math.round(i / (GRADE_BANDS.length - 1) * 100) + '%';
    }).join(', ');
    return ''
      + '<div class="mt-gauge-title">증시온도 게이지</div>'
      // 2026-07-18: 마커/버블 스윕은 순수 CSS 애니메이션(@keyframes mtSweepLeft, CSS
      // 변수 --mt-target-left)으로 구현 - JS/rAF와 무관하게 항상 최종적으로 올바른
      // left 값에 도달한다(rAF가 안 도는 환경에서도 baseline인 inline left:X%가 그대로
      // 정답 위치를 보장, 애니메이션은 그 위에 얹히는 순수 시각효과일 뿐).
      + '<div class="mt-gauge">'
      + '<div class="mt-gauge-bubble mt-anim-left" style="left:' + pct.toFixed(1) + '%;--mt-target-left:' + pct.toFixed(1) + '%">' + temp.toFixed(1) + '℃</div>'
      + '<div class="mt-gauge-track" style="background:linear-gradient(90deg,' + stops + ')">'
      + '<div class="mt-gauge-marker mt-anim-left" style="left:' + pct.toFixed(1) + '%;--mt-target-left:' + pct.toFixed(1) + '%"></div>'
      + '</div>'
      + '<div class="mt-gauge-scale"><span>0℃</span><span>10℃</span><span>20℃</span><span>28℃</span><span>35℃</span><span>40℃</span></div>'
      + '<div class="mt-gauge-bands"><span>극단적 공포</span><span>공포</span><span>중립</span><span>탐욕</span><span>극단적 탐욕</span></div>'
      + '</div>';
  }

  // 오늘의 온도를 먼저 읽고 과거 추이가 오른쪽으로 이어지는 "꼬리" 구조.
  // 현재 값과 스파크라인을 같은 카드 안에서 현재 값 | 최근 흐름으로 묶는다.
  function buildHeroCard(data) {
    return '<div class="mt-section mt-card mt-hero-card">'
      + '<div class="mt-hero-history-layout">'
      + '<div class="mt-hero-current">' + buildHero(data) + '</div>'
      + '<div class="mt-hero-history">' + buildSparkline(data, true) + '</div>'
      + '</div>'
      + '</div>';
  }

  // ---- ③ 시장 구성 요소: 개인 투자자가 글을 읽지 않아도 "오늘 판단 / 무엇이 점수를
  // 올리고 내렸는지"를 바로 읽도록 양방향 영향도 막대로 압축한다. 상세 기준은 접은 영역에 둔다. ----

  function buildDriverRow(item, direction) {
    var meta = item.meta;
    var comp = item.comp;
    var score = comp && typeof comp.score === 'number' ? comp.score : 0;
    var raw = formatRaw(meta, comp);
    var band = comp && comp.band ? comp.band : null;
    var rawText = raw ? raw.text : (band || '데이터 확인 중');
    var maxContribution = meta.max / 2;
    var width = maxContribution ? Math.max(8, Math.min(100, Math.abs(item.c) / maxContribution * 100)) : 8;
    var sign = direction === 'up' ? '+' : '−';
    return ''
      + '<div class="mt-driver-row mt-driver-' + direction + '">'
      + '<div class="mt-driver-label"><span>' + meta.icon + ' ' + escapeHtml(meta.label) + '</span><small>' + escapeHtml(rawText) + '</small></div>'
      + '<div class="mt-driver-track"><span class="mt-driver-fill" style="width:' + width.toFixed(0) + '%"></span></div>'
      + '<b>' + sign + Math.abs(item.c).toFixed(1) + '</b>'
      + '</div>'
  }

  function buildDriverGroup(title, direction, items) {
    var rows = items.length
      ? items.map(function (item) { return buildDriverRow(item, direction); }).join('')
      : '<div class="mt-driver-empty">중립에 가까운 항목입니다.</div>';
    return '<section class="mt-driver-group mt-driver-group-' + direction + '"><h4>' + title + '</h4>' + rows + '</section>';
  }

  function buildBars(data) {
    var ranked = COMPONENT_META.map(function (meta) {
      var comp = data.components && data.components[meta.key];
      return { meta: meta, comp: comp, c: contribution(meta, comp) };
    }).sort(function (a, b) { return Math.abs(b.c) - Math.abs(a.c); });

    var rising = ranked.filter(function (r) { return r.c > 0; });
    var falling = ranked.filter(function (r) { return r.c < 0; });
    var methodRows = COMPONENT_META.map(function (meta) {
      return '<li><b>' + meta.icon + ' ' + escapeHtml(meta.label) + ' · ' + meta.max + '점</b><span>'
        + escapeHtml(meta.guide) + '</span><small>데이터: ' + escapeHtml(meta.source) + '</small></li>';
    }).join('');
    var normalizedScore = score100(data);
    var grade = data.grade || { tone: 'neutral', label: '중립' };
    var signal = SIGNAL_BY_TONE[grade.tone] || SIGNAL_BY_TONE.neutral;
    return ''
      + '<div class="mt-card mt-decision-card">'
      + '<div class="mt-card-title">📊 오늘 시장 판단</div>'
      + '<div class="mt-market-decision">'
      + '<div><span class="mt-market-decision-label">오늘 점수</span><strong>' + normalizedScore.toFixed(1) + '<small>/100</small></strong></div>'
      + '<div class="mt-market-decision-action ' + signal.tone + '"><span>오늘 행동</span><b>' + escapeHtml(signal.label) + '</b><small>' + escapeHtml(signal.summary) + '</small></div>'
      + '</div>'
      + '<div class="mt-driver-grid">'
      + buildDriverGroup('▲ 점수를 올린 요인', 'up', rising)
      + buildDriverGroup('▼ 점수를 내린 요인', 'down', falling)
      + '</div>'
      + '<div class="mt-driver-legend"><span>막대가 길수록 오늘 점수에 미친 영향이 큽니다.</span><span>빨강: 과열 방향 · 파랑: 공포 방향</span></div>'
      + '<details class="mt-score-method"><summary>점수·계산 기준·데이터 출처 보기</summary><p>10개 지표의 원점수 120점을 100점으로 환산합니다. 50~70점은 중립, 높을수록 과열 방향·낮을수록 공포 방향입니다. 투자 권유가 아닙니다.</p><ul>' + methodRows + '</ul></details>'
      + '</div>';
  }

  // ---- 최근 단기흐름(5/10/20/40일) ----

  function historyDays_(data) {
    return (data.recentDays || []).filter(function (item) {
      return item && typeof item.temp === 'number' && isFinite(item.temp);
    }).slice(-40);
  }

  function smoothSegment_(points, index) {
    var p1 = points[index], p2 = points[index + 1];
    var p0 = points[index - 1] || p1, p3 = points[index + 2] || p2;
    var c1x = p1.x + (p2.x - p0.x) / 6;
    var c1y = p1.y + (p2.y - p0.y) / 6;
    var c2x = p2.x - (p3.x - p1.x) / 6;
    var c2y = p2.y - (p3.y - p1.y) / 6;
    return 'M' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1)
      + ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' '
      + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' '
      + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
  }

  function signedTemp_(value) {
    var rounded = Math.round(value * 10) / 10;
    return (rounded > 0 ? '+' : '') + rounded.toFixed(1) + '℃';
  }

  function buildSparklineContent(data, period) {
    var days = historyDays_(data);
    if (!days.length) return '<div class="mt-stats-empty">증시온도 기록을 확인할 수 없습니다.</div>';
    var shown = days.slice(-period);
    if (shown.length === 1) {
      return '<div class="mt-spark-single"><strong>' + shown[0].temp.toFixed(1) + '℃</strong>'
        + '<span>' + escapeHtml(shown[0].date) + '</span><small>단기흐름 데이터가 더 쌓이면 기간을 비교할 수 있습니다.</small></div>';
    }

    // 현재값을 포함하지 않은 최근 30개를 기준선으로 삼아, 오늘이 평소보다
    // 높은지(빨강) 낮은지(파랑)를 바로 읽게 한다.
    var priorDays = days.slice(0, -1);
    var baselineRows = (priorDays.length ? priorDays : days).slice(-30);
    var baseline = baselineRows.reduce(function (sum, item) { return sum + item.temp; }, 0) / baselineRows.length;
    var deltas = shown.map(function (item) { return item.temp - baseline; });
    var maxAbs = Math.max.apply(null, deltas.map(function (value) { return Math.abs(value); })) || 1;
    var W = 640, H = 142, PAD = 12, center = H / 2, half = H / 2 - PAD;
    var stepX = (W - PAD * 2) / (shown.length - 1);
    var points = shown.map(function (item, i) {
      return { x: PAD + i * stepX, y: center - (deltas[i] / maxAbs) * half, temp: item.temp, delta: deltas[i], date: item.date };
    });
    var segmentPaths = points.slice(1).map(function (point, i) {
      var previous = points[i];
      var tone = (previous.delta + point.delta) / 2 > 0 ? 'pos' : (previous.delta + point.delta) / 2 < 0 ? 'neg' : 'zero';
      return '<path class="mt-spark-segment mt-spark-draw mt-wave-segment-' + tone + '" d="' + smoothSegment_(points, i) + '"></path>';
    }).join('');
    var areaPaths = points.slice(1).map(function (point, i) {
      var previous = points[i];
      var tone = (previous.delta + point.delta) / 2 > 0 ? 'pos' : 'neg';
      return '<path class="mt-wave-area mt-wave-area-' + tone + '" d="M' + previous.x.toFixed(1) + ',' + center.toFixed(1)
        + ' L' + previous.x.toFixed(1) + ',' + previous.y.toFixed(1) + ' L' + point.x.toFixed(1) + ',' + point.y.toFixed(1)
        + ' L' + point.x.toFixed(1) + ',' + center.toFixed(1) + ' Z"></path>';
    }).join('');
    var dots = points.map(function (point, i) {
      var tone = point.delta > 0 ? 'pos' : point.delta < 0 ? 'neg' : 'zero';
      return '<circle class="mt-spark-dot mt-wave-dot-' + tone + (i === points.length - 1 ? ' mt-spark-current-dot' : '')
        + '" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + (i === points.length - 1 ? 4.5 : 2.5) + '"><title>'
        + escapeHtml(point.date) + ' ' + point.temp.toFixed(1) + '℃ (' + signedTemp_(point.delta) + ')</title></circle>';
    }).join('');
    var gridLines = [0.25, 0.5, 0.75].map(function (ratio) {
      var y = (PAD + (H - PAD * 2) * ratio).toFixed(1);
      return '<line class="mt-spark-grid-line" x1="' + PAD + '" y1="' + y + '" x2="' + (W - PAD) + '" y2="' + y + '"></line>';
    }).join('');
    var current = points[points.length - 1];
    var first = points[0];
    var periodDelta = current.delta - first.delta;
    var periodTone = periodDelta > 0 ? 'mt-val-pos' : periodDelta < 0 ? 'mt-val-neg' : 'mt-val-zero';
    var labels = '<span><i class="mt-wave-dot-neg"></i>낮음 <b class="mt-val-neg">-</b></span>'
      + '<span><i class="mt-wave-dot-zero"></i>30일 평균 <b>' + baseline.toFixed(1) + '℃</b></span>'
      + '<span><i class="mt-wave-dot-pos"></i>높음 <b class="mt-val-pos">+</b></span>';
    var metrics = '<div class="mt-history-metrics">'
      + '<span><small>30일 기준선</small><b>' + baseline.toFixed(1) + '℃</b></span>'
      + '<span><small>최저 편차</small><b class="mt-val-neg">' + signedTemp_(Math.min.apply(null, deltas)) + '</b></span>'
      + '<span><small>최고 편차</small><b class="mt-val-pos">' + signedTemp_(Math.max.apply(null, deltas)) + '</b></span>'
      + '<span><small>기간 변화</small><b class="' + periodTone + '">' + (periodDelta > 0 ? '▲ ' : periodDelta < 0 ? '▼ ' : '— ') + signedTemp_(periodDelta) + '</b></span>'
      + '</div>';
    return '<div class="mt-history-chart-meta"><span>30일 평균 ' + baseline.toFixed(1) + '℃ 기준</span><b class="' + periodTone + '">현재 ' + signedTemp_(current.delta) + '</b></div>'
      + '<svg class="mt-spark mt-wave-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="최근 ' + period + '일 단기흐름">'
      + gridLines + '<line class="mt-wave-zero" x1="' + PAD + '" y1="' + center + '" x2="' + (W - PAD) + '" y2="' + center + '"></line>'
      + areaPaths + segmentPaths + dots + '</svg>'
      + '<div class="mt-spark-labels mt-wave-legend">' + labels + '</div>' + metrics;
  }

  function buildSparkline(data, compact, selectedPeriod) {
    var days = historyDays_(data);
    var frameClass = compact ? 'mt-history-tail' : 'mt-card';
    var selected = HISTORY_PERIODS.indexOf(selectedPeriod) >= 0 ? selectedPeriod : DEFAULT_HISTORY_PERIOD;
    var availablePeriods = HISTORY_PERIODS.filter(function (period) { return days.length >= period; });
    if (availablePeriods.length && availablePeriods.indexOf(selected) < 0) selected = availablePeriods[availablePeriods.length - 1];
    var buttons = HISTORY_PERIODS.map(function (period) {
      var unavailable = days.length < period;
      return '<button type="button" class="mt-flow-period' + (selected === period ? ' active' : '') + '" data-history-period="' + period + '"'
        + (unavailable ? ' disabled title="데이터 수집 중 (' + days.length + '/' + period + '일)"' : '')
        + ' aria-label="최근 ' + period + '일 흐름" aria-selected="' + (selected === period ? 'true' : 'false') + '">' + period + '일</button>';
    }).join('');
    return '<div class="' + frameClass + '" data-mt-history-panel>'
      + '<div class="mt-history-tail-head"><div class="mt-card-title">📈 최근 단기흐름</div><div class="mt-flow-periods" role="tablist" aria-label="단기흐름 기간">' + buttons + '</div></div>'
      + '<div data-mt-history-content>' + buildSparklineContent(data, selected) + '</div>'
      + '</div>';
  }

  function wireHistoryPeriods(container, data) {
    var panel = container.querySelector('[data-mt-history-panel]');
    if (!panel) return;
    panel.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-history-period]');
      if (!button || button.disabled) return;
      var period = parseInt(button.getAttribute('data-history-period'), 10);
      var content = panel.querySelector('[data-mt-history-content]');
      if (!content || HISTORY_PERIODS.indexOf(period) < 0) return;
      panel.querySelectorAll('[data-history-period]').forEach(function (item) {
        var active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      content.innerHTML = buildSparklineContent(data, period);
    });
  }

  // ---- ⑦ 시장 레이더 차트 ----

  function buildRadar(data) {
    var cx = 150, cy = 150, R = 110;
    var n = RADAR_KEYS.length;
    function pointFor(i, ratio) {
      var angle = (Math.PI * 2 * i / n) - Math.PI / 2;
      return { x: cx + Math.cos(angle) * R * ratio, y: cy + Math.sin(angle) * R * ratio };
    }
    // 배경 동심 육각형 그리드(20/40/60/80/100%)
    var grid = [0.2, 0.4, 0.6, 0.8, 1.0].map(function (ratio) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pointFor(i, ratio); pts.push(p.x.toFixed(1) + ',' + p.y.toFixed(1)); }
      return '<polygon points="' + pts.join(' ') + '" fill="none" stroke="currentColor" class="mt-radar-grid"></polygon>';
    }).join('');
    // 축 라인 + 라벨
    var axes = RADAR_KEYS.map(function (key, i) {
      var meta = COMPONENT_BY_KEY[key];
      var edge = pointFor(i, 1);
      var labelPt = pointFor(i, 1.18);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + edge.x.toFixed(1) + '" y2="' + edge.y.toFixed(1) + '" stroke="currentColor" class="mt-radar-grid"></line>'
        + '<text x="' + labelPt.x.toFixed(1) + '" y="' + labelPt.y.toFixed(1) + '" class="mt-radar-label" text-anchor="middle">' + meta.icon + ' ' + escapeHtml(meta.label.replace('(외국인+기관)', '')) + '</text>';
    }).join('');
    // 데이터 폴리곤(score/max*100 정규화 - 개별 지표 바와 동일 스케일) + 꼭짓점마다
    // 점수 라벨(2026-07-18 3차: "레이더가 너무 썰렁하다"는 피드백 - 마커/점수 텍스트로
    // 정보 밀도를 높임).
    var dataPoints = [];
    var dataPts = RADAR_KEYS.map(function (key, i) {
      var meta = COMPONENT_BY_KEY[key];
      var comp = data.components && data.components[key];
      var score = comp && typeof comp.score === 'number' ? comp.score : meta.max / 2;
      var ratio = meta.max ? Math.max(0, Math.min(1, score / meta.max)) : 0.5;
      var p = pointFor(i, ratio);
      dataPoints.push({ p: p, score: score, max: meta.max });
      return p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');
    var color = (GRADE_BY_TONE[(data.grade || {}).tone] || {}).color || '#6366f1';
    var markers = dataPoints.map(function (d) {
      return '<circle cx="' + d.p.x.toFixed(1) + '" cy="' + d.p.y.toFixed(1) + '" r="4" fill="' + color + '" stroke="#fff" stroke-width="1.5"></circle>';
    }).join('');
    var scoreLabels = dataPoints.map(function (d) {
      // 점 바로 위/아래에 "점수/만점" 표시 - 축이 위쪽(0번)이면 라벨을 점 위로, 그 외엔
      // 중심에서 바깥쪽으로 약간 띄워 라인/축과 안 겹치게 한다.
      var dy = d.p.y < cy ? -9 : 13;
      return '<text x="' + d.p.x.toFixed(1) + '" y="' + (d.p.y + dy).toFixed(1) + '" class="mt-radar-score" text-anchor="middle">' + d.score + '</text>';
    }).join('');

    return ''
      + '<div class="mt-card">'
      + '<div class="mt-card-title">🕸 시장 레이더 차트</div>'
      + '<svg class="mt-radar" viewBox="0 0 300 300">'
      + grid + axes
      + '<polygon points="' + dataPts + '" fill="' + color + '4D" stroke="' + color + '" stroke-width="2.5" class="mt-radar-data"></polygon>'
      + markers + scoreLabels
      + '</svg>'
      + '</div>';
  }

  // ---- ⑧ 오늘 투자전략 ----

  function buildStrategy(grade) {
    var s = STRATEGY_BY_TONE[grade.tone] || STRATEGY_BY_TONE.neutral;
    return ''
      + '<div class="mt-strategy-panel">'
      + '<div class="mt-strategy-panel-title">🎯 오늘의 전략</div>'
      + '<div class="mt-strategy-action ' + s.actionTone + '">' + escapeHtml(s.action) + '</div>'
      + '<div class="mt-strategy-bars">'
      + '<div class="mt-strategy-bar-row"><span>주식비중</span><div class="mt-strategy-bar"><div class="mt-strategy-bar-fill" style="width:' + s.stock + '%;background:' + grade.color + '"></div></div><b>' + s.stock + '%</b></div>'
      + '<div class="mt-strategy-bar-row"><span>현금</span><div class="mt-strategy-bar"><div class="mt-strategy-bar-fill mt-strategy-bar-cash" style="width:' + s.cash + '%"></div></div><b>' + s.cash + '%</b></div>'
      + '</div>'
      + '<div class="mt-strategy-note">⚠ ' + escapeHtml(s.note) + '</div>'
      + '</div>';
  }

  function buildBriefingStrategy(grade) {
    return '<div class="mt-section mt-card mt-briefing-strategy-card">'
      + '<div class="mt-briefing-strategy-grid">'
      + buildAiBriefingShell()
      + buildStrategy(grade)
      + '</div>'
      + '</div>';
  }

  // ---- ⑨ 온도 기준표(카드형) ----

  function buildGuide() {
    // 2026-07-19: 온도(range)/설명(label)/별점(stars) 3줄이 카드마다 세로로 길어 보인다는
    // 피드백 - 설명을 1번째 줄, 온도+별점을 한 줄로 묶어 2번째 줄로 통일(3줄->2줄).
    var cards = GRADE_BANDS.map(function (b, i) {
      var stars = '★'.repeat(5 - i) + '<span class="mt-guide-stars-empty">' + '★'.repeat(i) + '</span>';
      return '<div class="mt-guide-card mt-guide-card-' + escapeHtml(b.tone) + '" style="--mt-guide-color:' + b.color + ';border-color:' + b.color + '55">'
        + '<div class="mt-guide-season"><span class="mt-guide-season-emoji">' + escapeHtml(b.seasonEmoji) + '</span><span>' + escapeHtml(b.season) + '</span></div>'
        + '<div class="mt-guide-card-label">' + escapeHtml(b.emoji) + ' ' + escapeHtml(b.label) + '</div>'
        + '<div class="mt-guide-card-meta">'
        + '<span class="mt-guide-card-range" style="color:' + b.color + '">' + b.range + '</span>'
        + '<span class="mt-guide-card-stars" style="color:' + b.color + '">' + stars + '</span>'
        + '</div>'
        + '</div>';
    }).join('');
    return ''
      + '<div class="mt-section mt-card">'
      + '<div class="mt-guide-grid-cards">' + cards + '</div>'
      + '</div>';
  }

  // "오늘의 증시온도" 박스(9개 지표 바 포함)와는 별개의 아래쪽 박스 - 종목을 살펴보는
  // 3가지 방법(카드 보기: 섹터별 카드, 히트맵 보기: 섹터 풀 등락률 히트맵, 시총비례 히트맵:
  // 트리맵)을 탭으로 전환한다. 셋 다 js/sector-dashboard-v4.js·js/marketcap-bubble.js를
  // 그대로 재사용(로직 복붙 없음) - sectors-v3.js/krx_map.js/sector-dashboard-v4.js/
  // marketcap-codes.js/marketcap-bubble.js가 이 페이지에 함께 로드돼 있어야 동작한다.
  // 탭은 최초 활성화 시에만 로드한다(foreign-flow.js의 wireViewTabs와 동일 패턴 - hidden
  // 상태에서 차트를 그리면 크기가 0이 되는 문제를 피하기 위해 보여진 뒤에 그린다).
  var VIEW_TABS = [
    { key: 'cards', label: '카드 보기' },
    { key: 'heatmap', label: '히트맵 보기' },
    { key: 'marketcap', label: '시총비례 히트맵' }
  ];

  function buildExploreCard(initialView) {
    initialView = initialView || 'cards';
    var toggleHtml = '<div class="mt-view-toggle">' + VIEW_TABS.map(function (t) {
      return '<button type="button" class="mt-view-btn' + (t.key === initialView ? ' active' : '') + '" data-view="' + t.key + '">' + escapeHtml(t.label) + '</button>';
    }).join('') + '</div>';
    return ''
      + '<div class="mt-card mt-explore-card">'
      + toggleHtml
      + '<div class="mt-view-panels">'
      + '<div class="mt-view-panel" data-view-panel="cards"' + (initialView === 'cards' ? '' : ' hidden') + '></div>'
      + '<div class="mt-view-panel" data-view-panel="heatmap"' + (initialView === 'heatmap' ? '' : ' hidden') + '></div>'
      + '<div class="mt-view-panel" data-view-panel="marketcap"' + (initialView === 'marketcap' ? '' : ' hidden') + '></div>'
      + '</div>'
      + '</div>';
  }

  // 섹터 풀(SECTOR_MAP) 전체 종목 코드를 모아 시세를 한 번에 조회 - 카드 보기/히트맵 보기가
  // 공유하는 헬퍼(SD.renderCardsHtml/renderHeatmapHtml 둘 다 이 codes 목록이 필요).
  function fetchDefaultSectorConfig_() {
    return fetch(SECTOR_CARDS_API_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('sector config HTTP ' + r.status);
        return r.json();
      })
      .then(function (body) {
        if (!body || !body.data || !body.data.sectors) throw new Error('invalid sector config');
        return body.data;
      })
      .catch(function (err) {
        // The static sector file remains a safe read-only fallback while the VM
        // deploys the new /sector-cards endpoint or during a transient outage.
        if (global.SECTOR_MAP && typeof global.SECTOR_MAP === 'object') {
          return {
            sectors: global.SECTOR_MAP,
            revision: 0,
            editable: false
          };
        }
        throw err;
      });
  }

  function readLocalSectorConfig_() {
    try {
      var value = JSON.parse(localStorage.getItem(LOCAL_SECTOR_CARDS_KEY) || 'null');
      if (value && value.sectors && typeof value.sectors === 'object') {
        return { sectors: value.sectors, revision: 0, updatedAt: value.updatedAt || null, customized: true, localOnly: true };
      }
    } catch (err) { /* 손상된 브라우저 저장값은 공용 기본값으로 안전하게 폴백 */ }
    return null;
  }

  function writeLocalSectorConfig_(sectors) {
    var saved = { sectors: cloneSectorMap_(sectors), updatedAt: new Date().toISOString() };
    try { localStorage.setItem(LOCAL_SECTOR_CARDS_KEY, JSON.stringify(saved)); } catch (err) { /* ignore */ }
    return { sectors: saved.sectors, revision: 0, updatedAt: saved.updatedAt, customized: true, localOnly: true };
  }

  function clearLocalSectorConfig_() {
    try { localStorage.removeItem(LOCAL_SECTOR_CARDS_KEY); } catch (err) { /* ignore */ }
  }

  function fetchUserSectorConfig_() {
    return fetch(USER_SECTOR_CARDS_API_URL, { credentials: 'include', cache: 'no-store' })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.detail || '개인 카드 설정을 불러오지 못했습니다.');
          return body.data;
        });
      });
  }

  function saveUserSectorConfig_(sectors, revision) {
    return fetch(USER_SECTOR_CARDS_API_URL, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectors: sectors, revision: revision })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.detail || '개인 카드 설정 저장에 실패했습니다.');
        return body.data;
      });
    });
  }

  function fetchSectorConfig_() {
    if (sectorConfigPromise) return sectorConfigPromise;
    var localConfig = readLocalSectorConfig_();
    sectorConfigPromise = Promise.all([fetchDefaultSectorConfig_(), fetchGoogleAuth_()])
      .then(function (values) {
        var defaultConfig = values[0];
        var authState = values[1];
        if (!authState.configured || !authState.authenticated) return localConfig || defaultConfig;
        return fetchUserSectorConfig_().then(function (userConfig) {
          // 로그인 전에 만든 브라우저 편집본은 계정에 아직 편집본이 없을 때만 1회 이관한다.
          if (!userConfig.customized && localConfig) {
            return saveUserSectorConfig_(localConfig.sectors, 0).then(function (saved) {
              clearLocalSectorConfig_();
              return saved;
            });
          }
          return userConfig;
        }).catch(function () {
          return {
            sectors: defaultConfig.sectors,
            revision: 0,
            updatedAt: null,
            customized: false,
            defaultRevision: defaultConfig.revision || 0
          };
        });
      })
      .catch(function (err) {
        sectorConfigPromise = null;
        throw err;
      });
    return sectorConfigPromise;
  }

  function invalidateSectorConfig_() {
    sectorConfigPromise = null;
  }

  function cloneSectorMap_(sectorMap) {
    return JSON.parse(JSON.stringify(sectorMap || {}));
  }

  function stockOptionsHtml_() {
    var map = global.KRX_MAP || {};
    return Object.keys(map).map(function (name) {
      return '<option value="' + escapeHtml(name) + '" label="' + escapeHtml(map[name]) + '"></option>';
    }).join('');
  }

  function resolveStockInput_(value) {
    var query = String(value || '').trim().toUpperCase();
    var map = global.KRX_MAP || {};
    if (!query) return null;
    var names = Object.keys(map);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      var code = String(map[name] || '').toUpperCase();
      if (name.toUpperCase() === query || code === query) {
        return { name: name, code: code, market: 'KOSPI' };
      }
    }
    return null;
  }

  function fetchGoogleAuth_() {
    return fetch(GOOGLE_AUTH_ME_URL, { credentials: 'include', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('auth status HTTP ' + response.status);
        return response.json();
      })
      .then(function (body) {
        return body && body.data ? body.data : { configured: false, authenticated: false, isAdmin: false };
      })
      .catch(function () {
        // Keep the legacy token UI available until the VM OAuth settings are deployed.
        return { configured: false, authenticated: false, isAdmin: false };
      });
  }

  function buildSectorEditorHtml_(sectorMap, authState) {
    var googleAuthConfigured = !!(authState && authState.configured);
    var authControls = googleAuthConfigured
      ? '<div class="mt-sector-editor-auth"><span>' +
        (authState.authenticated
          ? 'Google: ' + escapeHtml(authState.email || '') + ' · 내 설정으로 저장'
          : '로그인 전에는 이 브라우저에만 저장됩니다.') +
        '</span>' +
        (authState.authenticated
          ? '<button type="button" data-editor-action="google-logout">로그아웃</button>'
          : '<button type="button" data-editor-action="google-login">Google로 로그인</button>') +
        '</div>'
      : '<div class="mt-sector-editor-auth"><span>이 브라우저에만 저장됩니다.</span></div>';
    var categories = Object.keys(sectorMap);
    var rows = categories.map(function (category, categoryIndex) {
      var stocks = Array.isArray(sectorMap[category]) ? sectorMap[category] : [];
      var stockRows = stocks.map(function (stock, stockIndex) {
        return '<div class="mt-sector-editor-stock" data-stock-index="' + stockIndex + '">' +
          '<input data-editor-role="stock-name" list="mt-sector-stock-names" value="' + escapeHtml(stock.name || '') + '" placeholder="종목명">' +
          '<input data-editor-role="stock-code" value="' + escapeHtml(stock.code || '') + '" placeholder="종목코드" maxlength="6">' +
          '<select data-editor-role="stock-market">' +
            '<option value="KOSPI"' + (stock.market === 'KOSPI' ? ' selected' : '') + '>KOSPI</option>' +
            '<option value="KOSDAQ"' + (stock.market === 'KOSDAQ' ? ' selected' : '') + '>KOSDAQ</option>' +
          '</select>' +
          '<button type="button" data-editor-action="delete-stock">삭제</button>' +
        '</div>';
      }).join('');
      return '<section class="mt-sector-editor-category" data-category-index="' + categoryIndex + '">' +
        '<div class="mt-sector-editor-category-head">' +
          '<input data-editor-role="category-name" value="' + escapeHtml(category) + '" aria-label="카테고리명">' +
          '<span class="mt-sector-editor-category-count">' + stocks.length + '종목</span>' +
          '<button type="button" class="mt-sector-editor-toggle" data-editor-action="toggle-category" aria-expanded="true">접기</button>' +
          '<button type="button" data-editor-action="delete-category">카테고리 삭제</button>' +
        '</div>' +
        '<div class="mt-sector-editor-stock-labels" aria-hidden="true"><span>종목명</span><span>종목코드</span><span>시장</span><span></span></div>' +
        '<div class="mt-sector-editor-stocks">' + stockRows + '</div>' +
        '<div class="mt-sector-editor-add-stock">' +
          '<label for="mt-sector-stock-search-' + categoryIndex + '">종목 추가</label>' +
          '<div class="mt-sector-editor-add-stock-box">' +
            '<input id="mt-sector-stock-search-' + categoryIndex + '" data-editor-role="stock-search" list="mt-sector-stock-names" placeholder="종목명 또는 6자리 코드 입력" autocomplete="off">' +
            '<select data-editor-role="stock-add-market" aria-label="추가할 종목 시장"><option value="KOSPI">KOSPI</option><option value="KOSDAQ">KOSDAQ</option></select>' +
            '<button type="button" class="mt-sector-editor-add-stock-button" data-editor-action="add-stock">＋ 추가</button>' +
          '</div>' +
          '<small>검색 결과를 선택하거나 종목코드를 입력한 뒤 추가하세요.</small>' +
        '</div>' +
      '</section>';
    }).join('');

    return '<div class="mt-sector-editor">' +
      '<div class="mt-sector-editor-head"><div><strong>카테고리·종목 편집</strong><span>작은 입력칸에서 종목을 검색해 추가하고, 아래 목록에서 삭제한 뒤 저장하세요.</span></div>' +
        '<div class="mt-sector-editor-head-actions"><button type="button" data-editor-action="collapse-all">전체 접기</button><button type="button" data-editor-action="expand-all">전체 펼치기</button></div></div>' +
      '<datalist id="mt-sector-stock-names">' + stockOptionsHtml_() + '</datalist>' +
      '<div class="mt-sector-editor-categories">' + rows + '</div>' +
      '<div class="mt-sector-editor-actions">' +
        '<button type="button" data-editor-action="add-category">+ 카테고리 추가</button>' +
        authControls +
        '<button type="button" data-editor-action="reset">기본 카드로 되돌리기</button>' +
        '<button type="button" class="primary" data-editor-action="save">저장</button>' +
        '<button type="button" data-editor-action="cancel">취소</button>' +
      '</div>' +
      '<div class="mt-sector-editor-message" data-editor-role="message"></div>' +
    '</div>';
  }

  function collectSectorMapFromEditor_(root, allowIncomplete) {
    var result = {};
    root.querySelectorAll('.mt-sector-editor-category').forEach(function (categoryEl) {
      var nameEl = categoryEl.querySelector('[data-editor-role="category-name"]');
      var name = (nameEl && nameEl.value || '').trim();
      if (!name) throw new Error('카테고리명을 입력하세요.');
      if (result[name]) throw new Error('카테고리명이 중복됩니다: ' + name);
      var stocks = [];
      categoryEl.querySelectorAll('.mt-sector-editor-stock').forEach(function (stockEl) {
        var stockName = (stockEl.querySelector('[data-editor-role="stock-name"]').value || '').trim();
        var code = (stockEl.querySelector('[data-editor-role="stock-code"]').value || '').trim().toUpperCase();
        var market = stockEl.querySelector('[data-editor-role="stock-market"]').value;
        if (!stockName || !/^[0-9A-Z]{6}$/.test(code)) {
          if (allowIncomplete) {
            stocks.push({ name: stockName, code: code, market: market });
            return;
          }
          throw new Error('종목명과 6자리 종목코드를 확인하세요.');
        }
        if (code && stocks.some(function (stock) { return stock.code === code; })) {
          throw new Error(name + ' 카테고리에 같은 종목이 중복됩니다: ' + code);
        }
        stocks.push({ name: stockName, code: code, market: market });
      });
      result[name] = stocks;
    });
    if (!allowIncomplete && !Object.keys(result).length) throw new Error('카테고리를 하나 이상 남겨두세요.');
    return result;
  }

  function renderSectorEditor_(panel, sectorMap, revision, onSaved) {
    var model = cloneSectorMap_(sectorMap);
    var authState = { configured: false, authenticated: false, isAdmin: false };
    var authReady = false;
    var rerender = function () {
      panel.innerHTML = authReady
        ? buildSectorEditorHtml_(model, authState)
        : '<div class="mt-hint">카드 설정을 확인하는 중...</div>';
    };
    var setMessage = function (text, isError) {
      var message = panel.querySelector('[data-editor-role="message"]');
      if (message) { message.textContent = text; message.className = 'mt-sector-editor-message' + (isError ? ' error' : ''); }
    };

    fetchGoogleAuth_().then(function (nextAuthState) {
      authState = nextAuthState;
      authReady = true;
      rerender();
    });
    var setCategoryCollapsed = function (categoryEl, collapsed) {
      categoryEl.classList.toggle('is-collapsed', collapsed);
      var toggle = categoryEl.querySelector('[data-editor-action="toggle-category"]');
      if (toggle) {
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.textContent = collapsed ? '펼치기' : '접기';
      }
    };
    panel.onclick = function (event) {
      var actionEl = event.target.closest('[data-editor-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-editor-action');
      try {
        if (action === 'google-login') {
          window.location.href = GOOGLE_AUTH_START_URL + '?return_to=' + encodeURIComponent(window.location.href);
        } else if (action === 'google-logout') {
          window.location.href = GOOGLE_AUTH_LOGOUT_URL + '?return_to=' + encodeURIComponent(window.location.href);
        } else if (action === 'toggle-category') {
          var categoryEl = actionEl.closest('.mt-sector-editor-category');
          setCategoryCollapsed(categoryEl, !categoryEl.classList.contains('is-collapsed'));
        } else if (action === 'collapse-all' || action === 'expand-all') {
          var shouldCollapse = action === 'collapse-all';
          panel.querySelectorAll('.mt-sector-editor-category').forEach(function (categoryEl) {
            setCategoryCollapsed(categoryEl, shouldCollapse);
          });
        } else if (action === 'add-category') {
          model = collectSectorMapFromEditor_(panel, true);
          var base = '새 카테고리';
          var name = base;
          var count = 2;
          while (model[name]) name = base + ' ' + count++;
          model[name] = [];
          rerender();
        } else if (action === 'delete-category') {
          model = collectSectorMapFromEditor_(panel, true);
          var categoryEl = actionEl.closest('.mt-sector-editor-category');
          var categoryIndex = Number(categoryEl.getAttribute('data-category-index'));
          var categoryName = Object.keys(model)[categoryIndex];
          delete model[categoryName];
          rerender();
        } else if (action === 'add-stock') {
          model = collectSectorMapFromEditor_(panel, true);
          var targetEl = actionEl.closest('.mt-sector-editor-category');
          var targetIndex = Number(targetEl.getAttribute('data-category-index'));
          var targetName = Object.keys(model)[targetIndex];
          var searchEl = targetEl.querySelector('[data-editor-role="stock-search"]');
          var stock = resolveStockInput_(searchEl && searchEl.value);
          if (!stock) throw new Error('종목명 또는 6자리 종목코드를 검색 결과에서 선택하세요.');
          var marketEl = targetEl.querySelector('[data-editor-role="stock-add-market"]');
          if (marketEl) stock.market = marketEl.value;
          if (model[targetName].some(function (item) { return item && item.code === stock.code; })) {
            throw new Error(targetName + ' 카테고리에 이미 있는 종목입니다.');
          }
          model[targetName].push(stock);
          rerender();
        } else if (action === 'delete-stock') {
          model = collectSectorMapFromEditor_(panel, true);
          var stockCategoryEl = actionEl.closest('.mt-sector-editor-category');
          var stockEl = actionEl.closest('.mt-sector-editor-stock');
          var stockCategoryIndex = Number(stockCategoryEl.getAttribute('data-category-index'));
          var stockIndex = Number(stockEl.getAttribute('data-stock-index'));
          var stockCategoryName = Object.keys(model)[stockCategoryIndex];
          model[stockCategoryName].splice(stockIndex, 1);
          rerender();
        } else if (action === 'cancel') {
          if (onSaved && onSaved.cancel) onSaved.cancel();
        } else if (action === 'reset') {
          setMessage('기본 카드로 되돌리는 중...', false);
          var resetPromise;
          if (authState.configured && authState.authenticated) {
            resetPromise = fetch(USER_SECTOR_CARDS_API_URL, {
              method: 'DELETE', credentials: 'include'
            }).then(function (response) {
              return response.json().then(function (body) {
                if (!response.ok) throw new Error(body.detail || '기본 카드로 되돌리지 못했습니다.');
                return body.data;
              });
            });
          } else {
            clearLocalSectorConfig_();
            resetPromise = fetchDefaultSectorConfig_();
          }
          resetPromise.then(function (data) {
            clearLocalSectorConfig_();
            invalidateSectorConfig_();
            if (typeof onSaved === 'function') onSaved(data);
            else if (onSaved && onSaved.saved) onSaved.saved(data);
          }).catch(function (error) {
            setMessage(error.message || '기본 카드로 되돌리지 못했습니다.', true);
          });
        } else if (action === 'save') {
          var sectors = collectSectorMapFromEditor_(panel);
          var savePromise;
          if (authState.configured && authState.authenticated) {
            savePromise = saveUserSectorConfig_(sectors, revision);
          } else {
            savePromise = Promise.resolve(writeLocalSectorConfig_(sectors));
          }
          setMessage('저장 중...', false);
          savePromise.then(function (saved) {
            invalidateSectorConfig_();
            if (typeof onSaved === 'function') onSaved(saved);
            else if (onSaved && onSaved.saved) onSaved.saved(saved);
          }).catch(function (error) {
            setMessage(error.message || '저장에 실패했습니다.', true);
          });
        }
      } catch (error) {
        setMessage(error.message || '입력값을 확인하세요.', true);
      }
    };
    panel.onchange = function (event) {
      if (!event.target.matches('[data-editor-role="stock-name"]')) return;
      var code = (global.KRX_MAP || {})[event.target.value.trim()];
      if (code) {
        var row = event.target.closest('.mt-sector-editor-stock');
        row.querySelector('[data-editor-role="stock-code"]').value = code;
      }
    };
    panel.onkeydown = function (event) {
      if (event.key !== 'Enter' || !event.target.matches('[data-editor-role="stock-search"]')) return;
      event.preventDefault();
      var addButton = event.target.closest('.mt-sector-editor-add-stock-box').querySelector('[data-editor-action="add-stock"]');
      if (addButton) addButton.click();
    };
  }

  function sectorPoolCodes(sectorMap, krxMap) {
    var codes = [];
    Object.keys(sectorMap).forEach(function (sector) {
      sectorMap[sector].forEach(function (item) {
        var code = item && typeof item === 'object' ? item.code : krxMap[item];
        if (code && codes.indexOf(code) === -1) codes.push(code);
      });
    });
    return codes;
  }

  function renderCardsPanelFromConfig_(panel, SD, config) {
    var sectorMap = config.sectors;
    var krxMap = global.KRX_MAP || {};
    var codes = sectorPoolCodes(sectorMap, krxMap);
    if (!codes.length) throw new Error('empty sector config');
    return SD.fetchTickerData(codes).then(function (list) {
      var byCode = {};
      (list || []).forEach(function (item) { if (item && item.code) byCode[item.code] = item; });
      if (SD.injectBadgeStyles) SD.injectBadgeStyles();
      var html = SD.renderCardsHtml(sectorMap, krxMap, byCode);
      var cardState = config.customized
        ? (config.localOnly ? '편집됨 · 이 브라우저에 저장됨' : '편집됨 · Google 계정에 저장됨')
        : '편집 대기 · 기본 카드';
      var cardStateClass = config.customized ? ' is-edited' : ' is-pending';
      var toolbar = '<div class="mt-sector-toolbar"><span class="mt-sector-config-status' + cardStateClass + '">' + escapeHtml(cardState) + '</span>' +
        '<span class="mt-card-realtime-status" data-card-realtime-status>실시간 연결 중</span>' +
        '<button type="button" data-sector-editor-open>카테고리·종목 편집</button></div>';
      panel.innerHTML = toolbar + (html ? '<div class="sector-cards-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>');
      // 2026-08-20: 카드 보기는 이 최초 GAS 배치 조회 이후로 갱신이 없었다 - 실시간 체결가
      // WebSocket(SD.startCardRealtimeQuotes)을 구독해 가격·등락률을 계속 최신으로 유지한다.
      if (SD.startCardRealtimeQuotes) SD.startCardRealtimeQuotes(panel, codes);
      function wireEditor() {
        var editButton = panel.querySelector('[data-sector-editor-open]');
        if (editButton) editButton.addEventListener('click', function () {
          renderSectorEditor_(panel, sectorMap, config.revision, {
            cancel: function () { panel.__mtLoaded = false; loadCardsPanel(panel); },
            saved: function () { invalidatePersonalHeatmap_(panel); panel.__mtLoaded = false; loadCardsPanel(panel); }
          });
        });
      }
      wireEditor();
      if (SD.wireSectorCardSelection) SD.wireSectorCardSelection(panel, sectorMap, krxMap, byCode, wireEditor);
    });
  }

  function renderHeatmapPanelFromConfig_(panel, SD, config) {
    var sectorMap = config.sectors;
    var krxMap = global.KRX_MAP || {};
    var codes = sectorPoolCodes(sectorMap, krxMap);
    if (!codes.length) throw new Error('empty sector config');
    return SD.fetchTickerData(codes).then(function (list) {
      var byCode = {};
      (list || []).forEach(function (item) { if (item && item.code) byCode[item.code] = item; });
      var html = SD.renderHeatmapHtml(sectorMap, krxMap, byCode);
      panel.innerHTML = html ? '<div class="heatmap-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>';
    });
  }

  // 카드 편집과 일반 히트맵은 같은 개인 섹터 구성을 사용한다. 이미 열어둔 히트맵도
  // 저장 직후 다음 탭 전환에서 새 구성으로 다시 그리게 한다. 시총비례 히트맵은 시장
  // 전체 고정 종목 풀과 실제 시가총액을 쓰므로 개인 카드 편집 대상이 아니다.
  function invalidatePersonalHeatmap_(panel) {
    var root = panel && panel.closest('.mt-explore-card');
    var heatmapPanel = root && root.querySelector('[data-view-panel="heatmap"]');
    if (!heatmapPanel) return;
    heatmapPanel.__mtLoaded = false;
    heatmapPanel.innerHTML = '';
  }

  function loadCardsPanel(panel) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    var SD = global.SectorDashboard;
    if (SD) {
      panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>종목 카드 불러오는 중...</div>';
      fetchSectorConfig_()
        .then(function (config) { return renderCardsPanelFromConfig_(panel, SD, config); })
        .catch(function () { panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>'; });
      return;
    }
    var sectorMap = global.SECTOR_MAP;
    if (!SD || !sectorMap) {
      panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>';
      return;
    }
    var krxMap = global.KRX_MAP || {};
    var codes = sectorPoolCodes(sectorMap, krxMap);
    if (!codes.length) { panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>'; return; }

    if (SD.injectBadgeStyles) SD.injectBadgeStyles();
    panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>종목 카드 불러오는 중...</div>';
    SD.fetchTickerData(codes).then(function (list) {
      var byCode = {};
      (list || []).forEach(function (item) { if (item && item.code) byCode[item.code] = item; });
      var html = SD.renderCardsHtml(sectorMap, krxMap, byCode);
      panel.innerHTML = html ? '<div class="mt-sector-toolbar"><span>기본 카드</span><span class="mt-card-realtime-status" data-card-realtime-status>실시간 연결 중</span></div><div class="sector-cards-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>';
      if (SD.startCardRealtimeQuotes) SD.startCardRealtimeQuotes(panel, codes);
      if (SD.wireSectorCardSelection) SD.wireSectorCardSelection(panel, sectorMap, krxMap, byCode);
    }).catch(function () {
      panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>';
    });
  }

  function loadHeatmapPanel(panel) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    var SD = global.SectorDashboard;
    if (SD) {
      panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>히트맵 불러오는 중...</div>';
      fetchSectorConfig_()
        .then(function (config) { return renderHeatmapPanelFromConfig_(panel, SD, config); })
        .catch(function () { panel.innerHTML = '<div class="mt-error">히트맵을 불러오지 못했습니다.</div>'; });
      return;
    }
    var sectorMap = global.SECTOR_MAP;
    if (!SD || !sectorMap) {
      panel.innerHTML = '<div class="mt-error">히트맵을 불러오지 못했습니다.</div>';
      return;
    }
    var krxMap = global.KRX_MAP || {};
    var codes = sectorPoolCodes(sectorMap, krxMap);
    if (!codes.length) { panel.innerHTML = '<div class="mt-error">히트맵을 불러오지 못했습니다.</div>'; return; }

    panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>히트맵 불러오는 중...</div>';
    SD.fetchTickerData(codes).then(function (list) {
      var byCode = {};
      (list || []).forEach(function (item) { if (item && item.code) byCode[item.code] = item; });
      var html = SD.renderHeatmapHtml(sectorMap, krxMap, byCode);
      panel.innerHTML = html ? '<div class="heatmap-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>';
    }).catch(function () {
      panel.innerHTML = '<div class="mt-error">히트맵을 불러오지 못했습니다.</div>';
    });
  }

  // marketcap-bubble.js가 처음부터 페이지에 로드돼 있어도 #marketcap-bubble이 없으면
  // 자체 DOMContentLoaded 초기화가 조용히 no-op하므로, 탭이 열려 컨테이너가 생긴 뒤
  // 여기서 직접 init()을 호출해준다.
  function loadMarketcapPanel(panel) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    if (!global.MarketcapBubble) {
      panel.innerHTML = '<div class="mt-error">시총비례 히트맵을 불러오지 못했습니다.</div>';
      return;
    }
    panel.innerHTML = '<div id="marketcap-bubble"></div>';
    try {
      global.MarketcapBubble.init();
    } catch (error) {
      panel.innerHTML = '<div class="mt-error">시총비례 히트맵을 불러오지 못했습니다.</div>';
    }
  }

  function loadPanel(view, panel) {
    if (view === 'cards') loadCardsPanel(panel);
    else if (view === 'heatmap') loadHeatmapPanel(panel);
    else if (view === 'marketcap') loadMarketcapPanel(panel);
  }

  function wireViewTabs(container) {
    var buttons = container.querySelectorAll('.mt-view-btn');
    var panels = {};
    container.querySelectorAll('[data-view-panel]').forEach(function (p) {
      panels[p.getAttribute('data-view-panel')] = p;
    });
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        buttons.forEach(function (b) { b.classList.toggle('active', b === btn); });
        Object.keys(panels).forEach(function (key) { panels[key].hidden = key !== view; });
        loadPanel(view, panels[view]);
      });
    });
    // 기본 활성 탭(카드 보기)은 클릭 없이도 바로 보여야 하니 최초 1회는 직접 로드해준다.
    var initial = container.querySelector('.mt-view-btn.active');
    var initialView = initial ? initial.getAttribute('data-view') : 'cards';
    if (panels[initialView]) loadPanel(initialView, panels[initialView]);
  }

  function buildCard(data) {
    // 서버(GAS gradeForTemp_)가 내려주는 grade에는 color가 없다(색상 스펙은 클라이언트
    // GRADE_BANDS/GRADE_BY_TONE에만 있음) - data.grade 자체에 색을 주입해서 buildHero(data)/
    // buildStrategy(grade) 등 이 값을 각자 다시 읽는 모든 함수가 동일하게 정확한 색을 쓰게
    // 한다(2026-07-18 발견 - 이 주입이 빠져서 오늘의 전략 진행바가 폭은 맞는데 색이
    // undefined라 안 보이는 버그가 있었음).
    if (!data.grade) data.grade = { emoji: '', label: '', tone: 'neutral' };
    data.grade.color = (GRADE_BY_TONE[data.grade.tone] || GRADE_BY_TONE.neutral).color;
    var grade = data.grade;
    var tone = grade.tone || 'neutral';

    // 2026-07-18 2차 개편: 세로로 나열하던 섹션을 연관 정보끼리 묶어 가로 배치(사용자 요청
    // - "관련 있는 정보는 하나의 카드로 묶는다", "한 줄에 2개 배치 가능한 영역은 최대한
    // 2개 배치"). row2col()은 두 카드를 .mt-row-2col grid로 감싸 좌우 50:50 배치하고(모바일
    // 640px 이하에서는 1열로 자동 스택), 페이드인 애니메이션 대상(.mt-section)은 이 wrapper
    // 하나에만 붙인다.
    function row2col(a, b) { return '<div class="mt-section mt-row-2col">' + a + b + '</div>'; }

    var sections = [
      buildHeroCard(data),                          // ① 오늘의 온도 | 최근 단기흐름
      row2col(buildBars(data), buildRadar(data)),   // ② 시장 구성요소 그래프 | 시장 레이더 (좌우)
      buildBriefingStrategy(grade),                 // ③ 시장 브리핑 + 오늘의 전략(마지막)
      '<div data-industry-flow></div>',             // ④ 업종 TOP 당일·전일 흐름
    ];

    return ''
      + '<div class="mt-wrap mt-tone-' + escapeHtml(tone) + '">'
      + sections.join('')
      + (data.updatedAt ? '<div class="mt-updated">🟢 실시간 · 업데이트 ' + escapeHtml(data.updatedAt) + '</div>' : '')
      + '</div>';
  }

  // ---- 애니메이션(count-up/게이지 스윕/진행바 채움/섹션 페이드인/스파크라인 draw) ----
  // 이 저장소 최초의 RAF 기반 count-up. 별도 라이브러리 없이 직접 구현(ease-out cubic).

  // rAF가 아예 안 도는 환경(백그라운드 탭 등)에서 숫자가 "0.0"(또는 중간값)에 멈춰있지
  // 않도록 setTimeout 안전장치를 같이 건다 - setTimeout은 백그라운드에서도 스로틀링만
  // 될 뿐 결국은 실행되므로(rAF는 아예 정지될 수 있는 것과 다름) durationMs 후에는
  // 무조건 정답값으로 고정된다.
  function countUp(el, target, durationMs) {
    var start = null;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.innerHTML = target.toFixed(1) + '<span class="mt-score-unit">℃</span>';
    }
    function tick(now) {
      if (done) return;
      if (start == null) start = now;
      var t = Math.min(1, (now - start) / durationMs);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
      else finish();
    }
    requestAnimationFrame(tick);
    setTimeout(finish, durationMs + 200);
  }

  function wireAnimations(container, data) {
    // 섹션 페이드인(순차 등장)
    var sections = container.querySelectorAll('.mt-section');
    sections.forEach(function (el, i) {
      el.style.animationDelay = (i * 0.06) + 's';
      el.classList.add('mt-fade-in');
    });

    // 게이지 마커/버블·진행바 스윕은 CSS @keyframes(mt-anim-left/mt-anim-width)로 처리되지만,
    // "animation:...both"는 문서 타임라인이 아예 안 도는 환경(rAF와 마찬가지로 백그라운드
    // 탭 등에서 실측 확인됨)에서 from 상태(0)에 영구히 멈춰 base inline left/width 값을
    // 계속 덮어쓴다 - setTimeout으로 애니메이션 클래스를 떼어내 base 값(이미 정답)이
    // 그대로 드러나게 하는 안전장치(countUp/스파크라인과 동일한 이유).
    setTimeout(function () {
      container.querySelectorAll('.mt-anim-left, .mt-anim-width').forEach(function (el) {
        el.classList.remove('mt-anim-left', 'mt-anim-width');
      });
    }, 900);

    // Hero 온도 count-up
    var scoreEl = container.querySelector('[data-count-target]');
    if (scoreEl) {
      var target = parseFloat(scoreEl.getAttribute('data-count-target'));
      if (!isNaN(target)) countUp(scoreEl, target, 800);
    }

    // 스파크라인 draw-on-load(stroke-dasharray 트릭). rAF가 안 도는 환경(백그라운드 탭 등)
    // 에서 선이 영원히 안 그려진 채로 남는 걸 막기 위해 setTimeout 안전장치를 같이 건다
    // (countUp과 동일한 이유 - 위 주석 참고).
    var sparkPaths = container.querySelectorAll('.mt-spark-draw');
    if (sparkPaths.length) {
      var revealed = false;
      function reveal() {
        if (revealed) return;
        revealed = true;
        sparkPaths.forEach(function (path) { path.style.strokeDashoffset = '0'; });
      }
      sparkPaths.forEach(function (path) {
        if (!path.getTotalLength) return;
        var len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
      });
      requestAnimationFrame(function () { requestAnimationFrame(reveal); });
      setTimeout(reveal, 1000);
    }

    wireHistoryPeriods(container, data);
    wireTooltipClamp(container);
  }

  // 2026-08-23: ⓘ 툴팁(.mt-info::after)이 아이콘 중앙 기준으로 고정폭(240px)만큼 좌우로
  // 펼쳐지는데, #market-temp 루트에 overflow-x:hidden이 걸려 있어(문서 전체 가로 스크롤
  // 방지용, 위 주석 참고) 그 박스 경계를 넘어가는 부분이 그대로 잘려 보이는 문제가 실측
  // 신고됨. 처음엔 아이콘 위치만 보고 좌우로 밀어주는 --mt-tip-shift만 뒀는데, 사용자가
  // "VIX뿐 아니라 전부 다 짤린다"고 재신고 - 위젯 박스 자체가 툴팁 고정폭(240px)보다
  // 좁은 화면(사이드바·좁은 본문 컬럼 등)에서는 밀어줄 여유 공간 자체가 없어(당시 코드는
  // 이 경우 아예 보정을 포기했음) 모든 행이 계속 잘렸던 것. 위치를 미는 것만으로는 부족해서
  // 박스 폭에 맞춰 툴팁 자체의 최대폭도 함께 줄이는 --mt-tip-maxw를 추가한다 - 이러면
  // 위젯이 아무리 좁아도(마진을 제외한 폭까지) 툴팁이 항상 박스 안에 들어간다.
  var TOOLTIP_MAX_WIDTH = 240; // css의 .mt-info::after max-width와 일치시킬 것
  var TOOLTIP_MIN_WIDTH = 120; // 이보다 더 줄이면 텍스트가 너무 잘게 쪼개져 가독성이 떨어짐
  var TOOLTIP_EDGE_MARGIN = 8;
  function wireTooltipClamp(container) {
    function clamp(icon) {
      // wireAnimations(container)에 넘어오는 container가 곧 #market-temp 루트 자체다.
      var boxRect = container.getBoundingClientRect();
      var iconRect = icon.getBoundingClientRect();
      var center = iconRect.left + iconRect.width / 2;
      var availableWidth = boxRect.width - TOOLTIP_EDGE_MARGIN * 2;
      var effectiveWidth = Math.max(TOOLTIP_MIN_WIDTH, Math.min(TOOLTIP_MAX_WIDTH, availableWidth));
      var halfWidth = effectiveWidth / 2;
      var minCenter = boxRect.left + TOOLTIP_EDGE_MARGIN + halfWidth;
      var maxCenter = boxRect.right - TOOLTIP_EDGE_MARGIN - halfWidth;
      var clampedCenter = maxCenter >= minCenter
        ? Math.min(Math.max(center, minCenter), maxCenter)
        : (boxRect.left + boxRect.right) / 2; // 박스가 최소폭보다도 좁으면 가운데 정렬로 최선 보정
      icon.style.setProperty('--mt-tip-shift', (clampedCenter - center) + 'px');
      icon.style.setProperty('--mt-tip-maxw', effectiveWidth + 'px');
    }
    container.addEventListener('mouseover', function (e) {
      var icon = e.target.closest && e.target.closest('.mt-info');
      if (icon) clamp(icon);
    });
    container.addEventListener('focusin', function (e) {
      var icon = e.target.closest && e.target.closest('.mt-info');
      if (icon) clamp(icon);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var MarketTemp = {
    init: init,
    fetchMarketTemp: fetchMarketTemp,
    fetchMarketTempBriefing: fetchMarketTempBriefing
  };
  global.MarketTemp = MarketTemp;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
