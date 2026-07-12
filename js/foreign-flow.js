/**
 * 종목별 외국인·기관 수급 조회 위젯
 * 종목명 검색(기존 KRX_MAP 자동완성 재사용) -> GAS 프록시 ?action=foreignFlow&code= 호출 ->
 * 롤링 합산 표 + 순매매량 라인차트 + 외국인 보유율 미니차트 렌더링.
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * 서버 캐시 없음(온디맨드 크롤링) - 대신 이 스크립트가 종목별 5분 메모리 캐시로
 * 같은 종목 반복 조회를 디바운스한다(네이버 부하/GAS 호출량 억제).
 *
 * 공매도/대차거래/연기금 섹션(ff-extra-*):
 * GAS ?action=investorFlow&code=&name= 온디맨드 호출 -> GAS가 GCP VM(키움 REST API
 * 상시 서버, 고정IP)을 중계 호출해서 받아온다. VM은 종목코드 제한이 없어 전 종목
 * 커버(예전 data/investor-flow-cache.js 정적 스냅샷은 섹터풀 238종목만 커버했음 - 폐기).
 * 실패 시(네트워크 오류 등) 안내 문구만 표시(에러 아님, 조용히 생략하지 않고 이유를 보여준다).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#foreign-flow';
  var FETCH_TIMEOUT_MS = 20000; // 네이버 2페이지 크롤링 + 파싱이라 여유 있게
  var MAX_SUGGESTIONS = 8;
  var CLIENT_CACHE_MS = 5 * 60 * 1000;

  var CHART_W = 820;
  var CHART_H = 280;
  var RATIO_H = 120;
  var PAD = { l: 68, r: 16, t: 16, b: 30 };

  var FCHART_H = 360;
  var MA_COLORS = { ma5: '#e8590c', ma20: '#0ca678', ma60: '#5f3dc4', ma224: '#868e96' };

  // TradingView Lightweight Charts(오픈소스, CDN 지연 로드) - 가격 캔들차트 렌더링 엔진.
  // 손으로 그리던 SVG 캔들차트를 대체 - 확대/축소·패닝·크로스헤어를 라이브러리가 제공.
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var lwcLoadPromise = null;
  var lwcChart = null;         // 현재 렌더된 차트 인스턴스(재검색 시 정리용)
  var lwcThemeObserver = null; // html.dark 토글에 맞춰 차트 색상 실시간 갱신

  var cacheByCode = {};   // code -> { t, data }
  var inflightByCode = {}; // code -> Promise
  var flowChartCache = {};    // code -> { t, data }
  var flowChartInflight = {}; // code -> Promise
  var investorFlowCache = {};    // code -> { t, data }
  var investorFlowInflight = {}; // code -> Promise

  // ---- 종합 점수 요약 박스용 (수급/공매도/연기금/기술적 점수 + AI 한줄요약) ----
  var PENSION_TONE_SCORE = {
    very_positive: 90, positive: 75, neutral_positive: 60, neutral: 50, caution: 25
  };
  // 연기금 해석 라벨 뱃지 색: 비중 확대 쪽(긍정)은 매수 색, 비중 축소 쪽(경계)은 매도 색
  var TONE_BADGE_CLASS = {
    very_positive: 'ff-badge-buy', positive: 'ff-badge-buy', neutral_positive: 'ff-badge-buy',
    neutral: 'ff-badge-neutral', caution: 'ff-badge-sell'
  };
  // 공매도 압박 등급(약함=안전)을 위 톤 팔레트에 얹어서 색만 재사용
  var SHORT_GRADE_TONE = {
    '매우 약함': 'very_positive', '약함': 'positive', '보통': 'neutral',
    '강함': 'caution', '매우 강함': 'caution'
  };

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
    autoSearchFromUrl(container);
  }

  // 다른 페이지(오늘의 투자시그널 등)에서 ?code=005930&name=삼성전자로 넘어오면
  // 사용자가 직접 입력하지 않아도 바로 검색 결과를 보여준다(js/invest-signal.js 연동).
  function autoSearchFromUrl(container) {
    var params = new URLSearchParams(location.search);
    var code = (params.get('code') || '').trim();
    if (!code) return;
    var name = (params.get('name') || '').trim();
    var input = container.querySelector('#ffInput');
    if (input) input.value = name || code;
    search(container, code);
  }

  function buildShell() {
    return ''
      + '<div class="ff-search">'
      + '<div class="ff-input-wrap">'
      + '<input type="text" id="ffInput" class="ff-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="ffSuggest" class="ff-suggest"></div>'
      + '</div>'
      + '<button type="button" id="ffSearchBtn" class="ff-search-btn">조회</button>'
      + '</div>'
      + '<div id="ffResult" class="ff-result">'
      + '<div class="ff-hint">종목명을 검색하면 외국인·기관 순매매 동향을 보여드려요.</div>'
      + '</div>';
  }

  // ---- 검색/자동완성 (stock-news.js와 동일 패턴) ----

  function wireEvents(container) {
    var input = container.querySelector('#ffInput');
    var suggestBox = container.querySelector('#ffSuggest');
    var btn = container.querySelector('#ffSearchBtn');

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      var items = suggestBox.querySelectorAll('.ff-suggest-item');
      if (e.key === 'ArrowDown') {
        if (!items.length) return;
        e.preventDefault();
        setActiveSuggestion(suggestBox, items, (getActiveSuggestion(suggestBox) + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        setActiveSuggestion(suggestBox, items, (getActiveSuggestion(suggestBox) - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var idx = getActiveSuggestion(suggestBox);
        var picked = idx > -1 && items[idx] ? items[idx].getAttribute('data-name') : input.value.trim();
        if (idx > -1 && items[idx]) input.value = picked;
        hideSuggestions(suggestBox);
        search(container, picked);
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    btn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      search(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
    box.__activeIndex = -1;
  }

  // 키보드(위/아래 화살표)로 자동완성 항목 탐색 - box.__activeIndex에 현재 위치 저장
  function getActiveSuggestion(box) {
    return typeof box.__activeIndex === 'number' ? box.__activeIndex : -1;
  }
  function setActiveSuggestion(box, items, idx) {
    items.forEach(function (el) { el.classList.remove('active'); });
    box.__activeIndex = idx;
    var el = items[idx];
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
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
      return '<div class="ff-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');
    box.__activeIndex = -1;

    box.querySelectorAll('.ff-suggest-item').forEach(function (el, i) {
      el.addEventListener('mouseenter', function () {
        setActiveSuggestion(box, box.querySelectorAll('.ff-suggest-item'), i);
      });
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#ffInput').value = name;
        hideSuggestions(box);
        search(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만.
  function resolveStock(query) {
    if (!query) return null;
    if (/^\d{6}$/.test(query)) return { code: query, name: query };

    var map = global.KRX_MAP || {};
    if (map[query]) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var found = null;
    var count = 0;
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      if (name.toLowerCase().indexOf(q) > -1) {
        found = name;
        count++;
        if (count > 1) break;
      }
    }
    return count === 1 ? { code: map[found], name: found } : null;
  }

  // ---- 조회 ----

  function search(container, query) {
    var resultBox = container.querySelector('#ffResult');
    destroyLwChart(); // 이전 검색의 차트 인스턴스/리스너 정리(리렌더 전에 먼저 끊는다)
    var resolved = resolveStock(query);
    if (!resolved) {
      resultBox.innerHTML = '<div class="ff-error">'
        + (query ? '"' + escapeHtml(query) + '" 종목을 찾을 수 없어요. 정확한 종목명을 입력해보세요.' : '종목명을 입력해주세요.')
        + '</div>';
      return;
    }

    resultBox.innerHTML = '<div class="ff-loading"><div class="ff-spinner"></div><div>' + escapeHtml(resolved.name) + ' 수급 데이터를 불러오는 중... (가격 차트는 최초 조회 시 다소 걸릴 수 있어요)</div></div>';

    // 차트 크롤링/VM 온디맨드 호출 둘 다 실패 가능성이 있는데, 그것 때문에 나머지
    // 위젯까지 통째로 에러 처리되면 안 되므로 각자 잡아 실패 시 null/에러 객체로 대체한다.
    var chartPromise = fetchFlowChart(resolved.code)
      .catch(function () { return { error: 'FETCH_FAILED', message: '차트 데이터를 불러오지 못했어요.' }; });
    var investorFlowPromise = fetchInvestorFlowLive(resolved.code, resolved.name)
      .catch(function () { return null; });

    Promise.all([ForeignFlow.fetchFlow(resolved.code), chartPromise, investorFlowPromise])
      .then(function (results) {
        var data = results[0];
        var chartData = results[1];
        var flowEntry = results[2];
        if (!data || data.error || !data.daily || !data.daily.length) {
          resultBox.innerHTML = '<div class="ff-error">'
            + escapeHtml((data && data.message) || '수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.')
            + '</div>';
          return;
        }
        renderResult(resultBox, data, chartData, flowEntry);
      })
      .catch(function () {
        resultBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // 같은 종목 5분 캐시 + 진행 중 요청 재사용(연타 디바운스)
  function fetchFlow(code) {
    var hit = cacheByCode[code];
    if (hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (inflightByCode[code]) return inflightByCode[code];

    var p = fetchJson(GAS_TICKER_URL + '?action=foreignFlow&code=' + encodeURIComponent(code))
      .then(function (data) {
        delete inflightByCode[code];
        if (data && !data.error) cacheByCode[code] = { t: Date.now(), data: data };
        return data;
      })
      .catch(function (err) {
        delete inflightByCode[code];
        throw err;
      });
    inflightByCode[code] = p;
    return p;
  }

  // 가격 차트(지지/저항 + MA5/20/60/224) - 5분 메모리 캐시 + 진행 중 요청 재사용
  function fetchFlowChart(code) {
    var hit = flowChartCache[code];
    if (hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (flowChartInflight[code]) return flowChartInflight[code];

    var p = fetchJson(GAS_TICKER_URL + '?action=flowChart&code=' + encodeURIComponent(code))
      .then(function (data) {
        delete flowChartInflight[code];
        if (data && !data.error) flowChartCache[code] = { t: Date.now(), data: data };
        return data;
      })
      .catch(function (err) {
        delete flowChartInflight[code];
        throw err;
      });
    flowChartInflight[code] = p;
    return p;
  }

  // 공매도/대차거래/연기금(GAS ?action=investorFlow 경유 VM 온디맨드) - 5분 메모리 캐시 +
  // 진행 중 요청 재사용. 실패해도 나머지 위젯은 정상 표시돼야 하므로 호출부에서 catch로 null 처리.
  function fetchInvestorFlowLive(code, name) {
    var hit = investorFlowCache[code];
    if (hit && Date.now() - hit.t < CLIENT_CACHE_MS) return Promise.resolve(hit.data);
    if (investorFlowInflight[code]) return investorFlowInflight[code];

    var url = GAS_TICKER_URL + '?action=investorFlow&code=' + encodeURIComponent(code)
      + (name ? '&name=' + encodeURIComponent(name) : '');
    var p = fetchJson(url)
      .then(function (data) {
        delete investorFlowInflight[code];
        if (data && !data.error) investorFlowCache[code] = { t: Date.now(), data: data };
        return data;
      })
      .catch(function (err) {
        delete investorFlowInflight[code];
        throw err;
      });
    investorFlowInflight[code] = p;
    return p;
  }

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

  // ---- 렌더링 ----

  function renderResult(box, data, chartData, entry) {
    var techScore = computeTechnicalScore(chartData);

    var latest = data.daily && data.daily[0]; // getForeignFlow는 최신일 우선(내림차순) 정렬
    var priceHtml = latest
      ? ' <span class="ff-price ' + signClass(latest.change_pct) + '">' + Number(latest.close).toLocaleString()
        + '원 (' + (latest.change_pct >= 0 ? '+' : '') + latest.change_pct.toFixed(2) + '%)</span>'
      : '';

    // 헤더(종목명/가격)를 맨 위에 두고 구분선으로 아래 요약 박스와 분리
    var html = '<div class="ff-header">' + escapeHtml(data.name || data.code)
      + ' <span class="ff-code">(' + escapeHtml(data.code) + ')</span>'
      + priceHtml
      + ' <span class="ff-asof">' + escapeHtml(data.as_of) + ' 기준</span></div>'
      + '<div class="ff-divider"></div>';

    html += buildSummaryBox(data, entry, techScore);
    html += buildFlowCard(data);
    html += buildExtraSections(entry, latest && latest.close, chartData, techScore);

    box.innerHTML = html;

    var lwContainer = box.querySelector('#ffLwChart');
    if (lwContainer) renderLwChart(lwContainer, chartData);

    wireChartHover(box.querySelector('.ff-chart-net'), data.daily, 'net');
    wireChartHover(box.querySelector('.ff-chart-ratio'), data.daily, 'ratio');
    loadAiSummary(box, data, entry, techScore);
  }

  // ---- 종합 점수 요약 박스 (수급/공매도/연기금/기술적 점수 + AI 한줄요약) ----

  // 이동평균 배열(40) + 지지선 근접도(30) + 저항선 근접도(30) = 0~100점.
  // 밴드 경계값은 지시서 표 그대로. 차트 데이터(?action=flowChart)가 없으면 null.
  function computeTechnicalScore(chartData) {
    if (!chartData || chartData.error || !chartData.daily || !chartData.daily.length) return null;
    var daily = chartData.daily;
    var close = daily[daily.length - 1].close;
    var ma = chartData.ma || {};
    function lastVal(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
    var ma5 = lastVal(ma.ma5), ma20 = lastVal(ma.ma20), ma60 = lastVal(ma.ma60);

    var maScore = 0, maLabel = '데이터 부족';
    if (ma5 != null && ma20 != null && ma60 != null) {
      if (ma5 > ma20 && ma20 > ma60) { maScore = 40; maLabel = '정배열'; }
      else if (ma20 > ma60) { maScore = 30; maLabel = '20일선 > 60일선'; }
      else if (ma5 > ma20) { maScore = 20; maLabel = '5일선만 상향'; }
      else { maScore = 0; maLabel = '역배열'; }
    }

    var support = (chartData.levels && chartData.levels.support) || [];
    var supScore = 0, supLabel = '지지선 없음';
    if (support.length) {
      var nearestSup = support.reduce(function (a, b) { return Math.abs(b - close) < Math.abs(a - close) ? b : a; });
      var supGap = (close - nearestSup) / nearestSup * 100;
      if (supGap < 0) { supScore = 0; supLabel = '지지선 이탈'; }
      else if (supGap <= 2) { supScore = 30; supLabel = '지지선 ±2% 이내'; }
      else if (supGap <= 5) { supScore = 20; supLabel = '지지선 ±5% 이내'; }
      else if (supGap <= 8) { supScore = 10; supLabel = '지지선 ±8% 이내'; }
      else { supScore = 0; supLabel = '지지선과 거리 있음'; }
    }

    var resistance = (chartData.levels && chartData.levels.resistance) || [];
    var resScore = 0, resLabel = '저항선 없음';
    if (resistance.length) {
      var nearestRes = resistance.reduce(function (a, b) { return Math.abs(b - close) < Math.abs(a - close) ? b : a; });
      var resGap = (nearestRes - close) / close * 100;
      // "저항 접근 중" 상한(8%)은 지시서 표에 정확한 경계값이 없어 3%(20점) 다음 구간으로 잡은 값
      if (resGap < 0) { resScore = 30; resLabel = '저항 돌파'; }
      else if (resGap <= 3) { resScore = 20; resLabel = '저항 3% 이내'; }
      else if (resGap <= 8) { resScore = 10; resLabel = '저항 접근 중'; }
      else { resScore = 0; resLabel = '저항 아래 멀리'; }
    }

    return {
      score: maScore + supScore + resScore,
      ma: { score: maScore, label: maLabel },
      support: { score: supScore, label: supLabel },
      resistance: { score: resScore, label: resLabel }
    };
  }

  function techInterpText(t) {
    if (!t) return '차트 데이터가 부족해 기술적 점수를 계산하지 못했습니다.';
    return t.ma.label + ' · ' + t.support.label + ' · ' + t.resistance.label;
  }

  // 외국인/기관 5일·20일 순매매 방향(4개) 각 ±12.5점, 기준 50점 -> 0~100점.
  function computeFlowScore(data) {
    var r = data.rolling || {};
    var f5 = r['5d'] ? r['5d'].foreign : 0;
    var f20 = r['20d'] ? r['20d'].foreign : 0;
    var i5 = r['5d'] ? r['5d'].inst : 0;
    var i20 = r['20d'] ? r['20d'].inst : 0;
    function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
    var score = 50 + 12.5 * (sgn(f5) + sgn(f20) + sgn(i5) + sgn(i20));
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // 연기금 톤(very_positive~caution) 기준점수 + 연속매매일수 가중치 -> 0~100점.
  function computePensionScore(p) {
    if (!p || !p.interpretation) return null;
    var base = PENSION_TONE_SCORE[p.interpretation.tone];
    if (base == null) return null;
    var streak = p.streak || { days: 0, direction: 'flat' };
    var days = Math.min(streak.days || 0, 15);
    var adj = streak.direction === 'buy' ? days * 0.7 : streak.direction === 'sell' ? -days * 0.7 : 0;
    return Math.max(0, Math.min(100, Math.round(base + adj)));
  }

  // 5일 합산 부호만 보면 "오늘은 순매수 전환"인데도 "매도세가 이어진다"고 나오는 모순이
  // 생길 수 있어(예: 5일 중 나흘은 매도, 오늘만 매수면 합산은 음수), 배지와 같은 기준인
  // streak(최신일부터 역순 연속 방향)로 판단해 배지·문구가 항상 같은 결론을 가리키게 한다.
  function flowInterpText(data) {
    var streak = data.streak || {};
    var f = streak.foreign || { direction: 'flat' };
    var i = streak.inst || { direction: 'flat' };
    if (f.direction === 'buy' && i.direction === 'buy') return '외국인과 기관이 동반 순매수하며 수급이 양호합니다.';
    if (f.direction === 'buy' && i.direction === 'sell') return '외국인은 순매수, 기관은 순매도로 엇갈리고 있습니다.';
    if (f.direction === 'sell' && i.direction === 'buy') return '기관은 순매수, 외국인은 순매도로 엇갈리고 있습니다.';
    if (f.direction === 'sell' && i.direction === 'sell') return '외국인과 기관이 동반 순매도하며 수급이 약화되고 있습니다.';
    return '외국인·기관 수급 방향이 뚜렷하지 않습니다.';
  }

  // flowInterpText와 같은 streak 기준으로 색·배지 톤을 정해서 문구와 절대 어긋나지 않게 한다.
  function flowTone(data) {
    var streak = data.streak || {};
    var f = streak.foreign || { direction: 'flat' };
    var i = streak.inst || { direction: 'flat' };
    if (f.direction === 'buy' && i.direction === 'buy') return { tone: 'positive', label: '긍정' };
    if (f.direction === 'sell' && i.direction === 'sell') return { tone: 'caution', label: '주의' };
    return { tone: 'neutral', label: '중립' };
  }

  function shortInterpText(s, l) {
    if (!s || !s.pressure) return '공매도 데이터가 없는 종목입니다.';
    var label = s.pressure.grade.label;
    var parts = ['거래비중 ' + fmtPct(s.today_ratio_pct)];
    if (s.days_to_cover != null) parts.push('Days to Cover ' + s.days_to_cover.toFixed(1) + '일');
    if (l && l.balance_change_pct != null) parts.push('대차잔고 ' + fmtSignedPct(l.balance_change_pct));
    return parts.join(' · ') + '로 압박 ' + label + ' 수준입니다.';
  }

  // 종합점수 = 수급x0.40 + 외국인/기관x0.25 + 기술적x0.20 + 공매도x0.10 + 연기금x0.05
  // (사용자 확정 가중치). 공매도는 높을수록 악재라 100에서 뺀 값을 넣어 방향을 맞춘다.
  // 데이터 없는 항목은 평균 대신 중립(50)으로 채워서 - 있는 항목만으로 재계산해
  // 가중치 배분이 흔들리는 것보다 "이 종목은 정보가 부족해 중립"이 더 예측 가능하다.
  var SCORE_WEIGHTS = { flow: 0.40, foreignInst: 0.25, tech: 0.20, short: 0.10, pension: 0.05 };

  function scoreToStars(score) {
    if (score == null) return null;
    return Math.max(0, Math.min(5, Math.round(score / 20 * 2) / 2));
  }

  // 지시서 추천 기준표: 4.5~5.0 적극매수 / 3.8~4.4 매수우위 / 2.8~3.7 보유 / 1.8~2.7 비중축소 / 0~1.7 매도
  function starRecommendation(stars) {
    if (stars == null) return { label: '판단 보류', cls: 'ff-flat' };
    if (stars >= 4.5) return { label: '적극 매수', cls: 'ff-buy' };
    if (stars >= 3.8) return { label: '매수 우위', cls: 'ff-buy' };
    if (stars >= 2.8) return { label: '보유', cls: 'ff-flat' };
    if (stars >= 1.8) return { label: '비중축소', cls: 'ff-sell' };
    return { label: '매도', cls: 'ff-sell' };
  }

  // ★ 5개를 겹쳐서 (점수/5*100)%만큼만 금색으로 잘라 보여주는 방식 - 0.5단위 부분 채움 표현.
  function starsHtml(stars, extraCls) {
    if (stars == null) return '<span class="ff-stars' + (extraCls ? ' ' + extraCls : '') + '">-</span>';
    var pct = (stars / 5 * 100).toFixed(1);
    return '<span class="ff-stars' + (extraCls ? ' ' + extraCls : '') + '" style="--ff-star-pct:' + pct + '%">★★★★★</span>';
  }

  // 외국인·기관 수급 카드의 연속매매(streak) 방향·일수를 0~100 점수로 환산한다.
  // "오늘의 수급"(flowScore)은 5·20일 롤링 합산 부호 기반의 단기 신호이고, 이건
  // "최근 며칠째 같은 방향이 이어지는가"라는 지속성 신호라 서로 다른 항목으로 취급한다.
  function computeForeignInstScore(data) {
    var streak = data.streak || {};
    function dirScore(st) {
      if (!st || st.direction === 'flat') return 0;
      var days = Math.min(st.days || 0, 10);
      return (st.direction === 'buy' ? 1 : -1) * (10 + days * 3);
    }
    var score = 50 + (dirScore(streak.foreign) + dirScore(streak.inst)) / 2;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function foreignInstDescText(data) {
    var streak = data.streak || {};
    function seg(label, st) {
      st = st || { days: 0, direction: 'flat' };
      if (st.direction === 'flat') return label + ' 방향 뚜렷하지 않음';
      return label + ' ' + st.days + '일 연속 ' + (st.direction === 'buy' ? '순매수' : '순매도');
    }
    return seg('외국인', streak.foreign) + ' · ' + seg('기관', streak.inst);
  }

  // 가중치 기반 종합점수 -> 별점(0~5, 0.5단위) -> 추천 라벨. 100점 평균 대신 가중합을
  // 쓰는 이유: 단순 평균은 항목 5개가 다 비슷한 무게로 섞여 변별력이 떨어진다(지시서 피드백).
  // 지시서 예시(수급75·외국인기관85·기술적30·공매도49·연기금22 -> 63.25점) 그대로 검증됨:
  // 화면에 표시되는 점수를 방향 보정 없이 그대로 가중합한다(공매도 점수도 raw 값을 그대로 사용).
  function computeVerdict(flowScore, foreignInstScore, techScoreObj, shortScore, pensionScore) {
    var techVal = techScoreObj && techScoreObj.score != null ? techScoreObj.score : null;
    var vals = {
      flow: flowScore != null ? flowScore : 50,
      foreignInst: foreignInstScore != null ? foreignInstScore : 50,
      tech: techVal != null ? techVal : 50,
      short: shortScore != null ? shortScore : 50,
      pension: pensionScore != null ? pensionScore : 50
    };
    var composite = vals.flow * SCORE_WEIGHTS.flow
      + vals.foreignInst * SCORE_WEIGHTS.foreignInst
      + vals.tech * SCORE_WEIGHTS.tech
      + vals.short * SCORE_WEIGHTS.short
      + vals.pension * SCORE_WEIGHTS.pension;
    var stars = scoreToStars(composite);
    var rec = starRecommendation(stars);
    return { score: composite, stars: stars, label: rec.label, cls: rec.cls };
  }

  function buildSummaryBox(data, entry, techScore) {
    var flowScore = computeFlowScore(data);
    var foreignInstScore = computeForeignInstScore(data);

    var shortP = entry && entry.short && entry.short.pressure;
    var shortScore = shortP ? shortP.score : null;
    var shortEmoji = shortP ? shortP.grade.emoji : '⚪';

    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;
    var pStreak = pension && pension.streak;
    var pensionEmoji = pStreak ? (pStreak.direction === 'buy' ? '🟢' : pStreak.direction === 'sell' ? '🔴' : '⚪') : '⚪';

    // 각 행의 desc를 일반 설명이 아니라 실제 해석 문장으로 채워서(구 ff-summary-interp 블록을
    // 아래에 따로 두지 않고) 점수 옆 칸에서 바로 이유를 보여준다.
    var rows = [
      { icon: '🧭', label: '오늘의 수급', score: flowScore, desc: flowInterpText(data) },
      { icon: '🌐', label: '외국인·기관', score: foreignInstScore, desc: foreignInstDescText(data) },
      { icon: '📊', label: '기술적 점수', score: techScore ? techScore.score : null, desc: techInterpText(techScore) },
      { icon: shortEmoji, label: '공매도 압박', score: shortScore, desc: shortInterpText(entry && entry.short, entry && entry.loan) },
      { icon: pensionEmoji, label: '연기금', score: pensionScore, desc: pension ? pension.interpretation.text : '연기금 데이터가 없는 종목입니다.' }
    ];

    var rowsHtml = rows.map(function (r, i) {
      return '<div class="ff-summary-row' + (i === rows.length - 1 ? ' ff-summary-row-last' : '') + '">'
        + '<span class="ff-summary-icon">' + r.icon + '</span>'
        + '<span class="ff-summary-label">' + r.label + '</span>'
        + '<span class="ff-summary-score">' + (r.score == null ? '-' : r.score + '점') + '</span>'
        + starsHtml(scoreToStars(r.score))
        + '<span class="ff-summary-desc">' + escapeHtml(r.desc) + '</span>'
        + '</div>';
    }).join('');

    var verdict = computeVerdict(flowScore, foreignInstScore, techScore, shortScore, pensionScore);

    // 판정(별점+등급)과 AI 근거 문장이 한 줄에 뭉치면 안 읽혀서(사용자 피드백),
    // 판정 박스는 등급 색으로 칠해 분리하고 AI 요약은 그 아래 별도 줄로 내린다.
    var verdictTone = verdict.cls === 'ff-buy' ? 'buy' : verdict.cls === 'ff-sell' ? 'sell' : 'flat';

    return '<div class="ff-summary">'
      + rowsHtml
      + '<div class="ff-verdict-box ff-verdict-box-' + verdictTone + '">'
      + '<span class="ff-verdict ' + verdict.cls + '">' + verdict.label + '</span>'
      + starsHtml(verdict.stars, 'ff-stars-lg')
      + '<span class="ff-verdict-score">' + (verdict.score == null ? '-' : verdict.score.toFixed(1) + '점 · ' + verdict.stars.toFixed(1) + '/5') + '</span>'
      + '</div>'
      + '<div class="ff-summary-ai" id="ffAiSummary">'
      + '<b>AI(GROQ) 한 줄 요약</b>'
      + '<span class="ff-summary-ai-text">생성 중...</span>'
      + '</div>'
      + '</div>';
  }

  // AI 한줄요약은 Groq 호출이라 느릴 수 있어 나머지 렌더링을 막지 않고 비동기로 채운다.
  // 별점 판정(computeVerdict)과 다른 결론을 AI가 스스로 내리는 걸 막기 위해, 여기서도
  // buildSummaryBox와 똑같이 5개 컴포넌트 점수 + verdict를 구해서 GAS에 "이미 이 결론이다"로
  // 넘긴다 - LLM은 근거 문장만 쓰고 매수/매도/보유 자체는 다시 판단하지 않는다.
  function loadAiSummary(box, data, entry, techScore) {
    var el = box.querySelector('#ffAiSummary .ff-summary-ai-text');
    if (!el) return;

    var shortP = entry && entry.short && entry.short.pressure;
    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;
    var flowScore = computeFlowScore(data);
    var foreignInstScore = computeForeignInstScore(data);
    var shortScore = shortP ? shortP.score : null;
    var verdict = computeVerdict(flowScore, foreignInstScore, techScore, shortScore, pensionScore);

    var qs = '?action=flowAiSummary'
      + '&code=' + encodeURIComponent(data.code)
      + '&name=' + encodeURIComponent(data.name || data.code)
      + '&flowScore=' + flowScore
      + '&flowNote=' + encodeURIComponent(flowInterpText(data))
      + '&foreignInstScore=' + foreignInstScore
      + '&foreignInstNote=' + encodeURIComponent(foreignInstDescText(data))
      + '&shortScore=' + (shortScore == null ? '' : shortScore)
      + '&shortNote=' + encodeURIComponent(shortInterpText(entry && entry.short, entry && entry.loan))
      + '&pensionScore=' + (pensionScore == null ? '' : pensionScore)
      + '&pensionNote=' + encodeURIComponent(pension ? pension.interpretation.text : '')
      + '&techScore=' + (techScore ? techScore.score : '')
      + '&techNote=' + encodeURIComponent(techInterpText(techScore))
      + '&verdictLabel=' + encodeURIComponent(verdict.label)
      + '&verdictScore=' + (verdict.score == null ? '' : Math.round(verdict.score));

    fetchJson(GAS_TICKER_URL + qs)
      .then(function (res) {
        el.textContent = (res && res.summary) || '요약을 생성하지 못했어요.';
      })
      .catch(function () {
        el.textContent = '요약을 생성하지 못했어요.';
      });
  }

  function buildBadges(data) {
    var streak = data.streak || {};
    var signal = data.signal || {};

    var parts = [
      streakBadge('외국인', streak.foreign),
      streakBadge('기관', streak.inst),
      signalBadge('외국인', signal.foreign),
      signalBadge('기관', signal.inst)
    ];
    var hasAny = parts.some(function (p) { return !!p; });

    var out = '<div class="ff-badges">' + parts.join('') + '</div>';
    if (hasAny) {
      out += '<div class="ff-badge-legend">'
        + '<div>※ 연속매매: 최신 거래일부터 역순으로 순매매 부호가 이어지는 일수.</div>'
        + '<div>추세전환: 최근 5일이 이전 15일과 반대 방향이고 평소 2배 이상 크기일 때</div>'
        + '<div>(5일 중 3일 이상 같은 방향일 때만 표시되는 참고 지표)</div>'
        + '<div><b>투자판단 및 그에 따른 책임은 본인에게 있습니다.</b></div>'
        + '</div>';
    }
    return out;
  }

  function streakBadge(label, st) {
    if (!st || !(st.days > 0) || st.direction === 'flat') return '';
    var isBuy = st.direction === 'buy';
    return '<span class="ff-badge ' + (isBuy ? 'ff-badge-buy' : 'ff-badge-sell') + '">'
      + label + ' ' + st.days + '일 연속 ' + (isBuy ? '순매수' : '순매도') + '</span>';
  }

  function signalBadge(label, sig) {
    if (!sig || !sig.trend_shift) return '';
    var html = '<span class="ff-badge ff-badge-shift">' + label + ' 추세 전환</span>';
    if (sig.note) html += '<span class="ff-signal-note">' + escapeHtml(sig.note) + '</span>';
    return html;
  }

  function buildRollingTable(data) {
    var amt = data.amount_estimate || {};
    var rows = [
      ['당일', data.rolling.today, amt.today_krw, amt.inst_today_krw],
      ['5일 합산', data.rolling['5d'], amt['5d_krw'], amt.inst_5d_krw],
      ['10일 합산', data.rolling['10d'], amt['10d_krw'], amt.inst_10d_krw],
      ['20일 합산', data.rolling['20d'], amt['20d_krw'], amt.inst_20d_krw]
    ];

    var html = '<table class="ff-table"><thead><tr>'
      + '<th>구분</th><th>외국인 순매매(주)</th><th>외국인 추정대금</th><th>기관 순매매(주)</th><th>기관 추정대금</th>'
      + '</tr></thead><tbody>';

    rows.forEach(function (r) {
      html += '<tr><td class="ff-td-label">' + r[0] + '</td>'
        + '<td class="' + signClass(r[1].foreign) + '">' + fmtShares(r[1].foreign) + '</td>'
        + '<td class="' + signClass(r[2]) + '">' + fmtKrw(r[2]) + '</td>'
        + '<td class="' + signClass(r[1].inst) + '">' + fmtShares(r[1].inst) + '</td>'
        // 기관 추정대금은 GAS 재배포 후부터 내려옴 - 이전 응답(값 없음)은 '-'로 표시
        + '<td class="' + (r[3] == null ? 'ff-flat' : signClass(r[3])) + '">' + (r[3] == null ? '-' : fmtKrw(r[3])) + '</td></tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  // ---- 수급(연속매매 배지 + 롤링 표 + 순매매량/보유율 추이) - 하나의 구역 카드로 묶음 ----
  function buildFlowCard(data) {
    var tone = flowTone(data);
    var toneBadgeCls = TONE_BADGE_CLASS[tone.tone] || 'ff-badge-neutral';
    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">🧭 외국인·기관 수급</div>'
      + buildBadges(data)
      + '<div class="ff-extra-interp ff-extra-tone-' + tone.tone + '">'
      + '<span class="ff-badge ' + toneBadgeCls + '">' + tone.label + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(flowInterpText(data)) + '</span>'
      + '</div>'
      + buildRollingTable(data)
      + '<div class="ff-chart-title">외국인·기관 순매매량 추이 (최근 ' + data.daily.length + '영업일)</div>'
      + buildNetChart(data.daily)
      + '<div class="ff-chart-title">외국인 보유율 추이</div>'
      + buildRatioChart(data.daily)
      + '<div class="ff-footnote">※ 추정대금은 순매매량 × 당일 종가로 계산한 <b>추정치</b>이며 실제 거래대금과 다를 수 있습니다. 자료: 네이버 금융</div>'
      + '</div>';
  }

  // ---- 공매도/대차거래/연기금 (GAS ?action=investorFlow 경유 VM 온디맨드) ----

  function buildExtraSections(entry, currentClose, chartData, techScore) {
    if (!entry) {
      return '<div class="ff-extra-missing">공매도·대차거래·연기금 데이터를 일시적으로 가져오지 못했어요. 잠시 후 다시 시도해주세요.</div>'
        + buildFlowChartCard(chartData, techScore);
    }

    var html = '<div class="ff-extra">';
    html += buildShortLoanCard(entry.short, entry.loan, currentClose);
    html += buildPensionCard(entry.pension, entry.name);
    html += '<div class="ff-extra-note">공매도 압박 점수는 항상 <b>가능성·추정치</b>이며, 공매도가 주가를 누른다고 단정하지 않습니다. '
      + escapeHtml(entry.as_of) + ' 기준 · 키움증권 API</div>';
    html += buildFlowChartCard(chartData, techScore);
    html += '</div>';
    return html;
  }

  function extraMetric(label, valueHtml) {
    return '<div class="ff-extra-metric"><div class="ff-extra-metric-label">' + escapeHtml(label) + '</div>'
      + '<div class="ff-extra-metric-value">' + valueHtml + '</div></div>';
  }

  // 숏 압박 지수는 0을 기준으로 위(+)는 외국인·기관 순매수가 공매도 거래량보다 강함(숏스퀴즈
  // 가능권 - 매수 우호적), 아래(-)는 외국인·기관도 동반 매도 중임을 뜻한다. 임계값은 공식
  // 스펙이 없어 이 구현에서 정한 값(추후 실제 분포 보고 조정 가능).
  function squeezeGrade(v) {
    if (v == null) return null;
    if (v >= 200) return { label: '매우 높음', cls: 'ff-buy' };
    if (v >= 50) return { label: '높음', cls: 'ff-buy' };
    if (v > -50) return { label: '보통', cls: 'ff-flat' };
    if (v > -200) return { label: '낮음', cls: 'ff-sell' };
    return { label: '매우 낮음', cls: 'ff-sell' };
  }

  // 공매도 + 대차거래 병합 카드 (원래 두 카드였으나 서로 연관된 지표라 하나로 합침)
  function buildShortLoanCard(s, l, currentClose) {
    if (!s && !l) return '';
    var p = (s && s.pressure) || { score: 0, grade: { emoji: '', label: '-' }, breakdown: {} };
    var b = p.breakdown || {};
    var causes = [];
    if (s) {
      if (b.short_ratio > 0) causes.push('공매도 거래비중 ' + fmtPct(s.today_ratio_pct));
      if (b.loan_increase > 0) causes.push('대차잔고 증가 ' + fmtSignedPct(l && l.balance_change_pct));
      if (b.balance_increase > 0) causes.push('공매도 잔고 증가 ' + fmtSignedPct(s.balance_change_pct));
      if (b.foreign_sell > 0) causes.push('외국인 순매도 동반');
      if (b.inst_sell > 0) causes.push('기관 순매도 동반');
    }

    var grid = '';
    if (s) {
      // "악성" 신호는 붉게 강조: 공매도 평균가격이 현재가와 20% 이상 괴리, 당일 거래비중 10%↑
      // (거래비중 임계값은 scripts/fetch_investor_flow.py의 압박점수 밴드(>=10=강한 구간)와 통일)
      var gapPct = (currentClose && s.avg_price) ? (s.avg_price - currentClose) / currentClose * 100 : null;
      var gapWarn = gapPct != null && Math.abs(gapPct) >= 20;
      var ratioWarn = s.today_ratio_pct != null && s.today_ratio_pct >= 10;
      var sg = squeezeGrade(s.short_squeeze_index);

      grid += extraMetric('공매도 누적잔고', fmtAbsShares(s.balance_qty))
        + extraMetric('공매도 평균가격(추정)', '<span class="' + (gapWarn ? 'ff-warn' : '') + '">' + fmtWon(s.avg_price) + '</span>'
          + (gapPct != null ? '<div class="ff-extra-metric-sub">현재가 대비 ' + fmtSignedPct(gapPct) + '</div>' : ''))
        + extraMetric('당일 거래비중', '<span class="' + (ratioWarn ? 'ff-warn' : '') + '">' + fmtPct(s.today_ratio_pct) + '</span>')
        + extraMetric('일평균 거래량(20일)', fmtAbsShares(s.avg_volume_20d))
        + extraMetric('Days to Cover', s.days_to_cover == null ? '-' : s.days_to_cover.toFixed(2) + '일')
        + extraMetric('숏 압박 지수', (s.short_squeeze_index == null ? '-' : s.short_squeeze_index.toFixed(1))
          + (sg ? ' <span class="ff-squeeze-grade ' + sg.cls + '">' + sg.label + '</span>' : ''));
    }
    if (l) {
      grid += extraMetric('대차잔고', fmtAbsShares(l.balance_qty))
        + extraMetric('대차잔고 증감률', '<span class="' + signClass(l.balance_change_pct) + '">' + fmtSignedPct(l.balance_change_pct) + '</span>');
    }

    var tone = SHORT_GRADE_TONE[p.grade.label] || 'neutral';
    var toneBadgeCls = TONE_BADGE_CLASS[tone] || 'ff-badge-neutral';

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">공매도·대차거래 <span class="ff-extra-grade">' + escapeHtml(p.grade.label) + '</span></div>'
      + (causes.length ? '<div class="ff-extra-badges">' + causes.map(function (c) { return '<span class="ff-extra-badge">' + escapeHtml(c) + '</span>'; }).join('') + '</div>' : '')
      + (s ? '<div class="ff-extra-interp ff-extra-tone-' + tone + '">'
          + '<span class="ff-badge ' + toneBadgeCls + '">' + escapeHtml(p.grade.label) + '</span>'
          + '<span class="ff-extra-interp-text">' + escapeHtml(shortInterpText(s, l)) + '</span>'
          + '</div>' : '')
      + '<div class="ff-extra-grid">' + grid + '</div>'
      + '<div class="ff-extra-help">'
      + '<b>Day to Cover</b>: 공매도 잔고를 20일 평균 거래량으로 다 갚는 데 걸리는 거래일 수(클수록 상환 물량 소화가 오래 걸림).<br>'
      + '<b>숏 압박 지수</b>: (외국인+기관 순매수)÷공매도 거래량×100. 0 이상이면 숏스퀴즈 압력 구간, 미만이면 동반 매도 구간.'
      + '</div>'
      + '</div>';
  }

  function buildPensionCard(p, name) {
    if (!p) return '';
    var streak = p.streak || { days: 0, direction: 'flat' };
    var streakLabel = streak.direction === 'buy' ? '연속 순매수' : streak.direction === 'sell' ? '연속 순매도' : '뚜렷한 방향 없음';
    var streakBadgeCls = streak.direction === 'buy' ? 'ff-badge-buy' : streak.direction === 'sell' ? 'ff-badge-sell' : 'ff-badge-neutral';
    var interp = p.interpretation || { tone: 'neutral', label: '', text: '' };
    var badgeCls = TONE_BADGE_CLASS[interp.tone] || 'ff-badge-neutral';

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">연기금 매매 동향</div>'
      + '<div class="ff-extra-streak"><span class="ff-badge ' + streakBadgeCls + '">' + streakLabel + ' ' + streak.days + '일</span></div>'
      + '<div class="ff-extra-interp ff-extra-tone-' + escapeAttr(interp.tone) + '">'
      + '<span class="ff-badge ' + badgeCls + '">' + escapeHtml(interp.label) + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(interp.text) + '</span>'
      + '</div>'
      + '<div class="ff-extra-grid">'
      + extraMetric('최근 5일 순매수', fmtSignedWon(p.net_5d))
      + extraMetric('최근 20일 순매수', fmtSignedWon(p.net_20d))
      + extraMetric('최근 60일 순매수', p.net_60d == null ? '-' : fmtSignedWon(p.net_60d))
      + extraMetric('누적(' + (p.cumulative_window_days || 0) + '영업일)', fmtSignedWon(p.net_cumulative))
      + '</div>'
      + '</div>';
  }

  // ---- 가격 차트: 지지/저항 + 이동평균 5/20/60/224일선 (?action=flowChart) ----

  function buildFlowChartCard(chartData, techScore) {
    var body;
    if (!chartData || chartData.error || !chartData.daily || chartData.daily.length < 2) {
      body = '<div class="ff-error">' + escapeHtml((chartData && chartData.message) || '차트 데이터를 불러오지 못했어요.') + '</div>';
    } else {
      body = '<div class="ff-chart ff-chart-candle" id="ffLwChart" style="height:' + FCHART_H + 'px"></div>'
        + buildLwLegend() + buildTechBreakdown(techScore);
    }
    return '<div class="ff-extra-card ff-flow-chart-card">'
      + '<div class="ff-extra-card-title">📉 가격 차트 · 지지/저항 · 이동평균</div>'
      + body
      + '</div>';
  }

  function buildLwLegend() {
    return '<div class="ff-legend">'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma5 + '"></i>5일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma20 + '"></i>20일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma60 + '"></i>60일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:' + MA_COLORS.ma224 + '"></i>224일선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#1261c4"></i>지지선</span>'
      + '<span class="ff-legend-item"><i class="ff-dot" style="background:#d24f45"></i>저항선</span>'
      + '</div>';
  }

  // 차트 밑에 붙는 설명 + 기술적 점수 채점표(①이평선 40 ②지지선 30 ③저항선 30)
  function buildTechBreakdown(t) {
    if (!t) return '';
    return '<div class="ff-tech">'
      + '<div class="ff-tech-desc">파란 점선=지지선, 빨간 점선=저항선(최근 120영업일 스윙 고점·저점 기준). '
      + '5·20·60·224일 이동평균선이 위에서부터 순서대로 놓이면(정배열) 상승 추세, 반대 순서(역배열)면 하락 추세로 봅니다.</div>'
      + '<table class="ff-tech-table"><thead><tr><th>구분</th><th>상태</th><th>점수</th></tr></thead><tbody>'
      + '<tr><td>① 이동평균 상태</td><td>' + escapeHtml(t.ma.label) + '</td><td>' + t.ma.score + '/40</td></tr>'
      + '<tr><td>② 지지선</td><td>' + escapeHtml(t.support.label) + '</td><td>' + t.support.score + '/30</td></tr>'
      + '<tr><td>③ 저항선</td><td>' + escapeHtml(t.resistance.label) + '</td><td>' + t.resistance.score + '/30</td></tr>'
      + '<tr class="ff-tech-total-row"><td colspan="2">기술적 점수</td><td>' + t.score + '/100</td></tr>'
      + '</tbody></table>'
      + '</div>';
  }

  // CDN에서 라이브러리를 1회만 지연 로드(이미 로드돼 있으면 즉시 resolve)
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

  // 재검색/언마운트 시 이전 차트 인스턴스와 다크모드 감시자를 정리(리스너 누수 방지)
  function destroyLwChart() {
    if (lwcThemeObserver) { lwcThemeObserver.disconnect(); lwcThemeObserver = null; }
    if (lwcChart) {
      try { lwcChart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
      lwcChart = null;
    }
  }

  // 9bolt 스킨의 html.dark 토글은 새로고침 없이 클래스만 바뀌므로, 캔버스 기반 차트도
  // 같이 갱신되게 색상을 여기 한 곳에서 계산한다(MutationObserver로 재적용).
  function lwcThemeOptions(LWC) {
    var dark = document.documentElement.classList.contains('dark');
    return {
      layout: { background: { color: 'transparent' }, textColor: dark ? '#aaa' : '#555' },
      grid: {
        vertLines: { color: dark ? '#3a3a3a' : '#eee' },
        horzLines: { color: dark ? '#3a3a3a' : '#eee' }
      },
      rightPriceScale: { borderColor: dark ? '#3a3a3a' : '#ddd' },
      timeScale: { borderColor: dark ? '#3a3a3a' : '#ddd' }
    };
  }

  // 실제 트레이딩뷰 엔진(TradingView Lightweight Charts)으로 캔들/이평선/지지저항을 렌더링.
  // GAS ?action=flowChart 응답(daily 오름차순 + ma5/20/60/224 + levels)을 그대로 먹인다.
  function renderLwChart(container, chartData) {
    destroyLwChart();
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return; // 로딩 중 다른 종목 재검색되면 중단

      var chart = LWC.createChart(container, mergeOptions({
        autoSize: true,
        height: FCHART_H,
        crosshair: { mode: LWC.CrosshairMode.Normal },
        timeScale: { timeVisible: false, secondsVisible: false },
        localization: { priceFormatter: chartPriceFormatter }
      }, lwcThemeOptions(LWC)));
      lwcChart = chart;

      var daily = chartData.daily;
      var candleSeries = chart.addCandlestickSeries({
        upColor: '#d24f45', downColor: '#1261c4',
        borderUpColor: '#d24f45', borderDownColor: '#1261c4',
        wickUpColor: '#d24f45', wickDownColor: '#1261c4'
      });
      candleSeries.setData(daily.map(function (d) {
        return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
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
          pts.push({ time: d.date, value: series[i] });
        });
        lineSeries.setData(pts);
      });

      chart.timeScale().fitContent();

      lwcThemeObserver = new MutationObserver(function () {
        chart.applyOptions(lwcThemeOptions(LWC));
      });
      lwcThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }).catch(function () {
      container.innerHTML = '<div class="ff-error">차트 라이브러리를 불러오지 못했어요.</div>';
    });
  }

  function mergeOptions(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) out[k2] = b[k2];
    return out;
  }

  function fmtAbsShares(v) { return v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString() + '주'; }
  function fmtWon(v) { return v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString() + '원'; }
  // 캔들차트 축·지지/저항선·크로스헤어에 표시되는 가격에 천단위 콤마(원화는 소수점 없음)
  function chartPriceFormatter(v) { return v == null || isNaN(v) ? '' : Math.round(v).toLocaleString(); }
  function fmtPct(v) { return v == null || isNaN(v) ? '-' : v.toFixed(2) + '%'; }
  function fmtSignedPct(v) {
    if (v == null || isNaN(v)) return '-';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function fmtSignedWon(n) {
    if (n == null || isNaN(n)) return '-';
    var eok = n / 100; // penfnd_etc는 백만원 단위로 내려오므로 억원 = /100
    return (eok >= 0 ? '+' : '') + eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억';
  }

  // ---- 차트 (vanilla SVG - 버블차트와 스택 통일, 외부 라이브러리 없음) ----

  // y축 범위 계산 - 차트 생성과 호버 좌표 역산이 같은 스케일을 써야 해서 분리
  function netDomain(asc) {
    var vals = [];
    asc.forEach(function (d) { vals.push(d.foreign_net, d.inst_net); });
    var max = Math.max.apply(null, vals.concat([0]));
    var min = Math.min.apply(null, vals.concat([0]));
    var span = (max - min) || 1;
    return { min: min - span * 0.08, max: max + span * 0.08 };
  }

  function ratioDomain(asc) {
    var vals = asc.map(function (d) { return d.foreign_ratio; });
    var max = Math.max.apply(null, vals);
    var min = Math.min.apply(null, vals);
    var span = (max - min) || 0.5;
    return { min: min - span * 0.15, max: max + span * 0.15 };
  }

  // 순매매량 라인차트: 외국인/기관 2개 시리즈, 0선 기준
  function buildNetChart(daily) {
    var asc = daily.slice().reverse(); // 왼쪽=과거, 오른쪽=최신
    var n = asc.length;
    if (n < 2) return '';

    var dom = netDomain(asc);
    var min = dom.min;
    var max = dom.max;

    var iw = CHART_W - PAD.l - PAD.r;
    var ih = CHART_H - PAD.t - PAD.b;
    function x(i) { return PAD.l + (i / (n - 1)) * iw; }
    function y(v) { return PAD.t + (1 - (v - min) / (max - min)) * ih; }

    function points(field) {
      return asc.map(function (d, i) {
        return x(i).toFixed(1) + ',' + y(d[field]).toFixed(1);
      }).join(' ');
    }

    var svg = '<svg class="ff-svg" viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img" aria-label="외국인 기관 순매매량 추이">';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(max).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(max).toFixed(1) + '"/>';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(min).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(min).toFixed(1) + '"/>';
    svg += '<line class="ff-zero" x1="' + PAD.l + '" y1="' + y(0).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(0).toFixed(1) + '"/>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + fmtCompact(max) + '</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(0) + 4).toFixed(1) + '" text-anchor="end">0</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + fmtCompact(min) + '</text>';
    svg += xAxisLabels(asc, x, CHART_H - 8);
    svg += '<polyline class="ff-line-foreign" points="' + points('foreign_net') + '"/>';
    svg += '<polyline class="ff-line-inst" points="' + points('inst_net') + '"/>';
    svg += hoverMarkup(CHART_H, ['foreign', 'inst']);
    svg += '</svg>';

    return '<div class="ff-chart ff-chart-net">' + svg
      + '<div class="ff-tt" hidden></div>'
      + '<div class="ff-legend">'
      + '<span class="ff-legend-item"><i class="ff-dot ff-dot-foreign"></i>외국인</span>'
      + '<span class="ff-legend-item"><i class="ff-dot ff-dot-inst"></i>기관</span>'
      + '</div></div>';
  }

  // 외국인 보유율 미니차트
  function buildRatioChart(daily) {
    var asc = daily.slice().reverse();
    var n = asc.length;
    if (n < 2) return '';

    var dom = ratioDomain(asc);
    var min = dom.min;
    var max = dom.max;

    var iw = CHART_W - PAD.l - PAD.r;
    var ih = RATIO_H - PAD.t - PAD.b;
    function x(i) { return PAD.l + (i / (n - 1)) * iw; }
    function y(v) { return PAD.t + (1 - (v - min) / (max - min)) * ih; }

    var pts = asc.map(function (d, i) {
      return x(i).toFixed(1) + ',' + y(d.foreign_ratio).toFixed(1);
    }).join(' ');

    var svg = '<svg class="ff-svg" viewBox="0 0 ' + CHART_W + ' ' + RATIO_H + '" role="img" aria-label="외국인 보유율 추이">';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(max).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(max).toFixed(1) + '"/>';
    svg += '<line class="ff-grid" x1="' + PAD.l + '" y1="' + y(min).toFixed(1) + '" x2="' + (CHART_W - PAD.r) + '" y2="' + y(min).toFixed(1) + '"/>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(max) + 4).toFixed(1) + '" text-anchor="end">' + max.toFixed(1) + '%</text>';
    svg += '<text class="ff-axis" x="' + (PAD.l - 6) + '" y="' + (y(min) + 4).toFixed(1) + '" text-anchor="end">' + min.toFixed(1) + '%</text>';
    svg += xAxisLabels(asc, x, RATIO_H - 8);
    svg += '<polyline class="ff-line-ratio" points="' + pts + '"/>';
    svg += hoverMarkup(RATIO_H, ['ratio']);
    svg += '</svg>';

    var last = asc[n - 1].foreign_ratio;
    return '<div class="ff-chart ff-chart-ratio">' + svg
      + '<div class="ff-tt" hidden></div>'
      + '<div class="ff-legend"><span class="ff-legend-item"><i class="ff-dot ff-dot-ratio"></i>보유율 (현재 ' + last.toFixed(2) + '%)</span></div>'
      + '</div>';
  }

  // ---- 호버 툴팁 (세로 가이드선 + 시리즈별 점 + 날짜/수치) ----

  function hoverMarkup(h, seriesKeys) {
    var out = '<line class="ff-hover-line" x1="0" x2="0" y1="' + PAD.t + '" y2="' + (h - PAD.b) + '" visibility="hidden"/>';
    seriesKeys.forEach(function (key) {
      out += '<circle class="ff-hover-dot ff-hover-dot-' + key + '" r="4" visibility="hidden"/>';
    });
    return out;
  }

  function wireChartHover(chartEl, daily, type) {
    if (!chartEl) return;
    var svg = chartEl.querySelector('svg.ff-svg');
    var tt = chartEl.querySelector('.ff-tt');
    var line = chartEl.querySelector('.ff-hover-line');
    if (!svg || !tt || !line) return;

    var asc = daily.slice().reverse();
    var n = asc.length;
    if (n < 2) return;

    var H = type === 'net' ? CHART_H : RATIO_H;
    var iw = CHART_W - PAD.l - PAD.r;
    var ih = H - PAD.t - PAD.b;
    var dom = type === 'net' ? netDomain(asc) : ratioDomain(asc);

    function xAt(i) { return PAD.l + (i / (n - 1)) * iw; }
    function yAt(v) { return PAD.t + (1 - (v - dom.min) / (dom.max - dom.min)) * ih; }

    var dots = {};
    ['foreign', 'inst', 'ratio'].forEach(function (key) {
      var el = chartEl.querySelector('.ff-hover-dot-' + key);
      if (el) dots[key] = el;
    });

    function show(evt) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var vx = (evt.clientX - rect.left) / rect.width * CHART_W;
      var i = Math.round((vx - PAD.l) / iw * (n - 1));
      if (i < 0) i = 0;
      if (i > n - 1) i = n - 1;
      var d = asc[i];
      var X = xAt(i);

      line.setAttribute('x1', X);
      line.setAttribute('x2', X);
      line.setAttribute('visibility', 'visible');

      if (type === 'net') {
        if (dots.foreign) {
          dots.foreign.setAttribute('cx', X);
          dots.foreign.setAttribute('cy', yAt(d.foreign_net));
          dots.foreign.setAttribute('visibility', 'visible');
        }
        if (dots.inst) {
          dots.inst.setAttribute('cx', X);
          dots.inst.setAttribute('cy', yAt(d.inst_net));
          dots.inst.setAttribute('visibility', 'visible');
        }
        tt.innerHTML = '<div class="ff-tt-date">' + escapeHtml(d.date) + '</div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-foreign"></i>외국인 <b class="' + signClass(d.foreign_net) + '">' + fmtShares(d.foreign_net) + '</b></div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-inst"></i>기관 <b class="' + signClass(d.inst_net) + '">' + fmtShares(d.inst_net) + '</b></div>'
          + '<div class="ff-tt-row ff-tt-sub">종가 ' + Number(d.close).toLocaleString() + ' (' + (d.change_pct >= 0 ? '+' : '') + d.change_pct.toFixed(2) + '%)</div>';
      } else {
        if (dots.ratio) {
          dots.ratio.setAttribute('cx', X);
          dots.ratio.setAttribute('cy', yAt(d.foreign_ratio));
          dots.ratio.setAttribute('visibility', 'visible');
        }
        tt.innerHTML = '<div class="ff-tt-date">' + escapeHtml(d.date) + '</div>'
          + '<div class="ff-tt-row"><i class="ff-dot ff-dot-ratio"></i>보유율 <b>' + d.foreign_ratio.toFixed(2) + '%</b></div>'
          + '<div class="ff-tt-row ff-tt-sub">보유주수 ' + Number(d.foreign_shares).toLocaleString() + '주</div>';
      }
      tt.hidden = false;

      // 툴팁 픽셀 위치: 가이드선 오른쪽에 붙이되, 오른쪽 끝에선 왼쪽으로 뒤집는다
      var chartRect = chartEl.getBoundingClientRect();
      var lineLeft = (rect.left - chartRect.left) + (X / CHART_W) * rect.width;
      var ttW = tt.offsetWidth || 150;
      var left = lineLeft + 10;
      if (left + ttW > chartRect.width - 4) left = lineLeft - ttW - 10;
      tt.style.left = Math.max(left, 4) + 'px';
      tt.style.top = ((rect.top - chartRect.top) + 8) + 'px';
    }

    function hide() {
      tt.hidden = true;
      line.setAttribute('visibility', 'hidden');
      Object.keys(dots).forEach(function (k) { dots[k].setAttribute('visibility', 'hidden'); });
    }

    svg.addEventListener('mousemove', show);
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('click', show); // 모바일 탭 대응
  }

  // x축 날짜 레이블: 처음/중간/끝 3개
  function xAxisLabels(asc, x, textY) {
    var idxs = [0, Math.floor((asc.length - 1) / 2), asc.length - 1];
    var out = '';
    idxs.forEach(function (i, k) {
      var anchor = k === 0 ? 'start' : (k === 2 ? 'end' : 'middle');
      out += '<text class="ff-axis" x="' + x(i).toFixed(1) + '" y="' + textY + '" text-anchor="' + anchor + '">'
        + shortDate(asc[i].date) + '</text>';
    });
    return out;
  }

  function shortDate(iso) {
    // "2026-07-10" -> "07/10"
    return iso.slice(5, 7) + '/' + iso.slice(8, 10);
  }

  // ---- 포맷터 ----

  function signClass(v) {
    if (v > 0) return 'ff-buy';
    if (v < 0) return 'ff-sell';
    return 'ff-flat';
  }

  function fmtShares(v) {
    var sign = v > 0 ? '+' : '';
    return sign + Math.round(v).toLocaleString();
  }

  // 축 레이블용 축약: 12,880,455 -> "+1,288만"
  function fmtCompact(v) {
    var abs = Math.abs(v);
    var sign = v > 0 ? '+' : v < 0 ? '-' : '';
    if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + '억';
    if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만';
    return sign + Math.round(abs).toLocaleString();
  }

  function fmtKrw(v) {
    var abs = Math.abs(v);
    var sign = v > 0 ? '+' : v < 0 ? '-' : '';
    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + '조원';
    if (abs >= 1e8) return sign + Math.round(abs / 1e8).toLocaleString() + '억원';
    if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만원';
    return sign + Math.round(abs).toLocaleString() + '원';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  var ForeignFlow = {
    init: init,
    fetchFlow: fetchFlow,
    search: search
  };
  global.ForeignFlow = ForeignFlow;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
