/**
 * 글 내 티커 자동 툴팁 (1단계 MVP)
 * 본문의 $삼성전자, $005930 같은 표기를 감지해 등락 뱃지 + 호버/탭 툴팁을 붙인다.
 * 의존성 없음 (vanilla JS). GAS 프록시 → 네이버 금융 polling API 중계 패턴 사용.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';

  // .post-single-body: 퍼머링크(글 상세) 본문, .post-excerpt: 메인/목록 화면 요약
  var CONTENT_SELECTORS = ['.post-single-body', '.post-excerpt', '.entry-content', '.article_view'];
  var TICKER_REGEX = /\$([가-힣A-Za-z0-9]{1,20})/g;
  var FETCH_TIMEOUT_MS = 3000;
  var SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
  var HOVER_DELAY_MS = 200;
  var NAVER_ITEM_URL = 'https://finance.naver.com/item/main.naver?code=';

  var state = {
    krxMap: {},
    openTooltip: null,
    openBadge: null,
    closeTimer: null
  };

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  // ---- 데이터 로딩 (테스트에서 override 가능하도록 TickerTooltip 객체 메서드로 호출) ----

  // data/krx_map.js가 ticker-tooltip.js보다 먼저 <script>로 로드되어
  // window.KRX_MAP에 종목명->코드 매핑을 심어둔다는 전제.
  function loadKrxMap() {
    return Promise.resolve(global.KRX_MAP || {});
  }

  function fetchTickerData(codes) {
    if (!GAS_TICKER_URL) {
      return Promise.reject(new Error('GAS_TICKER_URL이 설정되지 않았습니다'));
    }
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

  // ---- sessionStorage 캐시 (5분) ----

  function getCached(code) {
    try {
      var raw = sessionStorage.getItem('ticker_cache_' + code);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || (Date.now() - obj.ts) > SESSION_CACHE_TTL_MS) return null;
      return obj.data;
    } catch (err) {
      return null;
    }
  }

  function setCached(code, data) {
    try {
      sessionStorage.setItem('ticker_cache_' + code, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (err) {
      // sessionStorage quota/불가 환경 - 무시
    }
  }

  // ---- 본문 파싱 ----

  // 메인/목록 화면에는 카드마다 .post-excerpt가 여러 개 있을 수 있으므로
  // 셀렉터별로 전체(querySelectorAll)를 모아 반환한다.
  function findContentRoots() {
    var roots = [];
    CONTENT_SELECTORS.forEach(function (selector) {
      var found = document.querySelectorAll(selector);
      for (var i = 0; i < found.length; i++) {
        if (roots.indexOf(found[i]) === -1) roots.push(found[i]);
      }
    });
    return roots;
  }

  function isExcludedNode(textNode) {
    var el = textNode.parentElement;
    while (el) {
      var tag = el.tagName;
      if (tag === 'PRE' || tag === 'CODE' || tag === 'A' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function resolveCode(raw) {
    if (/^\d{6}$/.test(raw)) return raw;
    if (Object.prototype.hasOwnProperty.call(state.krxMap, raw)) return state.krxMap[raw];
    return null;
  }

  // root 내 텍스트 노드를 순회하며 { node, items:[{start,end,raw,code}] } 목록을 만든다.
  // (pre/code/a 내부는 건드리지 않음)
  function collectMatches(root) {
    var matches = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || node.nodeValue.indexOf('$') === -1) continue;
      if (isExcludedNode(node)) continue;

      var text = node.nodeValue;
      var re = new RegExp(TICKER_REGEX.source, 'g');
      var m;
      var items = [];
      while ((m = re.exec(text))) {
        var code = resolveCode(m[1]);
        if (!code) continue; // 매핑에 없는 종목명 -> 원문 유지, 스킵
        items.push({ start: m.index, end: m.index + m[0].length, raw: m[1], code: code });
      }
      if (items.length) matches.push({ node: node, items: items });
    }
    return matches;
  }

  function applyReplacements(matches, dataMap) {
    matches.forEach(function (entry) {
      var node = entry.node;
      // 고정 공지처럼 뒤늦게 삽입된 콘텐츠가 init()을 다시 호출하면, 먼저 끝난 스캔이 이미
      // 치환해 DOM에서 떼어낸(parentNode === null) 텍스트 노드가 이 배열에 남아있을 수 있다.
      if (!node.parentNode) return;
      var text = node.nodeValue;
      var frag = document.createDocumentFragment();
      var cursor = 0;

      entry.items.forEach(function (item) {
        if (item.start > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, item.start)));
        }
        var data = dataMap[item.code];
        if (data) {
          frag.appendChild(createBadge(data));
        } else {
          // GAS 응답에 없던 종목(실패/미발견) -> 원문 그대로
          frag.appendChild(document.createTextNode(text.slice(item.start, item.end)));
        }
        cursor = item.end;
      });

      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }

      node.parentNode.replaceChild(frag, node);
    });
  }

  // ---- 뱃지 / 툴팁 렌더링 ----

  function directionClass(change) {
    if (change > 0) return 'ticker-up';
    if (change < 0) return 'ticker-down';
    return 'ticker-flat';
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

  // ---- 언급 종목 요약 박스 (3단계) ----
  // 퍼머링크 본문(.post-single-body)에서만 표시. 목록 화면은 카드가 여러 개라 노이즈가 큼.

  function buildMentionedBox(items) {
    var box = document.createElement('div');
    box.className = 'ticker-mentioned-box';

    var title = document.createElement('div');
    title.className = 'ticker-mentioned-title';
    title.textContent = '이 글에서 언급된 종목';
    box.appendChild(title);

    var list = document.createElement('div');
    list.className = 'ticker-mentioned-list';
    items.forEach(function (data) {
      list.appendChild(createBadge(data));
    });
    box.appendChild(list);

    return box;
  }

  function renderMentionedBoxes(rootMatches, dataMap) {
    rootMatches.forEach(function (rm) {
      if (!rm.root.classList || !rm.root.classList.contains('post-single-body')) return;

      var codes = [];
      rm.matches.forEach(function (entry) {
        entry.items.forEach(function (item) {
          if (codes.indexOf(item.code) === -1) codes.push(item.code);
        });
      });

      var items = codes.map(function (c) { return dataMap[c]; }).filter(Boolean);
      if (!items.length) return;

      rm.root.insertBefore(buildMentionedBox(items), rm.root.firstChild);
    });
  }

  function createBadge(data) {
    var span = document.createElement('span');
    span.className = 'ticker-badge ' + directionClass(data.change);
    span.setAttribute('data-code', data.code);
    span.setAttribute('tabindex', '0');
    span.textContent = data.name + ' ' + arrowSymbol(data.change) + Math.abs(data.changeRate).toFixed(2) + '%';
    attachTooltipHandlers(span, data);
    return span;
  }

  // 네이버 금융 차트 이미지 (PNG, API 키 불필요). sidcode는 캐시 버스터 - 장중에 옛 차트가
  // 브라우저 캐시로 박제되지 않게 툴팁을 열 때마다 새로 받는다.
  // area/day = 당일 시세 흐름, candle/{day|week|month} = 일봉/주봉/월봉 캔들차트.
  var NAVER_CHART_URL = 'https://ssl.pstatic.net/imgfinance/chart/item/';

  function chartImgSrc(path, code) {
    return NAVER_CHART_URL + path + '/' + encodeURIComponent(code) + '.png?sidcode=' + Date.now();
  }

  function buildTooltip(data) {
    var box = document.createElement('div');
    box.className = 'ticker-tooltip';
    box.innerHTML =
      '<div class="ticker-tooltip-title">' + escapeHTML(data.name) + ' (' + escapeHTML(data.code) + ')</div>' +
      '<div class="ticker-tooltip-row"><span class="ticker-tooltip-label">현재가</span>' +
        '<span class="ticker-tooltip-value">' + formatNumber(data.price) + '원</span></div>' +
      '<div class="ticker-tooltip-row"><span class="ticker-tooltip-label">등락률</span>' +
        '<span class="ticker-tooltip-value ' + directionClass(data.change) + '">' +
          arrowSymbol(data.change) + Math.abs(data.changeRate).toFixed(2) + '%</span></div>' +
      '<div class="ticker-tooltip-row"><span class="ticker-tooltip-label">거래량</span>' +
        '<span class="ticker-tooltip-value">' + formatNumber(data.volume) + '주</span></div>' +
      '<div class="ticker-tooltip-row"><span class="ticker-tooltip-label">기준시각</span>' +
        '<span class="ticker-tooltip-value">' + escapeHTML(data.time) + '</span></div>' +
      '<div class="ticker-tooltip-chart">' +
        '<div class="ticker-chart-tabs">' +
          '<button type="button" class="ticker-chart-tab active" data-period="area/day">당일</button>' +
          '<button type="button" class="ticker-chart-tab" data-period="candle/day">일봉</button>' +
          '<button type="button" class="ticker-chart-tab" data-period="candle/week">주봉</button>' +
          '<button type="button" class="ticker-chart-tab" data-period="candle/month">월봉</button>' +
        '</div>' +
        // loading="lazy" 금지: 툴팁은 열 때만 생성되는데, 높이 0인 미로드 이미지를 브라우저가
        // 뷰포트 밖으로 판단해 로드를 아예 안 하는 경우가 있음(로컬 실측)
        '<img class="ticker-chart-img" alt="' + escapeHTML(data.name) + ' 차트" ' +
          'src="' + chartImgSrc('area/day', data.code) + '" />' +
      '</div>' +
      '<a class="ticker-tooltip-link" href="' + NAVER_ITEM_URL + encodeURIComponent(data.code) + '" ' +
        'target="_blank" rel="noopener noreferrer">네이버 금융에서 보기 ↗</a>';

    // 일/주/월 탭 전환 (탭 클릭은 툴팁 내부라 document의 바깥클릭 닫기에 안 걸림)
    var img = box.querySelector('.ticker-chart-img');
    var tabs = box.querySelectorAll('.ticker-chart-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        img.src = chartImgSrc(tab.getAttribute('data-period'), data.code);
      });
    });

    // 차트 이미지를 못 받으면(네이버 쪽 오류 등) 차트 영역만 조용히 숨김
    img.addEventListener('error', function () {
      var chartBox = box.querySelector('.ticker-tooltip-chart');
      if (chartBox) chartBox.style.display = 'none';
    });

    return box;
  }

  function positionTooltip(tooltip, badge) {
    var rect = badge.getBoundingClientRect();
    var ttRect = tooltip.getBoundingClientRect();
    var margin = 8;

    var top = rect.bottom + margin;
    if (top + ttRect.height > window.innerHeight) {
      top = rect.top - ttRect.height - margin;
    }
    if (top < margin) top = margin;

    var left = rect.left;
    var maxLeft = window.innerWidth - ttRect.width - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);
    if (left < margin) left = margin;

    tooltip.style.top = (top + window.scrollY) + 'px';
    tooltip.style.left = (left + window.scrollX) + 'px';
  }

  function closeOpenTooltip() {
    clearTimeout(state.closeTimer);
    if (state.openTooltip) {
      state.openTooltip.remove();
      state.openTooltip = null;
    }
    if (state.openBadge) {
      state.openBadge.classList.remove('ticker-badge-active');
      state.openBadge = null;
    }
  }

  // 뱃지 -> 툴팁으로 마우스를 옮기는 사이(둘 사이 여백)에 mouseleave가 먼저 발생해도
  // 바로 닫지 않고 유예를 준다. 유예 안에 툴팁으로 들어오면 cancelScheduledClose가 취소한다.
  function scheduleClose() {
    clearTimeout(state.closeTimer);
    state.closeTimer = setTimeout(closeOpenTooltip, HOVER_DELAY_MS);
  }

  function cancelScheduledClose() {
    clearTimeout(state.closeTimer);
  }

  function openTooltipFor(badge, data) {
    cancelScheduledClose();
    if (state.openBadge === badge) return;
    closeOpenTooltip();
    var tooltip = buildTooltip(data);
    tooltip.addEventListener('mouseenter', cancelScheduledClose);
    tooltip.addEventListener('mouseleave', scheduleClose);
    document.body.appendChild(tooltip);
    positionTooltip(tooltip, badge);
    badge.classList.add('ticker-badge-active');
    state.openTooltip = tooltip;
    state.openBadge = badge;
  }

  // 기기 판별(matchMedia hover/pointer)에 기대지 않고, 호버(지연 오픈)와 클릭(즉시 토글)을
  // 항상 같이 붙인다 - PC에서는 호버로, 터치기기에서는 탭(click)으로 자연스럽게 동작한다.
  function attachTooltipHandlers(badge, data) {
    var hoverTimer = null;

    badge.addEventListener('mouseenter', function () {
      cancelScheduledClose();
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () { openTooltipFor(badge, data); }, HOVER_DELAY_MS);
    });

    badge.addEventListener('mouseleave', function () {
      clearTimeout(hoverTimer);
      if (state.openBadge === badge) scheduleClose();
    });

    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      clearTimeout(hoverTimer);
      if (state.openBadge === badge) {
        closeOpenTooltip();
      } else {
        openTooltipFor(badge, data);
      }
    });
  }

  document.addEventListener('click', function (e) {
    if (state.openTooltip && state.openBadge &&
        !state.openBadge.contains(e.target) && !state.openTooltip.contains(e.target)) {
      closeOpenTooltip();
    }
  });

  // iOS 사파리는 :hover 스타일이 걸린 요소를 "첫 탭=호버, 두번째 탭=클릭"으로 처리해서
  // 툴팁 안 링크가 한 번에 안 눌리는 문제가 있다. 빈 touchstart 리스너를 등록해두면
  // 이 두 번 탭 요구가 사라지는 표준 우회법이다.
  document.addEventListener('touchstart', function () {}, { passive: true });

  // ---- 초기화 ----

  function init() {
    var roots = findContentRoots();
    if (!roots.length) return;

    TickerTooltip.loadKrxMap().then(function (map) {
      state.krxMap = map || {};

      var rootMatches = roots.map(function (root) {
        return { root: root, matches: collectMatches(root) };
      });
      var matches = rootMatches.reduce(function (acc, rm) {
        return acc.concat(rm.matches);
      }, []);
      if (!matches.length) return;

      var uniqueCodes = [];
      matches.forEach(function (entry) {
        entry.items.forEach(function (item) {
          if (uniqueCodes.indexOf(item.code) === -1) uniqueCodes.push(item.code);
        });
      });

      var dataMap = {};
      var codesToFetch = [];
      uniqueCodes.forEach(function (code) {
        var cached = getCached(code);
        if (cached) dataMap[code] = cached;
        else codesToFetch.push(code);
      });

      if (!codesToFetch.length) {
        applyReplacements(matches, dataMap);
        renderMentionedBoxes(rootMatches, dataMap);
        return;
      }

      TickerTooltip.fetchTickerData(codesToFetch)
        .then(function (list) {
          (list || []).forEach(function (item) {
            if (!item || !item.code) return;
            dataMap[item.code] = item;
            setCached(item.code, item);
          });
          applyReplacements(matches, dataMap);
          renderMentionedBoxes(rootMatches, dataMap);
        })
        .catch(function (err) {
          logError('[ticker-tooltip] 시세 조회 실패', err);
          // 실패해도 캐시로 확보된 종목만 반영, 나머지는 원문 유지
          applyReplacements(matches, dataMap);
          renderMentionedBoxes(rootMatches, dataMap);
        });
    });
  }

  var TickerTooltip = {
    init: init,
    loadKrxMap: loadKrxMap,
    fetchTickerData: fetchTickerData,
    config: { GAS_TICKER_URL: GAS_TICKER_URL }
  };
  global.TickerTooltip = TickerTooltip;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
