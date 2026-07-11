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
 * window.INVESTOR_FLOW_CACHE(선택, data/investor-flow-cache.js)가 로드돼 있으면
 * 외국인·기관 표 아래에 추가로 렌더링한다. 이 캐시는 GAS 온디맨드가 아니라
 * scripts/fetch_investor_flow.py를 로컬 PC에서 키움증권 REST API로 하루 1회 돌려
 * git push한 정적 스냅샷이라 data/sectors-v3.js 종목 풀만 커버한다 - 캐시에 없는
 * 종목은 안내 문구만 표시(에러 아님, 조용히 생략하지 않고 이유를 보여준다).
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

  // ---- 종합 점수 요약 박스용 (수급/공매도/연기금/차트패턴 + AI 한줄요약) ----
  var PATTERN_CACHE_MS = 10 * 60 * 1000; // 서버가 하루 1회만 갱신하므로 넉넉하게
  var patternScanCache = null;   // { t, data }
  var patternScanInflight = null;

  var PATTERN_LABELS = {
    risingLows: '저점상승형',
    doubleBottom: '쌍바닥',
    invHeadShoulders: '역헤드앤숄더',
    boxRangeLow: '박스권 하단',
    goldPitReversal: '골파기 반전',
    pullback: '눌림목'
  };
  var PATTERN_FOLLOWUP = {
    risingLows: '5일선 돌파 여부가 중요합니다.',
    doubleBottom: '넥라인 돌파 여부를 확인해야 합니다.',
    invHeadShoulders: '넥라인 상향 돌파 시 신호가 강화됩니다.',
    boxRangeLow: '박스 하단 지지 여부가 중요합니다.',
    goldPitReversal: '거래량을 동반한 반등 여부를 확인해야 합니다.',
    pullback: '5일선 재돌파 여부가 중요합니다.'
  };
  var PENSION_TONE_SCORE = {
    very_positive: 90, positive: 75, neutral_positive: 60, neutral: 50, caution: 25
  };

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

    Promise.all([ForeignFlow.fetchFlow(resolved.code), fetchPatternScan()])
      .then(function (results) {
        var data = results[0];
        var patternData = results[1];
        if (!data || data.error || !data.daily || !data.daily.length) {
          resultBox.innerHTML = '<div class="ff-error">'
            + escapeHtml((data && data.message) || '수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.')
            + '</div>';
          return;
        }
        renderResult(resultBox, data, patternData);
      })
      .catch(function () {
        resultBox.innerHTML = '<div class="ff-error">수급 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // 차트패턴 스캔 결과(?patternScan=1) - 6개 패턴 전체가 한 응답에 들어있어 종목 단위가
  // 아니라 위젯 세션 단위로 캐싱한다(서버가 하루 1회만 갱신하므로 부담 없음).
  function fetchPatternScan() {
    if (patternScanCache && Date.now() - patternScanCache.t < PATTERN_CACHE_MS) {
      return Promise.resolve(patternScanCache.data);
    }
    if (patternScanInflight) return patternScanInflight;

    patternScanInflight = fetchJson(GAS_TICKER_URL + '?patternScan=1')
      .then(function (data) {
        patternScanInflight = null;
        patternScanCache = { t: Date.now(), data: data };
        return data;
      })
      .catch(function () {
        patternScanInflight = null;
        return null; // 패턴 스캔 실패는 요약 박스에서 '데이터 없음'으로 처리 - 나머지 위젯은 살린다
      });
    return patternScanInflight;
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

  function renderResult(box, data, patternData) {
    var entry = (global.INVESTOR_FLOW_CACHE || {})[data.code] || null;
    var patternMatch = findPatternMatch(patternData, data.code);

    var html = buildSummaryBox(data, entry, patternMatch);

    html += '<div class="ff-header">' + escapeHtml(data.name || data.code)
      + ' <span class="ff-code">(' + escapeHtml(data.code) + ')</span>'
      + ' <span class="ff-asof">' + escapeHtml(data.as_of) + ' 기준</span></div>';

    html += buildBadges(data);
    html += buildRollingTable(data);
    html += buildExtraSections(data.code);
    html += '<div class="ff-chart-title">외국인·기관 순매매량 추이 (최근 ' + data.daily.length + '영업일)</div>';
    html += buildNetChart(data.daily);
    html += '<div class="ff-chart-title">외국인 보유율 추이</div>';
    html += buildRatioChart(data.daily);
    html += '<div class="ff-footnote">※ 추정대금은 순매매량 × 당일 종가로 계산한 <b>추정치</b>이며 실제 거래대금과 다를 수 있습니다. 자료: 네이버 금융</div>';

    box.innerHTML = html;

    wireChartHover(box.querySelector('.ff-chart-net'), data.daily, 'net');
    wireChartHover(box.querySelector('.ff-chart-ratio'), data.daily, 'ratio');
    loadAiSummary(box, data, entry, patternMatch);
  }

  // ---- 종합 점수 요약 박스 (수급/공매도/연기금/차트패턴 + AI 한줄요약) ----

  function findPatternMatch(patternData, code) {
    if (!patternData || !patternData.patterns) return null;
    var best = null;
    Object.keys(PATTERN_LABELS).forEach(function (key) {
      var items = patternData.patterns[key] || [];
      items.forEach(function (it) {
        if (it.code !== code) return;
        if (!best || (it.score || 0) > best.score) {
          best = { key: key, label: PATTERN_LABELS[key], score: it.score || 0 };
        }
      });
    });
    return best;
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

  function flowInterpText(data) {
    var r = data.rolling || {};
    var f5 = r['5d'] ? r['5d'].foreign : 0;
    var i5 = r['5d'] ? r['5d'].inst : 0;
    if (f5 > 0 && i5 > 0) return '외국인과 기관이 동반 순매수하며 수급이 양호합니다.';
    if (f5 > 0 && i5 < 0) return '외국인 매수가 우세하지만 기관 매도세가 이어지고 있습니다.';
    if (f5 < 0 && i5 > 0) return '기관 매수가 우세하지만 외국인 매도세가 이어지고 있습니다.';
    if (f5 < 0 && i5 < 0) return '외국인과 기관이 동반 순매도하며 수급이 약화되고 있습니다.';
    return '외국인·기관 수급 방향이 뚜렷하지 않습니다.';
  }

  function shortInterpText(s) {
    if (!s || !s.pressure) return '공매도 데이터가 없는 종목입니다.';
    var label = s.pressure.grade.label;
    if (label === '매우 강함' || label === '강함') return '공매도 압박이 강한 구간으로 단기 변동성 확대에 유의해야 합니다.';
    if (label === '보통') return '공매도 압박이 보통 수준으로 특별한 경계가 필요하지 않습니다.';
    return '공매도 압박이 약한 구간으로 매도 물량 부담이 크지 않습니다.';
  }

  function patternInterpText(match) {
    if (!match) return '현재 뚜렷하게 감지된 차트 패턴이 없습니다.';
    return match.label + '이 진행 중이며 ' + (PATTERN_FOLLOWUP[match.key] || '');
  }

  function buildSummaryBox(data, entry, patternMatch) {
    var flowScore = computeFlowScore(data);

    var shortP = entry && entry.short && entry.short.pressure;
    var shortScore = shortP ? shortP.score : null;
    var shortEmoji = shortP ? shortP.grade.emoji : '⚪';

    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;
    var pStreak = pension && pension.streak;
    var pensionEmoji = pStreak ? (pStreak.direction === 'buy' ? '🟢' : pStreak.direction === 'sell' ? '🔴' : '⚪') : '⚪';

    var patternScore = patternMatch ? patternMatch.score : null;

    var rows = [
      { icon: '🧭', label: '오늘의 수급', score: flowScore, desc: '외국인·기관 순매매 방향·강도 종합' },
      { icon: shortEmoji, label: '공매도 압박', score: shortScore, desc: '거래비중·잔고증가·동반매도 종합' },
      { icon: pensionEmoji, label: '연기금', score: pensionScore, desc: '연속매매일수·구간별 순매수 종합' },
      { icon: '📈', label: '차트패턴', score: patternScore, desc: '6종 패턴 조건 충족도(70점 이상만 반영)' }
    ];

    var rowsHtml = rows.map(function (r, i) {
      return '<div class="ff-summary-row' + (i === rows.length - 1 ? ' ff-summary-row-last' : '') + '">'
        + '<span class="ff-summary-icon">' + r.icon + '</span>'
        + '<span class="ff-summary-label">' + r.label + '</span>'
        + '<span class="ff-summary-score">' + (r.score == null ? '-' : r.score + '점') + '</span>'
        + '<span class="ff-summary-desc">' + r.desc + '</span>'
        + '</div>';
    }).join('');

    var interpRows = [
      ['🧭', '수급', flowInterpText(data)],
      [shortEmoji, '공매도', shortInterpText(entry && entry.short)],
      [pensionEmoji, '연기금', pension ? pension.interpretation.text : '연기금 데이터가 없는 종목입니다.'],
      ['📈', '차트', patternInterpText(patternMatch)]
    ].map(function (r) {
      return '<div class="ff-summary-interp-row">' + r[0] + ' ' + r[1] + ': "' + escapeHtml(r[2]) + '"</div>';
    }).join('');

    return '<div class="ff-summary">'
      + rowsHtml
      + '<div class="ff-summary-ai" id="ffAiSummary"><b>AI(GROQ) 한 줄 요약</b> · <span class="ff-summary-ai-text">생성 중...</span></div>'
      + '</div>'
      + '<div class="ff-summary-interp">' + interpRows + '</div>';
  }

  // AI 한줄요약은 Groq 호출이라 느릴 수 있어 나머지 렌더링을 막지 않고 비동기로 채운다.
  function loadAiSummary(box, data, entry, patternMatch) {
    var el = box.querySelector('#ffAiSummary .ff-summary-ai-text');
    if (!el) return;

    var shortP = entry && entry.short && entry.short.pressure;
    var pension = entry && entry.pension;
    var pensionScore = pension ? computePensionScore(pension) : null;

    var qs = '?action=flowAiSummary'
      + '&code=' + encodeURIComponent(data.code)
      + '&name=' + encodeURIComponent(data.name || data.code)
      + '&flowScore=' + computeFlowScore(data)
      + '&flowNote=' + encodeURIComponent(flowInterpText(data))
      + '&shortScore=' + (shortP ? shortP.score : '')
      + '&shortNote=' + encodeURIComponent(shortInterpText(entry && entry.short))
      + '&pensionScore=' + (pensionScore == null ? '' : pensionScore)
      + '&pensionNote=' + encodeURIComponent(pension ? pension.interpretation.text : '')
      + '&patternScore=' + (patternMatch ? patternMatch.score : '')
      + '&patternNote=' + encodeURIComponent(patternInterpText(patternMatch));

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

  // ---- 공매도/대차거래/연기금 (window.INVESTOR_FLOW_CACHE, PC 로컬 스냅샷) ----

  function buildExtraSections(code) {
    var cache = global.INVESTOR_FLOW_CACHE;
    var entry = cache && cache[code];
    if (!entry) {
      return '<div class="ff-extra-missing">공매도·대차거래·연기금 데이터는 주요 섹터 구성종목만 제공됩니다(하루 1회 갱신). '
        + '이 종목은 아직 커버리지에 없어요.</div>';
    }

    var html = '<div class="ff-extra">';
    html += buildShortLoanCard(entry.short, entry.loan);
    html += buildPensionCard(entry.pension, entry.name);
    html += '<div class="ff-extra-note">공매도 압박 점수는 항상 <b>가능성·추정치</b>이며, 공매도가 주가를 누른다고 단정하지 않습니다. '
      + escapeHtml(entry.as_of) + ' 기준 · 키움증권 API · PC 로컬 수집(하루 1회 갱신)</div>';
    html += '</div>';
    return html;
  }

  function extraMetric(label, valueHtml) {
    return '<div class="ff-extra-metric"><div class="ff-extra-metric-label">' + escapeHtml(label) + '</div>'
      + '<div class="ff-extra-metric-value">' + valueHtml + '</div></div>';
  }

  // 공매도 + 대차거래 병합 카드 (원래 두 카드였으나 서로 연관된 지표라 하나로 합침)
  function buildShortLoanCard(s, l) {
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
      grid += extraMetric('공매도 누적잔고', fmtAbsShares(s.balance_qty))
        + extraMetric('공매도 평균가격(추정)', fmtWon(s.avg_price))
        + extraMetric('당일 거래비중', fmtPct(s.today_ratio_pct))
        + extraMetric('일평균 거래량(20일)', fmtAbsShares(s.avg_volume_20d))
        + extraMetric('Days to Cover', s.days_to_cover == null ? '-' : s.days_to_cover.toFixed(2) + '일')
        + extraMetric('숏 압박 지수', s.short_squeeze_index == null ? '-' : s.short_squeeze_index.toFixed(1));
    }
    if (l) {
      grid += extraMetric('대차잔고', fmtAbsShares(l.balance_qty))
        + extraMetric('대차잔고 증감률', '<span class="' + signClass(l.balance_change_pct) + '">' + fmtSignedPct(l.balance_change_pct) + '</span>');
    }

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">' + p.grade.emoji + ' 공매도·대차거래 <span class="ff-extra-score">' + p.score + '점</span>'
      + '<span class="ff-extra-grade">' + escapeHtml(p.grade.label) + '</span></div>'
      + '<div class="ff-extra-grid">' + grid + '</div>'
      + (causes.length ? '<div class="ff-extra-causes">' + causes.map(function (c) { return '<span class="ff-extra-cause">✔ ' + escapeHtml(c) + '</span>'; }).join('') + '</div>' : '')
      + '<div class="ff-extra-help">'
      + '<b>Day to Cover</b>: 현재 공매도 잔고를 최근 20일 평균 거래량으로 전량 되갚는 데 걸리는 예상 거래일 수입니다. 값이 클수록 공매도 상환(숏커버링) 매수 물량이 시장에 소화되는 데 시간이 오래 걸립니다.<br>'
      + '<b>숏 압박 지수</b>: (외국인+기관 당일 순매수) ÷ 당일 공매도 거래량 × 100. 값이 높을수록 공매도 물량 대비 외국인·기관의 순매수 유입이 강해 숏커버링이 겹칠 경우 단기 반등(숏스퀴즈) 압력이 커질 수 있습니다.'
      + '</div>'
      + '</div>';
  }

  function buildPensionCard(p, name) {
    if (!p) return '';
    var streak = p.streak || { days: 0, direction: 'flat' };
    var streakEmoji = streak.direction === 'buy' ? '🟢' : streak.direction === 'sell' ? '🔴' : '⚪';
    var streakLabel = streak.direction === 'buy' ? '연속 순매수' : streak.direction === 'sell' ? '연속 순매도' : '뚜렷한 방향 없음';
    var interp = p.interpretation || { tone: 'neutral', label: '', text: '' };

    return '<div class="ff-extra-card">'
      + '<div class="ff-extra-card-title">연기금 매매 동향</div>'
      + '<div class="ff-extra-streak">' + streakEmoji + ' ' + streakLabel + ' ' + streak.days + '일</div>'
      + '<div class="ff-extra-grid">'
      + extraMetric('최근 5일 순매수', fmtSignedWon(p.net_5d))
      + extraMetric('최근 20일 순매수', fmtSignedWon(p.net_20d))
      + extraMetric('최근 60일 순매수', p.net_60d == null ? '-' : fmtSignedWon(p.net_60d))
      + extraMetric('누적(' + (p.cumulative_window_days || 0) + '영업일)', fmtSignedWon(p.net_cumulative))
      + '</div>'
      + '<div class="ff-extra-interp ff-extra-tone-' + escapeAttr(interp.tone) + '">'
      + '<span class="ff-extra-interp-label">' + escapeHtml(interp.label) + '</span>'
      + '<span class="ff-extra-interp-text">' + escapeHtml(interp.text) + '</span>'
      + '</div></div>';
  }

  function fmtAbsShares(v) { return v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString() + '주'; }
  function fmtWon(v) { return v == null || isNaN(v) ? '-' : Math.round(v).toLocaleString() + '원'; }
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
