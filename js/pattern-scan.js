/**
 * 차트 패턴 스캔 위젯
 * 저점상승형 / 224 장기이평 응축기 / 쌍바닥 / 역헤드앤숄더 / 박스권하단 / 눌림목 6개 탭 -> 종목 리스트 -> 클릭 시 캔들차트 + 패턴선.
 *
 * 리스트는 GAS가 하루 1회 미리 스캔해둔 결과(?patternScan=1)를 그대로 보여준다(가벼움).
 * 클릭한 종목의 차트는 그 종목만 온디맨드로 다시 크롤링(?patternChart=1&code=&pattern=).
 *
 * 패턴별 참고 점수는 GAS에서 계산하며, 저점상승형은 구조 조건을 만족하면 점수와 무관하게 포함한다.
 * AI가 패턴을 임의로 판단하지 않고 수치 조건으로만 점수를 매긴다. 점수는 상세 화면에서만
 * 참고용으로 유지하고, 목록은 패턴 신호·가격 흐름·해석을 빠르게 훑는 스캐너 리스트로 보여준다.
 *
 * 캔들차트는 TradingView Lightweight Charts(오픈소스, CDN 지연 로드)로 렌더링한다 -
 * 가로 스크롤 없이 컨테이너에 자동으로 맞춰(autoSize) 한눈에 들어오게 하기 위함
 * (js/foreign-flow.js와 동일한 라이브러리/패턴).
 */
