/**
 * 오늘의 증시온도 위젯
 * GAS 프록시 ?marketTemp=1 호출 -> VIX20+외국인수급15+기관수급10+코스피상승비율10+
 * 코스닥상승비율10+거래대금15+환율10+미국선물10=100점을 0~40℃로 환산(temp=score*0.4)해
 * 온도 카드로 렌더링.
 * 2026-07-13: 점수(점) 대신 온도(℃) 표시로 전환, 외국인/기관 수급 분리, 환율/미국 선물지수
 * 추가, 온도 구간별로 카드 배경색이 바뀜(공포=한랭, 과열=온난 톤).
 * 2026-07-14: 상승비율을 코스피/코스닥으로 분리, 지표별 원자료+배지(부호별 색상: 상승/개선=
 * 빨강, 하락/악화=파랑, 0=회색)를 같이 표시, 온도 게이지 재설계(말풍선+구간 라벨), 지표별
 * 아이콘/인포툴팁/카테고리 색상 바, 상단 전일 대비·1주일 평균·1개월 평균 통계(서버가
 * logDailyMarketTemp_ 트리거로 매일 쌓는 일별 기록 기반 - 등록 초기 며칠은 "수집 중" 표시),
 * 하단 해석 가이드 박스 추가. 사용자 제공 목업 디자인을 이 사이트 미니멀 톤에 맞게 재구성.
 * 기존 AI 시황요약(js/sector-dashboard-v4.js의 ?marketAnalysis=1)과 같은 페이지에 병행 배치하는
 * 용도라 이 위젯 자체는 독립 컨테이너(#market-temp)에만 마운트하고 섹터 대시보드는 건드리지 않는다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#market-temp';
  var FETCH_TIMEOUT_MS = 8000;
  var GAUGE_MAX_TEMP = 40; // 총점 100점 = 40.0℃가 이론상 최대치

  // unit: 'index'(그대로 표기) / 'pct'(부호 있는 % - 붉은/파란색) / 'ratio'(상승·하락 종목수)
  // barClass: css/market-temp.css의 카테고리별 바 색상 클래스
  var COMPONENT_META = [
    { key: 'vix', label: 'VIX', max: 20, unit: 'index', icon: '📊', barClass: 'mt-bar-vix',
      desc: '변동성지수(공포지수). 미국 S&P500 옵션의 내재변동성으로 산출 - 낮을수록 시장이 안정적이라는 뜻' },
    { key: 'foreignFlow', label: '외국인 수급', max: 15, unit: 'pct', icon: '👤', barClass: 'mt-bar-flow',
      desc: 'KODEX 200(코스피200 추종 ETF) 최근 5일 외국인 순매수를 20일 평균과 비교' },
    { key: 'instFlow', label: '기관 수급', max: 10, unit: 'pct', icon: '🏛', barClass: 'mt-bar-flow',
      desc: 'KODEX 200 최근 5일 기관 순매수를 20일 평균과 비교' },
    { key: 'riseRatioKospi', label: '코스피 상승비율', max: 10, unit: 'ratio', icon: '↗', barClass: 'mt-bar-rise',
      desc: '코스피 종목 중 상승·하락 종목 수 비율' },
    { key: 'riseRatioKosdaq', label: '코스닥 상승비율', max: 10, unit: 'ratio', icon: '↗', barClass: 'mt-bar-rise',
      desc: '코스닥 종목 중 상승·하락 종목 수 비율' },
    { key: 'tradingValue', label: '거래대금', max: 15, unit: 'pct', icon: '📦', barClass: 'mt-bar-vol',
      desc: '오늘 거래대금을 최근 5거래일 평균과 비교(평소보다 활발하면 가점)' },
    { key: 'exchange', label: '환율', max: 10, unit: 'pct', icon: '💲', barClass: 'mt-bar-fx',
      desc: '원/달러 환율 전일 대비 등락률(원화 강세=환율 하락일수록 가점)' },
    { key: 'usFutures', label: '미국 선물지수', max: 10, unit: 'pct', icon: '🌐', barClass: 'mt-bar-fx',
      desc: 'S&P500 E-mini 선물(ES=F) 등락률 - 미국장 마감~한국장 개장 사이 선행지표' }
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
        container.innerHTML = buildCard(data);
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

    // unit === 'pct'
    var v = typeof comp.ratio === 'number' ? comp.ratio * 100
      : typeof comp.changeRate === 'number' ? comp.changeRate
      : typeof comp.changePct === 'number' ? comp.changePct
      : typeof comp.relative === 'number' ? (comp.relative - 1) * 100
      : null;
    if (v == null) return null;
    var pctTone = v > 0 ? 'mt-val-pos' : v < 0 ? 'mt-val-neg' : 'mt-val-zero';
    return { text: (v > 0 ? '+' : '') + v.toFixed(2) + '%', tone: pctTone };
  }

  // 지표별 짧은 배지 문구(예: "매도", "활발") - VIX/수급/거래대금/환율/선물지수에만 표시,
  // 상승비율은 formatRaw의 "상승X·하락Y" 텍스트 자체가 이미 배지 역할을 겸해서 생략.
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
      case 'foreignFlow':
      case 'instFlow': {
        var r = comp.ratio;
        if (r == null) return null;
        if (r > 0.15) return { word: '매수', tone: 'mt-val-pos' };
        if (r < -0.15) return { word: '매도', tone: 'mt-val-neg' };
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
      + '<div class="mt-bar-track"><div class="mt-bar-fill ' + meta.barClass + '" style="width:' + pct.toFixed(0) + '%"></div></div>'
      + '</div>';
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
