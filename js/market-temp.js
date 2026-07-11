/**
 * 오늘의 증시온도 위젯
 * GAS 프록시 ?marketTemp=1 호출 -> VIX(25)+수급(30)+상승비율(25)+거래대금(20)=100점 스코어 카드 렌더링.
 * 기존 AI 시황요약(js/sector-dashboard-v4.js의 ?marketAnalysis=1)과 같은 페이지에 병행 배치하는
 * 용도라 이 위젯 자체는 독립 컨테이너(#market-temp)에만 마운트하고 섹터 대시보드는 건드리지 않는다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#market-temp';
  var FETCH_TIMEOUT_MS = 8000;

  var COMPONENT_META = [
    { key: 'vix', label: 'VIX', max: 25 },
    { key: 'flow', label: '수급', max: 30 },
    { key: 'riseRatio', label: '상승비율', max: 25 },
    { key: 'tradingValue', label: '거래대금', max: 20 }
  ];

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<div class="mt-hint">증시온도 불러오는 중...</div>';

    MarketTemp.fetchMarketTemp()
      .then(function (data) {
        if (!data || typeof data.score !== 'number') {
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

    return ''
      + '<div class="mt-card">'
      + '<div class="mt-label">🌡 오늘의 증시온도</div>'
      + '<div class="mt-score">' + data.score + '<span class="mt-score-unit">점</span></div>'
      + '<div class="mt-grade">' + escapeHtml(grade.emoji) + ' ' + escapeHtml(grade.label) + '</div>'
      + '<div class="mt-bars">' + rows + '</div>'
      + (data.updatedAt ? '<div class="mt-updated">업데이트 ' + escapeHtml(data.updatedAt) + '</div>' : '')
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
