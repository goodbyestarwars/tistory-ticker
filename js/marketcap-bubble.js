/**
 * 시가총액 트리맵 (코스피/코스닥/ETF/단일종목레버리지)
 * GAS 프록시(?bubble=1)를 45초 간격으로 폴링. 스퀘어파이드(squarified) 트리맵으로
 * 코스피/코스닥/전체/ETF 선택 → 테마(또는 시장) 구역 → 종목을 가로형 모자이크로 배치한다.
 * 타일 면적은 실제 시총, 색상은 전일 대비 등락률. 종목 풀은 기존 GAS 응답 그대로.
 * 채우기 색은 등락(상승 빨강/하락 파랑 - 사이트 공통 컬러)의 각진 평면 색상으로
 * 표현한다(글라스모피즘 없음). d3 등 외부 라이브러리 없이 vanilla JS로 구현.
 * data/marketcap-codes.js가 이 스크립트보다 먼저 로드되어야 한다(로컬 프리뷰 fallback용).
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#marketcap-bubble';
  var REFRESH_MS = 45 * 1000;
  var FETCH_TIMEOUT_MS = 8000;

  var CATEGORY_ORDER = ['KOSPI', 'KOSDAQ', 'ETF', 'INVERSE', 'LEV'];
  var CATEGORY_LABELS = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', ETF: 'ETF', INVERSE: '인버스 ETF', LEV: '단일종목 레버리지' };

  // 등락률 -3%~+3% 7단계 색 구간(경계는 정수% 눈금을 가운데 두도록 ±0.5% 간격).
  // 파랑(하락)-회색(보합)-빨강(상승) 대비, CSS(.mcb-cell.mcb-c-3 ~ .mcb-c3)에서 실제 색 정의.
  var HEAT_BUCKETS = [
    { max: -2.5, cls: 'mcb-c-3' },
    { max: -1.5, cls: 'mcb-c-2' },
    { max: -0.5, cls: 'mcb-c-1' },
    { max: 0.5, cls: 'mcb-c0' },
    { max: 1.5, cls: 'mcb-c1' },
    { max: 2.5, cls: 'mcb-c2' },
    { max: Infinity, cls: 'mcb-c3' }
  ];

  var VIEW_W = 1100;
  var VIEW_H = 740;      // 세로로 넉넉하게 키워 각 셀이 커지고 종목명이 더 많이 보이게 함

  var ZONE_GAP = 5;       // 구역(코스피/코스닥/ETF/레버리지) 사이 간격
  var ZONE_LABEL_H = 20;  // 구역 이름표가 차지하는 위쪽 띠 높이
  var CELL_GAP = 1.5;       // 구역 안 종목 셀 사이 간격
  var MIN_ZONE_H = 140;   // 구역이 아무리 작아도 보장하는 최소 높이(이름표+종목 2줄 볼 공간)

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

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function heatClass(rate) {
    var r = typeof rate === 'number' ? rate : 0;
    for (var i = 0; i < HEAT_BUCKETS.length; i++) {
      if (r <= HEAT_BUCKETS[i].max) return HEAT_BUCKETS[i].cls;
    }
    return 'mcb-c0';
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

  // 한 구역 안 종목 배치. 스퀘어파이드에만 맡기면 구역이 옆으로 넓고 낮을 때
  // (예: 코스닥) 한 줄로 죽 늘어선 얇은 셀이 나오기 쉬워, 종목이 여러 개인데
  // 폭/높이 비율이 아주 납작한 구역은 시가총액 합이 비슷하도록 여러 줄로 나눠 배치한다.
  // 코스닥은 종목 수가 많아 2줄로도 부족해 3줄로 나눔(그 외 구역은 기존대로 2줄).
  function layoutZoneItems(items, x, y, w, h, zoneKey) {
    var sorted = items.slice().sort(function (a, b) { return b.cap - a.cap; });
    var aspect = w / h;
    var rowCount = zoneKey === 'KOSDAQ' ? 3 : 2;

    if (sorted.length > rowCount * 3 && aspect > 4) {
      var rows = [];
      var rowSums = [];
      for (var i = 0; i < rowCount; i++) { rows.push([]); rowSums.push(0); }
      sorted.forEach(function (it) {
        var idx = 0;
        for (var j = 1; j < rowCount; j++) {
          if (rowSums[j] < rowSums[idx]) idx = j;
        }
        rows[idx].push(it);
        rowSums[idx] += it.cap;
      });
      var totalCap = rowSums.reduce(function (s, v) { return s + v; }, 0);
      var rects = [];
      var yy = y;
      rows.forEach(function (row, idx2) {
        var rh = idx2 === rows.length - 1
          ? Math.max(y + h - yy, 1) // 마지막 줄은 남은 높이를 전부 사용(반올림 오차 방지)
          : (totalCap > 0 ? (rowSums[idx2] / totalCap) * h : h / rowCount);
        rects = rects.concat(squarifyScaled(row, x, yy, w, rh));
        yy += rh;
      });
      return rects;
    }
    return squarifyScaled(sorted, x, y, w, h);

    function squarifyScaled(subitems, sx, sy, sw, sh) {
      if (!subitems.length) return [];
      // 한경형 시총비례 지도: 대형주 면적도 줄이지 않고 실제 시가총액 정비례.
      var weights = subitems.map(function (it) { return it.cap; });
      var totalWeight = weights.reduce(function (s, v) { return s + v; }, 0);
      var scale = (sw * sh) / (totalWeight || 1);
      subitems.forEach(function (it, i) { it.value = weights[i] * scale; });
      return squarify(subitems, sx, sy, sw, sh);
    }
  }

  // 그룹(테마/시장) 면적과 내부 종목 모두 스퀘어파이드 트리맵으로 계산한다.
  // 테마별 중복 소속은 첫 유효 테마에만 배정해 시가총액을 중복 계산하지 않는다.
  // 전체 KOSPI+KOSDAQ 종목 중 업종(섹터)명이 sectors 배열에 포함된 것만 모아 리스트로 반환.
  // 한 종목이 여러 섹터에 속할 수 있어(sectors-v3.js 중복 포함 규칙) 단순 필터링이면 충분.
  function uniqueSectors(data) {
    var set = {};
    ['KOSPI', 'KOSDAQ'].forEach(function (cat) {
      (data[cat] || []).forEach(function (it) {
        (it.sectors || []).forEach(function (s) { set[s] = true; });
      });
    });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  // sectorFilter가 있으면 코스피+코스닥을 합쳐 그 업종에 속한 종목만 단일 구역으로,
  // 없으면(전체) 기존처럼 카테고리별 구역으로 나눈다.
  // codeFilter({label, codes:{code:true}})는 증시온도 "국내 주요종목"이 TOP10 테마를 골랐을 때
  // 그 테마 구성종목만 한 구역으로 그린다. 시총은 이 풀(sectors-v3 기반)에 있는 종목만 알 수 있어
  // 테마 종목 일부는 빠질 수 있다 - 몇 개가 매칭됐는지는 layout.matched로 돌려준다.
  // 마켓MAP형: 가로형 스퀘어파이드 트리맵. 그룹/개별 종목 면적 모두 실제 시가총액 비례.
  // sectors는 사이트 자체 테마 분류이며 KRX 공식 업종으로 오인시키지 않는다.
  function buildLayout(data, sectorFilter, codeFilter, view) {
    view = ['KOSPI','KOSDAQ','ALL','ETF'].indexOf(view) >= 0 ? view : 'KOSPI';
    function select(cats) {
      return cats.reduce(function (acc, cat) {
        return acc.concat((data[cat] || []).map(function (it) {
          var cap = Number(it.cap), rate=it.changeRate == null ? null : Number(it.changeRate);
          if (!isFinite(cap) || cap <= 0) return null;
          return {code:it.code || '',name:it.name || it.code || '종목 미확인',
            cap:cap,changeRate:rate != null && isFinite(rate) ? rate : null,
            breakdown:it.breakdown,category:cat,sectors:it.sectors || []};
        }).filter(Boolean));
      },[]);
    }
    function zone(key,label,items) {
      return {key:key,label:label,items:items,cap:items.reduce(function (n,it) { return n+it.cap; },0)};
    }
    var zones=[],matched=0,items,groups;
    if (codeFilter && codeFilter.codes) {
      items=select(['KOSPI','KOSDAQ']).filter(function (it) { return codeFilter.codes[it.code]; });
      matched=items.length;
      if (items.length) zones=[zone('SELECTED',codeFilter.label || '선택 종목',items)];
    } else if (sectorFilter) {
      items=select(view==='KOSPI'?['KOSPI']:view==='KOSDAQ'?['KOSDAQ']:['KOSPI','KOSDAQ'])
        .filter(function (it) { return it.sectors.indexOf(sectorFilter)>=0; });
      if (items.length) zones=[zone('SECTOR',sectorFilter,items)];
    } else if (view==='ALL' || view==='ETF') {
      (view==='ALL'?['KOSPI','KOSDAQ']:['ETF','INVERSE','LEV']).forEach(function (cat) {
        var list=select([cat]);
        if(list.length) zones.push(zone(cat,CATEGORY_LABELS[cat] || cat,list));
      });
    } else {
      groups={};
      select([view]).forEach(function (it) {
        var group=it.sectors.filter(function (name) {
          return name && !/코스피\s*3대장|시총\s*상위|TOP\s*10/i.test(name);
        })[0] || it.sectors[0] || '기타';
        (groups[group] = groups[group] || []).push(it);
      });
      var sorted=Object.keys(groups).map(function (key) { return zone(key,key,groups[key]); })
        .sort(function (a,b) { return b.cap-a.cap; });
      zones=sorted.slice(0,11);
      if(sorted.length>11) zones.push(zone('OTHER','기타 테마', [].concat.apply([],sorted.slice(11).map(function(z){return z.items;}))));
    }
    zones=zones.filter(function(z){return z.cap>0;}).sort(function(a,b){return b.cap-a.cap;});
    var totalCap=zones.reduce(function(n,z){return n+z.cap;},0);
    var totalItems=zones.reduce(function(n,z){return n+z.items.length;},0);
    if(!zones.length) return {nodes:[],viewH:VIEW_H,clusterLabels:[],matched:matched,totalCap:0,totalItems:0,marketView:view};
    var zoneRects=squarify(zones.map(function(z){return {value:z.cap/totalCap*VIEW_W*VIEW_H,zone:z};}),0,0,VIEW_W,VIEW_H);
    var nodes=[],clusterLabels=[];
    zoneRects.forEach(function(zr){
      var z=zr.item.zone,x=zr.x+ZONE_GAP/2,y=zr.y+ZONE_GAP/2;
      var w=Math.max(zr.w-ZONE_GAP,1),h=Math.max(zr.h-ZONE_GAP,1);
      var show=w>=75 && h>=ZONE_LABEL_H+24,lh=show?ZONE_LABEL_H:0;
      clusterLabels.push({key:z.key,label:z.label,x:x,y:y,w:w,h:lh,totalCap:z.cap,showText:show});
      layoutZoneItems(z.items,x+1,y+lh+1,Math.max(w-2,1),Math.max(h-lh-2,1),z.key).forEach(function(rect){
        nodes.push({code:rect.item.code,name:rect.item.name,cap:rect.item.cap,
          changeRate:rect.item.changeRate,breakdown:rect.item.breakdown,category:rect.item.category,
          x:rect.x+CELL_GAP/2,y:rect.y+CELL_GAP/2,
          w:Math.max(rect.w-CELL_GAP,0.5),h:Math.max(rect.h-CELL_GAP,0.5)});
      });
    });
    return {nodes:nodes,viewH:VIEW_H,clusterLabels:clusterLabels,matched:matched,totalCap:totalCap,totalItems:totalItems,marketView:view};
  }

    // 카테고리 구분은 구역 이름표로 하므로, 범례는 등락률 색상 구간(-3%~+3%)만 안내.
  function buildLegendHtml() {
    var ticks = ['-3%', '-2%', '-1%', '0%', '1%', '2%', '3%'];
    var cells = HEAT_BUCKETS.map(function (b, i) {
      return '<span class="mcb-legend-seg ' + b.cls + '">' + ticks[i] + '</span>';
    }).join('');
    return '<span class="mcb-legend-caption">변동률</span><span class="mcb-legend-scale">' + cells + '</span>';
  }

  // 글자 크기가 셀마다 다르게 연속 조절되면서, 글자수 기반 어림값(폭/7.5)으로는
  // 큰 폰트에서 실제 렌더 폭을 과소평가해 셀 밖으로 삐져나오는 문제가 있었다
  // (한화에어로스페이스 등 긴 이름 + 큰 칸). SVG가 주는 실제 렌더 폭
  // (getComputedTextLength)을 재서 정확히 맞을 때까지 줄인다.
  function fitText(el, fullText, maxWidth) {
    el.textContent = fullText;
    if (maxWidth <= 0) { el.textContent = ''; return; }
    if (el.getComputedTextLength() <= maxWidth) return;

    var lo = 0, hi = fullText.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      el.textContent = fullText.slice(0, mid) + '…';
      if (el.getComputedTextLength() <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    el.textContent = lo > 0 ? fullText.slice(0, lo) + '…' : '…';
  }

  function render(container, nodes, viewH, updatedAt, legendHtml, clusterLabels) {
    var svg = container.querySelector('svg.mcb-svg');
    var isFirstRender = !svg;

    if (isFirstRender) {
      // 툴팁은 .mcb-canvas(position:relative) 기준으로 좌표를 계산하므로
      // 반드시 그 안의 자식이어야 한다 - 형제로 두면 더 위쪽 조상 엘리먼트를
      // 기준으로 absolute 배치가 틀어져 엉뚱한 위치(페이지 상단 등)에 뜬다.
      container.innerHTML =
        '<div class="mcb-filter-bar">' +
        '<div class="mcb-market-tabs" role="group" aria-label="시장 선택">' +
        '<button type="button" data-mcb-market="KOSPI">코스피</button>' +
        '<button type="button" data-mcb-market="KOSDAQ">코스닥</button>' +
        '<button type="button" data-mcb-market="ALL">전체</button>' +
        '<button type="button" data-mcb-market="ETF">ETF·레버리지</button></div>' +
        '<label class="mcb-filter-label" for="mcbSectorFilter">테마</label>' +
        '<select id="mcbSectorFilter" class="mcb-filter-select"><option value="">전체</option></select>' +
        '<span class="mcb-period" title="현재 수집처는 하루 등락률만 제공합니다.">1일 변동률</span>' +
        '</div>' +
        '<p class="mcb-explainer">타일 면적 = 실제 시가총액 · 색상 = 전일 대비 등락률 · 더블클릭/더블터치하면 종목 상세</p>' +
        '<div class="mcb-canvas"><div class="mcb-tooltip" hidden></div></div>' +
        '<div class="mcb-foot"><div class="mcb-legend"></div><span class="mcb-stats"></span></div>' +
        '<div class="mcb-updated nt-stamp"></div>';
      svg = svgEl('svg', { class: 'mcb-svg', viewBox: '0 0 ' + VIEW_W + ' ' + viewH });
      svg.appendChild(svgEl('g', { class: 'mcb-cells' }));
      svg.appendChild(svgEl('g', { class: 'mcb-cluster-labels' }));
      container.querySelector('.mcb-canvas').insertBefore(svg, container.querySelector('.mcb-tooltip'));

      container.querySelector('#mcbSectorFilter').addEventListener('change', function (e) {
        container.__mcbSectorFilter = e.target.value;
        var lastData = container.__mcbLastData;
        if (lastData) renderFromData(container, lastData, container.__mcbLastUpdatedAt);
      });
      Array.prototype.forEach.call(container.querySelectorAll('[data-mcb-market]'), function (button) {
        button.addEventListener('click', function () {
          container.__mcbMarketView = button.getAttribute('data-mcb-market');
          container.__mcbSectorFilter = '';
          container.querySelector('#mcbSectorFilter').value = '';
          if (container.__mcbLastData) renderFromData(container,container.__mcbLastData,container.__mcbLastUpdatedAt);
        });
      });
    } else {
      svg.setAttribute('viewBox', '0 0 ' + VIEW_W + ' ' + viewH);
    }

    container.querySelector('.mcb-updated').textContent = updatedAt ? ((window.NineTime && window.NineTime.updated(updatedAt)) || (updatedAt + ' 기준')) + ' · 준실시간' : '';
    container.querySelector('.mcb-legend').innerHTML = legendHtml;

    var tooltip = container.querySelector('.mcb-tooltip');
    function hideTooltip() { tooltip.hidden = true; }

    function positionTooltip(vx, vy) {
      var canvasRect = container.querySelector('.mcb-canvas').getBoundingClientRect();
      var svgRect = svg.getBoundingClientRect();
      // 모바일에서는 SVG 최소 폭으로 가로 스크롤하므로 container 폭으로 scale하지 않는다.
      var scale = svgRect.width / VIEW_W;
      var left = svgRect.left - canvasRect.left + vx * scale;
      var top = svgRect.top - canvasRect.top + vy * scale;
      tooltip.style.left = Math.min(Math.max(left, 0), Math.max(canvasRect.width - 170, 0)) + 'px';
      tooltip.style.top = Math.max(top - 64, 0) + 'px';
    }

    // 구역(코스피/코스닥/ETF/레버리지)은 이제 전체 폭을 쓰는 가로 띠라 구역 중심
    // 좌표로 툴팁을 띄우면 항상 캔버스 한가운데에 뜬다 - 실제 마우스 커서 위치
    // 기준으로 띄운다.
    function positionTooltipAtEvent(evt) {
      var canvasRect = container.querySelector('.mcb-canvas').getBoundingClientRect();
      var left = evt.clientX - canvasRect.left;
      var top = evt.clientY - canvasRect.top;
      tooltip.style.left = Math.min(Math.max(left, 0), Math.max(canvasRect.width - 170, 0)) + 'px';
      tooltip.style.top = Math.max(top - 64, 0) + 'px';
    }

    function showTooltip(item) {
      // 2026-08-03: item.name/item.breakdown(GAS ?bubble=1 응답)을 이스케이프 없이 innerHTML에
      // 삽입하고 있었다 - 같은 파일에 escapeHtml이 이미 있는데 여기서만 누락돼 있었다.
      var rateTxt = item.changeRate == null ? '등락률 미제공' : (item.changeRate > 0 ? '+' : '') + item.changeRate.toFixed(2) + '%';
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="mcb-tt-cap">시가총액 ' + formatCap(item.cap) + '</div>' +
        '<div class="mcb-tt-rate ' + heatClass(item.changeRate) + '">' + rateTxt + '</div>' +
        (item.breakdown ? '<div class="mcb-tt-breakdown">' + escapeHtml(item.breakdown) + '</div>' : '');
      tooltip.hidden = false;
      positionTooltip(item.x + item.w / 2, item.y);
    }

    function showZoneTooltip(cl, evt) {
      tooltip.innerHTML =
        '<div class="mcb-tt-name">' + escapeHtml(cl.label) + '</div>' +
        '<div class="mcb-tt-cap">전체 시가총액 ' + formatCap(cl.totalCap) + '</div>';
      tooltip.hidden = false;
      positionTooltipAtEvent(evt);
    }

    // 구역 이름표(코스피/코스닥/ETF/단일종목 레버리지) - 4개뿐이라 diff 없이 매번 새로 그리고,
    // 마우스를 올리면 그 구역 종목들의 시가총액 합계를 툴팁으로 보여준다.
    var labelLayer = svg.querySelector('.mcb-cluster-labels');
    labelLayer.innerHTML = '';
    (clusterLabels || []).forEach(function (cl) {
      var hit = svgEl('rect', {
        class: 'mcb-zone-hit', x: cl.x, y: cl.y, width: cl.w, height: cl.h
      });
      hit.addEventListener('mouseenter', function (evt) { evt.stopPropagation(); showZoneTooltip(cl, evt); });
      hit.addEventListener('mousemove', function (evt) { evt.stopPropagation(); positionTooltipAtEvent(evt); });
      hit.addEventListener('mouseleave', hideTooltip);
      hit.addEventListener('click', function (evt) { evt.stopPropagation(); showZoneTooltip(cl, evt); });
      labelLayer.appendChild(hit);

      if (cl.showText) {
        var t = svgEl('text', { class: 'mcb-zone-label', x: cl.x + 7, y: cl.y + cl.h - 6 });
        t.textContent = cl.label;
        t.style.pointerEvents = 'none';
        labelLayer.appendChild(t);
        fitText(t,cl.label,Math.max(cl.w-14,0));
      }
    });

    var cellLayer = svg.querySelector('.mcb-cells');
    var existing = {};
    Array.prototype.forEach.call(cellLayer.querySelectorAll('.mcb-node'), function (node) {
      existing[node.getAttribute('data-name')] = node;
    });

    var seen = {};
    nodes.forEach(function (item) {
      seen[item.code || item.name] = true;

      var node = existing[item.code || item.name];
      if (!node) {
        node = svgEl('g', { class: 'mcb-node', 'data-name': item.code || item.name });
        node.appendChild(svgEl('rect', { class: 'mcb-cell' }));
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
        node.addEventListener('dblclick', function (evt) {
          var item=node.__mcbItem;
          if (!item || !/^[0-9A-Za-z]{6}$/.test(item.code || '')) return;
          evt.stopPropagation();
          global.location.href='/page/stock-search?code='+encodeURIComponent(item.code)+'&name='+encodeURIComponent(item.name);
        });
        node.addEventListener('keydown', function(evt) {
          if (evt.key !== 'Enter' && evt.key !== ' ') return;
          evt.preventDefault();
          var item=node.__mcbItem;
          if (!item) return;
          if (!/^[0-9A-Za-z]{6}$/.test(item.code || '')) { showTooltip(item); return; }
          global.location.href='/page/stock-search?code='+encodeURIComponent(item.code)+'&name='+encodeURIComponent(item.name);
        });
      }
      node.__mcbItem = item;
      if (item.code && /^[0-9A-Za-z]{6}$/.test(item.code)) {
        node.setAttribute('role','link'); node.setAttribute('tabindex','0');
        node.setAttribute('aria-label',item.name+' · 시가총액 '+formatCap(item.cap)+' · '+(item.changeRate == null ? '등락률 미제공' : item.changeRate.toFixed(2)+'%')+' · 상세 이동');
      } else { node.removeAttribute('role'); node.removeAttribute('tabindex'); }

      var dirClass = heatClass(item.changeRate);
      var big=item.w >= 85 && item.h >= 54;
      var mid=item.w >= 52 && item.h >= 32;
      var small=item.w >= 31 && item.h >= 20;
      var cx = item.x + item.w / 2;
      var cy = item.y + item.h / 2;

      // 각진 사각형: 모서리를 둥글리지 않는다(rx 미지정 = 기본값 0)
      var cellEl = node.querySelector('.mcb-cell');
      cellEl.setAttribute('x', item.x);
      cellEl.setAttribute('y', item.y);
      cellEl.setAttribute('width', item.w);
      cellEl.setAttribute('height', item.h);
      cellEl.setAttribute('class', 'mcb-cell ' + dirClass);

      // 글자 크기를 3단계 고정값 대신 셀 크기에 비례해 연속적으로 키운다
      // (칸이 클수록 이름/시총/등락률 글자도 그만큼 커짐).
      var nameFontSize=clamp(Math.min(item.w/8,item.h/4.3),10,24);
      var rateFontSize=clamp(nameFontSize*0.88,10,20);
      var lineGap=nameFontSize*1.1;

      var labelEl = node.querySelector('.mcb-label');
      labelEl.style.display = small ? '' : 'none';
      labelEl.setAttribute('x', cx);
      labelEl.setAttribute('y', cy + (big ? -lineGap*0.65 : mid ? -lineGap*0.32 : nameFontSize*0.32));
      labelEl.style.fontSize = nameFontSize + 'px';
      fitText(labelEl, item.name, Math.max(item.w - 6, 0));

      // 세 줄을 읽을 수 있는 타일은 이름·시총·등락률을 함께 표시한다.
      // 작은 타일의 시총도 기존 툴팁과 접근성 이름으로 확인할 수 있다.
      var capEl = node.querySelector('.mcb-cap-label');
      capEl.style.display = big ? '' : 'none';
      capEl.setAttribute('x', cx);
      capEl.setAttribute('y', cy + lineGap*0.3);
      capEl.style.fontSize = rateFontSize + 'px';
      var tileCap = item.cap >= 1e12 ? Math.round(item.cap / 1e12) + '조' : formatCap(item.cap);
      fitText(capEl, tileCap, Math.max(item.w - 6, 0));

      var rateEl = node.querySelector('.mcb-rate-label');
      rateEl.style.display = mid ? '' : 'none';
      rateEl.setAttribute('x', cx);
      rateEl.setAttribute('y', cy + lineGap*(big ? 1.25 : 0.86));
      rateEl.style.fontSize = rateFontSize + 'px';
      rateEl.setAttribute('class', 'mcb-rate-label ' + dirClass);
      rateEl.textContent = item.changeRate == null ? '—' : (item.changeRate > 0 ? '+' : '')+item.changeRate.toFixed(1)+'%';
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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // 업종 <select> 옵션을 데이터 기준으로 갱신. 매 tick(45초)마다 통째로 다시 그리면
  // 사용자가 고른 값이 날아가므로, 옵션 목록이 실제로 바뀔 때만 innerHTML을 갱신하고
  // 현재 선택값은 유지한다.
  function updateSectorOptions(container, data) {
    var select = container.querySelector('#mcbSectorFilter');
    if (!select) return;
    var view=container.__mcbMarketView || 'KOSPI';
    var subset={KOSPI:view === 'KOSDAQ' || view === 'ETF' ? [] : data.KOSPI || [],
      KOSDAQ:view === 'KOSPI' || view === 'ETF' ? [] : data.KOSDAQ || []};
    var sectors=uniqueSectors(subset);
    select.disabled=view === 'ETF';
    var optionsHtml = '<option value="">전체</option>' + sectors.map(function (s) {
      return '<option value="' + escapeAttr(s) + '">' + escapeHtml(s) + '</option>';
    }).join('');
    if (select.__mcbOptionsSig === optionsHtml) return;
    var current = select.value;
    select.innerHTML = optionsHtml;
    select.__mcbOptionsSig = optionsHtml;
    if (current && sectors.indexOf(current) > -1) select.value = current;
  }

  function renderFromData(container, data, updatedAt) {
    var sectorFilter = container.__mcbSectorFilter || '';
    var codeFilter = container.__mcbCodeFilter || null;
    var layout=buildLayout(data,sectorFilter,codeFilter,container.__mcbMarketView || 'KOSPI');
    var legendHtml=buildLegendHtml();
    render(container,layout.nodes,layout.viewH,updatedAt,legendHtml,layout.clusterLabels);
    updateSectorOptions(container,data);
    Array.prototype.forEach.call(container.querySelectorAll('[data-mcb-market]'), function(btn) {
      var on=btn.getAttribute('data-mcb-market')===layout.marketView;
      btn.classList.toggle('is-active',on);
      btn.setAttribute('aria-pressed',String(on));
    });
    var stats=container.querySelector('.mcb-stats');
    if(stats) stats.textContent=layout.totalItems.toLocaleString('ko-KR')+'종목 · 표시 시총 '+formatCap(layout.totalCap);
    if (codeFilter && typeof global.CustomEvent === 'function') {
      container.dispatchEvent(new global.CustomEvent('mcb:rendered', { detail: { matched: layout.matched } }));
    }
  }

  // 외부(국내 주요종목)가 종목코드 필터를 바꾸면 마지막 데이터로 즉시 다시 그린다.
  function setCodeFilter(container, codeFilter) {
    if (!container) return;
    container.__mcbCodeFilter = codeFilter || null;
    if (container.__mcbLastData) renderFromData(container, container.__mcbLastData, container.__mcbLastUpdatedAt);
  }

  function tick(container) {
    MarketcapBubble.fetchBubbleData()
      .then(function (json) {
        if (!json || !json.data) throw new Error('empty bubble data');
        container.__mcbLastData = json.data;
        container.__mcbLastUpdatedAt = json.updatedAt;
        renderFromData(container, json.data, json.updatedAt);
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
    setCodeFilter: setCodeFilter,
    render: render
  };
  global.MarketcapBubble = MarketcapBubble;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
