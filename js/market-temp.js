/**
 * 오늘의 증시온도 위젯 (2026-07-18 전면 개편)
 * GAS 프록시 ?marketTemp=1 호출 -> 9개 지표(VIX20+수급20+거래대금15+평균등락률15+상승비율10
 * +섹터강도10+52주신고저10+환율5+미국선물5=110점)를 0~40℃로 환산해 온도 카드로 렌더링하는
 * 구조 자체는 유지. 이번 개편은 "정보는 있는데 3초 안에 안 읽힌다"는 피드백에 따라 CNN
 * Fear&Greed Index 스타일의 대표 콘텐츠로 재구성한 것 - 백엔드 계산은 대부분 그대로 두고
 * (gas/ticker-proxy.gs getMarketTemp), 응답에 recentDays(스파크라인용)와 지표별 band
 * (계산식 투명성용) 필드만 추가했다.
 *
 * 섹션 순서(2026-07-18 5차 기준): Hero+게이지(좌우 병합) -> AI 시장 브리핑(단독) -> 시장
 * 구성요소(표, 영향 큰 순 정렬) | 시장 레이더(좌우) -> 최근 7일 스파크라인 | 오늘 투자전략
 * (좌우) -> 온도 기준표(카드형) -> (기존 유지) 카드보기/히트맵보기/시총비례 탐색.
 * "오늘 시장 영향요인 TOP5"는 시장 구성요소와 내용이 중복이라는 지적(5차)에 따라 별도
 * 섹션을 없애고 구성요소 표를 |기여도| 내림차순 정렬하는 것으로 흡수 통합함.
 *
 * 투자시그널/투자전략은 "역발상형"(공포=매수 신호, CNN F&G 지수의 통상적 활용법)으로
 * 매핑 - 사용자 확정. "Data Quality %" 같은 근거 없는 가짜 수치는 넣지 않고 실시간 배지 +
 * 업데이트 시각만 표시하기로 함(사용자 확정). 오늘의 전략 액션 문구는 매수=빨강/매도=파랑
 * (사이트 공통 부호색) - 5차에 등급색에서 이 방식으로 변경.
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
  // icon: 2026-07-18 스펙 지정 아이콘으로 통일(vix/수급/거래대금/신고가/섹터강도/상승비율/
  // 환율/미국선물 8개는 스펙 명시 그대로, avgChange만 스펙에 없어 겹치지 않는 신규 아이콘 배정)
  var COMPONENT_META = [
    { key: 'vix', label: 'VIX', max: 20, unit: 'index', icon: '😨', barClass: 'mt-bar-vix',
      desc: '변동성지수(공포지수). 미국 S&P500 옵션의 내재변동성으로 산출 - 낮을수록 시장이 안정적이라는 뜻' },
    { key: 'flow', label: '수급(외국인+기관)', max: 20, unit: 'flow', icon: '🏦', barClass: 'mt-bar-flow',
      desc: 'KODEX 200 최근 5일 순매수를 20일 평균과 비교, 외국인 75%+기관 25% 가중합산' },
    { key: 'tradingValue', label: '거래대금', max: 15, unit: 'pct', icon: '📊', barClass: 'mt-bar-vol',
      desc: '섹터 풀 종목 거래대금 합계를 최근 5거래일 평균과 비교(평소보다 활발하면 가점)' },
    { key: 'avgChange', label: '평균등락률', max: 15, unit: 'pctDirect', icon: '💹', barClass: 'mt-bar-rise',
      desc: '섹터 풀 종목 동일가중(시가총액 가중 아님) 평균 등락률 - 일부 대형주만 오르는 상황을 지수보다 잘 잡아냄' },
    { key: 'riseRatio', label: '상승비율', max: 10, unit: 'ratio', icon: '⚡', barClass: 'mt-bar-rise',
      desc: '섹터 풀(코스피+코스닥 통합) 상승·하락 종목 수 비율' },
    { key: 'sectorStrength', label: '섹터 강도', max: 10, unit: 'sectorCount', icon: '🏭', barClass: 'mt-bar-vol',
      desc: '각 섹터의 평균등락률·상승비율을 종합 - 강세 섹터가 많을수록 가점' },
    { key: 'week52', label: '52주 신고가/신저가', max: 10, unit: 'week52Count', icon: '📈', barClass: 'mt-bar-vix',
      desc: '섹터 풀 종목 중 52주 신고가·신저가 종목 수(VM이 하루 1회 미리 계산)' },
    { key: 'exchange', label: '환율', max: 5, unit: 'pct', icon: '💵', barClass: 'mt-bar-fx',
      desc: '원/달러 환율 전일 대비 등락률(원화 강세=환율 하락일수록 가점)' },
    { key: 'usFutures', label: '미국 선물지수', max: 5, unit: 'pct', icon: '🌎', barClass: 'mt-bar-fx',
      desc: 'S&P500 E-mini 선물(ES=F) 등락률, 시간대별 가중치 적용 - 미국장 마감~한국장 개장 사이 선행지표' }
  ];
  var COMPONENT_BY_KEY = {};
  COMPONENT_META.forEach(function (m) { COMPONENT_BY_KEY[m.key] = m; });

  // 레이더 차트 6축(사용자 스펙 명시 그대로) - COMPONENT_META의 서브셋을 재사용.
  var RADAR_KEYS = ['vix', 'flow', 'tradingValue', 'exchange', 'usFutures', 'riseRatio'];

  // 사용자 지정 온도(℃) 구간 - tone은 css/market-temp.css의 카드 배경색 클래스와 매칭.
  // color: 2026-07-18 스펙 지정 5색(등급 필/게이지/기준표/레이더 강조색에 일괄 적용).
  var GRADE_BANDS = [
    { range: '0~10℃', emoji: '🧊', label: '극단적 공포', tone: 'extreme-fear', color: '#1565C0' },
    { range: '10~20℃', emoji: '🔵', label: '공포', tone: 'fear', color: '#42A5F5' },
    { range: '20~28℃', emoji: '🟡', label: '중립', tone: 'neutral', color: '#FFD54F' },
    { range: '28~35℃', emoji: '🟠', label: '탐욕', tone: 'greed', color: '#FB8C00' },
    { range: '35~40℃', emoji: '🔥', label: '극단적 탐욕', tone: 'extreme-greed', color: '#E53935' }
  ];
  var GRADE_BY_TONE = {};
  GRADE_BANDS.forEach(function (b) { GRADE_BY_TONE[b.tone] = b; });

  // 역발상형 투자시그널(사용자 확정: 공포=매수 신호, CNN Fear&Greed 지수의 통상적 활용법).
  var SIGNAL_BY_TONE = {
    'extreme-fear': { label: '적극매수', stars: 5 },
    'fear': { label: '매수', stars: 4 },
    'neutral': { label: '관망', stars: 3 },
    'greed': { label: '주의', stars: 2 },
    'extreme-greed': { label: '위험', stars: 1 }
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

  // opts.gaugeOnly: true면 카드보기/히트맵보기/시총트리맵 탐색카드(buildExploreCard) 없이
  // 온도 게이지 카드(buildCard)만 렌더링한다 - js/home-dashboard.js가 트리맵을 별도 카드로
  // 직접 배치할 때, 같은 #marketcap-bubble을 여기서 또 만들지 않기 위해 사용.
  function init(opts) {
    var gaugeOnly = !!(opts && opts.gaugeOnly);
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<div class="mt-hint">증시온도 불러오는 중...</div>';

    MarketTemp.fetchMarketTemp()
      .then(function (data) {
        if (!data || typeof data.temp !== 'number') {
          container.innerHTML = '<div class="mt-error">증시온도를 불러오지 못했습니다.</div>';
          return;
        }
        container.innerHTML = buildCard(data) + (gaugeOnly ? '' : buildExploreCard());
        wireAnimations(container, data);
        loadAiBriefing(container);
        if (!gaugeOnly) wireViewTabs(container);
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
          mount.innerHTML = '<p class="mt-ai-text mt-ai-empty">AI 브리핑을 생성하지 못했습니다.</p>';
        }
      })
      .catch(function () {
        mount.innerHTML = '<p class="mt-ai-text mt-ai-empty">AI 브리핑을 불러오지 못했습니다.</p>';
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

  // 점수 기여도 = 점수 - 만점/2 (양수=온도 상승 방향/탐욕, 음수=하락 방향/공포).
  // 개별 지표 행/TOP5 영향요인 카드가 공유하는 계산식 - GAS getMarketTempBriefing()의
  // AI 프롬프트도 동일한 공식을 쓴다(숫자 불일치 방지).
  function contribution(meta, comp) {
    var score = comp && typeof comp.score === 'number' ? comp.score : meta.max / 2;
    return score - meta.max / 2;
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
      deltasHtml = '<div class="mt-hero-delta-empty">전일·주간·월간 비교 데이터 수집 중 (며칠 후부터 표시됩니다)</div>';
    }

    return ''
      + '<div class="mt-hero">'
      + '<div class="mt-hero-left">'
      + '<div class="mt-hero-title">🌡 오늘의 증시온도 <span class="mt-info" data-tooltip="시장이 과열되거나 침체된 정도를 온도로 보여드립니다.">ⓘ</span></div>'
      + '<div class="mt-hero-main">'
      // 2026-07-18: 초기 렌더 값을 "0.0"(애니메이션 시작점) 대신 이미 정답 온도로 그린다 -
      // requestAnimationFrame이 안 도는 환경(백그라운드 탭에서 페이지가 로드되는 경우 등
      // 실제로 존재함, 로컬 테스트에서 rAF가 전혀 안 도는 것을 실측 확인)에서도 항상 올바른
      // 값이 보이게 하기 위함(count-up은 순수 시각효과, 실패해도 데이터는 정확해야 함).
      + '<span class="mt-score" data-count-target="' + data.temp.toFixed(1) + '">' + data.temp.toFixed(1) + '<span class="mt-score-unit">℃</span></span>'
      + '<span class="mt-grade-pill" style="background:' + grade.color + '22;color:' + grade.color + '">' + escapeHtml(grade.emoji) + ' ' + escapeHtml(grade.label) + '</span>'
      + '</div>'
      + '<div class="mt-hero-deltas">' + deltasHtml + '</div>'
      + '</div>'
      + '<div class="mt-hero-right">'
      + '<div class="mt-hero-signal-label">오늘의 투자시그널</div>'
      + starsHtml
      + '<div class="mt-hero-signal-word" style="color:' + grade.color + '">' + escapeHtml(signal.label) + '</div>'
      + '</div>'
      + '</div>';
  }

  // ---- ② AI 시장 브리핑 (비동기로 채워짐 - loadAiBriefing 참고) ----

  function buildAiBriefingShell() {
    return ''
      + '<div class="mt-card mt-ai-card">'
      + '<div class="mt-card-title">🤖 AI 시장 브리핑</div>'
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

  // 2026-07-18(3차): 게이지를 Hero 아래(세로)가 아니라 옆(가로)에 배치(사용자 요청 -
  // "온도를 본 직후 바로 옆에서 위치 확인", 크기는 축소 가능) - .mt-hero-row가 좌우로
  // 나란히 놓고, 게이지 쪽은 .mt-gauge-side로 감싸 CSS에서 폭을 줄이고 글자도 작게 조정.
  function buildHeroCard(data) {
    return '<div class="mt-section mt-card mt-hero-card">'
      + '<div class="mt-hero-row">'
      + buildHero(data)
      + '<div class="mt-gauge-side">' + buildGauge(data.temp) + '</div>'
      + '</div>'
      + '</div>';
  }

  // ---- ③ 시장 구성 요소 (2026-07-18 5차: "오늘 시장 영향요인 TOP5"와 중복이라는 지적에
  // 따라 별도 섹션을 없애고 하나로 합침 - 9개 지표를 |기여도| 내림차순으로 정렬한 표
  // 하나로 통합하면 자연스럽게 "영향 큰 순서"가 되어 TOP5 리스트가 따로 필요 없다.
  // 카드형 대신 표 형태로(사용자 요청) - 상위 3개 행은 은은한 강조 배경으로 표시해
  // "오늘 가장 큰 영향을 준 지표"를 여전히 한눈에 알아볼 수 있게 한다. ----

  function buildComponentRow(meta, comp, rank) {
    var score = comp && typeof comp.score === 'number' ? comp.score : 0;
    var pct = meta.max ? Math.max(0, Math.min(100, (score / meta.max) * 100)) : 0;
    var raw = formatRaw(meta, comp);
    var c = contribution(meta, comp);
    var band = comp && comp.band ? comp.band : null;
    var tooltip = meta.desc + (band ? ' — 현재 구간: ' + band : '');

    return ''
      + '<tr class="mt-comp-tr' + (rank < 3 ? ' mt-comp-tr-top' : '') + '">'
      + '<td class="mt-comp-td-label">'
      + '<span class="mt-comp-icon">' + meta.icon + '</span>'
      + '<span class="mt-comp-label">' + escapeHtml(meta.label) + '</span>'
      + '<span class="mt-info" data-tooltip="' + escapeHtml(tooltip) + '">ⓘ</span>'
      + '</td>'
      + '<td class="mt-comp-td-value' + (raw ? ' ' + raw.tone : '') + '">' + (raw ? escapeHtml(raw.text) : '-') + '</td>'
      + '<td class="mt-comp-td-contrib ' + contribTone(c) + '">' + fmtContribution(c) + '</td>'
      // 점수 0점은 폭 0%라 바가 통째로 안 보여 "로딩 실패"처럼 오해받기 쉬워서, 이 경우만
      // 최소 4px 폭을 줘서 "0점으로 정상 렌더링됐다"는 걸 눈으로 구분할 수 있게 한다.
      + '<td class="mt-comp-td-bar"><div class="mt-comp-bar-track"><div class="mt-comp-bar-fill mt-anim-width ' + meta.barClass + '" style="width:' + (pct > 0 ? pct.toFixed(0) + '%' : '4px') + ';--mt-target-width:' + (pct > 0 ? pct.toFixed(0) + '%' : '4px') + '"></div></div></td>'
      + '</tr>';
  }

  function buildBars(data) {
    var ranked = COMPONENT_META.map(function (meta) {
      var comp = data.components && data.components[meta.key];
      return { meta: meta, comp: comp, c: contribution(meta, comp) };
    }).sort(function (a, b) { return Math.abs(b.c) - Math.abs(a.c); });

    var rows = ranked.map(function (r, i) { return buildComponentRow(r.meta, r.comp, i); }).join('');
    return ''
      + '<div class="mt-card">'
      + '<div class="mt-card-title">📊 시장 구성 요소 <span class="mt-card-subtitle">(영향 큰 순)</span></div>'
      + '<div class="mt-comp-table-wrap"><table class="mt-comp-table"><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  // ---- ⑥ 최근 7일 스파크라인 ----

  function buildSparkline(data) {
    var days = data.recentDays || [];
    if (days.length < 2) {
      return ''
        + '<div class="mt-card">'
        + '<div class="mt-card-title">📈 최근 7일 증시온도</div>'
        + '<div class="mt-stats-empty">추이 데이터 수집 중 (며칠 후부터 표시됩니다)</div>'
        + '</div>';
    }
    var W = 600, H = 100, PAD = 8;
    var temps = days.map(function (d) { return d.temp; });
    var min = Math.min.apply(null, temps), max = Math.max.apply(null, temps);
    var range = (max - min) || 1;
    var stepX = (W - PAD * 2) / (days.length - 1);
    var points = days.map(function (d, i) {
      var x = PAD + i * stepX;
      var y = H - PAD - ((d.temp - min) / range) * (H - PAD * 2);
      return { x: x, y: y, temp: d.temp, date: d.date };
    });
    var pathD = points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var lastColor = (GRADE_BY_TONE[gradeForTempClient_(temps[temps.length - 1]).tone] || {}).color || '#888';
    var dots = points.map(function (p, i) {
      var isLast = i === points.length - 1;
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (isLast ? 4 : 2.5) + '" fill="' + lastColor + '"'
        + (isLast ? '' : ' opacity="0.5"') + '><title>' + escapeHtml(p.date) + ' ' + p.temp.toFixed(1) + '℃</title></circle>';
    }).join('');
    var recentLabels = points.slice(-3).reverse().map(function (p, i) {
      var lbl = i === 0 ? '오늘' : i === 1 ? '어제' : '1주전';
      return '<span>' + lbl + ' <b>' + p.temp.toFixed(1) + '</b></span>';
    }).join('');

    return ''
      + '<div class="mt-card">'
      + '<div class="mt-card-title">📈 최근 ' + days.length + '일 증시온도</div>'
      + '<svg class="mt-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + '<path class="mt-spark-path mt-spark-draw" d="' + pathD + '" fill="none" stroke="' + lastColor + '" stroke-width="2.5"></path>'
      + dots
      + '</svg>'
      + '<div class="mt-spark-labels">' + recentLabels + '</div>'
      + '</div>';
  }

  // GAS gradeForTemp_와 동일한 밴드 - 프론트에서 과거 스파크라인 포인트의 색을 정할 때만
  // 씀(서버가 각 포인트마다 grade를 안 내려주므로 클라이언트에서 동일 로직 재현).
  function gradeForTempClient_(temp) {
    for (var i = 0; i < GRADE_BANDS.length; i++) {
      var b = GRADE_BANDS[i];
      var upper = i === GRADE_BANDS.length - 1 ? Infinity : parseInt(b.range.split('~')[1], 10);
      if (temp < upper || i === GRADE_BANDS.length - 1) return b;
    }
    return GRADE_BANDS[GRADE_BANDS.length - 1];
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
      // 2026-07-18(4차): 등급색 왼쪽 강조선 제거(사용자 피드백 - AI브리핑 카드와 같은
      // "AI가 만든 티" 나는 요소라 앞서 그쪽도 뺐었는데 여기 남아있던 걸 마저 제거).
      + '<div class="mt-card mt-strategy-card">'
      + '<div class="mt-card-title">🎯 오늘의 전략</div>'
      + '<div class="mt-strategy-action ' + s.actionTone + '">' + escapeHtml(s.action) + '</div>'
      + '<div class="mt-strategy-bars">'
      + '<div class="mt-strategy-bar-row"><span>주식비중</span><div class="mt-strategy-bar"><div class="mt-strategy-bar-fill" style="width:' + s.stock + '%;background:' + grade.color + '"></div></div><b>' + s.stock + '%</b></div>'
      + '<div class="mt-strategy-bar-row"><span>현금</span><div class="mt-strategy-bar"><div class="mt-strategy-bar-fill mt-strategy-bar-cash" style="width:' + s.cash + '%"></div></div><b>' + s.cash + '%</b></div>'
      + '</div>'
      + '<div class="mt-strategy-note">⚠ ' + escapeHtml(s.note) + '</div>'
      + '</div>';
  }

  // ---- ⑨ 온도 기준표(카드형) ----

  function buildGuide() {
    var cards = GRADE_BANDS.map(function (b, i) {
      var stars = '★'.repeat(5 - i) + '<span class="mt-guide-stars-empty">' + '★'.repeat(i) + '</span>';
      return '<div class="mt-guide-card" style="border-color:' + b.color + '55">'
        + '<div class="mt-guide-card-range" style="color:' + b.color + '">' + b.range + '</div>'
        + '<div class="mt-guide-card-label">' + escapeHtml(b.emoji) + ' ' + escapeHtml(b.label) + '</div>'
        + '<div class="mt-guide-card-stars" style="color:' + b.color + '">' + stars + '</div>'
        + '</div>';
    }).join('');
    return ''
      + '<div class="mt-section mt-card">'
      + '<div class="mt-card-title">📖 증시온도 기준표</div>'
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
      buildHeroCard(data),                          // ① Hero(온도+투자시그널) | 게이지 (좌우)
      '<div class="mt-section">' + buildAiBriefingShell() + '</div>', // ② AI 시장 브리핑(5차: TOP5 병합으로 단독 배치, 폭 넓어져 가독성 개선)
      row2col(buildBars(data), buildRadar(data)),   // ③ 시장 구성요소(표) | 시장 레이더 (좌우)
      row2col(buildSparkline(data), buildStrategy(grade)), // ④ 최근7일 | 오늘의 전략
      buildGuide()                                   // ⑤ 온도 기준표
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

  function wireAnimations(container) {
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
    var sparkPath = container.querySelector('.mt-spark-draw');
    if (sparkPath && sparkPath.getTotalLength) {
      var len = sparkPath.getTotalLength();
      var revealed = false;
      function reveal() { if (revealed) return; revealed = true; sparkPath.style.strokeDashoffset = '0'; }
      sparkPath.style.strokeDasharray = len;
      sparkPath.style.strokeDashoffset = len;
      requestAnimationFrame(function () { requestAnimationFrame(reveal); });
      setTimeout(reveal, 1000);
    }
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
