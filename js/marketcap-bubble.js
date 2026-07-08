/**
 * 시가총액 버블차트 (코스피/코스닥/ETF/단일종목레버리지)
 * GAS 프록시(?bubble=1)를 45초 간격으로 폴링, 원(circle) 크기=시가총액 sqrt 스케일로
 * 4개 구역(코스피/코스닥/ETF/레버리지)에 나눠 표시한다. d3 등 외부 라이브러리 없이
 * 자체 원형 패킹 시뮬레이션(반발+중력 반복)만으로 배치한다.
 * data/marketcap-codes.js가 이 스크립트보다 먼저 로드되어야 한다(로컬 프리뷰 fallback용).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#marketcap-bubble';
  var REFRESH_MS = 45 * 1000;
  var FETCH_TIMEOUT_MS = 8000;

  var CATEGORY_LABELS = { KOSPI: '코스피', KOSDAQ: '코스닥', ETF: 'ETF', LEV: '단일종목 레버리지' };
  var CATEGORY_ORDER = ['KOSPI', 'KOSDAQ', 'ETF', 'LEV'];

  var VIEW_W = 760;
  var VIEW_H = 520;
  var PAD = 8;
  var CELL_W = VIEW_W / 2;
  var CELL_H = VIEW_H / 2;
  var TITLE_H = 24;

  var MIN_R = 15;
  var MAX_R = 78;

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  function fetchBubbleData() {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(GAS_TICKER_URL + '?bubble=1', hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ---------- 원형 패킹(간이 시뮬레이션: 반발 + 중력) ----------
  // nodes: [{r, ...}] r만 있으면 되고 x/y는 이 함수가 채운다. 중심(0,0) 기준 로컬 좌표로 배치.
  function packCircles(nodes, iterations) {
    if (!nodes.length) return;
    iterations = iterations || 220;

    // 초기 배치: 반지름 큰 순으로 나선형 배치(겹침 줄이기 위한 시작점)
    var sorted = nodes.slice().sort(function (a, b) { return b.r - a.r; });
    sorted.forEach(function (n, i) {
      var angle = i * 2.399963; // 황금각
      var radius = 3 * Math.sqrt(i);
      n.x = radius * Math.cos(angle);
      n.y = radius * Math.sin(angle);
    });

    for (var iter = 0; iter < iterations; iter++) {
      // 중심 인력(뭉치게)
      var gravity = 0.02;
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].x -= nodes[i].x * gravity * 0.05;
        nodes[i].y -= nodes[i].y * gravity * 0.05;
      }
      // 쌍별 반발(충돌 방지)
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var na = nodes[a], nb = nodes[b];
          var dx = nb.x - na.x;
          var dy = nb.y - na.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          var minDist = na.r + nb.r + 2;
          if (dist < minDist) {
            var overlap = (minDist - dist) / 2;
            var ux = dx / dist;
            var uy = dy / dist;
            na.x -= ux * overlap;
            na.y -= uy * overlap;
            nb.x += ux * overlap;
            nb.y += uy * overlap;
          }
        }
      }
    }
  }

  // 패킹 결과를 지정된 사각 영역(w x h) 안에 비율 유지한 채 맞춰 넣는다(중앙 정렬).
  function fitToBox(nodes, w, h, pad) {
    if (!nodes.length) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    var spanX = Math.max(maxX - minX, 1);
    var spanY = Math.max(maxY - minY, 1);
    var availW = w - pad * 2;
    var availH = h - pad * 2;
    var scale = Math.min(availW / spanX, availH / spanY, 1);

    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    nodes.forEach(function (n) {
      n.x = (n.x - cx) * scale + w / 2;
      n.y = (n.y - cy) * scale + h / 2;
      n.r = n.r * scale;
    });
  }

  function directionClass(rate) {
    if (rate > 0) return 'mcb-up';
    if (rate < 0) return 'mcb-down';
    return 'mcb-flat';
  }

  function formatCap(cap) {
    var jo = cap / 1e12;
    if (jo >= 1) return jo.toFixed(jo >= 100 ? 0 : 1) + '조';
    return (cap / 1e8).toFixed(0) + '억';
  }

  function radiusScale(cap, maxCap) {
    var t = Math.sqrt(Math.max(cap, 0)) / Math.sqrt(maxCap || 1);
    return MIN_R + t * (MAX_R - MIN_R);
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    }
    return el;
  }

  function buildLayout(data) {
    var maxCap = 0;
    CATEGORY_ORDER.forEach(function (cat) {
      (data[cat] || []).forEach(function (it) { maxCap = Math.max(maxCap, it.cap || 0); });
    });

    var cellPositions = [
      { x: 0, y: 0 }, { x: CELL_W, y: 0 },
      { x: 0, y: CELL_H }, { x: CELL_W, y: CELL_H }
    ];

    var groups = [];
    CATEGORY_ORDER.forEach(function (cat, idx) {
      var items = (data[cat] || []).map(function (it) {
        return {
          name: it.name,
          cap: it.cap,
          changeRate: it.changeRate,
          breakdown: it.breakdown,
          r: radiusScale(it.cap, maxCap)
        };
      });
      packCircles(items);
      fitToBox(items, CELL_W, CELL_H - TITLE_H, PAD);
      items.forEach(function (n) { n.y += TITLE_H; });

      groups.push({
        key: cat,
        label: CATEGORY_LABELS[cat] || cat,
        ox: cellPositions[idx].x,
        oy: cellPositions[idx].y,
        items: items
      });
    });

    return groups;
  }

  function render(container, groups, updatedAt) {
    var svg = container.querySelector('svg.mcb-svg');
    var isFirstRender = !svg;

    if (isFirstRender) {
      container.innerHTML =
        '<div class="mcb-head">' +
          '<div class="mcb-legend">' +
            '<span class="mcb-legend-item"><i class="mcb-dot mcb-up"></i>상승</span>' +
            '<span class="mcb-legend-item"><i class="mcb-dot mcb-down"></i>하락</span>' +
          '</div>' +
          '<div class="mcb-updated"></div>' +
        '</div>' +
        '<div class="mcb-canvas"></div>' +
        '<div class="mcb-tooltip" hidden></div>';
      svg = svgEl('svg', { class: 'mcb-svg', viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H });
      container.querySelector('.mcb-canvas').appendChild(svg);
    }

    container.querySelector('.mcb-updated').textContent = updatedAt ? updatedAt + ' 기준 (준실시간)' : '';

    var tooltip = container.querySelector('.mcb-tooltip');
    function hideTooltip() { tooltip.hidden = true; }
    function showTooltip(evt, item) {
      var rateTxt = (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(2) + '%';
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + item.name + '</div>' +
        '<div class="mcb-tt-cap">시가총액 ' + formatCap(item.cap) + '</div>' +
        '<div class="mcb-tt-rate ' + directionClass(item.changeRate) + '">' + rateTxt + '</div>' +
        (item.breakdown ? '<div class="mcb-tt-breakdown">' + item.breakdown + '</div>' : '');
      tooltip.hidden = false;

      var canvasRect = container.querySelector('.mcb-canvas').getBoundingClientRect();
      var scale = canvasRect.width / VIEW_W;
      var left = (item._gx) * scale;
      var top = (item._gy) * scale;
      tooltip.style.left = Math.min(left, canvasRect.width - 160) + 'px';
      tooltip.style.top = Math.max(top - 70, 0) + 'px';
    }

    // 그룹 <g> 재사용(없으면 생성) - 카테고리별로 고정된 순서라 매번 재생성하지 않아도 됨
    groups.forEach(function (group) {
      var g = svg.querySelector('g[data-cat="' + group.key + '"]');
      if (!g) {
        g = svgEl('g', { 'data-cat': group.key, transform: 'translate(' + group.ox + ',' + group.oy + ')' });
        var title = svgEl('text', { class: 'mcb-cat-title', x: 4, y: 16 });
        title.textContent = group.label;
        g.appendChild(title);
        g.appendChild(svgEl('g', { class: 'mcb-bubbles' }));
        svg.appendChild(g);
      }

      var bubbleLayer = g.querySelector('.mcb-bubbles');
      var existing = {};
      Array.prototype.forEach.call(bubbleLayer.querySelectorAll('.mcb-node'), function (node) {
        existing[node.getAttribute('data-name')] = node;
      });

      var seen = {};
      group.items.forEach(function (item) {
        item._gx = group.ox + item.x;
        item._gy = group.oy + item.y;
        seen[item.name] = true;

        var node = existing[item.name];
        if (!node) {
          node = svgEl('g', { class: 'mcb-node', 'data-name': item.name });
          var circle = svgEl('circle', { class: 'mcb-circle' });
          var label = svgEl('text', { class: 'mcb-label' });
          var rateLabel = svgEl('text', { class: 'mcb-rate-label' });
          node.appendChild(circle);
          node.appendChild(label);
          node.appendChild(rateLabel);
          bubbleLayer.appendChild(node);

          node.addEventListener('click', function (evt) {
            evt.stopPropagation();
            showTooltip(evt, item);
          });
        }

        var circleEl = node.querySelector('.mcb-circle');
        circleEl.setAttribute('cx', item.x);
        circleEl.setAttribute('cy', item.y);
        circleEl.setAttribute('r', item.r);
        circleEl.setAttribute('class', 'mcb-circle ' + directionClass(item.changeRate));

        var labelEl = node.querySelector('.mcb-label');
        labelEl.setAttribute('x', item.x);
        labelEl.setAttribute('y', item.y - (item.r > 26 ? 2 : -3));
        labelEl.style.display = item.r >= 20 ? '' : 'none';
        labelEl.textContent = shortenName(item.name, item.r);

        var rateEl = node.querySelector('.mcb-rate-label');
        rateEl.setAttribute('x', item.x);
        rateEl.setAttribute('y', item.y + 14);
        rateEl.setAttribute('class', 'mcb-rate-label ' + directionClass(item.changeRate));
        rateEl.style.display = item.r >= 26 ? '' : 'none';
        rateEl.textContent = (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(1) + '%';
      });

      // 사라진 종목(리스트 변경 시) 제거
      Object.keys(existing).forEach(function (name) {
        if (!seen[name]) existing[name].remove();
      });
    });

    if (!container.__mcbClickBound) {
      container.addEventListener('click', hideTooltip);
      container.__mcbClickBound = true;
    }
  }

  function shortenName(name, r) {
    var maxChars = Math.max(2, Math.floor(r / 7));
    return name.length > maxChars ? name.slice(0, maxChars) + '…' : name;
  }

  function renderError(container, message) {
    if (container.querySelector('svg.mcb-svg')) return; // 이미 렌더된 상태면 마지막 성공 화면 유지
    container.innerHTML = '<div class="mcb-error">' + message + '</div>';
  }

  function tick(container) {
    MarketcapBubble.fetchBubbleData()
      .then(function (json) {
        if (!json || !json.data) throw new Error('empty bubble data');
        var groups = buildLayout(json.data);
        render(container, groups, json.updatedAt);
      })
      .catch(function (err) {
        logError('[marketcap-bubble] 조회 실패', err);
        renderError(container, '시가총액 데이터를 불러오지 못했습니다.');
      });
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    tick(container);
    setInterval(function () {
      if (document.hidden) return;
      tick(container);
    }, REFRESH_MS);
  }

  var MarketcapBubble = {
    init: init,
    fetchBubbleData: fetchBubbleData,
    buildLayout: buildLayout,
    render: render
  };
  global.MarketcapBubble = MarketcapBubble;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
