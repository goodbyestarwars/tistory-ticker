/**
 * 공매도 압박 위젯
 * 종목명 검색(기존 KRX_MAP 자동완성 재사용) -> GAS 프록시 ?action=shortPressure&code= 호출 ->
 * 공매도 잔고/거래비중/Days to Cover/압박 점수(100점)를 렌더링.
 * foreign-flow.js와 동일한 구조/네이밍 패턴을 그대로 따른다(검색·자동완성·5분 캐시·에러 처리).
 *
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 * 서버 캐시 없음(온디맨드 크롤링, KRX+네이버 조합) - 클라이언트가 5분 메모리 캐시로 디바운스.
 *
 * 대차잔고(증가율)는 표시하지 않는다 - KRX/네이버 모두 개별종목 단위로 공개하지 않아
 * (gas/ticker-proxy.gs의 getShortPressure 주석 참고) 압박 점수에서도 제외하고 재분배했다.
 * "공매도가 주가를 누른다"고 단정하는 문구를 쓰지 않는다(항상 가능성/추정/압박도).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#short-pressure';
  var FETCH_TIMEOUT_MS = 20000; // KRX + 네이버 조합 크롤링이라 여유 있게
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
      + '<div class="sp-search">'
      + '<div class="sp-input-wrap">'
      + '<input type="text" id="spInput" class="sp-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="spSuggest" class="sp-suggest"></div>'
      + '</div>'
      + '<button type="button" id="spSearchBtn" class="sp-search-btn">조회</button>'
      + '</div>'
      + '<div id="spResult" class="sp-result">'
      + '<div class="sp-hint">종목명을 검색하면 공매도 압박 가능성을 보여드려요.</div>'
      + '</div>';
  }

  // ---- 검색/자동완성 (foreign-flow.js와 동일 패턴) ----

  function wireEvents(container) {
    var input = container.querySelector('#spInput');
    var suggestBox = container.querySelector('#spSuggest');
    var btn = container.querySelector('#spSearchBtn');

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
      return '<div class="sp-suggest-item" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.sp-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#spInput').value = name;
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
    var resultBox = container.querySelector('#spResult');
    var stock = resolveStock(query);
    if (!stock) {
      resultBox.innerHTML = '<div class="sp-error">종목을 찾을 수 없습니다: "' + escapeHtml(query) + '"</div>';
      return;
    }

    resultBox.innerHTML = '<div class="sp-loading">공매도 데이터를 불러오는 중...</div>';

    ShortPressure.fetchPressure(stock.code)
      .then(function (data) {
        if (!data || data.error) {
          resultBox.innerHTML = '<div class="sp-error">' + escapeHtml((data && data.message) || '조회에 실패했습니다.') + '</div>';
          return;
        }
        resultBox.innerHTML = buildResultHtml(data, stock.name);
      })
      .catch(function () {
        resultBox.innerHTML = '<div class="sp-error">조회에 실패했습니다. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // ---- 데이터 로딩 (클라이언트 5분 캐시 + 동시요청 중복 방지) ----

  function fetchPressure(code) {
    var cached = cacheByCode[code];
    if (cached && (Date.now() - cached.t) < CLIENT_CACHE_MS) {
      return Promise.resolve(cached.data);
    }
    if (inflightByCode[code]) return inflightByCode[code];

    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    var p = fetch(GAS_TICKER_URL + '?action=shortPressure&code=' + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
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

  function scoreTone(score) {
    if (score <= 20) return 'sp-tone-1';
    if (score <= 40) return 'sp-tone-2';
    if (score <= 60) return 'sp-tone-3';
    if (score <= 80) return 'sp-tone-4';
    return 'sp-tone-5';
  }

  function buildResultHtml(data, displayName) {
    var b = data.breakdownList = [];
    var br = (data.pressure && data.pressure.breakdown) || {};
    b.push({ label: '공매도 거래비중', value: fmtPct(data.today.short_ratio_pct), score: br.short_ratio, max: 40 });
    b.push({ label: '공매도 잔고 증감', value: fmtSignedPct(data.balance.change_pct), score: br.balance_increase, max: 30 });
    b.push({ label: '외국인 순매도 여부', value: data.foreign_net_today < 0 ? '순매도' : '순매수', score: br.foreign_sell, max: 15 });
    b.push({ label: '기관 순매도 여부', value: data.inst_net_today < 0 ? '순매도' : '순매수', score: br.inst_sell, max: 15 });

    var grade = data.pressure.grade || {};
    var tone = scoreTone(data.pressure.score);

    return ''
      + '<div class="sp-card ' + tone + '">'
      + '<div class="sp-header">'
      + '<div class="sp-title">' + escapeHtml(data.name || displayName) + ' 공매도 압박</div>'
      + '<div class="sp-asof">' + escapeHtml(data.as_of || '') + ' 기준</div>'
      + '</div>'
      + '<div class="sp-score-row">'
      + '<div class="sp-score">' + data.pressure.score + '<span class="sp-score-unit">점</span></div>'
      + '<div class="sp-grade">' + escapeHtml(grade.emoji || '') + ' ' + escapeHtml(grade.label || '') + '</div>'
      + '</div>'
      + '<div class="sp-metrics">'
      + metricHtml('공매도 누적잔고', fmtShares(data.balance.qty))
      + metricHtml('공매도 평균가격(추정)', fmtWon(data.balance.avg_price))
      + metricHtml('일평균 거래량(20일)', fmtShares(data.avg_volume_20d))
      + metricHtml('Days to Cover', data.days_to_cover == null ? '-' : data.days_to_cover.toFixed(1) + '일')
      + metricHtml('숏 압박 지수', data.short_squeeze_index == null ? '-' : data.short_squeeze_index.toFixed(1))
      + '</div>'
      + '<div class="sp-causes">'
      + '<div class="sp-causes-title">원인</div>'
      + b.map(function (it) {
        return '<div class="sp-cause-item">✔ ' + escapeHtml(it.label) + ' ' + escapeHtml(it.value)
          + ' <span class="sp-cause-score">(' + it.score + '/' + it.max + '점)</span></div>';
      }).join('')
      + '</div>'
      + '<div class="sp-conclusion">공매도 압박 ' + escapeHtml(grade.label || '') + ' 가능성으로 추정됩니다. 공매도가 주가를 직접 누른다고 단정할 수는 없습니다.</div>'
      + '<div class="sp-note">' + escapeHtml(data.note || '') + '</div>'
      + '</div>';
  }

  function metricHtml(label, value) {
    return '<div class="sp-metric"><div class="sp-metric-label">' + escapeHtml(label) + '</div>'
      + '<div class="sp-metric-value">' + escapeHtml(value) + '</div></div>';
  }

  function fmtShares(n) {
    if (n == null || isNaN(n)) return '-';
    return Math.round(n).toLocaleString('ko-KR') + '주';
  }
  function fmtWon(n) {
    if (n == null || isNaN(n)) return '-';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return '-';
    return n.toFixed(2) + '%';
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

  var ShortPressure = {
    init: init,
    fetchPressure: fetchPressure,
    search: search
  };
  global.ShortPressure = ShortPressure;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
