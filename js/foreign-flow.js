/**
 * 종목별 외국인·기관 수급 조회 위젯
 * 종목명 검색(기존 KRX_MAP 자동완성 재사용) -> GAS 프록시 ?action=foreignFlow&code= 호출 ->
 * 롤링 합산 표 + 순매매량 라인차트 + 외국인 보유율 미니차트 렌더링.
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * 서버 캐시 없음(온디맨드 크롤링) - 대신 이 스크립트가 종목별 5분 메모리 캐시로
 * 같은 종목 반복 조회를 디바운스한다(네이버 부하/GAS 호출량 억제).
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

  var cacheByCode = {};   // code -> { t, data }
  var inflightByCode = {}; // code -> Promise

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
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
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions(suggestBox);
        search(container, input.value.trim());
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

    box.querySelectorAll('.ff-suggest-item').forEach(function (el) {
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
    var resolved = resolveStock(query);
    if (!resolved) {
      resultBox.innerHTML = '<div class="ff-error">'
        + (query ? '"' + escapeHtml(query) + '" 종목을 찾을 수 없어요. 정확한 종목명을 입력해보세요.' : '종목명을 입력해주세요.')
        + '</div>';
      return;
    }

    resultBox.innerHTML = '<div class="ff-loading">' + escapeHtml(resolved.name) + ' 수급 데이터를 불러오는 중...</div>';

    ForeignFlow.fetchFlow(resolved.code)
      .then(function (data) {
        if (!data || data.error || !data.daily || !data.daily.length) {
          resultBox.innerHTML = '<div class="ff-error">'
            + escapeHtml((data && data.message) || '수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.')
            + '</div>';
          return;
        }
        renderResult(resultBox, data);
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

  function renderResult(box, data) {
    var html = '<div class="ff-header">' + escapeHtml(data.name || data.code)
      + ' <span class="ff-code">(' + escapeHtml(data.code) + ')</span>'
      + ' <span class="ff-asof">' + escapeHtml(data.as_of) + ' 기준</span></div>';

    html += buildBadges(data);
    html += buildRollingTable(data);
    html += '<div class="ff-chart-title">외국인·기관 순매매량 추이 (최근 ' + data.daily.length + '영업일)</div>';
    html += buildNetChart(data.daily);
    html += '<div class="ff-chart-title">외국인 보유율 추이</div>';
    html += buildRatioChart(data.daily);
    html += '<div class="ff-footnote">※ 추정대금은 순매매량 × 당일 종가로 계산한 <b>추정치</b>이며 실제 거래대금과 다를 수 있습니다. 자료: 네이버 금융</div>';

    box.innerHTML = html;
  }

  function buildBadges(data) {
    var out = '<div class="ff-badges">';

    var st = data.streak || {};
    if (st.foreign_days > 0 && st.foreign_direction !== 'flat') {
      var isBuy = st.foreign_direction === 'buy';
      out += '<span class="ff-badge ' + (isBuy ? 'ff-badge-buy' : 'ff-badge-sell') + '">'
        + '외국인 ' + st.foreign_days + '일 연속 ' + (isBuy ? '순매수' : '순매도') + '</span>';
    }

    var sig = data.signal || {};
    if (sig.trend_shift) {
      out += '<span class="ff-badge ff-badge-shift">추세 전환</span>';
      if (sig.note) out += '<span class="ff-signal-note">' + escapeHtml(sig.note) + '</span>';
    }

    out += '</div>';
    return out;
  }

  function buildRollingTable(data) {
    var rows = [
      ['당일', data.rolling.today, data.amount_estimate.today_krw],
      ['5일 합산', data.rolling['5d'], data.amount_estimate['5d_krw']],
      ['10일 합산', data.rolling['10d'], data.amount_estimate['10d_krw']],
      ['20일 합산', data.rolling['20d'], data.amount_estimate['20d_krw']]
    ];

    var html = '<table class="ff-table"><thead><tr>'
      + '<th>구분</th><th>외국인 순매매(주)</th><th>외국인 추정대금</th><th>기관 순매매(주)</th>'
      + '</tr></thead><tbody>';

    rows.forEach(function (r) {
      html += '<tr><td class="ff-td-label">' + r[0] + '</td>'
        + '<td class="' + signClass(r[1].foreign) + '">' + fmtShares(r[1].foreign) + '</td>'
        + '<td class="' + signClass(r[2]) + '">' + fmtKrw(r[2]) + '</td>'
        + '<td class="' + signClass(r[1].inst) + '">' + fmtShares(r[1].inst) + '</td></tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  // ---- 차트 (vanilla SVG - 버블차트와 스택 통일, 외부 라이브러리 없음) ----

  // 순매매량 라인차트: 외국인/기관 2개 시리즈, 0선 기준
  function buildNetChart(daily) {
    var asc = daily.slice().reverse(); // 왼쪽=과거, 오른쪽=최신
    var n = asc.length;
    if (n < 2) return '';

    var vals = [];
    asc.forEach(function (d) { vals.push(d.foreign_net, d.inst_net); });
    var max = Math.max.apply(null, vals.concat([0]));
    var min = Math.min.apply(null, vals.concat([0]));
    var span = (max - min) || 1;
    max += span * 0.08;
    min -= span * 0.08;

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
    svg += '</svg>';

    return '<div class="ff-chart">' + svg
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

    var vals = asc.map(function (d) { return d.foreign_ratio; });
    var max = Math.max.apply(null, vals);
    var min = Math.min.apply(null, vals);
    var span = (max - min) || 0.5;
    max += span * 0.15;
    min -= span * 0.15;

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
    svg += '</svg>';

    var last = asc[n - 1].foreign_ratio;
    return '<div class="ff-chart">' + svg
      + '<div class="ff-legend"><span class="ff-legend-item"><i class="ff-dot ff-dot-ratio"></i>보유율 (현재 ' + last.toFixed(2) + '%)</span></div>'
      + '</div>';
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
