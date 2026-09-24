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
  // VM이 집계한 테마 흐름(증시온도 배경 계산의 238종목 재사용). 2026-09-01 이전에는
  // 아래 폴백만 썼는데, 거래대금 상위 30종목 중 17개가 ETF라 테마가 8개뿐이었다.
  var INDUSTRY_FLOW_URL = 'https://goodbyestar.cloud/industry-flow';
  var INDUSTRY_FLOW_FALLBACK_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=40';
  var INDUSTRY_TOP_LIMIT_ = 10;
  // 2026-09-01 사용자 요청("대표 종목이 너무 적어"). VM이 테마별로 최대 8종목을
  // 내려주므로 그대로 다 보여준다 - 매수 후보를 여기서 바로 훑을 수 있게.
  var REPRESENTATIVE_STOCK_LIMIT_ = 8;
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
    { key: 'flow', label: '수급(외국인+기관)', max: 20, unit: 'flow', icon: '🏦', barClass: 'mt-bar-flow', source: '코스피 시장 전체 최근 5일 수급',
      guide: '외국인 75% + 기관 25% 가중 순매수강도. 중립은 50%, 이를 20점으로 환산',
      // 2026-09-16: VM이 2026-09-01부터 KODEX 200 대리지표 대신 코스피 시장 전체 수급을 쓰는데
      // 화면 문구만 옛 출처로 남아 있었다(market_temp_data.flow_component_from_market_trend).
      desc: '코스피 시장 전체 최근 5일 순매수를 20일 평균과 비교, 외국인 75%+기관 25% 가중합산' },
    { key: 'tradingValue', label: '거래대금', max: 15, unit: 'pct', icon: '📊', barClass: 'mt-bar-vol', source: '섹터 풀 실시간 시세',
      guide: '기준 대비 130% 이상=15점 · 110~130%=11점 · 90~110%=7점 · 70~90%=4점 · 70% 미만=0점',
      // 2026-09-07: 장중에는 "직전 5거래일의 같은 시각까지 누적"이 기준이다. 예전엔 장중
      // 누적을 종일 총액 평균과 비교해서(분자만 그 시각까지) 오전 내내 0점이 박혔다.
      desc: '섹터 풀 종목 거래대금 합계를 직전 5거래일의 같은 시각까지 누적과 비교(장 마감 후에는 종일 총액끼리). 평소보다 활발하면 가점' },
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
  // 2026-09-22: season/seasonEmoji(계절 표현)는 쓰던 곳(buildGuide, 미사용 죽은 코드)마저
  // 걷어냈다 - "날씨코너냐?" 피드백에 맞춰 이 위젯 전체에서 날씨 은유를 없앤다.
  var GRADE_BANDS = [
    { range: '0~10℃', emoji: '🧊', label: '극단적 공포', tone: 'extreme-fear', color: '#1565C0' },
    { range: '10~20℃', emoji: '🔵', label: '공포', tone: 'fear', color: '#42A5F5' },
    { range: '20~28℃', emoji: '🟡', label: '중립', tone: 'neutral', color: '#FFD54F' },
    { range: '28~35℃', emoji: '🟠', label: '탐욕', tone: 'greed', color: '#FB8C00' },
    { range: '35~40℃', emoji: '🔥', label: '극단적 탐욕', tone: 'extreme-greed', color: '#E53935' }
  ];
  var GRADE_BY_TONE = {};
  GRADE_BANDS.forEach(function (b) { GRADE_BY_TONE[b.tone] = b; });

  // 2026-09-16 사용자 지적("분할매수가 많은데, 보통 개미들은 분할매수 안 해", "현금이 30%? 나중에
  // 뭐하라고?"). 예전엔 역발상 5단계로 '적극 분할매수 · 주식 80%/현금 20%' 같은 기관식 비중표를 줬는데,
  // 이 사이트의 독자(개인 투자자)는 비중을 나눠 들고 있지 않아 행동으로 옮길 수가 없었다.
  // 종합점수 3등급(서버 grade3)에 맞춰 "해볼 것 / 참을 것"을 개인이 실제로 하는 행동으로 적는다.
  // 매수·매도 지시가 아니라 그런 분위기의 날 흔히 하는 실수를 막는 점검표다.
  var ANT_GUIDE_BY_TONE = {
    fear: {
      mood: '팔려는 사람이 더 많은 날',
      title: '겁날 때 서두르지 않기',
      short: '급하게 팔기 전에 이유부터 확인하고, 사고 싶던 종목이 얼마나 싸졌는지 보기',
      todo: ['내 종목이 왜 빠졌는지 뉴스·공시부터 확인', '평소 사고 싶던 종목이 얼마나 싸졌는지 보기', '미리 정해둔 손절 기준이 있다면 그 기준대로만'],
      avoid: ['무섭다고 한꺼번에 던지기', '빚(신용·미수)으로 물타기']
    },
    neutral: {
      mood: '뚜렷한 방향이 없는 날',
      title: '시장보다 종목 보기',
      short: '시장 전체 방향보다 돈이 몰리는 업종·종목을 확인',
      todo: ['아래 업종 TOP에서 돈 몰리는 업종 확인', '관심종목 차트·수급을 차분히 점검'],
      avoid: ['뉴스 하나에 급등주 따라 사기', '심심해서 하는 잦은 단타']
    },
    greed: {
      mood: '사려는 사람이 몰려 들뜬 날',
      title: '들뜰 때 한 발 물러서기',
      short: '급등주 추격은 참고, 수익 난 종목의 익절 기준 점검',
      todo: ['수익 난 종목의 목표가·익절 기준 다시 보기', '이미 많이 오른 종목은 쉬어갈 때까지 기다리기'],
      avoid: ['"나만 못 벌까" 조급한 추격 매수', '빚투·미수로 크게 베팅']
    }
  };

  // 서버 grade3(fear/neutral/greed)를 쓴다. 예전엔 옛 40℃ 온도의 5단계 grade로 행동을 정해
  // 종합점수 등급과 어긋날 수 있었다. 구버전 응답의 5단계 tone은 가까운 3등급으로 접는다.
  function crowdTone(data) {
    var tone = (data && data.grade3 && data.grade3.tone) || (data && data.grade && data.grade.tone) || 'neutral';
    if (tone === 'extreme-fear') return 'fear';
    if (tone === 'extreme-greed') return 'greed';
    return ANT_GUIDE_BY_TONE[tone] ? tone : 'neutral';
  }

  function antGuide(data) {
    var tone = crowdTone(data);
    var base = ANT_GUIDE_BY_TONE[tone];
    var axes = (data && data.axes) || {};
    var todo = base.todo.slice();
    var avoid = base.avoid.slice();
    var risk = Number(axes.risk && axes.risk.value);
    var money = Number(axes.money && axes.money.value);
    // 등급만 보면 매일 같은 문구다 - 축 값이 한쪽으로 치우친 날만 한 줄씩 덧붙인다.
    if (isFinite(risk) && risk >= 65) avoid.unshift('위험 신호(변동성·환율·빚투)가 높은 날 - 빚투·레버리지는 특히 금물');
    if (isFinite(money) && money < 35 && tone !== 'greed') todo.push('거래가 한산한 날이라 급한 결정은 하루 미뤄도 늦지 않음');
    return { tone: tone, mood: base.mood, title: base.title, short: base.short, todo: todo, avoid: avoid };
  }

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
        return {
          industry: row.industry,
          avgChangeRate: row.avg_change_rate,
          tradeAmount: row.trade_amount,
          riseRatio: row.rise_ratio,
          stocks: (row.stocks || []).slice(0, 3).map(function (stock) {
            return {
              code: stock.code,
              name: stock.name,
              price: stock.price,
              changeRate: stock.change_rate,
              tradeAmount: stock.trade_amount
            };
          })
        };
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
      var code = String(row && (row.code || row.stock_code || '') || '').trim();
      var name = String(row && (row.name || row.stock_name || '') || '').trim();
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
        groups[displayName] = { industry: displayName, stockCount: 0, rateTotal: 0, tradeAmount: 0, stocks: [] };
      }
      groups[displayName].stockCount += count;
      groups[displayName].rateTotal += rate * count;
      groups[displayName].tradeAmount += amount;
      if (code || name) {
        groups[displayName].stocks.push({
          code: code,
          name: name || code,
          price: row && row.price,
          change_rate: rate,
          trade_amount: amount
        });
      }
      totalTradeAmount += amount;
    });
    return Object.keys(groups).map(function (name) {
      var group = groups[name];
      return {
        industry: group.industry,
        stock_count: group.stockCount,
        avg_change_rate: group.stockCount ? group.rateTotal / group.stockCount : 0,
        trade_amount: group.tradeAmount,
        trade_share: totalTradeAmount ? group.tradeAmount / totalTradeAmount : 0,
        stocks: group.stocks.sort(function (a, b) {
          return Number(b.trade_amount) - Number(a.trade_amount);
        }).slice(0, 3)
      };
    }).sort(function (a, b) {
      return Number(b.trade_amount) - Number(a.trade_amount)
        || Number(b.avg_change_rate) - Number(a.avg_change_rate);
    });
  }

  // 2026-09-14 사용자 지적("순위가 왜 다 New야"): 순위 변화를 이 브라우저가 마지막으로 본
  // 날의 localStorage 스냅샷과만 비교해, 전날 이 페이지를 안 연 사람은 전부 NEW였다.
  // serverPrevious({date, ranks})가 오면 서버의 직전 거래일 순위를 쓰고, 없을 때(옛 VM
  // 응답·폴백 경로)만 예전 저장분으로 물러난다. 비교할 날 자체가 없으면 NEW 대신 '—'.
  function renderIndustryFlow_(mount, rows, dateKey, serverPrevious) {
    var previousByName = {};
    var hasBaseline = false;
    var rankBasisText;
    if (serverPrevious && serverPrevious.date && serverPrevious.ranks) {
      Object.keys(serverPrevious.ranks).forEach(function (name) {
        previousByName[name] = { rank: Number(serverPrevious.ranks[name]) };
      });
      hasBaseline = true;
      rankBasisText = '순위 변화는 직전 거래일(' + escapeHtml(String(serverPrevious.date).slice(5).replace('-', '/')) + ') 마지막 순위와 비교하며,';
    } else {
      var snapshots = readIndustryFlowSnapshots_();
      var previous = previousSnapshot_(snapshots, dateKey);
      previous.forEach(function (row, index) { previousByName[row.industry] = { rank: index + 1 }; });
      hasBaseline = previous.length > 0;
      rankBasisText = '순위 변화는 이 브라우저가 관측한 마지막 거래일과 비교하며,';
    }
    function stockPrice_(value) {
      var n = Number(value);
      return isFinite(n) && n > 0 ? Math.round(n).toLocaleString('ko-KR') + '원' : '-';
    }
    function stockRate_(value) {
      var n = Number(value);
      return isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '-';
    }
    function stockTone_(value) {
      var n = Number(value);
      return n > 0 ? 'is-up' : n < 0 ? 'is-down' : 'is-flat';
    }
    function representativeStocksHtml_(row, index) {
      var stocks = Array.isArray(row && row.stocks) ? row.stocks.slice(0, REPRESENTATIVE_STOCK_LIMIT_) : [];
      var stockHtml = stocks.map(function (stock) {
        var code = String(stock.code || '').trim();
        var name = String(stock.name || code || '-').trim();
        var rate = Number(stock.change_rate != null ? stock.change_rate : stock.changeRate);
        return '<a class="mt-industry-flow-stock" href="/page/stock-search?code=' + encodeURIComponent(code) + '&amp;name=' + encodeURIComponent(name) + '" aria-label="' + escapeHtml(name) + ' 실시간 시세 보기">'
          // 2026-09-13 사용자 요청: 종목명도 상승 빨강·하락 파랑으로(등락률과 같은 색).
          + '<span><b class="' + stockTone_(rate) + '">' + escapeHtml(name) + '</b><small>' + escapeHtml(code || '-') + '</small></span>'
          + '<span><strong>' + stockPrice_(stock.price) + '</strong><em class="' + stockTone_(rate) + '">' + stockRate_(rate) + '</em></span>'
          + '</a>';
      }).join('');
      return '<div id="mt-industry-detail-' + index + '" class="mt-industry-flow-detail" hidden>'
        + '<div class="mt-industry-flow-detail-head"><strong>대표 종목</strong><span>현재 거래대금 상위 · 누르면 실시간 시세</span></div>'
        + (stockHtml || '<div class="mt-industry-flow-detail-empty">대표 종목 데이터가 없습니다.</div>')
        + '</div>';
    }
    var shown = (rows || []).slice(0, INDUSTRY_TOP_LIMIT_);
    // 막대 길이는 1위 대비 비율이다. 거래대금은 조·억 단위가 섞여 나와서(8.6조 vs
    // 6946억 = 12배) 숫자만으로는 크기 차이가 안 잡힌다는 2026-09-01 사용자 지적에
    // 따라 추가했다. 호가창 막대와 같은 방식이라 화면 사이에서 읽는 법이 같다.
    var maxAmount = shown.reduce(function (max, row) {
      var v = Number(row.trade_amount != null ? row.trade_amount : row.tradeAmount);
      return isFinite(v) && v > max ? v : max;
    }, 0);

    var html = shown.map(function (row, index) {
      var old = previousByName[row.industry];
      var rank = index + 1;
      // 순위 변화에 ▲▼를 쓰면 바로 옆 등락률의 ▲▼와 같은 기호라 "2% 상승"으로 읽힌다
      // (2026-09-01 사용자 지적). 계단 수를 명시하고 화살표도 ↑↓로 바꿔 구분한다.
      var moveText, moveClass;
      if (!hasBaseline) { moveText = '—'; moveClass = 'is-same'; }
      else if (!old) { moveText = 'NEW'; moveClass = 'is-new'; }
      else if (old.rank === rank) { moveText = '유지'; moveClass = 'is-same'; }
      else {
        var diff = old.rank - rank;
        moveText = Math.abs(diff) + '계단' + (diff > 0 ? '↑' : '↓');
        moveClass = diff > 0 ? 'is-rank-up' : 'is-rank-down';
      }
      var rate = Number(row.avg_change_rate != null ? row.avg_change_rate : row.avgChangeRate);
      var tone = rate > 0 ? 'is-up' : rate < 0 ? 'is-down' : 'is-flat';
      var amount = Number(row.trade_amount != null ? row.trade_amount : row.tradeAmount);
      // 최소 3%는 남겨 하위 업종도 막대가 보이게 한다(1위가 압도적이면 나머지가 0에
      // 수렴해 아예 안 보인다).
      var fill = (isFinite(amount) && maxAmount > 0) ? Math.max(3, amount / maxAmount * 100) : 0;
      return '<div class="mt-industry-flow-item">'
        + '<button type="button" class="mt-industry-flow-row ' + tone + '" data-industry-index="' + index + '" aria-expanded="false" aria-controls="mt-industry-detail-' + index + '">'
        + '<i class="mt-if-fill" style="width:' + fill.toFixed(1) + '%" aria-hidden="true"></i>'
        + '<i class="mt-if-rank">' + rank + '</i>'
        + '<b>' + escapeHtml(row.industry || '-') + '</b>'
        + '<span class="mt-if-amount">' + formatFlowAmount_(amount) + '</span>'
        + '<span class="mt-if-rate">' + (isFinite(rate) ? (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '-') + '</span>'
        + '<em class="mt-if-move ' + moveClass + '">' + moveText
        + '<i class="mt-if-caret" aria-hidden="true">▾</i></em>'
        + '</button>'
        + representativeStocksHtml_(row, index)
        + '</div>';
    }).join('');
    // 데이터가 10개보다 적을 때가 있어(오늘 8개) 제목의 "TOP 10"이 사실과 달랐다.
    // 실제로 보여주는 개수를 쓴다.
    var title = shown.length ? '오늘 업종 TOP ' + shown.length : '오늘 업종 흐름';
    mount.innerHTML = '<div class="mt-section mt-card mt-industry-flow-card">'
      + '<div class="mt-industry-flow-head"><strong>' + title + '</strong><span>거래대금이 많이 몰린 순서</span></div>'
      + '<div class="mt-industry-flow-columns"><span></span><span>테마 업종</span><span>거래대금</span><span>평균등락</span><span>순위</span></div>'
      + (html || '<div class="mt-hint">업종 흐름 데이터가 없습니다.</div>')
      + '<p class="mt-industry-flow-note">테마별 대표 종목들의 거래대금을 합산합니다(약 240종목·37개 테마, 3분마다 갱신). 칸을 채운 색의 길이는 1위 테마 대비 거래대금 비율이고, 평균등락률은 보조지표입니다. 한 종목이 여러 테마에 속할 수 있어 테마 합계는 시장 전체와 다릅니다. ' + rankBasisText + ' 누르면 대표 종목이 열립니다.</p>'
      + '</div>';
    mount.onclick = function (event) {
      var rowButton = event.target.closest && event.target.closest('.mt-industry-flow-row');
      if (!rowButton || !mount.contains(rowButton)) return;
      var detail = mount.querySelector('#' + rowButton.getAttribute('aria-controls'));
      if (!detail) return;
      var shouldOpen = detail.hidden;
      mount.querySelectorAll('.mt-industry-flow-detail').forEach(function (item) {
        item.hidden = true;
      });
      mount.querySelectorAll('.mt-industry-flow-row').forEach(function (item) {
        item.setAttribute('aria-expanded', 'false');
        item.classList.remove('is-open');
      });
      if (shouldOpen) {
        detail.hidden = false;
        rowButton.setAttribute('aria-expanded', 'true');
        rowButton.classList.add('is-open');
      }
    };
  }

  function loadIndustryFlow_(container) {
    var mount = container.querySelector('[data-industry-flow]');
    if (!mount) return;
    var dateKey = kstDateKey_(new Date());
    // VM이 집계해 둔 테마 흐름을 먼저 쓰고, 실패하면 예전 경로(market-board를 브라우저가
    // 묶는 방식)로 내려간다. 2026-09-01: 예전 경로는 거래대금 상위 30종목 중 17개가
    // ETF라 업종이 없어 버려져 테마가 8개, 테마당 1~3종목뿐이었다. VM 쪽은 증시온도가
    // 3분마다 이미 받아두는 238종목(37개 테마)을 쓰므로 훨씬 두껍고 외부 호출도 안 는다.
    fetchJson_(INDUSTRY_FLOW_URL)
      .then(function (body) {
        var payload = body && body.data ? body.data : body;
        var rows = (payload && payload.rows) || [];
        if (!rows.length) throw new Error('industry flow empty');
        writeIndustryFlowSnapshot_(dateKey, rows);
        // 2026-09-14: 서버가 직전 거래일 순위를 주면 그걸 기준으로 삼는다.
        var serverPrevious = payload && payload.previousDate && payload.previousRanks
          ? { date: payload.previousDate, ranks: payload.previousRanks } : null;
        renderIndustryFlow_(mount, rows, dateKey, serverPrevious);
      })
      .catch(function () { return loadIndustryFlowFromBoard_(mount, dateKey); })
      .catch(function () {
        renderIndustryFlow_(mount, readIndustryFlowSnapshots_()[dateKey] || [], dateKey);
      });
  }

  // 예전 경로(폴백). VM `/industry-flow`가 아직 배포 전이거나 실패했을 때만 쓴다.
  function loadIndustryFlowFromBoard_(mount, dateKey) {
    return fetchJson_(INDUSTRY_FLOW_FALLBACK_URL)
      .then(function (body) {
        var payload = body && body.data ? body.data : body;
        var sections = payload && payload.sections || {};
        var sourceRows = sections.tradeAmount && sections.tradeAmount.length
          ? sections.tradeAmount : sections.industry || [];
        var rows = aggregateIndustryFlow_(sourceRows);
        writeIndustryFlowSnapshot_(dateKey, rows);
        renderIndustryFlow_(mount, rows, dateKey);
      });
  }


  // ---- 오늘 돈이 몰린 섹터 (국내 주요종목 상단) ----
  //
  // 2026-09-02 사용자 요청으로 추천을 섹터 단위로 바꿨다(흐름: 오늘의 섹터 → 그 종목 →
  // 파생 섹터). 2026-09-14 사용자 지적("광통신이 상한가 갔는데 하나도 없네, 내가 만든
  // 섹터잖아, 증권사 섹터로 해")으로 섹터 출처를 손으로 만든 섹터 지도(data/sectors-v3.js)에서 키움 테마로
  // 바꿨다. 서버(/theme-flow)가 등락률 상위 테마 20개를 구성종목 거래대금 순으로 준다.
  var SECTOR_FLOW_URL = 'https://goodbyestar.cloud/theme-flow';
  var SECTOR_FLOW_TOP = 10;

  function tradeAmountText_(amount) {
    var won = Number(amount);
    if (!isFinite(won) || won <= 0) return '';
    var eok = won / 1e8;
    if (eok >= 10000) return (eok / 10000).toFixed(1) + '조';
    return Math.round(eok).toLocaleString('ko-KR') + '억';
  }

  function sectorFlowAmountText_(row) {
    var text = tradeAmountText_(row && row.trade_amount);
    var limit = Number(row && row.upper_limit_count);
    if (limit > 0) text = (text ? text + ' · ' : '') + '상한가 ' + limit;
    return text;
  }

  // (3) 파생 섹터: 선택한 테마와 구성종목을 공유하는 다른 테마(같은 응답 안에서). 한 종목이
  // 두 테마에 걸쳐 있으면 한쪽이 뜰 때 다른 쪽도 같이 움직이는 경우가 많아 다음에 볼 후보다.
  function derivedSectors_(row, rows) {
    var mine = {};
    (row && row.codes || []).forEach(function (code) { mine[String(code)] = true; });
    if (!Object.keys(mine).length) return [];
    var out = [];
    (rows || []).forEach(function (other) {
      if (!other || other === row || other.industry === row.industry) return;
      var shared = (other.codes || []).filter(function (code) { return mine[String(code)]; }).length;
      if (!shared) return;
      out.push({ sector: other.industry, shared: shared, rate: Number(other.avg_change_rate) });
    });
    out.sort(function (a, b) {
      return (b.shared - a.shared) || ((b.rate || 0) - (a.rate || 0));
    });
    return out.slice(0, 4);
  }

  function sectorFlowStockHtml_(stock) {
    var code = String(stock.code || '');
    var rate = Number(stock.change_rate != null ? stock.change_rate : stock.changeRate);
    var tone = rate > 0 ? 'is-up' : rate < 0 ? 'is-down' : 'is-flat';
    var price = isFinite(Number(stock.price)) && Number(stock.price) > 0 ? Math.round(stock.price).toLocaleString('ko-KR') : '-';
    return '<a class="mt-sf-stock" href="/page/stock-search?code=' + encodeURIComponent(code)
      + '&amp;name=' + encodeURIComponent(stock.name || code) + '">'
      + '<span class="mt-sf-stock-name">' + escapeHtml(stock.name || code) + '</span>'
      + '<span class="mt-sf-stock-val"><b>' + price + '</b>'
      + '<em class="' + tone + '">' + (isFinite(rate) ? (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '-') + '</em></span>'
      + '</a>';
  }

  function sectorFlowRowHtml_(row, index, rows) {
    var rate = Number(row.avg_change_rate);
    var tone = rate > 0 ? 'is-up' : rate < 0 ? 'is-down' : 'is-flat';
    var derived = derivedSectors_(row, rows);
    var derivedHtml = derived.length
      ? '<div class="mt-sf-derived"><span>함께 볼 섹터</span>'
        + derived.map(function (d) {
            var r = isFinite(d.rate) ? ' ' + (d.rate > 0 ? '+' : '') + d.rate.toFixed(1) + '%' : '';
            return '<b>' + escapeHtml(d.sector) + '<small>' + escapeHtml(r) + '</small></b>';
          }).join('') + '</div>'
      : '';
    return '<div class="mt-sf-item">'
      + '<button type="button" class="mt-sf-row ' + tone + '" data-sf-index="' + index + '" aria-expanded="false">'
      + '<i class="mt-sf-rank">' + (index + 1) + '</i>'
      + '<b>' + escapeHtml(row.industry || '-') + '</b>'
      + '<span class="mt-sf-mult">' + escapeHtml(sectorFlowAmountText_(row) || '-') + '</span>'
      + '<span class="mt-sf-rate">' + (isFinite(rate) ? (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '-') + '</span>'
      + '<i class="mt-sf-caret" aria-hidden="true">▾</i>'
      + '</button>'
      + '<div class="mt-sf-detail" hidden>'
      + (row.stocks || []).map(sectorFlowStockHtml_).join('')
      + derivedHtml
      + '</div></div>';
  }

  function renderSectorFlow_(mount, rows) {
    if (!mount) return;
    var shown = (rows || []).slice(0, SECTOR_FLOW_TOP);
    if (!shown.length) { mount.innerHTML = ''; return; }
    var basis = '키움증권 테마 기준입니다. 오늘 많이 오른 테마 20개 중 구성종목 거래대금(현재가×거래량 추정)이 큰 순서입니다. 행을 누르면 구성종목과 함께 볼 섹터가 열립니다.';
    mount.innerHTML = '<div class="mt-section mt-card mt-sf-card">'
      + shown.map(function (row, i) { return sectorFlowRowHtml_(row, i, rows); }).join('')
      + '<p class="mt-sf-note">' + escapeHtml(basis) + '</p>'
      + '</div>';
    mount.onclick = function (event) {
      var button = event.target.closest && event.target.closest('.mt-sf-row');
      if (!button || !mount.contains(button)) return;
      var detail = button.parentElement.querySelector('.mt-sf-detail');
      if (!detail) return;
      var open = !detail.hasAttribute('hidden');
      if (open) { detail.setAttribute('hidden', ''); button.classList.remove('is-open'); }
      else { detail.removeAttribute('hidden'); button.classList.add('is-open'); }
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
    };
  }

  function loadSectorFlow_(container) {
    var mount = container.querySelector('[data-sector-flow]');
    if (!mount) return;
    fetchJson_(SECTOR_FLOW_URL)
      .then(function (body) {
        var payload = body && body.data ? body.data : body;
        renderSectorFlow_(mount, (payload && payload.rows) || []);
      })
      .catch(function () { mount.innerHTML = ''; });   // 실패하면 조용히 비운다 - 아래 카드가 본체다
  }

  function buildStocksOnlyPage() {
    var params = new URLSearchParams(String(global.location && global.location.search || ''));
    var initialView = params.get('panel') === 'heatmap' ? 'heatmap' : params.get('panel') === 'marketcap' ? 'marketcap' : 'cards';
    return '<div class="mt-stocks-only">'
      + '<div class="mt-stocks-only-heading"><h1>국내 주요종목</h1><p>오늘 자금이 몰린 섹터와, 업종별 개별 종목을 나눠서 봅니다.</p></div>'
      + '<section class="mt-section-block">'
      + '<div class="mt-section-head"><h2>오늘 돈이 몰린 섹터</h2><p>테마(섹터) 단위 랭킹입니다. 아래 종목 목록과는 별개로, 오늘 어느 섹터에 자금이 몰렸는지만 보여줍니다.</p></div>'
      + '<div data-sector-flow></div>'
      + '</section>'
      + '<section class="mt-section-block">'
      + '<div class="mt-section-head"><h2>업종별 주요 종목</h2><p>관심 업종의 개별 종목을 카드·히트맵·시가총액 순으로 살펴봅니다.</p></div>'
      + buildExploreCard(initialView)
      + '</section>'
      + '</div>';
  }

  function init(opts) {
    var stocksOnly = isStocksView();
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    if (stocksOnly) {
      container.innerHTML = buildStocksOnlyPage();
      wireViewTabs(container);
      loadSectorFlow_(container);
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
        if (!r.ok) throw new Error('응답 오류: ' + r.status);
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

  // 2026-09-02: GAS `?marketTemp=1` -> VM `/market-temp` 전환
  // (docs/BACKEND_CONSOLIDATION.md 1단계). GAS는 요청을 받고 나서 전종목 시세를 긁어
  // 점수를 매겨 캐시 미스면 방문자가 7초를 물었다. VM은 백그라운드 3분 주기로 미리
  // 계산해두고 방문자는 저장된 값만 읽는다.
  //
  // 전환 전 같은 시각 두 응답을 대조했고 수급·거래대금 두 컴포넌트가 갈렸다. 되돌리지
  // 않고 VM을 정답으로 확정한 근거는 docs/BACKEND_CONSOLIDATION.md 5절 표에 남겼다
  // (요약: GAS 수급은 과거 이력이 없는 ETF 대리지표라 비율이 포화됐고, GAS 거래대금
  // 5일 이력은 방문이 있는 날만 장중 스냅샷으로 쌓여 과소평가된다).
  //
  // 폴백을 두지 않는다 - VM이 죽으면 GAS 숫자로 조용히 갈아타는 건 온도 기준이 말없이
  // 바뀌는 것이라 오히려 나쁘다. 이 화면의 다른 카드(업종 TOP 등)도 이미 VM 단독이다.
  var MARKET_TEMP_URL = 'https://goodbyestar.cloud/market-temp';

  function fetchMarketTemp() {
    return fetchJson_(MARKET_TEMP_URL).then(function (body) {
      // VM은 {success, updatedAt, data}로 감싸고 GAS는 본문을 그대로 준다 - 이 화면의
      // 다른 VM 호출부와 같은 방식으로 둘 다 받아넘긴다.
      return body && body.data ? body.data : body;
    });
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
    // 2026-09-07: 서버가 돈·가격·위험 3축 평균으로 0~100 종합점수를 내려준다.
    // 옛 경로(원점수/만점 환산)는 배포 시차 동안만 쓰이는 폴백이다.
    var summary = Number(data && data.score100);
    if (isFinite(summary)) return summary;
    var rawScore = Number(data && data.score);
    var rawMax = Number(data && data.maxScore);
    if (isFinite(rawScore) && isFinite(rawMax) && rawMax > 0) return rawScore / rawMax * 100;
    var temp = Number(data && data.temp);
    return isFinite(temp) ? temp / GAUGE_MAX_TEMP * 100 : 0;
  }

  /* ---- 3축 요약 카드(2026-09-07) ----

     "지표가 10개라 아무도 안 본다"는 사용자 판단으로 화면의 주인공을 바꿨다.
     숫자 하나(종합점수) + 어제 대비 + 3축 막대까지가 첫 화면이고, 10개 컴포넌트는
     아래 '자세히'로 내린다. 레이더 차트는 같은 값을 막대와 두 번 그리던 것이라 뺐다. */
  var AXIS_ORDER = [
    { key: 'money', icon: '💰' },
    { key: 'price', icon: '📈' },
    { key: 'risk', icon: '⚠️' }
  ];

  // 2026-09-16 사용자 지적("점수가 그냥 숫자야. 몇 점 만점인지도 몰라. 그래서 뭐 어쩌라는거지?").
  // 축 옆 한 단어를 '강함/약함'이 아니라 무엇이 어떤지로 쓴다 - '돈 18 약함'은 뜻이 안 읽혔다.
  var AXIS_WORDS = {
    money: ['적게 들어옴', '평소 수준', '많이 들어옴'],
    price: ['내림 우세', '비슷함', '오름 우세'],
    risk: ['낮음', '보통', '높음']
  };

  function axisWord(key, value) {
    if (!isFinite(value)) return '';
    var words = AXIS_WORDS[key] || ['약함', '보통', '강함'];
    return value >= 65 ? words[2] : value >= 35 ? words[1] : words[0];
  }

  function buildAxisRow(axis, icon) {
    var value = Number(axis && axis.value);
    var pct = isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    // 위험 축만 "높을수록 나쁨"이라 색을 반대로 준다.
    var tone = axis && axis.inverted
      ? (pct >= 65 ? 'mt-axis-bad' : pct >= 35 ? 'mt-axis-mid' : 'mt-axis-good')
      : (pct >= 65 ? 'mt-axis-good' : pct >= 35 ? 'mt-axis-mid' : 'mt-axis-bad');
    return ''
      + '<div class="mt-axis-row">'
      + '<span class="mt-axis-name">' + icon + ' ' + escapeHtml((axis && axis.label) || '')
      + (axis && axis.question ? '<small>' + escapeHtml(axis.question) + '</small>' : '') + '</span>'
      + '<span class="mt-axis-bar"><i class="' + tone + '" style="width:' + pct.toFixed(0) + '%"></i></span>'
      + '<b class="mt-axis-value">' + (isFinite(value) ? value.toFixed(0) : '-') + '</b>'
      + '<small class="mt-axis-word">' + escapeHtml(axisWord(axis && axis.key, value)) + '</small>'
      + '</div>';
  }

  // 반원 다이얼 좌표 계산 - 0점은 정왼쪽(180˚), 100점은 정오른쪽(0˚), 위쪽 반원을 훑는다.
  function polarPoint_(cx, cy, r, angleDeg) {
    var rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  }

  // 0~100 점수 구간(공포·보통·과열)별 색 - 서버 market_temp_score.GRADE3 경계(50·75)와 같다.
  function zoneColor_(v) { return v < 50 ? '#55d6ff' : v < 75 ? '#c9f36b' : '#ff6b9d'; }

  // 오늘 점수를 디지털 온도계처럼 직사각형 막대와 중앙 숫자로 보여준다.
  // 여러 차례 방향이 바뀌었다: 가로 막대 → 반원+바늘(1차) → 비대칭 3조각 지적(2차) →
  // 그라디언트 매끈한 반원(3차) → 자동차 속도계 240˚(4차) → 무채색+빨간 바늘(5차) →
  // "너무 만화 같아"로 가는 바늘 다듬기(6차) → 유리·금속 질감 강화(7차) → "니가
  // 검색해서 정말 기발한거 몇개 샘플 좀 줘"로 CFGI/alternative.me식 얇은 바늘+배지
  // (8차)까지 갔지만 "디지털 게이지로 바꾸자 이건 아닌거 같아"(9차, 현재)로 바늘·
  // 그라디언트 트랙 자체를 버렸다. 자동차 계기판·아날로그 시계 은유를 완전히 떠나
  // 이퀄라이저/디지털 온도계처럼 직사각형 막대 24개로 나누고, 점수 이하 구간만
  // 공포·보통·과열 구간색으로 켜고 나머지는 꺼진 회색으로 둔다.
  function buildScoreGauge(value, tone) {
    var pct = Math.max(0, Math.min(100, value));
    var segCount = 24, barW = 11, gap = 2, startX = 18, barY = 66, barH = 14;
    var segs = '';
    for (var i = 0; i < segCount; i++) {
      var segVal = ((i + 0.5) / segCount) * 100;
      var lit = segVal <= pct;
      segs += '<rect class="mt-gauge-seg' + (lit ? ' is-lit' : '') + '" fill="'
        + (lit ? zoneColor_(segVal) : '#e3e5e9') + '"'
        + ' x="' + (startX + i * (barW + gap)) + '" y="' + barY
        + '" width="' + barW + '" height="' + barH + '"></rect>';
    }
    return ''
      + '<div class="mt-score-gauge mt-score-gauge-future" role="img" aria-label="100점 만점에 ' + pct.toFixed(0) + '점">'
      + '<svg class="mt-score-gauge-dial mt-fade-in" viewBox="0 0 320 104" aria-hidden="true">'
      + segs
      + '<text class="mt-gauge-digital-num" x="160" y="31">' + pct.toFixed(0) + '</text>'
      + '<text class="mt-gauge-digital-unit" x="160" y="47">/ 100</text>'
      + '</svg>'
      + '<div class="mt-gauge-scale"><span>0</span><span>50</span><span>75</span><span>100</span></div>'
      + '<div class="mt-score-gauge-legend">'
      + '<span class="mt-score-zone-label' + (tone === 'fear' ? ' is-active' : '') + '">공포</span>'
      + '<span class="mt-score-zone-label' + (tone === 'neutral' ? ' is-active' : '') + '">보통</span>'
      + '<span class="mt-score-zone-label' + (tone === 'greed' ? ' is-active' : '') + '">과열</span>'
      + '</div></div>';
  }

  function buildSummaryCard(data) {
    var value = score100(data);
    var grade = data.grade3 || data.grade || { emoji: '', label: '' };
    var guide = antGuide(data);
    var delta = Number(data.scoreDelta);
    // delta가 아예 없는 건 "어제와 같다"가 아니라 "비교할 어제가 없다"는 뜻이다
    // (기록 시작 직후·기준 전환 직후). 둘을 같은 문구로 뭉뚱그리면 거짓말이 된다.
    // 2026-09-16: 비교 기준을 날짜로 밝힌다(서버 scoreDeltaFrom). 새벽·주말엔 "어제"가 직전 거래일이라
    // "어제보다"라고 쓰면 틀린 말이 된다. 구버전 응답(날짜 없음)만 예전 문구를 쓴다.
    var fromText = data.scoreDeltaFrom ? shortDate_(data.scoreDeltaFrom) + ' 대비 ' : '';
    var deltaHtml;
    if (!isFinite(delta)) {
      deltaHtml = '<span class="mt-val-flat">오늘부터 일별 기록을 시작했습니다.</span>';
    } else if (delta === 0) {
      deltaHtml = '<span class="mt-val-flat">' + (fromText ? fromText + '변화 없음' : '어제와 같음') + '</span>';
    } else {
      deltaHtml = '<span class="' + (delta > 0 ? 'mt-val-pos' : 'mt-val-neg') + '">' + (fromText || '어제보다 ')
        + (delta > 0 ? '+' : '') + delta.toFixed(0) + '점</span>';
    }
    var axes = data.axes || {};
    var rows = AXIS_ORDER.map(function (item) {
      var axis = axes[item.key];
      if (!axis) return '';
      axis.key = item.key;
      return buildAxisRow(axis, item.icon);
    }).join('');
    return ''
      + '<div class="mt-section mt-card mt-summary-card mt-summary-' + guide.tone + '">'
      + '<div class="mt-summary-kicker">오늘 시장 분위기 점수</div>'
      + '<div class="mt-summary-head">'
      + '<strong class="mt-summary-score">' + value.toFixed(0) + '<small>/100점</small></strong>'
      + '<div class="mt-summary-side">'
      + '<b class="mt-summary-grade">' + escapeHtml(grade.emoji || '') + ' ' + escapeHtml(grade.label || '') + '</b>'
      + deltaHtml
      + '</div></div>'
      + '<div class="mt-summary-mood">' + escapeHtml(guide.mood) + '</div>'
      + buildScoreGauge(value, guide.tone)
      // "그래서 뭐 어쩌라는거지?"에 대한 답을 점수 바로 밑에 한 줄로 둔다. 자세한 점검표는 아래 카드.
      + '<div class="mt-summary-sowhat"><b>그래서?</b><span>' + escapeHtml(guide.short) + '</span>'
      + '<a href="#mt-ant-guide">체크리스트 ↓</a></div>'
      + (rows ? '<div class="mt-axis-list">' + rows + '</div>' : '')
      // 상승·하락 종목 수는 2026-09-02 사용자 요청으로 들어간 기능이라 단순화하면서도
      // 버리지 않는다 - 옛 Hero 카드에 있던 것을 여기로 옮겼다.
      + buildBreadth(data)
      + '<div class="mt-summary-note">0점에 가까울수록 시장이 겁먹은 상태, 100점에 가까울수록 들뜬 상태입니다. 돈·가격·위험 세 가지를 평균냈고, 위험만 높을수록 나쁩니다. 투자 권유가 아닙니다.</div>'
      + '</div>';
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
  // 시장별 상승·하락 표시 순서(코스피 먼저). 서버 byMarket 키와 1:1로 맞춘다.
  var MARKET_LABELS = [{ key: 'KOSPI', label: '코스피' }, { key: 'KOSDAQ', label: '코스닥' }];

  // 2026-09-02 사용자 요청("몇 개가 오르고 몇 개가 내리는지 보고싶어") - 상승·하락 종목
  // 수는 원래 아래 지표 상세의 "상승비율" 행에만 있어 눈에 잘 안 띄었다. 온도 바로 밑으로
  // 올린다. 모집단은 코스피+코스닥 전종목이 아니라 data/sectors-v3.js 섹터 풀이므로
  // 그 사실을 문구로 명시한다(전체 시장 수치로 오해하지 않도록).
  function buildBreadth(data) {
    var rr = (data.components || {}).riseRatio;
    if (!rr || typeof rr.total !== 'number' || rr.total === 0) return '';
    var mb = data.marketBreadth;

    // 전종목(KIS 업종지수 제공)이 있으면 그걸 주 수치로 쓴다 - 사용자가 보고 싶은 건
    // 시장 전체다. 없으면(키 미설정·조회 실패·구버전 응답) 섹터 풀 수치로 물러난다.
    var head = mb && mb.total ? mb.total : { up: rr.up || 0, down: rr.down || 0 };
    var byMarket = (mb && mb.byMarket) || rr.byMarket;
    var wholeMarket = !!(mb && mb.total);

    var marketsHtml = '';
    if (byMarket) {
      var chips = MARKET_LABELS.map(function (m) {
        var b = byMarket[m.key];
        if (!b || !b.total) return '';
        return '<span class="mt-breadth-market"><em>' + m.label + '</em>'
          + '<span class="mt-breadth-up">' + (b.up || 0) + '</span>'
          + '<span class="mt-breadth-slash">/</span>'
          + '<span class="mt-breadth-down">' + (b.down || 0) + '</span></span>';
      }).join('');
      if (chips) marketsHtml = '<div class="mt-hero-breadth-markets">' + chips + '</div>';
    }

    var flatHtml = '';
    if (wholeMarket && typeof head.flat === 'number' && head.flat > 0) {
      flatHtml = '<span class="mt-breadth-flat">보합 ' + head.flat + '</span>';
    }

    // 온도 점수는 섹터 풀 기준이라 위 전종목 수치와 모집단이 다르다. 그 차이를 숨기지 않는다.
    var scanned = typeof data.quoteCount === 'number' && data.quoteCount > 0 ? data.quoteCount : rr.total;
    var note = wholeMarket
      ? '전종목 기준(코스피+코스닥) · 온도 점수는 섹터 풀 ' + scanned + '종목 기준'
      : '섹터 풀 ' + scanned + '종목 기준(전체 시장 아님)';

    return '<div class="mt-hero-breadth">'
      + '<span class="mt-breadth-up">상승 <strong>' + (head.up || 0) + '</strong></span>'
      + '<span class="mt-breadth-sep">·</span>'
      + '<span class="mt-breadth-down">하락 <strong>' + (head.down || 0) + '</strong></span>'
      + flatHtml
      + '</div>'
      + marketsHtml
      + '<div class="mt-breadth-note">' + note + '</div>';
  }

  // 사이트 전체가 Groq AI 해설 상자를 "참고의견 + 말풍선 아이콘"으로 통일했다(2026-08-14).
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
    var guide = antGuide(data);
    return ''
      + '<div class="mt-card mt-decision-card">'
      + '<div class="mt-card-title">📊 오늘 시장 판단</div>'
      + '<div class="mt-market-decision">'
      + '<div><span class="mt-market-decision-label">오늘 점수</span><strong>' + normalizedScore.toFixed(0) + '<small>/100</small></strong></div>'
      + '<div class="mt-market-decision-action"><span>오늘 행동</span><b>' + escapeHtml(guide.title) + '</b><small>' + escapeHtml(guide.short) + '</small></div>'
      + '</div>'
      + '<div class="mt-driver-grid">'
      + buildDriverGroup('▲ 점수를 올린 요인', 'up', rising)
      + buildDriverGroup('▼ 점수를 내린 요인', 'down', falling)
      + '</div>'
      + '<div class="mt-driver-legend"><span>막대가 길수록 오늘 점수에 미친 영향이 큽니다.</span><span>빨강: 과열 방향 · 파랑: 공포 방향</span></div>'
      + '<details class="mt-score-method"><summary>점수·계산 기준·데이터 출처 보기</summary><p>100점 만점입니다. 지표를 돈(거래대금·수급)·가격(평균등락률·상승비율·52주 신고가/신저가)·위험(VIX·환율·빚투) 세 묶음으로 나눠 각 묶음은 점수÷만점의 평균, 종합점수는 세 묶음의 평균입니다(위험은 뒤집어 안전도로 넣음). 50점 미만 공포 · 50~75점 보통 · 75점 이상 과열. 섹터 강도·미국 선물지수는 참고로만 보여주고 종합점수에는 넣지 않습니다. 투자 권유가 아닙니다.</p><ul>' + methodRows + '</ul></details>'
      + '</div>';
  }

  // ---- 최근 단기흐름(5/10/20/40일) ----

  function historyDays_(data) {
    // 2026-09-07: 추이도 3축 종합점수(0~100)로 그린다. 옛 40℃ 온도와 스케일이 달라
    // 섞으면 전환일에 선이 튄다 - score가 있는 날만 쓴다. 하나도 없으면(구버전 응답)
    // 온도를 같은 100점 눈금으로 환산해 그린다.
    var days = (data.recentDays || []).filter(function (item) {
      return item && typeof item.score === 'number' && isFinite(item.score);
    }).map(function (item) {
      return { date: item.date, score: item.score };
    });
    if (days.length) return days.slice(-40);
    return (data.recentDays || []).filter(function (item) {
      return item && typeof item.temp === 'number' && isFinite(item.temp);
    }).map(function (item) {
      return { date: item.date, score: item.temp / GAUGE_MAX_TEMP * 100 };
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

  /* ---- 최근 단기흐름 리본 ----

     2026-09-16: 30일 평균 대비 편차를 위아래로 그리던 그래프를 0~100 점수 그대로 올리고
     배경에 공포·보통·과열 구간을 까는 방식으로 바꿨다. 선 색은 높이에 따라 파랑(공포)→
     노랑(보통)→빨강(과열)으로 변하고, 마지막 점은 맥박처럼 뛰며, 그래프를 훑으면 그날
     점수가 뜬다.
     2026-09-22: 날짜별 아이콘 줄을 기상 캐스터식 6단계 표현으로 달았던 걸 사용자 피드백
     ("날씨코너냐?")에 따라 걷어낸다. 화면 다른 곳(점수 게이지)이
     이미 쓰는 공포·보통·과열 3단계 용어로 통일해, 같은 화면 안에서 서로 다른 두 개의
     분류 체계(날씨 6단계 vs 공포/보통/과열 3단계)를 동시에 안 쓰게 한다. */
  var MARKET_MOOD = {
    fear: { icon: '🔵', word: '공포' },
    neutral: { icon: '🟡', word: '보통' },
    greed: { icon: '🟠', word: '과열' }
  };
  var sparkSeq_ = 0;

  function marketMood_(score) {
    return MARKET_MOOD[scoreTone_(score)];
  }

  function scoreTone_(score) {
    return score < 50 ? 'fear' : score < 75 ? 'neutral' : 'greed';
  }

  function shortDate_(date) {
    var match = /^\d{4}-(\d{2})-(\d{2})/.exec(String(date || ''));
    return match ? parseInt(match[1], 10) + '/' + parseInt(match[2], 10) : String(date || '');
  }

  function signedPoints_(value) {
    var rounded = Math.round(value);
    return (rounded > 0 ? '+' : '') + rounded + '점';
  }

  function buildSparklineContent(data, period) {
    var days = historyDays_(data);
    if (!days.length) return '<div class="mt-stats-empty">증시온도 기록을 확인할 수 없습니다.</div>';
    var shown = days.slice(-period);
    if (shown.length === 1) {
      var only = marketMood_(shown[0].score);
      return '<div class="mt-spark-single"><strong>' + only.icon + ' ' + shown[0].score.toFixed(0) + '점</strong>'
        + '<span>' + escapeHtml(shown[0].date) + '</span><small>단기흐름 데이터가 더 쌓이면 기간을 비교할 수 있습니다.</small></div>';
    }

    // 현재값을 뺀 최근 30개의 평균을 점선으로 깐다 - 오늘이 평소보다 높은지 낮은지 보는 기준.
    var priorDays = days.slice(0, -1);
    var baselineRows = (priorDays.length ? priorDays : days).slice(-30);
    var baseline = baselineRows.reduce(function (sum, item) { return sum + item.score; }, 0) / baselineRows.length;

    var W = 640, H = 210, PX = 18, PT = 18, PB = 12;
    var plotH = H - PT - PB;
    function yOf(value) { return PT + (1 - Math.max(0, Math.min(100, value)) / 100) * plotH; }
    function pctX(x) { return (x / W * 100).toFixed(2); }
    function pctY(y) { return (y / H * 100).toFixed(2); }
    var stepX = (W - PX * 2) / (shown.length - 1);
    var points = shown.map(function (item, i) {
      return { x: PX + i * stepX, y: yOf(item.score), score: item.score, date: item.date };
    });
    var uid = 'mtRib' + (++sparkSeq_);
    var line = 'M' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1) + points.slice(1).map(function (point, i) {
      return smoothSegment_(points, i).replace(/^M\S+\s/, ' ');
    }).join('');
    var floor = yOf(0).toFixed(1);
    var now = points[points.length - 1];
    var area = line + ' L' + now.x.toFixed(1) + ',' + floor + ' L' + points[0].x.toFixed(1) + ',' + floor + ' Z';
    // 높이별 색. offset 0 = 100점(위), 1 = 0점(아래). userSpaceOnUse라 거의 수평인 선에도 색이 먹는다.
    var stops = [[0, '#E53935'], [0.25, '#FB8C00'], [0.4, '#F4B400'], [0.5, '#8EC1EC'], [0.62, '#42A5F5'], [1, '#1565C0']]
      .map(function (stop) { return '<stop offset="' + stop[0] + '" stop-color="' + stop[1] + '"></stop>'; }).join('');
    var gradient = '<linearGradient id="' + uid + 'Heat" gradientUnits="userSpaceOnUse" x1="0" y1="' + yOf(100).toFixed(1)
      + '" x2="0" y2="' + yOf(0).toFixed(1) + '">' + stops + '</linearGradient>';
    var zones = [['greed', 100, 75], ['neutral', 75, 50], ['fear', 50, 0]].map(function (zone) {
      return '<rect class="mt-rib-zone mt-rib-zone-' + zone[0] + '" x="0" y="' + yOf(zone[1]).toFixed(1) + '" width="' + W
        + '" height="' + (yOf(zone[2]) - yOf(zone[1])).toFixed(1) + '"></rect>';
    }).join('');
    var borders = [75, 50].map(function (value) {
      return '<line class="mt-rib-border" x1="0" y1="' + yOf(value).toFixed(1) + '" x2="' + W + '" y2="' + yOf(value).toFixed(1) + '"></line>';
    }).join('');
    // 2026-09-16 사용자 요청("bold 되어 있는거 없애, 그냥 사각형이 좋아, 그래프도 마찬가지"): 점은 작은 사각형.
    function square(className, point, size) {
      return '<rect class="' + className + '" x="' + (point.x - size / 2).toFixed(1) + '" y="' + (point.y - size / 2).toFixed(1)
        + '" width="' + size + '" height="' + size + '"></rect>';
    }
    var dots = points.slice(0, -1).map(function (point) {
      return square('mt-rib-dot mt-rib-tone-' + scoreTone_(point.score), point, 5);
    }).join('');
    var nowTone = scoreTone_(now.score);
    var nowMood = marketMood_(now.score);
    var svg = '<svg class="mt-rib-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="최근 ' + shown.length + '거래일 종합점수 흐름">'
      + '<defs>' + gradient + '</defs>'
      + zones + borders
      + '<line class="mt-rib-avg" x1="' + PX + '" y1="' + yOf(baseline).toFixed(1) + '" x2="' + (W - PX) + '" y2="' + yOf(baseline).toFixed(1) + '"></line>'
      + '<path class="mt-rib-area" d="' + area + '" fill="url(#' + uid + 'Heat)"></path>'
      + '<path class="mt-rib-line mt-spark-draw" d="' + line + '" stroke="url(#' + uid + 'Heat)"></path>'
      + dots
      + square('mt-rib-pulse mt-rib-tone-' + nowTone, now, 9)
      + square('mt-rib-now mt-rib-tone-' + nowTone, now, 9)
      + '</svg>';
    // 글자는 SVG 밖 HTML로 얹는다 - viewBox가 폭에 맞춰 줄면 SVG 글자도 같이 작아져 폰에서 안 읽힌다.
    var overlay = [['greed', '과열', 87.5], ['neutral', '보통', 62.5], ['fear', '공포', 25]].map(function (zone) {
      return '<span class="mt-rib-zone-label mt-rib-tone-' + zone[0] + '" style="top:' + pctY(yOf(zone[2])) + '%">' + zone[1] + '</span>';
    }).join('')
      + '<span class="mt-rib-avg-label" style="top:' + pctY(yOf(baseline)) + '%">30일 평균 ' + baseline.toFixed(0) + '</span>'
      + '<span class="mt-rib-now-label mt-rib-tone-' + nowTone + (now.y < H * 0.3 ? ' is-below' : '') + '" style="left:' + pctX(now.x)
      + '%;top:' + pctY(now.y) + '%">' + nowMood.icon + ' ' + now.score.toFixed(0) + '점</span>'
      + '<i class="mt-rib-cursor" hidden></i><div class="mt-rib-tip" hidden></div>';
    var pointData = points.map(function (point) {
      return pctX(point.x) + ',' + pctY(point.y) + ',' + point.score.toFixed(0) + ',' + point.date;
    }).join(';');

    // 날짜별 요약 줄: 기간이 길어도 10칸까지만 고르게 뽑는다(폰 폭에서 한 줄 유지).
    var stripCount = Math.min(shown.length, 10);
    var strip = '';
    for (var s = 0; s < stripCount; s++) {
      var index = Math.round(s * (shown.length - 1) / (stripCount - 1));
      var day = shown[index];
      var mood = marketMood_(day.score);
      strip += '<li class="mt-weather-day mt-rib-tone-' + scoreTone_(day.score) + (index === shown.length - 1 ? ' is-today' : '')
        + '" style="--mt-i:' + s + '" title="' + escapeHtml(day.date + ' ' + day.score.toFixed(0) + '점 · ' + mood.word) + '">'
        + '<span class="mt-weather-icon" aria-hidden="true">' + mood.icon + '</span>'
        + '<b>' + day.score.toFixed(0) + '</b><small>' + escapeHtml(shortDate_(day.date)) + '</small></li>';
    }

    var low = shown.reduce(function (a, b) { return b.score < a.score ? b : a; });
    var high = shown.reduce(function (a, b) { return b.score > a.score ? b : a; });
    var periodDelta = now.score - points[0].score;
    var periodTone = periodDelta > 0 ? 'mt-val-pos' : periodDelta < 0 ? 'mt-val-neg' : 'mt-val-zero';
    var metrics = '<div class="mt-history-metrics">'
      + '<span><small>30일 평균</small><b>' + baseline.toFixed(0) + '점</b></span>'
      + '<span><small>가장 낮았던 날</small><b>' + marketMood_(low.score).icon + ' ' + low.score.toFixed(0) + '점 <em>' + escapeHtml(shortDate_(low.date)) + '</em></b></span>'
      + '<span><small>가장 높았던 날</small><b>' + marketMood_(high.score).icon + ' ' + high.score.toFixed(0) + '점 <em>' + escapeHtml(shortDate_(high.date)) + '</em></b></span>'
      + '<span><small>기간 변화</small><b class="' + periodTone + '">' + (periodDelta > 0 ? '▲ ' : periodDelta < 0 ? '▼ ' : '— ') + signedPoints_(periodDelta) + '</b></span>'
      + '</div>';
    return '<div class="mt-history-chart-meta"><span>위로 갈수록 들뜬 시장 · 아래로 갈수록 겁먹은 시장</span>'
      + '<b class="mt-rib-tone-' + nowTone + '">지금 ' + nowMood.icon + ' ' + escapeHtml(nowMood.word) + '</b></div>'
      + '<div class="mt-rib-stage mt-rib-anim" data-rib-stage data-rib-points="' + escapeHtml(pointData) + '">' + svg + overlay + '</div>'
      + '<ol class="mt-weather-strip mt-rib-anim">' + strip + '</ol>'
      + metrics;
  }

  // 선 그리기(stroke-dasharray)와 리본·날씨 줄 등장 효과. rAF나 문서 타임라인이 안 도는 환경(백그라운드
  // 탭 등)에서도 결국 정답 상태로 보이게 setTimeout으로 마무리한다(countUp과 같은 이유).
  function animateHistory(root) {
    var sparkPaths = root.querySelectorAll('.mt-spark-draw');
    if (sparkPaths.length) {
      var revealed = false;
      var reveal = function () {
        if (revealed) return;
        revealed = true;
        sparkPaths.forEach(function (path) { path.style.strokeDashoffset = '0'; });
      };
      sparkPaths.forEach(function (path) {
        if (!path.getTotalLength) return;
        var len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
      });
      requestAnimationFrame(function () { requestAnimationFrame(reveal); });
      setTimeout(reveal, 1000);
    }
    var animated = root.querySelectorAll('.mt-rib-anim');
    if (animated.length) {
      setTimeout(function () {
        animated.forEach(function (el) { el.classList.remove('mt-rib-anim'); });
      }, 1800);
    }
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
      animateHistory(content);
    });

    // 그래프를 훑으면(마우스 이동·손가락 가로 드래그) 가장 가까운 날의 점수와 날씨를 띄운다.
    function scrub(event) {
      var stage = event.target.closest && event.target.closest('[data-rib-stage]');
      if (!stage) return;
      var rect = stage.getBoundingClientRect();
      if (!rect.width) return;
      var at = (event.clientX - rect.left) / rect.width * 100;
      var best = null;
      (stage.getAttribute('data-rib-points') || '').split(';').forEach(function (raw) {
        var fields = raw.split(',');
        if (fields.length < 4) return;
        var point = { x: parseFloat(fields[0]), y: parseFloat(fields[1]), score: parseFloat(fields[2]), date: fields[3] };
        if (!best || Math.abs(point.x - at) < Math.abs(best.x - at)) best = point;
      });
      if (!best) return;
      var cursor = stage.querySelector('.mt-rib-cursor');
      var tip = stage.querySelector('.mt-rib-tip');
      var mood = marketMood_(best.score);
      if (cursor) {
        cursor.hidden = false;
        cursor.style.left = best.x + '%';
      }
      if (tip) {
        tip.hidden = false;
        tip.className = 'mt-rib-tip mt-rib-tone-' + scoreTone_(best.score) + (best.y < 34 ? ' is-below' : '');
        tip.style.left = Math.max(14, Math.min(86, best.x)) + '%';
        tip.style.top = best.y + '%';
        tip.innerHTML = '<span aria-hidden="true">' + mood.icon + '</span> <b>' + best.score.toFixed(0) + '점</b> <small>'
          + escapeHtml(shortDate_(best.date)) + ' · ' + escapeHtml(mood.word) + '</small>';
      }
      stage.classList.add('is-scrubbing');
    }
    panel.addEventListener('pointermove', scrub);
    panel.addEventListener('pointerdown', scrub);
    // 손가락은 떼는 순간 pointerleave가 와서 툴팁이 번쩍 사라진다 - 마우스일 때만 숨긴다.
    panel.addEventListener('pointerleave', function (event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      var stage = panel.querySelector('[data-rib-stage]');
      if (!stage) return;
      stage.classList.remove('is-scrubbing');
      stage.querySelectorAll('.mt-rib-cursor, .mt-rib-tip').forEach(function (el) { el.hidden = true; });
    });
  }

  // ---- ⑦ 시장 레이더 차트 ----

  // 2026-09-16: 주식/현금 비중 막대를 개인 투자자용 점검표로 바꿨다(ANT_GUIDE_BY_TONE 주석 참고).
  function buildStrategy(data) {
    var guide = antGuide(data);
    function list(items) {
      return items.map(function (text) { return '<li>' + escapeHtml(text) + '</li>'; }).join('');
    }
    return ''
      + '<div class="mt-strategy-panel mt-ant-guide mt-ant-' + guide.tone + '" id="mt-ant-guide">'
      + '<div class="mt-strategy-panel-title">🐜 오늘의 개미 체크리스트</div>'
      + '<div class="mt-strategy-action">' + escapeHtml(guide.title) + '</div>'
      + '<div class="mt-ant-mood">' + escapeHtml(guide.mood) + '</div>'
      + '<div class="mt-ant-list mt-ant-todo"><b>✅ 해볼 것</b><ul>' + list(guide.todo) + '</ul></div>'
      + '<div class="mt-ant-list mt-ant-avoid"><b>🚫 참을 것</b><ul>' + list(guide.avoid) + '</ul></div>'
      + '<div class="mt-strategy-note">매수·매도 추천이 아니라, 이런 분위기의 날 흔히 하는 실수를 막기 위한 점검표입니다.</div>'
      + '</div>';
  }

  function buildBriefingStrategy(data) {
    return '<div class="mt-section mt-card mt-briefing-strategy-card">'
      + '<div class="mt-briefing-strategy-grid">'
      + buildAiBriefingShell()
      + buildStrategy(data)
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
    var tone = crowdTone(data);

    // 2026-09-07 단순화. "지표가 10개라 아무도 안 본다"는 판단으로 첫 화면을
    // 숫자 하나 + 3축 + 추이로 줄였다. 10개 컴포넌트 막대는 '자세히'로 접어 내렸고,
    // 레이더 차트는 같은 값을 막대와 두 번 그리던 것이라 뺐다(row2col도 함께 사장).
    var sections = [
      // 2026-09-13 사용자 요청("정보가 너무 가로로 길게 되어 있어, PC에선 가독성이 떨어져.
      // 밑에 최근 단기흐름이랑 1:1 비율로 합쳐도 좋을꺼 같아"): ①②를 PC에서 한 줄에 1:1로
      // 둔다. 760px 이하에서는 예전처럼 위아래로 쌓는다(css .mt-summary-trend-row).
      '<div class="mt-summary-trend-row">'
        + buildSummaryCard(data)                    // ① 종합점수 · 어제 대비 · 돈/가격/위험
        + buildSparkline(data, false)               // ② 최근 추이
        + '</div>',
      '<details class="mt-section mt-detail-fold"><summary>자세히 - 지표 10개</summary>'
        + buildBars(data) + '</details>',           // ③ 접힌 상세
      buildBriefingStrategy(data),                  // ④ 시장 브리핑 + 오늘의 개미 체크리스트
      '<div data-industry-flow></div>',             // ⑤ 업종 TOP 당일·전일 흐름
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

    animateHistory(container);

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
    fetchMarketTempBriefing: fetchMarketTempBriefing,
    // 업종 TOP은 실시간 종목판 응답에서 파생돼 mock만으로는 화면을 못 그린다.
    // 로컬 하네스가 표본 데이터를 직접 넣어 레이아웃을 확인할 수 있게 열어둔다
    // (js/foreign-flow.js의 fetchJson 몽키패치와 같은 취지).
    renderIndustryFlow: renderIndustryFlow_,
    // 섹터 흐름도 같은 이유로 열어둔다 - /industry-flow 응답이 있어야 그려져서
    // mock만으로는 레이아웃을 볼 수 없다.
    renderSectorFlow: renderSectorFlow_
  };
  global.MarketTemp = MarketTemp;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
