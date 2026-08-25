/**
 * 섹터별 실시간 시세 대시보드 v4
 * window.SECTOR_MAP(sectors-v3.js: 섹터명 -> {name, code, market} 배열)을 읽어
 * GAS 프록시에 배치 조회 후 섹터 카드로 렌더링한다.
 * v3 대비: 종목 항목이 객체(code 내장)라 krx_map.js 없이 동작하고,
 * 시장 구분은 카드에서 KOSPI/KOSDAQ 텍스트 뱃지로 구분한다.
 * v2 형식(종목명 문자열 배열 + KRX_MAP)도 하위 호환으로 지원.
 * data/sectors-v3.js가 이 스크립트보다 먼저 로드되어야 함.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#sector-dashboard';
  // 2026-08-14 요청: 사이트 곳곳의 Groq AI 요약 상자 제목이 "참고의견"/"종합 요약"/"요약"으로
  // 제각각이라는 지적 - js/kospi-futures.js 등이 이미 쓰는 "참고의견" + 말풍선 아이콘으로 통일.
  var SD_AI_ICON = '<svg class="sn-ai-badge-icon" width="12" height="12" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ' aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var FETCH_TIMEOUT_MS = 8000;
  // GAS쪽 cacheKeyFor가 200자 넘는 키를 MD5 해시하므로 키 길이 제약은 없어졌고,
  // 남은 제약은 URL 길이와 브라우저 동시연결(도메인당 6개)뿐이다.
  // 60개 × 4배치면 전 종목이 한 라운드에 병렬 조회된다 (25개 × 10배치 = 2라운드였음).
  var BATCH_SIZE = 60;
  // 카드에 현재 편성된 종목과 별도로, 같은 업종에서 함께 비교할 만하지만
  // 현재 카드에는 넣지 않은 추천 관련 종목을 흐리게 보여준다.
  var RELATED_SECTOR_RECOMMENDATIONS = {
    '택배': [
      { name: '롯데로지스틱', note: '추천 관련 종목' },
      { name: '로젠', note: '추천 관련 종목' }
    ]
  };

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

  // 시장 구분은 한 글자 P/Q 대신 읽기 쉬운 전체 시장명으로 표시한다.
  function marketBadgeHtml(market) {
    if (market === 'KOSPI') return ' <span class="sector-mkt-badge mkt-kospi" title="KOSPI">KOSPI</span>';
    if (market === 'KOSDAQ') return ' <span class="sector-mkt-badge mkt-kosdaq" title="KOSDAQ">KOSDAQ</span>';
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
          return { name: e.name, code: e.code, market: e.market, data: e.code && dataByCode[e.code] };
        })
        .filter(function (e) { return e.data; })
        .sort(function (a, b) { return b.data.changeRate - a.data.changeRate; });

      // data-code: 실시간 WebSocket 시세 갱신(startCardRealtimeQuotes)이 종목을 찾는 키.
      // 같은 종목이 여러 섹터 카드에 중복 등장할 수 있어 갱신 시 querySelectorAll로 전부 맞춘다.
      var rows = entries.map(function (e) {
        var d = e.data;
        return (
          '<button type="button" class="sector-row" data-code="' + escapeHTML(e.code) + '" data-sector="' + escapeHTML(sector) + '" aria-label="' + escapeHTML(e.name) + ' 섹터 상세 보기">' +
            '<span class="sector-row-name">' + escapeHTML(e.name) + marketBadgeHtml(e.market) + '</span>' +
            '<span><span class="sector-row-price">' + formatNumber(d.price) + '</span>' +
            '<span class="sector-row-rate ' + directionClass(d.change) + '">' +
              arrowSymbol(d.change) + Math.abs(d.changeRate).toFixed(2) + '%</span></span>' +
          '</button>'
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

  function sectorNamesForCode(sectorMap, krxMap, code) {
    return Object.keys(sectorMap).filter(function (sector) {
      return (sectorMap[sector] || []).some(function (item) {
        return resolveEntry(item, krxMap).code === code;
      });
    });
  }

  function sectorDetailListedRowHtml(entry, dataByCode, selectedCode) {
    var data = entry.code && dataByCode[entry.code];
    var selected = entry.code === selectedCode ? ' is-selected' : '';
    if (!data) {
      return '<div class="sector-detail-row is-listed is-data-pending' + selected + '" aria-label="' + escapeHTML(entry.name) + ' 시세 대기">'
        + '<span class="sector-detail-row-name">' + escapeHTML(entry.name) + marketBadgeHtml(entry.market) + '</span>'
        + '<span class="sector-detail-row-status">시세 대기</span></div>';
    }
    var rate = Number(data.changeRate) || 0;
    return '<div class="sector-detail-row is-listed' + selected + '" data-code="' + escapeHTML(entry.code) + '">'
      + '<span class="sector-detail-row-name">' + escapeHTML(entry.name) + marketBadgeHtml(entry.market) + '</span>'
      + '<span class="sector-detail-row-values"><b>' + formatNumber(data.price) + '</b><em>' + arrowSymbol(rate) + Math.abs(rate).toFixed(2) + '%</em></span>'
      + '</div>';
  }

  function sectorDetailPendingRowHtml(item) {
    return '<div class="sector-detail-row is-pending" aria-label="' + escapeHTML(item.name) + ' 편집 대기">'
      + '<span class="sector-detail-row-name">' + escapeHTML(item.name) + '</span>'
      + '<span class="sector-detail-row-status">편집 대기</span></div>';
  }

  function renderSectorLineList(entries, recommendations, dataByCode, selectedCode) {
    var listedNames = {};
    entries.forEach(function (entry) { listedNames[String(entry.name || '').toLowerCase()] = true; });
    var pending = recommendations.filter(function (item) {
      return !listedNames[String(item.name || '').toLowerCase()];
    });
    return '<div class="sector-detail-line-list" aria-label="섹터 종목 목록">'
      + entries.map(function (entry) { return sectorDetailListedRowHtml(entry, dataByCode, selectedCode); }).join('')
      + pending.map(sectorDetailPendingRowHtml).join('')
      + '</div>';
  }

  function renderSectorDetailHtml(sectorMap, krxMap, dataByCode, selectedCode, selectedName) {
    var sectors = sectorNamesForCode(sectorMap, krxMap, selectedCode);
    var sections = sectors.map(function (sector) {
      var entries = (sectorMap[sector] || []).map(function (item) { return resolveEntry(item, krxMap); });
      var recommendations = RELATED_SECTOR_RECOMMENDATIONS[sector] || [];
      return '<section class="sector-detail-section"><div class="sector-detail-section-head"><strong>' + escapeHTML(sector) + '</strong><small>검은색: 현재 카드 · 옅은색: 편집 대기</small></div>'
        + renderSectorLineList(entries, recommendations, dataByCode, selectedCode) + '</section>';
    }).join('');
    return '<div class="sector-detail-view">'
      + '<div class="sector-detail-head"><button type="button" class="sector-detail-back" data-sector-detail-back aria-label="카드 보기로 돌아가기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg><span>카드 보기</span></button><div><strong>' + escapeHTML(selectedName || selectedCode) + '</strong><small>관련 섹터 종목</small></div></div>'
      + (sections || '<div class="sector-detail-empty">이 종목의 섹터 정보가 없습니다.</div>')
      + '<p class="sector-detail-note">현재 카드에 편집된 종목은 검은색 선으로, 함께 비교할 만하지만 아직 카드에 편집하지 않은 종목은 옅은색 선으로 표시합니다.</p>'
      + '</div>';
  }

  function wireSectorCardSelection(container, sectorMap, krxMap, dataByCode, onRestore) {
    if (!container) return;
    container.querySelectorAll('.sector-row[data-code]').forEach(function (row) {
      row.addEventListener('click', function () {
        var code = row.getAttribute('data-code');
        var entry = (sectorMap[row.getAttribute('data-sector')] || []).map(function (item) { return resolveEntry(item, krxMap); }).filter(function (item) { return item.code === code; })[0];
        var previousHtml = container.innerHTML;
        container.innerHTML = renderSectorDetailHtml(sectorMap, krxMap, dataByCode, code, entry && entry.name);
        var back = container.querySelector('[data-sector-detail-back]');
        if (back) back.addEventListener('click', function () {
          container.innerHTML = previousHtml;
          wireSectorCardSelection(container, sectorMap, krxMap, dataByCode, onRestore);
          if (onRestore) onRestore();
        });
      });
    });
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

  // ---- 카드 보기 실시간 시세(WebSocket) ----
  // 2026-08-20 요청: 카드 보기는 최초 1회 GAS 배치 조회 후 갱신이 없었다("시장 > 증시온도 >
  // 카드 > 종목 WebSocket 처리해") - js/watchlist.js·js/home-realtime-table.js가 이미 쓰는
  // 실시간 체결가 소켓(wss://goodbyestar.cloud/ws/quotes)에 카드에 표시된 종목코드를
  // 그대로 구독해 가격·등락률만 자리에서 갱신한다(카드 재조립 없음). 재연결은
  // home-realtime-table.js와 동일한 지수 백오프(1.5초~30초) + 세대 검증 패턴을 따른다.
  var CARD_WS_URL = 'wss://goodbyestar.cloud/ws/quotes';
  var CARD_WS_RECONNECT_MIN_MS = 1500;
  var CARD_WS_RECONNECT_MAX_MS = 30000;
  var CARD_WS_KEEPALIVE_MS = 20000;
  var CARD_SNAPSHOT_FALLBACK_MS = 30000;
  var cardRealtime = {
    container: null,
    codes: [],
    socket: null,
    reconnectTimer: null,
    keepaliveTimer: null,
    fallbackTimer: null,
    reconnectDelay: CARD_WS_RECONNECT_MIN_MS,
    generation: 0
  };
  var cardVisibilityWired = false;

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function quoteNumber_(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return value;
    return Number(String(value)
      .replace(/,/g, '')
      .replace(/%/g, '')
      .replace(/[▲▼]/g, '')
      .trim());
  }

  function quoteFieldNumber_(quote, fields) {
    for (var i = 0; i < fields.length; i++) {
      var value = quoteNumber_(quote && quote[fields[i]]);
      if (!isNaN(value)) return value;
    }
    return NaN;
  }

  function updateSectorRowQuote(container, code, quote) {
    var rows = container.querySelectorAll('.sector-row[data-code="' + cssEscape(code) + '"]');
    if (!rows.length) return;
    var price = quoteFieldNumber_(quote, ['price', 'last', 'currentPrice']);
    // 실시간 공급자/중계 버전에 따라 camelCase·snake_case·문자열 퍼센트가
    // 섞여 들어올 수 있으므로 가격과 같은 quote 메시지에서 모두 호환한다.
    var changeRate = quoteFieldNumber_(quote, ['changeRate', 'change_rate', 'changeRatePct', 'change_rate_pct']);
    var change = quoteFieldNumber_(quote, ['change', 'change_amount', 'changeAmount']);
    // 일부 브로커 응답은 change 금액을 절댓값으로 보낸다 - 방향은 부호가 있는
    // changeRate를 우선한다(js/watchlist.js updateCard와 동일한 규칙).
    var direction = !isNaN(changeRate) && changeRate !== 0 ? changeRate : change;
    for (var i = 0; i < rows.length; i++) {
      var priceEl = rows[i].querySelector('.sector-row-price');
      var rateEl = rows[i].querySelector('.sector-row-rate');
      if (priceEl && !isNaN(price)) priceEl.textContent = formatNumber(price);
      if (rateEl && !isNaN(changeRate)) {
        rateEl.textContent = arrowSymbol(direction) + Math.abs(changeRate).toFixed(2) + '%';
        rateEl.className = 'sector-row-rate ' + directionClass(direction);
      }
    }
  }

  function setCardRealtimeStatus(container, text) {
    var status = container && container.querySelector('[data-card-realtime-status]');
    if (status) status.textContent = text;
  }

  function refreshCardSnapshot(generation) {
    if (generation !== cardRealtime.generation || document.hidden || !cardRealtime.codes.length) return;
    fetchTickerData(cardRealtime.codes).then(function (list) {
      if (generation !== cardRealtime.generation) return;
      (list || []).forEach(function (item) {
        if (!item || !item.code) return;
        updateSectorRowQuote(cardRealtime.container, item.code, {
          type: 'quote',
          code: item.code,
          price: item.price,
          change: item.change,
          changeRate: item.changeRate != null ? item.changeRate : item.change_rate
        });
      });
    }).catch(function () { /* WebSocket 재연결 중이면 직전 시세를 유지한다. */ });
  }

  function stopCardRealtimeQuotes() {
    cardRealtime.generation += 1;
    if (cardRealtime.reconnectTimer) {
      clearTimeout(cardRealtime.reconnectTimer);
      cardRealtime.reconnectTimer = null;
    }
    if (cardRealtime.keepaliveTimer) {
      clearInterval(cardRealtime.keepaliveTimer);
      cardRealtime.keepaliveTimer = null;
    }
    if (cardRealtime.fallbackTimer) {
      clearInterval(cardRealtime.fallbackTimer);
      cardRealtime.fallbackTimer = null;
    }
    if (cardRealtime.socket) {
      cardRealtime.socket.onclose = null;
      cardRealtime.socket.close();
      cardRealtime.socket = null;
    }
    cardRealtime.container = null;
    cardRealtime.codes = [];
  }

  function scheduleCardRealtimeReconnect(generation) {
    if (generation !== cardRealtime.generation || document.hidden || !cardRealtime.codes.length) return;
    if (cardRealtime.reconnectTimer) return;
    var delay = cardRealtime.reconnectDelay;
    cardRealtime.reconnectDelay = Math.min(CARD_WS_RECONNECT_MAX_MS, Math.round(cardRealtime.reconnectDelay * 1.8));
    cardRealtime.reconnectTimer = setTimeout(function () {
      cardRealtime.reconnectTimer = null;
      connectCardRealtime(generation);
    }, delay);
  }

  function connectCardRealtime(generation) {
    if (generation !== cardRealtime.generation || document.hidden || !cardRealtime.codes.length) return;
    setCardRealtimeStatus(cardRealtime.container, '실시간 연결 중');
    var socket;
    try {
      socket = new WebSocket(CARD_WS_URL + '?codes=' + cardRealtime.codes.map(encodeURIComponent).join(','));
    } catch (err) {
      scheduleCardRealtimeReconnect(generation);
      return;
    }
    cardRealtime.socket = socket;
    socket.onopen = function () {
      if (generation !== cardRealtime.generation || cardRealtime.socket !== socket) return;
      cardRealtime.reconnectDelay = CARD_WS_RECONNECT_MIN_MS;
      if (cardRealtime.keepaliveTimer) clearInterval(cardRealtime.keepaliveTimer);
      cardRealtime.keepaliveTimer = setInterval(function () {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, CARD_WS_KEEPALIVE_MS);
      setCardRealtimeStatus(cardRealtime.container, '실시간 연결됨');
    };
    socket.onmessage = function (event) {
      if (generation !== cardRealtime.generation || !cardRealtime.container) return;
      try {
        var quote = JSON.parse(event.data);
        if (quote.type === 'quote' && quote.code) {
          updateSectorRowQuote(cardRealtime.container, quote.code, quote);
          setCardRealtimeStatus(cardRealtime.container, '실시간 연결됨');
        }
      } catch (err) {}
    };
    socket.onerror = function () {
      if (generation === cardRealtime.generation && cardRealtime.socket === socket) socket.close();
    };
    socket.onclose = function () {
      if (generation !== cardRealtime.generation || cardRealtime.socket !== socket) return;
      if (cardRealtime.keepaliveTimer) {
        clearInterval(cardRealtime.keepaliveTimer);
        cardRealtime.keepaliveTimer = null;
      }
      cardRealtime.socket = null;
      setCardRealtimeStatus(cardRealtime.container, '재연결 중');
      scheduleCardRealtimeReconnect(generation);
    };
  }

  function wireCardVisibility_() {
    if (cardVisibilityWired) return;
    cardVisibilityWired = true;
    document.addEventListener('visibilitychange', function () {
      if (!cardRealtime.container) return;
      if (document.hidden) {
        if (cardRealtime.reconnectTimer) { clearTimeout(cardRealtime.reconnectTimer); cardRealtime.reconnectTimer = null; }
        if (cardRealtime.keepaliveTimer) { clearInterval(cardRealtime.keepaliveTimer); cardRealtime.keepaliveTimer = null; }
        if (cardRealtime.socket) { cardRealtime.socket.onclose = null; cardRealtime.socket.close(); cardRealtime.socket = null; }
      } else if (!cardRealtime.socket) {
        cardRealtime.reconnectDelay = CARD_WS_RECONNECT_MIN_MS;
        connectCardRealtime(cardRealtime.generation);
      }
    });
  }

  // panel: 카드가 그려진 컨테이너(js/market-temp.js의 카드 보기 탭 패널). codes: 그 안에
  // 표시된 종목코드 배열 - 카드가 다시 그려질 때(섹터 편집 저장 등)마다 다시 호출하면
  // 기존 연결을 정리하고 새 목록으로 재구독한다.
  function startCardRealtimeQuotes(container, codes) {
    stopCardRealtimeQuotes();
    if (!container || !codes || !codes.length) return;
    setCardRealtimeStatus(container, '실시간 연결 중');
    cardRealtime.container = container;
    cardRealtime.codes = codes;
    cardRealtime.fallbackTimer = setInterval(function () {
      if (!global.WebSocket || !cardRealtime.socket || cardRealtime.socket.readyState !== global.WebSocket.OPEN) {
        refreshCardSnapshot(cardRealtime.generation);
      }
    }, CARD_SNAPSHOT_FALLBACK_MS);
    if (!('WebSocket' in global)) {
      setCardRealtimeStatus(container, '주기 갱신 중');
      refreshCardSnapshot(cardRealtime.generation);
      return;
    }
    wireCardVisibility_();
    cardRealtime.reconnectDelay = CARD_WS_RECONNECT_MIN_MS;
    if (document.hidden) {
      setCardRealtimeStatus(container, '화면 복귀 시 연결');
      return;
    }
    connectCardRealtime(cardRealtime.generation);
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
        '<span class="sn-ai-badge">' + SD_AI_ICON + '참고의견</span>' +
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
    if (mode === 'cards') wireSectorCardSelection(container, sectorMap, krxMap, dataByCode);
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

    container.innerHTML = '<div class="sector-loading"><svg class="hb-spinner" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline pathLength="100" points="0,20 24,20 30,6 36,34 42,20 50,20 55,2 60,38 65,20 120,20"/></svg>시세 불러오는 중...</div>';

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
    renderSectorDetailHtml: renderSectorDetailHtml,
    wireSectorCardSelection: wireSectorCardSelection,
    injectBadgeStyles: injectBadgeStyles, // renderCardsHtml의 시장 뱃지(P/Q) 스타일 - 별도 호출 필요
    startCardRealtimeQuotes: startCardRealtimeQuotes, // js/market-temp.js의 "카드 보기" 탭이 재사용
    stopCardRealtimeQuotes: stopCardRealtimeQuotes
  };
  global.SectorDashboard = SectorDashboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
