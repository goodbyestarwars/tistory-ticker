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

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#pattern-scan';
  var KIWOOM_VM_URL = 'https://goodbyestar.cloud';
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
    { key: 'risingLows', label: '저점상승형', desc: '하락 뒤 바닥을 다지며 스윙 저점이 계단식으로 오르는 종목입니다. 최근 60거래일에서 저점이 3개 이상 이어서 1% 이상씩 높아지고(첫 저점 대비 +4%~+20%), 첫 저점과 마지막 저점이 15거래일 이상 떨어져 있어야 합니다. 계단 시작 뒤 첫 저점 아래로 내려간 적이 없고(하방이 막힘), 계단 시작 전에 첫 저점보다 12% 이상 높았던 구간이 있어야 하며(하락 뒤의 바닥), 현재가가 마지막 저점의 +10% 이내이고 최근 20거래일 +15% 이하(이미 오른 종목 제외)여야 합니다. 로보티즈처럼 하락 파동 속 3~4봉 반등은 제외합니다.' },
    { key: 'shortTermMaBreakout', label: '하락추세선 첫돌파', desc: '최근 30봉 내 의미 있는 두 스윙 고점을 연결한 하락 추세선을 오늘 종가가 처음 돌파한 종목입니다. 전일까지 가격은 추세선 아래 또는 인접한 위치에 머물러 있어야 하며, 현재 종가는 상승 중인 5일 이동평균선 위에 있어야 합니다. 이미 추세선을 크게 벗어난 종목은 제외해 막 돌파가 시작되는 구간을 포착합니다.' },
    { key: 'maCloudBreakout', label: '장기이평 응축기', desc: '224일 장기 이동평균선과 일목균형표 구름대가 서로 가까워지며 가격이 응축된 종목을 찾습니다. 종가가 224일선 주변에서 지지받으면서 구름 상단 돌파를 준비하거나, 최근 1~3거래일 내 구름 상단과 장기이평선을 종가 기준으로 새롭게 돌파한 종목도 포함합니다. 이미 구름대와 장기이평선에서 크게 벗어나 상승이 진행된 종목은 제외합니다.' },
    { key: 'doubleBottom', label: '쌍바닥', desc: '최근 120봉에서 10~45봉 간격으로 형성된 두 스윙 저점의 가격 차이가 3% 이내인 쌍바닥 후보를 찾습니다. 두 바닥 사이에는 더 낮은 저점이 없어야 하며, 첫 바닥 이후 넥라인까지 최소 8% 이상의 반등이 있어야 합니다. 두 번째 바닥에서 매도 거래량이 감소하고 저점이 유지된 뒤, 넥라인 방향으로 회복하거나 재돌파를 준비하는 종목을 선별합니다.' },
    { key: 'invHeadShoulders', label: '역헤드앤숄더', desc: '최근 90봉에서 왼쪽 어깨-머리-오른쪽 어깨가 형성된 역헤드앤숄더 후보를 찾습니다. 머리는 양 어깨보다 최소 2% 낮고, 양 어깨 가격 차이는 4% 이내여야 합니다. 오른쪽 어깨 이후 머리 저점이 훼손되지 않은 상태에서 넥라인에 접근하거나 최근 종가 기준으로 새롭게 돌파한 종목을 선별하며, 넥라인 접근·돌파 시 거래량 증가를 높게 평가합니다.' },
    { key: 'boxRangeLow', label: '박스권 하단', desc: '최근 20봉 동안 가격 변동폭이 10% 이내로 제한되고 5일선과 20일선이 서로 가까워지는 횡보 구간에서, 현재 가격이 박스 하단 35% 영역에 위치한 종목을 찾습니다. RSI와 거래량이 과열·침체되지 않고, 장기 하락이 아닌 상태에서 박스 하단 지지 또는 반등이 확인되는 종목을 우선 선별합니다.' },
    { key: 'pullback', label: '이평선 눌림', desc: '최근 강한 상승이 발생한 뒤 고점 대비 5~15% 조정받은 종목 중, 현재 가격이 20일선 또는 240일 장기이평선 부근에서 거래량 감소와 함께 지지받는 눌림 구간을 찾습니다. 선행 상승에는 거래량이 동반되고 조정 과정에서는 거래량이 줄어드는 건강한 눌림을 우선하며, 이평 부근에서 반등이 확인된 종목을 높게 평가합니다.' },
    { key: 'firstPullbackBreakout', label: '첫 눌림 재돌파', desc: '일봉 기준. 상승 중인 20일선이 60일선 위에 있고, 거래량 1.5배 이상으로 20일 고가를 돌파한 뒤 첫 2~8봉 조정에서 거래량이 상승 구간의 80% 이하로 줄어든 종목을 찾습니다. 고점 대비 2~12% 조정 후 최근 3봉 고가를 양봉 종가로 재돌파하고, 거래량이 돌파 전 20봉 평균의 1.2배·조정 평균의 1.5배 이상이어야 합니다. 재돌파 가격보다 3% 넘게 오른 종목과 이미 재돌파한 뒤의 반복 신호는 제외합니다. 장 마감 배치 결과이며 눌림 저점 이탈 여부를 함께 확인하세요.' },
    // 2026-08-22: "시초 갭상승" 탭 삭제 요청 - 백엔드 detect_opening_gap/GAS는 그대로 두고
    // (다른 데서 재사용 가능성 대비, 되돌리기 쉽게) 화면 탭 목록에서만 제외했다.
    { key: 'angleMomentum', label: '각도기 타점', desc: '전형가 기준 5·10·20일 이동평균선의 기울기를 주가 수준과 무관한 퍼센트 변화율로 정규화해 계산합니다. 단기 이동평균이 상승 전환하고 중·장기 이동평균의 하락 기울기가 함께 개선되는 구간 중, 단기 기울기 변화가 최근 20일 평소 수준보다 강하게 확대되는 순간을 포착합니다. 거래량 급증 이후가 아니라 이동평균 곡률이 먼저 꺾이는 초기 변화를 찾는 실험적 검색기입니다.' },
    // 2026-08-20: "역매공파·공구리·오돌이" 같은 용어를 지워달라는 요청 - 특정 단타 기법의
    // 고유 용어라 출처가 드러나는 걸 원하지 않는다고 함. 조건 로직(숫자·판정 기준)은 그대로
    // 두고 설명 문구만 용어 없이 풀어썼다(공구리->횡보, 오돌이 표현 삭제).
    { key: 'gongpasan', label: '공파산 타점', desc: '최근 160일 고점 대비 25% 이상 하락한 뒤 40일 안팎의 바닥 횡보와 대량거래 매집 흔적이 나타난 종목을 추적합니다. 이후 직전 5봉 고가와 5일선을 강한 양봉으로 돌파한 뒤, 가격이 처음으로 20일선까지 눌렸을 때 거래량이 감소하고 종가 기준 지지가 확인되는 첫 눌림 구간을 매매 후보로 선별합니다. 돌파봉 자체가 아니라 돌파 후 첫 20일선 지지가 핵심입니다.' },
    // 2026-09-04: 이 탭만 장중 스냅샷이다. 나머지는 전부 장 마감 뒤 일봉 배치라
    // 스캔 시각이 다르고, 그래서 목록 위 안내도 이 탭에서는 따로 표시한다.
    { key: 'volumeBreakout', label: '거래량 돌파(5분)', desc: '장중 30초마다 거래량 순위를 읽어, 최근 3분 동안 늘어난 거래량이 전일 거래량의 3% 이상(3분 환산)인데 아직 많이 오르지 않은 종목을 잡습니다. 감지 시각·감지가를 기록하고, 감지 후 6% 이상 오르거나 45분이 지난 종목은 내립니다. 거래량 순위권에 못 든 아주 초기 종목은 놓칠 수 있습니다.' }
  ];

  var scanData = null;
  var scanPerformanceData = null;
  var activeTab = 'risingLows';
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
    container.innerHTML = buildShell();
    wireTabs(container);
    renderTabDesc(container);
    loadScan(container);
  }

  function buildShell() {
    var tabsHtml = TABS.map(function (t, i) {
      return '<button type="button" class="ps-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + t.key + '">' + t.label + '</button>';
    }).join('');

    return ''
      + '<div class="ps-head">'
      + '<div class="ps-tabs">' + tabsHtml + '</div>'
      + '<div class="ps-meta" id="psMeta">불러오는 중...</div>'
      // 목록 가격이 스캔 시점인지 지금인지 한 줄로 밝힌다(patchLivePrices가 채운다).
      + '<div class="ps-price-basis-note" id="psPriceBasis"></div>'
      + '</div>'
      + '<div class="ps-tab-desc" id="psTabDesc"></div>'
      + '<div data-scanner-review></div><div class="ps-view-tabs" id="psViewTabs" role="tablist">'
      + STAGE_VIEWS.map(function (v, i) {
        return '<button type="button" class="ps-view-tab' + (i === 0 ? ' active' : '') + '" data-view="' + v[0] + '">' + v[1] + '<small data-count="' + v[0] + '"></small></button>';
      }).join('')
      + '</div>'
      + '<div class="ps-track-summary" id="psTrackSummary"></div>'
      + '<div class="ps-list" id="psList"><div class="ps-hint"><svg class="ps-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>불러오는 중...</div></div>'
      + '<div class="ps-detail" id="psDetail" hidden></div>';
  }

  // 목록이 비어 있어도(70점 넘는 종목이 없어도) 이 패턴이 뭘 찾는 건지는 항상 보이게 한다.
  // 2026-08-20: 원래 공통 조건(.ps-common-desc)과 탭별 조건(.ps-tab-desc)이 서로 다른
  // 박스 두 개로 나뉘어 있었는데, "하나의 칸에서 보여줘"라는 요청으로 한 박스 안에
  // 공통 조건(굵게) - 구분선 - 탭별 조건 순으로 합쳤다.
  function renderTabDesc(container) {
    var box = container.querySelector('#psTabDesc');
    if (!box) return;
    var tab = TABS.filter(function (t) { return t.key === activeTab; })[0];
    box.innerHTML = '<strong>' + escapeHtml(COMMON_SEARCH_DESC) + '</strong>'
      + '<hr class="ps-tab-desc-divider">'
      + '<span>' + escapeHtml(tab ? tab.desc : '') + '</span>';
  }

  function wireTabs(container) {
    container.querySelectorAll('.ps-view-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-view-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        trackView = btn.getAttribute('data-view');
        renderList(container);
        closeDetail(container);
      });
    });
    container.querySelectorAll('.ps-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeTab = btn.getAttribute('data-tab');
        renderTabDesc(container);
        updateMeta(container);
        renderList(container);
        closeDetail(container);
        syncLiveSurge(container);
      });
    });
  }

  // 2026-10-04: 이 검색은 실시간이 아니라 장 마감 후 하루 1회 확정 일봉으로 계산한 결과다 - 기준일을 밝힌다.
  function baseDateLabel(data) {
    var latest = '';
    Object.keys((data && data.patterns) || {}).forEach(function (key) {
      ((data.patterns[key]) || []).forEach(function (row) { if (row && row.date && String(row.date) > latest) latest = String(row.date); });
    });
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(latest);
    return m ? m[1] + '.' + m[2] + '.' + m[3] + ' 종가 기준(장 마감 후 1회 스캔) · ' : '';
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
        scanData = data;
        scanMetaText = data.scannedAt
          ? (baseDateLabel(data) + '스캔 ' + data.scannedAt + ' · 대상 ' + (data.scanned || 0) + '/' + (data.universe || 0) + '종목')
          : '아직 스캔 결과가 없어요. VM 일일 스캔이 한 번 완료되면 표시됩니다.';
        updateMeta(container);
        renderList(container);
        loadScanPerformance(container);
        syncLiveSurge(container);
      })
      .catch(function (err) {
        var list = container.querySelector('#psList');
        if (!list) return;
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
    if (activeTab === 'volumeBreakout' && liveSurgeInfo) {
      var t = liveSurgeInfo.updatedAt ? new Date(liveSurgeInfo.updatedAt) : null;
      var hhmm = t && !isNaN(t.getTime())
        ? new Date(t.getTime() + 9 * 3600000).toISOString().slice(11, 19)
        : '';
      meta.textContent = liveSurgeInfo.active
        ? '실시간 사전포착 · 장중 ' + (liveSurgeInfo.intervalSec || 30) + '초마다 갱신' + (hhmm ? ' · 마지막 ' + hhmm : '')
          + ' · 이미 많이 오른 ' + (liveSurgeInfo.ranCount || 0) + '종목은 제외'
        : '장이 열려 있지 않아요(평일 09:00~15:35 감시). 마지막 감지 기록을 보여줍니다.';
      return;
    }
    meta.textContent = scanMetaText;
  }

  function loadLiveSurge(container) {
    return PatternScan.fetchJson(LIVE_SURGE_URL + '?_=' + Date.now())
      .then(function (envelope) {
        var data = envelope && envelope.data ? envelope.data : envelope;
        if (!data || !Array.isArray(data.items)) throw new Error('live surge empty');
        liveSurgeInfo = data;
        if (scanData) {
          scanData.patterns = scanData.patterns || {};
          scanData.patterns.volumeBreakout = data.items;
        }
        if (activeTab === 'volumeBreakout') { updateMeta(container); renderList(container); }
      })
      .catch(function () {
        // 실패하면 서버가 마지막으로 저장한 스냅샷을 그대로 둔다(탭이 비지 않게).
        liveSurgeInfo = null;
        if (activeTab === 'volumeBreakout') updateMeta(container);
      });
  }

  function syncLiveSurge(container) {
    clearInterval(liveSurgeTimer);
    liveSurgeTimer = null;
    if (activeTab !== 'volumeBreakout') { updateMeta(container); return; }
    loadLiveSurge(container);
    liveSurgeTimer = setInterval(function () {
      if (activeTab !== 'volumeBreakout' || document.hidden || !document.body.contains(container)) return;
      loadLiveSurge(container);
    }, LIVE_SURGE_REFRESH_MS);
  }

  function scannerKey(patternKey) {
    return 'pattern:' + String(patternKey || activeTab || '');
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
      return isFinite(position) ? boxLabel + ' · 박스 하단 ' + position.toFixed(0) + '%' + (criteria.rsi14 != null ? ' · RSI ' + Number(criteria.rsi14).toFixed(0) : '') : boxLabel;
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
    if (patternKey === 'gongpasan') {
      var gpDays = Number(detail.daysSinceBreakout);
      var gpGap = Number(detail.ma20Distance);
      return (detail.status === 'SUPPORT_CONFIRMED' ? '✅ MA20 지지 확인' : '🟢 첫 눌림')
        + (isFinite(gpDays) ? ' · 돌파 ' + gpDays + '거래일 후' : '')
        + (isFinite(gpGap) ? ' · 저가-MA20 ' + gpGap.toFixed(1) + '%' : '')
        + (detail.pullbackVolumeRatio != null ? ' · 눌림 거래량 ' + Math.round(Number(detail.pullbackVolumeRatio) * 100) + '%' : '');
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
    var detail = detailFor(item);
    var top = Number(detail.cloudTopDistance);
    if (activeTab === 'maCloudBreakout' && isFinite(top)) return top <= 0 && top >= -READY_GAP_PCT;
    var neck = Number(detail.necklineDistancePct);
    if ((activeTab === 'doubleBottom' || activeTab === 'invHeadShoulders') && isFinite(neck)) return Math.abs(neck) <= READY_GAP_PCT;
    var resistance = Number(detail.resistance);
    var current = Number(item.price);
    if (resistance > 0 && current > 0 && resistance >= current) return (resistance - current) / current * 100 <= READY_GAP_PCT;
    return false;
  }

  function itemStage(item) {
    var track = trackMapFor(scannerKey(activeTab))[item && item.code];
    var scanDay = String((item && item.date) || '').slice(0, 10);
    var isNew = !track || (scanDay && String(track.detected_date) >= scanDay);
    if (isNew) return { key: 'new', label: '신규 포착', tone: 'is-new' };
    if (readyGapOk(item)) return { key: 'ready', label: '돌파 준비', tone: 'is-ready' };
    return { key: 'hold', label: '포착 유지', tone: 'is-hold' };
  }

  function stageBadgeHtml(item) {
    var st = itemStage(item);
    return '<b class="ps-stage ' + st.tone + '">' + st.label + '</b> ';
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
    var key = scannerKey(activeTab);
    var cached = trackedCache[key + '|active'];
    var stats = cached && cached.data && cached.data.stats;
    var counts = { all: 0, new: 0, ready: 0 };
    ((scanData && scanData.patterns && scanData.patterns[activeTab]) || []).forEach(function (it) {
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

  function renderList(container) {
    var list = container.querySelector('#psList');
    if (!list) return;
    if (!scanData) { list.innerHTML = '<div class="ps-hint"><svg class="ps-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>불러오는 중...</div>'; return; }

    if (trackView === 'success' || trackView === 'failed') { renderTrackedList(container); return; }
    if (activeTab === 'firstPullbackBreakout' && !scanData.firstPullbackBreakoutReady) {
      list.innerHTML = '<div class="ps-hint">첫 검색 결과를 준비 중이에요. 기존 일봉 수집이 끝난 뒤 자동으로 검색합니다.</div>';
      return;
    }
    ensureTrackMap(container);
    var allItems = (scanData.patterns && scanData.patterns[activeTab]) || [];
    var items = allItems.filter(function (it) {
      return trackView === 'all' || itemStage(it).key === trackView;
    });
    if (!items.length) {
      list.innerHTML = '<div class="ps-hint">' + (allItems.length
        ? '이 상태에 해당하는 종목이 없어요. 위 상태 칸에서 다른 상태를 보거나 전체를 눌러보세요.'
        : '지금 이 패턴에 해당하는 종목이 없어요.') + '</div>';
      return;
    }

    // 20개를 넘는 후보에만 차트 품질 게이트를 적용한 뒤, 통과한 후보는 모두 표시한다.
    // 실시간 사전포착 목록은 서버가 정한 순서(초기 먼저, 거래량 속도 순)를 그대로 쓴다.
    var serverOrdered = !!(items[0] && items[0].patternDetail && items[0].patternDetail.live);
    var sorted = serverOrdered ? items.slice() : items.slice().sort(function (a, b) {
      var scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff) return scoreDiff;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

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
        + '><span class="ps-price">' + fmt(it.price) + '</span>'
        + '<span class="ps-rate ' + cc + '">' + chgSign(it.changeRate) + '</span>'
        + '<span class="ps-price-basis">' + (activeTab === 'volumeBreakout' && liveSurgeInfo ? '감지 시점' : '스캔 시점') + '</span></span>'
        + '<span class="ps-observation">' + escapeHtml(scannerInterpretation(it, activeTab) + analystTargetPriceText(it)) + performanceTrackingHtml(it) + '</span>'
        + '</div>';
    }).join('');

    list.querySelectorAll('.ps-item').forEach(function (el) {
      var open = function () {
        var code = el.getAttribute('data-code');
        var item = items.filter(function (x) { return x.code === code; })[0];
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
      patternDetail: snap, reasons: snap.reasons || [], interpretation: snap.interpretation || '', track: t };
  }

  function renderTrackedList(container) {
    var list = container.querySelector('#psList');
    if (!list) return;
    var key = scannerKey(activeTab);
    var cacheKey = key + '|' + trackView;
    var cached = trackedCache[cacheKey];
    function paint(data) {
      if (scannerKey(activeTab) !== key || (trackView !== 'success' && trackView !== 'failed')) return;
      var tracks = (data && data.tracks) || [];
      var head = trackStatsHtml(data && data.stats);
      var review = container.querySelector('[data-scanner-review]');
      if (review) review.innerHTML = scannerReviewHtml(data && data.stats);
      if (!tracks.length) {
        list.innerHTML = head + '<div class="ps-hint">' + (trackView === 'success' ? '아직 돌파 성공(포착가 대비 장중 +5%)한 종목이 없어요.' : '아직 5일선 이탈로 돌파 실패한 종목이 없어요.') + '</div>';
        return;
      }
      var byCode = {};
      list.innerHTML = head + '<div class="ps-track-head" aria-hidden="true"><span>종목</span><span>포착일</span><span>상태</span><span>포착가 → 현재가</span><span>경과</span><span>최대 상승/하락</span></div>'
        + tracks.map(function (t) {
          byCode[t.id] = t;
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
        var open = function () { openDetail(container, trackToItem(byCode[el.getAttribute('data-track-id')])); };
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
  function scanGapHtml(livePrice, scanPrice, scanDate) {
    var gap = gapPercent(livePrice, scanPrice);
    if (gap == null) return '';
    var rounded = Math.round(gap * 10) / 10;
    var tone = rounded > 0 ? 'is-up' : (rounded < 0 ? 'is-down' : 'is-flat');
    var sign = rounded > 0 ? '+' : (rounded < 0 ? '-' : '');
    var date = scanDateLabel(scanDate);
    var word = activeTab === 'volumeBreakout' && liveSurgeInfo ? '감지' : '스캔';
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
      if (basisEl) basisEl.innerHTML = scanGapHtml(Number(live.price), scanPrice, quote.getAttribute('data-scan-date'));
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
      PatternScan.fetchJson(GAS_TICKER_URL + '?codes=' + missing.slice(0, LIVE_QUOTE_MAX_CODES).join(','))
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

  function openDetail(container, item) {
    var detail = container.querySelector('#psDetail');
    if (!detail || !item) return;
    // 이 패턴은 구름 안·상단 시도가 핵심이므로 상세 차트에서 구름을 기본으로 켠다.
    psIchimokuEnabled = activeTab === 'maCloudBreakout';
    detail.hidden = false;
    detail.innerHTML = '<div class="ps-loading"><svg class="ps-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg><div>' + escapeHtml(item.name) + ' 차트를 불러오는 중...</div></div>';
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    var chartUrl = GAS_TICKER_URL + '?patternChart=1&code=' + encodeURIComponent(item.code)
      + '&pattern=' + encodeURIComponent(activeTab) + '&scanDate=' + encodeURIComponent(item.date || '');
    function loadFromGas() {
      return fetchWithRetry(chartUrl, function (data) {
        return data && !data.error && Array.isArray(data.daily);
      });
    }
    // 재판정이 필요 없는 탭은 VM에서 캔들만 받아 곧바로 그린다. detail은 어차피 목록
    // 스냅샷에서 오므로(아래 !data.detail 분기) 화면 내용은 GAS 경유와 같다.
    var chartRequest = GAS_REDETECTED_PATTERNS[activeTab]
      ? loadFromGas()
      : PatternScan.fetchJson(KIWOOM_VM_URL + '/flow-chart/' + encodeURIComponent(item.code))
          .then(function (envelope) {
            var d = envelope && envelope.data ? envelope.data : envelope;
            if (!d || d.error || !Array.isArray(d.daily) || !d.daily.length) throw new Error('VM 캔들 없음');
            return { code: item.code, daily: d.daily, pattern: activeTab, detail: null };
          })
          .catch(loadFromGas);
    chartRequest
      .then(function (data) {
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
        detail.innerHTML = '<div class="ps-error">차트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  function closeDetail(container) {
    var detail = container.querySelector('#psDetail');
    if (detail) { detail.hidden = true; detail.innerHTML = ''; destroyPsChart(); }
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
    var html = '<div class="ps-detail-head">'
      + '<span class="ps-detail-name">' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name) + ' <span class="ps-code">(' + escapeHtml(item.code) + ')</span></span>'
      + '<span class="ps-timeframe-badge">2년 일봉 · 1D</span></span>'
      + '<button type="button" class="ps-close" id="psClose">닫기 ✕</button>'
      + '</div>';
    if (item.track) html += buildTrackBox(item.track);
    html += buildScoreBox(data.detail);
    html += buildMovingAverageLegend(data.daily);
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psIchimokuToggle"' + (psIchimokuEnabled ? ' checked' : '') + ' /> 일목균형표(구름) 표시</label>';
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psSupportResistanceToggle"' + (psSrEnabled ? ' checked' : '') + ' /> 지지·저항 표시</label>';
    html += buildIchimokuLegend();
    html += '<div class="ps-pattern-legend">'
      + '<span><i class="ps-pattern-line ps-pattern-line-shape"></i>패턴 형성 근거</span>'
      + '<span><i class="ps-pattern-line ps-pattern-line-level"></i>넥라인 · 지지/저항</span>'
      + '</div>';
    html += '<div class="ps-memo-bar"><button type="button" class="ui-btn ui-btn-secondary" data-ps-memo aria-pressed="false" disabled title="차트의 봉을 눌러 메모를 남깁니다">메모</button><span>로그인하면 계정에, 아니면 이 브라우저에 저장됩니다</span></div>';
    html += '<div class="ps-autotrade-bar" data-ps-autotrade hidden></div>';
    html += '<div class="ps-chart" id="psChart" style="height:' + CHART_H + 'px"></div>';
    html += activeTab === 'firstPullbackBreakout'
      ? '<div class="ps-footnote">장 마감 후 일봉 종가로 재돌파를 확인한 결과입니다. 다음 거래일 가격과 눌림 저점 이탈 여부를 다시 확인하세요. 테스트 중인 검색 조건이며 1시간 상승 예측이나 승률을 뜻하지 않습니다.</div>'
      : '<div class="ps-footnote">※ 장 마감 후 확정 일봉 기준이라 실제 진입은 다음 거래일입니다. 다음 날 시가가 2% 이상 갭상승하면 과거 성과가 나빴습니다(백테스트). 패턴 판정은 최근 ' + data.daily.length + '영업일 기준 참고 지표이며, 아직 저항선/넥라인을 못 뚫은 "형성 중" 패턴만 표시됩니다. <b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>';
    box.innerHTML = html;

    var closeBtn = box.querySelector('#psClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { destroyPsChart(); box.hidden = true; box.innerHTML = ''; });

    var srToggle = box.querySelector('#psSupportResistanceToggle');
    if (srToggle) {
      srToggle.addEventListener('change', function () {
        psSrEnabled = srToggle.checked;
        if (!psSrEnabled) {
          if (psSrCleanup) { psSrCleanup(); psSrCleanup = null; }
        } else if (psSrCtx && psLwcChart === psSrCtx.chart) {
          setupPsSupportResistance(psSrCtx.container, psSrCtx.chart, psSrCtx.series, psSrCtx.daily);
        }
      });
    }
    var ichiToggle = box.querySelector('#psIchimokuToggle');
    var ichiLegend = box.querySelector('.ps-ichimoku-legend');
    if (ichiLegend) ichiLegend.hidden = !psIchimokuEnabled;
    if (ichiToggle) {
      ichiToggle.addEventListener('change', function () {
        psIchimokuEnabled = ichiToggle.checked;
        if (ichiLegend) ichiLegend.hidden = !psIchimokuEnabled;
        if (psIchimokuEnabled) addIchimokuOverlay(data.daily); else removeIchimokuOverlay();
      });
    }

    psMemoItem = item;
    psTrackCtx = item.track || null;
    wireAutoTradeBar(box, item);
    var chartContainer = box.querySelector('#psChart');
    if (chartContainer) renderPatternChart(chartContainer, data.daily, data.pattern, data.detail);
  }

  // 일목균형표는 패턴별 오버레이(지지/저항/스윙 dot)와 별개의 보조지표라 기본은 꺼둔 채
  // 체크박스로 켤 수 있게 한다(js/foreign-flow.js와 같은 색상 배정 - 사이트 전체 일관성).
  var psIchimokuEnabled = false;

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
        return '<span class="ps-ma-legend-item ps-' + study.key + '"><i></i>'
          + study.label + ' <b>' + (latest == null ? '—' : psChartPriceFormatter(latest)) + '</b></span>';
      }).join('')
      + '</div>';
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
  var psLwcThemeObserver = null; // html.dark 토글에 맞춰 차트 색상 실시간 갱신

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
  var psSrEnabled = true;   // 2026-10-04 지지·저항 체크 기능(기본 켜짐)
  var psSrCtx = null;
  var psSrCleanup = null;
  function loadPsSrModule() {
    if (window.NineChartSR) return Promise.resolve(window.NineChartSR);
    if (psSrPromise) return psSrPromise;
    psSrPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/chart-sr.js';
      sc.onload = function () { resolve(window.NineChartSR); };
      sc.onerror = function () { psSrPromise = null; reject(new Error('chart-sr load failed')); };
      document.head.appendChild(sc);
    });
    return psSrPromise;
  }
  function setupPsSupportResistance(container, chart, series, daily) {
    psSrCtx = { container: container, chart: chart, series: series, daily: daily };
    if (!psSrEnabled) return;
    loadPsSrModule().then(function (api) {
      if (!document.body.contains(container) || psLwcChart !== chart || !psSrEnabled || psSrCleanup) return;
      var result = api.levels(daily);
      if (!result.support.length && !result.resistance.length) return;
      psSrCleanup = api.install(container, chart, series, result, function (p) { return psChartPriceFormatter(p); });
    }).catch(function () { /* 지지·저항을 못 받아도 차트는 그대로 */ });
  }

  function destroyPsChart() {
    if (psSrCleanup) { psSrCleanup(); psSrCleanup = null; }
    destroyPsMemo();
    if (psLwcThemeObserver) { psLwcThemeObserver.disconnect(); psLwcThemeObserver = null; }
    if (psLwcChart) {
      try { psLwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
      psLwcChart = null;
    }
    psIchimokuSeries = []; // chart.remove()가 시리즈까지 다 정리하므로 참조만 비움
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
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555', attributionLogo: false },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  // 실제 트레이딩뷰 엔진으로 캔들 + MA(눌림목만) + 패턴 오버레이를 렌더링.
  // 가로 스크롤 없이 컨테이너 폭에 autoSize로 맞춰 한눈에 들어오게 한다.
  function renderPatternChart(container, daily, pattern, detail) {
    destroyPsChart();
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return; // 로딩 중 다른 종목/탭으로 이동했으면 중단

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: CHART_H,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: false, secondsVisible: false },
        localization: { priceFormatter: psChartPriceFormatter }
      }, psThemeOptions()));
      psLwcChart = chart;

      var candleSeries = chart.addSeries(LWC.CandlestickSeries, {
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      candleSeries.setData(daily.map(function (d) {
        return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
      }));

      // 패턴 종류와 관계없이 실시간 시세 차트와 같은 5·20·60·224일선을 항상 표시한다.
      var ma224Series = null;
      standardMovingAverageStudies().forEach(function (study) {
        var series = addMaLine(chart, daily, study.period, study.color);
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

      // 약 2년(500거래일) 일봉을 기본 표시한다. 서버가 보유한 일봉이 더 적으면 전체를 쓴다.
      var visibleBars = Math.min(500, daily.length);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, daily.length - visibleBars),
        to: daily.length - 1 + 3
      });

      setupPsMemo(container, chart, candleSeries, daily);
      setupPsSupportResistance(container, chart, candleSeries, daily);

      psLwcThemeObserver = new MutationObserver(function () {
        chart.applyOptions(psThemeOptions());
        if (ma224Series) ma224Series.applyOptions({ color: ma224Color() });
      });
      psLwcThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }).catch(function () {
      container.innerHTML = '<div class="ps-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // 종가 N일 이동평균선을 라인 시리즈로 그림(눌림목 전용)
  function addMaLine(chart, daily, period, color) {
    var pts = [];
    var sum = 0;
    for (var i = 0; i < daily.length; i++) {
      sum += daily[i].close;
      if (i >= period) sum -= daily[i - period].close;
      if (i >= period - 1) pts.push({ time: daily[i].date, value: sum / period });
    }
    if (pts.length < 2) return null;
    // 2026-08-22 요청: "224선은 좀 더 굵게(차트 공통)" - js/foreign-flow.js(MA_WIDTHS.ma224=3)·
    // js/stock-search.js(lineWidth: period===224 ? 3 : 1)는 이미 224일선만 굵게 그리고 있었고,
    // 이 파일(pattern-scan.js)만 전부 1px로 통일돼 있던 걸 맞춘다.
    var lineWidth = period === 224 ? 3 : 1;
    var series = chart.addSeries(global.LightweightCharts.LineSeries, {
      color: color,
      lineWidth: lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    series.setData(pts);
    return series;
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
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, timeoutMs || FETCH_TIMEOUT_MS) : null;

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

  function chgClass(rt) {
    var r = parseFloat(rt);
    return r > 0 ? 'ps-up' : (r < 0 ? 'ps-down' : 'ps-flat');
  }
  function chgSign(rt) {
    if (rt == null) return '';
    var r = parseFloat(rt);
    return (r > 0 ? '+' : '') + r.toFixed(2) + '%';
  }
  function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }
  // 캔들차트 축·크로스헤어·패턴선에 표시되는 가격에 천단위 콤마(원화는 소수점 없음)
  function psChartPriceFormatter(v) { return v == null || isNaN(v) ? '' : Math.round(v).toLocaleString(); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.PatternScan = { init: init, fetchJson: fetchJson };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
