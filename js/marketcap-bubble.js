/**
 * 시가총액 트리맵 (코스피/코스닥/ETF/단일종목레버리지)
 * GAS 프록시(?bubble=1)를 45초 간격으로 폴링. 스퀘어파이드(squarified) 트리맵으로
 * 큰 네모(전체) -> 중간 네모(코스피/코스닥/ETF/단일종목 레버리지, 시가총액 비율) ->
 * 소네모(구역 안 개별 종목, 시가총액 비율) 3단 구조로 배치한다.
 * 채우기 색은 등락(상승 빨강/하락 파랑 - 사이트 공통 컬러)의 유리(글라스모피즘)
 * 효과로 표현한다. d3 등 외부 라이브러리 없이 vanilla JS로 구현.
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

  var ZONE_GAP = 6;       // 구역(코스피/코스닥/ETF/레버리지) 사이 간격
  var ZONE_LABEL_H = 20;  // 구역 이름표가 차지하는 위쪽 띠 높이
  var CELL_GAP = 3;       // 구역 안 종목 셀 사이 간격
  var MIN_ZONE_H = 56;    // 구역이 아무리 작아도 보장하는 최소 높이(이름표+종목 한 줄 볼 공간)

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

  // ---------- 스퀘어파이드 트리맵 ----------
  // items: [{value, ...}] value는 이미 목표 영역(면적) 단위로 정규화되어 있어야 한다
  // (호출부에서 value = 실제값 / 합계 * 배치할 사각형 면적 로 스케일링).
  function squarify(items, x, y, w, h) {
    var rects = [];
    layout(items.slice(), x, y, w, h);
    return rects;

    function layout(kids, x, y, w, h) {
      if (!kids.length || w <= 0 || h <= 0) return;
      if (kids.length === 1) {
        rects.push({ item: kids[0], x: x, y: y, w: w, h: h });
        return;
      }

      var side = Math.min(w, h);
      var row = [kids[0]];
      var i = 1;
      while (i < kids.length) {
        var next = row.concat([kids[i]]);
        if (worstRatio(row, side) >= worstRatio(next, side)) {
          row = next;
          i++;
        } else {
          break;
        }
      }

      var rowSum = sum(row);
      if (w >= h) {
        var rowW = rowSum / h;
        var yy = y;
        row.forEach(function (k) {
          var kh = k.value / rowW;
          rects.push({ item: k, x: x, y: yy, w: rowW, h: kh });
          yy += kh;
        });
        layout(kids.slice(row.length), x + rowW, y, w - rowW, h);
      } else {
        var rowH = rowSum / w;
        var xx = x;
        row.forEach(function (k) {
          var kw = k.value / rowH;
          rects.push({ item: k, x: xx, y: y, w: kw, h: rowH });
          xx += kw;
        });
        layout(kids.slice(row.length), x, y + rowH, w, h - rowH);
      }
    }

    function sum(arr) { return arr.reduce(function (s, k) { return s + k.value; }, 0); }
    function worstRatio(row, side) {
      var rowSum = sum(row);
      if (rowSum <= 0) return Infinity;
      var values = row.map(function (k) { return k.value; });
      var maxV = Math.max.apply(null, values);
      var minV = Math.min.apply(null, values);
      if (minV <= 0) return Infinity;
      return Math.max((side * side * maxV) / (rowSum * rowSum), (rowSum * rowSum) / (side * side * minV));
    }
  }

  // 구역 높이를 시가총액 비율로 나누되, minH보다 작아지는 구역은 minH로 고정하고
  // 남은 높이를 나머지 구역끼리 다시 비율대로 나눈다(반복 - 4개뿐이라 금방 수렴).
  function sliceZoneHeights(zones, totalH, minH) {
    var heights = {};
    var pool = zones.slice();
    var availH = totalH;

    while (pool.length) {
      var poolCap = pool.reduce(function (s, z) { return s + z.cap; }, 0);
      var clamped = [];
      var kept = [];
      pool.forEach(function (z) {
        var proposed = poolCap > 0 ? (z.cap / poolCap) * availH : availH / pool.length;
        if (proposed < minH && pool.length > 1) {
          clamped.push(z);
        } else {
          kept.push(z);
        }
      });
      if (!clamped.length) {
        pool.forEach(function (z) {
          heights[z.key] = poolCap > 0 ? (z.cap / poolCap) * availH : availH / pool.length;
        });
        break;
      }
      clamped.forEach(function (z) {
        heights[z.key] = minH;
        availH -= minH;
      });
      pool = kept;
    }

    return heights;
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

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    }
    return el;
  }

  // 유리(글라스모피즘) 효과용 - 좌상단에 밝은 하이라이트가 도는 방사형 그라디언트를
  // 한 번만 정의해두고 모든 셀의 하이라이트(mcb-shine)가 재사용한다.
  function buildGlassDefs() {
    var defs = svgEl('defs');
    var grad = svgEl('radialGradient', { id: 'mcb-shine-grad', cx: '30%', cy: '22%', r: '75%' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.75' }));
    grad.appendChild(svgEl('stop', { offset: '55%', 'stop-color': '#ffffff', 'stop-opacity': '0.14' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' }));
    defs.appendChild(grad);
    return defs;
  }

  // 2단계 스퀘어파이드 트리맵: 1) 4개 구역(코스피/코스닥/ETF/레버리지)을 총 시가총액
  // 비율대로 큰 캔버스에 배치 2) 각 구역 안에서 종목들을 그 구역 시가총액 비율대로
  // 다시 배치. 구역마다 위쪽에 이름표 띠를 확보해 구역 구분을 표시한다.
  function buildLayout(data) {
    var zones = CATEGORY_ORDER.map(function (cat) {
      var items = (data[cat] || [])
        .map(function (it) {
          return {
            name: it.name,
            cap: it.cap || 0,
            changeRate: it.changeRate,
            breakdown: it.breakdown,
            category: cat
          };
        })
        .filter(function (it) { return it.cap > 0; });
      var totalCap = items.reduce(function (s, it) { return s + it.cap; }, 0);
      return { key: cat, label: CATEGORY_LABELS[cat] || cat, items: items, cap: totalCap };
    }).filter(function (z) { return z.items.length && z.cap > 0; });

    if (!zones.length) return { nodes: [], viewH: VIEW_H, clusterLabels: [] };

    zones.sort(function (a, b) { return b.cap - a.cap; });

    // 구역(코스피/코스닥/ETF/레버리지)은 스퀘어파이드에 맡기면 코스피가 압도적으로 커서
    // 나머지 구역이 오른쪽 끝에 얇은 세로줄로 몰려 잘 안 보이는 문제가 있었다 - 대신
    // 위아래로 전체 폭을 쓰는 가로 띠로 쌓고(큰 구역이 위), 각 구역에 최소 높이를
    // 보장해 작은 구역도 항상 눈에 띄게 한다.
    var zoneHeights = sliceZoneHeights(zones, VIEW_H, MIN_ZONE_H);
    var zy0 = 0;
    var zoneRects = zones.map(function (z) {
      var h = zoneHeights[z.key];
      var rect = { item: z, x: 0, y: zy0, w: VIEW_W, h: h };
      zy0 += h;
      return rect;
    });

    var nodes = [];
    var clusterLabels = [];

    zoneRects.forEach(function (zr) {
      var zone = zr.item;
      var zx = zr.x + ZONE_GAP / 2;
      var zy = zr.y + ZONE_GAP / 2;
      var zw = Math.max(zr.w - ZONE_GAP, 1);
      var zh = Math.max(zr.h - ZONE_GAP, 1);

      var showLabel = zw >= 42 && zh >= ZONE_LABEL_H + 24;
      var labelH = showLabel ? ZONE_LABEL_H : Math.min(zh, ZONE_LABEL_H);

      clusterLabels.push({
        key: zone.key,
        label: zone.label,
        x: zx,
        y: zy,
        w: zw,
        h: labelH,
        totalCap: zone.cap,
        showText: showLabel
      });

      var innerX = zx + 1;
      var innerY = zy + labelH + 1;
      var innerW = Math.max(zw - 2, 1);
      var innerH = Math.max(zh - labelH - 2, 1);

      var items = zone.items.slice().sort(function (a, b) { return b.cap - a.cap; });
      var itemScale = (innerW * innerH) / (zone.cap || 1);
      items.forEach(function (it) { it.value = it.cap * itemScale; });

      var itemRects = squarify(items, innerX, innerY, innerW, innerH);
      itemRects.forEach(function (ir) {
        var ix = ir.x + CELL_GAP / 2;
        var iy = ir.y + CELL_GAP / 2;
        var iw = Math.max(ir.w - CELL_GAP, 1);
        var ih = Math.max(ir.h - CELL_GAP, 1);
        nodes.push({
          name: ir.item.name,
          cap: ir.item.cap,
          changeRate: ir.item.changeRate,
          breakdown: ir.item.breakdown,
          category: ir.item.category,
          x: ix,
          y: iy,
          w: iw,
          h: ih
        });
      });
    });

    return { nodes: nodes, viewH: VIEW_H, clusterLabels: clusterLabels };
  }

  function buildLegendHtml() {
    // 카테고리 구분은 구역 이름표로 하므로, 범례는 등락 색상 의미만 안내.
    return '<span class="mcb-legend-item"><i class="mcb-dot mcb-up"></i>상승</span>' +
      '<span class="mcb-legend-item"><i class="mcb-dot mcb-down"></i>하락</span>';
  }

  function shortenName(name, w) {
    var maxChars = Math.max(2, Math.floor(w / 7.5));
    return name.length > maxChars ? name.slice(0, maxChars) + '…' : name;
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
      svg.appendChild(svgEl('g', { class: 'mcb-cells' }));
      svg.appendChild(svgEl('g', { class: 'mcb-cluster-labels' }));
      container.querySelector('.mcb-canvas').insertBefore(svg, container.querySelector('.mcb-tooltip'));
    } else {
      svg.setAttribute('viewBox', '0 0 ' + VIEW_W + ' ' + viewH);
    }

    container.querySelector('.mcb-updated').textContent = updatedAt ? updatedAt + ' 기준 (준실시간)' : '';
    container.querySelector('.mcb-legend').innerHTML = legendHtml;

    var tooltip = container.querySelector('.mcb-tooltip');
    function hideTooltip() { tooltip.hidden = true; }

    function positionTooltip(vx, vy) {
      var canvasRect = container.querySelector('.mcb-canvas').getBoundingClientRect();
      var scale = canvasRect.width / VIEW_W;
      var left = vx * scale;
      var top = vy * scale;
      tooltip.style.left = Math.min(Math.max(left, 0), canvasRect.width - 170) + 'px';
      tooltip.style.top = Math.max(top - 64, 0) + 'px';
    }

    function showTooltip(item) {
      var rateTxt = (item.changeRate >= 0 ? '+' : '') + item.changeRate.toFixed(2) + '%';
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + item.name + '</div>' +
        '<div class="mcb-tt-cap">시가총액 ' + formatCap(item.cap) + '</div>' +
        '<div class="mcb-tt-rate ' + directionClass(item.changeRate) + '">' + rateTxt + '</div>' +
        (item.breakdown ? '<div class="mcb-tt-breakdown">' + item.breakdown + '</div>' : '');
      tooltip.hidden = false;
      positionTooltip(item.x + item.w / 2, item.y);
    }

    function showZoneTooltip(cl) {
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + cl.label + '</div>' +
        '<div class="mcb-tt-cap">전체 시가총액 ' + formatCap(cl.totalCap) + '</div>';
      tooltip.hidden = false;
      positionTooltip(cl.x + cl.w / 2, cl.y);
    }

    // 구역 이름표(코스피/코스닥/ETF/단일종목 레버리지) - 4개뿐이라 diff 없이 매번 새로 그리고,
    // 마우스를 올리면 그 구역 종목들의 시가총액 합계를 툴팁으로 보여준다.
    var labelLayer = svg.querySelector('.mcb-cluster-labels');
    labelLayer.innerHTML = '';
    (clusterLabels || []).forEach(function (cl) {
      var hit = svgEl('rect', {
        class: 'mcb-zone-hit', x: cl.x, y: cl.y, width: cl.w, height: cl.h
      });
      hit.addEventListener('mouseenter', function (evt) { evt.stopPropagation(); showZoneTooltip(cl); });
      hit.addEventListener('mouseleave', hideTooltip);
      hit.addEventListener('click', function (evt) { evt.stopPropagation(); showZoneTooltip(cl); });
      labelLayer.appendChild(hit);

      if (cl.showText) {
        var t = svgEl('text', { class: 'mcb-zone-label', x: cl.x + 7, y: cl.y + cl.h - 6 });
        t.textContent = cl.label;
        t.style.pointerEvents = 'none';
        labelLayer.appendChild(t);
      }
    });

    var cellLayer = svg.querySelector('.mcb-cells');
    var existing = {};
    Array.prototype.forEach.call(cellLayer.querySelectorAll('.mcb-node'), function (node) {
      existing[node.getAttribute('data-name')] = node;
    });

    var seen = {};
    nodes.forEach(function (item) {
      seen[item.name] = true;

      var node = existing[item.name];
      if (!node) {
        node = svgEl('g', { class: 'mcb-node', 'data-name': item.name });
        node.appendChild(svgEl('rect', { class: 'mcb-cell' }));
        node.appendChild(svgEl('rect', { class: 'mcb-shine', fill: 'url(#mcb-shine-grad)' }));
        node.appendChild(svgEl('text', { class: 'mcb-label' }));
        node.appendChild(svgEl('text', { class: 'mcb-cap-label' }));
        node.appendChild(svgEl('text', { class: 'mcb-rate-label' }));
        cellLayer.appendChild(node);

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
      var big = item.w >= 90 && item.h >= 56;
      var mid = item.w >= 56 && item.h >= 34;
      var small = item.w >= 34 && item.h >= 20;
      var cx = item.x + item.w / 2;

      // 각진 사각형: 모서리를 둥글리지 않는다(rx 미지정 = 기본값 0)
      var cellEl = node.querySelector('.mcb-cell');
      cellEl.setAttribute('x', item.x);
      cellEl.setAttribute('y', item.y);
      cellEl.setAttribute('width', item.w);
      cellEl.setAttribute('height', item.h);
      cellEl.setAttribute('class', 'mcb-cell ' + dirClass);

      // 유리 효과: 셀 자체 크기의 하이라이트를 좌상단으로 살짝 치우쳐 얹어 광택 표현
      var shineEl = node.querySelector('.mcb-shine');
      shineEl.setAttribute('x', item.x);
      shineEl.setAttribute('y', item.y);
      shineEl.setAttribute('width', item.w);
      shineEl.setAttribute('height', item.h);

      var labelEl = node.querySelector('.mcb-label');
      labelEl.style.display = small ? '' : 'none';
      labelEl.setAttribute('x', cx);
      labelEl.setAttribute('y', item.y + (big ? item.h * 0.42 : item.h / 2 + 3));
      labelEl.style.fontSize = (big ? 15 : (mid ? 12 : 10)) + 'px';
      labelEl.textContent = shortenName(item.name, item.w);

      var capEl = node.querySelector('.mcb-cap-label');
      capEl.style.display = big ? '' : 'none';
      capEl.setAttribute('x', cx);
      capEl.setAttribute('y', item.y + item.h * 0.42 + 17);
      capEl.textContent = formatCap(item.cap);

      var rateEl = node.querySelector('.mcb-rate-label');
      rateEl.style.display = mid ? '' : 'none';
      rateEl.setAttribute('x', cx);
      rateEl.setAttribute('y', big ? item.y + item.h * 0.42 + 34 : item.y + item.h / 2 + 16);
      rateEl.setAttribute('class', 'mcb-rate-label ' + dirClass);
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

  function renderError(container, message) {
    if (container.querySelector('svg.mcb-svg')) return; // 이미 렌더된 상태면 마지막 성공 화면 유지
    container.innerHTML = '<div class="mcb-error">' + message + '</div>';
  }

  function tick(container) {
    MarketcapBubble.fetchBubbleData()
      .then(function (json) {
        if (!json || !json.data) throw new Error('empty bubble data');
        var layout = buildLayout(json.data);
        var legendHtml = buildLegendHtml();
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
