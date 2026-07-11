/**
 * 연기금 분석 위젯
 * 종목명 검색(기존 KRX_MAP 자동완성 재사용) -> GAS 프록시 ?action=pensionFund&code= 호출 ->
 * 연기금 단독 순매수 연속일수/구간별 합산/평균매수가(추정)/수익률(추정) + 규칙 기반 해석을 렌더링.
 * foreign-flow.js/short-pressure.js와 동일한 구조/네이밍 패턴을 그대로 따른다.
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * 서버 캐시 없음(온디맨드 크롤링, KRX+네이버 조합) - 클라이언트가 5분 메모리 캐시로 디바운스.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#pension-fund';
  var FETCH_TIMEOUT_MS = 20000; // KRX 두 번 + 네이버 조합 크롤링이라 여유 있게
  var MAX_SUGGESTIONS = 8;
  var CLIENT_CACHE_MS = 5 * 60 * 1000;

  var cacheByCode = {};
  var inflightByCode = {};

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell();
    wireEvents(container);
  }

  function buildShell() {
    return ''
      + '<div class="pf-search">'
      + '<div class="pf-input-wrap">'
      + '<input type="text" id="pfInput" class="pf-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="pfSuggest" class="pf-suggest"></div>'
      + '</div>'
      + '<button type="button" id="pfSearchBtn" class="pf-search-btn">조회</button>'
      + '</div>'
      + '<div id="pfResult" class="pf-result">'
      + '<div class="pf-hint">종목명을 검색하면 연기금 매매 동향을 보여드려요.</div>'
      + '</div>';
  }

  // ---- 검색/자동완성 (foreign-flow.js와 동일 패턴) ----

  function wireEvents(container) {
    var input = container.querySelector('#pfInput');
    var suggestBox = container.querySelector('#pfSuggest');
    var btn = container.querySelector('#pfSearchBtn');

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
      return '<div class="pf-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.pf-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#pfInput').value = name;
        hideSuggestions(box);
        search(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만.
  function resolveStock(query) {
    if (!query) return null;
    if (/^[0-9A-Z]{6}$/i.test(query)) return { code: query, name: query };

    var map = global.KRX_MAP || {};
    if (map.hasOwnProperty(query)) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var matches = [];
    for (var name in map) {
      if (map.hasOwnProperty(name) && name.toLowerCase().indexOf(q) > -1) matches.push(name);
    }
    if (matches.length === 1) return { code: map[matches[0]], name: matches[0] };
    return null;
  }

  function search(container, query) {
    var resultBox = container.querySelector('#pfResult');
    var stock = resolveStock(query);
    if (!stock) {
      resultBox.innerHTML = '<div class="pf-error">종목을 찾을 수 없습니다: "' + escapeHtml(query) + '"</div>';
      return;
    }

    resultBox.innerHTML = '<div class="pf-loading">연기금 매매 데이터를 불러오는 중...</div>';

    PensionFund.fetchPensionFund(stock.code)
      .then(function (data) {
        if (!data || data.error) {
          resultBox.innerHTML = '<div class="pf-error">' + escapeHtml((data && data.message) || '조회에 실패했습니다.') + '</div>';
          return;
        }
        resultBox.innerHTML = buildResultHtml(data, stock.name);
      })
      .catch(function () {
        resultBox.innerHTML = '<div class="pf-error">조회에 실패했습니다. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // ---- 데이터 로딩 (클라이언트 5분 캐시 + 동시요청 중복 방지) ----

  function fetchPensionFund(code) {
    var cached = cacheByCode[code];
    if (cached && (Date.now() - cached.t) < CLIENT_CACHE_MS) {
      return Promise.resolve(cached.data);
    }
    if (inflightByCode[code]) return inflightByCode[code];

    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    var p = fetch(GAS_TICKER_URL + '?action=pensionFund&code=' + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        if (data && !data.error) cacheByCode[code] = { t: Date.now(), data: data };
        delete inflightByCode[code];
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        delete inflightByCode[code];
        throw err;
      });

    inflightByCode[code] = p;
    return p;
  }

  // ---- 렌더링 ----

  function buildResultHtml(data, displayName) {
    var streak = data.streak || { days: 0, direction: 'flat' };
    var streakEmoji = streak.direction === 'buy' ? '🟢' : streak.direction === 'sell' ? '🔴' : '⚪';
    var streakLabel = streak.direction === 'buy' ? '연속 순매수' : streak.direction === 'sell' ? '연속 순매도' : '뚜렷한 방향 없음';

    var returnClass = data.return_pct == null ? '' : data.return_pct >= 0 ? 'pf-up' : 'pf-down';

    return ''
      + '<div class="pf-card">'
      + '<div class="pf-header">'
      + '<div class="pf-title">' + escapeHtml(data.name || displayName) + ' 연기금 동향</div>'
      + '<div class="pf-asof">' + escapeHtml(data.as_of || '') + ' 기준</div>'
      + '</div>'
      + '<div class="pf-streak-row">'
      + '<span class="pf-streak-emoji">' + streakEmoji + '</span>'
      + '<span class="pf-streak-text">' + streakLabel + ' ' + streak.days + '일</span>'
      + '</div>'
      + '<div class="pf-metrics">'
      + metricHtml('최근 5일 순매수', fmtSignedWon(data.net_5d))
      + metricHtml('최근 20일 순매수', fmtSignedWon(data.net_20d))
      + metricHtml('최근 60일 순매수', fmtSignedWon(data.net_60d))
      + metricHtml('누적 순매수(' + (data.cumulative_window_days || 0) + '영업일)', fmtSignedWon(data.net_cumulative))
      + metricHtml('추정 평균 매수가', fmtWon(data.avg_buy_price))
      + metricHtml('현재가', fmtWon(data.current_price) + (data.return_pct == null ? '' : ' <span class="' + returnClass + '">(' + fmtSignedPct(data.return_pct) + ')</span>'))
      + '</div>'
      + '<div class="pf-interp pf-tone-' + escapeAttr(data.interpretation && data.interpretation.tone || 'neutral') + '">'
      + '<span class="pf-interp-label">' + escapeHtml((data.interpretation && data.interpretation.label) || '') + '</span>'
      + '<span class="pf-interp-text">' + escapeHtml((data.interpretation && data.interpretation.text) || '') + '</span>'
      + '</div>'
      + '<div class="pf-note">평균 매수가는 순매수 거래대금 ÷ 순매수 거래량으로 추정한 값이라 실제 평단가와 다를 수 있습니다.</div>'
      + '</div>';
  }

  function metricHtml(label, valueHtml) {
    return '<div class="pf-metric"><div class="pf-metric-label">' + escapeHtml(label) + '</div>'
      + '<div class="pf-metric-value">' + valueHtml + '</div></div>';
  }

  function fmtWon(n) {
    if (n == null || isNaN(n)) return '-';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }
  function fmtSignedWon(n) {
    if (n == null || isNaN(n)) return '-';
    var eok = n / 100000000; // 억원 단위
    return (eok >= 0 ? '+' : '') + eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억';
  }
  function fmtSignedPct(n) {
    if (n == null || isNaN(n)) return '-';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  var PensionFund = {
    init: init,
    fetchPensionFund: fetchPensionFund,
    search: search
  };
  global.PensionFund = PensionFund;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
