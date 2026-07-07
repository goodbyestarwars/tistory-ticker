/**
 * 섹터별 실시간 시세 대시보드
 * window.SECTOR_MAP(섹터명->종목명 배열) + window.KRX_MAP(종목명->코드)를 조합해
 * GAS 프록시에 1회 배치 조회 후 섹터 카드로 렌더링한다.
 * data/krx_map.js, data/sectors.js가 이 스크립트보다 먼저 로드되어야 함.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#sector-dashboard';
  var FETCH_TIMEOUT_MS = 8000;
  // GAS CacheService 키가 250자 제한이라, 종목코드를 한 번에 다 보내면
  // 서버쪽 캐시 키 생성에서 예외가 난다. 요청을 이 크기로 쪼개서 병렬 호출한다.
  var BATCH_SIZE = 25;

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  function fetchBatch(codes) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(GAS_TICKER_URL + '?codes=' + codes.join(','), hasAbort ? { signal: controller.signal } : {})
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

  function fetchTickerData(codes) {
    var batches = [];
    for (var i = 0; i < codes.length; i += BATCH_SIZE) {
      batches.push(codes.slice(i, i + BATCH_SIZE));
    }
    return Promise.all(batches.map(function (batch) {
      // 한 배치가 실패해도 나머지 섹터는 표시되도록 빈 배열로 흡수
      return SectorDashboard.fetchBatch(batch).catch(function (err) {
        logError('[sector-dashboard] 배치 조회 실패', err);
        return [];
      });
    })).then(function (results) {
      return results.reduce(function (acc, list) { return acc.concat(list || []); }, []);
    });
  }

  function directionClass(change) {
    if (change > 0) return 'sector-up';
    if (change < 0) return 'sector-down';
    return 'sector-flat';
  }

  function arrowSymbol(change) {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '';
  }

  function formatNumber(n) {
    var num = Number(n);
    return isNaN(num) ? String(n) : num.toLocaleString('ko-KR');
  }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderCardsHtml(sectorMap, krxMap, dataByCode) {
    var html = Object.keys(sectorMap).map(function (sector) {
      // 등락률 높은 순(뜨거운 종목이 위) 정렬
      var entries = sectorMap[sector]
        .map(function (name) {
          var code = krxMap[name];
          return { name: name, data: code && dataByCode[code] };
        })
        .filter(function (e) { return e.data; })
        .sort(function (a, b) { return b.data.changeRate - a.data.changeRate; });

      var rows = entries.map(function (e) {
        var d = e.data;
        return (
          '<div class="sector-row">' +
            '<span class="sector-row-name">' + escapeHTML(e.name) + '</span>' +
            '<span><span class="sector-row-price">' + formatNumber(d.price) + '</span>' +
            '<span class="sector-row-rate ' + directionClass(d.change) + '">' +
              arrowSymbol(d.change) + Math.abs(d.changeRate).toFixed(2) + '%</span></span>' +
          '</div>'
        );
      }).join('');
      if (!rows) return '';
      return (
        '<div class="sector-card">' +
          '<div class="sector-card-title">' + escapeHTML(sector) + '</div>' +
          rows +
        '</div>'
      );
    }).join('');

    return html;
  }

  // 한 종목이 여러 섹터에 중복 등장할 수 있어(sectors-v2.js 참고) 히트맵에서는 1회만 표시,
  // 등락률 절대값 5% 이상을 최대 채도로 잡아 색농도를 계산한다.
  function renderHeatmapHtml(sectorMap, krxMap, dataByCode) {
    var seen = {};
    var tiles = [];
    Object.keys(sectorMap).forEach(function (sector) {
      sectorMap[sector].forEach(function (name) {
        var code = krxMap[name];
        var data = code && dataByCode[code];
        if (!data || seen[data.code]) return;
        seen[data.code] = true;
        tiles.push({ name: name, sector: sector, data: data });
      });
    });

    tiles.sort(function (a, b) { return b.data.changeRate - a.data.changeRate; });

    var html = tiles.map(function (t) {
      var rate = t.data.changeRate;
      var intensity = Math.min(Math.abs(rate) / 5, 1);
      var bg = rate > 0
        ? 'rgba(210, 79, 69, ' + (0.12 + intensity * 0.7).toFixed(2) + ')'
        : rate < 0
          ? 'rgba(18, 97, 196, ' + (0.12 + intensity * 0.7).toFixed(2) + ')'
          : 'rgba(156, 163, 175, 0.2)';
      return (
        '<div class="heatmap-tile" style="background:' + bg + '" title="' + escapeHTML(t.sector) + '">' +
          '<span class="heatmap-tile-name">' + escapeHTML(t.name) + '</span>' +
          '<span class="heatmap-tile-rate">' + arrowSymbol(t.data.change) + Math.abs(rate).toFixed(2) + '%</span>' +
        '</div>'
      );
    }).join('');

    return html;
  }

  function renderToggle(activeMode) {
    return (
      '<div class="sector-view-toggle">' +
        '<button type="button" class="sector-view-btn' + (activeMode === 'cards' ? ' active' : '') + '" data-mode="cards">카드 보기</button>' +
        '<button type="button" class="sector-view-btn' + (activeMode === 'heatmap' ? ' active' : '') + '" data-mode="heatmap">히트맵 보기</button>' +
      '</div>'
    );
  }

  function renderAiAnalysis(analysis) {
    if (!analysis) return '';
    return (
      '<div class="sn-ai-summary market-ai-summary">' +
        '<span class="sn-ai-badge">AI요약 (Groq)</span>' +
        '<p class="sn-ai-text">' + escapeHTML(analysis) + '</p>' +
      '</div>'
    );
  }

  function renderAll(container, sectorMap, krxMap, dataByCode, mode, aiAnalysis) {
    var contentHtml = mode === 'heatmap'
      ? renderHeatmapHtml(sectorMap, krxMap, dataByCode)
      : renderCardsHtml(sectorMap, krxMap, dataByCode);

    var aiHtml = renderAiAnalysis(aiAnalysis);

    if (!contentHtml) {
      container.innerHTML = aiHtml + renderToggle(mode) + '<div class="sector-error">표시할 시세가 없습니다</div>';
    } else {
      var contentClass = mode === 'heatmap' ? 'heatmap-grid' : 'sector-cards-grid';
      container.innerHTML = aiHtml + renderToggle(mode) + '<div class="' + contentClass + '">' + contentHtml + '</div>';
    }

    var buttons = container.querySelectorAll('.sector-view-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var newMode = this.getAttribute('data-mode');
        try { localStorage.setItem('sector-view-mode', newMode); } catch (err) { /* ignore */ }
        renderAll(container, sectorMap, krxMap, dataByCode, newMode, aiAnalysis);
      });
    }
  }

  function fetchMarketAnalysis() {
    return fetch(GAS_TICKER_URL + '?marketAnalysis=1')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return data && data.analysis; })
      .catch(function () { return null; });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    var sectorMap = global.SECTOR_MAP || {};
    var krxMap = global.KRX_MAP || {};

    var codes = [];
    Object.keys(sectorMap).forEach(function (sector) {
      sectorMap[sector].forEach(function (name) {
        var code = krxMap[name];
        if (code && codes.indexOf(code) === -1) codes.push(code);
      });
    });

    if (!codes.length) return;

    container.innerHTML = '<div class="sector-loading">시세 불러오는 중...</div>';

    Promise.all([SectorDashboard.fetchTickerData(codes), fetchMarketAnalysis()])
      .then(function (results) {
        var list = results[0];
        var aiAnalysis = results[1];
        var byCode = {};
        (list || []).forEach(function (item) {
          if (item && item.code) byCode[item.code] = item;
        });
        var savedMode = 'cards';
        try { savedMode = localStorage.getItem('sector-view-mode') || 'cards'; } catch (err) { /* ignore */ }
        renderAll(container, sectorMap, krxMap, byCode, savedMode, aiAnalysis);
      })
      .catch(function (err) {
        logError('[sector-dashboard] 시세 조회 실패', err);
        container.innerHTML = '<div class="sector-error">시세를 불러오지 못했습니다</div>';
      });
  }

  var SectorDashboard = {
    init: init,
    fetchTickerData: fetchTickerData,
    fetchBatch: fetchBatch
  };
  global.SectorDashboard = SectorDashboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