(function (global) {
  'use strict';
  var securityScriptUrl=document.currentScript && document.currentScript.src;

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#pattern-scan';
  var KIWOOM_VM_URL = 'https://goodbyestar.cloud';
  var PATTERN_SCRIPT_URL = document.currentScript && document.currentScript.src;
  var PATTERN_CORE_URL = PATTERN_SCRIPT_URL ? new URL('chart-core.js?v=20261018-marker-wording', PATTERN_SCRIPT_URL).href
    : 'https://goodbyestarwars.github.io/tistory-ticker/js/chart-core.js?v=20261013-rounded-labels1';
  var SCAN_PERFORMANCE_PUBLIC_URL = KIWOOM_VM_URL + '/scan-performance-public';
  var FETCH_TIMEOUT_MS = 15000;
  // 목록은 VM에서 캐시 파일 서빙이라 이 안에 안 들어오면 GAS 폴백이 낫다.
  var PATTERN_SCAN_VM_TIMEOUT_MS = 8000;

  // GAS getPatternChart()가 상세 클릭 시 "재판정"까지 해주는 패턴들. 이 5개는 GAS가
  // detectXxx_()를 다시 돌려 detail을 만들어주므로 GAS를 거쳐야 한다.
  // 나머지 탭(각도기·공파산·단기이평 돌파형·장기이평 응축기·시초갭)은 getPatternChart의
  // if 체인에 없어서 detail이 항상 null로 돌아오고, 프론트가 목록 스냅샷
  // (item.patternDetail)으로 채워 쓴다 - 즉 GAS 왕복이 일봉만 받아오는 순수 오버헤드다.
  // GAS는 운영 실측에서 28~30초씩 걸리므로(2026-09-03 API Probe) 그 탭들은 VM에서
  // 캔들만 직접 받는다.
  var GAS_REDETECTED_PATTERNS = {
    // 2026-10-04: risingLows는 60거래일 구조 판정으로 바꿔 VM 스냅샷(patternDetail)을 그대로 쓴다(GAS 20거래일 판정과 달라진다).
    // 2026-10-04: 쌍바닥·역헤드앤숄더·박스권 하단·눌림목도 VM 스냅샷(patternDetail)을 그대로 쓴다. 판정 기준을 개선하면서
    // GAS가 예전 기준으로 다시 판정해 차트 근거가 목록과 어긋나는 일이 없도록 GAS 재판정 경로를 쓰지 않는다.
  };
  var FETCH_RETRY_COUNT = 2;
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';

  var CHART_H = 420;

  var SUPPORT_COLOR = '#d24f45';
  var RESIST_COLOR = '#1261c4';
  var SIGNAL_COLOR = '#ec4899';
  // 실시간 시세 차트와 같은 가격 이동평균선 규격.
  var MA_COLORS = { ma5: '#d24f45', ma20: '#1261c4', ma60: '#0ca678' };
  var MA240_COLOR = '#8b5cf6';

  function ma224Color() {
    return document.documentElement.classList.contains('dark') ? '#f1f3f5' : '#000000';
  }

  function standardMovingAverageStudies() {
    return [
      { key: 'ma5', period: 5, label: '5일선', color: MA_COLORS.ma5 },
      { key: 'ma20', period: 20, label: '20일선', color: MA_COLORS.ma20 },
      { key: 'ma60', period: 60, label: '60일선', color: MA_COLORS.ma60 },
      { key: 'ma224', period: 224, label: '224일선', color: ma224Color() }
    ];
  }

  // js/foreign-flow.js와 동일한 주기·색상(사이트 전체 일관성) - 일목균형표 토글 전용.
  // 범례는 하늘색으로 표시하되 실제 선행스팬 경계선은 숨기고 구름 채움만 그린다.
  var ICHIMOKU_TENKAN_PERIOD = 9, ICHIMOKU_KIJUN_PERIOD = 26, ICHIMOKU_SENKOU_B_PERIOD = 52, ICHIMOKU_DISPLACEMENT = 26;
  var ICHIMOKU_COLORS = { senkouA: '#87ceeb', senkouB: '#87ceeb' };
  var ICHIMOKU_CLOUD_FILL = 'rgba(90,170,215,0.4)'; // 2026-08-22 요청: "더 진한 색으로" - 옅은 하늘색 0.24 알파에서 더 짙고 채도 높은 파랑 0.4 알파로 조정
  var ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)';

  // desc는 각 detect*_ 함수(pattern_detect.py)의 하드필터를 그대로 옮긴 것이다.
  // 점수는 후보 간 우선순위를 정하는 참고값이고, 아래 조건은 검색 포함 여부를 결정한다.
  // 2026-08-20: pattern_detect.is_excluded_stock()이 실제로 걸러내는 항목(ETF·스팩·ETN·
  // 거래정지·정리매매 외에도 관리종목·우선주·동전주(1,000원 미만))을 문구에도 그대로
  // 반영했다(사용자 요청: "위험한 것은 알아서 추가해" - 코드에 이미 있는데 문구에만 빠진
  // 항목을 채운 것, 새 필터를 만든 건 아님).
  var COMMON_SEARCH_DESC = '검색기 공통: 시가총액 3,000억원 이상 · ETF·스팩·ETN·관리종목·우선주·거래정지·정리매매·동전주(1,000원 미만) 제외';
  var TABS = [
    { key: 'ninepayLive', label: '01. 실시간 단타 검색기', desc: '공통: 09:00:00~13:59:59에 전일 확정 거래량의 70% 이상 유입을 관측해야 합니다. 80% 이상은 우선 평가합니다. A: 초기 급증 → 첫 1% 눌림 → 고점 재돌파. B: 직전 확정 일봉 2개의 저점 상승 + 당일 갭상승 → 첫 눌림에서 시가 지지 → 저점 대비 0.3% 반등. A OR B이며 종목·거래일당 신호는 한 번입니다.' },
    { key: 'openingGap', label: '갭상승', desc: '기존 야간 확정 일봉 갭상승 검색 결과입니다. 신규 실시간 A/B와 별도로 유지합니다.' },
    { key: 'risingLows', label: '저점상승 패턴', desc: '하락 뒤 바닥을 다지며 스윙 저점이 계단식으로 오르는 종목입니다. 최근 60거래일에서 저점이 3개 이상 이어서 1% 이상씩 높아지고(첫 저점 대비 +4%~+20%), 첫 저점과 마지막 저점이 15거래일 이상 떨어져 있어야 합니다. 계단 시작 뒤 첫 저점 아래로 내려간 적이 없고(하방이 막힘), 계단 시작 전에 첫 저점보다 12% 이상 높았던 구간이 있어야 하며(하락 뒤의 바닥), 현재가가 마지막 저점의 +10% 이내이고 최근 20거래일 +15% 이하(이미 오른 종목 제외)여야 합니다. 로보티즈처럼 하락 파동 속 3~4봉 반등은 제외합니다.' },
    { key: 'shortTermMaBreakout', label: '하락추세선 돌파', desc: '최근 30봉 내 의미 있는 두 스윙 고점을 연결한 하락 추세선을 오늘 종가가 처음 돌파한 종목입니다. 전일까지 가격은 추세선 아래 또는 인접한 위치에 머물러 있어야 하며, 현재 종가는 상승 중인 5일 이동평균선 위에 있어야 합니다. 이미 추세선을 크게 벗어난 종목은 제외해 막 돌파가 시작되는 구간을 포착합니다.' },
    { key: 'maCloudBreakout', label: '장기이평 응축·돌파', desc: '224일 장기 이동평균선과 일목균형표 구름대가 서로 가까워지며 가격이 응축된 종목을 찾습니다. 종가가 224일선 주변에서 지지받으면서 구름 상단 돌파를 준비하거나, 최근 1~3거래일 내 구름 상단과 장기이평선을 종가 기준으로 새롭게 돌파한 종목도 포함합니다. 이미 구름대와 장기이평선에서 크게 벗어나 상승이 진행된 종목은 제외합니다.' },
    { key: 'doubleBottom', label: '쌍바닥 패턴', desc: '최근 120봉에서 10~45봉 간격으로 형성된 두 스윙 저점의 가격 차이가 3% 이내인 쌍바닥 후보를 찾습니다. 두 바닥 사이에는 더 낮은 저점이 없어야 하며, 첫 바닥 이후 넥라인까지 최소 8% 이상의 반등이 있어야 합니다. 두 번째 바닥에서 매도 거래량이 감소하고 저점이 유지된 뒤, 넥라인 방향으로 회복하거나 재돌파를 준비하는 종목을 선별합니다.' },
    { key: 'invHeadShoulders', label: '역헤드앤숄더 패턴', desc: '최근 90봉에서 왼쪽 어깨-머리-오른쪽 어깨가 형성된 역헤드앤숄더 후보를 찾습니다. 머리는 양 어깨보다 최소 2% 낮고, 양 어깨 가격 차이는 4% 이내여야 합니다. 오른쪽 어깨 이후 머리 저점이 훼손되지 않은 상태에서 넥라인에 접근하거나 최근 종가 기준으로 새롭게 돌파한 종목을 선별하며, 넥라인 접근·돌파 시 거래량 증가를 높게 평가합니다.' },
    { key: 'boxRangeLow', label: '박스권 하단 반등', desc: '최근 20봉 종가 박스폭((상단-하단)/하단)이 5% 이상 10% 이하로 제한되고 5일선과 20일선이 서로 가까워지는 횡보 구간에서, 현재 가격이 박스 하단 35% 영역에 위치한 종목을 찾습니다. RSI와 거래량이 과열·침체되지 않고, 장기 하락이 아닌 상태에서 박스 하단 지지 또는 반등이 확인되는 종목을 우선 선별합니다.' },
    { key: 'pullback', label: '이동평균 눌림목', desc: '최근 강한 상승이 발생한 뒤 고점 대비 5~15% 조정받은 종목 중, 현재 가격이 20일선 또는 240일 장기이평선 부근에서 거래량 감소와 함께 지지받는 눌림 구간을 찾습니다. 선행 상승에는 거래량이 동반되고 조정 과정에서는 거래량이 줄어드는 건강한 눌림을 우선하며, 이평 부근에서 반등이 확인된 종목을 높게 평가합니다.' },
    { key: 'firstPullbackBreakout', label: '첫 눌림목 재돌파', desc: '일봉 기준. 상승 중인 20일선이 60일선 위에 있고, 거래량 1.5배 이상으로 20일 고가를 돌파한 뒤 첫 2~8봉 조정에서 거래량이 상승 구간의 80% 이하로 줄어든 종목을 찾습니다. 고점 대비 2~12% 조정 후 최근 3봉 고가를 양봉 종가로 재돌파하고, 거래량이 돌파 전 20봉 평균의 1.2배·조정 평균의 1.5배 이상이어야 합니다. 재돌파 가격보다 3% 넘게 오른 종목과 이미 재돌파한 뒤의 반복 신호는 제외합니다. 장 마감 배치 결과이며 눌림 저점 이탈 여부를 함께 확인하세요.' },
    // 2026-08-22: "시초 갭상승" 탭 삭제 요청 - 백엔드 detect_opening_gap/GAS는 그대로 두고
    // (다른 데서 재사용 가능성 대비, 되돌리기 쉽게) 화면 탭 목록에서만 제외했다.
    { key: 'angleMomentum', label: '이평선 기울기 전환', desc: '전형가 기준 5·10·20일 이동평균선의 기울기를 주가 수준과 무관한 퍼센트 변화율로 정규화해 계산합니다. 단기 이동평균이 상승 전환하고 중·장기 이동평균의 하락 기울기가 함께 개선되는 구간 중, 단기 기울기 변화가 최근 20일 평소 수준보다 강하게 확대되는 순간을 포착합니다. 거래량 급증 이후가 아니라 이동평균 곡률이 먼저 꺾이는 초기 변화를 찾는 실험적 검색기입니다.' },
    // 2026-08-20: "역매공파·공구리·오돌이" 같은 용어를 지워달라는 요청 - 특정 단타 기법의
    // 고유 용어라 출처가 드러나는 걸 원하지 않는다고 함. 조건 로직(숫자·판정 기준)은 그대로
    // 두고 설명 문구만 용어 없이 풀어썼다(공구리->횡보, 오돌이 표현 삭제).
    { key: 'gongpasan', label: '급락 후 첫 눌림목', desc: '최근 160일 고점 대비 25% 이상 하락한 뒤 40일 안팎의 바닥 횡보와 대량거래 매집 흔적이 나타난 종목을 추적합니다. 이후 직전 5봉 고가와 5일선을 강한 양봉으로 돌파한 뒤, 가격이 처음으로 20일선까지 눌렸을 때 거래량이 감소하고 종가 기준 지지가 확인되는 첫 눌림 구간을 매매 후보로 선별합니다. 돌파봉 자체가 아니라 돌파 후 첫 20일선 지지가 핵심입니다.' },
    // 2026-09-04: 이 탭만 장중 스냅샷이다. 나머지는 전부 장 마감 뒤 일봉 배치라
    // 스캔 시각이 다르고, 그래서 목록 위 안내도 이 탭에서는 따로 표시한다.
    { key: 'volumeBreakout', label: '장중 거래량 급증', desc: '한 검색기에서 세 가지를 함께 봅니다. ① 장중 30초마다 거래량 순위를 읽어 최근 3분 거래량이 전일의 3% 이상(3분 환산)인데 아직 많이 오르지 않은 초기 급증, ② 실시간 매집 의심: 20일 평균 대비 상대거래량(RVOL) 2배 이상·누적 거래대금 30억원 이상이면서 장중 가격 범위 안 위치가 높고, 거래량 급증 5분봉 뒤 가격을 지키는 종목(급등 뒤 긴 윗꼬리·상승분 반납은 분배 위험으로 감점·제외), ③ 기존 매집봉 재상승: 최근 15거래일 안 거래량 20일 평균 2.5배 이상 양봉(매집봉) 뒤 거래량이 줄고 가격을 지키다 매집봉 고점을 거래량 증가와 함께 재돌파하는 종목. 같은 종목이 여러 조건을 채우면 한 행에 신호를 함께 표시합니다.' }
  ];


  // 2026-10-15 검색기 설명 개편: 위 TABS.desc(패턴 조건 수치)는 pattern_detect.py 하드필터를 옮긴 그대로 두고, 검색 목적·포착 상태·진입 확인·
  // 무효 조건·스캔 기준을 TAB_INFO로 나눠 목록이 0건이어도 항상 보이게 한다. 상태 이름은 patternDetail.status 값과 같다.
  var TRACK_RULE = '포착가 대비 장중 +5% 터치 시 돌파 성공, 5일선 종가 이탈 시 돌파 실패(시장 급락일은 판정 보류), 20거래일 안에 결론이 없으면 기간 만료로 추적합니다.';
  var ENTRY_NOTE = ' 검색 결과는 패턴 후보이며 매수 신호가 아닙니다. 실제 매수 시점은 호가·체결·잔고를 따로 확인해 판단하세요.';
  var BASIS_DAILY = '일봉 확정 스캔. 평일 20:10(KST)에 시작해 전종목 판정과 저장이 끝난 시각을 스캔 시각으로 표시하며, 기준 봉은 그 거래일 종가입니다.';
  var TAB_INFO = {
    risingLows: {
      purpose: '하락 뒤 바닥에서 저점이 계단식으로 높아지는 종목을 찾습니다.',
      state: '형성 중(저항 돌파 전). 이미 저항을 돌파한 종목은 제외됩니다.',
      entry: '직전 저항선을 종가로 돌파하고 거래량이 붙는지 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '계단 시작 첫 저점을 종가로 이탈하면 다음 스캔에서 조건에서 빠집니다. 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    shortTermMaBreakout: {
      purpose: '하락 추세선(두 스윙 고점 연결)을 종가로 처음 돌파한 종목을 찾습니다.',
      state: '돌파 확인(오늘 종가 기준 첫 돌파).',
      entry: '다음 거래일에 추세선 위에서 안착하고 거래량이 유지되는지 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '종가가 추세선 아래로 되돌아가면 돌파 실패 신호입니다. 자동 판정 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    maCloudBreakout: {
      purpose: '224일선과 구름대가 가까워지며 응축된 뒤 돌파를 준비하거나 막 돌파한 종목을 찾습니다.',
      state: '돌파 준비(응축, COMPRESSION_READY) 또는 돌파 확인(최근 1~3거래일 내 신규 돌파, BREAKOUT_NEW).',
      entry: '구름 상단과 224일선 위에서 종가가 안착하는지 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '종가가 구름 상단·224일선 아래로 돌아가면 패턴 훼손입니다. 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    doubleBottom: {
      purpose: '비슷한 두 저점을 만든 뒤 넥라인으로 회복하는 쌍바닥을 찾습니다.',
      state: '두 번째 저점 회복(RECOVERY) 또는 넥라인 접근(NECKLINE_READY). 넥라인 돌파가 끝난 종목은 이 목록에서 제외됩니다.',
      entry: '넥라인을 종가로 돌파하고 거래량이 늘어나는지 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '두 번째 저점을 종가로 이탈하면 쌍바닥이 깨진 것입니다(다음 스캔에서 조건 탈락). 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    invHeadShoulders: {
      purpose: '왼쪽 어깨·머리·오른쪽 어깨와 넥라인이 갖춰진 역헤드앤숄더를 찾습니다.',
      state: '넥라인 접근(NECKLINE_READY) 또는 최근 넥라인 돌파(BREAKOUT_NEW).',
      entry: '넥라인 종가 돌파와 거래량 증가를 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '머리 저점을 이탈하면 패턴이 무효입니다(다음 스캔에서 조건 탈락). 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    boxRangeLow: {
      purpose: '좁은 박스권 안에서 하단 지지를 받으며 반등을 시도하는 종목을 찾습니다.',
      state: '하단 접근(APPROACH, 반등 미확인) 또는 하단 반등(REBOUND, 지지 시험 뒤 양봉 또는 전일 대비 상승). 예상 손익비는 목표=박스 상단, 손절=지지 2회 이상 확인 시 지지 저가 아래 1%이며, 신뢰할 손절 기준이 없으면 보류입니다(수익을 보장하지 않습니다).',
      entry: '하단 지지 뒤 반등이 이어지는지, 박스 상단까지 여유가 있는지 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '박스 하단을 종가로 이탈하면 박스 전제가 깨집니다. 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    pullback: {
      purpose: '강한 상승 뒤 20일선 또는 240일선 부근에서 거래량이 줄며 조정받는 눌림목을 찾습니다.',
      state: '눌림 진행(PULLING_BACK) 또는 지지 확인(SUPPORT_CONFIRMED).',
      entry: '이동평균선 지지 뒤 반등 양봉과 거래량 회복을 확인한 뒤 판단합니다.' + ENTRY_NOTE,
      invalid: '20일선·240일선을 종가로 이탈하면 눌림이 아니라 추세 훼손입니다. 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    firstPullbackBreakout: {
      purpose: '거래량 돌파 뒤 첫 조정을 거치고 다시 고가를 넘는 첫 눌림목 재돌파를 찾습니다.',
      state: '돌파 확인(일봉 종가 재돌파, BREAKOUT_CONFIRMED). 하루에 몇 건 안 나오는 희귀 신호라 0건인 날이 많습니다.',
      entry: '재돌파 종가 확인 뒤 눌림 저점을 손절 기준선으로 삼을 수 있는지 확인합니다.' + ENTRY_NOTE,
      invalid: '눌림 저점 이탈이 차트상 무효 신호입니다. 자동 판정 추적 기준: ' + TRACK_RULE,
      basis: BASIS_DAILY
    },
    angleMomentum: {
      purpose: '이동평균선 기울기가 꺾여 오르기 시작하는 초기 변화를 찾는 실험적 검색기입니다.',
      state: '후보(단기 기울기 전환 직후). 최대 20건까지만 표시됩니다.',
      entry: '아래 백테스트 요약의 승률·평균수익률이 낮아 단독 진입 근거로 쓰기 어렵습니다. 다른 패턴과 겹치는지 함께 보세요.' + ENTRY_NOTE,
      invalid: '자동 무효 판정과 사후 추적은 없습니다. 다음 스캔에서 조건을 못 채우면 목록에서 빠집니다.',
      basis: '일봉 확정 스캔. 일봉 배치가 끝난 뒤 이어서 실행되므로 스캔 시각이 다른 탭보다 늦을 수 있습니다.'
    },
    gongpasan: {
      purpose: '큰 낙폭 뒤 바닥을 다지고 매집한 종목이 돌파 후 처음 20일선까지 눌리는 자리를, 진행 단계별로 일찍부터 관찰합니다.',
      state: '4단계: ① 매집 관찰(낙폭·횡보·매집봉) → ② 상승 돌파(돌파봉 발생) → ③ 눌림 대기(돌파 후 20거래일 안, 20일선 첫 접근 전) → ④ 지지 확인(최종 신호). 1~3단계는 관찰용이고 ④만 최종 신호입니다.',
      entry: '④ 지지 확인에서 종가가 20일선 -1% 이내로 지지되고 눌림 거래량이 줄었는지 확인한 뒤 판단합니다. 1~3단계는 진입 근거가 아닙니다.' + ENTRY_NOTE,
      invalid: '첫 20일선 접근 봉의 종가가 20일선보다 1% 넘게 낮으면 그 돌파는 끝나고(같은 돌파 재진입 없음), 20거래일이 지나도 끝납니다. 최종 신호(④)만 사후 추적됩니다.',
      basis: '일봉 확정 스캔. 일봉 배치가 끝난 뒤 이어서 실행되므로 스캔 시각이 다른 탭보다 늦을 수 있습니다. 데이터 기준일이 기대 거래일보다 오래되면 단계 후보를 숨깁니다.'
    },
    volumeBreakout: {
      purpose: '장중 거래량이 붙기 시작했거나 매집이 의심되는 종목, 이전에 매집봉이 나온 뒤 다시 거래량을 싣고 올라서는 종목을 한 검색기에서 찾습니다.',
      state: '유형별 상태: 초기 급증(early/moving) · 실시간 매집 의심(확정 / 5분봉 부족 시 판정 보류) · 기존 매집봉 재상승(재돌파 > 고점 근접 > 지지 대기). 분배 위험(낮음·보통·높음)을 함께 표시합니다.',
      entry: '거래량 배율과 판단 근거를 확인하고, 분배 위험이 보통 이상이면 윗꼬리·상승분 반납 여부를 차트에서 직접 확인하세요. 매집을 확정하는 신호가 아니며 방향을 보장하지 않습니다. 감지가는 참고값입니다.' + ENTRY_NOTE,
      invalid: '자동 무효 판정과 사후 추적은 없습니다. 실시간 신호는 조건이 깨지면(가격 방어 실패·분배 위험 높음) 목록에서 빠지고, 매집봉은 이후 저가·종가가 매집봉 저가·종가를 크게 깨면 빠집니다.',
      basis: '장중(평일 09:00~15:35): 30초 순위 표본으로 만든 5분봉·상대거래량(단순 시간비례 근사, 개장 20분 전·표본 부족 시 판정 보류)과 일봉 기반 매집봉을 현재가로 갱신합니다. 장 마감: 일봉(확정 종가) 기반 매집봉과 마지막 장중 판정만 보여 주며 실시간이 아닙니다.'
    }
  };
  var INFO_ROWS = [['purpose', '검색 목적'], ['cond', '패턴 조건'], ['state', '포착 상태'], ['entry', '진입 확인'], ['invalid', '무효 조건'], ['basis', '스캔 기준']];

  var scanData = null;
  var scanSettled = false, scanError = '', liveSurgeSettled = false, liveSurgeError = '';
  var scanPerformanceData = null;
  var activeTab = 'liveFlow';
  var historySource = 'volumeBreakout';
  var activeGroup = 'short';
  var publicView = 'all';
  var SCANNER_GROUPS = {
    short: ['liveFlow', 'trendBreakout'], swing: ['bottomFormation', 'pullbackRebreak'], long: ['longTermQuality']
  };
  // Original descriptors/detectors remain available; only the menu is consolidated.
  var MENU_TABS = [
    {key:'liveFlow',label:'실시간 거래량·수급',sources:['ninepayLive','volumeBreakout']},
    {key:'trendBreakout',label:'추세 돌파',sources:['shortTermMaBreakout','angleMomentum']},
    {key:'bottomFormation',label:'바닥 형성',sources:['risingLows','doubleBottom','invHeadShoulders','boxRangeLow']},
    {key:'pullbackRebreak',label:'눌림·재돌파',sources:['pullback','firstPullbackBreakout','gongpasan']},
    {key:'longTermQuality',label:'224일선·구름대 + 재무',sources:['longTermQuality']}
  ];
  function groupFor(key) { return MENU_TABS.filter(function(t){return t.key === key;})[0]; }
  function sourceLabel(key) { return key === 'longTermQuality' ? '재무 통과 장기 응축/돌파' : ((TABS.filter(function(t){return t.key === key;})[0] || {}).label || key); }

  var ninepayData = null, ninepayError = '', ninepayBusy = false, ninepayTimer = null;
  var rootContainer = null;
  var detailNavItems = [];
  var currentDetailItem = null;
  var detailRequestSeq = 0;
  // 2026-10-06 사용자 지적("스캔 시점에는 스캐너가 의미가 없어, 사전포착이야"): 거래량 돌파 탭은 09:05 스냅샷 대신
  // VM이 장중 30초마다 갱신하는 감지 목록(/volume-surge-live)을 쓴다. 실패하면 기존 스냅샷을 그대로 둔다.
  var LIVE_SURGE_URL = 'https://goodbyestar.cloud/volume-surge-live';
  var LIVE_SURGE_REFRESH_MS = 30000;
  var liveSurgeTimer = null;
  var liveSurgeInfo = null;
  var scanMetaText = '';
  // 2026-10-04 패턴 포착 생애주기: 현재 포착(오늘 검색 결과) / 추적 중 / 추적 종료. 추적 기록은 서버(pattern_tracks)에
  // 쌓이고 오늘 검색 결과에서 빠져도 지워지지 않는다. 화면은 읽기만 한다.
  var trackView = 'all';   // all / new / ready (오늘 검색 결과) · success / failed (추적 기록)
  var trackedCache = {};
  var psTrackCtx = null;
  var PATTERN_TRACKS_URL = 'https://goodbyestar.cloud/pattern-tracks';
  var TRACK_STATUS = {
    NEW: { label: '신규 포착', tone: 'is-flat' },
    TRACKING: { label: '추적 중', tone: 'is-flat' },
    SUCCESS: { label: '돌파 성공', tone: 'is-up' },
    BREAKOUT: { label: '저항 돌파', tone: 'is-up' },
    BREAKOUT_CONFIRMED: { label: '돌파 유지', tone: 'is-up' },
    FAILED: { label: '돌파 실패', tone: 'is-down' },
    EXPIRED: { label: '기간 만료', tone: 'is-flat' }
  };
  var TRACK_FAIL_REASON = { SUPPORT_BREAK: '지지선 이탈', BREAKOUT_FAILED: '돌파 실패', LOSS_3PCT: '종가 -3%', MA5_BREAK: '5일선 이탈', SIDEWAYS: '5거래일 횡보' };
  // 2026-10-06 포착 개편: 별도 추적 화면 대신 각 패턴 목록에 상태를 붙인다. 신규 포착 / 돌파 준비(기준선 3% 이내)는 오늘 검색 결과에서,
  // 돌파 성공(장중 고가 +5%) / 돌파 실패(5일선 종가 이탈, 시장이 크게 빠진 날은 PASS)는 서버 추적 기록(pattern_tracks)에서 보여 준다.
  var READY_GAP_PCT = 3;
  var STAGE_VIEWS = [['all', '전체'], ['new', '신규 포착'], ['ready', '돌파 준비'], ['success', '돌파 성공'], ['failed', '돌파 실패']];

  function stockIconHtml(code, cls) {
    if (!code) return '';
    var iconCode = String(code).replace(/^US:/i, '').toUpperCase();
    var iconClass = cls || 'ps-stock-icon';
    return '<img class="' + iconClass + '" data-icon-code="' + escapeHtml(iconCode)
      + '" data-icon-market="domestic" src="' + STOCK_ICON_BASE + encodeURIComponent(iconCode)
      + '.svg" alt="" loading="lazy" onerror="window.StockIconFallback ? window.StockIconFallback(this) : (window.__stockIconFallback ? window.__stockIconFallback(this) : this.style.display=\'none\')">';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    rootContainer = container;
    container.innerHTML = buildShell();
    wireTabs(container);
    syncScannerGroup(container);
    renderTabDesc(container);
    updateMeta(container);
    renderList(container);
    loadNinepay(container);
    clearInterval(ninepayTimer);
    ninepayTimer = setInterval(function () {
      if ((activeTab === 'ninepayLive' || activeTab === 'liveFlow') && !document.hidden && document.body.contains(container)) loadNinepay(container);
    }, 10000);
    loadScan(container);
    syncLiveSurge(container);
  }

  function buildShell() {
    function tabButton(t) {
      return '<button type="button" class="ps-tab' + (t.key === activeTab ? ' active' : '') + '" aria-pressed="' + (t.key === activeTab) + '" data-tab="' + t.key + '">' + t.label + '</button>';
    }
    var tabsHtml = MENU_TABS.map(tabButton).join('');

    return ''
      + '<div class="ps-confirmation-status" id="psConfirmationStatus" role="status" aria-live="polite">확정 신호 확인 중</div>'
      + '<div class="ps-head">'
      + '<div class="ps-horizon" role="tablist" aria-label="검색 기간">'
      + [['short','단타'],['swing','스윙'],['long','중장기']].map(function (g) { return '<button class="ps-horizon-tab' + (g[0] === activeGroup ? ' active' : '') + '" role="tab" aria-selected="' + (g[0] === activeGroup) + '" data-horizon="' + g[0] + '">' + g[1] + '</button>'; }).join('') + '</div>'
      + '<nav class="ps-subnav" aria-label="선택 분류의 검색기">' + tabsHtml + '</nav>'
      + '</div>'
      + '<div class="ps-tab-desc" id="psTabDesc"></div>'
      + '<div class="ps-status-filters" aria-label="현재 신호 상태">' + Object.keys(PUBLIC_LABELS).map(function(k){return '<button type="button" data-status="'+k+'" aria-pressed="'+(k==='all')+'">'+PUBLIC_LABELS[k]+' <span data-status-count="'+k+'">—</span></button>';}).join('') + '</div>'
      + '<details class="ps-research-tools"><summary>개별 검색기 이력·성과 및 데이터 기준</summary>'
      + '<div class="ps-filterbar"><div class="ps-source-history" id="psSourceHistory"></div>'
      + '<details class="ps-data-fold"><summary>데이터 기준</summary><div class="ps-meta" id="psMeta">불러오는 중...</div><div class="ps-price-basis-note" id="psPriceBasis"></div><p class="ps-security-basis">종목 유형: '+escapeHtml(global.SCANNER_SECURITY_TYPES ? global.SCANNER_SECURITY_TYPES.source+' · 기준 '+global.SCANNER_SECURITY_TYPES.asOf : '자료 미수신 · 확인 가능한 유형·이름 기준')+'</p></details></div>'
      + '<div class="ps-view-tabs" id="psViewTabs" role="tablist" aria-label="포착 상태">'
      + STAGE_VIEWS.map(function (v, i) {
        return '<button type="button" class="ps-view-tab' + (i === 0 ? ' active' : '') + '" role="tab" aria-selected="' + (i === 0) + '" data-view="' + v[0] + '">' + v[1] + '<small data-count="' + v[0] + '"></small></button>';
      }).join('')
      + '</div></details>'
      + '<div class="ps-list" id="psList">' + global.NineUI.state('loading', '검색 결과를 불러오는 중...', 'ps-hint', {spinner:false}) + '</div>'
      + '<div class="ps-detail" id="psDetail" hidden></div>';
  }

  // 목록이 비어 있어도(70점 넘는 종목이 없어도) 이 패턴이 뭘 찾는 건지는 항상 보이게 한다.
  // 2026-08-20: 원래 공통 조건(.ps-common-desc)과 탭별 조건(.ps-tab-desc)이 서로 다른
  // 박스 두 개로 나뉘어 있었는데, "하나의 칸에서 보여줘"라는 요청으로 한 박스 안에
  // 공통 조건(굵게) - 구분선 - 탭별 조건 순으로 합쳤다.
  function renderTabDesc(container) {
    var box = container.querySelector('#psTabDesc');
    if (!box) return;
    if (groupFor(activeTab)) { renderGroupDescription(container); return; }
    if (activeTab === 'ninepayLive') {
      box.innerHTML = '<strong>A OR B · 장초반 거래량 70% 필수 / 80% 우선</strong><p>' + escapeHtml(TABS[0].desc) + '</p>'
        + '<p>14:00 이후 처음 확인된 70%는 당일 신규 진입에서 제외합니다. 이전 충족 시각을 추정하지 않습니다.</p>'
        + '<small>공유 피드에 장전 거래량이 섞일 수 있어 최초 장중 수신 누적값을 빼고 유입 하한을 계산합니다. 화면 비율은 실제 전체 유입의 하한이며 늦게 발견한 종목을 놓칠 수 있습니다. B의 시가·확정 일봉이 없으면 B만 미확인입니다. 후보 최대 20개로 전 종목 검색이 아닙니다.</small>';
      return;
    }
    var tab = TABS.filter(function (t) { return t.key === activeTab; })[0];
    var info = TAB_INFO[activeTab] || {};
    var rows = INFO_ROWS.map(function (r) {
      var text = r[0] === 'cond' ? (tab ? tab.desc : '') : (info[r[0]] || '');
      return text ? '<div class="ps-info-row"><b>' + r[1] + '</b><span>' + escapeHtml(text) + '</span></div>' : '';
    }).join('');
    box.innerHTML = '<strong>' + escapeHtml(COMMON_SEARCH_DESC) + '</strong>'
      + '<hr class="ps-tab-desc-divider">'
      + rows;
  }

  function wireTabs(container) {
    container.querySelectorAll('[data-status]').forEach(function(button){button.addEventListener('click',function(){publicView=button.getAttribute('data-status');trackView='all';renderList(container);closeDetail(container);});});
    container.addEventListener('keydown', function (event) {
      var target = event.target;
      if (!target.matches('[data-horizon], .ps-subnav [data-tab], .ps-view-tab')) return;
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
      var selector = target.hasAttribute('data-horizon') ? '[data-horizon]' : target.hasAttribute('data-tab') ? '.ps-subnav [data-tab]' : '.ps-view-tab';
      var tabs = Array.prototype.filter.call(container.querySelectorAll(selector), function (tab) { return !tab.hidden; });
      var index = tabs.indexOf(target);
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].focus(); tabs[next].click();
    });
    container.querySelectorAll('[data-horizon]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeGroup = btn.getAttribute('data-horizon');
        syncScannerGroup(container);
        var target = container.querySelector('[data-tab="' + SCANNER_GROUPS[activeGroup][0] + '"]');
        if (target) target.click();
      });
    });
    container.querySelectorAll('.ps-view-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-view-tab').forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        trackView = btn.getAttribute('data-view');
        renderList(container);
        closeDetail(container);
      });
    });
    container.querySelectorAll('.ps-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-tab').forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        activeTab = btn.getAttribute('data-tab'); publicView='all';
        var phaseTab = container.querySelector('[data-view=\"new\"]');
        if (phaseTab && phaseTab.firstChild) phaseTab.firstChild.nodeValue = activeTab === 'liveFlow' ? '2차 신호 ' : '신규 포착 ';
        var grouped = groupFor(activeTab);
        if (grouped) { historySource = grouped.sources.filter(function(k){return k !== 'ninepayLive';})[0]; trackView = 'all'; scanPerformanceData = null; }
        container.querySelectorAll('.ps-view-tab').forEach(function(b){var on=b.getAttribute('data-view')===trackView;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
        renderTabDesc(container);
        updateMeta(container);
        renderList(container);
        closeDetail(container);
        syncLiveSurge(container);
        if (activeTab === 'ninepayLive' || activeTab === 'liveFlow') loadNinepay(container);
        if (groupFor(activeTab)) loadScanPerformance(container);
      });
    });
  }

  function syncScannerGroup(container) {
    container.querySelectorAll('[data-horizon]').forEach(function (btn) {
      var on = btn.getAttribute('data-horizon') === activeGroup;
      btn.classList.toggle('active', on); btn.setAttribute('aria-selected', String(on));
    });
    container.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.hidden = SCANNER_GROUPS[activeGroup].indexOf(btn.getAttribute('data-tab')) < 0;
      var index = SCANNER_GROUPS[activeGroup].indexOf(btn.getAttribute('data-tab'));
      btn.style.order = activeGroup === 'short' && index > 0 ? index + 1 : index;
    });
  }

  // 2026-10-04: 이 검색은 실시간이 아니라 장 마감 후 하루 1회 확정 일봉으로 계산한 결과다 - 기준일을 밝힌다.
  function baseDateLabel(data) {
    var latest = '';
    Object.keys((data && data.patterns) || {}).forEach(function (key) {
      ((data.patterns[key]) || []).forEach(function (row) { if (row && row.date && String(row.date) > latest) latest = String(row.date); });
    });
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(latest);
    return m ? ((window.NineTime && window.NineTime.closeAsOf(latest)) || (m[1] + '.' + m[2] + '.' + m[3] + ' 종가 기준')) + '(장 마감 후 1회 스캔) · ' : '';
  }

  function loadScan(container) {
    // GAS/VM의 빈 응답이 브라우저·중간 캐시에 남으면, 다음 일일 스캔이 끝난 뒤에도
    // "스캔 결과 없음" 화면이 계속 보일 수 있다. 목록 요청은 매번 최신 스냅샷을 확인한다.
    var stamp = encodeURIComponent(Date.now());
    var scanUrl = GAS_TICKER_URL + '?patternScan=1&_=' + stamp;
    function hasPatterns(data) {
      return data && !data.error && data.patterns && typeof data.patterns === 'object';
    }
    // 2026-09-03: 상세 클릭이 이미 쓰고 있는 VM 직접 호출을 목록에도 적용한다. API Probe
    // 실측에서 GAS 경유 목록이 24.07초였는데, 같은 응답의 전송 바이트는 gzip 후 22.8KB라
    // 회선이 아니라 GAS 구간이 병목이다(VM은 하루 1회 배치가 만든 캐시 파일을 그대로
    // 서빙한다). 응답 형태가 같아서 렌더 경로는 그대로고, GAS는 폴백으로 남긴다.
    fetchJson(KIWOOM_VM_URL + '/pattern-scan?_=' + stamp, PATTERN_SCAN_VM_TIMEOUT_MS)
      .then(function (envelope) {
        var d = envelope && envelope.data ? envelope.data : envelope;
        if (!hasPatterns(d)) throw new Error('VM 스캔 결과 없음');
        return d;
      })
      .catch(function () { return fetchWithRetry(scanUrl, hasPatterns); })
      .then(function (data) {
        scanData = data; scanSettled = true; scanError = '';
        scanMetaText = data.scannedAt
          ? (baseDateLabel(data) + '스캔 ' + data.scannedAt + ' · 대상 ' + (data.scanned || 0) + '/' + (data.universe || 0) + '종목')
          : '아직 스캔 결과가 없어요. VM 일일 스캔이 한 번 완료되면 표시됩니다.';
        updateMeta(container);
        renderList(container);
        loadScanPerformance(container);
        syncLiveSurge(container);
      })
      .catch(function (err) {
        scanSettled = true; scanError = (err && err.message) || '스캔 조회 실패';
        var list = container.querySelector('#psList');
        if (!list) return;
        if (activeTab === 'liveFlow') { renderList(container); return; }
        if (activeTab === 'ninepayLive') { renderNinepay(container); return; }
        list.innerHTML = '<div class="ps-error">' + escapeHtml((err && err.message) || '스캔 결과를 불러오지 못했어요.')
          + '<button type="button" class="ps-retry" id="psRetry">다시 조회</button></div>';
        var retry = list.querySelector('#psRetry');
        if (retry) retry.addEventListener('click', function () {
          retry.disabled = true;
          retry.textContent = '조회 중...';
          loadScan(container);
        });
      });
  }

  function updateMeta(container) {
    var meta = container.querySelector('#psMeta');
    if (!meta) return;
    if (activeTab === 'liveFlow') { meta.textContent = '9Pay 10초 · 거래량 감시 30초 · 일봉/장중 기준은 종목별로 구분'; return; }
    if (activeTab === 'ninepayLive') {
      meta.textContent = '장중 09:00~15:35 감시 · 장초반 거래량 70% 이상 · A OR B';
      return;
    }
    if (activeTab === 'volumeBreakout' && liveSurgeInfo) {
      var t = liveSurgeInfo.updatedAt ? new Date(liveSurgeInfo.updatedAt) : null;
      var hhmm = t && !isNaN(t.getTime())
        ? new Date(t.getTime() + 9 * 3600000).toISOString().slice(11, 19)
        : '';
      meta.textContent = liveSurgeInfo.active
        ? '장중 ' + (liveSurgeInfo.intervalSec || 30) + '초마다 갱신' + (hhmm ? ' · ' + ((window.NineTime && window.NineTime.updated(liveSurgeInfo.updatedAt)) || ('마지막 ' + hhmm)) : '')
          + ' · 이미 많이 오른 ' + (liveSurgeInfo.ranCount || 0) + '종목은 제외 · 실시간 매집 의심은 순위권 종목의 5분봉·RVOL 근사 기반'
        : '장이 열려 있지 않아요(평일 09:00~15:35 감시). 일봉 기반 매집봉과 마지막 장중 판정을 보여줍니다(실시간 아님).'
          + (scanData && scanData.volumeBreakoutScannedAt ? ' · ' + ((window.NineTime && window.NineTime.updated(scanData.volumeBreakoutScannedAt)) || ('기록 시각 ' + kstText(scanData.volumeBreakoutScannedAt))) : '');
      return;
    }
    var own = scanData && (activeTab === 'angleMomentum' ? scanData.angleMomentumScannedAt
      : activeTab === 'gongpasan' ? scanData.gongpasanScannedAt : null);
    meta.textContent = own ? scanMetaText + ' · 이 탭 스캔 ' + kstText(own) : scanMetaText;
  }

  function kstText(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    return new Date(t.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  }

  function loadLiveSurge(container) {
    return PatternScan.fetchJson(LIVE_SURGE_URL + '?_=' + Date.now())
      .then(function (envelope) {
        var data = envelope && envelope.data ? envelope.data : envelope;
        if (!data || !Array.isArray(data.items)) throw new Error('live surge empty');
        liveSurgeInfo = data; liveSurgeSettled = true; liveSurgeError = '';
        // 2026-10-15: 장이 닫혀 실시간 목록이 비면(전부 만료) 09:05 스냅샷을 덮어쓰지 않는다 - 안내 문구가 "마지막 감지 기록"을
        // 보여준다고 하므로 0건으로 덮으면 문구와 화면이 어긋난다.
        if (scanData && (data.active || data.items.length)) {
          scanData.patterns = scanData.patterns || {};
          scanData.patterns.volumeBreakout = data.items;
        }
        if (activeTab === 'volumeBreakout' || activeTab === 'liveFlow') { updateMeta(container); renderList(container); }
      })
      .catch(function () {
        // 실패하면 서버가 마지막으로 저장한 스냅샷을 그대로 둔다(탭이 비지 않게).
        liveSurgeInfo = null; liveSurgeSettled = true; liveSurgeError = '장중 검색 결과 조회 실패';
        if (activeTab === 'volumeBreakout' || activeTab === 'liveFlow') { updateMeta(container); renderList(container); }
      });
  }

  function syncLiveSurge(container) {
    clearInterval(liveSurgeTimer);
    liveSurgeTimer = null;
    if (activeTab !== 'volumeBreakout' && activeTab !== 'liveFlow') { updateMeta(container); return; }
    loadLiveSurge(container);
    liveSurgeTimer = setInterval(function () {
      if ((activeTab !== 'volumeBreakout' && activeTab !== 'liveFlow') || document.hidden || !document.body.contains(container)) return;
      loadLiveSurge(container);
    }, LIVE_SURGE_REFRESH_MS);
  }

  function scannerKey(patternKey) {
    var key = patternKey || activeTab || '';
    return 'pattern:' + String(groupFor(key) ? historySource : key);
  }

  // 2026-10-04 사용자 지적("성과기록이 계속 초기화되는 것 같다"): 기록은 DB(scan_hits)에 계속 쌓이는데, 화면이
  // 모든 검색기를 섞어 최신 500건만 받아서(한 검색기가 하루 수십~수백 건) 며칠치만 보이고 매일 밀려났다.
  // 이제 보고 있는 검색기 하나씩, 최근 35일치를 따로 받아 둔다. 화면은 그중 최근 2주 추천을 보여 준다.
  var scanPerformanceByKey = {};
  var SCAN_PERF_WINDOW_DAYS = 35;
  var SCAN_PERF_VIEW_DAYS = 14;

  function dateKstOffset(days) {
    var d = new Date(Date.now() + 9 * 3600000 - days * 86400000);
    return d.toISOString().slice(0, 10);
  }

  function loadScanPerformance(container) {
    if (activeTab === 'ninepayLive') return;
    var key = scannerKey(activeTab);
    var summaryBox = container.querySelector('#psTrackSummary');
    if (scanPerformanceByKey[key]) {
      scanPerformanceData = scanPerformanceByKey[key];
      renderTrackSummary(container);
      return;
    }
    if (summaryBox) summaryBox.innerHTML = '<span>사후 추적 불러오는 중...</span>';
    PatternScan.fetchJson(SCAN_PERFORMANCE_PUBLIC_URL + '?horizons=1,3,5,10,20&limit=1500&scanner=' + encodeURIComponent(key)
        + '&since=' + dateKstOffset(SCAN_PERF_WINDOW_DAYS))
      .then(function (envelope) {
        var data = envelope && envelope.data ? envelope.data : envelope;
        scanPerformanceByKey[key] = data;
        if (scannerKey(activeTab) !== key) return;   // 그 사이 다른 탭으로 옮겼으면 그쪽이 다시 부른다
        scanPerformanceData = data;
        renderTrackSummary(container);
        renderList(container);
      })
      .catch(function () {
        if (scannerKey(activeTab) !== key) return;
        scanPerformanceData = null;
        if (summaryBox) summaryBox.innerHTML = '<span class="is-muted">사후 추적 데이터가 아직 없어요. 다음 스캔 저장분부터 표시됩니다.</span>';
      });
  }

  function signedPct(value) {
    var n = Number(value);
    if (!isFinite(n)) return '-';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function performanceHitsForActiveTab() {
    var hits = scanPerformanceData && Array.isArray(scanPerformanceData.hits) ? scanPerformanceData.hits : [];
    var key = scannerKey(activeTab);
    return hits.filter(function (hit) { return hit && hit.scanner === key; });
  }

  // ---- 추천 후 평균 변화 선 + 시장(코스피·코스닥) 비교 (2026-10-04 사용자 요청 2·3번) ----
  // 시장 비교는 KODEX 200(069500)·KODEX 코스닥150(229200) 일봉으로 계산한다. 추천 종목마다 같은 날 기준가·같은 D+N일
  // 종가로 ETF 수익률을 구해, "그 종목이 추천된 날 시장을 샀다면"과 나란히 비교한다(시장이 오른 기간의 착시를 걷어낸다).
  var PERF_BENCHMARKS = [
    { code: '069500', label: '코스피(KODEX 200)', color: '#64748b' },
    { code: '229200', label: '코스닥(KODEX 코스닥150)', color: '#0ea5a4' }
  ];
  var PERF_HORIZONS = [1, 3, 5, 10];
  var benchDailyCache = {};

  function loadBenchDaily(code) {
    if (!benchDailyCache[code]) {
      benchDailyCache[code] = PatternScan.fetchJson(KIWOOM_VM_URL + '/flow-chart/' + encodeURIComponent(code))
        .then(function (env) {
          var data = env && env.data ? env.data : env;
          return (data && Array.isArray(data.daily) ? data.daily : []).filter(function (row) { return row && row.close; });
        })
        .catch(function () { delete benchDailyCache[code]; return []; });
    }
    return benchDailyCache[code];
  }

  // scanDate 당일(또는 그 이전 마지막 거래일) 종가 대비 scanDate 다음 거래일부터 h번째 거래일 종가의 수익률(%)
  function benchReturn(daily, scanDate, h) {
    var next = -1;
    for (var k = 0; k < daily.length; k++) { if (String(daily[k].date) > scanDate) { next = k; break; } }
    if (next < 1) return null;
    var target = next + h - 1;
    if (target >= daily.length) return null;
    var base = Number(daily[next - 1].close), close = Number(daily[target].close);
    return base > 0 ? (close - base) / base * 100 : null;
  }

  function renderPerformanceChart(box, key) {
    var mount = box.querySelector('[data-ps-perf]');
    if (!mount) return;
    var hits = performanceHitsForActiveTab();
    Promise.all(PERF_BENCHMARKS.map(function (b) { return loadBenchDaily(b.code); })).then(function (dailies) {
      if (scannerKey(activeTab) !== key || !document.body.contains(mount)) return;
      var rows = PERF_HORIZONS.map(function (h) {
        var own = [];
        var bench = PERF_BENCHMARKS.map(function () { return []; });
        hits.forEach(function (hit) {
          var v = hit.returns && hit.returns['d' + h];
          if (v == null) return;
          var vals = dailies.map(function (daily) { return benchReturn(daily, String(hit.scanDate), h); });
          if (vals.some(function (x) { return x == null; })) return;   // 시장 값을 못 구한 표본은 양쪽에서 같이 뺀다
          own.push(Number(v));
          vals.forEach(function (x, idx) { bench[idx].push(x); });
        });
        function avg(a) { return a.length ? a.reduce(function (sum, x) { return sum + x; }, 0) / a.length : null; }
        return { h: h, n: own.length, own: avg(own), bench: bench.map(avg) };
      });
      var ready = rows.filter(function (r) { return r.n > 0; });
      if (!ready.length) { mount.innerHTML = '<span class="is-muted">시장 비교는 포착 후 거래일이 지난 표본이 쌓이면 표시됩니다.</span>'; return; }
      var series = [{ label: '이 검색기 포착 평균', color: '#1f2937', values: rows.map(function (r) { return r.own; }), width: 2.4 }]
        .concat(PERF_BENCHMARKS.map(function (b, idx) {
          return { label: b.label, color: b.color, values: rows.map(function (r) { return r.bench[idx]; }), width: 1.6, dash: '4 3' };
        }));
      var all = [0];
      series.forEach(function (sr) { sr.values.forEach(function (v) { if (v != null) all.push(v); }); });
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
      var pad = (hi - lo) * 0.12;
      lo -= pad; hi += pad;
      var W = 420, H = 190, x0 = 40, x1 = 392, top = 16, bottom = 150;
      function X(h) { return x0 + (x1 - x0) * h / 10; }
      function Y(v) { return bottom - (v - lo) / (hi - lo) * (bottom - top); }
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ps-perf-svg" role="img" aria-label="포착 후 거래일별 평균 수익률과 코스피·코스닥 비교">';
      svg += '<line x1="' + x0 + '" y1="' + Y(0).toFixed(1) + '" x2="' + x1 + '" y2="' + Y(0).toFixed(1) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" />'
        + '<text x="0" y="' + (Y(0) + 4).toFixed(1) + '" font-size="10.5" fill="#94a3b8">0%</text>';
      series.forEach(function (sr) {
        var pts = [[0, 0]];
        PERF_HORIZONS.forEach(function (h, idx) { if (sr.values[idx] != null) pts.push([h, sr.values[idx]]); });
        svg += '<polyline fill="none" stroke="' + sr.color + '" stroke-width="' + sr.width + '"' + (sr.dash ? ' stroke-dasharray="' + sr.dash + '"' : '')
          + ' stroke-linecap="round" stroke-linejoin="round" points="' + pts.map(function (pt) { return X(pt[0]).toFixed(1) + ',' + Y(pt[1]).toFixed(1); }).join(' ') + '" />';
        pts.slice(1).forEach(function (pt) {
          svg += '<circle cx="' + X(pt[0]).toFixed(1) + '" cy="' + Y(pt[1]).toFixed(1) + '" r="' + (sr.width > 2 ? 3.4 : 2.4) + '" fill="' + sr.color + '" />';
        });
      });
      [0].concat(PERF_HORIZONS).forEach(function (h) {
        svg += '<text x="' + X(h).toFixed(1) + '" y="170" text-anchor="middle" font-size="11" fill="#64748b">' + (h === 0 ? '포착일' : 'D+' + h) + '</text>';
      });
      svg += '</svg>';
      var legend = series.map(function (sr) {
        return '<span><i style="background:' + sr.color + '"></i>' + escapeHtml(sr.label) + '</span>';
      }).join('');
      function cell(v) { return v == null ? '-' : '<b class="' + (v > 0 ? 'is-up' : v < 0 ? 'is-down' : 'is-flat') + '">' + signedPct(v) + '</b>'; }
      var table = ready.map(function (r) {
        var m = r.bench[0] != null ? r.own - r.bench[0] : null;
        var k = r.bench[1] != null ? r.own - r.bench[1] : null;
        return '<tr><td>D+' + r.h + '</td><td>' + r.n + '건</td><td>' + cell(r.own) + '</td><td>' + cell(r.bench[0]) + '</td><td>' + cell(r.bench[1]) + '</td><td>' + cell(m) + '</td><td>' + cell(k) + '</td></tr>';
      }).join('');
      mount.innerHTML = '<div class="ps-perf-title">포착 후 평균 변화와 시장 비교</div>' + svg
        + '<div class="ps-perf-legend">' + legend + '</div>'
        + '<table class="ps-perf-table"><thead><tr><th>시점</th><th>표본</th><th>포착 평균</th><th>코스피</th><th>코스닥</th><th>코스피 대비</th><th>코스닥 대비</th></tr></thead><tbody>' + table + '</tbody></table>'
        + '<em>같은 종목·같은 기간에 시장 ETF를 샀다면의 수익률과 나란히 둔 값입니다. "대비"가 플러스면 시장보다 나았다는 뜻이고, 표본이 적은 구간은 참고만 하세요.</em>';
    });
  }

  function renderTrackSummary(container) {
    var box = container.querySelector('#psTrackSummary');
    if (!box) return;
    var key = scannerKey(activeTab);
    if (!scanPerformanceByKey[key]) { loadScanPerformance(container); return; }
    scanPerformanceData = scanPerformanceByKey[key];
    var summary = scanPerformanceData && scanPerformanceData.summary && scanPerformanceData.summary[key];
    if (!summary) {
      box.innerHTML = '<span class="is-muted">이 검색기의 누적 사후 추적 표본이 아직 없어요.</span>';
      return;
    }
    var d1 = summary.d1 || {};
    var d5 = summary.d5 || {};
    var d10 = summary.d10 || {};
    var since14 = dateKstOffset(SCAN_PERF_VIEW_DAYS);
    var hits = performanceHitsForActiveTab().filter(function (hit) {
      return String(hit.scanDate || '') >= since14;
    }).sort(function (a, b) {
      return String(b.scanDate || '').localeCompare(String(a.scanDate || '')) || String(a.name || '').localeCompare(String(b.name || ''));
    });
    var totalRecent = hits.length;
    // 2026-10-04 사용자 요청("추천 성과 기록은 보고 싶을 때만 보기"): 접어 둔다. 펼쳐 둔 상태는 다시 그릴 때 유지한다.
    var wasOpen = !!box.querySelector('.ps-perf-fold[open]');
    box.innerHTML = '<details class="ps-perf-fold"' + (wasOpen ? ' open' : '') + '><summary>포착 성과 기록 보기 <small>최근 2주 포착 ' + escapeHtml(totalRecent) + '건</small></summary>'
      + '<span>최근 2주 포착 ' + escapeHtml(totalRecent) + '건 (최근 ' + SCAN_PERF_WINDOW_DAYS + '일 누적 ' + escapeHtml(summary.hits || 0) + '건)</span>'
      + '<span>D+1 평균 ' + escapeHtml(signedPct(d1.avgPct)) + ' · 승률 ' + escapeHtml(d1.winRatePct == null ? '-' : d1.winRatePct.toFixed(1) + '%') + '</span>'
      + '<span>D+5 평균 ' + escapeHtml(signedPct(d5.avgPct)) + '</span>'
      + '<span>D+10 평균 ' + escapeHtml(signedPct(d10.avgPct)) + '</span>'
      + '<em>스캔 시점 종가 기준. 실제 매수 성과가 아니라 조건의 사후 분포입니다.</em>'
      + '<div class="ps-perf" data-ps-perf><span class="is-muted">시장 비교 불러오는 중...</span></div>'
      + '</details>';
    renderPerformanceChart(box, key);
  }

  function latestPerformanceForItem(item) {
    if (!item || !scanPerformanceData || !Array.isArray(scanPerformanceData.hits)) return null;
    var key = scannerKey(activeTab);
    var code = String(item.code || '').toUpperCase();
    var hit = null;
    scanPerformanceData.hits.forEach(function (row) {
      if (!row || row.scanner !== key || String(row.code || '').toUpperCase() !== code) return;
      if (!hit || String(row.scanDate || '') > String(hit.scanDate || '')) hit = row;
    });
    return hit;
  }

  function performanceTrackingHtml(item) {
    var hit = latestPerformanceForItem(item);
    if (!hit) return '';
    if (hit.currentReturnPct == null) {
      return '<span class="ps-track-chip is-flat">포착 ' + escapeHtml(scanDateLabel(hit.scanDate) || hit.scanDate || '-') + ' · 다음 거래일부터 집계</span>';
    }
    var pct = Number(hit.currentReturnPct);
    var tone = pct > 0 ? 'is-up' : (pct < 0 ? 'is-down' : 'is-flat');
    var date = scanDateLabel(hit.scanDate);
    var elapsed = Number(hit.elapsedTradingDays);
    return '<span class="ps-track-chip ' + tone + '">포착 ' + escapeHtml(date || hit.scanDate || '-')
      + (isFinite(elapsed) && elapsed > 0 ? ' · +' + elapsed + '거래일' : '')
      + ' · 현재까지 ' + escapeHtml(signedPct(pct)) + '</span>';
  }

  // GAS는 간헐적으로 302 뒤 HTML 오류 페이지나 빈 캐시 응답을 반환할 수 있다.
  // 기존에는 이 첫 응답을 그대로 실패로 처리해 사용자가 새로고침해야 했다.
  // 짧은 재시도는 정상 응답일 때 추가 부담이 없고, 실패 때만 새 nonce로 재호출한다.
  function fetchWithRetry(url, isValid) {
    var attempt = 0;
    function request() {
      var requestUrl = url + (url.indexOf('?') >= 0 ? '&' : '?')
        + '_retry=' + encodeURIComponent(attempt);
      return PatternScan.fetchJson(requestUrl).then(function (data) {
        if (isValid && !isValid(data)) {
          var apiMessage = data && (data.message || data.error);
          throw new Error(apiMessage ? String(apiMessage) : '차트검색 응답 형식이 올바르지 않습니다.');
        }
        return data;
      }).catch(function (err) {
        if (attempt >= FETCH_RETRY_COUNT) throw err;
        attempt += 1;
        return new Promise(function (resolve) { setTimeout(resolve, 350 * attempt); }).then(request);
      });
    }
    return request();
  }

  function miniChartRows(item) {
    var detail = detailFor(item);
    var rows = detail.closes_20d || detail.closes20d || item && (item.miniChart || item.mini_chart || item.closeSeries);
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row) {
      if (typeof row === 'number') return { close: Number(row) };
      return { date: row && row.date, close: Number(row && (row.close != null ? row.close : row.price)) };
    }).filter(function (row) { return isFinite(row.close); }).slice(-20);
  }

  function miniChartHtml(item) {
    var rows = miniChartRows(item);
    if (rows.length < 2) return '<span class="ps-mini-chart-empty">상세 가격 흐름 데이터 없음</span>';
    var values = rows.map(function (row) { return row.close; });
    var min = Math.min.apply(Math, values);
    var max = Math.max.apply(Math, values);
    var range = max - min || Math.max(Math.abs(max) * 0.01, 1);
    var width = 132, height = 34, pad = 2;
    var points = values.map(function (value, index) {
      var x = pad + (width - pad * 2) * index / Math.max(1, values.length - 1);
      var y = height - pad - (value - min) / range * (height - pad * 2);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
    var change20d = values[0] ? (values[values.length - 1] - values[0]) / values[0] * 100 : 0;
    var tone = chgClass(change20d);
    var detail = detailFor(item);
    var indexByDate = {};
    rows.forEach(function (row, index) { if (row.date) indexByDate[row.date] = index; });
    var pivotLows = detail.pivot_lows || detail.low_swings || [];
    var markerPoints = [];
    pivotLows.forEach(function (point, index) {
      var pointIndex = point.date != null ? indexByDate[point.date] : null;
      if (pointIndex == null && point.price != null) {
        pointIndex = values.reduce(function (best, value, valueIndex) {
          return Math.abs(value - point.price) < Math.abs(values[best] - point.price) ? valueIndex : best;
        }, 0);
      }
      if (pointIndex != null && markerPoints.every(function (marker) { return marker.index !== pointIndex; })) {
        markerPoints.push({ index: pointIndex, kind: index === pivotLows.length - 1 ? 'latest' : 'previous' });
      }
    });
    var markerHtml = markerPoints.map(function (marker) {
      var x = pad + (width - pad * 2) * marker.index / Math.max(1, values.length - 1);
      var y = height - pad - (values[marker.index] - min) / range * (height - pad * 2);
      return '<circle class="ps-pivot-marker ' + marker.kind + '" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="2.6"></circle>';
    }).join('');
    var lastX = width - pad;
    var lastY = height - pad - (values[values.length - 1] - min) / range * (height - pad * 2);
    return '<svg class="ps-mini-chart ' + tone + '" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" role="img" aria-label="최근 20거래일 종가 흐름">'
      + '<polyline points="' + points + '"></polyline>' + markerHtml
      + '<circle class="ps-current-marker" cx="' + lastX.toFixed(2) + '" cy="' + lastY.toFixed(2) + '" r="2.2"></circle></svg>';
  }

  function detailFor(item) {
    return item && item.patternDetail ? item.patternDetail : {};
  }

  function nearResistanceText(detail) {
    var resistance = Number(detail && detail.resistance);
    var current = Number(detail && detail.signal && detail.signal.price);
    if (!(resistance > 0) || !(current > 0) || resistance < current) return '';
    var gap = (resistance - current) / current * 100;
    return gap <= 10 ? '저항선 ' + gap.toFixed(1) + '% 이내' : '';
  }

  function scannerSignal(item, patternKey) {
    var detail = detailFor(item);
    var resistanceText = nearResistanceText(detail);
    if (patternKey === 'risingLows') {
      var lows = Array.isArray(detail.pivot_lows || detail.low_swings) ? (detail.pivot_lows || detail.low_swings).length : 0;
      return lows ? '저점 상승 ' + lows + '회' : '저점 상승 확인';
    }
    if (patternKey === 'maCloudBreakout') {
      var mcReady = detail.status !== 'BREAKOUT_NEW';
      var mcTop = Number(detail.cloudTopDistance);
      var mcMa = Number(detail.ma224Distance);
      return (mcReady ? '🟡 돌파 준비' : '🟢 신규 돌파')
        + (isFinite(mcTop) ? ' · 구름 상단 ' + (mcTop > 0 ? '+' : '') + mcTop.toFixed(1) + '%' : '')
        + (isFinite(mcMa) ? ' · 224일선 ' + (mcMa > 0 ? '+' : '') + mcMa.toFixed(1) + '%' : '')
        + (!mcReady && detail.volumeRatio != null ? ' · 거래량 ' + Number(detail.volumeRatio).toFixed(1) + '배' : '');
    }
    if (patternKey === 'shortTermMaBreakout') {
      var trendPrice = Number(detail.resistance);
      var signalPrice = Number(detail.signal && detail.signal.price);
      var breakGap = trendPrice > 0 && signalPrice > 0 ? (signalPrice - trendPrice) / trendPrice * 100 : null;
      var volText = detail.volumeRatio != null ? ' · 거래량 ' + Number(detail.volumeRatio).toFixed(1) + '배' : '';
      return '하락 추세선 돌파' + (breakGap != null ? ' · 돌파폭 +' + breakGap.toFixed(1) + '%' : '') + ' · 5일선 상승' + volText;
    }
    if (patternKey === 'doubleBottom') {
      if (!(detail.low1 && detail.low2)) return '쌍바닥 구조';
      var dbReady = detail.status === 'NECKLINE_READY';
      var dbDist = Number(detail.necklineDistancePct);
      return (dbReady ? '🟢 넥라인 접근' : '🟡 바닥 확인')
        + (isFinite(dbDist) ? ' · 넥라인 ' + (dbDist > 0 ? '+' : '') + dbDist.toFixed(1) + '%' : '')
        + (detail.bottomDiffPct != null ? ' · 저점차 ' + Number(detail.bottomDiffPct).toFixed(1) + '%' : '');
    }
    if (patternKey === 'invHeadShoulders') {
      if (!(detail.head && detail.neckline)) return '역헤드앤숄더 구조';
      var ihsDist = Number(detail.necklineDistancePct);
      return (detail.status === 'BREAKOUT_NEW' ? '🟢 신규 돌파' : '🟡 넥라인 접근')
        + (isFinite(ihsDist) ? ' · 넥라인 ' + (ihsDist > 0 ? '+' : '') + ihsDist.toFixed(1) + '%' : '')
        + (detail.volumeRatio != null ? ' · 거래량 ' + Number(detail.volumeRatio).toFixed(1) + '배' : '');
    }
    if (patternKey === 'boxRangeLow') {
      var criteria = detail.criteria || {};
      var position = Number(criteria.lowerPositionPct);
      var boxLabel = detail.status === 'REBOUND' ? '🟢 하단 반등' : '🟡 하단 접근';
      var boxParts = [];
      if (criteria.boxWidthPct != null) boxParts.push('박스폭 ' + Number(criteria.boxWidthPct).toFixed(1) + '%');
      if (criteria.boxTop != null && criteria.boxBottom != null) boxParts.push('상단 ' + fmt(criteria.boxTop) + '·하단 ' + fmt(criteria.boxBottom));
      if (criteria.riskRewardStatus === 'PENDING') boxParts.push('손익비 판정 보류');
      else if (criteria.riskReward != null) boxParts.push('예상 손익비 ' + Number(criteria.riskReward).toFixed(1) + ':1');
      var boxTail = boxParts.length ? ' · ' + boxParts.join(' · ') : '';
      return isFinite(position) ? boxLabel + ' · 박스 하단 ' + position.toFixed(0) + '%' + (criteria.rsi14 != null ? ' · RSI ' + Number(criteria.rsi14).toFixed(0) : '') + boxTail : boxLabel + boxTail;
    }
    if (patternKey === 'openingGap') {
      var gap = Number(detail.gapRatePct);
      return isFinite(gap) ? '시초 갭 +' + gap.toFixed(1) + '%' : '시초 갭상승';
    }
    if (patternKey === 'pullback') {
      if (!(detail.ma20 || detail.ma240)) return '이평선 눌림 구조';
      var pbKind = { MA20: 'MA20 눌림', MA240: 'MA240 눌림', 'MA20+MA240': 'MA20+MA240 응축 눌림' }[detail.supportKind] || '이평선 눌림';
      return (detail.status === 'SUPPORT_CONFIRMED' ? '🟢 지지 확인' : '🟡 눌림 진행') + ' · ' + pbKind
        + (detail.pullbackPct != null ? ' · 고점 대비 -' + Number(detail.pullbackPct).toFixed(1) + '%' : '');
    }
    if (patternKey === 'firstPullbackBreakout') {
      return '재돌파 확인 · 조정 ' + Number(detail.pullbackDays || 0) + '봉'
        + (detail.volumeRatio != null ? ' · 거래량 ' + Number(detail.volumeRatio).toFixed(1) + '배' : '');
    }
    if (patternKey === 'angleMomentum') {
      var amShort = Number(detail.shortSlopePct);
      var amBurst = Number(detail.burstRatio);
      if (!isFinite(amShort)) return '각도 상승 전환';
      return (detail.status === 'BURST' ? '🟢 각도 분출' : '🟡 각도 전환')
        + ' · MA5 ' + (amShort > 0 ? '+' : '') + amShort.toFixed(2) + '%/일'
        + (isFinite(amBurst) ? ' · 분출 ' + amBurst.toFixed(1) + '배' : '')
        + (detail.volumeRatio != null ? ' · 거래량 ' + Number(detail.volumeRatio).toFixed(1) + '배' : '');
    }
    if (patternKey === 'gongpasan' && detail.stage && detail.stage !== 'SUPPORT_CONFIRMED') {
      var gsDays = Number(detail.daysSinceBreakout);
      var gsGap = Number(detail.ma20GapPct);
      // 단계 이름은 앞의 배지가 이미 보여 주므로 여기선 진행 수치만 쓴다.
      return [
        isFinite(gsDays) && detail.stage !== 'WATCH_ACCUM' ? '돌파 ' + gsDays + '거래일째' : '',
        isFinite(gsGap) && detail.stage !== 'WATCH_ACCUM' ? '20일선 대비 ' + (gsGap > 0 ? '+' : '') + gsGap.toFixed(1) + '%' : '',
        detail.stage === 'WATCH_ACCUM' && detail.retreatPct != null ? '160일 고점 대비 ' + detail.retreatPct + '%' : ''
      ].filter(Boolean).join(' · ');
    }
    if (patternKey === 'gongpasan') {
      var gpDays = Number(detail.daysSinceBreakout);
      var gpGap = Number(detail.ma20Distance);
      return (detail.status === 'SUPPORT_CONFIRMED' ? '✅ MA20 지지 확인' : '🟢 첫 눌림')
        + (isFinite(gpDays) ? ' · 돌파 ' + gpDays + '거래일 후' : '')
        + (isFinite(gpGap) ? ' · 저가-MA20 ' + gpGap.toFixed(1) + '%' : '')
        + (detail.pullbackVolumeRatio != null ? ' · 눌림 거래량 ' + Math.round(Number(detail.pullbackVolumeRatio) * 100) + '%' : '');
    }
    if (patternKey === 'volumeBreakout' && vaSignals(detail).length) {
      var parts = [];
      var mult = Number(detail.volumeMultiple);
      if (isFinite(mult)) parts.push('거래량 ' + mult.toFixed(1) + '배');
      vaSignals(detail).forEach(function (sg) {
        if (sg.type === 'REALTIME_ACCUM' && sg.closePos != null) parts.push('범위 내 위치 ' + Math.round(sg.closePos * 100) + '%');
        if (sg.type === 'OLD_BAR_REBREAK' && sg.gapToHighPct != null) parts.push('매집봉 고점 대비 ' + (sg.gapToHighPct > 0 ? '+' : '') + sg.gapToHighPct.toFixed(1) + '%');
        if (sg.status === 'pending') parts.push('가격 방어 판정 보류');
      });
      return parts.join(' · ') || '매집 신호';
    }
    if (patternKey === 'volumeBreakout') {
      var volumeRatio = Number(detail.volumeRatio);
      if (detail.live && isFinite(Number(detail.pace3))) {
        return (detail.status === 'moving' ? '🟡 진행 중' : '🟢 초기') + ' · 3분 ' + (Number(detail.pace3) * 100).toFixed(1) + '%'
          + (isFinite(volumeRatio) ? ' · 누적 ' + Math.round(volumeRatio * 100) + '%' : '');
      }
      return isFinite(volumeRatio) ? '전일 대비 ' + volumeRatio.toFixed(2) + '배' : '전일 거래량 돌파';
    }
    return resistanceText || '패턴 조건 확인';
  }

  function signedObservationPct(value) {
    var n = Number(value);
    if (!isFinite(n)) return null;
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function risingLowsObservation(item) {
    var detail = detailFor(item);
    var previous = detail.previous_low;
    var latest = detail.latest_low;
    var current = Number(detail.current_close != null ? detail.current_close : item && item.price);
    if (!previous || !latest || !isFinite(Number(previous.price)) || !isFinite(Number(latest.price)) || !isFinite(current)) {
      return '상세 가격 흐름 데이터 없음';
    }
    var lowRise = Number(detail.low_rise_pct);
    if (!isFinite(lowRise)) lowRise = (Number(latest.price) - Number(previous.price)) / Number(previous.price) * 100;
    var fromLatest = Number(detail.from_latest_low_pct);
    if (!isFinite(fromLatest)) fromLatest = (current - Number(latest.price)) / Number(latest.price) * 100;
    var first = '저점 ' + fmt(previous.price) + '원 → ' + fmt(latest.price) + '원, ' + (signedObservationPct(lowRise) || '-') + ' 높아짐';
    var resistance = Number(detail.recent_resistance);
    var gap = Number(detail.resistance_gap_pct);
    var second = '최근 저점 이후 ' + (signedObservationPct(fromLatest) || '-')
      + (isFinite(resistance) && resistance > 0
        ? (isFinite(gap) && gap < 0
          ? ' · 저항 ' + fmt(resistance) + '원 돌파 ' + signedObservationPct(Math.abs(gap))
          : ' · 저항 ' + fmt(resistance) + '원까지 ' + (isFinite(gap) ? gap.toFixed(1) : '-') + '%')
        : ' · 최근 저항 데이터 없음');
    var lows = detail.pivot_lows || detail.low_swings || [];
    var countNote = lows.length >= 4 ? '반복 지지 구간' : lows.length === 3 ? '지지 3회 확인' : lows.length === 2 ? '초기 저점 구조' : '';
    return first + ' · ' + second + (countNote ? ' · ' + countNote : '');
  }

  function scannerInterpretation(item, patternKey) {
    if (patternKey === 'risingLows') return risingLowsObservation(item);
    var text = String(item && item.interpretation || '').replace(/\s*\(?\d+점\)?\.?\s*$/, '').trim();
    if (text) return text;
    return {
      risingLows: '최근 저점이 높아지는 구조',
      shortTermMaBreakout: '하락 추세선을 종가가 처음 돌파하고 5일선이 상승 중인 초입',
      maCloudBreakout: '224일선·구름대가 응축된 구간에서 상단 돌파를 준비하거나 막 돌파한 구간',
      doubleBottom: '두 번째 바닥을 확인하고 넥라인으로 회복하는 쌍바닥 구조',
      invHeadShoulders: '어깨·머리·어깨 바닥 구조가 완성돼 넥라인에 접근하거나 막 돌파한 구간',
      boxRangeLow: '횡보 박스의 하단에서 지지를 받거나 반등을 시도하는 구간',
      pullback: '강한 상승 뒤 거래량이 줄며 이평선 부근에서 지지받는 눌림목',
      firstPullbackBreakout: '거래량을 동반한 상승 뒤 첫 조정을 거쳐 다시 고가를 돌파한 흐름',
      openingGap: '전일 종가보다 높게 시작한 갭상승',
      angleMomentum: '전형가 이동평균의 기울기가 먼저 위로 꺾이는 초기 전환 구간',
      gongpasan: '바닥 횡보·매집 뒤 돌파한 종목의 첫 20일선 눌림 지지 구간',
      volumeBreakout: '거래량이 붙기 시작했는데 아직 많이 오르지 않은 초기 구간'
    }[patternKey] || '검색 조건을 충족한 차트 패턴';
  }

  // 2026-08-23 신설 - "db에 저장할까? 일단 차트검색, 전략검색에만 넣어" 요청으로 daily_scan.py가
  // 하루 1회 배치로 KIS 평균 투자의견을 붙여준다(invest_opinion.enrich_matches_with_target_price,
  // scripts/cloud-vm/invest_opinion.py). 종목분석 페이지의 라이브 카드와 달리 여기는 필드가
  // item에 이미 채워져 있어(analystTargetPrice/analystTargetGapPct/analystReportCount)
  // 별도 fetch 없이 그대로 표시만 한다 - 없는 종목(리포트 0건 등)은 아무것도 안 붙인다.
  function analystTargetPriceText(item) {
    var target = Number(item && item.analystTargetPrice);
    if (!isFinite(target) || target <= 0) return '';
    var gap = Number(item.analystTargetGapPct);
    var gapText = isFinite(gap) ? ' (' + (gap >= 0 ? '+' : '') + gap.toFixed(1) + '%)' : '';
    return ' · 애널리스트 목표가 ' + fmt(target) + '원' + gapText;
  }

  function trackMapFor(key) {
    var cached = trackedCache[key + '|active'];
    var map = {};
    ((cached && cached.data && cached.data.tracks) || []).forEach(function (t) {
      if (!map[t.code] || String(t.detected_date) > String(map[t.code].detected_date)) map[t.code] = t;
    });
    return map;
  }

  // 현재 목록 종목이 기준선(저항·넥라인·구름 상단)까지 3% 이내인지. 패턴별로 이미 계산돼 있는 값을 우선 쓴다.
  function readyGapOk(item) {
    var sourceKey = (item && item._sourceKey) || (groupFor(activeTab) ? historySource : activeTab);
    var detail = detailFor(item);
    var top = Number(detail.cloudTopDistance);
    if ((sourceKey === 'maCloudBreakout' || sourceKey === 'longTermQuality') && isFinite(top)) return top <= 0 && top >= -READY_GAP_PCT;
    var neck = Number(detail.necklineDistancePct);
    if ((sourceKey === 'doubleBottom' || sourceKey === 'invHeadShoulders') && isFinite(neck)) return Math.abs(neck) <= READY_GAP_PCT;
    var resistance = Number(detail.resistance);
    var current = Number(item.price);
    if (resistance > 0 && current > 0 && resistance >= current) return (resistance - current) / current * 100 <= READY_GAP_PCT;
    return false;
  }

  // ---- 급락 후 첫 눌림목 4단계 (2026-10-15) ----
  // patterns.gongpasan은 최종 "지지 확인"만 담고(기존 그대로), 매집 관찰·상승 돌파·눌림 대기는 gongpasanStages로 따로 온다.
  // 이 단계(전략 진행도)는 추적 탭의 신규 포착/돌파 성공/돌파 실패(+5%·5일선 판정)와 다른 개념이라 배지·칩을 따로 쓴다.
  var GP_STAGES = [
    { key: 'WATCH_ACCUM', label: '매집 관찰' },
    { key: 'BREAKOUT', label: '상승 돌파' },
    { key: 'WAIT_PULLBACK', label: '눌림 대기' },
    { key: 'SUPPORT_CONFIRMED', label: '지지 확인' }
  ];
  var GP_STAGE_KEYS = GP_STAGES.map(function (s) { return s.key; });
  var GP_MAX_SHOWN = 30;
  
  function gpStageLabel(key) {
    var i = GP_STAGE_KEYS.indexOf(key);
    return i < 0 ? '' : GP_STAGES[i].label;
  }

  function gpAllItems() {
    var out = [];
    ((scanData && scanData.patterns && scanData.patterns.gongpasan) || []).forEach(function (it) {
      out.push(Object.assign({},it,{_gpStage:'SUPPORT_CONFIRMED'}));
    });
    var st = scanData && scanData.gongpasanStages;
    if (st && st.status === 'ok' && st.stages) {
      ['WAIT_PULLBACK', 'BREAKOUT', 'WATCH_ACCUM'].forEach(function (k) {
        (st.stages[k] || []).forEach(function (it) { out.push(Object.assign({},it,{_gpStage:k})); });
      });
    }
    return out;
  }

  function gpEmptyText(allCount) {
    var st = scanData && scanData.gongpasanStages;
    if (allCount) return '이 상태에 해당하는 종목이 없어요. 위 상태 칸에서 다른 상태를 보거나 전체를 눌러보세요.';
    if (!st) return '단계 정보가 아직 없어 최종 지지 확인 종목만 표시합니다. 지금은 해당 종목이 없어요.';
    if (st.status !== 'ok') return '단계 데이터가 오래돼 후보를 표시하지 않았어요. 스캔 오류가 아니라 일봉 갱신 대기일 수 있으니 새 스캔 완료 뒤 다시 확인하세요.';
    return '정상 0건입니다. 스캔은 완료됐고(' + escapeHtml(String(st.scanned || 0)) + '종목, 일봉 ' + escapeHtml(st.asOf || '') + ') 4단계 모두 조건에 맞는 종목이 없어요.';
  }

  function itemStage(item) {
    if (item && item._observationStale) return { key:'hold', label:'마지막 관측·기록', tone:'is-hold' };
    var track = trackMapFor(scannerKey(activeTab))[item && item.code];
    var scanDay = String((item && item.date) || '').slice(0, 10);
    var isNew = !track || (scanDay && String(track.detected_date) >= scanDay);
    if (isNew) return { key: 'new', label: '신규 포착', tone: 'is-new' };
    if (readyGapOk(item)) return { key: 'ready', label: '돌파 준비', tone: 'is-ready' };
    return { key: 'hold', label: '포착 유지', tone: 'is-hold' };
  }

  // patternDetail.status → 목록 배지. 형성 중 / 돌파 준비 / 돌파 확인을 한눈에 가른다(2026-10-15).
  var PATTERN_STATE = {
    BREAKOUT_NEW: { label: '돌파 확인', tone: 'is-confirm' },
    BREAKOUT_CONFIRMED: { label: '돌파 확인', tone: 'is-confirm' },
    COMPRESSION_READY: { label: '돌파 준비', tone: 'is-ready' },
    NECKLINE_READY: { label: '돌파 준비', tone: 'is-ready' },
    RECOVERY: { label: '형성 중', tone: 'is-form' },
    APPROACH: { label: '형성 중', tone: 'is-form' },
    REBOUND: { label: '반등 확인', tone: 'is-confirm' },
    PULLING_BACK: { label: '눌림 진행', tone: 'is-form' },
    SUPPORT_CONFIRMED: { label: '지지 확인', tone: 'is-confirm' },
    FIRST_PULLBACK: { label: '첫 눌림', tone: 'is-form' }
  };

  // '장중 거래량 급증' 한 검색기의 매집 신호(실시간 매집 의심 / 기존 매집봉 재상승 / 초기 급증)와 분배 위험 배지.
  var VA_TYPE = { REALTIME_ACCUM: '실시간 매집 의심', OLD_BAR_REBREAK: '기존 매집봉 재상승', EARLY_PACE: '거래량 초기 급증' };
  var VA_STAGE = { REBREAK: '재돌파', NEAR: '고점 근접', SUPPORTED: '지지 대기' };
  var VA_RISK = { LOW: '낮음', PENDING: '판정 보류', MID: '보통', HIGH: '높음' };
  var VA_FLAG = { LONG_UPPER_WICK: '급등 뒤 긴 윗꼬리', GIVEBACK: '상승분 반납', CLOSE_WEAK: '종가 위치 약함', BIG_SELL_BAR: '대량 음봉',
    EXTENDED: '고점 대비 과열(추격 위험)', UPPER_WICK_DAY: '당일 긴 윗꼬리' };

  function vaSignals(detail) {
    return ((detail && detail.signals) || []).filter(function (sg) { return sg && (sg.type === 'REALTIME_ACCUM' || sg.type === 'OLD_BAR_REBREAK'); });
  }

  function vaBadgesHtml(item) {
    var detail = detailFor(item);
    var sigs = (detail.signals || []).filter(function (sg) { return sg && VA_TYPE[sg.type]; });
    if (!sigs.length) return '';
    var risk = (detail.distribution && detail.distribution.risk) || 'LOW';
    return sigs.map(function (sg) {
      var extra = sg.type === 'OLD_BAR_REBREAK' && VA_STAGE[sg.stage] ? ' · ' + VA_STAGE[sg.stage] : (sg.status === 'pending' ? ' · 판정 보류' : '');
      return '<b class="ps-stage ps-va is-' + String(sg.type).toLowerCase() + '">' + escapeHtml(VA_TYPE[sg.type] + extra) + '</b> ';
    }).join('') + (vaSignals(detail).length ? '<b class="ps-stage ps-risk is-' + String(risk).toLowerCase() + '">분배 위험 ' + escapeHtml(VA_RISK[risk] || risk) + '</b> ' : '');
  }

  function stageBadgeHtml(item) {
    if ((activeTab === 'volumeBreakout' || (item && item._sourceKey === 'volumeBreakout')) && vaBadgesHtml(item)) return vaBadgesHtml(item);
    if (activeTab === 'gongpasan' && item && item._gpStage) {
      return '<b class="ps-stage ps-gp-badge is-' + item._gpStage.toLowerCase() + '">' + escapeHtml(gpStageLabel(item._gpStage)) + '</b> ';
    }
    var st = itemStage(item);
    var ps = PATTERN_STATE[String(detailFor(item).status || '')];
    return '<b class="ps-stage ' + st.tone + '">' + st.label + '</b> '
      + (ps && ps.label !== st.label ? '<b class="ps-stage ps-pstate ' + ps.tone + '">' + ps.label + '</b> ' : '');
  }

  // 신규/유지 구분과 칩 숫자에 쓰는 서버 추적 기록(2분 캐시). 도착하면 목록과 칩을 다시 그린다.
  function ensureTrackMap(container) {
    var key = scannerKey(activeTab);
    var cacheKey = key + '|active';
    var cached = trackedCache[cacheKey];
    if (cached && Date.now() - cached.at < 120000) { paintStageCounts(container); return; }
    if (cached && cached.loading) return;
    trackedCache[cacheKey] = { at: cached ? cached.at : 0, data: cached ? cached.data : null, loading: true };
    fetchJson(PATTERN_TRACKS_URL + '?scanner=' + encodeURIComponent(key) + '&view=active&days=90&limit=300')
      .then(function (envelope) {
        var data = envelope && envelope.data ? envelope.data : envelope;
        trackedCache[cacheKey] = { at: Date.now(), data: data };
        if (scannerKey(activeTab) !== key) return;
        if (trackView === 'all' || trackView === 'new' || trackView === 'ready') renderList(container);
        else paintStageCounts(container);
      })
      .catch(function () {
        trackedCache[cacheKey] = { at: Date.now(), data: cached ? cached.data : null };
      });
  }

  function paintStageCounts(container) {
    publishDashboard();
    var key = scannerKey(activeTab);
    var cached = trackedCache[key + '|active'];
    var stats = cached && cached.data && cached.data.stats;
    var counts = { all: 0, new: 0, ready: 0 };
    // 급락 후 첫 눌림목은 1~3단계 관찰 후보(gongpasanStages)도 '전체'에 센다. 빠지면 단계 칸은 4건인데 전체는 0건으로 보인다(2026-10-16).
    (activeTab === 'gongpasan' ? gpAllItems() : ((scanData && scanData.patterns && scanData.patterns[activeTab]) || [])).forEach(function (it) {
      counts.all += 1;
      var k = itemStage(it).key;
      if (counts[k] != null) counts[k] += 1;
    });
    if (stats) { counts.success = stats.success || 0; counts.failed = stats.failed || 0; }
    var review = container.querySelector('[data-scanner-review]');
    if (review) review.innerHTML = scannerReviewHtml(stats);
    container.querySelectorAll('#psViewTabs [data-count]').forEach(function (el) {
      var n = counts[el.getAttribute('data-count')];
      el.textContent = n == null ? '' : ' ' + n;
    });
  }

  function loadNinepay(container) {
    if (ninepayBusy) return;
    ninepayBusy = true;
    return fetchJson(KIWOOM_VM_URL + '/health/realtime', 8000).then(function (body) {
      var n = body && body.data && body.data.ninePayResearch;
      if (!n) throw new Error('검색기 상태 미수신');
      ninepayData = Object.assign({}, n, {hubCoverage: body.data.kiwoom || {}}); ninepayError = '';
    }).catch(function (error) { ninepayError = error.message || 'API 오류'; })
      .then(function () { ninepayBusy = false; if (activeTab === 'liveFlow') renderList(container); else if (activeTab === 'ninepayLive') renderNinepay(container); });
  }

  function npTime(at) {
    if (at == null) return '미확인';
    var d = typeof at === 'number' ? new Date(at * 1000) : new Date(at);
    return isNaN(d.getTime()) ? '미확인' : new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(d);
  }

  function npNumber(value, suffix, digits) {
    return value == null || !isFinite(Number(value)) ? '미수신' : Number(value).toLocaleString('ko-KR', {
      maximumFractionDigits: digits == null ? 0 : digits
    }) + (suffix || '');
  }

  function renderNinepay(container) {
    var list = container.querySelector('#psList'); if (!list) return;
    var n = ninepayData;
    var compatible = n && n.ruleVersion === 'ab70-v1';
    var rows = compatible && Array.isArray(n.items) ? n.items.filter(publicStockVisible) : [];
    rows.sort(function (a, b) { return Number(!!b.priority80) - Number(!!a.priority80); });
    var signals = compatible && Array.isArray(n.signals) ? n.signals.filter(publicStockVisible) : [];
    var notices = [];
    var state = !n ? (ninepayError ? 'API 오류' : '로딩 중') : !compatible ? 'A/B 기준 미반영' : !n.running ? '수집 중단'
      : !n.active ? '휴장·장외 대기' : !rows.some(function (r) { return r.at; }) ? '장중 데이터 미수신' : '장중 감시 중';
    if (n && !compatible) notices.push('현재 운영 VM은 이전 3분 거래량 3% 기준입니다. A/B·70% 기준은 아직 배포되지 않았으며 이전 신호를 새 조건으로 표시하지 않습니다.');
    if (ninepayError) notices.push('API 오류: ' + ninepayError + (n ? ' · 마지막 수신 자료를 표시합니다.' : ''));
    if (n && n.rankError) notices.push('후보 순위 오류: ' + n.rankError);
    if (n && n.amountFallback) notices.push('거래대금 순위 미수신 · 후보 누락 가능');
    if (n && n.persistenceError) notices.push(n.persistenceError);
    if (n && n.queueDropped) notices.push('검색기 수신 큐 누락 ' + n.queueDropped + '건');
    if (n && n.capacityOmitted && n.capacityOmitted.length) notices.push('20개 구독 한도로 순위 후보 ' + n.capacityOmitted.length + '개 제외');
    if (n && n.hubCoverage && n.hubCoverage.droppedCount) notices.push('공유 키움 허브 구독 누락 ' + n.hubCoverage.droppedCount + '개 · 해당 후보 영향은 미확인');
    if (n && n.active && n.rankAt && Date.now() - Date.parse(n.rankAt) > 120000) notices.push('순위 갱신 2분 이상 지연');
    var label = {watch:'감시', volume_met:'거래량 충족', pullback:'첫 눌림', signaled:'반등·재돌파 → 신호', invalidated:'첫 눌림 재이탈 · 종료'};
    var nameMap = {}; rows.forEach(function (r) { nameMap[r.code] = r.name || r.code; });
    function stock(r) { return '<button type="button" class="np-stock ui-btn-text" data-np-code="' + escapeHtml(r.code) + '">' + escapeHtml(r.name || nameMap[r.code] || '종목명 미수신') + '</button><small>' + escapeHtml(r.code) + '</small>'; }
    function td(title, value, cls) { return '<td data-label="' + title + '" class="' + (cls || '') + '">' + value + '</td>'; }
    var tableRows = rows.map(function (r) {
      var delay = r.sampleAt == null ? null : Math.max(0, Math.floor(Date.now() / 1000 - r.sampleAt));
      var rate = r.changeRate == null ? '미확인' : chgSign(r.changeRate);
      var evidence = r.risingLows == null ? '저점 상승 미확인' : (r.risingLows ? '확정 저점 상승' : '저점 상승 불충족');
      if (r.lows && r.lows.length === 2) evidence += ' ' + npNumber(r.lows[0]) + ' → ' + npNumber(r.lows[1]);
      if (r.lowDates && r.lowDates.length === 2) evidence += ' (' + r.lowDates.join(' → ') + ')';
      return '<tr>' + td('종목', stock(r), 'np-name')
        + td('현재가 / 등락률', npNumber(r.price, '원') + '<small class="' + chgClass(r.changeRate) + '">' + escapeHtml(rate) + '</small>')
        + td('거래량 비율 / 70% 최초 관측', (r.volumeRatio == null ? '미수신' : '≥' + npNumber(r.volumeRatio * 100, '%', 1)) + '<small>' + npTime(r.first70At) + '</small><small>' + (r.priority80 ? '80% 이상 · 우선' : '80% 장초반 관측 미확인') + '</small>')
        + td('B: 갭 / 확정 저점', npNumber(r.gapPct, '%', 2) + '<small>' + escapeHtml(evidence) + '</small>')
        + td('첫 눌림 / 진입', npNumber(r.pullbackLow, '원') + '<small>' + escapeHtml(r.branches && r.branches.length ? r.branches.join(' OR ') + ' 신호' : r.bSupportBroken ? 'B 시가 지지 이탈' : '반등·재돌파 대기') + '</small>')
        + td('현재 단계', escapeHtml(r.excluded || label[r.stage] || '감시 · 미수신'))
        + td('신호 시각 / 감지가', npTime(r.signalAt) + '<small>' + npNumber(r.signalPrice, '원') + '</small>')
        + td('수신 시각 / 지연·결측', npTime(r.at) + '<small>' + (delay == null ? '미수신' : delay + '초 전 · ' + (delay > 90 ? '지연' : '수신')) + '</small><small>' + (r.volumeMissing ? '거래량·전일값 결측' : r.at ? escapeHtml(r.source || '경로 미확인') : '거래량 미수신') + '</small>') + '</tr>';
    }).join('');
    var recordRows = signals.slice().reverse().map(function (s) {
      return '<tr>' + td('종목', stock(s)) + td('신호', escapeHtml((s.branches || []).join(' OR ') || '미확인'))
        + td('감지 시각 / 가격', npTime(s.at) + '<small>' + npNumber(s.signalPrice == null ? s.price : s.signalPrice, '원') + '</small>')
        + td('주문 / 체결 / 청산', '미연동 / 미연동 / 미연동')
        + td('실현손익 / 비용', '미확인<small>수수료·세금 미연동</small>') + '</tr>';
    }).join('');
    var html = '<section class="np-live ui-module"><h2 class="ui-section-heading">01. 실시간 단타 검색기</h2>'
      + '<div class="np-state" role="status">' + escapeHtml(state) + ' · 후보 ' + rows.length + '/20 · 오늘 신호 ' + signals.length + ' · 최근 수신 ' + npTime(n && n.lastEventAt) + '</div>'
      + (notices.length ? '<p class="ps-error" role="alert">' + notices.map(escapeHtml).join('<br>') + '</p>' : '')
      + '<p class="np-note">70% 최초 시각은 실제 수신 시각입니다. 비율은 장전 거래량을 뺀 관측 유입 하한입니다. 후보 순위 갱신 60초 · 화면 갱신 10초 · 표시 지연은 수신 후 경과이며 거래소 지연은 미확인입니다. 종목 선택 시 기존 차트가 열립니다.</p>'
      + '<p class="np-mobile-hint np-note">카드를 좌우로 넘기면 다음 종목을 볼 수 있습니다.</p>'
      + '<div class="np-deck"><table class="np-table"><thead><tr><th>종목</th><th>현재가</th><th>거래량 / 70% 시각</th><th>B 근거</th><th>첫 눌림</th><th>단계</th><th>신호</th><th>수신 상태</th></tr></thead><tbody>'
      + (tableRows || '<tr><td colspan="8" class="ps-hint">' + (n && compatible && n.active ? '장중 후보·체결 데이터를 기다리고 있습니다.' : n && compatible ? '휴장·장외입니다. 다음 거래일 실제 수신 후보를 표시합니다.' : 'A/B 운영 데이터가 아직 없습니다.') + '</td></tr>') + '</tbody></table></div>'
      + '<h2 class="ui-section-heading">03. 검색 결과 및 매매 기록</h2><p class="np-note">신호와 실제 주문은 별개입니다. PC 주문·체결·청산·손익 데이터는 현재 미연동입니다.</p>'
      + '<div class="np-deck"><table class="np-table"><thead><tr><th>오늘 포착 종목</th><th>A/B</th><th>신호 시각·감지가</th><th>주문·체결·청산</th><th>손익·비용</th></tr></thead><tbody>'
      + (recordRows || '<tr><td colspan="5" class="ps-hint">오늘 포착 기록이 없습니다.</td></tr>') + '</tbody></table></div>'
      + '<p class="np-note">통합 검색기는 위 버튼에서 선택하세요. 기존 기록·20:10 야간 검색은 유지됩니다.</p></section>';
    if (list.dataset.ninepayHtml !== html || !list.querySelector('.np-live')) {
      var scrolls = Array.prototype.map.call(list.querySelectorAll('.np-table tbody'), function (body) { return body.scrollLeft; });
      list.innerHTML = html; list.dataset.ninepayHtml = html;
      list.querySelectorAll('.np-table tbody').forEach(function (body, index) { body.scrollLeft = scrolls[index] || 0; });
      detailNavItems = rows.map(function (r) { return {code:r.code, name:r.name || r.code, price:r.price, changeRate:r.changeRate}; });
      list.querySelectorAll('[data-np-code]').forEach(function (button) { button.addEventListener('click', function () {
        var code = button.getAttribute('data-np-code');
        var item = detailNavItems.filter(function (r) { return r.code === code; })[0] || {code:code, name:nameMap[code] || code};
        openDetail(container, item);
      }); });
    }
  }


  function mergeScannerRows(entries) {
    var byCode = {}, order = [];
    var hiddenCodes={};
    entries.forEach(function(entry){(entry.items || []).forEach(function(item){if(item && !publicStockVisible(item))hiddenCodes[String(item.code)]=true;});});
    entries.forEach(function(entry) {
      (entry.items || []).forEach(function(item) {
        if (!item || !item.code || hiddenCodes[String(item.code)]) return;
        var code=String(item.code), row=byCode[code];
        if(!row) { row=byCode[code]=Object.assign({},item,{_sourceKey:entry.key,members:[]}); order.push(row); }
        if(!row.miniChart && item.miniChart)row.miniChart=item.miniChart;
        var identity=entry.key+'|'+String(item._gpStage || '')+'|'+String((item.patternDetail || {}).status || '')+'|'+String(item.stage || '')+(item.track?'|track:'+String(item.track.id || item.track.detected_date || ''):'');
        if(!row.members.some(function(m){return m.identity===identity;}))row.members.push({key:entry.key,item:item,identity:identity});
        // Real-time observed price takes precedence; do not mix its time with a daily scan price.
        var quoteAt=Number(item.sampleAt || item.at);
        if(entry.key==='ninepayLive' && item.price!=null && !item._observationStale && (!row._quoteAt || quoteAt>=row._quoteAt)){row.price=item.price;row.changeRate=item.changeRate;row._quoteAt=quoteAt;row._quoteBasis='9Pay 수신 '+npTime(item.sampleAt || item.at);}
        if(!row._quoteBasis && item._observationStale)row._quoteBasis='마지막 관측·기록 '+(item.lastObservedAt ? npTime(item.lastObservedAt) : item.date || '시각 미확인');
      });
    });
    return order;
  }
  // Display only actual A/B events emitted by the existing observer. This is
  // an observation, not a substitute for the PC order gate or a buy instruction.
  function phaseTwoEvents() {
    var n = ninepayData;
    if (!n || ninepayError || !n.running || !n.active || n.ruleVersion !== 'ab70-v1' || !Array.isArray(n.signals) || n.rankError || n.amountFallback || n.persistenceError || n.queueDropped) return null;
    var rankAt = Date.parse(n.rankAt || ''), rankAge = Date.now() - rankAt;
    if (!Number.isFinite(rankAge) || rankAge < 0 || rankAge > 120000) return null;
    var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    return n.signals.filter(function (s) {
      if (!s || !/^\d{6}$/.test(String(s.code || '')) || s.ruleVersion !== 'ab70-v1') return false;
      var at = Number(s.at), first = Number(s.first70At), ratio = Number(s.volumeRatio);
      if (!Number.isFinite(at) || !Number.isFinite(first) || !Number.isFinite(ratio) || first <= 0 || at < first || at * 1000 > Date.now()) return false;
      var signalDate = new Date(at * 1000 + 9 * 3600000), firstDate = new Date(first * 1000 + 9 * 3600000);
      var day = signalDate.toISOString().slice(0, 10), firstDay = firstDate.toISOString().slice(0, 10);
      var signalMinute = signalDate.getUTCHours() * 60 + signalDate.getUTCMinutes(), firstMinute = firstDate.getUTCHours() * 60 + firstDate.getUTCMinutes();
      return day === today && firstDay === today && signalMinute >= 540 && signalMinute < 840 && firstMinute >= 540 && firstMinute < 840
        && Number(s.price) > 0 && ['Kiwoom WebSocket', 'KIS rank polling'].indexOf(s.source) >= 0
        && s.signalId === today + ':' + s.code && ratio >= 0.7
        && s.volumeMissing === false && Object.prototype.hasOwnProperty.call(s, 'excluded')
        && (s.excluded === null || s.excluded === false)
        && Array.isArray(s.branches) && s.branches.length > 0
        && s.branches.every(function (b) { return b === 'A' || b === 'B'; });
    });
  }
  function unifiedItems() {
    var group=groupFor(activeTab), patterns=(scanData && scanData.patterns) || {};
    if(!group)return [];
    return mergeScannerRows(group.sources.map(function(key){
      var items=key==='ninepayLive' ? (ninepayData && ninepayData.ruleVersion==='ab70-v1' ? (ninepayData.items || []).concat((ninepayData.signals || []).map(function(r){return Object.assign({stage:'signaled'},r);})) : [])
        : key==='gongpasan' ? gpAllItems() : key==='volumeBreakout' && liveSurgeInfo && (liveSurgeInfo.active || (liveSurgeInfo.items || []).length) ? liveSurgeInfo.items || [] : patterns[key] || [];
      if(key==='longTermQuality')items=items.filter(function(r){return r.financialScreen && r.financialScreen.passed===true && scanData && scanData.longTermFilter && scanData.longTermFilter.version===1;});
      if(key==='longTermQuality' && scanData && scanData.longTermFilter && scanData.longTermFilter.version===1){
        var filter=scanData.longTermFilter;
        items=items.concat((filter.excludedItems || []).map(function(r){return Object.assign({},r,{excluded:(r.reasons || []).map(function(reason){return (filter.reasonLabels || {})[reason] || reason;}).join(' · ') || '기존 재무 조건에서 제외'});}));
      }
      items=items.map(function(r){
        var stamp=key==='ninepayLive'?(r.sampleAt || r.at):key==='volumeBreakout'?r.lastObservedAt:(r.scannedAt || (r.patternDetail || {}).scanned_at);
        var ms=typeof stamp==='number'?stamp*1000:Date.parse(stamp || ''), age=Date.now()-ms;
        var rankAge=Date.now()-Date.parse((ninepayData || {}).rankAt || '');
        var stale=key==='ninepayLive' ? (!ninepayData.active || !!ninepayError || !!ninepayData.rankError || !!ninepayData.persistenceError || !isFinite(age) || age<0 || age>90000 || !isFinite(rankAge) || rankAge<0 || rankAge>120000)
          : key==='volumeBreakout' && liveSurgeInfo ? (!liveSurgeInfo.active || !!liveSurgeInfo.error || !!r.observationStale || !isFinite(age) || age<0 || age>90000)
          : (!isFinite(age) || age<0 || age>36*3600000);
        return Object.assign({},r,{_observationStale:stale,_observationMissing:!isFinite(ms)});
      });
      return {key:key,items:items};
    }));
  }
  function publicConfirmation(member, state, now) {
    var item=member.item, review=item.signalReview;
    if(item._observationStale || item.entryInvalid || item.excluded || item.stage==='invalidated')return null;
    if(member.key==='ninepayLive') {
      // Existing A/B confirmations stay distinct from experimental first-stage
      // assessments. Both are read-only; neither is an order permission.
      if(!state || !state.active || !state.running || state.ruleVersion!=='ab70-v1' || state.rankError || state.amountFallback || state.persistenceError || state.queueDropped)return null;
      var rankAge=now-Date.parse(state.rankAt || ''), sample=Number(item.sampleAt || item.at)*1000;
      var at=Number(item.signalAt)*1000, first=Number(item.first70At)*1000, price=Number(item.signalPrice), current=Number(item.price), stop=Number(item.pullbackLow);
      var day=function(ms){return new Date(ms+9*3600000).toISOString().slice(0,10);};
      if(!Number.isFinite(rankAge)||rankAge<0||rankAge>120000||!Number.isFinite(sample)||now-sample<0||now-sample>10000)return null;
      if(review && review.version==='confirmation-shadow-v1' && review.strategy==='short' && review.mode==='shadow' && review.orderAuthorized===false && review.confirmed===true && review.entryValid===true && review.checks && Object.keys(review.checks).length && Object.keys(review.checks).every(function(k){return review.checks[k]===true;})) {
        var shadowAge=now-Number(review.confirmedAt)*1000;
        if(Number.isFinite(shadowAge)&&shadowAge>=0&&shadowAge<=10000&&review.signalPrice>0&&review.invalidationPrice>0&&current>review.invalidationPrice&&current<=review.signalPrice*1.003)
          return {at:review.confirmedAt,price:review.signalPrice,stop:review.invalidationPrice,entry:'1차 Shadow · 주문 불가',basis:'실시간 수신 · Shadow',pattern:'9Pay 1차 검증',shadow:true};
      }
      if(!Number.isFinite(at)||at<=0||now-at<0||now-at>10000||!Number.isFinite(first)||first<=0||first>at||day(at)!==day(now)||day(first)!==day(now))return null;
      var minute=new Date(at+9*3600000);minute=minute.getUTCHours()*60+minute.getUTCMinutes();
      var ratio=Number(item.volumeRatio), firstMinute=new Date(first+9*3600000);firstMinute=firstMinute.getUTCHours()*60+firstMinute.getUTCMinutes();
      if(minute<540||minute>=840||firstMinute<540||firstMinute>=840||item.ruleVersion!=='ab70-v1'||['Kiwoom WebSocket','KIS rank polling'].indexOf(item.source)<0||item.volumeMissing!==false||!Object.prototype.hasOwnProperty.call(item,'excluded')||!(item.excluded===null||item.excluded===false)||!Number.isFinite(ratio)||ratio<.7)return null;
      if(!Array.isArray(item.branches)||!item.branches.length||!item.branches.every(function(b){return b==='A'||b==='B';})||!Number.isFinite(price)||price<=0||!Number.isFinite(current)||current<=0||!Number.isFinite(stop)||stop<=0||current<=stop||current>price*1.003)return null;
      return {at:item.signalAt,price:price,stop:stop,entry:'시세 기준 유효 · 주문 별도',basis:'실시간 수신',pattern:'9Pay A/B '+item.branches.join('/'),shadow:false};
    }
    if(!review||review.version!=='confirmation-shadow-v1'||review.mode!=='shadow'||review.orderAuthorized!==false||review.confirmed!==true||!review.confirmedAt||!(review.signalPrice>0)||!(review.invalidationPrice>0))return null;
    var age=now-Date.parse(review.evaluatedAt || '');
    if(!Number.isFinite(age)||age<0||age>36*3600000||item.price<=review.invalidationPrice)return null;
    return {at:review.confirmedAt,price:review.signalPrice,stop:review.invalidationPrice,entry:'현재 진입 미확인 · 주문 불가',basis:'확정 일봉 '+review.dataAsOf,pattern:sourceLabel(member.key),shadow:true};
  }
  function renderConfirmedList(container, all) {
    var list=container.querySelector('#psList'), now=Date.now(), rows=[];
    all.forEach(function(row){
      var members=row.members.map(function(m){
        var observed=row._quoteBasis && row._quoteBasis.indexOf('9Pay 수신')===0 ? {key:m.key,item:Object.assign({},m.item,{price:row.price})} : m;
        return {member:m,confirmation:publicConfirmation(observed,ninepayData,now)};
      }).filter(function(m){return m.confirmation;});
      if(members.length)rows.push({row:row,members:members});
    });
    var states=groupFor(activeTab).sources.map(scannerDataState), n=ninepayData;
    var issue=states.indexOf('error')>=0 || activeTab==='liveFlow' && (ninepayError || liveSurgeError || liveSurgeInfo && liveSurgeInfo.error || n && (n.rankError || n.persistenceError || n.queueDropped || n.amountFallback));
    var pending=states.indexOf('loading')>=0;
    var last=activeTab==='liveFlow' ? n && n.lastEventAt : scanData && scanData.scannedAt;
    var stale=all.some(function(r){return r.members.some(function(m){return m.item._observationStale;});});
    if(activeTab==='liveFlow' && n && n.active){var rankAge=now-Date.parse(n.rankAt || '');stale=stale||!Number.isFinite(rankAge)||rankAge<0||rankAge>120000;}
    var missingReview=all.some(function(r){return r.members.some(function(m){return m.key!=='ninepayLive' && !m.item.signalReview;});});
    var status=issue?'장애 · 신호 검증 불가':pending?'데이터 수신 대기':stale?'지연 · 만료 신호 제외':'검색 정상';
    if(!issue&&!pending&&!stale&&missingReview)status='일부 패턴 확정 검증 자료 미수신';
    if(activeTab==='liveFlow' && n && !n.active)status='장외 · 실시간 신호 대기';
    var statusBox=container.querySelector('#psConfirmationStatus');
    if(statusBox)statusBox.textContent=status+' · 유효 확정 '+rows.length+'종목 · 마지막 관측 '+(last?new Date(last).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'미수신');
    var empty=issue?'데이터 장애로 확정 신호를 검증할 수 없습니다.':pending?'확정 검증 자료를 수신하고 있습니다.':stale?'지연·만료된 신호를 제외했습니다. 현재 유효한 확정 신호는 0건입니다.':'현재 유효한 확정 신호가 0건입니다. 미확정 후보는 연구·과거 기록에서 확인할 수 있습니다.';
    if(!issue&&!pending&&!stale&&missingReview)empty='확정 검증 자료가 없는 패턴은 제외했습니다. 후보·과거 기록과 데이터 기준을 확인하세요.';
    list.innerHTML='<p class="ps-unified-note">확정 신호만 표시합니다. 일봉 검증은 Shadow Mode이며 실시간 진입·주문·체결을 뜻하지 않습니다.</p>'+(rows.length?'<div class="ps-confirmed-table" role="table" aria-label="유효 확정 신호"><div class="ps-confirmed-head" role="row">'+['종목명·코드','현재가·등락률','확정 패턴','확정 시각','신호 당시 가격','현재 진입 유효성','무효화 기준'].map(function(s){return '<span role="columnheader">'+s+'</span>';}).join('')+'</div>'+rows.map(function(r){var c=r.members[0].confirmation,it=r.row;return '<div class="ps-confirmed-row ps-item" role="row" tabindex="0" data-code="'+escapeHtml(it.code)+'">'
      +'<span role="cell" data-label="종목"><b>'+escapeHtml(it.name || it.code)+'</b><small>'+escapeHtml(it.code)+'</small></span>'
      +'<span role="cell" data-label="현재가"><strong class="ps-price">'+fmt(it.price)+'</strong><small class="'+chgClass(it.changeRate)+'">'+chgSign(it.changeRate)+'</small><small>'+escapeHtml(c.basis)+(c.shadow?' · 스캔 가격':'')+'</small></span>'
      +'<span role="cell" data-label="확정 패턴">'+r.members.map(function(m){return escapeHtml(m.confirmation.pattern);}).join('<br>')+'</span>'
      +'<span role="cell" data-label="확정 시각">'+escapeHtml(typeof c.at==='number'?npTime(c.at):c.at)+'</span>'
      +'<span role="cell" data-label="신호가">'+fmt(c.price)+'원</span><span role="cell" data-label="진입 유효성">'+escapeHtml(c.entry)+'</span>'
      +'<span role="cell" data-label="무효화 기준">'+fmt(c.stop)+'원 이하<small>신호 근거·위험은 종목 선택</small></span></div>';}).join('')+'</div>':global.NineUI.state(issue?'error':pending?'loading':'empty',empty,'ps-hint',{spinner:false}));
    detailNavItems=rows.map(function(r){return Object.assign({},r.members[0].member.item,{_sourceKey:r.members[0].member.key});});
    list.querySelectorAll('[data-code]').forEach(function(el){function open(){var it=detailNavItems.filter(function(r){return String(r.code)===el.dataset.code;})[0];openDetail(container,it);}el.addEventListener('click',open);el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
  }
  function renderGroupDescription(container) {
    var group=groupFor(activeTab), box=container.querySelector('#psTabDesc');
    var purpose={liveFlow:'9Pay A/B와 장중 급증·매집 의심·재돌파를 종목별로 모은다. 관찰 신호이며 실제 매집·주문·체결을 뜻하지 않는다.',
      trendBreakout:'하락추세선 돌파와 이평 기울기 전환을 구분해 본다.',bottomFormation:'저점상승·쌍바닥·역헤드앤숄더·박스권 하단의 모든 충족 상태를 본다.',
      pullbackRebreak:'이평 눌림·첫 눌림 재돌파·급락 후 첫 눌림의 단계별 후보를 함께 본다.',longTermQuality:'224일선·구름대 응축/돌파 중 최근 연간 영업이익·순이익 흑자와 최신 단독분기 비적자를 확인한 기업만 본다.'};
    var shortPurpose={liveFlow:'거래량·수급·재돌파 신호를 종목별로 확인합니다.',trendBreakout:'추세선 돌파와 이평 기울기 전환을 구분합니다.',bottomFormation:'저점상승·쌍바닥 등 바닥 형성 패턴을 함께 봅니다.',pullbackRebreak:'눌림과 재돌파 후보의 진행 단계를 확인합니다.',longTermQuality:'장기 기술 패턴과 재무 건전성을 함께 확인합니다.'};
    box.innerHTML='<details class="ps-condition-fold"><summary><span>'+escapeHtml(shortPurpose[activeTab])+'</span><b>조건 보기</b></summary><div class="ps-condition-body">'
      +'<p>'+escapeHtml(purpose[activeTab])+'</p><p>같은 종목은 한 줄에 표시하며 충족 패턴·단계는 모두 표시합니다. 이력·성과는 선택한 개별 검색기 기준으로 집계합니다.</p>'
      +(activeTab==='longTermQuality'?'<p>주가 5,000원 · 시총 3,000억원 · 20일 평균 거래대금 30억원 이상. 거래대금은 종가×거래량 대용값. 누락·오래된 공시는 제외합니다.</p>':'')
      +group.sources.map(function(key){var t=TABS.filter(function(x){return x.key===key;})[0];return '<p><b>'+escapeHtml(sourceLabel(key))+'</b> '+escapeHtml(t?t.desc:'기존 224일선·구름대 조건 + DART 재무 통과')+'</p>';}).join('')+'</div></details>';
    var history=container.querySelector('#psSourceHistory');
    var keys=group.sources.filter(function(k){return k!=='ninepayLive';});
    if(activeTab==='longTermQuality')keys.push('maCloudBreakout');
    history.innerHTML='<label><span>이력 기준</span> <select aria-label="이력·성과 기준 검색기" data-history-source>'+keys.map(function(k){return '<option value="'+k+'"'+(k===historySource?' selected':'')+'>'+escapeHtml(sourceLabel(k))+(k==='maCloudBreakout'?' (이전 기술식 이력)':'')+'</option>';}).join('')+'</select></label><span class="ps-history-note">개별 검색기 통계</span>';
    history.querySelector('select').addEventListener('change',function(e){historySource=e.target.value;scanPerformanceData=null;loadScanPerformance(container);renderList(container);});
  }
  function memberTagHtml(member) {
    var it=member.item, detail=detailFor(it);
    if(it._observationStale)return '<span>'+memberTagHtml(Object.assign({},member,{item:Object.assign({},it,{_observationStale:false})}))+'<small>마지막 관측·기록 (신규 실시간 아님)</small></span>';
    if(member.key==='ninepayLive') {
      var labels={watch:'감시',volume_met:'70% 충족',pullback:'첫 눌림',signaled:'신호 확인',invalidated:'재이탈·종료'};
      var branches=it.branches && it.branches.length ? it.branches.join('/') : 'A/B 대기';
      return '<b class="ps-pattern-tag">9Pay '+escapeHtml(branches)+' · '+escapeHtml(labels[it.stage] || it.stage || '미수신')+'</b>';
    }
    if(member.key==='volumeBreakout' && vaBadgesHtml(it))return vaBadgesHtml(it);
    var stage=it._gpStage ? gpStageLabel(it._gpStage) : ((PATTERN_STATE[detail.status] || {}).label || detail.status || '후보');
    return '<b class="ps-pattern-tag">'+escapeHtml(sourceLabel(member.key))+' · '+escapeHtml(stage)+'</b>';
  }
  function financialHtml(it) {
    var f=it.financialScreen; if(!f)return '';
    var a=f.annual || {}, q=f.latest_quarter || {};
    function val(v){return v==null || !isFinite(Number(v))?'미확인':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:1});}
    return '<span class="ps-financial">연간 '+escapeHtml(a.year)+' · ROE '+val(a.roe_pct)+'% · 부채비율 '+val(a.debt_ratio_pct)+'%<br>영업이익 성장 '+val(a.operating_income_yoy_pct)+'% · 순이익 성장 '+val(a.net_income_yoy_pct)+'%<br>최신 '+escapeHtml(q.year)+' '+escapeHtml(QUARTER_NAMES[q.reprt_code] || '')+' 단독분기 영업/순익 '+val(q.operating_income/1e8)+' / '+val(q.net_income/1e8)+'억원<br>공시 '+escapeHtml((f.filing || {}).rcept_dt || '')+' · 확인 '+escapeHtml(String(f.checked_at || '').slice(0,10))+'</span>';
  }
  var QUARTER_NAMES={'11013':'1분기','11012':'2분기','11014':'3분기','11011':'4분기'};
  function scannerDataState(source) {
    if (source === 'ninepayLive') return ninepayData ? 'ready' : ninepayError ? 'error' : 'loading';
    if (source === 'volumeBreakout') {
      if (scanData || liveSurgeInfo && (liveSurgeInfo.active || (liveSurgeInfo.items || []).length)) return 'ready';
      if (!scanSettled || !liveSurgeSettled) return 'loading';
      return scanError || liveSurgeError ? 'error' : 'ready';
    }
    return scanData ? 'ready' : scanSettled ? 'error' : 'loading';
  }
  function emptyUnifiedHtml() {
    var states = groupFor(activeTab).sources.map(scannerDataState);
    if (states.indexOf('loading') >= 0) return global.NineUI.state('loading', '검색 결과를 불러오는 중...', 'ps-hint', {spinner:false});
    if (states.indexOf('error') >= 0) return global.NineUI.state('error', '검색 결과를 확인하지 못했습니다. 잠시 후 다시 조회합니다.', 'ps-hint');
    return '<div class="ps-hint">조건에 맞는 종목이 없다.</div>';
  }

  // Presentation policy only: never changes detector, stored rows or order gates.
  var PUBLIC_LABELS={all:'전체',confirmed:'확정',observation:'관찰',research:'연구',excluded:'제외',expired:'만료'};
  function publicStockVisible(item) {
    if(!item)return false;
    var code=String(item.code || ''), types=global.SCANNER_SECURITY_TYPES || {};
    if(item.is_spac===true || item.isSpac===true || /^(SPAC|기업인수목적회사)$/i.test(item.securityType || item.stockType || ''))return false;
    if((types.spacCodes || []).indexOf(code)>=0)return false;
    if(item.is_spac===false || item.isSpac===false || (types.ordinaryCodes || []).indexOf(code)>=0)return true;
    // Unknown/new listings only: conservative, bounded name fallback (not substring 스팩트럼).
    return !/(?:제?\d+호\s*스팩|스팩\s*제?\d+호|\bSPAC\b|기업인수목적회사|스팩$)/i.test(item.name || '');
  }
  function classifyPublicMember(member,state,now) {
    var it=member.item, d=it.patternDetail || {}, review=it.signalReview || {};
    var stage=String(it._gpStage || d.status || it.stage || '');
    if(it.track || it._history){
      var tracked=it.track && it.track.status;
      if(tracked==='FAILED' || tracked==='EXPIRED')return {key:'expired',reason:tracked==='FAILED'?'과거 패턴 조건 이탈 · 현재 유효 신호 아님':'추적 기간 만료 · 과거 기록'};
      return {key:'research',reason:tracked==='SUCCESS' || tracked==='BREAKOUT_CONFIRMED'?'과거 돌파 성공 · 체결·실현수익·현재 확정과 무관':'과거 패턴 사후 추적 중 · 현재 신호 검증과 별도'};
    }
    if(it.excluded || it.financialScreen && it.financialScreen.passed===false)return {key:'excluded',reason:typeof it.excluded==='string'?it.excluded:'기존 검증 조건에서 제외'};
    if(it.entryInvalid || stage==='invalidated' || stage==='INVALIDATED')return {key:'expired',reason:'조건 무효화 · 현재 유효 신호 아님'};
    if(it._observationMissing)return {key:'research',reason:'관측 시각 미확인 · 현재 신호 검증 미완료'};
    if(it._observationStale)return {key:'expired',reason:'관측 정보 지연 · 현재 유효 신호 아님'};
    var signalMs=Number(it.signalAt)*1000;
    if(member.key==='ninepayLive' && it.signalAt && Number.isFinite(signalMs) && (now-signalMs>10000 || signalMs>now))return {key:'expired',reason:'신호 유효 시간 종료 또는 시각 불일치 · 과거 발생 기록'};
    var reviewMs=Date.parse(review.evaluatedAt || '');
    if(review.mode==='shadow' && Number.isFinite(reviewMs) && (now-reviewMs>36*3600000 || reviewMs>now))return {key:'expired',reason:'검증 자료 유효 기간 종료 · 과거 기록'};
    var proof=publicConfirmation(member,state,now);
    if(proof && proof.shadow && member.key==='ninepayLive')proof=publicConfirmation({key:member.key,item:Object.assign({},it,{signalReview:null})},state,now) || proof;
    if(proof && !proof.shadow)return {key:'confirmed',reason:'기존 A/B 검증 충족 · 주문 승인 별도',proof:proof};
    var pending={COMPRESSION_READY:'이평선 응축 · 돌파 대기',NECKLINE_READY:'바닥 구조 형성 · 넥라인 돌파 대기',WATCH_ACCUM:'매집 관찰 · 추가 확인 대기',WAIT_PULLBACK:'첫 눌림 대기',PULLING_BACK:'눌림 진행 · 재돌파 대기',FIRST_PULLBACK:'첫 눌림 관찰 · 재돌파 대기',watch:'실시간 후보 감시 · 추가 조건 대기',pullback:'첫 눌림 관찰 · 반등 대기',volume_met:'거래량 기준 충족 · 추가 조건 대기',RECOVERY:'회복 관찰 · 추가 확인 대기',APPROACH:'기준선 접근 · 돌파 대기'};
    if(member.key!=='angleMomentum' && pending[stage])return {key:'observation',reason:pending[stage]};
    return {key:'research',reason:review.mode==='shadow'?'Shadow 검증 · 주문 승인과 무관':'패턴 분석 자료 · 현재 신호 검증 미완료'};
  }
  function publicModel(rows,state,now) {
    var counts={confirmed:0,observation:0,research:0,excluded:0,expired:0};
    var priority=['confirmed','observation','research','excluded','expired'];
    var output=rows.filter(publicStockVisible).map(function(row){
      var classified=row.members.map(function(m){
        var observed=row._quoteBasis && row._quoteBasis.indexOf('9Pay 수신')===0?{key:m.key,item:Object.assign({},m.item,{price:row.price})}:m;
        return {member:m,status:classifyPublicMember(observed,state,now)};
      });
      classified.sort(function(a,b){return priority.indexOf(a.status.key)-priority.indexOf(b.status.key);});
      var result=Object.assign({},row,{publicStatus:classified[0].status,classified:classified});
      counts[result.publicStatus.key]++;return result;
    });
    return {rows:output,counts:counts};
  }
  function renderUnifiedList(container) {
    if(trackView!=='all'){renderLegacyUnifiedList(container);return;}
    ensureTrackMap(container);
    var current=unifiedItems(), group=groupFor(activeTab);
    var historyEntries=group.sources.reduce(function(out,key){['active','success','failed'].forEach(function(view){var cache=trackedCache['pattern:'+key+'|'+view];if(cache && cache.data)out.push({key:key,items:(cache.data.tracks || []).map(trackToItem)});});return out;},[]);
    var combined=mergeScannerRows(current.reduce(function(out,row){row.members.forEach(function(m){out.push({key:m.key,items:[m.item]});});return out;},[]).concat(historyEntries));
    var model=publicModel(combined,ninepayData,Date.now());
    var known=group.sources.every(function(key){
      if(scannerDataState(key)!=='ready')return false;
      if(key==='ninepayLive')return Array.isArray(ninepayData.items) && Array.isArray(ninepayData.signals) && !ninepayError && !ninepayData.rankError && !ninepayData.persistenceError && !ninepayData.queueDropped && ninepayData.ruleVersion==='ab70-v1';
      if(key==='volumeBreakout' && liveSurgeInfo && Array.isArray(liveSurgeInfo.items))return !liveSurgeError && !liveSurgeInfo.error;
      var filter=scanData && scanData.longTermFilter;
      return !scanError && scanData && scanData.patterns && Array.isArray(scanData.patterns[key]) && (key!=='longTermQuality' || filter && filter.version===1 && (!filter.excluded || Array.isArray(filter.excludedItems)));
    }) && !current.some(function(row){return row.members.some(function(m){return m.item._observationMissing && !m.item.excluded;});});
    var visible=model.rows.filter(function(r){return publicView==='all'?['confirmed','observation','research'].indexOf(r.publicStatus.key)>=0:r.publicStatus.key===publicView;});
    var countAll=model.counts.confirmed+model.counts.observation+model.counts.research;
    container.querySelectorAll('[data-status]').forEach(function(button){button.setAttribute('aria-pressed',String(button.getAttribute('data-status')===publicView));});
    container.querySelectorAll('[data-status-count]').forEach(function(el){var k=el.getAttribute('data-status-count');el.textContent=known?String(k==='all'?countAll:model.counts[k]):'—';});
    var summary=container.querySelector('#psConfirmationStatus');
    summary.textContent=known?'현재 유효 확정 '+model.counts.confirmed+'종목 · 관찰 '+model.counts.observation+'종목 · 연구 '+model.counts.research+'종목':'일부 자료 확인 중 또는 조회 실패 · 아래는 수신된 기록';
    global.PatternScan.publicSummary={counts:model.counts,known:known};
    if(typeof global.CustomEvent==='function')document.dispatchEvent(new global.CustomEvent('scanner-public-state',{detail:global.PatternScan.publicSummary}));
    var list=container.querySelector('#psList');
    detailNavItems=visible;
    list.innerHTML='<p class="ps-state-meaning">확정은 검색기 검증 충족이며 수익 보장이 아닙니다. 관찰·연구는 매수 지시가 아니며, 과거 돌파 성공은 체결·수익과 별개입니다.<br>집계: 선택한 검색기의 수신 결과·조회된 추적 기록. 전체 과거 이력은 개별 검색기 이력에서 확인합니다.'+(!global.SCANNER_SECURITY_TYPES?' 종목 유형 자료 미수신 · 확인 가능한 유형·이름 기준으로 스팩 제외 중.':'')+'</p>'
      + (visible.length?'': '<p class="ps-state-empty">'+(known?'선택한 상태의 종목이 없습니다.':'자료를 확인하지 못했습니다. 수신 상태와 데이터 기준을 확인해 주세요.')+'</p>')
      + ['confirmed','observation','research','excluded','expired'].map(function(k){var rows=visible.filter(function(r){return r.publicStatus.key===k;});if(!rows.length)return '';return '<section class="ps-state-section" data-section="'+k+'"><h3>'+PUBLIC_LABELS[k]+' '+rows.length+'</h3>'+rows.map(function(r){
        var chosen=r.classified[0].member,it=chosen.item,proof=r.publicStatus.proof || {},review=it.signalReview || {};
        var stamp=it.lastObservedAt || it.sampleAt || it.at || it.scannedAt || (it.patternDetail || {}).scanned_at || it.date;
        var ms=typeof stamp==='number'?stamp*1000:Date.parse(stamp || '');
        var time=Number.isFinite(ms)?new Date(ms).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}):'관측 시각 미확인';
        var base=proof.price || it.signalPrice || review.signalPrice;
        var realtime=chosen.key==='ninepayLive' || chosen.key==='volumeBreakout' && liveSurgeInfo && liveSurgeInfo.active && liveSurgeInfo.dataBasis && liveSurgeInfo.dataBasis.realtime;
        var priceCopy=realtime?'현재가 '+(r.price==null?'미수신':fmt(r.price)):'현재가 미수신 · '+(it.track?'과거 관측가 ':'일봉 관측가 ')+(r.price==null?'미수신':fmt(r.price));
        return '<article class="ps-state-row" data-code="'+escapeHtml(r.code)+'">'
          + '<div class="ps-state-identity"><div class="ps-state-stock">'+stockIconHtml(r.code)+'<strong>'+escapeHtml(r.name || r.code)+'</strong> <small>'+escapeHtml(r.code)+'</small><span class="ps-state-badge" data-state="'+k+'">'+PUBLIC_LABELS[k]+'</span></div>'
          + '<div class="ps-state-patterns">'+escapeHtml(r.members.map(function(m){return sourceLabel(m.key);}).filter(function(v,i,a){return a.indexOf(v)===i;}).join(' · '))+'</div><p>'+escapeHtml(r.publicStatus.reason)+'</p></div>'
          + '<div class="ps-state-quotes">'+priceCopy+' · 기준가 '+(base?fmt(base):'미확인')+'<br>'+escapeHtml(realtime?'실시간 수신':it.track?'과거 기록':'일봉 자료')+' · <time>'+escapeHtml(time)+'</time>'+(proof.stop || review.invalidationPrice?'<br>무효화 기준 '+fmt(proof.stop || review.invalidationPrice):'')+'</div>'
          + '<div class="ps-state-actions"><button type="button" class="ps-state-detail" data-code="'+escapeHtml(r.code)+'" aria-controls="psDetail" aria-expanded="false">상세 차트</button><details><summary>패턴별 근거</summary>'
          + r.classified.map(function(c,index){return '<p>'+escapeHtml(sourceLabel(c.member.key)+' · '+PUBLIC_LABELS[c.status.key]+' · '+c.status.reason)+' <button type="button" class="ps-state-detail" data-code="'+escapeHtml(r.code)+'" data-member="'+index+'">이 패턴 분석</button></p>';}).join('')+'</details></div></article>';
      }).join('')+'</section>';}).join('');
    list.querySelectorAll('.ps-state-detail').forEach(function(button){button.addEventListener('click',function(){
      var r=visible.filter(function(row){return row.code===button.getAttribute('data-code');})[0];
      var m=r.classified[Number(button.getAttribute('data-member') || 0)].member;
      var detail=document.getElementById('psDetail');
      if(detail && !detail.hidden && currentDetailItem && String(currentDetailItem.code)===String(r.code) && currentDetailItem._sourceKey===m.key){closeDetail(container);return;}
      openDetail(container,Object.assign({},m.item,{_sourceKey:m.key}));
    });});
  }
  function renderLegacyUnifiedList(container) {
    var list=container.querySelector('#psList');
    ['#psViewTabs','#psTrackSummary','#psPriceBasis','[data-scanner-review]'].forEach(function(sel){var el=container.querySelector(sel);if(el)el.hidden=false;});
    if(trackView==='success'||trackView==='failed'){renderTrackedList(container);return;}
    ensureTrackMap(container);
    var all=unifiedItems();
    var phaseTwo = activeTab === 'liveFlow' ? phaseTwoEvents() : null;
    if(phaseTwo)phaseTwo=phaseTwo.filter(publicStockVisible);
    var phaseTwoCodes = new Set((phaseTwo || []).map(function (e) { return String(e.code); }));
    var items=all.filter(function(row){return trackView==='all'||(activeTab==='liveFlow' && trackView==='new' ? phaseTwoCodes.has(String(row.code)) : row.members.some(function(m){return m.key===historySource&&itemStage(m.item).key===trackView;}));});
    detailNavItems=items;
    var notice='';
    if(activeTab==='liveFlow') {
      var tabNew = container.querySelector('[data-view=\"new\"]');
      if (tabNew && tabNew.firstChild) tabNew.firstChild.nodeValue = '2차 신호 ';
      var n=ninepayData;
      notice='<div class="ps-unified-note">2차 신호는 A/B 발생 기록입니다. 실제 주문 가능 여부는 PC에서 신호 나이·잔고·제외 조건을 다시 확인합니다. ' + (phaseTwo === null ? '2차 신호 조회 실패 또는 미수신 · ' : '') + '9Pay: '+escapeHtml(ninepayError || (!n?'수신 대기':n.ruleVersion!=='ab70-v1'?'구버전·표시 제외':n.active && !n.rankError && n.rankAt && Date.now()-Date.parse(n.rankAt)<=120000?'장중 감시':'실시간 확인 불가·마지막 기록'))
        +' · '+escapeHtml(liveSurgeInfo?(liveSurgeInfo.active && liveSurgeInfo.dataBasis && liveSurgeInfo.dataBasis.realtime?'거래량 장중 감시':'거래량 실시간 확인 불가·마지막 기록'):'거래량 수신 대기')
        +(n && n.rankError?' · 순위 API 장애: '+escapeHtml(n.rankError):'')
        +(n && n.rankAt?' · 순위 관측 '+escapeHtml(n.rankAt):'')
        +(liveSurgeInfo && liveSurgeInfo.error?' · 거래량 API 부분/전체 장애: '+escapeHtml(liveSurgeInfo.error):'')
        +' · A/B 첫70% '+(n?'14:00 이전 관측 기준':'미확인')+' · 주문·체결 미연동'
        +(n && n.persistenceError?' · 저장 오류: '+escapeHtml(n.persistenceError):'')
        +(n && n.queueDropped?' · 수신 누락 '+escapeHtml(n.queueDropped):'')+'</div>';
    }
    if(activeTab==='longTermQuality') {
      var f=scanData && scanData.longTermFilter;
      notice='<div class="ps-unified-note">'+(f?'기술 후보 '+f.technical+' · 통과 '+f.passed+' · 제외 '+f.excluded+'<br>'+Object.keys(f.reasonCounts || {}).map(function(k){return escapeHtml((f.reasonLabels || {})[k] || k)+' '+f.reasonCounts[k];}).join(' · '):'재무 검증 결과를 준비 중이다. 미확인 종목은 표시하지 않는다.')+'</div>';
    }
    if(activeTab==='pullbackRebreak' && scanData && scanData.gongpasanStages && scanData.gongpasanStages.status!=='ok')notice+='<div class="ps-unified-note">급락 후 첫 눌림의 관찰 단계는 자료가 오래돼 숨겼다.</div>';
    var noRows = activeTab === 'liveFlow' && trackView === 'new' ? (phaseTwo === null ? global.NineUI.state('error', '2차 A/B 신호를 확인하지 못했습니다.', 'ps-hint') : '<div class="ps-hint">확인된 2차 A/B 신호 기록이 없습니다.</div>') : emptyUnifiedHtml();
    list.innerHTML=notice+(items.length?'<div class="ps-list-head" aria-hidden="true"><span>순번</span><span>종목</span><span>최근 20일 흐름</span><span>패턴·단계</span><span>가격·등락률</span><span>관측·재무</span></div>':noRows)
      +items.map(function(it,i){return '<div class="ps-item ps-unified-item" data-code="'+escapeHtml(it.code)+'" tabindex="0" role="button"><span class="ps-rank">'+(i+1)+'</span><div class="ps-stock"><span class="ps-name">'+stockIconHtml(it.code)+escapeHtml(it.name || it.code)+'</span><span class="ps-code">'+escapeHtml(it.code)+'</span></div><div class="ps-mini-chart-wrap">'+miniChartHtml(it)+'</div><div class="ps-pattern-tags">'+it.members.map(memberTagHtml).join('')+'</div><div class="ps-quote"><span class="ps-price">'+(it.price==null?'미수신':fmt(it.price))+'</span><span class="ps-rate '+chgClass(it.changeRate)+'">'+chgSign(it.changeRate)+'</span><small>'+escapeHtml(it._quoteBasis || (it.date || '')+' 스캔 시점')+'</small></div><div class="ps-observation">'+financialHtml(it)+it.members.filter(function(m){return m.key==='ninepayLive';}).map(function(m){var r=m.item;return '<span>70% 최초 '+npTime(r.first70At)+' · 비율 '+(r.volumeRatio==null?'미수신':'≥'+npNumber(r.volumeRatio*100,'%',1))+'<br>신호 '+npTime(r.signalAt)+' · '+npNumber(r.signalPrice,'원')+' · 수신 '+npTime(r.at)+'<br>'+(r.volumeMissing?'거래량 결측 · ':'')+(r.entryInvalid?'진입 무효 · ':'')+(r.priority80?'80% 우선':'80% 미확인')+'</span>';}).join('')+'<small>원래 패턴별 근거는 상세에서 확인</small></div></div>';}).join('');
    list.querySelectorAll('.ps-item').forEach(function(el){function open(){var row=items.filter(function(it){return it.code===el.getAttribute('data-code');})[0];var chosen=row.members.filter(function(m){return m.key===historySource;})[0]||row.members[0];openDetail(container,Object.assign({},chosen.item,{_sourceKey:chosen.key}));}el.addEventListener('click',open);el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
    renderTrackSummary(container);
    // Counts refer to the selected original source, never a sum across patterns.
    var cache=trackedCache[scannerKey(activeTab)+'|active'], stats=cache && cache.data && cache.data.stats;
    var counts={all:all.length,new:activeTab==='liveFlow' ? (phaseTwo === null ? null : phaseTwoCodes.size) : all.filter(function(r){return r.members.some(function(m){return m.key===historySource&&itemStage(m.item).key==='new';});}).length,ready:all.filter(function(r){return r.members.some(function(m){return m.key===historySource&&itemStage(m.item).key==='ready';});}).length,success:stats?stats.success:null,failed:stats?stats.failed:null};
    container.querySelectorAll('#psViewTabs [data-count]').forEach(function(el){var n=counts[el.getAttribute('data-count')];el.textContent=n==null?'':' '+n;});
  }

  // Keep one chart alive while live results replace their row markup.
  function renderList(container) {
    var detail=document.getElementById('psDetail');
    var placeholder=container.querySelector('#psList .de-chart-placeholder');
    if(placeholder)container.appendChild(placeholder);
    if(detail && detail.parentNode!==container && container.contains(detail) && !detail.closest('.de-chart-overlay'))container.appendChild(detail);
    renderListContent(container);
    if(placeholder && currentDetailItem){var row=inlineDetailRow(container,currentDetailItem);if(row)row.insertAdjacentElement('afterend',placeholder);}
    if(currentDetailItem && detail && !detail.hidden && !detail.closest('.de-chart-overlay')){
      if(!placeInlineDetail(container,currentDetailItem) && detail.dataset.inlineCode)closeDetail(container);
    }
  }

  function renderListContent(container) {
    publishDashboard();
    var list = container.querySelector('#psList');
    if (!list) return;
    if (groupFor(activeTab)) { renderUnifiedList(container); return; }
    ['#psViewTabs', '#psTrackSummary', '#psPriceBasis', '[data-scanner-review]'].forEach(function (selector) {
      var el = container.querySelector(selector); if (el) el.hidden = activeTab === 'ninepayLive';
    });
    if (activeTab === 'ninepayLive') { renderNinepay(container); return; }
    if (!scanData) { list.innerHTML = global.NineUI.state('loading', '검색 결과를 불러오는 중...', 'ps-hint', {spinner:false}); return; }

    if (trackView === 'success' || trackView === 'failed') { renderTrackedList(container); return; }
    if (activeTab === 'firstPullbackBreakout' && !scanData.firstPullbackBreakoutReady) {
      list.innerHTML = '<div class="ps-hint">첫 검색 결과를 준비 중이에요. 기존 일봉 수집이 끝난 뒤 자동으로 검색합니다.</div>';
      return;
    }
    ensureTrackMap(container);
    var isGp = activeTab === 'gongpasan';
    var allItems = (isGp ? gpAllItems() : ((scanData.patterns && scanData.patterns[activeTab]) || [])).filter(publicStockVisible);
    var items = allItems.filter(function (it) {
      return trackView === 'all' || itemStage(it).key === trackView;
    });
    if (!items.length) {
      detailNavItems = [];
      list.innerHTML = '<div class="ps-hint">' + (isGp ? gpEmptyText(allItems.length) : (allItems.length
        ? '이 상태에 해당하는 종목이 없어요. 위 상태 칸에서 다른 상태를 보거나 전체를 눌러보세요.'
        : '지금 이 패턴에 해당하는 종목이 없어요.')) + '</div>';
      return;
    }

    // 20개를 넘는 후보에만 차트 품질 게이트를 적용한 뒤, 통과한 후보는 모두 표시한다.
    // 실시간 사전포착 목록은 서버가 정한 순서(초기 먼저, 거래량 속도 순)를 그대로 쓴다.
    var serverOrdered = !!(items[0] && items[0].patternDetail && items[0].patternDetail.live);
    var sorted = serverOrdered ? items.slice() : items.slice().sort(function (a, b) {
      if (isGp && a._gpStage !== b._gpStage) return GP_STAGE_KEYS.indexOf(b._gpStage) - GP_STAGE_KEYS.indexOf(a._gpStage);
      var scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff) return scoreDiff;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    detailNavItems = sorted.slice();

    list.innerHTML = '<div class="ps-list-head" aria-hidden="true">'
      + '<span>순번</span><span>종목</span><span>최근 20일 흐름</span><span>감지 신호</span><span>현재가·등락률</span><span>개별 관측</span>'
      + '</div>'
      + sorted.map(function (it, index) {
      var cc = chgClass(it.changeRate);
      return '<div class="ps-item" data-code="' + escapeHtml(it.code) + '" tabindex="0" role="button" aria-label="' + escapeHtml(it.name) + ' 차트 상세 보기">'
        + '<span class="ps-rank">' + String(index + 1).padStart(2, '0') + '</span>'
        + '<div class="ps-stock">'
        + '<span class="ps-name">' + stockIconHtml(it.code) + '<span>' + escapeHtml(it.name) + '</span></span>'
        + '<span class="ps-code">' + escapeHtml(it.code) + '</span>'
        + '<span class="ps-mobile-signal">' + stageBadgeHtml(it) + escapeHtml(scannerSignal(it, activeTab)) + '</span>'
        + '</div>'
        + '<div class="ps-mini-chart-wrap">' + miniChartHtml(it) + '</div>'
        + '<span class="ps-signal">' + stageBadgeHtml(it) + escapeHtml(scannerSignal(it, activeTab)) + '</span>'
        + '<span class="ps-quote is-scan"'
        + (it.price == null || isNaN(Number(it.price)) ? '' : ' data-scan-price="' + escapeHtml(String(Number(it.price))) + '"')
        + (it.date ? ' data-scan-date="' + escapeHtml(String(it.date)) + '"' : '')
        + ' data-price-word="' + priceWordFor(it) + '"'
        + '><span class="ps-price">' + fmt(it.price) + '</span>'
        + '<span class="ps-rate ' + cc + '">' + chgSign(it.changeRate) + '</span>'
        + '<span class="ps-price-basis">' + priceWordFor(it) + ' 시점</span></span>'
        + '<span class="ps-observation">' + escapeHtml(scannerInterpretation(it, activeTab) + analystTargetPriceText(it)) + performanceTrackingHtml(it) + '</span>'
        + '</div>';
    }).join('');

    list.querySelectorAll('.ps-item').forEach(function (el) {
      var open = function () {
        var code = el.getAttribute('data-code');
        var item = sorted.filter(function (x) { return x.code === code; })[0];
        openDetail(container, item);
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
    patchLivePrices(container);
    renderTrackSummary(container);
    paintStageCounts(container);
  }

  function trackPct(value) {
    var n = Number(value);
    if (value == null || !isFinite(n)) return '-';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function trackTone(value) {
    var n = Number(value);
    return value == null || !isFinite(n) || n === 0 ? 'is-flat' : (n > 0 ? 'is-up' : 'is-down');
  }

  function trackStatusHtml(t) {
    var st = TRACK_STATUS[t.status] || TRACK_STATUS.TRACKING;
    var reason = t.status === 'FAILED' && t.fail_reason ? (TRACK_FAIL_REASON[t.fail_reason] || t.fail_reason) : '';
    return '<span class="ps-track-status ' + st.tone + '">' + escapeHtml(st.label) + (reason ? '<span class="ps-track-fail-reason">' + escapeHtml(reason) + '</span>' : '') + '</span>';
  }

  function scannerReviewHtml(stats) {
    if (!stats || !stats.total) return '';
    var failed = Number(stats.failed || 0), total = Number(stats.total);
    var rate = failed / total * 100;
    return '<div class="ps-scanner-review' + (failed * 10 >= total * 4 ? ' is-review' : '') + '">'
      + (failed * 10 >= total * 4 ? '<b>검색기 수정 대상</b> · ' : '')
      + '돌파실패 ' + failed + '/' + total + '건 (' + rate.toFixed(1) + '%)'
      + ' · 최근 ' + escapeHtml(stats.days || 90) + '일 포착 기준 · 40% 이상이면 수정 대상</div>';
  }

  function trackStatsHtml(stats) {
    if (!stats || !stats.total) return '<div class="ps-track-stats is-empty">이 검색기의 추적 기록이 아직 없어요. 다음 스캔부터 포착 종목이 쌓입니다.</div>';
    function cell(label, value) { return '<span><small>' + escapeHtml(label) + '</small><b>' + escapeHtml(value) + '</b></span>'; }
    return '<div class="ps-track-stats">'
      + cell('최근 ' + stats.days + '일 포착', stats.total + '건')
      + cell('추적 중', stats.active + '건')
      + cell('돌파 성공', (stats.success || 0) + '건' + (stats.total ? ' (' + Math.round((stats.success || 0) / stats.total * 100) + '%)' : ''))
      + cell('돌파 실패', (stats.failed || 0) + '건 (' + ((stats.failed || 0) / stats.total * 100).toFixed(1) + '%)')
      + cell('평균 5일', trackPct(stats.avgRet5Pct))
      + cell('평균 10일', trackPct(stats.avgRet10Pct))
      + cell('평균 최대 상승', trackPct(stats.avgMaxReturnPct))
      + cell('평균 최대 하락', trackPct(stats.avgMaxDrawdownPct))
      + '</div>';
  }

  function trackToItem(t) {
    var snap = t.snapshot || {};
    return { code: t.code, name: t.name, date: t.detected_date, price: t.detected_close, score: t.initial_score,
      patternDetail: snap, reasons: snap.reasons || [], interpretation: snap.interpretation || '', track: t, _sourceKey: String(t.scanner || scannerKey(activeTab)).replace(/^pattern:/,'') };
  }

  function renderTrackedList(container) {
    var list = container.querySelector('#psList');
    if (!list) return;
    var key = scannerKey(activeTab);
    var cacheKey = key + '|' + trackView;
    var cached = trackedCache[cacheKey];
    function paint(data) {
      if (scannerKey(activeTab) !== key || (trackView !== 'success' && trackView !== 'failed')) return;
      var tracks = ((data && data.tracks) || []).filter(publicStockVisible);
      var head = trackStatsHtml(data && data.stats);
      var review = container.querySelector('[data-scanner-review]');
      if (review) review.innerHTML = scannerReviewHtml(data && data.stats);
      if (!tracks.length) {
        detailNavItems = [];
        list.innerHTML = head + '<div class="ps-hint">' + (trackView === 'success' ? '아직 돌파 성공(포착가 대비 장중 +5%)한 종목이 없어요.' : '아직 5일선 이탈로 돌파 실패한 종목이 없어요.') + '</div>';
        return;
      }
      var byCode = {};
      detailNavItems = tracks.map(trackToItem);
      list.innerHTML = head + '<div class="ps-track-head" aria-hidden="true"><span>종목</span><span>포착일</span><span>상태</span><span>포착가 → 현재가</span><span>경과</span><span>최대 상승/하락</span></div>'
        + tracks.map(function (t, index) {
          byCode[t.id] = detailNavItems[index];
          var ret = t.detected_close && t.current_close != null ? (t.current_close / t.detected_close - 1) * 100 : null;
          return '<div class="ps-track-row" data-track-id="' + t.id + '" tabindex="0" role="button">'
            + '<span class="ps-name">' + stockIconHtml(t.code) + '<span>' + escapeHtml(t.name) + '</span></span>'
            + '<span>' + escapeHtml(scanDateLabel(t.detected_date) || t.detected_date) + '</span>'
            + trackStatusHtml(t)
            + '<span>' + fmt(t.detected_close) + ' → ' + (t.current_close == null ? '-' : fmt(t.current_close)) + ' <em class="' + trackTone(ret) + '">' + escapeHtml(trackPct(ret)) + '</em></span>'
            + '<span>' + escapeHtml(String(t.tracking_days || 0)) + '거래일</span>'
            + '<span><em class="is-up">' + escapeHtml(trackPct(t.max_return_pct)) + '</em> / <em class="is-down">' + escapeHtml(trackPct(t.max_drawdown_pct)) + '</em></span>'
            + '</div>';
        }).join('');
      list.querySelectorAll('.ps-track-row').forEach(function (el) {
        var open = function () { openDetail(container, byCode[el.getAttribute('data-track-id')]); };
        el.addEventListener('click', open);
        el.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
        });
      });
    }
    if (cached && Date.now() - cached.at < 120000) { paint(cached.data); return; }
    list.innerHTML = '<div class="ps-hint">추적 기록 불러오는 중...</div>';
    fetchJson(PATTERN_TRACKS_URL + '?scanner=' + encodeURIComponent(key) + '&view=' + trackView + '&days=90&limit=150')
      .then(function (envelope) {
        var data = envelope && envelope.data ? envelope.data : envelope;
        trackedCache[cacheKey] = { at: Date.now(), data: data };
        paint(data);
      })
      .catch(function () {
        if (scannerKey(activeTab) !== key) return;
        list.innerHTML = '<div class="ps-error">추적 기록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function buildTrackBox(t) {
    var scoreChange = t.initial_score != null && t.current_score != null ? (t.current_score - t.initial_score).toFixed(0) : null;
    function row(label, value) { return '<div><small>' + escapeHtml(label) + '</small><b>' + value + '</b></div>'; }
    var ret = t.detected_close && t.current_close != null ? (t.current_close / t.detected_close - 1) * 100 : null;
    return '<div class="ps-track-box">'
      + '<div class="ps-track-box-head">' + trackStatusHtml(t) + '<span>패턴 포착일 ' + escapeHtml(t.detected_date) + ' · 추적 ' + escapeHtml(String(t.tracking_days || 0)) + '거래일째</span></div>'
      + '<div class="ps-track-box-grid">'
      + row('포착가', fmt(t.detected_close))
      + row('현재가', (t.current_close == null ? '-' : fmt(t.current_close)) + ' <em class="' + trackTone(ret) + '">' + escapeHtml(trackPct(ret)) + '</em>')
      + row('포착 당시 지지 / 저항', (t.initial_support == null ? '-' : fmt(t.initial_support)) + ' / ' + (t.initial_resistance == null ? '-' : fmt(t.initial_resistance)))
      + row('최대 상승 / 하락', '<em class="is-up">' + escapeHtml(trackPct(t.max_return_pct)) + '</em> / <em class="is-down">' + escapeHtml(trackPct(t.max_drawdown_pct)) + '</em>')
      + row('점수 (포착 → 현재)', escapeHtml((t.initial_score == null ? '-' : t.initial_score) + ' → ' + (t.current_score == null ? '조건 이탈' : t.current_score) + (scoreChange == null ? '' : ' (' + (scoreChange > 0 ? '+' : '') + scoreChange + ')')))
      + (t.breakout_date ? row('돌파일', escapeHtml(t.breakout_date) + (t.breakout_quality != null ? ' · 신뢰도 ' + t.breakout_quality : '')) : '')
      + '</div>'
      + '<div class="ps-track-box-note">종가 기준 사후 추적입니다. 포착 당시 값은 바뀌지 않으며, 매수 추천이나 수익 보장이 아닙니다.</div>'
      + '</div>';
  }

  function addTrackMarkers(LWC, series, daily, t) {
    if (!t) return;
    var has = {};
    daily.forEach(function (d) { has[d.date] = true; });
    var markers = [];
    if (has[t.detected_date]) markers.push({ time: t.detected_date, position: 'belowBar', color: '#111827', shape: 'arrowUp', text: '포착' });
    if (t.breakout_date && has[t.breakout_date]) markers.push({ time: t.breakout_date, position: 'aboveBar', color: '#d24f45', shape: 'arrowUp', text: '돌파' });
    if (t.status === 'FAILED' && t.closed_date && has[t.closed_date]) markers.push({ time: t.closed_date, position: 'aboveBar', color: '#1261c4', shape: 'arrowDown', text: '실패' });
    if (t.status === 'BREAKOUT_CONFIRMED' && t.closed_date && has[t.closed_date]) markers.push({ time: t.closed_date, position: 'aboveBar', color: '#d24f45', shape: 'circle', text: '유지' });
    if (t.status === 'EXPIRED' && t.closed_date && has[t.closed_date]) markers.push({ time: t.closed_date, position: 'aboveBar', color: '#64748b', shape: 'square', text: '만료' });
    markers.sort(function (a, b) { return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
    if (markers.length) LWC.createSeriesMarkers(series, markers);
    function line(price, color, title) {
      if (price == null || !isFinite(Number(price))) return;
      series.createPriceLine({ price: Number(price), color: color, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: title });
    }
    line(t.initial_support, '#1261c4', '포착 지지');
    line(t.initial_resistance, '#d24f45', '포착 저항');
  }

  // ---- 가격 시점 구분: 스캔 시점 스냅샷 vs 지금 ----
  //
  // 2026-09-02: 전략검색은 2026-09-01에 같은 처리를 받았는데(js/strategy-search.js) 그때
  // 커밋 제목이 "차트검색"이었을 뿐 이 파일은 손대지 않았다. 그래서 이 목록의
  // `현재가·등락률`은 하루 1회 스캔 시점 값인데 라벨이 없었다 - 장중에는 종일 그 값에
  // 고정되고 등락률도 어제 것이 남는다.
  //
  // 점수·순위·감지 신호는 스캔 시점이 맞는 값이라 그대로 두고 가격·등락률만 덮어쓴다.
  // 실시간 값이 없으면 `스캔 시점`이라고 밝힌다 - 값을 못 갱신하는 것보다 어느 시점
  // 값인지 모르는 게 더 나쁘다.
  var LIVE_QUOTE_TTL_MS = 30000;
  var LIVE_QUOTE_DEBOUNCE_MS = 250;
  var LIVE_QUOTE_MAX_CODES = 60;
  var liveQuoteCache = {};
  var liveQuoteTimer = null;
  var liveQuoteSeq = 0;

  function cachedQuote(code) {
    var hit = liveQuoteCache[code];
    return (hit && Date.now() - hit.at < LIVE_QUOTE_TTL_MS) ? hit.data : null;
  }

  function gapPercent(livePrice, scanPrice) {
    if (scanPrice == null || livePrice == null) return null;
    if (!isFinite(scanPrice) || !isFinite(livePrice) || !scanPrice) return null;
    return (livePrice - scanPrice) / scanPrice * 100;
  }

  // 2026-09-13 사용자 요청("어제 이 검색기들의 등락을 눈으로 아 이렇구나 알고 싶어"):
  // 스캔 시각은 그대로(장 마감 직후 1회) 두고 표시만 바꾼다. 스캔가 대비 지금 등락을
  // 회색 10px 글자로만 붙였고 값이 같으면 아예 숨겼는데, 스캔 이후 얼마나 움직였는지가
  // 이 목록을 보는 이유라 색 배지로 올리고 움직이지 않았어도(0.0%) 보여준다.
  // 스캔일·스캔가는 옆에 작게 둔다.
  function scanDateLabel(value) {
    var m = String(value || '').match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    return m ? m[2] + '/' + m[3] : '';
  }
  // 가격 기준 라벨: 장중 감지(초기 급증·실시간 매집)는 '감지', 일봉 매집봉·일봉 스캔은 '스캔'. 행에 priceBasis가 없으면 기존 규칙을 따른다.
  function priceWordFor(item) {
    var basis = item && item.patternDetail && item.patternDetail.priceBasis;
    if (basis === 'DETECT') return '감지';
    if (basis === 'SCAN') return '스캔';
    return activeTab === 'volumeBreakout' && liveSurgeInfo ? '감지' : '스캔';
  }

  function scanGapHtml(livePrice, scanPrice, scanDate, word) {
    var gap = gapPercent(livePrice, scanPrice);
    if (gap == null) return '';
    var rounded = Math.round(gap * 10) / 10;
    var tone = rounded > 0 ? 'is-up' : (rounded < 0 ? 'is-down' : 'is-flat');
    var sign = rounded > 0 ? '+' : (rounded < 0 ? '-' : '');
    var date = scanDateLabel(scanDate);
    word = word || (activeTab === 'volumeBreakout' && liveSurgeInfo ? '감지' : '스캔');
    return '<b class="ps-scan-gap ' + tone + '">' + word + ' 대비 ' + sign + Math.abs(rounded).toFixed(1) + '%</b>'
      + '<span class="ps-scan-ref">' + (date ? escapeHtml(date) + ' ' : '') + word + '가 ' + fmt(scanPrice) + '원</span>';
  }

  function markPriceBasis(container, live) {
    var meta = container.querySelector('#psPriceBasis');
    if (!meta) return;
    var isLiveSurge = activeTab === 'volumeBreakout' && liveSurgeInfo;
    meta.textContent = live && isLiveSurge
      ? '가격·등락률은 방금 조회한 실시간 값이고, 감지 신호는 감지 시점 기준입니다. "감지 대비"는 감지가에서 지금까지 움직인 폭입니다.'
      : live
      ? '가격·등락률은 방금 조회한 실시간 값이고, 순위·감지 신호는 스캔 시점 기준입니다. "스캔 대비"는 스캔가에서 지금까지 움직인 폭입니다.'
      : '실시간 시세를 불러오지 못해 가격·등락률도 스캔 시점 값을 그대로 보여줍니다.';
    meta.className = 'ps-price-basis-note' + (live ? '' : ' is-stale');
  }

  function applyLiveQuotes(container, items, byCode) {
    Array.prototype.forEach.call(items, function (row) {
      var live = byCode[row.getAttribute('data-code')];
      if (!live || live.price == null || isNaN(live.price)) return;
      var quote = row.querySelector('.ps-quote');
      if (!quote) return;
      var scanPrice = Number(quote.getAttribute('data-scan-price'));
      var priceEl = quote.querySelector('.ps-price');
      var basisEl = quote.querySelector('.ps-price-basis');
      if (priceEl) priceEl.textContent = fmt(live.price);
      if (basisEl) basisEl.innerHTML = scanGapHtml(Number(live.price), scanPrice, quote.getAttribute('data-scan-date'), quote.getAttribute('data-price-word'));
      quote.className = quote.className.replace('is-scan', 'is-live');
      var rateEl = quote.querySelector('.ps-rate');
      if (rateEl && live.changeRate != null && !isNaN(live.changeRate)) {
        rateEl.textContent = chgSign(live.changeRate);
        rateEl.className = 'ps-rate ' + chgClass(live.changeRate);
      }
    });
  }

  function patchLivePrices(container) {
    var rows = container.querySelectorAll('.ps-item[data-code]');
    if (!rows.length) return;
    var fresh = {};
    var missing = [];
    Array.prototype.forEach.call(rows, function (row) {
      var code = row.getAttribute('data-code');
      if (!code || !/^\d{6}$/.test(code)) return;
      var hit = cachedQuote(code);
      if (hit) fresh[code] = hit;
      else if (missing.indexOf(code) === -1) missing.push(code);
    });

    if (Object.keys(fresh).length) applyLiveQuotes(container, rows, fresh);
    if (!missing.length) {
      if (Object.keys(fresh).length) markPriceBasis(container, true);
      return;
    }

    clearTimeout(liveQuoteTimer);
    var seq = ++liveQuoteSeq;
    liveQuoteTimer = setTimeout(function () {
      global.NineAPI.domesticQuotes(missing.slice(0, LIVE_QUOTE_MAX_CODES), {request:PatternScan.fetchJson})
        .then(function (list) {
          var byCode = {};
          (list || []).forEach(function (d) {
            if (!d || d.code == null) return;
            byCode[String(d.code)] = d;
            liveQuoteCache[String(d.code)] = { data: d, at: Date.now() };
          });
          if (seq !== liveQuoteSeq) return;   // 그사이 탭이 바뀌었다 - 늦은 응답은 버린다
          applyLiveQuotes(container, container.querySelectorAll('.ps-item[data-code]'), byCode);
          markPriceBasis(container, true);
        })
        .catch(function () {
          if (seq !== liveQuoteSeq) return;
          markPriceBasis(container, false);
        });
    }, LIVE_QUOTE_DEBOUNCE_MS);
  }

  // ---- 상세(캔들차트 + 패턴선) ----

  function inlineDetailRow(container,item) {
    var rows=container.querySelectorAll('#psList .ps-state-row, #psList .ps-item, #psList .ps-track-row');
    return Array.prototype.find.call(rows,function(el){return el.getAttribute('data-code')===String(item.code) || item.track && el.getAttribute('data-track-id')===String(item.track.id);});
  }
  function placeInlineDetail(container,item) {
    var detail=document.getElementById('psDetail');
    if(!detail || detail.closest('.de-chart-overlay'))return false;
    var row=inlineDetailRow(container,item);
    container.querySelectorAll('.ps-state-detail').forEach(function(button){
      var on=!!row && button.closest('.ps-state-row')===row;
      button.setAttribute('aria-expanded',String(on));
      button.setAttribute('aria-controls','psDetail');
      if(!button.hasAttribute('data-member'))button.textContent=on?'차트 닫기':'상세 차트';
    });
    if(!row)return false;
    row.insertAdjacentElement('afterend',detail);
    detail.dataset.inlineCode=String(item.code);
    return true;
  }

  function openDetail(container, item) {
    if(!publicStockVisible(item))return;
    var detail = document.getElementById('psDetail');
    if (!detail || !item) return;
    var requestSeq = ++detailRequestSeq;
    var requestPattern = item._sourceKey || (groupFor(activeTab) ? historySource : activeTab);
    if (requestPattern === 'longTermQuality') requestPattern = 'maCloudBreakout';
    currentDetailItem = item;
    destroyPsChart();
    psIchimokuEnabled = false;
    detail.hidden = false;
    detail.innerHTML = global.NineUI.state('loading', item.name + ' 차트를 불러오는 중...', 'ps-loading', {spinner:false});
    placeInlineDetail(container,item);

    var chartUrl = GAS_TICKER_URL + '?patternChart=1&code=' + encodeURIComponent(item.code)
      + '&pattern=' + encodeURIComponent(requestPattern) + '&scanDate=' + encodeURIComponent(item.date || '');
    function loadFromGas() {
      return fetchWithRetry(chartUrl, function (data) {
        return data && !data.error && Array.isArray(data.daily);
      });
    }
    // 재판정이 필요 없는 탭은 VM에서 캔들만 받아 곧바로 그린다. detail은 어차피 목록
    // 스냅샷에서 오므로(아래 !data.detail 분기) 화면 내용은 GAS 경유와 같다.
    var chartRequest = GAS_REDETECTED_PATTERNS[requestPattern]
      ? loadFromGas()
      : PatternScan.fetchJson(KIWOOM_VM_URL + '/flow-chart/' + encodeURIComponent(item.code))
          .then(function (envelope) {
            var d = envelope && envelope.data ? envelope.data : envelope;
            if (!d || d.error || !Array.isArray(d.daily) || !d.daily.length) throw new Error('VM 캔들 없음');
            return { code: item.code, daily: d.daily, pattern: requestPattern, detail: null };
          })
          .catch(loadFromGas);
    chartRequest
      .then(function (data) {
        if (requestSeq !== detailRequestSeq || currentDetailItem !== item || !detail.isConnected) return;
        if (data.error || !data.daily || !data.daily.length) {
          detail.innerHTML = '<div class="ps-error">' + escapeHtml((data && data.message) || '차트를 불러오지 못했어요.') + '</div>';
          return;
        }
        // Box-range scans include market cap in the VM snapshot; GAS cannot
        // reproduce that E condition during an on-demand chart request.
        if (item.patternDetail) {
          data.detail = item.patternDetail;
        }
        // 리스트는 하루 1회 스캔 캐시라서, 클릭 시 실시간 재검증에서 패턴이 더 이상
        // 안 잡힐 수 있음(그 사이 가격이 움직여서) - 이 경우 깨진 결과를 보여주는 대신
        // 목록에서 바로 빼서 다음에 같은 종목을 다시 클릭하지 않게 한다.
        if (!data.detail) {
          // GAS 새 버전 배포 전이거나 일시적으로 재현이 실패해도, 전날 스캔 목록에 저장된
          // 점수/근거를 사용해 최신 차트는 계속 보여준다. 목록 삭제나 경고 토스트는 하지 않는다.
          data.detail = item.patternDetail || {
            score: item.score,
            reasons: item.reasons || [],
            interpretation: item.interpretation || '',
            snapshotFallback: true
          };
        }
        renderDetail(detail, item, data);
      })
      .catch(function () {
        if (requestSeq !== detailRequestSeq || currentDetailItem !== item || !detail.isConnected) return;
        detail.innerHTML = '<div class="ps-error">차트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function closeDetail(container) {
    var detail = document.getElementById('psDetail');
    var overlay=detail && detail.closest('.de-chart-overlay');
    if(overlay){var restore=overlay.querySelector('.de-chart-restore');if(restore)restore.click();}
    detailRequestSeq += 1;
    currentDetailItem = null;
    if (detail) { detail.hidden = true; detail.innerHTML = ''; delete detail.dataset.inlineCode; destroyPsChart(); }
    if(container)container.querySelectorAll('.ps-state-detail').forEach(function(button){button.setAttribute('aria-expanded','false');if(!button.hasAttribute('data-member'))button.textContent='상세 차트';});
  }

  function detailItemIndex(item) {
    for (var i = 0; i < detailNavItems.length; i++) {
      if (detailNavItems[i] === item || (detailNavItems[i].code === item.code && String(detailNavItems[i].date || '') === String(item.date || ''))) return i;
    }
    return -1;
  }

  function buildDetailSwitcher(item) {
    var index = detailItemIndex(item);
    var options = detailNavItems.map(function (candidate, i) {
      return '<option value="' + i + '"' + (i === index ? ' selected' : '') + '>'
        + escapeHtml(candidate.name + ' · ' + candidate.code) + '</option>';
    }).join('');
    return '<div class="ps-chart-switcher" aria-label="차트 종목 전환">'
      + '<button type="button" class="ps-chart-nav" data-ps-chart-prev' + (index <= 0 ? ' disabled' : '') + ' aria-label="이전 종목">〈 이전</button>'
      + '<label><span class="sr-only">차트 종목 선택</span><select data-ps-chart-select>' + options + '</select></label>'
      + '<button type="button" class="ps-chart-nav" data-ps-chart-next' + (index < 0 || index >= detailNavItems.length - 1 ? ' disabled' : '') + ' aria-label="다음 종목">다음 〉</button>'
      + '</div>';
  }

  function wireDetailSwitcher(box) {
    var select = box.querySelector('[data-ps-chart-select]');
    function openIndex(index) {
      var item = detailNavItems[index];
      if (item) openDetail(rootContainer, item);
    }
    if (select) select.addEventListener('change', function () { openIndex(Number(select.value)); });
    var prev = box.querySelector('[data-ps-chart-prev]');
    var next = box.querySelector('[data-ps-chart-next]');
    if (prev) prev.addEventListener('click', function () { openIndex(detailItemIndex(currentDetailItem) - 1); });
    if (next) next.addEventListener('click', function () { openIndex(detailItemIndex(currentDetailItem) + 1); });
  }

  // 2026-10-11 자동매매 연동(소유자 전용): 이 PC의 로컬 봇(127.0.0.1:8765)이 켜져 있고 이 브라우저에 접속 토큰이 있을 때만
  // "자동매매 감시 추가" 버튼이 보인다. 매수는 하지 않고, 감시에 올린 종목의 보유분만 봇이 손절·익절한다. 다른 방문자에게는 보이지 않는다.
  var AUTO_TRADER_API = 'http://127.0.0.1:8765';
  var AUTO_TRADER_TOKEN_KEY = 'autotrader_token_v1';

  function autoTraderCall(path, method, body) {
    var token = '';
    try { token = global.localStorage.getItem(AUTO_TRADER_TOKEN_KEY) || ''; } catch (e) { token = ''; }
    if (!token || typeof fetch !== 'function') return Promise.reject(new Error('no token'));
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 1500) : null;
    var headers = { 'X-AutoTrader-Token': token };
    var init = { method: method || 'GET', headers: headers, cache: 'no-store', signal: controller ? controller.signal : undefined };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(AUTO_TRADER_API + path, init).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  function wireAutoTradeBar(box, item) {
    var bar = box.querySelector('[data-ps-autotrade]');
    if (!bar || !item || !/^\d{6}$/.test(String(item.code || ''))) return;
    function paint(watching) {
      bar.hidden = false;
      bar.innerHTML = '<button type="button" class="ui-btn ui-btn-secondary" data-at-toggle>' + (watching ? '자동매매 감시 해제' : '자동매매 감시 추가') + '</button>'
        + '<span>' + (watching ? '감시 중 - 직접 매수하면 봇이 손절(-3%)·익절(+3~5%)을 자동으로 처리합니다' : '매수는 직접 하고, 감시에 올리면 보유분의 손절·익절만 자동으로 합니다') + '</span>';
      bar.querySelector('[data-at-toggle]').addEventListener('click', function () {
        autoTraderCall(watching ? '/api/unwatch' : '/api/watch', 'POST', { code: String(item.code), name: String(item.name || '') })
          .then(function (res) { paint(!!(res.watch || []).some(function (w) { return w.code === String(item.code); })); })
          .catch(function () { bar.hidden = true; });
      });
    }
    autoTraderCall('/api/watch').then(function (res) {
      if (!box.isConnected) return;
      paint(!!(res.watch || []).some(function (w) { return w.code === String(item.code); }));
    }).catch(function () { /* 봇이 꺼져 있거나 이 PC가 아니면 버튼을 만들지 않는다 */ });
  }

  function renderDetail(box, item, data) {
    var chartHeight = box.closest('.de-chart-overlay') ? Math.max(720, Math.round(global.innerHeight * 0.88)) : CHART_H;
    var html = buildDetailSwitcher(item) + '<div class="ps-detail-head">'
      + '<span class="ps-detail-name">' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name) + ' <span class="ps-code">(' + escapeHtml(item.code) + ')</span></span>'
      + '<span class="ps-timeframe-badge">일봉 · 1D</span></span>'
      + '<button type="button" class="ps-close" id="psClose">닫기 ✕</button>'
      + '</div>';
    html += '<details class="ps-analysis-notes"><summary>패턴 분석·검증·추적 근거</summary>';
    if (item.track) html += buildTrackBox(item.track);
    html += buildGpStageBox(data.detail);
    html += buildVolumeAccumBox(data.detail);
    html += buildScoreBox(data.detail);
    if(item.signalReview) {
      var review=item.signalReview;
      var labels={completedPattern:'패턴 완성',dailyTrend:'일봉 추세',support:'지지 유지',stopDistance:'손절 거리',chase:'추격 위험',volumeStructure:'거래량 구조',relativeStrength:'시장 대비 강도',weeklyTrend:'확정 주봉',monthlyTrend:'확정 월봉',longAverage:'장기 이평 방향',longBreakout:'장기 저항 돌파',marketRegime:'시장 환경',financials:'재무 관문',dataFresh:'자료 최신성'};
      html+='<details class="ps-condition-fold" open><summary>신호 검증 근거 · Shadow Mode</summary><p>기준 '+escapeHtml(review.dataAsOf || '장중 관측')+' · 판정 '+escapeHtml(review.confirmedAt || '미확정')+' · 주문 허가 없음</p><p>'
        +Object.keys(review.checks || {}).map(function(k){return escapeHtml(labels[k] || k)+': '+(review.checks[k]?'확인':'미충족·미확인');}).join(' · ')
        +'</p><p>무효화 기준 '+(review.invalidationPrice>0?fmt(review.invalidationPrice)+'원 이하':'미확인')+' · 수익성 미입증 · 실제 체결·비용은 별도 기록</p></details>';
    }
    html += '</details><div class="ps-chart-options" aria-label="차트 표시 옵션">';
    html += buildMovingAverageLegend(data.daily);
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psIchimokuToggle"' + (psIchimokuEnabled ? ' checked' : '') + ' /> 일목균형표(구름) 표시</label>';
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psBollingerToggle"' + (psBollingerEnabled ? ' checked' : '') + ' /> 볼린저 밴드</label>';
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psSupportResistanceToggle"' + (psSrEnabled ? ' checked' : '') + ' /> 지지·저항 표시</label>';
    var volumeKnown=hasPsVolume(data.daily);
    html += '<label><input type="checkbox" data-ps-volume'+(psVolumeEnabled && volumeKnown?' checked':'')+(volumeKnown?'':' disabled')+'> 거래량'+(volumeKnown?'':' (자료 미확인)')+'</label></div>';
    html += '<div class="ps-chart-tools" aria-label="차트 도구">'+[['line','직선'],['pencil','연필'],['circle','원'],['box','박스'],['hline','가로선'],['measure','측정'],['clear','지우기']].map(function(tool){return '<button type="button" class="ui-btn ui-btn-secondary" data-ps-draw="'+tool[0]+'" aria-pressed="false" disabled>'+tool[1]+'</button>';}).join('')
      + '<button type="button" class="ui-btn ui-btn-secondary" data-ps-zoom="0.7" disabled>확대</button><button type="button" class="ui-btn ui-btn-secondary" data-ps-zoom="1.4" disabled>축소</button><button type="button" class="ui-btn ui-btn-secondary" data-ps-fit disabled>전체 보기</button><span data-ps-tools-status role="status">도구 준비 중</span></div>';
    html += buildIchimokuLegend();
    html += '<div class="ps-pattern-legend">'
      + '<span><i class="ps-pattern-line ps-pattern-line-shape"></i>패턴 형성 근거</span>'
      + '<span><i class="ps-pattern-line ps-pattern-line-level"></i>넥라인 · 지지/저항</span>'
      + '</div>';
    html += '<div class="ps-memo-bar"><button type="button" class="ui-btn ui-btn-secondary" data-ps-memo aria-pressed="false" disabled title="차트의 봉을 눌러 메모를 남깁니다">메모</button><span>로그인하면 계정에, 아니면 이 브라우저에 저장됩니다</span></div>';
    html += '<div class="ps-autotrade-bar" data-ps-autotrade hidden></div>';
    html += '<div class="ps-chart" id="psChart" style="height:' + chartHeight + 'px"></div>';
    html += (currentDetailItem && currentDetailItem._sourceKey || activeTab) === 'firstPullbackBreakout'
      ? '<div class="ps-footnote">장 마감 후 일봉 종가로 재돌파를 확인한 결과입니다. 다음 거래일 가격과 눌림 저점 이탈 여부를 다시 확인하세요. 테스트 중인 검색 조건이며 1시간 상승 예측이나 승률을 뜻하지 않습니다.</div>'
      : '<div class="ps-footnote">확정 일봉 '+data.daily.length+'개와 저장된 신호 근거를 표시합니다. 현재 시세·진입 유효성·주문 허가·실제 체결은 별도이며, 연구 후보와 확정 상태는 검증 근거에서 구분합니다.</div>';
    box.innerHTML = html;
    wireDetailSwitcher(box);

    var closeBtn = box.querySelector('#psClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeDetail(rootContainer); });

    var srToggle = box.querySelector('#psSupportResistanceToggle');
    if (srToggle) {
      srToggle.addEventListener('change', function () {
        psSrEnabled = srToggle.checked;
        if (!psSrEnabled) {
          if (psSrCleanup) { psSrCleanup(); psSrCleanup = null; }
        } else if (psSrCtx && psLwcChart === psSrCtx.chart) {
          setupPsSupportResistance(psSrCtx.container, psSrCtx.chart, psSrCtx.series, psSrCtx.daily, psSrCtx.referencePrice);
        }
      });
    }
    var ichiToggle = box.querySelector('#psIchimokuToggle');
    var bollingerToggle = box.querySelector('#psBollingerToggle');
    if (bollingerToggle) bollingerToggle.addEventListener('change', function () {
      psBollingerEnabled = bollingerToggle.checked;
      if (psBollingerEnabled) addPsBollinger(data.daily); else removePsBollinger();
    });
    var ichiLegend = box.querySelector('.ps-ichimoku-legend');
    if (ichiLegend) ichiLegend.hidden = !psIchimokuEnabled;
    if (ichiToggle) {
      ichiToggle.addEventListener('change', function () {
        psIchimokuEnabled = ichiToggle.checked;
        if (ichiLegend) ichiLegend.hidden = !psIchimokuEnabled;
        if (psIchimokuEnabled) addIchimokuOverlay(data.daily); else removeIchimokuOverlay();
      });
    }

    box.onchange=function(event){var input=event.target;if(!input.hasAttribute('data-ps-ma'))return;var period=input.getAttribute('data-ps-ma');psMaVisibility[period]=input.checked;if(psMaSeries[period])psMaSeries[period].applyOptions({visible:input.checked});};
    var volumeToggle=box.querySelector('[data-ps-volume]');
    if(volumeToggle)volumeToggle.addEventListener('change',function(){psVolumeEnabled=volumeToggle.checked;setPsVolume(data.daily);});
    psMemoItem = item;
    psTrackCtx = item.track || null;
    wireAutoTradeBar(box, item);
    var chartContainer = box.querySelector('#psChart');
    if (chartContainer) {
      renderPatternChart(chartContainer, data.daily, data.pattern, data.detail, item.price);
      loadPatternRangeModule().then(function (api) {
        if (!chartContainer.isConnected || currentDetailItem !== item) return;
        api.installRangeButtons(chartContainer, item.code, function () { return data; }, function (newData) {
          if (newData && newData.daily && newData.daily.length) {
            data.daily = newData.daily;
            data.extendedHistory = !!newData.extendedHistory;
            chartContainer.parentElement.dataset.extendedHistory = data.extendedHistory ? '1' : '';
            if(volumeToggle){volumeToggle.disabled=!hasPsVolume(data.daily);volumeToggle.checked=psVolumeEnabled && !volumeToggle.disabled;volumeToggle.nextSibling.textContent=volumeToggle.disabled?' 거래량 (자료 미확인)':' 거래량';}
          }
          renderPatternChart(chartContainer, data.daily, data.pattern, data.detail, item.price);
          var legend = box.querySelector('.ps-moving-average-legend');
          if (legend) legend.outerHTML = buildMovingAverageLegend(data.daily);
        });
      }).catch(function () { /* 차트 자체는 계속 표시 */ });
    }
  }

  // 일목균형표는 패턴별 오버레이(지지/저항/스윙 dot)와 별개의 보조지표라 기본은 꺼둔 채
  // 체크박스로 켤 수 있게 한다(js/foreign-flow.js와 같은 색상 배정 - 사이트 전체 일관성).
  var psIchimokuEnabled = false;
  var psBollingerEnabled = false;
  var psBollingerSeries = [];

  function addPsBollinger(daily) {
    if (!psLwcChart || psBollingerSeries.length || !global.NineChartCore) return;
    psBollingerSeries = global.NineChartCore.addBollingerBands(psLwcChart, global.LightweightCharts, daily);
  }

  function removePsBollinger() {
    psBollingerSeries.forEach(function (series) { try { psLwcChart.removeSeries(series); } catch (e) { /* 이미 제거됨 */ } });
    psBollingerSeries = [];
  }

  function buildIchimokuLegend() {
    return '<div class="ps-ichimoku-legend"' + (psIchimokuEnabled ? '' : ' hidden') + '>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.senkouA + '"></i>선행스팬1</span>'
      + '<span class="ps-legend-item"><i class="ps-dot" style="background:' + ICHIMOKU_COLORS.senkouB + '"></i>선행스팬2</span>'
      + '</div>';
  }

  function latestMovingAverage(daily, period) {
    if (!Array.isArray(daily) || daily.length < period) return null;
    var sum = 0;
    for (var i = daily.length - period; i < daily.length; i++) sum += Number(daily[i].close) || 0;
    return sum / period;
  }

  function buildMovingAverageLegend(daily) {
    return '<div class="ps-moving-average-legend" aria-label="가격 이동평균선">'
      + standardMovingAverageStudies().map(function (study) {
        var latest = latestMovingAverage(daily, study.period);
        return '<label class="ps-ma-legend-item ps-' + study.key + '"><input type="checkbox" data-ps-ma="'+study.period+'"'+(psMaVisibility[study.period]!==false?' checked':'')+' disabled><i></i>'
          + study.label + ' <b>' + (latest == null ? '—' : psChartPriceFormatter(latest)) + '</b></label>';
      }).join('')
      + '</div>';
  }

  // '장중 거래량 급증' 상세: 유형·거래량 배율·분배 위험·데이터 기준. 판단 근거 목록은 아래 점수 박스(reasons)에 신호별로 붙는다.
  function buildVolumeAccumBox(detail) {
    if (!detail || (currentDetailItem && currentDetailItem._sourceKey || activeTab) !== 'volumeBreakout' || !vaSignals(detail).length) return '';
    var risk = (detail.distribution && detail.distribution.risk) || 'LOW';
    var flags = ((detail.distribution && detail.distribution.flags) || []).map(function (f) { return VA_FLAG[f] || f; });
    var rows = vaSignals(detail).map(function (sg) {
      var basis = sg.type === 'REALTIME_ACCUM'
        ? '장중 30초 표본으로 만든 5분봉 ' + (sg.barsUsed != null ? sg.barsUsed + '개' : '') + ' · RVOL은 단순 시간비례 근사'
        : '일봉(확정 종가) 기준 · 장중에는 현재가·거래량으로 갱신';
      var mult = sg.type === 'REALTIME_ACCUM' ? sg.rvol : sg.volumeMultiple;
      return '<dt>' + escapeHtml(VA_TYPE[sg.type]) + (sg.status === 'pending' ? ' (판정 보류)' : '') + '</dt><dd>'
        + (mult != null ? '거래량 배율 ' + Number(mult).toFixed(2) + '배 · ' : '') + '점수 ' + escapeHtml(sg.score) + ' · ' + escapeHtml(basis) + '</dd>';
    }).join('');
    return '<div class="ps-gp-box ps-va-box">'
      + '<div class="ps-gp-box-head"><b class="ps-stage ps-risk is-' + String(risk).toLowerCase() + '">분배 위험 ' + escapeHtml(VA_RISK[risk] || risk) + '</b>'
      + '<span>' + (flags.length ? escapeHtml(flags.join(' · ')) : '분배 의심 신호 없음') + '</span></div>'
      + '<div class="ps-gp-warn">매집을 확정하는 신호가 아니며 방향을 보장하지 않습니다. 데이터가 부족한 항목은 판정을 보류합니다.</div>'
      + '<dl>' + rows + '</dl></div>';
  }

  // 급락 후 첫 눌림목 중간 단계(1~3단계) 상세: 통과한 조건 / 아직 못 채운 조건 / 기준가 / 무효 조건. 점수는 최종 신호에만 있다.
  function buildGpStageBox(detail) {
    if (!detail || !detail.stage || (currentDetailItem && currentDetailItem._sourceKey || activeTab) !== 'gongpasan') return '';
    function list(arr) {
      return (arr && arr.length) ? '<ul>' + arr.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul>' : '<span>-</span>';
    }
    var gap = Number(detail.ma20GapPct);
    var cls = String(detail.stage).toLowerCase();
    return '<div class="ps-gp-box is-' + cls + '">'
      + '<div class="ps-gp-box-head"><b class="ps-stage ps-gp-badge is-' + cls + '">' + escapeHtml(detail.stageLabel || '') + '</b>'
      + '<span>단계 시작 ' + escapeHtml(detail.stageSince || '-') + ' · 데이터 기준일 ' + escapeHtml(detail.asOf || '-') + '</span></div>'
      + '<div class="ps-gp-warn">최종 매수 신호(4단계 지지 확인)가 아닙니다. 관찰용 단계입니다.</div>'
      + '<dl>'
      + '<dt>통과한 조건</dt><dd>' + list(detail.met) + '</dd>'
      + '<dt>아직 못 채운 조건</dt><dd>' + list(detail.unmet) + '</dd>'
      + (detail.breakoutLevel != null ? '<dt>돌파 기준가</dt><dd>' + fmt(detail.breakoutLevel) + '원 (돌파일 ' + escapeHtml(detail.breakoutDate || '-') + ')</dd>' : '')
      + (detail.ma20 != null ? '<dt>20일선·현재가</dt><dd>20일선 ' + fmt(detail.ma20) + '원 · 현재가 ' + fmt(detail.close) + '원 (' + (isFinite(gap) ? (gap > 0 ? '+' : '') + gap.toFixed(1) + '%' : '-') + ')</dd>' : '')
      + (detail.daysSinceBreakout != null && detail.stage !== 'WATCH_ACCUM' ? '<dt>돌파 후 경과</dt><dd>' + detail.daysSinceBreakout + '거래일 (최대 20거래일)</dd>' : '')
      + '<dt>무효화 조건</dt><dd>' + escapeHtml(detail.invalid || '-') + '</dd>'
      + '</dl></div>';
  }

  // 점수 + 원인(부분점수) + AI 한 줄 해석 - 지시서 원칙("결과에는 점수 + 원인 + AI 한 줄 해석을
  // 함께 제공한다")을 그대로 반영. 점수는 GAS가 수치 조건으로만 계산(임의 판단 없음).
  function buildScoreBox(detail) {
    if (!detail || detail.score == null) return '';
    var reasons = (detail.reasons || []).map(function (r) {
      return '<li>' + escapeHtml(r) + '</li>';
    }).join('');
    return '<div class="ps-score-box">'
      + '<div class="ps-score-big">' + detail.score + '<span class="ps-score-unit">점</span></div>'
      + '<div class="ps-score-body">'
      + (detail.interpretation ? '<div class="ps-interp">' + escapeHtml(detail.interpretation) + '</div>' : '')
      + (reasons ? '<ul class="ps-reasons">' + reasons + '</ul>' : '')
      + '</div>'
      + '</div>';
  }

  // ---- 캔들차트 (TradingView Lightweight Charts, CDN 지연 로드) ----

  var LWC_CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';
  var lwcLoadPromise = null;
  var psLwcChart = null;         // 현재 렌더된 차트 인스턴스(재조회/닫기 시 정리용)
  var psChartRegistryOff = null;
  var psLwcThemeObserver = null; // html.dark 토글에 맞춰 차트 색상 실시간 갱신
  var psRangePromise = null;
  function loadPatternRangeModule() {
    if (global.NineChartData) return Promise.resolve(global.NineChartData);
    if (psRangePromise) return psRangePromise;
    psRangePromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/chart-data.js?v=20261014-history2';
      script.onload = function () { global.NineChartData ? resolve(global.NineChartData) : reject(new Error('chart-data')); };
      script.onerror = function () { psRangePromise = null; reject(new Error('chart-data')); };
      document.head.appendChild(script);
    });
    return psRangePromise;
  }

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

  var psCorePromise = null;
  function loadPatternChartCore() {
    if (global.NineChartCore) return Promise.resolve(global.NineChartCore);
    if (psCorePromise) return psCorePromise;
    psCorePromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = PATTERN_CORE_URL;
      script.onload = function () { global.NineChartCore ? resolve(global.NineChartCore) : reject(new Error('chart-core')); };
      script.onerror = function () { psCorePromise = null; reject(new Error('chart-core')); };
      document.head.appendChild(script);
    });
    return psCorePromise;
  }

  // 차트 메모(2026-10-03): 종목분석과 같은 공용 모듈(js/chart-memo.js)을 지연 로드한다.
  var psMemoItem = null;
  var psMemo = null;
  var psMemoPromise = null;
  function loadPsMemoModule() {
    if (window.NineChartMemo) return Promise.resolve(window.NineChartMemo);
    if (psMemoPromise) return psMemoPromise;
    psMemoPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/chart-memo.js';
      s.onload = function () { resolve(window.NineChartMemo); };
      s.onerror = function () { psMemoPromise = null; reject(new Error('chart-memo load failed')); };
      document.head.appendChild(s);
    });
    return psMemoPromise;
  }
  function setupPsMemo(container, chart, series, daily) {
    var button = document.querySelector('[data-ps-memo]');
    var item = psMemoItem;
    if (!button || !item) return;
    button.disabled = true;
    loadPsMemoModule().then(function (api) {
      if (!document.body.contains(container) || psLwcChart !== chart) return;
      psMemo = api.install({
        container: container, chart: chart, series: series, bars: daily, code: item.code, name: item.name,
        formatPrice: function (p) { return Number(p).toLocaleString() + '원'; }
      });
      button.disabled = false;
      button.onclick = function () {
        var on = !psMemo.isMode();
        if(on && psDrawingCtl)psDrawingCtl.setMode(null);
        psMemo.setMode(on);
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
      };
    }).catch(function () { /* 메모 모듈을 못 받아도 차트는 그대로 */ });
  }
  function destroyPsMemo() {
    if (psMemo) { psMemo.dispose(); psMemo = null; }
    var b = document.querySelector('[data-ps-memo]');
    if (b) { b.onclick = null; b.disabled = true; b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); }
  }

  // 지지·저항(공용 모듈 js/chart-sr.js): 실시간 검색·종목분석 차트와 같은 계산·그림(2026-10-04 사용자 지적:
  // 차트검색에는 지지/저항이 적용돼 있지 않았다). 지지=붉은색, 저항=파란색.
  var psSrPromise = null;
  var psSrEnabled = false;
  var psSrCtx = null;
  var psSrCleanup = null;
  function loadPsSrModule() {
    if (window.NineChartSR) return Promise.resolve(window.NineChartSR);
    if (psSrPromise) return psSrPromise;
    psSrPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/chart-sr.js?v=20261013-rounded-labels1';
      sc.onload = function () { resolve(window.NineChartSR); };
      sc.onerror = function () { psSrPromise = null; reject(new Error('chart-sr load failed')); };
      document.head.appendChild(sc);
    });
    return psSrPromise;
  }
  function setupPsSupportResistance(container, chart, series, daily, referencePrice) {
    psSrCtx = { container: container, chart: chart, series: series, daily: daily, referencePrice: referencePrice };
    if (!psSrEnabled) return;
    loadPsSrModule().then(function (api) {
      if (!document.body.contains(container) || psLwcChart !== chart || !psSrEnabled || psSrCleanup) return;
      var result = api.levels(daily, referencePrice);
      if (!result.support.length && !result.resistance.length) return;
      psSrCleanup = api.install(container, chart, series, result, function (p) { return psChartPriceFormatter(p); }, { isUs: false });
    }).catch(function () { /* 지지·저항을 못 받아도 차트는 그대로 */ });
  }

  function destroyPsChart() {
    psChartGeneration++;
    if(psDrawingCtl){psDrawingCtl.detach();psDrawingCtl=null;}
    clearPsVolume();psMaSeries={};
    if (psChartRegistryOff) { psChartRegistryOff(); psChartRegistryOff = null; }
    if (psPanCleanup) { psPanCleanup(); psPanCleanup = null; }
    if (psSrCleanup) { psSrCleanup(); psSrCleanup = null; }
    destroyPsMemo();
    if (psLwcThemeObserver) { psLwcThemeObserver.disconnect(); psLwcThemeObserver = null; }
    if (psLwcChart) {
      try { psLwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
      psLwcChart = null;
    }
    psIchimokuSeries = []; // chart.remove()가 시리즈까지 다 정리하므로 참조만 비움
    psBollingerSeries = [];
    psIchimokuCloudPrimitive = null;
  }

  // ---- 일목균형표(구름) ----
  // js/foreign-flow.js의 computeIchimoku와 완전히 동일한 계산(전환선9/기준선26/선행스팬B52/
  // 26영업일 이동) - 두 페이지가 같은 종목에서 다른 구름을 보여주면 안 되므로 로직을 그대로 옮김.
  // Lightweight Charts v5 migration: Series Primitives remain supported, while series
  // creation and markers use the v5 APIs below. The official Bands Indicator pattern
  // (useBitmapCoordinateSpace + timeToCoordinate/priceToCoordinate) is used for the cloud.
  function ichimokuPeriodMid(daily, i, period) {
    var start = i - period + 1;
    if (start < 0) return null;
    var hi = -Infinity, lo = Infinity;
    for (var k = start; k <= i; k++) {
      if (daily[k].high > hi) hi = daily[k].high;
      if (daily[k].low < lo) lo = daily[k].low;
    }
    return (hi + lo) / 2;
  }

  function nextBusinessDates(lastDate, count) {
    var d = new Date(lastDate + 'T00:00:00');
    var out = [];
    while (out.length < count) {
      d.setDate(d.getDate() + 1);
      var dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function computeIchimoku(daily) {
    var n = daily.length;
    var tenkan = new Array(n).fill(null);
    var kijun = new Array(n).fill(null);
    for (var i = 0; i < n; i++) {
      tenkan[i] = ichimokuPeriodMid(daily, i, ICHIMOKU_TENKAN_PERIOD);
      kijun[i] = ichimokuPeriodMid(daily, i, ICHIMOKU_KIJUN_PERIOD);
    }
    var futureDates = nextBusinessDates(daily[n - 1].date, ICHIMOKU_DISPLACEMENT);
    function timeAt(idx) { return idx < n ? daily[idx].date : futureDates[idx - n]; }

    var tenkanPts = [], kijunPts = [], senkouAPts = [], senkouBPts = [], chikouPts = [];
    for (var j = 0; j < n; j++) {
      if (tenkan[j] != null) tenkanPts.push({ time: daily[j].date, value: tenkan[j] });
      if (kijun[j] != null) kijunPts.push({ time: daily[j].date, value: kijun[j] });
      if (tenkan[j] != null && kijun[j] != null) {
        senkouAPts.push({ time: timeAt(j + ICHIMOKU_DISPLACEMENT), value: (tenkan[j] + kijun[j]) / 2 });
      }
      var spanB = ichimokuPeriodMid(daily, j, ICHIMOKU_SENKOU_B_PERIOD);
      if (spanB != null) senkouBPts.push({ time: timeAt(j + ICHIMOKU_DISPLACEMENT), value: spanB });
      var laggingIdx = j - ICHIMOKU_DISPLACEMENT;
      if (laggingIdx >= 0) chikouPts.push({ time: daily[laggingIdx].date, value: daily[j].close });
    }
    return { tenkan: tenkanPts, kijun: kijunPts, senkouA: senkouAPts, senkouB: senkouBPts, chikou: chikouPts };
  }

  var psIchimokuSeries = [];        // 토글 off 시 이 시리즈들만 골라 제거(캔들/MA/패턴선은 유지)
  var psIchimokuCloudPrimitive = null; // { series, primitive } - 구름 채우기 플러그인 인스턴스

  // 선행스팬1(A)·2(B)를 같은 시각끼리 짝지어 { time, a, b } 배열로 만든다. 두 계열은 필요
  // 기간이 달라(A=9·26일선 평균이라 26영업일째부터, B=52일 중간값이라 52영업일째부터
  // 값이 생김) 시작 시점이 어긋나므로, B가 있는 시각만 골라 교집합을 만든다.
  function pairIchimokuBand(aPts, bPts) {
    var bMap = {};
    for (var i = 0; i < bPts.length; i++) bMap[bPts[i].time] = bPts[i].value;
    var out = [];
    for (var j = 0; j < aPts.length; j++) {
      var t = aPts[j].time;
      if (Object.prototype.hasOwnProperty.call(bMap, t)) out.push({ time: t, a: aPts[j].value, b: bMap[t] });
    }
    return out;
  }

  // TradingView 공식 "Bands Indicator" 플러그인 예제와 같은 구조(Series Primitive) -
  // drawBackground()에서 캔들/선보다 먼저 그려지게 해서 구름이 항상 배경에 깔리게 한다.
  // 선행스팬1·2 사이를 테두리 없는 옅은 하늘색으로 채운다.
  function createIchimokuCloudPrimitive(bandPts, cloudColor) {
    return {
      _chart: null,
      _series: null,
      attached: function (params) { this._chart = params.chart; this._series = params.series; },
      detached: function () { this._chart = null; this._series = null; },
      updateAllViews: function () {},
      paneViews: function () {
        var self = this;
        return [{
          renderer: function () {
            return {
              draw: function () {},
              drawBackground: function (target) {
                var chart = self._chart, series = self._series;
                if (!chart || !series) return;
                target.useBitmapCoordinateSpace(function (scope) {
                  var ctx = scope.context;
                  var hRatio = scope.horizontalPixelRatio, vRatio = scope.verticalPixelRatio;
                  var timeScale = chart.timeScale();
                  var pts = bandPts.map(function (p) {
                    var x = timeScale.timeToCoordinate(p.time);
                    var yA = series.priceToCoordinate(p.a);
                    var yB = series.priceToCoordinate(p.b);
                    if (x == null || yA == null || yB == null) return null;
                    return { x: x * hRatio, yA: yA * vRatio, yB: yB * vRatio };
                  });
                  ctx.save();
                  for (var k = 0; k < pts.length - 1; k++) {
                    var p0 = pts[k], p1 = pts[k + 1];
                    if (!p0 || !p1) continue;
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.yA);
                    ctx.lineTo(p1.x, p1.yA);
                    ctx.lineTo(p1.x, p1.yB);
                    ctx.lineTo(p0.x, p0.yB);
                    ctx.closePath();
                    ctx.fillStyle = cloudColor;
                    ctx.fill();
                  }
                  ctx.restore();
                });
              }
            };
          }
        }];
      }
    };
  }

  // 2026-07-22: 전환선/기준선/후행스팬은 구름(선행스팬1·2) 대비 부가 정보라 사용자 요청으로
  // 화면에서 뺌 - computeIchimoku는 senkouA 계산에 tenkan/kijun이 필요해 그대로 두고, 여기서
  // 그리는 선만 구름 경계선(선행스팬1·2) 2개로 줄인다.
  function addIchimokuOverlay(daily) {
    if (!psLwcChart || psIchimokuSeries.length || !daily || daily.length < ICHIMOKU_SENKOU_B_PERIOD) return;
    var ichi = computeIchimoku(daily);
    var seriesByKey = {};
    [['senkouA', ichi.senkouA], ['senkouB', ichi.senkouB]].forEach(function (pair) {
      var key = pair[0], pts = pair[1];
      if (!pts.length) return;
      var series = psLwcChart.addSeries(global.LightweightCharts.LineSeries, { color: ICHIMOKU_BORDER_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      series.setData(pts);
      psIchimokuSeries.push(series);
      seriesByKey[key] = series;
    });

    // 구름 채우기 - primitive API가 없는 예전 빌드일 가능성에 대비해 실패해도 위 5개 선은
    // 그대로 남도록 try/catch로 감싼다(사이트 전체 CDN을 공유하므로 안전 우선).
    if (seriesByKey.senkouA && typeof seriesByKey.senkouA.attachPrimitive === 'function') {
      try {
        var bandPts = pairIchimokuBand(ichi.senkouA, ichi.senkouB);
        if (bandPts.length > 1) {
          var cloudPrimitive = createIchimokuCloudPrimitive(bandPts, ICHIMOKU_CLOUD_FILL);
          seriesByKey.senkouA.attachPrimitive(cloudPrimitive);
          psIchimokuCloudPrimitive = { series: seriesByKey.senkouA, primitive: cloudPrimitive };
        }
      } catch (e) { /* primitive 렌더링 실패해도 선 5개는 이미 그려져 있음 */ }
    }
  }

  function removeIchimokuOverlay() {
    if (psLwcChart) {
      if (psIchimokuCloudPrimitive) {
        try { psIchimokuCloudPrimitive.series.detachPrimitive(psIchimokuCloudPrimitive.primitive); } catch (e) { /* 무시 */ }
      }
      psIchimokuSeries.forEach(function (s) { try { psLwcChart.removeSeries(s); } catch (e) { /* 이미 제거됐으면 무시 */ } });
    }
    psIchimokuSeries = [];
    psIchimokuCloudPrimitive = null;
  }

  function psThemeOptions() {
    var dark = document.documentElement.classList.contains('dark');
    return {
      // TODO: attributionLogo:false는 Apache 2.0 라이선스상 NOTICE 고지+tradingview.com
      // 링크를 사이트 어딘가에 별도로 넣어야 함(사용자가 나중에 문서 만들 예정, 아직 미작성).
      layout: { background: { color: 'transparent' }, textColor: dark ? '#a6b5c5' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#37424e' : '#eee' },
        horzLines: { color: dark ? '#37424e' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#37424e' : '#ddd' },
      timeScale: { borderColor: dark ? '#37424e' : '#ddd' }
    };
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  // 실제 트레이딩뷰 엔진으로 캔들 + MA(눌림목만) + 패턴 오버레이를 렌더링.
  var psPanCleanup = null;
  var psChartGeneration=0, psDrawingCtl=null, psVolumeCtl=null;
  var psVolumeEnabled=true, psMaVisibility={}, psMaSeries={};
  function hasPsVolume(daily) {
    return daily.length>0 && daily.every(function(bar){
      var value=bar.volume;
      return (typeof value==='number' || typeof value==='string' && value.trim()!=='') && Number.isFinite(Number(value)) && Number(value)>=0;
    });
  }
  function clearPsVolume() {
    if(!psVolumeCtl)return;
    psVolumeCtl.destroy();
    [psVolumeCtl.volume,psVolumeCtl.ma20 && psVolumeCtl.ma20.series,psVolumeCtl.ma5 && psVolumeCtl.ma5.series].forEach(function(series){if(series && psLwcChart)try{psLwcChart.removeSeries(series);}catch(e){}});
    psVolumeCtl=null;
  }
  function setPsVolume(daily) {
    clearPsVolume();
    if(!psVolumeEnabled || !psLwcChart || !hasPsVolume(daily))return;
    psVolumeCtl=global.NineChartCore.addVolumePane(psLwcChart,global.LightweightCharts,daily,{pane:1});
    var panes=psLwcChart.panes();if(panes[1])panes[1].setHeight(90);
  }
  function setupPsChartTools(container,chart,series,daily) {
    var core=global.NineChartCore, box=container.closest('.ps-detail');
    box.querySelectorAll('[data-ps-ma]').forEach(function(input){input.disabled=!psMaSeries[input.getAttribute('data-ps-ma')];});
    box.querySelectorAll('[data-ps-zoom]').forEach(function(button){button.disabled=false;button.onclick=function(){core.zoomBars(container,Number(button.getAttribute('data-ps-zoom')));};});
    var fit=box.querySelector('[data-ps-fit]');fit.disabled=false;fit.onclick=function(){core.fitBars(container);};
    var status=box.querySelector('[data-ps-tools-status]');
    core.loadModule('drawing').then(function(Drawing){
      if(psLwcChart!==chart || !container.isConnected)return;
      var buttons={};box.querySelectorAll('[data-ps-draw]').forEach(function(button){buttons[button.getAttribute('data-ps-draw')]=button;});
      psDrawingCtl=Drawing.attach({core:core,container:container,chart:chart,series:series,bars:daily,key:String(currentDetailItem.code),timeframe:'day',
        className:'ps-drawing-layer',bounds:'pricePane',point:'anchored',tools:['line','pencil','circle','box','hline','measure'],buttons:buttons,
        store:{key:function(code,tf){return 'tistory-ticker:pattern-drawings:'+code+':'+tf;},kinds:['lines','paths','circles','hlines','boxes'],legacyArray:true},
        sync:false,disableButtonsOnDetach:true});
      Object.keys(buttons).forEach(function(key){
        var button=buttons[key], handler=button.onclick;
        button.onclick=function(){
          if(psMemo && psMemo.isMode()){psMemo.setMode(false);var memo=box.querySelector('[data-ps-memo]');memo.classList.remove('is-active');memo.setAttribute('aria-pressed','false');}
          if(handler)handler.call(button);
        };
      });
      status.textContent='이 브라우저에 저장 · 우클릭으로 그리기 해제';
    }).catch(function(){if(psLwcChart===chart)status.textContent='그리기 도구를 불러오지 못했습니다. 차트를 다시 열어 주세요.';});
  }
  // 가로 스크롤 없이 컨테이너 폭에 autoSize로 맞춰 한눈에 들어오게 한다.
  function renderPatternChart(container, daily, pattern, detail, currentPrice) {
    destroyPsChart();
    var generation=psChartGeneration;
    Promise.all([loadLightweightCharts(), loadPatternChartCore()]).then(function (loaded) {
      var LWC = loaded[0];
      if (generation!==psChartGeneration || !document.body.contains(container)) return; // 로딩 중 다른 종목/탭으로 이동했으면 중단
      var chartHeight = container.closest('.de-chart-overlay') ? Math.max(720, Math.round(global.innerHeight * 0.88)) : CHART_H;

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: chartHeight,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: false, secondsVisible: false },
        localization: { priceFormatter: psChartPriceFormatter }
      }, psThemeOptions()));
      psLwcChart = chart;
      psChartRegistryOff = global.NineChartCore.registerChart(container, chart, { bars: daily.length, timeframe: 'day' });
      psPanCleanup = global.NineChartCore.installVerticalPan(chart, container, {
        priceSeries: function () { return candleSeries; }
      });

      var candleSeries = global.NineChartCore.addCandles(chart, LWC, daily);

      // 패턴 종류와 관계없이 실시간 시세 차트와 같은 5·20·60·224일선을 항상 표시한다.
      var ma224Series = null;
      standardMovingAverageStudies().forEach(function (study) {
        var series = addMaLine(chart, daily, study.period, study.color);
        psMaSeries[study.period]=series;if(series)series.applyOptions({visible:psMaVisibility[study.period]!==false});
        if (study.period === 224) ma224Series = series;
      });

      // 패턴 자체가 별도 장기선/목표선을 사용하는 경우에만 추가 보조선을 겹쳐 표시한다.
      if (pattern === 'pullback') {
        addMaLine(chart, daily, 240, MA240_COLOR);
      } else if (pattern === 'gongpasan') {
        // 파란점선(엔벨로프 상단 = 46일선*1.12)을 목표가 참고선으로 추가한다.
        addEnvelopeLine(chart, daily, 46, 1.12, RESIST_COLOR);
      }

      addPatternOverlay(LWC, chart, candleSeries, daily, pattern, detail);
      addTrackMarkers(LWC, candleSeries, daily, psTrackCtx);

      if (psIchimokuEnabled) addIchimokuOverlay(daily);
      if (psBollingerEnabled) addPsBollinger(daily);

      // 기본 화면은 최근 약 1년의 거래일을 보여준다.
      var visibleBars = Math.min(252, daily.length);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, daily.length - visibleBars),
        to: daily.length - 1 + 3
      });
      loadPatternRangeModule().then(function (api) {
        if (psLwcChart !== chart) return;
        var dates = api.rangeDates(daily, String(currentDetailItem && currentDetailItem.code || ''));
        if (dates) chart.timeScale().setVisibleRange(dates);
        api.loadOnLeftScroll(chart, container, String(currentDetailItem && currentDetailItem.code || ''),
          function () { return { extendedHistory: !!(container.parentElement && container.parentElement.dataset.extendedHistory) }; });
      }).catch(function () { /* 기존 500봉 뷰 유지 */ });

      setPsVolume(daily);
      setupPsChartTools(container,chart,candleSeries,daily);
      setupPsMemo(container, chart, candleSeries, daily);
      setupPsSupportResistance(container, chart, candleSeries, daily, currentPrice);

      psLwcThemeObserver = new MutationObserver(function () {
        chart.applyOptions(psThemeOptions());
        if (ma224Series) ma224Series.applyOptions({ color: ma224Color() });
      });
      psLwcThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }).catch(function () {
      if(generation===psChartGeneration && container.isConnected)container.innerHTML = '<div class="ps-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // 종가 N일 이동평균선을 라인 시리즈로 그림(눌림목 전용)
  function addMaLine(chart, daily, period, color) {
    var pts = global.NineChartCore.movingAveragePoints(daily, 'close', period);
    if (pts.length < 2) return null;
    return global.NineChartCore.addMovingAverageLine(chart, global.LightweightCharts,
      { color: color, width: period === 224 ? 3 : 1 }, pts);
  }

  // 종가 N일 단순이동평균에 배율을 곱한 엔벨로프선(공파산 탭의 파란점선 전용) - 점선으로
  // 그려서 실제 이평선(addMaLine)과 시각적으로 구분한다.
  function addEnvelopeLine(chart, daily, period, mult, color) {
    var pts = [];
    var sum = 0;
    for (var i = 0; i < daily.length; i++) {
      sum += daily[i].close;
      if (i >= period) sum -= daily[i - period].close;
      if (i >= period - 1) pts.push({ time: daily[i].date, value: (sum / period) * mult });
    }
    if (pts.length < 2) return;
    chart.addSeries(global.LightweightCharts.LineSeries, {
      color: color, lineWidth: 1, lineStyle: global.LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false
    }).setData(pts);
  }

  // 패턴별 지지/저항선 + 스윙 포인트 dot + 확인(signal) 지점을 라인 시리즈/마커로 오버레이.
  // (예전 SVG 버전의 polyline/hline/dot/signalRing을 Lightweight Charts 프리미티브로 대체)
  function addPatternOverlay(LWC, chart, candleSeries, daily, pattern, detail) {
    if (!detail) return;
    var markers = [];

    function idxByDate(date) {
      for (var i = 0; i < daily.length; i++) if (daily[i].date === date) return i;
      return -1;
    }
    // 여러 점을 순서대로 잇는 선(쌍바닥/역헤드앤숄더의 실제 굴곡을 그대로 표현하기 위함).
    // 근거선은 캔들 위에서도 즉시 읽히도록 전부 최대 굵기(4px) 실선으로 표시한다.
    function addLine(points, color, opts) {
      var data = (points || []).filter(function (p) { return p && idxByDate(p.date) >= 0; })
        .map(function (p) { return { time: p.date, value: p.price }; });
      if (data.length < 2) return;
      var o = opts || {};
      chart.addSeries(LWC.LineSeries, {
        color: color,
        lineWidth: 4,
        lineStyle: LWC.LineStyle.Solid,
        priceLineVisible: false, lastValueVisible: false
      }).setData(data);
    }
    // fromDate를 주면 그 지점부터 마지막 캔들까지만 수평선을 그림(패턴 구간만 강조, 전체 폭 X)
    function addHLine(price, fromDate, color) {
      var fromIdx = fromDate ? idxByDate(fromDate) : -1;
      if (fromIdx < 0) fromIdx = 0;
      var lastDate = daily[daily.length - 1].date;
      addLine([{ date: daily[fromIdx].date, price: price }, { date: lastDate, price: price }], color);
    }
    function addDot(p, color, position, size) {
      if (!p || idxByDate(p.date) < 0) return;
      markers.push({ time: p.date, position: position, color: color, shape: 'circle', size: size || 1 });
    }
    // 확인/매수 검토 지점 강조 (참고 이미지의 핑크색 원 컨벤션)
    function addSignal(p) {
      if (!p || idxByDate(p.date) < 0) return;
      markers.push({ time: p.date, position: 'inBar', color: SIGNAL_COLOR, shape: 'circle' });
    }

    if (pattern === 'risingLows') {
      // low_swings_display는 마지막 스윙 저점 뒤에 "오늘"(현재가)까지 이어붙인 배열 -
      // 패턴이 이미 끝난 게 아니라 지금도 진행 중임을 보여주기 위함
      var lows = detail.low_swings_display || detail.low_swings || [];
      var highs = detail.high_swings || [];
      addLine(lows, SUPPORT_COLOR, { bold: true });
      addLine(highs, RESIST_COLOR, { bold: true });
      (detail.low_swings || []).forEach(function (p) { addDot(p, SUPPORT_COLOR, 'belowBar'); });
      highs.forEach(function (p) { addDot(p, RESIST_COLOR, 'aboveBar'); });
      if (detail.signal) addSignal(detail.signal); // 오늘(현재가) - 항상 최근 봉 기준
    } else if (pattern === 'doubleBottom') {
      // 왼쪽 고점(leftPeak) -> 저점1 -> 넥라인(중간 반등 고점) -> 저점2 -> 현재가 순서로 이어야
      // 위-아래-위-아래-위, 진짜 W자 모양이 나온다(leftPeak 없으면 저점1부터 시작 - 예전과 동일).
      // 굵은 실선 + 큰 점으로 그려서 눈으로 W 모양이 바로 보이게 강조.
      if (detail.low1 && detail.neckline && detail.low2) {
        var dbPoints = [];
        if (detail.leftPeak) dbPoints.push(detail.leftPeak);
        dbPoints.push(detail.low1, detail.neckline, detail.low2);
        if (detail.current) dbPoints.push(detail.current);
        addLine(dbPoints, SUPPORT_COLOR, { bold: true });
        addHLine(detail.neckline.price, detail.low1.date, RESIST_COLOR);
        addDot(detail.low1, SUPPORT_COLOR, 'belowBar', 1.8);
        addDot(detail.low2, SUPPORT_COLOR, 'belowBar', 1.8);
        addDot(detail.neckline, RESIST_COLOR, 'aboveBar', 1.5);
        if (detail.signal) addSignal(detail.signal);
      }
    } else if (pattern === 'invHeadShoulders') {
      // 좌어깨 -> 좌고점 -> 헤드 -> 우고점 -> 우어깨 -> 현재가 순서로 이어 봉우리 2개 + 최근 흐름까지 표현
      var seq = [detail.left_shoulder, detail.left_peak, detail.head, detail.right_peak, detail.right_shoulder];
      if (seq.every(function (p) { return !!p; })) {
        if (detail.current) seq.push(detail.current);
        addLine(seq, SUPPORT_COLOR, { bold: true });
        // 2026-10-04: 넥라인은 N1(좌어깨~머리 고점)과 N2(머리~우어깨 고점)를 잇는 기울어진 실제 계산선을 오늘까지 연장해 그린다
        if (Array.isArray(detail.neckline_line) && detail.neckline_line.length === 2) {
          addLine(detail.neckline_line, RESIST_COLOR, { bold: true });
        } else {
          addHLine(detail.neckline.price, detail.left_shoulder.date, RESIST_COLOR);
        }
        ['left_shoulder', 'head', 'right_shoulder'].forEach(function (k) { addDot(detail[k], SUPPORT_COLOR, 'belowBar', 1.8); });
        ['left_peak', 'right_peak'].forEach(function (k) { addDot(detail[k], RESIST_COLOR, 'aboveBar', 1.4); });
        if (detail.signal) addSignal(detail.signal);
      }
    } else if (pattern === 'boxRangeLow') {
      var boxLows = detail.low_swings || [];
      var boxHighs = detail.high_swings || [];
      if (detail.support != null) addHLine(detail.support, boxLows[0] && boxLows[0].date, SUPPORT_COLOR);
      if (detail.resistance != null) addHLine(detail.resistance, boxHighs[0] && boxHighs[0].date, RESIST_COLOR);
      boxLows.forEach(function (p) { addDot(p, SUPPORT_COLOR, 'belowBar'); });
      boxHighs.forEach(function (p) { addDot(p, RESIST_COLOR, 'aboveBar'); });
      if (detail.signal) addSignal(detail.signal); // 현재가(박스 하단 근접 지점)
    } else if (pattern === 'shortTermMaBreakout') {
      // trendline은 [스윙 고점 시작점, 오늘 지점까지 연장된 저항선] 2점 - 그대로 이으면
      // 참고 그림의 검은 하락 추세선이 된다. 5일선은 위 공통 이평선 렌더링에서 이미 그린다.
      if (Array.isArray(detail.trendline) && detail.trendline.length === 2) {
        addLine(detail.trendline, RESIST_COLOR, { bold: true });
      }
      (detail.high_swings || []).forEach(function (p) { addDot(p, RESIST_COLOR, 'aboveBar', 1.8); }); // H1·H2 스윙 고점
      if (detail.signal) addSignal(detail.signal);   // 오늘 종가 돌파 위치
    } else if (pattern === 'maCloudBreakout') {
      // 구름 자체는 일목 오버레이(기본 켜짐)로, 224일선은 공통 이평선으로 그린다. 여기서는 오늘 구름 상·하단 기준선과 돌파일을 표시한다.
      if (detail.cloud) {
        var mcFrom = daily[Math.max(0, daily.length - 60)] && daily[Math.max(0, daily.length - 60)].date;
        addHLine(detail.cloud.top, mcFrom, RESIST_COLOR);
        addHLine(detail.cloud.bottom, mcFrom, SUPPORT_COLOR);
      }
      if (detail.breakoutDate) addDot({ date: detail.breakoutDate, price: (daily.filter(function (d) { return d.date === detail.breakoutDate; })[0] || {}).high }, RESIST_COLOR, 'aboveBar', 1.8);
      if (detail.signal) addSignal(detail.signal);
    } else if (pattern === 'pullback') {
      // 상승 시작(저점) -> 고점 -> 현재가(조정 중) 순서로 이어 "얼마나 올랐다가 얼마나
      // 눌렸는지"를 한눈에 보여준다. 이평선은 addMaLine으로 배경에 이미 그림.
      if (detail.rise_start && detail.peak && detail.current) {
        addLine([detail.rise_start, detail.peak, detail.current], SUPPORT_COLOR, { bold: true });
        addDot(detail.rise_start, SUPPORT_COLOR, 'belowBar');
        addDot(detail.peak, RESIST_COLOR, 'aboveBar');
        addSignal(detail.current);
      }
    } else if (pattern === 'firstPullbackBreakout') {
      addLine([detail.rise_start, detail.peak, detail.pullback_low, detail.signal], SUPPORT_COLOR, { bold: true });
      if (detail.pullback_low) {
        addHLine(detail.resistance, detail.pullback_low.date, RESIST_COLOR);
        addHLine(detail.support, detail.pullback_low.date, SUPPORT_COLOR);
        addDot(detail.pullback_low, SUPPORT_COLOR, 'belowBar');
      }
      if (detail.peak) addDot(detail.peak, RESIST_COLOR, 'aboveBar');
      if (detail.signal) addSignal(detail.signal);
    } else if (pattern === 'openingGap') {
      if (detail.signal) addSignal(detail.signal);
    } else if (pattern === 'angleMomentum') {
      // 전형가(고+저+종)/3의 5·10·20일 단순이동평균 - 이 검색기가 기울기를 보는 선 그대로 그린다
      var tpVals = daily.map(function (d) { return (d.high + d.low + d.close) / 3; });
      [[5, '#d24f45'], [10, '#e08a2e'], [20, '#3b6fd6']].forEach(function (cfg) {
        var pts = [];
        var sum = 0;
        for (var ti = 0; ti < tpVals.length; ti++) {
          sum += tpVals[ti];
          if (ti >= cfg[0]) sum -= tpVals[ti - cfg[0]];
          if (ti >= cfg[0] - 1) pts.push({ time: daily[ti].date, value: sum / cfg[0] });
        }
        chart.addSeries(LWC.LineSeries, { color: cfg[1], lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(pts);
      });
      if (detail.signal) addSignal(detail.signal);
    } else if (pattern === 'gongpasan') {
      // 진행 순서가 보이도록: 바닥 박스(고·저) -> 매집봉 -> 돌파봉·돌파 레벨 -> 첫 눌림(오늘). 20일선·5일선은 공통 이평선으로 이미 그린다.
      if (detail.baseHigh != null) addHLine(detail.baseHigh, detail.accumulationDate || detail.breakoutDate, RESIST_COLOR);
      if (detail.baseLow != null) addHLine(detail.baseLow, detail.accumulationDate || detail.breakoutDate, SUPPORT_COLOR);
      if (detail.breakoutLevel != null && detail.breakoutDate) addHLine(detail.breakoutLevel, detail.breakoutDate, RESIST_COLOR);
      function gpBar(date) { return daily.filter(function (d) { return d.date === date; })[0]; }
      if (detail.accumulationDate && gpBar(detail.accumulationDate)) addDot({ date: detail.accumulationDate, price: gpBar(detail.accumulationDate).low }, SUPPORT_COLOR, 'belowBar', 1.6);
      if (detail.breakoutDate && gpBar(detail.breakoutDate)) addDot({ date: detail.breakoutDate, price: gpBar(detail.breakoutDate).high }, RESIST_COLOR, 'aboveBar', 1.8);
      if (detail.signal) addSignal(detail.signal); // 눌림목 매수 타점(오돌이 돌파 자체가 아님)
    }

    if (markers.length) LWC.createSeriesMarkers(candleSeries, markers);
  }

  // ---- 유틸 ----

  function fetchJson(url, timeoutMs) {
    return global.NineHttp.json(url, { timeoutMs: timeoutMs || FETCH_TIMEOUT_MS });
  }

  function chgClass(rt) {
    var r = parseFloat(rt);
    return r > 0 ? 'ps-up' : (r < 0 ? 'ps-down' : 'ps-flat');
  }
  function chgSign(rt) { return global.NineUI.signedPercent(rt, {missing:''}); }
  function fmt(n) { return global.NineUI.number(n, {round:true}); }
  // 캔들차트 축·크로스헤어·패턴선에 표시되는 가격에 천단위 콤마(원화는 소수점 없음)
  function psChartPriceFormatter(v) { return v == null || isNaN(v) ? '' : Math.round(v).toLocaleString(); }

  function escapeHtml(s) { return global.NineUI.escapeHtml(s); }

  // Dashboard reads the same selected source, caches and stage rules as the results below.
  function dashboardSnapshot() {
    var key = scannerKey(activeTab);
    var source = key.replace(/^pattern:/, '');
    var history = scanPerformanceByKey[key];
    var cache = trackedCache[key + '|active'];
    var tracks = cache && cache.data;
    var map = trackMapFor(key);
    var current = groupFor(activeTab) ? unifiedItems().reduce(function (out, row) {
      var member = row.members.filter(function (m) { return m.key === source; })[0];
      if (member) out.push(member.item);
      return out;
    }, []) : ((scanData && scanData.patterns && scanData.patterns[source]) || []);
    if (activeTab === 'liveFlow') {
      var n = ninepayData, rawEvents = phaseTwoEvents(), events = rawEvents && rawEvents.filter(publicStockVisible), twoCodes = new Set((events || []).map(function (e) { return String(e.code); }));
      var candidates = n && !ninepayError && n.running && n.active && n.ruleVersion === 'ab70-v1' && !n.rankError && !n.persistenceError && !n.queueDropped && !n.amountFallback && Number.isFinite(Date.parse(n.rankAt || '')) && Date.now() - Date.parse(n.rankAt) >= 0 && Date.now() - Date.parse(n.rankAt) <= 120000 && Array.isArray(n.items) ? n.items : null;
      var allFirst = (candidates || []).concat(events || []);
      var rows1 = allFirst.filter(function (item) { return item && publicStockVisible(item) && Number(item.first70At) > 0 && item.excluded == null; }).map(function (item) {
        return {code:String(item.code), name:item.name || item.code, at:item.first70At,
          reason:'장중 거래량 70% 최초 관측', badge:item.entryInvalid || item.stage === 'invalidated' ? '1차 기록 · 진입 무효' : '1차 후보', stage:'first', origin:'current', item:item};
      });
      return {source:'pattern:ninepayLive', label:'9Pay A/B 1차 후보', mode:'first-stage', current:rows1,
        currentLoaded:!!candidates, secondCount:events === null ? null : twoCodes.size};
    }
    var rows = current.map(function (item) {
      var track = map[item.code];
      var detail = item.patternDetail || {};
      var at = item.signalAt || item.firstDetectedAt || item.firstObservedAt || (track && track.created_at)
        || item.scannedAt || detail.scanned_at || item.lastObservedAt || item.date;
      var stage = itemStage(item);
      return { code: String(item.code), name: item.name || item.code, at: at,
        reason: scannerSignal(item, source), badge: stage.label, stage: stage.key, origin: 'current', item: item };
    });
    return { source: key, label: sourceLabel(source), current: rows,
      currentLoaded: scannerDataState(source) === 'ready',
      hits: history && history.hits && history.hits.filter(publicStockVisible), stats: tracks && tracks.stats,
      historyLoaded: !!history, historyLimit: 1500 };
  }
  function publishDashboard() {
    if (typeof global.CustomEvent === 'function') document.dispatchEvent(new global.CustomEvent('pattern-scan-data', { detail: dashboardSnapshot() }));
  }
  function showDashboardResults() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    trackView = 'all';
    container.querySelectorAll('[data-view]').forEach(function (button) {
      var on = button.getAttribute('data-view') === 'all';
      button.classList.toggle('active', on); button.setAttribute('aria-selected', String(on));
    });
    renderList(container);
    var list = container.querySelector('#psList');
    if (list) { list.setAttribute('tabindex', '-1'); list.focus({ preventScroll:true }); list.scrollIntoView({ block:'start', behavior:'auto' }); }
  }
  function openDashboardSignal(code, historical) {
    var snapshot = dashboardSnapshot();
    var row = snapshot.current.filter(function (r) { return r.code === code; })[0];
    var hit = (snapshot.hits || []).filter(function (r) { return r.code === code; })[0] || historical;
    if (rootContainer && (row || hit)) openDetail(rootContainer, Object.assign({}, row ? row.item : {
      code:hit.code, name:hit.name, date:hit.scanDate || String(hit.at).slice(0,10), price:hit.basePrice
    }, { _sourceKey:snapshot.source.replace(/^pattern:/, '') }));
  }

  global.PatternScan = { init: init, refresh: function () { var container = rootContainer && rootContainer.isConnected ? rootContainer : document.querySelector(CONTAINER_SELECTOR); if (container) loadScan(container); }, fetchJson: fetchJson, mergeScannerRows: mergeScannerRows, publicStockVisible: publicStockVisible, classifyPublicMember: classifyPublicMember, publicModel: publicModel, menuTabs: MENU_TABS, dashboardSnapshot: dashboardSnapshot, showDashboardResults: showDashboardResults, openDashboardSignal: openDashboardSignal, loadChartCore: loadPatternChartCore };

  global.addEventListener && global.addEventListener('tistory-chart-resize',function(){
    var detail=document.getElementById('psDetail');
    if(!rootContainer || !currentDetailItem || !detail || detail.hidden || detail.closest('.de-chart-overlay'))return;
    if(!placeInlineDetail(rootContainer,currentDetailItem) && detail.dataset.inlineCode)closeDetail(rootContainer);
  });
  function startWithSecurityTypes(){
    if(global.SCANNER_SECURITY_TYPES){init();return;}
    var started=false;
    function start(){if(!started){started=true;init();}}
    var script=document.createElement('script');
    script.src=new URL('scanner-security-data.js',securityScriptUrl || location.href).href;
    script.onload=function(){if(!started)start();else if(rootContainer){renderList(rootContainer);var basis=rootContainer.querySelector('.ps-security-basis');if(basis && global.SCANNER_SECURITY_TYPES)basis.textContent='종목 유형: '+global.SCANNER_SECURITY_TYPES.source+' · 기준 '+global.SCANNER_SECURITY_TYPES.asOf;}};
    script.onerror=start;document.head.appendChild(script);
    global.setTimeout(start,4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',startWithSecurityTypes);
  else startWithSecurityTypes();
})(window);

