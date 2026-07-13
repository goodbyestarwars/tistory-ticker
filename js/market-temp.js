/**
 * 오늘의 증시온도 위젯
 * GAS 프록시 ?marketTemp=1 호출 -> VIX20+외국인수급15+기관수급10+상승비율20+거래대금15+
 * 환율10+미국선물10=100점을 0~40℃로 환산(temp=score*0.4)해 온도 카드로 렌더링.
 * 2026-07-13: 점수(점) 대신 온도(℃) 표시로 전환, 외국인/기관 수급 분리, 환율/미국 선물지수
 * 추가, 온도 구간별로 카드 배경색이 바뀜(공포=한랭, 과열=온난 톤).
 * 기존 AI 시황요약(js/sector-dashboard-v4.js의 ?marketAnalysis=1)과 같은 페이지에 병행 배치하는
 * 용도라 이 위젯 자체는 독립 컨테이너(#market-temp)에만 마운트하고 섹터 대시보드는 건드리지 않는다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#market-temp';
  var FETCH_TIMEOUT_MS = 8000;

  var COMPONENT_META = [
    { key: 'vix', label: 'VIX', max: 20 },
    { key: 'foreignFlow', label: '외국인 수급', max: 15 },
    { key: 'instFlow', label: '기관 수급', max: 10 },
    { key: 'riseRatio', label: '상승비율', max: 20 },
    { key: 'tradingValue', label: '거래대금(5일평균비)', max: 15 },
    { key: 'exchange', label: '환율(원/달러)', max: 10 },
    { key: 'usFutures', label: '미국 선물지수', max: 10 }
  ];

  // 사용자 지정 온도(℃) 구간 - tone은 css/market-temp.css의 카드 배경색 클래스와 매칭.
  var GRADE_BANDS = [
    { range: '0~10℃', emoji: '🧊', label: '극도의 공포', tone: 'extreme-fear' },
    { range: '10~20℃', emoji: '🔵', label: '공포', tone: 'fear' },
    { range: '20~28℃', emoji: '🟡', label: '중립', tone: 'neutral' },
    { range: '28~35℃', emoji: '🟠', label: '낙관', tone: 'greed' },
    { range: '35℃~', emoji: '🔥', label: '과열', tone: 'extreme-greed' }
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

  function buildCard(data) {
    var grade = data.grade || { emoji: '', label: '' };
    var rows = COMPONENT_META.map(function (meta) {
      var comp = data.components && data.components[meta.key];
      var score = comp && typeof comp.score === 'number' ? comp.score : 0;
      var pct = meta.max ? Math.max(0, Math.min(100, (score / meta.max) * 100)) : 0;
      var tone = pct >= 70 ? 'mt-hot' : pct >= 40 ? 'mt-mid' : 'mt-cold';

      return ''
        + '<div class="mt-bar-row">'
        + '<span class="mt-bar-label">' + escapeHtml(meta.label) + '</span>'
        + '<div class="mt-bar-track"><div class="mt-bar-fill ' + tone + '" style="width:' + pct.toFixed(0) + '%"></div></div>'
        + '<span class="mt-bar-value">' + score + '/' + meta.max + '</span>'
        + '</div>';
    }).join('');

    var tone = grade.tone || 'neutral';
    return ''
      + '<div class="mt-card mt-tone-' + escapeHtml(tone) + '">'
      + '<div class="mt-label">🌡 오늘의 증시온도</div>'
      + '<div class="mt-score">' + data.temp.toFixed(1) + '<span class="mt-score-unit">℃</span></div>'
      + '<div class="mt-grade">' + escapeHtml(grade.emoji) + ' ' + escapeHtml(grade.label) + '</div>'
      + '<div class="mt-bars">' + rows + '</div>'
      + buildLegend()
      + (data.updatedAt ? '<div class="mt-updated">업데이트 ' + escapeHtml(data.updatedAt) + '</div>' : '')
      + '</div>';
  }

  function buildLegend() {
    var compRows = COMPONENT_META.map(function (meta) {
      return '<div class="mt-legend-row"><span>' + escapeHtml(meta.label) + '</span><span>' + meta.max + '점</span></div>';
    }).join('');
    var bandRows = GRADE_BANDS.map(function (b) {
      return '<div class="mt-legend-row"><span>' + b.range + '</span><span>' + b.emoji + ' ' + escapeHtml(b.label) + '</span></div>';
    }).join('');

    return ''
      + '<details class="mt-legend">'
      + '<summary>온도 계산 방식</summary>'
      + '<div class="mt-legend-title">점수 계산 (100점 -> ℃ 환산)</div>'
      + compRows
      + '<div class="mt-legend-total">총점 100점 = 40.0℃ (온도 = 총점 × 0.4)</div>'
      + '<div class="mt-legend-title">온도 구간</div>'
      + bandRows
      + '</details>';
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
