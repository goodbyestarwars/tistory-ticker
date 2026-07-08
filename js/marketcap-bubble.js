/**
 * 시가총액 버블차트 (코스피/코스닥/ETF/단일종목레버리지)
 * GAS 프록시(?bubble=1)를 45초 간격으로 폴링. 2단계 원형 패킹(종목 -> 카테고리
 * 클러스터 -> 전체)으로 카테고리별 구역이 자연스럽게 뭉치도록 배치하고, 각 구역
 * 위에 이름표를 붙여 코스피/코스닥/ETF/단일종목 레버리지를 구분한다.
 * 채우기 색은 카테고리가 아니라 등락(상승 빨강/하락 파랑 - 사이트 공통 컬러)의
 * 유리(글라스모피즘) 효과로 표현한다. d3 등 외부 라이브러리 없이 vanilla JS로 구현.
 * data/marketcap-codes.js가 이 스크립트보다 먼저 로드되어야 한다(로컬 프리뷰 fallback용).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#marketcap-bubble';
  var REFRESH_MS = 45 * 1000;
  var FETCH_TIMEOUT_MS = 8000;

  var CATEGORY_ORDER = ['KOSPI', 'KOSDAQ', 'ETF', 'LEV'];
  var CATEGORY_LABELS = { KOSPI: '코스피', KOSDAQ: '코스닥', ETF: 'ETF', LEV: '단일종목 레버리지' };

  var VIEW_W = 820;
  var VIEW_H = 560;
  var PAD = 10;

  var MIN_R = 11;
  var MAX_R = 150;

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
  function packCircles(nodes, iterations, gravityX, gravityY, gap) {
    if (!nodes.length) return;
    iterations = iterations || 240;
    gravityX = gravityX == null ? 0.03 : gravityX;
    gravityY = gravityY == null ? gravityX : gravityY;
    gap = gap == null ? 2 : gap;

    var sorted = nodes.slice().sort(function (a, b) { return b.r - a.r; });
    sorted.forEach(function (n, i) {
      var angle = i * 2.399963; // 황금각
      var radius = 3 * Math.sqrt(i);
      n.x = radius * Math.cos(angle);
      n.y = radius * Math.sin(angle);
    });

    function repel() {
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var na = nodes[a], nb = nodes[b];
          var dx = nb.x - na.x;
          var dy = nb.y - na.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          var minDist = na.r + nb.r + gap;
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

    for (var iter = 0; iter < iterations; iter++) {
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].x -= nodes[i].x * gravityX;
        nodes[i].y -= nodes[i].y * gravityY;
      }
      repel();
    }
    // 중력 스텝 없이 반발만 추가로 돌려 잔여 겹침을 완전히 해소한다(겹침 0 보장).
    for (var cleanup = 0; cleanup < 80; cleanup++) repel();
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

  // 유리(글라스모피즘) 효과용 - 좌상단에 밝은 하이라이트가 도는 방사형 그라디언트를
  // 한 번만 정의해두고 모든 버블의 하이라이트 원(mcb-shine)이 재사용한다.
  function buildGlassDefs() {
    var defs = svgEl('defs');
    var grad = svgEl('radialGradient', { id: 'mcb-shine-grad', cx: '35%', cy: '28%', r: '65%' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.85' }));
    grad.appendChild(svgEl('stop', { offset: '55%', 'stop-color': '#ffffff', 'stop-opacity': '0.18' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' }));
    defs.appendChild(grad);
    return defs;
  }

  // 2단계 패킹: 1) 카테고리 안에서 종목끼리 패킹 -> 그 클러스터의 외접원 반지름 산출
  // 2) 4개 클러스터(외접원 크기가 제각각)를 다시 패킹 -> 큰 카테고리(코스피)는 넓게,
  //    작은 카테고리(레버리지)는 주변부에 자연스럽게 밀려나는 유기적 배치가 나온다.
  function buildLayout(data) {
    var maxCap = 0;
    CATEGORY_ORDER.forEach(function (cat) {
      (data[cat] || []).forEach(function (it) { maxCap = Math.max(maxCap, it.cap || 0); });
    });

    var clusters = CATEGORY_ORDER.map(function (cat) {
      var items = (data[cat] || []).map(function (it) {
        return {
          name: it.name,
          cap: it.cap,
          changeRate: it.changeRate,
          breakdown: it.breakdown,
          category: cat,
          r: radiusScale(it.cap, maxCap)
        };
      });
      packCircles(items);

      var enclosingR = 10;
      items.forEach(function (n) {
        enclosingR = Math.max(enclosingR, Math.sqrt(n.x * n.x + n.y * n.y) + n.r);
      });

      return { key: cat, items: items, r: enclosingR };
    }).filter(function (cl) { return cl.items.length; });

    // y축 중력을 x축보다 세게 걸어 클러스터가 세로로 쌓이기보다 가로로 넓게 퍼지도록 유도
    // (블로그 임베드는 세로로 긴 것보다 가로로 넓은 게 한눈에 다 보임 - 사용자 요청).
    // 구역 사이 간격을 넉넉히 둬야(gap) 위에 붙는 이름표끼리 겹치지 않는다 -
    // 종목끼리(gap 기본값 2)보다 훨씬 크게 잡는다.
    packCircles(clusters, 320, 0.035, 0.11, 46);

    var allNodes = [];
    clusters.forEach(function (cl) {
      cl.items.forEach(function (n) {
        allNodes.push({
          name: n.name,
          cap: n.cap,
          changeRate: n.changeRate,
          breakdown: n.breakdown,
          category: n.category,
          r: n.r,
          x: cl.x + n.x,
          y: cl.y + n.y
        });
      });
    });

    // 실제로 뭉친 모양의 가로세로 비율에 맞춰 캔버스 높이를 정한다(고정 비율로 맞추면
    // 데이터에 따라 위아래/양옆에 빈 공간이 크게 남을 수 있어서 - 매번 꽉 채우도록 계산).
    var viewH = computeFitHeight(allNodes, VIEW_W);
    fitToBox(allNodes, VIEW_W, viewH, PAD + 16); // 이름표 들어갈 자리만큼 여유를 더 둠

    // 구역 이름표 위치는 클러스터의 "외접원" 기준이 아니라 실제 종목들이 fitToBox를
    // 거친 뒤의 진짜 바운딩 박스(제일 위에 있는 버블의 꼭대기) 기준으로 잡는다.
    // 패킹된 모양은 원이 아니라 울퉁불퉁한 덩어리라서 외접원 반지름을 쓰면 실제
    // 버블 뭉치보다 훨씬 위로 이름표가 붕 뜨는 문제가 있었다.
    var clusterLabels = CATEGORY_ORDER.map(function (cat) {
      var items = allNodes.filter(function (n) { return n.category === cat; });
      if (!items.length) return null;
      var minY = Infinity, minX = Infinity, maxX = -Infinity, totalCap = 0;
      items.forEach(function (n) {
        minY = Math.min(minY, n.y - n.r);
        minX = Math.min(minX, n.x - n.r);
        maxX = Math.max(maxX, n.x + n.r);
        totalCap += n.cap || 0;
      });
      return {
        key: cat,
        label: CATEGORY_LABELS[cat] || cat,
        x: (minX + maxX) / 2,
        y: Math.max(minY - 8, 14),
        totalCap: totalCap
      };
    }).filter(Boolean);

    return { nodes: allNodes, viewH: viewH, clusterLabels: clusterLabels };
  }

  function computeFitHeight(nodes, viewW) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    // viewBox 단위는 화면 픽셀이 아니라 비율 좌표계라서 절대 높이로 clamp하면 의미가 없다
    // (실제 표시 높이는 컨테이너 실width / aspect로 정해짐) - 가로세로 비율만 landscape로 제한.
    // clamp을 좁게 걸면 content 자연 비율과 어긋나 한쪽 축에 빈 공간이 남으므로,
    // 극단적인 경우만 막는 넉넉한 범위로 둔다(대부분의 실제 데이터는 이 안에서 꽉 찬다).
    var aspect = (maxX - minX) / Math.max(maxY - minY, 1);
    aspect = Math.min(Math.max(aspect, 0.55), 2.6);
    return Math.round(viewW / aspect);
  }

  function buildLegendHtml(data) {
    // 카테고리 구분은 이제 캔버스 위 구역 이름표로 하므로, 범례는 등락 색상 의미만 안내.
    return '<span class="mcb-legend-item"><i class="mcb-dot mcb-up"></i>상승</span>' +
      '<span class="mcb-legend-item"><i class="mcb-dot mcb-down"></i>하락</span>';
  }

  function render(container, nodes, viewH, updatedAt, legendHtml, clusterLabels) {
    var svg = container.querySelector('svg.mcb-svg');
    var isFirstRender = !svg;

    if (isFirstRender) {
      // 툴팁은 .mcb-canvas(position:relative) 기준으로 좌표를 계산하므로
      // 반드시 그 안의 자식이어야 한다 - 형제로 두면 더 위쪽 조상 엘리먼트를
      // 기준으로 absolute 배치가 틀어져 엉뚱한 위치(페이지 상단 등)에 뜬다.
      container.innerHTML =
        '<div class="mcb-canvas"><div class="mcb-tooltip" hidden></div></div>' +
        '<div class="mcb-legend"></div>' +
        '<div class="mcb-updated"></div>';
      svg = svgEl('svg', { class: 'mcb-svg', viewBox: '0 0 ' + VIEW_W + ' ' + viewH });
      svg.appendChild(buildGlassDefs());
      svg.appendChild(svgEl('g', { class: 'mcb-bubbles' }));
      svg.appendChild(svgEl('g', { class: 'mcb-cluster-labels' }));
      container.querySelector('.mcb-canvas').insertBefore(svg, container.querySelector('.mcb-tooltip'));
    } else {
      svg.setAttribute('viewBox', '0 0 ' + VIEW_W + ' ' + viewH);
    }

    container.querySelector('.mcb-updated').textContent = updatedAt ? updatedAt + ' 기준 (준실시간)' : '';
    container.querySelector('.mcb-legend').innerHTML = legendHtml;

    var tooltip = container.querySelector('.mcb-tooltip');
    function hideTooltip() { tooltip.hidden = true; }
    function showTooltip(item) {
      var rateTxt = (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(2) + '%';
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + item.name + '</div>' +
        '<div class="mcb-tt-cap">시가총액 ' + formatCap(item.cap) + '</div>' +
        '<div class="mcb-tt-rate ' + directionClass(item.changeRate) + '">' + rateTxt + '</div>' +
        (item.breakdown ? '<div class="mcb-tt-breakdown">' + item.breakdown + '</div>' : '');
      tooltip.hidden = false;

      var canvasRect = container.querySelector('.mcb-canvas').getBoundingClientRect();
      var scale = canvasRect.width / VIEW_W;
      var left = item.x * scale;
      var top = item.y * scale;
      tooltip.style.left = Math.min(left, canvasRect.width - 160) + 'px';
      tooltip.style.top = Math.max(top - 70, 0) + 'px';
    }

    function showZoneTooltip(cl) {
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + cl.label + '</div>' +
        '<div class="mcb-tt-cap">전체 시가총액 ' + formatCap(cl.totalCap) + '</div>';
      tooltip.hidden = false;

      var canvasRect = container.querySelector('.mcb-canvas').getBoundingClientRect();
      var scale = canvasRect.width / VIEW_W;
      var left = cl.x * scale;
      var top = cl.y * scale;
      tooltip.style.left = Math.min(left, canvasRect.width - 160) + 'px';
      tooltip.style.top = Math.max(top - 10, 0) + 'px';
    }

    // 구역 이름표(코스피/코스닥/ETF/단일종목 레버리지) - 4개뿐이라 diff 없이 매번 새로 그리고,
    // 마우스를 올리면 그 구역 종목들의 시가총액 합계를 툴팁으로 보여준다.
    var labelLayer = svg.querySelector('.mcb-cluster-labels');
    labelLayer.innerHTML = '';
    (clusterLabels || []).forEach(function (cl) {
      var t = svgEl('text', { class: 'mcb-zone-label', x: cl.x, y: cl.y });
      t.textContent = cl.label;
      t.addEventListener('mouseenter', function (evt) { evt.stopPropagation(); showZoneTooltip(cl); });
      t.addEventListener('mouseleave', hideTooltip);
      t.addEventListener('click', function (evt) { evt.stopPropagation(); showZoneTooltip(cl); });
      labelLayer.appendChild(t);
    });

    var bubbleLayer = svg.querySelector('.mcb-bubbles');
    var existing = {};
    Array.prototype.forEach.call(bubbleLayer.querySelectorAll('.mcb-node'), function (node) {
      existing[node.getAttribute('data-name')] = node;
    });

    var seen = {};
    // 큰 원이 작은 원을 가리지 않도록 반지름 큰 순으로 먼저 그린다.
    nodes.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (item) {
      seen[item.name] = true;

      var node = existing[item.name];
      if (!node) {
        node = svgEl('g', { class: 'mcb-node', 'data-name': item.name });
        node.appendChild(svgEl('circle', { class: 'mcb-circle' }));
        node.appendChild(svgEl('circle', { class: 'mcb-shine', fill: 'url(#mcb-shine-grad)' }));
        node.appendChild(svgEl('text', { class: 'mcb-label' }));
        node.appendChild(svgEl('text', { class: 'mcb-cap-label' }));
        node.appendChild(svgEl('text', { class: 'mcb-rate-label' }));
        bubbleLayer.appendChild(node);

        // item은 45초마다 새 객체로 다시 만들어지므로 클로저로 캡처하면 데이터가 갱신된
        // 뒤에도 최초 생성 시점 값을 계속 보여주게 된다 - node에 최신 item을 매번 붙여두고
        // 리스너는 그때그때 node.__mcbItem을 읽도록 한다.
        node.addEventListener('click', function (evt) {
          evt.stopPropagation();
          showTooltip(node.__mcbItem);
        });
        node.addEventListener('mouseenter', function () { showTooltip(node.__mcbItem); });
        node.addEventListener('mouseleave', hideTooltip);
      }
      node.__mcbItem = item;

      var dirClass = directionClass(item.changeRate);
      var big = item.r >= 60;
      var mid = item.r >= 26;
      var small = item.r >= 16;

      var circleEl = node.querySelector('.mcb-circle');
      circleEl.setAttribute('cx', item.x);
      circleEl.setAttribute('cy', item.y);
      circleEl.setAttribute('r', item.r);
      circleEl.setAttribute('class', 'mcb-circle ' + dirClass);

      // 유리 효과: 원 자체 크기의 하이라이트를 좌상단으로 살짝 치우쳐 얹어 광택 표현
      var shineEl = node.querySelector('.mcb-shine');
      shineEl.setAttribute('cx', item.x);
      shineEl.setAttribute('cy', item.y);
      shineEl.setAttribute('r', item.r);

      var labelEl = node.querySelector('.mcb-label');
      labelEl.setAttribute('x', item.x);
      labelEl.setAttribute('y', item.y + (big ? -item.r * 0.28 : (mid ? -3 : 3)));
      labelEl.style.display = small ? '' : 'none';
      labelEl.style.fontSize = (big ? 15 : (mid ? 12 : 10)) + 'px';
      labelEl.textContent = shortenName(item.name, item.r);

      var capEl = node.querySelector('.mcb-cap-label');
      capEl.setAttribute('x', item.x);
      capEl.setAttribute('y', item.y + (big ? item.r * 0.02 : 999));
      capEl.style.display = big ? '' : 'none';
      capEl.textContent = formatCap(item.cap);

      var rateEl = node.querySelector('.mcb-rate-label');
      rateEl.setAttribute('x', item.x);
      rateEl.setAttribute('y', item.y + (big ? item.r * 0.32 : 14));
      rateEl.setAttribute('class', 'mcb-rate-label ' + dirClass);
      rateEl.style.display = mid ? '' : 'none';
      rateEl.textContent = (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(1) + '%';
    });

    Object.keys(existing).forEach(function (name) {
      if (!seen[name]) existing[name].remove();
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
        var layout = buildLayout(json.data);
        var legendHtml = buildLegendHtml(json.data);
        render(container, layout.nodes, layout.viewH, json.updatedAt, legendHtml, layout.clusterLabels);
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
