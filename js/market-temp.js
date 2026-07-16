/**
 * 오늘의 증시온도 위젯
 * GAS 프록시 ?marketTemp=1 호출 -> 사용자 지정 스펙(2026-07-14) 9개 지표(VIX20+수급20+
 * 거래대금15+평균등락률15+상승비율10+섹터강도10+52주신고저10+환율5+미국선물5=110점)를
 * 0~40℃로 환산(temp = 총점 × 40/실제만점, 서버가 계산해서 그대로 내려줌)해 온도 카드로
 * 렌더링. 코스피·코스닥 지수(시가총액 가중) 대신 섹터 풀 종목을 동일가중으로 써서
 * 대형주 몇 개가 지수를 왜곡하는 효과를 줄인 게 이 스펙의 핵심 취지.
 * 2026-07-13: 점수(점) 대신 온도(℃) 표시로 전환, 온도 구간별로 카드 배경색이 바뀜
 * (공포=한랭, 과열=온난 톤).
 * 2026-07-14: 지표별 원자료+배지(부호별 색상: 상승/개선=빨강, 하락/악화=파랑, 0=회색)를
 * 같이 표시, 온도 게이지 재설계(말풍선+구간 라벨), 지표별 아이콘/인포툴팁/카테고리 색상 바,
 * 상단 전일 대비·1주일 평균·1개월 평균 통계(서버가 logDailyMarketTemp_ 트리거로 매일
 * 쌓는 일별 기록 기반 - 등록 초기 며칠은 "수집 중" 표시), 하단 해석 가이드 박스 추가.
 * 같은날 후반: 외국인/기관 수급을 "수급" 하나로 통합(외국인75%+기관25% 가중), 268개
 * 평균등락률·상승비율(코스피/코스닥 통합)·섹터강도·52주 신고가/신저가로 배점 전면 개편.
 * 사용자 제공 목업 디자인을 이 사이트 미니멀 톤에 맞게 재구성.
 * 기존 AI 시황요약(js/sector-dashboard-v4.js의 ?marketAnalysis=1)과 같은 페이지에 병행 배치하는
 * 용도라 이 위젯 자체는 독립 컨테이너(#market-temp)에만 마운트하고 섹터 대시보드는 건드리지 않는다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#market-temp';
  var FETCH_TIMEOUT_MS = 8000;
  var GAUGE_MAX_TEMP = 40; // 서버가 실제 만점(현재 110점) 기준으로 이미 0~40℃로 정규화해서 내려줌

  // unit: 'index'(그대로 표기) / 'pct'(부호 있는 % - 붉은/파란색) / 'pctDirect'(comp에 이미 %
  // 단위로 들어있는 값) / 'ratio'(상승·하락 종목수) / 'sectorCount'(섹터 강도) /
  // 'week52Count'(52주 신고가/신저가 개수) / 'flow'(외국인+기관 통합 수급 전용 포맷)
  // barClass: css/market-temp.css의 카테고리별 바 색상 클래스
  var COMPONENT_META = [
    { key: 'vix', label: 'VIX', max: 20, unit: 'index', icon: '📊', barClass: 'mt-bar-vix',
      desc: '변동성지수(공포지수). 미국 S&P500 옵션의 내재변동성으로 산출 - 낮을수록 시장이 안정적이라는 뜻' },
    { key: 'flow', label: '수급(외국인+기관)', max: 20, unit: 'flow', icon: '💰', barClass: 'mt-bar-flow',
      desc: 'KODEX 200 최근 5일 순매수를 20일 평균과 비교, 외국인 75%+기관 25% 가중합산' },
    { key: 'tradingValue', label: '거래대금', max: 15, unit: 'pct', icon: '📦', barClass: 'mt-bar-vol',
      desc: '섹터 풀 종목 거래대금 합계를 최근 5거래일 평균과 비교(평소보다 활발하면 가점)' },
    { key: 'avgChange', label: '평균등락률', max: 15, unit: 'pctDirect', icon: '📈', barClass: 'mt-bar-rise',
      desc: '섹터 풀 종목 동일가중(시가총액 가중 아님) 평균 등락률 - 일부 대형주만 오르는 상황을 지수보다 잘 잡아냄' },
    { key: 'riseRatio', label: '상승비율', max: 10, unit: 'ratio', icon: '↗', barClass: 'mt-bar-rise',
      desc: '섹터 풀(코스피+코스닥 통합) 상승·하락 종목 수 비율' },
    { key: 'sectorStrength', label: '섹터 강도', max: 10, unit: 'sectorCount', icon: '🏭', barClass: 'mt-bar-vol',
      desc: '각 섹터의 평균등락률·상승비율을 종합 - 강세 섹터가 많을수록 가점' },
    { key: 'week52', label: '52주 신고가/신저가', max: 10, unit: 'week52Count', icon: '🚀', barClass: 'mt-bar-vix',
      desc: '섹터 풀 종목 중 52주 신고가·신저가 종목 수(VM이 하루 1회 미리 계산)' },
    { key: 'exchange', label: '환율', max: 5, unit: 'pct', icon: '💲', barClass: 'mt-bar-fx',
      desc: '원/달러 환율 전일 대비 등락률(원화 강세=환율 하락일수록 가점)' },
    { key: 'usFutures', label: '미국 선물지수', max: 5, unit: 'pct', icon: '🌐', barClass: 'mt-bar-fx',
      desc: 'S&P500 E-mini 선물(ES=F) 등락률, 시간대별 가중치 적용 - 미국장 마감~한국장 개장 사이 선행지표' }
  ];

  // 사용자 지정 온도(℃) 구간 - tone은 css/market-temp.css의 카드 배경색 클래스와 매칭.
  var GRADE_BANDS = [
    { range: '0~10℃', emoji: '🧊', label: '극단적 공포', tone: 'extreme-fear' },
    { range: '10~20℃', emoji: '🔵', label: '공포', tone: 'fear' },
    { range: '20~28℃', emoji: '🟡', label: '중립', tone: 'neutral' },
    { range: '28~35℃', emoji: '🟠', label: '탐욕', tone: 'greed' },
    { range: '35~40℃', emoji: '🔥', label: '극단적 탐욕', tone: 'extreme-greed' }
  ];

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<div class="mt-hint">증시온도 불러오는 중...</div>';

    MarketTemp.fetchMarketTemp()
      .then(function (data) {
        if (!data || typeof data.temp !== 'number') {
          container.innerHTML = '<div class="mt-error">증시온도를 불러오지 못했습니다.</div>';
          return;
        }
        container.innerHTML = buildCard(data) + buildExploreCard();
        wireViewTabs(container);
      })
      .catch(function () {
        container.innerHTML = '<div class="mt-error">증시온도를 불러오지 못했습니다.</div>';
      });
  }

  function fetchMarketTemp() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(GAS_TICKER_URL + '?marketTemp=1', hasAbort ? { signal: controller.signal } : {})
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

  function buildStats(history) {
    if (!history) {
      return '<div class="mt-stats"><div class="mt-stats-empty">전일·주간·월간 비교 데이터 수집 중 (며칠 후부터 표시됩니다)</div></div>';
    }
    var dayTone = history.dayChange > 0 ? 'mt-val-pos' : history.dayChange < 0 ? 'mt-val-neg' : 'mt-val-zero';
    var arrow = history.dayChange > 0 ? '▲' : history.dayChange < 0 ? '▼' : '-';
    return ''
      + '<div class="mt-stats">'
      + '<div class="mt-stat"><div class="mt-stat-label">전일 대비</div>'
      + '<div class="mt-stat-value ' + dayTone + '">' + arrow + Math.abs(history.dayChange).toFixed(1) + '℃</div>'
      + '<div class="mt-stat-sub">어제 ' + history.yesterday.toFixed(1) + '℃</div></div>'
      + '<div class="mt-stat"><div class="mt-stat-label">1주일 평균</div>'
      + '<div class="mt-stat-value">' + history.weekAvg.toFixed(1) + '℃</div>'
      + '<div class="mt-stat-sub">지난 ' + history.weekDays + '일</div></div>'
      + '<div class="mt-stat"><div class="mt-stat-label">1개월 평균</div>'
      + '<div class="mt-stat-value">' + history.monthAvg.toFixed(1) + '℃</div>'
      + '<div class="mt-stat-sub">지난 ' + history.monthDays + '일</div></div>'
      + '</div>';
  }

  function buildGauge(temp) {
    var pct = Math.max(0, Math.min(100, (temp / GAUGE_MAX_TEMP) * 100));
    return ''
      + '<div class="mt-gauge">'
      + '<div class="mt-gauge-bubble" style="left:' + pct.toFixed(1) + '%">' + temp.toFixed(1) + '℃</div>'
      + '<div class="mt-gauge-track"><div class="mt-gauge-marker" style="left:' + pct.toFixed(1) + '%"></div></div>'
      + '<div class="mt-gauge-scale"><span>0℃</span><span>10℃</span><span>20℃</span><span>28℃</span><span>35℃</span><span>40℃</span></div>'
      + '<div class="mt-gauge-bands"><span>극단적 공포</span><span>공포</span><span>중립</span><span>탐욕</span><span>극단적 탐욕</span></div>'
      + '</div>';
  }

  function buildRow(meta, comp) {
    var score = comp && typeof comp.score === 'number' ? comp.score : 0;
    var pct = meta.max ? Math.max(0, Math.min(100, (score / meta.max) * 100)) : 0;
    var raw = formatRaw(meta, comp);
    var badge = classify(meta, comp);

    return ''
      + '<div class="mt-bar-row">'
      + '<div class="mt-bar-topline">'
      + '<span class="mt-bar-head">'
      + '<span class="mt-bar-icon">' + meta.icon + '</span>'
      + '<span class="mt-bar-label">' + escapeHtml(meta.label) + '</span>'
      + '<span class="mt-info" title="' + escapeHtml(meta.desc) + '">ⓘ</span>'
      + '</span>'
      + '<span class="mt-bar-value">'
      + (raw ? '<span class="' + raw.tone + '">' + escapeHtml(raw.text) + '</span> ' : '')
      + (badge ? '<span class="mt-pill ' + badge.tone + '">' + escapeHtml(badge.word) + '</span> ' : '')
      + '<small>(' + score + '/' + meta.max + ')</small>'
      + '</span>'
      + '</div>'
      // 점수 0점은 폭 0%라 막대가 통째로 안 보여 "로딩 실패"처럼 오해받기 쉬워서, 이 경우만
      // 최소 4px 폭을 줘서 "0점으로 정상 렌더링됐다"는 걸 눈으로 구분할 수 있게 한다.
      + '<div class="mt-bar-track"><div class="mt-bar-fill ' + meta.barClass + '" style="width:' + (pct > 0 ? pct.toFixed(0) + '%' : '4px') + '"></div></div>'
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

  function buildExploreCard() {
    var toggleHtml = '<div class="mt-view-toggle">' + VIEW_TABS.map(function (t, i) {
      return '<button type="button" class="mt-view-btn' + (i === 0 ? ' active' : '') + '" data-view="' + t.key + '">' + escapeHtml(t.label) + '</button>';
    }).join('') + '</div>';
    return ''
      + '<div class="mt-card mt-explore-card">'
      + toggleHtml
      + '<div class="mt-view-panels">'
      + '<div class="mt-view-panel" data-view-panel="cards"></div>'
      + '<div class="mt-view-panel" data-view-panel="heatmap" hidden></div>'
      + '<div class="mt-view-panel" data-view-panel="marketcap" hidden></div>'
      + '</div>'
      + '</div>';
  }

  // 섹터 풀(SECTOR_MAP) 전체 종목 코드를 모아 시세를 한 번에 조회 - 카드 보기/히트맵 보기가
  // 공유하는 헬퍼(SD.renderCardsHtml/renderHeatmapHtml 둘 다 이 codes 목록이 필요).
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

  function loadCardsPanel(panel) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    var SD = global.SectorDashboard;
    var sectorMap = global.SECTOR_MAP;
    if (!SD || !sectorMap) {
      panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>';
      return;
    }
    var krxMap = global.KRX_MAP || {};
    var codes = sectorPoolCodes(sectorMap, krxMap);
    if (!codes.length) { panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>'; return; }

    if (SD.injectBadgeStyles) SD.injectBadgeStyles();
    panel.innerHTML = '<div class="mt-hint">종목 카드 불러오는 중...</div>';
    SD.fetchTickerData(codes).then(function (list) {
      var byCode = {};
      (list || []).forEach(function (item) { if (item && item.code) byCode[item.code] = item; });
      var html = SD.renderCardsHtml(sectorMap, krxMap, byCode);
      panel.innerHTML = html ? '<div class="sector-cards-grid">' + html + '</div>' : '<div class="mt-error">표시할 시세가 없습니다.</div>';
    }).catch(function () {
      panel.innerHTML = '<div class="mt-error">종목 카드를 불러오지 못했습니다.</div>';
    });
  }

  function loadHeatmapPanel(panel) {
    if (panel.__mtLoaded) return;
    panel.__mtLoaded = true;
    var SD = global.SectorDashboard;
    var sectorMap = global.SECTOR_MAP;
    if (!SD || !sectorMap) {
      panel.innerHTML = '<div class="mt-error">히트맵을 불러오지 못했습니다.</div>';
      return;
    }
    var krxMap = global.KRX_MAP || {};
    var codes = sectorPoolCodes(sectorMap, krxMap);
    if (!codes.length) { panel.innerHTML = '<div class="mt-error">히트맵을 불러오지 못했습니다.</div>'; return; }

    panel.innerHTML = '<div class="mt-hint">히트맵 불러오는 중...</div>';
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
    global.MarketcapBubble.init();
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
    if (panels.cards) loadCardsPanel(panels.cards);
  }

  function buildGuide() {
    var items = GRADE_BANDS.map(function (b) {
      return '<span>' + b.range + ': ' + escapeHtml(b.label) + '</span>';
    }).join('');
    return ''
      + '<div class="mt-guide">'
      + '<span class="mt-guide-icon">💡</span>'
      + '<div class="mt-guide-body">'
      + '<div class="mt-guide-title">해석 가이드</div>'
      + '<div class="mt-guide-grid">' + items + '</div>'
      + '</div>'
      + '</div>';
  }

  function buildCard(data) {
    var grade = data.grade || { emoji: '', label: '' };
    var tone = grade.tone || 'neutral';
    var rows = COMPONENT_META.map(function (meta) {
      return buildRow(meta, data.components && data.components[meta.key]);
    }).join('');

    return ''
      + '<div class="mt-card mt-tone-' + escapeHtml(tone) + '">'
      + '<div class="mt-head">'
      + '<div class="mt-head-title">🌡 오늘의 증시온도 <span class="mt-info" title="시장이 과열되거나 침체된 정도를 온도로 보여드립니다.">ⓘ</span></div>'
      + buildStats(data.history)
      + '</div>'
      + '<div class="mt-main">'
      + '<span class="mt-score">' + data.temp.toFixed(1) + '<span class="mt-score-unit">℃</span></span>'
      + '<span class="mt-grade-pill">' + escapeHtml(grade.emoji) + ' ' + escapeHtml(grade.label) + '</span>'
      + '</div>'
      + '<div class="mt-sub">시장이 과열되거나 침체된 정도를 온도로 보여드립니다.</div>'
      + buildGauge(data.temp)
      + '<div class="mt-bars">' + rows + '</div>'
      + buildGuide()
      + (data.updatedAt ? '<div class="mt-updated">🔄 업데이트 ' + escapeHtml(data.updatedAt) + '</div>' : '')
      + '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var MarketTemp = {
    init: init,
    fetchMarketTemp: fetchMarketTemp
  };
  global.MarketTemp = MarketTemp;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
