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
  // 증시온도 탭 전용 팔레트. 회색은 로딩·비활성·데이터 대기 상태에만 쓴다.
  var MARKET_TEMP_PALETTE = {
    fear: '#1261c4',
    neutral: '#f2b632',
    greed: '#d24f45',
    standby: '#9ca3af'
  };
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
  // 'rates'(국고3년·미국10년 금리 부담도) / 'flow'(외국인+기관 통합 수급 전용 포맷)
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
    { key: 'exchange', label: '환율', max: 5, unit: 'pct', icon: '💵', barClass: 'mt-bar-fx', source: '원/달러 전일 대비',
      guide: '기본 2.5점에서 원/달러 전일 등락률을 뺀 값(원화 강세일수록 가점), 0~5점 범위',
      desc: '원/달러 환율 전일 대비 등락률(원화 강세=환율 하락일수록 가점)' },
    { key: 'rates', label: '금리 부담도', max: 10, unit: 'rates', icon: '🏦', barClass: 'mt-bar-risk', source: '국고3년·미국10년 금리',
      guide: '국고3년·미국10년 절대 금리 8점 + 당일 금리 변화 2점. 낮거나 내려가면 가점, 높거나 오르면 감점',
      desc: '금리가 높거나 빠르게 오르면 주식시장 할인율 부담이 커지므로 위험 축에 반영' },
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
  // 종합점수 3등급(서버 grade3)에 맞춰 "지금 할 일 / 오늘 금지"를 개인이 실제로 하는 행동으로 적는다.
  // 매수·매도 지시가 아니라 그런 분위기의 날 흔히 하는 실수를 막는 점검표다.
  var ANT_GUIDE_BY_TONE = {
    fear: {
      mood: '팔려는 사람이 더 많은 날',
      title: '공포일수록 아무 종목이나 팔지 말고, 기준을 지켜라',
      short: '공포 구간은 역발상 후보를 고르는 날입니다. 다만 보유 종목이 5일선을 종가로 깨면 미련 없이 정리합니다.',
      todo: ['보유 종목이 5일선을 종가로 깨면 정리한다. 못 하겠으면 1개월 버틸 근거를 먼저 적는다', '뉴스·공시 없이 같이 빠진 우량 후보만 관심종목에 남김', '신규 진입은 업종 TOP에서 돈이 남아 있는 종목만 확인'],
      avoid: ['손절도 못 하면서 물타기', '신용·미수로 평단 낮추기', '오늘 떨어진 이유도 모르고 장중에 급히 팔기']
    },
    neutral: {
      mood: '뚜렷한 방향이 없는 날',
      title: '중립일수록 추격하지 말고, 5일선을 기준으로 정리한다',
      short: '방향이 없는 날에는 억지로 매수하지 않습니다. 보유 종목은 5일선을 이틀 연속 깨면 정리할 가격을 미리 정합니다.',
      todo: ['업종 TOP 10에서 후보 3개만 고르고 차트에서 자리 확인', '보유 종목이 5일선을 이틀 연속 종가로 깨면 정리한다', '확신 없는 종목은 다음 장까지 기다림'],
      avoid: ['심심해서 하는 단타', '뉴스 제목 하나 보고 급등주 따라가기', '손절 기준 없는 신규 진입']
    },
    greed: {
      mood: '사려는 사람이 몰려 들뜬 날',
      title: '환희에는 사는 날이 아니라, 수익을 지키는 날이다',
      short: '과열 구간에서는 추격보다 매도가 우선입니다. 수익권 종목은 5일선 이탈을 남은 물량의 정리 기준으로 둡니다.',
      todo: ['수익권 종목은 익절선을 올리고 5일선 이탈 때 남은 물량을 정리한다', '급등주는 눌림 없이 따라가지 않음', '손절 못할 종목은 신규 진입 금지'],
      avoid: ['나만 못 벌까 봐 시장가 추격', '빚투·미수로 크게 베팅', '상한가 뉴스만 보고 늦게 올라타기']
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
    var score = Number(data && (data.score != null ? data.score : data.temp));
    var context = [];
    if (isFinite(score)) context.push('시장 점수 ' + Math.round(score) + '점');
    if (isFinite(risk)) context.push('위험 ' + Math.round(risk) + '점');
    if (isFinite(money)) context.push('자금 유입 ' + Math.round(money) + '점');

    // 등급 하나로 같은 문구를 반복하지 않는다. 오늘의 위험·자금 축이 어느 쪽으로
    // 기울었는지에 따라 "정리", "관망", "수익 보호" 중 우선 행동을 바꾼다.
    if (isFinite(risk) && risk >= 65) {
      todo[0] = '손절가를 깼으면 오늘 정리한다. 못 하겠으면 1개월 버틸 근거를 먼저 적는다';
      avoid.unshift('손실 종목의 평단만 낮추는 물타기');
      base = { tone: tone, mood: '위험 신호가 높아진 날', title: '오늘은 수익보다 계좌 방어가 먼저다', short: '' };
    } else if (isFinite(money) && money < 40) {
      todo[0] = '거래대금이 붙은 종목만 남기고, 나머지는 장 마감 뒤 다시 본다';
      avoid.unshift('돈이 없는 종목을 혼자만의 기대감으로 매수');
      base = { tone: tone, mood: '시장 안에 새 돈이 약한 날', title: '지금은 매수보다 후보 선별이 먼저다', short: '' };
    } else if (tone === 'greed' && isFinite(money) && money >= 60) {
      todo[0] = '수익권 종목은 익절선과 이탈가를 오늘 가격으로 올려 적는다';
      avoid.unshift('오른 종목을 놓칠까 봐 시장가로 추격 매수');
      base = { tone: tone, mood: '자금이 강하게 몰리는 날', title: '오늘은 진입보다 수익 보호 가격을 정한다', short: '' };
    }
    return { tone: tone, mood: base.mood, title: base.title, short: base.short, todo: todo, avoid: avoid, context: context.join(' · ') };
  }

  function emphasizeChecklist_(text) {
    var safe = escapeHtml(text);
    // 행동의 핵심 단어만 굵게 남겨, 긴 문장을 읽지 않아도 판단이 보이게 한다.
    ['손절가', '오늘 정리', '정리한다', '1개월 버틸', '5일선', '이틀 연속', '물타기', '신규 진입', '익절선', '이탈가', '추격 매수', '거래대금', '장 마감 뒤'].forEach(function (word) {
      safe = safe.replace(new RegExp(word, 'g'), '<strong>' + word + '</strong>');
    });
    return safe;
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
    function buildIndustryRankFlow_() {
      if (!shown.length) return '';
      var W = 640, H = 34 + shown.length * 34, leftX = 126, rightX = 514;
      function yOf(rank) { return 24 + (rank - 1) * 34; }
      function clampRank(rank) {
        rank = Number(rank);
        return isFinite(rank) && rank > 0 ? Math.min(shown.length, rank) : shown.length;
      }
      var paths = shown.map(function (row, index) {
        var rank = index + 1;
        var old = previousByName[row.industry];
        var fromRank = old ? clampRank(old.rank) : rank;
        var rate = Number(row.avg_change_rate != null ? row.avg_change_rate : row.avgChangeRate);
        var tone = rate > 0 ? 'up' : rate < 0 ? 'down' : 'flat';
        var y1 = yOf(fromRank), y2 = yOf(rank);
        var c1 = leftX + 130, c2 = rightX - 130;
        return '<path class="mt-if-bump-line mt-if-bump-' + tone + '" d="M' + leftX + ',' + y1
          + ' C' + c1 + ',' + y1 + ' ' + c2 + ',' + y2 + ' ' + rightX + ',' + y2 + '"></path>';
      }).join('');
      var left = shown.map(function (row, index) {
        var old = previousByName[row.industry];
        var rank = old ? clampRank(old.rank) : index + 1;
        return '<span style="top:' + (yOf(rank) - 10) + 'px"><em>' + rank + '</em>' + escapeHtml(row.industry || '-') + '</span>';
      }).join('');
      var right = shown.map(function (row, index) {
        var rate = Number(row.avg_change_rate != null ? row.avg_change_rate : row.avgChangeRate);
        var tone = rate > 0 ? 'up' : rate < 0 ? 'down' : 'flat';
        return '<span class="mt-if-bump-label-' + tone + '" style="top:' + (yOf(index + 1) - 10) + 'px"><em>'
          + (index + 1) + '</em>' + escapeHtml(row.industry || '-') + '</span>';
      }).join('');
      return '<div class="mt-if-bump" role="img" aria-label="직전 거래일과 오늘의 업종 순위 흐름">'
        + '<div class="mt-if-bump-title"><span>직전 순위</span><b>순위 흐름</b><span>오늘 순위</span></div>'
        + '<div class="mt-if-bump-stage" style="height:' + H + 'px">'
        + '<div class="mt-if-bump-labels mt-if-bump-left">' + left + '</div>'
        + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + paths + '</svg>'
        + '<div class="mt-if-bump-labels mt-if-bump-right">' + right + '</div>'
        + '</div></div>';
    }

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
      + '<div class="mt-industry-flow-head"><strong>주요 종목</strong><span>거래대금이 많이 몰린 순서 · TOP ' + shown.length + '</span></div>'
      + '<div class="mt-money-flow-table"><div class="mt-industry-flow-columns mt-money-flow-columns" aria-hidden="true"><span>순위</span><span>테마 업종</span><span>거래대금</span><span>평균등락</span><span>흐름</span></div>'
      + '<div class="mt-money-flow-grid">' + (html || '<div class="mt-hint">업종 흐름 데이터가 없습니다.</div>') + '</div></div>'
      + '<p class="mt-industry-flow-note">테마별 대표 종목 거래대금을 합산한 표입니다(약 240종목·37개 테마, 3분마다 갱신). 평균등락률은 보조지표입니다. ' + rankBasisText + ' 행을 누르면 대표 종목이 열립니다.</p>'
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


  // ---- 오늘 돈이 몰린 섹터 (증시온도 체크리스트 아래) ----
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

  function sectorFlowRowHtml_(row, index, rows, maxAmount) {
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
    var amount = Number(row.trade_amount);
    // 자금의 크기는 음영으로, 그 섹터의 방향은 붉은색(상승)·파란색(하락)으로 함께 읽는다.
    var fill = isFinite(amount) && maxAmount > 0 ? Math.max(4, amount / maxAmount * 100) : 0;
    return '<div class="mt-sf-item">'
      + '<button type="button" class="mt-sf-row ' + tone + '" data-sf-index="' + index + '" aria-expanded="false">'
      + '<i class="mt-sf-fill ' + tone + '" style="width:' + fill.toFixed(1) + '%" aria-hidden="true"></i>'
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
    var maxAmount = shown.reduce(function (max, row) {
      var amount = Number(row && row.trade_amount);
      return isFinite(amount) && amount > max ? amount : max;
    }, 0);
    var basis = '키움증권 테마 기준입니다. 오늘 많이 오른 테마 20개 중 구성종목 거래대금(현재가×거래량 추정)이 큰 순서입니다. 붉은 음영은 상승, 파란 음영은 하락이며 행을 누르면 구성종목과 함께 볼 섹터가 열립니다.';
    mount.innerHTML = '<div class="mt-section mt-card mt-sf-card">'
      + '<div class="mt-sf-visual-head"><span>오늘 돈이 몰린 섹터</span><small>음영 길이 = 거래대금 집중도 · 빨강 상승 · 파랑 하락</small></div>'
      + shown.map(function (row, i) { return sectorFlowRowHtml_(row, i, rows, maxAmount); }).join('')
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
    var requestedPanel = params.get('panel');
    var initialView = ['cards', 'all', 'heatmap', 'marketcap'].indexOf(requestedPanel) !== -1 ? requestedPanel : 'cards';
    return '<div class="mt-stocks-only">'
      + '<div class="mt-stocks-only-heading"><h1>국내 주요종목</h1><p>오늘 거래대금이 몰린 업종과 업종별 개별 종목을 함께 봅니다.</p></div>'
      + '<section class="mt-section-block">'
      + '<div class="mt-section-head"><h2>오늘 업종 TOP 10</h2><p>대표 종목 거래대금을 합산한 업종 순위입니다. 행을 누르면 구성 종목을 확인할 수 있습니다.</p></div>'
      + '<div data-industry-flow><div class="mt-hint">오늘 업종 순위를 불러오는 중입니다.</div></div>'
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
      loadIndustryFlow_(container);
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
        loadSectorFlow_(container);
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

    if (meta.unit === 'rates') {
      if (!comp || typeof comp.score !== 'number') return { text: '데이터 준비 중', tone: 'mt-val-zero' };
      var rateParts = [];
      if (typeof comp.ktb3y === 'number') rateParts.push('국고3년 ' + comp.ktb3y.toFixed(2) + '%');
      if (typeof comp.us10y === 'number') rateParts.push('미10년 ' + comp.us10y.toFixed(2) + '%');
      if (typeof comp.changeAvg === 'number') rateParts.push('변화 ' + (comp.changeAvg > 0 ? '+' : '') + comp.changeAvg.toFixed(2) + '%p');
      var rateTone = comp.score >= 6.5 ? 'mt-val-pos' : comp.score <= 3.5 ? 'mt-val-neg' : 'mt-val-zero';
      return { text: rateParts.join(' · ') || (comp.band || '금리 중립'), tone: rateTone };
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
      case 'rates': {
        if (typeof comp.score !== 'number') return null;
        if (comp.score >= 6.5) return { word: '완화', tone: 'mt-val-pos' };
        if (comp.score <= 3.5) return { word: '부담', tone: 'mt-val-neg' };
        return { word: '보통', tone: 'mt-val-zero' };
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
    // 위험은 안전/위험을 초록으로 표현하지 않는다. 낮음=파랑, 보통=노랑, 높음=빨강의
    // 경고 팔레트로 읽히게 하고 돈·가격 축만 기존 좋음/보통/나쁨 의미색을 유지한다.
    var tone = axis && axis.key === 'risk'
      ? (pct >= 65 ? 'mt-axis-risk-high' : pct >= 35 ? 'mt-axis-risk-mid' : 'mt-axis-risk-low')
      : (pct >= 65 ? 'mt-axis-good' : pct >= 35 ? 'mt-axis-mid' : 'mt-axis-bad');
    var question = axis && axis.question ? axis.question : ((axis && axis.key === 'money') ? '오늘 돈이 얼마나 들어왔나?' : (axis && axis.key === 'price') ? '가격이 얼마나 움직이나?' : '위험지표가 어느 수준인가?');
    return ''
      + '<div class="mt-axis-row">'
      + '<span class="mt-axis-name">' + icon + ' ' + escapeHtml((axis && axis.label) || '')
      + '<small>' + escapeHtml(question) + '</small></span>'
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

  // 0~100 점수 구간(공포·보통·과열)별 색 - 서버 market_temp_score.GRADE3 경계(40·61)와 같다.
  function zoneColor_(v) { return v < 40 ? '#4a90d9' : v < 61 ? '#d4a548' : '#d65f5f'; }

  // 점수 숫자는 왼쪽 요약에 한 번만 표기하고, 계기판은 바늘·눈금으로 위치를 보여준다.
  function buildScoreGauge(value, tone) {
    var pct = Math.max(0, Math.min(100, value));
    var cx = 160, cy = 116, radius = 86, tickCount = 41;
    var startAngle = 180, sweep = 180, ticks = '';
    for (var i = 0; i < tickCount; i++) {
      var tickValue = (i / (tickCount - 1)) * 100;
      var angle = startAngle - (sweep * i / (tickCount - 1));
      var outer = polarPoint_(cx, cy, radius, angle);
      var innerRadius = i % 5 === 0 ? radius - 13 : radius - 8;
      var inner = polarPoint_(cx, cy, innerRadius, angle);
      ticks += '<line class="mt-gauge-seg' + (tickValue <= pct ? ' is-lit' : '') + '" stroke="'
        + (tickValue <= pct ? zoneColor_(tickValue) : '#c6cbd1') + '"'
        + ' x1="' + inner.x.toFixed(2) + '" y1="' + inner.y.toFixed(2)
        + '" x2="' + outer.x.toFixed(2) + '" y2="' + outer.y.toFixed(2) + '"></line>';
    }
    var needleAngle = startAngle - sweep * pct / 100;
    var needle = polarPoint_(cx, cy, radius - 22, needleAngle);
    return ''
      + '<div class="mt-score-gauge mt-score-gauge-audi" role="img" aria-label="100점 만점에 ' + pct.toFixed(0) + '점">'
      + '<svg class="mt-score-gauge-dial mt-fade-in" viewBox="0 0 320 174" aria-hidden="true">'
      + ticks
      + '<line class="mt-gauge-needle" x1="' + cx + '" y1="' + cy + '" x2="' + needle.x.toFixed(2) + '" y2="' + needle.y.toFixed(2) + '"></line>'
      + '<circle class="mt-gauge-hub" cx="' + cx + '" cy="' + cy + '" r="7"></circle>'
      + '<text class="mt-gauge-scale-text" x="70" y="137">0</text>'
      + '<text class="mt-gauge-scale-text" x="250" y="137">100</text>'
      + '</svg>'
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
      + '<div class="mt-summary-topline"><span class="mt-summary-kicker">MARKET TEMPERATURE</span><span>오늘의 시장 체감</span></div>'
      + '<div class="mt-summary-main">'
      + '<div class="mt-summary-copy">'
      + '<strong class="mt-summary-score">' + value.toFixed(0) + '<small>/100</small></strong>'
      + '<div class="mt-summary-status"><b class="mt-summary-grade">' + escapeHtml(grade.emoji || '') + ' ' + escapeHtml(grade.label || '') + '</b>'
      + '<span class="mt-summary-change">' + deltaHtml + '</span></div>'
      + '<div class="mt-summary-mood">' + escapeHtml(guide.mood) + '</div>'
      + '</div><div class="mt-summary-dial">' + buildScoreGauge(value, guide.tone) + '</div></div>'
      // "그래서 뭐 어쩌라는거지?"에 대한 답을 점수 바로 밑에 한 줄로 둔다. 자세한 점검표는 아래 카드.
      + '<div class="mt-summary-sowhat"><b>그래서?</b><span>' + escapeHtml(guide.short) + '</span>'
      + '<a href="#mt-ant-guide">체크리스트 ↓</a></div>'
      + (rows ? '<div class="mt-summary-section-title">점수를 만든 세 가지</div><div class="mt-axis-list">' + rows + '</div>' : '')
      // 상승·하락 종목 수는 2026-09-02 사용자 요청으로 들어간 기능이라 단순화하면서도
      // 버리지 않는다 - 옛 Hero 카드에 있던 것을 여기로 옮겼다.
      + buildBreadth(data)
      + '<div class="mt-summary-note">0~39점은 공포, 40~60점은 보통, 61점부터 과열입니다. <b>돈이 얼마나 들어왔는지 · 가격이 얼마나 움직이는지 · 위험지표가 어느 수준인지</b>를 같은 비중으로 읽고, 위험은 높을수록 감점합니다. 공포에는 후보를 고르고 환희에는 수익을 지키는 역발상 기준입니다.</div>'
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
      + '<div class="mt-briefing-panel-title">' + MT_AI_ICON + ' 참고의견 <small>Groq 시장 해석</small></div>'
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
      + '<details class="mt-score-method"><summary>점수·계산 기준·데이터 출처 보기</summary><p>100점 만점입니다. 지표를 돈(거래대금·수급)·가격(평균등락률·상승비율·섹터강도)·위험(VIX·환율·금리·빚투) 세 묶음으로 나눠 각 묶음은 점수÷만점의 평균, 종합점수는 세 묶음의 평균입니다(위험은 뒤집어 안전도로 넣음). 0~39점 공포 · 40~60점 보통 · 61점 이상 과열. 미국 선물지수는 참고로만 보여주고 종합점수에는 넣지 않습니다. 투자 권유가 아닙니다.</p><ul>' + methodRows + '</ul></details>'
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
  function marketMood_(score) {
    return MARKET_MOOD[scoreTone_(score)];
  }

  function scoreTone_(score) {
    return score < 40 ? 'fear' : score < 61 ? 'neutral' : 'greed';
  }

  function shortDate_(date) {
    var match = /^\d{4}-(\d{2})-(\d{2})/.exec(String(date || ''));
    return match ? parseInt(match[1], 10) + '/' + parseInt(match[2], 10) : String(date || '');
  }

  function signedPoints_(value) {
    var rounded = Math.round(value);
    return (rounded > 0 ? '+' : '') + rounded + '점';
  }

  function tomorrowFlow_(days, shown, baseline) {
    // 오늘 수치를 "내일"로 잘못 읽는 것을 막기 위해, 오늘까지 확정된 변화만으로
    // 다음 거래일 방향을 가설화한다. 같은 식을 과거 구간에도 적용해 일치율을 함께 낸다.
    function signalAt_(series, index) {
      if (index < 3) return null;
      var recent = series.slice(index - 3, index + 1);
      var latest = recent[3];
      var shortAverage = recent.reduce(function (sum, day) { return sum + day.score; }, 0) / recent.length;
      return (latest.score - recent[0].score) * 0.45
        + (latest.score - recent[2].score) * 0.35
        + (latest.score - shortAverage) * 0.2;
    }
    var latest = shown[shown.length - 1];
    if (!latest || shown.length < 4) return null;
    var signal = signalAt_(shown, shown.length - 1);
    if (signal == null) return null;
    var sample = 0;
    var hit = 0;
    for (var i = 3; i < days.length - 1; i += 1) {
      var historicSignal = signalAt_(days, i);
      var actualMove = days[i + 1].score - days[i].score;
      if (historicSignal == null || Math.abs(historicSignal) < 2 || Math.abs(actualMove) < 1) continue;
      sample += 1;
      if ((historicSignal > 0 && actualMove > 0) || (historicSignal < 0 && actualMove < 0)) hit += 1;
    }
    var hitRate = sample ? hit / sample : null;
    var reliable = sample >= 4 && hitRate >= 0.55;
    var label = !reliable ? '방향 확인 필요' : signal >= 4 ? '상승 흐름 우세' : signal <= -4 ? '하락 흐름 경계' : '횡보 가능성';
    var tone = !reliable ? 'flat' : signal >= 4 ? 'up' : signal <= -4 ? 'down' : 'flat';
    var reason = '오늘까지 최근 4거래일 신호 ' + signedPoints_(signal)
      + (hitRate == null ? ' · 과거 비교 표본 부족' : ' · 과거 ' + sample + '회 중 ' + hit + '회 방향 일치(' + Math.round(hitRate * 100) + '%)');
    return '<div class="mt-tomorrow-flow mt-tomorrow-' + tone + '">'
      + '<span><small>다음 거래일 가설</small><b>' + label + '</b></span><p>' + escapeHtml(reason)
      + '<small>오늘 종가까지의 온도 변화만 사용한 과거 비교입니다. 표본이 적거나 일치율이 낮으면 방향을 단정하지 않습니다.</small></p></div>';
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
    var fiveRows = shown.slice(-5);
    var fiveAverage = fiveRows.reduce(function (sum, item) { return sum + item.score; }, 0) / fiveRows.length;

    var W = 640, H = 238, PX = 56, PT = 17, PB = 16;
    var plotH = H - PT - PB;
    function yOf(value) { return PT + (1 - Math.max(0, Math.min(100, value)) / 100) * plotH; }
    function pctX(x) { return (x / W * 100).toFixed(2); }
    function pctY(y) { return (y / H * 100).toFixed(2); }
    var stepX = (W - PX * 2) / (shown.length - 1);
    var points = shown.map(function (item, i) {
      return { x: PX + i * stepX, y: yOf(item.score), score: item.score, date: item.date };
    });
    var line = 'M' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1) + points.slice(1).map(function (point, i) {
      return smoothSegment_(points, i).replace(/^M\S+\s/, ' ');
    }).join('');
    var floor = yOf(0).toFixed(1);
    var now = points[points.length - 1];
    var area = line + ' L' + now.x.toFixed(1) + ',' + floor + ' L' + points[0].x.toFixed(1) + ',' + floor + ' Z';
    var bands = '<rect class="mt-rib-band mt-rib-band-greed" x="' + PX + '" y="' + yOf(100).toFixed(1) + '" width="' + (W - PX * 2) + '" height="' + (yOf(61) - yOf(100)).toFixed(1) + '"></rect>'
      + '<rect class="mt-rib-band mt-rib-band-neutral" x="' + PX + '" y="' + yOf(61).toFixed(1) + '" width="' + (W - PX * 2) + '" height="' + (yOf(40) - yOf(61)).toFixed(1) + '"></rect>'
      + '<rect class="mt-rib-band mt-rib-band-fear" x="' + PX + '" y="' + yOf(40).toFixed(1) + '" width="' + (W - PX * 2) + '" height="' + (yOf(0) - yOf(40)).toFixed(1) + '"></rect>';
    var guides = [61, 40].map(function (value) {
      return '<line class="mt-rib-border" x1="' + PX + '" y1="' + yOf(value).toFixed(1) + '" x2="' + (W - PX)
        + '" y2="' + yOf(value).toFixed(1) + '"></line>';
    }).join('');
    function markerCircle(className, point, radius) {
      return '<circle class="' + className + '" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + radius + '"></circle>';
    }
    var dots = points.slice(0, -1).map(function (point) {
      return markerCircle('mt-rib-dot mt-rib-tone-' + scoreTone_(point.score), point, 3);
    }).join('');
    var nowTone = scoreTone_(now.score);
    var svg = '<svg class="mt-rib-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="최근 ' + shown.length + '거래일 종합점수 흐름">'
      + bands
      + guides
      + '<line class="mt-rib-avg" x1="' + PX + '" y1="' + yOf(baseline).toFixed(1) + '" x2="' + (W - PX) + '" y2="' + yOf(baseline).toFixed(1) + '"></line>'
      + '<line class="mt-rib-avg5" x1="' + PX + '" y1="' + yOf(fiveAverage).toFixed(1) + '" x2="' + (W - PX) + '" y2="' + yOf(fiveAverage).toFixed(1) + '"></line>'
      + '<path class="mt-rib-area" d="' + area + '"></path>'
      + '<path class="mt-rib-line mt-spark-draw" d="' + line + '"></path>'
      + dots
      + markerCircle('mt-rib-now mt-rib-tone-' + nowTone, now, 5)
      + '</svg>';
    // 구간 이름과 평균선은 SVG 밖에 둬 모바일에서도 읽을 수 있게 한다.
    var overlay = [['greed', '과열', 80.5], ['neutral', '보통', 50.5], ['fear', '공포', 20]].map(function (zone) {
      return '<span class="mt-rib-zone-label mt-rib-tone-' + zone[0] + '" style="top:' + pctY(yOf(zone[2])) + '%">' + zone[1] + '</span>';
    }).join('')
      + '<span class="mt-rib-avg-label mt-rib-avg30-label" style="top:' + pctY(yOf(baseline)) + '%">30일 평균</span>'
      + '<span class="mt-rib-avg-label mt-rib-avg5-label" style="top:' + pctY(yOf(fiveAverage)) + '%">5일 평균</span>'
      + '<i class="mt-rib-cursor" hidden></i><div class="mt-rib-tip" hidden></div>';
    var pointData = points.map(function (point) {
      return pctX(point.x) + ',' + pctY(point.y) + ',' + point.score.toFixed(0) + ',' + point.date;
    }).join(';');

    // 날짜별 상태는 가는 색 막대로 남긴다. 정확한 점수는 차트 툴팁과 접근성 이름에서 확인한다.
    var stripCount = Math.min(shown.length, 10);
    var strip = '';
    for (var s = 0; s < stripCount; s++) {
      var index = Math.round(s * (shown.length - 1) / (stripCount - 1));
      var day = shown[index];
      var mood = marketMood_(day.score);
      var dayDescription = escapeHtml(day.date + ' ' + day.score.toFixed(0) + '점 · ' + mood.word);
      strip += '<li class="mt-weather-day mt-rib-tone-' + scoreTone_(day.score) + (index === shown.length - 1 ? ' is-today' : '')
        + '" style="--mt-i:' + s + '" title="' + dayDescription + '" aria-label="' + dayDescription + '">'
        + '<span class="mt-weather-mark" aria-hidden="true"></span><small>' + escapeHtml(shortDate_(day.date)) + '</small></li>';
    }

    var low = shown.reduce(function (a, b) { return b.score < a.score ? b : a; });
    var high = shown.reduce(function (a, b) { return b.score > a.score ? b : a; });
    var moodCounts = shown.reduce(function (counts, day) {
      counts[scoreTone_(day.score)] += 1;
      return counts;
    }, { fear: 0, neutral: 0, greed: 0 });
    var periodDelta = now.score - points[0].score;
    var periodTone = periodDelta > 0 ? 'mt-val-pos' : periodDelta < 0 ? 'mt-val-neg' : 'mt-val-zero';
    var tomorrow = tomorrowFlow_(days, shown, baseline) || '';
    var metrics = '<div class="mt-history-metrics">'
      + '<span><small>5일 평균</small><b>' + fiveAverage.toFixed(0) + '점</b></span>'
      + '<span><small>30일 평균</small><b>' + baseline.toFixed(0) + '점</b></span>'
      + '<span><small>가장 낮았던 날</small><b><i class="mt-history-mood-dot mt-rib-tone-' + scoreTone_(low.score) + '"></i>' + low.score.toFixed(0) + '점 <em>' + escapeHtml(shortDate_(low.date)) + '</em></b></span>'
      + '<span><small>가장 높았던 날</small><b><i class="mt-history-mood-dot mt-rib-tone-' + scoreTone_(high.score) + '"></i>' + high.score.toFixed(0) + '점 <em>' + escapeHtml(shortDate_(high.date)) + '</em></b></span>'
      + '</div>';
    return '<div class="mt-history-chart-meta"><span>최근 ' + shown.length + '거래일</span>'
      + '<b class="' + periodTone + '">기간 변화 ' + (periodDelta > 0 ? '▲ ' : periodDelta < 0 ? '▼ ' : '— ') + signedPoints_(periodDelta) + '</b></div>'
      + '<div class="mt-rib-stage mt-rib-anim" data-rib-stage data-rib-points="' + escapeHtml(pointData) + '">' + svg + overlay + '</div>'
      + '<ol class="mt-weather-strip mt-rib-anim">' + strip + '</ol>'
      + '<div class="mt-history-balance"><span class="fear">공포 <b>' + moodCounts.fear + '일</b></span><span class="neutral">보통 <b>' + moodCounts.neutral + '일</b></span><span class="greed">과열 <b>' + moodCounts.greed + '일</b></span></div>'
      + tomorrow
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
      + '<div class="mt-history-tail-head"><div class="mt-card-title">최근 단기흐름</div><div class="mt-flow-periods" role="tablist" aria-label="단기흐름 기간">' + buttons + '</div></div>'
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
      return items.map(function (text) { return '<li>' + emphasizeChecklist_(text) + '</li>'; }).join('');
    }
    return ''
      + '<div class="mt-strategy-panel mt-ant-guide mt-ant-' + guide.tone + '" id="mt-ant-guide">'
      + '<div class="mt-strategy-panel-title">🐜 오늘의 개미 체크리스트</div>'
      + '<div class="mt-strategy-action">' + escapeHtml(guide.title) + '</div>'
      + '<div class="mt-ant-mood">' + escapeHtml(guide.mood) + '</div>'
      + '<div class="mt-ant-context">' + escapeHtml(guide.context) + '</div>'
      + '<div class="mt-ant-list mt-ant-todo"><b>✅ 지금 할 일</b><ul>' + list(guide.todo) + '</ul></div>'
      + '<div class="mt-ant-list mt-ant-avoid"><b>🚫 오늘 금지</b><ul>' + list(guide.avoid) + '</ul></div>'
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

  function buildTemperatureActions() {
    return '<div class="mt-temperature-actions">'
      + '<section class="mt-section-block mt-temperature-money-flow">'
      + '<div class="mt-section-head"><h2>오늘 돈이 몰린 섹터</h2><p>거래대금과 평균 등락률을 함께 보고, 강한 테마의 종목과 연결 섹터를 확인합니다.</p></div>'
      + '<div data-sector-flow><div class="mt-hint">오늘 자금 흐름을 불러오는 중입니다.</div></div>'
      + '</section></div>';
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
  // 3가지 방법(카드 보기: 전종목 카드, 히트맵 보기: 섹터 풀 등락률 히트맵, 시총비례 히트맵:
  // 트리맵)을 탭으로 전환한다. 셋 다 js/sector-dashboard-v4.js·js/marketcap-bubble.js를
  // 그대로 재사용(로직 복붙 없음) - sectors-v3.js/krx_map.js/sector-dashboard-v4.js/
  // marketcap-codes.js/marketcap-bubble.js가 이 페이지에 함께 로드돼 있어야 동작한다.
  // 탭은 최초 활성화 시에만 로드한다(foreign-flow.js의 wireViewTabs와 동일 패턴 - hidden
  // 상태에서 차트를 그리면 크기가 0이 되는 문제를 피하기 위해 보여진 뒤에 그린다).
  // 전종목은 한 번에 수천 건을 그리거나 구독하지 않는다. 책 한 쪽만(48종목) 조회해
  // 서버·브라우저 부담을 일정하게 제한하고, 이전/다음 장으로 넘긴다.
  var KRX_MAP_JS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
  var WICS_MAP_JS_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/wics-map.js';
  var ALL_STOCKS_PAGE_SIZE = 48;
  var ALL_STOCKS_BATCH_SIZE = 60;
  var krxMapLoadPromise_ = null;
  var wicsMapLoadPromise_ = null;
  // 카드에는 실거래가 있는 주요 종목만 필요하다. 공유 시장판의 거래대금·거래량 등
  // 순위 목록을 재사용하고, 이 요청이 실패할 때만 일일 스캔으로 대체한다.
  var ACTIVE_STOCK_BOARD_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=40';
  var ACTIVE_STOCK_MIN_AMOUNT = 5000000000;
  var ACTIVE_STOCK_MIN_VOLUME = 10000;
  var ACTIVE_SECTOR_MIN_AMOUNT = 50000000000;
  var allStockSnapshotCache_ = null;
  var allStockSnapshotPromise_ = null;

  function ensureKrxMap_() {
    if (global.KRX_MAP && typeof global.KRX_MAP === 'object') return Promise.resolve(global.KRX_MAP);
    if (krxMapLoadPromise_) return krxMapLoadPromise_;
    krxMapLoadPromise_ = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = KRX_MAP_JS_URL;
      script.async = true;
      script.onload = function () {
        if (global.KRX_MAP && Object.keys(global.KRX_MAP).length) resolve(global.KRX_MAP);
        else {
          krxMapLoadPromise_ = null;
          reject(new Error('KRX 종목 목록이 비어 있습니다.'));
        }
      };
      script.onerror = function () {
        krxMapLoadPromise_ = null;
        reject(new Error('KRX 종목 목록을 불러오지 못했습니다.'));
      };
      document.head.appendChild(script);
    });
    return krxMapLoadPromise_;
  }

  // 전종목을 거래소만으로 나누면 한 카드에 수십 종목이 쌓여 사진처럼 읽기 어렵다.
  // WICS의 대분류(에너지·소재·금융 등)를 가져와 같은 큰 업종 카드 안에 배치한다.
  function ensureWicsMap_() {
    if (global.WICS_MAP && typeof global.WICS_MAP === 'object') return Promise.resolve(global.WICS_MAP);
    if (wicsMapLoadPromise_) return wicsMapLoadPromise_;
    wicsMapLoadPromise_ = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = WICS_MAP_JS_URL;
      script.async = true;
      script.onload = function () {
        if (global.WICS_MAP && Object.keys(global.WICS_MAP).length) resolve(global.WICS_MAP);
        else {
          wicsMapLoadPromise_ = null;
          reject(new Error('업종 분류가 비어 있습니다.'));
        }
      };
      script.onerror = function () {
        wicsMapLoadPromise_ = null;
        reject(new Error('업종 분류를 불러오지 못했습니다.'));
      };
      document.head.appendChild(script);
    });
    return wicsMapLoadPromise_;
  }

  function allListedStocks_(krxMap, wicsMap) {
    // krx_map에는 ETF도 함께 들어 있다. 같은 파일이 제공하는 정확한 ETF 이름 목록으로
    // 제외하고, ETN은 이름에 명시된 상품만 뺀다. 종목명·현재가·등락률만 보는 이 탭의
    // 모집단을 KOSPI/KOSDAQ 상장주로 한정하기 위함이다.
    var etfNames = {};
    (global.KRX_ETF_NAMES || []).forEach(function (name) { etfNames[name] = true; });
    var seenCodes = {};
    var kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    function hash(value) {
      var result = 0;
      for (var i = 0; i < value.length; i += 1) result = ((result * 31) + value.charCodeAt(i)) | 0;
      return result >>> 0;
    }
    return Object.keys(krxMap || {}).map(function (name) {
      var code = String(krxMap[name] || '').toUpperCase();
      var classification = (wicsMap || {})[code] || {};
      return { name: name, code: code, sector: String(classification.sector || '기타') };
    }).filter(function (item) {
      if (!/^[0-9A-Z]{6}$/.test(item.code) || etfNames[item.name]) return false;
      if (/(?:^|\s)ETN(?:\s|$)/i.test(item.name) || seenCodes[item.code]) return false;
      seenCodes[item.code] = true;
      return true;
    }).sort(function (a, b) {
      // 매번 섞이면 페이지·검색을 누를 때 종목 위치가 흔들린다. KST 날짜를 씨앗으로
      // 고정해 하루 동안은 같은 무작위 배열을 유지하고 다음 거래일에는 새 조합을 보여준다.
      return hash(a.code + kstDay) - hash(b.code + kstDay);
    });
  }

  function fetchAllStockQuotes_(codes) {
    var batches = [];
    for (var i = 0; i < codes.length; i += ALL_STOCKS_BATCH_SIZE) batches.push(codes.slice(i, i + ALL_STOCKS_BATCH_SIZE));
    function fetchBatch_(batch, retried) {
      return fetchJson_(GAS_TICKER_URL + '?codes=' + batch.join(',') + '&_=' + Date.now()).then(function (rows) {
        if (rows && rows.length) return rows;
        if (retried) throw new Error('empty quote response');
        return fetchBatch_(batch, true);
      }).catch(function (error) {
        if (retried) throw error;
        return fetchBatch_(batch, true);
      });
    }
    return Promise.all(batches.map(function (batch) {
      return fetchBatch_(batch, false);
    })).then(function (results) {
      return results.reduce(function (all, rows) { return all.concat(rows || []); }, []);
    });
  }

  // 보합이라는 이유만으로 활발한 대형주를 버리지 않는다. 종목은 거래대금·실제
  // 거래량, 섹터는 합계 거래대금과 구성 종목 수로 판단한다. 스캔 폴백에는 거래량
  // 필드가 없으므로 거래대금만 적용하며, 없는 거래량을 가격으로 역산하지 않는다.
  function activeStockGroups_(scan, wicsMap) {
    var board = scan && scan.data && Array.isArray(scan.data.rows);
    var etfNames = {};
    (global.KRX_ETF_NAMES || []).forEach(function (name) { etfNames[name] = true; });
    var rows = (board ? scan.data.rows : universeRows_(scan, {})).filter(function (row) {
      return isFinite(row.price) && row.price > 0 && isFinite(row.changeRate)
        && isFinite(row.tradingValue) && row.tradingValue >= ACTIVE_STOCK_MIN_AMOUNT
        && (!board || (isFinite(row.volume) && row.volume >= ACTIVE_STOCK_MIN_VOLUME))
        && !etfNames[row.name] && !/(?:ETF|ETN|스팩|SPAC)/i.test(row.name);
    }).map(function (row) {
      var classification = (wicsMap || {})[row.code] || {};
      row.sector = String(classification.sector || industryThemeName_(row) || '');
      return row;
    }).filter(function (row) { return row.sector && row.sector !== '기타' && row.sector !== '미분류'; });
    var bySector = {};
    rows.forEach(function (row) {
      if (!bySector[row.sector]) bySector[row.sector] = [];
      bySector[row.sector].push(row);
    });
    return Object.keys(bySector).map(function (sector) {
      var members = bySector[sector].sort(function (a, b) { return b.tradingValue - a.tradingValue; });
      return { sector: sector, rows: members.slice(0, 12), total: members.reduce(function (sum, row) { return sum + row.tradingValue; }, 0) };
    }).filter(function (group) { return group.rows.length >= 2 && group.total >= ACTIVE_SECTOR_MIN_AMOUNT; })
      .sort(function (a, b) { return b.total - a.total || a.sector.localeCompare(b.sector, 'ko'); }).slice(0, 10);
  }

  function activeStockBoardSnapshot_(payload) {
    var data = payload && payload.data || {};
    var sections = data.sections || {};
    var rows = (data.rows || []).slice();
    Object.keys(sections).forEach(function (key) {
      if (key !== 'industry' && Array.isArray(sections[key])) rows = rows.concat(sections[key]);
    });
    var seen = {};
    rows = rows.filter(function (row) {
      var code = String(row && row.code || '');
      if (!/^[0-9A-Z]{6}$/.test(code) || seen[code]) return false;
      seen[code] = true;
      return true;
    }).map(function (row) {
      return { code: String(row.code), name: String(row.name || row.code), price: Number(row.price),
        changeRate: Number(row.change_rate), tradingValue: Number(row.trade_amount), volume: Number(row.trade_volume),
        industry: row.industry || '', market: row.market === 'KOSPI' || row.market === 'KOSDAQ' ? row.market : '' };
    });
    if (!rows.length) throw new Error('empty active stock board');
    var timestamp = Number(data.updated_at);
    return { data: { rows: rows, scannedAt: isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '' } };
  }

  // 대용량 스캔 스냅샷이 늦어져도 카드 전체를 오류로 바꾸지 않는다. 정적 상장 목록을
  // 먼저 업종별로 열고, 보이는 행의 시세만 GAS에서 뒤늦게 채우는 안전망이다.
  function listedStockGroups_(krxMap, wicsMap) {
    var grouped = {};
    allListedStocks_(krxMap, wicsMap).forEach(function (item) {
      var sector = item.sector || '기타';
      if (!grouped[sector]) grouped[sector] = [];
      grouped[sector].push(item);
    });
    return Object.keys(grouped).map(function (sector) {
      var rows = grouped[sector].sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }).slice(0, 18);
      return { sector: sector, rows: rows, total: rows.length };
    }).filter(function (group) { return group.rows.length; }).sort(function (a, b) { return b.rows.length - a.rows.length || a.sector.localeCompare(b.sector, 'ko'); });
  }

  // 기존 관심섹터와 같은 행·카드 구조를 유지하되, 카드는 WICS 대분류로 나눈다.
  // 따라서 한 카드 안에서 같은 업종의 여러 종목을 현재가·등락률과 함께 바로 비교한다.
  function allStockCardsHtml_(items, byCode, summaries) {
    var groups = {};
    (items || []).forEach(function (item) {
      var quote = byCode[item.code] || {};
      var sector = item.sector || '기타';
      if (!groups[sector]) groups[sector] = [];
      groups[sector].push({ item: item, quote: quote });
    });
    return Object.keys(groups).sort(function (a, b) {
      var totals = summaries || {};
      return ((totals[b] || {}).total || 0) - ((totals[a] || {}).total || 0) || a.localeCompare(b, 'ko');
    }).map(function (sector) {
      var rows = groups[sector].map(function (entry) {
        var quote = entry.quote && Object.keys(entry.quote).length ? entry.quote : entry.item;
        var rate = Number(quote.changeRate);
        var direction = isFinite(rate) && rate > 0 ? 'sector-up' : isFinite(rate) && rate < 0 ? 'sector-down' : 'sector-flat';
        var rateText = isFinite(rate) ? (rate > 0 ? '▲' : rate < 0 ? '▼' : '—') + Math.abs(rate).toFixed(2) + '%' : '-';
        var priceText = isFinite(Number(quote.price)) && Number(quote.price) > 0 ? universeNumber_(quote.price) + '원' : '시세 확인 중';
        var market = quote.market === 'KOSPI' || quote.market === 'KOSDAQ' ? quote.market : '';
        return '<button type="button" class="sector-row mt-all-stock-row ' + direction + '" data-all-stock-code="' + escapeHtml(entry.item.code) + '" data-all-stock-name="' + escapeHtml(entry.item.name) + '" aria-label="' + escapeHtml(entry.item.name) + ' 실시간 시세 보기">'
          + '<span class="sector-row-name"><i class="mt-all-stock-dot ' + direction + '" aria-hidden="true"></i>' + escapeHtml(entry.item.name) + (market ? '<small class="mt-all-stock-market ' + market.toLowerCase() + '">' + market + '</small>' : '') + '</span>'
          + '<span><span class="sector-row-price">' + priceText + '</span><span class="sector-row-rate ' + direction + '">' + rateText + '</span></span>'
          + '</button>';
      }).join('');
      var summary = (summaries || {})[sector];
      return '<section class="sector-card"><div class="sector-card-title">' + escapeHtml(sector) + ' <small>' + groups[sector].length + '종목</small>'
        + (summary ? '<span class="mt-all-stock-sector-total">' + formatFlowAmount_(summary.total) + '</span>' : '') + '</div>' + rows + '</section>';
    }).join('');
  }

  function requestAllStockSnapshot_() {
    if (allStockSnapshotCache_) return Promise.resolve(allStockSnapshotCache_);
    if (allStockSnapshotPromise_) return allStockSnapshotPromise_;
    allStockSnapshotPromise_ = fetchJson_(ACTIVE_STOCK_BOARD_URL).then(activeStockBoardSnapshot_)
      .catch(function () { return fetchJson_(INVEST_SIGNAL_URL); }).then(function (snapshot) {
      allStockSnapshotCache_ = snapshot;
      allStockSnapshotPromise_ = null;
      return snapshot;
    }, function (error) {
      allStockSnapshotPromise_ = null;
      throw error;
    });
    return allStockSnapshotPromise_;
  }

  function renderAllStockRetry_(panel, empty) {
    panel.innerHTML = '<div class="mt-hint mt-all-stock-retry"><strong>' + (empty ? '현재 기준에 맞는 주요 섹터가 없습니다.' : '주요 섹터 시세를 불러오지 못했습니다.')
      + '</strong><span>거래대금 50억원 이상인 종목이 2개 이상 · 섹터 합계 500억원 이상</span><button type="button" data-all-stock-retry>다시 연결</button></div>';
    var retry = panel.querySelector('[data-all-stock-retry]');
    if (retry) retry.addEventListener('click', function () {
      allStockSnapshotCache_ = null;
      panel.__allStockBrowser = false;
      loadAllStocksPanel(panel);
    });
  }

  function loadAllStocksPanel(panel) {
    if (!panel || panel.__allStockBrowser) return;
    panel.__allStockBrowser = true;
    panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>거래가 활발한 주요 섹터를 불러오는 중...</div>';

    var snapshotRequest = requestAllStockSnapshot_();
    Promise.all([ensureKrxMap_().catch(function () { return {}; }), ensureWicsMap_().catch(function () { return {}; }), snapshotRequest]).then(function (results) {
      var snapshot = results[2];
      var allGroups = snapshot ? activeStockGroups_(snapshot, results[1]) : [];
      var isBoard = snapshot && snapshot.data && Array.isArray(snapshot.data.rows);
      var scannedAt = snapshot && snapshot.data && snapshot.data.scannedAt ? String(snapshot.data.scannedAt).replace('T', ' ') : '시각 확인 중';
      var state = { query: '', page: 0 };
      if (!allGroups.length) {
        renderAllStockRetry_(panel, true);
        return;
      }

      function filteredGroups() {
        var query = state.query.toLowerCase();
        if (!query) return allGroups;
        return allGroups.map(function (group) {
          return { sector: group.sector, total: group.total, rows: group.rows.filter(function (item) {
            return item.name.toLowerCase().indexOf(query) !== -1 || item.code.toLowerCase().indexOf(query) !== -1;
          }) };
        }).filter(function (group) { return group.rows.length; });
      }

      function openStock(item) {
        global.location.href = '/page/stock-search?code=' + encodeURIComponent(item.code) + '&name=' + encodeURIComponent(item.name);
      }

      function visibleItems_(groups) {
        return groups.reduce(function (out, group) {
          return out.concat(group.rows.map(function (item) {
            return { code: item.code, name: item.name, sector: group.sector, price: item.price, changeRate: item.changeRate, market: item.market };
          }));
        }, []);
      }

      function render() {
        var groups = filteredGroups();
        var pageCount = Math.max(1, Math.ceil(groups.length / 4));
        state.page = Math.min(Math.max(0, state.page), pageCount - 1);
        var shownGroups = groups.slice(state.page * 4, state.page * 4 + 4);
        var visible = visibleItems_(shownGroups);
        var total = groups.reduce(function (sum, group) { return sum + group.rows.length; }, 0);
        var summaries = {};
        shownGroups.forEach(function (group) { summaries[group.sector] = group; });
        panel.innerHTML = '<section class="mt-all-stock-browser">'
          + '<div class="mt-all-stock-head"><div><strong>주요 섹터 카드</strong><span>거래가 활발한 섹터만 · 최대 10개</span></div><span data-all-stock-count>' + total.toLocaleString('ko-KR') + '종목 · ' + escapeHtml(scannedAt) + ' 기준' + (isBoard ? '' : ' · 일일 스캔') + '</span></div>'
          + '<div class="mt-all-stock-toolbar"><label><span class="mt-all-stock-search-label">종목 검색</span><input type="search" data-all-stock-search placeholder="종목명 또는 코드" value="' + escapeHtml(state.query) + '" autocomplete="off"></label><button type="button" data-all-stock-refresh>목록 새로고침</button></div>'
          + '<p class="mt-all-stock-legend"><b>현재가</b> · <b class="mt-legend-up">▲ 상승</b> · <b class="mt-legend-down">▼ 하락</b> · 종목 거래대금 50억원 이상' + (isBoard ? ' · 거래량 1만 주 이상' : ' · 스캔값은 거래량 미제공') + '<br>조회된 종목의 섹터 합계 500억원 이상 · 2종목 이상 · 섹터당 거래대금 상위 12종목 · ETF·ETN·스팩 제외</p>'
          + '<div class="sector-cards-grid mt-all-stock-sector-grid" data-all-stock-grid>' + (visible.length ? allStockCardsHtml_(visible, {}, summaries) : '<div class="mt-hint">주요 섹터 내에 찾는 종목이 없습니다.</div>') + '</div>'
          + '<div class="mt-all-stock-pagination"><button type="button" data-all-stock-prev' + (state.page === 0 ? ' disabled' : '') + '>‹ 이전 업종</button><span>' + (state.page + 1) + ' / ' + pageCount + '쪽 · 업종 ' + groups.length + '개</span><button type="button" data-all-stock-next' + (state.page >= pageCount - 1 ? ' disabled' : '') + '>다음 업종 ›</button></div>'
          + '</section>';
        var input = panel.querySelector('[data-all-stock-search]');
        var grid = panel.querySelector('[data-all-stock-grid]');
        input.addEventListener('input', function () {
          var cursor = input.selectionStart;
          state.query = input.value;
          state.page = 0;
          render();
          var replacement = panel.querySelector('[data-all-stock-search]');
          replacement.focus();
          // search 타입은 일부 브라우저에서 setSelectionRange를 지원하지 않는다.
          try { replacement.setSelectionRange(cursor, cursor); } catch (ignore) {}
        });
        var previous = panel.querySelector('[data-all-stock-prev]');
        var next = panel.querySelector('[data-all-stock-next]');
        var refresh = panel.querySelector('[data-all-stock-refresh]');
        if (previous) previous.addEventListener('click', function () { state.page -= 1; render(); });
        if (next) next.addEventListener('click', function () { state.page += 1; render(); });
        if (refresh) refresh.addEventListener('click', function () {
          // 사용자가 명시적으로 새로고침을 누를 때만 보관한 스냅샷을 비운다.
          // 초기 진입·페이지 이동은 같은 응답을 써서 대용량 요청을 중복하지 않는다.
          allStockSnapshotCache_ = null;
          panel.__allStockBrowser = false;
          loadAllStocksPanel(panel);
        });
        function wireCards() {
          grid.querySelectorAll('[data-all-stock-code]').forEach(function (card) {
            card.addEventListener('click', function () {
              openStock({ code: card.getAttribute('data-all-stock-code'), name: card.getAttribute('data-all-stock-name') });
            });
          });
        }
        wireCards();
      }
      render();
    }).catch(function () { renderAllStockRetry_(panel); });
  }

  var INVEST_SIGNAL_URL = 'https://goodbyestar.cloud/invest-signal';

  function universeNumber_(value, digits) {
    var number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('ko-KR', { maximumFractionDigits: digits == null ? 0 : digits }) : '-';
  }

  function universeCapText_(cap) {
    var number = Number(cap);
    if (!Number.isFinite(number) || number <= 0) return '시가총액 집계 대기';
    var jo = number / 1000000000000;
    return jo >= 1 ? '시가총액 ' + jo.toFixed(jo >= 100 ? 0 : 1) + '조' : '시가총액 ' + (number / 100000000).toFixed(0) + '억';
  }

  function universeHash_(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function universeRandom_(seed, offset) {
    var value = Math.sin((seed + offset * 1013) * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  }

  function universeCapByCode_(payload) {
    var caps = {};
    Object.keys(payload || {}).forEach(function (market) {
      (payload[market] || []).forEach(function (item) {
        if (item && item.code && Number(item.cap) > 0) caps[String(item.code)] = Number(item.cap);
      });
    });
    return caps;
  }

  function universeRows_(payload, caps) {
    var seen = {};
    var buckets = (payload && payload.data && payload.data.buckets) || {};
    return Object.keys(buckets).reduce(function (rows, key) {
      (buckets[key] || []).forEach(function (item) {
        var code = String(item && item[0] || '');
        if (!/^[0-9A-Z]{6}$/.test(code) || seen[code]) return;
        seen[code] = true;
        rows.push({
          code: code,
          name: String(item[1] || code),
          price: Number(item[2]),
          changeRate: Number(item[3]),
          tradingValue: Number(item[6]),
          market: item[7] === 'KOSPI' || item[7] === 'KOSDAQ' ? item[7] : '',
          cap: caps[code] || null
        });
      });
      return rows;
    }, []);
  }

  function universeStar_(item) {
    var rate = Number.isFinite(item.changeRate) ? item.changeRate : 0;
    var seed = universeHash_(item.code);
    // 상승·하락은 서로 다른 은하 팔로 배치한다. 같은 종목은 새로고침해도 같은 위치를 유지한다.
    var right = rate > 0;
    var x = (right ? 52 : 4) + universeRandom_(seed, 1) * 44;
    var yCenter = right ? 38 : 62;
    var y = Math.max(5, Math.min(95, yCenter + (universeRandom_(seed, 2) - 0.5) * 60 - Math.min(Math.abs(rate), 15) * (right ? 0.55 : -0.55)));
    var capRadius = item.cap ? Math.min(8.8, 1.6 + Math.log10(Math.max(item.cap, 100000000)) * 0.43) : 0;
    var energyRadius = Number.isFinite(item.tradingValue) && item.tradingValue > 0
      ? Math.min(3.4, 1.15 + Math.log10(item.tradingValue / 100000000 + 1) * 0.38) : 1.3;
    var radius = Math.max(capRadius, energyRadius);
    var intensity = Math.min(Math.abs(rate) / 8, 1);
    var color = rate > 0 ? '#e0524d' : rate < 0 ? '#2878cc' : '#a7b3c1';
    var price = universeNumber_(item.price, 0) + '원';
    var rateText = (rate > 0 ? '+' : '') + universeNumber_(rate, 2) + '%';
    var label = item.name + ' · ' + price + ' · ' + rateText + ' · ' + universeCapText_(item.cap);
    return '<g class="mt-universe-star" transform="translate(' + (x * 10).toFixed(1) + ' ' + (y * 6.2).toFixed(1) + ')" style="--uc:' + color + ';--uo:' + (0.48 + intensity * 0.5).toFixed(2) + '" data-universe-code="' + escapeHtml(item.code) + '" data-universe-name="' + escapeHtml(item.name) + '" data-universe-price="' + escapeHtml(price) + '" data-universe-rate="' + escapeHtml(rateText) + '" data-universe-cap="' + escapeHtml(universeCapText_(item.cap)) + '" tabindex="0" role="button" aria-label="' + escapeHtml(label) + '"><circle cx="0" cy="0" r="' + radius.toFixed(2) + '"></circle><text x="0" y="-10">' + escapeHtml(item.name) + '</text></g>';
  }

  function loadAllStocksUniversePanel_(panel) {
    if (!panel || panel.__allStockUniverse) return;
    panel.__allStockUniverse = true;
    panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>전종목 우주를 만드는 중...</div>';

    Promise.all([
      fetchJson_(INVEST_SIGNAL_URL),
      fetchJson_(GAS_TICKER_URL + '?bubble=1').catch(function () { return {}; })
    ]).then(function (results) {
      var scan = results[0] || {};
      var rows = universeRows_(scan, universeCapByCode_((results[1] || {}).data || {}));
      if (!rows.length) throw new Error('empty stock universe');
      var scannedAt = scan && scan.data && scan.data.scannedAt ? String(scan.data.scannedAt).replace('T', ' ').slice(0, 16) : '최근 장 마감';
      panel.innerHTML = '<section class="mt-stock-universe-browser">'
        + '<div class="mt-all-stock-head"><div><strong>전종목 우주</strong><span>한 화면에 ' + rows.length.toLocaleString('ko-KR') + '개 별 · 클릭하면 종목 상세</span></div><span>' + escapeHtml(scannedAt) + ' 기준</span></div>'
        + '<div class="mt-universe-toolbar"><label><span class="sr-only">별 찾기</span><input type="search" data-universe-search placeholder="종목명 또는 코드로 별 찾기" autocomplete="off"></label><span data-universe-result>전체 별 표시</span></div>'
        + '<p class="mt-universe-legend"><b>붉은 은하</b>는 상승, <b>푸른 은하</b>는 하락입니다. 별 크기는 시가총액을 우선하고 미집계 종목은 거래대금으로 보정합니다. 별에 마우스를 올리면 이름·현재가·등락률·시가총액을 확인합니다.</p>'
        + '<div class="mt-stock-universe"><svg viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="국내 전종목 우주 지도" data-universe-map>' + rows.map(universeStar_).join('') + '</svg><div class="mt-universe-tooltip" data-universe-tooltip hidden></div></div></section>';

      var map = panel.querySelector('[data-universe-map]');
      var tooltip = panel.querySelector('[data-universe-tooltip]');
      var input = panel.querySelector('[data-universe-search]');
      var result = panel.querySelector('[data-universe-result]');
      function starFrom(target) { return target && target.closest ? target.closest('[data-universe-code]') : null; }
      function show(star, event) {
        if (!star) return;
        tooltip.innerHTML = '<strong>' + escapeHtml(star.getAttribute('data-universe-name')) + '</strong><span>' + escapeHtml(star.getAttribute('data-universe-price')) + ' · <b>' + escapeHtml(star.getAttribute('data-universe-rate')) + '</b></span><small>' + escapeHtml(star.getAttribute('data-universe-cap')) + '</small>';
        tooltip.hidden = false;
        var box = panel.querySelector('.mt-stock-universe').getBoundingClientRect();
        tooltip.style.left = Math.max(8, Math.min(box.width - 170, event.clientX - box.left + 12)) + 'px';
        tooltip.style.top = Math.max(8, Math.min(box.height - 74, event.clientY - box.top + 12)) + 'px';
      }
      map.addEventListener('pointerover', function (event) { show(starFrom(event.target), event); });
      map.addEventListener('pointermove', function (event) { var star = starFrom(event.target); if (star) show(star, event); });
      map.addEventListener('pointerout', function (event) { if (!starFrom(event.relatedTarget)) tooltip.hidden = true; });
      map.addEventListener('click', function (event) {
        var star = starFrom(event.target);
        if (star) global.location.href = '/page/stock-search?code=' + encodeURIComponent(star.getAttribute('data-universe-code')) + '&name=' + encodeURIComponent(star.getAttribute('data-universe-name'));
      });
      map.addEventListener('keydown', function (event) {
        var star = starFrom(event.target);
        if (star && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); star.click(); }
      });
      input.addEventListener('input', function () {
        var query = input.value.trim().toLowerCase();
        var matches = 0;
        map.querySelectorAll('[data-universe-code]').forEach(function (star) {
          var matched = !query || star.getAttribute('data-universe-name').toLowerCase().indexOf(query) !== -1 || star.getAttribute('data-universe-code').toLowerCase().indexOf(query) !== -1;
          star.classList.toggle('is-universe-match', !!query && matched);
          star.classList.toggle('is-universe-muted', !!query && !matched);
          if (matched) matches += 1;
        });
        result.textContent = query ? matches.toLocaleString('ko-KR') + '개 별 찾음' : '전체 별 표시';
      });
    }).catch(function () {
      panel.innerHTML = '<div class="mt-error">전종목 우주를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</div>';
    });
  }

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
            cancel: function () { panel.__mtLoaded = false; loadSectorCardsPanel_(panel); },
            saved: function () { invalidatePersonalHeatmap_(panel); panel.__mtLoaded = false; loadSectorCardsPanel_(panel); }
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

  function loadSectorCardsPanel_(panel) {
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

  // 기존 카드 UI에 거래대금·거래량 기준을 통과한 주요 섹터만 표시한다.
  function loadCardsPanel(panel) {
    loadAllStocksPanel(panel);
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
      buildBriefingStrategy(data),                  // ④ 시장 브리핑
      buildTemperatureActions(),                    // ⑤ 돈이 몰리는 차트
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
    // 돈이 몰리는 테마 흐름도 같은 이유로 열어둔다 - /theme-flow 응답이 있어야 그려져서
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
