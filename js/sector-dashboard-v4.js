/**
 * 섹터별 실시간 시세 대시보드 v4
 * window.SECTOR_MAP(sectors-v3.js: 섹터명 -> {name, code, market} 배열)을 읽어
 * GAS 프록시에 배치 조회 후 섹터 카드로 렌더링한다.
 * v3 대비: 종목 항목이 객체(code 내장)라 krx_map.js 없이 동작하고,
 * 종목명 옆에 시장 구분 뱃지(KOSPI=P/파랑, KOSDAQ=Q/주황)를 표시한다.
 * v2 형식(종목명 문자열 배열 + KRX_MAP)도 하위 호환으로 지원.
 * data/sectors-v3.js가 이 스크립트보다 먼저 로드되어야 함.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#sector-dashboard';
  var FETCH_TIMEOUT_MS = 8000;
  // GAS쪽 cacheKeyFor가 200자 넘는 키를 MD5 해시하므로 키 길이 제약은 없어졌고,
  // 남은 제약은 URL 길이와 브라우저 동시연결(도메인당 6개)뿐이다.
  // 60개 × 4배치면 전 종목이 한 라운드에 병렬 조회된다 (25개 × 10배치 = 2라운드였음).
  var BATCH_SIZE = 60;

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  // v3 항목(객체) / v2 항목(종목명 문자열)을 { name, code, market } 하나로 정규화
  function resolveEntry(entry, krxMap) {
    if (entry && typeof entry === 'object') {
      return { name: entry.name, code: entry.code, market: entry.market || '' };
    }
    return { name: entry, code: krxMap[entry], market: '' };
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

  // 시장 구분 뱃지. CSS는 injectBadgeStyles()가 주입하므로 css 파일 재업로드 불필요.
  function marketBadgeHtml(market) {
    if (market === 'KOSPI') return '<span class="sector-mkt-badge mkt-kospi" title="KOSPI">P</span>';
    if (market === 'KOSDAQ') return '<span class="sector-mkt-badge mkt-kosdaq" title="KOSDAQ">Q</span>';
    return '';
  }

  function injectBadgeStyles() {
    if (document.getElementById('sector-mkt-badge-style')) return;
    var style = document.createElement('style');
    style.id = 'sector-mkt-badge-style';
    style.textContent =
      '.sector-mkt-badge{display:inline-block;font-size:9px;font-weight:700;line-height:1;' +
        'padding:2px 4px;margin-left:5px;border-radius:4px;vertical-align:1px;letter-spacing:0;}' +
      '.sector-mkt-badge.mkt-kospi{color:#2563eb;background:rgba(37,99,235,0.1);}' +
      '.sector-mkt-badge.mkt-kosdaq{color:#ea580c;background:rgba(234,88,12,0.12);}' +
      /* style.css의 html.dark 블랑켓 규칙(color 흰색 !important)보다 specificity를 높여야 이김 */
      'html.dark #sector-dashboard .sector-mkt-badge.mkt-kospi{color:#7aa8f7 !important;background:rgba(77,139,247,0.16);}' +
      'html.dark #sector-dashboard .sector-mkt-badge.mkt-kosdaq{color:#f5a35c !important;background:rgba(245,140,60,0.16);}';
    document.head.appendChild(style);
  }

  function renderCardsHtml(sectorMap, krxMap, dataByCode) {
    var html = Object.keys(sectorMap).map(function (sector) {
      // 등락률 높은 순(뜨거운 종목이 위) 정렬
      var entries = sectorMap[sector]
        .map(function (item) {
          var e = resolveEntry(item, krxMap);
          return { name: e.name, market: e.market, data: e.code && dataByCode[e.code] };
        })
        .filter(function (e) { return e.data; })
        .sort(function (a, b) { return b.data.changeRate - a.data.changeRate; });

      var rows = entries.map(function (e) {
        var d = e.data;
        return (
          '<div class="sector-row">' +
            '<span class="sector-row-name">' + escapeHTML(e.name) + marketBadgeHtml(e.market) + '</span>' +
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

  // 한 종목이 여러 섹터에 중복 등장할 수 있어(sectors-v3.js 참고) 히트맵에서는 1회만 표시,
  // 등락률 절대값 5% 이상을 최대 채도로 잡아 색농도를 계산한다.
  function renderHeatmapHtml(sectorMap, krxMap, dataByCode) {
    var seen = {};
    var tiles = [];
    Object.keys(sectorMap).forEach(function (sector) {
      sectorMap[sector].forEach(function (item) {
        var e = resolveEntry(item, krxMap);
        var data = e.code && dataByCode[e.code];
        if (!data || seen[data.code]) return;
        seen[data.code] = true;
        tiles.push({ name: e.name, sector: sector, data: data });
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
          '<span class="heatmap-tile-price">' + formatNumber(t.data.price) + '</span>' +
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

  // aiState는 { analysis: string|null } 공유 객체 — AI 시황분석이 시세보다 늦게 도착해도
  // 토글 재렌더 시점의 최신 값을 읽을 수 있게 문자열 대신 객체로 넘긴다.
  function renderAll(container, sectorMap, krxMap, dataByCode, mode, aiState) {
    var contentHtml = mode === 'heatmap'
      ? renderHeatmapHtml(sectorMap, krxMap, dataByCode)
      : renderCardsHtml(sectorMap, krxMap, dataByCode);

    var aiHtml = renderAiAnalysis(aiState.analysis);

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
        renderAll(container, sectorMap, krxMap, dataByCode, newMode, aiState);
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

    injectBadgeStyles();

    var codes = [];
    Object.keys(sectorMap).forEach(function (sector) {
      sectorMap[sector].forEach(function (item) {
        var code = resolveEntry(item, krxMap).code;
        if (code && codes.indexOf(code) === -1) codes.push(code);
      });
    });

    if (!codes.length) return;

    container.innerHTML = '<div class="sector-loading">시세 불러오는 중...</div>';

    // AI 시황분석(Groq 캐시 미스 시 수 초)이 시세 표시를 막지 않게 분리:
    // 시세가 오면 즉시 그리고, AI는 도착하는 대로 맨 위에 끼워넣는다.
    var aiState = { analysis: null };
    var aiPromise = fetchMarketAnalysis();

    SectorDashboard.fetchTickerData(codes)
      .then(function (list) {
        var byCode = {};
        (list || []).forEach(function (item) {
          if (item && item.code) byCode[item.code] = item;
        });
        var savedMode = 'cards';
        try { savedMode = localStorage.getItem('sector-view-mode') || 'cards'; } catch (err) { /* ignore */ }
        renderAll(container, sectorMap, krxMap, byCode, savedMode, aiState);

        aiPromise.then(function (analysis) {
          if (!analysis) return;
          aiState.analysis = analysis;
          container.insertAdjacentHTML('afterbegin', renderAiAnalysis(analysis));
        });
      })
      .catch(function (err) {
        logError('[sector-dashboard] 시세 조회 실패', err);
        container.innerHTML = '<div class="sector-error">시세를 불러오지 못했습니다</div>';
      });
  }

  var SectorDashboard = {
    init: init,
    fetchTickerData: fetchTickerData,
    fetchBatch: fetchBatch,
    renderHeatmapHtml: renderHeatmapHtml, // js/market-temp.js의 "히트맵 보기" 탭이 재사용
    renderCardsHtml: renderCardsHtml, // js/market-temp.js의 "카드 보기" 탭이 재사용
    injectBadgeStyles: injectBadgeStyles // renderCardsHtml의 시장 뱃지(P/Q) 스타일 - 별도 호출 필요
  };
  global.SectorDashboard = SectorDashboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
