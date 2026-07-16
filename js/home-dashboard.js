/**
 * 메인 첫화면 대시보드 - 대형 차트(지수/종목 선택+MA+기간탭) + 증시온도 게이지 + 시총
 * 트리맵 + 랭킹뉴스 TOP10 + AI 시황요약을 한 화면에 묶는 컨트롤러. 홈페이지(`/`)에서만
 * 렌더링하고, 다른 페이지에서는 빈 mount(#home-dashboard)를 그대로 둔다(js/skin-shell.js가
 * 만드는 빈 div - FOUC 없음, CLAUDE.md 4번 규칙).
 *
 * 위젯 조합 방식:
 * - 게이지: js/market-temp.js를 게이지 전용 모드(MarketTemp.init({gaugeOnly:true}))로 호출 -
 *   이 페이지에서는 그 모듈 자체의 카드보기/히트맵보기/시총트리맵 탐색카드를 안 씀.
 * - 트리맵: js/marketcap-bubble.js를 이 파일이 단독으로 마운트(#marketcap-bubble 소유권을
 *   여기서만 가짐 - market-temp.js의 트리맵 탭을 안 쓰니 #marketcap-bubble 중복 마운트 위험이
 *   애초에 없음).
 * - AI 시황요약: sector-dashboard-v4.js를 통하지 않고 GAS ?marketAnalysis=1을 직접 호출(그
 *   액션 자체가 이미 섹터풀과 무관한 독립 액션이라 재사용에 문제 없음).
 * - 랭킹뉴스 TOP10: js/stock-news.js의 #snRank는 접이식 아코디언이라 이 목업(항상 펼침)과
 *   UX가 달라서 export 없는 그 로직을 그대로 가져다 쓰는 대신, 같은 GAS 액션(?rankNews=1)을
 *   이 파일이 직접 호출해서 항상 펼쳐진 리스트로 렌더링(로직은 stock-news.js와 동일 패턴,
 *   검색/관심종목 UI는 안 끌고 옴).
 * - 대형 차트: 지수(코스피/코스닥)는 신규 GAS 액션 ?action=indexChart&symbol=, 종목은 기존
 *   ?action=flowChart&code=를 호출 - 두 응답이 {daily, ma, levels}로 완전히 동일한 포맷이라
 *   렌더 함수 하나(renderChart)를 공유한다. 일봉만 MA/지지저항 표시, 주/월/년은 캔들만
 *   (kospi-futures.js의 기존 관례와 동일 - resampleWeekly 패턴을 월/년까지 확장).
 * - Lightweight Charts 로더/테마/destroy는 js/lwc-common.js 공용 모듈 재사용(기존 5개 파일의
 *   중복 보일러플레이트를 6번째로 늘리지 않기 위함).
 *
 * - 공시 티커: 원래 js/skin-main.js가 사이트 전체 고정 위치(navbar 바로 아래)에 항상
 *   띄우던 걸 2026-07-16 제거하고 이 대시보드 전용 카드로 옮겼다(로직은 skin-main.js의
 *   KRX RSS 파싱 코드 그대로 포팅, GAS 주소도 동일 - 메인 GAS_TICKER_URL과는 다른 별도
 *   배포임에 주의). 그에 맞춰 style.css의 사이트 전체 상단 오프셋(.page-wrap padding-top,
 *   .sidebar-left/right top)도 disc-ticker 높이(38px)를 뺀 값으로 재계산됐다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#home-dashboard';
  var FETCH_TIMEOUT_MS = 15000;
  var RANK_NEWS_REFRESH_MS = 30 * 60 * 1000;
  var MAX_SUGGESTIONS = 8;
  var CHART_HEIGHT = 420;
  var MA_COLORS = { ma5: '#e8590c', ma20: '#0ca678', ma60: '#5f3dc4', ma224: '#868e96' };

  var INDEX_OPTIONS = [
    { key: 'KOSPI', label: '코스피' },
    { key: 'KOSDAQ', label: '코스닥' }
  ];
  var INTERVAL_LABELS = { day: '일', week: '주', month: '월', year: '년' };
  var INTERVAL_ORDER = ['day', 'week', 'month', 'year'];

  // 현재 선택된 심볼/기간 + 마지막으로 받아온 차트 원본(기간 전환 시 재조회 없이 클라이언트
  // 리샘플만 다시 함)
  var chartState = { type: 'index', key: 'KOSPI', label: '코스피', interval: 'day', data: null };
  var chartInstance = null;
  var chartThemeDisconnect = null;

  function isHomepage() {
    var path = location.pathname;
    return path === '/' || path === '';
  }

  function init() {
    if (!isHomepage()) return;
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    wireSymbolPicker(container);
    wireIntervalTabs(container);
    loadChart(container, chartState.type, chartState.key, chartState.label);
    wireGaugeAndTreemap();
    wireAiBox(container);
    wireRankNews(container);
    wireDiscTicker(container);
  }

  // ---- 전체 골격 ----

  function buildShell() {
    var indexOptionsHtml = INDEX_OPTIONS.map(function (o) {
      var selected = o.key === chartState.key ? ' selected' : '';
      return '<option value="' + o.key + '"' + selected + '>' + escapeHtml(o.label) + '</option>';
    }).join('');
    var intervalTabsHtml = INTERVAL_ORDER.map(function (key) {
      return '<button type="button" class="hd-interval-btn' + (key === 'day' ? ' active' : '')
        + '" data-interval="' + key + '">' + INTERVAL_LABELS[key] + '</button>';
    }).join('');

    return ''
      + '<div class="hd-grid">'
      + '<div class="hd-card hd-card-chart">'
      + '<div class="hd-chart-head">'
      + '<div class="hd-chart-picker">'
      + '<select id="hdSymbolSelect" class="hd-select">'
      + '<option value="" disabled hidden>지수 선택</option>'
      + indexOptionsHtml + '</select>'
      + '<div class="hd-symbol-search">'
      + '<input type="text" id="hdSymbolInput" class="hd-input" placeholder="종목명 검색 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="hdSymbolSuggest" class="hd-suggest"></div>'
      + '</div>'
      + '</div>'
      + '<div class="hd-interval-tabs" id="hdIntervalTabs">' + intervalTabsHtml + '</div>'
      + '</div>'
      + '<div class="hd-chart-name" id="hdChartName">코스피</div>'
      + '<div class="hd-chart-box" id="hdChartBox"><div class="hd-loading">차트를 불러오는 중...</div></div>'
      + '</div>'
      + '<div class="hd-card hd-card-gauge"><div id="market-temp"></div></div>'
      + '<div class="hd-card hd-card-treemap"><div id="marketcap-bubble"></div></div>'
      + '<div class="hd-card hd-card-rank">'
      + '<div class="hd-card-title">랭킹뉴스 · 증시·코스피·코스닥 헤드라인 TOP 10</div>'
      + '<div class="hd-rank-grid" id="hdRankGrid"><div class="hd-hint">불러오는 중...</div></div>'
      + '</div>'
      + '<div class="hd-card hd-card-ai" id="hdAiCard"><div class="hd-hint">AI 시황요약 불러오는 중...</div></div>'
      + '<div class="hd-card hd-card-disc">'
      + '<div class="hd-disc-badge">'
      + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      + '공시'
      + '</div>'
      + '<div class="hd-disc-wrap"><div class="hd-disc-track" id="hdDiscTrack"><span class="hd-hint">공시 로딩 중...</span></div></div>'
      + '</div>'
      + '</div>';
  }

  // ---- 공용 fetch ----

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

  // 공시 티커(KRX RSS)는 JSON이 아니라 XML/base64 텍스트라 fetchJson과 별도 - 로직은
  // HomeDashboard.fetchText를 경유하게 해서 다른 fetch들과 동일하게 테스트 페이지에서
  // 오버라이드 가능하게 한다.
  function fetchText(url) {
    return fetch(url).then(function (r) { return r.text(); });
  }

  // ---- 게이지 + 트리맵 위임 ----

  function wireGaugeAndTreemap() {
    if (global.MarketTemp) global.MarketTemp.init({ gaugeOnly: true });
    if (global.MarketcapBubble) global.MarketcapBubble.init();
  }

  // ---- AI 시황요약 ----

  function wireAiBox(container) {
    var box = container.querySelector('#hdAiCard');
    HomeDashboard.fetchJson(GAS_TICKER_URL + '?marketAnalysis=1')
      .then(function (data) {
        var analysis = data && data.analysis;
        box.innerHTML = analysis
          ? '<div class="hd-ai-summary"><span class="hd-ai-badge">AI 시황요약 (Groq)</span>'
            + '<p class="hd-ai-text">' + escapeHtml(analysis) + '</p></div>'
          : '<div class="hd-hint">AI 시황요약을 준비 중이에요.</div>';
      })
      .catch(function () {
        box.innerHTML = '<div class="hd-error">AI 시황요약을 불러오지 못했어요.</div>';
      });
  }

  // ---- 랭킹뉴스 TOP10 (js/stock-news.js #snRank와 동일 GAS 액션, 항상 펼침) ----

  function wireRankNews(container) {
    var grid = container.querySelector('#hdRankGrid');
    function load() {
      HomeDashboard.fetchJson(GAS_TICKER_URL + '?rankNews=1')
        .then(function (data) { renderRankNews(grid, data); })
        .catch(function () { grid.innerHTML = '<div class="hd-error">헤드라인을 불러오지 못했어요.</div>'; });
    }
    load();
    setInterval(load, RANK_NEWS_REFRESH_MS);
  }

  function renderRankNews(grid, data) {
    var items = (data && data.items) || [];
    if (!items.length) {
      grid.innerHTML = '<div class="hd-error">헤드라인이 없어요.</div>';
      return;
    }
    grid.innerHTML = items.map(function (it, idx) {
      return '<a class="hd-rank-item" href="' + escapeAttr(it.link) + '" target="_blank" rel="noopener">'
        + '<span class="hd-rank-num">' + (idx + 1) + '</span>'
        + '<span class="hd-rank-body">'
        + '<span class="hd-rank-title">' + escapeHtml(it.title) + '</span>'
        + '<span class="hd-rank-date">' + formatPubDate(it.pubDate) + '</span>'
        + '</span>'
        + '</a>';
    }).join('');
  }

  function formatPubDate(raw) {
    if (!raw) return '';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return mm + '.' + dd + ' ' + hh + ':' + mi;
  }

  // ---- 공시 티커 (js/skin-main.js에서 그대로 포팅 - KRX RSS, 메인 GAS_TICKER_URL과는
  // 다른 별도 GAS 배포를 씀. 예전엔 사이트 전체 상단에 고정으로 떴는데, 이제는 이 대시보드
  // 카드 안에서만 렌더링된다) ----

  var DISC_GAS_URL = 'https://script.google.com/macros/s/AKfycbxGl0gCeiQs4QFV1FmPZP_xJQSiVRa1-Dg8Mv23VpevpE9j4xdL9MFxud34teslWzL0wg/exec';

  function wireDiscTicker(container) {
    var track = container.querySelector('#hdDiscTrack');
    if (!track) return;

    function cleanCDATA(str) {
      var s = str.indexOf('<![CDATA[');
      var e = str.lastIndexOf(']]>');
      if (s > -1 && e > -1) return str.slice(s + 9, e).trim();
      return str.trim();
    }

    function extractTag(chunk, tag) {
      var open = '<' + tag + '>';
      var close = '</' + tag + '>';
      var s = chunk.indexOf(open);
      var e = chunk.indexOf(close, s);
      if (s === -1 || e === -1) return '';
      return cleanCDATA(chunk.slice(s + open.length, e));
    }

    function detectMarket(title) {
      if (title.indexOf('[코]') === 0) return 'KOSDAQ';
      if (title.indexOf('[코넥스]') === 0) return 'KOSDAQ';
      return 'KOSPI';
    }

    function extractCorp(title) {
      if (title.charAt(0) !== '[') return { corp: '', disc: title };
      var close = title.indexOf(']');
      if (close === -1) return { corp: '', disc: title };
      var rest = title.slice(close + 1).trim();
      var spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return { corp: rest, disc: '' };
      return { corp: rest.slice(0, spaceIdx).trim(), disc: rest.slice(spaceIdx).trim() };
    }

    function parseXML(text) {
      var items = [];
      var parts = text.split('<item>');
      for (var i = 1; i < parts.length; i++) {
        var chunk = parts[i].split('</item>')[0];
        var title = extractTag(chunk, 'title');
        var link = extractTag(chunk, 'link');
        if (!title) continue;
        var market = detectMarket(title);
        var parsed = extractCorp(title);
        items.push({ corp: parsed.corp, disc: parsed.disc || title, link: link || '#', market: market });
      }
      return items;
    }

    function renderDiscTicker(items) {
      if (!items.length) { track.innerHTML = '<span class="hd-hint">공시 없음</span>'; return; }

      function itemHTML(it) {
        var cls = it.market === 'KOSDAQ' ? 'hd-disc-market-kosdaq' : 'hd-disc-market-kospi';
        var disc = it.disc.replace(/\s*\|\s*/g, ' ').trim();
        var corp = it.corp.replace(/\s*\|\s*/g, ' ').trim();
        return '<a href="' + it.link + '" target="_blank" class="hd-disc-item">'
          + '<span class="' + cls + '">' + it.market + '</span>'
          + (corp ? '<span class="hd-disc-corp">' + corp + '</span>' : '')
          + disc + '</a>';
      }

      var html = items.map(itemHTML).join('') + items.map(itemHTML).join('');
      track.innerHTML = html;
      track.style.animationDuration = (track.scrollWidth / 2 / 60) + 's';
    }

    HomeDashboard.fetchText(DISC_GAS_URL + '?market=0')
      .then(function (text) {
        var t = text.trim().replace(/^﻿/, ''); // BOM 제거
        if (t.charAt(0) === '<') {
          renderDiscTicker(parseXML(t)); // GAS가 텍스트(UTF-8)로 직접 내려준 경우
        } else if (t.length > 0) {
          // GAS가 base64(raw bytes)로 내려준 경우 - Utilities.base64Encode()는 줄바꿈
          // 포함이라 반드시 제거 후 atob, KRX RSS 피드는 UTF-8이라 TextDecoder 사용
          try {
            var clean = t.replace(/\s/g, '');
            var bin = atob(clean);
            var bytes = new Uint8Array(bin.length);
            for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            renderDiscTicker(parseXML(new TextDecoder('utf-8').decode(bytes)));
          } catch (err) {
            renderDiscTicker([]);
          }
        } else {
          renderDiscTicker([]);
        }
      })
      .catch(function () {
        track.innerHTML = '<span class="hd-error">공시 로드 실패</span>';
      });
  }

  // ---- 대형 차트: 심볼 선택(지수 드롭다운 + 종목 자동완성) ----

  function wireSymbolPicker(container) {
    var select = container.querySelector('#hdSymbolSelect');
    var input = container.querySelector('#hdSymbolInput');
    var suggestBox = container.querySelector('#hdSymbolSuggest');

    select.addEventListener('change', function () {
      input.value = '';
      hideSuggestions(suggestBox);
      var opt = INDEX_OPTIONS.filter(function (o) { return o.key === select.value; })[0];
      if (opt) loadChart(container, 'index', opt.key, opt.label);
    });

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      var items = suggestBox.querySelectorAll('.hd-suggest-item');
      if (e.key === 'Enter') {
        e.preventDefault();
        var idx = typeof suggestBox.__activeIndex === 'number' ? suggestBox.__activeIndex : -1;
        var picked = idx > -1 && items[idx] ? items[idx].getAttribute('data-name') : input.value.trim();
        selectStockByName(container, picked);
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    document.addEventListener('click', function (e) {
      if (!suggestBox.contains(e.target) && e.target !== input) hideSuggestions(suggestBox);
    });
  }

  function renderSuggestions(container, box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    var starts = [];
    var contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) {
        if (starts.length < MAX_SUGGESTIONS) starts.push(name);
      } else if (lower.indexOf(q) > -1) {
        if (contains.length < MAX_SUGGESTIONS) contains.push(name);
      }
    }
    var matches = starts.concat(contains).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="hd-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');
    box.__activeIndex = -1;

    box.querySelectorAll('.hd-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        selectStockByName(container, el.getAttribute('data-name'));
      });
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    box.__activeIndex = -1;
  }

  function selectStockByName(container, name) {
    var map = global.KRX_MAP || {};
    var code = map[name];
    var input = container.querySelector('#hdSymbolInput');
    var suggestBox = container.querySelector('#hdSymbolSuggest');
    hideSuggestions(suggestBox);
    if (!code) return;
    input.value = name;
    container.querySelector('#hdSymbolSelect').value = '';
    loadChart(container, 'stock', code, name);
  }

  // ---- 대형 차트: 기간 탭 ----

  function wireIntervalTabs(container) {
    var tabs = container.querySelector('#hdIntervalTabs');
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.hd-interval-btn');
      if (!btn) return;
      var interval = btn.getAttribute('data-interval');
      if (interval === chartState.interval) return;
      tabs.querySelectorAll('.hd-interval-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      chartState.interval = interval;
      if (chartState.data) renderChart(container.querySelector('#hdChartBox'), chartState.data, interval);
    });
  }

  // ---- 대형 차트: 데이터 로드 + 렌더 ----

  function loadChart(container, type, key, label) {
    chartState.type = type;
    chartState.key = key;
    chartState.label = label;
    chartState.data = null;

    var nameEl = container.querySelector('#hdChartName');
    var box = container.querySelector('#hdChartBox');
    nameEl.textContent = label;
    box.innerHTML = '<div class="hd-loading">' + escapeHtml(label) + ' 차트를 불러오는 중...</div>';

    var url = type === 'index'
      ? GAS_TICKER_URL + '?action=indexChart&symbol=' + encodeURIComponent(key)
      : GAS_TICKER_URL + '?action=flowChart&code=' + encodeURIComponent(key);

    HomeDashboard.fetchJson(url).then(function (data) {
      if (data.error || !data.daily || !data.daily.length) {
        box.innerHTML = '<div class="hd-error">' + escapeHtml((data && data.message) || '차트를 불러오지 못했어요.') + '</div>';
        return;
      }
      if (chartState.key !== key) return; // 로딩 중 다른 심볼 선택되면 무시
      chartState.data = data;
      renderChart(box, data, chartState.interval);
    }).catch(function () {
      box.innerHTML = '<div class="hd-error">차트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    });
  }

  function destroyDashboardChart() {
    if (chartThemeDisconnect) { chartThemeDisconnect(); chartThemeDisconnect = null; }
    if (chartInstance) { global.LwcCommon.destroyChart(chartInstance); chartInstance = null; }
  }

  function renderChart(box, chartData, interval) {
    destroyDashboardChart();
    // loadChart()가 심어둔 "불러오는 중..." 플레이스홀더(.hd-loading)가 차트 생성 후에도
    // 안 지워지고 남아있으면 고정 높이(420px) 박스를 넘쳐서 바로 아래 그리드 행(증시온도/
    // 히트맵 카드)과 겹쳐 보였다 - LWC.createChart는 box를 비우지 않고 안에 새 div를
    // append만 하므로 여기서 명시적으로 비워줘야 함.
    box.innerHTML = '';
    global.LwcCommon.loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(box)) return;

      var chart = LWC.createChart(box, global.LwcCommon.mergeOptions({
        autoSize: true,
        height: CHART_HEIGHT,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: false, secondsVisible: false }
      }, global.LwcCommon.chartThemeOptions()));
      chartInstance = chart;

      var daily = chartData.daily;
      var candleSeries = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });

      if (interval === 'day') {
        candleSeries.setData(daily.map(function (d) {
          return { time: global.LwcCommon.toLwcTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close };
        }));

        var levels = chartData.levels || {};
        (levels.support || []).forEach(function (v) {
          candleSeries.createPriceLine({ price: v, color: '#1261c4', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '지지' });
        });
        (levels.resistance || []).forEach(function (v) {
          candleSeries.createPriceLine({ price: v, color: '#d24f45', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '저항' });
        });

        ['ma5', 'ma20', 'ma60', 'ma224'].forEach(function (key) {
          var series = (chartData.ma && chartData.ma[key]) || [];
          if (!series.length) return;
          var lineSeries = chart.addLineSeries({ color: MA_COLORS[key], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          var pts = [];
          daily.forEach(function (d, i) {
            if (series[i] == null) return;
            pts.push({ time: global.LwcCommon.toLwcTime(d.date), value: series[i] });
          });
          lineSeries.setData(pts);
        });
      } else {
        var resampleFn = interval === 'week' ? resampleWeekly : interval === 'month' ? resampleMonthly : resampleYearly;
        candleSeries.setData(resampleFn(daily).map(function (r) {
          return { time: r.time, open: r.open, high: r.high, low: r.low, close: r.close };
        }));
      }

      chart.timeScale().fitContent();
      chartThemeDisconnect = global.LwcCommon.observeThemeChanges(function (opts) {
        chart.applyOptions(opts);
      });
    }).catch(function () {
      box.innerHTML = '<div class="hd-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  // ---- 기간 리샘플 (js/kospi-futures.js의 resampleWeekly와 동일 패턴, 월/년으로 확장) ----

  function resampleWeekly(dailyRows) {
    return resampleByKey(dailyRows, function (d) {
      var dow = d.getDay() || 7; // 일요일(0) -> 7로 바꿔 월요일(1) 시작 주 계산
      var monday = new Date(d);
      monday.setDate(d.getDate() - dow + 1);
      return monday.toISOString().slice(0, 10);
    });
  }

  function resampleMonthly(dailyRows) {
    return resampleByKey(dailyRows, function (d) {
      return d.toISOString().slice(0, 7) + '-01';
    });
  }

  function resampleYearly(dailyRows) {
    return resampleByKey(dailyRows, function (d) {
      return d.toISOString().slice(0, 4) + '-01-01';
    });
  }

  function resampleByKey(dailyRows, keyFn) {
    var buckets = [];
    var byKey = {};
    dailyRows.forEach(function (r) {
      var d = new Date(r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8) + 'T00:00:00');
      var key = keyFn(d);
      var bucket = byKey[key];
      if (!bucket) {
        bucket = { time: key, open: r.open, high: r.high, low: r.low, close: r.close };
        byKey[key] = bucket;
        buckets.push(bucket);
      } else {
        bucket.high = Math.max(bucket.high, r.high);
        bucket.low = Math.min(bucket.low, r.low);
        bucket.close = r.close;
      }
    });
    return buckets;
  }

  // ---- 유틸 ----

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  var HomeDashboard = { init: init, fetchJson: fetchJson, fetchText: fetchText };
  global.HomeDashboard = HomeDashboard;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
