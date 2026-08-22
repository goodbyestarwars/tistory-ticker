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
  var FETCH_TIMEOUT_MS = 15000;
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';

  var CHART_H = 420;

  var SUPPORT_COLOR = '#d24f45';
  var RESIST_COLOR = '#1261c4';
  var SIGNAL_COLOR = '#ec4899';
  var MA5_EARLY_COLOR = '#d24f45';
  var MA20_EARLY_COLOR = '#1261c4';
  var MA224_EARLY_COLOR = '#000000';
  var MA20_COLOR = '#f59e0b';
  var MA240_COLOR = '#8b5cf6';

  // js/foreign-flow.js와 동일한 주기·색상(사이트 전체 일관성) - 일목균형표 토글 전용.
  // 범례는 하늘색으로 표시하되 실제 선행스팬 경계선은 숨기고 구름 채움만 그린다.
  var ICHIMOKU_TENKAN_PERIOD = 9, ICHIMOKU_KIJUN_PERIOD = 26, ICHIMOKU_SENKOU_B_PERIOD = 52, ICHIMOKU_DISPLACEMENT = 26;
  var ICHIMOKU_COLORS = { senkouA: '#87ceeb', senkouB: '#87ceeb' };
  var ICHIMOKU_CLOUD_FILL = 'rgba(135,206,235,0.24)';
  var ICHIMOKU_BORDER_COLOR = 'rgba(0,0,0,0)';

  // desc는 각 detect*_ 함수(pattern_detect.py)의 하드필터를 그대로 옮긴 것이다.
  // 점수는 후보 간 우선순위를 정하는 참고값이고, 아래 조건은 검색 포함 여부를 결정한다.
  // 2026-08-20: pattern_detect.is_excluded_stock()이 실제로 걸러내는 항목(ETF·스팩·ETN·
  // 거래정지·정리매매 외에도 관리종목·우선주·동전주(1,000원 미만))을 문구에도 그대로
  // 반영했다(사용자 요청: "위험한 것은 알아서 추가해" - 코드에 이미 있는데 문구에만 빠진
  // 항목을 채운 것, 새 필터를 만든 건 아님).
  var COMMON_SEARCH_DESC = '검색기 공통: 시가총액 3,000억원 이상 · ETF·스팩·ETN·관리종목·우선주·거래정지·정리매매·동전주(1,000원 미만) 제외';
  var TABS = [
    { key: 'risingLows', label: '저점상승형', desc: '최근 20봉에서 좌우 2봉보다 낮은 스윙 저점이 2개 이상이고, 최근 저점이 직전 저점보다 5% 이상 높으며 현재 종가가 최근 저점 위에 있는 종목입니다. 최근 저항을 2% 이상 돌파한 종목은 제외합니다.' },
    { key: 'maCloudBreakout', label: '224 장기이평 응축기', desc: '최소 250봉 데이터에서 종가가 224일선 ±3% 이내이고, 종가가 일목 구름 상단을 아직 넘지 않았으며 구름 하단 -2% 안에서는 지지받고 있고, 고가가 구름 상단 3% 이내로 접근했거나 저가가 구름 하단 3% 이내로 접근한 종목입니다(둘 중 하나만 만족해도 포함, 상단 시도가 하단 시도보다 고득점).' },
    { key: 'doubleBottom', label: '쌍바닥', desc: '최근 120봉에서 10~45봉 간격의 스윙 저점 2개가 3% 이내로 비슷하고, 두 저점 사이에 그보다 2% 넘게 더 낮은 저가가 없으며, 두 번째 저점 거래량이 첫 번째 이하이며 중간 넥라인까지 8% 이상 반등한 구조입니다. 두 번째 저점은 최근 5봉 안이고 현재 종가는 넥라인 2% 아래보다 높아야 합니다.' },
    { key: 'invHeadShoulders', label: '역헤드앤숄더', desc: '최근 90봉에서 4~40봉 간격의 저점 3개가 어깨-머리-어깨를 이루고, 머리가 양 어깨보다 각각 2% 이상 낮으며 양 어깨 가격차는 4% 이내입니다. 우어깨 이후 저가가 머리 저점보다 1% 넘게 더 빠지면 제외합니다. 넥라인(두 구간 고가 중 더 높은 쪽) 1% 이내, 최근 양봉, 우어깨 이후 거래량은 최근 20봉 평균의 1.2배 이상이어야 합니다.' },
    { key: 'boxRangeLow', label: '박스권 하단', desc: '최근 20봉 종가 변동폭 10% 이하, 종가 5·20일선 3% 이내 근접 3회 이상, RSI(14) 35~65, 20봉 전 거래량/직전 5봉 평균 50~120%, 시가 5·20일선 관계 3회 이상, 20봉 수익률 ±10% 이내를 모두 만족하면서 현재가가 박스 하단 35% 구간에 있는 후보입니다.' },
    { key: 'pullback', label: '눌림목', desc: '최소 240봉 데이터에서 고점 직전 25봉 안 저점 대비 종가가 15% 이상 상승한 뒤 고점에서 5~15% 조정받고, 현재 종가가 20일선 또는 240일선 3% 이내이며 20일선이 완만한 하락(-0.5%) 이내입니다. 상승구간 거래량 증가, 조정구간(고점 다음날부터) 거래량 감소 및 상승구간 최고치의 70% 이하를 모두 확인합니다.' },
    // 2026-08-22: "시초 갭상승" 탭 삭제 요청 - 백엔드 detect_opening_gap/GAS는 그대로 두고
    // (다른 데서 재사용 가능성 대비, 되돌리기 쉽게) 화면 탭 목록에서만 제외했다.
    { key: 'angleMomentum', label: '각도기 타점', desc: '전형가(고가+저가+종가)/3 기준 단기(5일)·장기(20일) 이동평균선의 기울기(각도)를 주가 단위와 무관하게 정규화(%변동률)해 계산합니다. 단기 각도가 양수이면서 중기·장기 각도가 함께 상승 전환되고, 단기 각도가 최근 20일 변화폭 대비 1.5배 이상 튀는(분출) 순간을 포착합니다. 거래량이 터지기 전 이동평균선 곡률이 먼저 꺾이는 구간을 찾는 실험적 지표입니다.' },
    // 2026-08-20: "역매공파·공구리·오돌이" 같은 용어를 지워달라는 요청 - 특정 단타 기법의
    // 고유 용어라 출처가 드러나는 걸 원하지 않는다고 함. 조건 로직(숫자·판정 기준)은 그대로
    // 두고 설명 문구만 용어 없이 풀어썼다(공구리->횡보, 오돌이 표현 삭제).
    { key: 'gongpasan', label: '공파산 타점', desc: '최근 160일 고점 대비 25% 이상 빠진 종목 중, 최근 40일간 좁게 횡보하고 최근 60일 내 대량거래 매집봉이 나온 뒤, 직전 5봉 고가와 5일선을 동시에 돌파하는 장대양봉이 확인된 종목입니다. 돌파 자체가 아니라 그 후 20일선까지 눌림받아 지지가 확인된 첫 캔들만 매수 타점으로 표시합니다.' }
  ];

  var scanData = null;
  var activeTab = 'risingLows';

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
      + '</div>'
      + '<div class="ps-tab-desc" id="psTabDesc"></div>'
      + '<div class="ps-backtest-box" id="psBacktestBox" hidden></div>'
      + '<div class="ps-list" id="psList"><div class="ps-hint">불러오는 중...</div></div>'
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
    container.querySelectorAll('.ps-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('.ps-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeTab = btn.getAttribute('data-tab');
        renderTabDesc(container);
        renderBacktestBox(container);
        renderList(container);
        closeDetail(container);
      });
    });
  }

  // "각도기 테스트"/"공파산 타점" 탭 전용 - entry_signal이 과거에 뜬 전체 종목·전체 시점을
  // 백테스트한 승률/평균수익률 요약(angle_momentum_scan.py/gongpasan_scan.py가 미리 계산해
  // 캐시에 저장, GAS getPatternScanResult()가 scanData.XxxBacktest로 그대로 전달). 다른
  // 탭에는 없는 정보라 탭이 바뀔 때마다 보이기/숨기기를 다시 결정한다. 2026-08-22부터 두
  // 전략 다 손절/익절/타임컷 방식 동적 청산이라(각도기=진입봉 저가이탈 손절·각도꺾임
  // 익절·40일 타임컷, 공파산=20일선 이탈 손절·파란점선 익절·20일 타임컷) 각주 문구만
  // 탭별로 따로 둔다.
  var BACKTEST_CONFIGS = {
    angleMomentum: {
      field: 'angleMomentumBacktest',
      footnote: function () {
        return '과거 신호를 다음날 시가 매수 후 진입 기준 봉 저가 이탈 손절·단기 각도 하락 전환 익절·'
          + '40일 타임컷 중 먼저 오는 조건으로 청산했다고 가정한 결과이며, '
          + '실제 체결·세금·슬리피지와 다를 수 있습니다. 과거 성과가 미래 수익을 보장하지 않습니다.';
      }
    },
    gongpasan: {
      field: 'gongpasanBacktest',
      footnote: function (stats) {
        return '과거 신호를 다음날 시가 매수 후 20일선 대비 3% 이상 이탈 손절·파란점선 도달 익절·'
          + (stats.timecutDays || 20) + '일 타임컷 중 먼저 오는 조건으로 청산했다고 가정한 결과이며, '
          + '실제 체결·세금·슬리피지와 다를 수 있습니다. 과거 성과가 미래 수익을 보장하지 않습니다.';
      }
    }
  };

  function renderBacktestBox(container) {
    var box = container.querySelector('#psBacktestBox');
    if (!box) return;
    var config = BACKTEST_CONFIGS[activeTab];
    if (!config) { box.hidden = true; box.innerHTML = ''; return; }
    var stats = scanData && scanData[config.field];
    if (!stats || !stats.totalTrades) {
      box.hidden = false;
      box.innerHTML = '<div class="ps-backtest-empty">아직 백테스트 결과가 없어요(스캔이 처음 실행된 뒤부터 누적됩니다).</div>';
      return;
    }
    var winRate = Number(stats.winRatePct);
    var avgReturn = Number(stats.avgReturnPct);
    box.hidden = false;
    box.innerHTML = ''
      + '<div class="ps-backtest-title">과거 신호 ' + stats.totalTrades + '건 백테스트(참고용)</div>'
      + '<div class="ps-backtest-stats">'
      + '<span><b>승률</b> ' + (isFinite(winRate) ? winRate.toFixed(1) : '-') + '%</span>'
      + '<span class="' + chgClass(avgReturn) + '"><b>평균 수익률</b> ' + chgSign(avgReturn) + '</span>'
      + (stats.profitFactor != null ? '<span><b>손익비</b> ' + Number(stats.profitFactor).toFixed(2) + '</span>' : '')
      + '</div>'
      + '<div class="ps-backtest-footnote">' + config.footnote(stats) + '</div>';
  }

  function loadScan(container) {
    // GAS/VM의 빈 응답이 브라우저·중간 캐시에 남으면, 다음 일일 스캔이 끝난 뒤에도
    // "스캔 결과 없음" 화면이 계속 보일 수 있다. 목록 요청은 매번 최신 스냅샷을 확인한다.
    var scanUrl = GAS_TICKER_URL + '?patternScan=1&_=' + encodeURIComponent(Date.now());
    PatternScan.fetchJson(scanUrl)
      .then(function (data) {
        scanData = data;
        var meta = container.querySelector('#psMeta');
        if (meta) {
          meta.textContent = data.scannedAt
            ? ('스캔 ' + data.scannedAt + ' · 대상 ' + (data.scanned || 0) + '/' + (data.universe || 0) + '종목')
            : '아직 스캔 결과가 없어요. VM 일일 스캔이 한 번 완료되면 표시됩니다.';
        }
        renderBacktestBox(container);
        renderList(container);
      })
      .catch(function () {
        var list = container.querySelector('#psList');
        if (list) list.innerHTML = '<div class="ps-error">스캔 결과를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
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
    if (patternKey === 'maCloudBreakout') return '224일선 근접·구름 상/하단 시도';
    if (patternKey === 'doubleBottom') return detail.low1 && detail.low2 ? '쌍바닥 저점 확인' : '쌍바닥 구조';
    if (patternKey === 'invHeadShoulders') return detail.head && detail.neckline ? '헤드·어깨 구조 확인' : '역헤드앤숄더 구조';
    if (patternKey === 'boxRangeLow') {
      var criteria = detail.criteria || {};
      var position = Number(criteria.lowerPositionPct);
      return isFinite(position) ? '박스 하단 ' + position.toFixed(1) + '%' : '박스 하단 반등';
    }
    if (patternKey === 'openingGap') {
      var gap = Number(detail.gapRatePct);
      return isFinite(gap) ? '시초 갭 +' + gap.toFixed(1) + '%' : '시초 갭상승';
    }
    if (patternKey === 'pullback') return detail.ma20 || detail.ma240 ? '이평선 눌림 확인' : '눌림목 구조';
    if (patternKey === 'angleMomentum') {
      var angleShort = Number(detail.angleShort);
      return isFinite(angleShort) ? '단기 각도 +' + angleShort.toFixed(1) + '도' : '각도 상승 전환';
    }
    if (patternKey === 'gongpasan') {
      var retreatPct = Number(detail.retreatPct);
      return isFinite(retreatPct) ? '고점 대비 ' + retreatPct.toFixed(1) + '% · 눌림목 지지' : '눌림목 지지 확인';
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
      maCloudBreakout: '이평선과 구름대 상단을 확인하는 구간',
      doubleBottom: '두 저점이 비슷한 쌍바닥 구조',
      invHeadShoulders: '어깨·머리·어깨 구조',
      boxRangeLow: '박스 하단 구간',
      pullback: '상승 후 이평선 부근 눌림목',
      openingGap: '전일 종가보다 높게 시작한 갭상승',
      angleMomentum: '이동평균선 각도가 위로 꺾이며 가속되는 구간',
      gongpasan: '역배열 바닥권 매집 후 돌파·눌림목 지지 구간'
    }[patternKey] || '검색 조건을 충족한 차트 패턴';
  }

  function renderList(container) {
    var list = container.querySelector('#psList');
    if (!list) return;
    if (!scanData) { list.innerHTML = '<div class="ps-hint">불러오는 중...</div>'; return; }

    var items = (scanData.patterns && scanData.patterns[activeTab]) || [];
    if (!items.length) {
      list.innerHTML = '<div class="ps-hint">지금 이 패턴에 해당하는 종목이 없어요.</div>';
      return;
    }

    // 20개를 넘는 후보에만 차트 품질 게이트를 적용한 뒤, 통과한 후보는 모두 표시한다.
    var sorted = items.slice().sort(function (a, b) {
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
        + '<span class="ps-mobile-signal">' + escapeHtml(scannerSignal(it, activeTab)) + '</span>'
        + '</div>'
        + '<div class="ps-mini-chart-wrap">' + miniChartHtml(it) + '</div>'
        + '<span class="ps-signal">' + escapeHtml(scannerSignal(it, activeTab)) + '</span>'
        + '<span class="ps-quote"><span class="ps-price">' + fmt(it.price) + '</span>'
        + '<span class="ps-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
        + '<span class="ps-observation">' + escapeHtml(scannerInterpretation(it, activeTab)) + '</span>'
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
  }

  // ---- 상세(캔들차트 + 패턴선) ----

  function openDetail(container, item) {
    var detail = container.querySelector('#psDetail');
    if (!detail || !item) return;
    // 이 패턴은 구름 안·상단 시도가 핵심이므로 상세 차트에서 구름을 기본으로 켠다.
    psIchimokuEnabled = activeTab === 'maCloudBreakout';
    detail.hidden = false;
    detail.innerHTML = '<div class="ps-loading"><div class="ps-spinner"></div><div>' + escapeHtml(item.name) + ' 차트를 불러오는 중...</div></div>';
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    PatternScan.fetchJson(GAS_TICKER_URL + '?patternChart=1&code=' + encodeURIComponent(item.code)
      + '&pattern=' + encodeURIComponent(activeTab) + '&scanDate=' + encodeURIComponent(item.date || ''))
      .then(function (data) {
        if (data.error || !data.daily || !data.daily.length) {
          detail.innerHTML = '<div class="ps-error">' + escapeHtml((data && data.message) || '차트를 불러오지 못했어요.') + '</div>';
          return;
        }
        // Box-range scans include market cap in the VM snapshot; GAS cannot
        // reproduce that E condition during an on-demand chart request.
        if ((activeTab === 'boxRangeLow' || activeTab === 'openingGap') && item.patternDetail) {
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

  function renderDetail(box, item, data) {
    var html = '<div class="ps-detail-head">'
      + '<span class="ps-detail-name">' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name) + ' <span class="ps-code">(' + escapeHtml(item.code) + ')</span></span>'
      + '<span class="ps-timeframe-badge">2년 일봉 · 1D</span></span>'
      + '<button type="button" class="ps-close" id="psClose">닫기 ✕</button>'
      + '</div>';
    html += buildScoreBox(data.detail);
    html += '<label class="ps-ichimoku-toggle"><input type="checkbox" id="psIchimokuToggle"' + (psIchimokuEnabled ? ' checked' : '') + ' /> 일목균형표(구름) 표시</label>';
    html += buildIchimokuLegend();
    html += '<div class="ps-pattern-legend">'
      + '<span><i class="ps-pattern-line ps-pattern-line-shape"></i>패턴 형성 근거</span>'
      + '<span><i class="ps-pattern-line ps-pattern-line-level"></i>넥라인 · 지지/저항</span>'
      + '</div>';
    html += '<div class="ps-chart" id="psChart" style="height:' + CHART_H + 'px"></div>';
    html += '<div class="ps-footnote">※ 패턴 판정은 최근 ' + data.daily.length + '영업일 기준 참고 지표이며, 아직 저항선/넥라인을 못 뚫은 "형성 중" 패턴만 표시됩니다. <b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>';
    box.innerHTML = html;

    var closeBtn = box.querySelector('#psClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { destroyPsChart(); box.hidden = true; box.innerHTML = ''; });

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

  function destroyPsChart() {
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

      // 눌림목: 단기 20일선과 장기 1년선(240거래일) 중 어디에서 지지받는지 함께 표시한다.
      if (pattern === 'pullback') {
        addMaLine(chart, daily, 20, MA20_COLOR);
        addMaLine(chart, daily, 240, MA240_COLOR);
      } else if (pattern === 'maCloudBreakout') {
        addMaLine(chart, daily, 5, MA5_EARLY_COLOR);
        addMaLine(chart, daily, 20, MA20_EARLY_COLOR);
        addMaLine(chart, daily, 224, MA224_EARLY_COLOR);
      } else if (pattern === 'angleMomentum') {
        // 각도 계산은 서버에서 전형가·EMA 기준으로 하지만, 상세 차트는 다른 탭과 같은
        // 방식(addMaLine, 종가 기준 단순이동평균)으로 단기/장기선만 시각 참고용으로 겹쳐 그린다.
        addMaLine(chart, daily, 5, MA5_EARLY_COLOR);
        addMaLine(chart, daily, 20, MA20_COLOR);
      } else if (pattern === 'gongpasan') {
        // 20일선(눌림목 지지선)과 파란점선(엔벨로프 상단 = 46일선*1.12, 역매공파 스킬
        // 기준)을 겹쳐 그린다 - 매수 타점(20일선 지지)과 목표가(파란점선)를 한눈에 보이게.
        addMaLine(chart, daily, 20, MA20_COLOR);
        addEnvelopeLine(chart, daily, 46, 1.12, RESIST_COLOR);
      }

      addPatternOverlay(LWC, chart, candleSeries, daily, pattern, detail);

      if (psIchimokuEnabled) addIchimokuOverlay(daily);

      // 약 2년(500거래일) 일봉을 기본 표시한다. 서버가 보유한 일봉이 더 적으면 전체를 쓴다.
      var visibleBars = Math.min(500, daily.length);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, daily.length - visibleBars),
        to: daily.length - 1 + 3
      });

      psLwcThemeObserver = new MutationObserver(function () {
        chart.applyOptions(psThemeOptions());
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
    if (pts.length < 2) return;
    chart.addSeries(global.LightweightCharts.LineSeries, { color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(pts);
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
        addHLine(detail.neckline.price, detail.left_shoulder.date, RESIST_COLOR);
        ['left_shoulder', 'head', 'right_shoulder'].forEach(function (k) { addDot(detail[k], SUPPORT_COLOR, 'belowBar'); });
        addDot(detail.neckline, RESIST_COLOR, 'aboveBar');
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
    } else if (pattern === 'maCloudBreakout') {
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
    } else if (pattern === 'openingGap') {
      if (detail.signal) addSignal(detail.signal);
    } else if (pattern === 'angleMomentum') {
      if (detail.signal) addSignal(detail.signal);
    } else if (pattern === 'gongpasan') {
      if (detail.signal) addSignal(detail.signal); // 눌림목 매수 타점(오돌이 돌파 자체가 아님)
    }

    if (markers.length) LWC.createSeriesMarkers(candleSeries, markers);
  }

  // ---- 유틸 ----

  function fetchJson(url) {
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
