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
  var DEFAULT_HISTORY_PERIOD = 20;
  // VM이 집계한 테마 흐름(증시온도 배경 계산의 238종목 재사용). 2026-09-01 이전에는
  // 아래 폴백만 썼는데, 거래대금 상위 30종목 중 17개가 ETF라 테마가 8개뿐이었다.
  var INDUSTRY_FLOW_URL = 'https://goodbyestar.cloud/industry-flow';
  var INDUSTRY_FLOW_FALLBACK_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=40';
  var INDUSTRY_TOP_LIMIT_ = 10;
  // 증시온도 탭 전용 팔레트. 회색은 로딩·비활성·데이터 대기 상태에만 쓴다.
  var MARKET_TEMP_PALETTE = {
    fear: '#1261c4',
    neutral: '#8b95a5',
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
      desc: '섹터 풀 종목 거래대금 합계를 직전 5거래일의 같은 시각까지 누적과 비교(장 마감 후에는 종일 총액끼리). 활발함 자체는 방향 중립이며 가격·상승 폭·수급과 일치할 때만 방향 점수에 반영' },
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

  // 2026-10-17 사용자 지적("가격 97점 오름 우세인데 '뚜렷한 방향이 없는 날'이라니, 하락한 날도 그렇고"):
  // 종합점수(수급·가격 평균)가 보통(30~69)이면 두 축이 같이 중간이든 한쪽이 극단이든 모두 '방향 없음'으로 뭉뚱그려졌다.
  // 점수가 보통일 때는 가격 축과 수급 축을 따로 읽어 "가격은 오르는데 수급이 약한 날"처럼 실제 상태를 말한다. 두 축이 모두 중간일 때만
  // 기존 '뚜렷한 방향이 없는 날'을 쓴다. 기준은 축 옆 단어(axisWord)와 같다 - 65 이상 우세, 35 미만 열세.
  var AXIS_HIGH = 65, AXIS_LOW = 35;
  var DIRECTION_MOODS = {
    upWeakMoney: { mood: '가격은 오르고 수급은 약한 날', title: '오른다고 추격하지 말고, 수급이 붙는 종목만 본다',
      short: '가격은 오름 쪽이 뚜렷하지만 수급(거래대금·외국인·기관)이 이를 받치지 않습니다. 오른 종목 가운데 거래대금이 붙는 종목만 확인합니다.',
      todo: '오른 종목 중 거래대금이 붙는 업종·종목만 남기고 나머지는 지켜본다', avoid: '오른 종목이라는 이유만으로 추격 매수' },
    upStrong: { mood: '상승 쪽으로 힘이 실리는 날', title: '급하게 따라가지 말고, 눌림에서 확인한다',
      short: '가격과 수급이 같은 쪽입니다. 이미 오른 종목은 눌림에서, 돈이 붙는 업종 안에서만 고릅니다.',
      todo: '돈이 붙는 업종에서 눌림이 나온 종목을 차트로 확인한다', avoid: '장중 급등을 보고 시장가로 따라가기' },
    downWithMoney: { mood: '가격은 내리고 돈은 들어오는 날', title: '내리는 종목을 받는 돈이 있는지 확인한다',
      short: '가격은 내림 쪽이지만 수급은 매수 쪽입니다. 하락 중 거래대금 증가는 매도 주도일 수도 있어, 하락이 멈추는 종목부터 봅니다.',
      todo: '하락이 멈추고 거래대금이 늘어나는 종목만 관심종목에 둔다', avoid: '아직 내리는 종목의 평단만 낮추는 물타기' },
    downWeak: { mood: '내림 쪽으로 기운 날', title: '떨어지는 종목은 잡지 말고, 반등이 확인된 뒤에 본다',
      short: '가격이 내림 쪽으로 기울었고 수급도 받쳐 주지 않습니다. 보유 종목은 5일선 이탈 여부를 먼저 점검합니다.',
      todo: '보유 종목의 5일선 이탈 여부를 먼저 점검한다', avoid: '바닥이라고 단정하고 먼저 사기' },
    moneyOnly: { mood: '돈은 들어오는데 가격은 아직인 날', title: '돈이 몰리는 곳에서 가격이 따라오는지 확인한다',
      short: '수급은 매수 쪽이지만 가격은 아직 뚜렷하지 않습니다. 돈이 몰리는 업종에서 가격이 따라오는 종목만 봅니다.',
      todo: '돈이 몰리는 업종 안에서 가격이 따라오는 종목을 확인한다', avoid: '가격이 확인되기 전에 미리 크게 사기' },
    moneyOut: { mood: '돈이 빠져나가는 날', title: '신규 진입은 줄이고, 보유 종목의 이탈 가격을 점검한다',
      short: '가격은 뚜렷하지 않지만 수급이 매도 쪽입니다. 신규 진입을 줄이고 보유 종목의 정리 가격을 미리 정합니다.',
      todo: '보유 종목의 정리 가격을 미리 적어 둔다', avoid: '수급이 빠지는 종목을 값이 싸 보인다고 사기' }
  };

  // 종합 점수가 보통(neutral)일 때만 쓴다. 공포·과열은 이미 방향이 뚜렷한 등급이다. 값이 없으면 null(기존 문구 유지).
  function directionMood_(price, money, tone) {
    if (tone !== 'neutral' || !isFinite(price) || !isFinite(money)) return null;
    var priceUp = price >= AXIS_HIGH, priceDown = price < AXIS_LOW;
    var moneyBuy = money >= AXIS_HIGH, moneySell = money < AXIS_LOW;
    if (priceUp) return moneyBuy ? DIRECTION_MOODS.upStrong : DIRECTION_MOODS.upWeakMoney;
    if (priceDown) return moneyBuy ? DIRECTION_MOODS.downWithMoney : DIRECTION_MOODS.downWeak;
    if (moneyBuy) return DIRECTION_MOODS.moneyOnly;
    if (moneySell) return DIRECTION_MOODS.moneyOut;
    return null;
  }

  function antGuide(data) {
    var tone = crowdTone(data);
    var base = ANT_GUIDE_BY_TONE[tone];
    var axes = (data && data.axes) || {};
    var todo = base.todo.slice();
    var avoid = base.avoid.slice();
    var risk = Number(axes.risk && axes.risk.value);
    var money = Number(axes.money && axes.money.value);
    var priceAxis = Number(axes.price && axes.price.value);
    var direction = directionMood_(priceAxis, money, tone);
    var score = score100(data);
    var context = [];
    if (isFinite(score)) context.push('시장 점수 ' + Math.round(score) + '점');
    if (isFinite(risk)) context.push('위험 ' + Math.round(risk) + '점');
    if (isFinite(priceAxis)) context.push('가격 ' + Math.round(priceAxis) + '점');
    if (isFinite(money)) context.push('수급 ' + Math.round(money) + '점');

    // 등급 하나로 같은 문구를 반복하지 않는다. 오늘의 위험·자금 축이 어느 쪽으로
    // 기울었는지에 따라 "정리", "관망", "수익 보호" 중 우선 행동을 바꾼다.
    if (isFinite(risk) && risk >= 65) {
      todo[0] = '손절가를 깼으면 오늘 정리한다. 못 하겠으면 1개월 버틸 근거를 먼저 적는다';
      avoid.unshift('손실 종목의 평단만 낮추는 물타기');
      base = { tone: tone, mood: '위험 신호가 높아진 날', title: '오늘은 수익보다 계좌 방어가 먼저다', short: '' };
    } else if (direction) {
      todo[0] = direction.todo;
      avoid.unshift(direction.avoid);
      base = { tone: tone, mood: direction.mood, title: direction.title, short: direction.short };
    } else if (isFinite(money) && money < 40) {
      todo[0] = '거래대금이 붙은 종목만 남기고, 나머지는 장 마감 뒤 다시 본다';
      avoid.unshift('돈이 없는 종목을 혼자만의 기대감으로 매수');
      base = { tone: tone, mood: '매수 우위가 약한 날', title: '지금은 매수보다 후보 선별이 먼저다', short: '' };
    } else if (tone === 'greed' && isFinite(money) && money >= 60) {
      todo[0] = '수익권 종목은 익절선과 이탈가를 오늘 가격으로 올려 적는다';
      avoid.unshift('오른 종목을 놓칠까 봐 시장가로 추격 매수');
      base = { tone: tone, mood: '자금이 강하게 몰리는 날', title: '오늘은 진입보다 수익 보호 가격을 정한다', short: '' };
    }
    // 2026-10-04 사용자 지적("지금 할 것/주의할 것을 앵무새처럼 같은 메시지만 적지 말고 dynamic 하게"):
    // 등급 템플릿은 빈자리 채우기용으로만 두고, 오늘 응답의 실제 값(돈이 몰린 섹터·순위 변화·수급·거래대금·
    // 상승 비율·신고가/신저가·VIX·환율·금리·빚투 위험도)에서 눈에 띄는 것부터 문장을 만든다.
    var live = dynamicChecklist_(data);
    todo = mergeChecklist_(live.todo, todo);
    avoid = mergeChecklist_(live.avoid, avoid);
    return { tone: tone, mood: base.mood, title: base.title, short: base.short, todo: todo, avoid: avoid, context: context.join(' · ') };
  }

  function mergeChecklist_(dynamic, template) {
    var out = dynamic.slice(0, 3);
    template.forEach(function (text) { if (out.length < 3 && out.indexOf(text) < 0) out.push(text); });
    return out;
  }

  // 각 후보는 { p: 우선순위, text } - 값이 조건을 넘을 때만 만들어지고, 우선순위가 높은 것부터 3개까지 쓴다.
  // **굵게**는 emphasizeChecklist_가 <strong>으로 바꾼다. 수급 금액은 단위 검증 전이라 방향(순매수/순매도)만 쓴다.
  function dynamicChecklist_(data) {
    var comps = (data && data.components) || {};
    var todo = [], avoid = [];
    function pct(v, digits) { return (v > 0 ? '+' : '') + v.toFixed(digits == null ? 2 : digits) + '%'; }
    // 받침 유무로 조사를 고른다(반도체가 / 반도체부품소재/공정이).
    function josa(word, withFinal, withoutFinal) {
      var code = String(word || '').charCodeAt(String(word || '').length - 1) - 0xAC00;
      return code >= 0 && code <= 11171 && code % 28 ? withFinal : withoutFinal;
    }
    var flows = Array.isArray(data && data.industryFlow) ? data.industryFlow.filter(function (row) { return row && row.industry; }) : [];
    var prevRanks = (data && data.industryFlowPreviousRanks) || {};
    var top = flows[0];
    if (top) {
      var topRate = Number(top.avg_change_rate);
      var leader = (top.stocks || []).filter(function (s) { return isFinite(Number(s.change_rate)); })
        .sort(function (a, b) { return Number(b.change_rate) - Number(a.change_rate); })[0];
      var prevTop = Number(prevRanks[top.industry]);
      var amount = tradeAmountText_(top.trade_amount);
      if (isFinite(topRate) && topRate > 0) {
        todo.push({ p: 90, text: '**' + top.industry + '**에 거래대금이 가장 많이 몰렸다(' + (amount ? amount + ', ' : '') + '평균 ' + pct(topRate) + (prevTop > 1 ? ', 어제 ' + prevTop + '위' : '') + ').'
          + (leader ? ' **' + leader.name + '**(' + pct(Number(leader.change_rate)) + ')부터 차트 자리를 본다' : ' 대표 종목 차트 자리부터 본다') });
      } else if (isFinite(topRate) && topRate < 0) {
        avoid.push({ p: 78, text: '거래대금 1위 **' + top.industry + '**' + josa(top.industry, '이', '가') + ' 평균 ' + pct(topRate) + ' - 돈이 몰린 게 아니라 **매도 물량**일 수 있다' });
      }
    }
    flows.slice(1, 5).forEach(function (row, i) {
      var rank = i + 2, prev = Number(prevRanks[row.industry]), rate = Number(row.avg_change_rate);
      if (!isFinite(rate)) return;
      if (rate > 0 && (!prev || prev - rank >= 3)) {
        todo.push({ p: 80 - i, text: '**' + row.industry + '**' + josa(row.industry, '이', '가') + ' ' + (prev ? '어제 ' + prev + '위 → 오늘 ' + rank + '위' : '오늘 처음 ' + rank + '위') + '로 올라왔다. 하루짜리인지 **내일 거래대금**으로 확인' });
      } else if (rate <= -1) {
        avoid.push({ p: 72 - i, text: '**' + row.industry + '**' + josa(row.industry, '은', '는') + ' 거래대금 ' + rank + '위인데 평균 ' + pct(rate) + ' - 많이 거래된 하락이라 **저가 매수**는 서두르지 않는다' });
      }
    });
    var foreign = comps.flow && comps.flow.foreign;
    var foreignScore = Number(foreign && foreign.score100);
    if (isFinite(foreignScore) && foreignScore <= 20) avoid.push({ p: 85, text: '외국인이 최근 5일 코스피를 **순매도** 중 - 외국인 비중 큰 대형주는 **추격 매수**를 미룬다' });
    else if (isFinite(foreignScore) && foreignScore >= 65) todo.push({ p: 72, text: '외국인이 최근 5일 코스피를 **순매수** 중 - 외국인이 산 업종부터 확인한다' });
    var tv = Number(comps.tradingValue && comps.tradingValue.relative);
    if (isFinite(tv) && tv < 0.9) avoid.push({ p: 75, text: '거래대금이 5일 평균의 ' + Math.round(tv * 100) + '%로 줄었다 - 거래 없는 반등에 **큰 비중**을 싣지 않는다' });
    else if (isFinite(tv) && tv >= 1.2) todo.push({ p: 66, text: '거래대금이 5일 평균의 ' + Math.round(tv * 100) + '% - **돈이 붙은 섹터** 안에서만 후보를 고른다' });
    var rr = comps.riseRatio || {};
    var ratio = Number(rr.ratio);
    if (isFinite(ratio) && ratio >= 0.6) todo.push({ p: 60, text: '상승 종목이 ' + Math.round(ratio * 100) + '%(' + rr.up + '/' + rr.total + ') - 이런 날 **내 종목이 못 올랐다면** 이유부터 확인' });
    else if (isFinite(ratio) && ratio < 0.4) avoid.push({ p: 70, text: '하락 종목이 ' + Math.round((1 - ratio) * 100) + '%(' + rr.down + '/' + rr.total + ') - **반등 첫날** 따라 사지 않는다' });
    var w52 = comps.week52 || {};
    var hi = Number(w52.newHigh), lo = Number(w52.newLow);
    if (isFinite(hi) && isFinite(lo)) {
      if (lo >= hi + 5) avoid.push({ p: 68, text: '52주 신저가 ' + lo + '개, 신고가 ' + hi + '개 - 신저가 종목 **바닥 잡기**는 하지 않는다' });
      else if (hi >= lo + 5) todo.push({ p: 58, text: '52주 신고가 ' + hi + '개(신저가 ' + lo + '개) - 신고가 종목 중 **거래대금**이 붙은 것만 관심' });
    }
    var vix = Number(comps.vix && comps.vix.value);
    if (isFinite(vix) && vix >= 20) avoid.push({ p: vix >= 25 ? 95 : 82, text: 'VIX ' + vix.toFixed(1) + ' - 변동성이 큰 장, **미수·신용**으로 크기를 키우지 않는다' });
    var fx = comps.exchange || {};
    var fxChg = Number(fx.changeRate), fxPrice = Number(fx.price);
    var fxText = isFinite(fxPrice) ? ' ' + Math.round(fxPrice).toLocaleString('ko-KR') + '원' : '';
    if (isFinite(fxChg) && fxChg >= 0.5) avoid.push({ p: 80, text: '원/달러' + fxText + '(' + pct(fxChg) + ') - 환율이 오르는 날은 외국인 매도가 커질 수 있어 **대형주 추격** 자제' });
    else if (isFinite(fxChg) && fxChg <= -0.5) todo.push({ p: 55, text: '원/달러' + fxText + '(' + pct(fxChg) + ')·원화 강세 - **외국인 수급**이 돌아오는지 확인' });
    var rates = comps.rates || {};
    var us10 = Number(rates.us10y), us10Chg = Number(rates.us10yChange);
    if (isFinite(us10Chg) && us10Chg >= 0.05) avoid.push({ p: 64, text: '미국 10년물 ' + us10.toFixed(2) + '%(+' + us10Chg.toFixed(2) + '%p) - 금리 부담이 큰 **성장주 추격** 주의' });
    var credit = comps.creditRisk || {};
    if (credit.available && (credit.state === 'caution' || credit.state === 'overheat')) {
      avoid.push({ p: credit.state === 'overheat' ? 88 : 74, text: '빚투 위험도 \'' + (credit.stateLabel || credit.state) + '\' - 신용 비중 높은 급등주는 **반대매매** 물량 주의' });
    }
    function pick(list) { return list.sort(function (a, b) { return b.p - a.p; }).map(function (item) { return item.text; }); }
    return { todo: pick(todo), avoid: pick(avoid) };
  }

  function emphasizeChecklist_(text) {
    var safe = escapeHtml(text);
    var marked = /\*\*/.test(safe);
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (marked) return safe;
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


  // ---- 내 카테고리 중심 구조 (2026-10-02 사용자 요청) ----
  // 분류 체계가 셋(돈 몰린 섹터=키움 테마 / 카드=내 카테고리 / 활성 카드=WICS)으로 따로 놀아 "뭐가 맞는
  // 카테고리야?"가 됐다. 이제 기준은 하나다: 내 카테고리(내 섹터 카드 설정, 로그인하면 계정 동기화).
  //  - 카드·히트맵·시총비례는 내 카테고리로 그린다.
  //  - 활성 종목은 1차로 내 카테고리별로 묶고, 어느 카테고리에도 없는 활성 종목은 '편입 후보'로 따로 보여
  //    ＋로 카테고리에 편입한다.
  //  - 새 카테고리는 키움 테마 목록에서 골라 추가한다.
  //  - 증시온도의 '돈이 몰린 섹터'(키움 테마)는 내 카테고리와 구성종목 겹침으로 매핑해, 어느 카테고리가
  //    뜨는지 보이고 매핑이 없으면 한 번에 카테고리로 추가한다.
  var THEME_LIST_URL = 'https://goodbyestar.cloud/theme-list';
  var THEME_STOCKS_URL = 'https://goodbyestar.cloud/theme-stocks';
  var CATEGORY_THEME_STOCK_LIMIT = 80;
  var themeRowsCache_ = { at: 0, promise: null };
  var themeCatalogPromise_ = null;
  var marketMapPromise_ = null;
  var marketByCode_ = {};

  function loadThemeRows_() {
    var now = Date.now();
    if (themeRowsCache_.promise && now - themeRowsCache_.at < 60000) return themeRowsCache_.promise;
    themeRowsCache_.at = now;
    themeRowsCache_.promise = fetchJson_(SECTOR_FLOW_URL)
      .then(function (body) {
        var payload = body && body.data ? body.data : body;
        return ((payload && payload.rows) || []).slice(0, SECTOR_FLOW_TOP);
      })
      .catch(function (error) {
        themeRowsCache_.promise = null;
        throw error;
      });
    return themeRowsCache_.promise;
  }

  function loadThemeCatalog_() {
    if (!themeCatalogPromise_) {
      themeCatalogPromise_ = fetchJson_(THEME_LIST_URL).then(function (body) {
        var payload = body && body.data ? body.data : body;
        return (payload && payload.themes) || [];
      }).catch(function (error) {
        themeCatalogPromise_ = null;
        throw error;
      });
    }
    return themeCatalogPromise_;
  }

  // 테마 구성종목에는 시장(KOSPI/KOSDAQ) 구분이 없다. 전종목 스캔에 있는 값으로 채우고, 모르면 빈 값이다.
  function ensureMarketMap_() {
    if (!marketMapPromise_) {
      marketMapPromise_ = fetchJson_(INVEST_SIGNAL_URL).then(function (scan) {
        universeRows_(scan, {}).forEach(function (row) { if (row.market) marketByCode_[row.code] = row.market; });
      }).catch(function () { /* 시장 구분 없이도 카테고리는 만들 수 있다 */ });
    }
    return marketMapPromise_;
  }

  function rateText_(rate) {
    return isFinite(rate) ? (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '-';
  }

  function dirClass_(rate) {
    return rate > 0 ? 'sector-up' : rate < 0 ? 'sector-down' : 'sector-flat';
  }

  function priceText_(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? Math.round(n).toLocaleString('ko-KR') : '-';
  }

  function stockLinkHref_(stock) {
    return '/page/stock-search?code=' + encodeURIComponent(stock.code || '')
      + '&amp;name=' + encodeURIComponent(stock.name || stock.code || '');
  }

  function categoryContext_() {
    return Promise.all([fetchSectorConfig_(), fetchGoogleAuth_()]).then(function (values) {
      return { config: values[0], auth: values[1] };
    });
  }

  // 로그인했으면 계정에, 아니면 이 브라우저에 저장한다(카테고리·종목 편집기와 같은 규칙).
  function persistSectors_(sectors) {
    return categoryContext_().then(function (ctx) {
      var signedIn = ctx.auth.configured && ctx.auth.authenticated;
      var saving = signedIn ? saveUserSectorConfig_(sectors, ctx.config.revision) : Promise.resolve(writeLocalSectorConfig_(sectors));
      return saving.then(function (saved) {
        invalidateSectorConfig_();
        return saved;
      });
    });
  }

  function addStocksToCategory_(name, stocks) {
    return categoryContext_().then(function (ctx) {
      var next = cloneSectorMap_(ctx.config.sectors);
      var list = next[name] || [];
      var have = {};
      list.forEach(function (stock) { have[stock.code] = true; });
      stocks.forEach(function (stock) {
        if (!have[stock.code]) list.push({ name: stock.name, code: stock.code, market: stock.market || '' });
      });
      next[name] = list;
      return persistSectors_(next);
    });
  }

  function uniqueCategoryName_(name, sectors) {
    var base = String(name || '새 카테고리').trim().slice(0, 90) || '새 카테고리';
    var candidate = base;
    for (var i = 2; sectors[candidate] && i < 100; i += 1) candidate = base + ' ' + i;
    return candidate;
  }

  function addCategoryFromTheme_(themeCode, themeName) {
    return Promise.all([
      fetchJson_(THEME_STOCKS_URL + '?code=' + encodeURIComponent(themeCode)),
      ensureMarketMap_()
    ]).then(function (results) {
      var payload = results[0] && results[0].data ? results[0].data : results[0];
      var stocks = ((payload && payload.stocks) || []).slice(0, CATEGORY_THEME_STOCK_LIMIT).map(function (stock) {
        return { name: stock.name || stock.code, code: stock.code, market: marketByCode_[stock.code] || '' };
      });
      if (!stocks.length) throw new Error('empty theme');
      return categoryContext_().then(function (ctx) {
        var next = cloneSectorMap_(ctx.config.sectors);
        var name = uniqueCategoryName_(themeName, next);
        next[name] = stocks;
        return persistSectors_(next).then(function () { return name; });
      });
    });
  }

  // 돈이 몰린 테마 ↔ 내 카테고리: 구성종목이 2개 이상 겹치거나(작은 쪽이 3종목 이하면 1개), 같은 테마로 본다.
  function mapThemesToCategories_(themeRows, sectors) {
    var catCodes = {};
    Object.keys(sectors || {}).forEach(function (name) {
      var set = {};
      var size = 0;
      (sectors[name] || []).forEach(function (stock) { if (stock && stock.code && !set[stock.code]) { set[stock.code] = true; size += 1; } });
      catCodes[name] = { set: set, size: size };
    });
    var byTheme = [];
    var byCategory = {};
    (themeRows || []).forEach(function (row, index) {
      var codes = row.codes || [];
      var matched = [];
      Object.keys(catCodes).forEach(function (name) {
        var shared = codes.filter(function (code) { return catCodes[name].set[code]; }).length;
        var small = Math.min(catCodes[name].size, codes.length);
        if (shared >= 2 || (shared >= 1 && small <= 3)) {
          matched.push(name);
          if (!byCategory[name] || byCategory[name].rank > index + 1) {
            byCategory[name] = { rank: index + 1, theme: row.industry, rate: Number(row.avg_change_rate) };
          }
        }
      });
      byTheme.push(matched);
    });
    return { byTheme: byTheme, byCategory: byCategory };
  }

  // 돈이 몰린 카테고리를 앞으로, 나머지는 내가 정한 순서 그대로.
  function orderedCategoryNames_(sectors, byCategory) {
    var names = Object.keys(sectors || {});
    var hot = names.filter(function (name) { return byCategory[name]; })
      .sort(function (a, b) { return byCategory[a].rank - byCategory[b].rank; });
    return hot.concat(names.filter(function (name) { return !byCategory[name]; }));
  }

  function moneyBadgeHtml_(info) {
    return '<span class="mt-money-badge" title="' + escapeHtml(info.theme) + '">돈 몰림 #' + info.rank
      + (isFinite(info.rate) ? ' · ' + escapeHtml(rateText_(info.rate)) : '') + '</span>';
  }

  function categoryRoot_() {
    return document.querySelector('.mt-explore-card');
  }

  // 카테고리가 바뀌면 열어 둔 탭을 모두 새 구성으로 다시 그린다.
  function refreshAfterCategoryChange_() {
    invalidateSectorConfig_();
    var root = categoryRoot_();
    if (root) {
      root.querySelectorAll('[data-view-panel]').forEach(function (panel) {
        panel.__mtLoaded = false;
        panel.__allStockBrowser = false;
        panel.innerHTML = '';
      });
      var active = root.querySelector('.mt-view-btn.active');
      if (active) active.click();
    }
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (container) loadMoneyStrip_(container);
  }

  function focusCategory_(name) {
    var root = categoryRoot_();
    if (!root) return;
    var tab = root.querySelector('.mt-view-btn[data-view="cards"]');
    if (tab && !tab.classList.contains('active')) tab.click();
    var tries = 0;
    (function find() {
      var cards = root.querySelectorAll('[data-view-panel="cards"] .sector-card');
      var target = Array.prototype.filter.call(cards, function (card) {
        var title = card.querySelector('.sector-card-title');
        return title && title.getAttribute('data-category') === name;
      })[0];
      if (target) {
        if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('is-flash');
        setTimeout(function () { target.classList.remove('is-flash'); }, 1800);
      } else if (tries < 15) {
        tries += 1;
        setTimeout(find, 300);
      }
    })();
  }

  // ---- 위: 오늘 거래대금 상위 섹터 → 내 카테고리 매핑 ----
  // 거래대금 막대 표는 증시온도가 기준이라 여기서는 링크로 보내고(2026-10-02 사용자 요청), 같은 TOP10을 칩으로만
  // 보여 준다. 연결된 내 카테고리가 있으면 눌러서 이동하고, 없으면 ＋로 한 번에 카테고리를 만든다.
  function renderMoneyStrip_(mount, rows, sectors) {
    var mapping = mapThemesToCategories_(rows, sectors);
    var chips = (rows || []).map(function (row, index) {
      var rate = Number(row.avg_change_rate);
      var cats = mapping.byTheme[index];
      var label = '<i>' + (index + 1) + '</i><span class="mt-money-name">' + escapeHtml(row.industry) + '</span><em class="' + dirClass_(rate) + '">' + rateText_(rate) + '</em>';
      return cats.length
        ? '<button type="button" class="mt-money-chip is-mapped" data-focus-category="' + escapeHtml(cats[0]) + '" title="내 카테고리: ' + escapeHtml(cats.join(', ')) + '">' + label + '<small>' + escapeHtml(cats[0]) + (cats.length > 1 ? ' 외 ' + (cats.length - 1) : '') + '</small></button>'
        : '<button type="button" class="mt-money-chip is-add" data-add-theme="' + escapeHtml(row.theme_code || '') + '" data-theme-name="' + escapeHtml(row.industry) + '" title="내 카테고리에 없는 테마 - 눌러서 카테고리로 추가">' + label + '<small>＋ 추가</small></button>';
    }).join('');
    mount.innerHTML = '<div class="mt-section mt-card mt-money-card">'
      + '<div class="mt-money-head"><strong>오늘 거래대금 상위 섹터 TOP10</strong><a href="/page/market-temp#mt-money-flow">거래대금 막대로 보기 →</a></div>'
      + (chips ? '<div class="mt-money-chips">' + chips + '</div>' : '<div class="mt-hint">거래대금 상위 섹터를 불러오지 못했습니다.</div>')
      + '<p class="mt-top-note"><span class="mt-money-key is-mapped"></span>내 카테고리와 연결(누르면 카드로 이동) <span class="mt-money-key is-add"></span>내 카테고리에 없음(누르면 추가) · 키움증권 테마, 거래대금 순</p>'
      + '</div>';
    mount.onclick = function (event) {
      var focus = event.target.closest && event.target.closest('[data-focus-category]');
      if (focus) { focusCategory_(focus.getAttribute('data-focus-category')); return; }
      var add = event.target.closest && event.target.closest('[data-add-theme]');
      if (!add || !add.getAttribute('data-add-theme')) return;
      add.disabled = true;
      add.querySelector('small').textContent = '추가 중...';
      addCategoryFromTheme_(add.getAttribute('data-add-theme'), add.getAttribute('data-theme-name'))
        .then(function () { refreshAfterCategoryChange_(); })
        .catch(function () { add.disabled = false; add.querySelector('small').textContent = '실패 · 다시'; });
    };
  }

  function loadMoneyStrip_(container) {
    var mount = container.querySelector('[data-money-strip]');
    if (!mount) return;
    Promise.all([loadThemeRows_(), fetchSectorConfig_().catch(function () { return { sectors: {} }; })])
      .then(function (values) { renderMoneyStrip_(mount, values[0], values[1].sectors || {}); })
      .catch(function () { mount.innerHTML = ''; });
  }

  // ---- 카드 보기: 돈 몰림 배지·정렬 ----
  function decorateCategoryCards_(panel, sectors) {
    loadThemeRows_().then(function (rows) {
      var mapping = mapThemesToCategories_(rows, sectors);
      var grid = panel.querySelector('.sector-cards-grid');
      if (!grid) return;
      var cards = {};
      grid.querySelectorAll('.sector-card').forEach(function (card) {
        var title = card.querySelector('.sector-card-title');
        if (!title) return;
        var name = title.textContent.trim();
        title.setAttribute('data-category', name);
        cards[name] = card;
        if (mapping.byCategory[name]) title.insertAdjacentHTML('beforeend', moneyBadgeHtml_(mapping.byCategory[name]));
      });
      orderedCategoryNames_(sectors, mapping.byCategory).forEach(function (name) {
        if (cards[name]) grid.appendChild(cards[name]);
      });
    }).catch(function () { /* 배지는 부가 정보 - 실패해도 카드는 그대로 */ });
    panel.querySelectorAll('.sector-card-title').forEach(function (title) {
      if (!title.getAttribute('data-category')) title.setAttribute('data-category', title.textContent.trim());
    });
  }

  // ---- 새 카테고리: 키움 테마에서 고르기 ----
  function openThemePicker_(host) {
    var existing = host.querySelector('.mt-theme-picker');
    if (existing) { existing.remove(); return; }
    var box = document.createElement('div');
    box.className = 'mt-theme-picker';
    box.innerHTML = '<div class="mt-theme-picker-head"><strong>키움 테마로 카테고리 추가</strong><button type="button" data-picker-close aria-label="닫기">×</button></div>'
      + '<input type="search" data-picker-search placeholder="테마 검색 (예: 화장품, 호텔)" autocomplete="off">'
      + '<div class="mt-theme-picker-list" data-picker-list><div class="mt-hint">테마 목록을 불러오는 중...</div></div>';
    host.insertBefore(box, host.firstChild);
    var list = box.querySelector('[data-picker-list]');
    var input = box.querySelector('[data-picker-search]');
    var themes = [];
    var owned = {};
    function draw() {
      var query = input.value.trim().toLowerCase();
      var shown = themes.filter(function (t) { return !query || t.name.toLowerCase().indexOf(query) !== -1; })
        .slice(0, 60);
      list.innerHTML = shown.length ? shown.map(function (t) {
        var rate = Number(t.change_rate);
        return '<button type="button" class="mt-theme-picker-item" data-pick-theme="' + escapeHtml(t.code) + '" data-theme-name="' + escapeHtml(t.name) + '"' + (owned[t.name] ? ' disabled' : '') + '>'
          + '<span>' + escapeHtml(t.name) + '</span><small>' + (t.stock_count ? t.stock_count + '종목 · ' : '')
          + (owned[t.name] ? '이미 있음' : '<b class="' + dirClass_(rate) + '">' + rateText_(rate) + '</b>') + '</small></button>';
      }).join('') : '<div class="mt-hint">맞는 테마가 없습니다.</div>';
    }
    Promise.all([loadThemeCatalog_(), fetchSectorConfig_().catch(function () { return { sectors: {} }; })]).then(function (values) {
      themes = values[0];
      Object.keys(values[1].sectors || {}).forEach(function (name) { owned[name] = true; });
      draw();
    }).catch(function () { list.innerHTML = '<div class="mt-error">테마 목록을 불러오지 못했습니다.</div>'; });
    input.addEventListener('input', draw);
    box.addEventListener('click', function (event) {
      if (event.target.closest('[data-picker-close]')) { box.remove(); return; }
      var item = event.target.closest('[data-pick-theme]');
      if (!item || item.disabled) return;
      item.disabled = true;
      item.querySelector('small').textContent = '추가 중...';
      addCategoryFromTheme_(item.getAttribute('data-pick-theme'), item.getAttribute('data-theme-name'))
        .then(function () { refreshAfterCategoryChange_(); })
        .catch(function () { item.disabled = false; item.querySelector('small').textContent = '실패 · 다시 시도'; });
    });
  }

  // ---- 활성 종목 편입 ----
  function openAdoptChooser_(panel, stock) {
    var existing = panel.querySelector('.mt-adopt-pop');
    if (existing) existing.remove();
    fetchSectorConfig_().then(function (config) {
      var names = Object.keys(config.sectors || {});
      var box = document.createElement('div');
      box.className = 'mt-adopt-pop';
      box.innerHTML = '<strong>' + escapeHtml(stock.name) + '</strong> 을(를) 어느 카테고리에 편입할까요?'
        + '<div class="mt-adopt-controls"><select data-adopt-select>'
        + names.map(function (name) { return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>'; }).join('')
        + '<option value="__new__">＋ 새 카테고리</option></select>'
        + '<input type="text" data-adopt-new placeholder="새 카테고리 이름" maxlength="40" hidden>'
        + '<button type="button" data-adopt-ok>편입</button><button type="button" data-adopt-cancel>취소</button></div>'
        + '<small data-adopt-msg></small>';
      panel.insertBefore(box, panel.firstChild);
      if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
      var select = box.querySelector('[data-adopt-select]');
      var fresh = box.querySelector('[data-adopt-new]');
      var msg = box.querySelector('[data-adopt-msg]');
      select.addEventListener('change', function () { fresh.hidden = select.value !== '__new__'; });
      box.querySelector('[data-adopt-cancel]').addEventListener('click', function () { box.remove(); });
      box.querySelector('[data-adopt-ok]').addEventListener('click', function () {
        var target = select.value === '__new__' ? fresh.value.trim() : select.value;
        if (!target) { msg.textContent = '카테고리 이름을 입력하세요.'; return; }
        msg.textContent = '저장 중...';
        addStocksToCategory_(target, [{ name: stock.name, code: stock.code, market: stock.market }])
          .then(function () { refreshAfterCategoryChange_(); })
          .catch(function () { msg.textContent = '저장하지 못했습니다. 다시 시도해 주세요.'; });
      });
    });
  }

  // ---- 히트맵: 내 카테고리별 ----
  function renderCategoryHeatmap_(panel, SD, config, themeRows) {
    var sectors = config.sectors;
    var codes = sectorPoolCodes(sectors, global.KRX_MAP || {});
    if (!codes.length) throw new Error('empty sector config');
    var mapping = mapThemesToCategories_(themeRows, sectors);
    return SD.fetchTickerData(codes).then(function (list) {
      var byCode = {};
      (list || []).forEach(function (q) { if (q && q.code) byCode[q.code] = q; });
      var html = orderedCategoryNames_(sectors, mapping.byCategory).map(function (name) {
        var tiles = (sectors[name] || []).map(function (stock) {
          var q = byCode[stock.code];
          if (!q) return null;
          return { stock: stock, quote: q, rate: Number(q.changeRate) };
        }).filter(Boolean).sort(function (a, b) { return b.rate - a.rate; }).map(function (t) {
          var intensity = Math.min(Math.abs(t.rate) / 5, 1);
          var bg = t.rate > 0 ? 'rgba(210, 79, 69, ' + (0.12 + intensity * 0.7).toFixed(2) + ')'
            : t.rate < 0 ? 'rgba(18, 97, 196, ' + (0.12 + intensity * 0.7).toFixed(2) + ')'
              : 'rgba(156, 163, 175, 0.2)';
          return '<a class="heatmap-tile mt-top-tile" style="background:' + bg + '" href="' + stockLinkHref_(t.stock) + '" title="' + escapeHtml(name) + '">'
            + '<span class="heatmap-tile-name">' + escapeHtml(t.stock.name) + '</span>'
            + '<span class="heatmap-tile-price">' + priceText_(t.quote.price) + '</span>'
            + '<span class="heatmap-tile-rate">' + rateText_(t.rate) + '</span></a>';
        }).join('');
        if (!tiles) return '';
        return '<div class="mt-top-hm-group"><div class="mt-top-hm-title">' + escapeHtml(name)
          + (mapping.byCategory[name] ? moneyBadgeHtml_(mapping.byCategory[name]) : '') + '</div>'
          + '<div class="heatmap-grid">' + tiles + '</div></div>';
      }).join('');
      panel.innerHTML = html || '<div class="mt-error">표시할 시세가 없습니다.</div>';
    });
  }

  // ---- 시총비례 히트맵: 칩으로 내 카테고리를 고른다 ----
  // 시총은 시총 풀에 있는 종목만 알 수 있어 일부가 빠질 수 있다 - 표시 개수를 아래에 밝힌다.
  function renderCategoryMarketcap_(panel, config, themeRows) {
    var sectors = config.sectors;
    var MB = global.MarketcapBubble;
    if (!MB) { panel.innerHTML = '<div class="mt-error">시총비례 히트맵을 불러오지 못했습니다.</div>'; return; }
    var mapping = mapThemesToCategories_(themeRows, sectors);
    var names = orderedCategoryNames_(sectors, mapping.byCategory);
    function filterFor(selected, label) {
      var codes = {};
      var total = 0;
      selected.forEach(function (name) {
        (sectors[name] || []).forEach(function (stock) { if (!codes[stock.code]) { codes[stock.code] = true; total += 1; } });
      });
      return { label: label, codes: codes, total: total };
    }
    var chips = ['<button type="button" class="mt-top-chip is-active" data-mc-category="">내 카테고리 전체</button>'].concat(names.map(function (name, i) {
      return '<button type="button" class="mt-top-chip" data-mc-category="' + i + '">' + escapeHtml(name) + '</button>';
    })).join('');
    panel.innerHTML = '<div class="mt-top-chips">' + chips + '</div>'
      + '<p class="mt-top-note" data-mc-note></p>'
      + '<div id="marketcap-bubble" data-theme-filter="1"></div>';
    var box = panel.querySelector('#marketcap-bubble');
    var note = panel.querySelector('[data-mc-note]');
    var current = filterFor(names, '내 카테고리 전체');
    box.addEventListener('mcb:rendered', function (event) {
      var matched = event.detail && event.detail.matched;
      note.textContent = current.label + ' 구성 ' + current.total + '종목 중 시총 집계 대상 ' + matched + '종목을 표시합니다.'
        + (matched ? '' : ' 이 카테고리는 시총 집계 풀에 없어 비어 있습니다.');
    });
    box.__mcbCodeFilter = current;
    try { MB.init(); } catch (error) { panel.innerHTML = '<div class="mt-error">시총비례 히트맵을 불러오지 못했습니다.</div>'; return; }
    panel.querySelector('.mt-top-chips').onclick = function (event) {
      var chip = event.target.closest && event.target.closest('[data-mc-category]');
      if (!chip) return;
      var key = chip.getAttribute('data-mc-category');
      panel.querySelectorAll('[data-mc-category]').forEach(function (el) { el.classList.toggle('is-active', el === chip); });
      current = key === '' ? filterFor(names, '내 카테고리 전체') : filterFor([names[Number(key)]], names[Number(key)]);
      MB.setCodeFilter(box, current);
    };
  }

  function loadCategoryPanel_(panel, renderer, label) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>' + label + ' 불러오는 중...</div>';
    Promise.all([fetchSectorConfig_(), loadThemeRows_().catch(function () { return []; })])
      .then(function (values) { return renderer(panel, values[0], values[1]); })
      .catch(function () {
        panel.__mtLoaded = false;
        panel.innerHTML = '<div class="mt-error">' + label + '을(를) 불러오지 못했습니다.</div>';
      });
  }

  // 활성 종목을 1차로 내 카테고리별, 어디에도 없는 종목은 편입 후보(WICS 중분류별)로 나눈다.
  function regroupByCategories_(groups, config) {
    var sectors = config && config.sectors;
    if (!sectors || !Object.keys(sectors).length) return groups;
    var inCategory = {};
    var members = {};
    Object.keys(sectors).forEach(function (name) {
      (sectors[name] || []).forEach(function (stock) {
        if (!stock || !stock.code) return;
        inCategory[stock.code] = true;
        (members[name] = members[name] || {})[stock.code] = true;
      });
    });
    var allRows = [];
    groups.forEach(function (group) { group.rows.forEach(function (row) { allRows.push(row); }); });
    var out = [];
    Object.keys(sectors).forEach(function (name) {
      var rows = allRows.filter(function (row) { return members[name] && members[name][row.code]; })
        .sort(function (a, b) { return b.tradingValue - a.tradingValue; });
      if (rows.length) out.push({ sector: name, kind: 'mine', rows: rows, scanTotal: true,
        total: rows.reduce(function (sum, row) { return sum + row.tradingValue; }, 0) });
    });
    groups.forEach(function (group) {
      var rows = group.rows.filter(function (row) { return !inCategory[row.code]; });
      if (rows.length) out.push({ sector: group.sector, kind: 'cand', rows: rows, scanTotal: group.scanTotal,
        total: rows.reduce(function (sum, row) { return sum + row.tradingValue; }, 0) });
    });
    return out;
  }

  // ---- 오늘 거래대금 상위 섹터 (증시온도 체크리스트 아래) ----
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

  // ---- 대표 종목(참고용) + 2주 추적 (2026-10-02 사용자 요청) ----
  // 테마 거래대금 TOP10 각각에서 구성종목 거래대금이 큰 종목 2~3개를 보여 주고, 서버(money_picks.py)가
  // 거래일 15:35 이후 남긴 기준가로 최근 2주 수익률을 확인한다. 선정 규칙은 서버와 같다(중복 종목은 순위 높은 테마에만).
  var MONEY_PICKS_URL = 'https://goodbyestar.cloud/money-picks';
  var MONEY_PICKS_PER_THEME = 3;

  function selectMoneyPicks_(rows) {
    var seen = {};
    return (rows || []).map(function (row) {
      var stocks = (row.stocks || []).slice().sort(function (a, b) { return (Number(b.trade_amount) || 0) - (Number(a.trade_amount) || 0); });
      var picked = [];
      stocks.forEach(function (stock) {
        var code = String(stock.code || '');
        if (picked.length >= MONEY_PICKS_PER_THEME || !code || seen[code] || !(Number(stock.price) > 0)) return;
        seen[code] = true;
        picked.push(stock);
      });
      return picked;
    });
  }

  function moneyPicksLineHtml_(picks) {
    if (!picks || !picks.length) return '';
    return '<div class="mt-sf-picks"><span>대표</span>' + picks.map(function (stock) {
      var r = Number(stock.change_rate);
      return '<a href="' + stockLinkHref_(stock) + '">' + escapeHtml(stock.name || stock.code)
        + '<em class="' + (r > 0 ? 'is-up' : r < 0 ? 'is-down' : 'is-flat') + '">' + rateText_(r) + '</em></a>';
    }).join('') + '</div>';
  }

  var MONEY_PICKS_DISCLAIMER = '※ 대표 종목은 각 테마에서 오늘 거래대금이 가장 큰 종목을 규칙으로 고른 것이며, 매수·매도 추천이나 투자 권유가 아닙니다. 투자 판단과 그 결과의 책임은 본인에게 있으니 참고용으로만 활용하세요.';

  function trackDateText_(date) {
    return String(date || '').slice(5).replace('-', '/');
  }

  function renderPickTracking_(body, summaryEl, history, quotes) {
    var byCode = {};
    (quotes || []).forEach(function (q) { if (q && q.code) byCode[q.code] = q; });
    var items = (history || []).map(function (h) {
      var q = byCode[h.code];
      var now = q ? Number(q.price) : NaN;
      var base = Number(h.rec_price);
      var ret = isFinite(now) && now > 0 && base > 0 ? (now / base - 1) * 100 : NaN;
      return { h: h, now: now, ret: ret };
    });
    var valid = items.filter(function (i) { return isFinite(i.ret); });
    if (!items.length) {
      summaryEl.textContent = '아직 기록 없음';
      body.innerHTML = '<p class="mt-sf-note">대표 종목은 거래일 오후 3시 35분 이후 첫 기록부터 쌓입니다. 기록이 생기면 2주 동안 수익률을 이어서 확인할 수 있습니다.</p>';
      return;
    }
    var avg = valid.length ? valid.reduce(function (s, i) { return s + i.ret; }, 0) / valid.length : NaN;
    var up = valid.filter(function (i) { return i.ret > 0; }).length;
    summaryEl.innerHTML = items.length + '종목 · 평균 <b class="' + (avg > 0 ? 'is-up' : avg < 0 ? 'is-down' : 'is-flat') + '">' + rateText_(avg) + '</b> · 상승 ' + up + '/' + valid.length;
    var days = {};
    var order = [];
    items.forEach(function (i) {
      if (!days[i.h.date]) { days[i.h.date] = []; order.push(i.h.date); }
      days[i.h.date].push(i);
    });
    // 2026-10-04 사용자 지적("나열만 한 것 같다, 흐름이 쭉쭉 이어졌으면"): 종목을 전부 늘어놓지 않고, 기록한 날마다
    // 한 줄(날짜 · 평균 수익률 막대 · 오른 종목 수)로 이어 보여 준다. 누르면 그날 종목이 펼쳐진다.
    var maxAbs = 1;
    order.forEach(function (date) {
      var ok = days[date].filter(function (i) { return isFinite(i.ret); });
      if (!ok.length) return;
      var a = Math.abs(ok.reduce(function (s0, i) { return s0 + i.ret; }, 0) / ok.length);
      if (a > maxAbs) maxAbs = a;
    });
    body.innerHTML = '<div class="mt-track-flow">' + order.map(function (date) {
      var list = days[date];
      var ok = list.filter(function (i) { return isFinite(i.ret); });
      var dayAvg = ok.length ? ok.reduce(function (s0, i) { return s0 + i.ret; }, 0) / ok.length : NaN;
      var wins = ok.filter(function (i) { return i.ret > 0; }).length;
      var tone = dayAvg > 0 ? 'is-up' : dayAvg < 0 ? 'is-down' : 'is-flat';
      var width = isFinite(dayAvg) ? Math.max(3, Math.min(100, Math.abs(dayAvg) / maxAbs * 100)) : 0;
      return '<details class="mt-track-daybox"><summary>'
        + '<time>' + escapeHtml(trackDateText_(date)) + '</time>'
        + '<span class="mt-track-bar"><i class="' + tone + '" style="width:' + width.toFixed(0) + '%"></i></span>'
        + '<b class="' + tone + '">' + escapeHtml(rateText_(dayAvg)) + '</b>'
        + '<small>' + wins + '/' + ok.length + ' 상승</small></summary>'
        + list.map(function (i) {
          var r = i.ret;
          return '<a class="mt-track-row" href="' + stockLinkHref_({ code: i.h.code, name: i.h.name }) + '">'
            + '<span class="mt-track-name">' + escapeHtml(i.h.name) + '<small>' + escapeHtml(i.h.theme) + '</small></span>'
            + '<span class="mt-track-price">' + priceText_(i.h.rec_price) + ' → ' + priceText_(i.now) + '</span>'
            + '<em class="' + (r > 0 ? 'is-up' : r < 0 ? 'is-down' : 'is-flat') + '">' + rateText_(r) + '</em></a>';
        }).join('')
        + '</details>';
    }).join('') + '</div>'
      + '<p class="mt-sf-note">기준가는 기록 시점(거래일 15:35 이후 첫 갱신)의 현재가이고, 수익률은 지금 현재가 기준입니다. 과거 기록일 뿐 앞으로를 보장하지 않으며 수수료·세금은 반영하지 않았습니다.</p>';
  }

  function loadPickTracking_(mount) {
    var box = mount.querySelector('[data-pick-track]');
    if (!box) return;
    var body = box.querySelector('[data-track-body]');
    var summaryEl = box.querySelector('[data-track-summary]');
    mount.__mtTrackingPending = true;
    fetchJson_(MONEY_PICKS_URL).then(function (res) {
      var payload = res && res.data ? res.data : res;
      var history = (payload && payload.history) || [];
      var codes = [];
      history.forEach(function (h) { if (codes.indexOf(h.code) === -1) codes.push(h.code); });
      if (!codes.length) return renderPickTracking_(body, summaryEl, history, []);
      return fetchAllStockQuotes_(codes).catch(function () { return []; }).then(function (quotes) {
        renderPickTracking_(body, summaryEl, history, quotes);
      });
    }).catch(function () {
      summaryEl.textContent = '불러오지 못함';
      body.innerHTML = '<p class="mt-sf-note">추적 기록을 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.</p>';
    }).finally(function () { mount.__mtTrackingPending = false; });
  }

  // 2026-10-04 /page/market-temp 재디자인: 1~5 / 6~10 두 열을 걷고 1~10위를 위에서 아래로 읽는 한 줄 표로 바꿨다.
  // 거래대금 집중도 = 1위 거래대금 대비 비율(1위 100%). 막대는 중립색, 빨강·파랑은 등락률 숫자에만 쓴다.
  // 대표 종목은 표 오른쪽 열에 이름+등락률만 두고(행 전체가 버튼이라 링크는 펼친 구성종목 목록에 있다).
  function sectorFlowRowHtml_(row, index, rows, maxAmount, picks) {
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
    var share = isFinite(amount) && maxAmount > 0 ? amount / maxAmount * 100 : 0;
    var pickHtml = (picks || []).slice(0, 2).map(function (stock) {
      var r = Number(stock.change_rate);
      return '<span class="mt-sf-pick"><span>' + escapeHtml(stock.name || stock.code) + '</span>'
        + '<em class="' + (r > 0 ? 'is-up' : r < 0 ? 'is-down' : 'is-flat') + '">' + rateText_(r) + '</em></span>';
    }).join('');
    var rank = index + 1;
    return '<div class="mt-sf-item">'
      + '<button type="button" class="mt-sf-row ' + tone + '" data-sf-index="' + index + '" aria-expanded="false">'
      + '<i class="mt-sf-rank">' + rank + '</i>'
      + '<b>' + escapeHtml(row.industry || '-') + '</b>'
      + '<span class="mt-sf-meta">'
      + '<span class="mt-sf-mult">' + escapeHtml(sectorFlowAmountText_(row) || '-') + '</span>'
      + '<span class="mt-sf-rate">' + (isFinite(rate) ? (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '-') + '</span>'
      + '</span>'
      + '<span class="mt-sf-conc"><span class="mt-sf-bar" aria-hidden="true"><i style="width:' + Math.max(2, Math.min(100, share)).toFixed(1) + '%"></i></span>'
      + '<em class="mt-sf-pct">' + Math.round(share) + '%</em></span>'
      + '<span class="mt-sf-picks-col">' + pickHtml + '</span>'
      + '<i class="mt-sf-caret" aria-hidden="true">▾</i>'
      + '</button>'
      + '<div class="mt-sf-detail" hidden>'
      + (row.stocks || []).map(sectorFlowStockHtml_).join('')
      + derivedHtml
      + '</div></div>';
  }

  // 오늘의 HOT 테마: 서버가 내려준 섹터 자금 흐름 1위 테마를 그대로 읽어 문구를 만든다(뉴스·추측 문구 없음, 값이 바뀌면 문구도 바뀜).
  function renderHotTheme_(row) {
    var strip = document.querySelector('[data-hot-theme]');
    if (!strip) return;
    if (!row || !row.industry) { strip.hidden = true; return; }
    var rate = Number(row.avg_change_rate);
    var stocks = (row.stocks || []).slice().sort(function (a, b) { return (Number(b.change_rate) || -999) - (Number(a.change_rate) || -999); });
    var lead = stocks[0];
    var parts = [];
    if (isFinite(rate)) parts.push('평균 ' + (rate > 0 ? '+' : '') + rate.toFixed(2) + '%');
    var amount = sectorFlowAmountText_(row);
    if (amount) parts.push('거래대금 ' + amount);
    var leadRate = lead ? Number(lead.change_rate) : NaN;
    var headline = '거래대금이 가장 몰린 테마 · ' + parts.join(' · ')
      + (lead && isFinite(leadRate) ? ' · ' + lead.name + ' ' + (leadRate > 0 ? '+' : '') + leadRate.toFixed(1) + '% 선두' : '');
    strip.innerHTML = '<span class="mt-hot-icon" aria-hidden="true">🔥</span>'
      + '<span class="mt-hot-label">오늘의 <b class="mt-hot-hot">HOT</b> 테마 <b class="mt-hot-name">' + escapeHtml(industryDisplayName_(row.industry)) + '</b></span>'
      + '<i class="mt-hot-sep" aria-hidden="true"></i><span class="mt-hot-headline">' + escapeHtml(headline) + '</span>'
      + '<span class="mt-hot-go" aria-hidden="true">›</span>';
    strip.setAttribute('role', 'button');
    strip.tabIndex = 0;
    strip.onclick = strip.onkeydown = function (event) {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      var card = document.querySelector('.mt-sf-card');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    strip.hidden = false;
  }

  function renderSectorFlow_(mount, rows) {
    if (!mount) return;
    var shown = (rows || []).slice(0, SECTOR_FLOW_TOP);
    if (!shown.length) { mount.innerHTML = ''; return; }
    renderHotTheme_(shown[0]);
    var maxAmount = shown.reduce(function (max, row) {
      var amount = Number(row && row.trade_amount);
      return isFinite(amount) && amount > max ? amount : max;
    }, 0);
    var picksByRow = selectMoneyPicks_(shown);
    var tracking = mount.querySelector('[data-pick-track]');
    var trackingHtml = tracking && tracking.outerHTML;
    var basis = '키움증권 테마 기준입니다. 오늘 많이 오른 테마 20개 중 구성종목 거래대금(현재가×거래량 추정)이 큰 순서입니다. 막대는 1위 거래대금 대비 비율이며, 행을 누르면 구성종목과 함께 볼 섹터가 열립니다.';
    var sfDate = mount.getAttribute('data-sf-date');
    mount.innerHTML = '<div class="mt-section mt-card mt-sf-card">'
      + '<div class="mt-cp-head"><div class="mt-strategy-panel-title">오늘 거래대금 상위 섹터</div>'
      + (sfDate ? '<span class="mt-cp-date">' + escapeHtml(sfDate) + '</span>' : '') + '</div>'
      + '<p class="mt-cp-sub">거래대금 순위와 평균 등락률을 함께 봅니다. 거래대금만으로 매수 주도 여부는 알 수 없습니다.</p>'
      + '<div class="mt-sf-visual-head"><span>오늘 거래대금 상위 섹터</span><small>막대 = 1위 대비 거래대금 · 빨강 상승 · 파랑 하락</small></div>'
      + '<div class="mt-sf-thead" aria-hidden="true"><span>순위</span><span>섹터명</span><span class="mt-sf-th-meta"><span>거래대금</span><span>등락률(평균)</span></span><span>거래대금 집중도</span><span>대표 종목 (등락률)</span></div>'
      + '<div class="mt-sf-grid">'
      + shown.map(function (row, i) { return sectorFlowRowHtml_(row, i, rows, maxAmount, picksByRow[i]); }).join('')
      + '</div>'
      + '<p class="mt-sf-note">' + sentenceHtml_(basis) + '</p>'
      + '<p class="mt-sf-disclaimer">' + sentenceHtml_(MONEY_PICKS_DISCLAIMER) + '</p>'
      + '<details class="mt-sf-track" data-pick-track><summary>대표 종목 2주 추적 <span data-track-summary>불러오는 중...</span></summary>'
      + '<div data-track-body><div class="mt-hint">기록을 불러오는 중입니다.</div></div></details>'
      + '</div>';
    if (trackingHtml) mount.querySelector('[data-pick-track]').outerHTML = trackingHtml;
    else loadPickTracking_(mount);
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
    return sharedMarketJson_('__mtSectorFetch', SECTOR_FLOW_URL, 180000)
      .then(function (body) {
        var payload = body && body.data ? body.data : body;
        var rows = (payload && payload.rows) || [];
        if (!rows.length && mount.__mtSectorHasRows) throw new Error('업종 자료 지연');
        var key = JSON.stringify(rows);
        if (mount.__mtSectorKey === key) return;
        // 상세를 읽는 동안 목록을 교체해 포커스·선택한 섹터를 바꾸지 않는다.
        if (mount.__mtTrackingPending || mount.contains(document.activeElement) || mount.querySelector('.mt-sf-row.is-open, details[open]')) return;
        renderSectorFlow_(mount, rows);
        mount.__mtSectorKey = key;
        mount.__mtSectorHasRows = rows.length > 0;
      });
  }

  function buildStocksOnlyPage() {
    var params = new URLSearchParams(String(global.location && global.location.search || ''));
    var requestedPanel = params.get('panel');
    var initialView = requestedPanel === 'all' ? 'active'
      : ['cards', 'active', 'heatmap', 'marketcap'].indexOf(requestedPanel) !== -1 ? requestedPanel : 'cards';
    return '<div class="mt-stocks-only">'
      + '<div class="mt-stocks-only-heading"><h1>국내 주요종목</h1><p>내 카테고리를 기준으로 종목을 모니터링하고, 오늘 거래대금 상위 섹터와 연결해서 봅니다.</p></div>'
      + '<section class="mt-section-block">'
      + '<div class="mt-section-head"><h2>오늘 거래대금 상위 섹터</h2><p>거래대금 막대 표는 증시온도에서 봅니다. 여기서는 같은 순위를 내 카테고리와 연결해서 모니터링합니다.</p></div>'
      + '<div data-money-strip><div class="mt-hint">거래대금 상위 섹터를 불러오는 중입니다.</div></div>'
      + '</section>'
      + '<section class="mt-section-block">'
      + '<div class="mt-section-head"><h2>내 카테고리 모니터링</h2><p>거래대금 상위 카테고리가 앞에 옵니다. 활성 종목 탭에서 카테고리에 없는 종목을 편입하고, 새 카테고리는 키움 테마에서 추가합니다.</p></div>'
      + buildExploreCard(initialView)
      + '</section>'
      + '</div>';
  }

  function init(opts) {
    var stocksOnly = isStocksView();
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    if (stocksOnly) {
      // 본문 스크립트·스킨 로더·DOMContentLoaded가 같은 화면을 다시 초기화하지 않는다.
      if (container.__mtStocksInitialized) return;
      container.__mtStocksInitialized = true;
      container.innerHTML = buildStocksOnlyPage();
      wireViewTabs(container);
      loadMoneyStrip_(container);
      return;
    }
    if (container.__mtLivePage) return;
    var page = { data: null, indicators: null };
    container.__mtLivePage = page;
    container.innerHTML = '<div class="mt-hint">증시온도 불러오는 중...</div>';
    function apply(data) {
      if (!data || typeof data.temp !== 'number') throw new Error('시장 자료 지연');
      page.data = data;
      if (!page.indicators) {
        container.innerHTML = buildCard(data);
        wireAnimations(container, data);
        page.indicators = loadMarketIndicators_(container, data);
        scrollToHash_(container);
        mountRotation_(container);
      } else {
        replaceMarketNode_(container.querySelector('.mt-market-intro'), buildMarketIntro_(data));
        replaceMarketNode_(container.querySelector('.mt-page-head'), buildPageHead_(data));
        replaceMarketNode_(container.querySelector('.mt-breadth-visual'), buildBreadthVisual_(frontPageStory_(data)));
        var updated = container.querySelector('.mt-updated');
        if (updated) updated.textContent = (window.NineTime && window.NineTime.updated(data.updatedAt)) || ('자료 기준 · ' + (data.updatedAt || '확인 중'));
        page.indicators.setSnapshot(data);
      }
    }
    page.loop = createMarketRefreshLoop_({
      alive: function () { return container.isConnected; },
      task: function () {
        var partial = false;
        return MarketTemp.fetchMarketTemp().then(apply).catch(function () {
          partial = true;
          if (!page.data) container.innerHTML = '<div class="mt-error">시장 자료를 받지 못했습니다. 자동으로 다시 확인합니다.</div><div data-mt-live-status class="mt-live-status"></div>';
        }).then(function () {
          if (!page.indicators) return { partial: true };
          return Promise.allSettled([page.indicators.refresh(), loadSectorFlow_(container)]).then(function (results) {
            return { partial: partial || results.some(function (r) { return r.status === 'rejected' || (r.value && r.value.partial); }) };
          });
        });
      },
      onState: function (state) {
        var status = container.querySelector('[data-mt-live-status]');
        if (!status) return;
        var text = state.paused ? '자동 갱신 대기 · 숨긴 화면/오프라인에서는 요청을 멈춥니다.'
          : state.busy ? '저장된 시장 자료 확인 중…'
          : state.partial ? (page.data ? '일부 자료 응답 지연 · 마지막 정상 수신값 유지' : '시장 자료 수신 대기') + ' · 다음 확인 ' + Math.round(state.delay / 60000) + '분 후'
          : (marketRefreshDelay_() === 60000 ? '자동 갱신 · 국내 지표 1분 / 요약 3분 / 해외 5분' : '자동 갱신 · 장외 5분') + ' · 화면 확인 ' + new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
        if (status.textContent !== text) status.textContent = text;
      }
    });
    page.loop.runNow();
  }

  function replaceMarketNode_(node, html) {
    if (node && node.outerHTML !== html) node.outerHTML = html;
  }

  function marketRefreshDelay_(date) {
    date = date || new Date();
    var kst = new Date(date.getTime() + 9 * 3600000), day = kst.getUTCDay(), minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var trading = global.MarketHours && global.MarketHours.isKrTradingDay ? global.MarketHours.isKrTradingDay(date) : day > 0 && day < 6;
    return trading && minutes >= 540 && minutes < 940 ? 60000 : 300000;
  }

  function createMarketRefreshLoop_(options) {
    var timer = null, busy = false, stopped = false, suspended = false, failures = 0, nextAt = 0;
    function paused() { return suspended || document.hidden || (global.navigator && global.navigator.onLine === false); }
    function delay() { return Math.min(600000, marketRefreshDelay_() * Math.pow(2, Math.min(failures, 4))); }
    function emit(extra) { if (options.onState) options.onState(Object.assign({ busy: busy, paused: !!paused(), partial: failures > 0, delay: delay() }, extra || {})); }
    function clear() { if (timer != null) clearTimeout(timer); timer = null; }
    function schedule() {
      clear();
      if (stopped || busy || paused()) return;
      timer = setTimeout(runNow, Math.max(0, nextAt - Date.now()));
    }
    function runNow() {
      clear();
      if (stopped || busy || paused()) { emit(); return Promise.resolve(); }
      if (options.alive && !options.alive()) { stop(); return Promise.resolve(); }
      busy = true; emit();
      return Promise.resolve().then(options.task).then(function (result) {
        failures = result && result.partial ? failures + 1 : 0;
      }, function () { failures++; }).then(function () {
        busy = false; nextAt = Date.now() + delay(); emit(); schedule();
      });
    }
    function resume() {
      clear(); emit();
      if (!busy && !paused()) { if (Date.now() >= nextAt) runNow(); else schedule(); }
    }
    function hide() { suspended = true; clear(); emit(); }
    function show() { suspended = false; resume(); }
    function stop() {
      stopped = true; clear();
      document.removeEventListener('visibilitychange', resume);
      global.removeEventListener('online', resume); global.removeEventListener('offline', resume);
      global.removeEventListener('pagehide', hide); global.removeEventListener('pageshow', show);
    }
    document.addEventListener('visibilitychange', resume);
    global.addEventListener('online', resume); global.addEventListener('offline', resume);
    global.addEventListener('pagehide', hide); global.addEventListener('pageshow', show);
    return { runNow: runNow, stop: stop };
  }

  // 2026-10-05 사용자 리포트("거래대금 막대로 보기 링크 깨짐"): 본문이 비동기로 그려져 브라우저 기본 #앵커 이동이
  // 맨 위에서 멈췄다. 렌더 뒤 위쪽 카드(내일 카드·HOT 테마)가 채워지며 밀리므로 몇 번 다시 맞춘다.
  function scrollToHash_(container) {
    var hash = String(global.location && global.location.hash || '').replace(/^#/, '');
    if (!/^mt-[a-z-]+$/.test(hash)) return;
    [80, 900, 2200].forEach(function (ms) {
      setTimeout(function () {
        var target = container.querySelector('#' + hash);
        if (target && target.scrollIntoView) {
          var parent = target.parentElement;
          while (parent && parent !== container) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
          target.scrollIntoView({ block: 'start' });
        }
      }, ms);
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
    return sharedMarketJson_('__mtSnapshotFetch', MARKET_TEMP_URL, 180000).then(function (body) { return body && body.data ? body.data : body; });
  }

  function sharedMarketJson_(key, url, ttl) {
    var cached = global[key];
    if (!cached || (!cached.pending && Date.now() - cached.started >= ttl)) {
      cached = { started: Date.now(), pending: true }; global[key] = cached;
      cached.promise = fetchJson_(url).then(function (body) { cached.pending = false; return body; }, function (error) {
        if (global[key] === cached) global[key] = null;
        throw error;
      });
    }
    return cached.promise;
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
    var summary = data && data.score100 != null ? Number(data.score100) : NaN;
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
    money: ['매도 우위', '혼조', '매수 우위'],
    price: ['내림 우세', '비슷함', '오름 우세'],
    risk: ['낮음', '보통', '높음']
  };

  function axisWord(key, value) {
    if (!isFinite(value)) return '';
    var words = AXIS_WORDS[key] || ['약함', '보통', '강함'];
    return value >= AXIS_HIGH ? words[2] : value >= AXIS_LOW ? words[1] : words[0];
  }

  // 2026-10-04 사용자 지적("돈/가격/위험 기준을 개미는 몰라, 모르는 상태에서 보여주는 건 가비지"):
  // 축마다 "그래서 지금 무엇이 어떤가"를 한 문장으로 붙인다. 숫자는 서버가 이미 내려준 값만 쓴다.
  function axisReason_(key, data) {
    var c = (data && data.components) || {};
    function pct(v, digits) { return (Number(v) * 100).toFixed(digits == null ? 0 : digits) + '%'; }
    if (key === 'money') {
      var parts = [];
      if (c.tradingValue && isFinite(c.tradingValue.relative)) {
        var r = c.tradingValue.relative;
        parts.push('거래대금은 최근 5일 평균의 ' + pct(r) + (r >= 1.1 ? ' (평소보다 활발)' : r >= 0.9 ? ' (평소 수준)' : ' (평소보다 한산)'));
      }
      if (c.flow && c.flow.foreign && c.flow.inst) {
        var f = c.flow.foreign.ratio, i = c.flow.inst.ratio;
        function dir(v) { return v > 0.05 ? '순매수' : v < -0.05 ? '순매도' : '관망'; }
        if (isFinite(f) && isFinite(i)) parts.push('최근 5일 외국인 ' + dir(f) + ' · 기관 ' + dir(i));
      }
      return parts.join(' / ');
    }
    if (key === 'price') {
      var p = [];
      var b = data && data.marketBreadth && data.marketBreadth.total;
      if (b && b.total) p.push('상승 ' + b.up + ' · 하락 ' + b.down + ' (오른 종목 ' + Math.round(b.up / (b.up + b.down) * 100) + '%)');
      if (c.avgChange && isFinite(c.avgChange.avgChangeRate)) {
        var a = c.avgChange.avgChangeRate;
        p.push('대형주 평균 ' + (a > 0 ? '+' : '') + a.toFixed(2) + '%');
      }
      return p.join(' / ');
    }
    if (key === 'risk') {
      var w = [];
      function tag(name, comp, text) {
        if (!comp) return;
        var max = (COMPONENT_BY_KEY[name] && COMPONENT_BY_KEY[name].max) || 0;
        var ratio = max && isFinite(comp.score) ? comp.score / max : null;
        w.push({ text: text, ratio: ratio });
      }
      tag('vix', c.vix, c.vix && isFinite(c.vix.value) ? '미국 공포지수(VIX) ' + c.vix.value.toFixed(1) : '');
      tag('exchange', c.exchange, c.exchange && isFinite(c.exchange.price) ? '원/달러 ' + Math.round(c.exchange.price).toLocaleString('ko-KR') + '원(' + (c.exchange.changeRate > 0 ? '+' : '') + c.exchange.changeRate + '%)' : '');
      tag('rates', c.rates, c.rates && c.rates.band ? '금리 ' + c.rates.band.replace(/ · /g, ', ') : '');
      if (c.creditRisk && c.creditRisk.available) w.push({ text: '빚투 ' + (c.creditRisk.stateLabel || ''), ratio: c.creditRisk.score / (c.creditRisk.max || 10) });
      var cautious = w.filter(function (x) { return x.text && x.ratio != null && x.ratio < 0.5; });
      var calm = w.filter(function (x) { return x.text && !(x.ratio != null && x.ratio < 0.5); });
      var out = '';
      if (cautious.length) out += '<b class="mt-axis-warn">조심: ' + escapeHtml(cautious.map(function (x) { return x.text; }).join(' · ')) + '</b> ';
      if (calm.length) out += '<span>안정: ' + escapeHtml(calm.map(function (x) { return x.text; }).join(' · ')) + '</span>';
      return out || '';
    }
    return '';
  }

  function buildAxisRow(axis, icon, data) {
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
      + '<b class="mt-axis-value">' + (isFinite(value) ? value.toFixed(0) + '<small>점</small>' : '-') + '</b>'
      + '<small class="mt-axis-word">' + escapeHtml(axisWord(axis && axis.key, value)) + '</small>'
      + '<p class="mt-axis-reason">' + (axis && axis.key === 'risk' ? axisReason_('risk', data) : escapeHtml(axisReason_(axis && axis.key, data))) + '</p>'
      + '</div>';
  }

  // 반원 다이얼 좌표 계산 - 0점은 정왼쪽(180˚), 100점은 정오른쪽(0˚), 위쪽 반원을 훑는다.
  function polarPoint_(cx, cy, r, angleDeg) {
    var rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  }

  // 0~100 점수 구간(공포·보통·과열)별 색 - 판정은 scoreTone_ 하나(서버 market_temp_score.GRADE3 경계 30·70과 같다).
  function zoneColor_(v) { return ZONE_COLOR_[scoreTone_(v)]; }

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

  // updatedAt은 수집 시각이다. 장 시작 전(09시 전)·주말에는 시세가 직전 거래일 마감값이므로
  // 오늘 값처럼 읽히지 않게 기준을 '직전 마감'으로 표시한다(2026-10-23 장전 상승 17·하락 216 문의).
  function quotesAreStale_(data) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(String(data && data.updatedAt || ''));
    if (!m) return false;
    var day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
    return day === 0 || day === 6 || +m[4] < 9;
  }

  // Headlines describe the observed universe; the score is supporting evidence, not a forecast.
  function frontPageStory_(data) {
    var components = data.components || {};
    var whole = data.marketBreadth && data.marketBreadth.total;
    var sample = components.riseRatio;
    function valid(b) {
      return b && typeof b.total === 'number' && b.total > 0
        && typeof b.up === 'number' && isFinite(b.up) && b.up >= 0
        && typeof b.down === 'number' && isFinite(b.down) && b.down >= 0
        && b.up + b.down <= b.total;
    }
    var broad = valid(whole), breadth = broad ? whole : valid(sample) ? sample : null;
    function number(v) { return v.toLocaleString('ko-KR'); }
    var headline = '오늘 시장 흐름을 확인하세요';
    var lead = '상승·하락 종목 집계를 확인하고 있습니다.';
    var asOf = broad && breadth.asOf ? String(breadth.asOf).slice(5).replace('-', '/') : '';
    var scope = (asOf ? asOf + ' 마감 ' : quotesAreStale_(data) ? '직전 마감 기준 ' : '') + (broad ? '코스피·코스닥 전체 집계' : '분석 대상 ' + (breadth ? number(breadth.total) : '') + '종목');
    if (breadth) {
      // 분석 대상(섹터 풀 표본)은 시장 전체가 아니므로 문구에 모수를 밝힌다.
      var pool = broad ? '' : '분석 대상 ' + number(breadth.total) + '종목 중 ';
      if (breadth.down > breadth.up * 1.5) {
        headline = broad ? '하락 종목 ' + number(breadth.down) + '개, 내림세 우세' : pool + number(breadth.down) + '개 하락';
        lead = scope + ' 중 ' + Math.round(breadth.down / breadth.total * 100) + '%가 하락했습니다.';
      } else if (breadth.up > breadth.down * 1.5) {
        headline = broad ? '상승 종목 ' + number(breadth.up) + '개, 오름세 우세' : pool + number(breadth.up) + '개 상승';
        lead = scope + ' 중 ' + Math.round(breadth.up / breadth.total * 100) + '%가 상승했습니다.';
      } else {
        headline = breadth.up + breadth.down === 0 ? '가격 변화 없이 보합인 시장' : '상승·하락 종목이 엇갈린 시장';
        lead = scope + '에서 상승 ' + number(breadth.up) + '개, 하락 ' + number(breadth.down) + '개로 집계됐습니다.';
      }
    }
    var flow = components.flow || {};
    var foreign = flow.foreign && flow.foreign.ratio, inst = flow.inst && flow.inst.ratio;
    var flowText = '수급 집계를 확인하고 있습니다.';
    if (typeof foreign === 'number' && isFinite(foreign) && typeof inst === 'number' && isFinite(inst)) {
      function direction(v) { return v > 0.05 ? '순매수' : v < -0.05 ? '순매도' : '중립'; }
      flowText = '최근 5일 외국인 ' + direction(foreign) + ' · 기관 ' + direction(inst);
    }
    var dir = !breadth ? '' : breadth.down > breadth.up * 1.5 ? 'down' : breadth.up > breadth.down * 1.5 ? 'up' : '';
    return { headline: headline, lead: lead, flow: flowText, breadth: breadth, wholeMarket: broad, dir: dir };
  }

  function buildMarketIntro_(data) {
    var story = frontPageStory_(data), tone = scoreTone_(score100(data));
    return '<header class="mt-market-intro mt-market-' + tone + '">'
      + '<div class="mt-front-kicker"><span class="mt-edition-tag">오늘의 증시</span><span>시장 한눈에 보기</span></div>'
      + '<div class="mt-intro-line"><h2 class="mt-front-headline' + (story.dir ? ' is-' + story.dir : '') + '">' + escapeHtml(story.headline) + '</h2>'
      + '<p class="mt-front-lead">' + sentenceHtml_(story.lead) + '</p></div></header>';
  }

  function buildBreadthVisual_(story) {
    var b = story.breadth;
    if (!b) return '<div class="mt-breadth-visual mt-visual-empty">상승·하락 종목 집계를 확인하고 있습니다.</div>';
    var flat = typeof b.flat === 'number' && isFinite(b.flat) && b.flat >= 0 ? b.flat : null;
    var text = '상승 ' + b.up.toLocaleString('ko-KR') + '개 · 하락 ' + b.down.toLocaleString('ko-KR') + '개';
    if (flat != null) text += ' · 보합 ' + flat.toLocaleString('ko-KR') + '개';
    // 숫자는 수급 비중 막대처럼 구간 안에 쓴다. 좁은 구간은 숫자만, 4% 미만이면 막대 밖 작은 줄로 옮겨 정보가 사라지지 않게 한다.
    var smallFlat = 0;
    function segment(cls, label, count) {
      if (count == null) return '<i class="' + cls + '" style="width:0%"></i>';
      var pct = count / b.total * 100, style = ' style="width:' + pct.toFixed(3) + '%"';
      if (pct < 4) { if (cls === 'is-flat') smallFlat = count; return '<i class="' + cls + '"' + style + '></i>'; }
      return '<i class="' + cls + (pct < 14 ? ' is-small' : '') + '"' + style + ' title="' + label + ' ' + count.toLocaleString('ko-KR') + '">'
        + (pct < 14 ? '' : label + ' ') + count.toLocaleString('ko-KR') + '</i>';
    }
    return '<section class="mt-breadth-visual"><div class="mt-visual-title"><h3>오른 종목과 내린 종목</h3><small>'
      + (story.wholeMarket ? '코스피·코스닥' : '분석 대상 종목') + '</small></div>'
      + '<div class="mt-breadth-track" role="img" aria-label="' + escapeHtml(text) + '">'
      + segment('is-up', '상승', b.up) + segment('is-flat', '보합', flat) + segment('is-down', '하락', b.down) + '</div>'
      + (smallFlat ? '<small class="mt-breadth-flat-note">보합 ' + smallFlat.toLocaleString('ko-KR') + '</small>' : '') + '</section>';
  }

  function buildFlowSnapshot_(data) {
    var flow = (data.components || {}).flow || {};
    function actor(key, label) {
      var v = flow[key] && flow[key].ratio;
      var valid = typeof v === 'number' && isFinite(v);
      var kind = !valid || Math.abs(v) <= 0.05 ? 'flat' : v > 0 ? 'up' : 'down';
      var word = !valid ? '확인 중' : kind === 'up' ? '순매수' : kind === 'down' ? '순매도' : '중립';
      return '<div class="mt-flow-actor"><span>' + label + '</span><b class="mt-flow-status is-' + kind + '">'
        + (kind === 'up' ? '↗ ' : kind === 'down' ? '↘ ' : '') + word + '</b></div>';
    }
    return '<section class="mt-flow-snapshot"><div class="mt-visual-title"><h3>외국인·기관 수급</h3><small>최근 5거래일</small></div>'
      + '<div class="mt-flow-actors">' + actor('foreign', '외국인') + actor('inst', '기관') + '</div></section>';
  }

  function buildSummaryCard(data) {
    return '<article class="mt-section mt-card mt-summary-card mt-front-story mt-direct-overview">'
      + buildBreadthVisual_(frontPageStory_(data))
      + '<div class="mt-visual-title mt-overview-title"><h3>시장 한눈에</h3><small>항목을 눌러 추이 보기</small></div>'
      + '<div data-market-indicators>' + renderIndicatorRows_(buildIndicatorModels_({}, []), 'kospi-volume') + '</div>'
      + '<details class="mt-front-details"><summary>데이터 출처·기준 안내</summary>'
      + '<p class="mt-front-method">거래량은 직전 20개 일별 기록 평균을 100%로 비교합니다. 50% 미만 극도로 낮음, 80% 미만 낮음, 120% 미만 평소 수준, 180% 미만 높음, 그 이상 극도로 높음입니다. 장중에는 마감 전 누적치임을 표시합니다. 수급 비중은 같은 기준일의 외국인·기관·개인 순매매 금액 절댓값 합계입니다. 환율 저울은 직전 일별 기록 대비 상대 강도를 나타냅니다. 신용융자·예탁금과 수급은 국내 시장지표, 미국채 10년물·원/달러는 글로벌 시장지표를 사용하며 항목별 기준일은 다를 수 있습니다.</p></details></article>';
  }

  function indicatorNumber_(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }
  function indicatorDate_(value, anchor) {
    var raw = String(value || ''), m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(raw);
    if (!m) {
      var short = /^(\d{2})[./](\d{2})$/.exec(raw), base = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(anchor || ''));
      if (!short || !base) return null;
      var year = Number(base[1]);
      if (short[1] + short[2] > base[2] + base[3]) year--;
      m = [null, String(year), short[1], short[2]];
    }
    var date = m[1] + '-' + m[2] + '-' + m[3], d = new Date(date + 'T00:00:00Z');
    return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date ? date : null;
  }
  function indicatorPoints_(rows) {
    var byDate = {};
    (rows || []).forEach(function (row) {
      var date = indicatorDate_(row.date), value = indicatorNumber_(row.value);
      if (date && value != null) byDate[date] = { date: date, score: value };
    });
    return Object.keys(byDate).sort().map(function (date) { return byDate[date]; }).slice(-120);
  }
  function indicatorMoney_(value) {
    var abs = Math.abs(value);
    return (value < 0 ? '−' : '') + (abs >= 1e12 ? (abs / 1e12).toFixed(2) + '조원' : (abs / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '억원');
  }
  function buildIndicatorModels_(domestic, macro) {
    domestic = domestic || {}; macro = Array.isArray(macro) ? macro : [];
    var factors = { krw: 1, million_krw: 1e6, hundred_million_krw: 1e8 };
    var models = [];
    function model(id, label, detail, points, format, zeroBase, signed, rateUnit) {
      points = indicatorPoints_(points);
      var last = points[points.length - 1], prior = points[points.length - 2];
      var delta = last && prior ? last.score - prior.score : null;
      var tone = signed && last ? Math.sign(last.score) : delta == null ? 0 : Math.sign(delta);
      var change = delta == null ? '비교 기록 없음' : delta === 0 ? '변화 없음'
        : rateUnit ? (delta > 0 ? '+' : '') + delta.toFixed(2) + rateUnit
        : prior.score ? (delta > 0 ? '+' : '') + (delta / Math.abs(prior.score) * 100).toFixed(1) + '%' : '직전 값 0';
      models.push({ id: id, label: label, detail: detail, points: points, format: format, axisFormat: function (v) { return format(v).replace('조원', '조').replace('억원', '억').replace(/원$/, ''); }, zeroBase: zeroBase,
        value: last ? last.score : null, valueText: last ? format(last.score) : '확인 중', date: last ? last.date : null, delta: delta,
        changeText: signed && last ? (id.indexOf('volume') >= 0 ? (last.score > 0 ? '거래량 증가' : last.score < 0 ? '거래량 감소' : '거래량 변화 없음') : (last.score > 0 ? '순매수' : last.score < 0 ? '순매도' : '중립')) : change, tone: tone > 0 ? 'positive' : tone < 0 ? 'negative' : 'neutral', signed: signed });
    }
    ['KOSPI', 'KOSDAQ'].forEach(function (key) {
      var item = (domestic.indices || {})[key] || {};
      var rows = ((item.intervals || {}).day || {}).rows || [];
      var volumes = indicatorPoints_(rows.map(function (r) { return { date: r.date, value: indicatorNumber_(r.volume) > 0 ? r.volume : null }; }));
      var points = volumes.slice(20).map(function (row, i) {
        var avg = volumes.slice(i, i + 20).reduce(function (sum, r) { return sum + r.score; }, 0) / 20;
        return { date: row.date, value: row.score / avg * 100 };
      });
      var kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
      var intraday = points.length && points[points.length - 1].date === kst.slice(0, 10) && kst.slice(11, 16) < '15:40';
      model(key.toLowerCase() + '-volume', key === 'KOSPI' ? '코스피 거래량' : '코스닥 거래량', (intraday ? '장중 누적 · ' : '') + '직전 20개 기록 평균 = 100%', points,
        function (v) { return v.toFixed(1) + '%'; }, true, false, '%p');
      var volumeModel = models[models.length - 1], v = volumeModel.value;
      volumeModel.intraday = !!intraday;
      volumeModel.statusText = v == null ? '확인 중' : intraday ? '장중 집계' : v < 50 ? '극도로 낮음' : v < 80 ? '낮음' : v < 120 ? '평소 수준' : v < 180 ? '높음' : '극도로 높음';
      volumeModel.changeText = volumeModel.statusText;
      volumeModel.tone = v == null || intraday || (v >= 80 && v < 120) ? 'neutral' : v < 80 ? 'negative' : 'positive';
    });
    var funds = domestic.funds || {};
    [['credit', '빚투 · 신용융자', 'credit', 'loan_total', 'credit_unit'], ['deposits', '고객예탁금', 'market_funds', 'investor_deposits', 'market_funds_unit']].forEach(function (spec) {
      var factor = factors[funds[spec[4]]], rows = [];
      if (funds.available !== false && factor) {
        rows = (funds.series || []).map(function (row) {
          var field = row[spec[2]], value = typeof field === 'number' ? field : field && field[spec[3]];
          return { date: field && field.date || row.date, value: indicatorNumber_(value) != null && value >= 0 ? value * factor : null };
        });
        var current = funds[spec[2]] || {}, value = current[spec[3]];
        if (indicatorNumber_(value) != null && value >= 0) rows.push({ date: current.date || funds.latest_date, value: value * factor });
      }
      model(spec[0], spec[1], '잔액', rows, indicatorMoney_, false, false);
    });
    var investor = domestic.investor || {};
    var marketRows = ['KOSPI', 'KOSDAQ'].map(function (key) {
      var data = investor[key] || {};
      return (data.rows || []).filter(function (r) { return [r.individual, r.foreign, r.institution].some(function (v) { return indicatorNumber_(v) != null && v !== 0; }); })
        .map(function (r) { return { date: indicatorDate_(r.date || r.label, data.asOf), foreign: indicatorNumber_(r.foreign), institution: indicatorNumber_(r.institution), individual: indicatorNumber_(r.individual) }; }).filter(function (r) { return r.date; });
    });
    ['foreign', 'institution', 'individual'].forEach(function (field) {
      var rows = [], scope = '코스피·코스닥 일별 순매수';
      if (marketRows[0].length && marketRows[1].length) {
        var second = {}; marketRows[1].forEach(function (r) { second[r.date] = r; });
        rows = marketRows[0].filter(function (r) { return second[r.date] && r[field] != null && second[r.date][field] != null; })
          .map(function (r) { return { date: r.date, value: (r[field] + second[r.date][field]) * 1e8 }; });
      } else {
        var which = marketRows[0].length ? 0 : 1;
        scope = (which === 0 ? '코스피' : '코스닥') + ' 일별 순매수';
        rows = marketRows[which].map(function (r) { return { date: r.date, value: r[field] == null ? null : r[field] * 1e8 }; });
      }
      model(field, { foreign: '외국인', institution: '기관', individual: '개인' }[field], scope, rows, function (v) { return (v > 0 ? '+' : '') + indicatorMoney_(v); }, true, true);
    });
    [['US10Y', 'us-rate', '미국 금리', '국채 10년물', '%'], ['USDKRW', 'fx', '원/달러 환율', '일별 기준', '원']].forEach(function (spec) {
      var item = macro.filter(function (r) { return r.symbol === spec[0]; })[0] || {};
      var rows = (item.chart || []).map(function (r) { return { date: r.date, value: indicatorNumber_(r.close) > 0 ? r.close : null }; });
      model(spec[1], spec[2], spec[3], rows, function (v) { return v.toLocaleString('ko-KR', { minimumFractionDigits: spec[0] === 'US10Y' ? 2 : 1, maximumFractionDigits: spec[0] === 'US10Y' ? 2 : 1 }) + spec[4]; }, false, false, spec[0] === 'US10Y' ? '%p' : '원');
    });
    var kf = macro.filter(function (r) { return r.symbol === 'KOSPI200_DAY'; })[0], kfPoints = [];
    if (kf && kf.stale !== true) {
      var kl = (kf.chart || []).slice(-1)[0], ks = kl ? String(kl.date) : '';
      var age = kl ? Date.now() - Date.UTC(+ks.slice(0, 4), +ks.slice(4, 6) - 1, +ks.slice(6, 8)) : Infinity;
      if (age <= 5 * 86400000 + 9 * 3600000) kfPoints = (kf.chart || []).map(function (r) { return { date: r.date, value: indicatorNumber_(r.close) > 0 ? r.close : null }; });
    }
    model('kospi-futures', '코스피200 주간선물', '주간선물 일봉 종가', kfPoints, function (v) { return v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }, false, false);
    var kfModel = models[models.length - 1];
    kfModel.statusText = kfModel.delta == null ? '' : kfModel.delta > 0 ? '상승' : kfModel.delta < 0 ? '하락' : '보합';
    kfModel.noData = macro.length > 0 && kfModel.value == null;
    return models;
  }
  // 상태 단어의 방향 화살표(↗ 빨강 · ↘ 파랑 · → 회색). 방향이 없는 단어('장중 집계', '확인 중')에는 붙이지 않는다.
  function wordArrow_(word) {
    var kind = /(상승|증가|높음|강세|순매수)/.test(word) ? 'up' : /(하락|감소|낮음|약세|순매도)/.test(word) ? 'down' : /(평소|보합|중립|변화 없음)/.test(word) ? 'flat' : '';
    return kind ? '<i class="mt-flow-arrow is-' + kind + '" aria-hidden="true">' + { up: '↗', down: '↘', flat: '→' }[kind] + '</i> ' : '';
  }
  // 시장 한눈에 하단 별도 블록: 원자재·가상자산(표시 전용, 점수에 넣지 않음). 시장지표 탭과 같은 /futures 응답의 현재값만 쓴다.
  // 값이 없거나 stale이거나 수신 시각이 36시간 넘게 묵었으면 '미수신'(브렌트도 다른 원유로 대체하지 않는다).
  var COMMODITY_GROUPS_ = [
    { kind: 'oil', name: '원유', items: [
      { symbol: 'WTI', label: 'WTI', usd: 2 }, { symbol: 'BRENT', label: '브렌트유', usd: 2 }] },
    { kind: 'gold', name: '금', items: [{ symbol: 'GOLD', label: '금 선물', usd: 1 }] },
    { kind: 'btc', name: '비트코인', items: [{ symbol: 'BTC', label: 'BTC', krw: true }] }
  ];
  // 공용 코멘트 생성(2026-10-23): 조간신문 칼럼처럼 독자 속마음 같은 한 줄 반응. 수치 설명은 숫자·상세 페이지에 맡긴다.
  // 선: 특정 자산·종목의 매수·매도를 직접 권유·지시하는 표현(사라/팔아/팔자/사자/매수해/매도해/…해야 돼)은 풀에 넣지 않는다.
  //     "이거 사야 하나?" 같은 독자 혼잣말(의문·감탄)은 허용. 변형은 날짜+종류 해시로 하루 동안 고정한다.
  // 강도: 등락률 ±0.3% 이내 flat, 2% 이상 big, 그 사이 mild. 값이 없으면 '미수신'만.
  var COMMENT_POOLS_ = {
    oil: {
      upMild: ['기름값 또 올랐네… 주유소 가기 무섭다', '기름값 슬금슬금 오르네?', '헐, 기름값이 올랐나보네…'],
      upBig: ['기름값 미쳤네… 주유 게이지 보기 무섭다', '헐, 기름값 폭등이네? 지갑 괜찮아?', '기름값 개 비싸졌네… 차 두고 나갈까?'],
      downMild: ['기름값 좀 내렸네? 숨통 트인다', '기름값 내려갔나보네… 살 것 같다', '오, 기름값이 살짝 빠졌네?'],
      downBig: ['기름값 확 빠졌네? 오늘은 가득 넣어도 되나?', '헐, 기름값 폭락이네… 주유소 줄 서겠다', '기름값 개 싸졌네… 이거 실화냐?'],
      flat: ['기름값 조용하네… 오늘은 평화다', '기름값 그대로네? 별일 없다', '유가는 쉬는 중…']
    },
    gold: {
      upMild: ['금값 또 올랐네… 반지 값부터 확인해야 하나?', '금값 슬금슬금 오르네?', '금값이 올랐나보네…'],
      upBig: ['금값 개 비싸네… 금반지 있는 사람 웃고 있겠다', '헐, 금값 급등이네?', '금값 미쳤네… 금니 아껴야겠다'],
      downMild: ['금값 싸졌나보네? 이거 사야 하나?', '금값 살짝 내렸네… 눈여겨봐야 하나?', '금값 빠졌네? 바닥인가?'],
      downBig: ['금값 확 빠졌네? 바닥인지 눈 크게 뜨고 보자', '헐, 금값 급락이네… 심장 괜찮아?', '금값 폭락이네? 이거 실화냐…'],
      flat: ['금값 조용하네… 오늘은 구경만 하자', '금값 그대로네? 반짝임도 쉬는 날', '금은 오늘 숨 고르는 중…']
    },
    prog: {
      buyBig: ['프로그램이 쓸어 담네… 기계가 신났다', '헐, 프로그램 매수 폭발이네?', '비차익 매수 개 많네… 로봇들이 작정했나?'],
      buyMild: ['프로그램이 슬금슬금 사네…', '기계들이 조금 담았네?', '프로그램 매수 우위네… 흐름 타나?'],
      sellBig: ['프로그램이 던지네… 기계 눈치 보인다', '헐, 프로그램 매도 폭탄이네?', '비차익 매도 개 많네… 로봇들이 작정했나?'],
      sellMild: ['프로그램이 슬금슬금 파네…', '기계들이 조금 덜어냈네?', '프로그램 매도 우위네… 눈치 보이네'],
      flat: ['프로그램은 조용하네… 기계도 쉬나?', '프로그램 매매 잠잠하네?', '기계들 오늘은 한가한가보네…']
    },
    putcall: {
      putHigh: ['풋이 더 많이 오가네… 다들 하락 대비하나?', '풋 거래가 우세네? 불안한 건가…', '헐, 풋이 콜을 앞섰네… 보험 드는 사람 많다'],
      callHigh: ['콜이 더 많이 오가네… 오를 거라 보는 건가?', '콜 거래 우세네? 분위기 괜찮나…', '콜이 풋을 앞섰네… 낙관이 꽉 찼나?']
    },
    rate: {
      highSurge: ['장기금리 급등… 증시 부담이 커지네', '금리 확 뛰었네… 높은 자리에서 더 올랐다', '장기금리 급등, 증시엔 부담이다'],
      highUp: ['장기금리 고공행진… 증시 부담 지속', '높은 금리가 더 오르네… 부담 여전하다', '장기금리 또 올랐네… 부담 이어진다'],
      highFlat: ['금리 변동 제한적이나 높은 수준 유지', '장기금리 높은 자리 그대로… 부담 여전', '큰 움직임은 없지만 금리 수준이 높다'],
      highDown: ['금리 내렸지만 수준은 여전히 높다', '장기금리 숨 고르기… 그래도 높은 자리', '부담 다소 덜었지만 아직 높은 수준'],
      highPlunge: ['장기금리 급락… 안전자산 선호 가능성', '금리 확 빠졌네… 위험회피인지 확인 필요', '급락했지만 수준은 높아, 이유를 봐야 한다'],
      midSurge: ['금리 급등… 부담이 빠르게 커지네', '금리 확 올랐네… 증시 눈치 보인다', '장기금리 급등세, 부담 커지는 중'],
      midUp: ['금리 소폭 상승… 부담 조금 커진다', '금리가 슬금슬금 오르네', '장기금리 오름세… 지켜볼 만하다'],
      midFlat: ['금리는 보통 수준에서 잠잠하다', '금리 변동 적고 수준도 무난하다', '장기금리 별일 없다… 영향 제한적'],
      midDown: ['금리 내려 부담이 다소 완화됐다', '장기금리 슬그머니 하락… 부담 덜었다', '금리 소폭 하락, 부담 완화 쪽'],
      midPlunge: ['금리 급락… 위험회피 가능성 살펴야', '장기금리 확 빠졌네… 안전자산 선호일까', '급락, 증시 호재로만 보긴 어렵다'],
      lowSurge: ['낮은 수준에서 금리 급등… 흐름 주시', '금리 확 뛰었네… 아직 낮은 자리지만 급하다', '장기금리 급등, 수준보다 속도가 문제'],
      lowUp: ['금리 오르지만 아직 낮은 수준', '낮은 금리가 조금 올랐네', '장기금리 상승, 수준은 부담 낮은 편'],
      lowFlat: ['금리가 낮은 수준에서 잠잠하다', '장기금리 낮고 조용하다… 부담 적다', '금리 영향 적은 날이다'],
      lowDown: ['낮은 금리가 더 내렸네… 이유 확인 필요', '금리 하락 이어진다… 경기 신호도 볼 필요', '낮은 수준에서 추가 하락'],
      lowPlunge: ['낮은 수준에서 급락… 위험회피 가능성', '금리 급락… 경기 불안 신호일 수 있다', '장기금리 급락, 안전자산 선호 쪽']
    },
    btc: {
      upMild: ['비트코인 또 오르네… 멀미 난다', '비트코인 슬금슬금 오르네?', '코인판 분위기 좋은가보네…'],
      upBig: ['비트코인 신났네… 안전벨트 매야겠다', '헐, 비트코인 폭등이네? 멀미 난다', '비트코인 개 올랐네… 이거 꿈 아니지?'],
      downMild: ['비트코인 내려가네… 심장 붙잡자', '비트코인 살짝 빠졌네?', '코인판이 시무룩한가보네…'],
      downBig: ['비트코인 폭락이네… 심장 단단히 붙잡자', '헐, 비트코인 뚝 떨어졌네?', '비트코인 개 빠졌네… 오늘 코인판 난리겠다'],
      flat: ['비트코인 조용하네… 오늘은 숨 고르기?', '비트코인 그대로네? 심장이 쉬는 날', '코인판 잠잠하네…']
    }
  };
  function commentHash_(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return h;
  }
  // 티어를 이미 아는 종류(프로그램매매·풋콜·금리)용. tier가 없으면 '미수신'.
  function marketCommentTier_(kind, tier, dateKey) {
    var pool = COMMENT_POOLS_[kind], list = pool && tier && pool[tier];
    if (!list) return '미수신';
    var key = (dateKey || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) + kind;
    return list[commentHash_(key) % list.length];
  }
  function marketComment_(kind, rate, dateKey) {
    var pool = COMMENT_POOLS_[kind];
    if (!pool || rate == null || !isFinite(rate)) return '미수신';
    var abs = Math.abs(rate), tier = abs < 0.3 ? 'flat' : (rate > 0 ? 'up' : 'down') + (abs >= 2 ? 'Big' : 'Mild');
    var list = pool[tier];
    var key = (dateKey || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) + kind;
    return list[commentHash_(key) % list.length];
  }
  // 환율 저울과 같은 톤의 선 일러스트(currentColor, 외부 의존 없음). 아이콘 경로는 Lucide(ISC) fuel·bitcoin 계열.
  function medianOf_(arr) { var a = arr.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : NaN; }
  // 일봉 행 → 그래프용 점 목록(최근 n개). 날짜는 YYYY-MM-DD.
  function seriesPoints_(row, n) {
    return ((row && row.chart) || []).map(function (c) { return { date: indicatorDate_(c.date), score: Number(c.close) }; })
      .filter(function (r) { return r.date && isFinite(r.score) && r.score > 0; }).slice(-(n || 40));
  }
  // 한눈에 칸과 같은 카드(버튼) + 누르면 바로 아래에 추이 그래프가 펼쳐진다. openId가 이 카드면 펼친 상태로 그린다.
  // card = { id, label, tone, state(word), amount(html-safe text), say, meta, panel: {points, base, format, zeroBase} | {html} }
  var ART_PATHS_ = {
    oil: '<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
    gold: '<path d="M7.5 10h9l-1.2-4H8.7z"/><path d="M2.5 18h9l-1.2-4H3.7z"/><path d="M12.5 18h9l-1.2-4h-6.6z"/>',
    btc: '<circle cx="12" cy="12" r="10"/><g transform="translate(4.8 4.8) scale(.6)"><path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727"/></g>',
    // 수급·심리·금리: Lucide(ISC) bar-chart-2·activity·percent 계열
    prog: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
    putcall: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    rate: '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'
  };
  // 24x24 Lucide 계열 선 아이콘(선 1.75). 방향색은 바탕 원에만 쓰고 그림은 겹침 없이 단순하게 둔다.
  function commodityIcon_(kind, tone) {
    return '<svg class="mt-xicon is-' + tone + '" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle class="mt-art-tint" cx="22" cy="22" r="21"/><g transform="translate(10 10)" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + ART_PATHS_[kind] + '</g></svg>';
  }
  // 누르면 오른쪽 '최근 시장 흐름' 카드에 이 항목의 추이가 나온다(한눈에 칸과 같은 동작). XMODELS_에 그 카드용 모델을 담아 둔다.
  var XMODELS_ = {};
  function xModel_(c) {
    var pts = c.panel && c.panel.points ? c.panel.points : [], last = pts.length ? pts[pts.length - 1].score : null, prev = pts.length > 1 ? pts[pts.length - 2].score : null;
    var fmt = c.panel && c.panel.format ? c.panel.format : function (v) { return String(v); };
    var delta = last != null && prev != null ? last - prev : null;
    return { id: 'x-' + c.id, label: c.label, detail: c.detail || '', points: pts, format: fmt, axisFormat: fmt, zeroBase: !!(c.panel && c.panel.zeroBase), signed: false,
      base: c.panel ? c.panel.base : null, tone: c.tone === 'positive' ? 'positive' : c.tone === 'negative' ? 'negative' : 'neutral',
      value: last, valueText: last == null ? '확인 중' : fmt(last), date: pts.length ? pts[pts.length - 1].date : null, delta: delta,
      changeText: c.panel && c.panel.html ? '날짜별 이력 없음' : c.state, nohistory: !!(c.panel && c.panel.html), pcHtml: c.panel && c.panel.html ? c.panel.html : '' };
  }
  function xCardHtml_(c, selectedId) {
    XMODELS_['x-' + c.id] = xModel_(c);
    var sel = selectedId === 'x-' + c.id;
    // 1줄 이름+상태 / 2 핵심 수치(rows) / 3 코멘트 / 4 기준 시각. 값은 c.rows 그대로 그린다(없으면 수치 줄 자체를 그리지 않음).
    var rows = (c.rows || []).map(function (r, i) {
      var cls = 'mt-xrow' + (i === 0 ? ' is-main' : '') + (r.miss ? ' is-miss' : '');
      return '<span class="' + cls + '"><span class="mt-xk">' + escapeHtml(r.k) + '</span><b class="mt-xv' + (r.t && !r.d ? ' is-' + r.t : '') + '">' + escapeHtml(r.v) + '</b>'
        + (r.d ? '<em class="mt-xd is-' + (r.t || 'neutral') + '">' + escapeHtml(r.d) + '</em>' : '')
        + (r.sub ? '<small class="mt-xsub">' + escapeHtml(r.sub) + '</small>' : '') + '</span>';
    }).join('');
    return '<button type="button" class="mt-indicator-chip mt-glance-row mt-xcard' + (sel ? ' is-selected' : '') + ' is-' + c.tone + (c.icon ? ' has-icon' : '') + '" data-market-metric="x-' + c.id + '" aria-pressed="' + sel + '">'
      + '<span class="mt-xhead">' + (c.icon ? commodityIcon_(c.icon, c.tone) : '') + '<span class="mt-xname">' + escapeHtml(c.label) + '</span>'
      + '<b class="mt-xstate is-' + c.tone + '">' + escapeHtml(c.state) + '</b></span>'
      + (rows ? '<span class="mt-glance-line mt-xvals">' + rows + '</span>' : '<span class="mt-glance-line mt-xvals is-empty"></span>')
      + '<span class="mt-xsay">' + escapeHtml(c.say) + '</span>'
      + '<small class="mt-xmeta">' + escapeHtml(c.meta) + '</small></button>';
  }
  function xBlockHtml_(title, label, cards, selectedId) {
    return '<section class="mt-commodity-block" aria-label="' + label + '"><h4 class="mt-commodity-title">' + title + '</h4><div class="mt-glance-list mt-xlist">'
      + cards.map(function (c) { return xCardHtml_(c, selectedId); }).join('') + '</div></section>';
  }
  function stateWord_(tone, arrowWord) { return tone === 'positive' ? '↗ ' + arrowWord[0] : tone === 'negative' ? '↘ ' + arrowWord[1] : '→ ' + arrowWord[2]; }
  // ---- 수급·심리·금리 블록(표시 전용, 점수 미반영) ----
  // 프로그램매매: /domestic-market-indicators의 programTrading(KIS 일별, 코스피 비차익·차익, 단위 백만원). 강도는 응답 history 260거래일의
  //   비차익 절댓값 분포(중앙값 이상 mild, 90백분위 이상 big)로 정한다.
  // 옵션: /option-flow(코스피200 옵션 최근월, KIS가 준 콜·풋 각 최대 100행 합계 - 전체시장 합계 아님). 이력이 없어 임계값을 만들지 않고
  //   풋 거래량이 콜보다 많은지(비율 1 기준)만 쓴다.
  // 금리: /futures의 US10Y·US2Y·KTB3Y 일봉. 장단기차 = 10년 - 2년, 강도는 일변화 절댓값의 중앙값·90백분위.
  function percentileOf_(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null; }
  // 프로그램매매 20거래일 누적(2026-10-23). 값은 /domestic-market-indicators programTrading.history(KIS 일별, 코스피, 백만원, 차익·비차익 순매수) 그대로.
  // 일별 순매수 = 차익 + 비차익(한 번만 합산). 외국인·기관 순매매와는 다른 수치다. 매수·매도 거래대금은 이 응답에 없어 수집·표시하지 않는다.
  // 장중(15:40 전)의 오늘 값은 잠정이라 누적에서 빼고 따로 보인다. 확정 일수가 20 미만이면 '집계 중 (N/20일)'(없는 날을 0으로 채우지 않는다).
  function moneyKr_(m) {
    var eok = Math.round(Math.abs(m) / 100), sign = m > 0 && eok ? '+' : m < 0 && eok ? '-' : '';
    if (eok >= 10000) { var jo = Math.floor(eok / 10000), rest = eok % 10000; return sign + jo + '조' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '억' : ''); }
    return sign + eok.toLocaleString('ko-KR') + '억';
  }
  function programCumulative_(pt, live) {
    var map = {};
    (pt.history || []).forEach(function (r) {
      var a = Number(r && r.arbitrage), n = Number(r && r.nonArbitrage);
      if (r && r.date && isFinite(a) && isFinite(n)) map[r.date] = { date: r.date, arb: a, non: n };
    });
    var tArb = Number(pt.arbitrage), tNon = Number(pt.nonArbitrage);
    if (pt.date && isFinite(tArb) && isFinite(tNon)) map[pt.date] = { date: pt.date, arb: tArb, non: tNon };
    var all = Object.keys(map).sort().map(function (d) { return map[d]; });
    var rows = live ? all.filter(function (r) { return r.date !== pt.date; }) : all;
    var use = rows.slice(-20);
    // 달력 간격이 10일을 넘게 벌어진 곳이 있으면 그 앞은 연속 이력이 아니므로 쓰지 않는다(누락일을 0으로 채우지 않는다)
    for (var i = use.length - 1; i > 0; i--) {
      if ((Date.parse(use[i].date) - Date.parse(use[i - 1].date)) / 86400000 > 10) { use = use.slice(i); break; }
    }
    var totals = use.map(function (r) { return r.arb + r.non; });
    var sum = function (arr) { return arr.reduce(function (s, v) { return s + v; }, 0); };
    var absNon = use.map(function (r) { return Math.abs(r.non); });
    return {
      all: all, n: use.length, complete: use.length >= 20,
      cum20: sum(totals), sellDays: totals.filter(function (v) { return v < 0; }).length,
      buyDays: totals.filter(function (v) { return v > 0; }).length, flatDays: totals.filter(function (v) { return v === 0; }).length,
      cum5: use.length >= 5 ? sum(totals.slice(-5)) : null, avgAbsNon: absNon.length ? sum(absNon) / absNon.length : 0
    };
  }
  function programComment_(c, todayNon) {
    if (c.cum5 != null && c.cum5 > 0 && c.cum20 < 0 && c.sellDays > c.buyDays) return '최근 5일 순매수 전환… 매도 압력 완화';
    if (c.cum5 != null && c.cum5 < 0 && c.cum20 > 0 && c.buyDays > c.sellDays) return '최근 5일 순매도 전환… 매수 우위 약화';
    if (c.avgAbsNon > 0 && Math.abs(todayNon) >= c.avgAbsNon * 2) return todayNon < 0 ? '비차익 순매도 확대… 수급 부담' : '비차익 순매수 확대… 수급 우호';
    if (c.cum20 < 0 && c.sellDays > c.buyDays) return '20일 중 ' + c.sellDays + '일 순매도… 매도 우세 지속';
    if (c.cum20 > 0 && c.buyDays > c.sellDays) return '20일 중 ' + c.buyDays + '일 순매수… 매수 우세 지속';
    return '20일 수급이 엇갈려 방향이 뚜렷하지 않음';
  }
  function programTradingCard_(pt, now_) {
    if (!pt || pt.available !== true || !isFinite(Number(pt.nonArbitrage)) || !pt.date) return null;
    var hist = (pt.history || []).map(function (r) { return Math.abs(Number(r.nonArbitrage)); }).filter(function (v) { return isFinite(v); }).sort(function (a, b) { return a - b; });
    var v = Number(pt.nonArbitrage), abs = Math.abs(v), p50 = percentileOf_(hist, 0.5), p90 = percentileOf_(hist, 0.9);
    var tier = hist.length < 60 ? null : abs >= p90 ? (v > 0 ? 'buyBig' : 'sellBig') : abs >= p50 ? (v > 0 ? 'buyMild' : 'sellMild') : 'flat';
    var eok = function (m) { return (m > 0 ? '+' : m < 0 ? '-' : '') + Math.abs(Math.round(m / 100)).toLocaleString('ko-KR') + '억'; };
    var kst = new Date((now_ == null ? Date.now() : now_) + 9 * 3600000), today = kst.toISOString().slice(0, 10);
    var live = pt.date === today && kst.getUTCHours() * 60 + kst.getUTCMinutes() < 15 * 60 + 40;
    var cum = programCumulative_(pt, live);
    var points = cum.all.map(function (r) { return { date: indicatorDate_(r.date), score: r.arb + r.non }; }).filter(function (r) { return r.date; }).slice(-40);
    return { kind: 'prog', points: points, nonArb: v, arb: Number(pt.arbitrage), name: '프로그램매매(코스피)', tone: v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral', tier: tier, live: live, cum: cum,
      lines: [['비차익', eok(v), v], ['차익', eok(Number(pt.arbitrage)), Number(pt.arbitrage)]], time: String(pt.date).slice(5).replace('-', '.') + (live ? ' 장중 집계' : ' 기준') };
  }
  function optionCard_(of) {
    var c = of && of.CALL, q = of && of.PUT;
    if (!c || !q || !(Number(c.volume) > 0) || !isFinite(Number(q.volume)) || !c.updated_at) return null;
    var ratio = Number(q.volume) / Number(c.volume), at = Date.parse(c.updated_at);
    if (!isFinite(at)) return null;
    var kst = new Date(at + 9 * 3600000), pad = function (n) { return String(n).padStart(2, '0'); };
    return { kind: 'putcall', ratio: ratio, put: Number(q.volume), call: Number(c.volume), share: Number(q.volume) / (Number(q.volume) + Number(c.volume)), name: '옵션 풋/콜(코스피200)', tone: ratio >= 1 ? 'negative' : 'positive', tier: ratio >= 1 ? 'putHigh' : 'callHigh',
      lines: [['풋/콜 거래량 비율', ratio.toFixed(2), 0], ['풋 ' + Number(q.volume).toLocaleString('ko-KR') + ' · 콜 ' + Number(c.volume).toLocaleString('ko-KR'), '', 0]],
      time: pad(kst.getUTCMonth() + 1) + '.' + pad(kst.getUTCDate()) + ' ' + pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes()) + ' 기준(최근월·상위 100행 합)' };
  }
  // 금리 해설(2026-10-23): 수준(높음/보통/낮음)·단기 움직임(급등/상승/안정/하락/급락)·시장 영향을 따로 판단한다.
  // 값은 /futures의 미국채 10·30·2년(FRED 일봉)·국고 3년(네이버) 그대로. 수준은 최근 약 120일 안에서의 위치(백분위)로 정하고,
  // 절대 수준(10년 4.5%·30년 5%)은 보조로만 쓴다(위치가 하위 1/3이면 적용하지 않음). 움직임은 일 변동(bp)을 같은 기간 일 변동의 90백분위로 나눈 값.
  // 금리가 내렸다고 증시에 호재라고 단정하지 않는다(급락은 위험회피 가능성으로 읽는다).
  var RATE_ABS_HIGH_ = { US10Y: 4.5, US30Y: 5.0 };
  function rateStats_(row, now_) {
    var chart = ((row && row.chart) || []).filter(function (r) { return r && isFinite(Number(r.close)) && Number(r.close) > 0 && /^\d{8}$/.test(String(r.date)); });
    if (!row || row.stale === true || chart.length < 6) return null;
    var closes = chart.slice(-120).map(function (r) { return Number(r.close); });
    var last = chart[chart.length - 1], prev = chart[chart.length - 2], y = Number(last.close);
    var ds = String(last.date), at = Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8));
    if ((now_ == null ? Date.now() : now_) - at > 7 * 86400000 + 9 * 3600000) return null;
    var deltas = [];
    for (var i = 1; i < closes.length; i++) deltas.push(Math.abs(Math.round((closes[i] - closes[i - 1]) * 100)));
    deltas.sort(function (a, b) { return a - b; });
    var below = closes.filter(function (c) { return c <= y + 1e-9; }).length;
    return { y: y, date: ds, bp: Math.round((y - Number(prev.close)) * 100), bp5: Math.round((y - Number(chart[chart.length - 6].close)) * 100),
      pct: below / closes.length, n: closes.length, p90: Math.max(3, percentileOf_(deltas, 0.9) || 0), closes: closes };
  }
  function rateLevelMove_(s10, s30) {
    var list = [s10, s30].filter(Boolean);
    if (!list.length || list.some(function (s) { return s.n < 20; })) return null;
    var pct = list.reduce(function (sum, s) { return sum + s.pct; }, 0) / list.length;
    var absHigh = !!((s10 && s10.y >= RATE_ABS_HIGH_.US10Y) || (s30 && s30.y >= RATE_ABS_HIGH_.US30Y));
    var level = pct >= 0.67 || (absHigh && pct >= 0.34) ? 'high' : pct <= 0.33 && !absHigh ? 'low' : 'mid';
    var m = list.reduce(function (sum, s) { return sum + s.bp / s.p90; }, 0) / list.length;
    var move = m >= 1 ? 'Surge' : m >= 0.4 ? 'Up' : m <= -1 ? 'Plunge' : m <= -0.4 ? 'Down' : 'Flat';
    return { level: level, move: move, tier: level + move, m: m };
  }
  function rateComment_(tier, y30, dateKey) {
    var pool = COMMENT_POOLS_.rate, list = pool && tier && pool[tier] ? pool[tier].slice() : null;
    if (!list) return '금리 수준을 판단할 기록이 부족합니다';
    // 30년물이 5%대 이상 높은 수준이면 실제 수준을 문장에 넣은 변형도 후보에 넣는다
    if (y30 != null && y30 >= 5 && /^high(Flat|Up|Surge)$/.test(tier)) list.push('30년물 ' + Math.floor(y30) + '%대 ' + (tier === 'highFlat' ? '유지' : '지속') + ', 장기금리 부담 여전');
    var key = (dateKey || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) + 'rate';
    return list[commentHash_(key) % list.length];
  }
  function rateCard_(by, now_) {
    var s10 = rateStats_(by.US10Y, now_), s30 = rateStats_(by.US30Y, now_);
    if (!s10 && !s30) return null;
    var lm = rateLevelMove_(s10, s30), s2 = rateStats_(by.US2Y, now_), k = by.KTB3Y;
    var main = s10 || s30, bpText = function (v) { return (v > 0 ? '+' : '') + v + 'bp'; };
    var dir = function (v) { return v > 0 ? 'positive' : v < 0 ? 'negative' : ''; };
    var rows = [];
    if (s10) rows.push({ k: '미국 10년', v: s10.y.toFixed(2) + '%', d: bpText(s10.bp), t: dir(s10.bp) });
    else rows.push({ k: '미국 10년', v: '미수신', miss: true });
    if (s30) rows.push({ k: '미국 30년', v: s30.y.toFixed(2) + '%', d: bpText(s30.bp), t: dir(s30.bp) });
    else rows.push({ k: '미국 30년', v: '미수신', miss: true });
    var sub = [];
    if (s10 && s30) sub.push('30-10년 차 ' + bpText(Math.round((s30.y - s10.y) * 100)));
    if (s2) sub.push('2년 ' + s2.y.toFixed(2) + '%');
    if (k && k.stale !== true && Number(k.price) > 0) sub.push('한국 3년 ' + Number(k.price).toFixed(2) + '%');
    if (sub.length) rows[rows.length - 1].sub = sub.join(' · ');
    var five = [s10 && '10년 ' + bpText(s10.bp5), s30 && '30년 ' + bpText(s30.bp5)].filter(Boolean).join(' · ');
    var moveWord = lm ? { Surge: '급등', Up: '상승', Flat: '안정', Down: '하락', Plunge: '급락' }[lm.move] : null;
    var levelWord = lm ? { high: '높음', mid: '보통', low: '낮음' }[lm.level] : null;
    var tone = lm ? (lm.move === 'Surge' || lm.move === 'Up' ? 'positive' : lm.move === 'Down' || lm.move === 'Plunge' ? 'negative' : 'neutral') : 'neutral';
    var d = String(main.date);
    return { kind: 'rate', tone: tone, tier: lm ? lm.tier : null, rows: rows, moveWord: moveWord, levelWord: levelWord, five: five,
      say: rateComment_(lm ? lm.tier : null, s30 ? s30.y : null),
      series: ((by.US10Y && by.US10Y.chart) || (by.US30Y && by.US30Y.chart) || []).slice(-40).map(function (r) { return { date: indicatorDate_(r.date), score: Number(r.close) }; }).filter(function (r) { return r.date && isFinite(r.score); }),
      time: d.slice(4, 6) + '.' + d.slice(6, 8) + ' 기준(FRED)' };
  }
  function extrasBlock_(domestic, macro, optionFlow, now_, selectedId) {
    var by = {}; (Array.isArray(macro) ? macro : []).forEach(function (r) { if (r && r.symbol) by[r.symbol] = r; });
    if (!domestic && !optionFlow && !Object.keys(by).length) return '';
    var eok = function (m) { return (m > 0 ? '+' : m < 0 ? '-' : '') + Math.abs(Math.round(m / 100)).toLocaleString('ko-KR') + '억'; };
    var cards = [];
    var pg = programTradingCard_(domestic && domestic.programTrading, now_);
    var signTone = function (v) { return v > 0 ? 'positive' : v < 0 ? 'negative' : ''; };
    var progCard = function (pg) {
      var c = pg.cum, todayTotal = pg.nonArb + pg.arb, todayRow = { k: pg.live ? '오늘 잠정' : '오늘', v: moneyKr_(todayTotal), t: signTone(todayTotal), sub: '차익 ' + moneyKr_(pg.arb) + ' · 비차익 ' + moneyKr_(pg.nonArb) };
      var meta = '코스피 · ' + pg.time + ' · KIS 일별' + (pg.live ? ' (오늘 값은 잠정, 누적에서 제외)' : '');
      var panel = { points: pg.points, base: 0, zeroBase: true, format: function (v) { return moneyKr_(v); } };
      var detail = '코스피 프로그램매매 일별 순매수(차익+비차익, 외국인·기관 순매매와 다른 수치) · 매수·매도 거래대금은 수집하지 않음';
      if (!c.complete) {
        return { id: 'prog', icon: 'prog', detail: detail, label: '프로그램매매', tone: 'neutral', state: '집계 중 (' + c.n + '/20일)', rows: [todayRow],
          say: '20거래일 확보 전이라 누적은 계산하지 않습니다', meta: meta, panel: panel };
      }
      var tone = c.cum20 < 0 && c.sellDays > c.buyDays ? 'negative' : c.cum20 > 0 && c.buyDays > c.sellDays ? 'positive' : 'neutral';
      var word = tone === 'negative' ? '20일 매도 우세' : tone === 'positive' ? '20일 매수 우세' : '20일 엇갈림';
      var counts = '순매도 ' + c.sellDays + '일 / 순매수 ' + c.buyDays + '일' + (c.flatDays ? ' / 중립 ' + c.flatDays + '일' : '') + (c.cum5 != null ? ' · 5일 ' + moneyKr_(c.cum5) : '');
      return { id: 'prog', icon: 'prog', detail: detail, label: '프로그램매매', tone: tone, state: stateWord_(tone, [word, word, word]),
        rows: [{ k: '20일 누적', v: moneyKr_(c.cum20), t: signTone(c.cum20), sub: counts }, todayRow], say: programComment_(c, pg.nonArb), meta: meta, panel: panel };
    };
    cards.push(pg ? progCard(pg)
      : { id: 'prog', icon: 'prog', label: '프로그램매매', tone: 'neutral', state: '미수신', rows: [], say: '미수신', meta: '값을 받지 못했습니다', panel: null });
    var oc = optionCard_(optionFlow);
    cards.push(oc ? { id: 'putcall', icon: 'putcall', detail: '풋·콜 거래량 비중', label: '옵션 풋/콜', tone: oc.tone, state: stateWord_(oc.tone, ['콜 우세', '풋 우세', '비슷']),
      rows: [{ k: '풋/콜', v: oc.ratio.toFixed(2), sub: '풋 ' + oc.put.toLocaleString('ko-KR') + ' · 콜 ' + oc.call.toLocaleString('ko-KR') }],
      say: marketCommentTier_('putcall', oc.tier), meta: '코스피200 · ' + oc.time,
      panel: { html: '<div class="mt-pc-bar" role="img" aria-label="풋 ' + Math.round(oc.share * 100) + '% 콜 ' + (100 - Math.round(oc.share * 100)) + '%"><i class="put" style="width:' + (oc.share * 100).toFixed(1) + '%"></i><i class="call" style="width:' + ((1 - oc.share) * 100).toFixed(1) + '%"></i></div><p class="mt-indicator-chart-note">풋·콜 거래량 비중입니다. 이력이 없어 날짜별 그래프는 없습니다.</p>' } }
      : { id: 'putcall', icon: 'putcall', label: '옵션 풋/콜', tone: 'neutral', state: '미수신', rows: [], say: '미수신', meta: '값을 받지 못했습니다', panel: null });
    var rc = rateCard_(by, now_);
    cards.push(rc ? { id: 'rate', icon: 'rate', detail: '미국 국채 10년 금리(%) · FRED 일봉 · 5거래일 ' + rc.five, label: '금리', tone: rc.tone, state: stateWord_(rc.tone, [rc.moveWord || '확인 중', rc.moveWord || '확인 중', rc.moveWord || '확인 중']),
      rows: rc.rows, say: rc.say, meta: (rc.levelWord ? '수준 ' + rc.levelWord + ' · ' : '') + rc.time + (rc.five ? ' · 5일 ' + rc.five : ''),
      panel: rc.series.length ? { points: rc.series, base: null, zeroBase: false, format: function (v) { return v.toFixed(2) + '%'; } } : null }
      : { id: 'rate', icon: 'rate', label: '금리', tone: 'neutral', state: '미수신', rows: [], say: '미수신', meta: '값을 받지 못했습니다', panel: null });
    return xBlockHtml_('수급·심리·금리', '수급·심리·금리(표시 전용)', cards, selectedId);
  }
  function commodityStrip_(macro, now_, selectedId) {
    if (!Array.isArray(macro) || !macro.length) return '';
    var now = now_ == null ? Date.now() : now_;
    var by = {}; macro.forEach(function (r) { if (r && r.symbol) by[r.symbol] = r; });
    function pad(n) { return String(n).padStart(2, '0'); }
    function fmt(it, price) {
      if (it.krw) { var eok = Math.floor(price / 1e8), man = Math.round((price - eok * 1e8) / 1e4); if (man >= 10000) { eok++; man = 0; } return (eok ? eok + '억 ' : '') + man.toLocaleString('ko-KR') + '만원'; }
      return '$' + price.toLocaleString('en-US', { minimumFractionDigits: it.usd, maximumFractionDigits: it.usd });
    }
    function read(it) {
      var r = by[it.symbol], price = r ? Number(r.price) : NaN, rate = r ? Number(r.change_rate) : NaN, at = r && r.updated_at ? Date.parse(r.updated_at) : NaN;
      if (!(r && r.stale !== true && isFinite(price) && price > 0 && isFinite(rate) && isFinite(at) && now - at <= 36 * 3600000)) return null;
      var kst = new Date(at + 9 * 3600000);
      return { text: fmt(it, price), rate: rate, time: pad(kst.getUTCMonth() + 1) + '.' + pad(kst.getUTCDate()) + ' ' + pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes()) + ' 기준' };
    }
    var cards = COMMODITY_GROUPS_.map(function (g) {
      var reads = g.items.map(read), have = reads.filter(Boolean);
      var mean = have.length ? have.reduce(function (sum, v) { return sum + v.rate; }, 0) / have.length : null;
      var tone = mean == null || Math.abs(mean) < 0.3 ? 'neutral' : mean > 0 ? 'positive' : 'negative';
      var rateText = function (v) { return (v.rate > 0 ? '+' : '') + v.rate.toFixed(2) + '%'; };
      var rowTone = function (v) { return Math.abs(v.rate) < 0.3 ? '' : v.rate > 0 ? 'positive' : 'negative'; };
      var rows = mean == null ? [] : g.items.map(function (it, k) { return reads[k] ? { k: it.label, v: reads[k].text, d: rateText(reads[k]), t: rowTone(reads[k]) } : { k: it.label, v: '미수신', miss: true }; });
      var gi = g.items.findIndex(function (it, k) { return reads[k]; }), pts = gi >= 0 ? seriesPoints_(by[g.items[gi].symbol], 40) : [];
      var item = gi >= 0 ? g.items[gi] : g.items[0];
      return { id: g.kind, icon: g.kind, detail: item.label + ' 일봉 종가', label: g.name, tone: tone, state: mean == null ? '미수신' : stateWord_(tone, ['상승', '하락', '보합']), rows: rows,
        say: marketComment_(g.kind, mean), meta: have.length ? have[0].time : '값을 받지 못했습니다',
        panel: pts.length ? { points: pts, base: medianOf_(pts.map(function (r) { return r.score; })), format: function (v) { return fmt(item, v); } } : null };
    });
    return xBlockHtml_('원자재·가상자산', '원자재·가상자산(표시 전용)', cards, selectedId);
  }
  function renderIndicatorRows_(models, selected) {
    var shares = investorShares_(models);
    // 원/달러는 '다음 거래일 전망' 카드에 있어 시장 한눈에에서는 그리지 않는다(모델은 시그널·체크포인트가 그대로 쓴다).
    return '<div class="mt-glance-list">' + models.map(function (m) {
      if (m.id === 'fx') return '';
      var investor = ['foreign', 'institution', 'individual'].indexOf(m.id) >= 0;
      var share = shares && shares.items.filter(function (r) { return r.id === m.id; })[0];
      var amount = share ? share.value : m.value, date = share ? shares.date : m.date;
      var tone = investor ? amount == null || amount === 0 ? 'neutral' : amount > 0 ? 'positive' : 'negative' : m.tone;
      var word = m.value == null ? (m.noData ? '미수신' : '확인 중') : investor ? (amount > 0 ? '순매수' : amount < 0 ? '순매도' : '보합') : m.statusText || (m.delta == null ? '확인 중' : m.delta > 0 ? '증가' : m.delta < 0 ? '감소' : '변화 없음');
      var label = m.id === 'credit' ? '빚투' : m.id === 'deposits' ? '예탁금' : m.id === 'fx' ? '환율' : m.label;
      var value = investor && amount != null ? indicatorMoney_(Math.abs(amount)) : m.valueText;
      var note = investor ? shares ? '' : m.detail.replace(' 일별 순매수', '') : m.id.indexOf('volume') >= 0 ? '20개 기록 평균 대비' : m.id === 'credit' ? '신용융자 잔액' : m.id === 'deposits' ? '고객예탁금' : m.id === 'us-rate' ? '국채 10년물' : m.id === 'kospi-futures' ? (m.delta == null ? '' : '전일 대비 ' + m.changeText) : '';
      var body = m.id === 'fx' ? renderFxBalance_(m) : '<span class="mt-glance-line"><span class="mt-glance-label">' + escapeHtml(label) + '<span class="mt-glance-colon"> : </span></span>'
        + '<b class="mt-glance-state is-' + tone + '">' + (investor ? (amount != null && amount !== 0 ? '<i class="mt-flow-arrow is-' + (amount > 0 ? 'up' : 'down') + '" aria-hidden="true">' + (amount > 0 ? '↗' : '↘') + '</i> ' : wordArrow_(word)) : wordArrow_(word)) + escapeHtml(word) + '</b><span class="mt-glance-amount">' + escapeHtml(value) + '</span>'
        + (share ? '<em class="mt-glance-share">' + share.percent + '%</em>' : '') + '</span>'
        + '<small class="mt-glance-meta">' + escapeHtml(note) + (note ? ' · ' : '') + (date ? escapeHtml(asOfText_(date)) : '기준일 확인 중') + (m.sameTime != null ? '<br>같은 시각 대비 거래대금 ' + m.sameTime + '% (섹터 풀 직전 5거래일)' : '') + (m.stale ? ' · 이전 수신값' : '') + '</small>';
      var bar = m.id === 'individual' ? '</div>' + renderInvestorShares_(shares) : '';
      return (m.id === 'foreign' ? '<div class="mt-investor-row">' : '') + '<button type="button" class="mt-indicator-chip mt-glance-row' + (m.id === 'fx' ? ' mt-fx-row' : '') + (m.id === selected ? ' is-selected' : '') + '" data-market-metric="' + m.id + '" aria-pressed="' + (m.id === selected) + '">' + body + '</button>' + bar;
    }).join('') + '</div>';
  }
  function investorShares_(models) {
    var actors = ['foreign', 'institution', 'individual'].map(function (id) { return models.filter(function (m) { return m.id === id; })[0]; });
    if (actors.some(function (m) { return !m; }) || actors.some(function (m) { return m.detail !== actors[0].detail; })) return null;
    var maps = actors.map(function (m) { var out = {}; m.points.forEach(function (p) { out[p.date] = p.score; }); return out; });
    var dates = Object.keys(maps[0]).filter(function (date) { return maps.every(function (map) { return indicatorNumber_(map[date]) != null; }); }).sort();
    if (!dates.length) return null;
    var date = dates[dates.length - 1], values = maps.map(function (map) { return map[date]; });
    var total = values.reduce(function (sum, v) { return sum + Math.abs(v); }, 0);
    if (!total) return null;
    var raw = values.map(function (v) { return Math.abs(v) / total * 1000; }), tenths = raw.map(Math.floor);
    var remainder = 1000 - tenths.reduce(function (sum, v) { return sum + v; }, 0);
    var order = [0, 1, 2].sort(function (a, b) { return (raw[b] - tenths[b]) - (raw[a] - tenths[a]); });
    for (var i = 0; i < remainder; i++) tenths[order[i % 3]]++;
    return { date: date, scope: actors[0].detail.replace(' 일별 순매수', ''), items: actors.map(function (m, i) { return { id: m.id, label: m.label, value: values[i], percent: (tenths[i] / 10).toFixed(1) }; }) };
  }
  function renderInvestorShares_(shares) {
    if (!shares) return '<p class="mt-share-note">수급 비중은 세 주체의 같은 날짜 자료가 모이면 표시합니다.</p>';
    var label = shares.items.map(function (r) { return r.label + ' ' + r.percent + '%'; }).join(' · ');
    return '<div class="mt-investor-share"><div class="mt-share-head"><b>수급 비중</b><span>합계 100%</span></div>'
      + '<div class="mt-share-bar" role="img" aria-label="' + escapeHtml(label) + '">' + shares.items.map(function (r) {
        return '<span class="is-' + (r.value > 0 ? 'positive' : r.value < 0 ? 'negative' : 'neutral') + (Number(r.percent) < 8 ? ' is-small' : '') + '" style="width:' + r.percent + '%" title="' + escapeHtml(r.label + ' ' + r.percent + '%') + '">' + r.percent + '%</span>';
      }).join('') + '</div><p class="mt-share-note">' + escapeHtml(shares.scope) + ' · 순매매 금액 절댓값 합계 기준 · ' + escapeHtml(shortDate_(shares.date)) + '</p></div>';
  }
  function fxBalanceState_(m) {
    return m.value == null || m.delta == null ? 'unavailable' : m.delta > 0 ? 'usd' : m.delta < 0 ? 'krw' : 'balanced';
  }
  function renderFxBalance_(m) {
    var state = fxBalanceState_(m), tilt = state === 'usd' ? 1 : state === 'krw' ? -1 : 0;
    var word = { usd: '달러 강세', krw: '원화 강세', balanced: '변화 없음', unavailable: '비교 자료 확인 중' }[state];
    function pan(x, y, heavy, text) {
      return '<g class="mt-fx-pan' + (heavy ? ' is-heavy' : '') + '"><path d="M' + (x - 26) + ',' + (y + 29) + ' L' + x + ',' + y + ' L' + (x + 26) + ',' + (y + 29) + ' Z"/><path class="mt-fx-bowl" d="M' + (x - 29) + ',' + (y + 29) + ' Q' + x + ',' + (y + 53) + ' ' + (x + 29) + ',' + (y + 29) + ' Z"/><text x="' + x + '" y="' + (y + 25) + '">' + text + '</text></g>';
    }
    return '<span class="mt-glance-line"><span class="mt-glance-label">환율<span class="mt-glance-colon"> : </span></span><b class="mt-glance-state' + (state === 'usd' ? ' is-positive' : state === 'krw' ? ' is-negative' : '') + '">' + (state === 'usd' ? wordArrow_('상승') : state === 'krw' ? wordArrow_('하락') : state === 'balanced' ? wordArrow_('변화 없음') : '') + word + '</b><span class="mt-glance-amount">' + (m.value == null ? '확인 중' : '1달러 = ' + escapeHtml(m.valueText)) + '</span></span>'
      + '<span class="mt-fx-balance" data-fx-stronger="' + state + '"><svg viewBox="0 0 320 120" role="img" aria-label="직전 기록 대비 ' + word + '"><path class="mt-fx-stand" d="M160,42 L160,105 M140,108 L180,108"/>'
      + '<path class="mt-fx-beam" d="M70,' + (47 - tilt * 12) + ' L250,' + (47 + tilt * 12) + '"/>'
      + pan(70, 47 - tilt * 12, state === 'krw', '원화') + pan(250, 47 + tilt * 12, state === 'usd', '달러') + '</svg></span>'
      + '<small class="mt-glance-meta">' + escapeHtml(m.changeText) + ' · 직전 기록 대비 상대 강도' + (m.date ? ' · ' + escapeHtml(asOfText_(m.date)) : '') + (m.stale ? ' · 이전 수신값' : '') + '</small>';
  }
  function buildIndicatorHistoryShell_() {
    return '<section class="mt-card mt-indicator-history" data-mt-indicator-panel><div class="mt-history-tail-head"><h3 class="mt-card-title">최근 시장 흐름</h3>'
      + '<div class="mt-flow-periods" data-indicator-periods></div></div><div data-indicator-chart><p class="mt-visual-empty">시장 지표를 불러오는 중입니다.</p></div></section>';
  }
  // 최근 시장 흐름 기본 화면(2026-10-23): 큰 면적 차트 대신 한 줄 요약 - 핵심 수치 + 최근 7개 기록 초소형 추세선 + 한 줄 해설.
  // 큰 차트와 5/10/20/40일 전환은 '상세 보기'를 펼칠 때만 쓴다(같은 buildFlowChart_ 한 벌, 차트 인스턴스를 따로 만들지 않는다).
  function trendSparkHtml_(points, tone, base) {
    var W = 200, H = 56, n = points.length;
    if (n < 2) return '';
    var vals = points.map(function (p) { return p.score; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (base != null) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.14; lo -= pad; hi += pad;
    function X(i) { return 4 + i * (W - 8) / (n - 1); }
    function Y(v) { return 4 + (hi - v) * (H - 8) / (hi - lo); }
    var line = points.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.score).toFixed(1); }).join(' ');
    var area = line + ' L' + X(n - 1).toFixed(1) + ',' + (H - 2) + ' L' + X(0).toFixed(1) + ',' + (H - 2) + ' Z';
    var baseLine = base != null ? '<line class="mt-ts-base" x1="0" x2="' + W + '" y1="' + Y(base).toFixed(1) + '" y2="' + Y(base).toFixed(1) + '"/>' : '';
    return '<span class="mt-ts-spark is-' + tone + '"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="최근 ' + n + '개 기록 추세">'
      + baseLine + '<path class="mt-ts-area" d="' + area + '"/><path class="mt-ts-line" d="' + line + '"/></svg>'
      + '<i class="mt-ts-dot" style="left:' + (X(n - 1) / W * 100).toFixed(1) + '%;top:' + (Y(points[n - 1].score) / H * 100).toFixed(1) + '%"></i></span>';
  }
  function renderIndicatorHistory_(model, period, open) {
    var shown = model.points.slice(-period);
    if (model.nohistory) return '<div class="mt-indicator-chart-title">' + escapeHtml(model.label) + '<span>' + escapeHtml(model.detail) + '</span></div><div class="mt-raw-current is-' + model.tone + '"><b>' + escapeHtml(model.changeText) + '</b></div>' + (model.pcHtml || '');
    if (!shown.length) return '<div class="mt-indicator-chart-title">' + escapeHtml(model.label) + '</div><p class="mt-visual-empty">이 항목의 날짜별 자료를 확인하지 못했습니다.</p>';
    var latest = shown[shown.length - 1], strip = model.points.slice(-7), fmt = model.format || String;
    var spark = trendSparkHtml_(strip, model.tone, model.zeroBase ? 0 : null);
    var trendText = strip.length > 1 ? ' · 최근 ' + strip.length + '개 기록 ' + fmt(strip[0].score) + ' → ' + fmt(strip[strip.length - 1].score) : '';
    return '<div class="mt-trend-strip is-' + model.tone + '"><div class="mt-ts-main"><div class="mt-ts-label">' + escapeHtml(model.label) + '<span>' + escapeHtml(model.detail) + '</span></div>'
      + '<div class="mt-ts-value"><b>' + escapeHtml(model.valueText) + '</b><small>' + escapeHtml(model.changeText) + '</small></div></div>' + spark + '</div>'
      + '<p class="mt-ts-note">' + escapeHtml(asOfText_(latest.date)) + trendText + '</p>'
      + '<details class="mt-ts-detail"' + (open ? ' open' : '') + '><summary>상세 보기<span> · 기간 전환·큰 차트</span></summary>'
      + '<div class="mt-chart-date">' + escapeHtml(asOfText_(latest.date)) + ' · 최근 ' + shown.length + '개 기록</div>'
      + buildFlowChart_(shown, model)
      + '<p class="mt-indicator-chart-note">' + (model.id.indexOf('volume') >= 0 ? '직전 20개 일별 기록 평균을 100%로 비교한 거래량입니다. 장중 기록은 마감 전 누적치입니다.' : escapeHtml(model.detail) + ' · 단위는 각 축과 값에 표시했습니다.') + '</p></details>';
  }
  function loadMarketIndicators_(container, data) {
    var panel = container.querySelector('.mt-front-page');
    if (!panel) return;
    if (panel.__indicatorWired) return panel.__mtIndicators;
    panel.__indicatorWired = true;
    var state = { models: buildIndicatorModels_({}, []), selected: 'kospi-volume', period: 10, loading: true, data: data, domestic: {}, macro: [], macroExtra: [], option: null, openX: null, detailOpen: false }, pending = null;
    function html(node, markup) { if (node.__mtMarkup !== markup) { node.innerHTML = markup; node.__mtMarkup = markup; } }
    function checkpoint() {
      var mount = container.querySelector('[data-market-checkpoint]');
      if (mount && state.data) html(mount, buildStrategy(state.data, state.models, state.macro));
    }
    function render(focusSelector) {
      if (!panel.isConnected) return;
      var active = document.activeElement;
      if (!focusSelector && active && panel.contains(active)) {
        if (active.hasAttribute('data-market-metric')) focusSelector = '[data-market-metric="' + active.getAttribute('data-market-metric') + '"]';
        else if (active.hasAttribute('data-indicator-period')) focusSelector = '[data-indicator-period="' + active.getAttribute('data-indicator-period') + '"]';
      }
      html(panel.querySelector('[data-market-indicators]'), renderIndicatorRows_(state.models, state.selected));
      html(panel.querySelector('[data-market-extras]'), (state.macroExtra.length ? commodityStrip_(state.macro.concat(state.macroExtra), null, state.selected) : '') + extrasBlock_(state.domestic, state.macro.concat(state.macroExtra), state.option, null, state.selected));
      var model = state.models.filter(function (m) { return m.id === state.selected; })[0] || XMODELS_[state.selected];
      if (!model) { state.selected = 'kospi-volume'; model = state.models[0]; }
      if (model.points.length && state.period > model.points.length) state.period = [40, 20, 10, 5].filter(function (n) { return n <= model.points.length; })[0] || 5;
      var periodsBox = panel.querySelector('[data-indicator-periods]');
      periodsBox.style.display = state.detailOpen ? '' : 'none'; // 기간 전환은 상세 보기에서만
      html(periodsBox, [5, 10, 20, 40].map(function (period) {
        return '<button type="button" class="mt-flow-period' + (period === state.period ? ' active' : '') + '" data-indicator-period="' + period + '" aria-pressed="' + (period === state.period) + '"' + (model.points.length < period ? ' disabled title="' + model.points.length + '개 기록 제공"' : '') + '>' + period + '일</button>';
      }).join(''));
      var content = panel.querySelector('[data-indicator-chart]');
      html(content, state.loading ? '<p class="mt-visual-empty">시장 지표를 불러오는 중입니다.</p>' : renderIndicatorHistory_(model, state.period, state.detailOpen));
      wireFlowChart_(content);
      if (focusSelector) { var focus = panel.querySelector(focusSelector); if (focus) focus.focus({ preventScroll: true }); }
    }
    // <details> toggle은 버블링하지 않아 캡처로 받는다. 열림 상태는 다시 그려도 유지한다.
    panel.addEventListener('toggle', function (event) {
      var d = event.target;
      if (!d || !d.classList || !d.classList.contains('mt-ts-detail') || state.detailOpen === d.open) return;
      state.detailOpen = d.open;
      var box = panel.querySelector('[data-indicator-periods]');
      if (box) box.style.display = state.detailOpen ? '' : 'none';
    }, true);
    panel.addEventListener('click', function (event) {
      var metric = event.target.closest('[data-market-metric]'), period = event.target.closest('[data-indicator-period]');
      if (metric) state.selected = metric.getAttribute('data-market-metric');
      else if (period) state.period = Number(period.getAttribute('data-indicator-period'));
      else return;
      render(metric ? '[data-market-metric="' + state.selected + '"]' : '[data-indicator-period="' + state.period + '"]');
      var hist = metric && panel.querySelector('.mt-indicator-history');
      if (hist && hist.getBoundingClientRect().top > window.innerHeight - 120 && hist.scrollIntoView) hist.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    render();
    function refresh() {
      if (pending) return pending;
      sharedMarketJson_('__mtMacroExtraFetch', EXTRA_FUTURES_URL_, 300000).then(function (res) {
        var rows = res && res.data ? res.data : res;
        if (Array.isArray(rows) && rows.length) { state.macroExtra = rows; render(); }
      }).catch(function () { /* 원자재·금리는 보조 정보 - 실패하면 카드가 미수신으로 남는다 */ });
      sharedMarketJson_('__mtOptionFetch', 'https://goodbyestar.cloud/option-flow', 300000).then(function (res) {
        var body = res && res.data ? res.data : res;
        if (body && body.CALL && body.PUT) { state.option = body; render(); }
      }).catch(function () { /* 옵션 값은 보조 정보 - 실패하면 카드가 미수신으로 남는다 */ });
      pending = Promise.allSettled([
        sharedMarketJson_('__mtDomesticFetch', 'https://goodbyestar.cloud/domestic-market-indicators', 60000),
        sharedMarketJson_('__mtMacroFetch', FUTURES_URL_, 300000)
      ]).then(function (results) {
        var bad = [false, false];
        results.forEach(function (result, index) {
          var payload = result.status === 'fulfilled' && result.value ? result.value.data || result.value : null;
          var valid = index ? Array.isArray(payload) && payload.length : payload && (payload.indices || payload.funds || payload.investor);
          bad[index] = !valid;
          if (valid) state[index ? 'macro' : 'domestic'] = payload;
        });
        var prior = {}; state.models.forEach(function (m) { prior[m.id] = m; });
        state.models = buildIndicatorModels_(state.domestic, state.macro).map(function (m) {
          var previous = prior[m.id], missing = m.value == null && previous && previous.value != null;
          if (missing) m = Object.assign({}, previous);
          var tvc = state.data && state.data.components && state.data.components.tradingValue;
          if (m.id.indexOf('volume') >= 0 && m.intraday && tvc && tvc.mode === 'sameTime' && isFinite(Number(tvc.relative))) m.sameTime = Math.round(Number(tvc.relative) * 100);
          m.stale = !!missing || bad[m.id === 'fx' || m.id === 'us-rate' || m.id === 'kospi-futures' ? 1 : 0];
          return m;
        });
        state.loading = false; render(); checkpoint();
        if (!bad[1]) loadTomorrow_(container, state.macro);
        return { partial: bad[0] || bad[1] || state.models.some(function (m) { return m.stale; }) };
      }).then(function (result) { pending = null; return result; }, function (error) { pending = null; throw error; });
      return pending;
    }
    panel.__mtIndicators = { refresh: refresh, setSnapshot: function (next) { state.data = next; checkpoint(); } };
    return panel.__mtIndicators;
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

    function num(n) { return (n || 0).toLocaleString('ko-KR'); }
    var flatCell = (wholeMarket && typeof head.flat === 'number') ? head.flat : null;
    return '<div class="mt-hero-breadth mt-breadth-stats">'
      + '<span class="mt-breadth-up"><small>상승 종목</small><b>' + num(head.up) + '<em>개</em></b></span>'
      + '<span class="mt-breadth-down"><small>하락 종목</small><b>' + num(head.down) + '<em>개</em></b></span>'
      + '<span class="mt-breadth-flat"><small>보합 종목</small><b>' + (flatCell == null ? '-' : num(flatCell) + '<em>개</em>') + '</b></span>'
      + '</div>'
      + marketsHtml
      + '<div class="mt-breadth-note">' + note + '</div>';
  }

  // 사이트 전체가 Groq AI 해설 상자를 "참고의견 + 말풍선 아이콘"으로 통일했다(2026-08-14).
  // 이 말풍선 아이콘으로 통일한다(둘과 완전히 동일한 SVG).
  var MT_AI_ICON = '<svg class="mt-ai-icon" width="14" height="14" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

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
    function rows(keys) {
      return COMPONENT_META.filter(function (meta) { return keys.indexOf(meta.key) !== -1; }).map(function (meta) {
        var comp = data.components && data.components[meta.key];
        var raw = formatRaw(meta, comp);
        return '<li><b>' + meta.icon + ' ' + escapeHtml(meta.label) + '</b><span>'
          + escapeHtml(raw ? raw.text : (comp && comp.band) || '자료 확인 중') + '</span>'
          + '<small>데이터: ' + escapeHtml(meta.source) + '</small></li>';
      }).join('');
    }
    return '<div class="mt-card mt-decision-card"><div class="mt-card-title">점수 구성과 자료</div>'
      + '<p>거래대금 증가만으로 매수 주도라고 판단하지 않습니다. 가격 하락·하락 종목 우세와 겹친 활발한 거래는 매도 우위 가능성으로 읽습니다.</p>'
      + '<details class="mt-score-method"><summary>계산 기준·데이터 출처 보기</summary>'
      + '<p>시장 심리 점수(0~100)는 수급과 가격 방향의 평균입니다. 수급은 외국인·기관 순매수 대리지표와 거래대금을 함께 보되, 거래대금은 가격 변화·상승 종목 폭·순매수와 일치할 때만 방향을 보탭니다. 매수·매도 주도 체결 자료는 사용하지 않으므로 실제 매수·매도 주체는 판정하지 않습니다. 위험은 VIX·원/달러·금리·검증된 신용융자로 별도 표시합니다. 과거 색상 칸은 저장된 구성값이 있는 날만 같은 계산식으로 재계산합니다. 0~39 공포, 40~60 보통, 61~100 과열은 운영용 구간이며 예측이나 투자 권유가 아닙니다.</p>'
      + '<h4>방향 점수</h4><ul>' + rows(['flow', 'tradingValue', 'avgChange', 'riseRatio', 'sectorStrength']) + '</ul>'
      + '<h4>별도 위험 지표</h4><ul>' + rows(['vix', 'exchange', 'rates', 'creditRisk']) + '</ul></details></div>';
  }
  // ---- 최근 단기흐름(5/10/20/40일) ----

  function historyDays_(data) {
    // 서버가 같은 버전으로 다시 계산할 수 있었던 날짜만 표시한다.
    if (!data || data.scoreMethod !== 'direction-v2') return [];
    return (data.recentDays || []).filter(function (item) {
      return item && typeof item.score === 'number' && isFinite(item.score);
    }).map(function (item) { return { date: item.date, score: item.score }; }).slice(-40);
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
    neutral: { icon: '⚪', word: '보통' },
    greed: { icon: '🔴', word: '과열' }
  };
  // 2026-10-16: 점수 구간 경계는 여기 한 곳(서버 market_temp_score.GRADE3 와 같다). 0~29 공포(파랑), 30~69 보통(회색), 70~100 과열(빨강).
  // 히트맵 색·범례·계기판·설명 문구가 모두 이 값과 scoreTone_ 하나만 쓴다. 칸에 보이는 정수(반올림)와 색이 어긋나지 않게 반올림한 값으로 판정한다.
  var SCORE_CUT_ = { fear: 30, greed: 70 };
  var ZONE_COLOR_ = { fear: '#4a90d9', neutral: '#8b95a5', greed: '#d65f5f' };
  function zoneRangeText_() {
    return '0~' + (SCORE_CUT_.fear - 1) + '점은 공포, ' + SCORE_CUT_.fear + '~' + (SCORE_CUT_.greed - 1) + '점은 보통, ' + SCORE_CUT_.greed + '점부터 과열';
  }
  function marketMood_(score) {
    return MARKET_MOOD[scoreTone_(score)];
  }

  function scoreTone_(score) {
    var rounded = Math.round(Number(score));
    return rounded < SCORE_CUT_.fear ? 'fear' : rounded < SCORE_CUT_.greed ? 'neutral' : 'greed';
  }

  // 기준일 문구 "10.22 기준"은 사이트 공용 표기(window.NineTime)로 만든다. 못 읽으면 예전 "10/22 기준".
  function asOfText_(date) {
    return (window.NineTime && window.NineTime.asOf(date)) || (shortDate_(date) + ' 기준');
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


  // ---- 그래서 내일은? (2026-10-04 사용자 요청) ----
  // 근거: 2025-11~2026-10 코스피 220거래일을 직접 대조했다(나스닥100 선물·SOX·VIX 변화·원/달러 변화의 z점수 합).
  //  - 미국 신호가 뚜렷한 날(합 |z|>=1.5, 전체의 약 45%)은 시초 방향이 90% 안팎으로 맞았고, 종가 방향도 74~90%였다.
  //  - 신호가 약한 날(약 40%)은 상승 62%로 평소 상승 비율(약 61%)과 같다 = 맞히기 어렵다.
  //  - 전체 "종가 방향" 적중 65%는 아무것도 안 보고 "오른다"만 찍은 63%와 비슷하므로 종가 방향을 크게 내세우지 않는다.
  // 야간선물(2026-10-23 사용자 지시 "야간선물이 다음날 코스피 방향을 결정해" → 검증 후 점수에 반영):
  //  - 날짜 기준 확인: KOSPI200_NIGHT 일봉 날짜 D = D 저녁에 시작해 D+1 오전 5시에 끝나는 세션(시작일).
  //    근거: 야간 시가가 같은 날 주간 종가와 이어지는 평균 차이 1.18%(종료일로 읽으면 3.08%), 야간 종가↔다음 주간 시가 1.71%(2.38%).
  //  - 신호 = 야간 종가 / 직전 주간 종가 - 1. 코스피200 선물 232거래일(2025-11-10~2026-10-22) 중 다음 날 시초 갭과 상관 0.48,
  //    방향 적중 70%(|신호|>=2%는 81%). 미국 4항 합과 상관 0.35라 일부는 겹친다.
  //  - 미국 4항 합에 야간 z점수를 같은 비중(1)으로 더하면 시초 갭 상관 0.742 -> 0.778, 종가 상관 0.527 -> 0.570,
  //    후반 구간만 0.733 -> 0.793. 합의 표준편차가 3.13 -> 3.60으로 커져 구간 경계를 같은 비율(x1.17)로 키웠다.
  //  - 야간 세션이 끝나기 전(D+1 05:05 KST 전)에는 미완성이라 점수에 넣지 않고 참고로만 보여준다.
  // 코스피 지수 대신 코스피200 선물 일봉(주간 시가=시초)으로 계산했다. 4항 표를 같은 방식으로 다시 계산하면 기존 표와
  // 거의 같다(강한 하락 시초 하락 92%/종가 하락 78% vs 기존 89%/74%).
  var FUTURES_URL_ = 'https://goodbyestar.cloud/futures?interval=day&days=120&symbols=SOX,VIX,USDKRW,US10Y,KOSPI200_NIGHT,KOSPI200_DAY,SP500_INDEX,NASDAQ_INDEX,DOW_INDEX&stored_only=true';
  var EXTRA_FUTURES_URL_ = 'https://goodbyestar.cloud/futures?interval=day&days=120&symbols=WTI,BRENT,GOLD,BTC,KTB3Y,US2Y,US30Y&stored_only=true';
  // 2026-10-23 신호 구성 변경(사용자 결정): 나스닥100 선물은 24시간 거래라 한국장 시간대와 겹칠 수 있어 빼고, 미국 현물 정규장 종가
  // (S&P 500·나스닥 종합·다우존스)·필라델피아 반도체·VIX·원/달러·야간 코스피200 선물로 바꿨다. 같은 코스피200 선물 232거래일
  // (2025-11-10~2026-10-22)에서 다시 쟀다. 미국 현물 3지수는 서로 상관이 커서 각 1/3 가중(묶어서 1항)으로 합산했다.
  //  - 시초 갭 상관 0.752(기존 구성 0.779), 방향 적중 75%(79%), 종가 상관 0.548(0.570). 뒤 절반(앞 절반 기준) 상관 0.779 / 적중 72%.
  //  - 구간 경계는 합의 표준편차 3.53의 0.97배·0.49배(3.42/1.73). 야간선물이 없을 때(6항)는 표준편차 3.08(2.99/1.51).
  //  - 같은 표본에서 정한 경계·평균이라 표본 안 성적이다. 같은 기간 코스피가 크게 올라 상승이 많이 나온 구간이라는 점을 감안한다.
  var TOMORROW_STATS7_ = {
    spx: [0.0751, 0.8105], nas: [0.0927, 1.1704], dji: [0.0638, 0.8084], sox: [0.294, 2.9111],
    vix: [0.1618, 7.5683], fx: [-0.0377, 0.6251], night: [0.8621, 1.7382]
  };
  var TOMORROW_WEIGHTS7_ = { spx: 1 / 3, nas: 1 / 3, dji: 1 / 3, sox: 1, vix: 1, fx: 1, night: 1 };
  var TOMORROW_SIGN7_ = { spx: 1, nas: 1, dji: 1, sox: 1, vix: -1, fx: -1, night: 1 };
  var TOMORROW_BUCKETS7_ = [
    { max: -3.42, key: 'strongDown', label: '강한 하락 신호', gap: '시초 하락 출발 91%', close: '하락 마감 79%', n: 34, span: '최근 232일' },
    { max: -1.73, key: 'down', label: '하락 우세', gap: '시초 하락 출발 86%', close: '하락 마감 51% · 장중 반등도 잦음', n: 35, span: '최근 232일' },
    { max: 1.73, key: 'flat', label: '방향 모름', gap: '시초 상승 64%', close: '상승 마감 59%', n: 91, span: '최근 232일' },
    { max: 3.42, key: 'up', label: '상승 우세', gap: '시초 상승 출발 93%', close: '상승 마감 78%', n: 41, span: '최근 232일' },
    { max: 999, key: 'strongUp', label: '강한 상승 신호', gap: '시초 상승 출발 94%', close: '상승 마감 87%', n: 31, span: '최근 232일' }
  ];
  var TOMORROW_BUCKETS6_ = [
    { max: -2.99, key: 'strongDown', label: '강한 하락 신호', gap: '시초 하락 출발 92%', close: '하락 마감 81%', n: 37, span: '최근 232일' },
    { max: -1.51, key: 'down', label: '하락 우세', gap: '시초 하락 출발 81%', close: '하락 마감 38% · 장중 반등이 더 많음', n: 26, span: '최근 232일' },
    { max: 1.51, key: 'flat', label: '방향 모름', gap: '시초 상승 64%', close: '상승 마감 59%', n: 96, span: '최근 232일' },
    { max: 2.99, key: 'up', label: '상승 우세', gap: '시초 상승 출발 85%', close: '상승 마감 69%', n: 39, span: '최근 232일' },
    { max: 999, key: 'strongUp', label: '강한 상승 신호', gap: '시초 상승 출발 91%', close: '상승 마감 88%', n: 34, span: '최근 232일' }
  ];

  // 야간선물 신호: target 이전 마지막 주간 거래일 D의 야간 일봉(D 저녁~D+1 05:00)을 D 주간 종가와 비교한다.
  // 야간 세션이 끝나기 전이거나 날짜가 맞지 않으면 pending/null.
  function nightSignal_(dayRow, nightRow, ymd, now_) {
    var dc = (dayRow && dayRow.chart) || [], nc = (nightRow && nightRow.chart) || [];
    if (!dc.length || !nc.length || (dayRow && dayRow.stale === true) || (nightRow && nightRow.stale === true)) return null;
    var dBar = null, i;
    for (i = 0; i < dc.length; i++) { if (String(dc[i].date) < ymd) dBar = dc[i]; }
    if (!dBar) return null;
    var nBar = null;
    for (i = 0; i < nc.length; i++) { if (String(nc[i].date) === String(dBar.date)) nBar = nc[i]; }
    var dClose = Number(dBar.close), nClose = nBar && Number(nBar.close);
    if (!(dClose > 0) || !(nClose > 0)) return null;
    var m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(dBar.date));
    if (!m) return null;
    // D 다음 날 오전 5시 05분(KST) 이후에야 야간 세션이 끝난 것으로 본다.
    var endMs = Date.UTC(+m[1], +m[2] - 1, +m[3] + 1, 5, 5, 0) - 9 * 3600000;
    return { gap: (nClose / dClose - 1) * 100, date: String(dBar.date), pending: (now_ == null ? Date.now() : now_) < endMs };
  }

  // 코스피200 야간선물 시세 상태(표시 전용): 값은 /futures의 KOSPI200_NIGHT 행(KIS 야간선물 수집) 그대로이며 주간 선물·현물로 대체하지 않는다.
  // 야간 세션은 18:00~05:05(KST). 세션 중 5분 이내 갱신=실시간, 5분 넘게 묵음=지연, 세션 밖이거나 12시간 넘게 묵음=최종 마감, 72시간 넘게 묵음·값 없음=null(시세 없음).
  function nightQuote_(row, now_) {
    var now = now_ == null ? Date.now() : now_;
    var price = row ? Number(row.price) : NaN, rate = row ? Number(row.change_rate) : NaN, change = row && row.change != null ? Number(row.change) : NaN;
    var at = row && row.updated_at ? Date.parse(row.updated_at) : NaN;
    if (!(row && row.stale !== true && isFinite(price) && price > 0 && isFinite(rate) && isFinite(at)) || now - at > 72 * 3600000) return null;
    var kst = new Date(now + 9 * 3600000), min = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var inSession = min >= 18 * 60 || min <= 5 * 60 + 5, age = now - at;
    var status = !inSession || age > 12 * 3600000 ? '최종 마감' : age <= 5 * 60000 ? '실시간' : '지연 ' + Math.round(age / 60000) + '분';
    var k = new Date(at + 9 * 3600000), p2 = function (n) { return String(n).padStart(2, '0'); };
    return { price: price, rate: rate, change: isFinite(change) ? change : null, status: status,
      time: p2(k.getUTCMonth() + 1) + '.' + p2(k.getUTCDate()) + ' ' + p2(k.getUTCHours()) + ':' + p2(k.getUTCMinutes()) + ' KST' };
  }

  // 신호 계산(순수 함수): by = {심볼: /futures 행}, ymd = 대상 거래일(YYYYMMDD). 미국 현물 3지수·SOX·VIX·원/달러 중 하나라도 없으면 null.
  // 야간선물은 세션이 끝난 뒤에만 점수에 넣는다(진행 중이면 night.pending).
  function tomorrowSignal_(by, ymd, now_) {
    var r = {
      spx: lastReturnBefore_(by.SP500_INDEX, ymd), nas: lastReturnBefore_(by.NASDAQ_INDEX, ymd), dji: lastReturnBefore_(by.DOW_INDEX, ymd),
      sox: lastReturnBefore_(by.SOX, ymd), vix: lastReturnBefore_(by.VIX, ymd), fx: lastReturnBefore_(by.USDKRW, ymd)
    };
    if (!r.spx || !r.nas || !r.dji || !r.sox || !r.vix || !r.fx) return null;
    var night = nightSignal_(by.KOSPI200_DAY, by.KOSPI200_NIGHT, ymd, now_), useNight = !!(night && !night.pending);
    var vals = { spx: r.spx.pct, nas: r.nas.pct, dji: r.dji.pct, sox: r.sox.pct, vix: r.vix.pct, fx: r.fx.pct };
    if (useNight) vals.night = night.gap;
    var zsum = 0;
    Object.keys(vals).forEach(function (k) {
      zsum += TOMORROW_WEIGHTS7_[k] * TOMORROW_SIGN7_[k] * (vals[k] - TOMORROW_STATS7_[k][0]) / TOMORROW_STATS7_[k][1];
    });
    var buckets = useNight ? TOMORROW_BUCKETS7_ : TOMORROW_BUCKETS6_;
    var bucket = buckets.filter(function (b) { return zsum < b.max; })[0] || buckets[2];
    return { r: r, night: night, useNight: useNight, zsum: zsum, bucket: bucket, vals: vals };
  }

  // 조간신문 기준: 평일 15:30 전(장전·장중)에는 오늘 코스피, 마감 후·주말에는 다음 거래일을 가리킨다.
  // 공휴일은 알 수 없어 평일로 본다. now_는 시험용으로 바꿀 수 있다.
  function nextKospiDay_(now_) {
    var now = new Date((now_ == null ? Date.now() : now_) + 9 * 3600000);
    var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    var d = today, dow = d.getUTCDay();
    var open = dow >= 1 && dow <= 5 && now.getUTCHours() * 60 + now.getUTCMinutes() < 15 * 60 + 30;
    if (!open) d = new Date(d.getTime() + 86400000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86400000);
    var gap = Math.round((d.getTime() - today.getTime()) / 86400000);
    var ymd = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
    return { ymd: ymd, word: gap === 0 ? '오늘' : gap === 1 ? '내일' : '다음 거래일',
      label: (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()] + ')' };
  }

  // 일봉 마지막 두 봉의 종가 변화. 마지막 봉이 5일 넘게 묵었거나 응답이 stale이면 null(= 미수신).
  function lastBarChange_(row) {
    var chart = (row && row.chart) || [];
    if (row && row.stale === true || chart.length < 2) return null;
    var a = Number(chart[chart.length - 1].close), b = Number(chart[chart.length - 2].close);
    var ymd = String(chart[chart.length - 1].date), m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd);
    if (!a || !b || !m) return null;
    if (Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3]) > 5 * 86400000 + 9 * 3600000) return null;
    return { close: a, pct: (a / b - 1) * 100, date: m[2] + '/' + m[3] };
  }

  // target 날짜 이전에 끝난 가장 최근 일봉의 전일 대비 등락률(%)
  function lastReturnBefore_(row, ymd) {
    var chart = (row && row.chart) || [];
    var idx = -1;
    for (var i = 0; i < chart.length; i++) { if (String(chart[i].date) < ymd) idx = i; }
    if (idx < 1) return null;
    var a = Number(chart[idx].close), b = Number(chart[idx - 1].close);
    return a && b ? { pct: (a / b - 1) * 100, date: String(chart[idx].date) } : null;
  }

  function buildTomorrowCard_() {
    return '<section class="mt-section mt-card mt-tomorrow-card" data-mt-tomorrow>'
      + '<div class="mt-tm-head"><strong>' + nextKospiDay_().word + ' 전망</strong><small>미국 현물 마감 기준으로 본 코스피 출발</small></div>'
      + '<div class="mt-hint">미국 시장 움직임을 확인하는 중입니다.</div></section>';
  }

  function loadTomorrow_(container, rows) {
    var mount = container.querySelector('[data-mt-tomorrow]');
    if (!mount) return;
    return Promise.resolve(rows || []).then(function (rows) {
      var by = {};
      rows.forEach(function (r) { by[r.symbol] = r; });
      var target = nextKospiDay_();
      var key = JSON.stringify(rows) + target.ymd + target.word + Math.floor(Date.now() / 60000); // 분 단위 포함: 야간선물 실시간/지연 표시가 시간에 따라 바뀐다
      var W = target.word, title = '<strong>' + W + ' 전망</strong>';
      var heading = container.querySelector('[data-mt-tomorrow-heading]');
      if (heading) heading.textContent = '시장 브리핑 · ' + target.label + ' 출발';
      if (mount.__mtTomorrowKey === key) return;
      var sig = tomorrowSignal_(by, target.ymd);
      if (!sig) { if (!mount.__mtTomorrowKey) mount.innerHTML = mount.firstChild.outerHTML + '<div class="mt-hint">미국 시장 자료를 받지 못해 판단하지 않습니다.</div>'; return; }
      var night = sig.night, useNight = sig.useNight, bucket = sig.bucket, r = sig.r;
      var tone = /up/i.test(bucket.key) ? 'up' : /down/i.test(bucket.key) ? 'down' : 'flat';
      function sgn(v, digits) { return (v > 0 ? '+' : '') + v.toFixed(digits == null ? 2 : digits) + '%'; }
      function md(d) { return String(d).slice(4, 6) + '/' + String(d).slice(6, 8); }
      // tag는 값의 부호만으로 정한 짧은 해석 힌트(신호 계산과 무관): good=시초 방향에 우호적인 쪽
      var why = [
        { name: 'S&P 500', val: r.spx.pct, good: r.spx.pct > 0, tag: r.spx.pct > 0 ? '상승 우호' : '하락 압력' },
        { name: '나스닥 종합', val: r.nas.pct, good: r.nas.pct > 0, tag: r.nas.pct > 0 ? '상승 우호' : '하락 압력' },
        { name: '다우존스', val: r.dji.pct, good: r.dji.pct > 0, tag: r.dji.pct > 0 ? '상승 우호' : '하락 압력' },
        { name: '필라델피아 반도체', val: r.sox.pct, good: r.sox.pct > 0, tag: r.sox.pct > 0 ? '반도체 강세' : '반도체 약세' },
        { name: 'VIX', val: r.vix.pct, good: r.vix.pct < 0, tag: r.vix.pct < 0 ? '변동성 완화' : '변동성 확대' },
        { name: '원/달러', val: r.fx.pct, good: r.fx.pct < 0, tag: r.fx.pct < 0 ? '환율 안정' : '환율 부담' }
      ];
      var usDates = [r.spx.date, r.nas.date, r.dji.date].filter(function (d, i, a) { return a.indexOf(d) === i; }).map(md).join('·');
      var items = why.map(function (w) {
        return '<li class="mt-tm-item ' + (w.good ? 'is-pos' : 'is-neg') + '"><span><span class="mt-tm-name">' + w.name + '</span></span>'
          + '<b class="' + (w.good ? 'mt-val-pos' : 'mt-val-neg') + '">' + sgn(w.val) + '</b><em class="mt-tm-tag">' + w.tag + '</em></li>';
      }).join('');
      // 코스피200 야간선물: 신호 점수 반영 여부와 무관하게 항상 보여준다. 값이 없으면 '시세 없음'(주간 선물·현물로 대체하지 않는다).
      var nq = nightQuote_(by.KOSPI200_NIGHT, Date.now());
      var nightScore = useNight ? '신호 점수에 반영' : '참고 · 점수에는 야간 세션 종료(05:05) 후 반영';
      var nightItem = nq
        ? '<li class="mt-tm-item mt-tm-nightcard ' + (nq.rate > 0 ? 'is-pos' : nq.rate < 0 ? 'is-neg' : '') + '"><span><span class="mt-tm-name">코스피200 야간선물</span></span>'
          + '<span class="mt-tm-nval"><b class="' + (nq.rate > 0 ? 'mt-val-pos' : nq.rate < 0 ? 'mt-val-neg' : 'mt-val-zero') + '">' + sgn(nq.rate) + '</b><span>' + nq.price.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          + (nq.change == null ? '' : ' (' + (nq.change > 0 ? '+' : '') + nq.change.toFixed(2) + ')') + '</span></span>'
          + '<em class="mt-tm-tag">' + nq.status + ' · ' + nq.time + '</em>'
          + '<small class="mt-tm-nmeta">출처 KIS 야간선물 · ' + nightScore + '</small></li>'
        : '<li class="mt-tm-item mt-tm-nightcard is-none"><span><span class="mt-tm-name">코스피200 야간선물</span></span>'
          + '<span class="mt-tm-nval"><b class="mt-val-zero">시세 없음</b></span><em class="mt-tm-tag">데이터 확인 중</em>'
          + '<small class="mt-tm-nmeta">야간선물 시세를 받지 못했습니다(주간 선물·현물로 대체하지 않음)</small></li>';
      // 5초 브리핑: 미국장 → 한국장 영향(결론은 위 헤드라인). 값의 부호만 문장으로 옮긴다.
      var us3 = [r.spx.pct, r.nas.pct, r.dji.pct], up3 = us3.filter(function (v) { return v > 0; }).length;
      var briefUs = (up3 === 3 ? '3대 지수 상승' : up3 === 0 ? '3대 지수 하락' : '3대 지수 엇갈림') + ' · 반도체 ' + (r.sox.pct > 0 ? '강세' : '약세') + ' · VIX ' + (r.vix.pct > 0 ? '상승' : '하락');
      var briefKr = '환율 ' + (r.fx.pct > 0 ? '상승(원화 약세)' : '하락(원화 강세)') + ' · 야간선물 ' + (nq ? sgn(nq.rate) : '시세 없음');
      var verdictText = tone === 'up' ? W + ' 시초는 올라서 시작할 가능성이 높습니다'
        : tone === 'down' ? W + ' 시초는 내려서 시작할 가능성이 높습니다'
        : '미국 신호가 약해서 ' + W + ' 방향은 알 수 없습니다';
      var badge = tone === 'up' ? '↗ 상승' : tone === 'down' ? '↘ 하락' : '→ 중립';
      mount.innerHTML = '<div class="mt-tm-head">' + title + '<small>' + (useNight ? '미국 현물 마감 + 야간선물 + VIX·환율 기준' : '미국 현물 마감 + VIX·환율 기준') + '</small></div>'
        + '<div class="mt-tm-verdict mt-tm-' + tone + '"><em class="mt-tm-badge">' + badge + '</em><b>' + bucket.label + '</b><span>' + verdictText + '</span>'
        + '<div class="mt-tm-brief"><p><i>미국장</i>' + briefUs + '</p><p><i>한국장 영향</i>' + briefKr + '</p></div></div>'
        + '<ul class="mt-tm-why">' + items + nightItem + '</ul>'
        + '<p class="mt-tm-meta">미국 정규장 종가 ' + usDates + ' · VIX·환율은 일봉 기준 · 오르면 부담(VIX는 위험회피, 환율은 원화 약세) · 반도체는 코스피 비중이 커서 반영</p>'
        + '<div class="mt-tm-proof"><b>이 신호를 믿을 만한 이유</b>'
        + '<span class="mt-tm-proof-line">같은 강도 신호 <b>' + bucket.n + '거래일</b>(' + (bucket.span || '최근 220일') + ') 중 <b>' + bucket.gap + '</b>, ' + bucket.close + '.</span>'
        + '<span class="mt-tm-proof-line">' + (tone === 'flat' ? '평소 확률과 같아 방향을 단정할 수 없습니다.' : '종가까지 이어질 가능성은 시초보다 낮습니다.') + '</span></div>';
      mount.__mtTomorrowKey = key;
    }).catch(function () {
      if (!mount.__mtTomorrowKey) mount.innerHTML = '<div class="mt-tm-head"><strong>' + nextKospiDay_().word + ' 전망</strong></div><div class="mt-hint">미국 시장 자료를 불러오지 못했습니다.</div>';
    });
  }

  // 2026-10-16: 최근 단기흐름을 막대 칸에서 선 그래프로 바꿨다(사용자 시안 A: 구간 배경 + 선).
  // 공포·보통·과열 띠 위에 점수 선과 점을 그리고 점 색은 scoreTone_ 구간색을 따른다. 정확한 값은 hover/탭 툴팁.
  function buildFlowChart_(shown, metric) {
    var W = 480, H = 230, L = metric ? 72 : 32, R = 18, T = 16, B = 28, n = shown.length;
    function X(i) { return n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1); }
    var values = shown.map(function (r) { return r.score; });
    var low = metric ? Math.min.apply(null, values) : 0, high = metric ? Math.max.apply(null, values) : 100;
    if (metric) {
      if (metric.zeroBase) { low = Math.min(0, low); high = Math.max(0, high); }
      var padding = high > low ? (high - low) * 0.12 : Math.max(Math.abs(high) * 0.01, 1);
      low -= padding; high += padding;
      if (metric.id.indexOf('volume') >= 0) { low = 0; high = Math.max(110, high); }
    }
    function Y(v) { return T + (high - (metric ? v : Math.max(0, Math.min(100, v)))) * (H - T - B) / (high - low); }
    var points = shown.map(function (day, i) { return { x: X(i), y: Y(day.score) }; });
    var slopes = [], tangents = [];
    for (var i = 0; i < n - 1; i++) slopes.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
    for (var j = 0; j < n; j++) {
      var left = slopes[j - 1], right = slopes[j];
      tangents[j] = j === 0 ? (right || 0) : j === n - 1 ? (left || 0)
        : left * right <= 0 ? 0 : 2 * left * right / (left + right);
    }
    var line = 'M' + points[0].x.toFixed(2) + ',' + points[0].y.toFixed(2);
    for (var k = 1; k < n; k++) {
      var a = points[k - 1], b = points[k], dx = (b.x - a.x) / 3;
      line += ' C' + (a.x + dx).toFixed(2) + ',' + (a.y + tangents[k - 1] * dx).toFixed(2)
        + ' ' + (b.x - dx).toFixed(2) + ',' + (b.y - tangents[k] * dx).toFixed(2)
        + ' ' + b.x.toFixed(2) + ',' + b.y.toFixed(2);
    }
    var cuts = SCORE_CUT_;
    var ticks = metric ? [low, metric.zeroBase && low < 0 && high > 0 ? 0 : low + (high - low) / 2, high] : [0, cuts.fear, cuts.greed, 100];
    if (metric && metric.id.indexOf('volume') >= 0) ticks = [0, 100, high];
    var grid = ticks.map(function (v) {
      return '<line class="mt-fc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(2) + '" y2="' + Y(v).toFixed(2) + '"/>';
    }).join('');
    var labels = ticks.map(function (v) {
      return '<span class="mt-fc-ylabel" style="top:' + (Y(v) / H * 100).toFixed(2) + '%">' + escapeHtml(metric ? (metric.axisFormat || metric.format)(v) : String(v)) + '</span>';
    }).join('');
    var step = n > 6 ? Math.ceil(n / 5) : 1;
    labels += shown.map(function (day, index) {
      if (index !== n - 1 && (index % step !== 0 || n - 1 - index <= step / 2)) return '';
      return '<span class="mt-fc-xlabel" style="left:' + (X(index) / W * 100).toFixed(2) + '%">' + escapeHtml(shortDate_(day.date)) + '</span>';
    }).join('');
    // 기준선(거래량 100% · 순매수 0)이 있으면 선·면·점을 기준 위 옅은 붉은 / 아래 옅은 파랑으로 칠한다. 기준이 없는 항목은 기존 색 유지.
    var base = metric ? (metric.base != null && isFinite(metric.base) ? metric.base : metric.id.indexOf('volume') >= 0 ? 100 : metric.signed ? 0 : null) : null;
    var baseY = base == null ? null : Math.max(T, Math.min(H - B, Y(base)));
    var dots = shown.map(function (day, index) {
      return '<circle class="mt-fc-dot mt-rib-tone-' + (metric ? 'neutral' : scoreTone_(day.score)) + (baseY == null ? '' : day.score > base ? ' is-above' : day.score < base ? ' is-below' : '') + '" cx="' + X(index).toFixed(2) + '" cy="' + Y(day.score).toFixed(2) + '" r="' + (index === n - 1 ? 4.5 : 2.8) + '"/>';
    }).join('');
    var last = shown[n - 1], tone = metric ? metric.tone : scoreTone_(last.score);
    var fillId = 'mt-flow-fill-' + (metric ? metric.id + '-' : '') + n + '-' + String(last.date).replace(/[^0-9]/g, '');
    var area = line + ' L' + X(n - 1).toFixed(2) + ',' + (H - B) + ' L' + X(0).toFixed(2) + ',' + (H - B) + ' Z';
    var pts = shown.map(function (day, index) {
      return { x: Number(X(index).toFixed(2)), y: Number(Y(day.score).toFixed(2)), t: day.date + ' · ' + (metric ? metric.format(day.score) : Math.round(day.score) + '점 · ' + marketMood_(day.score).word), k: metric ? 'neutral' : scoreTone_(day.score) };
    });
    var summary = '최근 ' + n + '개 기록 ' + (metric ? metric.label : '시장 방향 점수') + ': ' + shown.map(function (d) { return shortDate_(d.date) + ' ' + (metric ? metric.format(d.score) : Math.round(d.score)); }).join(', ');
    return '<div class="mt-flow-chart' + (metric ? ' mt-chart-metric' : '') + ' mt-chart-' + tone + '" data-mt-flow-chart data-w="' + W + '" data-h="' + H + '" data-pts="' + escapeHtml(JSON.stringify(pts)) + '">'
      + '<svg class="mt-flow-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + escapeHtml(summary) + '">'
      + '<defs><linearGradient id="' + fillId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".22"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>'
      + (baseY == null ? '' : ['up', 'dn'].map(function (side) {
        return '<linearGradient id="' + fillId + '-g' + side + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + (side === 'up' ? '#e7aaa5' : '#9dbbe0') + '" stop-opacity=".30"/><stop offset="100%" stop-color="' + (side === 'up' ? '#e7aaa5' : '#9dbbe0') + '" stop-opacity="0"/></linearGradient>';
      }).join(''))
      + (baseY == null ? '' : '<clipPath id="' + fillId + '-up"><rect x="0" y="0" width="' + W + '" height="' + baseY.toFixed(2) + '"/></clipPath><clipPath id="' + fillId + '-dn"><rect x="0" y="' + baseY.toFixed(2) + '" width="' + W + '" height="' + (H - baseY).toFixed(2) + '"/></clipPath>')
      + grid
      + (baseY == null
        ? '<path class="mt-fc-area" d="' + area + '" fill="url(#' + fillId + ')"/><path class="mt-fc-line" d="' + line + '"/>'
        : ['up', 'dn'].map(function (side) {
          return '<g class="mt-fc-' + side + '" clip-path="url(#' + fillId + '-' + side + ')"><path class="mt-fc-area" d="' + area + '" fill="url(#' + fillId + '-g' + side + ')"/><path class="mt-fc-line" d="' + line + '"/></g>';
        }).join(''))
      + '<circle class="mt-fc-halo' + (baseY == null ? '' : last.score > base ? ' is-above' : last.score < base ? ' is-below' : '') + '" cx="' + X(n - 1).toFixed(2) + '" cy="' + Y(last.score).toFixed(2) + '" r="11"/>' + dots
      + '<line class="mt-fc-cursor" y1="' + T + '" y2="' + (H - B) + '" hidden></line></svg>'
      + labels + '<div class="mt-fc-tip" hidden></div></div>';
  }
  function wireFlowChart_(root) {
    root.querySelectorAll('[data-mt-flow-chart]').forEach(function (box) {
      if (box.__wired) return;
      box.__wired = true;
      var pts;
      try { pts = JSON.parse(box.getAttribute('data-pts')); } catch (e) { return; }
      var svg = box.querySelector('svg'), tip = box.querySelector('.mt-fc-tip'), cur = box.querySelector('.mt-fc-cursor');
      var W = Number(box.getAttribute('data-w')), H = Number(box.getAttribute('data-h'));
      function show(event) {
        var rect = svg.getBoundingClientRect();
        if (!rect.width || !pts.length) return;
        var x = (event.clientX - rect.left) / rect.width * W;
        var best = 0;
        pts.forEach(function (p, i) { if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i; });
        var p = pts[best];
        cur.setAttribute('x1', p.x); cur.setAttribute('x2', p.x); cur.removeAttribute('hidden');
        tip.textContent = p.t;
        tip.className = 'mt-fc-tip mt-rib-tone-' + p.k;
        tip.hidden = false;
        var halfTip = tip.getBoundingClientRect().width / 2;
        tip.style.left = Math.max(halfTip + 4, Math.min(rect.width - halfTip - 4, p.x / W * rect.width)) + 'px';
        tip.style.top = (p.y / H * rect.height) + 'px';
      }
      function hide() { tip.hidden = true; cur.setAttribute('hidden', ''); }
      svg.addEventListener('pointermove', show);
      svg.addEventListener('pointerdown', show);
      svg.addEventListener('pointerleave', hide);
    });
  }

  function buildSparklineContent(data, period) {
    var all = historyDays_(data);
    var shown = all.slice(-period);
    if (!shown.length) return '<div class="mt-stats-empty">새 기준으로 다시 계산할 수 있는 기록이 없습니다.</div>';
    var offset = all.length - shown.length;
    var chart = buildFlowChart_(shown);
    var latest = shown[shown.length - 1];
    var before = all[all.length - 2];  // 기간 선택과 상관없이 바로 앞 거래일
    var change = before ? Math.round(latest.score) - Math.round(before.score) : null;
    var changeHtml = change == null ? '' : change === 0 ? ' <small class="mt-heat-delta">전 거래일과 같음</small>'
      : ' <small class="mt-heat-delta ' + (change > 0 ? 'is-up' : 'is-down') + '">' + (change > 0 ? '▲' : '▼') + Math.abs(change) + ' <span>전 거래일 대비</span></small>';
    var scores = shown.map(function (day) { return Math.round(day.score); });
    var avg = Math.round(scores.reduce(function (sum, v) { return sum + v; }, 0) / scores.length);
    var stats = '선택 기간 평균 ' + avg + ' · 최고 ' + Math.max.apply(null, scores) + ' · 최저 ' + Math.min.apply(null, scores);
    function range_(lo, hi) { return lo + '~' + hi; }
    var cuts = SCORE_CUT_;
    return '<div class="mt-history-chart-meta"><div class="mt-chart-current"><b class="mt-rib-tone-' + scoreTone_(latest.score) + '">'
      + Math.round(latest.score) + '<small>점</small></b><span class="mt-chart-grade mt-rib-tone-' + scoreTone_(latest.score) + '">' + marketMood_(latest.score).word + '</span>' + changeHtml + '</div>'
      + '<span class="mt-chart-date">최근 ' + shown.length + '거래일 · ' + escapeHtml(asOfText_(latest.date)) + '</span></div>'
      + chart
      + '<div class="mt-chart-zones"><span class="is-fear">공포 0–29</span><span class="is-neutral">보통 30–69</span><span class="is-greed">과열 70–100</span></div>'
      + '<div class="mt-chart-range"><span>기간 평균 <b>' + avg + '</b></span><span>최고 <b>' + Math.max.apply(null, scores) + '</b></span><span>최저 <b>' + Math.min.apply(null, scores) + '</b></span></div>'
      + '<details class="mt-front-chart-details"><summary>점수 읽는 법</summary>'
      + '<p class="mt-heat-stats">최신 거래일 ' + escapeHtml(shortDate_(latest.date)) + ' · ' + stats + '</p>'
      + '<p class="mt-heat-legend"><span class="mt-rib-tone-fear">■ 공포 ' + range_(0, cuts.fear - 1) + '</span><span class="mt-rib-tone-neutral">■ 보통 ' + range_(cuts.fear, cuts.greed - 1)
      + '</span><span class="mt-rib-tone-greed">■ 과열 ' + range_(cuts.greed, 100) + '</span></p>'
      + '<p class="mt-heat-note">수급·가격 방향의 변화입니다. 위험도는 별도 지표이며 높을수록 위험합니다. 방향 점수에 포함되지 않습니다. 날짜를 누르거나 마우스를 올리면 점수를 확인할 수 있습니다.</p></details>';

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
      + '<div class="mt-history-tail-head"><div class="mt-card-title">최근 시장 흐름</div><div class="mt-flow-periods" role="tablist" aria-label="단기흐름 기간">' + buttons + '</div></div>'
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
      wireFlowChart_(content);
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

  // 체크포인트는 상단과 같은 원자료를 재사용한다. 합성점수 대신 실제 시장 폭과 수급·거래량·환율을 문장으로 읽는다.
  // 문장 끝(.!? 뒤 공백)마다 한 줄씩 보이게 나눈다. 숫자 속 소수점은 뒤에 공백이 없어 나뉘지 않는다.
  function splitSentences_(text) {
    return String(text == null ? '' : text).replace(/([.!?])\s+(?=\S)/g, '$1\n').split('\n').filter(function (t) { return t.trim(); });
  }
  function sentenceHtml_(text) {
    return splitSentences_(text).map(function (t) { return '<span class="mt-sent">' + escapeHtml(t) + '</span>'; }).join('');
  }
  function checkpointDate_(data) {
    var m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(data && data.updatedAt || ''));
    if (!m) return '';
    return quotesAreStale_(data) ? '직전 거래일 마감 기준' : m[1] + '.' + m[2] + ' 기준';
  }

  function checkpointFacts_(data, models, macro) {
    models = models || [];
    var story = frontPageStory_(data), b = story.breadth, items = [], avoid = [];
    var down = b && b.down > b.up * 1.5, up = b && b.up > b.down * 1.5;
    var title = down ? '하락이 넓게 퍼졌습니다. 내 종목의 변화부터 확인하세요.'
      : up ? '오르는 종목이 많습니다. 수급도 함께 붙는지 살펴보세요.'
      : b ? '종목마다 방향이 다릅니다. 내 종목의 근거를 먼저 살펴보세요.' : '확인된 시장 자료부터 차례로 살펴보세요.';
    var shares = investorShares_(models), actors = shares && shares.items;
    function find(id) { return models.filter(function (m) { return m.id === id; })[0]; }
    if (actors) {
      var selling = actors[0].value < 0 && actors[1].value < 0, buying = actors[0].value > 0 && actors[1].value > 0;
      if (selling && down) title = actors[2].value > 0 ? '개인이 받고, 외국인·기관은 팔고 있습니다.' : '하락 종목이 많고, 외국인·기관은 함께 팔고 있습니다.';
      else if (selling && up) title = '오르는 종목은 많지만, 외국인·기관 수급은 매도 쪽입니다.';
      else if (buying && down) title = '하락 종목은 많지만, 외국인·기관은 함께 사고 있습니다.';
      else if (buying && up) title = '외국인·기관의 순매수와 종목 상승이 함께 나타납니다.';
      items.push({ label: '누가 사고파는지', evidence: actors.map(function (r) {
        return r.label + ' ' + (r.value > 0 ? '순매수 ' : r.value < 0 ? '순매도 ' : '순매매 없음 ') + indicatorMoney_(Math.abs(r.value));
      }).join(' · '), date: shortDate_(shares.date) + ' 기준',
        check: selling ? '보유 종목의 외국인·기관 수급도 같은 흐름인지 비교하세요.' : buying ? '오르는 종목에도 순매수가 이어지는지 확인하세요.' : '시장 전체의 수급과 보유 종목의 수급을 나란히 확인하세요.' });
      if (selling) avoid.push('개인의 순매수만 보고 외국인·기관의 순매도를 놓치지 마세요.');
      else if (buying) avoid.push('외국인·기관이 산다는 이유만으로 이미 오른 종목을 따라 사지 마세요.');
      else avoid.push('시장 전체의 순매수를 내 종목의 매수 근거로 그대로 옮기지 마세요.');
    }
    var volumes = ['kospi-volume', 'kosdaq-volume'].map(find).filter(function (m) { return m && m.value != null; });
    if (volumes.length) items.push({ label: '거래가 따라오는지', evidence: volumes.map(function (m) {
      return m.label + ' ' + m.statusText + ' (' + m.valueText + ', ' + shortDate_(m.date) + ')';
    }).join(' · '), date: '직전 20개 기록 평균 대비', check: volumes.some(function (m) { return m.intraday; })
      ? '장중 누적치입니다. 마감 전 수치를 하루 전체 거래량과 구분해서 보세요.'
      : volumes.some(function (m) { return m.value < 80; }) ? '가격 움직임만 보지 말고, 보유 종목의 거래량도 평소와 비교하세요.' : '시장 거래량과 보유 종목의 거래량이 함께 늘었는지 비교하세요.' });
    if (volumes.some(function (m) { return m.intraday; })) avoid.push('마감 전 누적 거래량을 하루 전체 거래량과 비교해 침체로 단정하지 마세요.');
    else if (volumes.some(function (m) { return m.value < 80; })) avoid.push('거래가 적은 가격 움직임만 보고 추세가 바뀌었다고 단정하지 마세요.');
    if (!avoid.length) avoid.push(b ? '시장 분위기만 보고 종목의 뉴스·공시 확인을 건너뛰지 마세요.' : '자료가 없는 항목을 보합이나 수급 균형으로 해석하지 마세요.');
    var fx = find('fx');
    if (fx && fx.value != null && fx.delta != null) items.push({ label: '환율도 같은 방향인지',
      evidence: (fx.delta > 0 ? '달러 강세' : fx.delta < 0 ? '원화 강세' : '환율 변화 없음') + ' · <strong class="mt-cp-fx">$1 = ₩' + escapeHtml(String(fx.valueText).replace(/원$/, '')) + '</strong> (' + escapeHtml(fx.changeText) + ')', html: true,
      date: shortDate_(fx.date) + ' 기준', check: '환율 영향을 받는 종목은 주가와 환율이 함께 움직이는지 살펴보세요.' });
    if (!items.length) items.push({ label: '내 종목과 시장을 구분해서 보기', evidence: b ? story.headline : '상승·하락 종목 집계를 확인하고 있습니다.',
      date: checkpointDate_(data), check: '시장 전체의 움직임인지, 해당 종목의 뉴스·공시가 원인인지 먼저 확인하세요.' });
    // ---- 오늘 데이터에 따른 추가 규칙(2026-10-23). 값이 없으면 규칙을 건너뛰고 값을 지어내지 않는다. 확인할 점/피할 점 어조만 쓴다. ----
    var rowBy = {}; (macro || []).forEach(function (r) { if (r && r.symbol) rowBy[r.symbol] = r; });
    var vixC = lastBarChange_(rowBy.VIX), nqC = lastBarChange_(rowBy.NASDAQ_INDEX), soxC = lastBarChange_(rowBy.SOX);
    var volLow = volumes.some(function (m) { return m.value < 80 && !m.intraday; });
    var volHigh = volumes.some(function (m) { return m.value >= 180 && !m.intraday; });
    var fxPct = fx && fx.value != null && fx.delta != null && fx.value - fx.delta ? fx.delta / (fx.value - fx.delta) * 100 : null;
    function pct(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
    if (vixC && nqC) items.push({ label: '미국 불안 신호와 증시 방향', evidence: 'VIX ' + pct(vixC.pct) + ' · 나스닥 ' + pct(nqC.pct) + (soxC ? ' · 반도체지수 ' + pct(soxC.pct) : ''),
      date: vixC.date + ' 기준', check: vixC.pct >= 10 ? '공포지수가 크게 오른 날입니다. 보유 종목의 변동 폭이 평소보다 큰지 확인하세요.' : nqC.pct <= -2 || nqC.pct >= 2 ? '미국 증시 변동이 큰 날입니다. 내 종목이 미국 흐름에 민감한지 확인하세요.' : '미국 지표가 크지 않게 움직였습니다. 국내 수급과 함께 확인하세요.' });
    if (down && volLow) {
      avoid = avoid.filter(function (t) { return t.indexOf('거래가 적은') < 0; });
      avoid.unshift('하락 속 거래량이 낮은 날은 추세 판단을 미룹니다.');
    }
    if (volHigh) avoid.push('거래량이 급증한 날의 큰 움직임을 추세 전환으로 단정하지 마세요.');
    if (fxPct != null && Math.abs(fxPct) >= 0.5) avoid.push('환율이 크게 움직인 날은 외국인 수급을 환율과 따로 떼어 단정하지 마세요.');
    if (vixC && vixC.pct >= 10) avoid.push('공포지수가 급등한 하루만 보고 시장 방향을 단정하지 마세요.');
    if (nqC && Math.abs(nqC.pct) >= 2) avoid.push('미국 증시 움직임을 내 종목에 그대로 옮겨 보지 마세요.');
    // 같은 문구 제거, 항목은 최대 4개(핵심 순서 유지)
    avoid = avoid.filter(function (t, i) { return avoid.indexOf(t) === i; }).slice(0, 4);
    items = items.slice(0, 4);
    return { title: title, mood: story.lead, tone: down ? 'negative' : up ? 'positive' : 'neutral', items: items, avoid: avoid };
  }

  function buildStrategy(data, models, macro) {
    var facts = checkpointFacts_(data, models, macro), dateText = checkpointDate_(data);
    return '<div class="mt-strategy-panel mt-ant-guide mt-checkpoint-facts" id="mt-ant-guide">'
      + '<div class="mt-cp-head"><div class="mt-strategy-panel-title">오늘 투자 체크포인트</div>'
      + (dateText ? '<span class="mt-cp-date">' + escapeHtml(dateText) + '</span>' : '') + '</div>'
      + '<p class="mt-cp-sub">오늘 시장 흐름을 요약하고 현재 온도에 맞는 참고용 대응 방향을 함께 보여줍니다.</p>'
      + '<div class="mt-cp-body"><div class="mt-strategy-message mt-cp-call is-' + facts.tone + '">'
      + '<div class="mt-strategy-action">' + sentenceHtml_(facts.title) + '</div><p class="mt-ant-mood">' + sentenceHtml_(facts.mood) + '</p>'
      + '</div><div class="mt-cp-actions">'
      + '<div class="mt-cp-next"><h3>지금 할 것</h3><ol>' + facts.items.map(function (item) {
        return '<li><b>' + escapeHtml(item.label) + '</b><p class="mt-cp-evidence">' + (item.html ? item.evidence : escapeHtml(item.evidence)) + '</p>'
          + '<small>' + escapeHtml(item.date) + '</small><p class="mt-cp-check">' + escapeHtml(item.check) + '</p></li>';
      }).join('') + '</ol></div><div class="mt-cp-avoid mt-cp-next"><h3>지금 하지 말아야 할 것</h3><ol>' + facts.avoid.map(function (text) {
        return '<li><p class="mt-cp-check">' + escapeHtml(text) + '</p></li>';
      }).join('') + '</ol></div></div></div></div>';
  }

  function buildBriefingStrategy(data) {
    return '<div class="mt-section mt-card mt-briefing-strategy-card">'
      + '<div class="mt-briefing-strategy-grid mt-briefing-single">'
      + '<div data-market-checkpoint>' + buildStrategy(data) + '</div>'
      + '</div>'
      + '</div>';
  }

  // 2026-10-05 요청("대시보드에 있는 업종 로테이션을 시장 > 증시온도로 옮겨줘"): 홈에서 옮겨 왔다. 돈이 몰린 섹터 바로 아래에 둔다.
  // 같은 날 미국 탭은 뺐다("미국 업종 로테이션은 의미가 없어 삭제하자. 시총 1~10위가 다 해먹는 시장"). 국내만 남는다.
  function buildRotationSlot_() {
    return '<div class="mt-rot-wrap"><section class="home-sector-rotation" data-home-sector-rotation hidden aria-label="업종 로테이션"></section></div>';
  }

  function mountRotation_(container) {
    var host = container.querySelector('[data-home-sector-rotation]');
    if (!host || host.getAttribute('data-rotation-mounted')) return;
    host.setAttribute('data-rotation-mounted', '1');
    function mount() { if (global.HomeSectorRotation) global.HomeSectorRotation.mount(host); }
    if (global.HomeSectorRotation) { mount(); return; }
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/home-sector-rotation.js?v=20261005-us-v1';
    script.onload = mount;
    document.head.appendChild(script);
  }

  function buildTemperatureActions(data) {
    return '<div class="mt-temperature-actions">'
      + '<section class="mt-section-block mt-temperature-money-flow" id="mt-money-flow">'
      + '<div data-sector-flow data-sf-date="' + escapeHtml(checkpointDate_(data)) + '"><div class="mt-hint">오늘 자금 흐름을 불러오는 중입니다.</div></div>'
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
  // 시장판은 순위별 최대 40종목뿐이다. 전종목 스캔으로 주요 종목을 선별하고,
  // 공유 시장판에 포함된 종목의 시세만 보충한다. 종목별 추가 요청은 하지 않는다.
  var ACTIVE_STOCK_BOARD_URL = 'https://goodbyestar.cloud/market-board?market=domestic&limit=40';
  // 2026-10-02 사용자 요청("죽은 종목을 제외한 모든 종목은 다 표기, 움직임이 거의 없거나 시가총액이
  // 낮은 애들 빼고"): 예전엔 거래대금 50억 이상·섹터 합계 500억 이상만 보여 대부분이 빠졌다. 이제는
  // 거래가 거의 없거나(10억 미만), 가격도 거래도 잠잠하거나(등락 0.5% 미만 + 50억 미만), 시총이 알려진 종목 중
  // 1,000억 미만인 종목만 뺀다. 시총은 시총 풀에 있는 종목만 알 수 있어 나머지는 거래대금으로만 판단한다.
  var ACTIVE_STOCK_MIN_AMOUNT = 1000000000;
  var ACTIVE_STOCK_QUIET_RATE = 0.5;
  var ACTIVE_STOCK_QUIET_AMOUNT = 5000000000;
  var ACTIVE_STOCK_MIN_CAP = 100000000000;
  var ACTIVE_STOCK_MIN_VOLUME = 10000;
  var activeCaps_ = {};
  // WICS 편입 전 신규상장은 확인된 주사업으로만 대분류를 보강한다(WICS 공식 분류 아님).
  var DOMESTIC_SECTOR_FALLBACKS = { '468670': { sector: '산업재', market: 'KOSDAQ' } };
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
  function activeStockRows_(scan, wicsMap) {
    var board = scan && scan.data && Array.isArray(scan.data.rows);
    var etfNames = {};
    (global.KRX_ETF_NAMES || []).forEach(function (name) { etfNames[name] = true; });
    return (board ? scan.data.rows : universeRows_(scan, {})).filter(function (row) {
      return isFinite(row.price) && row.price > 0 && isFinite(row.changeRate)
        && isFinite(row.tradingValue) && row.tradingValue >= ACTIVE_STOCK_MIN_AMOUNT
        && !(Math.abs(row.changeRate) < ACTIVE_STOCK_QUIET_RATE && row.tradingValue < ACTIVE_STOCK_QUIET_AMOUNT)
        && !(activeCaps_[row.code] > 0 && activeCaps_[row.code] < ACTIVE_STOCK_MIN_CAP)
        && (!board || (isFinite(row.volume) && row.volume >= ACTIVE_STOCK_MIN_VOLUME))
        && !etfNames[row.name] && !/(?:ETF|ETN|스팩|SPAC)/i.test(row.name);
    }).map(function (row) {
      var classification = (wicsMap || {})[row.code] || DOMESTIC_SECTOR_FALLBACKS[row.code] || {};
      // 2026-10-02 사용자 요청("대분류가 너무 크다, 쪼개"): IT·산업재 같은 10개 대분류 대신 WICS 중분류
      // (반도체와반도체장비·소프트웨어 등)로 카드를 나눈다. 중분류가 없는 보강 값(신규상장 등)은 대분류를 쓴다.
      row.sector = String(classification.industry || classification.sector || industryThemeName_(row) || '');
      row.market = row.market || classification.market || '';
      return row;
    }).filter(function (row) { return row.sector && row.sector !== '기타' && row.sector !== '미분류'; });
  }

  function activeStockGroups_(scan, wicsMap) {
    var rows = activeStockRows_(scan, wicsMap);
    var bySector = {};
    rows.forEach(function (row) {
      if (!bySector[row.sector]) bySector[row.sector] = [];
      bySector[row.sector].push(row);
    });
    return Object.keys(bySector).map(function (sector) {
      var members = bySector[sector].sort(function (a, b) { return b.tradingValue - a.tradingValue; });
      return { sector: sector, rows: members, total: members.reduce(function (sum, row) { return sum + row.tradingValue; }, 0) };
    }).filter(function (group) { return group.rows.length >= 1; })
      .sort(function (a, b) { return b.total - a.total || a.sector.localeCompare(b.sector, 'ko'); });
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

  // 섹터는 전체 폭으로 세로로 쌓고, 각 섹터 안의 종목은 짧은 한 줄로 비교한다.
  function allStockCardsHtml_(items, byCode, summaries) {
    var groups = {};
    (items || []).forEach(function (item) {
      var quote = byCode[item.code] || {};
      var key = (item.kind || '') + '|' + (item.sector || '기타');
      if (!groups[key]) groups[key] = [];
      groups[key].push({ item: item, quote: quote });
    });
    function cardHtml(key) {
      var sector = key.slice(key.indexOf('|') + 1);
      var kind = key.slice(0, key.indexOf('|'));
      var rows = groups[key].map(function (entry) {
        var quote = entry.quote && Object.keys(entry.quote).length ? entry.quote : entry.item;
        var rate = Number(quote.changeRate);
        var direction = isFinite(rate) && rate > 0 ? 'sector-up' : isFinite(rate) && rate < 0 ? 'sector-down' : 'sector-flat';
        var rateText = isFinite(rate) ? (rate > 0 ? '▲' : rate < 0 ? '▼' : '—') + Math.abs(rate).toFixed(2) + '%' : '-';
        var priceText = isFinite(Number(quote.price)) && Number(quote.price) > 0 ? universeNumber_(quote.price) + '원' : '시세 확인 중';
        var market = quote.market === 'KOSPI' || quote.market === 'KOSDAQ' ? quote.market : '';
        // 내 카테고리가 있을 때 카테고리에 없는 종목(편입 후보)에만 ＋를 단다.
        var adopt = kind === 'cand' ? '<span class="mt-pick-add" role="button" tabindex="0" title="내 카테고리에 편입" data-adopt-code="' + escapeHtml(entry.item.code) + '" data-adopt-name="' + escapeHtml(entry.item.name) + '" data-adopt-market="' + escapeHtml(market) + '">＋</span>' : '';
        return '<button type="button" class="sector-row mt-all-stock-row ' + direction + '" data-all-stock-code="' + escapeHtml(entry.item.code) + '" data-all-stock-name="' + escapeHtml(entry.item.name) + '" aria-label="' + escapeHtml(entry.item.name) + ' 실시간 시세 보기">'
          + adopt
          + '<span class="sector-row-name"><span class="mt-all-stock-name" title="' + escapeHtml(entry.item.name) + '">' + escapeHtml(entry.item.name) + '</span></span>'
          + '<span><span class="sector-row-price">' + priceText + '</span><span class="sector-row-rate ' + direction + '">' + rateText + '</span>' + (market ? '<small class="mt-all-stock-market ' + market.toLowerCase() + '">' + market + '</small>' : '') + (quote.quoteBasis ? '<small class="mt-all-stock-quote-basis">' + escapeHtml(quote.quoteBasis) + '</small>' : '') + '</span>'
          + '</button>';
      }).join('');
      var summary = (summaries || {})[key];
      return '<section class="sector-card' + (kind ? ' is-' + kind : '') + '"><div class="sector-card-title">' + escapeHtml(sector) + ' <small>' + groups[key].length + '종목</small>'
        + (summary ? '<span class="mt-all-stock-sector-total" title="' + (summary.scanTotal ? '스캔 선별 종목의 거래대금 합계(장중 추가 종목 제외)' : '조회 종목의 거래대금 합계') + '">' + formatFlowAmount_(summary.total) + '</span>' : '') + '</div><div class="mt-all-stock-rows">' + rows + '</div></section>';
    }
    function byTotal(a, b) {
      var totals = summaries || {};
      return ((totals[b] || {}).total || 0) - ((totals[a] || {}).total || 0) || a.localeCompare(b, 'ko');
    }
    var keys = Object.keys(groups);
    var mine = keys.filter(function (key) { return key.indexOf('mine|') === 0; }).sort(byTotal);
    var cand = keys.filter(function (key) { return key.indexOf('cand|') === 0; }).sort(byTotal);
    var rest = keys.filter(function (key) { return key.indexOf('mine|') !== 0 && key.indexOf('cand|') !== 0; }).sort(byTotal);
    return mine.map(cardHtml).join('')
      + (cand.length ? '<div class="mt-all-stock-divider"><b>편입 후보</b> 내 카테고리에 없는 활성 종목입니다. ＋를 눌러 카테고리에 넣으면 모니터링됩니다.</div>' : '')
      + cand.map(cardHtml).join('')
      + rest.map(cardHtml).join('');
  }

  function requestAllStockSnapshot_() {
    if (allStockSnapshotCache_) return Promise.resolve(allStockSnapshotCache_);
    if (allStockSnapshotPromise_) return allStockSnapshotPromise_;
    allStockSnapshotPromise_ = Promise.all([
      fetchJson_(INVEST_SIGNAL_URL).catch(function () { return null; }),
      fetchJson_(ACTIVE_STOCK_BOARD_URL).then(activeStockBoardSnapshot_).catch(function () { return null; }),
      fetchJson_(GAS_TICKER_URL + '?bubble=1').then(function (body) { return universeCapByCode_((body || {}).data || {}); }).catch(function () { return {}; })
    ]).then(function (sources) {
      if (!sources[0] && !sources[1]) throw new Error('active stock sources unavailable');
      activeCaps_ = sources[2] || {};
      var snapshot = { scan: sources[0], board: sources[1] };
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
      + '</strong><span>거래대금 10억원 이상 · 움직임 없는 종목·시총 1,000억원 미만 제외</span><button type="button" data-all-stock-retry>다시 연결</button></div>';
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
    var categoryConfig = null;
    Promise.all([ensureKrxMap_().catch(function () { return {}; }), ensureWicsMap_().catch(function () { return {}; }), snapshotRequest,
      fetchSectorConfig_().catch(function () { return null; })]).then(function (results) {
      var sources = results[2];
      categoryConfig = results[3];
      var allGroups = sources.scan ? activeStockGroups_(sources.scan, results[1]) : [];
      if (allGroups.length) {
        var quotes = {};
        var boardRows = sources.board && sources.board.data && sources.board.data.rows || [];
        boardRows.forEach(function (row) {
          // 개장 전 거래량·거래대금 0 응답으로 전일 가격·등락률을 덮지 않는다.
          if (row.price > 0 && isFinite(row.changeRate) && row.volume > 0 && row.tradingValue > 0) quotes[row.code] = row;
        });
        var quoteCount = 0;
        var seenCodes = {};
        var groupsBySector = {};
        allGroups.forEach(function (group) {
          group.scanTotal = true;
          groupsBySector[group.sector] = group;
          group.rows.forEach(function (row) {
            seenCodes[row.code] = true;
            var quote = quotes[row.code];
            row.quoteBasis = quote ? '시세' : '스캔';
            if (!quote) return;
            row.price = quote.price;
            row.changeRate = quote.changeRate;
            row.market = quote.market || row.market;
            quoteCount += 1;
          });
        });
        var addedCount = 0;
        if (sources.board) {
          var additions = {};
          activeStockRows_(sources.board, results[1]).forEach(function (row) {
            if (seenCodes[row.code] || !groupsBySector[row.sector]) return;
            seenCodes[row.code] = true;
            row.quoteBasis = '시세';
            if (!additions[row.sector]) additions[row.sector] = [];
            additions[row.sector].push(row);
            addedCount += 1;
            quoteCount += 1;
          });
          Object.keys(additions).forEach(function (sector) {
            groupsBySector[sector].rows = additions[sector].sort(function (a, b) { return b.tradingValue - a.tradingValue; }).concat(groupsBySector[sector].rows);
          });
          // 스캔에 없던 새 섹터도 같은 섹터 합계·구성 종목 수 기준을 충족할 때만 추가한다.
          activeStockGroups_(sources.board, results[1]).forEach(function (group) {
            if (groupsBySector[group.sector]) return;
            group.rows.forEach(function (row) { row.quoteBasis = '시세'; });
            allGroups.push(group);
            addedCount += group.rows.length;
            quoteCount += group.rows.length;
          });
        }
        return { snapshot: sources.scan, groups: allGroups, quoteCount: quoteCount, addedCount: addedCount,
          quoteAt: quoteCount ? sources.board.data.scannedAt : '' };
      }
      return { snapshot: sources.board, groups: sources.board ? activeStockGroups_(sources.board, results[1]) : [], quoteCount: 0 };
    }).then(function (selection) {
      var snapshot = selection.snapshot;
      var allGroups = regroupByCategories_(selection.groups, categoryConfig);
      var isBoard = snapshot && snapshot.data && Array.isArray(snapshot.data.rows);
      var scannedAt = snapshot && snapshot.data && snapshot.data.scannedAt ? String(snapshot.data.scannedAt).replace('T', ' ') : '시각 확인 중';
      if (!isBoard && snapshot && snapshot.data && snapshot.data.scannedAt) {
        var scanTime = Date.parse(snapshot.data.scannedAt);
        if (isFinite(scanTime)) scannedAt = new Date(scanTime + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
      }
      var state = { query: '' };
      if (!allGroups.length) {
        renderAllStockRetry_(panel, true);
        return;
      }

      function filteredGroups() {
        var query = state.query.toLowerCase();
        if (!query) return allGroups;
        return allGroups.map(function (group) {
          return { sector: group.sector, kind: group.kind, total: group.total, scanTotal: group.scanTotal, rows: group.rows.filter(function (item) {
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
            return { code: item.code, name: item.name, sector: group.sector, kind: group.kind, price: item.price, changeRate: item.changeRate, market: item.market, quoteBasis: item.quoteBasis };
          }));
        }, []);
      }

      function render() {
        var groups = filteredGroups();
        var visible = visibleItems_(groups);
        var total = groups.reduce(function (sum, group) { return sum + group.rows.length; }, 0);
        var summaries = {};
        groups.forEach(function (group) { summaries[(group.kind || '') + '|' + group.sector] = group; });
        panel.innerHTML = '<section class="mt-all-stock-browser">'
          + '<div class="mt-all-stock-head"><div><strong>주요 섹터 카드</strong><span>' + (isBoard ? '거래가 활발한 섹터' : '최근 거래일에 활발했던 주요 섹터') + '</span></div><span data-all-stock-count>' + total.toLocaleString('ko-KR') + '종목 · ' + escapeHtml(scannedAt) + ' 기준' + (isBoard ? '' : ' · 일일 스캔') + '</span></div>'
          + '<div class="mt-all-stock-toolbar"><label><span class="mt-all-stock-search-label">종목 검색</span><input type="search" data-all-stock-search placeholder="종목명 또는 코드" value="' + escapeHtml(state.query) + '" autocomplete="off"></label><button type="button" data-all-stock-refresh>목록 새로고침</button><button type="button" data-theme-picker-open>＋ 키움 테마로 카테고리 추가</button></div>'
          + '<p class="mt-all-stock-legend"><b>' + (isBoard ? '현재가' : '최근 거래일 가격·등락률') + '</b> · <b class="mt-legend-up">▲ 상승</b> · <b class="mt-legend-down">▼ 하락</b> · 종목 거래대금 10억원 이상' + (isBoard ? ' · 거래량 1만 주 이상' : ' · 스캔값은 거래량 미제공') + '<br>움직임 없는 종목(등락 0.5% 미만·거래대금 50억원 미만)과 알려진 시총 1,000억원 미만 종목 제외 · 나머지 모두 표시 · ETF·ETN·스팩 제외'
          + (!isBoard ? '<br>스캔: 선별 기준시각의 가격 · 시세: 시장판 조회값' + (selection.quoteCount ? ' (' + escapeHtml(selection.quoteAt) + ' 기준 · ' + selection.quoteCount + '종목)' : '') : '')
          + (selection.addedCount ? '<br>장중 조건을 충족한 ' + selection.addedCount + '종목 추가 · 기존 섹터 금액은 스캔 선별 종목 합계(추가 종목 제외)' : '') + '</p>'
          + '<div class="sector-cards-grid mt-all-stock-sector-grid" data-all-stock-grid>' + (visible.length ? allStockCardsHtml_(visible, {}, summaries) : '<div class="mt-hint">주요 섹터 내에 찾는 종목이 없습니다.</div>') + '</div>'
          + '<div class="mt-all-stock-summary">' + groups.length + '개 섹터 · ' + total.toLocaleString('ko-KR') + '종목 표시</div>'
          + '</section>';
        var input = panel.querySelector('[data-all-stock-search]');
        var grid = panel.querySelector('[data-all-stock-grid]');
        var composing = false;
        function updateSearchResults() {
          // 입력칸을 다시 만들면 IME 조합·커서·모바일 키보드가 끊긴다. 결과만 갱신한다.
          if (state.query === input.value) return;
          state.query = input.value;
          var nextGroups = filteredGroups();
          var nextItems = visibleItems_(nextGroups);
          var nextSummaries = {};
          nextGroups.forEach(function (group) { nextSummaries[(group.kind || '') + '|' + group.sector] = group; });
          grid.innerHTML = nextItems.length ? allStockCardsHtml_(nextItems, {}, nextSummaries) : '<div class="mt-hint">주요 섹터 내에 찾는 종목이 없습니다.</div>';
          panel.querySelector('[data-all-stock-count]').textContent = nextItems.length.toLocaleString('ko-KR') + '종목 · ' + scannedAt + ' 기준' + (isBoard ? '' : ' · 일일 스캔');
          panel.querySelector('.mt-all-stock-summary').textContent = nextGroups.length + '개 섹터 · ' + nextItems.length.toLocaleString('ko-KR') + '종목 표시';
          wireCards();
        }
        input.addEventListener('compositionstart', function () { composing = true; });
        input.addEventListener('compositionend', function () {
          composing = false;
          updateSearchResults();
        });
        input.addEventListener('input', function (event) {
          if (composing || event.isComposing) return;
          updateSearchResults();
        });
        var refresh = panel.querySelector('[data-all-stock-refresh]');
        if (refresh) refresh.addEventListener('click', function () {
          // 사용자가 명시적으로 새로고침을 누를 때만 보관한 스냅샷을 비운다.
          // 검색은 같은 응답을 써서 종목 수와 무관하게 요청을 중복하지 않는다.
          allStockSnapshotCache_ = null;
          panel.__allStockBrowser = false;
          loadAllStocksPanel(panel);
        });
        function wireCards() {
          grid.querySelectorAll('[data-all-stock-code]').forEach(function (card) {
            card.addEventListener('click', function (event) {
              var add = event.target.closest && event.target.closest('.mt-pick-add');
              if (add) {
                event.preventDefault();
                event.stopPropagation();
                openAdoptChooser_(panel, { code: add.getAttribute('data-adopt-code'), name: add.getAttribute('data-adopt-name'),
                  market: add.getAttribute('data-adopt-market') });
                return;
              }
              openStock({ code: card.getAttribute('data-all-stock-code'), name: card.getAttribute('data-all-stock-name') });
            });
          });
        }
        wireCards();
        var pickerButton = panel.querySelector('[data-theme-picker-open]');
        if (pickerButton) pickerButton.addEventListener('click', function () { openThemePicker_(panel); });
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
    { key: 'marketcap', label: '시총비례 히트맵' },
    { key: 'active', label: '활성 종목' }
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
      + '<div class="mt-view-panel" data-view-panel="active"' + (initialView === 'active' ? '' : ' hidden') + '></div>'
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
            '<option value=""' + (stock.market ? '' : ' selected') + '>-</option>' +
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
      var html = SD.renderCardsHtml(sectorMap, krxMap, byCode, isStocksView());
      var cardState = config.customized
        ? (config.localOnly ? '편집됨 · 이 브라우저에 저장됨' : '편집됨 · Google 계정에 저장됨')
        : '편집 대기 · 기본 카드';
      var cardStateClass = config.customized ? ' is-edited' : ' is-pending';
      var toolbar = '<div class="mt-sector-toolbar"><span class="mt-sector-config-status' + cardStateClass + '">' + escapeHtml(cardState) + '</span>' +
        '<span class="mt-card-realtime-status" data-card-realtime-status>실시간 연결 중</span>' +
        '<button type="button" data-theme-picker-open>＋ 키움 테마로 추가</button>' +
        '<button type="button" data-sector-editor-open>카테고리·종목 편집</button></div>';
      panel.innerHTML = toolbar + (html ? '<div class="sector-cards-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>');
      // 2026-08-20: 카드 보기는 이 최초 GAS 배치 조회 이후로 갱신이 없었다 - 실시간 체결가
      // WebSocket(SD.startCardRealtimeQuotes)을 구독해 가격·등락률을 계속 최신으로 유지한다.
      if (SD.startCardRealtimeQuotes) SD.startCardRealtimeQuotes(panel, codes);
      function wireEditor() {
        var pickerButton = panel.querySelector('[data-theme-picker-open]');
        if (pickerButton) pickerButton.addEventListener('click', function () { openThemePicker_(panel); });
        decorateCategoryCards_(panel, sectorMap);
        var editButton = panel.querySelector('[data-sector-editor-open]');
        if (editButton) editButton.addEventListener('click', function () {
          renderSectorEditor_(panel, sectorMap, config.revision, {
            cancel: function () { panel.__mtLoaded = false; loadSectorCardsPanel_(panel); },
            saved: function () { refreshAfterCategoryChange_(); }
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

  function showSectorCardsLoadError_(panel) {
    panel.__mtLoaded = false;
    panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다. <button type="button" class="ui-btn ui-btn-secondary" data-sector-cards-retry>다시 불러오기</button></div>';
    var retry = panel.querySelector('[data-sector-cards-retry]');
    if (retry) retry.addEventListener('click', function () { loadSectorCardsPanel_(panel); });
  }

  function loadSectorCardsPanel_(panel) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    var SD = global.SectorDashboard;
    if (SD) {
      panel.innerHTML = '<div class="mt-hint"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>종목 카드 불러오는 중...</div>';
      fetchSectorConfig_()
        .then(function (config) { return renderCardsPanelFromConfig_(panel, SD, config); })
        .catch(function () { showSectorCardsLoadError_(panel); });
      return;
    }
    var sectorMap = global.SECTOR_MAP;
    if (!SD || !sectorMap) {
      showSectorCardsLoadError_(panel);
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
      var html = SD.renderCardsHtml(sectorMap, krxMap, byCode, isStocksView());
      panel.innerHTML = html ? '<div class="mt-sector-toolbar"><span>기본 카드</span><span class="mt-card-realtime-status" data-card-realtime-status>실시간 연결 중</span></div><div class="sector-cards-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>';
      if (SD.startCardRealtimeQuotes) SD.startCardRealtimeQuotes(panel, codes);
      if (SD.wireSectorCardSelection) SD.wireSectorCardSelection(panel, sectorMap, krxMap, byCode);
    }).catch(function () {
      showSectorCardsLoadError_(panel);
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
    // 카드·히트맵·시총비례는 내 카테고리 기준이고, 활성 종목은 내 카테고리별로 묶은 뒤 편입 후보를 따로 보여 준다.
    if (view === 'cards') loadSectorCardsPanel_(panel);
    else if (view === 'heatmap') loadCategoryPanel_(panel, function (p, config, rows) {
      var SD = global.SectorDashboard;
      if (!SD) throw new Error('no dashboard');
      return renderCategoryHeatmap_(p, SD, config, rows);
    }, '히트맵');
    else if (view === 'marketcap') loadCategoryPanel_(panel, function (p, config, rows) { return renderCategoryMarketcap_(p, config, rows); }, '시총비례 히트맵');
    else if (view === 'active') loadCardsPanel(panel);
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

  // 2026-10-04 리서치 브리핑 레이아웃: 숫자를 한 줄로 먼저 보여 주는 요약 스트립. 값은 서버가 이미 내려준 data만 읽고 새로 계산하지 않는다.
  // 2026-10-05 사용자 요청("시장온도 옆에 계기판 조그맣게, 돈도 밑에 막대 바로 넣고, 그 밑에 중복된 내용은 다 삭제"):
  // 시장온도 칸에 작은 반원 계기판, 돈·가격·위험 칸에 0~100 막대를 넣고, 아래 요약 카드의 점수·계기판·축 막대는 뺐다.
  function axisTone_(key, pct) {
    if (key === 'risk') return pct >= 65 ? 'mt-axis-risk-high' : pct >= 35 ? 'mt-axis-risk-mid' : 'mt-axis-risk-low';
    return pct >= 65 ? 'mt-axis-good' : pct >= 35 ? 'mt-axis-mid' : 'mt-axis-bad';
  }

  // 큰 계기판(buildScoreGauge)과 같은 눈금·구간색을 작게 그린다. 숫자는 옆 KPI 숫자가 맡는다.
  function buildMiniGauge_(value) {
    var pct = Math.max(0, Math.min(100, value));
    var cx = 54, cy = 52, radius = 46, tickCount = 21, ticks = '';
    for (var i = 0; i < tickCount; i++) {
      var tickValue = (i / (tickCount - 1)) * 100;
      var angle = 180 - (180 * i / (tickCount - 1));
      var outer = polarPoint_(cx, cy, radius, angle);
      var inner = polarPoint_(cx, cy, radius - (i % 5 === 0 ? 11 : 7), angle);
      ticks += '<line class="mt-gauge-seg' + (tickValue <= pct ? ' is-lit' : '') + '" stroke="' + (tickValue <= pct ? zoneColor_(tickValue) : '#d0d5dd') + '"'
        + ' x1="' + inner.x.toFixed(2) + '" y1="' + inner.y.toFixed(2) + '" x2="' + outer.x.toFixed(2) + '" y2="' + outer.y.toFixed(2) + '"></line>';
    }
    var needle = polarPoint_(cx, cy, radius - 16, 180 - 180 * pct / 100);
    return '<svg class="mt-kpi-gauge" viewBox="0 0 108 58" width="108" height="58" aria-hidden="true">' + ticks
      + '<line class="mt-gauge-needle" x1="' + cx + '" y1="' + cy + '" x2="' + needle.x.toFixed(2) + '" y2="' + needle.y.toFixed(2) + '"></line>'
      + '<circle class="mt-gauge-hub" cx="' + cx + '" cy="' + cy + '" r="4"></circle></svg>';
  }

  function buildKpiStrip_(data) {
    var value = score100(data);
    var grade = data.grade3 || data.grade || { emoji: '', label: '' };
    var axes = data.axes || {};
    var delta = data.scoreDelta != null ? Number(data.scoreDelta) : NaN;
    function cell(label, num, sub, cls, unit, extra, attrs) {
      return '<div class="mt-kpi' + (attrs && attrs.cls ? ' ' + attrs.cls : '') + '"' + (attrs && attrs.title ? ' title="' + escapeHtml(attrs.title) + '"' : '') + '>'
        + '<span class="mt-kpi-label">' + escapeHtml(label) + '</span>'
        + '<b class="mt-kpi-num">' + escapeHtml(num) + (unit ? '<small>' + escapeHtml(unit) + '</small>' : '') + '</b>'
        + '<em class="mt-kpi-sub ' + (cls || '') + '">' + escapeHtml(sub || '') + '</em>' + (extra || '') + '</div>';
    }
    function axisCell(key, label) {
      var axis = axes[key];
      var v = Number(axis && axis.value);
      if (!isFinite(v)) return '';
      var pct = Math.max(0, Math.min(100, v));
      var reason = String(axisReason_(key, data) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      var bar = '<span class="mt-kpi-bar" aria-hidden="true"><i class="' + axisTone_(key, pct) + '" style="width:' + pct.toFixed(0) + '%"></i></span>';
      return cell(label, v.toFixed(0), axisWord(key, v) + (key === 'risk' ? ' · 높을수록 위험' : ''), '', '점', bar, { cls: 'mt-kpi--axis', title: reason });
    }
    var deltaText = !isFinite(delta) ? '기록 시작' : delta === 0 ? '변화 없음' : (delta > 0 ? '▲ +' : '▼ ') + delta.toFixed(0) + '점';
    var deltaCls = !isFinite(delta) || delta === 0 ? '' : delta > 0 ? 'mt-val-pos' : 'mt-val-neg';
    var tempCell = '<div class="mt-kpi mt-kpi--temp"><div class="mt-kpi-temp-copy">'
      + '<span class="mt-kpi-label">시장온도</span>'
      + '<b class="mt-kpi-num">' + escapeHtml(value.toFixed(0)) + '<small>/ 100점</small></b>'
      + '<em class="mt-kpi-sub mt-kpi-tone-' + escapeHtml((grade.tone || crowdTone(data) || 'neutral')) + '">' + escapeHtml(grade.label || '') + ' · 100점 만점</em>'
      + '</div>' + buildMiniGauge_(value) + '</div>';
    return '<div class="mt-kpi-strip" role="group" aria-label="시장 핵심 요약">'
      + tempCell
      + axisCell('money', '수급(방향)')
      + axisCell('price', '가격')
      + axisCell('risk', '위험도')
      + cell('전일 대비', isFinite(delta) ? (delta > 0 ? '+' : '') + delta.toFixed(0) : '-', deltaText + (data.scoreDeltaFrom ? ' · ' + asOfText_(data.scoreDeltaFrom) : ''), deltaCls, isFinite(delta) ? '점' : '', '',
        !isFinite(delta) ? { title: '오늘부터 일별 기록을 시작했습니다.' } : null)
      + '</div>';
  }

  function buildPageHead_(data) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(String(data.updatedAt || ''));
    var dateText = m ? m[1] + '.' + m[2] + '.' + m[3] : '';
    return '<div class="mt-page-head"><span>' + escapeHtml(dateText) + (dateText ? ' · ' : '') + '시장 자료 기준</span>'
      + (m && m[4] ? '<span class="nt-stamp">' + escapeHtml((window.NineTime && window.NineTime.updated(data.updatedAt)) || ('마지막 업데이트 ' + m[4])) + '</span>' : '') + '</div>';
  }

  // 대표 지수(코스피·코스닥) 흐름은 시장지표 페이지가 따로 갖고 있다(증시온도와 데이터·무게를 섞지 않는다는 2026-09-06 결정).
  // 이 페이지 맨 아래에는 그리로 가는 안내만 둔다.
  function buildIndexFlow_() {
    return '<section class="mt-section-block mt-index-flow">'
      + '<div class="mt-section-head"><h2>대표 지수 흐름</h2><p>코스피·코스닥의 현재 지수와 일봉 흐름은 <a href="/pages/kospi-futures">시장지표</a>에서 확인합니다.</p></div>'
      + '</section>';
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
      buildPageHead_(data),
      '<div class="mt-live-status" data-mt-live-status role="status">자동 갱신 준비 중</div>',
      // 2026-10-23: 새벽에 접속해 5초 안에 보는 '다음 거래일 전망'(미국장 요약 → 한국장 영향 → 전망, 야간선물 포함)을 페이지 맨 위로 올렸다.
      '<div class="mt-front-tools mt-dawn"><section class="mt-front-extra"><h3 class="mt-extra-heading" data-mt-tomorrow-heading>시장 브리핑 · ' + nextKospiDay_().label + ' 출발</h3>' + buildTomorrowCard_() + '</section></div>',
      '<div class="mt-summary-trend-row mt-front-page">' + buildMarketIntro_(data) + buildSummaryCard(data) + '<div class="mt-card mt-extras-col" data-market-extras></div>' + buildIndicatorHistoryShell_() + '</div>',
      '<div class="mt-hot-strip" data-hot-theme hidden></div>',
      '<div class="mt-front-tools"><section class="mt-front-extra">' + buildBriefingStrategy(data) + '</section></div>',
      buildTemperatureActions(data),
      buildRotationSlot_(),
      buildIndexFlow_(),
      '<p class="mt-page-disclaimer">참고용 일반 시황 코멘트이며 투자 권유가 아닙니다.</p>',
    ];

    return ''
      + '<div class="mt-wrap mt-tone-' + escapeHtml(tone) + '">'
      + sections.join('')
      + (data.updatedAt ? '<div class="mt-updated">' + escapeHtml((window.NineTime && window.NineTime.updated(data.updatedAt)) || ('자료 기준 · ' + data.updatedAt)) + '</div>' : '')
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
    wireFlowChart_(container);
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
